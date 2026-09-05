# State inspection API v1

Available in v1.36.186. T-0174 / P-0020 is an additive inspection-only foundation.
It does not move data or activate a new backend. The complete staged design is in
[State scopes and migration](state-scopes.md).

## CLI

```sh
leerness state inspect
leerness state inspect ./project --json
leerness state inspect --path ./project --language en
```

The target must be an existing directory. `--path` wins over the optional positional
target; otherwise the target is the current directory. Blank paths, extra positionals,
duplicate `--path`, unknown options and unsupported write flags fail before discovery.
Text defaults to Korean; `--language` or `LEERNESS_LANG` chooses English/Korean without
reading a project manifest. JSON is one document, with `ok: true` on success, or the
standard `ok: false` / `code` / `error` envelope and exit 1 on failure.

## Module export

- `resolveStatePaths(root, options)` from `lib/state-paths.js`: read-only resolution;
  default root is cwd. `options.env` supplies the child Git environment and workspace
  override; `options.envValue` overrides workspace selection. Neither is persisted.

`inspectState(root, options)` from `lib/state-inspect.js` adds `ok` and the fixed-list
inventory; `formatStateInspection(report, language)` renders the already resolved
snapshot without more I/O. The resolver does not initialize the CLI or discover skills.

## Fields

- schemaVersion: 1.
- schema: `leerness.state-paths/v1` (inspection: `leerness.state-inspection/v1`).
- activeLayout: `legacy`; existing writers remain authoritative.
- runtimeActivated: false.
- migrationAvailable: false.
- projectRoot: canonical absolute directory of the requested project, not necessarily the Git root.
- projectKey: `project-` plus SHA-256 of the canonical repository-relative project path.
- projectRelativePath: forward-slash relative path, or `.` for a repository root/non-Git project.
- git: absolute worktreeRoot/gitDir/gitCommonDir and linkedWorktree, or null for genuine non-Git.
- workspace: selected name/path, canonical path, detectedPaths, legacy presence and recognition status.
- scopes: exactly project, worktree, commonControl, immutableRecord and generatedView.
- warnings: explicit non-Git, unrecognized/foreign and legacy-workspace observations.

All `proposedPath` / `proposedPaths` values are future addresses, **not created, activated,
validated as writable, or authorization to write**. Project scope separately reports
`currentPath`. Inventory rows report the actual legacy path, classification, proposed
semantic scope, migrationAvailable=false and lstat metadata (including links/errors).
They are not a move plan. Mixed task/context/queue documents must be split by field;
human intent is not disposable generated state.

Inventory covers the selected path plus any other existing canonical/legacy workspace,
with workspacePath and selectedWorkspace on each row. A legacy reader selection must not
hide canonical runtime, nor may a canonical selection hide residual legacy evidence.
Text output prefixes rows with the workspace directory name; contents are never merged.

Project identity is independent of branch name and session. Matching repository-relative
projects in linked worktrees share a common-control proposal, but never private runtime.
Siblings differ. Separate clones/hosts do not share live control. Non-Git proposals use
project-local `cache/state-runtime`, with commonControl unavailable, not an invented shared store.
These keys are namespaces, not credentials. Moving a project inside a repo changes its key.

## Failures and limits

Path errors distinguish invalid/not-found/not-directory/unreadable targets. Git errors
distinguish missing, unsupported, bare, metadata-directory, timeout, output-limit,
unreadable, ambiguous output and repository discovery failure. Filesystem
errors in Git-returned paths or the discovery marker walk remain Git-specific;
they never misreport an existing inspection target as missing. Existing workspace
conflict/override/link errors retain their codes; strict inspection adds workspace_unreadable.
Git failure never silently falls back to a different backend. Existing discovery ceilings
are respected; nonexistent ceilings are ignored as Git does. Git location/config injection
overrides are sanitized through the existing gateway, not through a duplicate subprocess wrapper.

One Git topology query has a 5-second process timeout and 64-KiB output cap (Windows executable
discovery is a separate bounded gateway step). Git must support `--path-format=absolute`.
Workspace discovery reads immediate directory names; inventory uses a fixed set of leaves
and cached parent metadata without contents or recursive traversal. Links are not followed
for inventory. This is an observational, non-transactional filesystem snapshot; it is not
record validation, tracking detection, filesystem locking or a migration-integrity certificate.

## Verification

`npm run test:state-scopes` runs selector equivalence, topology/metadata and real CLI tests.
The CLI test instruments normal execution without internal/no-migration/no-stale bypasses:
one Git query, no npm/provider command, no project content read, no write; it also compares
all fixture/cwd/Git file bytes and mtimes. Windows may perform trusted Git location and
console encoding operations. No new runtime dependency, persistent config or MCP tool is added.
Invalid option diagnostics are instrumented too: neither target nor unrelated cwd
manifest contents are read merely to choose an error language.
