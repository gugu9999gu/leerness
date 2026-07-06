# Clean-room evaluations / 클린룸 평가 기록

> **What this is, honestly.** These are **AI evaluations run by the project itself** — an agent installs the
> published npm package into fresh temp directories and exercises it from behavior only (no access to the
> source tree), including adversarial attempts to defeat leerness's own verifier. They are **self-administered**
> (the maintainer's AI, sometimes cross-checked by a second model such as Codex), **not** third-party human
> security audits or peer-reviewed benchmarks, and **not** independent in the "unaffiliated reviewer" sense.
> We publish them so the README claim "checkable by clean-room evaluation" is verifiable rather than a
> marketing line — you can re-run the recipe below yourself.
>
> 정직하게 말하면: 아래는 **프로젝트가 직접 수행한 AI 평가**입니다 — 에이전트가 게시된 npm 패키지를 빈 임시
> 폴더에 설치해 **소스 접근 없이 행위만으로** 검증하고, leerness 검증기 자체를 무력화하려는 적대 시도까지
> 포함합니다. 이는 **자기-수행**(메인테이너의 AI, 때때로 Codex 같은 2차 모델이 교차검증)이며, 제3자 인간 보안
> 감사·동료심사 벤치마크가 **아니고**, "무관한 외부 리뷰어"라는 의미의 독립도 **아닙니다**. README 의 "클린룸
> 평가로 확인 가능" 주장을 검증 가능하게 만들기 위해 공개하며, 아래 레시피로 직접 재현할 수 있습니다.

## Methodology / 방법론

Most evaluations follow this general shape:

```bash
W=$(mktemp -d); cd "$W"; npm init -y
npm i leerness@<version>            # the PUBLISHED package, not the working tree
LB="node node_modules/leerness/bin/leerness.js"
# ... drive the CLI by behavior, assert on exit codes + output, clean up ...
```

- **Published-artifact only** — installs from npm, never reads the repo source. This is what an external user gets.
- **Behavior-asserted** — checks process exit codes and stdout/stderr, not internal state.
- **Adversarial (both directions)** — many passes include attempts to make a *false* "done" claim pass
  verification (comment-only stubs, empty-export shells, `assert(true)` fake tests, inflated test counts) **and**
  to make an *honest* claim wrongly fail (false-positive hunting). A finding counts only if reproduced on the
  published package; agent-proposed findings are re-derived, not trusted (맹신 X / "trust nothing").

## Agent clean-room evaluations / 에이전트 클린룸 평가 (behavior-only, published artifact)

| # | Round | Scope | Outcome |
|---|---|---|---|
| 1 | Universal-harness field study (5-axis) | Python / Node / Rust development exercises, agent-swap handoff, adversarial attack on the verifier | Verdict "conditionally yes"; found 5 gaps (2×P1, 3×P2) — all closed in 1.17.2–1.17.6, shipped as the 1.18.0 stable minor |
| 2 | 1.18.0 re-verification (published) | Separately re-ran the 5 gaps against the **published** 1.18.0 | 4 closed; surfaced a new P1 (Windows `--test-cmd python` blocked → false FAIL) → fixed in 1.18.1 |
| 3 | 1.18.2 adversarial stub workflow | Bypass-hunters + false-positive-hunters vs the empty-shell stub detector | 9 one-keyword bypasses found (Object.freeze, async fn, inline comment, …) and closed; **0 false positives** across ~45 legitimate patterns |
| 4 | 1.19.0 published-artifact re-verification | Installed `leerness@1.19.0` from npm; smoke-tested headline fixes | `--test-cmd python`, empty-shell rejection, `lens`, selftest — all pass on the published package |

Maintainer-run multi-model reviews (external models — GPT-class + Claude — driven against a published build and
reproduced before fixing) have also shaped many rounds; the confirmed findings are tracked in CHANGELOG under
the "Nth 외부평가 / 외부리뷰" entries. "External" here means the *models*, not unaffiliated human reviewers.

## Maintainer adversarial hunts / 메인테이너 자체 적대적 헌트 (self-administered, published artifact)

These are the **least independent** kind — the maintainer's AI hunting its own flagship surfaces, cross-checked
with Codex where noted. They are listed for transparency, not as third-party validation. Every finding was
reproduced on the published package; every fix re-verified after publish.

| Version | Surface | Method | Outcome (honest) |
|---|---|---|---|
| 1.35.9 | `verify-claim` declared-pass gate | 12-probe FP/FN matrix (single / `--json` / `--all` / `gate --claims` × reporter/growth/lenient) | 1 real false-positive found (a non-test `N/M passing` ratio wrongly gated) and fixed; 0 bypasses |
| 1.35.10 | `gate` (the CI guardrail) | 8-probe matrix (clean/placeholder/secret/false-done/missing-file) | **0 product bugs**; 2 probe-flagged "FN"s were probe artifacts, refuted by reproduction; added a gate-level security regression guard |
| 1.35.11 | `contract verify` (spec ↔ impl) | Claude probes + a separate Codex (gpt-5.5) review, cross-checked | Codex raised 9 candidates → **3 confirmed & fixed** (`$`-field regex FP, bracket-export FP, code-fence-example FP), **1 refuted as a hallucination**, the rest documented heuristic limits |

The pattern worth noting: two of the three surfaces had **0 product bugs found in these probes** only after a
dedicated false-positive hunt, and in each round a portion of the AI-proposed findings did **not** reproduce and
were dropped. That is the point of publishing this — the checks are fallible, the probe matrices are finite, and
the checks are themselves under adversarial test, including their own false-alarm behavior.

## What these evaluations do NOT establish / 한계 (정직)

leerness's verification is **heuristic, not semantic**. These evaluations suggest it catches many *obvious
false-done claims* (missing files, empty shells, fake/unlinked tests, inflated counts), with no false failures
in the tested cases — though the false-positive hunts have themselves found and fixed a real false-positive
(1.35.9), so "no false failures" is a property under test, not a guarantee. They do **not** prove:

- the implementation satisfies the actual requirement, or business logic is correct;
- tests are sufficient or well-designed;
- absence of security vulnerabilities or production-runtime correctness.

Known heuristic gaps tracked for an AST/token-based redesign (UR-0016): multi-arg call-expression empty objects
(`Object.assign({}, {})`), Python `def …: pass` / `...` / `raise NotImplementedError`, multi-language empty
bodies; and for `contract verify` (UR-0018) a field/function present only in a **comment or string** still
passes the grep-presence check, and a function exported as a **non-function value** passes (contract checks
*presence*; `verify-claim` checks *substance* — a deliberate split). `scan secrets` is a convenience guard, not
a replacement for a dedicated scanner (gitleaks/trufflehog). **Code coverage / mutation testing and third-party
reproduction remain open** (the e2e is a spawn-based runner, which standard coverage tools do not instrument
cleanly).

## Reproduce it yourself / 직접 재현

```bash
W=$(mktemp -d); cd "$W"; npm init -y && npm i leerness@latest
LB="node node_modules/leerness/bin/leerness.js"
$LB init "$W" --yes
# fake "done": claim an implementation that does not exist
$LB task add "Implement X"
$LB task update T-0001 --status done --evidence "x.js done, 5 tests passed"
$LB verify-claim T-0001     # exit 1 — claim rejected (x.js missing, no tests ran)
$LB selftest                # core-function integrity self-check (exit 0 when the install is intact)
```
