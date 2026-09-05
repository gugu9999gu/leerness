'use strict';

const path = require('path');
const crypto = require('crypto');
const { StatePathError, canonicalDirectory, resolveGitTopology } = require('./state-git');
const { inspectWorkspace, selectWorkspaceDirName, CANONICAL_WORKSPACE_DIR } = require('./workspace-dir');

function scopeMap(projectPath, currentPath, git, projectKey) {
  const privatePath = git
    ? path.join(git.gitDir, 'leerness', 'projects', projectKey, 'runtime')
    : path.join(projectPath, 'cache', 'state-runtime');
  const commonPath = git ? path.join(git.gitCommonDir, 'leerness', 'control', 'projects', projectKey) : null;
  return {
    project: { scope: 'Project', currentPath, proposedPath: projectPath },
    worktree: { scope: 'Worktree', proposedPath: privatePath, backend: git ? 'git-private' : 'project-local-fallback' },
    commonControl: { scope: 'Common-Control', proposedPath: commonPath, available: !!git },
    immutableRecord: { scope: 'Immutable-Record', proposedPaths: {
      decisions: path.join(projectPath, 'memory', 'decisions'),
      lessons: path.join(projectPath, 'memory', 'lessons'),
      runs: path.join(projectPath, 'records', 'runs'),
    } },
    generatedView: { scope: 'Generated-View', proposedPaths: {
      project: path.join(projectPath, 'generated'), worktree: path.join(privatePath, 'views'),
    } },
  };
}

function resolveStatePaths(root = process.cwd(), options = {}) {
  const projectRoot = canonicalDirectory(root);
  const git = resolveGitTopology(projectRoot, options);
  const snapshot = inspectWorkspace(projectRoot);
  if (snapshot.legacy.inspectionError || snapshot.canonical.inspectionError) {
    throw new StatePathError('workspace_unreadable', 'Workspace metadata is unreadable; it was not treated as an empty store.');
  }
  const envValue = options.envValue === undefined
    ? (options.env || process.env).LEERNESS_WORKSPACE_DIR : options.envValue;
  const selectedName = selectWorkspaceDirName(snapshot, envValue);
  const selected = selectedName === CANONICAL_WORKSPACE_DIR ? snapshot.canonical : snapshot.legacy;
  const relative = git ? path.relative(git.worktreeRoot, projectRoot).split(path.sep).join('/') || '.' : '.';
  const projectKey = `project-${crypto.createHash('sha256').update(relative).digest('hex')}`;
  const status = !selected.exists ? 'absent' : selected.foreign ? 'foreign'
    : selected.live ? 'live' : selected.substrateOnly ? 'substrate' : 'unrecognized';
  const warnings = [];
  if (!git) warnings.push('non_git_no_common_control');
  if (status === 'foreign' || status === 'unrecognized') warnings.push('workspace_not_recognized');
  if (selectedName !== CANONICAL_WORKSPACE_DIR) warnings.push('legacy_workspace_not_migrated');
  if (snapshot.canonical.foreign && selectedName !== CANONICAL_WORKSPACE_DIR) warnings.push('canonical_workspace_foreign');
  return {
    schemaVersion: 1, schema: 'leerness.state-paths/v1',
    activeLayout: 'legacy', runtimeActivated: false, migrationAvailable: false,
    projectRoot, projectKey, projectRelativePath: relative, git,
    workspace: { selectedName, selectedPath: selected.abs, status,
      canonicalPath: snapshot.canonical.abs, legacyPresent: snapshot.legacy.exists,
      detectedPaths: [snapshot.canonical, snapshot.legacy].filter(value => value.exists).map(value => value.abs) },
    scopes: scopeMap(snapshot.canonical.abs, selected.abs, git, projectKey), warnings,
  };
}

module.exports = { resolveStatePaths };
