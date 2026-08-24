'use strict';
// 1.36.129 (UR-0068 / P-0016 P1): 같은 프로젝트를 동시에 만지는 AI 세션이 서로를 **알아채게** 한다.
//   P1 은 '프레즌스 기록'만 한다 — 라이브니스 판정도, 차단도 하지 않는다. 그 경계는 실측에서 나왔다:
//
//   ① PID 라이브니스는 **양방향으로 틀린다**(이 머신 실측): 5초에 짧은 node 120개를 띄우자 PID 재사용 7건,
//      종료가 확인된 58개 중 3개(5.2%)가 `process.kill(pid,0)` 에 ALIVE, `kill(0,0)`=ALIVE, `kill(4,0)`=EPERM.
//      → pid 를 **기록조차 하지 않는다**. "활성/active" 라는 단어를 어떤 출력에도 쓰지 않는다.
//   ② 신선도 창(N분 이내면 활성)도 두지 않는다. 데몬이 없어 하트비트는 사람이 handoff 를 부를 때만 뛴다
//      (이 저장소 기준선: 4일에 10건). N 을 작게 잡으면 산 세션이 사라지고, 크게 잡으면 죽은 세션이 살아 보인다.
//   ③ PPID/TTY/cwd 추론 금지 — Git Bash 에서 node 의 ppid 가 같은 세션 안에서도 매 명령 달랐다(51096/46108/49256).
//      에이전트가 준 세션 id 가 없으면 **등록하지 않고, 그렇다고 말한다**.
//
//   이 모듈은 순수 함수만 담는다(스폰·IO 없음) — 가드가 자기 소스를 읽지 않고 행위로 검증할 수 있게.

const SESSIONS_KEEP = 20;                              // 임의의 수 — 아래 주석 참조
const SESSIONS_CLOSED_TTL_MS = 7 * 24 * 3600 * 1000;   // 임의의 수 — 아래 주석 참조
//   ⚠ 두 값은 **임의**다. 측정으로 유도한 것은 "상한이 있어야 한다" 는 사실뿐이고, 그 근거는 실측이다 —
//     이 저장소의 `.harness/runs/` 는 프루닝이 없어 909개 파일까지 자랐다. 값 자체는 근거가 없으므로 그렇게 적는다.

const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const FILE_RE = /^[A-Za-z0-9_-]{8,64}\.json$/;
// 내부 anonymous 슬롯과 사용자 세션 주소는 같은 파일명을 공유하면 안 된다.
// 대소문자를 접은 뒤 예약어를 거부해 `UNADDRESSED` 도 익명 marker 와 충돌하지 않게 한다.
const RESERVED_KEYS = new Set(['unaddressed']);
// 자체 점검이 쓰는 격리 marker는 실제 세션 주소가 될 수 없어야 한다. 그렇지 않으면 enforce install이
// 같은 주소의 실제 handoff를 저장/복원 사이에 되돌려 버릴 수 있다.
const RESERVED_PREFIXES = ['leerness-internal-'];
function isValidKey(s) {
  if (typeof s !== 'string' || !KEY_RE.test(s)) return false;
  const folded = s.toLowerCase();
  return !RESERVED_KEYS.has(folded) && !RESERVED_PREFIXES.some(prefix => folded.startsWith(prefix));
}
// env 값의 참/거짓 — CI 계열은 `"false"`/`"0"` 을 **명시적으로** 넘기는 환경이 흔하다.
function isTruthyEnv(v) {
  const t = String(v == null ? '' : v).trim().toLowerCase();
  return t !== '' && t !== '0' && t !== 'false' && t !== 'no' && t !== 'off';
}

