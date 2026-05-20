# Changelog

## 1.9.126 — 2026-05-20

**`leerness plan remove <target>` CLI + MCP 38번째 도구 `leerness_plan_remove`** — milestone 블록 영구 제거 (archive 자동 보존). **Memory Surface DELETE 5종 완전 완성** 🎉

### Added — `leerness plan remove <target>` CLI
- target: M-XXXX 또는 title substring (예: `plan remove M-0003`, `plan remove "alpha"`)
- 매칭된 milestone 블록 (`### M-XXXX. 제목 …`) 을 plan.md 에서 영구 제거
- 제거된 블록은 `.harness/plan.archive.md` 에 자동 보존 (복구 가능)
- **template 블록 자동 보호** (`### Template`, `### 템플릿` 등은 제거 대상에서 제외)
- 매칭 없을 시 fail (`매칭 milestone 없음`)
- 기존 `plan drop` (Out of Scope 표 추가, 소프트 폐기) 와는 별개. `plan remove` 는 하드 제거.

### Added — MCP 38번째 도구 `leerness_plan_remove`
- 외부 AI 가 잘못 저장한 milestone 제거.
- 인자: `{ target (required), path? }`

### 사용 시나리오
사용자: "M-0007 마일스톤 잘못 등록했으니 제거해줘"
→ 외부 AI: `leerness_plan_remove({ target: "M-0007" })` — plan.md 에서 제거, archive 보존

### Memory Surface DELETE 5종 완전 완성 🎉
| Surface | DELETE 명령 | 라운드 |
|---|---|---|
| tasks (progress-tracker.md) | `task drop` | 1.9.107 |
| decisions.md | `decision drop` | 1.9.125 |
| rules.md | `rule remove` | (기존) |
| **plan.md** | **`plan remove`** | **1.9.126 ✓** |
| lessons.md | `lesson drop` | 1.9.124 |

전 Surface 가 CREATE/READ/DELETE 대칭 구조 완비.

### MCP 도구 누계: 38 (1.9.125: 37 + leerness_plan_remove)

## 1.9.125 — 2026-05-20

**`leerness decision drop <target>` CLI + MCP 37번째 도구 `leerness_decision_drop`** — 잘못 저장한 결정 제거 (archive 자동 보존).

### Added — `leerness decision drop <target>` CLI
- target: date `YYYY-MM-DD` 또는 title substring
- 매칭된 결정 블록을 decisions.md 에서 제거
- 제거된 블록은 `.harness/decisions.archive.md` 에 자동 보존 (복구 가능)
- **template 블록 자동 보호** (`### Template` 등은 제거 대상에서 제외)
- 매칭 없을 시 fail

### Added — MCP 37번째 도구 `leerness_decision_drop`
- 외부 AI 가 잘못 저장한 결정 제거.
- 인자: `{ target (required), path? }`

### 사용 시나리오
사용자: "어제 PostgreSQL 결정 취소하고 MySQL로 다시 검토하자"
→ 외부 AI: 
  1. `leerness_decision_drop({ target: "PostgreSQL" })` — 기존 제거 (archive 보존)
  2. `leerness_decision_add({ title: "MySQL 채택", reason: "...", ... })` — 새 결정 등록

### Memory CRUD 진화 (decisions)
| Operation | 라운드 |
|---|---|
| CREATE (add) | 1.9.108 |
| READ (list) | 1.9.118 |
| **DELETE (drop)** | **1.9.125 ✓** |

### Memory Surface Archive 패턴 (2종)
- `lessons.archive.md` (1.9.124)
- `decisions.archive.md` (1.9.125)

### MCP 도구 수: 36 → 37개

### Verified
- stress-v70 — decision drop (date/title) + archive 보존 + template 보호 + MCP + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.124 — 2026-05-20

**`leerness lesson drop <target>` CLI + MCP 36번째 도구 `leerness_lesson_drop`** — 잘못 저장한 lesson 제거 (archive 자동 보존).

### Added — `leerness lesson drop <target>` CLI
- 새 명령: `leerness lesson drop "2026-05-20"` (date 매칭) 또는 `leerness lesson drop "JWT"` (text substring 매칭)
- 매칭된 lesson 블록을 lessons.md 에서 제거
- 제거된 블록은 `.harness/lessons.archive.md` 에 자동 보존 (복구 가능)
- 매칭 없을 시 `fail` (exit 1)

### Added — MCP 36번째 도구 `leerness_lesson_drop`
- 외부 AI 가 잘못 저장한 lesson 제거.
- 인자: `{ target (required), path? }`
- target은 date 또는 text substring 둘 다 매칭 (정확 date 우선)

### 사용 시나리오
사용자: "어제 잘못 저장한 lesson 지워줘. webhook 관련이었어"
→ 외부 AI: `leerness_lesson_drop({ target: "webhook" })`
→ "lesson dropped: 1건 (보존: .harness/lessons.archive.md)"

### Memory CRUD 확장
| 영역 | CREATE | READ | UPDATE | DELETE |
|---|---|---|---|---|
| Tasks | task_add | task_export | task_update | task_drop |
| Decisions | decision_add | decision_list | — | — |
| Rules | rule_add | rule_list | (status pause/resume) | rule_remove |
| Plan | plan_add | plan_list | — | — |
| **Lessons** | lesson_save | lesson_list | — | **lesson_drop ✓ (1.9.124)** |

### MCP 도구 수: 35 → 36개

### Verified
- stress-v69 — lesson drop (date/text) + archive 보존 + MCP + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.123 — 2026-05-20

**`leerness health --json` 응답에 `memorySurface` 필드 통합** — handoff (1.9.115) / session close (1.9.122) / memory status (1.9.114) 와 일관성 완성.

### Added — `health --json` 새 필드 `memorySurface`
```json
{
  "root": "...",
  "generatedAt": "...",
  "checks": { "drift": ..., "security": ..., "skills": ..., "usage": ..., "tasks": ... },
  "issues": [...],
  "healthy": true,
  "memorySurface": {
    "tasks": { "inProgress": 2, "total": 12, "byStatus": {...} },
    "decisions": { "count": 4 },
    "rules": { "active": 2, "total": 2 },
    "plan": { "milestones": 3 },
    "lessons": { "count": 7 },
    "summary": "T2/D4/R2/P3/L7"
  }
}
```

### 1.9.123 — JSON 명령 4종 일관성
| 명령 | memorySurface 필드 | 라운드 |
|---|---|---|
| `handoff --json` | ✓ | 1.9.115 |
| `memory status --json` | ✓ (상세 + latest) | 1.9.114 |
| `session close --json` | ✓ | 1.9.122 |
| **`health --json`** | **✓** | **1.9.123 ✓** |

이제 외부 AI 가 어떤 JSON 명령을 호출해도 동일한 `memorySurface` 구조로 5종 메모리 상태 회수.

### Verified
- stress-v68 — health --json memorySurface + summary 포맷 + 카운트 + MCP + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.122 — 2026-05-20

**`session close --json` 응답에 `memorySurface` 필드 통합** — handoff --json (1.9.115) 패턴을 session close 에도 적용.

### Added — `session close --json` 새 필드 `memorySurface`
이미 1.9.103 에서 추가된 `session close --json` 응답 구조에 `memorySurface` 통합:
```json
{
  "version": "1.9.122",
  "closedAt": "...",
  "sessionNumber": 62,
  "taskCounts": { ... },
  "rules": [...],
  "skillCandidates": [...],
  "drift": { ... },
  "topCommands": [...],
  "mcpStats": { ... },
  "workspacePeers": 29,
  "memorySurface": {
    "tasks": { "inProgress": 2, "total": 12, "byStatus": {...} },
    "decisions": { "count": 4 },
    "rules": { "active": 2, "total": 2 },
    "plan": { "milestones": 3 },
    "lessons": { "count": 7 },
    "summary": "T2/D4/R2/P3/L7"
  }
}
```

### 1.9.122 의 가치
- 외부 AI (Claude Code / Hermes) 가 session 마감 시 단일 `session close --json` 호출로:
  - 기존: 마감 통계 + drift + skill 후보
  - **추가: 5종 메모리 영구화 상태 (Memory Write Surface 카운트)**
- handoff (1.9.115) 와 session close (1.9.122) 모두 동일 `memorySurface` 패턴.
- MCP `leerness_session_close` 응답도 자동 갱신.

### Verified
- stress-v67 — session close --json memorySurface 필드 + 카운트 정확성 + summary 포맷 + MCP + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.121 — 2026-05-20

**handoff 6번째 자동 회수 라인 — `🆕 최근 24h 메모리 변동`** (5종 surface 24h 내 추가 항목 알림).

### Added — handoff 자동 회수 6단째
handoff 호출 시 다음 라인 자동 추가 (24h 내 메모리 surface 변경이 있을 때만):
```
🆕 최근 24h 메모리 변동 (1.9.121): decision +2 · lesson +1 · rule +1 · plan: 변경됨
  → 상세: leerness memory status --json
```

### 조건
다음 영역의 mtime 이 24h 내 또는 today() 날짜 항목이 있으면 표시:
- **task** — progress-tracker.md `Updated:` 컬럼 24h 내 row 카운트
- **decision** — decisions.md `### YYYY-MM-DD` 헤더 중 오늘 날짜
- **lesson** — lessons.md `### YYYY-MM-DD` 헤더 중 오늘 날짜
- **plan** — plan.md mtime 24h 내 (변경됨 표시)
- **rule** — rules.md mtime 24h 내 + `added: today()` rule 카운트

### 끄기
- `--no-mem-delta`
- `LEERNESS_NO_MEM_DELTA=1`
- `--quiet` 또는 `--compact` 모드에서는 자동 비활성

### 1.9.121 의 가치
- AI 에이전트가 이전 세션 종료 후 어떤 메모리가 추가됐는지 **즉시 인지**.
- 사용자 워크플로: "어제 등록한 결정과 통찰이 이번 세션 시작 시 보이게" → 자동 달성.
- 1.9.113 (헤드라인 mem 카운트) 와 보완 — 카운트가 아니라 **delta** 표시.

### handoff 자동 회수 6단 완성
| # | 라인 | 라운드 |
|---|---|---|
| 1 | 🧠 lessons 자동 재상기 | 1.9.56/67 |
| 2 | 🎯 매칭되는 skill 자동 추천 | 1.9.67 |
| 3 | 📒 이전 skill match 이력 | 1.9.69 |
| 4 | 🧩 brainstorm 자동 hits | 1.9.88 |
| 5 | 📊 통합 헤드라인 (mem T/D/R/P/L) | 1.9.81/93/113 |
| **6** | **🆕 최근 24h 메모리 변동** | **1.9.121 ✓** |

### Verified
- stress-v66 — handoff 6단 라인 + delta 카운트 정확성 + --no-mem-delta 비활성 + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.120 — 2026-05-20 🏆 50 라운드 자율 모드 마일스톤

**50 라운드 자율 모드 누적 마일스톤 보고서** (`_reports/AUTONOMOUS_ROUNDS_1.9.70-1.9.119.md`) + stress-v65 종합.

### Internal — 비공개 종합 보고서
- `_reports/AUTONOMOUS_ROUNDS_1.9.70-1.9.119.md` — **50 라운드** 종합 분석 (1.9.70 ~ 1.9.119)
- MCP 도구 진화 (10 → 35, 25개 추가)
- **Memory Surface 5종 R/W 완전 대칭** (WRITE 5종 + LIST READ 5종 = 10 surfaces)
- JSON 옵션 18종 누적
- 보안 4중 가드 + audit 11 kind
- 디버그 기록 8건 (1차 실패 → PASS 회복)
- 성능 측정 (11개 명령 median)
- 사용자 명시 정책 7개 모두 ✓

### 🏆 마일스톤 진화 요약
- 1.9.89: 19 라운드 보고서
- 1.9.97: 27 라운드 보고서
- 1.9.100: 🏆 30 라운드 + 100번째 패치
- 1.9.110: 🎉 MCP 30 도구 + Memory WRITE 5종
- 1.9.111: 41 라운드 보고서
- 1.9.119: 🎯 Memory READ 5종 완성
- **1.9.120: 🏆 50 라운드 마일스톤**

### Verified — stress-v65 종합 (1.9.70~119 핵심 기능 회귀)
- Memory Surface 5종 R/W 모두 PASS
- MCP 35 도구 노출 ✓
- handoff 5단 자동 회수 + 헤드라인 ✓
- 보안 4중 가드 ✓
- e2e 219/219 PASS

### Badge
- README `autonomous-rounds-50` (blueviolet 강조)

---

## 1.9.119 — 2026-05-20 🎯 Memory Surface READ 5종 완전 완성

**`leerness plan list [--json]` + MCP 35번째 도구 `leerness_plan_list`** — plan.md milestone 전체 조회 (Status/Progress/Tasks 체크박스 포함).

### Added — `leerness plan list [--json]`
- 새 CLI: `.harness/plan.md` 의 모든 milestone (M-XXXX) 조회.
- 출력: `{ id, title, status, progress, tasks: [{ done, text }] }`
- JSON: `{ version, root, total, milestones[] }`
- Tasks 체크박스 (`- [ ]` / `- [x]`) 자동 파싱 → 완료/미완료 카운트.

### Added — MCP 35번째 도구 `leerness_plan_list`
- 외부 AI 가 영구화된 milestone + Tasks 진행 상태 회수.
- 인자: `{ path? }`

### 🎯 Memory Surface READ 5종 완전 완성
| 영역 | READ 명령 | 라운드 |
|---|---|---|
| Tasks | task export | 1.9.60 |
| Rules | rule list | 1.9.109 |
| Lessons | lesson list | 1.9.117 |
| Decisions | decision list | 1.9.118 |
| **Plan** | **plan list** | **1.9.119 ✓** |

Memory Surface 5종은 이제 WRITE (1.9.105~112) + LIST READ (1.9.60~119) 패턴 완전 대칭:

| 영역 | WRITE | LIST READ |
|---|---|---|
| Tasks | task_add/update/drop (1.9.105~107) | task_export (1.9.60) |
| Decisions | decision_add (1.9.108) | decision_list (1.9.118) |
| Rules | rule_add (1.9.109) | rule_list (1.9.109) |
| Plan | plan_add (1.9.110) | **plan_list (1.9.119)** |
| Lessons | lesson_save (1.9.112) | lesson_list (1.9.117) |

### MCP 도구 수: 34 → 35개
### JSON 옵션 누적: 17 → 18종

### Verified
- stress-v64 — plan list CLI + --json + status/progress/tasks 파싱 + MCP + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.118 — 2026-05-20

**`leerness decision list [--json]` 새 명령 + MCP 34번째 도구 `leerness_decision_list`** — decisions.md 전체 조회 + 메타데이터.

### Added — `leerness decision list [--json]`
- 새 CLI: `.harness/decisions.md` 의 모든 설계 결정 조회.
- 출력: `{ date, title, decision, reason, alternatives, impact }`
- JSON: `{ version, root, total, decisions[] }`
- `_extractDecisionBlocks` 사용 → template/code 블록 자동 제외.

### Added — MCP 34번째 도구 `leerness_decision_list`
- 외부 AI 가 영구화된 설계 결정 + 메타데이터 (Reason/Alternatives/Impact) 전체 회수.
- 인자: `{ path? }`

### 사용 시나리오
사용자: "지금까지 등록된 결정들 알려줘"
→ 외부 AI: `leerness_decision_list({ path: "." })`
→ `[{ date, title, reason, alternatives, impact }, ...]` 전체 조회

### Memory Surface READ 확장 (4종 모두 list 명령 존재)
| 영역 | READ 명령 | 라운드 |
|---|---|---|
| Tasks | task export | 1.9.60 |
| Rules | rule list | 1.9.109 |
| Lessons | lesson list | 1.9.117 |
| **Decisions** | **decision list** | **1.9.118 ✓** |

(Plan은 plan progress가 기존 존재 — milestone 진행률 보고)

### MCP 도구 수: 33 → 34개
### JSON 옵션 누적: 16 → 17종

### Verified
- stress-v63 — decision list CLI + --json + 메타데이터 + MCP + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.117 — 2026-05-20

**`leerness lesson list [--tag] [--json]` 새 명령 + MCP 33번째 도구 `leerness_lesson_list`** — lessons.md 전용 조회 + tag 필터.

### Added — `leerness lesson list [--tag <tag>] [--json]`
- 새 CLI: `.harness/lessons.md` 의 모든 lesson 조회.
- 옵션:
  - `--tag <tag>` — 특정 태그 필터 (lesson save 시 `--tag` 로 저장된 값)
  - `--json` — 구조화 출력
- JSON 출력: `{ version, root, total, lessons: [{ date, text, tag }], tag? }`

### Added — MCP 33번째 도구 `leerness_lesson_list`
- 외부 AI 가 영구화된 lesson 전체 회수.
- `leerness_lessons` 와 차이:
  - `lessons`: review-evidence / decisions / task-log / lessons.md 다중 source fuzzy 매칭
  - `lesson_list`: **lessons.md 전용** (사용자가 명시 save 한 lesson만) + tag 필터
- 인자: `{ path?, tag? }`

### 사용 시나리오
사용자: "지금까지 등록된 auth 관련 lesson 알려줘"
→ 외부 AI: `leerness_lesson_list({ tag: "auth" })`
→ `{ total: 3, lessons: [{ date, text, tag: "auth" }, ...] }`

### Memory Surface READ 확장
| 영역 | READ | 라운드 |
|---|---|---|
| Tasks | task export | 1.9.60 |
| Decisions | (lessons fuzzy + memory status 최근) | 기존 |
| Rules | rule list | 1.9.109 |
| Plan | (handoff 컨텍스트) | 기존 |
| **Lessons** | **lesson list** | **1.9.117 ✓** |

### MCP 도구 수: 32 → 33개
### JSON 옵션 누적: 15 → 16종

### Verified
- stress-v62 — lesson list CLI + --tag 필터 + --json + MCP + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.116 — 2026-05-20

**`leerness brainstorm` 회수 범위에 lessons.md + plan.md milestone 통합** — Memory Write Surface 5종 ↔ brainstorm 완전 통합.

### Added — brainstorm 회수 범위 확장
- 기존 hits 영역: decisions / skills / tasks / rules / evidence / skillHistory / taskLogFails
- **추가 hits**: 
  - `lessonsExplicit` — `.harness/lessons.md` (1.9.112 신규) 의 dated 블록 매칭
  - `planMilestones` — `.harness/plan.md` 의 `M-XXXX` milestone 매칭

### 변경 적용 위치
- `_brainstormFor(root, topic)` — 1.9.77 MCP `leerness_brainstorm` + 1.9.88 handoff brainstorm hits 가 사용
- `brainstormCmd(root, topic)` verbose 출력 — 사용자 직접 호출 시 발견 카운트에 포함

### 1.9.116 의 가치
- 1.9.112 에서 lessons.md 가 메모리 surface 5번째로 추가됐지만 brainstorm 매칭에는 미반영.
- 이제 brainstorm 호출 시 lessons.md 의 통찰 + plan.md 의 milestone 도 함께 검색.
- 외부 AI 가 "JWT" 주제로 brainstorm 호출 → JWT 관련 모든 메모리 surface (decision/lesson/plan/rule/skill/task/history/failure) 자동 회수.

### Performance
- 새 hits 영역 추가로 brainstorm 평균 5-10ms 증가 (lessons.md, plan.md 추가 read).
- 캐시 미적용 (단순 텍스트 매칭) — 향후 캐싱 가능.

### Verified
- stress-v61 — brainstorm --json 에 lessonsExplicit/planMilestones 필드 존재 + 키워드 매칭 정확성 + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.115 — 2026-05-20

**`leerness handoff --json` 응답에 `memorySurface` 필드 통합** — 단일 호출로 컨텍스트 + 5종 메모리 상태 동시 회수.

### Added — `handoff --json` 새 필드 `memorySurface`
출력 구조에 다음 필드 추가:
```json
{
  "date": "...",
  "project": "...",
  "version": "1.9.115",
  "files": { ... },
  "activeRules": [ ... ],
  "memorySurface": {
    "tasks": { "inProgress": 2, "total": 12, "byStatus": {...} },
    "decisions": { "count": 4 },
    "rules": { "active": 2, "total": 2 },
    "plan": { "milestones": 3 },
    "lessons": { "count": 7 },
    "summary": "T2/D4/R2/P3/L7"
  }
}
```

### 1.9.115 의 가치
- 외부 AI(Claude Code / Hermes)가 매 세션 시작 시 단일 `handoff --json` 호출만으로:
  - 워크스페이스 컨텍스트 (plan / progress / decisions / handoff 등 파일)
  - active rules
  - **5종 메모리 영구화 상태 (Memory Write Surface)**
  를 모두 한 번에 회수.
- MCP `leerness_handoff` 응답도 자동 갱신 (기존 도구가 --json 사용).

### 1.9.114 와 차이
- 1.9.114: 별도 `memory status` 명령으로 상세 조회 + 최근 항목까지.
- **1.9.115**: handoff 응답에 통합 — 별도 호출 없이 동시 수신 (latest 항목은 제외, 카운트만).

### Verified
- stress-v60 — handoff --json memorySurface 필드 + 카운트 정확성 + summary 포맷 + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.114 — 2026-05-20

**`leerness memory status` 새 명령 + MCP 32번째 도구 `leerness_memory_status`** — Memory Write Surface 5종 통합 상세 상태 조회.

### Added — `leerness memory status [--json]`
- 새 CLI 명령: Memory Write Surface 5종 통합 상태 조회.
- Verbose 모드:
  ```
  # 🧠 Memory Surface Status (1.9.114)
  📋 Tasks: 2 in-progress / 12 total
     - 분포: in-progress=2, done=8, ...
  🧠 Decisions: 4 entries
     - 최근: 2026-05-20 — PostgreSQL 채택
  ⚡ Rules: 2 active / 0 paused
  🗺  Plan: 3 milestones (1 in-progress)
  💡 Lessons: 7 entries
     - 최근: webhook 재시도 시 idempotency key 필수

  📊 Summary: T2/D4/R2/P3/L7
  ```
- JSON 모드: `{ version, root, tasks, decisions, rules, plan, lessons, summary }` 구조.
- summary 필드는 handoff 헤드라인 (1.9.113) 과 동일 포맷 `T/D/R/P/L`.

### Added — MCP 32번째 도구 `leerness_memory_status`
- 외부 AI 가 한 호출로 5종 메모리 영구화 상태 + 카운트 + 최근 항목 회수.
- 인자: `{ path? }`.
- 1.9.113 헤드라인 mem 토큰의 상세 버전 — 외부 AI 가 카운트만 아닌 **최근 결정 / 최근 lesson 내용** 까지 직접 받음.

### 사용 시나리오
사용자: "지금까지 누적된 결정과 lesson 알려줘"
→ 외부 AI: `leerness_memory_status({ path: "." })`
→ 외부 AI 가 receivedJSON 으로 응답:
> "Decisions 4건, 최근: PostgreSQL 채택. Lessons 7건, 최근: webhook 재시도 시 idempotency key 필수."

### MCP 도구 수: 31 → 32개
### JSON 옵션 누적: 14 → 15종

### Verified
- stress-v59 — memory status CLI + --json + MCP 응답 + 5종 카운트 정확성 + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.113 — 2026-05-20

**handoff 통합 헤드라인에 Memory Write Surface 5종 카운트 추가** — 사용자가 한눈에 5종 메모리 영구화 상태 확인.

### Added — `📊 헤드라인` 의 새 토큰 `🧠 mem T/D/R/P/L`
handoff 호출 시 통합 헤드라인 끝에 다음 토큰 추가:
- **T** — tasks in-progress 카운트
- **D** — decisions 누적 (decisions.md `### YYYY-MM-DD` 헤더 카운트)
- **R** — rules active 카운트
- **P** — plan milestones 누적 (`M-XXXX` 카운트)
- **L** — lessons 누적 (lessons.md `### YYYY-MM-DD` 헤더 카운트)

