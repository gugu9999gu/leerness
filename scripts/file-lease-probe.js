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
    check('Windows lexical aliases and alternate data streams are rejected before mutation',
      trailingDot.status === 1 && parseJson(trailingDot)?.code === 'invalid_file'
        && ads.status === 1 && parseJson(ads)?.code === 'invalid_file'
        && Buffer.compare(windowsAliasBefore, storeBytes(root)) === 0,
      `dot=${trailingDot.stdout} ads=${ads.stdout}`);
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
      && PU._requiredTier('lease check file.js') === 'read-only');

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
      && mcpListed?.shown === 1 && mcpListed?.leases?.[0]?.sessionKey === 'mcp-lease-alpha'
      && mcpBeforeRead === mcpAfterRead,
    `write=${JSON.stringify(mcpWrite.byId(2))} check=${JSON.stringify(mcpRead.byId(2))} list=${JSON.stringify(mcpRead.byId(3))}`);
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
