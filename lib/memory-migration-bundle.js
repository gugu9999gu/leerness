'use strict';

const path = require('path');
const { captureCheckedFileInput, assertCheckedFileCurrent, describeCheckedFileInput } = require('./memory-input');
const { material, describeBytes, fail } = require('./memory-migration-material');
const { openStorage, readArtifact, createArtifact } = require('./memory-migration-storage');
const INPUT_LIMIT = 1024 * 1024, OUTPUT_LIMIT = 4 * INPUT_LIMIT;
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function prepareBundle(workspace, surface, operationId, state, checkRequest = () => {}) {
  checkRequest();
  const canonicalFile = path.join(workspace, surface + '.json'), sourceFile = path.join(workspace, surface + '.md');
  const canonical = captureCheckedFileInput(canonicalFile, { maxBytes: INPUT_LIMIT });
  if (canonical.exists) fail('migration_canonical_present');
  const source = captureCheckedFileInput(sourceFile, { maxBytes: INPUT_LIMIT });
  if (!source.exists) fail('migration_source_missing');
  const output = material(surface, operationId, source.bytes);
  const manifest = { schema: 'leerness.memory-migration-bundle/v1', schemaVersion: 1,
    formatVersion: 1, operationId, surface, canonicalBefore: null,
    sourceIdentity: describeCheckedFileInput(source, sourceFile),
    source: describeBytes(output.raw), canonical: describeBytes(output.canonical), projection: describeBytes(output.projection),
    semanticCoverage: 'unknown' };
  if (jsonBytes(manifest).length > 16384) fail('migration_manifest_budget');
  const current = () => { checkRequest(); assertCheckedFileCurrent(canonical, canonicalFile); assertCheckedFileCurrent(source, sourceFile); };
  current(); state.retentionMayExist = true;
  const storage = openStorage(workspace, operationId, true, checkRequest);
  state.stage = 'retention-started';
  for (const [name, bytes] of [['source.md', output.raw], ['canonical.json', output.canonical],
    ['projection.md', output.projection], ['manifest.json', jsonBytes(manifest)]]) {
    current(); createArtifact(storage, name, bytes);
  }
  const bundle = loadBundle(workspace, surface, operationId, checkRequest);
  bundle.check(); current();
  receipt(bundle, 'prepared.json', 'prepared');
  bundle.check(); current(); state.retentionVerified = true; state.stage = 'prepared';
  return bundle;
}
function loadBundle(workspace, surface, operationId, checkRequest = () => {}) {
  const storage = openStorage(workspace, operationId, false, checkRequest);
  const artifacts = [readArtifact(storage, 'manifest.json', 16384), readArtifact(storage, 'source.md', INPUT_LIMIT),
    readArtifact(storage, 'canonical.json', OUTPUT_LIMIT), readArtifact(storage, 'projection.md', OUTPUT_LIMIT)];
  let manifest;
  try { manifest = JSON.parse(artifacts[0].bytes.toString('utf8')); } catch { fail('migration_manifest_invalid'); }
  const output = material(surface, operationId, artifacts[1].bytes);
  const expected = { schema: 'leerness.memory-migration-bundle/v1', schemaVersion: 1, formatVersion: 1,
    operationId, surface, canonicalBefore: null, sourceIdentity: manifest && manifest.sourceIdentity,
    source: describeBytes(output.raw), canonical: describeBytes(output.canonical), projection: describeBytes(output.projection), semanticCoverage: 'unknown' };
  if (JSON.stringify(manifest) !== JSON.stringify(expected) || !manifest.sourceIdentity
    || !artifacts[2].bytes.equals(output.canonical) || !artifacts[3].bytes.equals(output.projection)) fail('migration_bundle_invalid');
  return { storage, manifest, output, check: () => artifacts.forEach(artifact => artifact.check()) };
}
function receipt(bundle, name, stage) {
  bundle.check();
  createArtifact(bundle.storage, name, jsonBytes({ schemaVersion: 1, operationId: bundle.manifest.operationId,
    stage, source: bundle.manifest.source.sha256, canonical: bundle.manifest.canonical.sha256, projection: bundle.manifest.projection.sha256 }));
}
function hasReceipt(bundle, name, stage) {
  const file = path.join(bundle.storage.dir, name);
  const input = captureCheckedFileInput(file, { maxBytes: 16384 });
  if (!input.exists) return false;
  const expected = jsonBytes({ schemaVersion: 1, operationId: bundle.manifest.operationId,
    stage, source: bundle.manifest.source.sha256, canonical: bundle.manifest.canonical.sha256, projection: bundle.manifest.projection.sha256 });
  if (!input.bytes.equals(expected)) fail('migration_receipt_invalid');
  assertCheckedFileCurrent(input, file); return true;
}
module.exports = { INPUT_LIMIT, OUTPUT_LIMIT, prepareBundle, loadBundle, receipt, hasReceipt };
