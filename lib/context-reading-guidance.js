'use strict';

 
 
const DELEGATED_CONTEXT = 'Leerness delegated work: reuse the assigned task ID, scope, allowed files, current project rules and source references from the parent. If missing, stale or contradictory, retrieve the specific instructions and task records before acting; compact counts are not rule text. Do not repeat whole-harness onboarding or create another task for the same assignment. The session owner handles registration, shared writeback and closure unless explicitly delegated. Read only relevant sections; narrow truncated searches instead of dumping history. Reviewers independently check source, fixed criteria and evidence. Return changed files, actual tests, unresolved risks and sources to the owner; use verify-claim for any authorized completion claim. Never mark the parent task done. --- Task: ';
const COMPACT_RULES = 'Rules: compact summaries/counts are not rule text. Reuse current rules from the parent or read leerness rule list in each target project; retrieve missing/stale constraints before acting.';

 
 
 
const LEGACY_KO_FIRST_ACTION = '## ⭐ 매 세션 첫 행동\n**반드시 `.leerness/session-workflow.md`를 먼저 읽고 6단계 워크플로를 따른다**: 요청분석→계획→분배→sub-agent작업→종합검증→마감. 라운드 길이/복잡도 무관, drift 방지를 위해 모든 작업에 동일 흐름 유지.';
const LEGACY_KO_READ_ORDER = [
  '## Mandatory read order (session start)',
  '1. **.leerness/session-workflow.md** (6단계 워크플로 — 최우선)',
  '2. .leerness/context-routing.md',
  '3. .leerness/session-handoff.md',
  '4. .leerness/current-state.md',
  '5. .leerness/plan.md',
  '6. .leerness/progress-tracker.md',
  '7. .leerness/guideline.md',
  '8. .leerness/protected-files.md',
  '9. .leerness/writeback-policy.md',
  '10. .leerness/anti-lazy-work-policy.md',
  '11. **.leerness/rules.md** (사용자 정의 영구 룰 — 매 세션 반드시 따름)',
].join('\n');
const LEGACY_KO_OWNER_LINES = [
  '- 작업 시작 시 `leerness handoff .`를 실행해 컨텍스트를 적재합니다 (handoff가 active rules를 자동 출력).',
  '- 의미 있는 변경 후 progress-tracker, current-state, task-log, session-handoff를 갱신합니다.',
  '- 매 세션 종료 시 `leerness session close .`로 9개 카테고리(완료/진행중/미완료/예정/대기/보류/차단/드랍/검증) + **활성 룰 검증 결과**를 보고합니다.',
];
function retireCanonicalLegacyReading(previous) {
  const marker = '<!-- leerness:migration-preserved -->';
  if (!String(previous).startsWith('<!-- leerness:managed -->')) return previous;
  const at = previous.indexOf(marker);
  const originalHead = at < 0 ? previous : previous.slice(0, at);
  let head = originalHead.replace(/\r\n/g, '\n');
  if (quotesLegacyInFence(head, [LEGACY_KO_FIRST_ACTION, LEGACY_KO_READ_ORDER, ...LEGACY_KO_OWNER_LINES])) return previous;
  const normalizedHead = head;
  const tail = at < 0 ? '' : previous.slice(at);
  const first = '\n' + LEGACY_KO_FIRST_ACTION + '\n\n## 정적 vs 동적 — leerness 역할 경계';
  if (head.split(first).length === 2) head = head.replace(first, '\n## 정적 vs 동적 — leerness 역할 경계');
  const readOrder = '\n' + LEGACY_KO_READ_ORDER + '\n\n## Required behavior';
  if (head.split(readOrder).length === 2) head = head.replace(readOrder, '\n## Required behavior');
  const requiredStart = head.indexOf('\n## Required behavior\n');
  if (requiredStart >= 0) {
    const nextHeading = head.indexOf('\n## ', requiredStart + 1);
    const requiredEnd = nextHeading < 0 ? head.length : nextHeading;
    let required = head.slice(requiredStart, requiredEnd);
    for (const oldLine of LEGACY_KO_OWNER_LINES) {
      const exactLine = '\n' + oldLine + '\n';
      if (required.split(exactLine).length === 2) required = required.replace(exactLine, '\n');
    }
    head = head.slice(0, requiredStart) + required + head.slice(requiredEnd);
  }
  return head === normalizedHead ? previous : head + tail;
}

 
 
