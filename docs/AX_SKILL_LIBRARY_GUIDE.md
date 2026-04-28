# Leerness AX Skill Library Guide

AX는 AI eXperience입니다. 이 문서는 AI 에이전트가 검증된 스킬 데이터를 안전하게 학습, 검증, 빌드, 업로드, 업데이트, 병합, 마이그레이션하도록 안내합니다.

## 스킬 표시 기준

`leerness skill list`는 아래 정보를 표시합니다.

- 스킬 영문 id
- 한글명 `displayNameKo`
- 가능한 작업 `capabilities`
- 최종 업데이트일 `lastUpdated`
- AI 검증 상태 `verification.status`
- 필요한 환경변수 이름 `requiresEnv`

## AI 검증 업로드 표준 흐름

1. 성공한 구현 패턴을 스킬 후보로 추출합니다.
2. `leerness skill learn <name> --from <path>`로 라이브러리 구조를 만듭니다.
3. `skill-library.json`에 한글명, 가능한 작업, 최종 업데이트일을 기록합니다.
4. 실제 토큰/쿠키/비밀번호/고객 데이터가 없는지 검사합니다.
5. `leerness library verify <path> --ai --reviewer leerness-ai`로 AI 검증 메타데이터를 기록합니다.
6. `leerness library validate <path> --strict-ai`로 업로드 게이트를 통과합니다.
7. `leerness library build <path>`로 배포 구조를 만듭니다.
8. `leerness library publish <built-path> --target npm|git`으로 dry-run을 확인합니다.
9. 사용자가 승인한 경우에만 `--execute`로 실제 업로드합니다.

## 설치 가능한 운영 스킬

```bash
leerness skill add ai-verified-skill-publisher
```

이 스킬은 AI가 검증된 스킬을 업로드·업데이트·병합·마이그레이션할 때 따라야 할 절차를 프로젝트에 설치합니다.

## 업로드 인증 토큰 규칙

검증된 스킬팩을 실제 업로드할 때는 아래 순서로 access token을 확인합니다.

1. `--token-env <ENV_NAME>`으로 지정한 환경변수
2. npm: `LEERNESS_NPM_TOKEN`, `NPM_TOKEN`, `NODE_AUTH_TOKEN`
3. Git/GitHub: `LEERNESS_GIT_TOKEN`, `LEERNESS_GITHUB_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN`
4. `.harness/skill-publish.local.json`의 `publishAuth.npmTokenEnv`, `publishAuth.gitTokenEnv`, `publishAuth.gitRemoteUrl`
5. 위 값이 없으면 AI/사용자에게 토큰 입력을 요구

권장 로컬 설정:

```json
{
  "publishAuth": {
    "npmTokenEnv": "LEERNESS_NPM_TOKEN",
    "gitTokenEnv": "LEERNESS_GITHUB_TOKEN",
    "gitRemoteUrl": "https://github.com/gugu9999gu/leerness"
  }
}
```

실제 토큰값은 저장하지 말고 환경변수나 Secret Manager에 둡니다.
