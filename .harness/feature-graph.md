---
leernessRole: feature-graph
readWhen:
  - 신규 기능 추가 전
  - 데이터 형식 변경 전
  - 외부 API 매칭 작업 전
updateWhen:
  - feature 등록 / 링크 / impact 회수
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Feature Graph (1.9.141)

> **목적**: 각 기능의 인과관계를 정확히 정리해서 코드 작성 전 영향 범위를 자동 추적.
> 신규 기능 추가, 데이터 형식 변경, 외부 API 매칭 작업 전 `leerness feature impact <id>`로 확인.
> handoff가 현재 task 키워드로 자동 매칭해서 영향받는 feature 목록을 회수.

## How to use

```bash
leerness feature add "User Auth"                           # F-0001 자동 부여
leerness feature link F-0002 --depends-on F-0001           # 의존 관계
leerness feature link F-0001 --affects F-0002,F-0005        # 영향 관계 (다수)
leerness feature link F-0001 --co-changes-with F-0011       # 함께 변해야 하는 기능
leerness feature impact F-0001                              # 영향받는 전체 (transitive)
leerness feature list --json                                # 그래프 JSON
leerness feature show F-0001                                # 단일 상세
```

## Nodes

