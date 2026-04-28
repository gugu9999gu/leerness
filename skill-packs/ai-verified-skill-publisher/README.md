# AI 검증 스킬 업로드·라이브러리화 스킬

AI 에이전트가 검증된 스킬 데이터를 안전하게 라이브러리화하고 npm 또는 git으로 업로드할 때 사용하는 운영 절차입니다.

## 가능한 작업

- 성공한 구현 패턴을 스킬 후보로 추출
- 스킬 메타데이터에 한글명, 가능한 작업, 최종 업데이트일, 검증 상태 기록
- 민감정보를 제거하고 환경변수 이름만 남김
- AI 검증 메타데이터를 생성하고 strict-ai 검증 통과
- npm/git access token을 환경변수 또는 로컬 설정에서 확인
- 토큰이 없으면 실제 업로드 직전에 입력 요구
- npm/git 업로드 전 dry-run 확인
- 업데이트, 병합, 마이그레이션 후 재검증

## 인증 우선순위

1. `--token-env <ENV_NAME>`
2. `LEERNESS_NPM_TOKEN`, `NPM_TOKEN`, `NODE_AUTH_TOKEN`
3. `LEERNESS_GIT_TOKEN`, `LEERNESS_GITHUB_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN`
4. `.harness/skill-publish.local.json`
5. 없으면 프롬프트 입력

Git 기본 저장소 경로는 `https://github.com/gugu9999gu/leerness`입니다.
