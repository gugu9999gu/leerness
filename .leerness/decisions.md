# Decisions

## Template (예시 — 실제 결정은 아래 코드블록 밖에 추가)

```md
### YYYY-MM-DD — Decision 제목
- Decision:
- Reason:
- Alternatives:
- Impact:
```

### 2026-06-08 — 용어집/가이드 기능 설계 결론(외부 AI 3-에이전트 평가 종합): 광범위 버전(가이드+기능맵+프로젝트설명)은 brief/feature-graph/context-map/guide/api-skill 와 ~70-80% 중복이라 제외. 유일한 진짜 공백 = '의존성 용어집'(package.json/requirements deps→비개발자용 한줄설명). 회의론자의 '저품질' 우려는 코드-식별자 정적추출(S2)엔 타당하나, 큐레이션 카탈로그(_TOOL_CATALOG, 기존 constraints 카탈로그처럼 ~30-50개 손작성)엔 미해당 — 고품질+무LLM+비중복. 사용자가 비개발자 명시 → 대상 검증됨.
- Decision: 용어집/가이드 기능 설계 결론(외부 AI 3-에이전트 평가 종합): 광범위 버전(가이드+기능맵+프로젝트설명)은 brief/feature-graph/context-map/guide/api-skill 와 ~70-80% 중복이라 제외. 유일한 진짜 공백 = '의존성 용어집'(package.json/requirements deps→비개발자용 한줄설명). 회의론자의 '저품질' 우려는 코드-식별자 정적추출(S2)엔 타당하나, 큐레이션 카탈로그(_TOOL_CATALOG, 기존 constraints 카탈로그처럼 ~30-50개 손작성)엔 미해당 — 고품질+무LLM+비중복. 사용자가 비개발자 명시 → 대상 검증됨.
- Reason: build new 가 아니라 curated catalog 로 좁게: 중복 회피 + leerness 제약(무LLM/0deps) 부합 + 비개발자 실가치
- Alternatives: 
- Impact: 

### 2026-06-09 — 외부 리뷰는 '블라인드'로: README 를 물리적으로 숨기고(mv) leerness 소개 없이 코드/행위만 분석시켜 외부 분석가 관점 확보 → 그 결과로 README 재구성. 모델 지시 의존 대신 파일 제거로 강제(맹신 X).
- Decision: 외부 리뷰는 '블라인드'로: README 를 물리적으로 숨기고(mv) leerness 소개 없이 코드/행위만 분석시켜 외부 분석가 관점 확보 → 그 결과로 README 재구성. 모델 지시 의존 대신 파일 제거로 강제(맹신 X).
- Reason: 
- Alternatives: 
- Impact: 

### 2026-06-10 — 범용 AI 코딩 하네스 포지셔닝: 5축 클린룸 실증 결과 '조건부 가능' — 관리층(장부·인수인계·증거요구)은 즉시 범용, 검증층(테스트 실행·카운트)은 JS 전용이라 P1 2건 해소 후 '범용 검증' 표방. 당분간 포지셔닝 문구는 '증거 없이는 끝났다고 말할 수 없게 만드는 작업 장부 하네스'
- Decision: 범용 AI 코딩 하네스 포지셔닝: 5축 클린룸 실증 결과 '조건부 가능' — 관리층(장부·인수인계·증거요구)은 즉시 범용, 검증층(테스트 실행·카운트)은 JS 전용이라 P1 2건 해소 후 '범용 검증' 표방. 당분간 포지셔닝 문구는 '증거 없이는 끝났다고 말할 수 없게 만드는 작업 장부 하네스'
- Reason: 5개 독립 클린룸 리포트 + P1 직접 재현 확정
- Alternatives: 
- Impact: 

