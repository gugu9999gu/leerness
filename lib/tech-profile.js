// lib/tech-profile.js — 프로젝트 기술 프로필 (1.36.53, 사용자 요청 UR-0062).
//   무엇으로 개발 중인가(언어) + 어디에 연결돼 있는가(서비스)를 파일 신호로 자동 감지하고,
//   변경 이력(언어 전환/서비스 마이그레이션)을 .harness/tech-profile.json 에 누적한다.
//   신호는 전부 로컬 파일(매니페스트/의존성/.env 키 이름/설정파일) — 네트워크 0 · .env 값은 절대 읽지 않고 키 이름만.
'use strict';
const path = require('path');
const fs = require('fs');
const { absRoot, exists, read, writeUtf8, log, ok, warn, failJson, now } = require('./io');

// 언어 신호: 매니페스트 파일 존재 (확장자 통계는 보조 — 얕은 스캔만)
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

// 서비스 신호: deps 이름 / .env 키 접두 / 설정 파일
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
  // 1.36.54 (codex 7차 #4): DATABASE_URL 은 DB 중립 키(mysql:// 일 수도) — postgres 양성 신호에서 제외 (.env 값은 안 읽는 원칙 유지)
  { id: 'postgres', deps: ['pg', 'postgres'], env: ['POSTGRES_', 'PG_'] },
  { id: 'mysql', deps: ['mysql', 'mysql2'], env: ['MYSQL_'] },
  { id: 'mongodb', deps: ['mongodb', 'mongoose'], env: ['MONGO_', 'MONGODB_'] },
  { id: 'redis', deps: ['redis', 'ioredis'], env: ['REDIS_'] },
  { id: 'prisma', deps: ['prisma', '@prisma/client'], files: ['prisma/schema.prisma'] },
  { id: 'telegram', deps: ['node-telegram-bot-api', 'telegraf'], env: ['TELEGRAM_'] },
  { id: 'discord', deps: ['discord.js'], env: ['DISCORD_'] },
  { id: 'github-api', deps: ['@octokit/rest', 'octokit'], env: ['GH_TOKEN', 'GITHUB_TOKEN'] },
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
  const scan = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.slice(0, 400)) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth > 0) scan(p, depth - 1); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (EXT_LANG[ext]) counts[EXT_LANG[ext]] = (counts[EXT_LANG[ext]] || 0) + 1;
    }
  };
  scan(absRoot(root), 2);
  return counts;
}

// 순수-ish 감지 코어 — { languages:[{id,evidence}], services:[{id,evidence}] }
function detectTechProfile(root) {
  root = absRoot(root);
  const languages = []; const seenL = new Set();
  const addL = (id, evidence) => { if (!seenL.has(id)) { seenL.add(id); languages.push({ id, evidence }); } };
  for (const s of LANG_SIGNALS) {
    if (s.files) for (const f of s.files) if (exists(path.join(root, f))) { addL(s.id, f); break; }
    if (s.glob) { try { if (fs.readdirSync(root).some(n => s.glob.test(n))) addL(s.id, 'project file'); } catch {} }
  }
  const extCounts = _shallowExts(root);
  for (const [lang, n] of Object.entries(extCounts)) if (n >= 3) addL(lang, `${n} source files`);
  // deps 수집 — 1.36.54 (#5): 모노레포 대응, 루트 + 얕은 하위(2단계) 매니페스트 병합 (vendor 류 제외)
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
    // 1.36.54 (#12): requirements 는 배포명 전체 일치만 — `\b` 가 점을 경계로 봐 openai.fake 가 openai 에 오탐했다.
    //   이름 뒤는 버전 연산자/extras/공백/행끝만 허용 (PEP 스타일: 대소문자·-/_ 동치).
    for (const d of (s.deps || [])) {
      const reqHit = new RegExp(`^\\s*${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-_]/g, '[-_]')}\\s*(?:[=<>!~;\\[]|$)`, 'mi').test(reqTxt);
      if (deps[d] || reqHit) { addS(s.id, `dep: ${d}`); break; }
    }
    if (!seenS.has(s.id) && s.depPrefix) { const hit = Object.keys(deps).find(k => k.startsWith(s.depPrefix)); if (hit) addS(s.id, `dep: ${hit}`); }
    if (!seenS.has(s.id)) for (const pre of (s.env || [])) { const hit = envKeys.find(k => k === pre || k.startsWith(pre)); if (hit) { addS(s.id, `env: ${hit}`); break; } }
    if (!seenS.has(s.id)) for (const f of (s.files || [])) if (exists(path.join(root, f))) { addS(s.id, `file: ${f}`); break; }
  }
  return { languages, services };
}

