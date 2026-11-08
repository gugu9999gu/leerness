# Task Scope Lock and hybrid review: opt-in operating contract

**Development status: candidate, 2026-11-06.** This contract adds a small pure
assessor and independent review-packet generator. It is NOT a new mandatory
model review, task database, job scheduler, reviewer engine, release gate or
provider dispatcher. It reuses the current tracker, review-checkpoint,
review-snapshot and review-feedback v2. Installing or documenting it does not
change a user's existing project state.

## 1. Freeze the task boundary once

At task start, record task ID, an exact Git baseline, the permitted files and
directory prefixes (directory prefixes end with /), excluded paths, acceptance
criterion IDs and observable outcomes, risk, and chosen review mode.
Use the SHA-256 fingerprint returned by the library's scopeDigest(manifest).
Put the manifest and digest in a Git-tracked task-specific packet, not only
in chat context. On subsequent assessments, submit the original fingerprint
as observation.frozenDigest. Only the owner may approve a scope amendment;
record its rationale and a new manifest revision rather than rewriting prior
findings or silently broadening the task.

A changed manifest, a changed file outside the scope or an excluded file
produces scope.state=change-required. It prevents a completion candidate.
Finding a new in-scope critical defect remains blocking, even if creating a
new follow-up task might be convenient. The assessor does not authenticate
the input, Git tree, owner, or evidence and cannot enforce external commits.

## 2. Completion criteria and measured validation cost

Each frozen criterion must have exactly one matching assessment, status passed
and a nonempty evidence reference. An optional frozen requestItems list attaches
original user-request references and expected outcomes; when present, matching
requestResults must be verified with evidence. Missing, deferred or unknown
request IDs block the candidate, not create new tasks or automatic model calls. Each relevant reported test must also be
passed with evidence; unknown, inconclusive, failed and not-run are not PASS.
An opt-in evidence-only disposition is allowed only for explicitly declared
documentation/research work with a frozen reason and observed criterion evidence.
An explicitly supplied failed check still blocks it; code and data-migration work
cannot select this exception.
Open blocking issues prevent a completion candidate. Only explicitly selected
hybrid review requires both stage A and stage B to report PASS. The risk label
alone does not mandate an external reviewer; existing owner/project/CI/release
approval boundaries apply separately. Optional mode does not assert that a
review occurred. A completion candidate does not mark the tracker done,
authenticate a reviewer or grant deployment/release permission. Existing
security, integrity and human approval boundaries remain unchanged.

Each execution record has a unique run ID, source revision, kind, outcome,
durationMs, optional actual costUsd and optional reusedFrom ID. Only fresh
executed runs enter summedExecutionMs and knownCostUsd; reused evidence never
counts as a new run. Missing cost/duration is unknown, not zero. Summing
execution durations is not elapsed wall-clock time when checks overlap.
Never infer spending or token usage from test counts.

## 3. Bottleneck and scope-split review (advisory)

The initial pilot limits are 48 elapsed hours, three checkpoints, two
no-progress checkpoints, two repeated failures, three review rounds, or
1,800,000 ms of validation execution. These are operational trial thresholds,
not validated optima, new mandatory gates or automatic split instructions.
The returned bottleneck state distinguishes known threshold crossings from
unknown metrics. When triggered, the orchestrator should identify whether
the delay is implementation, review, test, dependency or integration time.
It may propose smaller, dependency-linked tasks, but must keep the original
criteria, original task identity and unresolved blocker records. Re-review
budgets and review IDs must not be reset to hide a loop.

T-0344 is the immediate example: bound the remaining mixed-input/lifecycle
cases; preserve already accepted regressions; put unrelated discovered work
into a separate proposal. No claim of T-0344 completion is implied here.

## 4. Existing review v2: hybrid selection

When review is requested, keep one immutable review-feedback contract v2
with ordered stages and separately named reviewers: stage A (first/new
session; repair rechecks may continue this session) followed by stage B
(new independent session for the final review). Existing round budgets,
stopped-state handling, review IDs and independent-session checks remain.
A two-plus-one review-round allocation is an advisory example for ordinary
selected work, not a hard optimum. High-risk work may warrant a separately
chosen budget and security specialist. The former mandatory Claude/Codex
cross-model rule R-0001, removed on 2026-10-29, is NOT reinstated.

First-review packet: immutable requirements, exact baseline/target commit,
changed files, affected interfaces, test commands and observed results.
Recheck packet: frozen requirements plus unresolved finding IDs,
reproduction, required outcome, previous reviewed revision and regression.
Independent-final packet: the same frozen requirements, current pinned
source, affected context and tests, **without** prior reviewer verdicts,
findings, developer self-evaluation or repair discussion. Do not feed the
independent reviewer "show --brief" before its first cold inspection;
doing so would expose prior conclusions. After it records its own findings,
the coordinator reconciles them against the original issues and criterion
ledger. No known blocker disappears just because the cold reviewer missed it.

