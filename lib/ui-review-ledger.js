'use strict';

// Correlate existing single-task ledger declarations with byte observations.
// A local ledger (including identitySource labels) is not provider authentication.
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { parseInputJson } = require('./review-checkpoint-transport');
const { captureUiReview, runUiReviewObservation } = require('./ui-review-observation');
const { captureCheckedFileInput, assertCheckedFileCurrent, describeCheckedFileInput } = require('./memory-input');
const { executionLedgerPath, readExecutionEvents, normalizeExecutionEvent } = require('./role-fallback');
const { validateUiBoundaryReview } = require('./ui-boundary-contracts');
const OUTPUT_SCHEMA = 'leerness.ui-review-ledger-observation/v1';
const MAX_LEDGER_BYTES = 1024 * 1024;
const MAX_EVENTS = 2000;
const TERMINALS = new Set(['execution.completed', 'execution.failed', 'review.completed', 'validation.completed']);
const STARTS = new Set(['routing.proposed', 'fallback.selected', 'dispatch.prepared', 'execution.started']);
const baselines = new WeakMap();
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
class LedgerCorrelationError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new LedgerCorrelationError(code); };
const reason = e => e instanceof LedgerCorrelationError ? e.code : 'ledger_unavailable';
function freeze(v) {
  if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v;
}
function readLedger(root) {
  const file = executionLedgerPath(root);
  const input = captureCheckedFileInput(file, { maxBytes: MAX_LEDGER_BYTES });
  if (!input.exists) fail('ledger_missing');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
  if (!text.endsWith('\n')) fail('ledger_incomplete_line');
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length > MAX_EVENTS) fail('ledger_event_limit');
  // The general ledger reader accepts legacy JSON last-key semantics. This
  // adapter requires unambiguous bounded lines before correlating identities.
  for (const line of lines) parseInputJson(line);
  const history = readExecutionEvents(root, MAX_EVENTS, { preserveAll: true, maxBytes: MAX_LEDGER_BYTES });
  if (!history.ok || history.truncated || history.invalidLines || history.events.length !== lines.length) fail('ledger_unavailable');
  const expected = 'sha256:' + createHash('sha256').update(String(input.bytes.length)).update('\0').update(input.bytes).digest('hex');
  if (history.revision !== expected) fail('ledger_changed');
  const ids = history.events.map(e => e.eventId);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) fail('ledger_event_id_ambiguous');
  assertCheckedFileCurrent(input, file);
  return { file, input, digest: hash(input.bytes), description: describeCheckedFileInput(input, file),
    events: history.events.map(normalizeExecutionEvent) };
}
function one(events, predicate, code) {
  const found = events.filter(predicate);
  if (found.length !== 1) fail(code);
  return found[0];
}
function identityMatches(event, expected) {
  const actual = event.actualExecutor;
  if (!actual || !expected || (event.sessionId && actual.sessionId && event.sessionId !== actual.sessionId)) return false;
  const identity = { provider: actual.provider || null, model: actual.model || null,
    sessionId: actual.sessionId || event.sessionId || null };
  return ['provider', 'model', 'sessionId'].every(k => identity[k] === expected[k]);
}
function implementations(history, input) {
  const taskId = input.uiMaterials[0].taskId, material = input.uiMaterials[0];
  return input.contributors.map(c => {
    if (c.taskIds.length !== 1 || c.taskIds[0] !== taskId) fail('single_task_required');
    const event = one(history.events, e => e.attemptId === c.attemptId && TERMINALS.has(e.event), 'implementation_ambiguous_or_missing');
    if (event.event !== 'execution.completed' || !event.executed || event.taskId !== taskId) fail('implementation_not_completed');
    if (!identityMatches(event, c.executor)) fail('implementation_identity_mismatch');
    if (![material.sourceDigest, material.diffDigest].every(d => event.evidenceRefs.includes(d))) fail('implementation_material_unbound');
    if (!event.parentAttemptId) fail('implementation_parent_missing');
    const parent = one(history.events, e => STARTS.has(e.event)
      && (e.attemptId === event.parentAttemptId || e.eventId === event.parentAttemptId), 'implementation_parent_ambiguous_or_missing');
    if (parent.taskId !== taskId || (event.requestedRole && parent.requestedRole !== event.requestedRole)) fail('implementation_parent_mismatch');
    const expected = parent.actualExecutor && parent.actualExecutor.provider ? parent.actualExecutor : parent.requestedExecutor;
    if (!expected || !expected.provider || ['provider', 'model', 'sessionId'].some(k => expected[k] && expected[k] !== event.actualExecutor[k])) fail('implementation_parent_identity_mismatch');
    if (history.events.indexOf(parent) >= history.events.indexOf(event)) fail('implementation_order_invalid');
    return event;
  });
}
function appendOnly(before, after) {
  const a = before.description, b = after.description;
  for (const key of ['dev', 'ino', 'mode']) {
    if (a.parent[key] !== b.parent[key] || a.stat[key] !== b.stat[key]) fail('ledger_replaced');
  }
  if (a.resolvedParent !== b.resolvedParent || !after.input.bytes.subarray(0, before.input.bytes.length).equals(before.input.bytes)) fail('ledger_history_changed');
}
function correlateReview(before, after, implementationEvents, receipt, handle, receiptDigest) {
  const taskId = handle.packet.taskCoverage[0].taskId;
  if (before.events.some(e => e.attemptId === receipt.attemptId)) fail('review_attempt_reused');
  const event = one(after.events, e => TERMINALS.has(e.event) && e.attemptId === receipt.attemptId, 'review_ambiguous_or_missing');
  if (receipt.execution !== 'completed' || event.event !== 'review.completed' || !event.executed || event.taskId !== taskId) fail('review_not_completed');
  if (!identityMatches(event, receipt.reviewer)) fail('review_identity_mismatch');
  const parent = implementationEvents.find(e => e.attemptId === event.parentAttemptId);
  if (!parent || event.reviewOfAttemptId !== parent.attemptId) fail('review_parent_mismatch');
  const refs = [handle.packet.packetId, handle.selectionDigest, receiptDigest, ...implementationEvents.map(e => e.eventId)];
  if (!refs.every(ref => event.evidenceRefs.includes(ref))) fail('review_evidence_unbound');
  if (!event.review || !event.review.uiBoundary || JSON.stringify(validateUiBoundaryReview(event.review.uiBoundary))
    !== JSON.stringify(validateUiBoundaryReview(receipt.review))) fail('review_findings_mismatch');
  return event;
}

