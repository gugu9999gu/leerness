# 상호운용성 (Interoperability) — leerness 의 프로토콜 입장

leerness 는 **에이전트도 에디터도 아닌, 에이전트 위의 운영 레이어**다. 이 위치가 각 프로토콜에 대한 입장을 결정한다.

## 지원 표면 (구현됨)

| 표면 | 형태 | 용도 |
|---|---|---|
| **CLI** | 명령줄 | 모든 에이전트/사람의 기본 진입점 |
| **MCP** (`leerness mcp serve`) | stdio JSON-RPC, 86 도구 | 외부 AI 가 자연어→도구 호출로 직접 사용. `adapter <tool>` 이 `.mcp.json` 자동 병합 |
| **`.leerness/` state substrate** | 파일(JSON) | 에이전트 간 인수인계 표준 — Claude Code 가 한 작업을 Codex/Goose 가 이어받음. 오프라인·0-deps |
| **지침 계층** | AGENTS.md / CLAUDE.md / 전역 조건부(`adapter codex --global`) | 문서를 읽는 에이전트 대상 협조 계층 |
| **강제 계층** | `enforce`(pre-commit) + `ci init`(gate) | **프로토콜 무관** — 어떤 방식으로 붙은 에이전트든 커밋/PR 관문에서 검증 |

## ACP — Agent Client Protocol (Zed 계열, 에디터↔에이전트)

**입장: 직접 구현하지 않는다 (고려 후 결정, 2026-07).**

- ACP 의 토폴로지는 에디터(클라이언트) ↔ 코딩 에이전트(서버)다. leerness 는 그 어느 쪽도 아니므로 ACP 서버/클라이언트를 구현할 구조적 자리가 없다.
- **간접 호환은 이미 성립**: ACP 로 에디터에 붙는 에이전트(Claude Code ACP 어댑터, Gemini CLI 등)는 도구 계층으로 MCP 를 사용한다 → 프로젝트의 `.mcp.json`(leerness adapter 가 병합)을 통해 leerness 86 도구에 그대로 접근한다.
- **강제는 이미 커버**: pre-commit enforce 는 접속 프로토콜과 무관하게 작동한다(커밋이 보편 관문).
- 재검토 트리거: ACP 가 에이전트-측 도구 계층으로 MCP 외 자체 도구 규격을 강제하게 되는 경우.

## ACP — Agent Communication Protocol (BeeAI/Linux Foundation, 에이전트↔에이전트 REST)

**입장: 채택하지 않는다.**

- 서버 상주형 REST 는 leerness 의 오프라인-퍼스트·0-deps·plain-files 원칙과 충돌한다.
- 같은 문제(에이전트 간 인수인계)는 `.leerness/` substrate 가 파일 기반으로 해결한다 — 리포에 남고, 네트워크가 없어도 동작하며, 어떤 에이전트든 읽을 수 있다.

## 요약

새 프로토콜 평가 기준: **(1) leerness 의 역할(운영 레이어)에 자리가 있는가, (2) MCP/파일 substrate 로 이미 닿는가, (3) 오프라인·0-deps 원칙과 정합한가.** ACP 두 종 모두 (2)에서 이미 충족되거나 (3)에서 탈락한다 — 상태 변화 시 이 문서를 갱신한다.
