'use strict';

// Shared guidance only. This neither authenticates context nor limits an agent's
// filesystem access. User/project constraints and execution evidence still apply.
const DELEGATED_CONTEXT = 'Leerness delegated work: reuse the assigned task ID, scope, allowed files, current project rules and source references from the parent. If missing, stale or contradictory, retrieve the specific instructions and task records before acting; compact counts are not rule text. Do not repeat whole-harness onboarding or create another task for the same assignment. The session owner handles registration, shared writeback and closure unless explicitly delegated. Read only relevant sections; narrow truncated searches instead of dumping history. Reviewers independently check source, fixed criteria and evidence. Return changed files, actual tests, unresolved risks and sources to the owner; use verify-claim for any authorized completion claim. Never mark the parent task done. --- Task: ';
const COMPACT_RULES = 'Rules: compact summaries/counts are not rule text. Reuse current rules from the parent or read leerness rule list in each target project; retrieve missing/stale constraints before acting.';

// Only the byte-backed migration path calls this helper. These two exact blocks
// came from the old managed AGENTS.md template. A modified block, a duplicate
// outside the managed head, or any user-preserved text is left untouched.
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

// This exact pair also came from the old managed CLAUDE.md template. Do not
// infer that edited instructions or text already in the preserved tail is old.
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

// Line numbers inside fenced code blocks (CommonMark: ``` or ~~~ after at most three spaces, closed by a fence of the
// same character at least as long followed only by spaces or tabs; an unclosed fence runs to the end). Text in a fence
// is a user's example, never generated guidance (cross-model review 2026-09-30, round 3). Round 4: a closer followed
// by other whitespace (a no-break space) does not close the fence, as CommonMark says; trim() had accepted it.
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
// The canonical helpers above and below replace exact old blocks; a copy of any of their lines inside a fence means
// the user quotes the old text, so the file is left as it is and the merge preserves the old lines (round 3).
function quotesLegacyInFence(head, blocks) {
  const lines = head.split('\n'), wanted = new Set();
  for (const block of blocks) for (const l of block.split('\n')) if (l.trim()) wanted.add(l.trim());
  for (const n of fencedLines(lines)) if (wanted.has(lines[n].trim())) return true;
  return false;
}

// Cross-model review 2026-09-30 (T-0314/T-0316 follow-up): development builds wrote the context-reading section and
// the reviewer protocol into CLAUDE.md, the Cursor and Copilot adapters, session-workflow.md and review-checklist.md.
// Those files now point at AGENTS.md, and _managedMerge carried every such line into "Preserved previous content"
// (CLAUDE.md 1,333 -> 4,320 bytes on upgrade). The managed part (the head, above the preserved marker) is dropped only
// when it is exactly a file those builds wrote: its fingerprint is one of GENERATED_LAYOUTS, taken from every build from
// the first that wrote such a section to 1.36.289, in both languages, both modes and each authoring language. Then
// nothing in the head is the user's, the merge writes the new template in its place, and the preserved tail stays.
// Any difference at all (a line added, copied, moved or edited, a fence, a no-break space) and the file goes to the
// merge unchanged, which preserves every line as before, so the failure direction is a larger file. Review rounds 2 to
// 5 found user text deleted by each rule that judged sections by their surroundings: a copy under the user's heading,
// a fenced example, a paragraph added after a section, a copy after a template line, a copied heading and import
// line. Only the exact layout proves provenance. The caller runs this only when the migration backup holds exactly
// this source.
const { GENERATED_LAYOUTS } = require('./retired-guidance-sections');
const PRESERVED_MARKER = '<!-- leerness:migration-preserved -->';
// The head as the merge writes it, compared after normalizing line endings, trailing spaces and tabs, trailing blank
// lines, and the "---" separator _managedMerge puts right before the preserved marker. Shared with the script that
// fingerprints the historical builds, so both sides normalize the same way.
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

// T-0314 (owner decision, 2026-09-29): minimal mode follows this paragraph directly, so its copy omits
// the sentence that sends readers to .leerness/context-routing.md — context budget counts every
// .leerness document AGENTS.md names, and that one reference loaded 1,364 tok into a minimal session.
function entry(lang, opts = {}) {
  const minimal = !!(opts && opts.minimal);
  return lang === 'en'
    ? '\n## Context reading scope\n\nSession-wide start, registration, shared writeback and close below belong to the main session owner. Delegated workers/reviewers reuse the assigned task and current rules; they do not repeat full onboarding or close the parent session. Missing/stale constraints must be retrieved before acting. Read relevant sections, not every listed file in full.'
      + (minimal ? '' : ' See the reading policy at the top of .leerness/context-routing.md; minimal mode follows this paragraph directly.')
      + ' User/project constraints still apply. Completion claims require verify-claim and actual evidence.\n'
    : '\n## 컨텍스트 읽기 범위\n\n아래 세션 시작·작업 등록·공유 기록·마감은 주 세션 담당자의 책임이다. 위임 작업자·검수자는 배정된 작업과 현재 규칙을 재사용하고 전체 시작 절차나 부모 세션 마감을 반복하지 않는다. 누락·오래된 제약은 작업 전에 확인한다. 파일 목록은 관련 부분을 찾는 색인이며 전부 정독하라는 뜻이 아니다.'
      + (minimal ? '' : ' 세부 기준은 .leerness/context-routing.md 앞부분에 있고 최소 모드는 이 문단을 직접 따른다.')
      + ' 사용자·프로젝트 제약은 유지한다. 완료 주장에는 verify-claim과 실제 근거가 필요하다.\n';
}

