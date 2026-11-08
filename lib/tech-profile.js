 
 
 
 
'use strict';
const path = require('path');
const fs = require('fs');
const { absRoot, exists, read, writeUtf8, log, ok, warn, failJson, now } = require('./io');

 
const LANG_SIGNALS = [
  { id: 'typescript', files: ['tsconfig.json'] },
  { id: 'javascript', files: ['package.json'] },
  { id: 'python', files: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'] },
  { id: 'go', files: ['go.mod'] },
  { id: 'rust', files: ['Cargo.toml'] },
  { id: 'java', files: ['pom.xml', 'build.gradle', 'build.gradle.kts'] },
  { id: 'csharp', glob: /\.(csproj|sln)$/i },
  { id: 'php', files: ['composer.json'] },
  { id: 'ruby', files: ['Gemfile'] },
];
const EXT_LANG = { '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript', '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.cs': 'csharp', '.php': 'php', '.rb': 'ruby' };

 
const SERVICE_SIGNALS = [
  { id: 'supabase', deps: ['@supabase/supabase-js', 'supabase'], env: ['SUPABASE_'] },
  { id: 'firebase', deps: ['firebase', 'firebase-admin'], env: ['FIREBASE_'], files: ['firebase.json'] },
  { id: 'stripe', deps: ['stripe'], env: ['STRIPE_'] },
  { id: 'openai', deps: ['openai'], env: ['OPENAI_'] },
  { id: 'anthropic', deps: ['@anthropic-ai/sdk', 'anthropic'], env: ['ANTHROPIC_'] },
  { id: 'aws', deps: ['aws-sdk', '@aws-sdk/client-s3', '@aws-sdk/core'], env: ['AWS_'], depPrefix: '@aws-sdk/' },
  { id: 'gcp', deps: ['@google-cloud/storage'], env: ['GOOGLE_CLOUD_', 'GCP_'], depPrefix: '@google-cloud/' },
  { id: 'azure', deps: [], env: ['AZURE_'], depPrefix: '@azure/' },
  { id: 'cloudflare', deps: ['wrangler'], env: ['CLOUDFLARE_', 'CF_ACCOUNT'], files: ['wrangler.toml', 'wrangler.jsonc'] },
  { id: 'vercel', deps: ['vercel'], env: ['VERCEL_'], files: ['vercel.json'] },
  { id: 'netlify', deps: ['netlify-cli'], env: ['NETLIFY_'], files: ['netlify.toml'] },
  { id: 'docker', deps: [], env: [], files: ['docker-compose.yml', 'docker-compose.yaml', 'Dockerfile'] },
   
  { id: 'postgres', deps: ['pg', 'postgres'], env: ['POSTGRES_', 'PG_'] },
  { id: 'mysql', deps: ['mysql', 'mysql2'], env: ['MYSQL_'] },
  { id: 'mongodb', deps: ['mongodb', 'mongoose'], env: ['MONGO_', 'MONGODB_'] },
  { id: 'redis', deps: ['redis', 'ioredis'], env: ['REDIS_'] },
  { id: 'prisma', deps: ['prisma', '@prisma/client'], files: ['prisma/schema.prisma'] },
  { id: 'telegram', deps: ['node-telegram-bot-api', 'telegraf'], env: ['TELEGRAM_'] },
  { id: 'discord', deps: ['discord.js'], env: ['DISCORD_'] },
  { id: 'github-api', deps: ['@octokit/rest', 'octokit'], env: ['GH_TOKEN', 'GITHUB_TOKEN'] },
];

 
 
 
 
 
const UI_SIGNALS = [
  { id: 'next', deps: ['next'], files: ['next.config.js', 'next.config.mjs', 'next.config.ts'] },
  { id: 'nuxt', deps: ['nuxt', 'nuxt3'], files: ['nuxt.config.ts', 'nuxt.config.js'] },
  { id: 'react', deps: ['react', 'react-dom'] },
  { id: 'vue', deps: ['vue'] },
  { id: 'svelte', deps: ['svelte', '@sveltejs/kit'] },
  { id: 'angular', deps: ['@angular/core'] },
  { id: 'solid', deps: ['solid-js'] },
  { id: 'astro', deps: ['astro'], files: ['astro.config.mjs'] },
  { id: 'tailwind', deps: ['tailwindcss'], files: ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs'] },
  { id: 'styled-components', deps: ['styled-components'] },
  { id: 'emotion', deps: ['@emotion/react', '@emotion/styled'] },
  { id: 'sass', deps: ['sass', 'node-sass'] },
  { id: 'vite', deps: ['vite'], files: ['vite.config.js', 'vite.config.ts'] },
  { id: 'django', files: ['manage.py'] },
  { id: 'flask', deps: [] },
];
function _envKeys(root) {
  const out = [];
  for (const f of ['.env', '.env.local', '.env.production']) {
    const p = path.join(root, f);
    if (!exists(p)) continue;
    try { for (const line of read(p).split('\n')) { const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/); if (m) out.push(m[1]); } } catch {}
  }
  return out;
}

function _shallowExts(root) {
  const counts = {};
  let _extBudget = 20000;    
  const scan = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
     
     
    for (const e of entries.slice(0, 5000)) {
      if (_extBudget <= 0) return;
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth > 0) scan(p, depth - 1); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (EXT_LANG[ext]) { counts[EXT_LANG[ext]] = (counts[EXT_LANG[ext]] || 0) + 1; _extBudget--; }
       
       
      else if (ext === '.html' || ext === '.htm') { counts['#html'] = (counts['#html'] || 0) + 1; _extBudget--; }
    }
  };
  scan(absRoot(root), 3);    
  return counts;
}

 
function detectTechProfile(root) {
  root = absRoot(root);
  const languages = []; const seenL = new Set();
  const addL = (id, evidence) => { if (!seenL.has(id)) { seenL.add(id); languages.push({ id, evidence }); } };
  for (const s of LANG_SIGNALS) {
    if (s.files) for (const f of s.files) if (exists(path.join(root, f))) { addL(s.id, f); break; }
    if (s.glob) { try { if (fs.readdirSync(root).some(n => s.glob.test(n))) addL(s.id, 'project file'); } catch {} }
  }
  const extCounts = _shallowExts(root);
  for (const [lang, n] of Object.entries(extCounts)) if (n >= 3 && lang[0] !== '#') addL(lang, `${n} source files`);    
   
   
   
  languages.sort((a, b) => (extCounts[b.id] || 0) - (extCounts[a.id] || 0));
  for (const l of languages) { const n = extCounts[l.id] || 0; if (n >= 3 && !/source files/.test(l.evidence)) l.evidence = `${l.evidence} · ${n} source files`; }
   
  let deps = {};
  let reqTxt = '';
  const _mergeManifests = (dir, depth) => {
    try {
      const pj = JSON.parse(read(path.join(dir, 'package.json')));
      deps = Object.assign({}, deps, pj.dependencies, pj.devDependencies);
      if (dir !== root) addL('javascript', rel_(dir) + '/package.json');
    } catch {}
    try { if (exists(path.join(dir, 'requirements.txt'))) reqTxt += '\n' + read(path.join(dir, 'requirements.txt')); } catch {}
    if (depth <= 0) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.slice(0, 200)) {
      if (!e.isDirectory() || e.name.startsWith('.') || ['node_modules', 'dist', 'build', 'vendor', 'coverage'].includes(e.name)) continue;
      _mergeManifests(path.join(dir, e.name), depth - 1);
    }
  };
  const rel_ = (d) => path.relative(root, d).replace(/\\/g, '/');
  _mergeManifests(root, 2);
  const envKeys = _envKeys(root);
  const services = []; const seenS = new Set();
  const addS = (id, evidence) => { if (!seenS.has(id)) { seenS.add(id); services.push({ id, evidence }); } };
  for (const s of SERVICE_SIGNALS) {
     
     
    for (const d of (s.deps || [])) {
      const reqHit = new RegExp(`^\\s*${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-_]/g, '[-_]')}\\s*(?:[=<>!~;\\[]|$)`, 'mi').test(reqTxt);
      if (deps[d] || reqHit) { addS(s.id, `dep: ${d}`); break; }
    }
    if (!seenS.has(s.id) && s.depPrefix) { const hit = Object.keys(deps).find(k => k.startsWith(s.depPrefix)); if (hit) addS(s.id, `dep: ${hit}`); }
    if (!seenS.has(s.id)) for (const pre of (s.env || [])) { const hit = envKeys.find(k => k === pre || k.startsWith(pre)); if (hit) { addS(s.id, `env: ${hit}`); break; } }
    if (!seenS.has(s.id)) for (const f of (s.files || [])) if (exists(path.join(root, f))) { addS(s.id, `file: ${f}`); break; }
  }
   
   
  const ui = []; const seenU = new Set();
  const addU = (id, evidence) => { if (!seenU.has(id)) { seenU.add(id); ui.push({ id, evidence }); } };
  for (const u of UI_SIGNALS) {
    for (const d of (u.deps || [])) if (deps[d]) { addU(u.id, `dep: ${d}`); break; }
    if (!seenU.has(u.id)) for (const f of (u.files || [])) if (exists(path.join(root, f))) { addU(u.id, `file: ${f}`); break; }
  }
  if (/^\s*(?:flask|Flask)\s*(?:[=<>!~;[]|$)/mi.test(reqTxt)) addU('flask', 'requirements: flask');
  if (/^\s*django\s*(?:[=<>!~;[]|$)/mi.test(reqTxt)) addU('django', 'requirements: django');
  if (!ui.length) {
    const htmlCount = extCounts['#html'] || 0;
    if (htmlCount > 0) addU('plain-html', `${htmlCount} html files · 프레임워크 신호 없음`);
  }
  return { languages, services, ui };
}

function _techPath(root) { return path.join(absRoot(root), '.leerness', 'tech-profile.json'); }

function loadTechProfile(root, reader = null) {
  const { read, exists } = reader || require('./io');
  const f = _techPath(root);
  if (!exists(f)) return null;
  const source = read(f);
  try { return JSON.parse(source); } catch { return null; }
}

 
function refreshTechProfile(root, opts = {}) {
  root = absRoot(root);
  if (!exists(path.join(root, '.leerness'))) return null;
  const cur = detectTechProfile(root);
  let prev = loadTechProfile(root);
   
   
  if (prev && (!prev.current || !Array.isArray(prev.current.languages) || !Array.isArray(prev.current.services))) prev = null;
  const ids = a => (a || []).map(x => x.id);
  const dif = (a, b) => a.filter(x => !b.includes(x));
  let history = (prev && Array.isArray(prev.history)) ? prev.history : [];
  let changed = false; let diff = null;
  if (prev && prev.current) {
    const aL = dif(ids(cur.languages), ids(prev.current.languages)), rL = dif(ids(prev.current.languages), ids(cur.languages));
    const aS = dif(ids(cur.services), ids(prev.current.services)), rS = dif(ids(prev.current.services), ids(cur.services));
     
     
    const aU = dif(ids(cur.ui || []), ids(prev.current.ui || [])), rU = dif(ids(prev.current.ui || []), ids(cur.ui || []));
    if (aL.length || rL.length || aS.length || rS.length || aU.length || rU.length) {
      changed = true;
      diff = { at: now(), addedLanguages: aL, removedLanguages: rL, addedServices: aS, removedServices: rS };
      if (aU.length) diff.addedUi = aU;
      if (rU.length) diff.removedUi = rU;
      history = [...history, diff].slice(-50);
    }
  } else if (!prev) { changed = true; }
  const profile = { current: cur, updatedAt: now(), history };
  if (changed || !prev) {
     
    writeUtf8(_techPath(root), JSON.stringify(profile, null, 2) + '\n');
  }
  return { profile, changed, diff };
}

 
function techCmd(root, sub, deps = {}) {
  const { has } = deps;
  root = absRoot(root);
  const json = !!(has && has('--json'));
  if (!exists(path.join(root, '.leerness'))) { failJson(json, 'harness_missing', `leerness 미설치: ${root} — 먼저 leerness init`); return; }
  const r = refreshTechProfile(root);    
   
   
  if (r && r.changed && typeof deps.regenGraph === 'function') { try { deps.regenGraph(root); } catch {} }
  const p = r.profile;
  if (json) { log(JSON.stringify({ ok: true, ...p, changedNow: r.changed, diffNow: r.diff }, null, 2)); return; }
  log(`# leerness tech — 프로젝트 기술 프로필 (${p.updatedAt.slice(0, 10)})`);
  log(`  언어: ${p.current.languages.length ? p.current.languages.map(l => `${l.id} (${l.evidence})`).join(' · ') : '(감지 없음)'}`);
  log(`  서비스: ${p.current.services.length ? p.current.services.map(s => `${s.id} (${s.evidence})`).join(' · ') : '(감지 없음)'}`);
   
  if (Array.isArray(p.current.ui)) log(`  UI: ${p.current.ui.length ? p.current.ui.map(u => `${u.id} (${u.evidence})`).join(' · ') : '(감지 없음)'}`);
  if (p.history.length) {
    log(`\n  변경 이력 (${p.history.length}건 — 마이그레이션/언어 전환 추적):`);
    for (const h of p.history.slice(-8)) {
      const parts = [];
      if (h.addedLanguages.length) parts.push(`+언어 ${h.addedLanguages.join(',')}`);
      if (h.removedLanguages.length) parts.push(`-언어 ${h.removedLanguages.join(',')}`);
      if (h.addedServices.length) parts.push(`+서비스 ${h.addedServices.join(',')}`);
      if (h.removedServices.length) parts.push(`-서비스 ${h.removedServices.join(',')}`);
      log(`    · ${h.at.slice(0, 16)} ${parts.join(' · ')}`);
    }
  } else log(`  (변경 이력 없음 — 서비스/언어가 바뀌면 자동 기록)`);
  log(`\n  ⓘ 온톨로지 그래프(leerness.html) 🛠 기술 탭에 표시 · 갱신: leerness tech (handoff 가 자동 갱신)`);
}

module.exports = { LANG_SIGNALS, SERVICE_SIGNALS, detectTechProfile, loadTechProfile, refreshTechProfile, techCmd, _techPath };