async function runUiReviewWithLedger(root, requestJson, currentInputJson, reviewer) {
  // Keep UIB-04B's input/capture errors and authority boundary. No ledger writes,
  // provider launches or registration occur in this adapter.
  if (typeof reviewer !== 'function') throw new TypeError('ui_review_ledger_callback_required');
  const handle = captureUiReview(root, requestJson);
  const input = parseInputJson(requestJson).input;
  const out = { schema: OUTPUT_SCHEMA, packetId: handle.packet.packetId, selectionDigest: handle.selectionDigest,
    state: 'unlinked', reasonCode: null, observation: null,
    ledger: { beforeDigest: null, afterDigest: null, implementationEventIds: [], reviewEventId: null, receiptDigest: null },
    trust: 'local-ledger-declarations', actorIdentityVerified: false, semanticVerified: false,
    independentReview: 'not-verified', approvalGranted: false, approvalReusable: false };
  let before, implementationEvents;
  try {
    if (input.uiMaterials.length !== 1 || input.snapshot.checkpoint.tasks.length !== 1) fail('single_task_required');
    before = readLedger(root);
    implementationEvents = implementations(before, input);
    out.ledger.beforeDigest = before.digest;
    out.ledger.implementationEventIds = implementationEvents.map(e => e.eventId);
  } catch (e) { out.reasonCode = reason(e); return freeze(out); }
  let receiptJson;
  out.observation = await runUiReviewObservation(handle, currentInputJson, async supplied => {
    // Check again at the actual callback boundary. The callback's own effects
    // remain host-controlled; only append-preserving terminal records can link.
    assertCheckedFileCurrent(before.input, before.file);
    receiptJson = await reviewer(Object.freeze({ ...supplied, selectionDigest: handle.selectionDigest,
      implementationEventIds: Object.freeze([...out.ledger.implementationEventIds]) }));
    return receiptJson;
  });
  if (out.observation.state !== 'observed-review' || out.observation.assessment.receiptBinding !== 'matches-reviewed') {
    out.reasonCode = 'ui_observation_not_linkable'; return freeze(out);
  }
  try {
    const after = readLedger(root);
    out.ledger.afterDigest = after.digest;
    appendOnly(before, after);
    const receipt = parseInputJson(receiptJson), receiptDigest = hash(Buffer.from(receiptJson, 'utf8'));
    const event = correlateReview(before, after, implementationEvents, receipt, handle, receiptDigest);
    out.ledger.receiptDigest = receiptDigest;
    out.ledger.reviewEventId = event.eventId;
    out.state = 'ledger-linked';
  } catch (e) { out.reasonCode = reason(e); }
  return freeze(out);
}

