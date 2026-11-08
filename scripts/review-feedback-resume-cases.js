'use strict';

const assert = require('assert'), cp = require('child_process'), fs = require('fs'), path = require('path');
module.exports = function register({ test, C, F, L, contract, round, second, fixture, resumeFirst, resumeDecision,
  bytes, reject, staged, stagedFixture, stagedRound, finalReviewer, cli, command, hash, resolve }) {
  const decide = (state, id) => ({ ...state.nextResumeTemplate, decisionId: id,
    decisionSource: 'Owner requested another review without changing criteria.', evidence: ['decision:synthetic-owner'] });
  function concurrent(root, op, inputs) {
    const script = `const cp=require('child_process');const [cli,root,op,...inputs]=process.argv.slice(1);
      Promise.all(inputs.map(input=>new Promise((resolve,reject)=>{
        const p=cp.spawn(process.execPath,[cli,'review-feedback',op,'--stdin','--json','--path',root],{windowsHide:true});
        let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);
        p.on('close',code=>resolve({code,out,err}));p.stdin.on('error',reject);p.stdin.end(input);
      }))).then(x=>console.log(JSON.stringify(x)),e=>{console.error(e);process.exitCode=1;});`;
    const p = cp.spawnSync(process.execPath, ['-e', script, cli, root, op, ...inputs.map(x => JSON.stringify(x))],
      { encoding: 'utf8', timeout: 60000, windowsHide: true });
    assert.equal(p.status, 0, p.stderr); return JSON.parse(p.stdout);
  }
  test('resume exact concurrent retries are idempotent before and after consuming the permit', () => {
    const c = contract(), root = fixture(c); F.submit(root, resumeFirst(c));
    const d = resumeDecision(c);
    assert.deepEqual(concurrent(root, 'resume', [d, d]).map(x => x.code), [1, 1]);
    assert.equal(F.show(root, c.reviewId).resumeHistory.length, 1);
    const before = bytes(root);
    reject(() => F.resume(root, { ...d, decisionSource: 'changed' }), 'feedback_resume_replay_conflict');
    assert.deepEqual(bytes(root), before);
    const r = second(c);
    assert.deepEqual(concurrent(root, 'submit', [r, r]).map(x => x.code), [0, 0]);
    assert.equal(F.show(root, c.reviewId).roundCount, 2);
    const done = bytes(root);
    assert.equal(F.resume(root, d).resumePermit, null);
    assert.equal(F.submit(root, r).roundCount, 2);
    reject(() => F.submit(root, { ...r, sourceRevision: hash('c') }), 'feedback_replay_conflict');
    assert.deepEqual(bytes(root), done);
  });
  test('resume preserves stop reasons and requires a fresh decision at each stop', () => {
    const c = contract(), root = fixture(c); const first = F.submit(root, resumeFirst(c));
    const d = decide(first, 'owner-1'); F.resume(root, d);
    const r = second(c); r.verdict = 'NEEDS_DECISION'; r.resolutions = [resolve('unresolved')];
    r.criteriaResults[0].status = 'unverified';
    const stopped = F.submit(root, r);
    assert.deepEqual(stopped.stopReasons, ['verification-incomplete', 'no-resolved-blocker']);
    assert.equal(F.resume(root, d).resumePermit, null); // old retry never re-authorizes
    reject(() => F.submit(root, { ...second(c), roundId: 'round-3', expectedRound: 2 }), 'feedback_review_stopped');
    const next = F.resume(root, decide(stopped, 'owner-2'));
    assert.equal(next.roundCount, 2); assert.equal(next.goRoute.budget.remaining, 1); assert.equal(next.status, 'NEEDS_DECISION');
    const final = F.submit(root, { ...second(c), roundId: 'round-3', expectedRound: 2, sourceRevision: hash('c') });
    assert.equal(final.status, 'PASS'); assert.equal(final.roundCount, 3); assert.equal(final.approvalGranted, false);
  });
  test('resume budget exhaustion and scope risks cannot be waived by a decision', () => {
    const c = { ...contract(), maxRounds: 1 }, root = fixture(c), r = resumeFirst(c);
    const stopped = F.submit(root, r), before = bytes(root);
    assert.equal(stopped.resumeEligibility.code, 'feedback_budget_exhausted'); assert.equal(stopped.nextResumeTemplate, null);
    reject(() => F.resume(root, resumeDecision(c, { stopReasons: stopped.stopReasons })), 'feedback_budget_exhausted');
    assert.deepEqual(bytes(root), before);
    const other = fixture(), risk = resumeFirst(); risk.findings[0].classification = 'risk-escalation';
    const s = F.submit(other, risk);
    assert.equal(s.resumeEligibility.code, 'feedback_resume_scope_decision_required');
    reject(() => F.resume(other, resumeDecision(contract(), { stopReasons: s.stopReasons })), 'feedback_resume_scope_decision_required');
  });
  test('resume staged review retains reviewer, sessions, earlier passes and per-stage budgets', () => {
    const c = staged(finalReviewer), root = stagedFixture(c);
    F.submit(root, stagedRound({ contract: c, stageId: 'first', roundId: 'r-1', session: 'first-session' }));
    const r = stagedRound({ contract: c, stageId: 'final', roundId: 'f-1', session: 'final-session', verdict: 'NEEDS_DECISION' });
    r.criteriaResults[0].status = 'unverified';
    const stopped = F.submit(root, r), d = decide(stopped, 'owner-final');
    assert.equal(d.expectedRound, 1); assert.equal(d.stageId, 'final');
    reject(() => F.resume(root, { ...d, stageId: 'first' }), 'feedback_resume_stale');
    const allowed = F.resume(root, d);
    assert.equal(allowed.status, 'NEEDS_DECISION'); assert.equal(allowed.roundCount, 2);
    assert.equal(allowed.goRoute.budget.remaining, 1); assert.equal(allowed.nextRoundTemplate.stageId, 'final');
    const next = stagedRound({ contract: c, stageId: 'final', roundId: 'f-2', session: 'final-session', expectedRound: 1 });
    const before = bytes(root);
    reject(() => F.submit(root, { ...next, reviewerSession: 'first-session' }), 'feedback_session_reused');
    reject(() => F.submit(root, { ...next, reviewerSession: 'worker-session' }), 'feedback_session_not_independent');
    assert.deepEqual(bytes(root), before);
    const done = F.submit(root, next);
    assert.equal(done.status, 'PASS'); assert.deepEqual(done.stages.map(s => s.roundCount), [1, 2]);
    assert.deepEqual(done.stages[0], stopped.stages[0]); assert.deepEqual(done.contract, stopped.contract);
  });
  test('resume continuation events are required for all later rounds and rejected without a decision', () => {
    const c = contract(), root = fixture(c); F.submit(root, resumeFirst(c)); const r = second(c), before = bytes(root);
    reject(() => L.appendExecutionEvent(root, { event: C.CONTINUED, taskId: c.taskId, feedbackContinuedRound: r }), 'feedback_continuation_event_required');
    assert.deepEqual(bytes(root), before); F.resume(root, resumeDecision(c)); const permitted = bytes(root);
    reject(() => L.appendExecutionEvent(root, { event: C.SUBMIT, taskId: c.taskId, feedbackRound: r }), 'feedback_continuation_event_required');
    reject(() => L.appendExecutionEvent(root, { event: C.CONTINUED, taskId: c.taskId, feedbackRound: r, feedbackContinuedRound: r }), 'feedback_event_mismatch');
    reject(() => L.appendExecutionEvent(root, { event: C.CONTINUED, taskId: c.taskId, feedbackContinuedRound: r, executed: true }), 'feedback_resume_execution_invalid');
    assert.deepEqual(bytes(root), permitted); F.submit(root, r);
    const events = L.readExecutionEvents(root, 2000, { preserveAll: true }).events;
    assert.equal(events.filter(e => e.event === C.SUBMIT).length, 1);
    assert.equal(events.filter(e => e.event === C.CONTINUED).length, 1);
    assert.ok(bytes(root).subarray(0, before.length).equals(before));
  });
  test('resume malformed input, prototype fields and corrupted history do not authorize', () => {
    const root = fixture(); const stopped = F.submit(root, resumeFirst()), before = bytes(root);
    const bad = [{ ...resumeDecision(), evidence: [] }, { ...resumeDecision(), approvalGranted: true },
      { ...resumeDecision(), stopReasons: ['verification-incomplete', 'verification-incomplete'] }];
    for (const d of bad) assert.equal(command(root, ['resume', '--stdin', '--json'], d).status, 2);
    assert.equal(command(root, ['resume', '--stdin', '--json'], JSON.stringify(resumeDecision()).replace('{', '{"schema":"duplicate",')).status, 2);
    assert.equal(command(root, ['resume', '--stdin', '--json'], stopped.nextResumeTemplate).status, 2);
    assert.deepEqual(bytes(root), before);
    fs.appendFileSync(L.executionLedgerPath(root), '{corrupt}\n');
    const corrupt = bytes(root);
    reject(() => F.resume(root, resumeDecision()), 'feedback_history_unavailable');
    assert.deepEqual(bytes(root), corrupt);
  });
  test('resume frozen 1.36.305 reader and writer stay usable for unrelated reviews', () => {
    const old = require('./review-feedback-legacy')(), c = contract(), root = fixture(c);
    F.submit(root, resumeFirst(c)); F.resume(root, resumeDecision(c)); F.submit(root, second(c));
    assert.equal(old.ledger.readExecutionEvents(root, 2000, { preserveAll: true }).ok, true);
    const stale = old.feedback.show(root, c.reviewId);
    assert.equal(stale.status, 'NEEDS_DECISION'); assert.equal(stale.roundCount, 1); assert.equal(stale.resumePermit, undefined);
    const other = { ...contract(), reviewId: 'other-legacy', taskId: 'T-OTHER-LEGACY' };
    old.ledger.appendExecutionEvent(root, { event: 'execution.completed', taskId: other.taskId, attemptId: 'other-impl',
      executed: true, actualExecutor: { provider: 'worker', model: 'test-worker' }, evidenceRefs: ['test:other'] });
    assert.equal(old.feedback.start(root, other).status, 'open');
    assert.equal(old.feedback.submit(root, { ...round(other), implementationAttemptId: 'other-impl' }).status, 'FAIL');
    assert.equal(F.show(root, c.reviewId).status, 'PASS'); assert.equal(F.show(root, other.reviewId).status, 'FAIL');
    const saved = bytes(root);
    reject(() => old.feedback.submit(root, second(c)), 'feedback_review_stopped');
    assert.deepEqual(bytes(root), saved);
  });
  test('resume instructions keep a tool failure separate from the product task', () => {
    const guidance = require('../lib/review-feedback-guidance');
    for (const lang of ['en', 'ko']) {
      const text = guidance.projectGuidance(lang);
      assert.ok(text.includes('review-feedback resume --file'));
      assert.ok(text.includes('result.nextResumeTemplate'));
    }
    assert.match(guidance.REVIEW_GUIDANCE, /Do not switch to modifying the verification tool/);
    assert.match(guidance.projectGuidance('ko'), /명시적인 요청 없이 검증 도구 수정/);
  });
  test('resume frozen legacy reader stays usable through later stages without an external installation', () => {
    const old = require('./review-feedback-legacy')(), c = staged(finalReviewer), root = stagedFixture(c);
    const first = stagedRound({ contract: c, stageId: 'first', roundId: 'r-1', session: 'first-session', verdict: 'NEEDS_DECISION' });
    first.criteriaResults[0].status = 'unverified';
    F.resume(root, decide(F.submit(root, first), 'owner-first'));
    F.submit(root, stagedRound({ contract: c, stageId: 'first', roundId: 'r-2', session: 'first-session', expectedRound: 1 }));
    const done = F.submit(root, stagedRound({ contract: c, stageId: 'final', roundId: 'f-1', session: 'final-session' }));
    assert.equal(done.status, 'PASS'); assert.deepEqual(done.stages.map(s => s.roundCount), [2, 1]);
    const stopped = old.feedback.show(root, c.reviewId);
    assert.equal(stopped.status, 'NEEDS_DECISION'); assert.equal(stopped.currentStageId, 'first'); assert.equal(stopped.roundCount, 1);
    const other = { ...contract(), reviewId: 'other-after-stages', taskId: 'T-OTHER-STAGES' };
    old.ledger.appendExecutionEvent(root, { event: 'execution.completed', taskId: other.taskId, attemptId: 'other-impl',
      executed: true, actualExecutor: { provider: 'worker', model: 'test-worker' }, evidenceRefs: ['test:other'] });
    assert.equal(old.feedback.start(root, other).status, 'open');
    assert.equal(old.feedback.submit(root, { ...round(other), implementationAttemptId: 'other-impl' }).status, 'FAIL');
    assert.equal(F.show(root, c.reviewId).status, 'PASS'); assert.equal(F.show(root, other.reviewId).status, 'FAIL');
  });
  if (process.env.LEERNESS_PREVIOUS_INSTALL) test('resume legacy writer can submit unrelated reviews after multiple continued stages', () => {
    const oldCli = path.join(process.env.LEERNESS_PREVIOUS_INSTALL, 'bin/leerness.js');
    const c = staged(finalReviewer), root = stagedFixture(c);
    const r = stagedRound({ contract: c, stageId: 'first', roundId: 'r-1', session: 'rev-first', verdict: 'NEEDS_DECISION' });
    r.criteriaResults[0].status = 'unverified'; F.resume(root, decide(F.submit(root, r), 'owner-first'));
    F.submit(root, stagedRound({ contract: c, stageId: 'first', roundId: 'r-2', session: 'rev-first', expectedRound: 1 }));
    F.submit(root, stagedRound({ contract: c, stageId: 'final', roundId: 'f-1', session: 'rev-final' }));
    const other = { ...contract(), reviewId: 'unrelated', taskId: 'T-OTHER' };
    L.appendExecutionEvent(root, { event: 'execution.completed', taskId: other.taskId, attemptId: 'other-impl',
      executed: true, actualExecutor: { provider: 'worker', model: 'test-worker' }, evidenceRefs: ['test:other'] });
    const runOld = (op, input) => cp.spawnSync(process.execPath, [oldCli, 'review-feedback', op, '--stdin', '--json', '--path', root],
      { input: JSON.stringify(input), encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(runOld('start', other).status, 0);
    const otherRound = { ...round(other), implementationAttemptId: 'other-impl' };
    const p = runOld('submit', otherRound);
    assert.equal(p.status, 1, p.stdout + p.stderr); assert.equal(JSON.parse(p.stdout).result.status, 'FAIL');
    assert.equal(F.show(root, c.reviewId).status, 'PASS'); assert.equal(F.show(root, other.reviewId).status, 'FAIL');
    const events = L.readExecutionEvents(root, 2000, { preserveAll: true }).events;
    assert.equal(events.filter(e => e.event === C.CONTINUED).length, 2);
  });
};
