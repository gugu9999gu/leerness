'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

// T-0365: on Windows, Node 23.x, 24.0.0-24.21.x, 25.x and 26.0.0-26.8.x end the process (0xC0000409) when a fs.rmSync
//   that fails (a file or folder another process holds) has a path with a character outside the ANSI code page, and
//   garble error.path otherwise. lib/safe-remove.js removeSync isolates such a removal there (a file or link is
//   unlinked; a full folder is removed by fs.rmSync in a child process) and is fs.rmSync everywhere else. The cases that
//   end a process run in a child; on a Windows Node without the bug they still run but cannot tell the fix apart, and
//   say so.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

const PKG = path.resolve(__dirname, '..');
const CLI = path.join(PKG, 'bin', 'leerness.js');
const SAFE = path.join(PKG, 'lib', 'safe-remove.js');
const isWin = process.platform === 'win32';
// The probe's own copy of the bounds (rmcrash/bounds-out.txt), so it does not trust the module it tests.
const [major, minor] = process.versions.node.split('.').map(Number);
const bugHere = isWin && (major === 23 || major === 25 || (major === 24 && minor < 22) || (major === 26 && minor < 9));
const CRASH = 3221226505; // 0xC0000409
const EMOJI = String.fromCodePoint(0x1f600); // in no ANSI code page
const HAN = String.fromCharCode(0xd55c, 0xae00); // in code page 949: no crash, a garbled error
const arena = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'leerness-safe-remove-'));
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const children = [];
let passed = 0, failed = 0, seq = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}
const safe = () => require(SAFE);
const fresh = name => { const d = path.join(arena, `${++seq}-${name}`); fs.mkdirSync(d, { recursive: true }); return d; };
// A child whose working directory is the folder holds it on Windows until it exits.
function hold(dir, ms) {
  const child = cp.spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`], { cwd: dir, stdio: 'ignore', windowsHide: true });
  children.push(child);
  sleep(300);
  return child;
}
// A file another process opened without delete sharing cannot be unlinked on Windows until that process closes it.
//   Returns once the lock is in place (opening the file fails), not after a guessed delay.
function lockFile(file, ms) {
  const exe = cp.spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore', windowsHide: true }).error ? 'powershell' : 'pwsh';
  const ps = `$f=[System.IO.File]::Open('${file.replace(/'/g, "''")}','Open','Read','None'); Start-Sleep -Milliseconds ${ms}; $f.Close()`;
  const child = cp.spawn(exe, ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', windowsHide: true });
  children.push(child);
  for (const deadline = Date.now() + 15000; Date.now() < deadline; sleep(100)) {
    try { fs.closeSync(fs.openSync(file, 'r')); } catch (e) { if (e.code === 'EBUSY' || e.code === 'EPERM') return child; throw e; }
  }
  throw new Error('the file was not locked in time');
}
const runNode = (args, opts = {}) => cp.spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 120000, ...opts });
const note = () => { if (!bugHere) console.log(`  (Node ${process.version} on ${process.platform} has no rmSync bug: this case runs but cannot tell the fix apart)`); };
const outcome = fn => { try { fn(); return 'ok'; } catch (e) { return e.code; } };

