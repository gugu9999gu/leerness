# Skill: AI 검증 스킬 업로드

## 목적
검증된 스킬 데이터를 npm 또는 git 라이브러리로 업로드한다.

## 절차
1. `leerness library validate <path> --strict-ai`로 구조와 민감정보를 검사한다.
2. `leerness library verify <path> --ai --reviewer leerness-ai`로 AI 검증 메타데이터를 기록한다.
3. `leerness library build <path>`로 배포본을 만든다.
4. `leerness library publish <built-path> --target npm|git`로 dry-run을 확인한다.
5. 토큰 소스를 확인한다.
6. `--execute`로 실제 업로드한다.

## 금지
- 실제 토큰을 스킬 문서에 저장하지 않는다.
- 검증 상태가 `passed`가 아닌 스킬은 업로드하지 않는다.
