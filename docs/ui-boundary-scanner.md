# UI boundary scanner API

For the login-free `leerness ui scan --stdin` command, see [CLI usage](ui-review-cli.md). The CLI adds strict parsing and a 64 KiB envelope limit; the direct library contract below is unchanged.

`lib/ui-boundary-scanner.js` exposes `scanUiBoundary(inputJson)`. It scans bounded,
caller-selected UI text and attribute values for development syntax and the
existing secret catalog. It returns candidates, never copy approval. It performs
no file access, DOM collection, model invocation, persistence, or automatic removal.

```js
const { scanUiBoundary, INPUT_SCHEMA, POLICY_VERSION } = require('leerness/lib/ui-boundary-scanner');
const result = scanUiBoundary(JSON.stringify({
  schema: INPUT_SCHEMA,
  policyVersion: POLICY_VERSION,
  taskKind: 'ui',
  surfaces: [{ kind: 'text', exposure: 'rendered', text: 'TODO: connect action', attribute: null }],
}));
// result.findings[0].severity === 'advisory'
// result.review is compatible with the optional review.uiBoundary contract.
```

## Input and limits

The only input is an inert serialized JSON string. The exact root fields are
`schema: leerness.ui-boundary-scan-input/v1`, `policyVersion: leerness.ui-boundary/v1`,
`taskKind: ui | non-ui | unknown`, and `surfaces`. Unknown or missing fields reject
the entire packet before scanning. Native `JSON.parse` duplicate-key semantics
apply (last value wins); this is not a signed authorization envelope.

`surfaces` is an array of at most 32 objects, each with exactly these fields:

| Field | Values |
| --- | --- |
| `kind` | `text` or `attribute` |
| `exposure` | Caller-declared `proposed` or `rendered` |
| `text` | Decoded string, at most 4,096 UTF-8 bytes; no unpaired surrogates |
| `attribute` | `null` for text; otherwise a lowercase ASCII name matching `[a-z][a-z0-9:-]{0,63}` |

The complete JSON string, including escaping and whitespace, must fit 128 KiB.
These limits are independent: 32 individually maximal surfaces may exceed the
envelope limit. No clipping or partial result is returned. A non-UI packet must
have no surfaces. UI with an empty array returns `no-surfaces`, not a clean UI.

Callers select actual surface units such as visible text, accessible names,
tooltips, and attribute values. The scanner does not accept source-file paths or
fetch URLs. Supplying source code as `text` does not prove that code is visible.
Supply decoded DOM text and attribute values. HTML entities, escapes within UI strings,
CSS visibility and split nodes are not resolved here; DOM/render adapters are separate work.
The limited character mapping described below applies only to syntax matching, secret
patterns use the supplied text, and it is not general Unicode normalization (for example a
combining grapheme joiner, a bare CR or U+2028 inside a marker still hides it).

## Syntax policy

Scanner version `leerness.ui-boundary-scanner/v2` (1.36.288). Rules run on a matching view of
each surface in which full-width ASCII becomes ASCII, non-breaking and wide spaces become
spaces, and zero-width characters are removed, so `ＴＯＤＯ：`, an indented `\u00A0TODO:` or
`TO\u200BDO:` are still markers. The view is used only for matching: findings, digests and
outputs keep the supplied bytes, and copy is never rewritten. A line may begin with one list
bullet (`•`, `-`, `*` and similar) before a TODO/note-label/DEBUG marker; the comment and
exception rules do not take a bullet. Secret patterns run on the supplied text as before.

