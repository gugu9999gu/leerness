// scripts/e2e-concurrency.js — T-0115의 silent lost-update 회귀 방지.
// LOCKPROBE_STALL_*은 scripts/lock-probe.js를 명시 preload한 이 테스트에서만 활성화된다.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CLI = path.resolve(process.argv[2] || path.join(__dirname, '..', 'bin', 'leerness.js'));
const PRELOAD = path.join(__dirname, 'lock-probe.js');
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

function spawn(d, args, stallTarget) {
  const nodeArgs = stallTarget
    ? ['--require', PRELOAD, CLI, ...args, '--path', d]
    : [CLI, ...args, '--path', d];
  const env = stallTarget
    ? { ...ENV, LOCKPROBE_STALL_TARGET: stallTarget, LOCKPROBE_STALL_MS: String(STALL_MS) }
    : ENV;
  return cp.spawn(process.execPath, nodeArgs, { cwd: d, env, stdio: 'ignore' });
}

function waitForStall(d, target) {
  const re = new RegExp('^' + target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.tmp-');
  const hd = path.join(d, '.harness');
  for (let i = 0; i < 800; i++) {
    try { if (fs.readdirSync(hd).some(name => re.test(name))) return true; } catch {}
    nap(10);
  }
  return false;
}

async function race(name, config) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-t0115-race-'));
  try {
    init(d);
    if (config.seed) config.seed(d);
    const first = spawn(d, config.first, config.stallTarget);
    const stalled = waitForStall(d, config.stallTarget);
    const second = spawn(d, config.second);
    const exits = await Promise.all([wait(first), wait(second)]);
    const inspected = config.inspect(d);
    return { name, stalled, exits, ...inspected, ok: stalled && exits.every(code => code === 0) && inspected.preserved === true };
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
      const services = Object.keys(JSON.parse(fs.readFileSync(path.join(d, '.harness', 'credentials.local.json'), 'utf8')).services || {}).sort();
      return { services, preserved: services.join(',') === 'first,second' };
    }
  }));
  results.push(await race('creds-refresh', {
    stallTarget: 'credentials.local.json',
    seed: d => run(d, ['creds', 'register', 'retained', '--env-var', 'T0115_RETAINED']),
    first: ['creds', 'refresh', 'retained'],
    second: ['creds', 'register', 'survivor', '--env-var', 'T0115_SURVIVOR'],
    inspect: d => {
      const services = JSON.parse(fs.readFileSync(path.join(d, '.harness', 'credentials.local.json'), 'utf8')).services || {};
      return { names: Object.keys(services).sort(), refreshed: !!services.retained?.lastRefreshed, preserved: !!services.retained?.lastRefreshed && !!services.survivor };
    }
  }));
  results.push(await race('team-remove', {
    stallTarget: 'teams.json',
    seed: d => run(d, ['team', 'add', 'victim', '--name', 'victim']),
    first: ['team', 'remove', 'victim'],
    second: ['team', 'add', 'survivor', '--name', 'survivor'],
    inspect: d => {
      const ids = JSON.parse(fs.readFileSync(path.join(d, '.harness', 'teams.json'), 'utf8')).map(team => team.id).sort();
      return { ids, preserved: ids.join(',') === 'survivor' };
    }
  }));
  results.push(await race('memory-restore-decisions', {
    stallTarget: 'decisions.json',
    seed: d => { run(d, ['decision', 'add', 'archived', '--why', 'test']); run(d, ['decision', 'drop', 'archived']); },
    first: ['memory', 'restore', 'decisions', 'archived'],
    second: ['decision', 'add', 'survivor', '--why', 'test'],
    inspect: d => {
      const titles = JSON.parse(fs.readFileSync(path.join(d, '.harness', 'decisions.json'), 'utf8')).map(item => item.title);
      return { titles, preserved: titles.some(title => title.includes('archived')) && titles.some(title => title.includes('survivor')) };
    }
  }));
  results.push(await race('memory-restore-lessons', {
    stallTarget: 'lessons.json',
    seed: d => { run(d, ['lesson', 'save', 'archived']); run(d, ['lesson', 'drop', 'archived']); },
    first: ['memory', 'restore', 'lessons', 'archived'],
    second: ['lesson', 'save', 'survivor'],
    inspect: d => {
      const texts = JSON.parse(fs.readFileSync(path.join(d, '.harness', 'lessons.json'), 'utf8')).map(item => item.text);
      return { texts, preserved: texts.includes('archived') && texts.includes('survivor') };
    }
  }));
  results.push(await race('memory-restore-plan', {
    stallTarget: 'plan.archive.md',
    seed: d => { run(d, ['plan', 'add', 'archived']); run(d, ['plan', 'remove', 'archived']); },
    first: ['memory', 'restore', 'plan', 'archived'],
    second: ['plan', 'add', 'survivor'],
    inspect: d => {
      const plan = fs.readFileSync(path.join(d, '.harness', 'plan.md'), 'utf8');
      return { archived: plan.includes('archived'), survivor: plan.includes('survivor'), preserved: plan.includes('archived') && plan.includes('survivor') };
    }
  }));
  const ok = results.every(result => result.ok);
  console.log(JSON.stringify({ ok, results }));
  if (!ok) process.exitCode = 1;
})().catch(error => {
  console.error(error && error.stack || String(error));
  process.exit(1);
});
