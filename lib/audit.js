// lib/audit.js — audit 핸들러 (UR-0025/UR-0125 큰 핸들러 모듈화 6번째, 1.9.421)
//   bin/leerness.js 에서 audit(310줄) 분리. DI: harness 고유 의존(VERSION, arg, has, planPath, readProgressRows, currentStatePath, handoffPath, envDiff, _readFeatureGraph, _matchAPISkills, _listAPISkills) 주입.
//   io 프리미티브는 ./io, SECRET_PATTERNS 는 ./catalogs, cp/path 빌트인. 동작/출력 무변경.
'use strict';
const cp = require('child_process');
const path = require('path');
const { log, ok, warn, fail, failJson, today, now, absRoot, exists, read, readBuf, mkdirp, writeUtf8, append, rel } = require('./io');
const { SECRET_PATTERNS } = require('./catalogs');
const { findCorruptedStateJson } = require('./state-integrity');  // 1.36.1 (클린룸 리뷰 FN): 상태 JSON 무결성

function audit(root, opts = {}, deps = {}) {
  const { VERSION, arg, has, planPath, readProgressRows, currentStatePath, handoffPath, envDiff, _readFeatureGraph, _matchAPISkills, _listAPISkills, _collectSecretFindings } = deps;
  root = absRoot(root);
  let warnings = 0, failures = 0;
  // 1.9.35 개선 #5: --fix 옵션 — 자동 수정 가능한 항목 적용
  const fix = has('--fix');
  let fixed = 0;
  // 1.9.102: --json 모드 — stdout 억제 후 구조화 출력
  const jsonMode = !!opts.json || has('--json');
  const findings = [];
  const _finding = (kind, severity, message, details = {}) => findings.push({ kind, severity, message, ...details });
  const _origWrite = process.stdout.write.bind(process.stdout);
  if (jsonMode) process.stdout.write = () => true;
  try {
  // 외부리뷰 CV-3/UR-0078: 미초기화/존재하지 않는 경로를 healthy 로 오판하던 것 수정 — 필수 마커 부재 시 failure 승격(verify 와 일관).
  if (!exists(root) || !exists(path.join(root, '.harness')) || !exists(path.join(root, 'AGENTS.md'))) {
    failures++;
    fail(`미초기화 또는 존재하지 않는 경로: ${root} (.harness/AGENTS.md 없음 — leerness init 필요)`);
    _finding('not_initialized', 'fail', 'uninitialized or missing path (.harness or AGENTS.md absent)', { root });
    // 1.27.1 (13번째 외부리뷰 #2): 미초기화 시 후속 체크(design/reuse 등)를 없는 하네스에 대해 보고하던 모순 출력 차단 — 요약/JSON 으로 직행 후 종료(exit code/JSON 페이로드는 종전과 동일).
    log(`Audit summary: warnings=${warnings} failures=${failures}`);
    if (jsonMode) { process.stdout.write = _origWrite; process.stdout.write(JSON.stringify({ version: VERSION, root, warnings, failures, fixed, healthy: false, fixApplied: fix, strict: has('--strict'), strictThreshold: has('--strict') ? parseInt(arg('--threshold', '1'), 10) : null, summary: `warnings=${warnings} failures=${failures}`, findings }, null, 2) + '\n'); }
    process.exitCode = 1;
    return;
  }
  // 1.36.1 (클린룸 리뷰 FN): .harness/*.json 상태파일 JSON 무결성 — 깨진 JSON 을 그레이스풀 폴백(빈 상태)이 "healthy" 로 감추던 false-negative 차단.
  //   손상 파일을 warning + corrupted_state_json finding 으로 표면화(--strict 시 failure 로 승격). 비-크래시(헬퍼가 파서 예외를 흡수).
  try {
    const corrupted = findCorruptedStateJson(root);
    if (corrupted.length) {
      warnings++;
      warn(`상태파일 JSON 손상 ${corrupted.length}건: ${corrupted.map(c => c.file).join(', ')} (수동 복구 또는 leerness init 필요)`);
      corrupted.slice(0, 6).forEach(c => log(`    ${c.file}: ${c.error}`));
      _finding('corrupted_state_json', 'warn', '.harness 상태파일 JSON 파싱 실패 (손상)', { count: corrupted.length, files: corrupted.map(c => c.file), sample: corrupted.slice(0, 10) });
    } else {
      ok('상태파일 JSON 무결성 OK (.harness/*.json)');
    }
  } catch {}
  const designCands = ['designguide.md','design-guide.md','docs/designguide.md','docs/design-guide.md','.harness/designguide.md'];
  const dups = designCands.filter(f => exists(path.join(root,f)));
  if (dups.length) { warnings++; warn(`design guide duplicates outside canonical: ${dups.join(', ')} (run: leerness consistency merge-design-guide)`); _finding('design_dup', 'warn', 'design guide duplicates outside canonical', { duplicates: dups }); }
  else ok('no duplicate design guide candidates');
  // 1.9.1 P4: <!-- leerness:na --> 마커가 있는 파일은 placeholder 경고 스킵.
  const naMarker = '<!-- leerness:na';
  const ds = exists(path.join(root,'.harness/design-system.md')) ? read(path.join(root,'.harness/design-system.md')) : '';
  if (ds.includes(naMarker)) ok('design-system.md marked NA (skipped)');
  else if (!/\| color\.primary \|/.test(ds) || /\(실제 값으로 업데이트\)/.test(ds)) { warnings++; warn('design-system.md tokens not customized'); _finding('design_system_default', 'warn', 'design-system.md tokens not customized'); }
  else ok('design-system tokens populated');
  const reuse = exists(path.join(root,'.harness/reuse-map.md')) ? read(path.join(root,'.harness/reuse-map.md')) : '';
  const reuseLines = reuse.split('\n').filter(l => l.startsWith('|') && !/Capability|---/.test(l)).length;
  if (reuse.includes(naMarker)) ok('reuse-map.md marked NA (skipped)');
  else if (reuseLines === 0) { warnings++; warn('reuse-map.md is empty (consider populating known reusable elements)'); _finding('reuse_map_empty', 'warn', 'reuse-map.md is empty'); }
  else ok(`reuse-map.md has ${reuseLines} entries`);
  const planText = exists(planPath(root)) ? read(planPath(root)) : '';
  const milestoneIds = Array.from(planText.matchAll(/^### (M-\d{4,})\./gm)).map(m => m[1]);
  const rows = readProgressRows(root);
  // 1.9.6 수정: 한 row에 여러 plan:M-XXXX 링크가 있어도 모두 인식 (matchAll로 전부 추출)
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
  const handoff = exists(handoffPath(root)) ? read(handoffPath(root)) : '';
  if (handoff.includes('Last generated: (자동)')) {
    warnings++; warn('session-handoff.md never auto-generated (run: leerness session close .)');
    _finding('handoff_not_generated', 'warn', 'session-handoff.md never auto-generated');
    // 1.9.35 #5: --fix → session-handoff.md 자동 생성 마커 갱신
    if (fix) {
      const stamped = handoff.replace('Last generated: (자동)', `Last generated: ${today()} (leerness audit --fix)`);
      writeUtf8(handoffPath(root), stamped);
      ok('  ↳ fixed: session-handoff.md timestamp 갱신');
      fixed++;
    }
  }
  else if (handoff.includes('Last generated:')) ok('session-handoff.md auto-generated previously');
  const cur = exists(currentStatePath(root)) ? read(currentStatePath(root)) : '';
  const updMatch = cur.match(/Updated: (\d{4}-\d{2}-\d{2})/);
  if (updMatch) {
    const dDays = (Date.now() - new Date(updMatch[1]).getTime()) / 86400000;
    if (dDays > 7) {
      warnings++; warn(`current-state.md stale (${Math.round(dDays)} days)`);
      _finding('current_state_stale', 'warn', 'current-state.md stale', { days: Math.round(dDays) });
      // 1.9.35 #5: --fix → current-state.md Updated 라인 갱신
      if (fix) {
        const stamped = cur.replace(/Updated: \d{4}-\d{2}-\d{2}/, `Updated: ${today()}`);
        writeUtf8(currentStatePath(root), stamped);
        ok('  ↳ fixed: current-state.md Updated 갱신');
        fixed++;
      }
    }
    else ok('current-state.md fresh');
  }
  // 1.9.40: README의 version 배지 ↔ package.json#version mismatch 감지 (도구 만드는 자가 자기 도구 stale하는 dogfooding gap 차단)
  try {
    const readmePath = path.join(root, 'README.md');
    const pkgPath = path.join(root, 'package.json');
    if (exists(readmePath) && exists(pkgPath)) {
      const readmeText = read(readmePath);
      const pkg = JSON.parse(read(pkgPath));
      const m = readmeText.match(/badge\/version-(\d+\.\d+\.\d+)/);
      if (pkg.version && m && m[1] !== pkg.version) {
        warnings++;
        warn(`README.md version badge mismatch: README=${m[1]} vs package.json=${pkg.version} (run: leerness readme sync)`);
        _finding('readme_version_mismatch', 'warn', 'README.md version badge mismatch', { readme: m[1], pkg: pkg.version });
        if (fix) {
          const updated = readmeText.replace(/badge\/version-[\d.]+-(green|blue|red)/g, `badge/version-${pkg.version}-green`);
          writeUtf8(readmePath, updated);
          ok('  ↳ fixed: README.md version 배지 갱신');
          fixed++;
        }
      }
      // 1.18.4 (GPT-5.5 평가 #7, UR-0006): 배지뿐 아니라 관리블록의 "Last synced by Leerness vX" 도 검사.
      //   1.35.17 (audit 헌트 FP): 이 라인은 readme sync 가 `Last synced by Leerness v${VERSION}`(leerness 도구 버전)으로 쓴다. 기존엔 이를 pkg.version(프로젝트 버전)과 비교해 유저 프로젝트마다(도구≠프로젝트 버전) 항상 오탐 + --fix 가 pkg.version 을 써 다음 readme sync 가 되돌리는 영구 충돌. → 현재 실행 중 leerness VERSION 과 비교(= "오래된 leerness 로 sync 됨 → 재sync" 를 정확히 감지, leerness 자기 repo 는 VERSION==pkg.version 이라 무변화). --fix 도 VERSION 으로 기록(readme sync 와 정합).
      const sm = readmeText.match(/Last synced by Leerness v(\d+\.\d+\.\d+)/);
      if (VERSION && sm && sm[1] !== VERSION) {
        warnings++;
        warn(`README.md managed-block synced by older Leerness: README=v${sm[1]} vs current=v${VERSION} (run: leerness readme sync)`);
        _finding('readme_synced_version_stale', 'warn', 'README.md managed-block synced by older Leerness version', { readme: sm[1], leerness: VERSION });
        if (fix) {
          const updated2 = read(readmePath).replace(/Last synced by Leerness v\d+\.\d+\.\d+/g, `Last synced by Leerness v${VERSION}`);
          writeUtf8(readmePath, updated2);
          ok('  ↳ fixed: README.md 관리블록 synced 버전 갱신');
          fixed++;
        }
      }
    }
  } catch {}
  // 1.9.62: package.json 있으면 npm audit --json 자동 호출 → CVE 보고 (opt-out: --no-npm-audit)
  // 정책: leerness가 외부 호출하지만 사용자 컨텍스트에 이미 npm 설치되어 있음을 가정 (offline 시 자동 스킵)
  if (exists(path.join(root, 'package.json')) && !has('--no-npm-audit') && process.env.LEERNESS_OFFLINE !== '1') {
    try {
      const r = cp.spawnSync('npm', ['audit', '--json'], {
        cwd: root, encoding: 'utf8', shell: true, timeout: 30000
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
              warnings++; // critical/high는 추가 가중
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
  // 1.9.75: .gitignore 보안 검증 — .env / 시크릿 파일이 .gitignore에 포함되는지 (--no-gitignore-check로 끄기)
  if (!has('--no-gitignore-check')) {
    try {
      const gi = path.join(root, '.gitignore');
      const envPath = path.join(root, '.env');
      if (exists(envPath)) {
        // .env가 존재하면 .gitignore가 반드시 있어야 하고, .env가 포함되어야 함
        const giText = exists(gi) ? read(gi) : '';
        const giLines = giText.split('\n').map(l => l.trim());
        // 필수 보안 패턴 (글로벌 룰 .gitignore 보안 체크리스트)
        const SECRET_PATTERNS = ['.env', '.env.local', '.env.production', '.env.*.local', '*.pem', 'credentials.json'];
        // 1.35.17 (audit 헌트 FP): 정확-일치만 보던 것을 광역 glob 커버리지 인식으로 완화 — 흔한 `.env*`/`.env.*`(git 이 .env 패밀리 전체를 실제로 ignore) 를 쓰면 필수 패턴이 '누락' 오탐 나던 것 차단. trailing-star prefix 매칭(`.env*`→`.env` 접두 커버)은 git 동작과 일치라 신규 FN 0(더 관대해질 뿐).
        const _covered = (p) => giLines.some(l => { const s = l.replace(/^\//, ''); return s === p || (s.endsWith('*') && p.startsWith(s.slice(0, -1))); });
        const missing = SECRET_PATTERNS.filter(p => !_covered(p));
        if (missing.length) {
          warnings++;
          warn(`.gitignore에 시크릿 패턴 ${missing.length}건 누락: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ' …' : ''}`);
          _finding('gitignore_missing_secrets', 'warn', '.gitignore에 시크릿 패턴 누락', { missing });
          if (fix) {
            // 자동 추가
            let newGi = giText;
            if (newGi && !newGi.endsWith('\n')) newGi += '\n';
            newGi += `\n# 1.9.75 audit --fix: 시크릿 파일 보안 패턴 자동 추가 (사용자 글로벌 룰)\n`;
            for (const p of missing) newGi += `${p}\n`;
            writeUtf8(gi, newGi);
            ok(`  ↳ fixed: .gitignore에 ${missing.length}건 자동 추가 (시크릿 보안 1.9.75)`);
            fixed++;
          } else {
            log(`    → 자동 추가: leerness audit --fix`);
          }
        } else {
          ok('.gitignore 시크릿 패턴 OK (1.9.75)');
        }
      }
    } catch {}
  }
  // 1.30.1 (14th 외부리뷰 F1): 커밋된 시크릿(_collectSecretFindings.committed)을 failure 로 승격 — scan secrets 와 일관.
  //   기존엔 .gitignore 패턴/.env 동기화만 검사해 소스에 노출된 실 시크릿(AWS/GitHub 등)을 통과시키고 healthy:true 를 반환하던 정직성 갭
  //   (audit 기반 CI 게이트가 노출 시크릿을 통과). gitignored 보관 시크릿은 _collectSecretFindings 가 committed 에서 제외(FP 0). 끄기: --no-secret-scan.
  if (!has('--no-secret-scan') && typeof _collectSecretFindings === 'function') {
    try {
      const { committed } = _collectSecretFindings(root);
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
  // 1.9.71: .env / .env.example 동기화 감사 (--no-env-check로 끄기)
  if (!has('--no-env-check')) {
    try {
      const d = envDiff(root);
      if (exists(d.envPath) && exists(d.examplePath)) {
        if (d.inEnvOnly.length) {
          warnings++;
          warn(`.env에 있는 키 ${d.inEnvOnly.length}건이 .env.example에 누락: ${d.inEnvOnly.slice(0, 4).join(', ')}${d.inEnvOnly.length > 4 ? ' …' : ''}`);
          _finding('env_keys_missing', 'warn', '.env 키가 .env.example에 누락', { keys: d.inEnvOnly });
          if (fix) {
            // 자동 동기화: 누락 키만 .env.example 끝에 append (값 비움)
            let example = read(d.examplePath);
            if (!example.endsWith('\n')) example += '\n';
            example += `\n# 1.9.71 audit --fix: 누락 키 자동 추가 (값은 빈 문자열, 보안 정책)\n`;
            for (const k of d.inEnvOnly) example += `${k}=\n`;
            writeUtf8(d.examplePath, example);
            ok(`  ↳ fixed: .env.example에 ${d.inEnvOnly.length}건 자동 추가 (값은 빈 문자열, 1.9.71)`);
            fixed++;
          } else {
            log(`    → 자동 동기화: leerness env sync 또는 leerness audit --fix`);
          }
        } else {
          ok('.env ↔ .env.example 동기화됨 (1.9.71)');
        }
      }
    } catch {}
  }
  // 1.9.142: Feature Graph 무결성 검증 — orphan/cycle 자동 감지 (--no-feature-check로 끄기)
  if (!has('--no-feature-check')) {
    try {
      const { nodes: fNodes } = _readFeatureGraph(root);
      if (fNodes.length > 0) {
        const ids = new Set(fNodes.map(n => n.id));
        // (1) orphan: 다른 노드가 참조하는데 정의가 없는 ID
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
        // (2) cycle: affects 그래프에서 순환 의존성 감지 (DFS)
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
              // 순환 발견 — path 에 next 까지 자르기
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
  // 1.9.247 (UR-0015 2단계): api-skill 참조 audit — API 관련 task 인데 .harness/api-skills/ 미참조 시 경고
  //   사용자 명시 (UR-0015): "AI가 정리해둔 파일이 참조되는지 확인"
  //   현재 in-progress task 의 request/nextAction 에 API 키워드 (URL, "API", "endpoint", "REST", "GraphQL", "OAuth", "webhook") 있는데
  //   _matchAPISkills() 결과가 0 이면 → 경고 + leerness api-skill add <url> 안내
  try {
    const rows = readProgressRows(root);
    const ip = rows.find(r => r.status === 'in-progress');
    if (ip) {
      const taskText = (ip.request || '') + ' ' + (ip.nextAction || '') + ' ' + (ip.evidence || '');
      // 1.35.17 (audit 헌트 FP, codex): API/REST 는 대소문자-민감(약어)로 분리 — 기존 /…|REST|…/i 는 영어 단어 "rest"("clean up the rest of …")를 매칭해 api_skill 오탐. 서술형 토큰(endpoint/graphql/oauth/webhook/url)만 대소문자-무관 유지.
      const apiKeywords = /endpoint|GraphQL|OAuth|webhook|https?:\/\/[^\s]+/i;
      const apiAcronym = /\bAPI\b|\bREST\b/;  // 대문자 약어만
      if (apiKeywords.test(taskText) || apiAcronym.test(taskText)) {
        const matched = _matchAPISkills(root, taskText);
        const allSkills = _listAPISkills(root);
        if (matched.length === 0) {
          warnings++;
          warn(`API 관련 task 감지 (현재: "${(ip.request || '').slice(0, 60)}") — .harness/api-skills/ 매칭 0건 (저장 ${allSkills.length})`);
          warn(`  → leerness api-skill add <url> --direction "구현 방향" 으로 정리 권장 (1.9.245 UR-0015 / 1.9.247 audit)`);
          _finding('api_skill_missing', 'warn', 'API 관련 task 인데 .harness/api-skills/ 매칭 없음', {
            taskRequest: (ip.request || '').slice(0, 100),
            apiSkillsTotal: allSkills.length,
            matched: 0,
            hint: 'leerness api-skill add <url> --direction "..."'
          });
        } else {
          ok(`API skill 매칭 OK (현재 task → ${matched.length}건 매칭 in .harness/api-skills/, 1.9.247 UR-0015 2단계)`);
        }
      }
    }
  } catch {}
  // 1.9.63: --strict — warnings ≥ threshold 시 failures로 승격 (CI 친화)
  if (has('--strict')) {
    const threshold = parseInt(arg('--threshold', '1'), 10);
    // 1.35.17 (audit 헌트 FP, codex): warnings>0 가드 추가 — `--threshold 0` (또는 음수)이면 `warnings>=0` 이 항상 참이라 경고 0인 clean 프로젝트도 실패시키던 footgun. 실제 경고가 있을 때만 승격.
    if (warnings > 0 && warnings >= threshold) {
      failures++;
      warn(`--strict 활성: warnings ${warnings} ≥ threshold ${threshold} → failures 승격`);
      _finding('strict_promoted', 'fail', `warnings ${warnings} ≥ threshold ${threshold} → failures 승격`, { warnings, threshold });
    }
  }
  log(`Audit summary: warnings=${warnings} failures=${failures}${fix ? ` fixed=${fixed}` : ''}${has('--strict') ? ` strict-threshold=${arg('--threshold', '1')}` : ''}`);
  } finally {
    // 1.9.102: stdout 복원
    if (jsonMode) process.stdout.write = _origWrite;
  }
  // 1.9.102: JSON 모드 — 구조화 출력
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
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  }
  if (failures) process.exitCode = 1;
}

module.exports = { audit };
