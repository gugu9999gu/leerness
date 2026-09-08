'use strict';

const { resolveStatePaths } = require('./state-paths');
const { readStoreFile, MAX_BYTES } = require('./store-diagnostic-read');
const { validateLegacyRoleStore } = require('./role-agent-schema');
const { validateRoleDefinitionShape } = require('./role-fallback');
const { _decisionsFromMd, _parseLessonEntries } = require('./pure-utils');

const observeCanonical = (workspace, name, file) => {
  const read = readStoreFile(workspace, file);
  const result = { status: read.status, reasonCode: read.reasonCode, bytesRead: read.bytesRead,
    syntaxValid: null, shapeValid: null, itemsValid: null };
  if (read.status !== 'valid') return { canonical: result, count: null };
  let document;
  try { document = JSON.parse(read.text); result.syntaxValid = true; }
  catch {
    return { canonical: { ...result, status: 'invalid_json', reasonCode: 'json_syntax', syntaxValid: false }, count: null };
  }
  if (name !== 'roles') {
    const valid = Array.isArray(document);
    return { canonical: { ...result, shapeValid: valid,
      status: valid ? 'valid' : 'invalid_shape', reasonCode: valid ? 'array_valid_items_unchecked' : 'array_required' },
    count: valid ? document.length : null };
  }
  const shape = validateLegacyRoleStore(document);
  const extended = shape.ok && Object.entries(document.roles).every(([role, value]) =>
    validateRoleDefinitionShape(role, value, { allowLegacyProviderIds: true }).ok);
  return { canonical: { ...result, shapeValid: shape.ok, itemsValid: shape.ok ? extended : null,
    status: shape.ok && extended ? 'valid' : 'invalid_shape', reasonCode: shape.ok && extended ? 'role_schema_valid' : 'role_schema_invalid' },
  count: shape.ok && extended ? Object.keys(document.roles).length : null };
};

const observeStore = (workspace, name, file) => {
  const { canonical, count } = observeCanonical(workspace, name, file);
  const row = { name, file, canonical, effectiveSource: canonical.status === 'valid' ? 'canonical' : 'none',
    itemCount: count, fallback: { attempted: false, used: false, status: 'not_attempted' } };
  if (name === 'roles' || !['missing', 'invalid_json', 'invalid_shape'].includes(canonical.status)) return row;
  const fallback = readStoreFile(workspace, `${name}.md`);
  row.fallback = { attempted: true, used: false, status: fallback.status,
    reasonCode: fallback.reasonCode, bytesRead: fallback.bytesRead };
  if (fallback.status !== 'valid') return row;
  try {
    const entries = (name === 'decisions' ? _decisionsFromMd : _parseLessonEntries)(fallback.text);
    row.itemCount = entries.length;
    row.effectiveSource = 'legacy_markdown';
    row.fallback.used = true;
  } catch {
    row.fallback.status = 'unknown';
    row.fallback.reasonCode = 'markdown_parse_failed';
  }
  return row;
};

const inspectStores = (root, options = {}) => {
  const resolved = resolveStatePaths(root, options);
  const workspace = resolved.workspace.selectedPath;
  const stores = [['decisions', 'decisions.json'], ['lessons', 'lessons.json'], ['roles', 'agent-roles.json']]
    .map(([name, file]) => observeStore(workspace, name, file));
  const ok = stores.every(row => ['valid', 'missing'].includes(row.canonical.status)
    && ['not_attempted', 'valid', 'missing'].includes(row.fallback.status));
  return { schema: 'leerness.store-diagnostics/v1', schemaVersion: 1, ok,
    projectRoot: resolved.projectRoot, workspace, readOnly: true, writesPerformed: false,
    runtimeActivated: false, migrationAvailable: false, maxBytesPerFile: MAX_BYTES,
    coverage: { stores: stores.length, recursive: false, memoryItemsValidated: false },
    warnings: resolved.warnings, stores };
};

const formatStoreDiagnostics = report => [
  'Leerness store diagnostics (read-only; no migration)',
  ...report.stores.map(row => `${row.name}: ${row.canonical.status} (${row.canonical.reasonCode}); source=${row.effectiveSource}; fallback=${row.fallback.status}`),
  'Memory arrays are not item/schema validation. A diagnostic is not writer admission.',
].join('\n');

module.exports = { inspectStores, formatStoreDiagnostics };
