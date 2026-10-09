'use strict';

// Derived presentation of a validated feedback state. References point to the
// original frozen findings/criteria; no new criteria, transition or approval.
const C = require('./review-feedback-contract');
const DECISION_ACTIONS = {
  'verification-incomplete': 'Provide the missing verification and its actual evidence. Do not invent a code change when the problem is an unrun check.',
  'new-risk-needs-decision': 'Ask the owner to decide the newly found serious risk and its scope before any separately authorized continuation.',
  'disputed-issue': 'Ask the owner to resolve the disputed finding against the frozen criteria and cited evidence.',
  'round-budget-exhausted': 'Report the remaining blockers and ask the owner for a next-step decision. Do not start a new review ID to reset the budget.',
  'unchanged-source': 'Explain why the reviewed source is unchanged and request a next-step decision instead of repeating the same review.',
  'no-resolved-blocker': 'Explain why the last revision resolved no blocker and request a next-step decision instead of repeating automatic revisions.',
};
// T-0316: human output follows the project language; JSON keeps the English text above as its contract.
const DECISION_ACTIONS_KO = {
  'verification-incomplete': '빠진 검증을 실제로 실행하고 그 근거를 제출합니다. 실행하지 않은 검사가 문제라면 코드 수정을 지어내지 않습니다.',
  'new-risk-needs-decision': '새로 발견된 중대 위험과 그 범위를 소유자가 결정하게 하고, 별도로 승인된 경우에만 이어갑니다.',
  'disputed-issue': '이견이 있는 지적을 고정 기준과 인용된 근거에 비추어 소유자가 판단하게 합니다.',
  'round-budget-exhausted': '남은 차단 지적을 보고하고 다음 단계를 소유자에게 결정받습니다. 횟수를 초기화하려고 새 검수 ID를 만들지 않습니다.',
  'unchanged-source': '검수한 소스가 바뀌지 않은 이유를 설명하고, 같은 검수를 반복하는 대신 다음 단계를 결정받습니다.',
  'no-resolved-blocker': '지난 수정에서 해결된 차단 지적이 없는 이유를 설명하고, 자동 수정을 반복하는 대신 다음 단계를 결정받습니다.',
};
const NEXT_ACTIONS = {
  en: {
    PASS: 'Review criteria are satisfied as declared; continue existing verification and approval gates.',
    NEEDS_DECISION: 'Stop automatic revisions. Resolve the listed missing verification, disputes, risks or lack of progress before deciding the next action; do not restart this review to reset its budget.',
    FAIL: 'Worker chooses the implementation. Address open issue outcomes and supply evidence for the frozen criteria.',
    nextStage: 'The previous stage passed; the next stage reviews the same frozen scope and criteria in a new session.',
    first: 'Use the frozen scope and criteria for the first review.',
  },
  ko: {
    PASS: '선언된 대로 검수 기준을 충족했습니다. 기존 검증과 승인 절차는 그대로 진행합니다.',
    NEEDS_DECISION: '자동 수정을 멈춥니다. 다음 행동을 정하기 전에 나열된 누락 검증·이견·위험·진척 없음을 해결하고, 횟수를 초기화하려고 이 검수를 다시 시작하지 않습니다.',
    FAIL: '구현 방법은 작업자가 정합니다. 열린 지적의 요구 결과를 해결하고 고정 기준의 근거를 제출합니다.',
    nextStage: '앞 단계가 통과했습니다. 다음 단계가 같은 고정 범위와 기준을 새 세션에서 검수합니다.',
    first: '첫 검수는 고정된 범위와 기준으로 진행합니다.',
  },
};
function nextAction(state, lang = 'en') {
  const n = NEXT_ACTIONS[lang === 'ko' ? 'ko' : 'en'];
  return n[state.status] || (state.stages && state.stages.some(s => s.status === 'PASS') ? n.nextStage : n.first);
}
// T-0316: a staged review is judged by its current stage's latest round (the first stage not yet passed).
function latestRound(state) {
  if (!state.stages || !state.currentStageId) return state.rounds.at(-1);
  return state.rounds.filter(r => r.stageId === state.currentStageId).at(-1);
}
function currentStage(state) {
  return state.stages ? state.stages.find(s => s.id === state.currentStageId) || null : null;
}
function requirements(state) {
  const latest = latestRound(state);
  return {
    issueIds: state.issues.filter(f => ['blocking', 'regression'].includes(f.classification) && f.status !== 'resolved').map(f => f.id),
    criterionIds: state.contract.criteria.filter(c => !latest || latest.criteriaResults.find(x => x.criterionId === c.id)?.status !== 'passed').map(c => c.id),
    regressionCheckRequired: !latest || latest.regressionCheck.status !== 'passed',
    decisionIssueIds: state.issues.filter(f => f.classification === 'risk-escalation' || f.status === 'disputed').map(f => f.id),
    decisions: state.stopReasons.map(code => ({ code, requiredAction: DECISION_ACTIONS[code] || 'Ask the owner to resolve this stop reason before proceeding.' })),
    reReviewRequired: state.status !== 'PASS',
    automaticRevisionAllowed: state.status === 'FAIL',
    notice: 'Resolve the referenced original outcomes and verify their fixed acceptance criteria with evidence for re-review. This is not a promise of GO or release approval. A stopped review cannot accept more rounds; any further work needs an explicit owner decision without erasing the prior scope or budget.',
  };
}
function decision(status) { return status === 'PASS' ? 'GO' : ['FAIL', 'NEEDS_DECISION'].includes(status) ? 'NO GO' : 'NOT_REVIEWED'; }

