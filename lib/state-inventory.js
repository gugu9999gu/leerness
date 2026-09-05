'use strict';

const fs = require('fs');
const path = require('path');

// This is an inventory of known legacy surfaces, NOT a migration manifest.
// Mixed files contain human intent as well as execution state; preserve both.
const SURFACES = Object.freeze([
  ['cache/sessions', 'runtime', 'Worktree'],
  ['cache/handoffs', 'runtime', 'Worktree'],
  ['cache/agent-sessions', 'runtime-private-conversation', 'Worktree'],
  ['cache/agent-runs', 'runtime', 'Worktree'],
  ['cache/file-leases.json', 'physical-file-coordination', 'Worktree'],
  ['state.json', 'runtime', 'Worktree'],
  ['runs', 'mixed-run-evidence', 'Worktree + Immutable-Record'],
  ['handoff', 'runtime', 'Worktree'],
  ['execution-ledger.jsonl', 'mixed-run-evidence', 'Worktree + Immutable-Record'],
  ['decisions.json', 'persistent-memory', 'Immutable-Record'],
  ['decisions.md', 'mixed-memory-projection', 'Immutable-Record + Generated-View'],
  ['lessons.json', 'persistent-memory', 'Immutable-Record'],
  ['lessons.md', 'mixed-memory-projection', 'Immutable-Record + Generated-View'],
  ['progress-tracker.md', 'mixed-task-authority', 'Project + Generated-View'],
  ['current-state.md', 'mixed-project-context', 'Project + Generated-View'],
  ['session-handoff.md', 'mixed-project-context', 'Project + Worktree + Generated-View'],
  ['active-wakeups.json', 'mixed-intent-runtime', 'Project + Worktree'],
  ['auto-resume-plan.json', 'mixed-intent-runtime', 'Project + Worktree'],
  ['next-action-queue.json', 'mixed-intent-runtime', 'Project + Worktree'],
  ['pre-wake-report.json', 'runtime', 'Worktree'],
  ['last-handoff.json', 'runtime', 'Worktree'],
  ['routing-log.json', 'runtime', 'Worktree'],
]);

function metadata(file) {
  try {
    const stat = fs.lstatSync(file);
    const kind = stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory'
      : stat.isFile() ? 'file' : 'special';
    return { status: kind, sizeBytes: kind === 'file' ? stat.size : null, mtimeMs: stat.mtimeMs };
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'absent' : 'unreadable', errorCode: error.code || 'unknown' };
  }
}

function inspectLegacyInventory(workspace) {
  const cache = new Map();
  const inspect = file => {
    if (!cache.has(file)) cache.set(file, metadata(file));
    return cache.get(file);
  };
  return SURFACES.map(([relativePath, classification, proposedScope]) => {
    const parts = relativePath.split('/');
    let parent = workspace;
    let blocked = null;
    for (const part of parts) {
      const state = inspect(parent);
      if (state.status !== 'directory') {
        blocked = { status: state.status === 'absent' ? 'absent' : 'blocked',
          parentStatus: state.status, blockedAt: parent };
        break;
      }
      parent = path.join(parent, part);
    }
    const currentPath = path.join(workspace, ...parts);
    return { relativePath, currentPath, classification, proposedScope,
      migrationAvailable: false, metadata: blocked || inspect(currentPath) };
  });
}

module.exports = { inspectLegacyInventory };
