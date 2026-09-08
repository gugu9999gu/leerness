# Store diagnostics API v1

Implementation candidate for T-0192 / P-0022. Publication is tracked separately.

```sh
leerness state stores ./project --json
leerness state stores --path ./project
```

This separate command reads only decisions, lessons and roles in the selected
workspace. `state inspect` remains metadata-only. Explicit `--path` takes precedence
over the optional positional directory. Duplicate paths, extra positional arguments
and unsupported write flags fail before ordinary startup bookkeeping.

`inspectStores(root, options)` is exported by `lib/store-diagnostics.js`; options
are passed to the existing `resolveStatePaths` resolver. It resolves the selected
workspace, not all worktrees or every native runtime authority. A legacy workspace
is diagnosed in place without migration. No provider or model call is made.

## Result

The single JSON document has schema `leerness.store-diagnostics/v1`, `ok`,
`readOnly:true`, `writesPerformed:false`, `workspace`, `warnings`, and three `stores`.
Each row identifies the fixed filename and contains:

- `canonical.status`: `valid`, `missing`, `invalid_json`, `invalid_shape`,
  `unreadable`, `unsupported`, or `unknown`.
- `reasonCode` and actual `bytesRead` inside `canonical`; no original text or parse
  error excerpt is included. `syntaxValid`, `shapeValid`, `itemsValid` are tri-state.
- `effectiveSource`: source selected by this diagnostic (`canonical`,
  `legacy_markdown`, `none`), not an authorization to write or switch runtime authority.
- `fallback`: whether the diagnostic attempted/used bounded Markdown parsing, its
  status and (when attempted) read metadata. It does not execute the legacy loader.
- `itemCount`: parsed array/Markdown count or validated role count, otherwise null.

Missing optional data is allowed. An invalid canonical file keeps `ok:false` even
when Markdown is available. CLI exit is 0 only when `ok:true`; failed discovery
returns a generic `store_diagnostics_failed` envelope and exit 1. For each memory
store, fallback is attempted only on missing, syntax-error or non-array JSON.
Unreadable, unsupported and changing sources do not trigger fallback. This is
deliberately stricter than the existing resilient memory loader, which is unchanged.

Memory JSON validates array shape only: `itemsValid:null` even for an empty array.
This is not full item validation or a semantic-health certificate. Roles reuse the
pure legacy role schema and extended role-definition validator. Markdown uses the
existing pure parsers; readable text with no matching entries can yield count zero.

## Read and scope limits

Each file is limited to 1 MiB; the reader consumes at most limit+1 bytes to detect
growth/overflow. Size checks alone are not relied on. It uses strict UTF-8 and
rejects observed linked/non-regular/multiply-linked files and linked workspace
parents. File/parent identity and file metadata are compared around the read;
observed changes fail rather than certify an unstable snapshot. These checks are
not a portable filesystem transaction, writer lease or guarantee against every
hostile concurrent filesystem action.

Only selected known files are covered, with no recursive scan, automatic repair,
archive append, usage write, presence update or migration. The diagnostic performs
no content writes; ordinary filesystem access-time effects are not a content/mtime
immutability guarantee. Existing mutation commands and their late save guards are
unchanged. See [the broader observation contract](store-observation-contract.md).

Run `npm run test:store-diagnostics` for the focused functional checks. This suite
also runs through `test:state-scopes`, hence through the existing fast/full gates.
Its ordinary fixtures test schema/fallback/size/encoding/privacy and CLI zero-write
behavior; it is not an adversarial filesystem or OS-permission coverage claim.
