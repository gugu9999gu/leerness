---
leernessRole: task-log
readWhen:
  - 작업 이력 확인
updateWhen:
  - 모든 의미 있는 작업 후
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Task Log

## 2026-06-17
- Leerness v1.32.0 initialized.

## 2026-07-07 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-07 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-11 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-11 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-11 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-13 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-13 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-13 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-14 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-14 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-14 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-14 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-14 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-14 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-14 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-14 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-14 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-07-17 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-05 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-05 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-23 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-23 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-23 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-23 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-23 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-23 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-23
- Synced plan.md and progress-tracker.md.

## 2026-08-23 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-23 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-24 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-24 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-24 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-24 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-24 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-24 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-24 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-24 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-25 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-25 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-25 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-26 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-26 — T-0145 legacy claims baseline

- `verify-claim baseline create --before <T-ID> --yes`를 추가해 과거 evidence를 소급 수정하지 않고 경계 이전의 현재 실패만 전체 tracker 행+실패 사유 SHA-256 지문으로 격리했다.
- `verify-claim --all`·`gate --claims`·MCP를 baseline-aware로 통합하고 `--raw`/개별 검증은 원판정을 유지했다. 신규·변경·경계 밖·손상 baseline은 fail-closed하며 gate JSON에도 구체 진단을 보존한다.
- 독립 리뷰에서 발견한 기존 baseline 재세탁, gate JSON 진단 누락, 동시 최초 생성 TOCTOU를 모두 재현·수정했다. create는 기존 정책을 덮어쓰지 않고 저장 락 안에서 destination 부재를 다시 확인한다.
- 검증: `npm test` exit 0 — E2E 467/467, selftest 354/354, core 46/46, handoff 75/75, command surface 40/40, installed cleanroom 10/10, claims baseline 27/27, 동시 생성 7/7. 실제 프로젝트 gate는 rawFailed 68 · baselined 68 · failed 0. 독립 리뷰 P0/P1/P2 없음.
- 릴리스: 구현 `9412a324e3e0e10313ed5336c49ed2a30cff7766`; GitHub `main`과 `v1.36.167` 태그 일치, Release exact tarball 첨부; npm latest `1.36.167`, SHA-1 `c6137556cb76f84898e71b34c611723026956c07`가 로컬 산출물과 일치; 작업공간 밖 exact-version 설치가 `1.36.167`, 0 deps, 0 install-script를 재확인했다.
- 사이트: `leerness-site` 커밋 `d642359`, Astro 691 pages/claims check 통과, Cloudflare Pages deployment `d6650ef0`, `https://leerness.com`이 첫 production probe에서 `1.36.167` 노출.
- T-0146 추가 증거: 일반 `npm exec --package=leerness@1.36.167`은 현재 PATH에서 `1.36.165`를 실행했지만 fresh-prefix 설치본은 `1.36.167`이었다. registry 실패가 아니라 shim/실행 해석 오염으로 분리한다.
- 세션 마감: R-0002 자동 검증 통과(`1.36.166 → 1.36.167`), R-0001 독립 리뷰 수동 확인 완료. pre-wake critical 1건은 기존 영상 요청 UR-0028/UR-0051의 링크 누락으로 확인했으며 이번 코드·게시본 차단과는 무관하다.
- 다음: GitHub CI run 32974961842 최종 green 확인 후 T-0146 Windows `which` shim-pair false-positive 교정.

## 2026-08-26 — T-0143 release verification

- leerness 1.36.165를 npm, GitHub Release, leerness.com production에 게시하고 exact version/integrity/tag target/site marker를 재검증했다.
- 별도 leerness-gate 0.0.3 프로젝트를 1.36.165 harness로 마이그레이션하고 테스트 92/92, 설치 클린룸 12/12, Worker dry-run 및 leerness 자체 가드를 통과했다.
- 외부 ox-alpha 평가 보고서는 지시가 아닌 보수적 증거로 분류했다. 재현된 cross-runtime permission/evidence 결함만 수정했고, 재현되지 않거나 소비자 인코딩 문제인 주장은 제품 결함으로 과대 해석하지 않았다.

