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
  if (env[name]) return env[name];
  const key = Object.keys(env).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : null;
}

function _npmCliCandidates(execPath, env) {
  const nodeDir = path.dirname(execPath);
  const envExecPath = _envValue(env, 'npm_execpath');
  const envNpmCli = /[\\/]npm-cli\.(?:c?js)$/i.test(String(envExecPath || '')) ? envExecPath : null;
  return [
    envNpmCli,
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(nodeDir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
}

function resolveNpmCliPath(options = {}) {
  const execPath = options.execPath || process.execPath;
  const env = options.env || process.env;
  const candidates = _npmCliCandidates(execPath, env);
  for (const candidate of candidates) {
    if (_isFile(candidate)) return candidate;
  }

  if ((options.platform || process.platform) !== 'win32') return null;
  const where = cp.spawnSync('where.exe', ['npm.cmd'], {
    encoding: 'utf8',
    env,
    timeout: 5000,
    windowsHide: true,
  });
  if (where.status !== 0) return null;
  for (const wrapper of String(where.stdout || '').split(/\r?\n/).filter(Boolean)) {
    const candidate = path.join(path.dirname(wrapper.trim()), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (_isFile(candidate)) return candidate;
  }
  return null;
}

function _missingNpmResult() {
  const error = new Error('npm CLI JavaScript entrypoint not found');
  error.code = 'ENOENT';
  return {
    pid: 0,
    output: [null, '', error.message],
    stdout: '',
    stderr: error.message,
    status: null,
    signal: null,
    error,
  };
}

function spawnNpmSync(args, options = {}) {
  if (!Array.isArray(args)) throw new TypeError('npm args must be an array');
  const npmArgs = args.map(value => String(value));
  const hasExplicitCli = Object.prototype.hasOwnProperty.call(options, 'npmCliPath');
  const { npmCliPath: explicitCli, ...childOptions } = options;
  const spawnOptions = { ...childOptions, shell: false };
  const env = spawnOptions.env || process.env;
  const resolvedCli = hasExplicitCli
    ? (_isFile(explicitCli) ? explicitCli : null)
    : resolveNpmCliPath({ execPath: process.execPath, env, platform: process.platform });

  // npm_execpath가 가리키는 npm-cli.js를 우선하면 npm/pnpm을 섞어 실행하지 않고,
  // Windows에서도 .cmd 셸 래퍼 없이 argv를 그대로 보존할 수 있다.
  if (resolvedCli) {
    if (spawnOptions.windowsHide === undefined) spawnOptions.windowsHide = true;
    return cp.spawnSync(process.execPath, [resolvedCli, ...npmArgs], spawnOptions);
  }

  if (process.platform === 'win32' || hasExplicitCli) return _missingNpmResult();
  return cp.spawnSync('npm', npmArgs, spawnOptions);
}

module.exports = { resolveNpmCliPath, spawnNpmSync };
