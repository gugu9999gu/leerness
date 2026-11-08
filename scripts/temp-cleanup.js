'use strict';

 
 
 
 
 
const fs = require('fs');
const os = require('os');
const path = require('path');

const RETRY_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']);

function removeTree(target, rmOptions = {}, { timeoutMs = 5000, intervalMs = 100 } = {}) {
   
   
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

 
 
 
 
 
 
 
function ownTree(dir) {
  const st = fs.lstatSync(dir, { bigint: true });
  return { dir, dev: st.dev, ino: st.ino, real: fs.realpathSync.native(dir) };
}
const RETAINED = Object.freeze({ removed: false, retained: true, reason: 'automatic-cleanup-disabled' });
function removeOwnedTree() {
  return RETAINED;
}

 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
const RECORD_ENV = 'LEERNESS_TEMP_RECORD';
let tracker = null;
const INACTIVE = Object.freeze({ active: false, pending: () => 0 });
function loadedFromMain(caller) {
  const seen = new Set();
  for (let m = caller; m && !seen.has(m); m = m.parent) { seen.add(m); if (m.id === '.') return true; }
  return false;
}
 
function within(root, real) {
  const relative = path.relative(root, real);
  return !(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative));
}
const strictlyWithin = (root, real) => real !== root && within(root, real);
 
 
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
       
       
       
      if (readdirSync(d).length !== 0) return;
      const fd = openSync(file, 'a');
      try { writeSync(fd, JSON.stringify({ path: d, dev: String(st.dev), ino: String(st.ino), real, temp: at.temp }) + '\n'); }
      finally { closeSync(fd); }
      count++;
    } catch {   }
  };
   
   
   
   
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
function removeRecorded(recordDir, { tempRoot = os.tmpdir() } = {}) {
  const result = { removed: 0, gone: 0, left: 0, skipped: 0 };
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
      const outcome = removeOwnedTree({ dir: x.path, dev: st.dev, ino: st.ino, real: x.real });
      if (outcome.removed) result.removed++;
      else result.left++;
    } catch (error) {
      if (error && error.code === 'ENOENT') result.gone++;
      else result.left++;
    }
  }
  return result;
}

module.exports = { removeTree, RETRY_CODES, ownTree, removeOwnedTree, trackTemp, removeRecorded, RECORD_ENV };
