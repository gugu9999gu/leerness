'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const C = require('../lib/task-review-assessment');

function sample() {
  const manifest = {
    taskId: 'T-0384', baselineCommit: 'a'.repeat(40),
    scopePaths: ['lib/', 'scripts/task-review-assessment-probe.js', 'docs/task-review-operations.md'],
    excludedPaths: ['lib/secrets.js'],
    criteria: [{ id: 'AC-1', outcome: 'Focused regression passes.' },
      { id: 'AC-2', outcome: 'A fresh reviewer has no earlier verdicts.' }],
    reviewMode: 'hybrid', risk: 'normal'
  };
  return { schema: C.SCHEMA, manifest, observation: {
    frozenDigest: C.scopeDigest(manifest), headCommit: 'b'.repeat(40),
    changedPaths: ['lib/task-review-assessment.js', 'docs/task-review-operations.md'],
    criteriaResults: [{ id: 'AC-1', status: 'passed', evidence: ['test:focused'] },
      { id: 'AC-2', status: 'passed', evidence: ['packet:independent'] }],
    checks: [{ id: 'focused', status: 'passed', evidence: ['run:1'] }],
    review: { stageA: 'PASS', stageB: 'PASS' }, unresolvedBlockers: 0,
    metrics: { elapsedHours: 5, checkpoints: 1, noProgress: 0, repeatFailures: 0, reviewRounds: 2, executedValidationMs: 1000 },
    runs: [{ id: 'run-1', kind: 'test', sourceRevision: 'change-1', status: 'passed', durationMs: 1000, costUsd: null, reusedFrom: null }]
  } };
}
function rejected(run, code) { assert.throws(run, error => error instanceof C.TaskReviewInputError && error.code === code); }
test('frozen scope and evidence yield a candidate, never completion', () => {
  const r = C.assessTaskReview(sample());
  assert.equal(r.scope.state, 'locked'); assert.equal(r.completion.state, 'candidate');
  assert.equal(r.effects.taskCompleted, false); assert.equal(r.effects.reviewApproved, false);
  assert.equal(r.sourceTrust, 'caller-supplied');
});
test('scope checksum mismatch is not a valid lock', () => {
  const s = sample(); s.manifest.criteria[0].outcome = 'changed acceptance';
  assert.deepEqual(C.assessTaskReview(s).scope.reasons, ['frozen-scope-mismatch']);
});
test('unknown path and excluded path require change decision', () => {
  const s = sample(); s.observation.changedPaths.push('other/file.js', 'lib/secrets.js');
  const r = C.assessTaskReview(s);
  assert.deepEqual(r.scope.outOfScope, ['other/file.js', 'lib/secrets.js']);
  assert.equal(r.bottleneck.splitSuggested, true); assert.equal(r.completion.state, 'blocked');
});
test('missing or unverified criteria cannot be called done', () => {
  const s = sample(); s.observation.criteriaResults.pop();
  assert.deepEqual(C.assessTaskReview(s).completion.missingCriteria, ['AC-2']);
  s.observation.criteriaResults[0].evidence = [];
  assert.equal(C.assessTaskReview(s).completion.state, 'blocked');
});
test('unknown extra criterion is a blocker rather than silently ignored', () => {
  const s = sample(); s.observation.criteriaResults.push({ id: 'AC-3', status: 'passed', evidence: ['claim'] });
  assert.deepEqual(C.assessTaskReview(s).completion.unknownCriteria, ['AC-3']);
});
test('test failures and no evidence block completion', () => {
  const s = sample(); s.observation.checks[0].status = 'failed';
  assert.equal(C.assessTaskReview(s).completion.state, 'blocked');
  s.observation.checks[0].status = 'passed'; s.observation.checks[0].evidence = [];
  assert.equal(C.assessTaskReview(s).completion.state, 'blocked');
});
test('hybrid review requires both stages; optional self review is not independence', () => {
  const s = sample(); s.observation.review.stageB = 'not-run';
  assert.equal(C.assessTaskReview(s).completion.state, 'blocked');
  s.manifest.reviewMode = 'optional'; s.observation.frozenDigest = C.scopeDigest(s.manifest);
  assert.equal(C.assessTaskReview(s).completion.state, 'candidate');
});
test('unresolved blockers remain blockers despite passing review', () => {
  const s = sample(); s.observation.unresolvedBlockers = 1;
  assert.ok(C.assessTaskReview(s).completion.reasons.includes('unresolved-blockers'));
});
test('a repeated stall suggests splitting but never does it', () => {
  const s = sample(); s.observation.metrics.noProgress = 2;
  const r = C.assessTaskReview(s);
  assert.ok(r.bottleneck.triggers.includes('noProgress'));
  assert.equal(r.bottleneck.splitSuggested, true);
  assert.equal(r.effects.filesWritten, false);
});
test('unknown timing is not zero or a completed measurement', () => {
  const s = sample(); for (const k of Object.keys(s.observation.metrics)) s.observation.metrics[k] = null;
  s.observation.runs[0].durationMs = null;
  const r = C.assessTaskReview(s);
  assert.equal(r.bottleneck.state, 'insufficient-data');
  assert.equal(r.validationCost.unmeasuredExecutedRuns, 1);
});
test('cost counts only execution; reuse is not fresh execution', () => {
  const s = sample(); s.observation.runs.push({
    id: 'run-2', kind: 'test', sourceRevision: 'change-1', status: 'passed',
    durationMs: 1000, costUsd: 0.1, reusedFrom: 'run-1' });
  const r = C.assessTaskReview(s);
  assert.equal(r.validationCost.executedRuns, 1);
  assert.equal(r.validationCost.reusedRuns, 1);
  assert.equal(r.validationCost.summedExecutionMs, 1000);
  assert.equal(r.validationCost.knownCostUsd, null);
});
test('failed test and timeout time still count as executed', () => {
  const s = sample(); s.observation.runs[0].status = 'timed-out';
  assert.equal(C.assessTaskReview(s).validationCost.failedOrStoppedRuns, 1);
});
test('independent packet contains only requirements, pinned code and tests', () => {
  const s = sample(), p = C.reviewPacket(s, 'independent', {
    openFindings: [{ id: 'OLD-1', location: 'src/a', reproduction: 'run fail', requiredOutcome: 'fix it' }],
    architectureRefs: ['docs/arch.md'], testCommands: ['node --test focused']
  });
  assert.equal(p.freshSessionRequired, true);
  assert.equal(p.previousReviewerConclusionsIncluded, false);
  assert.equal(p.openFindings, undefined);
  assert.equal(p.previousCommit, undefined);
  assert.equal(p.task.headCommit, s.observation.headCommit);
});
test('recheck packet carries issue IDs and previous source revision', () => {
  const s = sample(), p = C.reviewPacket(s, 'recheck', {
    previousCommit: 'c'.repeat(40),
    openFindings: [{ id: 'F-1', location: 'lib/a.js:1', reproduction: 'case x', requiredOutcome: 'no regression' }]
  });
  assert.equal(p.freshSessionRequired, false);
  assert.equal(p.previousReviewerConclusionsIncluded, true);
  assert.equal(p.openFindings[0].id, 'F-1');
});
test('independent stage cannot start before initial PASS', () => {
  const s = sample(); s.observation.review.stageA = 'FAIL';
  rejected(() => C.reviewPacket(s, 'independent'), 'initial_stage_not_passed');
});
test('invalid path traversal and unknown fields fail closed', () => {
  const s = sample(); s.observation.changedPaths = ['../secret'];
  rejected(() => C.assessTaskReview(s), 'path_invalid');
  const t = sample(); t.manifest.approved = true;
  rejected(() => C.assessTaskReview(t), 'shape_invalid');
});
test('out-of-contract review and metrics are rejected', () => {
  const s = sample(); s.observation.review.stageA = 'OK';
  rejected(() => C.assessTaskReview(s), 'value_invalid');
  const t = sample(); t.observation.metrics.reviewRounds = -1;
  rejected(() => C.assessTaskReview(t), 'number_invalid');
});

