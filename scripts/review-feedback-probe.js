'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-review-feedback-'));
  try {
    const env = { ...process.env, REVIEW_FEEDBACK_PROBE: arena, LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_INTERNAL: '1' };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase()); fs.mkdirSync(env[key]); }
    // 600 s: the full run took 3 min 37 s on a loaded machine (2026-09-30); 240 s cut it off without a summary.
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { env, encoding: 'utf8', timeout: 600000, windowsHide: true });
    process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
    if (r.error) console.error(r.error.message); process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const real = fs.realpathSync(arena); assert.equal(path.dirname(real).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(real).startsWith('leerness-review-feedback-')); removeTree(real, { recursive: true, force: true });
  }
  return;
}
const C = require('../lib/review-feedback-contract'), F = require('../lib/review-feedback'), L = require('../lib/role-fallback');
const cli = path.resolve(__dirname, '../bin/leerness.js'), arena = process.env.REVIEW_FEEDBACK_PROBE;
const clone = x => JSON.parse(JSON.stringify(x)), hash = x => 'sha256:' + x.repeat(64);
let passed = 0, failed = 0, n = 0;
const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
function test(name, fn) { if (filter && !name.includes(filter)) return; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.stack); } }
const reviewer = { provider: 'codex', model: 'review-model' };
function contract() { return { schema: C.CONTRACT, reviewId: 'review-1', taskId: 'T-1', reviewer, scope: '사용자 조회 요청만 검수',
  criteria: [{ id: 'user-id', outcome: '유효한 userId에서만 API를 호출한다.' }], maxRounds: 3 }; }
function issue(id = 'I-1', classification = 'blocking') { return { id, severity: 'high', classification, criterionId: classification === 'non-blocking' ? null : 'user-id',
  issue: '사용자 ID 없이 요청됨', evidence: ['src/user.js:12; test:no-id'], whyItFails: '인증되지 않은 요청이 발생할 수 있다.',
  requiredOutcome: '유효한 ID가 없으면 요청을 보내지 않는다.', acceptanceCriteria: [{ id: 'null-id', outcome: 'null/undefined에서는 요청 0회' }],
  implementationHint: '호출 조건 분리 등을 고려. 방법은 작업자가 선택.' }; }
function round(c = contract()) { return { schema: C.ROUND, reviewId: c.reviewId, roundId: 'round-1', expectedRound: 0, contractDigest: C.digest(c), reviewer,
  implementationAttemptId: 'impl-1', sourceRevision: hash('a'), verdict: 'FAIL', findings: [issue()], resolutions: [],
  criteriaResults: [{ criterionId: 'user-id', status: 'failed', evidence: ['test:no-id fails'] }], regressionCheck: { status: 'passed', evidence: ['existing-flow test passes'] } }; }
function resolve(status = 'resolved', issueId = 'I-1') { return { issueId, status, evidence: ['test:no-id rerun'],
  checks: [{ criterionId: 'null-id', status: status === 'resolved' ? 'passed' : 'failed', evidence: ['test:no-id actual result'] }] }; }
function second(c = contract()) { return { ...round(c), roundId: 'round-2', expectedRound: 1, sourceRevision: hash('b'), implementationAttemptId: 'impl-2', verdict: 'PASS',
  findings: [], resolutions: [resolve()], criteriaResults: [{ criterionId: 'user-id', status: 'passed', evidence: ['test:no-id and normal-id pass'] }] }; }
function terminal(task = 'T-1', attempt = 'impl-1') { return { event: 'execution.completed', taskId: task, attemptId: attempt,
  actualExecutor: { provider: 'claude', model: 'worker-model' }, executed: true, evidenceRefs: ['test:implementation'] }; }
function fixture(c = contract()) { const root = path.join(arena, 'project-' + (++n)); fs.mkdirSync(root); fs.mkdirSync(path.join(root, '.leerness'));
  L.appendExecutionEvent(root, terminal()); L.appendExecutionEvent(root, terminal('T-1', 'impl-2')); F.start(root, c); return root; }
function reject(fn, code) { assert.throws(fn, e => e.code === code, code); }
function bytes(root) { return fs.readFileSync(L.executionLedgerPath(root)); }
function command(root, args, input) { return cp.spawnSync(process.execPath, [cli, 'review-feedback', ...args, '--path', root],
  { encoding: 'utf8', input: typeof input === 'string' ? input : input == null ? undefined : JSON.stringify(input), timeout: 30000, windowsHide: true }); }
