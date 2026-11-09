 
 
//
 
 
 
 
 
 
 
'use strict';

 
 
 
function tokenizeForRank(s) {
  const out = [];
  const base = String(s || '').toLowerCase().split(/[^0-9a-z가-힣_]+/i).filter(Boolean);
  for (const t of base) {
    out.push(t);
    if (t.length <= 16 && /^[가-힣]+$/.test(t) && t.length >= 3) {
      const max = Math.min(t.length - 1, 2 + 6);
      for (let k = 2; k <= max; k++) out.push(t.slice(0, k));
    }
  }
  return out;
}

 
function expandQuery(query, synonymMap) {
  const q = String(query || '').trim();
  if (!q) return [];
  const key = q.toLowerCase();
  const out = [q];
  for (const s of (synonymMap && synonymMap[key]) || []) {
    if (s && String(s).toLowerCase() !== key) out.push(String(s));
  }
  return [...new Set(out)];
}

 
 
function scoreHits(query, hits, opts = {}) {
  const k1 = opts.k1 == null ? 1.5 : opts.k1;
  const b = opts.b == null ? 0.75 : opts.b;
  const qTokens = [...new Set(tokenizeForRank(query))];
  const docs = hits.map(h => tokenizeForRank((h && h.text) || ''));
  const N = docs.length || 1;
  const avgdl = (docs.reduce((s, d) => s + d.length, 0) / N) || 1;
  const df = Object.create(null);
  for (const d of docs) for (const t of new Set(d)) df[t] = (df[t] || 0) + 1;
  return hits.map((h, i) => {
    const d = docs[i], dl = d.length || 1;
    const tf = Object.create(null);
    for (const t of d) tf[t] = (tf[t] || 0) + 1;
    let score = 0;
    for (const q of qTokens) {
      const f = tf[q] || 0;
      if (!f) continue;
      const n = df[q] || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (dl / avgdl))));
    }
    return Object.assign({}, h, { score: Math.round(score * 1000) / 1000 });
  });
}

 
function suggestTerms(query, vocab, opts = {}) {
  const minPrefix = opts.minPrefix || 2;
  const limit = opts.limit || 5;
  const q = String(query || '').toLowerCase().trim();
  if (q.length < minPrefix || !vocab) return [];
  const pre = q.slice(0, Math.min(3, Math.max(minPrefix, q.length)));
  const out = [];
  for (const v of vocab) {
    const lv = String(v || '').toLowerCase();
    if (!lv || lv === q) continue;
    if (lv.startsWith(pre) || (lv.length >= minPrefix && q.startsWith(lv.slice(0, minPrefix)))) out.push(String(v));
    if (out.length >= limit * 4) break;
  }
  return [...new Set(out)].slice(0, limit);
}

module.exports = { tokenizeForRank, expandQuery, scoreHits, suggestTerms };