function captureUiReviewLedgerBaseline(root, inputJson, reviewAttemptId) {
  try {
    if (typeof reviewAttemptId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(reviewAttemptId)) fail('review_attempt_invalid');
    const input = parseInputJson(inputJson);
    if (input.uiMaterials.length !== 1 || input.snapshot.checkpoint.tasks.length !== 1) fail('single_task_required');
    const before = readLedger(root), events = implementations(before, input);
    if (before.events.some(e => e.attemptId === reviewAttemptId)) fail('review_attempt_reused');
    const handle = freeze({ schema: 'leerness.ui-review-ledger-baseline/v1', reviewAttemptId,
      description: before.description, prefixBytes: before.input.bytes.length, prefixDigest: before.digest,
      eventCount: before.events.length, implementationEventIds: events.map(e => e.eventId) });
    baselines.set(handle, before); return handle;
  } catch (e) { fail(reason(e)); }
}
function assertUiReviewLedgerBaselineCurrent(handle) {
  const before = baselines.get(handle);
  if (!before) fail('ledger_baseline_invalid');
  try { assertCheckedFileCurrent(before.input, before.file); }
  catch { fail('ledger_changed'); }
}
function restoreUiReviewLedgerBaseline(root, inputJson, baseline, beforeDispatch = false, observedPrefix) {
  try {
    if (!baseline || baseline.schema !== 'leerness.ui-review-ledger-baseline/v1'
      || !Number.isSafeInteger(baseline.prefixBytes) || baseline.prefixBytes < 1 || baseline.prefixBytes > MAX_LEDGER_BYTES
      || !Number.isInteger(baseline.eventCount) || baseline.eventCount < 1 || baseline.eventCount > MAX_EVENTS) fail('ledger_baseline_invalid');
    const after = readLedger(root), prefix = after.input.bytes.subarray(0, baseline.prefixBytes);
    if (beforeDispatch && (after.input.bytes.length !== baseline.prefixBytes
      || ['size', 'nlink', 'mtimeNs', 'ctimeNs'].some(k => after.description.stat[k] !== baseline.description.stat[k]))) fail('ledger_changed');
    if (prefix.length !== baseline.prefixBytes || hash(prefix) !== baseline.prefixDigest
      || prefix.at(-1) !== 10) fail('ledger_history_changed');
    const before = { description: baseline.description, input: { bytes: prefix },
      events: after.events.slice(0, baseline.eventCount) };
    appendOnly(before, after);
    // Recovery must preserve the entire prefix actually seen by GET, including
    // events appended after the original dispatch baseline. Later append is OK.
    if (observedPrefix !== undefined) {
      if (!observedPrefix || Object.keys(observedPrefix).sort().join(',') !== 'bytes,digest'
        || !Number.isSafeInteger(observedPrefix.bytes) || observedPrefix.bytes < baseline.prefixBytes
        || observedPrefix.bytes > MAX_LEDGER_BYTES || typeof observedPrefix.digest !== 'string'
        || !/^sha256:[0-9a-f]{64}$/.test(observedPrefix.digest)) fail('ledger_baseline_invalid');
      const observed = after.input.bytes.subarray(0, observedPrefix.bytes);
      if (observed.length !== observedPrefix.bytes || observed.at(-1) !== 10
        || hash(observed) !== observedPrefix.digest) fail('ledger_history_changed');
    }
    const lineCount = new TextDecoder('utf-8', { fatal: true }).decode(prefix).split(/\r?\n/).filter(l => l.trim()).length;
    if (lineCount !== baseline.eventCount) fail('ledger_baseline_invalid');
    const events = implementations(before, parseInputJson(inputJson));
    if (JSON.stringify(events.map(e => e.eventId)) !== JSON.stringify(baseline.implementationEventIds)) fail('implementation_changed');
    if (before.events.some(e => e.attemptId === baseline.reviewAttemptId)) fail('review_attempt_reused');
    return freeze({ beforeDigest: baseline.prefixDigest, afterDigest: after.digest,
      beforeBytes: baseline.prefixBytes, afterBytes: after.input.bytes.length,
      implementationEventIds: [...baseline.implementationEventIds], reviewAttemptId: baseline.reviewAttemptId,
      prefixPreserved: true, trust: 'local-ledger-declarations' });
  } catch (e) { fail(reason(e)); }
}

