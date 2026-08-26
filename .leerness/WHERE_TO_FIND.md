# Leerness Workspace Reference Guide

> AI 에이전트가 leerness 워크스페이스에서 어떤 파일을 어디서 찾는지 안내합니다 (1.9.211).

Generated: 2026-08-25T14:05:28.122Z by leerness 1.36.162
Workspace dir: `.leerness/`

## 📁 디렉토리 구조 (핵심)

```
.leerness/
├── plan.md                    ← 무엇을 할 것인가 (사용자 메모리)
├── progress-tracker.md        ← 무엇을 했는가 (증거 포함, 사용자 메모리)
├── decisions.md               ← 왜 그렇게 했는가 (사용자 메모리)
├── session-handoff.md         ← 다음 세션 인계 (사용자 메모리)
├── lessons.md                 ← 과거 교훈 (자동 fuzzy 회수)
├── rules.md                   ← 자연어 룰 (매 세션 자동 노출, R-XXXX)
├── task-log.md                ← in-progress / dropped task 이력
├── reuse-map.md               ← 워크스페이스 capability 매핑
├── skill-suggestions.md       ← skill rolling history
├── feature-graph.md           ← 기능 의존 그래프 (F-XXXX)
├── manifest.json              ← 워크스페이스 메타
├── leerness-config.json       ← 비시크릿 LEERNESS_* 설정 (1.9.187, AI 가시)
├── user-requests.json         ← 사용자 명시 요청 누적 (1.9.207)
├── active-wakeups.json        ← ScheduleWakeup 상태 (1.9.205)
├── pre-wake-report.json       ← sleep 전 sub-agent audit (1.9.209)
├── wakeup-history.json        ← adaptive wakeup 이력 (1.9.210)
├── platform-constraints.json  ← API 제약 catalog (1.9.208)
├── auto-resume-plan.json      ← 다음 라운드 plan (1.9.203)
├── next-action-queue.json     ← 다음 next-action 큐 (1.9.201)
├── cache/sessions/            ← ignored 세션별 handoff runtime record
├── last-handoff.json          ← legacy projection (handoff --writeback)
├── environment.json           ← 환경 변동 추적 (1.9.145)
├── skills/                    ← 설치된 skill 디렉토리
└── templates/                 ← 워크스페이스 템플릿
```

## 🧭 자주 묻는 위치

| 찾는 것 | 위치 |
|---|---|
| 현재 진행 중인 task | `.leerness/progress-tracker.md` (status: in-progress) |
| 사용자가 명시한 영구 룰 | `.leerness/rules.md` (active R-XXXX) |
| 직전 sleep 전 audit 결과 | `.leerness/pre-wake-report.json` (1.9.209) |
| 미답 사용자 요청 | `.leerness/user-requests.json` (status: open) |
| 다음 라운드 권장 단계 | `.leerness/auto-resume-plan.json` (1.9.203) |
| API 제약 catalog | `.leerness/platform-constraints.json` (1.9.208) |
| 자동 wakeup 권장 간격 | `.leerness/wakeup-history.json` (1.9.210) |

## 🔄 워크스페이스 디렉터리

canonical workspace 는 **`.leerness/`** 이며, 이 가이드가 가리키는 현재 위치는 **`.leerness/`** 입니다.
- `.harness/` 만 있는 기존 프로젝트는 `leerness migrate-workspace-dir` 로 안전하게 병합·이동합니다.
- 기존 `.leerness/state.json`, `.leerness/runs/`, `.leerness/handoff/`, `.leerness/cache/` substrate 는 보존합니다.
- 두 디렉터리에 서로 다른 live 파일이 있으면 자동 선택하지 않고 `workspace-dir-conflict` 로 차단합니다.
- legacy observability runs 는 state runs 와 충돌하지 않도록 `.leerness/cache/agent-runs/` 로 remap 합니다.

AI 에이전트는 `leerness handoff .` 와 `leerness workspace-dir get` 결과를 함께 신뢰하십시오.
