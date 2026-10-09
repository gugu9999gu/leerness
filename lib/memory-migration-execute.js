'use strict';

const path = require('path');
const { captureCheckedFileInput, assertCheckedFileCurrent, describeCheckedFileInput } = require('./memory-input');
const { captureMemoryOutput, publishMemoryOutput } = require('./memory-output');
const { fail, describeBytes } = require('./memory-migration-material');
const { receipt, hasReceipt, OUTPUT_LIMIT } = require('./memory-migration-bundle');
const { readArtifact, createArtifact } = require('./memory-migration-storage');
const { withdrawCanonical } = require('./memory-migration-withdraw');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

function activeFiles(workspace, surface) {
  return Object.fromEntries(['canonical', 'projection'].map((role, index) => {
    const file = path.join(workspace, surface + (index ? '.md' : '.json'));
    return [role, { file, input: captureCheckedFileInput(file, { maxBytes: OUTPUT_LIMIT }) }];
  }));
}
function matches(row, bytes) { return row.input.exists && row.input.bytes.equals(bytes); }
function assertActive(rows) {
  for (const row of Object.values(rows)) assertCheckedFileCurrent(row.input, row.file);
}
function canonicalRecord(bundle, row, create = false) {
  const expected = json({ schemaVersion: 1, operationId: bundle.manifest.operationId,
    bytes: describeBytes(row.input.bytes), identity: describeCheckedFileInput(row.input, row.file) });
  if (create) return createArtifact(bundle.storage, 'canonical-created.json', expected);
  const record = readArtifact(bundle.storage, 'canonical-created.json', 16384);
  if (!record.bytes.equals(expected)) fail('migration_canonical_ownership_changed');
  return record;
}
function applyBundle(workspace, surface, bundle, state) {
  if (hasReceipt(bundle, 'rolled-back.json', 'rolled-back')) fail('migration_already_rolled_back');
  let rows = activeFiles(workspace, surface);
  const before = matches(rows.projection, bundle.output.raw), after = matches(rows.projection, bundle.output.projection);
  if (!before && !after) fail('migration_source_changed');
  if (!rows.canonical.input.exists) {
    if (!before || JSON.stringify(describeCheckedFileInput(rows.projection.input, rows.projection.file))
      !== JSON.stringify(bundle.manifest.sourceIdentity)) fail('migration_source_changed');
    bundle.check(); assertActive(rows);
    const token = captureMemoryOutput(rows.canonical.file);
    bundle.check(); assertActive(rows); state.activeMutationStarted = true; state.stage = 'canonical-publication';
    publishMemoryOutput(token, rows.canonical.file, bundle.output.canonical);
    rows = activeFiles(workspace, surface);
    if (!matches(rows.canonical, bundle.output.canonical)) fail('migration_canonical_changed');
    canonicalRecord(bundle, rows.canonical, true);
  } else {
    if (!matches(rows.canonical, bundle.output.canonical)) fail('migration_canonical_changed');
    canonicalRecord(bundle, rows.canonical).check();
  }
  state.stage = 'canonical-created';
  if (matches(rows.projection, bundle.output.raw)) {
    // Verify the same originally observed source even when resuming after the
    // canonical step. Matching text alone does not accept an intervening edit.
    if (JSON.stringify(describeCheckedFileInput(rows.projection.input, rows.projection.file))
      !== JSON.stringify(bundle.manifest.sourceIdentity)) fail('migration_source_changed');
    const token = captureMemoryOutput(rows.projection.file);
    bundle.check(); assertActive(rows); state.activeMutationStarted = true; state.stage = 'projection-publication';
    publishMemoryOutput(token, rows.projection.file, bundle.output.projection);
  } else if (!matches(rows.projection, bundle.output.projection)) fail('migration_source_changed');
  rows = activeFiles(workspace, surface);
  if (!matches(rows.canonical, bundle.output.canonical) || !matches(rows.projection, bundle.output.projection)) fail('migration_result_changed');
  canonicalRecord(bundle, rows.canonical).check(); bundle.check(); assertActive(rows);
  state.stage = 'outputs-applied';
  if (!hasReceipt(bundle, 'applied.json', 'applied')) receipt(bundle, 'applied.json', 'applied');
  bundle.check(); assertActive(rows); state.stage = 'applied';
}
function rollbackBundle(workspace, surface, bundle, state) {
  let rows = activeFiles(workspace, surface);
  const sourceBefore = matches(rows.projection, bundle.output.raw), sourceAfter = matches(rows.projection, bundle.output.projection);
  if (!sourceBefore && !sourceAfter) fail('migration_source_changed');
  if (rows.canonical.input.exists) {
    if (!matches(rows.canonical, bundle.output.canonical)) fail('migration_canonical_changed');
    canonicalRecord(bundle, rows.canonical).check();
  } else if (!sourceBefore && !hasReceipt(bundle, 'applied.json', 'applied')) fail('migration_result_unattributed');
  bundle.check(); assertActive(rows);
  if (sourceAfter) {
    const token = captureMemoryOutput(rows.projection.file);
    bundle.check(); assertActive(rows); state.activeMutationStarted = true; state.stage = 'source-restoration';
    publishMemoryOutput(token, rows.projection.file, bundle.output.raw);
  }
  rows = activeFiles(workspace, surface);
  if (!matches(rows.projection, bundle.output.raw)) fail('migration_source_changed');
  if (rows.canonical.input.exists) {
    canonicalRecord(bundle, rows.canonical).check(); bundle.check(); assertActive(rows);
    state.activeMutationStarted = true; state.stage = 'canonical-withdrawal';
    const result = withdrawCanonical(rows.canonical.file, bundle.output.canonical, bundle.storage);
    state.retainedCanonical = result.retainedCanonical;
  }
  rows = activeFiles(workspace, surface);
  if (rows.canonical.input.exists || !matches(rows.projection, bundle.output.raw)) fail('migration_rollback_changed');
  bundle.check(); assertActive(rows); state.stage = 'source-restored';
  if (!hasReceipt(bundle, 'rolled-back.json', 'rolled-back')) receipt(bundle, 'rolled-back.json', 'rolled-back');
  bundle.check(); assertActive(rows); state.stage = 'rolled-back';
}
module.exports = { activeFiles, applyBundle, rollbackBundle };