// 증거로 **절대 쓰지 않는** 키 — 전부 실측된 오라벨 원인이다.
//   CODEX_COMPANION_* / CLAUDE_PLUGIN_DATA : Claude Code **플러그인**이 심는다(이 세션에 실재하며 값이
//     CLAUDE_CODE_SESSION_ID 와 같다). "CODEX_* 있으면 codex" 규칙은 즉발 오라벨이다.
//   TERM_PROGRAM : Cursor 와 Windsurf 가 번들에서 `vscode` 를 **바이트 동일**하게 하드코딩한다 — 원리적으로 못 가른다.
//   ANTHROPIC_BASE_URL : grok/kimi/glm 은 대개 base URL 만 바꾼 Claude Code 라 프로세스로는 claude 다.
//     게다가 엔드포인트를 `.harness` 에 적으면 시크릿 인접 값을 파일로 남기는 **새 유출 표면**이 생긴다.
const FORBIDDEN_SIGNALS = ['CODEX_COMPANION_SESSION_ID', 'CODEX_COMPANION_TRANSCRIPT_PATH',
  'CLAUDE_PLUGIN_DATA', 'TERM_PROGRAM', 'VSCODE_PID', 'VSCODE_IPC_HOOK', 'ELECTRON_RUN_AS_NODE',
  'ANTHROPIC_BASE_URL', 'AI_AGENT'];

// 세션 키: 에이전트가 **스스로 준 id** 만 쓴다. 자식 세션은 부모 키로 접는다(가짜 두 번째 세션 방지).
// 1.36.132 (UR-0069, 검수 fatal #1): 종전엔 키가 `CLAUDE_CODE_*` 에서만 나왔다 — 즉 **claude 세션만**
//   레지스트리에 등록되고 codex·cursor·vscode·grok·kimi·glm 은 남을 보기만 하는 **단방향 거울**이었다.
//   실측: codex 형태 env 로 `handoff` → 레코드 파일 증가 0, `selfRecordPresent=false`. 그런데 같은 실행이
//   "다른 세션 기록 2건" 은 출력한다. 사용자가 든 예시("codex 가 claude 에게 작업범위 전달")가 구조적으로 불가능했다.
//   → 에이전트 무관한 **명시 주소**를 받는다. 세션마다 다른 값을 주면 그 세션이 곧 주소가 된다.
//   명시값을 앞에 둔다(사용자가 일부러 준 것이 추론보다 우선). child 억제는 그대로 — sub-agent 등록은 실측으로 기각됐다.
//   `CODEX_THREAD_ID` 는 **설정 없이** 이미 거기 있다 — codex-cli 0.147.0 실측: 소문자 UUIDv7 36자,
//   한 세션의 여러 자식 호출에서 바이트 동일, 세션이 바뀌면 값이 바뀐다(01a01570-54a6-… vs 01a01570-b228-…),
//   기존 KEY_RE 를 변환 없이 통과. 순서상 CLAUDE_* 뒤에 둔다 — claude 가 띄운 codex 는 CLAUDE 변수를 통째로
//   물려받으므로(실측) 부모 세션으로 접히는 지금 동작을 유지한다. 독립 실행 codex 만 자기 주소를 얻는다.
const KEY_SOURCES = ['LEERNESS_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID'];
function keySource(env) {
  const e = env || {};
  // 1.36.148 (재검수 P1, 재현): child 억제가 **명시 주소보다 앞**에 있어,
  //   MCP 서버가 `CLAUDE_CODE_CHILD_SESSION=1` 을 상속하면 호출별 `sessionKey` 가 통째로 버려졌다
  //   — 1.36.145 에서 넣은 주소 전달이 조용히 무력화되고 전역 슬롯 오귀속이 돌아온다.
  //   이 파일의 주석은 이미 "명시값을 앞에 둔다(사용자가 일부러 준 것이 추론보다 우선)" 라고
  //   적어 두었는데 **구현이 그 원칙과 반대**였다. 명시 주소를 먼저 본다.
  //   (추론 경로에는 child 억제를 그대로 둔다 — sub-agent 가 별도 세션으로 등록되는 것은 실측으로 기각됐다.)
  if (isValidKey(e.LEERNESS_SESSION_ID)) return 'LEERNESS_SESSION_ID';
  if (e.CLAUDE_CODE_CHILD_SESSION === '1') return null;
  for (const k of KEY_SOURCES) if (isValidKey(e[k])) return k;
  return null;
}
// 1.36.132 (검수 P1, 재현): NTFS 는 파일명을 대소문자 비구분으로 다루는데 키 비교는 구분했다 —
//   `CaseKey01ABCD` 와 `casekey01abcd` 가 **다른 주소인 척하다가 같은 파일 하나로 조용히 병합**됐다(실측 2→1).
//   주소를 소문자로 접어 **하나의 규칙**으로 만든다: 같은 글자면 같은 주소다(그리고 파일명과 항상 일치한다).
function deriveSessionKey(env) {
  const src = keySource(env);
  return src ? String((env || {})[src]).toLowerCase() : null;
}
// 1.36.132 (검수 P1): 사용자가 **명시한** 주소가 형식에 안 맞으면 조용히 다음 출처로 넘어갔다 —
//   오타를 알리지 않고 설정을 뒤집는 것이다. 무엇이 왜 무시됐는지 말할 수 있게 사유를 돌려준다.
function invalidExplicitKey(env) {
  const v = (env || {}).LEERNESS_SESSION_ID;
  if (v === undefined || v === null || v === '') return null;
  return isValidKey(v) ? null : String(v).slice(0, 40);
}

