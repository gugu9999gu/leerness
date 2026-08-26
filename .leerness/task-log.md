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
