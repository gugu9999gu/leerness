 
 
 
 
 
'use strict';
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { log, fail, absRoot, exists, read } = require('./io');
const { parseHarnessVersion, _parseChangelogBetween, compareVer } = require('./pure-utils');
const { spawnNpmSync } = require('./npm-process');
const { windowsPathCandidates } = require('./portable-process');
const { shouldRunDoctorSelftest, runDoctorSelftest } = require('./doctor-selftest');

const _WINDOWS_NPM_SHIM_EXTS = new Set(['', '.cmd', '.ps1']);

function _pathKey(value, platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  let normalized = pathApi.normalize(String(value || ''));
  if (platform === process.platform) {
    try { normalized = fs.realpathSync.native(normalized); } catch {}
  }
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function _escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _readSmallText(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > 64 * 1024) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function _npmShimTargetsEntry(candidate, expectedEntry, platform) {
  if (platform !== 'win32' || platform !== process.platform) return false;
  const pathApi = path.win32;
  const ext = pathApi.extname(candidate).toLowerCase();
  if (!_WINDOWS_NPM_SHIM_EXTS.has(ext)) return false;
  if (!ext) {
    try {
      if (_pathKey(fs.realpathSync.native(candidate), platform) === _pathKey(expectedEntry, platform)) return true;
    } catch {}
  }

  let source;
  try { source = _readSmallText(candidate); } catch { return false; }
  if (source == null) return false;
  const relative = pathApi.relative(pathApi.dirname(candidate), expectedEntry);
  if (!relative || pathApi.isAbsolute(relative)) return false;
  const lines = source.split(/\r?\n/);

  if (!ext) {
    const target = _escapeRegExp(`"$basedir/${relative.replace(/\\/g, '/')}"`);
    const invocation = new RegExp(`^\\s*exec\\s+(?:"\\$basedir[\\\\/]node(?:\\.exe)?"|node(?:\\.exe)?)\\s+${target}\\s+"\\$@"\\s*$`, 'i');
    const forwarded = lines.filter(line => !/^\s*#/.test(line) && /"\$@"\s*$/.test(line));
    return forwarded.length > 0 && forwarded.every(line => invocation.test(line));
  }

  if (ext === '.cmd') {
    const target = _escapeRegExp(`"%dp0%\\${relative.replace(/\//g, '\\')}"`);
    const invocation = new RegExp(`^\\s*endLocal\\s+&\\s+goto\\s+#_undefined_#\\s+2>NUL\\s+\\|\\|\\s+title\\s+%COMSPEC%\\s+&\\s+"%_prog%"\\s+${target}\\s+%\\*\\s*$`, 'i');
    const forwarded = lines.filter(line => !/^\s*(?:@?rem\b|::)/i.test(line) && /%\*\s*$/.test(line));
    return forwarded.length === 1 && invocation.test(forwarded[0]);
  }

  const target = _escapeRegExp(`"$basedir/${relative.replace(/\\/g, '/')}"`);
  const invocation = new RegExp(`^\\s*(?:\\$input\\s*\\|\\s*)?&\\s+(?:"\\$basedir[\\\\/]node\\$exe"|"node\\$exe")\\s+${target}\\s+\\$args\\s*$`, 'i');
  const forwarded = lines.filter(line => !/^\s*#/.test(line) && /&/.test(line) && /\$args\s*$/.test(line));
  return forwarded.length > 0 && forwarded.every(line => invocation.test(line));
}

function _npmPackageIdentity(candidate, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== process.platform) return null;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const command = String(options.command || 'leerness');
  const packageName = String(options.packageName || command);
  const dir = pathApi.dirname(candidate);
  const manifests = [pathApi.join(dir, 'node_modules', packageName, 'package.json')];
  if (pathApi.basename(dir).toLowerCase() === '.bin') {
    manifests.push(pathApi.join(dir, '..', packageName, 'package.json'));
  }
  for (const manifest of manifests) {
    try {
      const stat = fs.statSync(manifest);
      if (!stat.isFile() || stat.size > 64 * 1024) continue;
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      const declaredBin = typeof pkg.bin === 'string' ? pkg.bin
        : (pkg.bin && typeof pkg.bin === 'object'
          && Object.prototype.hasOwnProperty.call(pkg.bin, command) ? pkg.bin[command] : null);
      if (pkg.name !== packageName || typeof declaredBin !== 'string'
          || !declaredBin.trim() || /\u0000/.test(declaredBin)) continue;
      const expectedEntry = pathApi.resolve(pathApi.dirname(manifest), declaredBin);
      if (!fs.statSync(expectedEntry).isFile()) continue;
      if (!_npmShimTargetsEntry(candidate, expectedEntry, platform)) continue;
      return _pathKey(expectedEntry, platform);
    } catch {}
  }
  return null;
}

 
 
 
 
function _groupPathInstallations(candidates, options = {}) {
  const platform = options.platform || process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const command = String(options.command || 'leerness').toLowerCase();
  const packageIdentity = typeof options.packageIdentity === 'function'
    ? options.packageIdentity
    : candidate => _npmPackageIdentity(candidate, {
      platform, command, packageName: options.packageName || command,
    });
  const groups = [];
  const byKey = new Map();

  for (const rawCandidate of Array.isArray(candidates) ? candidates : []) {
    const candidate = String(rawCandidate || '').trim();
    if (!candidate) continue;
    const normalized = pathApi.normalize(candidate);
    const base = pathApi.basename(normalized);
    const ext = pathApi.extname(base).toLowerCase();
    const isNpmShimVariant = platform === 'win32' && _WINDOWS_NPM_SHIM_EXTS.has(ext);
    const stem = isNpmShimVariant && ext ? base.slice(0, -ext.length) : base;
    const directory = pathApi.dirname(normalized);
    let kind = 'candidate';
    let key = `candidate:${_pathKey(normalized, platform)}`;

    if (isNpmShimVariant && stem.toLowerCase() === command) {
      let identity = null;
      try { identity = packageIdentity(normalized); } catch { identity = null; }
      if (identity) {
        kind = 'npm-package';
        key = `npm:${_pathKey(directory, platform)}:${String(identity).toLowerCase()}`;
      }
    }

    let group = byKey.get(key);
    if (!group) {
      group = { directory, kind, candidates: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.candidates.push(candidate);
  }
  return groups;
}

function doctorCmd(opts = {}, deps = {}) {
  const { VERSION, uiLang, _detectShellCtx, _mcpToolCount, has, harnessPath } = deps;
  const t = (ko, en) => (uiLang === 'en' ? en : ko);   
  const json = opts.json || (typeof has === 'function' && has('--json'));
   
   
  const selftestEnabled = shouldRunDoctorSelftest(opts, process.env);
  const selftest = runDoctorSelftest(selftestEnabled, deps);
  const { pass, total } = selftest;
   
  let shell = null, psVersion = null;
  try { const ctx = _detectShellCtx(); shell = ctx.shell; psVersion = ctx.psVersion; } catch {}
  const mcpCount = (() => { try { return _mcpToolCount(); } catch { return null; } })();
   
   
   
   
   
   
  let tmpLeftover = null;
  try {
    const tdir = require('os').tmpdir();
    const ents = require('fs').readdirSync(tdir, { withFileTypes: true });
    const n = ents.filter(e => e.isDirectory() && /^(__leerness_|leerness-)/i.test(e.name)).length;
    if (n > 200) tmpLeftover = { dir: tdir, count: n };
  } catch { tmpLeftover = null; }
  const report = {
    version: VERSION, node: process.version, platform: process.platform + '/' + process.arch,
    runningFrom: harnessPath, mcpTools: mcpCount,
    selftest, diagnosisScope: selftestEnabled ? 'environment+selftest' : 'environment',
    shell, psVersion, tmpLeftover, healthy: selftest.ok
  };
  if (json) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); if (report.healthy === false) process.exitCode = 1; return report; }
  const isTty = process.stdout && process.stdout.isTTY;
  const gr = s => isTty ? `\x1b[32m${s}\x1b[0m` : s, rd = s => isTty ? `\x1b[31m${s}\x1b[0m` : s, cy = s => isTty ? `\x1b[36m${s}\x1b[0m` : s, dm = s => isTty ? `\x1b[2m${s}\x1b[0m` : s;
  log(cy(t(`# leerness doctor — 설치/환경 진단`, `# leerness doctor — install/environment diagnosis`)));
  log('');
  log(`  ${gr('✓')} version ${VERSION} · node ${process.version} · ${process.platform}/${process.arch}`);
  log(`  ${gr('✓')} ${t('설치 경로', 'install path')}: ${dm(harnessPath)}`);
  log(`  ${gr('✓')} ${t('MCP 도구', 'MCP tools')}: ${mcpCount}`);
  if (selftest.status === 'not_run') {
    log(`  ${dm('ⓘ')} ${t('selftest 미실행 — 전체 검증: leerness selftest', 'selftest not run — full verification: leerness selftest')}`);
  } else if (selftest.status === 'error') {
    log(rd(`  ✗ ${t('selftest 실행 오류', 'selftest execution error')}: ${selftest.reason}`));
  } else {
    log(`  ${selftest.ok ? gr('✓') : rd('✗')} selftest: ${pass}/${total} ${t('통과', 'passed')}${selftest.ok ? '' : t(` (${total - pass}건 실패)`, ` (${total - pass} failed)`)}`);
    if (!selftest.ok) selftest.failed.slice(0, 5).forEach(n => log(rd(`     ✗ ${n}`)));
  }
  log(`  ${gr('✓')} ${t('셸', 'shell')}: ${shell || 'unknown'}${psVersion && shell === 'powershell' ? ` (PowerShell ${psVersion})` : ''}`);
   
   
  if (tmpLeftover) {
    log(`  ${dm('ⓘ')} ${t(`임시 디렉토리 잔존 ${tmpLeftover.count}개 (1.36.106 이전 버전이 남긴 것 — 새 실행은 흘리지 않습니다)`, `${tmpLeftover.count} leftover temp dirs (created by versions before 1.36.106 — current runs leak none)`)}`);
    log(`     ${dm(tmpLeftover.dir)}  ${dm(t('— 필요하면 직접 정리하세요(leerness 는 지우지 않습니다)', '— remove them yourself if you want (leerness will not)'))}`);
  }
  log('');
  if (report.healthy === null) {
    log(dm(t('  ⓘ 환경 정보 수집 완료 — 코어 무결성은 검증하지 않았습니다.', '  ⓘ Environment information collected — core integrity has not been verified.')));
  } else {
    log(report.healthy ? gr(t('  ✓ leerness 설치 정상', '  ✓ leerness install OK')) : rd(t('  ✗ 문제 감지 — 상세 검증: leerness selftest · 진단: leerness which', '  ✗ problem detected — verify: leerness selftest · diagnose: leerness which')));
  }
  if (report.healthy === false) process.exitCode = 1;
  return report;
}

function whichCmd(deps = {}) {
  const { VERSION, uiLang, has, harnessPath } = deps;
  const t = (ko, en) => (uiLang === 'en' ? en : ko);   
  const platform = deps.platform || process.platform;
  const out = {
    version: VERSION,
    runningFrom: harnessPath,
    nodeVersion: process.version,
    platform,
    arch: process.arch,
    npm: {},
    pathCandidates: [],
    pathInstallations: []
  };
  if (!deps.skipNpm) {
     
    try {
      const r = spawnNpmSync(['root', '-g'], { encoding: 'utf8', timeout: 5000 });
      if (r.status === 0) out.npm.globalRoot = (r.stdout || '').trim();
    } catch {}
     
    try {
      const r = spawnNpmSync(['config', 'get', 'cache'], { encoding: 'utf8', timeout: 5000 });
      if (r.status === 0) out.npm.cacheDir = (r.stdout || '').trim();
    } catch {}
     
    try {
      const r = spawnNpmSync(['ls', '-g', 'leerness', '--depth=0', '--json'], { encoding: 'utf8', timeout: 8000 });
      if (r.stdout) {
        try {
          const j = JSON.parse(r.stdout);
          if (j.dependencies?.leerness) out.npm.globalInstalled = j.dependencies.leerness.version;
        } catch {}
      }
    } catch {}
  }
   
  try {
    const isWin = platform === 'win32';
    if (Array.isArray(deps.pathCandidates)) {
      out.pathCandidates = deps.pathCandidates.slice();
    } else if (isWin) {
      out.pathCandidates = windowsPathCandidates('leerness', { env: process.env, cwd: process.cwd() });
    } else {
      const r = cp.spawnSync('which', ['-a', 'leerness'], { encoding: 'utf8', timeout: 5000, shell: false });
      if (r.stdout) out.pathCandidates = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean);
    }
  } catch {}
  out.pathInstallations = _groupPathInstallations(out.pathCandidates, {
    platform, command: 'leerness', packageName: 'leerness',
    ...(typeof deps.packageIdentity === 'function' ? { packageIdentity: deps.packageIdentity } : {}),
  });
   
  out.diagnostics = [];
  if (out.npm.globalInstalled && out.npm.globalInstalled !== VERSION) {
    out.diagnostics.push(t(`⚠ 글로벌 설치 ${out.npm.globalInstalled} ≠ 현재 실행 ${VERSION} — npx 캐시 또는 PATH 충돌 의심`, `⚠ global install ${out.npm.globalInstalled} ≠ running ${VERSION} — suspect npx cache or PATH conflict`));
    out.diagnostics.push(t(`  → 강제 최신: npm i -g leerness@latest  /  또는 npx --yes leerness@latest <command>`, `  → force latest: npm i -g leerness@latest  /  or npx --yes leerness@latest <command>`));
  }
  if (out.pathInstallations.length > 1) {
    out.diagnostics.push(t(`⚠ PATH 에 leerness 설치가 ${out.pathInstallations.length}개 — 우선순위 충돌 가능`, `⚠ ${out.pathInstallations.length} leerness installations appear on PATH — possible precedence conflict`));
    out.diagnostics.push(t(`  → 명시적 경로 사용: ${out.runningFrom}`, `  → use the explicit path: ${out.runningFrom}`));
  }
  if (deps.quiet) return out;
  if (has('--json')) { log(JSON.stringify(out, null, 2)); return out; }
  log(`# leerness which (1.9.164)`);
  log(`${t('현재 실행', 'running from')}: ${out.runningFrom}`);
  log(`${t('버전', 'version')}:      v${out.version}`);
  log(`Node:      ${out.nodeVersion} (${out.platform}/${out.arch})`);
  log('');
  log(t(`## npm 환경`, `## npm environment`));
  if (out.npm.globalRoot) log(`  npm root -g: ${out.npm.globalRoot}`);
  if (out.npm.cacheDir)   log(t(`  npm cache:   ${out.npm.cacheDir}  (npx 옛 버전이 여기 캐싱 — 의심 시 \`npm cache clean --force\`)`, `  npm cache:   ${out.npm.cacheDir}  (npx caches old versions here — if suspect: \`npm cache clean --force\`)`));
  if (out.npm.globalInstalled) log(t(`  글로벌 설치: leerness@${out.npm.globalInstalled}`, `  global install: leerness@${out.npm.globalInstalled}`));
  else log(t(`  글로벌 설치: (없음 — npx 또는 로컬 경로만 사용 중)`, `  global install: (none — using npx or a local path only)`));
  if (out.pathCandidates.length) {
    log('');
    log(t(`## PATH 후보 (${out.pathCandidates.length}개 · 설치 ${out.pathInstallations.length}개)`, `## PATH candidates (${out.pathCandidates.length} · ${out.pathInstallations.length} installation(s))`));
    for (const p of out.pathCandidates) log(`  - ${p}`);
    const groupedShims = out.pathInstallations.filter(group => group.kind === 'npm-package' && group.candidates.length > 1);
    if (groupedShims.length) {
      const variants = groupedShims.reduce((sum, group) => sum + group.candidates.length, 0);
      log(t(`  ⓘ 동일 npm 설치의 shim 변형 ${variants}개를 설치 ${groupedShims.length}개로 그룹화`, `  ⓘ grouped ${variants} shim variants into ${groupedShims.length} npm installation(s)`));
    }
  }
  if (out.diagnostics.length) {
    log('');
    log(t(`## ⚠ 진단`, `## ⚠ diagnostics`));
    for (const d of out.diagnostics) log(`  ${d}`);
  } else {
    log('');
    log(t(`✓ 충돌 없음 (현재 실행 버전 = 글로벌 설치 버전)`, `✓ no conflict (running version = global install version)`));
  }
  log('');
  log(t(`💡 강제 최신 실행 방법:`, `💡 how to force the latest:`));
  log(t(`  1) npx --yes leerness@latest <command>        # npx 캐시 무시하고 최신 다운로드`, `  1) npx --yes leerness@latest <command>        # bypass npx cache, download latest`));
  log(t(`  2) npm i -g leerness@latest                    # 글로벌 설치 갱신`, `  2) npm i -g leerness@latest                    # update the global install`));
  log(t(`  3) npm cache clean --force                     # npx 캐시 강제 비우기 (의심 시)`, `  3) npm cache clean --force                     # force-clear the npx cache (if suspect)`));
  return out;
}

 
 
function whatsNewCmd(root, deps = {}) {
  const { VERSION, uiLang, arg, has } = deps;
  const t = (ko, en) => (uiLang === 'en' ? en : ko);   
  root = absRoot(root || process.cwd());
  const fromV = arg('--from', null) || (function () {
    const hv = path.join(root, '.leerness', 'HARNESS_VERSION');
    if (exists(hv)) { try { return parseHarnessVersion(read(hv)).base || parseHarnessVersion(read(hv)).plus; } catch { return null; } }
    return null;
  })();
  const toV = arg('--to', null) || VERSION;
  if (!fromV) {
    fail(t('현재 버전을 파악할 수 없습니다. --from <version> 명시', 'cannot determine current version. specify --from <version>'));
    return process.exit(1);
  }
   
  if (compareVer(fromV, toV) > 0) {
    if (has('--json')) { log(JSON.stringify({ ok: false, code: 'invalid_range', error: `--from(${fromV}) 이 --to(${toV}) 보다 큼 — 인자 순서 확인` }, null, 2)); return process.exit(1); }
    fail(t(`--from(${fromV}) 이 --to(${toV}) 보다 큼 — 인자 순서 확인`, `--from (${fromV}) is newer than --to (${toV}) — check argument order`));
    return process.exit(1);
  }
   
  let changelogPath = path.join(root, 'CHANGELOG.md');
  if (!exists(changelogPath)) changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
  if (!exists(changelogPath)) {
    fail(t('CHANGELOG.md 없음', 'CHANGELOG.md not found'));
    return process.exit(1);
  }
  const diff = _parseChangelogBetween(read(changelogPath), fromV, toV);
  if (has('--json')) {
     
     
     
    const _rawLim = parseInt(arg('--limit', '30'), 10);
    const _lim = has('--all') ? diff.length : (Number.isFinite(_rawLim) && _rawLim > 0 ? _rawLim : 30);
    const _shown = diff.slice(0, _lim);
    const _truncated = _shown.length < diff.length;
    log(JSON.stringify({
      from: fromV, to: toV,
      versions: _shown,
      totalVersions: diff.length,
      shown: _shown.length,
      truncated: _truncated,
       
      ...(_truncated ? { hint: t(`최신 ${_shown.length}개만 표시 — 전체는 --all, 개수 조절은 --limit N`, `showing newest ${_shown.length} only — use --all for everything, --limit N to adjust`) } : {})
    }, null, 2));
    return;
  }
  if (!diff.length) {
    log(`# leerness whats-new (1.9.41)`);
    log(t(`현재 ${fromV} ↔ 대상 ${toV}: 새 항목 없음 (또는 CHANGELOG에 기록 안 됨)`, `current ${fromV} ↔ target ${toV}: no new entries (or not recorded in CHANGELOG)`));
    return;
  }
  log(`# leerness whats-new (1.9.41)`);
  log(t(`현재 워크스페이스 버전: ${fromV} → 대상: ${toV}`, `current workspace version: ${fromV} → target: ${toV}`));
  log(t(`범위: ${diff.length}개 버전 (${diff[0].version} → ${diff[diff.length - 1].version})`, `range: ${diff.length} version(s) (${diff[0].version} → ${diff[diff.length - 1].version})`));
  log('');
   
  log(t(`## 🆕 신규 명령·플래그·파일 (AI 에이전트는 다음 명령을 우선 시도)`, `## 🆕 new commands·flags·files (AI agents: try these first)`));
  const allCommands = new Set();
  const allFlags = new Set();
  const allFiles = new Set();
  for (const v of diff) {
    v.newCommands.forEach(c => allCommands.add(c));
    v.newFlags.forEach(f => allFlags.add(f));
    v.newFiles.forEach(f => allFiles.add(f));
  }
  if (allCommands.size) log(t(`  📌 신규 명령: ${[...allCommands].join(', ')}`, `  📌 new commands: ${[...allCommands].join(', ')}`));
  if (allFlags.size)    log(t(`  🚩 신규 플래그: ${[...allFlags].join(', ')}`, `  🚩 new flags: ${[...allFlags].join(', ')}`));
  if (allFiles.size)    log(t(`  📄 신규 파일: ${[...allFiles].join(', ')}`, `  📄 new files: ${[...allFiles].join(', ')}`));
  log('');
  log(t(`## 📜 버전별 헤드라인`, `## 📜 per-version headlines`));
   
   
  const _txtRawLim = parseInt(arg('--limit', ''), 10);
  const _txtLim = (has('--limit') && Number.isFinite(_txtRawLim) && _txtRawLim > 0) ? _txtRawLim : diff.length;
  for (const v of diff.slice(0, _txtLim)) {
     
    const firstLine = (v.body.match(/^\*\*([^*]+)\*\*/) || [])[1]
                   || (v.body.split('\n').find(l => l.trim() && !l.startsWith('##')) || '').trim().slice(0, 120);
    log(`  • ${v.version}${v.date ? ` (${v.date})` : ''} — ${firstLine || '(no headline)'}`);
  }
  if (_txtLim < diff.length) log(t(`  … 외 ${diff.length - _txtLim}개 버전 (전체: --all 또는 --limit 생략)`, `  … ${diff.length - _txtLim} more version(s) (drop --limit or use --all for everything)`));
  log('');
  log(t(`## 💡 권장 행동`, `## 💡 recommended actions`));
  log(t(`  1. 위 신규 명령들을 시도해 보세요 (예: \`leerness <명령> --help\`)`, `  1. Try the new commands above (e.g. \`leerness <command> --help\`)`));
  log(t(`  2. 신규 파일들을 읽어 보세요 (예: \`cat .leerness/session-workflow.md\`)`, `  2. Read the new files (e.g. \`cat .leerness/session-workflow.md\`)`));
  log(t(`  3. AGENTS.md/CLAUDE.md 재독 — migrate가 인스트럭션을 업데이트했을 수 있음`, `  3. Re-read AGENTS.md/CLAUDE.md — migrate may have updated the instructions`));
  log(t(`  4. 상세: \`cat CHANGELOG.md\` 또는 \`leerness whats-new --json\``, `  4. Details: \`cat CHANGELOG.md\` or \`leerness whats-new --json\``));
}

module.exports = { doctorCmd, whichCmd, whatsNewCmd, _groupPathInstallations, _npmPackageIdentity };
