'use strict';

const path = require('path');
const crypto = require('crypto');
const { resolveStatePaths } = require('./state-paths');
const { CANONICAL_WORKSPACE_DIR } = require('./workspace-dir');
const { withRuntimeWrites } = require('./runtime-writes');
const { prepareBundle, loadBundle, hasReceipt } = require('./memory-migration-bundle');
const { activeFiles, applyBundle, rollbackBundle } = require('./memory-migration-execute');
const { OPERATION_ID, fail } = require('./memory-migration-material');
const { attachMemoryRecovery } = require('./memory-recovery');
const { resolveMemoryParent, sameResolvedParent } = require('./memory-parent');
const SCHEMA = 'leerness.memory-migration-write/v1';
function response(state, ok, error = null) {
  return { schema: SCHEMA, schemaVersion: 1, ok, action: state.action, surface: state.surface,
    operationId: state.operationId, stage: state.stage,
    status: ok ? state.stage : state.activeMutationStarted ? 'partial' : 'rejected',
    retentionVerified: state.retentionVerified, retentionMayExist: state.retentionMayExist,
    activeMutationStarted: state.activeMutationStarted,
    atomic: false, automaticRollback: false, crashDurability: 'unverified', semanticCoverage: 'unknown',
    retentionDirectory: state.retentionDirectory || null,
    retainedCanonical: state.retainedCanonical && state.projectRoot
      ? path.relative(state.projectRoot, state.retainedCanonical).replace(/\\/g, '/') : null,
    recoveryReceipt: state.recoveryReceipt || null, error: error ? { code: error } : null };
}
function runMigration(root, action, surface, operationId, dependencies) {
  const state = { action: ['prepare', 'apply', 'rollback'].includes(action) ? action : null,
    surface: ['decisions', 'lessons'].includes(surface) ? surface : null,
    operationId: typeof operationId === 'string' && OPERATION_ID.test(operationId) ? operationId : null, stage: 'admission',
    retentionVerified: false, retentionMayExist: false, activeMutationStarted: false };
  let canonicalRoot = null, beforeStates = null;
  try {
    if (!['prepare', 'apply', 'rollback'].includes(action) || !['decisions', 'lessons'].includes(surface)
      || (action === 'prepare' ? operationId != null : typeof operationId !== 'string' || !OPERATION_ID.test(operationId))
      || typeof root !== 'string' || !root || typeof dependencies?.withLock !== 'function'
      || typeof dependencies?.authorize !== 'function') fail('migration_arguments_invalid');
    const resolved = resolveStatePaths(root);
    canonicalRoot = resolved.projectRoot;
    state.projectRoot = canonicalRoot;
    const lexicalRoot = path.resolve(root);
    const checkRequest = () => {
      if (!sameResolvedParent(resolveMemoryParent(lexicalRoot), canonicalRoot)) fail('migration_project_changed');
    };
    checkRequest();
    if (resolved.workspace.selectedName !== CANONICAL_WORKSPACE_DIR || resolved.workspace.status === 'absent') {
      fail('migration_canonical_workspace_required');
    }
    if (!dependencies.authorize(canonicalRoot)) fail('migration_policy_denied');
    if (action === 'prepare') state.operationId = crypto.randomBytes(16).toString('hex');
    const workspace = resolved.workspace.selectedPath;
    state.retentionDirectory = path.relative(canonicalRoot, path.join(workspace, 'archive', 'memory-migrations', state.operationId)).replace(/\\/g, '/');
    return withRuntimeWrites(canonicalRoot, () => dependencies.withLock(path.join(workspace, surface + '.json'), () => {
      try {
        checkRequest();
        if (action === 'prepare') prepareBundle(workspace, surface, state.operationId, state, checkRequest);
        else {
          const bundle = loadBundle(workspace, surface, state.operationId, checkRequest);
          if (!hasReceipt(bundle, 'prepared.json', 'prepared')) fail('migration_not_prepared');
          state.retentionMayExist = true; state.retentionVerified = true; state.stage = 'prepared';
          beforeStates = Object.entries(activeFiles(workspace, surface)).map(([role, row]) => ({
            role, file: row.file, exists: row.input.exists, kind: row.input.exists ? 'file' : 'missing', bytes: row.input.bytes }));
          if (action === 'apply') applyBundle(workspace, surface, bundle, state);
          else rollbackBundle(workspace, surface, bundle, state);
        }
        return response(state, true);
      } catch (error) {
        if (state.activeMutationStarted && beforeStates) {
          attachMemoryRecovery(error, canonicalRoot, { surface, operation: action, stage: state.stage }, beforeStates);
          state.recoveryReceipt = error.memoryRecoveryReceipt || null;
        }
        throw error;
      }
    }));
  } catch (error) {
    // No filesystem or parser exception text is exposed. Runtime/lock errors
    // remain failures even if the domain completed before lock release failed.
    const original = error.causeCode || error.code;
    const code = typeof original === 'string' && /^migration_[a-z_]+$/.test(original)
      ? original : original === 'E_RUNTIME_LAYOUT_INCOMPATIBLE' ? 'migration_runtime_incompatible' : 'migration_operation_failed';
    return response(state, false, code);
  }
}
module.exports = { SCHEMA, response, runMigration };