const LEGACY_CLAUDE_RUN = 'Follow AGENTS.md. Always run `leerness handoff .` at the start and `leerness session close .` before ending a session.';
const LEGACY_CLAUDE_FIRST = '**⭐ 매 세션 첫 행동**: `.leerness/session-workflow.md`의 6단계 워크플로(요청분석→계획→분배→sub-agent→종합검증→마감)를 따라야 함. drift critical 시 `leerness drift check --auto-fix`로 자동 회복.';
function retireCanonicalLegacyClaudeReading(previous) {
  if (!String(previous).startsWith('<!-- leerness:managed -->\n# Claude Code Instructions\n')) return previous;
  const marker = '<!-- leerness:migration-preserved -->';
  const at = previous.indexOf(marker);
  const head = (at < 0 ? previous : previous.slice(0, at)).replace(/\r\n/g, '\n');
  const tail = at < 0 ? '' : previous.slice(at);
  const block = '\n\n' + LEGACY_CLAUDE_RUN + '\n\n' + LEGACY_CLAUDE_FIRST + '\n\n**완료 주장 전**';
  if (head.split(block).length !== 2 || quotesLegacyInFence(head, [LEGACY_CLAUDE_RUN, LEGACY_CLAUDE_FIRST])) return previous;
  return head.replace(block, '\n\n**완료 주장 전**') + tail;
}

function retireCanonicalLegacyAdapterReading(file, previous) {
  const specs = {
    '.cursor/rules/leerness.mdc': {
      prefix: '<!-- leerness:managed -->\n---\nalwaysApply: true\n---\n',
      old: '\nFollow AGENTS.md and .leerness/context-routing.md.\nRun: `leerness handoff .` at session start.\nRun: `leerness session close .` at session end.\nPreserve Leerness protected files.\n',
      next: '\nFollow AGENTS.md and .leerness/context-routing.md.\nPreserve Leerness protected files.\n',
    },
    '.github/copilot-instructions.md': {
      prefix: '<!-- leerness:managed -->\n# Copilot Instructions\n',
      old: '\nUse AGENTS.md and .leerness/ as project memory.\nDo not remove protected Leerness files.\nBefore completion, ensure plan.md, progress-tracker.md, current-state.md, session-handoff.md are updated.\n',
      next: '\nUse AGENTS.md and .leerness/ as project memory.\nDo not remove protected Leerness files.\n',
    },
  };
  const spec = specs[file];
  if (!spec || !String(previous).startsWith(spec.prefix)) return previous;
  const marker = '<!-- leerness:migration-preserved -->';
  const at = previous.indexOf(marker);
  const head = (at < 0 ? previous : previous.slice(0, at)).replace(/\r\n/g, '\n');
  const tail = at < 0 ? '' : previous.slice(at);
  if (head.split(spec.old).length !== 2) return previous;
  const kept = new Set(spec.next.split('\n'));
  if (quotesLegacyInFence(head, [spec.old.split('\n').filter(l => !kept.has(l)).join('\n')])) return previous;
  return head.replace(spec.old, spec.next) + tail;
}

 
 
 
 
function fencedLines(lines) {
  const inside = new Set();
  let open = '';
  lines.forEach((line, n) => {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open) {
      inside.add(n);
      if (m && m[1][0] === open[0] && m[1].length >= open.length && /^[ \t]*$/.test(m[2])) open = '';
    } else if (m && !(m[1][0] === '`' && m[2].includes('`'))) { open = m[1]; inside.add(n); }
  });
  return inside;
}
 
 
function quotesLegacyInFence(head, blocks) {
  const lines = head.split('\n'), wanted = new Set();
  for (const block of blocks) for (const l of block.split('\n')) if (l.trim()) wanted.add(l.trim());
  for (const n of fencedLines(lines)) if (wanted.has(lines[n].trim())) return true;
  return false;
}

 
 
 
 
 
 
 
 
 
 
 
 
 
const { GENERATED_LAYOUTS } = require('./retired-guidance-sections');
const PRESERVED_MARKER = '<!-- leerness:migration-preserved -->';
 
 
 