| Code | Candidate subtype | Match scope |
| --- | --- | --- |
| `developer-marker` | `DEVELOPER_NOTE` | Line-start TODO/FIXME/XXX/HACK with colon, or bracketed marker; case insensitive |
| `developer-note-label` | `DEVELOPER_NOTE` | Line-start note label with colon or brackets: Developer/Internal/Designer note, note to self, 개발자 메모, 내부 참고, 디자이너 메모, 작업 필요, 수정 필요 and similar |
| `placeholder-copy` | `DEVELOPER_NOTE` | Lorem ipsum; placeholder/dummy/filler text or copy; 임시/더미 문구·텍스트·버튼명·제목 |
| `maintenance-note` | `DEVELOPER_NOTE` | Replace with real/final copy, replace or remove before launch/release/shipping, hardcoded for/until, 추후 교체, 확정되면 교체, line-final 나중에 수정, 교체할 것 |
| `rendered-comment` | `DEVELOPER_NOTE` | Visible `<!--`, or a line starting with `// ` or `/* ` |
| `debug-prefix` | `DEBUG_METADATA` | Line-start DEBUG/디버그 with colon, or bracketed marker; case insensitive |
| `exception-detail` | `DEBUG_METADATA` | Named JavaScript exception followed by colon and detail, at line start or after a label colon |
| `stack-frame` | `DEBUG_METADATA` | Indented JavaScript frame with path and line/column |
| `python-traceback` | `DEBUG_METADATA` | Traceback header and file/line frame |
| `loopback-url` | `DEBUG_METADATA` | HTTP(S) localhost, 127.0.0.1 or [::1] endpoint |
| `internal-metadata` | `DEBUG_METADATA` | Line/JSON-field debug payload, raw response/status, system prompt, chain of thought, internal trace or stack trace assignment, in snake_case or camelCase |
| `object-coercion` | `DEBUG_METADATA` | `[object Object]` and similar, unless the text opens with it as the thing being explained: `[object Object] means / indicates / appears when …`, `[object Object]란 …`, or a Korean subject whose own sentence ends in an explanation predicate (`…뜻입니다`, `…의미합니다`, `…때 표시됩니다`, `…나타납니다`, `…가 보이면`). A connective alone (`[object Object] is ready`, `[object Object]는 품절입니다`) does not excuse it |
| `unresolved-template` | `DEBUG_METADATA` | `{{name}}`, `${name}` or `%s`/`%d`, unless the text explicitly talks about templating (`template variables`, `variables like`, `템플릿 변수`); a bare "variable" or "template" elsewhere does not excuse it |
| `missing-value` | `DEBUG_METADATA` | `undefined`/`null`/`NaN`/`Invalid Date` as the whole line, after a label colon at line end, before a Korean unit or `%`, or after a currency sign |
| `raw-i18n-key` | `DEBUG_METADATA` | The whole surface resembles a dotted key such as `home.hero.title`. A finite suffix list suppresses common domains and file names; other domains or files can still be candidates, and a real key can share an excluded suffix |
| `json-dump` | `DEBUG_METADATA` | A complete JSON object with at least one property, or an array containing an object, as the whole surface or after a label (whitespace and line breaks allowed); parsed from the supplied text. Empty objects/arrays and primitive-only arrays are not candidates |
| `debug-attribute` | `DEBUG_METADATA` | data-debug, data-debug-only, data-internal-debug or data-source-prompt attribute |

Provider/framework names and ordinary model, agent, status or error labels are
not denylisted. For example, `React 시작하기`, `실행 모델`, `DEBUG 모드 안내`,
`localhost 연결 설정`, `할 일 3개 남음`, `임시 저장됨` and `Note: changes apply to all members`
do not match. A development guide deliberately showing an exact loopback URL or debug example
can still produce an advisory candidate, and so can a template editor's `{{customer.name}}`,
a localization manager's `home.title` or an API client's JSON response: syntax cannot see the
product. The caller must review product intent; no keyword match deletes existing copy.

Requirement, acceptance-criterion and implementation-narration wording is not matched. Phrase
rules written for those types reached 100% on the examples they were written from but 15–25%
on an independent corpus, with new false alerts on legitimate onboarding and marketing copy:
telling an instruction to the builder from an instruction to the user needs the product
context. Those types are covered by prevention guidance for the UI-building agent
(`.leerness/ui-copy-boundary.md`) and by review (`leerness ui review packet`). Bare TODO words
(a to-do app), bare `Todo`/`할 일` labels and arbitrary exception classes also stay unmatched.
Measured recall and false alerts are recorded in the 1.36.288 implementation report; they are
finite-corpus results, not production rates.

