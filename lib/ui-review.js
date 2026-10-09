'use strict';

// UIB-04A: bind and assess declarations. This is not a trusted material reader,
// semantic reviewer, execution receipt authenticator, or approval gate.
const { createHash } = require('node:crypto');
const { parseInputJson, TransportError } = require('./review-checkpoint-transport');
const { assessReviewCheckpoint } = require('./review-checkpoint');
const { createReviewSnapshotCandidate, compareReviewSnapshotInputs, ReviewSnapshotInputError } = require('./review-snapshot');
const { POLICY_VERSION, TAXONOMY } = require('./ui-boundary');
const { validateUiBoundaryReview, UiBoundaryContractError, DOMAIN } = require('./ui-boundary-contracts');
const { assessReviewerIndependence, normalizeProviderIdentifier, isValidModelIdentifier } = require('./role-fallback');

const INPUT_SCHEMA = 'leerness.ui-review-input/v1';
const PACKET_SCHEMA = 'leerness.ui-review-packet/v1';
const RECEIPT_SCHEMA = 'leerness.ui-review-receipt/v1';
const ASSESSMENT_SCHEMA = 'leerness.ui-review-assessment/v1';
const MAX_BYTES = 65536;
const MAX_UI_TASKS = 32;
const MAX_CONTRIBUTORS = 32;
const SUBTYPES = Object.freeze(Object.values(TAXONOMY));
const MATERIAL_KEYS = Object.freeze(['sourceDigest', 'specDigest', 'diffDigest', 'renderDigest']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
// 1.36.289: every question covers all visible strings and accessible names, because the syntax
// scanner cannot see requirement, criterion or narration wording; each names its legitimate case.
const QUESTIONS = Object.freeze({
  SPEC_TO_COPY: 'Read every visible string and accessible name, not only scanner candidates, and ask whether it speaks to the user or to the builder. Does any restate a requirement or planning sentence meant for the builder (for example "When there are no trips, show a create button")? Product wording that serves the user is not a finding.',
  IMPLEMENTATION_NARRATION: 'Across every visible string and accessible name: does any explain how the screen was built or works internally (libraries, storage, sync, API calls, fallback logic, preview or demo mechanics) without a user need? Capability, privacy or troubleshooting text the user needs is not a finding.',
  DEVELOPER_NOTE: 'Across every visible string and accessible name: are there TODOs, notes to developers or designers, draft, placeholder or sample-data labels, or framing meant for a reviewer ("UI preview", "all states shown together")? Deliberate examples in technical products are not findings.',
  CRITERIA_TO_COPY: 'Across every visible string and accessible name: does any turn an acceptance or evaluation criterion into copy (for example "intuitive", "understood within 3 seconds", "saves within 1 s")? A guarantee the product actually makes to the user is not a finding.',
  DEBUG_METADATA: 'Across every visible string and accessible name: are raw errors, codes, payloads or stack traces, undefined, null or NaN, [object Object], unresolved variables or raw i18n keys exposed? Route secrets and personal data to security; keep fields an administration or developer tool shows on purpose.',
});
class UiReviewInputError extends Error {
  constructor(code, field) {
    super(`${code} at ${field}`);
    this.name = 'UiReviewInputError'; this.code = code; this.field = field;
  }
}
function fail(code, field) { throw new UiReviewInputError(`ui_review_${code}`, field); }
function parse(text) {
  try { return parseInputJson(text); }
  catch (e) { if (e instanceof TransportError) fail(e.code, '$'); throw e; }
}
function object(v, keys, field) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('object_required', field);
  if (Object.keys(v).some(k => !keys.includes(k))) fail('unknown_field', field);
  for (const key of keys) if (!Object.hasOwn(v, key)) fail('field_required', `${field}.${key}`);
}
function header(v, schema, keys) {
  object(v, ['schema', 'policyVersion', ...keys], '$');
  if (v.schema !== schema) fail('schema_unsupported', '$.schema');
  if (v.policyVersion !== POLICY_VERSION) fail('policy_unsupported', '$.policyVersion');
}
function identifier(v, field) { if (typeof v !== 'string' || !ID.test(v)) fail('identifier_invalid', field); }
function digestValue(v, field) { if (typeof v !== 'string' || !DIGEST.test(v)) fail('digest_invalid', field); }
function choice(v, values, field) { if (!values.includes(v)) fail('enum_invalid', field); }
function array(v, max, field) { if (!Array.isArray(v) || v.length > max) fail('array_limit', field); }
function unique(values, field) { if (new Set(values).size !== values.length) fail('duplicate_entry', field); }
function identity(v, field) {
  if (v === null) return;
  object(v, ['provider', 'model', 'sessionId'], field);
  if (v.provider !== null && (typeof v.provider !== 'string' || !v.provider || normalizeProviderIdentifier(v.provider) !== v.provider)) fail('provider_invalid', `${field}.provider`);
  if (v.model !== null && (typeof v.model !== 'string' || !isValidModelIdentifier(v.model))) fail('model_invalid', `${field}.model`);
  if (v.sessionId !== null) identifier(v.sessionId, `${field}.sessionId`);
}
function hash(value) { return 'sha256:' + createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }
function by(key) { return (a, b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0; }
function effects() {
  return { filesRead: false, filesWritten: false, networkUsed: false, modelInvoked: false,
    approvalGranted: false, approvalReusable: false, enforcementChanged: false, autoRemove: false };
}
function verification() {
  return { sourceVerified: false, evidenceVerified: false, renderVerified: false,
    executionVerified: false, actorIdentityVerified: false, semanticVerified: false, independentReview: 'not-verified' };
}
function prepare(text) {
  const input = parse(text);
  header(input, INPUT_SCHEMA, ['snapshot', 'uiMaterials', 'contributors']);
  let snapshot;
  try { snapshot = createReviewSnapshotCandidate(JSON.stringify(input.snapshot)); }
  catch (e) { if (e instanceof ReviewSnapshotInputError) fail(e.code, '$.snapshot' + e.field.slice(1)); throw e; }
  const checkpoint = assessReviewCheckpoint(input.snapshot.checkpoint);
  const uiTasks = checkpoint.taskCoverage.filter(t => t.uiBoundary).sort(by('taskId'));
  if (uiTasks.length > MAX_UI_TASKS) fail('ui_tasks_limit', '$.snapshot.checkpoint.tasks');
  const uiIds = new Set(uiTasks.map(t => t.taskId));
  const allIds = new Set(input.snapshot.checkpoint.tasks.map(t => t.id));
  array(input.uiMaterials, MAX_UI_TASKS, '$.uiMaterials');
  for (const m of input.uiMaterials) {
    object(m, ['taskId', ...MATERIAL_KEYS], '$.uiMaterials[]'); identifier(m.taskId, '$.uiMaterials[].taskId');
    if (!uiIds.has(m.taskId)) fail('ui_task_reference_invalid', '$.uiMaterials[].taskId');
    for (const key of MATERIAL_KEYS) if (m[key] !== null) digestValue(m[key], `$.uiMaterials[].${key}`);
  }
  unique(input.uiMaterials.map(m => m.taskId), '$.uiMaterials');
  if (input.uiMaterials.length !== uiIds.size) fail('ui_material_membership_incomplete', '$.uiMaterials');
  array(input.contributors, MAX_CONTRIBUTORS, '$.contributors');
  for (const c of input.contributors) {
    object(c, ['attemptId', 'taskIds', 'executor'], '$.contributors[]'); identifier(c.attemptId, '$.contributors[].attemptId');
    array(c.taskIds, 100, '$.contributors[].taskIds');
    if (!c.taskIds.length) fail('task_membership_required', '$.contributors[].taskIds');
    for (const id of c.taskIds) { identifier(id, '$.contributors[].taskIds[]'); if (!allIds.has(id)) fail('task_reference_invalid', '$.contributors[].taskIds[]'); }
    unique(c.taskIds, '$.contributors[].taskIds'); identity(c.executor, '$.contributors[].executor');
  }
  unique(input.contributors.map(c => c.attemptId), '$.contributors');
  const materials = [...input.uiMaterials].sort(by('taskId'));
  const contributors = [...input.contributors].sort(by('attemptId'));
  const bindingDigests = {
    snapshot: snapshot.snapshotId,
    uiMaterials: hash([PACKET_SCHEMA, 'ui-materials', materials.map(m => [m.taskId, ...MATERIAL_KEYS.map(k => m[k])])]),
    contributors: hash([PACKET_SCHEMA, 'contributors', contributors.map(c => [c.attemptId, [...c.taskIds].sort(),
      c.executor === null ? null : [c.executor.provider, c.executor.model, c.executor.sessionId]])]),
  };
  const missingMaterials = materials.flatMap(m => MATERIAL_KEYS.filter(k => m[k] === null).map(kind => ({ taskId: m.taskId, kind })));
  const missingContributors = uiTasks.filter(t => !contributors.some(c => c.taskIds.includes(t.taskId))).map(t => t.taskId);
  const unknownTasks = uiTasks.filter(t => t.uiBoundary.applicability === 'unknown').map(t => t.taskId);
  const applicability = !uiTasks.length ? 'not-applicable' : unknownTasks.length ? 'unknown' : 'applicable';
  const reasonCodes = [...checkpoint.preparation.reasonCodes];
  if (missingMaterials.length) reasonCodes.push('ui-materials-missing');
  if (missingContributors.length) reasonCodes.push('ui-contributors-missing');
  if (unknownTasks.length) reasonCodes.push('ui-applicability-unknown');
  const packet = {
    schema: PACKET_SCHEMA, policyVersion: POLICY_VERSION, scope: 'ui-boundary-only',
    packetId: hash([PACKET_SCHEMA, POLICY_VERSION, bindingDigests]), bindingDigests, applicability,
    preparation: { state: !uiTasks.length ? 'not-applicable' : reasonCodes.length ? 'needs-context' : 'packet-candidate', reasonCodes },
    missingMaterials, missingContributors,
    taskCoverage: uiTasks.map(t => ({ taskId: t.taskId, criteria: [...t.criteria].sort(),
      domain: DOMAIN, requestedAspects: [...t.requestedAspects], applicability: t.uiBoundary.applicability, requiredSubtypes: [...SUBTYPES],
      reviewStatus: 'not-reviewed', evidenceStatus: 'unverified' })),
    questions: { ...QUESTIONS }, verification: verification(), effects: effects(),
  };
  return { input, packet, uiIds };
}
function createUiReviewPacket(inputJson) { return prepare(inputJson).packet; }

function receipt(text, prepared) {
  if (text === undefined) return null;
  const r = parse(text);
  header(r, RECEIPT_SCHEMA, ['packetId', 'attemptId', 'execution', 'reviewer', 'coverage', 'review']);
  digestValue(r.packetId, '$.packetId');
  if (r.attemptId !== null) identifier(r.attemptId, '$.attemptId');
  choice(r.execution, ['not-run', 'completed', 'failed', 'partial'], '$.execution');
  identity(r.reviewer, '$.reviewer');
  if (r.execution !== 'not-run' && r.attemptId === null) fail('attempt_required', '$.attemptId');
  try { validateUiBoundaryReview(r.review); }
  catch (e) { if (e instanceof UiBoundaryContractError) fail(e.code, '$.review' + e.field.slice(1)); throw e; }
  const taskKind = prepared.packet.applicability === 'not-applicable' ? 'non-ui' : prepared.packet.applicability === 'unknown' ? 'unknown' : 'ui';
  if (r.review.taskKind !== taskKind) fail('review_task_kind_mismatch', '$.review.taskKind');
  array(r.coverage, MAX_UI_TASKS * SUBTYPES.length, '$.coverage');
  const claimed = new Set();
  for (const c of r.coverage) {
    object(c, ['taskId', 'subtype', 'outcome', 'findingIndexes'], '$.coverage[]');
    identifier(c.taskId, '$.coverage[].taskId');
    if (!prepared.uiIds.has(c.taskId)) fail('ui_task_reference_invalid', '$.coverage[].taskId');
    choice(c.subtype, SUBTYPES, '$.coverage[].subtype');
    choice(c.outcome, ['no-finding', 'finding', 'inconclusive'], '$.coverage[].outcome');
    array(c.findingIndexes, 32, '$.coverage[].findingIndexes');
    if ((c.outcome === 'finding') !== (c.findingIndexes.length > 0)) fail('finding_outcome_mismatch', '$.coverage[]');
    for (const i of c.findingIndexes) {
      if (!Number.isInteger(i) || i < 0 || i >= r.review.findings.length) fail('finding_reference_invalid', '$.coverage[].findingIndexes');
      if (claimed.has(i)) fail('finding_reference_duplicate', '$.coverage[].findingIndexes');
      if (r.review.findings[i].subtype !== c.subtype) fail('finding_subtype_mismatch', '$.coverage[].findingIndexes');
      claimed.add(i);
    }
  }
  unique(r.coverage.map(c => c.taskId + '/' + c.subtype), '$.coverage');
  if (claimed.size !== r.review.findings.length) fail('finding_unassigned', '$.review.findings');
  if (r.execution === 'not-run' && (r.attemptId !== null || r.reviewer !== null || r.coverage.length || r.review.findings.length)) fail('not_run_conflict', '$.execution');
  return r;
}
function independence(r, current) {
  if (!r || r.execution === 'not-run') return { state: 'not-assessed', bases: [], identityVerified: false };
  const rows = current.input.contributors.map(c => c.attemptId === r.attemptId
    ? { reviewerIndependent: false, basis: 'same-attempt' }
    : assessReviewerIndependence(r.reviewer, c.executor));
  const state = rows.some(r => r.reviewerIndependent === false) ? 'not-independent'
    : !rows.length || current.packet.missingContributors.length || rows.some(r => r.reviewerIndependent !== true)
      ? 'unverified' : 'compatible-declarations';
  return { state, bases: [...new Set(rows.map(r => r.basis))].sort(), identityVerified: false };
}
function assessUiReview(reviewedInputJson, currentInputJson, receiptJson) {
  const previous = prepare(reviewedInputJson); const current = prepare(currentInputJson);
  const r = receipt(receiptJson, previous);
  const comparison = compareReviewSnapshotInputs(JSON.stringify(previous.input.snapshot), JSON.stringify(current.input.snapshot));
  const changedBindings = Object.keys(previous.packet.bindingDigests).filter(k => previous.packet.bindingDigests[k] !== current.packet.bindingDigests[k]);
  const receiptBinding = !r ? 'missing' : r.packetId === previous.packet.packetId ? 'matches-reviewed' : 'mismatch';
  const stale = changedBindings.length > 0 || receiptBinding === 'mismatch';
  const declaredCoverage = current.packet.taskCoverage.flatMap(t => SUBTYPES.map(subtype => {
    const cell = r && r.coverage.find(c => c.taskId === t.taskId && c.subtype === subtype);
    return { taskId: t.taskId, subtype, outcome: !cell ? 'missing' : stale ? 'stale' : cell.outcome };
  }));
  const identityCheck = independence(r, current);
  const reasonCodes = [...comparison.reasonCodes, ...current.packet.preparation.reasonCodes];
  if (changedBindings.includes('uiMaterials')) reasonCodes.push('ui-materials-changed');
  if (changedBindings.includes('contributors')) reasonCodes.push('ui-contributors-changed');
  if (receiptBinding === 'mismatch') reasonCodes.push('receipt-packet-mismatch');
  if (!r || r.execution === 'not-run') reasonCodes.push('review-not-run');
  else if (r.execution !== 'completed') reasonCodes.push('review-execution-incomplete');
  if (declaredCoverage.some(c => ['missing', 'inconclusive'].includes(c.outcome))) reasonCodes.push('ui-coverage-incomplete');
  if (r && r.review.findings.length) reasonCodes.push('ui-findings-present');
  if (identityCheck.state === 'not-independent') reasonCodes.push('review-not-independent');
  if (identityCheck.state === 'unverified') reasonCodes.push('review-identity-unverified');
  const selfReview = identityCheck.bases.some(b => b === 'same-attempt' || b === 'same-session');
  let state;
  if (current.packet.applicability === 'not-applicable') state = 'not-applicable';
  else if (stale) state = 'stale';
  else if (!r || r.execution === 'not-run') state = 'not-reviewed';
  else if (current.packet.preparation.state !== 'packet-candidate') state = 'needs-context';
  else if (r.execution !== 'completed' || declaredCoverage.some(c => ['missing', 'inconclusive'].includes(c.outcome))) state = 'incomplete';
  else if (r.review.findings.length) state = 'findings';
  else if (identityCheck.state === 'not-independent') state = selfReview ? 'self-review' : 'not-independent';
  else if (identityCheck.state !== 'compatible-declarations') state = 'identity-unverified';
  else state = 'review-candidate';
  return {
    schema: ASSESSMENT_SCHEMA, policyVersion: POLICY_VERSION, scope: 'ui-boundary-only', state,
    reviewedPacketId: previous.packet.packetId, currentPacketId: current.packet.packetId,
    bindingState: changedBindings.length ? 'changed' : 'unchanged', changedBindings, receiptBinding,
    reasonCodes: [...new Set(reasonCodes)], declaredCoverage, independence: identityCheck,
    execution: r ? r.execution : 'not-run', findingCount: r ? r.review.findings.length : 0,
    trust: 'caller-declarations', reviewValidity: 'unverified',
    verification: verification(), effects: effects(),
  };
}

module.exports = { createUiReviewPacket, assessUiReview, UiReviewInputError, INPUT_SCHEMA, PACKET_SCHEMA,
  RECEIPT_SCHEMA, ASSESSMENT_SCHEMA, POLICY_VERSION, MAX_BYTES, MAX_UI_TASKS, MAX_CONTRIBUTORS, SUBTYPES };
