'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { writeUtf8 } = require('./io');
const { isValidKey } = require('./session-presence');

const SCHEMA_VERSION = 1;
const STORE_REL = Object.freeze(['.leerness', 'cache', 'file-leases.json']);
const DEFAULT_TTL_SECONDS = 300;
const MIN_TTL_SECONDS = 30;
const MAX_TTL_SECONDS = 1800;
const MAX_STORE_BYTES = 1024 * 1024;
const MAX_LEASES = 1000;
const LEASE_ID_RE = /^lease-[0-9a-f]{16}$/;
const IDENTITY_RE = /^fs:[0-9]+:[0-9]+$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const WINDOWS_DEVICE_RE = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/i;

class LeaseError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'LeaseError';
    this.code = code;
    this.details = details;
  }
}

function _fail(code, message, details) {
  throw new LeaseError(code, message, details);
}

function _isInside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}

function _realpath(value) {
  return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
}

function _rootContext(root) {
  const lexicalRoot = path.resolve(String(root || process.cwd()));
  let stat;
  try { stat = fs.statSync(lexicalRoot); }
  catch (error) { _fail('project_unavailable', 'Project root is unavailable.', { error: error && error.code || 'ENOENT' }); }
  if (!stat.isDirectory()) _fail('project_not_directory', 'Project root is not a directory.');
  let realRoot;
  try { realRoot = _realpath(lexicalRoot); }
  catch (error) { _fail('project_unavailable', 'Project root cannot be resolved.', { error: error && error.code || 'EREALPATH' }); }
  return { lexicalRoot, realRoot };
}

function _safeExistingDirectory(rootContext, lexicalDir, missingCode, invalidCode) {
  let lst;
  try { lst = fs.lstatSync(lexicalDir); }
  catch (error) {
    if (error && error.code === 'ENOENT') _fail(missingCode, 'Required project directory is missing.');
    _fail(invalidCode, 'Required project directory cannot be inspected.', { error: error && error.code || 'ELSTAT' });
  }
  let realDir;
  try { realDir = _realpath(lexicalDir); }
  catch (error) { _fail(invalidCode, 'Required project directory cannot be resolved.', { error: error && error.code || 'EREALPATH' }); }
  let stat;
  try { stat = fs.statSync(realDir); }
  catch (error) { _fail(invalidCode, 'Required project directory cannot be inspected.', { error: error && error.code || 'ESTAT' }); }
  if (!lst.isDirectory() && !lst.isSymbolicLink()) _fail(invalidCode, 'Required project path is not a directory.');
  if (!stat.isDirectory()) _fail(invalidCode, 'Required project path does not resolve to a directory.');
  if (!_isInside(rootContext.realRoot, realDir)) _fail('path_escape', 'Required project directory resolves outside the project root.');
  return realDir;
}

