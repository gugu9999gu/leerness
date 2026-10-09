# Leerness quality system

Leerness already does most of what a quality system does: it checks a request before work starts, checks the result against evidence, records root causes and keeps what was learned. This page maps those commands onto familiar quality terms, states what may block and what only advises, and lists what is not built yet.

## What may block

- `verify-claim` and `gate` exit non-zero on evidence Leerness checks itself: files it found or did not find, tests it ran, the git diff, its own audits.
- Some existing checks are heuristics and block too. In `verify-claim`: a claimed number of tests compared with the test calls it recognizes without running them; on completion claims, optimism and high-severity honesty findings, implementations that are only stubs, and evidence naming no file, test or log (`--lenient` waives these four for one run); with `--strict-claims`, tests that never reference the implementation. In `gate`: `lazy detect`, whose workspace heuristics include a TODO, FIXME or XXX comment in a file no tracker row mentions.
- Other heuristics stay advisory: lenses, the CRUD check, `review-request`'s `proceed`, risk hints, past-fix advice. A heuristic gate that sometimes blocks honest work and often misses real problems is worse than a clear advisory, so new heuristics ship as advice.
- New blocking switches start off (`leerness toggle`). An advisory result never grants approval.
- Leerness is cooperative by default. A required CI check that runs `leerness gate` is what makes it a guardrail.

## The map

| Quality term | What it means here | Leerness |
|---|---|---|
| QA: before the work | requirements, risk and reuse are looked at first | `review-request` (conflicts, reuse with `--ladder`, a CRUD checklist for data features, recommended steps), `clarify`, `brainstorm`, `intent`, `constraints check`, `lens`, `test-plan assess`, `reuse find`, `agents route` (risk tiers) |
| QC: after the work | the result is checked against what was claimed | `verify-claim` (claimed files exist and hold real code, tests run with `--run-tests`/`--test-cmd`, honesty, git diff cross-check), `verify-code` (the project's test, lint and typecheck commands), `honesty-check`, `lazy detect`, `audit`, `contract verify` |
| Quality gate | a pass or fail on evidence | `gate` (verify, audit, secret scan, encoding check, lazy detection; `--claims` adds verify-claim on finished tasks, `--require-referee <id>` runs declared checks), `enforce install` (a pre-commit hook), `ci init`, `drift check` |
| Review | someone other than the author looks | `review-feedback` records named reviewers' findings and verdicts (staged reviewers, PASS / FAIL / NEEDS_DECISION; recorded, not proof that a model ran); `review-checkpoint` and `review-snapshot` prepare and bind what a reviewer looks at and run no review themselves; a project rule can require a reviewer from a different model |
| RCA: root cause | why it broke: the reproduction is established before the fix, the root cause is declared | `route bugfix`, `bugfix start` (the reproduction must fail, twice, before the fix), `bugfix receipt` (the declared root cause and sibling places, not checked by Leerness), and the optional done gate (`toggle set bugfix-receipt on`) |
| CAPA: fix and prevent | the fix, plus what keeps it from coming back | a bugfix receipt keeps its reproduction as a regression probe; `bugfix receipt --areas` names the files a fix is about, and for later tasks whose evidence names those files `verify-claim` shows the finished fixes with their root cause and probe to re-run, and lists unfinished ones apart ([bugfix areas](bugfix-areas.md), advisory); `lesson save`; `rule add` (rules with a trigger, checked at `session close`); skills |
| NCR: non-conformance | expected against actual, recorded | `review-feedback` findings (the issue, evidence, why it fails, the required outcome, severity) |
| Traceability | request to task to files to tests to result | user requests (`requests`) and tasks (`task`) with their evidence, verify-claim's git diff cross-check, the execution ledger, `feature` links and `impact` |
| Policy | which checks a project requires | `.leerness/rules.md`, `leerness toggle`, `enforce`, the referees a gate requires, release and review checklists |
| Metrics | how quality moves over time | `retro`, `insights`, `pulse`, `usage stats` |

A typical round:

```text
request → review-request (QA) → implement → verify-code, verify-claim --run-tests (QC)
       → gate / review-feedback (gate and review) → on a failure: bugfix start, receipt (RCA)
       → lesson save, rule add (CAPA) → handoff brings them back in the next session
```

## Not built yet

These are the gaps that would add the most without repeating what exists:

1. **Acceptance criteria per task**, each with an optional check command, so `verify-claim` reports every criterion as passed or unverified. Criteria exist today in plan `Done-When` text, in `review-checkpoint` input and in `review-feedback` (frozen criteria and each finding's acceptance criteria), but none is tied to a task's verify-claim evidence.
2. **One quality-policy section** in the project configuration that `gate` and `ci init` read: the checks a project requires. Today these are spread over toggles, enforce settings and referees.
3. **Lessons tied to code areas**: since T-0330 a bugfix receipt can name the files it is about, and verify-claim brings a finished fix back for later tasks on those files. Lessons cannot name files yet. The areas must be declared, not guessed: guessed file scopes were measured and rejected before.
4. **Recorded verdicts**: verify-claim and gate failures kept as non-conformance records, so metrics such as first-pass rate and rounds to a GO come from them.
5. **Request-to-task links** set explicitly (user requests already have a field for them).

## Left out on purpose

- A separate `quality.yaml`: a policy section belongs in the configuration Leerness already reads.
- Separate `qa-plan` and `qc` commands: they would repeat `review-request` and `verify-claim`.
- FMEA-style risk scores: they are heuristics; lenses and risk tiers ask the questions instead.
- Industry quality systems (PPAP, AQL, GMP and the like): these fit skills, not the core.
