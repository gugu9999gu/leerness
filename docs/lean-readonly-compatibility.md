# Read-only consumer transition

## Major-version boundary

Default handoff no longer writes a freshness receipt, `doctor.healthy` may be
`null`, and default JSON can omit diagnostics. These are observable contract
changes. They require a major-version transition; they must not be published as
a compatible 1.x patch. An opt-in compatibility design would be a separate
reviewed behavior change. See [semantic versioning](https://docs.npmjs.com/about-semantic-versioning/).

## Consumer requirements

| Consumer | Required use | Remaining boundary |
| --- | --- | --- |
| Multi-session presence | A session that must be visible explicitly requests `handoff --record` or an MCP `sessionKey` | Ordinary reads show stored records and report when the reader has none; they do not register a session |
| Git hook freshness | Record an explicit handoff for the intended session | Existing installed hooks need explicit reinstall and target verification |
| Editor session start | Read context without recording unless a receipt is needed | Existing editor configuration is not silently changed |
| MCP handoff | An ordinary call reads; an explicit `sessionKey` requests the validated recording lifecycle | Recording still requires its write tier and permissions |
| Detailed JSON | Request `--inspect` when diagnostics are needed; accept absent, partial, or unknown fields | Missing observations are not proof of successful checks |
| Doctor boolean consumers | Handle `healthy` true, false, and null, and inspect `selftest.status` | Null is neither a passing suite nor a proven failed suite |
| Installed lifecycle tests | Request a receipt only where presence is under test | A helper pass is not complete installed-product acceptance |

Generated project instructions may still suggest `leerness handoff .`; following
that ordinary read does not register a session. Verify the generated and installed
consumer instructions, and explicitly record only when presence is required.

There is no hidden fallback that reintroduces automatic diagnostics or
recording. `--record`, `--inspect`, `--writeback`, and `sessionKey` have different
contracts; `--no-record` wins. Security checks, source ownership, original-data
preservation, and authority for external execution remain in force.

## Observation limits

Tests may block and observe supported Node HTTP(S), sockets/TLS, HTTP2, UDP,
DNS, and child-process entry points. Such instrumentation is not an OS-wide
network sandbox and does not cover arbitrary native modules. A deliberately
blocked request is a positive test control, not a real provider call.

Success for repository consumers does not prove that unknown installed clients
have migrated. Verify the actual client, installed package, OS, Node version,
and intended session workflow. Explicit source reads and retained-task context
do not imply automatic task migration or archived-memory repair.

Use a separate copy for upgrades and retain the previous project and package.
See [installation and rollback](release-candidate-guide.md). A package downgrade
does not automatically restore newer project data.