## 2026-08-26 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-26 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-26 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-26 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-27 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-28 — T-0094 dead-flag audit

- 광고됐지만 무시되던 6개 명령 표면을 fail-closed 또는 관측 가능한 계약으로 배선하고, 정상 4개 표면은 변경 없이 회귀로 고정했다.
- 외부 Codex가 재현한 후속 경계 결함을 모두 수정한 뒤 P0/P1/P2 없음으로 수렴했다.
- 빠른 게이트 13/13과 전체 E2E 467/467을 포함한 `npm test`가 통과했다. 다음 단계는 v1.36.174 GitHub/npm/leerness.com 게시와 공개본 검증이다.

## 2026-08-27 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-27 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-28 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-28 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-28 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-29 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-29 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-29 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-29 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-30 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-30 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-30 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-31 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-08-31 — T-0163 pre-release verification

- English `skill list` 누수 4줄을 stored/env/explicit locale 실제 CLI에서 0으로 줄였고, 한국어 바이트·canonical JSON 값·적대적 외부 메타데이터 계약을 보존했다.
- 외부 Codex P2 4건을 재현·수정한 뒤 최종 재검토가 actionable P0/P1/P2 없음으로 수렴했다.
- 전체 E2E 467/467(5,068초), 지연 경쟁 11/11, 범프 후 fast smoke 13/13, claims gate 6/6을 통과했다. 39-command 잔여는 정확히 30줄/16명령이며 다음 단계는 v1.36.183 공개 및 CI 13/13 검증이다.

## 2026-08-31 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-09-01 — v1.36.183 public release and CI verification

- GitHub main/tag/Release가 구현 SHA `6e412c7089bb88151776b12d77a0296c4c131383`에서 일치하고, 2,008,240-byte asset SHA-256이 canonical main 공개 tarball과 일치한다.
- npm latest/exact 1.36.183의 integrity/shasum이 공개 tarball과 일치하고 fresh-prefix 설치본 CLI 1.36.183 및 selftest 355/355가 통과했다.
- 사이트 commit `74796968600763bec42bc449a7ce0f1ce622ec1d`, Cloudflare deployment `475ed5c0-6d47-48a4-a80d-a509777c5d2c`, production 4개 URL HTTP 200을 검증했다.
- GitHub Actions run 33402089854가 구현 SHA에서 13/13 성공했고 failure/cancelled/skipped는 모두 0이다. T-0163과 UR-0093을 완료했으며 T-0159는 waiting 그대로 두었다.

## 2026-09-01 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-09-05 — v1.36.185 convergence pre-release

- T-0165/T-0166/T-0167/T-0171/T-0172를 증거와 함께 done으로 전환하고 UR-0096을 completed로 마감했다.
- provider 24/24, exact-file lease 57/57, schema 88/88, role-store 65/65, fallback 80/80과 전체 npm test의 E2E 467/467(4,947초)이 통과했다.
- 독립 Codex 최종 read-only 검수는 `CLEAN`; 다음 단계는 로컬 claim/gate 후 v1.36.185 GitHub/npm/leerness.com 공개 검증이다.
- 로컬 gate 6/6·claims 147건 신규 실패 0과 다섯 개별 claim이 통과했다. pack dry-run은 88 files, 2,175,087 bytes, shasum `67f8673847fb86ea5010493be038900ba8fc7d90`다.

## 2026-09-01 — T-0164 mode i18n pre-release verification

