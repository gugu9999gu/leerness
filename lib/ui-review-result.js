'use strict';

const C = require('./review-control-contract');
const G = require('./review-control-git');
const R = require('./ui-review-run-contract');
const A = require('./ui-review-attempt');

// A locally observed outcome, before explicit RunRecord retention. This is not
// a provider receipt or approval. Reuse the exact RunRecord bytes and Git store.
function context(ctx, runId) {
  return { ...ctx, ref: `refs/leerness/review-results/v1/${ctx.projectKey}/${C.digest(runId).slice(7)}` };
}
function read(ctx, runId, attempt) {
  const head = G.readRef(context(ctx, runId));
  if (!head) return null;
  const commit = G.readCommit(ctx, head), record = R.record(commit.bytes, ctx.projectKey, ctx.batchId, runId);
  if (!attempt || attempt.value.state !== 'execution-unknown'
    || commit.parents.length !== 1 || commit.parents[0] !== attempt.head) C.fail('result_conflict');
  const original = G.readCommit(ctx, record.controlHead);
  if (original.bytes !== R.encode(record.controlRecord)) C.fail('record_invalid');
  A.assertRecord(ctx, runId, attempt, record);
  return { head, bytes: commit.bytes, record };
}
function save(ctx, runId, attempt, bytes, fences = []) {
  if (!Array.isArray(fences) || fences.length > 8 || fences.some(pair => !Array.isArray(pair) || pair.length !== 2
    || typeof pair[0] !== 'string' || !/^refs\/[A-Za-z0-9_./-]{1,240}$/.test(pair[0]) || pair[0].includes('..')
    || !C.match(pair[1], C.OID))) C.fail('input_invalid');
  const prior = read(ctx, runId, attempt);
  if (prior) {
    if (prior.bytes !== bytes) C.fail('result_conflict');
    return prior.head;
  }
  const record = R.record(bytes, ctx.projectKey, ctx.batchId, runId);
  if (attempt.value.state !== 'execution-unknown') C.fail('result_conflict');
  A.assertRecord(ctx, runId, attempt, record);
  const rctx = context(ctx, runId), head = G.prepareCommit(ctx, attempt.head, bytes);
  G.assertContext(ctx);
  // Keep late outcomes as history even if control has since changed. Only
  // retain may publish a run, and it still requires the original live owner.
  const transaction = `start\noption no-deref\nverify ${A.context(ctx, runId).ref} ${attempt.head}\n`
    + fences.map(([ref, oid]) => `verify ${ref} ${oid}\n`).join('')
    + `verify ${A.runRef(ctx, runId)} ${'0'.repeat(head.length)}\ncreate ${rctx.ref} ${head}\nprepare\ncommit\n`;
  const result = G.run(ctx, ['update-ref', '--stdin'], transaction, 2048);
  if (result.error || result.signal || result.status !== 0 || result.stderr) C.fail('publication_uncertain');
  try { G.assertContext(ctx); if (G.readRef(rctx) !== head) C.fail('publication_uncertain'); }
  catch { C.fail('publication_uncertain'); }
  return head;
}

module.exports = { context, read, save };
