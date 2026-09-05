'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');
const { writeUtf8 } = require('./io');
const { isValidKey } = require('./session-presence');
const { stripDefaultIgnorables } = require('./pure-utils');

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
  if (process.platform === 'win32') {
    const parent = path.resolve(root);
    const child = path.resolve(candidate);
    const parentParsed = path.parse(parent);
    const childParsed = path.parse(child);
    if (parentParsed.root.toLowerCase() !== childParsed.root.toLowerCase()) return false;
    const parentParts = parent.slice(parentParsed.root.length).split(path.sep).filter(Boolean);
    const childParts = child.slice(childParsed.root.length).split(path.sep).filter(Boolean);
    if (childParts.length < parentParts.length) return false;
    let observedParent = parentParsed.root;
    for (let i = 0; i < parentParts.length; i++) {
      if (parentParts[i] !== childParts[i]) {
        if (parentParts[i].toLowerCase() !== childParts[i].toLowerCase()) return false;
        // Per-directory case sensitivity can make Repo and repo distinct even
        // though path.win32.relative treats them as aliases.
        if (!_directoryCaseInsensitive(observedParent)) return false;
      }
      observedParent = path.join(observedParent, parentParts[i]);
    }
    return true;
  }
  const rel = path.relative(root, candidate);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}

function _realpath(value) {
  return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
}

function _alternateCase(name) {
  const text = String(name);
  let offset = 0;
  for (const char of text) {
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();
    let flipped = null;
    if (char === lower && upper !== char) flipped = upper;
    else if (char === upper && lower !== char) flipped = lower;
    if (flipped && flipped !== char) return text.slice(0, offset) + flipped + text.slice(offset + char.length);
    offset += char.length;
  }
  return null;
}

// Derive lookup semantics from an existing entry in the containing directory.
// This handles default case-insensitive macOS volumes and Windows directories
// with per-directory case sensitivity. Empty/unreadable directories use the
// conservative platform default so aliases cannot acquire two owners.
function _directoryCaseInsensitive(realDir) {
  try {
    const entries = fs.readdirSync(realDir, { withFileTypes: true })
      .slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const alternate = _alternateCase(entry.name);
      if (!alternate || alternate === entry.name) continue;
      const originalPath = path.join(realDir, entry.name);
      const alternatePath = path.join(realDir, alternate);
      let original;
      try { original = fs.lstatSync(originalPath, { bigint: true }); }
      catch { continue; }
      try {
        const observed = fs.lstatSync(alternatePath, { bigint: true });
        return original.dev === observed.dev && original.ino === observed.ino;
      } catch (error) {
        if (error && error.code === 'ENOENT') return false;
      }
    }
  } catch {}
  // No observation means no safe basis for splitting ownership. Collapsing case
  // aliases can cause a false conflict on a case-sensitive empty directory, but
  // guessing case-sensitive can grant two owners for one eventual file on Linux
  // casefold directories. Exact-file coordination fails closed here.
  return true;
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
    if (Number(storeLstat.nlink) > 1) _fail('store_hard_link', 'Lease store must not be hard-linked.');
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
  const text = stripDefaultIgnorables(value, { visibleIdentity: true }).replace(CONTROL_RE, ' ').trim();
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
  if (!part || /[. ]$/.test(part) || /[<>:"/\\|?*]/.test(part)) return true;
  return WINDOWS_DEVICE_RE.test(part.split('.')[0]);
}

// JavaScript has no direct Unicode simple-case-folding API. Filesystem case tables
// are one-code-point mappings, so never apply compatibility or multi-code-point
// expansions here (`ß -> SS`, `ﬀ -> FF`, and similar pairs can be distinct NTFS
// names). Upper-then-lower for one-code-point results still joins aliases such as
// final sigma with sigma. NFC conservatively joins canonically equivalent missing
// paths without collapsing compatibility characters.
function _conservativeCaseFold(value) {
  let text = String(value == null ? '' : value);
  try { text = text.normalize('NFC'); } catch {}
  text = Array.from(text, character => {
    let upper;
    try { upper = character.toLocaleUpperCase('und'); }
    catch { upper = character.toUpperCase(); }
    if (Array.from(upper).length !== 1) {
      let lower;
      try { lower = character.toLocaleLowerCase('und'); }
      catch { lower = character.toLowerCase(); }
      return Array.from(lower).length === 1 ? lower : character;
    }
    let folded;
    try { folded = upper.toLocaleLowerCase('und'); }
    catch { folded = upper.toLowerCase(); }
    return Array.from(folded).length === 1 ? folded : upper;
  }).join('');
  try { text = text.normalize('NFC'); } catch {}
  return text;
}

function _hasUnsafePathFormatting(value) {
  const raw = String(value == null ? '' : value);
  return stripDefaultIgnorables(raw, { visibleIdentity: true }) !== raw;
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
  if (CONTROL_RE.test(file) || _hasUnsafePathFormatting(file)) {
    CONTROL_RE.lastIndex = 0;
    _fail('invalid_file', 'Lease target must not contain terminal, line-control, bidi, or invisible format characters.');
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
    _fail('invalid_file', 'Windows lease targets must not use device names, invalid filename characters, alternate-data-stream syntax, or trailing dots/spaces.');
  }
  const caseDirectory = exists ? path.dirname(realTarget) : ancestorReal;
  const caseInsensitive = _directoryCaseInsensitive(caseDirectory);
  let normalizedRelative = relative;
  try { normalizedRelative = normalizedRelative.normalize('NFC'); } catch {}
  const pathKey = caseInsensitive ? _conservativeCaseFold(normalizedRelative) : normalizedRelative;
  return {
    file: relative,
    pathKey,
    identityKey,
    exists,
    lexicalPath: lexicalTarget,
    resolvedPath: realTarget,
    caseInsensitive,
  };
}

function _emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: null, leases: [] };
}

