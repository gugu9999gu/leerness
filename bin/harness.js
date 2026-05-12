#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const readline = require('readline');

const VERSION = '1.9.13';
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
function read(p) { return fs.readFileSync(p, 'utf8'); }
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
  const withValue = new Set(['--language','--skills','--path','--status','--progress','--goal','--reason','--next','--target','--token-env','--package','--out','--from','--repo','--id','--note','--evidence','--query','--limit','--action','--agent','--tool','--doc','--command','--capability','--before','--after','--display','--threshold','--trigger','--check','--set','--min-score']);
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
    '### Planning Files',
    '',
    '- `.harness/plan.md`: 전체 목표, milestone, 제외/드랍 범위',
    '- `.harness/progress-tracker.md`: 요청 단위 상태와 증거',
    '- `.harness/current-state.md`: 지금 이어서 할 작업',
    '- `.harness/session-handoff.md`: 다음 세션 인수인계 (자동 작성)',
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
    'AGENTS.md': `${MARK}\n# Leerness Agent Instructions\n\n## Mandatory read order (session start)\n1. .harness/context-routing.md\n2. .harness/session-handoff.md\n3. .harness/current-state.md\n4. .harness/plan.md\n5. .harness/progress-tracker.md\n6. .harness/guideline.md\n7. .harness/protected-files.md\n8. .harness/writeback-policy.md\n9. .harness/anti-lazy-work-policy.md\n10. **.harness/rules.md** (사용자 정의 영구 룰 — 매 세션 반드시 따름)\n\n## Required behavior\n- 작업 시작 시 \`leerness handoff .\`를 실행해 컨텍스트를 적재합니다 (handoff가 active rules를 자동 출력).\n- 작업 분류는 \`leerness route <task-type>\`로 확인합니다 (planning, feature, bugfix, refactor, research, consistency, release, migration, session-start, session-close, harness-maintenance).\n- 보호 파일/관리 섹션을 삭제하지 않습니다. 머지·아카이브·deprecated 표시를 사용합니다.\n- 의미 있는 변경 후 progress-tracker, current-state, task-log, session-handoff를 갱신합니다.\n- 완료 선언 전 \`leerness check .\` 또는 \`leerness lazy detect .\`로 자기검증합니다.\n- 변경 전 secret/encoding 가드: \`leerness scan secrets .\`, \`leerness encoding check .\`.\n- 같은 기능 중복 생성 전 design-system.md, consistency-policy.md, reuse-map.md를 확인합니다.\n- 매 세션 종료 시 \`leerness session close .\`로 9개 카테고리(완료/진행중/미완료/예정/대기/보류/차단/드랍/검증) + **활성 룰 검증 결과**를 보고합니다.\n- 업데이트는 \`leerness update --check\` (감지) → \`leerness update --yes\` (자동 마이그레이션).\n\n## 자연어 회고/통찰/브레인스토밍 (1.9.13)\n사용자가 자연어로 회고/통찰/브레인스토밍을 요청하면 즉시 leerness 명령으로 호출합니다.\n\n| 사용자 발화 (자연어) | 즉시 실행할 명령 |\n|---|---|\n| "회고해줘 / 돌아보자 / 정리해줘" | \`leerness retro\` |\n| "최근 N일 회고" | \`leerness retro --days N\` |\n| "통계 / 누적 지표 / insights" | \`leerness insights\` |\n| "X에 대해 브레인스토밍 / X 관련 자료 / X 시작 전 검토" | \`leerness brainstorm "X"\` |\n\nsession close가 매번 자동으로 한 줄 요약을 출력하고, 5세션마다 자동 깊은 회고를 실행합니다. 사용자가 명시 요청 시 즉시 호출.\n\n## 자연어 룰 처리 (1.9.8)\n사용자가 자연어로 영구 룰을 요청하면 즉시 leerness rule 명령으로 등록합니다.\n\n| 사용자 발화 (자연어) | 즉시 실행할 명령 |\n|---|---|\n| "매 업데이트마다 버전 bump해줘" | \`leerness rule add "버전을 patch로 bump" --trigger every-update\` |\n| "매 커밋마다 패치노트 추가해줘" | \`leerness rule add "패치노트 추가" --trigger every-commit\` |\n| "세션 종료마다 배포해줘" | \`leerness rule add "배포 (release publish)" --trigger session-close\` |\n| "X 룰 중지/그만/끄기" | \`leerness rule pause <ID>\` (해당 룰 ID는 list로 확인) |\n| "X 룰 제거/삭제" | \`leerness rule remove <ID>\` |\n| "모든 룰 중지" | \`leerness rule stop\` |\n| "룰 다시 켜줘" | \`leerness rule resume-all\` 또는 \`leerness rule resume <ID>\` |\n\n룰을 등록한 후 사용자에게 등록 결과(ID + trigger + 설명)를 보고하고, 그 이후 매 세션마다 자동 적용합니다. 사용자가 "중지" 또는 "제거"를 명시적으로 말하기 전까지는 룰을 비활성화하지 않습니다.\n\n## 룰 자동 적용 (1.9.8)\nleerness가 자동 검증 가능한 trigger:\n- **every-update / version bump 키워드 룰**: package.json의 version이 갱신됐는지 검사 (handoff/session close가 baseline 캐시와 비교).\n- **CHANGELOG / 패치노트 키워드 룰**: CHANGELOG.md의 mtime이 갱신됐는지 검사.\n- **test / 테스트 / verify 키워드 룰**: review-evidence.md에 오늘 verify-code 흔적이 있는지 검사.\n- **배포 / publish / push 키워드 룰**: 자동 검증 불가 → 사용자에게 release publish 명령을 안내.\n\n자동 검증 가능한 룰의 실행은 \`leerness release bump\`, \`leerness release note "..."\`, \`leerness release publish\`를 사용해 자동화합니다.\n`,
    'CLAUDE.md': `${MARK}\n# Claude Code Instructions\n\nFollow AGENTS.md. Always run \`leerness handoff .\` at the start and \`leerness session close .\` before ending a session.\n\nProtected files must not be deleted. Read .harness/anti-lazy-work-policy.md before claiming completion.\n\n## 자연어 영구 룰 (1.9.8)\n사용자가 "매 X마다 Y를 해줘" 같은 자연어 룰을 말하면 즉시 \`leerness rule add "Y" --trigger every-X\`로 등록하세요. 등록된 룰은 매 세션 \`handoff\`가 자동 출력하고, \`session close\`가 자동 검증해 보고합니다. 사용자가 "중지" / "그만" / "끄기"를 명시할 때만 \`rule pause/remove\`를 호출합니다.\n\n자세한 매핑은 AGENTS.md의 "자연어 룰 처리" 표를 참고하세요.\n`,
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
    '.harness/decisions.md': fm('decisions', ['설계 결정 확인'], ['중요 결정 발생'], `# Decisions\n\n## Template\n### ${today()} — Decision\n- Decision:\n- Reason:\n- Alternatives:\n- Impact:\n`),
    '.harness/task-log.md': fm('task-log', ['작업 이력 확인'], ['모든 의미 있는 작업 후'], `# Task Log\n\n## ${today()}\n- Leerness v${VERSION} initialized.\n`),
    '.harness/guardrails.md': fm('guardrails', ['모든 작업 전','보안/권한/리팩토링 전'], ['금지 규칙 변경'], `# Guardrails\n\n- 토큰/키/비밀번호를 저장하지 않습니다. 환경변수 이름만 기록합니다.\n- 요청 없는 대규모 리팩토링을 하지 않습니다 (5개 이상 파일 변경 시 사용자 사전 승인).\n- API/DB/환경변수 변경은 영향 범위를 task-log에 기록합니다.\n- Leerness 보호 파일/관리 섹션을 삭제하지 않습니다.\n- 한글 인코딩은 BOM 없는 UTF-8을 유지합니다.\n- destructive Git 작업(\`git reset --hard\`, \`git push --force\` 등)은 사용자 명시 승인 후에만 수행합니다.\n`),
    '.harness/design-system.md': fm('design-system', ['UI 변경','컴포넌트 추가','designguide 병합'], ['디자인 기준 변경','재사용 패턴 발견'], `# Design System\n\n## Canonical File\n이 파일은 designguide.md, design-guide.md와 같은 디자인 가이드의 기준 파일입니다.\n\n## Tokens\n| Token | Value | Notes |\n|---|---|---|\n| color.primary | (실제 값으로 업데이트) | |\n| color.surface | | |\n| spacing.unit | | |\n| typography.body | | |\n\n## Reusable Patterns\n| Pattern | Where | Reuse Rule |\n|---|---|---|\n`),
    '.harness/consistency-policy.md': fm('consistency-policy', ['UI/기능 중복 생성 전','재사용 판단'], ['일관성 정책 변경'], `# Consistency Policy\n\n동일한 기능을 하는 요소는 새로 만들기 전에 기존 구현을 찾아 재사용/확장/연결합니다.\n\n## Recursive Reuse Rule\n1. 같은 기능의 기존 요소를 찾습니다.\n2. 자기 참조/기저 규칙/재귀 흐름이 필요한지 확인합니다.\n3. 기존 요소를 재사용하거나 확장합니다.\n4. 불가피하게 새로 만들면 reuse-map.md에 이유를 기록합니다.\n\n## Audit Trigger\n\`leerness audit\`는 다음을 검사합니다:\n- 디자인 가이드 중복 파일\n- design-system.md 토큰 미정의\n- reuse-map.md 비어있음 + 컴포넌트/유틸 ≥3개 발견\n- plan vs progress 정렬\n`),
    '.harness/reuse-map.md': fm('reuse-map', ['새 컴포넌트/API/helper 생성 전','중복 기능 감지'], ['재사용 가능한 요소 추가'], `# Reuse Map\n\n| Capability | Existing Element | Reuse Method | Notes |\n|---|---|---|---|\n`),
    '.harness/feature-contracts.md': fm('feature-contracts', ['기능 구현/수정 전'], ['기능 입출력/상태/오류 변경'], `# Feature Contracts\n\n## Template\n- Feature:\n- Input:\n- Output:\n- States:\n- Errors:\n- Related files:\n- Test evidence ID:\n`),
    '.harness/testing-strategy.md': fm('testing-strategy', ['검증 전','릴리즈 전'], ['테스트 전략 변경'], `# Testing Strategy\n\n- Typecheck (\`tsc --noEmit\` 또는 동등)\n- Lint (\`npm run lint\` 등)\n- Unit/Integration/E2E\n- Manual smoke test\n- Browser/UI smoke (frontend 변경 시)\n\n## Evidence Format\nEach completed task must reference an evidence ID stored in .harness/review-evidence.md.\n`),
    '.harness/review-checklist.md': fm('review-checklist', ['PR/리뷰 전'], ['리뷰 기준 변경'], `# Review Checklist\n\n- [ ] 계획과 정렬되어 있는가\n- [ ] progress-tracker가 갱신되었는가\n- [ ] 보호 파일을 삭제하지 않았는가\n- [ ] 디자인/기능 재사용을 확인했는가\n- [ ] 시크릿이 코드에 들어가지 않았는가 (\`leerness scan secrets\`)\n- [ ] 한글 인코딩 OK (\`leerness encoding check\`)\n- [ ] 게으름 평가 통과 (\`leerness lazy detect\`)\n`),
    '.harness/release-checklist.md': fm('release-checklist', ['배포 전'], ['배포 조건/환경변수/롤백 변경'], `# Release Checklist\n\n- [ ] \`leerness verify .\`\n- [ ] \`leerness audit .\`\n- [ ] \`leerness scan secrets .\`\n- [ ] \`leerness encoding check .\`\n- [ ] 프로젝트 typecheck/lint/test\n- [ ] 환경변수 (.env.example) 동기화\n- [ ] 롤백 방법 확인\n- [ ] CHANGELOG 갱신\n`),
    '.harness/session-close-policy.md': fm('session-close-policy', ['세션 종료 전'], ['세션 종료 형식 변경'], `# Session Close Policy\n\nEvery session must list:\n- Completed\n- In progress\n- Incomplete\n- Planned\n- Waiting\n- On hold\n- Blocked\n- Dropped\n- Verification (commands run, results)\n- Recommended next direction\n- Next exact step\n\n\`leerness session close\`가 위 9개 카테고리를 자동 추출하고, session-handoff.md에 다음 세션을 위한 인수인계 블록을 자동 작성합니다.\n`),
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

