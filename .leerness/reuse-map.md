---
leernessRole: reuse-map
readWhen:
  - 새 컴포넌트/API/helper 생성 전
  - 중복 기능 감지
updateWhen:
  - 재사용 가능한 요소 추가
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Reuse Map

| Capability | Existing Element | Reuse Method | Notes |
|---|---|---|---|
| Project workspace 판별/호환 migration | lib/workspace-dir.js: inspectWorkspace, resolveWorkspaceDirName, workspacePath | 기존 Project scope 유지; 신규 read-only Git scope resolver의 경계에서 참조 | marker/foreign 판별 및 .harness migration을 자동 우회하지 않음 |
| 안전한 Git 실행 | lib/git.js: gitSpawn | private/common/worktree 경로 조회를 동일 gateway로 호출 | 위치 환경변수 격리, shell false, optional index lock 억제 |
| 5-scope 경로/진단 | lib/state-paths.js, state-git.js, state-inventory.js, state-inspect.js | resolveStatePaths/inspectState를 future StateManager와 adapter에서 재사용 | proposal-only; snapshot selector 공유, 1 Git query, 고정 metadata 목록, 무쓰기. runtime migration은 미구현 |
| 세션 identity와 freshness 관측 | lib/session-presence.js: deriveSessionKey, normalizePresenceEnv, hasConfirmedClose | worktree runtime의 session namespace에 재사용 | heartbeat나 process liveness 증명으로 확대하지 않음 |
| 물리 파일 TTL lease | lib/file-leases.js: resolveTarget, normalizeTtlSeconds | 같은 도메인의 containment/identity/TTL 규율 재사용 | repository task claim과 분리; store 경로만 common으로 옮기지 않음 |
| 원본 보존 I/O | lib/io.js: writeUtf8, writeBufferIfUnchanged, assertWriteAllowed | 검증된 writer 경계에서 재사용 | writeBufferIfUnchanged는 Windows 전용이며 POSIX는 거부. assertWriteAllowed는 dry-run과 현재 runtime operation을 검사하며 Windows replacement 각 시도 직전에도 호출. portable CAS/immutable create-only/다중 파일 transaction은 별도 계약 필요 |
| 로컬 writer 직렬화 | bin/leerness.js: _withLock | 동일 canonical 대상 writer gateway 유지; 필요 시 좁은 모듈 추출 | TTL takeover나 분산 fencing을 제공한다고 주장하지 않음 |
| Role/Agent/Routing schema | lib/role-agent-schema.js | 순수 validation 및 legacy 양방향 projection | v2 runtime 자동 활성화 금지 |
| Bounded fail-closed role store | lib/role-store.js | strict decoder와 revision 확인 패턴 참조 | 다른 store의 schema를 role schema로 강제하지 않음 |
| Execution/review provenance | lib/role-fallback.js | resolver/store/availability revision과 actual executor 및 독립성 계약 재사용 | ignored ledger를 durable record로 간주하지 않음 |
| Legacy memory adapter | bin/leerness.js: _loadDecisions, _saveDecisions, _loadLessons, _saveLessons | JSON/Markdown parser와 renderer를 strict source selection 뒤 재사용 | 현재 loader는 invalid JSON에서 Markdown fallback; migration에서 그대로 재사용 금지, invalid는 중단·원본 보존 |
| Generated current-state 보존 | lib/session-close.js: _upsertAutoLines | 사용자 비표식 원문 보존 원칙과 회귀 유지 | 신규 generated-only 경로로 옮기기 전 사용자 문장 archive 검증 |
| CLI/MCP 공통 표면 | bin/leerness.js, lib/mcp-tools.js | State API 위의 얇은 adapter로 단계적으로 연결 | 이름만 같은 별도 상태 구현 생성 금지 |
| Runtime migration 사전 호환 reader | lib/runtime-layout.js: createRuntimeCompatibilityReader, inspectRuntimeCompatibility | 고정 Git/non-Git authority의 strict 16KiB reader; immutable topology snapshot 재사용 | P-0021 승인 후 구현·통합검증 중. workspace 소유 판별은 operation 시작, descriptor/indicator/identity는 매 검사 갱신. 데이터 이동·활성화 없음 |
| Runtime writer operation | lib/runtime-writes.js: withRuntimeWrites, projectWriter, pathWriter | CLI/MCP/REPL 및 direct writer가 공유하는 operation-local 오류 latch와 실제 mutation 경계 | 예외를 삼켜도 성공으로 반환하지 않음. 동기 FS interception은 명시적 writer 안에서만 활성; arbitrary project 파일은 명시 root 필요. 구버전/외부 writer fencing 아님 |
