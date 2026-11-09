 
//
 
 
 
 
 
//
 
 
 
'use strict';
const { spawnPortableSync } = require('./portable-process');

 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
const GIT_LOCATION_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE',
  'GIT_CONFIG', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS'];
const _DROP = new Set(GIT_LOCATION_ENV);
 
const _DROP_PREFIX = /^GIT_CONFIG_(KEY|VALUE)_\d+$/;
const _shouldDrop = (name) => { const u = String(name).toUpperCase(); return _DROP.has(u) || _DROP_PREFIX.test(u); };

 
 
 
 
 
 
 
const _GIT_MUTATING = new Set(['add', 'rm', 'mv', 'commit', 'merge', 'rebase', 'reset', 'checkout', 'switch',
  'restore', 'branch', 'tag', 'push', 'fetch', 'pull', 'clone', 'init', 'worktree', 'stash', 'apply', 'cherry-pick',
  'revert', 'clean', 'gc', 'prune', 'update-ref', 'symbolic-ref', 'notes', 'submodule', 'config', 'remote',
  'hash-object', 'mktree', 'commit-tree']);
 
 
function _gitReadArgs(rest, switches, values = new Set(), optional = new Set()) {
  const operands = [], flags = new Set();
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === '--') { operands.push(...rest.slice(i + 1)); break; }
    if (!token.startsWith('-')) { operands.push(token); continue; }
    const name = token.split('=', 1)[0];
    if (values.has(name)) {
      if (!token.includes('=')) {
        if (rest[i + 1] !== undefined && (!optional.has(name) || !rest[i + 1].startsWith('-'))) i++;
        else if (!optional.has(name)) return null;
      }
    } else if (!switches.test(token)) return null;
    flags.add(name);
  }
  return { operands, flags };
}
function _gitRefReadForm(sub, rest) {
  const filters = new Set(['--contains', '--no-contains', '--merged', '--no-merged', '--points-at']);
  const values = new Set([...filters, '--sort', '--format']);
  const optional = new Set([...filters].filter(value => sub === 'tag' || value !== '--points-at'));
  const common = /^(?:--list|--(?:no-)?(?:color|column)(?:=.*)?|--(?:no-)?(?:ignore-case|omit-empty)|-[li])$/;
  const extra = sub === 'branch'
    ? /^(?:-[alrvi]+|--(?:all|remotes|show-current|verbose|no-verbose|no-abbrev)|--abbrev(?:=\d+)?)$/
    : /^(?:-[lvi]+|-n\d*|--verify)$/;
  const parsed = _gitReadArgs(rest, { test: token => common.test(token) || extra.test(token) }, values, optional);
  if (!parsed) return false;
  const listing = [...parsed.flags].some(flag => filters.has(flag) || flag === '--list'
    || (sub === 'branch' ? /^(?:--all|--remotes|--show-current|-[alrvi]*[alr][alrvi]*)$/ : /^(?:--verify|-n\d*|-[lvi]*[lv][lvi]*)$/).test(flag));
  return listing || parsed.operands.length === 0;
}
 
const _GIT_READ_ONLY_FORM = (sub, rest) => {
  if (sub === 'hash-object') return !!_gitReadArgs(rest, /^(?:--stdin|--stdin-paths|--no-filters|--literally)$/,
    new Set(['-t', '--path']));
  if (sub === 'branch' || sub === 'tag') return _gitRefReadForm(sub, rest);
  if (sub === 'config') {
    const parsed = _gitReadArgs(rest,
      /^(?:--(?:get|get-all|get-regexp|get-urlmatch|get-color|get-colorbool|list|local|global|system|worktree|null|name-only|show-origin|show-scope|includes|no-includes|fixed-value|bool|int|bool-or-int|path|expiry-date)|-[lz])$/,
      new Set(['--file', '-f', '--blob', '--type', '--default']));
    return !!parsed && [...parsed.flags].some(flag => /^(?:--get(?:-all|-regexp|-urlmatch|-color|-colorbool)?|--list|-l)$/.test(flag));
  }
  if (sub === 'symbolic-ref') {
    const parsed = _gitReadArgs(rest, /^(?:-q|--(?:no-)?(?:quiet|short|recurse))$/);
    return !!parsed && parsed.operands.length === 1;
  }
  if (sub === 'worktree') return rest[0] === 'list';
  if (sub === 'stash') return rest[0] === 'list' || rest[0] === 'show';
  if (sub === 'notes') return rest[0] === 'list' || rest[0] === 'show';
  if (sub === 'submodule') return rest[0] === 'status' || rest[0] === 'summary';
  if (sub === 'remote') {
    let i = 0;
    while (rest[i] === '-v' || rest[i] === '--verbose') i++;
    return i === rest.length || rest[i] === 'show' || rest[i] === 'get-url';
  }
  return false;
};
let _gitDry = false;
function setGitDryRun(on) { _gitDry = !!on; }
function assertGitWriteAllowed(verb = 'write') {
  require('./runtime-writes').assertCurrentRuntimeWrite();
   
  if (_gitDry) throw Object.assign(new Error(require('./error-language').errorLanguage() === 'en'
    ? `--dry-run was given, but git ${verb} was about to run` : `--dry-run 인데 git ${verb} 를 실행하려 했습니다`),
    { code: 'E_DRY_RUN_WRITE', file: `git ${verb}` });
}
function gitSpawn(args, opts) {
   
   
  const candidate = Array.isArray(args) ? args.map(String) : [];
  let cursor = 0;
  while (cursor < candidate.length && candidate[cursor].startsWith('-')) {
    cursor += ['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(candidate[cursor]) ? 2 : 1;
  }
  const verb = candidate[cursor] || '';
  const mutating = _GIT_MUTATING.has(verb) && !_GIT_READ_ONLY_FORM(verb, candidate.slice(cursor + 1));
  if (mutating) assertGitWriteAllowed(verb);
  const _argv = ['--no-optional-locks', ...args];    
   
   
  const _env = Object.assign({}, (opts && opts.env) || process.env);
  for (const k of Object.keys(_env)) if (_shouldDrop(k)) delete _env[k];
   
   
   
   
  return spawnPortableSync('git', _argv, Object.assign({}, opts, { env: _env, shell: false }));
}

module.exports = { gitSpawn, GIT_LOCATION_ENV, _shouldDrop, setGitDryRun, assertGitWriteAllowed };
