# Rule observations and historical records

`leerness rule verify --json` and `leerness session close --json` report
keyword observations. They do not certify compliance with natural-language rules.
`ok: true` means the command completed, not that every rule was followed.

| State | Meaning |
|---|---|
| observed | A version/mtime change or explicit zero exit in a same-day test note was observed. |
| pending | The expected signal is missing, incomplete or reports a test failure. |
| manual | A deployment obligation or an unrecognized rule needs separate examination. |
| baseline | The comparison lacks a previous observation. |

Every result includes `verificationScope: keyword-signals-only`,
`applicability: unknown`, `compliance: unknown` and its individual `clauses`.
The summary explicitly reports `unverifiedRules` and `enforcement: advisory`.
There is no compliance percentage. A pending observation alone does not establish
a rule violation: the command does not know whether its trigger applied.

Deployment/push remains a separate unverified clause even if a version change or
test signal exists. Tests need an explicit completion exit code; an unfinished
test note cannot count as success. Multiple exit codes with a failure, `null`, or
an explicit failure marker remain failure signals. Only the latest matching
same-day header is considered. These are authored notes, not authenticated,
session-bound test receipts. An exit-zero signal does not prove reviewer identity,
absence of prohibited actions, or successful deployment.

Verification preserves `rules.md` and `lastVerified` byte-for-byte. It still
updates the existing comparison cache under the existing lock. Version and file
mtime observations can change on repeated calls as the baseline advances.

`retro`/`insights` count a syntactically valid date in `lastVerified` only for
active rules, and label it a **historical dated record**. Paused/superseded rows
and arbitrary references such as `R-0050` are excluded. The legacy JSON field
`verifiedRules` remains as a compatibility alias for this historical count;
consumers should use `ruleHistory.historicalRecorded` and respect
`ruleHistory.compliance: unknown`. A date and note can be entered manually and
are not fresh evidence. No historical record is erased or upgraded.

At task start, review rule applicability, current user instructions and any
conflicts. At close, connect each applicable rule ID to relevant execution/code
evidence; distinguish unknowns, observed violations and reasons for non-applicability.
The existing `rule assess` command assesses explicit caller-supplied conditions;
it does not verify their source or authorize skipping a rule. Neither command
intercepts arbitrary shell tools or external agents. Structural enforcement and
trusted per-action receipts require separate integration.

These semantics replace earlier heuristic `pass` results. Consumers that rely on
`verified === pass` must not map `observed` back to a compliance pass. No CLI exit
status or default deployment permission is changed.
