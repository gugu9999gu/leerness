'use strict';

// Bounded re-review: honest stop for a pre-existing medium defect, NO GO kinds, the review-wide budget,
// same-stage session continuation, the --brief re-review view and tool-error vs rejected-input errors.
const assert = require('assert'), fs = require('fs');
module.exports = function register({ test, C, F, L, contract, round, second, fixture, issue, reject, staged, stagedFixture, stagedRound,
  command, resolve }) {
  const transport = require('../lib/review-feedback-transport');
  const medium = (o = {}) => ({ ...issue('M-1', 'risk-escalation'), severity: 'medium', issue: '기존 빈 ID 경로가 요청을 보냄',
    evidence: ['src/user.js:40 existed before this change; test:empty-id fails on the reviewed revision'], ...o });
  const escalation = c => ({ ...second(c), verdict: 'NEEDS_DECISION', findings: [medium()],
    criteriaResults: [{ criterionId: 'user-id', status: 'failed', evidence: ['test:empty-id still sends a request'] }] });
  test('loop: a pre-existing medium defect found after round 1 stops honestly for a decision', () => {
    const c = contract(), root = fixture(c); F.submit(root, round(c));
    const other = { ...contract(), reviewId: 'other-review', taskId: 'T-OTHER' }; F.start(root, other);
    // The frozen 1.36.305 rules (identical to this branch before the change) had no honest encoding:
    const old = require('./review-feedback-legacy')();
    reject(() => old.feedback.submit(root, escalation(c)), 'feedback_risk_invalid');
    const before = fs.readFileSync(L.executionLedgerPath(root));
    reject(() => F.submit(root, { ...escalation(c), findings: [medium({ classification: 'non-blocking', criterionId: 'user-id' })] }), 'feedback_failure_unexplained');
    reject(() => F.submit(root, { ...escalation(c), verdict: 'FAIL', findings: [medium({ classification: 'blocking' })] }), 'feedback_new_blocker_forbidden');
    reject(() => F.submit(root, { ...escalation(c), findings: [medium({ criterionId: null })] }), 'feedback_risk_invalid');
    reject(() => F.submit(root, { ...escalation(c), findings: [medium({ severity: 'low' })] }), 'feedback_risk_invalid');
    assert.deepEqual(fs.readFileSync(L.executionLedgerPath(root)), before);
    const s = F.submit(root, escalation(c));
    assert.equal(s.status, 'NEEDS_DECISION'); assert.equal(s.decision, 'NO GO'); assert.equal(s.outcome, 'decision-pending');
    assert.deepEqual(s.stopReasons, ['new-risk-needs-decision']); assert.equal(s.issues.find(x => x.id === 'M-1').severity, 'medium');
    assert.equal(s.goRequirements.automaticRevisionAllowed, false); assert.deepEqual(s.goRequirements.decisionIssueIds, ['M-1']);
    assert.equal(s.resumeEligibility.code, 'feedback_resume_scope_decision_required'); assert.equal(s.nextResumeTemplate, null);
    assert.equal(s.compatibility.minimumReader, 'resume-aware');
    const events = L.readExecutionEvents(root, 2000, { preserveAll: true }).events.filter(e => e.taskId === 'T-1' && /^review\.feedback\./.test(e.event));
    assert.deepEqual(events.map(e => e.event), [C.START, C.SUBMIT, C.CONTINUED]);
    reject(() => L.appendExecutionEvent(root, { event: C.SUBMIT, taskId: 'T-1', feedbackRound: { ...escalation(c), roundId: 'round-x' } }), 'feedback_continuation_event_required');
    assert.equal(F.show(root, c.reviewId).roundCount, 2);
    // Older readers skip the continued event: earlier projection for this review, unrelated reviews still usable.
    const legacy = old.feedback.show(root, c.reviewId); assert.equal(legacy.status, 'FAIL'); assert.equal(legacy.roundCount, 1);
    assert.equal(old.feedback.show(root, other.reviewId).status, 'open');
    reject(() => F.submit(root, { ...second(c), roundId: 'round-3', expectedRound: 2, sourceRevision: 'sha256:' + 'c'.repeat(64) }), 'feedback_review_stopped');
    const ko = transport.summarize(s, 'ko');
    for (const line of ['[OUTCOME] decision-pending — 판단 대기', '[SCOPE_DECISION_ISSUES]', 'M-1 (medium, risk-escalation']) assert.ok(ko.includes(line), line + '\n' + ko);
  });
  test('loop: a conflicting legacy round after an escalation is reported as a tool error, not rejected input', () => {
    const c = contract(), root = fixture(c); F.submit(root, round(c)); F.submit(root, escalation(c));
    const old = require('./review-feedback-legacy')();
    old.ledger.appendExecutionEvent(root, { event: C.SUBMIT, taskId: 'T-1', feedbackRound: { ...second(c), roundId: 'legacy-2' } });
    assert.throws(() => F.show(root, c.reviewId), e => e.code === 'feedback_review_stopped' && e.source === 'history');
    const r = command(root, ['show', c.reviewId, '--json']); assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).error, { code: 'feedback_review_stopped', kind: 'tool-error' });
  });
  test('loop: CLI errors separate tool and ledger failures from rejected input', () => {
    const root = fixture(); const bad = command(root, ['submit', '--stdin', '--json'], { ...round(), verdict: 'MAYBE' });
    assert.equal(bad.status, 2); assert.deepEqual(JSON.parse(bad.stdout).error, { code: 'feedback_verdict_invalid', kind: 'rejected' });
    const bom = command(root, ['submit', '--stdin', '--json'], String.fromCharCode(0xFEFF) + JSON.stringify(round()));
    assert.equal(JSON.parse(bom.stdout).error.kind, 'rejected');
    fs.appendFileSync(L.executionLedgerPath(root), '{invalid}\n');
    const broken = command(root, ['show', 'review-1', '--json']); assert.equal(broken.status, 2);
    assert.deepEqual(JSON.parse(broken.stdout).error, { code: 'feedback_history_unavailable', kind: 'tool-error' });
  });
  test('loop: NO GO kinds tell fixes, missing verification and owner decisions apart without changing verdicts', () => {
    const root = fixture(); assert.equal(F.show(root, 'review-1').outcome, 'not-reviewed');
    const fail = F.submit(root, round()); assert.equal(fail.status, 'FAIL'); assert.equal(fail.outcome, 'fix-required');
    assert.equal(F.submit(root, second()).outcome, 'passed');
    const v = fixture(), r = round(); r.findings = []; r.criteriaResults[0].status = 'unverified'; r.criteriaResults[0].evidence = ['test:no-id not run'];
    r.verdict = 'NEEDS_DECISION'; const pending = F.submit(v, r);
    assert.equal(pending.status, 'NEEDS_DECISION'); assert.equal(pending.outcome, 'verification-pending');
    const en = transport.summarize(pending, 'en'); assert.ok(en.includes('[OUTCOME] verification-pending — verification pending'), en);
    assert.ok(en.includes('[VERDICT] NEEDS_DECISION') && en.includes('[DECISION] NO GO'));
    const c1 = { ...contract(), maxRounds: 1 }, one = fixture(c1);
    const exhausted = F.submit(one, { ...round(c1), verdict: 'NEEDS_DECISION' });
    assert.deepEqual(exhausted.stopReasons, ['round-budget-exhausted']); assert.equal(exhausted.outcome, 'decision-pending');
    assert.ok(transport.summarize(exhausted, 'ko').includes('[OUTCOME] decision-pending — 판단 대기'));
  });
  test('loop: the review-wide budget adds up stages and flags budgets above the recommended three', () => {
    const root = stagedFixture();
    let s = F.submit(root, stagedRound({ stageId: 'first', roundId: 'r-1', session: 'rev-1', verdict: 'FAIL', findings: [issue()] }));
    assert.deepEqual(s.goRoute.budget, { roundsUsed: 1, maxRounds: 3, remaining: 2 });
    assert.deepEqual(s.goRoute.reviewBudget, { roundsUsed: 1, maxRounds: 5, remaining: 4, recommendedMax: 3 });
    const en = transport.summarize(s, 'en');
    assert.ok(en.includes('review total 1/5'), en); assert.ok(en.includes('above the 3 recommended for ordinary work'), en);
    assert.ok(transport.summarize(s, 'ko').includes('일반 작업 권장치 3회를 넘습니다'));
    const lean = staged(); lean.stages[0].maxRounds = 2; lean.stages[1].maxRounds = 1; const lr = stagedFixture(lean);
    s = F.submit(lr, stagedRound({ contract: lean, stageId: 'first', roundId: 'r-1', session: 'rev-1' }));
    assert.deepEqual(s.goRoute.reviewBudget, { roundsUsed: 1, maxRounds: 3, remaining: 1, recommendedMax: 3 });
    assert.ok(!transport.summarize(s, 'en').includes('recommended for ordinary work'));
    const v1 = F.submit(fixture(), round()); assert.deepEqual(v1.goRoute.reviewBudget, { roundsUsed: 1, maxRounds: 3, remaining: 2, recommendedMax: 3 });
  });
  test('loop: a same-stage re-review may continue its session; a new stage still needs its own', () => {
    const root = stagedFixture();
    let s = F.show(root, 'review-1'); assert.equal(s.goRoute.steps.find(x => x.code === 'request-review').continueSession, null);
    s = F.submit(root, stagedRound({ stageId: 'first', roundId: 'r-1', session: 'rev-1', verdict: 'FAIL', findings: [issue()] }));
    const request = s.goRoute.steps.find(x => x.code === 'request-review'); assert.equal(request.continueSession, 'rev-1'); assert.equal(request.newSession, true);
    assert.ok(transport.summarize(s, 'en').includes("continuing this stage's session rev-1 where available"));
    assert.ok(transport.summarize(s, 'ko').includes('가능하면 이 단계가 쓴 세션 rev-1을 이어서'));
    s = F.submit(root, stagedRound({ stageId: 'first', roundId: 'r-2', expectedRound: 1, attempt: 'impl-2', rev: 'b', session: 'rev-1', resolutions: [resolve()] }));
    assert.equal(s.currentStageId, 'final'); assert.deepEqual(s.stages[0].sessions, ['rev-1']);
    assert.equal(s.goRoute.steps.find(x => x.code === 'request-review').continueSession, null);
    reject(() => F.submit(root, stagedRound({ stageId: 'final', roundId: 'f-1', attempt: 'impl-2', rev: 'b', session: 'rev-1' })), 'feedback_session_reused');
  });
  test('loop: show --brief gives a re-review only open findings and names the rest', () => {
    const c = contract(), root = fixture(c);
    const two = { ...issue('I-2'), issue: '빈 문자열 ID도 요청됨', acceptanceCriteria: [{ id: 'empty-id', outcome: '빈 문자열에서는 요청 0회' }] };
    F.submit(root, { ...round(c), findings: [issue(), two, { ...issue('N-1', 'non-blocking'), severity: 'low' }] });
    F.submit(root, { ...second(c), verdict: 'FAIL', resolutions: [resolve(), resolve('unresolved', 'I-2')].map(x => x.issueId === 'I-2'
      ? { ...x, checks: [{ criterionId: 'empty-id', status: 'failed', evidence: ['empty string still requests'] }] } : x),
    criteriaResults: [{ criterionId: 'user-id', status: 'failed', evidence: ['test:empty-id fails'] }] });
    const full = command(root, ['show', c.reviewId, '--json']), short = command(root, ['show', c.reviewId, '--json', '--brief']);
    assert.equal(short.status, full.status); assert.equal(short.status, 1);
    const b = JSON.parse(short.stdout).result;
    assert.equal(b.schema, 'leerness.review-feedback-brief/v1'); assert.equal(b.outcome, 'fix-required'); assert.equal(b.contractDigest, C.digest(c));
    assert.deepEqual(b.openFindings.map(f => f.id), ['I-2']); assert.deepEqual(b.omitted.resolvedIssueIds, ['I-1']);
    assert.deepEqual(b.omitted.nonBlockingIssueIds, ['N-1']); assert.equal(b.omitted.roundCount, 2);
    assert.equal(b.previousRound.sourceRevision, second(c).sourceRevision); assert.equal(b.approvalGranted, false);
    assert.ok(!Object.hasOwn(b, 'rounds') && !Object.hasOwn(b, 'issues'));
    assert.ok(short.stdout.length < full.stdout.length / 2, short.stdout.length + ' vs ' + full.stdout.length);
    const text = command(root, ['show', c.reviewId, '--brief', '--language', 'en']);
    assert.equal(text.status, 1);
    for (const line of ['[REVIEW_BRIEF]', '[OUTCOME] fix-required', 'I-2 (high, blocking, unresolved)', '[ ] empty-id', '[PREVIOUS_ROUND]', '[RE_REVIEW_FOCUS]',
      'resolved I-1; non-blocking N-1; 2 round(s)', 'leerness review-feedback show review-1 --json']) assert.ok(text.stdout.includes(line), line + '\n' + text.stdout);
    assert.ok(!text.stdout.includes('[RESOLVED_ISSUES]') && !text.stdout.includes('[WHY_IT_FAILS]'));
    assert.ok(command(root, ['show', c.reviewId, '--brief', '--language', 'ko']).stdout.includes('[OUTCOME] fix-required — 수정 필요'));
    const misuse = command(root, ['submit', '--stdin', '--brief'], second(c)); assert.equal(misuse.status, 2);
    assert.equal(JSON.parse(misuse.stdout).error.code, 'feedback_cli_arguments');
  });
};