Reviewers report PASS/FAIL/INCONCLUSIVE with evidence and missing coverage.
When submitting to the existing feedback ledger, map insufficient-evidence
outcomes to its structured NEEDS_DECISION contract as appropriate. Reviewers
do not edit product or test baseline without explicit authorization. A
declared reviewer session or provider name does not prove a model actually
ran; same-session self-review must never be called independent approval.

## 5. API and developer CLI (explicit opt-in)

Exports are available from lib/task-review-assessment.js:
scopeDigest(manifest), assessTaskReview(input), reviewPacket(input, mode, details).
The standalone developer command uses existing bounded UTF-8 JSON stdin
validation and never writes project state or invokes a model.

    node scripts/task-review-assessment.js assess --stdin < task-assessment.json
    node scripts/task-review-assessment.js packet-initial --stdin < packet.json
    node scripts/task-review-assessment.js packet-recheck --stdin < packet.json
    node scripts/task-review-assessment.js packet-independent --stdin < packet.json
    node --test scripts/task-review-assessment-probe.js

Assessment input uses schema leerness.task-review-assessment-input/v1, with
manifest keys taskId, baselineCommit, scopePaths, excludedPaths, criteria,
reviewMode (optional/hybrid), risk (normal/high/critical). Optional frozen keys:
workKind (code/documentation/research/migration), verificationMode
(tests/evidence-only), verificationReason (mandatory if evidence-only),
requestItems [{id, sourceRef, expected}]. Evidence-only is allowed only for
workKind documentation/research. Observation may include requestResults
[{id, status: verified|unverified|deferred, evidence: []}]. Observation keys
are frozenDigest, headCommit, changedPaths, criteriaResults, checks, review
(stageA/stageB), unresolvedBlockers, metrics and runs. Six metrics are
elapsedHours, checkpoints, noProgress, repeatFailures, reviewRounds and
executedValidationMs; a missing measurement is JSON null, not zero.

For packet commands stdin is a JSON object with exactly two members:
"input" (the entire assessment input) and "details" (an object). Details
may include architectureRefs and testCommands; a recheck requires
previousCommit and openFindings, each finding with id, location,
reproduction and requiredOutcome. Source code bytes are referenced by
the pinned commits; the packet intentionally contains no raw code.

Example (deliberately NOT ready for completion; calculate a real frozen
scope digest, do not use this all-zero placeholder as evidence):

    {
      "schema":"leerness.task-review-assessment-input/v1",
      "manifest":{"taskId":"T-0344",
        "baselineCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "scopePaths":["lib/","scripts/","docs/"],
        "excludedPaths":[],
        "criteria":[{"id":"AC-1","outcome":"An in-flight publication cannot look like a new empty store"}],
        "reviewMode":"hybrid","risk":"high"},
      "observation":{
        "frozenDigest":"sha256:0000000000000000000000000000000000000000000000000000000000000000",
        "headCommit":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "changedPaths":["lib/io.js"],
        "criteriaResults":[{"id":"AC-1","status":"unverified","evidence":[]}],
        "checks":[{"id":"focused","status":"not-run","evidence":[]}],
        "review":{"stageA":"not-run","stageB":"not-run"},
        "unresolvedBlockers":0,
        "metrics":{"elapsedHours":null,"checkpoints":null,"noProgress":null,
          "repeatFailures":null,"reviewRounds":null,"executedValidationMs":null},
        "runs":[]}
    }

Outputs separate scope, completion, bottleneck, validationCost, and effects.
The engine is strictly advisory and records sourceTrust=caller-supplied.
No test execution, persistent scope record, reviewer authentication,
automatic task splitting, CLI product command registration, CI enforcement,
or release approval is implied. Those require separate integration and
acceptance, not a fabricated completion claim.

## 2026-11-07 scope and low-friction policy clarification

The default Leerness workflow is **not** a mandatory sequence of handoff,
preview approval, route, lens, check, lazy detect, review and session close.
The generated instructions are guidance only, except for actual user/project
rules and non-negotiable security/data-integrity/release controls. Do not
run multiple wrappers around the same passing test, or create work simply to
satisfy a tool. Review selected by the owner can use A's same-session rechecks
plus B's fresh independent final stage; avoid imposing it on every task.

See [Lean defaults and native-first migration](lean-defaults-20261107.md).
Existing project files and owner rules are never silently rewritten by this
opt-in source candidate; they need a separate migration and evidence-based
acceptance. A candidate is not automated task closure.