### 2026-06-10 — 영상 변주 시스템 설계: Date.now/random 금지(멱등) — 버전 문자열 해시를 시드로 씬 구성(4종 스토리 구조)·카피 풀·스타일(배경/타이포/모션)·씬 길이를 결정적으로 변주. published.json 이력으로 직전 영상과 같은 변주면 시프트. verify-video 게이트 + 프리뷰 2버전 프레임 비교로 '실제로 다름' 검증
- Decision: 영상 변주 시스템 설계: Date.now/random 금지(멱등) — 버전 문자열 해시를 시드로 씬 구성(4종 스토리 구조)·카피 풀·스타일(배경/타이포/모션)·씬 길이를 결정적으로 변주. published.json 이력으로 직전 영상과 같은 변주면 시프트. verify-video 게이트 + 프리뷰 2버전 프레임 비교로 '실제로 다름' 검증
- Reason: 사용자 명시: 매 영상이 구성부터 스타일까지 달라야 함
- Alternatives: 
- Impact: 

### 2026-07-09 — 정직성 감사→소진: 1.36.4 recall FN, 1.36.5 성숙도 판정 과장, 1.36.6 강제력/종합-health 문구 정직화
- Decision: 정직성 감사→소진: 1.36.4 recall FN, 1.36.5 성숙도 판정 과장, 1.36.6 강제력/종합-health 문구 정직화
- Reason: 심층 멀티에이전트 정직성 감사(35에이전트 9표면 20확정)에서 성숙도 판정 과장(P1)을 1.36.5로, handoff health토큰/policy차단/KO identity 허위완료차단/README measures(P2/P3)을 1.36.6으로 정직화. 전부 selftest+e2e 386 게이트 통과 후 배포·클린룸 재실증. 세션-길이 leerness참조 감쇠 메타테스트: 반박(workspace-ops 평탄, 작업종류 교란) 단 compaction재개시 handoff ritual 누락 gap 1건
- Alternatives: 
- Impact: 

### 2026-07-09 — 1.36.7 handoff 넛지: 메타-테스트가 도그푸드한 세션-시작 리추얼 사각지대를 기능으로 메꿈
- Decision: 1.36.7 handoff 넛지: 메타-테스트가 도그푸드한 세션-시작 리추얼 사각지대를 기능으로 메꿈
- Reason: task/decision add 시 마지막 handoff gap>120min이면 넛지(_getLastHandoffGap 재사용). FP가드(기록부재→무넛지)·opt-out·selftest 281·게시본 재실증. 실측→기능화 루프
- Alternatives: 
- Impact: 

### 2026-07-09 — 1.36.8 심층 정직성 감사 완결: encoding passed 스코프 + self-heal 범위 정직화 + 넛지 task update 확장
- Decision: 1.36.8 심층 정직성 감사 완결: encoding passed 스코프 + self-heal 범위 정직화 + 넛지 task update 확장
- Reason: 1.36.5 감사 확정 20건 중 수정 대상 전부 소진(1.36.5 성숙도 P1 → 1.36.6 강제력 P2/P3 → 1.36.8 marginal P3). 잔여는 과거 CHANGELOG 역사 기록으로 소급 수정 안 함. selftest 282 + e2e 386 + 게시본 재실증
- Alternatives: 
- Impact: 

### 2026-07-10 — 17th 클린룸 리뷰(게시본 1.36.10) 4/4 채택 → 1.36.11: deps --json 환경의존 누수 + UNC 꼬리매치 우회 + DB렌즈 prose FP + en 렌즈 i18n
- Decision: 17th 클린룸 리뷰(게시본 1.36.10) 4/4 채택 → 1.36.11: deps --json 환경의존 누수 + UNC 꼬리매치 우회 + DB렌즈 prose FP + en 렌즈 i18n
- Reason: codex 클린룸 행위검증이 dev 트리에서 절대 안 잡히는 환경 의존 경로(P1-A: _apps 없는 곳에서만 노출되는 deps plain-text 누수 → 설치본 selftest 283/284)를 잡음 — 클린룸 리뷰 존재 이유 재실증. 게시본 재실증: 설치본 selftest 285/285
- Alternatives: 
- Impact: 

