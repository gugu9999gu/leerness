// lib/state-integrity.js — .harness/*.json 상태파일 JSON 무결성 검사 (단일출처, 1.36.1).
//   배경(클린룸 리뷰 FN): health/doctor/check/audit 는 상태 JSON 을 try{JSON.parse}catch{빈 상태} 로 그레이스풀
//   폴백하느라, .harness/manifest.json 등이 깨진 JSON 이어도 전부 "healthy"/exit 0 을 반환하던 false-negative 가 있었다.
//   → 어떤 명령도 워크스페이스 상태파일의 JSON 무결성을 검증하지 않던 갭을 이 헬퍼로 메운다(audit/health/check 공유).
'use strict';
const fs = require('fs');
const path = require('path');

// .harness 바로 아래의 *.json 상태파일을 열거해 JSON.parse 를 시도, 파싱 실패 파일 목록을 반환.
//   반환: [{ file: '.harness/<name>.json', error: '<message>' }, …]  (파일명 오름차순 — 결정적/테스트 안정).
//   설계:
//     - 존재하는 파일만 검사(부재는 무결성 문제 아님 — 그레이스풀 빈 상태로 취급).
//     - 비-재귀(archive/api-skills/cache 하위는 코어 상태파일 아님 → 오탐 방지) · 파일만(디렉토리 skip).
//     - 빈/공백-only 파일은 손상 아님(그레이스풀 빈 상태) — 오탐 차단.
//     - BOM strip 후 파싱(io.read 와 동일 — Windows PowerShell Out-File 등의 BOM 대응).
//     - 비-크래시: .harness 부재/디렉토리 읽기 오류 → 빈 배열, 개별 파일 읽기 오류 → skip.
function findCorruptedStateJson(root) {
  const dir = path.join(root, '.harness');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }  // .harness 없으면 검사 대상 0 (미초기화는 별도 체크가 담당)
  const corrupted = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const p = path.join(dir, e.name);
    let text;
    try { text = fs.readFileSync(p, 'utf8'); }
    catch { continue; }  // 읽기 불가(권한 등)는 JSON 무결성과 별개 문제 — skip
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);  // BOM strip
    if (text.trim() === '') continue;                          // 빈 파일 = 그레이스풀 빈 상태(손상 아님)
    try { JSON.parse(text); }
    catch (err) { corrupted.push({ file: '.harness/' + e.name, error: String((err && err.message) || err).slice(0, 200) }); }
  }
  corrupted.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return corrupted;
}

module.exports = { findCorruptedStateJson };
