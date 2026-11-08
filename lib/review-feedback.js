'use strict';

const C = require('./review-feedback-contract');
const report = require('./review-feedback-report');
 
function ledger() { return require('./role-fallback'); }
function read(root) {
  const h = ledger().readExecutionEvents(root, 2000, { preserveAll: true, maxBytes: 64 * 1024 * 1024 });
  if (!h.ok || h.truncated) C.fail('feedback_history_unavailable');
  return h.events;
}
// A rule broken by already stored history is a ledger problem, not a rejection of the caller's input.
function projectStored(events) {
  try { return project(events); } catch (error) {
    if (error instanceof C.ReviewFeedbackError) error.source = 'history';
    throw error;
  }
}
function project(events) {
  const states = new Map(), tasks = new Map();
  for (let index = 0; index < events.length; index++) {
    const e = events[index];
    if (e.event === C.START) {
      const c = C.validateContract(e.feedbackContract);
      if (c.taskId !== e.taskId || states.has(c.reviewId) || tasks.has(c.taskId)) C.fail('feedback_contract_exists');
      const state = C.initial(c); states.set(c.reviewId, state); tasks.set(c.taskId, c.reviewId);
    } else if (e.event === C.SUBMIT || e.event === C.CONTINUED) {
      const r = C.validateRound(e.event === C.SUBMIT ? e.feedbackRound : e.feedbackContinuedRound), state = states.get(r.reviewId);
      if (!state || state.contract.taskId !== e.taskId) C.fail('feedback_contract_missing');
      validateRoundEvent(state, e, r);
      validateTarget(events.slice(0, index), state.contract, r);
      states.set(r.reviewId, C.advance(state, r));
    } else if (e.event === C.RESUME) {
      const d = C.validateResume(e.feedbackResume), state = states.get(d.reviewId);
      if (!state || state.contract.taskId !== e.taskId || d.taskId !== e.taskId) C.fail('feedback_contract_missing');
      if (e.executed) C.fail('feedback_resume_execution_invalid');
      states.set(d.reviewId, C.authorizeResume(state, d));
    }
  }
  return { states, tasks };
}
function roundEvent(state, round) { return state.resumeHistory?.length || C.continuedOnly(round) ? C.CONTINUED : C.SUBMIT; }
function validateRoundEvent(state, event, round) {
  if (event.event !== roundEvent(state, round)) C.fail('feedback_continuation_event_required');
  if (event.event === C.CONTINUED && event.executed) C.fail('feedback_resume_execution_invalid');
}
function validateTarget(events, contract, r) {
  const candidates = events.filter(e => e.attemptId === r.implementationAttemptId
    && ['execution.completed', 'execution.failed'].includes(e.event));
  if (candidates.length !== 1 || candidates[0].taskId !== contract.taskId) C.fail('feedback_implementation_missing');
  if (candidates[0].executed !== true) C.fail('feedback_implementation_not_executed');
   
   
  if (r.reviewerSession && candidates[0].sessionId && candidates[0].sessionId === r.reviewerSession) C.fail('feedback_session_not_independent');
}
 
 
function validateAppend(events, event) {
  const { states, tasks } = projectStored(events);
  if (event.event === C.START) {
    const c = C.validateContract(event.feedbackContract);
    if (event.taskId !== c.taskId) C.fail('feedback_task_mismatch');
    if (states.has(c.reviewId) || tasks.has(c.taskId)) C.fail('feedback_contract_exists');
  } else if (event.event === C.SUBMIT || event.event === C.CONTINUED) {
    const r = C.validateRound(event.event === C.SUBMIT ? event.feedbackRound : event.feedbackContinuedRound), state = states.get(r.reviewId);
    if (!state || state.contract.taskId !== event.taskId) C.fail('feedback_contract_missing');
    validateRoundEvent(state, event, r);
    validateTarget(events, state.contract, r); C.advance(state, r);
  } else if (event.event === C.RESUME) {
    const d = C.validateResume(event.feedbackResume), state = states.get(d.reviewId);
    if (!state || state.contract.taskId !== event.taskId || d.taskId !== event.taskId) C.fail('feedback_contract_missing');
    if (event.executed) C.fail('feedback_resume_execution_invalid');
    C.authorizeResume(state, d);
  } else if (event.event === 'review.completed' && tasks.has(event.taskId)) {
    const state = states.get(tasks.get(event.taskId));
     
     
    const named = state.stages && event.review ? state.rounds.find(x => x.roundId === event.review.feedbackRoundId) : null;
    const last = state.stages ? named && state.rounds.filter(x => x.stageId === named.stageId).at(-1) : state.rounds.at(-1);
    if (!last || !event.review || event.review.feedbackRoundId !== last.roundId
      || last.implementationAttemptId !== event.reviewOfAttemptId
      || !C.sameActor(last.reviewer, event.actualExecutor)) C.fail('feedback_result_required');
  } else if (event.event === 'review.completed' && event.review && event.review.feedbackRoundId) {
    C.fail('feedback_contract_missing');
  }
}
function publicState(state) {
  const resumeRules = require('./review-feedback-resume');
  const escalated = state.rounds.some(C.continuedOnly);
  return { ...state, contractDigest: C.digest(state.contract), roundCount: state.rounds.length,
    decision: report.decision(state.status),
    outcome: report.outcome(state),
    goRequirements: report.requirements(state),
     
     
    goRoute: report.route(state),
    nextRoundTemplate: report.nextRoundTemplate(state),
    resumeEligibility: resumeRules.eligibility(state),
    nextResumeTemplate: resumeRules.template(state),
    compatibility: state.resumeHistory?.length ? {
      minimumReader: 'resume-aware',
      legacyView: 'Older versions retain the stopped NO GO projection and cannot submit this continuation; unrelated reviews remain usable.',
    } : escalated ? {
      minimumReader: 'resume-aware',
      legacyView: 'Older versions skip the round that escalated a medium criterion risk and show the earlier projection; do not continue this review with them. Unrelated reviews remain usable.',
    } : null,
    nextAction: report.nextAction(state),
    trust: 'caller-declared; evidence and reviewer identity are not authenticated'
      + (state.resumeHistory?.length ? '; owner decision and its source are not authenticated' : ''), approvalGranted: false };
}
function show(root, reviewId) {
  C.id(reviewId); const state = projectStored(read(root)).states.get(reviewId);
  if (!state) C.fail('feedback_contract_missing');
  return publicState(state);
}
function start(root, input) {
  const c = C.validateContract(input);
  const F = ledger();
  return F.withExecutionLedgerLock(root, () => {
    const events = read(root), existing = projectStored(events).states.get(c.reviewId);
    if (existing) {
      if (C.stable(existing.contract) !== C.stable(c)) C.fail('feedback_contract_changed');
      return publicState(existing);
    }
    F.appendExecutionEvent(root, { event: C.START, taskId: c.taskId, feedbackContract: c, executed: false });
    return publicState(C.initial(c));
  });
}
function submit(root, input) {
  const r = C.validateRound(input), F = ledger();
  return F.withExecutionLedgerLock(root, () => {
    const events = read(root), state = projectStored(events).states.get(r.reviewId);
    if (!state) C.fail('feedback_contract_missing');
    const replay = state.rounds.find(x => x.roundId === r.roundId);
    if (replay) {
      if (C.stable(replay) !== C.stable(r)) C.fail('feedback_replay_conflict');
      return publicState(state);
    }
    validateTarget(events, state.contract, r);
    const next = C.advance(state, r);
    const event = roundEvent(state, r);
    F.appendExecutionEvent(root, { event, taskId: state.contract.taskId,
      [event === C.SUBMIT ? 'feedbackRound' : 'feedbackContinuedRound']: r, executed: false });
    return publicState(next);
  });
}
function resume(root, input) {
  const d = C.validateResume(input), F = ledger();
  return F.withExecutionLedgerLock(root, () => {
    const state = projectStored(read(root)).states.get(d.reviewId);
    if (!state) C.fail('feedback_contract_missing');
    const replay = state.resumeHistory?.find(x => x.decisionId === d.decisionId);
    if (replay) {
      if (C.stable(replay) !== C.stable(d)) C.fail('feedback_resume_replay_conflict');
      return publicState(state);
    }
    const next = C.authorizeResume(state, d);
    F.appendExecutionEvent(root, { event: C.RESUME, taskId: state.contract.taskId,
      feedbackResume: d, executed: false });
    return publicState(next);
  });
}

module.exports = { show, start, submit, resume, validateAppend, project, publicState };
