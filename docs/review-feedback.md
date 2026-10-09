# Actionable feedback and bounded re-review

When a reviewer is assigned, start one feedback contract for the task before its
first review. Generated AGENTS.md, the project review checklist, reviewer role
prompt, persona review prompts and role dispatch/fallback commands include this
protocol. Because Leerness serves several agents, AGENTS.md holds the one full copy
in generated instructions, in standard and minimal mode. CLAUDE.md imports it with
an `@AGENTS.md` line, which Claude Code expands at launch, and the Cursor rule, the
Copilot instructions and the session workflow point to it. It is model-neutral: provider/model are configured labels,
not a ranking or a claim to authenticate Astra, Opus or another backend.

The reviewer explains the problem, evidence, why it prevents acceptance, the
required final state, and observable pass criteria. The worker chooses how to
implement it. `implementationHint` is optional and cannot change those criteria.
An optional `mandatoryConstraint` needs a `security`, `data-loss`, `api-contract`
or `standard` reason, a requirement and evidence; it is frozen with its finding.

## NO GO must explain the route to GO

The reviewer's **final response itself** must include a `TO_GO` section for NO GO,
even when reviewing without the CLI. A verdict alone or a pointer to another log
does not fulfill the response contract. Write it as a numbered checklist in fix
order. For each unresolved blocker, state its ID, affected file/component/behavior,
evidence and how to reproduce it, why it fails, the changed behavior required, and
each observable check with how it will be verified and the evidence needed for
re-review. End with the fixed criteria and regression check still pending, the
reviews left and the next steps. State the required result first; implementation
hints remain optional.

For example: “NO GO — user requests can run without a valid user ID. Change the
behavior so absent IDs send no request. GO checks: null/undefined IDs send zero
requests, valid IDs retain their behavior, and the related tests pass with no
authentication regression.” Link the issue and checks to their original IDs and
source evidence; do not create new preferences during re-review.

Human reports group unresolved corrections under `TO_GO`, retained fixed checks
under `FIXED_CRITERIA`, and missing owner actions under `DECISION_REQUIRED`.
Non-blocking suggestions, scope risks and resolved issues have separate sections;
each finding is rendered once. An unrun check requests actual verification, not a
fabricated code correction. A stopped review still requires an owner decision and
cannot accept another round or restart under a new ID to evade its budget.

The public result adds `decision` (`GO`, `NO GO` or `NOT_REVIEWED`) and a derived
`goRequirements` index: unresolved `issueIds`, pending `criterionIds`, whether the
regression check is required, decision issue IDs and stop-reason actions. Outcomes
and evidence remain in the original findings, fixed criteria and recorded checks;
the index does not duplicate or redefine them. `automaticRevisionAllowed` is true
only for an ordinary FAIL, never NEEDS_DECISION. The fields are derived on read,
not another stored authority. Existing history and v1 input remain compatible:
structured verdicts are still `PASS`, `FAIL`, `NEEDS_DECISION`, **not** `GO`/`NO GO`.
GO is a declared review result, not deployment permission or an automatic promise
that performing the listed actions will pass the next review.

## The GO route

Human output of `start`, `submit` and `show` is written in the project language
(`--language ko|en`, then `LEERNESS_LANG`, then the project manifest, then
Korean). Section markers such as `[ISSUE]`, status values and the JSON text stay
the same in every language. The report begins with a `[GO_ROUTE]` block:

- the current stage and reviewer, the rounds used and the reviews left;
- each open blocker with its required outcome and every acceptance check, marked
  `[x]` when its latest recheck passed or `[ ]` with its latest status (failed,
  unverified, not rechecked yet) and evidence, plus any mandatory constraint and
  optional hint;
- the fixed criteria and the regression check with their latest results;
- when the review stopped, the owner decisions it needs instead of next steps;
- otherwise the ordered next steps with their commands: change the implementation,
  record the attempt (`agents record completed ... --id`), request the re-review
  (stage, reviewer, `expectedRound`, a new session for a staged review), record
  the review (`agents record reviewed ... --feedback-round`), then later stages.

JSON adds the same data as `result.goRoute` (`decision`, `status`, `stage`,
`passedStages`, `laterStages`, `reviewer`, `budget`, `blockers` with their
`checks`, `criteria`, `regression`, `decisions`, `steps`) and
`result.nextRoundTemplate`: a skeleton of the next round with the frozen IDs,
contract digest, expected round, stage, and every resolution and check the round
must cover. Its `<…>` placeholders and empty evidence lists are invalid on
purpose, so an unfilled skeleton is rejected instead of being recorded as a
review. It is `null` after GO or a stop. Both fields are derived on read like
`goRequirements`; nothing extra is stored.

## Staged reviewers

To assign several reviewers, for example a first and a final reviewer, start a v2
contract with ordered `stages` instead of `reviewer` and `maxRounds`:

