'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const git = require('../lib/git');
const API = require('../lib/ui-review-run');
const R = require('../lib/ui-review-run-contract');
const C = require('../lib/review-control');
const { fixture, receipt, encode, identity } = require('./ui-review-fixture');
const { KINDS, INPUT_SCHEMA: OBS_SCHEMA } = require('../lib/ui-review-observation');
const { appendExecutionEvent } = require('../lib/role-fallback');

function cmd(root, args, options = {}) {
  const result = git.gitSpawn(['-C', root, ...args], { cwd: root, encoding: 'utf8', timeout: 15000, ...options });
  assert.equal(result.status, 0, String(result.stderr || result.error)); return result.stdout.trim();
}
function setup(root, { ledger = true, format, materialBytes } = {}) {
  fs.mkdirSync(root);
  cmd(root, ['init', '-q', '--template=', ...(format ? ['--object-format=' + format] : [])]);
  cmd(root, ['config', 'user.name', 'Run Fixture']); cmd(root, ['config', 'user.email', 'run@example.invalid']);
  cmd(root, ['config', 'core.hooksPath', path.join(root, 'empty-hooks')]);
  fs.mkdirSync(path.join(root, '.leerness')); fs.writeFileSync(path.join(root, '.leerness/HARNESS_VERSION'), '1.0.0\n');
  const input = fixture(), files = [];
  for (const kind of KINDS) {
    const name = kind + '.bin', bytes = materialBytes ? Buffer.from(materialBytes[kind])
      : Buffer.concat([Buffer.from('PRIVATE_MATERIAL ' + kind + ' 한글\r\n'), Buffer.from([0, 255, 254, 128])]);
    fs.writeFileSync(path.join(root, name), bytes); input.uiMaterials[0][kind + 'Digest'] = R.sha(bytes);
    files.push({ taskId: 'T-ui', kind, path: name });
  }
  cmd(root, ['add', '--', ...files.map(f => f.path)]); cmd(root, ['commit', '-qm', 'fixture materials']);
  const head = cmd(root, ['rev-parse', 'HEAD']); input.snapshot.checkpoint.snapshot = { kind: 'git', baseCommit: head, headCommit: head };
  const owner = { sessionId: 'owner-1', token: C.createReviewControlToken() };
  const common = { schema: C.INPUT_SCHEMA, batchId: input.snapshot.batch.id, owner };
  const claim = C.writeReviewControl(root, encode({ ...common, operation: 'claim', operationId: 'claim', expectedHead: null, generation: 0, snapshot: null }));
  const control = C.writeReviewControl(root, encode({ ...common, operation: 'publish', operationId: 'publish', expectedHead: claim.head, generation: claim.generation, snapshot: input.snapshot }));
  const run = { schema: API.INPUT_SCHEMA, runId: 'run-1', batchId: common.batchId, owner, generation: control.generation, expectedHead: control.head };
  const s = { root, input, run, common, control, request: { schema: OBS_SCHEMA, input, files }, callbacks: 0 };
  if (ledger) {
    appendExecutionEvent(root, { event: 'dispatch.prepared', eventId: 'start-event', taskId: 'T-ui', attemptId: 'start', requestedRole: 'implementer', requestedExecutor: { ...identity(), identitySource: 'user-declared' }, executed: false });
    appendExecutionEvent(root, { event: 'execution.completed', eventId: 'impl-event', taskId: 'T-ui', attemptId: 'implementation-1', parentAttemptId: 'start', requestedRole: 'implementer',
      actualExecutor: { ...identity(), identitySource: 'user-declared' }, evidenceRefs: [input.uiMaterials[0].sourceDigest, input.uiMaterials[0].diffDigest], executed: true });
  }
  return s;
}
function observe(s, edit, run = s.run, current = s.input) {
  return API.observeUiReviewRun(s.root, encode(run), encode(s.request), encode(current), async supplied => {
    s.callbacks++; const rc = receipt(s.input);
    if (edit) return edit(supplied, rc);
    terminal(s, supplied, rc); return encode(rc);
  });
}
function terminal(s, supplied, rc) {
  appendExecutionEvent(s.root, { event: 'review.completed', eventId: 'review-event', taskId: 'T-ui', attemptId: rc.attemptId,
    parentAttemptId: 'implementation-1', reviewOfAttemptId: 'implementation-1', requestedRole: 'reviewer',
    actualExecutor: { ...rc.reviewer, identitySource: 'user-declared' }, executed: true,
    evidenceRefs: [supplied.packet.packetId, supplied.selectionDigest, R.sha(encode(rc)), ...supplied.implementationEventIds], review: { uiBoundary: rc.review } });
}
function snapshot(root) {
  const out = {};
  function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile()) out[path.relative(root, file)] = [R.sha(fs.readFileSync(file)), String(fs.statSync(file, { bigint: true }).mtimeNs)];
  } }
  walk(root); return out;
}
module.exports = { setup, cmd, observe, terminal, snapshot };
