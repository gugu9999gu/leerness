 
 
 
 
'use strict';
const { readPublicationBytes, validatePublicationLimit } = require('./memory-publication-read');
 
 
 
const { errorLanguage } = require('./error-language');
const _english = () => errorLanguage() === 'en';
const _korean = () => errorLanguage() === 'ko';
const fs = require('fs');
const { removeSync } = require('./safe-remove');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const crypto = require('crypto');

 
 
let _quiet = false;
function setQuiet(v) { _quiet = !!v; if (!v) { _jsonErrEmitted = false; _failLatched = false; _firstFail = null; } }    
function log(s = '') {
  _unlatchIfNewCmd();
  if (_quiet) return;
  if (_failLatched || _jsonErrEmitted) {
     
     
     
    const t = typeof s === 'string' ? s.trim() : '';
    if (!_jsonErrEmitted && t && (t[0] === '{' || t[0] === '[')) { try { JSON.parse(t); console.log(s); return; } catch {} }
    console.error(s); return;
  }
  console.log(s);
}
 
 
 
 
 
 
 
 
function ok(s) { if (_argvJsonMode() && !_quiet) { console.error('✓ ' + s); return; } log('✓ ' + s); }
function warn(s) { if (_argvJsonMode() && !_quiet) { console.error('⚠ ' + s); return; } log('⚠ ' + s); }
 
 
 
 
 
 
 
 
 
let _jsonErrEmitted = false;    
let _failLatched = false;       
let _firstFail = null;
let _stdoutWrote = false;
let _exitHooked = false;
 
 
 
 
let _rawStdoutWrite = null;
let _latchArgv = null;          
 
 
{
  _rawStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function (...a) { _stdoutWrote = true; return _rawStdoutWrite(...a); };
}
 
function _argvJsonMode() { try { const a = process.argv; const end = a.indexOf('--'); return (end >= 0 ? a.slice(0, end) : a).includes('--json'); } catch { return false; } }
 
 
 
 
function _installJsonExitFallback() {
  if (_exitHooked) return;
  _exitHooked = true;
  process.on('exit', (code) => {
    if (code === 0 || _stdoutWrote || !_argvJsonMode()) return;
    const payload = JSON.stringify({ ok: false, error: _firstFail != null ? _firstFail : 'command failed', code: 'error' }, null, 2) + '\n';
    if (_rawStdoutWrite) { try { _rawStdoutWrite(payload); return; } catch {   } }
    console.log(payload.trimEnd());
  });
}
_installJsonExitFallback();
function _unlatchIfNewCmd() {
  if ((_jsonErrEmitted || _failLatched) && _latchArgv !== process.argv) { _jsonErrEmitted = false; _failLatched = false; _firstFail = null; _quiet = false; _latchArgv = null; }
}
function fail(s) {
  _unlatchIfNewCmd();
  if (_argvJsonMode()) {
    if (_firstFail == null) _firstFail = s;
    _failLatched = true; _latchArgv = process.argv;
    console.error('✗ ' + s);
     
     
    _installJsonExitFallback();
    process.exitCode = 1; return;
  }
  console.log('✗ ' + s); process.exitCode = 1;   
}
 
 
function failJson(jsonMode, code, msg, details = null) {
  _unlatchIfNewCmd();
  if (jsonMode) {
     
     
     
    const extra = details && typeof details === 'object' && !Array.isArray(details) ? details : {};
    if (!_jsonErrEmitted) { console.log(JSON.stringify({ ...extra, ok: false, error: msg, code }, null, 2)); _jsonErrEmitted = true; _failLatched = true; _latchArgv = process.argv; }
    else console.error('✗ ' + msg);
    process.exitCode = 1;
  } else {
     
    console.log('✗ ' + msg); process.exitCode = 1;
  }
}
function today() { return new Date().toISOString().slice(0, 10); }
function now() { return new Date().toISOString(); }

 
 