// 필드명이 `agent` 가 아니라 `outermostAgent` 인 이유(실측): codex 가 직접 띄운 pwsh 가 `CLAUDECODE=1` 을
//   보고했다 — codex 가 부모 env 를 통째로 물려주고, 그 codex 자신이 Claude 세션에서 시작됐기 때문이다.
//   env 가 가리키는 것은 **체인의 최외곽**이다. 이름을 그렇게 붙이면 그 라벨은 참이 된다.
function detectOutermostAgent(env) {
  const e = env || {};
  if (e.CLAUDECODE === '1') return { agent: 'claude-code', evidence: ['CLAUDECODE'] };
  if (!e.CLAUDECODE) {
    for (const k of ['CODEX_MANAGED_BY_NPM', 'CODEX_MANAGED_BY_PNPM', 'CODEX_MANAGED_BY_BUN']) {
      if (e[k] === '1') return { agent: 'codex-cli', evidence: [k] };
    }
    if (e.CODEX_INTERNAL_ORIGINATOR_OVERRIDE) return { agent: 'codex', evidence: ['CODEX_INTERNAL_ORIGINATOR_OVERRIDE'] };
  }
  //   ⚠ (검수 P2) cursor 는 **런타임 관측이 없다** — 번들 소스에서 문자열만 봤다.
  //     "관측 후에만 승격" 이라 적어 놓고 라벨을 확정하면 그 원칙이 스스로 무너진다. 관측 전에는 unknown 이다.
  //     증거 키는 남긴다 — 나중에 실제 관측이 생기면 그때 승격한다(원자료는 보존).
  if (e.CURSOR_AGENT === '1') return { agent: 'unknown', evidence: ['CURSOR_AGENT'] };
  // 증거가 없으면 unknown 이다. unknown 은 부끄러운 값이 아니라 정상 출력이다 —
  //   실측상 7종 중 확실 식별은 1종(claude-code)뿐이고, 적극적으로 틀릴 수 있었던 것이 1종(codex)이다.
  return { agent: 'unknown', evidence: [] };
}

// 억제 판정은 **한 곳**에서 한다. 호출부마다 조건을 복붙하면 새 호출부가 빠진다(1.36.108 이 고친 형태).
function suppressionReason(env, hasHarness) {
  const e = env || {};
  if (e.LEERNESS_INTERNAL === '1') return 'internal';        // leerness 가 자기를 스폰하는 20여 지점
  if (e.LEERNESS_HOOK === '1') return 'hook';
  if (e.CLAUDE_CODE_CHILD_SESSION === '1') return 'child-agent';
  //   ⚠ (검수 P2, 실측 재현) `e.CI` 만 보면 `CI="false"`·`CI="0"` 도 억제했다 —
  //     명시적으로 '아니다' 라고 말한 정상 로컬 환경이 조용히 등록되지 않는다. **참인 값만** 본다.
  if (isTruthyEnv(e.CI) || isTruthyEnv(e.GITHUB_ACTIONS)) return 'ci';
  if (e.LEERNESS_NO_SESSION_PRESENCE === '1') return 'opt-out';
  if (!hasHarness) return 'not-a-leerness-project';
  if (!deriveSessionKey(e)) return 'not-identifiable';
  return null;
}