// T-0316: the ordered route to GO. Every item is copied from the frozen contract, the stored findings and the
// latest recorded checks; nothing here is a new criterion, and following it is not a promise of GO.
function route(state) {
  const staged = !!state.stages, stage = currentStage(state), latest = latestRound(state);
  const index = stage ? state.stages.indexOf(stage) : -1;
  // After every stage passed there is no current stage; show the last one that reviewed.
  const shown = stage || (staged ? state.stages[state.stages.length - 1] : null);
  const reviewer = shown ? shown.reviewer : state.contract.reviewer;
  const maxRounds = shown ? shown.maxRounds : state.contract.maxRounds;
  const used = shown ? shown.roundCount : state.rounds.length;
  const recheck = (issueId, criterionId) => {
    const c = latest?.resolutions.find(x => x.issueId === issueId)?.checks.find(x => x.criterionId === criterionId);
    return c ? { status: c.status, evidence: c.evidence } : { status: 'not-rechecked', evidence: [] };
  };
  const blockers = state.issues.filter(f => ['blocking', 'regression'].includes(f.classification) && f.status !== 'resolved').map(f => ({
    id: f.id, severity: f.severity, classification: f.classification, status: f.status, stageId: f.stageId || null,
    issue: f.issue, evidence: f.evidence, whyItFails: f.whyItFails, requiredOutcome: f.requiredOutcome,
    checks: f.acceptanceCriteria.map(c => ({ id: c.id, outcome: c.outcome, ...recheck(f.id, c.id) })),
    mandatoryConstraint: f.mandatoryConstraint || null, implementationHint: f.implementationHint || null,
  }));
  const criteria = state.contract.criteria.map(c => {
    const r = latest?.criteriaResults.find(x => x.criterionId === c.id);
    return { id: c.id, outcome: c.outcome, status: r ? r.status : 'not-reviewed', evidence: r ? r.evidence : [] };
  });
  const regression = latest ? { status: latest.regressionCheck.status, evidence: latest.regressionCheck.evidence }
    : { status: 'not-reviewed', evidence: [] };
  const steps = [];
  if (state.status === 'PASS') steps.push({ code: 'go' });
  else if (state.status === 'NEEDS_DECISION') steps.push({ code: 'owner-decision', reasons: [...state.stopReasons] });
  else {
    const changesNeeded = state.status === 'FAIL';
    if (changesNeeded) steps.push({ code: 'implement', issueIds: blockers.map(b => b.id) });
    if (changesNeeded || !state.rounds.length) steps.push({ code: 'record-attempt', taskId: state.contract.taskId });
    steps.push({ code: 'request-review', stageId: stage ? stage.id : null, stageLabel: stage ? stage.label : null, reviewer, expectedRound: used,
      remainingRounds: maxRounds - used, newSession: staged, reuseAttempt: !changesNeeded && state.rounds.length > 0 });
    // The round is submitted before the review is recorded: a terminal review binds to a submitted round
    // (cross-model review 2026-09-30: the route skipped this step, so following it could not reach GO).
    steps.push({ code: 'submit-round', reviewId: state.contract.reviewId });
    steps.push({ code: 'record-review', taskId: state.contract.taskId });
  }
  return {
    decision: decision(state.status), status: state.status,
    stage: stage ? { id: stage.id, label: stage.label, index: index + 1, total: state.stages.length, reviewer: stage.reviewer, status: stage.status } : null,
    passedStages: staged ? state.stages.filter(s => s.status === 'PASS').map(s => ({ id: s.id, label: s.label })) : [],
    laterStages: staged && index >= 0 ? state.stages.slice(index + 1).map(s => ({ id: s.id, label: s.label, reviewer: s.reviewer })) : [],
    reviewer, budget: { roundsUsed: used, maxRounds, remaining: maxRounds - used },
    blockers, criteria, regression,
    decisions: requirements(state).decisions,
    steps,
  };
}
// Placeholders are chosen to fail validation (`<…>` is no valid ID, hash or status, and evidence lists are empty),
// so an unfilled skeleton is rejected instead of being recorded as a review.
function nextRoundTemplate(state) {
  if (!['open', 'FAIL'].includes(state.status)) return null;
  const c = state.contract, stage = currentStage(state), staged = !!state.stages;
  const blockers = state.issues.filter(f => ['blocking', 'regression'].includes(f.classification) && (!staged || f.stageId === stage.id));
  const lastRound = state.rounds.at(-1);
  const status = '<passed|failed|unverified>';
  return {
    schema: staged ? C.ROUND_V2 : C.ROUND,
    reviewId: c.reviewId,
    roundId: '<new round id>',
    expectedRound: stage ? stage.roundCount : state.rounds.length,
    contractDigest: C.digest(c),
    ...(staged ? { stageId: stage.id, reviewerSession: '<reviewer session id, not used by another stage>' } : {}),
    reviewer: stage ? stage.reviewer : c.reviewer,
    implementationAttemptId: state.status === 'open' && lastRound ? lastRound.implementationAttemptId : '<attempt id recorded with agents record completed --id>',
    sourceRevision: 'sha256:<digest of the reviewed source>',
    verdict: '<PASS|FAIL|NEEDS_DECISION>',
    findings: [],
    // A resolved issue cannot be reopened and needs all checks passed, so only its evidence is left to fill.
    resolutions: blockers.map(f => ({ issueId: f.id, status: f.status === 'resolved' ? 'resolved' : '<resolved|unresolved|disputed>', evidence: [],
      checks: f.acceptanceCriteria.map(x => ({ criterionId: x.id, status: f.status === 'resolved' ? 'passed' : status, evidence: [] })) })),
    criteriaResults: c.criteria.map(x => ({ criterionId: x.id, status, evidence: [] })),
    regressionCheck: { status, evidence: [] },
  };
}

