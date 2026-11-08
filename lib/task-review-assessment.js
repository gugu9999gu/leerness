'use strict';

const { createHash } = require('node:crypto');

const SCHEMA = 'leerness.task-review-assessment-input/v1';
const PACKET_SCHEMA = 'leerness.review-packet/v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const LIMITS = Object.freeze({ elapsedHours: 48, checkpoints: 3, noProgress: 2, repeatFailures: 2, reviewRounds: 3, executedValidationMs: 1800000 });

class TaskReviewInputError extends Error {
  constructor(code, field) { super(code + ' at ' + field); this.name = 'TaskReviewInputError'; this.code = code; this.field = field; }
}
function fail(code, field) { throw new TaskReviewInputError(code, field); }
function exact(value, required, optional, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(k => !required.includes(k) && !optional.includes(k)) ||
      required.some(k => !Object.hasOwn(value, k))) fail('shape_invalid', field);
}
function id(v, field) { if (typeof v !== 'string' || !ID.test(v)) fail('id_invalid', field); }
function sha(v, field) { if (typeof v !== 'string' || !COMMIT.test(v)) fail('revision_invalid', field); }
function text(v, field) { if (typeof v !== 'string' || !v.trim() || v.length > 1000) fail('text_invalid', field); }
function number(v, field) { if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1000000000)) fail('number_invalid', field); }
function choice(v, choices, field) { if (!choices.includes(v)) fail('value_invalid', field); }
function unique(items, key, field) { if (new Set(items.map(x => key ? x[key] : x)).size !== items.length) fail('duplicate', field); }
function array(v, max, field) { if (!Array.isArray(v) || v.length > max) fail('list_invalid', field); }
function path(v, field) {
  if (typeof v !== 'string' || !v || v.length > 260 || v[0] === '/' || v.includes('\\') ||
      v.includes('\0') || v.split('/').some((segment, i, all) => segment === '.' || segment === '..' || (!segment && i !== all.length - 1)) ||
      v.startsWith('.git/') || v === '.git') fail('path_invalid', field);
}
function paths(v, field) { array(v, 128, field); unique(v, null, field); v.forEach((p, i) => path(p, field + '[' + i + ']')); }
function evidence(v, field) { array(v, 16, field); unique(v, null, field); v.forEach((s, i) => text(s, field + '[' + i + ']')); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function digest(value) { return 'sha256:' + createHash('sha256').update(canonical(value)).digest('hex'); }
function validate(input) {
  exact(input, ['schema', 'manifest', 'observation'], [], '$');
  if (input.schema !== SCHEMA) fail('schema_invalid', '$.schema');
  if (JSON.stringify(input).length > 65536) fail('input_too_large', '$');
  const m = input.manifest, o = input.observation;
  exact(m, ['taskId', 'baselineCommit', 'scopePaths', 'excludedPaths', 'criteria', 'reviewMode', 'risk'], ['workKind', 'verificationMode', 'verificationReason', 'requestItems'], '$.manifest');
  id(m.taskId, '$.manifest.taskId'); sha(m.baselineCommit, '$.manifest.baselineCommit');
  paths(m.scopePaths, '$.manifest.scopePaths'); if (!m.scopePaths.length) fail('scope_empty', '$.manifest.scopePaths');
  paths(m.excludedPaths, '$.manifest.excludedPaths');
  array(m.criteria, 64, '$.manifest.criteria'); if (!m.criteria.length) fail('criteria_empty', '$.manifest.criteria');
  m.criteria.forEach((c, i) => { exact(c, ['id', 'outcome'], [], '$.manifest.criteria[' + i + ']'); id(c.id, '$.criteria.id'); text(c.outcome, '$.criteria.outcome'); });
  unique(m.criteria, 'id', '$.manifest.criteria');
  choice(m.reviewMode, ['optional', 'hybrid'], '$.manifest.reviewMode');
  choice(m.risk, ['normal', 'high', 'critical'], '$.manifest.risk');
  choice(m.workKind === undefined ? 'code' : m.workKind, ['code', 'documentation', 'research', 'migration'], '$.manifest.workKind');
  choice(m.verificationMode === undefined ? 'tests' : m.verificationMode, ['tests', 'evidence-only'], '$.manifest.verificationMode');
  if (m.verificationMode === 'evidence-only') {
    if (!['documentation', 'research'].includes(m.workKind)) fail('test_disposition_invalid', '$.manifest.workKind');
    text(m.verificationReason, '$.manifest.verificationReason');
  } else if (m.verificationReason !== undefined) fail('reason_without_disposition', '$.manifest.verificationReason');
  if (m.requestItems !== undefined) {
    array(m.requestItems, 32, '$.manifest.requestItems');
    if (!m.requestItems.length) fail('requests_empty', '$.manifest.requestItems');
    m.requestItems.forEach((r, i) => {
      exact(r, ['id', 'sourceRef', 'expected'], [], '$.manifest.requestItems[' + i + ']');
      id(r.id, '$.manifest.requestItems.id'); text(r.sourceRef, '$.manifest.requestItems.sourceRef'); text(r.expected, '$.manifest.requestItems.expected');
    });
    unique(m.requestItems, 'id', '$.manifest.requestItems');
  }
  exact(o, ['frozenDigest', 'headCommit', 'changedPaths', 'criteriaResults', 'checks', 'review', 'unresolvedBlockers', 'metrics', 'runs'], ['requestResults'], '$.observation');
  if (typeof o.frozenDigest !== 'string' || !DIGEST.test(o.frozenDigest)) fail('digest_invalid', '$.observation.frozenDigest');
  sha(o.headCommit, '$.observation.headCommit'); paths(o.changedPaths, '$.observation.changedPaths');
  array(o.criteriaResults, 64, '$.observation.criteriaResults'); unique(o.criteriaResults, 'id', '$.observation.criteriaResults');
  o.criteriaResults.forEach(c => { exact(c, ['id', 'status', 'evidence'], [], '$.criteriaResults'); id(c.id, '$.criteriaResults.id'); choice(c.status, ['passed', 'failed', 'unverified'], '$.criteriaResults.status'); evidence(c.evidence, '$.criteriaResults.evidence'); });
  array(o.checks, 100, '$.observation.checks'); unique(o.checks, 'id', '$.observation.checks');
  o.checks.forEach(c => { exact(c, ['id', 'status', 'evidence'], [], '$.checks'); id(c.id, '$.checks.id'); choice(c.status, ['passed', 'failed', 'not-run', 'inconclusive'], '$.checks.status'); evidence(c.evidence, '$.checks.evidence'); });
  // Evidence-only cannot waive executable or migration validation by
  // labeling the change documentation. Host still must inspect the pinned diff.
  if (m.verificationMode === 'evidence-only' &&
      o.changedPaths.some(p => !/\.(?:md|markdown|rst|txt|adoc)$/i.test(p))) {
    fail('test_disposition_invalid', '$.observation.changedPaths');
  }
  if (o.requestResults !== undefined) {
    if (m.requestItems === undefined) fail('requests_not_frozen', '$.observation.requestResults');
    array(o.requestResults, 32, '$.observation.requestResults');
    unique(o.requestResults, 'id', '$.observation.requestResults');
    o.requestResults.forEach(r => {
      exact(r, ['id', 'status', 'evidence'], [], '$.observation.requestResults');
      id(r.id, '$.observation.requestResults.id');
      choice(r.status, ['verified', 'unverified', 'deferred'], '$.observation.requestResults.status');
      evidence(r.evidence, '$.observation.requestResults.evidence');
    });
  }
  exact(o.review, ['stageA', 'stageB'], [], '$.observation.review');
  for (const k of ['stageA', 'stageB']) choice(o.review[k], ['PASS', 'FAIL', 'NEEDS_DECISION', 'not-run'], '$.review.' + k);
  if (!Number.isSafeInteger(o.unresolvedBlockers) || o.unresolvedBlockers < 0) fail('number_invalid', '$.observation.unresolvedBlockers');
  exact(o.metrics, Object.keys(LIMITS), [], '$.observation.metrics');
  for (const k of Object.keys(LIMITS)) number(o.metrics[k], '$.metrics.' + k);
  array(o.runs, 100, '$.observation.runs'); unique(o.runs, 'id', '$.observation.runs');
  o.runs.forEach((r, i) => {
    exact(r, ['id', 'kind', 'sourceRevision', 'status', 'durationMs', 'costUsd', 'reusedFrom'], [], '$.runs[' + i + ']');
    id(r.id, '$.runs.id'); id(r.sourceRevision, '$.runs.sourceRevision');
    choice(r.kind, ['test', 'review', 'integration'], '$.runs.kind');
    choice(r.status, ['passed', 'failed', 'timed-out', 'cancelled', 'not-run'], '$.runs.status');
    number(r.durationMs, '$.runs.durationMs'); number(r.costUsd, '$.runs.costUsd');
    if (r.reusedFrom !== null) id(r.reusedFrom, '$.runs.reusedFrom');
    if (r.status === 'not-run' && (r.durationMs !== null || r.costUsd !== null || r.reusedFrom !== null)) fail('unrun_cost_invalid', '$.runs');
  });
  return input;
}
function scopeDigest(manifest) {
  const { taskId, baselineCommit, scopePaths, excludedPaths, criteria, reviewMode, risk } = manifest;
  const frozen = { taskId, baselineCommit, scopePaths, excludedPaths, criteria, reviewMode, risk };
  for (const k of ['workKind', 'verificationMode', 'verificationReason', 'requestItems']) {
    if (Object.hasOwn(manifest, k)) frozen[k] = manifest[k];
  }
  return digest(frozen);
}
function included(p, patterns) { return patterns.some(x => x.endsWith('/') ? p.startsWith(x) : p === x); }
function assessTaskReview(input) {
  validate(input);
  const { manifest: m, observation: o } = input, lock = scopeDigest(m);
  const outOfScope = o.changedPaths.filter(p => !included(p, m.scopePaths) || included(p, m.excludedPaths));
  const scopeReasons = [...(lock !== o.frozenDigest ? ['frozen-scope-mismatch'] : []), ...(outOfScope.length ? ['changed-path-outside-scope'] : [])];
  const missingCriteria = m.criteria.filter(c => !o.criteriaResults.some(r => r.id === c.id)).map(c => c.id);
  const unknownCriteria = o.criteriaResults.filter(c => !m.criteria.some(r => r.id === c.id)).map(c => c.id);
  const criteriaPassed = !missingCriteria.length && !unknownCriteria.length && o.criteriaResults.every(c => c.status === 'passed' && c.evidence.length);
  const verificationMode = m.verificationMode === 'evidence-only' ? 'evidence-only' : 'tests';
  const checksPassed = (verificationMode === 'evidence-only' || o.checks.length > 0) &&
    o.checks.every(c => c.status === 'passed' && c.evidence.length);
  const declaredRequests = m.requestItems || [];
  const observedRequests = o.requestResults || [];
  const missingRequestIds = declaredRequests.filter(r => !observedRequests.some(o => o.id === r.id)).map(r => r.id);
  const unknownRequestIds = observedRequests.filter(r => !declaredRequests.some(m => m.id === r.id)).map(r => r.id);
  const incompleteRequestIds = observedRequests.filter(r => r.status !== 'verified' || !r.evidence.length).map(r => r.id);
  const requestCoveragePassed = !missingRequestIds.length && !unknownRequestIds.length && !incompleteRequestIds.length;
  const independentRequired = m.reviewMode === 'hybrid';
  const reviewPassed = o.review.stageA !== 'FAIL' && o.review.stageA !== 'NEEDS_DECISION' &&
    o.review.stageB !== 'FAIL' && o.review.stageB !== 'NEEDS_DECISION' &&
    (!independentRequired || (o.review.stageA === 'PASS' && o.review.stageB === 'PASS'));
  const completionReasons = [...scopeReasons, ...(criteriaPassed ? [] : ['criteria-not-verified']),
    ...(checksPassed ? [] : ['checks-not-verified']), ...(requestCoveragePassed ? [] : ['request-coverage-incomplete']), ...(reviewPassed ? [] : ['review-not-cleared']),
    ...(o.unresolvedBlockers ? ['unresolved-blockers'] : [])];
  const executed = o.runs.filter(r => r.status !== 'not-run' && r.reusedFrom === null);
  const measured = executed.filter(r => r.durationMs !== null);
  const billed = executed.filter(r => r.costUsd !== null);
  const triggers = Object.keys(LIMITS).filter(k => o.metrics[k] !== null && o.metrics[k] >= LIMITS[k]);
  const failedRuns = executed.filter(r => r.status !== 'passed').length;
  const splitSuggested = scopeReasons.length > 0 || triggers.some(k => ['elapsedHours', 'checkpoints', 'noProgress', 'repeatFailures', 'reviewRounds'].includes(k));
  return {
    schema: 'leerness.task-review-assessment/v1', taskId: m.taskId, sourceTrust: 'caller-supplied',
    scope: { lockDigest: lock, state: scopeReasons.length ? 'change-required' : 'locked', reasons: scopeReasons, outOfScope },
    requestCoverage: { state: requestCoveragePassed ? (declaredRequests.length ? 'verified-from-claims' : 'not-declared') : 'incomplete',
      sourceTrust: 'caller-supplied', missingRequestIds, unknownRequestIds, incompleteRequestIds },
    verificationPolicy: { mode: verificationMode, declaredWorkKind: m.workKind || 'code',
      reason: m.verificationReason || null, testsRun: false, claimedEvidenceOnly: verificationMode === 'evidence-only' },
    reviewPolicy: { mode: m.reviewMode, independentRequiredBySelection: independentRequired,
      risk: m.risk, note: 'Risk labels alone do not add an external-model gate; owner/project/CI/release approval requirements remain separate and must be observed.' },
    completion: { state: completionReasons.length ? 'blocked' : 'candidate', reasons: [...new Set(completionReasons)], missingCriteria, unknownCriteria,
      note: 'A candidate is not task completion, verified evidence, independent approval, or release permission.' },
    bottleneck: { state: triggers.length ? 'review-required' : Object.values(o.metrics).some(x => x === null) ? 'insufficient-data' : 'within-pilot-limits',
      triggers, pilotLimits: LIMITS, splitSuggested, action: splitSuggested ? 'Owner reviews bounded follow-up task(s); never silently expand or remove an unresolved blocker.' : 'Continue the frozen scope.' },
    validationCost: { executedRuns: executed.length, reusedRuns: o.runs.filter(r => r.reusedFrom !== null).length,
      failedOrStoppedRuns: failedRuns, summedExecutionMs: measured.reduce((n, r) => n + r.durationMs, 0),
      unmeasuredExecutedRuns: executed.length - measured.length, knownCostUsd: billed.length ? +billed.reduce((n, r) => n + r.costUsd, 0).toFixed(6) : null,
      unpricedExecutedRuns: executed.length - billed.length, note: 'Summed invocation time is not wall-clock time; reuse is not fresh execution. Caller reports are not authenticated.' },
    effects: { filesRead: false, filesWritten: false, modelInvoked: false, testsRun: false, reviewApproved: false, taskCompleted: false, releaseAuthorized: false }
  };
}
function reviewPacket(input, mode, details = {}) {
  const a = assessTaskReview(input), { manifest: m, observation: o } = input;
  if (a.scope.state !== 'locked') fail('scope_change_required', '$.observation.frozenDigest');
  choice(mode, ['initial', 'recheck', 'independent'], '$.mode');
  exact(details, [], ['previousCommit', 'openFindings', 'architectureRefs', 'testCommands'], '$.details');
  if (details.previousCommit !== undefined) sha(details.previousCommit, '$.details.previousCommit');
  for (const key of ['architectureRefs', 'testCommands']) {
    if (details[key] !== undefined) evidence(details[key], '$.details.' + key);
  }
  if (details.openFindings !== undefined) {
    array(details.openFindings, 32, '$.details.openFindings');
    details.openFindings.forEach(f => { exact(f, ['id', 'location', 'reproduction', 'requiredOutcome'], [], '$.openFindings'); id(f.id, '$.openFindings.id'); for (const k of ['location', 'reproduction', 'requiredOutcome']) text(f[k], '$.openFindings.' + k); });
    unique(details.openFindings, 'id', '$.details.openFindings');
  }
  if (mode === 'independent' && o.review.stageA !== 'PASS') fail('initial_stage_not_passed', '$.observation.review.stageA');
  if (mode === 'recheck' && (!details.previousCommit || !details.openFindings)) fail('recheck_context_missing', '$.details');
  const packet = {
    schema: PACKET_SCHEMA, taskId: m.taskId, purpose: mode, freshSessionRequired: mode !== 'recheck',
    task: { baselineCommit: m.baselineCommit, headCommit: o.headCommit, frozenDigest: a.scope.lockDigest,
      scopePaths: [...m.scopePaths], excludedPaths: [...m.excludedPaths], criteria: m.criteria.map(c => ({ ...c })),
      ...(m.requestItems ? { requestItems: m.requestItems.map(r => ({ ...r })) } : {}),
      changedPaths: [...o.changedPaths] },
    relatedContext: { architectureRefs: [...(details.architectureRefs || [])], testCommands: [...(details.testCommands || [])],
      testObservations: o.checks.map(c => ({ id: c.id, status: c.status, evidence: [...c.evidence] })) },
    instructions: ['Read the pinned code and requirements, including directly affected call paths.', 'Identify reproducible defects and separate observed failures from hypotheses.', 'Do not modify product code or test acceptance criteria.', 'Report PASS, FAIL or INCONCLUSIVE with evidence; no verdict grants release approval.'],
    previousReviewerConclusionsIncluded: false,
    sourceTrust: 'caller-supplied', modelInvoked: false, approvalGranted: false
  };
  if (mode === 'recheck') {
    packet.previousCommit = details.previousCommit;
    packet.openFindings = details.openFindings.map(f => ({ ...f }));
    packet.previousReviewerConclusionsIncluded = true;
  }
  return packet;
}
module.exports = { SCHEMA, PACKET_SCHEMA, LIMITS, TaskReviewInputError, scopeDigest, validate, assessTaskReview, reviewPacket };
