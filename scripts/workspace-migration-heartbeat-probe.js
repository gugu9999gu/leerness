'use strict';
require('./temp-cleanup').trackTemp(module);  
 
 
 
 
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const ENV = { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_LOCK_WARN: '1', LEERNESS_NO_AUTOCHCP: '1' };
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-migration-heartbeat-'));
let passed = 0, failed = 0, seq = 0;
 
async function test(name, fn) {
  if (process.env.HEARTBEAT_PROBE_ONLY && !name.includes(process.env.HEARTBEAT_PROBE_ONLY)) return;
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error && error.stack || error)); }
}
const nap = ms => new Promise(resolve => setTimeout(resolve, ms));
const lockOf = d => path.join(d, '.leerness-workspace-migration.lock');
 
function start(args, env = {}, preload = null) {
  const t0 = Date.now();
  const child = cp.spawn(process.execPath, [...(preload ? ['--require', preload] : []), CLI, ...args],
    { env: { ...ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '', err = '';
  child.stdout.on('data', b => { out += b; });
  child.stderr.on('data', b => { err += b; });
  return new Promise(resolve => child.on('close', status => {
    let json = null; try { json = JSON.parse(out); } catch {}
    resolve({ status, ms: Date.now() - t0, json, out, err });
  }));
}
const LEGACY_DIR = '.harness'; // workspace-dir-legacy-fixture
 
function legacy(files, referencing = false) {
  const d = path.join(arena, 'legacy-' + (++seq));
  fs.mkdirSync(path.join(d, LEGACY_DIR, 'bulk'), { recursive: true });
  fs.writeFileSync(path.join(d, LEGACY_DIR, 'HARNESS_VERSION'), '1.36.161\n');
  fs.writeFileSync(path.join(d, LEGACY_DIR, 'progress-tracker.md'), '# heartbeat probe\n');
  for (let i = 0; i < files; i++) {
    fs.writeFileSync(path.join(d, LEGACY_DIR, 'bulk', `f-${String(i).padStart(4, '0')}.md`), referencing ? `${i}: see ${LEGACY_DIR}/bulk\n` : `${i}\n`);
  }
  return d;
}
function canonical() {
  const d = path.join(arena, 'canonical-' + (++seq));
  fs.mkdirSync(d);
  const r = cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--minimal'], { env: ENV, encoding: 'utf8', timeout: 120000, windowsHide: true });
  assert.strictEqual(r.status, 0, 'init: ' + r.stdout + r.stderr);
  return d;
}
 
async function heldLock(d, refreshMs, removeAfter) {
  const lock = lockOf(d);
  fs.writeFileSync(lock, 'held by the probe\n');
  const until = Date.now() + refreshMs;
  const timer = setInterval(() => { if (Date.now() < until) { const t = new Date(); try { fs.utimesSync(lock, t, t); } catch {} } }, 300);
  if (removeAfter !== undefined) setTimeout(() => { clearInterval(timer); try { fs.unlinkSync(lock); } catch {} }, removeAfter);
  return () => { clearInterval(timer); try { fs.unlinkSync(lock); } catch {} };
}
 
const SLOW = path.join(arena, 'slow-copy.js');
fs.writeFileSync(SLOW, "const fs = require('fs'); const copy = fs.copyFileSync;\n"
  + "fs.copyFileSync = function (...a) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40); return copy.apply(this, a); };\n");
 
 
const SLOW_REWRITE = path.join(arena, 'slow-rewrite.js');
fs.writeFileSync(SLOW_REWRITE, "const fs = require('fs'); const path = require('path'); const write = fs.writeFileSync;\n"
  + "const inBulk = path.sep + '.leerness' + path.sep + 'bulk' + path.sep;\n"
  + "fs.writeFileSync = function (file, ...a) { if (typeof file === 'string' && file.includes(inBulk)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40); return write.call(this, file, ...a); };\n");
 
 
const SLOW_CHECK = path.join(arena, 'slow-check.js');
fs.writeFileSync(SLOW_CHECK, "const fs = require('fs'); const path = require('path'); const exists = fs.existsSync;\n"
  + "const inBulk = path.sep + '.leerness' + path.sep + 'bulk' + path.sep;\n"
  + "fs.existsSync = function (file) { if (typeof file === 'string' && file.includes(inBulk)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40); return exists.call(this, file); };\n");

 
 
 
function slowAll(project) {
  const file = path.join(arena, `slow-all-${++seq}.js`);
  const names = ['existsSync', 'readFileSync', 'writeFileSync', 'copyFileSync', 'readdirSync', 'mkdirSync', 'renameSync', 'rmSync', 'unlinkSync', 'openSync', 'appendFileSync'];
  fs.writeFileSync(file, `const fs = require('fs'); const P = ${JSON.stringify(project)};\n`
    + `for (const name of ${JSON.stringify(names)}) { const orig = fs[name]; fs[name] = function (f, ...a) {\n`
    + `  if (typeof f === 'string' && f.startsWith(P) && !f.endsWith('.lock')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);\n`
    + '  return orig.call(this, f, ...a); }; }\n');
  return file;
}

(async () => {
  try {
    await test('every loop of the migration refreshes the lock, unless it waits for another owner or is a fixed list (source)', async () => {
       
       
       
      const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'workspace-dir.js'), 'utf8').split(/\r?\n/);
       
       
      const bodies = new Map();
      src.forEach((l, i) => {
        const m = /^function (\w+)\(/.exec(l);
        if (!m) return;
        let end = src.findIndex((x, j) => j > i && /^(function |const |let |class |module\.exports)/.test(x));
        bodies.set(m[1], [i, end < 0 ? src.length : end]);
      });
      const reach = new Set(), queue = ['migrateLegacyWorkspace'];
      while (queue.length) {
        const fn = queue.shift();
        if (reach.has(fn)) continue;
        assert.ok(bodies.has(fn), 'function not found: ' + fn);
        reach.add(fn);
        const [s, e] = bodies.get(fn), text = src.slice(s + 1, e).join('\n');
        for (const other of bodies.keys()) if (new RegExp(`(^|[^\\w$.])${other}\\(`).test(text)) queue.push(other);
      }
      for (const fn of ['_migrateLegacyWorkspace', '_inspectDir', '_walkFiles', '_copiedFiles', '_hashFile', '_destinationSnapshot']) {
        assert.ok(reach.has(fn), 'call graph lost ' + fn);
      }
       
      const LOOP = /\bfor\s*\(|\bwhile\s*\(|\.(?:map|some|filter|forEach|every|reduce|find|findIndex|flatMap|sort)\(/;
       
       
       
       
      const ALLOWED = [
        ['migrateLegacyWorkspace', /while \(lockFd === null\)/],
        ['_migrateLegacyWorkspace', /while \(fs\.existsSync\(lockFile\)\)/],
        ['_migrateLegacyWorkspace', /while \(lockFd === null\)/],
        ['_removeOwnedLockFile', /while \(true\)/],
        ['_migrateLegacyWorkspace', /of integrationFiles\)/],
        ['_migrateLegacyWorkspace', /PROTECTED_GITIGNORE_LINES\.some\(/],
        ['_mergeProtectedGitignore', /raw\.toString\('latin1'\)\.split\(/],
        ['_mergeProtectedGitignore', /PROTECTED_GITIGNORE_LINES\.filter\(/],
        ['_assertNoLinkedPath', /for \(const part of rel\.split\(path\.sep\)\)/],
        ['_walkFiles', /^\s*for \(const entry of entries\) visit\(/],
      ];
      const SORT_REFRESHES = /\.sort\(\(\w+, \w+\) => \{ _beat\(\);/;
      const missing = [];
      let loops = 0;
      for (const fn of reach) {
        const [start, end] = bodies.get(fn);
        for (let i = start; i < end; i++) {
          if (!LOOP.test(src[i]) || /^\s*\/\//.test(src[i])) continue;
          loops++;
          if (/\.sort\(/.test(src[i]) && !SORT_REFRESHES.test(src[i])) { missing.push(`${fn}:${i + 1} sort without a refreshing comparator`); continue; }
          if (/_beat\(\)/.test(src[i]) || /^\s*_beat\(\);/.test(src[i + 1] || '')) continue;
          if (ALLOWED.some(([f, re]) => f === fn && re.test(src[i]))) continue;
          missing.push(`${fn}:${i + 1} ${src[i].trim().slice(0, 80)}`);
        }
      }
      assert.ok(loops >= 25, 'too few loops found (' + loops + '): the function boundaries moved');
      assert.deepStrictEqual(missing, []);
    });
    await test('the list of files to copy stays linear in the file count (60,000 files, 30,000 already there)', async () => {
       
       
      const { _copiedFiles } = require('../lib/workspace-dir');
      const mapped = Array.from({ length: 60000 }, (_, i) => ({ mappedRel: path.join('cache', 'agent-runs', `r-${i}.json`) }));
      const skipped = mapped.filter((_, i) => i % 2 === 0).map(m => m.mappedRel.replace(/\\/g, '/'));
      const t0 = Date.now();
      const out = _copiedFiles(mapped, skipped);
      const ms = Date.now() - t0;
      assert.strictEqual(out.length, 30000);
      assert.strictEqual(out[0], 'cache/agent-runs/r-1.json');
      assert.strictEqual(out[29999], 'cache/agent-runs/r-59999.json');
      assert.ok(ms < 2000, 'took ' + ms + ' ms');
    });
    await test('no phase of a migration leaves its lock unchanged for long (every fs call slowed)', async () => {
      const d = legacy(60, true);
      fs.writeFileSync(path.join(d, 'AGENTS.md'), `See ${LEGACY_DIR}/progress-tracker.md\n`);
      const owner = start(['migrate-workspace-dir', d, '--json'], {}, slowAll(d));
      let done = false; owner.then(() => { done = true; });
      let last = 'absent', lastAt = Date.now(), maxGap = 0, changes = 0;
      while (!done) {
        let sig = 'absent';
        try { sig = String(fs.statSync(lockOf(d), { bigint: true }).mtimeNs); } catch {}
        const now = Date.now();
        if (sig !== last) {
          if (last !== 'absent') maxGap = Math.max(maxGap, now - lastAt);
          if (sig !== 'absent') changes++;
          last = sig; lastAt = now;
        }
        await nap(10);
      }
      const r = await owner;
      assert.strictEqual(r.status, 0, r.out + r.err);
      assert.strictEqual(r.json && r.json.migrated, true, r.out);
      assert.ok(changes >= 10, 'the lock was refreshed while the migration ran: ' + changes + ' changes in ' + r.ms + ' ms');
      assert.ok(maxGap < 1500, 'longest time with an unchanged lock: ' + maxGap + ' ms (refresh every 500 ms)');
    });
    await test('a migration that outlasts the wait does not fail the migration waiting for it', async () => {
      const d = legacy(120);
      const owner = start(['migrate-workspace-dir', d, '--json'], {}, SLOW);
      for (let i = 0; i < 400 && !fs.existsSync(lockOf(d)); i++) await nap(10);
      assert.ok(fs.existsSync(lockOf(d)), 'the owner took the lock');
      const waiter = await start(['migrate-workspace-dir', d, '--json'], { LEERNESS_WORKSPACE_MIGRATION_LOCK_WAIT_MS: '1500' });
      const first = await owner;
      assert.strictEqual(first.status, 0, first.out + first.err);
      assert.strictEqual(first.json && first.json.migrated, true, first.out);
      assert.strictEqual(waiter.status, 0, waiter.out + waiter.err);
      assert.ok(waiter.json && waiter.json.alreadyCanonical === true && waiter.json.waitedForLock === true, waiter.out);
      assert.ok(waiter.json.lockWaitedMs > 1500, 'the waiter waited longer than its wait: ' + waiter.json.lockWaitedMs);
    });
    await test('a migration whose reference rewrite outlasts the wait does not fail the migration waiting for it', async () => {
      const d = legacy(80, true);
      const owner = start(['migrate-workspace-dir', d, '--json'], {}, SLOW_REWRITE);
      for (let i = 0; i < 400 && !fs.existsSync(lockOf(d)); i++) await nap(10);
      assert.ok(fs.existsSync(lockOf(d)), 'the owner took the lock');
      const waiter = await start(['migrate-workspace-dir', d, '--json'], { LEERNESS_WORKSPACE_MIGRATION_LOCK_WAIT_MS: '1500' });
      const first = await owner;
      assert.strictEqual(first.status, 0, first.out + first.err);
      assert.strictEqual(first.json && first.json.migrated, true, first.out);
      assert.ok(first.json.rewrittenReferences.length >= 80, 'the owner rewrote the references: ' + first.json.rewrittenReferences.length);
      assert.strictEqual(waiter.status, 0, waiter.out + waiter.err);
      assert.ok(waiter.json && waiter.json.alreadyCanonical === true && waiter.json.waitedForLock === true, waiter.out);
      assert.ok(waiter.json.lockWaitedMs > 1500, 'the waiter waited longer than its wait: ' + waiter.json.lockWaitedMs);
    });
    await test('a migration whose destination check outlasts the wait does not fail the migration waiting for it', async () => {
      const d = legacy(80);
      const owner = start(['migrate-workspace-dir', d, '--json'], {}, SLOW_CHECK);
      for (let i = 0; i < 400 && !fs.existsSync(lockOf(d)); i++) await nap(10);
      assert.ok(fs.existsSync(lockOf(d)), 'the owner took the lock');
      const waiter = await start(['migrate-workspace-dir', d, '--json'], { LEERNESS_WORKSPACE_MIGRATION_LOCK_WAIT_MS: '1500' });
      const first = await owner;
      assert.strictEqual(first.status, 0, first.out + first.err);
      assert.strictEqual(first.json && first.json.migrated, true, first.out);
      assert.strictEqual(waiter.status, 0, waiter.out + waiter.err);
      assert.ok(waiter.json && waiter.json.alreadyCanonical === true && waiter.json.waitedForLock === true, waiter.out);
      assert.ok(waiter.json.lockWaitedMs > 1500, 'the waiter waited longer than its wait: ' + waiter.json.lockWaitedMs);
    });
    await test('a wait shorter than the refresh interval still outlasts a progressing migration (100 ms set)', async () => {
       
      const d = legacy(120);
      const owner = start(['migrate-workspace-dir', d, '--json'], {}, SLOW);
      for (let i = 0; i < 400 && !fs.existsSync(lockOf(d)); i++) await nap(10);
      assert.ok(fs.existsSync(lockOf(d)), 'the owner took the lock');
      const waiter = await start(['migrate-workspace-dir', d, '--json'], { LEERNESS_WORKSPACE_MIGRATION_LOCK_WAIT_MS: '100' });
      const first = await owner;
      assert.strictEqual(first.status, 0, first.out + first.err);
      assert.strictEqual(waiter.status, 0, waiter.out + waiter.err);
      assert.ok(waiter.json && waiter.json.alreadyCanonical === true && waiter.json.waitedForLock === true, waiter.out);
    });
    await test('a positive wait is at least 1.5 s; 0 does not wait (fake clock)', async () => {
      const { migrationLockWait, MIGRATION_LOCK_MIN_WAIT_MS } = require('../lib/workspace-dir');
      assert.strictEqual(MIGRATION_LOCK_MIN_WAIT_MS, 1500);
      const lock = path.join(arena, 'clock.lock');
      fs.writeFileSync(lock, 'x');
      let now = 1000;
      const w = migrationLockWait(lock, 100, 60000, () => now);
      assert.strictEqual(w.expired(), false);
      now += 1499; assert.strictEqual(w.expired(), false, 'expired before the minimum wait');
      assert.strictEqual(w.remainingMs(), 1);
      now += 1; assert.strictEqual(w.expired(), true, 'not expired after the minimum wait');
      const zero = migrationLockWait(lock, 0, 60000, () => now);
      assert.strictEqual(zero.expired(), true, 'a 0 wait must not wait');
      const long = migrationLockWait(lock, 5000, 60000, () => now);
      assert.strictEqual(long.expired(), false);
      now += 4999; assert.strictEqual(long.expired(), false);
      now += 1; assert.strictEqual(long.expired(), true);
    });
    await test('the owner keeps refreshing when its wall clock is set back 30 s mid-migration', async () => {
       
       
       
       
      const back = path.join(arena, 'clock-back.js');
      fs.writeFileSync(back, `require(${JSON.stringify(SLOW)});\n`
        + "const fs = require('fs'); const copy = fs.copyFileSync; let copies = 0, offset = 0;\n"
        + 'fs.copyFileSync = function (...a) { if (++copies === 10) offset = -30000; return copy.apply(this, a); };\n'
        + 'const real = Date.now; Date.now = () => real() + offset;\n');
      const d = legacy(120);
      const owner = start(['migrate-workspace-dir', d, '--json'], {}, back);
      for (let i = 0; i < 400 && !fs.existsSync(lockOf(d)); i++) await nap(10);
      assert.ok(fs.existsSync(lockOf(d)), 'the owner took the lock');
      const waiter = await start(['migrate-workspace-dir', d, '--json'], { LEERNESS_WORKSPACE_MIGRATION_LOCK_WAIT_MS: '1500' });
      const first = await owner;
      assert.strictEqual(first.status, 0, first.out + first.err);
      assert.strictEqual(waiter.status, 0, waiter.out + waiter.err);
      assert.ok(waiter.json && waiter.json.alreadyCanonical === true && waiter.json.waitedForLock === true, waiter.out);
    });
    await test('a wait is not cut short when the wall clock jumps forward', async () => {
      const { migrationLockWait } = require('../lib/workspace-dir');
      const lock = path.join(arena, 'jump.lock');
      fs.writeFileSync(lock, 'x');
       
       
      const real = Date.now;
      let offset = 0;
      try {
        Date.now = () => real() + offset;
        const w = migrationLockWait(lock, 5000);
        assert.strictEqual(w.expired(), false);
        offset = 60000;
        assert.strictEqual(w.expired(), false, 'a 60 s forward jump ended a 5 s wait at once');
        assert.ok(w.remainingMs() > 4000, 'remaining ' + w.remainingMs());
      } finally { Date.now = real; }
    });
    await test('a writer waits while the lock keeps changing and goes on when it is released', async () => {
      const d = canonical();
      await heldLock(d, 3500, 3500);
      const r = await start(['task', 'add', 'heartbeat probe task', '--no-review', '--path', d], { LEERNESS_WORKSPACE_MIGRATION_LOCK_WAIT_MS: '1000' });
      assert.strictEqual(r.status, 0, r.out + r.err);
      assert.ok(r.ms >= 3000, 'the writer waited for the release: ' + r.ms + ' ms');
      assert.ok(fs.readFileSync(path.join(d, '.leerness', 'progress-tracker.md'), 'utf8').includes('heartbeat probe task'));
    });
    await test('a lock that never changes still fails after the wait', async () => {
      const d = canonical();
      const release = await heldLock(d, 0);
      try {
        const r = await start(['task', 'add', 'stale lock task', '--no-review', '--path', d], { LEERNESS_WORKSPACE_MIGRATION_LOCK_WAIT_MS: '1000' });
        assert.notStrictEqual(r.status, 0, 'a stale lock must stop the writer');
        assert.ok(/workspace_dir_migration_locked|workspace-dir-migration-locked/.test(r.out + r.err), r.out + r.err);
        assert.ok(r.ms < 8000, 'it failed after the wait, not after the cap: ' + r.ms + ' ms');
      } finally { release(); }
    });
    await test('a lock that stops changing fails a wait after its last change', async () => {
      const d = canonical();
      const release = await heldLock(d, 4000);
      try {
        const r = await start(['task', 'add', 'stopped lock task', '--no-review', '--path', d], { LEERNESS_WORKSPACE_MIGRATION_LOCK_WAIT_MS: '1000' });
        assert.notStrictEqual(r.status, 0, 'the writer must stop once the lock stops changing');
        assert.ok(r.ms >= 4000 && r.ms < 12000, 'it waited while the lock changed and then about one wait: ' + r.ms + ' ms');
      } finally { release(); }
    });
  } finally {
    fs.rmSync(arena, { recursive: true, force: true });
  }
  console.log(`workspace migration heartbeat probe: ${passed}/${passed + failed} passed (${process.platform})`);
  process.exitCode = failed ? 1 : 0;
})();
