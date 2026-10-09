'use strict';

// 1.36.288 (T-0309): prevention for Instruction-to-UI Leakage. Requirement, criterion and
// implementation wording cannot be told from product copy by syntax (see docs/ui-boundary-scanner.md),
// so the agent that writes the UI gets the boundary before it writes. Claude Code and Codex choose a
// skill by its description, so ordinary sessions carry only the description; whether a host actually
// loads it for a given task is the host's decision and is not verified here.
const GUIDE_PATH = '.leerness/ui-copy-boundary.md';
const SKILL_PATHS = ['.agents/skills/ui-copy-boundary/SKILL.md', '.claude/skills/ui-copy-boundary/SKILL.md'];
const SCAN_EXAMPLE = (text) => `    {"schema":"leerness.ui-boundary-scan-input/v1","policyVersion":"leerness.ui-boundary/v1","taskKind":"ui","surfaces":[{"kind":"text","exposure":"rendered","text":"${text}","attribute":null}]}`;

const GUIDE_KO = `<!-- leerness:managed -->
# 화면 문구 경계

대상 사용자의 작업에 필요한 문구를 쓴다. UI를 만드는 사람에게 하는 지시(요구사항, 구현 지시, 개발 메모, 평가 기준, 디버그 정보)는 제품 문구로 옮기지 않는다. 다만 튜토리얼, 개발 도구, API 문서, 관리 화면, 템플릿 편집기처럼 기술 정보, 코드, 진단 정보, 템플릿, 기준, 사용자가 쓴 메모가 의도된 제품 내용일 수 있으므로, 아래 항목은 그 맥락에서 확인하고 판단이 갈리는 후보를 처리할 때만 짧게 근거를 남긴다.

## 쓰기 전에
1. 보이는 문자열마다 "이 문장은 사용자에게 하는 말인가, 만드는 사람에게 하는 말인가?"를 묻는다. 만드는 사람에게 하는 말이면 그 목적을 이루는 사용자용 문구를 새로 쓴다.
   - 요구사항 "예약이 없으면 새 예약 버튼과 안내 문구를 노출한다" → 빈 상태 문구 "아직 예약이 없습니다"와 [예약하기] 버튼
2. 기획 문장, 수용 기준, 평가 기준("직관적이어야 한다", "3초 안에 이해할 수 있을 것")을 제목, 부제, 툴팁으로 옮기지 않는다.
3. 구현 정보는 대상 사용자가 기능을 이해하거나 선택·설정·문제 해결을 하는 데 도움이 될 때만 넣는다. 그 밖의 구현 과정 설명("~로 구현했습니다")은 개발 메모에 둔다.
4. TODO, 개발자·디자이너 메모, 임시·더미 문구, lorem ipsum을 남기지 않는다. 정해지지 않은 문구는 최종 사용자 문구로 쓰거나 작업 목록에 남긴다.
5. 값이 없으면 사실에 맞는 빈 상태·로딩·오류 또는 정해 둔 대체 문구로 표시하고 값을 지어내지 않는다. undefined, null, NaN, [object Object], 미치환 변수, 원시 i18n 키가 실수로 노출되지 않는지 확인한다. 원시 오류, 응답 객체, 스택은 사용자가 할 수 있는 행동을 알려 주는 메시지로 바꾸고 진단 정보는 개발자 경로에 남긴다. 의도된 예제와 편집기 내용은 보존한다.

## 확인할 곳
제목, 부제, 버튼, 툴팁(title), placeholder, aria-label과 alt, 빈 상태, 로딩, 오류, 토스트와 알림, 언어별 문구.

## 확인 방법
실제 렌더된 문구와 접근성 이름을 확인한다. 검사할 때는 UTF-8 \`leerness.ui-boundary-scan-input/v1\` JSON 문서를 \`leerness ui scan --stdin\`에 전달한다. 일반 텍스트나 HTML을 그대로 넣지 않는다. 요청당 문구는 최대 32개, CLI 입력은 64 KiB, 문구 하나는 4,096바이트 이내다.

${SCAN_EXAMPLE('아직 예약이 없습니다')}

일치는 검토 후보이고, 일치 없음은 승인이 아니다. 기획 문장, 구현 설명, 평가 기준은 문법으로 가려낼 수 없으므로 제품 맥락에서 직접 검토한다. \`leerness ui review packet --stdin --json\`은 별도의 UI 검토 입력을 받아 검토 자료 묶음만 준비한다. 다른 검토자에게 실제 자료를 전달해 검토받는 절차는 따로 필요하다. 문구를 자동으로 지우지 않는다.
`;

