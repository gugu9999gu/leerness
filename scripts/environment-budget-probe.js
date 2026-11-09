'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { deadlineOptions } = require('../lib/process-deadline');
const { spawnPortableSync, resolvePortableLaunch } = require('../lib/portable-process');
const { spawnNpmSync } = require('../lib/npm-process');
const { probeConcurrency, plainRecord, errorFromPlain, probeTool } = require('../lib/env-tool-probe');
const cli = path.resolve(__dirname, '../bin/leerness.js');
const TOOLS = ['npm', 'pnpm', 'yarn', 'git', 'python', 'python3', 'pip', 'docker', 'gh', 'java', 'go', 'rustc', 'cargo', 'deno', 'bun', 'tsc', 'next', 'vite'];
const DEFAULT_PARALLEL = process.platform === 'win32';
// The pool defaults to Windows only and these cases have no POSIX run yet.
const PARALLEL_ONLY = { skip: process.platform === 'win32' ? false : 'parallel probes are verified on Windows only' };

test('deadline options preserve existing callers and reject expired or invalid deadlines', () => {
  assert.deepEqual(deadlineOptions({ timeout: 4000 }), { timeout: 4000 });
  for (const value of [NaN, Infinity, '100']) assert.throws(() => deadlineOptions({ deadlineAt: value }), TypeError);
  assert.throws(() => deadlineOptions({ deadlineAt: performance.now() - 1 }), { code: 'ETIMEDOUT' });
  const result = deadlineOptions({ deadlineAt: performance.now() + 500, timeout: 2000 });
  assert(result.timeout > 0 && result.timeout <= 500);
  assert.equal(result.killSignal, 'SIGKILL');
  assert.equal(result.deadlineAt, undefined);
});
test('portable process stops a real non-terminating probe within its deadline', () => {
  const started = performance.now();
  const result = spawnPortableSync(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    { deadlineAt: started + 250, timeout: 2000, encoding: 'utf8', maxBuffer: 1024 });
  assert.equal(result.error.code, 'ETIMEDOUT');
  assert(performance.now() - started < 2000);
});
test('an expired deadline starts no portable or npm process', () => {
  const original = cp.spawnSync;
  let count = 0;
  cp.spawnSync = function () { count++; return original.apply(this, arguments); };
  try {
    const options = { deadlineAt: performance.now() - 1 };
    assert.throws(() => spawnPortableSync(process.execPath, ['--version'], options), { code: 'ETIMEDOUT' });
    assert.throws(() => spawnNpmSync(['--version'], { ...options, npmCliPath: __filename }), { code: 'ETIMEDOUT' });
    assert.equal(count, 0);
  } finally { cp.spawnSync = original; }
});
test('Windows command-location timeouts remain unknown instead of becoming missing', { skip: process.platform !== 'win32' }, () => {
  const original = cp.spawnSync;
  cp.spawnSync = (file, args, options) => {
    assert.match(file, /System32[\\/]where\.exe$/i);
    assert(options.timeout <= 500 && options.timeout > 0);
    assert.equal(options.killSignal, 'SIGKILL');
    return { status: null, error: Object.assign(new Error('injected'), { code: 'ETIMEDOUT' }) };
  };
  try { assert.throws(() => resolvePortableLaunch('leerness-budget-fixture', { deadlineAt: performance.now() + 500 }), { code: 'ETIMEDOUT' }); }
  finally { cp.spawnSync = original; }
});
test('probe concurrency defaults to 4 on Windows, where only positive integers override it; other platforms stay at 1', () => {
  for (const raw of [undefined, '', '0', '-1', '1.5', 'abc', ' ', '04x']) assert.equal(probeConcurrency({ LEERNESS_ENV_PROBE_CONCURRENCY: raw }, 'win32'), 4, String(raw));
  assert.equal(probeConcurrency({ LEERNESS_ENV_PROBE_CONCURRENCY: '1' }, 'win32'), 1);
  assert.equal(probeConcurrency({ LEERNESS_ENV_PROBE_CONCURRENCY: ' 1 ' }, 'win32'), 1);
  assert.equal(probeConcurrency({ LEERNESS_ENV_PROBE_CONCURRENCY: '3' }, 'win32'), 3);
  assert.equal(probeConcurrency({ LEERNESS_ENV_PROBE_CONCURRENCY: '99' }, 'win32'), 4);
  for (const platform of ['linux', 'darwin']) {
    for (const raw of [undefined, '1', '3', '99']) assert.equal(probeConcurrency({ LEERNESS_ENV_PROBE_CONCURRENCY: raw }, platform), 1, String(raw));
  }
});
test('a worker failure keeps the code and command presence of the original error', () => {
  const cases = [
    Object.assign(new Error('Process observation deadline exceeded'), { code: 'ETIMEDOUT' }),
    Object.assign(new Error('where.exe timed out'), { code: 'ETIMEDOUT' }),
    Object.assign(new Error('spawnSync ENOBUFS'), { code: 'ENOBUFS', envCommand: 'pip' }),
    Object.assign(new Error('Tool version probe failed'), { code: 'E_TOOL_PROBE_FAILED', envCommand: 'gh' }),
    new Error('no code at all'),
  ];
  for (const error of cases) {
    const rebuilt = errorFromPlain(structuredClone(plainRecord({ i: 1, ok: false, error })));
    assert.equal(rebuilt.code, error.code, error.message);
    assert.equal(rebuilt.envCommand, error.envCommand, error.message);
    assert.equal('envCommand' in rebuilt, 'envCommand' in error, error.message);
  }
});
test('POSIX locator accepts status 0 and 1 and fails on anything else', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform'), original = cp.spawnSync;
  const deps = { spawnPortableSync: () => ({ status: 0, stdout: 'v1' }), spawnNpmSync: () => ({ status: 0, stdout: 'v1' }), resolveNpmCliPath: () => null };
  const probe = status => { cp.spawnSync = () => ({ status, stdout: status === 0 ? '/usr/bin/x' : '' }); return probeTool('x', ['--version'], { cwd: '.', deadlineAt: performance.now() + 1000 }, deps); };
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
  try {
    assert.equal(probe(0).toolPath, '/usr/bin/x');
    assert.equal(probe(1).toolPath, null);
    assert.throws(() => probe(2), /Command locator failed/);
  } finally { cp.spawnSync = original; Object.defineProperty(process, 'platform', platform); }
});

