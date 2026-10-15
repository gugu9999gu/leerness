// scripts/e2e-concurrency.js — T-0115의 silent lost-update 회귀 방지.
// LOCKPROBE_STALL_*은 scripts/lock-probe.js를 명시 preload한 이 테스트에서만 활성화된다.
'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CLI = path.resolve(process.argv[2] || path.join(__dirname, '..', 'bin', 'leerness.js'));
const PRELOAD = path.join(__dirname, 'lock-probe.js');
const { overlapOf } = require('./race-overlap');
const ENV = {
  ...process.env,
  LEERNESS_OFFLINE: '1',
  LEERNESS_NO_PROMPT: '1',
  LEERNESS_NO_LOCK_WARN: '1'
};
const STALL_MS = 1200;

const nap = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const wait = child => new Promise(resolve => child.on('close', code => resolve(code)));

function run(d, args) {
  const r = cp.spawnSync(process.execPath, [CLI, ...args, '--path', d],
    { cwd: d, env: ENV, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error(args.slice(0, 3).join(' ') + ' setup exit=' + r.status);
  return r;
}

function init(d) {
  const r = cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--minimal'],
    { cwd: d, env: ENV, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error('init exit=' + r.status);
}

// The preload writes this file at the moment it stalls the final publication of the target, so "stalled"
// is observed rather than inferred. T-0314: inferring it from `<target>.tmp-*` names stopped working when
// 1.36.190 published memory outputs through `.<target>.publish-*` + link; 8 of 11 races then never raced.
const readyFileOf = d => path.join(d, '.stall-ready.json');
// T-0346: the second command writes this file after it read the target, or tried its lock or a lock the first
// command held when it stalled; the first command's stall ends only after it exists (see scripts/lock-probe.js).
// A fixed 1.2 s stall could end before the second command had started (a Node start alone can take that long on
// Windows), and the race then passed without overlapping the publication.
const reachFileOf = d => path.join(d, '.stall-reached.json');

// role 'first' stalls the publication of `target` until the second command reaches it; role 'second' reports
// reaching it. Both run with the lock-probe preload.
function spawn(d, args, role, target) {
  const nodeArgs = ['--require', PRELOAD, CLI, ...args, '--path', d];
  const env = role === 'first'
    ? { ...ENV, LOCKPROBE_STALL_TARGET: target, LOCKPROBE_STALL_MS: String(STALL_MS), LOCKPROBE_READY_FILE: readyFileOf(d), LOCKPROBE_WAIT_FILE: reachFileOf(d) }
    : { ...ENV, LOCKPROBE_REACH_TARGET: target, LOCKPROBE_REACH_FILE: reachFileOf(d), LOCKPROBE_REACH_LOCKS_FILE: readyFileOf(d) };
  return cp.spawn(process.execPath, nodeArgs, { cwd: d, env, stdio: 'ignore' });
}
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function waitForStall(d, target) {
  // T-0343: an absolute target (a file outside .leerness) is acknowledged by its full path, a relative one by its
  //   path inside .leerness; the two are not mixed.
  const normalized = path.isAbsolute(target) ? path.resolve(target).replace(/\\/g, '/') : target.replace(/\\/g, '/').replace(/^\.?\/+/, '');
  for (let i = 0; i < 800; i++) {
    try { if (JSON.parse(fs.readFileSync(readyFileOf(d), 'utf8')).target === normalized) return true; } catch {}
    nap(10);
  }
  return false;
}

async function race(name, config) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-t0115-race-'));
  try {
    init(d);
    if (config.seed) config.seed(d);
    // T-0343: a target outside .leerness is given as a function of the project directory (its absolute path).
    const stallTarget = typeof config.stallTarget === 'function' ? config.stallTarget(d) : config.stallTarget;
    const first = spawn(d, config.first, 'first', stallTarget);
    const stalled = waitForStall(d, stallTarget);
    if (config.beforeSecond) config.beforeSecond(d);
    const second = spawn(d, typeof config.second === 'function' ? config.second(d) : config.second, 'second', stallTarget);
    const exits = await Promise.all([wait(first), wait(second)]);
    // T-0346: the race counts only when the second command overlapped the first one's stalled section (see
    // scripts/race-overlap.js): a contended lock attempt, or, for a command that tried none of those locks, a read
    // of the stalled file that finished before the first command resumed.
    const ready = readJson(readyFileOf(d)) || {}, reach = readJson(reachFileOf(d));
    const { overlapped, why } = overlapOf({ stalled, ready, reach });
    const inspected = config.inspect(d);
    // T-0343: `secondExit` names the second command's expected exit when it is not 0 (lazy detect reports issues with 1).
    const secondExit = config.secondExit === undefined ? 0 : config.secondExit;
    return { name, stalled, overlapped, why, read: reach && reach.read && reach.read.how, lock: reach && reach.lock && reach.lock.result,
      waitedMs: ready.waitedMs, exits, ...inspected,
      ok: overlapped && exits[0] === 0 && exits[1] === secondExit && inspected.preserved === true };
  } catch (e) {
    return { name, error: String(e && e.message || e), ok: false };
  } finally {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
}

(async () => {
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
  // T-0343 (review round 1): commands that decided on an unlocked existence check while the first writer, holding
  // its lock, had the file renamed away for its POSIX publication.
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
  // The same text twice: the second add checked before the first one's row had landed (on Windows too, where the
  // tracker is replaced in place and never missing).
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
  // T-0343 (review round 2): more commands whose unlocked read decided a write, a skip or an error.
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
      // The ID is read at seed time: when the second command starts, the tracker is the file being published.
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
  // An ID assigned from a tracker read as missing: the new row could take an existing row's ID and replace it.
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
  // T-0343 (review round 3): task export, bugfix start and claims baseline create.
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
