'use strict';

 
 
 
 
 
 
 
 
 
 
 
 
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const { fileURLToPath } = require('url');
 
 
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
 
 
function needsIsolation(target, version, platform) {
  if (!rmSyncPathBug(version, platform)) return false;
  const p = asPath(target);
  return typeof p === 'string' && /[^\x00-\x7f]/.test(path.resolve(p));
}

 
const RETRY_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']);
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function eisdir(target) {
  return Object.assign(new Error(`Path is a directory: rm returned EISDIR (is a directory) ${target}`),
    { name: 'SystemError', code: 'ERR_FS_EISDIR', errno: 21, syscall: 'rm', path: target });
}

 
 
 
function checkOptions(options) {
  const missing = path.join(os.tmpdir(), `leerness-rm-options-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
  try { RM_UNGUARDED(missing, options); }
  catch (error) { if (!(error && error.code === 'ENOENT')) throw error; }
}

 
 
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

 
 
 
function removeSync(target, options, { fsImpl = fs, isolate = needsIsolation(target), runChild = rmSyncInChild } = {}) {
  if (!isolate) return fsImpl.rmSync(target, options);
   
   
   
   
   
   
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
   
   
   
  const given = asPath(target);
  let st;
  try { st = fsImpl.lstatSync(target); }
  catch (error) { if (force && error && error.code === 'ENOENT') return; throw error; }
  const gone = error => !!error && error.code === 'ENOENT';
   
  if (!st.isDirectory()) {
    try { return step(() => fsImpl.unlinkSync(target)); }
    catch (error) { if (gone(error)) return; throw error; }
  }
  if (!recursive) throw eisdir(given);
   
   
   
   
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