function _techPath(root) { return path.join(absRoot(root), '.harness', 'tech-profile.json'); }

function loadTechProfile(root) {
  const f = _techPath(root);
  if (!exists(f)) return null;
  try { return JSON.parse(read(f)); } catch { return null; }
}

// 감지 → 저장 + 변경 이력(diff) 누적. 반환: { profile, changed, diff }
function refreshTechProfile(root, opts = {}) {
  root = absRoot(root);
  if (!exists(path.join(root, '.harness'))) return null;
  const cur = detectTechProfile(root);
  let prev = loadTechProfile(root);
  // 1.36.54 (#6): 파싱은 되지만 스키마가 무효(current/languages 부재)인 프로필은 부재 취급 — 종전엔 {} 가
  //   "이전 프로필"로 오인돼 changed=false 로 고착, 영원히 재기록/이력 축적이 안 됐다. (스키마-무효는 재생성 대상)
  if (prev && (!prev.current || !Array.isArray(prev.current.languages) || !Array.isArray(prev.current.services))) prev = null;
  const ids = a => (a || []).map(x => x.id);
  const dif = (a, b) => a.filter(x => !b.includes(x));
  let history = (prev && Array.isArray(prev.history)) ? prev.history : [];
  let changed = false; let diff = null;
  if (prev && prev.current) {
    const aL = dif(ids(cur.languages), ids(prev.current.languages)), rL = dif(ids(prev.current.languages), ids(cur.languages));
    const aS = dif(ids(cur.services), ids(prev.current.services)), rS = dif(ids(prev.current.services), ids(cur.services));
    if (aL.length || rL.length || aS.length || rS.length) {
      changed = true;
      diff = { at: now(), addedLanguages: aL, removedLanguages: rL, addedServices: aS, removedServices: rS };
      history = [...history, diff].slice(-50);
    }
  } else if (!prev) { changed = true; }
  const profile = { current: cur, updatedAt: now(), history };
  if (changed || !prev) {
    // 손상 스토어는 writeUtf8 의 .corrupt-* 대피가 원본을 보존한다 (1.36.50)
    writeUtf8(_techPath(root), JSON.stringify(profile, null, 2) + '\n');
  }
  return { profile, changed, diff };
}

// `leerness tech [refresh] [--json]`
function techCmd(root, sub, deps = {}) {
  const { has } = deps;
  root = absRoot(root);
  const json = !!(has && has('--json'));
  if (!exists(path.join(root, '.harness'))) { failJson(json, 'harness_missing', `leerness 미설치: ${root} — 먼저 leerness init`); return; }
  const r = refreshTechProfile(root);   // show 도 항상 최신화(감지는 저비용·로컬)
  // 1.36.67 (8차 헌트 F15): 프로필이 실제로 바뀌었고 그래프 산출물이 이미 있으면 함께 갱신 —
  //   종전엔 tech 만 최신, leerness.html 🛠 탭은 옛 서비스를 계속 보여줬다(handoff 전까지 불일치).
  if (r && r.changed && typeof deps.regenGraph === 'function') { try { deps.regenGraph(root); } catch {} }
  const p = r.profile;
  if (json) { log(JSON.stringify({ ok: true, ...p, changedNow: r.changed, diffNow: r.diff }, null, 2)); return; }
  log(`# leerness tech — 프로젝트 기술 프로필 (${p.updatedAt.slice(0, 10)})`);
  log(`  언어: ${p.current.languages.length ? p.current.languages.map(l => `${l.id} (${l.evidence})`).join(' · ') : '(감지 없음)'}`);
  log(`  서비스: ${p.current.services.length ? p.current.services.map(s => `${s.id} (${s.evidence})`).join(' · ') : '(감지 없음)'}`);
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
