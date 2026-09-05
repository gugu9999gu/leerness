'use strict';

// Canonical project-memory directory and the one legacy name that can be
// migrated.  Keeping the policy in this domain module prevents another
// read-one-directory/write-another split brain.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CANONICAL_WORKSPACE_DIR = '.leerness';
const LEGACY_WORKSPACE_DIR = '.harness';
const LEGACY_BACKUP_WORKSPACE_DIR = '.leerness-backup';

// Runtime/session material and recovery copies must never become stageable as
// a side effect of migration. Keep this list shared with fresh init so both
// entry paths establish the same security boundary.
const PROTECTED_GITIGNORE_LINES = Object.freeze([
  '.leerness/skill-publish.local.json',
  '.leerness/**/*.local.json',
  '.leerness/archive/',
  '.leerness/migration-report.md',
  '.leerness/cache/',
  '.leerness-backup/',
  '.leerness/credentials.local.json',
  '.leerness/incidents/',
  '.leerness/cache/agent-sessions/',
  '.leerness/cache/agent-runs/',
]);

const STRONG_MARKERS = new Set([
  'HARNESS_VERSION',
  'manifest.json',
  'guideline.md',
  'progress-tracker.md',
  'session-workflow.md',
]);

// Files that belonged to the pre-existing structured-state substrate.  They
// are legitimate in `.leerness/` before the markdown workspace is migrated.
const SUBSTRATE_TOP_LEVEL = new Set([
  'state.json',
  'state.json.lock',
  'policy.json',
  'runs',
  'handoff',
  'archive',
  // A prior migration may have reached its metadata step before an external
  // interruption. These files identify recoverable canonical substrate; they
  // never make independently live canonical state safe to overwrite.
  'MIGRATED_FROM_HARNESS',
  'WHERE_TO_FIND.md',
  // A normal (non-internal) CLI invocation records per-session runtime state
  // before command dispatch. Migration must not classify its own canonical
  // cache directory as foreign and then block the user from migrating.
  'cache',
]);

class WorkspaceDirectoryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkspaceDirectoryError';
    this.code = code;
    Object.assign(this, details);
  }
}

function _root(root) {
  return path.resolve(root || process.cwd());
}

function _inspectDir(root, name) {
  const abs = path.join(root, name);
  let stat = null;
  let inspectionError = null;
  try { stat = fs.lstatSync(abs); }
  catch (error) { if (error.code !== 'ENOENT') inspectionError = error.code || 'unknown'; }
  const exists = !!stat;
  const isSymbolicLink = !!stat && stat.isSymbolicLink();
  const isDirectory = !!stat && stat.isDirectory() && !stat.isSymbolicLink();
  let entries = [];
  if (isDirectory) {
    try { entries = fs.readdirSync(abs); }
    catch (error) { inspectionError = error.code || 'unknown'; }
  }
  const markers = entries.filter((entry) => STRONG_MARKERS.has(entry));
  const live = markers.length > 0;
  const substrateEntries = name === CANONICAL_WORKSPACE_DIR
    ? entries.filter((entry) => SUBSTRATE_TOP_LEVEL.has(entry))
    : [];
  const nonSubstrateEntries = name === CANONICAL_WORKSPACE_DIR
    ? entries.filter((entry) => !SUBSTRATE_TOP_LEVEL.has(entry))
    : entries.slice();
  const substrateOnly = name === CANONICAL_WORKSPACE_DIR
    && isDirectory && !live && substrateEntries.length > 0 && nonSubstrateEntries.length === 0;
  const foreign = name === CANONICAL_WORKSPACE_DIR
    && exists && (!isDirectory || (!live && nonSubstrateEntries.length > 0));
  return {
    name,
    abs,
    exists,
    isSymbolicLink,
    isDirectory,
    entries,
    markers,
    live,
    substrateOnly,
    substrateEntries,
    nonSubstrateEntries,
    foreign,
    // Existing selection semantics are unchanged. Strict diagnostic consumers
    // can distinguish unreadable metadata from an actually absent/empty store.
    ...(inspectionError ? { inspectionError } : {}),
  };
}

function inspectWorkspace(root) {
  const resolvedRoot = _root(root);
  const legacy = _inspectDir(resolvedRoot, LEGACY_WORKSPACE_DIR);
  const canonical = _inspectDir(resolvedRoot, CANONICAL_WORKSPACE_DIR);
  // Migration markers describe provenance, not authority. Once both stores
  // contain live state, no marker may downgrade the canonical side to a
  // disposable copy.
  const conflict = legacy.live && canonical.live;
  return { root: resolvedRoot, legacy, canonical, conflict };
}