function absRoot(p) { return path.resolve((typeof p === 'string' && p.trim()) ? p : process.cwd()); }
function _assertManagedAbsent(p) {
  if (typeof p !== 'string') return;
  const parts = path.resolve(p).split(/[\\/]/).slice(0, -1);
  const { CANONICAL_WORKSPACE_DIR, LEGACY_WORKSPACE_DIR } = require('./workspace-dir');
  if (!parts.some(part => [CANONICAL_WORKSPACE_DIR, LEGACY_WORKSPACE_DIR].includes(process.platform === 'win32' ? part.toLowerCase() : part))) return;
  try { fs.lstatSync(path.dirname(path.resolve(p))); }
  catch (error) { if (error.code === 'ENOENT') return; error.code = 'E_STORE_UNREADABLE'; error.storeRead = true; throw error; }
  try {
    require('./publication-absence').assertPublicationAbsent(p, file => Object.assign(new Error(_korean() ? `저장 중이거나 저장이 중단된 파일일 수 있습니다. 원본을 보존하고 다시 시도하세요: ${file}` : `Stored file may be in an active or interrupted save; preserve the original and retry: ${file}`), { code: 'E_STORE_CHANGED', file, storeRead: true }));
  } catch (error) {
    if (error.code !== 'E_STORE_CHANGED') error.code = 'E_STORE_UNREADABLE';
    error.storeRead = true; throw error;
  }
}
function exists(p) { const found = fs.existsSync(p); if (!found) _assertManagedAbsent(p); return found; }
function read(p) {
   
  let text;
  try { text = fs.readFileSync(p, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') _assertManagedAbsent(p); throw error; }
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}
function readBuf(p) { return fs.readFileSync(p); }
 
 
 
 
 
 
 
 
let _dryGuard = false;
 
 
 
 
const _DRY_EXEMPT_TAIL = /(\.lock$|\.tmp-\d+-\d+$)/;
 
 
 
 
 
 
const _DRY_EXEMPT_OURS = /leerness-probe-\d+-\d+\.sh$/;
function _dryExempt(q) {
  const s = String(q);
  if (_DRY_EXEMPT_TAIL.test(s)) return true;
  if (_DRY_EXEMPT_OURS.test(s)) return true;
  return false;
}
function _dryCheck(p) {
  if (!_dryGuard) return;
  const s = String(p);
  if (_dryExempt(s)) return;
  throw Object.assign(new Error(_english() ? `--dry-run was given, but a write was attempted: ${s}` : `--dry-run 인데 쓰려고 했습니다: ${s}`),
    { code: 'E_DRY_RUN_WRITE', file: s });
}
 
 
 
 
const _FS_MUTATORS = ['writeFileSync', 'appendFileSync', 'unlinkSync', 'rmSync', 'rmdirSync',
  'renameSync', 'copyFileSync', 'mkdirSync', 'chmodSync', 'utimesSync', 'symlinkSync', 'truncateSync'];
let _fsPatched = false;
function _patchFsForDryRun() {
  if (_fsPatched) return;
  _fsPatched = true;
  for (const name of _FS_MUTATORS) {
    const orig = fs[name];
    if (typeof orig !== 'function') continue;
    fs[name] = function (...a) {
       
      _dryCheck(a[0]);
      if ((name === 'renameSync' || name === 'copyFileSync' || name === 'symlinkSync') && a[1] !== undefined) _dryCheck(a[1]);
      return orig.apply(fs, a);
    };
  }
}
function setDryRunGuard(on) { _dryGuard = !!on; if (on) _patchFsForDryRun(); }
 
 
 
function assertWriteAllowed(p) { _dryCheck(p); require('./runtime-writes').assertCurrentRuntimeWrite(p); }
 
function assertNotDryRun(p) { _dryCheck(p); }
 
 
 
 
 
 
 
function mkdirp(p) { _dryCheck(path.join(String(p), '_')); fs.mkdirSync(p, { recursive: true }); }
function mkdirpRaw(p) { fs.mkdirSync(p, { recursive: true }); }
 
 
let _writeSeq = 0;
 
 
 
 
function _rescueCorruptJson(p, s) {
  if (!/\.json$/i.test(p) || !fs.existsSync(p)) return;
  try { JSON.parse(s); } catch { return; }           
  let old;
  try { old = read(p); } catch { return; }
  try { JSON.parse(old); return; } catch {}           
   
  const bak = `${p}.corrupt-${Date.now()}-${process.pid}-${++_writeSeq}`;
   
  try {
    fs.renameSync(p, bak);
    console.error(_english() ? `⚠ Damaged JSON found — the original was moved aside before saving: ${path.basename(bak)} (for manual recovery)`
      : `⚠ 손상 JSON 감지 — 원본 대피 후 저장: ${path.basename(bak)} (수동 복구용)`);
  } catch {}
}
function writeUtf8(p, s) {
  _dryCheck(p);
   
   
   
  try { if (fs.existsSync(p) && fs.readFileSync(p).equals(Buffer.from(String(s), 'utf8'))) return; } catch {}
  mkdirp(path.dirname(p));
  _rescueCorruptJson(p, s);
  const tmp = `${p}.tmp-${process.pid}-${++_writeSeq}`;
  try {
    fs.writeFileSync(tmp, s, { encoding: 'utf8' });
    _renameWithRetry(tmp, p);
  } catch (e) {
     
     
    for (let i = 0; i < 5; i++) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); break; } catch { _sleepMsSync(20 + i * 20); }
    }
    throw e;
  }
}
function _concurrentModification(p, backupFile) {
  const en = _english();
  const recovery = backupFile ? (en ? ` (recovery backup: ${backupFile})` : ` (복구 백업: ${backupFile})`) : '';
  const e = new Error(en ? `The file changed after it was checked, so it was not overwritten: ${p}${recovery}`
    : `검사 후 파일이 변경되어 덮어쓰기를 거부했습니다: ${p}${recovery}`);
  e.code = 'E_CONCURRENT_MODIFICATION';
  e.file = p;
  if (backupFile) e.backupFile = backupFile;
  return e;
}
function _cleanupWriteArtifact(p) {
  let lastError = null;
  for (let i = 0; i < 5; i++) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); return null; } catch (e) { lastError = e; _sleepMsSync(20 + i * 20); }
  }
  return lastError || new Error(`임시 쓰기 아티팩트를 정리하지 못했습니다: ${p}`);
}
function _cleanupWriteScratch(p) {
  if (!p) return null;
  let lastError = null;
  for (let i = 0; i < 5; i++) {
     
     
     
    try { if (fs.existsSync(p)) fs.rmdirSync(p); return null; } catch (e) { lastError = e; _sleepMsSync(20 + i * 20); }
  }
  return lastError || new Error(`임시 쓰기 디렉터리를 정리하지 못했습니다: ${p}`);
}
function _mutationIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    nlink: stat.nlink,
    mode: stat.mode,
  };
}
function _sameMutationIdentity(a, b) {
  return !!a && !!b && a.dev === b.dev && a.ino === b.ino;
}
function _readMutationIdentity(p) {
  const link = fs.lstatSync(p);
  if (link.isSymbolicLink()) {
    const e = new Error(_english() ? `A symbolic link is not replaced automatically: ${p}` : `심볼릭 링크 대상은 자동 교체하지 않습니다: ${p}`);
    e.code = 'E_UNSAFE_LINK';
    throw e;
  }
  if (!link.isFile()) {
    const e = new Error(_english() ? `Only a regular file can be replaced automatically: ${p}` : `일반 파일만 자동 교체할 수 있습니다: ${p}`);
    e.code = 'E_UNSAFE_FILE_TYPE';
    throw e;
  }
  return _mutationIdentity(link);
}
function _identityChanged(p, expected) {
  const current = _readMutationIdentity(p);
  if (!_sameMutationIdentity(current, expected) || current.nlink !== 1 || (current.mode & 0o222) === 0) {
    const e = _concurrentModification(p);
    e.expectedIdentity = expected;
    e.actualIdentity = current;
    throw e;
  }
  return current;
}
// Finds the folder without creating it; dev, when given, must match the volume of the workspace's project folder.
function mutationRecoveryFolder(p, dev) {
  let dir = path.dirname(path.resolve(p));
  const volumeRoot = path.parse(dir).root;
  while (true) {
    const workspace = path.join(dir, '.leerness');
    try {
      if (fs.statSync(workspace).isDirectory() && (dev === undefined || fs.statSync(dir).dev === dev)) {
        return path.join(workspace, 'archive', 'mutation-recovery');
      }
    } catch {}
    if (dir === volumeRoot) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
function _makeMutationScratch(p, expectedIdentity) {
  const prefix = `.leerness-write-${process.pid}-`;
  const recovery = mutationRecoveryFolder(p, expectedIdentity.dev);
  const create = directory => {
    const base = path.join(directory, prefix);
    const input = process.platform === 'win32' && base.length + 6 >= 248
      ? path.toNamespacedPath(path.resolve(base)) : base;
    const made = fs.mkdtempSync(input);
    return input === base ? made : path.join(directory, path.basename(made));
  };
  for (let attempt = 1; recovery; attempt++) {
    try { mkdirp(recovery); } catch { break; }
    try { return create(recovery); }
    catch (e) { if (e.code !== 'ENOENT' || attempt === 3) throw e; }
  }
  return create(path.dirname(p));
}
function _attachRecoveryArtifacts(e, candidates, expected, planned, targetPath, maxReadBytes = null) {
  const seen = new Set();
  const artifacts = [];
  for (const candidate of candidates) {
    if (!candidate || !candidate.path || seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    let stat;
    try { stat = fs.lstatSync(candidate.path); } catch { continue; }
    const artifact = {
      role: candidate.role,
      path: candidate.path,
      kind: stat.isDirectory() ? 'directory' : 'file',
    };
    if (stat.isFile()) {
      artifact.size = stat.size;
      try {
        const bytes = readPublicationBytes(candidate.path,maxReadBytes);
        artifact.content = bytes.equals(expected) ? 'expected-original'
          : (bytes.equals(planned) ? 'planned-replacement' : 'concurrent-or-unknown');
      } catch (readError) {
        artifact.content = 'unreadable';
        artifact.readError = readError.code || readError.message;
      }
    }
    artifacts.push(artifact);
  }
  if (!artifacts.length) return e;
  e.recoveryArtifacts = artifacts;
  const recovery = artifacts.find(a => a.path !== targetPath && a.content === 'concurrent-or-unknown')
    || artifacts.find(a => a.path !== targetPath && a.role === 'displaced-original')
    || artifacts.find(a => a.path !== targetPath && a.kind === 'file');
  if (recovery && !e.backupFile) e.backupFile = recovery.path;
  const detail = artifacts.map(a => `${a.role}=${a.path} (${a.content || a.kind})`).join(', ');
   
  if (!e.message.includes('복구 아티팩트:') && !e.message.includes('recovery artifacts:')) {
    e.message = `${e.message} ${_english() ? `(recovery artifacts: ${detail})` : `(복구 아티팩트: ${detail})`}`;
  }
  return e;
}
 
 
 
 
 
 
function _replaceWindowsWithBackup(from, to, backup) {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
   
   
   
   
   
  const nativePath = file => String(file).length >= 248 ? path.toNamespacedPath(path.resolve(file)) : file;
  const command = "$utf8 = [Activator]::CreateInstance([System.Text.UTF8Encoding]); [Console]::OutputEncoding = $utf8; $OutputEncoding = $utf8; $ErrorActionPreference='Stop'; try { [IO.File]::Replace($env:LEERNESS_REPLACE_FROM, $env:LEERNESS_REPLACE_TO, $env:LEERNESS_REPLACE_BACKUP) } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; $win32 = ($e.HResult -band 0xFFFF); [Console]::Error.WriteLine(('LEERNESS_REPLACE_ERROR:{0}:{1}' -f $win32, $e.Message)); exit 1 }";
  let waited = 0;
  let attempts = 0;
  for (;;) {
    attempts++;
    assertWriteAllowed(to);  
    const r = cp.spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      env: {
        ...process.env,
        LEERNESS_REPLACE_FROM: nativePath(from),
        LEERNESS_REPLACE_TO: nativePath(to),
        LEERNESS_REPLACE_BACKUP: nativePath(backup),
      },
    });
    if (!r.error && r.status === 0) return;
    const raw = r.error ? r.error.message : String(r.stderr || r.stdout || `exit ${r.status}`).trim();
    const marker = /LEERNESS_REPLACE_ERROR:(\d+):([\s\S]*)/.exec(raw);
    const win32Code = marker ? Number(marker[1]) : null;
    const detail = marker ? marker[2].trim() : raw;
    const transientSharing = win32Code === 32 || win32Code === 33;
     
     
     
    const retrySafe = transientSharing && waited < 2000 && fs.existsSync(from) && !fs.existsSync(backup);
    if (!retrySafe) {
      const e = new Error(_english() ? `Windows metadata-preserving replacement failed: ${detail}` : `Windows 메타데이터 보존 교체 실패: ${detail}`);
      e.code = (r.error && r.error.code) || 'E_ATOMIC_REPLACE';
      e.win32Code = win32Code;
      e.attempts = attempts;
      throw e;
    }
    const delay = Math.min(50 * (2 ** Math.min(attempts - 1, 3)), 400, 2000 - waited);
    _sleepMsSync(delay);
    waited += delay;
  }
}
 
 
 
 
 
 
 
 
 
function writeBufferIfUnchanged(p, expectedValue, value, opts = {}) {
  _dryCheck(p);
  const maxReadBytes = opts.maxReadBytes === undefined ? null : opts.maxReadBytes;
  validatePublicationLimit(maxReadBytes);
  if (process.platform !== 'win32') {
    const e = new Error(`메타데이터 보존 원자 교체를 지원하지 않는 플랫폼입니다: ${process.platform}`);
    e.code = 'E_METADATA_PRESERVATION_UNAVAILABLE';
    throw e;
  }
  const expected = Buffer.isBuffer(expectedValue) ? expectedValue : Buffer.from(expectedValue);
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (maxReadBytes !== null && Math.max(expected.length,buf.length) > maxReadBytes) {
    throw Object.assign(new Error('Memory publication buffer exceeds declared byte limit'), { code: 'E_OUTPUT_LIMIT', bytesRead: 0 });
  }
  const expectedIdentity = opts.expectedIdentity || _readMutationIdentity(p);
  _identityChanged(p, expectedIdentity);
  let current = readPublicationBytes(p,maxReadBytes);
  if (!current.equals(expected)) throw _concurrentModification(p);
  if (current.equals(buf)) return { unchanged: true, recoveryArtifacts: [] };
  mkdirp(path.dirname(p));
  const mode = expectedIdentity.mode & 0o777;
   
   
   
  let scratch = _makeMutationScratch(p, expectedIdentity);
  const tmp = path.join(scratch, 'next');
  let backup = null;
  let replaceAttempted = false;
  try {
    fs.writeFileSync(tmp, buf, { flag: 'wx', mode });
    _identityChanged(p, expectedIdentity);
    current = readPublicationBytes(p,maxReadBytes);
    if (!current.equals(expected)) throw _concurrentModification(p);
    backup = path.join(scratch, 'before');
    replaceAttempted = true;
    _replaceWindowsWithBackup(tmp, p, backup);
    if (fs.existsSync(tmp)) {
      const e = new Error(_english() ? `Windows reported the replacement as successful, but the replacement source is still there: ${tmp}`
        : `Windows 교체가 성공을 보고했지만 replacement source가 남았습니다: ${tmp}`);
      e.code = 'E_ATOMIC_REPLACE_UNCERTAIN';
      throw e;
    }
    const replaced = readPublicationBytes(backup,maxReadBytes);
    const displacedIdentity = _readMutationIdentity(backup);
    const targetNow = readPublicationBytes(p,maxReadBytes);
    if (!replaced.equals(expected) || !targetNow.equals(buf)
        || !_sameMutationIdentity(displacedIdentity, expectedIdentity)
        || displacedIdentity.nlink !== 1) {
      throw _concurrentModification(p, backup);
    }
     
     
     
     
     
     
     
    if (opts.retainBackup === false) {
      const backupCleanupError = _cleanupWriteArtifact(backup);
      const scratchCleanupError = !backupCleanupError ? _cleanupWriteScratch(scratch) : null;
      if (!backupCleanupError && !scratchCleanupError) return { recoveryArtifacts: [] };
      return {
        backupFile: fs.existsSync(backup) ? backup : null,
        cleanupError: (backupCleanupError || scratchCleanupError).message,
        cleanupDirectory: scratch,
        recoveryArtifacts: fs.existsSync(backup)
          ? [{ role: 'displaced-original', path: backup, kind: 'file', size: replaced.length, content: 'expected-original' }]
          : [],
      };
    }
    return {
      backupFile: backup,
      recoveryArtifacts: [{ role: 'displaced-original', path: backup, kind: 'file', size: replaced.length, content: 'expected-original' }],
    };
  } catch (e) {
    const cleanupError = !replaceAttempted ? _cleanupWriteArtifact(tmp) : null;
    const scratchCleanupError = !replaceAttempted && !cleanupError ? _cleanupWriteScratch(scratch) : null;
    if (cleanupError || scratchCleanupError) {
      e.cleanupError = (cleanupError || scratchCleanupError).message;
    }
    _attachRecoveryArtifacts(e, replaceAttempted ? [
      { role: 'live-target', path: p },
      { role: 'planned-source', path: tmp },
      { role: 'displaced-original', path: backup },
    ] : [
      ...(cleanupError ? [{ role: 'cleanup-failed-source', path: tmp }] : []),
      ...(cleanupError || scratchCleanupError ? [{ role: 'cleanup-failed-scratch', path: scratch }] : []),
    ], expected, buf, p, maxReadBytes);
    throw e;
  }
}
 
 
 
 
 
const _RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
function _sleepMsSync(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {   } }
function _renameWithRetry(from, to) {
  let waited = 0;
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; }
    catch (e) {
      if (!_RENAME_RETRY_CODES.has(e.code) || waited >= 2000) throw e;
      const d = Math.min(5 + i * 10, 80);
      _sleepMsSync(d); waited += d;
    }
  }
}
function append(p, s) { _dryCheck(p); mkdirp(path.dirname(p)); fs.appendFileSync(p, s, 'utf8'); }
function rel(root, p) { return path.relative(root, p).replace(/\\/g, '/') || '.'; }

