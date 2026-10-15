'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const H = require('../lib/history-retention');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-history-retention-'));
let passed = 0;
function test(name, fn) { fn(); passed++; process.stdout.write(`ok ${passed} - ${name}\n`); }
function call(root, args) {
  const r = cp.spawnSync(process.execPath, [CLI, ...args, '--path', root, '--json'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1', LEERNESS_NO_AUTOCHCP: '1' }
  });
  let json = null; try { json = JSON.parse((r.stdout || '').trim()); } catch {}
  return { ...r, json };
}
function row(id, status, request, evidence, nextAction = 'none', updated = '2026-09-22') {
  const safe = value => String(value).replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
  return `| ${id} | ${status} | ${safe(request)} | ${safe(evidence)} | ${safe(nextAction)} | ${updated} |`;
}
function project(name = 'fixture') {
  const root = path.join(arena, name); fs.mkdirSync(path.join(root, '.leerness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.leerness', 'HARNESS_VERSION'), require('../package.json').version + '\n');
  fs.writeFileSync(path.join(root, '.leerness', 'rules.md'), '# Rules\n');
  fs.writeFileSync(path.join(root, '.leerness', 'plan.md'), '# Plan\n');
  fs.writeFileSync(path.join(root, '.leerness', 'progress-tracker.md'), '# Progress Tracker\n\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n' + row('T-0001', 'in-progress', 'active task', 'active evidence', 'continue') + '\n');
  fs.writeFileSync(path.join(root, 'x.js'), "module.exports = function retainedWork(){ return 42; };\n");
  return root;
}
function retain(root, lines) {
  const operationId = 'retain-20260922-001';
  const base = path.join(root, '.leerness', 'archive', 'history');
  const sourceDir = path.join(base, operationId); fs.mkdirSync(sourceDir, { recursive: true });
  const source = `${operationId}/progress-tracker.md`;
  const header = '# Retained progress source\n\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n';
  const text = header + lines.join('\n') + '\n', bytes = Buffer.from(text);
  fs.writeFileSync(path.join(base, source), bytes);
  const entries = lines.map(line => {
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(s => s.replace(/\\\|/g, '|').trim());
    return { kind: 'task', id: cells[0], status: cells[1], updated: cells[5], operationId, source,
      sourceSha256: sha(bytes), rowSha256: sha(Buffer.from(line)) };
  });
  fs.writeFileSync(path.join(base, 'index.json'), JSON.stringify({ schema: H.SCHEMA, schemaVersion: 1, entries }, null, 2) + '\n');
}
try {
  test('missing history namespace is a complete empty state', () => {
    const root = project('empty'); assert.deepStrictEqual(H.historyTaskMetadata(root), []); assert.strictEqual(H.reservedTaskMax(root), 0);
  });
  test('history namespace without index fails closed', () => {
    const root = project('missing-index'); fs.mkdirSync(path.join(root, '.leerness', 'archive', 'history'), { recursive: true });
    assert.throws(() => H.reservedTaskMax(root), error => error && error.code === 'history_index_incomplete');
  });
  test('task add also fails closed when retained history has no index', () => {
    const root = project('missing-index-cli'), tracker = path.join(root, '.leerness', 'progress-tracker.md');
    fs.mkdirSync(path.join(root, '.leerness', 'archive', 'history'), { recursive: true });
    const before = fs.readFileSync(tracker);
    const r = call(root, ['task', 'add', 'must-not-allocate']);
    assert.notStrictEqual(r.status, 0, r.stdout + r.stderr); assert(r.json); assert.strictEqual(r.json.code, 'history_index_incomplete');
    assert(fs.readFileSync(tracker).equals(before));
  });
  test('nonterminal retained task metadata is rejected', () => {
    const root = project('nonterminal'); retain(root, [row('T-0002', 'in-progress', 'must stay active', 'pending')]);
    assert.throws(() => H.historyTaskMetadata(root), error => error && error.code === 'history_index_invalid');
  });
  test('unsafe retained numeric IDs cannot produce rounded or reused new task IDs', () => {
    const root = project('unsafe-id'); retain(root, [row('T-9007199254740993', 'done', 'unsafe ID', 'x.js implemented')]);
    assert.throws(() => H.historyTaskMetadata(root), error => error && error.code === 'history_index_invalid');
    const tracker = path.join(root, '.leerness', 'progress-tracker.md'), before = fs.readFileSync(tracker);
    const r = call(root, ['task', 'add', 'must-not-round']);
    assert.notStrictEqual(r.status, 0); assert.strictEqual(r.json.code, 'history_index_invalid');
    assert(fs.readFileSync(tracker).equals(before));
  });
  test('exhausted retained ID range refuses allocation without editing current tasks', () => {
    const root = project('exhausted-id'); retain(root, [row('T-9007199254740991', 'done', 'last safe ID', 'x.js implemented')]);
    assert.throws(() => H.reservedTaskMax(root), error => error && error.code === 'history_id_exhausted');
    const tracker = path.join(root, '.leerness', 'progress-tracker.md'), before = fs.readFileSync(tracker);
    const r = call(root, ['task', 'add', 'must-not-overflow']);
    assert.notStrictEqual(r.status, 0); assert.strictEqual(r.json.code, 'history_id_exhausted');
    assert(fs.readFileSync(tracker).equals(before));
  });
  test('sequential task writers refuse overflow after allocating the last safe ID', () => {
    for (const command of [['task', 'add'], ['register-pending']]) {
      const root = project('sequence-' + command[0]);
      retain(root, [row('T-9007199254740990', 'done', 'penultimate safe ID', 'x.js implemented')]);
      const accepted = call(root, [...command, 'last-safe']);
      assert.strictEqual(accepted.status, 0, accepted.stdout + accepted.stderr);
      const tracker = path.join(root, '.leerness', 'progress-tracker.md'), before = fs.readFileSync(tracker);
      assert(before.toString('utf8').includes('| T-9007199254740991 |'));
      const refused = call(root, [...command, 'must-not-overflow']);
      assert.notStrictEqual(refused.status, 0);assert.strictEqual(refused.json.code, 'history_id_exhausted');
      assert(fs.readFileSync(tracker).equals(before));
    }
  });
  test('automatic TODO batches reserve the complete ID range before publication', () => {
    for (const fits of [false, true]) {
      const root = project('batch-' + fits);
      retain(root, [row(fits ? 'T-9007199254740989' : 'T-9007199254740990', 'done', 'batch boundary', 'x.js implemented')]);
      fs.writeFileSync(path.join(root, 'x.js'), '// TODO implement first\n// TODO implement second\nmodule.exports = 1;\n');
      const tracker = path.join(root, '.leerness', 'progress-tracker.md'), before = fs.readFileSync(tracker);
      const r = call(root, ['lazy', 'detect', '--auto-track']);
      if (!fits) {
        assert.notStrictEqual(r.status, 0);assert.strictEqual(r.json.code, 'history_id_exhausted');
        assert(fs.readFileSync(tracker).equals(before));
      } else {
        const after = fs.readFileSync(tracker, 'utf8');
        assert(after.includes('| T-9007199254740990 |'), r.stdout + r.stderr);
        assert(after.includes('| T-9007199254740991 |'), r.stdout + r.stderr);
        assert(!after.includes('T-9007199254740992'));
      }
    }
  });
  test('index identifiers and hashes must be strings, not coercible arrays', () => {
    for (const key of ['id', 'sourceSha256', 'rowSha256']) {
      const root = project('array-' + key); retain(root, [row('T-0002', 'done', 'typed index', 'x.js implemented')]);
      const file = path.join(root, '.leerness', 'archive', 'history', 'index.json');
      const index = JSON.parse(fs.readFileSync(file, 'utf8'));index.entries[0][key] = [index.entries[0][key]];
      fs.writeFileSync(file, JSON.stringify(index));
      assert.throws(() => H.historyTaskMetadata(root), error => error && error.code === 'history_index_invalid');
    }
  });
  test('active and retained duplicate task IDs are an integrity error', () => {
    const root = project('duplicate-id'); retain(root, [row('T-0001', 'done', 'duplicate', 'x.js implemented')]);
    const r = call(root, ['task', 'list']);
    assert.notStrictEqual(r.status, 0, r.stdout + r.stderr); assert(r.json); assert.strictEqual(r.json.code, 'history_task_duplicate');
  });
  const root = project('integration');
  retain(root, [row('T-0002', 'done', 'retained-only needle', 'x.js implemented')]);
  test('task list includes retained tasks in totals and rows', () => {
    const r = call(root, ['task', 'list', '--all']); assert.strictEqual(r.status, 0, r.stderr || r.stdout); assert(r.json);
    assert.strictEqual(r.json.total, 2); assert.strictEqual(r.json.tasks.some(t => t.id === 'T-0002' && t.retained === true), true);
  });
  test('verify-claim resolves retained task evidence on demand', () => {
    const r = call(root, ['verify-claim', 'T-0002', '--lenient']); assert(r.json, r.stderr || r.stdout);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(r.json.taskId, 'T-0002');
    assert.strictEqual(r.json.row.retained, true);
    assert.strictEqual(r.json.row.evidence, 'x.js implemented');
    assert(r.json.actual.fileChecks.some(file => file.file === 'x.js' && file.exists === true));
  });
  test('retained completion does not pass when its referenced implementation is missing', () => {
    const missing = project('missing-implementation');
    retain(missing, [row('T-0002', 'done', 'retained missing file', 'missing.js implemented')]);
    const r = call(missing, ['verify-claim', 'T-0002', '--lenient']); assert(r.json, r.stdout + r.stderr);
    assert.notStrictEqual(r.status, 0); assert.strictEqual(r.json.taskId, 'T-0002');
    assert.strictEqual(r.json.ok, false);
    assert(r.json.actual.fileChecks.some(file => file.file === 'missing.js' && file.exists === false));
  });
  test('memory search finds retained source content', () => {
    const r = call(root, ['memory', 'search', 'retained-only']); assert.strictEqual(r.status, 0, r.stderr || r.stdout); assert(r.json);
    assert(r.json.results.some(x => /archive\/history/.test(x.file) && /retained-only/.test(x.text)));
  });
  test('memory archive list exposes retained history metadata', () => {
    const r = call(root, ['memory', 'archive', 'list']); assert.strictEqual(r.status, 0, r.stderr || r.stdout); assert(r.json);
    assert.strictEqual(r.json.totals.history, 1); assert(r.json.history.some(x => x.id === 'T-0002'));
  });
  test('new task reserves archived IDs', () => {
    const r = call(root, ['task', 'add', 'new active task', '--status', 'requested']); assert.strictEqual(r.status, 0, r.stderr || r.stdout); assert(r.json);
    assert.strictEqual(r.json.id, 'T-0003');
  });
  test('current context counts retained history and exact lookup can retrieve it', () => {
    const all = call(root, ['context', 'current']); assert.strictEqual(all.status, 0, all.stderr || all.stdout); assert(all.json);
    assert.strictEqual(all.json.history.total, 1); assert.strictEqual(all.json.history.retained, 1);
    const exact = call(root, ['context', 'current', '--task', 'T-0002']); assert.strictEqual(exact.status, 0, exact.stderr || exact.stdout); assert(exact.json);
    assert.strictEqual(exact.json.tasks[0].id, 'T-0002'); assert.strictEqual(exact.json.tasks[0].retained, true);
  });
  test('default JSON list does not read retained bodies outside its bounded window', () => {
    const bounded = project('bounded-list');
    const tracker = path.join(bounded, '.leerness', 'progress-tracker.md');
    const active = Array.from({ length: 120 }, (_, i) => row(`T-${String(i + 100).padStart(4, '0')}`, 'in-progress', `active-${i}`, 'active')).join('\n');
    fs.writeFileSync(tracker, '# Progress Tracker\n\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n' + active + '\n');
    retain(bounded, [row('T-0002', 'done', 'old retained body', 'x.js implemented')]);
    fs.appendFileSync(path.join(bounded, '.leerness', 'archive', 'history', 'retain-20260922-001', 'progress-tracker.md'), 'tamper\n');
    const limited = call(bounded, ['task', 'list']);
    assert.strictEqual(limited.status, 0, limited.stderr || limited.stdout); assert(limited.json);
    assert.strictEqual(limited.json.total, 121); assert.strictEqual(limited.json.shown, 100);
    assert.strictEqual(limited.json.tasks.some(task => task.retained), false);
    const all = call(bounded, ['task', 'list', '--all']);
    assert.notStrictEqual(all.status, 0, all.stdout + all.stderr); assert(all.json); assert.strictEqual(all.json.code, 'history_source_changed');
  });
  test('source digest mismatch is rejected', () => {
    fs.appendFileSync(path.join(root, '.leerness', 'archive', 'history', 'retain-20260922-001', 'progress-tracker.md'), 'tamper\n');
    assert.throws(() => H.findArchivedTask(root, 'T-0002'), error => error && error.code === 'history_source_changed');
  });
  process.stdout.write(`history retention probe: ${passed}/${passed} passed\n`);
} finally { fs.rmSync(arena, { recursive: true, force: true }); }
