> **English version: [README.md](./README.md)** — 영어권 우선 정책에 따라 첫 화면은 영문이며, 이 문서가 한국어 전문입니다.

# leerness

**2.0.0 주요 호환성 변경:** 일반 handoff 조회는 세션을 기록하지 않으며 기본 JSON은 진단 필드를 생략할 수 있고 `doctor.healthy`는 null일 수 있습니다. 기존 1.x 연동은 [전환 안내](docs/lean-readonly-compatibility.md)와 [2.0.0 변경 안내](docs/release-notes-2.0.0.md)를 확인해야 합니다. 소스나 후보 버전은 공개 배포의 증거가 아닙니다. [설치·업데이트·롤백 안내](docs/release-candidate-guide.md)에 따라 승인된 파일과 실제 레지스트리 버전을 확인하세요.

```
██╗     ███████╗███████╗██████╗ ███╗   ██╗███████╗███████╗
██║     ██╔════╝██╔════╝██╔══██╗████╗  ██║██╔════╝██╔════╝
██║     █████╗  █████╗  ██████╔╝██╔██╗ ██║█████╗  ███████╗
██║     ██╔══╝  ██╔══╝  ██╔══██╗██║╚██╗██║██╔══╝  ╚════██║
███████╗███████╗███████╗██║  ██║██║ ╚████║███████╗███████║
╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝
```

> **어떤 언어, 어떤 AI 에이전트로 작업하든 — "증거 없이는 끝났다고 말할 수 없게" 만드는 AI 코딩 운영 레이어.** 코드를 대신 쓰는 도구가 아니라, AI 에이전트의 **기억·인수인계·검증·감사·보안 가드**를 프로젝트에 영속화하는 CLI + MCP 서버입니다.

