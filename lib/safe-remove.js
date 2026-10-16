'use strict';

// T-0365: on Windows, Node 23.x, 24.0.0-24.21.x, 25.x and 26.0.0-26.8.x build the error of a fs.rmSync that fails (a
//   file or folder another process holds) from std::filesystem::path::string() of the absolute path given, which
//   converts with the ANSI code page. A character the code page has no mapping for ends the process (0xC0000409; no
//   try/catch sees it), and any other non-ASCII path comes back garbled in error.path and error.message. Node fixed it
//   in 24.22.0 and 26.9.0 (nodejs/node 37aeecc7b6, "fs: fix rmSync error messages for non-ASCII paths"); 22.x and older
//   remove in JavaScript. Only that one path is converted, so an ASCII path is safe on every version.
// removeSync is fs.rmSync with the same arguments except for a non-ASCII path on those versions. There a file or a link
//   is unlinked (libuv reports its errors with the path as given), and a folder is removed by fs.rmSync itself in a
//   child process, so a failure ends only the child. 1.36.305 review rounds 1-3 found, each time, another place where a
//   removal walked in JavaScript differed from fs.rmSync (a drive-relative path, an empty path, a write guard seeing
//   every entry, a trailing separator, entries that vanish, retries that do not rescan); the owner chose to have
//   fs.rmSync itself do the removal.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const { fileURLToPath } = require('url');
// fs.rmSync as it was when this module loaded (lib/io.js loads it before any write guard wraps fs), used only to have
//   Node check a removal's options on a path that does not exist.
const RM_UNGUARDED = fs.rmSync.bind(fs);

function rmSyncPathBug(version = process.versions.node, platform = process.platform) {
  if (platform !== 'win32') return false;
  const [major, minor] = String(version).replace(/^v/, '').split('.').map(Number);
  if (major === 23 || major === 25) return true;
  if (major === 24) return minor < 22;
  if (major === 26) return minor < 9;
  return false;
}

const asPath = target => target instanceof URL ? fileURLToPath(target) : Buffer.isBuffer(target) ? target.toString() : target;
// Whether fs.rmSync could end the process or garble its error for this target: the bug, and a character above U+007F
//   in the absolute path Node converts (any ANSI code page holds ASCII).
function needsIsolation(target, version, platform) {
  if (!rmSyncPathBug(version, platform)) return false;
  const p = asPath(target);
  return typeof p === 'string' && /[^\x00-\x7f]/.test(path.resolve(p));
}

// The codes fs.rmSync retries when maxRetries is given.
const RETRY_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']);
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function eisdir(target) {
  return Object.assign(new Error(`Path is a directory: rm returned EISDIR (is a directory) ${target}`),
    { name: 'SystemError', code: 'ERR_FS_EISDIR', errno: 21, syscall: 'rm', path: target });
}

