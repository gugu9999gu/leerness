'use strict';

 
 
 
 
 
const fs = require('fs');
const { removeSync } = require('./safe-remove');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MAX_ENTRIES = 32;    

 
 
function machineStateDir() {
  const base = process.platform === 'win32'
    ? String(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
    : (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : String(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state')));
  return base && path.isAbsolute(base) ? path.join(base, 'leerness') : null;
}

 
 
function cacheFile(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new TypeError(`invalid machine cache name: ${name}`);
  const override = process.env.LEERNESS_CACHE_DIR;
  const base = machineStateDir();
  const dir = override && path.isAbsolute(override) ? override : (base && path.join(base, 'cache'));
  return dir ? path.join(dir, `${name}.json`) : null;
}

function cacheKey(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function _entries(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data.entries === 'object' && data.entries && !Array.isArray(data.entries) ? data.entries : {};
  } catch { return {}; }
}

function readCache(name, key, maxAgeMs) {
  const file = cacheFile(name);
  if (!file) return null;
  const entry = _entries(file)[key];
  if (!entry || typeof entry.savedAt !== 'number') return null;
  const age = Date.now() - entry.savedAt;
  return age >= 0 && age <= maxAgeMs ? entry.value : null;
}

 
function writeCache(name, key, value) {
  const file = cacheFile(name);
  if (!file) return false;
  const entries = _entries(file);
   
  const seq = Object.values(entries).reduce((max, entry) => Math.max(max, Number(entry && entry.seq) || 0), 0) + 1;
  entries[key] = { savedAt: Date.now(), seq, value };
  const ranked = Object.keys(entries).sort((a, b) => (Number(entries[b].seq) || 0) - (Number(entries[a].seq) || 0));
  for (const stale of ranked.slice(MAX_ENTRIES)) delete entries[stale];
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify({ entries }), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, file);
    return true;
  } catch {
    try { removeSync(temp, { force: true }); } catch {}
    return false;
  }
}

module.exports = { MAX_ENTRIES, machineStateDir, cacheFile, cacheKey, readCache, writeCache };