예: `📊 헤드라인 (1.9.81/93/113): drift healthy (0) · 🔒 보안 OK · 🔌 MCP 5회 · 📒 skill query 3회 · 📚 12 skills · ⚕ health: ✓ · 🧠 mem T2/D3/R1/P5/L7`

### 1.9.113 의 가치
- 외부 AI 가 매 handoff 호출 시 5종 메모리 surface 의 **영구화 상태**를 한 줄로 인지.
- "지금까지 등록된 decisions / lessons / plan milestones 가 얼마나 있나?" 를 한눈에.
- Memory Write Surface 5종 완성 (1.9.112) 의 자연스러운 가시화.

### Performance
- inline 계산 (자식 spawn 없음) — 헤드라인 latency 영향 무시 가능 (~ +5ms).

### Verified
- stress-v58 — handoff 헤드라인 mem 토큰 출현 + 5종 카운트 정확성 + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.112 — 2026-05-20

**`leerness lesson save` CLI + MCP 31번째 도구 `leerness_lesson_save`** — **Memory Write Surface 5종 완성** (lessons.md 전용 직접 write).

### Added — `leerness lesson save "<text>"` CLI
- 새 명령: `leerness lesson save "<text>" --tag "..."`
- `.harness/lessons.md` 에 표준 형식으로 append:
  ```md
  ### YYYY-MM-DD
  - Lesson: <text>
  - Tag: <tag> (선택)
  ```
- lessons.md 가 없으면 자동 생성.

### Added — MCP 31번째 도구 `leerness_lesson_save`
- 외부 AI 가 세션 중 얻은 통찰을 즉시 영구 기록.
- 인자: `{ text (required), tag?, path? }`
- handoff 자동 lessons 회수와 통합 — 추후 동일 키워드 작업 시 자동 재상기.

### Memory Write Surface 5종 완성
| 영역 | WRITE 라운드 | MCP 도구 |
|---|---|---|
| Tasks (CRUD) | 1.9.105~107 | task_add/update/drop |
| Decisions | 1.9.108 | decision_add |
| Rules | 1.9.109 | rule_add/list |
| Plan | 1.9.110 | plan_add |
| **Lessons** | **1.9.112** | **lesson_save** |

### Internal — `_loadLessonsIndex()` 확장
- `lessons.md` 도 캐시 인덱스에 포함 → handoff 자동 회수 가 새 lessons 도 즉시 fuzzy 매칭.
- mtime 기반 캐시 무효화 (다른 파일과 동일 패턴).

### Fixed
- `nonFlagArgs()` withValue Set 에 `--tag` 추가 — `lesson save` CLI 인자 정확히 파싱.

### MCP 도구 수: 30 → 31개

### Verified
- stress-v57 — lesson save CLI + lessons.md 갱신 + MCP 31 도구 + handoff lessons 회수 통합 + Memory Write 5종 통합 + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.111 — 2026-05-20

**41 라운드 자율 모드 누적 보고서 마무리** (`_reports/AUTONOMOUS_ROUNDS_1.9.70-1.9.110.md`) + stress-v56 종합 회귀.

### Internal — 비공개 종합 보고서
- `_reports/AUTONOMOUS_ROUNDS_1.9.70-1.9.110.md` — 41 라운드 (1.9.70~1.9.110) 종합 분석
- MCP 도구 진화 표 (10 → 30, 20개 추가)
- Memory Write Surface 4종 완성 (tasks CRUD + decisions + rules + plan)
- JSON 옵션 14종 누적
- 보안 3중 가드 + audit 11 kind
- 디버그 기록 7건
- 성능 측정 (11개 명령 median)
- 사용자 명시 정책 7개 모두 ✓

### Verified — stress-v56 종합 (1.9.70~110 핵심 기능 회귀)
- 마일스톤 (1.9.100/110) 핵심 시나리오 모두 PASS
- Memory Write Surface 4종 통합 사이클 PASS
- e2e 219/219 PASS

### Badge
- README 에 `autonomous-rounds-41` 배지 추가

---

## 1.9.110 — 2026-05-20 🎉 **MCP 30 도구 마일스톤**

**MCP 30번째 도구 `leerness_plan_add`** (plan.md milestone + progress-tracker 자동 동기화).

### Added — MCP 30번째 도구 `leerness_plan_add`
- 외부 AI 가 plan.md 에 새 milestone (`M-XXXX`) 추가.
- 자동으로 progress-tracker.md 에 동기화된 task (`T-XXXX`) 생성 + `evidence: plan:M-XXXX` 링크.
- 인자: `{ text (required), status?, progress?, nextAction?, path? }`
- 기본값: `status=planned`, `progress=0%`, `nextAction="다음 액션 작성"`

### Memory Write Surface 확장 (4종)
| 영역 | WRITE 라운드 | MCP 도구 |
|---|---|---|
| Tasks (CRUD) | 1.9.105~107 | task_add/update/drop |
| Decisions | 1.9.108 | decision_add |
| Rules | 1.9.109 | rule_add/list |
| **Plan** | **1.9.110** | **plan_add** |

### 🎉 MCP 30 도구 마일스톤 (1.9.43 → 1.9.110)
- **1.9.43**: 10 도구 (기본 MCP 도입)
- **1.9.94**: 21 도구 (skill_search/info, benchmark 추가)
- **1.9.107**: 26 도구 (task CRUD 완성)
- **1.9.110**: **30 도구 마일스톤** 🎉

### Verified
- stress-v55 — MCP plan_add + plan.md+progress-tracker 자동 동기화 + 30 도구 + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.109 — 2026-05-20

**MCP 28+29번째 도구 `leerness_rule_add` / `leerness_rule_list`** + `rule list --json` (자연어 영구 룰 R/W).

### Added — `leerness rule list --json`
- 출력: `{ version, root, total, rules[] }`
- 각 rule: `{ id, trigger, rule, status, lastVerified }`
- CI/외부 AI 통합 친화.

### Added — MCP 28번째 도구 `leerness_rule_add`
- 외부 AI 가 자연어 영구 룰 (1.9.8) 등록.
- 인자: `{ description (required), trigger?, path? }`
- trigger enum: `every-session` / `every-update` / `every-commit` / `session-start` / `session-close` / `pre-publish`
- 등록된 룰은 매 handoff 자동 출력, session close 자동 검증.

### Added — MCP 29번째 도구 `leerness_rule_list`
- 외부 AI 가 현재 활성 룰 조회.
- 사용 시나리오: 사용자가 "현재 활성 룰 알려줘" → 외부 AI 가 자동 회수.

### Memory Write Surface 확장 (3종)
| 영역 | WRITE 라운드 |
|---|---|
| Tasks (CRUD) | 1.9.105~107 |
| Decisions | 1.9.108 |
| **Rules** | **1.9.109** |

### MCP 도구 수: 27 → 29개 (2개 추가)

### Verified
- stress-v54 — rule list --json + MCP rule_add/list + 29 도구 + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.108 — 2026-05-20

**`leerness decision add` 새 CLI + MCP 27번째 도구 `leerness_decision_add`** (설계 결정 영구화 — task 다음으로 메모리 write surface 확장 시작).

### Added — `leerness decision add "<title>"` CLI
- 새 명령: `leerness decision add "<title>" --reason "..." --alternatives "..." --impact "..."`
- decisions.md 에 표준 형식으로 자동 append:
  ```md
  ### YYYY-MM-DD — 결정 제목
  - Decision: 결정 제목
  - Reason: ...
  - Alternatives: ...
  - Impact: ...
  ```
- decisions.md 가 없으면 자동 생성.
- 1.9.43+ handoff lessons 자동 회수와 통합 — 추후 동일 키워드 작업 시 자동 재상기.

### Added — MCP 27번째 도구 `leerness_decision_add`
- 외부 AI(Claude Code / Hermes)가 설계 결정을 즉시 기록.
- 인자: `{ title (required), reason?, alternatives?, impact?, path? }`
- 사용 시나리오: 사용자와 토론 후 결정 사항을 외부 AI 가 자율 영구화.

### Memory Write Surface 시작
| 영역 | READ (기존) | WRITE (신규) |
|---|---|---|
| **Decisions** | lessons 자동 회수 (1.9.56+) | **`decision_add` (1.9.108)** |
| **Tasks** | task_export (1.9.60) | task_add/update/drop (1.9.105~107) |

다음 후보: lessons 직접 write, rules add, plan add 등.

### MCP 도구 수: 26 → 27개

### Verified
- stress-v53 — decision add CLI + decisions.md 실제 갱신 + MCP 응답 + 27 도구 + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.107 — 2026-05-20

**MCP 26번째 도구 `leerness_task_drop` — task CRUD 완성** (read/add/update/drop 4종 surface).

### Added — MCP 26번째 도구 `leerness_task_drop`
- 외부 AI 가 task 를 `dropped` 상태로 폐기 (취소).
- 인자:
  - `id` (required) — 폐기할 task ID
  - `reason` — 폐기 사유 (기본 `사용자 요청으로 제외`)
  - `path` — 워크스페이스 경로

### MCP task CRUD 완성 (4종 surface)
| 라운드 | MCP 도구 | CRUD |
|---|---|---|
| 1.9.60 | `leerness_task_export` | **R**ead — task → TodoWrite JSON |
| 1.9.105 | `leerness_task_add` | **C**reate — 새 task 등록 |
| 1.9.106 | `leerness_task_update` | **U**pdate — 상태/evidence 갱신 |
| **1.9.107** | **`leerness_task_drop`** | **D**rop — 폐기 |

이제 외부 AI 가 task 전체 라이프사이클을 자율 관리 가능.

### MCP 도구 수: 25 → 26개

### Verified
- stress-v52 — MCP task_drop + CRUD 사이클 + 26 도구 + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.106 — 2026-05-20

**MCP 25번째 도구 `leerness_task_update`** (read+add+update 3종 task 제어 surface 완성).

### Added — MCP 25번째 도구 `leerness_task_update`
- 외부 AI 가 기존 task 의 상태/evidence/nextAction 을 단계적으로 갱신.
- 인자:
  - `id` (required) — 갱신할 task ID (`T-XXXX`)
  - `status` — 9 status enum
  - `evidence` — evidence 라인 갱신
  - `nextAction` — 다음 액션 갱신
  - `note` — task request 텍스트 자체 변경
  - `path` — 워크스페이스 경로

### read+add+update 3종 task 제어 surface 완성
| 라운드 | MCP 도구 | 작업 |
|---|---|---|
| 1.9.60 | `leerness_task_export` | READ — task → TodoWrite JSON |
| 1.9.105 | `leerness_task_add` | ADD — 새 task 등록 |
| **1.9.106** | **`leerness_task_update`** | **UPDATE — 상태/evidence 갱신** |

외부 AI 가 작업 진행에 따라 task 를 add → update(in-progress) → update(done) 사이클로 자율 관리.

### MCP 도구 수: 24 → 25개

### Verified
- stress-v51 — MCP task_update + add→update 사이클 + 25 도구 + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.105 — 2026-05-20

**MCP 24번째 도구 `leerness_task_add`** (외부 AI 가 task 즉시 등록 — 양방향 제어 완성).

### Added — MCP 24번째 도구 `leerness_task_add`
- 외부 AI(Claude Code / Hermes)가 progress-tracker.md 에 새 task 즉시 등록.
- 인자:
  - `text` (required) — task 설명
  - `status` — 9 status enum (requested/planned/in-progress/waiting/on-hold/blocked/incomplete/done/dropped). 기본 `requested`
  - `evidence` — evidence 라인 (기본 `user-request`)
  - `nextAction` — 다음 액션 (기본 `다음 액션 작성`)
  - `path` — 워크스페이스 경로 (기본 현재)
- 응답: 새 task ID (`T-XXXX`) + 성공 메시지
- 사용 시나리오: 사용자가 자연어로 "X 작업 추가해줘" → 외부 AI 가 즉시 `leerness_task_add` 호출.

### 양방향 제어 완성
- 1.9.60: `leerness_task_export` — task → TodoWrite (READ)
- **1.9.105: `leerness_task_add` — TodoWrite → task (WRITE)**
- 외부 AI 가 task 목록을 read + add 양방향 sync.

### MCP 도구 수: 23 → 24개
1~10 (기존) + skill_suggest / lessons / task_export / env_check / brainstorm / skill_match / skill_list / health / skill_search / skill_info / benchmark / lazy_detect / retro / **task_add** (1.9.105 신규)

### Verified
- stress-v50 — MCP task_add 응답 + progress-tracker.md 실제 갱신 + 24 도구 + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.104 — 2026-05-20

**MCP 23번째 도구 `leerness_retro`** (4세션 누적 회고 외부 AI 노출).

### Added — MCP 23번째 도구 `leerness_retro`
- 4세션 누적 회고 보고서 JSON 외부 AI 노출.
- 인자: `{ path?, days?, allApps? }`
- 출력 데이터: `statusCounts` / `focusNext` / `skillUsage` / `recentDecisions` / `durations` / `activeRules` / `verifiedRules` / `fixSignals` / `passSignals` / `totalOptimizations`
- `retro` CLI 명령은 1.9.16부터 `--json` 지원했으나, MCP 노출은 1.9.104에서 추가.
- 사용 시나리오: 외부 AI가 누적 패턴 학습 / 다음 라운드 우선순위 결정 / 디버그 비중 분석.

### MCP 도구 수: 22 → 23개
1~10 (기존) + skill_suggest / lessons / task_export / env_check / brainstorm / skill_match / skill_list / health / skill_search / skill_info / benchmark / lazy_detect / **retro** (1.9.104 신규)

### Verified
- stress-v49 — MCP retro 응답 + 23 도구 노출 + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.103 — 2026-05-20

**`leerness session close --json`** (세션 마감 통계 JSON + MCP `leerness_session_close` JSON 자동).

### Added — `leerness session close [path] --json`
- 출력: `{ version, root, closedAt, sessionNumber, taskCounts, recommendedDirection, nextExactStep, rules[], skillCandidates[], drift, topCommands[], mcpStats, workspacePeers, retroSummaryError? }`
- `taskCounts`: 9개 status (requested/planned/in-progress/waiting/on-hold/blocked/incomplete/done/dropped) 카운트
- `rules`: 활성 룰 검증 결과 (id/trigger/verified/note)
- `skillCandidates`: Hermes-style 자동 학습 (top 5)
- `drift`: { level, score, fired[] }
- `topCommands`: 가장 많이 쓴 명령 top 3
- `mcpStats`: { total, top[], rare[] }
- `workspacePeers`: 다른 leerness 프로젝트 개수
- stdout 억제 후 JSON만 (CI/외부 AI 통합 친화)

### Changed — MCP `leerness_session_close`
- 기본 응답을 **JSON** 으로 변경 (--json 자동 전달).
- 외부 AI(Claude Code / Hermes)가 마감 시 통계를 파싱 친화적으로 회수.

### JSON 옵션 누적 13종
`skill list/info/search` · `health` · `lessons` · `handoff` · `env check` · `benchmark` · `drift check` · `lazy detect` · `usage stats` · `audit` · **`session close`** (신규)

### Verified
- stress-v48 — session close --json 구조 + MCP + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.102 — 2026-05-20

**`leerness audit --json` 구조화 출력** (findings 11종 kind + MCP `leerness_audit` JSON 응답).

### Added — `leerness audit [path] --json`
- 출력: `{ version, root, warnings, failures, fixed, healthy, fixApplied, strict, strictThreshold, summary, findings[] }`
- 각 finding: `{ kind, severity, message, ...details }`
- **finding.kind 11종**:
  - `design_dup` — design guide 중복 파일 (`docs/designguide.md` 등)
  - `design_system_default` — design-system.md tokens not customized
  - `reuse_map_empty` — reuse-map.md 비어있음
  - `milestone_unlinked` — milestone progress-tracker 미연결
  - `handoff_not_generated` — session-handoff.md never auto-generated
  - `current_state_stale` — current-state.md 7일 이상 stale
  - `readme_version_mismatch` — README 배지 ↔ package.json 불일치
  - `npm_cve` — npm audit 발견 CVE
  - `npm_cve_critical` — critical/high CVE 즉시 대응 권장
  - `gitignore_missing_secrets` — .gitignore에 시크릿 패턴 누락
  - `env_keys_missing` — .env 키가 .env.example에 누락
  - `strict_promoted` — --strict로 warnings → failures 승격
- exit 1 if `failures > 0` (warnings 만으로는 healthy=true 유지)
- 기존 verbose 출력은 stdout 억제 후 JSON만 출력 (CI 친화)

### Changed — MCP `leerness_audit`
- 기본 응답을 JSON 으로 변경 (--json 자동 전달).
- `args.strict: true` 옵션 추가 → `--strict` 전달.
- 외부 AI(Claude Code / Hermes)가 audit 결과를 파싱 친화적으로 받음.

### JSON 옵션 통합 11종 (1.9.102 까지)
| 명령 | 라운드 | 핵심 |
|---|---|---|
| `skill list --json` | 1.9.84 | items[] |
| `health --json` | 1.9.85 | checks/issues/healthy |
| `skill search --json` | 1.9.90 | matches[] |
| `skill info --json` | 1.9.92 | 개별 skill |
| `lessons --json` | 1.9.95 | lessons[] |
| `handoff --json` | 1.9.96 | files{...}/activeRules |
| `env check --json` | 1.9.71 | inEnvOnly/inExampleOnly |
| `benchmark --json` | 1.9.46 | 6 차원 점수 |
| `drift check --json` | (기존) | score/level/fired[] |
| `lazy detect --json` | 1.9.101 | findings[] 7 kind |
| `audit --json` | **1.9.102** | **findings[] 11 kind** |

### Verified
- stress-v47 — audit --json 구조 + 11 kind 검출 + MCP audit + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.101 — 2026-05-20

**`leerness lazy detect --json` + MCP 22번째 도구 `leerness_lazy_detect`** (외부 AI에 거짓 완료/empty handoff/no test run/TODO 미추적 신호 노출).

### Added — `leerness lazy detect [path] --json`
- 기존 `lazy detect` 명령에 `--json` 옵션 추가.
- 출력: `{ version, root, issues, healthy, todoCount, newTodoCount, findings[] }`
- 각 finding: `{ kind, severity, ...details }`
  - `kind` 종류: `evidence_missing` / `progress_empty` / `handoff_never_generated` / `handoff_empty` / `no_test_run` / `todo_untracked` / `blocker_no_next_action`
- exit 1 if `issues > 0` (CI 통합 친화적)

### Added — MCP 22번째 도구 `leerness_lazy_detect`
- 외부 AI가 워크스페이스의 거짓 완료/lazy 신호를 JSON으로 사전 점검.
- 사용 시나리오: 세션 마감 전 자동 검사, CI 게이트, AI 에이전트의 "정말 끝났는지" self-check.
- MCP 도구 수: **21 → 22개**.

### Verified
- stress-v46 — lazy detect --json 구조 + 7종 kind 검출 + MCP 22 도구 + 누적 회귀.
- e2e 219/219 PASS.

---

## 1.9.100 — 2026-05-20 🏆 마일스톤 (30 라운드 자율 누적 + 100번째 패치)

**1.9.70 ~ 1.9.99 자율 모드 30 라운드 누적 마일스톤** (stress-v45 30/30 PASS · e2e 219/219 PASS).

### Milestone Summary
- **버전 진화**: 1.9.70 → 1.9.100 (30 라운드, 모두 stress + e2e + GitHub release)
- **MCP 도구**: 12 → **21개** (env_check / brainstorm / skill_match / skill_list / health / skill_search / skill_info / benchmark 추가)
- **handoff 자동 회수 5단**: lessons + skill 추천 + history hit + brainstorm hits + 헤드라인
- **3중 보안 가드**: drift 5번째 신호 (1.9.78) + handoff 요약 (1.9.76) + CRITICAL 자동 회복 (1.9.80)
- **JSON 옵션 10종**: handoff, lessons, skill list/info/search, health, env check, benchmark, drift check, usage stats
- **새 명령 3종**: `env check/sync` (1.9.71) · `health` (1.9.85) · `skill search` (1.9.90)
- **handoff --quiet** (1.9.99) — 자동화/CI 비대화 모드

### Verified — stress-v45 종합 검증 (1.9.70~99 30 라운드)
- **총 30 / PASS 30 / FAIL 0 · 34015ms** (100% 통과)
- R70~R99 핵심 기능 시나리오 28개 + MCP 21 도구 + 5종 시크릿 패턴 안전 검증
- e2e 219/219 PASS 매 라운드 유지
- 누적 회귀 0건, 신규 회귀 없음

### Internal — 비공개 종합 보고서
- `_reports/AUTONOMOUS_ROUNDS_1.9.70-1.9.99.md` — 30 라운드 자율 모드 누적 + 마일스톤 마무리

### Stats (30 라운드 누적)
- stress 시나리오 ~440개 모두 PASS
- 디버그 기록 6건 (1차 실패 → 진단 → 수정 → PASS)
- GitHub release/tag 30개 (v1.9.70 ~ v1.9.99 + v1.9.100)
- 사용자 명시 정책 7개 모두 ✓