test('risk alone does not mandate an external reviewer', () => {
  const s = sample(); s.manifest.reviewMode = 'optional'; s.manifest.risk = 'high';
  s.observation.frozenDigest = C.scopeDigest(s.manifest);
  s.observation.review.stageB = 'not-run';
  const r = C.assessTaskReview(s);
  assert.equal(r.completion.state, 'candidate');
  assert.equal(r.reviewPolicy.independentRequiredBySelection, false);
  assert.equal(r.effects.releaseAuthorized, false);
});
test('packet refuses drifted manifest even if a reviewer claimed PASS', () => {
  const s = sample(); s.observation.changedPaths.push('unexpected/task.js');
  rejected(() => C.reviewPacket(s, 'independent'), 'scope_change_required');
});

test('explicit user request coverage flags omission and scope edits', () => {
  const s = sample();
  s.manifest.requestItems = [{ id: 'R1', sourceRef: 'user', expected: 'No hidden Firestore reader' }, { id: 'R2', sourceRef: 'user', expected: 'Native table authority' }];
  s.observation.frozenDigest = C.scopeDigest(s.manifest);
  s.observation.requestResults = [{ id: 'R1', status: 'verified', evidence: ['test:1'] }];
  assert.deepEqual(C.assessTaskReview(s).requestCoverage.missingRequestIds, ['R2']);
  assert.equal(C.assessTaskReview(s).completion.state, 'blocked');
  s.observation.requestResults.push({ id: 'R2', status: 'deferred', evidence: ['reason:later'] });
  assert.equal(C.assessTaskReview(s).completion.state, 'blocked');
  s.observation.requestResults[1] = { id: 'R2', status: 'verified', evidence: ['code:read'] };
  assert.equal(C.assessTaskReview(s).completion.state, 'candidate');
  s.manifest.requestItems[0].expected = 'tampered';
  assert.equal(C.assessTaskReview(s).scope.state, 'change-required');
});
test('documentation can use evidence-only checks without pretending tests ran', () => {
  const s = sample();
  Object.assign(s.manifest, { workKind: 'documentation', verificationMode: 'evidence-only', verificationReason: 'No executable changes', reviewMode: 'optional' });
  s.manifest.scopePaths = ['docs/'];
  s.observation.changedPaths = ['docs/file.md']; s.observation.checks = [];
  s.observation.review = { stageA: 'not-run', stageB: 'not-run' };
  s.observation.frozenDigest = C.scopeDigest(s.manifest);
  const r = C.assessTaskReview(s);
  assert.equal(r.completion.state, 'candidate'); assert.equal(r.verificationPolicy.testsRun, false);
  s.observation.checks.push({ id: 'failed', status: 'failed', evidence: ['failure'] });
  assert.equal(C.assessTaskReview(s).completion.state, 'blocked');
  for (const kind of ['code','migration']) { s.manifest.workKind = kind; rejected(() => C.assessTaskReview(s), 'test_disposition_invalid'); }
});
test('request trace included in clean independent packet without prior finding', () => {
  const s = sample(); s.manifest.requestItems = [{ id: 'R1', sourceRef: 'user', expected: 'Preserve IDs' }];
  s.observation.frozenDigest = C.scopeDigest(s.manifest);
  const packet=C.reviewPacket(s,'independent');
  assert.equal(packet.task.requestItems[0].id, 'R1'); assert.equal(packet.openFindings, undefined);
});
test('legacy manifest scope digest unchanged when no optional fields', () => {
  const s = sample(), before=C.scopeDigest(s.manifest);
  s.manifest.workKind='code'; assert.notEqual(C.scopeDigest(s.manifest),before);
  delete s.manifest.workKind; assert.equal(C.scopeDigest(s.manifest),before);
});

test('documentation evidence-only cannot silently accept source-code or JSON changes', () => {
  const s=sample();
  Object.assign(s.manifest, { workKind: 'documentation', verificationMode: 'evidence-only',
    verificationReason: 'Text-only change', reviewMode: 'optional', scopePaths: ['docs/', 'src/'] });
  s.observation.frozenDigest=C.scopeDigest(s.manifest);
  s.observation.changedPaths=['docs/index.md','src/runner.ts'];
  s.observation.checks=[];s.observation.review={stageA:'not-run',stageB:'not-run'};
  rejected(()=>C.assessTaskReview(s),'test_disposition_invalid');
  s.observation.changedPaths=['docs/index.md','docs/metadata.json'];
  rejected(()=>C.assessTaskReview(s),'test_disposition_invalid');
  s.observation.changedPaths=['docs/index.md'];
  assert.equal(C.assessTaskReview(s).completion.state,'candidate');
});
