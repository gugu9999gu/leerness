'use strict';

const fs = require('fs');
const path = require('path');
const { gitSpawn } = require('./git');

class StatePathError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StatePathError';
    this.code = code;
  }
}

function canonicalDirectory(value) {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f]/.test(value)) {
    throw new StatePathError('path_invalid', 'An existing directory path without control characters is required.');
  }
  try {
    const resolved = fs.realpathSync.native(path.resolve(value));
    if (!fs.statSync(resolved).isDirectory()) {
      throw new StatePathError('path_not_directory', 'The inspection target must be a directory.');
    }
    return resolved;
  } catch (error) {
    if (error instanceof StatePathError) throw error;
    const missing = error.code === 'ENOENT' || error.code === 'ENOTDIR';
    throw new StatePathError(missing ? 'path_not_found' : 'path_unreadable',
      missing ? 'The inspection directory does not exist.' : 'The inspection directory cannot be resolved.');
  }
}

function unavailable() {
  return new StatePathError('git_repository_unavailable',
    'Git repository discovery failed; no alternate state backend was selected.');
}

// Distinguish a genuinely non-Git directory from damaged repository metadata.
// Respect Git's discovery ceilings and filesystem boundary; never inspect above them.
function hasRepositoryMarker(root, env) {
  const ceilingValue = Object.keys(env).find(key => key.toUpperCase() === 'GIT_CEILING_DIRECTORIES');
  const ceilings = new Set(String(env[ceilingValue] || '').split(path.delimiter)
    .filter(value => value && path.isAbsolute(value)).flatMap(value => {
      try { return [fs.realpathSync.native(value)]; }
      catch (error) {
        // Git ignores nonexistent ceiling entries; they are not project paths.
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
        throw error;
      }
    }));
  const acrossKey = Object.keys(env).find(key => key.toUpperCase() === 'GIT_DISCOVERY_ACROSS_FILESYSTEM');
  const across = /^(1|true|yes|on)$/i.test(String(env[acrossKey] || ''));
  const device = fs.statSync(root).dev;
  let current = root;
  for (let depth = 0; depth < 128; depth++) {
    try { fs.lstatSync(path.join(current, '.git')); return true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current || ceilings.has(parent)) return false;
    if (!across && fs.statSync(parent).dev !== device) return false;
    current = parent;
  }
  throw unavailable();
}

function processFailure(result) {
  // The Windows portable gateway reports missing/unsupported launchers via
  // its own bounded child exit, not spawnSync.error. Keep the same taxonomy.
  if (result.status === 127 && /^leerness: command not found on PATH: git\r?\n?$/.test(String(result.stderr || ''))) {
    throw new StatePathError('git_missing', 'Git is unavailable; install Git before inspecting repository topology.');
  }
  if (result.status === 126 && /^leerness: unsupported Windows command shim: /.test(String(result.stderr || ''))) {
    throw new StatePathError('git_unsupported', 'The configured Git launcher is unsupported.');
  }
  if (!result.error) return;
  const codes = {
    ENOENT: ['git_missing', 'Git is unavailable; install Git before inspecting repository topology.'],
    ETIMEDOUT: ['git_timeout', 'Git topology discovery timed out.'],
    ENOBUFS: ['git_output_limit', 'Git topology output exceeded the inspection limit.'],
    EACCES: ['git_unreadable', 'Git could not be executed with the current permissions.'],
    EPERM: ['git_unreadable', 'Git could not be executed with the current permissions.'],
  };
  const [code, message] = codes[result.error.code] || ['git_failed', 'Git topology discovery could not run.'];
  throw new StatePathError(code, message);
}

function parseTopology(root, result, env) {
  processFailure(result);
  const output = String(result.stdout || '').replace(/\r?\n$/, '');
  const lines = output.split(/\r?\n/);
  if (lines.includes('--path-format=absolute')) {
    throw new StatePathError('git_unsupported', 'Git must support rev-parse --path-format=absolute.');
  }
  if (lines[0] === 'true') {
    throw new StatePathError('git_bare_unsupported', 'A bare repository has no worktree-private project runtime.');
  }
  if (lines[1] === 'true') {
    throw new StatePathError('git_metadata_path', 'Inspect a worktree project, not a Git metadata directory.');
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr || '');
    if (/permission denied|access is denied/i.test(stderr)) {
      throw new StatePathError('git_unreadable', 'Git could not read repository metadata.');
    }
    if (!output && /fatal: not a git repository \(or any (?:of the )?parent (?:directories|up to mount point)/i.test(stderr)
      && !hasRepositoryMarker(root, env)) return null;
    throw unavailable();
  }
  if (lines.length !== 5 || lines[0] !== 'false' || lines[1] !== 'false'
    || lines.slice(2).some(value => !path.isAbsolute(value))) {
    throw new StatePathError('git_output_invalid', 'Git did not return an unambiguous absolute topology.');
  }
  const [worktreeRoot, gitDir, gitCommonDir] = lines.slice(2).map(canonicalDirectory);
  const relative = path.relative(worktreeRoot, root);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw unavailable();
  return { worktreeRoot, gitDir, gitCommonDir, linkedWorktree: gitDir !== gitCommonDir };
}

function resolveGitTopology(root, options = {}) {
  const env = { ...(options.env || process.env), LC_ALL: 'C', LANGUAGE: 'C', GIT_TERMINAL_PROMPT: '0' };
  const args = ['-C', root, 'rev-parse', '--path-format=absolute', '--is-bare-repository',
    '--is-inside-git-dir', '--show-toplevel', '--git-dir', '--git-common-dir'];
  try {
    const result = gitSpawn(args, { cwd: root, env, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 });
    return parseTopology(root, result, env);
  } catch (error) {
    if (error instanceof StatePathError && !error.code.startsWith('path_')) throw error;
    if (['EACCES', 'EPERM', 'path_unreadable'].includes(error.code)) {
      throw new StatePathError('git_unreadable', 'Git repository directories could not be read.');
    }
    if (error.code === 'path_invalid' || error.code === 'path_not_directory') {
      throw new StatePathError('git_output_invalid', 'Git did not return usable directory paths.');
    }
    throw unavailable();
  }
}

module.exports = { StatePathError, canonicalDirectory, resolveGitTopology, hasRepositoryMarker };