function _storePath(root, options = {}) {
  const ctx = _rootContext(root);
  const harnessLex = path.join(ctx.lexicalRoot, '.leerness');
  let harnessLstat;
  try { harnessLstat = fs.lstatSync(harnessLex); }
  catch (error) {
    if (error && error.code === 'ENOENT') _fail('not_initialized', 'Leerness is not initialized in this project.');
    _fail('workspace_invalid', 'Leerness workspace cannot be inspected.', { error: error && error.code || 'ELSTAT' });
  }
  if (harnessLstat.isSymbolicLink()) _fail('workspace_linked', 'The Leerness workspace directory must not be a symbolic link or junction.');
  _safeExistingDirectory(ctx, harnessLex, 'not_initialized', 'workspace_invalid');

  const cacheLex = path.join(harnessLex, 'cache');
  let cacheReal;
  try {
    let cacheLstat;
    try { cacheLstat = fs.lstatSync(cacheLex); }
    catch (error) {
      if (error && error.code === 'ENOENT') _fail('cache_missing', 'Lease cache directory is missing.');
      _fail('cache_invalid', 'Lease cache directory cannot be inspected.', { error: error && error.code || 'ELSTAT' });
    }
    if (cacheLstat.isSymbolicLink()) _fail('cache_symlink', 'Lease cache directory must not be a symbolic link or junction.');
    cacheReal = _safeExistingDirectory(ctx, cacheLex, 'cache_missing', 'cache_invalid');
  } catch (error) {
    if (!(error instanceof LeaseError) || error.code !== 'cache_missing' || !options.create) throw error;
    try { fs.mkdirSync(cacheLex, { recursive: true }); }
    catch (mkdirError) { _fail('cache_unavailable', 'Lease cache directory could not be created.', { error: mkdirError && mkdirError.code || 'EMKDIR' }); }
    const createdCacheLstat = fs.lstatSync(cacheLex);
    if (createdCacheLstat.isSymbolicLink()) _fail('cache_symlink', 'Lease cache directory must not be a symbolic link or junction.');
    cacheReal = _safeExistingDirectory(ctx, cacheLex, 'cache_missing', 'cache_invalid');
  }

  // Use the resolved in-project cache directory for later reads, writes, and locks.
  // This removes ordinary lexical aliases. It is not a security fence against a malicious
  // process replacing filesystem objects concurrently; the lease itself is advisory.
  const store = path.join(cacheReal, 'file-leases.json');
  let storeLstat = null;
  try { storeLstat = fs.lstatSync(store); }
  catch (error) {
    if (!(error && error.code === 'ENOENT')) _fail('store_unreadable', 'Lease store cannot be inspected.', { error: error && error.code || 'ELSTAT' });
  }
  if (storeLstat) {
    if (storeLstat.isSymbolicLink()) _fail('store_symlink', 'Lease store must not be a symbolic link.');
    if (!storeLstat.isFile()) _fail('store_invalid', 'Lease store is not a regular file.');
    let realStore;
    try { realStore = _realpath(store); }
    catch (error) { _fail('store_unreadable', 'Lease store cannot be resolved.', { error: error && error.code || 'EREALPATH' }); }
    if (!_isInside(ctx.realRoot, realStore)) _fail('path_escape', 'Lease store resolves outside the project root.');
  }
  return { ...ctx, store };
}

function storePath(root) {
  return _storePath(root, { create: false }).store;
}

function _iso(value) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const canonical = new Date(ms).toISOString();
  return canonical === value ? canonical : null;
}

