// lib/audit.js — audit 핸들러 (UR-0025/UR-0125 큰 핸들러 모듈화 6번째, 1.9.421)
//   bin/leerness.js 에서 audit(310줄) 분리. DI: harness 고유 의존(VERSION, arg, has, planPath, readProgressRows, currentStatePath, handoffPath, envDiff, _readFeatureGraph, _matchAPISkills, _listAPISkills) 주입.
//   io 프리미티브는 ./io, SECRET_PATTERNS 는 ./catalogs, cp/path 빌트인. 동작/출력 무변경.
'use strict';
const cp = require('child_process');
const path = require('path');
const { log, ok, warn, fail, failJson, today, now, absRoot, exists, read, readBuf, mkdirp, writeUtf8, append, rel } = require('./io');
const { SECRET_PATTERNS } = require('./catalogs');
const { findCorruptedStateJson } = require('./state-integrity');  // 1.36.1 (클린룸 리뷰 FN): 상태 JSON 무결성
const { _briefUnfilled, _planGoalUnfilled, _detectOrphanGuards } = require('./pure-utils');  // 1.36.19: 전략 앵커 · 1.36.116: 고아 가드
const fs = require('fs');

// 1.36.116 — "존재하지만 아무도 실행하지 않는 가드" 를 audit 이 본다.
//   근거는 실제 프로젝트다: 어떤 저장소의 CI 파일이 자기 사고를 이렇게 적어 놨다 —
//   "가드가 여럿 있는데 CI 에 하나도 연결돼 있지 않았다 … 사람이 돌려야만 유효한 검사는 결국 안 돌아간다."
//   leerness 는 위생을 감사하면서 정작 이 클래스를 보지 않았다.
//   수집은 여기서(I/O), 판정은 pure-utils 의 순수 함수에서 한다.
function _collectGuardInputs(root) {
  // 1.36.116 (검수 #9/#10): 예전엔 모든 읽기 실패를 조용히 삼켜 **'깨끗함'과 '못 읽었음'이 같은 결과**였다.
  //   워크플로 하나만 못 읽어도 거기서 부르는 정상 가드가 통째로 고아로 뒤집힌다 — 그건 오탐인데 사용자는 알 길이 없다.
  //   그래서 실패를 세어 돌려주고, 판정기가 근거에 적는다. 크기 상한도 함께 둔다(일반 예외와 달리 OOM 은 회복이 안 된다).
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
    //   0바이트 `package.json` 은 유효 JSON 이 아닌데 `|| '{}'` 가 그것을 '스크립트 없음' 으로 삼켰다(검수 P2).
    const _pkgRaw = rd(path.join(root, 'package.json'));
    if (_pkgRaw != null && !String(_pkgRaw).trim()) throw new Error('empty package.json');
    const pkg = JSON.parse(_pkgRaw || '{}');
    packageScripts = pkg.scripts || {};
    workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces.length > 0 : !!(pkg.workspaces && pkg.workspaces.packages);
    // 1.36.116 (실측): 패키지 **자신의 진입점**(bin/main)은 러너가 아니라 제품이다. leerness 에서 실제로 물렸다 —
    //   `bin/leerness.js` 가 러너로 수집되고, 그 안의 *남의 프로젝트용* 생성 코드에 `test:smoke` 문자열이 있어서
    //   자기 자신의 진짜 고아가 '누군가 부른다' 로 뒤집혔다(자기참조 4회차).
    const ent = [];
    if (typeof pkg.bin === 'string') ent.push(pkg.bin);
    else if (pkg.bin && typeof pkg.bin === 'object') ent.push(...Object.values(pkg.bin));
    if (typeof pkg.main === 'string') ent.push(pkg.main);
    ownEntries = new Set(ent.filter(x => typeof x === 'string').map(x => x.replace(/^\.\//, '').replace(/\\/g, '/')));
  } catch { readErrors++; }   // package.json 이 깨져 있으면 '스크립트 0개' 가 아니라 **못 읽었다** 고 말해야 한다(검수 P2)
  // `viaScript` = 이 파일을 러너로 담게 만든 npm 스크립트 이름(CI 설정 파일이면 null).
  //   1.36.116 (검수 P2): 아무도 안 부르는 wrapper 가 참조하는 파일도 러너로 담기고, 그 텍스트에 잎 가드 이름이
  //   있으면 잎이 루트가 됐다 — BFS 재작성이 막으려던 바로 그 우회로가 한 단계 밖에 그대로 있었다.
  //   판정기가 "그 wrapper 가 실제로 도달 가능한가" 를 따질 수 있도록 출처를 같이 준다.
  //   ⚠ 출처는 **여럿**일 수 있다. 파일 단위로 하나만 기억했더니 `package.json` 의 **선언 순서**가 판정을 바꿨다:
  //   죽은 wrapper 가 `test` 보다 위에 있으면 둘이 같은 파일을 불러도 '죽은 참조' 로 고정돼
  //   그 파일이 부르는 정상 가드가 고아로 나왔다(실측 재현). 참조한 스크립트를 전부 모은다.
  const runners = [];
  //   ⚠ 출처가 **무조건**(CI 설정이 직접 부름)인 사실을 따로 기록한다. `viaScripts` 배열만 두면,
  //   CI 가 부르는 파일을 죽은 스크립트도 참조할 때 그 스크립트가 배열에 붙으면서 **무조건 출처가 사라지고**
  //   러너 전체가 그 죽은 스크립트에 종속된다 → 정상 배선이 고아로 뒤집힌다(검수 지적, 실측 재현).
  const push = (file, viaScript) => {
    const found = runners.find(r => r.file === file);
    if (found) {
      if (!viaScript) found.unconditional = true;
      else if (!found.viaScripts.includes(viaScript)) found.viaScripts.push(viaScript);
      return;
    }
    const t = rd(path.join(root, file));
    if (t != null) runners.push({ file, text: t, viaScript: viaScript || null, viaScripts: viaScript ? [viaScript] : [], unconditional: !viaScript });
  };
  try { for (const f of fs.readdirSync(path.join(root, '.github', 'workflows'))) if (/\.ya?ml$/.test(f)) push(`.github/workflows/${f}`); } catch {}
  // 1.36.116 (검수 #5): 정확히 `Makefile` 과 훅 2개만 읽었다 — `GNUmakefile`·소문자 `makefile`·`commit-msg` 를
  //   놓치면 그 러너가 부르는 정상 가드가 전부 '아무도 안 부름' 으로 뒤집힌다(미수집은 곧 오탐이다).
  for (const f of ['.gitlab-ci.yml', '.gitlab-ci.yaml', 'azure-pipelines.yml', 'Jenkinsfile',
    'Makefile', 'makefile', 'GNUmakefile', 'Taskfile.yml', 'justfile',
    '.husky/pre-commit', '.husky/pre-push', '.husky/commit-msg', '.husky/post-merge']) push(f);
  try { for (const f of fs.readdirSync(path.join(root, '.circleci'))) if (/\.ya?ml$/.test(f)) push(`.circleci/${f}`); } catch {}
  // 러너가 부르는 스크립트 파일도 러너다 — 동적 열거자가 대개 거기 있다(그걸 못 보면 오탐이 폭발한다).
  //   1.36.116 (검수 #5): 경로에 `scripts/` 가 있어야만 수집했다 — `tools/run-ci.mjs`·`ci/run.mjs`·`bin/run-checks.js`
  //   같은 흔한 배치를 놓치고, 그 안의 동적 열거자를 못 보면 다시 오탐이 폭발한다. 디렉터리 이름을 넓힌다.
  //   경로 구분자는 `/`·`\` 둘 다 받는다 — Windows CI 는 `.\bin\cli.js` 로 적는다(검수 P2 미탐).
  //   ⚠ **중간 디렉터리**를 허용해야 한다: `scripts/a/run.js` 처럼 한 단계 더 들어간 러너가 아예 수집되지 않아
  //   그 러너가 배선한 것이 전부 거짓 고아가 됐다(실측: `scripts/run.js` 는 잡히고 `scripts/a/run.js` 는 안 잡힘).
  const _FILE_RE = /[\w./\\-]*(?:scripts|tools|ci|bin|tasks)[/\\](?:[\w.-]+[/\\])*[\w.-]+\.(?:m?js|cjs|ts|sh)/g;
  const _norm = (x) => String(x).replace(/\\/g, '/').replace(/^\.\//, '');
  // CI 설정 파일이 부르는 것은 출처 null(무조건 유효한 러너), npm 스크립트가 부르는 것은 그 스크립트가 출처다.
  //   ⚠ 자기 진입점 제외는 **CI 설정이 직접 부르는 경우까지** 막으면 안 된다(검수 P2) — 그 파일이 실제로
  //   가드를 배선하고 있으면 그걸 못 봐서 정상 가드가 고아로 뒤집힌다. CI 가 부르면 그건 러너가 맞다.
  //   ⚠ 단 **주석 줄에서 수집하면 안 된다**: `# debug: node bin/cli.js` 한 줄로 제품 진입점이 러너가 되고
  //   그 안의 문자열이 진짜 고아를 덮는다(검수 P2 — 자기참조가 주석 경로로 되살아난다).
  //   CMD 스텝의 `REM`·`::` 도 주석이다(검수 재현: `REM debug: node .\bin\phantom.js` 한 줄로 제품 진입점이 러너가 됐다).
  //   ⚠ `--`·`;` 는 여기서 다루는 파일 종류(YAML·Makefile·셸·JS)에서 주석이 아니다 — 오히려 여러 줄 명령의
  //   연속 인자(`--file=scripts/x.js`)를 지워 파일 참조를 잃는다. 주석 표기는 실제로 쓰이는 것만 둔다.
  //   ⚠ 판정기(`_dropCommentLines`)와 **같은 표기**여야 한다 — `*`(블록 주석 이어짐)를 한쪽에만 두면
  //   두 단계의 입력이 갈린다(검수 P3: 정합성 주장이 사실이 아니었다).
  const _noComment = (s) => String(s).split('\n').filter(l => !/^\s*(#|\/\/|\*|::|@?REM\s)/i.test(l)).join('\n');
  //   설명 필드(`- name: archive index.js`)는 실행 증거가 아니다 — bare 진입점 매처에도 같은 규칙을 건다.
  //   단 값이 **산문일 때만** 설명으로 본다(matrix 변수명이 `name` 일 수 있다 — 판정기와 같은 규칙).
  const _noDescriptive = (s) => String(s).split('\n').filter(l => {
    const m = /^\s*-?\s*(?:name|description|title|summary|comment|displayName|label)\s*:\s*(.*)$/i.exec(l);
    if (!m) return true;
    const v = String(m[1]).trim();
    return !v || v.startsWith('[') || !/\s/.test(v);
  }).join('\n');
  for (const r of runners.slice()) {
    const txt = _noComment(r.text);
    for (const m of txt.matchAll(_FILE_RE)) push(_norm(m[0]), null);
    // 디렉터리 접두가 없는 진입점(`"main": "index.js"`)은 위 정규식이 못 잡는다 — 선언된 bin/main 만 이름으로 확인한다.
    const bareTxt = _noDescriptive(txt);
    for (const own of ownEntries) {
      if (/[/\\]/.test(own)) continue;
      const esc = own.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^\\w.\\-/\\\\])\\.?[/\\\\]?${esc}([^\\w.-]|$)`, 'm').test(bareTxt)) push(own, null);
    }
  }
  for (const [name, body] of Object.entries(packageScripts)) for (const m of String(body || '').matchAll(_FILE_RE)) {
    const rel = _norm(m[0]);
    if (!ownEntries.has(rel)) push(rel, name);   // 자기 진입점은 러너가 아니다 (위 주석)
  }
  // scripts/ 아래 가드처럼 보이는 파일(2단계까지)
  const scriptFiles = [];
  const walk = (d, rel2, depth) => {
    if (depth > 2) return;
    let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { if (e && e.code !== 'ENOENT') readErrors++; return; }
    for (const e of es) {
      // 1.36.116 (검수 P2): 상한을 재귀 **진입 시점**에만 봐서 flat 디렉터리는 무제한이었고, 잘라낸 사실도
      //   어디에도 안 남았다("깨끗함"과 "일부만 봄"이 또 같은 출력). 항목마다 재고, 자르면 불완전으로 센다.
      if (scriptFiles.length >= 500) { skippedLarge++; return; }
      const p = path.join(d, e.name), r = (rel2 ? rel2 + '/' : '') + e.name;
      if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p, r, depth + 1); }
      else if (/\.(m?js|cjs|ts|sh)$/.test(e.name) && /(check|verify|validate|guard|test|gate|audit|scan|lint|e2e|smoke)/i.test(e.name)) scriptFiles.push(r);
    }
  };
  walk(path.join(root, 'scripts'), 'scripts', 0);
  return { packageScripts, runners, scriptFiles, readErrors, skippedLarge, workspaces };
}
// 1.36.108 (T-0097): 락은 harness 가 주입한다(clarify/referee/routing 과 같은 관례) — lib 에 복제본을 두지 않는다.
//   주입이 없으면 그냥 실행한다(하위호환). 주입 누락은 e2e 락 가드가 실행으로 잡는다.
function _auditLock(deps, f, fn) { return (deps && typeof deps._withLock === 'function') ? deps._withLock(f, fn) : fn(); }

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
  // 1.36.120: `--json` 은 **stdout 만** 막고 있었다 — `warn()` 이 쓰는 stderr 로 사람용 문구가 그대로 샜다.
  //   그 결과 JSON 계약 표면에 잡음이 남고, 그 잡음의 내용이 **프로젝트 상태에 따라** 달라져
  //   게이트 판정이 저장소 상태에 종속됐다(같은 코드로 통과/실패가 갈렸다). json 모드에서는 양쪽을 다 막는다.
  //   (findings 배열이 그 정보를 이미 싣고 있으므로 사람용 문구는 중복이다.)
  const _origErrWrite = process.stderr.write.bind(process.stderr);
  const _restoreStreams = () => { process.stdout.write = _origWrite; process.stderr.write = _origErrWrite; };
  if (jsonMode) { process.stdout.write = () => true; process.stderr.write = () => true; }
  try {
  // 외부리뷰 CV-3/UR-0078: 미초기화/존재하지 않는 경로를 healthy 로 오판하던 것 수정 — 필수 마커 부재 시 failure 승격(verify 와 일관).
  if (!exists(root) || !exists(path.join(root, '.harness')) || !exists(path.join(root, 'AGENTS.md'))) {
    failures++;
    fail(`미초기화 또는 존재하지 않는 경로: ${root} (.harness/AGENTS.md 없음 — leerness init 필요)`);
    _finding('not_initialized', 'fail', 'uninitialized or missing path (.harness or AGENTS.md absent)', { root });
    // 1.27.1 (13번째 외부리뷰 #2): 미초기화 시 후속 체크(design/reuse 등)를 없는 하네스에 대해 보고하던 모순 출력 차단 — 요약/JSON 으로 직행 후 종료(exit code/JSON 페이로드는 종전과 동일).
    log(`Audit summary: warnings=${warnings} failures=${failures}`);
    if (jsonMode) { _restoreStreams(); process.stdout.write(JSON.stringify({ version: VERSION, root, warnings, failures, fixed, healthy: false, fixApplied: fix, strict: has('--strict'), strictThreshold: has('--strict') ? parseInt(arg('--threshold', '1'), 10) : null, summary: `warnings=${warnings} failures=${failures}`, findings }, null, 2) + '\n'); }
    process.exitCode = 1;
    return;
  }
  // 1.36.79 (도그푸딩 P1-E, 실 프로젝트): .harness/AGENTS.md 존재만 보고 통과시켜 **56개 중 44개가 사라진 설치**를
  //   healthy:true·failures:0 으로 보고했다(같은 디렉토리에서 integrity check 는 ok:false — 두 판정이 모순).
  //   integrity 가 이미 계산하는 관리 문서 부재/손상 신호를 audit 에도 반영해 "가장 먼저 부르는 명령"이 진실을 말하게 한다.
  try {
    if (typeof deps._integrityFindings === 'function') {
      const _integ = deps._integrityFindings(root) || [];
      // (검수 #5) integrity 와 동일 kind 집합 — truncated 도 포함해 두 명령의 판정이 갈리지 않게(단, 차단 등급은 missing 기준)
      const _missing = _integ.filter(f => f && ['missing', 'h1_lost', 'truncated', 'unreadable'].includes(f.kind));
      if (_missing.length) {
        // 코어 문서 다수 부재 = 설치 손상(차단). 소수는 경고.
        const _sev = _missing.filter(f => f.kind === 'missing').length >= 3 ? 'fail' : 'warn';
        if (_sev === 'fail') { failures++; fail(`관리 문서 ${_missing.length}건 부재/손상 — 설치 불완전 (leerness init 또는 integrity check --repair)`); }
        else { warnings++; warn(`관리 문서 ${_missing.length}건 부재/손상 (leerness integrity check --repair)`); }
        _finding('managed_docs_incomplete', _sev, 'managed policy docs missing/damaged (install incomplete)', { count: _missing.length, files: _missing.slice(0, 12).map(f => f.file || f.name), kinds: [...new Set(_missing.map(f => f.kind))] });
      } else {
        ok('관리 문서 무결성 OK (integrity)');
      }
    }
  } catch {}
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
  else if (!/\| color\.primary \|/.test(ds) || /\(실제 값으로 업데이트\)|\(update with real value\)/i.test(ds)) { warnings++; warn('design-system.md tokens not customized'); _finding('design_system_default', 'warn', 'design-system.md tokens not customized'); }   // 1.36.61: en placeholder 병기
  else ok('design-system tokens populated');
  const reuse = exists(path.join(root,'.harness/reuse-map.md')) ? read(path.join(root,'.harness/reuse-map.md')) : '';
  const reuseLines = reuse.split('\n').filter(l => l.startsWith('|') && !/Capability|---/.test(l)).length;
  if (reuse.includes(naMarker)) ok('reuse-map.md marked NA (skipped)');
  else if (reuseLines === 0) { warnings++; warn('reuse-map.md is empty (consider populating known reusable elements)'); _finding('reuse_map_empty', 'warn', 'reuse-map.md is empty'); }
  else ok(`reuse-map.md has ${reuseLines} entries`);
  // 1.36.19 (실사용 7 프로젝트 dogfood): 전략 앵커 미작성 — 동적 상태는 유지되나 project-brief Purpose(5/7)·plan Goal(7/7)이
  //   템플릿 그대로라 인계받는 AI 가 "프로젝트가 무엇인지/범위"를 못 받음(관찰된 근본원인). naMarker 로 의도적 스킵 가능.
  const briefFile = path.join(root, '.harness/project-brief.md');
  const briefTxt = exists(briefFile) ? read(briefFile) : '';
  if (briefTxt.includes(naMarker)) ok('project-brief.md marked NA (skipped)');
  else if (_briefUnfilled(briefTxt)) { warnings++; warn('project-brief.md Purpose 미작성(템플릿 그대로) — 인계받는 AI가 프로젝트 목적/맥락을 못 받습니다 (project-brief.md 채우기)'); _finding('project_brief_unfilled', 'warn', 'project-brief.md Purpose still placeholder/empty — AI handoffs lack project context'); }
  else ok('project-brief.md Purpose populated');
  const planText = exists(planPath(root)) ? read(planPath(root)) : '';
  if (planText && !planText.includes(naMarker) && _planGoalUnfilled(planText)) { warnings++; warn('plan.md Goal 미작성(템플릿 그대로) — 프로젝트 목표/범위가 비어 인계 AI가 방향을 못 잡습니다 (plan.md Goal/Scope 채우기)'); _finding('plan_goal_unfilled', 'warn', 'plan.md Goal still placeholder/empty'); }

  // 1.36.116: 고아 가드 — 검사가 존재하는데 아무 러너도 부르지 않는다.
  //   **권고로만 낸다**(warn, 차단 아님). 판정은 휴리스틱이고, 오차단은 사용자가 이 경고 자체를 끄게 만든다.
  //   근거(어떤 열거자가 무엇을 태우는지)를 함께 출력한다 — 목록만 주면 믿을 수 없어 그냥 넘긴다.
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
        // 1.36.118 (검수 P3): 고아가 **있을 때**도 범위 정보가 필요하다 — 0건 분기에만 넣어 계약이 갈렸다.
        monorepoOutOfScope: g.monorepoOutOfScope, deferred: g.deferred,
        guardCount: g.guardCount, dynamicRunners: g.dynamicRunners, enumPrefixes: g.enumPrefixes, reason: g.reason,
      });
    } else if (g.scanIncomplete || g.deferred || g.monorepoOutOfScope) {
      // 1.36.116 (검수 P2): 고아가 0이면 발견을 아예 안 내보내서, 사용자 입장에서 **'깨끗함'과 '일부를 못 읽음'이
      //   같은 출력**이었다. 스캔이 불완전했다는 사실 자체가 보고 대상이다(그래야 0을 믿을지 정할 수 있다).
      //   1.36.117: 판정 **보류**(turbo/nx)와 monorepo 범위 밖도 같은 클래스다 — 조용한 0건이면 안 된다.
      warnings++;
      warn(`가드 배선 점검이 불완전합니다 — 0건이라는 결과를 그대로 믿지 마세요`);
      log(`     근거: ${g.reason}`);
      _finding('orphan_guard_scan_incomplete', 'warn', 'guard wiring scan could not cover everything', {
        scanIncomplete: g.scanIncomplete, deferred: g.deferred, monorepoOutOfScope: g.monorepoOutOfScope,
        guardCount: g.guardCount, reason: g.reason,
      });
    }
  } catch {}
  // 1.36.126 (T-0107): 예전 버전의 `migrate-workspace-dir` 는 `.harness` 를 `.leerness` 로 **복사만** 하고
  //   "마이그레이션 완료 → 다음 handoff부터 .leerness 우선 사용" 이라고 말했다. 실제로는 그 뒤 모든 쓰기가
  //   `.harness` 로 가므로 `.leerness` 는 복사 시점에 얼어붙는다. 문제는 디스크 낭비가 아니라
  //   같이 만들어진 `WHERE_TO_FIND.md` 가 **AI 를 그 낡은 상태로 안내**한다는 것이다 — 우리가 막으려는 실패 그 자체.
  //   1.36.126 부터 그 명령은 거부하지만, **이미 당한 프로젝트**는 스스로 알 수 없다. 여기서 알린다.
  //   ⚠ 지우지는 않는다 — 사용자 데이터를 대신 삭제하지 않는다는 원칙(편의 명령이 P1 5건을 냈던 전례).
  try {
    const staleMarker = path.join(root, '.leerness', 'MIGRATED_FROM_HARNESS');
    const guide = path.join(root, '.leerness', 'WHERE_TO_FIND.md');
    // 1.36.126 (검수 P2): 마커 하나만 믿으면 **마커가 지워진 사본**을 놓친다(수동 복구·복사 실패 등).
    //   반대로 남의 도구가 만든 `.leerness` 를 "죽은 사본" 이라 부르면 오탐이 이 경고를 죽인다.
    //   그래서 두 번째 신호는 **우리 생성물의 서명**으로 좁힌다 — 가이드 파일의 우리 헤더 문구.
    //   (파일명만 보면 남의 것과 구별할 수 없다. 내용 서명이 있어야 우리 것이라고 말할 수 있다.)
    let ourGuide = false;
    try { ourGuide = exists(guide) && /by leerness \d+\.\d+\.\d+/.test(read(guide)); } catch {}
    if (exists(staleMarker) || ourGuide) {
      let ageDays = null;
      try {
        const mt = exists(staleMarker) ? fs.statSync(staleMarker).mtimeMs : fs.statSync(guide).mtimeMs;
        const live = fs.statSync(path.join(root, '.harness', 'progress-tracker.md')).mtimeMs;
        ageDays = Math.max(0, Math.round((live - mt) / 86400000));
      } catch {}
      warnings++;
      warn(`.leerness/ 는 죽은 사본입니다 — 실제 저장소는 .harness 이고, 이 사본은 복사 시점에 멈춰 있습니다`);
      log(`     근거: ${exists(staleMarker) ? '.leerness/MIGRATED_FROM_HARNESS 마커' : '.leerness/WHERE_TO_FIND.md 가 leerness 생성물'} + 이 빌드는 .leerness 를 읽지 않음 (leerness workspace-dir)`);
      if (ageDays != null) log(`     낡음 정도: 실제 저장소가 사본보다 약 ${ageDays}일 앞서 있습니다`);
      if (exists(guide)) log(`     ⚠ .leerness/WHERE_TO_FIND.md 를 AI 에게 주지 마세요 — 낡은 상태로 안내합니다`);
      log(`     → 내용을 .harness 와 비교해 필요한 것이 없는지 확인한 뒤 직접 삭제하세요 (leerness 는 대신 지우지 않습니다)`);
      _finding('stale_workspace_copy', 'warn', '.leerness is a frozen copy; the live store is .harness', {
        markerPresent: exists(staleMarker), guidePresent: exists(guide), guideIsOurs: ourGuide, liveAheadDays: ageDays,
      });
    }
  } catch {}
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
  if (handoff.includes('Last generated: (자동)') || handoff.includes('Last generated: (auto)')) {   // 1.36.61: en 센티널 병기
    warnings++; warn('session-handoff.md never auto-generated (run: leerness session close .)');
    _finding('handoff_not_generated', 'warn', 'session-handoff.md never auto-generated');
    // 1.9.35 #5: --fix → session-handoff.md 자동 생성 마커 갱신
    if (fix) {
      // 1.36.108 (T-0097): 락 안에서 **다시 읽고** 스탬프한다. 위에서 읽은 handoff 로 쓰면
      //   그 사이 session close 가 새로 생성한 내용을 낡은 스냅샷으로 덮는다(둘 다 이 파일을 쓴다).
      _auditLock(deps, handoffPath(root), () => {
        const fresh = exists(handoffPath(root)) ? read(handoffPath(root)) : handoff;
        const stamped = fresh.replace(/Last generated: \((자동|auto)\)/, `Last generated: ${today()} (leerness audit --fix)`);   // 1.36.61: 양 언어 --fix
        writeUtf8(handoffPath(root), stamped);
      });
      ok('  ↳ fixed: session-handoff.md timestamp 갱신');
      fixed++;
    }
  }
  else if (handoff.includes('Last generated:')) ok('session-handoff.md auto-generated previously');
  const cur = exists(currentStatePath(root)) ? read(currentStatePath(root)) : '';
  const updMatch = cur.match(/Updated: (\d{4}-\d{2}-\d{2})/);
  if (updMatch) {
    // 1.36.50 (NaN 날짜 클래스 스윕): "Updated: 2026-99-99" 같은 무효 날짜는 NaN 비교로 무언 통과했다 —
    //   신선함 증명 불가 = stale 취급(여긴 --fix 가 유효 날짜로 재스탬프하므로 자가 복구 경로).
    let dDays = (Date.now() - new Date(updMatch[1]).getTime()) / 86400000;
    if (!Number.isFinite(dDays)) dDays = Infinity;
    if (dDays > 7) {
      const dShow = Number.isFinite(dDays) ? Math.round(dDays) : '무효 날짜';
      warnings++; warn(`current-state.md stale (${dShow} days)`);
      _finding('current_state_stale', 'warn', 'current-state.md stale', { days: Number.isFinite(dDays) ? Math.round(dDays) : -1 });
      // 1.9.35 #5: --fix → current-state.md Updated 라인 갱신
      if (fix) {
        // 1.36.108 (T-0097): 락 안 재읽기 — 사용자 본문이 그 사이 바뀌었으면 낡은 사본으로 덮지 않는다.
        _auditLock(deps, currentStatePath(root), () => {
          const fresh = exists(currentStatePath(root)) ? read(currentStatePath(root)) : cur;
          writeUtf8(currentStatePath(root), fresh.replace(/Updated: \d{4}-\d{2}-\d{2}/, `Updated: ${today()}`));
        });
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
      // 1.36.104 (P-0014): 인정된 픽스처는 실패로 세지 않는다 — headline/health/session-close 와 같은 술어.
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
    if (jsonMode) _restoreStreams();
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

// 1.36.116 (검수 #17): `_collectGuardInputs` 가 export 되지 않아 e2e 가 **수집→판정 배선**을 볼 수 없었다 —
//   수집기가 러너를 하나도 안 돌려줘도 기존 단언은 전부 통과했다(가드가 자기가 밟지 않는 경로를 못 지킨다).
module.exports = { audit, _collectGuardInputs };
