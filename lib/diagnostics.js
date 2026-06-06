// lib/diagnostics.js — 설치/환경 진단 핸들러 (doctor / which).
// 1.9.392 (UR-0025 큰 핸들러 모듈화 4번째): bin/harness.js 에서 doctor/which 분리.
//   - I/O: ./io(log).  node: child_process.
//   - harness 고유 의존(VERSION · _selfTestCases · _detectShellCtx · _mcpToolCount · argv 파서 has · harnessPath)은 deps 주입(DI).
//     _selfTestCases 의 각 case.run 클로저는 harness 스코프를 유지하므로 함수 참조 주입만으로 정상 동작.
'use strict';
const cp = require('child_process');
const path = require('path');
const { log, fail, absRoot, exists, read } = require('./io');
const { parseHarnessVersion, _parseChangelogBetween } = require('./pure-utils');

function doctorCmd(opts = {}, deps = {}) {
  const { VERSION, _selfTestCases, _detectShellCtx, _mcpToolCount, has, harnessPath } = deps;
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
  log(cy(`# leerness doctor — 설치/환경 진단`));
  log('');
  log(`  ${gr('✓')} version ${VERSION} · node ${process.version} · ${process.platform}/${process.arch}`);
  log(`  ${gr('✓')} 설치 경로: ${dm(harnessPath)}`);
  log(`  ${gr('✓')} MCP 도구: ${mcpCount}`);
  log(`  ${report.selftest.ok ? gr('✓') : rd('✗')} selftest: ${pass}/${total} ${report.selftest.ok ? '통과' : '실패'}`);
  if (!report.selftest.ok) report.selftest.failed.slice(0, 5).forEach(n => log(rd(`     ✗ ${n}`)));
  log(`  ${gr('✓')} 셸: ${shell || 'unknown'}${psVersion && shell === 'powershell' ? ` (PowerShell ${psVersion})` : ''}`);
  log('');
  log(report.healthy ? gr('  ✓ leerness 설치 정상') : rd('  ✗ 문제 감지 — 재설치: npm i -g leerness@latest · 진단: leerness which'));
  if (!report.healthy) process.exitCode = 1;
  return report;
}

function whichCmd(deps = {}) {
  const { VERSION, has, harnessPath } = deps;
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
    out.diagnostics.push(`⚠ 글로벌 설치 ${out.npm.globalInstalled} ≠ 현재 실행 ${VERSION} — npx 캐시 또는 PATH 충돌 의심`);
    out.diagnostics.push(`  → 강제 최신: npm i -g leerness@latest  /  또는 npx --yes leerness@latest <command>`);
  }
  if (out.pathCandidates.length > 1) {
    out.diagnostics.push(`⚠ PATH 에 leerness 가 ${out.pathCandidates.length}개 — 우선순위 충돌 가능`);
    out.diagnostics.push(`  → 명시적 경로 사용: ${out.runningFrom}`);
  }
  if (has('--json')) { log(JSON.stringify(out, null, 2)); return; }
  log(`# leerness which (1.9.164)`);
  log(`현재 실행: ${out.runningFrom}`);
  log(`버전:      v${out.version}`);
  log(`Node:      ${out.nodeVersion} (${out.platform}/${out.arch})`);
  log('');
  log(`## npm 환경`);
  if (out.npm.globalRoot) log(`  npm root -g: ${out.npm.globalRoot}`);
  if (out.npm.cacheDir)   log(`  npm cache:   ${out.npm.cacheDir}  (npx 옛 버전이 여기 캐싱 — 의심 시 \`npm cache clean --force\`)`);
  if (out.npm.globalInstalled) log(`  글로벌 설치: leerness@${out.npm.globalInstalled}`);
  else log(`  글로벌 설치: (없음 — npx 또는 로컬 경로만 사용 중)`);
  if (out.pathCandidates.length) {
    log('');
    log(`## PATH 후보 (${out.pathCandidates.length}개)`);
    for (const p of out.pathCandidates) log(`  - ${p}`);
  }
  if (out.diagnostics.length) {
    log('');
    log(`## ⚠ 진단`);
    for (const d of out.diagnostics) log(`  ${d}`);
  } else {
    log('');
    log(`✓ 충돌 없음 (현재 실행 버전 = 글로벌 설치 버전)`);
  }
  log('');
  log(`💡 강제 최신 실행 방법:`);
  log(`  1) npx --yes leerness@latest <command>        # npx 캐시 무시하고 최신 다운로드`);
  log(`  2) npm i -g leerness@latest                    # 글로벌 설치 갱신`);
  log(`  3) npm cache clean --force                     # npx 캐시 강제 비우기 (의심 시)`);
}

