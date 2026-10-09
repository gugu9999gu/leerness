'use strict';

const { TextDecoder } = require('node:util');
const C = require('./review-control-contract');
const G = require('./review-control-git');
const R = require('./ui-review-run-contract');
const Q = require('./openai-ui-review-request');
const O = require('./ui-review-observation');
const L = require('./ui-review-ledger');
const POLICY = 'leerness.ui-review-recovery-policy/v1';
const SCHEMA = 'leerness.ui-review-recovery-bundle/v1';
const META = 'leerness.ui-review-recovery-metadata/v1';
const SHA = /^sha256:[0-9a-f]{64}$/;
const integer = v => typeof v === 'string' && /^-?[0-9]{1,25}$/.test(v);
const text = v => typeof v === 'string' && v.length > 0 && v.length <= 32768 && !v.includes('\0');
function policy(v) {
  Q.exact(v, ['schema', 'materials', 'ledger', 'reviewAttemptId']);
  if (v.schema !== POLICY || v.materials !== 'local-git-until-explicit-removal'
    || v.ledger !== 'identity-and-prefix-digest' || typeof v.reviewAttemptId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v.reviewAttemptId)) C.fail('recovery_policy_invalid');
  return v;
}
function identity(v) {
  Q.exact(v, ['parent', 'resolvedParent', 'stat']);
  Q.exact(v.parent, ['dev', 'ino', 'mode']);
  Q.exact(v.stat, ['dev', 'ino', 'mode', 'size', 'nlink', 'mtimeNs', 'ctimeNs']);
  if (!text(v.resolvedParent) || !Object.values(v.parent).every(integer) || !Object.values(v.stat).every(integer)
    || v.stat.nlink !== '1') C.fail('recovery_record_invalid');
}
function validate(v, request) {
  Q.exact(v, ['schema', 'policy', 'capture', 'ledger']); policy(v.policy);
  if (v.schema !== META) C.fail('recovery_record_invalid');
  Q.exact(v.capture, ['directories', 'files']);
  const rows = v.capture.files, dirs = v.capture.directories;
  if (!Array.isArray(rows) || rows.length !== 4 || !Array.isArray(dirs) || !dirs.length || dirs.length > 129
    || request.input.uiMaterials.length !== 1 || request.files.length !== 4) C.fail('recovery_record_invalid');
  if (new Set(rows.map(f => f.kind)).size !== 4) C.fail('recovery_record_invalid');
  const expectedDirs = new Set(['']), expected = request.files.map(f => f.taskId + '/' + f.kind).sort();
  if (C.stable(rows.map(f => f.taskId + '/' + f.kind)) !== C.stable(expected)) C.fail('recovery_record_invalid');
  for (const row of rows) {
    Q.exact(row, ['taskId', 'kind', 'path', 'digest', 'byteLength', 'identity']); identity(row.identity);
    const parts = O.portablePath(row.path), f = request.files.find(f => f.taskId === row.taskId && f.kind === row.kind);
    if (!f || f.path !== row.path || !O.KINDS.includes(row.kind) || row.taskId !== request.input.uiMaterials[0].taskId
      || row.digest !== request.input.uiMaterials[0][row.kind + 'Digest'] || !C.match(row.digest, SHA)
      || !Number.isInteger(row.byteLength) || row.byteLength < 0 || row.byteLength > O.MAX_FILE_BYTES
      || row.identity.stat.size !== String(row.byteLength)) C.fail('recovery_record_invalid');
    for (let i = 1; i < parts.length; i++) expectedDirs.add(parts.slice(0, i).join('/'));
  }
  for (const dir of dirs) {
    Q.exact(dir, ['path', 'resolved', 'dev', 'ino', 'mode']);
    if (!expectedDirs.delete(dir.path) || !text(dir.resolved) || ![dir.dev, dir.ino, dir.mode].every(integer)) C.fail('recovery_record_invalid');
  }
  if (expectedDirs.size) C.fail('recovery_record_invalid');
  const b = v.ledger;
  Q.exact(b, ['schema', 'reviewAttemptId', 'description', 'prefixBytes', 'prefixDigest', 'eventCount', 'implementationEventIds']);
  identity(b.description);
  if (b.schema !== 'leerness.ui-review-ledger-baseline/v1' || b.reviewAttemptId !== v.policy.reviewAttemptId
    || !Number.isInteger(b.prefixBytes) || b.prefixBytes < 1 || b.prefixBytes > L.MAX_LEDGER_BYTES
    || b.description.stat.size !== String(b.prefixBytes) || !C.match(b.prefixDigest, SHA)
    || !Number.isInteger(b.eventCount) || b.eventCount < 1 || b.eventCount > L.MAX_EVENTS
    || !Array.isArray(b.implementationEventIds) || b.implementationEventIds.length !== request.input.contributors.length
    || !b.implementationEventIds.length || b.implementationEventIds.length > L.MAX_EVENTS
    || new Set(b.implementationEventIds).size !== b.implementationEventIds.length
    || b.implementationEventIds.some(id => !text(id) || id.length > 128)) C.fail('recovery_record_invalid');
}
function prepare(root, request, capture, policyJson) {
  const declared = policy(R.parse(policyJson));
  const ledger = L.captureUiReviewLedgerBaseline(root, JSON.stringify(request.input), declared.reviewAttemptId);
  const metadata = Q.freeze({ schema: META, policy: declared, capture: O.describeUiReviewCapture(capture), ledger });
  validate(metadata, request); L.assertUiReviewLedgerBaselineCurrent(ledger);
  return { metadata, ledger, capture };
}
function assertCurrent(prepared) {
  if (C.stable(O.describeUiReviewCapture(prepared.capture)) !== C.stable(prepared.metadata.capture)) C.fail('recovery_materials_changed');
  L.assertUiReviewLedgerBaselineCurrent(prepared.ledger);
}
function manifest(ctx, value) {
  return { schema: SCHEMA, projectKey: ctx.projectKey, batchId: ctx.batchId, runId: value.runId,
    requestDigest: value.requestDigest, bindingDigest: value.bindingDigest, recoveryDigest: C.digest(value.recovery) };
}
function oid(ctx, args, bytes) {
  const out = G.output(ctx, args, bytes, 1024).trim();
  if (!C.match(out, C.OID)) C.fail('recovery_git_invalid');
  return out;
}
function prepareCommit(ctx, reservationHead, value, prepared) {
  validate(value.recovery, value.request); assertCurrent(prepared);
  if (C.stable(prepared.metadata) !== C.stable(value.recovery)) C.fail('recovery_changed');
  const files = O.readUiReviewMaterialSnapshot(prepared.capture);
  const entries = files.map((f, i) => `100644 blob ${oid(ctx, ['hash-object', '-w', '--stdin'], f.bytes)}\tmaterial-${i}\n`);
  entries.push(`100644 blob ${oid(ctx, ['hash-object', '-w', '--stdin'], R.encode(manifest(ctx, value)))}\trecord.json\n`);
  const tree = oid(ctx, ['mktree'], entries.join(''));
  return oid(ctx, ['commit-tree', tree, '-p', reservationHead, '--no-gpg-sign'], 'leerness UI recovery bundle v1\n');
}
function read(ctx, head, reservationHead, value) {
  validate(value.recovery, value.request);
  if (!C.match(head, C.OID) || !C.match(reservationHead, C.OID)) C.fail('recovery_record_invalid');
  const commit = G.output(ctx, ['cat-file', 'commit', head], undefined, 2048);
  const headers = commit.split('\n\n')[0].split('\n');
  const tree = /^tree ([0-9a-f]+)$/.exec(headers[0]), parent = /^parent ([0-9a-f]+)$/.exec(headers[1]);
  if (headers.length !== 4 || !/^author [^\0]+$/.test(headers[2]) || !/^committer [^\0]+$/.test(headers[3])
    || !tree || !C.match(tree[1], C.OID) || !parent || parent[1] !== reservationHead) C.fail('recovery_record_invalid');
  const entries = G.output(ctx, ['ls-tree', '-z', tree[1]], undefined, 2048).split('\0');
  if (entries.pop() !== '' || entries.length !== 5) C.fail('recovery_record_invalid');
  const blobs = entries.map((line, i) => {
    const m = /^100644 blob ([0-9a-f]+)\t([^\0]+)$/.exec(line);
    if (!m || !C.match(m[1], C.OID) || m[2] !== (i === 4 ? 'record.json' : 'material-' + i)) C.fail('recovery_record_invalid');
    return m[1];
  });
  const raw = G.output(ctx, ['cat-file', 'blob', blobs[4]], undefined, 65536, null);
  const json = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  if (json !== R.encode(manifest(ctx, value))) C.fail('recovery_record_invalid');
  return value.recovery.capture.files.map((f, i) => {
    const bytes = G.output(ctx, ['cat-file', 'blob', blobs[i]], undefined, O.MAX_FILE_BYTES, null);
    if (bytes.length !== f.byteLength || R.sha(bytes) !== f.digest) C.fail('recovery_materials_changed');
    return { taskId: f.taskId, kind: f.kind, digest: f.digest, bytes };
  });
}
function restore(root, value, beforeDispatch = false, observedPrefix) {
  validate(value.recovery, value.request);
  const capture = O.captureUiReview(root, JSON.stringify(value.request));
  if (C.stable(O.describeUiReviewCapture(capture)) !== C.stable(value.recovery.capture)
    || capture.selectionDigest !== value.selectionDigest) C.fail('recovery_materials_changed');
  const ledger = L.restoreUiReviewLedgerBaseline(root, JSON.stringify(value.request.input), value.recovery.ledger, beforeDispatch, observedPrefix);
  // Recheck the materials after reading the ledger; no bytes are written back.
  O.readUiReviewMaterialSnapshot(capture);
  return ledger;
}

module.exports = { POLICY, SCHEMA, prepare, assertCurrent, prepareCommit, read, restore, validate };
