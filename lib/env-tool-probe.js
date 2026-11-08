'use strict';
// T-0363: environment tool probes. The caller stays synchronous; on Windows a small worker_threads
// pool runs the same synchronous primitives next to the calling thread, which then waits with
// Atomics.wait and collects results with receiveMessageOnPort.
// Lane code reads the environment through the portable-process helpers only: a worker's process.env
// is a case-sensitive copy on Windows. Worker gets no `env` option: Node 18 then skips argv preloads.
const path = require('path');
const cp = require('child_process');
const { performance } = require('perf_hooks');
const { deadlineOptions } = require('./process-deadline');

const PER_TOOL_MS = 2000;
const MAX_BUFFER = 64 * 1024;
const VERSION_LENGTH = 80;
const MAX_CONCURRENCY = 4;
// Probes that stay on the calling thread: the state lock is per thread (npm runs inside it) and the
// one-slot git launch cache lives in this thread's portable-process instance.
const MAIN_THREAD_TOOLS = new Set(['npm', 'git']);
// Shared header slots; each queue entry then has one state slot (0 unclaimed, 1 running, 2 done).
const NEXT = 0, STOP = 1, ACTIVE = 2, SEQ = 3, HEADER = 4;
// Main waits this long past the overall deadline for a lane that died or ignores its child timeout.
const GRACE_MS = 1000;

function probeConcurrency(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return 1;
  const raw = String(env.LEERNESS_ENV_PROBE_CONCURRENCY || '').trim();
  return /^[1-9]\d{0,2}$/.test(raw) ? Math.min(Number(raw), MAX_CONCURRENCY) : MAX_CONCURRENCY;
}

// One tool. Spawn primitives are injected: the main thread passes the functions bin captured at
// load, a worker passes its own instances. Returns null when the tool is not on PATH.
function probeTool(cmd, versionArgs, options, deps) {
  const probe = { cwd: options.cwd, deadlineAt: options.deadlineAt, encoding: 'utf8', timeout: PER_TOOL_MS, maxBuffer: MAX_BUFFER };
  deadlineOptions(probe);
  const r = cmd === 'npm' ? deps.spawnNpmSync(versionArgs, probe) : deps.spawnPortableSync(cmd, versionArgs,
    { ...probe, ...(process.platform === 'win32' ? { literalPathLookup: true } : {}) });
  if (r.error && r.error.code === 'ENOENT') return null;
  if (r.error || r.status !== 0) throw Object.assign(r.error || new Error('Tool version probe failed'), { code: r.error ? r.error.code : 'E_TOOL_PROBE_FAILED', envCommand: cmd });
  deadlineOptions(probe);
  const sig = [];
  let toolPath = null;
  if (process.platform === 'win32') {
    try {
      if (cmd === 'npm') {
        toolPath = deps.resolveNpmCliPath({ env: process.env, cwd: options.cwd, deadlineAt: options.deadlineAt });
        if (toolPath) sig.push(toolPath);
      } else {
        // Reuse the launch the version probe resolved; resolving again ran where.exe twice per tool.
        const launch = r.launch || deps.resolvePortableLaunch(cmd, { env: process.env, cwd: options.cwd, deadlineAt: options.deadlineAt });
        toolPath = launch.source || null;
        sig.push(...[launch.source, launch.argsPrefix[0]].filter(Boolean));
      }
    } catch (error) { throw Object.assign(error, { envCommand: cmd }); }
  } else {
    const locator = cp.spawnSync('which', [cmd], deadlineOptions({ ...probe, shell: false }));
    if (locator.error || ![0, 1].includes(locator.status)) throw Object.assign(locator.error || new Error('Command locator failed'), { envCommand: cmd });
    toolPath = locator.status === 0 ? (locator.stdout || '').split(/\r?\n/)[0].trim() : null;
    if (toolPath) sig.push(toolPath);
    if (cmd === 'npm' && options.wantSig) {
      const entry = deps.resolveNpmCliPath({ env: process.env, cwd: options.cwd, deadlineAt: options.deadlineAt });
      if (entry) sig.push(entry);
    }
  }
  const version = (r.stdout || r.stderr || '').split(/\r?\n/)[0].trim().slice(0, VERSION_LENGTH);
  return { version, toolPath, sig };
}

// A tool's 2 s start when it gets a lane, never past the overall deadline.
function slotDeadline(deadlineAt) { return Math.min(deadlineAt, performance.now() + PER_TOOL_MS); }

// A timeout can be a sibling's doing (see the settling pass in runToolProbes), so it stops no lane.
function stopsLanes(error) { return !error || error.code !== 'ETIMEDOUT'; }

// A lane claims queue entries FIFO until the queue is empty or another lane stopped the run.
// ACTIVE is raised before STOP is read, so a lane that sees STOP clear has registered itself and
// the main thread (which waits for ACTIVE === 0 after STOP) cannot miss a probe it starts.
function laneLoop(state, queue, run, onResult) {
  const release = () => { Atomics.sub(state, ACTIVE, 1); Atomics.add(state, SEQ, 1); Atomics.notify(state, SEQ); };
  for (;;) {
    Atomics.add(state, ACTIVE, 1);
    if (Atomics.load(state, STOP) !== 0) return release();
    const j = Atomics.add(state, NEXT, 1);
    if (j >= queue.length) return release();
    Atomics.store(state, HEADER + j, 1);
    let record;
    try { record = { i: queue[j], ok: true, value: run(queue[j]) }; }
    catch (error) { if (stopsLanes(error)) Atomics.store(state, STOP, 1); record = { i: queue[j], ok: false, error }; }
    onResult(record);
    Atomics.store(state, HEADER + j, 2);
    release();
  }
}

