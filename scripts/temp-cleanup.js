'use strict';

// Remove a probe's temporary tree while another process or thread may still hold a handle in it for
// a moment (a child that is exiting, antivirus, a worker thread). Node 26.3 fs.rmSync does not retry
// EPERM even with maxRetries: a directory held as a child's cwd, or a file held open without sharing,
// fails after 0-1 ms on Windows. So the wait is explicit and bounded, on the codes Node documents
// for maxRetries. rm options pass through unchanged; callers keep their own path-safety checks.
const fs = require('fs');
const os = require('os');
const path = require('path');

const RETRY_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']);

function removeTree(target, rmOptions = {}, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  // T-0365: removeSync is fs.rmSync except on the Windows Node versions whose failed fs.rmSync ends the process. It is
  //   loaded at first use, so requiring this file loads nothing from lib/ before trackTemp runs.
  const { removeSync } = require('../lib/safe-remove');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { return removeSync(target, rmOptions); }
    catch (error) {
      if (!RETRY_CODES.has(error && error.code) || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, intervalMs);
    }
  }
}

// T-0357: removing a folder a test made, moved here from T-0354's arena cleanup (memory-migration-test-support.js,
//   three review rounds) so every probe uses the same checks. ownTree() records the folder right after it is made.
//   removeOwnedTree() removes it only while it is still that folder (same file identity, not a link): a test that
//   renamed it away and put a link in its place would otherwise have the walk run inside the link's target. Links
//   inside are removed first, as links, so the removal never walks into a link's target, wherever that points, and
//   each folder must still resolve inside the tree just before it is listed and before a link in it is removed.
//   A process that kept swapping folders while this runs could still race these checks.
function ownTree(dir) {
  const st = fs.lstatSync(dir, { bigint: true });
  return { dir, dev: st.dev, ino: st.ino, real: fs.realpathSync.native(dir) };
}
function removeOwnedTree(owned, { code = 'E_TEMP_REPLACED', timeoutMs = 5000 } = {}) {
  const replaced = () => Object.assign(new Error('the folder was replaced'), { code });
  const st = fs.lstatSync(owned.dir, { bigint: true });
  if (st.isSymbolicLink() || !st.isDirectory() || st.dev !== owned.dev || st.ino !== owned.ino) throw replaced();
  const resolvesInside = dir => {
    const relative = path.relative(owned.real, fs.realpathSync.native(dir));
    return !(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative));
  };
  const removeLinks = dir => {
    if (!resolvesInside(dir)) throw replaced();
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), entry = fs.lstatSync(file);
      if (entry.isSymbolicLink()) {
        if (!resolvesInside(dir)) throw replaced();
        try { fs.unlinkSync(file); } catch { fs.rmdirSync(file); }
      } else if (entry.isDirectory()) removeLinks(file);
    }
  };
  removeLinks(owned.dir);
  removeTree(owned.dir, { recursive: true, force: true }, { timeoutMs });
}