- English `mode`의 기존 3줄 누수를 stored/env/explicit locale, 공통 pre-dispatch 오류, stale-cache 및 positional/`--path` 우선순위에서 0으로 줄였다. 한국어 출력과 canonical JSON 오류/상태 계약은 보존했다.
- 잠금 획득 후 manifest 재읽기가 손상이면 원본 보존·문서 재생성 0·`manifest_corrupt` 실패로 종료한다. 동시 유효 hostile mode 값은 파일 쓰기 전에 total normalization하여 manifest-only 부분 커밋을 차단했다.
- 실제 `EEXIST` 경합, valid pre-lock read, owner-token-held reread, corrupt/object mutation을 추적하는 결정론적 회귀를 추가했다. 외부 Codex의 반복 검토 결과는 최종 `No actionable P0/P1/P2 findings.`다.
- `npm run test:fast`와 전체 `npm test`가 통과했다: lint 68 JS + 1 JSON, selftest 355/355, core 52/52, handoff 75/75, MCP 22/22, command surface 40/40, installed cleanroom 10/10, E2E 467/467(6,363초), 지연 경쟁 11/11.
- 최종 pre-release 가드는 secrets 미승인 0, encoding 0, check healthy, lazy blocker 0, idempotency 위반 0, gate 6/6·claims 141 신규 실패 0이다. pack dry-run은 78 files, shasum `191e2e10b53a2c09ea6add9b93634dcab99f44e4`, integrity `sha512-GXxV42SZKohwG9dfrlf4nEviqChcIJ943Yq0RYBLkjip4YMPVS+7Io0ss31K9Fr9I75HXwKVdYV8VKAiKES8XQ==`를 산출했다.
- 다음: v1.36.184를 GitHub/npm/leerness.com에 게시하고 공개 설치본·사이트·Actions 13/13을 확인한다. T-0159는 waiting 그대로 유지한다.

## 2026-09-01 — v1.36.184 public release and CI verification

- GitHub main/tag/Release가 구현 SHA `4a504ac304c23c38640bd117382984b2bf3559b7`에서 일치하고, 2,016,064-byte asset SHA-256이 로컬 tarball과 일치한다.
- npm latest/exact 1.36.184의 integrity/shasum이 로컬 pack과 일치하며, fresh-prefix 설치본 CLI/package 1.36.184와 selftest 355/355가 통과했다.
- 사이트 commit `48657ca454de9555c431087951d5d68b275050ae`, Astro 708 pages, Cloudflare production deployment `7c957a08-0ade-4040-a9ec-60e5c727a65c`를 게시했고 production 4개 URL이 첫 검증에서 HTTP 200과 1.36.184를 노출했다.
- GitHub Actions run 33469212506은 구현 SHA에서 13/13 성공했고 failure/cancelled/skipped와 annotation은 모두 0이다. T-0164와 UR-0094를 완료했으며 T-0159는 waiting 그대로 두었다.

## 2026-09-05 — v1.36.185 public release and CI verification

- 구현 merge SHA `585c8f421edda7db200cc78c59a7ca889c05dd10`에서 GitHub main/tag/Release가 일치하고, 2,175,087-byte asset SHA-256 `bd9cb9f18bd89c665a93612d85287e0ac1afecd9d36015105e3f67dc6320dda1`이 로컬 tarball과 일치한다.
- npm latest/exact 1.36.185의 shasum/integrity가 로컬 pack과 일치하며 fresh-prefix 공개 설치본은 CLI/package 1.36.185, runtime dependency 0, install script 없음, selftest 355/355를 확인했다.
- 사이트 commit `b39a79cceb6130d15825496d9d0a72ada5b9023c`, Astro 709 pages, Cloudflare deployment `cd2d9405-9741-4f1b-b685-92408d82c698`를 게시했고 production root/changelog/llms/Pages origin이 첫 시도에 HTTP 200과 1.36.185를 노출했다.
- GitHub Actions run `33932206889`는 구현 SHA에서 13/13 성공했고 failure/cancelled/skipped/timed_out/annotation은 모두 0이다.
- 최종 `session close` 뒤 다섯 task claim은 모두 `ok=true`, gate 6/6·claims 147 신규 실패 0, check healthy다. post-close Git advisory는 이미 커밋된 구현 대신 생성된 `leerness.html`만 현재 diff로 보므로 false/strong-mismatch를 정직하게 기록했다.

## 2026-09-01 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-09-01 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-09-05 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-09-05 — UR-0097 State scope 구조 감사와 계획 반영

