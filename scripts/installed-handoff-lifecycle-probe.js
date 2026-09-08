#!/usr/bin/env node
'use strict';

// Exercise the actual installed harness function with real, owned Node children.
// Only long timeout/output limits are shortened; production argv/env are observed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const vm = require('vm');
const assert = require('assert');
const { childDiagnostics } = require('./e2e-child-diagnostics');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-installed-lifecycle-'));
// An optional source path lets bugfix registration replay a frozen baseline.
const filename = path.resolve(process.argv[2] || path.join(__dirname, 'installed-cleanroom-probe.js'));
const source = fs.readFileSync(filename, 'utf8');
const anchor = 'function spawnHandoff(cli, sessionId) {';
assert.strictEqual(source.split(anchor).length, 2, 'unique handoff implementation');
const helper = source.slice(source.indexOf(anchor), source.indexOf('\nasync function main()'));
const results = [];
const children = [];
let failed = 0;
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok), detail });
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok ? ': ' + detail : ''}`);
};

function load(options = {}) {
  const calls = [];
  const launched = [];
  const observe = child => {
    const entry = { child, closed: false, errors: [] };
    children.push(entry);
    launched.push(entry);
    child.once('close', () => { entry.closed = true; });
    // A test observer prevents the baseline's unhandled error from crashing this
    // probe, but never resolves the implementation's missing completion handler.
    child.on('error', error => entry.errors.push(error.code));
    return child;
  };
  const intercepted = (kind, file, args, config, callback) => {
    calls.push({ kind, file, args, config });
    if (options.throwLaunch) throw Object.assign(new Error('controlled launch failure'), { code: 'EAGAIN' });
    const actualFile = options.missing ? path.join(arena, 'missing-node') : file;
    const actualConfig = { ...config };
    if (actualConfig.timeout) actualConfig.timeout = 750;
    if (actualConfig.maxBuffer) actualConfig.maxBuffer = 4096;
    return observe(kind === 'execFile'
      ? cp.execFile(actualFile, args, actualConfig, options.lateSuccess
        ? (...values) => setTimeout(() => callback(...values), 850) : callback)
      : cp.spawn(actualFile, args, actualConfig));
  };
  const context = {
    cp: {
      spawn: (...args) => intercepted('spawn', ...args),
      execFile: (...args) => intercepted('execFile', ...args),
    },
    process, project: arena, childDiagnostics,
    isolatedHandoffEnv: id => ({ ...process.env, LEERNESS_SESSION_ID: id }),
    setTimeout: (fn, delay) => setTimeout(fn, delay === 180000 ? 750 : delay),
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(helper + '\nthis.run = spawnHandoff;', context, { filename });
  return { run: context.run, calls, launched };
}

async function measure(label, script, options, predicate) {
  const harness = load(options);
  const childFile = path.join(arena, label + '.cjs');
  fs.writeFileSync(childFile, script);
  let timer;
  let value;
  try {
    value = await Promise.race([
      harness.run(childFile, label),
      new Promise(resolve => { timer = setTimeout(() => resolve({ probeDeadline: true }), 3000); }),
    ]);
  } catch (error) { value = { rejected: error.code || error.message }; }
  finally { clearTimeout(timer); }
  // Allow close observers to run after the native execFile callback.
  await new Promise(resolve => setImmediate(resolve));
  const directClosed = harness.launched.every(entry => entry.closed
    || (!entry.child.pid && entry.errors.includes('ENOENT')));
  check(label, predicate(value) && directClosed, JSON.stringify({ value, directClosed }));
  return { harness, value };
}

async function main() {
  const success = await measure('success', "console.log('handoff-ok');", {},
    r => r.status === 0 && !r.error && !r.timedOut && r.stdout.includes('handoff-ok'));
  const call = success.harness.calls[0];
  check('shell-free isolated handoff argv and environment', call.file === process.execPath
    && JSON.stringify(call.args.slice(1)) === JSON.stringify(['handoff', arena, '--quiet', '--no-drift-check'])
    && call.config.env.LEERNESS_SESSION_ID === 'success' && call.config.shell !== true);
  check('finite native deadline and output budget', call.config.timeout === 180000
    && call.config.killSignal === 'SIGKILL' && call.config.maxBuffer === 1024 * 1024);
  await measure('nonzero', "console.error('expected-failure');process.exitCode=7;", {},
    r => r.status === 7 && r.stderr.includes('expected-failure'));
  await measure('missing-executable', '', { missing: true },
    r => r.status === null && r.error?.code === 'ENOENT' && !r.probeDeadline);
  await measure('synchronous-launch-error', '', { throwLaunch: true },
    r => r.status === null && r.error?.code === 'EAGAIN' && !r.rejected);
  await measure('deadline', "setInterval(() => {}, 1000);", {},
    r => r.status !== 0 && r.timedOut === true && r.signal === 'SIGKILL');
  await measure('ignores-term', "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000);", {},
    r => r.timedOut === true && r.signal === 'SIGKILL' && r.stdout.includes('ready'));
  await measure('late-zero', "console.log('finished');", { lateSuccess: true },
    r => r.status === 0 && r.timedOut === true);
  await measure('stdout-overflow', "process.stdout.write('x'.repeat(16000));setInterval(() => {},1000);", {},
    r => r.error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && r.stdout.length <= 4096);
  await measure('stderr-overflow', "process.stderr.write('x'.repeat(16000));setInterval(() => {},1000);", {},
    r => r.error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && r.stderr.length <= 4096);

  const good = load();
  const bad = load({ throwLaunch: true });
  const slowFile = path.join(arena, 'parallel.cjs');
  fs.writeFileSync(slowFile, "setTimeout(() => console.log('parallel-done'), 100);");
  let mixed;
  let mixedTimer;
  try { mixed = await Promise.race([
    Promise.all([good.run(slowFile, 'a'), bad.run(slowFile, 'b'), good.run(slowFile, 'c')]),
    new Promise(resolve => { mixedTimer = setTimeout(() => resolve({ probeDeadline: true }), 3000); }),
  ]); }
  catch (error) { mixed = { rejected: error.code || error.message }; }
  finally { clearTimeout(mixedTimer); }
  await new Promise(resolve => setImmediate(resolve));
  check('parallel launch failure collects every sibling before returning', Array.isArray(mixed)
    && mixed.length === 3 && mixed[0].status === 0 && mixed[1].error?.code === 'EAGAIN'
    && mixed[2].status === 0 && good.launched.every(entry => entry.closed));
  await checkHandoffGate();
}

function checkWatchdog() {
  const mutant = path.join(arena, 'unsettled-handoff.cjs');
  fs.writeFileSync(mutant, source.replace(anchor,
    anchor + "\n  if (sessionId === 'c') return new Promise(() => {});"));
  const child = cp.spawnSync(process.execPath, [__filename, mutant, '--watchdog-child'], {
    encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
  check('unsettled parallel packet fails with final verdict', child.status === 1
    && !child.signal && !child.error
    && child.stdout.includes('FAIL parallel launch failure collects every sibling before returning')
    && child.stdout.includes('installed handoff lifecycle:'));
}

async function checkHandoffGate() {
  // Actual call-site statements, controlled result packets, and real owned record
  // files. These are predicate/retention controls, not additional live handoffs.
  const start = "  const sessionIds = ['cleanroom-codex-01'";
  const end = "  write(path.join(legacy, '.harness', 'HARNESS_VERSION')";
  assert.strictEqual(source.split(start).length, 2);
  assert.strictEqual(source.split(end).length, 2);
  const block = source.slice(source.indexOf(start), source.indexOf(end));
  const sessions = path.join(arena, '.leerness/cache/sessions');
  fs.mkdirSync(sessions, { recursive: true });
  for (const id of ['cleanroom-codex-01', 'cleanroom-claude-01', 'cleanroom-cursor-01', 'cleanroom-agent-04']) {
    fs.writeFileSync(path.join(sessions, id + '.json'), JSON.stringify({ sessionKey: id, handoffCount: 1, handoffHistory: [{}] }));
  }
  for (const [label, patch, expected] of [
    ['clean-success', {}, true],
    ['zero-with-timeout', { timedOut: true }, false],
    ['zero-with-error', { error: { code: 'EIO' } }, false],
    ['zero-with-signal', { signal: 'SIGKILL' }, false],
    ['nonzero-status', { status: 9 }, false],
  ]) {
    let passed;
    const context = { fs, path, project: arena, cli: 'controlled', process: { env: {} },
      PRESENCE_CONTROL_ENV: new Set(), childDiagnostics, preserveTempRoot: false,
      check: (_label, ok) => { passed = Boolean(ok); return passed; },
      spawnHandoff: async (_cli, id) => ({ sessionId: id, status: 0, stdout: '', stderr: '', ...patch }),
    };
    vm.createContext(context);
    await vm.runInContext('(async () => {\n' + block + '\n})()', context, { filename });
    check('result gate and evidence retention: ' + label,
      passed === expected && context.preserveTempRoot === !expected);
  }
  check('cleanup branch preserves failed handoff evidence', source.includes(
    'if (preserveTempRoot) process.stderr.write(`Retained installed handoff evidence: ${resolved}\\n`);\n    else fs.rmSync(resolved, { recursive: true, force: true });'));
}

(async () => {
  try {
    await main();
    if (process.argv[3] !== '--watchdog-child') checkWatchdog();
  }
  finally {
    // Exact handles created by this probe only; never enumerate/kill host processes.
    for (const entry of children) {
      if (entry.closed) continue;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('owned child did not close')), 5000);
        entry.child.once('close', () => { clearTimeout(timer); resolve(); });
        entry.child.kill('SIGKILL');
      });
    }
    check('all directly owned children observed closed', children.every(entry => entry.closed));
    fs.writeFileSync(path.join(arena, 'results.json'), JSON.stringify({ failed, total: results.length, results }, null, 2));
    console.log(`Evidence: ${arena}`);
  }
  console.log(`installed handoff lifecycle: ${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