// T-0357: probes and e2e cases made temp folders and many never removed them (8,434 leerness-* folders were in this
//   machine's TEMP on 2026-10-14). The work is split: the test process records the folders it makes, and the runner
//   that started it removes them once it has seen the process end with exit status 0 (scripts/ci-shard.js runNpm).
//   1.36.302 and 1.36.303 decided inside the test process at exit; in eight review rounds a later piece of JavaScript
//   (another exit listener, a microtask, an exception handler, an interrupted process.exit()) kept changing the verdict
//   after the decision. The exit status the runner reads cannot change any more.
// trackTemp(module), the first statement of every script that names mkdtemp, records only when the environment carries
//   LEERNESS_TEMP_RECORD (an absolute directory the runner made for this run); without it nothing is wrapped and the
//   script behaves as before. It wraps fs.mkdtempSync (the asynchronous forms are not recorded; see below) and, when a
//   call returns a folder, appends one line to its own file in that directory at once. It removes nothing and installs no exit,
//   emit or exception hook. Processes the test starts that inherit the variable record into the same directory, so
//   their folders go too once the test passed. Call it before the probe requires anything that captures these
//   functions (lib/runtime-writes.js binds fs.mkdtempSync when it loads).
// What is recorded (from the 1.36.303 review rounds): only a call whose prefix is an absolute path without '.' or '..'
//   segments (a relative prefix names a folder only through the working directory as the file system sees it when the
//   folder is made, and '..' after a link is resolved physically); a Buffer prefix or result only if it is UTF-8 that
//   decodes and encodes back to the same bytes; a result only if it is the prefix followed by the six characters
//   mkdtemp adds (another encoding returns the path encoded); a folder only if it is strictly below the temp directory
//   of the moment of the call.
// A script loaded with --require into another process (lock-probe.js into the CLI, a probe that preloads itself) must
//   not change what that process does. So trackTemp(module) runs only for code the main script loaded: the caller or
//   a module up its chain is the main module (Node gives it the id '.'). A preload, loaded before the main script, and
//   anything it loads, through require() at any depth or through createRequire(), never reach it (1.36.302 review
//   round 2: the earlier check looked for the preload's parent instead, and createRequire() gives a parent outside that
//   chain). The id is read from the module, not from this file's require.main, which stays undefined when this file
//   was itself preloaded (round 3). Called without a module it does nothing (1.36.304 review round 1: the check was
//   skipped then, so a preload that called trackTemp() recorded). It never runs in a worker thread.
const RECORD_ENV = 'LEERNESS_TEMP_RECORD';
let tracker = null;
const INACTIVE = Object.freeze({ active: false, pending: () => 0 });
function loadedFromMain(caller) {
  const seen = new Set();
  for (let m = caller; m && !seen.has(m); m = m.parent) { seen.add(m); if (m.id === '.') return true; }
  return false;
}
// real is root or below it.
function within(root, real) {
  const relative = path.relative(root, real);
  return !(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative));
}
const strictlyWithin = (root, real) => real !== root && within(root, real);
// A path value as text, or null: a Buffer only if it survives decoding (1.36.303 review round 4: a lossy decoding named
//   another folder), a file: URL through fileURLToPath.
function pathText(value) {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) { const s = value.toString('utf8'); return Buffer.from(s, 'utf8').equals(value) ? s : null; }
  if (value instanceof URL) return require('url').fileURLToPath(value);
  return null;
}
function trackTemp(caller) {
  if (!loadedFromMain(caller)) return INACTIVE;
  if (!require('worker_threads').isMainThread) return INACTIVE;
  const recordDir = process.env[RECORD_ENV];
  if (!recordDir || !path.isAbsolute(recordDir)) return INACTIVE;
  if (tracker) return tracker;
  const file = path.join(recordDir, `${process.pid}-${require('crypto').randomBytes(4).toString('hex')}.jsonl`);
  // The record is written and the folder read with the fs functions of this moment: lib/runtime-writes.js intercepts
  //   fs writes when it loads, and fs.appendFileSync goes through the current fs.openSync, so the memory recovery
  //   bundles it makes while writes are latched went unrecorded (found by this version's first full run). Tests that
  //   replace fs functions later do not stop or change a record either.
  const { openSync, writeSync, closeSync, lstatSync, readdirSync } = fs;
  const realpathNative = fs.realpathSync.native;
  let count = 0;
  const callContext = prefix => {
    try {
      const p = pathText(prefix);
      if (p === null || !path.isAbsolute(p) || p.split(/[\\/]/).some(s => s === '.' || s === '..')) return null;
      return { prefix: p, temp: realpathNative(os.tmpdir()) };
    } catch { return null; }
  };
  const record = (dir, at) => {
    try {
      const d = pathText(dir);
      if (d === null || !at || d.length !== at.prefix.length + 6 || !d.startsWith(at.prefix)) return;
      const st = lstatSync(d, { bigint: true }), real = realpathNative(d);
      if (st.isSymbolicLink() || !st.isDirectory() || !strictlyWithin(at.temp, real)) return;
      // A folder mkdtempSync just made is empty. A wrapper installed before the tracker (a preload) can call the original
      //   and put a folder that already existed in its place (1.36.304 review round 2); one with anything in it is not
      //   recorded, so it is never removed.
      if (readdirSync(d).length !== 0) return;
      const fd = openSync(file, 'a');
      try { writeSync(fd, JSON.stringify({ path: d, dev: String(st.dev), ino: String(st.ino), real, temp: at.temp }) + '\n'); }
      finally { closeSync(fd); }
      count++;
    } catch { /* not recorded: the folder is only left behind */ }
  };
  // Only the synchronous form is recorded, in the same synchronous step that made the folder, so no code of the test
  //   runs between the creation and the record. The callback and promise forms complete later, and another folder put
  //   in place before then was recorded instead (1.36.304 review round 1); they are not wrapped, and their folders are
  //   left, like those of a process that does not inherit the variable. No script in scripts/ uses them.
  const originalSync = fs.mkdtempSync;
  fs.mkdtempSync = function mkdtempSync(...args) {
    const at = callContext(args[0]);
    const dir = originalSync.apply(this, args);
    record(dir, at);
    return dir;
  };
  tracker = { active: true, pending: () => count };
  return tracker;
}