```json
{
  "schema": "leerness.review-feedback-contract/v2",
  "reviewId": "review-user-api",
  "taskId": "T-42",
  "scope": "User API request eligibility; retain the existing normal-ID behavior.",
  "criteria": [
    { "id": "valid-user", "outcome": "Only valid user IDs cause an API request; normal IDs retain existing behavior." }
  ],
  "stages": [
    { "id": "first", "label": "First review", "reviewer": { "provider": "codex", "model": "your-review-model" }, "maxRounds": 3 },
    { "id": "final", "label": "Final review", "reviewer": { "provider": "codex", "model": "your-review-model" }, "maxRounds": 2 }
  ]
}
```

- One to five stages, each with a unique ID, a label of up to 80 characters, a
  reviewer and `maxRounds` (1..10, default 3). They are frozen with the shared
  scope and criteria.
- Stages review in order. The current stage is the first one that has not
  passed; a round for another stage is rejected (`feedback_stage_not_current`,
  `feedback_stage_unknown`). A stage that gives NO GO re-reviews the revision
  itself while later stages wait. When it passes, the next stage starts, and its
  route points to the attempt the previous stage passed; a change made after a
  stage passed is reviewed only by the later stages. The review is GO only after
  the last stage passed.
- Each stage applies the v1 rules to its own rounds: its own budget and
  `expectedRound` (rounds already stored for that stage), new blockers only in its
  first round, regressions bound to its previous round, and the same stop reasons.
  A stop in any stage stops the review. Round and issue IDs are unique across the
  review; issues keep their `stageId`.
