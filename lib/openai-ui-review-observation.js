'use strict';

const { randomUUID } = require('node:crypto');
const C = require('./review-control-contract');
const G = require('./review-control-git');
const R = require('./ui-review-run-contract');
const A = require('./ui-review-attempt');
const E = require('./ui-review-result');
const J = require('./openai-ui-review-journal');
const K = require('./openai-ui-review-observation-record');
const Q = require('./openai-ui-review-request');
const B = require('./ui-review-recovery-bundle');
const D = require('./ui-review-provider-receipt');
const { retrieveOpenAiResponse } = require('./openai-response-retrieval');
const { rootPath, control } = require('./ui-review-run-context');
const { withRuntimeWrites } = require('./runtime-writes');
const { assertWriteAllowed } = require('./io');
const { assertGitWriteAllowed } = require('./git');
const authority = () => ({ ...R.authority(), retryAllowed: false, executionBindingVerified: false });
function context(ctx, runId) {
  return { ...ctx, ref: `refs/leerness/provider-observations/v1/${ctx.projectKey}/${C.digest(runId).slice(7)}` };
}
function check(s, prefix) {
  const { ctx, run, journal, receiptMode } = s;
  control(ctx, run, journal.snapshotId); J.unchanged(ctx, run.runId, journal);
  const ledger = receiptMode ? B.restore(ctx.root, journal.intent.value, false, prefix) : null;
  control(ctx, run, journal.snapshotId); J.unchanged(ctx, run.runId, journal);
  return ledger;
}
function load(root, runJson, currentJson, profileJson, receiptMode, storedMode = false) {
  rootPath(root);
  const run = R.request(runJson), profile = Q.profile(R.parse(profileJson)), ctx = G.context(root, run.batchId);
  const journal = J.read(ctx, run.runId);
  if (!journal?.locator) C.fail('dispatch_locator_missing');
  const v = journal.intent.value;
  if (C.stable(run) !== C.stable(v.run)) C.fail('dispatch_run_mismatch');
  if (C.stable(profile) !== C.stable(v.config.profile)) C.fail('dispatch_profile_mismatch');
  if (receiptMode) {
    if (![J.RECEIPT_SCHEMA, J.OBSERVATION_SCHEMA].includes(v.schema)) C.fail('receipt_policy_missing');
    if (C.digest(R.parse(currentJson)) !== v.currentInputDigest) C.fail('snapshot_mismatch');
  }
  if (storedMode && v.schema !== J.OBSERVATION_SCHEMA) C.fail('observation_policy_missing');
  const s = { ctx, run, journal, receiptMode, currentJson };
  check(s); return s;
}
function output(s, result, ledger, observed) {
  const j = s.journal, v = j.intent.value;
  return { schema: 'leerness.openai-ui-review-receipt-observation/v1', runId: s.run.runId,
    intentHead: j.intent.head, locatorHead: j.locator.head, attemptHead: j.attempt.head,
    requestDigest: v.requestDigest, packetId: v.packetId, selectionDigest: v.selectionDigest,
    responseId: j.locator.value.response.id, responseDigest: result.ok ? C.digest(result.response) : null,
    ledger, ...observed, provenance: 'bound-get-in-current-process',
    ledgerLinked: false, runRecordRestored: false, ...authority() };
}
async function fetch(s, key) {
  const j = s.journal, v = j.intent.value;
  const result = await retrieveOpenAiResponse(JSON.stringify({ ...Q.transportScope(v.config), responseId: j.locator.value.response.id }), key);
  const ledger = check(s);
  const observed = s.receiptMode ? D.assess(v, result, s.currentJson, j.locator.value.response) : null;
  return { result, ledger, observed };
}
async function retrieve(root, runJson, profileJson, key, currentJson, receiptMode) {
  const s = load(root, runJson, currentJson, profileJson, receiptMode), { result, ledger, observed } = await fetch(s, key);
  if (receiptMode) return Q.freeze(output(s, result, ledger, observed));
  return Q.freeze({ schema: 'leerness.openai-ui-review-dispatch-retrieval/v1', runId: s.run.runId,
    intentHead: s.journal.intent.head, locatorHead: s.journal.locator.head, requestDigest: s.journal.intent.value.requestDigest,
    observation: result, ...authority() });
}
const prefix = ledger => ({ bytes: ledger.afterBytes, digest: ledger.afterDigest });
function stored(s) {
  const target = context(s.ctx, s.run.runId), head = G.readRef(target);
  if (!head) return null;
  const commit = G.readCommit(s.ctx, head), { value: v, observed } = K.decode(commit.bytes, s.ctx, s.journal, s.currentJson);
  if (commit.parents.length !== 1 || commit.parents[0] !== s.journal.locator.head) C.fail('observation_record_invalid');
  check(s, prefix(v.ledger));
  if (G.readRef(target) !== head) C.fail('observation_changed');
  return Q.freeze({ ...output(s, { ok: true, response: v.response }, v.ledger, observed),
    schema: 'leerness.openai-ui-review-stored-observation/v1', observationId: v.observationId,
    recordHead: head, recordDigest: R.sha(commit.bytes), provenance: 'local-journal-of-bound-get' });
}
function unoccupied(s) {
  if (G.readRef({ ...s.ctx, ref: A.runRef(s.ctx, s.run.runId) }) || G.readRef(E.context(s.ctx, s.run.runId))) C.fail('observation_conflict');
}
async function observe(root, runJson, currentJson, profileJson, key) {
  rootPath(root);
  return withRuntimeWrites(root, async () => {
    // Admission happens before GET, even though Git writes occur much later.
    assertWriteAllowed(root); assertGitWriteAllowed();
    const s = load(root, runJson, currentJson, profileJson, true, true), prior = stored(s);
    if (prior) return prior;
    unoccupied(s);
    const { result, ledger, observed } = await fetch(s, key);
    if (observed.state !== 'receipt-observed') return Q.freeze(output(s, result, ledger, observed));
    const j = s.journal, v = { schema: K.SCHEMA, projectKey: s.ctx.projectKey, batchId: s.ctx.batchId, runId: s.run.runId,
      intentHead: j.intent.head, locatorHead: j.locator.head, attemptHead: j.attempt.head,
      observationId: randomUUID(), response: result.response, ledger };
    const bytes = K.encode(v, s.ctx, j, s.currentJson), target = context(s.ctx, s.run.runId);
    check(s, prefix(ledger)); unoccupied(s); assertWriteAllowed(root); assertGitWriteAllowed();
    const head = G.prepareCommit(s.ctx, j.locator.head, bytes);
    check(s, prefix(ledger)); unoccupied(s);
    const verifies = [[s.ctx.ref, s.run.expectedHead], [J.context(s.ctx, s.run.runId).ref, j.intent.head],
      [J.context(s.ctx, s.run.runId, true).ref, j.locator.head], [A.context(s.ctx, s.run.runId).ref, j.attempt.head],
      [A.runRef(s.ctx, s.run.runId), '0'.repeat(head.length)], [E.context(s.ctx, s.run.runId).ref, '0'.repeat(head.length)]];
    const txn = 'start\noption no-deref\n' + verifies.map(([ref, oid]) => `verify ${ref} ${oid}\n`).join('')
      + `create ${target.ref} ${head}\nprepare\ncommit\n`;
    // CAS failure or lost acknowledgement has an uncertain publication outcome.
    // Never roll back or resend POST. Explicit recovery inspects the durable ref.
    let ran = false;
    try {
      const published = G.run(s.ctx, ['update-ref', '--stdin'], txn, 2048); ran = true;
      if (published.error || published.signal || published.status !== 0 || published.stderr) C.fail('publication_uncertain');
      if (G.readRef(target) !== head) C.fail('publication_uncertain');
      const saved = stored(s);
      if (saved?.recordHead !== head) C.fail('publication_uncertain');
      return saved;
    } catch (error) {
      // T-0326: the long-path check refuses before Git runs, so nothing was published.
      if (!ran && error instanceof C.ReviewControlError && error.code === 'git_long_paths_required') throw error;
      C.fail('publication_uncertain');
    }
  });
}
function recover(root, runJson, currentJson, profileJson) {
  return readStoredContext(root, runJson, currentJson, profileJson).observed;
}
function readStoredContext(root, runJson, currentJson, profileJson) {
  const context = load(root, runJson, currentJson, profileJson, true, true);
  return { context, observed: stored(context) };
}

// No public save(json) or callback-to-observation conversion.
module.exports = { retrieve, observe, recover, readStoredContext };
