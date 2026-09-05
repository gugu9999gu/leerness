'use strict';

// Compatibility-only admission: no descriptor creation, activation or fencing.
const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');
const SG = require('./state-git');
const W = require('./workspace-dir');
const MAX_DESCRIPTOR_BYTES = 16 * 1024;
const FIELDS = ['schema', 'schemaVersion', 'scope', 'generation', 'layout', 'requiredWriterProtocol'];
// Existing standalone module stores do not require a full initialized
// workspace. Reserve exact known names; an extra foreign name still refuses
// admission. This does not validate or read any of these stores' contents.
// Sources: state-inventory, role-store/fallback, and the named domain modules.
const STANDALONE_STORE_FILES = new Set([
  'agent-roles.json', 'providers.json', 'execution-ledger.jsonl',
  'decisions.json', 'decisions.md', 'lessons.json', 'lessons.md', 'task-log.md',
  'routing-log.json', 'current-state.md', 'session-handoff.md',
  'active-wakeups.json', 'auto-resume-plan.json', 'next-action-queue.json',
  'pre-wake-report.json', 'last-handoff.json', 'bugfix-receipts.json',
  'claims-baseline.json', 'previews.json', 'preview-config.json', 'referees.json',
  'tech-profile.json', 'toggles.json', 'leerness-config.json', 'permissions.json',
  'project-brief.md', 'plan.md', 'review-evidence.md', 'rules.md',
  'teams.json', 'teams.md', 'secret-baseline.json',
  // Legacy memory deletion/restoration retains these exact Markdown stores.
  'decisions.archive.md', 'lessons.archive.md', 'plan.archive.md', 'rules.archive.md',
]);
// role-store's POSIX CAS retains mkdtemp(".agent-roles-cas-")/before.
// Recognize that exact producer shape only beside its regular store. This
// grants no trust, cleanup permission, or content access to recovery data.
const ROLE_RECOVERY_DIRECTORY = /^\.agent-roles-cas-[A-Za-z0-9]{6}$/;
// _withLock reserves <store>.lock directories and releases them through
// <store>.lock.release-TOKEN (16 random bytes in lowercase hex). io.writeUtf8 writes
// <store>.tmp-PID-SEQ and may retain JSON originals as
// <store>.corrupt-TIME-PID-SEQ. The live file can be absent during either
// first installation or corruption evacuation; the exact known base name
// supplies the producer association without reading private store contents.
const STORE_AUXILIARY = /^(.+)\.(lock(?:\.release-[a-f0-9]{32})?|tmp-[1-9][0-9]*-[1-9][0-9]*|corrupt-[1-9][0-9]*-[1-9][0-9]*-[1-9][0-9]*)$/;
// Exclusive first-install files from role-store and role-fallback, respectively.
// io.detachCommittedHardLink may create one empty detacher beside that exact
// prepared alias when both alias removal methods fail after installation.
const STORE_CREATE_FILE = /^\.(?:agent-roles|execution-ledger)-create-[1-9][0-9]*-[a-f0-9]{24}(?:\.detach-[1-9][0-9]*-[a-f0-9]{16})?$/;
const fail = reasonCode => { throw Object.assign(new Error('Runtime layout could not be accepted.'), { reasonCode }); };
const envValue = name => {
  const values = Object.keys(process.env).filter(key => key.toUpperCase() === name).map(key => process.env[key]);
  if (new Set(values).size > 1) fail('environment_ambiguous');
  return values[0] || '';
};
const checkDiscoveryOverrides = () => {
  const across = envValue('GIT_DISCOVERY_ACROSS_FILESYSTEM');
  if (envValue('GIT_CEILING_DIRECTORIES') || (across && !/^(0|false|no|off)$/i.test(across))) {
    fail('discovery_override_unsupported');
  }
};
const statMaybe = file => {
  try { return fs.lstatSync(file, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; fail('layout_unreadable'); }
};
const sameIdentity = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino
  && a.mode === b.mode && a.nlink === b.nlink;

// An init target may not exist yet. Canonicalize only its existing ancestor.
function projectLocation(value) {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f]/.test(value)) fail('path_invalid');
  let current = path.resolve(value);
  const suffix = [];
  for (let depth = 0; depth < 128; depth++) {
    const stat = statMaybe(current);
    if (stat) {
      const ancestor = SG.canonicalDirectory(current);
      return { root: path.join(ancestor, ...suffix), ancestor };
    }
    const parent = path.dirname(current);
    if (parent === current) fail('path_not_found');
    suffix.unshift(path.basename(current));
    current = parent;
  }
  fail('path_depth_limit');
}

