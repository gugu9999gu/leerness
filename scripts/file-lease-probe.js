#!/usr/bin/env node
'use strict';

// Exact-file leases are an opt-in coordination primitive. This probe deliberately
// distinguishes them from the discarded ambient scope advisory: only explicit calls
// may produce a conflict, unrelated files and separate roots remain independent, and
// read-only list/check calls must not rewrite project state.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const FL = require('../lib/file-leases');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const LEGACY_DIR = '.' + 'harness';
const roots = [];
let total = 0;
let failed = 0;

const controlledEnvKeys = new Set([
  'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
  'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'LEERNESS_SESSION_ID', 'CODEX_THREAD_ID',
  'LEERNESS_MCP_ADDRESS_EXPLICIT', 'LEERNESS_MCP_PROFILE', 'LEERNESS_NO_SESSION_PRESENCE',
  'CI', 'GITHUB_ACTIONS', 'CLAUDECODE', 'CURSOR_AGENT', 'CODEX_MANAGED_BY_NPM',
].map(key => key.toLowerCase()));
const baseEnv = {
  ...process.env,
  LEERNESS_OFFLINE: '1',
  LEERNESS_NO_PROMPT: '1',
  LEERNESS_NO_AUTOCHCP: '1',
  LEERNESS_NO_AUTO_ROADMAP: '1',
  LEERNESS_NO_AUTO_REVIEW: '1',
  LEERNESS_NO_BANNER: '1',
};
for (const key of Object.keys(baseEnv)) {
  if (controlledEnvKeys.has(key.toLowerCase())) delete baseEnv[key];
}

function check(label, condition, detail = '') {
  total++;
  const ok = !!condition;
  process.stdout.write(`${ok ? '✓' : '✗'} ${label}${!ok && detail ? `\n    ${detail}` : ''}\n`);
  if (!ok) failed++;
}

function parseJson(result) {
  try { return JSON.parse(String(result.stdout || '').trim()); } catch { return null; }
}

function run(root, args, options = {}) {
  return cp.spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    env: { ...baseEnv, ...(options.env || {}) },
    encoding: 'utf8',
    timeout: options.timeout || 180000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function runLease(root, args, options = {}) {
  return run(root, ['lease', ...args, '--path', root, '--json'], options);
}

function fresh(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `leerness-file-lease-${name}-`));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: `lease-${name}`, version: '0.0.0' }) + '\n', 'utf8');
  const initialized = run(root, ['init', root, '--yes', '--minimal', '--language', 'en', '--no-stale-check', '--json']);
  if (initialized.status !== 0) {
    throw new Error(`init failed for ${name}: ${initialized.status}\n${initialized.stdout}\n${initialized.stderr}`);
  }
  return root;
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function snapshotTree(root, stateDir = '.leerness') {
  const base = path.join(root, stateDir);
  const rows = [];
  function walk(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(base, full).split(path.sep).join('/');
      const lst = fs.lstatSync(full);
      if (entry.isDirectory()) {
        rows.push({ rel, type: 'dir' });
        walk(full);
      } else if (entry.isSymbolicLink()) {
        rows.push({ rel, type: 'link', target: fs.readlinkSync(full) });
      } else {
        const bytes = fs.readFileSync(full);
        rows.push({ rel, type: 'file', size: bytes.length, sha256: hash(bytes), mtimeMs: lst.mtimeMs });
      }
    }
  }
  walk(base);
  return JSON.stringify(rows);
}

function storeFile(root) {
  return path.join(root, '.leerness', 'cache', 'file-leases.json');
}

function storeBytes(root) {
  try { return fs.readFileSync(storeFile(root)); } catch { return null; }
}

function makeDirLink(target, link) {
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

function rpcCall(name, args, id) {
  return JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
}

function runMcp(root, calls) {
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'file-lease-probe', version: '1' },
    } }),
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    ...calls,
  ].join('\n') + '\n';
  const result = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve', '--profile', 'full'], {
    cwd: root,
    input,
    env: baseEnv,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const messages = String(result.stdout || '').split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  return { result, messages, byId: id => messages.find(message => message.id === id) || null };
}

function toolJson(batch, id) {
  const text = batch.byId(id)?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return null; }
}