function _safeText(value, max) {
  if (value == null) return null;
  const text = String(value).replace(CONTROL_RE, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function normalizeSessionKey(value) {
  const key = String(value == null ? '' : value).trim().toLowerCase();
  if (!isValidKey(key)) _fail('invalid_session_key', 'A stable session key is required (8-64 alphanumeric, underscore, or hyphen characters).');
  return key;
}

function normalizeTtlSeconds(value) {
  const raw = value == null || value === '' ? DEFAULT_TTL_SECONDS : Number(value);
  if (!Number.isInteger(raw) || raw < MIN_TTL_SECONDS || raw > MAX_TTL_SECONDS) {
    _fail('invalid_ttl', `TTL must be an integer from ${MIN_TTL_SECONDS} to ${MAX_TTL_SECONDS} seconds.`, {
      min: MIN_TTL_SECONDS,
      max: MAX_TTL_SECONDS,
    });
  }
  return raw;
}

function _invalidWindowsPathPart(part) {
  if (!part || /[. ]$/.test(part) || part.includes(':')) return true;
  return WINDOWS_DEVICE_RE.test(part.split('.')[0]);
}

function _existingAncestor(target) {
  const suffix = [];
  let current = target;
  for (;;) {
    try {
      const lstat = fs.lstatSync(current);
      return { current, suffix, lstat };
    } catch (error) {
      if (!(error && error.code === 'ENOENT')) _fail('file_unreadable', 'Lease target cannot be inspected.', { error: error && error.code || 'ELSTAT' });
    }
    const parent = path.dirname(current);
    if (parent === current) _fail('file_unresolvable', 'Lease target has no resolvable ancestor.');
    suffix.unshift(path.basename(current));
    current = parent;
  }
}

function resolveTarget(root, file) {
  const ctx = _rootContext(root);
  if (typeof file !== 'string' || !file.trim() || file.length > 2048) {
    _fail('invalid_file', 'Lease target must be a non-empty file path no longer than 2048 characters.');
  }
  CONTROL_RE.lastIndex = 0;
  if (CONTROL_RE.test(file)) {
    CONTROL_RE.lastIndex = 0;
    _fail('invalid_file', 'Lease target must not contain terminal or line-control characters.');
  }
  CONTROL_RE.lastIndex = 0;
  const input = file;
  const absoluteInput = path.isAbsolute(input);
  const lexicalTarget = path.resolve(ctx.lexicalRoot, input);
  if (!absoluteInput && !_isInside(ctx.lexicalRoot, lexicalTarget)) {
    _fail('path_escape', 'Relative lease target escapes the project root.');
  }

  const ancestor = _existingAncestor(lexicalTarget);
  let ancestorReal;
  try { ancestorReal = _realpath(ancestor.current); }
  catch (error) {
    _fail(ancestor.lstat.isSymbolicLink() ? 'broken_symlink' : 'file_unresolvable',
      'Lease target cannot be resolved.', { error: error && error.code || 'EREALPATH' });
  }
  let ancestorStat;
  try { ancestorStat = fs.statSync(ancestorReal, { bigint: true }); }
  catch (error) { _fail('file_unreadable', 'Lease target ancestor cannot be inspected.', { error: error && error.code || 'ESTAT' }); }
  if (ancestor.suffix.length > 0 && !ancestorStat.isDirectory()) {
    _fail('parent_not_directory', 'A parent component of the lease target is not a directory.');
  }

  const realTarget = ancestor.suffix.length > 0
    ? path.resolve(ancestorReal, ...ancestor.suffix)
    : ancestorReal;
  if (!_isInside(ctx.realRoot, realTarget)) _fail('path_escape', 'Lease target resolves outside the project root.');

  let exists = ancestor.suffix.length === 0;
  let identityKey = null;
  if (exists) {
    let targetStat;
    try { targetStat = fs.statSync(realTarget, { bigint: true }); }
    catch (error) { _fail('file_unreadable', 'Lease target cannot be inspected.', { error: error && error.code || 'ESTAT' }); }
    if (!targetStat.isFile()) _fail('target_not_file', 'Lease target must be a regular file or a missing in-project file.');
    if (targetStat.ino !== 0n) identityKey = `fs:${targetStat.dev.toString()}:${targetStat.ino.toString()}`;
  }

  const relative = path.relative(ctx.realRoot, realTarget).split(path.sep).join('/');
  if (!relative || relative === '.') _fail('target_not_file', 'Project root cannot be leased as a file.');
  if (relative.length > 2048) _fail('invalid_file', 'Canonical lease target exceeds 2048 characters.');
  if (process.platform === 'win32' && relative.split('/').some(_invalidWindowsPathPart)) {
    _fail('invalid_file', 'Windows lease targets must not use device names, alternate-data-stream syntax, or trailing dots/spaces.');
  }
  const pathKey = process.platform === 'win32' ? relative.toLowerCase() : relative;
  return {
    file: relative,
    pathKey,
    identityKey,
    exists,
    lexicalPath: lexicalTarget,
    resolvedPath: realTarget,
  };
}

function _emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: null, leases: [] };
}

