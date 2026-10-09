'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { createUiReviewPacket: create, INPUT_SCHEMA,
  RECEIPT_SCHEMA, POLICY_VERSION, MAX_BYTES, SUBTYPES } = require('../lib/ui-review');
const { createUiBoundaryTask, REVIEW_SCHEMA } = require('../lib/ui-boundary-contracts');
const { INPUT_SCHEMA: SNAPSHOT_INPUT, MATERIAL_SCHEMA } = require('../lib/review-snapshot');
const hash = c => 'sha256:' + c.repeat(64);
const clone = v => JSON.parse(JSON.stringify(v));
const encode = v => JSON.stringify(v);
const identity = (provider = 'provider-a', model = 'gpt-unit-v1', sessionId = 'session-implementation') => ({ provider, model, sessionId });
function fixture() {
  return { schema: INPUT_SCHEMA, policyVersion: POLICY_VERSION,
    snapshot: { schema: SNAPSHOT_INPUT,
      batch: { id: 'batch-ui', revision: 1, objectiveRevision: 'criteria-1', policyRevision: 'policy-1' },
      materials: { schema: MATERIAL_SCHEMA, manifestDigest: hash('1'), acceptanceDigest: hash('2'),
        policyDigest: hash('3'), evidenceDigest: hash('4'), implementationDigest: hash('5'), dependenciesDigest: hash('6') },
      checkpoint: { schema: 'leerness.review-checkpoint-input/v1',
        objective: { id: 'O-ui', criteria: ['C-copy'] }, context: { event: 'task-report', purposeComplete: true, executionMode: 'direct' },
        snapshot: { kind: 'git', baseCommit: 'a'.repeat(40), headCommit: 'b'.repeat(40) },
        limits: { maxTasks: 100, maxFiles: 10, maxChangedLines: 400, maxWaitingHours: 24 },
        metrics: { fileCount: 2, changedLines: 20, waitingHours: 1 },
        tasks: [{ id: 'T-ui', objectiveId: 'O-ui', criteria: ['C-copy'], dependsOn: [], implementation: 'implemented',
          verification: 'passed', evidenceRefs: ['E-copy'], risk: 'normal', riskTags: [], aspects: ['ux', 'tests'], uiBoundary: createUiBoundaryTask('ui') }],
      } },
    uiMaterials: [{ taskId: 'T-ui', sourceDigest: hash('7'), specDigest: hash('8'), diffDigest: hash('9'), renderDigest: hash('a') }],
    contributors: [{ attemptId: 'implementation-1', taskIds: ['T-ui'], executor: identity() }],
  };
}
const packet = input => create(encode(input));
function receipt(input = fixture()) {
  const p = packet(input);
  return { schema: RECEIPT_SCHEMA, policyVersion: POLICY_VERSION, packetId: p.packetId,
    attemptId: 'review-1', execution: 'completed', reviewer: identity('provider-b', 'claude-unit-v1', 'session-review'),
    coverage: p.taskCoverage.flatMap(t => SUBTYPES.map(subtype => ({ taskId: t.taskId, subtype, outcome: 'no-finding', findingIndexes: [] }))),
    review: { schema: REVIEW_SCHEMA, policyVersion: POLICY_VERSION,
      taskKind: p.applicability === 'not-applicable' ? 'non-ui' : p.applicability === 'unknown' ? 'unknown' : 'ui', evidenceVerified: false, findings: [] },
  };
}
const { captureUiReview: capture, runUiReviewObservation: run, UiReviewObservationError,
  INPUT_SCHEMA: OBS_INPUT, MAX_FILE_BYTES, MAX_TOTAL_BYTES, KINDS } = require('../lib/ui-review-observation');