### 2026-07-11 — requests 위생 라운드: 미답 10건 중 7건 소진(완료-미마킹 6 + 행위반박 1), 잔여 3건은 실백로그로 유지
- Decision: requests 위생 라운드: 미답 10건 중 7건 소진(완료-미마킹 6 + 행위반박 1), 잔여 3건은 실백로그로 유지
- Reason: 맹신 X 대조: [완료X.Y.Z] 제목 6건은 CHANGELOG 1.12.2/1.12.3/1.15.1/1.16.1 실재 확인 후 complete(중복 2건 포함). UR-0041(bare leerness auto-init footgun)은 1.36.11 행위 재검에서 생성 파일 0개로 재현 불가 — 이미 해소됨. 잔여: UR-0009(selftest 견고화 저순위), UR-0028/0051(영상 파이프라인 별도 아크)
- Alternatives: 
- Impact: 

### 2026-07-21 — ACP 미구현 결정 — Agent Client Protocol(Zed 계열)은 에디터-에이전트 토폴로지라 운영 레이어에 자리 없음(MCP 경유 간접 호환 + enforce 프로토콜 무관 커버), BeeAI ACP(REST)는 오프라인-퍼스트/0-deps 원칙 충돌(.leerness substrate 로 동일 문제 해결). docs/interoperability.md 에 입장 명문화
- Decision: ACP 미구현 결정 — Agent Client Protocol(Zed 계열)은 에디터-에이전트 토폴로지라 운영 레이어에 자리 없음(MCP 경유 간접 호환 + enforce 프로토콜 무관 커버), BeeAI ACP(REST)는 오프라인-퍼스트/0-deps 원칙 충돌(.leerness substrate 로 동일 문제 해결). docs/interoperability.md 에 입장 명문화
- Reason: 사용자 질의로 검토 — 미고려가 아닌 고려-후-결정 상태로 전환
- Alternatives: 
- Impact: 

### 2026-07-28 — 검증기 캘리브레이션(referee) 채택 — 검증기 자신의 탐지력을 실행으로 증명
- Decision: 검증기 캘리브레이션(referee) 채택 — 검증기 자신의 탐지력을 실행으로 증명
- Reason: leerness 전 검사가 정적·텍스트 대리 지표라 '검증기가 실패를 잡을 수 있는가'를 증명하는 장치가 없었다. codex 독립검토와 4렌즈 분석이 만장일치 최우선으로 지목
- Alternatives: ponytail 명령군 이식(기각: lens/reuse/review-request 중복) · 마이그레이션 러너(기각: 정체성 변질) · 룰 스냅샷(이연) · ladder 영수증(이연)
- Impact: verify-claim/gate 가 '캘리브레이션된 검증기'만 신뢰하도록 — done 은 증거를 요구한다의 형제 명제

### 2026-08-04 — P-0013 추출기는 스택 탐지 후 스택별 전략을 쓰고, 증명 가능한 하한만 싣는다
- Decision: P-0013 추출기는 스택 탐지 후 스택별 전략을 쓰고, 증명 가능한 하한만 싣는다
- Reason: 실측(실제 12개 프로젝트): 대문자 export 를 컴포넌트로 세면 auto-influencer 83->33, view-work 116->66, Adzento 62->0 으로 2~3배 부풀려진다. Adzento 는 플레인 HTML 이라 순진한 추출기가 가짜 컴포넌트 62개를 만든다. 토큰도 출처가 정반대다 — Tailwind 프로젝트(12개 중 7개)는 CSS 변수가 0~5개이고 유틸 어휘가 74~121종(text-ink-50 417회), Adzento 는 CSS 변수 58개에 Tailwind 0. 한쪽만 보는 추출기는 절반에서 무용지물이 된다.
- Alternatives: 
- Impact: 

