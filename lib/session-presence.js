'use strict';
 
 
//
 
 
 
 
 
 
 
//
 

const SESSIONS_KEEP = 20;                               
const SESSIONS_CLOSED_TTL_MS = 7 * 24 * 3600 * 1000;    
 
 
 

const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const FILE_RE = /^[A-Za-z0-9_-]{8,64}\.json$/;
 
 
const RESERVED_KEYS = new Set(['unaddressed']);
 
 
const RESERVED_PREFIXES = ['leerness-internal-'];
 
 
 
 
const PRESENCE_ENV_KEYS = [
  'LEERNESS_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID',
  'CLAUDE_CODE_CHILD_SESSION', 'LEERNESS_MCP_ADDRESS_EXPLICIT', 'LEERNESS_INTERNAL', 'LEERNESS_HOOK',
  'LEERNESS_NO_SESSION_PRESENCE', 'CI', 'GITHUB_ACTIONS', 'CLAUDECODE', 'CURSOR_AGENT',
  'CODEX_MANAGED_BY_NPM', 'CODEX_MANAGED_BY_PNPM', 'CODEX_MANAGED_BY_BUN',
  'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
];
function normalizePresenceEnv(env, options) {
  const source = env || {};
  const out = { ...source };
  const caseInsensitive = options && Object.prototype.hasOwnProperty.call(options, 'caseInsensitive')
    ? options.caseInsensitive === true
    : process.platform === 'win32';
  if (!caseInsensitive) return out;
  const keys = Object.keys(source);
  for (const canonical of PRESENCE_ENV_KEYS) {
    const variants = keys.filter(key => key.toLowerCase() === canonical.toLowerCase());
    if (!variants.length) continue;
    const selected = Object.prototype.hasOwnProperty.call(source, canonical) ? canonical : variants[0];
    for (const key of variants) delete out[key];
    out[canonical] = source[selected];
  }
  return out;
}
function isValidKey(s) {
  if (typeof s !== 'string' || !KEY_RE.test(s)) return false;
  const folded = s.toLowerCase();
  return !RESERVED_KEYS.has(folded) && !RESERVED_PREFIXES.some(prefix => folded.startsWith(prefix));
}
 
 
 
 
const CANONICAL_ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function confirmedCloseMs(record) {
  const value = record && record.closedAt;
  if (typeof value !== 'string' || !CANONICAL_ISO_UTC_RE.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  try { return new Date(ms).toISOString() === value ? ms : null; } catch { return null; }
}
function hasConfirmedClose(record) { return confirmedCloseMs(record) !== null; }

 
 
function caseVariantConflict(entries) {
  const open = (entries || []).filter(e => e && e.record && !hasConfirmedClose(e.record));
  if (open.length < 2) return null;
  const variants = open.map(e => String(e.name || '')).filter(name => FILE_RE.test(name)).slice(0, 10);
  return {
    reason: 'ambiguous-open-case-variants',
    count: open.length,
    variants,
  };
}
 
function isTruthyEnv(v) {
  const t = String(v == null ? '' : v).trim().toLowerCase();
  return t !== '' && t !== '0' && t !== 'false' && t !== 'no' && t !== 'off';
}

 
 
 
 
 
 
const FORBIDDEN_SIGNALS = ['CODEX_COMPANION_SESSION_ID', 'CODEX_COMPANION_TRANSCRIPT_PATH',
  'CLAUDE_PLUGIN_DATA', 'TERM_PROGRAM', 'VSCODE_PID', 'VSCODE_IPC_HOOK', 'ELECTRON_RUN_AS_NODE',
  'ANTHROPIC_BASE_URL', 'AI_AGENT'];

 
 
 
 
 
 
 
 
 
 
 
const KEY_SOURCES = ['LEERNESS_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID'];
function keySource(env) {
  const e = normalizePresenceEnv(env);
   
   
   
   
   
   
  if (isValidKey(e.LEERNESS_SESSION_ID)) return 'LEERNESS_SESSION_ID';
  if (e.CLAUDE_CODE_CHILD_SESSION === '1') return null;
  for (const k of KEY_SOURCES) if (isValidKey(e[k])) return k;
  return null;
}
 
 
 
function deriveSessionKey(env) {
  const e = normalizePresenceEnv(env);
  const src = keySource(e);
  return src ? String(e[src]).toLowerCase() : null;
}
 
 
function invalidExplicitKey(env) {
  const v = normalizePresenceEnv(env).LEERNESS_SESSION_ID;
  if (v === undefined || v === null || v === '') return null;
  return isValidKey(v) ? null : String(v).slice(0, 40);
}

 
 
 
function detectOutermostAgent(env) {
  const e = normalizePresenceEnv(env);
  if (e.CLAUDECODE === '1') return { agent: 'claude-code', evidence: ['CLAUDECODE'] };
  if (!e.CLAUDECODE) {
    for (const k of ['CODEX_MANAGED_BY_NPM', 'CODEX_MANAGED_BY_PNPM', 'CODEX_MANAGED_BY_BUN']) {
      if (e[k] === '1') return { agent: 'codex-cli', evidence: [k] };
    }
    if (e.CODEX_INTERNAL_ORIGINATOR_OVERRIDE) return { agent: 'codex', evidence: ['CODEX_INTERNAL_ORIGINATOR_OVERRIDE'] };
  }
   
   
   
  if (e.CURSOR_AGENT === '1') return { agent: 'unknown', evidence: ['CURSOR_AGENT'] };
   
   
  return { agent: 'unknown', evidence: [] };
}

 
function suppressionReason(env, hasHarness) {
  const e = normalizePresenceEnv(env);
   
   
   
   
  const addressedMcp = e.LEERNESS_MCP_ADDRESS_EXPLICIT === '1' && isValidKey(e.LEERNESS_SESSION_ID);
  if (e.LEERNESS_INTERNAL === '1' && !addressedMcp) return 'internal';
  if (e.LEERNESS_HOOK === '1') return 'hook';
   
   
   
   
  if (e.CLAUDE_CODE_CHILD_SESSION === '1' && !addressedMcp) return 'child-agent';
   
   
  if (isTruthyEnv(e.CI) || isTruthyEnv(e.GITHUB_ACTIONS)) return 'ci';
  if (e.LEERNESS_NO_SESSION_PRESENCE === '1') return 'opt-out';
  if (!hasHarness) return 'not-a-leerness-project';
  if (!deriveSessionKey(e)) return 'not-identifiable';
  return null;
}

 
 
 
 
function selectPrunable(records, opts) {
  const o = opts || {};
  const keep = Number.isFinite(o.keep) ? o.keep : SESSIONS_KEEP;
  const ttl = Number.isFinite(o.closedTtlMs) ? o.closedTtlMs : SESSIONS_CLOSED_TTL_MS;
  const nowMs = Number.isFinite(o.nowMs) ? o.nowMs : 0;
  const selfKey = o.selfKey || null;
  const list = (records || []).filter(e => e && typeof e.name === 'string' && FILE_RE.test(e.name));
  const keyOf = (e) => String(e.name).replace(/\.json$/, '');
  const foldedKeyOf = (e) => keyOf(e).toLowerCase();
  const foldedSelf = typeof selfKey === 'string' ? selfKey.toLowerCase() : null;
   
   
  const trusted = list.filter(e => e.record && isValidKey(e.record.sessionKey)
    && String(e.record.sessionKey).toLowerCase() === foldedKeyOf(e));
  const doomed = new Set();
   
   
  for (const e of list) {
    if (!trusted.includes(e) && foldedKeyOf(e) !== foldedSelf && hasConfirmedClose(e.record)) doomed.add(e.name);
  }
  for (const e of trusted) {
    if (foldedKeyOf(e) === foldedSelf) continue;
    const c = confirmedCloseMs(e.record);
    if (c !== null && nowMs && (nowMs - c) > ttl) doomed.add(e.name);
  }
   
   
  const closed = trusted.filter(e => !doomed.has(e.name) && hasConfirmedClose(e.record));
  const activity = (e) => Math.max(Date.parse((e.record && e.record.lastHandoffAt) || '') || 0,
    Date.parse((e.record && e.record.closedAt) || '') || 0,
    Date.parse((e.record && e.record.openedAt) || '') || 0);
  const ranked = closed.slice().sort((a, b) => activity(b) - activity(a));
  for (const e of ranked.slice(keep)) { if (foldedKeyOf(e) !== foldedSelf) doomed.add(e.name); }
  return [...doomed];
}

 
 
 
 
function countOtherSessions(records, selfKey, selfHostId) {
  const foldedSelf = typeof selfKey === 'string' ? selfKey.toLowerCase() : null;
  return (records || []).filter(r => r && isValidKey(r.sessionKey)
    && String(r.sessionKey).toLowerCase() !== foldedSelf
    && r.hostId && selfHostId && r.hostId === selfHostId
    && !hasConfirmedClose(r)).length;
}

 
function hostRelation(recordHostId, selfHostId) {
  if (!recordHostId || !selfHostId) return 'unknown';
  return recordHostId === selfHostId ? 'same' : 'different';
}

module.exports = {
  KEY_SOURCES, keySource, invalidExplicitKey,
  SESSIONS_KEEP, SESSIONS_CLOSED_TTL_MS, KEY_RE, FILE_RE, RESERVED_KEYS, RESERVED_PREFIXES, FORBIDDEN_SIGNALS,
  PRESENCE_ENV_KEYS, normalizePresenceEnv, isValidKey, confirmedCloseMs, hasConfirmedClose, caseVariantConflict,
  isTruthyEnv, deriveSessionKey, detectOutermostAgent, suppressionReason,
  selectPrunable, countOtherSessions, hostRelation,
};
