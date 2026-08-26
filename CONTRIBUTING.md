# Contributing to leerness

## Invariants (non-negotiable)

- **0 runtime dependencies** and **0 install scripts** (`preinstall` / `install` / `postinstall`). `leerness install-safety` asserts both; the release gate fails if either is violated.
- **UTF-8, no BOM** for every source file.
- Korean-first comments in `bin/` and `lib/` (the codebase's existing convention).
- Protected harness files are never deleted — merge, archive, or mark deprecated instead.

## Test tiers

The main three tiers, fastest to slowest:

| Command | What it runs | Time | Use it for |
|---|---|---|---|
| `npm run test:fast` | `selftest` + smoke (commands run without crashing) | < 1 min | the dev loop |
| `npm run test:core` | `selftest` + a flagship behavioral suite — `verify-claim` / `gate` / `contract` / `scan` actually reject bad input and pass honest input | ~20 s | pre-commit, quick CI |
| `npm test` | `--version` + `selftest` + the entire e2e suite + a packed-artifact cleanroom | **10+ minutes by design** | the release gate |

Focused suites are also available: `npm run test:commands` drives the broad CLI command surface, while `npm run test:installed` packs the package, installs it into a separate consumer, verifies canonical workspace migration and concurrent handoff isolation, then reruns that command surface from the installed artifact.

`npm test` is the gate that must pass before publishing. It is deliberately slow: the e2e suite drives the published CLI surface end-to-end rather than mocking it.

## Adding a check

Prefer **behavioral** tests over source-grep guards. A source-grep guard asserts that a string exists, not that the behavior holds — and it can match its own literal in the file it greps (use split literals like `'function ' + 'name'` to anchor past your own line if you must grep).

When you add a guard, construct the **discriminating case**: an input where the old code passes and only the new check catches it. If you cannot construct one, the check may not be measuring what you think.

## Release

`npm test` (gate) → bump `VERSION` in `bin/leerness.js` **and** `version` in `package.json` (selftest asserts they match) → CHANGELOG entry → commit → publish → push.

## How releases get tested

Methodology, results, and limitations of the clean-room evaluations: [docs/clean-room-evaluations.md](./docs/clean-room-evaluations.md).
