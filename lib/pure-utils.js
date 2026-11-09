'use strict';

 
function _parseEnvKeys(text) {
  const out = new Set();
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=/i);
    if (m) out.add(m[1]);
  }
  return out;
}

 
 
const SAFE_MODEL_IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
function isValidModelIdentifier(value) {
  const raw = String(value == null ? '' : value);
  const visible = stripDefaultIgnorables(raw, { nfkc: true, visibleIdentity: true })
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '')
    .trim();
  return raw === visible && SAFE_MODEL_IDENTIFIER_RE.test(visible);
}

 
 
 

 
function _isSecretKey(k) {
   
   
   
  const canonical = stripDefaultIgnorables(k, { nfkc: true, visibleIdentity: true });
  return /TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE/i.test(canonical);
}

 
 
 
const _SECRET_ASSIGN = /\b([A-Za-z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH)[A-Za-z0-9_]*)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi;
// T-0084: an empty value holds nothing to hide, a true/false/null flag on an AUTH or KEY name is a setting,
// and a name whose only secret word is KEY (idempotency_key, sort_key) keeps a value that does not look
// secret. Password, secret, token and credential names stay masked whatever the value.
const _SECRET_ASSIGN_ALWAYS = /TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL/i;
const _SECRET_ASSIGN_STRONG = /TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH|PRIVATE|API_?KEY|ACCESS_?KEY/i;
function _keepAssignedValue(name, raw) {
  const value = raw.length >= 2 && /^(["']).*\1$/s.test(raw) ? raw.slice(1, -1) : raw;
  if (!value.trim()) return true;
  if (_SECRET_ASSIGN_ALWAYS.test(name)) return false;
  if (/^(?:true|false|null|none|undefined)$/i.test(value)) return true;
  return !_SECRET_ASSIGN_STRONG.test(name) && !_looksSecretLike(value);
}
 
 
 
 
 
 
 
 
 
const _SECRET_AUTH_HEADER = /\b((?:proxy-)?authorization)([ \t]*[:=][ \t]*)(?:(Bearer|Basic|Token|ApiKey|Digest)([ \t]+))?([A-Za-z0-9._~+/-]+=*)/gi;
const _SECRET_SHAPE = /\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|ghs_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,}|ASIA[0-9A-Z]{12,}|AIza[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g;
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
const _PEM_HDR = '(?:Proc-Type|DEK-Info|Comment|Subject|Originator|Version|MessageID|Charset|X-[A-Za-z0-9-]+):[^\\r\\n]*';
 
const _PEM_BODY = '(?!-----)\\S+(?=[ \\t]*(?:\\r?\\n|$))';
 
 
 
 
 
 
 
 
 
 
const _CRED_MARKERS = [
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/,
   
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{2,}/,
   
  /\bbearer\b[^A-Za-z0-9\r\n]{0,4}[A-Za-z0-9_\-.=+/~]{16,}/i,
  /\b(?:proxy-)?authorization[ \t]*[:=]/i,
  /\b(?:set-)?cookie[ \t]*[:=]/i,
  /\b(?:gh[pousr]_|github_pat_|sk-|sk_live_|rk_live_|xox[baprs]-|xapp-|AKIA|ASIA|AIza|ya29\.|glpat-|npm_|SG\.)/,
  /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/@]+:[^@\s/]+@/i,
];
function hasCredentialMarker(s) {
  const t = String(s == null ? '' : s);
  return _CRED_MARKERS.some(re => re.test(t));
}

 
 
 
 
const _SECRET_BEARER = /\bBearer\s+[A-Za-z0-9_\-.=+/]{20,}/g;
const _SECRET_PEM = new RegExp('-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----(?:[ \\t]*\\r?\\n[ \\t]*(?:' + _PEM_HDR + '|' + _PEM_BODY + ')?)*[ \\t]*\\r?\\n[ \\t]*-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----', 'g');
 
 
 
 
 
const _SECRET_PEM_OPEN = new RegExp('-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----(?:[ \\t]*\\r?\\n[ \\t]*' + _PEM_HDR + ')*(?:[ \\t]*\\r?\\n[ \\t]*)*(?:[ \\t]*\\r?\\n[ \\t]*(?:' + _PEM_BODY + '))+[ \\t]*\\r?\\n?', 'g');

 
 
 
 
 
 
 
 
 
 
 
const _REDACT_SKIP = new Set();
const _REDACT_TAIL = {
  'AWS Secret Access Key (context)': /(["']?)([A-Za-z0-9/+]{40})(["']?)$/,
};
 
 
 
 
 
const _REDACT_GUARD = {};
let _SECRET_CATALOG = null;
function _secretCatalog() {
  if (_SECRET_CATALOG) return _SECRET_CATALOG;
  try { _SECRET_CATALOG = require('./catalogs').SECRET_PATTERNS || []; } catch { _SECRET_CATALOG = []; }
  return _SECRET_CATALOG;
}
function redactSecrets(s, max) {
  let out = String(s == null ? '' : s)
    .replace(_SECRET_AUTH_HEADER, (m, key, sep, scheme, gap) => `${key}${sep}${scheme ? scheme + (gap || ' ') : ''}***`)
    .replace(_SECRET_ASSIGN, (m, k, v) => _keepAssignedValue(k, v) ? m : `${k}=***`)
    .replace(_SECRET_SHAPE, '***')
    .replace(_SECRET_PEM, '***')
    .replace(_SECRET_PEM_OPEN, '***\n')
    .replace(_SECRET_BEARER, '***');
  for (const p of _secretCatalog()) {
    const { re, valueGroup, requireSecretLike } = p;
    if (!re || _REDACT_SKIP.has(p.name)) continue;
    const guard = _REDACT_GUARD[p.name];
    try {
      out = out.replace(re, (...args) => {
        const m0 = args[0];
        const val = (valueGroup != null) ? args[valueGroup] : m0;
        if (!val) return m0;
        if (guard && !guard(m0)) return m0;                                          
        const tailRe = _REDACT_TAIL[p.name];                                         
        if (tailRe) { const t = m0.match(tailRe); return t ? m0.slice(0, m0.length - t[0].length) + t[1] + '***' + t[3] : m0; }
        if (_isPlaceholderSecret(val)) return m0;                                    
        if (valueGroup != null && requireSecretLike && !_looksSecretLike(val)) return m0;
        if (valueGroup == null) return '***';
        const i = m0.indexOf(val);                                                   
        return i < 0 ? '***' : m0.slice(0, i) + '***' + m0.slice(i + val.length);
      });
    } catch {   }
  }
  if (max && out.length > max) out = out.slice(0, max) + '…';
  return out;
}

 
function compareVer(a, b) {
  const A = String(a || '0'), B = String(b || '0');
  const sa = A.split('-')[0].split('.').map(n => parseInt(n || '0', 10));
  const sb = B.split('-')[0].split('.').map(n => parseInt(n || '0', 10));
  for (let i = 0; i < 3; i++) {
    const x = sa[i] || 0, y = sb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
   
  const preA = A.includes('-'), preB = B.includes('-');
  if (preA && !preB) return -1;
  if (!preA && preB) return 1;
   
  if (preA && preB) {
    const pa = A.slice(A.indexOf('-') + 1).split('.'), pb = B.slice(B.indexOf('-') + 1).split('.');
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i], y = pb[i];
      if (x === undefined) return -1;    
      if (y === undefined) return 1;
      const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      if (nx && ny) { const d = parseInt(x, 10) - parseInt(y, 10); if (d) return d > 0 ? 1 : -1; }
      else if (nx !== ny) return nx ? -1 : 1;    
      else if (x !== y) return x > y ? 1 : -1;
    }
  }
  return 0;
}

 
 
function parseHarnessVersion(text) {
  const t = String(text || '').trim();
  const legacy = t.match(/^leerness@(\d+\.\d+\.\d+)(?:\+plus@(\d+\.\d+\.\d+))?$/);
  const bare = t.match(/^(\d+\.\d+\.\d+)$/);
  return {
    plus: legacy && legacy[2] ? legacy[2] : null,
    base: legacy ? legacy[1] : (bare ? bare[1] : null),
    raw: t || '(not installed)'
  };
}

 
function _classifyCJK(buf, len) {
  let korean = 0, japanese = 0, chinese = 0, other = 0, han = 0;
  for (let i = 0; i < Math.min(buf.length, len); i++) {
    const b = buf[i];
    if (b < 0x80) continue;
    if (b >= 0xEA && b <= 0xED) korean++;
    else if (b === 0xE3) japanese++;           
    else if (b >= 0xE4 && b <= 0xE9) han++;     
    else other++;
  }
   
  if (japanese > 0) japanese += han; else chinese += han;
  return { korean, japanese, chinese, other };
}

 
function _riskLabel(cjk) {
  if (cjk.korean >= cjk.japanese && cjk.korean >= cjk.chinese && cjk.korean > 0) {
    return { type: 'korean', risk: 'Windows 한국어 PowerShell 에서 CP949 로 오인식 가능 (BOM 추가 권장)' };
  }
  if (cjk.japanese > cjk.korean && cjk.japanese >= cjk.chinese) {
    return { type: 'japanese', risk: 'Windows 일본어 PowerShell 에서 CP932 (Shift-JIS) 로 오인식 가능 (BOM 추가 권장)' };
  }
  if (cjk.chinese > 0) {
    return { type: 'chinese', risk: 'Windows 중국어 PowerShell 에서 CP936 (GBK) 로 오인식 가능 (BOM 추가 권장)' };
  }
  return { type: 'non-ascii', risk: 'Windows 비-ASCII 셸 스크립트 — BOM 없는 UTF-8 인코딩 오인식 가능 (BOM 추가 권장)' };
}

 
function _detectSystemLang(env) {
  env = env || process.env;
  const raw = String(env.LC_ALL || env.LC_CTYPE || env.LANG || env.LANGUAGE || '').toLowerCase();
  if (raw && raw !== 'c' && raw !== 'posix') {
    if (/(^|[^a-z])ko([_\-.]|$)|korean|[_-]kr([_\-.]|$)/.test(raw)) return 'ko';
    if (/(^|[^a-z])en([_\-.]|$)|english|[_-](us|gb)([_\-.]|$)/.test(raw)) return 'en';
  }
  try {
    const loc = (Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase();
    const primary = loc.split('-')[0];
    if (primary === 'ko') return 'ko';
    if (primary === 'en') return 'en';
  } catch {}
  return null;
}

 
function _parseSlashFromHelp(text, invoke = 'slash') {
  const out = [];
  const seen = new Set();
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const ln = raw.replace(/\x1b\[[0-9;]*m/g, '');  
    if (invoke === 'subcommand') {
      const m = ln.match(/^\s{2,}([a-z][a-z0-9][\w-]*)\s{2,}(\S.*)$/);
      if (m && !/^--/.test(m[1])) {
        const cmd = m[1];
        if (!seen.has(cmd) && cmd.length <= 24) { seen.add(cmd); out.push({ cmd, desc: m[2].trim().slice(0, 80) }); }
      }
      continue;
    }
    const m = ln.match(/^\s*(\/[a-zA-Z][\w-]*)(?:\s+[-–:]?\s*(.*))?$/);
    if (m) {
      const cmd = m[1];
      if (!seen.has(cmd) && cmd.length <= 24) { seen.add(cmd); out.push({ cmd, desc: (m[2] || '').trim().slice(0, 80) }); }
    }
  }
  return out;
}

 
const PERMISSION_TIERS = ['read-only', 'safe-write', 'project-write', 'shell-read', 'shell-write', 'git-write', 'network', 'publish'];
function _tierRank(t) { const i = PERMISSION_TIERS.indexOf(String(t || '')); return i < 0 ? PERMISSION_TIERS.length : i; }
 
 
 
function _isLiteralInspectionText(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1] || '';
    if (/[\r\n]/.test(ch)) return false;
    if (quote) {
      if (ch === quote) quote = null;
      else if (quote === '"' && (ch === '`' || (ch === '$' && /[a-z0-9_{(]/i.test(next))
        || (ch === '\\' && next === '"'))) return false;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (/[;&|<>()$`^]/.test(ch) || (ch === '\\' && /["']/.test(next))) return false;
  }
  return quote === null && !/%[^%\r\n]+%/.test(text);
}
 
function _requiredTier(cmd) {
  const c = String(cmd || '').toLowerCase();
  const memoryMigrationWrite = /^\s*(?:(?:npx(?:\s+(?:-y|--yes))?\s+)?leerness(?:@[^\s]+)?\s+)?memory-migration\s+(?:prepare|apply|rollback)(?:\s|$)/.test(c);
  if (memoryMigrationWrite && _isLiteralInspectionText(c)) return 'project-write';
   
   
   
  const leaseCommand = c.match(/^\s*(?:(?:npx(?:\s+(?:-y|--yes))?\s+)?leerness(?:@[^\s]+)?\s+)?lease\s+(list|check|acquire|release)(?:\s|$)/);
  if (leaseCommand && (leaseCommand[1] === 'list' || leaseCommand[1] === 'check')) return 'read-only';
  if (leaseCommand) return 'safe-write';
   
  if (/^\s*(?:(?:npx(?:\s+(?:-y|--yes))?\s+)?leerness(?:@[^\s]+)?\s+)?state\s+inspect(?:\s|$)/.test(c)
    && _isLiteralInspectionText(c)) return 'read-only';
  if (/release\s+publish|npm\s+publish|\bpublish\b/.test(c)) return 'publish';
  if (/\bweb\b/.test(c)) return 'network';
  if (/git\s+push|sync-main/.test(c)) return 'git-write';
  if (/multi\s+--execute|dispatch\s+--write|--yolo|\bpc\b/.test(c)) return 'shell-write';
  if (/agents\s+(list|quota|bench)|--run-tests/.test(c)) return 'shell-read';
  if (memoryMigrationWrite) return 'project-write';
  if (/\binit\b|\badapter\b|update\s+--yes|\bmigrate\b/.test(c)) return 'project-write';
  if (/state\s+(start|record|verify|handoff)|decision|lesson|plan\s+add|task\s+add|rule\s+add|lease\s+(acquire|release)/.test(c)) return 'safe-write';
  return 'read-only';
}
function _policyAllows(allowedTier, requiredTier) { return _tierRank(requiredTier) <= _tierRank(allowedTier); }

 
function _resolveNpmTag(explicit, env) {
  env = env || process.env;
  const raw = String(explicit || env.LEERNESS_NPM_TAG || 'latest').trim().toLowerCase();
  return /^[a-z][a-z0-9-]{0,38}$/.test(raw) ? raw : 'latest';
}

 
function _mcpJsonContent() {
   
   
  return JSON.stringify({ mcpServers: { leerness: { command: 'npx', args: ['-y', 'leerness', 'mcp', 'serve'] } } }, null, 2) + '\n';
}

 
function _newRunRecord(opts = {}) {
  return {
    schemaVersion: 1,
    run_id: opts.run_id || null,
    task_id: opts.task_id || null,
    agent_name: opts.agent_name || null,
    model_name: opts.model_name || null,
    started_at: opts.started_at || new Date().toISOString(),
    ended_at: opts.ended_at || null,
    goal: opts.goal || '',
    files_read: Array.isArray(opts.files_read) ? opts.files_read : [],
    files_changed: Array.isArray(opts.files_changed) ? opts.files_changed : [],
    commands_run: Array.isArray(opts.commands_run) ? opts.commands_run : [],
    tests_run: Array.isArray(opts.tests_run) ? opts.tests_run : [],
    errors: Array.isArray(opts.errors) ? opts.errors : [],
    decisions: Array.isArray(opts.decisions) ? opts.decisions : [],
    verification_result: opts.verification_result || null,
    handoff_summary: opts.handoff_summary || null,
    status: opts.status || 'in-progress'
  };
}

 
 
 
function _completionClaimAllowed(rec) {
  const r = rec || {};
  const A = (x) => (Array.isArray(x) ? x : []);
  const reasons = [];
  if (A(r.files_changed).length === 0) reasons.push('no_files_changed');
  if (A(r.tests_run).length === 0 && A(r.commands_run).length === 0) reasons.push('no_verification_run');
  if (A(r.errors).length > 0) reasons.push('unresolved_errors');
  const vr = String(r.verification_result || '').toLowerCase();
  if (vr === 'fail') reasons.push('verification_failed');
  else if (vr !== 'pass') reasons.push('not_verified');
  return { allowed: reasons.length === 0, reasons };
}

 
function _htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|h[1-6]|tr|td|pre)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}
function _extractTitle(html) {
  const m = (html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  return _htmlToText(m[1]).slice(0, 200);
}
function _extractLinks(html, baseUrl, maxLinks) {
  if (!html) return [];
  const base = new URL(baseUrl);
  const found = new Map();
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
    let abs;
    try { abs = new URL(href, baseUrl).toString(); } catch { continue; }
    const u = new URL(abs);
    if (u.hostname !== base.hostname) continue;  
    if (abs === baseUrl) continue;
    if (found.has(abs)) continue;
    const text = _htmlToText(m[2]).slice(0, 120);
    found.set(abs, { url: abs, text });
    if (found.size >= (maxLinks || 10)) break;
  }
  return Array.from(found.values());
}

 
 
function _countDatedBlocks(text) {
  const cleaned = _stripDecisionFences(text);   
  return (cleaned.match(/^### \d{4}-\d{2}-\d{2}/gm) || []).length;
}
 
 
const _LINE_TERMINATORS = '\n\r' + String.fromCharCode(0x2028, 0x2029);
 
 
 
 
 
 
 
function _fenceRanges(s, closingEnd) {
  const closes = [];
  for (let k = s.indexOf('\n```'); k >= 0; k = s.indexOf('\n```', k + 1)) { const end = closingEnd(s, k); if (end >= 0) closes.push([k, end]); }
  const ranges = [];
  let c = 0;
  for (let i = s.indexOf('```'); i >= 0; ) {
    if (i > 0 && !_LINE_TERMINATORS.includes(s[i - 1])) { i = s.indexOf('```', i + 1); continue; }
    const j = s.indexOf('\n', i + 3);
    if (j < 0) break;
    while (c < closes.length && closes[c][0] < j + 1) c++;
    if (c >= closes.length) break;
    const end = closes[c][1];
    ranges.push([i, end]);
    i = s.indexOf('```', end);
  }
  return ranges;
}
 
 
function _fenceEndAnyWhiteSpace(s, k) {
  let i = k + 4, end = -1;
  for (; i < s.length && /\s/.test(s[i]); i++) if (_LINE_TERMINATORS.includes(s[i])) end = i;
  return i === s.length ? s.length : end;
}
 
function _fenceEndSpacesTabs(s, k) {
  let i = k + 4;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
  return i === s.length || _LINE_TERMINATORS.includes(s[i]) ? i : -1;
}
function _stripDecisionFences(text) {
  const s = String(text || '');
  let out = '', at = 0;
  for (const [start, end] of _fenceRanges(s, _fenceEndAnyWhiteSpace)) { out += s.slice(at, start); at = end; }
  return at === 0 ? s : out + s.slice(at);
}
 
 
function _extractDecisionBlocks(text, { templates = false } = {}) {
  const cleaned = _stripDecisionFences(text);
  return cleaned.split(/\n(?=### )/).filter(b =>
    b.startsWith('### ') && (templates || !/^### (Template|템플릿)\b/.test(b.trim()))
  );
}

 
 
 
 
 
 
 
function _decisionBlocksWithOffset(text) {
  const raw = String(text || '');
  let masked = '', at = 0;
  for (const [start, end] of _fenceRanges(raw, _fenceEndSpacesTabs)) { masked += raw.slice(at, start) + raw.slice(start, end).replace(/[^\n]/g, ' '); at = end; }
  masked = at === 0 ? raw : masked + raw.slice(at);
  return _blocksWithOffset(masked, /\n(?=### )/)
    .filter(x => x.block.startsWith('### ') && !/^### (Template|템플릿)\b/.test(x.block.trim()));
}

 
function _classifyIntent(text) {
  if (!text || typeof text !== 'string') return { intent: 'default', signals: [] };
  const signals = [];
   
  const preciseKws = ['정확히', '그것만', '그대로', 'only', 'just only', '말한대로', '말한 그대로'];
  for (const kw of preciseKws) {
    if (text.toLowerCase().includes(kw.toLowerCase())) signals.push({ kind: 'precise', match: kw });
  }
   
  const broadKws = ['기본', '포괄적', '등등', '다양한', '전체', '기본적인', 'etc', 'overall', '필요한', '관련', 'comprehensive', 'including'];
  for (const kw of broadKws) {
    if (text.toLowerCase().includes(kw.toLowerCase())) signals.push({ kind: 'broad', match: kw });
  }
  const preciseCount = signals.filter(s => s.kind === 'precise').length;
  const broadCount = signals.filter(s => s.kind === 'broad').length;
  let intent;
  if (preciseCount > broadCount && preciseCount >= 1) intent = 'precise';
  else if (broadCount >= 1) intent = 'broad';
  else intent = 'default';
  return { intent, signals, preciseCount, broadCount };
}

 
 
function _sanitizeFences(s) { return String(s || '').replace(/```+/g, "'''"); }
 
 
 
function _shellQuoteArg(s) {
  s = String(s == null ? '' : s);
  if (process.platform === 'win32') {
    if (/[\u0000-\u001f\u007f%!\"]/.test(s)) {
      throw new TypeError('Windows shell argument contains expansion or quote/control characters');
    }
    return '"' + s.replace(/(\\+)$/, '$1$1') + '"';
  }
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
 
function _detectPwshFromEnv(e) {
  e = e || process.env;
  const channel = e.POWERSHELL_DISTRIBUTION_CHANNEL || '';
  const pmp = e.PSModulePath || '';
  if (channel || /[\\/]PowerShell[\\/][67][\\/]/i.test(pmp) || /Documents[\\/]+PowerShell[\\/]/i.test(pmp)) {
    return { isPowerShell: true, version: '7', edition: 'Core' };
  }
  return { isPowerShell: false, version: null, edition: null };
}

 
function _getLocalTz() {
  if (process.env.LEERNESS_TZ) return process.env.LEERNESS_TZ;
  try {
    const sys = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (sys && sys !== 'UTC') return sys;
  } catch {}
  return 'Asia/Seoul';
}
function _formatLocal(iso, opts) {
  if (!iso) return '?';
  opts = opts || {};
  const tz = opts.tz || _getLocalTz();
  try {
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    if (isNaN(d.getTime())) return String(iso);
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false
    });
    const parts = fmt.formatToParts(d);
    const get = (t) => (parts.find(p => p.type === t) || {}).value || '';
    const date = `${get('year')}-${get('month')}-${get('day')}`;
    const time = `${get('hour')}:${get('minute')}`;
    const tzShort = tz === 'Asia/Seoul' ? 'KST' : tz === 'Asia/Tokyo' ? 'JST' : tz === 'UTC' ? 'UTC' : tz.split('/').pop().slice(0, 3);
    return opts.dateOnly ? date : `${date} ${time} ${tzShort}`;
  } catch { return String(iso); }
}

 
function _truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function _splitList(v) { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }

 
function _roadmapMapStatus(s) {
  s = String(s || '').toLowerCase();
  if (s === 'done' || s === 'in-progress' || s === 'on-hold' || s === 'waiting' || s === 'incomplete' || s === 'blocked' || s === 'dropped') return s;
  if (s === 'planned' || s === 'requested') return 'planned';
  return 'planned';
}
function _roadmapParseMilestones(text) {
  const s = String(text || '');
  const out = [];
   
  const matches = [...s.matchAll(/^### (M-\d{4,})\.[ \t]*(.+?)$/gm)];   
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].index : s.length;
    const block = s.slice(m.index, end);
    const sm = block.match(/^Status:\s*(\S+)/m);
    const pm = block.match(/^Progress:\s*(\d+)%/m);
    out.push({ id: m[1], title: m[2].trim(), status: sm ? sm[1] : 'planned', progress: pm ? parseInt(pm[1], 10) : 0 });
  }
  return out;
}
function _roadmapParseTokens(text) {
  const tokens = {};
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\|\s*([\w.\-]+)\s*\|\s*([^|]+?)\s*\|/);
    if (!m) continue;
    const key = m[1].trim(), val = m[2].trim();
    if (!key || !val || key === 'Token' || /^-+$/.test(key) || val === 'Value' || /\(실제 값으로 업데이트\)|\(update with real value\)/i.test(val)) continue;    
    if (val.length > 80) continue;
    tokens[key] = val;
  }
  return tokens;
}

 
const _BRIEF_FIELDS = [
  { key: 'intro', h: 'Intro', label: '소개', flag: 'intro', multi: false },
  { key: 'purpose', h: 'Purpose', label: '목적', flag: 'purpose', multi: false },
  { key: 'problem', h: 'Problem', label: '해결 문제', flag: 'problem', multi: false },
  { key: 'features', h: 'Features', label: '핵심 기능', flag: 'features', multi: true },
  { key: 'stack', h: 'Tech Stack', label: '기술 스택', flag: 'stack', multi: true },
  { key: 'architecture', h: 'Architecture', label: '아키텍처', flag: 'architecture', multi: false },
  { key: 'users', h: 'Users', label: '사용자', flag: 'users', multi: true },
  { key: 'success', h: 'Success Criteria', label: '성공 기준', flag: 'success', multi: true },
  { key: 'nonGoals', h: 'Non-Goals', label: '비목표', flag: 'non-goals', multi: true },
  { key: 'currentState', h: 'Current State', label: '현재 상태', flag: 'current-state', multi: false },
];
function _briefFilled(brief) { return _BRIEF_FIELDS.filter(f => (f.multi ? (brief[f.key] && brief[f.key].length) : brief[f.key])).length; }
 
const BRIEF_START = '<!-- leerness:project-brief:start -->';
const BRIEF_END = '<!-- leerness:project-brief:end -->';
function _briefReadmeBlock(brief) {
  const L = [BRIEF_START, '## 프로젝트 개요', ''];
  if (brief.intro) L.push(brief.intro, '');
  if (brief.purpose) L.push(`**목적**: ${brief.purpose}`, '');
  if (brief.problem) L.push(`**해결 문제**: ${brief.problem}`, '');
  if (brief.features && brief.features.length) { L.push('**핵심 기능**'); brief.features.forEach(x => L.push(`- ${x}`)); L.push(''); }
  if (brief.stack && brief.stack.length) L.push(`**기술 스택**: ${brief.stack.join(', ')}`, '');
  if (brief.directionHistory && brief.directionHistory.length) { L.push('**최근 개발 방향 변경**'); brief.directionHistory.slice(-3).forEach(x => L.push(`- ${x}`)); L.push(''); }
  if (_briefFilled(brief) === 0) L.push('_아직 개요 미입력 — `leerness brief set --intro "..." --purpose "..."` 로 작성._', '');
  L.push('<sub>이 섹션은 `leerness brief` 로 관리됩니다. 전체 청사진(복사용): `leerness brief export`.</sub>', BRIEF_END);
  return L.join('\n');
}
function _briefBlueprint(brief, version) {
  const L = [`# ${brief.project} — 프로젝트 청사진 (Blueprint)`,
    `> 이 문서만으로 프로젝트를 기초부터 재구성할 수 있도록 작성. \`leerness brief export\` 생성 (leerness v${version || '?'}).`, ''];
  const sec = (h, v, multi) => { if (multi ? (v && v.length) : v) { L.push(`## ${h}`, multi ? v.map(x => `- ${x}`).join('\n') : v, ''); } };
  sec('소개 (Intro)', brief.intro); sec('목적 (Purpose)', brief.purpose); sec('해결 문제 (Problem)', brief.problem);
  sec('핵심 기능 (Features)', brief.features, true); sec('기술 스택 (Tech Stack)', brief.stack, true);
  sec('아키텍처 (Architecture)', brief.architecture); sec('사용자 (Users)', brief.users, true);
  sec('성공 기준 (Success Criteria)', brief.success, true); sec('비목표 (Non-Goals)', brief.nonGoals, true);
  sec('현재 상태 (Current State)', brief.currentState);
  sec('개발 방향 이력 (Direction History)', brief.directionHistory, true);
  L.push('---', '## 신규 프로젝트 시작 가이드', '', '1. 위 소개·목적·기능·아키텍처·스택을 신규 레포의 계획으로 복사.', '2. `leerness init .` 후 이 파일을 `.leerness/project-brief.md` 로 복사하거나 `leerness brief set` 으로 재입력.', '3. Features 를 `leerness plan add` / `leerness task add` 로 분해.', '');
  return L.join('\n');
}

 
 
 
 
 
 
 
function _blocksWithOffset(text, sep) {
  const out = [];
  let pos = 0, line = 1;
  for (const block of String(text || '').split(sep)) {
    out.push({ block, offset: pos, line });
     
    line += (block.match(/\n/g) || []).length + 1;
    pos += block.length + 1;
  }
  return out;
}
 
function _lineOfOffset(text, offset) {
  if (!(offset >= 0)) return 0;
  return String(text || '').slice(0, offset).split('\n').length;
}

 
function _parseLessonEntries(text) {
  const out = [];
  for (const block of String(text || '').split(/\n(?=### )/)) {
    if (!block.startsWith('### ')) continue;
    const dateMatch = block.match(/^### (\d{4}-\d{2}-\d{2}[^\n]*)/);
    const lessonMatch = block.match(/- Lesson:[ \t]*(.+)/);
    const tagMatch = block.match(/- Tag:[ \t]*(.+)/);
    if (!lessonMatch) continue;
    out.push({ date: dateMatch ? dateMatch[1].trim() : null, text: lessonMatch[1].trim(), tag: tagMatch ? tagMatch[1].trim() : null });
  }
  return out;
}

 
function _renderLessonsMd(lessons, lang = 'ko') {
  const preamble = _memoryPreamble('lessons', lang);
  const body = (lessons || []).map(l =>
     
    `\n### ${_lineSafe(l.date)}\n- Lesson: ${_lineSafe(l.text)}\n${l.tag ? `- Tag: ${_lineSafe(l.tag)}\n` : ''}`
  ).join('');
  return preamble + body;
}

 
function _withBuiltinSource(catalog) {
  const out = {};
  for (const [k, v] of Object.entries(catalog || {})) out[k] = { ...v, _source: 'builtin' };
  return out;
}

 
function _esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

 
function _roadmapTokenStyles(designTokens, cssVariables) {
  const dt = designTokens || {}, cv = cssVariables || {};
  const vars = {};
  const map = [
    ['color.primary', 'color-primary', 'lr-primary'], ['color.surface', 'color-surface', 'lr-surface'],
    ['color.text', 'color-text', 'lr-text'], ['color.muted', 'color-muted', 'lr-muted'],
    ['space.1', 'space-1', 'lr-space-1'], ['space.2', 'space-2', 'lr-space-2'],
    ['space.3', 'space-3', 'lr-space-3'], ['space.4', 'space-4', 'lr-space-4'],
    ['radius', 'radius', 'lr-radius']
  ];
  for (const [ds, css, vn] of map) { const v = cv[css] || dt[ds]; if (v) vars[vn] = v; }
  for (const [k, v] of Object.entries(cv)) if (!vars[`lr-${k}`]) vars[`lr-${k}`] = v;
  if (!vars['lr-card-bg']) vars['lr-card-bg'] = vars['lr-surface'] || '#ffffff';
  if (!vars['lr-edge']) vars['lr-edge'] = vars['lr-muted'] || '#cbd5e1';
  if (!vars['lr-page-bg']) vars['lr-page-bg'] = '#f8fafc';
   
  const _safeCss = v => String(v == null ? '' : v).replace(/[^#a-zA-Z0-9(),.%\s_-]/g, '').slice(0, 80);
  return ':root {\n' + Object.entries(vars).map(([k, v]) => `    --${k}: ${_safeCss(v)};`).join('\n') + '\n  }';
}

 
function _parseSkillMd(text) {
   
   
  const cleaned = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');   
  const m = cleaned.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: cleaned };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const km = line.match(/^([a-zA-Z_-]+):\s*(.+)$/);
    if (km) meta[km[1].trim()] = km[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2] };
}

 
 
 
 
 
 
 
function _lintSkillMeta(meta, body, opts = {}) {
  const errors = [], warnings = [], infos = [];
  const m = meta || {};
  const b = String(body || '');
  const name = String(m.name || '').trim();
  const desc = String(m.description || '').trim();
   
  if (!name) errors.push({ code: 'name_missing', msg: 'frontmatter name 필수' });
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) errors.push({ code: 'name_charset', msg: `name 은 소문자/숫자/하이픈만: "${name}"` });
  if (!desc) errors.push({ code: 'description_missing', msg: 'frontmatter description 필수 — 에이전트가 "지금 로드할까"를 판단하는 유일한 신호' });
  else if (desc.length > 1024) errors.push({ code: 'description_too_long', msg: `description ${desc.length}자 > 1024 (트리거 조건만 담을 것)` });
   
  if (desc && name && desc.toLowerCase() === name.toLowerCase()) warnings.push({ code: 'description_repeats_name', msg: 'description 이 name 반복 — 트리거 조건이 없음' });
  if (desc && desc.length < 40) warnings.push({ code: 'description_too_short', msg: `description ${desc.length}자 < 40 — 표시명 합성 흔적("~스킬" 류)일 가능성` });
  if (desc && /^[^,]+(, [^,]+){2,}$/.test(desc) && !/(사용|때|Use when|use this)/i.test(desc)) warnings.push({ code: 'description_capability_list', msg: 'description 이 capabilities 나열 형태 — 트리거 조건으로 재작성 권장' });
   
  const hasTrigger = /Use (when|this when|for)\b/i.test(desc) || /(할|일|하는|이런)\s*(때|경우)에?\s*사용|언제\s*사용|때\s*사용/.test(desc);
  if (desc && !hasTrigger) infos.push({ code: 'no_trigger_clause', msg: '트리거절 없음 — "~할 때 사용" / "Use when …" 형태 권장' });
   
  const cjkChars = (b.match(/[ㄱ-힝一-鿿぀-ヿ]/g) || []).length;
  const totalChars = b.replace(/\s/g, '').length;
  const isCjk = totalChars > 0 && cjkChars / totalChars >= 0.3;
  const wordCount = b.split(/\s+/).filter(Boolean).length;
  const charCount = b.length;
  if (isCjk) { if (charCount > 12000) infos.push({ code: 'body_budget', msg: `본문 ${charCount}자 (CJK 기준 12000자 초과) — 자주 로드되는 스킬이면 분할 권장` }); }
  else if (wordCount > 5000) infos.push({ code: 'body_budget', msg: `본문 ${wordCount}단어 (5000 초과) — 분할 권장` });
  return { errors, warnings, infos, wordCount, charCount, lang: isCjk ? 'cjk' : 'latin' };
}

 
 
function _matchConstraints(catalog, text, lang) {
  if (!text || typeof text !== 'string' || !catalog || !catalog.platforms) return { matched: [], suggestions: [] };
  const lower = text.toLowerCase();
  const matched = [];
  for (const [pid, plat] of Object.entries(catalog.platforms)) {
    const aliases = plat.aliases || [];
    const hit = aliases.find(a => lower.includes(a.toLowerCase()));
    if (hit) matched.push({ platform: pid, matchedAlias: hit, docs: plat.docs, constraints: plat.constraints });
  }
  const suggestions = [];
  const generic = /\bapi\b|연동|integration|호출|rate|limit|quota|webhook/i.test(text);
  if (generic && matched.length === 0) {
    suggestions.push(lang === 'en'
      ? 'generic API-integration keywords detected — run leerness constraints list to review the pre-registered platform catalog'
      : '일반적 API 연동 키워드 감지 — leerness constraints list 로 사전 등록된 플랫폼 catalog 확인 권장');
  }
  return { matched, suggestions, totalPlatforms: Object.keys(catalog.platforms).length };
}

 
 
function _aliasHit(lowerText, alias) {
  const a = String(alias || '').toLowerCase();
  if (!a) return false;
  if (/^[a-z0-9]+$/.test(a)) return new RegExp('(?:^|[^a-z0-9])' + a + '(?![a-z0-9])').test(lowerText);
  return lowerText.includes(a);
}

 
function _matchDomain(catalog, text) {
  if (!text || typeof text !== 'string' || !catalog || !catalog.domains) return { domain: null, alias: null };
  const lower = text.toLowerCase();
  for (const [domain, info] of Object.entries(catalog.domains)) {
    for (const a of info.aliases || []) {
      if (_aliasHit(lower, a)) {
        return { domain, alias: a, components: info.components };
      }
    }
  }
  return { domain: null, alias: null };
}

 
function _detectLspLang(file) {
  const ext = ((file || '').match(/\.[a-zA-Z0-9]+$/) || [''])[0].toLowerCase();
  if (/^\.(py|pyw|pyi)$/.test(ext)) return 'python';
  if (ext === '.go') return 'go';
  if (ext === '.rs') return 'rust';
  if (/^\.(java|kt|scala)$/.test(ext)) return 'java';
  if (/^\.(ts|tsx|js|jsx|mjs|cjs)$/.test(ext)) return 'javascript';
  return 'javascript';   
}

 
 
function _matchLspSymbols(catalog, content, lang) {
  const symbols = [];
  if (!catalog || typeof content !== 'string') return symbols;
  const lines = content.split(/\r?\n/);
  const patterns = catalog[lang || 'javascript'] || catalog.javascript || [];
  lines.forEach((line, idx) => {
    for (const p of patterns) {
      const m = line.match(p.re);
       
      if (m && !/^(if|for|while|switch|catch|return|throw|new)$/.test(m[1])) {
        symbols.push({ name: m[1], kind: p.kind, line: idx + 1 });
        break;
      }
    }
  });
  return symbols;
}

 
function _extractUrlClaims(evidence) {
  const claims = [];
   
  const re = /\b(GET|POST|PUT|DELETE|PATCH)\s+(\/[\w\-\/]*)/gi;
  let m;
  while ((m = re.exec(evidence)) !== null) {
    claims.push({ method: m[1].toUpperCase(), path: m[2] });
  }
  return claims;
}
function _verifyUrlClaim(claim, codeText) {
   
  if (!claim.path || claim.path.length < 2) return true;
   
  const escaped = claim.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'i');
  return re.test(codeText);
}

function _detectOptimism(patterns, evidence, codeText) {
   
  const suspects = [];
  if (!Array.isArray(patterns)) return suspects;
  for (const p of patterns) {
    if (p.evidenceRe.test(evidence) && !p.codeRe.test(codeText)) {
      suspects.push({ kind: p.kind, label: p.label, severity: 'high' });
    }
  }
   
  const urlClaims = _extractUrlClaims(evidence);
  for (const claim of urlClaims) {
    if (!_verifyUrlClaim(claim, codeText)) {
      suspects.push({
        kind: 'URL',
        label: `구체 경로 "${claim.method} ${claim.path}" 코드에 미발견`,
        severity: 'medium',
        claim
      });
    }
  }
  return suspects;
}

 
 
function _computeConfidence(patterns, evidence, codeText) {
  if (!Array.isArray(patterns)) return 1.0;
  const suspects = _detectOptimism(patterns, evidence, codeText);
  const high = suspects.filter(s => s.severity === 'high').length;
  const medium = suspects.filter(s => s.severity === 'medium').length;
   
  const totalPenalty = high * 1.0 + medium * 0.5;
   
  const evidenceClaims = patterns.filter(p => p.evidenceRe.test(evidence)).length + _extractUrlClaims(evidence).length;
  if (evidenceClaims === 0) return 1.0;  
  let confidence = Math.max(0, 1 - totalPenalty / evidenceClaims);
   
  if (suspects.length > 0 && high > 0 && confidence < 0.15) {
     
    confidence = 0.15;
  }
  return Math.round(confidence * 100) / 100;
}

 
function _personaSummaries(catalog) {
  return Object.values(catalog || {}).map(p => ({ id: p.id, name: p.name, description: p.description }));
}

 
function _translate(strings, key, lang) {
  const entry = strings && strings[key];
  if (!entry) return key;
  return entry[lang || 'ko'] || entry.ko || key;
}

 
function _parseDecisionBlock(block) {
  const titleMatch = String(block || '').match(/^### (.+)$/m);
  const titleLine = titleMatch ? titleMatch[1].trim() : '';
  const dateTitle = titleLine.match(/^(\d{4}-\d{2}-\d{2})\s*—\s*(.+)$/);
  const g = re => { const m = String(block || '').match(re); const v = m ? m[1].trim() : null; return v || null; };   
  return {
    date: dateTitle ? dateTitle[1] : null,
    title: dateTitle ? dateTitle[2].trim() : titleLine,
    decision: g(/- Decision:[ \t]*(.+)/),
    reason: g(/- Reason:[ \t]*(.+)/),
    alternatives: g(/- Alternatives:[ \t]*(.+)/),
    impact: g(/- Impact:[ \t]*(.+)/)
  };
}

 
function _decisionsFromMd(text, opts) {
  return _extractDecisionBlocks(text, opts).map(_parseDecisionBlock).filter(d => d.title);
}

 
 
 
const MEMORY_PREAMBLES = {
  decisions: {
     
    ko: '# Decisions\n\n## Template (예시 — 실제 결정은 아래 코드블록 밖에 추가)\n\n'
      + '```md\n### YYYY-MM-DD — Decision 제목\n- Decision:\n- Reason:\n- Alternatives:\n- Impact:\n```\n',
    en: '# Decisions\n\n## Template (example — add real decisions below, outside the code block)\n\n'
      + '```md\n### YYYY-MM-DD — Decision title\n- Decision:\n- Reason:\n- Alternatives:\n- Impact:\n```\n',
  },
  lessons: {
    ko: '# Lessons (1.9.112)\n\n과거 실수/통찰/패턴 영구 기록 — handoff 자동 회수와 통합.\n',
    en: '# Lessons (1.9.112)\n\nPermanent record of past mistakes, insights and patterns — handoff recalls them automatically.\n',
  },
};
const _memoryPreamble = (surface, lang) => MEMORY_PREAMBLES[surface][lang === 'en' ? 'en' : 'ko'];
 
const _memoryPreambleLanguages = lang => lang === 'en' ? ['en', 'ko'] : ['ko', 'en'];

 
 
function _taskMatchText(row) {
  return row ? [row.request, _isTrivialNextAction(row.nextAction) ? null : row.nextAction]
    .filter(v => typeof v === 'string' && v.trim()).join(' ') : '';
}
 
 
 
 
function _isTrivialNextAction(value) {
  const text = String(value || '').trim();
  return !text || text === '없음' || /^(?:다음 액션 작성|write the next action)\.?$/i.test(text)
    || /^(-+|n\/?a|none|nil|tbd|todo|wip|x|\.+|\?+)$/i.test(text);
}
 
 
 
 
 
 
 
 
const _DONE_STATUSES = new Set(['done', 'completed', 'verified', '완료']);
function _isDoneStatus(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  const inner = /^\[(.*)\]$/.exec(text);
  return _DONE_STATUSES.has(inner ? inner[1].trim() : text);
}

 
function _renderDecisionsMd(decisions, lang = 'ko') {
  const preamble = _memoryPreamble('decisions', lang);
  const field = (name, value) => {
    const safe = _lineSafe(value || '');
    return `- ${name}:${safe ? ' ' + safe : ''}`;
  };
  const body = (decisions || []).map(d => {
     
     
    const head = d.date ? `${_lineSafe(d.date)} — ${_lineSafe(d.title)}` : _lineSafe(d.title);
    return `\n### ${head}\n${field('Decision', d.decision)}\n${field('Reason', d.reason)}\n${field('Alternatives', d.alternatives)}\n${field('Impact', d.impact)}\n`;
  }).join('');
  return preamble + body;
}

 
 
function _isPlaceholderSecret(value) {
  if (value == null) return true;
  let v = String(value).trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
  if (!v) return true;
   
   
   
  if (/^(?:x{3,}|\*{3,}|\.{3,}|-+|0+|1234567890?|12345678|abc123|secret|password|passwd|pass|changeme|change[-_]me|changeit|replace[-_]?me|placeholder|example|examples?|sample|dummy|test|testing|foo|bar|baz|tbd|todo|none|null|undefined|nil|empty|redacted|hidden|value|string|here|root|admin|user|username|yourpassword|your[-_]?password|mypassword|postgres|postgresql|guest|mysql|mongodb|mongo|redis)$/.test(v)) return true;
   
   
   
  const alnum = v.replace(/[^a-z0-9]/g, '');
  const distinct = new Set(alnum).size;
  const hasMarker = v.includes('example') || v.includes('placeholder') || v.includes('change-me') || v.includes('changeme') || v.includes('replace-me') || v.includes('your-') || v.includes('your_') || v.includes('my-secret') || v.includes('xxxx') || v.includes('<') || v.includes('${') || v.includes('{{');
  const hasRealPrefix = /^(?:sk-|sk-proj-|pk_|rk_|akia|ghp_|gho_|ghs_|ghr_|github_pat_|xox[baprs]-|aiza|ya29\.|glpat-|-----begin)/.test(v);
   
  if (/(.)\1{7,}/.test(alnum)) return true;
   
   
  if (/example$/.test(v)) return true;
   
  if (hasRealPrefix) return false;
  if (hasMarker) return true;
  if (alnum.length >= 24 && distinct >= 12) return false;   
   
   
   
  if (/(?:^|[-_])test(?:s|ing)?(?:[-_]|$)/.test(v)) return true;
  return false;
}
 
 
function _looksSecretLike(value) {
  const v = String(value || '');
  if (!v) return false;
  return (/\d/.test(v) && v.length >= 8) || v.length >= 24;
}

 
function _mergeLines(currentText, lines) {
   
   
  let next = currentText || '';
  const have = new Set(next.split(/\r?\n/).map(l => l.trim()).filter(Boolean));
  for (const line of (lines || [])) {
    const t = String(line).trim();
    if (t && have.has(t)) continue;
    next += (next.endsWith('\n') || !next ? '' : '\n') + line + '\n';
    if (t) have.add(t);
  }
  return next;
}
 
function _mergeEnvLines(currentText, lines) {
  const current = currentText || '';
  const existingKeys = new Set();
  for (const ln of current.split(/\r?\n/)) { const m = ln.match(/^\s*([A-Z][A-Z0-9_]+)\s*=/); if (m) existingKeys.add(m[1]); }
  let next = current;
  for (const line of (lines || [])) {
    const km = line.match(/^\s*([A-Z][A-Z0-9_]+)\s*=/);
    if (km) { if (existingKeys.has(km[1])) continue; next += (next.endsWith('\n') || !next ? '' : '\n') + line + '\n'; existingKeys.add(km[1]); }
    else { if (!next.includes(line)) next += (next.endsWith('\n') || !next ? '' : '\n') + line + '\n'; }
  }
  return next;
}

 
function _mergeReadmeSection(existing, block, START, END) {
   
  block = String(block).trimEnd();
  if (!existing) return `# Project\n\n${block}\n`;
  const s = existing.indexOf(START); const e = existing.indexOf(END);
  if (s >= 0 && e >= s) return existing.slice(0, s).trimEnd() + '\n\n' + block + '\n' + existing.slice(e + END.length).trimStart();
  return existing.trimEnd() + '\n\n' + block + '\n';
}
 
 
 
 
 
const PRESERVED_TAG = '<!-- leerness:migration-preserved -->';
function _managedMerge(file, next, previous, archiveRel, overwriteSet, opts = {}) {
  if (!previous || previous.trim() === next.trim()) return next;
  const tag = PRESERVED_TAG;
  if (overwriteSet && overwriteSet.has(String(file).replace(/\\/g, '/'))) return next;
  const normalizedPrevious = previous.replace(/\r\n/g, '\n');
  let prefixLength = 0;
  for (const template of [next, opts.altTemplate || '']) {
    const prefix = String(template).replace(/\r\n/g, '\n').trimEnd();
    if (prefix && normalizedPrevious.startsWith(prefix)
      && (!normalizedPrevious.slice(prefix.length) || normalizedPrevious[prefix.length] === '\n')) {
      prefixLength = Math.max(prefixLength, prefix.length);
    }
  }
  let rawPrefixLength = 0;
  for (let index = 0; index < prefixLength; index++, rawPrefixLength++) {
    if (previous[rawPrefixLength] === '\r' && previous[rawPrefixLength + 1] === '\n') rawPrefixLength++;
  }
  let carried = previous.slice(rawPrefixLength);
  const wrapper = /^(?:\r?\n)*(?:---[ \t]*\r?\n)?<!-- leerness:migration-preserved -->\r?\n## Preserved previous content\r?\n\r?\n/.exec(carried);
  if (wrapper) {
    const tail = carried.slice(wrapper[0].length), at = tail.indexOf('\n');
    const line = (at < 0 ? tail : tail.slice(0, at)).replace(/\r$/, '');
    const notes = ['> Custom user/project content carried over from the previous version — re-carried automatically on every migration. Full original backup: `',
      '> 이전 버전에서 이어진 사용자/프로젝트 커스텀 내용 — 마이그레이션마다 자동 이월됩니다. 전체 원본 백업: `'];
    if (at >= 0 && notes.some(prefix => line.startsWith(prefix)) && line.endsWith('`')) {
      let body = tail.slice(at + 1);
      const warning = /^> ⚠ \d+ Korean lines were preserved below\. If this project never had Korean customizations, most of these are likely template text from an old Korean install — review and prune manually \(data is also in the backup above\)\. leerness will not auto-delete them: it cannot distinguish old template lines from your own notes with certainty\.\r?\n/.exec(body);
      if (warning) body = body.slice(warning[0].length);
      const separator = /^\r?\n/.exec(body);
      if (separator) carried = body.slice(separator[0].length);
    } else {
      const legacy = /^<details>\r?\n<summary>Previous [^\r\n<]+<\/summary>\r?\n\r?\n```md\r?\n([\s\S]*)\r?\n```\r?\n\r?\n<\/details>\r?\n?$/.exec(tail);
      if (legacy) carried = legacy[1].replace(/\\`\\`\\`/g, '```');
    }
  }
  if (!carried.trim()) return next;
  let ar = archiveRel;
  if (!ar) {
    const prior = /(?:전체 원본 백업|Full original backup):\s*`([^`]+)`/.exec(previous);
    ar = (prior && prior[1]) || '.leerness/archive';
  }
  let note = opts.lang === 'en'
    ? `> Custom user/project content carried over from the previous version — re-carried automatically on every migration. Full original backup: \`${ar}\``
    : `> 이전 버전에서 이어진 사용자/프로젝트 커스텀 내용 — 마이그레이션마다 자동 이월됩니다. 전체 원본 백업: \`${ar}\``;
  if (opts.lang === 'en') {
    const lines = carried.split(/\r?\n/).filter(line => line.trim());
    const hangulLines = lines.filter(line => /[가-힣]/.test(line)).length;
    if (hangulLines >= 10 && hangulLines > lines.length * 0.5) {
      note += `\n> ⚠ ${hangulLines} Korean lines were preserved below. If this project never had Korean customizations, most of these are likely template text from an old Korean install — review and prune manually (data is also in the backup above). leerness will not auto-delete them: it cannot distinguish old template lines from your own notes with certainty.`;
    }
  }
  return next.trimEnd() + `\n\n---\n${tag}\n## Preserved previous content\n\n${note}\n\n` + carried + (carried.endsWith('\n') ? '' : '\n');
}

 
 
 
 
 
 
 
 
 
 
//
 
 
 
 
 
 
const _GUARD_NAME_RE = /^(?:pre|post)?(?:test|check|verify|validate|guard|gate|lint|typecheck|audit|scan|e2e|smoke)\b|[:-](?:test|check|verify|validate|guard|gate|lint|audit|scan|e2e|smoke)\b/i;
 
 
function _normPath(s) {
  let t = String(s).replace(/\\+/g, '/');
  let prev;
  do { prev = t; t = t.split('/./').join('/'); } while (t !== prev);
  do { prev = t; t = t.split('//').join('/'); } while (t !== prev);
  return t;
}
 
 
 
const _READS_PKG_RE = /package\.json/;
const _ENUMS_SCRIPTS_RE = /\b(?:Object\.(?:keys|entries)\s*\(\s*[\w.?\s]*\bscripts\b|for\s*\(\s*const\s+\w+\s+in\s+[\w.]*\bscripts\b)/;
 
 
 
const _ENUM_PREFIX_RE = /startsWith\s*\(\s*["'`]([\w:.-]+)["'`]\s*\)|\.match\s*\(\s*\/\^([\w:.-]+)|\/\^([\w:.-]+)[^/\n]*\/[a-z]*\s*\.test\s*\(/g;
 
 
 
 
 
function _detectOrphanGuards(input, opts) {
  const _ignoreOwnEntryText = !!(opts && opts.ignoreOwnEntryText);
  const scripts = (input && input.packageScripts) || {};       
  const runners = ((input && input.runners) || [])             
    .map(r => (_ignoreOwnEntryText && r && r.ownEntry) ? Object.assign({}, r, { text: '' }) : r);
  const scriptFiles = (input && input.scriptFiles) || [];      
   
   
   
   
  const ENTRYPOINTS = new Set(['test', 'start', 'build', 'lint', 'typecheck', 'check', 'verify', 'audit', 'e2e', 'prepare', 'prepublishOnly']);
   
   
  const NPM_LIFECYCLE = new Set(['test', 'start', 'restart', 'stop', 'install', 'publish', 'pack', 'version', 'prepare']);
  const isLifecycleHook = (n) => {
    const m = /^(pre|post)(.+)$/.exec(n);
    if (!m) return false;
    const base = m[2];
    return Object.prototype.hasOwnProperty.call(scripts, base) || NPM_LIFECYCLE.has(base);
  };
  const guardNames = Object.keys(scripts).filter(n => _GUARD_NAME_RE.test(n) && !ENTRYPOINTS.has(n) && !isLifecycleHook(n));

   
   
   
   
   
   
   
  const dynamicRunners = [];
  const coveredPrefixes = new Set();
  const _scriptNames = Object.keys(scripts);
   
   
   
   
   
   
  const _plausible = (p) => !!p && (/[:._-]$/.test(p) || p.length >= 2)
    && _scriptNames.some(n => n !== p && n.startsWith(p));
   
   
   
   
  let enumCoversAll = false;
  const _scannedRunners = new Set();
  const _scanEnumerators = (isLiveRunner) => {
    let added = false;
    for (const r of runners) {
      if (_scannedRunners.has(r.file) || !isLiveRunner(r)) continue;
      _scannedRunners.add(r.file);
      const raw = String(r.text || '');
      if (!(_READS_PKG_RE.test(raw) && _ENUMS_SCRIPTS_RE.test(raw))) continue;
       
      let m; const re = new RegExp(_ENUM_PREFIX_RE.source, 'g');
      const rawFound = [], valid = [];
      while ((m = re.exec(raw))) { const p = m[1] || m[2] || m[3]; if (p) { rawFound.push(p); if (_plausible(p)) valid.push(p); } }
       
       
      if (rawFound.length && !valid.length) continue;
      dynamicRunners.push(r.file);
      for (const p of valid) coveredPrefixes.add(p);
       
      if (!valid.length) enumCoversAll = true;
      added = true;
    }
    return added;
  };

   
   
   
  const allRunnerText = runners.map(r => String(r.text || '')).join('\n') + '\n'
    + Object.entries(scripts).map(([n, b]) => `${n} ${b}`).join('\n');
  const mentions = (name) => {
    const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\w:.-])${esc}([^\\w:.-]|$)`, 'm').test(allRunnerText);
  };
  const coveredByEnum = (n) => enumCoversAll || [...coveredPrefixes].some(p => n.startsWith(p));
   
   
   
   
   
   
  const _dropCommentLines = (s) => String(s).split('\n').filter(l => !/^\s*(\/\/|#|\*|::|@?REM\s)/i.test(l)).join('\n');
  const _has = (hay, name) => {
    const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\w:.-])${esc}([^\\w:.-]|$)`, 'm').test(hay);
  };
  const names = Object.keys(scripts);

   
   
   
   
   
   
   
  const _ORCH_RE = /(?:^|[\s"'`&|;(])(?:npx\s+|pnpm\s+|yarn\s+)?(?:turbo|nx|lerna)\s+(?:run|affected|exec|watch)\b/;
  const _isConfigRunner = (f) => /(?:\.ya?ml|Makefile|makefile|GNUmakefile|Jenkinsfile|justfile)$|\.husky\//.test(String(f || ''));

   
   
   
   
   
   
  const edges = new Map();
  for (const [a, bodyRaw] of Object.entries(scripts)) {
    const body = _dropCommentLines(String(bodyRaw || ''));
    const out = new Set();
    for (const b of names) if (b !== a && _has(body, b)) out.add(b);
     
     
     
    if (/\b(?:npm-run-all|run-s|run-p|npm\s+run|yarn\s+run|pnpm\s+run)\b/.test(body)) {
      for (const m of body.matchAll(/([\w:.-]+)\*/g)) {
        for (const b of names) if (b !== a && b.startsWith(m[1])) out.add(b);
      }
    }
    edges.set(a, out);
  }
   
   
   
   
  const NPM_SELF_RUN = ['prepare', 'prepack', 'postpack', 'prepublishOnly', 'postinstall', 'preinstall', 'install'];
  const seedRoots = new Set();
  for (const n of names) if (ENTRYPOINTS.has(n)) seedRoots.add(n);
  for (const n of names) if (NPM_SELF_RUN.includes(n) || isLifecycleHook(n)) seedRoots.add(n);
  const reachable = new Set();
  const usedRunners = new Set();
  const roots = new Set(seedRoots);
  const _bfs = () => {
    reachable.clear();
    const queue = [...roots];
    while (queue.length) {
      const n = queue.shift();
      if (reachable.has(n)) continue;
      reachable.add(n);
      for (const b of (edges.get(n) || [])) if (!reachable.has(b)) queue.push(b);
       
      for (const p of ['pre' + n, 'post' + n]) if (Object.prototype.hasOwnProperty.call(scripts, p) && !reachable.has(p)) queue.push(p);
    }
  };
   
  const _liveRunner = (r) => {
    if (r.unconditional) return true;    
    const via = Array.isArray(r.viaScripts) && r.viaScripts.length ? r.viaScripts : (r.viaScript ? [r.viaScript] : []);
    return via.length === 0 || via.some(n => reachable.has(n) || coveredByEnum(n));
  };
  for (let pass = 0; pass <= runners.length + 2; pass++) {
    _bfs();
     
    let grew = _scanEnumerators(_liveRunner);
    for (const r of runners) {
      if (usedRunners.has(r.file) || !_liveRunner(r)) continue;
      usedRunners.add(r.file);
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
      const _DESCRIPTIVE = /^\s*-?\s*(?:name|description|title|summary|comment|displayName|label)\s*:\s*(.*)$/i;
      const _configLineOk = (l) => {
        const m = _DESCRIPTIVE.exec(l);
        if (!m) return true;
        const v = String(m[1]).trim();
        return !v || v.startsWith('[') || !/\s/.test(v);
      };
      const _raw = _dropCommentLines(String(r.text || ''));
      const t = _isConfigRunner(r.file)
        ? _raw.split('\n').filter(_configLineOk).join('\n')
        : _raw.split('\n').filter(l => /\b(?:npm|npx|yarn|pnpm|make|run|exec)\b/.test(l)).join('\n');
      for (const n of names) if (!roots.has(n) && _has(t, n)) { roots.add(n); grew = true; }
      grew = true;
    }
    if (!grew) break;
  }
  _bfs();
  const isLive = (n) => reachable.has(n) || coveredByEnum(n);
   
   
   
  const unknownOrchestrator = Object.entries(scripts).some(([n, b]) => isLive(n) && _ORCH_RE.test(String(b || '')))
    || runners.some(r => _isConfigRunner(r.file) && _ORCH_RE.test(_dropCommentLines(String(r.text || ''))));
   
   
   
   
   
   
   
   
   
  const _filesOf = (body) => [...String(body || '').matchAll(/(?:\.{0,2}[/\\])?[\w.-]+[/\\][\w./\\-]*\.(?:m?js|cjs|mts|cts|tsx?|sh)(?![\w])/g)]
    .map(m => _normPath(m[0]).replace(/^\.\//, ''));
  const _reachedElsewhere = (name) => {
    const mine = _filesOf(scripts[name]);
    if (!mine.length) return false;                         
    const others = Object.entries(scripts).filter(([n]) => n !== name && isLive(n)).map(([, b]) => _filesOf(b)).flat();
     
     
     
    const runnerText = _normPath(_dropCommentLines(runners.filter(_liveRunner).map(r => String(r.text || '')).join('\n')));
    return mine.every(f => others.includes(f) || runnerText.includes(f));
  };
  const orphanScripts = unknownOrchestrator ? [] : guardNames.filter(n => !isLive(n) && !_reachedElsewhere(n));
  void mentions;

   
   
   
   
  const liveScripts = Object.entries(scripts).filter(([n]) => isLive(n));
   
   
   
   
   
   
   
   
  const allText = _normPath(runners.filter(_liveRunner).map(r => String(r.text || '')).join('\n') + '\n'
    + liveScripts.map(([, b]) => String(b || '')).join('\n'));
   
   
  const _baseCount = new Map();
  for (const f of scriptFiles) { const b = String(f).split(/[\\/]/).pop(); _baseCount.set(b, (_baseCount.get(b) || 0) + 1); }
   
   
   
  //    ⚠ 원문을 그대로 훑으면 **주석 속 참조**도 실행으로 계상되고(검수 재현: `// require("./a/check.js")`),
   
   
  const _resolved = new Set();
  for (const r of runners.filter(_liveRunner)) {
     
     
     
     
     
    const dir = _isConfigRunner(r.file) ? [] : _normPath(String(r.file || '')).split('/').slice(0, -1);
     
     
    const body = _normPath(_dropCommentLines(String(r.text || '')));
    for (const m of body.matchAll(/(\.{1,2}(?:[/\\][\w.-]+)+\.(?:m?js|cjs|ts|sh))/g)) {
      const segs = dir.slice();
      let escaped = false;
      for (const s of _normPath(m[1]).split('/')) {
        if (s === '.' || s === '') continue;
        if (s === '..') { if (!segs.length) { escaped = true; break; } segs.pop(); } else segs.push(s);
      }
       
      if (!escaped) _resolved.add(segs.join('/'));
    }
  }
  const orphanFiles = unknownOrchestrator ? [] : scriptFiles.filter(f => {
    const full = String(f).replace(/\\/g, '/');
    if (allText.includes(full) || _resolved.has(full)) return false;
    const base = full.split('/').pop();
     
     
    const _bnRe = new RegExp(`(^|[^\\w./\\\\-])${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w.-]|$)`);
    if (_baseCount.get(base) === 1 && _bnRe.test(allText)) return false;
    return true;
  });

   
   
  const scanIncomplete = (Number(input && input.readErrors) || 0) + (Number(input && input.skippedLarge) || 0);
   
  const monorepoOutOfScope = !!(input && input.workspaces);
  const _incompleteNote = (scanIncomplete
    ? ` ⚠ 수집 불완전(읽기실패 ${Number(input.readErrors) || 0} · 대용량 제외 ${Number(input.skippedLarge) || 0}) — 이 목록은 과다보고일 수 있다`
    : '')
    + (monorepoOutOfScope ? ` ⚠ workspaces 저장소 — 루트 package.json 만 봤다(하위 패키지는 범위 밖)` : '');
   
   
   
  let maskedByOwnEntry = null;
  if (!_ignoreOwnEntryText && runners.some(r => r && r.ownEntry && String(r.text || ''))) {
    try {
      const cf = _detectOrphanGuards(input, { ignoreOwnEntryText: true });
      const sMore = (cf.orphanScripts || []).filter(x => !orphanScripts.includes(x));
      const fMore = (cf.orphanFiles || []).filter(x => !orphanFiles.includes(x));
      if (sMore.length || fMore.length) maskedByOwnEntry = { scripts: sMore, files: fMore };
    } catch {   }
  }
  return {
    guardCount: guardNames.length,
    dynamicRunners,
    enumPrefixes: [...coveredPrefixes],
    orphanScripts,
    orphanFiles,
    scanIncomplete,
    monorepoOutOfScope,
    maskedByOwnEntry,
    deferred: unknownOrchestrator,
     
    reason: (unknownOrchestrator
      ? 'turbo/nx/lerna 배선은 설정 파일에 있어 스크립트 그래프로 볼 수 없다 — 판정 보류(보고 안 함)'
      : dynamicRunners.length
        ? (enumCoversAll
          ? `동적 열거자(${dynamicRunners.join(', ')})가 전체를 태운다`
          : `동적 열거자(${dynamicRunners.join(', ')})가 ${[...coveredPrefixes].map(p => p + '*').join(', ')} 만 태운다 — 그 밖은 별도 배선 필요`)
        : `러너 ${runners.length}개 + 진입점 ${[...roots].length}개에서 도달성 추적 (도달 ${reachable.size}/${names.length})`) + _incompleteNote,
  };
}

const _TAG_ESC = PRESERVED_TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
 
 
 
 
const _OPENER_RE = new RegExp(`^[ \\t]*${_TAG_ESC}[ \\t\\r]*$\\r?\\n^#{1,3}[ \\t]*Preserved previous content[ \\t\\r]*$`, 'm');
const _HEAD_RE = /^#{1,3}[ \t]*Preserved previous content[ \t\r]*$/gm;
 
const _NOTE_RE = /전체 원본 백업|Full original backup|Previous content was backed up|이전 버전에서 이어진|Custom user\/project content carried over/;
function _splitPreserved(text) {
  const s = String(text == null ? '' : text);
  let at = -1;
  const m1 = _OPENER_RE.exec(s);
  if (m1) at = m1.index;
  if (at < 0) {
    _HEAD_RE.lastIndex = 0;
    let h;
    while ((h = _HEAD_RE.exec(s))) {
      if (_NOTE_RE.test(s.slice(h.index, h.index + 800))) { at = h.index; break; }
    }
  }
  if (at < 0) return { managed: s, preserved: '', at: -1 };
   
   
   
  const before = s.slice(0, at);
  const tail = before.slice(-64);
  const hr = /(?:\r?\n)*---[ \t]*(?:\r?\n)+$/.exec(tail);
  const start = hr ? at - (tail.length - hr.index) : at;
  return { managed: s.slice(0, start), preserved: s.slice(start), at: start };
}

 
function _parseSkillsValue(v, catalog) {
  if (!v || v === true) return [];
  if (v === 'all') return Object.keys(catalog || {});
   
   
   
  if (v === 'recommended') return Object.keys(catalog || {});
   
   
  const req = String(v).split(',').map(s => s.trim()).filter(Boolean);
  const known = req.filter(s => (catalog || {})[s]);
  const unknown = req.filter(s => !(catalog || {})[s]);
  if (unknown.length) { try { Object.defineProperty(known, 'unknown', { value: unknown, enumerable: false }); } catch {} }
  return known;
}

 
 
 
 
function _dropHeader(block) {
  const m = String(block || '').match(/^## 제거 (\d{4}-\d{2}-\d{2})\s*\(target:\s*"(.*)"\)/);
  return m ? { date: m[1], target: m[2] } : null;
}
function _parseArchiveBlocks(text) {
  const entries = [];
  if (!text) return entries;
  const blocks = text.split(/\n(?=## 제거 )/);
  for (const b of blocks) {
    const h = _dropHeader(b);
    if (!h) continue;
    const headerMatch = b.match(/^### (.+)$/m);
    entries.push({ date: h.date, target: h.target, originalHeader: headerMatch ? headerMatch[1].trim() : null });
  }
  return entries;
}
 
function _parseSkillCatalog(body, sourceUrl) {
  const entries = [];
  const trimmed = String(body || '').trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const j = JSON.parse(trimmed);
      const arr = Array.isArray(j) ? j : (j.skills || j.entries || j.items || []);
      for (const e of arr) {
        if (!e || (!e.name && !e.id)) continue;
        entries.push({ name: e.name || e.id, url: e.url || e.path || (sourceUrl ? sourceUrl.replace(/[^/]+$/, '') + (e.id || e.name) + '/SKILL.md' : ''), description: e.description || '', format: 'json' });
      }
      if (entries.length) return entries;
    } catch {}
  }
  if (/<rss|<feed|<channel|<item>/i.test(body)) {
    for (const m of String(body).matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)) {
      const item = m[0];
      const title = (item.match(/<title>([^<]+)<\/title>/i) || [])[1];
      const link = (item.match(/<link[^>]*>([^<]+)<\/link>/i) || item.match(/<link\s+href="([^"]+)"/i) || [])[1];
      const desc = (item.match(/<description>([^<]+)<\/description>/i) || item.match(/<summary>([^<]+)<\/summary>/i) || [])[1];
      if (title) entries.push({ name: title.trim(), url: (link || '').trim(), description: (desc || '').trim(), format: 'rss' });
    }
    if (entries.length) return entries;
  }
  for (const m of String(body).matchAll(/^\s*[-*]\s*\[([^\]]+)\]\(([^)]+)\)\s*[-—:]\s*(.+)$/gm)) {
    entries.push({ name: m[1], url: m[2], description: m[3].trim(), format: 'markdown' });
  }
  if (entries.length) return entries;
  for (const m of String(body).matchAll(/^\s*[-*]\s*\[([^\]]+)\]\(([^)]+\.md)\)/gm)) {
    entries.push({ name: m[1], url: m[2], description: '', format: 'markdown' });
  }
  if (entries.length) return entries;
  for (const m of String(body).matchAll(/(https?:\/\/[^\s)]+SKILL\.md)/g)) {
    entries.push({ name: m[1].split('/').slice(-2)[0], url: m[1], description: '', format: 'urls' });
  }
  return entries;
}

 
function _renderTeamsMd(teams) {
  const preamble = '# Agent Teams (UR-0073)\n\n페르소나 기반 에이전트 팀 정의 — **opt-in · 정의 전용(자동 실행 없음)**. `leerness team add|list|show|remove` 로 관리.\n'
    + '향후 단계에서 스케줄 기반 실행(리뷰/배포/블로그)이 opt-in 으로 추가될 수 있습니다. 현재는 메타데이터만 저장합니다.\n';
  const body = (teams || []).map(t => {
    return `\n## ${t.id}${t.name ? ' — ' + t.name : ''}\n`
      + `- Purpose: ${t.purpose || ''}\n`
      + `- Personas: ${(t.personas || []).join(', ')}\n`
      + `- Members: ${(t.members || []).join(', ')}\n`
      + `- Schedule: ${t.schedule || 'manual'}\n`
      + `- Deploy: ${t.deployCommand || '-'}\n`
      + `- Review: ${t.review !== false ? '메인 검수 필요' : '생략'}\n`
      + `- Status: ${t.status || 'active'}\n`;
  }).join('');
  return preamble + body;
}

 
function _composeTeamPlan(team, task) {
  const t = team || {};
  const effTask = (task && task !== true) ? String(task) : (t.purpose || '(작업 미지정)');
  const personas = Array.isArray(t.personas) ? t.personas : [];
  const members = Array.isArray(t.members) ? t.members : [];
  const personaTag = personas.length ? ` [페르소나: ${personas.join(', ')}]` : '';
  const steps = members.map(m => {
    const prompt = `${effTask}${personaTag}`;
    return { member: m, personas, dispatchPrompt: prompt, suggestedCommand: `leerness agents dispatch "${prompt}" --to ${m}` };
  });
   
  const review = t.review !== false;
  const reviewStep = review ? {
    type: 'review',
    note: '메인 에이전트가 각 sub-agent 산출물을 독립 검증(교차 검수). verify-claim/contract verify/review 사용.',
    suggestedCommand: 'leerness verify-claim <T-ID> --run-tests --strict-claims  ·  leerness review <file> --persona ' + (personas.join(',') || 'security'),
  } : null;
  return { teamId: t.id || null, name: t.name || '', task: effTask, schedule: t.schedule || 'manual', memberCount: members.length, review, steps, reviewStep };
}

 
 
function _teamHandoffReminders(teams, lang) {
  const en = lang === 'en';
  return (teams || [])
    .filter(t => t && t.schedule && t.schedule !== 'manual' && (t.status || 'active') === 'active' && t.id)
    .map(t => {
      const n = Array.isArray(t.members) ? t.members.length : 0;
      const memberPart = n ? (en ? ` · ${n} member${n === 1 ? '' : 's'}` : ` · ${n}명`) : '';
      const reviewPart = t.review !== false ? (en ? ' · review needed' : ' · 검수필요') : '';
      const preview = en ? 'preview' : '미리보기';
      return `🤝 ${t.id} (${t.schedule})${memberPart}${reviewPart} — ${preview}: leerness team preview ${t.id}`;
    });
}

 
function _cadenceAssessment(perDay, total, daysActive) {
  const rawRate = Number(perDay);
  const rawTotal = Number(total);
  const rawDays = Number(daysActive);
  const r = Number.isFinite(rawRate) && rawRate >= 0 ? rawRate : 0;
  const nTotal = Number.isFinite(rawTotal) && rawTotal >= 0 ? rawTotal : 0;
  const nDays = Number.isFinite(rawDays) && rawDays >= 0 ? rawDays : 0;
   
   
   
   
  if (nTotal < 2 || nDays <= 0) {
    return {
      releasesPerDay: r,
      total: nTotal,
      daysActive: nDays,
      dataSufficient: false,
      level: 'insufficient-data',
      recommendation: '케이던스 판정 보류 — 서로 다른 시각의 릴리스 태그가 2개 이상 필요합니다.',
    };
  }
  let level, recommendation;
  if (r >= 5) { level = 'very-high'; recommendation = 'batched minor 릴리스 강력 권장 — 관련 패치를 묶어 주 1~2회 minor 로. stable/next 채널 분리 + 사용자에겐 stable 만 권고.'; }
  else if (r >= 2) { level = 'high'; recommendation = 'cadence 높음 — 연관 변경을 묶어 배포 빈도 축소 권장. 릴리스 노트에 실행 환경/검증 명시.'; }
  else if (r >= 0.5) { level = 'moderate'; recommendation = '적정 범위 — 안정성 우선 시 minor 묶음 고려.'; }
  else { level = 'healthy'; recommendation = '건강한 케이던스.'; }
  return { releasesPerDay: r, total: nTotal, daysActive: nDays, dataSufficient: true, level, recommendation };
}

 
 
function _teamDeployGate(team, opts) {
  const t = team || {}; opts = opts || {};
  const command = (t.deployCommand && t.deployCommand !== true) ? String(t.deployCommand) : '';
  if (!command) return { mode: 'no-command', command: '', message: 'deployCommand 미설정 — team add --deploy "<명령>" 으로 지정' };
  if (!opts.yes) return { mode: 'dry-run', command, message: 'dry-run (실행 없음) — 실행하려면 --yes + LEERNESS_TEAM_DEPLOY=1' };
  if (!opts.envOn) return { mode: 'gated', command, message: '실행 게이트 미충족 — LEERNESS_TEAM_DEPLOY=1 환경변수 필요 (의도적 opt-in)' };
  return { mode: 'execute', command, message: '실행 허용 (--yes + env 게이트 충족)' };
}

 
function _renderWorkspaceReferenceGuide(dirName, version, generatedAt, legacyName = '.harness') {
  const lines = [];
  lines.push(`# Leerness Workspace Reference Guide`);
  lines.push('');
  lines.push(`> AI 에이전트가 leerness 워크스페이스에서 어떤 파일을 어디서 찾는지 안내합니다 (1.9.211).`);
  lines.push('');
  lines.push(`Generated: ${generatedAt} by leerness ${version}`);
  lines.push(`Workspace dir: \`${dirName}/\``);
  lines.push('');
  lines.push(`## 📁 디렉토리 구조 (핵심)`);
  lines.push('');
  lines.push('```');
  lines.push(`${dirName}/`);
  lines.push(`├── plan.md                    ← 무엇을 할 것인가 (사용자 메모리)`);
  lines.push(`├── progress-tracker.md        ← 무엇을 했는가 (증거 포함, 사용자 메모리)`);
  lines.push(`├── decisions.md               ← 왜 그렇게 했는가 (사용자 메모리)`);
  lines.push(`├── session-handoff.md         ← 다음 세션 인계 (사용자 메모리)`);
  lines.push(`├── lessons.md                 ← 과거 교훈 (자동 fuzzy 회수)`);
  lines.push(`├── rules.md                   ← 자연어 룰 (매 세션 자동 노출, R-XXXX)`);
  lines.push(`├── task-log.md                ← in-progress / dropped task 이력`);
  lines.push(`├── reuse-map.md               ← 워크스페이스 capability 매핑`);
  lines.push(`├── skill-suggestions.md       ← skill rolling history`);
  lines.push(`├── feature-graph.md           ← 기능 의존 그래프 (F-XXXX)`);
  lines.push(`├── manifest.json              ← 워크스페이스 메타`);
  lines.push(`├── leerness-config.json       ← 비시크릿 LEERNESS_* 설정 (1.9.187, AI 가시)`);
  lines.push(`├── user-requests.json         ← 사용자 명시 요청 누적 (1.9.207)`);
  lines.push(`├── active-wakeups.json        ← ScheduleWakeup 상태 (1.9.205)`);
  lines.push(`├── pre-wake-report.json       ← sleep 전 sub-agent audit (1.9.209)`);
  lines.push(`├── wakeup-history.json        ← adaptive wakeup 이력 (1.9.210)`);
  lines.push(`├── platform-constraints.json  ← API 제약 catalog (1.9.208)`);
  lines.push(`├── auto-resume-plan.json      ← 다음 라운드 plan (1.9.203)`);
  lines.push(`├── next-action-queue.json     ← 다음 next-action 큐 (1.9.201)`);
  lines.push(`├── cache/sessions/            ← ignored 세션별 handoff runtime record`);
  lines.push(`├── last-handoff.json          ← legacy projection (handoff --writeback)`);
  lines.push(`├── environment.json           ← 환경 변동 추적 (1.9.145)`);
  lines.push(`├── skills/                    ← 설치된 skill 디렉토리`);
  lines.push(`└── templates/                 ← 워크스페이스 템플릿`);
  lines.push('```');
  lines.push('');
  lines.push(`## 🧭 자주 묻는 위치`);
  lines.push('');
  lines.push(`| 찾는 것 | 위치 |`);
  lines.push(`|---|---|`);
  lines.push(`| 현재 진행 중인 task | \`${dirName}/progress-tracker.md\` (status: in-progress) |`);
  lines.push(`| 사용자가 명시한 영구 룰 | \`${dirName}/rules.md\` (active R-XXXX) |`);
  lines.push(`| 직전 sleep 전 audit 결과 | \`${dirName}/pre-wake-report.json\` (1.9.209) |`);
  lines.push(`| 미답 사용자 요청 | \`${dirName}/user-requests.json\` (status: open) |`);
  lines.push(`| 다음 라운드 권장 단계 | \`${dirName}/auto-resume-plan.json\` (1.9.203) |`);
  lines.push(`| API 제약 catalog | \`${dirName}/platform-constraints.json\` (1.9.208) |`);
  lines.push(`| 자동 wakeup 권장 간격 | \`${dirName}/wakeup-history.json\` (1.9.210) |`);
  lines.push('');
  lines.push(`## 🔄 워크스페이스 디렉터리`);
  lines.push('');
  lines.push(`canonical workspace 는 **\`.leerness/\`** 이며, 이 가이드가 가리키는 현재 위치는 **\`${dirName}/\`** 입니다.`);
  lines.push(`- \`${legacyName}/\` 만 있는 기존 프로젝트는 \`leerness migrate-workspace-dir\` 로 안전하게 병합·이동합니다.`);
  lines.push(`- canonical 복사·해시 검증이 끝난 뒤 레거시 원본은 ignored \`.leerness-backup/\` 으로 원자적 이동합니다. 기존 백업은 덮어쓰지 않습니다.`);
  lines.push(`- 기존 \`.leerness/state.json\`, \`.leerness/runs/\`, \`.leerness/handoff/\`, \`.leerness/cache/\` substrate 는 보존합니다.`);
  lines.push(`- 두 디렉터리에 서로 다른 live 파일이 있으면 자동 선택하지 않고 \`workspace-dir-conflict\` 로 차단합니다.`);
  lines.push(`- legacy observability runs 는 state runs 와 충돌하지 않도록 \`.leerness/cache/agent-runs/\` 로 remap 합니다.`);
  lines.push('');
  lines.push(`AI 에이전트는 \`leerness handoff .\` 와 \`leerness workspace-dir get\` 결과를 함께 신뢰하십시오.`);
  lines.push('');
  return lines.join('\n');
}

 
function _memorySurface(counts) {
  const c = counts || {};
  return `T${c.tasks || 0}/D${c.decisions || 0}/R${c.rules || 0}/P${c.milestones || 0}/L${c.lessons || 0}`;
}
 
function _renderPulseLine(data) {
  const d = data || {};
  const round = d.roundCount == null ? 'unavailable' : `R${d.roundCount}`;
  let line = `📍 v${d.version} · 🔄 ${round} · 🔌 MCP ${d.mcpTools} · 🧠 ${d.memorySurface}`;
  if (d.nextMilestone) {
    const eta = d.etaDays != null ? ` (${d.etaDays}d)` : '';
    line += ` · 🎯 R${d.nextMilestone}${eta}`;
  }
  if (d.abnormalShutdown && d.abnormalShutdown !== 'none') {
    line += ` · 🔌 abnormal:${d.abnormalShutdown}`;
  }
  return line;
}


 
 
 
function _parseImplExports(src) {
  const out = new Set();
  const add = n => { if (n && /^[A-Za-z_$][\w$]*$/.test(n)) out.add(n); };
   
  const re = /module\.exports\s*=\s*\{/g; let mm;
  while ((mm = re.exec(src))) {
    const i = src.indexOf('{', mm.index); let depth = 0, end = -1;
    for (let j = i; j < src.length; j++) { const c = src[j]; if (c === '{') depth++; else if (c === '}') { if (--depth === 0) { end = j; break; } } }
    if (end < 0) break;
    const inner = src.slice(i + 1, end);
    let d = 0, seg = ''; const segs = [];
    for (const c of inner) { if (c === '{' || c === '(' || c === '[') d++; else if (c === '}' || c === ')' || c === ']') d--; if (d === 0 && c === ',') { segs.push(seg); seg = ''; } else seg += c; }
    if (seg.trim()) segs.push(seg);
    for (const s of segs) { const m = s.match(/^\s*\.{0,3}\s*([A-Za-z_$][\w$]*)/); if (m && !/^\s*\.\.\./.test(s)) add(m[1]); }
    re.lastIndex = end;
  }
   
  for (const m of src.matchAll(/(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) add(m[1]);
   
  for (const m of src.matchAll(/(?:module\.)?exports\s*\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\]\s*=/g)) add(m[1]);
   
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
   
   
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const seg = part.trim(); if (!seg) continue;
      const asM = seg.match(/\bas\s+([A-Za-z_$][\w$]*)/);
      if (asM) { add(asM[1]); continue; }             
      if (/^(?:default|type)\b/.test(seg)) continue;   
      add((seg.match(/^([A-Za-z_$][\w$]*)/) || [])[1]);
    }
  }
  return [...out];
}

 
function _matchTool(catalog, name) {
  if (!catalog || !catalog.tools || !name) return null;
  const n = String(name).toLowerCase().trim();
  for (const [id, t] of Object.entries(catalog.tools)) {
    if ((t.aliases || []).some(a => a.toLowerCase() === n)) {
      return { id, category: t.category || 'other', plainKo: t.plainKo || '', plainEn: t.plainEn || '', docs: t.docs || null };
    }
  }
  return null;
}
 
function _parsePackageJsonDeps(pkgJsonText) {
  let pkg; try { pkg = JSON.parse(pkgJsonText); } catch { return []; }
  const out = [];
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const o = pkg && pkg[field]; if (o && typeof o === 'object') for (const k of Object.keys(o)) if (!out.includes(k)) out.push(k);
  }
  return out;
}
 
function _parseRequirementsTxt(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim(); if (!line) continue;
     
    if (line.startsWith('-')) continue;
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9_.\-]*)/); if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
 
function _buildGlossary({ deps = [], catalog, descFor = () => null } = {}) {
  const entries = [], gaps = []; const seen = new Set();
  for (const name of deps) {
    if (seen.has(name)) continue; seen.add(name);
    const hit = _matchTool(catalog, name);
    if (hit) { entries.push({ term: name, plainKo: hit.plainKo, plainEn: hit.plainEn, category: hit.category, source: 'catalog', docs: hit.docs }); continue; }
    const d = descFor(name);
    if (d) entries.push({ term: name, plainKo: _lineSafe(d), plainEn: _lineSafe(d), category: 'dependency', source: 'package-description', docs: null });
    else gaps.push({ term: name, category: 'dependency', source: 'unknown', needsDefinition: true });
  }
  entries.sort((a, b) => a.term.localeCompare(b.term));
  return { entries, gaps, stats: { total: deps.length, defined: entries.length, gaps: gaps.length } };
}
const GLOSSARY_START = '<!-- leerness:glossary:start -->';
const GLOSSARY_END = '<!-- leerness:glossary:end -->';
 
function _renderGlossaryMd(entries, opts = {}) {
  const lang = opts.lang || 'both'; const gaps = opts.gaps || [];
  let s = `${GLOSSARY_START}\n# 용어집 / Glossary\n\n> 이 프로젝트가 사용하는 도구/라이브러리를 비개발자도 알 수 있게 한 줄로 설명합니다. (leerness glossary)\n\n`;
  if (!entries.length && !gaps.length) { s += '_(의존성 없음 — package.json/requirements.txt 미발견)_\n'; return s + GLOSSARY_END + '\n'; }
  if (entries.length) {
    s += '| 패키지 | 쉽게 말하면 (KO) | In plain terms (EN) | 분류 | 출처 |\n|---|---|---|---|---|\n';
    for (const e of entries) {
       
      const ko = lang === 'en' ? '' : _cellSafe(e.plainKo || '');
      const en = lang === 'ko' ? '' : _cellSafe(e.plainEn || '');
      s += `| ${_cellSafe(e.term)} | ${ko} | ${en} | ${_cellSafe(e.category || '')} | ${e.source} |\n`;
    }
    s += '\n';
  }
  if (gaps.length) {
    s += `## 미정의 (${gaps.length}) — AI 에이전트가 채울 항목\n\n카탈로그·로컬 설명에 없는 의존성입니다. 사용 중인 AI 에이전트에게 아래를 요청하세요:\n\n`;
    s += '> 다음 패키지들을 비개발자도 이해할 한 줄(한국어+영어)로 설명해줘: ' + gaps.map(g => _lineSafe(g.term)).join(', ') + '\n';
  }
  return s + GLOSSARY_END + '\n';
}

 
 
 
 
//   섹션 자체가 없으면(구조 미상) 미플래그(FP 회피). `<!-- leerness:na -->` 스킵은 캘러(audit)가 처리.
function _mdSectionBody(content, heading) {
  const lines = String(content || '').split('\n');
  const h = new RegExp('^##\\s*' + heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
  const i = lines.findIndex(l => h.test(l));
  if (i < 0) return null;
  const body = [];
  for (let j = i + 1; j < lines.length; j++) { if (/^##\s/.test(lines[j])) break; body.push(lines[j]); }
  return body.join('\n');
}
const _BRIEF_PLACEHOLDER_RE = /실제\s*(?:내용|목적)\s*으로\s*업데이트|describe .*purpose here|update .*with (?:the )?real/i;
const _PLAN_GOAL_PLACEHOLDER_RE = /전체\s*계획을\s*유지합니다|사용자\s*목적을\s*기준으로|state your goal here|maintain the overall plan/i;
function _sectionUnfilled(content, heading, placeholderRe) {
  const body = _mdSectionBody(content, heading);
  if (body == null) return false;                                        
  if (placeholderRe.test(body)) return true;                             
  return !body.split('\n').some(l => l.replace(/^\s*[-*]\s*/, '').trim().length > 0);   
}
function _briefUnfilled(content) { return _sectionUnfilled(content, 'Purpose', _BRIEF_PLACEHOLDER_RE); }
function _planGoalUnfilled(content) { return _sectionUnfilled(content, 'Goal', _PLAN_GOAL_PLACEHOLDER_RE); }

 
 
 
function _draftAnchors(sig = {}) {
  const purpose = [];
  const goal = [];
   
   
   
  const _oneLine = (s) => String(s || '').replace(/\s*\r?\n\s*/g, ' ').replace(/^#+\s*/, '').trim();
  const desc = _oneLine(sig.pkgDescription);
   
  let readmeLead = '';
  for (const line of String(sig.readmeText || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('![') || t.startsWith('[!') || t.startsWith('<')) continue;
    readmeLead = t; break;
  }
   
   
  const _cutAt = (s, n) => {
    s = String(s || '').trim();
    if (s.length <= n) return s;
    const head = s.slice(0, n);
    const brk = Math.max(head.lastIndexOf(' '), head.lastIndexOf(','), head.lastIndexOf('·'), head.lastIndexOf('。'), head.lastIndexOf('.'));
    return (brk > n * 0.5 ? head.slice(0, brk) : head).replace(/[\s,·]+$/, '') + '…';
  };
  if (desc) purpose.push(`- ${desc}`);
  if (readmeLead && readmeLead !== desc) purpose.push(`- ${_cutAt(readmeLead, 200)}`);
  const ms = (sig.milestones || []).filter(m => m && m.title).slice(0, 3);
  const activeTasks = (sig.tasks || []).filter(t => t && /in-progress|planned|requested/.test(String(t.status || ''))).slice(0, 3);
   
  const _en = String(sig.lang || '').toLowerCase() === 'en';
  if (desc || readmeLead) goal.push(_en ? `- Keep the product working and evolving it: ${_cutAt(desc || readmeLead, 140)}` : `- 제품을 동작 상태로 유지·발전시킨다: ${_cutAt(desc || readmeLead, 140)}`);
  for (const m of ms) goal.push(`- [${m.id || 'M'}] ${_oneLine(m.title).slice(0, 120)}${m.status ? ` (${m.status})` : ''}`);
  if (!goal.length && activeTasks.length) for (const t of activeTasks) goal.push(`- ${t.id}: ${_oneLine(t.request).slice(0, 100)}`);
  const marker = _en
    ? '<!-- draft: leerness anchors — draft from real signals. Remove this comment after AI/user review to confirm -->'
    : '<!-- draft: leerness anchors — 실신호 기반 초안. AI/사용자가 검토·수정 후 이 주석을 지우면 확정 -->';
  return {
    hasSignal: purpose.length > 0 || goal.length > 0,
    purpose: purpose.length ? [marker, ...purpose] : [],
    goal: goal.length ? [marker, ...goal] : [],
  };
}

 
 
function _replaceMdSection(content, heading, newBodyLines, opts = {}) {
   
  newBodyLines = (newBodyLines || []).flatMap(l => String(l).split('\n'));
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(l => l.trim().replace(/^#+\s*/, '').toLowerCase() === String(heading).toLowerCase() && /^#+\s/.test(l.trim()));
  if (start < 0) {
    if (!opts.appendIfMissing) return content;
    const base = String(content || '').replace(/\r\n/g, '\n').replace(/\n*$/, '');
    return (base ? base + '\n\n' : '') + `## ${heading}\n\n` + newBodyLines.join('\n') + '\n';
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }
  return [...lines.slice(0, start + 1), '', ...newBodyLines, '', ...lines.slice(end)].join('\n');
}

module.exports = { _parseEnvKeys, _decisionBlocksWithOffset, _blocksWithOffset, _lineOfOffset,
   
   
  _normPath,
  _parseImplExports, _briefUnfilled, _planGoalUnfilled, _mdSectionBody, _draftAnchors, _replaceMdSection,
  _matchTool, _parsePackageJsonDeps, _parseRequirementsTxt, _buildGlossary, _renderGlossaryMd, GLOSSARY_START, GLOSSARY_END,
  _isSecretKey, redactSecrets, hasCredentialMarker, compareVer, parseHarnessVersion,
  SAFE_MODEL_IDENTIFIER_RE, isValidModelIdentifier,
  _isPlaceholderSecret, _looksSecretLike,
  _mergeLines, _mergeEnvLines, _mergeReadmeSection, _managedMerge, _splitPreserved, PRESERVED_TAG, _detectOrphanGuards, _parseSkillsValue,
  _parseArchiveBlocks, _parseSkillCatalog, _renderTeamsMd, _composeTeamPlan, _teamHandoffReminders, _cadenceAssessment, _teamDeployGate, _renderWorkspaceReferenceGuide, _memorySurface, _renderPulseLine,
  _classifyCJK, _riskLabel, _detectSystemLang, _parseSlashFromHelp,
   
  PERMISSION_TIERS, _tierRank, _requiredTier, _policyAllows, _resolveNpmTag, _mcpJsonContent, _newRunRecord,
   
  _htmlToText, _extractTitle, _extractLinks,
   
  _countDatedBlocks, _extractDecisionBlocks, _stripDecisionFences, _dropHeader,
   
  _classifyIntent,
   
  _sanitizeFences, _shellQuoteArg, _detectPwshFromEnv,
   
  _getLocalTz, _formatLocal,
   
  _truncate, _splitList,
   
  _roadmapMapStatus, _roadmapParseMilestones, _roadmapParseTokens,
   
  _BRIEF_FIELDS, _briefFilled,
   
  BRIEF_START, BRIEF_END, _briefReadmeBlock, _briefBlueprint,
   
  _parseLessonEntries, _renderLessonsMd,
   
  _withBuiltinSource,
   
  _esc,
   
  _roadmapTokenStyles,
   
  _parseSkillMd, _lintSkillMeta,
   
  _matchConstraints,
   
  _matchDomain, _aliasHit,
   
  _detectLspLang, _matchLspSymbols,
   
  _extractUrlClaims, _verifyUrlClaim, _detectOptimism, _computeConfidence,
   
  _personaSummaries,
   
  _translate,
   
  _parseDecisionBlock, _decisionsFromMd, _renderDecisionsMd, _memoryPreamble, _memoryPreambleLanguages, _taskMatchText, _isTrivialNextAction, _isDoneStatus,
   
  _migrationGuideText,
   
  _parseContractSpec,
   
  _gitignoreMatch, _globToRe,
   
  _featureGraphTemplate, _parseFeatureGraph, _featureGraphNodeRanges, _nextFeatureId, _featureBlock,
   
  _featureImpactBfs,
   
  _parseChangelogBetween,
   
  _cellSafe, _cellUnescape,
   
  _lineSafe, stripDefaultIgnorables, _milestoneSurface, _recentChangesSurface, _recentChangesAggregate,
   
  _parseLimit,
   
  _parseAddTitle,
   
  _terminatorIndex,
   
  _taskPositionalPath,
   
  _completionClaimAllowed,
   
  _minorKey, _shouldPublishNpm
};

 
function _migrationGuideText(version) {
  const v = version || 'latest';
  const L = [
    '# leerness 크로스버전 마이그레이션 가이드 (UR-0075, AI 에이전트용)',
    '',
    '아주 오래된 구버전부터 신규(' + v + ')까지 — 기존 프로젝트의 .leerness 내용을 안전·비파괴로 마이그레이션.',
    '',
    '## 0. 원칙',
    '- 비파괴: leerness 는 migrate/update 시 .leerness/archive 에 자동 백업. 그래도 git 커밋/브랜치 선행 권장.',
    '- dry-run 우선: 먼저 --check 로 감지, diff 로 확인 후 적용.',
    '',
    '## 1. 안전 스냅샷 (권장)',
    '  git add -A && git commit -m "chore: pre-leerness-migration snapshot"   # 또는 브랜치: git checkout -b chore/leerness-migrate',
    '',
    '## 2. 신규 버전 감지 (구버전 프로젝트 대상)',
    '  npx leerness@latest update --check --path <project>      # 현재 버전 vs 최신 비교 (네트워크 비차단, 비파괴)',
    '',
    '## 3. 마이그레이션 적용 (임시설치 = npx 캐시, 격리)',
    '  npx leerness@latest update --yes --path <project>        # 자동 마이그레이션 (.leerness/archive 백업 + 신 스키마 반영)',
    '  # 또는: npx leerness@latest migrate <project> --force    # 강제 재스캐폴딩 — 관리 .md 를 템플릿으로 교체(기존 내용은 .leerness/archive 로 백업, in-place 보존 아님). 커스텀 편집 보존은 --force 없이 migrate / update --yes 사용',
    '',
    '## 4. 검증 (필수)',
    '  git -C <project> diff                                    # 생성/수정 파일 전수 확인 (예상치 못한 변경 점검)',
    '  npx leerness@latest selftest                             # 코어 무결성 (위치독립, 어디서든 통과)',
    '  npx leerness@latest check --path <project>               # 프로젝트 무결성',
    '  npx leerness@latest doctor                               # 설치 진단',
    '',
    '## 5. 크로스버전 메모',
    '- decisions/lessons: 구 MD-only → canonical JSON 자동 백필(첫 write 시). decisions.json/lessons.json 이 진실소스, .md 는 projection.',
    '- 아주 구버전: update 가 단계적으로 누적 마이그레이션. 한 번에 안 되면 update --yes 재실행.',
    '- 보호 파일(.leerness/protected-files.md): 삭제 금지 — merge/archive/deprecated 마커 사용.',
    '',
    '## 6. 롤백',
    '  git -C <project> checkout -- .                           # git 스냅샷 복원',
    '  # 또는 .leerness/archive/<timestamp> 에서 수동 복구 · leerness memory restore <surface> <target>',
    ''
  ];
  return L.join('\n');
}

 
 
 
 
function _parseContractSpec(specText) {
   
   
  const s = (specText || '').replace(/```[\s\S]*?```/g, '\n');
  const declared = new Set();
  const mentioned = new Set();
  const fields = new Set();
  for (const m of s.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) declared.add(m[1]);
   
  for (const m of s.matchAll(/^\s*(?:[-*+]|\d+\.)\s+`?([A-Za-z_$][\w$]*)\(/gm)) declared.add(m[1]);
  for (const m of s.matchAll(/`([A-Za-z_$][\w$]*)\s*\(/g)) mentioned.add(m[1]);
  for (const m of s.matchAll(/tick\.([A-Za-z_$][\w$]*)/g)) fields.add(m[1]);
   
   
   
  {
    const lines = s.split(/\r\n?|\n/);
    let inFields = false;
    for (const line of lines) {
      const h = line.match(/^#{1,6}\s+(.+?)\s*$/);
      if (h) { const t = h[1].trim().toLowerCase(); inFields = t === 'fields' || t.startsWith('fields ') || h[1].trim().startsWith('필드'); continue; }
      if (!inFields) continue;
       
      const b = line.match(/^\s*(?:[-*+]|\d+\.)\s+`?([A-Za-z_$][\w$]*)`?\s*(?::|\s|$)/);
      if (b) fields.add(b[1]);
    }
  }
  return { declared: [...declared], mentioned: [...mentioned], fields: [...fields] };
}

 
function _globToRe(glob) {
  const esc = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp('^' + esc + '$');
}
 
 
 
function _gitignoreMatch(giText, fileRel) {
  if (!giText) return false;
  const relPosix = String(fileRel).replace(/\\/g, '/');
  const base = relPosix.split('/').pop();
   
   
   
  let ignored = false;
  for (let pat of String(giText).split(/\r?\n/)) {
    pat = pat.trim();
    if (!pat || pat.startsWith('#')) continue;
    let negate = false;
    if (pat.startsWith('!')) { negate = true; pat = pat.slice(1); }
    const isDir = pat.endsWith('/');
    const p = pat.replace(/^\/+|\/+$/g, '');
    if (!p) continue;
    let m = false;
    if (p === relPosix || p === base) m = true;                                      
    else if (isDir) {
       
       
       
      if (p.includes('/')) m = relPosix === p || relPosix.startsWith(p + '/');
      else m = relPosix === p || relPosix.split('/').slice(0, -1).includes(p);
    }
    else if (p.includes('*')) { const re = _globToRe(p); if (re.test(p.includes('/') ? relPosix : base)) m = true; }   
    if (m) ignored = !negate;   
  }
  return ignored;
}

 
function _featureGraphTemplate() {
  return `# Feature Graph (1.9.141)\n\n` +
    `> **목적**: 각 기능의 인과관계를 정확히 정리해서 코드 작성 전 영향 범위를 자동 추적.\n` +
    `> 신규 기능 추가, 데이터 형식 변경, 외부 API 매칭 작업 전 \`leerness feature impact <id>\`로 확인.\n` +
    `> handoff가 현재 task 키워드로 자동 매칭해서 영향받는 feature 목록을 회수.\n\n` +
    `## How to use\n\n` +
    `\`\`\`bash\n` +
    `leerness feature add "User Auth"                           # F-0001 자동 부여\n` +
    `leerness feature link F-0002 --depends-on F-0001           # 의존 관계\n` +
    `leerness feature link F-0001 --affects F-0002,F-0005        # 영향 관계 (다수)\n` +
    `leerness feature link F-0001 --co-changes-with F-0011       # 함께 변해야 하는 기능\n` +
    `leerness feature impact F-0001                              # 영향받는 전체 (transitive)\n` +
    `leerness feature list --json                                # 그래프 JSON\n` +
    `leerness feature show F-0001                                # 단일 상세\n` +
    `\`\`\`\n\n` +
    `## Nodes\n\n`;
}
function _featureGraphNodeRanges(text) {
  if (!text) return [];
  const re = /^## (F-\d{4,})\s+(.+?)\s*$/gm;
  const positions = [];
  let m;
  while ((m = re.exec(text)) !== null) positions.push({ id: m[1], title: m[2], start: m.index, headingEnd: m.index + m[0].trimEnd().length });
  return positions.map((item, i) => ({ ...item, end: i + 1 < positions.length ? positions[i + 1].start : text.length }));
}
function _parseFeatureGraph(text) {
  const nodes = [];
  const positions = _featureGraphNodeRanges(text);
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].start;
    const end = positions[i].end;
    const block = text.slice(start, end);
    const parseField = (key) => {
       
      const r = new RegExp(`^- ${key}:[ \\t]*(.*?)$`, 'mi');
      const mm = block.match(r);
      return mm ? mm[1].trim() : '';
    };
    const parseList = (key) => {
      const v = parseField(key);
      if (!v) return [];
      return v.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    };
    nodes.push({
      id: positions[i].id,
      title: positions[i].title,
      dependsOn: parseList('depends-on'),
      affects: parseList('affects'),
      coChangesWith: parseList('co-changes-with'),
      files: parseList('files'),
      input: parseField('input'),
      output: parseField('output'),
      errorModes: parseList('error-modes'),
      tests: parseList('tests'),
      notes: parseField('notes')
    });
  }
  return nodes;
}
function _nextFeatureId(nodes) {
  const used = new Set(nodes.map(n => parseInt(n.id.slice(2), 10)));
  let n = 1; while (used.has(n)) n++;
  return 'F-' + String(n).padStart(4, '0');
}
function _featureBlock(node) {
   
  const arr = (a) => (a || []).map(_lineSafe).join(', ');
  return `## ${node.id} ${_lineSafe(node.title || '')}\n` +
    `- depends-on: ${arr(node.dependsOn)}\n` +
    `- affects: ${arr(node.affects)}\n` +
    `- co-changes-with: ${arr(node.coChangesWith)}\n` +
    `- files: ${arr(node.files)}\n` +
    `- input: ${_lineSafe(node.input || '')}\n` +
    `- output: ${_lineSafe(node.output || '')}\n` +
    `- error-modes: ${arr(node.errorModes)}\n` +
    `- tests: ${arr(node.tests)}\n` +
    `- notes: ${_lineSafe(node.notes || '')}\n\n`;
}
 
function _featureImpactBfs(nodes, startId) {
  const byId = new Map(nodes.map(n => [n.id, n]));
   
  const dependents = new Map();
  for (const n of nodes) for (const dep of n.dependsOn || []) {
    if (!dependents.has(dep)) dependents.set(dep, []);
    dependents.get(dep).push(n.id);
  }
  const visited = new Set();
  const queue = [{ id: startId, depth: 0, via: 'self' }];
  const result = [];
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur.id)) continue;
    visited.add(cur.id);
    const node = byId.get(cur.id);
    if (!node) continue;
    if (cur.depth > 0) result.push({ id: cur.id, title: node.title, depth: cur.depth, via: cur.via, files: node.files, errorModes: node.errorModes });
    for (const next of node.affects || []) queue.push({ id: next, depth: cur.depth + 1, via: 'affects' });
    for (const next of node.coChangesWith || []) queue.push({ id: next, depth: cur.depth + 1, via: 'co-changes-with' });
     
     
    for (const next of dependents.get(cur.id) || []) queue.push({ id: next, depth: cur.depth + 1, via: 'depends-on(reverse)' });
  }
  return result;
}
 
 
 
 
function _parseChangelogBetween(changelogText, fromV, toV) {
  const text = changelogText || '';
  const headerRe = /^## (\d+\.\d+\.\d+)(?:\s+—\s+(\d{4}-\d{2}-\d{2}))?[^\n]*$/gm;
  const positions = [];
  let hm;
  while ((hm = headerRe.exec(text)) !== null) positions.push({ version: hm[1], date: hm[2] || null, start: hm.index, bodyStart: hm.index + hm[0].length });
  const sections = [];
  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1].start : text.length;
    sections.push({ version: positions[i].version, date: positions[i].date, body: text.slice(positions[i].bodyStart, end).trim() });
  }
   
  const ranged = sections.filter(s => {
    const cmp = (v1, v2) => {
      const a = v1.split('.').map(Number), b = v2.split('.').map(Number);
      for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
      return 0;
    };
    return cmp(s.version, fromV) > 0 && cmp(s.version, toV) <= 0;
  });
   
  for (const s of ranged) {
    s.newCommands = [];
    s.newFlags = [];
    s.newFiles = [];
     
    for (const cm of s.body.matchAll(/`leerness\s+([a-z][\w-]*(?:\s+[a-z][\w-]*)?)/g)) {
      const cmd = cm[1].trim();
      if (!s.newCommands.includes(cmd)) s.newCommands.push(cmd);
    }
     
    for (const fm of s.body.matchAll(/`(--[a-z][\w-]*)`/g)) {
      if (!s.newFlags.includes(fm[1])) s.newFlags.push(fm[1]);
    }
     
    for (const ff of s.body.matchAll(/`(\.leerness\/[\w./-]+\.(?:md|json|jsonl))`/g)) {
      if (!s.newFiles.includes(ff[1])) s.newFiles.push(ff[1]);
    }
  }
  return ranged;
}
 
 
 
 
function _cellSafe(s) { return _lineSafe(s).replace(/\|/g, '\\|'); }
function _cellUnescape(s) { return String(s == null ? '' : s).replace(/\\\|/g, '|'); }
 
 
 
function _lineSafe(s) { return String(s == null ? '' : s).replace(/\r\n|[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' '); }

 
 
 
 
let _defaultIgnorableRe;
try { _defaultIgnorableRe = new RegExp('\\p{Default_Ignorable_Code_Point}', 'gu'); }
catch {
  _defaultIgnorableRe = /[\u00ad\u034f\u061c\u115f-\u1160\u17b4-\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\u{1bca0}-\u{1bcaf}\u{1d173}-\u{1d17a}\u{e0000}-\u{e0fff}]/gu;
}
function stripDefaultIgnorables(value, options = {}) {
  let text = String(value == null ? '' : value);
  if (options.nfkc === true) {
    try { text = text.normalize('NFKC'); } catch {}
  }
  text = text.replace(_defaultIgnorableRe, '');
   
   
  if (options.visibleIdentity === true) text = text.replace(/\u2800/g, '');
  return text;
}

 
 
function _milestoneSurface(value) {
  const ms = value && typeof value === 'object' ? value : {};
  const available = ms.gitHistoryState === 'available';
  const reached = available && Array.isArray(ms.reached) ? ms.reached : null;
  const rawError = ms.gitHistoryError && typeof ms.gitHistoryError === 'object' ? ms.gitHistoryError : null;
  const error = available ? null : {
    code: _lineSafe(rawError && rawError.code || 'git_history_unavailable'),
    reason: _lineSafe(rawError && rawError.reason || 'aggregate_exception'),
    error: _lineSafe(rawError && rawError.error || 'Git history could not be measured')
  };
  return {
    totalRounds: available && Number.isInteger(ms.totalRounds) ? ms.totalRounds : null,
    reachedCount: reached ? reached.length : null,
    reached: reached ? reached.map(m => ({ milestone: m.milestone, version: m.version, reachedAt: m.reachedAt })) : null,
    next: available ? (ms.next || null) : null,
    avgRoundsPerDay: available && typeof ms.avgRoundsPerDay === 'number' ? ms.avgRoundsPerDay : null,
    gitHistoryState: available ? 'available' : 'unavailable',
    gitHistoryError: error
  };
}

function _recentChangesSurface(value) {
  const recent = value && typeof value === 'object' ? value : {};
  if (recent.state === 'available' && Array.isArray(recent.items)) {
     
     
     
    return recent.items;
  }
  const rawError = recent.error && typeof recent.error === 'object' ? recent.error : null;
  return {
    state: 'unavailable',
    error: {
      code: _lineSafe(rawError && rawError.code || 'git_history_unavailable'),
      reason: _lineSafe(rawError && rawError.reason || 'aggregate_exception'),
      error: _lineSafe(rawError && rawError.error || 'Git history could not be measured')
    },
    items: null
  };
}

 
 
function _recentChangesAggregate(value) {
  const surface = _recentChangesSurface(value);
  if (Array.isArray(surface)) {
    return { recentChanges: surface, recentChangesState: 'available', recentChangesError: null };
  }
  return {
    recentChanges: null,
    recentChangesState: surface.state,
    recentChangesError: surface.error
  };
}
 
function _parseLimit(raw, def) { const n = parseInt(raw, 10); return (Number.isFinite(n) && n > 0) ? n : def; }

 
 
function _minorKey(v) { const m = String(v || '').match(/^(\d+)\.(\d+)/); return m ? `${m[1]}.${m[2]}` : null; }
function _shouldPublishNpm(current, published, force) {
  if (force) return { publish: true, reason: 'forced' };
  const cm = String(current || '').match(/^(\d+)\.(\d+)/);
  if (!cm) return { publish: false, reason: 'invalid_current' };
  const pm = String(published || '').match(/^(\d+)\.(\d+)/);
  if (!pm) return { publish: true, reason: 'no_published' };           
  const c = [Number(cm[1]), Number(cm[2])], p = [Number(pm[1]), Number(pm[2])];
  if (c[0] > p[0] || (c[0] === p[0] && c[1] > p[1])) return { publish: true, reason: 'minor_bump' };   
  if (c[0] === p[0] && c[1] === p[1]) return { publish: false, reason: 'same_minor' };                 
  return { publish: false, reason: 'not_ahead' };                                                       
}

 
 
 
 
 
function _terminatorIndex(args) { return args && Number.isInteger(args.terminatorAt) ? args.terminatorAt : Infinity; }
 
function _parseAddTitle(args, startIdx = 0, { trim = true } = {}) {
  const list = args || [];
  const end = Math.min(list.length, _terminatorIndex(list));
  const parts = [];
  for (let i = startIdx; i < end; i++) {
    const a = list[i];
    if (typeof a !== 'string') break;
    if (a.startsWith('--') || /^([A-Za-z]:[\\/]|\/|\.\.?[\\/])/.test(a)) break;
    parts.push(a);
  }
  for (let i = Math.max(startIdx, end); i < list.length; i++) if (typeof list[i] === 'string') parts.push(list[i]);
  const text = parts.join(' ');
  return trim ? text.trim() : text;
}

 
 
 
const _TASK_VALUE_FLAGS = new Set(['--task','--status', '--evidence', '--priority', '--note', '--reason', '--title', '--desc', '--summary', '--id', '--limit', '--from', '--to', '--trigger', '--tag', '--files', '--depends-on', '--affects', '--co-changes-with']);   
 
 
 
const _TEXT_AFTER_TERMINATOR = new Set(['task add', 'decision add', 'decision drop', 'lesson save', 'lesson drop', 'requests add', 'rule add', 'feature add']);
function _taskPositionalPath(args, startIdx = 2) {
  const a = args || [];
  const end = _TEXT_AFTER_TERMINATOR.has(`${a[0]} ${a[1]}`) ? Math.min(a.length, _terminatorIndex(a)) : a.length;
  for (let i = startIdx; i < end; i++) {
    if (typeof a[i] !== 'string') continue;
    if (_TASK_VALUE_FLAGS.has(a[i - 1])) continue;           
    if (a[i].startsWith('-')) continue;                        
    if (/^([A-Za-z]:[\\/]|\/|\.\.?[\\/])/.test(a[i])) return a[i];   
  }
  return null;
}