function _validateLease(raw, index, seenIds, seenPaths, seenIdentities) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) _fail('store_invalid', `Lease row ${index} is not an object.`);
  const allowed = new Set(['leaseId', 'file', 'pathKey', 'identityKey', 'sessionKey', 'acquiredAt', 'renewedAt', 'expiresAt', 'note']);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) _fail('store_invalid', `Lease row ${index} contains an unknown field.`, { field: key });
  if (!LEASE_ID_RE.test(raw.leaseId)) _fail('store_invalid', `Lease row ${index} has an invalid leaseId.`);
  if (seenIds.has(raw.leaseId)) _fail('store_invalid', 'Lease store contains duplicate lease IDs.');
  seenIds.add(raw.leaseId);
  if (typeof raw.file !== 'string' || !raw.file || raw.file.length > 2048 || CONTROL_RE.test(raw.file)) {
    CONTROL_RE.lastIndex = 0;
    _fail('store_invalid', `Lease row ${index} has an invalid file.`);
  }
  CONTROL_RE.lastIndex = 0;
  const fileParts = raw.file.split('/');
  const invalidForPlatform = process.platform === 'win32'
    && (path.win32.isAbsolute(raw.file) || raw.file.includes('\\') || fileParts.some(_invalidWindowsPathPart));
  if (path.posix.isAbsolute(raw.file)
      || fileParts.some(part => !part || part === '.' || part === '..')
      || invalidForPlatform) {
    _fail('store_invalid', `Lease row ${index} has a non-canonical file path.`);
  }
  if (typeof raw.pathKey !== 'string' || !raw.pathKey || raw.pathKey.length > 2048 || CONTROL_RE.test(raw.pathKey)) {
    CONTROL_RE.lastIndex = 0;
    _fail('store_invalid', `Lease row ${index} has an invalid pathKey.`);
  }
  CONTROL_RE.lastIndex = 0;
  const expectedPathKey = process.platform === 'win32' ? raw.file.toLowerCase() : raw.file;
  if (raw.pathKey !== expectedPathKey) _fail('store_invalid', `Lease row ${index} pathKey does not match file.`);
  if (seenPaths.has(raw.pathKey)) _fail('store_invalid', 'Lease store contains duplicate path keys.');
  seenPaths.add(raw.pathKey);
  if (raw.identityKey !== null && !IDENTITY_RE.test(raw.identityKey)) _fail('store_invalid', `Lease row ${index} has an invalid identityKey.`);
  if (raw.identityKey) {
    if (seenIdentities.has(raw.identityKey)) _fail('store_invalid', 'Lease store contains duplicate file identities.');
    seenIdentities.add(raw.identityKey);
  }
  let sessionKey;
  try { sessionKey = normalizeSessionKey(raw.sessionKey); }
  catch { _fail('store_invalid', `Lease row ${index} has an invalid sessionKey.`); }
  const acquiredAt = _iso(raw.acquiredAt);
  const renewedAt = _iso(raw.renewedAt);
  const expiresAt = _iso(raw.expiresAt);
  if (!acquiredAt || !renewedAt || !expiresAt) _fail('store_invalid', `Lease row ${index} has an invalid timestamp.`);
  const acquiredMs = Date.parse(acquiredAt);
  const renewedMs = Date.parse(renewedAt);
  const expiresMs = Date.parse(expiresAt);
  const ttlMs = expiresMs - renewedMs;
  if (renewedMs < acquiredMs || ttlMs < MIN_TTL_SECONDS * 1000 || ttlMs > MAX_TTL_SECONDS * 1000) {
    _fail('store_invalid', `Lease row ${index} has an invalid time order or TTL.`);
  }
  if (raw.note !== null && (typeof raw.note !== 'string' || raw.note.length > 200 || CONTROL_RE.test(raw.note))) {
    CONTROL_RE.lastIndex = 0;
    _fail('store_invalid', `Lease row ${index} has an invalid note.`);
  }
  CONTROL_RE.lastIndex = 0;
  return {
    leaseId: raw.leaseId,
    file: raw.file,
    pathKey: raw.pathKey,
    identityKey: raw.identityKey,
    sessionKey,
    acquiredAt,
    renewedAt,
    expiresAt,
    note: raw.note,
  };
}

