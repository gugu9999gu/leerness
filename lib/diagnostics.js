// lib/diagnostics.js — 설치/환경 진단 핸들러 (doctor / which).
// 1.9.392 (UR-0025 큰 핸들러 모듈화 4번째): bin/harness.js 에서 doctor/which 분리.
//   - I/O: ./io(log).  node: child_process.
//   - harness 고유 의존(VERSION · _selfTestCases · _detectShellCtx · _mcpToolCount · argv 파서 has · harnessPath)은 deps 주입(DI).
//     _selfTestCases 의 각 case.run 클로저는 harness 스코프를 유지하므로 함수 참조 주입만으로 정상 동작.
'use strict';
const cp = require('child_process');
const path = require('path');
const { log, fail, absRoot, exists, read } = require('./io');
const { parseHarnessVersion, _parseChangelogBetween, compareVer } = require('./pure-utils');

function doctorCmd(opts = {}, deps = {}) {
  const { VERSION, uiLang, _selfTestCases, _detectShellCtx, _mcpToolCount, has, harnessPath } = deps;
  const t = (ko, en) => (uiLang === 'en' ? en : ko);  // 1.28.2 (UR-0010 Phase 10c)
  const json = opts.json || has('--json');
  // 1) 코어 무결성: selftest 케이스 인라인 실행
  let pass = 0; const failNames = [];
  try {
    for (const c of _selfTestCases()) {
      let okc = false;
      try { okc = !!c.run(); } catch { okc = false; }
      if (okc) pass++; else failNames.push(c.name);
    }
  } catch {}
  const total = pass + failNames.length;
  // 2) 셸/PowerShell 컨텍스트 (UR-0052)
  let shell = null, psVersion = null;
  try { const ctx = _detectShellCtx(); shell = ctx.shell; psVersion = ctx.psVersion; } catch {}
  const mcpCount = (() => { try { return _mcpToolCount(); } catch { return null; } })();
  const report = {
    version: VERSION, node: process.version, platform: process.platform + '/' + process.arch,
    runningFrom: harnessPath, mcpTools: mcpCount,
    selftest: { pass, total, ok: failNames.length === 0, failed: failNames },
    shell, psVersion, healthy: failNames.length === 0
  };
  if (json) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); if (!report.healthy) process.exitCode = 1; return report; }
  const isTty = process.stdout && process.stdout.isTTY;
  const gr = s => isTty ? `\x1b[32m${s}\x1b[0m` : s, rd = s => isTty ? `\x1b[31m${s}\x1b[0m` : s, cy = s => isTty ? `\x1b[36m${s}\x1b[0m` : s, dm = s => isTty ? `\x1b[2m${s}\x1b[0m` : s;
  log(cy(t(`# leerness doctor — 설치/환경 진단`, `# leerness doctor — install/environment diagnosis`)));
  log('');
  log(`  ${gr('✓')} version ${VERSION} · node ${process.version} · ${process.platform}/${process.arch}`);
  log(`  ${gr('✓')} ${t('설치 경로', 'install path')}: ${dm(harnessPath)}`);
  log(`  ${gr('✓')} ${t('MCP 도구', 'MCP tools')}: ${mcpCount}`);
  // 1.13.1 (15th 블라인드 리뷰 P3, Sonnet): pass 수에 '실패' 가 붙어 "209/210 실패"(=209건 실패로 오독)되던 문구 → "통과 N/M (K건 실패)" 로 명확화.
  log(`  ${report.selftest.ok ? gr('✓') : rd('✗')} selftest: ${pass}/${total} ${t('통과', 'passed')}${report.selftest.ok ? '' : t(` (${total - pass}건 실패)`, ` (${total - pass} failed)`)}`);
  if (!report.selftest.ok) report.selftest.failed.slice(0, 5).forEach(n => log(rd(`     ✗ ${n}`)));
  log(`  ${gr('✓')} ${t('셸', 'shell')}: ${shell || 'unknown'}${psVersion && shell === 'powershell' ? ` (PowerShell ${psVersion})` : ''}`);
  log('');
  log(report.healthy ? gr(t('  ✓ leerness 설치 정상', '  ✓ leerness install OK')) : rd(t('  ✗ 문제 감지 — 재설치: npm i -g leerness@latest · 진단: leerness which', '  ✗ problem detected — reinstall: npm i -g leerness@latest · diagnose: leerness which')));
  if (!report.healthy) process.exitCode = 1;
  return report;
}