// T-0314 (owner decision, 2026-09-29): AGENTS.md is the one full copy because Leerness serves several
// agents, not only Claude. CLAUDE.md, the Cursor rule, the Copilot instructions and the session workflow
// point to that section instead of repeating it (each of those files already says to follow AGENTS.md).
// The Codex global adapter keeps the paragraph: it exists for Codex modes that do not read AGENTS.md.
function pointer(lang) {
  return lang === 'en'
    ? '\nContext reading scope (main session owner versus delegated workers and reviewers): follow that section in AGENTS.md.\n'
    : '\n컨텍스트 읽기 범위(주 세션 담당자와 위임 작업자·검수자의 구분)는 AGENTS.md의 같은 절을 따른다.\n';
}

function policy(lang) {
  return lang === 'en' ? `
## Context reading policy

- The main session owner loads workflow/context and active rules once at session start. A follow-up message or compaction is not a new project bootstrap. Reuse available context; refresh changed or missing instructions, rule sources and task records.
- Use \`leerness context current [--task ID]\` for current task navigation and unabridged rules, and \`leerness context budget --files-only\` for document byte sizes without loading history bodies. These views do not replace explicit read instructions, fixed criteria, open findings or evidence. Close refreshes only its marked summary; older unmarked prose remains until a separate reviewed retention operation.
- Before delegation, provide the assigned task ID, role, scope, allowed files, current rule text with IDs/source revision or check time, relevant closed decisions, fixed acceptance criteria, and evidence/source links. A rule count or a statement that rules were loaded is insufficient. Do not omit mandatory constraints to meet a size target.
- Workers start with that packet and the relevant code/contract. Reviewers use the same frozen scope/criteria and independently inspect source, diff and evidence; worker conclusions are not proof. Re-review existing findings and changed evidence, then relevant regression paths. Retrieve missing/stale/contradictory constraints before a dependent action; report what remains unknown.
- Leerness-generated read lists below are an index. Search exact task/rule IDs or headings in named current files, then read bounded sections. Exclude archive, generated copies and history unless the question requires them. If output is truncated, narrow files/query/sections; do not reprint the same document in every chunk. Expand when evidence or a dependency justifies it and retain required rules intact.
- The main owner records shared state and closes the session once. Delegates return findings, actual tests and evidence for their assignment; they neither register duplicate tasks nor mark the parent done. Shared writeback or a separate session lifecycle requires an explicit assignment. Completion claims still require verify-claim and actual required checks.
- Reuse valid scan/test receipts only for the same relevant state and scope. Changed inputs, missing evidence or unresolved failures require the appropriate checks. Capture large scan logs outside the prompt and report counts, blockers and paths; read relevant findings when needed. Compact handoff is navigation, not the full active rules or proof of compliance. These instructions guide reading; they do not enforce model behavior or verify token savings.
` : `
## 컨텍스트 읽기 정책

- 주 세션 담당자는 시작 시 워크플로·현재 상태·활성 룰을 한 번 적재한다. 후속 메시지나 문맥 압축을 프로젝트 시작으로 다시 취급하지 않는다. 이미 받은 문맥은 재사용하고 바뀌거나 누락된 지침·룰 원본·작업 기록만 다시 확인한다.
- \`leerness context current [--task ID]\`로 현재 작업과 규칙 원문을, \`leerness context budget --files-only\`로 이력 본문을 읽지 않고 문서 크기를 확인한다. 명시 읽기 지시·고정 기준·열린 지적·근거는 대체하지 않는다. 마감은 표지가 있는 요약만 갱신하며 표지 없는 과거 원문은 별도 검토한 보관 작업 전까지 유지한다.
- 위임 시 작업 ID·역할·범위·수정 허용 파일·현재 룰 원문과 ID/출처 버전 또는 확인 시점·관련 폐쇄 결정·고정 통과 조건·근거/소스 경로를 전달한다. 룰 개수나 읽었다는 말만으로 대체하지 않는다. 양을 줄이려고 필수 제약을 빼지 않는다.
- 작업자는 전달 내용과 관련 코드/계약부터 읽는다. 검수자는 같은 범위·조건으로 실제 소스·변경분·근거를 독립 확인하며 작업자의 결론을 증거로 간주하지 않는다. 재검수는 기존 지적과 바뀐 근거 및 관련 회귀를 확인한다. 누락·오래됨·모순은 종속 작업 전에 원본을 확인하고 미확인 부분을 보고한다.
- 아래 Leerness 생성 읽기 목록은 색인이다. 현재 파일을 지정해 정확한 작업/룰 ID나 제목을 찾고 필요한 부분만 읽는다. 질문에 필요하지 않은 archive·생성 사본·전체 이력은 제외한다. 출력이 잘리면 파일·검색어·범위를 좁히고 같은 문서를 조각내 전부 다시 출력하지 않는다. 근거·의존성이 있으면 범위를 넓히되 필수 룰 원문은 온전히 유지한다.
- 공유 상태 기록과 세션 마감은 주 담당자가 한 번 수행한다. 위임 에이전트는 담당 작업의 발견·실제 테스트·근거를 반환하고 중복 작업을 등록하거나 부모 작업을 완료 처리하지 않는다. 공유 기록 수정이나 별도 세션 절차는 명시 배정이 있어야 한다. 완료 주장에는 verify-claim과 필요한 실제 검증이 계속 필요하다.
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
  return files;
}

module.exports = { DELEGATED_CONTEXT, COMPACT_RULES, entry, pointer, policy, apply, retireCanonicalLegacyReading, retireCanonicalLegacyClaudeReading, retireCanonicalLegacyAdapterReading, retireGeneratedGuidance, generatedHeadFingerprint };