function writeMigrationReport(root, backup, actions) {
  const p = path.join(root, '.harness/migration-report.md');
  const rows = actions.map(a => `| ${a.file} | ${a.action} |`).join('\n');
  writeUtf8(p, `# Leerness Migration Report\n\nVersion: ${VERSION}\nDate: ${now()}\nBackup: ${rel(root, backup.archiveDir)}\n\n## Policy\n\n- Existing harness, skill, and instruction files are backed up before migration.\n- Project memory files are preserved by default.\n- Managed instruction files are merged with previous content instead of being blindly overwritten.\n- .env.example/.gitignore are line-merged only.\n\n## Backed Up Candidates\n\n${backup.candidates.map(x => '- ' + x).join('\n')}\n\n## File Actions\n\n| File | Action |\n|---|---|\n${rows}\n`);
}

function syncReadme(root) {
  const p = path.join(root, 'README.md');
  const existing = exists(p) ? read(p) : '';
  writeUtf8(p, mergeReadmeSection(existing, managedReadmeBlock(detectProjectName(root))));
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
  if (shouldAsk && !explicitLang) {
    log('\n설치 언어를 선택하세요.');
    log('1) 자동 감지'); log('2) 한국어'); log('3) English');
    const a = await ask('선택 [1]: ');
    lang = a === '2' ? 'ko' : a === '3' ? 'en' : detectLanguageValue(root, 'auto');
  }
  if (shouldAsk && !explicitSkills) {
    log('\n설치할 스킬 라이브러리를 선택하세요.');
    log('0) 기본 하네스만 설치');
    log('1) 추천: office, commerce-api, ai-verified-skill-publisher, feature-implementation');
    log('2) 전체 스킬 설치'); log('3) 직접 입력');
    skillList();
    const a = await ask('선택 [1]: ');
    if (!a || a === '1') skills = parseSkillsValue('recommended');
    else if (a === '2') skills = parseSkillsValue('all');
    else if (a === '3') skills = parseSkillsValue(await ask('스킬 ID를 쉼표로 입력: '));
    else if (a === '0') skills = [];
  }
  return { lang, skills };
}