function whichCmd(deps = {}) {
  const { VERSION, uiLang, has, harnessPath } = deps;
  const t = (ko, en) => (uiLang === 'en' ? en : ko);  // 1.28.2 (UR-0010 Phase 10c)
  const out = {
    version: VERSION,
    runningFrom: harnessPath,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    npm: {},
    pathCandidates: []
  };
  // npm root -g (글로벌 설치 경로)
  try {
    const r = cp.spawnSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 5000, shell: true });
    if (r.status === 0) out.npm.globalRoot = (r.stdout || '').trim();
  } catch {}
  // npm cache (npx 캐시 경로)
  try {
    const r = cp.spawnSync('npm', ['config', 'get', 'cache'], { encoding: 'utf8', timeout: 5000, shell: true });
    if (r.status === 0) out.npm.cacheDir = (r.stdout || '').trim();
  } catch {}
  // npm 글로벌 leerness 설치 정보
  try {
    const r = cp.spawnSync('npm', ['ls', '-g', 'leerness', '--depth=0', '--json'], { encoding: 'utf8', timeout: 8000, shell: true });
    if (r.stdout) {
      try {
        const j = JSON.parse(r.stdout);
        if (j.dependencies?.leerness) out.npm.globalInstalled = j.dependencies.leerness.version;
      } catch {}
    }
  } catch {}
  // PATH 후보 (Windows: where / Unix: which)
  try {
    const isWin = process.platform === 'win32';
    const tool = isWin ? 'where' : 'which';
    const r = cp.spawnSync(tool, ['-a', 'leerness'], { encoding: 'utf8', timeout: 5000, shell: true });
    if (r.stdout) out.pathCandidates = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  } catch {}
  // 진단: 글로벌 설치된 leerness 와 현재 실행 버전이 다르면 경고
  out.diagnostics = [];
  if (out.npm.globalInstalled && out.npm.globalInstalled !== VERSION) {
    out.diagnostics.push(t(`⚠ 글로벌 설치 ${out.npm.globalInstalled} ≠ 현재 실행 ${VERSION} — npx 캐시 또는 PATH 충돌 의심`, `⚠ global install ${out.npm.globalInstalled} ≠ running ${VERSION} — suspect npx cache or PATH conflict`));
    out.diagnostics.push(t(`  → 강제 최신: npm i -g leerness@latest  /  또는 npx --yes leerness@latest <command>`, `  → force latest: npm i -g leerness@latest  /  or npx --yes leerness@latest <command>`));
  }
  if (out.pathCandidates.length > 1) {
    out.diagnostics.push(t(`⚠ PATH 에 leerness 가 ${out.pathCandidates.length}개 — 우선순위 충돌 가능`, `⚠ leerness appears ${out.pathCandidates.length}× on PATH — possible precedence conflict`));
    out.diagnostics.push(t(`  → 명시적 경로 사용: ${out.runningFrom}`, `  → use the explicit path: ${out.runningFrom}`));
  }
  if (has('--json')) { log(JSON.stringify(out, null, 2)); return; }
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
    log(t(`## PATH 후보 (${out.pathCandidates.length}개)`, `## PATH candidates (${out.pathCandidates.length})`));
    for (const p of out.pathCandidates) log(`  - ${p}`);
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
}

