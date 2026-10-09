'use strict';

// Per-user, per-machine cache for observations that are expensive to repeat (child processes)
// but derived from inputs that are cheap to fingerprint. An entry is only a hint: a reader must
// match the key it computed from those inputs, stay within its own age bound and treat every
// read or parse error as a miss. Writes are best-effort and must never fail the calling command.
// It never lives inside a project, so project read-only contracts are unaffected.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MAX_ENTRIES = 32;   // projects and shells (PATH values) keep their own entries without unbounded growth

// Machine-local state base shared with the lock-host seed. Roaming profiles must not carry
// observations of one machine's executables to another machine.
function machineStateDir() {
  const base = process.platform === 'win32'
    ? String(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
    : (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : String(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state')));
  return base && path.isAbsolute(base) ? path.join(base, 'leerness') : null;
}

// LEERNESS_CACHE_DIR lets tests isolate the cache without redirecting HOME or LOCALAPPDATA,
// which would also change npm and Git configuration lookups.
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

// Concurrent writers are last-writer-wins; losing another process's entry only costs a later miss.
function writeCache(name, key, value) {
  const file = cacheFile(name);
  if (!file) return false;
  const entries = _entries(file);
  // Recency is a per-file sequence, not the clock: writes within one millisecond must still keep the newest.
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
    try { fs.rmSync(temp, { force: true }); } catch {}
    return false;
  }
}

module.exports = { MAX_ENTRIES, machineStateDir, cacheFile, cacheKey, readCache, writeCache };
