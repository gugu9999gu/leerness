# Chromium UI boundary collection

`lib/ui-boundary-browser.js` connects an already authorized Chromium CDP session
to the existing UI boundary scanner. It has no browser package dependency and
does not launch, navigate, close, or modify a page. The host owns target selection,
consent, transport limits, timeouts, and session cleanup.

```js
const { scanUiBoundaryBrowser, INPUT_SCHEMA } = require('leerness/lib/ui-boundary-browser');
const { POLICY_VERSION } = require('leerness/lib/ui-boundary');
// page is an existing authorized Playwright Chromium page.
const cdp = await page.context().newCDPSession(page);
try {
  const result = await scanUiBoundaryBrowser(cdp, JSON.stringify({
    schema: INPUT_SCHEMA, policyVersion: POLICY_VERSION, taskKind: 'ui',
  }));
  // Persist only the returned metadata, after your own evidence admission.
} finally {
  await cdp.detach();
}
```

The required input fields are `schema: leerness.ui-boundary-browser-input/v1`,
`policyVersion`, and `taskKind: ui | non-ui | unknown`. Shared strict JSON parsing
rejects duplicates, unknown fields, and malformed input before using the session.
`non-ui` returns `not-applicable` without accessing a session. Unknown applicability
remains unknown in scanner batches.

Optional `maxSurfaces` selects an integer budget from 1 to 4,096. Omitting it keeps
the original 512-observation default; it does not alter per-text, response, or
scanner-batch limits. Use an explicit budget when a bounded larger document reports
`surfaceLimit` omissions. The budget is not part of the full projection digest;
changing it may change admission/status while the observation digest remains equal.

## Observed surfaces

Two successive samples each call `DOMSnapshot.captureSnapshot` with computed
`display`, `visibility`, `opacity`, followed by `Accessibility.getFullAXTree`.
The main document's layout text is grouped across consecutive inline fragments
within a block; separate blocks stay separate and visible BR adds a newline.
DOM text without positive layout size, with hidden visibility, or under zero
opacity is excluded. Several layout objects for one generated-content node are
supported. AX contributes non-ignored computed names and descriptions, including
hidden labels referenced by visible controls. InlineTextBox fragments are skipped.
Opacity-zero content may still be accessible and can produce an AX finding.

Script/style/template bodies, input/textarea/select content and editable subtrees
are excluded from DOM copy. AX values and property payloads are never projected.
Controls' computed names and descriptions remain eligible. A browser can derive
such names from other content, including input values; this adapter does not
reimplement the accessible-name algorithm or classify product intent. It does not
scan every HTML attribute: source/debug data attributes alone are not rendered copy.

The `placeholder` attribute of a text control is collected as its own `dom-placeholder`
surface (scanner kind `attribute`) when the control itself is laid out, visible and not
transparent: a textarea, or an input whose type is missing, text-like (`text`, `search`,
`url`, `tel`, `email`, `password`, `number`) or unknown to HTML. Chromium drops the
placeholder from the accessible name once `aria-label` or a label names the field, and
the snapshot has no user-agent shadow tree, so without this channel such a hint was not
observed. A placeholder the browser already used as the field's accessible name is not
collected twice. The control's value is never read, so the placeholder of a field that
currently holds a value is collected too: it is authored copy shown whenever the field is
empty. Checked in headless Chrome 154 and Edge 154.

The adapter selects only the main document. Child frames and unmapped AX nodes
are counted as coverage gaps. Shadow content flattened by Chromium can be observed.
CSS-generated text is included when present in layout data. This is document-level
copy observation, including offscreen content, not screenshot/OCR or a viewport
visibility test. Clipping, overlays, contrast, image/canvas text, virtualized content,
all interaction states, and arbitrary inline visual order are not fully assessed.

## Result and limits

The result schema is `leerness.ui-boundary-browser/v1`. `status` is:

- `not-applicable`: no browser requests for a non-UI task.
- `stale`: the two projected samples differ; no scan batches are returned.
- `partial`: one or more child frames, unmapped AX nodes, or admission omissions.
- `observed`: the supported projection was scanned without these counted gaps.

`observed` is not a clean-UI or completeness verdict. `scanStatus` separately reports
`findings`, `no-pattern-match`, or `no-surfaces`. `captureState` records equality or
change between samples. Sampling is not an atomic snapshot: changes between equal
samples, changes outside the selected projection, and later changes are not ruled out.

Responses are admitted at 8 MiB each; DOM/AX node and layout arrays at 30,000 rows.
The response-byte check occurs **after** the host transport has received and
materialized the response, so it is not an upstream network-memory cap. The host
must enforce transport-size and time limits. By default at most 512 nonempty observations
are scanned; text beyond the scanner's 4,096 UTF-8 bytes or with unpaired surrogates
is omitted and counted, not silently truncated or split. Remaining observations
are packed into batches of at most 32 surfaces and 128 KiB serialized scanner input.
There is no cross-batch or cross-surface pattern matching.

Each `batches[]` entry contains the unmodified scanner `scan` result and
`surfaceIndexes`: local scanner index to result `sources[]` index. Sources expose
only channel (`dom-text`, `dom-placeholder`, `ax-name`, `ax-description`) and observation ordinal.
DOM and AX can describe the same text; findings count observations, **not unique
defects**. Each batch preserves its own UIB-02 review projection and local surface
digest domain. Do not merge these into one review beyond its 32-finding contract.

`observationDigest` hashes UTF-8 JSON of
`[OUTPUT_SCHEMA, taskKind, projectedSample]`, where the private sample contains
main-document frame/backend identity, ordered node/channel/text groups and coverage
counts. Stale results expose before/after digests. Session-specific identifiers mean
this is not a stable cross-browser/source fingerprint. Bind browser output to an
explicit render artifact through the existing observation API; scanner surface
digests are not file digests or source/Git provenance.

No raw copy, URL, selectors, DOM/AX dump, input value, or caught transport error is
returned or written. CDP responses themselves contain broader page data transiently
in host memory; do not log them on real user pages. Digests can reveal equality or
be guessed for low-entropy text and are not anonymization.

`trust: host-supplied-cdp-transport` does not authenticate a browser, actor, source,
semantic judgment, or independent reviewer. A host can supply a synthetic session.
Effect flags describe the adapter's requests; arbitrary host transport code is not
sandboxed or observed for its own effects. All approval/enforcement effects remain
false. `UiBoundaryBrowserError.code` uses
fixed `ui_boundary_browser_` suffixes `input_invalid`, `session_required`,
`capture_failed`, `response_invalid`, `response_limit`, with no raw detail.

## Validation

`node scripts/ui-boundary-browser-probe.js` runs transport and projection controls.
For real Chromium controls, provide an existing Playwright module path and browser
executable through `LEERNESS_TEST_PLAYWRIGHT` and `LEERNESS_TEST_BROWSER`, then run
`node scripts/ui-boundary-browser-probe.js --browser`. Without Playwright, point
`LEERNESS_TEST_BROWSER` at an installed Chromium browser (Chrome, Edge) and run
`node scripts/ui-boundary-browser-probe.js --cdp` (Node 22+): the same controls run over
plain CDP on the global WebSocket, with a throwaway profile. Missing dependencies fail;
they are never installed implicitly. Both modes launch a temporary headless browser,
block network requests, set only synthetic local fixture HTML, and close it.
Browser controls are finite regression cases, not production false-positive rates
or independent semantic review. The default dependency-free suite does not claim
to execute a browser.

Protocol reference: [Chromium DOMSnapshot and Accessibility definitions](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json).
