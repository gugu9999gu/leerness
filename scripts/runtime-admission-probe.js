#!/usr/bin/env node
'use strict';

// Writer-only joining of the existing legacy migration lock. Actual competing
// processes/copy barriers live in workspace-dir-lock-order-probe. These local
// fixtures isolate deadlines, denial latching, and shared operation identity.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../lib/runtime-layout');
const RW = require('../lib/runtime-writes');
const SG = require('../lib/state-git');
const W = require('../lib/workspace-dir');
const temp = fs.realpathSync.native(os.tmpdir());
const arena = fs.mkdtempSync(path.join(temp, 'leerness-runtime-admission-'));
const environment = { ...process.env };
const sources = [__filename, ...['runtime-layout', 'runtime-writes', 'workspace-dir'].map(name => path.resolve(__dirname, `../lib/${name}.js`))];
const signature = file => [crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), fs.statSync(file, { bigint: true }).mtimeNs.toString()];
const sourceBefore = sources.map(signature);
let total = 0;
let failed = 0;
let sequence = 0;
const lockPath = root => path.join(root, '.leerness-workspace-migration.lock');
const layoutPath = root => path.join(root, '.leerness', 'cache', 'state-layout.json');
function check(name, fn) {
  total++;
  try { fn(); process.stdout.write(`ok - ${name}\n`); }
  catch (error) { failed++; process.stderr.write(`not ok - ${name}: ${error.stack || error}\n`); }
}
function directory(label) {
  const root = path.join(arena, `${++sequence}-${label}`);
  fs.mkdirSync(root);
  return root;
}
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function marker(root, name = '.leerness') { write(path.join(root, name, 'HARNESS_VERSION'), 'fixture\n'); }
function patch(object, name, wrapper, fn) {
  const original = object[name];
  object[name] = wrapper(original);
  try { return fn(); } finally { object[name] = original; }
}
function snapshot(root) {
  const rows = [];
  function visit(file, relative) {
    const stat = fs.lstatSync(file, { bigint: true });
    const row = [relative, String(stat.mode), String(stat.size), String(stat.mtimeNs)];
    if (stat.isSymbolicLink()) rows.push([...row, fs.readlinkSync(file)]);
    else if (stat.isDirectory()) {
      rows.push(row);
      for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name), `${relative}/${name}`);
    } else rows.push([...row, signature(file)[0]]);
  }
  visit(root, '.');
  return rows;
}
function unchanged(root, fn) {
  const before = snapshot(root);
  try { return fn(); } finally { assert.deepStrictEqual(snapshot(root), before); }
}
function denied(admission, reason) {
  for (let repeat = 0; repeat < 2; repeat++) {
    const report = admission.reader();
    assert.strictEqual(report.reasonCode, reason);
    assert.strictEqual(report.writeDisposition, 'blocked');
  }
}
function unsupported(root) {
  write(layoutPath(root), JSON.stringify({ schema: 'leerness.runtime-layout/v1', schemaVersion: 1,
    scope: 'project-local', generation: 1, layout: 'future', requiredWriterProtocol: 2 }));
}
try {
  for (const name of Object.keys(process.env)) {
    if (/^(GIT_|LEERNESS_WORKSPACE_DIR$|LEERNESS_WORKSPACE_MIGRATION_LOCK_WAIT_MS$)/i.test(name)) delete process.env[name];
  }
  check('healthy admission performs one Git discovery and workspace classification', () => {
    const root = directory('healthy');
    let git = 0;
    let workspaces = 0;
    patch(SG, 'resolveGitTopology', original => (...args) => { git++; return original(...args); }, () =>
      patch(W, 'inspectWorkspace', original => (...args) => { workspaces++; return original(...args); }, () => unchanged(root, () => {
        const admission = R.createRuntimeWriterAdmission(root);
        assert.strictEqual(admission.waitedForLock, false);
        assert.strictEqual(admission.lockWaitedMs, 0);
        for (let index = 0; index < 10; index++) assert.strictEqual(admission.reader().writeDisposition, 'allowed');
      })));
    assert.strictEqual(git, 1);
    assert.strictEqual(workspaces, 1);
  });
  check('public diagnosis is immediate during dual-live migration', () => {
    const root = directory('diagnose');
    marker(root); marker(root, W.LEGACY_WORKSPACE_DIR);
    write(lockPath(root), 'owned by fixture peer\n');
    patch(Atomics, 'wait', () => () => { throw new Error('public diagnosis waited'); }, () => unchanged(root, () => {
      assert.strictEqual(R.inspectRuntimeCompatibility(root).reasonCode, 'workspace_dir_conflict');
    }));
  });
  check('stale regular lock has a bounded zero-budget denial without cleanup', () => {
    const root = directory('stale');
    write(lockPath(root), 'not ours\n');
    patch(Atomics, 'wait', () => () => { throw new Error('zero budget waited'); }, () => unchanged(root, () => {
      const admission = R.createRuntimeWriterAdmission(root, 0);
      denied(admission, 'workspace_dir_migration_locked');
      assert.strictEqual(admission.waitedForLock, true);
    }));
  });
  check('regular lock wait expires under a monotonic deadline without mutation', () => {
    const root = directory('deadline');
    write(lockPath(root), 'not ours\n');
    unchanged(root, () => {
      const admission = R.createRuntimeWriterAdmission(root, 30);
      denied(admission, 'workspace_dir_migration_locked');
      assert(admission.lockWaitedMs >= 30);
    });
  });
  for (const kind of ['directory', 'junction', 'hardlink']) check(`foreign ${kind} lock is never followed or removed`, () => {
    const root = directory(kind);
    const outside = directory(`${kind}-outside`);
    if (kind === 'directory') fs.mkdirSync(lockPath(root));
    if (kind === 'junction') fs.symlinkSync(outside, lockPath(root), process.platform === 'win32' ? 'junction' : 'dir');
    if (kind === 'hardlink') { write(path.join(outside, 'owner'), 'outside\n'); fs.linkSync(path.join(outside, 'owner'), lockPath(root)); }
    patch(Atomics, 'wait', () => () => { throw new Error('foreign lock waited'); }, () => unchanged(arena, () => {
      denied(R.createRuntimeWriterAdmission(root), 'workspace_dir_migration_locked');
    }));
  });
  for (const concurrentLock of [false, true]) check(`observed unsupported descriptor stays denied after removal (peer lock=${concurrentLock})`, () => {
    const root = directory('removed-descriptor');
    unsupported(root);
    let removed = false;
    // Simulate the external peer immediately after the actual bounded FD read.
    patch(fs, 'closeSync', original => function (...args) {
      const result = original.apply(this, args);
      if (!removed) {
        removed = true;
        fs.unlinkSync(layoutPath(root));
        if (concurrentLock) write(lockPath(root), 'new peer\n');
      }
      return result;
    }, () => denied(R.createRuntimeWriterAdmission(root, 0), 'layout_unsupported'));
    assert(removed);
    assert(!fs.existsSync(layoutPath(root)));
  });
  check('construction-time Git timeout stays denied before any retry', () => {
    const root = directory('git-timeout');
    const owner = path.join(root, 'owner');
    write(owner, 'owner\n');
    const present = fs.lstatSync(owner, { bigint: true });
    let gitCalls = 0;
    let lockReads = 0;
    patch(SG, 'resolveGitTopology', original => (...args) => {
      if (++gitCalls === 1) throw new SG.StatePathError('git_timeout', 'fixture timeout');
      return original(...args);
    }, () => patch(fs, 'lstatSync', original => function (file, ...args) {
      if (String(file) === lockPath(root) && ++lockReads === 2) return present;
      return original.call(this, file, ...args);
    }, () => unchanged(root, () => denied(R.createRuntimeWriterAdmission(root, 0), 'git_timeout'))));
    assert.strictEqual(gitCalls, 1);
    assert.strictEqual(lockReads, 1);
  });
  check('post-snapshot contention observes the same zero-budget deadline', () => {
    const root = directory('post-snapshot');
    const owner = path.join(root, 'owner');
    write(owner, 'owner\n');
    const present = fs.lstatSync(owner, { bigint: true });
    let lockReads = 0;
    patch(fs, 'lstatSync', original => function (file, ...args) {
      if (String(file) === lockPath(root)) {
        if (++lockReads > 8) throw new Error('post-snapshot admission did not terminate');
        if (lockReads % 2 === 0) return present;
      }
      return original.call(this, file, ...args);
    }, () => unchanged(root, () => {
      const admission = R.createRuntimeWriterAdmission(root, 0);
      denied(admission, 'workspace_dir_migration_locked');
      assert.strictEqual(admission.waitedForLock, true);
    }));
    assert.strictEqual(lockReads, 2);
  });
  check('one fresh classification accepts a peer that completed between observations', () => {
    const root = directory('completed-peer');
    marker(root); marker(root, W.LEGACY_WORKSPACE_DIR);
    let inspections = 0;
    patch(W, 'inspectWorkspace', original => (...args) => {
      const observed = original(...args);
      if (++inspections === 1) fs.renameSync(path.join(root, W.LEGACY_WORKSPACE_DIR), path.join(root, W.LEGACY_BACKUP_WORKSPACE_DIR));
      return observed;
    }, () => assert.strictEqual(R.createRuntimeWriterAdmission(root).reader().writeDisposition, 'allowed'));
    assert.strictEqual(inspections, 2);
    assert.strictEqual(fs.readFileSync(path.join(root, '.leerness-backup', 'HARNESS_VERSION'), 'utf8'), 'fixture\n');
  });
  check('a genuine dual-live conflict is not retried without bound or granted', () => {
    const root = directory('persistent-conflict');
    marker(root); marker(root, W.LEGACY_WORKSPACE_DIR);
    let inspections = 0;
    patch(W, 'inspectWorkspace', original => (...args) => { inspections++; return original(...args); }, () => unchanged(root, () => {
      denied(R.createRuntimeWriterAdmission(root), 'workspace_dir_conflict');
    }));
    assert.strictEqual(inspections, 2);
  });
  check('nested different root retains its explicit zero budget and failure latch', () => {
    const root = directory('outer');
    const inner = directory('inner');
    write(lockPath(inner), 'peer\n');
    let called = false;
    patch(Atomics, 'wait', () => () => { throw new Error('explicit zero budget was dropped'); }, () => unchanged(arena, () => {
      assert.throws(() => RW.withRuntimeWrites(root, () => {
        try { RW.withRuntimeWrites(inner, () => { called = true; }, { migrationLockWaitMs: 0 }); } catch {}
      }), error => error.reasonCode === 'workspace_dir_migration_locked');
    }));
    assert.strictEqual(called, false);
  });
  for (const action of ['nested writer', 'wait metadata']) check(`canonical identity failure is latched for ${action}`, () => {
    const root = directory('identity-failure');
    const notDirectory = path.join(root, 'file');
    write(notDirectory, 'not a directory\n');
    unchanged(root, () => {
      assert.throws(() => RW.withRuntimeWrites(root, () => {
        try {
          if (action === 'nested writer') RW.withRuntimeWrites(notDirectory, () => assert.fail('entered invalid root'));
          else RW.runtimeMigrationWait(notDirectory);
        } catch (error) { assert.strictEqual(error.reasonCode, 'path_not_directory'); }
      }), error => error.reasonCode === 'path_not_directory');
    });
  });
  check('a retargeted project alias receives fresh admission and latches denial', () => {
    const first = directory('alias-first');
    const second = directory('alias-second');
    marker(first); marker(second); unsupported(second);
    const alias = path.join(arena, `${++sequence}-retargeted`);
    const kind = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(first, alias, kind);
    const before = snapshot(second);
    assert.throws(() => RW.withRuntimeWrites(alias, () => {
      // Explicit fixture-owner action, outside the metadata subtree.
      fs.rmSync(alias, { recursive: true });
      fs.symlinkSync(second, alias, kind);
      try { write(path.join(alias, '.leerness', 'lessons.md'), 'must not reach a newly selected root\n'); } catch {}
    }), error => error.reasonCode === 'layout_unsupported');
    assert.deepStrictEqual(snapshot(second), before);
  });
  for (const aliasKind of ['same', 'junction', ...(process.platform === 'win32' ? ['namespaced'] : [])]) {
    check(`already admitted ${aliasKind} root does not join its own migration lock`, () => {
      const root = directory(`owned-${aliasKind}`);
      marker(root);
      let alias = root;
      if (aliasKind === 'junction') {
        alias = path.join(arena, `${++sequence}-alias`);
        fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
      } else if (aliasKind === 'namespaced') alias = path.toNamespacedPath(root);
      process.env.LEERNESS_WORKSPACE_MIGRATION_LOCK_WAIT_MS = '0';
      try {
        RW.withRuntimeWrites(alias, () => {
          write(lockPath(root), 'this admitted operation owns the lock\n');
          RW.withRuntimeWrites(root, () => {
            write(path.join(root, '.leerness', 'lessons.md'), 'same admitted identity\n');
          }, { migrationLockWaitMs: 0 });
          assert.strictEqual(RW.runtimeWriteRoots().length, 1);
          assert.deepStrictEqual(RW.runtimeMigrationWait(root), RW.runtimeMigrationWait(alias));
          fs.rmSync(path.join(root, '.leerness'), { recursive: true });
        });
        assert(!fs.existsSync(path.join(root, '.leerness')));
      } finally { delete process.env.LEERNESS_WORKSPACE_MIGRATION_LOCK_WAIT_MS; }
    });
  }
} catch (error) {
  check('probe setup completed', () => { throw error; });
} finally {
  for (const name of Object.keys(process.env)) if (!(name in environment)) delete process.env[name];
  Object.assign(process.env, environment);
  check('product and probe source bytes and mtimes are unchanged', () => assert.deepStrictEqual(sources.map(signature), sourceBefore));
  const resolved = path.resolve(arena);
  if (path.dirname(resolved) !== temp || !path.basename(resolved).startsWith('leerness-runtime-admission-')) {
    throw new Error('Refusing cleanup outside the validated admission probe arena.');
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
process.stdout.write(`RUNTIME_ADMISSION_PROBE ${total - failed}/${total} passed\n`);
process.exitCode = failed ? 1 : 0;