function validateWorkspaceDirName(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (v !== CANONICAL_WORKSPACE_DIR && v !== LEGACY_WORKSPACE_DIR) {
    throw new WorkspaceDirectoryError(
      'E_WORKSPACE_DIR_INVALID',
      `LEERNESS_WORKSPACE_DIR must be ${CANONICAL_WORKSPACE_DIR} or ${LEGACY_WORKSPACE_DIR}; got: ${v}`,
      { value: v },
    );
  }
  return v;
}

// Selection is pure so one read-only operation can reuse its inspection
// snapshot without repeating directory reads. Callers that need a fresh
// filesystem view should keep using resolveWorkspaceDirName below.
function selectWorkspaceDirName(state, envValue) {
  const forced = validateWorkspaceDirName(envValue);
  for (const candidate of [state.legacy, state.canonical]) {
    if (candidate.isSymbolicLink) {
      throw new WorkspaceDirectoryError(
        'E_WORKSPACE_DIR_SYMLINK',
        `workspace directory must not be a symbolic link or junction: ${candidate.abs}`,
        { root: state.root, file: candidate.abs },
      );
    }
    if (candidate.exists && !candidate.isDirectory) {
      throw new WorkspaceDirectoryError(
        'E_WORKSPACE_DIR_INVALID',
        `workspace path is not a directory: ${candidate.abs}`,
        { root: state.root, file: candidate.abs },
      );
    }
  }
  if (state.conflict) {
    throw new WorkspaceDirectoryError(
      'E_WORKSPACE_DIR_CONFLICT',
      `both ${LEGACY_WORKSPACE_DIR} and ${CANONICAL_WORKSPACE_DIR} contain live workspace files`,
      { root: state.root, legacy: state.legacy.abs, canonical: state.canonical.abs },
    );
  }
  if (forced) {
    const selected = forced === CANONICAL_WORKSPACE_DIR ? state.canonical : state.legacy;
    if (selected.exists) return forced;
    throw new WorkspaceDirectoryError(
      'E_WORKSPACE_DIR_MISSING',
      `configured workspace directory does not exist: ${selected.abs}`,
      { root: state.root, value: forced },
    );
  }
  if (state.canonical.live) return CANONICAL_WORKSPACE_DIR;
  if (state.legacy.live) return LEGACY_WORKSPACE_DIR;
  if (state.canonical.exists && !state.canonical.foreign) return CANONICAL_WORKSPACE_DIR;
  if (state.legacy.exists) return LEGACY_WORKSPACE_DIR;
  return CANONICAL_WORKSPACE_DIR;
}

function resolveWorkspaceDirName(root, opts = {}) {
  const state = inspectWorkspace(root);
  const envValue = opts.envValue === undefined ? process.env.LEERNESS_WORKSPACE_DIR : opts.envValue;
  return selectWorkspaceDirName(state, envValue);
}

function workspacePath(root, ...parts) {
  const resolvedRoot = _root(root);
  return path.join(resolvedRoot, resolveWorkspaceDirName(resolvedRoot), ...parts);
}

function workspaceRelative(root, ...parts) {
  return path.posix.join(resolveWorkspaceDirName(root), ...parts.map((p) => String(p).replace(/\\/g, '/')));
}

function canonicalWorkspacePath(root, ...parts) {
  return path.join(_root(root), CANONICAL_WORKSPACE_DIR, ...parts);
}

function legacyWorkspacePath(root, ...parts) {
  return path.join(_root(root), LEGACY_WORKSPACE_DIR, ...parts);
}

function _hashFile(file) {
  const h = crypto.createHash('sha256');
  let body;
  for (let attempt = 0; ; attempt++) {
    try { body = fs.readFileSync(file); break; }
    catch (error) {
      const transient = error && ['EBUSY', 'EPERM', 'EACCES'].includes(error.code);
      if (!transient || attempt >= 20) throw error;
      _sleepSync(25);
    }
  }
  h.update(body);
  return h.digest('hex');
}

function _walkFiles(base) {
  const out = [];
  function visit(rel) {
    const abs = rel ? path.join(base, rel) : base;
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink()) {
      throw new WorkspaceDirectoryError(
        'E_WORKSPACE_DIR_SYMLINK',
        `workspace migration refuses symbolic links/junctions: ${abs}`,
        { file: abs },
      );
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(abs).sort()) visit(rel ? path.join(rel, entry) : entry);
      return;
    }
    if (stat.isFile()) out.push({ rel, abs, size: stat.size, hash: _hashFile(abs) });
  }
  visit('');
  return out;
}

