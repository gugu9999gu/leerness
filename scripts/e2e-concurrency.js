 
 
'use strict';
require('./temp-cleanup').trackTemp(module);  

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CLI = path.resolve(process.argv[2] || path.join(__dirname, '..', 'bin', 'leerness.js'));
const PRELOAD = path.join(__dirname, 'lock-probe.js');
const { overlapOf } = require('./race-overlap');
const { stopTestProcessTree } = require('../lib/test-process-tree');
const { childDiagnostics, childExitMatches } = require('./e2e-child-diagnostics');
const { performance } = require('node:perf_hooks');
const ENV = {
  ...process.env,
  LEERNESS_OFFLINE: '1',
  LEERNESS_NO_PROMPT: '1',
  LEERNESS_NO_LOCK_WARN: '1'
};
const STALL_MS = 1200;

const nap = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function watchChild(child, { timeoutMs = 60000, shutdownMs = 5000, stop = stopTestProcessTree } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || !Number.isFinite(shutdownMs) || shutdownMs < 1) {
    throw new TypeError('Child deadlines must be positive finite numbers');
  }
  const started = performance.now();
  const result = { status: null, signal: null, error: null, timedOut: false, cancelled: false,
    closed: false, timeoutMs, elapsedMs: null, stopError: null };
  let settled = false, timer, shutdown, resolve;
  const done = new Promise(r => { resolve = r; });
  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer); clearTimeout(shutdown);
    result.elapsedMs = Math.round(performance.now() - started);
    resolve({ ...result });
  };
  const cancel = reason => {
    if (settled || result.closed || result.cancelled) return;
    result.cancelled = true;
    result.timedOut = reason === 'timeout';
    shutdown = setTimeout(() => {
      if (!result.closed && typeof child.unref === 'function') child.unref();
      finish();
    }, shutdownMs);
    try { stop(child); } catch (error) { result.stopError = String(error && error.message || error); }
  };
  child.on('error', error => {
    result.error = { code: error && error.code || null, message: String(error && error.message || error) };
  });
  child.once('close', (status, signal) => {
    result.status = status; result.signal = signal || null; result.closed = true; finish();
  });
  timer = setTimeout(() => cancel('timeout'), timeoutMs);
  return { child, done, cancel, get closed() { return result.closed; } };
}

function childPassed(result, expected = 0) {
  return result.closed === true && !result.timedOut && !result.cancelled && !result.error
    && !result.signal && Number.isInteger(result.status) && result.status === expected;
}

function trace(event, name, data = {}) {
  process.stderr.write(JSON.stringify({ event, name, ...data }) + '\n');
}