- 현재 코드와 실제 main/linked worktree를 읽기 전용으로 대조했다. runtime/cache와 tracked memory/summary가 혼재하며, 기존 mutex와 session ownership만으로 브랜치 merge 문제를 해결할 수 없음을 구분했다.
- docs/state-scopes.md에 5-scope/3-layer 설계, module boundary, single-writer fencing, strict import, immutable record/provenance, finalize durability, 호환 migration과 검증 매트릭스를 작성했다.
- 비어 있던 architecture/reuse-map을 실제 구현으로 채웠고 M-0014..M-0018 및 T-0174..T-0178을 등록했다. M-0010 role migration은 새 scope 계약을 공유하도록 우선순위를 조정했다.
- 독립 검수의 두 문서 지적은 소스와 대조해 수정했고 재검수 2/2 FIXED. 문서 계약 8/8, verify healthy, strict claim 통과. 제품 테스트/제품 코드 변경은 없음.
- P-0020 1차(scope resolver + read-only state inspect, 기존 데이터 무이동)는 승인 요청 중이다. UR-0097 전체 구현은 미완료로 유지한다. 배포는 미실행이며 R-0002를 완료했다고 표시하지 않는다.

## 2026-09-05 — UR-0098 P-0020 승인 및 T-0174 구현/최적화

- 사용자 명시 승인 기록 후 5-scope path/Git/inventory/inspection 모듈과 strict read-only CLI를 구현했다. 기존 Project resolver snapshot selector를 재사용하며 legacy writer/runtime 경로를 변경하지 않는다.
- 일반 실행 계측으로 불필요 npm root -g 1회 발견 후 exact inspect 경로에서 제거했다. Git topology 1회(Windows trusted locator 별도), 프로젝트 내용 읽기 0, write 0 및 fixture/cwd/Git byte+mtime 불변을 확인했다.
- 실제 main+2linked, monorepo, 이동/detached/별도 clone/gitfile/submodule, Windows Unicode/공백/case/junction, 오류·권한·링크 경계를 검증했다. 발견된 nonexistent ceiling과 Windows missing Git status127 분류는 재현 후 수정했다.
- selector26/26, scope58/58, CLI20/20(총104), Node18 scope58/CLI20, selftest355/355, command flags/i18n, contract 및 lint84JS/1JSON 통과. 독립 Codex P2 3건은 실패 테스트로 재현 후 수정했고 focused re-review CLEAN을 받았다. 로컬 npm test는 E2E467/467(5272초)로 종료했으며 최종 수정 후 전용·Node18·설치형 검사를 별도로 재실행했다. bd33683 고정 CI33959679140의 Windows 전체 E2E4개와 v1.36.186 R-0002 배포가 남아 있으므로 T-0174는 아직 in-progress다.

### 최종 출하 검증
- 위 중간 pending 상태 이후 고정 SHA bd33683의 CI33959679140이13/13 성공했다. GitHub main/tag/Release, npm latest/exact1.36.186와 패키지 digest를 검증했고 공개 설치본 selftest355/355·state inspect가 통과했다. 직접 package-object 검사로 runtime deps0/install scripts0도 확인했다.
- 사이트 commit9a11b8b 및 production ad2a3760-eba1-433d-bc9d-c2d1f4429fcd의 root/changelog/llms/Pages HTTP200·버전 표식 검증 통과. T-0174 done, UR-0098 completed, M-0014 completed100%. UR-0097과 M-0015..M-0018은 미완료 유지; 다음은 migration 미리보기 설계·승인이다.

## 2026-09-05 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-09-05 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-09-05 — UR-0099 / T-0179 runtime migration 사전 설계

