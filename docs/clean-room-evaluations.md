# Clean-room evaluations / 클린룸 평가 기록

> **What this is, honestly.** These are **AI clean-room evaluations** — independent agents installing the
> published npm package into fresh temp directories and exercising it from behavior only (no access to the
> source tree), including adversarial attempts to defeat leerness's own verifier. They are **not**
> third-party human security audits or peer-reviewed benchmarks. We publish them so the README claim
> "verified by independent clean-room evaluations" is checkable rather than a marketing line.
>
> 정직하게 말하면: 아래는 **AI 클린룸 평가**입니다 — 독립 에이전트가 게시된 npm 패키지를 빈 임시 폴더에
> 설치해 **소스 접근 없이 행위만으로** 검증하고, leerness 검증기 자체를 무력화하려는 적대 시도까지 포함합니다.
> 제3자 인간 보안 감사나 동료심사 벤치마크가 **아닙니다**. README 의 "독립 클린룸 평가로 검증" 주장을
> 확인 가능하게 만들기 위해 공개합니다.

## Methodology / 방법론

Every evaluation follows the same shape:

```bash
W=$(mktemp -d); cd "$W"; npm init -y
npm i leerness@<version>            # the PUBLISHED package, not the working tree
LB="node node_modules/leerness/bin/leerness.js"
# ... drive the CLI by behavior, assert on exit codes + output, clean up ...
```

- **Published-artifact only** — installs from npm, never reads the repo source. This is what an external user gets.
- **Behavior-asserted** — checks process exit codes and stdout/stderr, not internal state.
- **Adversarial** — a portion of every pass actively tries to make a *false* "done" claim pass verification
  (comment-only stubs, empty-export shells, `assert(true)` fake tests, inflated test counts, language tricks).
- **Both directions (맹신 X / "trust nothing")** — confirmed real defects AND rejected false alarms; a finding
  counts only if reproduced on the published package.

## Evaluations run / 수행한 평가

| # | Round | Scope | Outcome |
|---|---|---|---|
| 1 | Universal-harness field study (5-axis) | Real Python / Node / Rust development, agent-swap handoff, adversarial attack on the verifier | Verdict "conditionally yes"; found 5 gaps (2×P1, 3×P2) — all closed in 1.17.2–1.17.6, shipped as the 1.18.0 stable minor |
| 2 | 1.18.0 re-verification (published) | Independently re-ran the 5 gaps against the **published** 1.18.0 | 4 closed; surfaced a new P1 (Windows `--test-cmd python` blocked → false FAIL) → fixed in 1.18.1 |
| 3 | 1.18.2 adversarial stub workflow | Bypass-hunters + false-positive-hunters vs the empty-shell stub detector | 9 one-keyword bypasses found (Object.freeze, async fn, inline comment, …) and closed; **0 false positives** across ~45 legitimate patterns |
| 4 | 1.19.0 published-artifact re-verification | Installed `leerness@1.19.0` from npm; smoke-tested headline fixes | `--test-cmd python`, empty-shell rejection, `lens`, selftest 231 — all pass on the published package |

## What these evaluations do NOT establish / 한계 (정직)

leerness's verification is **heuristic, not semantic**. These evaluations show it reliably catches *obvious
false-done claims* (missing files, empty shells, fake/unlinked tests, inflated counts) without false-failing
honest work. They do **not** prove:

- the implementation satisfies the actual requirement, or business logic is correct;
- tests are sufficient or well-designed;
- absence of security vulnerabilities or production-runtime correctness.

Known heuristic gaps tracked for an AST/token-based redesign: multi-arg call-expression empty objects
(`Object.assign({}, {})`), Python `def …: pass` / `...` / `raise NotImplementedError`, multi-language empty
bodies. **Code coverage / mutation testing and third-party reproduction remain open** (the e2e is a
spawn-based runner, which standard coverage tools do not instrument cleanly).

## Reproduce it yourself / 직접 재현

```bash
W=$(mktemp -d); cd "$W"; npm init -y && npm i leerness@latest
LB="node node_modules/leerness/bin/leerness.js"
$LB init "$W" --yes
# fake "done": claim an implementation that does not exist
$LB task add "Implement X"
$LB task update T-0001 --status done --evidence "x.js done, 5 tests passed"
$LB verify-claim T-0001     # exit 1 — claim rejected (x.js missing, no tests ran)
$LB selftest                # core-function integrity self-check
```