const sha = b => 'sha256:' + crypto.createHash('sha256').update(b).digest('hex');
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-uib04b-'));
let counter = 0;
function sample(count = 1, size = null) {
  const root = path.join(temp, 'case-' + counter++); fs.mkdirSync(root);
  const input = fixture(), files = [];
  input.snapshot.checkpoint.tasks = [];
  input.uiMaterials = [];
  input.contributors[0].taskIds = [];
  for (let i = 0; i < count; i++) {
    const id = 'T-' + i, task = fixture().snapshot.checkpoint.tasks[0]; task.id = id;
    input.snapshot.checkpoint.tasks.push(task); input.contributors[0].taskIds.push(id);
    const row = { taskId: id };
    for (const kind of KINDS) {
      const name = i + '-' + kind + '.bin';
      const bytes = size === null ? Buffer.from('PRIVATE_MARKER: ' + kind + ' 한글\r\n') : Buffer.alloc(size, i + 1);
      fs.writeFileSync(path.join(root, name), bytes); row[kind + 'Digest'] = sha(bytes);
      files.push({ taskId: id, kind, path: name });
    }
    input.uiMaterials.push(row);
  }
  return { root, input, files, request: () => encode({ schema: OBS_INPUT, input, files }) };
}
function cap(s) { return capture(s.root, s.request()); }
function reject(fn, code) {
  assert.throws(fn, e => e instanceof UiReviewObservationError
    && (!code || e.code === 'ui_observation_' + code) && !String(e).includes('PRIVATE_MARKER'));
}
function mutate(s, kind = 'source') { fs.appendFileSync(path.join(s.root, s.files.find(f => f.kind === kind).path), 'changed'); }
function authority(r) {
  assert.ok(Object.values(r.authority).every(v => v === false));
  assert.deepEqual(r.verification, { snapshotSourceVerified: false, renderOriginVerified: false,
    actorIdentityVerified: false, semanticVerified: false, independentReview: 'not-verified' });
  assert.ok(!encode(r).includes('PRIVATE_MARKER')); assert.ok(!encode(r).includes(temp));
}
test('exact bytes passed once to a real async host callback', async () => {
  const s = sample(), h = cap(s); let calls = 0;
  assert.ok(Object.isFrozen(h.packet.questions)); assert.ok(!encode(h).includes('PRIVATE_MARKER'));
  const r = await run(h, encode(s.input), async ({ packet: p, materials }) => {
    calls++; await Promise.resolve(); assert.equal(p.packetId, h.packet.packetId);
    assert.equal(materials.length, 4);
    for (const m of materials) { assert.equal(sha(m.bytes), m.digest); assert.ok(m.bytes.includes('PRIVATE_MARKER')); assert.equal(m.path, undefined); }
    return encode(receipt(s.input));
  });
  assert.equal(calls, 1); assert.equal(r.state, 'observed-review'); assert.equal(r.materialBytes.current, true);
  assert.deepEqual(r.execution, { kind: 'host-callback', state: 'returned', receiptValidated: true });
  assert.equal(r.assessment.state, 'review-candidate'); assert.equal(r.assessment.trust, 'caller-declarations'); authority(r);
  await assert.rejects(run(h, encode(s.input), () => ''), UiReviewObservationError);
});
for (const kind of KINDS) {
  test('digest mismatch before callback: ' + kind, () => { const s = sample(); mutate(s, kind); reject(() => cap(s), 'digest_mismatch'); });
  test('changed before callback: ' + kind, async () => {
    const s = sample(), h = cap(s); mutate(s, kind);
    const r = await run(h, encode(s.input), () => { throw Error('must not run'); });
    assert.equal(r.state, 'stale'); assert.equal(r.execution.state, 'not-run'); authority(r);
  });
  test('changed during callback: ' + kind, async () => {
    const s = sample(), h = cap(s);
    const r = await run(h, encode(s.input), async () => { mutate(s, kind); return encode(receipt(s.input)); });
    assert.equal(r.state, 'stale'); assert.equal(r.assessment, null); assert.equal(r.execution.receiptValidated, false); authority(r);
  });
  test('mutated callback buffer: ' + kind, async () => {
    const s = sample(), h = cap(s);
    const r = await run(h, encode(s.input), ({ materials }) => { materials.find(m => m.kind === kind).bytes.fill(0); return encode(receipt(s.input)); });
    assert.equal(r.reasonCode, 'callback_materials_changed'); assert.equal(r.state, 'invalid'); authority(r);
    assert.doesNotThrow(() => cap(s));
  });
}
for (const name of ['../escape', '/absolute', 'C:/absolute', 'a\\b', 'a//b', './a', 'a/../b', 'a:b', 'a.', 'a b', 'NUL.txt', 'com1', 'a/CON', 'a\0b', 'x'.repeat(101), 'a/'.repeat(32) + 'b', '']) {
  test('reject portable path before I/O: ' + JSON.stringify(name), () => {
    const s = sample(); s.files[0].path = name;
    const original = fs.lstatSync; let calls = 0;
    fs.lstatSync = () => { calls++; throw Error('no I/O'); };
    try { reject(() => cap(s), 'path_invalid'); assert.equal(calls, 0); } finally { fs.lstatSync = original; }
  });
}
for (const [name, edit] of [
  ['missing', s => s.files.pop()], ['extra', s => s.files.push(s.files[0])],
  ['duplicate', s => { s.files[1] = s.files[0]; }], ['foreign task', s => { s.files[0].taskId = 'T-foreign'; }],
  ['kind', s => { s.files[0].kind = 'PRIVATE_MARKER'; }], ['raw field', s => { s.files[0].raw = 'PRIVATE_MARKER'; }],
]) test('file membership: ' + name, () => { const s = sample(); edit(s); reject(() => cap(s)); });
for (const text of ['null', '{}', '{', '{"schema":1,"schema":2}', '{"x":"PRIVATE_MARKER"}', ' '.repeat(MAX_BYTES + 1)]) {
  test('strict request parser ' + text.slice(0, 12), () => reject(() => capture(temp, text)));
}
test('null declared material requires context', () => { const s = sample(); s.input.uiMaterials[0].specDigest = null; reject(() => cap(s), 'packet_not_ready'); });
test('relative root is not accepted', () => { const s = sample(); reject(() => capture('.', s.request()), 'root_invalid'); });
test('missing material rejected', () => { const s = sample(); fs.unlinkSync(path.join(s.root, s.files[0].path)); reject(() => cap(s), 'material_missing'); });
test('directory is not a material', () => { const s = sample(); const f = path.join(s.root, s.files[0].path); fs.unlinkSync(f); fs.mkdirSync(f); reject(() => cap(s)); });
test('hard linked material rejected', () => { const s = sample(); fs.linkSync(path.join(s.root, s.files[0].path), path.join(s.root, 'alias')); reject(() => cap(s)); });
test('nested normal parent is supported', () => {
  const s = sample(); fs.mkdirSync(path.join(s.root, 'nested'));
  for (const f of s.files) { fs.renameSync(path.join(s.root, f.path), path.join(s.root, 'nested', f.path)); f.path = 'nested/' + f.path; }
  assert.equal(cap(s).materials.length, 4);
});
test('symlink or junction parent is rejected', () => {
  const s = sample(), outside = sample();
  fs.symlinkSync(outside.root, path.join(s.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  s.files[0].path = 'linked/' + outside.files[0].path; reject(() => cap(s), 'directory_unsupported');
});
test('same-content replacement remains stale', async () => {
  const s = sample(), h = cap(s), f = path.join(s.root, s.files[0].path), bytes = fs.readFileSync(f);
  fs.renameSync(f, f + '.original'); fs.writeFileSync(f, bytes);
  const r = await run(h, encode(s.input), () => encode(receipt(s.input))); assert.equal(r.state, 'stale');
});
test('parent replacement remains stale', async () => {
  const s = sample(), h = cap(s); fs.renameSync(s.root, s.root + '-old'); fs.mkdirSync(s.root);
  for (const f of s.files) fs.copyFileSync(path.join(s.root + '-old', f.path), path.join(s.root, f.path));
  const r = await run(h, encode(s.input), () => encode(receipt(s.input))); assert.equal(r.state, 'stale');
});
test('exact file byte limit accepted', () => { const s = sample(1, MAX_FILE_BYTES); assert.equal(cap(s).totalBytes, 4 * MAX_FILE_BYTES); });
test('over file byte limit rejected', () => { const s = sample(1, MAX_FILE_BYTES + 1); reject(() => cap(s), 'byte_limit'); });
test('exact total byte limit accepted', () => { const s = sample(2, MAX_FILE_BYTES); assert.equal(cap(s).totalBytes, MAX_TOTAL_BYTES); });
test('over total byte limit rejected', () => { const s = sample(3, MAX_FILE_BYTES); reject(() => cap(s), 'byte_limit'); });
test('empty binary bytes accepted without text coercion', () => { const s = sample(1, 0); assert.equal(cap(s).totalBytes, 0); });
test('non UTF-8 bytes hash exactly', () => { const s = sample(1, 20); for (const f of s.files) { const b = Buffer.from([255, 0, 254]); fs.writeFileSync(path.join(s.root, f.path), b); s.input.uiMaterials[0][f.kind + 'Digest'] = sha(b); } assert.equal(cap(s).totalBytes, 12); });
test('32 UI tasks retain complete 128 material binding', async () => {
  const s = sample(32, 0), h = cap(s); assert.equal(h.materials.length, 128);
  const r = await run(h, encode(s.input), () => encode(receipt(s.input))); assert.equal(r.assessment.declaredCoverage.length, 160);
});
test('stale packet prevents callback', async () => {
  const s = sample(), h = cap(s); s.input.contributors[0].attemptId = 'changed';
  const r = await run(h, encode(s.input), () => { throw Error('not reached'); }); assert.equal(r.state, 'stale'); assert.equal(r.execution.state, 'not-run');
});
test('same digest but current capacity problem prevents callback', async () => {
  const s = sample(), h = cap(s); s.input.snapshot.checkpoint.metrics.fileCount = 100;
  const r = await run(h, encode(s.input), () => { throw Error('not reached'); }); assert.equal(r.state, 'needs-context'); assert.equal(r.execution.state, 'not-run');
});
test('callback throw redacted and not retried', async () => {
  const s = sample(), h = cap(s); let calls = 0;
  const r = await run(h, encode(s.input), () => { calls++; throw Error('PRIVATE_MARKER'); });
  assert.equal(calls, 1); assert.equal(r.state, 'failed'); assert.equal(r.execution.state, 'threw'); authority(r);
});
for (const value of [undefined, null, {}, 'null', 'PRIVATE_MARKER', '{"x":1,"x":2}']) {
  test('invalid callback receipt ' + typeof value + String(value).slice(0, 9), async () => {
    const s = sample(), h = cap(s); const r = await run(h, encode(s.input), () => value);
    assert.equal(r.reasonCode, 'receipt_invalid'); assert.equal(r.execution.receiptValidated, false); authority(r);
  });
}
for (const [name, edit, expected] of [
  ['same actor', r => { r.reviewer = identity(); }, 'self-review'],
  ['unknown actor', r => { r.reviewer = null; }, 'identity-unverified'],
  ['partial', r => { r.execution = 'partial'; }, 'incomplete'],
  ['failed declaration', r => { r.execution = 'failed'; }, 'incomplete'],
  ['missing semantic cell', r => { r.coverage.pop(); }, 'incomplete'],
  ['inconclusive', r => { r.coverage[0].outcome = 'inconclusive'; }, 'incomplete'],
  ['wrong binding', r => { r.packetId = hash('c'); }, 'stale'],
]) test('observed callback preserves assessment: ' + name, async () => {
  const s = sample(), h = cap(s), rc = receipt(s.input); edit(rc);
  const r = await run(h, encode(s.input), () => encode(rc)); assert.equal(r.assessment.state, expected); authority(r);
});
test('deterministic callback can report a finding tied to bytes', async () => {
  const s = sample(), h = cap(s);
  const r = await run(h, encode(s.input), ({ materials }) => {
    const m = materials.find(m => m.kind === 'source'), rc = receipt(s.input);
    assert.ok(m.bytes.includes('PRIVATE_MARKER'));
    rc.review.findings = [{ category: 'instruction_to_ui_leakage', subtype: 'DEVELOPER_NOTE', sourceKind: 'developer_note',
      severity: 'advisory', disposition: 'review-remediation', evidenceDigest: m.digest }];
    Object.assign(rc.coverage.find(c => c.subtype === 'DEVELOPER_NOTE'), { outcome: 'finding', findingIndexes: [0] });
    return encode(rc);
  });
  assert.equal(r.assessment.state, 'findings'); authority(r);
});
test('JSON copy cannot forge an observed capture', async () => {
  const s = sample(), h = cap(s); await assert.rejects(run(clone(h), encode(s.input), () => ''), UiReviewObservationError);
});
test('concurrent callback cannot reuse the same capture', async () => {
  const s = sample(), h = cap(s); let unblock; const pending = new Promise(resolve => { unblock = resolve; });
  const first = run(h, encode(s.input), async () => { await pending; return encode(receipt(s.input)); });
  await assert.rejects(run(h, encode(s.input), () => ''), UiReviewObservationError); unblock(); assert.equal((await first).state, 'observed-review');
});
test('cleanup failure cannot yield a valid capture', () => {
  const s = sample(), close = fs.closeSync; let failed = false;
  fs.closeSync = fd => { close(fd); if (!failed) { failed = true; throw Error('PRIVATE_MARKER'); } };
  try { reject(() => cap(s), 'materials_unavailable'); } finally { fs.closeSync = close; }
});
test('read failure has no path or original error in output', () => {
  const s = sample(), read = fs.readSync; fs.readSync = () => { throw Error('PRIVATE_MARKER'); };
  try { reject(() => cap(s), 'materials_unavailable'); } finally { fs.readSync = read; }
});
test('successful observation makes no collector writes or subprocess calls', async () => {
  const s = sample(), h = cap(s), originals = [];
  for (const [obj, key] of [[fs, 'writeFileSync'], [fs, 'appendFileSync'], [cp, 'spawn'], [cp, 'spawnSync'], [cp, 'execSync']]) {
    originals.push([obj, key, obj[key]]); obj[key] = () => { throw Error('side effect'); };
  }
  try { const r = await run(h, encode(s.input), () => encode(receipt(s.input))); assert.equal(r.state, 'observed-review'); }
  finally { for (const [obj, key, value] of originals) obj[key] = value; }
});
for (const crossTask of [false, true]) test('reject finding citing ' + (crossTask ? 'another task' : 'unread bytes'), async () => {
  const s = sample(2, 10), h = cap(s), rc = receipt(s.input);
  rc.review.findings = [{ category: 'instruction_to_ui_leakage', subtype: 'DEVELOPER_NOTE', sourceKind: 'developer_note',
    severity: 'advisory', disposition: 'review-remediation', evidenceDigest: crossTask ? s.input.uiMaterials[1].sourceDigest : hash('a') }];
  Object.assign(rc.coverage.find(c => c.taskId === 'T-0' && c.subtype === 'DEVELOPER_NOTE'), { outcome: 'finding', findingIndexes: [0] });
  const r = await run(h, encode(s.input), () => encode(rc));
  assert.equal(r.reasonCode, 'finding_material_unbound'); assert.equal(r.execution.receiptValidated, false); assert.equal(r.assessment, null);
});
test('security finding preserves delegation while binding observed bytes', async () => {
  const s = sample(), h = cap(s), rc = receipt(s.input);
  rc.review.findings = [{ category: 'security', subtype: 'DEBUG_METADATA', sourceKind: 'debug_metadata',
    severity: 'delegated', disposition: 'review-remediation', evidenceDigest: s.input.uiMaterials[0].renderDigest }];
  Object.assign(rc.coverage.find(c => c.subtype === 'DEBUG_METADATA'), { outcome: 'finding', findingIndexes: [0] });
  const r = await run(h, encode(s.input), () => encode(rc)); assert.equal(r.assessment.state, 'findings'); authority(r);
});
test('collector never overwrites a false caller digest to make capture pass', () => {
  const s = sample(); s.input.uiMaterials[0].sourceDigest = hash('c'); const before = s.request();
  reject(() => cap(s), 'digest_mismatch'); assert.equal(s.request(), before);
});
test('later-file read mutating earlier material is caught by final recheck', () => {
  const s = sample(), read = fs.readSync; let n = 0;
  fs.readSync = (...args) => { const out = read(...args); if (++n === 3) mutate(s, 'diff'); return out; };
  try { reject(() => cap(s), 'materials_changed'); } finally { fs.readSync = read; }
});
test('bounded read stops after at most a file limit plus sentinel', () => {
  const s = sample(), read = fs.readSync; let consumed = 0;
  fs.readSync = (_fd, buffer, offset, length) => { buffer.fill(1, offset, offset + length); consumed += length; return length; };
  try { reject(() => cap(s), 'byte_limit'); assert.equal(consumed, MAX_FILE_BYTES + 1); } finally { fs.readSync = read; }
});
test('file-list order does not change canonical observation metadata', () => {
  const s = sample(), h = cap(s); s.files.reverse(); assert.deepEqual(cap(s), h);
});
test('same bytes in another root retain packet but change selection identity', () => {
  const a = cap(sample()), b = cap(sample());
  assert.equal(a.packet.packetId, b.packet.packetId); assert.notEqual(a.selectionDigest, b.selectionDigest);
});
test('same bytes under renamed material path change selection identity', () => {
  const s = sample(), a = cap(s), f = s.files[0];
  fs.renameSync(path.join(s.root, f.path), path.join(s.root, 'renamed.bin')); f.path = 'renamed.bin';
  const b = cap(s); assert.equal(a.packet.packetId, b.packet.packetId); assert.notEqual(a.selectionDigest, b.selectionDigest);
});
test('invalid current input cannot invoke or reuse callback', async () => {
  const s = sample(), h = cap(s);
  await assert.rejects(run(h, 'PRIVATE_MARKER', () => { throw Error('not reached'); }), UiReviewObservationError);
  await assert.rejects(run(h, encode(s.input), () => ''), UiReviewObservationError);
});
test('invalid reviewer does not consume capture', async () => {
  const s = sample(), h = cap(s); await assert.rejects(run(h, encode(s.input), null), UiReviewObservationError);
  assert.equal((await run(h, encode(s.input), () => encode(receipt(s.input)))).state, 'observed-review');
});
test('callback completed with not-run declaration does not imply semantic execution', async () => {
  const s = sample(), h = cap(s), rc = receipt(s.input);
  Object.assign(rc, { execution: 'not-run', attemptId: null, reviewer: null, coverage: [] });
  const r = await run(h, encode(s.input), () => encode(rc)); assert.equal(r.execution.state, 'returned'); assert.equal(r.assessment.state, 'not-reviewed'); authority(r);
});
test('callback output mutation cannot alter frozen result', async () => {
  const s = sample(), h = cap(s), rc = receipt(s.input);
  const r = await run(h, encode(s.input), () => encode(rc)); rc.reviewer.provider = 'changed';
  assert.ok(Object.isFrozen(r.assessment)); assert.ok(Object.isFrozen(r.materialBytes));
});
test('metadata change after capture remains stale even if bytes match', async () => {
  const s = sample(), h = cap(s), f = path.join(s.root, s.files[0].path);
  fs.utimesSync(f, new Date(0), new Date(0)); const r = await run(h, encode(s.input), () => encode(receipt(s.input))); assert.equal(r.state, 'stale');
});
test('callback deletion invalidates captured material', async () => {
  const s = sample(), h = cap(s);
  const r = await run(h, encode(s.input), () => { fs.unlinkSync(path.join(s.root, s.files[0].path)); return encode(receipt(s.input)); });
  assert.equal(r.state, 'stale'); assert.equal(r.assessment, null);
});
(async () => {
  let passed = 0;
  try {
    for (const t of cases) {
      try { await t.fn(); passed++; console.log('PASS ' + t.name); }
      catch (e) { console.error('FAIL ' + t.name + '\n' + e.stack); }
    }
  } finally {
    const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('leerness-uib04b-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  console.log(`UI review observation: ${passed}/${cases.length} passed`);
  process.exitCode = passed === cases.length ? 0 : 1;
})();