function _hardLinkIdentityEqual(a, b) {
  return !!(a && b)
    && String(a.dev) === String(b.dev)
    && String(a.ino) === String(b.ino);
}

function _lstatState(p) {
  try { return { exists: true, stat: fs.lstatSync(p), error: null }; }
  catch (error) {
    if (error && error.code === 'ENOENT') return { exists: false, stat: null, error: null };
    return { exists: null, stat: null, error };
  }
}

 
 
 
 
 
 
function _rollbackCommittedHardLink(alias, live, expected, maxReadBytes) {
  const liveState = _lstatState(live);
  if (liveState.exists === false) return { ok: true, canonicalState: 'absent', artifact: null };
  const aliasState = _lstatState(alias);
  if (liveState.exists !== true || aliasState.exists !== true
    || liveState.stat.isSymbolicLink() || !liveState.stat.isFile()
    || aliasState.stat.isSymbolicLink() || !aliasState.stat.isFile()
    || !_hardLinkIdentityEqual(liveState.stat, aliasState.stat)) {
    return { ok: false, canonicalState: 'unknown', artifact: null, error: liveState.error || aliasState.error || null };
  }
  if (expected) {
    try {
      if (!readPublicationBytes(live,maxReadBytes).equals(expected) || !readPublicationBytes(alias,maxReadBytes).equals(expected)) {
        return { ok: false, canonicalState: 'changed', artifact: null, error: null };
      }
    } catch (error) {
      return { ok: false, canonicalState: 'unknown', artifact: null, error };
    }
  }

  let removalError = null;
  try { fs.unlinkSync(live); }
  catch (error) { removalError = error; }
  if (_lstatState(live).exists === true) {
    try { removeSync(live, { force: true }); }
    catch (error) { removalError = removalError || error; }
  }
  if (_lstatState(live).exists === true) {
    const quarantine = `${live}.rollback-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
    try {
      fs.renameSync(live, quarantine);
      try { fs.unlinkSync(quarantine); }
      catch {
        try { removeSync(quarantine, { force: true }); } catch {}
      }
      const postRename = _lstatState(live);
      return postRename.exists === false
        ? { ok: true, canonicalState: 'absent', artifact: _lstatState(quarantine).exists === true ? quarantine : null }
        : { ok: false, canonicalState: 'present', artifact: quarantine, error: removalError };
    } catch (error) {
      removalError = removalError || error;
    }
  }
  const after = _lstatState(live);
  if (after.exists === false) return { ok: true, canonicalState: 'absent', artifact: null };
  if (after.exists === true && !after.stat.isSymbolicLink() && after.stat.isFile()
    && Number(after.stat.nlink) === 1
    && (!expected || readPublicationBytes(live,maxReadBytes).equals(expected))) {
    return { ok: true, canonicalState: 'detached', artifact: null };
  }
  return { ok: false, canonicalState: after.exists === true ? 'present' : 'unknown', artifact: null, error: after.error || removalError };
}

 
 
 
 
 
function detachCommittedHardLink(aliasPath, livePath, expectedBytes, opts = {}) {
  const maxReadBytes = opts.maxReadBytes === undefined ? null : opts.maxReadBytes;
  validatePublicationLimit(maxReadBytes);
  const alias = path.resolve(aliasPath);
  const live = path.resolve(livePath);
  let firstCleanupError = null;
  try {
    fs.unlinkSync(alias);
  } catch (error) {
    firstCleanupError = error;
     
     
    try { removeSync(alias, { force: true }); } catch {}
    if (fs.existsSync(alias)) {
      const detacher = `${alias}.detach-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
      let detacherExists = false;
      try {
        fs.writeFileSync(detacher, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
        detacherExists = true;
         
         
        fs.renameSync(detacher, alias);
        detacherExists = false;
      } catch (detachError) {
        try { if (detacherExists) removeSync(detacher, { force: true }); } catch {}
        const expected = Buffer.isBuffer(expectedBytes) ? expectedBytes : null;
        const rollback = _rollbackCommittedHardLink(alias, live, expected, maxReadBytes);
         
         
         
        if (rollback.ok && rollback.canonicalState === 'detached') {
          return { cleanupRecovered: true, cleanupArtifact: fs.existsSync(alias) ? alias : null };
        }
        const failure = new Error(_korean() ? `저장한 파일의 임시 하드 링크를 떼어내지 못했습니다: ${alias}`
          : `committed hard-link alias could not be detached: ${alias}`);
        failure.code = 'E_HARDLINK_DETACH_FAILED';
        failure.cleanupError = (detachError && detachError.message) || String(detachError);
        failure.canonicalRolledBack = rollback.ok && rollback.canonicalState === 'absent';
        failure.rollbackState = rollback.canonicalState;
        failure.rollbackArtifact = rollback.artifact || null;
        failure.rollbackError = rollback.error && (rollback.error.message || String(rollback.error));
        failure.cause = firstCleanupError;
        throw failure;
      }
       
       
      try { removeSync(alias, { force: true }); } catch {}
    }
  }
  let stat;
  try { stat = fs.lstatSync(live); }
  catch (error) {
    const failure = new Error(_korean() ? `준비한 하드 링크를 떼어내는 동안 저장한 파일이 사라졌습니다: ${live}`
      : `committed file disappeared while detaching its prepared alias: ${live}`);
    failure.code = 'E_HARDLINK_DETACH_FAILED';
    failure.cause = error;
    throw failure;
  }
  const expected = Buffer.isBuffer(expectedBytes) ? expectedBytes : null;
  if (stat.isSymbolicLink() || !stat.isFile() || Number(stat.nlink) !== 1
      || (expected && !readPublicationBytes(live,maxReadBytes).equals(expected))) {
    const failure = new Error(_korean() ? `하드 링크를 떼어낸 뒤 저장한 파일이 검증을 통과하지 못했습니다: ${live}`
      : `committed file failed post-detach validation: ${live}`);
    failure.code = 'E_HARDLINK_DETACH_FAILED';
    failure.cleanupError = firstCleanupError && firstCleanupError.message;
    throw failure;
  }
  return {
    cleanupRecovered: !!firstCleanupError,
    cleanupArtifact: fs.existsSync(alias) ? alias : null,
  };
}

const { pathWriter } = require('./runtime-writes');
module.exports = { mutationRecoveryFolder, log, ok, warn, fail, failJson, setQuiet, today, now, absRoot, exists, read, readBuf,
  mkdirp: pathWriter(mkdirp), writeUtf8: pathWriter(writeUtf8),
  writeBufferIfUnchanged: pathWriter(writeBufferIfUnchanged), append: pathWriter(append),
  rel, setDryRunGuard, assertNotDryRun, assertWriteAllowed: pathWriter(assertWriteAllowed),
  mkdirpRaw: pathWriter(mkdirpRaw), detachCommittedHardLink: pathWriter(detachCommittedHardLink) };