function hasBareMarker(root) {
  const device = fs.statSync(root, { bigint: true }).dev;
  let current = root;
  for (let depth = 0; depth < 128; depth++) {
    if (statMaybe(path.join(current, 'HEAD')) && statMaybe(path.join(current, 'objects'))
      && (statMaybe(path.join(current, 'refs')) || statMaybe(path.join(current, 'config')))) return true;
    const parent = path.dirname(current);
    if (parent === current || fs.statSync(parent, { bigint: true }).dev !== device) return false;
    current = parent;
  }
  fail('path_depth_limit');
}

function optionalGit(root) {
  try { return SG.resolveGitTopology(root); }
  catch (error) {
    if (error.code !== 'git_missing') throw error;
    // No executable is acceptable only for positively observed non-repositories.
    if (SG.hasRepositoryMarker(root, process.env) || hasBareMarker(root)) fail('git_missing');
    return null;
  }
}

// A topology snapshot saves Git invocations, not admission decisions. In
// particular, creating Git metadata after a non-Git reader was constructed
// must not keep admitting the old project-local backend.
function verifyTopology(snapshot, current) {
  if (!snapshot.git) {
    if (SG.hasRepositoryMarker(current.ancestor, process.env) || hasBareMarker(current.ancestor)) {
      fail('topology_changed');
    }
    return;
  }
  const { worktreeRoot, gitDir } = snapshot.git;
  for (const location of snapshot.topologyDirectories) {
    const stat = statMaybe(location.file);
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()
      || stat.dev !== location.stat.dev || stat.ino !== location.stat.ino
      || SG.canonicalDirectory(location.file) !== location.file) fail('topology_changed');
  }
  let directory = current.ancestor;
  for (let depth = 0; depth < 128; depth++) {
    if (directory === worktreeRoot) {
      const marker = statMaybe(path.join(directory, '.git'));
      const before = snapshot.gitMarker;
      if (!marker || marker.isSymbolicLink() || !before || marker.dev !== before.dev || marker.ino !== before.ino
        || marker.isFile() !== before.isFile() || (marker.isFile() && (marker.size !== before.size
          || marker.mtimeNs !== before.mtimeNs || marker.ctimeNs !== before.ctimeNs))) fail('topology_changed');
      return;
    }
    if (statMaybe(path.join(directory, '.git'))) fail('topology_changed');
    const parent = path.dirname(directory);
    if (parent === directory) fail('topology_changed');
    directory = parent;
  }
  fail('path_depth_limit');
}

// Check each component without following workspace/descriptor parent links.
function checkedPath(base, parts) {
  let file = base;
  const parents = [];
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) file = path.join(file, parts[i]);
    const stat = statMaybe(file);
    if (!stat) return { file: path.join(base, ...parts), stat: null, parents };
    if (stat.isSymbolicLink()) fail('layout_linked');
    if (i < parts.length - 1) {
      if (!stat.isDirectory()) fail('layout_parent_invalid');
      parents.push({ file, stat });
    } else return { file, stat, parents };
  }
  fail('layout_path_invalid');
}
const verifyParents = parents => {
  for (const before of parents) {
    const after = statMaybe(before.file);
    if (!sameIdentity(before.stat, after) || !after.isDirectory()) fail('layout_changed');
  }
};
const assertRegular = stat => {
  if (!stat || !stat.isFile()) fail('descriptor_not_regular');
  if (stat.nlink !== 1n) fail('descriptor_hard_linked');
  if (stat.size > BigInt(MAX_DESCRIPTOR_BYTES)) fail('descriptor_too_large');
};