function generatedHeadFingerprint(text) {
  const s = String(text).replace(/\r\n/g, '\n'), at = s.indexOf(PRESERVED_MARKER);
  const lines = (at < 0 ? s : s.slice(0, at)).split('\n').map(l => l.replace(/[ \t]+$/, ''));
  const dropBlank = () => { while (lines.length && !lines[lines.length - 1]) lines.pop(); };
  dropBlank();
  if (at >= 0 && lines[lines.length - 1] === '---') { lines.pop(); dropBlank(); }
  return require('crypto').createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 32);
}
let generatedLayouts = null;
function retireGeneratedGuidance(previous) {
  if (!generatedLayouts) generatedLayouts = new Set(GENERATED_LAYOUTS);
  const s = String(previous);
  if (!generatedLayouts.has(generatedHeadFingerprint(s))) return previous;
  const at = s.indexOf(PRESERVED_MARKER);
  return at < 0 ? '' : s.slice(at);
}

function preserveCursorRulePolicy(file, next, previous, alternate) {
  if (String(file).replace(/\\/g, '/') !== '.cursor/rules/leerness.mdc' || !previous || !String(previous).trim()) return false;
  const source = String(previous).replace(/\r\n/g, '\n');
  for (const template of [next, alternate || '']) {
    const prefix = String(template || '').replace(/\r\n/g, '\n').trimEnd();
    if (prefix && source.startsWith(prefix) && (!source.slice(prefix.length) || source[prefix.length] === '\n')) return false;
  }
  const legacyPrefix = '<!-- leerness:managed -->\n---\nalwaysApply: true\n---\n';
  return !(source.startsWith(legacyPrefix) && retireGeneratedGuidance(source) !== source);
}

 
 
 
function entry(lang, opts = {}) {
  const minimal = !!(opts && opts.minimal);
  return lang === 'en'
    ? '\n## Context reading scope\n\nSession-wide start, registration, shared writeback and close below belong to the main session owner. Delegated workers/reviewers reuse the assigned task and current rules; they do not repeat full onboarding or close the parent session. Missing/stale constraints must be retrieved before acting. Read relevant sections, not every listed file in full.'
      + (minimal ? '' : ' See the reading policy at the top of .leerness/context-routing.md; minimal mode follows this paragraph directly.')
      + ' User/project constraints still apply. Completion claims require actual evidence; verify-claim is an optional helper unless an explicit project rule requires it.\n'
    : '\n## 컨텍스트 읽기 범위\n\n아래 세션 시작·작업 등록·공유 기록·마감은 주 세션 담당자의 책임이다. 위임 작업자·검수자는 배정된 작업과 현재 규칙을 재사용하고 전체 시작 절차나 부모 세션 마감을 반복하지 않는다. 누락·오래된 제약은 작업 전에 확인한다. 파일 목록은 관련 부분을 찾는 색인이며 전부 정독하라는 뜻이 아니다.'
      + (minimal ? '' : ' 세부 기준은 .leerness/context-routing.md 앞부분에 있고 최소 모드는 이 문단을 직접 따른다.')
      + ' 사용자·프로젝트 제약은 유지한다. 완료 주장에는 실제 근거가 필요하며 verify-claim은 명시적 프로젝트 규칙이 없는 한 선택 도구다.\n';
}

 
 
 
 
function pointer(lang) {
  return lang === 'en'
    ? '\nContext reading scope (main session owner versus delegated workers and reviewers): follow that section in AGENTS.md.\n'
    : '\n컨텍스트 읽기 범위(주 세션 담당자와 위임 작업자·검수자의 구분)는 AGENTS.md의 같은 절을 따른다.\n';
}