function readStore(root, options = {}) {
  const location = _storePath(root, { create: false });
  let stat;
  try { stat = fs.statSync(location.store); }
  catch (error) {
    if (error && error.code === 'ENOENT') return { state: 'missing', store: _emptyStore(), raw: null, path: location.store };
    _fail('store_unreadable', 'Lease store cannot be read.', { error: error && error.code || 'ESTAT' });
  }
  if (stat.size > MAX_STORE_BYTES) _fail('store_too_large', 'Lease store exceeds the safety limit.', { maxBytes: MAX_STORE_BYTES });
  let raw;
  try { raw = fs.readFileSync(location.store, 'utf8'); }
  catch (error) { _fail('store_unreadable', 'Lease store cannot be read.', { error: error && error.code || 'EREAD' }); }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { _fail('store_corrupt', 'Lease store is not valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) _fail('store_invalid', 'Lease store root is invalid.');
  const topAllowed = new Set(['schemaVersion', 'updatedAt', 'leases']);
  for (const key of Object.keys(parsed)) if (!topAllowed.has(key)) _fail('store_invalid', 'Lease store contains an unknown top-level field.', { field: key });
  if (parsed.schemaVersion !== SCHEMA_VERSION) _fail('store_version_unsupported', 'Lease store schema version is unsupported.', { schemaVersion: parsed.schemaVersion });
  if (parsed.updatedAt !== null && !_iso(parsed.updatedAt)) _fail('store_invalid', 'Lease store updatedAt is invalid.');
  if (!Array.isArray(parsed.leases) || parsed.leases.length > MAX_LEASES) _fail('store_invalid', 'Lease store leases array is invalid.');
  const seenIds = new Set();
  const seenPaths = new Set();
  const seenIdentities = new Set();
  const leases = parsed.leases.map((lease, index) => _validateLease(lease, index, seenIds, seenPaths, seenIdentities));
  return {
    state: 'ok',
    store: { schemaVersion: SCHEMA_VERSION, updatedAt: parsed.updatedAt, leases },
    raw,
    path: location.store,
  };
}

function _readStoreForMutation(root) {
  let location;
  try { location = _storePath(root, { create: true }); }
  catch (error) { throw error; }
  let read;
  try { read = readStore(root); }
  catch (error) { throw error; }
  return { ...read, path: location.store };
}

function _observedIdentity(root, lease) {
  if (lease.identityKey) return lease.identityKey;
  // A missing file may appear after its lease was acquired. Re-observe only for
  // comparison; do not persist speculative refreshes during an unrelated mutation.
  try {
    const current = resolveTarget(root, lease.file);
    return current.exists ? current.identityKey : null;
  } catch { return null; }
}

function _matchesTarget(root, lease, target) {
  return lease.pathKey === target.pathKey
    || !!(target.identityKey && _observedIdentity(root, lease) === target.identityKey);
}

function _withLeaseLock(options, targetPath, fn) {
  let callbackCompleted = false;
  try {
    return options.withLock(targetPath, () => {
      const value = fn();
      callbackCompleted = true;
      return value;
    });
  }
  catch (error) {
    if (error instanceof LeaseError) throw error;
    if (error && /^E_LOCK/.test(String(error.code || ''))) {
      _fail('lease_lock_unavailable', 'The lease store lock could not be acquired or released safely.', {
        lockCode: String(error.code),
        mutationMayHaveApplied: callbackCompleted,
        ...(Number.isFinite(error.waitedMs) ? { waitedMs: error.waitedMs } : {}),
      });
    }
    throw error;
  }
}

function _active(lease, nowMs) {
  return Date.parse(lease.expiresAt) > nowMs;
}

function _publicLease(lease, nowMs) {
  const remainingMs = Math.max(0, Date.parse(lease.expiresAt) - nowMs);
  return {
    leaseId: lease.leaseId,
    file: lease.file,
    sessionKey: lease.sessionKey,
    acquiredAt: lease.acquiredAt,
    renewedAt: lease.renewedAt,
    expiresAt: lease.expiresAt,
    note: lease.note,
    status: remainingMs > 0 ? 'active' : 'expired',
    remainingSeconds: Math.ceil(remainingMs / 1000),
  };
}

function _writeStore(file, leases, nowIso) {
  if (!Array.isArray(leases) || leases.length > MAX_LEASES) {
    _fail('lease_limit_reached', 'Lease store has reached its safety limit.', { maxLeases: MAX_LEASES });
  }
  const data = { schemaVersion: SCHEMA_VERSION, updatedAt: nowIso, leases };
  const text = JSON.stringify(data, null, 2) + '\n';
  const attemptedBytes = Buffer.byteLength(text, 'utf8');
  if (attemptedBytes > MAX_STORE_BYTES) {
    _fail('lease_store_size_limit', 'Lease store update would exceed the safety byte limit.', {
      maxBytes: MAX_STORE_BYTES, attemptedBytes,
    });
  }
  try { writeUtf8(file, text); }
  catch (error) {
    _fail('store_write_failed', 'Lease store could not be written atomically.', { error: error && error.code || 'EWRITE' });
  }
  return data;
}

function _newLeaseId(existing, idFactory) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const token = idFactory ? String(idFactory()) : crypto.randomBytes(8).toString('hex');
    const leaseId = token.startsWith('lease-') ? token : `lease-${token}`;
    if (LEASE_ID_RE.test(leaseId) && !existing.has(leaseId)) return leaseId;
  }
  _fail('lease_id_unavailable', 'A unique lease ID could not be generated.');
}