// The runner's half: remove what the processes of one passed run recorded in recordDir, newest first. Each folder
//   must still be the one recorded (same file identity, not a link: removeOwnedTree), and its real path must be strictly
//   below both the temp directory recorded with it and the runner's own temp directory (tempRoot). A line that does not
//   parse or lacks a field is skipped; a folder already gone is counted as gone; one that is replaced, outside, or still
//   held after the budget is left. A folder still held by a process that outlived the run waits at most 2 s, and the
//   whole removal at most budgetMs.
function readRecordLines(recordDir) {
  let names;
  try { names = fs.readdirSync(recordDir).filter(n => n.endsWith('.jsonl')).sort(); } catch { return []; }
  const lines = [];
  for (const name of names) {
    let text;
    try { text = fs.readFileSync(path.join(recordDir, name), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) if (line.trim()) lines.push(line);
  }
  return lines;
}
function removeRecorded(recordDir, { tempRoot = os.tmpdir(), budgetMs = 60000 } = {}) {
  const result = { removed: 0, gone: 0, left: 0, skipped: 0 };
  const deadline = Date.now() + budgetMs;
  let root;
  try { root = fs.realpathSync.native(tempRoot); } catch { root = null; }
  const records = [];
  for (const line of readRecordLines(recordDir)) {
    let x;
    try { x = JSON.parse(line); } catch { result.skipped++; continue; }
    if (!x || typeof x !== 'object' || ['path', 'dev', 'ino', 'real', 'temp'].some(k => typeof x[k] !== 'string' || !x[k])) { result.skipped++; continue; }
    records.push(x);
  }
  for (const x of records.reverse()) {
    if (!root || !path.isAbsolute(x.path) || !strictlyWithin(x.temp, x.real) || !strictlyWithin(root, x.real)) { result.left++; continue; }
    try {
      const st = fs.lstatSync(x.path, { bigint: true });
      if (st.isSymbolicLink() || !st.isDirectory() || String(st.dev) !== x.dev || String(st.ino) !== x.ino) { result.left++; continue; }
      if (fs.realpathSync.native(x.path) !== x.real) { result.left++; continue; }
      removeOwnedTree({ dir: x.path, dev: st.dev, ino: st.ino, real: x.real }, { timeoutMs: Math.max(0, Math.min(2000, deadline - Date.now())) });
      result.removed++;
    } catch (error) {
      if (error && error.code === 'ENOENT') result.gone++;
      else result.left++;
    }
  }
  return result;
}

module.exports = { removeTree, RETRY_CODES, ownTree, removeOwnedTree, trackTemp, removeRecorded, RECORD_ENV };