function _mappedRelative(rel) {
  const normalized = rel.replace(/\\/g, '/');
  if (normalized === 'runs' || normalized.startsWith('runs/')) {
    return path.join('cache', 'agent-runs', normalized.slice('runs'.length).replace(/^\//, ''));
  }
  if (normalized === 'agent-sessions' || normalized.startsWith('agent-sessions/')) {
    return path.join('cache', 'agent-sessions', normalized.slice('agent-sessions'.length).replace(/^\//, ''));
  }
  return rel;
}

function _copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function _safeRenameLegacyToBackup(root, source, backup) {
  const resolvedRoot = _root(root);
  const resolvedSource = path.resolve(source);
  const resolvedBackup = path.resolve(backup);
  const allowedSource = path.join(resolvedRoot, LEGACY_WORKSPACE_DIR);
  const allowedBackup = path.join(resolvedRoot, LEGACY_BACKUP_WORKSPACE_DIR);
  if (resolvedSource !== allowedSource || resolvedBackup !== allowedBackup
      || path.dirname(resolvedSource) !== resolvedRoot || path.dirname(resolvedBackup) !== resolvedRoot
      || resolvedRoot === path.parse(resolvedRoot).root) {
    throw new WorkspaceDirectoryError(
      'E_WORKSPACE_DIR_UNSAFE_RENAME',
      `unsafe workspace backup rename: ${resolvedSource} -> ${resolvedBackup}`,
    );
  }
  fs.renameSync(resolvedSource, resolvedBackup);
}

function _safeRemoveCanonicalDir(root, target) {
  const resolvedRoot = _root(root);
  const resolvedTarget = path.resolve(target);
  const allowed = path.join(resolvedRoot, CANONICAL_WORKSPACE_DIR);
  if (resolvedTarget !== allowed || path.dirname(resolvedTarget) !== resolvedRoot || resolvedRoot === path.parse(resolvedRoot).root) {
    throw new WorkspaceDirectoryError('E_WORKSPACE_DIR_UNSAFE_REMOVE', `unsafe canonical rollback target: ${resolvedTarget}`);
  }
  fs.rmSync(resolvedTarget, { recursive: true, force: true });
}

function _rewriteLegacyReference(file) {
  let raw;
  try { raw = fs.readFileSync(file); } catch { return false; }
  if (raw.length > 4 * 1024 * 1024 || raw.includes(0)) return false;
  // Buffer#toString silently replaces malformed byte sequences. Rewriting
  // that text would corrupt CP949/ANSI project notes on Windows, so only
  // canonical UTF-8 text is eligible for an automatic reference rewrite.
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
  catch { return false; }
  const forwardLegacy = LEGACY_WORKSPACE_DIR + '/';
  const backwardLegacy = LEGACY_WORKSPACE_DIR + '\\';
  if (!text.includes(forwardLegacy) && !text.includes(backwardLegacy)) return false;
  const rewritten = text
    .split(forwardLegacy).join(CANONICAL_WORKSPACE_DIR + '/')
    .split(backwardLegacy).join(CANONICAL_WORKSPACE_DIR + '\\');
  fs.writeFileSync(file, rewritten, 'utf8');
  return true;
}

function _lstatMaybe(file) {
  try { return fs.lstatSync(file); } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function _assertNoLinkedPath(root, target) {
  const resolvedRoot = _root(root);
  const resolvedTarget = path.resolve(target);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new WorkspaceDirectoryError('E_WORKSPACE_DIR_UNSAFE_PATH', `integration path escapes project root: ${resolvedTarget}`);
  }
  let current = resolvedRoot;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    const stat = _lstatMaybe(current);
    if (stat && stat.isSymbolicLink()) {
      throw new WorkspaceDirectoryError(
        'E_WORKSPACE_DIR_SYMLINK',
        `workspace migration refuses linked integration path: ${current}`,
        { file: current },
      );
    }
  }
}

function _mergeProtectedGitignore(file) {
  const raw = fs.readFileSync(file);
  if (raw.length > 4 * 1024 * 1024 || raw.includes(0)) {
    throw new WorkspaceDirectoryError(
      'E_WORKSPACE_DIR_INTEGRATION_INVALID',
      `cannot secure migration because .gitignore is not a small text file: ${file}`,
      { file },
    );
  }
  // latin1 preserves every input byte one-for-one while ASCII ignore rules
  // remain searchable. Appending UTF-8 ASCII therefore never transcodes an
  // existing CP949/ANSI file.
  const lines = raw.toString('latin1').split(/\r?\n/).map((line) => line.trim());
  const missing = PROTECTED_GITIGNORE_LINES.filter((line) => !lines.includes(line));
  if (!missing.length) return false;
  const prefix = raw.length === 0 || raw[raw.length - 1] === 0x0a || raw[raw.length - 1] === 0x0d ? '' : '\n';
  fs.writeFileSync(file, Buffer.concat([raw, Buffer.from(`${prefix}${missing.join('\n')}\n`, 'ascii')]));
  return true;
}

function _sleepSync(ms) {
  if (!(ms > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function _isTransientLockFsError(error) {
  return process.platform === 'win32' && !!error
    && ['EPERM', 'EACCES', 'EBUSY'].includes(error.code);
}

function _removeOwnedLockFile(lockFile) {
  const deadline = Date.now() + 2000;
  while (true) {
    try { fs.unlinkSync(lockFile); return; }
    catch (error) {
      if (error && error.code === 'ENOENT') return;
      if (!_isTransientLockFsError(error) || Date.now() >= deadline) return;
      _sleepSync(Math.min(25, Math.max(1, deadline - Date.now())));
    }
  }
}

function _destinationSnapshot(file) {
  if (!fs.existsSync(file)) return { kind: 'missing', hash: null };
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) {
    throw new WorkspaceDirectoryError('E_WORKSPACE_DIR_SYMLINK', `workspace migration refuses symbolic links/junctions: ${file}`, { file });
  }
  if (!stat.isFile()) return { kind: 'other', hash: null };
  return { kind: 'file', hash: _hashFile(file) };
}

function _sameDestinationSnapshot(a, b) {
  return !!a && !!b && a.kind === b.kind && a.hash === b.hash;
}

const _MIGRATION_LOCK_OWNED = Symbol('leerness.workspace-migration-lock-owned');

function _migrationLockWaitMs(opts = {}) {
  const parsed = Number(opts.lockWaitMs);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(60000, parsed)) : 10000;
}

function _newMigrationReport(state, opts = {}) {
  const at = opts.at || new Date().toISOString();
  const version = String(opts.version || 'unknown');
  const dryRun = opts.dryRun === true;
  return {
    at,
    version,
    src: state.legacy.abs,
    dst: state.canonical.abs,
    srcExists: state.legacy.exists,
    dstExists: state.canonical.exists,
    dryRun,
    migrated: false,
    alreadyCanonical: false,
    blocked: false,
    blockedReason: null,
    copiedFiles: [],
    skippedFiles: [],
    overwrittenFiles: [],
    mappedFiles: [],
    rewrittenReferences: [],
    conflicts: [],
    errors: [],
    backupDir: null,
    waitedForLock: false,
    lockWaitedMs: 0,
  };
}

// Live first migrations serialize before the second workspace inspection or
// any destination conflict scan. Acquiring later leaves a TOCTOU window where
// a peer's in-progress canonical copy is mistaken for user-authored conflict.
// Dry-runs and already-canonical roots stay read-only and skip lock creation.
function migrateLegacyWorkspace(root, opts = {}) {
  const initial = inspectWorkspace(root);
  if (opts.dryRun === true || opts[_MIGRATION_LOCK_OWNED] === true || !initial.legacy.exists) {
    return _migrateLegacyWorkspace(initial.root, opts);
  }

  const lockWaitMs = _migrationLockWaitMs(opts);
  const lockFile = path.join(initial.root, '.leerness-workspace-migration.lock');
  const startedAt = Date.now();
  const deadline = startedAt + lockWaitMs;
  let lockFd = null;
  let waited = false;

  while (lockFd === null) {
    try { lockFd = fs.openSync(lockFile, 'wx'); }
    catch (error) {
      if (!error || (error.code !== 'EEXIST' && !_isTransientLockFsError(error))) {
        const report = _newMigrationReport(initial, opts);
        report.blocked = true;
        report.blockedReason = 'workspace-dir-migration-failed';
        report.errors.push(error && error.message ? error.message : String(error));
        report.waitedForLock = waited;
        report.lockWaitedMs = waited ? Math.max(0, Date.now() - startedAt) : 0;
        return report;
      }
      waited = true;
      if (Date.now() >= deadline) {
        const report = _newMigrationReport(initial, opts);
        report.blocked = true;
        report.blockedReason = 'workspace-dir-migration-locked';
        report.errors.push(`another workspace migration still owns: ${lockFile}`);
        report.waitedForLock = true;
        report.lockWaitedMs = Math.max(0, Date.now() - startedAt);
        return report;
      }
      _sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
    }
  }

  try {
    const report = _migrateLegacyWorkspace(initial.root, { ...opts, [_MIGRATION_LOCK_OWNED]: true });
    if (waited) {
      report.waitedForLock = true;
      report.lockWaitedMs = Math.max(report.lockWaitedMs || 0, Date.now() - startedAt);
    }
    return report;
  } finally {
    try { fs.closeSync(lockFd); } catch {}
    _removeOwnedLockFile(lockFile);
  }
}

function _migrateLegacyWorkspace(root, opts = {}) {
  const state = inspectWorkspace(root);
  const dryRun = opts.dryRun === true;
  const migrationLockOwned = opts[_MIGRATION_LOCK_OWNED] === true;
  const force = opts.force === true;
  const version = String(opts.version || 'unknown');
  const at = opts.at || new Date().toISOString();
  const lockWaitMs = _migrationLockWaitMs(opts);
  const lockFile = path.join(state.root, '.leerness-workspace-migration.lock');
  const report = _newMigrationReport(state, opts);

  const block = (reason, message, extra = {}) => {
    report.blocked = true;
    report.blockedReason = reason;
    report.errors.push(message);
    Object.assign(report, extra);
    return report;
  };

  // A peer that already owns the lock may have made canonical temporarily
  // look foreign or dual-live while copying. Observe that transaction before
  // applying any conflict verdict; otherwise simultaneous first handoffs race
  // against an intermediate state and some fail before reaching the lock.
  if (!dryRun && !migrationLockOwned && fs.existsSync(lockFile)) {
    const peerStartedAt = Date.now();
    const peerDeadline = peerStartedAt + lockWaitMs;
    report.waitedForLock = true;
    while (fs.existsSync(lockFile)) {
      const latest = inspectWorkspace(state.root);
      if (!latest.legacy.exists && latest.canonical.exists && !latest.canonical.foreign) {
        report.srcExists = false;
        report.dstExists = true;
        report.alreadyCanonical = true;
        report.backupDir = fs.existsSync(path.join(state.root, LEGACY_BACKUP_WORKSPACE_DIR))
          ? path.join(state.root, LEGACY_BACKUP_WORKSPACE_DIR) : null;
        report.lockWaitedMs = Math.max(0, Date.now() - peerStartedAt);
        return report;
      }
      if (Date.now() >= peerDeadline) {
        report.lockWaitedMs = Math.max(0, Date.now() - peerStartedAt);
        return block('workspace-dir-migration-locked', `another workspace migration still owns: ${lockFile}`);
      }
      _sleepSync(Math.min(50, Math.max(1, peerDeadline - Date.now())));
    }
    // The peer released without completing (normally after rollback). Start a
    // fresh inspection instead of trusting the intermediate snapshot above.
    return migrateLegacyWorkspace(state.root, { ...opts, lockWaitMs: Math.max(0, peerDeadline - Date.now()) });
  }

  // The initial inspection and the lock existence check are not one atomic
  // operation. A peer can finish its migration (including removing the lock)
  // while this process is descheduled between those two reads. Never apply a
  // conflict verdict to that stale snapshot: restart from the completed state.
  if (!dryRun) {
    const refreshed = inspectWorkspace(state.root);
    if (refreshed.legacy.exists !== state.legacy.exists
        || refreshed.canonical.exists !== state.canonical.exists) {
      return migrateLegacyWorkspace(state.root, { ...opts, lockWaitMs });
    }
  }

  if (!state.legacy.exists) {
    if (state.canonical.exists && !state.canonical.foreign) {
      report.alreadyCanonical = true;
      return report;
    }
    return block('legacy-workspace-not-found', `source ${LEGACY_WORKSPACE_DIR} not found`);
  }
  if (!state.legacy.isDirectory) return block('legacy-workspace-invalid', `${state.legacy.abs} is not a real directory`);
  if (state.canonical.exists && !state.canonical.isDirectory) {
    return block(
      state.canonical.isSymbolicLink ? 'canonical-workspace-symlink' : 'canonical-workspace-invalid',
      `${state.canonical.abs} is not a real directory`,
    );
  }
  // Do not recursively scan unrelated canonical runtime/cache files here:
  // active sessions legitimately update them during first migration. Every
  // destination touched below gets a component-by-component link check.
  if (state.canonical.foreign && !force) {
    return block('foreign-canonical-directory', `${state.canonical.abs} contains files not recognized as leerness state substrate`, {
      conflicts: state.canonical.nonSubstrateEntries.slice(),
    });
  }
  if (state.conflict && !force) {
    return block('workspace-dir-conflict', `both workspace directories contain live, independently editable state`);
  }

  const sourceBackup = path.join(state.root, LEGACY_BACKUP_WORKSPACE_DIR);
  if (fs.existsSync(sourceBackup)) {
    return block(
      'workspace-dir-backup-exists',
      `refusing to overwrite existing legacy backup: ${sourceBackup}`,
      { backupDir: sourceBackup },
    );
  }

  let sourceFiles;
  try { sourceFiles = _walkFiles(state.legacy.abs); }
  catch (error) {
    return block(error.code === 'E_WORKSPACE_DIR_SYMLINK' ? 'workspace-dir-symlink' : 'workspace-dir-read-failed', error.message);
  }

  const mapped = sourceFiles.map((item) => ({ ...item, mappedRel: _mappedRelative(item.rel) }));
  const mappedDestinations = new Map();
  for (const item of mapped) {
    const rel = item.mappedRel.replace(/\\/g, '/');
    const key = process.platform === 'win32' ? rel.toLowerCase() : rel;
    if (mappedDestinations.has(key)) {
      return block('workspace-dir-map-collision', `multiple legacy files map to the same canonical path: ${rel}`, {
        conflicts: [mappedDestinations.get(key), item.rel.replace(/\\/g, '/')],
      });
    }
    mappedDestinations.set(key, item.rel.replace(/\\/g, '/'));
  }
  for (const item of mapped) {
    if (item.mappedRel !== item.rel) report.mappedFiles.push({ from: item.rel.replace(/\\/g, '/'), to: item.mappedRel.replace(/\\/g, '/') });
    const dst = path.join(state.canonical.abs, item.mappedRel);
    let snapshot;
    try {
      _assertNoLinkedPath(state.root, dst);
      snapshot = _destinationSnapshot(dst);
    }
    catch (error) {
      return block(error.code === 'E_WORKSPACE_DIR_SYMLINK' ? 'canonical-workspace-symlink' : 'workspace-dir-read-failed', error.message);
    }
    item.destinationSnapshot = snapshot;
    if (snapshot.kind === 'missing') continue;
    if (snapshot.kind !== 'file') {
      report.conflicts.push(item.mappedRel.replace(/\\/g, '/'));
      continue;
    }
    if (snapshot.hash === item.hash) report.skippedFiles.push(item.mappedRel.replace(/\\/g, '/'));
    else report.conflicts.push(item.mappedRel.replace(/\\/g, '/'));
  }
  const unsafeTypeConflict = mapped.some((item) => {
    const dst = path.join(state.canonical.abs, item.mappedRel);
    if (!fs.existsSync(dst)) return false;
    try {
      const stat = fs.lstatSync(dst);
      return !stat.isFile() || stat.isSymbolicLink();
    } catch { return true; }
  });
  if (unsafeTypeConflict) {
    return block('workspace-dir-type-conflict', 'destination contains a non-file or linked path that cannot be overwritten safely');
  }
  if (report.conflicts.length && !force) {
    return block(state.legacy.live && state.canonical.live ? 'workspace-dir-conflict' : 'workspace-dir-file-conflict',
      `destination has ${report.conflicts.length} conflicting file(s)`);
  }

  report.copiedFiles = mapped
    .filter((item) => !report.skippedFiles.includes(item.mappedRel.replace(/\\/g, '/')))
    .map((item) => item.mappedRel.replace(/\\/g, '/'));
  report.overwrittenFiles = report.conflicts.slice();
  if (dryRun) return report;

  const stamp = at.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 96) || String(Date.now());
  const migrationRoot = path.join(state.canonical.abs, 'archive', `workspace-dir-migration-${stamp}`);
  const canonicalBackup = path.join(migrationRoot, 'canonical-before-merge');
  let lockFd = migrationLockOwned ? undefined : null;
  const created = [];
  const overwritten = [];
  const canonicalExisted = state.canonical.exists;
  let legacyRenamed = false;
  try {
    const lockDeadline = Date.now() + lockWaitMs;
    const lockStartedAt = Date.now();
    while (lockFd === null) {
      try { lockFd = fs.openSync(lockFile, 'wx'); }
      catch (error) {
        if (!error || (error.code !== 'EEXIST' && !_isTransientLockFsError(error))) throw error;
        report.waitedForLock = true;
        // A peer may be performing the same first-session migration. Wait for
        // its atomic legacy rename, then converge on the canonical result
        // instead of failing one of the simultaneous handoffs.
        const latest = inspectWorkspace(state.root);
        if (!latest.legacy.exists && latest.canonical.exists && !latest.canonical.foreign) {
          report.srcExists = false;
          report.dstExists = true;
          report.alreadyCanonical = true;
          report.backupDir = fs.existsSync(sourceBackup) ? sourceBackup : null;
          report.lockWaitedMs = Math.max(0, Date.now() - lockStartedAt);
          return report;
        }
        if (Date.now() >= lockDeadline) {
          throw new WorkspaceDirectoryError('E_WORKSPACE_DIR_LOCKED', `another workspace migration still owns: ${lockFile}`);
        }
        _sleepSync(Math.min(50, Math.max(1, lockDeadline - Date.now())));
      }
    }
    if (report.waitedForLock) report.lockWaitedMs = Math.max(0, Date.now() - lockStartedAt);
    // The previous owner can finish between our last EEXIST observation and
    // this successful open. Re-inspect under ownership before applying the
    // pre-lock source/backup snapshot.
    const postLockState = inspectWorkspace(state.root);
    if (!postLockState.legacy.exists && postLockState.canonical.exists && !postLockState.canonical.foreign) {
      report.srcExists = false;
      report.dstExists = true;
      report.alreadyCanonical = true;
      report.backupDir = fs.existsSync(sourceBackup) ? sourceBackup : null;
      return report;
    }
    // Recheck after acquiring the lock. A pre-existing backup is recovery data,
    // never a destination that migration may merge into or overwrite.
    if (fs.existsSync(sourceBackup)) {
      throw new WorkspaceDirectoryError(
        'E_WORKSPACE_DIR_BACKUP_EXISTS',
        `refusing to overwrite existing legacy backup: ${sourceBackup}`,
      );
    }
    fs.mkdirSync(migrationRoot, { recursive: true });

    for (const item of mapped) {
      const dst = path.join(state.canonical.abs, item.mappedRel);
      const currentSnapshot = _destinationSnapshot(dst);
      if (!_sameDestinationSnapshot(item.destinationSnapshot, currentSnapshot)) {
        throw new WorkspaceDirectoryError('E_WORKSPACE_DIR_CHANGED', `${CANONICAL_WORKSPACE_DIR} changed during migration: ${item.mappedRel}`);
      }
      if (currentSnapshot.kind === 'file') {
        if (currentSnapshot.hash === item.hash) continue;
        const backup = path.join(canonicalBackup, item.mappedRel);
        _copyFile(dst, backup);
        if (_hashFile(backup) !== currentSnapshot.hash) throw new Error(`canonical backup verification failed: ${item.mappedRel}`);
        overwritten.push({ dst, backup });
      } else {
        created.push(dst);
      }
      _copyFile(item.abs, dst);
      if (_hashFile(dst) !== item.hash) throw new Error(`verification failed after copy: ${item.mappedRel}`);
    }

    // A writer that ignored the migration lock must not be silently discarded.
    const after = _walkFiles(state.legacy.abs);
    const beforeSig = sourceFiles.map((x) => `${x.rel}\0${x.hash}`).join('\n');
    const afterSig = after.map((x) => `${x.rel}\0${x.hash}`).join('\n');
    if (beforeSig !== afterSig) throw new WorkspaceDirectoryError('E_WORKSPACE_DIR_CHANGED', `${LEGACY_WORKSPACE_DIR} changed during migration`);

    // Rewrite only files that are part of the migrated workspace plus a small,
    // explicit set of leerness integration files at the project root.  The
    // source backup remains byte-for-byte legacy data for recovery.
    for (const item of mapped) {
      const dst = path.join(state.canonical.abs, item.mappedRel);
      if (_rewriteLegacyReference(dst)) report.rewrittenReferences.push(path.relative(state.root, dst).replace(/\\/g, '/'));
    }
    const integrationFiles = [
      'AGENTS.md', 'CLAUDE.md', 'README.md', 'README.ko.md', '.gitignore', '.env.example',
      path.join('.cursor', 'rules', 'leerness.mdc'),
      path.join('.github', 'copilot-instructions.md'),
      path.join('.codex', 'AGENTS.md'),
      'GEMINI.md', '.windsurfrules',
    ];
    for (const rel of integrationFiles) {
      const file = path.join(state.root, rel);
      const isGitignore = rel === '.gitignore';
      _assertNoLinkedPath(state.root, file);
      const integrationStat = _lstatMaybe(file);
      if (!integrationStat) {
        if (isGitignore) {
          fs.writeFileSync(file, `${PROTECTED_GITIGNORE_LINES.join('\n')}\n`, 'utf8');
          created.push(file);
          report.rewrittenReferences.push(rel);
        }
        continue;
      }
      if (!integrationStat.isFile()) {
        if (isGitignore) {
          throw new WorkspaceDirectoryError(
            'E_WORKSPACE_DIR_INTEGRATION_INVALID',
            `cannot secure legacy backup because .gitignore is not a regular file: ${file}`,
            { file },
          );
        }
        continue;
      }
      const raw = fs.readFileSync(file);
      const asciiView = raw.toString('latin1');
      const missingGitignoreProtection = isGitignore
        && PROTECTED_GITIGNORE_LINES.some((line) => !asciiView.split(/\r?\n/).map((entry) => entry.trim()).includes(line));
      if (!asciiView.includes(LEGACY_WORKSPACE_DIR) && !missingGitignoreProtection) continue;
      const backup = path.join(migrationRoot, 'root-integrations-before', rel);
      _copyFile(file, backup);
      overwritten.push({ dst: file, backup });
      let rewritten = _rewriteLegacyReference(file);
      if (isGitignore && _mergeProtectedGitignore(file)) rewritten = true;
      if (rewritten) report.rewrittenReferences.push(rel.replace(/\\/g, '/'));
    }

    const safeVersion = version.replace(/[\r\n]+/g, ' ').slice(0, 80);
    const marker = `Migrated from ${LEGACY_WORKSPACE_DIR} at ${at.replace(/[\r\n]+/g, ' ')} by leerness ${safeVersion}\n`;
    const markerPath = path.join(state.canonical.abs, 'MIGRATED_FROM_HARNESS');
    fs.mkdirSync(state.canonical.abs, { recursive: true });
    if (fs.existsSync(markerPath)) {
      const backup = path.join(canonicalBackup, 'MIGRATED_FROM_HARNESS');
      _copyFile(markerPath, backup);
      overwritten.push({ dst: markerPath, backup });
    }
    fs.writeFileSync(markerPath, marker, 'utf8');
    if (!state.canonical.entries.includes('MIGRATED_FROM_HARNESS')) created.push(markerPath);
    if (typeof opts.referenceGuide === 'string' && opts.referenceGuide) {
      const guidePath = path.join(state.canonical.abs, 'WHERE_TO_FIND.md');
      if (fs.existsSync(guidePath)) {
        const backup = path.join(canonicalBackup, 'WHERE_TO_FIND.md');
        _copyFile(guidePath, backup);
        overwritten.push({ dst: guidePath, backup });
      } else created.push(guidePath);
      fs.writeFileSync(guidePath, opts.referenceGuide, 'utf8');
    }
    fs.writeFileSync(path.join(migrationRoot, 'migration-report.json'), JSON.stringify({
      at,
      version,
      sourceFiles: sourceFiles.length,
      copiedFiles: report.copiedFiles,
      skippedFiles: report.skippedFiles,
      overwrittenFiles: report.overwrittenFiles,
      mappedFiles: report.mappedFiles,
      rewrittenReferences: report.rewrittenReferences,
    }, null, 2) + '\n', 'utf8');

    // This is deliberately the final mutating operation. Keeping `.harness/`
    // untouched until now makes every earlier failure rollback-safe, while an
    // atomic same-root rename avoids recursive archive nesting and Windows path
    // growth. No operation after this point can invalidate the backup.
    _safeRenameLegacyToBackup(state.root, state.legacy.abs, sourceBackup);
    legacyRenamed = true;
    report.backupDir = sourceBackup;
    report.migrated = true;
    return report;
  } catch (error) {
    report.errors.push(error.message);
    report.blocked = true;
    report.blockedReason = (error.code === 'EEXIST' || error.code === 'E_WORKSPACE_DIR_LOCKED') ? 'workspace-dir-migration-locked'
      : error.code === 'E_WORKSPACE_DIR_BACKUP_EXISTS' ? 'workspace-dir-backup-exists'
      : error.code === 'E_WORKSPACE_DIR_INTEGRATION_INVALID' ? 'workspace-dir-integration-invalid'
        : error.code === 'E_WORKSPACE_DIR_SYMLINK' ? 'workspace-dir-symlink'
      : error.code === 'E_WORKSPACE_DIR_CHANGED' ? 'workspace-dir-changed-during-migration'
        : 'workspace-dir-migration-failed';
    // Roll back destination files while the untouched legacy source remains.
    try {
      if (legacyRenamed && !fs.existsSync(state.legacy.abs) && fs.existsSync(sourceBackup)) {
        fs.renameSync(sourceBackup, state.legacy.abs);
        legacyRenamed = false;
      }
      for (const item of overwritten.reverse()) _copyFile(item.backup, item.dst);
      for (const file of created.reverse()) if (fs.existsSync(file)) fs.rmSync(file, { force: true });
      if (!canonicalExisted && fs.existsSync(state.canonical.abs)) _safeRemoveCanonicalDir(state.root, state.canonical.abs);
    } catch (rollbackError) {
      report.errors.push(`rollback failed: ${rollbackError.message}`);
    }
    return report;
  } finally {
    if (!migrationLockOwned && lockFd !== null) {
      try { fs.closeSync(lockFd); } catch {}
      _removeOwnedLockFile(lockFile);
    }
  }
}

module.exports = {
  CANONICAL_WORKSPACE_DIR,
  LEGACY_WORKSPACE_DIR,
  LEGACY_BACKUP_WORKSPACE_DIR,
  PROTECTED_GITIGNORE_LINES,
  WorkspaceDirectoryError,
  inspectWorkspace,
  selectWorkspaceDirName,
  validateWorkspaceDirName,
  resolveWorkspaceDirName,
  workspacePath,
  workspaceRelative,
  canonicalWorkspacePath,
  legacyWorkspacePath,
  migrateLegacyWorkspace: require('./runtime-writes').projectWriter(migrateLegacyWorkspace),
};
