'use strict';

const C = require('./review-feedback-contract');
const report = require('./review-feedback-report');
// Loaded lazily by the ledger; avoid circular imports during module initialization.
function ledger() { return require('./role-fallback'); }
function read(root) {
  const h = ledger().readExecutionEvents(root, 2000, { preserveAll: true, maxBytes: 64 * 1024 * 1024 });
  if (!h.ok || h.truncated) C.fail('feedback_history_unavailable');
  return h.events;
}
function project(events) {
  const states = new Map(), tasks = new Map();
  for (let index = 0; index < events.length; index++) {
    const e = events[index];
    if (e.event === C.START) {
      const c = C.validateContract(e.feedbackContract);
      if (c.taskId !== e.taskId || states.has(c.reviewId) || tasks.has(c.taskId)) C.fail('feedback_contract_exists');
      const state = C.initial(c); states.set(c.reviewId, state); tasks.set(c.taskId, c.reviewId);
    } else if (e.event === C.SUBMIT) {
      const r = C.validateRound(e.feedbackRound), state = states.get(r.reviewId);
      if (!state || state.contract.taskId !== e.taskId) C.fail('feedback_contract_missing');
      validateTarget(events.slice(0, index), state.contract, r);
      states.set(r.reviewId, C.advance(state, r));
    }
  }
  return { states, tasks };
}
function validateTarget(events, contract, r) {
  const candidates = events.filter(e => e.attemptId === r.implementationAttemptId
    && ['execution.completed', 'execution.failed'].includes(e.event));
  if (candidates.length !== 1 || candidates[0].taskId !== contract.taskId) C.fail('feedback_implementation_missing');
  if (candidates[0].executed !== true) C.fail('feedback_implementation_not_executed');
  // T-0316: a staged review's reviewer works in a new session; the session that recorded the implementation
  // cannot review it (the ledger's `same-session` independence rule). Sessions are declared, not authenticated.
  if (r.reviewerSession && candidates[0].sessionId && candidates[0].sessionId === r.reviewerSession) C.fail('feedback_session_not_independent');
}
// Runs inside the same canonical ledger lock as the append. Every writer uses it,
// including callers bypassing the CLI. History remains the only state store.
function validateAppend(events, event) {
  const { states, tasks } = project(events);
  if (event.event === C.START) {
    const c = C.validateContract(event.feedbackContract);
    if (event.taskId !== c.taskId) C.fail('feedback_task_mismatch');
    if (states.has(c.reviewId) || tasks.has(c.taskId)) C.fail('feedback_contract_exists');
  } else if (event.event === C.SUBMIT) {
    const r = C.validateRound(event.feedbackRound), state = states.get(r.reviewId);
    if (!state || state.contract.taskId !== event.taskId) C.fail('feedback_contract_missing');
    validateTarget(events, state.contract, r); C.advance(state, r);
  } else if (event.event === 'review.completed' && tasks.has(event.taskId)) {
    const state = states.get(tasks.get(event.taskId));
    // v1 binds the latest round. A staged review binds the latest round of the named round's stage: the next stage
    // may already have reviewed before the previous stage's reviewer records its terminal review event.
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
  return { ...state, contractDigest: C.digest(state.contract), roundCount: state.rounds.length,
    decision: report.decision(state.status),
    goRequirements: report.requirements(state),
    // T-0316: derived on read like goRequirements — the ordered route to GO with each check's current status, and
    // a skeleton of the next round that is rejected until its placeholders are replaced.
    goRoute: report.route(state),
    nextRoundTemplate: report.nextRoundTemplate(state),
    nextAction: report.nextAction(state),
    trust: 'caller-declared; evidence and reviewer identity are not authenticated', approvalGranted: false };
}
function show(root, reviewId) {
  C.id(reviewId); const state = project(read(root)).states.get(reviewId);
  if (!state) C.fail('feedback_contract_missing');
  return publicState(state);
}
function start(root, input) {
  const c = C.validateContract(input);
  const F = ledger();
  return F.withExecutionLedgerLock(root, () => {
    const events = read(root), existing = project(events).states.get(c.reviewId);
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
    const events = read(root), state = project(events).states.get(r.reviewId);
    if (!state) C.fail('feedback_contract_missing');
    const replay = state.rounds.find(x => x.roundId === r.roundId);
    if (replay) {
      if (C.stable(replay) !== C.stable(r)) C.fail('feedback_replay_conflict');
      return publicState(state);
    }
    validateTarget(events, state.contract, r);
    const next = C.advance(state, r);
    F.appendExecutionEvent(root, { event: C.SUBMIT, taskId: state.contract.taskId,
      feedbackRound: r, executed: false });
    return publicState(next);
  });
}

module.exports = { show, start, submit, validateAppend, project, publicState };