function acquire(root, file, sessionKey, options = {}) {
  if (typeof options.withLock !== 'function') _fail('lock_unavailable', 'Lease acquisition requires the shared lock gateway.');
  const session = normalizeSessionKey(sessionKey);
  const ttlSeconds = normalizeTtlSeconds(options.ttlSeconds);
  // Validate once before creating the cache, then observe again inside the store lock.
  // A contender may wait while a missing path becomes a hard link; using only the
  // pre-lock snapshot could admit two owners for the same file identity.
  resolveTarget(root, file);
  const fixedNowMs = Number.isFinite(options.nowMs) ? options.nowMs : null;
  const note = _safeText(options.note, 200);
  let result = null;
  const location = _storePath(root, { create: true });
  _withLeaseLock(options, location.store, () => {
    const target = resolveTarget(root, file);
    // TTL starts when the critical section is actually entered, not when lock waiting
    // began. The shared lock may wait longer than the minimum 30-second TTL.
    const nowMs = fixedNowMs == null ? Date.now() : fixedNowMs;
    const nowIso = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + ttlSeconds * 1000).toISOString();
    const loaded = _readStoreForMutation(root);
    const active = loaded.store.leases.filter(lease => _active(lease, nowMs));
    const expiredPruned = loaded.store.leases.length - active.length;
    const matches = active.filter(lease => _matchesTarget(root, lease, target));
    const conflicting = matches.find(lease => lease.sessionKey !== session);
    if (conflicting) {
      _fail('lease_conflict', 'The file already has an active lease owned by another session.', {
        conflict: _publicLease(conflicting, nowMs),
      });
    }
    const latestHistoryMs = matches.reduce((latest, row) => Math.max(latest, Date.parse(row.acquiredAt), Date.parse(row.renewedAt)), -Infinity);
    if (matches.length && latestHistoryMs > nowMs) {
      _fail('lease_clock_regression', 'Current time is earlier than the existing lease history; renewal was refused to preserve timestamp ordering.', {
        earliestSafeAt: new Date(latestHistoryMs).toISOString(),
      });
    }
    let lease;
    let renewed = false;
    let mergedLeaseCount = 0;
    if (matches.length) {
      renewed = true;
      // Legacy/missing-file aliases can converge to one identity later. If this session
      // already owns more than one matching row, merge them deterministically instead
      // of writing duplicate identity keys that would corrupt the next read.
      const ordered = matches.slice().sort((a, b) => a.acquiredAt.localeCompare(b.acquiredAt) || a.leaseId.localeCompare(b.leaseId));
      const matching = ordered[0];
      const acquiredAt = ordered.reduce((oldest, row) => row.acquiredAt < oldest ? row.acquiredAt : oldest, matching.acquiredAt);
      mergedLeaseCount = Math.max(0, ordered.length - 1);
      lease = {
        ...matching,
        file: target.file,
        pathKey: target.pathKey,
        identityKey: target.identityKey || matching.identityKey || _observedIdentity(root, matching),
        acquiredAt,
        renewedAt: nowIso,
        expiresAt,
        note: note == null ? matching.note : note,
      };
      const removeIds = new Set(ordered.map(row => row.leaseId));
      for (let i = active.length - 1; i >= 0; i--) if (removeIds.has(active[i].leaseId)) active.splice(i, 1);
      active.push(lease);
    } else {
      if (active.length >= MAX_LEASES) {
        _fail('lease_limit_reached', 'Lease store has reached its safety limit.', { maxLeases: MAX_LEASES });
      }
      const ids = new Set(active.map(row => row.leaseId));
      lease = {
        leaseId: _newLeaseId(ids, options.idFactory),
        file: target.file,
        pathKey: target.pathKey,
        identityKey: target.identityKey,
        sessionKey: session,
        acquiredAt: nowIso,
        renewedAt: nowIso,
        expiresAt,
        note,
      };
      active.push(lease);
    }
    _writeStore(location.store, active, nowIso);
    result = {
      ok: true,
      action: renewed ? 'renewed' : 'acquired',
      lease: _publicLease(lease, nowMs),
      target: { file: target.file, exists: target.exists, identityObserved: !!target.identityKey },
      ttlSeconds,
      expiredPruned,
      mergedLeaseCount,
      storePath: STORE_REL.join('/'),
      advisoryOnly: true,
      ambientWarnings: false,
    };
  });
  return result;
}

