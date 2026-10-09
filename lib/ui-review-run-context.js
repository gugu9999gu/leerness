'use strict';

const path = require('node:path');
const C = require('./review-control-contract');
const G = require('./review-control-git');

function rootPath(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')) C.fail('root_invalid');
}
function control(ctx, input, snapshotId) {
  const current = G.read(ctx), value = current.value;
  if (current.head !== input.expectedHead || !value) C.fail('control_changed');
  if (value.generation !== input.generation) C.fail('stale_generation');
  if (!value.owner || C.stable(value.owner) !== C.stable({ ...input.owner, worktreeDigest: ctx.worktreeDigest })) C.fail('owner_mismatch');
  if (!value.snapshot || value.snapshot.generation !== value.generation || value.snapshot.snapshotId !== snapshotId) C.fail('snapshot_mismatch');
  G.assertContext(ctx); return current;
}

module.exports = { rootPath, control };
