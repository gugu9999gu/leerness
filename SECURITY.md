# Security & Transparency / 보안·투명성

> `leerness capabilities` 로 언제든 아래 표면을 CLI 에서 확인할 수 있습니다 (`--json` 지원).
> Run `leerness capabilities` anytime to view this surface from the CLI (`--json` supported).

leerness 는 **권한이 큰 CLI 하네스**입니다 (child_process · git · 외부 AI CLI · 자동화 브리지 · hook 설치). 신뢰를 위해 **할 수 있는 전부와 각 항목의 끄는 법(opt-out)** 을 공개합니다.

leerness is a **powerful CLI harness** (child_process, git, external AI CLIs, automation bridges, hook install). For trust, we disclose **everything it can do and how to opt out of each**.

## 설계 원칙 / Design principles

- **런타임 의존성 0** — `npm audit` 취약점 0. / Zero runtime dependencies.
- **postinstall 없음** — 설치만으로 코드가 실행되지 않음. / No postinstall scripts.
- **변경 전 자동 백업** — 모든 메타파일 변경 전 `.harness/archive/` 에 백업. / Auto-backup before any change.
- **동의 없는 자동 호출 금지** — 사용자 동의 없이 외부 LLM/API/CLI 를 자동 호출하지 않음. / Never auto-calls external LLMs/APIs/CLIs without consent.

## 권한 표면 / Capability surface

| 영역 / Area | 위험 / Risk | 설명 / What | opt-out |
|---|---|---|---|
| filesystem | 🟢 low | `.harness/` 메타파일 생성·갱신, 변경 전 백업. 소스코드 직접 수정 안 함. | 핵심 동작 (백업으로 보호) |
| network | 🟢 low | `update --check` 의 npm 최신 버전 비교만. 외부 URL 자동 fetch 안 함. | `LEERNESS_OFFLINE=1` |
| childProcess | 🟡 medium | git(명시 명령 시), `npm test`(verify-code), 외부 CLI `--version` 감지. | verify 계열 한정 · 외부 CLI 는 opt-in |
| externalAgents | 🟡 medium | `agents dispatch/multi` — 기본은 명령 텍스트만 생성, `multi --execute` 시 실제 spawn. | `LEERNESS_ENABLE_*` 미설정 시 비활성 (기본 off) |
| automationBridges | 🔴 high | `web`(playwright)/`pc`(robotjs)/`lsp`(typescript) — opt-in 의존성. `pc` 는 마우스/키보드 제어. | 의존성 미설치 시 비활성 (기본 off) |
| claudeHook | 🟢 low | `init` 시 `.claude/settings.local.json` 에 SessionStart hook(`update --check`) 설치. | `leerness init . --no-auto-update` |

## ⚠ 주의해서 쓸 명령 / Use with caution

회사·운영 코드에서는 아래 명령을 먼저 검토하세요. / Review these before using on company/production code.

| 명령 / Command | 동작 / Action |
|---|---|
| `init` | `.harness/` 50+ 파일 + `.claude` hook 생성 (변경 전 백업) |
| `update --yes` | 자동 마이그레이션 — 메타파일 갱신 |
| `agents multi --execute` | 외부 AI CLI 실제 spawn (병렬) |
| `release publish` / `sync-main` | git push + npm publish + GitHub release |
| `pc <click|type>` | 마우스/키보드 제어 (robotjs, full 권한) |
| `web <...>` | 헤드리스 브라우저 자동화 (playwright) |
| `setup-agents` | 외부 CLI 활성화 + 자동 설치 시도 |

## 권장 도입 방식 / Recommended adoption

전역 자동 적용보다, 먼저 한 프로젝트에서 확인 후 커밋하세요.
Prefer per-project trial over global auto-adoption.

```bash
npx leerness@latest init . --yes --language ko   # 또는 --language en
git diff && git status                            # 생성 파일 검토 후 커밋
leerness capabilities                             # 권한 표면 확인
```

## 취약점 보고 / Reporting

보안 취약점은 **공개 이슈로 올리지 마세요** — 공개 이슈는 내용이 모두에게 노출됩니다.
**Do NOT open a public issue for security vulnerabilities** — public issues are visible to everyone.

대신 아래 **비공개 채널** 중 하나로 알려주세요 / Use one of these **private** channels instead:

1. **GitHub Private Vulnerability Reporting** (권장 / preferred):
   https://github.com/gugu9999gu/leerness/security/advisories/new
   — GitHub 의 비공개 보안 권고 폼. 저장소 Security 탭 → "Report a vulnerability".
2. **보안 이메일 / Security email**: adstore3869@gmail.com (제목에 `[leerness security]` 표기 / prefix the subject with `[leerness security]`)

48 시간 내 접수 확인을 목표로 합니다. 수정 전까지 세부 내용은 공개하지 말아 주세요 (책임 있는 공개).
We aim to acknowledge within 48 hours. Please keep details private until a fix ships (responsible disclosure).
