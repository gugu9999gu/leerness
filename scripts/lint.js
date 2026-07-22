// scripts/lint.js — 0-deps 경량 lint 게이트 (1.36.64, 외부감사 F-10: lint/typecheck 부재)
//   범위: 배포되는 모든 .js 의 ① node --check 구문 ② 위험 문자(U+2028/U+2029 — 과거 raw U+2028 정규식 리터럴이
//   전 명령 SyntaxError 를 일으킨 실사고 재발 차단) ③ BOM ④ 저장소 .json 파싱 유효성.
//   빠르고(수 초) CI 친화(exit 1). npm run lint / test:fast 에 배선.
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));   // 테스트용 루트 오버라이드 허용
const TARGET_DIRS = ['bin', 'lib', 'scripts'];
const failures = [];

function listFiles(dir, ext) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(ext)) out.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

const jsFiles = TARGET_DIRS.flatMap(d => listFiles(path.join(ROOT, d), '.js'));

// ① 구문 (node --check)
for (const f of jsFiles) {
  const r = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8', timeout: 30000 });
  if (r.error) { failures.push(`syntax-check spawn failed: ${path.relative(ROOT, f)} — ${r.error.code || r.error.message}`); continue; }   // (검수 #3) 스폰 실패를 구문오류와 구분
  if (r.status !== 0) {
    const lines = (r.stderr || '').split('\n');
    const detail = lines.find(l => /Error/.test(l)) || lines[0] || '';   // (검수 #3) SyntaxError 본문 우선
    failures.push(`syntax: ${path.relative(ROOT, f)} — ${detail.trim()}`);
  }
}

// ② 위험 문자 + ③ BOM
for (const f of jsFiles) {
  const buf = fs.readFileSync(f);
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) failures.push(`bom: ${path.relative(ROOT, f)}`);
  const text = buf.toString('utf8');
  const ls = text.indexOf('\u2028'); const ps = text.indexOf('\u2029');   // 이스케이프 표기 — 자기참조 트랩 방지
  if (ls >= 0) failures.push(`U+2028 line-separator: ${path.relative(ROOT, f)}:${text.slice(0, ls).split('\n').length} (과거 전-명령 SyntaxError 실사고 문자)`);
  if (ps >= 0) failures.push(`U+2029 paragraph-separator: ${path.relative(ROOT, f)}:${text.slice(0, ps).split('\n').length}`);
}

// ④ 저장소 JSON 유효성 (배포 관련 루트 + data 성격 파일)
const jsonFiles = ['package.json', ...listFiles(path.join(ROOT, 'lib'), '.json'), ...listFiles(path.join(ROOT, 'scripts'), '.json')].map(f => path.isAbsolute(f) ? f : path.join(ROOT, f));
for (const f of jsonFiles) {
  if (!fs.existsSync(f)) continue;
  try { JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch (e) { failures.push(`json: ${path.relative(ROOT, f)} — ${e.message.slice(0, 80)}`); }
}

if (failures.length) {
  console.log(`✗ lint: ${failures.length} issue(s)`);
  failures.forEach(x => console.log('  - ' + x));
  process.exit(1);
}
console.log(`✓ lint: ${jsFiles.length} js (syntax/U+2028/BOM) + ${jsonFiles.length} json — clean`);
