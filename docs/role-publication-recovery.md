# Role-store publication and recovery boundaries

`agent-roles.json` is not assumed to be a new, empty configuration merely because
its pathname is temporarily absent. An existing role update can move the original
into `.agent-roles-cas-<token>/before` before installing its replacement.

## Read behavior

The role-store reader reuses the shared publication-absence check for both the
standard `.agent-roles.json.publish-cas-<token>` spelling and the role publisher's
existing `.agent-roles-cas-<token>` spelling. A matching unresolved marker, a
reappearing leaf, or a changed parent produces `store_changed`, not successful
empty roles. An unreadable directory inspection produces `store_unreadable`.
Matching names are treated conservatively even when they are empty directories,
files or links. The reader does not open their contents, follow their links,
restore them, delete them or choose a replacement on the user's behalf.

A genuinely missing file/workspace remains missing without creating a workspace.
An existing valid role file keeps its prior read path without directory scans,
including when completed-publication backup folders remain beside it. Validation
and role resolution carry the refusal rather than promoting an empty fallback.
The configured role data is preserved; stored role definitions and schema do not
change. This is not a new routing feature.

## Writer behavior

`roles set` and `roles suggest --apply` can encounter the gap during their
preflight. For this specific `store_changed` refusal they acquire the existing
role-store lock and repeat the preflight read. They do not hold that lock while
checking providers or preparing suggestions. The final mutation still uses the
existing locked read and compare-before-publication path. `roles unset` already
reads inside that lock and keeps that path.

An active cooperative writer can finish before the waiting operation proceeds.
An interrupted publication that remains unresolved after lock acquisition still
fails; it does not authorize creating empty roles over the retained original.
No new polling loop, enlarged timeout, automatic restoration or provider retry is
introduced. This is not a multi-file transaction or an exactly-once guarantee.

## Verification and scope

Run the optional focused regression directly:

```sh
node scripts/role-publication-gap-probe.js
```

The 24 cases include two real CLI writers contending with a live POSIX publisher,
an observation inside the actual role publisher's rename-away interval, interrupted
publication refusals, exact metadata preservation, parent/leaf changes, genuine
absence and the existing-file fast path. Three real POSIX cases are explicitly
skipped on Windows; they must not be counted as Windows passes.

Library read checks and `roles validate` assert no fixture writes. The legacy
`roles list` and `roles suggest` CLI paths can still record usage statistics;
this change does not claim to make every role command globally read-only.
The regression is not added to default npm/CI chains. Network filesystems,
power loss, hostile swaps after the last check, and other raw-reader/pre-lock
paths remain outside this narrow repair. Inspect retained publication material
before any explicit recovery; do not delete markers merely to silence an error.
