'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const { deadlineOptions } = require('./process-deadline');

function _isFile(filePath) {
  if (!filePath) return false;
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

function _envValue(env, name) {
  if (!env) return null;
  const key = Object.keys(env).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : null;
}

function _windowsSystemRoot(env) {
  return _envValue(env, 'SystemRoot') || _envValue(env, 'WINDIR')
    || _envValue(process.env, 'SystemRoot') || _envValue(process.env, 'WINDIR');
}

function _hasPathSeparator(file) {
  return /[\\/]/.test(file) || /^[A-Za-z]:/.test(file);
}

function _windowsPathEntries(env, cwd) {
  const rawPath = String(_envValue(env, 'PATH') || '');
  const dirs = [];
  const seen = new Set();
  for (let item of rawPath.split(path.delimiter)) {
    item = item.trim().replace(/^"|"$/g, '');
    if (!item) continue;
    item = item.replace(/%([^%]+)%/g, (all, name) => _envValue(env, name) || all);
    const absolute = path.isAbsolute(item) ? item : path.resolve(cwd || process.cwd(), item);
    let normalized = path.normalize(absolute);
    try { normalized = fs.realpathSync.native(normalized); } catch {}
    const identity = normalized.toLowerCase();
    if (!seen.has(identity)) {
      seen.add(identity);
      dirs.push(normalized);
    }
  }
  return dirs;
}

function _windowsPathDirs(env, cwd) {
  return new Set(_windowsPathEntries(env, cwd).map(dir => dir.toLowerCase()));
}

 
 
 
 
function _gitPathFingerprint(env, cwd) {
  const rows = [];
  for (const dir of _windowsPathEntries(env, cwd)) {
    let names;
    try { names = fs.readdirSync(dir); }
    catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        rows.push([dir.toLowerCase(), 'missing']);
        continue;
      }
      return null;
    }
    const candidates = names.filter(name => /^git(?:\.|$)/i.test(name)).sort();
    const entries = [];
    for (const name of candidates) {
      const candidate = path.join(dir, name);
      try {
        const real = fs.realpathSync.native(candidate);
        const stat = fs.statSync(candidate, { bigint: true });
        entries.push([name, real.toLowerCase(), stat.isFile(),
          String(stat.dev), String(stat.ino), String(stat.size),
          String(stat.mtimeNs), String(stat.ctimeNs)]);
      } catch { return null; }
    }
    rows.push([dir.toLowerCase(), entries]);
  }
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

const _gitLaunchCache = new Map();
let _gitLaunchGeneration = null;

function _copyLaunch(launch) {
  return { ...launch, argsPrefix: [...launch.argsPrefix] };
}

function _candidateComesFromPath(candidate, allowedDirs) {
  let dir = path.dirname(candidate);
  try { dir = fs.realpathSync.native(dir); } catch { dir = path.normalize(dir); }
  return allowedDirs.has(dir.toLowerCase());
}