function release(root, leaseId, sessionKey, options = {}) {
  if (typeof options.withLock !== 'function') _fail('lock_unavailable', 'Lease release requires the shared lock gateway.');
  const session = normalizeSessionKey(sessionKey);
  if (!LEASE_ID_RE.test(String(leaseId || ''))) _fail('invalid_lease_id', 'A canonical lease ID is required.');
  const fixedNowMs = Number.isFinite(options.nowMs) ? options.nowMs : null;
  let result = null;
  let location;
  try { location = _storePath(root, { create: false }); }
  catch (error) {
    if (error instanceof LeaseError && error.code === 'cache_missing') _fail('lease_not_found', 'Lease ID was not found.');
    throw error;
  }
  _withLeaseLock(options, location.store, () => {
    const nowMs = fixedNowMs == null ? Date.now() : fixedNowMs;
    const nowIso = new Date(nowMs).toISOString();
    const loaded = readStore(root);
    const found = loaded.store.leases.find(lease => lease.leaseId === leaseId);
    if (!found) _fail('lease_not_found', 'Lease ID was not found.');
    if (found.sessionKey !== session) {
      _fail('lease_owner_mismatch', 'Only the owning session may release this lease.', {
        lease: _publicLease(found, nowMs),
      });
    }
    const remaining = loaded.store.leases.filter(lease => lease.leaseId !== leaseId && _active(lease, nowMs));
    const expiredPruned = loaded.store.leases.length - remaining.length - 1;
    _writeStore(location.store, remaining, nowIso);
    result = {
      ok: true,
      action: 'released',
      lease: _publicLease(found, nowMs),
      expiredPruned: Math.max(0, expiredPruned),
      storePath: STORE_REL.join('/'),
      advisoryOnly: true,
      ambientWarnings: false,
    };
  });
  return result;
}

function list(root, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const session = options.sessionKey == null ? null : normalizeSessionKey(options.sessionKey);
  let loaded;
  try { loaded = readStore(root); }
  catch (error) {
    if (error instanceof LeaseError && error.code === 'cache_missing') loaded = { state: 'missing', store: _emptyStore(), path: path.join(path.resolve(root), ...STORE_REL) };
    else throw error;
  }
  const allRows = loaded.store.leases.map(lease => _publicLease(lease, nowMs));
  const filtered = allRows.filter(lease => (!session || lease.sessionKey === session) && (options.all || lease.status === 'active'));
  return {
    ok: true,
    action: 'list',
    storeState: loaded.state,
    storePath: STORE_REL.join('/'),
    totalStored: allRows.length,
    active: allRows.filter(lease => lease.status === 'active').length,
    expired: allRows.filter(lease => lease.status === 'expired').length,
    shown: filtered.length,
    sessionKey: session,
    includesExpired: !!options.all,
    leases: filtered,
    readOnly: true,
    advisoryOnly: true,
    ambientWarnings: false,
  };
}

function check(root, file, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const session = options.sessionKey == null ? null : normalizeSessionKey(options.sessionKey);
  const target = resolveTarget(root, file);
  let loaded;
  try { loaded = readStore(root); }
  catch (error) {
    if (error instanceof LeaseError && error.code === 'cache_missing') loaded = { state: 'missing', store: _emptyStore(), path: path.join(path.resolve(root), ...STORE_REL) };
    else throw error;
  }
  const matches = loaded.store.leases.filter(lease => _matchesTarget(root, lease, target));
  const activeMatches = matches.filter(lease => _active(lease, nowMs));
  // Two paths can be leased independently while missing and later become hard links.
  // A peer match must dominate a same-session match; choosing the first row could
  // otherwise report the file as available while another session still owns it.
  const peer = session ? activeMatches.find(lease => lease.sessionKey !== session) : activeMatches[0];
  const self = session ? activeMatches.find(lease => lease.sessionKey === session) : null;
  const active = peer || self || null;
  const owned = !!(active && session && !peer && active.sessionKey === session);
  return {
    ok: true,
    action: 'check',
    storeState: loaded.state,
    storePath: STORE_REL.join('/'),
    target: { file: target.file, exists: target.exists, identityObserved: !!target.identityKey },
    available: !active || owned,
    ownedBySession: owned,
    lease: active ? _publicLease(active, nowMs) : null,
    expiredMatches: matches.filter(lease => !_active(lease, nowMs)).length,
    readOnly: true,
    advisoryOnly: true,
    ambientWarnings: false,
  };
}

module.exports = {
  LeaseError,
  SCHEMA_VERSION,
  STORE_REL,
  DEFAULT_TTL_SECONDS,
  MIN_TTL_SECONDS,
  MAX_TTL_SECONDS,
  MAX_STORE_BYTES,
  MAX_LEASES,
  storePath,
  normalizeSessionKey,
  normalizeTtlSeconds,
  resolveTarget,
  readStore,
  acquire,
  release,
  list,
  check,
};
