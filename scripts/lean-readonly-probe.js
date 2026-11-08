'use strict';
require('./temp-cleanup').trackTemp(module);
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const cli = path.resolve(__dirname, '../bin/leerness.js');
function snapshot(root) {
  const entries = [];
  const visit = dir => {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name), st = fs.lstatSync(file);
      entries.push([path.relative(root, file), st.mtimeMs, st.mode,
        st.isSymbolicLink() ? fs.readlinkSync(file) : st.isFile() ? fs.readFileSync(file).toString('base64') : null]);
      if (st.isDirectory()) visit(file);
    }
  };
  visit(root);
  return entries;
}

function fixture(fn, { offline = true, blockChildren = false, git = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lean-read-'));
  try {
    const root = path.join(home, 'project-é-한글'), ws = path.join(root, '.leerness');
    fs.mkdirSync(ws, { recursive: true });
    const files = {
      'manifest.json': JSON.stringify({ project: 'lean-fixture', language: 'en', minimal: false, leernessVersion: '1.36.306' }),
      'HARNESS_VERSION': '1.36.306\n', 'LANGUAGE': 'en\n',
      'progress-tracker.md': '# Tasks\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n| T-0001 | in-progress | Older task | none | old action | 2026-01-01 |\n| T-0002 | planned | Owner task | none | next action | 2026-10-29 |\n',
      'rules.md': '# Rules\n| ID | Trigger | Rule | Added | Status | Last Verified |\n|---|---|---|---|---|---|\n| R-0001 | always | Preserve user content | 2026-10-29 | active | |\n',
      'plan.md': '# Plan\n<!-- leerness:owner-priorities:start -->\n1. T-0002\n<!-- leerness:owner-priorities:end -->\n',
      'current-state.md': '# Current\nUser-owned state\n',
      'session-handoff.md': '# Handoff\nLast generated: 2020-01-01T00:00:00.000Z\nUser-owned handoff\n',
      'decisions.md': '# Decisions\n', 'lessons.md': '# Lessons\n', 'task-log.md': '# Log\n',
    };
    for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(ws, name), value);
    if (git) {
      const clean = { ...process.env };
      for (const key of Object.keys(clean)) if (/^GIT_/i.test(key)) delete clean[key];
      const init = cp.spawnSync('git', ['init', '-q'], { cwd: root, env: clean, encoding: 'utf8' });
      assert.equal(init.status, 0, init.stderr);
    }
    const preload = path.join(home, 'observe.cjs');
    fs.writeFileSync(preload, `
const fs = require('node:fs');
const trace = process.env.LEERNESS_LEAN_TRACE;
const fd = fs.openSync(trace, 'a');
const write = fs.writeSync.bind(fs);
const report = (kind, detail) => write(fd, JSON.stringify({ kind, detail }) + '\\n');
// Default reads start no worker threads (environment probe pools included); a worker reports itself here.
if (require('node:worker_threads').threadId !== 0) report('thread', [String(require('node:worker_threads').threadId)]);
const cp = require('node:child_process');
const path = require('node:path');
const allowedChild = (command, args) => {
  const values = Array.isArray(args) ? args.map(String) : [];
  const base = path.basename(String(command)).toLowerCase();
  if ((base === 'git' || base === 'git.exe') && values.includes('rev-parse')) return true;
  if (base === 'where.exe' && values.length === 1 && values[0] === 'git') return true;
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (process.platform === 'win32' && systemRoot && command === path.join(systemRoot, 'System32', 'chcp.com')
    && (values.length === 0 || (values.length === 1 && values[0] === '65001'))) return true;
  return command === process.execPath && values[0] === process.env.LEERNESS_LEAN_CLI && values[1] === 'handoff';
};
for (const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) {
  const original = cp[name];
  cp[name] = function(command, args) {
    report('child', [String(command), ...(Array.isArray(args) ? args.map(String) : [])]);
    if (process.env.LEERNESS_LEAN_BLOCK_CHILDREN === '1' && !allowedChild(command, args)) {
      throw Object.assign(new Error('Unexpected child blocked by read-only probe'), { code: 'E_AUDIT_CHILD_BLOCKED' });
    }
    return original.apply(this, arguments);
  };
}
for (const name of ['writeFileSync','appendFileSync','mkdirSync','renameSync','unlinkSync','rmSync','rmdirSync','copyFileSync','truncateSync','utimesSync','linkSync','symlinkSync','chmodSync','chownSync','createWriteStream','writeFile','appendFile','mkdir','rename','unlink','rm','rmdir','copyFile','truncate','utimes','link','symlink','chmod','chown']) {
  const original = fs[name];
  fs[name] = function(file) { report('write', [name, String(file)]); return original.apply(this, arguments); };
}
for (const name of ['writeFile','appendFile','mkdir','rename','unlink','rm','rmdir','copyFile','truncate','utimes','link','symlink','chmod','chown']) {
  const original = fs.promises[name];
  fs.promises[name] = function(file) { report('write', [name, String(file)]); return original.apply(this, arguments); };
}
for (const name of ['write','writeSync','writev','writevSync','ftruncate','ftruncateSync','fchmod','fchmodSync','fchown','fchownSync','futimes','futimesSync']) {
  const original = fs[name];
  fs[name] = function(file) { if (file > 2 && file !== fd) report('write', [name, String(file)]); return original.apply(this, arguments); };
}
const open = fs.openSync;
fs.openSync = function(file, flags) {
  if (typeof flags === 'string' ? /[wa+]/.test(flags) : (flags & (fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC))) report('write', ['openSync', String(file)]);
  return open.apply(this, arguments);
};
const blockNetwork = (module, name) => function() {
  report('network', [module, name]);
  throw Object.assign(new Error('Network blocked by read-only probe'), { code: 'E_AUDIT_NETWORK_BLOCKED' });
};
if (globalThis.fetch) globalThis.fetch = blockNetwork('globalThis', 'fetch');
for (const [module, names] of [['node:http',['request','get']],['node:https',['request','get']],['node:net',['connect','createConnection']],['node:tls',['connect']],['node:http2',['connect']]]) {
  const target = require(module);
  for (const name of names) target[name] = blockNetwork(module, name);
}
require('node:net').Socket.prototype.connect = blockNetwork('node:net.Socket', 'connect');
require('node:dgram').Socket.prototype.send = blockNetwork('node:dgram.Socket', 'send');
require('node:dgram').Socket.prototype.connect = blockNetwork('node:dgram.Socket', 'connect');
for (const target of [require('node:dns'), require('node:dns').promises]) {
  for (const name of Object.keys(target).filter(name => /^(?:lookup|resolve|reverse)/.test(name))) {
    if (typeof target[name] === 'function') target[name] = blockNetwork('node:dns', name);
  }
}
`);
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^(LEERNESS_|NODE_OPTIONS)/i.test(key)) delete env[key];
    Object.assign(env, { LEERNESS_CACHE_DIR: path.join(home, 'machine-cache'), LEERNESS_SESSION_ID: 'lean-fixture-session',
      LEERNESS_NO_PROMPT: '1', LEERNESS_NO_BANNER: '1', LEERNESS_LEAN_CLI: cli,
      LEERNESS_LEAN_BLOCK_CHILDREN: blockChildren ? '1' : '0',
      NODE_OPTIONS: `--require "${preload.replace(/\\/g, '/')}"` });
    if (offline) env.LEERNESS_OFFLINE = '1';
    let count = 0;
    const execute = (argv, input) => {
      const trace = path.join(home, `trace-${++count}.jsonl`);
      const before = snapshot(root);
      const result = cp.spawnSync(process.execPath, argv, { cwd: root, env: { ...env, LEERNESS_LEAN_TRACE: trace },
        encoding: 'utf8', input, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
      const events = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
      return { ...result, events, before, after: snapshot(root) };
    };
    const run = (args, input) => execute([cli, ...args, '--path', root], input);
    return fn({ root, ws, files, run, execute });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}
function readOnly(result, status = 0) {
  assert.equal(result.status, status, result.stderr || result.stdout);
  assert.deepEqual(result.after, result.before, 'default reads preserve project bytes, names, modes and mtimes');
  const effects = result.events.filter(e => e.kind !== 'child');
  assert.deepEqual(effects, [], 'default reads must not write or use the network');
  const forbidden = result.events.filter(e => {
    if (e.kind !== 'child') return false;
    if (e.detail.some(a => /^(?:rev-parse|--show-toplevel|--git-dir)$/.test(a))) return false;
    if (/where(?:\.exe)?$/i.test(e.detail[0]) && e.detail[1] === 'git') return false;
    const systemRoot = process.env.SystemRoot || process.env.WINDIR;
    if (process.platform === 'win32' && systemRoot && e.detail[0] === path.join(systemRoot, 'System32', 'chcp.com')
      && (e.detail.length === 1 || (e.detail.length === 2 && e.detail[1] === '65001'))) return false;
    return !(e.detail[0] === process.execPath && e.detail[1] === cli && e.detail[2] === 'handoff');
  });
  assert.deepEqual(forbidden, [], 'default reads must not inspect tools, providers, tests, or history');
}
for (const args of [['handoff'], ['handoff', '--json'], ['handoff', '--compact'], ['task', 'list', '--json'], ['state', 'show', '--json'], ['context', 'current', '--json']]) {
  test(args.join(' ') + ' is a cold read with zero persistent writes and no implicit probes', () => fixture(({ run, ws, files }) => {
    const result = run(args); readOnly(result);
    for (const [name, content] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(ws, name), 'utf8'), content);
    if (args[0] === 'handoff') {
      assert.match(result.stdout, /Preserve user content/);
      assert.match(result.stdout, /not_inspected|not inspected/);
    }
  }));
}
test('stored handoff retains compatible fields and selects owner priority without certification', () => fixture(({ run }) => {
  const result = run(['handoff', '--json']); readOnly(result);
  const report = JSON.parse(result.stdout);
  assert.equal(report.inspection.status, 'not_inspected');
  assert.equal(report.nextTask.id, 'T-0002');
  assert.equal(report.memorySurface.tasks.total, 2);
  assert.equal(report.files.currentState.content, '# Current\nUser-owned state\n');
  assert.equal(report.activeRules[0].id, 'R-0001');
  assert.equal(report.envInfo, undefined);
}));
test('recording a session is explicit and does not imply environment inspection', () => fixture(({ run, ws }) => {
  const result = run(['handoff', '--record', '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).inspection.status, 'not_inspected');
  assert(fs.existsSync(path.join(ws, 'cache', 'handoffs', 'lean-fixture-session.json')));
  assert(!fs.existsSync(path.join(ws, 'environment.json')));
  assert(result.events.some(e => e.kind === 'write'));
}));

test('MCP default handoff reads without registration, statistics or probes', () => fixture(({ run, root }) => {
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_handoff', arguments: { path: root } } };
  const result = run(['mcp', 'serve', '--profile', 'full'], JSON.stringify(request) + '\n');
  readOnly(result);
  const response = JSON.parse(result.stdout.trim());
  assert.equal(response.result.isError, false);
  assert.match(response.result.content[0].text, /Preserve user content/);
}));
test('no-record suppresses explicit recording without triggering usage writes', () => fixture(({ run }) => {
  readOnly(run(['handoff', '--record', '--no-record', '--json']));
}));
test('ambiguous owner priorities are not silently treated as an empty current task', () => fixture(({ run, ws }) => {
  fs.appendFileSync(path.join(ws, 'plan.md'), '<!-- leerness:owner-priorities:start -->\n');
  const result = run(['handoff', '--json']); readOnly(result, 1);
  assert.equal(JSON.parse(result.stdout).code, 'invalid_owner_priorities');
}));
test('inspection options cannot silently turn a compact or unrelated command into diagnostics', () => fixture(({ run }) => {
  for (const args of [['handoff', '--inspect', '--compact', '--json'], ['task', 'list', '--inspect', '--json']]) {
    const result = run(args); readOnly(result, 1);
    assert.equal(JSON.parse(result.stdout).ok, false);
  }
}));

test('stored migration notices remain visible without running diagnostics', () => fixture(({ run, ws }) => {
  fs.writeFileSync(path.join(ws, 'migration-report.md'), '# Migration\n## 🤖 AI must re-read\nRead updated policy.\n## Other\n');
  const result = run(['handoff']); readOnly(result);
  assert.match(result.stdout, /AI must re-read/);
}));

test('session-start hook is read-only and follows the same owner priority as handoff', () => fixture(({ run }) => {
  const result = run(['hook', 'session-start']); readOnly(result);
  const text = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(text, /Next: T-0002/);
  assert.doesNotMatch(text, /Next: T-0001/);
}));
test('session-start hook reports ambiguous priorities without selecting an arbitrary task', () => fixture(({ run, ws }) => {
  fs.appendFileSync(path.join(ws, 'plan.md'), '<!-- leerness:owner-priorities:start -->\n');
  const result = run(['hook', 'session-start']); readOnly(result);
  const text = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(text, /invalid_owner_priorities/);
  assert.doesNotMatch(text, /Next: T-/);
}));

for (const args of [['handoff'], ['handoff', '--json'], ['handoff', '--compact'], ['task', 'list', '--json'], ['state', 'show', '--json'], ['context', 'current', '--json'], ['hook', 'session-start']]) {
  test(args.join(' ') + ' makes no network attempt with LEERNESS_OFFLINE absent', () => fixture(({ run }) => {
    readOnly(run(args));
  }, { offline: false, blockChildren: true }));
}
test('MCP default handoff makes no network attempt with LEERNESS_OFFLINE absent', () => fixture(({ run, root }) => {
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_handoff', arguments: { path: root } } };
  const result = run(['mcp', 'serve', '--profile', 'full'], JSON.stringify(request) + '\n');
  readOnly(result);
  assert.equal(JSON.parse(result.stdout.trim()).result.isError, false);
}, { offline: false, blockChildren: true }));
test('network instrumentation blocks a deliberate request before external transport', () => fixture(({ execute }) => {
  const result = execute(['-e', 'if (Object.hasOwn(process.env, "LEERNESS_OFFLINE")) process.exit(3); try { require("node:http").get("http://127.0.0.1:9"); process.exit(2); } catch (error) { if (error.code !== "E_AUDIT_NETWORK_BLOCKED") throw error; }']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.events, [{ kind: 'network', detail: ['node:http', 'get'] }]);
  assert.deepEqual(result.before, result.after);
}, { offline: false, blockChildren: true }));

const LOOP_STOP = /^LOOP STOP L-0001 "stopped subject" 3\/3 rounds - owner decision required: leerness loop status L-0001$/m;
const LOOP_UNREADABLE = /^LOOP LEDGER UNREADABLE \(loop_ledger_corrupt\): .+ - round limits cannot be checked; tell the owner$/m;
const stopLoop = ({ run }) => {
  assert.equal(run(['loop', 'open', 'stopped subject']).status, 0);
  assert.deepEqual(['a', 'b', 'c'].map(spot => run(['loop', 'round', 'L-0001', '--spot', spot]).status), [0, 0, 3]);
};
const ledgerFile = (root, git) => {
  if (!git) return path.join(root, '.leerness', 'loop-ledger.json');
  const projects = path.join(root, '.git', 'leerness', 'control', 'projects');
  return path.join(projects, fs.readdirSync(projects)[0], 'loop-ledger.json');
};
const loopText = (args, result) => (args[0] === 'hook' ? JSON.parse(result.stdout).hookSpecificOutput.additionalContext : result.stdout);
const loopReads = [['handoff'], ['handoff', '--compact'], ['hook', 'session-start']];
const loopSummary = (git, extra) => ({ schema: 'leerness.loop-summary/v1', state: 'absent', scope: git ? 'git-common' : 'project-local', error: null, open: [], stopped: [], ...extra });
for (const git of [false, true]) {
  const where = git ? 'git repository' : 'project outside git';
  test('a stopped loop shows in handoff, --compact, --json and the session-start hook (' + where + ') and the reads stay read-only', () => fixture(f => {
    stopLoop(f);
    for (const args of loopReads) {
      const result = f.run(args); readOnly(result);
      assert.match(loopText(args, result), LOOP_STOP, args.join(' '));
    }
    const result = f.run(['handoff', '--json']); readOnly(result);
    assert.deepEqual(JSON.parse(result.stdout).loopGuard, loopSummary(git, { state: 'present',
      stopped: [{ id: 'L-0001', subject: 'stopped subject', rounds: 3, cap: 3, reason: 'cap_reached' }] }));
  }, { git }));
  test('with no loop ledger a read prints no loop line and creates nothing (' + where + ')', () => fixture(f => {
    for (const args of loopReads) {
      const result = f.run(args); readOnly(result);
      assert.doesNotMatch(loopText(args, result), /LOOP|UNREADABLE/, args.join(' '));
    }
    const result = f.run(['handoff', '--json']); readOnly(result);
    assert.deepEqual(JSON.parse(result.stdout).loopGuard, loopSummary(git));
    assert(!fs.existsSync(ledgerFile(f.root, false)) && !fs.existsSync(path.join(f.root, '.git', 'leerness')));
  }, { git }));
  test('a corrupt loop ledger is reported as unreadable and the reads still exit 0 (' + where + ')', () => fixture(f => {
    stopLoop(f);
    fs.writeFileSync(ledgerFile(f.root, git), '{');
    for (const args of loopReads) {
      const result = f.run(args); readOnly(result);
      assert.match(loopText(args, result), LOOP_UNREADABLE, args.join(' '));
      assert.doesNotMatch(loopText(args, result), /LOOP STOP/);
    }
    const result = f.run(['handoff', '--json']); readOnly(result);
    assert.deepEqual(JSON.parse(result.stdout).loopGuard, loopSummary(git, { state: 'unreadable', error: 'loop_ledger_corrupt' }));
    assert.equal(fs.readFileSync(ledgerFile(f.root, git), 'utf8'), '{');
  }, { git }));
}
test('handoff --record and --inspect show a stopped loop in text and --json', () => fixture(f => {
  stopLoop(f);
  const stopped = [{ id: 'L-0001', subject: 'stopped subject', rounds: 3, cap: 3, reason: 'cap_reached' }];
  for (const flag of ['--record', '--inspect']) {
    const text = f.run(['handoff', flag]), json = f.run(['handoff', flag, '--json']);
    assert.equal(text.status, 0, text.stderr); assert.match(text.stdout, LOOP_STOP, flag);
    assert.equal(json.status, 0, json.stderr); assert.deepEqual(JSON.parse(json.stdout).loopGuard, loopSummary(true, { state: 'present', stopped }), flag);
  }
}, { git: true }));
test('MCP default handoff shows a stopped loop and stays read-only', () => fixture(f => {
  stopLoop(f);
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_handoff', arguments: { path: f.root } } };
  const result = f.run(['mcp', 'serve', '--profile', 'full'], JSON.stringify(request) + '\n');
  readOnly(result);
  const response = JSON.parse(result.stdout.trim());
  assert.equal(response.result.isError, false);
  assert.match(response.result.content[0].text, LOOP_STOP);
}));
for (const git of [false, true]) {
  test('MCP default handoff for a path that does not exist prints no unreadable-ledger line (' + (git ? 'below a git repository' : 'outside git') + ')', () => fixture(f => {
    const missing = path.join(git ? f.root : path.dirname(f.root), 'no-such-folder');
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_handoff', arguments: { path: missing } } };
    const result = f.run(['mcp', 'serve', '--profile', 'full'], JSON.stringify(request) + '\n');
    readOnly(result);
    const response = JSON.parse(result.stdout.trim());
    assert(Array.isArray(response.result && response.result.content), 'the call is answered');
    assert.doesNotMatch(JSON.stringify(response), /LOOP LEDGER UNREADABLE/);
    assert(!fs.existsSync(missing), 'the missing path is not created');
  }, { git }));
}
test('reading a loop ledger starts no process beyond the ones a read without a ledger starts', () => fixture(f => {
  const children = result => result.events.filter(e => e.kind === 'child').map(e => e.detail);
  const read = args => { const result = f.run(args); readOnly(result); return children(result); };
  const without = [['handoff'], ['handoff', '--compact'], ['handoff', '--json']].map(read);
  assert(without.every(list => list.some(detail => detail.includes('rev-parse'))), 'the repository is resolved by the read itself');
  stopLoop(f);
  assert.deepEqual([['handoff'], ['handoff', '--compact'], ['handoff', '--json']].map(read), without);
}, { git: true }));

const projectDir = path.resolve(__dirname, '../.leerness');
const hasProjectState = ['plan.md', 'progress-tracker.md', 'session-handoff.md'].every(name => fs.existsSync(path.join(projectDir, name)));
test('actual project owner queue wins over a newer unrelated actionable task', { skip: !hasProjectState }, () => fixture(({ run, ws }) => {
  const plan = fs.readFileSync(path.join(projectDir, 'plan.md'), 'utf8');
  const ids = require('../lib/session-next').priorityIds(plan);
  assert(ids.length > 0, 'active owner-priorities must contain numbered canonical task IDs');
  fs.writeFileSync(path.join(ws, 'plan.md'), plan);
  fs.writeFileSync(path.join(ws, 'progress-tracker.md'), fs.readFileSync(path.join(projectDir, 'progress-tracker.md')));
  const list = run(['task', 'list', '--all', '--json']); readOnly(list);
  const rows = JSON.parse(list.stdout).tasks;
  const selected = require('../lib/session-next').selectNextTask(rows, plan);
  assert.equal(selected.source, 'owner-priorities');
  for (const id of ids) assert(rows.some(row => row.id === id), 'unknown owner-priority ID: ' + id);
  fs.appendFileSync(path.join(ws, 'progress-tracker.md'), '\n| T-999999 | in-progress | Unrelated newer task | none | not the owner priority | 2099-01-01 |\n');
  const handoff = run(['handoff', '--json']); readOnly(handoff);
  const actual = JSON.parse(handoff.stdout).nextTask;
  assert.equal(actual.id, selected.row.id);
}));
test('actual current handoff has canonical statuses and a non-dropped next action', { skip: !hasProjectState }, () => fixture(({ run, ws }) => {
  fs.writeFileSync(path.join(ws, 'progress-tracker.md'), fs.readFileSync(path.join(projectDir, 'progress-tracker.md')));
  const result = run(['task', 'list', '--all', '--json']); readOnly(result);
  const rows = JSON.parse(result.stdout).tasks;
  const context = require('../lib/context-current');
  const text = fs.readFileSync(path.join(projectDir, 'session-handoff.md'), 'utf8');
  const current = context.currentHandoffRegion(text);
  assert(current, 'missing current handoff markers');
  const plan = fs.readFileSync(path.join(projectDir, 'plan.md'), 'utf8');
  const selected = require('../lib/session-next').selectNextTask(rows, plan).row;
  const next = current.split('## Next Exact Step\n')[1]?.split('\n## ')[0] || '';
  assert(next.includes(selected.id), 'handoff must identify the canonical next task');
  assert(next.includes(selected.nextAction), 'handoff next action must match the tracker exactly');
  const sections = { 'Completed': ['done'], 'In Progress': ['in-progress'], 'Planned / Requested': ['planned', 'requested'],
    'Incomplete / Waiting / On Hold / Blocked': ['incomplete', 'waiting', 'on-hold', 'blocked'], 'Dropped': ['dropped'] };
  const seen = new Set();
  for (const [title, statuses] of Object.entries(sections)) {
    const body = current.split('## ' + title + '\n')[1]?.split('\n## ')[0] || '';
    for (const match of body.matchAll(/^- (T-\d+)\b/gm)) {
      const row = rows.find(row => row.id === match[1]);
      assert(row && statuses.includes(context.normalizeStatus(row.status)), match[1] + ' is in the wrong handoff status section');
      assert(!seen.has(row.id), row.id + ' is duplicated across current status sections');
      seen.add(row.id);
    }
  }
  assert(current.includes('LEAN-01B'), 'latest implementation must be inside the current marker');
  for (const row of rows.filter(row => context.normalizeStatus(row.status) === 'dropped')) {
    assert(!next.includes(row.id), 'dropped work cannot be the next task');
  }
}));
