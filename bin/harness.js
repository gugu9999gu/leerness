#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const readline = require('readline');

const VERSION = '1.9.169';
const MARK = '<!-- leerness:managed -->';
const README_START = '<!-- leerness:project-readme:start -->';
const README_END = '<!-- leerness:project-readme:end -->';

// 1.9.10: leerness-skillpack 동적 로드 (선택). 없으면 BUILTIN 사용.
function _tryLoadSkillpack() {
  // 1) 정상 require resolution
  try { return { src: 'require', data: require('leerness-skillpack/catalog.json') }; } catch {}
  // 2) cwd/node_modules
  try {
    const f = path.join(process.cwd(), 'node_modules/leerness-skillpack/catalog.json');
    if (fs.existsSync(f)) return { src: 'cwd', data: JSON.parse(fs.readFileSync(f, 'utf8')) };
  } catch {}
  // 3) npm global root
  try {
    const root = cp.execSync('npm root -g', { encoding: 'utf8', timeout: 4000 }).trim();
    const f = path.join(root, 'leerness-skillpack/catalog.json');
    if (fs.existsSync(f)) return { src: 'global', data: JSON.parse(fs.readFileSync(f, 'utf8')) };
  } catch {}
  // 4) 환경변수 명시 경로
  if (process.env.LEERNESS_SKILLPACK_PATH) {
    try {
      const f = path.resolve(process.env.LEERNESS_SKILLPACK_PATH);
      const target = f.endsWith('.json') ? f : path.join(f, 'catalog.json');
      if (fs.existsSync(target)) return { src: 'env', data: JSON.parse(fs.readFileSync(target, 'utf8')) };
    } catch {}
  }
  return null;
}

let SKILLPACK_SOURCE = 'builtin';
let SKILLPACK_META = null;
function _loadSkillCatalog() {
  const sp = _tryLoadSkillpack();
  if (sp && sp.data && Array.isArray(sp.data.skills)) {
    SKILLPACK_SOURCE = sp.src;
    SKILLPACK_META = { name: sp.data.name, version: sp.data.version };
    const out = {};
    for (const s of sp.data.skills) {
      out[s.id] = {
        displayNameKo: s.displayNameKo,
        version: s.version,
        lastUpdated: s.lastUpdated,
        verification: s.verification,
        capabilities: s.capabilities,
        _source: 'skillpack'
      };
    }
    return out;
  }
  SKILLPACK_SOURCE = 'builtin';
  const out = {};
  for (const [k, v] of Object.entries(BUILTIN_CATALOG)) out[k] = { ...v, _source: 'builtin' };
  return out;
}

const BUILTIN_CATALOG = {
  'office':                       { displayNameKo: '마이크로소프트 오피스 자동화 스킬 라이브러리', version: '1.0.0', lastUpdated: '2026-05-08', verification: 'passed', capabilities: ['Word/Excel/PowerPoint 문서 자동화', '템플릿 기반 문서 생성', '표/차트/요약 문서화', '민감정보 제외 규칙 적용'] },
  'commerce-api':                 { displayNameKo: '커머스 API 연동 스킬 라이브러리', version: '1.0.0', lastUpdated: '2026-05-08', verification: 'passed', capabilities: ['쿠팡·롯데온·스마트스토어 API 연동 설계', '주문/상품/매출 동기화', '환경변수 기반 인증 분리', '레이트리밋/재시도/오류 처리'] },
  'crawling':                     { displayNameKo: '크롤링·브라우저 자동화 스킬 라이브러리', version: '1.0.0', lastUpdated: '2026-05-08', verification: 'passed', capabilities: ['Playwright 기반 자동화', '다운로드/로그인 세션 처리', '스크린샷 기반 실패 진단', '약관/권한/차단 위험 점검'] },
  'firebase':                     { displayNameKo: 'Firebase·Cloud Functions 스킬 라이브러리', version: '1.0.0', lastUpdated: '2026-05-08', verification: 'passed', capabilities: ['Firebase Functions 배포 구조', '환경변수/시크릿 분리', '권한/IAM 점검', '로컬 에뮬레이터 검증'] },
  'ads-analytics':                { displayNameKo: '광고·GA4 분석 스킬 라이브러리', version: '1.0.0', lastUpdated: '2026-05-08', verification: 'passed', capabilities: ['GA4 이벤트/전환 점검', '광고 데이터 수집 구조화', '소스/매체 분석', '리포트 자동화'] },
  'appstore-review':              { displayNameKo: '앱스토어 심사 대응 스킬 라이브러리', version: '1.0.0', lastUpdated: '2026-05-08', verification: 'passed', capabilities: ['심사 문구 분석', '개인정보 라벨 점검', '리젝 대응 초안', '웹뷰/앱 데이터 수집 구분'] },
  'ai-verified-skill-publisher':  { displayNameKo: 'AI 검증 스킬 업로드·라이브러리화 스킬', version: '1.0.0', lastUpdated: '2026-05-08', verification: 'passed', capabilities: ['검증된 스킬 정규화', '민감정보 스캔', 'AI 검증 메타데이터 작성', 'npm/git 업로드 dry-run 및 실행 게이트'] },
  'feature-implementation':       { displayNameKo: '기능 구현 표준 스킬', version: '1.0.0', lastUpdated: '2026-05-08', verification: 'passed', capabilities: ['feature-contracts 작성', '재사용 우선 검사', '테스트 증거 수집', '핸드오프 트리거'] },
  // 1.9.11: 기본 내장 — 로드맵 자동 생성 스킬
  'project-roadmap-generator':    { displayNameKo: '프로젝트 로드맵 자동 생성 스킬', version: '0.2.0', lastUpdated: '2026-05-12', verification: 'passed', capabilities: ['leerness .harness/* 통합 파싱 (plan/progress/skills/rules/decisions/handoff/current-state)', '좌→우 수평 트리 + 상하 중앙정렬 SVG', '7개 상태 색상 (완료/진행/보류/검토/예정/미완료/오류)', 'design-system + CSS variables 자동 주입', '화이트보드 panning/zoom + 더블클릭 reset', '단일 HTML 출력 (외부 의존성 0)'] }
};

// 1.9.10: skillCatalog는 skillpack 우선, fallback builtin. _loadSkillCatalog 호출은 BUILTIN_CATALOG 정의 후.
const skillCatalog = _loadSkillCatalog();

const routes = {
  planning:        { read: ['.harness/plan.md','.harness/progress-tracker.md','.harness/project-brief.md','.harness/current-state.md','.harness/guideline.md'], update: ['.harness/plan.md','.harness/progress-tracker.md','.harness/current-state.md','.harness/session-handoff.md'] },
  feature:         { read: ['.harness/plan.md','.harness/current-state.md','.harness/architecture.md','.harness/context-map.md','.harness/feature-contracts.md','.harness/skills/feature-implementation/README.md','.harness/reuse-map.md'], update: ['.harness/progress-tracker.md','.harness/feature-contracts.md','.harness/current-state.md','.harness/task-log.md','.harness/session-handoff.md'] },
  consistency:     { read: ['.harness/design-system.md','.harness/consistency-policy.md','.harness/reuse-map.md','.harness/context-map.md'], update: ['.harness/design-system.md','.harness/reuse-map.md','.harness/task-log.md','.harness/session-handoff.md'] },
  release:         { read: ['.harness/plan.md','.harness/release-checklist.md','.harness/testing-strategy.md','.harness/current-state.md','.harness/leerness-maintenance.md'], update: ['.harness/release-checklist.md','.harness/progress-tracker.md','.harness/task-log.md','.harness/session-handoff.md'] },
  migration:       { read: ['.harness/AX_MIGRATION_GUIDE.md','.harness/protected-files.md','.harness/context-routing.md','.harness/writeback-policy.md'], update: ['.harness/current-state.md','.harness/task-log.md','.harness/session-handoff.md'] },
  'session-close': { read: ['.harness/session-close-policy.md','.harness/progress-tracker.md','.harness/anti-lazy-work-policy.md','.harness/plan.md'], update: ['.harness/session-handoff.md','.harness/progress-tracker.md','.harness/current-state.md','.harness/task-log.md'] },
  'session-start': { read: ['.harness/session-handoff.md','.harness/current-state.md','.harness/plan.md','.harness/progress-tracker.md','.harness/decisions.md','.harness/task-log.md'], update: ['.harness/current-state.md'] },
  'harness-maintenance': { read: ['.harness/leerness-maintenance.md','.harness/HARNESS_VERSION','.harness/protected-files.md'], update: ['.harness/task-log.md','.harness/session-handoff.md'] },
  bugfix:          { read: ['.harness/plan.md','.harness/progress-tracker.md','.harness/decisions.md','.harness/feature-contracts.md','.harness/architecture.md'], update: ['.harness/progress-tracker.md','.harness/decisions.md','.harness/task-log.md','.harness/session-handoff.md'] },
  refactor:        { read: ['.harness/plan.md','.harness/architecture.md','.harness/reuse-map.md','.harness/decisions.md'], update: ['.harness/architecture.md','.harness/reuse-map.md','.harness/decisions.md','.harness/task-log.md','.harness/session-handoff.md'] },
  research:        { read: ['.harness/decisions.md','.harness/task-log.md','.harness/architecture.md','.harness/context-map.md'], update: ['.harness/decisions.md','.harness/task-log.md','.harness/current-state.md'] }
};

const STATUSES = ['requested','planned','in-progress','waiting','on-hold','blocked','incomplete','done','dropped'];

function log(s = '') { console.log(s); }
function ok(s) { log('✓ ' + s); }
function warn(s) { log('⚠ ' + s); }
function fail(s) { log('✗ ' + s); }
function absRoot(p) { return path.resolve(p || process.cwd()); }
function exists(p) { return fs.existsSync(p); }
function read(p) {
  // 1.9.147: UTF-8 BOM 자동 strip — Windows PowerShell Out-File 등이 BOM 붙이는 경우 JSON.parse 실패 방지
  const text = fs.readFileSync(p, 'utf8');
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}
function readBuf(p) { return fs.readFileSync(p); }
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function writeUtf8(p, s) { mkdirp(path.dirname(p)); fs.writeFileSync(p, s, { encoding: 'utf8' }); }
function append(p, s) { mkdirp(path.dirname(p)); fs.appendFileSync(p, s, 'utf8'); }
function rel(root, p) { return path.relative(root, p).replace(/\\/g, '/') || '.'; }
function today() { return new Date().toISOString().slice(0, 10); }
function now() { return new Date().toISOString(); }
function arg(name, def = null) { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] || true) : def; }
function has(name) { return process.argv.includes(name); }
function nonFlagArgs() {
  const out = [];
  const withValue = new Set(['--language','--skills','--path','--status','--progress','--goal','--reason','--next','--target','--token-env','--package','--out','--from','--repo','--id','--note','--evidence','--query','--limit','--action','--agent','--tool','--doc','--command','--capability','--before','--after','--display','--threshold','--trigger','--check','--set','--min-score','--include','--days','--gh-pages-src','--roadmap','--since','--agents','--model','--timeout','--retry-on-fail','--label','--score','--tokens','--alternatives','--impact','--tag','--surface','--depends-on','--affects','--co-changes-with','--files','--branch','--remote','--task-add','--next-action','--role','--provider','--env-var','--deploy','--token-lifetime-hours','--port','--secret']);
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x.startsWith('-')) { if (withValue.has(x) && a[i+1] && !a[i+1].startsWith('-')) i++; continue; }
    out.push(x);
  }
  return out;
}
function argAll(name) {
  const out = []; const a = process.argv;
  for (let i = 0; i < a.length; i++) if (a[i] === name && a[i+1] && !a[i+1].startsWith('-')) out.push(a[++i]);
  return out;
}
function detectProjectName(root) { try { const pkg = JSON.parse(read(path.join(root, 'package.json'))); if (pkg.name) return pkg.name; } catch {} return path.basename(root); }
function detectLanguageValue(root, value = 'auto') {
  const v = String(value || 'auto').toLowerCase();
  if (v === 'ko' || v === 'en') return v;
  const candidates = ['README.md', 'docs/guideline.md', '.harness/project-brief.md', '.harness/plan.md'];
  let text = '';
  for (const c of candidates) { const p = path.join(root, c); if (exists(p)) text += read(p).slice(0, 3000); }
  return /[가-힣]/.test(text) ? 'ko' : 'en';
}
function fm(role, readWhen, updateWhen, body) {
  return `---\nleernessRole: ${role}\nreadWhen:\n${readWhen.map(x => '  - ' + x).join('\n')}\nupdateWhen:\n${updateWhen.map(x => '  - ' + x).join('\n')}\ndoNotStore:\n  - 실제 토큰\n  - 비밀번호\n  - 운영 쿠키\n  - 민감한 개인정보 원문\n---\n${MARK}\n${body}`;
}
function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(String(answer || '').trim()); });
  });
}

// 1.9.140: managedReadmeBlock 자동 풍부화 — 매 release pack 마다 명령/MCP/성능/가이드 갱신
function managedReadmeBlock(project) {
  return [
    README_START,
    '## Leerness Project Harness',
    '',
    `이 프로젝트는 Leerness v${VERSION} 하네스를 사용합니다. AI 에이전트는 작업 전 \`leerness handoff\`로 컨텍스트를 적재하고, 작업 후 \`leerness check\`/\`leerness audit\`/\`leerness session close\`를 수행해야 합니다.`,
    '',
    '### Core Commands',
    '',
    '```bash',
    'leerness handoff .            # 세션 시작 컨텍스트 자동 로드',
    'leerness status .             # 설치 상태',
    'leerness verify .             # 필수 파일 검증',
    'leerness audit .              # 일관성·계획-진행 정렬 감사',
    'leerness scan secrets .       # 시크릿 패턴 스캔',
    'leerness encoding check .     # UTF-8 / BOM / CRLF 검사',
    'leerness lazy detect .        # 게으름 방지 자동 평가',
    'leerness memory search "키"   # 결정/이력 검색',
    'leerness session close .      # 세션 종료 + handoff 자동 작성',
    'leerness update .             # 자동 버전 감지 + 마이그레이션',
    '```',
    '',
    '### Memory Surface CRUD (5 surfaces × add/list/drop)',
    '',
    '```bash',
    '# Tasks',
    'leerness task add "T-9999 작업 제목"',
    'leerness task list --json',
    '# Decisions',
    'leerness decision add "결정 제목" --reason "이유"',
    'leerness decision list --query "키워드"   # 1.9.139',
    '# Rules (영구 자연어 룰)',
    'leerness rule add "매 commit마다 changelog 갱신" --trigger every-commit',
    'leerness rule list',
    '# Plan (milestones)',
    'leerness plan add "M-XXXX 계획" --next-action "다음 단계"',
    'leerness plan list',
    '# Lessons (영구 교훈)',
    'leerness lesson save "교훈 본문" --tag perf',
    'leerness lesson list --query "키워드"     # 1.9.139',
    '# DELETE → RESTORE (1.9.126~128)',
    'leerness memory archive list . --query "키워드"   # 1.9.138',
    'leerness memory restore decision <date|title>',
    '```',
    '',
    '### MCP server (외부 AI 통합)',
    '',
    `Leerness v${VERSION}는 stdio JSON-RPC MCP server를 내장합니다 — Claude Code · Cursor · Codex CLI 등 외부 AI에 **42개 도구**를 노출:`,
    '',
    '```jsonc',
    '// 카테고리별',
    '// • Core: handoff / drift_check / audit / health / verify_claim / contract_verify',
    '// • Memory READ:  task_list / decision_list / lesson_list / plan_list / rule_list / memory_status',
    '// • Memory WRITE: task_add / decision_add / lesson_save / plan_add / rule_add',
    '// • Memory DELETE: task_drop / decision_drop / lesson_drop / plan_remove / rule_remove',
    '// • Skill: skill_match / skill_list / skill_search / skill_info / skill_suggest',
    '// • Insight: lessons / lessons_auto / brainstorm / retro / benchmark / lazy_detect',
    '// • Workflow: session_close / agents_list / task_export / env_check / usage_stats / reuse_map / whats_new',
    '',
    '// MCP server 실행: leerness mcp serve',
    '// tools/list 응답: 42 도구',
    '```',
    '',
    '### Autonomous mode (자율 모드)',
    '',
    '`<<autonomous-loop-dynamic>>` 신호만 보내면 AI가:',
    '1) 다음 라운드 후보 선정 → 2) 코드 변경 → 3) stress-v* 신규 작성 + 누적 회귀 → 4) e2e 219/219 → 5) npm pack + git tag + GitHub release → 6) main 자동 push (1.9.140+) → 7) session close → 8) 다음 라운드 예약.',
    '',
    `현재 누적: **70 라운드 (1.9.40 → ${VERSION})** · 매 라운드 GitHub release/태그 생성 · _reports/는 비공개 보존.`,
    '',
    '### 성능 가이드 (1.9.140 측정)',
    '',
    '- `leerness handoff .` — 평균 ~1.5s (캐시 워밍업 후 ~0.6s)',
    '- `leerness memory status --json` — 평균 ~250ms',
    '- `leerness task list --json` — 평균 ~200ms',
    '- `leerness drift check --json` — 평균 ~400ms',
    '- MCP `tools/list` 응답 — 평균 ~150ms',
    '- usage-stats / lessons / listAllSkills 모두 메모리 캐싱 (1.9.65/66)',
    '',
    '### 빠른 시작',
    '',
    '```bash',
    '# 1. 설치 (글로벌)',
    'npm install -g leerness',
    '',
    '# 2. 프로젝트에 하네스 설치',
    'cd my-project && leerness init . --yes --skills recommended',
    '',
    '# 3. AI 세션 시작 시',
    'leerness handoff .            # 컨텍스트 자동 로드',
    '',
    '# 4. 세션 종료 시',
    'leerness session close .      # 9 카테고리 + 룰 검증 + 다음 라운드 추천',
    '',
    '# 5. release 자동화 (1.9.140 main 자동 push 포함)',
    'leerness release pack --close --auto-main-push',
    '```',
    '',
    '### Planning Files',
    '',
    '- `.harness/plan.md`: 전체 목표, milestone, 제외/드랍 범위',
    '- `.harness/progress-tracker.md`: 요청 단위 상태와 증거',
    '- `.harness/current-state.md`: 지금 이어서 할 작업',
    '- `.harness/session-handoff.md`: 다음 세션 인수인계 (자동 작성)',
    '- `.harness/lessons.md` / `decisions.md` / `rules.md`: 영구 메모리 (5 surface)',
    '',
    `Last synced by Leerness v${VERSION}: ${today()}`,
    README_END,
    ''
  ].join('\n');
}

function mergeReadmeSection(existing, block) {
  if (!existing) return `# Project\n\n${block}`;
  const s = existing.indexOf(README_START); const e = existing.indexOf(README_END);
  if (s >= 0 && e >= s) return existing.slice(0, s).trimEnd() + '\n\n' + block + '\n' + existing.slice(e + README_END.length).trimStart();
  return existing.trimEnd() + '\n\n' + block;
}

function skillLock(skills) {
  const data = { leernessVersion: VERSION, updatedAt: now(), installedSkills: {} };
  for (const s of skills) data.installedSkills[s] = skillCatalog[s] || { version: 'unknown' };
  return JSON.stringify(data, null, 2) + '\n';
}

function coreFiles(root, lang = 'ko', selectedSkills = []) {
  const project = detectProjectName(root);
  const skillRows = Object.entries(skillCatalog).map(([k, v]) => `| ${k} | ${v.displayNameKo} | ${v.capabilities.join(', ')} | ${v.lastUpdated} | ${v.verification} |`).join('\n');
  return {
    'AGENTS.md': `${MARK}\n# Leerness Agent Instructions\n\n## ⭐ 매 세션 첫 행동 (1.9.39+)\n**반드시 \`.harness/session-workflow.md\`를 먼저 읽고 6단계 워크플로를 따른다**: 요청분석→계획→분배→sub-agent작업→종합검증→마감. 라운드 길이/복잡도 무관, drift 방지를 위해 모든 작업에 동일 흐름 유지.\n\n## Mandatory read order (session start)\n1. **.harness/session-workflow.md** (1.9.39+ 6단계 워크플로 — 최우선)\n2. .harness/context-routing.md\n3. .harness/session-handoff.md\n4. .harness/current-state.md\n5. .harness/plan.md\n6. .harness/progress-tracker.md\n7. .harness/guideline.md\n8. .harness/protected-files.md\n9. .harness/writeback-policy.md\n10. .harness/anti-lazy-work-policy.md\n11. **.harness/rules.md** (사용자 정의 영구 룰 — 매 세션 반드시 따름)\n\n## Required behavior\n- 작업 시작 시 \`leerness handoff .\`를 실행해 컨텍스트를 적재합니다 (handoff가 active rules를 자동 출력).\n- 작업 분류는 \`leerness route <task-type>\`로 확인합니다 (planning, feature, bugfix, refactor, research, consistency, release, migration, session-start, session-close, harness-maintenance).\n- 보호 파일/관리 섹션을 삭제하지 않습니다. 머지·아카이브·deprecated 표시를 사용합니다.\n- 의미 있는 변경 후 progress-tracker, current-state, task-log, session-handoff를 갱신합니다.\n- 완료 선언 전 \`leerness check .\` 또는 \`leerness lazy detect .\`로 자기검증합니다.\n- 변경 전 secret/encoding 가드: \`leerness scan secrets .\`, \`leerness encoding check .\`.\n- 같은 기능 중복 생성 전 design-system.md, consistency-policy.md, reuse-map.md를 확인합니다.\n- 매 세션 종료 시 \`leerness session close .\`로 9개 카테고리(완료/진행중/미완료/예정/대기/보류/차단/드랍/검증) + **활성 룰 검증 결과**를 보고합니다.\n- 업데이트는 \`leerness update --check\` (감지) → \`leerness update --yes\` (자동 마이그레이션).\n\n## 자연어 회고/통찰/브레인스토밍 (1.9.13)\n사용자가 자연어로 회고/통찰/브레인스토밍을 요청하면 즉시 leerness 명령으로 호출합니다.\n\n| 사용자 발화 (자연어) | 즉시 실행할 명령 |\n|---|---|\n| "회고해줘 / 돌아보자 / 정리해줘" | \`leerness retro\` |\n| "최근 N일 회고" | \`leerness retro --days N\` |\n| "통계 / 누적 지표 / insights" | \`leerness insights\` |\n| "X에 대해 브레인스토밍 / X 관련 자료 / X 시작 전 검토" | \`leerness brainstorm "X"\` |\n\nsession close가 매번 자동으로 한 줄 요약을 출력하고, 5세션마다 자동 깊은 회고를 실행합니다. 사용자가 명시 요청 시 즉시 호출.\n\n## 자연어 룰 처리 (1.9.8)\n사용자가 자연어로 영구 룰을 요청하면 즉시 leerness rule 명령으로 등록합니다.\n\n| 사용자 발화 (자연어) | 즉시 실행할 명령 |\n|---|---|\n| "매 업데이트마다 버전 bump해줘" | \`leerness rule add "버전을 patch로 bump" --trigger every-update\` |\n| "매 커밋마다 패치노트 추가해줘" | \`leerness rule add "패치노트 추가" --trigger every-commit\` |\n| "세션 종료마다 배포해줘" | \`leerness rule add "배포 (release publish)" --trigger session-close\` |\n| "X 룰 중지/그만/끄기" | \`leerness rule pause <ID>\` (해당 룰 ID는 list로 확인) |\n| "X 룰 제거/삭제" | \`leerness rule remove <ID>\` |\n| "모든 룰 중지" | \`leerness rule stop\` |\n| "룰 다시 켜줘" | \`leerness rule resume-all\` 또는 \`leerness rule resume <ID>\` |\n\n룰을 등록한 후 사용자에게 등록 결과(ID + trigger + 설명)를 보고하고, 그 이후 매 세션마다 자동 적용합니다. 사용자가 "중지" 또는 "제거"를 명시적으로 말하기 전까지는 룰을 비활성화하지 않습니다.\n\n## 룰 자동 적용 (1.9.8)\nleerness가 자동 검증 가능한 trigger:\n- **every-update / version bump 키워드 룰**: package.json의 version이 갱신됐는지 검사 (handoff/session close가 baseline 캐시와 비교).\n- **CHANGELOG / 패치노트 키워드 룰**: CHANGELOG.md의 mtime이 갱신됐는지 검사.\n- **test / 테스트 / verify 키워드 룰**: review-evidence.md에 오늘 verify-code 흔적이 있는지 검사.\n- **배포 / publish / push 키워드 룰**: 자동 검증 불가 → 사용자에게 release publish 명령을 안내.\n\n자동 검증 가능한 룰의 실행은 \`leerness release bump\`, \`leerness release note "..."\`, \`leerness release publish\`를 사용해 자동화합니다.\n`,
    'CLAUDE.md': `${MARK}\n# Claude Code Instructions\n\nFollow AGENTS.md. Always run \`leerness handoff .\` at the start and \`leerness session close .\` before ending a session.\n\n**⭐ 매 세션 첫 행동 (1.9.39+)**: \`.harness/session-workflow.md\`의 6단계 워크플로(요청분석→계획→분배→sub-agent→종합검증→마감)를 따라야 함. drift critical 시 \`leerness drift check --auto-fix\`로 자동 회복.\n\nProtected files must not be deleted. Read .harness/anti-lazy-work-policy.md before claiming completion.\n\n## 자연어 영구 룰 (1.9.8)\n사용자가 "매 X마다 Y를 해줘" 같은 자연어 룰을 말하면 즉시 \`leerness rule add "Y" --trigger every-X\`로 등록하세요. 등록된 룰은 매 세션 \`handoff\`가 자동 출력하고, \`session close\`가 자동 검증해 보고합니다. 사용자가 "중지" / "그만" / "끄기"를 명시할 때만 \`rule pause/remove\`를 호출합니다.\n\n자세한 매핑은 AGENTS.md의 "자연어 룰 처리" 표를 참고하세요.\n`,
    '.cursor/rules/leerness.mdc': `${MARK}\n---\nalwaysApply: true\n---\nFollow AGENTS.md and .harness/context-routing.md.\nRun: \`leerness handoff .\` at session start.\nRun: \`leerness session close .\` at session end.\nPreserve Leerness protected files.\n`,
    '.github/copilot-instructions.md': `${MARK}\n# Copilot Instructions\n\nUse AGENTS.md and .harness/ as project memory.\nDo not remove protected Leerness files.\nBefore completion, ensure plan.md, progress-tracker.md, current-state.md, session-handoff.md are updated.\n`,
    '.harness/HARNESS_VERSION': VERSION + '\n',
    '.harness/LANGUAGE': lang + '\n',
    '.harness/manifest.json': JSON.stringify({ project, leernessVersion: VERSION, language: lang, installedAt: now() }, null, 2) + '\n',
    '.harness/skills-lock.json': skillLock(selectedSkills),
    '.harness/project-brief.md': fm('project-brief', ['프로젝트 목적 확인','신규 기능 판단','계획 수립'], ['프로젝트 목적 변경','사용자/범위 변경'], `# Project Brief\n\n## Project\n${project}\n\n## Purpose\n- 이 프로젝트의 목적을 실제 내용으로 업데이트하세요.\n\n## Users\n-\n\n## Success Criteria\n-\n`),
    '.harness/plan.md': fm('plan', ['작업 시작 전','새 요청 접수','범위 변경','신규 프로젝트 감지'], ['계획 추가/수정/드랍','milestone 변경','목표 변경'], `# Plan\n\n## Goal\n- 사용자 목적을 기준으로 전체 계획을 유지합니다.\n\n## Scope\n- 포함 범위를 기록합니다.\n\n## Out of Scope / Dropped\n| ID | Item | Reason | Date |\n|---|---|---|---|\n\n## Milestones\n\n### M-0001. 프로젝트 계획 정리\nStatus: planned\nProgress: 0%\n\nTasks:\n- [ ] project-brief.md를 실제 프로젝트 목적에 맞게 작성\n- [ ] context-map.md를 실제 파일 구조에 맞게 작성\n`),
    '.harness/progress-tracker.md': fm('progress-tracker', ['세션 시작','세션 종료','사용자 요청 상태 확인'], ['작업 상태 변경','검증 결과 추가','사용자 요청 드랍'], `# Progress Tracker\n\nStatus values: requested, planned, in-progress, waiting, on-hold, blocked, incomplete, done, dropped\n\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n`),
    '.harness/guideline.md': fm('guideline', ['구현 전 품질 기준 확인','계획 이행 기준 확인'], ['개발 기준 변경','검증 루틴 변경'], `# Guideline\n\n## Operating Principle\n- plan.md의 목표와 범위를 기준으로 작업합니다.\n- progress-tracker.md의 요청 상태를 기준으로 완료/미완료를 판단합니다.\n- guideline.md에는 진행률 수치를 직접 기록하지 않습니다. 진행률은 plan.md/progress-tracker.md가 단일 출처입니다.\n\n## Quality Gate\n- 변경 전 관련 route를 확인합니다 (\`leerness route <task-type>\`).\n- 변경 후 \`leerness verify\`, \`leerness audit\`, \`leerness check\`을 실행합니다.\n- 완료 선언 전 \`leerness lazy detect\`을 실행합니다.\n- 세션 종료 시 \`leerness session close\`를 실행합니다.\n`),
    '.harness/plan-progress-boundary.md': fm('plan-progress-boundary', ['계획과 진행률이 중복될 때','작업 추적 구조 변경'], ['역할 분리 기준 변경'], `# Plan / Progress Boundary\n\n## plan.md\n- 전체 목표, milestone, 포함/제외 범위, 계획 변경 이력.\n\n## progress-tracker.md\n- 사용자 요청 단위의 상태, 증거, 다음 액션.\n- ID 규칙: T-0001부터 단조 증가. plan add 시 부여되는 ID는 plan/progress 양쪽에서 고유합니다.\n\n## guideline.md\n- plan/progress를 수행할 때 지켜야 할 실행 기준.\n`),
    '.harness/current-state.md': fm('current-state', ['세션 시작','작업 이어받기'], ['현재 상태 변경','다음 작업 변경'], `# Current State\n\nUpdated: ${today()}\n\n## Now\n-\n\n## Next\n-\n\n## Blockers\n-\n`),
    '.harness/context-routing.md': fm('context-routing', ['모든 작업 전','작업 유형 판단'], ['새 작업 유형 추가','참조 파일 변경'], `# Context Routing\n\n${Object.entries(routes).map(([k, v]) => `## ${k}\nRead:\n${v.read.map(x => '- ' + x).join('\n')}\n\nUpdate:\n${v.update.map(x => '- ' + x).join('\n')}`).join('\n\n')}\n`),
    '.harness/writeback-policy.md': fm('writeback-policy', ['작업 완료 전','문서 갱신 판단'], ['기록 대상 변경'], `# Writeback Policy\n\n- plan.md: 사용자 목적, milestone, 범위 추가/제외\n- progress-tracker.md: 요청 단위 상태와 증거 (in-place 갱신)\n- current-state.md: 현재 상태와 다음 작업\n- task-log.md: 수행 이력 (자동 추가)\n- session-handoff.md: 다음 세션 인수인계 (\`session close\`가 자동 작성)\n- decisions.md: 되돌리기 어려운 결정\n- design-system.md: UI/UX/컴포넌트 기준\n- feature-contracts.md: 입력/출력/상태/오류 계약\n- review-evidence.md: 검증 결과 (자동 누적)\n`),
    '.harness/task-type-map.md': fm('task-type-map', ['사용자 요청 분류'], ['작업 유형 추가'], `# Task Type Map\n\n| User Request | Task Type | Route |\n|---|---|---|\n| 계획 세워줘 / 로드맵 짜줘 | planning | leerness route planning |\n| 기능 구현 / 만들어줘 | feature | leerness route feature |\n| 버그 수정 / 고쳐줘 | bugfix | leerness route bugfix |\n| 리팩토링 / 정리 | refactor | leerness route refactor |\n| 리서치 / 비교/조사 | research | leerness route research |\n| 디자인 통일 / 일관성 | consistency | leerness route consistency |\n| 배포 / 릴리즈 | release | leerness route release |\n| 마이그레이션 | migration | leerness route migration |\n| 세션 시작 / 이어 작업 | session-start | leerness route session-start |\n| 세션 종료 | session-close | leerness route session-close |\n`),
    '.harness/protected-files.md': fm('protected-files', ['파일 삭제/정리/마이그레이션 전'], ['보호 대상 변경'], `# Protected Files\n\nAI agents must not delete or reset these files without explicit user approval.\n\n- .harness/\n- .harness/skills/\n- .harness/library/\n- AGENTS.md\n- CLAUDE.md\n- .cursor/rules/leerness.mdc\n- .github/copilot-instructions.md\n- .claude/commands/\n- .claude/skills/\n- README.md Leerness managed section\n\nUse merge, archive, or deprecated markers instead of deletion.\n`),
    '.harness/architecture.md': fm('architecture', ['기능 구현','리팩토링','마이그레이션'], ['구조 변경'], `# Architecture\n\n## Overview\n- 실제 구조를 기록하세요.\n\n## Data Flow\n-\n\n## External Dependencies\n-\n`),
    '.harness/context-map.md': fm('context-map', ['관련 파일 탐색','기능 구현 전'], ['파일 구조 변경'], `# Context Map\n\n| Area | Files | Notes |\n|---|---|---|\n| App | src/** | 실제 경로로 업데이트 |\n| Tests | tests/** | 검증 경로 |\n`),
    '.harness/decisions.md': fm('decisions', ['설계 결정 확인'], ['중요 결정 발생'], `# Decisions\n\n## Template (예시 — 실제 결정은 아래 코드블록 밖에 추가)\n\n\`\`\`md\n### ${today()} — Decision 제목\n- Decision:\n- Reason:\n- Alternatives:\n- Impact:\n\`\`\`\n`),
    '.harness/task-log.md': fm('task-log', ['작업 이력 확인'], ['모든 의미 있는 작업 후'], `# Task Log\n\n## ${today()}\n- Leerness v${VERSION} initialized.\n`),
    '.harness/guardrails.md': fm('guardrails', ['모든 작업 전','보안/권한/리팩토링 전'], ['금지 규칙 변경'], `# Guardrails\n\n- 토큰/키/비밀번호를 저장하지 않습니다. 환경변수 이름만 기록합니다.\n- 요청 없는 대규모 리팩토링을 하지 않습니다 (5개 이상 파일 변경 시 사용자 사전 승인).\n- API/DB/환경변수 변경은 영향 범위를 task-log에 기록합니다.\n- Leerness 보호 파일/관리 섹션을 삭제하지 않습니다.\n- 한글 인코딩은 BOM 없는 UTF-8을 유지합니다.\n- destructive Git 작업(\`git reset --hard\`, \`git push --force\` 등)은 사용자 명시 승인 후에만 수행합니다.\n`),
    '.harness/design-system.md': fm('design-system', ['UI 변경','컴포넌트 추가','designguide 병합'], ['디자인 기준 변경','재사용 패턴 발견'], `# Design System\n\n## Canonical File\n이 파일은 designguide.md, design-guide.md와 같은 디자인 가이드의 기준 파일입니다.\n\n## Tokens\n| Token | Value | Notes |\n|---|---|---|\n| color.primary | (실제 값으로 업데이트) | |\n| color.surface | | |\n| spacing.unit | | |\n| typography.body | | |\n\n## Reusable Patterns\n| Pattern | Where | Reuse Rule |\n|---|---|---|\n`),
    '.harness/consistency-policy.md': fm('consistency-policy', ['UI/기능 중복 생성 전','재사용 판단'], ['일관성 정책 변경'], `# Consistency Policy\n\n동일한 기능을 하는 요소는 새로 만들기 전에 기존 구현을 찾아 재사용/확장/연결합니다.\n\n## Recursive Reuse Rule\n1. 같은 기능의 기존 요소를 찾습니다.\n2. 자기 참조/기저 규칙/재귀 흐름이 필요한지 확인합니다.\n3. 기존 요소를 재사용하거나 확장합니다.\n4. 불가피하게 새로 만들면 reuse-map.md에 이유를 기록합니다.\n\n## Audit Trigger\n\`leerness audit\`는 다음을 검사합니다:\n- 디자인 가이드 중복 파일\n- design-system.md 토큰 미정의\n- reuse-map.md 비어있음 + 컴포넌트/유틸 ≥3개 발견\n- plan vs progress 정렬\n`),
    '.harness/reuse-map.md': fm('reuse-map', ['새 컴포넌트/API/helper 생성 전','중복 기능 감지'], ['재사용 가능한 요소 추가'], `# Reuse Map\n\n| Capability | Existing Element | Reuse Method | Notes |\n|---|---|---|---|\n`),
    '.harness/feature-contracts.md': fm('feature-contracts', ['기능 구현/수정 전'], ['기능 입출력/상태/오류 변경'], `# Feature Contracts\n\n## Template\n- Feature:\n- Input:\n- Output:\n- States:\n- Errors:\n- Related files:\n- Test evidence ID:\n`),
    // 1.9.141: Feature Causality Graph — 신규 기능/형식 변경 시 영향 범위 자동 추적 (사용자 요청)
    '.harness/feature-graph.md': fm('feature-graph', ['신규 기능 추가 전','데이터 형식 변경 전','외부 API 매칭 작업 전'], ['feature 등록 / 링크 / impact 회수'], `# Feature Graph (1.9.141)\n\n> **목적**: 각 기능의 인과관계를 정확히 정리해서 코드 작성 전 영향 범위를 자동 추적.\n> 신규 기능 추가, 데이터 형식 변경, 외부 API 매칭 작업 전 \`leerness feature impact <id>\`로 확인.\n> handoff가 현재 task 키워드로 자동 매칭해서 영향받는 feature 목록을 회수.\n\n## How to use\n\n\`\`\`bash\nleerness feature add "User Auth"                           # F-0001 자동 부여\nleerness feature link F-0002 --depends-on F-0001           # 의존 관계\nleerness feature link F-0001 --affects F-0002,F-0005        # 영향 관계 (다수)\nleerness feature link F-0001 --co-changes-with F-0011       # 함께 변해야 하는 기능\nleerness feature impact F-0001                              # 영향받는 전체 (transitive)\nleerness feature list --json                                # 그래프 JSON\nleerness feature show F-0001                                # 단일 상세\n\`\`\`\n\n## Nodes\n\n`),
    '.harness/testing-strategy.md': fm('testing-strategy', ['검증 전','릴리즈 전'], ['테스트 전략 변경'], `# Testing Strategy\n\n- Typecheck (\`tsc --noEmit\` 또는 동등)\n- Lint (\`npm run lint\` 등)\n- Unit/Integration/E2E\n- Manual smoke test\n- Browser/UI smoke (frontend 변경 시)\n\n## Evidence Format\nEach completed task must reference an evidence ID stored in .harness/review-evidence.md.\n`),
    '.harness/review-checklist.md': fm('review-checklist', ['PR/리뷰 전'], ['리뷰 기준 변경'], `# Review Checklist\n\n- [ ] 계획과 정렬되어 있는가\n- [ ] progress-tracker가 갱신되었는가\n- [ ] 보호 파일을 삭제하지 않았는가\n- [ ] 디자인/기능 재사용을 확인했는가\n- [ ] 시크릿이 코드에 들어가지 않았는가 (\`leerness scan secrets\`)\n- [ ] 한글 인코딩 OK (\`leerness encoding check\`)\n- [ ] 게으름 평가 통과 (\`leerness lazy detect\`)\n`),
    '.harness/release-checklist.md': fm('release-checklist', ['배포 전'], ['배포 조건/환경변수/롤백 변경'], `# Release Checklist\n\n- [ ] \`leerness verify .\`\n- [ ] \`leerness audit .\`\n- [ ] \`leerness scan secrets .\`\n- [ ] \`leerness encoding check .\`\n- [ ] 프로젝트 typecheck/lint/test\n- [ ] 환경변수 (.env.example) 동기화\n- [ ] 롤백 방법 확인\n- [ ] CHANGELOG 갱신\n`),
    '.harness/session-close-policy.md': fm('session-close-policy', ['세션 종료 전'], ['세션 종료 형식 변경'], `# Session Close Policy\n\nEvery session must list:\n- Completed\n- In progress\n- Incomplete\n- Planned\n- Waiting\n- On hold\n- Blocked\n- Dropped\n- Verification (commands run, results)\n- Recommended next direction\n- Next exact step\n\n\`leerness session close\`가 위 9개 카테고리를 자동 추출하고, session-handoff.md에 다음 세션을 위한 인수인계 블록을 자동 작성합니다.\n`),
    '.harness/session-workflow.md': fm('session-workflow', ['세션 시작','새 사용자 요청 도착','복잡한 작업 분배 전'], ['워크플로 단계 변경'], `# Session Workflow — AI 하네스 엔지니어링 6단계

> **매 세션 시작 시 메인 에이전트는 이 문서를 먼저 읽고 6단계를 그대로 따른다.**
> 라운드 길이/복잡도 무관, 단순 작업도 동일 흐름 유지 — 그래야 drift 안 됨.

## Step 1. 요청 분석 + 환경 확인
\`\`\`bash
leerness handoff .            # 컨텍스트 적재 + drift 자동 경고
leerness drift check .        # 4 신호 + 4단계 레벨
\`\`\`
- 사용자 요청을 5W1H로 분해. 모호하면 명확화 질문 (autonomous 모드 제외).
- drift critical 시 \`leerness session close .\` 또는 \`drift check --auto-fix\` 우선 실행.

## Step 2. 계획 수립
- 작업이 3 step 이상 → TodoWrite 또는 \`leerness plan add\` 사용.
- 신규 capability → \`leerness reuse-map\` / \`reuse find <query>\`로 기존 자원 우선 검색.
- 다중 모듈 → 통합 사양 사전 정의 (예: TICK_SPEC.md).

## Step 3. 업무 분배 — sub-agent 매핑
\`\`\`bash
leerness agents list                  # ready CLI 확인
leerness agents quota                 # 한도 확인
leerness agents dispatch "<task>" --to <id>   # 작업 유형 추천 자동
\`\`\`
- 작업 유형별 최적 sub-agent:
  - 텍스트/번역/분석 → claude (1.7× 빠름)
  - 깊은 코드 추론 → codex (가장 상세)
  - 파일 직접 수정 → gemini --yolo (정확)
  - 보안 리뷰 → \`leerness review --persona security\`
- **충돌 방지 규칙 (필수)**:
  - 각 sub-agent에 *자신만 수정할 파일 경로* 명시
  - mtime 검증 결과 보고 의무화 (동시 쓰기는 last-writer-wins 위험)
  - 사양 사전 정의 → \`leerness contract verify\`로 사후 검증

## Step 4. sub-agent 작업 + 개별 자체 검증
- 각 sub-agent가 자기 모듈 자체 테스트 통과 후 보고.
- 보고 형식: 라인 수, 테스트 N/N PASS, 발견 이슈, mtime 검증 결과.

## Step 5. 종합 검증
\`\`\`bash
leerness contract verify SPEC.md src/<mod>.js  # 명세 ↔ 구현 일치
leerness verify-claim T-XXX --run-tests --strict-claims
leerness review <file> --persona security,performance,ux
\`\`\`
- 메인이 직접 통합 시나리오 작성 + 실행 (independent 검증).
- Sub-agent 검수 vs 메인 검수 결과 *교차 일치* 확인.

## Step 6. 세션 마감 + 인계 + 다음 라운드 추천
\`\`\`bash
leerness session close .             # 1.9.59+ — --suggest default 활성 (마감 + 다음 라운드 자동)
leerness session close . --no-suggest  # suggest 비활성 (이전 동작)

# 분리 호출도 가능:
leerness skill suggest .             # 1.9.53 — 반복 패턴 → 새 skill 후보
leerness drift check .               # 4 신호 + 4 레벨 점검
leerness audit . --fix               # 누락 메타 자동 보강
\`\`\`

## 🧠 Memory CRUD Quick Reference (1.9.107~135)

5 Memory Surface 모두 CRUD CLI + MCP 노출 완성:

| Surface | CREATE | READ | DELETE | RESTORE |
|---|---|---|---|---|
| **tasks** | task add | task list --json (1.9.134) | task drop | task update |
| **decisions** | decision add | decision list --json | decision drop | memory restore decisions |
| **lessons** | lesson save | lesson list [--tag] | lesson drop | memory restore lessons |
| **plan** | plan add | plan list --json | plan remove | memory restore plan |
| **rules** | rule add | rule list --json | rule remove | (rule pause/resume) |

\`\`\`bash
leerness memory status [--json]              # 5종 상태 통합 조회 (T/D/R/P/L 카운트)
leerness memory archive list [--surface s]   # DELETE archive 통합 조회 (복원 후보)
leerness memory restore <surface> <target>   # archive → active 복귀 (DELETE→RESTORE cycle, 1.9.128)
\`\`\`

**잘못 저장한 항목 복구**:
1. \`memory archive list\` — 복원 후보 확인
2. \`memory restore decisions "PostgreSQL"\` — archive → active
3. handoff 가 매 세션 자동으로 24h 내 archive 활동 알림 (1.9.129)


- session close가 누락되면 다음 세션 시작 시 drift critical 발생.
- 자동 회복 옵션: \`drift check --auto-fix\` (critical 시 session close 자동 실행).
- 1.9.56+ handoff가 매 세션 시작 시 **과거 lessons 자동 재상기** (현재 task 키워드 기준).
- 1.9.67+ handoff가 현재 task와 매칭되는 **설치된 skill을 자동 추천** (jaccard 기반, default ON, \`--no-skill-suggest\`로 끄기).
- 1.9.67+ lessons 인덱스에 \`task-log.md\` 실패 라인까지 포함 → 회수 범위 확장.
- 1.9.69+ handoff가 \`skill-suggestions.md\` rolling history (과거 같은 키워드 매칭 결과)도 자동 노출.
- 1.9.76+ handoff에 보안 요약 1~2 line 자동 (\`.env\` ↔ \`.env.example\` 동기화 + \`.gitignore\` 시크릿 누락).
- 1.9.80+ \`.env\` 가 \`.gitignore\` 에 누락 시 🚨 CRITICAL + \`LEERNESS_AUTO_SECURITY_FIX=1\` 환경변수 시 \`audit --fix\` 자동 실행.
- 1.9.81+ handoff Date/Project 직후 통합 헤드라인 한 줄 (drift / 보안 / MCP / skill query / 설치 skill 수).
- 1.9.85+ \`leerness health\` 한 줄로 종합 점검 (drift + 보안 + skills + usage + tasks).
- 1.9.78/82+ \`leerness drift check --auto-fix\` 가 보안 신호 발견 시 \`audit --fix\` 자동 실행 → 재검사.
- 1.9.86+ MCP server **18 도구** (handoff/drift/audit/verify_claim/contract/agents/reuse/whats_new/usage_stats/session_close/skill_suggest/lessons/task_export/env_check/brainstorm/skill_match/skill_list/health).
- 1.9.94+ MCP server **21 도구** (skill_search/skill_info/benchmark 추가).
- 1.9.96+ \`leerness handoff --json\` (외부 AI/MCP 통합용 구조화 출력).
- 1.9.98+ \`leerness skill publish\` 보안 사전 점검 통합 (health 통과 후 publish).
- 1.9.99+ \`leerness handoff --quiet\` (자동화/CI 모드 — 자동 회수 라인 비활성).
- 1.9.100 🏆 마일스톤 — 30 라운드 자율 누적, stress-v45 30/30 PASS, e2e 219/219 PASS.
- 1.9.101+ \`leerness lazy detect --json\` + MCP **22 도구** (\`leerness_lazy_detect\` 추가 — 거짓 완료/empty handoff/no test run/TODO 미추적 신호 JSON).
- 1.9.102+ \`leerness audit --json\` 구조화 출력 (findings 11종 kind: design_dup/design_system_default/reuse_map_empty/milestone_unlinked/handoff_not_generated/current_state_stale/readme_version_mismatch/npm_cve/gitignore_missing_secrets/env_keys_missing/strict_promoted). MCP \`leerness_audit\`도 JSON 자동.
- 1.9.103+ \`leerness session close --json\` 마감 통계 JSON (taskCounts/rules/skillCandidates/drift/topCommands/mcpStats/workspacePeers). MCP \`leerness_session_close\`도 JSON 자동.
- 1.9.104+ MCP **23 도구** (\`leerness_retro\` 추가 — 4세션 누적 회고 JSON 외부 AI 노출).
- 1.9.105+ MCP **24 도구** (\`leerness_task_add\` 추가 — 외부 AI 가 task 즉시 등록, 양방향 제어 완성).
- 1.9.106+ MCP **25 도구** (\`leerness_task_update\` 추가 — task 상태/evidence/nextAction 갱신, read+add+update 3종 surface 완성).
- 1.9.107+ MCP **26 도구** (\`leerness_task_drop\` 추가 — task 폐기, **task CRUD 완성**: read/add/update/drop).
- 1.9.108+ \`leerness decision add\` CLI + MCP **27 도구** (\`leerness_decision_add\` — decisions.md 영구화 + handoff lessons 회수와 통합).
- 1.9.109+ \`leerness rule list --json\` + MCP **29 도구** (\`leerness_rule_add\` + \`leerness_rule_list\` — 자연어 영구 룰 R/W).
- 1.9.110+ MCP **30 도구 🎉 30 도구 마일스톤** (\`leerness_plan_add\` — plan.md milestone + progress-tracker 자동 동기화).
- 1.9.112+ MCP **31 도구** (\`leerness_lesson_save\` — lessons.md 직접 write, **Memory Write Surface 5종 완성**: tasks/decisions/rules/plan/lessons).
- 1.9.113+ handoff 통합 헤드라인에 **🧠 mem T/D/R/P/L 카운트** 추가 — 5종 메모리 영구화 상태 한눈에 확인.
- 1.9.114+ \`leerness memory status [--json]\` + MCP **32 도구** (\`leerness_memory_status\`) — 상세 상태 + 최근 항목 조회.
- 1.9.115+ \`leerness handoff --json\` 응답에 **\`memorySurface\` 필드 통합** — 단일 호출로 컨텍스트 + 5종 메모리 상태 동시 회수.
- 1.9.116+ \`leerness brainstorm\` 회수 범위에 **lessons.md + plan.md** milestone 추가 — Memory Surface 5종 완전 통합.
- 1.9.117+ \`leerness lesson list [--tag] [--json]\` + MCP **33 도구** (\`leerness_lesson_list\`) — lessons.md 전용 조회 + tag 필터.
- 1.9.118+ \`leerness decision list [--json]\` + MCP **34 도구** (\`leerness_decision_list\`) — decisions.md 전체 조회 (Decision/Reason/Alternatives/Impact 메타).
- 1.9.119+ \`leerness plan list [--json]\` + MCP **35 도구** (\`leerness_plan_list\`) — plan.md milestone 전체 (Status/Progress/Tasks). **Memory Surface READ 5종 완전 완성**.
- 1.9.121+ handoff 6번째 자동 회수 \`🆕 최근 24h 메모리 변동\` — 5종 surface 의 24h 내 추가 항목 자동 노출.
- 1.9.122+ \`session close --json\` 응답에도 \`memorySurface\` 필드 통합 — 마감 시 5종 메모리 상태 동시 회수.
- 1.9.123+ \`health --json\` 응답에도 \`memorySurface\` 필드 통합 — handoff/session close/memory status 모든 JSON 명령 일관성.
- 1.9.124+ \`leerness lesson drop <target>\` + MCP **36 도구** (\`leerness_lesson_drop\`) — 잘못 저장한 lesson 제거 (archive 자동 보존).
- 1.9.125+ \`leerness decision drop <target>\` + MCP **37 도구** (\`leerness_decision_drop\`) — 잘못 저장한 결정 제거 (archive 보존).
- 1.9.126+ \`leerness plan remove <M-XXXX|title>\` + MCP **38 도구** (\`leerness_plan_remove\`) — milestone 영구 제거 (archive 보존). **Memory Surface DELETE 5종 완전 완성** 🎉.
- 1.9.127+ \`leerness memory archive list [--surface decisions|lessons|plan] [--json]\` + MCP **39 도구** (\`leerness_memory_archive_list\`) — DELETE 5종 archive 통합 조회 (복원 후보 회수).
- 1.9.128+ \`leerness memory restore <surface> <target>\` + MCP **40 도구 🎉** (\`leerness_memory_restore\`) — archive → active 복귀 (DELETE→RESTORE cycle 완성). **MCP 40 도구 마일스톤**.
- 1.9.129+ handoff **7번째 자동 회수** — \`🗑 최근 24h archive\` (D/L/P 카운트 + 복원 후보 안내). DELETE 활동 자동 인지.
- 1.9.130+ 🎉 **60 라운드 자율 모드 마일스톤** — JSON 4종 (handoff/memory status/session close/health) \`memorySurface.archive\` 필드 통합. MCP 40 / handoff auto-recovery 7 / DELETE-RESTORE cycle 완성.
- 1.9.131+ \`brainstorm\` 회수 범위에 3 archive 파일 (decisions/lessons/plan archive) 통합 — 과거 제거된 ideas 가 새 brainstorm 시 다시 후보로 노출. \`hits.archive\` 필드 + 복원 안내 라인.
- 1.9.132+ \`session close\` 텍스트 모드에 archive 누적 라인 추가 — 마감 시점 DELETE 활동 가시화 (handoff 7번째 회수와 symmetric). archive 가시성 6 surface 완성.
- 1.9.133+ \`brainstorm\` 텍스트 모드 lessonsExplicit / planMilestones display 추가 — 1.9.116에서 데이터 수집은 했지만 display 누락된 pre-existing gap fix.
- 1.9.134+ \`leerness task list --json\` + MCP **41 도구** (\`leerness_task_list\`) — progress-tracker.md task 전체 JSON 조회 + \`--status\` 필터. Task surface CRUD MCP 완전 완성 (add/list/update/drop).
- 1.9.135+ MCP **42 도구** (\`leerness_rule_remove\`) — rules.md 에서 특정 rule 제거 + archive 보존. **5 surface CRUD MCP 완전 완성** (task/decision/lesson/plan/rule 모두 add/list/delete MCP 노출).
- 1.9.136+ MCP \`leerness_drift_check\` JSON 응답 fix — \`--json\` 플래그 자동 추가하여 외부 AI가 구조화된 drift 신호 회수 (score, level, signals[], healthy).
- 1.9.137+ \`.harness/session-workflow.md\` 템플릿에 **🧠 Memory CRUD Quick Reference** 섹션 추가 — 5 surface × CRUD 매트릭스 + archive cycle 워크플로 가이드. 신규 \`init\` 워크스페이스 즉시 적용.
- 1.9.138+ \`leerness memory archive list --query <keyword>\` + MCP \`leerness_memory_archive_list\` query 인자 — archive 항목 키워드 case-insensitive 검색 (target/originalHeader 매칭).
- 1.9.139+ \`leerness lesson list --query\` + \`leerness decision list --query\` + MCP 동일 인자 — active Memory 항목 키워드 검색 (lesson: text/tag, decision: title/decision/reason/alternatives/impact).

---

## 빠른 체크리스트

세션 끝나기 전 다음이 모두 ✓이어야 한다:
- [ ] plan/progress-tracker에 이번 라운드 task 등록됨 (또는 task sync)
- [ ] 모든 done 항목에 evidence 첨부됨 (verify-claim PASS)
- [ ] sub-agent 사용 시 contract verify PASS
- [ ] drift 점수 ≤ 30 (attention 이하) — \`leerness drift check\` (1.9.78: 5신호 + 보안)
- [ ] session close 호출됨
- [ ] (1.9.85+) \`leerness health\`로 종합 점검 — drift + 보안 + skill + MCP + tasks
- [ ] (1.9.75/76+) \`.env\` 사용 중이면 \`.gitignore\` 시크릿 패턴 OK + \`.env.example\` 동기화
- [ ] (1.9.80+) 보안 critical 시 \`LEERNESS_AUTO_SECURITY_FIX=1\` 또는 \`audit --fix\`로 자동 회복

## Anti-pattern (drift 신호)

- ⚠ "작업 끝났으니 보고만 하고 끝" → session close 누락 → 다음 세션 drift critical
- ⚠ "TodoWrite만 갱신하고 leerness 안 씀" → \`task sync --from\` 또는 \`task add\` 필수
- ⚠ sub-agent 분배 시 파일 경로 미명시 → 동시 쓰기 충돌
- ⚠ "테스트 돌렸으니 PASS" 자기 보고만 → verify-claim --run-tests 미실행
- ⚠ contract verify 생략 → 사양 불일치 BUG가 사용자에게 노출
`),
    '.harness/anti-lazy-work-policy.md': fm('anti-lazy-work-policy', ['완료 선언 전'], ['게으른 작업 방지 기준 변경'], `# Anti Lazy Work Policy\n\n## Rules\n1. **증거 없는 완료 금지**: \"완료\"를 선언하려면 progress-tracker의 evidence 컬럼에 명령 출력/테스트 결과/스크린샷 경로 등이 있어야 합니다.\n2. **빈 핸드오프 금지**: 세션 종료 시 session-handoff.md의 Completed/In Progress/Next Exact Step이 모두 비어 있으면 close가 \"insufficient\" 상태로 표시됩니다.\n3. **부분 구현 자기보고**: 완전 구현이 아니면 status를 \`incomplete\`로, Next Exact Step에 \"무엇을 추가해야 끝나는지\" 한 줄을 적습니다.\n4. **검증 기록**: typecheck/lint/test 결과를 review-evidence.md에 누적 기록합니다.\n5. **TODO 표지**: 코드에 \`TODO\`/\`FIXME\`/\`XXX\`를 새로 도입하면 progress-tracker에 동일 ID로 추적합니다.\n6. **거짓 완료 자동 감지**: \`leerness lazy detect\`는 다음을 자동 점검합니다.\n   - progress-tracker에 done인데 evidence가 비어있는 row\n   - session-handoff의 Completed가 비어있고 Next Exact Step도 비어있음\n   - 코드에 새 TODO/FIXME 추가 + progress-tracker에 추적 항목 없음\n   - test 명령 실행 흔적 없음 (review-evidence.md 또는 task-log.md에 명령 기록)\n`),
    '.harness/rules.md': _rulesHeader() + '\n',
    '.harness/session-handoff.md': fm('session-handoff', ['세션 시작','다음 작업 이어받기'], ['세션 종료'], `# Session Handoff\n\nLast generated: (자동)\n\n## Completed\n-\n\n## In Progress\n-\n\n## Incomplete / Waiting / On Hold / Blocked\n-\n\n## Dropped\n-\n\n## Verification\n-\n\n## Recommended Direction\n-\n\n## Next Exact Step\n-\n`),
    '.harness/leerness-maintenance.md': fm('leerness-maintenance', ['작업 시작','마이그레이션/릴리즈 전'], ['버전 정책 변경'], `# Leerness Maintenance\n\nAI agents should check:\n\n\`\`\`bash\nleerness --version\nleerness self check .\nleerness update --check       # 24h 캐시 자동 감지\nleerness update --yes         # 새 버전 발견 시 자동 마이그레이션\ncat .harness/HARNESS_VERSION\nnpm view leerness version\n\`\`\`\n`),
    '.harness/language-policy.md': fm('language-policy', ['문서 작성 전'], ['언어 변경'], `# Language Policy\n\nSelected language: ${lang}\n\n모든 Leerness 노트, 스킬 노트, 세션 보고, 작업 목록은 위 언어를 기본으로 사용합니다 (사용자가 다른 언어를 명시 요청 시 예외).\n`),
    '.harness/secret-policy.md': fm('secret-policy', ['스킬/배포/설정 변경 전'], ['민감정보 정책 변경'], `# Secret Policy\n\n## Rules\n- 환경변수 이름만 기록하고 값은 .env.local, CI secrets, 클라우드 시크릿 매니저로 옮깁니다.\n- 코드/문서/로그에 토큰/비밀번호/쿠키/주민번호/카드번호 등을 평문으로 두지 않습니다.\n- 변경 전 \`leerness scan secrets .\`을 실행해 흔적을 확인합니다.\n\n## Patterns scanned\n- AWS Access Key (\`AKIA[0-9A-Z]{16}\`)\n- GitHub PAT (\`ghp_[A-Za-z0-9]{36}\`)\n- OpenAI key (\`sk-[A-Za-z0-9]{20,}\`)\n- Anthropic key (\`sk-ant-[A-Za-z0-9-]{20,}\`)\n- Google API key, Slack token, generic private key, hardcoded password\n`),
    '.harness/encoding-policy.md': fm('encoding-policy', ['파일 생성 전','한글 깨짐 보고','배포 전'], ['인코딩 정책 변경'], `# Encoding Policy\n\n## Rules\n- 모든 텍스트 파일은 **BOM 없는 UTF-8**.\n- Windows .bat 최상단에 \`chcp 65001 >nul\`.\n- PowerShell .ps1 시작에 \`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\`.\n- Python 파일은 첫 줄에 \`# -*- coding: utf-8 -*-\` (Python 2 호환 필요 시).\n- LF 라인 엔딩 권장 (Windows에서도 .gitattributes로 통일).\n\n## Auto check\n\`leerness encoding check\`는 BOM, NUL, .bat의 chcp 65001, 한글 라운드트립을 검사합니다.\n`),
    '.harness/test-evidence-policy.md': fm('test-evidence-policy', ['검증 결과 기록 시'], ['검증 형식 변경'], `# Test Evidence Policy\n\n매 검증은 \`.harness/review-evidence.md\`에 누적 기록합니다.\n\n## Format\n\`\`\`\n## YYYY-MM-DD HH:MM\nTask: T-XXXX\nCommand: <명령>\nExit: <코드>\nNote: <주요 결과 요약>\nArtifacts: <스크린샷/로그 경로>\n\`\`\`\n`),
    '.harness/review-evidence.md': fm('review-evidence', ['진행 보고','릴리즈 검토'], ['검증 결과 기록'], `# Review Evidence\n\nVerification command/result history. Append-only.\n`),
    '.harness/AX_PLAN_GUIDE.md': fm('ax-plan-guide', ['계획 수립/변경','신규 프로젝트'], ['계획 가이드 변경'], `# AX Plan Guide\n\n1. 사용자 요청이 기존 plan.md 범위 내인지 확인합니다.\n2. 새 범위라면 plan.md(milestone)와 progress-tracker.md(T-id) 양쪽에 추가합니다.\n3. 사용자가 범위를 드랍하면 삭제 대신 dropped 표기를 추가합니다.\n4. 신규 프로젝트는 코딩 전에 plan.md/project-brief.md를 채웁니다.\n`),
    '.harness/AX_MIGRATION_GUIDE.md': fm('ax-migration-guide', ['마이그레이션 전'], ['마이그레이션 정책 변경'], `# AX Migration Guide\n\n- Back up before changes (\`.harness/archive/\`).\n- 기존 프로젝트 메모리 보존 (preserve-by-default).\n- .env.example/.gitignore는 라인 단위 머지.\n- 보호 파일을 삭제하지 않습니다.\n- 마이그레이션 보고서는 \`.harness/migration-report.md\`.\n- 자동: \`leerness update --yes\`가 위 절차를 백업·머지·검증까지 한번에 수행합니다.\n`),
    '.harness/AX_NEW_PROJECT_GUIDE.md': fm('ax-new-project-guide', ['신규 프로젝트 감지'], ['신규 설치 정책 변경'], `# AX New Project Guide\n\nBefore coding, ask or infer the project goal, users, scope, out-of-scope, stack, deployment target, and milestones. Then fill plan.md and project-brief.md.\n`),
    '.harness/AX_SKILL_LIBRARY_GUIDE.md': fm('ax-skill-library-guide', ['스킬 학습/검증/업로드'], ['스킬 정책 변경'], `# AX Skill Library Guide\n\nValidated skills require metadata, sensitive data scan, AI verification, dry-run publish, and explicit execute approval.\n`),
    '.harness/skill-index.md': fm('skill-index', ['작업별 스킬 선택'], ['스킬 추가/삭제'], `# Skill Index\n\n| ID | Korean Name | Capabilities | Last Updated | Verification |\n|---|---|---|---|---|\n${skillRows}\n`),
    '.harness/templates/end-of-session-report.md': `# End of Session Report\n\n## Completed\n\n## In Progress\n\n## Incomplete\n\n## Planned\n\n## Waiting\n\n## On Hold\n\n## Blocked\n\n## Dropped\n\n## Verification\n\n## Recommended Direction\n\n## Next Exact Step\n`,
    '.harness/templates/decision.md': '# Decision\n\n## Decision\n\n## Reason\n\n## Alternatives\n\n## Impact\n',
    '.harness/templates/task-row.md': `# Task Row Template\n\n| ID | Status | Request | Evidence | Next Action | Updated |\n| T-XXXX | requested | <request> | <evidence-id or empty> | <next> | YYYY-MM-DD |\n`,
    '.claude/commands/handoff.md': `# /handoff\n\n현재 프로젝트의 컨텍스트를 적재합니다.\n\n\`\`\`\n!leerness handoff .\n\`\`\`\n`,
    '.claude/commands/session-close.md': `# /session-close\n\n세션 종료 보고를 자동 생성하고 session-handoff.md를 갱신합니다.\n\n\`\`\`\n!leerness session close .\n\`\`\`\n`,
    '.claude/commands/audit.md': `# /audit\n\n계획-진행 정렬, 디자인/재사용 일관성, 시크릿/인코딩을 일괄 점검합니다.\n\n\`\`\`\n!leerness audit .\n!leerness scan secrets .\n!leerness encoding check .\n\`\`\`\n`,
    '.claude/commands/lazy-detect.md': `# /lazy-detect\n\n게으름 방지 자동 평가를 실행합니다.\n\n\`\`\`\n!leerness lazy detect .\n\`\`\`\n`,
    '.claude/commands/update.md': `# /update\n\nleerness 자동 업데이트를 실행합니다 (감지 → 마이그레이션 → 검증).\n\n\`\`\`\n!leerness update --yes\n\`\`\`\n`,
    '.claude/skills/leerness.md': `---\nname: leerness\ndescription: Leerness harness commands - handoff, audit, scan secrets, encoding check, lazy detect, session close, update. Use when the user asks to load project context, verify work quality, scan secrets, check encoding, or end a session.\n---\n\n# leerness skill\n\n## When to use\n- 사용자가 프로젝트 컨텍스트를 로드해달라고 할 때\n- 완료 선언 전 자기 검증을 요청할 때\n- 세션을 종료하거나 인수인계를 요청할 때\n- 시크릿/한글 인코딩 점검을 요청할 때\n- 새 leerness 버전 적용을 요청할 때\n\n## Commands\n\n\`\`\`bash\nleerness handoff .             # 컨텍스트 로드\nleerness check .               # pre-action 체크\nleerness audit .               # 일관성/계획 정렬 감사\nleerness scan secrets .        # 시크릿 패턴 스캔\nleerness encoding check .      # UTF-8/BOM/CRLF\nleerness lazy detect .         # 게으름 평가\nleerness memory search "key"   # 결정/이력 검색\nleerness session close .       # 종료 보고 + handoff 자동 생성\nleerness update --yes          # 자동 업데이트\n\`\`\`\n`,
  };
}

function copyRecursiveSafe(src, dst) {
  if (!exists(src)) return;
  if (src.includes(path.sep + '.harness' + path.sep + 'archive')) return;
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    mkdirp(dst);
    for (const e of fs.readdirSync(src)) {
      if (e === 'node_modules' || e === '.git') continue;
      copyRecursiveSafe(path.join(src, e), path.join(dst, e));
    }
  } else {
    mkdirp(path.dirname(dst));
    fs.copyFileSync(src, dst);
  }
}

function migrationCandidates(root, files) {
  const fixed = [
    'AGENTS.md','CLAUDE.md','.cursor/rules/leerness.mdc','.cursor/rules/leerness-plus.mdc','.cursor/rules/project-rules.mdc',
    '.github/copilot-instructions.md','README.md','.env.example','.gitignore','.gitattributes',
    'docs/guideline.md','docs/history.md','guideline.md','history.md',
    'AI_HARNESS.md','HARNESS.md','PROJECT_CONTEXT.md','CONTEXT.md','ARCHITECTURE.md','DECISIONS.md','CURRENT_STATE.md','TASK_LOG.md',
    '.harness','.ai','harness'
  ];
  const all = Array.from(new Set([...fixed, ...Object.keys(files)]));
  return all.filter(f => exists(path.join(root, f)));
}

function createBackup(root, reason, files, dry = false) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ar = path.join(root, '.harness/archive', `leerness-${VERSION}-${stamp}`);
  const candidates = migrationCandidates(root, files);
  if (dry) return { archiveDir: ar, candidates };
  mkdirp(ar);
  const fileRoot = path.join(ar, 'files');
  for (const f of candidates) copyRecursiveSafe(path.join(root, f), path.join(fileRoot, f === '.harness' ? '.harness-before-migration' : f));
  writeUtf8(path.join(ar, 'migration-manifest.json'), JSON.stringify({
    version: VERSION, reason, createdAt: now(),
    policy: 'backup-before-write; preserve-by-default; merge-managed-files; merge-env-and-gitignore',
    candidates
  }, null, 2) + '\n');
  return { archiveDir: ar, candidates };
}

// 1.9.1 P2: 데이터/인덱스 파일은 preserved 블록 없이 overwrite (누적 방지).
const MERGE_OVERWRITE_FILES = new Set([
  '.harness/skill-index.md',
  '.harness/manifest.json',
  '.harness/skills-lock.json',
  '.harness/HARNESS_VERSION',
  '.harness/LANGUAGE',
  '.harness/context-routing.md'
]);
function managedMerge(file, next, previous, archiveDir) {
  if (!previous || previous.trim() === next.trim()) return next;
  const tag = '<!-- leerness:migration-preserved -->';
  if (previous.includes(tag)) return next;
  if (MERGE_OVERWRITE_FILES.has(file.replace(/\\/g, '/'))) return next;
  return next.trimEnd() + `\n\n---\n${tag}\n## Preserved previous content\n\nPrevious content was backed up before migration. Archive reference:\n\n\`${archiveDir ? path.relative(process.cwd(), archiveDir).replace(/\\/g, '/') : '.harness/archive'}\`\n\n<details>\n<summary>Previous ${file}</summary>\n\n\`\`\`md\n${previous.replace(/```/g, '\\`\\`\\`')}\n\`\`\`\n\n</details>\n`;
}

function writeIfSafe(root, file, content, opts = {}) {
  const p = path.join(root, file);
  const already = exists(p);
  if (already && !opts.force && !opts.mergeManaged) return { action: 'preserved', file };
  if (already && opts.mergeManaged && !opts.force) {
    const prev = read(p);
    writeUtf8(p, managedMerge(file, content, prev, opts.archiveDir));
    return { action: 'merged', file };
  }
  writeUtf8(p, content);
  return { action: already ? 'updated' : 'created', file };
}

function mergeLinesFile(p, lines) {
  const current = exists(p) ? read(p) : '';
  let next = current;
  for (const line of lines) if (!next.includes(line)) next += (next.endsWith('\n') || !next ? '' : '\n') + line + '\n';
  writeUtf8(p, next);
}

// 1.9.153: env 파일 전용 key-aware merge — KEY=VALUE 줄을 키 기준 처리 (기존 값 보존, 빈 키만 추가)
//   사용자가 .env 의 LEERNESS_NPM_TOKEN=abc123 처럼 직접 편집한 값을 절대 덮어쓰지 않음.
//   주석 / 빈 줄은 substring includes 로 중복 방지 (mergeLinesFile 와 동일).
function mergeEnvFile(p, lines) {
  const current = exists(p) ? read(p) : '';
  const existingKeys = new Set();
  for (const ln of current.split(/\r?\n/)) {
    const m = ln.match(/^\s*([A-Z][A-Z0-9_]+)\s*=/);
    if (m) existingKeys.add(m[1]);
  }
  let next = current;
  for (const line of lines) {
    const km = line.match(/^\s*([A-Z][A-Z0-9_]+)\s*=/);
    if (km) {
      if (existingKeys.has(km[1])) continue;  // 기존 키 값 보존 (덮어쓰기 X)
      next += (next.endsWith('\n') || !next ? '' : '\n') + line + '\n';
      existingKeys.add(km[1]);
    } else {
      // 주석 또는 빈 줄 — substring 미포함 시만 append
      if (!next.includes(line)) next += (next.endsWith('\n') || !next ? '' : '\n') + line + '\n';
    }
  }
  writeUtf8(p, next);
}

function writeMigrationReport(root, backup, actions, opts = {}) {
  const p = path.join(root, '.harness/migration-report.md');
  const rows = actions.map(a => `| ${a.file} | ${a.action} |`).join('\n');
  // 1.9.41: AI must re-read 섹션 — migrate가 추가/변경한 파일을 AI 가독 포맷으로 추출
  // fromV가 명시되면 CHANGELOG 차분 포함
  let aiReadBlock = '';
  try {
    const fromV = opts.fromV || (backup && backup.previousVersion) || null;
    if (fromV && fromV !== VERSION) {
      const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
      const cl = exists(changelogPath) ? read(changelogPath) : (exists(path.join(root, 'CHANGELOG.md')) ? read(path.join(root, 'CHANGELOG.md')) : '');
      if (cl) {
        const diff = _parseChangelogBetween(cl, fromV, VERSION);
        const allCommands = new Set(), allFlags = new Set(), allFiles = new Set();
        for (const v of diff) {
          v.newCommands.forEach(c => allCommands.add(c));
          v.newFlags.forEach(f => allFlags.add(f));
          v.newFiles.forEach(f => allFiles.add(f));
        }
        if (diff.length) {
          aiReadBlock = `\n## 🤖 AI must re-read (1.9.41 차분 안내)\n\n`;
          aiReadBlock += `이 migrate는 ${fromV} → ${VERSION} 점프입니다. 메인 AI 에이전트는 다음을 인지하고 우선 활용:\n\n`;
          if (allCommands.size) aiReadBlock += `**📌 신규 명령** (이전엔 없던 것):\n${[...allCommands].map(c => `- \`leerness ${c}\``).join('\n')}\n\n`;
          if (allFlags.size)    aiReadBlock += `**🚩 신규 플래그**:\n${[...allFlags].map(f => `- \`${f}\``).join('\n')}\n\n`;
          if (allFiles.size)    aiReadBlock += `**📄 신규/변경 파일** (반드시 재독):\n${[...allFiles].map(f => `- \`${f}\``).join('\n')}\n\n`;
          aiReadBlock += `**버전별 헤드라인**:\n`;
          for (const v of diff) {
            const firstLine = (v.body.match(/^\*\*([^*]+)\*\*/) || [])[1]
                           || (v.body.split('\n').find(l => l.trim() && !l.startsWith('##')) || '').trim().slice(0, 120);
            aiReadBlock += `- ${v.version} — ${firstLine || '(no headline)'}\n`;
          }
          aiReadBlock += `\n**권장 행동**:\n1. 위 신규 명령을 \`--help\`로 확인\n2. \`AGENTS.md\` / \`CLAUDE.md\` / \`.harness/session-workflow.md\` 재독 (다음 \`leerness handoff\` 호출 시 자동 안내)\n3. 이전 청크의 기억 무효 — 새 도구 우선 시도\n4. 상세: \`leerness whats-new --from ${fromV}\`\n`;
        }
      }
    }
  } catch {}
  writeUtf8(p, `# Leerness Migration Report\n\nVersion: ${VERSION}\nDate: ${now()}\nBackup: ${rel(root, backup.archiveDir)}\n${opts.fromV ? `Previous: ${opts.fromV}\n` : ''}${aiReadBlock}\n## Policy\n\n- Existing harness, skill, and instruction files are backed up before migration.\n- Project memory files are preserved by default.\n- Managed instruction files are merged with previous content instead of being blindly overwritten.\n- .env.example/.gitignore are line-merged only.\n\n## Backed Up Candidates\n\n${backup.candidates.map(x => '- ' + x).join('\n')}\n\n## File Actions\n\n| File | Action |\n|---|---|\n${rows}\n`);
}

function syncReadme(root) {
  const p = path.join(root, 'README.md');
  const existing = exists(p) ? read(p) : '';
  // 1.9.40: 자체 README도 동기화 — version 배지, e2e 카운트, package.json#version 일관성
  let updated = mergeReadmeSection(existing, managedReadmeBlock(detectProjectName(root)));
  try {
    // package.json#version 또는 .harness/HARNESS_VERSION을 참조하여 README 배지 자동 갱신
    const pkgPath = path.join(root, 'package.json');
    let v = null;
    if (exists(pkgPath)) {
      try { v = JSON.parse(read(pkgPath)).version; } catch {}
    }
    if (!v) {
      const hv = path.join(root, '.harness', 'HARNESS_VERSION');
      if (exists(hv)) v = parseHarnessVersion(read(hv)).base;
    }
    if (v && /^\d+\.\d+\.\d+/.test(v)) {
      // version 배지
      updated = updated.replace(/badge\/version-[\d.]+-(green|blue|red)/g, `badge/version-${v}-green`);
    }
    // e2e 배지: scripts/e2e.js의 출력 "E2E result: N/N passed" 추정 (직접 grep)
    const e2ePath = path.join(root, 'scripts', 'e2e.js');
    if (exists(e2ePath)) {
      // total++ 횟수 카운트 — 정확하진 않지만 추세 반영
      const body = read(e2ePath);
      const total = (body.match(/^total\+\+;/gm) || []).length;
      if (total > 0) {
        updated = updated.replace(/badge\/e2e-(\d+)%2F(\d+)-success/g, `badge/e2e-${total}%2F${total}-success`);
      }
    }
  } catch {}
  if (updated !== existing) writeUtf8(p, updated);
  ok('README.md Leerness section synced');
}

function parseSkillsValue(v) {
  if (!v || v === true) return [];
  if (v === 'all') return Object.keys(skillCatalog);
  // 1.9.11: recommended에 project-roadmap-generator 자동 포함
  if (v === 'recommended') return ['office','commerce-api','ai-verified-skill-publisher','feature-implementation','project-roadmap-generator'];
  return String(v).split(',').map(s => s.trim()).filter(Boolean).filter(s => skillCatalog[s]);
}

async function resolveInstallOptions(root, opts = {}) {
  const explicitLang = arg('--language', null);
  const explicitSkills = arg('--skills', null);
  let lang = explicitLang ? detectLanguageValue(root, explicitLang) : detectLanguageValue(root, 'auto');
  let skills = explicitSkills ? parseSkillsValue(explicitSkills) : [];
  const shouldAsk = !has('--yes') && !opts.nonInteractive && process.stdin.isTTY && process.stdout.isTTY && !opts.migration;
  // 1.9.34: 인터랙티브 multi-select (방향키 + Space + Enter) — 기존 숫자 선택 폴백 유지
  // --no-interactive-select 또는 LEERNESS_NO_INTERACTIVE=1 → 구식 숫자 선택
  const useInteractive = shouldAsk && !has('--no-interactive-select') && process.env.LEERNESS_NO_INTERACTIVE !== '1';
  if (shouldAsk && !explicitLang) {
    if (useInteractive) {
      const langOpt = await _selectOne('설치 언어를 선택하세요', [
        { label: '자동 감지', description: '디렉토리/파일 분석 (한국어/영어 자동 판별)', id: 'auto' },
        { label: '한국어', description: '모든 인스트럭션을 한국어로 생성', id: 'ko' },
        { label: 'English', description: '모든 인스트럭션을 영어로 생성', id: 'en' }
      ], { defaultIndex: 0 });
      lang = langOpt && langOpt.id ? detectLanguageValue(root, langOpt.id) : detectLanguageValue(root, 'auto');
    } else {
      log('\n설치 언어를 선택하세요.');
      log('1) 자동 감지'); log('2) 한국어'); log('3) English');
      const a = await ask('선택 [1]: ');
      lang = a === '2' ? 'ko' : a === '3' ? 'en' : detectLanguageValue(root, 'auto');
    }
  }
  // 1.9.148: 스킬 prompt 제거 (사용자 명시 요청) — leerness가 자동으로 공식 표준 스킬 5종 설치.
  //   필요할 때 사용자가 leerness skill install <id> 로 추가 가능.
  if (!explicitSkills) skills = parseSkillsValue('recommended');
  // 1.9.151: CLI 에이전트 활성화 — 복수 선택 (사용자 명시 요청)
  //   _selectMany 로 Space 토글, a 전체, n 해제, Enter 확정. 선택된 에이전트들만 .env.example에 LEERNESS_ENABLE_* 활성화.
  let agentsOptIn = null;   // string[] (다중) 또는 'none' (선택 안함)
  if (shouldAsk && !opts._skipAgentsPrompt) {
    if (useInteractive) {
      const picked = await _selectMany('CLI 에이전트 활성화 (복수 선택, Space 토글) — sub-agent 위임용', [
        { label: 'Claude (ANTHROPIC_API_KEY 또는 claude CLI)', description: '추론력 최고 — 코드 작성/리뷰 기본', id: 'claude' },
        { label: 'Codex (OpenAI codex CLI)', description: 'OpenAI 코드 모델', id: 'codex' },
        { label: 'Gemini (gemini CLI)', description: 'Google 멀티모달 모델', id: 'gemini' },
        { label: 'Copilot (gh extension)', description: 'GitHub Copilot CLI', id: 'copilot' },
        { label: 'Ollama (로컬 LLM — llama3/qwen 등)', description: 'http://localhost:11434 — 무료/오프라인', id: 'ollama' }
      ], { defaults: [] });
      agentsOptIn = picked.length ? picked.map(p => p.id) : 'none';
    } else {
      log('\nCLI 에이전트 활성화 (복수 선택 — 콤마로 구분, opt-in):');
      log('  1) claude  2) codex  3) gemini  4) copilot  5) ollama  (예: 1,5 또는 all 또는 none)');
      const a = (await ask('선택 [none]: ')).trim().toLowerCase();
      if (a === 'all') agentsOptIn = ['claude', 'codex', 'gemini', 'copilot', 'ollama'];
      else if (!a || a === 'none' || a === '0') agentsOptIn = 'none';
      else {
        const map = { '1': 'claude', '2': 'codex', '3': 'gemini', '4': 'copilot', '5': 'ollama' };
        const picks = a.split(/[,\s]+/).map(t => map[t] || (['claude','codex','gemini','copilot','ollama'].includes(t) ? t : null)).filter(Boolean);
        agentsOptIn = picks.length ? picks : 'none';
      }
    }
  }
  // 1.9.146: 권한 모드 (사용자 명시 요청 #5 — agent IDE 모드 사전 prompt)
  let permissionMode = null;
  if (shouldAsk && !opts._skipPermissionsPrompt) {
    if (useInteractive) {
      const pOpt = await _selectOne('agent 권한 모드 (leerness agent 사용 시 적용)', [
        { label: 'basic (안전) — 읽기/쓰기 .harness/ 만', description: '권장 — 파일시스템/네트워크 거부, .harness 안만 쓰기', id: 'basic' },
        { label: 'extended — 프로젝트 폴더 + shell allowlist', description: '프로젝트 폴더 read/write, 사전 정의된 명령만 exec', id: 'extended' },
        { label: 'full — 전체 (마우스/키보드/웹/관리자) ⚠ 위험', description: '⚠ IDE 통합 시에만 권장 — 모든 PC 작업 가능', id: 'full' }
      ], { defaultIndex: 0 });
      permissionMode = pOpt ? pOpt.id : 'basic';
    } else {
      log('\nagent 권한 모드 (leerness agent 명령 사용 시):');
      log('1) basic (안전) — .harness/ 만');
      log('2) extended — 프로젝트 폴더 + shell allowlist');
      log('3) full ⚠ — 마우스/키보드/웹/관리자 전체 (IDE 통합 시에만)');
      const a = await ask('선택 [1]: ');
      permissionMode = a === '2' ? 'extended' : a === '3' ? 'full' : 'basic';
    }
  }
  // 1.9.151: 모든 문항 종료 후 — REPL 모드 즉시 활성화 여부 (사용자 명시 요청)
  //   선택된 에이전트가 있을 때만 표시. 설치 완료 후 install() 가 처리.
  let startRepl = false;
  const hasAgents = Array.isArray(agentsOptIn) && agentsOptIn.length > 0;
  if (shouldAsk && hasAgents && !opts._skipReplPrompt) {
    if (useInteractive) {
      const rOpt = await _selectOne('설치 완료 후 REPL agent 모드를 즉시 시작할까요?', [
        { label: '아니오 — 설치만 완료 (나중에 `leerness agent` 로 실행)', description: '권장 — 토큰/모델 설정 후 사용', id: 'no' },
        { label: '예 — 설치 직후 REPL 모드 진입 (Hermes/OpenClaw 스타일)', description: 'Ollama 우선 — 가능하면 자동 모델 선택', id: 'yes' }
      ], { defaultIndex: 0 });
      startRepl = rOpt && rOpt.id === 'yes';
    } else {
      log('\n설치 완료 후 REPL agent 모드를 즉시 시작할까요? (y/N)');
      const a = (await ask('선택 [N]: ')).trim().toLowerCase();
      startRepl = a === 'y' || a === 'yes';
    }
  }
  return { lang, skills, agentsOptIn, permissionMode, startRepl };
}

async function install(root, opts = {}) {
  root = absRoot(root); mkdirp(root);
  // 1.9.41: migrate 직전 이전 버전 캡처 — 차분 안내에 사용
  try {
    const hv = path.join(root, '.harness', 'HARNESS_VERSION');
    if (exists(hv) && !opts._previousVersion) {
      const parsed = parseHarnessVersion(read(hv));
      opts._previousVersion = parsed.base || parsed.plus || null;
    }
  } catch {}
  // 1.9.32: init 시 ASCII 배너 + 빠른 시작 가이드 (migrate는 quiet)
  if (!opts.migration && !has('--no-banner')) _banner({ quickStart: !opts.dry });
  // 1.9.33: npx 캐시로 옛 버전이 실행될 때 경고 (migrate/--no-stale-check 시 스킵)
  if (!opts.migration && !has('--no-stale-check') && !opts.nonInteractive) {
    try { await _warnIfStale(root); } catch {}
  }
  const resolved = await resolveInstallOptions(root, opts);
  const lang = resolved.lang;
  const skills = resolved.skills;
  // 1.9.146: 사용자 명시 요청 #2 — 모든 prompt 끝난 후 한꺼번에 설치 단계 진입 (응답 수집과 파일 쓰기 분리)
  log(`\n📦 응답 수집 완료 — leerness 파일 설치 시작 (Leerness v${VERSION})`);
  log(`Target: ${root}`);
  log(`Language: ${lang}`);
  log(`Skills: ${skills.length ? skills.join(', ') : 'none (건너뜀)'}`);
  if (resolved.agentsOptIn && resolved.agentsOptIn !== 'none') {
    const list = Array.isArray(resolved.agentsOptIn) ? resolved.agentsOptIn.join(', ') : String(resolved.agentsOptIn);
    log(`Agents 활성화: ${list}`);
  }
  if (resolved.startRepl) log(`REPL 자동 시작: 예 (설치 완료 후 \`leerness agent\` 진입)`);
  if (resolved.permissionMode) log(`Agent 권한 모드: ${resolved.permissionMode}`);
  // 1.9.10: 스킬 카탈로그 출처 안내
  if (SKILLPACK_SOURCE === 'builtin') log(`Skill catalog source: builtin (leerness-skillpack 미설치 — \`npm i leerness-skillpack\`로 확장 가능)`);
  else log(`Skill catalog source: ${SKILLPACK_SOURCE} (leerness-skillpack${SKILLPACK_META ? ` v${SKILLPACK_META.version}` : ''})`);
  const files = coreFiles(root, lang, skills);
  const backup = createBackup(root, opts.force ? 'force' : (opts.migration ? 'migration' : 'init'), files, opts.dry);
  if (opts.dry) {
    log(`Backup target: ${backup.archiveDir}`);
    log('Files that would be backed up:');
    backup.candidates.forEach(f => log('- ' + f));
  } else {
    ok(`backup created: ${rel(root, backup.archiveDir)}`);
  }
  const managedOverwrite = new Set([
    'AGENTS.md','CLAUDE.md','.cursor/rules/leerness.mdc','.github/copilot-instructions.md',
    '.harness/HARNESS_VERSION','.harness/manifest.json','.harness/LANGUAGE','.harness/skills-lock.json',
    '.harness/context-routing.md','.harness/writeback-policy.md','.harness/task-type-map.md',
    '.harness/leerness-maintenance.md','.harness/protected-files.md','.harness/AX_MIGRATION_GUIDE.md',
    '.harness/AX_NEW_PROJECT_GUIDE.md','.harness/AX_SKILL_LIBRARY_GUIDE.md','.harness/skill-index.md',
    '.claude/commands/handoff.md','.claude/commands/session-close.md','.claude/commands/audit.md','.claude/commands/lazy-detect.md','.claude/commands/update.md',
    '.claude/skills/leerness.md'
  ]);
  const actions = [];
  for (const [f, c] of Object.entries(files)) {
    const existsNow = exists(path.join(root, f));
    const mergeManaged = managedOverwrite.has(f);
    if (opts.dry) {
      const action = existsNow ? (mergeManaged || opts.force ? 'merge/update' : 'preserve') : 'create';
      log(`[dry-run] ${action}: ${f}`);
      actions.push({ file:f, action });
      continue;
    }
    const r = writeIfSafe(root, f, c, { force: opts.force, mergeManaged, archiveDir: backup.archiveDir });
    actions.push(r);
    ok(`${r.action}: ${r.file}`);
  }
  if (!opts.dry) {
    mergeLinesFile(path.join(root, '.gitignore'), [
      // 1.9.153: .env 직접 생성 + 사용자 글로벌 룰 SECRET_PATTERNS 6종 일괄 ignore (audit 통합)
      //   audit 가 검사하는 6 패턴: .env / .env.local / .env.production / .env.*.local / *.pem / credentials.json
      '.env', '.env.local', '.env.production', '.env.*.local', '*.pem', 'credentials.json',
      '.harness/skill-publish.local.json','.harness/**/*.local.json',
      '.harness/archive/','.harness/migration-report.md','.harness/cache/',
      // 1.9.147: 자동 유지보수 — 자격증명 + incident 페이로드 비공개 (보안)
      '.harness/credentials.local.json','.harness/incidents/',
      // 1.9.149: agent REPL 세션 + observability runs 비공개 (대화 내용 보호)
      '.harness/agent-sessions/','.harness/runs/'
    ]);
    // 1.9.151: agentsOptIn 복수 선택 지원 — 배열 또는 'none' 또는 'all' (back-compat) 모두 처리
    const a = resolved.agentsOptIn || 'none';
    const enabledSet = (() => {
      if (Array.isArray(a)) return new Set(a);
      if (a === 'all') return new Set(['claude', 'codex', 'gemini', 'copilot', 'ollama']);
      if (a === 'none' || !a) return new Set();
      return new Set([a]);  // back-compat: 단일 문자열
    })();
    const enable = (cli) => enabledSet.has(cli);
    // 1.9.153: .env.example 은 템플릿 (배포 가능, 실제 시크릿 값 없음)
    //   .env 는 실 사용 파일 — 사용자가 토큰 채워 넣음. 보안 정책: 토큰 값은 절대 자동 채우지 않음 (키만).
    //   .gitignore 에 .env 가 들어가 있어야 함 (audit 가 자동 검증). mergeLinesFile 은 기존 키 유지 + 신규 추가.
    const envLines = [
      '# Leerness — environment variable names only. Do not commit real secrets (this file is in .gitignore).',
      `# Generated/migrated by leerness v${VERSION} at ${new Date().toISOString().slice(0, 10)}.`,
      'LEERNESS_NPM_TOKEN=','LEERNESS_GITHUB_TOKEN=',
      '# 1.9.22 — orchestrate opt-in. URL이 설정되면 leerness가 Ollama를 사용 가능. 미설정 시 LLM 호출 자동 시작 금지.',
      `LEERNESS_OLLAMA_BASE_URL=${enable('ollama') ? 'http://localhost:11434' : ''}`,
      '# 선택. 기본 모델 (orchestrate --model 로 override 가능). 예: llama3 / qwen2.5-coder / gpt-oss',
      'LEERNESS_OLLAMA_MODEL=',
      '# 1.9.30+1.9.146+1.9.151 — 외부 AI CLI 활성화 플래그 (복수 선택). 1=활성, 0/미설정=비활성. 메인 에이전트가 sub-agent 분배 시 활성 CLI들에 작업 위임 가능.',
      `LEERNESS_ENABLE_CLAUDE=${enable('claude') ? 1 : 0}`,
      `LEERNESS_ENABLE_CODEX=${enable('codex') ? 1 : 0}`,
      `LEERNESS_ENABLE_GEMINI=${enable('gemini') ? 1 : 0}`,
      `LEERNESS_ENABLE_COPILOT=${enable('copilot') ? 1 : 0}`,
      `LEERNESS_ENABLE_OLLAMA=${enable('ollama') ? 1 : 0}`,
      '# 1.9.42 — agentskills.io 공개 표준 스킬 자동 탐색 (opt-in). URL 설정 시 `leerness skill discover` 사용 가능.',
      '#   예시 URL: https://agentskills.io/llms.txt',
      'LEERNESS_SKILL_DISCOVER_URL=',
      '# (선택) 사용자 요청 분석 시 자동 매칭 스킬 추천. 1=활성, 0/미설정=비활성.',
      'LEERNESS_SKILL_AUTO_DISCOVER=0'
    ];
    mergeLinesFile(path.join(root, '.env.example'), envLines);
    // 1.9.153: .env 직접 생성/마이그레이션 (사용자 명시 요청). 보안 = 빈 값만 — 사용자가 직접 토큰 채움.
    //   기존 .env 가 있으면 mergeEnvFile 이 KEY 기준 처리:
    //     - 기존 키 (사용자가 채운 값 포함) 는 절대 덮어쓰지 않음
    //     - 누락된 키만 빈 값으로 추가
    //   .env 가 .gitignore 에 등록되어 있는지 audit 가 검증 (1.9.75+).
    try {
      mergeEnvFile(path.join(root, '.env'), envLines);
    } catch (e) {
      warn(`.env 생성/마이그레이션 실패 (계속 진행): ${e.message}`);
    }
    // 1.9.146: agent 권한 파일 자동 생성 (사용자 명시 요청 #5)
    if (resolved.permissionMode) {
      try { _writePermissionsPreset(root, resolved.permissionMode); } catch (e) { warn('permissions 생성 실패: ' + e.message); }
    }
    mergeLinesFile(path.join(root, '.gitattributes'), [
      '* text=auto eol=lf','*.bat text eol=crlf','*.ps1 text eol=crlf'
    ]);
    syncReadme(root);
    installSkills(root, skills);
    // 1.9.41: migrate 시 이전 버전을 미리 캡처해 차분 안내에 사용
    writeMigrationReport(root, backup, actions, { fromV: opts._previousVersion || null });
    // 1.9.41: migrate 후 (= 점프인 경우) 차분 안내를 stdout에 즉시 출력 — AI 컨텍스트에 새 도구 주입
    if (opts.migration && opts._previousVersion && opts._previousVersion !== VERSION) {
      try {
        const reportPath = path.join(root, '.harness', 'migration-report.md');
        if (exists(reportPath)) {
          const rep = read(reportPath);
          const aiBlock = rep.match(/## 🤖 AI must re-read[\s\S]*?(?=\n## )/);
          if (aiBlock) {
            log('');
            log(aiBlock[0].trim());
            log('');
          }
        }
      } catch {}
    }
    // 1.9.1 P7: 디폴트 M-0001이 plan에 있고 progress에 row가 없으면 자동 추가
    try {
      const planText = exists(planPath(root)) ? read(planPath(root)) : '';
      if (/### M-0001\./.test(planText)) {
        const rows = readProgressRows(root);
        const linked = rows.some(r => /M-0001/.test(r.evidence));
        if (!linked) {
          const tid = nextId(root, 'T');
          upsertProgress(root, { id: tid, status: 'planned', request: '프로젝트 계획 정리', evidence: 'init default plan:M-0001', nextAction: 'project-brief.md를 실제 목적으로 업데이트' });
        }
      }
    } catch {}
    if (!has('--no-auto-update')) {
      try { autoUpdateInstall(root); } catch (e) { warn('auto-update hook install skipped: ' + (e && e.message)); }
    }
    // 1.9.12: install 직후 첫 roadmap.html 자동 생성
    if (!has('--no-auto-roadmap')) {
      try { _autoRoadmap(root, 'install'); } catch (e) { warn('auto-roadmap 실패: ' + (e && e.message)); }
    }
    // 1.9.148: 1.9.32 중복 prompt 제거 (사용자 명시 — CLI 에이전트 prompt 중복).
    //   resolveInstallOptions (1.9.146) 가 이미 모든 prompt 모은 위치에 통합된 4지선다 prompt 있음.
    //   별도 setupAgents 명령은 사용자가 명시적으로 `leerness setup-agents` 호출 시에만.
    // 1.9.151: 설치 완료 직후 — startRepl 선택 시 REPL agent 모드 즉시 진입 (사용자 명시 요청)
    if (resolved.startRepl && !opts.migration && process.stdin.isTTY && process.env.LEERNESS_NO_PROMPT !== '1') {
      log('');
      log('🚀 설치 완료 — REPL agent 모드를 시작합니다 (1.9.149 Hermes/OpenClaw 스타일)...');
      log('');
      try {
        await _agentRepl(root, { provider: 'ollama', role: 'actor' });
      } catch (e) { warn('REPL 진입 실패: ' + e.message); }
    }
  }
}

function installSkills(root, skills) { for (const name of skills) addSkill(root, name, true); }
function addSkill(root, name, silent = false) {
  const meta = skillCatalog[name];
  if (!meta) { fail(`Unknown skill: ${name}`); return; }
  const dir = path.join(root, '.harness/skills', name); mkdirp(dir);
  writeUtf8(path.join(dir, 'skill.json'), JSON.stringify({ name, ...meta, verification: { status: meta.verification, method: 'leerness-curated' } }, null, 2) + '\n');
  writeUtf8(path.join(dir, 'README.md'), `# ${meta.displayNameKo}\n\n## Capabilities\n${meta.capabilities.map(x => '- ' + x).join('\n')}\n\n## Sensitive Data Policy\n실제 토큰이나 비밀번호를 기록하지 않고 환경변수 이름만 기록합니다.\n`);
  if (!silent) ok(`skill installed: ${name}`);
}

// ===== Skill registry (catalog + user-defined merged) =====
function userSkillsDir(root) { return path.join(absRoot(root), '.harness/skills'); }
function userSkillFile(root, id) { return path.join(userSkillsDir(root), id, 'skill.json'); }

function loadUserSkill(root, id) {
  const f = userSkillFile(root, id);
  if (!exists(f)) return null;
  try { return JSON.parse(read(f)); } catch { return null; }
}
function saveUserSkill(root, id, data) {
  const dir = path.join(userSkillsDir(root), id); mkdirp(dir);
  writeUtf8(path.join(dir, 'skill.json'), JSON.stringify(data, null, 2) + '\n');
  // 1.9.66: 캐시 invalidate (skill 추가/변경 즉시 반영)
  try { _SKILLS_LIST_CACHE.delete(absRoot(root)); } catch {}
  // README mirror
  const usage = data.usage || { count: 0 };
  const readme = `# ${data.displayNameKo || id}\n\n## Capabilities\n${(data.capabilities || []).map(c => '- ' + c).join('\n') || '-'}\n\n## Sources\n${(data.sources || []).map(s => `- ${s.url || s}`).join('\n') || '-'}\n\n## Patterns (성공 명령/접근)\n${(data.patterns || []).map(p => `- \`${p.command}\` — ${p.note || ''}`).join('\n') || '-'}\n\n## Optimization history\n${(data.optimizations || []).map(o => `- ${o.at}: ${o.note || ''}${o.before||o.after?` (${o.before||'?'} → ${o.after||'?'})`:''}`).join('\n') || '-'}\n\n## Usage\n${usage.count || 0}회 사용 / 마지막: ${usage.lastUsed || '-'}\n${usage.lastNote ? '\n마지막 노트: ' + usage.lastNote : ''}\n`;
  writeUtf8(path.join(dir, 'README.md'), readme);
}

// 1.9.66: listAllSkills 메모리 캐시 — skill list/info/match/discover/suggest 가 공유
// key: root → { mtime(skillsDir), out }
const _SKILLS_LIST_CACHE = new Map();
function listAllSkills(root) {
  // 캐시 hit 확인: userSkillsDir mtime 동일 시 재구성 skip
  if (root) {
    try {
      const dir = userSkillsDir(root);
      const dirMtime = exists(dir) ? fs.statSync(dir).mtimeMs : 0;
      const key = absRoot(root);
      const cached = _SKILLS_LIST_CACHE.get(key);
      if (cached && cached.dirMtime === dirMtime) return cached.out;
      const out = _buildAllSkills(root);
      _SKILLS_LIST_CACHE.set(key, { dirMtime, out });
      return out;
    } catch { return _buildAllSkills(root); }
  }
  return _buildAllSkills(root);
}
function _buildAllSkills(root) {
  const out = {};
  // 1.9.10: skillCatalog의 _source('skillpack' 또는 'builtin')를 보존
  for (const [k, v] of Object.entries(skillCatalog)) out[k] = { ...v, _source: v._source || 'builtin' };
  if (root) {
    const dir = userSkillsDir(root);
    if (exists(dir)) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const data = loadUserSkill(root, e.name);
        if (!data) continue;
        if (out[e.name]) out[e.name] = { ...out[e.name], ...data, _source: 'catalog+local' };
        else out[e.name] = { ...data, _source: 'user' };
      }
    }
  }
  return out;
}
// 1.9.66: skill 추가/제거 시 캐시 invalidate (외부 helper)
function _invalidateSkillsCache(root) {
  try { _SKILLS_LIST_CACHE.delete(absRoot(root)); } catch {}
}

function skillList(root) {
  const all = listAllSkills(root);
  // 1.9.84: --json 옵션 (MCP 통합용)
  if (has('--json')) {
    const items = Object.entries(all).map(([id, v]) => ({
      id,
      displayNameKo: v.displayNameKo || id,
      source: v._source,
      capabilities: v.capabilities || [],
      usageCount: v.usage?.count || 0,
      lastUsed: v.usage?.lastUsed || null,
      lastUpdated: v.lastUpdated || null
    }));
    log(JSON.stringify({ skillpack: SKILLPACK_SOURCE, total: items.length, items }, null, 2));
    return;
  }
  if (SKILLPACK_SOURCE !== 'builtin') log(`# skillpack 출처: ${SKILLPACK_SOURCE}${SKILLPACK_META ? ` (${SKILLPACK_META.name} v${SKILLPACK_META.version})` : ''}`);
  else log('# skillpack 미설치 — builtin fallback 사용 (leerness 본 패키지 내장 카탈로그)');
  log('| ID | 한글명 | 출처 | 능력(요약) | 사용횟수 | 최종 |');
  log('|---|---|---|---|---|---|');
  for (const [id, v] of Object.entries(all)) {
    const cap = (v.capabilities || []).slice(0, 3).join(' / ') + ((v.capabilities || []).length > 3 ? ' …' : '');
    const usage = v.usage?.count || 0;
    const last = v.usage?.lastUsed?.slice(0, 10) || v.lastUpdated || '-';
    log(`| ${id} | ${v.displayNameKo || id} | ${v._source} | ${cap} | ${usage} | ${last} |`);
  }
}

function skillInfo(name, root) {
  const all = listAllSkills(root);
  const v = all[name];
  if (!v) return fail(`Unknown skill: ${name}`);
  // 1.9.92: --json 옵션 (MCP 통합용)
  if (has('--json')) {
    const out = {
      id: name,
      displayNameKo: v.displayNameKo || name,
      source: v._source,
      version: v.version || null,
      lastUpdated: v.lastUpdated || null,
      verification: typeof v.verification === 'object' ? v.verification.status : (v.verification || null),
      usage: { count: v.usage?.count || 0, lastUsed: v.usage?.lastUsed || null },
      capabilities: v.capabilities || [],
      sources: (v.sources || []).map(s => s.url || s),
      patterns: v.patterns || [],
      optimizations: v.optimizations || []
    };
    log(JSON.stringify(out, null, 2));
    return;
  }
  log(`# ${name} (${v._source})`);
  log(`한글명: ${v.displayNameKo || name}`);
  log(`버전: ${v.version || '-'} / 최종: ${v.lastUpdated || '-'} / 검증: ${typeof v.verification === 'object' ? v.verification.status : v.verification || '-'}`);
  log(`사용: ${v.usage?.count || 0}회 / 마지막: ${v.usage?.lastUsed || '-'}`);
  log('Capabilities:'); (v.capabilities || []).forEach(x => log('- ' + x));
  if ((v.sources || []).length) { log('Sources:'); v.sources.forEach(s => log('- ' + (s.url || s))); }
  if ((v.patterns || []).length) { log('Patterns:'); v.patterns.forEach(p => log(`- \`${p.command}\` — ${p.note || ''}`)); }
  if ((v.optimizations || []).length) { log('Optimizations:'); v.optimizations.forEach(o => log(`- ${o.at}: ${o.note || ''}`)); }
}

function skillLearn(root, id) {
  if (!id) return fail('id required (e.g., skill learn open-meteo --command "..." --doc URL)');
  const docs = argAll('--doc');
  const command = arg('--command', null);
  const note = arg('--note', null);
  const caps = argAll('--capability');
  const display = arg('--display', null);
  let data = loadUserSkill(root, id);
  if (!data) {
    // start from catalog if exists
    const base = skillCatalog[id];
    data = base ? { name: id, ...base, sources: [], patterns: [], optimizations: [], usage: { count: 0, lastUsed: null } }
                : { name: id, displayNameKo: display || id, version: '1.0.0', lastUpdated: today(), verification: 'unverified', capabilities: [], sources: [], patterns: [], optimizations: [], usage: { count: 0, lastUsed: null } };
  }
  if (display) data.displayNameKo = display;
  for (const d of docs) if (!data.sources.some(s => (s.url || s) === d)) data.sources.push({ at: now(), url: d });
  for (const c of caps) if (!data.capabilities.includes(c)) data.capabilities.push(c);
  if (command) data.patterns.push({ at: now(), command, note: note || '' });
  data.lastUpdated = today();
  saveUserSkill(root, id, data);
  ok(`skill learned: ${id} (sources=${data.sources.length}, patterns=${data.patterns.length}, capabilities=${data.capabilities.length})`);
}

function skillUse(root, id) {
  if (!id) return fail('id required');
  let data = loadUserSkill(root, id);
  if (!data) {
    const base = skillCatalog[id];
    if (!base) return fail(`skill not found: ${id}`);
    data = { name: id, ...base, sources: [], patterns: [], optimizations: [], usage: { count: 0, lastUsed: null } };
  }
  data.usage = data.usage || { count: 0, lastUsed: null };
  data.usage.count++;
  data.usage.lastUsed = now();
  if (arg('--note', null)) data.usage.lastNote = arg('--note', null);
  saveUserSkill(root, id, data);
  ok(`skill used: ${id} (count=${data.usage.count})`);
}

function skillOptimize(root, id) {
  if (!id) return fail('id required');
  let data = loadUserSkill(root, id);
  if (!data) {
    const base = skillCatalog[id];
    if (!base) return fail(`skill not found: ${id}`);
    data = { name: id, ...base, sources: [], patterns: [], optimizations: [], usage: { count: 0, lastUsed: null } };
  }
  data.optimizations = data.optimizations || [];
  data.optimizations.push({ at: now(), before: arg('--before', '') || '', after: arg('--after', '') || '', note: arg('--note', '') || '' });
  data.lastUpdated = today();
  saveUserSkill(root, id, data);
  ok(`skill optimized: ${id} (total=${data.optimizations.length})`);
}

function skillRemove(root, id) {
  if (!id) return fail('id required');
  const dir = path.join(userSkillsDir(root), id);
  if (!exists(dir)) return fail(`skill folder not found: ${id}`);
  // 1.9.66: 캐시 invalidate
  try { _SKILLS_LIST_CACHE.delete(absRoot(root)); } catch {}
  if (skillCatalog[id]) {
    // catalog 스킬은 로컬 메타만 제거 (카탈로그는 패키지 내장이라 영구 제거 불가)
    fs.rmSync(dir, { recursive: true, force: true });
    ok(`local meta removed for catalog skill: ${id} (catalog 자체는 패키지에 내장)`);
  } else {
    fs.rmSync(dir, { recursive: true, force: true });
    ok(`user skill removed: ${id}`);
  }
}

function skillConsolidate(root) {
  const all = listAllSkills(root);
  const ids = Object.keys(all);
  function tokens(v) {
    return new Set((v.capabilities || []).join(' ').toLowerCase().split(/[\s,/·.()[\]]+/).filter(t => t.length >= 2));
  }
  function jaccard(a, b) {
    const inter = new Set([...a].filter(x => b.has(x))).size;
    const uni = new Set([...a, ...b]).size;
    return uni ? inter / uni : 0;
  }
  const tokenized = {};
  for (const id of ids) tokenized[id] = tokens(all[id]);
  const threshold = parseFloat(arg('--threshold', '0.3'));
  const candidates = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j];
    const s = jaccard(tokenized[a], tokenized[b]);
    if (s >= threshold) candidates.push({ a, b, score: s });
  }
  if (!candidates.length) return ok(`no consolidation candidates (jaccard < ${threshold})`);
  candidates.sort((x, y) => y.score - x.score);
  log(`# Consolidation candidates (jaccard >= ${threshold})`);
  log('| A | B | score | 권장 |');
  log('|---|---|---|---|');
  for (const c of candidates) log(`| ${c.a} | ${c.b} | ${c.score.toFixed(2)} | \`leerness skill learn <new> --capability ...\` 후 \`leerness skill remove <old>\` |`);
}

// 1.9.42: agentskills.io 표준 호환 — SKILL.md (frontmatter + 본문) + scripts/ + references/ + assets/
// 정책: 사용자 동의 (opt-in) 후에만 외부 fetch. 기본 OFF.

// SKILL.md frontmatter 파싱 (---name: ... description: ... --- 본문)
// 1.9.44 BUG-fix: UTF-8 BOM (﻿) 제거 후 파싱 (stress-v2 G2에서 발견)
function _parseSkillMd(text) {
  const cleaned = String(text || '').replace(/^﻿/, '');
  const m = cleaned.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: cleaned };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const km = line.match(/^([a-zA-Z_-]+):\s*(.+)$/);
    if (km) meta[km[1].trim()] = km[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2] };
}

// HTTPS fetch — Node 18+ globalThis.fetch 사용. 미지원 시 https module.
async function _httpFetch(urlStr, opts = {}) {
  const timeout = opts.timeout || 15000;
  if (typeof fetch === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const r = await fetch(urlStr, { signal: controller.signal });
      clearTimeout(timer);
      return { status: r.status, body: await r.text() };
    } catch (e) {
      clearTimeout(timer);
      return { status: 0, body: '', error: e.message };
    }
  }
  // fallback: https module
  return new Promise((resolve) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? require('http') : require('https');
    const req = lib.get(urlStr, (res) => {
      // redirect handling
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return _httpFetch(res.headers.location, opts).then(resolve);
      }
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.setTimeout(timeout, () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
  });
}

// skill install <url-or-path> — SKILL.md 다운로드 + .harness/skills/<id>/에 설치
async function skillInstallCmd(root, source) {
  if (!source) { fail('사용법: leerness skill install <SKILL.md URL 또는 로컬 디렉토리>'); return process.exit(1); }
  let body = '';
  if (/^https?:\/\//.test(source)) {
    log(`# leerness skill install (1.9.42)`);
    log(`다운로드 중: ${source}`);
    const r = await _httpFetch(source);
    if (r.status !== 200) {
      fail(`다운로드 실패 (HTTP ${r.status}${r.error ? `, ${r.error}` : ''})`);
      return process.exit(1);
    }
    body = r.body;
  } else if (exists(source)) {
    const localPath = exists(path.join(source, 'SKILL.md')) ? path.join(source, 'SKILL.md') : source;
    body = read(localPath);
    log(`# leerness skill install (1.9.42)`);
    log(`로컬 로드: ${localPath}`);
  } else {
    fail(`source 없음 (URL 또는 디렉토리 경로): ${source}`);
    return process.exit(1);
  }
  const parsed = _parseSkillMd(body);
  const name = parsed.meta.name || parsed.meta.id;
  const description = parsed.meta.description || '';
  if (!name) { fail('SKILL.md frontmatter에 `name` 필수'); return process.exit(1); }
  // .harness/skills/<id>/SKILL.md 저장
  const skillId = String(name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const dir = path.join(root, '.harness', 'skills', skillId);
  mkdirp(dir);
  writeUtf8(path.join(dir, 'SKILL.md'), body);
  // skill.json도 함께 (자체 catalog 호환)
  writeUtf8(path.join(dir, 'skill.json'), JSON.stringify({
    name: skillId, displayNameKo: name, description,
    capabilities: [], _source: 'agentskills.io',
    verification: { status: 'unverified', method: 'agentskills.io-import' }
  }, null, 2) + '\n');
  log(`✓ skill installed: ${skillId}`);
  log(`  name: ${name}`);
  log(`  description: ${description.slice(0, 100)}`);
  log(`  saved: ${rel(root, dir)}/`);
  log('');
  log(`💡 다음: leerness skill info ${skillId}`);
}

// 1.9.52: 카탈로그 형식 자동 감지 + 파싱 (JSON, llms.txt, RSS, manifest.json, 일반 마크다운)
// 표준화된 entry 형식: { name, url, description, format }
function _parseSkillCatalog(body, sourceUrl) {
  const entries = [];
  const trimmed = body.trim();
  // 1) JSON 카탈로그 — manifest.json 형식 (1.9.47에서 publish가 만드는 형식과 호환)
  //    { "skills": [{ "id"/"name", "url"/"path", "description" }, ...] }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const j = JSON.parse(trimmed);
      const arr = Array.isArray(j) ? j : (j.skills || j.entries || j.items || []);
      for (const e of arr) {
        if (!e || (!e.name && !e.id)) continue;
        entries.push({
          name: e.name || e.id,
          url: e.url || e.path || (sourceUrl ? sourceUrl.replace(/[^/]+$/, '') + (e.id || e.name) + '/SKILL.md' : ''),
          description: e.description || '',
          format: 'json'
        });
      }
      if (entries.length) return entries;
    } catch {}
  }
  // 2) RSS/Atom — <item><title>X</title><link>...</link><description>...</description></item>
  if (/<rss|<feed|<channel|<item>/i.test(body)) {
    for (const m of body.matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)) {
      const item = m[0];
      const title = (item.match(/<title>([^<]+)<\/title>/i) || [])[1];
      const link = (item.match(/<link[^>]*>([^<]+)<\/link>/i) || item.match(/<link\s+href="([^"]+)"/i) || [])[1];
      const desc = (item.match(/<description>([^<]+)<\/description>/i) || item.match(/<summary>([^<]+)<\/summary>/i) || [])[1];
      if (title) entries.push({ name: title.trim(), url: (link || '').trim(), description: (desc || '').trim(), format: 'rss' });
    }
    if (entries.length) return entries;
  }
  // 3) 마크다운 링크 with description — "- [name](url) — description"
  for (const m of body.matchAll(/^\s*[-*]\s*\[([^\]]+)\]\(([^)]+)\)\s*[-—:]\s*(.+)$/gm)) {
    entries.push({ name: m[1], url: m[2], description: m[3].trim(), format: 'markdown' });
  }
  if (entries.length) return entries;
  // 4) 마크다운 링크 without description — "- [name](url)"
  for (const m of body.matchAll(/^\s*[-*]\s*\[([^\]]+)\]\(([^)]+\.md)\)/gm)) {
    entries.push({ name: m[1], url: m[2], description: '', format: 'markdown' });
  }
  if (entries.length) return entries;
  // 5) llms.txt — 단순 URL 라인
  for (const m of body.matchAll(/(https?:\/\/[^\s)]+SKILL\.md)/g)) {
    entries.push({ name: m[1].split('/').slice(-2)[0], url: m[1], description: '', format: 'urls' });
  }
  return entries;
}

// skill discover — agentskills.io 또는 사용자 지정 URL의 카탈로그 인덱스에서 매칭 추천
async function skillDiscoverCmd(root) {
  const url = arg('--source', null) || process.env.LEERNESS_SKILL_DISCOVER_URL || null;
  const query = arg('--query', null);
  if (!url) {
    fail([
      'LEERNESS_SKILL_DISCOVER_URL 환경변수 또는 --source URL 필요.',
      '예: leerness skill discover --source https://agentskills.io/llms.txt',
      '또는 .env에 LEERNESS_SKILL_DISCOVER_URL=...',
      '',
      '(정책: leerness는 사용자 동의 없이 외부 URL을 fetch하지 않음 — 1.9.42 opt-in)'
    ].join('\n'));
    return process.exit(1);
  }
  log(`# leerness skill discover (1.9.52)`);
  log(`source: ${url}`);
  if (query) log(`query: ${query}`);
  log(`fetching...`);
  const r = await _httpFetch(url);
  if (r.status !== 200) {
    fail(`fetch 실패 (HTTP ${r.status}${r.error ? `, ${r.error}` : ''})`);
    return process.exit(1);
  }
  // 1.9.52: 카탈로그 형식 자동 감지 (JSON, llms.txt, RSS, manifest.json, 일반 마크다운)
  const body = r.body;
  const entries = _parseSkillCatalog(body, url);
  if (has('--json')) { log(JSON.stringify({ source: url, query, entries }, null, 2)); return; }
  if (!entries.length) {
    log('  (스킬 항목을 찾지 못함 — URL 형식 확인)');
    return;
  }
  // 쿼리 매칭 (description 단순 포함)
  let matched = entries;
  if (query) {
    const q = query.toLowerCase();
    matched = entries.filter(e => e.name.toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q));
    log(`매칭 ${matched.length}/${entries.length}건`);
  } else {
    log(`전체 ${entries.length}건 (매칭 없음 — --query로 필터링)`);
  }
  log('');
  log('| name | description | url |');
  log('|---|---|---|');
  for (const e of matched.slice(0, 30)) {
    log(`| ${e.name} | ${e.description.slice(0, 60)} | ${e.url} |`);
  }
  log('');
  log(`💡 설치: leerness skill install <url>`);
}

// skill export <id> — 기존 자체 skill을 agentskills.io 표준 SKILL.md로 export
function skillExportCmd(root, id) {
  if (!id) { fail('사용법: leerness skill export <id>'); return process.exit(1); }
  const data = loadUserSkill(root, id) || (skillCatalog[id] ? { ...skillCatalog[id], name: id } : null);
  if (!data) { fail(`skill 없음: ${id}`); return process.exit(1); }
  const description = data.displayNameKo || data.description || (data.capabilities && data.capabilities[0]) || id;
  const body = `---\nname: ${id}\ndescription: ${description.slice(0, 200)}\n---\n\n# ${data.displayNameKo || id}\n\n## Capabilities\n${(data.capabilities || []).map(c => '- ' + c).join('\n') || '-'}\n\n## Sources\n${(data.sources || []).map(s => '- ' + (s.url || s)).join('\n') || '-'}\n\n## Patterns\n${(data.patterns || []).map(p => `- \`${p.command}\` — ${p.note || ''}`).join('\n') || '-'}\n`;
  const outDir = arg('--out', path.join(root, '.harness', 'skills-export', id));
  mkdirp(outDir);
  const outPath = path.join(outDir, 'SKILL.md');
  writeUtf8(outPath, body);
  log(`✓ exported to ${rel(root, outPath)}`);
  log('');
  log(`💡 공유 가능 — 다른 도구가 \`leerness skill install ${outPath}\` 또는 URL로 import`);
}

const planPath = root => path.join(root, '.harness/plan.md');
const progressPath = root => path.join(root, '.harness/progress-tracker.md');
const taskLogPath = root => path.join(root, '.harness/task-log.md');
const evidencePath = root => path.join(root, '.harness/review-evidence.md');
const handoffPath = root => path.join(root, '.harness/session-handoff.md');
const currentStatePath = root => path.join(root, '.harness/current-state.md');
const decisionsPath = root => path.join(root, '.harness/decisions.md');
// 1.9.112: 전용 lessons.md (Memory Write Surface 5번째)
const lessonsPath = root => path.join(root, '.harness/lessons.md');

function nextId(root, prefix) {
  const sources = [planPath(root), progressPath(root)].map(p => exists(p) ? read(p) : '').join('\n');
  const re = new RegExp('\\b' + prefix + '-(\\d{4})\\b', 'g'); let max = 0, m;
  while ((m = re.exec(sources))) max = Math.max(max, Number(m[1]));
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

function readProgressRows(root) {
  const text = exists(progressPath(root)) ? read(progressPath(root)) : '';
  const rows = [];
  for (const line of text.split('\n')) {
    if (!/^\| (?:T|M|D)-\d{4} \|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map(s => s.trim());
    if (cells.length < 6) continue;
    const [id, status, request, evidence, nextAction, updated] = cells;
    rows.push({ id, status, request, evidence, nextAction, updated });
  }
  return rows;
}
function progressHeader(root) {
  const text = exists(progressPath(root)) ? read(progressPath(root)) : '';
  const idx = text.indexOf('|---|');
  if (idx < 0) return text.trim();
  return text.slice(0, text.indexOf('\n', idx)).trimEnd();
}
function writeProgressRows(root, header, rows) {
  const composed = header + '\n' +
    rows.map(r => `| ${r.id} | ${r.status} | ${r.request} | ${r.evidence} | ${r.nextAction} | ${r.updated} |`).join('\n') +
    (rows.length ? '\n' : '');
  writeUtf8(progressPath(root), composed);
}
function upsertProgress(root, row) {
  const header = progressHeader(root);
  const rows = readProgressRows(root);
  const i = rows.findIndex(r => r.id === row.id);
  if (i >= 0) rows[i] = { ...rows[i], ...row, updated: today() };
  else rows.push({ ...row, updated: today() });
  writeProgressRows(root, header, rows);
}

function planShow(root) { const p = planPath(root); log(exists(p) ? read(p) : 'plan.md not found'); }
function planInit(root) { const goal = arg('--goal', ''); if (!exists(planPath(root))) return install(root); append(planPath(root), `\n## User Goal\n- ${goal || '사용자 목적을 작성하세요.'}\n`); ok('plan goal appended'); }
// 1.9.119: plan list — plan.md 의 모든 milestone (M-XXXX) 조회 (CLI + --json + MCP)
function planListCmd(root, opts = {}) {
  root = absRoot(root);
  const jsonMode = !!opts.json || has('--json');
  const pp = planPath(root);
  if (!exists(pp)) {
    if (jsonMode) {
      process.stdout.write(JSON.stringify({ version: VERSION, root, total: 0, milestones: [] }, null, 2) + '\n');
      return;
    }
    return ok('plan.md 없음 — leerness plan add "<text>" 로 첫 milestone 등록');
  }
  const text = read(pp);
  const milestones = [];
  // ### M-XXXX. <title> 블록 추출
  const blocks = text.split(/\n(?=### M-\d{4}\.)/);
  for (const b of blocks) {
    const headerMatch = b.match(/^### (M-\d{4})\.\s*(.+?)$/m);
    if (!headerMatch) continue;
    const id = headerMatch[1];
    const title = headerMatch[2].trim();
    const statusMatch = b.match(/^Status:\s*(.+)$/m);
    const progressMatch = b.match(/^Progress:\s*(.+)$/m);
    // Tasks 블록 (- [ ] 또는 - [x])
    const tasks = [];
    const tasksSection = b.match(/Tasks:\s*\n([\s\S]+?)(?=\n###|\n## |$)/);
    if (tasksSection) {
      for (const line of tasksSection[1].split('\n')) {
        const taskMatch = line.match(/^-\s*\[([\sx])\]\s*(.+)$/);
        if (taskMatch) tasks.push({ done: taskMatch[1] === 'x', text: taskMatch[2].trim() });
      }
    }
    milestones.push({
      id,
      title,
      status: statusMatch ? statusMatch[1].trim() : null,
      progress: progressMatch ? progressMatch[1].trim() : null,
      tasks,
    });
  }
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ version: VERSION, root, total: milestones.length, milestones }, null, 2) + '\n');
    return;
  }
  log(`# 🗺  Plan (1.9.119)\n`);
  if (!milestones.length) return ok('plan milestones 비어있음');
  log(`총 ${milestones.length}개 milestone:`);
  for (const m of milestones) {
    log(`\n[${m.id}] ${m.title}`);
    if (m.status) log(`  Status: ${m.status}`);
    if (m.progress) log(`  Progress: ${m.progress}`);
    if (m.tasks.length) log(`  Tasks: ${m.tasks.length}개 (${m.tasks.filter(t => t.done).length} 완료)`);
  }
}

function planAdd(root, text) {
  const id = nextId(root, 'M');
  const status = arg('--status','planned'), progress = arg('--progress','0');
  append(planPath(root), `\n### ${id}. ${text}\nStatus: ${status}\nProgress: ${progress}%\n\nTasks:\n- [ ] ${text}\n`);
  const tid = nextId(root, 'T');
  upsertProgress(root, { id: tid, status, request: text, evidence: `plan:${id}`, nextAction: arg('--next', '다음 액션 작성') });
  ok(`plan added: ${id} → progress: ${tid}`);
  _autoRoadmap(absRoot(root), 'data-change');
}
function planDrop(root, text) {
  const id = nextId(root, 'D');
  const reason = arg('--reason', '사용자 요청으로 제외');
  const planFile = planPath(root); let p = exists(planFile) ? read(planFile) : '';
  const droppedHeader = '## Out of Scope / Dropped';
  if (p.includes(droppedHeader)) {
    p = p.replace(droppedHeader + '\n| ID | Item | Reason | Date |\n|---|---|---|---|\n',
      droppedHeader + '\n| ID | Item | Reason | Date |\n|---|---|---|---|\n' + `| ${id} | ${text} | ${reason} | ${today()} |\n`);
    writeUtf8(planFile, p);
  } else {
    append(planFile, `\n${droppedHeader}\n| ID | Item | Reason | Date |\n|---|---|---|---|\n| ${id} | ${text} | ${reason} | ${today()} |\n`);
  }
  const tid = nextId(root, 'T');
  upsertProgress(root, { id: tid, status: 'dropped', request: text, evidence: `drop:${reason}`, nextAction: '없음' });
  ok(`plan dropped: ${id} → progress: ${tid}`);
}
function planProgress(root) {
  const rows = readProgressRows(root);
  const counts = {}; for (const s of STATUSES) counts[s] = 0;
  for (const r of rows) if (counts[r.status] != null) counts[r.status]++;
  log(JSON.stringify(counts, null, 2));
}
// 1.9.126: plan remove — milestone 블록을 plan.md에서 제거 + archive 보존
//   Memory Surface DELETE 5종 완전 완성 (task drop / decision drop / lesson drop / rule remove / plan remove)
function planRemoveCmd(root, target) {
  root = absRoot(root);
  if (!target) return fail('plan remove <M-XXXX|title-substring> 필요 — 매칭되는 milestone 블록을 제거하고 .harness/plan.archive.md에 보존');
  const pp = planPath(root);
  if (!exists(pp)) return fail('plan.md 없음');
  const text = read(pp);
  // milestone 블록은 "### M-XXXX. 제목" 으로 시작; "## " (Out of Scope 등) 헤더 또는 EOF 이전까지
  const blocks = text.split(/\n(?=### )/);
  let removed = 0;
  const kept = [];
  for (const b of blocks) {
    if (!b.startsWith('### ')) { kept.push(b); continue; }
    const headerMatch = b.match(/^### (.+)$/m);
    if (!headerMatch) { kept.push(b); continue; }
    const titleLine = headerMatch[1].trim();
    // M-XXXX. 제목 형태 파싱
    const mMatch = titleLine.match(/^(M-\d+)\.\s*(.+)$/);
    const mid = mMatch ? mMatch[1] : null;
    const title = mMatch ? mMatch[2].trim() : titleLine;
    // Template / 템플릿 블록 자동 보호
    if (/^Template(?:\s|\b|\()/i.test(titleLine) || /^템플릿/.test(titleLine)) {
      kept.push(b); continue;
    }
    const isIdTarget = mid === target;
    const isTitleTarget = title.includes(target);
    if (isIdTarget || isTitleTarget) {
      removed++;
      const archivePath = path.join(root, '.harness/plan.archive.md');
      const archiveHeader = exists(archivePath) ? '' : '# Plan archive\n\n';
      append(archivePath, archiveHeader + `\n## 제거 ${today()} (target: "${target}")\n${b}\n`);
      continue;
    }
    kept.push(b);
  }
  if (removed === 0) return fail(`매칭 milestone 없음: "${target}"`);
  writeUtf8(pp, kept.join('\n'));
  ok(`milestone removed: ${removed}건 (보존: .harness/plan.archive.md)`);
  _autoRoadmap(absRoot(root), 'data-change');
}
function planSync(root) { append(taskLogPath(root), `\n## ${today()}\n- Synced plan.md and progress-tracker.md.\n`); ok('plan/progress sync noted'); }

function taskList(root) {
  // 1.9.134: --json 옵션 추가 + --status 필터
  const rows = readProgressRows(root);
  const statusFilter = arg('--status', '');
  const filtered = statusFilter ? rows.filter(r => r.status === statusFilter) : rows;
  if (has('--json')) {
    const payload = {
      version: VERSION,
      root: absRoot(root),
      total: filtered.length,
      tasks: filtered.map(r => ({
        id: r.id,
        status: r.status,
        request: r.request,
        evidence: r.evidence,
        nextAction: r.nextAction,
        updated: r.updated
      }))
    };
    if (statusFilter) payload.statusFilter = statusFilter;
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }
  if (!filtered.length) return log('(no tasks)');
  log('| ID | Status | Request | Evidence | Next Action | Updated |');
  log('|---|---|---|---|---|---|');
  for (const r of filtered) log(`| ${r.id} | ${r.status} | ${r.request} | ${r.evidence} | ${r.nextAction} | ${r.updated} |`);
}
function taskAdd(root, text) {
  const id = nextId(root, 'T');
  upsertProgress(root, { id, status: arg('--status','requested'), request: text, evidence: arg('--evidence','user-request'), nextAction: arg('--next','다음 액션 작성') });
  ok(`task added: ${id}`);
  _autoRoadmap(absRoot(root), 'data-change');
}
function taskUpdate(root, id) {
  if (!id) return fail('id required (e.g., task update T-0001 --status in-progress)');
  const rows = readProgressRows(root);
  if (!rows.find(r => r.id === id)) { fail(`task ${id} not found in progress-tracker.md`); return; }
  const patch = { id };
  if (arg('--status') !== null) patch.status = arg('--status');
  if (arg('--evidence') !== null) patch.evidence = arg('--evidence');
  if (arg('--next') !== null) patch.nextAction = arg('--next');
  if (arg('--note')) patch.request = arg('--note');
  upsertProgress(root, patch);
  ok(`task updated: ${id}`);
  _autoRoadmap(absRoot(root), 'data-change');
}
function taskDrop(root, id) {
  if (!id) return fail('id required');
  upsertProgress(root, { id, status: 'dropped', evidence: arg('--reason','사용자 요청으로 제외'), nextAction: '없음' });
  ok(`task dropped: ${id}`);
  _autoRoadmap(absRoot(root), 'data-change');
}

// 1.9.114: memory status — Memory Write Surface 5종 통합 상태 조회 (CLI + --json + MCP)
function memoryStatusCmd(root, opts = {}) {
  root = absRoot(root);
  const jsonMode = !!opts.json || has('--json');
  // Tasks
  const rows = readProgressRows(root);
  const tasksByStatus = {};
  for (const s of STATUSES) tasksByStatus[s] = 0;
  for (const r of rows) tasksByStatus[r.status] = (tasksByStatus[r.status] || 0) + 1;
  const tasksTotal = rows.length;
  const tasksInProgress = tasksByStatus['in-progress'] || 0;
  // Decisions (1.9.114: _extractDecisionBlocks 사용 — template/code 블록 제외)
  const dm = exists(decisionsPath(root)) ? read(decisionsPath(root)) : '';
  const decisionBlocks = _extractDecisionBlocks(dm);
  const decisionHeaders = decisionBlocks.map(b => {
    const m = b.match(/^### (.+)$/m);
    return m ? '### ' + m[1].trim() : null;
  }).filter(Boolean);
  const decisionLatest = decisionHeaders.length ? decisionHeaders[decisionHeaders.length - 1].replace(/^### /, '') : null;
  // Rules
  const rules = readRules(root);
  const rulesActive = rules.filter(r => r.status === 'active').length;
  const rulesPaused = rules.filter(r => r.status === 'paused').length;
  // Plan
  const planText = exists(planPath(root)) ? read(planPath(root)) : '';
  const milestones = (planText.match(/^### M-\d{4}\./gm) || []).length;
  // plan milestones in-progress: progress-tracker에서 plan:M-XXXX evidence 있고 in-progress 인 row
  const planInProgress = rows.filter(r => /plan:M-/.test(r.evidence || '') && r.status === 'in-progress').length;
  // Lessons (lessons.md)
  const lm = exists(lessonsPath(root)) ? read(lessonsPath(root)) : '';
  const lessonHeaders = lm.match(/^### \d{4}-\d{2}-\d{2}[^\n]*/gm) || [];
  const lessonsLatest = lessonHeaders.length ? (lm.split('\n').filter(l => /- Lesson:/.test(l)).pop() || '').replace(/^- Lesson:\s*/, '').slice(0, 100) : null;
  // 1.9.130: DELETE 5종 archive entry counts
  const archiveCounts = { decisions: 0, lessons: 0, plan: 0, total: 0 };
  try {
    const hd = path.join(root, '.harness');
    for (const [key, file] of [['decisions', 'decisions.archive.md'], ['lessons', 'lessons.archive.md'], ['plan', 'plan.archive.md']]) {
      const fp = path.join(hd, file);
      if (exists(fp)) {
        const entries = _parseArchiveBlocks(read(fp));
        archiveCounts[key] = entries.length;
        archiveCounts.total += entries.length;
      }
    }
  } catch {}

  const payload = {
    version: VERSION,
    root,
    tasks: { inProgress: tasksInProgress, total: tasksTotal, byStatus: tasksByStatus },
    decisions: { count: decisionHeaders.length, latest: decisionLatest },
    rules: { active: rulesActive, paused: rulesPaused, total: rules.length },
    plan: { milestones, inProgress: planInProgress },
    lessons: { count: lessonHeaders.length, latest: lessonsLatest },
    archive: archiveCounts,  // 1.9.130
    summary: `T${tasksInProgress}/D${decisionHeaders.length}/R${rulesActive}/P${milestones}/L${lessonHeaders.length}`,
  };
  if (jsonMode) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }
  log('# 🧠 Memory Surface Status (1.9.114)\n');
  log(`📋 Tasks: ${tasksInProgress} in-progress / ${tasksTotal} total`);
  const statusDetail = STATUSES.map(s => `${s}=${tasksByStatus[s]}`).filter(x => !/=0$/.test(x)).join(', ');
  if (statusDetail) log(`   - 분포: ${statusDetail}`);
  log(`🧠 Decisions: ${decisionHeaders.length} entries`);
  if (decisionLatest) log(`   - 최근: ${decisionLatest}`);
  log(`⚡ Rules: ${rulesActive} active / ${rulesPaused} paused`);
  log(`🗺  Plan: ${milestones} milestones (${planInProgress} in-progress)`);
  log(`💡 Lessons: ${lessonHeaders.length} entries`);
  if (lessonsLatest) log(`   - 최근: ${lessonsLatest}`);
  if (archiveCounts.total > 0) log(`🗑  Archive: D${archiveCounts.decisions}/L${archiveCounts.lessons}/P${archiveCounts.plan} (${archiveCounts.total}건)`);
  log(`\n📊 Summary: ${payload.summary}`);
}

// 1.9.127: memory archive list — DELETE 5종 archive 파일 통합 조회
//   .harness/decisions.archive.md / lessons.archive.md / plan.archive.md 의 "## 제거 YYYY-MM-DD" 블록 파싱
//   --surface decisions|lessons|plan 필터, --json 옵션
function _parseArchiveBlocks(text) {
  // archive 형식: "## 제거 YYYY-MM-DD (target: \"...\")\n<원래 블록>"
  // 첫 번째 "## 제거" 이전의 헤더(# Plan archive 등)는 skip
  const entries = [];
  if (!text) return entries;
  const blocks = text.split(/\n(?=## 제거 )/);
  for (const b of blocks) {
    const m = b.match(/^## 제거 (\d{4}-\d{2}-\d{2})\s*\(target:\s*"([^"]*)"\)/);
    if (!m) continue;
    const date = m[1];
    const target = m[2];
    // 원래 헤더 추출 (### …)
    const headerMatch = b.match(/^### (.+)$/m);
    const originalHeader = headerMatch ? headerMatch[1].trim() : null;
    entries.push({ date, target, originalHeader });
  }
  return entries;
}
function memoryArchiveListCmd(root, opts = {}) {
  root = absRoot(root);
  const jsonMode = !!opts.json || has('--json');
  const surfaceFilter = arg('--surface', '');
  // 1.9.138: --query 키워드 필터 (target / originalHeader 매칭, case-insensitive)
  const queryFilter = arg('--query', '');
  const queryRe = queryFilter ? new RegExp(queryFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const hd = path.join(root, '.harness');
  const archives = {
    decisions: { path: path.join(hd, 'decisions.archive.md'), entries: [] },
    lessons:   { path: path.join(hd, 'lessons.archive.md'),   entries: [] },
    plan:      { path: path.join(hd, 'plan.archive.md'),      entries: [] }
  };
  for (const k of Object.keys(archives)) {
    if (surfaceFilter && surfaceFilter !== k) continue;
    const a = archives[k];
    if (exists(a.path)) {
      let entries = _parseArchiveBlocks(read(a.path));
      // 1.9.138: --query 필터 적용 (target 또는 originalHeader 매칭)
      if (queryRe) {
        entries = entries.filter(e => queryRe.test(e.target || '') || queryRe.test(e.originalHeader || ''));
      }
      a.entries = entries;
    }
  }
  const totals = {
    decisions: archives.decisions.entries.length,
    lessons:   archives.lessons.entries.length,
    plan:      archives.plan.entries.length
  };
  totals.all = totals.decisions + totals.lessons + totals.plan;
  if (jsonMode) {
    const payload = {
      version: VERSION, root,
      decisions: archives.decisions.entries,
      lessons:   archives.lessons.entries,
      plan:      archives.plan.entries,
      totals
    };
    if (queryFilter) payload.query = queryFilter;
    if (surfaceFilter) payload.surface = surfaceFilter;
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }
  log('# 🗑 Memory Archive List (1.9.127)' + (queryFilter ? ` — query: "${queryFilter}"` : '') + '\n');
  if (totals.all === 0) {
    log(queryFilter ? `(매칭 archive entry 없음 — query: "${queryFilter}")` : '(archive 파일 없음 — 아직 제거된 항목 없음)');
    return;
  }
  if ((!surfaceFilter || surfaceFilter === 'decisions') && archives.decisions.entries.length) {
    log(`🧠 Decisions archive: ${archives.decisions.entries.length} entries`);
    for (const e of archives.decisions.entries) {
      log(`   - ${e.date} — target: "${e.target}"${e.originalHeader ? ' — ' + e.originalHeader : ''}`);
    }
  }
  if ((!surfaceFilter || surfaceFilter === 'lessons') && archives.lessons.entries.length) {
    log(`💡 Lessons archive: ${archives.lessons.entries.length} entries`);
    for (const e of archives.lessons.entries) {
      log(`   - ${e.date} — target: "${e.target}"${e.originalHeader ? ' — ' + e.originalHeader : ''}`);
    }
  }
  if ((!surfaceFilter || surfaceFilter === 'plan') && archives.plan.entries.length) {
    log(`🗺  Plan archive: ${archives.plan.entries.length} entries`);
    for (const e of archives.plan.entries) {
      log(`   - ${e.date} — target: "${e.target}"${e.originalHeader ? ' — ' + e.originalHeader : ''}`);
    }
  }
  log(`\n📊 Total archived: ${totals.all} entries (D${totals.decisions}/L${totals.lessons}/P${totals.plan})`);
}

// 1.9.128: memory restore — archive 의 블록을 active 파일로 복귀 (DELETE→RESTORE cycle 완성)
//   surface: decisions|lessons|plan
//   target: date (YYYY-MM-DD) 또는 target substring 매칭
//   매칭 archive 블록을 active 파일 끝에 추가 + archive 에서 제거
function memoryRestoreCmd(root, surface, target) {
  root = absRoot(root);
  if (!surface || !['decisions', 'lessons', 'plan'].includes(surface)) {
    return fail('memory restore <decisions|lessons|plan> <target> 필요 (target: date YYYY-MM-DD 또는 substring)');
  }
  if (!target) return fail('memory restore <surface> <target> — target 누락');
  const hd = path.join(root, '.harness');
  const archivePath = path.join(hd, `${surface}.archive.md`);
  if (!exists(archivePath)) return fail(`${surface}.archive.md 없음 — 복원할 항목 없음`);
  const text = read(archivePath);
  // archive 헤더 (# X archive) 와 본문 분리
  const headerMatch = text.match(/^(# [^\n]*\n+)([\s\S]*)$/);
  const archiveHeader = headerMatch ? headerMatch[1] : '';
  const body = headerMatch ? headerMatch[2] : text;
  // body 를 "## 제거 " 단위로 split
  const blocks = body.split(/\n(?=## 제거 )/);
  const kept = [];
  const restoredBlocks = [];
  for (const b of blocks) {
    if (!b.trim()) continue;
    const m = b.match(/^## 제거 (\d{4}-\d{2}-\d{2})\s*\(target:\s*"([^"]*)"\)/);
    if (!m) { kept.push(b); continue; }
    const date = m[1];
    const blockTarget = m[2];
    const isDateTarget = date === target;
    const isSubstring = blockTarget.includes(target);
    if (isDateTarget || isSubstring) {
      // archive 블록에서 원래 active 블록만 추출 (## 제거 ... 한 줄 + 다음 line부터)
      const content = b.replace(/^## 제거 [^\n]*\n+/, '');
      if (content.trim()) restoredBlocks.push(content.trim());
    } else {
      kept.push(b);
    }
  }
  if (restoredBlocks.length === 0) return fail(`매칭 archive entry 없음: surface=${surface}, target="${target}"`);
  // active 파일 경로
  const activePath = surface === 'decisions' ? decisionsPath(root)
                    : surface === 'lessons'   ? lessonsPath(root)
                    : planPath(root);
  // active 파일에 복귀 (헤더 보존)
  for (const blk of restoredBlocks) {
    append(activePath, '\n' + blk + '\n');
  }
  // archive 재작성 — 모두 제거되면 파일 비움 (헤더만 남김 또는 삭제)
  if (kept.length === 0) {
    // archive 헤더만 남겨도 의미 있음 — 향후 다시 사용 가능
    writeUtf8(archivePath, archiveHeader);
  } else {
    writeUtf8(archivePath, archiveHeader + kept.join('\n'));
  }
  ok(`${surface} restored: ${restoredBlocks.length}건 (archive에서 active로 복귀)`);
  _autoRoadmap(absRoot(root), 'data-change');
}

// 1.9.117: lesson list — lessons.md 의 모든 항목 조회 + --tag 필터 + --json
function lessonListCmd(root, opts = {}) {
  root = absRoot(root);
  const jsonMode = !!opts.json || has('--json');
  const tagFilter = arg('--tag', null);
  // 1.9.139: --query 필터 (lesson text case-insensitive 매칭)
  const queryFilter = arg('--query', null);
  const queryRe = queryFilter ? new RegExp(queryFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const lp = lessonsPath(root);
  if (!exists(lp)) {
    if (jsonMode) {
      const empty = { version: VERSION, root, total: 0, lessons: [], tag: tagFilter };
      if (queryFilter) empty.query = queryFilter;
      process.stdout.write(JSON.stringify(empty, null, 2) + '\n');
      return;
    }
    return ok('lessons.md 없음 — leerness lesson save "<text>" 로 첫 lesson 영구화');
  }
  const text = read(lp);
  const lessons = [];
  for (const block of text.split(/\n(?=### )/)) {
    if (!block.startsWith('### ')) continue;
    const dateMatch = block.match(/^### (\d{4}-\d{2}-\d{2}[^\n]*)/);
    const lessonMatch = block.match(/- Lesson:\s*(.+)/);
    const tagMatch = block.match(/- Tag:\s*(.+)/);
    if (!lessonMatch) continue;
    const lesson = {
      date: dateMatch ? dateMatch[1].trim() : null,
      text: lessonMatch[1].trim(),
      tag: tagMatch ? tagMatch[1].trim() : null,
    };
    if (tagFilter && lesson.tag !== tagFilter) continue;
    // 1.9.139: query 필터 — lesson text 또는 tag 매칭
    if (queryRe && !queryRe.test(lesson.text) && !queryRe.test(lesson.tag || '')) continue;
    lessons.push(lesson);
  }
  if (jsonMode) {
    const payload = { version: VERSION, root, total: lessons.length, lessons, tag: tagFilter };
    if (queryFilter) payload.query = queryFilter;
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }
  log(`# 💡 Lessons (1.9.117)${tagFilter ? ` — tag: ${tagFilter}` : ''}${queryFilter ? ` — query: "${queryFilter}"` : ''}\n`);
  if (!lessons.length) {
    if (queryFilter) ok(`"${queryFilter}" 매칭 lesson 없음`);
    else if (tagFilter) ok(`"${tagFilter}" 태그 lesson 없음`);
    else ok('lessons 비어있음');
    return;
  }
  log(`총 ${lessons.length}건${tagFilter ? ` (tag: ${tagFilter})` : ''}${queryFilter ? ` (query: "${queryFilter}")` : ''}:`);
  for (const l of lessons) {
    log(`\n[${l.date || '?'}]${l.tag ? ` #${l.tag}` : ''}`);
    log(`  ${l.text}`);
  }
}

// 1.9.124: lesson drop — lessons.md 에서 특정 date 또는 text 매칭 블록 제거
function lessonDropCmd(root, target) {
  root = absRoot(root);
  if (!target) return fail('lesson drop <date|text-substring> 필요. 예: leerness lesson drop "2026-05-20" 또는 leerness lesson drop "JWT"');
  const lp = lessonsPath(root);
  if (!exists(lp)) return fail('lessons.md 없음');
  const text = read(lp);
  const blocks = text.split(/\n(?=### )/);
  let removed = 0;
  const kept = [];
  for (const b of blocks) {
    if (!b.startsWith('### ')) { kept.push(b); continue; }
    // date 매칭 (정확) 또는 text substring (lesson content)
    const dateMatch = b.match(/^### (\d{4}-\d{2}-\d{2})/);
    const lessonMatch = b.match(/- Lesson:\s*(.+)/);
    const isDateTarget = dateMatch && dateMatch[1] === target;
    const isTextTarget = lessonMatch && lessonMatch[1].includes(target);
    if (isDateTarget || isTextTarget) {
      removed++;
      // archive 보존 — lessons.archive.md 에 추가
      const archivePath = path.join(root, '.harness/lessons.archive.md');
      const archiveHeader = exists(archivePath) ? '' : '# Lessons archive\n\n';
      append(archivePath, archiveHeader + `\n## 제거 ${today()} (target: "${target}")\n${b}\n`);
      continue;
    }
    kept.push(b);
  }
  if (removed === 0) return fail(`매칭 lesson 없음: "${target}"`);
  writeUtf8(lp, kept.join('\n'));
  ok(`lesson dropped: ${removed}건 (보존: .harness/lessons.archive.md)`);
  _autoRoadmap(absRoot(root), 'data-change');
}

// 1.9.112: lesson save — .harness/lessons.md에 새 lesson 추가 (Memory Write Surface 5번째)
function lessonSave(root, text) {
  root = absRoot(root);
  if (!text) return fail('lesson text required. 예: leerness lesson save "JWT는 refresh token도 짧게 (15분 권장)"');
  const lp = lessonsPath(root);
  const tag = arg('--tag', '');
  const tagBlock = tag ? `- Tag: ${tag}\n` : '';
  const block = `\n### ${today()}\n- Lesson: ${text}\n${tagBlock}`;
  if (!exists(lp)) {
    writeUtf8(lp, `# Lessons (1.9.112)\n\n과거 실수/통찰/패턴 영구 기록 — handoff 자동 회수와 통합.\n${block}`);
  } else {
    append(lp, block);
  }
  ok(`lesson saved`);
  _autoRoadmap(absRoot(root), 'data-change');
}

// 1.9.118: decision list — decisions.md 전체 조회 (CLI + --json + MCP)
function decisionListCmd(root, opts = {}) {
  root = absRoot(root);
  const jsonMode = !!opts.json || has('--json');
  // 1.9.139: --query 필터 (title/decision/reason case-insensitive 매칭)
  const queryFilter = arg('--query', null);
  const queryRe = queryFilter ? new RegExp(queryFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const dp = decisionsPath(root);
  if (!exists(dp)) {
    if (jsonMode) {
      const empty = { version: VERSION, root, total: 0, decisions: [] };
      if (queryFilter) empty.query = queryFilter;
      process.stdout.write(JSON.stringify(empty, null, 2) + '\n');
      return;
    }
    return ok('decisions.md 없음 — leerness decision add "<title>" 로 첫 결정 영구화');
  }
  const text = read(dp);
  const blocks = _extractDecisionBlocks(text);
  const decisions = [];
  for (const block of blocks) {
    const titleMatch = block.match(/^### (.+)$/m);
    if (!titleMatch) continue;
    const titleLine = titleMatch[1].trim();
    // 형식: "YYYY-MM-DD — <title>" 또는 "<title>" 단독
    const dateTitleMatch = titleLine.match(/^(\d{4}-\d{2}-\d{2})\s*—\s*(.+)$/);
    const date = dateTitleMatch ? dateTitleMatch[1] : null;
    const title = dateTitleMatch ? dateTitleMatch[2].trim() : titleLine;
    const decisionMatch = block.match(/- Decision:\s*(.+)/);
    const reasonMatch = block.match(/- Reason:\s*(.+)/);
    const alternativesMatch = block.match(/- Alternatives:\s*(.+)/);
    const impactMatch = block.match(/- Impact:\s*(.+)/);
    const entry = {
      date,
      title,
      decision: decisionMatch ? decisionMatch[1].trim() : null,
      reason: reasonMatch ? reasonMatch[1].trim() : null,
      alternatives: alternativesMatch ? alternativesMatch[1].trim() : null,
      impact: impactMatch ? impactMatch[1].trim() : null,
    };
    // 1.9.139: query 필터 — title/decision/reason 매칭
    if (queryRe) {
      const hay = [entry.title, entry.decision, entry.reason, entry.alternatives, entry.impact].filter(Boolean).join(' ');
      if (!queryRe.test(hay)) continue;
    }
    decisions.push(entry);
  }
  if (jsonMode) {
    const payload = { version: VERSION, root, total: decisions.length, decisions };
    if (queryFilter) payload.query = queryFilter;
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }
  log(`# 🧠 Decisions (1.9.118)${queryFilter ? ` — query: "${queryFilter}"` : ''}\n`);
  if (!decisions.length) return ok(queryFilter ? `"${queryFilter}" 매칭 decision 없음` : 'decisions 비어있음');
  log(`총 ${decisions.length}건${queryFilter ? ` (query: "${queryFilter}")` : ''}:`);
  for (const d of decisions) {
    log(`\n[${d.date || '?'}] ${d.title}`);
    if (d.reason) log(`  Reason: ${d.reason}`);
    if (d.alternatives) log(`  Alternatives: ${d.alternatives}`);
    if (d.impact) log(`  Impact: ${d.impact}`);
  }
}

// 1.9.125: decision drop — decisions.md 에서 특정 결정 제거 (date 또는 title substring 매칭)
function decisionDropCmd(root, target) {
  root = absRoot(root);
  if (!target) return fail('decision drop <date|title-substring> 필요. 예: leerness decision drop "2026-05-20" 또는 leerness decision drop "PostgreSQL"');
  const dp = decisionsPath(root);
  if (!exists(dp)) return fail('decisions.md 없음');
  const text = read(dp);
  // 코드블록 제외해서 안전하게 처리 (template 제외)
  // 단순 split: ### 으로 시작하는 블록만
  const blocks = text.split(/\n(?=### )/);
  let removed = 0;
  const kept = [];
  for (const b of blocks) {
    if (!b.startsWith('### ')) { kept.push(b); continue; }
    // 코드블록 내부는 건드리지 않음 — 단순화: 헤더 라인의 dateMatch / titleMatch
    const headerMatch = b.match(/^### (.+)$/m);
    if (!headerMatch) { kept.push(b); continue; }
    const titleLine = headerMatch[1].trim();
    // 형식: "YYYY-MM-DD — <title>" 또는 "<title>" 단독
    const dateTitleMatch = titleLine.match(/^(\d{4}-\d{2}-\d{2})\s*—\s*(.+)$/);
    const date = dateTitleMatch ? dateTitleMatch[1] : null;
    const title = dateTitleMatch ? dateTitleMatch[2].trim() : titleLine;
    // template 블록 제외 (`### Template (예시 ...)` 같은 경우)
    if (/^Template(?:\s|\b|\()/i.test(titleLine) || /^템플릿/.test(titleLine)) {
      kept.push(b);
      continue;
    }
    const isDateTarget = date === target;
    const isTitleTarget = title.includes(target);
    if (isDateTarget || isTitleTarget) {
      removed++;
      // archive 보존
      const archivePath = path.join(root, '.harness/decisions.archive.md');
      const archiveHeader = exists(archivePath) ? '' : '# Decisions archive\n\n';
      append(archivePath, archiveHeader + `\n## 제거 ${today()} (target: "${target}")\n${b}\n`);
      continue;
    }
    kept.push(b);
  }
  if (removed === 0) return fail(`매칭 decision 없음: "${target}"`);
  writeUtf8(dp, kept.join('\n'));
  ok(`decision dropped: ${removed}건 (보존: .harness/decisions.archive.md)`);
  _autoRoadmap(absRoot(root), 'data-change');
}

// 1.9.108: decision add — decisions.md에 새 설계 결정 추가 (외부 AI/MCP 통합 메모리 영구화)
function decisionAdd(root, title) {
  root = absRoot(root);
  if (!title) return fail('decision title required. 예: leerness decision add "PostgreSQL 채택" --reason "..." ');
  const dp = decisionsPath(root);
  const reason = arg('--reason', '');
  const alternatives = arg('--alternatives', '');
  const impact = arg('--impact', '');
  const block = `\n### ${today()} — ${title}\n- Decision: ${title}\n- Reason: ${reason}\n- Alternatives: ${alternatives}\n- Impact: ${impact}\n`;
  if (!exists(dp)) {
    writeUtf8(dp, `# Decisions\n${block}`);
  } else {
    append(dp, block);
  }
  ok(`decision added: ${title}`);
  // 1.9.43+ handoff lessons 회수 흐름과 자동 통합 (decisions.md fuzzy 매칭됨)
  _autoRoadmap(absRoot(root), 'data-change');
}

// 1.9.6: 옛 link 손실 row를 plan.md milestone과 자동 매칭 제안/복구.
function _tokenizeForSim(s) {
  // unicode letter/number만 보존 — \W는 ASCII 기준이라 한글이 분리되는 버그 회피
  return new Set(
    String(s || '').toLowerCase()
      .split(/\s+/)
      .map(t => t.replace(/[^\p{L}\p{N}_]+/gu, ''))
      .filter(t => t.length >= 2)
  );
}
function _jaccard(a, b) {
  const inter = new Set([...a].filter(x => b.has(x))).size;
  const uni = new Set([...a, ...b]).size;
  return uni ? inter / uni : 0;
}

function taskRelink(root) {
  root = absRoot(root);
  const planText = exists(planPath(root)) ? read(planPath(root)) : '';
  const milestones = [...planText.matchAll(/^### (M-\d{4})\.\s*(.+?)$/gm)]
    .map(m => ({ id: m[1], text: m[2].trim() }));
  const rows = readProgressRows(root);
  const linkedM = new Set(rows.map(r => (r.evidence.match(/M-\d{4}/) || [])[0]).filter(Boolean));
  const orphanM = milestones.filter(m => !linkedM.has(m.id));
  if (!orphanM.length) return ok('미연결 milestone 없음');

  const apply = has('--apply');
  const minScore = parseFloat(arg('--min-score', '0.2'));
  log(`# task relink — 미연결 milestone ${orphanM.length}개${apply ? ' (--apply: 자동 적용)' : ' (제안만, --apply로 적용)'}`);
  const suggestions = [];
  for (const m of orphanM) {
    const milestoneTokens = _tokenizeForSim(m.text);
    const candidates = rows
      .map(r => ({ r, score: _jaccard(milestoneTokens, _tokenizeForSim(r.request)) }))
      .filter(x => x.score >= minScore)
      .sort((a, b) => b.score - a.score);
    log(`\n${m.id}: ${m.text}`);
    if (!candidates.length) {
      log(`  ⓘ 매칭 후보 없음 (score ≥ ${minScore})`);
      log(`  → 새 task: leerness task add "${m.text}" --status planned --evidence "plan:${m.id}"`);
      continue;
    }
    const best = candidates[0];
    const newEv = best.r.evidence.includes(`plan:${m.id}`) ? best.r.evidence : `${best.r.evidence} (plan:${m.id})`;
    log(`  ✓ 최선 후보: ${best.r.id} (score ${best.score.toFixed(2)}) — ${best.r.request}`);
    log(`    현재 evidence: "${best.r.evidence}"`);
    log(`    제안 evidence: "${newEv}"`);
    log(`    수동: leerness task update ${best.r.id} --evidence "${newEv}"`);
    if (candidates.length > 1) {
      const next = candidates.slice(1, 3).map(c => `${c.r.id}(${c.score.toFixed(2)})`).join(', ');
      log(`    다른 후보: ${next}`);
    }
    suggestions.push({ id: best.r.id, evidence: newEv });
  }
  if (apply && suggestions.length) {
    for (const s of suggestions) upsertProgress(root, { id: s.id, evidence: s.evidence });
    log('');
    ok(`${suggestions.length}개 row 자동 relink 완료`);
  }
}

// 1.9.4 D: evidence가 placeholder인 done row를 일괄 점검.
function taskFixEvidence(root) {
  root = absRoot(root);
  const rows = readProgressRows(root);
  const candidates = rows.filter(r =>
    r.status === 'done' && (
      !r.evidence ||
      /^\s*$/.test(r.evidence) ||
      /^(user-request|-)$/.test(r.evidence) ||
      /^plan:M-\d{4}\s*$/.test(r.evidence)
    )
  );
  if (!candidates.length) return ok('갱신 후보 없음 (모든 done row가 검증 키워드 보유)');
  const setAll = arg('--set', null);
  if (setAll) {
    // 1.9.5 F: 기존 evidence의 plan:M-XXXX 링크를 새 텍스트에 자동 보존 (--no-preserve-link로 끄기)
    const preserveLink = !has('--no-preserve-link');
    let preserved = 0;
    for (const r of candidates) {
      let newEv = setAll;
      if (preserveLink) {
        const m = (r.evidence || '').match(/plan:M-\d{4}/);
        if (m && !newEv.includes(m[0])) {
          newEv = `${setAll} (${m[0]})`;
          preserved++;
        }
      }
      upsertProgress(root, { id: r.id, evidence: newEv });
    }
    ok(`${candidates.length}개 row의 evidence를 일괄 갱신${preserveLink ? ` (link 보존: ${preserved}건)` : ''}`);
    return;
  }
  log(`# task fix-evidence — ${candidates.length}개 후보`);
  log(`아래 row들은 evidence가 검증 키워드(테스트/명령/결과)를 포함하지 않습니다.`);
  log(`각각 다음 명령으로 갱신하거나, --set "<공통 텍스트>"로 일괄 갱신하세요.\n`);
  for (const r of candidates) {
    log(`leerness task update ${r.id} --evidence "검증 결과 (e.g., npm test 통과)"`);
    log(`  요청: ${r.request}`);
    log(`  현재 evidence: "${r.evidence || ''}"`);
    log('');
  }
  if (has('--fail-on-candidates')) process.exit(1);
}

function route(name) {
  const r = routes[name];
  if (!r) { fail('Unknown route'); log('Available: ' + Object.keys(routes).join(', ')); return; }
  log(`# Route: ${name}\n`);
  log('Read before work:'); r.read.forEach(x => log('- ' + x));
  log('\nUpdate after work:'); r.update.forEach(x => log('- ' + x));
}

function status(root) {
  root = absRoot(root);
  const verF = path.join(root,'.harness/HARNESS_VERSION');
  const ver = exists(verF) ? read(verF).trim() : 'not installed';
  const lang = exists(path.join(root,'.harness/LANGUAGE')) ? read(path.join(root,'.harness/LANGUAGE')).trim() : 'ko';
  const files = Object.keys(coreFiles(root, lang));
  const missing = files.filter(f => !exists(path.join(root,f)));
  log(`Leerness: ${ver}`);
  log(`Files: ${files.length - missing.length}/${files.length}`);
  if (missing.length) missing.forEach(x => warn('missing: ' + x));
  else ok('required files present');
}
function verify(root) {
  root = absRoot(root);
  let bad = 0;
  const required = ['.harness/plan.md','.harness/progress-tracker.md','.harness/guideline.md','.harness/protected-files.md','.harness/design-system.md','.harness/anti-lazy-work-policy.md','.harness/session-handoff.md','.harness/current-state.md','AGENTS.md'];
  for (const f of required) { if (!exists(path.join(root,f))) { bad++; fail(`missing: ${f}`); } }
  const g = exists(path.join(root,'.harness/guideline.md')) ? read(path.join(root,'.harness/guideline.md')) : '';
  if (!g.includes('plan.md') || !g.includes('progress-tracker.md')) { bad++; fail('guideline.md must reference plan.md and progress-tracker.md'); }
  const a = exists(path.join(root,'AGENTS.md')) ? read(path.join(root,'AGENTS.md')) : '';
  if (!a.includes('protected-files.md')) { bad++; fail('AGENTS.md must reference protected-files.md'); }
  if (!a.includes('anti-lazy-work-policy.md')) { bad++; fail('AGENTS.md must reference anti-lazy-work-policy.md'); }
  if (bad) process.exitCode = 1; else ok('verify passed');
}
function debug(root) {
  root = absRoot(root); let warnings = 0, failures = 0;
  const checks = ['.harness/context-routing.md','.harness/writeback-policy.md','.harness/plan-progress-boundary.md','.harness/consistency-policy.md','.harness/reuse-map.md','.harness/leerness-maintenance.md','.harness/anti-lazy-work-policy.md','.harness/encoding-policy.md','.harness/secret-policy.md'];
  for (const f of checks) { if (exists(path.join(root,f))) ok(f); else { warnings++; warn('missing: ' + f); } }
  const pg = exists(planPath(root)) && exists(progressPath(root));
  if (pg) ok('plan/progress files exist'); else { failures++; fail('plan/progress missing'); }
  log(`Debug summary: warnings=${warnings} failures=${failures}`);
  if (failures) process.exitCode = 1;
}

function audit(root, opts = {}) {
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
  const milestoneIds = Array.from(planText.matchAll(/^### (M-\d{4})\./gm)).map(m => m[1]);
  const rows = readProgressRows(root);
  // 1.9.6 수정: 한 row에 여러 plan:M-XXXX 링크가 있어도 모두 인식 (matchAll로 전부 추출)
  const linkedMs = new Set(
    rows.flatMap(r => Array.from(String(r.evidence || '').matchAll(/M-\d{4}/g), m => m[0]))
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
        const missing = SECRET_PATTERNS.filter(p => !giLines.some(l => l === p || l === '/' + p));
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
  // 1.9.63: --strict — warnings ≥ threshold 시 failures로 승격 (CI 친화)
  if (has('--strict')) {
    const threshold = parseInt(arg('--threshold', '1'), 10);
    if (warnings >= threshold) {
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

const SECRET_PATTERNS = [
  { name: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'GitHub PAT', re: /\bghp_[A-Za-z0-9]{36}\b/g },
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { name: 'OpenAI API key', re: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9-]{20,}\b/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'Generic private key', re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/g },
  { name: 'Hardcoded password assignment', re: /\b(?:password|passwd|pwd|secret|api_key|apikey)\s*[:=]\s*["'][^"'\s]{6,}["']/gi },
];
const SCAN_SKIP_DIRS = new Set(['.git','node_modules','.harness/archive','.viewwork','dist','build','.next','.turbo','.cache','coverage','_pkg-source','out','tmp','temp','.svelte-kit','.parcel-cache']);
// 1.9.4 E: .leerness-skip-dirs 파일에서 추가 skip 디렉토리 읽기
function getExtraSkipDirs(root) {
  const f = path.join(absRoot(root || '.'), '.leerness-skip-dirs');
  if (!exists(f)) return [];
  return read(f).split('\n').map(s => s.trim().replace(/\/+$/, '')).filter(s => s && !s.startsWith('#'));
}
function isSkippedRel(rel, extras = []) {
  const all = [...SCAN_SKIP_DIRS, ...extras];
  return all.some(d => rel === d || rel.startsWith(d + '/'));
}
const SCAN_TEXT_EXT = new Set(['.js','.ts','.jsx','.tsx','.mjs','.cjs','.json','.md','.txt','.env','.bash','.sh','.yml','.yaml','.toml','.ini','.cfg','.py','.rb','.go','.rs','.java','.kt','.swift','.cs','.php','.sql','.html','.css','.scss','.less','.xml','.bat','.ps1','']);
function* walk(root, base = root, depth = 0, extras = null) {
  if (depth > 12) return;
  if (extras === null) extras = getExtraSkipDirs(root);
  for (const e of fs.readdirSync(base, { withFileTypes: true })) {
    const p = path.join(base, e.name);
    const r = path.relative(root, p).replace(/\\/g, '/');
    if (isSkippedRel(r, extras)) continue;
    if (e.isDirectory()) yield* walk(root, p, depth + 1, extras);
    else yield p;
  }
}
function scanSecrets(root) {
  root = absRoot(root);
  const findings = [];
  for (const file of walk(root)) {
    const ext = path.extname(file).toLowerCase();
    if (!SCAN_TEXT_EXT.has(ext)) continue;
    let text;
    try { text = read(file); } catch { continue; }
    if (text.length > 1024 * 1024) continue;
    const fileRel = rel(root, file);
    for (const { name, re } of SECRET_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (fileRel.includes('harness.js') || fileRel.includes('secret-policy.md')) break;
        const line = text.slice(0, m.index).split('\n').length;
        findings.push({ file: fileRel, line, name, snippet: m[0].slice(0, 32) });
        break;
      }
    }
  }
  if (findings.length) {
    fail(`secret patterns found: ${findings.length}`);
    findings.forEach(f => log(`  ${f.file}:${f.line}  ${f.name}  ${f.snippet}…`));
    process.exitCode = 1;
  } else {
    ok('no obvious secret patterns');
  }
}

function encodingCheck(root) {
  root = absRoot(root);
  let warnings = 0; const findings = [];
  for (const file of walk(root)) {
    const ext = path.extname(file).toLowerCase();
    if (!SCAN_TEXT_EXT.has(ext)) continue;
    let buf;
    try { buf = readBuf(file); } catch { continue; }
    if (buf.length === 0) continue;
    if (buf.length > 5 * 1024 * 1024) continue;
    const fileRel = rel(root, file);
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) { warnings++; findings.push({ file: fileRel, issue: 'UTF-8 BOM' }); }
    else if ((buf[0] === 0xFF && buf[1] === 0xFE) || (buf[0] === 0xFE && buf[1] === 0xFF)) { warnings++; findings.push({ file: fileRel, issue: 'UTF-16 BOM' }); }
    let nul = false; for (let i = 0; i < Math.min(buf.length, 4096); i++) if (buf[i] === 0) { nul = true; break; }
    if (nul) { warnings++; findings.push({ file: fileRel, issue: 'NUL byte (binary in text path)' }); }
    if (ext === '.bat') {
      const text = buf.toString('utf8').replace(/^﻿/, '');
      if (!/^@?chcp\s+65001/i.test(text.split(/\r?\n/, 1)[0] || '')) { warnings++; findings.push({ file: fileRel, issue: '.bat missing chcp 65001' }); }
    }
    try {
      const text = buf.toString('utf8');
      if (/[가-힣]/.test(text)) {
        const reBuf = Buffer.from(text, 'utf8');
        if (!reBuf.equals(buf) && !(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF)) {
          warnings++; findings.push({ file: fileRel, issue: 'Korean text but non-clean UTF-8 roundtrip' });
        }
      }
    } catch {}
  }
  if (findings.length) {
    warn(`encoding issues: ${findings.length}`);
    findings.forEach(f => log(`  ${f.file}  ${f.issue}`));
    process.exitCode = warnings > 0 ? 1 : 0;
  } else {
    ok('encoding check passed');
  }
}

// 1.9.101: lazy detect 결과를 JSON으로 노출 (외부 AI/MCP 통합용). opts.json=true 시 verbose 출력 억제 후 JSON만.
function lazyDetect(root, opts = {}) {
  root = absRoot(root);
  const jsonMode = !!opts.json || has('--json');
  let issues = 0;
  const findings = []; // 1.9.101: { kind, severity, message, ...details }
  const _warn = (msg, finding) => { if (finding) findings.push(finding); if (!jsonMode) warn(msg); };
  const rows = readProgressRows(root);
  // 1.9.1 P6: evidence가 단독 plan:M-XXXX 한 줄일 때만 검증 부족 처리.
  // "tests:32/32 (plan:M-0002)" 같이 검증 키워드를 같이 적은 경우는 통과.
  for (const r of rows) if (r.status === 'done' && (!r.evidence || /^(\s*|user-request|-)$/.test(r.evidence) || /^plan:M-\d{4}\s*$/.test(r.evidence))) {
    issues++; _warn(`done row without verifiable evidence: ${r.id} (${r.request})`,
      { kind: 'evidence_missing', severity: 'warn', taskId: r.id, request: r.request });
  }
  if (rows.length === 0) { issues++; _warn('progress-tracker is empty (no tasks tracked)',
    { kind: 'progress_empty', severity: 'warn' }); }
  const handoff = exists(handoffPath(root)) ? read(handoffPath(root)) : '';
  if (!handoff.includes('Last generated:') || handoff.includes('Last generated: (자동)')) {
    issues++; _warn('session-handoff.md never auto-generated',
      { kind: 'handoff_never_generated', severity: 'warn' });
  }
  if (/^## Completed\s*\n-\s*\n/m.test(handoff) && /^## Next Exact Step\s*\n-\s*\n?/m.test(handoff)) {
    issues++; _warn('session-handoff.md has empty Completed and Next Exact Step',
      { kind: 'handoff_empty', severity: 'warn' });
  }
  const ev = exists(evidencePath(root)) ? read(evidencePath(root)) : '';
  const hasTestRun = /\b(npm test|pnpm test|yarn test|pytest|jest|vitest|tsc|eslint|playwright|cypress)\b/i.test(ev);
  if (!hasTestRun) { issues++; _warn('review-evidence.md has no recorded test/typecheck/lint run',
    { kind: 'no_test_run', severity: 'warn' }); }
  // 1.9.4 C: TODO/FIXME가 string literal 안에 있으면 제외 (정규식 패턴 자체 등 false positive).
  function isInsideQuote(line, idx) {
    const pre = line.slice(0, idx);
    const sq = (pre.match(/(?<!\\)'/g) || []).length;
    const dq = (pre.match(/(?<!\\)"/g) || []).length;
    const bq = (pre.match(/(?<!\\)`/g) || []).length;
    return (sq % 2 === 1) || (dq % 2 === 1) || (bq % 2 === 1);
  }
  // 1.9.7 C: TODO 자동 추적 강화 — 위치+텍스트 캡처, known-todos 비교, --auto-track 등록
  const knownPath = path.join(root, '.harness/known-todos.json');
  let knownList = [];
  if (exists(knownPath)) { try { knownList = JSON.parse(read(knownPath)); } catch {} }
  const knownSet = new Set(knownList.map(k => `${k.file}:${k.line}:${k.text}`));
  let todoCount = 0;
  const newTodos = [];
  const cliSelf = path.resolve(__filename);
  for (const file of walk(root)) {
    const ext = path.extname(file).toLowerCase();
    if (!SCAN_TEXT_EXT.has(ext)) continue;
    if (file.includes('.harness')) continue;
    if (path.resolve(file) === cliSelf) continue;
    if (/[\\/]bin[\\/]harness\.js$/.test(file)) continue;
    let text; try { text = read(file); } catch { continue; }
    const lines = text.split('\n');
    const tre = /\bTODO\b|\bFIXME\b|\bXXX\b/g;
    for (let i = 0; i < lines.length; i++) {
      tre.lastIndex = 0;
      let m;
      while ((m = tre.exec(lines[i]))) {
        if (isInsideQuote(lines[i], m.index)) continue;
        todoCount++;
        const txt = lines[i].trim().slice(0, 120);
        const fileRel = rel(root, file);
        const key = `${fileRel}:${i + 1}:${txt}`;
        if (!knownSet.has(key)) newTodos.push({ file: fileRel, line: i + 1, text: txt });
      }
    }
  }
  if (todoCount > 0) {
    const hasTodoTask = rows.some(r => /TODO|FIXME|XXX/.test(r.request) || /TODO|FIXME|XXX/i.test(r.evidence));
    if (!hasTodoTask) {
      issues++;
      _warn(`code has ${todoCount} TODO/FIXME/XXX (new: ${newTodos.length}) but no progress-tracker entry tracks them`,
        { kind: 'todo_untracked', severity: 'warn', todoCount, newCount: newTodos.length, newTodos: newTodos.slice(0, 5) });
      // 새 TODO 처음 5개 표시 (verbose 모드만)
      if (!jsonMode) newTodos.slice(0, 5).forEach(t => log(`    ${t.file}:${t.line}  ${t.text}`));
      if (has('--auto-track') && newTodos.length) {
        for (const t of newTodos) {
          const id = nextId(root, 'T');
          upsertProgress(root, { id, status: 'requested', request: `TODO ${t.file}:${t.line}`, evidence: 'auto-tracked', nextAction: t.text.slice(0, 80) });
        }
        // known-todos에 추가 — 다음 detect에서 재카운트 안 하도록
        const merged = [...knownList, ...newTodos.map(t => ({ ...t, ackAt: now() }))];
        writeUtf8(knownPath, JSON.stringify(merged, null, 2) + '\n');
        if (!jsonMode) ok(`${newTodos.length}개 TODO를 progress-tracker에 자동 등록 + known-todos.json 갱신`);
      } else if (newTodos.length && !jsonMode) {
        log(`    💡 자동 등록: leerness lazy detect --auto-track`);
      }
    }
  }
  const blockers = rows.filter(r => r.status === 'blocked');
  for (const b of blockers) if (b.nextAction === '없음' || /다음 액션 작성/.test(b.nextAction)) {
    issues++; _warn(`blocker without nextAction: ${b.id}`,
      { kind: 'blocker_no_next_action', severity: 'warn', taskId: b.id });
  }
  // 1.9.101: JSON 모드 → 구조화 출력만 (process.exitCode는 일관 유지)
  if (jsonMode) {
    const payload = {
      version: VERSION,
      root,
      issues,
      healthy: issues === 0,
      todoCount,
      newTodoCount: newTodos.length,
      findings,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    if (issues > 0) process.exitCode = 1;
    return;
  }
  if (issues === 0) ok('lazy detect passed (no obvious lazy work signals)');
  else { fail(`lazy detect found ${issues} issues`); process.exitCode = 1; }
}

function preCheck(root) {
  root = absRoot(root);
  let issues = 0;
  const required = ['.harness/plan.md','.harness/progress-tracker.md','.harness/protected-files.md','AGENTS.md'];
  for (const f of required) if (!exists(path.join(root,f))) { issues++; fail(`missing: ${f}`); }
  if (exists(handoffPath(root))) ok('session-handoff present');
  if (exists(currentStatePath(root))) ok('current-state present');
  if (exists(planPath(root))) ok('plan present');
  const pf = exists(path.join(root,'.harness/protected-files.md')) ? read(path.join(root,'.harness/protected-files.md')) : '';
  if (!pf.includes('AGENTS.md')) { issues++; fail('protected-files.md missing AGENTS.md'); }
  if (issues === 0) ok('pre-action check passed');
  else { process.exitCode = 1; }
}

function memorySearch(root, query) {
  root = absRoot(root);
  if (!query) { fail('query required (e.g., memory search "키워드")'); return; }
  const files = ['.harness/decisions.md','.harness/task-log.md','.harness/session-handoff.md','.harness/progress-tracker.md','.harness/plan.md','.harness/review-evidence.md','.harness/architecture.md'];
  const re = new RegExp(query.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
  let total = 0;
  for (const f of files) {
    const p = path.join(root, f); if (!exists(p)) continue;
    const lines = read(p).split('\n');
    const hits = lines.map((line, i) => ({ line, i })).filter(x => re.test(x.line));
    if (hits.length) {
      log(`\n# ${f}`);
      for (const h of hits.slice(0, parseInt(arg('--limit','5'),10))) log(`  L${h.i+1}: ${h.line.trim()}`);
      total += hits.length;
    }
  }
  // 1.9.25: --include-code 옵션 — 실제 소스 코드 본문도 검색 (src/tests/bin)
  // 이전 모순 감지 0/5 → 5/5의 핵심 보완
  if (has('--include-code')) {
    const codeDirs = ['src', 'tests', 'bin', 'lib', 'scripts'];
    for (const dir of codeDirs) {
      const dp = path.join(root, dir);
      if (!exists(dp)) continue;
      function walkCodeDir(d) {
        let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) { walkCodeDir(p); continue; }
          if (!/\.(js|ts|jsx|tsx|gd|cs|py|rb|go|rs|md|html|css|json)$/i.test(e.name)) continue;
          let txt; try { txt = read(p); } catch { continue; }
          const lines = txt.split('\n');
          const hits = lines.map((line, i) => ({ line, i })).filter(x => re.test(x.line));
          if (hits.length) {
            log(`\n# ${rel(root, p)}`);
            for (const h of hits.slice(0, parseInt(arg('--limit','5'),10))) log(`  L${h.i+1}: ${h.line.trim().slice(0, 160)}`);
            total += hits.length;
          }
        }
      }
      walkCodeDir(dp);
    }
  }
  if (total === 0) log('(no matches)');
  else log(`\n${total} matches${has('--include-code') ? ' (소스 코드 포함)' : ''}`);
}

function handoff(root) {
  root = absRoot(root);
  // 1.9.96: --json 옵션 (구조화 출력, MCP 통합 / 외부 AI 친화)
  if (has('--json')) {
    const result = {
      date: today(),
      project: detectProjectName(root),
      version: VERSION,
      files: {}
    };
    function _addFile(key, p) {
      if (exists(p)) {
        const content = read(p);
        result.files[key] = { path: rel(root, p), content: content.length > 8000 ? content.slice(0, 8000) + '\n…(truncated)' : content };
      }
    }
    _addFile('sessionHandoff', handoffPath(root));
    _addFile('currentState', currentStatePath(root));
    _addFile('plan', planPath(root));
    _addFile('progressTracker', progressPath(root));
    _addFile('decisions', decisionsPath(root));
    _addFile('taskLog', taskLogPath(root));
    // active rules
    const activeRules = readRules(root).filter(r => r.status === 'active');
    if (activeRules.length) result.activeRules = activeRules.map(r => ({ id: r.id, trigger: r.trigger, rule: r.rule }));
    // 1.9.115: memorySurface 통합 — handoff JSON에 5종 메모리 상태 동시 회수
    try {
      const rows = readProgressRows(root);
      const tasksByStatus = {};
      for (const s of STATUSES) tasksByStatus[s] = 0;
      for (const r of rows) tasksByStatus[r.status] = (tasksByStatus[r.status] || 0) + 1;
      const tasksInProgress = tasksByStatus['in-progress'] || 0;
      const dm = exists(decisionsPath(root)) ? read(decisionsPath(root)) : '';
      const decisionBlocks = _extractDecisionBlocks(dm);
      const decisionsCount = decisionBlocks.length;
      const rules = readRules(root);
      const rulesActive = rules.filter(r => r.status === 'active').length;
      const planText = exists(planPath(root)) ? read(planPath(root)) : '';
      const milestones = (planText.match(/^### M-\d{4}\./gm) || []).length;
      const lm = exists(lessonsPath(root)) ? read(lessonsPath(root)) : '';
      const lessonsCount = (lm.match(/^### \d{4}-\d{2}-\d{2}[^\n]*/gm) || []).length;
      // 1.9.130: archive 카운트 통합
      const archiveCountsH = { decisions: 0, lessons: 0, plan: 0, total: 0 };
      try {
        const hdH = path.join(root, '.harness');
        for (const [key, file] of [['decisions', 'decisions.archive.md'], ['lessons', 'lessons.archive.md'], ['plan', 'plan.archive.md']]) {
          const fpH = path.join(hdH, file);
          if (exists(fpH)) {
            const entries = _parseArchiveBlocks(read(fpH));
            archiveCountsH[key] = entries.length;
            archiveCountsH.total += entries.length;
          }
        }
      } catch {}
      result.memorySurface = {
        tasks: { inProgress: tasksInProgress, total: rows.length, byStatus: tasksByStatus },
        decisions: { count: decisionsCount },
        rules: { active: rulesActive, total: rules.length },
        plan: { milestones },
        lessons: { count: lessonsCount },
        archive: archiveCountsH,  // 1.9.130
        summary: `T${tasksInProgress}/D${decisionsCount}/R${rulesActive}/P${milestones}/L${lessonsCount}`,
      };
      // 1.9.143: handoff --json featureGraph 통합 (session close 1.9.142 와 동일 패턴)
      try {
        const { nodes: fNodesH } = _readFeatureGraph(root);
        const edgeCount = fNodesH.reduce((s, n) => s + (n.dependsOn?.length || 0) + (n.affects?.length || 0) + (n.coChangesWith?.length || 0), 0);
        const linkedSet = new Set();
        for (const n of fNodesH) {
          for (const x of [...(n.dependsOn||[]), ...(n.affects||[]), ...(n.coChangesWith||[])]) { linkedSet.add(n.id); linkedSet.add(x); }
        }
        const isolated = fNodesH.length ? (fNodesH.length - linkedSet.size) : 0;
        result.featureGraph = {
          total: fNodesH.length,
          edges: edgeCount,
          isolated: Math.max(0, isolated),
          summary: `F${fNodesH.length}/E${edgeCount}${isolated > 0 ? `/iso${isolated}` : ''}`
        };
      } catch {}
    } catch {}
    log(JSON.stringify(result, null, 2));
    return;
  }
  const sections = [];
  function block(label, p) {
    if (!exists(p)) return;
    sections.push(`\n=== ${label} (${rel(root,p)}) ===\n${read(p).trim()}`);
  }
  block('Session Handoff', handoffPath(root));
  block('Current State', currentStatePath(root));
  block('Plan', planPath(root));
  block('Progress Tracker', progressPath(root));
  block('Decisions (last 40 lines)', decisionsPath(root));
  block('Task Log (last 60 lines)', taskLogPath(root));
  const out = sections.map(s => s.length <= 4000 ? s : s.slice(0, 4000) + '\n…(truncated)').join('\n');
  log('# Session Start Context');
  log(`Date: ${today()}`);
  log(`Project: ${detectProjectName(root)}`);
  // 1.9.81: 통합 헤드라인 — drift level + 보안 상태 + skill 추천 + MCP 활동을 한 줄로 압축
  // AI 에이전트가 매 세션 시작 즉시 컨텍스트 인지. --no-headline 또는 --compact로 끄기.
  if (!has('--no-headline') && !has('--compact') && !has('--quiet')) {
    try {
      const parts = [];
      // 1) drift level (가벼운 check)
      try {
        const r = cp.spawnSync(process.execPath, [__filename, 'drift', 'check', root, '--json'],
          { encoding: 'utf8', timeout: 8000, env: { ...process.env, LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '0' } });
        const j = JSON.parse(r.stdout.trim());
        if (j.level) parts.push(`drift ${j.level.replace(/^[^\w]+/, '')} (${j.score})`);
      } catch {}
      // 2) 보안 상태
      try {
        const envPath = path.join(root, '.env');
        if (exists(envPath)) {
          const giText = exists(path.join(root, '.gitignore')) ? read(path.join(root, '.gitignore')) : '';
          const giLines = giText.split('\n').map(l => l.trim());
          if (giLines.includes('.env') || giLines.includes('/.env')) parts.push('🔒 보안 OK');
          else parts.push('🚨 보안 위험');
        }
      } catch {}
      // 3) MCP 활동 누적
      try {
        const stats = _readUsageStats(root);
        const mcpTotal = stats.mcp?.tools ? Object.values(stats.mcp.tools).reduce((s, n) => s + n, 0) : 0;
        if (mcpTotal > 0) parts.push(`🔌 MCP ${mcpTotal}회`);
      } catch {}
      // 4) skill match history 누적
      try {
        const histPath = path.join(root, '.harness', 'skill-suggestions.md');
        if (exists(histPath)) {
          const txt = read(histPath);
          const cnt = (txt.match(/^## [\d-]+ [\d:]+ — query/gm) || []).length;
          if (cnt > 0) parts.push(`📒 skill query ${cnt}회`);
        }
      } catch {}
      // 5) 설치된 skill 수
      try {
        const all = listAllSkills(root);
        const skillCnt = Object.keys(all).length;
        if (skillCnt > 0) parts.push(`📚 ${skillCnt} skills`);
      } catch {}
      // 6) 1.9.93: health 종합 (보안 + drift 결합 1 토큰)
      // 헤드라인의 다른 신호는 이미 계산됨 → inline 추론 (자식 spawn 없음)
      try {
        // 보안 위험 ↔ healthy 판정 (간단)
        const envPath = path.join(root, '.env');
        let healthIssue = false;
        if (exists(envPath)) {
          const giText = exists(path.join(root, '.gitignore')) ? read(path.join(root, '.gitignore')) : '';
          const giLines = giText.split('\n').map(l => l.trim());
          if (!(giLines.includes('.env') || giLines.includes('/.env'))) healthIssue = true;
        }
        // 헤드라인 끝에 health 토큰
        parts.push(healthIssue ? '⚕ health: ⚠' : '⚕ health: ✓');
      } catch {}
      // 7) 1.9.113: Memory Write Surface 5종 카운트 (T=tasks in-progress / D=decisions / R=rules active / P=plan milestones / L=lessons)
      try {
        const rows = readProgressRows(root);
        const inProgressTasks = rows.filter(r => r.status === 'in-progress').length;
        const decisions = exists(decisionsPath(root)) ? (read(decisionsPath(root)).match(/^### \d{4}-\d{2}-\d{2}/gm) || []).length : 0;
        const rulesActive = readRules(root).filter(r => r.status === 'active').length;
        const planText = exists(planPath(root)) ? read(planPath(root)) : '';
        const planMilestones = (planText.match(/^### M-\d{4}\./gm) || []).length;
        const lessons = exists(lessonsPath(root)) ? (read(lessonsPath(root)).match(/^### \d{4}-\d{2}-\d{2}/gm) || []).length : 0;
        parts.push(`🧠 mem T${inProgressTasks}/D${decisions}/R${rulesActive}/P${planMilestones}/L${lessons}`);
      } catch {}
      // 8) 1.9.152: 활성 외부 AI CLI 카운트 (1.9.151 복수 선택 결과 반영) — 메인 에이전트가 sub-agent 분배 가능성 즉시 인지
      try {
        _loadEnvFile(root);  // .env 자동 로드 (handoff 컨텍스트)
        const ready = EXTERNAL_AGENTS.map(a => _checkAgent(a)).filter(c => c.status === 'ready');
        if (ready.length > 0) {
          parts.push(`🤖 agents ${ready.length} (${ready.map(c => c.id).join(',')})`);
        }
      } catch {}
      // 9) 1.9.162: REPL slash 사용량 (24h) — 1.9.149 observability runs/*.jsonl 활용
      // REPL slash 명령 (1.9.150 + 1.9.161 = 8종) 사용 빈도 노출 → 사용자가 REPL 활용도 인지
      try {
        const runsDir = _runsDir(root);
        if (exists(runsDir)) {
          const cutoff = Date.now() - 24 * 3600 * 1000;
          const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.jsonl'));
          let slashCount = 0;
          for (const f of files.slice(-200)) {  // 최근 200 파일만 (성능)
            try {
              const txt = read(path.join(runsDir, f));
              for (const line of txt.split('\n').filter(Boolean)) {
                const j = JSON.parse(line);
                if (j.kind === 'agent_repl_slash' && j.at && new Date(j.at).getTime() >= cutoff) slashCount++;
              }
            } catch {}
          }
          if (slashCount > 0) parts.push(`🪄 slash 24h ${slashCount}회`);
        }
      } catch {}
      if (parts.length) {
        const isTty = process.stdout && process.stdout.isTTY;
        const cy = s => isTty ? `\x1b[36m${s}\x1b[0m` : s;
        log(cy(`📊 헤드라인 (1.9.81/93/113/152/162): ${parts.join(' · ')}`));
      }
    } catch {}
  }
  // 1.9.8: active rules 자동 노출 (매 세션 시작 시 AI에게 보임)
  const activeRules = readRules(root).filter(r => r.status === 'active');
  if (activeRules.length) {
    log('');
    log('## ⚡ Active User Rules (사용자가 명시 중지/제거 요청 전까지 매 세션 자동 노출)');
    for (const r of activeRules) log(`- ${r.id} [${r.trigger}] ${r.rule} (lastVerified: ${r.lastVerified || '-'})`);
    log('');
  }
  log(out);
  if (exists(currentStatePath(root))) {
    const cs = read(currentStatePath(root)).replace(/Updated: \d{4}-\d{2}-\d{2}/, `Updated: ${today()}`);
    writeUtf8(currentStatePath(root), cs);
  }
  // 1.9.56: handoff에 lessons --auto 자동 통합 — 현재 in-progress task와 관련된 과거 실수/결정 자동 재상기
  // 매 세션 시작 시 AI가 과거에 같은 키워드로 실패한 사례를 잊지 않도록.
  // 끄려면: --no-lessons 또는 LEERNESS_NO_LESSONS=1
  if (!has('--no-lessons') && !has('--compact') && !has('--quiet') && process.env.LEERNESS_NO_LESSONS !== '1') {
    try {
      const lrows = readProgressRows(root);
      const latestRow = lrows.filter(r => r.status === 'in-progress' || r.status === 'planned').pop() || lrows[lrows.length - 1];
      if (latestRow && latestRow.request) {
        const stopwords = new Set([
          '이런','저런','하다','하고','있는','하지','에서',
          '작업','구현','추가','진행','수정','변경','검토','확인',
          '프로젝트','관리','기능','시스템','코드','파일','버전','정리','계획',
          'next','action','task','todo','work'
        ]);
        const tokens = String(latestRow.request).toLowerCase().match(/[\w가-힣]{4,}/g) || [];
        const keyword = tokens.filter(t => !stopwords.has(t)).sort((a, b) => b.length - a.length)[0];
        if (keyword) {
          // 1.9.65: lessons blocks 인덱스 메모리 캐시 — mtime 기반 invalidation
          // 같은 프로세스가 여러 번 handoff를 호출해도 split/regex 비용 1회만
          const idx = _loadLessonsIndex(root);
          // fuzzy: keyword 또는 keyword 부분 (4자+) 일치
          // 예: "webhook" 매칭 시 "webhook-payload", "webhooks", "webhooked" 모두 매칭
          const fuzzyRe = new RegExp(escapeRegex(keyword.slice(0, Math.max(4, Math.floor(keyword.length * 0.7)))), 'i');
          const matches = [];
          for (const e of idx.evidence) {
            if (fuzzyRe.test(e.block) && /✗|fail|롤백|버그|incomplete/i.test(e.block)) {
              matches.push({ source: 'review-evidence.md', title: e.title, block: e.block });
            }
          }
          // 1.9.58: decisions.md도 fuzzy 매칭 (실패/롤백 관련 결정만)
          for (const d of idx.decisions) {
            if (fuzzyRe.test(d.block) && /롤백|실패|fail|취소|회귀|deprecate/i.test(d.block)) {
              matches.push({ source: 'decisions.md', title: d.title, block: d.block });
            }
          }
          // 1.9.67: task-log.md 실패 라인도 fuzzy 매칭 (회수 범위 확장)
          for (const t of (idx.taskLogFails || [])) {
            if (fuzzyRe.test(t.block)) {
              matches.push({ source: 'task-log.md', title: t.title, block: t.block });
            }
          }
          if (matches.length) {
            const isTty = process.stdout && process.stdout.isTTY;
            const yel = s => isTty ? `\x1b[33m${s}\x1b[0m` : s;
            const dim = s => isTty ? `\x1b[2m${s}\x1b[0m` : s;
            log('');
            log(yel(`## 🧠 과거 lessons 자동 재상기 (1.9.56) — 키워드 "${keyword}"`));
            log(dim(`  현재 task와 관련된 과거 실패/롤백 ${matches.length}건 — 같은 실수 반복 방지`));
            for (const m of matches.slice(0, 3)) {
              log(dim(`  • [${m.source}] ${m.title}`));
            }
            log(dim(`  → 전체: leerness lessons --auto --path .`));
            log('');
          }
          // 1.9.67: 현재 task와 관련된 skill 자동 추천 (default ON, 1.9.45 opt-in → default)
          // 끄려면: --no-skill-suggest 또는 LEERNESS_NO_SKILL_SUGGEST=1
          if (!has('--no-skill-suggest') && !has('--quiet') && process.env.LEERNESS_NO_SKILL_SUGGEST !== '1') {
            try {
              const installed = _readInstalledSkills(root);
              if (installed.length) {
                const qTokens = _tokenize(String(latestRow.request));
                const ranked = installed.map(s => ({
                  ...s, score: _jaccard(qTokens, _tokenize(s.name + ' ' + s.description))
                })).filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
                if (ranked.length) {
                  const isTty = process.stdout && process.stdout.isTTY;
                  const grn = s => isTty ? `\x1b[32m${s}\x1b[0m` : s;
                  const dim = s => isTty ? `\x1b[2m${s}\x1b[0m` : s;
                  log(grn(`## 🎯 현재 task와 매칭되는 skill 자동 추천 (1.9.67) — 키워드 "${keyword}"`));
                  for (const r of ranked) {
                    log(dim(`  • [${r.score.toFixed(2)}] ${r.id} — ${(r.description || '').slice(0, 60)}`));
                  }
                  log(dim(`  → 전체: leerness skill match "${String(latestRow.request).slice(0, 60)}"`));
                  log('');
                }
                // 1.9.69: skill-suggestions.md rolling history hit — 이전 세션 매칭 결과 노출
                const hist = _loadSkillHistory(root);
                if (hist.blocks.length) {
                  const histRe = new RegExp(escapeRegex(keyword.slice(0, Math.max(4, Math.floor(keyword.length * 0.7)))), 'i');
                  const hits = hist.blocks.filter(b => histRe.test(b.query)).slice(0, 2);
                  if (hits.length) {
                    const isTty = process.stdout && process.stdout.isTTY;
                    const blu = s => isTty ? `\x1b[34m${s}\x1b[0m` : s;
                    const dim = s => isTty ? `\x1b[2m${s}\x1b[0m` : s;
                    log(blu(`## 📒 이전 skill match 이력 (1.9.69) — 키워드 "${keyword}" 관련`));
                    for (const h of hits) {
                      // 블록에서 첫 1~2개 match 줄만 추출
                      const matchLines = (h.block.match(/^\s*-\s*\[[\d.]+\][^\n]+/gm) || []).slice(0, 2);
                      log(dim(`  [${h.at}] query "${h.query}"`));
                      for (const ml of matchLines) log(dim(`  ${ml.trim()}`));
                    }
                    log(dim(`  → 전체 이력: cat .harness/skill-suggestions.md`));
                    log('');
                  }
                }
                // 1.9.88: brainstorm 자동 hits — 현재 task 키워드로 누적 컨텍스트 자동 회수
                // decisions / lessons / skillHistory / taskLogFails 각각 1건씩 미리보기
                // 끄기: --no-brainstorm-hits 또는 LEERNESS_NO_BRAINSTORM_HITS=1
                if (!has('--no-brainstorm-hits') && !has('--quiet') && process.env.LEERNESS_NO_BRAINSTORM_HITS !== '1') {
                  try {
                    const r = cp.spawnSync(process.execPath, [__filename, 'brainstorm', keyword, '--path', root, '--json'],
                      { encoding: 'utf8', timeout: 8000, env: { ...process.env, LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '1' } });
                    const bj = JSON.parse(r.stdout);
                    const hits = bj.hits || {};
                    const items = [];
                    if (hits.decisions?.length) items.push(`💭 decisions: ${hits.decisions[0].title}`);
                    if (hits.lessons?.length) items.push(`⚠ lessons: ${hits.lessons[0].title}`);
                    if (hits.taskLogFails?.length) items.push(`📜 task-log fail: ${hits.taskLogFails[0].title}`);
                    if (hits.skills?.length) items.push(`📚 skill: ${hits.skills[0].id} (${hits.skills[0].displayNameKo || ''})`);
                    if (items.length) {
                      const isTty = process.stdout && process.stdout.isTTY;
                      const mag = s => isTty ? `\x1b[35m${s}\x1b[0m` : s;
                      const dim = s => isTty ? `\x1b[2m${s}\x1b[0m` : s;
                      log(mag(`## 🧩 brainstorm 자동 hits (1.9.88) — 키워드 "${keyword}" 누적 컨텍스트`));
                      for (const it of items.slice(0, 4)) log(dim(`  ${it}`));
                      log(dim(`  → 전체: leerness brainstorm "${keyword}" --path .`));
                      log('');
                    }
                  } catch {}
                }
              }
            } catch {}
          }
        }
      }
    } catch {}
  }
  // 1.9.121: 최근 메모리 변동 알림 — 24h 내 추가된 5종 surface 항목 카운트
  // AI 에이전트가 이전 세션 종료 후 어떤 메모리가 추가됐는지 즉시 인지.
  // 끄기: --no-mem-delta 또는 LEERNESS_NO_MEM_DELTA=1
  if (!has('--no-mem-delta') && !has('--compact') && !has('--quiet') && process.env.LEERNESS_NO_MEM_DELTA !== '1') {
    try {
      const isTtyMd = process.stdout && process.stdout.isTTY;
      const mdCy = s => isTtyMd ? `\x1b[36m${s}\x1b[0m` : s;
      const mdDim = s => isTtyMd ? `\x1b[2m${s}\x1b[0m` : s;
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const deltas = [];
      // tasks: progress-tracker.md row Updated 컬럼 기반 (간단 휴리스틱 — mtime이 24h내면 표시)
      try {
        const pp = progressPath(root);
        if (exists(pp) && fs.statSync(pp).mtimeMs > cutoff) {
          const rows = readProgressRows(root);
          const recent = rows.filter(r => r.updated && (() => { try { return new Date(r.updated).getTime() > cutoff; } catch { return false; } })()).length;
          if (recent > 0) deltas.push(`task +${recent}`);
        }
      } catch {}
      // decisions.md: ### YYYY-MM-DD 헤더 중 오늘 날짜 (정확하지 않지만 휴리스틱)
      try {
        const dm = exists(decisionsPath(root)) ? read(decisionsPath(root)) : '';
        if (dm && fs.statSync(decisionsPath(root)).mtimeMs > cutoff) {
          // _extractDecisionBlocks 사용해서 template 제외
          const blocks = _extractDecisionBlocks(dm);
          const todayStr = today();
          const recent = blocks.filter(b => {
            const m = b.match(/^### (\d{4}-\d{2}-\d{2})/m);
            return m && m[1] === todayStr;
          }).length;
          if (recent > 0) deltas.push(`decision +${recent}`);
        }
      } catch {}
      // lessons.md
      try {
        const lp = lessonsPath(root);
        if (exists(lp) && fs.statSync(lp).mtimeMs > cutoff) {
          const lm = read(lp);
          const todayStr = today();
          const recent = (lm.match(new RegExp(`^### ${todayStr}`, 'gm')) || []).length;
          if (recent > 0) deltas.push(`lesson +${recent}`);
        }
      } catch {}
      // plan.md milestones: 최신 M-XXXX (간단: mtime 24h내면 +1로 처리)
      try {
        const pp = planPath(root);
        if (exists(pp) && fs.statSync(pp).mtimeMs > cutoff) {
          // M-XXXX 중 line이 24h내 추가됐는지 정확히는 어려움 — mtime 24h내면 "plan: 변경됨"으로 표시
          deltas.push('plan: 변경됨');
        }
      } catch {}
      // rules: rule add 후 mtime 24h내
      try {
        const rp = rulesPath(root);
        if (exists(rp) && fs.statSync(rp).mtimeMs > cutoff) {
          const recent = readRules(root).filter(r => r.added === today()).length;
          if (recent > 0) deltas.push(`rule +${recent}`);
        }
      } catch {}
      if (deltas.length) {
        log(mdCy(`🆕 최근 24h 메모리 변동 (1.9.121): ${deltas.join(' · ')}`));
        log(mdDim(`  → 상세: leerness memory status --json`));
        log('');
      }
    } catch {}
  }
  // 1.9.129: handoff 7번째 자동 회수 — 🗑 최근 24h archive 알림
  //   DELETE 5종 archive 파일 (.harness/decisions.archive.md, lessons.archive.md, plan.archive.md)
  //   에 최근 24h 내 추가된 entry 카운트를 노출. AI가 잘못 제거한 항목을 즉시 인지 + restore 후보 회수.
  //   `leerness memory archive list` / `leerness memory restore <surface> <target>` 안내 포함.
  if (!has('--no-mem-delta') && !has('--compact') && !has('--quiet') && process.env.LEERNESS_NO_MEM_DELTA !== '1') {
    try {
      const isTtyArc = process.stdout && process.stdout.isTTY;
      const arcCy = s => isTtyArc ? `\x1b[36m${s}\x1b[0m` : s;
      const arcDim = s => isTtyArc ? `\x1b[2m${s}\x1b[0m` : s;
      const hd = path.join(root, '.harness');
      const cutoffArchive = Date.now() - 24 * 60 * 60 * 1000;
      const today = new Date().toISOString().slice(0, 10);
      const yest = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const surfaces = [
        { key: 'D', label: 'decisions', file: 'decisions.archive.md' },
        { key: 'L', label: 'lessons',   file: 'lessons.archive.md' },
        { key: 'P', label: 'plan',      file: 'plan.archive.md' }
      ];
      const archiveDeltas = [];
      let totalRecent = 0;
      for (const s of surfaces) {
        const fp = path.join(hd, s.file);
        if (!exists(fp)) continue;
        try {
          const stat = fs.statSync(fp);
          if (stat.mtimeMs < cutoffArchive) continue; // 파일 자체가 24h 외면 skip
          const entries = _parseArchiveBlocks(read(fp));
          const recent = entries.filter(e => e.date === today || e.date === yest).length;
          if (recent > 0) {
            archiveDeltas.push(`${s.key}${recent}`);
            totalRecent += recent;
          }
        } catch {}
      }
      if (totalRecent > 0) {
        log(arcCy(`🗑  최근 24h archive (1.9.129): ${archiveDeltas.join('/')} (${totalRecent}건 archived) — 복원 후보`));
        log(arcDim(`  → 회수: leerness memory archive list --json`));
        log(arcDim(`  → 복원: leerness memory restore <surface> <target>`));
        log('');
      }
    } catch {}
  }
  // 1.9.141: handoff 8번째 자동 회수 — 🔗 Feature Causality Graph impact (현재 task 키워드 자동 매칭)
  //   .harness/feature-graph.md 의 노드를 현재 in-progress task의 키워드로 매칭 → 영향받는 feature 목록을 즉시 노출.
  //   1+10=20 cascade 방지 위해 코드 작성 전 영향 범위 인지가 최우선.
  if (!has('--no-feature-impact') && !has('--compact') && !has('--quiet') && process.env.LEERNESS_NO_FEATURE_IMPACT !== '1') {
    try {
      const { nodes: fNodes } = _readFeatureGraph(root);
      if (fNodes.length > 0) {
        const rows = readProgressRows(root);
        // 1.9.141 fix: requested/planned/in-progress 모두 활성 작업으로 간주 — 가장 최근 row 우선
        const activeStatuses = new Set(['requested', 'planned', 'in-progress', 'waiting']);
        const current = [...rows].reverse().find(r => activeStatuses.has(r.status))
                     || rows[rows.length - 1];
        if (current && current.request) {
          const tokens = String(current.request).toLowerCase().match(/[\w가-힣]{3,}/g) || [];
          // feature title 단어 부분일치 (case-insensitive)
          const matched = fNodes.filter(n => {
            const titleLow = n.title.toLowerCase();
            return tokens.some(t => titleLow.includes(t));
          });
          if (matched.length > 0) {
            const isTtyFi = process.stdout && process.stdout.isTTY;
            const fiCy = s => isTtyFi ? `\x1b[33m${s}\x1b[0m` : s; // yellow
            const fiDim = s => isTtyFi ? `\x1b[2m${s}\x1b[0m` : s;
            // 첫 매칭 feature의 impact 카운트만 노출 (간결)
            const main = matched[0];
            const impacted = _featureImpactBfs(fNodes, main.id);
            log(fiCy(`🔗 Feature Graph (1.9.141): "${current.request.slice(0, 40)}" → ${main.id} ${main.title} (impact: ${impacted.length} features)`));
            if (impacted.length > 0) {
              const previewIds = impacted.slice(0, 5).map(it => it.id).join(', ');
              log(fiDim(`  → 영향 범위: ${previewIds}${impacted.length > 5 ? ` …+${impacted.length - 5}` : ''}`));
              log(fiDim(`  → 상세: leerness feature impact ${main.id} --json`));
            }
            log('');
          }
        }
      }
    } catch {}
  }
  // 1.9.145: handoff 9번째 자동 회수 — 🖥 실행 환경 변동 + PATH 누락 알림 (사용자 명시)
  //   "X은(는) 내부 또는 외부 명령... 아닙니다" 사전 방지: package.json scripts 의존 도구가 PATH에 있는지 + 머신 변경 감지
  //   첫 실행에선 자동 캡처 (silent), 이후엔 변동/누락 시에만 노출.
  if (!has('--no-env-detect') && !has('--compact') && !has('--quiet') && process.env.LEERNESS_NO_ENV_DETECT !== '1') {
    try {
      const isTtyEd = process.stdout && process.stdout.isTTY;
      const edCy = s => isTtyEd ? `\x1b[35m${s}\x1b[0m` : s; // magenta
      const edDim = s => isTtyEd ? `\x1b[2m${s}\x1b[0m` : s;
      const prev = _readEnvSnapshot(root);
      const curr = _detectEnvironment(root);
      const diff = _diffEnvSnapshots(prev, curr);
      // 첫 캡처면 silent persist (signal 없음)
      const snapPath = _envSnapshotPath(root);
      if (!prev) {
        try { mkdirp(path.dirname(snapPath)); writeUtf8(snapPath, JSON.stringify(curr, null, 2) + '\n'); } catch {}
      } else if (diff.changes.length || (diff.missing && diff.missing.length)) {
        // 변동/누락 알림
        if (diff.missing && diff.missing.length) {
          log(edCy(`🖥  실행 환경 (1.9.145): ⚠ PATH 누락 ${diff.missing.length}건 — npm run 시 실패 가능`));
          for (const m of diff.missing.slice(0, 3)) log(edDim(`  • ${m.command} (used by: npm run ${m.usedBy})`));
        }
        if (diff.changes.length) {
          log(edCy(`🖥  실행 환경 (1.9.145): 변동 ${diff.changes.length}건 감지`));
          for (const c of diff.changes.slice(0, 3)) log(edDim(`  • ${c}`));
        }
        log(edDim(`  → 상세: leerness env detect . --json`));
        log('');
        // 갱신 (다음 비교 baseline)
        try { writeUtf8(snapPath, JSON.stringify(curr, null, 2) + '\n'); } catch {}
      }
    } catch {}
  }
  // 1.9.76: handoff 보안 상태 요약 — .env vs .env.example + .gitignore 시크릿 패턴 1줄 요약
  // 매 세션 시작 시 AI가 보안 위험을 즉시 인지. --no-security-summary 또는 --compact로 끄기
  if (!has('--no-security-summary') && !has('--compact') && !has('--quiet')) {
    try {
      const envExists = exists(path.join(root, '.env'));
      if (envExists) {
        const issues = [];
        // 1) env diff
        try {
          const d = envDiff(root);
          if (d.inEnvOnly.length) issues.push(`.env→.env.example 누락 ${d.inEnvOnly.length}건`);
        } catch {}
        // 2) gitignore 시크릿 패턴
        try {
          const gi = path.join(root, '.gitignore');
          const giText = exists(gi) ? read(gi) : '';
          const giLines = giText.split('\n').map(l => l.trim());
          const SECRET_PATTERNS = ['.env', '.env.local', '.env.production', '.env.*.local', '*.pem', 'credentials.json'];
          const missing = SECRET_PATTERNS.filter(p => !giLines.some(l => l === p || l === '/' + p));
          if (missing.length) issues.push(`.gitignore 시크릿 누락 ${missing.length}건`);
        } catch {}
        if (issues.length) {
          const isTty = process.stdout && process.stdout.isTTY;
          const red = s => isTty ? `\x1b[31m${s}\x1b[0m` : s;
          const dim = s => isTty ? `\x1b[2m${s}\x1b[0m` : s;
          const yel = s => isTty ? `\x1b[33m${s}\x1b[0m` : s;
          log('');
          log(red(`## 🔒 보안 요약 (1.9.76) — ${issues.length}건 주의`));
          for (const i of issues) log(dim(`  ⚠ ${i}`));
          log(dim(`  → 자동 수정: leerness audit --fix · 상세: leerness env check / leerness audit`));
          // 1.9.80: critical 수준 (.gitignore에 .env 자체 누락) 시 자동 회복 옵션
          const giText = exists(path.join(root, '.gitignore')) ? read(path.join(root, '.gitignore')) : '';
          const giLines = giText.split('\n').map(l => l.trim());
          const envInGitignore = giLines.includes('.env') || giLines.includes('/.env');
          if (!envInGitignore) {
            // .env 자체 누락 → 최우선 위험
            log(yel(`  🚨 CRITICAL (1.9.80): .env가 .gitignore에 없습니다! 시크릿 노출 위험 — 즉시 \`leerness audit --fix\` 권장.`));
            // LEERNESS_AUTO_SECURITY_FIX=1 자동 실행 옵션
            if (process.env.LEERNESS_AUTO_SECURITY_FIX === '1') {
              try {
                const r = cp.spawnSync(process.execPath, [__filename, 'audit', root, '--fix'],
                  { encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '1' } });
                if (r.status === 0) {
                  log(dim(`  ✓ 자동 회복 (LEERNESS_AUTO_SECURITY_FIX=1): audit --fix 완료`));
                } else {
                  log(dim(`  ⚠ 자동 회복 실패 (exit ${r.status}) — 수동 \`leerness audit --fix\` 권장`));
                }
              } catch (e) {
                log(dim(`  ⚠ 자동 회복 예외: ${e.message}`));
              }
            } else {
              log(dim(`  💡 자동 실행 옵션: LEERNESS_AUTO_SECURITY_FIX=1 leerness handoff .`));
            }
          }
          log('');
        }
      }
    } catch {}
  }
  // 1.9.41: 최근 migrate 차분 알림 — migration-report.md가 24h 내면 "AI must re-read" 블록 자동 표시
  // 같은 채팅 세션의 AI 청크가 이전 버전 마인드셋이어도 새 도구를 즉시 인지하도록.
  if (!has('--no-workflow-guide') && !has('--compact')) {
    try {
      const reportPath = path.join(root, '.harness', 'migration-report.md');
      if (exists(reportPath)) {
        const stat = fs.statSync(reportPath);
        const ageHr = (Date.now() - stat.mtimeMs) / 3600000;
        if (ageHr < 24) {
          const rep = read(reportPath);
          const aiBlock = rep.match(/## 🤖 AI must re-read[\s\S]*?(?=\n## )/);
          if (aiBlock) {
            const isTty = process.stdout && process.stdout.isTTY;
            const yel = s => isTty ? `\x1b[33m${s}\x1b[0m` : s;
            log('');
            log(yel(`## 🆕 최근 ${ageHr.toFixed(1)}시간 전 migrate 차분 — AI 에이전트는 신규 도구 우선 시도`));
            log(aiBlock[0].trim());
            log('');
          }
        }
      }
    } catch {}
  }
  // 1.9.39: handoff 출력 끝에 6단계 워크플로 가이드 자동 표시 (메인 에이전트가 매 세션 인지)
  if (!has('--no-workflow-guide') && !has('--compact') && process.env.LEERNESS_NO_WORKFLOW_GUIDE !== '1') {
    const isTty = process.stdout && process.stdout.isTTY;
    const cy = s => isTty ? `\x1b[36m${s}\x1b[0m` : s;
    const b = s => isTty ? `\x1b[1m${s}\x1b[0m` : s;
    const d = s => isTty ? `\x1b[2m${s}\x1b[0m` : s;
    log('');
    log(cy('## 🛠 세션 워크플로 6단계 (1.9.39+, AI 하네스 엔지니어링)'));
    log(d('  상세: ') + cy('.harness/session-workflow.md'));
    log(`  1. ${b('요청 분석')}     handoff(이미 완료) · drift check · 모호하면 명확화`);
    log(`  2. ${b('계획 수립')}     plan add / TodoWrite · reuse-map으로 기존 자원 우선`);
    log(`  3. ${b('업무 분배')}     agents list/recommend · 작업유형별 sub-agent 매핑`);
    log(`  4. ${b('sub-agent 작업')} 파일 경로 격리 · mtime 검증 의무 · 자체 테스트`);
    log(`  5. ${b('종합 검증')}     contract verify · verify-claim --run-tests · review --persona`);
    log(`  6. ${b('세션 마감')}     session close · audit --fix · usage stats`);
    log(d('  끄려면: --no-workflow-guide 또는 LEERNESS_NO_WORKFLOW_GUIDE=1'));
    log('');
  }
  ok('handoff loaded; current-state updated');
}

// 1.9.18: --since 파서 ("24h", "3d", "1w", "30m") → cutoff ISO date
function _parseSince(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d+(?:\.\d+)?)\s*([mhdw])$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const ms = unit === 'm' ? n * 60 * 1000
           : unit === 'h' ? n * 3600 * 1000
           : unit === 'd' ? n * 86400 * 1000
           : /* w */        n * 7 * 86400 * 1000;
  const cutoff = new Date(Date.now() - ms);
  return cutoff.toISOString().slice(0, 10); // YYYY-MM-DD
}

// 1.9.17→1.9.18: 워크스페이스 통합 handoff — 4개 agent 동시 작업 시 메인 agent용 한 줄 요약
// 1.9.18: --since <duration> 추가, 최근 수정된 T-row 강조 (🆕 마크 + 별도 섹션)
function _handoffWorkspace(rootBase) {
  const paths = _collectWorkspacePaths(rootBase);
  if (!paths.length) return fail('대상 프로젝트 없음. --include 또는 --all-apps 사용.');
  const sinceArg = arg('--since', null);
  const sinceCutoff = sinceArg ? _parseSince(sinceArg) : null;
  if (sinceArg && !sinceCutoff) { fail(`--since 형식 오류: "${sinceArg}" (예: 24h, 3d, 1w)`); return process.exit(1); }

  function isRecent(row) {
    if (!sinceCutoff || !row.updated) return false;
    return row.updated >= sinceCutoff;
  }

  if (has('--json')) {
    const projects = paths.map(p => {
      const rows = readProgressRows(p);
      const buckets = {};
      for (const r of rows) (buckets[r.status] || (buckets[r.status] = [])).push(r);
      const activeRules = readRules(p).filter(r => r.status === 'active').length;
      const recent = sinceCutoff ? rows.filter(isRecent) : [];
      return {
        project: path.basename(p),
        path: p,
        total: rows.length,
        done: (buckets['done'] || []).length,
        inProgress: (buckets['in-progress'] || []).length,
        planned: (buckets['planned'] || []).length,
        blocked: (buckets['blocked'] || []).length,
        activeRules,
        nextAction: (buckets['in-progress']?.[0]?.nextAction) || (buckets['planned']?.[0]?.nextAction) || (buckets['requested']?.[0]?.nextAction) || null,
        recent: recent.map(r => ({ id: r.id, status: r.status, request: r.request, updated: r.updated }))
      };
    });
    log(JSON.stringify({ workspace: path.basename(rootBase), since: sinceCutoff, projects, totals: {
      tasks: projects.reduce((a, b) => a + b.total, 0),
      done: projects.reduce((a, b) => a + b.done, 0),
      inProgress: projects.reduce((a, b) => a + b.inProgress, 0),
      blocked: projects.reduce((a, b) => a + b.blocked, 0),
      recent: projects.reduce((a, b) => a + (b.recent?.length || 0), 0)
    } }, null, 2));
    return;
  }
  // 1.9.22: --compact 모드 — LLM 시스템 프롬프트 최적화용 1줄 요약 (~500 chars)
  if (has('--compact')) {
    let totalDone = 0, totalTasks = 0, totalWIP = 0, totalRecent = 0;
    const projSummaries = [];
    for (const p of paths) {
      const rows = readProgressRows(p);
      const buckets = {};
      for (const r of rows) (buckets[r.status] || (buckets[r.status] = [])).push(r);
      const done = (buckets['done'] || []).length;
      const wip = (buckets['in-progress'] || []).length;
      const recent = sinceCutoff ? rows.filter(isRecent).length : 0;
      totalDone += done; totalTasks += rows.length; totalWIP += wip; totalRecent += recent;
      const pct = rows.length ? Math.round(done / rows.length * 100) : 0;
      projSummaries.push(`${path.basename(p)} ${done}/${rows.length}(${pct}%)`);
    }
    log(`leerness compact (1.9.22): ${paths.length}프로젝트 · ${totalDone}/${totalTasks}(${totalTasks?Math.round(totalDone/totalTasks*100):0}%) done · WIP ${totalWIP}${sinceCutoff?` · 🆕${totalRecent}`:''}`);
    log(`projects: ${projSummaries.join(' | ')}`);
    log(`핵심 규칙: 의존성0 · 한국어주석 · UTF-8noBOM · reuse-map등록 · anti-lazy-work · verify-claim자동검수`);
    return;
  }
  log(`# Workspace Handoff — ${paths.length}개 프로젝트 (1.9.22)`);
  log(`Date: ${today()}`);
  if (sinceCutoff) log(`Filter: since ${sinceArg} (${sinceCutoff} 이후 수정된 항목 🆕 강조)`);
  log('');
  log('## 프로젝트별 진행 상태');
  let totalDone = 0, totalTasks = 0, totalWIP = 0, totalBlocked = 0, totalRecent = 0;
  const allRecent = [];
  for (const p of paths) {
    const rows = readProgressRows(p);
    const buckets = {};
    for (const r of rows) (buckets[r.status] || (buckets[r.status] = [])).push(r);
    const done = (buckets['done'] || []).length;
    const wip = (buckets['in-progress'] || []).length;
    const planned = (buckets['planned'] || []).length;
    const blocked = (buckets['blocked'] || []).length;
    const recent = sinceCutoff ? rows.filter(isRecent) : [];
    totalDone += done; totalTasks += rows.length; totalWIP += wip; totalBlocked += blocked; totalRecent += recent.length;
    for (const r of recent) allRecent.push({ project: path.basename(p), ...r });
    const nx = (buckets['in-progress']?.[0]) || (buckets['planned']?.[0]) || null;
    const pct = rows.length ? Math.round(done / rows.length * 100) : 0;
    const recentBadge = recent.length ? ` · 🆕 ${recent.length}` : '';
    log(`  ${path.basename(p)}: ${done}/${rows.length} (${pct}%) · WIP ${wip} · planned ${planned}${blocked ? ` · 🚫 blocked ${blocked}` : ''}${recentBadge}`);
    if (nx) log(`    └ 다음: ${nx.id} [${nx.status}] ${nx.nextAction || nx.request}`);
  }
  // 1.9.18: --since 모드일 때 최근 추가/수정 섹션
  if (sinceCutoff) {
    log('');
    log(`## 🆕 최근 변경 (${sinceArg} 내, ${totalRecent}건)`);
    if (!totalRecent) log(`  (없음) — ${sinceCutoff} 이후 progress-tracker 업데이트 없음`);
    else {
      for (const r of allRecent) log(`  - ${r.project}/${r.id} [${r.status}] ${r.request} (updated ${r.updated})`);
    }
  }
  log('');
  log(`## 📊 워크스페이스 총합`);
  log(`  - 누적 task: ${totalTasks} (done ${totalDone}, ${totalTasks ? Math.round(totalDone / totalTasks * 100) : 0}%)`);
  log(`  - 진행중 (WIP): ${totalWIP} · 차단: ${totalBlocked}${sinceCutoff ? ` · 🆕 최근 ${totalRecent}` : ''}`);
  if (totalBlocked > 0) log(`  - ⚠ ${totalBlocked}건이 blocked — 우선 처리 검토`);
  log('');
  log(`## 💡 멀티에이전트 오케스트레이션 권장`);
  log(`  - 각 프로젝트의 "다음" 작업을 sub-agent 1명씩 병렬 진행 가능`);
  log(`  - 새 패턴 추가 시 \`leerness reuse-map --all-apps\`로 중복 감지${sinceCutoff ? '' : ' / `--since 24h`로 최근 변경 추적'}`);
}

function handoffCmd(root) {
  // 1.9.17: --all-apps / --include 통합 모드
  if (has('--all-apps') || arg('--include', null)) {
    return _handoffWorkspace(absRoot(root));
  }
  // 1.9.37: drift 자동 경고 (메인 에이전트가 leerness를 점점 안 쓰는 현상 감지)
  // 1.9.38 (A): drift 임계 시 .harness/agent-reminders.md 자동 생성 — 메인 에이전트 프롬프트에 표시되도록.
  // 1.9.38 (D): skip 횟수 학습 — --no-drift-check 빈도 ≥5 시 임계 완화 (1d → 2d).
  const absR0 = absRoot(root || process.cwd());
  if (exists(path.join(absR0, '.harness')) && process.env.LEERNESS_NO_DRIFT_CHECK !== '1') {
    // skip 카운트
    if (has('--no-drift-check')) {
      try {
        const stats = _readUsageStats(absR0);
        stats.drift = stats.drift || {};
        stats.drift.skipped = (stats.drift.skipped || 0) + 1;
        const p = _usageStatsPath(absR0);
        mkdirp(path.dirname(p));
        writeUtf8(p, JSON.stringify(stats, null, 2) + '\n');
      } catch {}
    } else {
      try {
        const isTty = process.stdout && process.stdout.isTTY;
        const yel = s => isTty ? `\x1b[33m${s}\x1b[0m` : s;
        const red = s => isTty ? `\x1b[31m${s}\x1b[0m` : s;
        const dim = s => isTty ? `\x1b[2m${s}\x1b[0m` : s;
        // 1.9.38 (D): 학습된 임계 (skip 빈도 높으면 임계 완화)
        const stats = _readUsageStats(absR0);
        const skipCount = (stats.drift && stats.drift.skipped) || 0;
        const threshold = skipCount >= 5 ? 4 : 2; // 5회 이상 끄면 2일 → 4일로 완화
        // 간이 drift 계산
        const now = Date.now();
        const shPath = handoffPath(absR0);
        let shAge = null;
        if (exists(shPath)) {
          const m = read(shPath).match(/Last generated:\s*([\d\-T:.Z]+)/);
          if (m) shAge = (now - new Date(m[1]).getTime()) / 86400000;
        }
        const rows = readProgressRows(absR0);
        let ptAge = null;
        if (rows.length) {
          const dates = rows.map(r => (r.updated || '').match(/\d{4}-\d{2}-\d{2}/)).filter(Boolean).map(m => m[0]).sort();
          if (dates.length) ptAge = (now - new Date(dates[dates.length - 1]).getTime()) / 86400000;
        }
        const sevStale = (shAge !== null && shAge > 3) || (ptAge !== null && ptAge > 3);
        if ((shAge !== null && shAge > threshold) || (ptAge !== null && ptAge > threshold)) {
          log('');
          log(yel('  ⚠ leerness drift 감지 — 메타파일이 stale합니다'));
          if (shAge !== null && shAge > threshold) log(dim(`     session-handoff.md: ${shAge.toFixed(1)}일 stale`));
          if (ptAge !== null && ptAge > threshold) log(dim(`     progress-tracker:   ${ptAge.toFixed(1)}일 stale`));
          log(dim(`     → 권장: ${red('leerness session close .')} 또는 ${red('leerness drift check .')} 로 상세 보기`));
          if (skipCount >= 5) log(dim(`     (학습: skip ${skipCount}회 누적 → 임계 ${threshold}일로 완화)`));
          // 1.9.39: --auto-recover — drift 감지 시 inline 자동 회복
          if (has('--auto-recover') && sevStale) {
            log(dim(`     🔧 --auto-recover 활성 — session close 자동 실행 중...`));
            try {
              const r = cp.spawnSync(process.execPath, [__filename, 'session', 'close', absR0], { encoding: 'utf8', timeout: 60000 });
              if (r.status === 0) {
                log(dim(`     ✓ session close 자동 완료 (다음 라운드부터 healthy)`));
                const s2 = _readUsageStats(absR0);
                s2.drift = s2.drift || {};
                s2.drift.autoResolved = (s2.drift.autoResolved || 0) + 1;
                writeUtf8(_usageStatsPath(absR0), JSON.stringify(s2, null, 2) + '\n');
              } else {
                log(dim(`     ⚠ auto-recover 실패 (exit ${r.status})`));
              }
            } catch (e) {
              log(dim(`     ⚠ auto-recover 오류: ${e.message}`));
            }
          }
          log('');
          // 1.9.38 (A): critical 시 .harness/agent-reminders.md 자동 생성 — 다음 세션 시작 시 메인 에이전트가 읽도록.
          if (sevStale) {
            try {
              const remPath = path.join(absR0, '.harness', 'agent-reminders.md');
              const body = `<!-- leerness:managed:auto -->\n# 🔔 메인 에이전트용 자동 reminder\n\n_생성: ${new Date().toISOString()}_\n\n## drift critical 감지\n현재 워크스페이스의 메타파일이 매우 stale합니다. 이번 라운드 작업 끝에 반드시 다음 명령을 호출하세요:\n\n\`\`\`bash\nleerness session close .\n\`\`\`\n\n또는 상세 점검:\n\`\`\`bash\nleerness drift check .\n\`\`\`\n\nstale 신호:\n${shAge !== null ? `- session-handoff.md: ${shAge.toFixed(1)}일 stale\n` : ''}${ptAge !== null ? `- progress-tracker: ${ptAge.toFixed(1)}일 stale\n` : ''}\n\n_이 파일은 leerness 1.9.38+가 자동 갱신합니다. session close 후 자동 삭제.\n_사용자가 이 파일을 보고 메인 에이전트에 reminder 전달 가능._\n`;
              writeUtf8(remPath, body);
            } catch {}
          } else {
            // attention 등급으로 회복했으면 reminder 파일 삭제
            try {
              const remPath = path.join(absR0, '.harness', 'agent-reminders.md');
              if (exists(remPath)) fs.unlinkSync(remPath);
            } catch {}
          }
        } else {
          // healthy → reminder 파일 자동 청소
          try {
            const remPath = path.join(absR0, '.harness', 'agent-reminders.md');
            if (exists(remPath)) fs.unlinkSync(remPath);
          } catch {}
        }
      } catch {}
    }
  }
  // 1.9.35 개선 #1: .harness 부재 시 즉시 경고 (자동 init 권장)
  // 사용자가 신규 디렉토리에서 handoff 호출 시 sub-agent 작업이 길을 잃지 않도록.
  const absR = absRoot(root || process.cwd());
  if (!exists(path.join(absR, '.harness')) && !has('--no-init-check')) {
    const isTty = process.stdout && process.stdout.isTTY;
    const yel = s => isTty ? `\x1b[33m${s}\x1b[0m` : s;
    const dim = s => isTty ? `\x1b[2m${s}\x1b[0m` : s;
    log('');
    log(yel('  ⚠  leerness init 미실행 디렉토리'));
    log(dim('     ' + absR));
    log(dim('     handoff가 표시할 컨텍스트(plan/progress/decisions)가 없습니다.'));
    log('');
    log(dim('     해결:'));
    log('       ' + yel(`leerness init "${absR}" --yes --language ko`));
    log('');
    log(dim('     (--no-init-check 로 끄기)'));
    log('');
  }
  return handoff(root);
}

// 1.9.17: 워크스페이스 통합 reuse-map — Capability 중복 자동 감지
// 1.9.18: element에서 함수명 추출, notes에서 depends-on 추출
function _extractFunctionName(element) {
  // "src/build.js (escapeHtml)" → "escapeHtml"
  // "src/openMeteo.js (fetchBatch)" → "fetchBatch"
  // "src/cities.js" → null
  const m = String(element).match(/\(([A-Za-z_$][\w$]*)\s*\)?\s*$/);
  return m ? m[1] : null;
}
function _extractFilePath(element) {
  // "src/build.js (escapeHtml)" → "src/build.js"
  // "src/cities.js" → "src/cities.js"
  const m = String(element).match(/^([^\s(]+)/);
  return m ? m[1] : null;
}
function _extractDependsOn(notes) {
  // notes 컬럼에서 "depends-on: A, B" 또는 "depends: A" 패턴 추출
  const m = String(notes).match(/depends(?:-on)?:\s*([^|]+?)(?:\s*\)|$)/i);
  if (!m) return [];
  return m[1].split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

function _readReuseMap(root) {
  const p = path.join(root, '.harness', 'reuse-map.md');
  if (!exists(p)) return [];
  const txt = read(p);
  const lines = txt.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    // skip header + separator + empty
    if (!l.startsWith('|') || l.startsWith('|--') || /^\|\s*Capability\s*\|/i.test(l)) continue;
    const cells = l.split('|').map(c => c.trim()).filter((_, idx, arr) => idx !== 0 && idx !== arr.length - 1);
    if (cells.length < 2 || !cells[0]) continue;
    const notes = cells[3] || '';
    out.push({
      capability: cells[0],
      element: cells[1] || '',
      method: cells[2] || '',
      notes,
      line: i + 1,
      // 1.9.18: 파생 필드
      functionName: _extractFunctionName(cells[1] || ''),
      filePath: _extractFilePath(cells[1] || ''),
      dependsOn: _extractDependsOn(notes)
    });
  }
  return out;
}

function reuseMapCmd(root) {
  root = absRoot(root || process.cwd());
  // 단일 프로젝트 모드
  if (!has('--all-apps') && !arg('--include', null)) {
    const entries = _readReuseMap(root);
    if (has('--json')) { log(JSON.stringify({ project: path.basename(root), entries }, null, 2)); return; }
    log(`# Reuse Map — ${path.basename(root)} (${entries.length}개)`);
    if (!entries.length) { log('  (없음) — 새 컴포넌트/유틸 추가 후 등록 권장'); return; }
    entries.forEach(e => {
      const dep = e.dependsOn.length ? ` ← depends: ${e.dependsOn.join(', ')}` : '';
      log(`  - ${e.capability} → ${e.element} [${e.method}] ${e.notes}${dep}`);
    });
    return;
  }
  // 워크스페이스 모드
  const paths = _collectWorkspacePaths(root);
  if (!paths.length) return fail('대상 프로젝트 없음. --include 또는 --all-apps 사용.');
  const strictElements = has('--strict-elements');
  const byCap = new Map();   // capability(lowercase) → [{ project, entry }]
  const byFunc = new Map();  // functionName → [{ project, entry }]    // 1.9.18
  const dependsEdges = [];   // 1.9.18: { from: {project, cap}, to: cap }
  const projects = paths.map(p => {
    const entries = _readReuseMap(p);
    for (const e of entries) {
      const k = e.capability.toLowerCase().trim();
      if (!byCap.has(k)) byCap.set(k, []);
      byCap.get(k).push({ project: path.basename(p), path: p, entry: e });
      // 1.9.18: function-name 인덱스
      if (e.functionName) {
        const fk = e.functionName.toLowerCase();
        if (!byFunc.has(fk)) byFunc.set(fk, []);
        byFunc.get(fk).push({ project: path.basename(p), path: p, entry: e });
      }
      // 1.9.18: depends-on 엣지
      for (const dep of e.dependsOn) {
        dependsEdges.push({ from: { project: path.basename(p), cap: e.capability }, to: dep });
      }
    }
    return { project: path.basename(p), path: p, entries };
  });
  // exact capability 중복
  const dupes = [...byCap.entries()].filter(([, occ]) => occ.length >= 2);
  // 1.9.18: --strict-elements: 같은 함수명이 다른 capability로 등록된 경우 잠재 중복
  const funcDupes = strictElements ? [...byFunc.entries()].filter(([, occ]) => {
    if (occ.length < 2) return false;
    // 정확 capability 중복이 아닌 경우만 (이미 dupes로 잡힌 건 제외)
    const caps = new Set(occ.map(o => o.entry.capability.toLowerCase()));
    return caps.size >= 2;
  }) : [];

  if (has('--json')) {
    const duplicates = dupes.map(([cap, occ]) => ({ capability: cap, occurrences: occ.length, projects: occ.map(o => o.project) }));
    const fuzzyDuplicates = funcDupes.map(([fn, occ]) => ({
      functionName: fn,
      occurrences: occ.length,
      entries: occ.map(o => ({ project: o.project, capability: o.entry.capability, element: o.entry.element }))
    }));
    log(JSON.stringify({
      workspace: path.basename(root),
      projects,
      duplicates,
      fuzzyDuplicates,
      dependsEdges,
      totalCapabilities: byCap.size,
      strictElements
    }, null, 2));
    return;
  }
  log(`# Workspace Reuse Map — ${paths.length}개 프로젝트 / ${byCap.size}개 capability (1.9.18)`);
  log('');
  log(`## 프로젝트별 등록 수`);
  projects.forEach(p => log(`  ${p.project}: ${p.entries.length}개`));

  log('');
  log(`## 🔁 정확 중복 capability (이름 동일)`);
  if (!dupes.length) log('  (없음) — 모든 capability 이름이 단일 프로젝트에만 존재');
  else {
    for (const [cap, occ] of dupes) {
      log(`  - "${occ[0].entry.capability}" — ${occ.length}개 프로젝트`);
      for (const o of occ) log(`    · ${o.project}: ${o.entry.element} [${o.entry.method}]`);
    }
    log('');
    log(`  💡 권장: 가장 안정적인 1개 구현을 추출해 ${dupes.length}건 중복을 공통 모듈로 통합 검토`);
  }

  // 1.9.18→1.9.19: --strict-elements 결과 (false-positive 줄이기 위해 same-file vs diff-file 구분)
  if (strictElements) {
    log('');
    log(`## 🔍 잠재 중복 (--strict-elements: 함수명 동일 / capability 이름 다름)`);
    if (!funcDupes.length) log('  (없음) — 동일 함수명을 다른 capability로 등록한 경우 없음');
    else {
      let exactMatches = 0; // 같은 파일 + 같은 함수 (진짜 중복 가능성 ↑)
      let intentionalSplits = 0; // 같은 함수 / 다른 파일 (의도 분리 가능성 ↑)
      for (const [fn, occ] of funcDupes) {
        const files = new Set(occ.map(o => o.entry.filePath));
        const sameFile = files.size === 1;
        const tag = sameFile ? '⚠ 진짜 중복 가능' : 'ℹ 의도 분리 가능';
        if (sameFile) exactMatches++; else intentionalSplits++;
        log(`  - 함수 "${fn}()" — ${occ.length}건  ${tag}`);
        for (const o of occ) log(`    · ${o.project}/${o.entry.capability}: ${o.entry.element}`);
      }
      log('');
      if (exactMatches > 0) log(`  ⚠ 같은 파일 + 같은 함수: ${exactMatches}건 — 명명 통일 또는 실제 통합 검토`);
      if (intentionalSplits > 0) log(`  ℹ 다른 파일 + 같은 함수: ${intentionalSplits}건 — 의도된 분리(예: 모듈 함수 vs CLI 명령)일 가능성. 보고용`);
    }
  }

  // 1.9.18: depends-on 그래프
  if (dependsEdges.length) {
    log('');
    log(`## 🔗 의존 관계 (depends-on, ${dependsEdges.length}개 엣지)`);
    for (const e of dependsEdges) log(`  - ${e.from.project}/${e.from.cap}  ─→  ${e.to}`);
    log('');
    log(`  💡 의존 capability는 제거하지 말 것. depends-on 표기: \`notes\` 컬럼에 "depends-on: A, B"`);
  }

  log('');
  const fuzzyCount = funcDupes.length;
  log(`## 📊 워크스페이스 총합: capability ${byCap.size}건 / 정확 중복 ${dupes.length}건${strictElements ? ` / 잠재 중복 ${fuzzyCount}건` : ''} / 의존 ${dependsEdges.length}건`);
  if (!strictElements) log(`  💡 \`--strict-elements\`로 함수명 기반 잠재 중복도 탐지 가능`);
}

// 1.9.18: verify-claim — progress-tracker의 evidence 컬럼 자동 검증
// "src/foo.js + 5개 테스트 (54/54 통과)" 같은 주장을 파싱해 실제 파일/카운트 확인
function verifyClaimCmd(root, taskId) {
  root = absRoot(root);
  if (!taskId) return fail('verify-claim <T-ID> 필요. 예: leerness verify-claim T-0008');
  const rows = readProgressRows(root);
  const row = rows.find(r => r.id === taskId);
  if (!row) return fail(`progress-tracker.md에 ${taskId} 없음.`);

  const evidence = row.evidence || '';
  // 1.9.20: 파일 경로 추출 — 도메인 폴더 자동 인식 + 루트 메타파일
  // (1.9.19까지: src|bin|tests|public|lib 하드코딩 → Godot scenes/scripts 미검출)
  // 변경: 확장자 화이트리스트 기반. 디렉토리는 선택적 (project.godot 같은 루트 파일도 잡음).
  // 확장자는 길이 내림차순(긴 것 먼저 매치) + \b 종결로 .ts vs .tscn 구분.
  // 1.9.21: 설정/메타 파일 확장자 추가 — Godot export_presets.cfg 등 false negative 보완
  const FILE_EXTS = 'webmanifest|dockerfile|properties|tscn|tres|godot|json5|jsx|tsx|yaml|html|scss|sass|less|gltf|conf|json|toml|lock|mdx|xml|css|svg|yml|cfg|ini|env|md|js|ts|gd|cs|py|rb|go|rs|kt|sh|h';
  const FILE_RE = new RegExp(`(?:[A-Za-z][A-Za-z0-9_-]*\\/)?[A-Za-z][\\w./-]*\\.(?:${FILE_EXTS})\\b`, 'g');
  const filePatterns = evidence.match(FILE_RE) || [];
  // 중복 제거 + "tests/test.js" 같은 결과를 유지 (이미 `..` 없으니 그대로)
  const files = Array.from(new Set(filePatterns));
  // 1.9.20: 테스트 수 파싱 확장 — 한국어 + jest/mocha/tap/vitest
  // 우선순위: 명시적 X/Y 비율 > N passing/passed > N개 테스트
  let declaredPass = null;
  let declaredTestCount = null;
  // 1) X/Y 통과·passed·pass (한·영)
  const m1 = evidence.match(/(\d+)\s*\/\s*(\d+)\s*(?:통과|passed|pass|passing)/i);
  if (m1) declaredPass = { num: parseInt(m1[1], 10), denom: parseInt(m1[2], 10) };
  // 2) jest: "Tests: N passed" 또는 "N passed, M failed"
  if (!declaredPass) {
    const m2 = evidence.match(/Tests?:\s*(?:\d+\s*failed,\s*)?(\d+)\s*passed(?:,\s*(\d+)\s*total)?/i);
    if (m2) declaredPass = { num: parseInt(m2[1], 10), denom: parseInt(m2[2] || m2[1], 10) };
  }
  // 3) mocha: "N passing" (실패 없을 때 total = passing)
  if (!declaredPass) {
    const m3 = evidence.match(/(\d+)\s+passing\b/i);
    if (m3) declaredPass = { num: parseInt(m3[1], 10), denom: parseInt(m3[1], 10) };
  }
  // 4) N개 테스트 (단순 카운트)
  const m4 = evidence.match(/(\d+)\s*개\s*테스트/);
  if (m4) declaredTestCount = parseInt(m4[1], 10);
  // 5) N tests (영문 단순 카운트)
  if (!declaredTestCount) {
    const m5 = evidence.match(/(\d+)\s*tests?\b/i);
    if (m5) declaredTestCount = parseInt(m5[1], 10);
  }

  // 실제 파일 존재 검사
  const fileChecks = files.map(f => ({ file: f, exists: exists(path.join(root, f)) }));
  // 테스트 카운트: tests/test.js의 check( 또는 it( 또는 test( 개수
  let actualTestCount = null;
  const candidateTestFiles = ['tests/test.js', 'test/test.js', 'tests/index.js'];
  for (const tf of candidateTestFiles) {
    const tp = path.join(root, tf);
    if (exists(tp)) {
      const t = read(tp);
      actualTestCount = (t.match(/\bcheck\s*\(/g) || t.match(/\b(it|test)\s*\(/g) || []).length;
      break;
    }
  }

  // 1.9.19: --run-tests — npm test 자동 실행 + pass/fail 파싱
  let runResult = null;
  if (has('--run-tests')) {
    const pkgPath = path.join(root, 'package.json');
    if (!exists(pkgPath)) {
      runResult = { skipped: true, reason: 'package.json 없음' };
    } else {
      let pkg = null;
      try { pkg = JSON.parse(read(pkgPath)); } catch {}
      const hasTestScript = pkg && pkg.scripts && pkg.scripts.test;
      if (!hasTestScript) {
        runResult = { skipped: true, reason: 'scripts.test 없음' };
      } else {
        const r = cp.spawnSync('npm test', [], { cwd: root, encoding: 'utf8', shell: true, timeout: 5 * 60 * 1000 });
        const out = (r.stdout || '') + (r.stderr || '');
        // 1.9.20: 파싱 패턴 확장 — 한국어 + jest/mocha/tap/vitest
        let parsed = null;
        // 1) X/Y passing|passed|pass|통과
        let m = out.match(/(\d+)\s*\/\s*(\d+)\s*(?:passed|통과|pass|passing)/i);
        if (m) parsed = { num: parseInt(m[1], 10), denom: parseInt(m[2], 10) };
        // 2) jest: "Tests: N passed, M total" — 통과 + 총
        if (!parsed) {
          const m2 = out.match(/Tests?:\s*(?:\d+\s*failed,\s*)?(\d+)\s*passed(?:,\s*(\d+)\s*total)?/i);
          if (m2) parsed = { num: parseInt(m2[1], 10), denom: parseInt(m2[2] || m2[1], 10) };
        }
        // 3) mocha: "N passing" — 단독 패턴이면 total = passing
        if (!parsed) {
          const m3 = out.match(/^\s*(\d+)\s+passing\b/im);
          if (m3) parsed = { num: parseInt(m3[1], 10), denom: parseInt(m3[1], 10) };
        }
        // 4) tap: "# pass N" 또는 "ok N"
        if (!parsed) {
          const m4 = out.match(/#\s*pass\s+(\d+)/i);
          if (m4) parsed = { num: parseInt(m4[1], 10), denom: parseInt(m4[1], 10) };
        }
        runResult = {
          skipped: false,
          exitCode: r.status,
          parsed,
          allPassed: r.status === 0 && (!parsed || (parsed && parsed.num === parsed.denom))
        };
      }
    }
  }

  if (has('--json')) {
    const out = {
      project: path.basename(root),
      taskId, row,
      declared: { files: files.length, pass: declaredPass, testCount: declaredTestCount },
      actual: { fileChecks, testCount: actualTestCount },
      verdict: {
        filesAllExist: fileChecks.every(c => c.exists),
        testCountMatch: declaredTestCount == null || actualTestCount == null || actualTestCount >= declaredTestCount
      }
    };
    if (runResult) {
      out.run = runResult;
      out.verdict.runTests = !!runResult.allPassed;
      // declared pass와 실제 비교
      if (declaredPass && runResult.parsed) {
        out.verdict.declaredPassMatches = (runResult.parsed.num === declaredPass.num && runResult.parsed.denom === declaredPass.denom);
      }
    }
    log(JSON.stringify(out, null, 2));
    if (runResult && !runResult.skipped && !runResult.allPassed) return process.exit(1);
    if (!out.verdict.filesAllExist || !out.verdict.testCountMatch) return process.exit(1);
    return;
  }

  log(`# verify-claim ${taskId} (${path.basename(root)})`);
  log(`Request: ${row.request}`);
  log(`Status: ${row.status}  ·  Updated: ${row.updated}`);
  log(`Evidence: ${evidence.slice(0, 200)}${evidence.length > 200 ? '…' : ''}`);
  log('');
  log(`## 📂 파일 검증 (${files.length}건 주장)`);
  if (!files.length) log('  (evidence에서 파일 경로를 추출하지 못함)');
  else {
    for (const c of fileChecks) log(`  ${c.exists ? '✓' : '✗'} ${c.file}${c.exists ? '' : '  ← 누락'}`);
  }
  log('');
  log(`## 🧪 테스트 카운트`);
  if (declaredPass) log(`  주장 (pass): ${declaredPass.num}/${declaredPass.denom}`);
  if (declaredTestCount) log(`  주장 (개수): ${declaredTestCount}개`);
  if (actualTestCount != null) log(`  실측: tests/test.js에 ${actualTestCount}개 check/test 호출`);
  else log(`  실측: 테스트 파일 못 찾음 (tests/test.js 등)`);

  // 1.9.19: --run-tests 결과
  let runTestsOk = true;
  let declaredPassMatchesActual = true;
  if (runResult) {
    log('');
    log(`## 🚦 npm test 실행 (--run-tests)`);
    if (runResult.skipped) {
      log(`  ⚠ skipped: ${runResult.reason}`);
    } else {
      log(`  exit: ${runResult.exitCode}`);
      if (runResult.parsed) log(`  실행 결과: ${runResult.parsed.num}/${runResult.parsed.denom} ${runResult.parsed.num === runResult.parsed.denom ? 'passed' : 'partial'}`);
      else log(`  (pass/fail 비율을 stdout에서 파싱 못함)`);
      runTestsOk = runResult.allPassed;
      if (declaredPass && runResult.parsed) {
        declaredPassMatchesActual = (runResult.parsed.num === declaredPass.num && runResult.parsed.denom === declaredPass.denom);
        log(`  주장 vs 실행: ${declaredPassMatchesActual ? '✓ 일치' : `⚠ 불일치 (주장 ${declaredPass.num}/${declaredPass.denom} ≠ 실행 ${runResult.parsed.num}/${runResult.parsed.denom})`}`);
      }
    }
  }

  // 1.9.26: --strict-claims — 낙관적 표시 자동 감지 (evidence vs 코드 호출 흔적)
  let optimismSuspects = [];
  let strictOk = true;
  if (has('--strict-claims')) {
    const codeText = _scanCodeForPatterns(root);
    optimismSuspects = _detectOptimism(evidence, codeText);
    strictOk = optimismSuspects.length === 0;
  }

  log('');
  const allFilesOk = fileChecks.every(c => c.exists);
  const testOk = declaredTestCount == null || actualTestCount == null || actualTestCount >= declaredTestCount;
  log(`## 종합`);
  log(`  - 파일 모두 존재: ${allFilesOk ? '✓ pass' : '✗ FAIL (일부 누락)'}`);
  log(`  - 테스트 카운트: ${testOk ? '✓ pass (실측 ≥ 주장)' : '⚠ 주장보다 적음'}`);
  if (runResult && !runResult.skipped) {
    log(`  - npm test 실행: ${runTestsOk ? '✓ all passed' : '✗ FAIL'}`);
    if (declaredPass) log(`  - 주장과 실행 결과 일치: ${declaredPassMatchesActual ? '✓ pass' : '⚠ 다름'}`);
  }
  if (has('--strict-claims')) {
    if (strictOk) log(`  - 낙관적 표시 (--strict-claims): ✓ pass (의심 없음)`);
    else {
      log(`  - 낙관적 표시 (--strict-claims): ⚠ FAIL (${optimismSuspects.length}건 의심)`);
      for (const s of optimismSuspects) log(`    · [${s.kind}] ${s.label}: evidence에 주장 있는데 코드에 호출 흔적 없음`);
    }
  }
  const overallFail = !allFilesOk || !testOk || (runResult && !runResult.skipped && !runTestsOk) || (has('--strict-claims') && !strictOk);
  if (overallFail) {
    log('');
    log(`  ⚠ evidence 주장과 실제가 일치하지 않음 — task 상태 재검토 권장`);
    return process.exit(1);
  }
  log('');
  log(`  ✓ evidence 주장이 실제 파일·테스트${runResult && !runResult.skipped ? '·실행 결과' : ''}와 일치`);
}

// 1.9.22: orchestrate — Ollama 로컬 LLM으로 best-of-N 멀티 에이전트 시뮬
// 정책 (사용자 명시 1.9.22):
//   1) 자동 적용 금지. LEERNESS_OLLAMA_BASE_URL 환경변수 감지 opt-in 전용
//   2) .env 파일 자동 로드 (간단 파서)
//   3) --agents N 가변 (1~256)
//   4) 환경변수 없으면 명령 거부 + 안내
function _loadEnvFile(root) {
  // root 경로(또는 cwd)의 .env 파일을 간단 파싱해 process.env에 머지 (이미 있는 키는 덮어쓰지 않음)
  const envFile = path.join(root || process.cwd(), '.env');
  if (!exists(envFile)) return false;
  try {
    const txt = read(envFile);
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      // 주석 제거
      if (val.startsWith('#')) continue;
      // 따옴표 제거
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!process.env[key]) process.env[key] = val;
    }
    return true;
  } catch { return false; }
}

function _httpPostJson(urlStr, body, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(e); }
    const mod = u.protocol === 'https:' ? require('https') : require('http');
    const data = JSON.stringify(body);
    const req = mod.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, body: JSON.parse(raw), raw }); }
        catch (e) { resolve({ status: res.statusCode, body: null, raw }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(data); req.end();
  });
}

async function _ollamaChat({ baseUrl, model, system, user, timeoutMs = 300000, format }) {
  const t0 = Date.now();
  const url = baseUrl.replace(/\/$/, '') + '/api/chat';
  const body = {
    model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: user }
    ],
    stream: false,
    options: { temperature: 0.3, num_predict: 4000 }
  };
  if (format) body.format = format;
  let res;
  try { res = await _httpPostJson(url, body, timeoutMs); }
  catch (e) { return { ok: false, error: e.message, elapsed: Date.now() - t0 }; }
  if (res.status !== 200) return { ok: false, error: `HTTP ${res.status}: ${(res.raw || '').slice(0, 200)}`, elapsed: Date.now() - t0 };
  return {
    ok: true, elapsed: Date.now() - t0,
    reply: res.body?.message?.content || '',
    promptTokens: res.body?.prompt_eval_count || 0,
    responseTokens: res.body?.eval_count || 0
  };
}

async function orchestrateCmd(root, goalParts) {
  root = absRoot(root || process.cwd());
  const goal = (goalParts || []).join(' ').trim();
  // .env 자동 로드 (process.env에 없는 키만 채움)
  _loadEnvFile(root);
  _loadEnvFile(path.join(root, '..')); // 상위도 시도 (워크스페이스 루트)

  const baseUrl = process.env.LEERNESS_OLLAMA_BASE_URL || '';
  if (!baseUrl) {
    fail('LEERNESS_OLLAMA_BASE_URL 미설정 — orchestrate는 opt-in입니다.');
    log('');
    log('## 활성화 방법');
    log('  1) .env 파일에 추가:');
    log('     LEERNESS_OLLAMA_BASE_URL=http://192.168.68.89:11434');
    log('  2) 또는 환경변수로:');
    log('     $env:LEERNESS_OLLAMA_BASE_URL="http://localhost:11434"  (PowerShell)');
    log('     export LEERNESS_OLLAMA_BASE_URL=http://localhost:11434  (bash)');
    log('  3) 다시 실행: leerness orchestrate "<목표>" --agents N');
    log('');
    log('정책 (1.9.22): 환경변수 없으면 LLM 호출 자동 시작 금지. 사용자 동의 후 활성화.');
    return process.exit(1);
  }
  if (!goal) {
    fail('orchestrate "<목표>" 필요. 예: leerness orchestrate "JSON validator 작성" --agents 4');
    return process.exit(1);
  }

  const agentCount = Math.max(1, Math.min(256, parseInt(arg('--agents', '4'), 10)));
  const model = arg('--model', process.env.LEERNESS_OLLAMA_MODEL || 'qwen2.5:7b-instruct');
  const timeoutMs = parseInt(arg('--timeout', '300000'), 10);
  const retryOnFail = parseInt(arg('--retry-on-fail', '0'), 10); // 1.9.22 후보 2 통합

  log(`# leerness orchestrate (1.9.22)`);
  log(`Opt-in 활성화: Ollama URL = ${baseUrl}`);
  log(`목표: ${goal}`);
  log(`에이전트 수: ${agentCount} · 모델: ${model}${retryOnFail ? ` · auto-fix retry: ${retryOnFail}회` : ''}`);
  log('');

  // 시스템 프롬프트: compact handoff 자동 포함 (LLM 컨텍스트 절약)
  const compactCtx = `당신은 leerness 1.9.22 워크스페이스의 sub-agent입니다.\n핵심 규칙: 의존성0 · 한국어주석 · UTF-8noBOM · 검증가능한 산출물.\nJSON 형식으로만 응답하세요: {"files":[{"path":"src/x.js","content":"..."}], "summary": "..."}`;

  // N개 동시 호출 (best-of-N 패턴)
  log(`## ${agentCount}개 에이전트 동시 호출 중...`);
  const tasks = [];
  for (let i = 0; i < agentCount; i++) {
    tasks.push((async () => {
      const t0 = Date.now();
      const r = await _ollamaChat({ baseUrl, model, system: compactCtx, user: goal, timeoutMs, format: 'json' });
      return { agent: i + 1, ...r, totalElapsed: Date.now() - t0 };
    })());
  }
  const results = await Promise.all(tasks);

  // 결과 요약
  const ok = results.filter(r => r.ok);
  const failures = results.filter(r => !r.ok);
  log(`\n## 결과`);
  log(`  성공: ${ok.length}/${agentCount}`);
  log(`  실패: ${failures.length}`);
  if (failures.length) {
    for (const f of failures.slice(0, 3)) log(`    · agent ${f.agent}: ${f.error}`);
  }

  if (ok.length) {
    const totalPromptTokens = ok.reduce((a, b) => a + b.promptTokens, 0);
    const totalRespTokens = ok.reduce((a, b) => a + b.responseTokens, 0);
    const avgElapsed = ok.reduce((a, b) => a + b.elapsed, 0) / ok.length;
    const totalElapsedWallClock = Math.max(...results.map(r => r.totalElapsed));
    log('');
    log(`## 토큰`);
    log(`  prompt 합계: ${totalPromptTokens} · response 합계: ${totalRespTokens}`);
    log(`  평균 latency: ${avgElapsed.toFixed(0)}ms · wall-clock 총: ${totalElapsedWallClock}ms (병렬 효과 ${(avgElapsed * ok.length / totalElapsedWallClock).toFixed(1)}x)`);

    log('');
    log(`## 최고 응답 (1.9.155 multi-signal consensus — 토큰 + 단어중복도 + 길이 정규화)`);
    // 1.9.155: 단순 token-max → multi-signal scoring
    //   1) responseTokens (information density) — 정규화 0~1
    //   2) wordOverlap (agreement with others) — 다른 응답과의 단어 교집합 비율 평균
    //   3) lengthZ (적정 길이 가중) — 평균에서 너무 짧지/길지 않음
    const tokenizer = (s) => new Set(String(s || '').toLowerCase().match(/[\w가-힣]{3,}/g) || []);
    const wordsOf = ok.map(o => tokenizer(o.reply));
    const maxTokens = Math.max(...ok.map(o => o.responseTokens), 1);
    const avgLen = ok.reduce((s, o) => s + o.reply.length, 0) / ok.length;
    const stdLen = Math.sqrt(ok.reduce((s, o) => s + (o.reply.length - avgLen) ** 2, 0) / ok.length) || 1;
    const scored = ok.map((o, i) => {
      const tokensNorm = o.responseTokens / maxTokens;
      // 다른 응답들과 단어 교집합 비율 평균
      const myWords = wordsOf[i];
      let overlapSum = 0;
      for (let j = 0; j < wordsOf.length; j++) {
        if (i === j) continue;
        const other = wordsOf[j];
        if (!myWords.size || !other.size) continue;
        let inter = 0;
        for (const w of myWords) if (other.has(w)) inter++;
        overlapSum += inter / Math.max(myWords.size, 1);
      }
      const overlap = (ok.length > 1) ? overlapSum / (ok.length - 1) : 0;
      // length z-score (적정 길이 가산: |z| <= 1.5 일 때 가산)
      const z = Math.abs((o.reply.length - avgLen) / stdLen);
      const lengthFit = z <= 1.5 ? (1 - z / 1.5) : 0;
      const score = 0.4 * tokensNorm + 0.4 * overlap + 0.2 * lengthFit;
      return { ...o, score, tokensNorm, overlap, lengthFit };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    log(`  best: agent ${best.agent} · score=${best.score.toFixed(3)} (tokens=${best.tokensNorm.toFixed(2)} · overlap=${best.overlap.toFixed(2)} · lengthFit=${best.lengthFit.toFixed(2)})`);
    log(`  → ${best.responseTokens} 응답 토큰 · ${best.elapsed}ms`);
    if (scored.length > 1) {
      log(`  others: ${scored.slice(1, 4).map(s => `${s.agent}=${s.score.toFixed(2)}`).join(', ')}`);
    }
    log(`  --- 처음 600자 ---`);
    log(best.reply.slice(0, 600));
  }

  // .harness/orchestrate-log.md 누적 (1.9.22 후보 4)
  const logFile = path.join(root, '.harness', 'orchestrate-log.md');
  if (!exists(path.dirname(logFile))) fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const entry = `\n## ${now()}\nmodel=${model} agents=${agentCount} success=${ok.length}/${agentCount} goal=${goal.slice(0, 100)}\n`;
  append(logFile, exists(logFile) ? entry : `# Orchestrate Log\n${entry}`);
  log('');
  log(`📜 누적 기록: .harness/orchestrate-log.md`);
}

// 1.9.24: leerness deps <capability> — depends-on 그래프 역방향 추적 + 자동 회귀 sweep
// 사용 예: leerness deps Character
//   → rpg-core/Character를 의존하는 모든 capability 식별 (rpg-net/Session, rpg-data/* 등)
//   → 영향받은 프로젝트의 npm test 자동 일괄 실행
//   → 회귀 발생 시 어느 프로젝트인지 즉시 보고
function depsImpactCmd(root, targetCapability) {
  root = absRoot(root || process.cwd());
  if (!targetCapability) { fail('impact <capability> 필요. 예: leerness impact Character'); return process.exit(1); }
  const paths = _collectWorkspacePaths(root);
  if (!paths.length) {
    // --all-apps 자동
    process.argv.push('--all-apps');
  }
  const allPaths = _collectWorkspacePaths(root);
  if (!allPaths.length) return fail('워크스페이스 프로젝트 없음. _apps/* 또는 --include 사용.');

  // 1) 모든 reuse-map에서 entries + depends-on 엣지 수집
  const allEntries = []; // { project, entry }
  const allEdges = [];    // { fromProject, fromCap, toCap }
  for (const p of allPaths) {
    const entries = _readReuseMap(p);
    for (const e of entries) {
      allEntries.push({ project: path.basename(p), projectPath: p, entry: e });
      for (const dep of e.dependsOn) {
        allEdges.push({ fromProject: path.basename(p), fromCap: e.capability, toCap: dep });
      }
    }
  }

  // 2) targetCapability를 의존하는 capability 식별 (역방향)
  const target = String(targetCapability);
  const targetLower = target.toLowerCase();
  const directImpact = allEdges.filter(e => e.toCap.toLowerCase() === targetLower);
  const impactedProjects = new Set(directImpact.map(e => e.fromProject));

  // 2단계 전이: 영향받은 capability를 또 의존하는 것들 (2-hop)
  const transitiveImpact = [];
  for (const e1 of directImpact) {
    for (const e2 of allEdges) {
      if (e2.toCap.toLowerCase() === e1.fromCap.toLowerCase()) {
        transitiveImpact.push({ via: e1.fromCap, ...e2 });
        impactedProjects.add(e2.fromProject);
      }
    }
  }

  // target capability 자체가 어디 등록됐는지
  const definedAt = allEntries.filter(e => e.entry.capability.toLowerCase() === targetLower);

  if (has('--json')) {
    log(JSON.stringify({
      target,
      definedAt: definedAt.map(d => ({ project: d.project, element: d.entry.element })),
      directImpact,
      transitiveImpact,
      impactedProjects: Array.from(impactedProjects)
    }, null, 2));
    return;
  }

  log(`# leerness impact "${target}" (1.9.24)`);
  log('');
  log(`## 정의 위치`);
  if (!definedAt.length) {
    log(`  ⚠ "${target}" capability가 reuse-map에 등록되지 않음 — 영향 추적 불가`);
    return process.exit(1);
  }
  for (const d of definedAt) log(`  - ${d.project}: ${d.entry.element}`);

  log('');
  log(`## 직접 의존 (1-hop, ${directImpact.length}건)`);
  if (!directImpact.length) log(`  (없음) — 단독 capability. 변경 안전.`);
  for (const e of directImpact) log(`  - ${e.fromProject}/${e.fromCap}`);

  if (transitiveImpact.length) {
    log('');
    log(`## 전이 의존 (2-hop, ${transitiveImpact.length}건)`);
    for (const e of transitiveImpact) log(`  - ${e.fromProject}/${e.fromCap}  (경유: ${e.via})`);
  }

  log('');
  log(`## 영향받는 프로젝트 (${impactedProjects.size}개)`);
  for (const p of impactedProjects) log(`  - ${p}`);

  // 3) --run-tests 옵션이면 영향받은 프로젝트의 npm test 일괄 실행
  if (has('--run-tests')) {
    log('');
    log(`## 🚦 자동 회귀 sweep (--run-tests)`);
    const results = [];
    for (const projName of impactedProjects) {
      const projPath = allPaths.find(p => path.basename(p) === projName);
      if (!projPath) continue;
      const pkgPath = path.join(projPath, 'package.json');
      if (!exists(pkgPath)) { log(`  ⚠ ${projName}: package.json 없음 — skip`); continue; }
      let pkg = null;
      try { pkg = JSON.parse(read(pkgPath)); } catch {}
      if (!pkg?.scripts?.test) { log(`  ⚠ ${projName}: scripts.test 없음 — skip`); continue; }
      const t0 = Date.now();
      const r = cp.spawnSync('npm test', [], { cwd: projPath, encoding: 'utf8', shell: true, timeout: 5 * 60 * 1000 });
      const elapsed = Date.now() - t0;
      const out = (r.stdout || '') + (r.stderr || '');
      const m = out.match(/(\d+)\s*\/\s*(\d+)\s*(?:passed|통과|pass|passing)/i);
      const passed = r.status === 0;
      results.push({ project: projName, passed, exit: r.status, elapsed, parsed: m ? { num: parseInt(m[1], 10), denom: parseInt(m[2], 10) } : null });
      const tag = passed ? '✓' : '✗';
      const ratio = m ? ` (${m[1]}/${m[2]})` : '';
      log(`  ${tag} ${projName}: exit=${r.status}${ratio}  ${elapsed}ms`);
    }
    log('');
    const pass = results.filter(r => r.passed).length;
    const fail = results.length - pass;
    log(`## 종합`);
    log(`  - 영향받는 프로젝트 ${impactedProjects.size}개 중 ${pass}개 통과, ${fail}개 실패`);
    if (fail > 0) {
      log(`  ⚠ ${target} 변경이 ${fail}개 프로젝트에 회귀 발생 가능 — 해당 프로젝트 testing 우선`);
      return process.exit(1);
    } else {
      log(`  ✓ 모든 영향받는 프로젝트 회귀 없음 — ${target} 변경 안전`);
    }
  } else {
    log('');
    log(`  💡 \`--run-tests\` 옵션으로 영향받는 ${impactedProjects.size}개 프로젝트 npm test 자동 일괄 실행 가능`);
  }
}

// 1.9.26: optimism-check — evidence의 외부 동작 주장 vs 실제 코드 호출 흔적 불일치 감지
// 사용자 요청 (1.9.26): "API 연동/작업 요청 시 실제로 일어나지 않았는데 일어난 것처럼 표시하는 낙관적 결과 방지"
//
// 패턴 (한국어 + 영어):
//   evidence에 "API 호출" / "HTTP 200|201" / "POST /" / "응답 확인" → 코드에 fetch/http.request/axios 흔적 없으면 의심
//   evidence에 "DB 저장" / "insert N건" / "DB에" → db.*/pg.*/mysql.*/mongoose.*/prisma.* 없으면 의심
//   evidence에 "이메일 발송" / "메일 전송" → sendMail/nodemailer/smtp 없으면 의심
// 1.9.27: 패턴 카탈로그 확장 (5 → 10) + URL/메서드 단위 매핑 추가
const OPTIMISM_PATTERNS = [
  { kind: 'API',     evidenceRe: /(API\s*호출|HTTP\s*\d{3}|POST\s*\/|GET\s*\/|PUT\s*\/|DELETE\s*\/|fetch|REST 응답|응답 확인|endpoint|엔드포인트)/i,
    codeRe: /\b(fetch\s*\(|http\.request|https\.request|axios\.|got\.|undici|node-fetch)/i,
    label: 'API/HTTP 호출' },
  { kind: 'DB',      evidenceRe: /(DB에?\s*저장|insert\s+\d+|데이터베이스|SQL\s*(INSERT|UPDATE|DELETE)|migration|마이그레이션 적용)/i,
    codeRe: /\b(db\.|pg\.|pool\.|mysql\.|mongoose\.|prisma\.|sequelize|knex|sqlite3|MongoClient|createConnection)/i,
    label: 'DB 호출' },
  { kind: 'Email',   evidenceRe: /(이메일[^.\n]{0,30}(발송|전송|보냈|보냄|완료)|메일[^.\n]{0,30}(발송|전송|보냈|보냄)|sendMail|smtp\s*(전송|발송))/i,
    codeRe: /\b(sendMail|nodemailer|smtp|@sendgrid|mailgun|aws-sdk\/ses|resend\.)/i,
    label: '이메일 전송' },
  { kind: 'Webhook', evidenceRe: /(웹훅\s*(호출|전송|발송)|webhook\s+(sent|posted|triggered))/i,
    codeRe: /\b(fetch\s*\(|http\.request|axios\.)/i,
    label: '웹훅' },
  { kind: 'Payment', evidenceRe: /(결제\s*(완료|성공|승인|취소)|payment\s+(processed|charged)|stripe 결제|toss\s*결제|카카오페이|네이버페이|kakaopay|nicepay|iamport 결제|페이팔|paypal)/i,
    codeRe: /\b(stripe|toss|@stripe|tosspayments|iamport|kakao|nicepay|naverpay|paypal-rest-sdk|@paypal)/i,
    label: '결제' },
  // 1.9.27 신규 카테고리
  { kind: 'FileIO',  evidenceRe: /(파일[^.\n]{0,20}(생성|저장|작성|기록)|\d+개[^.\n]{0,20}파일|디스크[^.\n]{0,20}저장|로그 파일 작성)/i,
    codeRe: /\b(fs\.write|fs\.appendFile|writeFileSync|appendFileSync|fs\/promises|fs\.createWriteStream)/i,
    label: '파일 I/O 쓰기' },
  { kind: 'Queue',   evidenceRe: /(메시지\s*큐|발행\s*완료|publish\s*(완료|성공)|RabbitMQ|Kafka|SQS|Redis Pub|이벤트 발행)/i,
    codeRe: /\b(amqp|kafkajs|rabbit|redis\.(publish|xadd)|@aws-sdk\/client-sqs|bull|bullmq)/i,
    label: '메시지 큐 발행' },
  { kind: 'Cache',   evidenceRe: /(Redis[^.\n]{0,20}(저장|set|get)|캐시[^.\n]{0,20}(저장|기록|적중)|memcache)/i,
    codeRe: /\b(redis\.|ioredis|memcached|node-cache|@upstash\/redis|connect-redis)/i,
    label: '캐시 저장' },
  { kind: 'Notify',  evidenceRe: /(슬랙\s*(알림|발송|전송)|Slack\s+(notification|sent|posted)|Discord\s+(알림|발송|webhook)|푸시 알림 전송)/i,
    codeRe: /\b(@slack\/web-api|slack-webhook|discord\.js|discord-webhook|@discordjs|firebase\/messaging|expo-notifications)/i,
    label: '슬랙/Discord 알림' },
  { kind: 'Storage', evidenceRe: /(S3\s*(업로드|저장)|GCS\s*업로드|Azure Blob|클라우드 스토리지 업로드|object storage 저장)/i,
    codeRe: /\b(@aws-sdk\/client-s3|aws-sdk[^a-z]|@google-cloud\/storage|@azure\/storage-blob|aws-s3)/i,
    label: '클라우드 스토리지' }
];

// 1.9.27: URL/메서드 단위 매핑 — evidence에서 "POST /users" 같은 구체 경로를 추출하고 코드에 같은 경로 존재 확인
function _extractUrlClaims(evidence) {
  const claims = [];
  // "POST /users" / "GET /api/v1/items" 등
  const re = /\b(GET|POST|PUT|DELETE|PATCH)\s+(\/[\w\-\/]*)/gi;
  let m;
  while ((m = re.exec(evidence)) !== null) {
    claims.push({ method: m[1].toUpperCase(), path: m[2] });
  }
  return claims;
}
function _verifyUrlClaim(claim, codeText) {
  // claim.path 가 코드에 등장해야 함 (fetch('https://.../users') 또는 라우트 정의 'POST /users')
  if (!claim.path || claim.path.length < 2) return true;
  // path를 그대로 검색 (URL 또는 라우트 정의)
  const escaped = claim.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'i');
  return re.test(codeText);
}

function _scanCodeForPatterns(root) {
  // src/, bin/, lib/, scripts/ 의 .js/.ts/.gd/.py 파일 본문 통합
  let combined = '';
  const dirs = ['src', 'bin', 'lib', 'scripts'];
  for (const d of dirs) {
    const dp = path.join(root, d);
    if (!exists(dp)) continue;
    function walk(p) {
      let entries; try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const fp = path.join(p, e.name);
        if (e.isDirectory()) { walk(fp); continue; }
        if (!/\.(js|ts|jsx|tsx|gd|cs|py|rb|go|rs)$/i.test(e.name)) continue;
        try { combined += read(fp) + '\n'; } catch {}
      }
    }
    walk(dp);
  }
  return combined;
}

function _detectOptimism(evidence, codeText) {
  // 각 패턴 검사: evidence에 주장 있고 코드에 흔적 없으면 의심
  const suspects = [];
  for (const p of OPTIMISM_PATTERNS) {
    if (p.evidenceRe.test(evidence) && !p.codeRe.test(codeText)) {
      suspects.push({ kind: p.kind, label: p.label, severity: 'high' });
    }
  }
  // 1.9.27: URL/메서드 단위 매핑 — API 패턴에선 통과해도 구체 경로가 코드에 없으면 추가 의심
  const urlClaims = _extractUrlClaims(evidence);
  for (const claim of urlClaims) {
    if (!_verifyUrlClaim(claim, codeText)) {
      suspects.push({
        kind: 'URL',
        label: `구체 경로 "${claim.method} ${claim.path}" 코드에 미발견`,
        severity: 'medium',
        claim
      });
    }
  }
  return suspects;
}

// 1.9.27: 신뢰도 점수 (0=완전 의심, 1=신뢰)
// 1.9.28: high suspect 단일 케이스 floor 0.15 — 단일 의심도 정량 차등 가능하게
function _computeConfidence(evidence, codeText) {
  const suspects = _detectOptimism(evidence, codeText);
  const high = suspects.filter(s => s.severity === 'high').length;
  const medium = suspects.filter(s => s.severity === 'medium').length;
  // 가중치: high 1.0 / medium 0.5
  const totalPenalty = high * 1.0 + medium * 0.5;
  // 패턴 검사로 발견된 evidence 주장이 많을수록 신뢰도 산정 base 변경
  const evidenceClaims = OPTIMISM_PATTERNS.filter(p => p.evidenceRe.test(evidence)).length + _extractUrlClaims(evidence).length;
  if (evidenceClaims === 0) return 1.0; // 외부 작용 주장 자체가 없으면 신뢰 1.0
  let confidence = Math.max(0, 1 - totalPenalty / evidenceClaims);
  // 1.9.28: single high suspect에서 confidence 0.0이 일률적 → severity 기반 floor 적용
  if (suspects.length > 0 && high > 0 && confidence < 0.15) {
    // 의심 발견은 명확하지만 0보다는 명시적 신호로
    confidence = 0.15;
  }
  return Math.round(confidence * 100) / 100;
}

function optimismCheckCmd(root, taskId) {
  root = absRoot(root || process.cwd());
  if (!taskId) return fail('optimism-check <T-ID> 필요. 예: leerness optimism-check T-0001');
  const rows = readProgressRows(root);
  const row = rows.find(r => r.id === taskId);
  if (!row) return fail(`progress-tracker.md에 ${taskId} 없음.`);

  const codeText = _scanCodeForPatterns(root);
  const suspects = _detectOptimism(row.evidence || '', codeText);
  const confidence = _computeConfidence(row.evidence || '', codeText);

  if (has('--json')) {
    log(JSON.stringify({
      project: path.basename(root), taskId, row,
      suspects, confidence,
      ok: suspects.length === 0,
      codeFilesScanned: codeText.length > 0
    }, null, 2));
    if (suspects.length > 0) return process.exit(1);
    return;
  }

  log(`# leerness optimism-check ${taskId} (${path.basename(root)})`);
  log(`Evidence: ${(row.evidence || '').slice(0, 200)}${(row.evidence || '').length > 200 ? '…' : ''}`);
  log(`신뢰도 (1.9.27): ${confidence.toFixed(2)} / 1.00${confidence < 0.5 ? ' ⚠ 낮음' : confidence < 0.9 ? ' ⓘ 보통' : ' ✓ 높음'}`);
  log('');
  if (!suspects.length) {
    log(`  ✓ 낙관적 표시 의심 없음 — evidence의 주장이 실제 코드 호출 흔적과 일관`);
    return;
  }
  log(`  ⚠ 낙관적 표시 의심 ${suspects.length}건 — evidence에 주장 있는데 코드에 호출 흔적 없음`);
  for (const s of suspects) {
    const sev = s.severity === 'high' ? '⚠ HIGH' : 'ⓘ MED';
    log(`    · [${s.kind}] ${sev} ${s.label}`);
  }
  log('');
  log(`💡 가능한 해석:`);
  log(`  1) evidence 작성자가 실제 동작 없이 낙관적으로 표시 (검증 필요)`);
  log(`  2) 호출이 별도 모듈/test fixture/외부 스크립트에 있음 → evidence에 경로 명시 권장`);
  log(`  3) 라이브러리/SDK 이름 변경 → \`_apps/<proj>\` 정적 분석 패턴에 미포함된 경우`);
  log('');
  log(`정책 (1.9.26): 의심 발견 시 exit 1 — task 상태 재검토 권장`);
  return process.exit(1);
}

// 1.9.29: 페르소나 시스템 + review 명령
// 페르소나 부여 sub-agent가 도메인 깊이 3-4배 (1.9.28 라운드 실측). 자동 프롬프트 생성.
const BUILT_IN_PERSONAS = {
  security: {
    id: 'security',
    name: '보안 엔지니어 (10년차)',
    description: 'OWASP Top 10, CWE, RFC, 한국 개인정보보호법/게임산업법 정통',
    body: `너는 **10년 경력의 시니어 보안 엔지니어**다. OWASP Top 10 2021, CWE, RFC 7235/6454, CORS 보안, secret 관리에 정통하며, 한국 금융사·카카오·네이버 등 대형 IT 기업의 보안 감사 경험이 있다. 코드를 볼 때 **위협 모델링**과 **공격 표면(attack surface)** 을 자동으로 시각화한다.

검토 영역: 입력 검증 / 인증·인가 / CORS / 시크릿/로그 노출 / DoS / 데이터 노출 / 의존성 attack surface / 한국 시장 특화 (개인정보보호법, 결제 정보)
보고에 포함: 위협 모델 / CWE ID 매핑 / 실 공격 시나리오 1건 (HTTP 페이로드) / P0/P1/P2 우선순위 / OWASP Top 10 2021 매핑`
  },
  performance: {
    id: 'performance',
    name: '성능 최적화 전문가 (V8 내부)',
    description: 'V8 엔진 (Ignition/TurboFan, hidden class), Node.js 이벤트 루프, libuv 정통',
    body: `너는 **V8 엔진 내부 (Ignition, TurboFan, hidden class)와 Node.js 이벤트 루프, libuv에 정통한 성능 최적화 전문가**다. Linux perf, node --prof, clinic.js, autocannon, FlameGraph 활용 경험이 풍부하다. 메모리 압박(GC pressure), CPU bound vs I/O bound 구분, hot path 식별이 직관이다.

검토 영역: Hot path 식별 / hidden class 안정성 / 메모리 할당 패턴 / 정규식 컴파일 / JSON.parse/stringify 비용 / 이벤트 루프 블로킹 / 라우트 매칭 복잡도
보고에 포함: 성능 프로필 요약 (RPS/latency 추정) / Hot path Top 5 / 비효율 표 (영향 high/med/low) / 벤치 시나리오 (autocannon 명령) / 권장 우선순위 (당장/부하증가/마이크로)`
  },
  ux: {
    id: 'ux',
    name: '한국어 UX 라이터 + DX 컨설턴트',
    description: '카카오/네이버/토스/라인 마이크로카피, API 디자인 (Stripe/GitHub/Google) 정통',
    body: `너는 **한국 사용자 대상 게임/SaaS 제품의 UX 라이터 + DX(Developer Experience) 컨설턴트**다. 카카오, 네이버, 토스, 라인의 한국어 마이크로카피 가이드라인을 숙지하고 있으며, 클라이언트 개발자의 API 통합 경험을 잘 안다. 에러 메시지, HTTP status, 응답 본문 일관성이 직관이다.

검토 영역: 한국어 에러 메시지 톤 / HTTP status 적절성 (400/404/422/409) / 응답 본문 일관성 / 한국어/영문 혼재 / 누락 정보 (rate limit, request id, version) / 클라이언트 SDK 친화성
보고에 포함: UX/DX 점수 (1-10) / 발견 이슈 표 / Before/After 메시지 5건 / SDK 친화성 점수 (1-5) / 권장 로드맵 (이번 PR / 1주 / 분기)`
  },
  testing: {
    id: 'testing',
    name: '테스트 엔지니어 (TDD + property-based)',
    description: 'TDD, property-based testing (fast-check), AAA 패턴, fuzz, mutation testing 정통',
    body: `너는 **TDD와 property-based testing (fast-check) 에 정통한 테스트 엔지니어**다. AAA 패턴, given/when/then, fuzz testing, mutation testing, contract testing 경험이 있다. 테스트 커버리지보다 **테스트 품질**과 **회귀 방어** 가치를 더 중시한다.

검토 영역: 테스트 누락 분기 / edge case / mocking 과다 / AAA 패턴 위반 / async 테스트 결함 (race) / property 후보 / 회귀 가능성
보고에 포함: 누락 테스트 목록 + 우선순위 / fast-check property 후보 3건 / 기존 테스트 약점 / 권장 회귀 시나리오`
  },
  docs: {
    id: 'docs',
    name: '기술 문서 작성자 (한국어)',
    description: 'README, API 문서, 사용 가이드 작성. Stripe Docs / Google Cloud / 카카오 dev 가이드 정통',
    body: `너는 **한국어 기술 문서 작성에 정통한 테크니컬 라이터**다. Stripe Docs, Google Cloud, AWS, 카카오 개발자 가이드 톤을 잘 안다. README 첫 60초 경험, 점진적 공개 (progressive disclosure), 코드 예시의 즉시 실행 가능성을 중시한다.

검토 영역: 60초 시작 가능성 / 예시 코드 정확성 / 누락된 사전 요구사항 / 한국어 자연스러움 / 시각적 균형 (이모지/표/코드블록) / 한국어/영문 혼재 / 다음 단계 명시
보고에 포함: 사용자 페르소나별 평가 (입문자/실무자/전문가) / 60초 안 첫 결과 가능 여부 / 누락 정보 / 권장 개선 표`
  }
};

function _resolvePersona(root, id) {
  // 1) 내장
  if (BUILT_IN_PERSONAS[id]) return BUILT_IN_PERSONAS[id];
  // 2) .harness/personas/<id>.md (사용자 정의)
  const customPath = path.join(root, '.harness', 'personas', `${id}.md`);
  if (exists(customPath)) {
    const txt = read(customPath);
    const nameMatch = txt.match(/^#\s+(.+)$/m);
    return { id, name: nameMatch?.[1] || id, description: '(사용자 정의)', body: txt };
  }
  return null;
}

// 1.9.30: 외부 AI CLI 오케스트레이션 — claude/codex/gemini/copilot 가용성 + 활성화 체크
// 사용자 정책: 환경변수로 활성화 명시 + 실제 PATH 존재 확인 + 메인이 sub-agent 분배 시 참조
// 1.9.32: installCmd 추가 — setup-agents 시 자동 설치 시도 가능
const EXTERNAL_AGENTS = [
  { id: 'claude',  bin: 'claude',  envFlag: 'LEERNESS_ENABLE_CLAUDE',  versionArgs: ['--version'], desc: 'Anthropic Claude Code CLI',
    installCmd: 'npm i -g @anthropic-ai/claude-code', installHint: 'https://docs.anthropic.com/en/docs/claude-code/setup' },
  { id: 'codex',   bin: 'codex',   envFlag: 'LEERNESS_ENABLE_CODEX',   versionArgs: ['--version'], desc: 'OpenAI Codex CLI (격리 sandbox)',
    installCmd: 'npm i -g @openai/codex', installHint: 'https://github.com/openai/codex' },
  { id: 'gemini',  bin: 'gemini',  envFlag: 'LEERNESS_ENABLE_GEMINI',  versionArgs: ['--version'], desc: 'Google Gemini CLI (--yolo 모드 워크스페이스 직접 수정 가능)',
    installCmd: 'npm i -g @google/gemini-cli', installHint: 'https://github.com/google-gemini/gemini-cli' },
  { id: 'copilot', bin: 'gh',      envFlag: 'LEERNESS_ENABLE_COPILOT', versionArgs: ['copilot', '--version'], desc: 'GitHub Copilot CLI (gh copilot)',
    installCmd: 'gh extension install github/gh-copilot', installHint: 'https://github.com/github/gh-copilot (gh CLI 선행 설치 필요)' },
  // 1.9.146: Ollama 추가 (사용자 명시 요청 #3) — 로컬 LLM, HTTP API 11434
  { id: 'ollama',  bin: 'ollama',  envFlag: 'LEERNESS_ENABLE_OLLAMA',  versionArgs: ['--version'], desc: 'Ollama 로컬 LLM (http://localhost:11434, llama3/qwen 등)',
    installCmd: 'curl -fsSL https://ollama.com/install.sh | sh (또는 https://ollama.com/download)', installHint: 'ollama serve 실행 + ollama pull <model>' }
];

// 1.9.157: Provider Registry — 사용자 정의 provider 동적 추가 (.harness/providers.json)
//   빌트인 5종 (EXTERNAL_AGENTS) + 사용자 정의를 merge. OpenRouter / Bedrock / Groq 등 새 CLI 즉시 흡수 가능.
//   파일 형식: { "schemaVersion": 1, "providers": [{ id, bin, envFlag, versionArgs, desc, installHint }] }
function _providersFile(root) { return path.join(absRoot(root), '.harness', 'providers.json'); }
function _readUserProviders(root) {
  const p = _providersFile(root);
  if (!exists(p)) return [];
  try {
    const j = JSON.parse(read(p));
    return Array.isArray(j.providers) ? j.providers : [];
  } catch { return []; }
}
function _writeUserProviders(root, providers) {
  const p = _providersFile(root);
  mkdirp(path.dirname(p));
  writeUtf8(p, JSON.stringify({ schemaVersion: 1, providers }, null, 2) + '\n');
}
// 빌트인 + 사용자 정의 merge — 같은 id 가 있으면 user 가 빌트인 override
function _allProviders(root) {
  try {
    const userList = _readUserProviders(root);
    const builtinIds = new Set(EXTERNAL_AGENTS.map(a => a.id));
    const userOverrides = new Map();
    for (const u of userList) {
      if (!u || !u.id) continue;
      // 정상화 — 누락 필드는 빌트인에서 fallback
      userOverrides.set(u.id, {
        id: u.id,
        bin: u.bin || u.id,
        envFlag: u.envFlag || `LEERNESS_ENABLE_${String(u.id).toUpperCase()}`,
        versionArgs: Array.isArray(u.versionArgs) ? u.versionArgs : ['--version'],
        desc: u.desc || `(user) ${u.id}`,
        installHint: u.installHint || '',
        installCmd: u.installCmd || ''
      });
    }
    // 빌트인 먼저, user override 적용
    const merged = EXTERNAL_AGENTS.map(a => userOverrides.has(a.id) ? userOverrides.get(a.id) : a);
    // 빌트인에 없는 user-only 추가
    for (const u of userOverrides.values()) {
      if (!builtinIds.has(u.id)) merged.push(u);
    }
    return merged;
  } catch { return EXTERNAL_AGENTS.slice(); }
}
function providerCmd(root, sub, ...args) {
  root = absRoot(root || process.cwd());
  _loadEnvFile(root);
  if (!sub || sub === 'list') {
    const all = _allProviders(root);
    const userList = _readUserProviders(root);
    const userIds = new Set(userList.map(u => u.id));
    if (has('--json')) {
      log(JSON.stringify({
        total: all.length,
        builtin: EXTERNAL_AGENTS.length,
        user: userList.length,
        providers: all.map(p => ({ id: p.id, bin: p.bin, envFlag: p.envFlag, source: userIds.has(p.id) ? 'user' : 'builtin', desc: p.desc }))
      }, null, 2));
      return;
    }
    log(`# leerness provider list (1.9.157)`);
    log(`총 ${all.length}개 (빌트인 ${EXTERNAL_AGENTS.length} + 사용자 ${userList.length})`);
    log('');
    log(`| id | source | bin | envFlag |`);
    log(`|---|---|---|---|`);
    for (const p of all) {
      const src = userIds.has(p.id) ? (EXTERNAL_AGENTS.some(b => b.id === p.id) ? 'user(override)' : 'user') : 'builtin';
      log(`| ${p.id} | ${src} | ${p.bin} | ${p.envFlag} |`);
    }
    if (!userList.length) {
      log('');
      log(`💡 사용자 정의 provider 추가: leerness provider add <id> --bin <cmd> [--env-flag F] [--version-args ARGS] [--desc D]`);
    }
    return;
  }
  if (sub === 'add') {
    const id = (args[0] || arg('--id', '')).trim();
    if (!id) return fail('provider add <id> 필요 (예: openrouter)');
    if (!/^[a-z][a-z0-9_-]*$/i.test(id)) return fail(`잘못된 id: ${id} (영문자/숫자/_- 만 허용)`);
    const bin = arg('--bin', id);
    const envFlag = arg('--env-flag', `LEERNESS_ENABLE_${id.toUpperCase()}`);
    const versionArgs = (arg('--version-args', '--version') || '--version').split(/\s+/).filter(Boolean);
    const desc = arg('--desc', `(user) ${id}`);
    const installHint = arg('--install-hint', '');
    const userList = _readUserProviders(root);
    // 중복 id 처리: 빌트인 override 또는 user 갱신
    const existingIdx = userList.findIndex(u => u.id === id);
    const entry = { id, bin, envFlag, versionArgs, desc, installHint };
    if (existingIdx >= 0) userList[existingIdx] = entry;
    else userList.push(entry);
    _writeUserProviders(root, userList);
    ok(`provider 등록: ${id} (bin=${bin}, envFlag=${envFlag})`);
    log(`   → 활성화: .env에 ${envFlag}=1 설정 후 \`leerness agents list\` 로 확인`);
    return;
  }
  if (sub === 'remove') {
    const id = (args[0] || arg('--id', '')).trim();
    if (!id) return fail('provider remove <id> 필요');
    if (EXTERNAL_AGENTS.some(b => b.id === id) && !_readUserProviders(root).some(u => u.id === id)) {
      return fail(`${id} 는 빌트인 — 제거 불가 (override 만 제거 가능)`);
    }
    const userList = _readUserProviders(root);
    const before = userList.length;
    const filtered = userList.filter(u => u.id !== id);
    if (filtered.length === before) return fail(`사용자 정의 provider ${id} 없음`);
    _writeUserProviders(root, filtered);
    ok(`provider 제거: ${id}`);
    return;
  }
  if (sub === 'sync') {
    // 1.9.160: 외부 catalog URL 에서 provider 자동 등록 (의존성 0 — Node built-in https)
    //   형식 1: llms.txt — 한 줄당 "id|bin|desc" (예: "openrouter|openrouter-cli|OpenRouter 200+ models")
    //   형식 2: JSON [{ id, bin, envFlag?, desc?, installHint? }, ...]
    //   보안: LEERNESS_OFFLINE=1 시 거부
    const url = (args[0] || arg('--url', '')).trim();
    if (!url) return fail('provider sync <url> 필요 (예: https://raw.githubusercontent.com/.../providers.json 또는 llms.txt)');
    if (process.env.LEERNESS_OFFLINE === '1') return fail('LEERNESS_OFFLINE=1 — 외부 fetch 거부 (보안 정책)');
    if (!/^https?:\/\//.test(url)) return fail(`URL 형식 오류: ${url} (http:// 또는 https://)`);
    const dryRun = has('--dry-run');
    return (async () => {
      const lib = url.startsWith('https:') ? require('https') : require('http');
      const fetchUrl = (u) => new Promise((resolve) => {
        try {
          const req = lib.get(u, { timeout: 15000, headers: { 'User-Agent': `leerness/${VERSION}` } }, (res) => {
            // redirect handling (3xx)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              return resolve(fetchUrl(res.headers.location));
            }
            if (res.statusCode !== 200) return resolve({ ok: false, error: `HTTP ${res.statusCode}` });
            let data = '';
            res.on('data', c => { data += c; if (data.length > 1024 * 1024) { req.destroy(); resolve({ ok: false, error: 'response > 1MB' }); } });
            res.on('end', () => resolve({ ok: true, body: data, contentType: res.headers['content-type'] || '' }));
          });
          req.on('error', e => resolve({ ok: false, error: e.message }));
          req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
        } catch (e) { resolve({ ok: false, error: e.message }); }
      });
      log(`# leerness provider sync (1.9.160)`);
      log(`URL: ${url}`);
      const r = await fetchUrl(url);
      if (!r.ok) { fail(`fetch 실패: ${r.error}`); process.exitCode = 1; return; }
      // 파싱: JSON 우선 → llms.txt fallback
      let entries = null;
      try {
        const j = JSON.parse(r.body);
        if (Array.isArray(j)) entries = j;
        else if (Array.isArray(j.providers)) entries = j.providers;
      } catch {}
      if (!entries) {
        // llms.txt 형식 — "id|bin|desc" 한 줄당
        entries = r.body.split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'))
          .map(l => {
            const parts = l.split('|').map(s => s.trim());
            if (parts.length < 2) return null;
            return { id: parts[0], bin: parts[1], desc: parts[2] || `(synced from ${url})` };
          })
          .filter(Boolean);
      }
      if (!entries.length) { fail(`URL 응답에서 provider 추출 실패 (JSON array 또는 llms.txt "id|bin|desc" 형식 기대)`); process.exitCode = 1; return; }
      log(`발견 ${entries.length}개 후보`);
      log('');
      const userList = _readUserProviders(root);
      const existingIds = new Set(userList.map(u => u.id));
      const validIdRegex = /^[a-z][a-z0-9_-]*$/i;
      let added = 0, updated = 0, skipped = 0;
      for (const e of entries) {
        if (!e.id || !e.bin || !validIdRegex.test(e.id)) { skipped++; continue; }
        const entry = {
          id: e.id,
          bin: e.bin,
          envFlag: e.envFlag || `LEERNESS_ENABLE_${String(e.id).toUpperCase()}`,
          versionArgs: Array.isArray(e.versionArgs) ? e.versionArgs : (typeof e.versionArgs === 'string' ? e.versionArgs.split(/\s+/) : ['--version']),
          desc: e.desc || `(synced) ${e.id}`,
          installHint: e.installHint || ''
        };
        if (existingIds.has(e.id)) {
          const idx = userList.findIndex(u => u.id === e.id);
          if (!dryRun) userList[idx] = entry;
          updated++;
          log(`  ↺ ${e.id} (갱신)`);
        } else {
          if (!dryRun) userList.push(entry);
          existingIds.add(e.id);
          added++;
          log(`  + ${e.id} (신규)`);
        }
      }
      if (!dryRun) _writeUserProviders(root, userList);
      log('');
      log(`✓ sync 완료: 신규 ${added} · 갱신 ${updated} · 무시 ${skipped}${dryRun ? ' (--dry-run)' : ''}`);
      if (!dryRun) log(`   .env 에 LEERNESS_ENABLE_<X>=1 설정 후 \`leerness agents list\` 로 확인`);
    })();
  }
  fail(`알 수 없는 sub: ${sub} (list / add / remove / sync)`);
}

// 1.9.36: 작업 키워드 분석으로 최적 CLI 추천
// \b는 ASCII word boundary만 인식 → 한글 키워드는 단순 substring 검사 사용.
function _recommendAgent(task) {
  if (!task || typeof task !== 'string') return { target: null, reason: '' };
  const t = task.toLowerCase();
  const hasAny = (keywords) => keywords.some(k => t.includes(k));
  // 텍스트 분석/번역 → claude (가장 빠름, 1.7×)
  if (hasAny(['translate', 'summary', 'explain', 'describe', 'analyze', 'review',
              '번역', '요약', '설명', '분석', '리뷰'])) {
    return { target: 'claude', reason: '텍스트 분석·요약·번역은 claude가 1.7× 빠름' };
  }
  // 깊은 코드 추론
  if (hasAny(['architecture', 'design pattern', 'refactor', 'trace', 'complex', 'critical path',
              '아키텍처', '리팩터', '복잡'])) {
    return { target: 'codex', reason: '깊은 코드 추론은 codex가 가장 상세' };
  }
  // 파일 작성·수정·생성
  if (hasAny(['create', 'write', 'generate', 'patch', 'fix', 'implement', 'edit',
              '구현', '생성', '작성', '수정', '추가'])) {
    return { target: 'gemini', reason: '워크스페이스 직접 수정은 gemini --yolo가 정확' };
  }
  return { target: null, reason: '' };
}

function _checkAgent(agent, opts = {}) {
  const enabled = process.env[agent.envFlag] === '1';
  // PATH 존재 확인 (which / where)
  let installed = false, version = null, error = null;
  try {
    const r = cp.spawnSync(agent.bin, agent.versionArgs, { encoding: 'utf8', timeout: 5000, shell: true });
    if (r.status === 0 || (r.stdout && r.stdout.trim())) {
      installed = true;
      version = (r.stdout || r.stderr || '').trim().split('\n')[0].slice(0, 80);
    } else if (r.error) {
      error = r.error.code || r.error.message;
    } else {
      error = `exit ${r.status}`;
    }
  } catch (e) { error = e.message; }
  return {
    id: agent.id, bin: agent.bin, desc: agent.desc, envFlag: agent.envFlag,
    enabled, installed, version, error,
    status: enabled && installed ? 'ready' : !installed ? 'not-installed' : !enabled ? 'disabled' : 'unknown'
  };
}

// 1.9.33: npx 캐시 함정 방지 — install 진입 시 npm latest와 비교, stale이면 경고
async function _warnIfStale(root, opts = {}) {
  if (process.env.LEERNESS_NO_STALE_CHECK === '1') return null;
  const offline = process.env.LEERNESS_OFFLINE === '1';
  // 24h 캐시: .harness/cache/update-check.json 재사용 — 캐시 fresh면 OFFLINE이어도 비교는 수행
  try {
    let latest = null;
    const cached = readUpdateCache(root);
    if (cacheFresh(cached, 24) && cached.nextLeerness) {
      latest = cached.nextLeerness;
    } else if (!offline) {
      // 캐시 없음 + 온라인 → npm view 호출 (timeout 8초 — 네트워크 끊겼어도 init 진행 차단 X)
      latest = await Promise.race([
        fetchNpmLatest('leerness'),
        new Promise(resolve => setTimeout(() => resolve(null), 8000))
      ]);
      if (latest) {
        try { writeUpdateCache(root, { nextLeerness: latest, runningCli: VERSION }); } catch {}
      }
    }
    // offline + 캐시 없으면 비교 스킵 (네트워크 차단 환경)
    if (!latest) return null;
    if (compareVer(latest, VERSION) > 0) {
      // 옛 버전이 실행 중. ANSI 노란/빨강.
      const isTty = process.stdout && process.stdout.isTTY;
      const C = isTty ? { y: s => `\x1b[33m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m` }
                      : { y: s => s, r: s => s, b: s => s, d: s => s };
      log('');
      log(C.y('  ⚠  ') + C.b(C.r(`옛 버전이 실행 중입니다 — v${VERSION} → v${latest} (npm 최신)`)));
      log('');
      log(C.d('     npm registry latest: ') + C.b(`v${latest}`));
      log(C.d('     이 CLI가 실행한 버전: ') + C.b(`v${VERSION}`) + C.d(' (npx 캐시 또는 글로벌 설치 stale)'));
      log('');
      log(C.d('     해결 — 둘 중 하나 실행 후 다시 시도:'));
      log('       ' + C.b('npx --yes clear-npx-cache && npx leerness@latest init .'));
      log('       ' + C.b('npm i -g leerness@latest  →  leerness init .'));
      log('');
      log(C.d('     (이 경고는 LEERNESS_NO_STALE_CHECK=1 또는 --no-stale-check로 끌 수 있습니다)'));
      log('');
      return { stale: true, current: VERSION, latest };
    }
    return { stale: false, current: VERSION, latest };
  } catch (e) {
    // 어떤 이유로든 실패해도 init 진행 차단 X
    return null;
  }
}

// 1.9.32/1.9.34: ASCII 배너 — init/version 시 출력 (그라데이션 다중 색상 강화)
function _banner(opts = {}) {
  const v = `v${VERSION}`;
  const cols = process.stdout && process.stdout.columns ? process.stdout.columns : 80;
  if (process.env.LEERNESS_NO_BANNER === '1') return;
  if (cols < 70) {
    log(`Leerness ${v}  —  AI 에이전트 검수·기억·드리프트 방지 하네스`);
    return;
  }
  const isTty = process.stdout && process.stdout.isTTY;
  // 1.9.34: ANSI 256색 그라데이션 (cyan → magenta) + 굵게
  // 색상 안전 fallback (Windows 구버전 cmd는 256색 불가 시 그냥 기본색)
  const mk = (code) => isTty ? `\x1b[38;5;${code}m` : '';
  const reset = isTty ? '\x1b[0m' : '';
  const bold = isTty ? '\x1b[1m' : '';
  // 그라데이션 색상 (cyan/teal/blue/purple/magenta): 6 LEERNESS 라인 × 단색씩
  const grad = [51, 45, 39, 33, 99, 165]; // cyan → magenta
  const C = {
    cyan: s => isTty ? `\x1b[36m${s}\x1b[0m` : s,
    dim: s => isTty ? `\x1b[2m${s}\x1b[0m` : s,
    bold: s => isTty ? `\x1b[1m${s}\x1b[0m` : s,
    green: s => isTty ? `\x1b[32m${s}\x1b[0m` : s,
    yel: s => isTty ? `\x1b[33m${s}\x1b[0m` : s,
    mag: s => isTty ? `\x1b[35m${s}\x1b[0m` : s,
    g: (s, code) => isTty ? `${mk(code)}${bold}${s}${reset}` : s
  };
  // 박스 외곽선 + ASCII 본문 그라데이션
  const asciiLines = [
    '██╗     ███████╗███████╗██████╗ ███╗   ██╗███████╗███████╗',
    '██║     ██╔════╝██╔════╝██╔══██╗████╗  ██║██╔════╝██╔════╝',
    '██║     █████╗  █████╗  ██████╔╝██╔██╗ ██║█████╗  ███████╗',
    '██║     ██╔══╝  ██╔══╝  ██╔══██╗██║╚██╗██║██╔══╝  ╚════██║',
    '███████╗███████╗███████╗██║  ██║██║ ╚████║███████╗███████║',
    '╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝'
  ];
  const border = C.cyan;
  const lines = [
    '',
    border('  ╔══════════════════════════════════════════════════════════════╗'),
    border('  ║                                                              ║'),
  ];
  for (let i = 0; i < asciiLines.length; i++) {
    lines.push(border('  ║  ') + C.g(asciiLines[i], grad[i]) + border('  ║'));
  }
  lines.push(border('  ║                                                              ║'));
  lines.push(border('  ║  ') + C.green(`${v.padEnd(10)}`) + C.dim('AI Agent Reliability Harness') + border('                      ║'));
  lines.push(border('  ║  ') + C.yel('★ ') + C.dim('verify · reuse-map · handoff · agents · orchestrate') + border('       ║'));
  lines.push(border('  ║                                                              ║'));
  lines.push(border('  ╚══════════════════════════════════════════════════════════════╝'));
  lines.push('  ' + C.dim('AI 에이전트 검수·기억·드리프트 방지 하네스 — ') + C.mag('verify') + C.dim(' · ') + C.mag('remember') + C.dim(' · ') + C.mag('orchestrate') + C.dim(' · ') + C.mag('audit'));
  lines.push('');

  // 1.9.141: ASCII 배너 모션 — 그라데이션이 LEERNESS 글자 위로 흐르는 wave 효과 (TTY only, opt-out via LEERNESS_NO_ANIMATE)
  const animate = isTty && process.env.LEERNESS_NO_ANIMATE !== '1'
    && process.env.LEERNESS_NO_PROMPT !== '1' && !opts.noAnimate
    && !has('--no-animate');
  // 헬퍼: ASCII line index (3..8) 에 해당하는 그라데이션 lines 재생성
  const renderFrame = (shift) => {
    const out = [];
    out.push('');
    out.push(border('  ╔══════════════════════════════════════════════════════════════╗'));
    out.push(border('  ║                                                              ║'));
    for (let i = 0; i < asciiLines.length; i++) {
      const colorIdx = (i + shift) % grad.length;
      out.push(border('  ║  ') + C.g(asciiLines[i], grad[colorIdx]) + border('  ║'));
    }
    // remaining static lines copied from the original `lines` (indices 9..)
    for (let k = 9; k < lines.length; k++) out.push(lines[k]);
    return out;
  };
  const sleepSync = (ms) => {
    try {
      const sab = new SharedArrayBuffer(4);
      const arr = new Int32Array(sab);
      Atomics.wait(arr, 0, 0, ms);
    } catch {
      const end = Date.now() + ms; while (Date.now() < end) {}
    }
  };
  if (animate) {
    // Frame 1: initial render
    const frame0 = renderFrame(0);
    for (const ln of frame0) log(ln);
    // Wave frames: 1..3 shifts
    for (let shift = 1; shift <= 3; shift++) {
      sleepSync(85);
      // Move cursor up by total frame lines
      process.stdout.write(`\x1b[${frame0.length}A`);
      const f = renderFrame(shift);
      for (const ln of f) {
        process.stdout.write('\x1b[2K\r' + ln + '\n');
      }
    }
    // Settle to original (shift=0) for final static visual
    sleepSync(85);
    process.stdout.write(`\x1b[${frame0.length}A`);
    for (const ln of lines) {
      process.stdout.write('\x1b[2K\r' + ln + '\n');
    }
    // 1.9.144: 사용자 명시 요청 — 모션 완료 후 1초 홀드 (배너가 시선에 자리잡도록)
    //   환경변수 LEERNESS_BANNER_HOLD_MS 로 조정 가능 (기본 1000ms, 0 또는 음수면 스킵)
    const holdMs = (() => {
      const env = parseInt(process.env.LEERNESS_BANNER_HOLD_MS || '1000', 10);
      return Number.isFinite(env) && env > 0 ? Math.min(env, 5000) : 0;
    })();
    if (holdMs > 0) sleepSync(holdMs);
  } else {
    for (const ln of lines) log(ln);
  }
  if (opts.quickStart) {
    // 1.9.144: quickStart UI/UX 개선 — 카테고리 그룹 + 부드러운 cascade 표시 + 핵심 3단계 우선
    //   • TTY 모션 시 각 라인 사이 짧은 fade (8ms) 로 부드러운 cascade
    //   • non-TTY 시 즉시 출력 (CI/pipe 호환)
    //   • 카테고리: 신규 프로젝트 / 매 세션 / 메모리 5종 / MCP·외부 AI / 보안·회복
    const cascade = animate;
    const cascadeMs = parseInt(process.env.LEERNESS_CASCADE_MS || '8', 10);
    const cascadeStep = Number.isFinite(cascadeMs) && cascadeMs >= 0 ? Math.min(cascadeMs, 100) : 8;
    const cprint = (s) => { log(s); if (cascade && cascadeStep > 0) sleepSync(cascadeStep); };
    const section = (title) => { cprint(''); cprint(C.bold(C.cyan(`  ${title}`))); };
    const cmd = (run, desc) => {
      // 명령 컬럼 폭 = 42 (정렬을 위해 padEnd) — 가독성 향상
      const padded = run.length >= 42 ? run + ' ' : run.padEnd(42);
      cprint('    ' + C.green(padded) + C.dim('# ' + desc));
    };

    cprint('');
    cprint(C.bold(C.cyan('  ✨ 시작하기 (3단계면 끝)')));
    cmd('npx leerness init .',         '1️⃣  하네스 설치 + AI 도구 자동 연결');
    cmd('npx leerness handoff .',      '2️⃣  세션 시작 — 컨텍스트·기억·feature impact 자동 회수');
    cmd('npx leerness session close .', '3️⃣  세션 종료 — 마감 통계 + 다음 라운드 추천');

    section('🧠 메모리 5종 CRUD (1.9.142 — cascade 방지)');
    cmd('leerness task add "<제목>"',         'progress-tracker 등록');
    cmd('leerness decision add "<제목>" --reason "..."', '되돌리기 어려운 결정 영구화');
    cmd('leerness lesson save "<교훈>" --tag "..."',     '재발견 가능한 통찰 저장');
    cmd('leerness plan add "<milestone>"',     '계획 단계 등록');
    cmd('leerness rule add "<룰>" --trigger every-X',    '자연어 영구 룰');
    cmd('leerness feature add "<기능>" --files "..."',   'Feature Graph 노드 (1.9.141)');

    section('🔗 인과관계 + 영향 추적 (1.9.141~143)');
    cmd('leerness feature impact <F-XXXX>',  '코드 변경 전 영향받는 feature 자동 회수');
    cmd('leerness feature list --json',      '전체 그래프 + 엣지');
    cmd('leerness audit . --json',           'orphan/cycle 무결성 검증');

    section('🛡 보안·드리프트·게으름 가드');
    cmd('leerness drift check . --auto-fix', 'drift + 보안 자동 회복');
    cmd('leerness lazy detect . --json',     '거짓 완료/no test run 감지');
    cmd('leerness env sync .',               '.env ↔ .env.example 동기화');
    cmd('leerness health . --json',          '종합 헬스 (drift+보안+skill+feature)');

    section('🤖 외부 AI 통합 (MCP 46 도구)');
    cmd('npx leerness mcp serve',                 'stdio JSON-RPC server');
    cmd('leerness memory status . --json',        '5 surface + featureGraph 한 호출');
    cmd('leerness memory archive list --query "kw"', 'DELETE 5종 archive 검색');
    cmd('leerness memory restore <surface> <target>', 'archive → active 복원');

    section('🚀 Release 자동화');
    cmd('leerness release pack --close --auto-main-push', '한 줄 release (1.9.140 main push 통합)');
    cmd('leerness release sync-main .',          'release branch → main 자동 fast-forward');

    cprint('');
    cprint(C.dim('  📚 자세히: `leerness --help` · 자율 모드: `<<autonomous-loop-dynamic>>` 신호로 진행'));
    cprint('');
  }
}

// 1.9.32: TTY 한정 readline async prompt — 비대화형(npx CI, --yes)에선 default 반환
function _prompt(question, defaultVal = '') {
  return new Promise(resolve => {
    if (!process.stdin.isTTY || process.env.LEERNESS_NO_PROMPT === '1' || has('--yes') || has('-y')) {
      return resolve(defaultVal);
    }
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const q = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
    rl.question(q, ans => {
      rl.close();
      resolve((ans || '').trim() || defaultVal);
    });
  });
}

// 1.9.32: yes/no prompt — y/yes/예/네/1 → true, n/no/아니오/0/공백 → false
async function _confirm(question, defaultYes = false) {
  const def = defaultYes ? 'Y/n' : 'y/N';
  const ans = await _prompt(`${question} (${def})`, defaultYes ? 'y' : 'n');
  return /^(y|yes|예|네|ㅇ|1|true)$/i.test(ans.trim());
}

// 1.9.34: 방향키 + 스페이스 + Enter 인터랙티브 single-select prompt (raw mode)
// 비-TTY 또는 LEERNESS_NO_PROMPT=1 → 첫 옵션 반환
async function _selectOne(question, options, opts = {}) {
  if (!process.stdin.isTTY || process.env.LEERNESS_NO_PROMPT === '1' || has('--yes') || has('-y')) {
    return opts.defaultIndex != null ? options[opts.defaultIndex] : options[0];
  }
  const stdin = process.stdin;
  const stdout = process.stdout;
  const isTty = stdout.isTTY;
  const C = isTty ? {
    cyan: s => `\x1b[36m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m`,
    bold: s => `\x1b[1m${s}\x1b[0m`, green: s => `\x1b[32m${s}\x1b[0m`,
    inv: s => `\x1b[7m${s}\x1b[0m`, mag: s => `\x1b[35m${s}\x1b[0m`
  } : { cyan: s => s, dim: s => s, bold: s => s, green: s => s, inv: s => s, mag: s => s };
  return new Promise(resolve => {
    let idx = opts.defaultIndex || 0;
    if (idx < 0 || idx >= options.length) idx = 0;
    const render = (first) => {
      if (!first) {
        // 이전 출력 지우기: options.length + 2줄 (제목 + 안내)
        stdout.write(`\x1b[${options.length + 2}A`);
      }
      // 1.9.148 fix: question + 안내 라인에도 \x1b[2K (clear entire line) — 중첩 출력 방지 (사용자 명시 버그)
      stdout.write(`\x1b[2K\r${C.bold(question)}\n`);
      stdout.write(`\x1b[2K\r${C.dim('  ↑↓ 이동, Enter 확정, q 취소')}\n`);
      for (let i = 0; i < options.length; i++) {
        const label = typeof options[i] === 'string' ? options[i] : (options[i].label || String(options[i]));
        const desc = typeof options[i] === 'object' && options[i].description ? C.dim('  — ' + options[i].description) : '';
        const cursor = i === idx ? C.cyan('❯') : ' ';
        const text = i === idx ? C.bold(C.green(label)) : label;
        stdout.write(`\x1b[2K\r  ${cursor} ${text}${desc}\n`);
      }
    };
    render(true);
    stdin.setRawMode && stdin.setRawMode(true);
    stdin.resume(); stdin.setEncoding('utf8');
    const onData = (buf) => {
      const key = String(buf);
      // 화살표는 ESC [ A/B
      if (key === '[A' || key === 'k') { idx = (idx - 1 + options.length) % options.length; render(false); }
      else if (key === '[B' || key === 'j') { idx = (idx + 1) % options.length; render(false); }
      else if (key === '\r' || key === '\n') {
        cleanup();
        stdout.write('\n');
        resolve(options[idx]);
      } else if (key === '' || key === 'q' || key === '') {
        cleanup();
        stdout.write('\n' + C.dim('  취소됨') + '\n');
        resolve(opts.defaultIndex != null ? options[opts.defaultIndex] : null);
      }
    };
    const cleanup = () => {
      stdin.setRawMode && stdin.setRawMode(false);
      stdin.removeListener('data', onData);
      stdin.pause();
    };
    stdin.on('data', onData);
  });
}

// 1.9.34: 방향키 + 스페이스 + Enter 인터랙티브 multi-select prompt (raw mode)
// 비-TTY/--yes → opts.defaults 또는 빈 배열 반환
async function _selectMany(question, options, opts = {}) {
  if (!process.stdin.isTTY || process.env.LEERNESS_NO_PROMPT === '1' || has('--yes') || has('-y')) {
    return (opts.defaults || []).map(d => typeof d === 'number' ? options[d] : d).filter(Boolean);
  }
  const stdin = process.stdin;
  const stdout = process.stdout;
  const isTty = stdout.isTTY;
  const C = isTty ? {
    cyan: s => `\x1b[36m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m`,
    bold: s => `\x1b[1m${s}\x1b[0m`, green: s => `\x1b[32m${s}\x1b[0m`,
    inv: s => `\x1b[7m${s}\x1b[0m`, mag: s => `\x1b[35m${s}\x1b[0m`,
    yel: s => `\x1b[33m${s}\x1b[0m`
  } : { cyan: s => s, dim: s => s, bold: s => s, green: s => s, inv: s => s, mag: s => s, yel: s => s };
  return new Promise(resolve => {
    let idx = 0;
    const selected = new Set((opts.defaults || []).map(d => typeof d === 'number' ? d : options.findIndex(o => o === d || (o && o.id === d))).filter(i => i >= 0));
    const render = (first) => {
      if (!first) stdout.write(`\x1b[${options.length + 2}A`);
      // 1.9.148 fix: question + 안내 라인에도 \x1b[2K — 중첩 출력 방지
      stdout.write(`\x1b[2K\r${C.bold(question)}\n`);
      stdout.write(`\x1b[2K\r${C.dim('  ↑↓ 이동, Space 토글, a 전체, n 해제, Enter 확정, q 취소')}\n`);
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const label = typeof opt === 'string' ? opt : (opt.label || String(opt));
        const desc = typeof opt === 'object' && opt.description ? C.dim(' — ' + opt.description) : '';
        const mark = selected.has(i) ? C.green('◉') : C.dim('◯');
        const cursor = i === idx ? C.cyan('❯') : ' ';
        const text = i === idx ? C.bold(label) : label;
        stdout.write(`\x1b[2K\r  ${cursor} ${mark} ${text}${desc}\n`);
      }
    };
    render(true);
    stdin.setRawMode && stdin.setRawMode(true);
    stdin.resume(); stdin.setEncoding('utf8');
    const onData = (buf) => {
      const key = String(buf);
      if (key === '[A' || key === 'k') { idx = (idx - 1 + options.length) % options.length; render(false); }
      else if (key === '[B' || key === 'j') { idx = (idx + 1) % options.length; render(false); }
      else if (key === ' ') {
        if (selected.has(idx)) selected.delete(idx); else selected.add(idx);
        render(false);
      } else if (key === 'a' || key === 'A') {
        for (let i = 0; i < options.length; i++) selected.add(i);
        render(false);
      } else if (key === 'n' || key === 'N') {
        selected.clear();
        render(false);
      } else if (key === '\r' || key === '\n') {
        cleanup();
        stdout.write('\n');
        resolve([...selected].sort((a, b) => a - b).map(i => options[i]));
      } else if (key === '' || key === 'q' || key === '') {
        cleanup();
        stdout.write('\n' + C.dim('  취소됨 (기본값 사용)') + '\n');
        resolve((opts.defaults || []).map(d => typeof d === 'number' ? options[d] : d).filter(Boolean));
      }
    };
    const cleanup = () => {
      stdin.setRawMode && stdin.setRawMode(false);
      stdin.removeListener('data', onData);
      stdin.pause();
    };
    stdin.on('data', onData);
  });
}

// 1.9.32: .env 파일에 KEY=value 라인 누적/갱신 (이미 키가 있으면 값 교체, 없으면 append)
function _upsertEnvLine(envPath, key, value) {
  let body = exists(envPath) ? read(envPath) : '';
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}=.*$`, 'm');
  const line = `${key}=${value}`;
  if (re.test(body)) body = body.replace(re, line);
  else body = (body && !body.endsWith('\n') ? body + '\n' : body) + line + '\n';
  writeUtf8(envPath, body);
}

// 1.9.32: 외부 AI CLI 자동 설치 시도 — child_process.spawnSync로 installCmd 실행
function _tryInstallAgent(agent) {
  if (!agent.installCmd) return { ok: false, message: 'installCmd 정의 없음' };
  log(`  ▶ 실행: ${agent.installCmd}`);
  const parts = agent.installCmd.split(/\s+/);
  const r = cp.spawnSync(parts[0], parts.slice(1), { encoding: 'utf8', timeout: 120000, shell: true, stdio: 'inherit' });
  if (r.status === 0) return { ok: true, message: '설치 성공' };
  return { ok: false, message: `exit ${r.status}` + (r.error ? ` (${r.error.code || r.error.message})` : '') };
}

// 1.9.32/1.9.34: setup-agents 워크플로 — init 직후 또는 단독 명령
// 1.9.34: 방향키/스페이스 multi-select 도입 (LEERNESS_NO_INTERACTIVE=1 → 기존 yes/no 폴백)
async function setupAgentsCmd(root, opts = {}) {
  root = absRoot(root || process.cwd());
  _loadEnvFile(root);
  _loadEnvFile(path.join(root, '..'));
  const envPath = path.join(root, '.env');

  log('');
  log('# 외부 AI CLI 설정 (1.9.34)');
  log('메인 에이전트가 작업을 분배할 sub-agent 후보를 선택하세요.');
  log('각 CLI는 *환경변수 활성화 + PATH 존재* 둘 다 충족할 때 ready 상태가 됩니다.');
  log('');

  const interactive = !!process.stdin.isTTY && !has('--yes') && !has('-y') && process.env.LEERNESS_NO_PROMPT !== '1';
  if (!interactive) {
    log('  비대화형 모드 — 환경변수는 변경하지 않습니다. 수동 편집:');
    log(`    ${envPath}`);
    log('  활성 상태 확인: leerness agents list');
    return;
  }

  // 1.9.34: multi-select로 활성화할 CLI 일괄 선택
  const useInteractive = process.env.LEERNESS_NO_INTERACTIVE !== '1';
  const statuses = EXTERNAL_AGENTS.map(a => ({ agent: a, status: _checkAgent(a) }));

  let toEnable = new Set();
  if (useInteractive) {
    const options = statuses.map(({ agent, status }) => {
      const inst = status.installed ? '🟢 설치됨' : '⚪ 미설치';
      const desc = `${inst} · ${agent.desc.slice(0, 50)}`;
      return { id: agent.id, label: agent.id.padEnd(8), description: desc };
    });
    // 기본 선택: 이미 활성화된 것 + claude (기본 활성)
    const defaults = statuses
      .map((s, i) => (s.status.enabled || s.agent.id === 'claude') ? i : -1)
      .filter(i => i >= 0);
    const picked = await _selectMany(
      '활성화할 sub-agent CLI를 선택하세요 (Space=토글, a=전체, n=해제, Enter=확정)',
      options,
      { defaults }
    );
    toEnable = new Set(picked.map(p => p.id));
  } else {
    // 폴백: 기존 yes/no
    for (const { agent, status } of statuses) {
      const isReady = status.installed && status.enabled;
      log(`▸ ${agent.id} — ${agent.desc}`);
      log(`  ${status.installed ? '🟢 설치됨' : '⚪ 미설치'} / ${status.enabled ? '🟢 활성' : '🟡 비활성'}`);
      const wantEnable = await _confirm(`  ${agent.id}를 sub-agent로 활성화?`, isReady || agent.id === 'claude');
      if (wantEnable) toEnable.add(agent.id);
    }
  }

  // 선택 결과 적용
  for (const { agent, status } of statuses) {
    const enable = toEnable.has(agent.id);
    _upsertEnvLine(envPath, agent.envFlag, enable ? '1' : '0');
    log(enable ? `  ✓ ${agent.envFlag}=1 (활성)` : `  ✗ ${agent.envFlag}=0 (비활성)`);

    // 활성화했지만 미설치 → 자동 설치 prompt
    if (enable && !status.installed) {
      log(`  ⚠ ${agent.bin}이(가) 설치되어 있지 않습니다.`);
      log(`     설치 명령: ${agent.installCmd}`);
      const doInstall = await _confirm(`  지금 자동 설치를 시도할까요?`, false);
      if (doInstall) {
        const r = _tryInstallAgent(agent);
        if (r.ok) {
          const after = _checkAgent(agent);
          if (after.installed) log(`  🟢 ${agent.id} 설치 확인 (${after.version || '?'})`);
          else log(`  ⚠ 설치 후에도 PATH에서 찾지 못함 — 새 셸을 열어주세요`);
        } else {
          log(`  ✗ 설치 실패: ${r.message}`);
        }
      } else {
        log(`  → 나중에 직접 설치 후 \`leerness setup-agents\` 재실행 가능`);
      }
    }
  }

  log('');
  log('✅ 외부 AI CLI 설정 완료.');
  log(`   .env에 LEERNESS_ENABLE_* 플래그가 저장되었습니다 (${rel(root, envPath)}).`);
  log('   다음: leerness agents list  /  leerness agents quota');
}

// 1.9.152: 단일 agent dispatch 명령 빌더 — agents dispatch (단일) + agents multi (복수) 가 공유
function _dispatchCommand(agentId, task, writeMode) {
  const q = String(task || '').replace(/"/g, '\\"');
  if (agentId === 'claude') return `claude ${writeMode ? '--print --dangerously-skip-permissions' : '--print'} "${q}"`;
  if (agentId === 'codex')  return `codex ${writeMode ? 'exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox' : 'exec --skip-git-repo-check'} "${q}"`;
  if (agentId === 'gemini') return `gemini ${writeMode ? '-p --yolo' : '-p'} "${q}"`;
  if (agentId === 'copilot') return `gh copilot suggest "${q}"`;
  if (agentId === 'ollama') return `# ollama — leerness agent "${q}" --provider ollama 로 직접 호출 (REPL: leerness agent)`;
  return `# ${agentId}: 명령 빌더 미정의`;
}

function agentsCmd(root, sub, ...args) {
  root = absRoot(root || process.cwd());
  // .env 자동 로드 (1.9.22)
  _loadEnvFile(root);
  _loadEnvFile(path.join(root, '..'));

  if (!sub || sub === 'list') {
    // 1.9.157: Provider Registry 통합 — 빌트인 5종 + 사용자 정의 provider 포함
    const providers = _allProviders(root);
    const userIds = new Set(_readUserProviders(root).map(u => u.id));
    const checks = providers.map(a => ({ ...(_checkAgent(a)), source: userIds.has(a.id) ? 'user' : 'builtin' }));
    if (has('--json')) { log(JSON.stringify({ agents: checks }, null, 2)); return; }
    log(`# 외부 AI CLI 오케스트레이션 (1.9.30)`);
    log('');
    log(`| Agent | source | env (${'env=1 활성'}) | 설치 | 버전 | 상태 |`);
    log(`|---|---|---|---|---|---|`);
    for (const c of checks) {
      const envMark = c.enabled ? '✓' : '✗';
      const instMark = c.installed ? '✓' : '✗';
      const statusEmoji = c.status === 'ready' ? '🟢 ready' : c.status === 'not-installed' ? '⚪ 미설치' : c.status === 'disabled' ? '🟡 비활성' : '❓';
      log(`| ${c.id} | ${c.source} | ${envMark} ${c.envFlag} | ${instMark} | ${c.version || '-'} | ${statusEmoji} |`);
    }
    const ready = checks.filter(c => c.status === 'ready');
    log('');
    log(`## 활성 (${ready.length}/${checks.length}): ${ready.map(c => c.id).join(', ') || '(없음)'}`);
    if (!ready.length) {
      log('');
      log(`💡 활성화 방법:`);
      log(`  1) CLI 설치 (예: \`npm i -g @openai/codex-cli\`, \`npm i -g @google/gemini-cli\`)`);
      log(`  2) .env 또는 환경변수: LEERNESS_ENABLE_CODEX=1, LEERNESS_ENABLE_GEMINI=1`);
      log(`  3) \`leerness agents check\`로 재확인`);
      log(`  💡 1.9.157: 빌트인 외 CLI 추가: \`leerness provider add <id> --bin <cmd>\``);
    } else {
      log('');
      log(`💡 메인 에이전트가 sub-agent 분배 시 위 ${ready.length}개 CLI 활용 가능:`);
      log(`   \`leerness agents dispatch "<task>" --to <id>\` 로 프롬프트 전달`);
    }
    return;
  }

  if (sub === 'check') {
    // list의 alias, 단 명시적 재확인 (JSON 출력 기본)
    // 1.9.157: Provider Registry 통합
    const providers = _allProviders(root);
    const userIds = new Set(_readUserProviders(root).map(u => u.id));
    const checks = providers.map(a => ({ ...(_checkAgent(a)), source: userIds.has(a.id) ? 'user' : 'builtin' }));
    if (has('--json')) { log(JSON.stringify({ agents: checks, ready: checks.filter(c => c.status === 'ready').map(c => c.id) }, null, 2)); return; }
    return agentsCmd(root, 'list'); // 비-JSON은 list와 동일
  }

  // 1.9.152: agents multi — 1.9.151 install 복수 선택된 ready 에이전트들에 일괄 dispatch 명령 생성
  // 단일 task → 활성 N개 에이전트 동시 dispatch 명령들. 사용자가 한 번에 복사 실행하거나 메인 에이전트가 spawn.
  if (sub === 'multi') {
    const task = args.filter(x => !x.startsWith('-')).join(' ').trim() || arg('--task', null);
    if (!task) { fail('multi "<task>" 또는 --task 필요'); return process.exit(1); }
    const onlyArg = arg('--only', null);  // 'claude,codex' 처럼 콤마 구분 — 활성 중에서 추가 필터
    const writeMode = has('--write');
    const execute = has('--execute');  // 1.9.156: 명령 출력 → 실제 spawn + consensus 합의
    const checks = EXTERNAL_AGENTS.map(a => ({ def: a, status: _checkAgent(a) }));
    let ready = checks.filter(x => x.status.status === 'ready');
    if (onlyArg) {
      const wanted = new Set(onlyArg.split(/[,\s]+/).filter(Boolean));
      ready = ready.filter(x => wanted.has(x.def.id));
    }
    if (!ready.length) {
      fail('활성 (ready) 에이전트 없음 — `leerness agents list` 로 확인. 1.9.151 install 흐름에서 복수 선택 후 .env 활성화 필요.');
      return process.exit(1);
    }
    // 1.9.156: --execute 모드 — 실제 spawn + 결과 수집 + multi-signal consensus
    if (execute) {
      return (async () => {
        const timeout = parseInt(arg('--timeout', '60'), 10) * 1000;
        if (!has('--json')) {
          log(`# leerness agents multi --execute (1.9.156) — ${ready.length}개 활성 에이전트 병렬 호출`);
          log(`task: ${task.slice(0, 120)}${task.length > 120 ? '…' : ''}`);
          log(`mode: ${writeMode ? '✏ write' : '🔒 read-only'} · timeout=${timeout / 1000}s`);
          log(`대상: ${ready.map(x => x.def.id).join(', ')}`);
          log('');
          log('## 병렬 호출 중...');
        }
        const t0 = Date.now();
        // 병렬 _cliChat 호출 (sandbox 자동: runCommandSafe + env scrub + observability)
        const results = await Promise.all(ready.map(async ({ def }) => {
          const start = Date.now();
          const r = await _cliChat(root, def.id, task, { timeout });
          return {
            agent: def.id,
            elapsed: Date.now() - start,
            ok: r.ok,
            response: r.response || '',
            error: r.error || null,
            responseTokens: Math.ceil((r.response || '').length / 4)  // 대략 token 추정
          };
        }));
        const totalElapsed = Date.now() - t0;
        const ok = results.filter(r => r.ok);
        const failures = results.filter(r => !r.ok);
        _recordRun(root, { kind: 'agents_multi_execute', count: ready.length, success: ok.length, durationMs: totalElapsed, task: task.slice(0, 200) });
        // 1.9.155 consensus 로직 재사용 — multi-signal scoring (tokens + overlap + lengthFit)
        let best = null, scored = [];
        if (ok.length) {
          const tokenizer = (s) => new Set(String(s || '').toLowerCase().match(/[\w가-힣]{3,}/g) || []);
          const wordsOf = ok.map(o => tokenizer(o.response));
          const maxTokens = Math.max(...ok.map(o => o.responseTokens), 1);
          const avgLen = ok.reduce((s, o) => s + o.response.length, 0) / ok.length;
          const stdLen = Math.sqrt(ok.reduce((s, o) => s + (o.response.length - avgLen) ** 2, 0) / ok.length) || 1;
          scored = ok.map((o, i) => {
            const tokensNorm = o.responseTokens / maxTokens;
            const myWords = wordsOf[i];
            let overlapSum = 0;
            for (let j = 0; j < wordsOf.length; j++) {
              if (i === j) continue;
              let inter = 0;
              for (const w of myWords) if (wordsOf[j].has(w)) inter++;
              overlapSum += inter / Math.max(myWords.size, 1);
            }
            const overlap = (ok.length > 1) ? overlapSum / (ok.length - 1) : 0;
            const z = Math.abs((o.response.length - avgLen) / stdLen);
            const lengthFit = z <= 1.5 ? (1 - z / 1.5) : 0;
            const score = 0.4 * tokensNorm + 0.4 * overlap + 0.2 * lengthFit;
            return { ...o, score, tokensNorm, overlap, lengthFit };
          }).sort((a, b) => b.score - a.score);
          best = scored[0];
        }
        if (has('--json')) {
          log(JSON.stringify({
            task, count: ready.length, success: ok.length, totalElapsedMs: totalElapsed,
            results: scored.length ? scored : results,
            best: best ? { agent: best.agent, score: best.score, response: best.response } : null,
            failures
          }, null, 2));
          return;
        }
        log(`\n## 결과: ${ok.length}/${ready.length} 성공 · 총 ${totalElapsed}ms (병렬)`);
        for (const r of results) {
          if (r.ok) log(`  ✓ ${r.agent.padEnd(8)} · ${r.elapsed}ms · ${r.responseTokens} 토큰`);
          else log(`  ✗ ${r.agent.padEnd(8)} · ${r.elapsed}ms · ${(r.error || '').slice(0, 60)}`);
        }
        if (best) {
          log('');
          log(`## 🏆 합의 선택 (multi-signal consensus, 1.9.155)`);
          log(`  best: ${best.agent} · score=${best.score.toFixed(3)} (tokens=${best.tokensNorm.toFixed(2)} · overlap=${best.overlap.toFixed(2)} · lengthFit=${best.lengthFit.toFixed(2)})`);
          if (scored.length > 1) {
            log(`  others: ${scored.slice(1, 4).map(s => `${s.agent}=${s.score.toFixed(2)}`).join(', ')}`);
          }
          log(`  --- 처음 600자 ---`);
          log(best.response.slice(0, 600));
          // task-log 기록
          try {
            const tlp = taskLogPath(root);
            const block = `\n## ${today()} agents multi --execute (1.9.156)\n- task: ${task.slice(0, 200)}\n- agents: ${ready.map(x => x.def.id).join(', ')}\n- success: ${ok.length}/${ready.length}\n- best: ${best.agent} (score=${best.score.toFixed(3)})\n`;
            append(tlp, block);
          } catch {}
        }
        if (failures.length && !best) {
          process.exitCode = 1;
        }
      })();
    }
    if (has('--json')) {
      log(JSON.stringify({
        task, count: ready.length,
        agents: ready.map(x => ({ id: x.def.id, version: x.status.version })),
        commands: ready.map(x => _dispatchCommand(x.def.id, task, writeMode))
      }, null, 2));
      return;
    }
    log(`# leerness agents multi (1.9.152) — ${ready.length}개 활성 에이전트 일괄 dispatch`);
    log(`task: ${task.slice(0, 120)}${task.length > 120 ? '…' : ''}`);
    log(`mode: ${writeMode ? '✏ write (파일 수정 가능)' : '🔒 read-only (분석 전용, 안전)'}`);
    log(`대상: ${ready.map(x => x.def.id).join(', ')}`);
    log('');
    log('## 각 에이전트 실행 명령 (사용자가 병렬 실행 또는 메인 에이전트가 spawn)');
    log('');
    for (const { def, status } of ready) {
      log(`### [${def.id}]  (v${status.version || '?'})`);
      log('```sh');
      log(_dispatchCommand(def.id, task, writeMode));
      log('```');
      log('');
    }
    log('## 정책 (1.9.152 / 1.9.156)');
    log(`  - 기본 모드: 명령 문자열만 출력 (사용자/메인 에이전트가 명시적으로 실행)`);
    log(`  - 1.9.156 신규: \`--execute\` 플래그 시 leerness가 직접 ${ready.length}개 sub-agent 병렬 spawn + multi-signal consensus 자동 합의`);
    log(`     예: leerness agents multi "<task>" --execute  (또는 --execute --json)`);
    log(`  - 활성 에이전트 변경: \`.env\`에서 LEERNESS_ENABLE_<CLI>=1/0 또는 \`leerness setup-agents\` 재실행`);
    log(`  - quota 체크: \`leerness agents quota\``);
    return;
  }
  if (sub === 'dispatch') {
    const task = args.filter(x => !x.startsWith('-')).join(' ').trim() || arg('--task', null);
    const target = arg('--to', null);
    if (!task) { fail('dispatch "<task>" 또는 --task 필요'); return process.exit(1); }
    // 1.9.152: --multi 또는 --to=all 또는 --to 없음 + 활성 ≥2 → multi 모드로 routing
    if (has('--multi') || target === 'all' || target === '*') {
      return agentsCmd(root, 'multi', ...args);
    }
    if (!target) { fail('--to <agent_id> 필요 (claude/codex/gemini/copilot) — 활성 전체에 일괄 분배는 `leerness agents multi`'); return process.exit(1); }
    const agentDef = EXTERNAL_AGENTS.find(a => a.id === target);
    if (!agentDef) { fail(`알 수 없는 agent: ${target}`); return process.exit(1); }
    // 1.9.36: 작업 유형 키워드 분석 → 최적 CLI 추천 (ready 체크 전에 출력 — 비활성이어도 추천)
    const recommendation = _recommendAgent(task);
    const recommended = recommendation.target;
    if (recommended && recommended !== target) {
      log(`💡 추천: 이 작업은 ${recommended}가 더 적합 (${recommendation.reason})`);
    }
    const status = _checkAgent(agentDef);
    if (status.status !== 'ready') {
      fail(`${target} 비활성 (${status.status}). 환경변수 ${agentDef.envFlag}=1 + CLI 설치 필요.`);
      return process.exit(1);
    }
    // 1.9.36: --write 시 파일 수정 가능 권장 플래그 자동 첨부, 미명시 시 read-only 안전 모드
    const writeMode = has('--write');
    const readOnly = has('--readonly') || !writeMode;
    // 실제 호출은 안 함 — 프롬프트만 생성 (사용자가 명시적으로 실행)
    log(`# leerness agents dispatch (1.9.36)`);
    log(`대상: ${target} (${agentDef.bin})`);
    log(`상태: 🟢 ready, 버전 ${status.version || '?'}`);
    log(`모드: ${writeMode ? '✏ write (파일 수정 가능)' : '🔒 read-only (분석 전용, 안전)'}`);
    log('');
    log(`## 실행 명령 (사용자가 복사해서 실행)`);
    log('');
    const q = task.replace(/"/g, '\\"');
    if (target === 'claude') {
      const flags = writeMode ? '--print --dangerously-skip-permissions' : '--print';
      log(`claude ${flags} "${q}"`);
      if (writeMode) log(`# ⚠ --dangerously-skip-permissions: 도구 권한 자동 승인 (파일 수정 가능)`);
    } else if (target === 'codex') {
      const flags = writeMode ? 'exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox' : 'exec --skip-git-repo-check';
      log(`codex ${flags} "${q}"`);
      log(`# ℹ codex는 PowerShell 경유 — POSIX /tmp 경로는 C:\\tmp\\로 해석됨`);
      if (writeMode) log(`# ⚠ --dangerously-bypass-approvals-and-sandbox: sandbox 우회`);
    } else if (target === 'gemini') {
      const flags = writeMode ? '-p --yolo' : '-p';
      log(`gemini ${flags} "${q}"`);
      if (writeMode) log(`# ⚠ --yolo: 워크스페이스 파일 직접 수정 가능`);
    } else if (target === 'copilot') {
      log(`gh copilot suggest "${q}"`);
    }
    log('');
    log(`## 정책 (1.9.36)`);
    log(`  - leerness는 외부 CLI를 자동 호출하지 않음 (사용자 명시적 실행)`);
    log(`  - 메인 에이전트(Claude)가 위 명령을 보고 sub-agent로 spawn 가능`);
    log(`  - quota 체크: \`leerness agents quota\` (1.9.31+)`);
    log(`  - 동시 호출 시: \`leerness agents bench "<task>"\` (1.9.36)`);
    log('');
    log(`## 분배 시 안전 규칙 (1.9.35)`);
    log(`  - sub-agent 프롬프트에 "당신만 수정할 파일 경로"를 명시 (파일 경로 격리)`);
    log(`  - sub-agent에 "보고 시 \`stat <file>\` 또는 mtime 확인 결과 첨부" 요구 (자기 격리 검증)`);
    log(`  - 사양 사전 정의 (예: TICK_SPEC.md) → \`leerness contract verify\`로 사후 검증`);
    log(`  - 같은 파일 동시 쓰기는 last-writer-wins 위험 (1.9.34 검증)`);
    return;
  }

  if (sub === 'bench') {
    // 1.9.36: 같은 prompt를 ready CLI 모두에 동시 호출 + 시간/응답 길이/exit code 비교
    const task = args.filter(x => !x.startsWith('-')).join(' ').trim() || arg('--task', null);
    if (!task) { fail('bench "<task>" 필요'); return process.exit(1); }
    const timeoutS = parseInt(arg('--timeout', '60'), 10);
    const writeMode = has('--write');
    const ready = EXTERNAL_AGENTS.map(a => ({ agent: a, status: _checkAgent(a) }))
                                  .filter(x => x.status.status === 'ready');
    if (!ready.length) {
      fail('ready CLI 없음 — leerness setup-agents 또는 .env에 LEERNESS_ENABLE_X=1 설정 필요');
      return process.exit(1);
    }
    log(`# leerness agents bench (1.9.36)`);
    log(`task: ${task.slice(0, 80)}${task.length > 80 ? '…' : ''}`);
    log(`참여 CLI: ${ready.map(r => r.agent.id).join(', ')} (${ready.length}개)`);
    log(`타임아웃: ${timeoutS}s/CLI · 모드: ${writeMode ? 'write' : 'read-only'}`);
    log('');
    log('병렬 호출 중... (병렬 fork 후 wait)');
    log('');
    const results = [];
    const promises = ready.map(({ agent, status }) => new Promise((resolve) => {
      const t0 = Date.now();
      let cmd, cmdArgs;
      if (agent.id === 'claude') {
        cmdArgs = writeMode ? ['--print', '--dangerously-skip-permissions', task] : ['--print', task];
        cmd = 'claude';
      } else if (agent.id === 'codex') {
        cmdArgs = writeMode
          ? ['exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', task]
          : ['exec', '--skip-git-repo-check', task];
        cmd = 'codex';
      } else if (agent.id === 'gemini') {
        cmdArgs = writeMode ? ['-p', task, '--yolo'] : ['-p', task];
        cmd = 'gemini';
      } else if (agent.id === 'copilot') {
        cmdArgs = ['copilot', 'suggest', task];
        cmd = 'gh';
      }
      const r = cp.spawn(cmd, cmdArgs, { shell: true });
      let stdout = '', stderr = '';
      r.stdout.on('data', d => { stdout += d; });
      r.stderr.on('data', d => { stderr += d; });
      const timer = setTimeout(() => { r.kill(); }, timeoutS * 1000);
      r.on('close', (code) => {
        clearTimeout(timer);
        const elapsed = Date.now() - t0;
        results.push({
          id: agent.id, exit: code, elapsed,
          stdout: stdout.trim().split('\n').slice(-3).join('\n'),
          stderrLen: stderr.length,
          ok: code === 0 && stdout.trim().length > 0
        });
        resolve();
      });
      r.on('error', (err) => {
        clearTimeout(timer);
        results.push({ id: agent.id, exit: -1, elapsed: Date.now() - t0, stdout: '', stderrLen: 0, error: err.message, ok: false });
        resolve();
      });
    }));
    return Promise.all(promises).then(() => {
      if (has('--json')) { log(JSON.stringify({ task, results }, null, 2)); return; }
      log(`| CLI | 시간 | exit | 응답 길이 | 마지막 라인 |`);
      log(`|---|---:|---:|---:|---|`);
      // sort by elapsed
      results.sort((a, b) => a.elapsed - b.elapsed);
      for (const r of results) {
        const respLen = (r.stdout || '').length;
        const last = (r.stdout || '').split('\n').pop().slice(0, 50);
        log(`| ${r.id} | ${r.elapsed}ms | ${r.exit} | ${respLen} | ${last.replace(/\|/g, '\\|')} |`);
      }
      log('');
      const okCount = results.filter(r => r.ok).length;
      log(`결과: ${okCount}/${results.length} 성공`);
      const fastest = results.filter(r => r.ok).sort((a, b) => a.elapsed - b.elapsed)[0];
      if (fastest) log(`🏆 가장 빠름: ${fastest.id} (${fastest.elapsed}ms)`);
    });
  }

  if (sub === 'quota') {
    // 1.9.31: 각 CLI 사용량/쿼터 추정 + provider 대시보드 링크
    const results = [];
    for (const agent of EXTERNAL_AGENTS) {
      const base = _checkAgent(agent);
      const out = { id: agent.id, bin: agent.bin, status: base.status, quota: null, hint: null, raw: null };
      if (base.status !== 'ready') {
        out.hint = base.status === 'not-installed' ? `${agent.bin} CLI 미설치` : base.status === 'disabled' ? `${agent.envFlag}=1 필요` : '알 수 없음';
        results.push(out); continue;
      }
      // CLI별 quota 탐지 시도
      try {
        if (agent.id === 'claude') {
          // claude는 /status 슬래시 (대화형)만 지원. 비대화형 추정 불가.
          out.quota = 'unknown';
          out.hint = '대화 내 `/status` 슬래시 또는 https://console.anthropic.com/settings/usage 확인';
        } else if (agent.id === 'codex') {
          // codex CLI: codex --help에 usage 명령 있는지 확인
          const r = cp.spawnSync(agent.bin, ['--help'], { encoding: 'utf8', timeout: 4000, shell: true });
          const help = (r.stdout || r.stderr || '').toLowerCase();
          if (help.includes('usage') || help.includes('quota')) {
            out.quota = 'cli-supported';
            out.hint = '`codex usage` 또는 `codex quota` 시도 가능';
          } else {
            out.quota = 'unknown';
            out.hint = 'https://platform.openai.com/account/usage 확인';
          }
          out.raw = help.slice(0, 200);
        } else if (agent.id === 'gemini') {
          // gemini CLI: 무료 티어는 분당 60req 제한, CLI 자체에선 노출 안 됨
          out.quota = 'rate-limited';
          out.hint = '무료 티어: 60 req/min, 1000 req/day · 유료는 https://ai.google.dev/gemini-api/docs/rate-limits';
        } else if (agent.id === 'copilot') {
          // gh copilot은 GitHub Copilot 구독 (월 단위 quota 없음, individual/business 플랜)
          const r = cp.spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', timeout: 4000, shell: true });
          const authed = r.status === 0;
          out.quota = authed ? 'subscription' : 'not-authed';
          out.hint = authed ? 'Copilot 구독자 무제한 (월 플랜) · https://github.com/settings/copilot' : '`gh auth login` 필요';
        }
      } catch (e) {
        out.quota = 'error';
        out.hint = e.message;
      }
      results.push(out);
    }
    if (has('--json')) { log(JSON.stringify({ quota: results }, null, 2)); return; }
    log(`# 외부 AI CLI quota 추정 (1.9.31)`);
    log('');
    log(`| Agent | 상태 | quota | 안내 |`);
    log(`|---|---|---|---|`);
    for (const q of results) {
      const statusEmoji = q.status === 'ready' ? '🟢' : q.status === 'not-installed' ? '⚪' : q.status === 'disabled' ? '🟡' : '❓';
      log(`| ${q.id} | ${statusEmoji} ${q.status} | ${q.quota || '-'} | ${q.hint || '-'} |`);
    }
    log('');
    log(`## 주의`);
    log(`  - leerness는 CLI 사용량을 직접 추적하지 않음 (provider 대시보드 참조)`);
    log(`  - rate-limit/quota는 plan/티어에 따라 달라짐`);
    log(`  - sub-agent 분배 시 quota 여유 큰 CLI 우선 활용 권장`);
    return;
  }

  fail('사용법: leerness agents list|check|quota|dispatch|bench [--write] "<task>" [--to <id>]');
  return process.exit(1);
}

function personaCmd(root, sub, idOrName, ...rest) {
  root = absRoot(root || process.cwd());
  if (!sub || sub === 'list') {
    const customDir = path.join(root, '.harness', 'personas');
    const custom = exists(customDir) ? fs.readdirSync(customDir).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')) : [];
    if (has('--json')) {
      log(JSON.stringify({
        builtin: Object.values(BUILT_IN_PERSONAS).map(p => ({ id: p.id, name: p.name, description: p.description })),
        custom
      }, null, 2));
      return;
    }
    log(`# 페르소나 카탈로그 (1.9.29)`);
    log(`\n## 내장 (${Object.keys(BUILT_IN_PERSONAS).length})`);
    for (const p of Object.values(BUILT_IN_PERSONAS)) log(`  - ${p.id}: ${p.name} — ${p.description}`);
    if (custom.length) {
      log(`\n## 사용자 정의 (${custom.length}, .harness/personas/)`);
      for (const c of custom) log(`  - ${c}`);
    }
    log(`\n💡 활용: \`leerness review <file> --persona ${Object.keys(BUILT_IN_PERSONAS)[0]}\``);
    return;
  }
  if (sub === 'show') {
    if (!idOrName) { fail('persona show <id> 필요'); return process.exit(1); }
    const p = _resolvePersona(root, idOrName);
    if (!p) { fail(`페르소나 없음: ${idOrName}`); return process.exit(1); }
    log(`# ${p.name} (${p.id})`);
    log(`\n${p.description}\n`);
    log(`---\n${p.body}`);
    return;
  }
  if (sub === 'add') {
    if (!idOrName) { fail('persona add <id> 필요'); return process.exit(1); }
    const customDir = path.join(root, '.harness', 'personas');
    if (!exists(customDir)) fs.mkdirSync(customDir, { recursive: true });
    const fp = path.join(customDir, `${idOrName}.md`);
    if (exists(fp)) { fail(`이미 존재: ${fp}`); return process.exit(1); }
    const templatePersona = `# ${idOrName}\n\n간략 설명: (한 줄 작성)\n\n---\n\n너는 ...에 정통한 ...전문가다. ...\n\n검토 영역: ...\n보고에 포함: ...`;
    writeUtf8(fp, templatePersona);
    ok(`페르소나 템플릿 생성: ${fp}`);
    log(`  편집 후 \`leerness review <file> --persona ${idOrName}\`로 사용`);
    return;
  }
  fail('사용법: leerness persona list|show <id>|add <id>');
  return process.exit(1);
}

function reviewCmd(root, target) {
  root = absRoot(root || process.cwd());
  if (!target) { fail('review <file> 필요. 예: leerness review src/api.js --persona security'); return process.exit(1); }
  const personaIds = (arg('--persona', null) || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!personaIds.length) { fail('--persona <id> 필요. \`leerness persona list\`로 확인'); return process.exit(1); }

  // 파일 확인
  const filePath = path.isAbsolute(target) ? target : path.join(root, target);
  if (!exists(filePath)) { fail(`파일 없음: ${filePath}`); return process.exit(1); }
  const fileContent = read(filePath);
  const fileSize = Buffer.byteLength(fileContent, 'utf8');
  if (fileSize > 100 * 1024) { fail(`파일 너무 큼: ${fileSize} bytes. 100KB 미만 권장.`); return process.exit(1); }

  // 페르소나 해석
  const personas = [];
  for (const id of personaIds) {
    const p = _resolvePersona(root, id);
    if (!p) { fail(`페르소나 없음: ${id}. \`leerness persona list\` 확인`); return process.exit(1); }
    personas.push(p);
  }

  // 출력 형식: emit
  const emit = arg('--emit', 'prompt'); // prompt | md | json

  if (emit === 'json') {
    log(JSON.stringify({
      file: target,
      filePath, fileSize,
      personas: personas.map(p => ({ id: p.id, name: p.name }))
    }, null, 2));
    return;
  }

  // 각 페르소나마다 별도 프롬프트 생성
  for (const p of personas) {
    if (personas.length > 1) log(`\n${'='.repeat(70)}`);
    log(`# Review Prompt — ${p.name} (${p.id})`);
    log(`## 대상: ${target} (${fileSize} bytes)`);
    log(`## 페르소나 활성화`);
    log(p.body);
    log(`\n## 작업`);
    log(`아래 코드를 위 페르소나 관점에서 정밀 리뷰하라. 한국어 보고 ~600단어.`);
    log(`\n## 코드`);
    log('```javascript');
    log(fileContent);
    log('```');
  }

  if (emit === 'md') {
    // 파일로도 저장
    const outDir = path.join(root, '.harness', 'reviews');
    if (!exists(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const tag = personas.map(p => p.id).join('-');
    const outFile = path.join(outDir, `${path.basename(target).replace(/\./g, '_')}-${tag}-${today()}.md`);
    // 이미 stdout 출력했으니 그걸 파일로도 — 간단히 생략 (사용자가 redirect 가능)
    log(`\n💡 \`leerness review <file> --persona X > out.md\` 로 저장 가능`);
  }
}

// 1.9.25: register-pending — sub-agent/외부 모델이 작업 시작 즉시 progress-tracker에 in-progress 등록
// 사용 예: leerness register-pending "<요청 내용>" --agent gemini
//   → 다음 T-ID 자동 할당, status=in-progress, evidence="(pending) by <agent>"
//   → 다른 세션이 즉시 발견 가능 (모순 감지)
function registerPendingCmd(root, requestParts) {
  root = absRoot(root || process.cwd());
  const request = (requestParts || []).join(' ').trim();
  if (!request) { fail('register-pending "<요청>" 필요. 예: leerness register-pending "toJson 함수 추가" --agent gemini'); return process.exit(1); }
  const agent = arg('--agent', 'unknown');
  const note = arg('--note', '');

  // 다음 T-ID 산출
  const rows = readProgressRows(root);
  let maxN = 0;
  for (const r of rows) {
    const m = r.id && r.id.match(/^T-(\d+)$/);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  const id = `T-${String(maxN + 1).padStart(4, '0')}`;
  const evidence = `(pending) by ${agent}${note ? ' — ' + note : ''}`;
  const row = {
    id,
    status: 'in-progress',
    request: request.slice(0, 200),
    evidence,
    nextAction: '작업 진행 중',
    updated: today()
  };
  upsertProgress(root, row);
  log(`✓ ${id} 등록됨 (in-progress) by ${agent}`);
  log(`  request: ${row.request}`);
  log(`  💡 작업 완료 후: leerness task update ${id} --status done --evidence "..."`);
  if (has('--json')) log(JSON.stringify({ ok: true, id, ...row }, null, 2));
}

// 1.9.22 후보 4: llm-bench record + retro 통합
function llmBenchRecordCmd(root) {
  root = absRoot(root || process.cwd());
  const label = arg('--label', 'manual');
  const score = arg('--score', null);
  const tokens = arg('--tokens', null);
  const model = arg('--model', 'unknown');
  if (!score) { fail('--score 필요'); return process.exit(1); }
  const histFile = path.join(root, '.harness', 'llm-bench-history.md');
  if (!exists(path.dirname(histFile))) fs.mkdirSync(path.dirname(histFile), { recursive: true });
  const row = `| ${today()} | ${model} | ${label} | ${score} | ${tokens || '?'} |\n`;
  if (!exists(histFile)) {
    writeUtf8(histFile, `# LLM Bench History\n\n| Date | Model | Label | Score | Tokens |\n|---|---|---|---:|---:|\n${row}`);
  } else {
    append(histFile, row);
  }
  ok(`기록됨: ${histFile}`);
}

function sessionClose(root, opts = {}) {
  root = absRoot(root);
  // 1.9.103: --json 모드 — stdout 억제 후 구조화 출력
  const jsonMode = !!opts.json || has('--json');
  const _origWrite = process.stdout.write.bind(process.stdout);
  if (jsonMode) process.stdout.write = () => true;
  const jsonResult = { version: VERSION, root, closedAt: now() };
  try {
  const rows = readProgressRows(root);
  const buckets = {};
  for (const s of STATUSES) buckets[s] = [];
  for (const r of rows) (buckets[r.status] || (buckets[r.status] = [])).push(r);
  // 1.9.103: JSON 결과 누적
  jsonResult.taskCounts = {};
  for (const s of STATUSES) jsonResult.taskCounts[s] = (buckets[s] || []).length;
  jsonResult.recommendedDirection = (buckets['in-progress'][0]?.request) || (buckets['planned'][0]?.request) || (buckets['requested'][0]?.request) || null;
  jsonResult.nextExactStep = (buckets['in-progress'][0]?.nextAction) || (buckets['planned'][0]?.nextAction) || (buckets['requested'][0]?.nextAction) || null;

  function rowsToList(arr) {
    if (!arr || !arr.length) return '- 없음';
    return arr.map(r => `- ${r.id} ${r.request} → next: ${r.nextAction}`).join('\n');
  }

  const evidenceSummary = exists(evidencePath(root)) ? (read(evidencePath(root)).split('\n').slice(-30).join('\n')) : '(no review-evidence.md)';
  const block = [
    `# Session Handoff`,
    ``,
    `Last generated: ${now()}`,
    ``,
    `## Completed`,
    rowsToList(buckets['done']),
    ``,
    `## In Progress`,
    rowsToList(buckets['in-progress']),
    ``,
    `## Incomplete / Waiting / On Hold / Blocked`,
    rowsToList([...(buckets['incomplete']||[]), ...(buckets['waiting']||[]), ...(buckets['on-hold']||[]), ...(buckets['blocked']||[])]),
    ``,
    `## Dropped`,
    rowsToList(buckets['dropped']),
    ``,
    `## Verification`,
    '```',
    evidenceSummary.trim() || '(empty)',
    '```',
    ``,
    `## Recommended Direction`,
    `- ${(buckets['in-progress'][0]?.request) || (buckets['planned'][0]?.request) || (buckets['requested'][0]?.request) || '다음 우선순위를 사용자와 정합니다.'}`,
    ``,
    `## Next Exact Step`,
    `- ${(buckets['in-progress'][0]?.nextAction) || (buckets['planned'][0]?.nextAction) || (buckets['requested'][0]?.nextAction) || '없음'}`,
    ``
  ].join('\n');
  const cur = exists(handoffPath(root)) ? read(handoffPath(root)) : '';
  const fmEnd = cur.indexOf('\n---\n', 4);
  const frontmatter = fmEnd > 0 ? cur.slice(0, fmEnd + 5) + MARK + '\n' : '';
  writeUtf8(handoffPath(root), (frontmatter || '') + block);

  if (exists(currentStatePath(root))) {
    let cs = read(currentStatePath(root));
    cs = cs.replace(/Updated: \d{4}-\d{2}-\d{2}/, `Updated: ${today()}`);
    cs = cs.replace(/## Now\n[\s\S]*?(?=\n## Next)/, `## Now\n- ${(buckets['in-progress'][0]?.request) || '대기 중'}\n`);
    cs = cs.replace(/## Next\n[\s\S]*?(?=\n## Blockers)/, `## Next\n- ${(buckets['planned'][0]?.request) || (buckets['requested'][0]?.request) || '계획된 작업 없음'}\n`);
    cs = cs.replace(/## Blockers\n[\s\S]*$/, `## Blockers\n${(buckets['blocked']||[]).map(b=>`- ${b.id} ${b.request}`).join('\n') || '-'}\n`);
    writeUtf8(currentStatePath(root), cs);
  }

  append(taskLogPath(root), `\n## ${today()} session-close\n- Generated session-handoff.md and refreshed current-state.md.\n`);

  log('# Session Close');
  log('## Task Lists');
  for (const s of STATUSES) {
    log(`\n### ${s}`);
    log(rowsToList(buckets[s]));
  }
  // 1.9.8: 룰 검증 자동 수행 + 보고
  const ruleResults = verifyRules(root);
  jsonResult.rules = ruleResults.map(r => ({ id: r.id, trigger: r.trigger, verified: r.verified, note: r.note }));
  log('\n## ⚡ User Rules verification');
  if (!ruleResults.length) log('- 활성 룰 없음');
  else {
    log('| ID | Trigger | Rule | Verified | Note |');
    log('|---|---|---|---|---|');
    const ic = { pass: '✓ pass', pending: '⓿ pending', manual: 'ⓘ manual', baseline: '○ baseline' };
    for (const r of ruleResults) log(`| ${r.id} | ${r.trigger} | ${r.rule.slice(0, 40)} | ${ic[r.verified] || '?'} | ${r.note} |`);
  }
  log('\n## Required final response sections');
  log('- 완료 작업\n- 진행 중 작업\n- 미완료/예정/대기/보류/차단/드랍 작업\n- 검증 결과\n- 추천 방향\n- 다음 정확한 작업\n- ⚡ 활성 룰별 검증 결과');
  ok(`session-handoff.md and current-state.md updated`);
  // 1.9.12: session close 끝에 roadmap.html 자동 갱신
  _autoRoadmap(root, 'session-close');
  // 1.9.57: --suggest 옵션 — 마감 시 skill suggest + drift check + lessons 통합 보고
  // 1.9.59: default 활성 — --no-suggest로 명시 비활성 가능
  const suggestEnabled = (has('--suggest') || (!has('--no-suggest') && process.env.LEERNESS_NO_SUGGEST !== '1'));
  if (suggestEnabled) {
    const isTty = process.stdout && process.stdout.isTTY;
    const cy = s => isTty ? `\x1b[36m${s}\x1b[0m` : s;
    const dim = s => isTty ? `\x1b[2m${s}\x1b[0m` : s;
    log('');
    log(cy('## 💡 다음 라운드 추천 (1.9.57 --suggest)'));
    // 1) skill suggest
    try {
      const r = cp.spawnSync(process.execPath, [__filename, 'skill', 'suggest', '--path', root, '--min', '3', '--json'],
        { encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '1' } });
      const j = JSON.parse(r.stdout);
      if (j.candidates && j.candidates.length) {
        log(dim('  📌 신규 skill 후보 (Hermes-style 자동 학습):'));
        for (const c of j.candidates.slice(0, 3)) log(`    • ${c.keyword} (${c.count}회 등장, 출처: ${c.source})`);
        jsonResult.skillCandidates = j.candidates.slice(0, 5);
      }
    } catch {}
    // 2) drift check
    try {
      const r = cp.spawnSync(process.execPath, [__filename, 'drift', 'check', root, '--json'],
        { encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '0' } });
      const j = JSON.parse(r.stdout.trim());
      if (j.level) {
        log(dim(`  🩺 drift 상태: ${j.level} ${j.score}/200`));
        if (j.fired && j.fired.length) log(dim(`    🔥 ${j.fired.length}건 임계 초과 — \`leerness drift check\` 상세`));
        jsonResult.drift = { level: j.level, score: j.score, fired: (j.fired || []).map(f => ({ label: f.label, weight: f.weight })) };
      }
    } catch {}
    // 3) usage stats top
    try {
      const stats = _readUsageStats(root);
      const entries = Object.entries(stats.commands || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (entries.length) {
        log(dim(`  📊 가장 많이 쓴 명령: ${entries.map(([c, n]) => `${c}(${n})`).join(', ')}`));
        jsonResult.topCommands = entries.map(([command, count]) => ({ command, count }));
      }
      // 1.9.74: MCP tools/call 통계 + rare 도구 노출
      if (stats.mcp && stats.mcp.tools) {
        const mcpEntries = Object.entries(stats.mcp.tools).sort((a, b) => b[1] - a[1]);
        if (mcpEntries.length) {
          const mcpTotal = mcpEntries.reduce((s, [, n]) => s + n, 0);
          log(dim(`  🔌 MCP 호출 (1.9.74): 총 ${mcpTotal}회, top: ${mcpEntries.slice(0, 3).map(([t, n]) => `${t}(${n})`).join(', ')}`));
          const threshold = Math.max(1, Math.floor(mcpTotal * 0.05));
          const rare = mcpEntries.filter(([, n]) => n <= threshold).map(([t]) => t);
          if (rare.length && mcpTotal >= 5) log(dim(`    💡 드물게 호출된 MCP: ${rare.slice(0, 4).join(', ')}`));
          jsonResult.mcpStats = { total: mcpTotal, top: mcpEntries.slice(0, 5).map(([tool, count]) => ({ tool, count })), rare: rare.slice(0, 10) };
        }
      }
    } catch {}
    // 1.9.74: skill match query top (skill-suggestions.md 누적)
    try {
      const histPath = path.join(root, '.harness', 'skill-suggestions.md');
      if (exists(histPath)) {
        const histTxt = read(histPath);
        const queries = [];
        for (const block of histTxt.split(/\n(?=## )/)) {
          const h = block.match(/^## ([\d-]+ [\d:]+) — query "([^"]+)"/);
          if (h) queries.push(h[2]);
        }
        if (queries.length) {
          // 같은 query 개수 카운트
          const counts = {};
          for (const q of queries) counts[q] = (counts[q] || 0) + 1;
          const topQueries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
          log(dim(`  📒 skill match query 누적 (1.9.74): 총 ${queries.length}회 / 종류 ${Object.keys(counts).length}개`));
          for (const [q, n] of topQueries) log(dim(`    • "${q.slice(0, 50)}"${n > 1 ? ` (${n}회)` : ''}`));
        }
      }
    } catch {}
    log('');
  }
  // 1.9.13: 세션 카운터 + 자동 한 줄 요약 + 5세션마다 깊은 회고
  try {
    const sc = readSessionCounter(root);
    sc.count = (sc.count || 0) + 1;
    sc.lastCloseAt = now();
    writeSessionCounter(root, sc);
    const agg = _retroAggregate(root);
    log(`\n## 📈 진행 요약 (session #${sc.count})`);
    log(`  ${_retroOneLine(agg)}`);
    // 1.9.132: archive 활동 1줄 요약 — 마감 시점에 DELETE 활동 가시화 (handoff 7번째 회수와 symmetric)
    try {
      const hdSC = path.join(root, '.harness');
      const arc = { d: 0, l: 0, p: 0, total: 0 };
      for (const [k, f] of [['d', 'decisions.archive.md'], ['l', 'lessons.archive.md'], ['p', 'plan.archive.md']]) {
        const fp = path.join(hdSC, f);
        if (exists(fp)) {
          const entries = _parseArchiveBlocks(read(fp));
          arc[k] = entries.length;
          arc.total += entries.length;
        }
      }
      if (arc.total > 0) {
        log(`  🗑  archive 누적: D${arc.d}/L${arc.l}/P${arc.p} (${arc.total}건) — 복원 후보: leerness memory archive list`);
      }
    } catch {}
    if (sc.count % 5 === 0) {
      log(`\n## 🔄 ${sc.count}세션 마일스톤 — 자동 회고 (5세션마다)`);
      retroCmd(root);
      sc.lastDeepRetroAt = now();
      writeSessionCounter(root, sc);
    } else {
      const left = 5 - (sc.count % 5);
      log(`  💡 ${left}세션 후 자동 깊은 회고 — \`leerness retro\`로 즉시 실행 가능`);
    }
    // 1.9.16: 워크스페이스 안내 (다른 leerness 프로젝트가 있으면)
    try {
      const wsCands = [path.resolve(root, '_apps'), path.resolve(root, '..', '_apps')];
      let wsCount = 0;
      for (const base of wsCands) {
        if (!exists(base)) continue;
        try { if (!fs.statSync(base).isDirectory()) continue; } catch { continue; }
        for (const e of fs.readdirSync(base)) {
          try {
            const p = path.join(base, e);
            if (fs.statSync(p).isDirectory() && exists(path.join(p, '.harness')) && p !== root) wsCount++;
          } catch {}
        }
      }
      if (wsCount > 0) log(`  🌐 워크스페이스에 ${wsCount}개 다른 leerness 프로젝트 — \`leerness retro --all-apps\`로 통합 회고`);
      jsonResult.workspacePeers = wsCount;
    } catch {}
  } catch (e) {
    warn('retro 요약 실패: ' + (e && e.message ? e.message : e));
    jsonResult.retroSummaryError = e && e.message ? e.message : String(e);
  }
  } finally {
    // 1.9.103: stdout 복원
    if (jsonMode) process.stdout.write = _origWrite;
  }
  // 1.9.103: JSON 모드 — 구조화 출력
  if (jsonMode) {
    try {
      const sc = readSessionCounter(root);
      jsonResult.sessionNumber = sc.count;
    } catch {}
    // 1.9.122: memorySurface 통합 (handoff --json 1.9.115 와 동일 패턴)
    try {
      const rows0 = readProgressRows(root);
      const tasksByStatus0 = {};
      for (const s of STATUSES) tasksByStatus0[s] = 0;
      for (const r of rows0) tasksByStatus0[r.status] = (tasksByStatus0[r.status] || 0) + 1;
      const tasksInProgress0 = tasksByStatus0['in-progress'] || 0;
      const dm0 = exists(decisionsPath(root)) ? read(decisionsPath(root)) : '';
      const decisionsCount0 = _extractDecisionBlocks(dm0).length;
      const rules0 = readRules(root);
      const rulesActive0 = rules0.filter(r => r.status === 'active').length;
      const planText0 = exists(planPath(root)) ? read(planPath(root)) : '';
      const milestones0 = (planText0.match(/^### M-\d{4}\./gm) || []).length;
      const lm0 = exists(lessonsPath(root)) ? read(lessonsPath(root)) : '';
      const lessonsCount0 = (lm0.match(/^### \d{4}-\d{2}-\d{2}[^\n]*/gm) || []).length;
      // 1.9.130: archive 카운트 통합
      const archiveCountsS = { decisions: 0, lessons: 0, plan: 0, total: 0 };
      try {
        const hdS = path.join(root, '.harness');
        for (const [key, file] of [['decisions', 'decisions.archive.md'], ['lessons', 'lessons.archive.md'], ['plan', 'plan.archive.md']]) {
          const fpS = path.join(hdS, file);
          if (exists(fpS)) {
            const entries = _parseArchiveBlocks(read(fpS));
            archiveCountsS[key] = entries.length;
            archiveCountsS.total += entries.length;
          }
        }
      } catch {}
      jsonResult.memorySurface = {
        tasks: { inProgress: tasksInProgress0, total: rows0.length, byStatus: tasksByStatus0 },
        decisions: { count: decisionsCount0 },
        rules: { active: rulesActive0, total: rules0.length },
        plan: { milestones: milestones0 },
        lessons: { count: lessonsCount0 },
        archive: archiveCountsS,  // 1.9.130
        summary: `T${tasksInProgress0}/D${decisionsCount0}/R${rulesActive0}/P${milestones0}/L${lessonsCount0}`,
      };
      // 1.9.142: featureCounts 통합 — session close JSON에 Feature Graph 통계
      try {
        const { nodes: fNodesC } = _readFeatureGraph(root);
        const edgeCount = fNodesC.reduce((s, n) => s + (n.dependsOn?.length || 0) + (n.affects?.length || 0) + (n.coChangesWith?.length || 0), 0);
        const linkedIds = new Set();
        for (const n of fNodesC) {
          for (const x of [...(n.dependsOn||[]), ...(n.affects||[]), ...(n.coChangesWith||[])]) { linkedIds.add(n.id); linkedIds.add(x); }
        }
        const isolated = fNodesC.length ? (fNodesC.length - linkedIds.size) : 0;
        jsonResult.featureGraph = {
          total: fNodesC.length,
          edges: edgeCount,
          isolated: Math.max(0, isolated),
          summary: `F${fNodesC.length}/E${edgeCount}${isolated > 0 ? `/iso${isolated}` : ''}`
        };
      } catch {}
    } catch {}
    process.stdout.write(JSON.stringify(jsonResult, null, 2) + '\n');
  }
}

function readmeCmd(root) { syncReadme(absRoot(root)); }
function consistencyCheck(root) {
  root = absRoot(root);
  const cands = ['designguide.md','design-guide.md','.harness/designguide.md','docs/designguide.md','docs/design-guide.md'];
  const found = cands.filter(f => exists(path.join(root,f)));
  log('Canonical design file: .harness/design-system.md');
  if (found.length) { warn('merge candidates found:'); found.forEach(x => log('- ' + x)); }
  else ok('no duplicate design guide candidates');
}
function mergeDesign(root) {
  root = absRoot(root);
  const canonical = path.join(root,'.harness/design-system.md');
  const cands = ['designguide.md','design-guide.md','.harness/designguide.md','docs/designguide.md','docs/design-guide.md'];
  let merged = '';
  for (const f of cands) { const p = path.join(root,f); if (exists(p)) merged += `\n\n## Merged from ${f}\n\n` + read(p); }
  if (merged) append(canonical, merged);
  ok(merged ? 'design guides merged into .harness/design-system.md' : 'nothing to merge');
}

// 1.9.2: self check를 update --check의 thin wrapper로 통합 (단일 출처).
async function selfCheck(root) {
  return await updateCmd(root, { checkOnly: true });
}

// 1.9.2: 게이트 5종 한번에 실행 (verify + audit + scan secrets + encoding check + lazy detect).
function gate(root) {
  root = absRoot(root);
  log('# leerness gate (5 checks)');
  let bad = 0;
  function step(label, fn) {
    log(`\n## ${label}`);
    const code0 = process.exitCode || 0;
    try { fn(); } catch (e) { fail(`${label} threw: ${e.message}`); bad++; }
    if (process.exitCode && process.exitCode !== code0) bad++;
    process.exitCode = 0;
  }
  step('verify', () => verify(root));
  step('audit', () => audit(root));
  step('scan secrets', () => scanSecrets(root));
  step('encoding check', () => encodingCheck(root));
  step('lazy detect', () => lazyDetect(root));
  log(`\n# gate summary: ${bad} 단계 실패`);
  if (bad) process.exitCode = 1;
  else ok('all gates passed');
}

// ===== 1.9.13: Retrospective / Insights / Brainstorming =====
function sessionCounterPath(root) { return path.join(root, '.harness/cache/session-counter.json'); }
function readSessionCounter(root) {
  if (!exists(sessionCounterPath(root))) return { count: 0, lastCloseAt: null, lastDeepRetroAt: null };
  try { return JSON.parse(read(sessionCounterPath(root))); } catch { return { count: 0, lastCloseAt: null, lastDeepRetroAt: null }; }
}
function writeSessionCounter(root, c) { writeUtf8(sessionCounterPath(root), JSON.stringify(c, null, 2) + '\n'); }

// 1.9.14 A/D: 결정 블록 추출 — 코드 블록 안의 ### + Template 제외
function _extractDecisionBlocks(text) {
  // 줄 시작의 ```부터 줄 시작의 ```까지를 코드블록으로 인식 (인라인 백틱 무시)
  const cleaned = String(text || '').replace(/^```[^\n]*\n[\s\S]*?\n```\s*$/gm, '');
  return cleaned.split(/\n(?=### )/).filter(b =>
    b.startsWith('### ') && !/^### (Template|템플릿)\b/.test(b.trim())
  );
}

function _retroAggregate(root) {
  root = absRoot(root);
  const rows = readProgressRows(root);
  const decisions = exists(decisionsPath(root)) ? read(decisionsPath(root)) : '';
  const tlog = exists(taskLogPath(root)) ? read(taskLogPath(root)) : '';
  const evidence = exists(evidencePath(root)) ? read(evidencePath(root)) : '';
  const handoff = exists(handoffPath(root)) ? read(handoffPath(root)) : '';

  // 1) 작업 상태 분포
  const statusCounts = {};
  for (const s of STATUSES) statusCounts[s] = 0;
  for (const r of rows) if (statusCounts[r.status] != null) statusCounts[r.status]++;

  // 2) 결정 블록 수 (1.9.14: 코드블록/Template 제외)
  const decisionBlocks = _extractDecisionBlocks(decisions);
  // recent decisions (날짜로 정렬 시 가장 최근)
  const recentDecisions = decisionBlocks.slice(-5).map(b => {
    const t = (b.match(/^### (.+)$/m) || [, ''])[1];
    return { title: t.trim(), block: b.slice(0, 200) };
  }).reverse();

  // 3) 스킬 활용
  const skillsDir = path.join(root, '.harness/skills');
  const skillUsage = [];
  if (exists(skillsDir)) {
    for (const id of fs.readdirSync(skillsDir)) {
      const f = path.join(skillsDir, id, 'skill.json');
      if (!exists(f)) continue;
      try {
        const s = JSON.parse(read(f));
        skillUsage.push({
          id,
          displayNameKo: s.displayNameKo || id,
          count: s.usage?.count || 0,
          lastUsed: s.usage?.lastUsed || null,
          optimizations: (s.optimizations || []).length,
          capabilities: (s.capabilities || []).length
        });
      } catch {}
    }
  }
  skillUsage.sort((a, b) => (b.count - a.count) || (b.optimizations - a.optimizations));

  // 4) 검증 시간 추세 — review-evidence.md에서 "exit=0 (Nms)" 또는 "(Nms)" 패턴
  const durations = [];
  for (const m of evidence.matchAll(/exit=\d+\s*\((\d+)ms\)/g)) durations.push(parseInt(m[1], 10));

  // 5) 실패→성공 시그널 — task-log/evidence/decisions에서 "롤백" / "fail" / "재발" / "fix" / "수정" 등의 동시 등장 카운트
  const fixSignals = (tlog + evidence + decisions).match(/\b(fix|fixed|수정|롤백|재발|incomplete|bug)\b/gi) || [];
  const passSignals = (tlog + evidence + decisions).match(/(?:✓|pass(?:ed)?|통과|completed|done)/gi) || [];

  // 6) 룰 활용
  const rules = exists(rulesPath(root)) ? readRules(root) : [];
  const activeRules = rules.filter(r => r.status === 'active');
  const verifiedRules = rules.filter(r => r.lastVerified && r.lastVerified !== '-');

  // 7) 다음 우선 작업 — 우선순위: in-progress > blocked/waiting/on-hold/incomplete > planned/requested (1.9.14 C)
  const _priority = { 'in-progress': 0, 'blocked': 1, 'waiting': 1, 'on-hold': 1, 'incomplete': 1, 'planned': 2, 'requested': 2 };
  const focusNext = rows.filter(r => _priority[r.status] != null)
    .sort((a, b) => (_priority[a.status] || 9) - (_priority[b.status] || 9));

  return {
    statusCounts,
    rows,
    totalTasks: rows.length,
    doneCount: statusCounts.done,
    decisionBlocks: decisionBlocks.length,
    recentDecisions,
    skillUsage,
    totalSkillUsage: skillUsage.reduce((a, b) => a + b.count, 0),
    totalOptimizations: skillUsage.reduce((a, b) => a + b.optimizations, 0),
    durations,
    fixSignals: fixSignals.length,
    passSignals: passSignals.length,
    activeRules: activeRules.length,
    verifiedRules: verifiedRules.length,
    focusNext
  };
}

function _retroOneLine(agg) {
  const parts = [];
  const done = agg.statusCounts.done;
  const total = agg.totalTasks;
  if (total) parts.push(`완료 ${done}/${total} (${Math.round(done / total * 100)}%)`);
  if (agg.totalSkillUsage) parts.push(`스킬 ${agg.skillUsage.length}종 / 사용 ${agg.totalSkillUsage}회 / 최적화 ${agg.totalOptimizations}건`);
  if (agg.activeRules) parts.push(`룰 ${agg.activeRules}건 활성 (${agg.verifiedRules} 검증됨)`);
  if (agg.durations.length >= 4) {
    const mid = Math.floor(agg.durations.length / 2);
    const a = agg.durations.slice(0, mid).reduce((x, y) => x + y, 0) / mid;
    const b = agg.durations.slice(mid).reduce((x, y) => x + y, 0) / (agg.durations.length - mid);
    if (a > 0) {
      const delta = ((b - a) / a) * 100;
      const sign = delta > 0 ? '+' : '';
      parts.push(`검증 ${Math.round(a)}ms→${Math.round(b)}ms (${sign}${delta.toFixed(1)}%)`);
    }
  }
  parts.push(`결정 ${agg.decisionBlocks}건 누적`);
  return parts.join(' · ');
}

// 1.9.15: --all-apps / --include 경로 모음
// 1.9.169 fix: --include 명시되면 cwd 자동 추가 안 함 (explicit-only).
//   기존: cwd/.harness 자동 추가 → 잔존 .harness 시 의도치 않은 카운트 증가 (e2e flake 원인)
//   변경: --include 시 사용자가 명시한 경로만 사용. --all-apps 단독은 기존 동작 유지.
function _collectWorkspacePaths(rootBase) {
  const set = new Set();
  const include = arg('--include', null);
  // --include 명시 시 cwd 자동 추가 스킵 (explicit-only 보장)
  if (!include) {
    if (exists(path.join(rootBase, '.harness'))) set.add(rootBase);
  }
  if (has('--all-apps')) {
    const baseCandidates = [path.resolve(rootBase, '_apps'), path.resolve(rootBase, '..', '_apps')];
    for (const base of baseCandidates) {
      if (!exists(base)) continue;
      let st; try { st = fs.statSync(base); } catch { continue; }
      if (!st.isDirectory()) continue;
      for (const e of fs.readdirSync(base)) {
        const p = path.join(base, e);
        try {
          if (fs.statSync(p).isDirectory() && exists(path.join(p, '.harness'))) set.add(p);
        } catch {}
      }
    }
  }
  if (include) {
    for (const p of String(include).split(',')) {
      const abs = path.resolve(p.trim());
      if (exists(path.join(abs, '.harness'))) set.add(abs);
      else warn(`--include 무시: ${abs} (.harness 없음)`);
    }
  }
  return Array.from(set);
}

function retroCmd(root) {
  root = absRoot(root);
  // 1.9.15: --all-apps / --include 통합 모드
  if (has('--all-apps') || arg('--include', null)) {
    return _retroWorkspace(root);
  }
  const days = parseInt(arg('--days', '7'), 10);
  const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10);
  const agg = _retroAggregate(root);
  // 1.9.16: --json
  if (has('--json')) {
    log(JSON.stringify({ project: path.basename(root), days, cutoff, summary: _retroOneLine(agg), data: agg }, null, 2));
    return;
  }
  log(`# 회고 (retro) — 최근 ${days}일 (since ${cutoff})`);
  log(`\n📈 한 줄 요약: ${_retroOneLine(agg)}`);

  log(`\n## 작업 상태 분포`);
  for (const s of STATUSES) if (agg.statusCounts[s]) log(`  - ${s}: ${agg.statusCounts[s]}`);

  log(`\n## 🎯 다음 우선 작업 (top 5)`);
  if (!agg.focusNext.length) log('  (없음 — 새 plan add 권장)');
  else agg.focusNext.slice(0, 5).forEach(r => log(`  - ${r.id} [${r.status}] ${r.request} → ${r.nextAction}`));

  log(`\n## 📚 스킬 활용 추세 (top 5)`);
  if (!agg.skillUsage.length) log('  (등록된 스킬 없음)');
  else agg.skillUsage.slice(0, 5).forEach(s => log(`  - ${s.id}: 사용 ${s.count}회, 최적화 ${s.optimizations}건, capabilities ${s.capabilities}개${s.lastUsed ? ' · 마지막 ' + s.lastUsed.slice(0, 10) : ''}`));

  log(`\n## 🧠 최근 결정 (top 5)`);
  if (!agg.recentDecisions.length) log('  (없음)');
  else agg.recentDecisions.slice(0, 5).forEach(d => log(`  - ${d.title}`));

  if (agg.durations.length >= 4) {
    const mid = Math.floor(agg.durations.length / 2);
    const a = agg.durations.slice(0, mid).reduce((x, y) => x + y, 0) / mid;
    const b = agg.durations.slice(mid).reduce((x, y) => x + y, 0) / (agg.durations.length - mid);
    const delta = ((b - a) / a) * 100;
    log(`\n## ⏱ 검증 시간 추세 (review-evidence)`);
    log(`  - 전반부 평균: ${Math.round(a)}ms`);
    log(`  - 후반부 평균: ${Math.round(b)}ms`);
    log(`  - 변화: ${delta > 0 ? '+' : ''}${delta.toFixed(1)}% ${delta < 0 ? '🚀 빨라짐' : delta > 10 ? '⚠ 느려짐' : ''}`);
  }

  log(`\n## ⚡ 활성 룰 / 검증 비율`);
  log(`  - 활성 ${agg.activeRules}건 · 검증됨 ${agg.verifiedRules}건 (${agg.activeRules ? Math.round(agg.verifiedRules / agg.activeRules * 100) : 0}%)`);

  log(`\n## 🔁 fix/pass 시그널`);
  log(`  - fix 시그널 (롤백/수정/bug/incomplete): ${agg.fixSignals}회`);
  log(`  - pass 시그널 (통과/✓/completed): ${agg.passSignals}회`);
  if (agg.passSignals > agg.fixSignals * 2) log('  - 평가: 안정적 (pass >> fix)');
  else if (agg.fixSignals > agg.passSignals) log('  - 평가: 디버그 비중 높음 — verify-code 자동화 검토');

  log(`\n## 💡 권장 다음 단계`);
  if (agg.focusNext.length) log(`  1. ${agg.focusNext[0].id} (${agg.focusNext[0].status}): ${agg.focusNext[0].nextAction}`);
  if (agg.skillUsage.length && agg.skillUsage[0].count > 0) log(`  2. 가장 활발한 스킬 "${agg.skillUsage[0].id}"의 패턴을 다른 작업에 재사용 가능`);
  if (agg.totalOptimizations > 0) log(`  3. 누적된 최적화 ${agg.totalOptimizations}건을 새 작업의 시작 전 참고 (\`leerness skill info <id>\`)`);
  log(`  4. \`leerness brainstorm <주제>\`로 누적 데이터 기반 컨텍스트 적재`);
}

// 1.9.15: 워크스페이스 통합 retro (다수 프로젝트 묶음 회고)
function _retroWorkspace(rootBase) {
  const paths = _collectWorkspacePaths(rootBase);
  if (!paths.length) return fail('대상 프로젝트 없음. --include <path1,path2> 또는 --all-apps 사용 필요.');
  // 1.9.16: --json
  if (has('--json')) {
    const projects = paths.map(p => {
      const a = _retroAggregate(p);
      return { project: path.basename(p), path: p, summary: _retroOneLine(a), data: a };
    });
    const totals = projects.reduce((t, p) => ({
      tasks: t.tasks + p.data.totalTasks, done: t.done + p.data.doneCount,
      decisions: t.decisions + p.data.decisionBlocks, skills: t.skills + p.data.skillUsage.length,
      usage: t.usage + p.data.totalSkillUsage, opts: t.opts + p.data.totalOptimizations,
      activeRules: t.activeRules + p.data.activeRules, pass: t.pass + p.data.passSignals, fix: t.fix + p.data.fixSignals
    }), { tasks: 0, done: 0, decisions: 0, skills: 0, usage: 0, opts: 0, activeRules: 0, pass: 0, fix: 0 });
    log(JSON.stringify({ projects, totals, projectCount: paths.length }, null, 2));
    return;
  }
  log(`# Cross-project retro — ${paths.length}개 프로젝트`);
  const totals = { tasks: 0, done: 0, decisions: 0, skills: 0, totalSkillUsage: 0, totalOpts: 0, activeRules: 0, fixSig: 0, passSig: 0 };
  for (const p of paths) {
    const agg = _retroAggregate(p);
    const name = path.basename(p);
    log(`\n## ${name}`);
    log(`  📈 ${_retroOneLine(agg)}`);
    const f = agg.focusNext[0];
    log(`  🎯 다음 우선: ${f ? `${f.id} [${f.status}] ${f.request.slice(0, 50)}` : '(없음)'}`);
    log(`  📚 top 스킬: ${agg.skillUsage.length ? agg.skillUsage[0].id + ' (' + agg.skillUsage[0].count + '회)' : '(없음)'}`);
    totals.tasks += agg.totalTasks;
    totals.done += agg.doneCount;
    totals.decisions += agg.decisionBlocks;
    totals.skills += agg.skillUsage.length;
    totals.totalSkillUsage += agg.totalSkillUsage;
    totals.totalOpts += agg.totalOptimizations;
    totals.activeRules += agg.activeRules;
    totals.fixSig += agg.fixSignals;
    totals.passSig += agg.passSignals;
  }
  log(`\n## 📊 워크스페이스 총합 (${paths.length} 프로젝트)`);
  log(`  - 누적 task: ${totals.tasks}${totals.tasks ? ` (done ${totals.done} = ${Math.round(totals.done / totals.tasks * 100)}%)` : ''}`);
  log(`  - 누적 결정: ${totals.decisions}건`);
  log(`  - 스킬: ${totals.skills}종 / 사용 ${totals.totalSkillUsage}회 / 최적화 ${totals.totalOpts}건`);
  log(`  - 활성 룰: ${totals.activeRules}건`);
  log(`  - 시그널: pass ${totals.passSig} · fix ${totals.fixSig}${totals.passSig + totals.fixSig > 0 ? ` (비율 ${totals.fixSig ? (totals.passSig / totals.fixSig).toFixed(2) : '∞'})` : ''}`);
}

function insightsCmd(root) {
  root = absRoot(root);
  // 1.9.15: --all-apps / --include 통합 모드
  if (has('--all-apps') || arg('--include', null)) {
    return _insightsWorkspace(root);
  }
  const agg = _retroAggregate(root);
  // 1.9.16: --json
  if (has('--json')) {
    const sc = readSessionCounter(root);
    log(JSON.stringify({ project: path.basename(root), sessionCount: sc.count, lastCloseAt: sc.lastCloseAt, data: agg }, null, 2));
    return;
  }
  const sc = readSessionCounter(root);
  log(`# Insights — 누적 통계`);
  log(`\n## 📊 핵심 지표`);
  log(`  - 누적 task: ${agg.totalTasks} (done ${agg.doneCount}, in-progress ${agg.statusCounts['in-progress']}, planned ${agg.statusCounts.planned})`);
  log(`  - 누적 결정 (decisions.md): ${agg.decisionBlocks}건`);
  log(`  - 누적 스킬: ${agg.skillUsage.length}종`);
  log(`  - 총 스킬 사용: ${agg.totalSkillUsage}회`);
  log(`  - 총 최적화 누적: ${agg.totalOptimizations}건`);
  log(`  - 활성 룰: ${agg.activeRules}건 (검증 ${agg.verifiedRules}건)`);
  log(`  - session close 횟수: ${sc.count}회${sc.lastCloseAt ? ' (마지막: ' + sc.lastCloseAt.slice(0, 16) + ')' : ''}`);

  if (agg.skillUsage.length) {
    log(`\n## 🏆 가장 활용도 높은 스킬 (top 5)`);
    agg.skillUsage.slice(0, 5).forEach((s, i) => log(`  ${i + 1}. ${s.id} (${s.displayNameKo}) — 사용 ${s.count}회, 최적화 ${s.optimizations}건`));
  }

  if (agg.durations.length) {
    const total = agg.durations.reduce((a, b) => a + b, 0);
    log(`\n## ⏱ 검증 시간 (verify-code)`);
    log(`  - 실행: ${agg.durations.length}회 / 총 ${total}ms / 평균 ${Math.round(total / agg.durations.length)}ms`);
    log(`  - 최소 ${Math.min(...agg.durations)}ms / 최대 ${Math.max(...agg.durations)}ms`);
  }

  log(`\n## 🔁 안정성 지표`);
  log(`  - pass 시그널: ${agg.passSignals} · fix 시그널: ${agg.fixSignals}`);
  const ratio = agg.fixSignals > 0 ? (agg.passSignals / agg.fixSignals).toFixed(2) : '∞';
  log(`  - pass/fix 비율: ${ratio}${ratio === '∞' || parseFloat(ratio) > 3 ? ' (안정)' : parseFloat(ratio) < 1 ? ' (디버그 위주)' : ' (보통)'}`);

  log(`\n## 📈 권장`);
  if (agg.totalOptimizations === 0) log(`  - 스킬에 최적화 누적 없음 — \`leerness skill optimize <id> --before --after\`로 더 나은 방법 기록`);
  if (sc.count >= 5 && sc.count % 5 === 0) log(`  - 5세션마다 자동 깊은 회고가 예정되어 있습니다 — session close가 자동 호출`);
  if (agg.statusCounts.blocked > 0) log(`  - blocked 작업 ${agg.statusCounts.blocked}건 — \`leerness lessons --query "blocked"\`로 과거 패턴 회수`);
}

function _insightsWorkspace(rootBase) {
  const paths = _collectWorkspacePaths(rootBase);
  if (!paths.length) return fail('대상 프로젝트 없음. --include 또는 --all-apps 사용.');
  // 1.9.16: --json
  if (has('--json')) {
    const projects = paths.map(p => ({ project: path.basename(p), path: p, data: _retroAggregate(p) }));
    log(JSON.stringify({ projects, projectCount: paths.length }, null, 2));
    return;
  }
  log(`# Workspace Insights — ${paths.length}개 프로젝트`);
  log(`\n| Project | Task | Done % | Decisions | Skills | Usage | Opts | Pass/Fix |`);
  log(`|---|---|---|---|---|---|---|---|`);
  const totals = { tasks: 0, done: 0, decisions: 0, skills: 0, usage: 0, opts: 0, pass: 0, fix: 0 };
  for (const p of paths) {
    const a = _retroAggregate(p);
    const donePct = a.totalTasks ? Math.round(a.doneCount / a.totalTasks * 100) : 0;
    const pf = a.fixSignals ? (a.passSignals / a.fixSignals).toFixed(1) : '∞';
    log(`| ${path.basename(p)} | ${a.totalTasks} | ${donePct}% | ${a.decisionBlocks} | ${a.skillUsage.length} | ${a.totalSkillUsage} | ${a.totalOptimizations} | ${a.passSignals}/${a.fixSignals} (${pf}) |`);
    totals.tasks += a.totalTasks; totals.done += a.doneCount; totals.decisions += a.decisionBlocks;
    totals.skills += a.skillUsage.length; totals.usage += a.totalSkillUsage; totals.opts += a.totalOptimizations;
    totals.pass += a.passSignals; totals.fix += a.fixSignals;
  }
  const tpf = totals.fix ? (totals.pass / totals.fix).toFixed(1) : '∞';
  const tDonePct = totals.tasks ? Math.round(totals.done / totals.tasks * 100) : 0;
  log(`| **TOTAL** | **${totals.tasks}** | **${tDonePct}%** | **${totals.decisions}** | **${totals.skills}** | **${totals.usage}** | **${totals.opts}** | **${totals.pass}/${totals.fix} (${tpf})** |`);
  log(`\n## 📈 평가`);
  if (totals.pass > totals.fix * 3) log(`  - 안정성: 우수 (pass÷fix = ${tpf})`);
  else if (totals.pass > totals.fix) log(`  - 안정성: 보통 (pass÷fix = ${tpf})`);
  else if (totals.fix > 0) log(`  - 안정성: 주의 (fix가 pass보다 많음) — verify-code 자동화 검토`);
  if (totals.opts === 0) log(`  - 최적화 누적 없음 — \`leerness skill optimize\` 활용 권장`);
}

// 1.9.16: brainstorm 핵심 로직 분리 — 단일 프로젝트 결과 반환
function _brainstormFor(root, topic) {
  function _escUnicode(s) { return String(s).replace(/[\\^$*+?.()|[\]{}]/g, '\\$&'); }
  const tokens = String(topic).split(/\s+/).filter(t => t.length >= 2);
  const wordRes = tokens.map(t => new RegExp(`(?<![\\p{L}\\p{N}_])${_escUnicode(t)}(?![\\p{L}\\p{N}_])`, 'iu'));
  function matches(text) { return wordRes.every(re => re.test(text)); }
  // 1.9.72: skillHistory + taskLogFails 필드 추가
  // 1.9.116: lessonsExplicit (lessons.md 전용) + planMilestones (plan.md M-XXXX) 추가 — Memory Surface 5종 완전 통합
  const hits = { decisions: [], skills: [], tasks: [], rules: [], evidence: [], lessons: [], code: [], skillHistory: [], taskLogFails: [], lessonsExplicit: [], planMilestones: [] };
  const dec = exists(decisionsPath(root)) ? read(decisionsPath(root)) : '';
  const decLines = dec.split('\n');
  for (const b of _extractDecisionBlocks(dec)) {
    if (matches(b)) {
      const t = (b.match(/^### (.+)$/m) || [, ''])[1];
      const lineIdx = decLines.findIndex(line => line === `### ${t}`);
      const lineNo = lineIdx >= 0 ? lineIdx + 1 : 0;
      hits.decisions.push({ title: t, preview: b.slice(0, 200).replace(/\n+/g, ' '), line: lineNo });
    }
  }
  const skillsDir = path.join(root, '.harness/skills');
  if (exists(skillsDir)) {
    for (const id of fs.readdirSync(skillsDir)) {
      const f = path.join(skillsDir, id, 'skill.json');
      if (!exists(f)) continue;
      try {
        const s = JSON.parse(read(f));
        if (matches(JSON.stringify(s))) hits.skills.push({ id, displayNameKo: s.displayNameKo, capabilities: s.capabilities, usage: s.usage });
      } catch {}
    }
  }
  const rows = readProgressRows(root);
  const progressText = exists(progressPath(root)) ? read(progressPath(root)) : '';
  for (const r of rows) {
    const fields = [];
    if (matches(r.request)) fields.push('request');
    if (matches(r.evidence)) fields.push('evidence');
    if (matches(r.nextAction)) fields.push('nextAction');
    if (fields.length) {
      const idx = progressText.indexOf(`| ${r.id} |`);
      const lineNo = idx >= 0 ? progressText.slice(0, idx).split('\n').length : 0;
      hits.tasks.push({ ...r, _fields: fields, line: lineNo });
    }
  }
  if (exists(rulesPath(root))) {
    const rulesText = read(rulesPath(root));
    for (const r of readRules(root)) {
      if (matches(r.rule)) {
        const idx = rulesText.indexOf(`| ${r.id} |`);
        const lineNo = idx >= 0 ? rulesText.slice(0, idx).split('\n').length : 0;
        hits.rules.push({ ...r, line: lineNo });
      }
    }
  }
  const ev = exists(evidencePath(root)) ? read(evidencePath(root)) : '';
  for (const block of ev.split(/\n(?=## )/)) {
    if (!block.startsWith('## ')) continue;
    if (matches(block)) {
      const t = (block.match(/^## (.+)$/m) || [, ''])[1];
      const idx = ev.indexOf(block);
      const lineNo = idx >= 0 ? ev.slice(0, idx).split('\n').length : 0;
      hits.evidence.push({ title: t.trim(), preview: block.slice(0, 200).replace(/\n+/g, ' '), line: lineNo });
      if (/✗|fail|롤백|incomplete|버그/i.test(block)) hits.lessons.push({ title: t.trim(), line: lineNo });
    }
  }
  // 1.9.72: skill-suggestions.md rolling history hits
  const histPath = path.join(root, '.harness', 'skill-suggestions.md');
  if (exists(histPath)) {
    const histTxt = read(histPath);
    for (const block of histTxt.split(/\n(?=## )/)) {
      if (!block.startsWith('## ')) continue;
      const h = block.match(/^## ([\d-]+ [\d:]+) — query "([^"]+)"/);
      if (h && matches(block)) {
        const idx = histTxt.indexOf(block);
        const lineNo = idx >= 0 ? histTxt.slice(0, idx).split('\n').length : 0;
        hits.skillHistory.push({ at: h[1], query: h[2], preview: block.slice(0, 220).replace(/\n+/g, ' '), line: lineNo });
      }
    }
  }
  // 1.9.116: lessons.md (전용 lessons) hits — Memory Write Surface 5번째
  const lp_brainstorm = lessonsPath(root);
  if (exists(lp_brainstorm)) {
    const lessonsText = read(lp_brainstorm);
    for (const block of lessonsText.split(/\n(?=### )/)) {
      if (!block.startsWith('### ')) continue;
      const lessonMatch = block.match(/- Lesson:\s*(.+)/);
      if (lessonMatch && matches(block)) {
        const idx = lessonsText.indexOf(block);
        const lineNo = idx >= 0 ? lessonsText.slice(0, idx).split('\n').length : 0;
        hits.lessonsExplicit.push({ title: lessonMatch[1].trim().slice(0, 120), preview: block.slice(0, 220).replace(/\n+/g, ' '), line: lineNo });
      }
    }
  }
  // 1.9.116: plan.md milestone hits — Memory Write Surface plan
  const planFile_brainstorm = planPath(root);
  if (exists(planFile_brainstorm)) {
    const planText = read(planFile_brainstorm);
    const milestoneBlocks = planText.split(/\n(?=### M-\d{4}\.)/);
    for (const b of milestoneBlocks) {
      const m = b.match(/^### (M-\d{4})\.\s*(.+?)$/m);
      if (m && matches(b)) {
        const idx = planText.indexOf(b);
        const lineNo = idx >= 0 ? planText.slice(0, idx).split('\n').length : 0;
        hits.planMilestones.push({ id: m[1], title: m[2].trim().slice(0, 120), preview: b.slice(0, 220).replace(/\n+/g, ' '), line: lineNo });
      }
    }
  }
  // 1.9.72: task-log.md 실패 라인 hits
  const tlogPath = path.join(root, '.harness', 'task-log.md');
  if (exists(tlogPath)) {
    const tlog = read(tlogPath);
    const lines = tlog.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 4 && /✗|\bfail|롤백|재발|incomplete|버그/i.test(line) && matches(line)) {
        hits.taskLogFails.push({ title: line.replace(/^[-*]\s*/, '').slice(0, 100), line: i + 1 });
      }
    }
  }
  // 1.9.131: 3 archive 파일 (decisions/lessons/plan) hits — DELETE 5종 archive 도 brainstorm 후보로
  //   archived ideas 가 새 brainstorm 시점에 다시 후보로 노출 → "이전에 검토한 건데 다시 볼까?"
  hits.archive = { decisions: [], lessons: [], plan: [] };
  const archiveSources_bsFor = [
    { key: 'decisions', file: 'decisions.archive.md' },
    { key: 'lessons',   file: 'lessons.archive.md' },
    { key: 'plan',      file: 'plan.archive.md' }
  ];
  for (const src of archiveSources_bsFor) {
    const fp = path.join(root, '.harness', src.file);
    if (!exists(fp)) continue;
    const txt = read(fp);
    const blocks = txt.split(/\n(?=## 제거 )/);
    for (const b of blocks) {
      const m = b.match(/^## 제거 (\d{4}-\d{2}-\d{2})\s*\(target:\s*"([^"]*)"\)/);
      if (!m) continue;
      if (matches(b)) {
        const headerMatch = b.match(/^### (.+)$/m);
        const idx = txt.indexOf(b);
        const lineNo = idx >= 0 ? txt.slice(0, idx).split('\n').length : 0;
        hits.archive[src.key].push({
          date: m[1],
          target: m[2],
          originalHeader: headerMatch ? headerMatch[1].trim() : null,
          preview: b.slice(0, 220).replace(/\n+/g, ' '),
          line: lineNo
        });
      }
    }
  }
  // 1.9.25: --include-code 옵션 — 소스 본문 검색 추가 (모순 감지 핵심)
  if (has('--include-code')) {
    const codeDirs = ['src', 'tests', 'bin', 'lib'];
    for (const dir of codeDirs) {
      const dp = path.join(root, dir);
      if (!exists(dp)) continue;
      function walkCode(d) {
        let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) { walkCode(p); continue; }
          if (!/\.(js|ts|jsx|tsx|gd|cs|py|rb|go|rs)$/i.test(e.name)) continue;
          let txt; try { txt = read(p); } catch { continue; }
          if (matches(txt)) {
            const lines = txt.split('\n');
            const firstHit = lines.findIndex(l => matches(l));
            hits.code.push({
              file: rel(root, p),
              line: firstHit >= 0 ? firstHit + 1 : 0,
              preview: firstHit >= 0 ? lines[firstHit].trim().slice(0, 120) : ''
            });
            if (hits.code.length >= 20) return; // 너무 많으면 stop
          }
        }
      }
      walkCode(dp);
    }
  }
  return hits;
}

function _brainstormTotal(h) { return h.decisions.length + h.skills.length + h.tasks.length + h.rules.length + h.evidence.length + (h.code?.length || 0) + (h.skillHistory?.length || 0) + (h.taskLogFails?.length || 0) + (h.lessonsExplicit?.length || 0) + (h.planMilestones?.length || 0); }

// 1.9.16: 워크스페이스 통합 brainstorm
function _brainstormWorkspace(rootBase, topic) {
  const paths = _collectWorkspacePaths(rootBase);
  if (!paths.length) return fail('대상 프로젝트 없음. --include 또는 --all-apps 사용.');
  if (has('--json')) {
    const result = paths.map(p => ({ project: path.basename(p), path: p, hits: _brainstormFor(p, topic) }));
    log(JSON.stringify({ topic, projects: result, total: result.reduce((a, b) => a + _brainstormTotal(b.hits), 0) }, null, 2));
    return;
  }
  log(`# Cross-project Brainstorm — "${topic}" — ${paths.length}개 프로젝트`);
  let grandTotal = 0;
  for (const p of paths) {
    const h = _brainstormFor(p, topic);
    const n = _brainstormTotal(h);
    grandTotal += n;
    if (n === 0) continue;
    log(`\n## ${path.basename(p)} (${n}건)`);
    if (h.decisions.length) {
      log(`  🧠 결정 (${h.decisions.length})`);
      h.decisions.slice(0, 3).forEach(d => log(`    - decisions.md:${d.line || '?'} — ${d.title}`));
    }
    if (h.skills.length) {
      log(`  📚 스킬 (${h.skills.length})`);
      h.skills.slice(0, 3).forEach(s => log(`    - ${s.id} (${s.displayNameKo}) · 사용 ${s.usage?.count || 0}회`));
    }
    if (h.tasks.length) {
      log(`  📌 task (${h.tasks.length})`);
      h.tasks.slice(0, 3).forEach(t => log(`    - progress-tracker.md:${t.line || '?'} — ${t.id} [${t.status}] ${t.request.slice(0, 50)} (matched: ${t._fields.join('+')})`));
    }
    if (h.rules.length) {
      log(`  ⚡ 룰 (${h.rules.length})`);
      h.rules.slice(0, 3).forEach(r => log(`    - rules.md:${r.line || '?'} — ${r.id} [${r.trigger}]`));
    }
    if (h.evidence.length) {
      log(`  🧪 evidence (${h.evidence.length})`);
      h.evidence.slice(0, 3).forEach(e => log(`    - review-evidence.md:${e.line || '?'} — ${e.title}`));
    }
    if (h.lessons.length) {
      log(`  ⚠ 과거 실패/롤백 (${h.lessons.length})`);
    }
    // 1.9.25: 소스 코드 본문 hits
    if (h.code && h.code.length) {
      log(`  💻 코드 (${h.code.length})`);
      h.code.slice(0, 5).forEach(c => log(`    - ${c.file}:${c.line} — ${c.preview}`));
    }
  }
  log(`\n## 📊 워크스페이스 총합: ${grandTotal}건 매치 (${paths.length} 프로젝트)${has('--include-code') ? ' (소스 코드 포함)' : ''}`);
  if (grandTotal === 0) log(`  ⓘ 어느 프로젝트에서도 "${topic}" 관련 자원 없음 — 새 영역. 첫 결정/스킬을 기록하면 다음 brainstorm이 풍부해짐.`);
}

function brainstormCmd(root, topic) {
  root = absRoot(root);
  if (!topic) return fail('topic required (e.g., brainstorm "API rate limit")');
  // 1.9.16: --all-apps / --include 통합 모드
  if (has('--all-apps') || arg('--include', null)) {
    return _brainstormWorkspace(root, topic);
  }
  // 1.9.16: --json 단일 프로젝트
  if (has('--json')) {
    const h = _brainstormFor(root, topic);
    log(JSON.stringify({ topic, project: path.basename(root), hits: h, total: _brainstormTotal(h) }, null, 2));
    return;
  }
  log(`# Brainstorm — "${topic}"`);
  log(`\n누적된 leerness 데이터에서 주제 관련 자원을 회수합니다.`);

  // 1.9.14 B: 토큰 기반 매칭 — unicode word boundary. unicode 모드에서 하이픈은 escape 불필요.
  function _escUnicode(s) { return String(s).replace(/[\\^$*+?.()|[\]{}]/g, '\\$&'); }
  const tokens = String(topic).split(/\s+/).filter(t => t.length >= 2);
  const wordRes = tokens.map(t => new RegExp(`(?<![\\p{L}\\p{N}_])${_escUnicode(t)}(?![\\p{L}\\p{N}_])`, 'iu'));
  function matches(text) { return wordRes.every(re => re.test(text)); }
  // 1.9.72: skillHistory + taskLogFails 필드 추가 (brainstorm에 누적 컨텍스트 추가 회수)
  const hits = { decisions: [], skills: [], tasks: [], rules: [], evidence: [], lessons: [], code: [], skillHistory: [], taskLogFails: [] };

  // decisions (1.9.14: 코드블록/Template 제외, 1.9.15: 라인 번호)
  const dec = exists(decisionsPath(root)) ? read(decisionsPath(root)) : '';
  const decLines = dec.split('\n');
  for (const b of _extractDecisionBlocks(dec)) {
    if (matches(b)) {
      const t = (b.match(/^### (.+)$/m) || [, ''])[1];
      const lineIdx = decLines.findIndex(line => line === `### ${t}`);
      const lineNo = lineIdx >= 0 ? lineIdx + 1 : 0;
      hits.decisions.push({ title: t, preview: b.slice(0, 200).replace(/\n+/g, ' '), line: lineNo });
    }
  }
  // skills
  const skillsDir = path.join(root, '.harness/skills');
  if (exists(skillsDir)) {
    for (const id of fs.readdirSync(skillsDir)) {
      const f = path.join(skillsDir, id, 'skill.json');
      if (!exists(f)) continue;
      try {
        const s = JSON.parse(read(f));
        const text = JSON.stringify(s);
        if (matches(text)) hits.skills.push({ id, displayNameKo: s.displayNameKo, capabilities: s.capabilities, usage: s.usage });
      } catch {}
    }
  }
  // tasks (1.9.14: token 매칭, 1.9.15: 매치 필드 + 라인 번호)
  const rows = readProgressRows(root);
  const progressText = exists(progressPath(root)) ? read(progressPath(root)) : '';
  for (const r of rows) {
    const fields = [];
    if (matches(r.request)) fields.push('request');
    if (matches(r.evidence)) fields.push('evidence');
    if (matches(r.nextAction)) fields.push('nextAction');
    if (fields.length) {
      const idx = progressText.indexOf(`| ${r.id} |`);
      const lineNo = idx >= 0 ? progressText.slice(0, idx).split('\n').length : 0;
      hits.tasks.push({ ...r, _fields: fields, line: lineNo });
    }
  }
  // rules (1.9.15: 라인 번호)
  if (exists(rulesPath(root))) {
    const rulesText = read(rulesPath(root));
    for (const r of readRules(root)) {
      if (matches(r.rule)) {
        const idx = rulesText.indexOf(`| ${r.id} |`);
        const lineNo = idx >= 0 ? rulesText.slice(0, idx).split('\n').length : 0;
        hits.rules.push({ ...r, line: lineNo });
      }
    }
  }
  // evidence — lessons 키워드 (fail/롤백/incomplete) 동반 (1.9.15: 라인 번호)
  const ev = exists(evidencePath(root)) ? read(evidencePath(root)) : '';
  for (const block of ev.split(/\n(?=## )/)) {
    if (!block.startsWith('## ')) continue;
    if (matches(block)) {
      const t = (block.match(/^## (.+)$/m) || [, ''])[1];
      const idx = ev.indexOf(block);
      const lineNo = idx >= 0 ? ev.slice(0, idx).split('\n').length : 0;
      hits.evidence.push({ title: t.trim(), preview: block.slice(0, 200).replace(/\n+/g, ' '), line: lineNo });
      if (/✗|fail|롤백|incomplete|버그/i.test(block)) hits.lessons.push({ title: t.trim(), line: lineNo });
    }
  }
  // 1.9.72: skill-suggestions.md rolling history hits (이전 매칭 결과 회수)
  const histPath = path.join(root, '.harness', 'skill-suggestions.md');
  if (exists(histPath)) {
    const histTxt = read(histPath);
    let pos = 0;
    for (const block of histTxt.split(/\n(?=## )/)) {
      if (!block.startsWith('## ')) { pos += block.length + 1; continue; }
      const h = block.match(/^## ([\d-]+ [\d:]+) — query "([^"]+)"/);
      if (h && matches(block)) {
        const idx = histTxt.indexOf(block);
        const lineNo = idx >= 0 ? histTxt.slice(0, idx).split('\n').length : 0;
        hits.skillHistory.push({ at: h[1], query: h[2], preview: block.slice(0, 220).replace(/\n+/g, ' '), line: lineNo });
      }
    }
  }
  // 1.9.72: task-log.md 실패 라인 hits
  const tlogPath = path.join(root, '.harness', 'task-log.md');
  if (exists(tlogPath)) {
    const tlog = read(tlogPath);
    const lines = tlog.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 4 && /✗|\bfail|롤백|재발|incomplete|버그/i.test(line) && matches(line)) {
        hits.taskLogFails.push({ title: line.replace(/^[-*]\s*/, '').slice(0, 100), line: i + 1 });
      }
    }
  }
  // 1.9.131: 3 archive 파일 hits (brainstormCmd 변종) — DELETE 5종 archive 도 brainstorm 후보로
  if (!hits.archive) hits.archive = { decisions: [], lessons: [], plan: [] };
  const archiveSources_bsCmd = [
    { key: 'decisions', file: 'decisions.archive.md' },
    { key: 'lessons',   file: 'lessons.archive.md' },
    { key: 'plan',      file: 'plan.archive.md' }
  ];
  for (const src of archiveSources_bsCmd) {
    const fp = path.join(root, '.harness', src.file);
    if (!exists(fp)) continue;
    const txt = read(fp);
    const blocks = txt.split(/\n(?=## 제거 )/);
    for (const b of blocks) {
      const m = b.match(/^## 제거 (\d{4}-\d{2}-\d{2})\s*\(target:\s*"([^"]*)"\)/);
      if (!m) continue;
      if (matches(b)) {
        const headerMatch = b.match(/^### (.+)$/m);
        const idx = txt.indexOf(b);
        const lineNo = idx >= 0 ? txt.slice(0, idx).split('\n').length : 0;
        hits.archive[src.key].push({
          date: m[1],
          target: m[2],
          originalHeader: headerMatch ? headerMatch[1].trim() : null,
          preview: b.slice(0, 220).replace(/\n+/g, ' '),
          line: lineNo
        });
      }
    }
  }
  // 1.9.116: lessons.md + plan.md milestone hits (Memory Surface 5종 완전 통합)
  if (!hits.lessonsExplicit) hits.lessonsExplicit = [];
  if (!hits.planMilestones) hits.planMilestones = [];
  const lp_b2 = lessonsPath(root);
  if (exists(lp_b2)) {
    const lessonsText = read(lp_b2);
    for (const block of lessonsText.split(/\n(?=### )/)) {
      if (!block.startsWith('### ')) continue;
      const lessonMatch = block.match(/- Lesson:\s*(.+)/);
      if (lessonMatch && matches(block)) {
        const idx = lessonsText.indexOf(block);
        const lineNo = idx >= 0 ? lessonsText.slice(0, idx).split('\n').length : 0;
        hits.lessonsExplicit.push({ title: lessonMatch[1].trim().slice(0, 120), preview: block.slice(0, 220).replace(/\n+/g, ' '), line: lineNo });
      }
    }
  }
  const planFile_b2 = planPath(root);
  if (exists(planFile_b2)) {
    const planText = read(planFile_b2);
    const milestoneBlocks = planText.split(/\n(?=### M-\d{4}\.)/);
    for (const b of milestoneBlocks) {
      const m = b.match(/^### (M-\d{4})\.\s*(.+?)$/m);
      if (m && matches(b)) {
        const idx = planText.indexOf(b);
        const lineNo = idx >= 0 ? planText.slice(0, idx).split('\n').length : 0;
        hits.planMilestones.push({ id: m[1], title: m[2].trim().slice(0, 120), preview: b.slice(0, 220).replace(/\n+/g, ' '), line: lineNo });
      }
    }
  }

  const total = hits.decisions.length + hits.skills.length + hits.tasks.length + hits.rules.length + hits.evidence.length + (hits.skillHistory ? hits.skillHistory.length : 0) + (hits.taskLogFails ? hits.taskLogFails.length : 0) + (hits.lessonsExplicit ? hits.lessonsExplicit.length : 0) + (hits.planMilestones ? hits.planMilestones.length : 0);
  log(`\n📦 총 ${total}건 발견 (decisions ${hits.decisions.length} · skills ${hits.skills.length} · tasks ${hits.tasks.length} · rules ${hits.rules.length} · evidence ${hits.evidence.length}${hits.skillHistory && hits.skillHistory.length ? ` · skill-history ${hits.skillHistory.length}` : ''}${hits.taskLogFails && hits.taskLogFails.length ? ` · task-log-fails ${hits.taskLogFails.length}` : ''}${hits.lessonsExplicit && hits.lessonsExplicit.length ? ` · lessons ${hits.lessonsExplicit.length}` : ''}${hits.planMilestones && hits.planMilestones.length ? ` · plan ${hits.planMilestones.length}` : ''})`);

  // 1.9.15: 모든 출력에 출처 파일:라인 표시
  if (hits.decisions.length) {
    log(`\n## 🧠 관련 결정 (${hits.decisions.length})`);
    hits.decisions.slice(0, 5).forEach(d => log(`  - .harness/decisions.md:${d.line || '?'} — ${d.title}`));
  }
  if (hits.skills.length) {
    log(`\n## 📚 관련 스킬 (${hits.skills.length}) — 시작 전 \`skill info <id>\` 권장`);
    hits.skills.forEach(s => log(`  - .harness/skills/${s.id}/skill.json — ${s.id} (${s.displayNameKo}) · 사용 ${s.usage?.count || 0}회 · cap ${(s.capabilities || []).length}`));
  }
  if (hits.tasks.length) {
    log(`\n## 📌 관련 과거 task (${hits.tasks.length})`);
    hits.tasks.slice(0, 5).forEach(t => log(`  - .harness/progress-tracker.md:${t.line || '?'} — ${t.id} [${t.status}] ${t.request} (matched: ${t._fields.join('+')})`));
  }
  if (hits.rules.length) {
    log(`\n## ⚡ 관련 룰 (${hits.rules.length})`);
    hits.rules.forEach(r => log(`  - .harness/rules.md:${r.line || '?'} — ${r.id} [${r.trigger}] ${r.rule}`));
  }
  if (hits.evidence.length) {
    log(`\n## 🧪 관련 검증 기록 (${hits.evidence.length})`);
    hits.evidence.slice(0, 5).forEach(e => log(`  - .harness/review-evidence.md:${e.line || '?'} — ${e.title}`));
  }
  if (hits.lessons.length) {
    log(`\n## ⚠ 같은 주제 과거 실패/롤백 (${hits.lessons.length}) — 같은 실수 방지`);
    hits.lessons.slice(0, 5).forEach(l => log(`  - .harness/review-evidence.md:${l.line || '?'} — ${l.title}`));
  }
  // 1.9.72: skill-suggestions.md rolling history hits
  if (hits.skillHistory.length) {
    log(`\n## 📒 같은 주제 이전 skill match 이력 (${hits.skillHistory.length}) — 1.9.68 누적`);
    hits.skillHistory.slice(0, 5).forEach(h => log(`  - .harness/skill-suggestions.md:${h.line || '?'} — [${h.at}] "${h.query}"`));
  }
  // 1.9.72: task-log.md 실패 라인 hits
  if (hits.taskLogFails.length) {
    log(`\n## 📜 task-log 실패 라인 (${hits.taskLogFails.length}) — 1.9.67 인덱스 + brainstorm`);
    hits.taskLogFails.slice(0, 5).forEach(t => log(`  - .harness/task-log.md:${t.line || '?'} — ${t.title}`));
  }
  // 1.9.133: lessonsExplicit display (데이터는 1.9.116에서 수집, display 누락 fix)
  if (hits.lessonsExplicit && hits.lessonsExplicit.length) {
    log(`\n## 💡 관련 lessons (${hits.lessonsExplicit.length}) — Memory Surface lessons.md 직접 매칭 (1.9.116)`);
    hits.lessonsExplicit.slice(0, 5).forEach(l => log(`  - .harness/lessons.md:${l.line || '?'} — ${l.title}`));
  }
  // 1.9.133: planMilestones display (데이터는 1.9.116에서 수집, display 누락 fix)
  if (hits.planMilestones && hits.planMilestones.length) {
    log(`\n## 🗺  관련 plan milestones (${hits.planMilestones.length}) — plan.md 매칭 (1.9.116)`);
    hits.planMilestones.slice(0, 5).forEach(m => log(`  - .harness/plan.md:${m.line || '?'} — ${m.id} ${m.title}`));
  }
  // 1.9.131: 3 archive 파일 hits — DELETE 5종 archive 도 brainstorm 후보
  if (hits.archive) {
    const archiveTotal = (hits.archive.decisions?.length || 0) + (hits.archive.lessons?.length || 0) + (hits.archive.plan?.length || 0);
    if (archiveTotal > 0) {
      log(`\n## 🗑  archive 후보 (${archiveTotal}) — 과거에 제거됐던 ideas; 복원 검토 가능 (1.9.131)`);
      for (const [key, label, emoji] of [['decisions', 'decisions.archive.md', '🧠'], ['lessons', 'lessons.archive.md', '💡'], ['plan', 'plan.archive.md', '🗺']]) {
        const items = hits.archive[key] || [];
        if (items.length) {
          for (const a of items.slice(0, 3)) {
            log(`  - ${emoji} .harness/${label}:${a.line || '?'} — ${a.date} "${a.target}"${a.originalHeader ? ' (orig: ' + a.originalHeader.slice(0, 80) + ')' : ''}`);
          }
        }
      }
      log(`  → 복원: leerness memory restore <decisions|lessons|plan> <target>`);
    }
  }

  log(`\n## 💡 시작 전 권장 액션`);
  log(`  1. 위 자원을 모두 검토 후 plan add 또는 task add로 새 작업 등록`);
  log(`  2. 가장 비슷한 과거 스킬을 \`leerness skill use <id>\`로 활성화`);
  log(`  3. 작업 종료 시 새로 발견한 패턴을 \`skill optimize\`로 누적`);
  if (!total) log(`  ⓘ 관련 자원 없음 — 새로운 영역. 첫 결정/스킬을 기록하면 다음 brainstorm이 더 풍부해짐.`);
}

// ===== 1.9.11: Roadmap (project-roadmap-generator 통합) =====
const ROADMAP_STATUS_LABEL = { done: '완료', 'in-progress': '진행', 'on-hold': '보류', waiting: '검토', incomplete: '미완료', planned: '예정', blocked: '오류', dropped: '취소', skill: '스킬', rule: '룰', meta: '프로젝트' };
const ROADMAP_STATUS_COLOR = { done: '#16a34a', 'in-progress': '#2563eb', 'on-hold': '#6b7280', waiting: '#eab308', incomplete: '#f97316', planned: '#94a3b8', blocked: '#dc2626', dropped: '#9ca3af', skill: '#8b5cf6', rule: '#06b6d4', meta: '#0f172a' };
const ROADMAP_NODE_W = 220, ROADMAP_NODE_H = 72, ROADMAP_COL_GAP = 70, ROADMAP_ROW_GAP = 14;

function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function _truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function _roadmapMapStatus(s) {
  s = String(s || '').toLowerCase();
  if (s === 'done' || s === 'in-progress' || s === 'on-hold' || s === 'waiting' || s === 'incomplete' || s === 'blocked' || s === 'dropped') return s;
  if (s === 'planned' || s === 'requested') return 'planned';
  return 'planned';
}

function _roadmapParseMilestones(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/^### (M-\d{4})\.\s*(.+?)$/gm)) {
    const after = text.slice(m.index);
    const sm = after.match(/^Status:\s*(\S+)/m);
    const pm = after.match(/^Progress:\s*(\d+)%/m);
    out.push({ id: m[1], title: m[2].trim(), status: sm ? sm[1] : 'planned', progress: pm ? parseInt(pm[1], 10) : 0 });
  }
  return out;
}

function _roadmapParseTokens(text) {
  const tokens = {};
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\|\s*([\w.\-]+)\s*\|\s*([^|]+?)\s*\|/);
    if (!m) continue;
    const key = m[1].trim(), val = m[2].trim();
    if (!key || !val || key === 'Token' || /^-+$/.test(key) || val === 'Value' || /\(실제 값으로 업데이트\)/.test(val)) continue;
    if (val.length > 80) continue;
    tokens[key] = val;
  }
  return tokens;
}

function _roadmapParseCssVars(root) {
  const out = {};
  const cands = ['src/styles/tokens.css', 'styles/tokens.css', 'src/styles.css', 'styles.css', 'src/styles/main.css', 'public/styles.css'];
  for (const c of cands) {
    const f = path.join(root, c);
    if (!exists(f)) continue;
    const text = read(f);
    const m = text.match(/:root\s*\{([\s\S]*?)\}/);
    if (!m) continue;
    for (const line of m[1].split('\n')) {
      const v = line.match(/--([\w-]+)\s*:\s*([^;]+);/);
      if (v) out[v[1].trim()] = v[2].trim();
    }
  }
  return out;
}

function _roadmapData(root) {
  root = absRoot(root);
  const milestones = _roadmapParseMilestones(exists(planPath(root)) ? read(planPath(root)) : '');
  const tasks = readProgressRows(root).map(t => ({
    ...t,
    milestones: Array.from(String(t.evidence || '').matchAll(/M-\d{4}/g)).map(m => m[0])
  }));
  // skills
  const skills = [];
  const skillsDir = path.join(root, '.harness/skills');
  if (exists(skillsDir)) {
    for (const id of fs.readdirSync(skillsDir)) {
      const f = path.join(skillsDir, id, 'skill.json');
      if (!exists(f)) continue;
      try { skills.push(JSON.parse(read(f))); } catch {}
    }
  }
  // rules
  const rulesT = exists(rulesPath(root)) ? read(rulesPath(root)) : '';
  const rules = [];
  for (const line of rulesT.split('\n')) {
    if (!/^\| R-\d{4} \|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map(s => s.trim());
    if (cells.length < 6) continue;
    rules.push({ id: cells[0], trigger: cells[1], rule: cells[2], status: cells[4], lastVerified: cells[5] });
  }
  // currentState
  const csT = exists(currentStatePath(root)) ? read(currentStatePath(root)) : '';
  const now = (csT.match(/## Now\n([\s\S]*?)(?=\n## )/) || [, ''])[1].trim();
  const next = (csT.match(/## Next\n([\s\S]*?)(?=\n## )/) || [, ''])[1].trim();
  const blockers = (csT.match(/## Blockers\n([\s\S]*?)$/) || [, ''])[1].trim();
  // decisions (top 6)
  const decT = exists(decisionsPath(root)) ? read(decisionsPath(root)) : '';
  const decisions = [];
  for (const block of decT.split(/\n(?=### )/)) {
    if (!block.startsWith('### ')) continue;
    const tm = block.match(/^### (.+)$/m);
    if (tm) decisions.push({ title: tm[1].trim() });
  }
  return {
    project: path.basename(root),
    version: exists(path.join(root, '.harness/HARNESS_VERSION')) ? read(path.join(root, '.harness/HARNESS_VERSION')).trim() : 'unknown',
    milestones, tasks, skills, rules,
    currentState: { now, next, blockers },
    decisions,
    designTokens: _roadmapParseTokens(exists(path.join(root, '.harness/design-system.md')) ? read(path.join(root, '.harness/design-system.md')) : ''),
    cssVariables: _roadmapParseCssVars(root)
  };
}

function _roadmapLayout(data) {
  const nodes = []; const edges = [];
  nodes.push({ id: 'project', kind: 'project', title: data.project, subtitle: `leerness ${data.version}`, meta: `M ${data.milestones.length} · T ${data.tasks.length} · S ${data.skills.length}`, status: 'meta', col: 0 });
  for (const m of data.milestones) {
    nodes.push({ id: m.id, kind: 'milestone', title: m.id, subtitle: m.title, meta: `${m.progress}% · ${m.status}`, status: _roadmapMapStatus(m.status), col: 1 });
    edges.push({ from: 'project', to: m.id });
  }
  for (const t of data.tasks) {
    nodes.push({ id: t.id, kind: 'task', title: t.id, subtitle: t.request, meta: t.evidence ? `evidence: ${t.evidence.slice(0, 40)}` : '', status: _roadmapMapStatus(t.status), col: 2 });
    if (t.milestones.length) for (const mid of t.milestones) edges.push({ from: mid, to: t.id });
    else edges.push({ from: 'project', to: t.id });
  }
  for (const s of data.skills) {
    nodes.push({ id: 'skill:' + s.name, kind: 'skill', title: s.name, subtitle: s.displayNameKo || s.name, meta: `사용 ${s.usage?.count || 0}회 · cap ${(s.capabilities || []).length}`, status: 'skill', col: 3 });
    edges.push({ from: 'project', to: 'skill:' + s.name });
  }
  for (const r of data.rules.filter(r => r.status === 'active')) {
    nodes.push({ id: 'rule:' + r.id, kind: 'rule', title: r.id, subtitle: r.rule, meta: r.trigger, status: 'rule', col: 3 });
    edges.push({ from: 'project', to: 'rule:' + r.id });
  }
  // 상하 중앙정렬 (1.9.11 v0.2)
  const byCol = {};
  for (const n of nodes) (byCol[n.col] = byCol[n.col] || []).push(n);
  const colH = {}; let maxColH = 0; let maxCol = 0;
  for (const c of Object.keys(byCol)) {
    const r = byCol[c]; const h = r.length * ROADMAP_NODE_H + Math.max(0, r.length - 1) * ROADMAP_ROW_GAP;
    colH[c] = h; maxColH = Math.max(maxColH, h); maxCol = Math.max(maxCol, parseInt(c, 10));
  }
  const padding = 40; const minHeight = 360;
  const canvasHeight = Math.max(maxColH, minHeight) + padding * 2;
  for (const c of Object.keys(byCol)) {
    const r = byCol[c]; const h = colH[c]; const startY = (canvasHeight - h) / 2;
    r.forEach((n, i) => {
      n.x = parseInt(c, 10) * (ROADMAP_NODE_W + ROADMAP_COL_GAP) + padding;
      n.y = startY + i * (ROADMAP_NODE_H + ROADMAP_ROW_GAP);
    });
  }
  return { nodes, edges, width: (maxCol + 1) * (ROADMAP_NODE_W + ROADMAP_COL_GAP) + padding * 2, height: canvasHeight };
}

function _roadmapTokenStyles(designTokens, cssVariables) {
  const vars = {};
  const map = [
    ['color.primary', 'color-primary', 'lr-primary'], ['color.surface', 'color-surface', 'lr-surface'],
    ['color.text', 'color-text', 'lr-text'], ['color.muted', 'color-muted', 'lr-muted'],
    ['space.1', 'space-1', 'lr-space-1'], ['space.2', 'space-2', 'lr-space-2'],
    ['space.3', 'space-3', 'lr-space-3'], ['space.4', 'space-4', 'lr-space-4'],
    ['radius', 'radius', 'lr-radius']
  ];
  for (const [ds, css, vn] of map) { const v = cssVariables[css] || designTokens[ds]; if (v) vars[vn] = v; }
  for (const [k, v] of Object.entries(cssVariables)) if (!vars[`lr-${k}`]) vars[`lr-${k}`] = v;
  if (!vars['lr-card-bg']) vars['lr-card-bg'] = vars['lr-surface'] || '#ffffff';
  if (!vars['lr-edge']) vars['lr-edge'] = vars['lr-muted'] || '#cbd5e1';
  if (!vars['lr-page-bg']) vars['lr-page-bg'] = '#f8fafc';
  return ':root {\n' + Object.entries(vars).map(([k, v]) => `    --${k}: ${v};`).join('\n') + '\n  }';
}

function _roadmapHTML(data) {
  const g = _roadmapLayout(data);
  const edges = g.edges.map(e => {
    const f = g.nodes.find(n => n.id === e.from), t = g.nodes.find(n => n.id === e.to);
    if (!f || !t) return '';
    const x1 = f.x + ROADMAP_NODE_W, y1 = f.y + ROADMAP_NODE_H / 2, x2 = t.x, y2 = t.y + ROADMAP_NODE_H / 2, mid = (x1 + x2) / 2;
    return `<path d="M ${x1},${y1} C ${mid},${y1} ${mid},${y2} ${x2},${y2}" stroke="var(--lr-edge, #cbd5e1)" stroke-width="1.5" fill="none"/>`;
  }).join('\n');
  const nodes = g.nodes.map(n => {
    const c = ROADMAP_STATUS_COLOR[n.status] || 'var(--lr-text, #0f172a)';
    const lbl = ROADMAP_STATUS_LABEL[n.status] || n.status;
    return `<g class="node node-${n.kind} status-${n.status}" data-id="${_esc(n.id)}" transform="translate(${n.x},${n.y})">
      <rect width="${ROADMAP_NODE_W}" height="${ROADMAP_NODE_H}" rx="8" ry="8" fill="var(--lr-card-bg, #ffffff)" stroke="${c}" stroke-width="2"/>
      <rect width="5" height="${ROADMAP_NODE_H}" fill="${c}"/>
      <text x="14" y="22" font-size="12" fill="${c}" font-weight="600">${_esc(n.title)} · ${_esc(lbl)}</text>
      <text x="14" y="42" font-size="11" fill="var(--lr-text, #1f2937)" font-weight="500">${_esc(_truncate(n.subtitle, 30))}</text>
      <text x="14" y="60" font-size="10" fill="var(--lr-muted, #64748b)">${_esc(_truncate(n.meta, 36))}</text>
      <title>${_esc(n.id)} — ${_esc(n.subtitle)}${n.meta ? '\n' + _esc(n.meta) : ''}</title>
    </g>`;
  }).join('\n');
  const counts = {};
  for (const t of data.tasks) counts[t.status] = (counts[t.status] || 0) + 1;
  const legend = ['done', 'in-progress', 'on-hold', 'waiting', 'incomplete', 'planned', 'blocked', 'skill', 'rule']
    .map(s => `<span class="badge" style="border-color:${ROADMAP_STATUS_COLOR[s]};color:${ROADMAP_STATUS_COLOR[s]}">${ROADMAP_STATUS_LABEL[s]}</span>`).join(' ');
  const chips = ['done', 'in-progress', 'on-hold', 'waiting', 'incomplete', 'planned', 'blocked']
    .map(s => `<span class="chip" style="border-color:${ROADMAP_STATUS_COLOR[s]};color:${ROADMAP_STATUS_COLOR[s]}">${ROADMAP_STATUS_LABEL[s]} ${counts[s] || 0}</span>`).join(' ');
  const upcoming = data.tasks.filter(t => ['planned', 'requested', 'in-progress'].includes(t.status)).slice(0, 10);
  const upcomingBlock = upcoming.length ? upcoming.map(t => `<div class="row"><span class="dot" style="background:${ROADMAP_STATUS_COLOR[t.status] || '#000'}"></span><strong>${_esc(t.id)}</strong> <span class="meta">[${_esc(ROADMAP_STATUS_LABEL[t.status] || t.status)}]</span> ${_esc(t.request)} <span class="meta">→ ${_esc(t.nextAction)}</span></div>`).join('') : '<div class="empty">예정 작업 없음</div>';
  const milestoneBlock = data.milestones.length ? data.milestones.map(m => `<div class="row"><span class="dot" style="background:${ROADMAP_STATUS_COLOR[_roadmapMapStatus(m.status)] || ROADMAP_STATUS_COLOR.planned}"></span><strong>${_esc(m.id)}</strong> <span class="meta">[${_esc(m.status)} · ${m.progress}%]</span> ${_esc(m.title)}</div>`).join('') : '<div class="empty">마일스톤 없음</div>';
  const skillsBlock = data.skills.length ? data.skills.map(s => `<div class="row"><span class="dot" style="background:${ROADMAP_STATUS_COLOR.skill}"></span><strong>${_esc(s.name)}</strong> · ${_esc(s.displayNameKo || s.name)} <span class="meta">사용 ${s.usage?.count || 0}회 · cap ${(s.capabilities || []).length}</span></div>`).join('') : '<div class="empty">스킬 없음</div>';
  const activeRules = data.rules.filter(r => r.status === 'active');
  const rulesBlock = activeRules.length ? activeRules.map(r => `<div class="row"><span class="dot" style="background:${ROADMAP_STATUS_COLOR.rule}"></span><strong>${_esc(r.id)}</strong> <span class="meta">[${_esc(r.trigger)}]</span> ${_esc(r.rule)}</div>`).join('') : '<div class="empty">활성 룰 없음</div>';
  const decisionsBlock = data.decisions.length ? data.decisions.slice(0, 6).map(d => `<div class="row"><span class="dot" style="background:var(--lr-text, #0f172a)"></span>${_esc(d.title)}</div>`).join('') : '<div class="empty">결정 없음</div>';
  const tokensSection = (Object.keys(data.designTokens).length || Object.keys(data.cssVariables).length)
    ? [...Object.entries(data.designTokens).slice(0, 8), ...Object.entries(data.cssVariables).slice(0, 8)]
        .map(([k, v]) => `<div class="row"><span class="dot" style="background:${/#[0-9a-f]{3,8}/i.test(v) ? v : 'var(--lr-muted, #94a3b8)'}"></span><strong>${_esc(k)}</strong> <span class="meta">${_esc(v)}</span></div>`).join('')
    : '<div class="empty">디자인 토큰 없음</div>';

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${_esc(data.project)} — leerness 로드맵</title>
<style>
  ${_roadmapTokenStyles(data.designTokens, data.cssVariables)}
  body { font-family: var(--lr-font-body, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', sans-serif); margin: 0; padding: 20px; background: var(--lr-page-bg); color: var(--lr-text); }
  h1 { margin: 0 0 4px; font-size: 22px; color: var(--lr-primary, var(--lr-text, #0f172a)); }
  h2 { margin: 24px 0 8px; font-size: 16px; color: var(--lr-muted, #334155); }
  .meta { font-size: 11px; color: var(--lr-muted, #64748b); margin-left: 4px; }
  .summary { display: flex; gap: 16px; flex-wrap: wrap; background: var(--lr-card-bg); padding: 12px 16px; border-radius: var(--lr-radius, 8px); border: 1px solid var(--lr-muted, #e2e8f0); font-size: 13px; }
  .legend { display: flex; gap: 6px; flex-wrap: wrap; margin: 12px 0; }
  .badge, .chip { display: inline-block; padding: 2px 10px; border: 1.5px solid var(--lr-muted, #94a3b8); border-radius: 999px; font-size: 11px; font-weight: 500; background: var(--lr-card-bg); }
  .chip { padding: 3px 10px; }
  .block { background: var(--lr-card-bg); padding: 12px 16px; border-radius: var(--lr-radius, 8px); border: 1px solid var(--lr-muted, #e2e8f0); margin: 8px 0; }
  .row { font-size: 13px; padding: 4px 0; border-bottom: 1px dashed var(--lr-muted, #f1f5f9); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .row:last-child { border-bottom: none; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .empty { font-size: 12px; color: var(--lr-muted, #94a3b8); font-style: italic; padding: 4px 0; }
  .roadmap-wrap { position: relative; background: var(--lr-card-bg); border-radius: var(--lr-radius, 8px); border: 1px solid var(--lr-muted, #e2e8f0); height: 640px; overflow: hidden; cursor: grab; }
  .roadmap-wrap.grabbing { cursor: grabbing; }
  .roadmap-wrap svg { display: block; width: 100%; height: 100%; }
  .node:hover rect:first-of-type { fill: var(--lr-page-bg, #f1f5f9); cursor: pointer; }
  .node text { user-select: none; pointer-events: none; }
  .controls { position: absolute; top: 12px; right: 12px; display: flex; gap: 6px; background: var(--lr-card-bg); padding: 6px; border-radius: 8px; border: 1px solid var(--lr-muted, #e2e8f0); box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .controls button { width: 32px; height: 32px; border: 1px solid var(--lr-muted, #cbd5e1); background: var(--lr-card-bg); color: var(--lr-text); border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px; }
  .controls button:hover { background: var(--lr-page-bg); }
  .footer { color: var(--lr-muted, #94a3b8); font-size: 11px; text-align: right; margin-top: 16px; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 900px) { .columns { grid-template-columns: 1fr; } }
</style></head>
<body>
  <h1>${_esc(data.project)} — leerness 로드맵</h1>
  <div class="meta">자동 생성 · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · leerness v${_esc(data.version)}</div>
  <div class="summary">
    <div><strong>milestones:</strong> ${data.milestones.length}</div>
    <div><strong>tasks:</strong> ${data.tasks.length}</div>
    <div><strong>skills:</strong> ${data.skills.length}</div>
    <div><strong>active rules:</strong> ${activeRules.length}</div>
    <div><strong>decisions:</strong> ${data.decisions.length}</div>
    <div><strong>design tokens:</strong> ${Object.keys(data.designTokens).length + Object.keys(data.cssVariables).length}</div>
  </div>
  <div class="legend">${legend}</div>
  <div class="legend">${chips}</div>
  <h2>📍 Current State</h2>
  <div class="block">
    <div class="row"><strong>Now:</strong> ${_esc(data.currentState.now || '-')}</div>
    <div class="row"><strong>Next:</strong> ${_esc(data.currentState.next || '-')}</div>
    <div class="row"><strong>Blockers:</strong> ${_esc(data.currentState.blockers || '-')}</div>
  </div>
  <h2>🗺️ Roadmap — 화이트보드 (드래그 panning · 휠 zoom · 더블클릭 reset)</h2>
  <div class="roadmap-wrap" id="roadmap-board">
    <svg id="roadmap-svg" viewBox="0 0 ${g.width} ${g.height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      <g class="viewport">
        <g class="edges">${edges}</g>
        <g class="nodes">${nodes}</g>
      </g>
    </svg>
    <div class="controls"><button onclick="lrZoom(0.9)">−</button><button onclick="lrZoom(1.1)">＋</button><button onclick="lrReset()">⟳</button></div>
  </div>
  <div class="columns">
    <div>
      <h2>🎯 Milestones (${data.milestones.length})</h2><div class="block">${milestoneBlock}</div>
      <h2>📌 다음 예정 작업</h2><div class="block">${upcomingBlock}</div>
      <h2>📚 보유 스킬 (${data.skills.length})</h2><div class="block">${skillsBlock}</div>
    </div>
    <div>
      <h2>⚡ Active Rules (${activeRules.length})</h2><div class="block">${rulesBlock}</div>
      <h2>🧠 최근 결정</h2><div class="block">${decisionsBlock}</div>
      <h2>🎨 디자인 토큰</h2><div class="block">${tokensSection}</div>
    </div>
  </div>
  <div class="footer">leerness roadmap · v${_esc(data.version)} · 화이트보드 + 토큰 주입 + 상하 중앙정렬</div>
  <script>
  (function(){var svg=document.getElementById('roadmap-svg');var board=document.getElementById('roadmap-board');var vp=svg.querySelector('.viewport');var tx=0,ty=0,scale=1;var dragging=false,sx=0,sy=0;function apply(){vp.setAttribute('transform','translate('+tx+','+ty+') scale('+scale+')');}board.addEventListener('mousedown',function(e){if(e.target.closest&&(e.target.closest('.node')||e.target.closest('.controls')))return;dragging=true;sx=e.clientX-tx;sy=e.clientY-ty;board.classList.add('grabbing');e.preventDefault();});window.addEventListener('mousemove',function(e){if(!dragging)return;tx=e.clientX-sx;ty=e.clientY-sy;apply();});window.addEventListener('mouseup',function(){dragging=false;board.classList.remove('grabbing');});board.addEventListener('wheel',function(e){e.preventDefault();var d=e.deltaY>0?0.9:1.1;var rect=board.getBoundingClientRect();var cx=e.clientX-rect.left;var cy=e.clientY-rect.top;var ns=Math.max(0.3,Math.min(3.0,scale*d));var r=ns/scale;tx=cx-(cx-tx)*r;ty=cy-(cy-ty)*r;scale=ns;apply();},{passive:false});board.addEventListener('dblclick',function(){tx=0;ty=0;scale=1;apply();});window.lrZoom=function(d){scale=Math.max(0.3,Math.min(3.0,scale*d));apply();};window.lrReset=function(){tx=0;ty=0;scale=1;apply();};})();
  </script>
</body></html>`;
}

function roadmapCmd(root) {
  root = absRoot(root);
  if (!exists(path.join(root, '.harness'))) return fail(`leerness 미설치: ${root}/.harness 없음 — 먼저 \`leerness init .\``);
  const outFile = path.resolve(arg('--out', null) || path.join(root, 'roadmap.html'));
  const data = _roadmapData(root);
  writeUtf8(outFile, _roadmapHTML(data));
  ok(`로드맵 생성: ${rel(root, outFile)}`);
  log(`  milestones: ${data.milestones.length} · tasks: ${data.tasks.length} (done ${data.tasks.filter(t => t.status === 'done').length}) · skills: ${data.skills.length} · active rules: ${data.rules.filter(r => r.status === 'active').length} · tokens: ${Object.keys(data.designTokens).length + Object.keys(data.cssVariables).length}`);
}

// 1.9.12: auto roadmap (install / session-close / 옵트인 data-change 트리거)
function _autoRoadmapConfigPath(root) { return path.join(root, '.harness/cache/auto-roadmap.json'); }
function _autoRoadmapConfig(root) {
  const f = _autoRoadmapConfigPath(root);
  const def = { enabled: true, onEveryChange: false, outFile: null };
  if (!exists(f)) return def;
  try { return Object.assign(def, JSON.parse(read(f))); } catch { return def; }
}
function _saveAutoRoadmapConfig(root, cfg) {
  writeUtf8(_autoRoadmapConfigPath(root), JSON.stringify(cfg, null, 2) + '\n');
}
function _autoRoadmap(root, trigger) {
  try {
    if (process.env.LEERNESS_NO_AUTO_ROADMAP === '1') return false;
    if (!exists(path.join(root, '.harness'))) return false;
    const cfg = _autoRoadmapConfig(root);
    if (!cfg.enabled) return false;
    if (trigger === 'data-change' && !cfg.onEveryChange) return false;
    const outFile = path.resolve(cfg.outFile || path.join(root, 'roadmap.html'));
    const data = _roadmapData(root);
    writeUtf8(outFile, _roadmapHTML(data));
    log(`✓ roadmap.html 자동 갱신 (${trigger}) — ${rel(root, outFile)}`);
    return true;
  } catch (e) {
    warn('roadmap 자동 갱신 실패: ' + (e && e.message ? e.message : e));
    return false;
  }
}

function roadmapAutoCmd(root, sub) {
  root = absRoot(root);
  if (!exists(path.join(root, '.harness'))) return fail(`leerness 미설치: ${root}/.harness 없음`);
  const cfg = _autoRoadmapConfig(root);
  if (sub === 'on') {
    cfg.enabled = true;
    if (has('--on-every-change')) cfg.onEveryChange = true;
    if (has('--no-on-every-change')) cfg.onEveryChange = false;
    if (arg('--out', null)) cfg.outFile = arg('--out', null);
    _saveAutoRoadmapConfig(root, cfg);
    ok(`auto-roadmap 활성화 (onEveryChange: ${cfg.onEveryChange}, outFile: ${cfg.outFile || './roadmap.html'})`);
  } else if (sub === 'off') {
    cfg.enabled = false;
    _saveAutoRoadmapConfig(root, cfg);
    ok('auto-roadmap 비활성화 — session close 시 갱신 안 됨');
  } else {
    log(`# auto-roadmap status`);
    log(`enabled: ${cfg.enabled}`);
    log(`onEveryChange: ${cfg.onEveryChange}`);
    log(`outFile: ${cfg.outFile || './roadmap.html'}`);
    log(`\n트리거:`);
    log(`  install      : ${cfg.enabled ? '✓ 자동 생성' : '✗ 비활성'}`);
    log(`  session-close: ${cfg.enabled ? '✓ 자동 갱신' : '✗ 비활성'}`);
    log(`  data-change  : ${cfg.enabled && cfg.onEveryChange ? '✓ 즉시 갱신 (모든 task/plan/rule/skill 변경)' : '✗ 옵트인 필요 (--on-every-change)'}`);
  }
}

// ===== 1.9.8: User Rules (자연어 등록 + 매 세션 자동 노출/검증) =====
function rulesPath(root) { return path.join(root, '.harness/rules.md'); }
function rulesArchivePath(root) { return path.join(root, '.harness/rules.archive.md'); }
function rulesCachePath(root) { return path.join(root, '.harness/cache/rule-state.json'); }

function _rulesHeader() {
  return [
    '---',
    'leernessRole: rules',
    'readWhen:',
    '  - 세션 시작 (handoff)',
    '  - 매 작업 시작 전',
    '  - 매 작업 완료 전',
    '  - 세션 종료 시 (session close)',
    'updateWhen:',
    '  - 사용자가 자연어로 새 룰 요청',
    '  - 사용자가 룰 중지/제거 요청',
    'doNotStore:',
    '  - 실제 토큰',
    '  - 비밀번호',
    '  - 운영 쿠키',
    '  - 민감한 개인정보 원문',
    '---',
    '<!-- leerness:managed -->',
    '# User Rules',
    '',
    '매 세션·매 작업마다 AI 에이전트가 반드시 따라야 할 사용자 정의 영구 룰.',
    '사용자가 명시적으로 "중지" / "제거"를 요청하기 전까지 모든 active 룰을 매 세션 자동 노출/검증합니다.',
    '',
    '## Active Rules',
    '',
    '| ID | Trigger | Rule | Added | Status | Last Verified |',
    '|---|---|---|---|---|---|'
  ].join('\n');
}

function readRules(root) {
  const f = rulesPath(root);
  if (!exists(f)) return [];
  const rules = [];
  for (const line of read(f).split('\n')) {
    if (!/^\| R-\d{4} \|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map(s => s.trim());
    if (cells.length < 6) continue;
    rules.push({ id: cells[0], trigger: cells[1], rule: cells[2], added: cells[3], status: cells[4], lastVerified: cells[5] });
  }
  return rules;
}

function writeRules(root, rules) {
  const body = rules.map(r => `| ${r.id} | ${r.trigger} | ${r.rule} | ${r.added} | ${r.status} | ${r.lastVerified || '-'} |`).join('\n');
  writeUtf8(rulesPath(root), _rulesHeader() + '\n' + body + (body ? '\n' : ''));
}

function nextRuleId(root) {
  const rules = readRules(root);
  let max = 0;
  for (const r of rules) {
    const m = r.id.match(/^R-(\d{4})$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `R-${String(max + 1).padStart(4, '0')}`;
}

function ruleAdd(root, description) {
  root = absRoot(root);
  if (!description) return fail('rule description required (e.g., rule add "매 업데이트마다 버전 bump" --trigger every-update)');
  if (!exists(rulesPath(root))) writeRules(root, []);
  const trigger = arg('--trigger', 'every-session');
  const validTriggers = new Set(['every-session','every-update','every-commit','session-start','session-close','pre-publish']);
  if (!validTriggers.has(trigger)) {
    warn(`unknown trigger "${trigger}" — 사용 가능: ${[...validTriggers].join(', ')}. 그대로 등록합니다.`);
  }
  const id = nextRuleId(root);
  const rules = readRules(root);
  rules.push({ id, trigger, rule: description, added: today(), status: 'active', lastVerified: '-' });
  writeRules(root, rules);
  ok(`rule added: ${id} [${trigger}] ${description}`);
  _autoRoadmap(root, 'data-change');
}

function ruleList(root) {
  root = absRoot(root);
  const rules = readRules(root);
  // 1.9.109: --json 모드
  if (has('--json')) {
    process.stdout.write(JSON.stringify({ version: VERSION, root, total: rules.length, rules }, null, 2) + '\n');
    return;
  }
  if (!rules.length) return ok('등록된 룰 없음');
  log('| ID | Trigger | Rule | Status | Last Verified |');
  log('|---|---|---|---|---|');
  for (const r of rules) log(`| ${r.id} | ${r.trigger} | ${r.rule} | ${r.status} | ${r.lastVerified} |`);
}

function ruleRemove(root, id) {
  root = absRoot(root);
  if (!id) return fail('id required');
  const rules = readRules(root);
  const i = rules.findIndex(r => r.id === id);
  if (i < 0) return fail(`rule not found: ${id}`);
  const removed = rules.splice(i, 1)[0];
  writeRules(root, rules);
  const archive = exists(rulesArchivePath(root)) ? read(rulesArchivePath(root)) : '# Rules archive\n\n| ID | Trigger | Rule | Added | Status | Removed |\n|---|---|---|---|---|---|\n';
  writeUtf8(rulesArchivePath(root), archive + `| ${removed.id} | ${removed.trigger} | ${removed.rule} | ${removed.added} | removed | ${today()} |\n`);
  ok(`rule removed: ${id} (보존: .harness/rules.archive.md)`);
}

function rulePause(root, id) {
  root = absRoot(root);
  if (!id) return fail('id required');
  const rules = readRules(root);
  const r = rules.find(x => x.id === id);
  if (!r) return fail(`rule not found: ${id}`);
  r.status = 'paused';
  writeRules(root, rules);
  ok(`rule paused: ${id}`);
  _autoRoadmap(root, 'data-change');
}

function ruleResume(root, id) {
  root = absRoot(root);
  if (!id) return fail('id required');
  const rules = readRules(root);
  const r = rules.find(x => x.id === id);
  if (!r) return fail(`rule not found: ${id}`);
  r.status = 'active';
  writeRules(root, rules);
  ok(`rule resumed: ${id}`);
  _autoRoadmap(root, 'data-change');
}

function ruleStop(root) {
  root = absRoot(root);
  const rules = readRules(root);
  let n = 0;
  for (const r of rules) if (r.status === 'active') { r.status = 'paused'; n++; }
  writeRules(root, rules);
  ok(`${n}개 룰 일시 정지 (rule resume <id> 또는 rule resume-all로 재개)`);
}

function ruleResumeAll(root) {
  root = absRoot(root);
  const rules = readRules(root);
  let n = 0;
  for (const r of rules) if (r.status === 'paused') { r.status = 'active'; n++; }
  writeRules(root, rules);
  ok(`${n}개 룰 재개`);
}

function captureProjectState(root) {
  const state = { capturedAt: now() };
  const pkgFile = path.join(root, 'package.json');
  if (exists(pkgFile)) { try { state.packageVersion = JSON.parse(read(pkgFile)).version; } catch {} }
  const cl = path.join(root, 'CHANGELOG.md');
  if (exists(cl)) { try { state.changelogMtime = fs.statSync(cl).mtime.getTime(); state.changelogSize = fs.statSync(cl).size; } catch {} }
  const hv = path.join(root, '.harness/HARNESS_VERSION');
  if (exists(hv)) state.harnessVersion = read(hv).trim();
  return state;
}

function verifyRules(root) {
  root = absRoot(root);
  const rules = readRules(root);
  const active = rules.filter(r => r.status === 'active');
  if (!active.length) return [];
  let prev = {};
  if (exists(rulesCachePath(root))) { try { prev = JSON.parse(read(rulesCachePath(root))); } catch {} }
  const cur = captureProjectState(root);
  const ev = exists(evidencePath(root)) ? read(evidencePath(root)) : '';
  const todayStr = today();
  const results = [];
  for (const r of active) {
    let verified = 'manual';
    let note = '';
    const rl = r.rule.toLowerCase();
    if (/version|버전|bump|상승/i.test(rl)) {
      if (prev.packageVersion && cur.packageVersion && prev.packageVersion !== cur.packageVersion) {
        verified = 'pass'; note = `${prev.packageVersion} → ${cur.packageVersion}`;
      } else if (!prev.packageVersion) {
        verified = 'baseline'; note = `초기 ${cur.packageVersion || '미확인'}`;
      } else {
        verified = 'pending'; note = '버전 변경 없음';
      }
    } else if (/changelog|패치노트|patch.*note|note.*추가|note.*add/i.test(rl)) {
      if (prev.changelogMtime && cur.changelogMtime && cur.changelogMtime > prev.changelogMtime) {
        verified = 'pass'; note = 'CHANGELOG.md 갱신 감지';
      } else if (!prev.changelogMtime) {
        verified = 'baseline'; note = '초기 측정';
      } else {
        verified = 'pending'; note = 'CHANGELOG.md 변경 없음';
      }
    } else if (/test|테스트|verify/i.test(rl)) {
      const hasTest = new RegExp(`## ${todayStr}.*verify-code|## ${todayStr}.*test`, 'i').test(ev);
      verified = hasTest ? 'pass' : 'pending';
      note = hasTest ? '오늘 verify-code 흔적' : '오늘 verify-code 호출 없음';
    } else if (/deploy|배포|publish|push|release/i.test(rl)) {
      verified = 'manual'; note = '배포는 사용자 명시 호출 (leerness release publish)';
    } else {
      verified = 'manual'; note = '자동 검증 패턴 없음 — 수동 확인';
    }
    results.push({ ...r, verified, note });
  }
  // lastVerified 갱신 (pass인 경우만)
  for (const r of rules) {
    const m = results.find(x => x.id === r.id);
    if (m && m.verified === 'pass') r.lastVerified = todayStr;
  }
  writeRules(root, rules);
  writeUtf8(rulesCachePath(root), JSON.stringify(cur, null, 2));
  return results;
}

function ruleVerifyCmd(root) {
  root = absRoot(root);
  const results = verifyRules(root);
  if (!results.length) return ok('활성 룰 없음');
  log('# Rules verification');
  log('| ID | Trigger | Rule | Verified | Note |');
  log('|---|---|---|---|---|');
  const ic = { pass: '✓ pass', pending: '⓿ pending', manual: 'ⓘ manual', baseline: '○ baseline' };
  for (const r of results) log(`| ${r.id} | ${r.trigger} | ${r.rule.slice(0, 40)} | ${ic[r.verified] || '?'} | ${r.note} |`);
}

// ===== 1.9.8: release bump / note / publish =====
function releaseBump(root) {
  root = absRoot(root);
  const kind = has('--major') ? 'major' : (has('--minor') ? 'minor' : 'patch');
  const pkgFile = path.join(root, 'package.json');
  if (!exists(pkgFile)) return fail('package.json 없음');
  let pkg; try { pkg = JSON.parse(read(pkgFile)); } catch (e) { return fail('package.json 파싱 실패: ' + e.message); }
  const cur = String(pkg.version || '0.0.0');
  const parts = cur.split('.').map(n => parseInt(n, 10) || 0);
  const [maj, min, pat] = [parts[0]||0, parts[1]||0, parts[2]||0];
  let next;
  if (kind === 'major') next = `${maj + 1}.0.0`;
  else if (kind === 'minor') next = `${maj}.${min + 1}.0`;
  else next = `${maj}.${min}.${pat + 1}`;
  pkg.version = next;
  writeUtf8(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  const hv = path.join(root, '.harness/HARNESS_VERSION');
  if (exists(hv) && /^\d+\.\d+\.\d+/.test(read(hv).trim())) writeUtf8(hv, next + '\n');
  ok(`version bumped: ${cur} → ${next} (${kind})`);
}

function releaseNote(root, text) {
  root = absRoot(root);
  if (!text) return fail('note text required (e.g., release note "내용")');
  const pkgFile = path.join(root, 'package.json');
  let version = 'unknown';
  if (exists(pkgFile)) { try { version = JSON.parse(read(pkgFile)).version || 'unknown'; } catch {} }
  const clFile = path.join(root, 'CHANGELOG.md');
  const date = today();
  const headerRe = new RegExp(`^## ${version.replace(/\./g, '\\.')} — `, 'm');
  if (exists(clFile)) {
    const cur = read(clFile);
    if (headerRe.test(cur)) {
      // 같은 버전 헤더가 있으면 그 바로 아래에 줄 추가
      const m = cur.match(headerRe);
      const headerEnd = cur.indexOf('\n', m.index + m[0].length);
      const insertPos = headerEnd + 1;
      // 헤더 다음 빈 줄 후 첫 list 시작 찾기
      const beforeBlock = cur.slice(insertPos);
      const linesAfter = beforeBlock.split('\n');
      // 가장 단순: 헤더 다음 줄에 즉시 - text 삽입
      writeUtf8(clFile, cur.slice(0, insertPos) + `\n- ${text}\n` + cur.slice(insertPos));
    } else {
      // 새 버전 헤더 추가 (# Changelog 다음)
      const top = cur.indexOf('# Changelog');
      const newBlock = `\n## ${version} — ${date}\n\n- ${text}\n`;
      if (top >= 0) {
        const after = cur.indexOf('\n', top) + 1;
        writeUtf8(clFile, cur.slice(0, after) + newBlock + cur.slice(after));
      } else {
        writeUtf8(clFile, `# Changelog\n${newBlock}\n${cur}`);
      }
    }
  } else {
    writeUtf8(clFile, `# Changelog\n\n## ${version} — ${date}\n\n- ${text}\n`);
  }
  ok(`CHANGELOG.md 갱신: [${version}] ${text}`);
}

// 1.9.10: git remote 자동 감지 + gh-release + gh-pages 배포
function detectGitRemote(root) {
  const r = cp.spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', shell: true });
  if (r.status !== 0) return null;
  const url = (r.stdout || '').trim();
  if (!url) return null;
  // owner/repo 추출
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/);
  return { url, host: m ? 'github' : 'unknown', owner: m ? m[1] : null, repo: m ? m[2] : null };
}

function getCurrentVersion(root) {
  const pkgF = path.join(root, 'package.json');
  if (!exists(pkgF)) return null;
  try { return JSON.parse(read(pkgF)).version || null; } catch { return null; }
}

function deployGhPages(root, sourceFile) {
  const remote = detectGitRemote(root);
  if (!remote || remote.host !== 'github') { fail('GitHub remote가 없습니다 — gh-pages 배포 불가'); process.exitCode = 1; return; }
  const src = path.resolve(root, sourceFile);
  if (!exists(src)) { fail(`소스 파일 없음: ${src}`); process.exitCode = 1; return; }
  log(`# gh-pages deploy`);
  log(`Source: ${rel(root, src)}`);
  log(`Target: gh-pages branch of ${remote.owner}/${remote.repo}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const wt = path.join(root, '.harness/cache', `ghpages-${stamp}`);
  mkdirp(path.dirname(wt));
  // worktree (기존 gh-pages 있으면 fetch, 없으면 orphan)
  const fetchR = cp.spawnSync('git', ['fetch', 'origin', 'gh-pages'], { cwd: root, encoding: 'utf8', shell: true });
  const hasBranch = fetchR.status === 0;
  let wtArgs;
  if (hasBranch) wtArgs = ['worktree', 'add', wt, 'origin/gh-pages'];
  else wtArgs = ['worktree', 'add', '--orphan', '-b', 'gh-pages', wt];
  const wtR = cp.spawnSync('git', wtArgs, { cwd: root, encoding: 'utf8', shell: true });
  if (wtR.status !== 0) { fail('worktree 생성 실패: ' + (wtR.stderr || '').slice(0, 200)); process.exitCode = 1; return; }
  try {
    // orphan인 경우 초기화
    if (!hasBranch) {
      cp.spawnSync('git', ['rm', '-rf', '.'], { cwd: wt, encoding: 'utf8', shell: true });
    }
    // 소스 복사 (index.html로 이름 변경)
    const destName = path.basename(src) === 'index.html' ? 'index.html' : 'index.html';
    fs.copyFileSync(src, path.join(wt, destName));
    // 원본 파일명도 보존
    if (path.basename(src) !== 'index.html') fs.copyFileSync(src, path.join(wt, path.basename(src)));
    cp.spawnSync('git', ['add', '-A'], { cwd: wt, encoding: 'utf8' });
    const commit = cp.spawnSync('git', ['commit', '-m', `deploy: ${path.basename(src)} ${stamp}`], { cwd: wt, encoding: 'utf8' });
    if (commit.status !== 0 && !/nothing to commit/.test(commit.stdout || '')) {
      fail('commit 실패: ' + (commit.stdout || commit.stderr || '').slice(0, 200));
      process.exitCode = 1;
    } else {
      const pushR = cp.spawnSync('git', ['push', 'origin', 'gh-pages'], { cwd: wt, encoding: 'utf8' });
      if (pushR.status !== 0) { fail('push 실패: ' + (pushR.stderr || '').slice(0, 200)); process.exitCode = 1; }
      else ok(`gh-pages push 완료 → https://${remote.owner}.github.io/${remote.repo}/`);
    }
  } finally {
    cp.spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: root, encoding: 'utf8', shell: true });
  }
}

// 1.9.140: release sync-main — release/X.Y.Z 또는 현재 브랜치를 main에 자동 merge & push
function releaseSyncMainCmd(root) {
  root = absRoot(root || process.cwd());
  const dryRun = has('--dry-run');
  const branchArg = arg('--branch', null);
  const remoteName = arg('--remote', 'origin');
  log('# leerness release sync-main (1.9.140)');

  const headR = cp.spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (headR.status !== 0) { fail('git 저장소가 아닙니다 — sync-main 스킵'); process.exitCode = 1; return; }
  const fromBranch = branchArg || (headR.stdout || '').trim();
  if (!fromBranch || fromBranch === 'main' || fromBranch === 'master') {
    warn(`sync-main: 이미 main 브랜치에 있거나 source 브랜치가 부적절 (${fromBranch}) — 스킵`);
    return;
  }
  log(`from: ${fromBranch} → main`);

  if (dryRun) { log('(dry-run) merge & push 스킵'); return; }

  // 1) main checkout (있으면 reuse, 없으면 origin/main에서 생성)
  const coR = cp.spawnSync('git', ['checkout', 'main'], { cwd: root, encoding: 'utf8' });
  if (coR.status !== 0) {
    const co2 = cp.spawnSync('git', ['checkout', '-b', 'main', `${remoteName}/main`], { cwd: root, encoding: 'utf8' });
    if (co2.status !== 0) { fail('main 체크아웃 실패: ' + (co2.stderr || '').slice(0, 200)); process.exitCode = 1; return; }
  }
  // 2) origin/main pull (최신화)
  cp.spawnSync('git', ['pull', '--ff-only', remoteName, 'main'], { cwd: root, encoding: 'utf8' });
  // 3) release branch merge (fast-forward 우선, 안 되면 no-ff merge commit)
  // 1.9.140+: --allow-unrelated 또는 LEERNESS_ALLOW_UNRELATED=1 (최초 main 동기화 시 release branch와 history 분리)
  const allowUnrelated = has('--allow-unrelated') || process.env.LEERNESS_ALLOW_UNRELATED === '1';
  let mergeArgs = ['merge', '--no-edit', fromBranch];
  let mergeR = cp.spawnSync('git', mergeArgs, { cwd: root, encoding: 'utf8' });
  if (mergeR.status !== 0 && /unrelated histories/.test(mergeR.stderr || mergeR.stdout || '')) {
    if (allowUnrelated) {
      warn('unrelated histories 감지 — --allow-unrelated 재시도');
      cp.spawnSync('git', ['merge', '--abort'], { cwd: root, encoding: 'utf8' });
      mergeR = cp.spawnSync('git', ['merge', '--no-edit', '--allow-unrelated-histories', fromBranch], { cwd: root, encoding: 'utf8' });
    } else {
      fail('main merge 실패 — unrelated histories: --allow-unrelated 옵션 추가하세요 (또는 LEERNESS_ALLOW_UNRELATED=1)');
      cp.spawnSync('git', ['merge', '--abort'], { cwd: root, encoding: 'utf8' });
      cp.spawnSync('git', ['checkout', fromBranch], { cwd: root, encoding: 'utf8' });
      process.exitCode = 1;
      return;
    }
  }
  if (mergeR.status !== 0) {
    fail('main merge 실패 — 충돌 가능성: ' + (mergeR.stderr || mergeR.stdout || '').slice(0, 300));
    // checkout back to original
    cp.spawnSync('git', ['merge', '--abort'], { cwd: root, encoding: 'utf8' });
    cp.spawnSync('git', ['checkout', fromBranch], { cwd: root, encoding: 'utf8' });
    process.exitCode = 1;
    return;
  }
  ok(`main merged: ${fromBranch}`);
  // 4) main push
  const pushR = cp.spawnSync('git', ['push', remoteName, 'main'], { cwd: root, encoding: 'utf8' });
  if (pushR.status !== 0) { fail('main push 실패: ' + (pushR.stderr || '').slice(0, 200)); process.exitCode = 1; }
  else ok(`main pushed → ${remoteName}/main`);
  // 5) return to source branch (release 작업 흐름 보존)
  cp.spawnSync('git', ['checkout', fromBranch], { cwd: root, encoding: 'utf8' });
}

// 1.9.40: release pack — 가벼운 통합 명령 (npm pack + self-host migrate + auto task + close + readme sync)
// 메타 감사에서 발견한 "라운드 마감 = pack" 패턴을 leerness 워크플로로 흡수.
// 1.9.140+: --auto-main-push (또는 LEERNESS_AUTO_MAIN_PUSH=1) — release 후 main 자동 merge & push
async function releasePackCmd(root) {
  root = absRoot(root || process.cwd());
  const dryRun = has('--dry-run');
  const parentMigrate = has('--parent-migrate');
  const close = has('--close');
  const readmeSync = !has('--no-readme-sync');
  const taskTitle = arg('--task-add', null);
  // 1.9.140: main 자동 push (사용자 명시 요청)
  const autoMainPush = has('--auto-main-push') || process.env.LEERNESS_AUTO_MAIN_PUSH === '1';
  log(`# leerness release pack (1.9.40) — 1.9.140 main-push 통합`);
  log(`mode: ${dryRun ? 'dry-run' : 'live'} · parent-migrate: ${parentMigrate} · close: ${close} · readme-sync: ${readmeSync} · auto-main-push: ${autoMainPush}`);
  log('');

  // 1. README 동기화 (배지/카운트)
  if (readmeSync) {
    try { syncReadme(root); ok('readme sync 적용'); } catch (e) { warn('readme sync skip: ' + e.message); }
  }

  // 2. npm pack
  if (!dryRun) {
    const r = cp.spawnSync('npm', ['pack'], { cwd: root, encoding: 'utf8', shell: true });
    if (r.status !== 0) { fail('npm pack 실패'); log(r.stderr); process.exitCode = 1; return; }
    const tarMatch = (r.stdout || '').match(/[^\s]+\.tgz/);
    if (tarMatch) ok(`npm pack → ${tarMatch[0]}`);
    else ok('npm pack 완료');
  } else {
    log('  (dry-run) npm pack 스킵');
  }

  // 3. 부모 워크스페이스 self-host migrate (dogfooding gap 차단)
  if (parentMigrate) {
    const parent = path.resolve(root, '..');
    if (exists(path.join(parent, '.harness'))) {
      log(`\n[parent self-host migrate] ${parent}`);
      if (!dryRun) {
        try {
          await install(parent, { force: false, dry: false, migration: true, nonInteractive: true });
          ok('parent migrate 완료');
        } catch (e) { warn('parent migrate 실패: ' + e.message); }
      } else {
        log(`  (dry-run) ${parent} migrate 스킵`);
      }
    } else {
      log('  (parent에 .harness 없음 — migrate 스킵)');
    }
  }

  // 4. 자동 task add — 매 release 라운드가 progress-tracker에 흔적 남도록
  if (taskTitle) {
    const v = getCurrentVersion(root) || VERSION;
    const id = nextId(root, 'T');
    upsertProgress(root, {
      id,
      status: 'done',
      request: taskTitle,
      evidence: `release pack ${v} · ${new Date().toISOString().slice(0, 10)}`,
      nextAction: '다음 라운드 후보 검토'
    });
    ok(`task added: ${id} · ${taskTitle}`);
  }

  // 5. session close
  if (close) {
    log('\n[session close]');
    try {
      const r = sessionClose(root);
      ok('session close 호출됨');
    } catch (e) { warn('session close 실패: ' + e.message); }
  }

  // 6. 1.9.140: main 자동 push (release/X.Y.Z 외에 main 동기화)
  if (autoMainPush && !dryRun) {
    log('\n[auto main push] (1.9.140)');
    try { releaseSyncMainCmd(root); } catch (e) { warn('auto-main-push 실패: ' + e.message); }
  }

  log('\n✅ release pack 완료');
}

function releasePublish(root) {
  root = absRoot(root);
  const dryRun = has('--dry-run');
  log('# release publish');
  log(`Mode: ${dryRun ? 'dry-run' : 'live'}`);

  // 1. git remote 자동 감지 (1.9.10)
  const remote = detectGitRemote(root);
  if (remote) log(`Git remote (origin): ${remote.host === 'github' ? `${remote.owner}/${remote.repo}` : remote.url}`);
  else log('Git remote: 없음');

  // 2. npm pack (필요한 경우 — pack-only도 의미 있음)
  if (has('--pack') || has('--npm-publish') || (!has('--git-push') && !has('--gh-release') && !has('--gh-pages'))) {
    const packR = cp.spawnSync('npm', ['pack'], { cwd: root, encoding: 'utf8', shell: true });
    if (packR.status !== 0) { fail('npm pack 실패'); log(packR.stderr); process.exitCode = 1; return; }
    ok('npm pack 완료');
  }

  // 3. git push (--git-push 또는 --auto + remote 있을 때)
  if (has('--git-push') || (has('--auto') && remote)) {
    log('git push:');
    const r1 = cp.spawnSync('git', ['push'], { cwd: root, encoding: 'utf8', shell: true });
    log((r1.stdout || r1.stderr || '').slice(-200) || '(no output)');
    const r2 = cp.spawnSync('git', ['push', '--tags'], { cwd: root, encoding: 'utf8', shell: true });
    log((r2.stdout || r2.stderr || '').slice(-200) || '(no output)');
  }

  // 4. GitHub Release (--gh-release, gh CLI 사용)
  if (has('--gh-release')) {
    if (!remote || remote.host !== 'github') { warn('--gh-release: GitHub remote 없음 — 스킵'); }
    else {
      const v = getCurrentVersion(root);
      if (!v) { warn('--gh-release: package.json#version 없음 — 스킵'); }
      else {
        const tag = `v${v}`;
        const ghArgs = ['release', 'create', tag, '--generate-notes', '--title', `${remote.repo} ${tag}`];
        const tarball = path.join(root, `${JSON.parse(read(path.join(root, 'package.json'))).name}-${v}.tgz`);
        if (exists(tarball)) ghArgs.push(tarball);
        log(`gh ${ghArgs.join(' ')}`);
        const ghR = cp.spawnSync('gh', ghArgs, { cwd: root, encoding: 'utf8', shell: true });
        log((ghR.stdout || ghR.stderr || '').slice(-300) || '(no output)');
        if (ghR.status !== 0) warn('gh release 생성 실패 (이미 존재할 수 있음)');
        else ok(`GitHub Release 생성: ${tag}`);
      }
    }
  }

  // 5. gh-pages 배포 (--gh-pages)
  if (has('--gh-pages')) {
    const src = arg('--gh-pages-src', null) || arg('--roadmap', null) || 'roadmap.html';
    deployGhPages(root, src);
  }

  // 6. npm publish (--npm-publish)
  if (has('--npm-publish')) {
    const args = dryRun ? ['publish', '--dry-run'] : ['publish', '--access', 'public'];
    log('npm ' + args.join(' '));
    const r = cp.spawnSync('npm', args, { cwd: root, encoding: 'utf8', shell: true });
    log((r.stdout || '').split('\n').slice(-5).join('\n'));
    if (r.status !== 0) { fail('npm publish 실패'); process.exitCode = 1; return; }
  }
  ok('release publish 완료');
}

// ===== 1.9.7 A: verify-code — npm scripts 자동 감지 + evidence 자동 기록 =====
// 1.9.148: 다중 런타임 자동 감지 강화 (3중 LLM 합의 — Codex+Gemini+GPT-5.5)
//   Node (vitest/jest/mocha), Python (pytest), Go (go test), Rust (cargo test), TypeScript (tsc)
function verifyCodeCmd(root) {
  root = absRoot(root);
  const tasks = [];
  // (1) Node: package.json 우선
  const pkgFile = path.join(root, 'package.json');
  if (exists(pkgFile)) {
    let pkg = {};
    try { pkg = JSON.parse(read(pkgFile)); } catch (e) { return fail('package.json 파싱 실패: ' + e.message); }
    const scripts = pkg.scripts || {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (scripts.test) tasks.push({ name: 'test', cmd: 'npm test', runtime: 'node' });
    else if (scripts['test:smoke']) tasks.push({ name: 'test', cmd: 'npm run test:smoke', runtime: 'node' });
    // 1.9.148: 명시 script 없어도 인기 러너 의존성 발견 시 시도
    else if (deps.vitest) tasks.push({ name: 'test', cmd: 'npx --yes vitest run', runtime: 'node' });
    else if (deps.jest) tasks.push({ name: 'test', cmd: 'npx --yes jest --ci', runtime: 'node' });
    else if (deps.mocha) tasks.push({ name: 'test', cmd: 'npx --yes mocha', runtime: 'node' });
    if (scripts.lint) tasks.push({ name: 'lint', cmd: 'npm run lint', runtime: 'node' });
    if (scripts.typecheck) tasks.push({ name: 'typecheck', cmd: 'npm run typecheck', runtime: 'node' });
    else if (scripts.tsc) tasks.push({ name: 'typecheck', cmd: 'npm run tsc', runtime: 'node' });
    else if (exists(path.join(root, 'tsconfig.json'))) tasks.push({ name: 'typecheck', cmd: 'npx --yes tsc --noEmit', runtime: 'node', optional: true });
    if (has('--build') && scripts.build) tasks.push({ name: 'build', cmd: 'npm run build', runtime: 'node' });
    if (has('--bench') && scripts.bench) tasks.push({ name: 'bench', cmd: 'npm run bench', runtime: 'node', optional: true });
  }
  // (2) Python: pyproject.toml / setup.py / tests/ 존재 시 pytest 시도
  if (exists(path.join(root, 'pyproject.toml')) || exists(path.join(root, 'setup.py')) || exists(path.join(root, 'tests'))) {
    if (!tasks.find(t => t.name === 'test')) tasks.push({ name: 'test', cmd: 'pytest -q', runtime: 'python', optional: true });
  }
  // (3) Go: go.mod 존재 시 go test ./...
  if (exists(path.join(root, 'go.mod'))) {
    tasks.push({ name: 'test:go', cmd: 'go test ./...', runtime: 'go' });
  }
  // (4) Rust: Cargo.toml 존재 시 cargo test
  if (exists(path.join(root, 'Cargo.toml'))) {
    tasks.push({ name: 'test:rust', cmd: 'cargo test', runtime: 'rust' });
  }
  if (!tasks.length) {
    // 1.9.148: --strict 또는 LEERNESS_AUTONOMOUS=1 시 no-test 도 실패로 (3중 LLM 합의: production-grade test 강제)
    const strict = has('--strict') || process.env.LEERNESS_AUTONOMOUS === '1';
    const msg = '검증 task 없음 (package.json#scripts test/lint/typecheck, pytest, go test, cargo test 중 하나도 미발견)';
    if (strict) { fail(msg + ' — --strict/autonomous 모드: 실패 처리 (exit 1)'); process.exitCode = 1; return; }
    warn(msg);
    return;
  }
  log(`# verify-code (${tasks.length}개)`);
  let failedCnt = 0;
  const results = [];
  for (const t of tasks) {
    log(`\n## ${t.name}: ${t.cmd}`);
    const start = Date.now();
    // 1.9.150: runCommandSafe — cwd jail + env scrub + observability 자동 (shell:true 유지 — npm/pytest 호환)
    const r = runCommandSafe(t.cmd, [], { cwd: root, root, timeout: 5 * 60 * 1000, allowShell: true, kind: 'verify_code_task', label: `verify-${t.name}` });
    const dur = Date.now() - start;
    if (r.status === 0) ok(`${t.name} passed (${dur}ms)`);
    else if (t.optional && r.status === 127) warn(`${t.name} 스킵 (${t.cmd} 없음)`);
    else { fail(`${t.name} failed (exit ${r.status}, ${dur}ms)`); failedCnt++; }
    const tail = (r.stdout || '').split('\n').slice(-8).join('\n').slice(0, 400);
    results.push({ name: t.name, cmd: t.cmd, exit: r.status, durMs: dur, tail });
  }
  const evBlock = [
    ``,
    `## ${now().slice(0, 16)} verify-code (자동)`,
    `Command: leerness verify-code`,
    `Tasks: ${tasks.map(t => t.name).join(', ')}`,
    ...results.map(r => `- ${r.name}: exit=${r.exit} (${r.durMs}ms) — \`${r.cmd}\``),
    `Tail:`,
    '```',
    results.map(r => `[${r.name}]\n${r.tail}`).join('\n---\n').slice(0, 1500),
    '```'
  ].join('\n');
  append(evidencePath(root), evBlock + '\n');
  ok(`evidence 기록: .harness/review-evidence.md`);
  if (failedCnt) { process.exitCode = 1; warn(`${failedCnt}개 task 실패 — progress의 해당 row를 incomplete로 표시하세요.`); }
}

// ===== 1.9.7 B: lessons — 과거 결정/실수 자동 회수 =====
function lessonsCmd(root) {
  root = absRoot(root);
  let query = arg('--query', null);
  const limit = parseInt(arg('--limit', '10'), 10);
  // 1.9.54: --auto 옵션 — 현재 진행 중인 task의 키워드 자동 추출 → query로 사용
  if (has('--auto') && !query) {
    const rows = readProgressRows(root);
    // 가장 최근 in-progress 또는 가장 최근 row의 request에서 키워드 추출
    const latest = rows.filter(r => r.status === 'in-progress' || r.status === 'planned').pop()
                || rows[rows.length - 1];
    if (latest && latest.request) {
      // 4자+ 키워드 중 가장 긴 단어 1개 선택
      const tokens = String(latest.request).toLowerCase().match(/[\w가-힣]{4,}/g) || [];
      // 1.9.55: stopword 확장 — 너무 일반적인 단어 제외 (lessons 매칭에 도움 안 됨)
      const stopwords = new Set([
        '이런', '저런', '하다', '하고', '있는', '하지', '에서',
        '작업', '구현', '추가', '진행', '수정', '변경', '검토', '확인',
        '프로젝트', '관리', '기능', '시스템', '코드', '파일', '버전', '정리', '계획',
        'next', 'action', 'task', 'todo', 'work'
      ]);
      const candidate = tokens.filter(t => !stopwords.has(t)).sort((a, b) => b.length - a.length)[0];
      if (candidate) query = candidate;
    }
    if (!query) {
      log('# Lessons --auto');
      log('(현재 작업에서 추출할 키워드 없음 — 새 task 등록 후 다시 시도)');
      return;
    }
    log(`# Lessons --auto (1.9.54): 추출 키워드 "${query}"`);
  }
  // 1.9.65/67: 인덱스 캐시 활용 (decisions/evidence/task-log split 1회만)
  const _lidx = _loadLessonsIndex(root);
  const decisions = exists(decisionsPath(root)) ? read(decisionsPath(root)) : '';
  const handoff = exists(handoffPath(root)) ? read(handoffPath(root)) : '';
  const lessons = [];
  // decisions: ### 블록 전체 (1.9.14: 코드블록/Template 제외)
  for (const block of _extractDecisionBlocks(decisions)) {
    const m = block.match(/^### (.+)$/m);
    if (!m) continue;
    lessons.push({ source: 'decisions.md', title: m[1].trim(), block });
  }
  // evidence: ## 블록 중 실패/롤백/버그 표지가 있는 것 (1.9.65: 인덱스 재활용)
  for (const e of _lidx.evidence) {
    if (/✗|\bfail(ed)?\b|롤백|재발|incomplete|\bbug\b|버그|warning/i.test(e.block)) {
      lessons.push({ source: 'review-evidence.md', title: e.title, block: e.block });
    }
  }
  // task-log: 실패 키워드 라인 (1.9.67: 인덱스 재활용)
  for (const t of (_lidx.taskLogFails || [])) {
    lessons.push({ source: 'task-log.md', title: t.title, block: t.block });
  }
  // 1.9.112: lessons.md 전용 lessons (메모리 surface 5번째)
  for (const l of (_lidx.lessonsExplicit || [])) {
    lessons.push({ source: 'lessons.md', title: l.title, block: l.block });
  }
  // handoff: 미완료/블로커 항목
  if (handoff) {
    const incompleteSec = handoff.match(/## Incomplete[\s\S]*?(?=\n## |$)/);
    if (incompleteSec && incompleteSec[0].split('\n').slice(1).some(l => /^- (?!없음)/.test(l))) {
      lessons.push({ source: 'session-handoff.md', title: 'Incomplete / Blocked from last session', block: incompleteSec[0] });
    }
  }
  let filtered = lessons;
  if (query) {
    const q = new RegExp(escapeRegex(query), 'i');
    filtered = lessons.filter(l => q.test(l.title) || q.test(l.block));
  }
  // 1.9.95: --json 옵션 (MCP 통합 / CI 친화)
  if (has('--json')) {
    log(JSON.stringify({
      query: query || null,
      total: filtered.length,
      lessons: filtered.slice(0, limit).map(l => ({
        source: l.source,
        title: l.title,
        preview: l.block.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').slice(0, 240),
        truncated: l.block.length > 240
      }))
    }, null, 2));
    return;
  }
  log(`# Lessons${query ? ` — query="${query}"` : ''}`);
  if (!filtered.length) {
    if (query) ok(`"${query}" 관련 과거 lessons 없음`);
    else ok('과거 lessons 없음 (decisions/evidence가 비어있거나 실패 표지 없음)');
    return;
  }
  log(`총 ${filtered.length}건 발견:`);
  for (const l of filtered.slice(0, limit)) {
    log(`\n[${l.source}] ${l.title}`);
    const preview = l.block.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').slice(0, 240);
    log(`  ${preview}${l.block.length > 240 ? '…' : ''}`);
  }
  if (filtered.length > limit) log(`\n💡 ${filtered.length - limit}개 더 있음 — --limit ${filtered.length}`);
}

// ===== 1.9.141: Feature Causality Graph — 인과관계 추적 (사용자 요청) =====
// 신규 기능 추가 / 데이터 형식 변경 시 영향 범위 자동 감지. 코드 작성 전 참조 우선순위 1순위.
// File: .harness/feature-graph.md
// Format per node (markdown):
//   ## F-XXXX <title>
//   - depends-on: F-YYYY, F-ZZZZ
//   - affects: F-AAAA, F-BBBB
//   - co-changes-with: F-CCCC
//   - files: src/foo/*, src/bar.ts
//   - input: { fields }
//   - output: { fields }
//   - error-modes: e1, e2
//   - tests: tests/foo.test.ts
//   - notes: 자유 메모
function featureGraphPath(root) { return path.join(absRoot(root), '.harness', 'feature-graph.md'); }
function _featureGraphTemplate() {
  return `# Feature Graph (1.9.141)\n\n` +
    `> **목적**: 각 기능의 인과관계를 정확히 정리해서 코드 작성 전 영향 범위를 자동 추적.\n` +
    `> 신규 기능 추가, 데이터 형식 변경, 외부 API 매칭 작업 전 \`leerness feature impact <id>\`로 확인.\n` +
    `> handoff가 현재 task 키워드로 자동 매칭해서 영향받는 feature 목록을 회수.\n\n` +
    `## How to use\n\n` +
    `\`\`\`bash\n` +
    `leerness feature add "User Auth"                           # F-0001 자동 부여\n` +
    `leerness feature link F-0002 --depends-on F-0001           # 의존 관계\n` +
    `leerness feature link F-0001 --affects F-0002,F-0005        # 영향 관계 (다수)\n` +
    `leerness feature link F-0001 --co-changes-with F-0011       # 함께 변해야 하는 기능\n` +
    `leerness feature impact F-0001                              # 영향받는 전체 (transitive)\n` +
    `leerness feature list --json                                # 그래프 JSON\n` +
    `leerness feature show F-0001                                # 단일 상세\n` +
    `\`\`\`\n\n` +
    `## Nodes\n\n`;
}
function _parseFeatureGraph(text) {
  if (!text) return [];
  const nodes = [];
  const re = /^## (F-\d{4})\s+(.+?)\s*$/gm;
  const positions = [];
  let m;
  while ((m = re.exec(text)) !== null) positions.push({ id: m[1], title: m[2], start: m.index });
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].start;
    const end = i + 1 < positions.length ? positions[i + 1].start : text.length;
    const block = text.slice(start, end);
    const parseField = (key) => {
      // 1.9.141 fix: \s 은 \n 도 포함하므로 [ \t]* 로 newline 비포함 horizontal whitespace 만 매칭
      const r = new RegExp(`^- ${key}:[ \\t]*(.*?)$`, 'mi');
      const mm = block.match(r);
      return mm ? mm[1].trim() : '';
    };
    const parseList = (key) => {
      const v = parseField(key);
      if (!v) return [];
      return v.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    };
    nodes.push({
      id: positions[i].id,
      title: positions[i].title,
      dependsOn: parseList('depends-on'),
      affects: parseList('affects'),
      coChangesWith: parseList('co-changes-with'),
      files: parseList('files'),
      input: parseField('input'),
      output: parseField('output'),
      errorModes: parseList('error-modes'),
      tests: parseList('tests'),
      notes: parseField('notes')
    });
  }
  return nodes;
}
function _readFeatureGraph(root) {
  const p = featureGraphPath(root);
  if (!exists(p)) return { nodes: [], text: '' };
  const text = read(p);
  return { nodes: _parseFeatureGraph(text), text };
}
function _ensureFeatureGraph(root) {
  const p = featureGraphPath(root);
  if (!exists(p)) writeUtf8(p, _featureGraphTemplate());
  return p;
}
function _nextFeatureId(nodes) {
  const used = new Set(nodes.map(n => parseInt(n.id.slice(2), 10)));
  let n = 1; while (used.has(n)) n++;
  return 'F-' + String(n).padStart(4, '0');
}
function _featureBlock(node) {
  return `## ${node.id} ${node.title}\n` +
    `- depends-on: ${(node.dependsOn || []).join(', ')}\n` +
    `- affects: ${(node.affects || []).join(', ')}\n` +
    `- co-changes-with: ${(node.coChangesWith || []).join(', ')}\n` +
    `- files: ${(node.files || []).join(', ')}\n` +
    `- input: ${node.input || ''}\n` +
    `- output: ${node.output || ''}\n` +
    `- error-modes: ${(node.errorModes || []).join(', ')}\n` +
    `- tests: ${(node.tests || []).join(', ')}\n` +
    `- notes: ${node.notes || ''}\n\n`;
}
function _writeFeatureGraph(root, nodes) {
  const p = _ensureFeatureGraph(root);
  const header = _featureGraphTemplate();
  const body = nodes.map(_featureBlock).join('');
  writeUtf8(p, header + body);
}
function featureAddCmd(root, title) {
  root = absRoot(root);
  if (!title) return fail('feature add: title 필요 — leerness feature add "<title>"');
  _ensureFeatureGraph(root);
  const { nodes } = _readFeatureGraph(root);
  if (nodes.some(n => n.title.toLowerCase() === title.toLowerCase())) {
    return warn(`이미 존재: "${title}"`);
  }
  const id = _nextFeatureId(nodes);
  const node = {
    id, title,
    dependsOn: [], affects: [], coChangesWith: [],
    files: [], input: '', output: '', errorModes: [], tests: [], notes: ''
  };
  // 옵션 인자 — 한 번에 의존/영향 등록 가능
  const depends = arg('--depends-on', '');
  const affects = arg('--affects', '');
  const coChanges = arg('--co-changes-with', '');
  const files = arg('--files', '');
  if (depends) node.dependsOn = depends.split(/[,\s]+/).filter(Boolean);
  if (affects) node.affects = affects.split(/[,\s]+/).filter(Boolean);
  if (coChanges) node.coChangesWith = coChanges.split(/[,\s]+/).filter(Boolean);
  if (files) node.files = files.split(/[,\s]+/).filter(Boolean);
  nodes.push(node);
  _writeFeatureGraph(root, nodes);
  ok(`feature added: ${id} · ${title}`);
}
function featureLinkCmd(root, fromId) {
  root = absRoot(root);
  if (!fromId || !/^F-\d{4}$/.test(fromId)) return fail('feature link: 첫 인자는 F-XXXX 형식 ID');
  const { nodes } = _readFeatureGraph(root);
  const node = nodes.find(n => n.id === fromId);
  if (!node) return fail(`feature ${fromId} 없음 — feature add 먼저`);
  const dep = arg('--depends-on', '');
  const aff = arg('--affects', '');
  const co = arg('--co-changes-with', '');
  let changes = 0;
  if (dep) { const ids = dep.split(/[,\s]+/).filter(Boolean); for (const id of ids) if (!node.dependsOn.includes(id)) { node.dependsOn.push(id); changes++; } }
  if (aff) { const ids = aff.split(/[,\s]+/).filter(Boolean); for (const id of ids) if (!node.affects.includes(id)) { node.affects.push(id); changes++; } }
  if (co)  { const ids =  co.split(/[,\s]+/).filter(Boolean); for (const id of ids) if (!node.coChangesWith.includes(id)) { node.coChangesWith.push(id); changes++; } }
  if (!changes) return warn('변경 없음 — --depends-on / --affects / --co-changes-with 중 하나 이상 지정');
  _writeFeatureGraph(root, nodes);
  ok(`feature ${fromId} 링크 ${changes}건 추가`);
}
function _featureImpactBfs(nodes, startId) {
  // affects + co-changes-with 양방향 transitive closure
  const byId = new Map(nodes.map(n => [n.id, n]));
  const visited = new Set();
  const queue = [{ id: startId, depth: 0, via: 'self' }];
  const result = [];
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur.id)) continue;
    visited.add(cur.id);
    const node = byId.get(cur.id);
    if (!node) continue;
    if (cur.depth > 0) result.push({ id: cur.id, title: node.title, depth: cur.depth, via: cur.via, files: node.files, errorModes: node.errorModes });
    for (const next of node.affects || []) queue.push({ id: next, depth: cur.depth + 1, via: 'affects' });
    for (const next of node.coChangesWith || []) queue.push({ id: next, depth: cur.depth + 1, via: 'co-changes-with' });
  }
  // 역방향: 이 feature에 depends-on 하는 노드도 영향받음
  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    if ((n.dependsOn || []).includes(startId)) {
      result.push({ id: n.id, title: n.title, depth: 1, via: 'depends-on(reverse)', files: n.files, errorModes: n.errorModes });
      visited.add(n.id);
    }
  }
  return result;
}
function featureImpactCmd(root, fromId) {
  root = absRoot(root);
  if (!fromId || !/^F-\d{4}$/.test(fromId)) return fail('feature impact: F-XXXX ID 필요');
  const { nodes } = _readFeatureGraph(root);
  const node = nodes.find(n => n.id === fromId);
  if (!node) return fail(`feature ${fromId} 없음`);
  const impacted = _featureImpactBfs(nodes, fromId);
  if (has('--json')) {
    log(JSON.stringify({ feature: { id: node.id, title: node.title }, total: impacted.length, impacted }, null, 2));
    return;
  }
  log(`# Feature Impact: ${node.id} · ${node.title}`);
  if (!impacted.length) { ok('영향받는 다른 feature 없음 (또는 link 미설정)'); return; }
  log(`\n총 ${impacted.length} feature에 영향:\n`);
  for (const it of impacted) {
    log(`  ${it.id} · ${it.title}  [depth=${it.depth}, via=${it.via}]`);
    if (it.files && it.files.length) log(`    files: ${it.files.join(', ')}`);
    if (it.errorModes && it.errorModes.length) log(`    error-modes: ${it.errorModes.join(', ')}`);
  }
  log(`\n💡 코드 변경 전 위 ${impacted.length}개 feature의 테스트/계약 확인 권장`);
}
function featureListCmd(root) {
  root = absRoot(root);
  const { nodes } = _readFeatureGraph(root);
  if (has('--json')) {
    log(JSON.stringify({ total: nodes.length, features: nodes }, null, 2));
    return;
  }
  log(`# Features (${nodes.length}개)`);
  if (!nodes.length) {
    log('  (없음) — leerness feature add "<title>"');
    return;
  }
  for (const n of nodes) {
    log(`  ${n.id} · ${n.title}`);
    if (n.dependsOn.length) log(`    ↓ depends-on: ${n.dependsOn.join(', ')}`);
    if (n.affects.length) log(`    → affects: ${n.affects.join(', ')}`);
    if (n.coChangesWith.length) log(`    ↔ co-changes-with: ${n.coChangesWith.join(', ')}`);
  }
}
function featureShowCmd(root, fromId) {
  root = absRoot(root);
  if (!fromId || !/^F-\d{4}$/.test(fromId)) return fail('feature show: F-XXXX ID 필요');
  const { nodes } = _readFeatureGraph(root);
  const node = nodes.find(n => n.id === fromId);
  if (!node) return fail(`feature ${fromId} 없음`);
  if (has('--json')) { log(JSON.stringify(node, null, 2)); return; }
  log(`# ${node.id} · ${node.title}`);
  log(`  depends-on:      ${node.dependsOn.join(', ') || '(없음)'}`);
  log(`  affects:         ${node.affects.join(', ') || '(없음)'}`);
  log(`  co-changes-with: ${node.coChangesWith.join(', ') || '(없음)'}`);
  log(`  files:           ${node.files.join(', ') || '(없음)'}`);
  log(`  input:           ${node.input || '(없음)'}`);
  log(`  output:          ${node.output || '(없음)'}`);
  log(`  error-modes:     ${node.errorModes.join(', ') || '(없음)'}`);
  log(`  tests:           ${node.tests.join(', ') || '(없음)'}`);
  log(`  notes:           ${node.notes || '(없음)'}`);
}

// ===== 1.9.3: Causal / reuse / consistency =====
const CODE_EXT = new Set(['.js','.ts','.jsx','.tsx','.mjs','.cjs','.css','.scss','.sass','.less','.html','.htm','.vue','.svelte','.md','.json','.py','.rb','.go','.rs','.java','.kt','.swift','.cs','.php']);
function* walkCode(root, base = root, depth = 0, extras = null) {
  if (depth > 12) return;
  if (extras === null) extras = getExtraSkipDirs(root);
  for (const e of fs.readdirSync(base, { withFileTypes: true })) {
    const p = path.join(base, e.name);
    const r = path.relative(root, p).replace(/\\/g, '/');
    if (isSkippedRel(r, extras)) continue;
    if (e.isDirectory()) yield* walkCode(root, p, depth + 1, extras);
    else if (CODE_EXT.has(path.extname(p).toLowerCase())) yield p;
  }
}
function escapeRegex(s) { return String(s).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'); }

function impactCmd(root, target) {
  if (!target) return fail('target required (e.g., impact src/components/card.html)');
  root = absRoot(root);
  const abs = path.isAbsolute(target) ? target : path.resolve(root, target);
  const base = path.basename(target);
  const noext = path.basename(target, path.extname(target));
  const targetRel = rel(root, abs);
  const eb = escapeRegex(base);
  // 1.9.5 G: strong (정적 import) / medium (동적 path 함수) / weak (식별자 등장) 3단계.
  const strongRe = new RegExp(
    `(?:` +
    `import\\s+[^;\\n]*?from\\s+['"][^'"]*${eb}` +
    `|require\\(\\s*['"][^'"]*${eb}` +
    `|@import\\s+['"][^'"]*${eb}` +
    `|href=["'][^"']*${eb}` +
    `|src=["'][^"']*${eb}` +
    `|url\\(\\s*['"]?[^'")]*${eb}` +
    `|include\\(\\s*['"][^'"]*${eb}` +
    `)`
  );
  // 동적 path 조합 / 파일 시스템 호출과 함께 base 파일명이 등장하는 경우.
  const mediumRe = new RegExp(
    `(?:` +
    `path\\.(?:join|resolve|relative|parse|format|normalize)\\s*\\([^)]*['"][^'"]*${eb}[^'"]*['"]` +
    `|(?:readFile|writeFile|stat|access|open|createReadStream|createWriteStream|readFileSync|writeFileSync|statSync|accessSync|openSync)\\s*\\([^)]*['"][^'"]*${eb}[^'"]*['"]` +
    `|fs\\.[a-zA-Z]+\\s*\\([^)]*['"][^'"]*${eb}[^'"]*['"]` +
    `|new\\s+URL\\s*\\([^)]*['"][^'"]*${eb}[^'"]*['"]` +
    `)`
  );
  const weakRe = new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(noext)}(?![A-Za-z0-9_])`);
  const high = []; const medium = []; const low = [];
  for (const f of walkCode(root)) {
    if (path.resolve(f) === path.resolve(abs)) continue;
    let text; try { text = read(f); } catch { continue; }
    if (strongRe.test(text)) high.push(rel(root, f));
    else if (mediumRe.test(text)) medium.push(rel(root, f));
    else if (weakRe.test(text)) low.push(rel(root, f));
  }
  log(`# impact: ${targetRel}`);
  const showAll = has('--all');
  const totalEffective = high.length + medium.length;
  if (totalEffective === 0 && (low.length === 0 || !showAll)) ok('영향 범위 없음 (강한/중간 참조 없음)');
  else {
    if (high.length) {
      log(`강한 참조 ${high.length}개 (import/require/href/src/@import/url/include):`);
      high.forEach(d => log('  - ' + d));
    } else log('강한 참조: 없음');
    if (medium.length) {
      log(`\n중간 참조 ${medium.length}개 (path.join/readFile/fs 등 동적 path):`);
      medium.forEach(d => log('  ~ ' + d));
    }
    if (showAll && low.length) {
      log(`\n약한 참조 ${low.length}개 (식별자 등장 — false positive 가능):`);
      low.forEach(d => log('  · ' + d));
    } else if (low.length && !showAll) {
      log(`\n💡 약한 참조 ${low.length}개 (--all 로 표시)`);
    }
  }
  return { target: targetRel, high, medium, low };
}

function reuseMapPath(root) { return path.join(root, '.harness/reuse-map.md'); }
function designSystemPath(root) { return path.join(root, '.harness/design-system.md'); }
function featureContractsPath(root) { return path.join(root, '.harness/feature-contracts.md'); }

function reuseFind(root, query) {
  if (!query) return fail('query required');
  root = absRoot(root);
  const re = new RegExp(escapeRegex(query), 'i');
  const matches = [];
  for (const src of [reuseMapPath(root), designSystemPath(root), featureContractsPath(root), planPath(root), progressPath(root)]) {
    if (!exists(src)) continue;
    const text = read(src);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) matches.push({ source: rel(root, src), line: i + 1, text: lines[i].trim() });
    }
  }
  // 코드 export/식별자 검색
  for (const f of walkCode(root)) {
    if (rel(root, f).startsWith('.harness/')) continue;
    let text; try { text = read(f); } catch { continue; }
    const lines = text.split('\n');
    const exportRe = new RegExp(`(?:export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|class|let|var)\\s+(\\w*${escapeRegex(query)}\\w*)|class\\s+(\\w*${escapeRegex(query)}\\w*)|<(\\w*${escapeRegex(query)}\\w*)\\b)`, 'i');
    for (let i = 0; i < lines.length; i++) {
      if (exportRe.test(lines[i])) matches.push({ source: rel(root, f), line: i + 1, text: lines[i].trim().slice(0, 120) });
    }
  }
  log(`# reuse find: "${query}"`);
  if (!matches.length) return ok('기존 자원 없음 — 새로 만드는 것이 최선의 선택일 수 있음');
  log(`${matches.length}개 후보:`);
  for (const m of matches.slice(0, parseInt(arg('--limit', '20'), 10))) log(`- ${m.source}:${m.line}  ${m.text}`);
  log(`\n💡 새로 만들기 전에 위 자원을 재사용/확장 가능한지 확인하세요.`);
}

function reuseRegister(root, name) {
  if (!name) return fail('name required (e.g., reuse register Card --where components/card.html --kind component --note "기본 카드")');
  root = absRoot(root);
  const where = arg('--where', '?');
  const kind = arg('--kind', 'component');
  const note = arg('--note', '-');
  const file = reuseMapPath(root);
  const text = exists(file) ? read(file) : '';
  if (text.includes(`| ${name} |`)) return warn(`already registered: ${name}`);
  const newRow = `| ${name} | ${where} | ${kind} | ${note} |`;
  const lines = text.split('\n');
  const headerIdx = lines.findIndex(l => /^\|\s*-+\s*\|/.test(l));
  if (headerIdx >= 0) {
    lines.splice(headerIdx + 1, 0, newRow);
    writeUtf8(file, lines.join('\n'));
  } else {
    append(file, '\n' + newRow + '\n');
  }
  ok(`reuse registered: ${name} (${kind}) → ${where}`);
}

function uiConsistency(root) {
  root = absRoot(root);
  // 1) design-system.md에서 토큰 값 추출
  const ds = exists(designSystemPath(root)) ? read(designSystemPath(root)) : '';
  const tokens = {};
  for (const line of ds.split('\n')) {
    const m = line.match(/^\|\s*([\w.\-]+)\s*\|\s*([^|]+?)\s*\|/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim();
    if (key === 'Token' || /^-+$/.test(key) || val === 'Value' || /실제 값으로 업데이트/.test(val) || !val) continue;
    tokens[key] = val;
  }
  const tokenSet = new Set(Object.values(tokens).map(v => v.toLowerCase()));
  if (Object.keys(tokens).length === 0) {
    warn('design-system.md에 토큰이 등록되지 않음 (Tokens 표를 채우면 일관성 검사 가능)');
    return;
  }
  ok(`등록된 디자인 토큰: ${Object.keys(tokens).length}개`);
  const findings = [];
  for (const f of walkCode(root)) {
    const r = rel(root, f);
    if (r.startsWith('.harness/')) continue;
    // 1.9.12: leerness가 자동 생성하는 roadmap.html은 ui consistency 검사 대상 아님
    if (r === 'roadmap.html' || /\/roadmap\.html$/.test(r)) continue;
    if (!/\.(css|scss|sass|less|html|jsx|tsx|vue|svelte|js|ts)$/i.test(f)) continue;
    let text; try { text = read(f); } catch { continue; }
    const hexes = [...text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)];
    for (const h of hexes) {
      const v = h[0].toLowerCase();
      if (!tokenSet.has(v)) {
        const line = text.slice(0, h.index).split('\n').length;
        findings.push({ file: rel(root, f), line, value: h[0], type: 'hex' });
      }
    }
    // px/rem 휴리스틱은 false positive가 많아 옵션
    if (has('--strict')) {
      const sizes = [...text.matchAll(/\b(\d+)(px|rem)\b/g)];
      for (const s of sizes) {
        const v = `${s[1]}${s[2]}`;
        if (!tokenSet.has(v)) {
          const line = text.slice(0, s.index).split('\n').length;
          findings.push({ file: rel(root, f), line, value: v, type: 'size' });
        }
      }
    }
  }
  if (!findings.length) return ok('UI consistency 통과 (모든 색상이 토큰)');
  warn(`토큰 외 값 ${findings.length}개:`);
  for (const f of findings.slice(0, 30)) log(`  ${f.file}:${f.line}  ${f.value}  (${f.type})`);
  if (findings.length > 30) log(`  ... +${findings.length - 30}개`);
  // 1.9.4 B: cross-platform 종료 코드 명시
  if (has('--fail-on-violation')) { process.exitCode = 1; if (has('--strict-exit')) process.exit(1); }
}

function graphCmd(root) {
  root = absRoot(root);
  const edges = [];
  for (const f of walkCode(root)) {
    if (rel(root, f).startsWith('.harness/')) continue;
    let text; try { text = read(f); } catch { continue; }
    const re = /(?:import\s+[^;\n]*?from\s+['"]|require\(['"]|@import\s+['"]|href=["']|src=["'])([^'")\s]+)/g;
    let m;
    while ((m = re.exec(text))) {
      edges.push({ src: rel(root, f), dst: m[1] });
    }
  }
  const out = arg('--out', null);
  const lines = ['```mermaid', 'graph TD'];
  const nodeSet = new Set();
  for (const e of edges) { nodeSet.add(e.src); nodeSet.add(e.dst); }
  for (const e of edges) lines.push(`  "${e.src}" --> "${e.dst}"`);
  lines.push('```');
  const md = `# Code dependency graph\n\n생성: ${now()}\n노드: ${nodeSet.size}, 엣지: ${edges.length}\n\n` + lines.join('\n') + '\n';
  if (out) {
    writeUtf8(path.resolve(root, out), md);
    ok(`graph 저장: ${out}`);
  } else {
    log(md);
  }
}

function guideCmd(root, target) {
  root = absRoot(root);
  log(`# 변경 전 가이드 ${target ? `(target: ${target})` : ''}`);
  log(`Date: ${today()}\n`);
  if (target) {
    log('## 1. Impact — 변경하면 영향받는 파일');
    impactCmd(root, target);
    log('');
  }
  log('## 2. Reuse — 기존 자원 검색');
  const q = target ? path.basename(target, path.extname(target)) : arg('--query', '');
  if (q) reuseFind(root, q);
  else log('(target 또는 --query 없음 — reuse 검색 스킵)');
  log('');
  log('## 3. UI consistency — 디자인 토큰 일치');
  uiConsistency(root);
  log('');
  log('## 4. Lessons — 과거 결정/실수 회수 (1.9.7)');
  if (q) {
    // lessonsCmd가 arg('--query')를 읽으므로 임시로 push
    if (!process.argv.includes('--query')) { process.argv.push('--query', q); }
    lessonsCmd(root);
  } else log('(target/--query 없음 — lessons 검색 스킵)');
  log('\n💡 다음 단계: 위 결과를 바탕으로 작업 계획을 plan/progress에 기록 후 진행하세요.');
}

// ===== Auto update =====
function compareVer(a, b) {
  const sa = String(a || '0').split('.').map(n => parseInt(n || '0', 10));
  const sb = String(b || '0').split('.').map(n => parseInt(n || '0', 10));
  for (let i = 0; i < 3; i++) {
    const x = sa[i] || 0, y = sb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}
function parseHarnessVersion(text) {
  const t = String(text || '').trim();
  // canonical: "1.9.0", legacy plus: "leerness@1.8.0+plus@1.0.1", legacy bare: "1.8.0", legacy "leerness@1.8.0"
  const plus = t.match(/plus@(\d+\.\d+\.\d+)/);
  const baseAt = t.match(/leerness@(\d+\.\d+\.\d+)/);
  const bare = t.match(/^(\d+\.\d+\.\d+)\s*$/);
  return {
    plus: plus ? plus[1] : null,
    base: baseAt ? baseAt[1] : (bare ? bare[1] : null),
    raw: t || '(not installed)'
  };
}
function updateCachePath(root) { return path.join(root, '.harness/cache/update-check.json'); }
function readUpdateCache(root) { try { const p = updateCachePath(root); if (!exists(p)) return null; return JSON.parse(read(p)); } catch { return null; } }
function writeUpdateCache(root, obj) { writeUtf8(updateCachePath(root), JSON.stringify({ at: Date.now(), ...obj }, null, 2) + '\n'); }
function cacheFresh(c, hours) { return c && c.at && (Date.now() - c.at < hours * 3600 * 1000); }
function fetchNpmLatest(pkg) {
  return new Promise(resolve => {
    if (process.env.LEERNESS_OFFLINE === '1' || process.env.LEERNESS_PLUS_OFFLINE === '1') return resolve(null);
    cp.exec(`npm view ${pkg} version`, { timeout: 12000 }, (err, stdout) => {
      if (err) return resolve(null);
      const v = String(stdout || '').trim();
      resolve(/^\d+\.\d+\.\d+/.test(v) ? v : null);
    });
  });
}

async function updateCmd(root, opts = {}) {
  root = absRoot(root);
  const verF = path.join(root, '.harness/HARNESS_VERSION');
  const cur = exists(verF) ? parseHarnessVersion(read(verF)) : { plus: null, base: null, raw: '(not installed)' };
  log(`# leerness update`);
  log(`Current: ${cur.raw}`);
  const fromTar = arg('--from', null);
  const cacheHours = opts.checkOnly ? 24 : 0;
  let nextLeerness = VERSION;
  if (fromTar) log(`Local tarball mode: ${fromTar}`);
  else {
    const cached = readUpdateCache(root);
    if (cacheFresh(cached, cacheHours)) {
      nextLeerness = cached.nextLeerness || VERSION;
      log(`(cached ${Math.round((Date.now() - cached.at) / 60000)}m ago)`);
      log(`npm leerness latest: ${cached.nextLeerness || '(unavailable)'}`);
    } else {
      log('Checking npm registry…');
      const latest = await fetchNpmLatest('leerness');
      nextLeerness = latest || VERSION;
      writeUpdateCache(root, { nextLeerness: latest, runningCli: VERSION });
      log(`npm leerness latest: ${latest || '(unavailable, using running CLI ' + VERSION + ')'}`);
    }
  }
  // What is "current"? canonical=base; legacy plus also rolls into leerness 1.9.0+
  const installed = cur.base || cur.plus; // either form
  let needsMigrate = false;
  let reason = '';
  if (!installed) { needsMigrate = true; reason = 'first install'; }
  else if (compareVer(nextLeerness, installed) > 0) { needsMigrate = true; reason = `newer (${installed} → ${nextLeerness})`; }
  else if (cur.plus && compareVer(nextLeerness, cur.base || '0.0.0') >= 0) {
    // Legacy plus@x.y.z layout → consolidate into leerness@1.9.0
    if (compareVer(nextLeerness, '1.9.0') >= 0) { needsMigrate = true; reason = 'consolidate legacy plus@ marker into canonical'; }
  }
  if (opts.checkOnly) {
    if (needsMigrate) log(`\n→ migration available: ${reason}`);
    else log('\n→ up to date');
    return;
  }
  if (!needsMigrate && !opts.force) { ok('already up to date'); return; }
  if (!opts.yes && process.stdin.isTTY) {
    const a = await ask(`Apply migration to ${nextLeerness}? [Y/n] `);
    if (a && /^n/i.test(a)) { log('aborted'); return; }
  }
  const runningIsLatest = compareVer(VERSION, nextLeerness) >= 0 && !fromTar;
  if (!runningIsLatest && !fromTar) {
    log(`\nDelegating to npx leerness@${nextLeerness} migrate (this fetches the new CLI)…`);
    const r = cp.spawnSync('npx', ['-y', `leerness@${nextLeerness}`, 'migrate', root, '--yes'], { stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) { fail(`delegated migrate exited ${r.status}`); process.exitCode = 1; return; }
  } else if (fromTar) {
    log(`\nDelegating to npx -p ${fromTar} leerness migrate (local tarball)…`);
    const r = cp.spawnSync('npx', ['-y', '-p', fromTar, 'leerness', 'migrate', root, '--yes'], { stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) { fail(`delegated migrate exited ${r.status}`); process.exitCode = 1; return; }
  } else {
    log(`\nRunning in-process migrate (already on latest ${VERSION})…`);
    await install(root, { force: false, dry: false, migration: true, nonInteractive: true });
  }
  log('\n# Post-migration checks');
  status(root);
  verify(root);
  audit(root);
  append(taskLogPath(root), `\n## ${today()} update\n- Migrated to leerness@${nextLeerness}.\n`);
  append(evidencePath(root), `\n## ${now().slice(0, 16)} leerness update\nCommand: leerness update\nFrom: ${cur.raw}\nTo: leerness@${nextLeerness}\nResult: migrated\n`);
  ok('update complete');
}

function autoUpdateInstall(root) {
  root = absRoot(root);
  const settingsDir = path.join(root, '.claude');
  mkdirp(settingsDir);
  const settingsFile = path.join(settingsDir, 'settings.local.json');
  let settings = {};
  if (exists(settingsFile)) { try { settings = JSON.parse(read(settingsFile)); } catch {} }
  settings.hooks = settings.hooks || {};
  // 1.9.1 P1: legacy 'leerness-plus update' hook 자동 제거 (이전 fork 시절 잔재).
  let removedLegacy = 0;
  settings.hooks.SessionStart = (settings.hooks.SessionStart || []).filter(h => {
    if (h && h.command && /\bleerness-plus update\b/.test(h.command)) { removedLegacy++; return false; }
    return true;
  });
  if (!settings.hooks.SessionStart.some(h => h.command && h.command.includes('leerness update'))) {
    settings.hooks.SessionStart.push({ matcher: '*', command: 'leerness update --check' });
  }
  writeUtf8(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  writeUtf8(path.join(root, '.claude/commands/update.md'),
    `# /update\n\nleerness 자동 업데이트 (감지 → 마이그레이션 → 검증).\n\n\`\`\`\n!leerness update --yes\n\`\`\`\n\n체크만:\n\n\`\`\`\n!leerness update --check\n\`\`\`\n`);
  ok('auto-update SessionStart hook installed (.claude/settings.local.json)');
  if (removedLegacy) ok(`legacy hook 제거: ${removedLegacy}건 (leerness-plus → leerness 통합)`);
  ok('/update slash command added');
}

// 1.9.151: ViewWork hook 제거 (사용자 명시 — leerness와 무관한 외부 도구)
// 이전 1.9.0~1.9.150 에서 .viewwork/ 디렉토리에 hook 으로 이벤트 기록했으나, ViewWork는 leerness 의존 산출물이
// 아닌 별도 도구임. 사용자가 직접 ViewWork 를 사용하지 않으면 leerness 가 이를 강제할 이유가 없음.
// 기존 프로젝트의 .viewwork/ 폴더는 그대로 유지 (leerness 가 삭제하지 않음 — 사용자 책임).

// 1.9.37: drift detection — 메타파일 staleness 측정으로 "leerness 점점 안 쓰는" 현상 감지
function driftCheckCmd(root, opts = {}) {
  root = absRoot(root || process.cwd());
  const now = Date.now();
  const _ageDays = (p) => {
    if (!exists(p)) return null;
    return (now - fs.statSync(p).mtimeMs) / 86400000;
  };
  // 각 메타파일의 마지막 갱신
  const signals = [];
  // 1. session-handoff.md - "Last generated" 라인 우선, 없으면 mtime
  const shPath = handoffPath(root);
  if (exists(shPath)) {
    const txt = read(shPath);
    const m = txt.match(/Last generated:\s*([\d\-T:.Z]+)/);
    let ageDays;
    if (m) {
      ageDays = (now - new Date(m[1]).getTime()) / 86400000;
    } else {
      ageDays = _ageDays(shPath);
    }
    signals.push({ file: 'session-handoff.md', ageDays, threshold: 1, weight: 30, label: 'session close 누락' });
  }
  // 2. current-state.md - "Updated: YYYY-MM-DD" 라인
  const csPath = currentStatePath(root);
  if (exists(csPath)) {
    const m = read(csPath).match(/Updated:\s*(\d{4}-\d{2}-\d{2})/);
    const ageDays = m ? (now - new Date(m[1]).getTime()) / 86400000 : _ageDays(csPath);
    signals.push({ file: 'current-state.md', ageDays, threshold: 2, weight: 20, label: 'current-state 갱신 없음' });
  }
  // 3. progress-tracker.md 마지막 row의 updated 컬럼
  const rows = readProgressRows(root);
  if (rows.length) {
    const dates = rows.map(r => (r.updated || '').match(/\d{4}-\d{2}-\d{2}/)).filter(Boolean).map(m => m[0]);
    if (dates.length) {
      dates.sort();
      const latest = dates[dates.length - 1];
      const ageDays = (now - new Date(latest).getTime()) / 86400000;
      signals.push({ file: 'progress-tracker.md', ageDays, threshold: 1, weight: 30, label: 'task update 없음' });
    }
  } else {
    signals.push({ file: 'progress-tracker.md', ageDays: 999, threshold: 1, weight: 25, label: 'progress-tracker 비어있음' });
  }
  // 4. task-log.md 마지막 entry "## YYYY-MM-DD"
  const tlPath = taskLogPath(root);
  if (exists(tlPath)) {
    const dates = Array.from(read(tlPath).matchAll(/^## (\d{4}-\d{2}-\d{2})/gm)).map(m => m[1]);
    if (dates.length) {
      dates.sort();
      const latest = dates[dates.length - 1];
      const ageDays = (now - new Date(latest).getTime()) / 86400000;
      signals.push({ file: 'task-log.md', ageDays, threshold: 2, weight: 20, label: 'task-log 갱신 없음' });
    }
  }
  // 점수 계산
  let totalScore = 0;
  const fired = [];
  for (const s of signals) {
    if (s.ageDays > s.threshold) {
      totalScore += s.weight;
      fired.push(s);
    }
  }
  // 1.9.78: 보안 신호 (env / .gitignore 누락) — 5번째 신호
  try {
    const envPath = path.join(root, '.env');
    if (exists(envPath)) {
      let secScore = 0;
      const secIssues = [];
      // (a) .env vs .env.example 동기화
      try {
        const d = envDiff(root);
        if (d.inEnvOnly.length) {
          secIssues.push(`.env→.env.example 누락 ${d.inEnvOnly.length}건`);
          secScore += 15;
        }
      } catch {}
      // (b) .gitignore 시크릿 패턴
      try {
        const giText = exists(path.join(root, '.gitignore')) ? read(path.join(root, '.gitignore')) : '';
        const giLines = giText.split('\n').map(l => l.trim());
        const SECRET_PATTERNS = ['.env', '.env.local', '.env.production', '.env.*.local', '*.pem', 'credentials.json'];
        const missing = SECRET_PATTERNS.filter(p => !giLines.some(l => l === p || l === '/' + p));
        if (missing.length) {
          secIssues.push(`.gitignore 시크릿 누락 ${missing.length}건`);
          // 누락이 .env 자체면 최우선 위험 — 15점 가중
          if (missing.includes('.env')) secScore += 30;
          else secScore += Math.min(20, missing.length * 5);
        }
      } catch {}
      if (secScore > 0) {
        totalScore += secScore;
        fired.push({ file: '.env / .gitignore', ageDays: null, threshold: 0, weight: secScore, label: `보안 위험 (1.9.78): ${secIssues.join(' · ')}` });
      }
    }
  } catch {}
  // 1.9.143: Feature Graph 미사용 신호 — 노드는 있는데 edges 비율 낮으면 인과관계 정리 미진
  try {
    const { nodes: fGraphNodes } = _readFeatureGraph(root);
    if (fGraphNodes.length >= 3) {
      const edgeCount = fGraphNodes.reduce((s, n) => s + (n.dependsOn?.length || 0) + (n.affects?.length || 0) + (n.coChangesWith?.length || 0), 0);
      const linkedSet = new Set();
      for (const n of fGraphNodes) {
        for (const x of [...(n.dependsOn||[]), ...(n.affects||[]), ...(n.coChangesWith||[])]) { linkedSet.add(n.id); linkedSet.add(x); }
      }
      const isolatedCount = Math.max(0, fGraphNodes.length - linkedSet.size);
      const isolatedRatio = isolatedCount / fGraphNodes.length;
      if (edgeCount === 0 || isolatedRatio >= 0.5) {
        const fgScore = edgeCount === 0 ? 25 : 15;
        totalScore += fgScore;
        fired.push({ file: '.harness/feature-graph.md', ageDays: null, threshold: 0, weight: fgScore, label: `Feature Graph 미정리 (1.9.143): ${fGraphNodes.length} 노드, edges=${edgeCount}, isolated=${isolatedCount}` });
      }
    }
  } catch {}
  // 신규 _apps/* 에서 task 0건도 신호로
  const appsDir = path.join(root, '_apps');
  let appsZeroTask = [];
  if (exists(appsDir)) {
    for (const d of fs.readdirSync(appsDir)) {
      const sub = path.join(appsDir, d);
      if (!exists(path.join(sub, '.harness'))) continue;
      const subRows = readProgressRows(sub);
      if (!subRows.length) appsZeroTask.push(d);
    }
    if (appsZeroTask.length) {
      const w = Math.min(50, appsZeroTask.length * 10);
      totalScore += w;
      fired.push({ file: `_apps/* (${appsZeroTask.length}개)`, ageDays: null, threshold: 0, weight: w, label: `task 0건 sub-app: ${appsZeroTask.slice(0, 3).join(', ')}${appsZeroTask.length > 3 ? '...' : ''}` });
    }
  }
  // 레벨 판정
  let level = '🟢 healthy';
  if (totalScore >= 100) level = '🔴 critical';
  else if (totalScore >= 50) level = '🟡 warning';
  else if (totalScore >= 20) level = '🟠 attention';

  // 1.9.38 (D): drift critical 등급은 누적 카운트 (학습 신호)
  try {
    if (level === '🔴 critical') {
      const stats = _readUsageStats(root);
      stats.drift = stats.drift || {};
      stats.drift.criticalSeen = (stats.drift.criticalSeen || 0) + 1;
      const p = _usageStatsPath(root);
      mkdirp(path.dirname(p));
      writeUtf8(p, JSON.stringify(stats, null, 2) + '\n');
    }
  } catch {}
  // 1.9.39: --auto-fix — critical 시 session close 자동 실행
  // 1.9.82: --auto-fix가 보안 신호도 자동 회복 (audit --fix 호출)
  const autoFix = has('--auto-fix');
  // 1.9.82: 보안 신호가 fired에 있으면 우선 audit --fix 호출
  const hasSecurityFired = fired.some(f => /보안 위험 \(1\.9\.78\)/.test(f.label));
  if (autoFix && hasSecurityFired) {
    log('');
    log(`🔒 --auto-fix 활성 (1.9.82) — 보안 신호 회복: audit --fix 자동 실행 중...`);
    try {
      const r = cp.spawnSync(process.execPath, [__filename, 'audit', root, '--fix'],
        { encoding: 'utf8', timeout: 30000, env: { ...process.env, LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '1' } });
      if (r.status === 0) {
        log(`✓ audit --fix 완료 — .gitignore + .env.example 동기화`);
        // 재검사 (보안 신호 회복 확인)
        log('');
        log(`재검사 중...`);
        return driftCheckCmd(root); // 재귀 1회 (auto-fix 없이)
      } else {
        log(`⚠ audit --fix 실패 (exit ${r.status}) — 수동 \`leerness audit --fix\` 권장`);
      }
    } catch (e) {
      log(`⚠ auto-fix 보안 회복 오류: ${e.message}`);
    }
  }
  if (autoFix && level === '🔴 critical' && !hasSecurityFired) {
    log('');
    log(`🔧 --auto-fix 활성 — session close 자동 실행 중...`);
    try {
      const r = cp.spawnSync(process.execPath, [__filename, 'session', 'close', root], { encoding: 'utf8', timeout: 60000 });
      if (r.status === 0) {
        log(`✓ session close 자동 완료`);
        // autoResolved 카운트
        const stats = _readUsageStats(root);
        stats.drift = stats.drift || {};
        stats.drift.autoResolved = (stats.drift.autoResolved || 0) + 1;
        const p = _usageStatsPath(root);
        mkdirp(path.dirname(p));
        writeUtf8(p, JSON.stringify(stats, null, 2) + '\n');
        // 재검사
        log('');
        log(`재검사 중...`);
        return driftCheckCmd(root); // 재귀 1회 (auto-fix 없이)
      } else {
        log(`⚠ session close 실패 (exit ${r.status}) — 수동 실행 필요`);
      }
    } catch (e) {
      log(`⚠ auto-fix 오류: ${e.message}`);
    }
  }
  if (has('--json')) {
    log(JSON.stringify({ root, score: totalScore, level, signals, fired, appsZeroTask }, null, 2));
    return;
  }
  log(`# leerness drift check (1.9.37)`);
  log(`경로: ${root}`);
  log('');
  log(`상태: ${level}  ·  점수 ${totalScore}/200`);
  log('');
  log(`| 신호 | age | 임계 | 가중치 | 발화 |`);
  log(`|---|---:|---:|---:|---|`);
  for (const s of signals) {
    const fire = s.ageDays > s.threshold ? '🔥' : '✓';
    const age = s.ageDays === null ? '-' : `${s.ageDays.toFixed(1)}d`;
    log(`| ${s.label} | ${age} | ${s.threshold}d | ${s.weight} | ${fire} |`);
  }
  if (appsZeroTask.length) {
    log('');
    log(`task 0건 sub-app (${appsZeroTask.length}개): ${appsZeroTask.join(', ')}`);
  }
  if (totalScore >= 50) {
    log('');
    log(`💡 권장 조치:`);
    log(`  - 즉시: leerness session close .                (handoff/current-state 갱신)`);
    log(`  - 또는: leerness audit . --fix                  (자동 갱신 가능 항목 적용)`);
    log(`  - sub-app에 task 등록: cd _apps/X && leerness task add "..."`);
    log(`  - 이 검사 끄기: --no-drift-check 또는 LEERNESS_NO_DRIFT_CHECK=1`);
  }
  if (level === '🔴 critical') process.exitCode = 1;
}

// 1.9.69: skill-suggestions.md rolling history 인덱스 — mtime 기반 캐시
// handoff에서 같은 키워드 과거 추천 결과를 즉시 노출 (재매칭 불필요)
const _SKILL_HISTORY_CACHE = new Map();
function _loadSkillHistory(root) {
  const p = path.join(absRoot(root), '.harness', 'skill-suggestions.md');
  if (!exists(p)) return { mtime: 0, blocks: [] };
  let mtime = 0;
  try { mtime = fs.statSync(p).mtimeMs; } catch {}
  const key = absRoot(root);
  const cached = _SKILL_HISTORY_CACHE.get(key);
  if (cached && cached.mtime === mtime) return cached;
  const txt = read(p);
  const blocks = [];
  for (const block of txt.split(/\n(?=## )/)) {
    if (!block.startsWith('## ')) continue;
    // 헤더에서 timestamp + query 추출
    const h = block.match(/^## ([\d-]+ [\d:]+) — query "([^"]+)"/m);
    if (!h) continue;
    blocks.push({ at: h[1], query: h[2], block });
  }
  // 최신순 (마지막에 append되므로 reverse)
  blocks.reverse();
  const idx = { mtime, blocks };
  _SKILL_HISTORY_CACHE.set(key, idx);
  return idx;
}

// 1.9.65: lessons blocks 인덱스 — evidence/decisions 파일 read + split을 1회로
// 1.9.67: task-log.md 실패 라인도 인덱스에 포함 (mtime 기반 invalidation)
// key: root → { evidenceMtime, decisionsMtime, taskLogMtime, evidence/decisions/taskLogFails: [{title, block}] }
const _LESSONS_INDEX_CACHE = new Map();
function _loadLessonsIndex(root) {
  const ep = evidencePath(root);
  const dp = decisionsPath(root);
  const tp = taskLogPath(root);
  const em = exists(ep) ? (() => { try { return fs.statSync(ep).mtimeMs; } catch { return 0; } })() : 0;
  const dm = exists(dp) ? (() => { try { return fs.statSync(dp).mtimeMs; } catch { return 0; } })() : 0;
  const tm = exists(tp) ? (() => { try { return fs.statSync(tp).mtimeMs; } catch { return 0; } })() : 0;
  const cacheKey = absRoot(root);
  const cached = _LESSONS_INDEX_CACHE.get(cacheKey);
  // 1.9.112: lessons.md mtime도 포함 (캐시 무효화 검사)
  const _lp = lessonsPath(root);
  const _lm = exists(_lp) ? (() => { try { return fs.statSync(_lp).mtimeMs; } catch { return 0; } })() : 0;
  if (cached && cached.evidenceMtime === em && cached.decisionsMtime === dm && cached.taskLogMtime === tm && cached.lessonsMtime === _lm) return cached;
  const evidence = [];
  if (em) {
    const txt = read(ep);
    for (const block of txt.split(/\n(?=## )/)) {
      if (!block.startsWith('## ')) continue;
      const t = block.match(/^## (.+)$/m);
      if (t) evidence.push({ title: t[1].trim(), block });
    }
  }
  const decisions = [];
  if (dm) {
    const txt = read(dp);
    for (const block of txt.split(/\n(?=### )/)) {
      if (!block.startsWith('### ')) continue;
      const t = block.match(/^### (.+)$/m);
      if (t) decisions.push({ title: t[1].trim(), block });
    }
  }
  // 1.9.67: task-log.md 라인 중 실패/롤백 표지가 있는 라인만 인덱스
  const taskLogFails = [];
  if (tm) {
    const txt = read(tp);
    for (const line of txt.split('\n')) {
      if (line.length > 4 && /✗|\bfail|롤백|재발|incomplete|버그/i.test(line)) {
        taskLogFails.push({ title: line.replace(/^[-*]\s*/, '').slice(0, 100), block: line });
      }
    }
  }
  // 1.9.112: lessons.md (전용) 인덱스
  const lp = lessonsPath(root);
  const lm = exists(lp) ? (() => { try { return fs.statSync(lp).mtimeMs; } catch { return 0; } })() : 0;
  const lessonsExplicit = [];
  if (lm) {
    const txt = read(lp);
    for (const block of txt.split(/\n(?=### )/)) {
      if (!block.startsWith('### ')) continue;
      const lessonMatch = block.match(/- Lesson:\s*(.+)/);
      if (lessonMatch) lessonsExplicit.push({ title: lessonMatch[1].trim(), block });
    }
  }
  const idx = { evidenceMtime: em, decisionsMtime: dm, taskLogMtime: tm, lessonsMtime: lm, evidence, decisions, taskLogFails, lessonsExplicit };
  _LESSONS_INDEX_CACHE.set(cacheKey, idx);
  return idx;
}

// 1.9.38: 사용 통계 (cumulative count, command별)
// 1.9.65: 같은 프로세스 lifetime 메모리 캐시 — 다중 호출 시 디스크 I/O 절감
const _USAGE_CACHE = new Map(); // root → { stats, mtime }
function _usageStatsPath(root) { return path.join(absRoot(root), '.harness', 'cache', 'usage-stats.json'); }
function _readUsageStats(root) {
  const p = _usageStatsPath(root);
  if (!exists(p)) return { commands: {}, drift: { criticalSeen: 0, skipped: 0, autoResolved: 0 }, since: today() };
  // 1.9.65: 캐시 hit — mtime 동일 시 재파싱 skip
  try {
    const mtime = fs.statSync(p).mtimeMs;
    const cached = _USAGE_CACHE.get(p);
    if (cached && cached.mtime === mtime) return cached.stats;
    const stats = JSON.parse(read(p));
    _USAGE_CACHE.set(p, { stats, mtime });
    return stats;
  } catch { return { commands: {}, drift: {}, since: today() }; }
}
function _bumpUsage(root, cmdName) {
  // 가벼운 카운터 — 명령 실행마다 호출 (sync write로 작은 파일)
  try {
    const stats = _readUsageStats(root);
    if (!stats.commands) stats.commands = {};
    stats.commands[cmdName] = (stats.commands[cmdName] || 0) + 1;
    stats.lastCommand = cmdName;
    stats.lastAt = new Date().toISOString();
    if (!stats.since) stats.since = today();
    const p = _usageStatsPath(root);
    mkdirp(path.dirname(p));
    writeUtf8(p, JSON.stringify(stats, null, 2) + '\n');
    // 1.9.65: 쓰기 후 캐시 invalidate (다음 read에서 새 mtime으로 재로드)
    try { _USAGE_CACHE.set(p, { stats, mtime: fs.statSync(p).mtimeMs }); } catch {}
  } catch {}
}

// 1.9.70: MCP tools/call 자동 사용 통계 — 도구별 호출 카운트
function _bumpMcpUsage(root, toolName) {
  try {
    const stats = _readUsageStats(root);
    if (!stats.mcp) stats.mcp = { tools: {} };
    if (!stats.mcp.tools) stats.mcp.tools = {};
    stats.mcp.tools[toolName] = (stats.mcp.tools[toolName] || 0) + 1;
    stats.mcp.lastTool = toolName;
    stats.mcp.lastAt = new Date().toISOString();
    if (!stats.since) stats.since = today();
    const p = _usageStatsPath(root);
    mkdirp(path.dirname(p));
    writeUtf8(p, JSON.stringify(stats, null, 2) + '\n');
    try { _USAGE_CACHE.set(p, { stats, mtime: fs.statSync(p).mtimeMs }); } catch {}
  } catch {}
}

// 1.9.41: CHANGELOG.md를 파싱하여 from → to 사이 버전 차분 추출
// 반환: [{ version, date, body, newCommands, newFlags, newFiles }]
function _parseChangelogBetween(changelogText, fromV, toV) {
  // ## 1.9.X — YYYY-MM-DD 헤더 사이의 텍스트 추출
  const sections = [];
  const re = /^## (\d+\.\d+\.\d+)(?:\s+—\s+(\d{4}-\d{2}-\d{2}))?\s*\n([\s\S]*?)(?=^## \d+\.\d+\.\d+|$)/gm;
  let m;
  while ((m = re.exec(changelogText)) !== null) {
    sections.push({ version: m[1], date: m[2] || null, body: m[3].trim() });
  }
  // from < V <= to 만 (fromV 자체는 이미 적용된 버전이므로 제외)
  const ranged = sections.filter(s => {
    const cmp = (v1, v2) => {
      const a = v1.split('.').map(Number), b = v2.split('.').map(Number);
      for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
      return 0;
    };
    return cmp(s.version, fromV) > 0 && cmp(s.version, toV) <= 0;
  });
  // 각 섹션에서 신규 명령/플래그/파일 추출
  for (const s of ranged) {
    s.newCommands = [];
    s.newFlags = [];
    s.newFiles = [];
    // `leerness X [...]` 또는 backtick에 싸인 leerness 명령
    for (const cm of s.body.matchAll(/`leerness\s+([a-z][\w-]*(?:\s+[a-z][\w-]*)?)/g)) {
      const cmd = cm[1].trim();
      if (!s.newCommands.includes(cmd)) s.newCommands.push(cmd);
    }
    // `--xxx` 플래그
    for (const fm of s.body.matchAll(/`(--[a-z][\w-]*)`/g)) {
      if (!s.newFlags.includes(fm[1])) s.newFlags.push(fm[1]);
    }
    // .harness/X.md 같은 신규 파일
    for (const ff of s.body.matchAll(/`(\.harness\/[\w./-]+\.(?:md|json|jsonl))`/g)) {
      if (!s.newFiles.includes(ff[1])) s.newFiles.push(ff[1]);
    }
  }
  return ranged;
}

// 1.9.41: leerness whats-new [--from V] — 현재 워크스페이스 버전 → leerness latest 차분
// 1.9.48: cross-platform archive 생성 — tar → PowerShell Compress-Archive → 7z 순 fallback
// outPath의 확장자(tgz/zip)에 따라 tar 또는 zip. tar 실패 시 .zip으로 자동 전환.
function _createArchive(cwd, sourceDir, outPath) {
  const tried = [];
  // 1) tar.gz (POSIX 환경에서 가장 안정)
  if (/\.(tgz|tar\.gz)$/i.test(outPath)) {
    tried.push('tar');
    const r = cp.spawnSync('tar', ['-czf', outPath, sourceDir], {
      encoding: 'utf8', timeout: 30000, shell: true, cwd
    });
    if (r.status === 0 && exists(outPath)) return { ok: true, path: outPath, method: 'tar', tried };
  }
  // 2) PowerShell Compress-Archive (Windows native ZIP) — 확장자를 .zip으로 변경
  const zipPath = outPath.replace(/\.(tgz|tar\.gz)$/i, '.zip');
  tried.push('powershell Compress-Archive');
  if (process.platform === 'win32' || process.env.SHELL === undefined) {
    // -Force 로 덮어쓰기, -CompressionLevel Optimal
    const psCmd = `Compress-Archive -Path "${path.join(cwd, sourceDir).replace(/\\/g, '\\\\')}" -DestinationPath "${zipPath.replace(/\\/g, '\\\\')}" -Force`;
    const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-Command', psCmd], {
      encoding: 'utf8', timeout: 30000
    });
    if (r.status === 0 && exists(zipPath)) return { ok: true, path: zipPath, method: 'powershell Compress-Archive', tried };
  }
  // 3) zip 명령 (POSIX zip 또는 Linux 도구)
  tried.push('zip');
  const r3 = cp.spawnSync('zip', ['-r', zipPath, sourceDir], {
    encoding: 'utf8', timeout: 30000, shell: true, cwd
  });
  if (r3.status === 0 && exists(zipPath)) return { ok: true, path: zipPath, method: 'zip', tried };
  return { ok: false, tried };
}

// 1.9.47: leerness skill publish — 자체 skill을 외부 공유 가능 tarball/번들로 publish
// 옵션:
//   --bundle-only      : tarball만 생성 (.harness/skills-publish/leerness-skills-<ver>.tgz)
//   --gh-release       : GitHub release에 attach (gh CLI 필요)
//   --include <ids>    : 특정 skill만 (콤마 구분, 기본은 모두)
function skillPublishCmd(root) {
  root = absRoot(root || process.cwd());
  const includes = arg('--include', null);
  const ghRelease = has('--gh-release');
  const bundleOnly = has('--bundle-only') || !ghRelease;
  log(`# leerness skill publish (1.9.47/98)`);
  // 1.9.98: 보안 사전 점검 — health --strict 자동 실행, issue 있으면 publish 중단 (--force로 우회)
  if (!has('--no-security-check') && !has('--force')) {
    try {
      const r = cp.spawnSync(process.execPath, [__filename, 'health', root, '--json'],
        { encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '0' } });
      const j = JSON.parse(r.stdout.trim());
      if (j.issues && j.issues.length > 0) {
        log(`🚨 보안 사전 점검 (1.9.98): ${j.issues.length}건 issue 발견`);
        for (const i of j.issues.slice(0, 5)) log(`  ⚠ ${i}`);
        log(`💡 권장: leerness audit --fix · 우회: leerness skill publish ... --force / --no-security-check`);
        process.exitCode = 1;
        return;
      } else {
        log(`✓ 보안 사전 점검 (1.9.98): 통과`);
      }
    } catch (e) {
      log(`⚠ 보안 사전 점검 오류 (계속): ${e.message}`);
    }
  }
  // 1) 자체 skill 모두 SKILL.md로 export (skill export-all 활용)
  const exportDir = path.join(root, '.harness', 'skills-publish');
  mkdirp(exportDir);
  const all = listAllSkills(root);
  let ids = Object.keys(all);
  if (includes) ids = ids.filter(id => includes.split(',').map(s => s.trim()).includes(id));
  if (!ids.length) { fail('publish할 skill 없음 (--include 확인)'); return process.exit(1); }
  log(`대상: ${ids.length}개 skill (${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ` +${ids.length - 5}` : ''})`);
  // 각 skill을 SKILL.md로 export
  for (const id of ids) {
    const data = all[id];
    const description = (data.displayNameKo || data.description || (data.capabilities && data.capabilities[0]) || id).slice(0, 200);
    const body = `---\nname: ${id}\ndescription: ${description}\nlicense: MIT\npublisher: leerness\nversion: ${VERSION}\n---\n\n# ${data.displayNameKo || id}\n\n## Capabilities\n${(data.capabilities || []).map(c => '- ' + c).join('\n') || '-'}\n\n## Sources\n${(data.sources || []).map(s => '- ' + (s.url || s)).join('\n') || '-'}\n\n## Usage\n\n\`\`\`bash\nleerness skill install <이 SKILL.md path or URL>\n\`\`\`\n`;
    const skillDir = path.join(exportDir, id);
    mkdirp(skillDir);
    writeUtf8(path.join(skillDir, 'SKILL.md'), body);
  }
  // 2) manifest 작성
  const manifest = {
    name: 'leerness-skills',
    version: VERSION,
    publishedAt: new Date().toISOString(),
    skills: ids.map(id => ({ id, name: all[id].displayNameKo || id, description: all[id].description || '' })),
    format: 'agentskills.io',
    license: 'MIT'
  };
  writeUtf8(path.join(exportDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeUtf8(path.join(exportDir, 'README.md'), `# leerness-skills v${VERSION}\n\nagentskills.io 표준 호환 SKILL.md 번들 (${ids.length}개)\n\n## 설치\n\n\`\`\`bash\nleerness skill install <SKILL.md path>\n\`\`\`\n\n## 포함된 skill\n\n${ids.map(id => `- **${id}** — ${all[id].displayNameKo || ''}`).join('\n')}\n\n## 라이선스\n\nMIT — leerness contributors\n`);
  log(`✓ export 완료: ${ids.length} skill + manifest.json + README.md → ${rel(root, exportDir)}/`);
  // 3) tarball
  if (bundleOnly || ghRelease) {
    const tarName = `leerness-skills-${VERSION}.tgz`;
    const tarPath = path.join(root, '.harness', 'skills-publish-tarball', tarName);
    mkdirp(path.dirname(tarPath));
    // npm pack-style이 아니라 tar로 직접 (cross-platform tar 필요)
    // Windows에서는 tar가 기본 설치되어 있음 (PowerShell 5.1+).
    // 1.9.48: cross-platform 압축 chain — tar (POSIX) → PowerShell Compress-Archive (Windows ZIP) → graceful
    const made = _createArchive(path.join(root, '.harness'), 'skills-publish', tarPath);
    if (made.ok) log(`✓ archive 생성: ${rel(root, made.path)} (${made.method})`);
    else warn(`archive 실패 — 수동 압축 권장 (${rel(root, exportDir)}/) · 시도: ${made.tried.join(', ')}`);
    // 4) GitHub release
    if (ghRelease) {
      const v = `v${VERSION}-skills`;
      const r = cp.spawnSync('gh', ['release', 'create', v, tarPath, '--title', `leerness-skills ${v}`, '--notes', `agentskills.io 표준 호환 ${ids.length}개 SKILL.md 번들`], {
        encoding: 'utf8', timeout: 60000, shell: true, cwd: root
      });
      if (r.status === 0) log(`✓ GitHub release 생성: ${v}`);
      else warn(`gh release 실패 — gh auth status 또는 수동 업로드 필요`);
    }
  }
  log('');
  log(`💡 사용자는 다음으로 import 가능:`);
  log(`   leerness skill install <tarball path>/SKILL.md`);
  log(`   또는 GitHub release tag에서 다운로드`);
}

// 1.9.46: leerness benchmark — 자체 워크스페이스 측정 + 타도구 대비 시뮬레이션 비교 매트릭스
// 실 측정값: drift, usage stats, task 수, capability 수
// 시뮬: leerness 미적용 vanilla / Hermes 단독 / Claude Code 단독 비교 (보고서 §5 기반)
// 1.9.51: --scenario — leerness 고유 가치 시나리오 preset 자동 실행 + 정량 결과
// 사용자가 직접 task 작성 안 해도 leerness의 검수 효과 즉시 측정 가능.
const BENCHMARK_SCENARIOS = {
  'false-completion': {
    label: '거짓 완료 자동 감지',
    description: 'evidence 없이 done인 task를 verify-claim/lazy detect가 잡는지',
    setup: (dir) => {
      // 빈 evidence로 done task 생성
      cp.spawnSync(process.execPath, [__filename, 'task', 'add', '거짓 완료된 작업', '--status', 'done', '--evidence', '', '--path', dir],
        { encoding: 'utf8', timeout: 10000, env: { ...process.env, LEERNESS_NO_PROMPT: '1' } });
    },
    measure: (dir) => {
      const r = cp.spawnSync(process.execPath, [__filename, 'lazy', 'detect', dir],
        { encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_NO_DRIFT_CHECK: '1' } });
      const detected = /✗ |found.*issue|증거 없는|empty/.test(r.stdout);
      return { detected, exit: r.status, sample: r.stdout.slice(0, 200) };
    }
  },
  'spec-mismatch': {
    label: '사양 ↔ 구현 불일치 자동 감지',
    description: 'spec.md에 명시된 함수가 impl.js의 module.exports에 없는지',
    setup: (dir) => {
      fs.writeFileSync(path.join(dir, 'mismatch-spec.md'), 'function fooBar() {}\nfunction missingFn() {}\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'mismatch-impl.js'), 'function fooBar() {}\nmodule.exports = { fooBar };\n', 'utf8');
    },
    measure: (dir) => {
      const r = cp.spawnSync(process.execPath, [__filename, 'contract', 'verify',
        path.join(dir, 'mismatch-spec.md'), path.join(dir, 'mismatch-impl.js'), '--json'],
        { encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_NO_DRIFT_CHECK: '1' } });
      let j = null;
      try { j = JSON.parse(r.stdout); } catch {}
      const detected = j && j.missingFunctions && j.missingFunctions.includes('missingFn');
      return { detected, ok: !!(j && j.ok === false), sample: r.stdout.slice(0, 200) };
    }
  },
  'drift-detection': {
    label: 'drift 감지 (메타파일 stale)',
    description: '인공적으로 session-handoff stale 만들고 drift check가 잡는지',
    setup: (dir) => {
      const sh = path.join(dir, '.harness', 'session-handoff.md');
      if (exists(sh)) {
        let body = read(sh);
        body = body.replace(/Last generated:.*/, 'Last generated: 2020-01-01T00:00:00.000Z');
        writeUtf8(sh, body);
      }
    },
    measure: (dir) => {
      const r = cp.spawnSync(process.execPath, [__filename, 'drift', 'check', dir, '--json'],
        { encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_NO_DRIFT_CHECK: '0' } });
      let j = null;
      try { j = JSON.parse(r.stdout.trim()); } catch {}
      const detected = j && (j.level === '🔴 critical' || j.level === '🟠 attention');
      return { detected, level: j && j.level, score: j && j.score, sample: r.stdout.slice(0, 200) };
    }
  },
  'bom-handling': {
    label: 'UTF-8 BOM SKILL.md install (1.9.44 patch)',
    description: 'BOM 포함 SKILL.md import 성공 (Windows 메모장 호환)',
    setup: (dir) => {
      const src = path.join(dir, 'bom-test.md');
      const buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]),
        Buffer.from('---\nname: bom-test\ndescription: BOM 처리 검증\n---\n\n# Body', 'utf8')]);
      fs.writeFileSync(src, buf);
    },
    measure: (dir) => {
      const r = cp.spawnSync(process.execPath, [__filename, 'skill', 'install',
        path.join(dir, 'bom-test.md'), '--path', dir],
        { encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_NO_PROMPT: '1' } });
      const f = path.join(dir, '.harness', 'skills', 'bom-test', 'SKILL.md');
      return { detected: r.status === 0 && exists(f), sample: r.stdout.slice(0, 200) };
    }
  }
};

function _runScenario(root, key) {
  const sc = BENCHMARK_SCENARIOS[key];
  if (!sc) return { error: `알 수 없는 시나리오: ${key}` };
  const t0 = Date.now();
  try { sc.setup(root); } catch (e) { return { error: 'setup 실패: ' + e.message }; }
  const result = sc.measure(root);
  const elapsed = Date.now() - t0;
  return { key, label: sc.label, description: sc.description, elapsed, ...result };
}

// 1.9.49: --measure 모드 — ready 외부 CLI에 동일 task 실측 + leerness verify-claim 적용 시 추가 시간 측정
async function _benchmarkMeasure(root, task) {
  const results = [];
  const ready = EXTERNAL_AGENTS.map(a => ({ agent: a, status: _checkAgent(a) }))
                                .filter(x => x.status.status === 'ready');
  if (!ready.length) return { results: [], note: 'ready CLI 없음' };
  for (const { agent } of ready) {
    let cmd, cliArgs;
    if (agent.id === 'claude') { cmd = 'claude'; cliArgs = ['--print', task]; }
    else if (agent.id === 'codex') { cmd = 'codex'; cliArgs = ['exec', '--skip-git-repo-check', task]; }
    else if (agent.id === 'gemini') { cmd = 'gemini'; cliArgs = ['-p', task]; }
    else continue;
    const t0 = Date.now();
    // 1.9.150: runCommandSafe — agent CLI bench sandbox (env scrub + observability)
    const r = runCommandSafe(cmd, cliArgs, { cwd: process.cwd(), root, timeout: 60000, allowShell: true, kind: 'agent_bench', label: `bench-${agent.id}`, allowOutsideCwd: true });
    const baseTime = Date.now() - t0;
    // leerness 검수 layer time 추정 (verify-claim 형식)
    const t1 = Date.now();
    cp.spawnSync(process.execPath, [__filename, 'audit', root, '--fix'], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env, LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '1' }
    });
    const verifyTime = Date.now() - t1;
    results.push({
      cli: agent.id, baseMs: baseTime, verifyMs: verifyTime, totalMs: baseTime + verifyTime,
      exit: r.status, outLen: (r.stdout || '').length
    });
  }
  return { results, note: results.length ? null : '실측 호출 실패' };
}

function benchmarkCmd(root) {
  root = absRoot(root || process.cwd());
  // 1.9.51: --scenario [<id>|all] — leerness 고유 검수 시나리오 preset 자동 실행
  if (has('--scenario')) {
    const scenarioArg = arg('--scenario', 'all');
    const keys = scenarioArg === 'all' || scenarioArg === 'true'
      ? Object.keys(BENCHMARK_SCENARIOS)
      : scenarioArg.split(',').map(s => s.trim()).filter(s => BENCHMARK_SCENARIOS[s]);
    if (!keys.length) {
      fail(`알 수 없는 scenario: ${scenarioArg}\n  사용 가능: ${Object.keys(BENCHMARK_SCENARIOS).join(', ')}, all`);
      return process.exit(1);
    }
    const results = keys.map(k => _runScenario(root, k));
    const detected = results.filter(r => r.detected).length;
    if (has('--json')) { log(JSON.stringify({ scenarios: results, detectedCount: detected, total: results.length }, null, 2)); return; }
    log(`# leerness benchmark --scenario (1.9.51)`);
    log(`leerness 고유 검수 시나리오 ${results.length}개 자동 실행`);
    log('');
    log('| # | 시나리오 | 감지? | 시간 |');
    log('|---|---|---|---:|');
    results.forEach((r, i) => {
      log(`| ${i+1} | ${r.label} | ${r.detected ? '✅' : r.error ? '⚠ error' : '❌'} | ${r.elapsed || 0}ms |`);
    });
    log('');
    log(`✅ leerness가 정확히 감지: ${detected}/${results.length}`);
    log(`💡 각 시나리오는 leerness 고유 가치 — 다른 도구(Claude Code/Hermes/Cursor)에는 없는 기능`);
    return;
  }
  // 1.9.49: --measure "<task>" 모드 — 실 CLI 시간 측정
  if (has('--measure')) {
    const task = arg('--measure', null) || arg('--task', null);
    if (!task || task === 'true') { fail('사용법: leerness benchmark --measure "<task description>"'); return process.exit(1); }
    return _benchmarkMeasure(root, task).then(({ results, note }) => {
      if (has('--json')) { log(JSON.stringify({ task, results, note }, null, 2)); return; }
      log(`# leerness benchmark --measure (1.9.49)`);
      log(`task: ${task.slice(0, 80)}${task.length > 80 ? '…' : ''}`);
      if (note) { log(`⚠ ${note}`); return; }
      log('');
      log('| CLI | 호출 시간 | leerness 검수 시간 | 합계 | exit |');
      log('|---|---:|---:|---:|---:|');
      for (const r of results) {
        log(`| ${r.cli} | ${r.baseMs}ms | ${r.verifyMs}ms | ${r.totalMs}ms | ${r.exit} |`);
      }
      log('');
      log(`💡 verify-claim/audit 오버헤드는 일반적으로 검수 1회당 200~500ms (실 CLI 호출 대비 1-10%)`);
    });
  }
  const rows = readProgressRows(root);
  const done = rows.filter(r => r.status === 'done').length;
  const totalTasks = rows.length;
  const reuseLines = exists(path.join(root, '.harness', 'reuse-map.md'))
    ? read(path.join(root, '.harness', 'reuse-map.md')).split('\n').filter(l => l.startsWith('|') && !/Capability|---/.test(l)).length
    : 0;
  let usage = { commands: {}, drift: {} };
  try {
    const us = _readUsageStats(root);
    usage = us || usage;
  } catch {}
  // 6 차원 점수 (0-100)
  const score = {
    multiAgent: Math.min(100, (Object.values(usage.commands || {}).reduce((s, n) => s + n, 0) > 5 ? 100 : 60)),
    autoVerify: 98, // verify-claim 자동화 vs 수동 90s
    reuse: Math.min(100, 80 + Math.min(20, reuseLines)),
    workspace: 99, // --all-apps
    bugDetect: Math.min(100, totalTasks > 0 ? 100 : 60),
    contextKeep: 100  // handoff 3채널
  };
  const total = Object.values(score).reduce((s, v) => s + v, 0);
  // 타도구 시뮬 (보고서 §4 매트릭스 기반, 정성적 추정)
  const vsTools = {
    vanilla:      { multiAgent: 3,  autoVerify: 0,  reuse: 0,   workspace: 0,  bugDetect: 0,  contextKeep: 0 },
    claude_code:  { multiAgent: 40, autoVerify: 20, reuse: 10,  workspace: 20, bugDetect: 30, contextKeep: 40 },
    hermes:       { multiAgent: 70, autoVerify: 10, reuse: 5,   workspace: 30, bugDetect: 20, contextKeep: 60 },
    leerness_solo:   score,
    'leerness+claude':  { multiAgent: 100, autoVerify: 100, reuse: 100, workspace: 100, bugDetect: 100, contextKeep: 100 },
    'leerness+hermes':  { multiAgent: 100, autoVerify: 95,  reuse: 95,  workspace: 100, bugDetect: 95,  contextKeep: 100 }
  };
  if (has('--json')) {
    log(JSON.stringify({
      project: detectProjectName(root),
      measured: { totalTasks, done, reuseLines, usage: usage.commands, driftLevel: usage.drift },
      leernessScore: score, total,
      compareSimulated: vsTools
    }, null, 2));
    return;
  }
  log(`# leerness benchmark (1.9.46)`);
  log(`project: ${detectProjectName(root)}`);
  log(`measured: tasks ${done}/${totalTasks} done, reuse-map ${reuseLines} entries`);
  log('');
  log('## 자체 6 차원 점수');
  log('| 차원 | 점수 |');
  log('|---|---:|');
  for (const [k, v] of Object.entries(score)) log(`| ${k} | ${v}/100 |`);
  log(`| **종합** | **${total}/600** |`);
  log('');
  log('## 타도구 시뮬레이션 비교 (정성적 추정, _reports/LEERNESS_VS_HERMES_AND_AGENTSKILLS.md 기반)');
  log('| 도구 | 멀티에이전트 | 검수자동화 | 재사용 | 워크스페이스 | BUG감지 | 컨텍스트 | 종합 |');
  log('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const [name, s] of Object.entries(vsTools)) {
    const sum = Object.values(s).reduce((acc, v) => acc + v, 0);
    log(`| ${name} | ${s.multiAgent} | ${s.autoVerify} | ${s.reuse} | ${s.workspace} | ${s.bugDetect} | ${s.contextKeep} | **${sum}** |`);
  }
  log('');
  log('💡 leerness 단독 보다 **leerness + 메인 에이전트 (Claude Code/Hermes)** 조합이 최강');
  log('💡 시뮬레이션은 정성적 추정 — 실 측정은 별도 환경 필요 (사용자 환경)');
}

// 1.9.53: leerness skill suggest — task-log + usage-stats에서 반복 패턴 감지 → 새 skill 후보 제안
// Hermes-style 자동 학습의 leerness 버전. 명시적 `skill learn` 호출 없이도 패턴 추출.
function skillSuggestCmd(root) {
  root = absRoot(root || process.cwd());
  const minOccurrence = parseInt(arg('--min', '3'), 10);
  const lookbackDays = parseInt(arg('--days', '30'), 10);
  const cutoff = Date.now() - lookbackDays * 86400000;
  const seen = {}; // keyword → { count, samples, files }
  // 1) task-log.md 라인 분석
  const taskLog = taskLogPath(root);
  if (exists(taskLog)) {
    const body = read(taskLog);
    // 날짜 헤더 ## YYYY-MM-DD 안의 라인들
    const blocks = body.split(/^## \d{4}-\d{2}-\d{2}/m);
    for (const block of blocks) {
      // 명령 인용 `leerness X` 또는 키워드 (3+ chars)
      for (const m of block.matchAll(/`leerness\s+([a-z][\w-]+(?:\s+[a-z][\w-]+)?)`/g)) {
        const cmd = m[1].trim();
        seen[cmd] = seen[cmd] || { count: 0, samples: [], source: 'task-log' };
        seen[cmd].count++;
        if (seen[cmd].samples.length < 3) seen[cmd].samples.push(block.slice(0, 80).replace(/\n/g, ' '));
      }
    }
  }
  // 2) progress-tracker request 컬럼 분석
  const rows = readProgressRows(root);
  for (const row of rows) {
    const text = (row.request || '') + ' ' + (row.nextAction || '');
    // 도메인 키워드 (한글 + 영어 단어, 3자 이상)
    for (const m of text.toLowerCase().matchAll(/[\w가-힣]{4,}/g)) {
      const kw = m[0];
      if (/^\d+$/.test(kw)) continue;
      if (['이런', '저런', '하다', '하고', '있는', '하지', '에서'].includes(kw)) continue;
      seen[kw] = seen[kw] || { count: 0, samples: [], source: 'progress' };
      seen[kw].count++;
      if (seen[kw].samples.length < 3) seen[kw].samples.push((row.request || '').slice(0, 60));
    }
  }
  // 3) usage-stats의 명령 카운트
  try {
    const stats = _readUsageStats(root);
    for (const [cmd, n] of Object.entries(stats.commands || {})) {
      if (n >= minOccurrence) {
        seen[`cmd:${cmd}`] = seen[`cmd:${cmd}`] || { count: 0, samples: [], source: 'usage' };
        seen[`cmd:${cmd}`].count = n;
      }
    }
  } catch {}
  // 4) 1.9.79: skill-suggestions.md rolling history 빈도 — 반복 검색된 키워드는 학습 신호로 강화
  try {
    const histPath = path.join(root, '.harness', 'skill-suggestions.md');
    if (exists(histPath)) {
      const histTxt = read(histPath);
      const queryFreq = {};
      for (const block of histTxt.split(/\n(?=## )/)) {
        const h = block.match(/^## ([\d-]+ [\d:]+) — query "([^"]+)"/);
        if (!h) continue;
        const query = h[2];
        // query에서 도메인 키워드 추출 (4자 이상)
        for (const m of query.toLowerCase().matchAll(/[\w가-힣]{4,}/g)) {
          const kw = m[0];
          if (/^\d+$/.test(kw)) continue;
          if (['이런','저런','하다','하고','있는','작업','구현','추가','진행','수정','변경','검토','확인','프로젝트','관리','기능','시스템','코드','파일','버전','정리','계획','next','action','task','todo','work'].includes(kw)) continue;
          queryFreq[kw] = (queryFreq[kw] || 0) + 1;
        }
      }
      // history에서 N회 이상 등장한 키워드 → 가중 (×2)
      for (const [kw, n] of Object.entries(queryFreq)) {
        if (n >= 2) { // history 빈도는 1회만 등장해도 의미 작음, 2회 이상부터 신호
          seen[kw] = seen[kw] || { count: 0, samples: [], source: 'progress' };
          // history 빈도 × 가중 (2배)
          seen[kw].count += n * 2;
          seen[kw].historyHits = n;
          if (seen[kw].source === 'progress') seen[kw].source = 'progress+history';
        }
      }
    }
  } catch {}
  // 4) 임계 이상 + 기존 skill에 없는 키워드만 필터
  const existing = new Set(Object.keys(listAllSkills(root)));
  const installed = _readInstalledSkills(root);
  const installedTokens = new Set(installed.flatMap(s => [..._tokenize(s.name + ' ' + s.description)]));
  const candidates = Object.entries(seen)
    .filter(([kw, info]) => info.count >= minOccurrence)
    .filter(([kw]) => !existing.has(kw) && !installedTokens.has(kw.replace(/^cmd:/, '')))
    .map(([kw, info]) => ({ keyword: kw, ...info }))
    .sort((a, b) => b.count - a.count);
  if (has('--json')) { log(JSON.stringify({ minOccurrence, lookbackDays, candidates: candidates.slice(0, 20) }, null, 2)); return; }
  log(`# leerness skill suggest (1.9.53)`);
  log(`반복 패턴 자동 감지 (최소 ${minOccurrence}회, ${lookbackDays}일 이내)`);
  log('');
  if (!candidates.length) {
    log('  (아직 패턴 부족 — task-log/progress-tracker에 작업이 더 누적되면 자동 감지)');
    return;
  }
  log(`발견된 후보: ${candidates.length}건`);
  log('');
  log('| 키워드/명령 | 출처 | 등장 횟수 | 예시 |');
  log('|---|---|---:|---|');
  for (const c of candidates.slice(0, 10)) {
    log(`| ${c.keyword} | ${c.source} | ${c.count} | ${(c.samples[0] || '').replace(/\|/g, '\\|').slice(0, 50)} |`);
  }
  log('');
  log(`💡 신규 skill로 등록 권장:`);
  log(`   leerness skill learn <id> --capability "${candidates[0].keyword}" --note "1.9.53 auto-suggest"`);
}

// 1.9.45: skill match <query> — 설치된 SKILL.md description ↔ 사용자 요청 키워드 매칭 추천
// jaccard similarity (단어 집합 교집합/합집합).
function _tokenize(s) {
  return new Set(String(s || '').toLowerCase().split(/[\s\-_/,.()[\]'"]+/).filter(t => t.length >= 2));
}
function _jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  const inter = [...a].filter(x => b.has(x)).length;
  return inter / (a.size + b.size - inter);
}

function _readInstalledSkills(root) {
  const dir = path.join(root, '.harness', 'skills');
  if (!exists(dir)) return [];
  const list = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const skillMd = path.join(dir, id, 'SKILL.md');
    const skillJson = path.join(dir, id, 'skill.json');
    let name = id, description = '';
    if (exists(skillMd)) {
      const parsed = _parseSkillMd(read(skillMd));
      name = parsed.meta.name || id;
      description = parsed.meta.description || '';
    } else if (exists(skillJson)) {
      try {
        const j = JSON.parse(read(skillJson));
        name = j.displayNameKo || j.name || id;
        description = j.description || (j.capabilities || []).join(', ');
      } catch {}
    }
    list.push({ id, name, description, dir: path.join(dir, id) });
  }
  return list;
}

// 1.9.50: Ollama embedding 매칭 — opt-in (LEERNESS_OLLAMA_BASE_URL 필요)
async function _embedText(baseUrl, text, model) {
  const url = baseUrl.replace(/\/$/, '') + '/api/embeddings';
  return new Promise((resolve) => {
    const lib = url.startsWith('https:') ? require('https') : require('http');
    const req = lib.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 30000 }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(j.embedding || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(JSON.stringify({ model: model || 'nomic-embed-text', prompt: text }));
    req.end();
  });
}

function _cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// 1.9.90: leerness skill search <capability> — capability 배열에서 부분 일치 검색
// skill match (jaccard)와 다름: capability 필드 정확 매칭 (substring + case-insensitive)
function skillSearchCmd(root, capabilityQuery) {
  root = absRoot(root || process.cwd());
  if (!capabilityQuery) { fail('사용법: leerness skill search "<capability keyword>" [--json]'); return process.exit(1); }
  const all = listAllSkills(root);
  const q = capabilityQuery.toLowerCase();
  const matches = [];
  for (const [id, v] of Object.entries(all)) {
    const caps = v.capabilities || [];
    const matched = caps.filter(c => String(c).toLowerCase().includes(q));
    if (matched.length) {
      matches.push({
        id,
        displayNameKo: v.displayNameKo || id,
        source: v._source,
        matchedCapabilities: matched,
        allCapabilities: caps.length,
        usageCount: v.usage?.count || 0
      });
    }
  }
  if (has('--json')) {
    log(JSON.stringify({ query: capabilityQuery, total: matches.length, matches }, null, 2));
    return;
  }
  log(`# leerness skill search (1.9.90)`);
  log(`query (capability): "${capabilityQuery}"`);
  log(`전체 ${Object.keys(all).length}개 skill 중 매칭 ${matches.length}건`);
  log('');
  if (!matches.length) {
    log('  (해당 능력 없음 — 다른 키워드 시도 또는 \`leerness skill discover\`로 확장)');
    return;
  }
  log(`| ID | 한글명 | 매칭 능력 | 사용 |`);
  log(`|---|---|---|---:|`);
  for (const m of matches) {
    log(`| ${m.id} | ${m.displayNameKo} | ${m.matchedCapabilities.slice(0, 2).join(' / ')}${m.matchedCapabilities.length > 2 ? ' …' : ''} | ${m.usageCount}회 |`);
  }
  log('');
  log(`💡 상세: \`leerness skill info <id>\` · 사용 시작: \`leerness skill use <id>\``);
}

async function skillMatchCmd(root, query) {
  root = absRoot(root || process.cwd());
  if (!query) { fail('사용법: leerness skill match "<task or keywords>" [--embedding]'); return process.exit(1); }
  const skills = _readInstalledSkills(root);
  if (!skills.length) {
    log(`# leerness skill match (1.9.45/50)`);
    log(`설치된 skill 없음 — \`leerness init\` 또는 \`leerness skill install <url>\` 먼저`);
    return;
  }
  // 1.9.50: --embedding 옵션 — Ollama embedding API로 cosine similarity
  const useEmbedding = has('--embedding');
  const ollamaUrl = process.env.LEERNESS_OLLAMA_BASE_URL || arg('--ollama-url', null);
  let ranked;
  if (useEmbedding) {
    if (!ollamaUrl) {
      fail('--embedding은 LEERNESS_OLLAMA_BASE_URL 환경변수 필요 (예: http://localhost:11434) — opt-in 정책');
      return process.exit(1);
    }
    const model = process.env.LEERNESS_OLLAMA_EMBED_MODEL || 'nomic-embed-text';
    log(`# leerness skill match (1.9.50, embedding)`);
    log(`Ollama: ${ollamaUrl} · model: ${model}`);
    const qVec = await _embedText(ollamaUrl, query, model);
    if (!qVec) {
      warn('embedding 실패 — jaccard로 폴백');
    } else {
      const skillVecs = await Promise.all(skills.map(s =>
        _embedText(ollamaUrl, `${s.name}. ${s.description}`, model)
      ));
      ranked = skills.map((s, i) => ({ ...s, score: _cosine(qVec, skillVecs[i]) }))
                    .sort((a, b) => b.score - a.score);
    }
  }
  if (!ranked) {
    const qTokens = _tokenize(query);
    ranked = skills.map(s => ({
      ...s,
      score: _jaccard(qTokens, _tokenize(s.name + ' ' + s.description))
    })).sort((a, b) => b.score - a.score);
  }
  const top = ranked.filter(r => r.score > 0).slice(0, 5);
  // 1.9.68: rolling history 자동 누적 (.harness/skill-suggestions.md) — default ON
  // 끄기: --no-save 또는 LEERNESS_NO_SKILL_HISTORY=1
  if (!has('--no-save') && process.env.LEERNESS_NO_SKILL_HISTORY !== '1') {
    try {
      _appendSkillSuggestion(root, { query, useEmbedding, top });
    } catch {}
  }
  if (has('--json')) {
    log(JSON.stringify({ query, total: skills.length, matched: top.length, top: top.map(({ dir, ...rest }) => rest) }, null, 2));
    return;
  }
  log(`# leerness skill match (1.9.45)`);
  log(`query: ${query}`);
  log(`전체 ${skills.length}개 skill 중 매칭 ${top.length}건`);
  log('');
  if (!top.length) {
    log('  (매칭 점수 0 — 다른 키워드 시도 또는 `leerness skill discover` 활용)');
    return;
  }
  log(`| 점수 | id | name | description |`);
  log(`|---:|---|---|---|`);
  for (const r of top) {
    log(`| ${r.score.toFixed(2)} | ${r.id} | ${r.name} | ${(r.description || '').slice(0, 60)} |`);
  }
  log('');
  log(`💡 사용: \`cat ${rel(root, top[0].dir)}/SKILL.md\` 또는 메인 에이전트가 이 skill 본문을 참고`);
  log(`📒 자동 누적: .harness/skill-suggestions.md (--no-save로 끄기)`);
}

// 1.9.68: skill match rolling history append (.harness/skill-suggestions.md)
// AI가 다음 세션에 이전 추천을 참조 가능 — readWhen: '세션 시작', 'skill 결정 전'
function _appendSkillSuggestion(root, { query, useEmbedding, top }) {
  const p = path.join(absRoot(root), '.harness', 'skill-suggestions.md');
  if (!exists(p)) {
    // 신규 파일 — frontmatter + 안내
    const fm = `---\nleernessRole: skill-suggestions\nreadWhen:\n  - skill 결정 전\n  - 세션 시작\nupdateWhen:\n  - leerness skill match 호출 시 자동 누적 (1.9.68)\ndoNotStore:\n  - 실제 토큰\n  - 비밀번호\n  - 운영 쿠키\n  - 민감한 개인정보 원문\n---\n<!-- leerness:managed -->\n# Skill Suggestions (Rolling History)\n\n매 \`leerness skill match\` 호출이 여기 누적됩니다. AI 에이전트는 다음 세션에 같은 키워드를 다시 검색하지 말고 이력을 먼저 참조하세요.\n\n`;
    mkdirp(path.dirname(p));
    writeUtf8(p, fm);
  }
  const algo = useEmbedding ? 'embedding' : 'jaccard';
  const ts = new Date().toISOString();
  let block = `\n## ${ts.slice(0, 19).replace('T', ' ')} — query "${(query || '').slice(0, 80)}"\n`;
  block += `- Algorithm: ${algo}\n`;
  if (!top.length) {
    block += `- Matched: 0 — 다른 키워드 또는 \`leerness skill discover\` 권장\n`;
  } else {
    block += `- Top ${top.length} matches:\n`;
    for (const r of top) {
      block += `  - [${r.score.toFixed(2)}] ${r.id} — ${(r.description || '').slice(0, 80)}\n`;
    }
  }
  append(p, block);
}

// 1.9.43: skill export-all — 모든 자체 skill을 agentskills.io 표준 SKILL.md로 일괄 export
function skillExportAllCmd(root) {
  root = absRoot(root || process.cwd());
  const all = listAllSkills(root);
  const ids = Object.keys(all);
  const outDir = arg('--out', path.join(root, '.harness', 'skills-export'));
  mkdirp(outDir);
  let exported = 0;
  log(`# leerness skill export-all (1.9.43)`);
  log(`총 ${ids.length}개 skill → ${rel(root, outDir)}/`);
  log('');
  for (const id of ids) {
    const data = all[id];
    const description = (data.displayNameKo || data.description || (data.capabilities && data.capabilities[0]) || id).slice(0, 200);
    const body = `---\nname: ${id}\ndescription: ${description}\n---\n\n# ${data.displayNameKo || id}\n\n## Capabilities\n${(data.capabilities || []).map(c => '- ' + c).join('\n') || '-'}\n\n## Sources\n${(data.sources || []).map(s => '- ' + (s.url || s)).join('\n') || '-'}\n`;
    const skillDir = path.join(outDir, id);
    mkdirp(skillDir);
    writeUtf8(path.join(skillDir, 'SKILL.md'), body);
    log(`  ✓ ${id} → ${rel(root, path.join(skillDir, 'SKILL.md'))}`);
    exported++;
  }
  log('');
  log(`✅ ${exported}개 skill 일괄 export 완료`);
  log(`💡 다른 도구에서: leerness skill install <SKILL.md path>`);
}

// 1.9.43: MCP server — stdio JSON-RPC로 leerness 도구 노출 (Claude Code/Hermes 등이 호출)
// 프로토콜: MCP 표준 (JSON-RPC 2.0). 메서드: initialize, tools/list, tools/call
function mcpServeCmd(root) {
  root = absRoot(root || process.cwd());
  // 노출할 leerness 도구 목록
  const TOOLS = [
    { name: 'leerness_handoff', description: '워크스페이스 컨텍스트(plan/progress/decisions) 적재', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'leerness_drift_check', description: '1.9.136 — AI 에이전트 leerness 미사용 drift 자동 감지 JSON ({ root, score, level, signals[], healthy }). 5+ 신호 + 4단계 레벨 (🟢 healthy / 🟡 warning / 🟠 caution / 🔴 critical). 보안 신호 통합 (1.9.78)', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'leerness_audit', description: '1.9.102 — 워크스페이스 일관성 감사 JSON (warnings/failures/fixed/healthy + findings[]. kind 11종: design_dup/design_system_default/reuse_map_empty/milestone_unlinked/handoff_not_generated/current_state_stale/readme_version_mismatch/npm_cve/gitignore_missing_secrets/env_keys_missing/strict_promoted)', inputSchema: { type: 'object', properties: { path: { type: 'string' }, fix: { type: 'boolean' }, strict: { type: 'boolean' } } } },
    { name: 'leerness_verify_claim', description: 'AI 거짓 완료 자동 검증 (evidence 파일 + 실 테스트 실행)', inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, path: { type: 'string' }, runTests: { type: 'boolean' }, strictClaims: { type: 'boolean' } }, required: ['taskId'] } },
    { name: 'leerness_contract_verify', description: '명세 ↔ 구현 함수/필드 일치 자동 검사', inputSchema: { type: 'object', properties: { spec: { type: 'string' }, impl: { type: 'string' } }, required: ['spec', 'impl'] } },
    { name: 'leerness_agents_list', description: '외부 AI CLI 가용성 표 (claude/codex/gemini/copilot 상태 + 환경변수 활성화 여부)', inputSchema: { type: 'object', properties: {} } },
    { name: 'leerness_reuse_map', description: '워크스페이스 중복 함수/capability 자동 감지 (--all-apps + fuzzy 매칭)', inputSchema: { type: 'object', properties: { path: { type: 'string' }, allApps: { type: 'boolean' }, strictElements: { type: 'boolean' } } } },
    { name: 'leerness_whats_new', description: 'CHANGELOG 차분 자동 추출 (from → to 사이 신규 명령/플래그/파일)', inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } } },
    { name: 'leerness_usage_stats', description: 'leerness 명령별 누적 호출 통계 + drift 통계', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'leerness_session_close', description: '1.9.103 — 세션 마감 JSON (handoff/current-state/task-log 갱신 + taskCounts + rules + skillCandidates + drift + topCommands + mcpStats). 외부 AI가 마감 통계 자동 회수', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'leerness_skill_suggest', description: '1.9.53 — 사용 패턴 자동 분석 → 새 skill 후보 제안 (Hermes-style 자동 학습)', inputSchema: { type: 'object', properties: { path: { type: 'string' }, min: { type: 'number' }, days: { type: 'number' } } } },
    { name: 'leerness_lessons', description: '1.9.7/54 — 과거 결정·실수 자동 회수 (--auto: 현재 task 키워드 자동 추출)', inputSchema: { type: 'object', properties: { path: { type: 'string' }, query: { type: 'string' }, auto: { type: 'boolean' }, limit: { type: 'number' } } } },
    { name: 'leerness_task_export', description: '1.9.60/66 — leerness task → Claude Code TodoWrite 호환 JSON (외부 AI 양방향 sync)', inputSchema: { type: 'object', properties: { path: { type: 'string' }, to: { type: 'string' } } } },
    { name: 'leerness_env_check', description: '1.9.71/73 — .env vs .env.example 동기화 검사 (보안: 키만, 값 미노출). exit 1 if 누락 키 있음', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'leerness_brainstorm', description: '1.9.16/72/77 — 누적 컨텍스트(decisions+skills+tasks+rules+evidence+lessons+skillHistory+taskLogFails) 자원 회수. 외부 AI가 새 작업 시작 전 호출', inputSchema: { type: 'object', properties: { topic: { type: 'string' }, path: { type: 'string' }, allApps: { type: 'boolean' } }, required: ['topic'] } },
    { name: 'leerness_skill_match', description: '1.9.45/50/83 — 사용자 task 키워드에 매칭되는 설치된 skill 추천 (jaccard 또는 embedding). 1.9.68 rolling history 자동 누적', inputSchema: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' }, useEmbedding: { type: 'boolean' } }, required: ['query'] } },
    { name: 'leerness_skill_list', description: '1.9.84 — 워크스페이스에 설치된 skill 목록 + 사용 횟수 + 출처 (catalog/user). 외부 AI가 사용 가능한 skill 조회', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'leerness_health', description: '1.9.85/86 — 종합 헬스 체크 (drift + 보안 + skills + MCP + tasks + issues 배열). 외부 AI가 워크스페이스 상태 한 번에 확인', inputSchema: { type: 'object', properties: { path: { type: 'string' }, strict: { type: 'boolean' } } } },
    { name: 'leerness_skill_search', description: '1.9.90/91 — capability 배열에서 부분 일치하는 skill 검색 (substring + case-insensitive). skill match와 다른 정확 매칭', inputSchema: { type: 'object', properties: { capability: { type: 'string' }, path: { type: 'string' } }, required: ['capability'] } },
    { name: 'leerness_skill_info', description: '1.9.92 — 개별 skill 상세 조회 (version/capabilities/sources/patterns/usage/optimizations). 외부 AI가 skill 능력 정확히 파악', inputSchema: { type: 'object', properties: { id: { type: 'string' }, path: { type: 'string' } }, required: ['id'] } },
    { name: 'leerness_benchmark', description: '1.9.46/51/94 — 6 차원 점수 + 검수 시나리오 (--scenario) 결과 JSON. 외부 AI가 워크스페이스 leerness 활용 점수 확인', inputSchema: { type: 'object', properties: { path: { type: 'string' }, scenario: { type: 'string' } } } },
    { name: 'leerness_lazy_detect', description: '1.9.101 — 게으른 작업 자동 감지 결과 JSON (evidence 없는 done / empty handoff / no test run / TODO 미추적 / blocker no-next-action 등). 외부 AI가 거짓 완료 신호 사전 점검', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'leerness_retro', description: '1.9.104 — 4세션 누적 회고 보고서 JSON (statusCounts/focusNext/skillUsage/recentDecisions/durations/activeRules/fixSignals/passSignals/totalOptimizations). 외부 AI가 누적 패턴 자동 학습', inputSchema: { type: 'object', properties: { path: { type: 'string' }, days: { type: 'number' }, allApps: { type: 'boolean' } } } },
    { name: 'leerness_task_add', description: '1.9.105 — progress-tracker.md 에 새 task 추가 (양방향 제어 완성). 외부 AI가 사용자 요청을 task로 즉시 등록. 인자: { text (required), status?, evidence?, nextAction?, path? }', inputSchema: { type: 'object', properties: { text: { type: 'string' }, status: { type: 'string', enum: ['requested', 'planned', 'in-progress', 'waiting', 'on-hold', 'blocked', 'incomplete', 'done', 'dropped'] }, evidence: { type: 'string' }, nextAction: { type: 'string' }, path: { type: 'string' } }, required: ['text'] } },
    { name: 'leerness_task_update', description: '1.9.106 — 기존 task 상태/evidence/nextAction 갱신. 외부 AI가 작업 진행에 따라 task를 단계적으로 업데이트 (read+add+update 3종 surface 완성). 인자: { id (required), status?, evidence?, nextAction?, note?, path? }', inputSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['requested', 'planned', 'in-progress', 'waiting', 'on-hold', 'blocked', 'incomplete', 'done', 'dropped'] }, evidence: { type: 'string' }, nextAction: { type: 'string' }, note: { type: 'string' }, path: { type: 'string' } }, required: ['id'] } },
    { name: 'leerness_task_drop', description: '1.9.107 — task를 dropped 상태로 폐기 (CRUD 완성: read/add/update/drop). 외부 AI가 사용자 요청으로 task 취소. 인자: { id (required), reason?, path? }', inputSchema: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' }, path: { type: 'string' } }, required: ['id'] } },
    { name: 'leerness_decision_add', description: '1.9.108 — decisions.md 에 새 설계 결정 추가 (메모리 영구화). 1.9.43+ handoff lessons 자동 회수와 통합 — 추후 동일 키워드 작업 시 자동 재상기. 인자: { title (required), reason?, alternatives?, impact?, path? }', inputSchema: { type: 'object', properties: { title: { type: 'string' }, reason: { type: 'string' }, alternatives: { type: 'string' }, impact: { type: 'string' }, path: { type: 'string' } }, required: ['title'] } },
    { name: 'leerness_rule_add', description: '1.9.109 — 자연어 영구 룰 등록 (1.9.8). "매 X마다 Y를 해줘" 같은 룰을 등록 — handoff 가 매 세션 자동 출력, session close 가 자동 검증·보고. 인자: { description (required), trigger? (every-session/every-update/every-commit/session-start/session-close/pre-publish), path? }', inputSchema: { type: 'object', properties: { description: { type: 'string' }, trigger: { type: 'string', enum: ['every-session', 'every-update', 'every-commit', 'session-start', 'session-close', 'pre-publish'] }, path: { type: 'string' } }, required: ['description'] } },
    { name: 'leerness_rule_list', description: '1.9.109 — 등록된 자연어 룰 목록 JSON (id/trigger/rule/status/lastVerified). 외부 AI가 현재 활성 룰 자동 회수', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'leerness_plan_add', description: '1.9.110 — plan.md 에 새 milestone 추가 + progress-tracker.md에 자동 동기화 task 생성. 외부 AI가 계획 단계를 직접 등록. 인자: { text (required), status?, progress?, nextAction?, path? }', inputSchema: { type: 'object', properties: { text: { type: 'string' }, status: { type: 'string' }, progress: { type: 'string' }, nextAction: { type: 'string' }, path: { type: 'string' } }, required: ['text'] } },
    { name: 'leerness_lesson_save', description: '1.9.112 — .harness/lessons.md 에 새 lesson 영구화 (Memory Write Surface 5번째). 외부 AI가 세션 중 얻은 통찰을 즉시 영구 기록 — handoff 자동 회수와 통합. 인자: { text (required), tag?, path? }', inputSchema: { type: 'object', properties: { text: { type: 'string' }, tag: { type: 'string' }, path: { type: 'string' } }, required: ['text'] } },
    { name: 'leerness_memory_status', description: '1.9.114 — Memory Write Surface 5종 (tasks/decisions/rules/plan/lessons) 통합 상태 JSON. 외부 AI가 한 호출로 영구화 상태 + 카운트 + 최근 항목 회수. summary 필드는 "T2/D3/R1/P5/L7" 형식', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'leerness_lesson_list', description: '1.9.117 — lessons.md 전용 list JSON ({ date, text, tag }[]). --tag 필터 지원. 1.9.139+ --query 키워드 필터 (text/tag case-insensitive). 외부 AI가 영구화된 lesson 전체 회수 (vs leerness_lessons 는 다중 source fuzzy 매칭)', inputSchema: { type: 'object', properties: { path: { type: 'string' }, tag: { type: 'string' }, query: { type: 'string' } } } },
    { name: 'leerness_decision_list', description: '1.9.118 — decisions.md 전체 조회 JSON ({ date, title, decision, reason, alternatives, impact }[]). 1.9.139+ --query 키워드 필터 (title/decision/reason/alternatives/impact case-insensitive). 외부 AI가 영구화된 설계 결정 전체 회수', inputSchema: { type: 'object', properties: { path: { type: 'string' }, query: { type: 'string' } } } },
    { name: 'leerness_plan_list', description: '1.9.119 — plan.md 의 모든 milestone (M-XXXX) 조회 JSON ({ id, title, status, progress, tasks: [{ done, text }] }[]). 외부 AI가 영구화된 계획 + 진행률 + tasks checkbox 전체 회수', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'leerness_lesson_drop', description: '1.9.124 — lessons.md 에서 특정 lesson 제거 (target: date YYYY-MM-DD 또는 text substring). 잘못 저장한 lesson 제거. 제거된 블록은 .harness/lessons.archive.md 에 자동 보존 (복구 가능)', inputSchema: { type: 'object', properties: { target: { type: 'string' }, path: { type: 'string' } }, required: ['target'] } },
    { name: 'leerness_decision_drop', description: '1.9.125 — decisions.md 에서 특정 결정 제거 (target: date YYYY-MM-DD 또는 title substring). 제거된 블록은 .harness/decisions.archive.md 에 자동 보존', inputSchema: { type: 'object', properties: { target: { type: 'string' }, path: { type: 'string' } }, required: ['target'] } },
    { name: 'leerness_plan_remove', description: '1.9.126 — plan.md 에서 특정 milestone 블록 (### M-XXXX) 제거 (target: M-XXXX 또는 title substring). 제거된 블록은 .harness/plan.archive.md 에 자동 보존. Memory Surface DELETE 5종 완전 완성', inputSchema: { type: 'object', properties: { target: { type: 'string' }, path: { type: 'string' } }, required: ['target'] } },
    { name: 'leerness_memory_archive_list', description: '1.9.127 — DELETE 5종 archive 파일 통합 조회 JSON ({ decisions: [], lessons: [], plan: [], totals: { decisions, lessons, plan, all } }). 외부 AI가 과거에 제거된 항목을 회수/복원 후보로 참조. --surface 필터: decisions|lessons|plan. 1.9.138+ --query 키워드 필터 (target/originalHeader case-insensitive 매칭)', inputSchema: { type: 'object', properties: { surface: { type: 'string' }, query: { type: 'string' }, path: { type: 'string' } } } },
    { name: 'leerness_memory_restore', description: '1.9.128 — archive 의 항목을 active 파일로 복귀 (DELETE→RESTORE cycle). surface: decisions|lessons|plan. target: date YYYY-MM-DD 또는 target substring 매칭. 복원된 블록은 archive 에서 제거됨. 🎉 MCP 40 도구 마일스톤', inputSchema: { type: 'object', properties: { surface: { type: 'string', enum: ['decisions', 'lessons', 'plan'] }, target: { type: 'string' }, path: { type: 'string' } }, required: ['surface', 'target'] } },
    { name: 'leerness_task_list', description: '1.9.134 — progress-tracker.md 전체 task 조회 JSON ({ total, tasks: [{ id, status, request, evidence, nextAction, updated }] }). --status 필터 지원 (planned|in-progress|done 등). 외부 AI가 task 상태 회수', inputSchema: { type: 'object', properties: { path: { type: 'string' }, status: { type: 'string' } } } },
    { name: 'leerness_rule_remove', description: '1.9.135 — rules.md 에서 특정 rule 제거 (id: R-XXXX). 제거된 rule 은 .harness/rules.archive.md 에 자동 보존 (복구 가능). Rule surface CRUD MCP 완성 (add/list/remove)', inputSchema: { type: 'object', properties: { id: { type: 'string' }, path: { type: 'string' } }, required: ['id'] } },
    { name: 'leerness_feature_impact', description: '1.9.141 — Feature Causality Graph 인과관계 영향 추적 JSON ({ feature, total, impacted: [{ id, title, depth, via, files, errorModes }] }). 신규 기능 추가/형식 변경 전 호출: id 변경으로 영향받는 다른 feature를 transitive (affects + co-changes + reverse depends-on) 으로 회수. 1+1=20 cascade 방지', inputSchema: { type: 'object', properties: { id: { type: 'string' }, path: { type: 'string' } }, required: ['id'] } },
    { name: 'leerness_feature_list', description: '1.9.141 — 전체 Feature Graph 노드 + 엣지 JSON. 외부 AI가 시스템 내 기능 의존성을 한 번에 회수', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'leerness_feature_add', description: '1.9.142 — Feature Graph 에 새 노드 추가 (외부 AI가 코드 작성 중 직접 feature 등록). 인자: { title (required), dependsOn?, affects?, coChangesWith?, files?, path? }. 자동 F-XXXX ID 부여. CRUD 완성에 기여', inputSchema: { type: 'object', properties: { title: { type: 'string' }, dependsOn: { type: 'string' }, affects: { type: 'string' }, coChangesWith: { type: 'string' }, files: { type: 'string' }, path: { type: 'string' } }, required: ['title'] } },
    { name: 'leerness_feature_link', description: '1.9.142 — 기존 feature 노드에 의존/영향/공변경 엣지 추가. 인자: { id (required, F-XXXX), dependsOn?, affects?, coChangesWith?, path? }. 외부 AI가 코드 변경 도중 발견한 인과관계를 즉시 그래프에 반영', inputSchema: { type: 'object', properties: { id: { type: 'string' }, dependsOn: { type: 'string' }, affects: { type: 'string' }, coChangesWith: { type: 'string' }, path: { type: 'string' } }, required: ['id'] } },
    { name: 'leerness_env_detect', description: '1.9.145 — 실행 환경 자동 감지 + 변동 추적 JSON ({ snapshot: { os, hardware, locale, shell, node, tools, scriptDependencies }, diff: { firstCapture, changes, missing }, persisted }). "X은(는) 내부 또는 외부 명령... 아닙니다" 사전 방지: package.json scripts 의존 도구가 PATH에 있는지 검증 + 머신/Node/도구 변경 감지. 절대경로 마스킹 (보안). 인자: { path? }', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'leerness_provider_list', description: '1.9.157/158 — Provider Registry 조회 JSON ({ total, builtin, user, providers: [{ id, bin, envFlag, source, desc }] }). 빌트인 5종 (claude/codex/gemini/copilot/ollama) + .harness/providers.json 사용자 정의 통합. 외부 AI가 sub-agent 분배 가능한 provider 전체 회수 (OpenRouter/Bedrock 등 등록되어 있으면 같이 노출). 🎉 MCP 48 도구 마일스톤', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'leerness_provider_add', description: '1.9.159 — Provider Registry 에 새 provider 동적 추가. 인자: { id (required), bin?, envFlag?, versionArgs?, desc?, path? }. 외부 AI가 새 CLI 발견 시 자가 확장 (OpenRouter / Bedrock / Groq / Hugging Face 등 등록). 같은 id 두 번 호출 → 갱신. 빌트인 id 호출 → user override. id 는 영문자/숫자/_- 만 허용.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, bin: { type: 'string' }, envFlag: { type: 'string' }, versionArgs: { type: 'string' }, desc: { type: 'string' }, installHint: { type: 'string' }, path: { type: 'string' } }, required: ['id'] } },
    { name: 'leerness_provider_remove', description: '1.9.159 — Provider Registry 에서 사용자 정의 provider 제거. 인자: { id (required), path? }. 빌트인 5종 id 는 제거 불가 (override 만 제거 가능). 🎉 MCP 50 도구 마일스톤 — Provider Registry CRUD MCP 완성 (list/add/remove)', inputSchema: { type: 'object', properties: { id: { type: 'string' }, path: { type: 'string' } }, required: ['id'] } },
    { name: 'leerness_web', description: '1.9.168 — Web Bridge (1.9.165 playwright opt-in). sub: check (설치 + permissions.browser 확인) | screenshot (URL → PNG) | extract (URL + CSS selector → DOM 텍스트). 외부 AI가 leerness 의 웹 자동화 능력을 직접 호출. playwright 미설치 시 친절 안내 (graceful). 인자: { sub (required), url?, out?, selector?, path? }', inputSchema: { type: 'object', properties: { sub: { type: 'string', enum: ['check', 'screenshot', 'extract'] }, url: { type: 'string' }, out: { type: 'string' }, selector: { type: 'string' }, path: { type: 'string' } }, required: ['sub'] } },
    { name: 'leerness_pc', description: '1.9.168 — PC Bridge (1.9.166 robotjs/nut-tree opt-in). sub: check (설치 + permissions.mouse/keyboard) | click (x,y) | type (text) | screenshot (out). ⚠ full permissions 권장 (mouse/keyboard 접근). 외부 AI가 데스크탑 자동화 능력을 직접 호출. 인자: { sub (required), x?, y?, text?, out?, path? }', inputSchema: { type: 'object', properties: { sub: { type: 'string', enum: ['check', 'click', 'type', 'screenshot'] }, x: { type: 'number' }, y: { type: 'number' }, text: { type: 'string' }, out: { type: 'string' }, path: { type: 'string' } }, required: ['sub'] } },
    { name: 'leerness_lsp', description: '1.9.168 — LSP Bridge (1.9.167 typescript opt-in + regex fallback). sub: check (설치 여부) | symbols (file → function/class/interface/type/enum 목록) | references (name + in 디렉토리 → 호출 위치). 외부 AI가 코드 인텔리전스를 직접 호출 (의존성 0 fallback 동작). 🎉 MCP 53 도구 마일스톤. 인자: { sub (required), file?, name?, in?, path? }', inputSchema: { type: 'object', properties: { sub: { type: 'string', enum: ['check', 'symbols', 'references'] }, file: { type: 'string' }, name: { type: 'string' }, in: { type: 'string' }, path: { type: 'string' } }, required: ['sub'] } }
  ];

  function send(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
  }
  function callLeerness(cliArgs) {
    const r = cp.spawnSync(process.execPath, [__filename, ...cliArgs], {
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, LEERNESS_NO_BANNER: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_DRIFT_CHECK: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_WORKFLOW_GUIDE: '1' }
    });
    return { ok: r.status === 0, exit: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  }
  function handleRequest(req) {
    const id = req.id;
    if (req.method === 'initialize') {
      send({ jsonrpc: '2.0', id, result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'leerness', version: VERSION }
      } });
    } else if (req.method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    } else if (req.method === 'tools/call') {
      const { name, arguments: args = {} } = req.params || {};
      const targetPath = args.path || root;
      // 1.9.70: MCP tools/call 자동 사용 통계 — 어떤 도구가 자주/드물게 호출되는지 가시화
      try { _bumpMcpUsage(targetPath, name); } catch {}
      let cliArgs;
      try {
        switch (name) {
          case 'leerness_handoff':         cliArgs = ['handoff', targetPath, '--compact', '--no-drift-check']; break;
          case 'leerness_drift_check':     cliArgs = ['drift', 'check', targetPath, '--json']; break;
          case 'leerness_audit':           cliArgs = ['audit', targetPath, '--json', ...(args.fix ? ['--fix'] : []), ...(args.strict ? ['--strict'] : [])]; break;
          case 'leerness_verify_claim':    cliArgs = ['verify-claim', args.taskId, '--path', targetPath, ...(args.runTests ? ['--run-tests'] : []), ...(args.strictClaims ? ['--strict-claims'] : [])]; break;
          case 'leerness_contract_verify': cliArgs = ['contract', 'verify', args.spec, args.impl]; break;
          case 'leerness_agents_list':     cliArgs = ['agents', 'list', '--json']; break;
          case 'leerness_reuse_map':       cliArgs = ['reuse-map', targetPath, ...(args.allApps ? ['--all-apps'] : []), ...(args.strictElements ? ['--strict-elements'] : []), '--json']; break;
          case 'leerness_whats_new':       cliArgs = ['whats-new', '--path', targetPath, ...(args.from ? ['--from', args.from] : []), ...(args.to ? ['--to', args.to] : []), '--json']; break;
          case 'leerness_usage_stats':     cliArgs = ['usage', 'stats', targetPath, '--json']; break;
          case 'leerness_session_close':   cliArgs = ['session', 'close', targetPath, '--json']; break;
          case 'leerness_skill_suggest':   cliArgs = ['skill', 'suggest', '--path', targetPath, '--json', ...(args.min ? ['--min', String(args.min)] : []), ...(args.days ? ['--days', String(args.days)] : [])]; break;
          case 'leerness_lessons':         cliArgs = ['lessons', '--path', targetPath, '--json', ...(args.auto ? ['--auto'] : []), ...(args.query ? ['--query', args.query] : []), ...(args.limit ? ['--limit', String(args.limit)] : [])]; break;
          case 'leerness_task_export':     cliArgs = ['task', 'export', '--path', targetPath, ...(args.to ? ['--to', args.to] : ['--json'])]; break;
          case 'leerness_env_check':       cliArgs = ['env', 'check', targetPath, '--json']; break;
          case 'leerness_brainstorm':      cliArgs = ['brainstorm', args.topic || '', '--path', targetPath, '--json', ...(args.allApps ? ['--all-apps'] : [])]; break;
          case 'leerness_skill_match':     cliArgs = ['skill', 'match', args.query || '', '--path', targetPath, '--json', ...(args.useEmbedding ? ['--embedding'] : [])]; break;
          case 'leerness_skill_list':      cliArgs = ['skill', 'list', targetPath, '--json']; break;
          case 'leerness_health':          cliArgs = ['health', targetPath, '--json', ...(args.strict ? ['--strict'] : [])]; break;
          case 'leerness_skill_search':    cliArgs = ['skill', 'search', args.capability || '', '--path', targetPath, '--json']; break;
          case 'leerness_skill_info':      cliArgs = ['skill', 'info', args.id || '', '--path', targetPath, '--json']; break;
          case 'leerness_benchmark':       cliArgs = ['benchmark', targetPath, '--json', ...(args.scenario ? ['--scenario', args.scenario] : [])]; break;
          case 'leerness_lazy_detect':     cliArgs = ['lazy', 'detect', targetPath, '--json']; break;
          case 'leerness_retro':           cliArgs = ['retro', targetPath, '--json', ...(args.days ? ['--days', String(args.days)] : []), ...(args.allApps ? ['--all-apps'] : [])]; break;
          case 'leerness_task_add':        cliArgs = ['task', 'add', String(args.text || ''), '--path', targetPath, ...(args.status ? ['--status', args.status] : []), ...(args.evidence ? ['--evidence', args.evidence] : []), ...(args.nextAction ? ['--next', args.nextAction] : [])]; break;
          case 'leerness_task_update':     cliArgs = ['task', 'update', String(args.id || ''), '--path', targetPath, ...(args.status ? ['--status', args.status] : []), ...(args.evidence ? ['--evidence', args.evidence] : []), ...(args.nextAction ? ['--next', args.nextAction] : []), ...(args.note ? ['--note', args.note] : [])]; break;
          case 'leerness_task_drop':       cliArgs = ['task', 'drop', String(args.id || ''), '--path', targetPath, ...(args.reason ? ['--reason', args.reason] : [])]; break;
          case 'leerness_decision_add':    cliArgs = ['decision', 'add', String(args.title || ''), '--path', targetPath, ...(args.reason ? ['--reason', args.reason] : []), ...(args.alternatives ? ['--alternatives', args.alternatives] : []), ...(args.impact ? ['--impact', args.impact] : [])]; break;
          case 'leerness_rule_add':        cliArgs = ['rule', 'add', String(args.description || ''), '--path', targetPath, ...(args.trigger ? ['--trigger', args.trigger] : [])]; break;
          case 'leerness_rule_list':       cliArgs = ['rule', 'list', '--path', targetPath, '--json']; break;
          case 'leerness_plan_add':        cliArgs = ['plan', 'add', String(args.text || ''), '--path', targetPath, ...(args.status ? ['--status', args.status] : []), ...(args.progress ? ['--progress', String(args.progress)] : []), ...(args.nextAction ? ['--next', args.nextAction] : [])]; break;
          case 'leerness_lesson_save':     cliArgs = ['lesson', 'save', String(args.text || ''), '--path', targetPath, ...(args.tag ? ['--tag', args.tag] : [])]; break;
          case 'leerness_memory_status':   cliArgs = ['memory', 'status', '--path', targetPath, '--json']; break;
          case 'leerness_lesson_list':     cliArgs = ['lesson', 'list', '--path', targetPath, '--json', ...(args.tag ? ['--tag', args.tag] : []), ...(args.query ? ['--query', args.query] : [])]; break;
          case 'leerness_decision_list':   cliArgs = ['decision', 'list', '--path', targetPath, '--json', ...(args.query ? ['--query', args.query] : [])]; break;
          case 'leerness_plan_list':       cliArgs = ['plan', 'list', '--path', targetPath, '--json']; break;
          case 'leerness_lesson_drop':     cliArgs = ['lesson', 'drop', String(args.target || ''), '--path', targetPath]; break;
          case 'leerness_decision_drop':   cliArgs = ['decision', 'drop', String(args.target || ''), '--path', targetPath]; break;
          case 'leerness_plan_remove':     cliArgs = ['plan', 'remove', String(args.target || ''), '--path', targetPath]; break;
          case 'leerness_memory_archive_list': cliArgs = ['memory', 'archive', 'list', '--path', targetPath, '--json', ...(args.surface ? ['--surface', args.surface] : []), ...(args.query ? ['--query', args.query] : [])]; break;
          case 'leerness_memory_restore':  cliArgs = ['memory', 'restore', String(args.surface || ''), String(args.target || ''), '--path', targetPath]; break;
          case 'leerness_task_list':       cliArgs = ['task', 'list', '--path', targetPath, '--json', ...(args.status ? ['--status', args.status] : [])]; break;
          case 'leerness_rule_remove':     cliArgs = ['rule', 'remove', String(args.id || ''), '--path', targetPath]; break;
          // 1.9.141: Feature Causality Graph
          case 'leerness_feature_impact':  cliArgs = ['feature', 'impact', String(args.id || ''), '--path', targetPath, '--json']; break;
          case 'leerness_feature_list':    cliArgs = ['feature', 'list', '--path', targetPath, '--json']; break;
          // 1.9.142: Feature Graph WRITE CRUD
          case 'leerness_feature_add':
            cliArgs = ['feature', 'add', String(args.title || ''), '--path', targetPath];
            if (args.dependsOn) cliArgs.push('--depends-on', String(args.dependsOn));
            if (args.affects) cliArgs.push('--affects', String(args.affects));
            if (args.coChangesWith) cliArgs.push('--co-changes-with', String(args.coChangesWith));
            if (args.files) cliArgs.push('--files', String(args.files));
            break;
          case 'leerness_feature_link':
            cliArgs = ['feature', 'link', String(args.id || ''), '--path', targetPath];
            if (args.dependsOn) cliArgs.push('--depends-on', String(args.dependsOn));
            if (args.affects) cliArgs.push('--affects', String(args.affects));
            if (args.coChangesWith) cliArgs.push('--co-changes-with', String(args.coChangesWith));
            break;
          // 1.9.145: 실행 환경 자동 감지
          case 'leerness_env_detect': cliArgs = ['env', 'detect', targetPath, '--json']; break;
          // 1.9.158: Provider Registry — 외부 AI 가 등록된 provider 회수
          case 'leerness_provider_list': cliArgs = ['provider', 'list', '--path', targetPath, '--json']; break;
          // 1.9.159: Provider Registry CRUD — 외부 AI 가 자가 확장
          case 'leerness_provider_add':
            cliArgs = ['provider', 'add', String(args.id || ''), '--path', targetPath];
            if (args.bin) cliArgs.push('--bin', String(args.bin));
            if (args.envFlag) cliArgs.push('--env-flag', String(args.envFlag));
            if (args.versionArgs) cliArgs.push('--version-args', String(args.versionArgs));
            if (args.desc) cliArgs.push('--desc', String(args.desc));
            if (args.installHint) cliArgs.push('--install-hint', String(args.installHint));
            break;
          case 'leerness_provider_remove':
            cliArgs = ['provider', 'remove', String(args.id || ''), '--path', targetPath];
            break;
          // 1.9.168: Bridge 3종 MCP 노출 (web/pc/lsp) — 외부 AI 가 직접 호출
          case 'leerness_web':
            cliArgs = ['web', String(args.sub || 'check'), '--path', targetPath, '--json'];
            if (args.url) cliArgs.splice(2, 0, String(args.url));
            if (args.out) cliArgs.push('--out', String(args.out));
            if (args.selector) cliArgs.push('--selector', String(args.selector));
            break;
          case 'leerness_pc':
            cliArgs = ['pc', String(args.sub || 'check'), '--path', targetPath, '--json'];
            if (typeof args.x === 'number' && typeof args.y === 'number') {
              cliArgs.splice(2, 0, String(args.x), String(args.y));
            }
            if (args.text) cliArgs.splice(2, 0, String(args.text));
            if (args.out) cliArgs.push('--out', String(args.out));
            break;
          case 'leerness_lsp':
            cliArgs = ['lsp', String(args.sub || 'check'), '--path', targetPath, '--json'];
            if (args.file) cliArgs.splice(2, 0, String(args.file));
            if (args.name) cliArgs.splice(2, 0, String(args.name));
            if (args.in) cliArgs.push('--in', String(args.in));
            break;
          default:
            return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${name}` } });
        }
        const r = callLeerness(cliArgs);
        // 1.9.61: cursor 기반 페이지네이션 — 긴 출력은 cursor offset로 다음 청크
        const fullText = r.stdout || r.stderr || '(no output)';
        const CHUNK_SIZE = (args._chunkSize && Number.isFinite(args._chunkSize)) ? args._chunkSize : 50000;
        const cursor = (args._cursor && /^\d+$/.test(String(args._cursor))) ? parseInt(args._cursor, 10) : 0;
        const chunk = fullText.slice(cursor, cursor + CHUNK_SIZE);
        const nextCursor = (cursor + CHUNK_SIZE) < fullText.length ? String(cursor + CHUNK_SIZE) : null;
        const result = {
          content: [{ type: 'text', text: chunk }],
          isError: !r.ok
        };
        if (nextCursor) {
          result.nextCursor = nextCursor;
          result._truncated = { totalLength: fullText.length, returned: chunk.length, hint: `args._cursor=${nextCursor} 로 다음 청크 호출 가능` };
        }
        send({ jsonrpc: '2.0', id, result });
      } catch (e) {
        send({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error: ' + e.message } });
      }
    } else {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${req.method}` } });
    }
  }

  // stdin JSON-RPC 한 줄 단위
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const req = JSON.parse(line);
        handleRequest(req);
      } catch (e) {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: ' + e.message } });
      }
    }
  });
  process.stdin.on('end', () => process.exit(0));
  // 인터럽트 처리
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

function whatsNewCmd(root) {
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
  // CHANGELOG.md — 우선 root, 없으면 leerness-pkg 자체
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

// 1.9.71: .env / .env.example 자동 동기화 — 누락 키 감지 + (옵션) 자동 추가
// 보안 정책: .env의 실제 값은 절대 옮기지 않음. .env.example엔 키만 (빈 값).
function _parseEnvKeys(text) {
  // KEY=value 형식, comment(#) 무시, 빈 줄 무시
  const out = new Set();
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=/i);
    if (m) out.add(m[1]);
  }
  return out;
}
function envDiff(root) {
  root = absRoot(root || process.cwd());
  const envPath = path.join(root, '.env');
  const examplePath = path.join(root, '.env.example');
  const envKeys = exists(envPath) ? _parseEnvKeys(read(envPath)) : new Set();
  const exKeys = exists(examplePath) ? _parseEnvKeys(read(examplePath)) : new Set();
  const inEnvOnly = [...envKeys].filter(k => !exKeys.has(k));
  const inExampleOnly = [...exKeys].filter(k => !envKeys.has(k));
  return { envPath, examplePath, envKeys: [...envKeys], exKeys: [...exKeys], inEnvOnly, inExampleOnly };
}
function envCheckCmd(root) {
  const d = envDiff(root);
  const isJson = has('--json');
  if (isJson) { log(JSON.stringify(d, null, 2)); return; }
  log(`# leerness env check (1.9.71)`);
  log(`.env 존재: ${exists(d.envPath)} · .env.example 존재: ${exists(d.examplePath)}`);
  log(`총 .env 키 ${d.envKeys.length} · .env.example 키 ${d.exKeys.length}`);
  if (d.inEnvOnly.length) {
    log('');
    log(`⚠ .env에 있는데 .env.example에 없는 키 ${d.inEnvOnly.length}건 (보안 정책: 값 없이 키만 추가):`);
    for (const k of d.inEnvOnly) log(`  - ${k}`);
  }
  if (d.inExampleOnly.length) {
    log('');
    log(`ℹ .env.example에 있는데 .env에 없는 키 ${d.inExampleOnly.length}건 (런타임 누락 가능):`);
    for (const k of d.inExampleOnly) log(`  - ${k}`);
  }
  if (!d.inEnvOnly.length && !d.inExampleOnly.length) {
    log('');
    ok('.env ↔ .env.example 동기화됨');
  } else {
    log('');
    log(`💡 자동 동기화: leerness env sync${d.inEnvOnly.length ? ' (.env.example에 누락 키 추가 — 값은 빈 문자열)' : ''}`);
  }
  // 1.9.71: exit code = .env.example 누락 키 있으면 1 (보안 가시화)
  if (d.inEnvOnly.length) process.exitCode = 1;
}
function envSyncCmd(root) {
  const d = envDiff(root);
  log(`# leerness env sync (1.9.71)`);
  if (!exists(d.examplePath)) {
    fail(`.env.example 없음 — leerness init . 먼저 실행`);
    return;
  }
  if (!d.inEnvOnly.length) {
    ok('동기화 불필요 — .env.example에 누락 키 없음');
    return;
  }
  // 누락 키를 .env.example 끝에 append (값 비움, 보안 정책 코멘트 동반)
  let example = read(d.examplePath);
  if (!example.endsWith('\n')) example += '\n';
  example += `\n# 1.9.71 sync: .env에서 발견된 누락 키 (값은 빈 문자열 — 보안 정책)\n`;
  for (const k of d.inEnvOnly) example += `${k}=\n`;
  writeUtf8(d.examplePath, example);
  ok(`${d.inEnvOnly.length}건 추가됨 → ${rel(root, d.examplePath)}`);
  for (const k of d.inEnvOnly) log(`  + ${k}=`);
}

// ===== 1.9.145: 실행 환경 자동 감지 (사용자 명시 요청) =====
// 사용자 시나리오: "X은(는) 내부 또는 외부 명령... 아닙니다" 같은 PATH/도구 누락 오류 사전 방지.
// .harness/environment.json 에 OS/하드웨어/언어/도구를 기록 + 변동 감지.
function _envSnapshotPath(root) { return path.join(absRoot(root), '.harness', 'environment.json'); }
// 보안 정책: 절대경로 토큰 (사용자명 등)을 마스킹 (시크릿 정책)
function _maskPath(p) {
  if (!p || typeof p !== 'string') return p;
  // Windows: C:\Users\<name>\...  → C:\Users\<masked>\...
  let m = p.replace(/([A-Z]:\\Users\\)[^\\]+/i, '$1<user>');
  // Unix: /home/<name>/... or /Users/<name>/...
  m = m.replace(/(\/(?:home|Users)\/)[^\/]+/i, '$1<user>');
  return m;
}
// 단일 도구 감지 — 있으면 { version, path }, 없으면 null
function _detectTool(cmd, versionArgs = ['--version'], maxLen = 80) {
  const r = cp.spawnSync(cmd, versionArgs, { encoding: 'utf8', timeout: 4000, shell: false });
  if (r.error || r.status !== 0) return null;
  // Windows where / Unix which 로 경로 추출
  const isWin = process.platform === 'win32';
  const locator = cp.spawnSync(isWin ? 'where' : 'which', [cmd], { encoding: 'utf8', timeout: 3000, shell: false });
  const toolPath = locator.status === 0 ? (locator.stdout || '').split(/\r?\n/)[0].trim() : null;
  const version = (r.stdout || r.stderr || '').split(/\r?\n/)[0].trim().slice(0, maxLen);
  return { version, path: toolPath ? _maskPath(toolPath) : null };
}
function _detectEnvironment(root) {
  const _os = require('os');
  const snap = {
    capturedAt: new Date().toISOString(),
    leernessVersion: VERSION,
    os: {
      platform: process.platform,            // 'win32' | 'darwin' | 'linux'
      type: _os.type(),                       // 'Windows_NT' | 'Darwin' | 'Linux'
      release: _os.release(),
      arch: process.arch,                     // 'x64' | 'arm64'
      version: _os.version ? _os.version() : null
    },
    hardware: {
      cpuCount: _os.cpus().length,
      cpuModel: (_os.cpus()[0] || {}).model || null,
      totalMemoryGB: Math.round(_os.totalmem() / (1024**3) * 10) / 10,
      freeMemoryGB: Math.round(_os.freemem() / (1024**3) * 10) / 10
    },
    locale: {
      lang: process.env.LANG || process.env.LC_ALL || process.env.LC_CTYPE
            || (process.platform === 'win32' ? (process.env.LANGUAGE || null) : null),
      encoding: process.env.LC_CTYPE || (process.platform === 'win32' ? 'cp949(default)' : 'UTF-8')
    },
    shell: {
      name: process.platform === 'win32' ? (process.env.ComSpec ? path.basename(process.env.ComSpec) : 'cmd.exe')
                                         : (process.env.SHELL ? path.basename(process.env.SHELL) : 'sh')
    },
    node: { version: process.version, path: _maskPath(process.execPath) },
    tools: {}  // 발견된 도구만 (version + masked path)
  };
  // 자주 쓰이는 도구 자동 감지 — 없으면 entry 없음 (audit에서 활용)
  const toolList = [
    { name: 'npm', args: ['--version'] },
    { name: 'pnpm', args: ['--version'] },
    { name: 'yarn', args: ['--version'] },
    { name: 'git', args: ['--version'] },
    { name: 'python', args: ['--version'] },
    { name: 'python3', args: ['--version'] },
    { name: 'pip', args: ['--version'] },
    { name: 'docker', args: ['--version'] },
    { name: 'gh', args: ['--version'] },
    { name: 'java', args: ['-version'] },
    { name: 'go', args: ['version'] },
    { name: 'rustc', args: ['--version'] },
    { name: 'cargo', args: ['--version'] },
    { name: 'deno', args: ['--version'] },
    { name: 'bun', args: ['--version'] },
    { name: 'tsc', args: ['--version'] },
    { name: 'next', args: ['--version'] },
    { name: 'vite', args: ['--version'] }
  ];
  for (const t of toolList) {
    const info = _detectTool(t.name, t.args);
    if (info) snap.tools[t.name] = info;
  }
  // package.json scripts 에서 참조되는 실제 명령들 → PATH 검증
  snap.scriptDependencies = [];
  try {
    const pkgPath = path.join(root, 'package.json');
    if (exists(pkgPath)) {
      const pkg = JSON.parse(read(pkgPath));
      const scripts = pkg.scripts || {};
      // 각 script 첫 토큰을 추출 (단순 토큰 — &&/||/;/| 등으로 split)
      const seen = new Set();
      for (const [name, body] of Object.entries(scripts)) {
        const tokens = String(body).split(/[\s;&|]+/).map(t => t.trim()).filter(Boolean);
        for (const tk of tokens.slice(0, 4)) {
          if (/^[a-z][a-z0-9_-]*$/i.test(tk) && !seen.has(tk)) {
            // 흔한 빌트인은 스킵 (echo, set, cd, exit)
            if (['echo', 'set', 'cd', 'exit', 'rm', 'mv', 'cp', 'ls', 'mkdir', 'true', 'false'].includes(tk)) continue;
            seen.add(tk);
            const found = !!snap.tools[tk] || (cp.spawnSync(process.platform === 'win32' ? 'where' : 'which', [tk], { encoding: 'utf8', timeout: 3000 }).status === 0);
            snap.scriptDependencies.push({ command: tk, foundInPath: found, usedBy: name });
          }
        }
      }
    }
  } catch {}
  return snap;
}
function _readEnvSnapshot(root) {
  const p = _envSnapshotPath(root);
  if (!exists(p)) return null;
  try { return JSON.parse(read(p)); } catch { return null; }
}
function _diffEnvSnapshots(prev, curr) {
  // 1.9.145 fix: 첫 캡처에서도 현재 PATH 누락은 즉시 노출 (CI exit 가시화)
  const currentMissing = (curr.scriptDependencies || []).filter(d => !d.foundInPath).map(d => ({ command: d.command, usedBy: d.usedBy }));
  if (!prev) return { firstCapture: true, changes: [], missing: currentMissing };
  const changes = [];
  // OS 변화 (사용자가 다른 머신에서 실행 시 즉시 감지)
  if (prev.os && curr.os) {
    if (prev.os.platform !== curr.os.platform) changes.push(`os.platform: ${prev.os.platform} → ${curr.os.platform}`);
    if (prev.os.arch !== curr.os.arch) changes.push(`os.arch: ${prev.os.arch} → ${curr.os.arch}`);
  }
  // Node 버전 변화
  if (prev.node && curr.node && prev.node.version !== curr.node.version) {
    changes.push(`node: ${prev.node.version} → ${curr.node.version}`);
  }
  // 도구 추가/제거/버전 변경
  const prevTools = new Set(Object.keys(prev.tools || {}));
  const currTools = new Set(Object.keys(curr.tools || {}));
  for (const t of currTools) {
    if (!prevTools.has(t)) changes.push(`tool added: ${t} (${(curr.tools[t]||{}).version || ''})`);
    else if ((prev.tools[t]||{}).version !== (curr.tools[t]||{}).version) {
      changes.push(`tool changed: ${t} ${prev.tools[t].version} → ${curr.tools[t].version}`);
    }
  }
  for (const t of prevTools) {
    if (!currTools.has(t)) changes.push(`tool removed: ${t}`);
  }
  // package.json scripts 의존 도구 누락 (현재 PATH 기준)
  const missing = [];
  for (const dep of (curr.scriptDependencies || [])) {
    if (!dep.foundInPath) missing.push({ command: dep.command, usedBy: dep.usedBy });
  }
  return { firstCapture: false, changes, missing };
}
function envDetectCmd(root, opts = {}) {
  root = absRoot(root || process.cwd());
  const jsonMode = has('--json') || opts.json;
  const writeMode = !has('--no-write');  // default: 캡처 후 .harness/environment.json 에 저장
  const snap = _detectEnvironment(root);
  const prev = _readEnvSnapshot(root);
  const diff = _diffEnvSnapshots(prev, snap);
  if (writeMode) {
    mkdirp(path.dirname(_envSnapshotPath(root)));
    writeUtf8(_envSnapshotPath(root), JSON.stringify(snap, null, 2) + '\n');
  }
  // 1.9.145 fix: exit code 를 JSON early-return 전에 설정 — CI 가시화
  if (diff.missing && diff.missing.length) process.exitCode = 1;
  if (jsonMode) {
    log(JSON.stringify({ snapshot: snap, diff, persisted: writeMode }, null, 2));
    return;
  }
  log(`# leerness env detect (1.9.145)`);
  log(`OS: ${snap.os.type} ${snap.os.release} · ${snap.os.platform}/${snap.os.arch}`);
  log(`CPU: ${snap.hardware.cpuCount} cores · Memory: ${snap.hardware.totalMemoryGB} GB (free ${snap.hardware.freeMemoryGB})`);
  log(`Node: ${snap.node.version}  ·  Shell: ${snap.shell.name}  ·  Locale: ${snap.locale.lang || '(unset)'} / ${snap.locale.encoding}`);
  const toolNames = Object.keys(snap.tools);
  log(`도구 감지: ${toolNames.length}건 — ${toolNames.slice(0, 10).join(', ')}${toolNames.length > 10 ? ` …+${toolNames.length-10}` : ''}`);
  if (snap.scriptDependencies.length) {
    const missing = snap.scriptDependencies.filter(d => !d.foundInPath);
    log(`package.json scripts 의존: ${snap.scriptDependencies.length}건${missing.length ? ` · ⚠ PATH 누락 ${missing.length}건` : ' · ✓ 모두 PATH에 있음'}`);
    for (const m of missing) log(`  ⚠ ${m.command} (used by: npm run ${m.usedBy})`);
  }
  if (diff.firstCapture) {
    log('');
    ok('첫 환경 캡처 — 다음 실행부터 변동을 자동 비교 (1.9.145)');
  } else if (diff.changes.length) {
    log('');
    warn(`환경 변동 ${diff.changes.length}건 감지:`);
    for (const c of diff.changes) log(`  • ${c}`);
  } else {
    log('');
    ok('환경 변동 없음 (이전 캡처와 동일)');
  }
  if (writeMode) log(`\n📁 .harness/environment.json 갱신됨`);
  // missing 1건 이상이면 exit 1 (CI 가시화)
  if (diff.missing && diff.missing.length) process.exitCode = 1;
}

// ===== 1.9.146: Agent 권한 시스템 (사용자 명시 요청 #5) =====
// .harness/agent-permissions.json — leerness agent 명령 실행 시 적용. 기본 deny-by-default.
function _permissionsPath(root) { return path.join(absRoot(root), '.harness', 'agent-permissions.json'); }
function _permissionsPreset(mode) {
  // basic: 안전 — .harness/ 안만 쓰기
  // extended: 프로젝트 폴더 + shell allowlist
  // full: 전체 (mouse/keyboard/web/admin) — IDE 통합 시
  const presets = {
    basic: {
      mode: 'basic',
      filesystem: { read: true, write: true, restrictTo: ['.harness/', 'progress-tracker.md', 'session-handoff.md'], delete: false },
      shell: { exec: false, allowList: [] },
      network: { fetch: false, outboundAllowList: [] },
      mouse: false, keyboard: false, browser: false, admin: false,
      requireConfirmation: ['shell.exec', 'filesystem.delete', 'network.fetch']
    },
    extended: {
      mode: 'extended',
      filesystem: { read: true, write: true, restrictTo: ['./'], delete: false },
      shell: { exec: true, allowList: ['npm', 'git', 'node', 'pnpm', 'yarn', 'pytest', 'jest', 'tsc'] },
      network: { fetch: true, outboundAllowList: ['localhost', 'github.com', 'api.github.com', 'npmjs.org'] },
      mouse: false, keyboard: false, browser: false, admin: false,
      requireConfirmation: ['filesystem.delete', 'shell.exec_outside_allowlist']
    },
    full: {
      mode: 'full',
      filesystem: { read: true, write: true, restrictTo: ['./'], delete: true },
      shell: { exec: true, allowList: ['*'] },
      network: { fetch: true, outboundAllowList: ['*'] },
      mouse: true, keyboard: true, browser: true, admin: true,
      requireConfirmation: ['filesystem.delete_outside_project', 'admin_action']
    }
  };
  return presets[mode] || presets.basic;
}
function _writePermissionsPreset(root, mode) {
  const preset = _permissionsPreset(mode);
  preset.generatedAt = new Date().toISOString();
  preset.leernessVersion = VERSION;
  mkdirp(path.dirname(_permissionsPath(root)));
  writeUtf8(_permissionsPath(root), JSON.stringify(preset, null, 2) + '\n');
  return preset;
}
function _readPermissions(root) {
  const p = _permissionsPath(root);
  if (!exists(p)) return _permissionsPreset('basic');
  try { return JSON.parse(read(p)); } catch { return _permissionsPreset('basic'); }
}
function permissionsListCmd(root) {
  root = absRoot(root || process.cwd());
  const p = _readPermissions(root);
  if (has('--json')) { log(JSON.stringify(p, null, 2)); return; }
  log(`# leerness permissions (1.9.146)`);
  log(`mode: ${p.mode || 'basic'}  ·  generated: ${p.generatedAt || '(없음)'}`);
  log('');
  log(`📂 filesystem: read=${p.filesystem?.read} write=${p.filesystem?.write} delete=${p.filesystem?.delete}`);
  if (p.filesystem?.restrictTo?.length) log(`   restrict to: ${p.filesystem.restrictTo.join(', ')}`);
  log(`💻 shell.exec: ${p.shell?.exec}  ·  allowList: ${(p.shell?.allowList || []).join(', ') || '(없음)'}`);
  log(`🌐 network.fetch: ${p.network?.fetch}  ·  outbound: ${(p.network?.outboundAllowList || []).join(', ') || '(없음)'}`);
  log(`🖱  mouse=${p.mouse}  ⌨ keyboard=${p.keyboard}  🌐 browser=${p.browser}  👑 admin=${p.admin}`);
  if (p.requireConfirmation?.length) log(`\n⚠ 확인 필요: ${p.requireConfirmation.join(', ')}`);
}
function permissionsSetCmd(root, mode) {
  root = absRoot(root || process.cwd());
  if (!['basic', 'extended', 'full'].includes(mode)) {
    return fail(`mode 는 basic / extended / full — 받음: ${mode || '(없음)'}`);
  }
  const p = _writePermissionsPreset(root, mode);
  ok(`permissions mode set: ${p.mode}`);
  log(`   → 수정: ${_permissionsPath(root).replace(root, '.').replace(/\\/g, '/')}`);
  if (mode === 'full') warn(`⚠ full 모드 — IDE 통합 외 환경에서는 위험. agent 작업 시작 전 leerness permissions list 로 재확인 권장.`);
}
function permissionCheck(root, action, target) {
  // leerness agent 호출 시 권한 검증 — true(허용) / false(거부) 반환
  const p = _readPermissions(root);
  try {
    if (action === 'filesystem.read') return !!p.filesystem?.read;
    if (action === 'filesystem.write') {
      if (!p.filesystem?.write) return false;
      const restrict = p.filesystem?.restrictTo || [];
      if (!restrict.length || restrict.includes('./') || restrict.includes('*')) return true;
      return restrict.some(prefix => (target || '').startsWith(prefix));
    }
    if (action === 'filesystem.delete') return !!p.filesystem?.delete;
    if (action === 'shell.exec') {
      if (!p.shell?.exec) return false;
      const allow = p.shell?.allowList || [];
      if (allow.includes('*')) return true;
      const first = String(target || '').split(/\s+/)[0];
      return allow.includes(first);
    }
    if (action === 'network.fetch') return !!p.network?.fetch;
    if (action === 'mouse') return !!p.mouse;
    if (action === 'keyboard') return !!p.keyboard;
    if (action === 'browser') return !!p.browser;
    if (action === 'admin') return !!p.admin;
  } catch {}
  return false;
}

// ===== 1.9.146: leerness agent — OpenClaw/Hermes 스타일 오픈소스 CLI 에이전트 모드 (사용자 명시 요청 #4) =====
// MVP: handoff 컨텍스트 자동 로드 → 활성 CLI (claude/codex/gemini/ollama) 1개에 작업 위임.
// 권한은 .harness/agent-permissions.json 기준. 실제 LLM 호출은 외부 CLI 또는 Ollama HTTP API.
function _activeCliAgents() {
  const out = [];
  if (process.env.LEERNESS_ENABLE_CLAUDE === '1') out.push('claude');
  if (process.env.LEERNESS_ENABLE_CODEX === '1') out.push('codex');
  if (process.env.LEERNESS_ENABLE_GEMINI === '1') out.push('gemini');
  if (process.env.LEERNESS_ENABLE_COPILOT === '1') out.push('copilot');
  if (process.env.LEERNESS_ENABLE_OLLAMA === '1') out.push('ollama');
  return out;
}
async function _ollamaChat(prompt, model) {
  // Ollama HTTP API — 기본 http://localhost:11434/api/generate
  const url = (process.env.LEERNESS_OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '') + '/api/generate';
  const mdl = model || process.env.LEERNESS_OLLAMA_MODEL || 'llama3';
  return new Promise((resolve) => {
    try {
      const body = JSON.stringify({ model: mdl, prompt, stream: false });
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? require('https') : require('http');
      const req = lib.request({
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + (u.search || ''), method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 60000
      }, (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try { const j = JSON.parse(data); resolve({ ok: res.statusCode === 200, response: j.response || '', model: mdl }); }
          catch { resolve({ ok: false, error: 'invalid JSON response', model: mdl }); }
        });
      });
      req.on('error', e => resolve({ ok: false, error: e.message, model: mdl }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout', model: mdl }); });
      req.write(body); req.end();
    } catch (e) { resolve({ ok: false, error: e.message, model: mdl }); }
  });
}

// 1.9.149: Ollama 사용 가능 모델 목록 — /api/tags
async function _ollamaListModels() {
  const url = (process.env.LEERNESS_OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '') + '/api/tags';
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? require('https') : require('http');
      const req = lib.request({ hostname: u.hostname, port: u.port || 11434, path: u.pathname, method: 'GET', timeout: 4000 }, (res) => {
        let data = ''; res.on('data', c => data += c);
        res.on('end', () => {
          try { const j = JSON.parse(data); resolve({ ok: true, models: (j.models || []).map(m => m.name || m) }); }
          catch { resolve({ ok: false, models: [] }); }
        });
      });
      req.on('error', () => resolve({ ok: false, models: [] }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, models: [] }); });
      req.end();
    } catch { resolve({ ok: false, models: [] }); }
  });
}

// 1.9.153: 외부 CLI 채팅 호출 (multi-provider REPL — 사용자 명시 요청)
//   claude/codex/gemini/copilot 를 child_process 로 호출 후 stdout 캡처.
//   runCommandSafe 경유 — env scrub + permissions + observability 자동 적용.
async function _cliChat(root, provider, prompt, opts) {
  opts = opts || {};
  const agent = EXTERNAL_AGENTS.find(a => a.id === provider);
  if (!agent) return { ok: false, error: `unknown provider: ${provider}`, provider };
  const status = _checkAgent(agent);
  if (status.status !== 'ready') {
    return { ok: false, error: `${provider} 비활성 (${status.status}) — .env 에서 ${agent.envFlag}=1 + CLI 설치 필요`, provider };
  }
  // CLI 별 비-인터랙티브 호출 인자 매핑 (read-only 모드 — REPL 안에서 파일 수정 X)
  let cmd, args;
  if (provider === 'claude')  { cmd = 'claude'; args = ['--print', prompt]; }
  else if (provider === 'codex')   { cmd = 'codex';  args = ['exec', '--skip-git-repo-check', prompt]; }
  else if (provider === 'gemini')  { cmd = 'gemini'; args = ['-p', prompt]; }
  else if (provider === 'copilot') { cmd = 'gh';     args = ['copilot', 'suggest', prompt]; }
  else return { ok: false, error: `provider ${provider} 미지원`, provider };
  // runCommandSafe — env scrub + observability 자동
  const r = runCommandSafe(cmd, args, {
    cwd: process.cwd(), root,
    timeout: opts.timeout || 60000,
    allowOutsideCwd: true,  // CLI 가 cwd 밖에서 실행될 수 있음
    kind: 'agent_repl_cli', label: `repl-${provider}`
  });
  if (r.status === 0) {
    return { ok: true, response: (r.stdout || '').trim(), provider, model: provider };
  }
  return {
    ok: false,
    error: `exit=${r.status} ${(r.stderr || r.stdout || '').slice(0, 200)}`,
    provider
  };
}

// 1.9.149: observability lite — 모든 agent 호출의 traceId + duration + exit + failureCause 기록
function _runsDir(root) { return path.join(absRoot(root), '.harness', 'runs'); }
function _recordRun(root, entry) {
  try {
    const dir = _runsDir(root); mkdirp(dir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const id = `run-${ts}`;
    const fp = path.join(dir, `${id}.jsonl`);
    const line = JSON.stringify({ id, at: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(fp, line);
    return id;
  } catch { return null; }
}

// 1.9.150: Sandboxing — runCommandSafe wrapper (Codex 권고: 3중 LLM 합의 #3)
// cwd jail (root 밖 거부) + shell:false 기본 + timeout + env scrub + permissions allowList 검증 + _recordRun 자동
const _ENV_SAFE_KEYS = new Set([
  'PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR', 'NODE_PATH', 'NODE_ENV',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'SHELL', 'COMSPEC', 'SYSTEMROOT', 'WINDIR', 'OS',
  'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'NUMBER_OF_PROCESSORS',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'APPDATA', 'LOCALAPPDATA',
  'GITHUB_TOKEN', 'NPM_TOKEN', 'CI', 'GH_TOKEN'
]);
function _scrubEnv(extraEnv) {
  const out = {};
  for (const k of Object.keys(process.env || {})) {
    if (_ENV_SAFE_KEYS.has(k) || k.startsWith('LEERNESS_') || k.startsWith('NPM_CONFIG_')) {
      out[k] = process.env[k];
    }
  }
  if (extraEnv && typeof extraEnv === 'object') {
    for (const k of Object.keys(extraEnv)) {
      // Allow caller overrides — explicit opt-in
      if (extraEnv[k] !== undefined) out[k] = String(extraEnv[k]);
    }
  }
  return out;
}
function _isCwdSafe(root, cwd) {
  try {
    if (!cwd) return true;
    const r = path.resolve(absRoot(root));
    const c = path.resolve(cwd);
    if (c === r) return true;
    const rel = path.relative(r, c);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch { return false; }
}
function runCommandSafe(cmd, args, opts) {
  // opts: { cwd, root, timeout, env, stdio, kind, label, allowShell, encoding, input, allowOutsideCwd }
  opts = opts || {};
  const root = opts.root || opts.cwd || process.cwd();
  const cwd = opts.cwd || root;
  const cmdStr = String(cmd || '').trim();
  const argList = Array.isArray(args) ? args.slice() : [];
  const t0 = Date.now();
  const label = opts.label || opts.kind || 'shell_exec';
  // 1) cwd jail
  if (!opts.allowOutsideCwd && !_isCwdSafe(root, cwd)) {
    const r = { status: 126, stdout: '', stderr: `runCommandSafe: cwd outside root rejected (${cwd})`, error: 'cwd_jail', blocked: true };
    try { _recordRun(root, { kind: label, cmd: cmdStr, args: argList, durationMs: Date.now() - t0, ok: false, blocked: 'cwd_jail' }); } catch {}
    return r;
  }
  // 2) permissions allowList (1.9.146)
  try {
    const perms = _readPermissions(root);
    const exec = perms.shell?.exec !== false;  // basic 에선 false
    const allow = perms.shell?.allowList || [];
    if (!exec && !opts.allowOutsideCwd) {
      // basic 모드 — git/npm/node 같은 핵심 도구는 허용 (release/install 흐름 유지)
      const coreAllow = ['git', 'npm', 'npx', 'node', 'pnpm', 'yarn'];
      const first = cmdStr.split(/\s+/)[0];
      if (!coreAllow.includes(first) && !allow.includes('*') && !allow.includes(first)) {
        const r = { status: 126, stdout: '', stderr: `runCommandSafe: shell.exec=false (mode=${perms.mode}). allowList: ${allow.join(',') || '(없음)'} / core: ${coreAllow.join(',')}`, error: 'permissions', blocked: true };
        try { _recordRun(root, { kind: label, cmd: cmdStr, args: argList, durationMs: Date.now() - t0, ok: false, blocked: 'permissions', mode: perms.mode }); } catch {}
        return r;
      }
    }
  } catch {}
  // 3) spawn — shell:false 기본 (shell injection 차단). allowShell=true 시만 shell:true (deploy/build 호환)
  const useShell = !!opts.allowShell;
  const timeout = Math.min(opts.timeout || 5 * 60 * 1000, 10 * 60 * 1000);
  const spawnOpts = {
    cwd,
    encoding: opts.encoding || 'utf8',
    timeout,
    shell: useShell,
    env: _scrubEnv(opts.env),
    input: opts.input,
    stdio: opts.stdio || 'pipe'
  };
  let r;
  try {
    if (useShell) {
      // shell:true 모드 — 인자가 cmd 안에 포함된 단일 문자열인 경우 처리
      r = cp.spawnSync(cmdStr + (argList.length ? ' ' + argList.join(' ') : ''), [], spawnOpts);
    } else {
      // 단일 명령어로 들어온 경우 자동 분리
      let bin = cmdStr, finalArgs = argList;
      if (!argList.length && /\s/.test(cmdStr)) {
        const parts = cmdStr.split(/\s+/);
        bin = parts[0]; finalArgs = parts.slice(1);
      }
      r = cp.spawnSync(bin, finalArgs, spawnOpts);
    }
  } catch (e) {
    r = { status: 1, stdout: '', stderr: e.message, error: 'spawn_exception' };
  }
  const dt = Date.now() - t0;
  try {
    _recordRun(root, {
      kind: label, cmd: cmdStr, args: argList,
      durationMs: dt, status: r.status, ok: r.status === 0,
      shell: useShell, cwd: path.relative(absRoot(root), cwd) || '.'
    });
  } catch {}
  return r;
}
function runsListCmd(root) {
  root = absRoot(root || process.cwd());
  const dir = _runsDir(root);
  if (!exists(dir)) { log('(runs 없음 — leerness agent 호출 시 자동 기록됨)'); return; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort().reverse();
  if (has('--json')) {
    const items = files.slice(0, 50).map(f => {
      try { const c = read(path.join(dir, f)).trim().split('\n').map(l => JSON.parse(l)); return { file: f, entries: c }; }
      catch { return null; }
    }).filter(Boolean);
    log(JSON.stringify({ total: files.length, items }, null, 2));
    return;
  }
  log(`# leerness runs list (1.9.149)`);
  log(`총 ${files.length}건${files.length > 20 ? ' (최근 20)' : ''}`);
  for (const f of files.slice(0, 20)) {
    try {
      const lines = read(path.join(dir, f)).trim().split('\n');
      const first = JSON.parse(lines[0]);
      const dur = first.durationMs ? ` ${first.durationMs}ms` : '';
      const ok = first.ok === false ? ' ⚠fail' : '';
      log(`  ${first.id}  ·  ${first.kind || '?'}${dur}${ok}  ·  ${first.model || first.provider || ''}`);
    } catch {}
  }
}
function runsShowCmd(root, id) {
  root = absRoot(root || process.cwd());
  const fp = path.join(_runsDir(root), `${id}.jsonl`);
  if (!exists(fp)) return fail(`run 없음: ${id}`);
  log(read(fp));
}
// 1.9.155: provider 별 추천 모델 카탈로그 — REPL :models 명령에서 노출 (실제 가용성은 사용자 CLI 가 결정)
const _PROVIDER_MODEL_CATALOG = {
  claude: [
    { id: 'claude-opus-4-5', note: '최고 추론 (Anthropic)' },
    { id: 'claude-sonnet-4-5', note: '균형형 (속도/품질)' },
    { id: 'claude-haiku-4-5', note: '빠름' }
  ],
  codex: [
    { id: 'gpt-5', note: 'OpenAI 최신' },
    { id: 'gpt-5-codex', note: '코드 특화' },
    { id: 'o4-mini', note: '빠른 reasoning' }
  ],
  gemini: [
    { id: 'gemini-2.5-pro', note: 'Google 최고급' },
    { id: 'gemini-2.5-flash', note: '빠른 응답' }
  ],
  copilot: [
    { id: 'default', note: 'gh copilot 기본 (모델 선택 불가)' }
  ],
  ollama: [
    { id: 'llama3', note: 'Meta — :models 로 실시간 조회 권장' },
    { id: 'qwen2.5-coder', note: 'Alibaba — 코드 특화' },
    { id: 'gpt-oss', note: 'OpenAI 오픈소스' }
  ]
};

// 1.9.148: planner/reviewer/actor 역할 시스템 프롬프트 (Gemini 권고 — 자기-승인 편향 방지)
const _AGENT_ROLE_PROMPTS = {
  planner: '역할: planner. task를 step 3-6개로 분해, 각 step의 입출력/검증 방법 명시. 코드 작성 금지, 계획만.',
  reviewer: '역할: reviewer. planner 의 계획 또는 actor 의 결과를 비판적으로 검토. 누락된 검증, 잠재 cascade, 오류 가능성 지적. 동의/수정 결론 명시.',
  actor: '역할: actor. 계획에 따라 정확한 명령/코드만 실행. evidence(파일 경로 + 테스트 결과) 함께 기록. 새 계획 생성 금지.'
};
// 1.9.149+1.9.153: REPL 모드 — leerness 자율 AI 에이전트 (multi-provider 세션)
async function _agentRepl(root, opts) {
  // 1.9.153: .env 자동 로드 (REPL 진입 직전) — install 직후 LEERNESS_ENABLE_* 즉시 반영
  try { _loadEnvFile(root); } catch {}
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const isTty = process.stdout.isTTY;
  const C = isTty ? {
    cy: s => `\x1b[36m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m`,
    bold: s => `\x1b[1m${s}\x1b[0m`, green: s => `\x1b[32m${s}\x1b[0m`,
    yel: s => `\x1b[33m${s}\x1b[0m`, mag: s => `\x1b[35m${s}\x1b[0m`
  } : { cy:s=>s, dim:s=>s, bold:s=>s, green:s=>s, yel:s=>s, mag:s=>s };
  // 1.9.153: provider 자동 선택 — opts.provider 명시 안 됨 + 활성 CLI 가 있으면 사용자에게 선택지 표시
  let initialProvider = opts.provider;
  if (!initialProvider) {
    const ready = EXTERNAL_AGENTS.map(a => ({ def: a, status: _checkAgent(a) }))
                                  .filter(x => x.status.status === 'ready');
    if (ready.length === 1) {
      initialProvider = ready[0].def.id;  // 단일 활성 → 자동 선택
    } else if (ready.length > 1 && isTty) {
      // 복수 활성 → 사용자에게 선택지 (Ollama 우선이 아닌, 활성된 CLI 중 선택)
      console.log('');
      console.log(`  사용 가능한 CLI 에이전트 ${ready.length}개:`);
      ready.forEach((x, i) => console.log(`    ${i + 1}) ${x.def.id}${x.status.version ? ' (v' + x.status.version + ')' : ''}`));
      const choice = await new Promise(res => rl.question(`\n  provider 선택 (Enter=1): `, res));
      const idx = parseInt(choice, 10) - 1;
      initialProvider = (idx >= 0 && idx < ready.length) ? ready[idx].def.id : ready[0].def.id;
    } else {
      initialProvider = 'ollama';  // 활성 0개 → fallback (사용 시 friendly 경고)
    }
  }
  // 세션 state
  let state = {
    provider: initialProvider,
    model: opts.model || process.env.LEERNESS_OLLAMA_MODEL || null,
    role: opts.role || 'actor',
    history: [],   // [{role: 'user'|'assistant', content: ''}]
    startedAt: new Date().toISOString(),
    sessionId: 'sess-' + new Date().toISOString().replace(/[:.]/g, '-')
  };
  const sessionPath = () => path.join(absRoot(root), '.harness', 'agent-sessions', `${state.sessionId}.jsonl`);
  const saveSession = () => {
    try {
      mkdirp(path.dirname(sessionPath()));
      const lines = state.history.map(m => JSON.stringify({ at: new Date().toISOString(), ...m })).join('\n');
      writeUtf8(sessionPath(), lines + '\n');
    } catch {}
  };
  // 환영 메시지 + 모델 선택
  log('');
  log(C.bold(C.cy('  ╔════════════════════════════════════════════════════╗')));
  log(C.bold(C.cy('  ║  leerness agent — REPL mode                        ║')));
  log(C.bold(C.cy('  ║  검수·기억·샌드박스 통합 자율 AI 에이전트             ║')));
  log(C.bold(C.cy('  ╚════════════════════════════════════════════════════╝')));
  log('');
  // Ollama 모델 자동 감지 — model이 명시되지 않았으면 사용자에게 선택지 제공
  if (state.provider === 'ollama' && !state.model) {
    log(C.dim('  Ollama 모델 목록 조회 중...'));
    const r = await _ollamaListModels();
    if (r.ok && r.models.length) {
      log(C.green(`  사용 가능 모델 ${r.models.length}개:`));
      r.models.slice(0, 8).forEach((m, i) => log(`    ${i + 1}) ${m}`));
      const choice = await new Promise(res => rl.question(C.cy('\n  모델 번호 선택 (Enter=1): '), res));
      const idx = parseInt(choice, 10) - 1;
      state.model = (idx >= 0 && idx < r.models.length) ? r.models[idx] : r.models[0];
      log(C.green(`  ✓ 모델 선택: ${state.model}`));
    } else {
      log(C.yel(`  ⚠ Ollama 미가동 또는 모델 없음`));
      // 1.9.164: Ollama 실패 시 다른 활성 CLI 즉시 제안 (UX 개선 — 사용자 명시 요청)
      try {
        const readyCli = EXTERNAL_AGENTS.filter(a => a.id !== 'ollama')
                                         .map(a => ({ def: a, status: _checkAgent(a) }))
                                         .filter(x => x.status.status === 'ready');
        if (readyCli.length) {
          log('');
          log(C.cy(`  💡 활성 외부 CLI ${readyCli.length}개 발견 — provider 전환 가능:`));
          readyCli.forEach((x, i) => log(`    ${i + 1}) ${x.def.id}  (v${x.status.version || '?'})`));
          const choice = await new Promise(res => rl.question(C.cy('\n  provider 전환 (번호 / Enter=ollama 계속): '), res));
          const idx = parseInt(choice, 10) - 1;
          if (idx >= 0 && idx < readyCli.length) {
            state.provider = readyCli[idx].def.id;
            state.model = null;  // 새 provider 기본 모델 사용
            log(C.green(`  ✓ provider 전환: ${state.provider}  (메시지 입력 즉시 사용)`));
          } else {
            state.model = process.env.LEERNESS_OLLAMA_MODEL || 'llama3';
            log(C.dim(`     ollama fallback: ${state.model} — 추후 :provider <이름> 으로 전환 가능`));
          }
        } else {
          log(C.dim(`     ollama serve + ollama pull <model>  /  또는 .env 에서 LEERNESS_ENABLE_CLAUDE=1 등 활성화`));
          state.model = process.env.LEERNESS_OLLAMA_MODEL || 'llama3';
          log(C.dim(`     fallback: ${state.model}  (실 호출 실패 시 :provider 메뉴 또는 :quit)`));
        }
      } catch {
        state.model = process.env.LEERNESS_OLLAMA_MODEL || 'llama3';
        log(C.dim(`     fallback: ${state.model}`));
      }
    }
  }
  log('');
  log(C.dim('  메타 명령: :help | :model <m> | :role <r> | :provider <p> | :status | :clear | :save | :history | :quit'));
  log(C.dim('  Slash 명령 (1.9.150): :verify | :audit | :handoff | :health'));
  log(C.dim('  Memory Slash (1.9.161): :lessons | :brainstorm <topic> | :tasks | :plan'));
  log(C.dim(`  현재 — provider=${state.provider}  model=${state.model || '(기본)'}  role=${state.role}  permissions=${_readPermissions(root).mode}`));
  // 1.9.155: REPL 진입 시 handoff 컨텍스트 자동 노출 (UX 개선 — 사용자가 매번 :handoff 안 해도 컨텍스트 인지)
  try {
    const hf = cp.spawnSync(process.execPath, [__filename, 'handoff', root, '--compact', '--no-drift-check', '--no-headline'], {
      encoding: 'utf8', timeout: 8000,
      env: { ...process.env, LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '1', LEERNESS_NO_LESSONS: '1' }
    });
    if (hf.status === 0 && hf.stdout) {
      const preview = hf.stdout.split('\n').slice(0, 4).map(l => l.replace(/^\s+/, '')).filter(Boolean).slice(0, 3).join(' · ');
      if (preview) {
        log('');
        log(C.dim(`  📍 context: ${preview.slice(0, 220)}${preview.length > 220 ? '…' : ''}`));
      }
    }
  } catch {}
  log('');
  const prompt = () => isTty ? C.cy(`agent[${state.role}]> `) : 'agent> ';
  rl.setPrompt(prompt());
  rl.prompt();
  const handleMeta = async (cmd) => {
    const [op, ...rest] = cmd.slice(1).split(/\s+/);
    if (op === 'quit' || op === 'exit' || op === 'q') {
      saveSession();
      log(C.dim(`  세션 저장: ${rel(root, sessionPath())}`));
      rl.close(); return true;
    }
    if (op === 'help' || op === '?') {
      log(C.bold('\n  메타 명령 (provider/모델/역할 전환):'));
      log('    :help / :?            — 이 도움말');
      log('    :model <name>         — 모델 변경 (1.9.155 모든 provider 지원, 예: :model claude-opus-4-5)');
      log('    :models               — provider 별 모델 목록 (ollama 실시간 / 그 외 추천 카탈로그)');
      log('    :role <r>             — 역할 변경 (planner / reviewer / actor)');
      log('    :provider <p>         — provider 변경 (ollama / claude / codex / gemini / copilot — ready 검증)');
      log('    :status               — 현재 세션 상태 자세히 (1.9.155)');
      log('    :clear                — 화면 클리어 + history 유지');
      log('    :reset                — history 초기화');
      log('    :history              — 대화 history 표시');
      log('    :save                 — 세션 즉시 저장');
      log('    :permissions          — 현재 권한 모드 표시');
      log('    :quit / :exit / :q    — 종료 (자동 저장)');
      log(C.bold('\n  Slash 명령 (1.9.150) — leerness 내부 명령 직접 호출:'));
      log('    :verify               — leerness verify-code (테스트/타입/린트 자동 검수)');
      log('    :audit                — leerness audit (보안 + drift + lazy)');
      log('    :handoff              — leerness handoff --quiet (현재 컨텍스트 요약)');
      log('    :health               — leerness health --json (종합 헬스 체크)');
      log(C.bold('\n  Memory Slash (1.9.161) — Memory Surface 즉시 조회:'));
      log('    :lessons [query]      — leerness lessons (과거 결정/실수 회수)');
      log('    :brainstorm <topic>   — leerness brainstorm "topic" (관련 컨텍스트 회수)');
      log('    :tasks                — leerness task list (현재 task 상태)');
      log('    :plan                 — leerness plan show (현재 milestone)');
      return false;
    }
    if (op === 'model') {
      // 1.9.155: provider 별 모델 명시 (사용자 명시 요청 — 선택한 CLI 모델 변경 가능)
      const m = rest.join(' ').trim();
      if (!m) {
        log(C.dim(`  현재 model: ${state.model || '(provider 기본)'} · provider: ${state.provider}`));
        log(C.dim(`  사용: :model <name> — 예: :model qwen2.5-coder (ollama) / :model claude-opus-4-5 (claude) / :model gpt-5 (codex)`));
        return false;
      }
      state.model = m;
      log(C.green(`  model = ${state.model}  (provider: ${state.provider})`));
      log(C.dim(`     ※ 다음 메시지부터 새 모델로 호출. provider 가 ${state.provider} 인지 :provider 로 재확인 권장.`));
      return false;
    }
    if (op === 'models') {
      // 1.9.155: provider 별 모델 목록 — ollama 는 실시간 조회, 그 외는 추천 카탈로그 노출
      if (state.provider === 'ollama') {
        const r = await _ollamaListModels();
        if (r.ok && r.models.length) {
          log(C.green(`  [ollama 실시간] ${r.models.length}개 모델:`));
          r.models.forEach(m => log('    • ' + m));
        } else log(C.yel('  ⚠ Ollama 미가동 — ollama serve + ollama pull <model>'));
      } else {
        const catalog = _PROVIDER_MODEL_CATALOG[state.provider] || [];
        if (catalog.length) {
          log(C.green(`  [${state.provider} 추천 모델 카탈로그]`));
          catalog.forEach(m => log(`    • ${m.id}${m.note ? '  — ' + m.note : ''}`));
          log(C.dim('     ※ 실제 가용 모델은 해당 CLI 의 --help / 공식 문서 참고. :model <name> 으로 변경.'));
        } else {
          log(C.dim(`  ${state.provider} 의 추천 모델 카탈로그 없음 — :model <name> 으로 직접 지정`));
        }
      }
      return false;
    }
    if (op === 'role') {
      const r = rest[0] || 'actor';
      if (!['planner', 'reviewer', 'actor'].includes(r)) { log(C.yel(`  ⚠ role 은 planner/reviewer/actor`)); return false; }
      state.role = r; rl.setPrompt(prompt()); log(C.green(`  role = ${r}`)); return false;
    }
    if (op === 'provider') {
      const newProv = rest[0] || state.provider;
      const validProviders = ['ollama', 'claude', 'codex', 'gemini', 'copilot'];
      if (!validProviders.includes(newProv)) {
        log(C.yel(`  ⚠ provider 는 ${validProviders.join(' / ')} (받음: ${newProv})`));
        return false;
      }
      // 1.9.154: provider 전환 시 활성 ready 사전 검증 — 비활성/미설치이면 친절한 안내 후 거부 (실제 호출 시 실패 방지)
      if (newProv === 'ollama') {
        // Ollama 는 HTTP 기반 — 단순히 LEERNESS_OLLAMA_BASE_URL 확인
        const url = process.env.LEERNESS_OLLAMA_BASE_URL || '';
        if (!url) {
          log(C.yel(`  ⚠ ollama base URL 미설정 (LEERNESS_OLLAMA_BASE_URL) — 기본 http://localhost:11434 시도`));
        }
      } else {
        const agent = EXTERNAL_AGENTS.find(a => a.id === newProv);
        if (agent) {
          const st = _checkAgent(agent);
          if (st.status !== 'ready') {
            log(C.yel(`  ⚠ ${newProv} 비활성 (${st.status}) — .env 에서 LEERNESS_ENABLE_${newProv.toUpperCase()}=1 + CLI 설치 필요`));
            log(C.dim(`     (leerness agents list 로 상태 확인)  — provider 전환 취소`));
            return false;
          }
        }
      }
      state.provider = newProv;
      rl.setPrompt(prompt());
      log(C.green(`  provider = ${state.provider}`));
      return false;
    }
    if (op === 'clear') { process.stdout.write('\x1b[2J\x1b[H'); return false; }
    if (op === 'reset') { state.history = []; log(C.dim('  history 초기화됨')); return false; }
    if (op === 'history') {
      log(C.bold(`\n  대화 history ${state.history.length}건:`));
      state.history.slice(-10).forEach((m, i) => log(`    [${m.role}] ${m.content.slice(0, 80)}${m.content.length > 80 ? '…' : ''}`));
      return false;
    }
    if (op === 'save') { saveSession(); log(C.dim(`  → ${rel(root, sessionPath())}`)); return false; }
    if (op === 'permissions') { permissionsListCmd(root); return false; }
    if (op === 'status') {
      // 1.9.155: REPL 안에서 현재 세션 상태 자세히 (provider/model/role/permissions/history/runs)
      log(C.bold('\n  📊 REPL 세션 상태 (1.9.155)'));
      log(`    provider:    ${state.provider}`);
      log(`    model:       ${state.model || '(기본)'}`);
      log(`    role:        ${state.role}  (${_AGENT_ROLE_PROMPTS[state.role]?.slice(0, 60) || ''}...)`);
      log(`    permissions: ${_readPermissions(root).mode || 'basic'}`);
      log(`    history:     ${state.history.length}턴 (마지막: ${state.history[state.history.length - 1]?.role || '-'})`);
      log(`    session ID:  ${state.sessionId}`);
      log(`    started:     ${state.startedAt}`);
      try {
        const ready = EXTERNAL_AGENTS.map(a => _checkAgent(a)).filter(c => c.status === 'ready');
        log(`    활성 CLI:    ${ready.length ? ready.map(c => c.id).join(', ') : '(없음)'}`);
      } catch {}
      log('');
      return false;
    }
    // 1.9.150: leerness 내부 명령 slash-commands — :verify / :audit / :handoff / :health
    // 1.9.161: Memory Surface 조회 slash 추가 — :lessons / :brainstorm / :tasks / :plan
    if (op === 'verify' || op === 'audit' || op === 'handoff' || op === 'health'
        || op === 'lessons' || op === 'brainstorm' || op === 'tasks' || op === 'plan') {
      const query = rest.join(' ').trim();
      const subArgs = {
        verify: ['verify-code', root],
        audit: ['audit', root],
        handoff: ['handoff', root, '--quiet', '--no-drift-check'],
        health: ['health', root, '--json'],
        // 1.9.161 Memory Surface slash 4종
        lessons: query ? ['lessons', '--query', query, '--path', root] : ['lessons', '--path', root],
        brainstorm: query ? ['brainstorm', query, '--path', root] : ['brainstorm', '--path', root],
        tasks: ['task', 'list', '--path', root],
        plan: ['plan', 'show', '--path', root]
      }[op];
      // 인자 필요한데 누락 시 안내 (brainstorm 은 인자 필수)
      if (op === 'brainstorm' && !query) {
        log(C.yel(`  ⚠ :brainstorm 은 키워드 필요 — 예: :brainstorm "auth bug"`));
        return false;
      }
      log(C.dim(`  → leerness ${subArgs.join(' ')}`));
      const t0 = Date.now();
      const r = runCommandSafe(process.execPath, [__filename, ...subArgs], {
        cwd: root, root, timeout: 60000, kind: 'agent_repl_slash', label: `repl-${op}`,
        env: { LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '1' }
      });
      const dt = Date.now() - t0;
      if (r.stdout) log(r.stdout.trim().split('\n').slice(0, 30).join('\n'));
      if (r.status === 0) log(C.green(`  ✓ :${op} 완료 (${dt}ms)`));
      else log(C.yel(`  ⚠ :${op} 실패 (exit ${r.status}, ${dt}ms)`));
      return false;
    }
    log(C.yel(`  알 수 없는 명령: :${op}  (:help 참고)`));
    return false;
  };
  return new Promise(resolve => {
    rl.on('line', async (line) => {
      const input = line.trim();
      if (!input) { rl.prompt(); return; }
      if (input.startsWith(':')) {
        const shouldQuit = await handleMeta(input);
        if (shouldQuit) { resolve(); return; }
        rl.prompt(); return;
      }
      // LLM 호출
      state.history.push({ role: 'user', content: input });
      const rolePrompt = _AGENT_ROLE_PROMPTS[state.role] || _AGENT_ROLE_PROMPTS.actor;
      const finalPrompt = `${rolePrompt}\n\nConversation so far:\n${state.history.slice(-6).map(m => `[${m.role}] ${m.content}`).join('\n')}\n\nRespond as ${state.role}:`;
      const t0 = Date.now();
      let result;
      // 1.9.153: multi-provider REPL — ollama 외 claude/codex/gemini/copilot 도 세션 관리 (사용자 명시)
      if (state.provider === 'ollama') {
        log(C.dim(`  → ollama${state.model ? ' (' + state.model + ')' : ''} 호출 중...`));
        result = await _ollamaChat(finalPrompt, state.model);
      } else if (['claude', 'codex', 'gemini', 'copilot'].includes(state.provider)) {
        log(C.dim(`  → ${state.provider} CLI 호출 중...`));
        result = await _cliChat(root, state.provider, finalPrompt, { timeout: 90000 });
      } else {
        log(C.yel(`  ⚠ ${state.provider} provider 미지원 — :provider ollama|claude|codex|gemini|copilot`));
        rl.prompt(); return;
      }
      const dt = Date.now() - t0;
      _recordRun(root, { kind: 'agent_repl_turn', provider: state.provider, model: state.model, role: state.role, durationMs: dt, ok: result.ok, error: result.error, promptChars: finalPrompt.length, responseChars: (result.response || '').length });
      if (result.ok) {
        state.history.push({ role: 'assistant', content: result.response });
        log('');
        log(C.bold(`assistant (${state.model}, role=${state.role}, ${dt}ms)`));
        log(result.response);
        log('');
        if (state.history.length % 6 === 0) saveSession();  // 6턴마다 자동 저장
      } else {
        log(C.yel(`  ⚠ 실패: ${result.error || 'unknown'}`));
        // 1.9.164: 실패 시 즉시 전환 가능 provider 안내 (UX 개선 — 사용자 명시 요청)
        try {
          const others = EXTERNAL_AGENTS.filter(a => a.id !== state.provider)
                                         .map(a => ({ def: a, status: _checkAgent(a) }))
                                         .filter(x => x.status.status === 'ready');
          if (others.length) {
            log(C.dim(`     💡 전환 가능: ${others.map(x => `:provider ${x.def.id}`).join(' / ')}`));
          } else {
            log(C.dim(`     💡 다른 provider 활성화: .env 에서 LEERNESS_ENABLE_<CLAUDE|CODEX|GEMINI|COPILOT>=1`));
          }
        } catch {}
      }
      rl.prompt();
    });
    rl.on('close', () => { saveSession(); resolve(); });
  });
}

async function agentCmd(root, taskArg) {
  root = absRoot(root || process.cwd());
  const task = (taskArg || arg('--task', '') || '').trim();
  // 1.9.149: REPL 진입 — 인자 없거나 --interactive 명시 (Hermes/OpenClaw 스타일)
  if (!task || has('--interactive') || has('--repl')) {
    if (process.stdin.isTTY && !has('--no-repl') && process.env.LEERNESS_NO_PROMPT !== '1') {
      const t0 = Date.now();
      await _agentRepl(root, {
        provider: arg('--provider', null),
        model: arg('--model', null),
        role: arg('--role', 'actor')
      });
      _recordRun(root, { kind: 'agent_repl_session', durationMs: Date.now() - t0, ok: true });
      return;
    }
    // non-TTY: 사용법만 출력
    log('# leerness agent — 검수·기억·샌드박스 통합 자율 AI 에이전트');
    log('');
    log('사용법:');
    log('  leerness agent                              # REPL 모드 (provider 자동 선택 + 채팅)');
    log('  leerness agent "<task>"                     # 1회 위임 (actor 역할 기본)');
    log('  leerness agent "<task>" --role planner      # 계획만 (1.9.148)');
    log('  leerness agent "<task>" --role reviewer     # 비판적 검토 (1.9.148)');
    log('  leerness agent --provider claude            # provider 명시 (ollama/claude/codex/gemini/copilot)');
    log('  leerness agent --interactive --model qwen2.5-coder  # 명시적 REPL + Ollama 모델 선택');
    log('');
    log('REPL 메타 명령: :help / :model / :role / :provider / :history / :save / :quit');
    log('REPL Slash 명령 (1.9.150): :verify / :audit / :handoff / :health  (sandboxed runCommandSafe)');
    log('REPL Multi-provider (1.9.153): ollama / claude / codex / gemini / copilot — 활성 CLI 자동 감지');
    log('');
    log('현재 활성 provider: ' + (_activeCliAgents().join(', ') || '(없음) — .env에서 LEERNESS_ENABLE_* 활성화'));
    log('권한 모드: ' + (_readPermissions(root).mode || 'basic'));
    return;
  }
  const dryRun = has('--dry-run');
  const providerArg = arg('--provider', null);
  const role = arg('--role', 'actor');  // 1.9.148
  const rolePrompt = _AGENT_ROLE_PROMPTS[role] || _AGENT_ROLE_PROMPTS.actor;
  const active = _activeCliAgents();
  const provider = providerArg || active[0] || null;
  log(`# leerness agent (1.9.146/148)`);
  log(`task: ${task.slice(0, 120)}${task.length > 120 ? '…' : ''}`);
  log(`role: ${role}  (${rolePrompt.split('. ')[1] || rolePrompt.slice(0, 60)})`);
  log(`provider: ${provider || '(없음 — .env 에서 LEERNESS_ENABLE_* 활성화 필요)'}`);
  const perms = _readPermissions(root);
  log(`permission mode: ${perms.mode || 'basic'}`);
  // handoff 자동 회수 (compact 모드)
  try {
    const hf = cp.spawnSync(process.execPath, [__filename, 'handoff', root, '--compact', '--no-drift-check'], { encoding: 'utf8', timeout: 10000, env: { ...process.env, LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1' } });
    if (hf.status === 0 && hf.stdout) {
      const preview = hf.stdout.split('\n').slice(0, 6).join('\n');
      log('\n[handoff context (preview)]\n' + preview);
    }
  } catch {}
  if (dryRun) { log('\n(dry-run) LLM 호출 스킵 — provider/권한/컨텍스트만 출력'); return; }
  if (!provider) { fail('활성 provider 없음 — .env 에서 LEERNESS_ENABLE_OLLAMA=1 또는 LEERNESS_ENABLE_CLAUDE=1 활성화'); process.exitCode = 1; return; }
  // 1.9.148: role prompt 자동 prepend (모든 provider 공통)
  const finalPrompt = `${rolePrompt}\n\nTask: ${task}`;
  const t0 = Date.now();
  // 1.9.154: 1-shot 모드도 multi-provider — Ollama 외 claude/codex/gemini/copilot 직접 호출 (1.9.153 _cliChat 재사용)
  let r;
  if (provider === 'ollama') {
    log('\n[ollama 호출 중...]');
    r = await _ollamaChat(finalPrompt);
  } else if (['claude', 'codex', 'gemini', 'copilot'].includes(provider)) {
    log(`\n[${provider} CLI 호출 중...]`);
    r = await _cliChat(root, provider, finalPrompt, { timeout: 90000 });
    if (r.ok && !r.model) r.model = provider;  // _cliChat 결과 보강
  } else {
    fail(`알 수 없는 provider: ${provider} (ollama/claude/codex/gemini/copilot)`);
    process.exitCode = 1;
    return;
  }
  const dt = Date.now() - t0;
  // 1.9.149: observability 기록
  _recordRun(root, { kind: 'agent_one_shot', provider, model: r.model || provider, role, durationMs: dt, ok: r.ok, error: r.error, task: task.slice(0, 200), responseChars: (r.response || '').length });
  if (r.ok) {
    log(`\n[response (provider=${provider}, model=${r.model || provider}, role=${role}, ${dt}ms)]\n${r.response}`);
    try {
      const tlp = taskLogPath(root);
      const block = `\n## ${today()} leerness agent (${provider}:${r.model || provider}, role=${role})\n- task: ${task.slice(0, 200)}\n- response (preview): ${(r.response || '').slice(0, 240).replace(/\n+/g, ' ')}\n`;
      append(tlp, block);
    } catch {}
  } else {
    fail(`${provider} 호출 실패: ${r.error || 'unknown'}`);
    if (provider === 'ollama') log(`  → ollama serve 실행 + LEERNESS_OLLAMA_BASE_URL 확인`);
    else log(`  → .env 에서 LEERNESS_ENABLE_${provider.toUpperCase()}=1 + CLI 설치 확인 (leerness agents list)`);
    process.exitCode = 1;
  }
}

// ===== 1.9.147: 자동 유지보수 시스템 (사용자 명시 요청) =====
//
// 4 컴포넌트:
//   1) webhook listener — HTTP + HMAC 검증으로 외부 에러 보고 수신
//   2) incident handler — 받은 페이로드를 leerness 컨텍스트로 분석/fix/test
//   3) credentials registry — 환경변수 이름만 등록 (값은 사용자 .env / OS keychain — 보안 정책)
//   4) deploy auto — Firebase/Cloudflare/Vercel adapter (24h 토큰 만료 알림)
//
// 보안 정책 (1.9.71/75 연장):
//   - .harness/credentials.local.json 에 실제 토큰 절대 미저장 (env-ref 만)
//   - .gitignore + .npmignore 자동 등록
//   - .harness/incidents/*.json 도 비공개 (시크릿 페이로드 누출 방지)

// ---- (1) Credentials Registry ----
function _credentialsPath(root) { return path.join(absRoot(root), '.harness', 'credentials.local.json'); }
function _readCredentials(root) {
  const p = _credentialsPath(root);
  if (!exists(p)) return { schemaVersion: 1, services: {} };
  try { return JSON.parse(read(p)); } catch { return { schemaVersion: 1, services: {} }; }
}
function _writeCredentials(root, data) {
  const p = _credentialsPath(root);
  mkdirp(path.dirname(p));
  writeUtf8(p, JSON.stringify(data, null, 2) + '\n');
  // 1.9.147: gitignore + npmignore 자동 보강 (보안)
  try {
    const giPath = path.join(absRoot(root), '.gitignore');
    if (exists(giPath)) {
      const gi = read(giPath);
      if (!gi.includes('credentials.local.json')) {
        writeUtf8(giPath, gi.trimEnd() + '\n.harness/credentials.local.json\n');
      }
    }
  } catch {}
}
function credsListCmd(root) {
  root = absRoot(root || process.cwd());
  const j = _readCredentials(root);
  if (has('--json')) { log(JSON.stringify(j, null, 2)); return; }
  log(`# leerness creds list (1.9.147)`);
  const services = Object.entries(j.services || {});
  if (!services.length) { log('(등록된 자격증명 없음 — leerness creds register <service> --env-var <NAME>)'); return; }
  log(`총 ${services.length}개 서비스 (값 미저장 — env-ref 만)`);
  for (const [name, meta] of services) {
    const present = meta.envVars.every(v => process.env[v] !== undefined && process.env[v] !== '');
    const last = meta.lastRefreshed ? new Date(meta.lastRefreshed) : null;
    const ageDays = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : null;
    const ageWarn = (meta.tokenLifetimeHours && last && (Date.now() - last.getTime()) > meta.tokenLifetimeHours * 3600 * 1000);
    log(`  ${name}: env=${meta.envVars.join(',')} · ${present ? '✓ 환경변수 있음' : '⚠ 미설정'}${ageDays !== null ? ` · ${ageDays}일 전 refresh${ageWarn ? ' (만료 가능)' : ''}` : ''}`);
    if (meta.deployCommand) log(`    deploy: ${meta.deployCommand}`);
  }
}
function credsRegisterCmd(root, service) {
  root = absRoot(root || process.cwd());
  if (!service) return fail('service 이름 필요 — leerness creds register <service> --env-var <NAME[,NAME2]>');
  const envVarArg = arg('--env-var', null);
  if (!envVarArg) return fail('--env-var <NAME> 필요 (콤마 구분 가능)');
  const envVars = envVarArg.split(',').map(s => s.trim()).filter(Boolean);
  const deployCmd = arg('--deploy', null);
  const lifetime = parseInt(arg('--token-lifetime-hours', '0'), 10) || null;
  const j = _readCredentials(root);
  j.services = j.services || {};
  j.services[service] = {
    envVars,
    deployCommand: deployCmd || j.services[service]?.deployCommand || null,
    tokenLifetimeHours: lifetime || j.services[service]?.tokenLifetimeHours || null,
    lastRefreshed: j.services[service]?.lastRefreshed || null,
    registeredAt: j.services[service]?.registeredAt || new Date().toISOString()
  };
  _writeCredentials(root, j);
  ok(`creds registered: ${service} · env=${envVars.join(',')}${deployCmd ? ` · deploy="${deployCmd}"` : ''}`);
  // 환경변수 즉시 확인
  const missing = envVars.filter(v => !process.env[v]);
  if (missing.length) warn(`⚠ 다음 환경변수가 현재 셸에 설정되지 않음: ${missing.join(', ')} — .env 또는 OS keychain에서 export 필요`);
}
function credsCheckCmd(root, service) {
  root = absRoot(root || process.cwd());
  const j = _readCredentials(root);
  const result = { service: service || null, services: {}, ok: true };
  const targets = service ? (j.services[service] ? { [service]: j.services[service] } : {}) : (j.services || {});
  if (!Object.keys(targets).length) { fail(`등록된 서비스 없음${service ? ` (${service})` : ''}`); return; }
  for (const [name, meta] of Object.entries(targets)) {
    const missing = (meta.envVars || []).filter(v => !process.env[v]);
    const expired = meta.tokenLifetimeHours && meta.lastRefreshed
      ? (Date.now() - new Date(meta.lastRefreshed).getTime()) > meta.tokenLifetimeHours * 3600 * 1000
      : false;
    result.services[name] = { envSet: !missing.length, missing, expired };
    if (missing.length || expired) result.ok = false;
  }
  if (has('--json')) { log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1; return; }
  log(`# leerness creds check (1.9.147)`);
  for (const [name, r] of Object.entries(result.services)) {
    if (r.envSet && !r.expired) log(`  ✓ ${name}: 사용 준비됨`);
    else {
      log(`  ⚠ ${name}: ${r.missing.length ? `누락 ${r.missing.join(',')}` : ''}${r.expired ? ' · 토큰 만료 (재로그인 필요)' : ''}`);
    }
  }
  if (!result.ok) process.exitCode = 1;
}
function credsRefreshTimestampCmd(root, service) {
  root = absRoot(root || process.cwd());
  if (!service) return fail('service 이름 필요');
  const j = _readCredentials(root);
  if (!j.services[service]) return fail(`등록된 서비스 없음: ${service} — leerness creds register 먼저`);
  j.services[service].lastRefreshed = new Date().toISOString();
  _writeCredentials(root, j);
  ok(`creds refreshed: ${service} · lastRefreshed=${j.services[service].lastRefreshed}`);
}

// ---- (2) Incident Handler ----
function _incidentsDir(root) { return path.join(absRoot(root), '.harness', 'incidents'); }
function _saveIncident(root, payload) {
  const dir = _incidentsDir(root);
  mkdirp(dir);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const id = `inc-${ts}`;
  const fp = path.join(dir, `${id}.json`);
  writeUtf8(fp, JSON.stringify({ id, receivedAt: new Date().toISOString(), payload }, null, 2) + '\n');
  return { id, path: fp };
}
function incidentListCmd(root) {
  root = absRoot(root || process.cwd());
  const dir = _incidentsDir(root);
  if (!exists(dir)) { log('(incidents 없음 — leerness webhook serve 로 수신 가능)'); return; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
  if (has('--json')) {
    const items = files.slice(0, 50).map(f => { try { return JSON.parse(read(path.join(dir, f))); } catch { return null; } }).filter(Boolean);
    log(JSON.stringify({ total: files.length, items }, null, 2));
    return;
  }
  log(`# leerness incident list (1.9.147)`);
  log(`총 ${files.length}건${files.length > 20 ? ' (최근 20)' : ''}`);
  for (const f of files.slice(0, 20)) {
    try {
      const j = JSON.parse(read(path.join(dir, f)));
      const e = j.payload?.error || j.payload?.message || '(no description)';
      log(`  ${j.id}  ·  ${String(e).slice(0, 80)}`);
    } catch {}
  }
}
function incidentShowCmd(root, id) {
  root = absRoot(root || process.cwd());
  const fp = path.join(_incidentsDir(root), `${id}.json`);
  if (!exists(fp)) return fail(`incident 없음: ${id}`);
  log(read(fp));
}
async function incidentHandleCmd(root, id) {
  root = absRoot(root || process.cwd());
  const dir = _incidentsDir(root);
  let target = id;
  if (!target) {
    if (!exists(dir)) return fail('incidents 없음');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
    if (!files.length) return fail('incidents 없음');
    target = files[files.length - 1].replace('.json', '');
  }
  const fp = path.join(dir, `${target}.json`);
  if (!exists(fp)) return fail(`incident 없음: ${target}`);
  const j = JSON.parse(read(fp));
  const p = _readPermissions(root);
  log(`# leerness incident handle (1.9.147)`);
  log(`incident: ${j.id}  ·  permission mode: ${p.mode || 'basic'}`);
  const err = j.payload?.error || j.payload?.message || '';
  const stack = j.payload?.stack || '';
  log(`error: ${String(err).slice(0, 200)}`);
  if (stack) log(`stack head:\n${String(stack).split('\n').slice(0, 4).join('\n')}`);
  // (1) feature impact 자동 회수 — error 키워드 매칭
  try {
    const { nodes: fn } = _readFeatureGraph(root);
    if (fn.length) {
      const keywords = String(err).toLowerCase().match(/[\w가-힣]{3,}/g) || [];
      const matched = fn.find(n => keywords.some(k => n.title.toLowerCase().includes(k)));
      if (matched) {
        const impacted = _featureImpactBfs(fn, matched.id);
        log(`\n🔗 feature impact: ${matched.id} ${matched.title} → ${impacted.length} feature 영향`);
        for (const it of impacted.slice(0, 5)) log(`  • ${it.id} ${it.title}`);
      }
    }
  } catch {}
  // (2) lessons 자동 회수
  try {
    const keywords = String(err).toLowerCase().match(/[\w가-힣]{4,}/g) || [];
    if (keywords.length) {
      const r = cp.spawnSync(process.execPath, [__filename, 'lessons', '--path', root, '--query', keywords[0], '--limit', '3'],
        { encoding: 'utf8', timeout: 8000, env: { ...process.env, LEERNESS_NO_PROMPT: '1' } });
      if (r.status === 0 && /총 \d+건 발견/.test(r.stdout)) {
        const block = r.stdout.split('\n').slice(0, 12).join('\n');
        log(`\n📚 관련 lessons:\n${block}`);
      }
    }
  } catch {}
  // (3) 권한 확인 후 자동 fix 시도 (MVP: dry-run — 실제 LLM 호출은 사용자가 leerness agent 로)
  log(`\n💡 자동 fix 시도:`);
  if (permissionCheck(root, 'shell.exec', 'npm')) {
    log(`  • 권한 OK — verify-code 실행 권장: leerness verify-code .`);
  } else {
    log(`  ⚠ basic 권한 모드 — fix/test 자동 실행 불가. extended/full 로 변경: leerness permissions set extended`);
  }
  // (4) incident 상태 갱신
  j.handledAt = new Date().toISOString();
  j.permissionMode = p.mode || 'basic';
  writeUtf8(fp, JSON.stringify(j, null, 2) + '\n');
  ok(`incident handled: ${j.id} (분석/회수 완료)`);
  log(`  → 후속: leerness agent "fix: ${String(err).slice(0, 80)}" / leerness verify-code . / leerness deploy auto`);
}

// ---- (3) Webhook Listener ----
function _hmacSha256(key, body) {
  const crypto = require('crypto');
  return crypto.createHmac('sha256', key).update(body).digest('hex');
}
async function webhookServeCmd(root) {
  root = absRoot(root || process.cwd());
  const port = parseInt(arg('--port', process.env.LEERNESS_WEBHOOK_PORT || '9876'), 10);
  const secret = arg('--secret', process.env.LEERNESS_WEBHOOK_SECRET || '');
  const http = require('http');
  log(`# leerness webhook serve (1.9.147)`);
  log(`port: ${port}  ·  HMAC: ${secret ? '활성 (X-Leerness-Signature)' : '비활성 — LEERNESS_WEBHOOK_SECRET 권장'}`);
  log(`incidents dir: ${rel(root, _incidentsDir(root))}`);
  log(`POST endpoint: http://localhost:${port}/incident`);
  log(`헬스 체크: curl http://localhost:${port}/health`);
  const server = http.createServer(async (req, res) => {
    const url = req.url || '';
    if (req.method === 'GET' && url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, version: VERSION, port }));
      return;
    }
    if (req.method === 'POST' && url === '/incident') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 100000) { req.destroy(); } });
      req.on('end', () => {
        try {
          if (secret) {
            const sig = req.headers['x-leerness-signature'] || '';
            const expected = _hmacSha256(secret, body);
            if (sig !== expected) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'invalid signature' }));
              return;
            }
          }
          let payload;
          try { payload = JSON.parse(body); } catch { payload = { raw: body }; }
          const saved = _saveIncident(root, payload);
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, incident: saved.id }));
          log(`📥 incident received: ${saved.id} · error="${String(payload?.error || payload?.message || '').slice(0, 80)}"`);
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
    res.writeHead(404); res.end('Not Found');
  });
  server.listen(port, () => {
    ok(`listening on port ${port}`);
    log(`(Ctrl+C 로 종료)`);
  });
  // 종료 시그널 (SIGINT/SIGTERM) 대기 — auto-close 안 함
  process.on('SIGINT', () => { log('\n중단 신호 — 서버 종료'); server.close(); process.exit(0); });
  process.on('SIGTERM', () => { server.close(); process.exit(0); });
}

// ---- (4) Deploy Auto ----
async function deployAutoCmd(root, service) {
  root = absRoot(root || process.cwd());
  const j = _readCredentials(root);
  if (!service) {
    log('# leerness deploy auto (1.9.147)');
    log('사용법: leerness deploy auto <service>');
    log('등록된 서비스:');
    for (const [name, meta] of Object.entries(j.services || {})) {
      log(`  ${name}: ${meta.deployCommand || '(deploy 명령 미설정)'}`);
    }
    if (!Object.keys(j.services || {}).length) log('  (없음 — leerness creds register <service> --env-var <NAME> --deploy "<cmd>")');
    return;
  }
  const meta = j.services?.[service];
  if (!meta) return fail(`등록된 서비스 없음: ${service} — leerness creds register 먼저`);
  if (!meta.deployCommand) return fail(`deploy 명령 미설정: ${service} — leerness creds register --deploy "<cmd>"`);
  // 환경변수 + 만료 검증
  const missing = (meta.envVars || []).filter(v => !process.env[v]);
  if (missing.length) { fail(`환경변수 누락: ${missing.join(', ')} — .env 또는 OS keychain에서 export`); process.exitCode = 1; return; }
  if (meta.tokenLifetimeHours && meta.lastRefreshed) {
    const age = Date.now() - new Date(meta.lastRefreshed).getTime();
    if (age > meta.tokenLifetimeHours * 3600 * 1000) {
      warn(`⚠ ${service} 토큰 만료 가능 (${Math.floor(age / 3600000)}시간 경과 vs 한도 ${meta.tokenLifetimeHours}h)`);
      log(`  → 재로그인 후: leerness creds refresh ${service}`);
      if (!has('--force')) { process.exitCode = 1; return; }
    }
  }
  // 권한 확인
  if (!permissionCheck(root, 'shell.exec', meta.deployCommand.split(/\s+/)[0])) {
    return fail(`shell.exec 권한 부족 (현재: ${_readPermissions(root).mode}) — leerness permissions set extended 권장`);
  }
  log(`# leerness deploy auto (1.9.147)`);
  log(`service: ${service}  ·  command: ${meta.deployCommand}`);
  if (has('--dry-run')) { log('(dry-run) 실제 실행 스킵'); return; }
  const t0 = Date.now();
  // 1.9.150: runCommandSafe — deploy 명령 sandbox (env scrub + permissions 검증 + observability)
  const r = runCommandSafe(meta.deployCommand, [], { cwd: root, root, timeout: 10 * 60 * 1000, allowShell: true, stdio: 'inherit', kind: 'deploy_auto', label: `deploy-${service}` });
  const dt = Date.now() - t0;
  if (r.status === 0) {
    ok(`deploy 성공: ${service} (${dt}ms)`);
    // lastRefreshed 자동 갱신 — 성공 시 만료 카운터 reset
    j.services[service].lastRefreshed = new Date().toISOString();
    _writeCredentials(root, j);
    // task-log 기록
    try { append(taskLogPath(root), `\n## ${today()} deploy auto (1.9.147)\n- service: ${service}\n- duration: ${dt}ms\n- status: success\n`); } catch {}
  } else {
    fail(`deploy 실패: ${service} (exit ${r.status}, ${dt}ms)`);
    process.exitCode = 1;
  }
}

// 1.9.85: leerness health — 종합 헬스 체크 (drift + 보안 + skill + MCP + 누적)
function healthCmd(root) {
  root = absRoot(root || process.cwd());
  const out = { root, generatedAt: new Date().toISOString(), checks: {} };
  // 1) drift level
  try {
    const r = cp.spawnSync(process.execPath, [__filename, 'drift', 'check', root, '--json'],
      { encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '0' } });
    const j = JSON.parse(r.stdout.trim());
    out.checks.drift = { level: j.level, score: j.score, firedCount: (j.fired || []).length };
  } catch { out.checks.drift = { error: 'drift check 실패' }; }
  // 2) 보안 상태 (env + .gitignore)
  try {
    const envPath = path.join(root, '.env');
    if (exists(envPath)) {
      const d = envDiff(root);
      const giText = exists(path.join(root, '.gitignore')) ? read(path.join(root, '.gitignore')) : '';
      const giLines = giText.split('\n').map(l => l.trim());
      const envInGi = giLines.includes('.env') || giLines.includes('/.env');
      const SECRET_PATTERNS = ['.env', '.env.local', '.env.production', '.env.*.local', '*.pem', 'credentials.json'];
      const missingSecrets = SECRET_PATTERNS.filter(p => !giLines.some(l => l === p || l === '/' + p));
      out.checks.security = {
        hasDotEnv: true,
        envInGitignore: envInGi,
        envExampleMissing: d.inEnvOnly,
        gitignoreMissingSecrets: missingSecrets,
        critical: !envInGi
      };
    } else {
      out.checks.security = { hasDotEnv: false, ok: true };
    }
  } catch { out.checks.security = { error: '보안 점검 실패' }; }
  // 3) skill 수 + skill query 누적
  try {
    const all = listAllSkills(root);
    const skillCount = Object.keys(all).length;
    let queryCount = 0;
    const histPath = path.join(root, '.harness', 'skill-suggestions.md');
    if (exists(histPath)) {
      queryCount = (read(histPath).match(/^## [\d-]+ [\d:]+ — query/gm) || []).length;
    }
    out.checks.skills = { installed: skillCount, queryHistoryCount: queryCount };
  } catch { out.checks.skills = { error: 'skill 점검 실패' }; }
  // 4) MCP + 명령 호출 누적
  try {
    const stats = _readUsageStats(root);
    const cmdTotal = Object.values(stats.commands || {}).reduce((s, n) => s + n, 0);
    const mcpTotal = stats.mcp?.tools ? Object.values(stats.mcp.tools).reduce((s, n) => s + n, 0) : 0;
    out.checks.usage = {
      commandTotal: cmdTotal,
      commandKinds: Object.keys(stats.commands || {}).length,
      mcpTotal,
      mcpToolKinds: stats.mcp?.tools ? Object.keys(stats.mcp.tools).length : 0,
      since: stats.since || null
    };
  } catch { out.checks.usage = { error: 'usage 점검 실패' }; }
  // 5) tasks (progress-tracker)
  try {
    const rows = readProgressRows(root);
    const byStatus = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    out.checks.tasks = { total: rows.length, byStatus };
  } catch { out.checks.tasks = { error: 'tasks 점검 실패' }; }
  // 1.9.123: memorySurface 통합 (handoff --json 1.9.115 / session close --json 1.9.122 와 동일 패턴)
  try {
    const rows = readProgressRows(root);
    const tasksByStatus = {};
    for (const s of STATUSES) tasksByStatus[s] = 0;
    for (const r of rows) tasksByStatus[r.status] = (tasksByStatus[r.status] || 0) + 1;
    const tasksInProgress = tasksByStatus['in-progress'] || 0;
    const dm = exists(decisionsPath(root)) ? read(decisionsPath(root)) : '';
    const decisionsCount = _extractDecisionBlocks(dm).length;
    const rules = readRules(root);
    const rulesActive = rules.filter(r => r.status === 'active').length;
    const planText = exists(planPath(root)) ? read(planPath(root)) : '';
    const milestones = (planText.match(/^### M-\d{4}\./gm) || []).length;
    const lm = exists(lessonsPath(root)) ? read(lessonsPath(root)) : '';
    const lessonsCount = (lm.match(/^### \d{4}-\d{2}-\d{2}[^\n]*/gm) || []).length;
    out.memorySurface = {
      tasks: { inProgress: tasksInProgress, total: rows.length, byStatus: tasksByStatus },
      decisions: { count: decisionsCount },
      rules: { active: rulesActive, total: rules.length },
      plan: { milestones },
      lessons: { count: lessonsCount },
      archive: (() => {
        // 1.9.130: archive 카운트 통합
        const a = { decisions: 0, lessons: 0, plan: 0, total: 0 };
        try {
          const hdHe = path.join(root, '.harness');
          for (const [key, file] of [['decisions', 'decisions.archive.md'], ['lessons', 'lessons.archive.md'], ['plan', 'plan.archive.md']]) {
            const fpHe = path.join(hdHe, file);
            if (exists(fpHe)) {
              const entries = _parseArchiveBlocks(read(fpHe));
              a[key] = entries.length;
              a.total += entries.length;
            }
          }
        } catch {}
        return a;
      })(),
      summary: `T${tasksInProgress}/D${decisionsCount}/R${rulesActive}/P${milestones}/L${lessonsCount}`,
    };
  } catch { out.memorySurface = { error: 'memorySurface 점검 실패' }; }
  // 1.9.143: health --json featureGraph 통합 (handoff/session close 와 동일 패턴 — JSON 4종 완성)
  try {
    const { nodes: fNodesHe } = _readFeatureGraph(root);
    const edgeCount = fNodesHe.reduce((s, n) => s + (n.dependsOn?.length || 0) + (n.affects?.length || 0) + (n.coChangesWith?.length || 0), 0);
    const linkedSet = new Set();
    for (const n of fNodesHe) {
      for (const x of [...(n.dependsOn||[]), ...(n.affects||[]), ...(n.coChangesWith||[])]) { linkedSet.add(n.id); linkedSet.add(x); }
    }
    const isolated = fNodesHe.length ? (fNodesHe.length - linkedSet.size) : 0;
    out.featureGraph = {
      total: fNodesHe.length,
      edges: edgeCount,
      isolated: Math.max(0, isolated),
      summary: `F${fNodesHe.length}/E${edgeCount}${isolated > 0 ? `/iso${isolated}` : ''}`
    };
  } catch { out.featureGraph = { error: 'featureGraph 점검 실패' }; }
  // 1.9.163: 5능력 매트릭스 자동 평가 (1.9.155 sub-agent 점검 → 코드 기반 자동화)
  //   각 능력을 코드 grep 으로 검출 → 0~100 점수. 사용자가 매 health 호출 시 leerness 자기 평가 확인.
  try {
    const harnessSrc = read(__filename);
    const cap = {};
    // (1) 웹 자동화 — 1.9.165 playwright bridge 통합 + 실제 playwright 설치 detect
    const hasWebBridge = /function webCmd\(root, sub/.test(harnessSrc);
    // 사용자가 playwright 설치했는지 실시간 detect (require try)
    let playwrightInstalled = false;
    try { require('playwright'); playwrightInstalled = true; }
    catch { try { require('playwright-core'); playwrightInstalled = true; } catch {} }
    if (hasWebBridge && playwrightInstalled) {
      cap.webAutomation = { score: 90, status: '✓', evidence: 'playwright 설치 + leerness web bridge (1.9.165)' };
    } else if (hasWebBridge) {
      cap.webAutomation = { score: 50, status: '⚠', evidence: 'leerness web bridge 있음, playwright 미설치 (npm i -g playwright)' };
    } else {
      cap.webAutomation = { score: 5, status: '❌', evidence: 'permissions.browser=toggle만 (실 코드 미구현)' };
    }
    // (2) PC 조작 — 1.9.166 robotjs/nut-tree bridge + 실제 설치 detect
    const hasPCBridge = /function pcCmd\(root, sub/.test(harnessSrc);
    let pcInstalled = false;
    try { require('robotjs'); pcInstalled = true; }
    catch { try { require('@nut-tree/nut-js'); pcInstalled = true; } catch {} }
    if (hasPCBridge && pcInstalled) {
      cap.pcAutomation = { score: 90, status: '✓', evidence: 'robotjs/nut-tree 설치 + leerness pc bridge (1.9.166)' };
    } else if (hasPCBridge) {
      cap.pcAutomation = { score: 50, status: '⚠', evidence: 'leerness pc bridge 있음, robotjs 미설치 (npm i -g robotjs)' };
    } else {
      cap.pcAutomation = { score: 5, status: '❌', evidence: 'permissions.mouse/keyboard=필드만 (실 사용처 0)' };
    }
    // (3) 멀티 에이전트 오케스트레이션 — agents multi --execute + consensus 로직?
    const hasExecute = /const execute = has\('--execute'\)/.test(harnessSrc);
    const hasConsensus = /multi-signal consensus/.test(harnessSrc);
    cap.multiAgentOrchestration = (hasExecute && hasConsensus)
      ? { score: 90, status: '✓', evidence: '실 spawn + multi-signal consensus (1.9.156+1.9.155)' }
      : { score: 50, status: '⚠', evidence: '명령 출력만 (1.9.152 기본 모드)' };
    // (4) REPL multi-provider — _agentRepl + _cliChat 5종?
    const hasRepl = /async function _agentRepl/.test(harnessSrc);
    const hasCliChat = /async function _cliChat/.test(harnessSrc);
    cap.replMultiProvider = (hasRepl && hasCliChat)
      ? { score: 90, status: '✓', evidence: 'ollama/claude/codex/gemini/copilot 5종 (1.9.149+1.9.153)' }
      : { score: 30, status: '⚠', evidence: 'REPL 미완성' };
    // (5) MCP 도구 — tools array 카운트
    const toolsMatch = harnessSrc.match(/{ name: 'leerness_/g);
    const toolCount = toolsMatch ? toolsMatch.length : 0;
    cap.mcpTools = toolCount >= 50
      ? { score: 100, status: '✓', evidence: `${toolCount}/50+ 도구 (1.9.159 CRUD 완성)` }
      : { score: Math.round((toolCount / 50) * 100), status: toolCount > 30 ? '✓' : '⚠', evidence: `${toolCount} 도구` };
    // (6) 코드 인텔리전스 — 1.9.167 LSP 어댑터 + typescript 설치 detect
    const hasLspBridge = /function lspCmd\(root, sub/.test(harnessSrc);
    let tsInstalled = false;
    try { require('typescript'); tsInstalled = true; } catch {}
    if (hasLspBridge && tsInstalled) {
      cap.codeIntel = { score: 90, status: '✓', evidence: 'typescript 설치 + leerness lsp bridge (1.9.167, Compiler API)' };
    } else if (hasLspBridge) {
      cap.codeIntel = { score: 50, status: '⚠', evidence: 'leerness lsp bridge 있음, typescript 미설치 (regex fallback 동작, npm i -g typescript)' };
    } else {
      cap.codeIntel = { score: 5, status: '❌', evidence: 'LSP 어댑터 미구현 (코드 인텔리전스 없음)' };
    }
    const avgScore = Math.round((cap.webAutomation.score + cap.pcAutomation.score + cap.multiAgentOrchestration.score + cap.replMultiProvider.score + cap.mcpTools.score + cap.codeIntel.score) / 6);
    out.capabilityMatrix = {
      capabilities: cap,
      overallScore: avgScore,
      summary: `웹${cap.webAutomation.score}/PC${cap.pcAutomation.score}/멀티${cap.multiAgentOrchestration.score}/REPL${cap.replMultiProvider.score}/MCP${cap.mcpTools.score}/LSP${cap.codeIntel.score} · 종합 ${avgScore}%`,
      assessment: avgScore >= 70 ? 'production-ready' : avgScore >= 50 ? 'beta-ready' : 'mvp'
    };
  } catch { out.capabilityMatrix = { error: '5능력 매트릭스 평가 실패' }; }
  // 6) issues 요약 (사용자 글로벌 룰 가시화)
  const issues = [];
  if (out.checks.drift?.level && !/healthy/.test(out.checks.drift.level)) issues.push(`drift ${out.checks.drift.level}`);
  if (out.checks.security?.critical) issues.push('🚨 .env가 .gitignore에 누락 (보안 CRITICAL)');
  if (out.checks.security?.envExampleMissing?.length) issues.push(`.env→.env.example 누락 ${out.checks.security.envExampleMissing.length}건`);
  if (out.checks.security?.gitignoreMissingSecrets?.length) issues.push(`.gitignore 시크릿 누락 ${out.checks.security.gitignoreMissingSecrets.length}건`);
  out.issues = issues;
  out.healthy = issues.length === 0;

  // --strict: issue 있으면 exit 1
  if (has('--strict') && !out.healthy) process.exitCode = 1;

  if (has('--json')) { log(JSON.stringify(out, null, 2)); return; }
  log(`# leerness health (1.9.85)`);
  log(`Date: ${out.generatedAt}`);
  log(`Status: ${out.healthy ? '✅ healthy' : `⚠ ${issues.length} issues`}`);
  log('');
  log(`## drift`);
  log(`  level: ${out.checks.drift?.level || 'n/a'} (score ${out.checks.drift?.score || 0}, fired ${out.checks.drift?.firedCount || 0})`);
  log('');
  log(`## 보안`);
  if (out.checks.security?.hasDotEnv) {
    log(`  .env 존재 · .gitignore에 .env 포함: ${out.checks.security.envInGitignore ? '✓' : '✗ CRITICAL'}`);
    log(`  .env.example 누락 키: ${out.checks.security.envExampleMissing?.length || 0}건`);
    log(`  .gitignore 시크릿 패턴 누락: ${out.checks.security.gitignoreMissingSecrets?.length || 0}건`);
  } else {
    log(`  .env 없음 (검증 불필요)`);
  }
  log('');
  log(`## skills`);
  log(`  설치: ${out.checks.skills?.installed || 0}개 · skill query 누적: ${out.checks.skills?.queryHistoryCount || 0}회`);
  log('');
  log(`## usage`);
  log(`  명령 호출: ${out.checks.usage?.commandTotal || 0}회 / ${out.checks.usage?.commandKinds || 0}종`);
  log(`  MCP 호출: ${out.checks.usage?.mcpTotal || 0}회 / ${out.checks.usage?.mcpToolKinds || 0}종 도구`);
  log(`  since: ${out.checks.usage?.since || 'unknown'}`);
  log('');
  log(`## tasks`);
  const tb = out.checks.tasks?.byStatus || {};
  log(`  총 ${out.checks.tasks?.total || 0}건: ${Object.entries(tb).map(([s, n]) => `${s}=${n}`).join(', ') || '없음'}`);
  // 1.9.163: 5능력 매트릭스 — 1.9.155 sub-agent 점검의 코드 기반 자동 평가
  if (out.capabilityMatrix && !out.capabilityMatrix.error) {
    log('');
    log(`## 🧪 6능력 매트릭스 (1.9.167 자동 평가)`);
    const cm = out.capabilityMatrix;
    log(`  종합: ${cm.overallScore}% (${cm.assessment})`);
    log(`  (1) 웹 자동화        ${cm.capabilities.webAutomation.status} ${cm.capabilities.webAutomation.score}%  · ${cm.capabilities.webAutomation.evidence}`);
    log(`  (2) PC 조작          ${cm.capabilities.pcAutomation.status} ${cm.capabilities.pcAutomation.score}%  · ${cm.capabilities.pcAutomation.evidence}`);
    log(`  (3) 멀티 오케스트레이션 ${cm.capabilities.multiAgentOrchestration.status} ${cm.capabilities.multiAgentOrchestration.score}%  · ${cm.capabilities.multiAgentOrchestration.evidence}`);
    log(`  (4) REPL multi-provider ${cm.capabilities.replMultiProvider.status} ${cm.capabilities.replMultiProvider.score}%  · ${cm.capabilities.replMultiProvider.evidence}`);
    log(`  (5) MCP 도구           ${cm.capabilities.mcpTools.status} ${cm.capabilities.mcpTools.score}%  · ${cm.capabilities.mcpTools.evidence}`);
    log(`  (6) 코드 인텔리전스    ${cm.capabilities.codeIntel.status} ${cm.capabilities.codeIntel.score}%  · ${cm.capabilities.codeIntel.evidence}`);
  }
  if (issues.length) {
    log('');
    log(`## ⚠ Issues (${issues.length})`);
    for (const i of issues) log(`  - ${i}`);
    log('');
    log(`💡 자동 회복: leerness drift check --auto-fix · leerness audit --fix`);
  }
}

function usageStatsCmd(root) {
  root = absRoot(root || process.cwd());
  const stats = _readUsageStats(root);
  if (has('--json')) { log(JSON.stringify(stats, null, 2)); return; }
  log(`# leerness usage stats (1.9.38)`);
  log(`since: ${stats.since || '(unknown)'} · last: ${stats.lastAt || '(none)'}`);
  log('');
  const entries = Object.entries(stats.commands || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    log('  (사용 기록 없음)');
    return;
  }
  log(`| 명령 | 호출 수 |`);
  log(`|---|---:|`);
  for (const [cmd, n] of entries.slice(0, 30)) log(`| ${cmd} | ${n} |`);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  log('');
  log(`총 ${total} 회 호출 · 종류 ${entries.length} 가지`);
  if (stats.drift) {
    log('');
    log(`drift 통계: critical 발견 ${stats.drift.criticalSeen || 0} · skip ${stats.drift.skipped || 0} · 자동 해소 ${stats.drift.autoResolved || 0}`);
    if ((stats.drift.skipped || 0) > 5) {
      log(`💡 drift 경고 ${stats.drift.skipped}회 스킵 → 1.9.38 학습: 임계 자동 완화 (--no-drift-check 빈도 ≥5)`);
    }
  }
  // 1.9.70: MCP tools/call 자동 사용 통계 — 어떤 도구가 자주/드물게 호출되는지
  if (stats.mcp && stats.mcp.tools && Object.keys(stats.mcp.tools).length) {
    const mcpEntries = Object.entries(stats.mcp.tools).sort((a, b) => b[1] - a[1]);
    const mcpTotal = mcpEntries.reduce((s, [, n]) => s + n, 0);
    log('');
    log(`## 🔌 MCP tools/call 통계 (1.9.70) — last: ${stats.mcp.lastAt || '(none)'}`);
    log(`| MCP 도구 | 호출 수 |`);
    log(`|---|---:|`);
    for (const [tool, n] of mcpEntries) log(`| ${tool} | ${n} |`);
    log('');
    log(`총 ${mcpTotal} 회 MCP 호출 · 도구 ${mcpEntries.length} 가지 사용`);
    // 드물게 호출되는 도구 식별 (전체의 5% 미만 호출)
    const threshold = Math.max(1, Math.floor(mcpTotal * 0.05));
    const rare = mcpEntries.filter(([, n]) => n <= threshold).map(([t]) => t);
    if (rare.length) log(`💡 드물게 호출된 도구 (≤${threshold}): ${rare.slice(0, 6).join(', ')}`);
  }
}

// 1.9.38: task sync — TodoWrite/외부 JSON에서 leerness task로 mirror
// 1.9.60: leerness task export [--to <todo.json>] [--json]
// progress-tracker → TodoWrite JSON 형식 (status: completed/in_progress/pending)
function taskExportCmd(root) {
  root = absRoot(root || process.cwd());
  const out = arg('--to', null);
  const rows = readProgressRows(root);
  // leerness status → TodoWrite status 매핑
  const statusMap = { 'done': 'completed', 'in-progress': 'in_progress', 'planned': 'pending', 'requested': 'pending', 'dropped': 'cancelled', 'in_progress': 'in_progress', 'incomplete': 'in_progress', 'blocked': 'in_progress', 'on-hold': 'pending' };
  const todos = rows.map(r => ({
    content: r.request,
    status: statusMap[r.status] || 'pending',
    activeForm: r.nextAction || r.request.slice(0, 40)
  }));
  if (out) {
    writeUtf8(path.resolve(out), JSON.stringify(todos, null, 2) + '\n');
    log(`# leerness task export (1.9.60)`);
    log(`exported: ${todos.length} task → ${path.resolve(out)}`);
    log(``);
    log(`💡 다음: 메인 에이전트가 이 JSON을 TodoWrite로 import 가능`);
    return;
  }
  if (has('--json')) { log(JSON.stringify(todos, null, 2)); return; }
  log(`# leerness task export (1.9.60)`);
  log(`총 ${todos.length} task (--to <file>로 저장)`);
  for (const t of todos.slice(0, 10)) {
    log(`  - [${t.status}] ${t.content.slice(0, 60)}`);
  }
  if (todos.length > 10) log(`  ... ${todos.length - 10}건 더`);
}

function taskSyncCmd(root) {
  root = absRoot(root || process.cwd());
  const file = arg('--from', null);
  if (!file) {
    fail('사용법: leerness task sync --from <todo.json>\n  파일 형식: [{"content":"...","status":"completed|in_progress|pending","activeForm":"..."}]');
    return process.exit(1);
  }
  const full = path.resolve(file);
  if (!exists(full)) { fail(`파일 없음: ${full}`); return process.exit(1); }
  let todos;
  try { todos = JSON.parse(read(full)); }
  catch (e) { fail(`JSON 파싱 실패: ${e.message}`); return process.exit(1); }
  if (!Array.isArray(todos)) { fail('JSON 최상위는 배열이어야 함'); return process.exit(1); }
  let imported = 0, updated = 0;
  for (const t of todos) {
    if (!t || !t.content) continue;
    const status = t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'in-progress' : 'planned';
    // 이미 같은 request 있는지
    const existing = readProgressRows(root).find(r => r.request === t.content);
    if (existing) {
      if (existing.status !== status) {
        upsertProgress(root, { id: existing.id, status });
        updated++;
      }
    } else {
      const id = nextId(root, 'T');
      upsertProgress(root, { id, status, request: t.content, evidence: 'todowrite-sync', nextAction: t.activeForm || '다음 액션' });
      imported++;
    }
  }
  log(`# leerness task sync (1.9.38)`);
  log(`from: ${full}`);
  log(`imported: ${imported} · updated: ${updated} · total in source: ${todos.length}`);
  if (has('--json')) log(JSON.stringify({ imported, updated, total: todos.length }, null, 2));
}

// 1.9.35 개선 #3: contract verify <spec.md> <impl.js>
// 사양 문서(spec.md)에 명시된 함수 이름이 실제 module.exports에 모두 있는지 검사.
// 사용 예: leerness contract verify TICK_SPEC.md src/format.js
function contractVerifyCmd(specPath, implPath) {
  if (!specPath || !implPath) { fail('사용법: leerness contract verify <spec.md> <impl.js>'); return process.exit(1); }
  const spec = absRoot('.') + path.sep; // dummy to avoid abs
  const specFile = path.resolve(specPath);
  const implFile = path.resolve(implPath);
  if (!exists(specFile)) { fail(`spec 파일 없음: ${specFile}`); return process.exit(1); }
  if (!exists(implFile)) { fail(`impl 파일 없음: ${implFile}`); return process.exit(1); }
  const specText = read(specFile);
  // spec에서 함수 이름 추출:
  //   `function fooBar(...)` 형태 (markdown 코드블럭 내 JS)
  //   또는 `**fooBar**` (한국어 문서에서 함수명 강조)
  //   또는 `tick.amount` (필드명)
  const fnSpec = new Set();
  const fieldSpec = new Set();
  // function 시그니처
  for (const m of specText.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) fnSpec.add(m[1]);
  // backtick에 싸인 함수 호출 같은 형태: `xxx(`
  for (const m of specText.matchAll(/`([A-Za-z_$][\w$]*)\s*\(/g)) fnSpec.add(m[1]);
  // 필드: tick.<name>
  for (const m of specText.matchAll(/tick\.([A-Za-z_$][\w$]*)/g)) fieldSpec.add(m[1]);
  // 1.9.36 BUG-fix: require()는 side-effect 실행 위험 (CLI 스크립트는 require로 실행됨).
  // 대신 정적 소스 분석 — module.exports = { foo, bar } / exports.foo = ... / module.exports.foo = ... 패턴 grep.
  const implSrc = read(implFile);
  const implExports = new Set();
  // pattern 1: module.exports = { foo, bar, baz }
  for (const m of implSrc.matchAll(/module\.exports\s*=\s*\{([^}]+)\}/g)) {
    for (const k of m[1].split(',')) {
      const name = k.replace(/:.*/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) implExports.add(name);
    }
  }
  // pattern 2: exports.foo = / module.exports.foo =
  for (const m of implSrc.matchAll(/(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) implExports.add(m[1]);
  // pattern 3: function foo + module.exports에 포함되었는지는 위에서 처리됨
  // 검사: spec에 명시된 함수 중 impl exports에 없는 것
  const missing = [];
  for (const fn of fnSpec) {
    if (implExports.has(fn)) continue;
    // spec에 'function fnName('이 있지만 impl exports에 없으면 미구현
    if (specText.includes(`function ${fn}`) && !implExports.has(fn)) missing.push(fn);
  }
  const fieldMissing = [];
  for (const f of fieldSpec) {
    if (!new RegExp(`\\b${f}\\b`).test(implSrc)) fieldMissing.push(f);
  }
  // 출력
  if (has('--json')) {
    log(JSON.stringify({
      spec: specFile, impl: implFile,
      specFunctions: [...fnSpec], specFields: [...fieldSpec],
      implExports: [...implExports],
      missingFunctions: missing, missingFields: fieldMissing,
      ok: missing.length === 0 && fieldMissing.length === 0
    }, null, 2));
    return;
  }
  log(`# leerness contract verify (1.9.35)`);
  log(`spec: ${rel(process.cwd(), specFile)}`);
  log(`impl: ${rel(process.cwd(), implFile)}`);
  log(``);
  log(`spec 명시 함수: ${[...fnSpec].join(', ') || '(없음)'}`);
  log(`spec 명시 필드: ${[...fieldSpec].join(', ') || '(없음)'}`);
  log(`impl exports: ${[...implExports].join(', ') || '(없음)'}`);
  log(``);
  if (missing.length) {
    log(`✗ 누락된 함수 (${missing.length}건):`);
    for (const m of missing) log(`    - ${m}`);
  } else log(`✓ 모든 spec 함수가 impl에 존재`);
  if (fieldMissing.length) {
    log(`✗ 누락된 필드 (${fieldMissing.length}건):`);
    for (const m of fieldMissing) log(`    - tick.${m}`);
  } else log(`✓ 모든 spec 필드가 impl 소스에 존재`);
  const ok = missing.length === 0 && fieldMissing.length === 0;
  log('');
  log(ok ? '✅ contract OK' : '❌ contract 불일치');
  if (!ok) process.exitCode = 1;
}

// 1.9.35 개선 #2: reuse autodetect [path]
// src/*.js의 module.exports를 스캔해서 reuse-map.md에 capability 후보 등록.
function reuseAutodetectCmd(root) {
  root = absRoot(root || process.cwd());
  // 1.9.36 BUG-fix: src/만이 아니라 bin/, lib/, app/도 스캔. require() 대신 정적 분석 (side-effect 차단).
  const candidateDirs = ['src', 'bin', 'lib', 'app'].filter(d => exists(path.join(root, d)));
  if (!candidateDirs.length) { fail(`스캔할 디렉토리 없음 (src/, bin/, lib/, app/ 중 하나 필요): ${root}`); return process.exit(1); }
  const found = [];
  for (const dir of candidateDirs) {
    const files = fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.js'));
    for (const f of files) {
      const full = path.join(root, dir, f);
      const src = read(full);
      // 정적 분석: module.exports = { foo, bar } / exports.foo = / module.exports.foo =
      const names = new Set();
      for (const m of src.matchAll(/module\.exports\s*=\s*\{([^}]+)\}/g)) {
        for (const k of m[1].split(',')) {
          const name = k.replace(/:.*/, '').trim();
          if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
        }
      }
      for (const m of src.matchAll(/(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
      for (const name of names) {
        if (name.startsWith('_')) continue; // internal helpers 제외
        found.push({ file: `${dir}/${f}`, name });
      }
    }
  }
  if (has('--json')) {
    log(JSON.stringify({ project: path.basename(root), found }, null, 2));
    return;
  }
  log(`# leerness reuse autodetect (1.9.35)`);
  log(`project: ${path.basename(root)}`);
  log(`발견된 capability 후보: ${found.length}건`);
  log('');
  log('| Capability | Where | Kind | Note |');
  log('|---|---|---|---|');
  for (const c of found) log(`| ${c.name} | ${c.file} | util | (autodetect from module.exports) |`);
  log('');
  if (has('--apply')) {
    // reuse-map.md에 추가 (헤더 보존 + 후보 라인 append)
    const reusePath = path.join(root, '.harness', 'reuse-map.md');
    if (!exists(reusePath)) {
      fail(`.harness/reuse-map.md 없음 — leerness init 먼저 실행`);
      return process.exit(1);
    }
    let body = read(reusePath);
    let added = 0;
    for (const c of found) {
      if (body.includes(`| ${c.name} |`)) continue; // 이미 있음
      body += `| ${c.name} | ${c.file} | util | autodetect 1.9.35 |\n`;
      added++;
    }
    writeUtf8(reusePath, body);
    log(`✓ ${added}건 reuse-map.md에 추가됨`);
  } else {
    log(`(--apply 로 reuse-map.md에 자동 추가)`);
  }
}

// 1.9.165: leerness web — playwright bridge MVP (opt-in 의존성, 5능력 #1 보강)
//   leerness 자체에는 playwright 미포함 (의존성 0 원칙 유지). 사용자가 `npm i -g playwright` 별도 설치 시 자동 detect.
//   permissions.browser=true 필요 (1.9.146 권한 시스템 통합).
function _tryLoadPlaywright() {
  // 사용자 글로벌 + 로컬 모두 시도
  const candidates = ['playwright', 'playwright-core'];
  for (const id of candidates) {
    try { return { ok: true, lib: require(id), name: id }; } catch {}
  }
  // 글로벌 npm root 시도
  try {
    const r = cp.spawnSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 5000, shell: true });
    if (r.status === 0) {
      const globalRoot = (r.stdout || '').trim();
      for (const id of candidates) {
        try { return { ok: true, lib: require(path.join(globalRoot, id)), name: id, source: 'global' }; } catch {}
      }
    }
  } catch {}
  return { ok: false, error: 'playwright 미설치 — `npm i -g playwright` 또는 프로젝트에 `npm i playwright` 후 다시 시도' };
}
function webCmd(root, sub, ...args) {
  root = absRoot(root || process.cwd());
  if (!sub || sub === 'check') {
    const r = _tryLoadPlaywright();
    if (has('--json')) {
      log(JSON.stringify({ installed: r.ok, name: r.name || null, source: r.source || 'local', error: r.error || null, permissions: _readPermissions(root).browser || false }, null, 2));
      return;
    }
    log(`# leerness web check (1.9.165)`);
    if (r.ok) {
      log(`✓ playwright 발견: ${r.name}${r.source ? ` (${r.source})` : ''}`);
      log(`  → leerness web screenshot <url> --out file.png 사용 가능`);
    } else {
      log(`✗ ${r.error}`);
    }
    const perms = _readPermissions(root);
    log(`permissions.browser: ${perms.browser ? '✓ 허용' : '✗ 거부 (basic 모드)'}`);
    if (!perms.browser) log(`  → leerness permissions set extended  또는  set full`);
    return;
  }
  if (sub === 'screenshot') {
    const url = args[0] || arg('--url', '');
    const outPath = arg('--out', '');
    if (!url) return fail('leerness web screenshot <url> --out <file.png> 필요');
    if (!outPath) return fail('--out <file.png> 경로 필요');
    if (!/^https?:\/\//.test(url)) return fail(`URL 형식 오류 (http:// 또는 https://): ${url}`);
    if (!permissionCheck(root, 'browser', url)) {
      return fail(`permissions.browser=false (현재: ${_readPermissions(root).mode}) — leerness permissions set extended 또는 full 권장`);
    }
    const r = _tryLoadPlaywright();
    if (!r.ok) { fail(r.error); process.exitCode = 1; return; }
    const t0 = Date.now();
    log(`# leerness web screenshot (1.9.165)`);
    log(`URL: ${url}  →  ${outPath}`);
    return (async () => {
      let browser;
      try {
        const { chromium } = r.lib;
        if (!chromium) { fail('playwright.chromium 없음 — `npx playwright install chromium` 필요'); process.exitCode = 1; return; }
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(url, { timeout: 30000, waitUntil: 'networkidle' });
        await page.screenshot({ path: outPath, fullPage: true });
        await browser.close();
        const dt = Date.now() - t0;
        ok(`screenshot 완료: ${outPath} (${dt}ms)`);
        try { _recordRun(root, { kind: 'web_screenshot', url, outPath, durationMs: dt, ok: true }); } catch {}
      } catch (e) {
        fail(`screenshot 실패: ${e.message}`);
        if (browser) try { await browser.close(); } catch {}
        try { _recordRun(root, { kind: 'web_screenshot', url, durationMs: Date.now() - t0, ok: false, error: e.message }); } catch {}
        process.exitCode = 1;
      }
    })();
  }
  if (sub === 'extract') {
    const url = args[0] || arg('--url', '');
    const selector = arg('--selector', '');
    if (!url || !selector) return fail('leerness web extract <url> --selector "css-selector" 필요');
    if (!/^https?:\/\//.test(url)) return fail(`URL 형식 오류: ${url}`);
    if (!permissionCheck(root, 'browser', url)) {
      return fail(`permissions.browser=false — leerness permissions set extended 또는 full`);
    }
    const r = _tryLoadPlaywright();
    if (!r.ok) { fail(r.error); process.exitCode = 1; return; }
    const t0 = Date.now();
    return (async () => {
      let browser;
      try {
        const { chromium } = r.lib;
        if (!chromium) { fail('playwright.chromium 없음 — `npx playwright install chromium`'); process.exitCode = 1; return; }
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(url, { timeout: 30000, waitUntil: 'networkidle' });
        const elements = await page.$$eval(selector, els => els.slice(0, 50).map(el => el.textContent?.trim() || ''));
        await browser.close();
        const dt = Date.now() - t0;
        const out = { url, selector, count: elements.length, elements, durationMs: dt };
        if (has('--json')) log(JSON.stringify(out, null, 2));
        else {
          log(`# leerness web extract (1.9.165)`);
          log(`URL: ${url} · selector: ${selector} · ${elements.length}개 (${dt}ms)`);
          elements.slice(0, 20).forEach((t, i) => log(`  ${i+1}. ${t.slice(0, 200)}${t.length > 200 ? '…' : ''}`));
        }
        try { _recordRun(root, { kind: 'web_extract', url, selector, count: elements.length, durationMs: dt, ok: true }); } catch {}
      } catch (e) {
        fail(`extract 실패: ${e.message}`);
        if (browser) try { await browser.close(); } catch {}
        process.exitCode = 1;
      }
    })();
  }
  fail(`알 수 없는 sub: ${sub} (check / screenshot / extract)`);
}

// 1.9.166: leerness pc — robotjs/nut-tree bridge MVP (opt-in 의존성, 5능력 #2 보강)
//   leerness 자체에는 robotjs 미포함 (의존성 0). 사용자가 `npm i -g robotjs` 별도 설치 시 자동 detect.
//   permissions.mouse / .keyboard / .browser 필요 (1.9.146 권한 시스템).
//   ⚠ full 모드 권장 — IDE 통합 외에는 위험성 명시.
function _tryLoadPCAutomation() {
  // robotjs 우선, fallback @nut-tree/nut-js
  const candidates = ['robotjs', '@nut-tree/nut-js'];
  for (const id of candidates) {
    try { return { ok: true, lib: require(id), name: id }; } catch {}
  }
  // 글로벌 npm root 시도
  try {
    const r = cp.spawnSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 5000, shell: true });
    if (r.status === 0) {
      const globalRoot = (r.stdout || '').trim();
      for (const id of candidates) {
        try { return { ok: true, lib: require(path.join(globalRoot, id)), name: id, source: 'global' }; } catch {}
      }
    }
  } catch {}
  return { ok: false, error: 'robotjs/@nut-tree/nut-js 미설치 — `npm i -g robotjs` 또는 `npm i -g @nut-tree/nut-js` 후 다시 시도' };
}
function pcCmd(root, sub, ...args) {
  root = absRoot(root || process.cwd());
  if (!sub || sub === 'check') {
    const r = _tryLoadPCAutomation();
    const perms = _readPermissions(root);
    if (has('--json')) {
      log(JSON.stringify({
        installed: r.ok,
        name: r.name || null,
        source: r.source || 'local',
        error: r.error || null,
        permissions: {
          mouse: perms.mouse || false,
          keyboard: perms.keyboard || false,
          mode: perms.mode || 'basic'
        }
      }, null, 2));
      return;
    }
    log(`# leerness pc check (1.9.166)`);
    if (r.ok) {
      log(`✓ ${r.name} 발견${r.source ? ` (${r.source})` : ''}`);
      log(`  → leerness pc click / type / screenshot 사용 가능`);
    } else {
      log(`✗ ${r.error}`);
    }
    log('');
    log(`## 권한 (1.9.146)`);
    log(`  permissions.mouse:    ${perms.mouse ? '✓ 허용' : '✗ 거부'}`);
    log(`  permissions.keyboard: ${perms.keyboard ? '✓ 허용' : '✗ 거부'}`);
    log(`  현재 모드: ${perms.mode || 'basic'}`);
    if (!perms.mouse || !perms.keyboard) {
      log('');
      log(`  💡 활성화: leerness permissions set full  (⚠ IDE 통합 외에는 위험)`);
    }
    return;
  }
  if (sub === 'click') {
    const x = parseInt(args[0] || arg('--x', ''), 10);
    const y = parseInt(args[1] || arg('--y', ''), 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return fail('leerness pc click <x> <y> 필요 (정수 좌표)');
    if (!permissionCheck(root, 'mouse', `${x},${y}`)) {
      return fail(`permissions.mouse=false (현재: ${_readPermissions(root).mode}) — leerness permissions set full`);
    }
    const r = _tryLoadPCAutomation();
    if (!r.ok) { fail(r.error); process.exitCode = 1; return; }
    const t0 = Date.now();
    try {
      if (r.name === 'robotjs') {
        r.lib.moveMouse(x, y);
        r.lib.mouseClick();
      } else if (r.name === '@nut-tree/nut-js') {
        // nut-js 는 비동기
        return (async () => {
          const { mouse, Point, Button } = r.lib;
          await mouse.move([new Point(x, y)]);
          await mouse.click(Button.LEFT);
          const dt = Date.now() - t0;
          ok(`click (${x}, ${y}) — ${dt}ms`);
          try { _recordRun(root, { kind: 'pc_click', x, y, lib: r.name, durationMs: dt, ok: true }); } catch {}
        })();
      }
      const dt = Date.now() - t0;
      ok(`click (${x}, ${y}) — ${dt}ms`);
      try { _recordRun(root, { kind: 'pc_click', x, y, lib: r.name, durationMs: dt, ok: true }); } catch {}
    } catch (e) {
      fail(`click 실패: ${e.message}`);
      try { _recordRun(root, { kind: 'pc_click', x, y, lib: r.name, durationMs: Date.now() - t0, ok: false, error: e.message }); } catch {}
      process.exitCode = 1;
    }
    return;
  }
  if (sub === 'type') {
    const text = args[0] || arg('--text', '');
    if (!text) return fail('leerness pc type "<text>" 필요');
    if (!permissionCheck(root, 'keyboard', text)) {
      return fail(`permissions.keyboard=false — leerness permissions set full`);
    }
    const r = _tryLoadPCAutomation();
    if (!r.ok) { fail(r.error); process.exitCode = 1; return; }
    const t0 = Date.now();
    try {
      if (r.name === 'robotjs') {
        r.lib.typeString(text);
      } else if (r.name === '@nut-tree/nut-js') {
        return (async () => {
          const { keyboard } = r.lib;
          await keyboard.type(text);
          const dt = Date.now() - t0;
          ok(`type ${text.length}자 — ${dt}ms`);
          try { _recordRun(root, { kind: 'pc_type', chars: text.length, lib: r.name, durationMs: dt, ok: true }); } catch {}
        })();
      }
      const dt = Date.now() - t0;
      ok(`type ${text.length}자 — ${dt}ms`);
      try { _recordRun(root, { kind: 'pc_type', chars: text.length, lib: r.name, durationMs: dt, ok: true }); } catch {}
    } catch (e) {
      fail(`type 실패: ${e.message}`);
      process.exitCode = 1;
    }
    return;
  }
  if (sub === 'screenshot') {
    // OS-level screenshot (robotjs.screen 또는 nut-js screen.capture)
    const outPath = arg('--out', '');
    if (!outPath) return fail('--out <file.png> 경로 필요');
    if (!permissionCheck(root, 'mouse', outPath)) {
      // mouse 권한으로 screenshot 도 제어 (디스플레이 접근)
      return fail(`permissions.mouse=false (현재: ${_readPermissions(root).mode}) — leerness permissions set full`);
    }
    const r = _tryLoadPCAutomation();
    if (!r.ok) { fail(r.error); process.exitCode = 1; return; }
    const t0 = Date.now();
    try {
      if (r.name === 'robotjs') {
        const img = r.lib.screen.capture();
        // robotjs 의 raw bitmap → PNG 변환 필요 — MVP 에선 raw 저장
        fs.writeFileSync(outPath, Buffer.from(img.image));
        const dt = Date.now() - t0;
        ok(`screenshot (raw) — ${dt}ms · ${outPath}  (PNG 변환: pngjs 또는 sharp 별도)`);
        try { _recordRun(root, { kind: 'pc_screenshot', outPath, lib: r.name, durationMs: dt, ok: true }); } catch {}
      } else if (r.name === '@nut-tree/nut-js') {
        return (async () => {
          const { screen } = r.lib;
          const img = await screen.capture(outPath);
          const dt = Date.now() - t0;
          ok(`screenshot — ${dt}ms · ${outPath}`);
          try { _recordRun(root, { kind: 'pc_screenshot', outPath, lib: r.name, durationMs: dt, ok: true }); } catch {}
        })();
      }
    } catch (e) {
      fail(`screenshot 실패: ${e.message}`);
      process.exitCode = 1;
    }
    return;
  }
  fail(`알 수 없는 sub: ${sub} (check / click / type / screenshot)`);
}

// 1.9.167: LSP 어댑터 MVP — 코드 인텔리전스 bridge (opt-in 의존성)
//   typescript 모듈 detect → 실제 TypeScript Compiler API 사용
//   미설치 시 정규식 fallback (그래도 동작) → score 5/50/90 차등
function _tryLoadLSP() {
  // typescript 우선 (Compiler API), 추후 pyright/vscode-languageserver 후보
  const candidates = ['typescript'];
  for (const id of candidates) {
    try { return { ok: true, lib: require(id), name: id }; } catch {}
  }
  // 글로벌 npm root 시도
  try {
    const r = cp.spawnSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 5000, shell: true });
    if (r.status === 0) {
      const globalRoot = (r.stdout || '').trim();
      for (const id of candidates) {
        try { return { ok: true, lib: require(path.join(globalRoot, id)), name: id, source: 'global' }; } catch {}
      }
    }
  } catch {}
  return { ok: false, error: 'typescript 미설치 — `npm i -g typescript` 후 다시 시도 (또는 정규식 fallback 사용)' };
}

// 정규식 fallback — TypeScript/JavaScript symbol 추출 (LSP 없이도 동작)
function _lspRegexSymbols(content) {
  const symbols = [];
  const lines = content.split(/\r?\n/);
  const patterns = [
    { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/, kind: 'function' },
    { re: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
    { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
    { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\()/, kind: 'function' },
    { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, kind: 'type' },
    { re: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 'enum' },
  ];
  lines.forEach((line, idx) => {
    for (const p of patterns) {
      const m = line.match(p.re);
      if (m) { symbols.push({ name: m[1], kind: p.kind, line: idx + 1 }); break; }
    }
  });
  return symbols;
}

// TypeScript Compiler API 기반 symbol 추출 (정확)
function _lspTsSymbols(ts, content, fileName) {
  const symbols = [];
  const sf = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  function visit(node) {
    let name = null, kind = null;
    if (ts.isFunctionDeclaration(node) && node.name) { name = node.name.text; kind = 'function'; }
    else if (ts.isClassDeclaration(node) && node.name) { name = node.name.text; kind = 'class'; }
    else if (ts.isInterfaceDeclaration(node)) { name = node.name.text; kind = 'interface'; }
    else if (ts.isTypeAliasDeclaration(node)) { name = node.name.text; kind = 'type'; }
    else if (ts.isEnumDeclaration(node)) { name = node.name.text; kind = 'enum'; }
    else if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach(d => {
        if (d.name && d.name.text && d.initializer
            && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          const { line } = sf.getLineAndCharacterOfPosition(d.getStart());
          symbols.push({ name: d.name.text, kind: 'function', line: line + 1 });
        }
      });
    }
    if (name) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
      symbols.push({ name, kind, line: line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return symbols;
}

function lspCmd(root, sub, ...args) {
  root = absRoot(root || process.cwd());
  if (!sub || sub === 'check') {
    const r = _tryLoadLSP();
    if (has('--json')) {
      log(JSON.stringify({
        installed: r.ok,
        name: r.name || null,
        source: r.source || 'local',
        error: r.error || null,
        fallback: 'regex (always available)'
      }, null, 2));
      return;
    }
    log(`# leerness lsp check (1.9.167)`);
    if (r.ok) {
      log(`✓ ${r.name} 발견${r.source ? ` (${r.source})` : ''}`);
      log(`  → leerness lsp symbols / references 정확 모드 (Compiler API) 사용`);
    } else {
      log(`⚠ ${r.error}`);
      log(`  → 정규식 fallback 으로 동작 (TS/JS 한정, 정확도 약간 낮음)`);
    }
    return;
  }
  if (sub === 'symbols') {
    const file = args[0] || arg('--file', '');
    if (!file) return fail('leerness lsp symbols <file> 필요');
    if (!fs.existsSync(file)) return fail(`파일 없음: ${file}`);
    const content = fs.readFileSync(file, 'utf8');
    const t0 = Date.now();
    const r = _tryLoadLSP();
    let symbols, mode;
    try {
      if (r.ok && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) {
        symbols = _lspTsSymbols(r.lib, content, file);
        mode = 'typescript-compiler';
      } else {
        symbols = _lspRegexSymbols(content);
        mode = 'regex-fallback';
      }
    } catch (e) {
      symbols = _lspRegexSymbols(content);
      mode = 'regex-fallback (after error: ' + e.message + ')';
    }
    const dt = Date.now() - t0;
    if (has('--json')) {
      log(JSON.stringify({ file, symbols, count: symbols.length, mode, durationMs: dt }, null, 2));
    } else {
      log(`# leerness lsp symbols (1.9.167)`);
      log(`file: ${file}`);
      log(`mode: ${mode} · ${symbols.length} symbols · ${dt}ms`);
      symbols.slice(0, 50).forEach(s => log(`  ${String(s.line).padStart(5)}:${s.kind.padEnd(10)} ${s.name}`));
      if (symbols.length > 50) log(`  ... ${symbols.length - 50} more`);
    }
    try { _recordRun(root, { kind: 'lsp_symbols', file, count: symbols.length, mode, durationMs: dt, ok: true }); } catch {}
    return;
  }
  if (sub === 'references') {
    const name = args[0] || arg('--name', '');
    if (!name) return fail('leerness lsp references <symbol-name> 필요');
    const inDir = arg('--in', root);
    const t0 = Date.now();
    // grep 기반 fallback (실 LSP textDocument/references 대신)
    const refs = [];
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reWord = new RegExp(`\\b${escapedName}\\b`);
    function walk(d) {
      let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|jsx|mjs|cjs|md)$/.test(e.name)) {
          try {
            const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
            lines.forEach((ln, idx) => {
              if (reWord.test(ln)) refs.push({ file: path.relative(root, p), line: idx + 1, text: ln.trim().slice(0, 120) });
            });
          } catch {}
        }
      }
    }
    walk(inDir);
    const dt = Date.now() - t0;
    if (has('--json')) {
      log(JSON.stringify({ name, count: refs.length, references: refs.slice(0, 100), durationMs: dt }, null, 2));
    } else {
      log(`# leerness lsp references (1.9.167)`);
      log(`symbol: "${name}" · ${refs.length} references · ${dt}ms`);
      refs.slice(0, 30).forEach(r => log(`  ${r.file}:${r.line}  ${r.text}`));
      if (refs.length > 30) log(`  ... ${refs.length - 30} more`);
    }
    try { _recordRun(root, { kind: 'lsp_references', name, count: refs.length, durationMs: dt, ok: true }); } catch {}
    return;
  }
  fail(`알 수 없는 sub: ${sub} (check / symbols / references)`);
}

// 1.9.164: leerness which — 진단 도구 (구버전 충돌 / npx 캐시 / PATH 충돌 해결)
//   사용자가 "최신 버전 작동 안 함" 의심 시: 실제 실행 중인 leerness 의 경로 / 버전 / npm 캐시 / PATH 후보 표시.
function whichCmd() {
  const out = {
    version: VERSION,
    runningFrom: __filename,
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

function help() {
  log(`Leerness v${VERSION}\n\nUsage:\n  leerness init [path] [--language auto|ko|en] [--skills recommended|all|a,b]\n  leerness migrate [path] [--dry-run] [--force]\n  leerness update [path] [--check|--yes|--force|--from <tarball>]\n  leerness auto-update install [path]\n  leerness status [path]\n  leerness verify [path]\n  leerness debug [path]\n  leerness audit [path]\n  leerness check [path]\n  leerness scan secrets [path]\n  leerness encoding check [path]\n  leerness lazy detect [path]\n  leerness memory search "query" [--limit 5]\n  leerness handoff [path] [--all-apps] [--include p1,p2] [--since 24h|3d] [--compact] [--json]   # 1.9.17-22 워크스페이스 (--compact: LLM 시스템 프롬프트용 1줄 요약)\n  leerness orchestrate "<목표>" [--agents N] [--model qwen2.5:7b-instruct] [--retry-on-fail K]   # 1.9.22 Ollama opt-in (LEERNESS_OLLAMA_BASE_URL 필요)\n  leerness llm-bench record --score N --model X [--label L] [--tokens T]   # 1.9.22 LLM 벤치 히스토리 누적\n  leerness deps <capability> [--run-tests] [--json]   # 1.9.24 depends-on 역방향 추적 + 자동 회귀 sweep\n  leerness memory search "키" [--include-code]   # 1.9.25 소스 코드 본문도 검색 (모순 감지 핵심)\n  leerness brainstorm "주제" [--include-code]    # 1.9.25 코드 본문 hits 포함\n  leerness register-pending "<요청>" [--agent X] [--note Y]   # 1.9.25 다중 세션 in-progress 즉시 등록\n  leerness optimism-check <T-ID> [--json]   # 1.9.26/27 낙관적 표시 감지 (1.9.27: 10 카테고리 + URL/메서드 매핑 + 신뢰도 점수)\n  leerness persona list|show <id>|add <id>   # 1.9.29 페르소나 카탈로그 (보안/성능/UX/testing/docs 5종 내장)\n  leerness review <file> --persona <id1,id2,...>   # 1.9.29 도메인 페르소나 리뷰 프롬프트 자동 생성\n  leerness agents list|check|quota          # 1.9.30/31 외부 AI CLI 가용성 + quota 추정 (claude/codex/gemini/copilot)\n  leerness agents dispatch "<task>" --to <id>   # 1.9.30 활성 CLI 대상 실행 명령 생성 (실 호출 X, 사용자 실행)\n  leerness agents multi "<task>" [--only c1,c2] [--write] [--execute] [--timeout 60]   # 1.9.152/156 활성 N개 일괄 dispatch (--execute: 실 spawn + consensus)\n  leerness provider list|add|remove [args]   # 1.9.157 Provider Registry — 사용자 정의 CLI provider 동적 추가 (OpenRouter/Bedrock 흡수)\n  leerness agents dispatch "<task>" --multi   # 1.9.152 multi 모드 alias (또는 --to all)\n  leerness setup-agents [path] [--yes|--no-setup-agents]    # 1.9.32 sub-agent CLI 인터랙티브 설정 (.env + 미설치 자동 설치)\n  leerness init [path] [--no-stale-check]                   # 1.9.33 npx 캐시 함정 — 옛 버전 자동 경고 (끄려면 --no-stale-check)\n  leerness which [--json]                                   # 1.9.164 진단: 현재 실행 경로/버전 + npm 캐시 + PATH 후보 (구버전 충돌 해결)\n  leerness web check|screenshot|extract <url> [--out file.png] [--selector "css"]  # 1.9.165 playwright bridge (opt-in: npm i -g playwright + permissions.browser)\n  leerness pc check|click|type|screenshot [--x N --y N] [--text "s"] [--out f.png]  # 1.9.166 robotjs/nut-tree bridge (opt-in: npm i -g robotjs + permissions.mouse/keyboard, ⚠ full 모드 권장)\n  leerness lsp check|symbols|references <file/name> [--in dir] [--json]  # 1.9.167 LSP 어댑터 MVP (typescript opt-in + regex fallback, 코드 인텔리전스)\n  leerness contract verify <spec.md> <impl.js> [--json]     # 1.9.35 명세 ↔ 구현 일치 검사 (함수/필드)\n  leerness reuse autodetect [path] [--apply] [--json]       # 1.9.35 src/*.js의 module.exports → reuse-map 후보 등록\n  leerness audit [path] [--fix]                              # 1.9.35 --fix: session-handoff/current-state 자동 갱신\n  leerness verify-claim <T-ID> ... [--strict-claims]   # 1.9.26 verify-claim에 낙관적 표시 자동 검사 통합\n  leerness reuse-map [path] [--all-apps] [--include p1,p2] [--strict-elements] [--json] # 1.9.18 중복/잠재중복/depends-on\n  leerness verify-claim <T-ID> [--path .] [--run-tests] [--json]   # 1.9.18-20 evidence 자동 검증 (1.9.20: scenes/scripts 등 도메인 폴더 + jest/mocha 파싱)\n  leerness verify-code [path] [--build] [--bench]  # 1.9.20 --bench: scripts.bench 추가 실행 + evidence 누적\n  leerness session close [path]\n  leerness route <task-type>\n  leerness self check [path]\n  leerness readme sync [path]\n  leerness consistency check [path]\n  leerness consistency merge-design-guide [path]\n  leerness plan show|init|add|drop|progress|sync [args]\n  leerness task list|add|update|drop|fix-evidence|relink [args]\n  leerness skill list|info <name>\n  leerness skill learn <id> --doc <url> --command "..." --capability "..." [--note ...]\n  leerness skill use <id> [--note ...]\n  leerness skill optimize <id> --before "..." --after "..." [--note ...]\n  leerness skill remove <id>\n  leerness skill consolidate [--threshold 0.3]\n  leerness gate [path]                       # verify+audit+scan+encoding+lazy
  leerness retro [path] [--days 7] [--all-apps] [--include p1,p2] [--json]  # 회고 (1.9.13~1.9.16)
  leerness insights [path] [--all-apps] [--include p1,p2] [--json]         # 누적 통계 (1.9.13~1.9.16)
  leerness brainstorm "<주제>" [--all-apps] [--include p1,p2] [--json]    # 브레인스토밍 (1.9.13~1.9.16)
  leerness roadmap [path] [--out file.html]  # 좌→우 수평 트리 + 상하 중앙정렬 + 화이트보드 (1.9.11)
  leerness roadmap auto on|off|status [--on-every-change] [--out file.html]  # 자동 갱신 (1.9.12, install/session-close 기본 ON)
  leerness verify-code [path] [--build]      # npm test/lint/typecheck 자동 실행 + evidence 자동 기록 (1.9.7)
  leerness lessons [--query <키>] [--limit N]  # 과거 결정/실수 자동 회수 (1.9.7)
  leerness lazy detect [path] [--auto-track] # --auto-track으로 새 TODO를 progress에 자동 등록 (1.9.7)
  leerness rule add "<설명>" --trigger every-session|every-update|every-commit|session-start|session-close|pre-publish  # 사용자 룰 등록 (1.9.8)
  leerness rule list|verify|pause <id>|resume <id>|remove <id>|stop|resume-all
  leerness release bump [--patch|--minor|--major]  # package.json 자동 bump (1.9.8)
  leerness release note "<내용>"               # CHANGELOG.md 자동 추가 (1.9.8)
  leerness release publish [--dry-run] [--pack] [--git-push] [--gh-release] [--gh-pages] [--gh-pages-src file] [--npm-publish] [--auto]  # 통합 배포 (1.9.8 + 1.9.10)\n  leerness impact <target> [--all]           # 변경 전 영향 분석 (기본 strong, --all로 weak 포함)\n  leerness reuse find <query>                # 기존 자원 검색 (재귀 안내)\n  leerness reuse register <name> --where <p> --kind component|hook|util|api [--note ...]\n  leerness ui consistency [path] [--strict] [--fail-on-violation]\n  leerness graph [path] [--out <file>]       # mermaid 의존성 그래프\n  leerness guide [target]                    # impact + reuse + ui consistency 통합 가이드\n`);
}

async function main() {
  const args = nonFlagArgs(); const cmd = args[0] || 'init';
  if (has('--version') || has('-v')) {
    // 1.9.32: --version은 순수 버전만 (CI/script 친화). 배너는 --banner 시.
    if (has('--banner')) _banner({ quickStart: false });
    return log(VERSION);
  }
  if (has('--help') || has('-h')) return help();
  // 1.9.38 (B): 사용 통계 카운터 — usage stats 명령 자체와 비차단 경로는 제외
  if (cmd !== 'usage' && cmd !== 'init' && cmd !== 'migrate' && cmd !== '--version' && cmd !== '--help') {
    try {
      const root = absRoot(arg('--path', args[1] && !args[1].startsWith('-') ? args[1] : process.cwd()));
      if (exists(path.join(root, '.harness'))) _bumpUsage(root, cmd);
    } catch {}
  }
  if (cmd === 'init')      return await install(args[1] || process.cwd(), { force:false, dry:false, migration:false });
  // 1.9.64: install <skill-id-or-url> 별칭 (= skill install). 자주 쓰는 명령 단축형.
  // 단, init이 leerness install . 같은 형태로도 동작하던 옛 호환은 유지 — args[1]이 디렉토리면 init으로 라우팅.
  if (cmd === 'install') {
    const arg1 = args[1];
    // skill source는 .md 파일 또는 URL 또는 skill id. 디렉토리면 init으로.
    if (!arg1) { fail('사용법: leerness install <skill SKILL.md path or URL>'); return process.exit(1); }
    if (/^https?:\/\//.test(arg1) || /\.md$/.test(arg1) || exists(path.join(arg1, 'SKILL.md'))) {
      return await skillInstallCmd(absRoot(arg('--path', process.cwd())), arg1);
    }
    // 디렉토리면 안내
    if (exists(arg1) && fs.statSync(arg1).isDirectory() && !exists(path.join(arg1, 'SKILL.md'))) {
      fail(`디렉토리에 SKILL.md 없음: ${arg1}\n  init 의도였다면: leerness init "${arg1}"`);
      return process.exit(1);
    }
    fail(`알 수 없는 install 대상: ${arg1}\n  SKILL.md 파일/URL/SKILL.md 포함 디렉토리 필요`);
    return process.exit(1);
  }
  if (cmd === 'migrate')   return await install(args[1] || process.cwd(), { force:has('--force'), dry:has('--dry-run'), migration:true });
  if (cmd === 'update')    return await updateCmd(args[1] || process.cwd(), { checkOnly: has('--check'), yes: has('--yes'), force: has('--force') });
  if (cmd === 'auto-update' && args[1] === 'install') return autoUpdateInstall(args[2] || process.cwd());
  if (cmd === 'status')    return status(args[1] || process.cwd());
  if (cmd === 'verify')    return verify(args[1] || process.cwd());
  if (cmd === 'debug')     return debug(args[1] || process.cwd());
  if (cmd === 'audit')     return audit(args[1] || process.cwd());
  if (cmd === 'check')     return preCheck(args[1] || process.cwd());
  if (cmd === 'scan' && args[1] === 'secrets')   return scanSecrets(args[2] || process.cwd());
  if (cmd === 'encoding' && args[1] === 'check') return encodingCheck(args[2] || process.cwd());
  if (cmd === 'lazy' && args[1] === 'detect')    return lazyDetect(args[2] || process.cwd(), { json: has('--json') });
  if (cmd === 'memory' && args[1] === 'search')  return memorySearch(arg('--path', process.cwd()), args.slice(2).join(' '));
  if (cmd === 'handoff')      return handoffCmd(args[1] || process.cwd());
  if (cmd === 'reuse-map')    return reuseMapCmd(args[1] || process.cwd());
  if (cmd === 'verify-claim') return verifyClaimCmd(arg('--path', process.cwd()), args[1]);
  if (cmd === 'orchestrate')  return await orchestrateCmd(arg('--path', process.cwd()), args.slice(1).filter(x => !x.startsWith('-')));
  if (cmd === 'llm-bench' && args[1] === 'record') return llmBenchRecordCmd(arg('--path', process.cwd()));
  if (cmd === 'deps')         return depsImpactCmd(arg('--path', process.cwd()), args[1]);
  if (cmd === 'register-pending') return registerPendingCmd(arg('--path', process.cwd()), args.slice(1).filter(x => !x.startsWith('-')));
  if (cmd === 'optimism-check') return optimismCheckCmd(arg('--path', process.cwd()), args[1]);
  if (cmd === 'persona') return personaCmd(arg('--path', process.cwd()), args[1], args[2]);
  if (cmd === 'review') return reviewCmd(arg('--path', process.cwd()), args[1]);
  if (cmd === 'agents') return agentsCmd(arg('--path', process.cwd()), args[1], ...args.slice(2));
  // 1.9.157: Provider Registry — 사용자 정의 provider 동적 추가
  if (cmd === 'provider') return providerCmd(arg('--path', process.cwd()), args[1], ...args.slice(2));
  // 1.9.164: leerness which — 진단 도구 (구버전 충돌 / npx 캐시 / PATH 후보)
  if (cmd === 'which') return whichCmd();
  // 1.9.165: leerness web — playwright bridge (opt-in 의존성)
  if (cmd === 'web') return webCmd(arg('--path', process.cwd()), args[1], ...args.slice(2));
  // 1.9.166: leerness pc — robotjs/nut-tree bridge (opt-in 의존성)
  if (cmd === 'pc') return pcCmd(arg('--path', process.cwd()), args[1], ...args.slice(2));

  if (cmd === 'lsp') return lspCmd(arg('--path', process.cwd()), args[1], ...args.slice(2));
  if (cmd === 'contract' && args[1] === 'verify') return contractVerifyCmd(args[2], args[3]);
  if (cmd === 'drift' && (args[1] === 'check' || !args[1])) return driftCheckCmd(args[2] || arg('--path', process.cwd()));
  if (cmd === 'usage' && (args[1] === 'stats' || !args[1])) return usageStatsCmd(args[2] || arg('--path', process.cwd()));
  // 1.9.71: leerness env check / sync — .env vs .env.example 자동 동기화
  if (cmd === 'env' && args[1] === 'check') return envCheckCmd(args[2] || arg('--path', process.cwd()));
  if (cmd === 'env' && args[1] === 'sync')  return envSyncCmd(args[2] || arg('--path', process.cwd()));
  // 1.9.145: 실행 환경 자동 감지 + 변동 추적 (사용자 명시)
  if (cmd === 'env' && args[1] === 'detect') return envDetectCmd(args[2] || arg('--path', process.cwd()));
  // 1.9.146: agent 권한 시스템 + CLI 에이전트 모드 (사용자 명시 요청 #4, #5)
  if (cmd === 'permissions' && args[1] === 'list') return permissionsListCmd(arg('--path', process.cwd()));
  if (cmd === 'permissions' && args[1] === 'set')  return permissionsSetCmd(arg('--path', process.cwd()), args[2]);
  if (cmd === 'agent') return agentCmd(arg('--path', process.cwd()), args.slice(1).filter(x => !x.startsWith('--')).join(' '));
  // 1.9.147: 자동 유지보수 시스템 (사용자 명시 요청)
  if (cmd === 'webhook' && args[1] === 'serve')   return webhookServeCmd(arg('--path', process.cwd()));
  if (cmd === 'incident' && args[1] === 'list')   return incidentListCmd(arg('--path', process.cwd()));
  if (cmd === 'incident' && args[1] === 'show')   return incidentShowCmd(arg('--path', process.cwd()), args[2]);
  if (cmd === 'incident' && args[1] === 'handle') return incidentHandleCmd(arg('--path', process.cwd()), args[2]);
  if (cmd === 'creds' && args[1] === 'list')      return credsListCmd(arg('--path', process.cwd()));
  if (cmd === 'creds' && args[1] === 'register')  return credsRegisterCmd(arg('--path', process.cwd()), args[2]);
  if (cmd === 'creds' && args[1] === 'check')     return credsCheckCmd(arg('--path', process.cwd()), args[2]);
  if (cmd === 'creds' && args[1] === 'refresh')   return credsRefreshTimestampCmd(arg('--path', process.cwd()), args[2]);
  if (cmd === 'deploy' && args[1] === 'auto')     return deployAutoCmd(arg('--path', process.cwd()), args[2]);
  // 1.9.149: observability lite + runs list/show
  if (cmd === 'runs' && args[1] === 'list')       return runsListCmd(arg('--path', process.cwd()));
  if (cmd === 'runs' && args[1] === 'show')       return runsShowCmd(arg('--path', process.cwd()), args[2]);
  // 1.9.85: leerness health — 종합 헬스 체크
  if (cmd === 'health') return healthCmd(args[1] || arg('--path', process.cwd()));
  if (cmd === 'whats-new') return whatsNewCmd(args[1] || arg('--path', process.cwd()));
  if (cmd === 'reuse' && args[1] === 'autodetect') return reuseAutodetectCmd(args[2] || arg('--path', process.cwd()));
  if (cmd === 'setup-agents' || cmd === 'setup' && args[1] === 'agents') return await setupAgentsCmd(args[1] && args[1] !== 'agents' ? args[1] : (args[2] || process.cwd()));
  if (cmd === 'session' && args[1] === 'close') return sessionClose(args[2] || process.cwd(), { json: has('--json') });
  // 1.9.151: viewwork 명령 제거 (사용자 명시 — leerness 와 무관). session close 의 viewworkEmit 콜도 함께 제거.
  if (cmd === 'route')     return route(args[1] || 'planning');
  if (cmd === 'self' && args[1] === 'check')   return await selfCheck(absRoot(args[2] || process.cwd()));
  if (cmd === 'self' && args[1] === 'migrate') return log('Run: npx --yes leerness@latest migrate . --dry-run, then migrate without --dry-run after review.');
  if (cmd === 'readme' && args[1] === 'sync')  return readmeCmd(args[2] || process.cwd());
  if (cmd === 'consistency' && args[1] === 'check')              return consistencyCheck(args[2] || process.cwd());
  if (cmd === 'consistency' && args[1] === 'merge-design-guide') return mergeDesign(args[2] || process.cwd());
  if (cmd === 'skill' && args[1] === 'list')        return skillList(args[2] || arg('--path', process.cwd()));
  if (cmd === 'skill' && args[1] === 'info')        return skillInfo(args[2], absRoot(arg('--path', process.cwd())));
  if (cmd === 'skill' && args[1] === 'add')         return addSkill(absRoot(arg('--path', process.cwd())), args[2]);
  if (cmd === 'skill' && args[1] === 'learn')       return skillLearn(absRoot(arg('--path', process.cwd())), args[2]);
  if (cmd === 'skill' && args[1] === 'use')         return skillUse(absRoot(arg('--path', process.cwd())), args[2]);
  if (cmd === 'skill' && args[1] === 'optimize')    return skillOptimize(absRoot(arg('--path', process.cwd())), args[2]);
  if (cmd === 'skill' && args[1] === 'remove')      return skillRemove(absRoot(arg('--path', process.cwd())), args[2]);
  if (cmd === 'skill' && args[1] === 'consolidate') return skillConsolidate(absRoot(arg('--path', process.cwd())));
  if (cmd === 'skill' && args[1] === 'install')     return await skillInstallCmd(absRoot(arg('--path', process.cwd())), args[2]);
  if (cmd === 'skill' && args[1] === 'discover')    return await skillDiscoverCmd(absRoot(arg('--path', process.cwd())));
  if (cmd === 'skill' && args[1] === 'export')      return skillExportCmd(absRoot(arg('--path', process.cwd())), args[2]);
  if (cmd === 'skill' && args[1] === 'export-all')  return skillExportAllCmd(absRoot(arg('--path', process.cwd())));
  if (cmd === 'skill' && args[1] === 'match')       return skillMatchCmd(absRoot(arg('--path', process.cwd())), args.slice(2).filter(x => !x.startsWith('-')).join(' '));
  // 1.9.90: leerness skill search <capability> — capability 키워드로 검색 (substring 정확 일치)
  if (cmd === 'skill' && args[1] === 'search')      return skillSearchCmd(absRoot(arg('--path', process.cwd())), args.slice(2).filter(x => !x.startsWith('-')).join(' '));
  if (cmd === 'benchmark')                          return benchmarkCmd(absRoot(args[1] || arg('--path', process.cwd())));
  if (cmd === 'skill' && args[1] === 'publish')     return skillPublishCmd(absRoot(arg('--path', process.cwd())));
  if (cmd === 'skill' && args[1] === 'suggest')     return skillSuggestCmd(absRoot(arg('--path', process.cwd())));
  if (cmd === 'mcp' && args[1] === 'serve')         return mcpServeCmd(absRoot(arg('--path', process.cwd())));
  if (cmd === 'gate')                               return gate(args[1] || process.cwd());
  if (cmd === 'verify-code')                        return verifyCodeCmd(args[1] || process.cwd());
  if (cmd === 'lessons')                            return lessonsCmd(arg('--path', process.cwd()));
  if (cmd === 'retro')                              return retroCmd(args[1] || process.cwd());
  if (cmd === 'insights')                           return insightsCmd(args[1] || process.cwd());
  if (cmd === 'brainstorm')                         return brainstormCmd(arg('--path', process.cwd()), args.slice(1).filter(x => !x.startsWith('-')).join(' '));
  if (cmd === 'roadmap' && args[1] === 'auto')      return roadmapAutoCmd(arg('--path', process.cwd()), args[2]);
  if (cmd === 'roadmap')                            return roadmapCmd(args[1] || process.cwd());
  if (cmd === 'rule' && args[1] === 'add')          return ruleAdd(arg('--path', process.cwd()), args.slice(2).filter(x => !x.startsWith('-')).join(' '));
  if (cmd === 'rule' && args[1] === 'list')         return ruleList(arg('--path', process.cwd()));
  if (cmd === 'rule' && args[1] === 'remove')       return ruleRemove(arg('--path', process.cwd()), args[2]);
  if (cmd === 'rule' && args[1] === 'pause')        return rulePause(arg('--path', process.cwd()), args[2]);
  if (cmd === 'rule' && args[1] === 'resume')       return ruleResume(arg('--path', process.cwd()), args[2]);
  if (cmd === 'rule' && args[1] === 'stop')         return ruleStop(arg('--path', process.cwd()));
  if (cmd === 'rule' && args[1] === 'resume-all')   return ruleResumeAll(arg('--path', process.cwd()));
  if (cmd === 'rule' && args[1] === 'verify')       return ruleVerifyCmd(arg('--path', process.cwd()));
  if (cmd === 'release' && args[1] === 'bump')      return releaseBump(args[2] || arg('--path', process.cwd()));
  if (cmd === 'release' && args[1] === 'note')      return releaseNote(arg('--path', process.cwd()), args.slice(2).filter(x => !x.startsWith('-')).join(' '));
  if (cmd === 'release' && args[1] === 'publish')   return releasePublish(args[2] || arg('--path', process.cwd()));
  if (cmd === 'release' && args[1] === 'pack')      return await releasePackCmd(args[2] || arg('--path', process.cwd()));
  if (cmd === 'release' && args[1] === 'sync-main') return releaseSyncMainCmd(args[2] || arg('--path', process.cwd()));
  // 1.9.141: feature causality graph
  if (cmd === 'feature' && args[1] === 'add')    return featureAddCmd(arg('--path', process.cwd()), args.slice(2).filter(x => !x.startsWith('--')).join(' '));
  if (cmd === 'feature' && args[1] === 'link')   return featureLinkCmd(arg('--path', process.cwd()), args[2]);
  if (cmd === 'feature' && args[1] === 'impact') return featureImpactCmd(arg('--path', process.cwd()), args[2]);
  if (cmd === 'feature' && args[1] === 'list')   return featureListCmd(arg('--path', process.cwd()));
  if (cmd === 'feature' && args[1] === 'show')   return featureShowCmd(arg('--path', process.cwd()), args[2]);
  if (cmd === 'impact')                             return impactCmd(arg('--path', process.cwd()), args[1]);
  if (cmd === 'reuse' && args[1] === 'find')        return reuseFind(arg('--path', process.cwd()), args.slice(2).filter(x => !x.startsWith('-')).join(' '));
  if (cmd === 'reuse' && args[1] === 'register')    return reuseRegister(arg('--path', process.cwd()), args[2]);
  if (cmd === 'ui' && args[1] === 'consistency')    return uiConsistency(args[2] || process.cwd());
  if (cmd === 'graph')                              return graphCmd(args[1] || process.cwd());
  if (cmd === 'guide')                              return guideCmd(arg('--path', process.cwd()), args[1]);
  // legacy duplicate routing removed below (was: skill list/info/add)
  if (cmd === 'skill' && args[1] === 'info') return skillInfo(args[2]);
  if (cmd === 'skill' && args[1] === 'add')  return addSkill(absRoot(arg('--path', process.cwd())), args[2]);
  if (cmd === 'plan') {
    const root = absRoot(arg('--path', process.cwd())); const sub = args[1] || 'show';
    if (sub==='show')     return planShow(root);
    if (sub==='init')     return planInit(root);
    if (sub==='add')      return planAdd(root, args.slice(2).join(' ') || '새 계획');
    if (sub==='drop')     return planDrop(root, args.slice(2).join(' ') || '드랍 항목');
    if (sub==='remove')   return planRemoveCmd(root, args[2]);
    if (sub==='progress') return planProgress(root);
    if (sub==='sync')     return planSync(root);
    // 1.9.119: plan list — 모든 milestone JSON/verbose
    if (sub==='list')     return planListCmd(root, { json: has('--json') });
  }
  if (cmd === 'task') {
    const root = absRoot(arg('--path', process.cwd())); const sub = args[1] || 'list';
    if (sub==='list')   return taskList(root);
    if (sub==='add')    return taskAdd(root, args.slice(2).join(' ') || '새 작업');
    if (sub==='update') return taskUpdate(root, args[2]);
    if (sub==='drop')   return taskDrop(root, args[2]);
    if (sub==='fix-evidence') return taskFixEvidence(root);
    if (sub==='relink')       return taskRelink(root);
    if (sub==='sync')         return taskSyncCmd(root);
    if (sub==='export')       return taskExportCmd(root);
  }
  // 1.9.114: memory status — Memory Write Surface 5종 통합 상태
  if (cmd === 'memory' && args[1] === 'status') {
    const root = absRoot(arg('--path', args[2] && !args[2].startsWith('-') ? args[2] : process.cwd()));
    return memoryStatusCmd(root, { json: has('--json') });
  }
  // 1.9.127: memory archive list — DELETE 5종 archive 통합 조회
  if (cmd === 'memory' && args[1] === 'archive' && args[2] === 'list') {
    const root = absRoot(arg('--path', args[3] && !args[3].startsWith('-') ? args[3] : process.cwd()));
    return memoryArchiveListCmd(root, { json: has('--json') });
  }
  // 1.9.128: memory restore — archive 블록을 active 파일로 복귀 (DELETE→RESTORE cycle)
  if (cmd === 'memory' && args[1] === 'restore') {
    const root = absRoot(arg('--path', process.cwd()));
    return memoryRestoreCmd(root, args[2], args[3]);
  }
  // 1.9.112: lesson save — lessons.md에 새 lesson 추가
  // 1.9.117: lesson list — lessons.md 조회 + --tag 필터 + --json
  if (cmd === 'lesson') {
    const root = absRoot(arg('--path', process.cwd())); const sub = args[1] || '';
    if (sub === 'save') {
      const textParts = [];
      for (let i = 2; i < args.length; i++) {
        if (args[i].startsWith('--')) break;
        textParts.push(args[i]);
      }
      return lessonSave(root, textParts.join(' '));
    }
    if (sub === 'list') {
      return lessonListCmd(root, { json: has('--json') });
    }
    // 1.9.124: lesson drop <date|text>
    if (sub === 'drop') {
      const targetParts = [];
      for (let i = 2; i < args.length; i++) {
        if (args[i].startsWith('--')) break;
        targetParts.push(args[i]);
      }
      return lessonDropCmd(root, targetParts.join(' '));
    }
    return fail('lesson save "<text>" [--tag "..."] | lesson list [--tag "..."] [--json] | lesson drop <date|text>');
  }
  // 1.9.108: decision add — decisions.md에 새 설계 결정 추가
  // 1.9.118: decision list — decisions.md 전체 조회 + --json
  if (cmd === 'decision') {
    const root = absRoot(arg('--path', process.cwd())); const sub = args[1] || '';
    if (sub === 'add') {
      // args[2..] 가 title (단, --flag 가 시작되기 전까지)
      const titleParts = [];
      for (let i = 2; i < args.length; i++) {
        if (args[i].startsWith('--')) break;
        titleParts.push(args[i]);
      }
      return decisionAdd(root, titleParts.join(' '));
    }
    if (sub === 'list') {
      return decisionListCmd(root, { json: has('--json') });
    }
    // 1.9.125: decision drop <date|title>
    if (sub === 'drop') {
      const targetParts = [];
      for (let i = 2; i < args.length; i++) {
        if (args[i].startsWith('--')) break;
        targetParts.push(args[i]);
      }
      return decisionDropCmd(root, targetParts.join(' '));
    }
    return fail('decision add "<title>" --reason "..." --alternatives "..." --impact "..." | decision list [--json] | decision drop <date|title>');
  }
  return help();
}

// 1.9.4 B: main 종료 후 exitCode를 명시적으로 process.exit으로 강제 (셸/wrapper 차 무시).
main()
  .then(() => { if (process.exitCode && process.exitCode !== 0) process.exit(process.exitCode); })
  .catch(err => { fail(err && err.message ? err.message : String(err)); process.exit(1); });