### 2026-08-04 — 적대적 입력은 시나리오가 아니라 대상의 구조에서 유도한다
- Decision: 적대적 입력은 시나리오가 아니라 대상의 구조에서 유도한다
- Reason: 1.36.97: 내 ReDoS 프로브가 12종 병적 입력을 만들고 최악 33ms 로 보고했으나 실제는 227,760ms. 폭발 원인인 (^|\\n)\\s* 는 \\s* 가 개행을 삼켜 모든 \\n 위치에서 되돌림이 생기는 구조였고, 정규식이 이미 최악 입력을 말하고 있었다. 앞으로 수량자마다 '이게 삼킬 수 있는 문자'를 반복해 매칭 실패 입력을 만들고 크기 2배씩 곡선을 그린다.
- Alternatives: 
- Impact: 

### 2026-08-05 — 표면 가드는 소스 grep 대신 실제 출력/데이터로 검사한다
- Decision: 표면 가드는 소스 grep 대신 실제 출력/데이터로 검사한다
- Reason: 1.36.101: 명령 표면 감사에서 소스 grep 가드가 두 번 연속 무너졌다 — (1) 'const _GROUP_USAGE = {' 문자열이 다른 selftest 의 가드 안에도 있어 슬라이스가 엉뚱한 곳을 집었고 (2) 선언 이름을 바꾸자 옛 가드가 허공을 가리켜 메타가드가 잡았다. 표면은 실제 CLI 출력으로, 병렬맵은 데이터(키 집합)로 단언한다.
- Alternatives: 
- Impact: 

### 2026-08-18 — P-0016 의 P2 를 '범위 클레임' 에서 '쓰기 측 compare-and-set(로스트 업데이트 가드)' 으로 바꾼다. 근거: P1 정찰/적대적 검수가, 클레임은 leerness 를 부르는 에이전트만 덮는 반면 compare-and-set 은 leerness 를 한 번도 안 부르는 에이전트의 변경까지 잡고 오탐이 원리적으로 불가능(해시가 실제로 달라야 발화)하다고 판단. 클레임은 P3 로 미룬다.
- Decision: P-0016 의 P2 를 '범위 클레임' 에서 '쓰기 측 compare-and-set(로스트 업데이트 가드)' 으로 바꾼다. 근거: P1 정찰/적대적 검수가, 클레임은 leerness 를 부르는 에이전트만 덮는 반면 compare-and-set 은 leerness 를 한 번도 안 부르는 에이전트의 변경까지 잡고 오탐이 원리적으로 불가능(해시가 실제로 달라야 발화)하다고 판단. 클레임은 P3 로 미룬다.
- Reason: 
- Alternatives: 
- Impact: 

### 2026-08-23 — GIT_CONFIG_NOSYSTEM을 Git 위치 격리 목록에서 제외
- Decision: GIT_CONFIG_NOSYSTEM을 Git 위치 격리 목록에서 제외
- Reason: 이 변수는 저장소 대상을 바꾸지 않고 시스템 Git 설정 가시성만 바꾼다. 내부 git에서만 삭제하면 enforce 설치 경로와 같은 셸의 실제 git commit 경로가 달라져 훅이 우회된다.
- Alternatives: GIT_CONFIG_NOSYSTEM을 내부 Git에서만 제거하는 방식은 거부한다. 설치기와 호출자 Git의 설정 가시성이 달라진다.
- Impact: enforce 설치와 같은 셸의 Git commit이 동일한 시스템 Git 설정 가시성을 사용한다.

### 2026-08-26 — 레거시 claims baseline은 명시적 경계와 행 지문에만 적용
- Decision: 레거시 claims baseline은 명시적 경계와 행 지문에만 적용
- Reason: 평가 보고서와 실제 109건을 대조하면 과거 증거를 소급 수정하는 방식은 역사 왜곡이고, 전 실패 자동 면제는 새 거짓완료를 숨긴다.
- Alternatives: 과거 evidence 일괄 보강(기각: 변조), gate 완화(기각: 신규 실패 은폐), 현재 실패 전부 자동 면제(기각: 경계 없음)
- Impact: verify-claim baseline create --before <T-ID> --yes로만 생성하며, 원본 행·실패사유 지문이 달라지거나 신규 실패·손상 baseline이면 fail-closed한다.