// 1.9.394 (UR-0025): whats-new — 현재 워크스페이스 버전 → 도구 버전 CHANGELOG 차분(신규 명령/플래그/파일 요약). introspection 핸들러.
//   순수 파서 _parseChangelogBetween(pure-utils) 사용. deps: VERSION/arg/has. CHANGELOG 경로는 root 우선, 없으면 pkg 자체(lib/../).
function whatsNewCmd(root, deps = {}) {
  const { VERSION, uiLang, arg, has } = deps;
  const t = (ko, en) => (uiLang === 'en' ? en : ko);  // 1.28.2 (UR-0010 Phase 10c)
  root = absRoot(root || process.cwd());
  const fromV = arg('--from', null) || (function () {
    const hv = path.join(root, '.harness', 'HARNESS_VERSION');
    if (exists(hv)) { try { return parseHarnessVersion(read(hv)).base || parseHarnessVersion(read(hv)).plus; } catch { return null; } }
    return null;
  })();
  const toV = arg('--to', null) || VERSION;
  if (!fromV) {
    fail(t('현재 버전을 파악할 수 없습니다. --from <version> 명시', 'cannot determine current version. specify --from <version>'));
    return process.exit(1);
  }
  // 1.36.49 (codex 6차 #10): 역순 범위(from > to)는 빈 성공이 아니라 명시 오류 — 인자 순서 착오를 조용히 삼키지 않는다.
  if (compareVer(fromV, toV) > 0) {
    if (has('--json')) { log(JSON.stringify({ ok: false, code: 'invalid_range', error: `--from(${fromV}) 이 --to(${toV}) 보다 큼 — 인자 순서 확인` }, null, 2)); return process.exit(1); }
    fail(t(`--from(${fromV}) 이 --to(${toV}) 보다 큼 — 인자 순서 확인`, `--from (${fromV}) is newer than --to (${toV}) — check argument order`));
    return process.exit(1);
  }
  // CHANGELOG.md — 우선 root, 없으면 leerness-pkg 자체 (lib/../CHANGELOG.md = pkg 루트)
  let changelogPath = path.join(root, 'CHANGELOG.md');
  if (!exists(changelogPath)) changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
  if (!exists(changelogPath)) {
    fail(t('CHANGELOG.md 없음', 'CHANGELOG.md not found'));
    return process.exit(1);
  }
  const diff = _parseChangelogBetween(read(changelogPath), fromV, toV);
  if (has('--json')) {
    // 1.36.69 (성장 한계 클래스): CHANGELOG 누적(1MB+)으로 --json 이 800KB 를 넘겨 AI 소비자의 컨텍스트를 폭파시켰다.
    //   기본은 최신 30개 버전으로 제한(에이전트가 실제로 읽는 범위) + 절단 사실을 정직하게 표기. 전체는 --all/--limit 로 옵트인.
    // (검수 #2) 무효/비양수 limit 은 기본값으로 폴백 — `--limit -5` 가 1 이 되던 비일관 제거
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
      // (검수 #3) 힌트도 UI 언어 준수
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
  // AI 가독 요약 — 각 버전당 한 줄 + 신규 명령/플래그/파일
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
  // 1.36.70 (검수 #1): migrate 보고서가 광고하는 `--limit N` 이 텍스트 모드에서 조용히 무시되던 것 —
  //   명시적 --limit 만 존중(기본 텍스트 출력은 전체 유지, 계약 무변경).
  const _txtRawLim = parseInt(arg('--limit', ''), 10);
  const _txtLim = (has('--limit') && Number.isFinite(_txtRawLim) && _txtRawLim > 0) ? _txtRawLim : diff.length;
  for (const v of diff.slice(0, _txtLim)) {
    // body 첫 줄(또는 strong header) 추출
    const firstLine = (v.body.match(/^\*\*([^*]+)\*\*/) || [])[1]
                   || (v.body.split('\n').find(l => l.trim() && !l.startsWith('##')) || '').trim().slice(0, 120);
    log(`  • ${v.version}${v.date ? ` (${v.date})` : ''} — ${firstLine || '(no headline)'}`);
  }
  if (_txtLim < diff.length) log(t(`  … 외 ${diff.length - _txtLim}개 버전 (전체: --all 또는 --limit 생략)`, `  … ${diff.length - _txtLim} more version(s) (drop --limit or use --all for everything)`));
  log('');
  log(t(`## 💡 권장 행동`, `## 💡 recommended actions`));
  log(t(`  1. 위 신규 명령들을 시도해 보세요 (예: \`leerness <명령> --help\`)`, `  1. Try the new commands above (e.g. \`leerness <command> --help\`)`));
  log(t(`  2. 신규 파일들을 읽어 보세요 (예: \`cat .harness/session-workflow.md\`)`, `  2. Read the new files (e.g. \`cat .harness/session-workflow.md\`)`));
  log(t(`  3. AGENTS.md/CLAUDE.md 재독 — migrate가 인스트럭션을 업데이트했을 수 있음`, `  3. Re-read AGENTS.md/CLAUDE.md — migrate may have updated the instructions`));
  log(t(`  4. 상세: \`cat CHANGELOG.md\` 또는 \`leerness whats-new --json\``, `  4. Details: \`cat CHANGELOG.md\` or \`leerness whats-new --json\``));
}

module.exports = { doctorCmd, whichCmd, whatsNewCmd };