function policy(lang) {
  return lang === 'en' ? `
## Context reading policy

- The main session owner loads only needed task context and active rule text at the start or when constraints change. A follow-up message or compaction is not a new project bootstrap. Reuse available context; refresh changed or missing instructions, rule sources and task records.
- Use \`leerness context current [--task ID]\` for current task navigation and unabridged rules, and \`leerness context budget --files-only\` for document byte sizes without loading history bodies. These views do not replace explicit read instructions, fixed criteria, open findings or evidence. Close refreshes only its marked summary; older unmarked prose remains until a separate reviewed retention operation.
- Before delegation, provide the assigned task ID, role, scope, allowed files, current rule text with IDs/source revision or check time, relevant closed decisions, fixed acceptance criteria, and evidence/source links. A rule count or a statement that rules were loaded is insufficient. Do not omit mandatory constraints to meet a size target.
- Workers start with that packet and the relevant code/contract. Reviewers use the same frozen scope/criteria and independently inspect source, diff and evidence; worker conclusions are not proof. Re-review existing findings and changed evidence, then relevant regression paths. Retrieve missing/stale/contradictory constraints before a dependent action; report what remains unknown.
- Leerness-generated read lists below are an index. Search exact task/rule IDs or headings in named current files, then read bounded sections. Exclude archive, generated copies and history unless the question requires them. If output is truncated, narrow files/query/sections; do not reprint the same document in every chunk. Expand when evidence or a dependency justifies it and retain required rules intact.
- The main owner records shared state and closes the session once. Delegates return findings, actual tests and evidence for their assignment; they neither register duplicate tasks nor mark the parent done. Shared writeback or a separate session lifecycle requires an explicit assignment. Completion claims still require actual evidence and relevant checks; verify-claim remains optional unless project policy explicitly requires it.
- Reuse valid scan/test receipts only for the same relevant state and scope. Changed inputs, missing evidence or unresolved failures require the appropriate checks. Capture large scan logs outside the prompt and report counts, blockers and paths; read relevant findings when needed. Compact handoff is navigation, not the full active rules or proof of compliance. These instructions guide reading; they do not enforce model behavior or verify token savings.
` : `
## 컨텍스트 읽기 정책

- 주 세션 담당자는 시작 또는 제약 변경 시 필요한 작업 문맥과 활성 룰 원문만 확인한다. 후속 메시지나 문맥 압축을 프로젝트 시작으로 다시 취급하지 않는다. 이미 받은 문맥은 재사용하고 바뀌거나 누락된 지침·룰 원본·작업 기록만 다시 확인한다.
- \`leerness context current [--task ID]\`로 현재 작업과 규칙 원문을, \`leerness context budget --files-only\`로 이력 본문을 읽지 않고 문서 크기를 확인한다. 명시 읽기 지시·고정 기준·열린 지적·근거는 대체하지 않는다. 마감은 표지가 있는 요약만 갱신하며 표지 없는 과거 원문은 별도 검토한 보관 작업 전까지 유지한다.
- 위임 시 작업 ID·역할·범위·수정 허용 파일·현재 룰 원문과 ID/출처 버전 또는 확인 시점·관련 폐쇄 결정·고정 통과 조건·근거/소스 경로를 전달한다. 룰 개수나 읽었다는 말만으로 대체하지 않는다. 양을 줄이려고 필수 제약을 빼지 않는다.
- 작업자는 전달 내용과 관련 코드/계약부터 읽는다. 검수자는 같은 범위·조건으로 실제 소스·변경분·근거를 독립 확인하며 작업자의 결론을 증거로 간주하지 않는다. 재검수는 기존 지적과 바뀐 근거 및 관련 회귀를 확인한다. 누락·오래됨·모순은 종속 작업 전에 원본을 확인하고 미확인 부분을 보고한다.
- 아래 Leerness 생성 읽기 목록은 색인이다. 현재 파일을 지정해 정확한 작업/룰 ID나 제목을 찾고 필요한 부분만 읽는다. 질문에 필요하지 않은 archive·생성 사본·전체 이력은 제외한다. 출력이 잘리면 파일·검색어·범위를 좁히고 같은 문서를 조각내 전부 다시 출력하지 않는다. 근거·의존성이 있으면 범위를 넓히되 필수 룰 원문은 온전히 유지한다.
- 공유 상태 기록과 세션 마감은 주 담당자가 한 번 수행한다. 위임 에이전트는 담당 작업의 발견·실제 테스트·근거를 반환하고 중복 작업을 등록하거나 부모 작업을 완료 처리하지 않는다. 공유 기록 수정이나 별도 세션 절차는 명시 배정이 있어야 한다. 완료 주장은 실제 근거와 필요한 검증에 기반하며 verify-claim은 명시적 프로젝트 규칙이 없는 한 선택적이다.
- 검사·테스트 기록은 관련 상태와 범위가 같을 때만 재사용한다. 입력 변경·근거 누락·미해결 실패가 있으면 해당 검증을 수행한다. 긴 검사 로그는 프롬프트 밖에 저장하고 건수·차단 사유·경로를 보고하며 필요한 지적을 확인한다. compact 인수인계는 탐색용이며 활성 룰 원문이나 준수 증거가 아니다. 이 지침은 읽기 안내이며 모델 행동·토큰 절감을 강제하거나 인증하지 않는다.
`;
}

