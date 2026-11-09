'use strict';

const C = require('./review-feedback-contract');
const REASONS = ['verification-incomplete', 'disputed-issue', 'unchanged-source', 'no-resolved-blocker'];
const ALL_REASONS = [...REASONS, 'new-risk-needs-decision', 'round-budget-exhausted'];

function validate(value) {
  const d = C.parsed(value);
  C.exact(d, ['schema', 'reviewId', 'taskId', 'contractDigest', 'expectedRound', 'lastRoundId',
    'stopReasons', 'decisionId', 'decisionSource', 'evidence'], ['stageId']);
  if (d.schema !== C.RESUME_SCHEMA) C.fail('feedback_schema_invalid');
  for (const key of ['reviewId', 'taskId', 'lastRoundId', 'decisionId']) C.id(d[key]);
  if (Object.hasOwn(d, 'stageId')) C.id(d.stageId);
  if (typeof d.contractDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(d.contractDigest)) C.fail('feedback_revision_invalid');
  if (!Number.isInteger(d.expectedRound) || d.expectedRound < 1 || d.expectedRound > 10) C.fail('feedback_round_invalid');
  if (!Array.isArray(d.stopReasons) || !d.stopReasons.length || d.stopReasons.length > ALL_REASONS.length
    || new Set(d.stopReasons).size !== d.stopReasons.length || d.stopReasons.some(x => !ALL_REASONS.includes(x))) {
    C.fail('feedback_resume_reason_invalid');
  }
  d.stopReasons.sort();
  C.text(d.decisionSource); C.refs(d.evidence);
  return d;
}
function context(state) {
  const stage = state.stages?.find(s => s.id === state.currentStageId) || state.stages?.at(-1);
  return {
    stageId: stage?.id, used: stage ? stage.roundCount : state.rounds.length,
    maxRounds: stage ? stage.maxRounds : state.contract.maxRounds,
    last: stage ? state.rounds.filter(r => r.stageId === stage.id).at(-1) : state.rounds.at(-1),
  };
}
function eligibility(state) {
  const c = context(state);
  let code = null;
  if (state.status !== 'NEEDS_DECISION') code = 'feedback_review_not_stopped';
  else if (state.resumePermit) code = 'feedback_resume_already_authorized';
  else if (c.used >= c.maxRounds) code = 'feedback_budget_exhausted';
  else if (state.stopReasons.includes('new-risk-needs-decision')) code = 'feedback_resume_scope_decision_required';
  else if (!state.stopReasons.length || state.stopReasons.some(x => !REASONS.includes(x))) code = 'feedback_resume_reason_unsupported';
  return { allowed: code === null, code, remainingRounds: Math.max(0, c.maxRounds - c.used) };
}
function matches(state, d) {
  const c = context(state);
  return state.status === 'NEEDS_DECISION' && c.used < c.maxRounds
    && state.stopReasons.length > 0 && state.stopReasons.every(x => REASONS.includes(x))
    && d.reviewId === state.contract.reviewId && d.taskId === state.contract.taskId
    && d.contractDigest === C.digest(state.contract) && d.expectedRound === c.used
    && d.lastRoundId === c.last?.roundId && d.stageId === c.stageId
    && C.stable(d.stopReasons) === C.stable([...state.stopReasons].sort());
}
function permitted(state) {
  return !!state.resumePermit && matches(state, validate(state.resumePermit));
}
function authorize(state, value) {
  const d = validate(value), e = eligibility(state);
  if (!e.allowed) C.fail(e.code);
  if ((state.resumeHistory || []).some(x => x.decisionId === d.decisionId)) C.fail('feedback_resume_duplicate');
  if (!matches(state, d)) C.fail('feedback_resume_stale');
  return { ...state, resumePermit: d, resumeHistory: [...(state.resumeHistory || []), d] };
}
function template(state) {
  if (!eligibility(state).allowed) return null;
  const c = context(state);
  return { schema: C.RESUME_SCHEMA, reviewId: state.contract.reviewId, taskId: state.contract.taskId,
    contractDigest: C.digest(state.contract), expectedRound: c.used, lastRoundId: c.last.roundId,
    ...(c.stageId ? { stageId: c.stageId } : {}), stopReasons: [...state.stopReasons].sort(),
    decisionId: '<new owner decision id>', decisionSource: '<actual owner instruction and its source>', evidence: [] };
}

module.exports = { validate, eligibility, permitted, authorize, template };