function _explicitWindowsCandidates(file, cwd, env) {
  const base = path.isAbsolute(file) ? path.normalize(file) : path.resolve(cwd || process.cwd(), file);
  if (path.extname(base)) return [base];
  const pathExt = String(_envValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD')
    .split(';').map(ext => ext.trim()).filter(Boolean);
  return [base, ...pathExt.map(ext => base + (ext.startsWith('.') ? ext : `.${ext}`))];
}

function _literalWindowsPathCandidates(file, dirs, options) {
  if (!file || /[\\/:*?"<>|\u0000-\u001f]/.test(file) || file === '.' || file === '..') return [];
  const allowed = new Set(dirs.map(dir => dir.toLowerCase()));
  let cwd = path.resolve(options.cwd || process.cwd());
  try { cwd = fs.realpathSync.native(cwd); } catch {}
  const ordered = allowed.has(cwd.toLowerCase())
    ? [cwd, ...dirs.filter(dir => dir.toLowerCase() !== cwd.toLowerCase())] : dirs;
  const extensions = path.extname(file) ? [] : String(_envValue(options.env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD')
    .split(';').map(ext => ext.trim()).filter(ext => /^\.[^\\/:*?"<>|\u0000-\u0020]+$/.test(ext));
  const names = [...new Set([file, ...extensions.map(ext => file + ext)])];
  const candidates = [];
  for (const dir of ordered) {
    for (const name of names) {
      deadlineOptions({ deadlineAt: options.deadlineAt });
      const candidate = path.join(dir, name);
      try {
        if (fs.statSync(candidate).isFile() && _candidateComesFromPath(candidate, allowed)) candidates.push(candidate);
      } catch (error) {
        if (options.deadlineAt !== undefined && !['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      }
    }
  }
  deadlineOptions({ deadlineAt: options.deadlineAt });
  return candidates;
}

function _whereWindowsCandidates(file, options) {
  const env = { ...(options.env || process.env) };
  if (!_envValue(env, 'PATHEXT')) env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
  const systemRoot = _windowsSystemRoot(env);
  const systemWhere = systemRoot && path.join(systemRoot, 'System32', 'where.exe');
   
   
  if (!_isFile(systemWhere)) {
    if (options.deadlineAt !== undefined) throw Object.assign(new Error('Trusted command locator unavailable'), { code: 'E_COMMAND_LOOKUP' });
    return [];
  }
  if (options.literalPathLookup === true) {
    try { return _literalWindowsPathCandidates(file, _windowsPathEntries(env, options.cwd), { ...options, env }); }
    catch (error) {
      if (error.code === 'ETIMEDOUT') throw error;
      const confirmed = _whereWindowsCandidates(file, { ...options, env, literalPathLookup: false });
      if (!confirmed.length) throw error;
      return confirmed;
    }
  }
  const whereFile = systemWhere;
  const result = cp.spawnSync(whereFile, [file], deadlineOptions({
    deadlineAt: options.deadlineAt,
    cwd: options.cwd,
    env,
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
    shell: false,
    ...(options.deadlineAt !== undefined ? { maxBuffer: 64 * 1024 } : {}),
  }));
  if (options.deadlineAt !== undefined && (result.error || ![0, 1].includes(result.status))) {
    throw result.error || Object.assign(new Error('Command locator failed'), { code: 'E_COMMAND_LOOKUP' });
  }
  if (result.status !== 0) return [];
  const dirs = _windowsPathEntries(env, options.cwd);
  if (/[^\x00-\x7f]/.test(file) || dirs.some(dir => /[^\x00-\x7f]/.test(dir))) {
    return _literalWindowsPathCandidates(file, dirs, { ...options, env });
  }
  const allowedDirs = new Set(dirs.map(dir => dir.toLowerCase()));
  return String(result.stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
     
     
    .filter(candidate => _candidateComesFromPath(candidate, allowedDirs));
}

function _isPortableExecutable(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const magic = Buffer.alloc(2);
    return fs.readSync(fd, magic, 0, 2, 0) === 2 && magic[0] === 0x4d && magic[1] === 0x5a;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

function _launchForShimEntry(entry, shimPath, execPath) {
  const entryExt = path.extname(entry).toLowerCase();
  if (entryExt === '.exe' || entryExt === '.com' || _isPortableExecutable(entry)) {
    return { file: entry, argsPrefix: [], kind: 'npm-native-shim', source: shimPath };
  }
   
   
  if (!['.js', '.cjs', '.mjs'].includes(entryExt)) return null;
  const bundledNode = path.join(path.dirname(shimPath), 'node.exe');
  return {
    file: _isFile(bundledNode) ? bundledNode : execPath,
    argsPrefix: [entry],
    kind: 'npm-node-shim',
    source: shimPath,
  };
}

 
 
 
 
function _resolveNpmCmdShim(cmdPath, execPath = process.execPath) {
  try {
    const source = fs.readFileSync(cmdPath, 'utf8');
    const match = source.match(/"%dp0%[\\/]+([^"\r\n]+)"\s+%\*/i);
    if (!match || !match[1] || /[%\u0000\r\n]/.test(match[1])) return null;
    const entry = path.resolve(path.dirname(cmdPath), match[1].replace(/[\\/]/g, path.sep));
    if (!_isFile(entry)) return null;
    return _launchForShimEntry(entry, cmdPath, execPath);
  } catch {
    return null;
  }
}

function _resolveNpmPowerShellShim(ps1Path, execPath = process.execPath) {
  try {
    if (!_isFile(ps1Path)) return null;
    const source = fs.readFileSync(ps1Path, 'utf8');
    const match = source.match(/"\$(?:basedir|PSScriptRoot)[\\/]+([^"\r\n]+)"\s+(?:\$args|@args)\b/i);
    if (!match || !match[1] || /[%$\u0000\r\n]/.test(match[1])) return null;
    const entry = path.resolve(path.dirname(ps1Path), match[1].replace(/[\\/]/g, path.sep));
    if (!_isFile(entry)) return null;
    const launch = _launchForShimEntry(entry, ps1Path, execPath);
    if (launch) launch.kind = launch.kind.replace(/^npm-/, 'npm-ps1-');
    return launch;
  } catch {
    return null;
  }
}

function _resolveKnownNpmTool(candidate, execPath = process.execPath) {
  const name = path.basename(candidate).toLowerCase();
  const cli = name === 'npm.cmd' || name === 'npm.exe'
    ? 'npm-cli.js'
    : name === 'npx.cmd' || name === 'npx.exe' ? 'npx-cli.js' : null;
  if (!cli) return null;
  const entry = path.join(path.dirname(candidate), 'node_modules', 'npm', 'bin', cli);
  if (!_isFile(entry)) return null;
  return _launchForShimEntry(entry, candidate, execPath);
}

function _resolvePortableLaunchUncached(file, options = {}) {
  if (typeof file !== 'string' || !file || /\u0000/.test(file)) {
    throw new TypeError('portable process file must be a non-empty string without NUL');
  }
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return { file, argsPrefix: [], kind: 'direct', source: file };

  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const candidates = _hasPathSeparator(file)
    ? _explicitWindowsCandidates(file, cwd, env)
    : _whereWindowsCandidates(file, { cwd, env, deadlineAt: options.deadlineAt, literalPathLookup: options.literalPathLookup });
  let safeFailure = null;

  for (const candidate of candidates) {
    const ext = path.extname(candidate).toLowerCase();
    if (ext === '.exe' || ext === '.com' || (!ext && _isPortableExecutable(candidate))) {
      return { file: candidate, argsPrefix: [], kind: 'native', source: candidate };
    }
    if (ext === '.cmd' || ext === '.bat') {
      const npmShim = _resolveNpmCmdShim(candidate, options.execPath || process.execPath);
      if (npmShim) return npmShim;
       
       
       
      const knownNpmTool = _resolveKnownNpmTool(candidate, options.execPath || process.execPath);
      if (knownNpmTool) return knownNpmTool;
      const ps1Shim = _resolveNpmPowerShellShim(candidate.slice(0, -ext.length) + '.ps1', options.execPath || process.execPath);
      if (ps1Shim) return ps1Shim;
       
       
      if (!safeFailure) safeFailure = { file: candidate, argsPrefix: [], kind: 'unsupported-shell-script', source: candidate };
      continue;
    }
    if (ext === '.ps1') {
      const ps1Shim = _resolveNpmPowerShellShim(candidate, options.execPath || process.execPath);
      if (ps1Shim) return ps1Shim;
      if (!safeFailure) safeFailure = { file: candidate, argsPrefix: [], kind: 'unsupported-shell-script', source: candidate };
      continue;
    }
    if (!safeFailure && _isFile(candidate)) {
      safeFailure = { file: candidate, argsPrefix: [], kind: 'direct-unknown', source: candidate };
    }
  }

  return safeFailure || { file, argsPrefix: [], kind: 'unresolved', source: file };
}

function resolvePortableLaunch(file, options = {}) {
  if (file !== 'git' || (options.platform || process.platform) !== 'win32') {
    return _resolvePortableLaunchUncached(file, options);
  }
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  let key;
  let fingerprint;
  let generation;
  try {
     
     
     
    const realCwd = fs.realpathSync.native(cwd);
    const execPath = options.execPath || process.execPath;
    key = crypto.createHash('sha256').update(JSON.stringify([cwd, realCwd,
      Object.entries(env).sort(([a], [b]) => a.localeCompare(b)),
      execPath])).digest('hex');
    fingerprint = _gitPathFingerprint(env, cwd);
    if (fingerprint !== null && fingerprint !== undefined) generation = crypto.createHash('sha256').update(JSON.stringify([cwd, realCwd,
      _envValue(env, 'PATH'), _envValue(env, 'PATHEXT'), _envValue(env, 'SystemRoot'), _envValue(env, 'WINDIR'),
      _windowsSystemRoot(env), execPath, fingerprint])).digest('hex');
  } catch {   }
  if (!generation || generation !== _gitLaunchGeneration) {
    _gitLaunchCache.clear();
    _gitLaunchGeneration = generation || null;
  }
  deadlineOptions({ deadlineAt: options.deadlineAt });
  const cached = generation && _gitLaunchCache.get(key);
  if (cached) {
    return _copyLaunch(cached);
  }
  let launch;
  try { launch = _resolvePortableLaunchUncached(file, options); }
  catch (error) { _gitLaunchCache.clear(); _gitLaunchGeneration = null; throw error; }
  if (generation && launch.kind === 'native' && path.isAbsolute(launch.file)) {
    _gitLaunchCache.set(key, _copyLaunch(launch));
    if (_gitLaunchCache.size > 8) _gitLaunchCache.delete(_gitLaunchCache.keys().next().value);
  } else { _gitLaunchCache.clear(); _gitLaunchGeneration = null; }
  return launch;
}

function _portableOptions(options) {
  const { shell: _shell, windowsVerbatimArguments: _windowsVerbatimArguments, literalPathLookup: _literalPathLookup, ...rest } = options || {};
  return deadlineOptions({ ...rest, shell: false, windowsVerbatimArguments: false });
}

function _unsupportedShimSpec(source) {
  return {
    file: process.execPath,
    args: [
      '-e',
      "process.stderr.write('leerness: unsupported Windows command shim: ' + process.argv[1] + '\\n'); process.exit(126);",
      '--',
      String(source || '(unknown)'),
    ],
  };
}

function _unresolvedCommandSpec(source) {
  return {
    file: process.execPath,
    args: [
      '-e',
      "process.stderr.write('leerness: command not found on PATH: ' + process.argv[1] + '\\n'); process.exit(127);",
      '--',
      String(source || '(unknown)'),
    ],
  };
}

function spawnPortableSync(file, args, options = {}) {
  if (!Array.isArray(args)) throw new TypeError('portable process args must be an array');
  const argv = args.map(value => String(value));
  const launch = resolvePortableLaunch(file, options);
  if (options.deadlineAt !== undefined && ['unresolved', 'unsupported-shell-script'].includes(launch.kind)) {
    const code = launch.kind === 'unresolved' ? 'ENOENT' : 'E_PORTABLE_SHELL_UNSUPPORTED';
    return { status: null, signal: null, stdout: '', stderr: '', error: Object.assign(new Error('Command cannot be observed'), { code }) };
  }
  if (launch.kind === 'unsupported-shell-script') {
    const denied = _unsupportedShimSpec(launch.source);
    return cp.spawnSync(denied.file, denied.args, _portableOptions(options));
  }
   
   
  if (launch.kind === 'unresolved') {
    const denied = _unresolvedCommandSpec(launch.source);
    return cp.spawnSync(denied.file, denied.args, _portableOptions(options));
  }
  const result = cp.spawnSync(launch.file, [...launch.argsPrefix, ...argv], _portableOptions(options));
  // Non-enumerable, so serialized results are unchanged; callers reporting the tool path reuse the file that ran.
  if (result && typeof result === 'object') Object.defineProperty(result, 'launch', { value: _copyLaunch(launch) });
  return result;
}

function spawnPortable(file, args, options = {}) {
  if (!Array.isArray(args)) throw new TypeError('portable process args must be an array');
  const argv = args.map(value => String(value));
  const launch = resolvePortableLaunch(file, options);
  if (launch.kind === 'unsupported-shell-script') {
    const denied = _unsupportedShimSpec(launch.source);
    return cp.spawn(denied.file, denied.args, _portableOptions(options));
  }
  if (launch.kind === 'unresolved') {
    const denied = _unresolvedCommandSpec(launch.source);
    return cp.spawn(denied.file, denied.args, _portableOptions(options));
  }
  return cp.spawn(launch.file, [...launch.argsPrefix, ...argv], _portableOptions(options));
}

function windowsPathCandidates(file, options = {}) {
  if ((options.platform || process.platform) !== 'win32') return [];
  return _whereWindowsCandidates(file, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    deadlineAt: options.deadlineAt,
  });
}

module.exports = {
  resolvePortableLaunch,
  spawnPortable,
  spawnPortableSync,
  windowsPathCandidates,
  _resolveNpmCmdShim,
  _resolveNpmPowerShellShim,
  _resolveKnownNpmTool,
};
