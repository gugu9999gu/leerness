# Publish Pre-check (leerness 1.9.0)

> ⚠ **Owner 권한 필수**: npm `leerness`의 메인테이너는 `gytlrgpfl <gytlrgpfl96@gmail.com>` 입니다. 이 계정으로 로그인되어 있거나 collaborator로 등록되어 있어야 publish가 통과합니다. 권한이 없으면 `E403 Forbidden`이 떨어집니다.

## 1. 메타데이터 보강 (선택)

`package.json`의 다음 필드는 비어 있거나 일반적입니다. 사용자 정보로 채우는 것을 권장합니다.

```json
{
  "author": "leerness contributors",
  "repository": { /* 비어있음 */ },
  "bugs": { /* 비어있음 */ },
  "homepage": ""
}
```

예:

```json
"author": "Your Name <you@example.com>",
"repository": { "type": "git", "url": "git+https://github.com/<user>/leerness.git" },
"bugs": { "url": "https://github.com/<user>/leerness/issues" },
"homepage": "https://github.com/<user>/leerness#readme"
```

publish 필수는 아니지만, npm 페이지 신뢰도와 사용자 경험을 위해 채워두면 좋습니다.

## 2. 권한 확인

```bash
npm whoami
# → 응답이 leerness의 owner인지 확인
npm owner ls leerness
# → 자신의 계정이 목록에 있는지 확인
```

권한이 없으면 collaborator 추가를 owner에게 요청해야 합니다.

## 3. 로컬 검증

```bash
node ./bin/harness.js --version    # → 1.9.0
npm pack --dry-run                 # 패키지 내용 미리보기
node ./scripts/e2e.js              # 30+개 시나리오 통과
```

## 4. 1.8.0 → 1.9.0 자동 업그레이드 시연 (선택)

```bash
mkdir /tmp/lr-old; cd /tmp/lr-old
npx -y leerness@1.8.0 init . --language ko --skills recommended
LEERNESS_OFFLINE=1 npx -y -p /path/to/leerness-1.9.0.tgz leerness update . --yes
cat .harness/HARNESS_VERSION       # → 1.9.0
```

## 5. publish dry-run

```bash
npm publish --dry-run
# 또는
npm publish leerness-1.9.0.tgz --dry-run
```

확인:
- `package.json#files`와 실제 tarball 내용 일치
- 총 크기 (≈30~40 kB)
- bin → harness.js 매핑

## 6. 실 publish

```bash
npm login                  # 권한 있는 계정으로
npm publish --access public
```

## 7. publish 후 검증

```bash
npm view leerness version          # → 1.9.0
npx -y leerness@latest --version   # → 1.9.0
mkdir test-install && cd test-install
npx -y leerness@latest init . --yes --language ko --skills recommended
npx -y leerness@latest verify .
```

## 8. 롤백

24시간 이내라면 `npm unpublish leerness@1.9.0` 가능. 이후엔 1.9.1 패치 또는 deprecate.

```bash
npm deprecate leerness@1.9.0 "Use 1.9.1+"
```