// Worker results cross the port as plain fields: structured clone drops Error.code and envCommand.
function plainRecord(record) {
  if (record.ok) return { i: record.i, ok: true, value: record.value };
  const e = record.error;
  return { i: record.i, ok: false,
    code: e && e.code !== undefined && e.code !== null ? String(e.code) : null,
    envCommand: e && typeof e.envCommand === 'string' ? e.envCommand : null,
    message: String((e && e.message) || e) };
}
function errorFromPlain(record) {
  const error = new Error(record.message || 'Tool version probe failed');
  if (record.code !== null) error.code = record.code;
  if (record.envCommand !== null) error.envCommand = record.envCommand;
  return error;
}

function runSequential(toolList, { cwd, deadlineAt, wantSig, deps }) {
  return toolList.map(t => probeTool(t.name, t.args, { cwd, deadlineAt: slotDeadline(deadlineAt), wantSig }, deps));
}

// Returns results[i] (null = not on PATH) in toolList order, or throws what a sequential run would
// have thrown, once every started probe has finished. Never starts a probe after deadlineAt.
function runToolProbes(toolList, options) {
  const { cwd, deadlineAt, wantSig, deps } = options;
  const queue = toolList.map((t, i) => i).filter(i => !MAIN_THREAD_TOOLS.has(toolList[i].name));
  const pinned = toolList.map((t, i) => i).filter(i => MAIN_THREAD_TOOLS.has(toolList[i].name));
  const workerCount = Math.min((options.concurrency || 1) - 1, queue.length);
  if (workerCount < 1 || typeof SharedArrayBuffer === 'undefined') return runSequential(toolList, options);

  const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');
  const state = new Int32Array(new SharedArrayBuffer(4 * (HEADER + queue.length)));
  // hrtime is one clock across threads; performance.now() is only defined per thread.
  const deadlineHr = process.hrtime.bigint() + BigInt(Math.max(0, Math.round((deadlineAt - performance.now()) * 1e6)));
  const tools = toolList.map(t => ({ name: t.name, args: t.args.slice() }));
  const ports = [];
  for (let w = 0; w < workerCount; w++) {
    let channel;
    try {
      channel = new MessageChannel();
      const worker = new Worker(path.join(__dirname, 'env-probe-worker.js'), {
        workerData: { sab: state.buffer, port: channel.port2, queue, tools, cwd, deadlineHr },
        transferList: [channel.port2], stdout: true, stderr: true,
      });
      // A lane that dies leaves its claim unfinished (the ceiling below covers it); the event itself
      // arrives after this synchronous call and must not crash the caller.
      worker.on('error', () => {});
      worker.unref();
      ports.push(channel.port1);
    } catch { if (channel) channel.port1.close(); }
  }
  if (!ports.length) return runSequential(toolList, options);

  const results = new Array(toolList.length);
  const failed = new Map();
  let ranHere = 0, received = 0;
  const local = record => {
    ranHere++;
    if (record.ok) results[record.i] = record.value; else failed.set(record.i, record.error);
  };
  const drain = () => {
    for (const port of ports) {
      let message;
      while ((message = receiveMessageOnPort(port))) {
        const record = message.message;
        received++;
        if (record.ok) results[record.i] = record.value; else failed.set(record.i, errorFromPlain(record));
      }
    }
  };
  const run = i => probeTool(tools[i].name, tools[i].args, { cwd, deadlineAt: slotDeadline(deadlineAt), wantSig }, deps);
  // Main lane: pinned tools in toolList order, then the shared queue.
  for (const i of pinned) {
    if (Atomics.load(state, STOP) !== 0) break;
    try { results[i] = run(i); } catch (error) { if (stopsLanes(error)) Atomics.store(state, STOP, 1); failed.set(i, error); }
  }
  laneLoop(state, queue, run, local);

  // ACTIVE first: at zero every claimed slot is final, so the scan can only find a record not yet
  // collected (and loop back to drain), never miss one.
  const finished = () => {
    if (Atomics.load(state, ACTIVE) !== 0) return false;
    let done = 0;
    for (let j = 0; j < queue.length; j++) if (Atomics.load(state, HEADER + j) === 2) done++;
    return done === ranHere + received;
  };
  const ceilingAt = deadlineAt + GRACE_MS;
  for (;;) {
    const seq = Atomics.load(state, SEQ);
    drain();
    if (finished()) break;
    const wait = Math.min(50, ceilingAt - performance.now());
    if (wait <= 0) {
      Atomics.store(state, STOP, 1);
      let j = 0;
      while (j < queue.length && Atomics.load(state, HEADER + j) !== 1) j++;
      if (j < queue.length) failed.set(queue[j], Object.assign(new Error('Tool version probe did not finish'), { code: 'ETIMEDOUT', envCommand: tools[queue[j]].name }));
      break;
    }
    Atomics.wait(state, SEQ, seq, wait);
  }
  for (const port of ports) port.close();

  // Concurrent spawnSync on Windows lets a child inherit a sibling's stdio pipes, so a healthy tool
  // can time out for as long as that child lives, and a failure can stop lanes short of a lower
  // index. This sequential pass settles both, with the lanes done and the same deadline: in tool
  // order it keeps results, reports real failures and runs a timed-out or unreached tool alone.
  for (let i = 0; i < toolList.length; i++) {
    if (results[i] !== undefined) continue;
    const error = failed.get(i);
    if (error && stopsLanes(error)) throw error;
    // A retry that ends without a tool name (where.exe, the deadline) keeps the name the timeout held.
    try { results[i] = run(i); } catch (retry) { throw error && retry.code === 'ETIMEDOUT' && !retry.envCommand ? error : retry; }
  }
  return results;
}

module.exports = { probeTool, runToolProbes, probeConcurrency, laneLoop, plainRecord, errorFromPlain, slotDeadline };
