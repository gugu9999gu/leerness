'use strict';

const { createHash } = require('node:crypto');
const { parseInputJson } = require('./review-checkpoint-transport');
const scanner = require('./ui-boundary-scanner');

const INPUT_SCHEMA = 'leerness.ui-boundary-browser-input/v1';
const OUTPUT_SCHEMA = 'leerness.ui-boundary-browser/v1';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_NODES = 30000;
const MAX_SURFACES = 512;
const MAX_REQUESTED_SURFACES = 4096;
const STYLES = ['display', 'visibility', 'opacity'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'INPUT', 'TEXTAREA', 'SELECT']);
// Input types whose placeholder the browser draws; a missing or unknown type is a text field.
const PLACEHOLDER_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);
const KNOWN_INPUT_TYPES = new Set([...PLACEHOLDER_INPUT_TYPES, 'button', 'checkbox', 'color', 'date', 'datetime-local',
  'file', 'hidden', 'image', 'month', 'radio', 'range', 'reset', 'submit', 'time', 'week']);

class UiBoundaryBrowserError extends Error {
  constructor(code) { super(code); this.name = 'UiBoundaryBrowserError'; this.code = code; }
}
function fail(code) { throw new UiBoundaryBrowserError('ui_boundary_browser_' + code); }
function hash(value) { return 'sha256:' + createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }
function requireThat(value) { if (!value) fail('response_invalid'); }
function input(json) {
  let value;
  try { value = parseInputJson(json); } catch { fail('input_invalid'); }
  if (!value || Array.isArray(value) || Object.keys(value).some(k => !['schema','policyVersion','taskKind','maxSurfaces'].includes(k))
    || value.schema !== INPUT_SCHEMA || value.policyVersion !== scanner.POLICY_VERSION
    || !['ui', 'non-ui', 'unknown'].includes(value.taskKind)) fail('input_invalid');
  if (Object.hasOwn(value, 'maxSurfaces') && (!Number.isInteger(value.maxSurfaces)
    || value.maxSurfaces < 1 || value.maxSurfaces > MAX_REQUESTED_SURFACES)) fail('input_invalid');
  return value;
}
async function response(session, command, params) {
  let serialized;
  try { serialized = JSON.stringify(await session.send(command, params)); }
  catch { fail('capture_failed'); }
  if (typeof serialized !== 'string') fail('response_invalid');
  // The trusted transport must bound its own incoming messages and timeouts.
  // This admission check runs AFTER CDP has materialized the response.
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RESPONSE_BYTES) fail('response_limit');
  return JSON.parse(serialized);
}
function array(value, length) {
  requireThat(Array.isArray(value) && value.length <= MAX_NODES
    && (length === undefined || value.length === length));
  return value;
}

