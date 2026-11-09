 
 
 
'use strict';
const cp = require('child_process');
const path = require('path');
const { log, ok, warn, fail, failJson, today, now, absRoot, exists, read, readBuf, mkdirp, writeUtf8, append, rel } = require('./io');
const { SECRET_PATTERNS } = require('./catalogs');
const { findCorruptedStateJson } = require('./state-integrity');   
const { inspectWorkspace, CANONICAL_WORKSPACE_DIR, LEGACY_WORKSPACE_DIR } = require('./workspace-dir');
const { spawnNpmSync } = require('./npm-process');
const { _briefUnfilled, _planGoalUnfilled, _detectOrphanGuards, _normPath, _parseEnvKeys, _taskMatchText } = require('./pure-utils');   
const fs = require('fs');

 
 
 
 
 
function _collectGuardInputs(root) {
   
   
   
  const MAX_FILE = 2 * 1024 * 1024, MAX_TOTAL = 16 * 1024 * 1024;
  let readErrors = 0, skippedLarge = 0, totalBytes = 0;
  const rd = (p) => {
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) return null;
      if (st.size > MAX_FILE) { skippedLarge++; return null; }
      if (totalBytes + st.size > MAX_TOTAL) { skippedLarge++; return null; }
      const t = fs.readFileSync(p, 'utf8');
      totalBytes += st.size;
      return t;
    } catch (e) { if (e && e.code !== 'ENOENT') readErrors++; return null; }
  };
  let packageScripts = {};
  let ownEntries = new Set();
  let workspaces = false;
  try {
     
    const _pkgRaw = rd(path.join(root, 'package.json'));
    if (_pkgRaw != null && !String(_pkgRaw).trim()) throw new Error('empty package.json');
    const pkg = JSON.parse(_pkgRaw || '{}');
    packageScripts = pkg.scripts || {};
    workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces.length > 0 : !!(pkg.workspaces && pkg.workspaces.packages);
     
     
     
    const ent = [];
    if (typeof pkg.bin === 'string') ent.push(pkg.bin);
    else if (pkg.bin && typeof pkg.bin === 'object') ent.push(...Object.values(pkg.bin));
    if (typeof pkg.main === 'string') ent.push(pkg.main);
     
     
     
     
    ownEntries = new Set(ent.filter(x => typeof x === 'string').map(x => _normPath(x).replace(/^\.\//, '')));
  } catch { readErrors++; }    
   
   
   
   
   
   
   
  const runners = [];
   
   
   
  const push = (file, viaScript) => {
    const found = runners.find(r => r.file === file);
    if (found) {
      if (!viaScript) found.unconditional = true;
      else if (!found.viaScripts.includes(viaScript)) found.viaScripts.push(viaScript);
      return;
    }
    const t = rd(path.join(root, file));
     
     
     
     
    if (t != null) runners.push({ file, text: t, viaScript: viaScript || null, viaScripts: viaScript ? [viaScript] : [], unconditional: !viaScript, ownEntry: ownEntries.has(file) });
  };
  try { for (const f of fs.readdirSync(path.join(root, '.github', 'workflows'))) if (/\.ya?ml$/.test(f)) push(`.github/workflows/${f}`); } catch {}
   
   
  for (const f of ['.gitlab-ci.yml', '.gitlab-ci.yaml', 'azure-pipelines.yml', 'Jenkinsfile',
    'Makefile', 'makefile', 'GNUmakefile', 'Taskfile.yml', 'justfile',
    '.husky/pre-commit', '.husky/pre-push', '.husky/commit-msg', '.husky/post-merge']) push(f);
  try { for (const f of fs.readdirSync(path.join(root, '.circleci'))) if (/\.ya?ml$/.test(f)) push(`.circleci/${f}`); } catch {}
   
   
   
   
   
   
  const _FILE_RE = /[\w./\\-]*(?:scripts|tools|ci|bin|tasks)[/\\](?:[\w.-]+[/\\])*[\w.-]+\.(?:m?js|cjs|ts|sh)/g;
  const _norm = (x) => _normPath(x).replace(/^\.\//, '');    
   
   
   
   
   
   
   
   
   
   
  const _noComment = (s) => String(s).split('\n').filter(l => !/^\s*(#|\/\/|\*|::|@?REM\s)/i.test(l)).join('\n');
   
   
  const _noDescriptive = (s) => String(s).split('\n').filter(l => {
    const m = /^\s*-?\s*(?:name|description|title|summary|comment|displayName|label)\s*:\s*(.*)$/i.exec(l);
    if (!m) return true;
    const v = String(m[1]).trim();
    return !v || v.startsWith('[') || !/\s/.test(v);
  }).join('\n');
  for (const r of runners.slice()) {
    const txt = _noComment(r.text);
    for (const m of txt.matchAll(_FILE_RE)) push(_norm(m[0]), null);
     
    const bareTxt = _noDescriptive(txt);
    for (const own of ownEntries) {
      if (/[/\\]/.test(own)) continue;
      const esc = own.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^\\w.\\-/\\\\])\\.?[/\\\\]?${esc}([^\\w.-]|$)`, 'm').test(bareTxt)) push(own, null);
    }
  }
  for (const [name, body] of Object.entries(packageScripts)) for (const m of String(body || '').matchAll(_FILE_RE)) {
    const rel = _norm(m[0]);
    if (!ownEntries.has(rel)) push(rel, name);    
  }
   
  const scriptFiles = [];
  const walk = (d, rel2, depth) => {
    if (depth > 2) return;
    let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { if (e && e.code !== 'ENOENT') readErrors++; return; }
    for (const e of es) {
       
       
      if (scriptFiles.length >= 500) { skippedLarge++; return; }
      const p = path.join(d, e.name), r = (rel2 ? rel2 + '/' : '') + e.name;
      if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p, r, depth + 1); }
      else if (/\.(m?js|cjs|ts|sh)$/.test(e.name) && /(check|verify|validate|guard|test|gate|audit|scan|lint|e2e|smoke)/i.test(e.name)) scriptFiles.push(r);
    }
  };
  walk(path.join(root, 'scripts'), 'scripts', 0);
  return { packageScripts, runners, scriptFiles, readErrors, skippedLarge, workspaces };
}
 
function _auditLock(deps, f, fn) {
  const lock = deps && typeof deps._withLock === 'function' ? deps._withLock : require('./state-lock').withStateLock;
  return lock(f, fn);
}

function _fixAuditText(deps, file, transform, { kind = 'timestamp', checkSource = () => {}, allowMissing = false } = {}) {
  let phase = 'preflight';
  try {
     
    require('./io').assertWriteAllowed(file);
    return _auditLock(deps, file, () => {
      const { captureTextEdit, assertTextEditCurrent, publishTextEdit } = require('./managed-text');
      const input = captureTextEdit(file);
      if (!input.exists && !allowMissing) return false;
      const candidate = transform(input.text);
      assertTextEditCurrent(input, file, candidate);
      checkSource();
      if (!input.exists && candidate === input.text) return false;
      phase = 'publication';
      return publishTextEdit(input, file, candidate).published === true;
    });
  } catch (error) {
    error.auditText = { file, kind, phase, publicationAttempted: phase === 'publication' };
    throw error;
  }
}

function _readAuditPackage(file) {
  const { captureCheckedFileInput } = require('./memory-input');
  const { decodeText, MAX_TEXT_BYTES } = require('./managed-text');
  const input = captureCheckedFileInput(file, { maxBytes: MAX_TEXT_BYTES });
  if (!input.exists) return { input, pkg: null };
  const text = decodeText(input.bytes, file);
  let pkg;
  try { pkg = JSON.parse(text); } catch {
     
    throw Object.assign(new Error(`Audit package metadata has invalid JSON: ${file}`), { code: 'E_AUDIT_PACKAGE', file });
  }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    throw Object.assign(new Error(`Audit package metadata must be a JSON object: ${file}`), { code: 'E_AUDIT_PACKAGE', file });
  }
  if (pkg.version !== undefined && typeof pkg.version !== 'string') {
    throw Object.assign(new Error(`Audit package version must be a string: ${file}`), { code: 'E_AUDIT_VERSION', file });
  }
  return { input, pkg };
}

function _managedReadmePlan(text, root, deps) {
  const start = '<!-- leerness:project-readme:start -->', end = '<!-- leerness:project-readme:end -->';
  const first = text.indexOf(start), last = text.indexOf(end);
  if (first < 0 && last < 0) return null;
  if (first < 0 || last < first || text.indexOf(start, first + start.length) >= 0 || text.indexOf(end, last + end.length) >= 0) {
    return { invalid: true, stale: true, stamp: null };
  }
  const current = text.slice(first, last + end.length);
  const stamp = current.match(/Last synced by Leerness v(\d+\.\d+\.\d+)/);
  if (typeof deps.renderReadmeBlock !== 'function') {
    throw Object.assign(new Error('README managed-block renderer is unavailable'), { code: 'E_AUDIT_README_RENDER' });
  }
  const rendered = deps.renderReadmeBlock(root, deps.VERSION);
  if (typeof rendered !== 'string' || !rendered.startsWith(start) || !rendered.trimEnd().endsWith(end)) {
    throw Object.assign(new Error('README managed-block renderer returned an invalid block'), { code: 'E_AUDIT_README_RENDER' });
  }
  const eol = (current.match(/\r?\n/) || text.match(/\r?\n/) || ['\n'])[0];
  const canonical = rendered.trimEnd().replace(/\r?\n/g, eol);
  const comparable = value => value.replace(/\r\n/g, '\n')
    .replace(/^(Last synced by Leerness v[^\r\n]+): \d{4}-\d{2}-\d{2}$/m, '$1');
  const stale = comparable(current) !== comparable(canonical);
  return { invalid: false, stale, stamp, text: stale ? text.slice(0, first) + canonical + text.slice(last + end.length) : text };
}

function _applyManagedReadmePlan(plan, fresh) {
  if (plan?.invalid) throw Object.assign(new Error('README managed-block markers are missing, duplicated or out of order; preserve the original and repair the markers first'), { code: 'E_AUDIT_README_BLOCK' });
  return plan ? plan.text : fresh;
}

function _fixAuditReadme(deps, file, pkgFile, transform) {
  let source;
  return _fixAuditText(deps, file, fresh => {
    source = _readAuditPackage(pkgFile);
    return source.pkg ? transform(fresh, source.pkg) : fresh;
  }, { kind: 'readme', checkSource: () => {
    require('./memory-input').assertCheckedFileCurrent(source.input, pkgFile);
  } });
}

function _missingIgnorePatterns(text) {
  const lines = text.split('\n').map(line => line.trim().replace(/^\//, ''));
   
  return ['.env', '.env.local', '.env.production', '.env.*.local', '*.pem', 'credentials.json']
    .filter(pattern => !lines.some(line => line === pattern || (line.endsWith('*') && pattern.startsWith(line.slice(0, -1)))));
}

function _appendAuditLines(text, comment, lines) {
  if (!lines.length) return text;
  const eol = (text.match(/\r?\n/) || ['\n'])[0];
  return text + (text && !text.endsWith('\n') ? eol : '') + eol + '# ' + comment + eol + lines.join(eol) + eol;
}

function _fixAuditEnv(deps, file, envPath, transform) {
  let source;
  return _fixAuditText(deps, file, fresh => {
    const { captureCheckedFileInput } = require('./memory-input');
    const { decodeText, MAX_TEXT_BYTES } = require('./managed-text');
    source = captureCheckedFileInput(envPath, { maxBytes: MAX_TEXT_BYTES });
    if (!source.exists) return fresh;
    const keys = _parseEnvKeys(decodeText(source.bytes, envPath));
    const existing = _parseEnvKeys(fresh);
    return transform(fresh, [...keys].filter(key => !existing.has(key)));
  }, { kind: 'env', checkSource: () => require('./memory-input').assertCheckedFileCurrent(source, envPath) });
}

function _currentStateAge(text) {
  const match = text.match(/Updated: (\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const days = (Date.now() - new Date(match[1]).getTime()) / 86400000;
   
  return Number.isFinite(days) ? days : Infinity;
}

function audit(root, opts = {}, deps = {}) {
  const { VERSION, arg, has, planPath, readProgressRows, currentStatePath, handoffPath, envDiff, _readFeatureGraph, _matchAPISkills, _listAPISkills, _collectSecretFindings } = deps;
  root = absRoot(root);
  let warnings = 0, failures = 0;
   
  const fix = has('--fix');
  let fixed = 0;
  let incomplete = false;
  const completedTimestampFiles = [];
  const completedReadmeFixes = [];
  const completedEnvironmentFiles = [];
   
  const jsonMode = !!opts.json || has('--json');
  const findings = [];
  const _finding = (kind, severity, message, details = {}) => findings.push({ kind, severity, message, ...details });
  const _origWrite = process.stdout.write.bind(process.stdout);
   
   
   
   
  const _origErrWrite = process.stderr.write.bind(process.stderr);
  const _restoreStreams = () => { process.stdout.write = _origWrite; process.stderr.write = _origErrWrite; };
  if (jsonMode) { process.stdout.write = () => true; process.stderr.write = () => true; }
  try {
   
  if (!exists(root) || !exists(path.join(root, '.leerness')) || !exists(path.join(root, 'AGENTS.md'))) {
    failures++;
    fail(`미초기화 또는 존재하지 않는 경로: ${root} (.leerness/AGENTS.md 없음 — leerness init 필요)`);
    _finding('not_initialized', 'fail', 'uninitialized or missing path (.leerness or AGENTS.md absent)', { root });
    // 1.27.1 (13번째 외부리뷰 #2): 미초기화 시 후속 체크(design/reuse 등)를 없는 하네스에 대해 보고하던 모순 출력 차단 — 요약/JSON 으로 직행 후 종료(exit code/JSON 페이로드는 종전과 동일).
    log(`Audit summary: warnings=${warnings} failures=${failures}`);
    if (jsonMode) { _restoreStreams(); process.stdout.write(JSON.stringify({ version: VERSION, root, warnings, failures, fixed, healthy: false, fixApplied: fix, strict: has('--strict'), strictThreshold: has('--strict') ? parseInt(arg('--threshold', '1'), 10) : null, summary: `warnings=${warnings} failures=${failures}`, findings }, null, 2) + '\n'); }
    process.exitCode = 1;
    return;
  }
   
   
   
  try {
    if (typeof deps._integrityFindings === 'function') {
      const _integ = deps._integrityFindings(root) || [];
       
      const _missing = _integ.filter(f => f && ['missing', 'h1_lost', 'truncated', 'unreadable'].includes(f.kind));
      if (_missing.length) {
         
        const _sev = _missing.filter(f => f.kind === 'missing').length >= 3 ? 'fail' : 'warn';
        if (_sev === 'fail') { failures++; fail(`관리 문서 ${_missing.length}건 부재/손상 — 설치 불완전 (leerness init 또는 integrity check --repair)`); }
        else { warnings++; warn(`관리 문서 ${_missing.length}건 부재/손상 (leerness integrity check --repair)`); }
        _finding('managed_docs_incomplete', _sev, 'managed policy docs missing/damaged (install incomplete)', { count: _missing.length, files: _missing.slice(0, 12).map(f => f.file || f.name), kinds: [...new Set(_missing.map(f => f.kind))] });
      } else {
        ok('관리 문서 무결성 OK (integrity)');
      }
    }
  } catch {}
   
   
  try {
    const corrupted = findCorruptedStateJson(root);
    if (corrupted.length) {
      warnings++;
      warn(`상태파일 JSON 손상 ${corrupted.length}건: ${corrupted.map(c => c.file).join(', ')} (수동 복구 또는 leerness init 필요)`);
      corrupted.slice(0, 6).forEach(c => log(`    ${c.file}: ${c.error}`));
      _finding('corrupted_state_json', 'warn', '.leerness 상태파일 JSON 파싱 실패 (손상)', { count: corrupted.length, files: corrupted.map(c => c.file), sample: corrupted.slice(0, 10) });
    } else {
      ok('상태파일 JSON 무결성 OK (.leerness/*.json)');
    }
  } catch {}
  const designCands = ['designguide.md','design-guide.md','docs/designguide.md','docs/design-guide.md','.leerness/designguide.md'];
  const dups = designCands.filter(f => exists(path.join(root,f)));
  if (dups.length) { warnings++; warn(`design guide duplicates outside canonical: ${dups.join(', ')} (run: leerness consistency merge-design-guide)`); _finding('design_dup', 'warn', 'design guide duplicates outside canonical', { duplicates: dups }); }
  else ok('no duplicate design guide candidates');
  // 1.9.1 P4: <!-- leerness:na --> 마커가 있는 파일은 placeholder 경고 스킵.
  const naMarker = '<!-- leerness:na';
  const ds = exists(path.join(root,'.leerness/design-system.md')) ? read(path.join(root,'.leerness/design-system.md')) : '';
  if (ds.includes(naMarker)) ok('design-system.md marked NA (skipped)');
  else if (!/\| color\.primary \|/.test(ds) || /\(실제 값으로 업데이트\)|\(update with real value\)/i.test(ds)) { warnings++; warn('design-system.md tokens not customized'); _finding('design_system_default', 'warn', 'design-system.md tokens not customized'); }    
  else ok('design-system tokens populated');
  const reuse = exists(path.join(root,'.leerness/reuse-map.md')) ? read(path.join(root,'.leerness/reuse-map.md')) : '';
  const reuseLines = reuse.split('\n').filter(l => l.startsWith('|') && !/Capability|---/.test(l)).length;
  if (reuse.includes(naMarker)) ok('reuse-map.md marked NA (skipped)');
  else if (reuseLines === 0) { warnings++; warn('reuse-map.md is empty (consider populating known reusable elements)'); _finding('reuse_map_empty', 'warn', 'reuse-map.md is empty'); }
  else ok(`reuse-map.md has ${reuseLines} entries`);
   
   
  const briefFile = path.join(root, '.leerness/project-brief.md');
  const briefTxt = exists(briefFile) ? read(briefFile) : '';
  if (briefTxt.includes(naMarker)) ok('project-brief.md marked NA (skipped)');
  else if (_briefUnfilled(briefTxt)) { warnings++; warn('project-brief.md Purpose 미작성(템플릿 그대로) — 인계받는 AI가 프로젝트 목적/맥락을 못 받습니다 (project-brief.md 채우기)'); _finding('project_brief_unfilled', 'warn', 'project-brief.md Purpose still placeholder/empty — AI handoffs lack project context'); }
  else ok('project-brief.md Purpose populated');
  const planText = exists(planPath(root)) ? read(planPath(root)) : '';
  if (planText && !planText.includes(naMarker) && _planGoalUnfilled(planText)) { warnings++; warn('plan.md Goal 미작성(템플릿 그대로) — 프로젝트 목표/범위가 비어 인계 AI가 방향을 못 잡습니다 (plan.md Goal/Scope 채우기)'); _finding('plan_goal_unfilled', 'warn', 'plan.md Goal still placeholder/empty'); }

   
   
   
  try {
    const g = _detectOrphanGuards(_collectGuardInputs(root));
    if (g.orphanScripts.length || g.orphanFiles.length) {
      warnings++;
      const parts = [];
      if (g.orphanScripts.length) parts.push(`npm 스크립트 ${g.orphanScripts.length}종`);
      if (g.orphanFiles.length) parts.push(`파일 ${g.orphanFiles.length}개`);
      warn(`아무도 실행하지 않는 검사: ${parts.join(' · ')} — 사람이 기억해야만 도는 가드는 결국 안 돈다`);
      log(`     근거: ${g.reason}`);
      if (g.orphanScripts.length) log(`     npm: ${g.orphanScripts.slice(0, 8).join(', ')}${g.orphanScripts.length > 8 ? ` 외 ${g.orphanScripts.length - 8}종` : ''}`);
      if (g.orphanFiles.length) log(`     파일: ${g.orphanFiles.slice(0, 6).join(', ')}${g.orphanFiles.length > 6 ? ` 외 ${g.orphanFiles.length - 6}개` : ''}`);
      log(`     → CI 워크플로나 집계 스크립트(예: test:ci)에 배선하거나, 더 이상 안 쓰면 지우세요`);
      _finding('orphan_guard', 'warn', 'checks exist but no runner invokes them', {
        orphanScripts: g.orphanScripts, orphanFiles: g.orphanFiles, scanIncomplete: g.scanIncomplete,
         
        monorepoOutOfScope: g.monorepoOutOfScope, deferred: g.deferred,
        guardCount: g.guardCount, dynamicRunners: g.dynamicRunners, enumPrefixes: g.enumPrefixes, reason: g.reason,
      });
    } else if (g.scanIncomplete || g.deferred || g.monorepoOutOfScope) {
       
       
       
      warnings++;
      warn(`가드 배선 점검이 불완전합니다 — 0건이라는 결과를 그대로 믿지 마세요`);
      log(`     근거: ${g.reason}`);
      _finding('orphan_guard_scan_incomplete', 'warn', 'guard wiring scan could not cover everything', {
        scanIncomplete: g.scanIncomplete, deferred: g.deferred, monorepoOutOfScope: g.monorepoOutOfScope,
        guardCount: g.guardCount, reason: g.reason,
      });
    }
     
     
     
     
     
    if (g && g.maskedByOwnEntry) {
      const mk = g.maskedByOwnEntry;
      const parts = [];
      if ((mk.scripts || []).length) parts.push(`npm ${mk.scripts.join(', ')}`);
      if ((mk.files || []).length) parts.push(`파일 ${mk.files.join(', ')}`);
      warnings++;
      warn(`가드 배선 판정이 이 패키지 자신의 진입점 텍스트에 가려질 수 있습니다 — 확인 필요: ${parts.join(' · ')}`);
      log(`     이유: CI 가 이 패키지의 bin/main 을 실행하므로 러너로 잡히는데, 그 안의 **문자열**(문서·템플릿·테스트 단언)에`);
      log(`           스크립트 이름이 있으면 호출로 읽힙니다. 위 항목은 그 텍스트를 빼면 '아무도 안 부름' 으로 나옵니다.`);
      log(`     → 실제로 부르는 곳이 있으면 무시하세요. 없으면 CI 에 배선하거나 삭제하세요.`);
      _finding('orphan_guard_masked_by_own_entry', 'warn', 'own bin/main text may mask orphan guards', {
        maskedScripts: mk.scripts || [], maskedFiles: mk.files || [], guardCount: g.guardCount,
      });
    }
  } catch {}
   
   
  try {
    const ws = inspectWorkspace(root);
    if (ws.conflict) {
      warnings++;
      warn(`workspace directory conflict: ${LEGACY_WORKSPACE_DIR}/ 와 ${CANONICAL_WORKSPACE_DIR}/ 가 모두 live 상태입니다`);
      log(`     → leerness migrate-workspace-dir --dry-run 으로 충돌 파일을 확인하고, 합의한 뒤에만 --force 하세요`);
      _finding('workspace_dir_conflict', 'warn', 'legacy and canonical workspace directories are both live', {});
    } else if (ws.legacy.live && !ws.canonical.live) {
      warnings++;
      warn(`legacy workspace ${LEGACY_WORKSPACE_DIR}/ 사용 중 — canonical ${CANONICAL_WORKSPACE_DIR}/ 로 마이그레이션이 필요합니다`);
      log(`     → leerness migrate-workspace-dir ${root}`);
      _finding('workspace_dir_migration_needed', 'warn', 'legacy workspace should be migrated to canonical directory', {});
    }
  } catch {}
  const milestoneIds = Array.from(planText.matchAll(/^### (M-\d{4,})\./gm)).map(m => m[1]);
  const rows = readProgressRows(root);
   
  const linkedMs = new Set(
    rows.flatMap(r => Array.from(String(r.evidence || '').matchAll(/M-\d{4,}/g), m => m[0]))
  );
  const missingFromProgress = milestoneIds.filter(m => !linkedMs.has(m));
  if (missingFromProgress.length) {
    warnings++;
    warn(`milestones without progress entry: ${missingFromProgress.join(', ')}`);
    _finding('milestone_unlinked', 'warn', 'milestones without progress entry', { milestones: missingFromProgress });
    log(`    → 자동 매칭 제안: leerness task relink`);
    log(`    → 자동 적용:     leerness task relink --apply`);
  }
  else if (milestoneIds.length) ok('all milestones linked in progress-tracker');
  const handoffText = exists(handoffPath(root)) ? read(handoffPath(root)) : '';
   
   
  const handoffRegion = require('./context-current').currentHandoffRegion(handoffText);
  const handoff = handoffRegion === null ? handoffText : handoffRegion;
  if (handoff.includes('Last generated: (자동)') || handoff.includes('Last generated: (auto)')) {    
    warnings++; warn('session-handoff.md never auto-generated (run: leerness session close .)');
    _finding('handoff_not_generated', 'warn', 'session-handoff.md never auto-generated');
     
    if (fix) {
      const file = handoffPath(root);
      if (_fixAuditText(deps, file, fresh =>
        fresh.replace(/Last generated: \((자동|auto)\)/, `Last generated: ${today()} (leerness audit --fix)`))) {
        completedTimestampFiles.push(rel(root, file));
        ok('  ↳ fixed: session-handoff.md timestamp 갱신');
        fixed++;
      }
    }
  }
  else if (handoff.includes('Last generated:')) ok('session-handoff.md auto-generated previously');
  const cur = exists(currentStatePath(root)) ? read(currentStatePath(root)) : '';
  const dDays = _currentStateAge(cur);
  if (dDays !== null) {
    if (dDays > 7) {
      const dShow = Number.isFinite(dDays) ? Math.round(dDays) : '무효 날짜';
      warnings++; warn(`current-state.md stale (${dShow} days)`);
      _finding('current_state_stale', 'warn', 'current-state.md stale', { days: Number.isFinite(dDays) ? Math.round(dDays) : -1 });
       
      if (fix) {
        const file = currentStatePath(root);
        if (_fixAuditText(deps, file, fresh => {
          const age = _currentStateAge(fresh);
          return age !== null && age > 7 ? fresh.replace(/Updated: \d{4}-\d{2}-\d{2}/, `Updated: ${today()}`) : fresh;
        })) {
          completedTimestampFiles.push(rel(root, file));
          ok('  ↳ fixed: current-state.md Updated 갱신');
          fixed++;
        }
      }
    }
    else ok('current-state.md fresh');
  }
   
  try {
    const readmePath = path.join(root, 'README.md');
    const pkgPath = path.join(root, 'package.json');
    if (exists(readmePath) && exists(pkgPath)) {
      const readmeText = read(readmePath);
      const pkg = fix ? _readAuditPackage(pkgPath).pkg : JSON.parse(read(pkgPath));
      const m = readmeText.match(/badge\/version-(\d+\.\d+\.\d+)/);
      if (pkg && pkg.version && m && m[1] !== pkg.version) {
        warnings++;
        warn(`README.md version badge mismatch: README=${m[1]} vs package.json=${pkg.version} (run: leerness readme sync)`);
        _finding('readme_version_mismatch', 'warn', 'README.md version badge mismatch', { readme: m[1], pkg: pkg.version });
        if (fix) {
          if (_fixAuditReadme(deps, readmePath, pkgPath, (fresh, currentPkg) => {
            const managed = _managedReadmePlan(fresh, root, deps);
            if (managed?.invalid) _applyManagedReadmePlan(managed, fresh);
            const badge = fresh.match(/badge\/version-(\d+\.\d+\.\d+)/);
            if (!currentPkg.version || !badge || badge[1] === currentPkg.version) return fresh;
            return fresh.replace(/badge\/version-[\d.]+-(green|blue|red)/g, () => `badge/version-${currentPkg.version}-green`);
          })) {
            completedReadmeFixes.push('badge');
            ok('  ↳ fixed: README.md version 배지 갱신');
            fixed++;
          }
        }
      }
       
       
      const managed = pkg && VERSION ? _managedReadmePlan(readmeText, root, deps) : null;
      const sm = managed ? managed.stamp : readmeText.match(/Last synced by Leerness v(\d+\.\d+\.\d+)/);
      if (pkg && VERSION && (managed ? managed.stale : sm && sm[1] !== VERSION)) {
        warnings++;
        const kind = managed?.invalid ? 'readme_managed_block_invalid'
          : sm && sm[1] !== VERSION ? 'readme_synced_version_stale' : 'readme_managed_content_stale';
        const message = managed?.invalid ? 'README.md managed-block markers are missing, duplicated or out of order'
          : 'README.md managed content is stale (run: leerness readme sync)';
        warn(message);
        _finding(kind, 'warn', message, { readme: sm ? sm[1] : null, leerness: VERSION });
        if (fix) {
          if (_fixAuditReadme(deps, readmePath, pkgPath, fresh => {
            const current = _managedReadmePlan(fresh, root, deps);
            if (current) return _applyManagedReadmePlan(current, fresh);
            if (managed) return fresh;
            const stamp = fresh.match(/Last synced by Leerness v(\d+\.\d+\.\d+)/);
            return stamp && stamp[1] !== VERSION ? fresh.replace(/Last synced by Leerness v\d+\.\d+\.\d+/g, () => `Last synced by Leerness v${VERSION}`) : fresh;
          })) {
            completedReadmeFixes.push(managed ? 'managed-block' : 'stamp');
            ok(managed ? '  ↳ fixed: README.md managed block synchronized' : '  ↳ fixed: README.md legacy synced version updated');
            fixed++;
          }
        }
      }
    }
  } catch (error) {
    if (fix) {
      if (!error.auditText) error.auditText = { file: path.join(root, 'README.md'), kind: 'readme', phase: 'preflight', publicationAttempted: false };
      throw error;
    }
  }
   
   
  if (exists(path.join(root, 'package.json')) && !has('--no-npm-audit') && process.env.LEERNESS_OFFLINE !== '1') {
    try {
      const r = spawnNpmSync(['audit', '--json'], {
        cwd: root, encoding: 'utf8', timeout: 30000
      });
      if (r.stdout) {
        let j = null;
        try { j = JSON.parse(r.stdout); } catch {}
        if (j && j.metadata && j.metadata.vulnerabilities) {
          const v = j.metadata.vulnerabilities;
          const total = (v.critical || 0) + (v.high || 0) + (v.moderate || 0) + (v.low || 0);
          if (total > 0) {
            warnings++;
            warn(`npm CVE: ${total}건 (critical=${v.critical||0}, high=${v.high||0}, moderate=${v.moderate||0}, low=${v.low||0})`);
            _finding('npm_cve', 'warn', `npm CVE: ${total}건`, { vulnerabilities: v });
            log(`    → 수정: npm audit fix · 상세: npm audit`);
            if (v.critical || v.high) {
              warnings++;  
              warn(`  ⚠ critical/high CVE 즉시 대응 권장`);
              _finding('npm_cve_critical', 'warn', 'critical/high CVE 즉시 대응 권장', { critical: v.critical, high: v.high });
            }
          } else {
            ok('npm CVE: 0건');
          }
        }
      }
    } catch {}
  }
   
  if (!has('--no-gitignore-check')) {
    try {
      const gi = path.join(root, '.gitignore');
      const envPath = path.join(root, '.env');
      if (exists(envPath)) {
         
        const giText = exists(gi) ? read(gi) : '';
        const missing = _missingIgnorePatterns(giText);
        if (missing.length) {
          warnings++;
          warn(`.gitignore에 시크릿 패턴 ${missing.length}건 누락: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ' …' : ''}`);
          _finding('gitignore_missing_secrets', 'warn', '.gitignore에 시크릿 패턴 누락', { missing });
          if (fix) {
            let added = 0;
            const published = _fixAuditText(deps, gi, fresh => {
               
              const entries = exists(envPath) ? _missingIgnorePatterns(fresh) : [];
              added = entries.length;
              return _appendAuditLines(fresh, 'audit --fix: secret file ignore patterns', entries);
            }, { kind: 'gitignore', allowMissing: true });
            if (published) {
              ok(`  ↳ fixed: .gitignore에 ${added}건 자동 추가 (시크릿 보안 1.9.75)`);
              fixed++;completedEnvironmentFiles.push('.gitignore');
            }
          } else {
            log(`    → 자동 추가: leerness audit --fix`);
          }
        } else {
          ok('.gitignore 시크릿 패턴 OK (1.9.75)');
        }
      }
    } catch (error) {
      if (fix) {
        if (!error.auditText) error.auditText = { file: path.join(root, '.gitignore'), kind: 'gitignore', phase: 'preflight', publicationAttempted: false };
        throw error;
      }
    }
  }
   
   
   
  if (!has('--no-secret-scan') && typeof _collectSecretFindings === 'function') {
    try {
       
      const _sec = _collectSecretFindings(root);
      const committed = _sec.unacknowledged || _sec.committed;
      if (committed && committed.length) {
        failures++;
        fail(`커밋된 시크릿 ${committed.length}건 발견 (소스 노출) — leerness scan secrets 로 상세 확인`);
        committed.slice(0, 4).forEach(f => log(`    ${f.file}:${f.line}  ${f.name}`));
        _finding('committed_secret', 'fail', '커밋된 시크릿 발견 (소스 노출)', { count: committed.length, sample: committed.slice(0, 10).map(f => ({ file: f.file, line: f.line, name: f.name })) });
      } else {
        ok('커밋된 시크릿 없음 (소스 스캔, 1.30.1)');
      }
    } catch {}
  }
   
  if (!has('--no-env-check')) {
    try {
      const d = envDiff(root);
      if (exists(d.envPath) && exists(d.examplePath)) {
        if (d.inEnvOnly.length) {
          warnings++;
          warn(`.env에 있는 키 ${d.inEnvOnly.length}건이 .env.example에 누락: ${d.inEnvOnly.slice(0, 4).join(', ')}${d.inEnvOnly.length > 4 ? ' …' : ''}`);
          _finding('env_keys_missing', 'warn', '.env 키가 .env.example에 누락', { keys: d.inEnvOnly });
          if (fix) {
            let added = 0;
            const published = _fixAuditEnv(deps, d.examplePath, d.envPath, (fresh, keys) => {
              added = keys.length;
              return _appendAuditLines(fresh, 'audit --fix: missing keys (values intentionally empty)', keys.map(key => `${key}=`));
            });
            if (published) {
              ok(`  ↳ fixed: .env.example에 ${added}건 자동 추가 (값은 빈 문자열, 1.9.71)`);
              fixed++;completedEnvironmentFiles.push('.env.example');
            }
          } else {
            log(`    → 자동 동기화: leerness env sync 또는 leerness audit --fix`);
          }
        } else {
          ok('.env ↔ .env.example 동기화됨 (1.9.71)');
        }
      }
    } catch (error) {
      if (fix) {
        if (!error.auditText) error.auditText = { file: path.join(root, '.env.example'), kind: 'env', phase: 'preflight', publicationAttempted: false };
        throw error;
      }
    }
  }
   
  if (!has('--no-feature-check')) {
    try {
      const { nodes: fNodes } = _readFeatureGraph(root);
      if (fNodes.length > 0) {
        const ids = new Set(fNodes.map(n => n.id));
         
        const orphans = [];
        for (const n of fNodes) {
          for (const ref of [...(n.dependsOn || []), ...(n.affects || []), ...(n.coChangesWith || [])]) {
            if (!ids.has(ref)) orphans.push({ from: n.id, missingRef: ref });
          }
        }
        if (orphans.length) {
          warnings++;
          warn(`Feature Graph: orphan 참조 ${orphans.length}건 — ${orphans.slice(0, 3).map(o => `${o.from}→${o.missingRef}`).join(', ')}${orphans.length > 3 ? ' …' : ''}`);
          _finding('feature_graph_orphan', 'warn', 'Feature Graph 에 정의되지 않은 ID 참조', { count: orphans.length, orphans: orphans.slice(0, 10) });
          log(`    → 수정: leerness feature add 또는 link 제거`);
        }
         
        const cycles = [];
        const WHITE = 0, GRAY = 1, BLACK = 2;
        const color = new Map();
        for (const n of fNodes) color.set(n.id, WHITE);
        const byId = new Map(fNodes.map(n => [n.id, n]));
        const dfs = (nodeId, path) => {
          color.set(nodeId, GRAY);
          const node = byId.get(nodeId);
          if (!node) { color.set(nodeId, BLACK); return; }
          for (const next of [...(node.affects || []), ...(node.dependsOn || [])]) {
            if (!byId.has(next)) continue;
            const c = color.get(next);
            if (c === GRAY) {
               
              const idx = path.indexOf(next);
              const cyc = idx >= 0 ? path.slice(idx).concat([next]) : [...path, next];
              if (!cycles.some(existing => existing.join() === cyc.join())) cycles.push(cyc);
            } else if (c === WHITE) {
              dfs(next, [...path, next]);
            }
          }
          color.set(nodeId, BLACK);
        };
        for (const n of fNodes) if (color.get(n.id) === WHITE) dfs(n.id, [n.id]);
        if (cycles.length) {
          warnings++;
          warn(`Feature Graph: 순환 의존 ${cycles.length}건 — ${cycles[0].join(' → ')}${cycles.length > 1 ? ` (외 ${cycles.length-1}건)` : ''}`);
          _finding('feature_graph_cycle', 'warn', 'Feature Graph 에 순환 의존', { count: cycles.length, cycles: cycles.slice(0, 5) });
          log(`    → 수정: feature link 재구성 (affects/depends-on 방향 정리)`);
        }
        if (!orphans.length && !cycles.length) {
          ok(`Feature Graph OK (${fNodes.length} 노드, orphan/cycle 없음, 1.9.142)`);
        }
      }
    } catch {}
  }
   
   
   
   
  try {
    const rows = readProgressRows(root);
    const ip = rows.find(r => r.status === 'in-progress');
    if (ip) {
       
       
      const taskText = _taskMatchText(ip) + ' ' + (ip.evidence || '');
       
      const apiKeywords = /endpoint|GraphQL|OAuth|webhook|https?:\/\/[^\s]+/i;
      const apiAcronym = /\bAPI\b|\bREST\b/;   
      if (apiKeywords.test(taskText) || apiAcronym.test(taskText)) {
        const matched = _matchAPISkills(root, taskText);
        const allSkills = _listAPISkills(root);
         
         
         
         
         
        const weak = matched.length ? [] : _matchAPISkills(root, taskText, { weak: true });
        if (weak.length) {
          log(`ℹ API skill 확인된 매칭 없음 — 현재 task 와 단어 하나만 겹치는 후보 ${weak.length}건 (${weak.slice(0, 3).map(s => s.id).join(', ')}). 관련 없으면 leerness api-skill add <url> 로 정리 (경고로 세지 않음)`);
          _finding('api_skill_weak_match', 'info', 'API 관련 task 에 확인된 api-skill 매칭 없음 — 단어 하나만 겹치는 후보만 있음 (경고 아님)', {
            taskRequest: (ip.request || '').slice(0, 100),
            apiSkillsTotal: allSkills.length,
            weakMatchIds: weak.slice(0, 10).map(s => s.id),
          });
        } else if (matched.length === 0) {
          warnings++;
          warn(`API 관련 task 감지 (현재: "${(ip.request || '').slice(0, 60)}") — .leerness/api-skills/ 매칭 0건 (저장 ${allSkills.length})`);
          warn(`  → leerness api-skill add <url> --direction "구현 방향" 으로 정리 권장 (1.9.245 UR-0015 / 1.9.247 audit)`);
          _finding('api_skill_missing', 'warn', 'API 관련 task 인데 .leerness/api-skills/ 매칭 없음', {
            taskRequest: (ip.request || '').slice(0, 100),
            apiSkillsTotal: allSkills.length,
            matched: 0,
            hint: 'leerness api-skill add <url> --direction "..."'
          });
        } else {
          ok(`API skill 매칭 OK (현재 task → ${matched.length}건 매칭 in .leerness/api-skills/, 1.9.247 UR-0015 2단계)`);
        }
      }
    }
  } catch (error) {
    if (error.storeRead || /^(?:E_STORE_|E_TEXT_)/.test(error.code || '')) {
      incomplete = true; failures++;
      _finding('api_skill_unavailable', 'fail', 'API skill input unavailable', { code: error.code, file: error.file || null });
    }
  }
   
  if (has('--strict')) {
    const threshold = parseInt(arg('--threshold', '1'), 10);
     
    if (warnings > 0 && warnings >= threshold) {
      failures++;
      warn(`--strict 활성: warnings ${warnings} ≥ threshold ${threshold} → failures 승격`);
      _finding('strict_promoted', 'fail', `warnings ${warnings} ≥ threshold ${threshold} → failures 승격`, { warnings, threshold });
    }
  }
  log(`Audit summary: warnings=${warnings} failures=${failures}${fix ? ` fixed=${fixed}` : ''}${has('--strict') ? ` strict-threshold=${arg('--threshold', '1')}` : ''}`);
  } catch (error) {
    if (!error.auditText) throw error;
    incomplete = true;
    failures++;
    const { kind, ...context } = error.auditText;
    const environmentFix = kind === 'gitignore' || kind === 'env';
    const title = ({ readme: 'README', gitignore: '.gitignore', env: '.env.example' })[kind] || 'Timestamp';
    const detail = { ...context, file: rel(root, context.file),
      causeCode: error.code || null, error: error.message, completedFixes: fixed,
      completedTimestampFiles, rolledBack: false,
      ...(kind === 'readme' || environmentFix ? { completedReadmeFixes } : {}),
      ...(environmentFix ? { completedEnvironmentFiles } : {}),
      ...(error.file && error.file !== context.file ? { sourceFile: rel(root, error.file) } : {}) };
     
    for (const key of ['backupFile', 'recoveryArtifacts', 'cleanupError', 'cleanupDirectory', 'cleanupArtifact',
      'outputMutationStarted', 'outputPublished', 'outputRolledBack']) {
      if (error[key] !== undefined) detail[key] = error[key];
    }
    _finding(`${kind}_fix_failed`, 'fail', `${title} fix failed; later audit checks were skipped and completed fixes were not rolled back`, detail);
    warn(`${title} fix failed (${detail.phase}): ${detail.file}: ${error.message}`);
    log(`Audit incomplete: fixed=${fixed}; later checks skipped; completed fixes were not rolled back.${detail.publicationAttempted ? ' The failed target may have changed; inspect it before retrying.' : ''}`);
    if (detail.backupFile || detail.recoveryArtifacts) log(`Recovery: ${JSON.stringify({ backupFile: detail.backupFile, recoveryArtifacts: detail.recoveryArtifacts })}`);
  } finally {
     
    if (jsonMode) _restoreStreams();
  }
   
  if (jsonMode) {
    const payload = {
      version: VERSION,
      root,
      warnings,
      failures,
      fixed,
      healthy: failures === 0,
      fixApplied: fix,
      strict: has('--strict'),
      strictThreshold: has('--strict') ? parseInt(arg('--threshold', '1'), 10) : null,
      summary: `warnings=${warnings} failures=${failures}${fix ? ` fixed=${fixed}` : ''}`,
      findings,
      ...(incomplete ? { incomplete: true } : {}),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  }
  if (failures) process.exitCode = 1;
}

 
 
module.exports = { audit, _collectGuardInputs, _currentStateAge };
