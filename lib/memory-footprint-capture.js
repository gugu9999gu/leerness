'use strict';

// Internal call-local capture. Public observers return metadata, never these bytes
// or this recheck closure. A successful recheck is not a reservation or write grant.
const path = require('path');
const { resolveStatePaths } = require('./state-paths');
const { createRuntimeCompatibilityReader } = require('./runtime-layout');
const { captureCheckedFileInput, assertCheckedFileCurrent } = require('./memory-input');
const { resolveMemoryParent, sameResolvedParent } = require('./memory-parent');
const { captureRecoveryInventory } = require('./memory-recovery-inventory');
const CAPS = Object.freeze({ maxFileBytes: 4 * 1024 * 1024, maxTotalFileBytes: 12 * 1024 * 1024,
  maxRecoveryEntries: 10000, maxRecoveryDepth: 64, maxRecoveryBytes: Number.MAX_SAFE_INTEGER });
const CODES = new Set(['limits_invalid','runtime_incompatible','workspace_unavailable','source_changed','runtime_changed',
  'size_unrepresentable','recovery_unsupported','recovery_changed','recovery_entries_exceeded','recovery_depth_exceeded','recovery_bytes_exceeded']);
const INPUT_CODES = new Map([['E_STORE_LIMIT','input_bytes_exceeded'],['E_STORE_CHANGED','source_changed'],
  ['E_STORE_INVALID','input_unsupported'],['E_STORE_UNREADABLE','input_unreadable']]);
const fail = code => { throw Object.assign(new Error(code), { code }); };
function parseFootprintLimits(text) {
  if (typeof text !== 'string' || text.length > 2048 || Buffer.byteLength(text) > 2048) fail('limits_invalid');
  let value; try { value = JSON.parse(text); } catch { fail('limits_invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== Object.keys(CAPS).length
    || !Object.keys(CAPS).every(k => Object.hasOwn(value,k) && Number.isSafeInteger(value[k]) && value[k] >= 0 && value[k] <= CAPS[k])) fail('limits_invalid');
  return value;
}
function footprintErrorCode(error) {
  const code = error && error.code;
  return CODES.has(code) ? code : INPUT_CODES.get(code) || 'observation_failed';
}
function captureMemoryFootprint(root, surface, limitsJson) {
  const limits = parseFootprintLimits(limitsJson);
  const lexicalRoot = path.resolve(root), originalRoot = resolveMemoryParent(lexicalRoot);
  const resolved = resolveStatePaths(lexicalRoot), runtime = createRuntimeCompatibilityReader(lexicalRoot);
  if (!runtime().compatible) fail('runtime_incompatible');
  if (!['live','substrate'].includes(resolved.workspace.status)) fail('workspace_unavailable');
  const workspace = resolved.workspace.selectedPath;
  const observed = [], files = {}, snapshots = {};
  let fileBytes = 0;
  for (const [role, suffix] of [['canonical','.json'],['projection','.md'],['archive','.archive.md']]) {
    const file = path.join(workspace,surface + suffix);
    const input = captureCheckedFileInput(file, { maxBytes: Math.min(limits.maxFileBytes,limits.maxTotalFileBytes - fileBytes) });
    const bytes = input.exists ? input.bytes.length : 0;
    files[role] = { state: input.exists ? 'present' : 'absent', bytes };
    fileBytes += bytes; observed.push({ file, input }); snapshots[role] = input;
  }
  const recovery = captureRecoveryInventory(workspace,limits);
  if (recovery.metadata.bytes > Number.MAX_SAFE_INTEGER - fileBytes) fail('size_unrepresentable');
  return { snapshots, measurement: { files, fileBytes, recovery: recovery.metadata,
    totalPathBytes: fileBytes + recovery.metadata.bytes },
  recheck() {
    const now = resolveStatePaths(lexicalRoot);
    if (!sameResolvedParent(originalRoot,resolveMemoryParent(lexicalRoot))
      || now.projectRoot !== resolved.projectRoot || now.workspace.selectedPath !== workspace
      || now.workspace.status !== resolved.workspace.status) fail('source_changed');
    if (!runtime().compatible || !createRuntimeCompatibilityReader(lexicalRoot)().compatible) fail('runtime_changed');
    for (const record of observed) assertCheckedFileCurrent(record.input,record.file);
    recovery.recheck();
  } };
}

module.exports = { captureMemoryFootprint, parseFootprintLimits, footprintErrorCode };