async function install(root, opts = {}) {
  root = absRoot(root); mkdirp(root);
  const resolved = await resolveInstallOptions(root, opts);
  const lang = resolved.lang;
  const skills = resolved.skills;
  log(`\nLeerness v${VERSION}`);
  log(`Target: ${root}`);
  log(`Language: ${lang}`);
  log(`Skills: ${skills.length ? skills.join(', ') : 'none'}`);
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
      '.harness/skill-publish.local.json','.harness/**/*.local.json','.env.local',
      '.harness/archive/','.harness/migration-report.md','.harness/cache/'
    ]);
    mergeLinesFile(path.join(root, '.env.example'), [
      '# Leerness uses environment variable names only. Do not store real secrets here.',
      'LEERNESS_NPM_TOKEN=','LEERNESS_GITHUB_TOKEN='
    ]);
    mergeLinesFile(path.join(root, '.gitattributes'), [
      '* text=auto eol=lf','*.bat text eol=crlf','*.ps1 text eol=crlf'
    ]);
    syncReadme(root);
    installSkills(root, skills);
    writeMigrationReport(root, backup, actions);
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
  // README mirror
  const usage = data.usage || { count: 0 };
  const readme = `# ${data.displayNameKo || id}\n\n## Capabilities\n${(data.capabilities || []).map(c => '- ' + c).join('\n') || '-'}\n\n## Sources\n${(data.sources || []).map(s => `- ${s.url || s}`).join('\n') || '-'}\n\n## Patterns (성공 명령/접근)\n${(data.patterns || []).map(p => `- \`${p.command}\` — ${p.note || ''}`).join('\n') || '-'}\n\n## Optimization history\n${(data.optimizations || []).map(o => `- ${o.at}: ${o.note || ''}${o.before||o.after?` (${o.before||'?'} → ${o.after||'?'})`:''}`).join('\n') || '-'}\n\n## Usage\n${usage.count || 0}회 사용 / 마지막: ${usage.lastUsed || '-'}\n${usage.lastNote ? '\n마지막 노트: ' + usage.lastNote : ''}\n`;
  writeUtf8(path.join(dir, 'README.md'), readme);
}

