'use strict';

const fs = require('fs');
const path = require('path');
const { loadTogglesChecked } = require('./toggles');

const POLICY_PATH = '.leerness/plain-language-reporting.md';
const SKILL_PATHS = ['.agents/skills/plain-language-reporting/SKILL.md', '.claude/skills/plain-language-reporting/SKILL.md'];

const POLICY_KO = `<!-- leerness:managed -->
# 쉬운 작업 설명과 근거

이 정책은 보고의 표현에 적용한다. 구현 품질, 보안, 검수 기준, 테스트, 승인 권한은 바꾸지 않는다.

1. 결과와 사용자 영향을 먼저 말하고, 필요한 사용자 행동을 명시한다. 작은 작업에는 중복된 요약 구역을 만들지 않는다.
2. 쉬운 말을 먼저 쓰고 필요한 전문용어와 약어의 뜻을 첫 등장에 덧붙인다. 사용자의 질문 수준에 맞춰 깊이를 조절한다.
3. 이전과 이후, 문제·확인된 원인·조치·결과를 구분한다. 추정 원인을 확정 사실처럼 쓰지 않는다.
4. 숫자에는 대상·단위·조건·의미를 붙인다. 비교 수치와 성능 개선은 같은 조건의 실제 측정으로만 주장한다.
5. 중요한 주장에 직접 맞는 근거를 짧게 연결한다. 실제 실행 결과, 코드·설정, 로그, 측정, 공식 문서, 추론의 상태를 구분한다. 근거가 없으면 없다고 말한다.
6. 구현·테스트·로컬 검증·운영 검증·배포의 완료 범위를 구분한다. 실패, 데이터 손실 위험, 남은 한계를 숨기지 않는다.
7. 내부 이름, 긴 경로, 해시, 전체 로그, 모든 시도는 판단에 필요할 때만 보여 준다. 구체적인 예시는 실제 관측과 설명용 가상을 분리한다.
8. 같은 사실을 이름만 바꿔 반복하지 않는다. 추가 정보나 행동이 없는 문장은 한 곳에 모으고, 정당한 요약·상세·접근성 설명은 유지한다.
9. “쉽게 설명해줘”는 그 대화의 설명을 다시 구성하는 요청이다. 프로젝트 토글을 영구 변경하지 않는다. 전문 질문에는 원문 근거와 필요한 상세를 제공한다.

작업 보고 순서: 확인된 결과 → 사용자 영향 → 위험·미확인 사항 → 필요한 행동 → 짧은 근거. 해당 사항이 없으면 억지로 구역을 채우지 않는다.
`;

const POLICY_EN = `<!-- leerness:managed -->
# Plain-language reporting with evidence

This policy changes how results are explained. It does not lower implementation quality or change security, review criteria, tests, or approval authority.

1. Lead with the result and its effect on the user. State any action the user needs to take. Do not pad short reports with repetitive sections.
2. Use everyday words first. Explain necessary jargon and abbreviations on first use, and match the user's level of detail.
3. Separate before and after, problem, confirmed cause, change, and result. Label uncertain causes as inferences.
4. Give numbers a subject, unit, conditions, and meaning. Claim performance gains only from comparable direct measurements.
5. Connect important claims to relevant evidence. Distinguish actual execution, code or settings, logs, measurements, official documentation, and inference. Say when evidence is missing.
6. Distinguish implementation, tests, local verification, production verification, and deployment. Report failures, data-loss risks, and remaining limits.
7. Show internal names, long paths, hashes, full logs, and attempted steps only when they help a decision. Separate illustrative examples from observations.
8. Do not repeat the same fact under new labels. Combine statements that add no information or action, while preserving useful summary, detail, and accessibility descriptions.
9. A one-time request for a simpler explanation changes that conversation, not the saved project toggle. Give source evidence and technical depth when an expert asks.

Report order: confirmed result → user impact → risks or unknowns → user action → concise evidence. Omit sections that would only repeat information.
`;

function skillText(lang) {
  const en = lang === 'en';
  return `---\nname: plain-language-reporting\ndescription: ${en ? 'Explain work in everyday language with evidence when the project toggle is on or the user asks for a simpler explanation.' : '프로젝트 토글이 켜졌거나 사용자가 쉬운 설명을 요청할 때 결과와 근거를 이해하기 쉽게 설명합니다.'}\n---\n\n# ${en ? 'Plain-language reporting' : '쉬운 작업 설명'}\n\n${en ? 'Read' : '정책 원문'}: \`${POLICY_PATH}\`. ${en ? 'Follow it once per report; do not duplicate the policy in handoff or this skill.' : '보고마다 한 번만 적용하고, 정책 본문을 인수인계나 이 스킬에 다시 복제하지 않습니다.'}\n${en ? 'Project-wide use requires' : '프로젝트 전체 적용은'} \`leerness toggle set plain-language-reporting on\`${en ? '. A direct request to explain one answer simply needs no saved setting.' : '으로 켭니다. 한 번의 쉬운 설명 요청은 저장 설정 없이 처리합니다.'}\n${en ? 'Keep the original tests and evidence requirements.' : '기존 테스트와 근거 검증 요구는 그대로 지킵니다.'}\n`;
}

function projectFiles(lang) {
  const files = { [POLICY_PATH]: lang === 'en' ? POLICY_EN : POLICY_KO };
  for (const name of SKILL_PATHS) files[name] = skillText(lang);
  return files;
}

function state(root) {
  const checked = loadTogglesChecked(root);
  const unreadable = checked.unreadable.includes('plain-language-reporting');
  const enabled = checked.toggles['plain-language-reporting'] === true && !checked.corrupt && !unreadable;
  const target = path.join(root, POLICY_PATH);
  let available = false;
  try {
    if (fs.statSync(target).isFile()) available = !!new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(target)).trim();
  } catch {}
  return {
    enabled,
    available,
    path: POLICY_PATH,
    status: checked.corrupt ? 'config-corrupt' : unreadable ? 'config-unreadable' : enabled && !available ? 'policy-unavailable' : enabled ? 'active' : 'off',
  };
}

module.exports = { POLICY_PATH, SKILL_PATHS, projectFiles, state };
