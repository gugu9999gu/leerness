 
 
 
 
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));    
 
if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
  console.log(`✗ lint: root not found — ${ROOT}`);
  process.exit(1);
}
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
 
if (!jsFiles.length) {
  console.log(`✗ lint: no js files found under ${TARGET_DIRS.join('/')} in ${ROOT} — nothing was checked`);
  process.exit(1);
}

 
for (const f of jsFiles) {
  const r = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8', timeout: 30000 });
  if (r.error) { failures.push(`syntax-check spawn failed: ${path.relative(ROOT, f)} — ${r.error.code || r.error.message}`); continue; }    
  if (r.status !== 0) {
    const lines = (r.stderr || '').split('\n');
    const detail = lines.find(l => /Error/.test(l)) || lines[0] || '';    
    failures.push(`syntax: ${path.relative(ROOT, f)} — ${detail.trim()}`);
  }
}

 
for (const f of jsFiles) {
  const buf = fs.readFileSync(f);
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) failures.push(`bom: ${path.relative(ROOT, f)}`);
  const text = buf.toString('utf8');
  const ls = text.indexOf('\u2028'); const ps = text.indexOf('\u2029');    
  if (ls >= 0) failures.push(`U+2028 line-separator: ${path.relative(ROOT, f)}:${text.slice(0, ls).split('\n').length} (과거 전-명령 SyntaxError 실사고 문자)`);
  if (ps >= 0) failures.push(`U+2029 paragraph-separator: ${path.relative(ROOT, f)}:${text.slice(0, ps).split('\n').length}`);
}

 
const jsonFiles = ['package.json', ...listFiles(path.join(ROOT, 'lib'), '.json'), ...listFiles(path.join(ROOT, 'scripts'), '.json')].map(f => path.isAbsolute(f) ? f : path.join(ROOT, f));
for (const f of jsonFiles) {
  if (!fs.existsSync(f)) continue;
  try { JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch (e) { failures.push(`json: ${path.relative(ROOT, f)} — ${e.message.slice(0, 80)}`); }
}

 
 
 
 
 
let testSteps = 0;
{
  let scripts = {};
  try { scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').replace(/^\uFEFF/, '')).scripts || {}; } catch {   }
  const expand = (name, stack) => {
    if (stack.includes(name)) { failures.push(`npm scripts cycle: ${[...stack, name].join(' -> ')}`); return []; }
    return String(scripts[name]).split('&&').map(p => p.trim()).filter(Boolean).flatMap(p => {
      const m = p.match(/^npm run ([\w:.-]+)$/);
      return m && typeof scripts[m[1]] === 'string' ? expand(m[1], [...stack, name]) : [p];
    });
  };
  if (typeof scripts.test === 'string') {
    const seen = new Set(); const dup = new Set();
    for (const step of expand('test', [])) { testSteps++; (seen.has(step) ? dup : seen).add(step); }
    if (dup.size) failures.push(`npm test runs ${dup.size} step(s) more than once: ${[...dup].slice(0, 3).join(' | ')}${dup.size > 3 ? ' | ...' : ''}`);
  }
}

if (failures.length) {
  console.log(`✗ lint: ${failures.length} issue(s)`);
  failures.forEach(x => console.log('  - ' + x));
  process.exit(1);
}
console.log(`✓ lint: ${jsFiles.length} js (syntax/U+2028/BOM) + ${jsonFiles.length} json + npm test ${testSteps} steps (no repeats) — clean`);
