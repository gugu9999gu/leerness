# Verification evidence: what a passing check means

This guide describes the existing single-task `verify-claim --json` contract. It does not introduce a new verifier or change exit codes. 한국어 요약은 아래에 있습니다.

## Read the result, not just the label

| Field | Meaning | Not a guarantee of |
| --- | --- | --- |
| `ok`, `reasons` | Overall result of the applicable claim checks | Correct requirements, complete coverage, production readiness |
| `semanticVerified: false` | Semantic correctness is not established by this verifier | A hidden semantic review having passed |
| `evidenceLevel: "static"` | No non-skipped test-run result was collected | Tests passing; absence of every other kind of execution |
| `evidenceLevel: "executed"` | A non-skipped test-run result was collected, including failed runs | A successful run |
| `run.skipped` | The selected test execution was skipped; inspect `reason` | A test failure or success |
| `run.allPassed` | Exit status was zero and, if parsed, the reporter's passed/total counts agree | Meaningful tests, sufficient coverage, or any particular number when `parsed` is null |
| `verdict.testCountMatch: null` | No applicable count comparison was made | A passing count comparison |

Without `--run-tests`, `run` is absent. With it, command selection is `--test-cmd`, then `.leerness/leerness-config.json`'s `testCommand`, then an available non-placeholder `npm test`, otherwise skip. A blocked command also skips. A skipped run stays `static` and does not itself add `tests-failed`; other checks can still fail.

An executed failure stays `executed` and contributes `tests-failed`. An exit-zero command with output the parser cannot recognize can have `parsed: null` and `allPassed: true`. Report that as successful command execution with unknown parsed test count, not “all requirements tested.” Only run commands from a workspace you trust: `--run-tests` executes project code.

These two boundary fields are present in the single-task JSON result, not promised for each `--all` aggregate entry. Static source checks count recognized declaration patterns; they do not run tests or establish coverage. Git checks compare working changes, not a reviewer's approval of a particular commit.

## A small executable example

Use a disposable directory outside your real project, initialize it with `leerness init . --minimal --yes`, and create these two files. The example assumes Node.js and an installed `leerness` CLI.

`sum.cjs`:

```js
module.exports = (a, b) => a + b;
```

`sum.test.cjs`:

```js
const assert = require('node:assert/strict');
const sum = require('./sum.cjs');
assert.equal(sum(2, 3), 5);
console.log('1/1 passed');
```

Register a task and substitute its actual printed ID for `T-0001` below. Record only what you actually ran; the first check deliberately makes no passing-test claim.

```sh
leerness task add "Implement integer addition"
leerness task update T-0001 --status done --evidence "Files: sum.cjs, sum.test.cjs"
leerness verify-claim T-0001 --json
leerness verify-claim T-0001 --run-tests --test-cmd "node sum.test.cjs" --json
```

The first result is `static`, with no `run`. The second is `executed`; for the supplied assertion, expect `run.exitCode: 0`, `run.allPassed: true`, and parsed count 1/1. Both retain `semanticVerified: false`. These are expected observations in the isolated example, not universal pass promises for an existing project's other evidence checks.

Now change the expected value from `5` to `6` in the disposable test and rerun the second command. The assertion fails: expect a nonzero CLI exit, `ok: false`, `executed`, and `tests-failed`. Restore `5` and rerun before recording success. Do not use a command that merely prints a pass count as proof of test quality.

## Keep an auditable handoff

Alongside the claim, record the project/worktree and commit tested, exact command, exit status, parsed count or “unavailable,” log location, and known exclusions. Keep failed and skipped attempts distinct from subsequent success. Review should identify the exact commit reviewed. These are reporting practices, not fields automatically guaranteed by every existing command.

For a sibling repository, run its tests there. Do not pretend its paths are relative to the current repository. A local evidence document can reference the external commit and logs, but verifying that document's existence does not rerun or validate the sibling implementation.

## 한국어 요약

- `ok`는 적용된 검사 결과이고 `executed`는 실행 여부의 분류입니다. 실패도 `executed`입니다.
- 미실행은 `run.skipped`와 사유를 확인합니다. `null`은 미측정/비적용이지 통과가 아닙니다.
- 종료 코드가 0이어도 `parsed: null`이면 테스트 개수는 미확인입니다. 요구사항 충족이나 테스트 품질을 증명하지 않습니다.
- 위 예제는 실제 assertion 성공/실패를 비교합니다. 정적 검사와 실행 결과를 섞지 말고 명령·종료 코드·검증한 commit·미검증 범위를 함께 기록합니다.
- `semanticVerified`는 계속 `false`이며, 이 가이드는 현재 계약을 설명할 뿐 새 의미론 검증이나 migration 활성화를 구현하지 않습니다.