const koAction = d => DECISION_ACTIONS_KO[d.code] || '진행하기 전에 이 중단 사유를 소유자가 해결하게 합니다.';
const T = {
  en: {
    title: 'What GO needs', titleGo: 'GO reached', stage: (s) => `Stage ${s.index}/${s.total}: ${s.label}`, reviewer: 'reviewer', round: (b) => `round ${b.roundsUsed}/${b.maxRounds}, ${b.remaining} review(s) left`,
    passed: 'Stages passed', none: 'none',
    go: '- GO: every fixed criterion and the regression check passed with no open blocker. This is not deployment or release approval; existing verification and approval gates still apply.',
    stagePassed: (p, s) => `- ${p} GO. Next: ${s.label} reviews in a new session.`,
    stopped: '- Automatic revision stopped. An owner decision is required before any further round:',
    blockersHead: 'Fix the blockers. The worker chooses how; the required outcomes and checks below do not change.',
    requiredOutcome: 'required outcome', constraint: 'mandatory constraint', hint: 'optional hint',
    criteriaHead: 'Fixed criteria: all must be passed at re-review.',
    regressionHead: (r) => `Regression check: submit evidence again that existing behavior is kept (last: ${r}).`,
    status: { passed: 'passed', failed: 'failed', unverified: 'unverified', 'not-rechecked': 'not rechecked yet', 'not-reviewed': 'not reviewed yet' },
    nextHead: 'Next steps',
    implement: (ids) => `Change the implementation for ${ids.join(', ')}.`,
    record: (t) => `Record the implementation attempt: leerness agents record completed "<what changed>" --task ${t} --id <attempt id> --provider <provider> --model <model> --evidence <changed files or test output>`,
    request: (s) => `Request the review from ${s.reviewer.provider}/${s.reviewer.model}${s.stageLabel ? ` (${s.stageLabel}, ${s.stageId})` : ''}: next round expectedRound=${s.expectedRound}`
      + `${s.newSession ? ', in a session not used by another stage' : ''}${s.reuseAttempt ? ', on the attempt already reviewed' : ''}.`,
    covers: (ids, cr) => `The round covers blockers ${ids.length ? ids.join(', ') : '(none)'}, criteria ${cr.join(', ')} and the regression check.`,
    template: (id) => `Round skeleton: result.nextRoundTemplate of \`leerness review-feedback show ${id} --json\` (rejected until its <…> placeholders and empty evidence are filled).`,
    submit: () => 'The reviewer submits the filled round: leerness review-feedback submit --file <round file>',
    recordReview: (t) => `The reviewer records the review: leerness agents record reviewed "<summary>" --task ${t} --id <review id> --target <attempt id> --provider <provider> --model <model> --evidence <review notes> --feedback-round <round id>`,
    later: (s) => `After this stage's GO: ${s.label} by ${s.reviewer.provider}/${s.reviewer.model}, in a new session.`,
    decisionLine: (d) => `  - ${d.code}: ${d.requiredAction}`,
    // The remaining report sections keep the wording they had before the route existed.
    roundLine: (s) => s.stages ? `Round ${s.roundCount} (${s.stages.map(x => `${x.id} ${x.roundCount}/${x.maxRounds}`).join(', ')})` : `Round ${s.roundCount}/${s.contract.maxRounds}`,
    notice: (todo) => todo.notice,
    noBlockersPass: '- No unresolved blockers; review criteria passed as declared.',
    noBlockersOpen: '- No correction blocker is recorded. Complete the checks or owner decisions below; this is not GO.',
    fixedLine: (c, check) => `- ${c.id}: ${check ? check.status : 'not-reviewed'}; required: ${c.outcome}` + (check ? `; evidence: ${check.evidence.join('; ')}` : ''),
    regressionNone: '[REGRESSION_CHECK] not-reviewed; check the existing behavior and provide evidence.',
    decisionRequired: (d) => `- ${d.code}: ${d.requiredAction}`,
    optional: 'Optional: ', constraintEvidence: 'Evidence: ',
    trust: (s) => s.trust, noApproval: 'No deployment or release approval was granted.',
  },
  ko: {
    title: 'GO까지 남은 일', titleGo: 'GO 판정', stage: (s) => `${s.total}단계 중 ${s.index}단계: ${s.label}`, reviewer: '검수자', round: (b) => `라운드 ${b.roundsUsed}/${b.maxRounds}, 남은 검수 ${b.remaining}회`,
    passed: '통과한 단계', none: '없음',
    go: '- GO: 모든 고정 기준과 회귀 확인이 통과했고 남은 차단 지적이 없습니다. 배포·릴리스 승인은 아니며 기존 검증·승인 절차는 그대로 적용됩니다.',
    stagePassed: (p, s) => `- ${p} GO. 다음: ${s.label}을(를) 새 세션에서 검수합니다.`,
    stopped: '- 자동 수정이 멈췄습니다. 다음 라운드 전에 소유자 결정이 필요합니다:',
    blockersHead: '차단 지적을 해결합니다. 방법은 작업자가 정하고, 아래 요구 결과와 통과 조건은 바뀌지 않습니다.',
    requiredOutcome: '요구 결과', constraint: '필수 제약', hint: '선택 힌트',
    criteriaHead: '고정 기준: 재검수에서 모두 passed여야 합니다.',
    regressionHead: (r) => `회귀 확인: 기존 동작이 유지된다는 증거를 다시 제출합니다(지난 결과: ${r}).`,
    status: { passed: 'passed', failed: 'failed', unverified: '미검증', 'not-rechecked': '아직 재검수 전', 'not-reviewed': '아직 검수 전' },
    nextHead: '다음 순서',
    implement: (ids) => `${ids.join(', ')}에 대해 구현을 수정합니다.`,
    record: (t) => `구현 시도를 기록합니다: leerness agents record completed "<수정 요약>" --task ${t} --id <시도 ID> --provider <제공자> --model <모델> --evidence <수정 파일 또는 테스트 결과>`,
    request: (s) => `${s.reviewer.provider}/${s.reviewer.model}에게 검수를 요청합니다${s.stageLabel ? `(${s.stageLabel}, ${s.stageId})` : ''}: 다음 라운드 expectedRound=${s.expectedRound}`
      + `${s.newSession ? ', 다른 단계가 쓰지 않은 새 세션에서' : ''}${s.reuseAttempt ? ', 앞 단계가 검수한 시도 그대로' : ''}.`,
    covers: (ids, cr) => `라운드에 담을 것: 차단 지적 ${ids.length ? ids.join(', ') : '(없음)'}, 기준 ${cr.join(', ')}, 회귀 확인.`,
    template: (id) => `라운드 뼈대: \`leerness review-feedback show ${id} --json\`의 result.nextRoundTemplate (<…> 자리와 빈 근거를 채우기 전에는 거부됩니다).`,
    submit: () => '검수자는 채운 라운드를 제출합니다: leerness review-feedback submit --file <라운드 파일>',
    recordReview: (t) => `검수자는 결과를 기록합니다: leerness agents record reviewed "<요약>" --task ${t} --id <검수 ID> --target <시도 ID> --provider <제공자> --model <모델> --evidence <검수 메모> --feedback-round <라운드 ID>`,
    later: (s) => `이 단계 GO 후: ${s.label} — ${s.reviewer.provider}/${s.reviewer.model}, 새 세션에서.`,
    decisionLine: (d) => `  - ${d.code}: ${koAction(d)}`,
    roundLine: (s) => s.stages ? `라운드 ${s.roundCount} (${s.stages.map(x => `${x.id} ${x.roundCount}/${x.maxRounds}`).join(', ')})` : `라운드 ${s.roundCount}/${s.contract.maxRounds}`,
    notice: () => '재검수를 위해 참조된 원래 요구 결과를 해결하고, 고정된 통과 조건을 근거와 함께 확인합니다. GO나 릴리스 승인을 약속하지 않습니다. 멈춘 검수는 라운드를 더 받을 수 없으며, 이후 작업에는 이전 범위와 횟수를 지우지 않는 소유자의 명시적 결정이 필요합니다.',
    noBlockersPass: '- 남은 차단 지적이 없고, 선언된 대로 검수 기준을 통과했습니다.',
    noBlockersOpen: '- 기록된 수정 차단 지적이 없습니다. 아래 검사나 소유자 결정을 마치세요. GO가 아닙니다.',
    fixedLine: (c, check) => `- ${c.id}: ${check ? check.status : 'not-reviewed'}; 필수: ${c.outcome}` + (check ? `; 근거: ${check.evidence.join('; ')}` : ''),
    regressionNone: '[REGRESSION_CHECK] not-reviewed; 기존 동작을 확인하고 근거를 제출합니다.',
    decisionRequired: (d) => `- ${d.code}: ${koAction(d)}`,
    optional: '선택: ', constraintEvidence: '근거: ',
    trust: () => '호출자가 선언한 내용이며, 근거와 검수자 신원은 인증되지 않았습니다.', noApproval: '배포·릴리스 승인은 부여되지 않았습니다.',
  },
};
function renderRoute(s, lang) {
  const t = T[lang === 'ko' ? 'ko' : 'en'], g = route(s), lines = [`\n[GO_ROUTE] ${g.status === 'PASS' ? t.titleGo : t.title}`];
  const head = [g.stage ? t.stage(g.stage) : null, `${t.reviewer} ${g.reviewer.provider}/${g.reviewer.model}`, t.round(g.budget)].filter(Boolean).join(' · ');
  lines.push('- ' + head);
  if (s.stages) lines.push(`- ${t.passed}: ${g.passedStages.length ? g.passedStages.map(x => x.label).join(', ') : t.none}`);
  if (g.status === 'PASS') { lines.push(t.go); return lines; }
  if (g.status === 'NEEDS_DECISION') lines.push(t.stopped, ...g.decisions.map(t.decisionLine));
  else if (g.status === 'open' && g.passedStages.length && g.stage) lines.push(t.stagePassed(g.passedStages.map(x => x.label).join(', '), g.stage));
  const mark = st => st === 'passed' ? '[x]' : '[ ]';
  let n = 0;
  if (g.blockers.length) {
    lines.push(`${++n}) ${t.blockersHead}`);
    for (const b of g.blockers) {
      lines.push(`   ${b.id} (${b.severity}${b.stageId ? ', ' + b.stageId : ''}) ${t.requiredOutcome}: ${b.requiredOutcome}`,
        ...b.checks.map(c => `      ${mark(c.status)} ${c.id}: ${c.outcome} — ${t.status[c.status] || c.status}${c.evidence.length ? ': ' + c.evidence.join('; ') : ''}`));
      if (b.mandatoryConstraint) lines.push(`      ${t.constraint}: ${b.mandatoryConstraint.requirement} (${b.mandatoryConstraint.reason})`);
      if (b.implementationHint) lines.push(`      ${t.hint}: ${b.implementationHint}`);
    }
  }
  lines.push(`${++n}) ${t.criteriaHead}`,
    ...g.criteria.map(c => `      ${mark(c.status)} ${c.id}: ${c.outcome} — ${t.status[c.status] || c.status}${c.evidence.length ? ': ' + c.evidence.join('; ') : ''}`));
  lines.push(`${++n}) ${t.regressionHead(t.status[g.regression.status] || g.regression.status)}`);
  if (g.status === 'NEEDS_DECISION') return lines;
  lines.push(`${++n}) ${t.nextHead}`);
  let k = 0; const step = text => lines.push(`   ${String.fromCharCode(97 + k++)}. ${text}`);
  for (const st of g.steps) {
    if (st.code === 'implement') step(t.implement(st.issueIds));
    else if (st.code === 'record-attempt') step(t.record(st.taskId));
    else if (st.code === 'request-review') {
      step(t.request(st));
      lines.push(`      ${t.covers(g.blockers.map(b => b.id), g.criteria.map(c => c.id))}`, `      ${t.template(s.contract.reviewId)}`);
    } else if (st.code === 'submit-round') step(t.submit());
    else if (st.code === 'record-review') step(t.recordReview(st.taskId));
  }
  for (const later of g.laterStages) step(t.later(later));
  return lines;
}