function run(d, args) {
  const started = performance.now();
  const r = cp.spawnSync(process.execPath, [CLI, ...args, '--path', d],
    { cwd: d, env: ENV, encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL' });
  if (!childExitMatches(r)) throw new Error(args.slice(0, 3).join(' ') + ' setup ' + JSON.stringify(childDiagnostics(r, performance.now() - started, 60000)));
  return r;
}

function init(d) {
  const started = performance.now();
  const r = cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--minimal'],
    { cwd: d, env: ENV, encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL' });
  if (!childExitMatches(r)) throw new Error('init ' + JSON.stringify(childDiagnostics(r, performance.now() - started, 60000)));
}

 
 
 
const readyFileOf = d => path.join(d, '.stall-ready.json');
 
 
 
 
const reachFileOf = d => path.join(d, '.stall-reached.json');

 
 
function spawn(d, args, role, target) {
  const nodeArgs = ['--require', PRELOAD, CLI, ...args, '--path', d];
  const env = role === 'first'
    ? { ...ENV, LOCKPROBE_STALL_TARGET: target, LOCKPROBE_STALL_MS: String(STALL_MS), LOCKPROBE_READY_FILE: readyFileOf(d), LOCKPROBE_WAIT_FILE: reachFileOf(d) }
    : { ...ENV, LOCKPROBE_REACH_TARGET: target, LOCKPROBE_REACH_FILE: reachFileOf(d), LOCKPROBE_REACH_LOCKS_FILE: readyFileOf(d) };
  return watchChild(cp.spawn(process.execPath, nodeArgs, { cwd: d, env, stdio: 'ignore',
    windowsHide: true, detached: process.platform !== 'win32' }));
}
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function waitForStall(d, target) {
   
   
  const normalized = path.isAbsolute(target) ? path.resolve(target).replace(/\\/g, '/') : target.replace(/\\/g, '/').replace(/^\.?\/+/, '');
  for (let i = 0; i < 800; i++) {
    try { if (JSON.parse(fs.readFileSync(readyFileOf(d), 'utf8')).target === normalized) return true; } catch {}
    nap(10);
  }
  return false;
}

async function race(name, config) {
  const started = performance.now(), children = [];
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-t0115-race-'));
  let result;
  trace('case-start', name);
  try {
    init(d);
    if (config.seed) config.seed(d);
    const stallTarget = typeof config.stallTarget === 'function' ? config.stallTarget(d) : config.stallTarget;
    const first = spawn(d, config.first, 'first', stallTarget); children.push(first);
    const stalled = waitForStall(d, stallTarget);
    trace('stall', name, { stalled, elapsedMs: Math.round(performance.now() - started) });
    if (config.beforeSecond) config.beforeSecond(d);
    const second = spawn(d, typeof config.second === 'function' ? config.second(d) : config.second, 'second', stallTarget);
    children.push(second);
    const observations = await Promise.all(children.map(child => child.done));
    const exits = observations.map(child => child.status);
    trace('children-finished', name, { children: observations });
    const ready = readJson(readyFileOf(d)) || {}, reach = readJson(reachFileOf(d));
    const { overlapped, why } = overlapOf({ stalled, ready, reach });
    const inspected = observations.every(child => child.closed) ? config.inspect(d) : { preserved: false };
    const secondExit = config.secondExit === undefined ? 0 : config.secondExit;
    result = { name, stalled, overlapped, why, read: reach && reach.read && reach.read.how, lock: reach && reach.lock && reach.lock.result,
      waitedMs: ready.waitedMs, exits, ...inspected, children: observations,
      ok: overlapped && childPassed(observations[0]) && childPassed(observations[1], secondExit) && inspected.preserved === true };
  } catch (e) {
    result = { name, error: String(e && e.message || e), ok: false };
  } finally {
    for (const child of children) if (!child.closed) child.cancel('cleanup');
    const observations = await Promise.all(children.map(child => child.done));
    if (!result.children) result.children = observations;
    if (observations.some(child => !child.closed)) {
      result.ok = false; result.cleanup = { status: 'retained', path: d, reason: 'child termination unconfirmed' };
    } else {
      try { fs.rmSync(d, { recursive: true, force: true }); result.cleanup = { status: 'removed' }; }
      catch (e) { result.ok = false; result.cleanup = { status: 'failed', path: d, error: String(e && e.message || e) }; }
    }
    result.elapsedMs = Math.round(performance.now() - started);
    trace('case-end', name, { ok: result.ok, elapsedMs: result.elapsedMs, cleanup: result.cleanup });
  }
  return result;
}

module.exports = { watchChild, childPassed };

if (require.main === module) (async () => {
  const results = [];
  results.push(await race('creds-register', {
    stallTarget: 'credentials.local.json',
    first: ['creds', 'register', 'first', '--env-var', 'T0115_FIRST'],
    second: ['creds', 'register', 'second', '--env-var', 'T0115_SECOND'],
    inspect: d => {
      const services = Object.keys(JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'credentials.local.json'), 'utf8')).services || {}).sort();
      return { services, preserved: services.join(',') === 'first,second' };
    }
  }));
  results.push(await race('creds-refresh', {
    stallTarget: 'credentials.local.json',
    seed: d => run(d, ['creds', 'register', 'retained', '--env-var', 'T0115_RETAINED']),
    first: ['creds', 'refresh', 'retained'],
    second: ['creds', 'register', 'survivor', '--env-var', 'T0115_SURVIVOR'],
    inspect: d => {
      const services = JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'credentials.local.json'), 'utf8')).services || {};
      return { names: Object.keys(services).sort(), refreshed: !!services.retained?.lastRefreshed, preserved: !!services.retained?.lastRefreshed && !!services.survivor };
    }
  }));
  results.push(await race('team-remove', {
    stallTarget: 'teams.json',
    seed: d => run(d, ['team', 'add', 'victim', '--name', 'victim']),
    first: ['team', 'remove', 'victim'],
    second: ['team', 'add', 'survivor', '--name', 'survivor'],
    inspect: d => {
      const ids = JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'teams.json'), 'utf8')).map(team => team.id).sort();
      return { ids, preserved: ids.join(',') === 'survivor' };
    }
  }));
  results.push(await race('memory-restore-decisions', {
    stallTarget: 'decisions.json',
    seed: d => { run(d, ['decision', 'add', 'archived', '--reason', 'test']); run(d, ['decision', 'drop', 'archived']); },
    first: ['memory', 'restore', 'decisions', 'archived'],
    second: ['decision', 'add', 'survivor', '--reason', 'test'],
    inspect: d => {
      const titles = JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'decisions.json'), 'utf8')).map(item => item.title);
      return { titles, preserved: titles.some(title => title.includes('archived')) && titles.some(title => title.includes('survivor')) };
    }
  }));
  results.push(await race('memory-restore-lessons', {
    stallTarget: 'lessons.json',
    seed: d => { run(d, ['lesson', 'save', 'archived']); run(d, ['lesson', 'drop', 'archived']); },
    first: ['memory', 'restore', 'lessons', 'archived'],
    second: ['lesson', 'save', 'survivor'],
    inspect: d => {
      const texts = JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'lessons.json'), 'utf8')).map(item => item.text);
      return { texts, preserved: texts.includes('archived') && texts.includes('survivor') };
    }
  }));
  results.push(await race('memory-restore-plan', {
    stallTarget: 'plan.archive.md',
    seed: d => { run(d, ['plan', 'add', 'archived']); run(d, ['plan', 'remove', 'archived']); },
    first: ['memory', 'restore', 'plan', 'archived'],
    second: ['plan', 'add', 'survivor'],
    inspect: d => {
      const plan = fs.readFileSync(path.join(d, '.leerness', 'plan.md'), 'utf8');
      return { archived: plan.includes('archived'), survivor: plan.includes('survivor'), preserved: plan.includes('archived') && plan.includes('survivor') };
    }
  }));
  results.push(await race('plan-init-vs-remove', {
    stallTarget: 'plan.md',
    seed: d => run(d, ['plan', 'add', 'victim']),
    first: ['plan', 'remove', 'victim'],
    second: ['plan', 'init', '--goal', 'survivor-goal'],
    inspect: d => {
      const plan = fs.readFileSync(path.join(d, '.leerness', 'plan.md'), 'utf8');
      return {
        victimRemoved: !plan.includes('victim'),
        survivorPreserved: plan.includes('survivor-goal'),
        preserved: !plan.includes('victim') && plan.includes('survivor-goal')
      };
    }
  }));
   
   
  results.push(await race('plan-remove-vs-plan-add', {
    stallTarget: 'plan.md',
    seed: d => run(d, ['plan', 'add', 'victim']),
    first: ['plan', 'add', 'survivor-milestone'],
    second: ['plan', 'remove', 'victim'],
    inspect: d => {
      const plan = fs.readFileSync(path.join(d, '.leerness', 'plan.md'), 'utf8');
      return { victimRemoved: !plan.includes('victim'), survivorPreserved: plan.includes('survivor-milestone'),
        preserved: !plan.includes('victim') && plan.includes('survivor-milestone') };
    }
  }));
  const activeRows = (d, text) => fs.readFileSync(path.join(d, '.leerness', 'progress-tracker.md'), 'utf8').split(/\r?\n/)
    .filter(line => { const cells = line.split('|').map(s => s.trim()); return /^T-\d+$/.test(cells[1] || '') && cells[3] === text && !/^(done|dropped|blocked|completed)$/i.test(cells[2]); }).length;
  results.push(await race('task-add-dedup-vs-task-add', {
    stallTarget: 'progress-tracker.md',
    seed: d => run(d, ['task', 'add', 'same request text', '--no-review']),
    first: ['task', 'add', 'other request text', '--no-review'],
    second: ['task', 'add', 'same request text', '--no-review'],
    inspect: d => {
      const same = activeRows(d, 'same request text'), other = activeRows(d, 'other request text');
      return { same, other, preserved: same === 1 && other === 1 };
    }
  }));
   
   
  results.push(await race('task-add-same-text-twice', {
    stallTarget: 'progress-tracker.md',
    first: ['task', 'add', 'same request text', '--no-review'],
    second: ['task', 'add', 'same request text', '--no-review'],
    inspect: d => { const same = activeRows(d, 'same request text'); return { same, preserved: same === 1 }; }
  }));
  results.push(await race('idempotency-fix-vs-task-add', {
    stallTarget: 'progress-tracker.md',
    seed: d => { run(d, ['task', 'add', 'duplicated request text', '--no-review']); run(d, ['task', 'add', 'duplicated request text', '--force', '--no-review']); },
    first: ['task', 'add', 'other request text', '--no-review'],
    second: ['idempotency', 'audit', '--auto-fix'],
    inspect: d => {
      const duplicated = activeRows(d, 'duplicated request text'), other = activeRows(d, 'other request text');
      return { duplicated, other, preserved: duplicated === 1 && other === 1 };
    }
  }));
  results.push(await race('env-sync-vs-env-sync', {
    stallTarget: d => path.join(d, '.env.example'),
    seed: d => { fs.writeFileSync(path.join(d, '.env.example'), 'A=\n'); fs.writeFileSync(path.join(d, '.env'), 'A=1\nB=2\n'); },
    beforeSecond: d => fs.appendFileSync(path.join(d, '.env'), 'C=3\n'),
    first: ['env', 'sync'],
    second: ['env', 'sync'],
    inspect: d => {
      const example = fs.readFileSync(path.join(d, '.env.example'), 'utf8');
      return { hasB: /^B=/m.test(example), hasC: /^C=/m.test(example), preserved: /^B=/m.test(example) && /^C=/m.test(example) };
    }
  }));
   
  const rowIdOf = (d, text) => (fs.readFileSync(path.join(d, '.leerness', 'progress-tracker.md'), 'utf8').split(/\r?\n/)
    .map(line => line.split('|').map(s => s.trim())).find(cells => /^T-\d+$/.test(cells[1] || '') && cells[3] === text) || [])[1];
  const rowOf = (d, id) => fs.readFileSync(path.join(d, '.leerness', 'progress-tracker.md'), 'utf8').split(/\r?\n/)
    .map(line => line.split('|').map(s => s.trim())).find(cells => cells[1] === id) || [];
  results.push(await race('anchors-apply-vs-plan-add', {
    stallTarget: 'plan.md',
    seed: d => fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'probe', version: '1.0.0', description: 'coordination probe' })),
    first: ['plan', 'add', 'survivor-milestone'],
    second: ['anchors', 'draft', '--apply'],
    inspect: d => {
      const plan = fs.readFileSync(path.join(d, '.leerness', 'plan.md'), 'utf8');
      const goalFilled = plan.includes('<!-- draft: leerness anchors');
      return { goalFilled, survivorPreserved: plan.includes('survivor-milestone'), preserved: goalFilled && plan.includes('survivor-milestone') };
    }
  }));
  results.push(await race('task-relink-apply-vs-plan-add', {
    stallTarget: 'plan.md',
    seed: d => {
      run(d, ['plan', 'add', 'relink target milestone']);
      run(d, ['task', 'update', rowIdOf(d, 'relink target milestone'), '--evidence', 'unlinked by the probe']);
    },
    first: ['plan', 'add', 'other milestone'],
    second: ['task', 'relink', '--apply'],
    inspect: d => {
      const evidence = rowOf(d, rowIdOf(d, 'relink target milestone'))[4] || '';
      return { evidence, preserved: /plan:M-\d+/.test(evidence) };
    }
  }));
  const planReservesT0009 = d => fs.appendFileSync(path.join(d, '.leerness', 'plan.md'), '\n- T-0009 referenced only in the plan\n');
  results.push(await race('task-add-id-vs-plan-init', {
    stallTarget: 'plan.md',
    seed: planReservesT0009,
    first: ['plan', 'init', '--goal', 'survivor-goal'],
    second: ['task', 'add', 'fresh task text', '--no-review'],
    inspect: d => { const id = rowIdOf(d, 'fresh task text'); return { id, preserved: Number((id || 'T-0').slice(2)) > 9 }; }
  }));
  results.push(await race('lazy-auto-track-id-vs-plan-init', {
    stallTarget: 'plan.md',
    seed: d => { planReservesT0009(d); fs.writeFileSync(path.join(d, 'app.js'), '// TODO handle the race probe case\nmodule.exports = 1;\n'); },
    first: ['plan', 'init', '--goal', 'survivor-goal'],
    second: ['lazy', 'detect', '--auto-track'],
    secondExit: 1,
    inspect: d => { const id = rowIdOf(d, 'TODO app.js:1'); return { id, preserved: Number((id || 'T-0').slice(2)) > 9 }; }
  }));
  for (const [verb, extra, want] of [['update', ['--status', 'in-progress'], 'in-progress'], ['drop', [], 'dropped']]) {
    results.push(await race(`task-${verb}-vs-task-add`, {
      stallTarget: 'progress-tracker.md',
       
      seed: d => { run(d, ['task', 'add', 'target request text', '--no-review']); fs.writeFileSync(path.join(d, '.target-id'), rowIdOf(d, 'target request text')); },
      first: ['task', 'add', 'other request text', '--no-review'],
      second: d => ['task', verb, fs.readFileSync(path.join(d, '.target-id'), 'utf8'), ...extra],
      inspect: d => { const status = rowOf(d, rowIdOf(d, 'target request text'))[2]; return { status, preserved: status === want }; }
    }));
  }
  results.push(await race('task-fix-evidence-vs-task-add', {
    stallTarget: 'progress-tracker.md',
    seed: d => run(d, ['task', 'add', 'finished work text', '--status', 'done', '--evidence', 'user-request', '--no-review']),
    first: ['task', 'add', 'other request text', '--no-review'],
    second: ['task', 'fix-evidence', '--set', 'verified by the race probe'],
    inspect: d => { const evidence = rowOf(d, rowIdOf(d, 'finished work text'))[4]; return { evidence, preserved: evidence === 'verified by the race probe' }; }
  }));
  results.push(await race('task-sync-vs-task-add', {
    stallTarget: 'progress-tracker.md',
    seed: d => {
      run(d, ['task', 'add', 'existing todo text', '--no-review']);
      fs.writeFileSync(path.join(d, 'todos.json'), JSON.stringify([{ content: 'existing todo text', status: 'in_progress', activeForm: 'working' }]));
    },
    first: ['task', 'add', 'other request text', '--no-review'],
    second: d => ['task', 'sync', '--from', path.join(d, 'todos.json')],
    inspect: d => { const same = activeRows(d, 'existing todo text'); return { same, preserved: same === 1 }; }
  }));
   
  results.push(await race('task-sync-new-item-id-vs-task-add', {
    stallTarget: 'progress-tracker.md',
    seed: d => {
      fs.writeFileSync(path.join(d, '.first-row'), JSON.stringify(rowOf(d, 'T-0001')));
      fs.writeFileSync(path.join(d, 'todos.json'), JSON.stringify([{ content: 'brand new todo text', status: 'pending', activeForm: 'starting' }]));
    },
    first: ['task', 'add', 'other request text', '--no-review'],
    second: d => ['task', 'sync', '--from', path.join(d, 'todos.json')],
    inspect: d => {
      const before = JSON.parse(fs.readFileSync(path.join(d, '.first-row'), 'utf8')), after = rowOf(d, 'T-0001');
      const firstRowKept = before.length > 3 && after[3] === before[3], imported = !!rowIdOf(d, 'brand new todo text');
      return { firstRowKept, imported, preserved: firstRowKept && imported };
    }
  }));
   
  results.push(await race('task-export-vs-task-add', {
    stallTarget: 'progress-tracker.md',
    seed: d => run(d, ['task', 'add', 'export target text', '--no-review']),
    first: ['task', 'add', 'other request text', '--no-review'],
    second: d => ['task', 'export', '--to', path.join(d, 'todos.json')],
    inspect: d => {
      const exported = fs.readFileSync(path.join(d, 'todos.json'), 'utf8').includes('export target text');
      const baseline = path.join(d, '.leerness', 'cache', 'task-export-baseline.json');
      const recorded = fs.existsSync(baseline) && fs.readFileSync(baseline, 'utf8').includes('export target text');
      return { exported, recorded, preserved: exported && recorded };
    }
  }));
  results.push(await race('bugfix-start-vs-task-add', {
    stallTarget: 'progress-tracker.md',
    seed: d => {
      run(d, ['task', 'add', 'bug target text', '--no-review']);
      fs.writeFileSync(path.join(d, '.target-id'), rowIdOf(d, 'bug target text'));
      fs.writeFileSync(path.join(d, 'probe.js'), "console.log('BROKEN'); process.exit(1);\n");
    },
    first: ['task', 'add', 'other request text', '--no-review'],
    second: d => ['bugfix', 'start', fs.readFileSync(path.join(d, '.target-id'), 'utf8'), '--repro', 'node probe.js', '--expect-bad', 'BROKEN'],
    inspect: d => {
      const file = path.join(d, '.leerness', 'bugfix-receipts.json'), id = fs.readFileSync(path.join(d, '.target-id'), 'utf8');
      const registered = fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(`"${id}"`);
      return { registered, preserved: registered };
    }
  }));
  results.push(await race('claims-baseline-create-vs-task-add', {
    stallTarget: 'progress-tracker.md',
    seed: d => {
      run(d, ['task', 'add', 'legacy claim text', '--status', 'done', '--evidence', 'user-request', '--no-review']);
      run(d, ['task', 'add', 'boundary task text', '--no-review']);
      fs.writeFileSync(path.join(d, '.target-id'), rowIdOf(d, 'boundary task text'));
    },
    first: ['task', 'add', 'other request text', '--no-review'],
    second: d => ['verify-claim', 'baseline', 'create', '--before', fs.readFileSync(path.join(d, '.target-id'), 'utf8'), '--yes', '--json'],
    inspect: d => { const created = fs.existsSync(path.join(d, '.leerness', 'claims-baseline.json')); return { created, preserved: created }; }
  }));
  results.push(await race('rule-verify-vs-rule-add', {
    stallTarget: 'rules.md',
    seed: d => run(d, ['rule', 'add', 'version bump required', '--trigger', 'every-update']),
    first: ['rule', 'add', 'another rule text', '--trigger', 'every-update'],
    second: ['rule', 'verify'],
    inspect: d => { const cached = fs.existsSync(path.join(d, '.leerness', 'cache', 'rule-state.json')); return { cached, preserved: cached }; }
  }));
  results.push(await race('session-close-vs-task-add', {
    stallTarget: 'progress-tracker.md',
    seed: d => run(d, ['task', 'add', 'target request text', '--status', 'in-progress', '--no-review']),
    first: ['task', 'add', 'other request text', '--no-review'],
    second: ['session', 'close', '.'],
    inspect: d => {
      const handoff = fs.readFileSync(path.join(d, '.leerness', 'session-handoff.md'), 'utf8');
      return { listsInProgress: handoff.includes('target request text'), preserved: handoff.includes('target request text') };
    }
  }));
  results.push(await race('anchors-plan-vs-plan-add', {
    stallTarget: 'plan.md',
    seed: d => fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'probe', version: '1.0.0', description: 'coordination probe' })),
    first: ['anchors', 'draft', '--apply'],
    second: ['plan', 'add', 'survivor-milestone'],
    inspect: d => {
      const plan = fs.readFileSync(path.join(d, '.leerness', 'plan.md'), 'utf8');
      return { survivorPreserved: plan.includes('survivor-milestone'), preserved: plan.includes('survivor-milestone') };
    }
  }));
  results.push(await race('migrate-decisions-vs-add', {
    stallTarget: 'decisions.json',
    seed: d => {
      run(d, ['decision', 'add', 'legacy-decision']);
      fs.unlinkSync(path.join(d, '.leerness', 'decisions.json'));
    },
    first: ['migrate', 'apply', '--yes'],
    second: ['decision', 'add', 'survivor-decision'],
    inspect: d => {
      const titles = JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'decisions.json'), 'utf8')).map(item => item.title);
      return { titles, preserved: titles.includes('legacy-decision') && titles.includes('survivor-decision') };
    }
  }));
  results.push(await race('migrate-lessons-vs-save', {
    stallTarget: 'lessons.json',
    seed: d => {
      run(d, ['lesson', 'save', 'legacy-lesson']);
      fs.unlinkSync(path.join(d, '.leerness', 'lessons.json'));
    },
    first: ['migrate', 'apply', '--yes'],
    second: ['lesson', 'save', 'survivor-lesson'],
    inspect: d => {
      const texts = JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'lessons.json'), 'utf8')).map(item => item.text);
      return { texts, preserved: texts.includes('legacy-lesson') && texts.includes('survivor-lesson') };
    }
  }));
  results.push(await race('rule-cache-verify-vs-verify', {
    stallTarget: 'cache/rule-state.json',
    seed: d => {
      const pkg = version => fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'probe', version }));
      pkg('1.0.0');
      run(d, ['rule', 'add', 'version bump required', '--trigger', 'every-update']);
      run(d, ['rule', 'verify']);
      pkg('1.0.1');
    },
    beforeSecond: d => fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'probe', version: '1.0.2' })),
    first: ['rule', 'verify'],
    second: ['rule', 'verify'],
    inspect: d => {
      const cached = JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'cache', 'rule-state.json'), 'utf8'));
      return { cachedVersion: cached.packageVersion, preserved: cached.packageVersion === '1.0.2' };
    }
  }));
  const ok = results.every(result => result.ok);
  console.log(JSON.stringify({ ok, results }));
  if (!ok) process.exitCode = 1;
})().catch(error => {
  console.error(error && error.stack || String(error));
  process.exit(1);
});