function projectDom(snapshot) {
  requireThat(Array.isArray(snapshot.strings) && snapshot.strings.every(v => typeof v === 'string')
    && Array.isArray(snapshot.documents) && snapshot.documents.length > 0);
  const str = index => {
    if (index === -1) return '';
    requireThat(Number.isInteger(index) && index >= 0 && index < snapshot.strings.length);
    return snapshot.strings[index];
  };
  // Deliberately main-document only; child frame targets need their own capture.
  const doc = snapshot.documents[0];
  requireThat(doc && doc.nodes && doc.layout);
  const n = doc.nodes, layout = doc.layout;
  const count = array(n.nodeType).length;
  requireThat(count > 0 && n.nodeType[0] === 9);
  for (const key of ['parentIndex', 'nodeName', 'backendNodeId', 'attributes']) array(n[key], count);
  const layouts = array(layout.nodeIndex).length;
  for (const key of ['styles', 'bounds', 'text']) array(layout[key], layouts);
  const rows = new Map(), backend = new Map();
  for (let i = 0; i < layouts; i++) {
    const index = layout.nodeIndex[i];
    requireThat(Number.isInteger(index) && index >= 0 && index < count);
    const style = layout.styles[i];
    requireThat(Array.isArray(style) && (style.length === 3 || index === 0 && style.length === 0));
    const bounds = layout.bounds[i];
    requireThat(Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite));
    const fragment = { style: style.map(str), text: str(layout.text[i]), bounds };
    // Generated content can have several LayoutObjects for one DOM node.
    if (!rows.has(index)) rows.set(index, { ...fragment, fragments: [] });
    rows.get(index).fragments.push(fragment);
  }
  const info = [];
  let frames = 0;
  for (let i = 0; i < count; i++) {
    const parent = n.parentIndex[i], id = n.backendNodeId[i], tag = str(n.nodeName[i]);
    requireThat(Number.isInteger(parent) && (i === 0 ? parent === -1 : parent >= 0 && parent < i));
    requireThat(Number.isInteger(id) && id > 0 && !backend.has(id));
    const attrs = n.attributes[i];
    requireThat(Array.isArray(attrs) && attrs.length % 2 === 0);
    let editable = false, placeholder = '', type = '';
    for (let a = 0; a < attrs.length; a += 2) {
      const name = str(attrs[a]), value = str(attrs[a + 1]);
      if (name === 'contenteditable' && ['','true','plaintext-only'].includes(value.toLowerCase())) editable = true;
      // The authored hint and the field type only; the control's value is never used.
      else if (name === 'placeholder') placeholder = value;
      else if (name === 'type') type = value.toLowerCase();
    }
    if (tag === 'IFRAME' || tag === 'FRAME') frames++;
    const ancestor = info[parent], row = rows.get(i);
    const blocked = !!ancestor?.blocked || SKIP_TAGS.has(tag) || editable;
    const transparent = !!ancestor?.transparent || row?.style[2] === '0';
    const display = row?.style[0];
    // Inline fragments share a block. Separate blocks are never concatenated.
    const block = n.nodeType[i] === 1 && display && !['inline','contents'].includes(display)
      ? i : ancestor?.block ?? i;
    const controlLabel = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && !ancestor?.blocked && !editable;
    const hint = controlLabel && placeholder.trim()
      && (tag === 'TEXTAREA' || (tag === 'INPUT' && (!type || PLACEHOLDER_INPUT_TYPES.has(type) || !KNOWN_INPUT_TYPES.has(type))))
      ? placeholder : '';
    const entry = { id, parent, tag, blocked, controlLabel, transparent, block, row, hint };
    info.push(entry); backend.set(id, entry);
  }
  const groups = [];
  let current = null;
  for (let i = 0; i < count; i++) {
    const e = info[i], row = e.row;
    if (e.blocked || e.transparent || !row) continue;
    if (e.tag === 'BR') { if (current && row.style[1] === 'visible') current.text += '\n'; continue; }
    for (const fragment of row.fragments) {
      if (fragment.style[1] !== 'visible' || !fragment.text || fragment.bounds[2] <= 0 || fragment.bounds[3] <= 0) continue;
      if (!current || current.node !== info[e.block].id) {
        current = { node: info[e.block].id, channel: 'dom-text', text: '' }; groups.push(current);
      }
      current.text += fragment.text;
    }
  }
  // A text control's authored placeholder, when the control itself is laid out and visible. The
  // accessibility tree drops it once aria-label or a label names the field, and the snapshot has no
  // user-agent shadow tree, so it is read from the attribute. It is shown whenever the field is empty.
  for (const e of info) {
    const row = e.row;
    if (!e.hint || e.transparent || !row || row.style[1] !== 'visible' || row.bounds[2] <= 0 || row.bounds[3] <= 0) continue;
    groups.push({ node: e.id, channel: 'dom-placeholder', text: e.hint, attribute: 'placeholder' });
  }
  return { identity: [str(doc.frameId), n.backendNodeId[0]], backend,
    groups: groups.filter(g => g.text.trim()), frames, nodeCount: count };
}

function projectAx(tree, dom) {
  const nodes = array(tree.nodes);
  requireThat(nodes.length > 0);
  const ids = new Set(), groups = [];
  let rootFound = false, unmapped = 0;
  for (const node of nodes) {
    requireThat(node && typeof node.nodeId === 'string' && typeof node.ignored === 'boolean');
    if (node.role?.value === 'RootWebArea' && node.backendDOMNodeId === dom.identity[1]) rootFound = true;
    // Chromium can repeat InlineTextBox records for generated text. These
    // fragments are excluded; they are not independently accessible copy.
    if (node.ignored || node.role?.value === 'InlineTextBox') continue;
    requireThat(!ids.has(node.nodeId)); ids.add(node.nodeId);
    const e = dom.backend.get(node.backendDOMNodeId);
    if (!e) { unmapped++; continue; }
    // Never read AX value, valueText, inputValue or editable descendants. A
    // control's separately computed accessible label/description is UI copy.
    if (e.blocked && !e.controlLabel) continue;
    for (const key of ['name', 'description']) {
      const value = node[key]?.value;
      if (value === undefined) continue;
      requireThat(typeof value === 'string');
      if (value.trim()) groups.push({ node: e.id, channel: 'ax-' + key, text: value });
    }
  }
  requireThat(rootFound);
  return { groups, unmapped, nodeCount: nodes.length };
}