function _validateLease(root, raw, index, seenIds, seenPaths, seenIdentities, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) _fail('store_invalid', `Lease row ${index} is not an object.`);
  const allowed = new Set(['leaseId', 'file', 'pathKey', 'identityKey', 'sessionKey', 'acquiredAt', 'renewedAt', 'expiresAt', 'note']);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) _fail('store_invalid', `Lease row ${index} contains an unknown field.`, { field: key });
  if (!LEASE_ID_RE.test(raw.leaseId)) _fail('store_invalid', `Lease row ${index} has an invalid leaseId.`);
  if (seenIds.has(raw.leaseId)) _fail('store_invalid', 'Lease store contains duplicate lease IDs.');
  seenIds.add(raw.leaseId);
  if (typeof raw.file !== 'string' || !raw.file || raw.file.length > 2048 || CONTROL_RE.test(raw.file) || _hasUnsafePathFormatting(raw.file)) {
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
  if (typeof raw.pathKey !== 'string' || !raw.pathKey || raw.pathKey.length > 2048 || CONTROL_RE.test(raw.pathKey) || _hasUnsafePathFormatting(raw.pathKey)) {
    CONTROL_RE.lastIndex = 0;
    _fail('store_invalid', `Lease row ${index} has an invalid pathKey.`);
  }
  CONTROL_RE.lastIndex = 0;
  if (raw.identityKey !== null && !IDENTITY_RE.test(raw.identityKey)) _fail('store_invalid', `Lease row ${index} has an invalid identityKey.`);
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
  const expired = Number.isFinite(options.nowMs) && expiresMs <= options.nowMs;
  let resolvedStored;
  try { resolvedStored = resolveTarget(root, raw.file); }
  catch (error) {
    if (!expired) {
      _fail('store_invalid', `Lease row ${index} no longer resolves to a safe project file.`, {
        cause: error && error.code || 'target-invalid',
      });
    }
    resolvedStored = null;
  }
  const expectedPathKey = resolvedStored ? resolvedStored.pathKey : raw.pathKey;
  // Accept the two historical serializations, then canonicalize in memory to
  // the containing filesystem's observed behavior. A later mutation writes it back.
  let normalizedFile = raw.file;
  try { normalizedFile = normalizedFile.normalize('NFC'); } catch {}
  const compatiblePathKeys = new Set([
    expectedPathKey,
    raw.file,
    raw.file.toLowerCase(),
    normalizedFile,
    normalizedFile.toLowerCase(),
    _conservativeCaseFold(raw.file),
    _conservativeCaseFold(normalizedFile),
  ]);
  if (!compatiblePathKeys.has(raw.pathKey)) _fail('store_invalid', `Lease row ${index} pathKey does not match file.`);
  // Unicode/case folding is deliberately conservative for paths that do not
  // exist yet. Some filesystems can nevertheless hold two existing names that
  // fold to the same path key. Preserve those rows only when both have distinct,
  // observed file identities; an unknown identity remains fail-closed.
  if (!expired) {
    const pathIdentities = seenPaths.get(expectedPathKey);
    if (pathIdentities) {
      if (!raw.identityKey || pathIdentities.has(null) || pathIdentities.has(raw.identityKey)) {
        _fail('store_invalid', 'Lease store contains an ambiguous duplicate path key.');
      }
      pathIdentities.add(raw.identityKey);
    } else {
      seenPaths.set(expectedPathKey, new Set([raw.identityKey || null]));
    }
    if (raw.identityKey) {
      if (seenIdentities.has(raw.identityKey)) _fail('store_invalid', 'Lease store contains duplicate file identities.');
      seenIdentities.add(raw.identityKey);
    }
  }
  return {
    leaseId: raw.leaseId,
    file: raw.file,
    pathKey: expectedPathKey,
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
  try { stat = fs.lstatSync(location.store); }
  catch (error) {
    if (error && error.code === 'ENOENT') return { state: 'missing', store: _emptyStore(), raw: null, path: location.store };
    _fail('store_unreadable', 'Lease store cannot be read.', { error: error && error.code || 'ESTAT' });
  }
  if (stat.isSymbolicLink() || !stat.isFile()) _fail('store_invalid', 'Lease store is not a regular file.');
  if (Number(stat.nlink) > 1) _fail('store_hard_link', 'Lease store must not be hard-linked.');
  if (stat.size > MAX_STORE_BYTES) _fail('store_too_large', 'Lease store exceeds the safety limit.', { maxBytes: MAX_STORE_BYTES });
  let bytes;
  try { bytes = fs.readFileSync(location.store); }
  catch (error) { _fail('store_unreadable', 'Lease store cannot be read.', { error: error && error.code || 'EREAD' }); }
  let raw;
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { _fail('store_invalid_utf8', 'Lease store is not valid UTF-8.'); }
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
  const seenPaths = new Map();
  const seenIdentities = new Set();
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const leases = parsed.leases.map((lease, index) => _validateLease(
    root, lease, index, seenIds, seenPaths, seenIdentities, { nowMs },
  ));
  return {
    state: 'ok',
    store: { schemaVersion: SCHEMA_VERSION, updatedAt: parsed.updatedAt, leases },
    raw,
    path: location.store,
  };
}

function _readStoreForMutation(root, options = {}) {
  let location;
  try { location = _storePath(root, { create: true }); }
  catch (error) { throw error; }
  let read;
  try { read = readStore(root, options); }
  catch (error) { throw error; }
  return { ...read, path: location.store };
}

function _currentObservedIdentity(root, lease) {
  try {
    const current = resolveTarget(root, lease.file);
    return current.exists ? current.identityKey : null;
  } catch { return null; }
}

function _observedIdentities(root, lease) {
  const identities = new Set();
  if (lease.identityKey) identities.add(lease.identityKey);
  // A missing or replaced file may acquire a new identity after the lease was
  // recorded. Compare both historical and current identity without rewriting
  // the row during an unrelated read/mutation.
  const current = _currentObservedIdentity(root, lease);
  if (current) identities.add(current);
  return identities;
}

function _matchesTarget(root, lease, target) {
  if (target.identityKey) {
    const observed = _observedIdentities(root, lease);
    if (observed.has(target.identityKey)) return true;
    // When both sides expose different identities, that evidence is stronger
    // than a conservative Unicode/case-fold collision in the lexical path key.
    if (observed.size > 0) return false;
  }
  return lease.pathKey === target.pathKey;
}

function _promoteCollidingPathIdentities(root, leases, target) {
  if (!target.identityKey) return;
  for (const lease of leases) {
    if (lease.pathKey !== target.pathKey || lease.identityKey) continue;
    const current = _currentObservedIdentity(root, lease);
    if (!current || current === target.identityKey) continue;
    const sharedElsewhere = leases.some(other => other !== lease
      && _observedIdentities(root, other).has(current));
    if (sharedElsewhere) {
      _fail('lease_state_ambiguous', 'A colliding path key has an identity shared by another active lease; acquisition was refused.');
    }
    // Persist the now-observable identity before admitting another existing file
    // with the same conservative path key, keeping subsequent reads unambiguous.
    lease.identityKey = current;
  }
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
    const loaded = _readStoreForMutation(root, { nowMs });
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
        identityKey: target.identityKey || _currentObservedIdentity(root, matching) || matching.identityKey,
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
      _promoteCollidingPathIdentities(root, active, target);
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
    const loaded = readStore(root, { nowMs });
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
  try { loaded = readStore(root, { nowMs }); }
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
  try { loaded = readStore(root, { nowMs }); }
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
  acquire: require('./runtime-writes').projectWriter(acquire),
  release: require('./runtime-writes').projectWriter(release),
  list,
  check,
};