// Markers ([VERDICT], [ISSUE], …) and enum values stay fixed in every language; only the prose is localized.
function summarize(s, lang = 'en') {
  const t = T[lang === 'ko' ? 'ko' : 'en'], todo = requirements(s), latest = latestRound(s);
  const lines = [`[VERDICT] ${s.status}`, `[DECISION] ${decision(s.status)}`, t.roundLine(s), nextAction(s, lang),
    `[SCOPE] ${s.contract.scope}`, `[REVIEWER] ${s.stages ? s.stages.map(x => `${x.id}=${x.reviewer.provider}/${x.reviewer.model}`).join(', ') : `${s.contract.reviewer.provider}/${s.contract.reviewer.model}`}`,
    ...renderRoute(s, lang), '\n[TO_GO]', t.notice(todo)];
  const renderIssue = f => {
    lines.push(`\n[ISSUE] ${f.id} (${f.severity}, ${f.classification}, ${f.status}) ${f.issue}`,
      `[EVIDENCE] ${f.evidence.join('; ')}`, `[WHY_IT_FAILS] ${f.whyItFails}`,
      `[REQUIRED_OUTCOME] ${f.requiredOutcome}`, '[ACCEPTANCE_CRITERIA]',
      ...f.acceptanceCriteria.map(c => `- ${c.id}: ${c.outcome}`));
    if (f.mandatoryConstraint) lines.push(`[MANDATORY_CONSTRAINT] ${f.mandatoryConstraint.requirement} (${f.mandatoryConstraint.reason})`,
      `${t.constraintEvidence}${f.mandatoryConstraint.evidence.join('; ')}`);
    if (f.implementationHint) lines.push(`[IMPLEMENTATION_HINT] ${t.optional}${f.implementationHint}`);
    const resolution = latest?.resolutions.find(x => x.issueId === f.id);
    if (resolution) lines.push(`[RECHECK] ${resolution.status}: ${resolution.evidence.join('; ')}`,
      ...resolution.checks.map(c => `- ${c.criterionId}: ${c.status}; ${c.evidence.join('; ')}`));
  };
  for (const issueId of todo.issueIds) renderIssue(s.issues.find(f => f.id === issueId));
  if (!todo.issueIds.length) lines.push(s.status === 'PASS' ? t.noBlockersPass : t.noBlockersOpen);
  lines.push('\n[FIXED_CRITERIA]');
  for (const c of s.contract.criteria) lines.push(t.fixedLine(c, latest?.criteriaResults.find(x => x.criterionId === c.id)));
  lines.push(latest ? `[REGRESSION_CHECK] ${latest.regressionCheck.status}: ${latest.regressionCheck.evidence.join('; ')}` : t.regressionNone);
  if (todo.decisions.length) lines.push('\n[DECISION_REQUIRED]', ...todo.decisions.map(t.decisionRequired));
  // Each finding appears once. Optional or resolved issues are not presented as
  // additional blockers to GO merely because they remain in retained history.
  for (const [heading, predicate] of [
    ['SCOPE_DECISION_ISSUES', f => f.classification === 'risk-escalation'],
    ['NON_BLOCKING_SUGGESTIONS', f => f.classification === 'non-blocking'],
    ['RESOLVED_ISSUES', f => ['blocking', 'regression'].includes(f.classification) && f.status === 'resolved'],
  ]) {
    const group = s.issues.filter(predicate);
    if (group.length) { lines.push('\n[' + heading + ']'); group.forEach(renderIssue); }
  }
  if (s.stopReasons.length) lines.push('\n[STOP_REASONS] ' + s.stopReasons.join(', '));
  lines.push('\n' + t.trust(s), t.noApproval);
  return lines.join('\n') + '\n';
}

module.exports = { requirements, decision, nextAction, route, nextRoundTemplate, summarize };
