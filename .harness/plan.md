---
leernessRole: plan
readWhen:
  - 작업 시작 전
  - 새 요청 접수
  - 범위 변경
  - 신규 프로젝트 감지
updateWhen:
  - 계획 추가/수정/드랍
  - milestone 변경
  - 목표 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Plan

## Goal
- AI 코딩 세션이 **증거 없이 "완료"라고 말하지 못하게** 하는 하네스를 만든다. 컨텍스트 적재(handoff) ·
  주장 검증(verify-claim) · 마감(session close)을 매 세션의 고정 절차로 만들고, 그 절차가 실제로
  결함을 잡는지 **매 라운드 적대적 검수 + 게이트(선택test·selftest·e2e)로 증명**한다.
- 배포 형태는 의존성 0 · 설치 스크립트 없음 · 오프라인 우선 · Windows 우선의 npm CLI + MCP 서버다.

## Scope
- 포함: CLI/MCP 표면, 세션 하네스 문서 생성·마이그레이션, 프로젝트 위생 감사(audit/드리프트/시크릿/인코딩/고아 가드),
  자기 검증(selftest·e2e)과 릴리스 파이프라인.
- 제외: 다른 프로젝트의 코드를 고치는 일. 다른 프로젝트는 **읽기 전용 증거원**으로만 쓴다(도그푸딩).

## Out of Scope / Dropped
| ID | Item | Reason | Date |
|---|---|---|---|

## Milestones

### M-0001. 프로젝트 계획 정리
Status: planned
Progress: 0%

Tasks:
- [ ] project-brief.md를 실제 프로젝트 목적에 맞게 작성
- [ ] context-map.md를 실제 파일 구조에 맞게 작성

### M-0002. Adversarial review of v1.36.18 P2-6 masking, P3-8 compact handoff, P1-2 10k ID parsing: source audit plus scratch reproduction
Status: planned
Progress: 0%
Done-When: (미정)

Tasks:
- [ ] Adversarial review of v1.36.18 P2-6 masking, P3-8 compact handoff, P1-2 10k ID parsing: source audit plus scratch reproduction

### M-0003. Focused _maskCommentsStrings adversarial re-review: nested templates, regex ambiguity, and contract false-fail reproduction
Status: planned
Progress: 0%
Done-When: (미정)

Tasks:
- [ ] Focused _maskCommentsStrings adversarial re-review: nested templates, regex ambiguity, and contract false-fail reproduction

### M-0004. T-0013: Probe _maskCommentsStrings/_REGEX_KW only for concrete false-missing regressions
Status: planned
Progress: 0%
Done-When: (미정)

Tasks:
- [ ] T-0013: Probe _maskCommentsStrings/_REGEX_KW only for concrete false-missing regressions

### M-0005. FINAL convergence check: realistic contract-verify false-fails in _maskCommentsStrings only
Status: planned
Progress: 0%
Done-When: (미정)

Tasks:
- [ ] FINAL convergence check: realistic contract-verify false-fails in _maskCommentsStrings only

### M-0007. Final line-leading-only _maskComments adversarial review
Status: completed
Progress: 100%
Done-When: Valid-JavaScript false-blank, missed-comment, caller-integration, and termination probes independently reproduced or refuted.

Tasks:
- [x] Final line-leading-only _maskComments adversarial review
