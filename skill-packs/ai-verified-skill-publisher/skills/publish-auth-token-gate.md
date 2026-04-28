# Skill: 업로드 인증 토큰 게이트

## npm 토큰 소스
- `--token-env <ENV_NAME>`
- `LEERNESS_NPM_TOKEN`
- `NPM_TOKEN`
- `NODE_AUTH_TOKEN`
- `.harness/skill-publish.local.json`의 `publishAuth.npmTokenEnv`

## Git/GitHub 토큰 소스
- `--token-env <ENV_NAME>`
- `LEERNESS_GIT_TOKEN`
- `LEERNESS_GITHUB_TOKEN`
- `GITHUB_TOKEN`
- `GH_TOKEN`
- `.harness/skill-publish.local.json`의 `publishAuth.gitTokenEnv`

## 로컬 설정 예시

```json
{
  "publishAuth": {
    "npmTokenEnv": "LEERNESS_NPM_TOKEN",
    "gitTokenEnv": "LEERNESS_GITHUB_TOKEN",
    "gitRemoteUrl": "https://github.com/gugu9999gu/leerness"
  }
}
```

실제 토큰값은 환경변수 또는 Secret Manager에 둔다.
