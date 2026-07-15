// lib/search-core.js — memory search 랭킹 코어 (1.36.23). 순수함수 · 0-deps · 부작용 0.
//   require.main 가드(1.9.255) 덕에 단위테스트 가능. 산술(Math.log)만 사용 — 외부 의존성 없음.
//
// ★ 설계 불변식 — 이 모듈은 "정렬"만 한다. "무엇이 히트냐"(리콜)는 caller 의 substring regex 가 담당.
//   이유: 토큰화 리콜은 **언어별 형태론 가정**을 끌어들인다. substring 은 언어 중립적이고 현 동작의 상위집합이라 안전하다.
//   실측 사례(교착어): `memory search "핸드오프"` 는 substring 이라 "핸드오프**를** 자동화…" 를 찾지만, 공백 토큰화 BM25 로
//   리콜을 대체하면 doc 토큰이 ['핸드오프를',…] 이라 쿼리와 불일치 → **지금 찾히는 문서가 0건**이 된다. 조사·굴절·합성어가
//   있는 어떤 언어에서도 같은 계열의 손실이 난다(독일어 합성어, 터키어 교착 등). 형태소 분석기는 의존성 0 원칙상 불가.
//   따라서 BM25 는 랭킹 레이어로만 두고 리콜은 substring 유지 → tokenizeForRank 가 틀려도 히트가 사라지지 않는 안전판
//   (정렬 순서만 나빠질 뿐). 한글 prefix 변형은 그 근사치일 뿐 정확도 요구사항이 아니다.
'use strict';

// 랭킹 전용 토크나이저. 한글 토큰은 조사/어미 절단을 근사하려고 prefix 변형도 함께 방출한다
//   ('핸드오프를' → 핸드오프를/핸드/핸드오/핸드오프) → 쿼리 '핸드오프' 가 스코어를 받는다.
//   상한(len<=16, prefix<=6개)으로 긴 문자열의 토큰 폭발을 막는다. 정렬 전용이라 근사로 충분.
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

// 동의어 확장 — 맵을 인자로 주입받아 순수성 유지(카탈로그 의존 X). 원본을 항상 첫 요소로 둔다.
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

// BM25 — 히트 집합 내 상대 랭킹용. docs = hits 자체(각 라인이 1문서). 희귀어를 포함한 히트가 위로 온다.
//   k1=1.5 / b=0.75 (표준). 히트가 1건이면 idf 가 평탄해도 순서에 영향 없음.
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

// 0건일 때 근접어 제안 — 실제 색인 어휘(vocab)만 근거로. 지어내지 않는다.
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
