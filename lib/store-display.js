'use strict';
 
 
 
 
 
const { _lineSafe } = require('./pure-utils');

 
function storeText(v) { return typeof v === 'string' ? _lineSafe(v) : ''; }

 
function storeName(v, fallback) { const s = storeText(v); return s.trim() ? s : fallback; }

 
function storeString(v) { return typeof v === 'string' && v.trim() ? v : ''; }

 
function storeTextList(v) { return Array.isArray(v) ? v.filter(x => typeof x === 'string').map(_lineSafe) : []; }

 
function storeObjects(v) { return Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : []; }

 
function storeLength(v) { return Array.isArray(v) ? v.length : 0; }

 
function storeNumber(v) { return Number.isFinite(v) ? v : 0; }

 
 
function skillDisplay(v) {
  const s = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const usage = s.usage && typeof s.usage === 'object' ? s.usage : {};
  return {
    ...s,
    name: storeText(s.name),
    displayNameKo: storeText(s.displayNameKo),
    description: storeText(s.description),
    version: storeText(s.version),
    lastUpdated: storeText(s.lastUpdated),
     
    verification: storeText(s.verification && typeof s.verification === 'object' ? s.verification.status : s.verification),
    capabilities: storeTextList(s.capabilities),
     
     
    sources: (Array.isArray(s.sources) ? s.sources : [])
      .map(x => (typeof x === 'string' ? x : (x && typeof x === 'object' && typeof x.url === 'string' ? x.url : '')))
      .map(_lineSafe)
      .filter(x => x.trim()),
    patterns: storeObjects(s.patterns).map(p => ({ ...p, command: storeText(p.command), note: storeText(p.note) })),
    optimizations: storeObjects(s.optimizations).map(o => ({ ...o, at: storeText(o.at), note: storeText(o.note), before: storeText(o.before), after: storeText(o.after) })),
    usage: { ...usage, count: storeNumber(usage.count), lastUsed: storeText(usage.lastUsed) || null, lastNote: storeText(usage.lastNote) },
  };
}

module.exports = { storeText, storeName, storeString, storeTextList, storeObjects, storeLength, storeNumber, skillDisplay };