function listAllSkills(root) {
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

function skillList(root) {
  const all = listAllSkills(root);
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

const planPath = root => path.join(root, '.harness/plan.md');
const progressPath = root => path.join(root, '.harness/progress-tracker.md');
const taskLogPath = root => path.join(root, '.harness/task-log.md');
const evidencePath = root => path.join(root, '.harness/review-evidence.md');
const handoffPath = root => path.join(root, '.harness/session-handoff.md');
const currentStatePath = root => path.join(root, '.harness/current-state.md');
const decisionsPath = root => path.join(root, '.harness/decisions.md');

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
function planSync(root) { append(taskLogPath(root), `\n## ${today()}\n- Synced plan.md and progress-tracker.md.\n`); ok('plan/progress sync noted'); }

function taskList(root) {
  const rows = readProgressRows(root);
  if (!rows.length) return log('(no tasks)');
  log('| ID | Status | Request | Evidence | Next Action | Updated |');
  log('|---|---|---|---|---|---|');
  for (const r of rows) log(`| ${r.id} | ${r.status} | ${r.request} | ${r.evidence} | ${r.nextAction} | ${r.updated} |`);
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

function audit(root) {
  root = absRoot(root);
  let warnings = 0, failures = 0;
  const designCands = ['designguide.md','design-guide.md','docs/designguide.md','docs/design-guide.md','.harness/designguide.md'];
  const dups = designCands.filter(f => exists(path.join(root,f)));
  if (dups.length) { warnings++; warn(`design guide duplicates outside canonical: ${dups.join(', ')} (run: leerness consistency merge-design-guide)`); }
  else ok('no duplicate design guide candidates');
  // 1.9.1 P4: <!-- leerness:na --> 마커가 있는 파일은 placeholder 경고 스킵.
  const naMarker = '<!-- leerness:na';
  const ds = exists(path.join(root,'.harness/design-system.md')) ? read(path.join(root,'.harness/design-system.md')) : '';
  if (ds.includes(naMarker)) ok('design-system.md marked NA (skipped)');
  else if (!/\| color\.primary \|/.test(ds) || /\(실제 값으로 업데이트\)/.test(ds)) { warnings++; warn('design-system.md tokens not customized'); }
  else ok('design-system tokens populated');
  const reuse = exists(path.join(root,'.harness/reuse-map.md')) ? read(path.join(root,'.harness/reuse-map.md')) : '';
  const reuseLines = reuse.split('\n').filter(l => l.startsWith('|') && !/Capability|---/.test(l)).length;
  if (reuse.includes(naMarker)) ok('reuse-map.md marked NA (skipped)');
  else if (reuseLines === 0) { warnings++; warn('reuse-map.md is empty (consider populating known reusable elements)'); }
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
    log(`    → 자동 매칭 제안: leerness task relink`);
    log(`    → 자동 적용:     leerness task relink --apply`);
  }
  else if (milestoneIds.length) ok('all milestones linked in progress-tracker');
  const handoff = exists(handoffPath(root)) ? read(handoffPath(root)) : '';
  if (handoff.includes('Last generated: (자동)')) { warnings++; warn('session-handoff.md never auto-generated (run: leerness session close .)'); }
  else if (handoff.includes('Last generated:')) ok('session-handoff.md auto-generated previously');
  const cur = exists(currentStatePath(root)) ? read(currentStatePath(root)) : '';
  const updMatch = cur.match(/Updated: (\d{4}-\d{2}-\d{2})/);
  if (updMatch) {
    const dDays = (Date.now() - new Date(updMatch[1]).getTime()) / 86400000;
    if (dDays > 7) { warnings++; warn(`current-state.md stale (${Math.round(dDays)} days)`); }
    else ok('current-state.md fresh');
  }
  log(`Audit summary: warnings=${warnings} failures=${failures}`);
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

function lazyDetect(root) {
  root = absRoot(root);
  let issues = 0;
  const rows = readProgressRows(root);
  // 1.9.1 P6: evidence가 단독 plan:M-XXXX 한 줄일 때만 검증 부족 처리.
  // "tests:32/32 (plan:M-0002)" 같이 검증 키워드를 같이 적은 경우는 통과.
  for (const r of rows) if (r.status === 'done' && (!r.evidence || /^(\s*|user-request|-)$/.test(r.evidence) || /^plan:M-\d{4}\s*$/.test(r.evidence))) {
    issues++; warn(`done row without verifiable evidence: ${r.id} (${r.request})`);
  }
  if (rows.length === 0) { issues++; warn('progress-tracker is empty (no tasks tracked)'); }
  const handoff = exists(handoffPath(root)) ? read(handoffPath(root)) : '';
  if (!handoff.includes('Last generated:') || handoff.includes('Last generated: (자동)')) {
    issues++; warn('session-handoff.md never auto-generated');
  }
  if (/^## Completed\s*\n-\s*\n/m.test(handoff) && /^## Next Exact Step\s*\n-\s*\n?/m.test(handoff)) {
    issues++; warn('session-handoff.md has empty Completed and Next Exact Step');
  }
  const ev = exists(evidencePath(root)) ? read(evidencePath(root)) : '';
  const hasTestRun = /\b(npm test|pnpm test|yarn test|pytest|jest|vitest|tsc|eslint|playwright|cypress)\b/i.test(ev);
  if (!hasTestRun) { issues++; warn('review-evidence.md has no recorded test/typecheck/lint run'); }
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
      warn(`code has ${todoCount} TODO/FIXME/XXX (new: ${newTodos.length}) but no progress-tracker entry tracks them`);
      // 새 TODO 처음 5개 표시
      newTodos.slice(0, 5).forEach(t => log(`    ${t.file}:${t.line}  ${t.text}`));
      if (has('--auto-track') && newTodos.length) {
        for (const t of newTodos) {
          const id = nextId(root, 'T');
          upsertProgress(root, { id, status: 'requested', request: `TODO ${t.file}:${t.line}`, evidence: 'auto-tracked', nextAction: t.text.slice(0, 80) });
        }
        // known-todos에 추가 — 다음 detect에서 재카운트 안 하도록
        const merged = [...knownList, ...newTodos.map(t => ({ ...t, ackAt: now() }))];
        writeUtf8(knownPath, JSON.stringify(merged, null, 2) + '\n');
        ok(`${newTodos.length}개 TODO를 progress-tracker에 자동 등록 + known-todos.json 갱신`);
      } else if (newTodos.length) {
        log(`    💡 자동 등록: leerness lazy detect --auto-track`);
      }
    }
  }
  const blockers = rows.filter(r => r.status === 'blocked');
  for (const b of blockers) if (b.nextAction === '없음' || /다음 액션 작성/.test(b.nextAction)) { issues++; warn(`blocker without nextAction: ${b.id}`); }
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
  if (total === 0) log('(no matches)');
  else log(`\n${total} matches`);
}

function handoff(root) {
  root = absRoot(root);
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
  ok('handoff loaded; current-state updated');
}

function sessionClose(root) {
  root = absRoot(root);
  const rows = readProgressRows(root);
  const buckets = {};
  for (const s of STATUSES) buckets[s] = [];
  for (const r of rows) (buckets[r.status] || (buckets[r.status] = [])).push(r);

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
  // 1.9.13: 세션 카운터 + 자동 한 줄 요약 + 5세션마다 깊은 회고
  try {
    const sc = readSessionCounter(root);
    sc.count = (sc.count || 0) + 1;
    sc.lastCloseAt = now();
    writeSessionCounter(root, sc);
    const agg = _retroAggregate(root);
    log(`\n## 📈 진행 요약 (session #${sc.count})`);
    log(`  ${_retroOneLine(agg)}`);
    if (sc.count % 5 === 0) {
      log(`\n## 🔄 ${sc.count}세션 마일스톤 — 자동 회고 (5세션마다)`);
      retroCmd(root);
      sc.lastDeepRetroAt = now();
      writeSessionCounter(root, sc);
    } else {
      const left = 5 - (sc.count % 5);
      log(`  💡 ${left}세션 후 자동 깊은 회고 — \`leerness retro\`로 즉시 실행 가능`);
    }
  } catch (e) {
    warn('retro 요약 실패: ' + (e && e.message ? e.message : e));
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

  // 2) 결정 블록 수
  const decisionBlocks = decisions.split(/\n(?=### )/).filter(b => b.startsWith('### '));
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

  // 7) 최근 in-progress / incomplete (우선 권장)
  const focusNext = rows.filter(r => r.status === 'in-progress')
    .concat(rows.filter(r => ['incomplete', 'blocked', 'waiting', 'on-hold'].includes(r.status)));

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

function retroCmd(root) {
  root = absRoot(root);
  const days = parseInt(arg('--days', '7'), 10);
  const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10);
  const agg = _retroAggregate(root);
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

function insightsCmd(root) {
  root = absRoot(root);
  const agg = _retroAggregate(root);
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

function brainstormCmd(root, topic) {
  root = absRoot(root);
  if (!topic) return fail('topic required (e.g., brainstorm "API rate limit")');
  log(`# Brainstorm — "${topic}"`);
  log(`\n누적된 leerness 데이터에서 주제 관련 자원을 회수합니다.`);

  const re = new RegExp(escapeRegex(topic), 'i');
  const hits = { decisions: [], skills: [], tasks: [], rules: [], evidence: [], lessons: [] };

  // decisions
  const dec = exists(decisionsPath(root)) ? read(decisionsPath(root)) : '';
  for (const b of dec.split(/\n(?=### )/)) {
    if (!b.startsWith('### ')) continue;
    if (re.test(b)) {
      const t = (b.match(/^### (.+)$/m) || [, ''])[1];
      hits.decisions.push({ title: t, preview: b.slice(0, 200).replace(/\n+/g, ' ') });
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
        if (re.test(text)) hits.skills.push({ id, displayNameKo: s.displayNameKo, capabilities: s.capabilities, usage: s.usage });
      } catch {}
    }
  }
  // tasks
  const rows = readProgressRows(root);
  for (const r of rows) if (re.test(r.request) || re.test(r.evidence) || re.test(r.nextAction)) hits.tasks.push(r);
  // rules
  if (exists(rulesPath(root))) {
    for (const r of readRules(root)) if (re.test(r.rule)) hits.rules.push(r);
  }
  // evidence — lessons 키워드 (fail/롤백/incomplete) 동반
  const ev = exists(evidencePath(root)) ? read(evidencePath(root)) : '';
  for (const block of ev.split(/\n(?=## )/)) {
    if (!block.startsWith('## ')) continue;
    if (re.test(block)) {
      const t = (block.match(/^## (.+)$/m) || [, ''])[1];
      hits.evidence.push({ title: t.trim(), preview: block.slice(0, 200).replace(/\n+/g, ' ') });
      if (/✗|fail|롤백|incomplete|버그/i.test(block)) hits.lessons.push({ title: t.trim() });
    }
  }

  const total = hits.decisions.length + hits.skills.length + hits.tasks.length + hits.rules.length + hits.evidence.length;
  log(`\n📦 총 ${total}건 발견 (decisions ${hits.decisions.length} · skills ${hits.skills.length} · tasks ${hits.tasks.length} · rules ${hits.rules.length} · evidence ${hits.evidence.length})`);

  if (hits.decisions.length) {
    log(`\n## 🧠 관련 결정 (${hits.decisions.length})`);
    hits.decisions.slice(0, 5).forEach(d => log(`  - ${d.title}`));
  }
  if (hits.skills.length) {
    log(`\n## 📚 관련 스킬 (${hits.skills.length}) — 시작 전 \`skill info <id>\` 권장`);
    hits.skills.forEach(s => log(`  - ${s.id} (${s.displayNameKo}) · 사용 ${s.usage?.count || 0}회 · cap ${(s.capabilities || []).length}`));
  }
  if (hits.tasks.length) {
    log(`\n## 📌 관련 과거 task (${hits.tasks.length})`);
    hits.tasks.slice(0, 5).forEach(t => log(`  - ${t.id} [${t.status}] ${t.request}`));
  }
  if (hits.rules.length) {
    log(`\n## ⚡ 관련 룰 (${hits.rules.length})`);
    hits.rules.forEach(r => log(`  - ${r.id} [${r.trigger}] ${r.rule}`));
  }
  if (hits.evidence.length) {
    log(`\n## 🧪 관련 검증 기록 (${hits.evidence.length})`);
    hits.evidence.slice(0, 5).forEach(e => log(`  - ${e.title}`));
  }
  if (hits.lessons.length) {
    log(`\n## ⚠ 같은 주제 과거 실패/롤백 (${hits.lessons.length}) — 같은 실수 방지`);
    hits.lessons.slice(0, 5).forEach(l => log(`  - ${l.title}`));
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
function verifyCodeCmd(root) {
  root = absRoot(root);
  const pkgFile = path.join(root, 'package.json');
  if (!exists(pkgFile)) return fail('package.json 없음 — Node 프로젝트 위치에서 실행하세요.');
  let pkg;
  try { pkg = JSON.parse(read(pkgFile)); } catch (e) { return fail('package.json 파싱 실패: ' + e.message); }
  const scripts = pkg.scripts || {};
  const tasks = [];
  if (scripts.test) tasks.push({ name: 'test', cmd: 'npm test' });
  else if (scripts['test:smoke']) tasks.push({ name: 'test', cmd: 'npm run test:smoke' });
  if (scripts.lint) tasks.push({ name: 'lint', cmd: 'npm run lint' });
  if (scripts.typecheck) tasks.push({ name: 'typecheck', cmd: 'npm run typecheck' });
  else if (scripts.tsc) tasks.push({ name: 'typecheck', cmd: 'npm run tsc' });
  else if (exists(path.join(root, 'tsconfig.json'))) tasks.push({ name: 'typecheck', cmd: 'npx --yes tsc --noEmit', optional: true });
  if (has('--build') && scripts.build) tasks.push({ name: 'build', cmd: 'npm run build' });
  if (!tasks.length) {
    warn('실행할 검증 task 없음 (package.json#scripts에 test/lint/typecheck 추가하세요)');
    return;
  }
  log(`# verify-code (${tasks.length}개)`);
  let failedCnt = 0;
  const results = [];
  for (const t of tasks) {
    log(`\n## ${t.name}: ${t.cmd}`);
    const start = Date.now();
    const r = cp.spawnSync(t.cmd, [], { cwd: root, encoding: 'utf8', shell: true, timeout: 5 * 60 * 1000 });
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
  const query = arg('--query', null);
  const limit = parseInt(arg('--limit', '10'), 10);
  const decisions = exists(decisionsPath(root)) ? read(decisionsPath(root)) : '';
  const evidence = exists(evidencePath(root)) ? read(evidencePath(root)) : '';
  const tlog = exists(taskLogPath(root)) ? read(taskLogPath(root)) : '';
  const handoff = exists(handoffPath(root)) ? read(handoffPath(root)) : '';
  const lessons = [];
  // decisions: ### 블록 전체
  for (const block of decisions.split(/\n(?=### )/)) {
    if (!block.startsWith('### ')) continue;
    const m = block.match(/^### (.+)$/m);
    if (!m) continue;
    lessons.push({ source: 'decisions.md', title: m[1].trim(), block });
  }
  // evidence: ## 블록 중 실패/롤백/버그 표지가 있는 것
  for (const block of evidence.split(/\n(?=## )/)) {
    if (!block.startsWith('## ')) continue;
    if (/✗|\bfail(ed)?\b|롤백|재발|incomplete|\bbug\b|버그|warning/i.test(block)) {
      const m = block.match(/^## (.+)$/m);
      if (m) lessons.push({ source: 'review-evidence.md', title: m[1].trim(), block });
    }
  }
  // task-log: 실패 키워드 라인
  for (const line of tlog.split('\n')) {
    if (line.length > 4 && /✗|\bfail|롤백|재발|incomplete|버그/i.test(line)) {
      lessons.push({ source: 'task-log.md', title: line.replace(/^[-*]\s*/, '').slice(0, 80), block: line });
    }
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

// ===== ViewWork hook =====
function viewworkEmit(root, ev) {
  root = absRoot(root);
  const dir = path.join(root, '.viewwork');
  if (!exists(dir)) return;
  const file = path.join(dir, 'agent-events.jsonl');
  const line = JSON.stringify({
    at: Date.now(),
    agent: ev.agent || 'leerness',
    agentKind: ev.agentKind || 'system',
    action: ev.action || 'task',
    path: ev.path || '/.harness',
    tool: ev.tool || 'leerness-cli',
    toolKind: ev.toolKind || 'task',
    note: ev.note || ''
  }) + '\n';
  try { fs.appendFileSync(file, line, 'utf8'); } catch {}
}

function viewworkInstall(root) {
  root = absRoot(root);
  const dir = path.join(root, '.viewwork');
  mkdirp(dir);
  if (!exists(path.join(dir, 'agent-events.jsonl'))) writeUtf8(path.join(dir, 'agent-events.jsonl'), '');
  if (!exists(path.join(dir, 'config.json'))) writeUtf8(path.join(dir, 'config.json'), JSON.stringify({ schemaVersion: 2 }, null, 2) + '\n');
  if (!exists(path.join(dir, 'version'))) writeUtf8(path.join(dir, 'version'), '2\n');
  const settingsDir = path.join(root, '.claude');
  mkdirp(settingsDir);
  const settingsFile = path.join(settingsDir, 'settings.local.json');
  let settings = {};
  if (exists(settingsFile)) { try { settings = JSON.parse(read(settingsFile)); } catch {} }
  settings.hooks = settings.hooks || {};
  if (!settings.hooks.Stop) settings.hooks.Stop = [];
  if (!settings.hooks.Stop.some(h => h.command && h.command.includes('leerness viewwork'))) {
    settings.hooks.Stop.push({ matcher: '*', command: 'leerness viewwork emit . --action task --note "claude session stop"' });
  }
  writeUtf8(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  writeUtf8(path.join(root, '.claude/commands/viewwork-ping.md'),
    `# /viewwork-ping\n\nViewWork 이벤트를 수동으로 기록합니다.\n\n\`\`\`\n!leerness viewwork emit . --action note --note \"manual ping\"\n\`\`\`\n`);
  ok('viewwork hook installed');
  ok('claude .claude/settings.local.json updated (Stop hook adds a viewwork event)');
}

function help() {
  log(`Leerness v${VERSION}\n\nUsage:\n  leerness init [path] [--language auto|ko|en] [--skills recommended|all|a,b]\n  leerness migrate [path] [--dry-run] [--force]\n  leerness update [path] [--check|--yes|--force|--from <tarball>]\n  leerness auto-update install [path]\n  leerness status [path]\n  leerness verify [path]\n  leerness debug [path]\n  leerness audit [path]\n  leerness check [path]\n  leerness scan secrets [path]\n  leerness encoding check [path]\n  leerness lazy detect [path]\n  leerness memory search "query" [--limit 5]\n  leerness handoff [path]\n  leerness session close [path]\n  leerness viewwork install [path]\n  leerness viewwork emit [path] [--action a] [--note n] [--agent x] [--tool t]\n  leerness route <task-type>\n  leerness self check [path]\n  leerness readme sync [path]\n  leerness consistency check [path]\n  leerness consistency merge-design-guide [path]\n  leerness plan show|init|add|drop|progress|sync [args]\n  leerness task list|add|update|drop|fix-evidence|relink [args]\n  leerness skill list|info <name>\n  leerness skill learn <id> --doc <url> --command "..." --capability "..." [--note ...]\n  leerness skill use <id> [--note ...]\n  leerness skill optimize <id> --before "..." --after "..." [--note ...]\n  leerness skill remove <id>\n  leerness skill consolidate [--threshold 0.3]\n  leerness gate [path]                       # verify+audit+scan+encoding+lazy
  leerness retro [path] [--days 7]           # 회고 (1.9.13) — 작업/스킬/결정/검증 시간 추세 + 권장
  leerness insights [path]                   # 누적 통계 (1.9.13) — 핵심 지표 + 안정성
  leerness brainstorm "<주제>"             # 브레인스토밍 (1.9.13) — 누적 자원 회수 + 시작 컨텍스트
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
  if (has('--version') || has('-v')) return log(VERSION);
  if (has('--help') || has('-h')) return help();
  if (cmd === 'init')      return await install(args[1] || process.cwd(), { force:false, dry:false, migration:false });
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
  if (cmd === 'lazy' && args[1] === 'detect')    return lazyDetect(args[2] || process.cwd());
  if (cmd === 'memory' && args[1] === 'search')  return memorySearch(arg('--path', process.cwd()), args.slice(2).join(' '));
  if (cmd === 'handoff')   return handoff(args[1] || process.cwd());
  if (cmd === 'session' && args[1] === 'close') { const r = sessionClose(args[2] || process.cwd()); viewworkEmit(args[2] || process.cwd(), { action: 'task', tool: 'session-close', note: 'session close' }); return r; }
  if (cmd === 'viewwork' && args[1] === 'install') return viewworkInstall(args[2] || process.cwd());
  if (cmd === 'viewwork' && args[1] === 'emit')    return viewworkEmit(args[2] || process.cwd(), { action: arg('--action','task'), note: arg('--note',''), agent: arg('--agent','leerness'), tool: arg('--tool','leerness-cli') });
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
    if (sub==='progress') return planProgress(root);
    if (sub==='sync')     return planSync(root);
  }
  if (cmd === 'task') {
    const root = absRoot(arg('--path', process.cwd())); const sub = args[1] || 'list';
    if (sub==='list')   return taskList(root);
    if (sub==='add')    return taskAdd(root, args.slice(2).join(' ') || '새 작업');
    if (sub==='update') return taskUpdate(root, args[2]);
    if (sub==='drop')   return taskDrop(root, args[2]);
    if (sub==='fix-evidence') return taskFixEvidence(root);
    if (sub==='relink')       return taskRelink(root);
  }
  return help();
}

// 1.9.4 B: main 종료 후 exitCode를 명시적으로 process.exit으로 강제 (셸/wrapper 차 무시).
main()
  .then(() => { if (process.exitCode && process.exitCode !== 0) process.exit(process.exitCode); })
  .catch(err => { fail(err && err.message ? err.message : String(err)); process.exit(1); });