// 프루닝: 입력은 `{ name, record }` 목록이고 **반환은 지울 파일명**이다.
//   ⚠ (검수 P2, 실측 재현) 예전엔 레코드의 `sessionKey` 를 돌려줬는데, **파일명과 키가 어긋난 레코드**
//     하나(손상·위조)가 있으면 프루너가 **엉뚱한 파일**을 지웠다(fakefake.json 이 victimxx.json 을 지움).
//   ⚠ 자기 파일은 절대 지우지 않는다(방금 쓴 것을 지우면 안 된다).
function selectPrunable(records, opts) {
  const o = opts || {};
  const keep = Number.isFinite(o.keep) ? o.keep : SESSIONS_KEEP;
  const ttl = Number.isFinite(o.closedTtlMs) ? o.closedTtlMs : SESSIONS_CLOSED_TTL_MS;
  const nowMs = Number.isFinite(o.nowMs) ? o.nowMs : 0;
  const selfKey = o.selfKey || null;
  const list = (records || []).filter(e => e && typeof e.name === 'string' && FILE_RE.test(e.name));
  const keyOf = (e) => String(e.name).replace(/\.json$/, '');
  const trusted = list.filter(e => e.record && e.record.sessionKey === keyOf(e));
  const doomed = new Set();
  //   이름과 키가 어긋난 것은 **그 파일만** 정리 후보로 본다(그 레코드의 말을 믿고 남을 지우지 않는다).
  for (const e of list) { if (!trusted.includes(e) && keyOf(e) !== selfKey) doomed.add(e.name); }
  for (const e of trusted) {
    if (keyOf(e) === selfKey) continue;
    const c = Date.parse((e.record && e.record.closedAt) || '');
    if (Number.isFinite(c) && nowMs && (nowMs - c) > ttl) doomed.add(e.name);
  }
  const alive = trusted.filter(e => !doomed.has(e.name));
  //   ⚠ (검수 P2, 실측 재현) `openedAt` 만으로 줄 세우면 **오래 열려 있었지만 방금 handoff 한 세션**이
  //     상한 밖으로 밀려 삭제됐다. 지키려는 것은 '최근에 살아 있던 기록' 이므로 최근 활동을 함께 본다.
  const activity = (e) => Math.max(Date.parse((e.record && e.record.lastHandoffAt) || '') || 0,
    Date.parse((e.record && e.record.openedAt) || '') || 0);
  const ranked = alive.slice().sort((a, b) => activity(b) - activity(a));
  for (const e of ranked.slice(keep)) { if (keyOf(e) !== selfKey) doomed.add(e.name); }
  return [...doomed];
}

// 헤드라인은 **0이면 침묵**한다. "다른 세션 0건" 은 '아무도 없다' 로 읽히는데, 이 레지스트리는
//   (a) handoff 를 안 부르는 에이전트 (b) 업그레이드 전에 시작된 세션 (c) 다른 머신 (d) MCP 전용 클라이언트를
//   **구조적으로 못 본다**. 못 본 것을 없다고 단언하지 않는다.
//   ⚠ hostId 를 모르면(둘 중 하나가 null) '같은 머신' 이라고도 '다른 머신' 이라고도 하지 않는다 — 세지 않는다.
function countOtherSessions(records, selfKey, selfHostId) {
  return (records || []).filter(r => r && isValidKey(r.sessionKey)
    && r.sessionKey !== selfKey
    && r.hostId && selfHostId && r.hostId === selfHostId
    && !r.closedAt).length;
}

// 같은 머신인지 **모를 수 있다** — 3상태로 답한다(검수 P2: null 을 '다른 머신' 으로 단정했다).
function hostRelation(recordHostId, selfHostId) {
  if (!recordHostId || !selfHostId) return 'unknown';
  return recordHostId === selfHostId ? 'same' : 'different';
}

module.exports = {
  KEY_SOURCES, keySource, invalidExplicitKey,
  SESSIONS_KEEP, SESSIONS_CLOSED_TTL_MS, KEY_RE, FILE_RE, RESERVED_KEYS, RESERVED_PREFIXES, FORBIDDEN_SIGNALS,
  isValidKey, isTruthyEnv, deriveSessionKey, detectOutermostAgent, suppressionReason,
  selectPrunable, countOtherSessions, hostRelation,
};