// 1.9.394 (UR-0025): whats-new — 현재 워크스페이스 버전 → 도구 버전 CHANGELOG 차분(신규 명령/플래그/파일 요약). introspection 핸들러.
//   순수 파서 _parseChangelogBetween(pure-utils) 사용. deps: VERSION/arg/has. CHANGELOG 경로는 root 우선, 없으면 pkg 자체(lib/../).
function whatsNewCmd(root, deps = {}) {
  const { VERSION, arg, has } = deps;
  root = absRoot(root || process.cwd());
  const fromV = arg('--from', null) || (function () {
    const hv = path.join(root, '.harness', 'HARNESS_VERSION');
    if (exists(hv)) { try { return parseHarnessVersion(read(hv)).base || parseHarnessVersion(read(hv)).plus; } catch { return null; } }
    return null;
  })();
  const toV = arg('--to', null) || VERSION;
  if (!fromV) {
    fail('현재 버전을 파악할 수 없습니다. --from <version> 명시');
    return process.exit(1);
  }
  // CHANGELOG.md — 우선 root, 없으면 leerness-pkg 자체 (lib/../CHANGELOG.md = pkg 루트)
  let changelogPath = path.join(root, 'CHANGELOG.md');
  if (!exists(changelogPath)) changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
  if (!exists(changelogPath)) {
    fail('CHANGELOG.md 없음');
    return process.exit(1);
  }
  const diff = _parseChangelogBetween(read(changelogPath), fromV, toV);
  if (has('--json')) { log(JSON.stringify({ from: fromV, to: toV, versions: diff }, null, 2)); return; }
  if (!diff.length) {
    log(`# leerness whats-new (1.9.41)`);
    log(`현재 ${fromV} ↔ 대상 ${toV}: 새 항목 없음 (또는 CHANGELOG에 기록 안 됨)`);
    return;
  }
  log(`# leerness whats-new (1.9.41)`);
  log(`현재 워크스페이스 버전: ${fromV} → 대상: ${toV}`);
  log(`범위: ${diff.length}개 버전 (${diff[0].version} → ${diff[diff.length - 1].version})`);
  log('');
  // AI 가독 요약 — 각 버전당 한 줄 + 신규 명령/플래그/파일
  log(`## 🆕 신규 명령·플래그·파일 (AI 에이전트는 다음 명령을 우선 시도)`);
  const allCommands = new Set();
  const allFlags = new Set();
  const allFiles = new Set();
  for (const v of diff) {
    v.newCommands.forEach(c => allCommands.add(c));
    v.newFlags.forEach(f => allFlags.add(f));
    v.newFiles.forEach(f => allFiles.add(f));
  }
  if (allCommands.size) log(`  📌 신규 명령: ${[...allCommands].join(', ')}`);
  if (allFlags.size)    log(`  🚩 신규 플래그: ${[...allFlags].join(', ')}`);
  if (allFiles.size)    log(`  📄 신규 파일: ${[...allFiles].join(', ')}`);
  log('');
  log(`## 📜 버전별 헤드라인`);
  for (const v of diff) {
    // body 첫 줄(또는 strong header) 추출
    const firstLine = (v.body.match(/^\*\*([^*]+)\*\*/) || [])[1]
                   || (v.body.split('\n').find(l => l.trim() && !l.startsWith('##')) || '').trim().slice(0, 120);
    log(`  • ${v.version}${v.date ? ` (${v.date})` : ''} — ${firstLine || '(no headline)'}`);
  }
  log('');
  log(`## 💡 권장 행동`);
  log(`  1. 위 신규 명령들을 시도해 보세요 (예: \`leerness <명령> --help\`)`);
  log(`  2. 신규 파일들을 읽어 보세요 (예: \`cat .harness/session-workflow.md\`)`);
  log(`  3. AGENTS.md/CLAUDE.md 재독 — migrate가 인스트럭션을 업데이트했을 수 있음`);
  log(`  4. 상세: \`cat CHANGELOG.md\` 또는 \`leerness whats-new --json\``);
}

module.exports = { doctorCmd, whichCmd, whatsNewCmd };