### 사용자 명시 정책 준수 (verbatim)
- ✓ 매 라운드 stress test 필수 검수
- ✓ 이전 중요 기능 정상 작동 검증 (누적 회귀)
- ✓ 성능 테스트 병행 (handoff median ~700ms 유지)
- ✓ GitHub 배포 (https://github.com/gugu9999gu/leerness)
- ✓ `_reports/` 비공개 (`.gitignore` + `.npmignore`)
- ✓ 설치 가이드 매 라운드 동기화 (`_banner` quickStart + `session-workflow.md`)
- ✓ 보안: `.env` 실제 값 절대 미노출, 시크릿 하드코딩 차단

---

## 1.9.99 — 2026-05-20

**`leerness handoff --quiet` 옵션** (자동화/CI 모드용 최소 출력).

### Added
- `leerness handoff --quiet` — 자동 회수 라인 모두 비활성화:
  - 헤드라인 (1.9.81/93)
  - lessons 자동 재상기 (1.9.56)
  - 매칭 skill 자동 추천 (1.9.67)
  - skill match 이력 (1.9.69)
  - brainstorm 자동 hits (1.9.88)
  - 보안 요약 (1.9.76) / CRITICAL (1.9.80)
- 기본 컨텍스트 (Session Handoff, Plan, Progress Tracker, Decisions, Task Log)만 출력.
- CI 통합 / 자동 처리 / 비대화형 환경에 적합.

### Verified
- stress-v44 — quiet 모드 출력 + 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.98 — 2026-05-20

**`leerness skill publish` 보안 사전 점검 통합** (사용자 글로벌 룰 보안 정책 자동화).

### Added — publish 보안 사전 점검
- `leerness skill publish` 명령 실행 전 `leerness health` 자동 호출.
- `issues.length > 0` 시 publish 중단 + exit 1:
  - 🚨 보안 사전 점검 (1.9.98): N건 issue 발견
  - 권장: `leerness audit --fix`
  - 우회: `--force` 또는 `--no-security-check`
- 통과 시: `✓ 보안 사전 점검 (1.9.98): 통과` 후 정상 publish

### Use Case
- 사용자가 `.env` 가 `.gitignore` 에 없는 상태에서 skill publish 시도 → 자동 차단.
- 시크릿 노출 사고 사전 방지.
- CI 통합 시 더욱 안전.

### Verified
- stress-v43 — publish 보안 사전 점검 + --force 우회 + 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.97 — 2026-05-20

**자율 모드 27 라운드 종합 보고서 갱신 + 마무리** (1.9.70 ~ 1.9.96).

### Internal — 비공개 종합 보고서
- `_reports/AUTONOMOUS_ROUNDS_1.9.70-1.9.96.md` 갱신 (이전 1.9.89 보고서 확장)
- 27 라운드 전체 요약 + 그룹화 (보안 / MCP 21개 / handoff 5단 / JSON 옵션 9종)
- 성능 측정 (handoff 700ms · health 720ms · audit 350ms · drift 400ms)
- 디버그 기록 6건
- 사용자 명시 정책 7개 모두 ✓

### Stats
- 자율 모드 27 라운드 (1.9.70 ~ 1.9.96)
- MCP 도구: 12 → 21개
- 새 명령: env check/sync, health, skill search
- JSON 옵션: 9종 (handoff, lessons, skill list/info/search, health, env check, benchmark, drift check)

### Verified
- e2e 219/219 매 라운드 PASS 유지

---

## 1.9.96 — 2026-05-20

**`leerness handoff --json` 옵션 추가** (외부 AI / MCP 통합용).

### Added
- `leerness handoff --json` — 구조화된 JSON 출력
  - `{ date, project, version, files: { sessionHandoff, currentState, plan, progressTracker, decisions, taskLog }, activeRules?: [...] }`
  - 각 file: `{ path, content }` (8000자 초과 시 truncated)
- 자동 회수 라인 (lessons / skill 추천 / history / brainstorm / 헤드라인)은 일반 모드에서만.
- 외부 AI(Claude Code, Cursor)가 handoff 데이터를 파싱 친화적으로 받음.

### Verified
- stress-v42 — handoff --json + 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.95 — 2026-05-20

**`leerness lessons --json` 옵션 + MCP leerness_lessons 자동 JSON 응답**.

### Added
- `leerness lessons --json` 옵션:
  - `{ query, total, lessons[]: { source, title, preview, truncated } }`
- MCP `leerness_lessons` 도구가 자동으로 `--json` 적용 → 구조화 응답.
- 외부 AI(Claude Code, Cursor)가 lessons 결과를 파싱 친화적으로 받음.

### Verified
- stress-v41 — lessons --json + 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.94 — 2026-05-20

**MCP server 21번째 도구 `leerness_benchmark`** (1.9.46/51 benchmark 외부 노출).

### Added — MCP 21번째 도구
- `leerness_benchmark` — 1.9.46 6 차원 점수 + 1.9.51 검수 시나리오 결과를 외부 AI에 노출.
  - inputSchema: `{ path: string, scenario: string (optional) }`
  - 응답: benchmark --json 결과
    - `scenario` 없으면: `{ project, measured, leernessScore, total, compareSimulated }`
    - `scenario: 'all'` 등: `{ scenarios: [...], detectedCount, total }`
- benchmark --json 옵션은 이미 존재 (1.9.46/51) — MCP 노출만 추가.
- MCP server 도구 카운트: **20 → 21**.

### Verified
- stress-v40 — MCP 21 도구 + benchmark 호출 + 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.93 — 2026-05-20

**handoff 헤드라인에 health 종합 상태 1 토큰 추가** (1.9.81 + 1.9.85 통합).

### Improved — 헤드라인 health 토큰
- 1.9.81 통합 헤드라인 끝에 `⚕ health: ✓` 또는 `⚕ health: ⚠` 1 토큰 추가.
- inline 추론 (자식 spawn 없음, 성능 비용 최소):
  - `.env` 가 `.gitignore` 에 포함되면 ✓
  - 누락이면 ⚠
- 헤드라인 라벨도 `(1.9.81/93)` 으로 갱신.
- 예:
  ```
  📊 헤드라인 (1.9.81/93): drift healthy (0) · 📚 9 skills · ⚕ health: ✓
  📊 헤드라인 (1.9.81/93): drift attention (45) · 🚨 보안 위험 · 📚 9 skills · ⚕ health: ⚠
  ```

### Use Case
- AI 에이전트가 handoff 1줄로 워크스페이스 헬스 즉시 인지 (별도 `leerness health` 호출 불필요).

### Verified
- stress-v39 — health 토큰 노출 + 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.92 — 2026-05-20

**`skill info --json` + MCP 20번째 도구 `leerness_skill_info`**.

### Added
- `leerness skill info <id> --json` 옵션 신규 추가 (CI 친화 + MCP 통합 기반).
  - 출력 필드: id / displayNameKo / source / version / lastUpdated / verification / usage / capabilities / sources / patterns / optimizations
- **MCP 20번째 도구** `leerness_skill_info`:
  - inputSchema: `{ id: string (required), path: string }`
  - 외부 AI가 개별 skill의 능력/사용 이력/패턴 정확 파악.
- MCP server 도구 카운트: **19 → 20**.

### Verified
- stress-v38 — skill info --json + MCP 20 도구 + 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.91 — 2026-05-20

**MCP server 19번째 도구 `leerness_skill_search`** (1.9.90 외부 AI 노출).

### Added — MCP 19번째 도구
- `leerness_skill_search` — 1.9.90 skill search 명령을 외부 AI에 노출.
  - inputSchema: `{ capability: string (required), path: string }`
  - 응답: `skill search --json` 결과
- 외부 AI가 capability 키워드로 사용 가능한 skill 직접 검색.
- MCP server 도구 카운트: **18 → 19**.

### Verified
- stress-v37 — MCP 19 도구 + skill_search 호출 + 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.90 — 2026-05-20

**`leerness skill search <capability>` 새 명령** — capability 배열 부분 일치 검색.

### Added — `leerness skill search`
- `leerness skill search "<capability>"` — capability 키워드로 skill 검색.
  - substring + case-insensitive 매칭.
  - `--json`: 구조화 출력 (`{ query, total, matches[] }`).
- skill match (jaccard 점수 매칭)과 다름:
  - `skill match`: 자연어 task → 점수 기반 추천
  - `skill search`: capability 필드에 정확히 키워드 포함된 skill만
- 예:
  ```
  leerness skill search "API"   → commerce-api
  leerness skill search "검증"  → firebase, ai-verified-skill-publisher
  ```

### Use Case
- "내가 이 능력을 가진 skill을 찾고 싶다" 명확한 의도에 사용.
- skill match가 너무 광범위할 때 capability로 좁히기.

### Verified
- stress-v36 — search 명령 + 부분 일치 + --json + 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.89 — 2026-05-20

**자율 모드 19 라운드 종합 검증 + 마무리** (1.9.70 ~ 1.9.88).

### Verified — stress-v35 24/24 PASS
- 19 라운드 모든 핵심 기능 (R70~R88) 개별 검증
- MCP server 18 도구 노출 확인
- 성능 종합 측정:
  - handoff (전체 통합) **692ms** / health **689ms** / audit 345ms / drift check 383ms
  - 누적에도 회귀 없음 (절대 임계 모두 통과)

### Internal — 종합 보고서
- `_reports/AUTONOMOUS_ROUNDS_1.9.70-1.9.88.md` (비공개, 사용자 검토용)
- 19 라운드 그룹화: 보안 라인 / MCP 도구 / 학습·회고 / handoff 5단 통합
- 디버그 기록 6건 (모두 진단 + 수정 후 PASS)

### e2e
- **219/219 PASS** 유지

---

## 1.9.88 — 2026-05-20

**`handoff`에 brainstorm 자동 hits 노출** (1.9.72 brainstorm 통합).

### Added — handoff 자동 brainstorm hits
- handoff 자동 skill 추천 (1.9.67) + history hit (1.9.69) 블록 끝에 추가:
  - **🧩 brainstorm 자동 hits (1.9.88)** — 현재 task 키워드로 자동 호출
  - 미리보기 1줄씩: `💭 decisions` / `⚠ lessons` / `📜 task-log fail` / `📚 skill`
  - 최대 4건 노출.
- 모든 데이터 없으면 출력 안 함 (잡음 방지).
- 끄기: `--no-brainstorm-hits` 또는 `LEERNESS_NO_BRAINSTORM_HITS=1`.

### Use Case
- AI 에이전트가 세션 시작 시 같은 주제 과거 결정/실패/skill을 즉시 인지.
- "같은 키워드로 어떤 결정을 내렸지?" "어떤 실패가 있었지?" "어떤 skill 썼지?" 한 줄씩 자동 회수.

### Verified
- stress-v34 — handoff brainstorm hits 노출 + --no-brainstorm-hits + 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.87 — 2026-05-20

**`session-workflow.md` 템플릿에 1.9.69~86 누적 신규 기능 안내 추가** (init 가이드 정확성).

### Updated
- `init` 시 생성되는 `.harness/session-workflow.md` 템플릿 갱신:
  - `📊 빠른 체크리스트` — `leerness health` / `.env` ↔ `.env.example` / `LEERNESS_AUTO_SECURITY_FIX` 라인 추가.
  - 안내 라인 7개 추가:
    - 1.9.69+ handoff history hit
    - 1.9.76+ handoff 보안 요약
    - 1.9.80+ CRITICAL + 자동 회복
    - 1.9.81+ 통합 헤드라인
    - 1.9.85+ `leerness health` 종합 점검
    - 1.9.78/82+ drift `--auto-fix` 보안 회복
    - 1.9.86+ MCP **18 도구** 목록
- AI 에이전트가 `init` 직후 곧바로 최신 워크플로 인지 가능.

### Verified
- stress-v33 — session-workflow.md 안내 포함 확인 + 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.86 — 2026-05-20

**MCP server 18번째 도구 `leerness_health` 추가** (1.9.85 health 외부 AI 노출).

### Added — MCP 18번째 도구
- `leerness_health` — 1.9.85 종합 헬스 체크를 외부 AI에 노출.
  - inputSchema: `{ path: string, strict: boolean }`
  - 응답: `health --json` 결과 (drift + security + skills + usage + tasks + issues)
  - 외부 AI가 워크스페이스 상태 한 번에 인지.
- MCP server 도구 카운트: **17 → 18**.

### Use Case
- Claude Code / Cursor가 사용자 워크스페이스에서 작업 시작 시 → `leerness_health` 호출 → drift/보안/skill/MCP 상태 즉시 파악 → 적절한 행동 결정.
- "이 워크스페이스 보안 안전한가?" "어떤 skill 있나?" "MCP 호출 패턴은?" 한 호출로 답변.

### Verified
- stress-v32 — MCP 18 도구 + health 호출 + JSON 응답 + 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.85 — 2026-05-20

**`leerness health` 새 명령** — 종합 헬스 체크 (drift + 보안 + skill + MCP + 누적 통계).

### Added — `leerness health [<path>]`
- 종합 진단 한 번에:
  - `drift`: level + score + fired 개수
  - `보안`: .env 존재 / .gitignore에 .env 포함 / .env.example 누락 키 / .gitignore 시크릿 패턴 누락
  - `skills`: 설치 수 / skill query 누적 (rolling history)
  - `usage`: 명령 호출 총수 + 종류 / MCP 호출 총수 + 종류 / since
  - `tasks`: progress-tracker 총수 + 상태별 카운트
- **`issues`** 배열에 발견된 모든 문제 자동 집계.
- `--json`: 구조화된 JSON 출력 (CI 친화).
- `--strict`: issue ≥ 1 시 exit 1.

### Use Case
- 사용자: `leerness health .` 한 줄로 워크스페이스 전체 상태 즉시 확인.
- CI 통합: `leerness health . --strict` 로 보안/drift 문제 자동 감지.
- 1.9.78 drift + 1.9.75/76/80 보안 + 1.9.70 MCP 통계 + 1.9.79 skill suggest의 모든 신호를 한 곳에 집계.

### Verified
- stress-v31 — health 출력 / --json / --strict / 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.84 — 2026-05-20

**MCP server 17번째 도구 `leerness_skill_list` 추가** (외부 AI에 skill 목록 조회 노출).

### Added — MCP 17번째 도구
- `leerness_skill_list` — 워크스페이스에 설치된 skill 목록 조회.
  - inputSchema: `{ path: string }`
  - 응답: `skill list --json` 결과 (skillpack 출처 + items 배열: id/displayNameKo/source/capabilities/usageCount/lastUsed/lastUpdated)
  - 외부 AI가 사용 가능한 skill을 즉시 인지하여 적절한 능력 활용.
- `skill list --json` 옵션 신규 추가 (CI 친화).
- MCP server 도구 카운트: **16 → 17**.

### Use Case
- Claude Code / Cursor 가 작업 시작 시 → `leerness_skill_list` 호출 → 사용 가능한 skill 카탈로그 파악 → 적절한 능력 활용.
- skill_match와 결합: "이 task에 매칭되는 skill (skill_match) + 전체 skill 카탈로그 (skill_list)" 양방향 활용.

### Verified
- stress-v30 — MCP 17 도구 + skill_list 호출 + 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.83 — 2026-05-20

**MCP server 16번째 도구 `leerness_skill_match` 추가** (1.9.45/50/68 skill match 외부 노출).

### Added — MCP 16번째 도구
- `leerness_skill_match` — 사용자 task 키워드에 매칭되는 설치된 skill 추천.
  - inputSchema: `{ query: string (required), path: string, useEmbedding: boolean }`
  - 응답: `skill match --json` 결과 (query / total / matched / top[].id/name/description/score)
  - 1.9.68 rolling history 자동 누적 (`.harness/skill-suggestions.md`)
  - 1.9.79 skill suggest 알고리즘에 자동 누적된 query 반영 가능
- MCP server 도구 카운트: **15 → 16**.

### Verified
- stress-v29 — MCP 16 도구 + skill_match 호출 + rolling history 누적 + 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.82 — 2026-05-20

**`drift check --auto-fix` 에 보안 회복 통합** (1.9.78 + 1.9.75 audit --fix 결합).

### Added — drift --auto-fix 보안 자동 회복
- 1.9.39 `drift check --auto-fix` 확장:
  - 기존: critical level 시 `session close` 자동 실행.
  - **신규 (1.9.82)**: 보안 신호 (1.9.78) 발견 시 **우선 `audit --fix` 자동 실행** → `.gitignore` + `.env.example` 동기화 → 재검사.
- 호출 순서:
  1. drift 신호 평가 (5개)
  2. 보안 신호 fired → `audit --fix` 자동 실행 + 재귀 재검사
  3. (보안 없는 critical) → `session close` 자동 실행 + 재귀 재검사
- AI 에이전트가 `drift check --auto-fix` 한 번으로 보안 + 세션 마감 둘 다 자동 회복.

### Verified
- stress-v28 — drift --auto-fix 보안 회복 / 재검사 후 안정화 / 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.81 — 2026-05-20

**`handoff` "통합 헤드라인" 한 줄 요약** (drift + 보안 + skill + MCP).

### Added — handoff 헤드라인
- Date / Project 라인 직후에 한 줄 요약 자동 노출:
  ```
  📊 헤드라인 (1.9.81): drift healthy (0) · 🔒 보안 OK · 🔌 MCP 8회 · 📒 skill query 4회 · 📚 12 skills
  ```
- 표시 요소:
  - `drift <level> (<score>)` — 1.9.78 5신호 결과
  - `🔒 보안 OK` 또는 `🚨 보안 위험` — 1.9.76 보안 요약 압축
  - `🔌 MCP N회` — 1.9.70 MCP 누적 카운트
  - `📒 skill query N회` — 1.9.68 rolling history 누적
  - `📚 N skills` — 설치된 skill 총 수
- 데이터 없는 항목은 자동 생략 (잡음 방지).
- 끄기: `--no-headline` 또는 `--compact`.

### Use Case
- AI 에이전트가 한 줄로 워크스페이스 상태 즉시 인지 → "drift attention인데 MCP 0회면 도구 안 쓰고 있다" 같은 빠른 판단.

### Verified
- stress-v27 — 헤드라인 노출 / --no-headline / 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.80 — 2026-05-20

**handoff에서 `.env` 보안 critical 시 자동 회복 옵션** (1.9.76 보안 요약 + 1.9.75 audit --fix 결합).

### Added — 보안 critical 자동 회복
- 1.9.76 handoff 보안 요약 블록 확장:
  - `.env` 가 `.gitignore` 에 없으면 **🚨 CRITICAL** 경고.
  - 즉시 `leerness audit --fix` 권장 안내.
- **자동 실행 옵션**: `LEERNESS_AUTO_SECURITY_FIX=1` 환경변수 활성 시 handoff에서 `audit --fix` 자동 실행.
  - 시크릿 노출 위험 즉시 회복.
  - 성공 시 `✓ 자동 회복 (LEERNESS_AUTO_SECURITY_FIX=1)` 메시지.

### Use Case
- 사용자가 `.env` 를 무심코 만들었지만 `.gitignore` 에 추가 안 한 상태 → 다음 handoff에서 즉시 인지 + 옵션 활성 시 자동 회복.
- 1.9.78 drift 보안 신호 + 1.9.76 handoff 요약 + 1.9.80 자동 회복 = **3중 보안 가드** 완성.

### Verified
- stress-v26 — handoff CRITICAL 메시지 / 자동 회복 / 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.79 — 2026-05-20

**`leerness skill suggest` 알고리즘 강화** (1.9.68 rolling history 빈도 활용 — Hermes-style 학습 신호 보강).

### Improved — skill suggest 학습 신호 확장
- 기존 신호 (1.9.53): task-log.md / progress-tracker.md / usage-stats.commands.
- **추가 신호 (1.9.79)**: `.harness/skill-suggestions.md` rolling history 빈도.
  - 같은 키워드를 2회 이상 `skill match`로 검색했다면 **학습 신호로 가중** (×2).
  - 예: 사용자가 "payment 결제 자동화" 를 3번 검색 → keyword "payment" 의 score `+6`.
  - 출처: `progress+history` 로 표시 + `historyHits` 필드 노출.
- 후보 점수 = task-log 매치 + progress 토큰 매치 + usage 카운트 + **history 빈도 × 2**.

### Use Case
- AI 에이전트가 반복적으로 같은 주제를 검색했다면 → **이 주제는 신규 skill로 등록할 가치가 큼** 자동 식별.
- Hermes-style 자동 학습 강화 (`leerness skill learn` 권장 정확도 향상).

### Verified
- stress-v25 — history 가중 + 누적 회귀 + 성능.
- e2e 219/219 PASS 유지.

---

## 1.9.78 — 2026-05-20

**`drift check`에 5번째 신호 추가 — 보안 누락이 drift score 가중** (1.9.75/76 보안 검사 통합).

### Added — drift check 보안 신호
- 기존 4 신호: session-handoff / current-state / progress-tracker / task-log.
- **5번째 신호**: `.env` + `.gitignore` 보안 점검.
  - `.env→.env.example` 누락 → +15 score.
  - `.gitignore`에 `.env` 누락 → **+30 score** (최우선 위험).
  - 기타 시크릿 패턴 (`.env.local`, `*.pem`, `credentials.json` 등) 누락 → max +20 (개당 +5).
- `drift check --json` 의 `fired` 배열에 새 항목 추가:
  ```json
  {
    "file": ".env / .gitignore",
    "weight": 45,
    "label": "보안 위험 (1.9.78): .env→.env.example 누락 N건 · .gitignore 시크릿 누락 M건"
  }
  ```
- 보안 누락이 drift level을 critical로 승격시킬 수 있음 (CI 친화).

### Use Case
- 매 \`leerness handoff\` 시 drift 신호로 보안 위험 즉시 인지 (1.9.76 보안 요약과 동시).
- AI 에이전트가 drift critical 시 \`drift check --auto-fix\` → `audit --fix` 호출 → 자동 회복.

### Verified
- stress-v24 — drift 보안 신호 + level 승격 + 1.9.43~77 누적 회귀 + 성능.
- e2e 219/219 PASS 유지.

---

## 1.9.77 — 2026-05-20

**MCP server 15번째 도구 `leerness_brainstorm` 추가** (1.9.72 brainstorm 외부 노출).

### Added — MCP 15번째 도구
- `leerness_brainstorm` — 1.9.16/72 brainstorm 명령을 MCP 도구로 노출.
  - inputSchema: `{ topic: string (required), path: string, allApps: boolean }`
  - 응답: brainstorm --json 결과 (decisions + skills + tasks + rules + evidence + lessons + skillHistory + taskLogFails).
  - 외부 AI 에이전트가 새 작업 시작 전 누적 컨텍스트 자동 회수 가능.
- MCP server 도구 카운트: **14 → 15**.

### Use Case
- Claude Code / Cursor 가 사용자 요청을 받으면 자동으로 `brainstorm` 호출 → 같은 주제 과거 결정/스킬/실패 회수.
- 같은 실수 반복 방지 + 누적 학습 활용.

### Verified
- stress-v23 — MCP 15 도구 + brainstorm 호출 + 1.9.43~76 누적 회귀 + 성능.
- e2e 회귀: 219/219 PASS 유지.

---

## 1.9.76 — 2026-05-20

**`leerness handoff`에 보안 상태 요약 자동 표시** (1.9.71 env + 1.9.75 gitignore 결합).

### Added — handoff 보안 요약
- 매 `leerness handoff` 시 `.env` 파일이 존재하면 다음을 자동 검증해 1-2 line으로 표시:
  - `.env→.env.example` 누락 키 (1.9.71)
  - `.gitignore` 시크릿 패턴 누락 (1.9.75)
- 정상 시 출력 없음 (잡음 방지).
- 위험 시:
  ```
  ## 🔒 보안 요약 (1.9.76) — N건 주의
    ⚠ .env→.env.example 누락 X건
    ⚠ .gitignore 시크릿 누락 Y건
    → 자동 수정: leerness audit --fix · 상세: leerness env check / leerness audit
  ```
- 끄기: `--no-security-summary` 또는 `--compact` (compact mode와 자동 통합).

### Use Case
- AI 에이전트가 **세션 시작 시 즉시 보안 위험 인지** — 사용자에게 명시적으로 알리고 자동 수정 제안.

### Verified
- stress-v22 — 보안 요약 노출 / 정상 시 OK / --no-security-summary + 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.75 — 2026-05-20

**`leerness audit` 보안 강화 — `.gitignore` 시크릿 패턴 자동 검증** (사용자 글로벌 룰 ".gitignore 보안 체크리스트" 정책 자동화).

### Added — audit `.gitignore` 보안 검증
- `.env` 파일이 존재할 때 다음 패턴이 `.gitignore`에 포함되는지 자동 검증:
  - `.env`, `.env.local`, `.env.production`, `.env.*.local`
  - `*.pem` (private keys)
  - `credentials.json`
- 누락 시 warning + `--fix`로 자동 추가 (1.9.75 안내 코멘트 동반).
- `--no-gitignore-check`로 비활성화.
- `audit --strict` 와 결합 시 보안 누락이 failure로 승격됨 (CI 친화).

### Verified
- stress-v21 — gitignore 검증 + --fix 추가 + 1.9.43~74 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.74 — 2026-05-20

**`session close` 마감 시 누적 회고 통계 강화** (1.9.70 MCP + 1.9.68 history 결합).

### Improved — session close --suggest 블록 확장
- 기존: skill suggest 후보 / drift 상태 / 가장 많이 쓴 명령 top 3.
- **신규** 라인:
  - `🔌 MCP 호출 (1.9.74): 총 N회, top: tool(n), ...` + `💡 드물게 호출된 MCP: ...` (1.9.70 통계 연동).
  - `📒 skill match query 누적 (1.9.74): 총 N회 / 종류 M개` + top 3 query 표시 (1.9.68 rolling history 집계).
- AI 에이전트가 한 세션의 사용 패턴을 한눈에 파악 가능.

### Verified
- stress-v20 — session close 회고 통계 + 1.9.43~73 누적 회귀.
- e2e 219/219 PASS 유지.

---

## 1.9.73 — 2026-05-20

**MCP server 14번째 도구 `leerness_env_check` 추가 (1.9.71 env 보안을 외부 AI에 노출)**.

### Added — MCP 14번째 도구
- `leerness_env_check` — 워크스페이스 `.env` ↔ `.env.example` 동기화 검사를 외부 AI 에이전트에 노출.
  - inputSchema: `{ path: string }`
  - 응답: 1.9.71의 `env check --json` 결과 그대로 (envPath/examplePath/envKeys/exKeys/inEnvOnly/inExampleOnly).
  - 외부 AI가 워크스페이스 보안 자동 점검 가능 (Claude Code/Cursor 등에서 호출).
- MCP server 도구 카운트: 13 → **14**.

### Verified
- stress-v19 — MCP 14 도구 + env_check JSON 응답 + 1.9.43~72 누적 회귀 + 성능.
- e2e 회귀: 219/219 PASS 유지.

---

## 1.9.72 — 2026-05-20

**`leerness brainstorm`에 skill-suggestions.md history + task-log 실패 라인 통합**.

### Improved — brainstorm 자원 회수 확장
- 기존: decisions / skills / tasks / rules / evidence / lessons.
- **신규**: `skillHistory` (1.9.68 rolling history) + `taskLogFails` (1.9.67 task-log 실패 라인).
- 출력 추가 섹션:
  - `📒 같은 주제 이전 skill match 이력` — `[timestamp] "query"` 형식
  - `📜 task-log 실패 라인` — 실패/롤백/incomplete/버그 라인 회수
- total 카운트에 신규 필드 합산.
- 매칭 알고리즘: 기존 unicode word boundary regex 그대로 사용.

### Verified
- stress-v18 — brainstorm 신규 hits + 누적 회귀 + 성능.
- e2e 회귀: 219/219 PASS 유지.

---

## 1.9.71 — 2026-05-20

**`.env` / `.env.example` 자동 동기화 (보안 정책: 키만, 실제 값 절대 노출 안 함)**.

### Added — `leerness env check` / `env sync` 명령
- `leerness env check [<path>]` — `.env`에 있는데 `.env.example`에 없는 키 / 반대도 자동 감지.
  - `--json`: 구조화된 JSON 출력 (CI 친화).
  - exit code: `.env.example` 누락 키 ≥1 시 1 (보안 가시화).
- `leerness env sync [<path>]` — 누락 키만 `.env.example` 끝에 append (값은 빈 문자열).

### Improved — `leerness audit` 통합
- 매 audit 시 `.env` ↔ `.env.example` 자동 비교, 누락 시 warning 추가.
- `audit --fix` 시 누락 키 자동 추가 (보안 정책: 실제 값 미노출).
- `--no-env-check`로 비활성화 가능.

### 보안 정책 (검증됨)
- `.env`의 실제 값은 **절대** `.env.example`로 옮기지 않음.
- 추가되는 줄: `KEY=` (빈 문자열).
- 사용자 글로벌 룰 (.env 보안) 준수.

### Verified
- stress-v17 — env check / sync / audit 통합 + 보안 정책 + 누적 회귀.
- e2e 회귀: 219/219 PASS 유지.

---

## 1.9.70 — 2026-05-19

**MCP server `tools/call` 자동 사용 통계** (1.9.65 usage-stats 확장).

### Added — MCP 도구별 호출 카운트
- MCP server가 `tools/call` 요청을 받을 때마다 도구 이름별 카운트를 `.harness/cache/usage-stats.json`의 `mcp.tools` 섹션에 기록.
- 별도 mtime 캐시 invalidation (1.9.65 _USAGE_CACHE 재활용).
- `leerness usage stats` 출력에 MCP 섹션 자동 노출:
  ```
  ## 🔌 MCP tools/call 통계 (1.9.70) — last: <ISO>
  | MCP 도구 | 호출 수 |
  | leerness_handoff | 8 |
  | ... |
  💡 드물게 호출된 도구 (≤N): leerness_xxx, ...
  ```
- 드물게 호출되는 도구 (전체 5% 미만)를 자동 식별 — AI 에이전트가 안 쓰는 도구가 있다는 가시화.

### Internal
- 새 헬퍼: `_bumpMcpUsage(root, toolName)` — atomic write + 캐시 invalidation.
- usage-stats.json 스키마 확장:
  ```json
  {
    "commands": {...},
    "drift": {...},
    "mcp": { "tools": {...}, "lastTool": "...", "lastAt": "..." }
  }
  ```

### Verified
- stress-v16 — MCP 카운트 정합성 + 13 도구 종합 호출 + 1.9.43~69 누적 회귀 + 성능.
- e2e 회귀: 219/219 PASS 유지.

---

## 1.9.69 — 2026-05-19

**handoff에 skill-suggestions.md rolling history hit 노출 (1.9.67 + 1.9.68 결합)**.

### Added — handoff history hit
- 매 `leerness handoff`마다 현재 task 키워드와 매칭되는 **이전 세션의 `skill match` 결과**를 함께 노출.
- 매칭: 현재 키워드 (≥4자, 7할 길이)의 fuzzy regex로 `skill-suggestions.md`의 query 헤더 검색.
- 표시: 최근 2건 + 각 블록의 top 2 매치 라인.
- AI 에이전트는 **이전 세션과 같은 결정을 일관되게 유지** 가능.
- 끄기: 같은 `--no-skill-suggest` / `LEERNESS_NO_SKILL_SUGGEST=1`.

### Internal
- `_loadSkillHistory(root)` + `_SKILL_HISTORY_CACHE` — mtime 기반 메모리 캐시 (1.9.65/66/67 캐시 패밀리 연속).
- 같은 프로세스에서 `_lidx` / `_SKILLS_LIST_CACHE` / `_USAGE_CACHE`와 함께 lifetime 공유.

### Verified
- stress-v15 — history hit 노출 + 비매칭 시 출력 안 함 + mtime invalidation + 누적 회귀.
- e2e 회귀: 219/219 PASS 유지.

---

## 1.9.68 — 2026-05-19

**`skill match` rolling history 자동 누적 + 종합 회귀**.

### Added — skill match rolling history (default ON)
- `leerness skill match <query>` 호출 시 결과를 `.harness/skill-suggestions.md`에 append 누적.
- frontmatter: `leernessRole: skill-suggestions`, `readWhen: ['skill 결정 전', '세션 시작']`.
- 형식:
  ```
  ## YYYY-MM-DD HH:MM:SS — query "<keyword>"
  - Algorithm: jaccard|embedding
  - Top N matches:
    - [점수] skill-id — description
  ```
- AI 에이전트가 같은 키워드를 반복 검색하지 않고 이력 참조 가능.
- 끄기: `--no-save` 또는 `LEERNESS_NO_SKILL_HISTORY=1`.

### Updated
- `_banner` quickStart: 1.9.68 안내 라인 추가.

### Verified — 종합 회귀 + 성능 측정
- stress-v14 (1.9.68 + 1.9.43~67 누적 회귀 + 성능 벤치마크) — 모든 시나리오 PASS.
- 이전 중요 기능 12종 정상 동작 검증:
  - MCP 13 도구 / drift check / benchmark scenario / skill suggest / lessons --auto
  - session close --suggest default / audit --strict / install 별칭 / task export
  - handoff 자동 skill 추천 (1.9.67) / listAllSkills 캐시 (1.9.66) / usage-stats 캐시 (1.9.65)
- 성능 (warm-up 적용): status / handoff / drift / audit / skill list / skill match.
- e2e 회귀: 219/219 PASS 유지.

---

## 1.9.67 — 2026-05-19

**handoff 자동 skill 추천 default ON + lessons 인덱스에 task-log 통합**.

### Added — handoff 자동 skill match (default ON)
- 매 `leerness handoff` 시 **현재 in-progress task와 매칭되는 설치된 skill을 자동 추천** (점수 + skill id + description 미리보기).
- 1.9.45의 `LEERNESS_SKILL_AUTO_DISCOVER=1` opt-in 환경변수 의존성 제거 → default 활성.
- 끄기: `--no-skill-suggest` 또는 `LEERNESS_NO_SKILL_SUGGEST=1`.
- 매칭 알고리즘: `_jaccard(task.request_tokens, skill.name+description_tokens)`, top 3.
- 매칭 점수 0이면 출력 안 함 (잡음 최소화).

### Improved — lessons 인덱스 확장
- `_loadLessonsIndex`에 **task-log.md 실패 라인** 추가 (mtime 기반 invalidation).
- `_lidx.taskLogFails: [{title, block}]` 새 필드.
- handoff lessons 자동 재상기에서 task-log fuzzy 매칭도 가능.
- `leerness lessons` 명령도 같은 인덱스 사용 (split 1회).

### Updated
- `_banner` quickStart: "13 도구 노출 (task_export 포함)" + "매칭 skill 자동 추천" 안내.
- `.harness/session-workflow.md` 템플릿: 1.9.67 라인 추가.

### Verified
- stress-v13 (1.9.67 검증) — handoff skill match default + --no-skill-suggest + lessons task-log fuzzy.
- e2e 회귀: 219/219 PASS 유지.

---

## 1.9.66 — 2026-05-19

**성능 최적화 2차 + MCP 13번째 도구**.

### Performance
- **`listAllSkills` 메모리 캐시 (`_SKILLS_LIST_CACHE`)** — userSkillsDir mtime 기반 캐시. `skill list/info/match/discover/suggest` 가 같은 인덱스 공유.
- `saveUserSkill`/`skillRemove`에서 캐시 invalidate — skill 추가/제거 즉시 반영.

### MCP server — 13번째 도구
- **`leerness_task_export`** — 1.9.60 TodoWrite 호환 JSON을 외부 에이전트(Claude Code, Cursor 등)에 노출. `to: <path>` 또는 stdout JSON 모두 지원.
- MCP server 도구 카운트: 12 → **13**.

### Verified
- stress-v12 (1.9.66 검증) — listAllSkills 캐시 정합성 + MCP 13 도구 + warm-up 1회 시나리오 보강.
- e2e 회귀: 219/219 PASS 유지.

---

## 1.9.65 — 2026-05-19

**성능 최적화 1차 — usage-stats 메모리 캐시 + lessons 인덱스 캐시**.

### Performance
- **usage-stats 메모리 캐시 (`_USAGE_CACHE`)** — 같은 프로세스 lifetime 동안 `.harness/cache/usage-stats.json`을 mtime 기반으로 한 번만 파싱. `_readUsageStats()` 다중 호출 시 디스크 I/O 절감.
- **lessons 인덱스 캐시 (`_LESSONS_INDEX_CACHE`)** — `review-evidence.md` + `decisions.md`를 mtime 기반으로 1회 read+split, 블록 인덱스를 메모리에 보관.
  - handoff의 lessons 자동 재상기: 키워드별 fuzzy 매칭이 split 재실행 없이 인덱스 순회로 동작.
  - `leerness lessons` 명령도 같은 인덱스 재활용.
- 벤치마크 워크스페이스 크기 비례 비용 → 사실상 O(1) (인덱스 hit 시).
- API 호환성 유지 — 캐시는 mtime invalidation이라 외부에서 파일을 수정해도 자동 재로드.

### Verified
- stress-v11 (1.9.64 baseline ↔ 1.9.65 optimized 정량 비교) — 13/14 PASS, 캐시 정합성 3/3 PASS.
- 성능: handoff -37% / drift -19% / audit -29% / skill list -17% / 100-task handoff -42% / 50-evidence handoff 1048ms.
- status 클린 환경 측정: median 623ms (v10 1195ms 대비 -48% 개선).
- e2e 회귀: 219/219 PASS 유지.

---

## 1.9.64 — 2026-05-19

**`leerness install <skill>` 별칭 + 성능 벤치마크 1차 실측**.

### Added
- **`leerness install <SKILL.md path or URL>`** — `skill install` 별칭:
  - 자주 쓰는 명령 단축 (agentskills.io 컨벤션 맞춤)
  - 디렉토리만 주면 init 의도로 친절 안내 (`leerness init` 권장)
- 인자 없으면 사용법 안내

### 📊 성능 벤치마크 1차 (stress-v10)

10회 평균 latency (Node.js spawnSync cold start 포함):

| 명령 | median | p95 |
|---|---:|---:|
| status | 1330ms | 1426ms |
| handoff --compact | 1378ms | 2500ms |
| drift check | 1303ms | 1782ms |
| audit | 1159ms | 1806ms |
| skill list | 1526ms | 2503ms |
| handoff (100 task) | 1176ms | - |
| task export (100 task) | 2163ms | - |
| skill suggest (30 task) | 1075ms | - |

### 1.9.65+ 성능 최적화 후보 (벤치마크에서 도출)
- `.harness/cache/usage-stats.json` 파일 I/O 캐싱
- handoff의 lessons fuzzy 매칭 워크스페이스 크기에 비례 → 키워드 캐시

## 1.9.63 — 2026-05-19

**`leerness audit --strict` — CI 친화 옵션 (warnings → failures 승격)**.

### Added
- **`--strict [--threshold N]`** — warnings ≥ N (기본 1) 시 failures 승격 → exit 1
- CI 환경에서 audit warning 무시 방지

### 검증 (stress-v10 + 누적 회귀)
- EE1-EE3 (audit --strict) 3/3 PASS
- FF1-FF3 (install 별칭) 3/3 PASS
- GG1-GG5 (성능 벤치마크 10회 평균) 5/5 PASS
- HH1-HH3 (큰 워크스페이스 100 task) 3/3 PASS
- II1-II3 (1.9.43~62 회귀) 3/3 PASS
- **stress-v10: 17/17 PASS**, e2e: **219/219 PASS**

## 1.9.62 — 2026-05-19

**`leerness audit`에 npm CVE 자동 감지 통합**.

### Added
- **`leerness audit`** — package.json 있으면 `npm audit --json` 자동 호출 → CVE 보고:
  - `metadata.vulnerabilities` 파싱 → critical/high/moderate/low 카운트
  - critical/high 발견 시 warnings +2 (가중치)
  - 0건이면 ✓ "npm CVE: 0건"
- **스킵 조건** (자동): package.json 없음, `LEERNESS_OFFLINE=1`, `--no-npm-audit` 플래그

## 1.9.61 — 2026-05-19

**MCP server cursor 기반 페이지네이션**.

### Added
- **MCP `tools/call` 응답에 cursor 메타 추가** — 50KB 넘는 출력 자동 분할:
  - `result.nextCursor` — 다음 청크 offset (`args._cursor`로 재호출)
  - `result._truncated` — `{ totalLength, returned, hint }` 메타
  - 청크 크기 override 가능: `args._chunkSize` (기본 50000)
- 사용 예: 100 task 워크스페이스의 handoff → 청크 1 → cursor → 청크 2 → ... 완료

## 1.9.60 — 2026-05-19

**`leerness task export` — TodoWrite ↔ leerness 양방향 sync 완성**.

### Added
- **`leerness task export [--to <file>] [--json]`**:
  - progress-tracker → TodoWrite JSON 형식 변환
  - status 매핑: `done` → `completed`, `in-progress` → `in_progress`, `planned` → `pending`, `dropped` → `cancelled`
  - 필드: `content` / `status` / `activeForm` (TodoWrite 호환)
- 1.9.38 `task sync --from`(TodoWrite → leerness)과 함께 **양방향 sync 완성**

### 검증 (stress-v9)
- AA1-AA4 (task export + status 매핑 + round-trip) 4/4 PASS
- BB1-BB3 (MCP cursor 페이지네이션, chunkSize override) 3/3 PASS
- CC1-CC3 (audit npm CVE, OFFLINE/no-npm-audit/no-package.json 스킵) 3/3 PASS
- DD1-DD3 (1.9.43~59 누적 회귀) 3/3 PASS
- **stress-v9: 13/13 PASS** (BB2/BB3 BUG 발견·즉시 패치: chunkSize override 추가), e2e: **216/216 PASS**

## 1.9.59 — 2026-05-19

**`session close --suggest` default 활성 — 라운드 마감 잊을 단계 없음**.

### Changed (호환성 보장)
- **`leerness session close`** — 1.9.57 `--suggest`를 **default 활성**으로 승격:
  - 라운드 마감 시 자동으로 skill suggest + drift check + usage stats 통합 보고
  - 사용자가 잊지 않도록 default 동작
- **새 옵션 `--no-suggest`** — 이전 동작으로 복귀
- **새 env `LEERNESS_NO_SUGGEST=1`** — CI/자동화 환경에서 suggest 강제 비활성
- `--suggest` 명시 호출도 그대로 동작 (호환성)

### 설치 가이드 갱신
- banner quickStart에서 `--suggest` 명시 제거 (이제 default라 불필요)
- `.harness/session-workflow.md` Step 6 갱신 — `--no-suggest`로 비활성 가능 명시

## 1.9.58 — 2026-05-19

**handoff lessons fuzzy 매칭 (어간 변형 + decisions.md 매칭)**.

### Added
- **fuzzy 매칭** — `escapeRegex(keyword.slice(0, max(4, len*0.7)))` 으로 부분 매칭:
  - webhook ↔ webhooks ↔ webhook-payload ↔ webhooked 모두 매칭
  - 한국어 어미 변화도 부분 매칭 (예: "결제" ↔ "결제처리" ↔ "결제검증")
- **decisions.md 매칭 추가** — 이전엔 review-evidence.md만 → 이제 decisions.md의 *실패/롤백/취소/회귀* 결정도 자동 회수

### 검증 (stress-v8)
- X1-X4 (fuzzy 매칭: 어간/복합어/decisions/false positive 차단) 4/4 PASS
- Y1-Y4 (session close default suggest + 옵션 호환) 4/4 PASS
- Z1-Z4 (1.9.43~57 누적 회귀) 4/4 PASS
- **stress-v8: 12/12 PASS**, e2e: **213/213 PASS**

## 1.9.57 — 2026-05-19

**`session close --suggest` + 설치 가이드 갱신**.

### Added
- **`leerness session close --suggest`** — 라운드 마감 통합 보고:
  - skill suggest 후보 (Hermes-style 자동 학습) 상위 3
  - drift check 상태 + 임계 초과 신호
  - usage stats 가장 많이 쓴 명령 Top 3

### 설치 가이드 갱신
- **`_banner` quickStart 재구성** — 1.9.57+ 워크플로 강조:
  - `npx leerness handoff .` (lessons 자동 재상기 포함)
  - `npx leerness session close . --suggest` (마감 + 다음 라운드)
  - `npx leerness mcp serve` (메인 에이전트용 12 도구)
- **`.harness/session-workflow.md`** Step 6 갱신 — `--suggest`/1.9.56 lessons 자동 재상기 안내

## 1.9.56 — 2026-05-19

**`handoff`에 `lessons --auto` 자동 통합 — 매 세션 시작 시 과거 실패 자동 재상기**.

### Added
- **handoff 자동 lessons 재상기**:
  - 가장 최근 in-progress/planned task의 `request`에서 키워드 자동 추출
  - 그 키워드로 review-evidence.md의 과거 실패 매칭
  - **🧠 과거 lessons 자동 재상기** 블록 출력 (관련 실패 ≥1건 시)
  - 끄려면: `--no-lessons` 또는 `LEERNESS_NO_LESSONS=1`
- 매칭 실패 시 블록 자동 숨김 (false positive 차단)

### 검증 (stress-v7)
- T1-T3 (handoff 자동 lessons) 3/3 PASS
- U1-U3 (session close --suggest) 3/3 PASS
- V1-V2 (설치 가이드 갱신 — banner + session-workflow.md) 2/2 PASS
- W1-W4 (1.9.43~55 누적 회귀) 4/4 PASS
- **stress-v7: 12/12 PASS**, e2e: **210/210 PASS**

## 1.9.55 — 2026-05-19

**MCP server 12 도구 — `leerness_skill_suggest` + `leerness_lessons` 노출**.

### Added
- **MCP `leerness_skill_suggest`** (1.9.53 자동 학습을 외부 노출):
  - Claude Code/Hermes/Cursor가 `tools/call`로 호출 가능
  - args: `{ path, min, days }` → JSON candidates 반환
- **MCP `leerness_lessons`** (1.9.7/54 lessons를 외부 노출):
  - args: `{ path, query, auto, limit }`
- MCP 총 **10 → 12 도구**

## 1.9.54 — 2026-05-19

**`leerness lessons --auto` — 과거 lessons 자동 재상기**.

### Added
- **`leerness lessons --auto [--path X]`**:
  - 가장 최근 in-progress/planned task의 `request` 컬럼에서 키워드 자동 추출
  - 그 키워드로 lessons 자동 검색 (decisions / review-evidence / task-log / handoff)
  - 임계: 4자+ 키워드, 가장 긴 단어 선택
  - stopword 자동 제외 (한국어 + 영어 20+ 단어)
- **stopword 확장** (1.9.55 패치): "프로젝트/관리/기능/시스템" 등 너무 일반적인 단어 제외

### 검증 (stress-v6)
- Q1-Q3 (lessons --auto) 3/3 PASS
- R1-R3 (MCP 12 도구 + 신규 호출) 3/3 PASS
- S1-S4 (1.9.43~53 누적 회귀) 4/4 PASS
- **stress-v6: 10/10 PASS**, e2e: **208/208 PASS**

### 발견·패치 (stress-v6)
- 🟡 stopword 부족 → "프로젝트"가 default task에서 키워드로 잡혀 false positive
- 1.9.55 패치: stopword 20+ 단어로 확장

## 1.9.53 — 2026-05-19

**`leerness skill suggest` — Hermes-style 자동 학습 (사용 패턴 → skill 후보 자동 제안)**.

### 배경
1.9.2부터 `skill learn` / `skill use` / `skill optimize` / `skill consolidate` / `lessons` / `rule add` 등 자체 학습 인프라가 있었으나, **모두 명시 호출 필요**. Hermes처럼 *사용 중* 자동으로 새 skill을 만들지 못함.

### Added
- **`leerness skill suggest [--min N] [--days N] [--json]`** — Hermes-style 자동 학습의 leerness 버전:
  - **task-log.md** — `` `leerness X` `` 명령 인용 패턴 감지
  - **progress-tracker.md** — request/nextAction 컬럼의 4자+ 키워드
  - **usage-stats.json** — 명령별 누적 카운트
  - 임계 (`--min`, 기본 3회) 이상 + **기존 skill에 없는** 키워드만 후보로
  - `--days N` lookback (기본 30일)
  - 출처 (`task-log` / `progress` / `usage`) 자동 분류
- 실 워크스페이스 검증: 본 프로젝트에서 6 후보 자동 감지 (leerness 22회, publish 14회, github 5회 등)

### Hermes vs leerness 학습 비교 (1.9.53 후)
| 영역 | Hermes | leerness |
|---|---|---|
| 새 skill 자동 생성 | ✅ LLM 기반 | ⚠ 후보 제안만 (수동 등록 권장) |
| **반복 패턴 감지** | ✅ | ✅ **1.9.53 신규** |
| 사용 카운트 추적 | ✅ | ✅ 1.9.38 |
| 중복 자동 통합 | ✅ | ✅ 1.9.2 `skill consolidate` |
| 외부 docs 학습 | ✅ | ✅ 1.9.2 `skill learn --doc` |

### 검증 (필수 stress-v5)
- O1-O5 (skill suggest 시나리오) 5/5 PASS
- P1-P5 (1.9.43~52 누적 회귀) 5/5 PASS
- **stress-v5: 10/10 PASS** + e2e: **206/206 PASS**

## 1.9.52 — 2026-05-19

**`skill discover` 카탈로그 형식 다양성 (JSON/RSS/Markdown/llms.txt 자동 감지)**.

### Added
- **`_parseSkillCatalog(body, sourceUrl)`** 통합 파서 — 4 형식 자동 감지:
  1. **JSON manifest** — `{ "skills": [...] }` 또는 `[{...}]` (leerness `skill publish`가 만드는 형식과 호환)
  2. **RSS/Atom** — `<item><title>X</title><link>...</link><description>...</description></item>`
  3. **Markdown w/ description** — `- [name](url) — description`
  4. **llms.txt URL-only** — 단순 URL 라인
- 각 entry에 `format` 필드 추가 (json/rss/markdown/urls) — 출처 추적

### 검증 (stress-v4)
- M1-M5 5/5 PASS — 4 형식 인식 + 빈 body 안전 fallback

## 1.9.51 — 2026-05-19

**`benchmark --scenario` — leerness 고유 가치 시나리오 preset**.

### Added
- **`leerness benchmark --scenario <id|all> [--json]`** — 4 시나리오 자동 실행:
  - `false-completion` — 거짓 완료 자동 감지 (lazy detect)
  - `spec-mismatch` — 사양 ↔ 구현 불일치 (contract verify)
  - `drift-detection` — 메타파일 stale (drift check 4 신호)
  - `bom-handling` — UTF-8 BOM SKILL.md install (1.9.44 패치 효과)
- 각 시나리오: setup → measure → 감지 여부 + 시간 측정
- 결과: leerness 적용 워크스페이스에서 **4/4 정확 감지**

### 검증 (stress-v4 + 누적 회귀)
- L1-L4 (시나리오 preset) 4/4 PASS
- M1-M5 (카탈로그 4 형식 + 빈 body) 5/5 PASS
- N1-N5 (누적 회귀: MCP, skill match, publish, drift, agentskills round-trip) 5/5 PASS
- **stress-v4: 14/14 PASS**, e2e: **205/205 PASS**

### 결론
- 1.9.51로 leerness 고유 가치가 **command 한 번에 정량 증명** 가능
- 1.9.52로 다양한 카탈로그 형식과 호환 (agentskills.io 외 사용자 정의 RSS/JSON도)

## 1.9.50 — 2026-05-19

**`skill match --embedding` (Ollama opt-in 임베딩 매칭)**.

### Added
- **`leerness skill match <query> --embedding`** — Ollama embedding API로 cosine similarity 매칭:
  - `LEERNESS_OLLAMA_BASE_URL` 환경변수 필요 (opt-in 정책 유지)
  - `LEERNESS_OLLAMA_EMBED_MODEL` (기본: nomic-embed-text)
  - 네트워크 실패 시 jaccard로 자동 fallback (사용자 차단 X)
- 옵션 없으면 1.9.45 jaccard 그대로

## 1.9.49 — 2026-05-19

**`benchmark --measure` 실 측정 framework**.

### Added
- **`leerness benchmark --measure "<task>" [--json]`** — ready 외부 CLI (claude/codex/gemini)에 동일 task 호출 + 시간 측정:
  - 각 CLI 호출 시간 + leerness audit 검수 layer 시간 별도 측정
  - ready CLI 없으면 안내 메시지로 graceful
  - 다른 도구 대비 leerness 오버헤드 실측 가능

## 1.9.48 — 2026-05-19

**Cross-platform archive — tar 실패 시 PowerShell ZIP fallback**.

### Fixed
- 🟡 **1.9.47 known issue 해결**: `skill publish`의 tar 호출이 Windows git-bash 환경에서 실패하던 문제
- **`_createArchive()`** 헬퍼: tar (POSIX) → PowerShell Compress-Archive (Windows ZIP) → zip 명령 (Linux fallback) 순 자동 시도
- 결과: Windows에서 `.zip` (5.7KB) 정상 생성, POSIX에서 `.tgz` 그대로

### 검증 (stress-v3)
- H1-H3 (cross-platform archive) 3/3 PASS
- I1-I3 (benchmark --measure framework) 3/3 PASS
- J1-J3 (embedding opt-in + fallback) 3/3 PASS
- K1-K3 (회귀 — drift/MCP/agentskills round-trip) 3/3 PASS
- **stress-v3: 12/12 PASS**, e2e: **202/202 PASS**

## 1.9.47 — 2026-05-19

**`leerness skill publish` — 자체 skill을 외부 공유 번들로 publish**.

### Added
- **`leerness skill publish [--include ids] [--bundle-only] [--gh-release]`**:
  - 모든 자체 skill (또는 `--include`)을 SKILL.md frontmatter + license + publisher + version 메타로 export
  - `manifest.json` (skills 카탈로그 인덱스) + `README.md` 자동 생성
  - tarball 생성 시도 (Windows/POSIX tar) — 실패 시 graceful, 개별 SKILL.md는 정상 유지
  - `--gh-release`: GitHub release에 자동 attach

### e2e: 199/199 PASS

## 1.9.46 — 2026-05-19

**`leerness benchmark` — 자체 + 타도구 비교 매트릭스**.

### Added
- **`leerness benchmark [path] [--json]`** 신규 명령:
  - 자체 6 차원 점수 (multiAgent / autoVerify / reuse / workspace / bugDetect / contextKeep) — 실 measured 값 (tasks/reuse-map/usage stats) 기반
  - 6 도구 시뮬 비교: vanilla / claude_code / hermes / leerness_solo / leerness+claude / leerness+hermes
  - 결론: **leerness + 메인 에이전트 조합이 최강** (단독 leerness보다 100점 차이)

## 1.9.45 — 2026-05-19

**`leerness skill match <query>` — 설치 SKILL.md 자동 추천**.

### Added
- **`leerness skill match "<task or keywords>"`** 신규 명령:
  - 사용자 task 키워드 ↔ 설치된 SKILL.md description **jaccard similarity 매칭**
  - 상위 5개 추천 + 점수 표 출력
  - `--json` 출력 지원 → 메인 에이전트가 파싱하여 자동 활성화 가능

### 동작 예시
```
leerness skill match "Office 문서 자동화"
→ 점수 0.10 | office | 마이크로소프트 오피스 자동화
→ 점수 0.06 | ads-analytics | GA4 분석
→ 점수 0.05 | crawling | Playwright 기반 자동화
```

## 1.9.44 — 2026-05-19

**1.9.34~43 통합 검증 + BUG 1건 즉시 패치**.

별도 `_apps/leerness-stress/bin/stress-v2.js`로 1.9.34~43의 **13종 신규 기능 + 5 edge case = 25 시나리오 통합 테스트**. 발견된 진짜 BUG 1건 즉시 패치.

### Fixed

- **🔴 BUG-1 (HIGH)** — `_parseSkillMd`의 UTF-8 BOM 미처리:
  - 증상: BOM (`EF BB BF`)이 있는 SKILL.md install 시 "name 필수" 에러 (frontmatter 매칭 실패)
  - 원인: 정규식 `^---`가 BOM 뒤로 밀린 `---`를 매칭 못 함
  - 수정: `text.replace(/^﻿/, '')` 사전 BOM 제거
  - 영향: Windows 메모장/일부 에디터 출력 SKILL.md 호환

### Verified (1.9.34~43 13종 기능 통합 검증)

| 카테고리 | 결과 |
|---|---|
| MCP Server (1.9.43) | ✅ 5/5 — JSON-RPC 표준, 10 도구 호출 가능, -32601/-32700 에러 정확 |
| agentskills.io 호환 (1.9.42/43) | ✅ 5/5 — install/export/discover round-trip, BOM/한글 OK |
| 차분 마이그레이션 (1.9.41) | ✅ 3/3 — whats-new 13 버전, migrate stdout 자동 출력, report 영구 기록 |
| release pack (1.9.40) | ✅ 2/2 — --task-add, --parent-migrate dogfooding gap |
| drift + workflow (1.9.37-39) | ✅ 4/4 — 4 신호 + 4 레벨, --auto-fix, session-workflow.md, 6단계 가이드 |
| contract verify (1.9.35/36) | ✅ 2/2 — **require side-effect 차단 실측 검증** (852ms 정적 분석), tick.* 필드 grep |
| Edge cases | ✅ 5/5 (1.9.44 BOM 패치 후) — BOM, 한글, 빈 디렉토리, 50KB MCP 제한, 동시 호출 race |

### 검증
- e2e: **196/196 PASS** (195 + BOM 회귀 1건)
- stress-v2: **25/25 PASS** (이전 3 FAIL → BUG 1건 패치 + stress-v2 자체 결함 2건 수정)
- 검증 보고서: `_reports/INTEGRATION_TEST_REPORT_1.9.44.md` (사용자 전용 비공개)

### 결론
**1.9.34~44의 모든 13종 신규 기능 production-ready 확인**. 신규 사용자가 `npx leerness@1.9.44 init .`로 즉시 안전 사용 가능.

## 1.9.43 — 2026-05-19

**MCP 서버 + skill 일괄 export + _reports 비공개 + GitHub 배포 준비**.

[agentskills.io 분석](https://agentskills.io)에서 도출한 발전 로드맵의 Phase 1 즉시 후보 3건을 통합. leerness 도구를 **MCP 서버로 노출**하여 Claude Code · Hermes · Cursor 등 30+ 도구가 직접 호출 가능.

### Added — MCP Server (sub-agent로서 leerness)

- **`leerness mcp serve`** 신규 명령 — stdio JSON-RPC로 leerness 도구 10종 노출:
  - `leerness_handoff` · `leerness_drift_check` · `leerness_audit` (--fix 지원)
  - `leerness_verify_claim` (--run-tests, --strict-claims)
  - `leerness_contract_verify` (사양 ↔ 구현)
  - `leerness_agents_list` · `leerness_reuse_map` · `leerness_whats_new`
  - `leerness_usage_stats` · `leerness_session_close`
  - 표준 MCP 프로토콜 (2024-11-05) — initialize / tools/list / tools/call
- 이제 Claude Code · Hermes · Cursor 등이 `.mcp.json`에 leerness를 등록하면 메인 에이전트가 leerness 검수를 sub-tool로 호출 가능

### Added — skill 표준 export·discover

- **`leerness skill export-all [--out <dir>]`** — 모든 자체 skill(9개)을 agentskills.io 표준 `SKILL.md`로 일괄 export. 다른 도구가 `skill install <path>`로 즉시 import.

### Added — 내부 보고서 비공개

- **`_reports/` 디렉토리 자동 비공개**:
  - root `.gitignore`에 `_reports/`, `**/_reports/`, `*.private.md`, `*.private.json` 추가
  - `leerness-pkg/.gitignore`에 동일 추가
  - 신규 `leerness-pkg/.npmignore` — npm publish 시 명시적 제외
  - `package.json#files` 화이트리스트와 이중 안전
- 내부 검수 보고서 (`LEERNESS_VS_HERMES_AND_AGENTSKILLS.md`, `SESSION_LEERNESS_USAGE_AUDIT.md` 등)는 사용자 확인 전용이며 npm/GitHub 배포에 포함되지 않음

### Verified
- e2e: **195/195 PASS** (1.9.42 190 + 신규 5)
- MCP server initialize/tools/list 정상 JSON-RPC 응답
- skill export-all → 9개 SKILL.md 일괄 생성
- .gitignore/.npmignore에 _reports/ 차단 확인

### 정책
- ✅ MCP server는 명시 호출 (`leerness mcp serve`) 시에만 작동 — 자동 시작 안 함
- ✅ MCP 도구 호출 시 LEERNESS_NO_BANNER/NO_PROMPT/NO_DRIFT_CHECK 자동 설정 (호스트 환경 깔끔)
- ✅ _reports 비공개 — 다중 채널 (gitignore + npmignore + files 화이트리스트)

## 1.9.42 — 2026-05-19

**agentskills.io 공개 표준 호환 — 30+ AI 도구와 스킬 즉시 공유**.

[agentskills.io](https://agentskills.io)는 Anthropic이 만든 Agent Skills 개방 표준으로 Claude Code · Cursor · GitHub Copilot · OpenAI Codex · Gemini CLI · Hermes Agent · OpenHands · Goose 등 30+ 도구가 채택. 1.9.42부터 leerness가 이 표준의 `SKILL.md` 포맷을 import/export 가능.

### Added

- **`leerness skill install <url-or-path>`** 신규 명령 — `SKILL.md` 다운로드/import:
  - URL (https://...) 또는 로컬 파일/디렉토리 모두 지원
  - frontmatter (`name`, `description`) 파싱 → `.harness/skills/<id>/SKILL.md` 자동 배치
  - 자체 `skill.json` 도 함께 생성 (자체 catalog 호환, `_source: 'agentskills.io'` 추적)
- **`leerness skill discover [--query <q>] [--source <url>]`** 신규 명령 — 공개 스킬 카탈로그에서 매칭 추천:
  - **opt-in**: `LEERNESS_SKILL_DISCOVER_URL` 환경변수 또는 `--source` 명시 필요 (자동 외부 fetch 금지 정책 유지)
  - `--query` 키워드 매칭 + 마크다운 링크/SKILL.md URL 자동 추출
  - `--json` 출력 지원
- **`leerness skill export <id> [--out <dir>]`** 신규 명령 — 기존 자체 skill을 agentskills.io 표준 `SKILL.md` 포맷으로 export → 다른 도구가 `skill install`로 import 가능
- **`.env.example`에 2개 신규 환경변수** (opt-in, 기본 OFF):
  - `LEERNESS_SKILL_DISCOVER_URL=` — 공개 카탈로그 URL
  - `LEERNESS_SKILL_AUTO_DISCOVER=0` — 사용자 요청 분석 시 자동 매칭 추천
- **`_httpFetch()` 내장 HTTPS 호출자** — Node 18+ globalThis.fetch, fallback https module. 사용자 동의 명령에서만 호출.

### Reports
- `_reports/LEERNESS_VS_HERMES_AND_AGENTSKILLS.md` 작성 — 10 섹션 상세 분석:
  - agentskills.io 표준 + Progressive Disclosure 메커니즘
  - Hermes Agent (NousResearch, 157k ⭐, MIT) 분석
  - leerness 4 고유 우위 (거짓 완료 검증, drift 자동 감지, 워크스페이스 가시성, 마이그레이션 인지 갭)
  - 1.9.42 → 2.0 발전 로드맵 3 Phase

### 정책
- ❌ leerness는 외부 URL 자동 fetch 절대 금지 — opt-in (env 또는 `--source` 명시) 필수
- ✅ `_httpFetch`는 사용자 명령 (`skill install URL` / `skill discover`)에서만 호출
- ✅ 기존 자체 skillCatalog와 양립 — `_source: 'agentskills.io'`로 출처 추적

### e2e: 190/190 PASS (1.9.41 186 + 신규 4)

## 1.9.41 — 2026-05-19

**디스크 마이그레이션 ↔ AI 컨텍스트 인지 갭 차단 — 맞춤형 차분 마이그레이션**.

사용자 통찰: 같은 채팅 세션에서 leerness를 latest로 migrate해도, AI 에이전트는 이전 청크의 마인드셋으로 계속 작업하여 신규 도구(release pack, drift check 등)를 자동으로 호출하지 않는 패턴 발견. migrate는 파일만 업데이트, AI에겐 "새 도구가 들어왔다"는 신호 전달 부재.

### Added

- **`leerness whats-new [--from V] [--to V] [--json]`** 신규 명령 — CHANGELOG.md를 자동 파싱하여 두 버전 사이의 차분 추출:
  - 신규 명령 (`leerness X` 패턴), 신규 플래그 (`--xxx`), 신규 파일 (`.harness/*.md`) 자동 분류
  - 각 버전의 헤드라인 (`**...**` 또는 첫 라인) 추출
  - AI 가독 권장 행동 자동 출력
- **`migrate` 후 stdout에 AI must re-read 차분 자동 출력** — migrate 직전 이전 버전을 캡처 (`_previousVersion`) → CHANGELOG 차분 추출 → 신규 명령/파일을 stdout에 즉시 표시:
  - "이전 청크의 기억 무효 — 새 도구 우선 시도" 명시
  - 같은 세션 내 AI 인-컨텍스트에 신규 도구 인지 주입
- **`migration-report.md`에 "🤖 AI must re-read" 섹션 영구 기록** — 신규 명령/플래그/파일 + 버전별 헤드라인 + 권장 행동
- **`handoff`가 fresh migration-report (24h 내) 시 자동 알림** — "🆕 최근 N시간 전 migrate 차분" 블록 자동 표시. 같은 세션 내 매 handoff 호출이 AI에게 신규 도구 재안내.

### 발견된 시스템 결함 (이번 라운드 해결)
- ❌ **before 1.9.41**: migrate가 파일만 업데이트, AI 마인드셋 stale 유지 → 신규 도구 자동 호출 X
- ✅ **1.9.41 이후**: migrate 직후 stdout + migration-report.md + handoff 모두 신규 도구를 AI 가독 포맷으로 노출 → "잊을 수 없는" 차분 안내

### 자기 검증
- 의도적으로 root를 1.9.37로 되돌림 → `leerness migrate .` 호출 → **AI must re-read 차분 자동 stdout 출력**:
  - `📌 신규 명령: leerness release pack`
  - 1.9.38/1.9.39/1.9.40 버전별 헤드라인 자동 추출
  - 권장 행동 4단계 (--help, 신규 파일 재독, 인스트럭션 재독, whats-new --json)

### e2e: 186/186 PASS (1.9.40 182 + 신규 4)

### 정책
- ✅ 차분 안내는 **AI 가독 포맷** (`**📌**`, `` `leerness X` `` 등 마크다운)
- ✅ 같은 세션 내 다양한 채널 (stdout + report + handoff)로 *반복 노출* → 청크 stale 방지
- ✅ 추출은 CHANGELOG.md 파싱 — 새 라운드 마다 자동 갱신

## 1.9.40 — 2026-05-19

**dogfooding gap 차단 — `leerness release pack` 통합 명령 + audit README mismatch 자동 감지**.

세션 메타-감사(`_reports/SESSION_LEERNESS_USAGE_AUDIT.md`)에서 발견한 1.9.40 후보 4건을 모두 통합. 메인 에이전트가 "라운드 마감 = e2e/pack"으로만 끝내고 leerness 자체 마감을 잊는 패턴을 도구로 차단.

### Added

- **`leerness release pack [path]`** 신규 명령 — 라운드 마감 통합 워크플로:
  - `--dry-run` — 시뮬레이션 모드
  - `--task-add "<title>"` — progress-tracker에 라운드 마감 task 자동 등록
  - `--parent-migrate` — 부모 워크스페이스(`..`)의 `.harness`도 함께 latest로 migrate (dogfooding gap 차단)
  - `--close` — `session close` 자동 실행
  - `--no-readme-sync` — README 자동 동기화 스킵 (기본은 적용)
  - 사용 예: `leerness release pack . --task-add "1.9.41 X 통합" --parent-migrate --close`
- **`syncReadme` 자동 갱신 강화**:
  - `package.json#version` 또는 `.harness/HARNESS_VERSION` 기반 README의 version 배지 자동 갱신
  - `scripts/e2e.js`의 `total++` 카운트 기반 e2e 배지 추세 반영

### Fixed (audit 강화)

- **`leerness audit`에 README ↔ package.json version mismatch 자동 감지** — dogfooding gap의 가장 흔한 패턴 자동 차단:
  - `audit`: warning 출력
  - `audit --fix`: README 배지 자동 갱신
  - 메타 감사에서 발견한 "leerness-pkg는 1.9.40인데 README는 1.9.38" 같은 stale 사전 차단

### 정책
- ✅ `release pack`은 npm 호출 외엔 `.harness`만 갱신 (사용자 메모리 보존)
- ✅ `--parent-migrate`는 명시 플래그 필요 (자동 부모 변경 없음)
- ✅ README mismatch는 warning만 (failures가 아님 — 사용자 차단 X)

### 실측
- 메타 감사에서 발견한 4 후보 모두 통합
- e2e: 182/182 PASS (1.9.39 178 + 신규 4)
- 자체 검증: leerness-pkg에 `release pack --dry-run --task-add` 호출 → task T-0001 자동 등록

## 1.9.39 — 2026-05-19

**AI 하네스 엔지니어링 6단계 워크플로 자동 유도 + drift 자동 회복**.

사용자 우려: "프로젝트가 복잡해지고 길어질 때 leerness를 점점 참조하지 않는다" — 1.9.37/38 drift 감지에 이어, 이번엔 **매 세션 시작 시 워크플로 자체를 자동 안내**하는 능동형 메커니즘 추가.

### Added — A. 세션 워크플로 정책

- **`.harness/session-workflow.md`** 신규 — AI 하네스 엔지니어링 6단계 가이드:
  1. **요청 분석** (handoff + drift check)
  2. **계획 수립** (plan add / TodoWrite + reuse-map)
  3. **업무 분배** (agents list/recommend, 작업유형별 sub-agent 매핑)
  4. **sub-agent 작업** (파일 경로 격리, mtime 검증 의무, 자체 테스트)
  5. **종합 검증** (contract verify + verify-claim --run-tests + review --persona)
  6. **세션 마감** (session close + audit --fix + usage stats)
- **`handoff` 출력 끝에 6단계 가이드 자동 표시** — 매 세션 시작 시 메인 에이전트가 잊지 않도록.
- **AGENTS.md / CLAUDE.md 템플릿 업그레이드** — "⭐ 매 세션 첫 행동: session-workflow.md 먼저 읽기" 항목 최상단 추가, Mandatory read order 1번 위치.
- 스킵: `--no-workflow-guide` 또는 `LEERNESS_NO_WORKFLOW_GUIDE=1`.

### Added — B. drift 자동 회복

- **`leerness drift check --auto-fix`** — critical (≥100) 시 자동으로 `session close` 실행 + 재검증.
  - 회복 성공 시 usage-stats의 `drift.autoResolved` 카운터 누적
  - 실패 시 수동 실행 안내
- **`leerness handoff --auto-recover`** — handoff 진입 시 severe drift 감지하면 inline 자동 회복.
  - sevStale (≥3일) 시에만 발동 (안전)

### 정책
- ✅ `--auto-fix`/`--auto-recover`는 **명시적 플래그** 필요 (기본 동작은 알림만 유지)
- ✅ 워크플로 가이드는 매 handoff 출력에 표시 → 메인 에이전트가 매 세션 6단계 인지
- ✅ AGENTS/CLAUDE 템플릿 통합 → AI 에이전트가 세션 시작 시 자동 읽음

### 실측
- 워크플로 가이드 정상 표시 (handoff 끝에 6 단계 + .harness/session-workflow.md 링크)
- session-workflow.md init 시 자동 생성 (6단계 + 사용 명령 + anti-pattern 명시)
- AGENTS/CLAUDE에 session-workflow.md 참조 자동 inject

### e2e: 178/178 PASS (1.9.38 174 + 신규 4)

## 1.9.38 — 2026-05-18

**drift 자동 reminder + 사용 통계 + TodoWrite 임포트 + drift 임계 학습**.

1.9.37의 drift detection을 더 능동적으로 만든 라운드. 메인 에이전트가 leerness를 "잊는" 시나리오를 4가지 채널로 보완.

### Added

- **(A) `.harness/agent-reminders.md` 자동 생성** — drift 5일 이상(severe) 시 handoff 진입부에서 자동 생성. 메인 에이전트가 다음 라운드 시작 시 이 파일을 읽고 session close를 잊지 않도록.
  - drift 회복 시 (handoff/session close) 파일 자동 청소
- **(B) `leerness usage stats`** 신규 명령 — `.harness/cache/usage-stats.json`에 명령별 누적 카운터 + drift 통계. `--json` 출력 지원.
  - 매 명령 호출 시 자동 누적 (`_bumpUsage`)
  - 통계 출력: 호출 수 상위 30 + drift critical 발견/skip/자동 해소 카운트
- **(C) `leerness task sync --from <todo.json>`** 신규 명령 — TodoWrite JSON을 leerness progress-tracker로 import. completed → done, in_progress → in-progress, pending → planned 매핑.
  - 같은 content가 이미 있으면 status만 update, 없으면 신규 task 생성
  - `--json` 출력 지원
- **(D) drift 임계 학습** — `--no-drift-check` 누적 ≥5회 시 stale 임계 2일 → 4일로 자동 완화 (false alarm 감소).
  - usage-stats.json의 `drift.skipped` 카운터로 추적
  - 학습된 임계 활성 시 handoff 출력에 "(학습: skip N회 누적 → 임계 N일 완화)" 안내

### 실측
- 실 워크스페이스에서 4 기능 모두 작동 확인:
  - A: 5일 stale 시뮬 → agent-reminders.md 자동 생성 (drift critical 메시지)
  - B: status/handoff/task 명령 자동 카운트
  - C: 2건 TodoWrite JSON → 2건 progress-tracker import
  - D: --no-drift-check 5회 누적 → drift.skipped=5 기록

### e2e: 174/174 PASS (1.9.37 170 + 신규 4)

### 정책
- ✅ 자동 reminder는 *파일 생성*만 — 메인 에이전트 자동 실행 강제 X
- ✅ usage stats는 read-only 추적, destructive 동작 X
- ✅ task sync는 idempotent (같은 content는 update만)
- ✅ drift 학습은 사용자 친화 (자주 끄면 덜 짖게)

## 1.9.37 — 2026-05-18

**메인 에이전트의 "leerness 점점 안 쓰는" drift 현상 자동 감지·경고**.

### 배경
실 워크스페이스 분석 결과: 라운드가 길어질수록 메인 에이전트가 `session close` / `task add` 등을 점점 잊는 패턴 발견.
- session-handoff.md 4.6일 stale
- task-log.md 4.6일 stale
- progress-tracker T-row 3일간 0건 업데이트
- 신규 sub-app 4개에 task 0건 등록

→ **drift score 100/200 (🔴 critical) 등급**. 사용자 우려 사실 확인.

### Added

- **`leerness drift check [path]`** 신규 명령:
  - 4개 신호 측정: session-handoff.md, current-state.md, progress-tracker.md, task-log.md의 staleness
  - 추가 신호: `_apps/*` 중 task 0건인 sub-project 수
  - 가중치 합계 → 4단계 레벨 (🟢 healthy / 🟠 attention / 🟡 warning / 🔴 critical)
  - 임계 0/20/50/100. 점수 ≥100 시 exit 1 (CI 친화)
  - `--json` 출력 지원
  - 권장 조치 자동 안내 (`session close` / `audit --fix` / `task add`)
- **`handoff` 자동 drift 경고** — handoff 호출 시 빠른 inline check (전체 `drift check` 안 호출). session-handoff/progress-tracker 중 하나라도 2일 이상 stale이면 노랑색 경고 + 권장 명령 안내.
- **스킵 옵션**: `--no-drift-check` 플래그 + `LEERNESS_NO_DRIFT_CHECK=1` 환경변수

### 실측 (이번 라운드)
- 실 워크스페이스: drift 100/200 (critical) → `session close` 1회 후 30/200 (attention)
- e2e: 170/170 PASS (1.9.36 166 + 신규 4)

### 정책
- ✅ drift 경고는 *알림만* — 자동 실행 금지 (사용자/메인이 명시적 선택)
- ✅ 빠른 inline check (handoff) vs 상세 보고 (`drift check`) 분리
- ✅ CI 친화: `--no-drift-check` 또는 env로 끄기 가능

## 1.9.36 — 2026-05-18

**외부 AI CLI 오케스트레이션 강화: dispatch 안전 모드 + agents bench + 작업 유형 추천 + stress test에서 발견한 2 BUG 즉시 수정**.

### Added

- **`leerness agents bench "<task>" [--write] [--timeout N]`** — 활성/설치된 모든 ready CLI에 같은 task를 동시 호출. 결과: 시간/exit/응답길이/마지막 라인 비교 매트릭스 + 🏆 가장 빠른 CLI 자동 표시. `--json` 출력 지원.
- **`agents dispatch`에 `--write` 모드 추가** — 기본은 read-only (안전). `--write` 명시 시 각 CLI에 위험 플래그 자동 첨부:
  - claude → `--print --dangerously-skip-permissions`
  - codex → `exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox`
  - gemini → `-p --yolo`
- **`_recommendAgent()` 작업 유형 기반 CLI 추천** — task 키워드 분석:
  - 번역/요약/분석/review → **claude** (1.7× 빠름)
  - 아키텍처/리팩터/복잡 → **codex** (가장 상세)
  - 생성/작성/수정/구현 → **gemini --yolo** (직접 수정 정확)
  - ready 체크 전에 출력 → 비활성이어도 추천 안내
- **`dispatch` 출력에 CLI별 안내 추가** — codex의 POSIX path 변환 차이, gemini의 yolo 위험성 등.

### Fixed (stress test에서 발견된 진짜 BUG)

- 🔴 **`contract verify` require() side-effect 제거** — `require(implFile)`가 스크립트 본문 실행 → 18초 소요 + 임의 코드 실행 위험. **정적 소스 분석** (`module.exports = {...}` / `exports.foo =` 패턴 grep)으로 교체. 18,245ms → **705ms (25.9× 빠름)** + 보안 위험 제거.
- 🟡 **`reuse autodetect` 디렉토리 제한 해제** — `src/`만 스캔 → **src/, bin/, lib/, app/ 4개 디렉토리** 스캔. require → 정적 분석.

### Verified
- 신규 프로젝트 `_apps/leerness-stress` 생성 + 31개 leerness 명령 자동 호출 stress test
- 결과: 28 PASS / 3 의도된 BUG 감지 (false positive 0건)
- e2e: 166/166 PASS (1.9.35 161 + 신규 5)

## 1.9.35 — 2026-05-17

**파이프라인 메타-감사에서 도출된 5개 개선 사항 통합**.

이전 라운드(1.9.34)에서 멀티 에이전트 오케스트레이션 전체 파이프라인을 메타-검증한 결과 8개 개선점을 도출. 그 중 high-impact 5건을 1.9.35에 즉시 통합.

### Added

- **`leerness contract verify <spec.md> <impl.js>`** (#3) — 사양 ↔ 구현 일치 검사.
  - spec 문서에서 `function fooBar(` / `` `bar(` `` / `tick.<field>` 패턴 추출
  - impl의 `module.exports`와 비교 → 누락된 함수/필드 보고
  - `--json` 출력 지원, exit code 1 if 불일치 (CI 친화)
  - 1.9.34 멀티 에이전트 검증에서 발견한 "tick 페이로드 필드명 불일치" 자동 차단
- **`leerness reuse autodetect [path]`** (#2) — `src/*.js`의 `module.exports`를 스캔하여 reuse-map.md 후보 자동 등록.
  - `_internal` 헬퍼는 제외 (밑줄로 시작하는 export 자동 필터)
  - `--apply`로 reuse-map.md에 자동 추가, 기본은 dry-run
- **`leerness audit --fix`** (#5) — 누락된 메타 파일 자동 갱신.
  - `session-handoff.md`의 `Last generated: (자동)` → 실제 타임스탬프
  - `current-state.md`의 stale `Updated` 라인 → today로 갱신
  - `--fix` 미지정 시 기존 경고 동작 유지 (안전한 opt-in)
- **`handoff <path>` .harness 부재 자동 경고** (#1) — 신규 디렉토리에서 handoff 호출 시 즉시 노랑색 경고 + `leerness init` 명령 안내. `--no-init-check` 또는 `--all-apps` 시 스킵.
- **`agents dispatch` 안내문에 안전 규칙 추가** (#4) — 멀티 에이전트 분배 시 파일 경로 격리, mtime 검증 요구, contract verify 권장을 안내문에 자동 포함.

### Policy
- ✅ 모든 신규 명령은 기본 read-only · destructive 동작은 명시적 플래그(`--fix`, `--apply`) 필요
- ✅ 1.9.34 멀티 에이전트 검증의 모범 사례(파일 경로 격리, mtime 자기 검증, 사양 사전 합의)를 도구로 코드화
- ❌ 자동 init은 destructive이므로 자동 실행 안 함 — 사용자에게 명령만 안내

### 실측 (이번 라운드)
- 메타-감사 보고서: `_reports/PIPELINE_META_AUDIT.md` (10 phases, 8 개선점)
- rpg-replay 통합 패치: 회귀 0건 · 128/128 PASS · BUG-A/B/C 모두 해결 (별도 라운드)
- contract verify 실 사용 사례: format.js에 spec의 `tick.effect` 필드 없음 발견
- e2e: 161/161 PASS (1.9.34 156 + 신규 5)

## 1.9.34 — 2026-05-16

**방향키 + 스페이스 인터랙티브 multi-select + 256색 그라데이션 배너 + 멀티레벨 sub-agent 오케스트레이션 검증**.

### Added

- **`_selectOne()` / `_selectMany()` 헬퍼**: TTY raw mode + readline 이벤트 처리.
  - 방향키 ↑↓ (또는 j/k vim binding) — 커서 이동
  - Space — 토글 (multi-select)
  - a / n — 전체 선택 / 전체 해제
  - Enter — 확정
  - q / ESC / Ctrl+C — 취소 (기본값 또는 빈 배열 반환)
- **`resolveInstallOptions`에 적용**: 언어 선택 + 스킬 라이브러리 선택을 multi-select UI로 전환.
- **`setupAgentsCmd`에 적용**: 4 CLI 일괄 활성화를 Space 토글로 선택 (이전엔 각각 yes/no 4번).
- **ASCII 배너 256색 그라데이션**: 6 라인을 cyan(51) → 자주(165)로 6단계 그라데이션. ★ 강조 + magenta 색 강조 항목.
- **`--no-interactive-select` 플래그 + `LEERNESS_NO_INTERACTIVE=1` env**: 구식 숫자 prompt 폴백.

### 멀티레벨 sub-agent 오케스트레이션 검증 (실측)

메인 에이전트 → sub-agent(Claude) → sub-sub-agent(외부 gemini CLI) 3단계 깊이 검증.

| 항목 | 결과 |
|---|---|
| 단일 gemini 호출 | ✅ 15.6s, 영문 번역 정상 |
| 병렬 ×2 | ✅ 24s, 출력 분리 정상 (quota retry 1회) |
| 효율 (순차 3회 33s vs 병렬 3회 15s) | **2.2× 향상** (이론 3× 대비 60%) |
| 검수 체인 (결과 → 평가) | ✅ "2" → "yes" 정상 |
| 같은 파일 동시 쓰기 | ⚠ **last-writer-wins, 락 없음 → 데이터 손실 위험** |

**결론**:
- 3단계 오케스트레이션 안전하게 동작
- 독립 작업(번역/평가/리뷰) 2×+ 효율 향상
- 같은 리소스 동시 쓰기는 호출자가 파일 경로 격리 책임
- gemini quota 동시 호출 시 retry → 병렬 확장성 ~3개로 제한

### Policy
- ❌ 비-TTY/CI/`--yes` 시 multi-select prompt 자동 스킵 (defaults 사용)
- ❌ 같은 파일/리소스 동시 쓰기 sub-agent 분배 금지 (호출자 책임)
- ✅ 인터랙티브 prompt는 256색 ANSI 미지원 환경에서도 동작 (`LEERNESS_NO_INTERACTIVE=1` 폴백)
- ✅ q/ESC로 언제든 취소 가능 (기본값으로 fallback)

### 실측 (이번 라운드)
- 워크스페이스 28 프로젝트 일괄 1.9.16~1.9.31 → 1.9.33 → 1.9.34 마이그레이션
- e2e: 156/156 PASS (1.9.33 153 + multi-select 폴백 + 배너 + --no-interactive-select 3개)

## 1.9.33 — 2026-05-15

**npx 캐시 함정 방지 — install 시 stale 버전 자동 경고 + 해결 안내**.

### 배경
사용자가 `npx leerness init`(@latest 없이)을 실행하면 npm/npx의 로컬 캐시에 있는 옛 버전이 무한히 재사용되는 함정이 있음. 1.9.32 publish 후에도 사용자 PC에서 1.9.21이 실행되는 사례 확인.

### Added

- **`_warnIfStale()` 헬퍼**: `install()` 진입 시 자동 호출.
  - npm registry latest 비교 (`fetchNpmLatest` + 24h cache 재사용)
  - 현재 실행 중인 VERSION이 registry latest보다 옛날이면 ⚠ 노랑색 경고 박스 출력
  - 해결 명령 2가지 안내: `npx --yes clear-npx-cache && npx leerness@latest init .` 또는 `npm i -g leerness@latest`
  - **init 자체는 계속 진행** (경고만 띄움 — 강제 차단 X)
- **`--no-stale-check`** 플래그 + **`LEERNESS_NO_STALE_CHECK=1`** env 변수: 경고 스킵
- **offline + 캐시 없음**: 비교 스킵 (네트워크 차단 환경 안전)
- **offline + 캐시 fresh**: 캐시값으로 비교 (e2e 등 CI 환경에서도 동작)

### Policy
- ❌ 사용자 init 차단 안 함 (경고만, init은 계속 진행)
- ✅ 24h 캐시로 매 init마다 npm view 호출 안 함 (cold-start만 12s timeout)
- ✅ 네트워크 실패 시 silently skip — init 흐름 끊지 않음
- ✅ `--no-stale-check`/env로 끄기 가능 (CI 친화)

### 실측 (이번 라운드)
- 사용자 PC: `npx leerness init` → 1.9.21 실행됨 (npm latest=1.9.32) — 1.9.33부터 install 시 즉시 경고
- e2e: 153/153 PASS (1.9.32 151 + stale 경고/스킵 2)

## 1.9.32 — 2026-05-15

**ASCII 배너 + `leerness setup-agents` 인터랙티브 설정 + 미설치 CLI 자동 설치 시도**.

### Added

- **ASCII 배너 (`_banner()`)**: `leerness init` 시 자동 출력. `--version --banner`로도 호출 가능. `LEERNESS_NO_BANNER=1` 또는 콘솔 폭 <70칸이면 자동 스킵.
  - `LEERNESS` 8글자 ANSI 시안+볼드 색상 + 박스 + 빠른 시작 4줄.
- **`leerness setup-agents [path]`** (신규 명령): 외부 AI CLI 4종 (claude/codex/gemini/copilot) 인터랙티브 활성화.
  - 각 CLI별: 설치 상태(🟢/⚪) + 활성 상태(🟢/🟡) 표시 → 사용자 yes/no → `.env`의 `LEERNESS_ENABLE_*` 자동 upsert.
  - **미설치 CLI 자동 설치 시도**: 사용자 동의 후 `npm i -g @anthropic-ai/claude-code`, `npm i -g @openai/codex`, `npm i -g @google/gemini-cli`, `gh extension install github/gh-copilot` 실행.
  - 설치 후 PATH 재확인 → 안 보이면 새 셸 안내.
- **`init` 후 자동 prompt**: `leerness init`이 끝나면 TTY일 때 "외부 AI CLI 설정?" 질문 → yes 시 `setupAgentsCmd` 호출.
  - `--no-setup-agents` 또는 `--yes`로 스킵 가능.
- **`EXTERNAL_AGENTS`에 `installCmd` + `installHint` 필드 추가**: 자동 설치 시 사용.
- **`_prompt()` / `_confirm()` / `_upsertEnvLine()` 헬퍼**: TTY 한정 readline 기반, 비대화형(--yes/CI/non-TTY)에선 안전 fallback.

### Policy
- ❌ 비-TTY/CI 환경에선 prompt 자동 스킵 (default 동작 유지)
- ❌ 자동 설치는 사용자 명시적 yes 후에만 (--yes 시에도 prompt 스킵하므로 자동 설치 안 됨)
- ✅ `.env` upsert는 idempotent (이미 키가 있으면 값 교체만)
- ✅ `init --yes` + `setup-agents`로 비대화형 워크플로도 안내 표시만 (변경 없음)

### 실측 (이번 라운드)
- 신규 sub-project 3종 (rpg-craft 20/20, rpg-achievements 22/22, rpg-instance 20/20) — sub-agent 3 동시
- e2e: 151/151 PASS (1.9.31 146 + 1.9.32 5)
- 배너 ANSI 시각 검증 OK / 콘솔 폭 <70칸 시 1줄 폴백 / `LEERNESS_NO_BANNER=1` 스킵

## 1.9.31 — 2026-05-15

**`leerness agents quota` — 외부 AI CLI 사용량/한도 추정 + provider 대시보드 안내**.

### Added

- **`leerness agents quota`** (1.9.31): 활성 CLI별 quota/rate-limit 정보 표시.
  - **claude**: 비대화형 quota API 없음 → `/status` 슬래시 또는 https://console.anthropic.com/settings/usage 안내.
  - **codex**: `codex --help`에서 `usage`/`quota` 키워드 감지 시 시도 가능 표시, 미감지 시 https://platform.openai.com/account/usage 안내.
  - **gemini**: 무료 티어 `60 req/min, 1000 req/day` 명시.
  - **copilot (gh)**: `gh auth status`로 인증 확인 → 구독자 무제한 또는 `gh auth login` 필요 안내.
  - `--json` 출력 지원 (`{ quota: [{id, bin, status, quota, hint, raw}, ...] }`).
- **`agents` 사용법 메시지에 `quota` 추가**: `list|check|quota|dispatch`.
- **`agents dispatch` 안내문에 quota 명령 cross-link** (1.9.31+).

### Policy
- ❌ leerness는 사용량을 직접 추적하지 않음 (provider 대시보드 참조)
- ✅ sub-agent 분배 시 quota 여유 큰 CLI를 메인 에이전트가 우선 선택하도록 신호 제공
- ✅ rate-limit/plan 차이는 provider별 다름 — leerness는 hint만 제공

### 실측 (이번 라운드 사용 사례)
- agents quota 신규 명령 검증 후 sub-agent ×3 동시 분배
- e2e: 146/146 통과 (1.9.30 144 + quota 2)

## 1.9.30 — 2026-05-15

**외부 AI CLI 오케스트레이션 — 환경변수 활성화 정책 + `leerness agents list/check/dispatch`**.

claude/codex/gemini/copilot CLI들을 sub-agent로 명시적 활용 가능. 사용자 동의(환경변수) + PATH 존재 둘 다 충족 시에만 ready.

### Added

- **`.env.example`에 4개 활성화 플래그 추가**:
  - `LEERNESS_ENABLE_CLAUDE=1` (Anthropic Claude Code, 기본 활성)
  - `LEERNESS_ENABLE_CODEX=0` (OpenAI Codex CLI, 격리 sandbox)
  - `LEERNESS_ENABLE_GEMINI=0` (Google Gemini CLI, `--yolo` 모드는 워크스페이스 직접 수정 가능)
  - `LEERNESS_ENABLE_COPILOT=0` (GitHub Copilot CLI = `gh copilot`)
- **`leerness agents list`**: 4 CLI별 (env=1 여부) + (PATH 존재 여부) + 버전 + 상태 (ready/disabled/not-installed) 표 출력. `--json` 지원.
- **`leerness agents check`**: alias of list (재확인 강조).
- **`leerness agents dispatch "<task>" --to <id>`**: 활성 ready CLI에 대상 명령 자동 생성 (`claude "..."`, `codex exec "..."`, `gemini -p "..." --yolo`, `gh copilot suggest "..."`).
  - **leerness는 자동 호출 안 함** — 사용자/메인 에이전트가 명시적 실행.
  - 비활성/미설치 시 안내 후 `exit 1`.

### Policy
- ❌ 환경변수 미설정 또는 PATH 없으면 dispatch 거부
- ✅ 환경변수 + PATH 둘 다 충족 시에만 ready
- ✅ leerness는 외부 CLI 자동 호출 금지 (1.9.22 Ollama opt-in과 동일 원칙)

### 실측 (이번 라운드 사용 사례)
- Claude sub-agent ×2 (PvP 매치메이킹 + 길드 시스템) → 각각 26/26, 23/23 통과
- Gemini CLI 외부 호출 (yolo 모드) → rpg-stats 통계 대시보드 자동 생성 (13/13, HTML 5.5KB)
- → 3 도메인 동시 진행, 메인 에이전트가 외부 CLI를 sub-agent처럼 활용

## 1.9.29 — 2026-05-15

**페르소나 시스템 — 5종 내장 + `leerness review --persona` (도메인 깊이 3-4배)**.

이전 라운드 sub-agent 4명 비교 실험에서 검증: 도메인 페르소나 부여 시 발견율 100% vs control 30%, 토큰 비용은 ~3%만 증가.

### Added

- **`leerness persona list|show <id>|add <id>`**: 페르소나 카탈로그 관리.
  - **내장 5종**:
    - `security` — 10년차 시니어 보안 엔지니어 (OWASP/CWE/RFC, 한국 개인정보보호법/게임산업법)
    - `performance` — V8 엔진 내부 (hidden class/GC/이벤트 루프) 전문가
    - `ux` — 한국어 UX 라이터 + DX 컨설턴트 (토스/카카오/Stripe/GitHub)
    - `testing` — TDD + property-based 테스트 엔지니어 (fast-check)
    - `docs` — 한국어 기술 문서 작성자 (Stripe Docs/카카오 dev)
  - **사용자 정의**: `leerness persona add my-domain` → `.harness/personas/my-domain.md` 템플릿 생성
- **`leerness review <file> --persona <id1,id2,...>`**: 파일 + 페르소나 본문을 결합한 sub-agent 프롬프트 자동 생성. 단일/다중 페르소나 모두 지원.

### Why
페르소나 미부여 sub-agent는 코드를 표면적으로만 리뷰 (보안 30% + 성능 20% + UX 10%). 페르소나 부여 시 각 도메인 100% 발견율. 다중 페르소나 동시 spawn으로 종합 커버리지 가능.

### Implementation
- 내장 페르소나는 harness.js의 `BUILT_IN_PERSONAS` 객체로 패키지 내 보관 — 별도 설치 불필요.
- 사용자 정의 페르소나는 `.harness/personas/<id>.md` 파일로 검색 (커밋 가능).
- LLM 자동 호출 없음 — 프롬프트 생성만, 실 호출은 Claude Code/Codex/Gemini 등에서.

### Migration
```bash
npx leerness@latest update . --yes
leerness persona list
leerness review src/api.js --persona security,performance,ux
```

## 1.9.28 — 2026-05-15

**낙관적 표시 정밀도 fix — 한국형 PG 패턴 + confidence floor 0.15**.

1.9.27 sub-agent 검증에서 발견한 두 한계점을 작은 patch로 보완.

### Fixed
- **Payment 패턴 확장** — 카카오페이/네이버페이/페이팔 한국·국제 PG 추가 (`evidenceRe`/`codeRe`).
- **Confidence floor 0.15** — 1.9.27의 단일 high suspect 케이스 일률적 confidence=0 → 0.15로 floor 적용해 다중 의심과 정량 차등 가능.

### Why
- 한국 사용자의 결제 evidence ("카카오페이 결제 승인 완료" 등)가 1.9.27에선 일부만 감지. 이제 모든 한국형 PG 정확 매칭.
- confidence=0/0/0 일률성 해소 → "단일 의심도 정량 차이" 표현 가능.

### e2e
139/139 PASS (138 + 1.9.28 신규 1)

## 1.9.27 — 2026-05-15

**낙관적 표시 방지 강화 — URL/메서드 단위 매핑 + 10 카테고리 + 신뢰도 점수**.

1.9.26의 sub-agent B 검증에서 발견한 false negative (T-9001 "POST /users" 케이스, 같은 프로젝트에 다른 목적의 http.request 있으면 통과)를 정확히 해결.

### Added

- **URL/메서드 단위 매핑** (1.9.27 핵심): evidence에서 `POST /users` 같은 구체 경로 추출 → 코드에서 같은 경로 호출 검사. 1.9.26의 "fetch 키워드 존재" 약한 신호 → "실제 경로 일치" 강한 신호.
- **카탈로그 확장 5→10 카테고리**: FileIO / Queue / Cache / Notify(Slack/Discord) / Storage(S3/GCS/Azure) 신규.
- **신뢰도 점수** (0.0~1.0): high (1.0 가중치) + medium (0.5 가중치) 의심을 evidence 주장 수로 나눠 신뢰도 산출. < 0.5 = ⚠ 낮음, < 0.9 = ⓘ 보통, ≥ 0.9 = ✓ 높음.

### Why
1.9.26 sub-agent B 검증에서 발견:
- T-9001 evidence "POST /users API 호출 완료" + 같은 프로젝트에 다른 목적의 `http.request({path: '/api/tags'})` 존재 → 1.9.26은 "API 카테고리 통과"로 false negative
- 1.9.27 URL 매핑: "POST /users" 추출 후 코드에서 `/users` 검색 → 미발견 → 의심 감지 (MED severity)

### Limitations (1.9.28 후보)
- AST 분석 여전히 미구현 — 단순 substring 매칭의 한계
- URL 매핑이 path만 — query string, header 검증 없음
- 패턴 카탈로그 10종으로 확장됐지만 도메인 특화 패턴 (GraphQL, gRPC) 미커버

### Migration
```bash
npx leerness@latest update . --yes

# 강화된 명령 사용
leerness optimism-check T-0001 --path . --json   # 신뢰도 점수 포함
leerness verify-claim T-0001 --strict-claims     # 통합 검사
```

## 1.9.26 — 2026-05-15

**낙관적 표시 방지 — `optimism-check <T-ID>` + `verify-claim --strict-claims`** (사용자 명시 요구사항).

API 연동/DB 저장/이메일 발송 등 외부 작용을 evidence에 적었는데 실제 코드에 호출 흔적이 없는 "낙관적 표시"를 정적 분석으로 자동 감지.

### Added

- **`leerness optimism-check <T-ID> [--json]`**: progress-tracker의 evidence를 5종 패턴(API/DB/Email/Webhook/Payment)으로 스캔 → 주장이 있으면 코드 본문(`src/`, `bin/`, `lib/`, `scripts/`)에 호출 흔적 검사 → 불일치 발견 시 `exit 1`.
- **`leerness verify-claim --strict-claims`**: 기존 verify-claim 출력에 낙관적 표시 검사 결과 통합. 의심 발견 시 종합 FAIL.
- 5종 패턴 카탈로그:
  - **API**: `API 호출 / HTTP \d{3} / POST \/ / fetch / endpoint` ↔ `fetch( / http.request / axios. / undici / got.`
  - **DB**: `DB에 저장 / insert N건 / 데이터베이스 / migration` ↔ `db. / pg. / mongoose. / prisma. / sequelize`
  - **Email**: `이메일 발송 / sendMail` ↔ `sendMail / nodemailer / smtp / @sendgrid`
  - **Webhook**: `웹훅 호출` ↔ `fetch / http.request / axios.`
  - **Payment**: `결제 완료 / stripe / toss` ↔ `stripe / toss / tosspayments`

### Why
1.9.18~1.9.25의 verify-claim은 파일·테스트 카운트만 검증. 외부 작용(API/DB) 주장은 못 잡음. 1.9.26은 정적 분석으로 1차 방어선 추가.

### Limitations (1.9.27 후보)
- 같은 프로젝트가 다른 목적으로 동일 키워드(예: `http.request`)를 쓰면 false negative. URL/메서드 단위 매핑 필요.
- AST 분석 없는 substring 매칭. 호출 위치(call site) vs evidence 청크 매핑 필요.
- 파일 I/O, 메시지 큐(rabbitmq/kafka), 결제 PG 추가 필요.

### Migration
```bash
npx leerness@latest update . --yes

# 사용 예
leerness optimism-check T-0001
leerness verify-claim T-0001 --run-tests --strict-claims
```

## 1.9.25 — 2026-05-15

**모순 감지 0/5 → 5/5 — 소스 코드 인덱싱 + 멀티 세션 in-progress 즉시 등록**.

이전 1.9.24 실측에서 발견한 "코드는 있는데 progress-tracker에 등록 안 된 상태" 사각지대를 두 가지 신규 명령으로 보완.

### Added

- **`leerness memory search "키" --include-code`** (후보 A): `.harness/*.md` 외에 `src/`, `tests/`, `bin/`, `lib/`, `scripts/` 폴더의 `.js/.ts/.gd/.cs/.py/.rb/.go/.rs/.md/.html/.css/.json` 본문도 검색. 모순 감지 핵심.
- **`leerness brainstorm "주제" --include-code`** (후보 A 확장): 단일/워크스페이스 모드 모두에서 코드 hits 별도 섹션 (`💻 코드`)으로 표시.
- **`leerness register-pending "<요청>"`** (후보 B): 다중 세션/모델이 작업 시작 즉시 progress-tracker에 in-progress T-row를 등록. `--agent <name> --note <text>` 옵션. 다른 세션이 즉시 발견 가능 → 중복/모순 작업 방지.

### Why
1.9.24까지: Gemini가 워크스페이스 직접 수정 (toJson 추가)했지만 progress-tracker에 등록 전엔 다른 세션이 발견 못함 (0/5 fail). 1.9.25:
- 소스 코드 인덱싱으로 즉시 발견 가능 (실측: `memory search "toJson" --include-code` → **0 → 15 matches**)
- `register-pending`으로 작업 시작 시점 즉시 신호 발신

### Migration
```bash
npx leerness@latest update . --yes

# 다중 세션 / 외부 모델 워크플로 (Gemini/Codex/Claude)
leerness handoff --compact > /tmp/ctx.txt
# 외부 모델에 컨텍스트 + 작업 부여
gemini -p "$(cat /tmp/ctx.txt)\n작업: ..." --yolo

# 모순 감지 (코드 검색 포함)
leerness memory search "키워드" --include-code
leerness brainstorm "주제" --all-apps --include-code
```

## 1.9.24 — 2026-05-14

**`leerness deps <capability>` — depends-on 그래프 역방향 추적 + 자동 회귀 sweep**.

오래된 작업 재진행 시 / 핵심 모듈 변경 시 영향받는 모듈을 자동 식별 + 해당 프로젝트의 `npm test`를 일괄 실행.

### Added

- **`leerness deps <capability>`**: 워크스페이스 모든 `reuse-map.md`의 depends-on 엣지를 역방향 추적해 해당 capability를 의존하는 모든 capability와 프로젝트를 식별. 1-hop(직접 의존) + 2-hop(전이 의존) 모두 표시.
- **`leerness deps <capability> --run-tests`**: 영향받는 N개 프로젝트의 `npm test`를 자동 일괄 실행. 회귀 발견 시 어느 프로젝트인지 즉시 보고 + `exit 1`. CI 통합용 `--json`.
- 실측: `leerness deps Character --all-apps --run-tests` 실행 시 rpg-core의 `Character` capability에 의존하는 **6 프로젝트(8 capability) 자동 식별 + 6/6 npm test 자동 일괄 실행**.

### Why
오래된 작업을 재진행하거나 핵심 모듈을 변경할 때, 영향받는 다른 프로젝트를 수동으로 grep하던 패턴을 1 명령으로 자동화. depends-on 그래프(1.9.18부터 수집)가 활용됨.

### Migration
```bash
npx leerness@latest update . --yes
# 사용 예
leerness deps Character --all-apps --run-tests
```

## 1.9.23 — 2026-05-14

**Install 사용성 개선 — `preferGlobal` + `main` 필드 + README 상단 Install 섹션**.

npmjs.com 페이지가 자동 표시하는 `npm i leerness`만 따라 했을 때 `leerness` 명령이 PATH에 없어 실패하던 문제를 안내로 보완.

### Changed
- `package.json` — `preferGlobal: true` (npm이 사용자에게 전역 설치 권장 메시지 출력) + `main: "bin/harness.js"` (라이브러리 import도 가능)
- `README.md` — 최상단에 **⚙️ 설치 (Install)** 섹션 추가. 3가지 옵션 명시:
  1. `npx leerness@latest ...` (추천, 설치 불필요)
  2. `npm i -g leerness` (전역 설치)
  3. `npm i --save-dev leerness` + `npx leerness ...`

## 1.9.22 — 2026-05-14

**Ollama 로컬 LLM 통합 (opt-in 전용) — handoff --compact + orchestrate --agents N + llm-bench record**.

LLM 벤치마크에서 확인된 4가지 개선점 통합. **opt-in 정책 엄수**: 사용자가 leerness 적용 프로젝트에서 로컬 LLM 사용을 원치 않을 수 있어 자동 활성화 금지.

### Added

- **`leerness handoff --compact`** (후보 1): 4KB 출력을 ~500자 1-3줄로 압축. LLM 시스템 프롬프트 주입용. 핵심: 진행률 + 프로젝트 1줄씩 + 핵심 규칙 1줄.
- **`leerness orchestrate "<목표>" --agents N`** (후보 3, 사용자 정책 명시):
  - **Opt-in 전용**: `LEERNESS_OLLAMA_BASE_URL` 환경변수 감지 시에만 활성화. 미설정 시 명령 거부 + 한국어 안내. **LLM 자동 호출 절대 금지**.
  - `.env` 파일 자동 로드 (간단 파서).
  - `--agents N` 가변 (1~256). 사용자 요구 "10/20개 등 늘어날 수 있음" 반영.
  - `--model` 선택, `--retry-on-fail K`(후보 2 통합), Promise.all 병렬.
  - 실측: 10 agent에서 5.5× 병렬 효과.
  - `.harness/orchestrate-log.md` 자동 누적.
- **`leerness llm-bench record`** (후보 4): `.harness/llm-bench-history.md`에 표 누적.
- **`.env.example`**: `LEERNESS_OLLAMA_BASE_URL=` + `LEERNESS_OLLAMA_MODEL=` + opt-in 정책 한국어 주석.

### Policy (사용자 명시)
- ❌ 환경변수 없이 LLM 자동 호출 금지
- ✅ 환경변수 감지 시에만 활성화 (사용자 동의 표명으로 간주)
- ✅ sub-agent 수는 사용자가 결정 (`--agents` 가변)

## 1.9.21 — 2026-05-14

**verify-claim 도메인 확장 hot fix** — `.cfg`/`.ini`/`.env`/`.toml`/`.lock`/`.conf`/`.properties` 추가.

## 1.9.20 — 2026-05-14

**verify-claim 정확도 + 도메인 확장 — Godot/jest/mocha 지원, verify-code --bench**.

1.9.19를 실전 RPG 워크스페이스에 쓰면서 발견한 3가지 한계를 모두 보완. **Round 4 (rpg-godot) 작업에서 실제로 false negative 발생**한 케이스가 동기.

### Added / Changed

- **`verify-claim` file path 인식 확장**: 1.9.19까지는 `src/bin/tests/public/lib` prefix만 인식 → Godot의 `scenes/*.tscn`, `scripts/*.gd`, 루트 `project.godot` 등 미검출. 1.9.20부터 **확장자 화이트리스트 기반**으로 변경. dir prefix는 optional, 확장자는 길이 내림차순 정렬로 `.ts` vs `.tscn` 정확히 구분.
  - 신규 지원 확장자: `tscn / tres / godot / gd / cs / py / rb / go / rs / kt / sh / mdx / json5 / yaml / scss / sass / less / gltf / dockerfile / webmanifest` 등
- **`verify-claim --run-tests` stdout 파싱 확장**: 1.9.19까지는 `X/Y 통과/passed/pass` 만 인식. 1.9.20부터 **jest** (`Tests: 12 passed, 12 total`), **mocha** (`7 passing`), **tap** (`# pass 5`) 형식도 자동 인식. evidence 컬럼 파싱에도 동일 패턴 적용.
- **`verify-code --bench`**: `package.json#scripts.bench`가 있으면 추가 실행. 성능 metric을 `.harness/review-evidence.md`에 자동 누적. 1.9.19에서 별도 `perf record` 명령 추가 대신 기존 verify-code 확장으로 통합 — 의존성 0, 워크플로 일관.

### Why
- 1.9.19를 사용한 RPG 워크스페이스에서 `verify-claim T-0002 --path _apps/rpg-godot` 실행 시 evidence "project.godot + scenes/main.tscn + scripts/network.gd + scripts/main.gd"가 0건 검출. 1.9.20에서 **4/4 모두 정확 검출** 확인.
- 외부 npm 패키지가 jest/mocha를 쓰는 경우 evidence나 stdout이 한국어가 아니어도 자동 인식.
- 부하 측정 같은 동적 metric을 회고에서 추적 가능하도록 evidence 누적 채널 확장.

### Migration
```bash
npx leerness@latest update . --yes
```

## 1.9.19 — 2026-05-14

**1.9.18 후속 다듬기 — verify-claim에 동적 실행, --strict-elements 정확도 강화**.

1.9.18을 실전 sub-agent 검수에 쓰면서 발견한 두 가지 가공할 점을 마저 보완.

### Added

- **`leerness verify-claim --run-tests`**: 정적 점검(파일 존재 + 테스트 카운트)에 더해 `npm test`를 동적으로 실행. stdout에서 `X/Y passed` 패턴을 파싱해 evidence 주장과 비교. 주장이 `5/5 통과`인데 실제 `3/5`면 exit 1. `--json`에 `run.parsed`, `verdict.declaredPassMatches` 포함.
- **`--strict-elements` 출력 강화**: 같은 함수명이라도 (a) 같은 파일이면 `⚠ 진짜 중복 가능`, (b) 다른 파일이면 `ℹ 의도 분리 가능` (예: 모듈 함수 vs CLI 명령)으로 분류. 1.9.18의 평면 출력보다 false positive 식별이 쉬워짐.

### Why
- `verify-claim`만으로는 "파일이 있고 check() 호출이 많다" 정도까지만 보장. `--run-tests`가 추가되면 메인 에이전트가 sub-agent의 evidence를 **한 번의 명령으로 정적+동적 모두 검증**.
- 1.9.18 `--strict-elements`가 city-insights의 `MemoStats`/`StatsCli`(둘 다 `stats()` 함수, 다른 파일) 같은 의도된 분리를 잠재 중복으로 평면 표시 → 사용자가 직접 판별해야 했음. 1.9.19에선 정보를 더 줘서 즉시 분류 가능.

### Migration
```bash
npx leerness@latest update . --yes
```

## 1.9.18 — 2026-05-14

**오케스트레이션 검수 패키지 — `--since` 시간 필터 + `--strict-elements` 잠재 중복 + `depends-on` 그래프 + `verify-claim` 자동 검증**.

1.9.17의 워크스페이스 모드를 실전 멀티 에이전트 작업에서 사용하다 발견한 4가지 갭을 모두 보완합니다. 검수 자동화에 초점.

### Added

- **`leerness handoff --since <duration>`**: `24h` / `3d` / `1w` / `30m` 형식. 해당 기간 내 수정된 T-row에 🆕 마크 + 별도 "최근 변경" 섹션. sub-agent들이 방금 무엇을 추가했는지 한눈에.
- **`leerness reuse-map --strict-elements`**: element 컬럼에서 함수명 추출 (`src/build.js (escapeHtml)` → `escapeHtml`), **다른 capability 이름인데 같은 함수**를 잠재 중복으로 감지. 명명 일관성 검사용.
- **`reuse-map` depends-on 표기**: notes 컬럼에 `depends-on: A, B` 표기 시 자동 추출해 의존 그래프로 표시. 단일/워크스페이스 모두 지원. JSON에 `dependsEdges` 포함.
- **`leerness verify-claim <T-ID>`**: progress-tracker의 evidence 컬럼 자동 파싱 — 주장한 파일 경로 존재 확인, 주장한 테스트 수 vs 실제 `check()/test()/it()` 호출 수 대조. 불일치 시 `exit 1`. CI 통합용 `--json`.

### Why
멀티 에이전트 병렬 작업 검수 시 메인 에이전트가 매번 수동으로 `wc -l`, `grep`, `npm test`를 돌리고 있었음. 1.9.18은 그 패턴을 하나의 명령으로 자동화:
- "지금 sub-agent들이 뭘 추가했지?" → `handoff --all-apps --since 1h`
- "같은 함수를 두 번 만든 거 아닌가?" → `reuse-map --all-apps --strict-elements`
- "이 에이전트의 evidence가 진짜인가?" → `verify-claim T-0008`

### Migration
```bash
npx leerness@latest update . --yes
```

## 1.9.17 — 2026-05-14

**워크스페이스 오케스트레이션 — `handoff --all-apps` + `reuse-map --all-apps` + 중복 capability 감지**.

멀티 에이전트 병렬 작업 시 메인 에이전트가 한 번의 명령으로 모든 sub-agent의 진행 상태를 파악하고, 새 패턴이 다른 프로젝트와 중복되는지 즉시 검증할 수 있습니다.

### Added

- **`leerness handoff --all-apps` / `--include`**: 워크스페이스 전체의 진행 상태(WIP/blocked/다음 작업)를 한 화면에 출력. 4개 sub-agent가 병렬로 일할 때 메인 agent의 상황 인식용. `--json`도 지원.
- **`leerness reuse-map [path]`**: 단일 프로젝트의 reuse-map.md 파싱 출력.
- **`leerness reuse-map --all-apps` / `--include`**: 다수 프로젝트의 모든 capability를 모아 **동일 이름 capability를 자동 중복 감지**. 재사용/공통 모듈 추출 기회 식별. `--json`도 지원.

### Why
1.9.16까지의 `retro --all-apps`는 누적 회고용. 1.9.17은 **실시간 오케스트레이션용**: "지금 어떤 에이전트가 무엇을 하고 있고, 새 패턴이 다른 프로젝트와 겹치는가?"에 답합니다.

### Migration
```bash
npx leerness@latest update . --yes
```

## 1.9.16 — 2026-05-13

**brainstorm 워크스페이스 통합 + 3 명령 JSON export + session close 워크스페이스 안내**.

### Added

- **`leerness brainstorm "<주제>" --all-apps` / `--include`**: retro/insights에 이어 brainstorm도 다수 프로젝트 통합 검색. 프로젝트별 결과 요약 + 워크스페이스 총합.
- **`--json` 옵션** (retro / insights / brainstorm, 단일/워크스페이스 모두): JSON으로 export. CI/대시보드 연동 가능.
- **session close 끝에 워크스페이스 안내**: `_apps/*/` 또는 부모 `_apps/*/`에 다른 leerness 프로젝트가 있으면 `🌐 워크스페이스에 N개 — leerness retro --all-apps` 자동 안내.

### Migration
```bash
npx leerness@latest update . --yes
```

## 1.9.15 — 2026-05-13

**브레인스토밍 출처 표시 + 워크스페이스 통합 회고/통찰**.

### Added

- **brainstorm 매치 위치 표시**: 모든 결과에 `.harness/<file>:<line>` 형식의 파일 경로 + 줄 번호. task 결과는 매치된 필드(request/evidence/nextAction)도 함께 표시.
- **`leerness retro --all-apps`**: 현재 디렉토리 + `_apps/*` (또는 부모 `_apps/*`)의 모든 leerness 프로젝트를 통합 회고. 프로젝트별 한 줄 요약 + 다음 우선 작업 + top 스킬 + 워크스페이스 총합 (task / done % / 결정 / 스킬 / 사용 / 최적화 / pass-fix 비율).
- **`leerness retro --include <p1,p2,...>`**: 명시 경로 통합 회고. 쉼표 구분 다중 경로 지원.
- **`leerness insights --all-apps`** / **`--include`**: 통합 통계를 표 형식으로 출력 + 안정성 평가 + 최적화 권장.

### Migration

```bash
npx leerness@latest update . --yes
```

기존 명령은 모두 호환. `--all-apps` / `--include`는 선택 옵션.

## 1.9.14 — 2026-05-13

**1.9.13의 retro/brainstorm 정확도 4건 fix** (city-insights 대형 프로젝트 운영 중 발견).

### Fixed

- **A. decisions Template 카운트 오류**: init이 만드는 `decisions.md`의 `### YYYY-MM-DD — Decision` 템플릿 예시가 실제 결정으로 잘못 카운트되던 문제. `_extractDecisionBlocks()` 헬퍼가 코드블록(```...```) 안의 ### 와 `### (Template|템플릿)` 시작 블록을 자동 제외.
- **B. brainstorm 토큰 매칭 부정확**: 단순 substring 매치로 인해 무관한 task가 잡히던 문제. **유니코드 word boundary** (`(?<![\p{L}\p{N}_])…(?![\p{L}\p{N}_])`) 기반 토큰 매칭으로 변경. 다중 토큰 (예: `"API rate limit"`)은 **모두** 매치되어야 결과로 표시.
- **C. retro 다음 우선 작업이 planned 미포함**: in-progress/blocked가 비어있으면 "(없음)"으로 표시되던 문제. 우선순위 가중치 (in-progress=0, blocked/waiting/on-hold/incomplete=1, planned/requested=2)로 정렬해 planned도 포함.
- **D. decisions.md 템플릿 형식**: init 디폴트가 실 결정과 동일한 `### YYYY-MM-DD — Decision` 형식이라 retro 카운트와 충돌. 템플릿을 **명시적 ```` ```md ```` 코드블록**으로 감싸 표시. retro/brainstorm/lessons가 일관되게 무시.

### Migration

```bash
npx leerness@latest update . --yes
```

기존 프로젝트의 decisions.md는 그대로 두면 자동으로 정확히 카운트됩니다 (코드블록 처리는 양쪽 모두 동작).

## 1.9.13 — 2026-05-13

**회고·통찰·브레인스토밍** — 누적된 leerness 데이터에서 자동으로 패턴/추세/주제별 자원을 추출.

### Added — 3 신규 명령

- **`leerness retro [path] [--days 7]`** — 회고
  - 작업 상태 분포 / 다음 우선 작업 / 스킬 활용 추세 / 최근 결정 / **검증 시간 추세** / 룰 검증률 / fix↔pass 시그널 비율 / 권장 다음 단계
- **`leerness insights [path]`** — 누적 통계
  - 핵심 지표 / top 스킬 / 검증 시간 통계 / 안정성 (pass÷fix 비율) / 권장
- **`leerness brainstorm "<주제>"`** — 주제 기반 자원 회수
  - decisions / skills / tasks / rules / evidence에서 매칭 → 관련 과거 실패(lessons) 포함 → 시작 전 권장 액션

### Added — 자동 회고

- `session close`가 매번 끝에 **한 줄 요약** 자동 출력: `완료 N/M (X%) · 스킬 N종 사용 K회 · 검증 변화 ±X% · 결정 N건 누적`
- **5세션마다** 자동 깊은 회고 실행 (`.harness/cache/session-counter.json`로 카운팅)
- 다음 깊은 회고까지 남은 세션 수 안내

### Added — 자연어 매핑 (AGENTS.md/CLAUDE.md)

| 사용자 발화 | 즉시 실행 |
|---|---|
| "회고해줘" / "돌아보자" | `leerness retro` |
| "통계 / 누적 지표" | `leerness insights` |
| "X 브레인스토밍 / X 검토" | `leerness brainstorm "X"` |

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 마이그레이션. 이후 session close부터 한 줄 요약 자동 출력.

## 1.9.12 — 2026-05-13

**`leerness roadmap` 자동 생성·갱신** — 3개 트리거.

### Added — 자동 roadmap

- **`install` 직후 자동 생성**: `npx leerness init .` 끝에 첫 `roadmap.html` 자동 생성. `--no-auto-roadmap`으로 끔.
- **`session close` 끝 자동 갱신**: `leerness session close .` 마지막에 자동 갱신 출력 라인(`✓ roadmap.html 자동 갱신 (session-close)`).
- **데이터 변경 즉시 갱신** (옵트인): `--on-every-change`로 켜면 `task add/update/drop`, `plan add`, `rule add/pause/resume` 등이 호출될 때마다 즉시 갱신.

### Added — `leerness roadmap auto on|off|status`

- `roadmap auto on [--on-every-change] [--out file.html]` — 활성화 + 옵션 조정
- `roadmap auto off` — 비활성화 (수동 `leerness roadmap`만 작동)
- `roadmap auto status` — 현재 설정 표시 (enabled / onEveryChange / outFile / 트리거별 활성 여부)
- 설정 파일: `.harness/cache/auto-roadmap.json`
- 환경변수 옵트아웃: `LEERNESS_NO_AUTO_ROADMAP=1`

### Default

신규 init은 **enabled=true / onEveryChange=false**. 가장 자연스러운 워크플로우:
1. `leerness init . --skills recommended` → 첫 roadmap.html 즉시 생성
2. 작업 → session close → 자동 갱신
3. 변경이 많아 즉시 갱신을 원하면 `roadmap auto on --on-every-change`

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 마이그레이션. 이후 첫 session close부터 자동 갱신.

## 1.9.11 — 2026-05-12

**`leerness roadmap` 명령 통합 + `project-roadmap-generator` 스킬 기본 추천 + 화이트보드/토큰/상하 중앙정렬**.

### Added — `leerness roadmap [path] [--out file.html]`

`project-roadmap-generator` 로직을 leerness 본 패키지에 통합. 외부 의존성 없이 즉시 사용 가능.

- 좌→우 수평 트리 (project → milestones → tasks → skills/rules)
- **상하 중앙정렬**: 각 column의 노드들이 캔버스 세로 중앙 기준으로 균등 분포
- **디자인 토큰 자동 주입**: `.harness/design-system.md`의 Tokens 표 + 프로젝트 `styles/tokens.css`의 CSS 변수를 HTML `:root`에 `--lr-*`로 주입 (h1·card·border·dot 색상이 사용자 토큰을 따름)
- **화이트보드**: 드래그 panning, 휠 zoom (마우스 포인터 중심), 더블클릭 reset, +/-/⟳ 컨트롤 버튼
- 7개 상태 (완료/진행/보류/검토/예정/미완료/오류) + 스킬/룰 색상
- Milestones, 예정 작업, 보유 스킬, 활성 룰, 최근 결정, 디자인 토큰 6개 섹션 통합

### Changed — `recommended` 스킬에 자동 포함

`leerness init . --skills recommended` 호출 시 `project-roadmap-generator` 스킬이 기본으로 설치됩니다 (기존 4종 + 1). 별도 설치 불필요.

```
recommended = ['office','commerce-api','ai-verified-skill-publisher','feature-implementation','project-roadmap-generator']
```

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다. `leerness roadmap`이 바로 사용 가능합니다.

## 1.9.10 — 2026-05-12

**leerness-skillpack 분리 + release publish 강화 (git remote 자동 감지 + GitHub Release + gh-pages 배포)**.

### Changed — 스킬 카탈로그 동적 로드

- `leerness-skillpack`이 npm에 별도 패키지로 분리됨. leerness 본 패키지는 `_tryLoadSkillpack()`으로 다음 순서로 동적 로드:
  1. `require('leerness-skillpack/catalog.json')` 시도
  2. `<cwd>/node_modules/leerness-skillpack/catalog.json` 탐색
  3. `npm root -g`의 `leerness-skillpack/catalog.json` 탐색
  4. `LEERNESS_SKILLPACK_PATH` 환경변수 경로
  5. 모두 실패 시 leerness 본 패키지의 내장 fallback (1.9.x 호환 유지)
- `leerness init` 출력에 `Skill catalog source: skillpack v1.0.0 | builtin (fallback)` 안내.
- `leerness skill list` 헤더에 카탈로그 출처 + 출처 컬럼에 `skillpack` / `builtin` / `user` 표시.

### Added — release publish 강화

- `detectGitRemote(root)`: 현재 디렉토리의 `git remote -v origin` 자동 감지 + GitHub owner/repo 추출.
- `leerness release publish` 신규 플래그:
  - `--auto` — remote 있으면 자동 `git push` (편의)
  - `--gh-release` — gh CLI로 GitHub Release 자동 생성 (`v<version>` 태그 + 자동 노트 + tarball 첨부)
  - `--gh-pages` — `gh-pages` branch에 정적 파일 자동 배포 (orphan 또는 기존 branch). 기본 소스는 `roadmap.html`, `--gh-pages-src <file>` 또는 `--roadmap <file>`로 지정.
  - `--pack` — npm pack만 명시적 실행
- `gh-pages` 배포는 임시 git worktree로 처리해 현재 작업 트리에 영향 없음. 배포 후 `https://<owner>.github.io/<repo>/` URL 안내.

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다. leerness-skillpack은 선택 설치:

```bash
npm install leerness-skillpack    # 본 카탈로그 사용
# 또는 그대로 두면 leerness 내장 fallback이 동작 (기존과 동일)
```

## 1.9.9 — 2026-05-12

- 1.9.9 빌드 + GitHub 배포

**1.9.8 시연 중 자체 도그푸드(dogfood)로 빌드된 패치 — 룰 시스템이 정확히 작동한 증거**.

### Fixed
- `nonFlagArgs()`의 `withValue` set에 `--trigger`, `--check`, `--set`, `--min-score` 추가. 이전에는 `rule add "..." --trigger every-update` 호출 시 `every-update`가 description 끝에 합쳐져 등록되던 작은 버그.

### Demonstrated (자체 도그푸드)
- 메인 디렉토리에 사용자 자연어 룰 3종 (버전 bump / CHANGELOG 추가 / 배포 안내) 등록
- `leerness handoff`가 active rules 자동 노출 ✓
- `leerness rule pause R-0003` → handoff에서 R-0003 사라짐 ✓
- `leerness release bump --patch` → 1.9.8 → 1.9.9 자동 ✓
- `leerness release note "..."` → 이 CHANGELOG 항목 자동 작성 ✓
- `leerness session close`가 룰 검증 (`✓ pass / ⓘ manual / ○ baseline`) 자동 보고 ✓

## 1.9.8 — 2026-05-08

**자연어 룰 등록 + 매 세션 자동 노출·검증 + 코드로 자동화 가능한 release 명령군**.

### Added — User Rules

- `.harness/rules.md` — 사용자 정의 영구 룰의 단일 출처. AGENTS.md mandatory read order 10번에 자동 포함.
- `leerness rule add "<설명>" --trigger every-session|every-update|every-commit|session-start|session-close|pre-publish` — 룰 등록.
- `leerness rule list / verify / pause <id> / resume <id> / remove <id> / stop / resume-all` — 룰 라이프사이클.
- `leerness handoff`가 **active rules를 매 세션 시작 시 자동 출력** (사용자 중지 요청 전까지).
- `leerness session close`가 **활성 룰별 자동 검증 결과 (`✓ pass / ⓘ manual / ⓿ pending / ○ baseline`) 자동 보고**.

### Added — 자연어 룰 처리 지시 (AGENTS.md / CLAUDE.md)

사용자가 자연어로 "매 X마다 Y를 해줘"라고 말하면 AI 에이전트가 즉시 `leerness rule add` 명령을 호출하도록 매핑 표를 추가:

| 자연어 | leerness 명령 |
|---|---|
| "매 업데이트마다 버전 bump" | `rule add "버전 patch bump" --trigger every-update` |
| "매 커밋마다 패치노트" | `rule add "패치노트 추가" --trigger every-commit` |
| "세션 종료마다 배포" | `rule add "배포" --trigger session-close` |
| "X 룰 중지/그만" | `rule pause <id>` |
| "X 룰 제거" | `rule remove <id>` |
| "모든 룰 중지" | `rule stop` |

### Added — release 명령군 (자동화 가능한 룰의 실행 도구)

- `leerness release bump [--patch|--minor|--major]` — `package.json#version`과 `.harness/HARNESS_VERSION` 자동 bump.
- `leerness release note "<내용>"` — CHANGELOG.md에 자동 추가 (같은 버전이면 항목만, 새 버전이면 헤더+항목).
- `leerness release publish [--dry-run] [--git-push] [--npm-publish]` — npm pack + (선택) git push + (선택) npm publish 통합.

### Added — 룰 자동 검증 휴리스틱

`session close`가 매번 자동 수행:
- **version / 버전 / bump 키워드 룰** → `package.json` version이 baseline 캐시 대비 갱신됐는지.
- **changelog / 패치노트 키워드 룰** → CHANGELOG.md mtime이 갱신됐는지.
- **test / 테스트 / verify 키워드 룰** → review-evidence.md에 오늘 verify-code 흔적이 있는지.
- **deploy / 배포 / publish 키워드 룰** → 자동 검증 불가 → `ⓘ manual` (사용자 안내).

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다. `.harness/rules.md`는 자동 생성됩니다.

## 1.9.7 — 2026-05-08

코드 검증 자동 실행 + 과거 결정/실수 자동 회수 + TODO 자동 추적의 3종 자동화.

### Added — A. `leerness verify-code [path] [--build]`

`package.json#scripts`에서 `test` / `lint` / `typecheck` (또는 `tsc`) / (선택) `build`를 자동 감지해 차례로 실행. 결과는 모두 `review-evidence.md`에 자동 누적 (`Command/Tasks/exit/duration/tail`). 실패 시 `process.exit(1)` + progress의 in-progress row를 `incomplete`로 표시 권장 안내.

- `tsconfig.json`이 있고 `typecheck` script가 없으면 `npx tsc --noEmit` 자동 호출.
- 5분 timeout 내장 (장기 실행 방지).

### Added — B. `leerness lessons [--query <키>] [--limit N]`

`decisions.md`의 모든 `### 블록`, `review-evidence.md`의 실패 표지(`✗ / fail / 롤백 / incomplete / bug / 버그 / warning`) 블록, `task-log.md`의 실패 키워드 라인, `session-handoff.md`의 Incomplete 섹션을 통합 추출. `--query`로 키워드 필터.

- `leerness guide [target]`이 자동으로 lessons 섹션을 추가 (target 이름을 query로 사용).

### Added — C. `lazy detect --auto-track` + `.harness/known-todos.json`

새 TODO/FIXME/XXX의 `(file, line, text)` 위치 캡처. `known-todos.json`에 acknowledged 기록을 비교해 매번 같은 false positive를 줄이고, 새로 발견된 것만 노출. `--auto-track`으로 `progress-tracker.md`에 `T-XXXX requested`로 자동 등록 + known-todos.json에도 자동 추가.

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다.

## 1.9.6 — 2026-05-08

1.9.5 후 발견된 한 가지 한계 (옛 link 손실 자동 복구 부재)를 패치.

### Added

- **`leerness task relink [--apply] [--min-score 0.2]`** — `plan.md`의 milestone 텍스트와 `progress-tracker.md`의 task `request` 텍스트를 jaccard 토큰 유사도로 비교해 미연결 milestone을 가장 비슷한 row와 자동 매칭. default는 제안만 출력 (사용자가 명령 복사해 실행), `--apply`로 자동 적용. `--min-score`로 임계 조정 (기본 0.2).
- **`audit`이 미연결 milestone 발견 시 `leerness task relink` 안내 자동 출력**.

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다.

## 1.9.5 — 2026-05-08

1.9.4 운영 중 발견된 한계 2건 + 추가 디버그 사항을 패치합니다.

### Fixed

- **F. `task fix-evidence --set` link 보존**: 기존 evidence의 `plan:M-XXXX` 링크를 새 텍스트에 자동으로 `(plan:M-XXXX)` 형태로 부착. `--no-preserve-link`로 끌 수 있음. 이전엔 링크가 사라져 audit이 milestone 미연결로 잡았음.
- **G. `impact` 동적 참조 (medium)**: `path.join`, `path.resolve`, `readFile`, `writeFile`, `fs.*`, `new URL` 등이 base 파일명을 인자로 받는 패턴을 별도 카테고리(medium)로 분리. default 출력에 strong + medium 모두 표시. site-cli의 `build.js`처럼 동적으로 컴포넌트를 읽는 빌더가 더 이상 weak로만 잡히지 않음.

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다.

## 1.9.4 — 2026-05-08

1.9.3 운영 중 발견된 5개 한계점을 모두 패치합니다.

### Fixed

- **A. impact 정확도**: 강한 참조(`import / require / @import / href / src / url / include`)와 약한 참조(식별자 등장)를 분리해 default는 강한 참조만 출력. word boundary 추가로 `cards` 안의 `card`가 false positive로 잡히던 문제 해결. `--all`로 약한 참조까지 표시.
- **B. cross-platform 종료 코드**: main이 끝난 뒤 `process.exit(process.exitCode)`을 명시. 셸 wrapper나 npx 파이프라인에서 `$?`이 0으로 보이던 문제 해결. `ui consistency --fail-on-violation`은 `--strict-exit`로 즉시 `process.exit(1)`도 가능.
- **C. lazy detect string literal 휴리스틱**: 매치 위치가 `'…'`/`"…"`/`` `…` `` 안이면 카운트에서 제외. leerness CLI 자기 자신(bin/harness.js)도 자동 skip. 메인 디렉토리에서 30개 잡히던 false positive 사실상 0.

### Added

- **D. `leerness task fix-evidence`** — `done` 상태이면서 evidence가 비어있거나 `user-request` / `plan:M-XXXX` 단독인 row를 일괄 점검. `--set "<텍스트>"`로 일괄 갱신, 또는 row별 `task update` 명령을 출력해 가이드.
- **E. `.leerness-skip-dirs` 파일** — 프로젝트 루트에 두면 추가 skip 디렉토리(예: `_apps/`, `leerness-pkg/`)가 모든 walk에서 적용됨. 1줄당 1개 디렉토리, `#` 주석 지원. 기본 skip 셋에도 `out`, `tmp`, `temp`, `.svelte-kit`, `.parcel-cache` 추가.

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다.

## 1.9.3 — 2026-05-08

이번 릴리스는 "이전 작업과 새 작업의 인과관계·재귀 안내·디자인 일관성"을 자동화합니다.

### Added — 인과관계·재사용·일관성

- `leerness impact <target>` — 변경 전 영향 분석. `<target>`을 `import/require/href/src/@import/url()`로 참조하는 모든 파일을 단일 패스로 식별.
- `leerness reuse find <query>` — `reuse-map.md`, `design-system.md`, `feature-contracts.md`, `plan/progress`, 그리고 코드의 export/식별자에서 기존 자원을 통합 검색.
- `leerness reuse register <name> --where <path> --kind component|hook|util|api [--note ...]` — `reuse-map.md`에 자동 row 추가.
- `leerness ui consistency [path] [--strict] [--fail-on-violation]` — `design-system.md`의 토큰 표를 파싱해 코드의 hex 색상이 토큰에 등록되어 있는지 검사. `--strict`는 px/rem 사이즈도, `--fail-on-violation`은 비-제로 종료.
- `leerness graph [path] [--out <file>]` — 의존성 그래프를 mermaid 형식으로 출력하거나 파일로 저장.
- `leerness guide [target]` — 위 4개를 한 번에 실행하는 변경 전 통합 가이드.

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다.

## 1.9.2 — 2026-05-08

스킬을 살아 있는 학습 사이클로 끌어올린 릴리스. 동일 API 작업이 반복될 때 기존 패턴을 발견·재사용하고, 더 나은 방법이 생기면 최적화 이력으로 누적합니다.

### Added — 스킬 학습 사이클

- `leerness skill learn <id> --doc <url> --command "..." --capability "..." [--note ...]`
  - 새 스킬을 `.harness/skills/<id>/skill.json`에 생성하거나, 카탈로그 스킬을 로컬에 materialize.
  - `--doc` / `--capability`는 반복 가능 (n번 적으면 모두 누적).
  - `skill.json` 스키마 확장: `sources[]`, `patterns[]`, `optimizations[]`, `usage{count,lastUsed,lastNote}`.
- `leerness skill use <id> [--note ...]`: 사용 횟수+1, lastUsed 갱신.
- `leerness skill optimize <id> --before "..." --after "..." [--note ...]`: 최적화 이력 누적.
- `leerness skill remove <id>`: 사용자 정의 스킬 삭제 (카탈로그 스킬은 로컬 메타만 정리).
- `leerness skill consolidate [--threshold 0.3]`: 모든 스킬의 capability 토큰 jaccard 비교로 통합 후보 자동 발견.
- `leerness skill list`가 카탈로그 + 사용자 스킬을 합쳐 출력 (출처/사용횟수/최종 컬럼 추가).
- `leerness skill info <id>`가 sources/patterns/optimizations까지 모두 표시.

### Added — 게이트 통합

- `leerness gate [path]` — `verify + audit + scan secrets + encoding check + lazy detect`을 한번에 실행해 단일 요약을 출력. 한 단계라도 실패하면 비-제로 종료.
- `leerness self check`을 `leerness update --check`의 thin wrapper로 통합. 단일 출처(npm view + 캐시)로 일원화하면서 1.8.0과의 호환을 위해 명령 자체는 유지.

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다. 카탈로그 스킬에 대한 사용 기록은 처음 `skill use`/`skill optimize` 시점부터 누적되기 시작합니다.

## 1.9.1 — 2026-05-08

1.9.0을 실 프로젝트(memo-cli)에서 운영하며 발견한 **5개 메타 감사 사항**을 패치합니다.

### Fixed

- **P1**: `autoUpdateInstall`이 legacy `leerness-plus update --check` SessionStart hook을 자동 정리. fork 시절 잔재로 인해 매 세션 npm 호출이 2회 발생하던 문제 해소.
- **P2**: `managedMerge`에 `MERGE_OVERWRITE_FILES` 화이트리스트 추가 (`skill-index.md`, `manifest.json`, `skills-lock.json`, `HARNESS_VERSION`, `LANGUAGE`, `context-routing.md`). 다단계 migrate를 거쳐도 표/메타데이터가 누적되지 않음.
- **P4**: `audit`이 `<!-- leerness:na <reason> -->` 마커를 인식. CLI 패키지 등 디자인 토큰/재사용 맵이 NA인 프로젝트에서 영구 경고가 사라짐.
- **P6**: `lazy detect`의 evidence 정규식을 `/^plan:M-\d{4}\s*$/`로 좁힘. `plan:M-XXXX` 단독은 부족 판정, `tests:32/32 (plan:M-0002)`처럼 검증 키워드 동반 시 통과.
- **P7**: `install`이 끝날 때 디폴트 `M-0001`이 plan에 있는데 progress에 row가 없으면 `T-XXXX` 자동 생성. audit "milestones without progress entry: M-0001" 경고가 init 직후 사라짐.

### Added

- `leerness skill list [path]` 출력에 **설치됨** 컬럼 추가 (root가 인자/현재 디렉토리에 있을 때).

### Migration

기존 1.9.0 설치본은 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다.

## 1.9.0 — 2026-05-08

이번 minor 릴리스는 1.8.0의 6개 결함을 수정하고, 자동 감지·자동 업데이트·핸드오프 자동 작성·게으름/시크릿/인코딩 자동 가드를 흡수한 큰 강화입니다. 기존 `npx leerness init` 흐름은 그대로 유지됩니다.

### Fixed (vs 1.8.0)

- B1: `task update`가 in-place 갱신하도록 progress-tracker를 구조화 파싱.
- B2: `plan add`의 milestone ID와 progress task ID 분리. evidence 컬럼에 `plan:M-XXXX` 링크.
- B3: `plan add --status/--progress/--next/--evidence` 인자가 progress row에 일관 반영.
- B4: `task list`가 표만 정돈 출력 (frontmatter 노출 안 함).
- B5: `routes.feature`이 참조하는 `feature-implementation` 스킬을 카탈로그에 추가하고 init이 `.harness/skills/feature-implementation/{README.md,skill.json}`을 자동 생성.
- B6: `session close`가 progress-tracker를 구조화 파싱하여 status 컬럼 정확 매칭.

### Added — 자동 감지·업데이트

- `leerness update [--check|--yes|--force|--from <tarball>]`
  - 현재 `.harness/HARNESS_VERSION` 자동 파싱 (1.8.0 bare, `leerness@1.8.0+plus@x.y.z` legacy plus 표기 모두 인식).
  - `npm view leerness version`으로 최신 비교 (24h 캐시).
  - 새 버전 발견 시 `npx leerness@latest migrate .`에 자동 위임 → 백업·머지·검증.
  - post-migration 으로 `status`/`verify`/`audit`을 자동 실행, `task-log.md`/`review-evidence.md` 자동 누적.
- `leerness auto-update install` — `.claude/settings.local.json`의 SessionStart hook + `/update` 슬래시 커맨드 자동 등록.
- `init`/`migrate`가 끝나면 위 hook을 기본 등록 (`--no-auto-update`로 끌 수 있음).
- `LEERNESS_OFFLINE=1` 환경변수로 npm 호출 건너뜀 (CI/오프라인 호환).

### Added — 컨텍스트·핸드오프 자동화

- `leerness handoff [path]` — 세션 시작 컨텍스트 자동 적재 + `current-state.md` 스탬프 자동 갱신.
- `leerness check [path]` — pre-action 정합 검증 (필수 파일·보호 정책).
- `leerness session close`가 `session-handoff.md`와 `current-state.md`를 **자동 작성** (이전엔 출력만 했음).
- `.harness/templates/{end-of-session-report.md, decision.md, task-row.md}` 표준 템플릿 추가.

### Added — 자동 가드

- `leerness audit [path]` — 디자인 가이드 중복·design 토큰·reuse-map·plan↔progress 정렬·handoff 신선도 감사.
- `leerness scan secrets [path]` — AWS/GitHub/GitHub fine-grained/OpenAI/Anthropic/Google/Slack/PEM/하드코딩 password 9개 패턴.
- `leerness encoding check [path]` — UTF-8 BOM, UTF-16 BOM, NUL, .bat의 chcp 65001 누락, 한글 라운드트립.
- `leerness lazy detect [path]` — 증거 없는 done, 빈 handoff, 추적 없는 TODO/FIXME, blocker 방치 자동 감지.
- `leerness memory search "키"` — decisions/log/handoff/plan/progress/evidence/architecture grep.

### Added — 정책 강화

- `.harness/anti-lazy-work-policy.md` — 1줄 선언 → 6개 규칙 + 자동 점검 항목.
- `.harness/secret-policy.md` — 패턴 목록 명시.
- `.harness/encoding-policy.md` — BOM/UTF-8/.bat chcp/Python coding/LF 통일.
- `.harness/test-evidence-policy.md` — 검증 기록 누적 형식.
- `.harness/review-evidence.md` — 자동 누적 evidence 파일.
- `.harness/guardrails.md` — 5개 파일 이상 리팩토링 사전 승인, destructive Git 가드.
- `.harness/task-type-map.md` — `bugfix`, `refactor`, `research`, `session-start` 작업 유형 추가.

### Added — Claude Code 통합

- `.claude/commands/{handoff, session-close, audit, lazy-detect, update, viewwork-ping}.md` 슬래시 커맨드.
- `.claude/skills/leerness.md` Claude Code 스킬 정의.
- `.claude/settings.local.json` SessionStart + Stop hook 자동 등록.

### Added — ViewWork 통합

- `leerness viewwork install` — `.viewwork/` 셋업 + Claude Code Stop hook 등록.
- `leerness viewwork emit` — JSONL 1줄 추가 (`.viewwork/agent-events.jsonl`).
- `session close`가 자동으로 viewwork emit.

### Changed

- `.gitignore`에 `.harness/archive/`, `.harness/migration-report.md`, `.harness/cache/` 라인 머지.
- `.gitattributes` 자동 생성 (`* text=auto eol=lf`, `*.bat eol=crlf`, `*.ps1 eol=crlf`).
- `routes.feature`이 가리키는 경로를 `.harness/skills/feature-implementation/README.md`로 정정.

### E2E

`npm test` (= `node scripts/e2e.js`)가 빈 임시 디렉토리에서 30+개 시나리오를 실측합니다 (B1 in-place upsert 회귀 + offline `update --check` + SessionStart hook 검증 포함).

## 1.8.0 — 2026-05-07

(이전 메인테이너의 릴리스. https://github.com/gugu9999gu/leerness 참고.)