const GUIDE_EN = `<!-- leerness:managed -->
# UI copy boundary

Write copy for the intended user's task. Keep instructions to the UI builder (requirements, implementation directions, developer notes, evaluation criteria, debug data) out of product copy. Technical details, code, diagnostics, templates, criteria, and user-authored notes can be intentional product content in tutorials, developer tools, API documentation, admin screens, and template editors, so apply the checks below in that context and record a short rationale only when resolving a disputed candidate.

## Before writing
1. For each visible string, ask: "Does this speak to the user or to the builder?" If it speaks to the builder, write new user-facing copy that serves its purpose.
   - Requirement "When there are no trips, show a create button and guidance" → empty state "No trips yet" with a [Plan a trip] button
2. Do not move specifications, acceptance criteria, or evaluation criteria ("must be intuitive", "understood within 3 seconds") into headings, subtitles, or tooltips.
3. Include implementation details only when they help the intended user understand a capability, make a choice, configure the product, or troubleshoot. Keep build narration ("built with ...") in development notes otherwise.
4. Leave no TODOs, developer or designer notes, temporary or dummy copy, or lorem ipsum. Undecided copy becomes final user copy or a task entry.
5. Represent missing data with an accurate empty, loading, or error state, or a deliberate fallback; do not invent a value. Check for accidentally exposed undefined, null, NaN, [object Object], unresolved variables, and raw i18n keys. Turn raw errors, response objects, and stack traces into messages that tell the user what they can do, and keep diagnostics in a developer channel. Preserve intentional examples and editor content.

## Where to check
Headings, subtitles, buttons, tooltips (title), placeholders, aria-label and alt, empty, loading, and error states, toasts and notifications, and each language.

## How to check
Inspect the actual rendered text and accessible names. To scan them, send a UTF-8 \`leerness.ui-boundary-scan-input/v1\` JSON document to \`leerness ui scan --stdin\`; do not pipe bare text or HTML. Use at most 32 texts per request, the CLI's 64 KiB input limit, and at most 4,096 bytes per text.

${SCAN_EXAMPLE('No trips yet')}

A match is a review candidate; no match is not approval. Specifications, implementation narration, and criteria cannot be told apart by syntax, so review them in product context. \`leerness ui review packet --stdin --json\` takes a separate UI-review input and only prepares a packet; another reviewer still has to receive and review the underlying materials. Never delete copy automatically.
`;

// The description is serialized as a quoted YAML scalar: plain scalars break on ": " and similar text.
function skillText(lang) {
  const en = lang === 'en';
  const description = en
    ? 'Use when building, changing, or reviewing UI screens or components with user-facing text or accessible names: labels, buttons, placeholders, tooltips, empty, loading and error states, and notifications. Keeps instructions to the builder (requirements, implementation notes, developer notes, criteria, debug data) out of product copy. Skip backend, infrastructure, or internal-documentation work unless it also changes a user-facing UI surface.'
    : '사용자용 문구나 접근성 이름이 있는 화면·컴포넌트를 만들거나 수정·검토할 때 사용합니다. 라벨, 버튼, placeholder, 툴팁, 빈 상태·로딩·오류, 알림을 포함하며, 요구사항·구현 설명·개발 메모·평가 기준·디버그 정보 같은 제작자용 지시가 제품 문구로 옮겨지지 않게 합니다. 백엔드·인프라·내부 문서 작업은 사용자에게 보이는 UI도 바꾸는 경우에만 적용합니다.';
  const body = en
    ? `Read \`${GUIDE_PATH}\` before writing visible text and apply it to every visible string and accessible value you add or change. Ask whether each sentence speaks to the user or to the builder. Before finishing, check the rendered text as the guide's "How to check" describes; scanner matches are candidates, not approvals.`
    : `보이는 문구를 쓰기 전에 \`${GUIDE_PATH}\`를 읽고, 추가하거나 바꾸는 모든 보이는 문자열과 접근성 값에 적용합니다. 문장마다 사용자에게 하는 말인지 만드는 사람에게 하는 말인지 묻습니다. 마치기 전에 안내 문서의 "확인 방법"대로 렌더된 문구를 확인합니다. 검사 일치는 검토 후보이지 승인이 아닙니다.`;
  return `---\nname: ui-copy-boundary\ndescription: ${JSON.stringify(description)}\n---\n\n# ${en ? 'UI copy boundary' : '화면 문구 경계'}\n\n${body}\n`;
}

function projectFiles(lang) {
  const files = { [GUIDE_PATH]: lang === 'en' ? GUIDE_EN : GUIDE_KO };
  for (const name of SKILL_PATHS) files[name] = skillText(lang);
  return files;
}

module.exports = { GUIDE_PATH, SKILL_PATHS, projectFiles };
