'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function _isFile(filePath) {
  if (!filePath) return false;
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

function _envValue(env, name) {
  if (!env) return null;
  const key = Object.keys(env).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : null;
}

function _hasPathSeparator(file) {
  return /[\\/]/.test(file) || /^[A-Za-z]:/.test(file);
}

function _windowsPathDirs(env, cwd) {
  const rawPath = String(_envValue(env, 'PATH') || '');
  const dirs = new Set();
  for (let item of rawPath.split(path.delimiter)) {
    item = item.trim().replace(/^"|"$/g, '');
    if (!item) continue;
    item = item.replace(/%([^%]+)%/g, (all, name) => _envValue(env, name) || all);
    const absolute = path.isAbsolute(item) ? item : path.resolve(cwd || process.cwd(), item);
    let normalized = path.normalize(absolute);
    try { normalized = fs.realpathSync.native(normalized); } catch {}
    dirs.add(normalized.toLowerCase());
  }
  return dirs;
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

function _whereWindowsCandidates(file, options) {
  const env = { ...(options.env || process.env) };
  if (!_envValue(env, 'PATHEXT')) env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
  const systemRoot = _envValue(env, 'SystemRoot') || _envValue(env, 'WINDIR')
    || _envValue(process.env, 'SystemRoot') || _envValue(process.env, 'WINDIR');
  const systemWhere = systemRoot && path.join(systemRoot, 'System32', 'where.exe');
  // A bare fallback would let a minimal caller env execute cwd/where.exe. If the
  // host System32 locator cannot be established, fail closed and return no candidates.
  if (!_isFile(systemWhere)) return [];
  const whereFile = systemWhere;
  const result = cp.spawnSync(whereFile, [file], {
    cwd: options.cwd,
    env,
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) return [];
  const allowedDirs = _windowsPathDirs(env, options.cwd);
  return String(result.stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    // where.exe는 PATH와 무관하게 cwd를 먼저 검색한다. bare tool 탐지는 untrusted project의
    // git.exe/claude.cmd를 실행하면 안 되므로 명시 PATH 디렉터리의 후보만 남긴다.
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
  // npm의 일반 JS bin과 실제 배포본에서 쓰이는 .cjs/.mjs만 현재 Node로 실행한다.
  // 예: claude.cmd는 claude.exe를 가리키므로 위 native 분기가 반드시 먼저여야 한다.
  if (!['.js', '.cjs', '.mjs'].includes(entryExt)) return null;
  const bundledNode = path.join(path.dirname(shimPath), 'node.exe');
  return {
    file: _isFile(bundledNode) ? bundledNode : execPath,
    argsPrefix: [entry],
    kind: 'npm-node-shim',
    source: shimPath,
  };
}

// npm이 생성한 Windows .cmd shim은 마지막 실행 줄에
//   "%_prog%" "%dp0%\node_modules\...\cli.js" %*
// 형태로 실제 진입점을 기록한다. cmd.exe를 거치지 않고 그 파일을 직접 실행하면
// 임의 argv의 %, !, 따옴표, 후행 역슬래시가 셸에서 재해석되지 않는다.
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

function resolvePortableLaunch(file, options = {}) {
  if (typeof file !== 'string' || !file || /\u0000/.test(file)) {
    throw new TypeError('portable process file must be a non-empty string without NUL');
  }
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return { file, argsPrefix: [], kind: 'direct', source: file };

  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const candidates = _hasPathSeparator(file)
    ? _explicitWindowsCandidates(file, cwd, env)
    : _whereWindowsCandidates(file, { cwd, env });
  let safeFailure = null;

  for (const candidate of candidates) {
    const ext = path.extname(candidate).toLowerCase();
    if (ext === '.exe' || ext === '.com' || (!ext && _isPortableExecutable(candidate))) {
      return { file: candidate, argsPrefix: [], kind: 'native', source: candidate };
    }
    if (ext === '.cmd' || ext === '.bat') {
      const npmShim = _resolveNpmCmdShim(candidate, options.execPath || process.execPath);
      if (npmShim) return npmShim;
      // npm 11의 Windows wrappers는 %NPM_CLI_JS%/Invoke-Expression을 사용해 일반
      // 정규식 파서로 해석할 수 없다. PATH에서 검증된 npm/npx wrapper에 한해
      // well-known sibling JS 진입점을 직접 확인하고 Node로 실행한다.
      const knownNpmTool = _resolveKnownNpmTool(candidate, options.execPath || process.execPath);
      if (knownNpmTool) return knownNpmTool;
      const ps1Shim = _resolveNpmPowerShellShim(candidate.slice(0, -ext.length) + '.ps1', options.execPath || process.execPath);
      if (ps1Shim) return ps1Shim;
      // .cmd/.bat를 shell:true로 되돌리면 BatBadBut/DEP0190 표면이 다시 열린다.
      // 안전한 대체 실행기가 없을 때는 shell:false 실패를 그대로 돌려준다.
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

function _portableOptions(options) {
  const { shell: _shell, windowsVerbatimArguments: _windowsVerbatimArguments, ...rest } = options || {};
  return { ...rest, shell: false, windowsVerbatimArguments: false };
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
  if (launch.kind === 'unsupported-shell-script') {
    const denied = _unsupportedShimSpec(launch.source);
    return cp.spawnSync(denied.file, denied.args, _portableOptions(options));
  }
  // Windows CreateProcess searches cwd before PATH for a bare name. If the safe
  // PATH-only resolver found nothing, spawning that bare name would undo the guard.
  if (launch.kind === 'unresolved') {
    const denied = _unresolvedCommandSpec(launch.source);
    return cp.spawnSync(denied.file, denied.args, _portableOptions(options));
  }
  return cp.spawnSync(launch.file, [...launch.argsPrefix, ...argv], _portableOptions(options));
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