## Security and duplicate policy

The scanner reuses `catalogs.SECRET_PATTERNS` and the repository secret scanner's
`_isPlaceholderSecret` / `_looksSecretLike` guards. It scans each rule once per
surface, using a fresh RegExp so catalog cursors are untouched. It does not run
the repository CLI scanner, use file ignores or acknowledgement baselines, or
copy its raw snippets. Display redaction is a separate policy and is not used
as a secret classifier. Catalog limitations and placeholder exclusions apply;
absence of a pattern is not proof of credential safety or absence of personal data.

One supplied surface yields at most one finding. Repeated matches of a rule are
collapsed; all matched UI signal kinds and security pattern names are retained.
If any secret pattern matches, the single finding has `category: security`,
`severity: delegated`, and `DEBUG_METADATA` context. The UI signals remain nested
evidence instead of a second UI severity/finding. Multiple distinct secrets in
one surface remain one exposure finding, so counts are not secret occurrence counts.
Different surface indices remain distinct even when their text is identical.

No external security receipt is consumed or reconciled here. Consumers should
use this aggregate once, and not append its `review` projection as a second
finding stream alongside the detailed findings. A repository finding and a UI
finding are different evidence scopes; matching text alone cannot merge them.
External merging requires verified common provenance in a later review adapter.

## Output, review projection and evidence

The result schema is `leerness.ui-boundary-scan/v1`, with scanner version
`leerness.ui-boundary-scanner/v2`. `status` is `findings`, `no-pattern-match`,
`no-surfaces`, or `not-applicable`; unknown task kind keeps `applicability: unknown`.
`scannedSurfaces` counts input units, not verified visible elements.

Each finding contains a zero-based `surfaceIndex`, category, representative
subtype/sourceKind, fixed `sourceBasis: pattern-inferred-candidate`, severity,
`certainty: candidate`, disposition, UI `signals`, `securityPatterns` and
`evidenceDigest`. It contains no input text, arbitrary attribute name, path, URL,
secret snippet or caller-controlled identifier. If UI signal subtypes differ,
DEBUG_METADATA is the representative subtype; all signal subtypes remain in
`signals`. This is inferred syntax classification, not verified author provenance.

UI findings are `advisory` / `review-remediation`, including proposed copy.
Security findings are `delegated` severity: proposed exposure requests
`withhold-pending-review`, while rendered exposure requests `review-remediation`.
These are recommendations. All `effects` are false, and source, render, semantic
and independent review remain unverified/not-run even after all patterns run.

The SHA-256 digest is computed over UTF-8 `JSON.stringify` of this exact array:

```text
[scannerVersion, policyVersion, taskKind, surfaceIndex, kind, exposure, attribute, text]
```

It binds the supplied full surface and its declared metadata, not a source
snapshot or actual render. A digest is an identity reference, not encryption or
independent evidence. Do not persist the input packet just to persist a result.
Because the scanner version is part of the digest, a v2 digest never equals the v1 digest of
the same surface; a review bound to a v1 digest is stale for v2 results by design.

`result.review` is a validated [optional review contract](ui-boundary-contracts.md)
projection of these same candidates, with `evidenceVerified: false`. It carries
the representative classification and digest; retain the detailed scan result
if individual signal kinds matter. It does not assert a completed execution,
establish reviewer independence, or bypass parent ledger requirements. No global
prompt, dispatch or CLI/MCP command is added by this API.

Errors are `UiBoundaryScanError`, with fixed `ui_boundary_scan_*` codes and fixed
schema paths; parser messages and offending keys/values are not echoed.
Tests: `node scripts/ui-boundary-scanner-probe.js` or `npm run test:ui-boundary`.
The finite labelled fixtures measure this syntax contract, not production UI
false-positive/false-negative rates or model quality.
