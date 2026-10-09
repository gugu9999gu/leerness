'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const W = require('../lib/history-retention-write');
const H = require('../lib/history-retention');
const output = require('../lib/memory-output');
const { withStateLock } = require('../lib/state-lock');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-history-write-'));
const cli = path.resolve(__dirname, '../bin/leerness.js');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const tracker = root => path.join(root, '.leerness', 'progress-tracker.md');
const index = root => path.join(root, '.leerness', 'archive', 'history', 'index.json');
const tasks = ['T-0002', 'T-0003'];
let total = 0, passed = 0, sequence = 0;
function test(name, fn) {
  if (process.env.LEERNESS_PROBE_FILTER && !name.includes(process.env.LEERNESS_PROBE_FILTER)) return;
  total++;
  try { fn();passed++;console.log('PASS ' + name); }
  catch (error) { console.error('FAIL ' + name + ': ' + error.stack); }
}
function row(id, status, request = '한글 작업', evidence = 'x.js implemented') {
  return `| ${id} | ${status} | ${request} | ${evidence} | next | 2026-09-23 |`;
}
function fixture(options = {}) {
  const root = path.join(arena, 'case-' + sequence++);fs.mkdirSync(path.join(root, '.leerness'), { recursive: true });
  const eol = options.eol || '\n';
  const body = ['---', 'leernessRole: progress-tracker', '---', '<!-- leerness:managed -->', '# Progress Tracker', '',
    '| ID | Status | Request | Evidence | Next Action | Updated |', '|---|---|---|---|---|---|',
    row('T-0001', 'in-progress', 'Keep current work'), row('T-0002', 'done', '사용자 기호 🙂 a\\|b'), row('T-0003', 'dropped'), '', 'Authored footer stays exact.', ''].join(eol);
  fs.writeFileSync(tracker(root), (options.bom ? '\uFEFF' : '') + body);
  fs.writeFileSync(path.join(root, '.leerness', 'HARNESS_VERSION'), require('../package.json').version + '\n');
  fs.writeFileSync(path.join(root, '.leerness', 'rules.md'), '# Rules\n');
  fs.writeFileSync(path.join(root, '.leerness', 'plan.md'), '# Plan\n');
  fs.writeFileSync(path.join(root, 'x.js'), 'module.exports = () => 42;\n');
  return root;
}
function snapshot(root) {
  const out = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else { const stat = fs.lstatSync(file, { bigint: true });out[path.relative(root, file)] = [sha(fs.readFileSync(file)), String(stat.mtimeNs)]; }
    }
  }
  visit(root);return out;
}
function call(root, args) {
  const r = spawnSync(process.execPath, [cli, ...args, '--path', root, '--json'], { encoding: 'utf8', timeout: 90000, windowsHide: true,
    env: { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_INTERNAL: '1', LEERNESS_NO_STALE_CHECK: '1' } });
  let data;try { data = JSON.parse(r.stdout); } catch {}
  return { ...r, data };
}
function retain(root, selection = tasks) {
  const preview = W.preview(root, { tasks: selection });
  const result = W.apply(root, { tasks: selection, expected: preview.expected });
  assert.equal(result.state, 'retained');return { preview, result };
}
function refused(root, fn, code) {
  const before = snapshot(root);assert.throws(fn, e => e.code === code, code);assert.deepEqual(snapshot(root), before);
}
function interrupt(root, action, checkpoint) {
  const original = output.publishMemoryOutput;let hit = false, receipt;
  const p = action === 'retain' ? W.preview(root, { tasks }) : W.previewRestore(root, checkpoint.operationId);
  const suffix = typeof checkpoint === 'string' ? checkpoint : checkpoint.suffix;
  output.publishMemoryOutput = function (token, file, bytes) {
    const result = original(token, file, bytes);
    if (!hit && file.replace(/\\/g, '/').endsWith(suffix)) { hit = true;throw Object.assign(new Error('injected interruption'), { code: 'TEST_INTERRUPTED' }); }
    return result;
  };
  try {
    assert.throws(() => action === 'retain' ? W.apply(root, { tasks, expected: p.expected }) : W.restore(root, { operationId: p.operationId, expected: p.expected }), e => e.code === 'TEST_INTERRUPTED');
    receipt = { operationId: p.operationId };
  } finally { output.publishMemoryOutput = original; }
  assert(hit);assert.equal(W.status(root).state, 'pending');return receipt;
}
try {
  test('read-only API and CLI previews preserve file bytes and times', () => {
    const root = fixture(), before = snapshot(root), p = W.preview(root, { tasks });
    assert.equal(p.tasks.length, 2);assert.equal(p.readOnly, true);assert(p.bytes.activeAfter < p.bytes.activeBefore);
    assert.deepEqual(snapshot(root), before);assert(!fs.existsSync(path.dirname(index(root))));
    const r = call(root, ['context', 'history', 'preview', '--tasks', tasks.join(',')]);
    assert.equal(r.status, 0, r.stdout + r.stderr);assert.equal(r.data.expected, p.expected);assert.deepEqual(snapshot(root), before);
  });
  test('CLI apply preserves exact originals and archived evidence lookup and totals', () => {
    const root = fixture({ bom: true, eol: '\r\n' }), before = fs.readFileSync(tracker(root)), p = W.preview(root, { tasks });
    const r = call(root, ['context', 'history', 'apply', '--tasks', tasks.join(','), '--expect', p.expected]);
    assert.equal(r.status, 0, r.stdout + r.stderr);assert.equal(r.data.state, 'retained');
    const original = path.join(path.dirname(index(root)), p.operationId, 'progress-before.md');assert(fs.readFileSync(original).equals(before));
    assert.equal(H.findArchivedTask(root, 'T-0002').request, '사용자 기호 🙂 a|b');
    const list = call(root, ['task', 'list', '--all']);assert.equal(list.status, 0, list.stdout + list.stderr);
    assert.equal(list.data.total, 3);assert.equal(list.data.tasks.length, 3);
    const claim = call(root, ['verify-claim', 'T-0002', '--lenient']);assert.equal(claim.status, 0, claim.stdout + claim.stderr);assert.equal(claim.data.taskId, 'T-0002');
    assert.equal(claim.data.row.retained, true);assert(claim.data.actual.fileChecks.some(x => x.file === 'x.js' && x.exists));
    assert.equal(H.reservedTaskMax(root), 3);
  });
  test('archived IDs remain reserved for the normal CLI task allocator', () => {
    const root = fixture();retain(root);
    const r = call(root, ['task', 'add', 'new current task']);assert.equal(r.status, 0, r.stdout + r.stderr);
    assert(fs.readFileSync(tracker(root), 'utf8').includes('| T-0004 |'));
    assert.equal(H.historyTaskMetadata(root).length, 2);
  });
  test('restore preserves BOM, CRLF, Korean, escaped pipes, symbols and all original bytes', () => {
    const root = fixture({ bom: true, eol: '\r\n' }), before = fs.readFileSync(tracker(root)), { result } = retain(root);
    const p = W.previewRestore(root, result.operationId), r = W.restore(root, { operationId: result.operationId, expected: p.expected });
    assert.equal(r.state, 'restored');assert(fs.readFileSync(tracker(root)).equals(before));assert.equal(H.historyTaskMetadata(root).length, 0);
    const snap = snapshot(root);assert.equal(W.restore(root, { operationId: result.operationId, expected: p.expected }).state, 'already_restored');assert.deepEqual(snapshot(root), snap);
  });
  test('existing index bytes and authored fields survive retain and restore', () => {
    const root = fixture();fs.mkdirSync(path.dirname(index(root)), { recursive: true });
    const value = Buffer.from('\uFEFF{ "schema":"leerness.history-index/v1", "schemaVersion":1, "entries":[], "userNote":"보존" }\r\n');
    fs.writeFileSync(index(root), value);const { result } = retain(root), p = W.previewRestore(root, result.operationId);
    W.restore(root, { operationId: result.operationId, expected: p.expected });assert(fs.readFileSync(index(root)).equals(value));
  });
  test('multiple operations preserve earlier IDs and restore in reverse order', () => {
    const root = fixture(), original = fs.readFileSync(tracker(root));
    const first = retain(root, ['T-0003']).result, firstIndex = fs.readFileSync(index(root)), second = retain(root, ['T-0002']).result;
    assert.equal(H.findArchivedTask(root, 'T-0003').status, 'dropped');assert.equal(H.historyTaskMetadata(root).length, 2);
    refused(root, () => W.previewRestore(root, first.operationId), 'history_restore_conflict');
    for (const op of [second.operationId, first.operationId]) {
      const p = W.previewRestore(root, op);W.restore(root, { operationId: op, expected: p.expected });
      if (op === second.operationId) assert(fs.readFileSync(index(root)).equals(firstIndex));
    }
    assert(fs.readFileSync(tracker(root)).equals(original));
  });
  test('exact apply replay creates no files or new archive chain', () => {
    const root = fixture(), { preview } = retain(root), before = snapshot(root);
    assert.equal(W.apply(root, { tasks, expected: preview.expected }).state, 'already_retained');assert.deepEqual(snapshot(root), before);
    assert(fs.statSync(path.join(root, '.leerness', 'history-operation.json')).size < 512);
  });
  test('oversized proposed index is refused before any operation record is written', () => {
    const root = fixture();fs.mkdirSync(path.dirname(index(root)), { recursive: true });
    const value = { schema: H.SCHEMA, schemaVersion: 1, entries: [], authored: '' };
    value.authored = 'x'.repeat(H.MAX_INDEX_BYTES - Buffer.byteLength(JSON.stringify(value)) - 10);fs.writeFileSync(index(root), JSON.stringify(value));
    refused(root, () => W.preview(root, { tasks }), 'history_index_limit');
  });
  test('source change during artifact preparation preserves the winner and leaves recovery pending', () => {
    const root = fixture(), p = W.preview(root, { tasks }), original = output.publishMemoryOutput;let winner;
    output.publishMemoryOutput = function (token, file, bytes) {
      const r = original(token, file, bytes);
      if (file.endsWith('manifest.json')) { fs.appendFileSync(tracker(root), 'Concurrent authored winner\n');winner = fs.readFileSync(tracker(root)); }
      return r;
    };
    try { assert.throws(() => W.apply(root, { tasks, expected: p.expected }), e => e.code === 'E_STORE_CHANGED'); }
    finally { output.publishMemoryOutput = original; }
    assert(winner && fs.readFileSync(tracker(root)).equals(winner));assert.equal(W.status(root).state, 'pending');
    refused(root, () => W.previewRecover(root, p.operationId), 'history_recovery_conflict');
  });
  test('late retained-original change prevents a successful completion record', () => {
    const root = fixture(), p = W.preview(root, { tasks }), original = output.publishMemoryOutput;
    output.publishMemoryOutput = function (token, file, bytes) {
      const r = original(token, file, bytes);
      if (file.endsWith('retain.json')) fs.appendFileSync(path.join(path.dirname(file), 'progress-before.md'), 'Concurrent change\n');
      return r;
    };
    try { assert.throws(() => W.apply(root, { tasks, expected: p.expected }), e => e.code === 'E_STORE_CHANGED'); }
    finally { output.publishMemoryOutput = original; }
    assert.equal(W.status(root).state, 'pending');
  });
  test('changed source bytes and identity invalidate a preview before journaling', () => {
    for (const identityOnly of [false, true]) {
      const root = fixture(), p = W.preview(root, { tasks });
      if (identityOnly) fs.utimesSync(tracker(root), new Date(), new Date(Date.now() + 10000));
      else fs.appendFileSync(tracker(root), 'New authored note.\n');
      refused(root, () => W.apply(root, { tasks, expected: p.expected }), 'history_preview_stale');
    }
  });
  test('changed index or different project cannot use the same preview', () => {
    const root = fixture(), p = W.preview(root, { tasks });fs.mkdirSync(path.dirname(index(root)), { recursive: true });
    fs.writeFileSync(index(root), JSON.stringify({ schema: H.SCHEMA, schemaVersion: 1, entries: [] }));
    refused(root, () => W.apply(root, { tasks, expected: p.expected }), 'history_preview_stale');
    const other = fixture();refused(other, () => W.apply(other, { tasks, expected: p.expected }), 'history_preview_stale');
  });
  test('selection is explicit and rejects duplicates, open tasks and status aliases', () => {
    const root = fixture();
    for (const selection of [undefined, [], ['T-0002', 'T-0002'], ['T-00002'], ['T-9007199254740992']]) refused(root, () => W.preview(root, { tasks: selection }), 'history_selection_invalid');
    refused(root, () => W.preview(root, { tasks: ['T-0001'] }), 'history_task_not_terminal');
    fs.writeFileSync(tracker(root), fs.readFileSync(tracker(root), 'utf8').replace('| done |', '| completed |'));
    refused(root, () => W.preview(root, { tasks: ['T-0002'] }), 'history_task_not_terminal');
  });
  test('open task references and authored prose retain the selected task in place', () => {
    for (const inRow of [true, false]) {
      const root = fixture();
      if (inRow) fs.writeFileSync(tracker(root), fs.readFileSync(tracker(root), 'utf8').replace('Keep current work', 'Needs T-0002'));
      else fs.appendFileSync(tracker(root), 'Important reference T-0002\n');
      refused(root, () => W.preview(root, { tasks }), 'history_live_reference');
    }
  });
  test('mixed table prose, duplicate rows and unknown columns stop retention', () => {
    for (const edit of [s => s.replace(row('T-0003', 'dropped'), 'User note\n' + row('T-0003', 'dropped')), s => s.replace('T-0003', 'T-0002'), s => s.replace('2026-09-23 |', '2026-09-23 | extra |')]) {
      const root = fixture();fs.writeFileSync(tracker(root), edit(fs.readFileSync(tracker(root), 'utf8')));
      refused(root, () => W.preview(root, { tasks }), 'history_table_ambiguous');
    }
  });
  test('malformed UTF-8, NUL and oversized sources preserve originals', () => {
    for (const [bytes, code] of [[Buffer.from([0xff, 0xfe, 0x61]), 'E_TEXT_ENCODING'], [Buffer.from('bad\0text'), 'history_text_invalid'], [Buffer.alloc(H.MAX_SOURCE_BYTES + 1, 97), 'E_STORE_LIMIT']]) {
      const root = fixture();fs.writeFileSync(tracker(root), bytes);refused(root, () => W.preview(root, { tasks }), code);
    }
  });
  test('linked history directory and hard-linked tracker are refused', () => {
    const root = fixture(), outside = fixture();fs.mkdirSync(path.join(root, '.leerness', 'archive'));
    fs.symlinkSync(outside, path.dirname(index(root)), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => W.preview(root, { tasks }), e => e.code === 'history_path_invalid');
    const second = fixture();fs.linkSync(tracker(second), path.join(second, 'linked.md'));
    refused(second, () => W.preview(second, { tasks }), 'E_STORE_INVALID');
  });
  test('changed source after retention blocks restoration without overwriting new work', () => {
    const root = fixture(), { result } = retain(root);fs.appendFileSync(tracker(root), 'New work must stay.\n');
    refused(root, () => W.previewRestore(root, result.operationId), 'history_restore_conflict');
  });
  test('restore digest becomes stale after file identity changes', () => {
    const root = fixture(), { result } = retain(root), p = W.previewRestore(root, result.operationId);
    fs.utimesSync(tracker(root), new Date(), new Date(Date.now() + 10000));
    refused(root, () => W.restore(root, { operationId: result.operationId, expected: p.expected }), 'history_preview_stale');
  });
  for (const checkpoint of ['history-operation.json', 'progress-before.md', 'index.json', 'progress-tracker.md', '/retain.json']) {
    test('retention recovers an interrupted publication at ' + checkpoint, () => {
      const root = fixture(), before = fs.readFileSync(tracker(root)), { operationId } = interrupt(root, 'retain', checkpoint);
      assert.throws(() => H.reservedTaskMax(root), e => e.code === 'history_index_incomplete');
      const blocked = call(root, ['task', 'add', 'must not reuse an ID']);assert.notEqual(blocked.status, 0);assert.equal(blocked.data.code, 'history_index_incomplete');
      const p = W.previewRecover(root, operationId), snap = snapshot(root);assert(p.readOnly);assert.deepEqual(snapshot(root), snap);
      assert.equal(W.recover(root, { operationId, expected: p.expected }).state, 'retained');assert.equal(H.historyTaskMetadata(root).length, 2);
      const restore = W.previewRestore(root, operationId);W.restore(root, { operationId, expected: restore.expected });assert(fs.readFileSync(tracker(root)).equals(before));
    });
  }
  for (const suffix of ['progress-tracker.md', 'index.json', '/restore.json']) {
    test('restore recovers an interrupted publication at ' + suffix, () => {
      const root = fixture(), before = fs.readFileSync(tracker(root)), { result } = retain(root);
      interrupt(root, 'restore', { operationId: result.operationId, suffix });
      assert.throws(() => H.reservedTaskMax(root), e => e.code === 'history_index_incomplete');
      const p = W.previewRecover(root, result.operationId);W.recover(root, { operationId: p.operationId, expected: p.expected });
      assert(fs.readFileSync(tracker(root)).equals(before));assert.equal(H.historyTaskMetadata(root).length, 0);
    });
  }
  test('unknown current state during recovery never overwrites a concurrent winner', () => {
    const root = fixture(), { operationId } = interrupt(root, 'retain', 'index.json');fs.appendFileSync(tracker(root), 'Concurrent winner\n');
    refused(root, () => W.previewRecover(root, operationId), 'history_recovery_conflict');
  });
  test('changed recovery artifacts and missing originals stay pending', () => {
    for (const missing of [false, true]) {
      const root = fixture(), { operationId } = interrupt(root, 'retain', 'progress-tracker.md');
      const file = path.join(path.dirname(index(root)), operationId, 'progress-before.md');
      if (missing) fs.unlinkSync(file);else fs.appendFileSync(file, 'Changed original\n');
      refused(root, () => W.previewRecover(root, operationId), missing ? 'history_original_missing' : 'history_artifact_changed');
    }
  });
  test('stale recovery preview and unknown operation IDs do not publish', () => {
    const root = fixture(), { operationId } = interrupt(root, 'retain', 'index.json'), p = W.previewRecover(root, operationId);
    fs.utimesSync(tracker(root), new Date(), new Date(Date.now() + 10000));
    refused(root, () => W.recover(root, { operationId, expected: p.expected }), 'history_preview_stale');
    refused(root, () => W.previewRecover(root, '../outside'), 'history_operation_invalid');
  });
  test('malformed operation journal cannot silently expose zero retained history', () => {
    const root = fixture();fs.writeFileSync(path.join(root, '.leerness', 'history-operation.json'), '{}');
    refused(root, () => H.reservedTaskMax(root), 'history_operation_invalid');
  });
  test('CLI malformed options and dry-run leave the project unchanged', () => {
    const root = fixture(), p = W.preview(root, { tasks }), before = snapshot(root);
    for (const tail of [['preview', '--tasks', tasks.join(','), '--tasks', tasks.join(',')], ['preview', '--tasks'], ['apply', '--tasks', tasks.join(','), '--expect', p.expected, '--dry-run'], ['status', '--force']]) {
      const r = call(root, ['context', 'history', ...tail]);assert.notEqual(r.status, 0);assert(r.data && !r.data.ok, r.stdout + r.stderr);assert.deepEqual(snapshot(root), before);
    }
  });
  test('CLI restore follows its preview and retains the exact original bytes', () => {
    const root = fixture({ bom: true }), before = fs.readFileSync(tracker(root)), { result } = retain(root);
    const p = call(root, ['context', 'history', 'preview-restore', '--operation', result.operationId]);assert.equal(p.status, 0, p.stdout + p.stderr);
    const r = call(root, ['context', 'history', 'restore', '--operation', result.operationId, '--expect', p.data.expected]);
    assert.equal(r.status, 0, r.stdout + r.stderr);assert.equal(r.data.state, 'restored');assert(fs.readFileSync(tracker(root)).equals(before));
  });
  test('CLI recovery follows an exact preview and status explains pending operations', () => {
    const root = fixture(), { operationId } = interrupt(root, 'retain', 'index.json');
    const state = call(root, ['context', 'history', 'status']);assert.equal(state.status, 1);assert.equal(state.data.operationId, operationId);
    const p = call(root, ['context', 'history', 'preview-recover', '--operation', operationId]);assert.equal(p.status, 0, p.stdout + p.stderr);
    const r = call(root, ['context', 'history', 'recover', '--operation', operationId, '--expect', p.data.expected]);
    assert.equal(r.status, 0, r.stdout + r.stderr);assert.equal(r.data.state, 'retained');assert.equal(H.historyTaskMetadata(root).length, 2);
  });
  test('CLI project-write policy blocks mutations while allowing a read-only preview', () => {
    const root = fixture(), policy = path.join(root, '.leerness', 'policy.json');
    fs.writeFileSync(policy, JSON.stringify({ schemaVersion: 1, allowedTier: 'read-only', enforce: true }));
    const before = snapshot(root), p = call(root, ['context', 'history', 'preview', '--tasks', tasks.join(',')]);assert.equal(p.status, 0, p.stdout + p.stderr);
    const r = call(root, ['context', 'history', 'apply', '--tasks', tasks.join(','), '--expect', p.data.expected]);
    assert.equal(r.status, 1);assert.equal(r.data.code, 'history_policy_blocked');assert.deepEqual(snapshot(root), before);
  });
  test('library dry-run guard refuses before creating a history journal or lock', () => {
    const root = fixture(), p = W.preview(root, { tasks }), before = snapshot(root), io = require('../lib/io');
    io.setDryRunGuard(true);
    try { assert.throws(() => W.apply(root, { tasks, expected: p.expected }), e => e.code === 'E_DRY_RUN_WRITE'); }
    finally { io.setDryRunGuard(false); }
    assert.deepEqual(snapshot(root), before);
  });
  test('CLI and library honor an incompatible runtime before creating operation files', () => {
    const root = fixture(), p = W.preview(root, { tasks }), descriptor = path.join(root, '.leerness', 'cache', 'state-layout.json');
    fs.mkdirSync(path.dirname(descriptor));fs.writeFileSync(descriptor, JSON.stringify({ schema: 'leerness.runtime-layout/v1', schemaVersion: 1, scope: 'project-local', generation: 1, layout: 'legacy', requiredWriterProtocol: 2 }));
    const before = snapshot(root);
    assert.throws(() => W.apply(root, { tasks, expected: p.expected }), e => e.code === 'E_RUNTIME_LAYOUT_INCOMPATIBLE');
    const r = call(root, ['context', 'history', 'apply', '--tasks', tasks.join(','), '--expect', p.expected]);
    assert.equal(r.status, 1);assert.equal(r.data.code, 'runtime_layout_incompatible');assert.deepEqual(snapshot(root), before);
  });
  test('status does not call a missing index healthy merely because no journal exists', () => {
    const root = fixture();fs.mkdirSync(path.dirname(index(root)), { recursive: true });const before = snapshot(root);
    const state = W.status(root);assert.equal(state.ok, false);assert.equal(state.historyComplete, false);assert.deepEqual(snapshot(root), before);
  });
  test('normal task lock excludes another history operation and supports true nesting', () => {
    const root = fixture(), p = W.preview(root, { tasks });
    withStateLock(tracker(root), () => assert.equal(W.apply(root, { tasks, expected: p.expected }).state, 'retained'));
  });
  test('a genuinely terminated process preserves its owner lock and recovers after confirmed manual release', () => {
    const root = fixture(), before = fs.readFileSync(tracker(root));
    const code = `const O=require(${JSON.stringify(require.resolve('../lib/memory-output'))}); const W=require(${JSON.stringify(require.resolve('../lib/history-retention-write'))});
      const original=O.publishMemoryOutput;O.publishMemoryOutput=function(token,file,bytes){const r=original(token,file,bytes);if(file.endsWith('progress-tracker.md'))process.exit(73);return r;};
      const root=process.argv[1],tasks=['T-0002','T-0003'],p=W.preview(root,{tasks});W.apply(root,{tasks,expected:p.expected});`;
    const child = spawnSync(process.execPath, ['-e', code, root], { encoding: 'utf8', timeout: 60000, windowsHide: true });
    assert.equal(child.status, 73, child.stdout + child.stderr);const state = W.status(root);assert.equal(state.state, 'pending');
    assert.equal(state.progressLockPresent, true);
    refused(root, () => W.previewRecover(root, state.operationId), 'history_lock_recovery_required');
    refused(root, () => W.recover(root, { operationId: state.operationId, expected: 'a'.repeat(64) }), 'history_lock_recovery_required');
    // This fixture owns and has synchronously waited for that exact child to
    // terminate. Preserve its lock evidence; production never infers this from PID.
    const lock = tracker(root) + '.lock', retained = path.join(arena, 'confirmed-ended-lock-' + sequence++);
    assert(lock.startsWith(root + path.sep) && path.dirname(retained) === arena && !fs.existsSync(retained));
    fs.renameSync(lock, retained);
    const p = W.previewRecover(root, state.operationId), recovered = W.recover(root, { operationId: state.operationId, expected: p.expected });
    assert.equal(recovered.state, 'retained');const restore = W.previewRestore(root, state.operationId);
    W.restore(root, { operationId: state.operationId, expected: restore.expected });assert(fs.readFileSync(tracker(root)).equals(before));
  });
  test('completed retention with missing history or replaced index never becomes empty trusted history', () => {
    const root = fixture();retain(root);
    const live = fs.readFileSync(tracker(root));
    const history = path.dirname(index(root)), held = path.join(root, '.leerness', 'held-history');
    fs.renameSync(history, held);
    assert.equal(W.status(root).historyComplete, false);
    assert.throws(() => H.reservedTaskMax(root), e => e.code === 'history_index_incomplete');
    const add = call(root, ['task', 'add', 'Must not reuse a retained ID']);
    assert.notEqual(add.status, 0, add.stdout + add.stderr);
    assert.match(add.stdout + add.stderr, /history_index_incomplete|Retained history is incomplete/);
    assert(fs.readFileSync(tracker(root)).equals(live));
    fs.renameSync(held, history);
    const second = fixture();retain(second);
    fs.writeFileSync(index(second), JSON.stringify({ schema: H.SCHEMA, schemaVersion: 1, entries: [] }) + '\n');
    assert.equal(W.status(second).historyComplete, false);
    assert.throws(() => H.reservedTaskMax(second), e => e.code === 'history_index_incomplete');
    for (const name of ['manifest.json', 'retain.json']) {
      const other = fixture();retain(other);
      const operationId = W.status(other).operationId;
      fs.unlinkSync(path.join(path.dirname(index(other)), operationId, name));
      assert.equal(W.status(other).historyComplete, false);
      assert.throws(() => H.reservedTaskMax(other), e => e.code === 'history_index_incomplete');
    }
  });
  test('task list refuses a cross-read restore instead of reporting missing tasks', () => {
    const root = fixture(), original = fs.readFileSync(tracker(root));retain(root);
    const hook = path.join(root, 'restore-during-task-list.cjs');
    fs.writeFileSync(hook, `const H=require(${JSON.stringify(require.resolve('../lib/history-retention'))});
      const W=require(${JSON.stringify(require.resolve('../lib/history-retention-write'))});
      const normal=H.historyTaskMetadata;let fired=false;
      H.historyTaskMetadata=function(root){if(!fired){fired=true;const op=W.status(root).operationId;
        const p=W.previewRestore(root,op);W.restore(root,{operationId:op,expected:p.expected});}
        return normal(root);};`);
    const raced = spawnSync(process.execPath, ['-r', hook, cli, 'task', 'list', '--all', '--path', root, '--json'],
      { encoding: 'utf8', timeout: 90000, windowsHide: true,
        // T-0337: memory input errors follow the project language; this fixture has no manifest (Korean), so the
        // English text below is asked for with LEERNESS_LANG=en.
        env: { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_INTERNAL: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_LANG: 'en' } });
    assert.notEqual(raced.status, 0, raced.stdout + raced.stderr);
    assert.match(raced.stdout + raced.stderr, /Memory input changed during operation/);
    assert(fs.readFileSync(tracker(root)).equals(original));
    const current = call(root, ['task', 'list', '--all']);
    assert.equal(current.status, 0, current.stdout + current.stderr);
    assert.equal(current.data.total, 3);
  });
} finally {
  assert(path.dirname(arena) === path.resolve(os.tmpdir()) && path.basename(arena).startsWith('leerness-history-write-'));
  fs.rmSync(arena, { recursive: true, force: true });
}
console.log(`history retention writer probe: ${passed}/${total} passed`);
if (passed !== total) process.exitCode = 1;