function runAsync(root, args) {
  return new Promise(resolve => {
    const child = cp.spawn(process.execPath, [CLI, ...args], {
      cwd: root,
      env: baseEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => resolve({ status: null, stdout, stderr, error }));
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

async function main() {
  const alpha = 'lease-alpha-session';
  const bravo = 'lease-bravo-session';
  const charlie = 'lease-charlie-session';
  const root = fresh('main');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'module.exports = 1;\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'b.js'), 'module.exports = 2;\n', 'utf8');

  const beforeRead = snapshotTree(root);
  const emptyList = runLease(root, ['list']);
  const emptyCheck = runLease(root, ['check', 'src/a.js']);
  const afterRead = snapshotTree(root);
  check('list/check are read-only and do not create a lease store',
    emptyList.status === 0 && parseJson(emptyList)?.storeState === 'missing'
      && emptyCheck.status === 0 && parseJson(emptyCheck)?.available === true
      && !fs.existsSync(storeFile(root)) && beforeRead === afterRead,
    `list=${emptyList.status}/${emptyList.stdout} check=${emptyCheck.status}/${emptyCheck.stdout}`);

  const acquiredA = runLease(root, ['acquire', 'src/a.js', '--session', alpha, '--ttl', '300', '--note', 'alpha owns a']);
  const a = parseJson(acquiredA);
  check('session A acquires one exact file',
    acquiredA.status === 0 && a?.action === 'acquired' && /^lease-[0-9a-f]{16}$/.test(a?.lease?.leaseId || '')
      && a?.lease?.file === 'src/a.js' && a?.lease?.sessionKey === alpha
      && a?.target?.exists === true && a?.target?.identityObserved === true
      && a?.advisoryOnly === true && a?.ambientWarnings === false,
    acquiredA.stdout || acquiredA.stderr);

  const acquiredSibling = runLease(root, ['acquire', 'src/b.js', '--session', bravo, '--ttl', '300']);
  check('unrelated sibling file does not conflict',
    acquiredSibling.status === 0 && parseJson(acquiredSibling)?.action === 'acquired',
    acquiredSibling.stdout || acquiredSibling.stderr);

  const beforeConflict = storeBytes(root);
  const conflict = runLease(root, ['acquire', 'src/a.js', '--session', bravo, '--ttl', '300']);
  const conflictJson = parseJson(conflict);
  const afterConflict = storeBytes(root);
  check('same exact file conflicts synchronously and preserves store bytes',
    conflict.status === 1 && conflictJson?.code === 'lease_conflict'
      && conflictJson?.details?.conflict?.sessionKey === alpha
      && Buffer.compare(beforeConflict, afterConflict) === 0,
    conflict.stdout || conflict.stderr);

  const renewed = runLease(root, ['acquire', 'src/a.js', '--session', alpha, '--ttl', '600', '--note', 'renewed']);
  const renewedJson = parseJson(renewed);
  check('same-session reacquire renews the existing lease identity',
    renewed.status === 0 && renewedJson?.action === 'renewed'
      && renewedJson?.lease?.leaseId === a?.lease?.leaseId
      && renewedJson?.lease?.acquiredAt === a?.lease?.acquiredAt
      && renewedJson?.lease?.expiresAt !== a?.lease?.expiresAt
      && renewedJson?.lease?.note === 'renewed',
    renewed.stdout || renewed.stderr);

  const ownCheck = runLease(root, ['check', 'src/a.js', '--session', alpha]);
  const peerCheck = runLease(root, ['check', 'src/a.js', '--session', bravo]);
  check('check distinguishes self ownership from peer conflict',
    ownCheck.status === 0 && parseJson(ownCheck)?.ownedBySession === true
      && peerCheck.status === 1 && parseJson(peerCheck)?.available === false
      && parseJson(peerCheck)?.lease?.sessionKey === alpha,
    `own=${ownCheck.stdout} peer=${peerCheck.stdout}`);

  const filtered = runLease(root, ['list', '--session', alpha]);
  const allActive = runLease(root, ['list']);
  const ambientSessionList = runLease(root, ['list'], { env: { LEERNESS_SESSION_ID: alpha } });
  const ambientSessionCheck = runLease(root, ['check', 'src/a.js'], { env: { LEERNESS_SESSION_ID: alpha } });
  check('list filters only when --session is explicit and never infers ambient scope',
    filtered.status === 0 && parseJson(filtered)?.shown === 1
      && parseJson(filtered)?.leases?.[0]?.sessionKey === alpha
      && allActive.status === 0 && parseJson(allActive)?.active === 2
      && parseJson(allActive)?.ambientWarnings === false
      && ambientSessionList.status === 0 && parseJson(ambientSessionList)?.shown === 2
      && ambientSessionCheck.status === 1 && parseJson(ambientSessionCheck)?.ownedBySession === false,
    `filtered=${filtered.stdout} all=${allActive.stdout} ambient=${ambientSessionList.stdout} check=${ambientSessionCheck.stdout}`);

  const beforeReadExisting = snapshotTree(root);
  const bytesBeforeRead = storeBytes(root);
  const readList = runLease(root, ['list', '--all', '--language', 'en']);
  const readCheck = runLease(root, ['check', 'src/b.js', '--session', bravo, '--language', 'ko']);
  const bytesAfterRead = storeBytes(root);
  const afterReadExisting = snapshotTree(root);
  check('list/check do not rewrite an existing store or any tracked project state',
    readList.status === 0 && readCheck.status === 0
      && Buffer.compare(bytesBeforeRead, bytesAfterRead) === 0
      && beforeReadExisting === afterReadExisting,
    `list=${readList.status} check=${readCheck.status}`);

  const wrongOwnerBefore = storeBytes(root);
  const wrongRelease = runLease(root, ['release', a.lease.leaseId, '--session', bravo]);
  const wrongOwnerAfter = storeBytes(root);
  check('only the owning session can release a lease',
    wrongRelease.status === 1 && parseJson(wrongRelease)?.code === 'lease_owner_mismatch'
      && Buffer.compare(wrongOwnerBefore, wrongOwnerAfter) === 0,
    wrongRelease.stdout || wrongRelease.stderr);

  const controlAction = run(root, ['lease', 'bad\n\u001b[31mFAKE', '--path', root, '--json']);
  const controlPayload = parseJson(controlAction);
  const controlFileBefore = storeBytes(root);
  const controlFile = runLease(root, ['acquire', 'bad\nfile.js', '--session', alpha, '--ttl', '300']);
  const longFile = runLease(root, ['acquire', 'x'.repeat(2049), '--session', alpha, '--ttl', '300']);
  check('lease diagnostics and target paths reject terminal controls and overlong names',
    controlAction.status === 1 && controlPayload?.code === 'unknown_subcommand'
      && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(controlPayload?.error || '')
      && controlFile.status === 1 && parseJson(controlFile)?.code === 'invalid_file'
      && longFile.status === 1 && parseJson(longFile)?.code === 'invalid_file'
      && Buffer.compare(controlFileBefore, storeBytes(root)) === 0,
    `action=${controlAction.stdout} file=${controlFile.stdout} long=${longFile.stdout}`);

  const foreignFlagBefore = snapshotTree(root);
  const foreignSession = run(root, ['status', root, '--session', alpha, '--json']);
  const foreignTtl = run(root, ['status', root, '--ttl', '300', '--json']);
  const foreignFlagAfter = snapshotTree(root);
  check('lease-only flags are rejected by unrelated commands before any write',
    foreignSession.status === 1 && parseJson(foreignSession)?.code === 'unknown_flag'
      && foreignTtl.status === 1 && parseJson(foreignTtl)?.code === 'unknown_flag'
      && foreignFlagBefore === foreignFlagAfter,
    `session=${foreignSession.stdout} ttl=${foreignTtl.stdout}`);

  const invalidBefore = storeBytes(root);
  const duplicateLeaseFlags = [
    runLease(root, ['acquire', 'src/duplicate-session.js', '--session', alpha, '--session', bravo, '--ttl', '300']),
    runLease(root, ['acquire', 'src/duplicate-ttl.js', '--session', alpha, '--ttl', '300', '--ttl', '301']),
    runLease(root, ['acquire', 'src/duplicate-note.js', '--session', alpha, '--ttl', '300', '--note', 'first', '--note', 'second']),
  ];
  check('security-sensitive lease values are singletons and duplicates cannot mutate state',
    duplicateLeaseFlags.every(result => result.status === 1 && parseJson(result)?.code === 'duplicate_flag')
      && Buffer.compare(invalidBefore, storeBytes(root)) === 0,
    duplicateLeaseFlags.map(result => result.stdout || result.stderr).join(' | '));
  const extraArgs = [
    runLease(root, ['list', 'unexpected']),
    runLease(root, ['check', 'src/a.js', 'unexpected', '--session', alpha]),
    runLease(root, ['acquire', 'src/extra.js', 'unexpected', '--session', alpha, '--ttl', '300']),
  ];
  const invalidTtls = ['29', '1801', '30.5'].map(ttl => runLease(root,
    ['acquire', 'src/ttl.js', '--session', charlie, '--ttl', ttl]));
  const missingSession = runLease(root, ['acquire', 'src/session.js']);
  const invalidAmbientSession = runLease(root, ['acquire', 'src/session-env.js'], {
    env: { LEERNESS_SESSION_ID: 'bad', CODEX_THREAD_ID: alpha },
  });
  const emptyAction = run(root, ['lease', '', '--path', root, '--json']);
  const invalidAfter = storeBytes(root);
  check('arity, TTL bounds, and stable session identity fail closed before mutation',
    extraArgs.every(result => result.status === 1 && parseJson(result)?.code === 'too_many_arguments')
      && invalidTtls.every(result => result.status === 1 && parseJson(result)?.code === 'invalid_flag_value')
      && missingSession.status === 1 && parseJson(missingSession)?.code === 'invalid_session_key'
      && invalidAmbientSession.status === 1 && parseJson(invalidAmbientSession)?.code === 'invalid_session_key'
      && emptyAction.status === 1 && parseJson(emptyAction)?.code === 'unknown_subcommand'
      && Buffer.compare(invalidBefore, invalidAfter) === 0,
    `extra=${extraArgs.map(r => r.stdout).join(' | ')} ttls=${invalidTtls.map(r => r.stdout).join(' | ')} session=${missingSession.stdout} env=${invalidAmbientSession.stdout} action=${emptyAction.stdout}`);

  const released = runLease(root, ['release', a.lease.leaseId, '--session', alpha]);
  const afterReleaseAcquire = runLease(root, ['acquire', 'src/a.js', '--session', bravo, '--ttl', '300']);
  check('owner release immediately makes the exact file available to another session',
    released.status === 0 && parseJson(released)?.action === 'released'
      && afterReleaseAcquire.status === 0 && parseJson(afterReleaseAcquire)?.lease?.sessionKey === bravo,
    `release=${released.stdout} acquire=${afterReleaseAcquire.stdout}`);

  const missingFile = runLease(root, ['acquire', 'src/future.js', '--session', charlie, '--ttl', '300']);
  const leadingSpaceName = ' leading-space.js';
  fs.writeFileSync(path.join(root, leadingSpaceName), 'space\n', 'utf8');
  const leadingSpaceLease = runLease(root, ['acquire', leadingSpaceName, '--session', alpha, '--ttl', '300']);
  check('missing targets are supported and exact filename whitespace is preserved',
    missingFile.status === 0 && parseJson(missingFile)?.target?.exists === false
      && parseJson(missingFile)?.lease?.file === 'src/future.js'
      && leadingSpaceLease.status === 0 && parseJson(leadingSpaceLease)?.lease?.file === leadingSpaceName,
    `missing=${missingFile.stdout} space=${leadingSpaceLease.stdout}`);
  if (process.platform === 'win32') {
    const windowsAliasBefore = storeBytes(root);
    const trailingDot = runLease(root, ['acquire', 'windows-alias.js.', '--session', alpha, '--ttl', '300']);
    const ads = runLease(root, ['acquire', 'windows-alias.js:stream', '--session', alpha, '--ttl', '300']);
    const invalidCharacters = ['<', '>', '"', '|', '?', '*'].map(character =>
      runLease(root, ['acquire', `windows-${character}-alias.js`, '--session', alpha, '--ttl', '300']));
    check('Windows lexical aliases, invalid filename characters, and alternate data streams are rejected before mutation',
      trailingDot.status === 1 && parseJson(trailingDot)?.code === 'invalid_file'
        && ads.status === 1 && parseJson(ads)?.code === 'invalid_file'
        && invalidCharacters.every(result => result.status === 1 && parseJson(result)?.code === 'invalid_file')
        && Buffer.compare(windowsAliasBefore, storeBytes(root)) === 0,
      `dot=${trailingDot.stdout} ads=${ads.stdout} chars=${invalidCharacters.map(result => result.stdout).join(' | ')}`);
    const caseBase = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-case-sensitive-root-'));
    let caseSensitiveSupported = false;
    let caseEscapeError = null;
    let unicodeCaseEscapeError = null;
    try {
      const enabled = cp.spawnSync('fsutil.exe', ['file', 'SetCaseSensitiveInfo', caseBase, 'enable'], {
        encoding: 'utf8', windowsHide: true, timeout: 10000,
      });
      if (enabled.status === 0) {
        const upperRoot = path.join(caseBase, 'Repo');
        const lowerPeer = path.join(caseBase, 'repo');
        fs.mkdirSync(path.join(upperRoot, '.leerness'), { recursive: true });
        fs.mkdirSync(lowerPeer);
        const peerFile = path.join(lowerPeer, 'outside.js');
        fs.writeFileSync(peerFile, 'outside\n', 'utf8');
        caseSensitiveSupported = fs.existsSync(path.join(caseBase, 'Repo')) && fs.existsSync(path.join(caseBase, 'repo'));
        if (caseSensitiveSupported) {
          try { FL.resolveTarget(upperRoot, peerFile); }
          catch (error) { caseEscapeError = error; }
          const unicodeUpperRoot = path.join(caseBase, '\u00c4');
          const unicodeLowerPeer = path.join(caseBase, '\u00e4');
          fs.mkdirSync(unicodeUpperRoot);
          fs.mkdirSync(unicodeLowerPeer);
          const unicodePeerFile = path.join(unicodeLowerPeer, 'outside.js');
          fs.writeFileSync(unicodePeerFile, 'outside unicode\n', 'utf8');
          try { FL.resolveTarget(unicodeUpperRoot, unicodePeerFile); }
          catch (error) { unicodeCaseEscapeError = error; }
        }
      }
      check('Windows case-sensitive sibling roots cannot bypass project containment',
        !caseSensitiveSupported || (caseEscapeError?.code === 'path_escape'
          && unicodeCaseEscapeError?.code === 'path_escape'),
        JSON.stringify({ caseSensitiveSupported, error: caseEscapeError && caseEscapeError.code, unicodeError: unicodeCaseEscapeError && unicodeCaseEscapeError.code }));
    } finally {
      fs.rmSync(caseBase, { recursive: true, force: true });
    }
  } else {
    const literalBackslash = 'literal\\name.js';
    fs.writeFileSync(path.join(root, literalBackslash), 'backslash\n', 'utf8');
    const backslashLease = runLease(root, ['acquire', literalBackslash, '--session', alpha, '--ttl', '300']);
    const backslashList = runLease(root, ['list', '--all']);
    check('POSIX literal backslashes round-trip without self-invalidating the store',
      backslashLease.status === 0 && parseJson(backslashLease)?.lease?.file === literalBackslash
        && backslashList.status === 0,
      `lease=${backslashLease.stdout} list=${backslashList.stdout}`);
  }

  const legacyRoot = fresh('legacy-preflight');
  fs.renameSync(path.join(legacyRoot, '.leerness'), path.join(legacyRoot, LEGACY_DIR));
  const legacyBefore = snapshotTree(legacyRoot, LEGACY_DIR);
  const legacyBadFlag = run(legacyRoot, ['lease', 'acquire', 'x.js', '--session', alpha, '--all', '--path', legacyRoot, '--json']);
  const legacyBadTtl = run(legacyRoot, ['lease', 'acquire', 'x.js', '--session', alpha, '--ttl', '29', '--path', legacyRoot, '--json']);
  const legacyBadSession = run(legacyRoot, ['lease', 'acquire', 'x.js', '--session', 'bad', '--ttl', '300', '--path', legacyRoot, '--json']);
  const legacyBadAction = run(legacyRoot, ['lease', 'typo', '--path', legacyRoot, '--json']);
  const legacyMissingFile = run(legacyRoot, ['lease', 'acquire', '--session', alpha, '--path', legacyRoot, '--json']);
  const legacyExtraArg = run(legacyRoot, ['lease', 'list', 'unexpected', '--path', legacyRoot, '--json']);
  const legacyMissingSession = run(legacyRoot, ['lease', 'acquire', 'x.js', '--path', legacyRoot, '--json']);
  const legacyBadTarget = run(legacyRoot, ['lease', 'acquire', '../outside.js', '--session', alpha, '--path', legacyRoot, '--json']);
  const legacyBadLeaseId = run(legacyRoot, ['lease', 'release', 'bad-id', '--session', alpha, '--path', legacyRoot, '--json']);
  check('invalid lease flags, values, actions, and arity are rejected before legacy workspace migration',
    legacyBadFlag.status === 1 && parseJson(legacyBadFlag)?.code === 'unknown_flag'
      && legacyBadTtl.status === 1 && parseJson(legacyBadTtl)?.code === 'invalid_flag_value'
      && legacyBadSession.status === 1 && parseJson(legacyBadSession)?.code === 'invalid_flag_value'
      && legacyBadAction.status === 1 && parseJson(legacyBadAction)?.code === 'unknown_subcommand'
      && legacyMissingFile.status === 1 && parseJson(legacyMissingFile)?.code === 'missing_file'
      && legacyExtraArg.status === 1 && parseJson(legacyExtraArg)?.code === 'too_many_arguments'
      && legacyMissingSession.status === 1 && parseJson(legacyMissingSession)?.code === 'invalid_session_key'
      && legacyBadTarget.status === 1 && parseJson(legacyBadTarget)?.code === 'path_escape'
      && legacyBadLeaseId.status === 1 && parseJson(legacyBadLeaseId)?.code === 'invalid_lease_id'
      && !fs.existsSync(path.join(legacyRoot, '.leerness'))
      && fs.existsSync(path.join(legacyRoot, LEGACY_DIR))
      && legacyBefore === snapshotTree(legacyRoot, LEGACY_DIR),
    `flag=${legacyBadFlag.stdout} ttl=${legacyBadTtl.stdout} session=${legacyBadSession.stdout} action=${legacyBadAction.stdout} missing=${legacyMissingFile.stdout} extra=${legacyExtraArg.stdout} missingSession=${legacyMissingSession.stdout} target=${legacyBadTarget.stdout} leaseId=${legacyBadLeaseId.stdout}`);

  const traversalBefore = storeBytes(root);
  const unsafeFormatting = ['src/bidi-\u202efile.js', 'src/isolate-\u2066file.js', 'src/shorthand-\u{1bca0}file.js']
    .map(file => runLease(root, ['acquire', file, '--session', alpha, '--ttl', '300']));
  check('bidi and default-ignorable path formatting is rejected before mutation',
    unsafeFormatting.every(result => result.status === 1 && parseJson(result)?.code === 'invalid_file')
      && Buffer.compare(traversalBefore, storeBytes(root)) === 0,
    unsafeFormatting.map(result => result.stdout || result.stderr).join(' | '));

  const traversal = runLease(root, ['acquire', '../outside.js', '--session', alpha, '--ttl', '300']);
  check('relative traversal is rejected without changing lease state',
    traversal.status === 1 && parseJson(traversal)?.code === 'path_escape'
      && Buffer.compare(traversalBefore, storeBytes(root)) === 0,
    traversal.stdout || traversal.stderr);

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-file-lease-outside-'));
  roots.push(outside);
  fs.writeFileSync(path.join(outside, 'outside.js'), 'outside\n', 'utf8');
  const outwardLink = path.join(root, 'outward-link');
  makeDirLink(outside, outwardLink);
  const outward = runLease(root, ['acquire', 'outward-link/outside.js', '--session', alpha, '--ttl', '300']);
  check('outward symlink or junction targets are rejected',
    outward.status === 1 && parseJson(outward)?.code === 'path_escape',
    outward.stdout || outward.stderr);

  const realDir = path.join(root, 'real-dir');
  fs.mkdirSync(realDir, { recursive: true });
  fs.writeFileSync(path.join(realDir, 'inside.js'), 'inside\n', 'utf8');
  const inwardLink = path.join(root, 'inward-link');
  makeDirLink(realDir, inwardLink);
  const inwardA = runLease(root, ['acquire', 'inward-link/inside.js', '--session', alpha, '--ttl', '300']);
  const inwardB = runLease(root, ['acquire', 'real-dir/inside.js', '--session', bravo, '--ttl', '300']);
  check('inward aliases canonicalize to one exact-file lease',
    inwardA.status === 0 && parseJson(inwardA)?.lease?.file === 'real-dir/inside.js'
      && inwardB.status === 1 && parseJson(inwardB)?.code === 'lease_conflict',
    `first=${inwardA.stdout} second=${inwardB.stdout}`);

  let hardlinkSupported = true;
  let hardlinkOk = false;
  const hardOriginal = path.join(root, 'hard-original.js');
  const hardAlias = path.join(root, 'hard-alias.js');
  fs.writeFileSync(hardOriginal, 'hardlink\n', 'utf8');
  try { fs.linkSync(hardOriginal, hardAlias); } catch { hardlinkSupported = false; }
  if (hardlinkSupported) {
    const hardA = runLease(root, ['acquire', 'hard-original.js', '--session', alpha, '--ttl', '300']);
    const hardB = runLease(root, ['acquire', 'hard-alias.js', '--session', bravo, '--ttl', '300']);
    hardlinkOk = hardA.status === 0 && hardB.status === 1 && parseJson(hardB)?.code === 'lease_conflict';
  } else hardlinkOk = true;
  check('hard-link aliases share file identity when the filesystem exposes it', hardlinkOk,
    hardlinkSupported ? 'hard-link alias did not conflict' : 'hard-link creation unavailable; identity path skipped');

  let appearedAliasSupported = true;
  let appearedAliasOk = false;
  const appearedRoot = fresh('appeared-alias');
  const missingLease = runLease(appearedRoot, ['acquire', 'appeared.js', '--session', alpha, '--ttl', '300']);
  fs.writeFileSync(path.join(appearedRoot, 'appeared.js'), 'appeared\n', 'utf8');
  try { fs.linkSync(path.join(appearedRoot, 'appeared.js'), path.join(appearedRoot, 'appeared-alias.js')); }
  catch { appearedAliasSupported = false; }
  if (appearedAliasSupported) {
    const aliasConflict = runLease(appearedRoot, ['acquire', 'appeared-alias.js', '--session', bravo, '--ttl', '300']);
    const ownerRenew = runLease(appearedRoot, ['acquire', 'appeared-alias.js', '--session', alpha, '--ttl', '300']);
    const afterMerge = runLease(appearedRoot, ['list', '--all']);
    appearedAliasOk = missingLease.status === 0
      && aliasConflict.status === 1 && parseJson(aliasConflict)?.code === 'lease_conflict'
      && ownerRenew.status === 0 && parseJson(ownerRenew)?.action === 'renewed'
      && parseJson(afterMerge)?.totalStored === 1;
  } else appearedAliasOk = true;
  check('a file that appears after leasing cannot evade ownership through a new hard-link alias', appearedAliasOk,
    appearedAliasSupported ? 'appeared-file alias did not converge' : 'hard-link creation unavailable; appeared-file identity path skipped');

  const replacedRoot = fresh('replaced-alias');
  fs.writeFileSync(path.join(replacedRoot, 'replaced.js'), 'old inode\n', 'utf8');
  const replacedOwner = FL.acquire(replacedRoot, 'replaced.js', alpha, {
    ttlSeconds: 300, idFactory: () => 'abababababababab', withLock: (_target, fn) => fn(),
  });
  const replacement = path.join(replacedRoot, 'replacement.tmp');
  fs.writeFileSync(replacement, 'new inode\n', 'utf8');
  try { fs.renameSync(replacement, path.join(replacedRoot, 'replaced.js')); }
  catch {
    fs.rmSync(path.join(replacedRoot, 'replaced.js'));
    fs.renameSync(replacement, path.join(replacedRoot, 'replaced.js'));
  }
  let replacedLinkSupported = true;
  let replacedAliasError = null;
  try { fs.linkSync(path.join(replacedRoot, 'replaced.js'), path.join(replacedRoot, 'replaced-alias.js')); }
  catch { replacedLinkSupported = false; }
  if (replacedLinkSupported) {
    try {
      FL.acquire(replacedRoot, 'replaced-alias.js', bravo, {
        ttlSeconds: 300, withLock: (_target, fn) => fn(),
      });
    } catch (error) { replacedAliasError = error; }
  }
  check('atomic replacement cannot detach a path lease from a new hard-link alias',
    !replacedLinkSupported || (replacedOwner.action === 'acquired'
      && replacedAliasError?.code === 'lease_conflict'
      && replacedAliasError?.details?.conflict?.sessionKey === alpha),
    replacedLinkSupported
      ? JSON.stringify(replacedAliasError, Object.getOwnPropertyNames(replacedAliasError || {}))
      : 'hard links unsupported on this filesystem; replacement identity path skipped');

  const caseRoot = fresh('case-semantics');
  const caseDir = path.join(caseRoot, 'case-dir');
  fs.mkdirSync(caseDir);
  fs.writeFileSync(path.join(caseDir, 'CaseSentinel'), 'case probe\n', 'utf8');
  let caseInsensitive = false;
  try {
    const original = fs.statSync(path.join(caseDir, 'CaseSentinel'), { bigint: true });
    const alternate = fs.statSync(path.join(caseDir, 'caseSentinel'), { bigint: true });
    caseInsensitive = original.dev === alternate.dev && original.ino === alternate.ino;
  } catch {}
  const caseFirst = FL.acquire(caseRoot, 'case-dir/Foo.js', alpha, {
    ttlSeconds: 300, idFactory: () => 'cdcdcdcdcdcdcdcd', withLock: (_target, fn) => fn(),
  });
  let caseSecond = null;
  let caseSecondError = null;
  try {
    caseSecond = FL.acquire(caseRoot, 'case-dir/foo.js', bravo, {
      ttlSeconds: 300, idFactory: () => 'efefefefefefefef', withLock: (_target, fn) => fn(),
    });
  } catch (error) { caseSecondError = error; }
  check('missing-path lease case identity follows the containing filesystem behavior',
    caseFirst.action === 'acquired'
      && (caseInsensitive
        ? caseSecondError?.code === 'lease_conflict'
        : caseSecond?.action === 'acquired'),
    JSON.stringify({ caseInsensitive, caseSecond, caseSecondError }, Object.getOwnPropertyNames(caseSecondError || {})));

  const emptyCaseRoot = fresh('empty-case-semantics');
  const emptyCaseDir = path.join(emptyCaseRoot, 'empty-dir');
  fs.mkdirSync(emptyCaseDir);
  const emptyCaseFirst = FL.acquire(emptyCaseRoot, 'empty-dir/Foo.js', alpha, {
    ttlSeconds: 300, idFactory: () => 'abababababababab', withLock: (_target, fn) => fn(),
  });
  let emptyCaseError = null;
  try {
    FL.acquire(emptyCaseRoot, 'empty-dir/foo.js', bravo, {
      ttlSeconds: 300, idFactory: () => 'bcbcbcbcbcbcbcbc', withLock: (_target, fn) => fn(),
    });
  } catch (error) { emptyCaseError = error; }
  let unicodeAliasError = null;
  try {
    FL.acquire(emptyCaseRoot, 'empty-dir/Fe\u0301e.js', bravo, {
      ttlSeconds: 300, idFactory: () => 'cacacacacacacaca', withLock: (_target, fn) => fn(),
    });
    FL.acquire(emptyCaseRoot, 'empty-dir/F\u00e9e.js', alpha, {
      ttlSeconds: 300, idFactory: () => 'dadadadadadadada', withLock: (_target, fn) => fn(),
    });
  } catch (error) { unicodeAliasError = error; }
  check('unobservable missing-file case and Unicode aliases conservatively share one lease identity',
    emptyCaseFirst.action === 'acquired'
      && emptyCaseError?.code === 'lease_conflict'
      && unicodeAliasError?.code === 'lease_conflict',
    JSON.stringify({ emptyCaseError, unicodeAliasError }, Object.getOwnPropertyNames(emptyCaseError || {})));

  const caseFoldRoot = fresh('unicode-casefold');
  fs.mkdirSync(path.join(caseFoldRoot, 'empty-dir'));
  const sigmaLease = FL.acquire(caseFoldRoot, 'empty-dir/\u03c3.js', alpha, {
    ttlSeconds: 300, idFactory: () => 'dededededededede', withLock: (_target, fn) => fn(),
  });
  let finalSigmaError = null;
  try {
    FL.acquire(caseFoldRoot, 'empty-dir/\u03c2.js', bravo, {
      ttlSeconds: 300, idFactory: () => 'dfdfdfdfdfdfdfdf', withLock: (_target, fn) => fn(),
    });
  } catch (error) { finalSigmaError = error; }
  check('Unicode case-fold aliases such as sigma and final sigma cannot receive independent leases',
    sigmaLease.action === 'acquired' && finalSigmaError?.code === 'lease_conflict',
    JSON.stringify(finalSigmaError, Object.getOwnPropertyNames(finalSigmaError || {})));

  const expansionRoot = fresh('unicode-case-expansion');
  const sharpSPath = path.join(expansionRoot, 'straße.js');
  const doubledSPath = path.join(expansionRoot, 'strasse.js');
  fs.writeFileSync(sharpSPath, 'sharp s\n', 'utf8');
  fs.writeFileSync(doubledSPath, 'double s\n', 'utf8');
  const sharpSStat = fs.statSync(sharpSPath, { bigint: true });
  const doubledSStat = fs.statSync(doubledSPath, { bigint: true });
  const expansionNamesAreDistinct = sharpSStat.dev !== doubledSStat.dev || sharpSStat.ino !== doubledSStat.ino;
  const sharpSLease = FL.acquire(expansionRoot, 'straße.js', alpha, {
    ttlSeconds: 300, idFactory: () => 'eeeeeeeeeeeeeeee', withLock: (_target, fn) => fn(),
  });
  let doubledSLease = null;
  let doubledSError = null;
  try {
    doubledSLease = FL.acquire(expansionRoot, 'strasse.js', bravo, {
      ttlSeconds: 300, idFactory: () => 'ffffffffffffffff', withLock: (_target, fn) => fn(),
    });
  } catch (error) { doubledSError = error; }
  check('multi-code-point Unicode expansions do not merge distinct existing filenames',
    sharpSLease.action === 'acquired'
      && (expansionNamesAreDistinct
        ? doubledSLease?.action === 'acquired' && !doubledSError
        : doubledSError?.code === 'lease_conflict'),
    JSON.stringify({ expansionNamesAreDistinct, doubledSLease, doubledSError }, Object.getOwnPropertyNames(doubledSError || {})));

  const normalizationRoot = fresh('unicode-normalization-existing');
  const composedName = '\u00e9.js';
  const decomposedName = 'e\u0301.js';
  fs.writeFileSync(path.join(normalizationRoot, composedName), 'composed\n', 'utf8');
  fs.writeFileSync(path.join(normalizationRoot, decomposedName), 'decomposed\n', 'utf8');
  const composedStat = fs.statSync(path.join(normalizationRoot, composedName), { bigint: true });
  const decomposedStat = fs.statSync(path.join(normalizationRoot, decomposedName), { bigint: true });
  const normalizationNamesAreDistinct = composedStat.dev !== decomposedStat.dev || composedStat.ino !== decomposedStat.ino;
  const composedLease = FL.acquire(normalizationRoot, composedName, alpha, {
    ttlSeconds: 300, idFactory: () => '3131313131313131', withLock: (_target, fn) => fn(),
  });
  let decomposedLease = null;
  let decomposedError = null;
  try {
    decomposedLease = FL.acquire(normalizationRoot, decomposedName, bravo, {
      ttlSeconds: 300, idFactory: () => '3232323232323232', withLock: (_target, fn) => fn(),
    });
  } catch (error) { decomposedError = error; }
  const normalizationList = FL.list(normalizationRoot, { all: true });
  check('canonically equivalent spellings remain independent when the filesystem exposes distinct existing files',
    composedLease.action === 'acquired'
      && (normalizationNamesAreDistinct
        ? decomposedLease?.action === 'acquired' && !decomposedError && normalizationList.totalStored === 2
        : decomposedError?.code === 'lease_conflict' && normalizationList.totalStored === 1),
    JSON.stringify({ normalizationNamesAreDistinct, decomposedLease, decomposedError, normalizationList }, Object.getOwnPropertyNames(decomposedError || {})));

  const appearedNormalizationRoot = fresh('unicode-normalization-appeared');
  const missingDecomposedLease = FL.acquire(appearedNormalizationRoot, decomposedName, alpha, {
    ttlSeconds: 300, idFactory: () => '3333333333333333', withLock: (_target, fn) => fn(),
  });
  fs.writeFileSync(path.join(appearedNormalizationRoot, decomposedName), 'appeared decomposed\n', 'utf8');
  fs.writeFileSync(path.join(appearedNormalizationRoot, composedName), 'appeared composed\n', 'utf8');
  const appearedComposedStat = fs.statSync(path.join(appearedNormalizationRoot, composedName), { bigint: true });
  const appearedDecomposedStat = fs.statSync(path.join(appearedNormalizationRoot, decomposedName), { bigint: true });
  const appearedNamesAreDistinct = appearedComposedStat.dev !== appearedDecomposedStat.dev
    || appearedComposedStat.ino !== appearedDecomposedStat.ino;
  let appearedComposedLease = null;
  let appearedComposedError = null;
  try {
    appearedComposedLease = FL.acquire(appearedNormalizationRoot, composedName, bravo, {
      ttlSeconds: 300, idFactory: () => '3434343434343434', withLock: (_target, fn) => fn(),
    });
  } catch (error) { appearedComposedError = error; }
  const appearedNormalizationList = FL.list(appearedNormalizationRoot, { all: true });
  check('a formerly missing lease records its observed identity before a distinct normalization-colliding file is admitted',
    missingDecomposedLease.action === 'acquired'
      && (appearedNamesAreDistinct
        ? appearedComposedLease?.action === 'acquired' && !appearedComposedError && appearedNormalizationList.totalStored === 2
        : appearedComposedError?.code === 'lease_conflict' && appearedNormalizationList.totalStored === 1),
    JSON.stringify({ appearedNamesAreDistinct, appearedComposedLease, appearedComposedError, appearedNormalizationList }, Object.getOwnPropertyNames(appearedComposedError || {})));

  const convergedRoot = fresh('converged-peer');
  const convergedA = FL.acquire(convergedRoot, 'converged-a.js', alpha, {
    ttlSeconds: 300, idFactory: () => '1111111111111111', withLock: (_target, fn) => fn(),
  });
  const convergedB = FL.acquire(convergedRoot, 'converged-b.js', bravo, {
    ttlSeconds: 300, idFactory: () => '2222222222222222', withLock: (_target, fn) => fn(),
  });
  fs.writeFileSync(path.join(convergedRoot, 'converged-a.js'), 'same inode\n', 'utf8');
  let convergedLinkSupported = true;
  try { fs.linkSync(path.join(convergedRoot, 'converged-a.js'), path.join(convergedRoot, 'converged-b.js')); }
  catch { convergedLinkSupported = false; }
  if (convergedLinkSupported) {
    const convergedCheck = FL.check(convergedRoot, 'converged-a.js', { sessionKey: alpha });
    let convergedAcquireError = null;
    try {
      FL.acquire(convergedRoot, 'converged-a.js', alpha, {
        ttlSeconds: 300, withLock: (_target, fn) => fn(),
      });
    } catch (error) { convergedAcquireError = error; }
    check('peer ownership dominates a same-session row when missing paths later converge to one hard link',
      convergedA.action === 'acquired' && convergedB.action === 'acquired'
        && convergedCheck.available === false && convergedCheck.ownedBySession === false
        && convergedCheck.lease?.sessionKey === bravo
        && convergedAcquireError?.code === 'lease_conflict'
        && convergedAcquireError?.details?.conflict?.sessionKey === bravo,
      JSON.stringify({ convergedA, convergedB, convergedCheck, convergedAcquireError }, Object.getOwnPropertyNames(convergedAcquireError || {})));
  } else {
    check('peer ownership dominates a same-session row when missing paths later converge to one hard link', true,
      'hard links unsupported on this filesystem; behavior covered where supported');
  }

  const lockSnapshotRoot = fresh('lock-snapshot');
  const lockSnapshotOwner = FL.acquire(lockSnapshotRoot, 'snapshot-a.js', alpha, {
    ttlSeconds: 300, idFactory: () => '4444444444444444', withLock: (_target, fn) => fn(),
  });
  let lockSnapshotLinkSupported = true;
  let lockSnapshotError = null;
  try {
    FL.acquire(lockSnapshotRoot, 'snapshot-b.js', bravo, {
      ttlSeconds: 300,
      withLock: (_target, fn) => {
        fs.writeFileSync(path.join(lockSnapshotRoot, 'snapshot-a.js'), 'snapshot\n', 'utf8');
        try { fs.linkSync(path.join(lockSnapshotRoot, 'snapshot-a.js'), path.join(lockSnapshotRoot, 'snapshot-b.js')); }
        catch { lockSnapshotLinkSupported = false; return fn(); }
        return fn();
      },
    });
  } catch (error) { lockSnapshotError = error; }
  check('acquire re-observes file identity after lock wait before deciding ownership',
    !lockSnapshotLinkSupported || (lockSnapshotOwner.action === 'acquired'
      && lockSnapshotError?.code === 'lease_conflict'
      && lockSnapshotError?.details?.conflict?.sessionKey === alpha),
    lockSnapshotLinkSupported
      ? JSON.stringify(lockSnapshotError, Object.getOwnPropertyNames(lockSnapshotError || {}))
      : 'hard links unsupported on this filesystem; behavior covered where supported');

  const ttlLockRoot = fresh('ttl-lock-start');
  const realDateNow = Date.now;
  const ttlBase = Date.UTC(2026, 0, 2, 0, 0, 0);
  let ttlNow = ttlBase;
  let ttlAfterWait = null;
  try {
    Date.now = () => ttlNow;
    ttlAfterWait = FL.acquire(ttlLockRoot, 'ttl-after-wait.js', alpha, {
      ttlSeconds: 30, idFactory: () => '5555555555555555',
      withLock: (_target, fn) => { ttlNow += 31000; return fn(); },
    });
  } finally { Date.now = realDateNow; }
  check('lease TTL starts after lock waiting rather than expiring before the write',
    ttlAfterWait?.action === 'acquired'
      && ttlAfterWait?.lease?.acquiredAt === new Date(ttlBase + 31000).toISOString()
      && ttlAfterWait?.lease?.expiresAt === new Date(ttlBase + 61000).toISOString()
      && ttlAfterWait?.lease?.remainingSeconds === 30,
    JSON.stringify(ttlAfterWait));

  let lockError = null;
  try {
    FL.acquire(root, 'lock-error.js', alpha, {
      ttlSeconds: 300,
      withLock: () => { const error = new Error('forced'); error.code = 'E_LOCK_TIMEOUT'; error.waitedMs = 7; throw error; },
    });
  } catch (error) { lockError = error; }
  let releaseLockError = null;
  try {
    FL.acquire(root, 'lock-release-error.js', alpha, {
      ttlSeconds: 300,
      withLock: (_target, fn) => { fn(); const error = new Error('forced release failure'); error.code = 'E_LOCK_RELEASE'; throw error; },
    });
  } catch (error) { releaseLockError = error; }
  check('lock acquisition/release failures have explicit and honest machine errors',
    lockError?.code === 'lease_lock_unavailable' && lockError?.details?.lockCode === 'E_LOCK_TIMEOUT'
      && lockError?.details?.waitedMs === 7 && lockError?.details?.mutationMayHaveApplied === false
      && releaseLockError?.code === 'lease_lock_unavailable'
      && releaseLockError?.details?.lockCode === 'E_LOCK_RELEASE'
      && releaseLockError?.details?.mutationMayHaveApplied === true,
    JSON.stringify({ lockError, releaseLockError }, Object.getOwnPropertyNames(lockError || {})));

  const limitRoot = fresh('limit');
  fs.mkdirSync(path.dirname(storeFile(limitRoot)), { recursive: true });
  const limitBaseMs = Date.now();
  const limitAt = new Date(limitBaseMs).toISOString();
  const limitExpires = new Date(limitBaseMs + (1800 * 1000)).toISOString();
  const limitLeases = Array.from({ length: 1000 }, (_, index) => {
    const file = `limit/${String(index).padStart(4, '0')}.js`;
    return {
      leaseId: `lease-${index.toString(16).padStart(16, '0')}`,
      file, pathKey: process.platform === 'win32' ? file.toLowerCase() : file, identityKey: null,
      sessionKey: `limit-session-${String(index).padStart(4, '0')}`,
      acquiredAt: limitAt, renewedAt: limitAt, expiresAt: limitExpires, note: null,
    };
  });
  fs.writeFileSync(storeFile(limitRoot), JSON.stringify({ schemaVersion: 1, updatedAt: limitAt, leases: limitLeases }, null, 2) + '\n', 'utf8');
  const limitBefore = storeBytes(limitRoot);
  const limitAcquire = runLease(limitRoot, ['acquire', 'overflow.js', '--session', alpha, '--ttl', '300']);
  check('the 1000-row store limit fails closed instead of writing a self-invalid 1001st row',
    limitAcquire.status === 1 && parseJson(limitAcquire)?.code === 'lease_limit_reached'
      && Buffer.compare(limitBefore, storeBytes(limitRoot)) === 0,
    limitAcquire.stdout || limitAcquire.stderr);

  const byteLimitRoot = fresh('byte-limit');
  fs.mkdirSync(path.dirname(storeFile(byteLimitRoot)), { recursive: true });
  const byteBaseMs = Date.now();
  const byteAt = new Date(byteBaseMs).toISOString();
  const byteExpires = new Date(byteBaseMs + (1800 * 1000)).toISOString();
  const byteRow = (index, file) => ({
    leaseId: `lease-${(index + 5000).toString(16).padStart(16, '0')}`,
    file, pathKey: process.platform === 'win32' ? file.toLowerCase() : file, identityKey: null,
    sessionKey: `bytes-session-${String(index).padStart(4, '0')}`,
    acquiredAt: byteAt, renewedAt: byteAt, expiresAt: byteExpires, note: null,
  });
  const byteRows = [];
  const prospective = {
    leaseId: 'lease-feedfeedfeedfeed', file: 'overflow-byte.js', pathKey: 'overflow-byte.js', identityKey: null,
    sessionKey: alpha, acquiredAt: byteAt, renewedAt: byteAt,
    expiresAt: new Date(byteBaseMs + (300 * 1000)).toISOString(), note: null,
  };
  const encodeStore = rows => JSON.stringify({ schemaVersion: 1, updatedAt: byteAt, leases: rows }, null, 2) + '\n';
  while (true) {
    const index = byteRows.length;
    const file = `bytes/${String(index).padStart(4, '0')}/${'x'.repeat(1750)}`;
    const candidate = byteRow(index, file);
    if (Buffer.byteLength(encodeStore([...byteRows, candidate, prospective]), 'utf8') > FL.MAX_STORE_BYTES) break;
    byteRows.push(candidate);
  }
  let filler = null;
  for (let length = 1; length <= 2000; length++) {
    const index = byteRows.length;
    const file = `bytes/${String(index).padStart(4, '0')}/${'y'.repeat(length)}`;
    const candidate = byteRow(index, file);
    const currentBytes = Buffer.byteLength(encodeStore([...byteRows, candidate]), 'utf8');
    const nextBytes = Buffer.byteLength(encodeStore([...byteRows, candidate, prospective]), 'utf8');
    if (currentBytes <= FL.MAX_STORE_BYTES && nextBytes > FL.MAX_STORE_BYTES) filler = candidate;
  }
  if (!filler) throw new Error('failed to construct byte-limit fixture');
  byteRows.push(filler);
  const byteText = encodeStore(byteRows);
  fs.writeFileSync(storeFile(byteLimitRoot), byteText, 'utf8');
  const byteBefore = storeBytes(byteLimitRoot);
  let byteLimitError = null;
  try {
    FL.acquire(byteLimitRoot, 'overflow-byte.js', alpha, {
      ttlSeconds: 300, nowMs: byteBaseMs, idFactory: () => 'feedfeedfeedfeed', withLock: (_target, fn) => fn(),
    });
  } catch (error) { byteLimitError = error; }
  check('the byte limit is enforced before a valid update can self-invalidate the next read',
    byteLimitError?.code === 'lease_store_size_limit'
      && byteLimitError?.details?.maxBytes === FL.MAX_STORE_BYTES
      && byteLimitError?.details?.attemptedBytes > FL.MAX_STORE_BYTES
      && byteBefore.length <= FL.MAX_STORE_BYTES
      && Buffer.compare(byteBefore, storeBytes(byteLimitRoot)) === 0,
    JSON.stringify({ byteLimitError, beforeBytes: byteBefore.length }, Object.getOwnPropertyNames(byteLimitError || {})));

  const clockRoot = fresh('clock-regression');
  const clockFuture = Date.UTC(2026, 0, 1, 1, 0, 0);
  const clockLease = FL.acquire(clockRoot, 'clock.js', alpha, {
    ttlSeconds: 300, nowMs: clockFuture, idFactory: () => '3333333333333333', withLock: (_target, fn) => fn(),
  });
  const clockBefore = storeBytes(clockRoot);
  let clockError = null;
  try {
    FL.acquire(clockRoot, 'clock.js', alpha, {
      ttlSeconds: 300, nowMs: clockFuture - 1000, withLock: (_target, fn) => fn(),
    });
  } catch (error) { clockError = error; }
  check('a backward clock jump cannot make renewal write a self-invalid timestamp order',
    clockLease.action === 'acquired' && clockError?.code === 'lease_clock_regression'
      && Buffer.compare(clockBefore, storeBytes(clockRoot)) === 0
      && FL.list(clockRoot, { nowMs: clockFuture - 1000, all: true }).storeState === 'ok',
    JSON.stringify({ clockLease, clockError }, Object.getOwnPropertyNames(clockError || {})));

  const expRoot = fresh('expiry');
  fs.writeFileSync(path.join(expRoot, 'expire.js'), 'expire\n', 'utf8');
  const noOpLock = (_target, fn) => fn();
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
  const expA = FL.acquire(expRoot, 'expire.js', alpha, {
    ttlSeconds: 30, nowMs: t0, idFactory: () => 'aaaaaaaaaaaaaaaa', withLock: noOpLock,
  });
  const expB = FL.acquire(expRoot, 'expire.js', bravo, {
    ttlSeconds: 30, nowMs: t0 + 31000, idFactory: () => 'bbbbbbbbbbbbbbbb', withLock: noOpLock,
  });
  check('expired lease stops blocking and is pruned only by a successful mutation',
    expA.action === 'acquired' && expB.action === 'acquired' && expB.expiredPruned === 1
      && expB.lease.sessionKey === bravo && FL.list(expRoot, { nowMs: t0 + 31000, all: true }).totalStored === 1,
    JSON.stringify({ expA, expB }));

  const staleTopologyRoot = fresh('expired-stale-topology');
  fs.mkdirSync(path.join(staleTopologyRoot, 'slot'));
  fs.writeFileSync(path.join(staleTopologyRoot, 'slot', 'item.js'), 'leased\n', 'utf8');
  FL.acquire(staleTopologyRoot, 'slot/item.js', alpha, {
    ttlSeconds: 30, nowMs: t0, idFactory: () => 'abababababababab', withLock: noOpLock,
  });
  fs.unlinkSync(path.join(staleTopologyRoot, 'slot', 'item.js'));
  fs.rmdirSync(path.join(staleTopologyRoot, 'slot'));
  fs.writeFileSync(path.join(staleTopologyRoot, 'slot'), 'parent became a file\n', 'utf8');
  const unrelatedAfterExpiry = FL.acquire(staleTopologyRoot, 'other.js', bravo, {
    ttlSeconds: 30, nowMs: t0 + 31000, idFactory: () => 'bcbcbcbcbcbcbcbc', withLock: noOpLock,
  });
  check('expired rows with stale path topology cannot poison unrelated lease mutations',
    unrelatedAfterExpiry.action === 'acquired' && unrelatedAfterExpiry.expiredPruned === 1
      && FL.list(staleTopologyRoot, { nowMs: t0 + 31000, all: true }).totalStored === 1,
    JSON.stringify(unrelatedAfterExpiry));

  const noCacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-file-lease-no-cache-'));
  roots.push(noCacheRoot);
  fs.mkdirSync(path.join(noCacheRoot, '.leerness'), { recursive: true });
  let releaseError = null;
  try {
    FL.release(noCacheRoot, 'lease-cccccccccccccccc', alpha, { withLock: noOpLock });
  } catch (error) { releaseError = error; }
  check('releasing a missing lease does not create the cache directory',
    releaseError?.code === 'lease_not_found' && !fs.existsSync(path.join(noCacheRoot, '.leerness', 'cache')),
    String(releaseError && releaseError.stack || releaseError));

  const cacheLinkRoot = fresh('cache-link');
  const cacheLink = path.join(cacheLinkRoot, '.leerness', 'cache');
  const cacheTarget = path.join(cacheLinkRoot, 'tracked-cache-target');
  fs.rmSync(cacheLink, { recursive: true, force: true });
  fs.mkdirSync(cacheTarget, { recursive: true });
  makeDirLink(cacheTarget, cacheLink);
  const cacheLinkAcquire = runLease(cacheLinkRoot, ['acquire', 'x.js', '--session', alpha, '--ttl', '300']);
  check('lease cache symlinks or junctions are rejected before writing tracked project paths',
    cacheLinkAcquire.status === 1 && parseJson(cacheLinkAcquire)?.code === 'cache_symlink'
      && !fs.existsSync(path.join(cacheTarget, 'file-leases.json')),
    cacheLinkAcquire.stdout || cacheLinkAcquire.stderr);

  const hardStoreRoot = fresh('hard-store');
  fs.mkdirSync(path.dirname(storeFile(hardStoreRoot)), { recursive: true });
  const hardStorePeer = path.join(hardStoreRoot, 'peer-store.json');
  const hardStoreBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, updatedAt: null, leases: [] }) + '\n');
  fs.writeFileSync(hardStorePeer, hardStoreBytes);
  let hardStoreSupported = true;
  try { fs.linkSync(hardStorePeer, storeFile(hardStoreRoot)); }
  catch { hardStoreSupported = false; }
  const hardStoreList = hardStoreSupported ? runLease(hardStoreRoot, ['list']) : null;
  const hardStoreAcquire = hardStoreSupported
    ? runLease(hardStoreRoot, ['acquire', 'x.js', '--session', alpha, '--ttl', '300']) : null;
  check('hard-linked lease stores fail closed without changing either linked path',
    !hardStoreSupported || (hardStoreList.status === 1 && parseJson(hardStoreList)?.code === 'store_hard_link'
      && hardStoreAcquire.status === 1 && parseJson(hardStoreAcquire)?.code === 'store_hard_link'
      && Buffer.compare(hardStoreBytes, fs.readFileSync(hardStorePeer)) === 0
      && Buffer.compare(hardStoreBytes, fs.readFileSync(storeFile(hardStoreRoot))) === 0),
    hardStoreSupported ? `list=${hardStoreList.stdout} acquire=${hardStoreAcquire.stdout}` : 'hard links unsupported');

  const corruptRoot = fresh('corrupt');
  fs.mkdirSync(path.dirname(storeFile(corruptRoot)), { recursive: true });
  const corruptBytes = Buffer.from('{ broken lease store', 'utf8');
  fs.writeFileSync(storeFile(corruptRoot), corruptBytes);
  const corruptList = runLease(corruptRoot, ['list']);
  const corruptAcquire = runLease(corruptRoot, ['acquire', 'x.js', '--session', alpha, '--ttl', '300']);
  check('corrupt store fails closed for read and write while preserving original bytes',
    corruptList.status === 1 && parseJson(corruptList)?.code === 'store_corrupt'
      && corruptAcquire.status === 1 && parseJson(corruptAcquire)?.code === 'store_corrupt'
      && Buffer.compare(corruptBytes, fs.readFileSync(storeFile(corruptRoot))) === 0,
    `list=${corruptList.stdout} acquire=${corruptAcquire.stdout}`);

  const invalidUtf8Root = fresh('invalid-utf8');
  fs.mkdirSync(path.dirname(storeFile(invalidUtf8Root)), { recursive: true });
  const invalidUtf8When = new Date(t0).toISOString();
  const invalidUtf8Later = new Date(t0 + 60000).toISOString();
  const invalidUtf8Text = JSON.stringify({
    schemaVersion: 1, updatedAt: invalidUtf8When, leases: [{
      leaseId: 'lease-cccccccccccccccc', file: 'utf8.js', pathKey: 'utf8.js', identityKey: null,
      sessionKey: alpha, acquiredAt: invalidUtf8When, renewedAt: invalidUtf8When, expiresAt: invalidUtf8Later, note: 'badXnote',
    }],
  }, null, 2) + '\n';
  const invalidUtf8Bytes = Buffer.from(invalidUtf8Text, 'utf8');
  invalidUtf8Bytes[invalidUtf8Bytes.indexOf(Buffer.from('X'))] = 0xff;
  fs.writeFileSync(storeFile(invalidUtf8Root), invalidUtf8Bytes);
  const invalidUtf8List = runLease(invalidUtf8Root, ['list']);
  const invalidUtf8Acquire = runLease(invalidUtf8Root, ['acquire', 'other.js', '--session', bravo, '--ttl', '300']);
  check('malformed UTF-8 lease stores fail closed and preserve their original bytes',
    invalidUtf8List.status === 1 && parseJson(invalidUtf8List)?.code === 'store_invalid_utf8'
      && invalidUtf8Acquire.status === 1 && parseJson(invalidUtf8Acquire)?.code === 'store_invalid_utf8'
      && Buffer.compare(invalidUtf8Bytes, fs.readFileSync(storeFile(invalidUtf8Root))) === 0,
    `list=${invalidUtf8List.stdout} acquire=${invalidUtf8Acquire.stdout}`);

  const invalidRoot = fresh('invalid');
  fs.mkdirSync(path.dirname(storeFile(invalidRoot)), { recursive: true });
  const when = new Date(t0).toISOString();
  const later = new Date(t0 + 60000).toISOString();
  const invalidStore = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    updatedAt: when,
    leases: [{
      leaseId: 'lease-dddddddddddddddd', file: 'x.js', pathKey: 'x.js', identityKey: null,
      sessionKey: 'bad', acquiredAt: when, renewedAt: when, expiresAt: later, note: null,
    }],
  }, null, 2) + '\n');
  fs.writeFileSync(storeFile(invalidRoot), invalidStore);
  const invalidList = runLease(invalidRoot, ['list']);
  check('invalid stored session identity is reported as store_invalid, not an input error',
    invalidList.status === 1 && parseJson(invalidList)?.code === 'store_invalid'
      && Buffer.compare(invalidStore, fs.readFileSync(storeFile(invalidRoot))) === 0,
    invalidList.stdout || invalidList.stderr);

  const overTtlRoot = fresh('over-ttl');
  fs.mkdirSync(path.dirname(storeFile(overTtlRoot)), { recursive: true });
  const overTtlStore = Buffer.from(JSON.stringify({
    schemaVersion: 1, updatedAt: when, leases: [{
      leaseId: 'lease-eeeeeeeeeeeeeeee', file: 'x.js', pathKey: 'x.js', identityKey: null,
      sessionKey: alpha, acquiredAt: when, renewedAt: when,
      expiresAt: new Date(t0 + (1801 * 1000)).toISOString(), note: null,
    }],
  }, null, 2) + '\n');
  fs.writeFileSync(storeFile(overTtlRoot), overTtlStore);
  const overTtlList = runLease(overTtlRoot, ['list']);
  check('tampered overlong stored TTL fails closed and remains byte-exact',
    overTtlList.status === 1 && parseJson(overTtlList)?.code === 'store_invalid'
      && Buffer.compare(overTtlStore, fs.readFileSync(storeFile(overTtlRoot))) === 0,
    overTtlList.stdout || overTtlList.stderr);

  const concurrencyRoot = fresh('concurrency');
  fs.writeFileSync(path.join(concurrencyRoot, 'same.js'), 'same\n', 'utf8');
  const concurrent = await Promise.all([
    runAsync(concurrencyRoot, ['lease', 'acquire', 'same.js', '--session', 'concurrent-alpha', '--ttl', '300', '--path', concurrencyRoot, '--json']),
    runAsync(concurrencyRoot, ['lease', 'acquire', 'same.js', '--session', 'concurrent-bravo', '--ttl', '300', '--path', concurrencyRoot, '--json']),
  ]);
  const winners = concurrent.filter(result => result.status === 0);
  const losers = concurrent.filter(result => result.status === 1 && parseJson(result)?.code === 'lease_conflict');
  const concurrencyList = runLease(concurrencyRoot, ['list']);
  check('simultaneous acquisition converges to exactly one owner',
    winners.length === 1 && losers.length === 1 && parseJson(concurrencyList)?.active === 1,
    JSON.stringify(concurrent));

  const rootOne = fresh('root-one');
  const rootTwo = fresh('root-two');
  fs.writeFileSync(path.join(rootOne, 'same.js'), 'one\n', 'utf8');
  fs.writeFileSync(path.join(rootTwo, 'same.js'), 'two\n', 'utf8');
  const one = runLease(rootOne, ['acquire', 'same.js', '--session', alpha, '--ttl', '300']);
  const two = runLease(rootTwo, ['acquire', 'same.js', '--session', bravo, '--ttl', '300']);
  check('separate project roots or worktrees remain isolated', one.status === 0 && two.status === 0,
    `one=${one.stdout} two=${two.stdout}`);

  const ambientLeaseId = parseJson(afterReleaseAcquire)?.lease?.leaseId || '';
  const statusResult = run(root, ['status', root, '--json']);
  const handoffResult = run(root, ['handoff', root, '--compact', '--json']);
  const ambientText = `${statusResult.stdout}\n${handoffResult.stdout}`;
  check('ordinary status and handoff output contain no ambient lease warning',
    statusResult.status === 0 && handoffResult.status === 0
      && !ambientText.includes(ambientLeaseId)
      && !/lease_conflict|file-leases\.json|ambientWarnings/.test(ambientText),
    ambientText.slice(0, 1000));

  const unsupported = ['scope', 'send', 'inbox'].map(sub => run(root, ['sessions', sub, '--path', root, '--json']));
  check('discarded sessions scope/send/inbox verbs remain unsupported',
    unsupported.every(result => result.status === 1 && parseJson(result)?.code === 'unknown_subcommand'),
    unsupported.map(result => result.stdout || result.stderr).join('\n'));

  const koList = parseJson(runLease(root, ['list', '--language', 'ko']));
  const enList = parseJson(runLease(root, ['list', '--language', 'en']));
  const normalizeRemaining = value => JSON.parse(JSON.stringify(value, (key, item) => key === 'remainingSeconds' ? 0 : item));
  check('lease JSON is locale-independent',
    !!koList && !!enList && JSON.stringify(normalizeRemaining(koList)) === JSON.stringify(normalizeRemaining(enList)),
    `ko=${JSON.stringify(koList)} en=${JSON.stringify(enList)}`);

  const catalog = run(root, ['commands', '--json']);
  const catalogJson = parseJson(catalog);
  const rows = catalogJson?.categories ? Object.values(catalogJson.categories).flat() : [];
  const helpEn = run(root, ['--help', '--language', 'en']);
  const helpKo = run(root, ['--help', '--language', 'ko']);
  const PU = require('../lib/pure-utils');
  check('permission policy classifies lease writes without over-classifying reads',
    PU._requiredTier('lease acquire file.js') === 'safe-write'
      && PU._requiredTier('lease release lease-aaaaaaaaaaaaaaaa') === 'safe-write'
      && PU._requiredTier('lease list') === 'read-only'
      && PU._requiredTier('lease check file.js') === 'read-only'
      && PU._requiredTier('lease check reports/release publish/status.js') === 'read-only'
      && PU._requiredTier('lease acquire reports/release publish/status.js') === 'safe-write'
      && PU._requiredTier('leerness lease check reports/release publish/status.js') === 'read-only'
      && PU._requiredTier('npx leerness lease check reports/release publish/status.js') === 'read-only'
      && PU._requiredTier('npx -y leerness@1.36.185 lease check reports/release publish/status.js') === 'read-only'
      && PU._requiredTier('npx --yes leerness lease acquire reports/release publish/status.js') === 'safe-write');

  check('command catalog and both help locales advertise exact-file lease',
    catalog.status === 0 && catalogJson?.totalCommands === 100
      && rows.some(row => /^lease acquire\|release\|list\|check\b/.test(row.cmd))
      && /lease acquire\|release\|list\|check/.test(helpEn.stdout)
      && /leerness lease acquire\|release\|list\|check/.test(helpKo.stdout),
    `catalog=${catalog.stdout.slice(0, 500)} en=${helpEn.stdout.slice(0, 500)} ko=${helpKo.stdout.slice(0, 500)}`);

  const mcpInvalidRoot = fresh('mcp-invalid');
  const mcpInvalidBefore = snapshotTree(mcpInvalidRoot);
  const mcpInvalid = runMcp(mcpInvalidRoot, [
    rpcCall('leerness_file_lease_read', { action: 'list', file: 'ignored.js', path: mcpInvalidRoot }, 2),
    rpcCall('leerness_file_lease_write', { action: 'acquire', file: 'x.js', leaseId: 'lease-aaaaaaaaaaaaaaaa', sessionKey: 'mcp-invalid-session', path: mcpInvalidRoot }, 3),
    rpcCall('leerness_file_lease_write', { action: 'release', leaseId: 'lease-aaaaaaaaaaaaaaaa', ttl: 300, sessionKey: 'mcp-invalid-session', path: mcpInvalidRoot }, 4),
    rpcCall('leerness_file_lease_read', { action: '', path: mcpInvalidRoot }, 5),
  ]);
  const mcpInvalidAfter = snapshotTree(mcpInvalidRoot);
  check('MCP lease actions reject ignored or action-incompatible fields before telemetry',
    [2, 3, 4, 5].every(id => mcpInvalid.byId(id)?.error?.code === -32602)
      && mcpInvalidBefore === mcpInvalidAfter,
    JSON.stringify(mcpInvalid.messages));

  const mcpRoot = fresh('mcp');
  fs.writeFileSync(path.join(mcpRoot, 'mcp.js'), 'mcp\n', 'utf8');
  const mcpWrite = runMcp(mcpRoot, [
    rpcCall('leerness_file_lease_write', {
      action: 'acquire', file: 'mcp.js', sessionKey: 'mcp-lease-alpha', ttl: 300, path: mcpRoot,
    }, 2),
  ]);
  const tools = mcpWrite.byId(1)?.result?.tools || [];
  const mcpAcquired = toolJson(mcpWrite, 2);
  const mcpBeforeRead = snapshotTree(mcpRoot);
  const mcpRead = runMcp(mcpRoot, [
    rpcCall('leerness_file_lease_read', {
      action: 'check', file: 'mcp.js', sessionKey: 'mcp-lease-bravo', path: mcpRoot,
    }, 2),
    rpcCall('leerness_file_lease_read', {
      action: 'list', sessionKey: 'mcp-lease-alpha', path: mcpRoot,
    }, 3),
  ]);
  const mcpChecked = toolJson(mcpRead, 2);
  const mcpListed = toolJson(mcpRead, 3);
  const mcpAfterRead = snapshotTree(mcpRoot);
  const toolDefs = require('../lib/mcp-tools');
  check('MCP exposes separate read-only and safe-write exact-file lease surfaces',
    mcpWrite.result.status === 0 && mcpRead.result.status === 0
      && tools.some(tool => tool.name === 'leerness_file_lease_read')
      && tools.some(tool => tool.name === 'leerness_file_lease_write')
      && toolDefs.find(tool => tool.name === 'leerness_file_lease_read')?.requiredTier === 'read-only'
      && toolDefs.find(tool => tool.name === 'leerness_file_lease_write')?.requiredTier === 'safe-write'
      && mcpAcquired?.action === 'acquired'
      && mcpChecked?.available === false && mcpChecked?.lease?.sessionKey === 'mcp-lease-alpha'
      && mcpRead.byId(2)?.result?.isError === false && !mcpRead.byId(2)?.error
      && mcpListed?.shown === 1 && mcpListed?.leases?.[0]?.sessionKey === 'mcp-lease-alpha'
      && mcpBeforeRead === mcpAfterRead,
    `write=${JSON.stringify(mcpWrite.byId(2))} check=${JSON.stringify(mcpRead.byId(2))} list=${JSON.stringify(mcpRead.byId(3))}`);

  const paged = runMcp(limitRoot, [
    rpcCall('leerness_file_lease_read', {
      action: 'list', all: true, path: limitRoot, _chunkSize: 128,
    }, 2),
    rpcCall('leerness_file_lease_read', {
      action: 'list', all: true, path: limitRoot, _chunkSize: 128, _cursor: '128',
    }, 3),
  ]);
  const leaseReadSchema = toolDefs.find(tool => tool.name === 'leerness_file_lease_read')?.inputSchema;
  check('strict read-only MCP schemas advertise and accept their pagination cursor',
    leaseReadSchema?.properties?._cursor?.type === 'string'
      && leaseReadSchema?.properties?._chunkSize?.type === 'number'
      && paged.byId(2)?.result?.nextCursor === '128'
      && !paged.byId(3)?.error
      && typeof paged.byId(3)?.result?.content?.[0]?.text === 'string'
      && paged.byId(3).result.content[0].text.length === 128,
    JSON.stringify(paged.messages.slice(-2)));
}

main().catch(error => {
  check('probe completed without exception', false, error && error.stack ? error.stack : String(error));
}).finally(() => {
  for (const root of roots.reverse()) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
  process.stdout.write(`File lease probe: ${total - failed}/${total} passed\n`);
  process.exitCode = failed ? 1 : 0;
});