function readDescriptor(location) {
  assertRegular(location.stat);
  let fd;
  try {
    // A replacement with a FIFO between lstat and open must not block the
    // reader before fstat can reject it as non-regular (where supported).
    fd = fs.openSync(location.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
      | (fs.constants.O_NONBLOCK || 0));
    const opened = fs.fstatSync(fd, { bigint: true });
    assertRegular(opened);
    if (!sameIdentity(opened, location.stat)) fail('layout_changed');
    const bytes = Buffer.alloc(MAX_DESCRIPTOR_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, length);
      if (!count) break;
      length += count;
    }
    if (length > MAX_DESCRIPTOR_BYTES) fail('descriptor_too_large');
    const after = fs.fstatSync(fd, { bigint: true });
    const named = statMaybe(location.file);
    if (!sameIdentity(opened, after) || !sameIdentity(after, named) || named.isSymbolicLink()
      || opened.size !== BigInt(length) || after.size !== opened.size
      || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) fail('layout_changed');
    verifyParents(location.parents);
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)); }
    catch { fail('descriptor_invalid_utf8'); }
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function decodeDescriptor(text, scope) {
  let data;
  try { data = JSON.parse(text); } catch { fail('descriptor_invalid_json'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('descriptor_invalid');
  const keys = Object.keys(data);
  if (keys.length !== FIELDS.length || keys.some(key => !FIELDS.includes(key))) fail('descriptor_invalid');
  // The schema is flat and scalar. Count syntactic keys, decoding escapes first,
  // so duplicate or escaped-duplicate keys cannot be hidden by JSON.parse.
  const sourceKeys = [...text.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)].map(match => JSON.parse(`"${match[1]}"`));
  if (sourceKeys.length !== keys.length || new Set(sourceKeys).size !== keys.length) fail('descriptor_duplicate_key');
  if (typeof data.schema !== 'string' || !Number.isSafeInteger(data.schemaVersion) || data.schemaVersion < 1
    || typeof data.scope !== 'string' || !Number.isSafeInteger(data.generation) || data.generation < 1
    || typeof data.layout !== 'string' || !Number.isSafeInteger(data.requiredWriterProtocol)
    || data.requiredWriterProtocol < 1) fail('descriptor_invalid');
  if (data.scope !== scope) fail('descriptor_scope_mismatch');
  if (data.schema !== 'leerness.runtime-layout/v1' || data.schemaVersion !== 1
    || data.requiredWriterProtocol !== 1 || data.layout !== 'legacy') fail('layout_unsupported');
  return data;
}

function standaloneEntryAllowed(directory, name) {
  const recovery = ROLE_RECOVERY_DIRECTORY.test(name);
  const auxiliary = STORE_AUXILIARY.exec(name);
  const knownAuxiliary = auxiliary && STANDALONE_STORE_FILES.has(auxiliary[1])
    && (!auxiliary[2].startsWith('corrupt-') || auxiliary[1].endsWith('.json'));
  // Unknown names fail even if they disappear after workspace enumeration.
  if (!STANDALONE_STORE_FILES.has(name) && !recovery && !knownAuxiliary && !STORE_CREATE_FILE.test(name)) return false;
  const stat = statMaybe(path.join(directory, name));
  // A competing producer can release its lock or rename its temporary file
  // between readdir and lstat. Absence introduces no foreign object.
  if (!stat) return true;
  if (stat.isSymbolicLink()) return false;
  if (recovery) {
    const store = statMaybe(path.join(directory, 'agent-roles.json'));
    return stat.isDirectory() && store && store.isFile() && !store.isSymbolicLink();
  }
  return knownAuxiliary && auxiliary[2].startsWith('lock') ? stat.isDirectory() : stat.isFile();
}

function validateWorkspace(root) {
  const snapshot = W.inspectWorkspace(root);
  if (snapshot.legacy.inspectionError || snapshot.canonical.inspectionError) fail('workspace_unreadable');
  W.selectWorkspaceDirName(snapshot, envValue('LEERNESS_WORKSPACE_DIR'));
  if (snapshot.legacy.exists && !snapshot.legacy.live && snapshot.legacy.entries.length) fail('workspace_ambiguous');
  if (snapshot.canonical.foreign) {
    const standalone = snapshot.canonical.isDirectory && snapshot.canonical.nonSubstrateEntries
      .every(name => standaloneEntryAllowed(snapshot.canonical.abs, name));
    // These stores have their own authority; they are not the migratable
    // pre-existing structured-state substrate beside a live legacy store.
    if (!standalone || snapshot.legacy.live) fail('workspace_ambiguous');
  }
}

function disposition(reasonCode, scope = 'unknown', observedLayout = 'unknown') {
  const compatible = reasonCode === 'legacy_absent' || reasonCode === 'legacy_supported';
  return { schema: 'leerness.runtime-compatibility/v1', schemaVersion: 1, ok: compatible, compatible,
    writeDisposition: compatible ? 'allowed' : 'blocked', reasonCode, scope, observedLayout,
    supportedWriterProtocol: 1, activationSupported: false, workspaceAdmission: 'operation-start' };
}
function failureReport(error, scope) {
  const known = error instanceof SG.StatePathError || error instanceof W.WorkspaceDirectoryError;
  const reason = error.reasonCode || (known ? String(error.code).replace(/^E_/, '').toLowerCase() : 'layout_unreadable');
  return disposition(reason, scope, reason === 'layout_unsupported' ? 'unsupported' : 'unknown');
}

function inspectSnapshot(snapshot) {
  const { root, ancestor, git, scope } = snapshot;
  try {
    checkDiscoveryOverrides();
    // A newly-created target may no longer be the path admitted by this snapshot.
    const current = projectLocation(root);
    if (current.root !== root) fail('layout_changed');
    const ancestorNow = SG.canonicalDirectory(ancestor);
    if (ancestorNow !== ancestor) fail('layout_changed');
    verifyTopology(snapshot, current);
    // Ownership/selection was admitted when this operation started. A legacy
    // init or lock-owned workspace migration creates temporary names and may
    // briefly be dual-live. Do not reclassify its own intermediate contents.
    // Each fixed path walk below still checks fresh directory kinds/links and
    // runtime indicators. A new public inspection makes a new admission.
    const canonical = name => checkedPath(root, [W.CANONICAL_WORKSPACE_DIR, 'cache', name]);
    const alternate = name => checkedPath(root, [W.LEGACY_WORKSPACE_DIR, 'cache', name]);
    if (alternate('state-layout.json').stat || alternate('state-runtime').stat) fail('alternate_layout_present');
    const localDescriptor = canonical('state-layout.json');
    const localRuntime = canonical('state-runtime');
    if (git && (localDescriptor.stat || localRuntime.stat)) fail('backend_transition_unresolved');
    if (!git && localRuntime.stat) fail('runtime_without_compatible_layout');
    const location = git ? checkedPath(git.gitDir, ['leerness', 'layout.json']) : localDescriptor;
    if (git && checkedPath(git.gitDir, ['leerness', 'projects']).stat) fail('runtime_without_compatible_layout');
    if (!location.stat) return disposition('legacy_absent', scope, 'legacy');
    decodeDescriptor(readDescriptor(location), scope);
    return disposition('legacy_supported', scope, 'legacy');
  } catch (error) { return failureReport(error, scope); }
}

function createRuntimeCompatibilityReader(root = process.cwd()) {
  try {
    checkDiscoveryOverrides();
    const location = projectLocation(root);
    const git = optionalGit(location.ancestor);
    validateWorkspace(location.root);
    const topologyDirectories = git ? [...new Set([git.worktreeRoot, git.gitDir])]
      .map(file => ({ file, stat: statMaybe(file) })) : [];
    if (topologyDirectories.some(value => !value.stat)) fail('topology_changed');
    const gitMarker = git ? statMaybe(path.join(git.worktreeRoot, '.git')) : null;
    const snapshot = Object.freeze({ ...location, git, topologyDirectories, gitMarker,
      scope: git ? 'worktree' : 'project-local' });
    return () => inspectSnapshot(snapshot);
  } catch (error) { return () => failureReport(error, 'unknown'); }
}
const inspectRuntimeCompatibility = root => createRuntimeCompatibilityReader(root)();
function assertRuntimeWriteAllowed(root) {
  const report = inspectRuntimeCompatibility(root);
  if (report.compatible) return report;
  throw Object.assign(new Error('Runtime layout is incompatible; no metadata write is allowed.'), {
    code: 'E_RUNTIME_LAYOUT_INCOMPATIBLE', reasonCode: report.reasonCode,
  });
}

module.exports = { MAX_DESCRIPTOR_BYTES, createRuntimeCompatibilityReader, inspectRuntimeCompatibility, assertRuntimeWriteAllowed };