- T-0175 / M-0015의 초기 reader/writer·field 감사와 docs/worktree-runtime-migration.md를 작성했다. 알려진 22개 표면과 전수 writer coverage 한계를 구분하고 presence, freshness+hook, state.json+runs+handoff를 별도 이전 단위로 정의했다.
- 독립 읽기 전용 감사 두 건은 각각 source8개 SHA256·mtime 불변을 보고했다. 메인이 실제 소스와 대조해 shared policy path, anonymous/inherited session identity, freshness mtime, Windows-only metadata replacement와 구버전 미차단 경계를 확인했다.
- 실제 codex exec 검수의 P1 두 건·P2 한 건을 소스로 확인해 수정했다: path-derived projectKey로 guard 우회, non-Git selected/canonical authority 불일치, 관측 로그의 사용자 task/요청/승인 정보 보존 누락. 제한된 독립 읽기 전용 재검수는3/3 FIXED 및 잔여 P0-P2 없음; guard 동작 검증으로 세지 않는다.
- M-0015-A는 고정 호환 guard부터 구현하도록 P-0021 / T-0180를 등록했다. 실제 migration/activation은 별도 승인과 admission/maintenance 계약이 필요하며 현재 legacy 경로와 제품 코드는 그대로다. 새 출하·M-0015 전체 완료로 표시하지 않는다.
- 최종 문서 계약11/11과 verify/check/lazy/encoding/secrets 검사를 통과했다. R-0001은 실제 Codex 검수 및 지적 확인·수정으로 이행했고 R-0002 새 출하는 승인 경계에서 pending이다. T-0179 설계만 마감하며 P-0021 구현 승인을 요청한다.
- 마감 후 CI 재조회에서 v1.36.186의 main push 재실행33964861084/job101303078325가 Windows Node24 selftest1/355 실패임을 확인했다. 실패 assertion은 UR-0113 encoding-check apply 안전계약이다. 원인·로컬 재현은 미확인으로 T-0181 planned에 등록했다. 이전 고정 CI33959679140 13/13 성공은 역사적 증거로 보존하며 새 실패를 감추거나 완료로 표시하지 않는다.

## 2026-09-05 session-close
- Generated session-handoff.md and refreshed current-state.md.

## 2026-09-06 — P-0021 / UR-0100 compatibility implementation

