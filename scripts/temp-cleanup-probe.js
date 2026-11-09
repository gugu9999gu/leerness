'use strict';
require('./temp-cleanup').trackTemp(module);  

 
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const { removeTree } = require('./temp-cleanup');

const tempParent = fs.realpathSync(os.tmpdir());
const arena = fs.mkdtempSync(path.join(tempParent, 'leerness-temp-cleanup-'));
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// Node 18 throws a TypeError for every Buffer prefix, so that call makes no folder at all.
const LOSSY_BUFFER_PREFIX = Number(process.versions.node.split('.')[0]) < 20 ? 'TypeError' : process.platform === 'win32' ? 'ENOENT' : 'made';
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}
 
function heldTree(name, holdMs) {
  const root = path.join(arena, name);
  const inner = path.join(root, 'inner');
  fs.mkdirSync(inner, { recursive: true });
  fs.writeFileSync(path.join(inner, 'file.txt'), 'x');
  const child = cp.spawn(process.execPath, ['-e', `setTimeout(() => {}, ${holdMs})`], { cwd: inner, stdio: 'ignore', windowsHide: true });
  sleep(300);
  return { root, child };
}

try {
  test('a tree held by an exiting child is removed once the hold ends', () => {
    const { root, child } = heldTree('held', 1200);
    try {
       
      let before = 'removed';
       
       
      if (require('../lib/safe-remove').rmSyncPathBug() && /[^\x00-\x7f]/.test(root)) before = 'not run (T-0365)';
      else try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (error) { before = error.code; }
      console.log(`  rmSync with maxRetries on a held tree (${process.platform}, ${process.version}): ${before}`);
      if (fs.existsSync(root)) {
        const started = Date.now();
        removeTree(root, { recursive: true, force: true });
        console.log(`  removeTree waited ${Date.now() - started} ms`);
      }
      assert.strictEqual(fs.existsSync(root), false);
    } finally { child.kill(); }
  });
  test('rm options pass through: a missing path throws without force and is ignored with it', () => {
    const missing = path.join(arena, 'missing');
    assert.throws(() => removeTree(missing, { recursive: true }), error => error.code === 'ENOENT');
    removeTree(missing, { recursive: true, force: true });
  });
  test('an error outside the retry codes is thrown at once', () => {
    const file = path.join(arena, 'plain-file');
    fs.writeFileSync(file, 'x');
    const started = Date.now();
    assert.throws(() => removeTree(path.join(file, 'child'), { recursive: true }), error => !['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'].includes(error.code));
    assert.ok(Date.now() - started < 1000, 'non-retryable error waited');
  });
  test('a hold longer than the bound still fails, after the bound', () => {
    if (process.platform !== 'win32') return;    
    const { root, child } = heldTree('long-hold', 4000);
    try {
      const started = Date.now();
       
       
      assert.throws(() => removeTree(root, { recursive: true, force: true }, { timeoutMs: 600 }), error => error.code === 'EPERM' || error.code === 'EBUSY');
      const waited = Date.now() - started;
      assert.ok(waited >= 600 && waited < 2500, `waited ${waited} ms`);
    } finally { child.kill(); }
  });

   
   
   
   
   
  const T = require('./temp-cleanup');
  test('owned cleanup retains a tree held by an exiting Windows child', () => {
    const { root, child } = heldTree('owned-held', 1200);
    const owned = T.ownTree(root);
    try { assert.deepStrictEqual(T.removeOwnedTree(owned), { removed: false, retained: true, reason: 'automatic-cleanup-disabled' }); assert.strictEqual(fs.existsSync(root), true); }
    finally { child.kill(); }
  });
  test('owned cleanup does not wait for a persistent Windows directory hold', () => {
    if (process.platform !== 'win32') return;
    const { root, child } = heldTree('owned-long-held', 4000);
    const owned = T.ownTree(root), started = Date.now();
    try {
      assert.strictEqual(T.removeOwnedTree(owned, { timeoutMs: 600 }).retained, true);
      assert.strictEqual(fs.readFileSync(path.join(root, 'inner', 'file.txt'), 'utf8'), 'x');
      assert.ok(Date.now() - started < 600);
    } finally { child.kill(); }
  });
  test('owned cleanup retains a replacement directory and preserves its bytes', () => {
    const root = path.join(arena, 'owned-replaced'), saved = path.join(arena, 'owned-original');
    fs.mkdirSync(root); const owned = T.ownTree(root);
    for (const dir of [root, saved]) assert.strictEqual(path.dirname(path.resolve(dir)), path.resolve(arena));
    fs.renameSync(root, saved); fs.mkdirSync(root);
    const sentinel = path.join(root, 'foreign.txt'); fs.writeFileSync(sentinel, 'retained');
    assert.strictEqual(T.removeOwnedTree(owned).removed, false);
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'retained');
  });
  const TC = JSON.stringify(path.join(__dirname, 'temp-cleanup.js'));
  const childTemp = path.join(arena, 'child-temp');
  const outside = path.join(arena, 'outside');
  fs.mkdirSync(childTemp); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'kept');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  let seq = 0;
  const newRecordDir = () => { const d = path.join(arena, `record-${++seq}`); fs.mkdirSync(d); return d; };
  const readRecords = dir => fs.readdirSync(dir).sort().flatMap(f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
  const childEnv = dir => {
    const env = { ...process.env, TEMP: childTemp, TMP: childTemp, TMPDIR: childTemp };
    for (const k of Object.keys(env)) if (k.toUpperCase() === T.RECORD_ENV) delete env[k];
    if (dir) env[T.RECORD_ENV] = dir;
    return env;
  };
  const tracked = (body, { before = '', record = true, start = 'const tracker = T.trackTemp(module);', nodeArgs = [] } = {}) => {
    const dir = record ? newRecordDir() : null;
    const file = path.join(arena, `child-${++seq}.js`);
    fs.writeFileSync(file, [
      `const T = require(${TC});`,
      "const fs = require('fs'), os = require('os'), path = require('path');",
      `const OUTSIDE = ${JSON.stringify(outside)}, TYPE = ${JSON.stringify(linkType)}, ARENA = ${JSON.stringify(arena)}, CHILD_TEMP = ${JSON.stringify(childTemp)};`,
      before, start,
      'const made = [];',
      "const mk = parent => { const d = fs.mkdtempSync(path.join(parent, 'leerness-track-')); made.push(d); return d; };",
      "process.on('exit', () => console.log('MADE ' + JSON.stringify(made)));",
      body, ''].join('\n'));
    const r = cp.spawnSync(process.execPath, [...nodeArgs, file], { encoding: 'utf8', windowsHide: true, timeout: 60000, env: childEnv(dir) });
    const line = r.stdout.split(/\r?\n/).find(l => l.startsWith('MADE '));
    assert.ok(line, r.stdout + r.stderr);
    return { r, made: JSON.parse(line.slice(5)), dir, records: dir ? readRecords(dir) : [] };
  };
  const out = (r, tag) => JSON.parse((r.stdout.split(/\r?\n/).find(l => l.startsWith(tag + ' ')) || `${tag} null`).slice(tag.length + 1));
  const sentinelKept = () => assert.strictEqual(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'kept');
  const cleanup = dirs => { for (const d of dirs) removeTree(d, { recursive: true, force: true }); };
  const SAME = "console.log('SAME ' + JSON.stringify([fs.mkdtempSync === S.sync, fs.mkdtemp === S.cb, fs.promises.mkdtemp === S.p, tracker.active]));";
  const SAVE = 'const S = { sync: fs.mkdtempSync, cb: fs.mkdtemp, p: fs.promises.mkdtemp };';

   
  test('trackTemp without LEERNESS_TEMP_RECORD changes nothing: the functions stay, nothing is recorded or removed', () => {
    const { r, made } = tracked(`mk(os.tmpdir()); ${SAME}`, { record: false, before: SAVE });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.deepStrictEqual(out(r, 'SAME'), [true, true, true, false]);
    assert.strictEqual(fs.existsSync(made[0]), true, 'a run without the variable removed its folder');
    cleanup(made);
  });
  test('with LEERNESS_TEMP_RECORD set, fs.mkdtempSync records its folder in the process\'s own file, and the process removes nothing', () => {
    const { r, made, dir, records } = tracked('mk(os.tmpdir()); mk(os.tmpdir());');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    for (const d of made) assert.strictEqual(fs.existsSync(d), true, `the process removed ${d} itself`);
    assert.deepStrictEqual(records.map(x => x.path), made);
    const files = fs.readdirSync(dir);
    assert.strictEqual(files.length, 1); assert.ok(/^\d+-[0-9a-f]{8}\.jsonl$/.test(files[0]), files[0]);
    const temp = fs.realpathSync.native(childTemp);
    for (const x of records) {
      const st = fs.lstatSync(x.path, { bigint: true });
      assert.deepStrictEqual([x.dev, x.ino, x.real, x.temp], [String(st.dev), String(st.ino), fs.realpathSync.native(x.path), temp]);
    }
    cleanup(made);
  });
   
   
   
  test('the asynchronous mkdtemp forms are not wrapped and record nothing, also when the folder is swapped before completion', () => {
    for (const form of ['callback', 'promise']) {
      const W = path.join(childTemp, `async-${form}`);
      const call = form === 'callback' ? "fs.mkdtemp(path.join(W, 'leerness-async-'), () => {})" : "fs.promises.mkdtemp(path.join(W, 'leerness-async-'))";
      try {
        const { r, made, dir, records } = tracked(`
          const W = ${JSON.stringify(W)}; fs.mkdirSync(W);
          ${SAME}
          ${call};
          let name; const t0 = Date.now();
          while (!(name = fs.readdirSync(W).find(n => n.startsWith('leerness-async-')))) if (Date.now() - t0 > 20000) throw new Error('mkdtemp did not finish');
          const d = path.join(W, name), other = path.join(W, 'unrelated');
          fs.mkdirSync(other); fs.writeFileSync(path.join(other, 'u.txt'), 'u');
          fs.renameSync(d, d + '-aside'); fs.renameSync(other, d);
          require('util').promisify(fs.mkdtemp)(path.join(W, 'leerness-promisify-'));
          require('fs/promises').mkdtemp(path.join(W, 'leerness-fsp-'));
          mk(os.tmpdir());
          console.log('SWAP ' + JSON.stringify(d));`, { before: SAVE });
        assert.strictEqual(r.status, 0, r.stdout + r.stderr);
        assert.deepStrictEqual(out(r, 'SAME'), [false, true, true, true], form);
        assert.deepStrictEqual(records.map(x => x.path), made, `${form}: recorded an asynchronous folder, or not the control`);
        T.removeRecorded(dir, { tempRoot: childTemp });
        assert.strictEqual(fs.readFileSync(path.join(out(r, 'SWAP'), 'u.txt'), 'utf8'), 'u', `${form}: the folder swapped in was removed`);
      } finally { cleanup([W]); }
    }
  });
   
   
   
   
  test('a folder that is not empty when fs.mkdtempSync returns is not recorded (a wrapper installed before the tracker swapped it in)', () => {
    const pre = path.join(arena, 'preload-swap.js');
    fs.writeFileSync(pre, ["const fs = require('fs');", 'const orig = fs.mkdtempSync;',
      'fs.mkdtempSync = function (...a) { const d = orig.apply(this, a); const from = process.env.SWAP_FROM; if (from) { fs.renameSync(d, d + "-aside"); fs.renameSync(from, d); } return d; };', ''].join('\n'));
    const { r, made, dir, records } = tracked(`
      const swap = (content) => { const u = path.join(CHILD_TEMP, 'unrelated-' + content); fs.mkdirSync(u); if (content === 'full') fs.writeFileSync(path.join(u, 'u.txt'), 'u');
        process.env.SWAP_FROM = u; const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-swap-')); delete process.env.SWAP_FROM; return d; };
      const full = swap('full'), empty = swap('empty');
      mk(os.tmpdir());
      console.log('SWAP ' + JSON.stringify({ full, empty }));`, { nodeArgs: ['--require', pre] });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const swapped = out(r, 'SWAP');
    assert.deepStrictEqual(records.map(x => x.path), [swapped.empty, ...made], 'recorded the folder with something in it, or not the empty one and the control');
    T.removeRecorded(dir, { tempRoot: childTemp });
    assert.strictEqual(fs.readFileSync(path.join(swapped.full, 'u.txt'), 'utf8'), 'u', 'the folder swapped in with a file was removed');
    cleanup([swapped.full, swapped.full + '-aside', swapped.empty + '-aside']);
  });
   
   
   
   
  test('a Buffer prefix that is not UTF-8 records nothing, also when a wrapper planted the sibling its lossy decoding names', () => {
    const pre = path.join(arena, 'preload-ff.js');
    fs.writeFileSync(pre, ["const fs = require('fs');", 'const orig = fs.mkdtempSync;',
      'fs.mkdtempSync = function (prefix, ...rest) { const r = orig.call(fs, prefix, ...rest); if (Buffer.isBuffer(prefix) && prefix.includes(0xff) && Buffer.isBuffer(r)) fs.mkdirSync(r.toString("utf8")); return r; };', ''].join('\n'));
    const { r, made, records } = tracked(`
      let ff = 'made';
      try { fs.mkdtempSync(Buffer.concat([Buffer.from(path.join(os.tmpdir(), 'leerness-ffa-')), Buffer.from([0xff])]), { encoding: 'buffer' }); } catch (e) { ff = e.code || e.name; }
      mk(os.tmpdir());
      console.log('FF ' + JSON.stringify(ff));`, { nodeArgs: ['--require', pre] });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(out(r, 'FF'), LOSSY_BUFFER_PREFIX);
    assert.deepStrictEqual(records.map(x => x.path), made, 'recorded the sibling a lossy decoding names, or not the control');
    cleanup(made);
  });
   
   
   
   
  test('a result that is not the prefix plus six characters is not recorded, also when a wrapper made the folder it names', () => {
     
     
     
     
     
    if ([...childTemp].some(ch => ch.charCodeAt(0) > 127)) { console.log('  skipped: the temp path holds non-ASCII letters'); return; }
    const pre = path.join(arena, 'preload-latin1.js');
    fs.writeFileSync(pre, ["const fs = require('fs');", 'const orig = fs.mkdtempSync;',
      'fs.mkdtempSync = function (prefix, options) { const r = orig.call(fs, prefix, options); if (options && options.encoding === "latin1") fs.mkdirSync(r); return r; };', ''].join('\n'));
    const { r, made, dir, records } = tracked(`
      const alias = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-' + String.fromCharCode(0xe9) + '-'), { encoding: 'latin1' });
      fs.writeFileSync(path.join(alias, 'sentinel.txt'), 's');
      mk(os.tmpdir());
      console.log('ALIAS ' + JSON.stringify(alias));`, { nodeArgs: ['--require', pre] });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const alias = out(r, 'ALIAS');
    assert.ok(alias && fs.existsSync(path.join(alias, 'sentinel.txt')), r.stdout);
    assert.deepStrictEqual(records.map(x => x.path), made, 'recorded the folder a mangled result names, or not the control');
    T.removeRecorded(dir, { tempRoot: childTemp });
    assert.strictEqual(fs.readFileSync(path.join(alias, 'sentinel.txt'), 'utf8'), 's', 'the folder a mangled result names was removed');
    cleanup([alias, ...fs.readdirSync(childTemp).filter(n => n.startsWith('leerness-' + String.fromCharCode(0xe9) + '-')).map(n => path.join(childTemp, n))]);
  });
  test('a record is written when the call returns, so a run that then fails or throws keeps an accurate record', () => {
    for (const end of ['process.exitCode = 1;', 'throw new Error("planned");', 'process.exit(3);']) {
      const { r, made, records } = tracked(`mk(os.tmpdir()); ${end}`);
      assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
      assert.deepStrictEqual(records.map(x => x.path), made, end);
      assert.strictEqual(fs.existsSync(made[0]), true);
      cleanup(made);
    }
  });
   
   
   
  test('not recorded: a relative or dotted prefix, an encoded result, a lossy Buffer prefix, a folder outside the temp directory', () => {
    const { r, records } = tracked(`
      const W = path.join(os.tmpdir(), 'w'); fs.mkdirSync(path.join(W, 'x'), { recursive: true }); process.chdir(W);
      const left = [];
      left.push(path.resolve(fs.mkdtempSync('leerness-rel-')));
      left.push(fs.mkdtempSync(W + path.sep + 'x' + path.sep + '..' + path.sep + 'leerness-dot-'));
      const hex = fs.mkdtempSync(path.join(W, 'leerness-hex-'), { encoding: 'hex' }); left.push(Buffer.from(hex, 'hex').toString());
      let ff = 'made';
      try { left.push(fs.mkdtempSync(Buffer.concat([Buffer.from(path.join(W, 'leerness-ff-')), Buffer.from([0xff])]), { encoding: 'buffer' }).toString()); } catch (e) { ff = e.code || e.name; }
      left.push(fs.mkdtempSync(path.join(ARENA, 'leerness-outside-')));
      const kept = [mk(os.tmpdir()), fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-buf-'), { encoding: 'buffer' }).toString(),
        fs.mkdtempSync(require('url').pathToFileURL(path.join(os.tmpdir(), 'leerness-url-')))];
      console.log('SETS ' + JSON.stringify({ left, kept, ff }));`);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const sets = out(r, 'SETS');
     
    assert.strictEqual(sets.ff, LOSSY_BUFFER_PREFIX);
    assert.deepStrictEqual(records.map(x => x.path), sets.kept, 'recorded the wrong folders');
    cleanup([path.join(childTemp, 'w'), ...sets.left.filter(p => p.startsWith(arena)), ...sets.kept]);
  });
   
   
   
   
  test('a record is written and read with the fs functions of the start, even after the test replaces them', () => {
    const { r, made, records } = tracked(`
      const saved = {}; const block = () => { throw Object.assign(new Error('blocked'), { code: 'EBLOCKED' }); };
      for (const k of ['openSync', 'writeSync', 'closeSync', 'appendFileSync', 'writeFileSync', 'lstatSync', 'statSync']) { saved[k] = fs[k]; fs[k] = block; }
      saved.native = fs.realpathSync.native; fs.realpathSync.native = block;
      let d;
      try { d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-track-blocked-')); }
      finally { for (const k of Object.keys(saved)) if (k !== 'native') fs[k] = saved[k]; fs.realpathSync.native = saved.native; }
      made.push(d);`);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.deepStrictEqual(records.map(x => x.path), made, 'a folder made while fs functions were replaced was not recorded');
    const st = fs.lstatSync(made[0], { bigint: true });
    assert.deepStrictEqual([records[0].dev, records[0].ino, records[0].real], [String(st.dev), String(st.ino), fs.realpathSync.native(made[0])]);
    cleanup(made);
  });
  test('with recording on, the exit, emit and exception machinery is untouched', () => {
    const { r } = tracked(`console.log('HOOKS ' + JSON.stringify([process.reallyExit === H.reallyExit, process.exit === H.exit, process.emit === H.emit,
      ...['exit', 'beforeExit', 'uncaughtExceptionMonitor', 'newListener'].map(e => process.listenerCount(e) - (e === 'exit' ? 1 : 0) === H.counts[e]), tracker.active]));`,
    { before: "const H = { reallyExit: process.reallyExit, exit: process.exit, emit: process.emit, counts: Object.fromEntries(['exit', 'beforeExit', 'uncaughtExceptionMonitor', 'newListener'].map(e => [e, process.listenerCount(e)])) };" });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
     
    assert.deepStrictEqual(out(r, 'HOOKS'), [true, true, true, true, true, true, true, true]);
  });
   
   
   
  test('trackTemp() without a module records nothing: in a main script, in a --require preload, and in node -e', () => {
    const noArg = tracked('mk(os.tmpdir()); console.log("ACTIVE " + JSON.stringify(tracker.active));', { start: 'const tracker = T.trackTemp();' });
    assert.strictEqual(noArg.r.status, 0, noArg.r.stdout + noArg.r.stderr);
    assert.strictEqual(out(noArg.r, 'ACTIVE'), false); assert.deepStrictEqual(noArg.records, []);
    cleanup(noArg.made);
    const pre = path.join(arena, 'preload-noarg.js');
    fs.writeFileSync(pre, `require(${TC}).trackTemp();\nconst fs = require('fs'), os = require('os'), path = require('path');\nconsole.log('MADE ' + fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-pre-noarg-')));\n`);
    for (const args of [['--require', pre, '-e', '0'], ['-e', `require(${TC}).trackTemp(); const fs = require('fs'), os = require('os'), path = require('path'); console.log('MADE ' + fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-eval-noarg-')));`]]) {
      const dir = newRecordDir();
      const r = cp.spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 60000, env: childEnv(dir) });
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      assert.deepStrictEqual(readRecords(dir), [], `recorded without a module: ${args[0]}`);
      cleanup(r.stdout.split(/\r?\n/).filter(l => l.startsWith('MADE ')).map(l => l.slice(5)));
    }
  });
  test('trackTemp(module) records nothing in a script loaded with --require, a module it loads, or through createRequire()', () => {
    const support = path.join(arena, 'preload-support.js'), script = path.join(arena, 'preloaded.js'), viaCreate = path.join(arena, 'preload-create.js');
    const body = `require(${TC}).trackTemp(module);
      const fs = require('fs'), os = require('os'), path = require('path');
      console.log('MADE ' + fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-track-pre-')));`;
    fs.writeFileSync(support, `'use strict';\n${body}\n`);
    fs.writeFileSync(script, `'use strict';\n${body}\nif (process.env.LOAD_SUPPORT) require(${JSON.stringify(support)});\n`);
    fs.writeFileSync(viaCreate, `require('node:module').createRequire(__filename)(${JSON.stringify(script)});\n`);
    const runIt = (args, extra = {}) => {
      const dir = newRecordDir();
      const r = cp.spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 60000, env: { ...childEnv(dir), ...extra } });
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      return { madeHere: r.stdout.split(/\r?\n/).filter(l => l.startsWith('MADE ')).map(l => l.slice(5)), records: readRecords(dir) };
    };
    for (const args of [['--require', script, '-e', '0'], ['--require', viaCreate, '-e', '0']]) {
      const { madeHere, records } = runIt(args, { LOAD_SUPPORT: '1' });
      assert.ok(madeHere.length >= 1, args.join(' '));
      assert.deepStrictEqual(records, [], `a preload recorded: ${args.join(' ')}`);
      cleanup(madeHere);
    }
    const viaOptions = runIt(['-e', '0'], { NODE_OPTIONS: `--require "${script.replace(/\\/g, '/')}"` });
    assert.deepStrictEqual(viaOptions.records, []); cleanup(viaOptions.madeHere);
    const asMain = runIt([script], { LOAD_SUPPORT: '1' });
    assert.strictEqual(asMain.madeHere.length, 2);
    assert.deepStrictEqual(asMain.records.map(x => x.path).sort(), asMain.madeHere.slice().sort(), 'run as the main script, it did not record');
    cleanup(asMain.madeHere);
    const helperPreloaded = runIt(['--require', path.join(__dirname, 'temp-cleanup.js'), script]);
    assert.deepStrictEqual(helperPreloaded.records.map(x => x.path), helperPreloaded.madeHere, 'with temp-cleanup.js preloaded, the main script did not record');
    cleanup(helperPreloaded.madeHere);
  });
  test('trackTemp(module) records nothing 60 requires below a --require preload, and does 60 requires below the main script', () => {
    const chain = path.join(arena, 'chain');
    fs.mkdirSync(chain);
    for (let i = 0; i < 60; i++) {
      fs.writeFileSync(path.join(chain, `m${i}.js`), i < 59 ? `require('./m${i + 1}.js');\n`
        : `require(${TC}).trackTemp(module);\n`
          + `const fs = require('fs'), os = require('os'), path = require('path');\n`
          + `console.log('MADE ' + fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-track-chain-')));\n`);
    }
    for (const [args, want] of [[['--require', path.join(chain, 'm0.js'), '-e', '0'], 0], [[path.join(chain, 'm0.js')], 1]]) {
      const dir = newRecordDir();
      const r = cp.spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 60000, env: childEnv(dir) });
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      assert.strictEqual(readRecords(dir).length, want, args.join(' '));
      cleanup(r.stdout.split(/\r?\n/).filter(l => l.startsWith('MADE ')).map(l => l.slice(5)));
    }
  });
  test('trackTemp(module) records nothing in a worker thread started from a script file', () => {
    const worker = path.join(arena, 'worker-script.js');
    fs.writeFileSync(worker, `const T = require(${TC});\nif (T.trackTemp(module).active) throw new Error('active in a worker');\n`
      + "const fs = require('fs'), os = require('os'), path = require('path');\n"
      + "require('worker_threads').parentPort.postMessage(fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-track-worker-')));\n");
    const { r, made, records } = tracked(`
      const w = new (require('worker_threads').Worker)(${JSON.stringify(worker)});
      w.on('message', d => console.log('WORKER ' + JSON.stringify(d)));
      w.on('error', e => { console.log('worker error ' + e.message); process.exitCode = 2; });
      mk(os.tmpdir());`);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.deepStrictEqual(records.map(x => x.path), made, 'the worker recorded, or the main thread did not');
    cleanup([...made, out(r, 'WORKER')]);
  });
  test('one tracker per process; pending() counts what it recorded', () => {
    const { r, made, records } = tracked(`
      if (T.trackTemp(module) !== tracker) throw new Error('a second tracker');
      mk(os.tmpdir()); mk(os.tmpdir());
      console.log('PENDING ' + tracker.pending());`);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(out(r, 'PENDING'), 2);
    assert.strictEqual(records.length, 2);
    cleanup(made);
  });

   
  test('removeRecorded retains recorded ancestors, nested folders and links without reporting deletion', () => {
    const { r, made, dir } = tracked(`
      const a = mk(os.tmpdir()), b = mk(a);
      fs.writeFileSync(path.join(b, 'file.txt'), 'x');
      fs.symlinkSync(OUTSIDE, path.join(a, 'link-out'), TYPE);`);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const result = T.removeRecorded(dir, { tempRoot: childTemp });
    for (const d of made) assert.strictEqual(fs.existsSync(d), true, `${d} was removed`);
    assert.strictEqual(fs.readFileSync(path.join(made[1], 'file.txt'), 'utf8'), 'x');
    assert.strictEqual(fs.lstatSync(path.join(made[0], 'link-out')).isSymbolicLink(), true);
    assert.deepStrictEqual(result, { removed: 0, gone: 0, left: 2, skipped: 0 });
    sentinelKept();
  });
  test('removeRecorded leaves a folder replaced by a link (and the link) or by another folder, and skips one already gone', () => {
    const { r, made, dir } = tracked(`
      const a = mk(os.tmpdir()), b = mk(os.tmpdir()), c = mk(os.tmpdir()), d = mk(os.tmpdir());
      fs.rmdirSync(b);
      fs.renameSync(c, c + '-aside'); fs.symlinkSync(OUTSIDE, c, TYPE);
      fs.renameSync(d, d + '-aside'); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'other.txt'), 'other');`);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const result = T.removeRecorded(dir, { tempRoot: childTemp });
    assert.deepStrictEqual(result, { removed: 0, gone: 1, left: 3, skipped: 0 });
    assert.strictEqual(fs.existsSync(made[0]), true);
    assert.strictEqual(fs.lstatSync(made[2]).isSymbolicLink(), true, 'the link in place of a folder was removed');
    assert.strictEqual(fs.readFileSync(path.join(made[3], 'other.txt'), 'utf8'), 'other', 'the folder now at that path was removed');
    sentinelKept();
    try { fs.unlinkSync(made[2]); } catch { fs.rmdirSync(made[2]); }
    cleanup([made[2] + '-aside', made[3], made[3] + '-aside']);
  });
  test('removeRecorded leaves a folder outside the runner\'s temp directory and skips lines it cannot use', () => {
    const { r, made, dir } = tracked('mk(os.tmpdir());');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    fs.writeFileSync(path.join(dir, 'zz-bad.jsonl'), 'not json\n{"path":"x"}\n' + JSON.stringify({ path: outside, dev: '1', ino: '1', real: outside, temp: arena }) + '\n');
    const elsewhere = T.removeRecorded(dir, { tempRoot: outside });
    assert.deepStrictEqual(elsewhere, { removed: 0, gone: 0, left: 2, skipped: 2 });
    assert.strictEqual(fs.existsSync(made[0]), true, 'removed outside the runner\'s temp directory');
    sentinelKept();
    const here = T.removeRecorded(dir, { tempRoot: childTemp });
    assert.deepStrictEqual(here, { removed: 0, gone: 0, left: 2, skipped: 2 }); assert.strictEqual(fs.existsSync(made[0]), true);
    sentinelKept();
  });
   
   
  test('removeRecorded leaves a folder whose record names a temp directory it is not below', () => {
    const { r, made, dir } = tracked('mk(os.tmpdir());');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const file = path.join(dir, fs.readdirSync(dir)[0]);
    const x = JSON.parse(fs.readFileSync(file, 'utf8').trim());
    fs.writeFileSync(file, JSON.stringify({ ...x, temp: outside }) + '\n');
    assert.deepStrictEqual(T.removeRecorded(dir, { tempRoot: childTemp }), { removed: 0, gone: 0, left: 1, skipped: 0 });
    assert.strictEqual(fs.existsSync(made[0]), true, 'removed a folder outside the temp directory of its record');
    cleanup(made);
  });
  test('removeRecorded of a directory that does not exist or holds no records removes nothing', () => {
    assert.deepStrictEqual(T.removeRecorded(path.join(arena, 'no-such-record-dir'), { tempRoot: childTemp }), { removed: 0, gone: 0, left: 0, skipped: 0 });
    assert.deepStrictEqual(T.removeRecorded(newRecordDir(), { tempRoot: childTemp }), { removed: 0, gone: 0, left: 0, skipped: 0 });
  });
   
   
   
  const TRACKER = /^(?:const [\w$]+ = )?require\('\.\/temp-cleanup'\)\.trackTemp\(module\);/;
  function installedFirst(text) {
     
     
    const raw = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    const s = [String.fromCharCode(0x2028), String.fromCharCode(0x2029), '\r'].reduce((t, end) => t.split(end).join('\n'), raw.split('\r\n').join('\n'));
    let i = s.startsWith('#!') ? s.indexOf('\n') + 1 : 0;
    if (i === 0 && s.startsWith('#!')) return false;
    for (;;) {
      const rest = s.slice(i);
      let m;
      if ((m = /^[ \t\n]+/.exec(rest))) { i += m[0].length; continue; }
      if (rest.startsWith('//')) { const nl = rest.indexOf('\n'); i += nl < 0 ? rest.length : nl + 1; continue; }
      if (rest.startsWith('/*')) { const end = rest.indexOf('*/', 2); if (end < 0) return false; i += end + 2; continue; }
      if ((m = /^(['"])use strict\1;?/.exec(rest))) { i += m[0].length; continue; }
      break;
    }
    return (i === 0 || s[i - 1] === '\n') && TRACKER.test(s.slice(i));
  }
  test('the ratchet accepts the tracker only as the first statement, not in a comment, a string or after code', () => {
    const T = "require('./temp-cleanup').trackTemp(module); // T-0357";
    const cases = [
      [`'use strict';\n${T}\nconst fs = require('fs');\n`, true],
      [`#!/usr/bin/env node\r\n// header\r\n/* block\r\n   comment */\r\n'use strict';\r\n\r\n${T}\r\n`, true],
      [`// no directive\n${T}\n`, true],
      [`'use strict';\n/*\n${T}\n*/\nconst fs = require('fs');\n`, false],
      [`'use strict';\n// ${T}\n`, false],
      [`'use strict';\nconst s = \`\n${T}\n\`;\n`, false],
      [`'use strict';\nconst io = require('../lib/io');\n${T}\n`, false],
      [`'use strict';\nconst fs = require('fs');\n`, false],
      [`'use strict';\n/* never closed\n${T}\n`, false],
       
      [`// header\r/*\n${T}\n*/\nconst fs = require('fs');\n`, false],
      [`// header${String.fromCharCode(0x2028)}/*\n${T}\n*/\n`, false],
      [`// header${String.fromCharCode(0x2029)}/*\n${T}\n*/\n`, false],
      [`'use strict';\r${T}\r`, true],
    ];
    for (const [text, want] of cases) assert.strictEqual(installedFirst(text), want, JSON.stringify(text));
  });
   
   
  const namesMkdtemp = text => /\bmkdtemp/.test(text);
  test('the ratchet selects every script that names mkdtemp, in any form', () => {
    for (const text of ['fs.mkdtempSync(p)', 'fs.mkdtempSync (p)', 'fs\n  .mkdtempSync(p)', 'const { mkdtempSync } = fs;', "fs['mkdtempSync'](p)",
      'fs.mkdtemp(p, cb)', 'await fs.promises.mkdtemp(p)', "require('fs/promises').mkdtemp(p)", 'const { mkdtemp: mk } = fs;']) {
      assert.strictEqual(namesMkdtemp(text), true, JSON.stringify(text));
    }
    assert.strictEqual(namesMkdtemp('fs.mkdirSync(p)'), false);
  });
  test('every script that names mkdtemp has the tracker as its first statement', () => {
    const notFirst = [];
    let checked = 0;
    for (const name of fs.readdirSync(__dirname).filter(f => f.endsWith('.js')).sort()) {
      if (name === 'temp-cleanup.js') continue;
      const text = fs.readFileSync(path.join(__dirname, name), 'utf8');
      if (!namesMkdtemp(text)) continue;
      checked++;
      if (!installedFirst(text)) notFirst.push(name);
    }
    assert.ok(checked >= 150, `only ${checked} scripts make temp folders`);
    assert.deepStrictEqual(notFirst, []);
  });
} finally {
  sleep(300);
  removeTree(arena, { recursive: true, force: true });
}
console.log(`temp cleanup: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