function inspectUiReviewLedgerTerminal(root, inputJson, baseline, observedPrefix, receiptJson, selectionDigest, expectedEvent) {
  try {
    const restored = restoreUiReviewLedgerBaseline(root, inputJson, baseline, false, observedPrefix);
    const after = readLedger(root);
    if (after.digest !== restored.afterDigest) fail('ledger_changed');
    const before = { events: after.events.slice(0, baseline.eventCount) };
    const input = parseInputJson(inputJson), receipt = parseInputJson(receiptJson);
    if (receipt.attemptId !== baseline.reviewAttemptId || receipt.execution !== 'completed') fail('review_not_completed');
    const related = after.events.filter(e => e.attemptId === receipt.attemptId || e.eventId === expectedEvent.eventId);
    if (!related.length) return freeze({ event: null, ledger: null, afterBytes: null,
      currentBytes: after.input.bytes.length, currentEvents: after.events.length });
    if (related.length !== 1) fail('review_terminal_conflict');
    const event = related[0];
    const canonical = require('./review-control-contract').stable;
    if (typeof event.at !== 'string' || !Number.isFinite(Date.parse(event.at)) || new Date(event.at).toISOString() !== event.at
      || canonical(event) !== canonical(normalizeExecutionEvent({ ...expectedEvent, at: event.at }))) fail('review_terminal_conflict');
    const implementationEvents = implementations(before, input), receiptDigest = hash(Buffer.from(receiptJson));
    correlateReview(before, after, implementationEvents, receipt,
      { packet: require('./ui-review').createUiReviewPacket(inputJson), selectionDigest }, receiptDigest);
    // Keep the end of this event, rather than the moving current end of the file.
    let start = 0, end = null;
    while (start < after.input.bytes.length) {
      const next = after.input.bytes.indexOf(10, start) + 1;
      if (!next) fail('ledger_incomplete_line');
      const line = after.input.bytes.subarray(start, next).toString('utf8').trim();
      if (line && parseInputJson(line).eventId === event.eventId) { end = next; break; }
      start = next;
    }
    if (!end || end <= observedPrefix.bytes) fail('review_order_invalid');
    assertCheckedFileCurrent(after.input, after.file);
    return freeze({ event, afterBytes: end, ledger: { beforeDigest: baseline.prefixDigest,
      afterDigest: hash(after.input.bytes.subarray(0, end)), implementationEventIds: [...baseline.implementationEventIds],
      reviewEventId: event.eventId, receiptDigest } });
  } catch (e) { fail(reason(e)); }
}

module.exports = { runUiReviewWithLedger, captureUiReviewLedgerBaseline, assertUiReviewLedgerBaselineCurrent,
  restoreUiReviewLedgerBaseline, inspectUiReviewLedgerTerminal, LedgerCorrelationError, OUTPUT_SCHEMA, MAX_LEDGER_BYTES, MAX_EVENTS };