- 승인된 A 범위의 strict descriptor reader, bounded read-only diagnosis와 공유 writer operation을 구현했다. CLI startup/실제 root, MCP/REPL, direct module/FD, lock wait/heartbeat, Windows replacement/Git writer 경계를 연결했다. legacy 저장 위치와 원문은 유지하며 실제 migration·activation은 없다.
- 실제 Codex 검수4건과 추가 detach 보조 이름1건을 재현·수정하고 제한된 독립 재검토를 마쳤다. Git/ownership snapshot 재사용으로 반복 I/O를 줄였으며 fresh compatibility 검사를 캐시하지 않는다. 전용/실제병렬/설치형/구버전 negative 증거는 review-evidence.md에 보존한다.
- 전체 npmtest는 초기 runtime 검사 후 마지막 command 회귀에서 archive-only workspace 오인1건을 발견해 중단했다. 진단으로 workspace_ambiguous를 재현하고 네 가지 실제 memory archive 이름만 추가했다. assertions를 낮추지 않았으며 final runtime/commands/full E2E를 다시 검증한다.
- T-0181의 별도 재현 가능한 selftest 진단 유실·exitCode 누출을 수정했다. 원 Windows Node24 CI errno는 여전히 미확정으로 유지하고 새 CI에서 확인한다.
- 후보1.36.187의 버전/CHANGELOG와 사이트 데이터·711페이지 build를 준비했다. 아직 GitHub/npm/site 공개 배포 완료 아님; 검증 전 T-0180을 done으로 바꾸지 않는다.
- 고정 후보2f4ce37의 CI33982239269는4/13 성공,9/13 실패로 종료했다. Linux encoding probe의 플랫폼 가정과 Windows REPL fixture 경로 정규화 차이를 분리 재현했다. Windows22 selftest 로그는 이제 실제 powershell ETIMEDOUT를 보존한다. 이전186 실패의 원인은 소급 확정하지 않는다.
- 최소 설치 preview add→mockup→revise와 direct builder→cleanup의 정상 경로 회귀를 새 검사로151/154 재현하고 정확한 previews 디렉터리만 인정하도록 수정해154/154를 확인했다. 링크/잘못된 형상/유사 이름/외부 sibling은 거부한다. 기존 linked-output domain 검사는 초기화 대조군으로 보존하고 standalone CLI/direct writer의 선행 거부 검사를 추가했다.
- Git 자체를 사용할 수 없는 저장소의 health/handoff/session-close는 이제 기록 전 admission 오류다. 기존 history-only fault 주입의 null/error 집계 검사는 그대로 유지하면서 실제 Git 부재 검사는 오류 및 tree bytes 불변으로 구분한다. full commands 재검증 전 통과로 표시하지 않는다.
- 두 번째d3eaf15 CI33983778451의 fast 두 OS 실패를 확인해 full gate를 취소했다. 실제 copy 중 늦은 writer admission은 read-only lock join으로, Windows20.20.2 namespaced rollback 중복 admission은 canonical identity 공유로 수정했다. 실제 원본 재현과 수정본 네 runtime migration72/72·alias24/24를 보존하며 상세 내용은 review-evidence.md에 기록했다.
- 추가 admission21/21·Git108/108 네 runtime, actual Codex delta CLEAN을 확인했다. 신규 probe는 기본 runtime suite에 연결했다. 장시간 중간 E2E의 T-0090 temp cleanup 실패는 별도 격리 재현 중으로 남긴다. 다음 고정 후보 CI나 공개 출하 성공으로 표시하지 않는다.
- 중간 full E2E는463/467로 종료했다. T-0090은 정상 종료한 selftest/doctor의 실제 Windows native cleanup 오류로 분리 재현했으며, 내장 rm retry 옵션만 추가한 시도도352/355로 실패했다. 해당 세 종류 소유 fixture에만 monotonic2.5초/최대100ms JS 대기·exact identity·최종 오류 전파를 적용했다. 초기 실제 cleanup9/9와 추가 오류/교체대조군3/3은18/26에서 각각 통과, selftest355/355 확인 후 NTFS identity 정밀도를 bigint로 보강했다. 최종 고정 검증은 별도로 진행한다.
- ef41542 후보를 release 브랜치에만 게시했다. bigint 고정후 cleanup9/9 두runtime, T-0090 전체+warning2/2, E2E133/134 두블록2/2 및 core exit0를 확인했다. 실제pack 설치355/355·구버전대조3/3과 사이트711페이지 build도 통과했다. CI33988718549 Ubuntu fast는 dangling-ledger 구 기대1건으로79/80; 제품 guard는 유지하며 fixture 보강 중이고 다른 전체E2E 작업은 결과 수집을 계속한다. 출하·T-0180 완료로 표시하지 않는다.
- Windows fast도 동일 dangling fixture79/80임을 실제 로그로 확인했다. 해당블록만 file-first/Windows권한한정junction fallback으로 바꾸고 standalone refusal 및 initialized domain 거부의 전체tree 불변을 각각 유지했다. 네runtime8/8·Node20 full80/80·actual Codex static CLEAN; 제품은ef41542와 동일하다. 테스트만 수정한 후속 후보 CI 및 새pack 검증을 진행한다.
- 후속e8037bc fast두OS/runtime4는통과했으나 Linux전체E2E466/467에서기존api-skill출력후다음호출차단을발견했다. 원본E2E0/1및추가reader158/160으로재현하고 정확한producer directory9개/추가file20개를분류했다. 원본E2E수정없이20/26각2/2+관측11/11을확인했으며 임의이름/link/wrong-kind및unsupporteddescriptor는계속거부한다.
- 빠른실제CLI반복회귀에서기존glossary상수import누락을발견했다. initialized대조와186소스에서도확인했고 두export의import만추가했다. 동일reader304/305→305/305(18/26), actualCodexstaticCLEAN, commands202/202및40/40통과. 작업계획에producer등록과초기반복실행회귀동반관리를명시했다. 최종core/고정CI/새pack/공개출하는미완료로남긴다.