function fixture(fn) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-env-budget-'));
  try {
    const root = path.join(arena, 'target-é-한글'), cwd = path.join(arena, 'caller'), ws = path.join(root, '.leerness');
    fs.mkdirSync(ws, { recursive: true }); fs.mkdirSync(cwd);
    const version = require('../package.json').version;
    fs.writeFileSync(path.join(ws, 'HARNESS_VERSION'), version + '\n');
    fs.writeFileSync(path.join(ws, 'manifest.json'), JSON.stringify({ language: 'en', leernessVersion: version }));
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"budget-fixture"}');
    const snapshot = path.join(ws, 'environment.json');
    const source = JSON.stringify({ capturedAt: '2020-01-01T00:00:00.000Z', note: '사용자 원문', tools: { prior: { version: '1' } } }) + '\n';
    fs.writeFileSync(snapshot, source);
    const cache = path.join(arena, 'cache'); fs.mkdirSync(cache);
    const cacheFile = path.join(cache, 'env-tools.json'); fs.writeFileSync(cacheFile, '{"entries":{},"note":"preserve"}\n');
    const cacheSource = fs.readFileSync(cacheFile, 'utf8');
    const trace = path.join(arena, 'trace.jsonl'), preload = path.join(arena, 'probe.cjs');
    // Runs in the main thread and in every probe worker (preloads reach worker_threads).
    // Each version probe writes a start record before and an end record after its fake work.
    fs.writeFileSync(preload, String.raw`
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),{threadId}=require('node:worker_threads');
if(require('node:worker_threads').threadId!==0&&process.env.LEERNESS_BUDGET_FIXTURE_WORKER_CRASH)throw new Error('injected worker start failure');
if(process.env.LEERNESS_BUDGET_FIXTURE_WORKER_THROW)require('node:worker_threads').Worker=class{constructor(){throw new Error('injected worker construction failure');}};
if(process.env.LEERNESS_BUDGET_FIXTURE_MODE==='stdio'&&require('node:worker_threads').workerData?.sab){fs.appendFileSync(process.env.LEERNESS_BUDGET_FIXTURE_TRACE,JSON.stringify({kind:'noise'})+'\n');console.log('worker noise');console.error('worker noise');}
const mainLaneOnly=process.env.LEERNESS_ENV_PROBE_CONCURRENCY==='1'||process.env.LEERNESS_BUDGET_FIXTURE_WORKER_CRASH||process.env.LEERNESS_BUDGET_FIXTURE_WORKER_THROW;
const original=cp.spawnSync,mode=process.env.LEERNESS_BUDGET_FIXTURE_MODE,FOUND=['aggregate','parallel','inventory','ordering','ordering-git','stop','stdio','lane-death','settle','settle-hang','settle-real','settle-where'].includes(mode);
if(mode!=='real'){const portable=require(${JSON.stringify(path.resolve(__dirname, '../lib/portable-process'))});const spawn=portable.spawnPortableSync;portable.spawnPortableSync=(file,args,options)=>spawn(file,args,{...options,literalPathLookup:false});}
const now=()=>Number(process.hrtime.bigint()/1000n)/1000;let lastWhere=null;
const put=r=>fs.appendFileSync(process.env.LEERNESS_BUDGET_FIXTURE_TRACE,JSON.stringify({...r,tid:threadId})+'\n');
const sleep=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
if(process.env.LEERNESS_BUDGET_FIXTURE_NO_SAB==='1'){
  globalThis.SharedArrayBuffer=undefined;
  const concurrency=require(${JSON.stringify(path.resolve(__dirname, '../lib/env-tool-probe'))}).probeConcurrency;
  put({kind:'capability',sharedArrayBuffer:typeof SharedArrayBuffer,concurrency:concurrency(process.env),defaultConcurrency:concurrency({})});
}
cp.spawnSync=function(file,args,options={}) {
  if(mode==='real')return original.apply(this,arguments);
  const name=path.basename(String(file));
  if (/^where(?:\.exe)?$/i.test(name)) {
    const observed=FOUND && options.killSignal==='SIGKILL';lastWhere=String(args[0]);
    put({kind:'where',tool:lastWhere,at:now(),timeout:options.timeout,killSignal:options.killSignal,file:String(file),upperPath:typeof process.env.PATH});
    if(mode==='settle-where'&&threadId===0&&lastWhere==='pnpm')return {status:null,error:Object.assign(new Error('held'),{code:'ETIMEDOUT'}),stdout:'',stderr:''};
    return {status:observed?0:1,stdout:observed?process.execPath+'\n':'',stderr:''};
  }
  if (name==='which') return {status:0,stdout:process.execPath+'\n',stderr:''};
  if (args && ['--version','-version','version'].includes(args[args.length-1])) {
    const npm=args.some(a=>/npm-cli\.[cm]?js$/i.test(a)) || /^npm(?:\.cmd)?$/i.test(name);
    const tool=npm?'npm':process.platform==='win32'?lastWhere:name.replace(/\.(exe|cmd)$/i,'');
    if(mode==='lane-death'&&tool==='pip'&&threadId!==0)process.exit(0);
    const start=now();
    put({kind:'version',phase:'start',tool,start,cwd:options.cwd,timeout:options.timeout,killSignal:options.killSignal,maxBuffer:options.maxBuffer,npm});
    const end=r=>{put({kind:'version',phase:'end',tool,start,end:now()});return r;};
    if(mode==='aggregate') {
      const wait=Math.min(900,options.timeout||900);
      sleep(wait);
      if(wait<900) return end({status:null,error:Object.assign(new Error('deadline'),{code:'ETIMEDOUT'}),stdout:'',stderr:''});
      return end({status:0,stdout:'1.0.0\n',stderr:''});
    }
    // parallel: 1500 ms of work; a child given less than 1600 ms runs into its timeout, so a successful probe
    // always returns at least 100 ms before its own deadline (its follow-up deadline check cannot fail).
    if(mode==='parallel') {
      if((options.timeout||0)<1600) { sleep(options.timeout);return end({status:null,error:Object.assign(new Error('deadline'),{code:'ETIMEDOUT'}),stdout:'',stderr:''}); }
      sleep(1500);return end({status:0,stdout:'1.0.0\n',stderr:''});
    }
    // inventory: npm holds the main lane while workers boot; vite (last in the queue) is still running after the main lane is empty.
    // The delays only shape parallel lanes, so a run that stays on the main lane does not spend the real 5 s budget on them.
    if(mode==='inventory') { if(!mainLaneOnly)sleep(tool==='npm'?700:tool==='vite'?800:(tool.length*37)%60);return end({status:0,stdout:tool+'-fixture-version\n',stderr:''}); }
    // ordering: docker (index 7) fails first, pnpm (1) next, python (4) last; FIFO claims start all three before the stop.
    if(mode==='ordering') {
      sleep(tool==='npm'?300:tool==='pnpm'?600:tool==='python'?900:tool==='docker'?0:10);
      return end(['pnpm','python','docker'].includes(tool)?{status:42,stdout:'',stderr:'raw '+tool}:{status:0,stdout:tool+'-ok\n',stderr:''});
    }
    // ordering-git: python (4) fails in a worker while npm still holds the main lane; a sequential run reaches git (3) first.
    if(mode==='ordering-git') {
      sleep(tool==='npm'?500:0);
      return end(['git','python'].includes(tool)?{status:42,stdout:'',stderr:'raw '+tool}:{status:0,stdout:tool+'-ok\n',stderr:''});
    }
    if(mode==='stop'){const fail=process.env.LEERNESS_BUDGET_FIXTURE_FAIL;sleep(tool==='npm'&&fail!=='npm'?500:0);return end(tool===fail?{status:42,stdout:'',stderr:''}:{status:0,stdout:tool+'-ok\n',stderr:''});}
    if(mode==='lane-death'||mode==='stdio'){sleep(tool==='npm'?500:0);return end({status:0,stdout:tool+'-ok\n',stderr:''});}
    // settle: pnpm times out only in a worker, as a held pipe makes it; settle-hang: it times out anywhere;
    // settle-real: alone it fails for real; settle-where: alone its where.exe times out (see the lookup stub).
    if(['settle','settle-hang','settle-real','settle-where'].includes(mode)) {
      sleep(tool==='npm'?400:0);
      if(mode==='settle-real'&&tool==='pnpm'&&threadId===0)return end({status:42,stdout:'',stderr:''});
      if(tool==='pnpm'&&(threadId!==0||mode==='settle-hang'))return end({status:null,error:Object.assign(new Error('held'),{code:'ETIMEDOUT'}),stdout:'',stderr:''});
      return end({status:0,stdout:tool+'-ok\n',stderr:''});
    }
    if(mode==='missing'&&npm)sleep(700);
    if(!npm)return end({status:null,error:{code:'ENOENT'},stdout:'',stderr:''});
    if(mode==='timeout')return end(original(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],options));
    if(mode==='overflow')return end(original(process.execPath,['-e',"process.stdout.write('x'.repeat(1024*1024))"],options));
    if(mode==='nonzero')return end({status:42,stdout:'',stderr:'do not expose raw tool output'});
    return end({status:0,stdout:options.cwd===process.env.LEERNESS_BUDGET_FIXTURE_ROOT?'target-version\n':'wrong-project-version\n',stderr:''});
  }
  return original.apply(this,arguments);
};
`);
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^(LEERNESS_|NODE_OPTIONS)/i.test(key)) delete env[key];
    // The where.exe stub answers with process.execPath, and lookups keep only candidates from PATH folders.
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
    env[pathKey] = [path.dirname(process.execPath), env[pathKey]].filter(Boolean).join(path.delimiter);
    Object.assign(env, { LEERNESS_CACHE_DIR: cache, LEERNESS_BUDGET_FIXTURE_TRACE: trace, LEERNESS_BUDGET_FIXTURE_ROOT: root,
      LEERNESS_NO_PROMPT: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1' });
    const run = (mode, extra = [], extraEnv = {}, nodeArgs = []) => {
      fs.writeFileSync(trace, '');
      const started = performance.now();
      const result = cp.spawnSync(process.execPath, [...nodeArgs, '--require', preload, cli, 'env', 'detect', root, '--json', ...extra],
        { cwd, env: typeof extraEnv === 'function' ? extraEnv({ ...env, LEERNESS_BUDGET_FIXTURE_MODE: mode }) : { ...env, LEERNESS_BUDGET_FIXTURE_MODE: mode, ...extraEnv }, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
      const elapsed = performance.now() - started;
      assert.equal(result.error, undefined, result.stderr);
      assert(result.stdout.trim(), `environment fixture produced no JSON: status=${result.status}, signal=${result.signal}, stderr=${result.stderr}`);
      const records = fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      const probes = records.filter(r => r.kind === 'version' && r.phase === 'start');
      const ends = records.filter(r => r.kind === 'version' && r.phase === 'end');
      // Every started probe finished before the CLI exited: failures wait for running probes.
      assert.equal(ends.length, probes.length, 'a probe was still running when the CLI exited');
      return { ...result, elapsed, report: JSON.parse(result.stdout), probes, ends, wheres: records.filter(r => r.kind === 'where'), noise: records.filter(r => r.kind === 'noise').length };
    };
    return fn({ run, snapshot, source, cacheFile, cacheSource, root, arena });
  } finally { fs.rmSync(arena, { recursive: true, force: true }); }
}
function preserved(f) {
  assert.equal(fs.readFileSync(f.snapshot, 'utf8'), f.source);
  assert.equal(fs.readFileSync(f.cacheFile, 'utf8'), f.cacheSource);
}
// Control: on the default Windows path the where.exe stub was reached from worker threads, so the
// parallel lanes ran with the test seam in place (not real tools behind it).
function workersIntercepted(result) {
  if (DEFAULT_PARALLEL) assert(result.wheres.some(w => w.tid !== 0), 'no where.exe lookup came from a probe worker');
}
function peakOverlap(ends) {
  const edges = ends.flatMap(e => [[e.start, 1], [e.end, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let live = 0, peak = 0; for (const [, d] of edges) { live += d; peak = Math.max(peak, live); }
  return peak;
}
for (const mode of ['timeout', 'overflow', 'nonzero']) {
  test(`explicit ${mode} leaves the previous snapshot/cache intact and reports unknown`, () => fixture(f => {
    const result = f.run(mode);
    assert.equal(result.status, 1);
    assert.equal(result.report.ok, false);
    assert.equal(result.report.inspection.complete, false);
    assert.equal(result.report.inspection.status, 'unknown');
    assert.equal(result.report.code, mode === 'timeout' ? 'E_ENV_PROBE_TIMEOUT' : 'E_ENV_PROBE_INCOMPLETE');
    assert.equal(result.report.inspection.command, 'npm');
    // On the parallel path a timeout is only believed once the tool has also timed out alone.
    assert.equal(result.probes.length, mode === 'timeout' && DEFAULT_PARALLEL ? 2 : 1);
    for (const p of result.probes) {
      assert(p.timeout <= 2000);
      assert.equal(p.killSignal, 'SIGKILL');
      assert.equal(p.maxBuffer, 64 * 1024);
    }
    assert(result.elapsed < (mode === 'timeout' && DEFAULT_PARALLEL ? 8000 : 6000), String(result.elapsed));
    assert.doesNotMatch(result.stdout, /do not expose raw tool output/);
    // npm holds the main lane for its whole 2 s timeout, so the other probes ran in workers.
    if (mode === 'timeout') workersIntercepted(result);
    preserved(f);
  }));
}
test('a sequential timeout probes the tool once', () => fixture(f => {
  const result = f.run('timeout', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: '1' });
  assert.equal(result.status, 1);
  assert.equal(result.report.code, 'E_ENV_PROBE_TIMEOUT');
  assert.equal(result.report.inspection.command, 'npm');
  assert.equal(result.probes.length, 1);
}));
test('sequential aggregate deadline stops remaining probes instead of paying a full timeout for every tool', () => fixture(f => {
  const result = f.run('aggregate', [], { LEERNESS_ENV_PROBE_CONCURRENCY: '1' });
  assert.equal(result.status, 1);
  assert.equal(result.report.code, 'E_ENV_PROBE_TIMEOUT');
  assert(result.probes.length > 1 && result.probes.length <= 6);
  assert(result.probes.every(p => p.tid === result.probes[0].tid), 'concurrency 1 must not use probe workers');
  assert(result.elapsed < 8000);
  assert(result.report.inspection.elapsedMs >= 4900 && result.report.inspection.elapsedMs < 6500);
  preserved(f);
}));
test('parallel aggregate deadline: no probe starts after the deadline and each child timeout fits the remaining budget', PARALLEL_ONLY, () => fixture(f => {
  const result = f.run('parallel', [], { LEERNESS_ENV_PROBE_CONCURRENCY: '4' });
  assert.equal(result.status, 1);
  assert.equal(result.report.code, 'E_ENV_PROBE_TIMEOUT');
  assert.equal(result.report.inspection.status, 'unknown');
  assert.equal(result.report.inspection.complete, false);
  assert(result.probes.length >= 2 && result.probes.length <= TOOLS.length);
  // The 5 s budget starts before the first budgeted child, so every budgeted child (version probe or
  // where.exe lookup) must be started with start + timeout inside first + 5000.
  const budgeted = [...result.probes.map(p => ({ at: p.start, timeout: p.timeout, p })), ...result.wheres.filter(w => w.killSignal === 'SIGKILL').map(w => ({ at: w.at, timeout: w.timeout, p: w }))];
  const first = Math.min(...budgeted.map(b => b.at));
  for (const p of result.probes) {
    assert.equal(p.killSignal, 'SIGKILL'); assert.equal(p.maxBuffer, 64 * 1024); assert.equal(p.cwd, f.root);
    assert(p.timeout >= 1 && p.timeout <= 2000, JSON.stringify(p));
  }
  for (const b of budgeted) assert(b.timeout >= 1 && b.at + b.timeout <= first + 5000 + 2, JSON.stringify({ b, first }));
  for (const w of result.wheres.filter(x => x.killSignal === 'SIGKILL')) assert(w.timeout <= 2000, JSON.stringify(w));
  // Parallel lanes overlapped, never more than the configured four.
  const peak = peakOverlap(result.ends);
  assert(peak >= 2 && peak <= 4, 'peak concurrency ' + peak);
  assert(result.probes.some(p => p.tool === 'npm' && p.tid === 0), 'npm must run on the main thread');
  assert(result.probes.some(p => p.tid !== 0), 'no probe ran in a worker');
  assert(result.probes.some(p => p.tid === 0 && !['npm', 'git'].includes(p.tool)), 'the main lane did not join the queue');
  // The reported command is the lowest-index failure: a timed-out probe, or null for a deadline check
  // on a tool that never reached its version probe.
  const index = name => TOOLS.indexOf(name);
  const timedOut = result.probes.filter(p => p.timeout < 1600).map(p => index(p.tool));
  const unstarted = TOOLS.map((t, i) => i).filter(i => !result.probes.some(p => index(p.tool) === i));
  const command = result.report.inspection.command;
  if (command === null) assert(unstarted.length && Math.min(...unstarted) < Math.min(Infinity, ...timedOut), JSON.stringify({ timedOut, unstarted }));
  else assert.equal(index(command), Math.min(...timedOut), JSON.stringify({ command, timedOut }));
  assert(result.report.inspection.elapsedMs >= 4900 && result.report.inspection.elapsedMs < 6500, String(result.report.inspection.elapsedMs));
  assert(result.elapsed < 9000);
  preserved(f);
}));
test('parallel and sequential discovery publish the same snapshot in tool order', PARALLEL_ONLY, () => fixture(f => {
  const runs = ['1', '4'].map(k => f.run('inventory', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: k }));
  for (const r of runs) assert.equal(r.status, 0, r.stdout + r.stderr);
  const [seq, par] = runs.map(r => r.report.snapshot.tools);
  assert.deepEqual(Object.keys(seq), TOOLS);
  assert.equal(JSON.stringify(par), JSON.stringify(seq));
  for (const t of TOOLS) assert.equal(seq[t].version, t + '-fixture-version');
  assert.equal(new Set(runs[0].probes.map(p => p.tid)).size, 1, 'concurrency 1 used more than one lane');
  assert(new Set(runs[1].probes.map(p => p.tid)).size > 1, 'concurrency 4 used one lane');
  for (const t of TOOLS) { assert.equal(runs[1].probes.filter(p => p.tool === t).length, 1, t); if (!['npm', 'git'].includes(t)) assert.equal(runs[1].wheres.filter(w => w.tool === t).length, 1, t); }
  const vite = runs[1].ends.find(e => e.tool === 'vite'), npm = runs[1].ends.find(e => e.tool === 'npm');
  assert(vite.tid !== 0 && vite.end > npm.end, 'setup: vite must outlive the main lane in a worker');
  preserved(f);
}));
test('the lowest-index failure is reported regardless of completion order, as in a sequential run', PARALLEL_ONLY, () => fixture(f => {
  const runs = ['1', '4'].map(k => f.run('ordering', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: k }));
  for (const r of runs) {
    assert.equal(r.status, 1);
    assert.equal(r.report.code, 'E_ENV_PROBE_INCOMPLETE');
    assert.equal(r.report.inspection.reason, 'E_TOOL_PROBE_FAILED');
    assert.equal(r.report.inspection.command, 'pnpm');
    assert.doesNotMatch(r.stdout, /raw (pnpm|python|docker)/);
  }
  const ends = runs[1].ends.filter(e => ['pnpm', 'python', 'docker'].includes(e.tool)).sort((a, b) => a.end - b.end).map(e => e.tool);
  assert.deepEqual(ends, ['docker', 'pnpm', 'python'], 'setup: failures must complete out of index order');
  // FIFO claims: the started worker-queue tools form a prefix of the queue order.
  const queue = TOOLS.filter(t => !['npm', 'git'].includes(t));
  const started = new Set(runs[1].probes.map(p => p.tool));
  const last = Math.max(...queue.map((t, i) => (started.has(t) ? i : -1)));
  assert(queue.slice(0, last + 1).every(t => started.has(t)), 'claims skipped a queued tool');
  preserved(f);
}));
test('a worker failure above a pinned tool does not skip it: git is reported as in a sequential run', PARALLEL_ONLY, () => fixture(f => {
  const runs = ['1', '4'].map(k => f.run('ordering-git', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: k }));
  for (const r of runs) {
    assert.equal(r.status, 1);
    assert.equal(r.report.inspection.reason, 'E_TOOL_PROBE_FAILED');
    assert.equal(r.report.inspection.command, 'git', JSON.stringify(r.report.inspection));
  }
  const python = runs[1].ends.find(e => e.tool === 'python'), git = runs[1].ends.find(e => e.tool === 'git');
  assert(python.tid !== 0 && git.tid === 0 && python.end < git.start, 'setup: python must fail in a worker before git starts on the main lane');
  preserved(f);
}));
test('a real failure leaves the pinned tools and the end of the queue unstarted', PARALLEL_ONLY, () => fixture(f => {
  const started = fail => { const r = f.run('stop', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: '4', LEERNESS_BUDGET_FIXTURE_FAIL: fail }); assert.equal(r.report.inspection.command, fail); return r.probes.map(p => p.tool); };
  const afterWorker = started('pnpm');
  assert(!afterWorker.includes('git') && !afterWorker.includes('vite'), afterWorker.join());
  assert(!started('npm').includes('vite'));
}));
test('a tool that timed out next to others is settled alone and the run succeeds', PARALLEL_ONLY, () => fixture(f => {
  const result = f.run('settle', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: '4' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.snapshot.tools.pnpm.version, 'pnpm-ok');
  const pnpm = result.probes.filter(p => p.tool === 'pnpm');
  assert.equal(pnpm.length, 2);
  assert(pnpm[0].tid !== 0 && pnpm[1].tid === 0, 'setup: the timeout must come from a worker lane');
  assert(result.ends.filter(e => e.start !== pnpm[1].start).every(e => e.end <= pnpm[1].start), 'the second attempt overlapped another probe');
  for (const t of TOOLS.filter(name => name !== 'pnpm')) assert.equal(result.probes.filter(p => p.tool === t).length, 1, t);
  preserved(f);
}));
test('a tool that also times out alone is the one reported', PARALLEL_ONLY, () => fixture(f => {
  const result = f.run('settle-hang', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: '4' });
  assert.equal(result.status, 1);
  assert.equal(result.report.code, 'E_ENV_PROBE_TIMEOUT');
  assert.equal(result.report.inspection.command, 'pnpm');
  assert.equal(result.probes.filter(p => p.tool === 'pnpm').length, 2);
  // A timeout stops no lane: the tools behind it still finished before the tool was retried.
  assert(result.probes.some(p => p.tool === 'vite'), 'the timeout stopped the other lanes');
  preserved(f);
}));
test('a timed-out tool that fails for real alone reports that failure, not the timeout', PARALLEL_ONLY, () => fixture(f => {
  const r = f.run('settle-real', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: '4' });
  assert.equal(r.status, 1);
  assert.equal(r.report.code, 'E_ENV_PROBE_INCOMPLETE');
  assert.equal(r.report.inspection.reason, 'E_TOOL_PROBE_FAILED');
  assert.equal(r.report.inspection.command, 'pnpm');
  const pnpm = r.probes.filter(p => p.tool === 'pnpm');
  assert.equal(pnpm.length, 2);
  assert(pnpm[0].tid !== 0 && pnpm[1].tid === 0, 'setup: the timeout must come from a worker lane');
  preserved(f);
}));
test('a retry cut off before it reaches the tool keeps the name the timeout held', PARALLEL_ONLY, () => fixture(f => {
  const r = f.run('settle-where', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: '4' });
  assert.equal(r.status, 1);
  assert.equal(r.report.code, 'E_ENV_PROBE_TIMEOUT');
  assert.equal(r.report.inspection.command, 'pnpm');
  assert.equal(r.wheres.filter(w => w.tool === 'pnpm' && w.tid === 0).length, 1, 'setup: the retry must reach where.exe');
  assert.equal(r.probes.filter(p => p.tool === 'pnpm').length, 1, 'setup: the first attempt must time out in a worker');
  preserved(f);
}));
test('a tool that is not on PATH is looked up once: the settling pass keeps a missing result', PARALLEL_ONLY, () => fixture(f => {
  const result = f.run('missing', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: '4' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const t of TOOLS.filter(name => !['npm', 'git'].includes(name))) assert.equal(result.wheres.filter(w => w.tool === t).length, 1, t);
  workersIntercepted(result);
}));
test('a lower concurrency setting limits the overlapping probes', PARALLEL_ONLY, () => fixture(f => {
  const result = f.run('inventory', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: '2' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(peakOverlap(result.ends), 2);
}));
test('worker output reaches neither stream', PARALLEL_ONLY, () => fixture(f => {
  const result = f.run('stdio', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: '4' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  workersIntercepted(result);
  assert(result.noise >= 1, 'setup: no probe worker printed');
  assert.doesNotMatch(result.stdout + result.stderr, /worker noise/);
}));
test('a lane that dies inside a probe ends the run at the ceiling as unknown', PARALLEL_ONLY, () => fixture(f => {
  const r = f.run('lane-death', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: '4' });
  assert.equal(r.status, 1);
  assert.equal(r.report.code, 'E_ENV_PROBE_TIMEOUT');
  assert.equal(r.report.inspection.command, 'pip');
  // The ceiling is the 5 s budget plus the 1 s grace.
  assert(r.report.inspection.elapsedMs >= 5900 && r.report.inspection.elapsedMs < 6900, String(r.report.inspection.elapsedMs));
  preserved(f);
}));
test('a runtime without SharedArrayBuffer stays on the sequential path', PARALLEL_ONLY, () => fixture(f => {
  const result = f.run('success', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: '4', LEERNESS_BUDGET_FIXTURE_NO_SAB: '1' });
  const capability=fs.readFileSync(path.join(f.arena,'trace.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(r=>r.kind==='capability'&&r.tid===0);
  assert.equal(capability.length,1);
  assert.deepEqual(capability[0],{kind:'capability',sharedArrayBuffer:'undefined',concurrency:4,defaultConcurrency:4,tid:0});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.snapshot.tools.npm.version, 'target-version');
  assert(result.wheres.length && result.wheres.every(w => w.tid === 0), 'a probe worker ran');
  preserved(f);
}));
// Real children and the real where.exe: the fake spawnSync above cannot show one lane's child
// holding another lane's pipes. npm stays on the main lane, the other three run in workers.
function realTools(f, python) {
  const dir = path.join(f.arena, 'tools'); fs.mkdirSync(dir);
  for (const t of ['pnpm', 'yarn', 'python']) {
    fs.writeFileSync(path.join(dir, t + '.cmd'), `@ECHO off\r\n"%dp0%\\${t}.js" %*\r\n`);
    fs.writeFileSync(path.join(dir, t + '.js'), t === 'python' ? python : `console.log('${t}-1.0.0');\n`);
  }
  fs.writeFileSync(path.join(dir, 'npm-cli.js'), "console.log('npm-1.0.0');\n");
  return env => {
    const out = {};
    for (const [key, value] of Object.entries(env)) if (!/^(path|npm_.*)$/i.test(key)) out[key] = value;
    return { ...out, PATH: [dir, path.dirname(process.execPath)].join(path.delimiter),
      npm_execpath: path.join(dir, 'npm-cli.js'), LEERNESS_ENV_PROBE_CONCURRENCY: '4' };
  };
}
test('a healthy tool that leaves a background helper fails no sibling (real children)', PARALLEL_ONLY, () => fixture(f => {
  const pids = path.join(f.arena, 'helpers.txt');
  const helper = `const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},8000)'],{stdio:'ignore',detached:true,windowsHide:true,cwd:require('os').tmpdir()});
require('fs').appendFileSync(${JSON.stringify(pids)},c.pid+'\\n');c.unref();console.log('python-1.0.0');\n`;
  try {
    const result = f.run('real', ['--no-write'], realTools(f, helper));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const t of ['npm', 'pnpm', 'yarn', 'python']) assert.equal(result.report.snapshot.tools[t].version, t + '-1.0.0');
  } finally {
    for (const pid of fs.existsSync(pids) ? fs.readFileSync(pids, 'utf8').trim().split('\n') : []) { try { process.kill(Number(pid)); } catch {} }
  }
}));
test('a hung tool is the one reported, not the healthy sibling it held (real children)', PARALLEL_ONLY, () => fixture(f => {
  const result = f.run('real', ['--no-write'], realTools(f, 'setInterval(()=>{},1000);\n'));
  assert.equal(result.status, 1);
  assert.equal(result.report.code, 'E_ENV_PROBE_TIMEOUT');
  // Only a budget that ran out first may report another tool.
  const { command, elapsedMs } = result.report.inspection;
  if (elapsedMs < 4900) assert.equal(command, 'python');
  else assert(['pnpm', 'yarn', 'python', null].includes(command), String(command));
}));
test('workers see a mixed-case Windows environment the way the main thread does', PARALLEL_ONLY, () => fixture(f => {
  const mixed = env => {
    const out = {}, names = { PATH: 'pAtH', SYSTEMROOT: 'sYsTeMrOoT', PATHEXT: 'pAtHeXt', WINDIR: 'wInDiR' };
    for (const [key, value] of Object.entries(env)) out[names[key.toUpperCase()] || key] = value;
    return { ...out, LEERNESS_ENV_PROBE_CONCURRENCY: '4' };
  };
  const seq = f.run('inventory', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: '1' });
  const par = f.run('inventory', ['--no-write'], mixed);
  assert.equal(par.status, 0, par.stdout + par.stderr);
  assert.equal(JSON.stringify(par.report.snapshot.tools), JSON.stringify(seq.report.snapshot.tools));
  const lookups = par.wheres.filter(w => w.tid !== 0);
  assert(lookups.length, 'no where.exe lookup came from a probe worker');
  for (const w of lookups) {
    assert.equal(w.upperPath, 'undefined', 'setup: the worker must hold a case-sensitive copy without PATH');
    assert.match(w.file, /System32[\\/]where\.exe$/i);
  }
  preserved(f);
}));
test('probe workers that fail to start leave the result, exit code and stderr unchanged', PARALLEL_ONLY, () => fixture(f => {
  const seq = f.run('inventory', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: '1' });
  const broken = f.run('inventory', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: '4', LEERNESS_BUDGET_FIXTURE_WORKER_CRASH: '1' });
  assert.equal(broken.status, 0, broken.stdout + broken.stderr);
  assert.equal(broken.stderr, '');
  assert.equal(JSON.stringify(broken.report.snapshot.tools), JSON.stringify(seq.report.snapshot.tools));
  assert(broken.probes.every(p => p.tid === 0), 'setup: worker lanes must not have run');
  preserved(f);
}));
test('a Worker constructor that throws falls back to the sequential path without a trace', PARALLEL_ONLY, () => fixture(f => {
  const seq = f.run('inventory', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: '1' });
  const broken = f.run('inventory', ['--no-write'], { LEERNESS_ENV_PROBE_CONCURRENCY: '4', LEERNESS_BUDGET_FIXTURE_WORKER_THROW: '1' });
  assert.equal(broken.status, 0, broken.stdout + broken.stderr);
  assert.equal(broken.stderr, '');
  assert.equal(JSON.stringify(broken.report.snapshot.tools), JSON.stringify(seq.report.snapshot.tools));
  assert(broken.probes.every(p => p.tid === 0), 'setup: no worker may have run');
}));
test('an explicit refresh probes the selected project, not the caller working directory', () => fixture(f => {
  const result = f.run('success');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.persisted, true);
  assert.equal(result.report.snapshot.tools.npm.version, 'target-version');
  assert(result.probes.every(p => p.cwd === f.root));
  const saved = JSON.parse(fs.readFileSync(f.snapshot, 'utf8'));
  assert.equal(saved.note, '사용자 원문');
  assert.equal(saved.tools.npm.version, 'target-version');
}));
test('no-write refresh failure never creates a missing environment snapshot', () => fixture(f => {
  fs.unlinkSync(f.snapshot);
  const result = f.run('timeout', ['--no-write']);
  assert.equal(result.status, 1);
  assert.equal(result.report.inspection.status, 'unknown');
  assert.equal(fs.existsSync(f.snapshot), false);
  assert.equal(fs.readFileSync(f.cacheFile, 'utf8'), f.cacheSource);
}));
