'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');
const { absRoot, mkdirp, writeBufferIfUnchanged, detachCommittedHardLink } = require('./io');
const schema = require('./role-agent-schema');
const { validateRoleDefinitionShape } = require('./role-fallback');

const STORE_RELATIVE_PATH = '.leerness/agent-roles.json';
const MAX_STORE_BYTES = 1024 * 1024;
const OUTPUT_SCHEMA_VERSION = 1;
const OBSERVATION = 'role-store-validation';
const VALIDATED_STATE = Symbol('validated-role-store-state');

function hasOwn(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

function defineOwn(object, key, value) {
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function cloneJson(value, fallback = null) {
  try { return JSON.parse(JSON.stringify(value)); }
  catch { return fallback; }
}

function sanitizeText(value, max = 240) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function safeRoleMap(value) {
  const out = Object.create(null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const key of Object.keys(value)) {
    const cloned = cloneJson(value[key]);
    if (cloned !== null) defineOwn(out, key, cloned);
  }
  return out;
}

function rolesFile(root) {
  return path.join(absRoot(root), '.leerness', 'agent-roles.json');
}

function _realpath(value) {
  return typeof fs.realpathSync.native === 'function' ? fs.realpathSync.native(value) : fs.realpathSync(value);
}

function _isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function _storeBoundaryContext(root) {
  const absoluteRoot = absRoot(root);
  const harness = path.join(absoluteRoot, '.leerness');
  let stat;
  try { stat = fs.lstatSync(harness); }
  catch (error) {
    if (error && error.code === 'ENOENT') {
      return { problem: null, exists: false, absoluteRoot, harness, realRoot: null, realHarness: null, identity: null };
    }
    return { problem: { state: 'unreadable-parent', code: 'parent-stat-failed' }, exists: false, absoluteRoot, harness };
  }
  if (stat.isSymbolicLink()) {
    return { problem: { state: 'linked-parent', code: 'linked-store-parent-rejected' }, exists: true, absoluteRoot, harness };
  }
  if (!stat.isDirectory()) {
    return { problem: { state: 'invalid-parent-type', code: 'store-parent-not-directory' }, exists: true, absoluteRoot, harness };
  }
  try {
    const realRoot = _realpath(absoluteRoot);
    const realHarness = _realpath(harness);
    if (!_isWithin(realRoot, realHarness)) {
      return { problem: { state: 'linked-parent', code: 'store-parent-outside-root' }, exists: true, absoluteRoot, harness };
    }
    return {
      problem: null,
      exists: true,
      absoluteRoot,
      harness,
      realRoot,
      realHarness,
      identity: _fileIdentity(stat),
    };
  } catch {
    return { problem: { state: 'unreadable-parent', code: 'parent-realpath-failed' }, exists: true, absoluteRoot, harness };
  }
}

function _storeBoundaryProblem(root) {
  return _storeBoundaryContext(root).problem;
}

function _storeParentChangedError() {
  const error = new Error('role store parent changed during operation');
  error.code = 'E_STORE_PARENT_CHANGED';
  return error;
}

function _assertStoreParentSnapshot(snapshot) {
  if (!snapshot || snapshot.exists !== true || !snapshot.identity) throw _storeParentChangedError();
  let current;
  try { current = fs.lstatSync(snapshot.harness); }
  catch { throw _storeParentChangedError(); }
  if (current.isSymbolicLink() || !current.isDirectory()
    || !_sameFileIdentity(current, snapshot.identity)) throw _storeParentChangedError();
  let realHarness;
  try { realHarness = _realpath(snapshot.harness); }
  catch { throw _storeParentChangedError(); }
  if (realHarness !== snapshot.realHarness || !_isWithin(snapshot.realRoot, realHarness)) {
    throw _storeParentChangedError();
  }
  return current;
}

function _markValidated(state, internals = {}) {
  Object.defineProperty(state, VALIDATED_STATE, { value: true, enumerable: false });
  Object.defineProperty(state, 'rawBytes', {
    value: internals.rawBytes || null, enumerable: false, configurable: false, writable: false,
  });
  Object.defineProperty(state, 'fileIdentity', {
    value: internals.fileIdentity || null, enumerable: false, configurable: false, writable: false,
  });
  Object.defineProperty(state, 'parentSnapshot', {
    value: internals.parentSnapshot || null, enumerable: false, configurable: false, writable: false,
  });
  return state;
}

function revisionForBytes(raw) {
  return `sha256:${crypto.createHash('sha256').update(raw).digest('hex')}`;
}

function _fileIdentity(stat) {
  return stat ? { dev: stat.dev, ino: stat.ino, nlink: stat.nlink, mode: stat.mode } : null;
}

function _sameFileIdentity(a, b) {
  return !!a && !!b && String(a.dev) === String(b.dev) && String(a.ino) === String(b.ino);
}

function _sameReadSnapshot(a, b) {
  return _sameFileIdentity(a, b)
    && Number(a.size) === Number(b.size)
    && Number(a.mtimeMs) === Number(b.mtimeMs)
    && Number(a.ctimeMs) === Number(b.ctimeMs);
}

function validateExtendedRoles(document) {
  const roles = document && document.roles && typeof document.roles === 'object' && !Array.isArray(document.roles)
    ? document.roles
    : {};
  const problems = [];
  for (const role of Object.keys(roles).sort()) {
    const result = validateRoleDefinitionShape(role, roles[role], { allowLegacyProviderIds: true });
    if (!result.ok) {
      problems.push({
        code: result.code || 'role-definition-invalid',
        path: `$.legacyAssignments.roles.${role}${result.field ? `.${result.field}` : ''}`,
      });
    }
  }
  return problems;
}

function publicProblems(problems) {
  return (Array.isArray(problems) ? problems : []).slice(0, 30).map(problem => ({
    code: sanitizeText(problem && problem.code || 'store-invalid', 100),
    path: sanitizeText(problem && problem.path || '$.legacyAssignments', 240),
  }));
}

function messageFor(state, language = 'ko') {
  const en = language === 'en';
  if (!state || state.code === 'store_unreadable') {
    return en
      ? 'The role configuration file could not be read. Role reads, writes, and routing are stopped until the original file is inspected.'
      : '역할 설정 파일을 읽을 수 없습니다 — 원본을 확인하기 전에는 역할 읽기·쓰기·라우팅을 중단합니다';
  }
  if (state.code === 'store_corrupt') {
    return en
      ? 'The role configuration JSON is corrupt. Role reads, writes, and routing are stopped until the original file is recovered.'
      : '역할 설정 파일의 JSON이 손상되었습니다 — 원본을 복구하기 전에는 역할 읽기·쓰기·라우팅을 중단합니다';
  }
  return en
    ? 'The role configuration shape is invalid. Role reads, writes, and routing are stopped until the original file is recovered.'
    : '역할 설정 파일 형상이 유효하지 않습니다 — 원본을 복구하기 전에는 역할 읽기·쓰기·라우팅을 중단합니다';
}

function invalidState(code, state, problems, extra = {}) {
  return {
    ok: false,
    code,
    state,
    file: STORE_RELATIVE_PATH,
    problems: publicProblems(problems),
    originalPreserved: true,
    providerCommandsExecuted: false,
    ...extra,
  };
}

function missingState(file, parentSnapshot = null) {
  const document = { schemaVersion: 1, roles: {} };
  return _markValidated({
    ok: true,
    code: 'ok',
    state: 'missing',
    file: STORE_RELATIVE_PATH,
    absoluteFile: file,
    fileExists: false,
    bytes: 0,
    revision: 'missing',
    document,
    roles: safeRoleMap(document.roles),
    validation: {
      ok: true,
      code: 'ok',
      problems: [],
      warnings: [],
      unknownFields: [],
      version: null,
      unversioned: false,
      roleKeys: [],
    },
  }, { parentSnapshot });
}

function readRoleStore(root) {
  const file = rolesFile(root);
  const boundaryContext = _storeBoundaryContext(root);
  const boundary = boundaryContext.problem;
  if (boundary) {
    return invalidState(
      boundary.state === 'unreadable-parent' ? 'store_unreadable' : 'store_invalid',
      boundary.state,
      [{ code: boundary.code, path: '$.legacyAssignments' }],
      { absoluteFile: file },
    );
  }
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if (error && error.code === 'ENOENT') return missingState(file, boundaryContext.exists ? boundaryContext : null);
    return invalidState(
      'store_unreadable',
      'unreadable',
      [{ code: 'file-stat-failed', path: '$.legacyAssignments' }],
      { absoluteFile: file },
    );
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    return invalidState(
      'store_invalid',
      'invalid-file-type',
      [{ code: stat.isSymbolicLink() ? 'linked-store-rejected' : 'store-not-regular-file', path: '$.legacyAssignments' }],
      { absoluteFile: file, bytes: stat.size },
    );
  }
  // A hard-linked role store can be changed by another project without this
  // project's lock and can therefore control routing across project boundaries.
  // Reject it rather than treating shared file identity as project-local state.
  if (Number(stat.nlink) > 1) {
    return invalidState(
      'store_invalid',
      'hard-linked-file',
      [{ code: 'hard-linked-store-rejected', path: '$.legacyAssignments' }],
      { absoluteFile: file, bytes: stat.size },
    );
  }
  if (stat.size > MAX_STORE_BYTES) {
    return invalidState(
      'store_invalid',
      'too-large',
      [{ code: 'store-too-large', path: '$.legacyAssignments' }],
      { absoluteFile: file, bytes: stat.size, maxBytes: MAX_STORE_BYTES },
    );
  }

  let raw;
  let openedStat;
  let fd = null;
  try {
    _assertStoreParentSnapshot(boundaryContext);
    const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);
    fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    openedStat = fs.fstatSync(fd);
    _assertStoreParentSnapshot(boundaryContext);
    const pathStat = fs.lstatSync(file);
    if (!openedStat.isFile() || pathStat.isSymbolicLink() || !pathStat.isFile()
      || Number(openedStat.nlink) > 1 || Number(pathStat.nlink) > 1
      || !_sameFileIdentity(openedStat, pathStat)) {
      return invalidState(
        'store_invalid',
        'file-identity-changed',
        [{ code: 'store-file-identity-changed', path: '$.legacyAssignments' }],
        { absoluteFile: file, bytes: Number(openedStat.size) },
      );
    }
    if (Number(openedStat.size) > MAX_STORE_BYTES) {
      return invalidState(
        'store_invalid',
        'too-large',
        [{ code: 'store-too-large', path: '$.legacyAssignments' }],
        { absoluteFile: file, bytes: Number(openedStat.size), maxBytes: MAX_STORE_BYTES },
      );
    }
    raw = fs.readFileSync(fd);
    const afterHandle = fs.fstatSync(fd);
    const afterPath = fs.lstatSync(file);
    _assertStoreParentSnapshot(boundaryContext);
    if (afterPath.isSymbolicLink() || !afterPath.isFile() || Number(afterPath.nlink) > 1
      || !_sameReadSnapshot(openedStat, afterHandle)
      || !_sameFileIdentity(afterHandle, afterPath)) {
      return invalidState(
        'store_invalid',
        'changed-during-read',
        [{ code: 'store-changed-during-read', path: '$.legacyAssignments' }],
        { absoluteFile: file, bytes: raw.length },
      );
    }
    stat = afterHandle;
  } catch (error) {
    return invalidState(
      error && ['ELOOP', 'EMLINK', 'E_STORE_PARENT_CHANGED'].includes(error.code) ? 'store_invalid' : 'store_unreadable',
      error && error.code === 'E_STORE_PARENT_CHANGED' ? 'parent-identity-changed' : 'unreadable',
      [{ code: error && error.code === 'E_STORE_PARENT_CHANGED' ? 'store-parent-identity-changed' : 'file-read-failed', path: '$.legacyAssignments' }],
      { absoluteFile: file, bytes: stat.size },
    );
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
  if (raw.length > MAX_STORE_BYTES) {
    return invalidState(
      'store_invalid',
      'too-large',
      [{ code: 'store-too-large', path: '$.legacyAssignments' }],
      { absoluteFile: file, bytes: raw.length, maxBytes: MAX_STORE_BYTES },
    );
  }

  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
  catch {
    return invalidState(
      'store_invalid',
      'invalid-utf8',
      [{ code: 'invalid-utf8', path: '$.legacyAssignments' }],
      { absoluteFile: file, bytes: raw.length },
    );
  }

  const parsed = schema.parseLegacyRoleStoreText(source);
  if (!parsed.ok) {
    return invalidState(
      parsed.state === 'invalid-json' ? 'store_corrupt' : 'store_invalid',
      parsed.state || 'invalid',
      parsed.problems,
      { absoluteFile: file, bytes: stat.size },
    );
  }

  const extensionProblems = validateExtendedRoles(parsed.doc);
  if (extensionProblems.length) {
    return invalidState(
      'store_invalid',
      'invalid-role-definition',
      extensionProblems,
      { absoluteFile: file, bytes: raw.length, revision: revisionForBytes(raw) },
    );
  }

  const document = cloneJson(parsed.doc, { schemaVersion: 1, roles: {} });
  return _markValidated({
    ok: true,
    code: 'ok',
    state: 'valid',
    file: STORE_RELATIVE_PATH,
    absoluteFile: file,
    fileExists: true,
    bytes: raw.length,
    revision: revisionForBytes(raw),
    document,
    roles: safeRoleMap(document.roles),
    validation: parsed.validation || parsed,
  }, { rawBytes: Buffer.from(raw), fileIdentity: _fileIdentity(stat), parentSnapshot: boundaryContext });
}

class RoleStoreError extends Error {
  constructor(state) {
    super(messageFor(state));
    this.name = 'RoleStoreError';
    this.code = state.code;
    this.roleStoreState = state;
  }
}

function assertValid(state) {
  if (!state.ok) throw new RoleStoreError(state);
  return state;
}

function loadRoles(root) {
  return assertValid(readRoleStore(root)).roles;
}

function publicError(state) {
  return {
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    observation: OBSERVATION,
    code: state.code,
    error: messageFor(state),
    state: state.state,
    file: state.file || STORE_RELATIVE_PATH,
    problems: publicProblems(state.problems),
    originalPreserved: true,
    providerCommandsExecuted: false,
  };
}

function _assertExpectedSnapshot(file, expectedBytes, expectedIdentity) {
  const state = readRoleStore(path.dirname(path.dirname(file)));
  if (!state.ok || state.revision !== revisionForBytes(expectedBytes)
    || !_sameFileIdentity(state.fileIdentity, expectedIdentity)) {
    const error = new Error('role store changed before compare-and-replace');
    error.code = 'E_CONCURRENT_MODIFICATION';
    throw error;
  }
}

// POSIX lacks a portable rename-exchange/CAS primitive in Node. Capture the
// exact expected inode first, then install the prepared inode with an exclusive
// hard-link operation. A competing pathname writer wins rather than being
// overwritten; the displaced object is retained as recovery evidence.
function _writePosixIfUnchanged(file, expectedBytes, nextBytes, expectedIdentity, parentSnapshot) {
  const scratch = fs.mkdtempSync(path.join(path.dirname(file), '.agent-roles-cas-'));
  const next = path.join(scratch, 'next');
  const before = path.join(scratch, 'before');
  let displaced = false;
  try {
    fs.writeFileSync(next, nextBytes, { flag: 'wx', mode: Number(expectedIdentity.mode) & 0o777 });
    _assertStoreParentSnapshot(parentSnapshot);
    _assertExpectedSnapshot(file, expectedBytes, expectedIdentity);
    fs.renameSync(file, before);
    displaced = true;
    _assertStoreParentSnapshot(parentSnapshot);
    const captured = fs.lstatSync(before);
    const capturedBytes = fs.readFileSync(before);
    if (captured.isSymbolicLink() || !captured.isFile() || Number(captured.nlink) > 1
      || !_sameFileIdentity(captured, expectedIdentity) || !capturedBytes.equals(expectedBytes)) {
      const error = new Error('role store identity changed during compare-and-replace');
      error.code = 'E_CONCURRENT_MODIFICATION';
      error.backupFile = before;
      throw error;
    }
    fs.linkSync(next, file);
    detachCommittedHardLink(next, file, nextBytes);
    return { backupFile: before };
  } catch (error) {
    if (displaced && !fs.existsSync(file)) {
      // Restore by moving the captured inode back. A hard-link restore leaves
      // `before` attached and makes the live store fail its own nlink=1 guard.
      try { fs.renameSync(before, file); } catch {}
    }
    error.backupFile = error.backupFile || (fs.existsSync(before) ? before : null);
    throw error;
  }
}

function _writeRoleStoreIfUnchanged(file, expectedBytes, nextBytes, expectedIdentity, parentSnapshot) {
  if (process.platform === 'win32') {
    return writeBufferIfUnchanged(file, expectedBytes, nextBytes, { expectedIdentity });
  }
  return _writePosixIfUnchanged(file, expectedBytes, nextBytes, expectedIdentity, parentSnapshot);
}

function _writeNewRoleStore(file, nextBytes, parentSnapshot) {
  const temporary = path.join(path.dirname(file), `.agent-roles-create-${process.pid}-${crypto.randomBytes(12).toString('hex')}`);
  try {
    fs.writeFileSync(temporary, nextBytes, { flag: 'wx', mode: 0o600 });
    _assertStoreParentSnapshot(parentSnapshot);
    // link is an exclusive install: unlike rename it cannot overwrite a writer
    // that won the missing-store race. If the parent pathname was swapped, the
    // unpredictable source is absent in the replacement directory and the call
    // fails without creating the target there.
    fs.linkSync(temporary, file);
    detachCommittedHardLink(temporary, file, nextBytes);
    _assertStoreParentSnapshot(parentSnapshot);
    const installed = fs.lstatSync(file);
    if (installed.isSymbolicLink() || !installed.isFile() || Number(installed.nlink) !== 1
      || !fs.readFileSync(file).equals(nextBytes)) {
      const error = new Error('new role store failed post-install validation');
      error.code = 'E_CONCURRENT_MODIFICATION';
      throw error;
    }
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function saveRoles(root, roles, validatedState) {
  const file = rolesFile(root);
  if (!validatedState || validatedState[VALIDATED_STATE] !== true || validatedState.ok !== true) {
    throw new RoleStoreError(invalidState(
      'store_invalid',
      'validated-state-required',
      [{ code: 'validated-role-store-state-required', path: '$.legacyAssignments' }],
      { absoluteFile: file },
    ));
  }
  const baseValidation = schema.validateLegacyRoleStore(validatedState.document);
  if (!baseValidation.ok) {
    throw new RoleStoreError(invalidState(
      'store_invalid',
      'invalid-base-document',
      baseValidation.problems,
      { absoluteFile: file },
    ));
  }
  const document = cloneJson(validatedState.document, null);
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new RoleStoreError(invalidState(
      'store_invalid',
      'invalid-base-document',
      [{ code: 'document-not-object', path: '$.legacyAssignments' }],
      { absoluteFile: file },
    ));
  }
  document.schemaVersion = 1;
  document.updatedAt = new Date().toISOString();
  defineOwn(document, 'roles', safeRoleMap(roles));

  const validation = schema.validateLegacyRoleStore(document);
  const extensionProblems = validateExtendedRoles(document);
  if (!validation.ok || extensionProblems.length) {
    throw new RoleStoreError(invalidState(
      'store_invalid',
      'write-validation-failed',
      [...(validation.problems || []), ...extensionProblems],
      { absoluteFile: file },
    ));
  }

  const serialized = JSON.stringify(document, null, 2) + '\n';
  const attemptedBytes = Buffer.byteLength(serialized, 'utf8');
  if (attemptedBytes > MAX_STORE_BYTES) {
    throw new RoleStoreError(invalidState(
      'store_invalid',
      'write-too-large',
      [{ code: 'store-too-large', path: '$.legacyAssignments' }],
      { absoluteFile: file, bytes: attemptedBytes, maxBytes: MAX_STORE_BYTES },
    ));
  }

  mkdirp(path.dirname(file));
  const current = assertValid(readRoleStore(root));
  if (current.revision !== validatedState.revision
    || (current.fileExists && !_sameFileIdentity(current.fileIdentity, validatedState.fileIdentity))) {
    throw new RoleStoreError(invalidState(
      'store_invalid',
      'stale-base-document',
      [{ code: 'store-revision-changed', path: '$.legacyAssignments' }],
      { absoluteFile: file, revision: current.revision },
    ));
  }
  try {
    const nextBytes = Buffer.from(serialized, 'utf8');
    _assertStoreParentSnapshot(current.parentSnapshot);
    if (!current.fileExists) {
      _writeNewRoleStore(file, nextBytes, current.parentSnapshot);
    } else {
      if (!Buffer.isBuffer(validatedState.rawBytes) || !validatedState.fileIdentity) {
        throw Object.assign(new Error('validated role-store snapshot is incomplete'), { code: 'E_CONCURRENT_MODIFICATION' });
      }
      _writeRoleStoreIfUnchanged(file, validatedState.rawBytes, nextBytes, validatedState.fileIdentity, current.parentSnapshot);
      _assertStoreParentSnapshot(current.parentSnapshot);
    }
  } catch (error) {
    throw new RoleStoreError(invalidState(
      'store_invalid',
      'concurrent-modification',
      [{ code: 'store-revision-changed', path: '$.legacyAssignments' }],
      {
        absoluteFile: file,
        revision: current.revision,
        backupFile: error && error.backupFile ? error.backupFile : null,
      },
    ));
  }
  return file;
}

function updateRoles(root, mutate, withLock) {
  if (typeof withLock !== 'function') throw new TypeError('withLock is required');
  return withLock(rolesFile(root), () => {
    const state = assertValid(readRoleStore(root));
    const roles = safeRoleMap(state.roles);
    if (mutate(roles) === false) return null;
    return saveRoles(root, roles, state);
  });
}

function setRoleAssignment(roles, role, assignment) {
  const current = hasOwn(roles, role)
    && roles[role]
    && typeof roles[role] === 'object'
    && !Array.isArray(roles[role])
    ? cloneJson(roles[role], {})
    : {};
  current.provider = assignment.provider;
  current.model = assignment.model == null ? null : assignment.model;
  current.persona = assignment.persona || '';
  defineOwn(roles, role, current);
}

function resolveRole(root, role) {
  let roles;
  try { roles = loadRoles(root); }
  catch (error) {
    if (error instanceof RoleStoreError) return { role, storeError: publicError(error.roleStoreState) };
    throw error;
  }
  if (hasOwn(roles, role) && roles[role] && roles[role].provider) {
    return {
      role,
      provider: roles[role].provider,
      model: roles[role].model || null,
      persona: roles[role].persona || '',
      source: 'user',
    };
  }
  return null;
}

function validationSummary(root) {
  const state = readRoleStore(root);
  if (!state.ok) return state;
  const projection = schema.projectLegacyRoleStore(state.document);
  if (!projection.ok) {
    return invalidState(
      'store_invalid',
      'projection-invalid',
      projection.problems,
      { absoluteFile: state.absoluteFile, bytes: state.bytes },
    );
  }
  const validation = state.validation || {};
  return {
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    observation: OBSERVATION,
    ok: true,
    state: state.state,
    file: state.file,
    fileExists: state.fileExists,
    bytes: state.bytes,
    revision: state.revision,
    legacy: {
      schemaVersion: state.fileExists ? validation.version : null,
      unversioned: state.fileExists ? !!validation.unversioned : false,
      roleCount: Object.keys(state.roles).length,
      warningCount: (validation.warnings || []).length,
      warnings: (validation.warnings || []).slice(0, 20),
      unknownFieldCount: (validation.unknownFields || []).length,
    },
    projection: {
      roleDefinitionCount: Object.keys(projection.roleDefinitions.roles).length,
      agentCount: projection.agentInstances.agents.length,
      pipelineCount: Object.keys(projection.routingPolicy.pipelines).length,
      assignmentReady: projection.assignmentReady,
      assignmentGaps: projection.assignmentGaps,
      readinessScope: projection.readinessScope,
      providerReadinessChecked: projection.providerReadinessChecked,
      previewOnly: true,
      runtimeWiringApplied: false,
    },
    nativeV2Validation: {
      performed: false,
      files: [
        schema.STORE_FILES.roleDefinitions,
        schema.STORE_FILES.agentInstances,
        schema.STORE_FILES.routingPolicy,
      ],
      reason: 'legacy-projection-preview-only',
    },
    migrationApplied: false,
    readOnly: true,
    writesPerformed: false,
    originalPreserved: true,
    providerCommandsExecuted: false,
  };
}

module.exports = {
  STORE_RELATIVE_PATH,
  MAX_STORE_BYTES,
  OUTPUT_SCHEMA_VERSION,
  OBSERVATION,
  RoleStoreError,
  hasOwn,
  defineOwn,
  safeRoleMap,
  rolesFile,
  revisionForBytes,
  readRoleStore,
  loadRoles,
  saveRoles,
  updateRoles,
  setRoleAssignment,
  resolveRole,
  validationSummary,
  messageFor,
  publicError,
};
