'use strict';
// lib/store-display.js — 프로젝트 저장소 값을 사람에게 보여 줄 때 쓰는 단일 규칙 (T-0325).
//   skill.json · platform-constraints.json · reuse-map.md 는 사람이나 외부 스킬 팩이 손으로 쓰는 파일이라, 문자열이 와야 할
//   자리에 객체·배열·누락 값이 온다. 템플릿에 그대로 넣으면 "[object Object]" · "a,b" · "undefined" 가 찍혔고, 배열 메서드를
//   부르던 곳(map · filter · join · forEach)은 크래시했다. 텍스트 출력과 생성 파일은 이 규칙을 지나고, --json 은 원래 값을 그대로 낸다.
//   한 줄 텍스트는 _lineSafe 로 제어문자를 공백으로 바꾼다 — 생성 Markdown 에 가짜 줄·머리글이 끼지 않고, 터미널 제어도 막는다.
const { _lineSafe } = require('./pure-utils');

// 문자열이면 한 줄로 만든 값, 아니면 빈 문자열.
function storeText(v) { return typeof v === 'string' ? _lineSafe(v) : ''; }

// 표시 이름: 공백뿐이거나 문자열이 아니면 fallback.
function storeName(v, fallback) { const s = storeText(v); return s.trim() ? s : fallback; }

// 파생 값(매칭 기준·--json 에 실리는 이름 등)용: 공백뿐이 아닌 문자열이면 원문 그대로, 아니면 빈 문자열. 한 줄 처리는 출력하는 곳에서.
function storeString(v) { return typeof v === 'string' && v.trim() ? v : ''; }

// 문자열 목록: 배열의 문자열 항목만.
function storeTextList(v) { return Array.isArray(v) ? v.filter(x => typeof x === 'string').map(_lineSafe) : []; }

// 객체 목록: 배열의 (null·배열이 아닌) 객체 항목만.
function storeObjects(v) { return Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : []; }

// 목록 길이: 배열이 아니면 0 — 문자열의 글자 수나 undefined 가 개수로 찍히지 않게.
function storeLength(v) { return Array.isArray(v) ? v.length : 0; }

// 횟수: 유한한 숫자가 아니면 0 — 객체·문자열이 "[object Object]회" 로 찍히거나 합계를 문자열 이어붙이기로 만들지 않게.
function storeNumber(v) { return Number.isFinite(v) ? v : 0; }

// skill.json 한 건의 표시용 사본. 기존 템플릿 식(data.description || data.displayNameKo …, (data.capabilities || []).map …)이
//   그대로 동작하도록 같은 필드 이름에 정리된 값을 담는다. 원본은 바꾸지 않는다.
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
    // 설치된 skill.json 은 { status, method } 객체, 카탈로그는 문자열이다 — 표시는 상태 문자열 하나로.
    verification: storeText(s.verification && typeof s.verification === 'object' ? s.verification.status : s.verification),
    capabilities: storeTextList(s.capabilities),
    // 출처는 URL 텍스트 목록으로: 문자열 항목, 또는 url 이 문자열인 객체의 url. 비거나 공백뿐이면 뺀다 — url 이 빈 객체는
    //   출력부의 `s.url || s` 에서 객체 자신이 되어 "[object Object]" 로 찍혔다(codex 검수 1차).
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
