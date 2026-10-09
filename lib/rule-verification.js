'use strict';

// Natural-language keyword matches are observations, never whole-rule proof.
const SCOPE = 'keyword-signals-only';

function historicalRuleSummary(rules) {
  const active = rules.filter(rule => rule.status === 'active');
  const dated = active.filter(rule => {
    const match = /^(\d{4}-\d{2}-\d{2})(?:$|[ T])/.exec(rule.lastVerified || '');
    if (!match) return false;
    const date = new Date(match[1] + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[1];
  });
  return { active: active.length, historicalRecorded: dated.length,
    withoutDatedRecord: active.length - dated.length,
    invalidMarkers: active.filter(rule => rule.lastVerified && rule.lastVerified !== '-').length - dated.length,
    compliance: 'unknown', basis: 'active-lastVerified-date-only' };
}

function latestTestObservation(evidence, date) {
  // Evidence is authored text, not an authenticated execution receipt. Select
  // the latest matching same-day header; never borrow an exit from another day.
  const blocks = evidence.split(/\r?\n(?=## \d{4}-\d{2}-\d{2})/);
  const candidates = blocks.filter(block => {
    const header = block.trimStart().split(/\r?\n/, 1)[0];
    return new RegExp('^## ' + date + '(?:$|[ T])').test(header) && /(?:verify-code|\btest\b|\btests\b|테스트)/i.test(header);
  });
  if (!candidates.length) return { state: 'missing', note: 'no same-day test evidence header' };
  const last = candidates[candidates.length - 1];
  const exits = [...last.matchAll(/\bexit(?:Code)?\s*[=:]\s*(null|-?\d+)(?![\w.+-])/gi)].map(match => match[1]);
  if (exits.some(exit => exit === 'null' || Number(exit) !== 0) || /\bFAIL(?:ED)?\b/.test(last)) {
    return { state: 'failure-signal', note: 'same-day evidence reports failure; applicability/session binding unverified' };
  }
  if (!exits.length) return { state: 'incomplete', note: 'same-day test mention without an explicit completion exit code' };
  return { state: 'exit-zero-signal', note: 'same-day evidence reports exit=0; applicability/session binding unverified' };
}

function observeRule(rule, previous, current, evidence, date) {
  const text = rule.rule;
  const clauses = [];
  if (/version|버전|bump|상승/i.test(text)) {
    if (previous.packageVersion && current.packageVersion && previous.packageVersion !== current.packageVersion) {
      clauses.push({ kind: 'version', verified: 'observed', note: `${previous.packageVersion} -> ${current.packageVersion}` });
    } else if (!previous.packageVersion) {
      clauses.push({ kind: 'version', verified: 'baseline', note: `initial ${current.packageVersion || 'unknown'}` });
    } else clauses.push({ kind: 'version', verified: 'pending', note: 'no version change observed' });
  }
  if (/changelog|패치노트|patch.*note|note.*추가|note.*add/i.test(text)) {
    if (previous.changelogMtime && current.changelogMtime && current.changelogMtime > previous.changelogMtime) {
      clauses.push({ kind: 'changelog', verified: 'observed', note: 'CHANGELOG.md modification time increased; content unverified' });
    } else if (!previous.changelogMtime) {
      clauses.push({ kind: 'changelog', verified: 'baseline', note: 'initial observation' });
    } else clauses.push({ kind: 'changelog', verified: 'pending', note: 'no CHANGELOG.md change observed' });
  }
  if (/test|테스트|verify/i.test(text)) {
    const signal = latestTestObservation(evidence, date);
    clauses.push({ kind: 'test', verified: signal.state === 'exit-zero-signal' ? 'observed' : 'pending', ...signal });
  }
  // Always retain this unverified obligation even when another keyword matches.
  if (/deploy|배포|publish|push|release/i.test(text)) {
    clauses.push({ kind: 'deploy', verified: 'manual', note: 'deployment/push authorization and outcome require separate evidence' });
  }
  // Baseline and manual clauses cannot be upgraded by a successful sibling.
  const verified = clauses.some(clause => clause.verified === 'pending') ? 'pending'
    : !clauses.length || clauses.some(clause => clause.verified === 'manual') ? 'manual'
      : clauses.some(clause => clause.verified === 'baseline') ? 'baseline' : 'observed';
  return { ...rule, verified, verificationScope: SCOPE, applicability: 'unknown', compliance: 'unknown', clauses,
    note: clauses.length ? clauses.map(clause => `${clause.kind}:${clause.note}`).join(' · ')
      : 'no automatic pattern; review this rule against the current task and evidence' };
}

function summarizeRuleObservations(results) {
  const states = { observed: 0, pending: 0, manual: 0, baseline: 0 };
  for (const result of results) if (Object.hasOwn(states, result.verified)) states[result.verified]++;
  return { scope: SCOPE, active: results.length, states, unverifiedRules: results.length,
    compliance: 'unknown', applicability: 'not-evaluated', enforcement: 'advisory' };
}

function ruleObservationNotice(lang) {
  return lang === 'en'
    ? 'These are keyword observations, not rule compliance. Check each rule against the current task and attach evidence; missing evidence is unverified, not a proven violation. Conflicting or superseded instructions need source review.'
    : '아래는 키워드 관측이며 룰 준수 판정이 아닙니다. 각 룰의 이번 작업 적용 여부와 근거를 확인하세요. 근거 부족은 미검증이며 위반 확정이 아닙니다. 충돌·대체 지시는 원문 확인이 필요합니다.';
}

module.exports = { historicalRuleSummary, latestTestObservation, observeRule, summarizeRuleObservations, ruleObservationNotice };