function afterTitle(text, section) { return text.replace(/^(# [^\n]+\n)/m, '$1' + section); }
function apply(files, lang, opts = {}) {
  if (files['AGENTS.md']) files['AGENTS.md'] = afterTitle(files['AGENTS.md'], entry(lang, opts));
  for (const name of ['CLAUDE.md', '.github/copilot-instructions.md']) {
    if (files[name]) files[name] = afterTitle(files[name], pointer(lang));
  }
  if (files['AGENTS.md']) {
    files['AGENTS.md'] = files['AGENTS.md']
      .replace(/## (?:First action every session|매 세션 첫 행동)\n[\s\S]*?(?=\n## )/, lang === 'en'
        ? '## First action every session\nThe main session owner starts with .leerness/session-workflow.md. Delegates follow the reading scope above.\n'
        : '## 매 세션 첫 행동\n주 세션 담당자는 .leerness/session-workflow.md부터 시작하고 위임 에이전트는 위 읽기 범위를 따른다.\n')
      .replace('## Mandatory read order (session start)', '## Context index (session owner; relevant sections)')
      .replace('- 작업 시작 시 `leerness handoff .`를 실행해 컨텍스트를 적재합니다 (handoff가 active rules를 자동 출력).', '- 주 세션 담당자는 세션 시작 시 `leerness handoff .`로 컨텍스트를 적재합니다 (handoff가 active rules를 자동 출력).')
      .replace('- 의미 있는 변경 후 progress-tracker, current-state, task-log, session-handoff를 갱신합니다.', '- 주 세션 담당자는 의미 있는 변경 후 progress-tracker, current-state, task-log, session-handoff를 갱신합니다.')
      .replace('- 매 세션 종료 시 `leerness session close .`로 9개 카테고리(완료/진행중/미완료/예정/대기/보류/차단/드랍/검증) + **활성 룰 검증 결과**를 보고합니다.', '- 주 세션 담당자는 세션 종료 시 `leerness session close .`로 9개 카테고리(완료/진행중/미완료/예정/대기/보류/차단/드랍/검증) + **활성 룰 검증 결과**를 보고합니다.')
      .replace('- Run `leerness handoff .` at session start to load context (handoff prints active rules automatically).', '- The main session owner runs `leerness handoff .` at session start to load context (handoff prints active rules automatically).')
      .replace('- After meaningful changes update progress-tracker, current-state, task-log, session-handoff.', '- After meaningful changes, the main session owner updates progress-tracker, current-state, task-log, session-handoff.')
      .replace('- Close every session with `leerness session close .` — 9 categories (done/in-progress/incomplete/planned/waiting/on-hold/blocked/dropped/verification) + active-rule verification.', '- The main session owner closes with `leerness session close .` — 9 categories (done/in-progress/incomplete/planned/waiting/on-hold/blocked/dropped/verification) + active-rule verification.');
  }
  if (files['CLAUDE.md']) files['CLAUDE.md'] = files['CLAUDE.md'].replace('Follow AGENTS.md. Always run', 'Follow AGENTS.md. The main session owner runs');
  if (files['.cursor/rules/leerness.mdc']) files['.cursor/rules/leerness.mdc'] = files['.cursor/rules/leerness.mdc'].replace(/\nRun: /g, '\nMain session owner: ') + pointer(lang);
  if (files['.github/copilot-instructions.md']) files['.github/copilot-instructions.md'] = files['.github/copilot-instructions.md'].replace('Before completion, ensure', 'Before completion, the main session owner ensures');
  if (files['.leerness/context-routing.md']) files['.leerness/context-routing.md'] = afterTitle(files['.leerness/context-routing.md'], policy(lang));
  if (files['.leerness/session-workflow.md']) files['.leerness/session-workflow.md'] = afterTitle(files['.leerness/session-workflow.md'], pointer(lang));
  return softenManagedGuidance(files);
}

function softenManagedGuidance(files) {
  const managed = name => typeof files[name] === 'string' &&
    files[name].indexOf('<!-- leerness:managed -->\n') >= 0 &&
    files[name].indexOf('<!-- leerness:managed -->\n') < 400 &&
    !files[name].includes('<!-- leerness:migration-preserved -->');
  function change(name, fixes) {
    if (!managed(name)) return;
    let s=files[name];
    for (const [before,after] of fixes) s=s.replace(before,after);
    files[name]=s;
  }
  change('AGENTS.md',[
    [/^1\. \*\*\.leerness\/session-workflow\.md\*\* \(6-step workflow — highest priority\)$/m,
      '1. .leerness/session-workflow.md (consult relevant steps only when needed)'],
    [/^11\. \*\*\.leerness\/rules\.md\*\* \(user-defined standing rules — follow every session\)$/m,
      '11. .leerness/rules.md (review and follow applicable current owner rules)'],
    [/^- \*\*Preview-approval duty \(new features\)\*\*:[^\n]*$/m,
      '- A preview is optional for visual changes unless an explicit owner or project rule requires approval. Do not add a default code-freeze gate for nonvisual work.'],
    [/^- \*\*Design-mockup duty \(web pages \/ design work\)\*\*:[^\n]*$/m,
      '- Use visual mockups when requested or helpful for a visual task; follow actual user approval requirements, not universal preview gates.'],
    [/^- Classify work with [^\n]*$/m,
      '- Use the work-type router only if the work category is uncertain; reuse native agent planning.'],
    [/^- Before claiming completion, self-verify with [^\n]*$/m,
      '- Completion claims rely on original acceptance criteria, relevant tests and remaining risks. Leerness check/lazy/lens are optional diagnostics.'],
    [/^- Before changes run the guards:[^\n]*$/m,
      '- For security or encoding-sensitive changes run the relevant checks; preserve the existing CI and owner policy.'],
    [/^- Before duplicating a capability check [^\n]*$/m,
      '- Prefer an existing capability; consult only directly relevant design and reuse references.'],
    [/^At task start, check active-rule conditions [^\n]*$/m,
      'Check applicable active owner rules before dependent actions. Do not silently pause rules. Record compliance and uncertainty when an actual rule requires it; no automatic approval follows.'],
    [/^1\. \*\*\.leerness\/session-workflow\.md\*\* \(6단계 워크플로 — 최우선\)$/m,
      '1. .leerness/session-workflow.md (필요 시 관련 단계 참조)'],
    [/^11\. \*\*\.leerness\/rules\.md\*\* \(사용자 정의 영구 룰 — 매 세션 반드시 따름\)$/m,
      '11. .leerness/rules.md (해당 작업에 적용되는 사용자 규칙만 확인하고 준수)'],
    [/^## (?:First action every session|매 세션 첫 행동)$/m,'## Session context (on demand)'],
    [/^The main session owner starts with \.leerness\/session-workflow\.md\. Delegates follow the reading scope above\.$/m,'The main session owner checks relevant task context if needed. Delegates use the assigned packet. Do not repeat full onboarding.'],
    [/^주 세션 담당자는 \.leerness\/session-workflow\.md부터 시작하고 위임 에이전트는 위 읽기 범위를 따른다\.$/m,'주 세션 담당자는 필요한 작업과 규칙만 확인하고 위임 에이전트는 배정된 범위를 사용한다. 매 메시지마다 초기 절차를 반복하지 않는다.'],
    [/^## Context index \(session owner; relevant sections\)$/m,'## Context index (optional reference, not a mandatory full read)'],
    [/^- 주 세션 담당자는 세션 시작 시 `leerness handoff \.`[^\n]*$/m,'- 주 세션 담당자는 세션 시작 시 `leerness handoff .`가 필요한 경우에만 사용하고 기존 문맥을 재사용합니다.'],
    [/^- 주 세션 담당자는 의미 있는 변경 후 progress-tracker[^\n]*$/m,'- 주 세션 담당자는 의미 있는 변경 후 progress-tracker 등 실제 변경된 공유 상태만 갱신하며 모든 기록을 반복해서 쓰지 않습니다.'],
    [/^- 주 세션 담당자는 세션 종료 시 `leerness session close \.`[^\n]*$/m,'- 주 세션 담당자는 세션 종료 시 `leerness session close .`가 필요한 경우에만 사용합니다. 별도 사용자 규칙은 유지합니다.'],
    [/^- The main session owner runs `leerness handoff \.`[^\n]*$/m,'- The main session owner runs `leerness handoff .` only when fresh context is needed; reuse current context.'],
    [/^- After meaningful changes, the main session owner updates progress-tracker[^\n]*$/m,'- After meaningful changes, the main session owner updates progress-tracker only for relevant changed state.'],
    [/^- The main session owner closes with `leerness session close \.`[^\n]*$/m,'- The main session owner closes with `leerness session close .` only for needed handoff or explicit project rules.'],
    [/^- \*\*모호성 질문 의무\*\*:[^\n]*$/m,'- 결과에 영향을 주는 핵심 모호성이 있을 때만 확인합니다. `leerness clarify`는 선택 도구입니다.'],
    [/^- \*\*미리보기 승인 의무 \(신규 기능\)\*\*:[^\n]*$/m,'- 미리보기는 화면 변경이나 명시적 사용자·프로젝트 정책이 있는 경우에 사용합니다. 비시각 변경에 추가 승인 단계를 강제하지 않습니다.'],
    [/^- \*\*디자인 시안 의무 \(웹페이지\/디자인 작업\)\*\*:[^\n]*$/m,'- 화면 시안은 시각적 검토가 필요하거나 명시적으로 요청된 경우에 사용합니다. 사용자 지정 승인 규칙은 유지합니다.'],
    [/^- 작업 분류는 `leerness route <task-type>`[^\n]*$/m,'- 작업 유형이 불확실할 때만 `leerness route <task-type>`를 참고합니다.'],
    [/^- 완료 선언 전 `leerness check \.`[^\n]*$/m,'- 완료 주장은 원래 요구사항·관련 테스트·미검증 범위에 근거합니다. `leerness check`·`lazy detect`·`lens`는 선택 진단입니다.'],
    [/^- 변경 전 secret\/encoding 가드:[^\n]*$/m,'- 보안·인코딩 위험이 있는 변경에는 필요한 검사를 실행합니다. 기존 CI·보안 정책은 우회하지 않습니다.'],
    [/^이 프로젝트는 \*\*최소 등급\*\*입니다\. 규약은 셋뿐입니다\.$/m,'이 프로젝트는 **최소 등급**입니다. 아래 명령은 필요한 경우에만 사용하는 선택 도구입니다.'],
    [/^This project runs in \*\*minimal mode\*\*\. There are only three rules\.$/m,'This project runs in **minimal mode**. Commands below are optional tools, not mandatory session gates.'],
    [/^1\. \*\*세션 시작\*\*:[^\n]*$/m,'1. **세션 시작**: 필요한 경우 `leerness handoff .`로 문맥 확인.'],
    [/^2\. \*\*완료 주장 전\*\*:[^\n]*$/m,'2. **완료 주장 전**: 실제 증거를 확인하며 `leerness verify-claim <T-ID>`는 선택 도구.'],
    [/^3\. \*\*세션 종료\*\*:[^\n]*$/m,'3. **세션 종료**: 필요한 인계에만 `leerness session close .` 사용.'],
    [/^1\. \*\*Session start\*\*:[^\n]*$/m,'1. **Session start**: use `leerness handoff .` only if more context is needed.'],
    [/^2\. \*\*Before claiming done\*\*:[^\n]*$/m,'2. **Before claiming done**: use real evidence; `leerness verify-claim <T-ID>` is optional.'],
    [/^3\. \*\*Session end\*\*:[^\n]*$/m,'3. **Session end**: use `leerness session close .` for a needed handoff.'],
  ]);
  change('CLAUDE.md',[
    [/^Protected files must not be deleted\. Read \.leerness\/anti-lazy-work-policy\.md before claiming completion\.$/m,
      'Protected files must not be deleted. Consult relevant quality rules if needed; completion requires actual evidence.'],
    [/^사용자가 "매 X마다 Y를 해줘"[^\n]*$/m,
      '사용자가 영구 규칙 등록을 명시적으로 요청한 경우에만 leerness rule add를 사용하고, 그 외 지시는 현재 작업 맥락에 맞게 처리합니다.'],
    [/Follow AGENTS\.md\. The main session owner runs `leerness handoff \.` at the start and `leerness session close \.` before ending a session\./,'Follow AGENTS.md. The main session owner may use `leerness handoff .` and `leerness session close .` as needed; these are not universal gates.'],
    [/Follow AGENTS\.md\. Three rules, always:/,'Follow AGENTS.md. Optional tools, not universal gates:'],
    [/^\*\*매 세션 첫 행동\*\*:[^\n]*$/m,'**문맥 확인**: 필요한 작업·규칙만 확인하고 자동 `drift check --auto-fix`는 실행하지 않습니다.'],
    [/^\*\*완료 주장 전\*\*:[^\n]*$/m,'**완료 주장 전**: 실제 요구·검사 근거를 확인합니다. `leerness verify-claim <T-ID>`는 선택 도구입니다.'],
  ]);
  change('.cursor/rules/leerness.mdc',[
    [/^alwaysApply: true$/m,
      'description: Leerness project memory and optional task handoff, only when this work needs Leerness guidance\nalwaysApply: false'],
    [/Main session owner: `leerness handoff \.` at session start\./,'Optional: main owner uses `leerness handoff .` only if context is needed.'],
    [/Main session owner: `leerness session close \.` at session end\./,'Optional: main owner uses `leerness session close .` only for handoff.'],
  ]);
  // Cursor parses YAML frontmatter only at the beginning of a .mdc file.
  // The legacy Leerness marker is an HTML comment before the frontmatter;
  // move it below the validated generated header, not into owner-authored text.
  const cursorName = '.cursor/rules/leerness.mdc';
  if (managed(cursorName)) {
    const cursor = files[cursorName];
    const prefix = '<!-- leerness:managed -->\n---\n';
    if (cursor.startsWith(prefix)) {
      const end = cursor.indexOf('\n---\n', prefix.length);
      if (end !== -1 && end < 400) {
        const frontmatter = cursor.slice(prefix.length, end);
        if (frontmatter.includes('description: Leerness project memory') &&
            frontmatter.includes('\nalwaysApply: false')) {
          files[cursorName] = '---\n' + frontmatter + '\n---\n<!-- leerness:managed -->\n' + cursor.slice(end + 5);
        }
      }
    }
  }
  change('.github/copilot-instructions.md',[
    [/Before completion, the main session owner ensures plan\.md, progress-tracker\.md, current-state\.md, session-handoff\.md are updated\./,'Update relevant shared records when facts change; do not rewrite all four files for every task.'],
  ]);
  change('.leerness/guideline.md',[
    [/^- 변경 전 관련 route를 확인합니다[^\n]*$/m,'- 필요한 경우에만 작업 경로를 조회합니다.'],
    [/^- 변경 후 `leerness verify`, `leerness audit`, `leerness check`을 실행합니다\.$/m,'- 변경 관련 실제 검사를 실행합니다. Leerness 진단은 선택 도구입니다.'],
    [/^- 완료 선언 전 `leerness lazy detect`을 실행합니다\.$/m,'- 완료 주장은 요구·근거·미검증 범위를 구분합니다.'],
    [/^- 세션 종료 시 `leerness session close`를 실행합니다\.$/m,'- 인계가 필요하면 `leerness session close`를 선택적으로 실행합니다.'],
  ]);
  change('.leerness/session-workflow.md',[
    [/^> \*\*매 세션 시작 시 메인 에이전트는 이 문서를 먼저 읽고 6단계를 그대로 따른다\.\*\*$/m,'> 작업 규모와 사용자 규칙에 따라 관련 단계만 선택합니다.'],
    [/^> 라운드 길이\/복잡도 무관, 단순 작업도 동일 흐름 유지 — 그래야 drift 안 됨\.$/m,'> 단순 수정에는 기존 문맥과 변경 관련 검사만으로 충분할 수 있습니다.'],
    [/^세션 끝나기 전 다음이 모두 ✓이어야 한다:$/m,'해당 작업에 필요한 항목만 확인합니다. 실제 필수 승인 조건은 유지합니다:'],
    [/^## Step 3\. 업무 분배 — sub-agent 매핑$/m,'## Step 3. 필요한 경우에만 업무 분배'],
    [/^## Step 5\. 종합 검증$/m,'## Step 5. 변경 영향 기반 검증 (명령은 선택)'],
    [/^## Step 6\. 세션 마감 \+ 인계 \+ 다음 라운드 추천$/m,'## Step 6. 필요한 경우 인계'],
    [/^- "작업 끝났으니 보고만 하고 끝" → session close 누락 → 다음 세션 drift critical$/m,'- 인계할 내용이 빠졌다면 기록하되, session close 미실행만으로 결함으로 취급하지 않습니다.'],
    [/^- "TodoWrite만 갱신하고 leerness 안 씀" → `task sync --from` 또는 `task add` 필수$/m,'- 기존 작업 상태의 정본을 재사용하고 중복 등록을 강요하지 않습니다.'],
  ]);
  change('.leerness/anti-lazy-work-policy.md',[
    [/^7\. \*\*품질 렌즈 자가질문\*\*:[^\n]*$/m,'7. **품질 점검**: 원래 수용 조건과 실제 증거로 판단합니다. `leerness lens`는 선택형 참고 도구입니다.'],
  ]);
  return files;
}

module.exports = { DELEGATED_CONTEXT, COMPACT_RULES, entry, pointer, policy, apply, retireCanonicalLegacyReading, retireCanonicalLegacyClaudeReading, retireCanonicalLegacyAdapterReading, retireGeneratedGuidance, generatedHeadFingerprint, preserveCursorRulePolicy };