async function capture(session) {
  const dom = projectDom(await response(session, 'DOMSnapshot.captureSnapshot', { computedStyles: STYLES.slice() }));
  const ax = projectAx(await response(session, 'Accessibility.getFullAXTree', {}), dom);
  // A placeholder the browser already used as the field's accessible name is not collected twice.
  const named = new Set(ax.groups.map(g => g.node + '\n' + g.text));
  const domGroups = dom.groups.filter(g => g.channel !== 'dom-placeholder' || !named.has(g.node + '\n' + g.text));
  return { identity: dom.identity, groups: domGroups.concat(ax.groups),
    coverage: { domNodes: dom.nodeCount, axNodes: ax.nodeCount, childFramesExcluded: dom.frames,
      unmappedAxNodes: ax.unmapped } };
}
function scanGroups(groups, taskKind, maxSurfaces) {
  const batches = [], sources = [], omissions = { surfaceLimit: 0, textLimit: 0, invalidUnicode: 0 };
  let surfaces = [], indexes = [];
  const packet = rows => ({ schema: scanner.INPUT_SCHEMA, policyVersion: scanner.POLICY_VERSION, taskKind, surfaces: rows });
  const flush = () => {
    if (!surfaces.length) return;
    batches.push({ surfaceIndexes: indexes, scan: scanner.scanUiBoundary(JSON.stringify(packet(surfaces))) });
    surfaces = []; indexes = [];
  };
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (sources.length === maxSurfaces) { omissions.surfaceLimit++; continue; }
    if (Buffer.byteLength(group.text, 'utf8') > scanner.MAX_TEXT_BYTES) { omissions.textLimit++; continue; }
    const surface = group.attribute
      ? { kind: 'attribute', exposure: 'rendered', text: group.text, attribute: group.attribute }
      : { kind: 'text', exposure: 'rendered', text: group.text, attribute: null };
    if (Buffer.from(group.text, 'utf8').toString('utf8') !== group.text) { omissions.invalidUnicode++; continue; }
    if (surfaces.length === scanner.MAX_SURFACES
      || Buffer.byteLength(JSON.stringify(packet(surfaces.concat(surface))), 'utf8') > scanner.MAX_INPUT_BYTES) flush();
    indexes.push(sources.length); surfaces.push(surface);
    sources.push({ channel: group.channel, observationIndex: i });
  }
  flush();
  return { batches, sources, omissions };
}

async function scanUiBoundaryBrowser(session, inputJson) {
  const request = input(inputJson);
  const base = { schema: OUTPUT_SCHEMA, policyVersion: scanner.POLICY_VERSION,
    trust: 'host-supplied-cdp-transport', scope: 'main-document-dom-layout-and-ax-copy',
    verification: { browserIdentityVerified: false, sourceVerified: false, semanticVerified: false,
      independentReview: 'not-run', visualCompletenessVerified: false },
    effects: { navigationRequested: false, pageMutationRequested: false, fileWriteRequested: false,
      modelInvocationRequested: false, approvalGranted: false, autoRemove: false } };
  if (request.taskKind === 'non-ui') return { ...base, status: 'not-applicable', captureState: 'not-run', batches: [], sources: [] };
  let send;
  try { send = session?.send; } catch { fail('session_required'); }
  if (typeof send !== 'function') fail('session_required');
  const transport = { send: (method, params) => send.call(session, method, params) };
  try {
    const before = await capture(transport), after = await capture(transport);
    const beforeDigest = hash([OUTPUT_SCHEMA, request.taskKind, before]);
    const afterDigest = hash([OUTPUT_SCHEMA, request.taskKind, after]);
    if (beforeDigest !== afterDigest) return { ...base, status: 'stale', captureState: 'changed-between-samples',
      beforeDigest, afterDigest, batches: [], sources: [] };
    const result = scanGroups(after.groups, request.taskKind, request.maxSurfaces ?? MAX_SURFACES);
    const partial = Object.values(result.omissions).some(Boolean)
      || after.coverage.childFramesExcluded > 0 || after.coverage.unmappedAxNodes > 0;
    return { ...base, status: partial ? 'partial' : 'observed', captureState: 'equal-between-samples',
      observationDigest: afterDigest, coverage: after.coverage, ...result,
      scanStatus: result.batches.some(b => b.scan.findings.length) ? 'findings'
        : result.sources.length ? 'no-pattern-match' : 'no-surfaces' };
  } catch (error) {
    if (error instanceof UiBoundaryBrowserError) throw error;
    fail('response_invalid');
  }
}

module.exports = { scanUiBoundaryBrowser, UiBoundaryBrowserError, INPUT_SCHEMA, OUTPUT_SCHEMA,
  MAX_RESPONSE_BYTES, MAX_NODES, MAX_SURFACES, MAX_REQUESTED_SURFACES };
