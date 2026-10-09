'use strict';

const path = require('node:path');
const { TextDecoder } = require('node:util');
const { gitSpawn } = require('./git');
const { resolveStatePaths } = require('./state-paths');
const { OID, fail, match, digest, record, stable } = require('./review-control-contract');

// Git's ref transaction is the publication point. Nothing touches the index,
// worktree, branch history or a second mutable JSON database.
function context(root, batchId) {
  const layout = resolveStatePaths(root);
  if (!layout.git) fail('git_required');
  if (['foreign', 'unrecognized'].includes(layout.workspace.status)) fail('workspace_unrecognized');
  const fold = text => process.platform === 'win32' ? text.toLowerCase() : text;
  return { root: layout.projectRoot, commonDir: layout.git.gitCommonDir, projectKey: layout.projectKey, batchId,
    topology: [layout.projectRoot, layout.git.gitDir, layout.git.gitCommonDir].map(fold),
    worktreeDigest: digest(fold(layout.git.gitDir)),
    ref: `refs/leerness/review-control/v1/${layout.projectKey}/${digest(batchId).slice(7)}` };
}
// T-0326: on Windows a path has at most 259 characters unless Git's core.longpaths is on. Without it, Git for Windows
// cannot open a ref file whose path reaches 260 characters, nor lock a ref whose lock file path does ("Filename too
// long"), and a ref it cannot read breaks the user's own Git in that repository: git log --all, fsck, gc, repack and
// prune fail (measured with Git for Windows 2.54.0). So the Git calls here add no long-path option. Before a ref
// command whose refs/leerness ref would need such a path (its lock file for update-ref, the ref file for a read), the
// user's own Git is asked to read a ref name of exactly that path length that Leerness never creates (it ends in
// "x"; record refs end in hex): `symbolic-ref -q` exits 1 when that name is absent and 128 when Git cannot read the
// path (and also for a damaged ref someone else put at that name). That follows whatever Git actually does
// (configuration levels, ref storage format, the path spelling it uses) and writes nothing; 128 refuses the call.
const REF_COMMANDS = new Set(['update-ref', 'symbolic-ref', 'for-each-ref']);
function assertRefPathsFit(ctx, args, input) {
  if (process.platform !== 'win32' || typeof ctx.commonDir !== 'string' || !REF_COMMANDS.has(args[0])) return;
  const write = args[0] === 'update-ref', end = args.indexOf('--');
  const tokens = [...(end < 0 ? args : args.slice(0, end)), ...(write && input != null ? String(input).split(/\s+/) : [])];
  const refs = tokens.filter(token => typeof token === 'string' && token.startsWith('refs/leerness/'));
  if (!refs.length) return;
  const ref = refs.reduce((longest, next) => (next.length > longest.length ? next : longest));
  const extra = write ? '.lock'.length : 0;
  if (path.join(ctx.commonDir, ref).length + extra < 260) return;
  const probe = spawn(ctx, ['symbolic-ref', '-q', write ? ref + 'x'.repeat(extra) : ref.slice(0, -1) + 'x'], undefined, 2048);
  if (probe.error || probe.signal) fail('git_failed');
  if (probe.status === 128) fail('git_long_paths_required');
}
function assertContext(ctx) {
  if (stable(context(ctx.root, ctx.batchId).topology) !== stable(ctx.topology)) fail('topology_changed');
}
function run(ctx, args, input, maxBuffer, encoding) {
  assertRefPathsFit(ctx, args, input);
  return spawn(ctx, args, input, maxBuffer, encoding);
}
function spawn(ctx, args, input, maxBuffer = 65536, encoding = 'utf8') {
  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Leerness Control', GIT_AUTHOR_EMAIL: 'control@leerness.invalid',
    GIT_COMMITTER_NAME: 'Leerness Control', GIT_COMMITTER_EMAIL: 'control@leerness.invalid',
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' };
  // No core.longpaths option here (T-0326): a ref written with it can be one the user's own Git cannot read.
  const command = ['--no-replace-objects', '-C', ctx.root, '-c', 'core.fsync=loose-object,reference',
    '-c', 'core.fsyncMethod=fsync', '-c', 'core.filesRefLockTimeout=1000', '-c', 'core.packedRefsTimeout=1000',
    ...args];
  return gitSpawn(command, { cwd: ctx.root, env, input, encoding, timeout: 5000, maxBuffer });
}
function output(ctx, args, input, maxBuffer, encoding) {
  const result = run(ctx, args, input, maxBuffer, encoding);
  if (result.error || result.signal || result.status !== 0 || (result.stderr && result.stderr.length)) fail('git_failed');
  return result.stdout;
}
function oid(ctx, args, input) {
  const value = output(ctx, args, input, 1024).trim();
  if (!match(value, OID)) fail('git_output_invalid');
  return value;
}
function readRef(ctx) {
  const symbolic = run(ctx, ['symbolic-ref', '-q', ctx.ref], undefined, 2048);
  if (symbolic.error || symbolic.signal || symbolic.stderr || ![0, 1].includes(symbolic.status)) fail('git_failed');
  if (symbolic.status === 0) fail('ref_invalid');
  const refs = output(ctx, ['for-each-ref', '--count=2', '--format=%(refname) %(objectname) %(symref)', ctx.ref], undefined, 2048);
  if (!refs) return null;
  const lines = refs.trimEnd().split('\n');
  const parts = lines[0].split(' ');
  if (lines.length !== 1 || parts.length !== 2 || parts[0] !== ctx.ref || !match(parts[1], OID)) fail('ref_invalid');
  return parts[1];
}
function readCommit(ctx, head) {
  const commit = output(ctx, ['cat-file', 'commit', head], undefined, 2048);
  const tree = /^tree ([0-9a-f]+)\n/.exec(commit);
  const parents = [...commit.matchAll(/^parent ([0-9a-f]+)$/gm)];
  if (!tree || !match(tree[1], OID) || parents.length > 1 || parents.some(item => !match(item[1], OID))) fail('record_invalid');
  const entries = output(ctx, ['ls-tree', tree[1]], undefined, 1024);
  const blob = /^100644 blob ([0-9a-f]+)\trecord.json\n$/.exec(entries);
  if (!blob || !match(blob[1], OID)) fail('record_invalid');
  const raw = output(ctx, ['cat-file', 'blob', blob[1]], undefined, 65536, null);
  let bytes;
  try { bytes = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw); }
  catch { fail('record_invalid'); }
  return { bytes, parents: parents.map(p => p[1]) };
}
function read(ctx) {
  const head = readRef(ctx);
  if (!head) return { head: null, value: null };
  const stored = readCommit(ctx, head), value = record(stored.bytes, ctx.projectKey, ctx.batchId);
  if ((value.revision === 1) !== (stored.parents.length === 0)) fail('record_invalid');
  return { head, value };
}
function prepareCommit(ctx, previous, bytes) {
  if (Buffer.byteLength(bytes) > 65536) fail('record_limit');
  const blob = oid(ctx, ['hash-object', '-w', '--stdin'], bytes);
  const tree = oid(ctx, ['mktree'], `100644 blob ${blob}\trecord.json\n`);
  const head = oid(ctx, ['commit-tree', tree, ...(previous ? ['-p', previous] : []), '--no-gpg-sign'], 'leerness review control v1\n');
  return head;
}
function publish(ctx, previous, next) {
  const head = prepareCommit(ctx, previous, `${stable(next)}\n`);
  assertContext(ctx);
  const result = run(ctx, ['update-ref', '--no-deref', ctx.ref, head, previous || '0'.repeat(head.length)]);
  // A timeout/hook error may occur after publication. Never claim rollback or
  // blindly repeat writes: the caller replays the same operation to reconcile.
  if (result.error || result.signal || result.status !== 0 || result.stderr) fail('publication_uncertain');
  try { if (read(ctx).head !== head) fail('publication_uncertain'); }
  catch { fail('publication_uncertain'); }
  return head;
}

module.exports = { context, assertContext, read, publish, run, output, readRef, readCommit, prepareCommit };