// Node checks fs.rmSync's options before it touches the path (1.36.305 review round 4: the isolated removal unlinked a
//   file or removed an empty folder with options fs.rmSync rejects). The same options on a path that does not exist:
//   Node returns for a missing path before the error that ends the process, so this removes nothing and cannot crash.
function checkOptions(options) {
  const missing = path.join(os.tmpdir(), `leerness-rm-options-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
  try { RM_UNGUARDED(missing, options); }
  catch (error) { if (!(error && error.code === 'ENOENT')) throw error; }
}

// fs.rmSync(target, options) in a new Node process, from this working directory, without NODE_OPTIONS (a preload must
//   not run there). It answers with one JSON line; a process that ended without one ended in fs.rmSync.
const CHILD = "const fs=require('fs');let r;try{const j=JSON.parse(fs.readFileSync(0,'utf8'));fs.rmSync(j.target,j.options);r={ok:true};}"
  + "catch(e){r={ok:false,code:e&&e.code,errno:e&&e.errno};}process.stdout.write(JSON.stringify(r));";
function rmSyncInChild(target, options) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'NODE_OPTIONS') delete env[k];
  const r = cp.spawnSync(process.execPath, ['-e', CHILD], { input: JSON.stringify({ target, options: options || {} }), cwd: process.cwd(),
    env, encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 20 });
  if (r.error) throw r.error;
  let answer = null;
  try { answer = JSON.parse(r.stdout); } catch {}
  return { status: r.status, signal: r.signal, answer };
}

// fs.rmSync(target, options). fsImpl: the fs functions to use (lib/runtime-writes.js passes the ones it captured before
//   installing its write guard); isolate: whether to isolate (the default: needsIsolation for this process); runChild:
//   what removes a folder (tests pass their own).
function removeSync(target, options, { fsImpl = fs, isolate = needsIsolation(target), runChild = rmSyncInChild } = {}) {
  if (!isolate) return fsImpl.rmSync(target, options);
  // Node reads the options once, as a copy of their own enumerable properties; so does this, and only the four values
  //   it uses go anywhere, the child included (1.36.305 review round 4, second run: inherited or non-enumerable
  //   properties were read, and the whole object went to the child as JSON, where a BigInt or a cycle threw and a
  //   toJSON could change it). An object (not null, not an array) is copied once and the copy is checked and used, so
  //   a getter runs once (confirmation round: checking the object as given and then copying it ran getters twice);
  //   anything else is checked as given, which Node rejects before it reads a property.
  const read = options !== null && typeof options === 'object' && !Array.isArray(options) ? { ...options } : options;
  checkOptions(read);
  const { recursive = false, force = false, maxRetries = 0, retryDelay = 100 } = { ...read };
  const used = { recursive, force, maxRetries, retryDelay };
  const step = (fn, settle = () => false) => {
    for (let attempt = 0; ; attempt++) {
      try { return fn(); }
      catch (error) {
        if (settle(error) || attempt >= maxRetries || !RETRY_CODES.has(error && error.code)) throw error;
        sleep(retryDelay * (attempt + 1));
      }
    }
  };
  // As Node: the target as given is checked first (an empty path is ENOENT, not the working directory). The parent's
  //   fs calls get the target exactly as given (a string, a Buffer or a URL), as fs.rmSync's one call does, so a write
  //   guard (--dry-run, the runtime write boundary) sees the same value (1.36.305 review round 4: a URL's search part).
  const given = asPath(target);
  let st;
  try { st = fsImpl.lstatSync(target); }
  catch (error) { if (force && error && error.code === 'ENOENT') return; throw error; }
  const gone = error => !!error && error.code === 'ENOENT';
  // A file or a link (a symbolic link or, on Windows, a junction): one unlink.
  if (!st.isDirectory()) {
    try { return step(() => fsImpl.unlinkSync(target)); }
    catch (error) { if (gone(error)) return; throw error; }
  }
  if (!recursive) throw eisdir(given);
  // A folder: rmdir first, through fsImpl, so a guard decides before anything inside goes; an empty folder is removed
  //   there. A full one (ENOTEMPTY or EEXIST) is removed by fs.rmSync in a child process, given the absolute path this
  //   process resolved: Windows keeps each drive's current directory in environment entries ('=D:') that a copied
  //   environment loses, so a drive-relative 'D:x' could name another folder in the child (review round 4).
  const full = error => !!error && (error.code === 'ENOTEMPTY' || error.code === 'EEXIST');
  try { return step(() => fsImpl.rmdirSync(target), full); }
  catch (error) { if (gone(error)) return; if (!full(error)) throw error; }
  const { status, signal, answer } = runChild(path.resolve(given), used);
  if (answer && answer.ok) return;
  if (answer) {
    throw Object.assign(new Error(`${answer.code || 'EPERM'}: could not remove ${given}`),
      { code: answer.code || 'EPERM', errno: answer.errno, syscall: 'rm', path: given });
  }
  throw Object.assign(new Error(`EPERM: could not remove ${given}: the process removing it ended (status ${status}${signal ? `, ${signal}` : ''}); `
    + 'on this Node, fs.rmSync ends the process when a removal fails on a path with a character outside the system code page'),
  { code: 'EPERM', syscall: 'rm', path: given, removalProcessEnded: true });
}

module.exports = { rmSyncPathBug, needsIsolation, removeSync, RETRY_CODES };