try {
  test('rmSyncPathBug: the versions with the bug, Windows only', () => {
    const { rmSyncPathBug } = safe();
    const table = [['22.23.3', false], ['23.0.0', true], ['23.11.1', true], ['24.0.0', true], ['24.21.0', true], ['24.21.9', true],
      ['24.22.0', false], ['24.30.1', false], ['25.0.0', true], ['25.9.0', true], ['26.0.0', true], ['26.3.0', true], ['26.8.2', true],
      ['26.9.0', false], ['26.12.0', false], ['27.0.0', false], ['20.20.0', false], ['18.20.4', false]];
    for (const [v, want] of table) {
      assert.strictEqual(rmSyncPathBug(v, 'win32'), want, `win32 ${v}`);
      assert.strictEqual(rmSyncPathBug(v, 'linux'), false, `linux ${v}`);
      assert.strictEqual(rmSyncPathBug(v, 'darwin'), false, `darwin ${v}`);
    }
    assert.strictEqual(rmSyncPathBug(), bugHere, 'the defaults read this process');
  });

  test('needsIsolation: only a non-ASCII absolute path on a Node with the bug (Node converts only that path)', () => {
    const { needsIsolation } = safe();
    const e = String.fromCharCode(0xe9);
    assert.strictEqual(needsIsolation('C:\\Users\\ascii\\x', '26.3.0', 'win32'), false, 'an ASCII path is isolated');
    assert.strictEqual(needsIsolation('C:\\Users\\Jos' + e + '\\x', '26.3.0', 'win32'), true);
    const back = process.cwd();
    process.chdir(fresh('cwd-' + e));
    try { assert.strictEqual(needsIsolation('rel', '26.3.0', 'win32'), true, 'a relative path below a non-ASCII working directory'); }
    finally { process.chdir(back); }
    assert.strictEqual(needsIsolation('C:\\Users\\' + String.fromCharCode(0xd55c) + '\\x', '24.21.0', 'win32'), true, 'Hangul (its errors come back garbled)');
    assert.strictEqual(needsIsolation('C:\\Users\\Jos' + e + '\\x', '26.9.0', 'win32'), false, 'a fixed Node is isolated');
    assert.strictEqual(needsIsolation('/home/jos' + e + '/x', '26.3.0', 'linux'), false, 'Linux is isolated');
    assert.strictEqual(needsIsolation('rel', '26.3.0', 'win32'), /[^\x00-\x7f]/.test(process.cwd()), 'a relative path is judged with the working directory');
    assert.strictEqual(needsIsolation(Buffer.from('C:\\Jos' + e), '26.3.0', 'win32'), true, 'a Buffer path');
  });

  // 1.36.305 review round 1: the pass-through case forced the mode, so a wrong default passed.
  test('without the isolate option the choice is needsIsolation: an ASCII path is one fs.rmSync call; a non-ASCII one is isolated only with the bug', () => {
    const calls = [];
    const spy = { rmSync: () => calls.push('rmSync'), lstatSync: () => { calls.push('lstatSync'); return { isDirectory: () => false }; }, unlinkSync: () => calls.push('unlinkSync') };
    const base = isWin ? 'C:\\leerness-sr\\' : '/tmp/leerness-sr/';
    safe().removeSync(base + 'ascii.txt', { force: true }, { fsImpl: spy });
    assert.deepStrictEqual(calls, ['rmSync'], 'an ASCII path');
    calls.length = 0;
    safe().removeSync(base + 'Jos' + String.fromCharCode(0xe9) + '.txt', { force: true }, { fsImpl: spy });
    assert.deepStrictEqual(calls, bugHere ? ['lstatSync', 'unlinkSync'] : ['rmSync'], 'a non-ASCII path');
  });

  test('removeSync where the bug is absent is fs.rmSync with the same arguments and nothing else', () => {
    const calls = [];
    const spy = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]); return name === 'rmSync' ? 'result' : undefined; } });
    const opts = { recursive: true, force: true, maxRetries: 3 };
    assert.strictEqual(safe().removeSync('x', opts, { fsImpl: spy, isolate: false }), 'result');
    assert.deepStrictEqual(calls.map(c => c[0]), ['rmSync']);
    assert.strictEqual(calls[0][1], 'x'); assert.strictEqual(calls[0][2], opts, 'the options object was not passed as it is');
    calls.length = 0;
    safe().removeSync('y', undefined, { fsImpl: spy, isolate: false });
    assert.deepStrictEqual(calls, [['rmSync', 'y', undefined]]);
  });

  // 1.36.305 review rounds 1 and 3: a JavaScript walk of the folder differed from fs.rmSync (a drive-relative path,
  //   entries that vanish, retries that do not rescan). A full folder now goes to fs.rmSync itself. Round 4: the child
  //   gets the absolute path the parent resolved, since Windows keeps each drive's current directory in environment
  //   entries ('=D:') that a copied environment loses, so 'D:rel' could name another folder there.
  test('a full folder goes to the child as the absolute path this process resolved, with the four option values it uses', () => {
    const got = [];
    const fsImpl = { lstatSync: () => ({ isDirectory: () => true }), rmdirSync: () => { throw Object.assign(new Error('not empty'), { code: 'ENOTEMPTY' }); } };
    const opts = { recursive: true, force: true, maxRetries: 4, retryDelay: 50 };
    for (const target of [isWin ? process.cwd().slice(0, 2) : '.', isWin ? 'D:rel' : 'rel/x', 'rel' + path.sep + 'x', 'tail.lock' + path.sep]) {
      got.length = 0;
      safe().removeSync(target, opts, { fsImpl, isolate: true, runChild: (t, o) => { got.push([t, o]); return { status: 0, answer: { ok: true } }; } });
      assert.strictEqual(got.length, 1, target);
      assert.strictEqual(got[0][0], path.resolve(target), `the child did not get the absolute path for ${target}`);
      assert.ok(path.isAbsolute(got[0][0]), got[0][0]);
      assert.deepStrictEqual(got[0][1], { recursive: true, force: true, maxRetries: 4, retryDelay: 50 }, 'the options the child got');
    }
  });

  // 1.36.305 review round 4: fs.rmSync rejects bad options before it removes anything; the isolated removal unlinked a
  //   file or removed an empty folder first.
  test('bad options are rejected before anything is removed, with the error fs.rmSync gives', () => {
    const { removeSync } = safe();
    for (const [name, opts] of [['recursive not a boolean', { recursive: 'yes' }], ['maxRetries out of range', { recursive: true, maxRetries: -1 }], ['retryDelay not a number', { force: true, retryDelay: 'x' }]]) {
      const d = fresh('bad-options');
      const file = path.join(d, 'f.txt'), empty = path.join(d, 'empty');
      fs.writeFileSync(file, 'f'); fs.mkdirSync(empty);
      for (const target of [file, empty]) {
        const want = outcome(() => fs.rmSync(target, opts));
        assert.ok(want !== 'ok', `control: fs.rmSync accepted ${name}`);
        const got = outcome(() => removeSync(target, opts, { isolate: true }));
        assert.strictEqual(got, want, `${name}: ${target}`);
        assert.strictEqual(fs.existsSync(target), true, `${name}: removed ${target}`);
      }
    }
  });

  // 1.36.305 review round 4, second run: Node reads fs.rmSync's options as a copy of their own enumerable properties;
  //   the isolated removal read inherited and non-enumerable ones too, and sent the object to the child as JSON (a BigInt
  //   or a cycle threw, toJSON could change it). It now reads them as Node does and sends only the four it uses.
  test('options are read as Node reads them: own enumerable properties only, and only those it uses go to the child', () => {
    const { removeSync } = safe();
    const inherited = Object.create({ recursive: true });
    const hidden = Object.defineProperty({}, 'recursive', { value: true, enumerable: false });
    for (const [name, opts] of [['inherited recursive', inherited], ['non-enumerable recursive', hidden]]) {
      const d = fresh('options-read');
      const a = path.join(d, 'a'), b = path.join(d, 'b');
      fs.mkdirSync(a); fs.mkdirSync(b);
      const want = outcome(() => fs.rmSync(a, opts));
      assert.strictEqual(want, 'ERR_FS_EISDIR', `control: fs.rmSync with ${name}`);
      assert.strictEqual(outcome(() => removeSync(b, opts, { isolate: true })), want, name);
      assert.strictEqual(fs.existsSync(b), true, `${name}: removed`);
    }
    const cycle = { recursive: true, force: true }; cycle.self = cycle;
    for (const [name, opts] of [['a BigInt extra', { recursive: true, force: true, extra: 1n }], ['a cycle', cycle],
      ['toJSON', { recursive: true, force: true, toJSON: () => ({ recursive: false }) }]]) {
      const d = fresh('options-child-' + HAN);
      const make = n => { const t = path.join(d, n); fs.mkdirSync(path.join(t, 's'), { recursive: true }); fs.writeFileSync(path.join(t, 's', 'f'), 'f'); return t; };
      const a = make('a'), b = make('b');
      assert.strictEqual(outcome(() => fs.rmSync(a, opts)), 'ok', `control: fs.rmSync with ${name}`);
      assert.strictEqual(outcome(() => removeSync(b, opts, { isolate: true })), 'ok', name);
      assert.strictEqual(fs.existsSync(b), false, `${name}: not removed`);
    }
    assert.strictEqual(outcome(() => fs.rmSync(path.join(arena, 'nope'), null)), outcome(() => removeSync(path.join(arena, 'nope'), null, { isolate: true })), 'null options');
  });

  // 1.36.305 confirmation round: Node reads each option once (its copy); checking the options as given and then copying
  //   them read a getter twice, so a getter that changes between reads got another outcome than fs.rmSync's.
  test('each option is read once, as by fs.rmSync (getters included)', () => {
    const { removeSync } = safe();
    for (const [name, make, build] of [
      ['a getter that fails on its second read', reads => ({ recursive: true, get extra() { if (++reads.n === 2) throw new Error('read twice'); return 1; } }), d => { const t = path.join(d, 'empty'); fs.mkdirSync(t); return t; }],
      ['a recursive getter true only on its first read', reads => ({ get recursive() { return ++reads.n === 1; } }), d => { const t = path.join(d, 'full'); fs.mkdirSync(path.join(t, 's'), { recursive: true }); fs.writeFileSync(path.join(t, 's', 'f'), 'f'); return t; }],
    ]) {
      const d = fresh('getters-' + HAN);
      const a = build(fs.mkdtempSync(path.join(d, 'a-'))), b = build(fs.mkdtempSync(path.join(d, 'b-')));
      const ra = { n: 0 }, rb = { n: 0 };
      const want = outcome(() => fs.rmSync(a, make(ra)));
      const got = outcome(() => removeSync(b, make(rb), { isolate: true }));
      assert.strictEqual(got, want, name);
      assert.strictEqual(fs.existsSync(b), fs.existsSync(a), `${name}: what is left differs`);
      assert.strictEqual(rb.n, ra.n, `${name}: read ${rb.n} times, fs.rmSync ${ra.n}`);
    }
    const arr = Object.assign([], { recursive: true });
    assert.strictEqual(outcome(() => removeSync(path.join(arena, 'nope'), arr, { isolate: true })), outcome(() => fs.rmSync(path.join(arena, 'nope'), arr)), 'an array as options');
  });

  // 1.36.305 review round 4: the guard saw the path string where fs.rmSync's guard sees the URL it was given; a search
  //   part ('?x') makes String(url) end in something other than '.lock', so --dry-run refuses fs.rmSync(url), while the
  //   path the URL names ends in '.lock' and was exempt.
  test('a write guard sees a URL target as it sees it for fs.rmSync', () => {
    const io = require(path.join(PKG, 'lib', 'io.js'));
    const { pathToFileURL } = require('url');
    const d = fresh('dry-run-url');
    const make = name => { const t = path.join(d, name); fs.mkdirSync(t); fs.writeFileSync(path.join(t, 'SKILL.md'), 's'); const u = pathToFileURL(t); u.search = '?x'; return [t, u]; };
    const [isolatedPath, isolated] = make('isolated.lock'), [, control] = make('control.lock');
    io.setDryRunGuard(true);
    try {
      assert.throws(() => fs.rmSync(control, { recursive: true, force: true }), e => e.code === 'E_DRY_RUN_WRITE', 'control: fs.rmSync is refused');
      assert.throws(() => safe().removeSync(isolated, { recursive: true, force: true }, { isolate: true }), e => e.code === 'E_DRY_RUN_WRITE');
    } finally { io.setDryRunGuard(false); }
    assert.strictEqual(fs.existsSync(path.join(isolatedPath, 'SKILL.md')), true, 'removed under --dry-run');
  });

  test('the child runs without NODE_OPTIONS (a preload of this process does not run there)', () => {
    const d = fresh('node-options');
    const marker = path.join(d, 'preload-ran.txt'), preload = path.join(d, 'preload.js');
    fs.writeFileSync(preload, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
    const t = path.join(d, 'full'); fs.mkdirSync(path.join(t, 's'), { recursive: true }); fs.writeFileSync(path.join(t, 's', 'f'), 'f');
    const saved = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = `--require ${JSON.stringify(preload)}`;
    try { safe().removeSync(t, { recursive: true }, { isolate: true }); }
    finally { if (saved === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = saved; }
    assert.strictEqual(fs.existsSync(t), false);
    assert.strictEqual(fs.existsSync(marker), false, 'the preload ran in the child');
  });

  test('the child removes a relative path from this working directory', () => {
    const back = process.cwd();
    const sandbox = fresh('relative-' + HAN);
    fs.mkdirSync(path.join(sandbox, 'sub', 'deeper'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'sub', 'deeper', 'x.txt'), 'x');
    fs.writeFileSync(path.join(sandbox, 'sentinel.txt'), 's');
    process.chdir(sandbox);
    try { safe().removeSync('sub', { recursive: true }, { isolate: true }); }
    finally { process.chdir(back); }
    assert.strictEqual(fs.existsSync(path.join(sandbox, 'sub')), false);
    assert.strictEqual(fs.readFileSync(path.join(sandbox, 'sentinel.txt'), 'utf8'), 's');
  });

  // 1.36.305 review round 2: an empty path resolved to the working directory, whose contents were removed; Node checks
  //   the path as given (lstat ''), so fs.rmSync('') is ENOENT and removes nothing.
  test('an empty path removes nothing, as fs.rmSync (not the working directory)', () => {
    const { removeSync } = safe();
    const back = process.cwd();
    const sandbox = fresh('empty-path');
    fs.writeFileSync(path.join(sandbox, 'sentinel.txt'), 's');
    process.chdir(sandbox);
    try {
      for (const [target, opts] of [['', { recursive: true }], ['', { recursive: true, force: true }], [Buffer.alloc(0), { recursive: true, force: true }]]) {
        const want = outcome(() => fs.rmSync(target, opts));
        const got = outcome(() => removeSync(target, opts, { isolate: true }));
        assert.strictEqual(got, want, `${JSON.stringify(String(target))} ${JSON.stringify(opts)}`);
        assert.strictEqual(fs.readFileSync(path.join(sandbox, 'sentinel.txt'), 'utf8'), 's', 'the working directory lost a file');
      }
    } finally { process.chdir(back); }
  });

  // 1.36.305 review rounds 2 and 3: a write guard (--dry-run, the runtime write boundary) checks the path each fs call
  //   is given. fs.rmSync is one call on the target as given; the isolated removal's first change is on the target as
  //   given, through the guarded fs, and the rest happens where no guard runs (fs.rmSync in the child), as inside
  //   fs.rmSync.
  test('a write guard sees an isolated removal as it sees fs.rmSync: refused at the target, nothing inside removed', () => {
    const io = require(path.join(PKG, 'lib', 'io.js'));
    const t = path.join(fresh('dry-run'), 'skill');
    fs.mkdirSync(t);
    fs.writeFileSync(path.join(t, 'Pipfile.lock'), 'l');
    fs.writeFileSync(path.join(t, 'SKILL.md'), 's');
    const before = fs.readdirSync(t).sort();
    io.setDryRunGuard(true);
    try {
      assert.throws(() => safe().removeSync(t, { recursive: true, force: true }, { isolate: true }), e => e.code === 'E_DRY_RUN_WRITE');
      assert.throws(() => fs.rmSync(t, { recursive: true, force: true }), e => e.code === 'E_DRY_RUN_WRITE', 'control: fs.rmSync is refused too');
    } finally { io.setDryRunGuard(false); }
    assert.deepStrictEqual(fs.readdirSync(t).sort(), before, 'an entry was removed under --dry-run');
  });

  test('a write guard that allows the target lets an isolated removal remove what is inside, as fs.rmSync', () => {
    const io = require(path.join(PKG, 'lib', 'io.js'));
    const d = fresh('dry-run-lock');
    const make = name => { const t = path.join(d, name); fs.mkdirSync(path.join(t, 'sub'), { recursive: true }); fs.writeFileSync(path.join(t, 'owner.json'), '{}'); fs.writeFileSync(path.join(t, 'sub', 'x.txt'), 'x'); return t; };
    const isolated = make('isolated.lock'), control = make('control.lock');
    io.setDryRunGuard(true);
    let controlCode = null;
    try {
      // Where fs.rmSync is written in JavaScript (Node 22 and older, as on CI's Node 20 jobs) it removes the entries
      //   through fs's own functions, which the guard wraps, so there it refuses inside. The removal is isolated only on
      //   Node versions whose fs.rmSync is native and asks the guard once; the comparison applies where the control
      //   shows that (1.36.305 CI: this case failed on Node 20 when it assumed it).
      try { fs.rmSync(control, { recursive: true, force: true }); } catch (e) { controlCode = e.code; }
      if (controlCode === null) safe().removeSync(isolated, { recursive: true, force: true }, { isolate: true });
    } finally { io.setDryRunGuard(false); }
    if (controlCode !== null) {
      assert.strictEqual(controlCode, 'E_DRY_RUN_WRITE', 'control: fs.rmSync failed for another reason');
      console.log(`  skipped: fs.rmSync on Node ${process.version} asks the guard for each entry (the removal is not isolated on such a Node)`);
      return;
    }
    assert.strictEqual(fs.existsSync(control), false, 'control: fs.rmSync removed the exempt folder');
    assert.strictEqual(fs.existsSync(isolated), false, 'the isolated removal did not remove what fs.rmSync removes');
  });

  // 1.36.305 review round 3: the guard saw the resolved path; for 'x.lock\' that is 'x.lock', which --dry-run exempts,
  //   where fs.rmSync('x.lock\') is refused (the spelling given does not end in '.lock').
  test('a write guard sees the target spelled as given (a trailing separator)', () => {
    const io = require(path.join(PKG, 'lib', 'io.js'));
    const d = fresh('dry-run-tail');
    const make = name => { const t = path.join(d, name); fs.mkdirSync(t); fs.writeFileSync(path.join(t, 'SKILL.md'), 's'); return t + path.sep; };
    const isolated = make('isolated.lock'), control = make('control.lock');
    io.setDryRunGuard(true);
    try {
      assert.throws(() => fs.rmSync(control, { recursive: true, force: true }), e => e.code === 'E_DRY_RUN_WRITE', 'control: fs.rmSync is refused');
      assert.throws(() => safe().removeSync(isolated, { recursive: true, force: true }, { isolate: true }), e => e.code === 'E_DRY_RUN_WRITE');
    } finally { io.setDryRunGuard(false); }
    assert.strictEqual(fs.existsSync(path.join(isolated, 'SKILL.md')), true, 'removed under --dry-run');
  });

  test('isolated removal: a nested tree with a read-only file and non-ASCII names is removed', () => {
    const root = fresh('tree');
    const t = path.join(root, 'tree-' + HAN + EMOJI);
    fs.mkdirSync(path.join(t, 'a', 'b', 'c'), { recursive: true });
    fs.writeFileSync(path.join(t, 'a', 'one.txt'), '1');
    fs.writeFileSync(path.join(t, 'a', 'b', 'c', 'two.txt'), '2');
    fs.writeFileSync(path.join(t, 'ro.txt'), 'r'); fs.chmodSync(path.join(t, 'ro.txt'), 0o444);
    safe().removeSync(t, { recursive: true, force: true }, { isolate: true });
    assert.strictEqual(fs.existsSync(t), false);
    assert.deepStrictEqual(fs.readdirSync(root), []);
  });

  test('isolated removal: a link inside is removed as a link, and its target keeps its contents', () => {
    const root = fresh('links');
    const target = path.join(root, 'target'); fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'sentinel.txt'), 's');
    const tfile = path.join(root, 'tfile.txt'); fs.writeFileSync(tfile, 't');
    const t = path.join(root, 'tree'); fs.mkdirSync(t);
    const made = [];
    try { fs.symlinkSync(target, path.join(t, 'junction'), 'junction'); made.push('junction'); } catch (e) { if (isWin) throw e; }
    try { fs.symlinkSync(target, path.join(t, 'dirlink'), 'dir'); made.push('dir symlink'); } catch (e) { if (!isWin) throw e; }
    try { fs.symlinkSync(tfile, path.join(t, 'filelink'), 'file'); made.push('file symlink'); } catch (e) { if (!isWin) throw e; }
    assert.ok(made.length > 0, 'no link could be made');
    console.log(`  links made here: ${made.join(', ')}`);
    safe().removeSync(t, { recursive: true, force: true }, { isolate: true });
    assert.strictEqual(fs.existsSync(t), false);
    assert.strictEqual(fs.readFileSync(path.join(target, 'sentinel.txt'), 'utf8'), 's', 'the removal went into a link');
    assert.strictEqual(fs.readFileSync(tfile, 'utf8'), 't', 'a file link target was removed');
  });

  test('isolated removal: a target that is itself a link is removed as a link', () => {
    const root = fresh('link-target');
    const target = path.join(root, 'target'); fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'sentinel.txt'), 's');
    const link = path.join(root, 'link');
    fs.symlinkSync(target, link, isWin ? 'junction' : 'dir');
    safe().removeSync(link, { recursive: true, force: true }, { isolate: true });
    assert.throws(() => fs.lstatSync(link), e => e.code === 'ENOENT');
    assert.strictEqual(fs.readFileSync(path.join(target, 'sentinel.txt'), 'utf8'), 's');
  });

  test('isolated removal: force and recursive work as in fs.rmSync (same codes on the same inputs)', () => {
    const { removeSync } = safe();
    const full = fn => { try { fn(); return 'ok'; } catch (e) { return `${e.code}|${e.syscall}|${e.errno}|${e.path}`; } };
    for (const [name, setup, opts] of [
      ['missing, force', d => path.join(d, 'nope'), { force: true }],
      ['missing, no force', d => path.join(d, 'nope'), {}],
      ['missing, recursive', d => path.join(d, 'nope'), { recursive: true }],
      ['directory, no recursive', d => { const x = path.join(d, 'dir'); fs.mkdirSync(x); fs.writeFileSync(path.join(x, 'f'), 'f'); return x; }, { force: true }],
      ['file, recursive', d => { const x = path.join(d, 'file'); fs.writeFileSync(x, 'f'); return x; }, { recursive: true }],
      ['file, no options', d => { const x = path.join(d, 'file'); fs.writeFileSync(x, 'f'); return x; }, undefined],
      ['empty directory, recursive', d => { const x = path.join(d, 'empty'); fs.mkdirSync(x); return x; }, { recursive: true }],
      ['full directory, recursive', d => { const x = path.join(d, 'full'); fs.mkdirSync(path.join(x, 's'), { recursive: true }); fs.writeFileSync(path.join(x, 's', 'f'), 'f'); return x; }, { recursive: true }],
    ]) {
      const a = fresh('parity-a'), b = fresh('parity-b');
      const pa = setup(a), pb = setup(b);
      const want = full(() => fs.rmSync(pa, opts)).split(a).join('<d>');
      const got = full(() => removeSync(pb, opts, { isolate: true })).split(b).join('<d>');
      assert.strictEqual(got, want, name);
      assert.strictEqual(fs.existsSync(pb), fs.existsSync(pa), `${name}: what is left differs`);
    }
    const d = fresh('eisdir'); const x = path.join(d, 'dir'); fs.mkdirSync(x);
    assert.throws(() => removeSync(x, {}, { isolate: true }), e => e.code === 'ERR_FS_EISDIR' && e.path === x && /is a directory/.test(e.message));
  });

  // (The options check calls fs.rmSync on a path that does not exist, through the copy captured at load, not fsImpl.)
  test('in this process, an isolated removal never calls fs.rmSync on the target', () => {
    const d = fresh('no-rmsync'); fs.mkdirSync(path.join(d, 't', 'sub'), { recursive: true }); fs.writeFileSync(path.join(d, 't', 'sub', 'f'), 'f');
    fs.writeFileSync(path.join(d, 'file.txt'), 'f');
    const fsImpl = new Proxy(fs, { get: (target, name) => name === 'rmSync' ? () => { throw new Error('rmSync was called'); } : target[name] });
    safe().removeSync(path.join(d, 't'), { recursive: true, force: true }, { fsImpl, isolate: true });
    safe().removeSync(path.join(d, 'file.txt'), { force: true }, { fsImpl, isolate: true });
    assert.deepStrictEqual(fs.readdirSync(d), []);
  });

  test('isolated removal: a failure reports its code and the target as given; a removal process that ended is an error', () => {
    const d = fresh('fail-path-' + HAN);
    const t = path.join(d, 't'), sub = path.join(t, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    if (isWin) {
      // Whether fs.rmSync ends the child here depends on the whole path (this arena may sit below a temp directory
      //   whose name the code page cannot hold); either way the error names the target as given.
      const child = hold(sub, 6000);
      try {
        assert.throws(() => safe().removeSync(t, { recursive: true, force: true }, { isolate: true }),
          e => ['EBUSY', 'EPERM'].includes(e.code) && e.path === t);
      } finally { child.kill(); }
      // A held file as the target fails at unlink, with its path.
      const locked = path.join(d, 'locked.txt');
      fs.writeFileSync(locked, 'x');
      const locker = lockFile(locked, 4000);
      try {
        assert.throws(() => safe().removeSync(locked, { force: true }, { isolate: true }), e => ['EBUSY', 'EPERM'].includes(e.code) && e.path === locked);
      } finally { locker.kill(); }
      if (bugHere) {
        // Outside the code page fs.rmSync ends its process: here only the child's.
        const t3 = path.join(fresh('ended-' + EMOJI), 't'), sub3 = path.join(t3, 'sub');
        fs.mkdirSync(sub3, { recursive: true });
        const child3 = hold(sub3, 6000);
        try {
          assert.throws(() => safe().removeSync(t3, { recursive: true, force: true }, { isolate: true }),
            e => e.code === 'EPERM' && e.path === t3 && e.removalProcessEnded === true && /EPERM/.test(e.message));
        } finally { child3.kill(); }
      } else note();
    } else {
      if (process.getuid && process.getuid() === 0) { console.log('  skipped: running as root, permissions do not fail'); return; }
      fs.writeFileSync(path.join(sub, 'f'), 'f'); fs.chmodSync(sub, 0o555);
      try {
        assert.throws(() => safe().removeSync(t, { recursive: true, force: true }, { isolate: true }),
          e => ['EACCES', 'EPERM'].includes(e.code) && e.path === t);
      } finally { fs.chmodSync(sub, 0o755); }
    }
  });

  test('isolated removal of a file: maxRetries waits out a hold that ends, and without it the hold fails at once', () => {
    if (!isWin) { console.log('  skipped: a held file does not block removal here'); return; }
    const { removeSync } = safe();
    const a = path.join(fresh('retry'), 'a.txt'); fs.writeFileSync(a, 'a');
    const lockA = lockFile(a, 800);
    removeSync(a, { force: true, maxRetries: 20, retryDelay: 100 }, { isolate: true });
    assert.strictEqual(fs.existsSync(a), false);
    lockA.kill();
    const b = path.join(fresh('no-retry'), 'b.txt'); fs.writeFileSync(b, 'b');
    const lockB = lockFile(b, 4000);
    try { assert.throws(() => removeSync(b, { force: true }, { isolate: true }), e => ['EBUSY', 'EPERM'].includes(e.code)); }
    finally { lockB.kill(); }
  });

  test('the removal sites use removeSync: lib, the three bin commands, the recovery cleanup and removeTree', () => {
    for (const f of fs.readdirSync(path.join(PKG, 'lib')).filter(n => n.endsWith('.js') && n !== 'safe-remove.js')) {
      const src = fs.readFileSync(path.join(PKG, 'lib', f), 'utf8');
      const calls = src.split('\n').filter(l => /\.rmSync\(/.test(l));
      assert.deepStrictEqual(calls, [], `lib/${f} still calls rmSync`);
    }
    const bin = fs.readFileSync(CLI, 'utf8');
    for (const fn of ['skillRemove', '_pruneArchives', '_cleanupNpmTempDir']) {
      const start = bin.indexOf(`function ${fn}(`);
      assert.ok(start >= 0, fn);
      const body = bin.slice(start, bin.indexOf('\nfunction ', start + 10));
      assert.ok(!/fs\.rmSync\(/.test(body) && /_removeSync\(/.test(body), `${fn} does not use _removeSync`);
    }
    const rw = fs.readFileSync(path.join(PKG, 'lib', 'runtime-writes.js'), 'utf8');
    for (const name of ['lstatSync', 'unlinkSync', 'rmdirSync']) assert.ok(new RegExp(`\\n  ${name}: fs\\.${name}\\.bind\\(fs\\),`).test(rw), `recoveryFs does not capture ${name}`);
    assert.ok(/removeSync\(dir, \{ recursive: true, force: true \}, \{ fsImpl: recoveryFs \}\)/.test(rw), 'the recovery cleanup does not pass the captured primitives');
    const tc = fs.readFileSync(path.join(__dirname, 'temp-cleanup.js'), 'utf8');
    const body = tc.slice(tc.indexOf('function removeTree('), tc.indexOf('\nfunction ownTree('));
    assert.ok(!/fs\.rmSync\(/.test(body) && /removeSync\(/.test(body), 'removeTree does not use removeSync');
  });

  if (isWin) {
    test('leerness skill remove with a held folder under a path with an emoji ends with an error, not a crash', () => {
      note();
      const proj = path.join(fresh('skill-' + EMOJI), 'proj');
      fs.mkdirSync(proj);
      const init = runNode([CLI, 'init', proj], { cwd: proj });
      assert.strictEqual(init.status, 0, init.stdout + init.stderr);
      const skill = path.join(proj, '.leerness', 'skills', 'held-skill');
      fs.mkdirSync(path.join(skill, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(skill, 'SKILL.md'), '# held\n');
      const child = hold(path.join(skill, 'sub'), 6000);
      let r;
      try { r = runNode([CLI, 'skill', 'remove', 'held-skill', '--path', proj], { cwd: proj }); }
      finally { child.kill(); }
      assert.notStrictEqual(r.status, CRASH, 'the process was ended (0xC0000409)');
      assert.strictEqual(r.signal, null);
      assert.ok(r.status === 0 || r.status === 1, `exit ${r.status}: ${r.stdout}${r.stderr}`);
      if (r.status === 1) assert.ok(/EBUSY|EPERM/.test(r.stdout + r.stderr), r.stdout + r.stderr);
    });

    test('_cleanupNpmTempDir reports a held temp folder under an emoji path as not cleaned, not a crash', () => {
      note();
      const tmp = path.join(fresh('npm-' + EMOJI), 'leerness-npm-lifecycle-x');
      fs.mkdirSync(path.join(tmp, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.npmrc'), 'token-shaped-but-fake');
      const child = hold(path.join(tmp, 'sub'), 6000);
      let r;
      try {
        r = runNode(['-e', `const L = require(${JSON.stringify(CLI)}); const ok = L._cleanupNpmTempDir(${JSON.stringify(tmp)}, ${JSON.stringify(path.join(tmp, '.npmrc'))}); console.log('CLEANED ' + ok);`]);
      } finally { child.kill(); }
      assert.notStrictEqual(r.status, CRASH, 'the process was ended (0xC0000409)');
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      assert.ok(/CLEANED false/.test(r.stdout), r.stdout);
      // fs.rmSync in the child may remove some entries before the held folder fails it; the credential file is emptied
      //   first, so it is gone or empty.
      const npmrc = path.join(tmp, '.npmrc');
      assert.ok(!fs.existsSync(npmrc) || fs.readFileSync(npmrc, 'utf8') === '', 'the credential file is left with its contents');
    });

    test('scripts/temp-cleanup.js removeTree on a held tree under an emoji path fails with the code, not a crash, and waits a short hold out', () => {
      note();
      const t = path.join(fresh('tree-' + EMOJI), 't');
      fs.mkdirSync(path.join(t, 'sub'), { recursive: true });
      const child = hold(path.join(t, 'sub'), 6000);
      let r;
      try {
        r = runNode(['-e', `const T = require(${JSON.stringify(path.join(__dirname, 'temp-cleanup.js'))}); try { T.removeTree(${JSON.stringify(t)}, { recursive: true, force: true }, { timeoutMs: 400 }); console.log('REMOVED'); } catch (e) { console.log('CODE ' + e.code); }`]);
      } finally { child.kill(); }
      assert.notStrictEqual(r.status, CRASH, 'the process was ended (0xC0000409)');
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      assert.ok(/CODE (EBUSY|EPERM)/.test(r.stdout), r.stdout);
      const t2 = path.join(fresh('tree2-' + EMOJI), 't');
      fs.mkdirSync(path.join(t2, 'sub'), { recursive: true });
      hold(path.join(t2, 'sub'), 1000);
      require('./temp-cleanup').removeTree(t2, { recursive: true, force: true }, { timeoutMs: 15000 });
      assert.strictEqual(fs.existsSync(t2), false, 'removeTree did not wait out a hold of one second');
    });
  }

  test('env summary --json says whether this Node has the bug, and the advisory is English in English mode', () => {
    const L = require(CLI);
    assert.strictEqual(typeof L._rmSyncAdvisory, 'function', '_rmSyncAdvisory is not exported');
    const en = L._rmSyncAdvisory('en', '26.3.0', 'win32'), ko = L._rmSyncAdvisory('ko', '26.3.0', 'win32');
    assert.ok(en && /26\.9\.0/.test(en) && /24\.22\.0/.test(en) && /26\.3\.0/.test(en), en);
    assert.ok(!/[ㄱ-ㆎ가-힣]/.test(en), 'Korean text in the English advisory');
    assert.ok(ko && /[가-힣]/.test(ko) && /26\.9\.0/.test(ko), ko);
    assert.strictEqual(L._rmSyncAdvisory('en', '26.9.0', 'win32'), null);
    assert.strictEqual(L._rmSyncAdvisory('en', '26.3.0', 'linux'), null);
    const r = runNode([CLI, 'env', 'summary', '--json'], { cwd: arena });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(JSON.parse(r.stdout).node.rmSyncPathBug, bugHere);
  });

  // 1.36.305 review round 1: selftest drops LEERNESS_LANG while it runs (a user's setting must not change the cases) and
  //   chose the advisory's language after that, so English mode printed it in Korean. The advisory is printed before
  //   the cases run (about four minutes on Windows), so this reads it from the output file and ends the run.
  test('selftest prints the advisory in the language chosen before it controls its environment', () => {
    if (!bugHere) { console.log(`  skipped: Node ${process.version} on ${process.platform} prints no advisory`); return; }
    for (const [lang, korean] of [['en', false], ['ko', true]]) {
      const dir = fresh('selftest-' + lang), outFile = path.join(dir, 'out.txt'), temp = path.join(dir, 'temp');
      fs.mkdirSync(temp);
      const fd = fs.openSync(outFile, 'w');
      // The run is ended mid-case, so the folders its cases make go to a temp directory inside this probe's arena.
      const env = { ...process.env, LEERNESS_LANG: lang, TEMP: temp, TMP: temp, TMPDIR: temp };
      const child = cp.spawn(process.execPath, [CLI, 'selftest'], { cwd: arena, env, stdio: ['ignore', fd, fd], windowsHide: true });
      children.push(child);
      let line = null;
      for (const deadline = Date.now() + 60000; !line && Date.now() < deadline; sleep(200)) {
        line = fs.readFileSync(outFile, 'utf8').split('\n').find(l => /⚠ .*26\.9\.0/.test(l)) || null;
      }
      child.kill(); fs.closeSync(fd);
      assert.ok(line, `${lang}: no advisory within 60 s`);
      assert.strictEqual(/[가-힣]/.test(line), korean, `${lang}: ${line}`);
    }
  });

  test('selftest has a passing case for the rmSync version check', () => {
    const L = require(CLI);
    const c = L._selfTestCases().filter(x => /T-0365/.test(x.name));
    assert.strictEqual(c.length, 1, 'no T-0365 selftest case');
    assert.strictEqual(c[0].run(), true);
  });
} finally {
  for (const c of children) { try { c.kill(); } catch {} }
  sleep(isWin ? 700 : 0);
  try { require('./temp-cleanup').removeTree(arena, { recursive: true, force: true }); } catch (e) { console.error(`arena left: ${arena} (${e.code})`); }
}
console.log(`safe remove: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