[![npm](https://img.shields.io/npm/v/leerness)](https://www.npmjs.com/package/leerness) · ![MCP tools](https://img.shields.io/badge/MCP--tools-104-blue) · **런타임 의존성 0** · **install-script 0** · offline-first · Node ≥ 18 · MIT

**2.0.0은 미공개 후보(UNRELEASED)입니다.** 2026-11-08 확인한 공개 릴리스는 **1.36.305**입니다. 소스 버전이나 로컬 tarball은 공개 배포·릴리스 승인의 증거가 아니며, 기존 1.36.305 사용자가 이 후보를 설치할 필요는 없습니다.

2.0 후보는 일반 handoff의 세션 기록·환경 진단을 기본 실행에서 제외하고, 기본 JSON의 진단 필드를 생략할 수 있으며, `doctor.healthy`가 `null`일 수 있습니다. 훅·JSON 연동을 바꾸기 전에 [2.0.0 호환성·업그레이드·롤백 안내](docs/release-notes-2.0.0.md)를 확인하세요. 패키지 설치만으로 기존 지침이나 프로젝트 데이터가 모두 마이그레이션·복원되지는 않습니다.

---

## leerness가 뭔가요?

AI 코딩 에이전트(Claude Code, Cursor, Codex, Aider, Goose 등)는 코드를 잘 쓰지만 세 가지 약점이 있습니다.

1. **기억하지 못합니다** — 세션이 바뀌면 현재 상태·결정·다음 작업을 잊습니다.
2. **거짓 완료를 선언합니다** — 증거(파일·테스트·로그) 없이 "완료했습니다"라고 말합니다.
3. **표준이 없습니다** — 여러 에이전트 간 인수인계, 보안/인코딩 점검, 드리프트 관리가 제각각입니다.

leerness는 이 문제들을 해결하는 **외부 운영 substrate**입니다. 어떤 에이전트 위에도 얹어, 프로젝트의 상태를 `.leerness/` 파일로 영속화하고 CLI · MCP 도구로 노출합니다. 기본 상태에서는 외부 모델을 임의 호출하지 않습니다. 다만 사용자가 `agents multi --execute`, `agents bench` 같은 실행 명령을 명시하면 opt-in 된 외부 CLI를 시작하고 실제 실행 결과를 원장에 기록할 수 있습니다.

---

## 해결하는 문제

| 문제 | leerness의 해법 |
|---|---|
| 세션 간 맥락·결정·다음 작업 유실 | `task`/`decision`/`lesson`/`plan`/`rule` 메모리를 영속화하고, 세션 시작 시 `handoff` 1콜로 회수 |
| 증거 없는 "완료" 주장 | `verify-claim --require-evidence`, `lazy detect`, anti-lazy 정책으로 차단 |
| Claude → Codex → Cursor 교체 시 맥락 소실 | 필요할 때 handoff 조회와 session close 기록을 선택해 에이전트 독립 인수인계 |
| 하드코딩 시크릿 · 인코딩 깨짐(BOM/CP949) | `scan secrets`, `encoding check` 자동 감지 (CI 게이트) |
| 워크스페이스 노화(drift)를 에이전트가 모름 | `drift check [--auto-fix]` 점수화 + 자동 회복 |
| 명세 ↔ 구현 불일치 | `contract verify spec.md impl.js` 함수/필드 일치 검사 |
| 여러 AI CLI의 역할/분배 표준 부재 | `agents`/`roles`/`team` 오케스트레이션(기본 opt-in, dispatch는 실행이 아닌 명령 생성) |

---

## 도입 부담이 낮은 설계

MIT, **런타임 의존성 0**, offline-first, 모든 상태가 *당신의* 저장소 안 평문 파일입니다. lock-in 이 거의 없어 — 값을 못 하면 도구만 빼도 `task`/`decision`/`lesson` 파일은 그대로 남습니다. CI 에서는 **버전을 핀**하세요 — 조용한 업그레이드로 게이트 판정이 바뀌지 않습니다. (시크릿은 gitleaks/trufflehog 같은 전용 스캐너와 병행하세요 — `scan secrets` 는 에이전트가 로컬에서 보는 것과 같은 신호를 주는 편의 레이어입니다.)

---

## 빠른 시작

아래 설치 예시는 공개 1.36.305를 지정하며 미공개 2.0 후보를 설치하지 않습니다. 버전을 생략한 npm/npx도 공개 패키지를 선택합니다. 이후 명령은 용도별 예시로, 모두 실행해야 하는 기본 절차가 아닙니다. 실제 사용자·프로젝트 규칙을 우선합니다.

```bash
# 공개 버전 설치 (런타임 의존성 0 — 추가 패키지 없음)
npm install -g leerness@1.36.305

# 프로젝트 초기화 (.leerness/ 거버넌스 문서 + .claude/.cursor/.github 어댑터 생성)
leerness init .

# 맥락이 필요할 때 조회 — 기록·진단 효과는 선택한 버전에 따라 다름
leerness handoff .

#   ... 에이전트가 작업 ...
leerness task add "사용자 인증 API 구현"
leerness gate .                 # verify + audit + scan secrets + encoding + lazy 통합 게이트

# 마감·인수인계 기록이 필요할 때 명시적으로 실행
leerness session close .
```

2.0 후보의 일반 `handoff`, `handoff --compact`, `handoff --json`은 저장된 맥락을 읽으며 세션·freshness 기록, 환경/provider 목록 조회, 자동 워크스페이스 마이그레이션을 수행하지 않습니다. Leerness 캐시가 없는 첫 조회에도 같지만 실행 시간 보장은 아닙니다. 세션 존재·freshness 영수증이 필요하면 `--record`, 진단은 `--inspect`, 구형 자동화의 상태 갱신은 `--writeback`을 명시하세요. `--no-record`는 기록 요청을 억제합니다. 조회만 한 세션은 다른 세션에게 보이지 않으므로 빈 목록이 다른 작업자의 부재를 뜻하지 않습니다. [정확한 옵션 효과와 읽기 한계](docs/lean-readonly.md)를 확인하세요.

기존 `.harness/`는 2.0 후보의 일반 관측 명령에서 그대로 유지되며, 상태를 쓰는 명령은 기존 워크스페이스 전환을 일으킬 수 있습니다. 먼저 원본 전체를 보존한 격리 복사본에서 `leerness migrate-workspace-dir <project-copy> --dry-run`으로 확인하고, 명시적으로 전환하기로 선택한 경우에만 `--dry-run`을 빼세요. canonical 복사와 해시 검증이 모두 끝난 뒤에만 레거시 원본 트리를 ignored `.leerness-backup/`으로 원자적 이동해 바이트 단위로 보존하고, 기존 `.leerness/` 구조화 상태 substrate도 유지합니다. 구형 관측 run은 `.leerness/cache/agent-runs/`로 분리하고 실제 경로 참조만 갱신합니다. 두 디렉터리에 독립적인 live 상태가 있거나 백업 이름이 이미 존재하거나 링크/junction이 프로젝트 밖을 가리키면 자동 병합하지 않고 차단합니다. 경로처럼 보이는 일반 명령 본문은 마이그레이션 대상으로 해석하지 않습니다. 숨김·미추적 파일, 지침과 기존 백업도 보존하세요. 패키지 롤백과 데이터 복원은 별개입니다. [원본 보존·복구 절차](docs/release-notes-2.0.0.md#upgrade-with-originals-preserved)를 따르세요.

Cursor용 `leerness adapter cursor --path .`는 기존 project hook을 보존하면서 호스트 세션 주소를 `LEERNESS_SESSION_ID`로 전달하는 로컬 `sessionStart` 브리지를 생성합니다. 실제 설치한 에디터에서 훅 실행과 규칙 적용 범위를 확인한 뒤 사용하세요. 호스트가 세션 식별자를 제공하지 않으면 명시적으로 전달하고, 2.0 후보에서 영수증이 필요하면 `handoff --record`를 요청하세요.

2.0 후보의 새 canonical AGENTS/CLAUDE/Cursor/Copilot 지침은 호스트 에이전트의 계획·테스트 도구를 재사용하고, 필요한 Leerness 명령만 선택하도록 안내합니다. 기존 사용자 지침·보존 원문·활성 규칙을 임의로 완화하지 않습니다. 실제 프로젝트 갱신은 복사본에서 검토하고 명시적으로 적용하세요. 진단 통과는 작업 완료나 배포 승인이 아니며, 공개 게시·배포는 실제 소유자 승인 요건을 따릅니다.

---

## 거짓 완료 차단 — 핵심 차별점

세 모델의 블라인드 리뷰가 공통으로 꼽은 leerness의 핵심 가치입니다. AI 에이전트가 가장 자주 하는 거짓말 "다 했어요"를, leerness는 **완료 주장을 실제 코드와 대조**해 검증합니다.

```bash
# 에이전트가 "결제 API 연동 완료"라고 주장하지만 코드엔 호출 흔적이 없으면:
leerness verify-claim T-0001 --require-evidence
#   ⚠ FAIL (낙관 1) · [Payment] 결제: evidence에 주장 있으나 코드에 호출 흔적 없음 → exit 1
```

- `optimism-check` · `verify-claim` — evidence의 도메인 주장(API·DB·결제·이메일·큐·캐시·알림·스토리지 등 10종)을 실제 소스 호출과 대조. **JavaScript뿐 아니라 Python·Ruby·Go·C#·Java·PHP·Rust 구현도 인식**합니다(1.13).

`verify-claim`의 통과는 적용된 증거 검사 통과이며 요구사항의 의미적 정확성 보장이 아닙니다. 단건 `--json`의 `evidenceLevel: "executed"`에는 실패한 실행도 포함되고 `semanticVerified`는 항상 `false`입니다. `--run-tests`를 지정해도 명령이 없거나 차단되면 실행을 건너뜁니다. `ok`·`reasons`·`run.skipped`·`run.allPassed`를 함께 확인하세요. [검증 결과 해석 및 실행 예제](docs/verification-evidence.md)를 참고하세요.
- `lazy detect` — 증거 없는 done, 빈 handoff, 테스트 미실행, 미추적 TODO를 탐지.
- 정직한 완료는 통과하고 가짜 완료만 exit 1로 차단 — `gate` 또는 CI에 그대로 연결됩니다.

---

## 핵심 개념 — 5계층

- **기억(Memory)** — `task`/`plan`/`decision`/`lesson`/`rule`/`feature`(그래프). canonical JSON 을 단일 진실소스로 저장하고 마크다운은 projection. archive/restore 지원.
- **인수인계(Handoff)** — `handoff`(세션 시작 컨텍스트), `session close`(마감 보고). 에이전트 교체에도 맥락 보존.
- **검증(Verification)** — `verify-claim`(증거 강제), `contract verify`(명세↔구현), `verify-code`(테스트/빌드 실행 + 증거 기록).
- **감사(Audit)** — `scan secrets`, `encoding check`, `lazy detect`, `drift check`, `audit`, 그리고 이를 묶는 `gate`.
- **정책/보안(Policy)** — 8단계 권한 등급 enforce, 외부 에이전트 opt-in, 자연어 영구 룰(`rule add ... --trigger`).

---

## 명령 카테고리

- **초기화/진단**: `init` · `status` · `which` · `doctor` · `selftest` · `capabilities`
- **메모리**: `task` · `plan` · `decision` · `lesson` · `rule` · `feature` · `memory status/search`
- **인수인계/세션**: `handoff` · `session close` · `pulse` · `health`
- **검증/감사**: `check` · `gate` · `audit` · `drift check` · `lazy detect` · `scan secrets` · `encoding check` · `verify-code` · `verify-claim` · `contract verify`
- **외부 에이전트**: `agents list/check/quota/resolve/fallback/availability/record/history/dispatch` · `provider` · `roles` · `adapter`
- **운영/확장**: `release` · `migrate` · `team` · `install-safety` · `route` · `review`(페르소나)
- **브리지(opt-in)**: `web`(playwright) · `pc`(robotjs) · `lsp`
- **개발 브랜치의 미게시 추가 기능**: `review-checkpoint assess --stdin` 및 `leerness_review_checkpoint`로 검수 묶음을 읽기 전용 판정합니다. 모델 호출·검수 승인·상태 저장은 하지 않습니다. [입출력 계약](docs/review-checkpoint-transport.md).
- **미게시 스냅샷 비교**: `review-snapshot candidate|compare --stdin` 및 `leerness_review_snapshot`으로 전달된 스냅샷 결박 정보를 식별·비교합니다. 실제 소스 조회·저장·모델 호출·검수 승인은 하지 않습니다. [입출력 계약](docs/review-snapshot-transport.md).

- **MCP**: `mcp serve` — stdio JSON-RPC 서버로 104개 도구 노출 (verify-claim --all 일괄 검증 포함)

전체 명령은 `leerness commands` 또는 `leerness --help` 로 확인하세요.

> **경로 규칙** — 대부분 명령은 `[path]` 위치 인자를 받습니다. `task`/`decision`/`lesson` 등 메모리 명령에 다른 폴더를 지정할 땐 `--path <dir>` 또는 `./dir` 형태를 쓰세요(맨 폴더 이름만 주면 현재 폴더로 처리됩니다). 출력은 한국어가 기본이며 `--language en` 으로 영어를 늘릴 수 있습니다(일부 메시지는 한국어 유지).

---

## 대표 워크플로

**필요에 따라 선택하는 세션 인수인계 예시**
```bash
leerness handoff .                          # 이전 맥락 자동 로드
leerness task add "API 응답 검증 로직 구현"
leerness task update T-0001 --status in-progress --evidence "검증 함수 구현"
leerness gate .                             # 배포 전 통합 품질 게이트
leerness session close .                    # 마감 + 다음 에이전트 인수인계
```

**보안·검증 게이트 (CI)**
```bash
leerness scan secrets .                     # 커밋 대상 하드코딩 시크릿 → exit 1
leerness contract verify spec.md src/api.js # 명세 함수/필드 누락 → exit 1
leerness verify-claim T-0001 --require-evidence
```

**역할 우선 다중 에이전트 조율**
```bash
leerness roles set coder --provider codex --model gpt-model-id \
  --candidate claude:claude-model-id --policy balanced
leerness roles validate --json
leerness agents resolve "API 구현" --role coder --json
leerness agents fallback provider "API 구현" --role coder \
  --provider claude --model claude-model-id --approved-by owner --json
leerness agents history --json
```

역할은 유지하고 Provider/모델만 교체합니다. 해석 결과는 설치·활성화·인증·모델 권한·쿼터·도달성·정책을 별도 축으로 공개하며, 폴백을 묵시적으로 실행하지 않습니다. 적용할 선택은 해석 당시 role-store와 availability revision에 묶입니다. 고위험 대체는 가시적인 승인자가 필요하고, 감지된 고위험 등급을 낮추려면 `--approved-by`와 `--reason`이 모두 필요하며, 고위험 검수는 구체적인 모델 ID에서 서로 다른 family를 입증할 때만 선택할 수 있습니다. `dispatch`와 `fallback`은 기본적으로 명령 준비·선택 기록만 하므로 `executed:false`입니다. 역할 없는 `agents multi --execute`와 `agents bench`는 opt-in 외부 CLI를 시작해 결과를 기록할 수 있지만, provider 기본 모델 fan-out으로 하나의 역할/모델 계약을 입증할 수 없으므로 `--role`을 거부합니다.

**MCP (외부 AI 에이전트에 도구로 노출)**
```bash
leerness mcp serve                          # JSON-RPC over stdio, 104개 도구
```

---

## 아키텍처 (외부 리뷰 검증)

`leerness state inspect . --json`으로 현재 상태 위치와 Project / Worktree /
Common-Control / Immutable-Record / Generated-View의 제안 경로를 확인할 수 있습니다.
읽기 전용 진단이며 데이터 이동·runtime 활성화·모델 호출은 하지 않습니다.
[진단 API](docs/state-paths-api.md)와 [단계별 구조 전환 계획](docs/state-scopes.md)을 참고하세요.

- **런타임 의존성 0 / install-script 0** — `package.json` 의 dependencies/optional/peer 가 전부 비어 있고 postinstall 도 없습니다. 순수 Node stdlib(`fs`/`path`/`child_process`/`readline`). 공급망 공격면 최소. `leerness install-safety` 로 확인 가능.
- **canonical JSON 단일 진실소스 + 마크다운 projection** — 메모리는 JSON 으로 저장하고 사람이 읽는 `.md` 는 파생물. 파이프(`|`)·개행·백틱·이모지·한글이 마크다운 테이블에서도 안전(셀 이스케이프 + round-trip).
- **원자적 UTF-8 쓰기** — temp + rename 으로 부분쓰기 손상 방지, BOM 자동 strip.
- **shell 미경유 MCP** — `mcp serve` 의 도구 호출은 셸을 거치지 않고 인자를 직접 전달(명령 주입 차단).
- **`--json` / 명령별 결과 계약** — 각 명령의 JSON 스키마와 종료 코드를 함께 확인합니다. 기본 handoff의 진단 필드 부재나 `doctor.healthy: null`은 검사 통과가 아닙니다.
- **모듈 분리(DI)** + **내장 자가검증** — `lib/` 순수 유틸/IO/카탈로그 분리. 2.0 후보의 `doctor`는 기본적으로 환경만 관측하며 `selftest.status: "not_run"`, `selftest.ok: null`, `healthy: null`을 반환합니다. 코어 검사는 `leerness selftest --json`으로 명시하거나 `LEERNESS_DOCTOR_SELFTEST=1`로 doctor에 포함하세요. `doctor --selftest` 옵션은 없습니다.

---

## 차별점

- **진짜 0-dependency** — SaaS 가 아니라 파일 기반 로컬 운영 메모리. 네트워크 불필요(업데이트 확인 제외).
- **에이전트 중립** — Claude / Codex / Cursor / Aider / Goose 등 어디에나 적용.
- **거짓 완료 방지** — 완료 주장에 evidence 를 요구하는 anti-lazy 흐름.
- **통합 게이트** — 보안·인코딩·드리프트·검증을 `gate` 하나로.
- **Windows/인코딩 1급 시민** — CP949/BOM 가드, 터미널 인코딩 자동 회복. 출력 언어는 기본 ko · `--language en` 으로 영어.
- **자기기술(self-describing)** — `about`/`commands`/`capabilities`/`doctor` 로 도구가 스스로 설명.

---

## 보안

- 시크릿/키/토큰을 소스에 하드코딩하지 마세요. `.env` 사용 + `.gitignore` 포함. `scan secrets`/`gate` 가 커밋 대상 시크릿을 차단합니다.
- 외부 AI CLI 연동은 **기본 비활성**입니다(`LEERNESS_ENABLE_*` opt-in). 브리지(web/pc/lsp)도 opt-in.
- 자세한 권한 표면은 [SECURITY.md](./SECURITY.md) 참고.

---

## 링크

- 홈페이지: https://leerness.com
- npm: https://www.npmjs.com/package/leerness
- GitHub: https://github.com/gugu9999gu/leerness
- 변경 이력: [CHANGELOG.md](./CHANGELOG.md)

## 라이선스

MIT