- A v2 round (`leerness.review-feedback-round/v2`) adds `stageId` and
  `reviewerSession`. The same model may serve several stages, but each stage
  reviews in its own new session: a session another stage used is rejected
  (`feedback_session_reused`), and so is the session that recorded the reviewed
  implementation attempt (`feedback_session_not_independent`, compared with the
  attempt's recorded `sessionId`). Sessions are declared strings, not
  authenticated identities.
- `agents record reviewed --feedback-round ID` binds the latest round of that
  round's stage, so a stage can record its review after the next stage started.

Generated project instructions, role prompts and review/dispatch prompts carry
this response rule after explicit install/update. Older installed projects do not
receive it just because the development repository changed. Free-form model
adherence is guidance; structural enforcement applies to an activated feedback
contract and does not authenticate the meaning or truth of supplied evidence.

## Commands and storage

```text
leerness review-feedback start --stdin --path PROJECT --json
leerness review-feedback submit --stdin --path PROJECT --json
leerness review-feedback submit --file ROUND.json --path PROJECT --json
leerness review-feedback show REVIEW-ID --path PROJECT --json
leerness review-feedback show REVIEW-ID --path PROJECT --language ko
```

Pipe a UTF-8 JSON document into start/submit, or name a file with `--file` (relative
to the current directory; for shells without `<` redirection, such as PowerShell).
`--file` accepts a regular file only and never reads more than the limit, even from a
file that grows while it is read.
Input is limited to 65,536 bytes (and five seconds on stdin); a byte-order mark,
invalid UTF-8, duplicate JSON keys, unknown fields, oversized or
malformed values fail before append. Output without `--json` presents
`VERDICT`, `GO_ROUTE`, `ISSUE`, `EVIDENCE`, `WHY_IT_FAILS`, `REQUIRED_OUTCOME`,
`ACCEPTANCE_CRITERIA`, optional constraints/hints and the latest recheck evidence.
`show` is read-only. Start/submit append to the existing execution ledger under
its canonical lock; no second task database, model invocation or login is needed.
The library equivalents are `start(root, contract)`, `submit(root, round)` and
`show(root, reviewId)` from `leerness/lib/review-feedback`.

Successful recording is distinct from a passing review: CLI exit 0 means open/PASS,
1 means a valid recorded FAIL/NEEDS_DECISION, and 2 means rejected input/operation.
JSON `ok: true` means the operation succeeded; consumers must inspect
`result.status`. `approvalGranted` is always false. Never use storage success as
permission to release.

## Frozen contract

```json
{
  "schema": "leerness.review-feedback-contract/v1",
  "reviewId": "review-user-api",
  "taskId": "T-42",
  "reviewer": { "provider": "codex", "model": "your-review-model" },
  "scope": "User API request eligibility; retain the existing normal-ID behavior.",
  "criteria": [
    { "id": "valid-user", "outcome": "Only valid user IDs cause an API request; normal IDs retain existing behavior." }
  ],
  "maxRounds": 3
}
```

`maxRounds` defaults to 3 and accepts 1..10. There is no measured claim that three
is optimal. The entire contract, including reviewer, scope and budget, is frozen;
`start` returns `contractDigest` for subsequent rounds. One contract per task:
another review ID cannot reset the budget. Exact repeated start/submit operations
are idempotent; conflicting payloads fail. Keep the review ID across sessions.

## Round format

A round contains:

- `schema`: `leerness.review-feedback-round/v1`;
- `reviewId`, unique `roundId`, `expectedRound` (number of already stored rounds),
  and the returned `contractDigest`;
- `reviewer`: the same provider/model labels;
- `implementationAttemptId`: one recorded, executed implementation attempt from
  this task; record implementation evidence using the existing `agents record`
  flow first;
- `sourceRevision`: a `sha256:` digest of the exact reviewed source. This is a
  caller declaration; the protocol does not calculate or verify its contents;
- `verdict`: `PASS`, `FAIL` or `NEEDS_DECISION`, consistent with the fixed checks;
- `findings`: new findings only, max 32 across the review;
- `resolutions`: all previously reported blockers, including resolved ones;
- `criteriaResults`: exactly one `{criterionId, status, evidence}` for each frozen
  contract criterion. Status is `passed`, `failed` or `unverified`;
- `regressionCheck`: `{status, evidence}`, with the same three status values.

Evidence arrays contain 1..8 nonempty references or concise observations, never
credentials or complete private logs. Unknown/unrun checks use `unverified` and
an explicit explanation; they cannot produce PASS. A failed contract criterion
must have a matching open issue or serious-risk escalation, not just `FAIL`.

Example of a finding (inside `findings`):

```json
{
  "id": "I-1",
  "severity": "high",
  "classification": "blocking",
  "criterionId": "valid-user",
  "issue": "The request runs when userId is absent.",
  "evidence": ["src/api/user.ts:82; test:no-user-id fails"],
  "whyItFails": "A request can access the wrong user's data or fail authentication.",
  "requiredOutcome": "Only a valid userId permits the request.",
  "acceptanceCriteria": [
    { "id": "absent-id", "outcome": "null/undefined IDs cause zero API calls." },
    { "id": "valid-id", "outcome": "Normal IDs retain existing behavior." }
  ],
  "implementationHint": "Consider a guard or separated call condition; the worker chooses."
}
```

Severity is `low`, `medium`, `high` or `critical`. Blocking findings must refer to
an original contract criterion. Nonblocking findings can use `criterionId: null`.
Finding outcomes and acceptance criteria cannot be replaced on later rounds.
Each resolution is `{issueId, status, evidence, checks}`; status is `resolved`,
`unresolved` or `disputed`. Its `checks` cover every original finding criterion
using `{criterionId, status, evidence}`. Only all-passed checks can mark an issue
resolved. Resolved issues retain that result; a later real regression gets a new
ID and its own evidence.

## Preventing moving criteria and endless revisions

After the first round, ordinary new `blocking` findings are rejected. New style,
preference or unrelated requests belong to `non-blocking` and cannot prevent PASS.
A `regression` needs `regression: {previousRevision, currentRevision,
beforeEvidence, afterEvidence}` tied to the immediately preceding and current
source digests. A newly discovered serious existing risk is `risk-escalation`
(high/critical), which stops for a scope decision instead of disappearing as a
suggestion or silently becoming another automatic revision.

PASS requires all fixed criteria and the regression check to pass with no open
blockers. Disputes, serious risks, exhausted round budget, unchanged source with
unresolved work, or a repeated unresolved blocker set produce NEEDS_DECISION.
The repeated-set rule deliberately stops even when partial implementation effort
occurred: evidence of effort is not evidence that a blocker was resolved.
Stop automatic revision/review calls and show the remaining issues and evidence.
There is no force-PASS, automatic restart, baseline-amend or budget-reset command.
Human decisions and any later scope change must be recorded explicitly outside
this v1 protocol; it does not itself authorize a new task or approve deployment.

After activation, `agents record reviewed` also requires `--feedback-round ID`
matching the latest round (in a staged review, the latest round of its stage),
implementation target and reviewer. MCP's existing
`leerness_agents_record` accepts `feedbackRoundId`. Its terminal event means the
review was performed, not that FAIL was converted to PASS. Historical unstructured
records remain readable and tasks without a started contract retain legacy
behavior; they do not acquire the guarantees of this protocol. Tools that ignore
the generated instructions and never start a contract are not universally policed.

## Limits and validation

The ledger is local runtime history, not tamper-proof Git retention. Deleting or
editing it outside Leerness is not prevented by an advisory harness. Missing,
malformed or truncated history is rejected. The protocol validates data, bindings
and stopping rules; it cannot prove evidence truth, semantic relevance, reviewer
identity or independence from supplied strings. Existing verification, identity,
independence and release checks still apply. No production deployment or
independent external model review is implied by a deterministic test result.

Run `npm run test:review-feedback` for isolated real CLI, ledger, concurrent-write,
re-review and refusal cases. Generated instructions apply on installation or
migration to this version; existing unrelated projects are not edited remotely.