test('failing review gives actionable output; successful recheck preserves initial criteria', () => {
  const root = fixture(); const a = F.submit(root, round()); assert.equal(a.status, 'FAIL');
  const b = F.submit(root, second()); assert.equal(b.status, 'PASS'); assert.equal(b.approvalGranted, false);
  assert.deepEqual(b.issues[0].acceptanceCriteria, issue().acceptanceCriteria); assert.equal(b.roundCount, 2);
  const text = require('../lib/review-feedback-transport').summarize(b);
  for (const field of ['[WHY_IT_FAILS]', '[REQUIRED_OUTCOME]', '[ACCEPTANCE_CRITERIA]', '[IMPLEMENTATION_HINT]', '[RECHECK]']) assert.ok(text.includes(field));
  assert.equal(L.readExecutionEvents(root).ok, true);
});
test('NO GO report explicitly connects open blockers to frozen GO conditions', () => {
  const root = fixture(), state = F.submit(root, round());
  assert.equal(state.decision, 'NO GO');
  assert.deepEqual(state.goRequirements.issueIds, ['I-1']);
  assert.deepEqual(state.goRequirements.criterionIds, ['user-id']);
  const report = require('../lib/review-feedback-transport').summarize(state);
  assert.ok(report.includes('[TO_GO]'));assert.ok(report.includes(issue().requiredOutcome));
  assert.ok(report.includes(issue().acceptanceCriteria[0].outcome));
  assert.ok(report.indexOf('[TO_GO]') < report.indexOf('[ISSUE] I-1'));
});
test('NO GO final-response guidance also covers reviews outside the feedback CLI', () => {
  const g = require('../lib/review-feedback-guidance');
  assert.ok(g.REVIEW_GUIDANCE.includes('NO GO'));
  assert.ok(g.REVIEW_GUIDANCE.includes('final response'));
  assert.ok(g.REVIEW_GUIDANCE.includes('without the CLI'));
  for (const lang of ['en', 'ko']) assert.ok(g.projectGuidance(lang).includes('NO GO'));
});
test('NO GO JSON and human CLI expose the same original conditions without rewriting history', () => {
  const root = fixture();F.submit(root, round());const before = bytes(root);
  const json = command(root, ['show', 'review-1', '--json']), human = command(root, ['show', 'review-1']);
  assert.equal(json.status, 1);assert.equal(human.status, 1);
  const state = JSON.parse(json.stdout).result;
  assert.equal(state.decision, 'NO GO');assert.equal(state.goRequirements.automaticRevisionAllowed, true);
  assert.ok(human.stdout.includes('[DECISION] NO GO'));assert.ok(human.stdout.includes(issue().whyItFails));
  assert.deepEqual(bytes(root), before);assert.ok(!before.toString('utf8').includes('goRequirements'));
});
test('NO GO unrun checks request evidence instead of fabricated correction issues', () => {
  const root = fixture(), r = round();r.findings = [];r.verdict = 'NEEDS_DECISION';
  r.criteriaResults[0].status = 'unverified';r.criteriaResults[0].evidence = ['test:not-run'];r.regressionCheck.status = 'unverified';
  const state = F.submit(root, r), report = require('../lib/review-feedback-transport').summarize(state);
  assert.equal(state.decision, 'NO GO');assert.deepEqual(state.goRequirements.issueIds, []);
  assert.deepEqual(state.goRequirements.criterionIds, ['user-id']);assert.equal(state.goRequirements.regressionCheckRequired, true);
  assert.equal(state.goRequirements.automaticRevisionAllowed, false);assert.ok(report.includes('unrun check'));assert.ok(!report.includes('[ISSUE]'));
});
test('NO GO re-review retains the first outcome and explicitly stops a no-progress loop', () => {
  const root = fixture();F.submit(root, round());const r = second();r.verdict = 'NEEDS_DECISION';r.resolutions = [resolve('unresolved')];r.criteriaResults[0].status = 'failed';
  const state = F.submit(root, r), report = require('../lib/review-feedback-transport').summarize(state);
  assert.deepEqual(state.goRequirements.issueIds, ['I-1']);assert.equal(state.goRequirements.automaticRevisionAllowed, false);
  assert.ok(state.goRequirements.decisions.some(d => d.code === 'no-resolved-blocker'));
  assert.ok(report.includes(issue().requiredOutcome));assert.ok(report.includes('[RECHECK] unresolved'));
  assert.equal(report.split('[ISSUE] I-1').length - 1, 1);assert.ok(report.includes('cannot accept more rounds'));
});
test('GO does not promote optional suggestions or already resolved issues into blockers', () => {
  const root = fixture();F.submit(root, round());const r = second();r.findings = [issue('optional', 'non-blocking')];
  const state = F.submit(root, r), report = require('../lib/review-feedback-transport').summarize(state);
  assert.equal(state.decision, 'GO');assert.equal(state.approvalGranted, false);
  assert.deepEqual(state.goRequirements.issueIds, []);assert.deepEqual(state.goRequirements.criterionIds, []);
  assert.equal(state.goRequirements.reReviewRequired, false);assert.equal(state.goRequirements.regressionCheckRequired, false);
  const fixSection = report.split('[TO_GO]')[1].split('[FIXED_CRITERIA]')[0];assert.ok(!fixSection.includes('[ISSUE]'));
  assert.ok(report.includes('[NON_BLOCKING_SUGGESTIONS]'));assert.ok(report.includes('[RESOLVED_ISSUES]'));
  assert.equal(report.split('[ISSUE] optional').length - 1, 1);
});
test('NO GO new regression targets only its new blocker and original acceptance checks', () => {
  const root = fixture();F.submit(root, round());const r = second();r.verdict = 'FAIL';r.findings = [issue('regression', 'regression')];
  r.findings[0].regression = { previousRevision: hash('a'), currentRevision: hash('b'), beforeEvidence: ['before:passes'], afterEvidence: ['after:fails'] };
  r.regressionCheck.status = 'failed';const state = F.submit(root, r);
  assert.deepEqual(state.goRequirements.issueIds, ['regression']);assert.equal(state.goRequirements.regressionCheckRequired, true);
  assert.equal(state.issues.find(f => f.id === 'I-1').status, 'resolved');
});
test('NO GO scope risks are explicit owner decisions and never automatic code instructions', () => {
  const root = fixture();F.submit(root, round());const r = second();r.verdict = 'NEEDS_DECISION';r.findings = [issue('risk', 'risk-escalation')];
  const state = F.submit(root, r), report = require('../lib/review-feedback-transport').summarize(state);
  assert.deepEqual(state.goRequirements.issueIds, []);assert.deepEqual(state.goRequirements.decisionIssueIds, ['risk']);
  assert.ok(state.goRequirements.decisions.some(d => d.code === 'new-risk-needs-decision' && d.requiredAction.includes('owner')));
  assert.equal(state.goRequirements.automaticRevisionAllowed, false);assert.ok(report.includes('[SCOPE_DECISION_ISSUES]'));
});
test('NO GO exhausted budget cannot be reported as permission for one more automatic revision', () => {
  const c = contract();c.maxRounds = 1;const root = fixture(c), r = round(c);r.verdict = 'NEEDS_DECISION';
  const state = F.submit(root, r);assert.equal(state.goRequirements.automaticRevisionAllowed, false);
  assert.ok(state.goRequirements.decisions.some(d => d.code === 'round-budget-exhausted' && d.requiredAction.includes('reset')));
  assert.equal(state.approvalGranted, false);
});
test('unreviewed work has no GO or NO GO verdict and retains pending fixed checks', () => {
  const root = fixture(), state = F.show(root, 'review-1');assert.equal(state.decision, 'NOT_REVIEWED');
  assert.deepEqual(state.goRequirements.criterionIds, ['user-id']);assert.equal(state.goRequirements.regressionCheckRequired, true);
  assert.equal(state.goRequirements.automaticRevisionAllowed, false);
});
for (const field of ['issue', 'evidence', 'whyItFails', 'requiredOutcome', 'acceptanceCriteria']) test('reject missing ' + field + ' without changing history', () => {
  const root = fixture(), before = bytes(root), r = round(); delete r.findings[0][field];
  reject(() => F.submit(root, r), 'feedback_shape_invalid'); assert.deepEqual(bytes(root), before);
});
test('strict JSON, Unicode and shape boundaries', () => {
  reject(() => C.validateContract('{"schema":1,"schema":2}'), 'duplicate_json_key');
  for (const value of [' ', '\uD800', '\x00']) { const c = contract(); c.scope = value; reject(() => C.validateContract(c), 'feedback_text_invalid'); }
  const c = contract(); c.extra = true; reject(() => C.validateContract(c), 'feedback_shape_invalid');
  const obj = contract(); Object.defineProperty(obj, 'scope', { get() { throw new Error('getter invoked'); } }); reject(() => C.validateContract(obj), 'feedback_shape_invalid');
  const cyc = {}; cyc.x = cyc; reject(() => C.validateContract(cyc), 'feedback_shape_invalid');
});
test('contract and reviewer are immutable; another ID cannot reset task budget', () => {
  const root = fixture(), c = contract(), before = bytes(root); c.maxRounds = 10;
  reject(() => F.start(root, c), 'feedback_contract_changed'); c.reviewId = 'review-new'; reject(() => F.start(root, c), 'feedback_contract_exists');
  const r = round(); r.reviewer.model = 'other'; reject(() => F.submit(root, r), 'feedback_reviewer_mismatch'); r.reviewer.model = reviewer.model = 'review-model';
  assert.deepEqual(bytes(root), before);
});
test('stale concurrent round cannot overwrite accepted feedback', () => {
  const root = fixture(); F.submit(root, round()); const before = bytes(root), r = round(); r.roundId = 'competing';
  reject(() => F.submit(root, r), 'feedback_stale_round'); assert.deepEqual(bytes(root), before);
});
test('exact retry is idempotent; changed payload conflicts', () => {
  const root = fixture(); F.submit(root, round()); const before = bytes(root); F.submit(root, round()); F.start(root, contract()); assert.deepEqual(bytes(root), before);
  const r = round(); r.findings[0].issue += ' changed'; reject(() => F.submit(root, r), 'feedback_replay_conflict');
});
test('cannot redefine an existing issue or change its recheck criteria', () => {
  const root = fixture(); F.submit(root, round()); const r = second(); r.findings = [issue()];
  reject(() => F.submit(root, r), 'feedback_issue_redefined'); r.findings = []; r.resolutions[0].checks[0].criterionId = 'new-rule';
  reject(() => F.submit(root, r), 'feedback_coverage_missing');
});
test('late normal blocker forbidden; preference stays nonblocking and allows pass', () => {
  const root = fixture(); F.submit(root, round()); const r = second(); r.findings = [issue('I-2')];
  reject(() => F.submit(root, r), 'feedback_new_blocker_forbidden'); r.findings = [issue('I-2', 'non-blocking')]; assert.equal(F.submit(root, r).status, 'PASS');
});
test('new regression requires before/after revision evidence and keeps original resolution', () => {
  const root = fixture(); F.submit(root, round()); const r = second(); r.verdict = 'FAIL'; r.findings = [issue('I-2', 'regression')];
  reject(() => F.submit(root, r), 'feedback_shape_invalid');
  r.findings[0].regression = { previousRevision: hash('a'), currentRevision: hash('b'), beforeEvidence: ['before:passes'], afterEvidence: ['after:fails'] };
  r.regressionCheck.status = 'failed'; const b = F.submit(root, r); assert.equal(b.status, 'FAIL'); assert.equal(b.issues[0].status, 'resolved');
  const next = { ...second(), roundId: 'round-3', expectedRound: 2, sourceRevision: hash('c'), verdict: 'NEEDS_DECISION',
    resolutions: [resolve(), resolve('unresolved', 'I-2')], regressionCheck: { status: 'failed', evidence: ['still:fails'] } };
  assert.ok(F.submit(root, next).stopReasons.includes('round-budget-exhausted'));
});
test('unbound or fabricated revision pair is rejected structurally', () => {
  const s = C.advance(C.initial(contract()), round()), r = second(); r.verdict = 'FAIL';
  r.findings = [{ ...issue('I-2', 'regression'), regression: { previousRevision: hash('c'), currentRevision: hash('b'), beforeEvidence: ['old'], afterEvidence: ['new'] } }];
  reject(() => C.advance(s, r), 'feedback_regression_unbound');
});
test('no progress stops before budget and cannot be submitted as ordinary FAIL', () => {
  const root = fixture(); F.submit(root, round()); const r = second(); r.resolutions = [resolve('unresolved')]; r.criteriaResults[0].status = 'failed'; r.verdict = 'FAIL';
  reject(() => F.submit(root, r), 'feedback_verdict_inconsistent'); r.verdict = 'NEEDS_DECISION'; assert.ok(F.submit(root, r).stopReasons.includes('no-resolved-blocker'));
  const third = { ...second(), roundId: 'round-3', expectedRound: 2 }; reject(() => F.submit(root, third), 'feedback_review_stopped');
});
test('budget exhaustion never becomes PASS', () => {
  const c = contract(); c.maxRounds = 1; const root = fixture(c), r = round(c); reject(() => F.submit(root, r), 'feedback_verdict_inconsistent');
  r.verdict = 'NEEDS_DECISION'; assert.ok(F.submit(root, r).stopReasons.includes('round-budget-exhausted'));
});
test('new serious risk and disputed resolution require decision', () => {
  const root = fixture(); F.submit(root, round()); const r = second(); r.findings = [issue('risk', 'risk-escalation')]; r.verdict = 'NEEDS_DECISION';
  assert.ok(F.submit(root, r).stopReasons.includes('new-risk-needs-decision'));
  const s = C.advance(C.initial(contract()), round()), dispute = second(); dispute.resolutions = [resolve('disputed')]; dispute.verdict = 'NEEDS_DECISION';
  assert.ok(C.advance(s, dispute).stopReasons.includes('disputed-issue'));
});
test('no false PASS for missing evidence, unresolved checks or unexplained failures', () => {
  const r = round(); r.verdict = 'PASS'; reject(() => C.advance(C.initial(contract()), r), 'feedback_verdict_inconsistent');
  r.verdict = 'FAIL'; r.findings = []; reject(() => C.advance(C.initial(contract()), r), 'feedback_failure_unexplained');
  r.criteriaResults[0].evidence = []; reject(() => C.validateRound(r), 'feedback_list_invalid');
});
test('mandatory constraints need a supported reason and evidence; hints remain optional', () => {
  const r = round(); delete r.findings[0].implementationHint; assert.equal(C.validateRound(r).findings.length, 1);
  r.findings[0].mandatoryConstraint = { reason: 'style', requirement: 'Use my code', evidence: ['taste'] };
  reject(() => C.validateRound(r), 'feedback_constraint_invalid'); r.findings[0].mandatoryConstraint.reason = 'security'; assert.equal(C.validateRound(r).findings.length, 1);
});
test('missing/wrong task or unexecuted implementation is rejected', () => {
  const root = fixture(), r = round(); r.implementationAttemptId = 'missing'; reject(() => F.submit(root, r), 'feedback_implementation_missing');
  L.appendExecutionEvent(root, terminal('T-other', 'wrong')); r.implementationAttemptId = 'wrong'; reject(() => F.submit(root, r), 'feedback_implementation_missing');
});
test('generic append cannot bypass feedback state guard', () => {
  const root = fixture(); F.submit(root, round()); const r = second(); r.expectedRound = 0;
  reject(() => L.appendExecutionEvent(root, { event: C.SUBMIT, taskId: 'T-1', feedbackRound: r }), 'feedback_stale_round');
  reject(() => L.appendExecutionEvent(root, { event: 'review.completed', taskId: 'T-1', attemptId: 'review-exec', parentAttemptId: 'impl-1',
    reviewOfAttemptId: 'impl-1', actualExecutor: reviewer, evidenceRefs: ['test:review'], executed: true }), 'feedback_result_required');
});
test('legacy review records remain readable without an activated contract', () => {
  const root = path.join(arena, 'legacy'); fs.mkdirSync(root); fs.mkdirSync(path.join(root, '.leerness'));
  L.appendExecutionEvent(root, { event: 'review.completed', taskId: 'old-task', attemptId: 'old-review', parentAttemptId: 'old-impl',
    actualExecutor: reviewer, evidenceRefs: ['legacy:review'], executed: true }); assert.equal(L.readExecutionEvents(root).ok, true);
});
test('CLI round trip persists across processes and returns failing exit for FAIL', () => {
  const root = fixture(), r = command(root, ['submit', '--stdin', '--json'], round()); assert.equal(r.status, 1, r.stderr + r.stdout); assert.equal(JSON.parse(r.stdout).result.status, 'FAIL');
  const show = command(root, ['show', 'review-1', '--json']); assert.equal(show.status, 1); assert.equal(JSON.parse(show.stdout).result.roundCount, 1);
  const done = command(root, ['submit', '--stdin', '--json'], second()); assert.equal(done.status, 0, done.stderr + done.stdout);
  const human = command(root, ['show', 'review-1']); assert.ok(human.stdout.includes('[REQUIRED_OUTCOME]')); assert.ok(human.stdout.includes('사용자'));
});
test('malformed CLI input does not create workspace or mutate history', () => {
  const root = path.join(arena, 'no-writes'); fs.mkdirSync(root);
  for (const args of [['start', '--stdin', '--stdin'], ['show', 'none', '--unknown'], ['submit', '--stdin']]) {
    const r = command(root, args, '{}'); assert.equal(r.status, 2); assert.deepEqual(fs.readdirSync(root), []);
  }
});
test('invalid UTF-8 is rejected before writing', () => {
  const root = fixture(), before = bytes(root);
  const r = cp.spawnSync(process.execPath, [cli, 'review-feedback', 'submit', '--stdin', '--path', root], { input: Buffer.from([0xff]), encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 2); assert.ok(r.stdout.includes('invalid_utf8')); assert.deepEqual(bytes(root), before);
});
// Cross-model review 2026-09-30, round 3: every --file refusal exits 2 and leaves the history as it was.
test('--file refuses a missing file, a directory, an oversized file, a byte-order mark and invalid UTF-8 without writing; the exact limit is read', () => {
  const MAX = require('../lib/review-checkpoint').MAX_BYTES;
  const root = fixture(), before = bytes(root), dir = path.join(arena, 'file-inputs-' + (++n)); fs.mkdirSync(dir);
  const put = (name, data) => { const f = path.join(dir, name); fs.writeFileSync(f, data); return f; };
  const body = JSON.stringify(round());
  const cases = [
    ['missing', path.join(dir, 'none.json'), 'input_file_unreadable'],
    ['directory', dir, 'input_file_unreadable'],
    ['one byte over the limit', put('over.json', body + ' '.repeat(MAX + 1 - Buffer.byteLength(body))), 'input_too_large'],
    ['byte-order mark', put('bom.json', Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(body)])), 'utf8_bom_not_allowed'],
    ['invalid UTF-8', put('bad.json', Buffer.from([0x7B, 0xFF, 0x7D])), 'invalid_utf8'],
  ];
  for (const [name, file, code] of cases) {
    const r = command(root, ['submit', '--file', file]);
    assert.equal(r.status, 2, name + '\n' + r.stdout + r.stderr); assert.ok(r.stdout.includes(code), name + ': ' + r.stdout);
    assert.deepEqual(bytes(root), before, name + ': history changed');
  }
  const empty = path.join(arena, 'no-writes-file-' + (++n)); fs.mkdirSync(empty);
  const s = command(empty, ['start', '--file', path.join(dir, 'over.json')]);
  assert.equal(s.status, 2, s.stdout + s.stderr); assert.ok(s.stdout.includes('input_too_large'), s.stdout); assert.deepEqual(fs.readdirSync(empty), []);
  const exact = put('exact.json', body + ' '.repeat(MAX - Buffer.byteLength(body))); assert.equal(fs.statSync(exact).size, MAX);
  const r = command(root, ['submit', '--file', exact, '--json']);
  assert.equal(r.status, 1, r.stdout + r.stderr); assert.equal(JSON.parse(r.stdout).result.status, 'FAIL'); assert.notDeepEqual(bytes(root), before);
});
test('--file reads through one descriptor and stops at the limit, whatever size the file reported', () => {
  // Round 3: a stat of the path followed by a full read of it read a file that grew or was replaced after the check
  // in full. Here every size check sees 2 bytes while the file holds 1 MiB; the reader must stop at the limit.
  const T = require('../lib/review-checkpoint-transport'), MAX = require('../lib/review-checkpoint').MAX_BYTES;
  const file = path.join(arena, 'grown-' + (++n) + '.json'); fs.writeFileSync(file, '{' + ' '.repeat(1 << 20) + '}');
  const orig = { statSync: fs.statSync, fstatSync: fs.fstatSync, openSync: fs.openSync, readSync: fs.readSync, readFileSync: fs.readFileSync };
  const small = st => Object.assign(Object.create(Object.getPrototypeOf(st)), st, { size: 2 });
  // readFileSync may itself read through fs.readSync, so the two counts are kept apart and the larger one is used.
  let fd = -1, viaRead = 0, viaFile = 0, error = null;
  try {
    fs.statSync = function (p, ...rest) { const st = orig.statSync.call(this, p, ...rest); return p === file ? small(st) : st; };
    fs.openSync = function (p, ...rest) { const d = orig.openSync.call(this, p, ...rest); if (p === file) fd = d; return d; };
    fs.fstatSync = function (d, ...rest) { const st = orig.fstatSync.call(this, d, ...rest); return d === fd ? small(st) : st; };
    fs.readSync = function (d, ...rest) { const k = orig.readSync.call(this, d, ...rest); if (d === fd) viaRead += k; return k; };
    fs.readFileSync = function (p, ...rest) { const b = orig.readFileSync.call(this, p, ...rest); if (p === file) viaFile += b.length; return b; };
    try { T.readJsonFile(file); } catch (e) { error = e; }
  } finally { Object.assign(fs, orig); }
  const consumed = Math.max(viaRead, viaFile);
  assert.equal(error && error.code, 'input_too_large', String(error));
  assert.ok(consumed > 0 && consumed <= MAX + 1, 'read ' + consumed + ' bytes against a ' + MAX + '-byte limit');
});
if (process.platform === 'win32') console.log('SKIP --file refuses a FIFO without blocking (POSIX only; not run on this platform)');
else test('--file refuses a FIFO without blocking', () => {
  const fifo = path.join(arena, 'fifo-' + (++n)); cp.execFileSync('mkfifo', [fifo]);
  const root = fixture(), before = bytes(root), r = command(root, ['submit', '--file', fifo]);
  assert.ifError(r.error); assert.equal(r.status, 2, r.stdout + r.stderr); assert.ok(r.stdout.includes('input_file_unreadable'), r.stdout);
  assert.deepEqual(bytes(root), before);
});
test('corrupted or truncated history cannot restart or be treated as pass', () => {
  const root = fixture(); fs.appendFileSync(L.executionLedgerPath(root), '{invalid}\n');
  reject(() => F.show(root, 'review-1'), 'feedback_history_unavailable'); reject(() => F.start(root, contract()), 'feedback_history_unavailable');
});
// T-0314 (owner decision, 2026-09-29): Leerness serves several agents, so AGENTS.md holds the one full copy
// of the protocol in standard and minimal mode, and CLAUDE.md imports it with `@AGENTS.md` (Claude Code loads
// the imported file at launch) instead of repeating it; the copies in CLAUDE.md and the workflow had been
// loaded three times per session start.
test('generated instructions carry the protocol once, in AGENTS.md, in both languages', () => {
  const { coreFiles } = require('../bin/leerness');
  const rf = require('../lib/review-feedback-guidance');
  for (const lang of ['ko', 'en']) for (const mode of ['standard', 'minimal']) {
    const files = coreFiles(arena, lang, [], { mode });
    for (const term of ['review-feedback start --stdin', 'NO GO', 'TO_GO', 'NEEDS_DECISION']) {
      assert.ok(files['AGENTS.md'].includes(term), 'AGENTS.md ' + term + ' ' + mode + lang);
    }
    assert.match(files['CLAUDE.md'], /^@AGENTS\.md$/m, 'CLAUDE.md import ' + mode + lang);
    assert.ok(files['CLAUDE.md'].includes(rf.pointer(lang)), 'CLAUDE.md pointer ' + mode + lang);
    assert.ok(!files['CLAUDE.md'].includes('TO_GO'), 'CLAUDE.md repeats the protocol ' + mode + lang);
  }
  assert.ok(require('../lib/role-catalog')._AGENT_ROLE_PROMPTS.reviewer.includes('REQUIRED_OUTCOME'));
  assert.ok(require('../lib/role-catalog')._AGENT_ROLE_PROMPTS.reviewer.includes('NO GO'));
});
test('actual CLI start freezes default budget and is idempotent', () => {
  const root = path.join(arena, 'cli-start'); fs.mkdirSync(root); const c = contract(); delete c.maxRounds;
  const result = command(root, ['start', '--stdin', '--json'], c); assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(JSON.parse(result.stdout).result.contract.maxRounds, 3); const before = bytes(root);
  assert.equal(command(root, ['start', '--stdin', '--json'], c).status, 0); assert.deepEqual(bytes(root), before);
  assert.ok(command(root, ['show', c.reviewId]).stdout.includes(c.criteria[0].outcome));
});
test('two real CLI processes cannot submit the same next round twice', () => {
  const root = fixture(), a = round(), b = round(); b.roundId = 'other-round';
  const coordinator = `const cp=require('child_process');const [cli,root,a,b]=process.argv.slice(1); Promise.all([a,b].map(input=>new Promise(resolve=>{const p=cp.spawn(process.execPath,[cli,'review-feedback','submit','--stdin','--json','--path',root],{windowsHide:true});let out='';p.stdout.on('data',x=>out+=x);p.on('close',code=>resolve({code,out}));p.stdin.end(input);}))).then(x=>console.log(JSON.stringify(x)));`;
  const result = cp.spawnSync(process.execPath, ['-e', coordinator, cli, root, JSON.stringify(a), JSON.stringify(b)], { encoding: 'utf8', timeout: 45000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr); const outcomes = JSON.parse(result.stdout);
  assert.deepEqual(outcomes.map(x => x.code).sort(), [1, 2]); assert.equal(F.show(root, 'review-1').roundCount, 1);
  assert.ok(outcomes.some(x => x.out.includes('feedback_stale_round')));
});
test('terminal review CLI requires matching feedback and retains its reference', () => {
  const root = fixture(); F.submit(root, round());
  const args = [cli, 'agents', 'record', 'reviewed', 'Review failed; see fixed issue criteria', '--path', root, '--task', 'T-1', '--id', 'review-exec',
    '--target', 'impl-1', '--provider', reviewer.provider, '--model', reviewer.model, '--evidence', 'review:round-1', '--json'];
  const before = bytes(root), bad = cp.spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.notEqual(bad.status, 0); assert.ok(bad.stdout.includes('feedback_result_required'), bad.stdout + bad.stderr); assert.deepEqual(bytes(root), before);
  const good = cp.spawnSync(process.execPath, [...args, '--feedback-round', 'round-1'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(good.status, 0, good.stdout + good.stderr); assert.equal(JSON.parse(good.stdout).event.review.feedbackRoundId, 'round-1');
});
test('unknown criteria, duplicate identifiers and oversized input are rejected', () => {
  const c = contract(); c.criteria.push(clone(c.criteria[0])); reject(() => C.validateContract(c), 'feedback_duplicate_id');
  const r = round(); r.findings[0].criterionId = 'unrelated'; reject(() => C.advance(C.initial(contract()), r), 'feedback_scope_changed');
  reject(() => C.validateContract(' '.repeat(65537)), 'input_too_large');
});
test('resolved issues cannot be reopened without a separately evidenced regression', () => {
  let s = C.advance(C.initial(contract()), round()), r = second(); r.verdict = 'FAIL'; r.findings = [issue('I-2', 'regression')];
  r.findings[0].regression = { previousRevision: hash('a'), currentRevision: hash('b'), beforeEvidence: ['before'], afterEvidence: ['after'] };
  s = C.advance(s, r); r = { ...second(), roundId: 'round-3', expectedRound: 2, sourceRevision: hash('c'), resolutions: [resolve('unresolved'), resolve('resolved', 'I-2')] };
  reject(() => C.advance(s, r), 'feedback_resolved_issue_reopened');
});
test('persona review prompt includes the actionable result protocol', () => {
  const root = fixture(); fs.writeFileSync(path.join(root, 'sample.js'), 'module.exports = 1;\n');
  const r = cp.spawnSync(process.execPath, [cli, 'review', 'sample.js', '--persona', 'security', '--path', root, '--json'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.ok(JSON.parse(r.stdout).prompts[0].prompt.includes('REQUIRED_OUTCOME'));
  assert.ok(JSON.parse(r.stdout).prompts[0].prompt.includes('NO GO'));
});
test('unverified checks stop with visible missing evidence instead of asking for blind code changes', () => {
  const root = fixture(), r = round(); r.findings = []; r.criteriaResults[0].status = 'unverified'; r.criteriaResults[0].evidence = ['Required test not run'];
  r.verdict = 'NEEDS_DECISION'; const state = F.submit(root, r); assert.ok(state.stopReasons.includes('verification-incomplete'));
  const report = require('../lib/review-feedback-transport').summarize(state); assert.ok(report.includes('Required test not run')); assert.ok(report.includes('[FIXED_CRITERIA]'));
});
test('review guidance is safe for the existing portable dispatch command boundary', () => {
  const { _dispatchCommand } = require('../bin/leerness');
  const guidance = require('../lib/review-feedback-guidance').REVIEW_GUIDANCE;
  const command = _dispatchCommand('codex', 'Review task. ' + guidance, false, 'review-model');
  assert.ok(command.includes('REQUIRED_OUTCOME'));
  reject(() => _dispatchCommand('codex', 'Review task.\n' + guidance, false, 'review-model'), 'provider_dispatch_task_unsafe');
});
test('existing MCP record tool binds the structured feedback round', () => {
  const root = fixture(); F.submit(root, round());
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'feedback-probe', version: '1' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'leerness_agents_record', arguments: {
      path: root, event: 'reviewed', summary: 'FAIL with required outcomes recorded', taskId: 'T-1', attemptId: 'mcp-review', targetAttemptId: 'impl-1',
      provider: reviewer.provider, model: reviewer.model, evidence: 'review:round-1', feedbackRoundId: 'round-1' } } }
  ];
  const r = cp.spawnSync(process.execPath, [cli, 'mcp', 'serve', '--profile', 'full'], { cwd: root, encoding: 'utf8',
    input: requests.map(x => JSON.stringify(x)).join('\n') + '\n', timeout: 45000, windowsHide: true });
  assert.equal(r.status, 0, r.stderr + r.stdout); const message = r.stdout.trim().split(/\r?\n/).map(x => JSON.parse(x)).find(x => x.id === 2);
  assert.ok(message && message.result && !message.result.isError, JSON.stringify(message));
  const body = JSON.parse(message.result.content[0].text); assert.equal(body.event.review.feedbackRoundId, 'round-1');
});
// T-0316: staged reviewers and the route to GO. Owner decisions (2026-09-30): stages review in order, only the
// stage that gave NO GO re-reviews, and the same model may serve several stages but each stage reviews in its own
// new session, never the session that recorded the implementation.
const finalReviewer = { provider: 'codex', model: 'final-model' };
function staged(finalBy = reviewer) { return { schema: C.CONTRACT_V2, reviewId: 'review-1', taskId: 'T-1', scope: '사용자 조회 요청만 검수',
  criteria: [{ id: 'user-id', outcome: '유효한 userId에서만 API를 호출한다.' }],
  stages: [{ id: 'first', label: '1차 검수', reviewer, maxRounds: 3 }, { id: 'final', label: '최종 검수', reviewer: finalBy, maxRounds: 2 }] }; }
function stagedRound(o) {
  const c = C.validateContract(o.contract || staged()), stage = c.stages.find(x => x.id === o.stageId), verdict = o.verdict || 'PASS';
  return { schema: C.ROUND_V2, reviewId: c.reviewId, roundId: o.roundId, expectedRound: o.expectedRound || 0, contractDigest: C.digest(c),
    stageId: o.stageId, reviewerSession: o.session, reviewer: o.reviewer || (stage ? stage.reviewer : reviewer),
    implementationAttemptId: o.attempt || 'impl-1', sourceRevision: hash(o.rev || 'a'), verdict, findings: o.findings || [], resolutions: o.resolutions || [],
    criteriaResults: [{ criterionId: 'user-id', status: verdict === 'PASS' ? 'passed' : 'failed', evidence: ['test:user-id'] }],
    regressionCheck: { status: 'passed', evidence: ['existing flow passes'] } };
}
function stagedFixture(c = staged()) {
  const root = path.join(arena, 'staged-' + (++n)); fs.mkdirSync(root); fs.mkdirSync(path.join(root, '.leerness'));
  for (const attempt of ['impl-1', 'impl-2', 'impl-3']) L.appendExecutionEvent(root, { ...terminal('T-1', attempt),
    actualExecutor: { provider: 'claude', model: 'worker-model', sessionId: 'worker-session' } });
  F.start(root, c); return root;
}
const rejectAny = fn => assert.throws(fn, e => /^feedback_/.test(e.code || ''), 'expected a feedback_* rejection');
test('staged contract validates ordered stages, freezes them and never mixes with single-reviewer rounds', () => {
  const c = staged(); delete c.stages[1].maxRounds; assert.equal(C.validateContract(c).stages[1].maxRounds, 3);
  const bad = (mutate, code) => { const x = staged(); mutate(x); reject(() => C.validateContract(x), code); };
  bad(x => { x.stages = []; }, 'feedback_list_invalid');
  bad(x => { x.stages = Array.from({ length: 6 }, (_, i) => ({ id: 's' + i, label: 'stage ' + i, reviewer })); }, 'feedback_list_invalid');
  bad(x => { x.stages[1].id = 'first'; }, 'feedback_duplicate_id');
  bad(x => { x.stages[0].label = 'x'.repeat(81); }, 'feedback_text_invalid');
  bad(x => { x.stages[0].maxRounds = 0; }, 'feedback_budget_invalid');
  bad(x => { x.stages[1].maxRounds = 11; }, 'feedback_budget_invalid');
  bad(x => { x.stages[0].sessions = []; }, 'feedback_shape_invalid');
  bad(x => { x.stages[0].reviewer = { provider: 'codex' }; }, 'feedback_shape_invalid');
  bad(x => { x.reviewer = reviewer; }, 'feedback_shape_invalid');
  bad(x => { x.maxRounds = 3; }, 'feedback_shape_invalid');
  for (const session of ['', ' padded', 'has space', 'x'.repeat(201)]) {
    reject(() => C.validateRound(stagedRound({ stageId: 'first', roundId: 'r-1', session })), 'feedback_session_invalid');
  }
  const root = stagedFixture(), before = bytes(root);
  assert.equal(F.start(root, staged()).currentStageId, 'first'); assert.deepEqual(bytes(root), before);
  const changed = staged(); changed.stages[1].maxRounds = 5; reject(() => F.start(root, changed), 'feedback_contract_changed');
  reject(() => F.submit(root, round()), 'feedback_schema_invalid');
  reject(() => F.submit(fixture(), stagedRound({ stageId: 'first', roundId: 'r-1', session: 'rev-1' })), 'feedback_schema_invalid');
  assert.deepEqual(bytes(root), before);
});
test('staged review runs stages in order and only the stage that gave NO GO re-reviews', () => {
  const root = stagedFixture(), before = bytes(root); let s = F.show(root, 'review-1');
  assert.equal(s.status, 'open'); assert.equal(s.currentStageId, 'first'); assert.equal(s.decision, 'NOT_REVIEWED');
  reject(() => F.submit(root, stagedRound({ stageId: 'final', roundId: 'f-0', session: 'rev-final' })), 'feedback_stage_not_current');
  reject(() => F.submit(root, stagedRound({ stageId: 'other', roundId: 'o-0', session: 'rev-other' })), 'feedback_stage_unknown');
  assert.deepEqual(bytes(root), before);
  s = F.submit(root, stagedRound({ stageId: 'first', roundId: 'r-1', session: 'rev-first', verdict: 'FAIL', findings: [issue()] }));
  assert.equal(s.status, 'FAIL'); assert.equal(s.decision, 'NO GO'); assert.equal(s.currentStageId, 'first'); assert.equal(s.issues[0].stageId, 'first');
  // The stage that gave NO GO re-reviews the revision; its session may continue within the stage.
  s = F.submit(root, stagedRound({ stageId: 'first', roundId: 'r-2', expectedRound: 1, attempt: 'impl-2', rev: 'b', session: 'rev-first', resolutions: [resolve()] }));
  assert.equal(s.status, 'open'); assert.equal(s.decision, 'NOT_REVIEWED'); assert.equal(s.currentStageId, 'final');
  assert.deepEqual(s.stages.map(x => x.status), ['PASS', 'open']); assert.match(s.nextAction, /previous stage passed/);
  reject(() => F.submit(root, stagedRound({ stageId: 'first', roundId: 'r-3', expectedRound: 2, attempt: 'impl-2', rev: 'b', session: 'rev-first', resolutions: [resolve()] })), 'feedback_stage_not_current');
  // Round IDs are review-wide: the API sees another stage's round ID as a conflicting replay, and a direct ledger
  // append (which bypasses the replay check) meets the staged duplicate-round rule.
  const reused = stagedRound({ stageId: 'final', roundId: 'r-2', attempt: 'impl-2', rev: 'b', session: 'rev-final' });
  reject(() => F.submit(root, reused), 'feedback_replay_conflict');
  reject(() => L.appendExecutionEvent(root, { event: C.SUBMIT, taskId: 'T-1', feedbackRound: reused }), 'feedback_duplicate_round');
  reject(() => F.submit(root, stagedRound({ stageId: 'final', roundId: 'f-1', attempt: 'impl-2', rev: 'b', session: 'rev-final', verdict: 'FAIL', findings: [issue()] })), 'feedback_issue_redefined');
  // A later stage starts at its own round 0 and may raise its own blockers in that first round.
  s = F.submit(root, stagedRound({ stageId: 'final', roundId: 'f-1', attempt: 'impl-2', rev: 'b', session: 'rev-final', verdict: 'FAIL', findings: [issue('F-1')] }));
  assert.equal(s.status, 'FAIL'); assert.equal(s.currentStageId, 'final'); assert.equal(s.issues.find(x => x.id === 'F-1').stageId, 'final');
  assert.equal(s.issues.find(x => x.id === 'I-1').status, 'resolved');
  // NO GO from the final stage goes back to the final stage only.
  reject(() => F.submit(root, stagedRound({ stageId: 'first', roundId: 'r-3', expectedRound: 2, attempt: 'impl-3', rev: 'c', session: 'rev-first', resolutions: [resolve()] })), 'feedback_stage_not_current');
  s = F.submit(root, stagedRound({ stageId: 'final', roundId: 'f-2', expectedRound: 1, attempt: 'impl-3', rev: 'c', session: 'rev-final', resolutions: [resolve('resolved', 'F-1')] }));
  assert.equal(s.status, 'PASS'); assert.equal(s.decision, 'GO'); assert.equal(s.currentStageId, null); assert.equal(s.approvalGranted, false);
  assert.deepEqual(s.stages.map(x => [x.id, x.roundCount]), [['first', 2], ['final', 2]]); assert.equal(s.roundCount, 4); assert.equal(s.nextRoundTemplate, null);
  const report = require('../lib/review-feedback-transport').summarize(s, 'en');
  assert.ok(report.includes('[GO_ROUTE] GO reached')); assert.ok(report.includes('Stages passed: 1차 검수, 최종 검수')); assert.ok(!report.includes('Next steps'));
  assert.ok(require('../lib/review-feedback-transport').summarize(s, 'ko').includes('[GO_ROUTE] GO 판정'));
  reject(() => F.submit(root, stagedRound({ stageId: 'final', roundId: 'f-3', expectedRound: 2, attempt: 'impl-3', rev: 'c', session: 'rev-final', resolutions: [resolve('resolved', 'F-1')] })), 'feedback_review_stopped');
  assert.equal(F.show(root, 'review-1').decision, 'GO');
});
test('each stage reviews in its own session, never one another stage or the implementation used', () => {
  const root = stagedFixture(), first = o => stagedRound({ stageId: 'first', roundId: 'r-1', ...o });
  reject(() => F.submit(root, first({ session: 'worker-session' })), 'feedback_session_not_independent');
  F.submit(root, first({ session: 'model-session-1' }));
  const before = bytes(root);
  reject(() => F.submit(root, first({ stageId: 'final', roundId: 'f-1', session: 'model-session-1' })), 'feedback_session_reused');
  reject(() => F.submit(root, first({ stageId: 'final', roundId: 'f-1', session: 'worker-session' })), 'feedback_session_not_independent');
  assert.deepEqual(bytes(root), before);
  // The same model is accepted for the next stage in a new session.
  const s = F.submit(root, first({ stageId: 'final', roundId: 'f-1', session: 'model-session-2' }));
  assert.equal(s.decision, 'GO'); assert.deepEqual(s.stages.map(x => x.sessions), [['model-session-1'], ['model-session-2']]);
  // Stage reviewers stay frozen per stage.
  const other = stagedFixture(staged(finalReviewer));
  F.submit(other, stagedRound({ contract: staged(finalReviewer), stageId: 'first', roundId: 'r-1', session: 'rev-1' }));
  reject(() => F.submit(other, stagedRound({ contract: staged(finalReviewer), stageId: 'final', roundId: 'f-1', session: 'rev-2', reviewer })), 'feedback_reviewer_mismatch');
});
test('a staged budget is per stage and its stop needs an owner decision, not another round', () => {
  const c = staged(); c.stages[1].maxRounds = 1; const root = stagedFixture(c);
  F.submit(root, stagedRound({ contract: c, stageId: 'first', roundId: 'r-1', session: 'rev-1' }));
  reject(() => F.submit(root, stagedRound({ contract: c, stageId: 'final', roundId: 'f-1', session: 'rev-2', verdict: 'FAIL', findings: [issue('F-1')] })), 'feedback_verdict_inconsistent');
  const s = F.submit(root, stagedRound({ contract: c, stageId: 'final', roundId: 'f-1', session: 'rev-2', verdict: 'NEEDS_DECISION', findings: [issue('F-1')] }));
  assert.equal(s.status, 'NEEDS_DECISION'); assert.equal(s.decision, 'NO GO'); assert.ok(s.stopReasons.includes('round-budget-exhausted'));
  assert.deepEqual(s.stages.map(x => [x.status, x.roundCount, x.maxRounds]), [['PASS', 1, 3], ['NEEDS_DECISION', 1, 1]]);
  assert.deepEqual(s.goRoute.steps, [{ code: 'owner-decision', reasons: ['round-budget-exhausted'] }]); assert.equal(s.nextRoundTemplate, null);
  assert.deepEqual(s.goRoute.budget, { roundsUsed: 1, maxRounds: 1, remaining: 0 });
  reject(() => F.submit(root, stagedRound({ contract: c, stageId: 'final', roundId: 'f-2', expectedRound: 1, attempt: 'impl-2', rev: 'b', session: 'rev-2', resolutions: [resolve('resolved', 'F-1')] })), 'feedback_review_stopped');
});
test('the GO route lists each blocker check with its latest status, the reviews left and ordered steps', () => {
  const two = { ...issue('I-1'), acceptanceCriteria: [{ id: 'null-id', outcome: 'null/undefined에서는 요청 0회' }, { id: 'valid-id', outcome: '정상 ID는 기존대로 요청' }] };
  const empty = { ...issue('I-2'), issue: '빈 문자열 ID도 요청됨', acceptanceCriteria: [{ id: 'empty-id', outcome: '빈 문자열에서는 요청 0회' }] };
  const root = stagedFixture();
  let s = F.submit(root, stagedRound({ stageId: 'first', roundId: 'r-1', session: 'rev-1', verdict: 'FAIL', findings: [two, empty] })), g = s.goRoute;
  assert.equal(g.decision, 'NO GO'); assert.deepEqual(g.stage, { id: 'first', label: '1차 검수', index: 1, total: 2, reviewer, status: 'FAIL' });
  assert.deepEqual(g.budget, { roundsUsed: 1, maxRounds: 3, remaining: 2 }); assert.deepEqual(g.passedStages, []);
  assert.deepEqual(g.laterStages, [{ id: 'final', label: '최종 검수', reviewer }]);
  assert.deepEqual(g.blockers.map(b => [b.id, b.requiredOutcome, b.checks.map(c => c.status)]), [['I-1', two.requiredOutcome, ['not-rechecked', 'not-rechecked']], ['I-2', empty.requiredOutcome, ['not-rechecked']]]);
  assert.deepEqual(g.criteria.map(c => [c.id, c.status]), [['user-id', 'failed']]); assert.equal(g.regression.status, 'passed');
  assert.deepEqual(g.steps.map(x => x.code), ['implement', 'record-attempt', 'request-review', 'submit-round', 'record-review']);
  assert.deepEqual(g.steps[0].issueIds, ['I-1', 'I-2']);
  const request = g.steps[2]; assert.deepEqual([request.stageId, request.expectedRound, request.remainingRounds, request.newSession, request.reuseAttempt], ['first', 1, 2, true, false]);
  const partial = { issueId: 'I-1', status: 'unresolved', evidence: ['test:null-id and valid-id rerun'], checks: [
    { criterionId: 'null-id', status: 'passed', evidence: ['0 requests for null'] }, { criterionId: 'valid-id', status: 'failed', evidence: ['normal ID sends nothing'] }] };
  const fixed = { issueId: 'I-2', status: 'resolved', evidence: ['test:empty-id rerun'], checks: [{ criterionId: 'empty-id', status: 'passed', evidence: ['0 requests for empty'] }] };
  s = F.submit(root, stagedRound({ stageId: 'first', roundId: 'r-2', expectedRound: 1, attempt: 'impl-2', rev: 'b', session: 'rev-1', verdict: 'FAIL', resolutions: [partial, fixed] })); g = s.goRoute;
  assert.equal(s.status, 'FAIL'); assert.deepEqual(g.budget, { roundsUsed: 2, maxRounds: 3, remaining: 1 });
  assert.deepEqual(g.blockers.map(b => b.id), ['I-1']);
  assert.deepEqual(g.blockers[0].checks.map(c => [c.id, c.status, c.evidence]), [['null-id', 'passed', ['0 requests for null']], ['valid-id', 'failed', ['normal ID sends nothing']]]);
  const en = require('../lib/review-feedback-transport').summarize(s, 'en');
  for (const line of ['[GO_ROUTE] What GO needs', 'Stage 1/2: 1차 검수', 'round 2/3, 1 review(s) left', '[x] null-id', '[ ] valid-id: 정상 ID는 기존대로 요청 — failed: normal ID sends nothing',
    'Change the implementation for I-1.', 'Record the implementation attempt: leerness agents record completed',
    'Request the review from codex/review-model (1차 검수, first): next round expectedRound=2, in a session not used by another stage.',
    'leerness review-feedback show review-1 --json', 'leerness agents record reviewed', 'After this stage\'s GO: 최종 검수']) assert.ok(en.includes(line), line + '\n' + en);
  assert.ok(en.indexOf('[GO_ROUTE]') < en.indexOf('[TO_GO]'));
  const ko = require('../lib/review-feedback-transport').summarize(s, 'ko');
  for (const line of ['[GO_ROUTE] GO까지 남은 일', '2단계 중 1단계: 1차 검수', '라운드 2/3, 남은 검수 1회', '구현 시도를 기록합니다',
    'codex/review-model에게 검수를 요청합니다(1차 검수, first): 다음 라운드 expectedRound=2, 다른 단계가 쓰지 않은 새 세션에서.']) assert.ok(ko.includes(line), line + '\n' + ko);
  // The single-reviewer route has no stage and never asks for a new session.
  const v1 = F.submit(fixture(), round());
  assert.equal(v1.goRoute.stage, null); assert.deepEqual(v1.goRoute.budget, { roundsUsed: 1, maxRounds: 3, remaining: 2 });
  assert.equal(v1.goRoute.steps.find(x => x.code === 'request-review').newSession, false);
  assert.ok(!Object.hasOwn(v1.nextRoundTemplate, 'stageId')); assert.equal(v1.nextRoundTemplate.schema, C.ROUND);
});
// Every placeholder must block on its own: fill all but one and the round is still rejected.
function placeholders(t, at = []) {
  if (Array.isArray(t)) return t.flatMap((x, i) => placeholders(x, [...at, i]));
  if (!t || typeof t !== 'object') return [];
  return Object.entries(t).flatMap(([k, v]) => (k === 'evidence' && Array.isArray(v) && !v.length) || (typeof v === 'string' && v.includes('<'))
    ? [[...at, k]] : placeholders(v, [...at, k]));
}
function fillTemplate(t, answers, skip) {
  const x = clone(t);
  for (const p of placeholders(t)) {
    if (p.join('.') === skip) continue;
    const key = p.at(-1), parent = p.slice(0, -1).reduce((o, k) => o[k], x), value = parent[key];
    parent[key] = key === 'evidence' ? ['observed ' + p.join('.')] : value === '<resolved|unresolved|disputed>' ? 'resolved'
      : value === '<passed|failed|unverified>' ? 'passed' : answers[key];
  }
  return x;
}
test('the next-round skeleton is rejected until every placeholder is filled, then accepted', () => {
  const cases = [
    { name: 'single', root: fixture(), first: round(), answers: { roundId: 'round-2', implementationAttemptId: 'impl-2', sourceRevision: hash('b'), verdict: 'PASS' } },
    { name: 'staged', root: stagedFixture(), first: stagedRound({ stageId: 'first', roundId: 'r-1', session: 'rev-1', verdict: 'FAIL', findings: [issue()] }),
      answers: { roundId: 'r-2', reviewerSession: 'rev-1b', implementationAttemptId: 'impl-2', sourceRevision: hash('b'), verdict: 'PASS' } },
  ];
  const decided = ['implementationAttemptId', 'sourceRevision', 'verdict', 'resolutions.0.status', 'resolutions.0.evidence', 'resolutions.0.checks.0.status',
    'resolutions.0.checks.0.evidence', 'criteriaResults.0.status', 'criteriaResults.0.evidence', 'regressionCheck.status', 'regressionCheck.evidence'];
  for (const k of cases) {
    const t = F.submit(k.root, k.first).nextRoundTemplate, before = bytes(k.root), paths = placeholders(t).map(p => p.join('.'));
    // Everything the reviewer decides stays a placeholder; a valid default here would record an undecided review.
    assert.deepEqual(paths, ['roundId', ...(k.name === 'staged' ? ['reviewerSession'] : []), ...decided], k.name);
    rejectAny(() => F.submit(k.root, t));
    for (const skip of paths) rejectAny(() => F.submit(k.root, fillTemplate(t, k.answers, skip)));
    assert.deepEqual(bytes(k.root), before, k.name + ' history changed by a rejected skeleton');
    const s = F.submit(k.root, fillTemplate(t, k.answers));
    assert.equal(k.name === 'staged' ? s.stages[0].status : s.status, 'PASS', k.name); assert.equal(s.issues[0].status, 'resolved');
  }
  // A resolved issue can only stay resolved, so its checks come prefilled as passed; its evidence is still required.
  const root = stagedFixture(), two = { ...issue('I-2'), acceptanceCriteria: [{ id: 'empty-id', outcome: '빈 문자열에서는 요청 0회' }] };
  F.submit(root, stagedRound({ stageId: 'first', roundId: 'r-1', session: 'rev-1', verdict: 'FAIL', findings: [issue(), two] }));
  const t = F.submit(root, stagedRound({ stageId: 'first', roundId: 'r-2', expectedRound: 1, attempt: 'impl-2', rev: 'b', session: 'rev-1', verdict: 'FAIL',
    resolutions: [resolve(), { ...resolve('unresolved', 'I-2'), checks: [{ criterionId: 'empty-id', status: 'failed', evidence: ['still sends'] }] }] })).nextRoundTemplate;
  assert.deepEqual(t.resolutions.map(x => [x.issueId, x.status, x.checks.map(c => c.status), x.evidence.length]),
    [['I-1', 'resolved', ['passed'], 0], ['I-2', '<resolved|unresolved|disputed>', ['<passed|failed|unverified>'], 0]]);
  assert.equal(t.implementationAttemptId.startsWith('<'), true); assert.equal(t.expectedRound, 2); assert.equal(t.stageId, 'first');
});
test('human GO route follows --language, then LEERNESS_LANG, then the project language, then Korean', () => {
  const root = fixture(); F.submit(root, round());
  const show = (extra, env) => cp.spawnSync(process.execPath, [cli, 'review-feedback', 'show', 'review-1', '--path', root, ...extra],
    { encoding: 'utf8', timeout: 30000, windowsHide: true, env: { ...process.env, LEERNESS_LANG: '', ...env } });
  const en = show(['--language', 'en']), ko = show(['--language', 'ko']);
  assert.equal(en.status, 1, en.stdout + en.stderr); assert.equal(ko.status, 1, ko.stdout + ko.stderr);
  assert.ok(en.stdout.includes('[GO_ROUTE] What GO needs')); assert.ok(en.stdout.includes('Record the implementation attempt: leerness agents record completed "<what changed>" --task T-1'));
  assert.ok(ko.stdout.includes('[GO_ROUTE] GO까지 남은 일')); assert.ok(ko.stdout.includes('구현 시도를 기록합니다: leerness agents record completed "<수정 요약>" --task T-1'));
  assert.ok(show([]).stdout.includes('[GO_ROUTE] GO까지 남은 일'), 'default');
  assert.ok(show([], { LEERNESS_LANG: 'en' }).stdout.includes('[GO_ROUTE] What GO needs'), 'environment');
  fs.writeFileSync(path.join(root, '.leerness', 'manifest.json'), JSON.stringify({ language: 'en' }));
  assert.ok(show([]).stdout.includes('[GO_ROUTE] What GO needs'), 'project language');
  // An editor-added byte-order mark must not turn the report Korean (cross-model review 2026-09-30).
  fs.writeFileSync(path.join(root, '.leerness', 'manifest.json'), Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(JSON.stringify({ language: 'en' }))]));
  assert.ok(show([]).stdout.includes('[GO_ROUTE] What GO needs'), 'project language behind a byte-order mark');
  assert.ok(show([], { LEERNESS_LANG: 'ko' }).stdout.includes('[GO_ROUTE] GO까지 남은 일'), 'environment before project');
  assert.ok(show(['--language', 'ko'], { LEERNESS_LANG: 'en' }).stdout.includes('[GO_ROUTE] GO까지 남은 일'), 'flag first');
  for (const bad of [['--language', 'fr'], ['--language'], ['--language', 'en', '--language', 'ko']]) {
    const r = show(bad); assert.equal(r.status, 2, bad.join(' ')); assert.ok(r.stdout.includes('feedback_cli_arguments'), r.stdout);
  }
  assert.ok(JSON.parse(show(['--json', '--language', 'en']).stdout).result.goRoute.steps.length > 0);
});
// The printed GO route: the commands a reviewer copies, with only their <placeholders> filled.
const ROUTE_WORDS = {
  en: { record: 'agents record completed', submit: 'review-feedback submit', review: 'agents record reviewed',
    attempt: { 'what changed': 'guard the missing id', 'attempt id': 'impl-3', provider: 'claude', model: 'worker-model', 'changed files or test output': 'test:no-id' },
    file: 'round file', reviewed: { summary: 'the id guard holds', 'review id': 'review-run-2', 'attempt id': 'impl-3', provider: 'codex', model: 'review-model', 'review notes': 'test:no-id rerun', 'round id': 'round-2' } },
  ko: { record: 'agents record completed', submit: 'review-feedback submit', review: 'agents record reviewed',
    attempt: { '수정 요약': 'ID 누락 방지', '시도 ID': 'impl-3', '제공자': 'claude', '모델': 'worker-model', '수정 파일 또는 테스트 결과': 'test:no-id' },
    file: '라운드 파일', reviewed: { '요약': 'ID 방지 확인', '검수 ID': 'review-run-2', '시도 ID': 'impl-3', '제공자': 'codex', '모델': 'review-model', '검수 메모': 'test:no-id rerun', '라운드 ID': 'round-2' } },
};
const routeEnv = { ...process.env, LEERNESS_LANG: '' };
const printed = (text, needle) => { const line = text.split('\n').find(l => l.includes(needle)); assert.ok(line, needle + '\n' + text); return line.slice(line.indexOf('leerness ')); };
const fill = (cmd, values) => cmd.replace(/<([^<>]+)>/g, (m, key) => { assert.ok(key in values, 'unfilled ' + m + ' in ' + cmd); return values[key]; });
// A project after a failing first round: its human report (with the printed route) and the filled second round.
function routeProject(lang) {
  const root = fixture(); F.submit(root, round());
  const show = json => cp.spawnSync(process.execPath, [cli, 'review-feedback', 'show', 'review-1', '--path', root, '--language', lang, ...(json ? ['--json'] : [])],
    { encoding: 'utf8', timeout: 30000, windowsHide: true, env: routeEnv }).stdout;
  const t = JSON.parse(show(true)).result.nextRoundTemplate, pass = { status: 'passed', evidence: ['test:no-id rerun'] };
  const filled = { ...t, roundId: 'round-2', implementationAttemptId: 'impl-3', sourceRevision: hash('c'), verdict: 'PASS',
    resolutions: t.resolutions.map(x => ({ ...x, status: 'resolved', evidence: ['test:no-id rerun'], checks: x.checks.map(c => ({ ...c, ...pass })) })),
    criteriaResults: t.criteriaResults.map(c => ({ ...c, ...pass })), regressionCheck: { ...pass } };
  const roundFile = path.join(root, 'round 파일 2.json'); fs.writeFileSync(roundFile, JSON.stringify(filled));
  return { root, text: show(false), roundFile, w: ROUTE_WORDS[lang] };
}
test('the printed GO route runs as printed in both languages: record the attempt, submit the round, record the review, reach GO', () => {
  // Cross-model review 2026-09-30: round 1 found missing flags and no submit step; round 2 found the "< file"
  // redirection PowerShell cannot run, and a test that removed it. The route now uses --file; each printed command is
  // run with only its <placeholders> filled (a round file path with a space and Korean), and contains no shell operator.
  const argv = cmd => (cmd.match(/"[^"]*"|\S+/g) || []).map(a => a.replace(/^"|"$/g, ''));
  for (const lang of ['en', 'ko']) {
    const { root, text, roundFile, w } = routeProject(lang);
    const exec = cmd => {
      assert.ok(!/[<>|&;]/.test(cmd.replace(/"[^"]*"/g, '')), lang + ': a shell operator in ' + cmd);
      const r = cp.spawnSync(process.execPath, [cli, ...argv(cmd).slice(1), '--path', root], { encoding: 'utf8', timeout: 30000, windowsHide: true, env: routeEnv });
      return { code: r.status, out: String(r.stdout) + String(r.stderr) };
    };
    const r1 = exec(fill(printed(text, w.record), w.attempt)); assert.equal(r1.code, 0, lang + ' record\n' + r1.out);
    const r2 = exec(fill(printed(text, w.submit), { [w.file]: '"' + roundFile + '"' })); assert.equal(r2.code, 0, lang + ' submit\n' + r2.out);
    const r3 = exec(fill(printed(text, w.review), w.reviewed)); assert.equal(r3.code, 0, lang + ' review\n' + r3.out);
    assert.equal(F.show(root, 'review-1').status, 'PASS', lang);
  }
});
// Round 3 asked for the route in an actual PowerShell rather than an argument split: the three printed commands, with
// only their placeholders filled (the round file as a PowerShell literal), run as one script; `leerness` is a function
// that runs this CLI, as the npm shim does.
const POWERSHELL = (() => {
  for (const exe of ['pwsh', ...(process.platform === 'win32' ? ['powershell'] : [])]) {
    const r = cp.spawnSync(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 7'], { windowsHide: true, timeout: 60000, env: routeEnv });
    if (r.status === 7) return exe;
  }
  return '';
})();
if (!POWERSHELL) console.log('SKIP the printed GO route in an actual PowerShell (no pwsh or powershell found)');
else test('the printed GO route runs in an actual PowerShell (' + POWERSHELL + ') with a round file named "round 파일 2.json"', () => {
  const literal = s => "'" + String(s).replace(/'/g, "''") + "'";
  for (const lang of ['en', 'ko']) {
    const { root, text, roundFile, w } = routeProject(lang);
    const script = path.join(root, 'route ' + lang + '.ps1');
    const lines = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      'function leerness { & ' + literal(process.execPath) + ' ' + literal(cli) + ' @args; if ($LASTEXITCODE) { Write-Output ("FAILED exit " + $LASTEXITCODE); exit $LASTEXITCODE } }',
      fill(printed(text, w.record), w.attempt) + ' --path ' + literal(root),
      fill(printed(text, w.submit), { [w.file]: literal(roundFile) }) + ' --path ' + literal(root),
      fill(printed(text, w.review), w.reviewed) + ' --path ' + literal(root),
    ];
    fs.writeFileSync(script, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(lines.join('\r\n') + '\r\n')]));
    const r = cp.spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', ...(process.platform === 'win32' ? ['-ExecutionPolicy', 'Bypass'] : []), '-File', script],
      { encoding: 'utf8', timeout: 180000, windowsHide: true, env: routeEnv });
    assert.ifError(r.error);
    assert.equal(r.status, 0, lang + '\n' + lines.slice(2).join('\n') + '\n' + r.stdout + r.stderr);
    assert.equal(F.show(root, 'review-1').status, 'PASS', lang);
  }
});
test('a Korean human report localizes its prose but keeps markers, enum values and the English JSON', () => {
  const { summarize } = require('../lib/review-feedback-transport');
  const english = ['Worker chooses the implementation', 'Use the frozen scope and criteria', 'Review criteria are satisfied as declared', 'Stop automatic revisions',
    'Resolve the referenced original outcomes', 'No unresolved blockers', 'No correction blocker is recorded', 'required:', 'evidence:', 'check the existing behavior',
    'Optional:', 'Evidence:', 'caller-declared', 'No deployment or release approval', 'Report the remaining blockers', 'Round '];
  const noEnglish = (text, name) => { for (const phrase of english) assert.ok(!text.includes(phrase), name + ': ' + phrase + '\n' + text); };
  const open = F.show(fixture(), 'review-1'), openKo = summarize(open, 'ko');
  for (const line of ['라운드 0/3', '첫 검수는 고정된 범위와 기준으로 진행합니다.', '- 기록된 수정 차단 지적이 없습니다.', '[REGRESSION_CHECK] not-reviewed; 기존 동작을 확인하고 근거를 제출합니다.',
    '- user-id: not-reviewed; 필수: ', '호출자가 선언한 내용이며', '배포·릴리스 승인은 부여되지 않았습니다.']) assert.ok(openKo.includes(line), line + '\n' + openKo);
  noEnglish(openKo, 'open');
  const c = contract(); c.maxRounds = 1; const root = fixture(c), r = round(c); r.verdict = 'NEEDS_DECISION';
  r.findings[0].mandatoryConstraint = { reason: 'security', requirement: '토큰을 로그에 남기지 않는다', evidence: ['보안 기준 4.2'] };
  const stopped = F.submit(root, r), ko = summarize(stopped, 'ko');
  for (const line of ['[VERDICT] NEEDS_DECISION', '[DECISION] NO GO', '라운드 1/1', '자동 수정을 멈춥니다.', '[TO_GO]', '멈춘 검수는 라운드를 더 받을 수 없으며', '[ISSUE] I-1',
    '[MANDATORY_CONSTRAINT] 토큰을 로그에 남기지 않는다 (security)', '근거: 보안 기준 4.2', '[IMPLEMENTATION_HINT] 선택: ', '[FIXED_CRITERIA]', '- user-id: failed; 필수: ',
    '[DECISION_REQUIRED]', '- round-budget-exhausted: 남은 차단 지적을 보고하고', '  - round-budget-exhausted: 남은 차단 지적을 보고하고']) assert.ok(ko.includes(line), line + '\n' + ko);
  noEnglish(ko, 'stopped');
  const doneRoot = fixture(); F.submit(doneRoot, round()); const done = F.submit(doneRoot, second()), doneKo = summarize(done, 'ko');
  assert.ok(doneKo.includes('- 남은 차단 지적이 없고, 선언된 대로 검수 기준을 통과했습니다.')); assert.ok(doneKo.includes('선언된 대로 검수 기준을 충족했습니다.'));
  noEnglish(doneKo, 'pass');
  // JSON stays the English machine text.
  assert.ok(stopped.nextAction.startsWith('Stop automatic revisions')); assert.ok(stopped.goRequirements.notice.startsWith('Resolve the referenced'));
  assert.ok(stopped.goRequirements.decisions[0].requiredAction.startsWith('Report the remaining blockers'));
  assert.ok(stopped.goRoute.decisions[0].requiredAction.startsWith('Report the remaining blockers'));
});
test('terminal review record binds the latest round of its own stage in a staged review', () => {
  const c = staged(finalReviewer), root = stagedFixture(c);
  F.submit(root, stagedRound({ contract: c, stageId: 'first', roundId: 'r-1', session: 'rev-1', verdict: 'FAIL', findings: [issue()] }));
  F.submit(root, stagedRound({ contract: c, stageId: 'first', roundId: 'r-2', expectedRound: 1, attempt: 'impl-2', rev: 'b', session: 'rev-1', resolutions: [resolve()] }));
  F.submit(root, stagedRound({ contract: c, stageId: 'final', roundId: 'f-1', attempt: 'impl-2', rev: 'b', session: 'rev-2' }));
  const record = (id, roundId, target, who) => cp.spawnSync(process.execPath, [cli, 'agents', 'record', 'reviewed', 'Staged review recorded', '--path', root,
    '--task', 'T-1', '--id', id, '--target', target, '--provider', who.provider, '--model', who.model, '--evidence', 'review:' + roundId,
    '--feedback-round', roundId, '--json'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  const before = bytes(root);
  for (const [id, roundId, target, who] of [['stale', 'r-1', 'impl-1', reviewer], ['wrong-reviewer', 'r-2', 'impl-2', finalReviewer],
    ['wrong-target', 'r-2', 'impl-1', reviewer], ['unknown', 'r-9', 'impl-2', reviewer]]) {
    const r = record(id, roundId, target, who); assert.notEqual(r.status, 0, id); assert.ok(r.stdout.includes('feedback_result_required'), id + ': ' + r.stdout + r.stderr);
  }
  assert.deepEqual(bytes(root), before);
  const first = record('review-first', 'r-2', 'impl-2', reviewer); assert.equal(first.status, 0, first.stdout + first.stderr);
  const last = record('review-final', 'f-1', 'impl-2', finalReviewer); assert.equal(last.status, 0, last.stdout + last.stderr);
  assert.equal(JSON.parse(last.stdout).event.review.feedbackRoundId, 'f-1');
});
test('reviewer guidance names staged sessions and the numbered route to GO in both languages', () => {
  const g = require('../lib/review-feedback-guidance');
  for (const term of ['first and a final reviewer', 'only the stage that gave NO GO re-reviews', 'new session (reviewerSession)', 'same model may serve several stages',
    'numbered checklist in fix order', 'how to reproduce', 'how it will be verified', 'the reviews left']) assert.ok(g.REVIEW_GUIDANCE.includes(term), term);
  for (const term of ['1차·최종 검수', 'NO GO를 낸 단계만 재검수', '새 세션(reviewerSession)', '같은 모델이 여러 단계를', '번호를 매긴 체크리스트', '재현 방법', '확인 방법', '남은 검수 횟수']) {
    assert.ok(g.projectGuidance('ko').includes(term), term);
  }
});
console.log(`${passed}/${passed + failed} passed`); process.exitCode = failed ? 1 : 0;
