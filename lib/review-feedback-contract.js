'use strict';

 
const { parseInputJson } = require('./review-checkpoint-transport');
const { createHash } = require('node:crypto');
const { redactSecrets } = require('./pure-utils');
const CONTRACT = 'leerness.review-feedback-contract/v1';
const ROUND = 'leerness.review-feedback-round/v1';
 
 
const CONTRACT_V2 = 'leerness.review-feedback-contract/v2';
const ROUND_V2 = 'leerness.review-feedback-round/v2';
const MAX_STAGES = 5;
const START = 'review.feedback.started';
const SUBMIT = 'review.feedback.submitted';
// Older readers must keep the stopped projection, not replay resumed rounds
// through the pre-resume state machine. Do not reuse feedbackRound on this event.
const CONTINUED = 'review.feedback.continued';
const RESUME = 'review.feedback.resume_authorized';
const RESUME_SCHEMA = 'leerness.review-feedback-resume/v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
class ReviewFeedbackError extends Error {
  constructor(code) { super(`Review feedback rejected (${code}).`); this.code = code; }
}
function fail(code) { throw new ReviewFeedbackError(code); }
function exact(v, keys, optional = []) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || keys.some(k => !Object.hasOwn(v, k))
    || Object.keys(v).some(k => !keys.includes(k) && !optional.includes(k))) fail('feedback_shape_invalid');
}
function text(v) {
  if (typeof v !== 'string' || !v.trim() || v.length > 1600 || Buffer.from(v).toString('utf8') !== v
    || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)) fail('feedback_text_invalid');
  if (redactSecrets(v) !== v) fail('feedback_sensitive_text');
}
function id(v) { if (typeof v !== 'string' || !ID.test(v)) fail('feedback_id_invalid'); }
function array(v, min = 0, max = 32) { if (!Array.isArray(v) || v.length < min || v.length > max) fail('feedback_list_invalid'); }
function refs(v) { array(v, 1, 8); v.forEach(text); }
function unique(v, key) { if (new Set(v.map(x => x[key])).size !== v.length) fail('feedback_duplicate_id'); }
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',')}}`;
  return JSON.stringify(v);
}
function digest(v) { return 'sha256:' + createHash('sha256').update(stable(v)).digest('hex'); }
function parsed(v) {
   
  if (typeof v === 'string') return parseInputJson(v);
  const seen = new Set(); let nodes = 0;
  function visit(x, depth = 0) {
    if (depth > 14 || ++nodes > 10000) fail('feedback_shape_invalid');
    if (x === null || typeof x === 'boolean' || typeof x === 'string') return;
    if (typeof x === 'number' && Number.isFinite(x)) return;
    if (!x || typeof x !== 'object' || seen.has(x)) fail('feedback_shape_invalid');
    if (!Array.isArray(x) && ![Object.prototype, null].includes(Object.getPrototypeOf(x))) fail('feedback_shape_invalid');
    seen.add(x);
    for (const k of Reflect.ownKeys(x)) {
      if (Array.isArray(x) && k === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(x, k);
      if (typeof k !== 'string' || !d.enumerable || !Object.hasOwn(d, 'value')) fail('feedback_shape_invalid');
      visit(d.value, depth + 1);
    }
    if (Array.isArray(x) && Object.keys(x).length !== x.length) fail('feedback_shape_invalid');
    seen.delete(x);
  }
  visit(v); return parseInputJson(JSON.stringify(v));
}
function actor(v) { exact(v, ['provider', 'model']); id(v.provider); id(v.model); }
function sameActor(a, b) { return !!a && !!b && a.provider === b.provider && a.model === b.model; }
 
 
function session(v) {
  if (typeof v !== 'string' || require('./role-fallback').normalizeProvenanceIdentifier(v) !== v) fail('feedback_session_invalid');
}
function criteriaList(v) {
  array(v, 1); unique(v, 'id');
  for (const c of v) { exact(c, ['id', 'outcome']); id(c.id); text(c.outcome); }
}
function validateStagedContract(v) {
  exact(v, ['schema', 'reviewId', 'taskId', 'scope', 'criteria', 'stages']);
  id(v.reviewId); id(v.taskId); text(v.scope); criteriaList(v.criteria);
  array(v.stages, 1, MAX_STAGES); unique(v.stages, 'id');
  for (const s of v.stages) {
    exact(s, ['id', 'label', 'reviewer'], ['maxRounds']);
    if (!Object.hasOwn(s, 'maxRounds')) s.maxRounds = 3;
    id(s.id); text(s.label); if (s.label.length > 80) fail('feedback_text_invalid'); actor(s.reviewer);
    if (!Number.isInteger(s.maxRounds) || s.maxRounds < 1 || s.maxRounds > 10) fail('feedback_budget_invalid');
  }
  return v;
}
function validateContract(value) {
  const v = parsed(value);
  if (v && typeof v === 'object' && v.schema === CONTRACT_V2) return validateStagedContract(v);
  exact(v, ['schema', 'reviewId', 'taskId', 'reviewer', 'scope', 'criteria'], ['maxRounds']);
  if (!Object.hasOwn(v, 'maxRounds')) v.maxRounds = 3;
  if (v.schema !== CONTRACT) fail('feedback_schema_invalid');
  id(v.reviewId); id(v.taskId); actor(v.reviewer); text(v.scope);
  array(v.criteria, 1); unique(v.criteria, 'id');
  for (const c of v.criteria) { exact(c, ['id', 'outcome']); id(c.id); text(c.outcome); }
  if (!Number.isInteger(v.maxRounds) || v.maxRounds < 1 || v.maxRounds > 10) fail('feedback_budget_invalid');
  return v;
}
function check(v, key) {
  exact(v, [key, 'status', 'evidence']); id(v[key]);
  if (!['passed', 'failed', 'unverified'].includes(v.status)) fail('feedback_check_invalid');
  refs(v.evidence);
}
function finding(v) {
  exact(v, ['id', 'severity', 'classification', 'criterionId', 'issue', 'evidence', 'whyItFails', 'requiredOutcome', 'acceptanceCriteria'],
    ['implementationHint', 'mandatoryConstraint', 'regression']);
  id(v.id);
  if (!['low', 'medium', 'high', 'critical'].includes(v.severity)) fail('feedback_severity_invalid');
  if (!['blocking', 'non-blocking', 'regression', 'risk-escalation'].includes(v.classification)) fail('feedback_classification_invalid');
  // A medium escalation must name the frozen criterion it violates, so a pre-existing defect found after
  // the first round stops for a decision without being inflated to high or mislabelled as a regression.
  if (v.classification === 'risk-escalation' && !['high', 'critical'].includes(v.severity)
    && !(v.severity === 'medium' && v.criterionId !== null)) fail('feedback_risk_invalid');
  if (v.criterionId !== null) id(v.criterionId);
  for (const k of ['issue', 'whyItFails', 'requiredOutcome']) text(v[k]);
  refs(v.evidence); array(v.acceptanceCriteria, 1, 8); unique(v.acceptanceCriteria, 'id');
  for (const c of v.acceptanceCriteria) { exact(c, ['id', 'outcome']); id(c.id); text(c.outcome); }
  if (Object.hasOwn(v, 'implementationHint')) text(v.implementationHint);
  if (Object.hasOwn(v, 'mandatoryConstraint')) {
    const c = v.mandatoryConstraint; exact(c, ['reason', 'requirement', 'evidence']);
    if (!['security', 'data-loss', 'api-contract', 'standard'].includes(c.reason)) fail('feedback_constraint_invalid');
    text(c.requirement); refs(c.evidence);
  }
  if (v.classification === 'regression') {
    exact(v.regression, ['previousRevision', 'currentRevision', 'beforeEvidence', 'afterEvidence']);
    for (const k of ['previousRevision', 'currentRevision']) if (!HASH.test(v.regression[k])) fail('feedback_revision_invalid');
    refs(v.regression.beforeEvidence); refs(v.regression.afterEvidence);
  } else if (Object.hasOwn(v, 'regression')) fail('feedback_regression_invalid');
}
const ROUND_KEYS = ['schema', 'reviewId', 'roundId', 'expectedRound', 'contractDigest', 'reviewer', 'implementationAttemptId',
  'sourceRevision', 'verdict', 'findings', 'resolutions', 'criteriaResults', 'regressionCheck'];
function validateRound(value) {
  const v = parsed(value);
  const staged = !!v && typeof v === 'object' && v.schema === ROUND_V2;
  exact(v, staged ? [...ROUND_KEYS, 'stageId', 'reviewerSession'] : ROUND_KEYS);
  if (v.schema !== (staged ? ROUND_V2 : ROUND)) fail('feedback_schema_invalid');
  if (staged) { id(v.stageId); session(v.reviewerSession); }
  id(v.reviewId); id(v.roundId); id(v.implementationAttemptId); actor(v.reviewer);
  if (!Number.isInteger(v.expectedRound) || v.expectedRound < 0 || v.expectedRound > 9) fail('feedback_round_invalid');
  if (!HASH.test(v.contractDigest) || !HASH.test(v.sourceRevision)) fail('feedback_revision_invalid');
  if (!['PASS', 'FAIL', 'NEEDS_DECISION'].includes(v.verdict)) fail('feedback_verdict_invalid');
  array(v.findings); unique(v.findings, 'id'); v.findings.forEach(finding);
  array(v.resolutions); unique(v.resolutions, 'issueId');
  for (const r of v.resolutions) {
    exact(r, ['issueId', 'status', 'evidence', 'checks']); id(r.issueId); refs(r.evidence);
    if (!['resolved', 'unresolved', 'disputed'].includes(r.status)) fail('feedback_resolution_invalid');
    array(r.checks, 1, 8); unique(r.checks, 'criterionId'); r.checks.forEach(c => check(c, 'criterionId'));
  }
  array(v.criteriaResults, 1); unique(v.criteriaResults, 'criterionId'); v.criteriaResults.forEach(c => check(c, 'criterionId'));
  exact(v.regressionCheck, ['status', 'evidence']); refs(v.regressionCheck.evidence);
  if (!['passed', 'failed', 'unverified'].includes(v.regressionCheck.status)) fail('feedback_check_invalid');
  return v;
}
// 1.36.305 rejects a medium escalation while replaying a ledger, which would break every review in it,
// so such a round is stored as the additive continued event those readers skip.
function continuedOnly(round) {
  return round.findings.some(f => f.classification === 'risk-escalation' && f.severity === 'medium');
}
// Lazy loading keeps the pure decision rules separate from the round rules.
function validateResume(value) { return require('./review-feedback-resume').validate(value); }
function authorizeResume(state, value) { return require('./review-feedback-resume').authorize(state, value); }
function covers(actual, expected) {
  if (actual.length !== expected.length || expected.some(id => !actual.includes(id))) fail('feedback_coverage_missing');
}
function advance(state, value) {
  const resumed = require('./review-feedback-resume').permitted(state);
  const next = state.contract.schema === CONTRACT_V2 ? advanceStaged(state, value, resumed) : advanceSingle(state, value, resumed);
  return state.resumePermit ? { ...next, resumePermit: null } : next;
}
function advanceSingle(state, value, resumed = false) {
  const r = validateRound(value), c = state.contract, prior = state.rounds.at(-1);
  if (r.schema !== ROUND) fail('feedback_schema_invalid');    
  if (r.reviewId !== c.reviewId || r.contractDigest !== digest(c)) fail('feedback_contract_changed');
  if (!sameActor(r.reviewer, c.reviewer)) fail('feedback_reviewer_mismatch');
  if (state.status !== 'open' && state.status !== 'FAIL') {
    if (!resumed) fail('feedback_review_stopped');
  }
  if (state.rounds.length >= c.maxRounds) fail('feedback_budget_exhausted');
  if (r.expectedRound !== state.rounds.length) fail('feedback_stale_round');
  if (state.rounds.some(x => x.roundId === r.roundId)) fail('feedback_duplicate_round');
  covers(r.criteriaResults.map(x => x.criterionId), c.criteria.map(x => x.id));
  const issues = state.issues.map(x => ({ ...x }));
  const blockers = issues.filter(x => ['blocking', 'regression'].includes(x.classification));
  covers(r.resolutions.map(x => x.issueId), blockers.map(x => x.id));
  for (const item of r.resolutions) {
    const issue = issues.find(x => x.id === item.issueId);
    covers(item.checks.map(x => x.criterionId), issue.acceptanceCriteria.map(x => x.id));
    if ((item.status === 'resolved') !== item.checks.every(x => x.status === 'passed')) fail('feedback_resolution_inconsistent');
     
     
    if (issue.status === 'resolved' && item.status !== 'resolved') fail('feedback_resolved_issue_reopened');
    issue.status = item.status;
  }
  for (const f of r.findings) {
    if (issues.some(x => x.id === f.id)) fail('feedback_issue_redefined');
    if (f.criterionId !== null && !c.criteria.some(x => x.id === f.criterionId)) fail('feedback_scope_changed');
    if (f.classification === 'blocking' && (!f.criterionId || prior)) fail('feedback_new_blocker_forbidden');
    if (f.classification === 'regression') {
      if (!prior || f.regression.previousRevision !== prior.sourceRevision || f.regression.currentRevision !== r.sourceRevision
        || r.sourceRevision === prior.sourceRevision) fail('feedback_regression_unbound');
    }
    if (f.classification === 'non-blocking' && Object.hasOwn(f, 'mandatoryConstraint')) fail('feedback_optional_constraint');
    issues.push({ ...f, status: 'unresolved' });
  }
  if (issues.length > 32) fail('feedback_issue_limit');
  const open = issues.filter(x => ['blocking', 'regression'].includes(x.classification) && x.status !== 'resolved');
  for (const x of r.criteriaResults.filter(x => x.status === 'failed')) {
    if (!open.some(f => f.criterionId === x.criterionId)
      && !issues.some(f => f.classification === 'risk-escalation' && f.criterionId === x.criterionId)) fail('feedback_failure_unexplained');
  }
  if (r.regressionCheck.status === 'failed' && !open.some(x => x.classification === 'regression')
    && !r.findings.some(x => x.classification === 'risk-escalation')) fail('feedback_regression_unexplained');
  const complete = !open.length && r.criteriaResults.every(x => x.status === 'passed') && r.regressionCheck.status === 'passed';
  const reasons = [];
  if (r.criteriaResults.some(x => x.status === 'unverified') || r.regressionCheck.status === 'unverified'
    || r.resolutions.some(x => x.checks.some(c => c.status === 'unverified'))) reasons.push('verification-incomplete');
  if (issues.some(x => x.classification === 'risk-escalation')) reasons.push('new-risk-needs-decision');
  if (issues.some(x => x.status === 'disputed')) reasons.push('disputed-issue');
  if (!complete && r.expectedRound + 1 >= c.maxRounds) reasons.push('round-budget-exhausted');
  if (!complete && prior && r.sourceRevision === prior.sourceRevision) reasons.push('unchanged-source');
  if (!complete && prior && open.length && stable(open.map(x => x.id).sort()) === stable(state.issues
    .filter(x => ['blocking', 'regression'].includes(x.classification) && x.status !== 'resolved').map(x => x.id).sort())) reasons.push('no-resolved-blocker');
  const status = reasons.length ? 'NEEDS_DECISION' : complete ? 'PASS' : 'FAIL';
  if (r.verdict !== status) fail('feedback_verdict_inconsistent');
  return { ...state, rounds: [...state.rounds, r], issues, status, stopReasons: reasons,
    ...(state.resumePermit ? { resumePermit: null } : {}) };
}
 
 
 
 
 
function stageContract(c, stage) {
  return { schema: CONTRACT, reviewId: c.reviewId, taskId: c.taskId, reviewer: stage.reviewer, scope: c.scope,
    criteria: c.criteria, maxRounds: stage.maxRounds };
}
function singleRound(r, contractDigest) {
  const { stageId, reviewerSession, ...rest } = r;
  return { ...rest, schema: ROUND, contractDigest };
}
function withOverall(state) {
  const current = state.stages.find(s => s.status !== 'PASS') || null;
  return { ...state, status: current ? current.status : 'PASS', stopReasons: current ? current.stopReasons : [],
    currentStageId: current ? current.id : null };
}
function advanceStaged(state, value, resumed = false) {
  const r = validateRound(value), c = state.contract;
  if (r.schema !== ROUND_V2) fail('feedback_schema_invalid');
  if (r.reviewId !== c.reviewId || r.contractDigest !== digest(c)) fail('feedback_contract_changed');
  const index = state.stages.findIndex(s => s.status !== 'PASS');
  if (index < 0) fail('feedback_review_stopped');
  const stage = state.stages[index];
  if (r.stageId !== stage.id) fail(state.stages.some(s => s.id === r.stageId) ? 'feedback_stage_not_current' : 'feedback_stage_unknown');
   
  if (state.stages.some((s, j) => j !== index && s.sessions.includes(r.reviewerSession))) fail('feedback_session_reused');
   
  if (state.rounds.some(x => x.roundId === r.roundId)) fail('feedback_duplicate_round');
  if (r.findings.some(f => state.issues.some(x => x.id === f.id && x.stageId !== stage.id))) fail('feedback_issue_redefined');
  if (state.issues.length + r.findings.filter(f => !state.issues.some(x => x.id === f.id)).length > 32) fail('feedback_issue_limit');
  const sc = stageContract(c, stage), scDigest = digest(sc);
  const next = advanceSingle({
    contract: sc,
    rounds: state.rounds.filter(x => x.stageId === stage.id).map(x => singleRound(x, scDigest)),
    issues: state.issues.filter(x => x.stageId === stage.id).map(({ stageId, ...x }) => x),
    status: stage.status, stopReasons: stage.stopReasons,
  }, singleRound(r, scDigest), resumed);
  const issues = [...state.issues.filter(x => x.stageId !== stage.id), ...next.issues.map(x => ({ ...x, stageId: stage.id }))];
  const stages = state.stages.map((s, j) => j !== index ? s : { ...s, status: next.status, stopReasons: next.stopReasons,
    sessions: s.sessions.includes(r.reviewerSession) ? s.sessions : [...s.sessions, r.reviewerSession], roundCount: s.roundCount + 1 });
  return withOverall({ ...state, rounds: [...state.rounds, r], issues, stages });
}
function initial(contract) {
  const c = validateContract(contract);
  if (c.schema !== CONTRACT_V2) return { contract: c, rounds: [], issues: [], status: 'open', stopReasons: [] };
  return withOverall({ contract: c, rounds: [], issues: [], stages: c.stages.map(s => ({ id: s.id, label: s.label,
    reviewer: s.reviewer, maxRounds: s.maxRounds, status: 'open', stopReasons: [], sessions: [], roundCount: 0 })) });
}

module.exports = { CONTRACT, ROUND, CONTRACT_V2, ROUND_V2, START, SUBMIT, CONTINUED, RESUME, RESUME_SCHEMA,
  ReviewFeedbackError, fail, parsed, id, digest, stable, sameActor, exact, text, refs,
  validateContract, validateRound, validateResume, authorizeResume, initial, advance, continuedOnly };
