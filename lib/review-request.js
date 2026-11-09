 
 
 
'use strict';
const cp = require('child_process');
const path = require('path');
const { absRoot, exists, read, log, fail, failJson } = require('./io');
const { requestSignal: _crudRequestSignal } = require('./crud-check');
const { _featureGraphNodeRanges } = require('./pure-utils');
 
 
 
 
const { storeText, storeString } = require('./store-display');

 
 
 
function _reuseCandidateLabel(r, detail) {
  if (r.kind === 'skill') {
    const name = detail ? storeText(r.displayNameKo) : '';
    return `[skill] ${storeText(r.id)}${name ? ' · ' + name : ''}`;
  }
  if (r.kind === 'reuse-map') {
    const where = detail ? storeText(r.where) : '';
    return `[reuse] ${storeText(r.capability)}${where ? ' @ ' + where : ''}`;
  }
  return '';
}

function reviewRequestCmd(root, request, deps = {}) {
  const { has, harnessPath, _checkRequestConstraints, _recordRun, uiLang } = deps;
  root = absRoot(root || process.cwd());
  if (!request || !String(request).trim()) {
     
    return failJson(!!(has && has('--json')), 'review_request_empty', 'leerness review-request "<request>" — 사용자 요청 텍스트 필요');
  }
  const t0 = Date.now();
  const text = String(request).trim();

   
  const lower = text.toLowerCase();
  const routeKw = {
    bugfix:      ['버그', '오류', '에러', '수정', '고쳐', '실패', 'fix', 'bug', 'error'],
    refactor:    ['리팩토', '재구성', '정리', '개선', 'refactor', 'cleanup'],
    feature:     ['추가', '구현', '만들', '새', '기능', 'add', 'implement', 'feature', 'create', 'new'],
    research:    ['조사', '분석', '비교', '검토', '연구', 'research', 'analyze', 'compare', 'investigate'],
    planning:    ['계획', '설계', '로드맵', 'plan', 'design', 'architecture', 'roadmap'],
    release:     ['배포', '릴리즈', '버전', 'release', 'deploy', 'publish'],
    consistency: ['일관성', '통합', '동기화', '맞춰', 'consistency', 'sync', 'align']
  };
  let estimatedType = 'feature';   
  let maxScore = 0;
  for (const [type, kws] of Object.entries(routeKw)) {
    const score = kws.filter(k => lower.includes(k)).length;
    if (score > maxScore) { maxScore = score; estimatedType = type; }
  }

   
  const conflictHints = [];   
  const reuseCandidates = [];  
  const lessonsRecall = [];    
  const planConflicts = [];    

   
   
   
  try {
    const r = cp.spawnSync(process.execPath, [harnessPath, 'brainstorm', text, '--path', root, '--json'], {
      encoding: 'utf8', timeout: 12000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '1' }
    });
    if (r.stdout) {
      const j = JSON.parse(r.stdout);
      const hits = j.hits || {};
       
      (hits.decisions || []).slice(0, 5).forEach(d => {
        lessonsRecall.push({ kind: 'decision', title: d.title, line: d.line, preview: (d.preview || '').slice(0, 100) });
      });
       
       
       
       
      (hits.lessons || []).slice(0, 5).forEach(l => {
        lessonsRecall.push({ kind: 'lesson', title: storeString(l.title), line: l.line });
      });
       
      (hits.skills || []).slice(0, 3).forEach(s => {
        reuseCandidates.push({ kind: 'skill', id: s.id, displayNameKo: s.displayNameKo, capabilities: s.capabilities });
      });
       
       
      (hits.tasks || []).slice(0, 3).forEach(tsk => {
        if (tsk.status && /in-progress|진행/.test(String(tsk.status))) {
          conflictHints.push({ kind: 'task-in-progress', id: tsk.id, title: storeString(tsk.request).slice(0, 100) });
        }
      });
       
       
       
      (hits.planMilestones || []).filter(m => m.status && /in-progress|진행/.test(String(m.status))).slice(0, 3).forEach(m => {
        planConflicts.push({ kind: 'milestone-in-progress', id: m.id, title: m.title });
      });
       
      (hits.taskLogFails || []).slice(0, 3).forEach(f => {
        conflictHints.push({ kind: 'task-log-failure', preview: storeString(f.title).slice(0, 100), line: f.line });
      });
    }
  } catch {}

   
  try {
    const reusePath = path.join(root, '.leerness/reuse-map.md');
    if (exists(reusePath)) {
      const reuseLines = read(reusePath).split('\n');
      const tokens = lower.split(/\s+/).filter(t => t.length >= 3);
       
       
       
       
       
       
      const _delimiterLine = l => typeof l === 'string' && l.includes('|') && l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').every(c => /^\s*:?-+:?\s*$/.test(c));
      const _blockStart = l => /^ {0,3}(?:#{1,6}(?:\s|$)|>|```|~~~|[-*+]\s|\d{1,9}[.)]\s|([-*_])(?:\s*\1){2,}\s*$)/.test(l);
      const structural = new Set();
      for (let i = 0, inTable = false; i < reuseLines.length; i++) {
        const l = reuseLines[i];
        if (inTable && l.trim() && !_blockStart(l)) continue;   
        inTable = false;
        if (l.includes('|') && !_blockStart(l) && _delimiterLine(reuseLines[i + 1])) { structural.add(i).add(i + 1); inTable = true; i++; }
      }
      for (let i = 0; i < reuseLines.length; i++) {
        const line = reuseLines[i];
        if (!/^\| /.test(line) || structural.has(i)) continue;   
        const ll = line.toLowerCase();
        const matched = tokens.filter(t => ll.includes(t)).length;
        if (matched > 0) {
          const cols = line.split('|').map(s => s.trim());
          if (cols[1]) {
            reuseCandidates.push({ kind: 'reuse-map', capability: cols[1], where: cols[2] || '', note: cols[3] || '' });
          }
        }
      }
    }
  } catch {}

   
   
   
   
   
  const featureConflicts = [];
  try {
    const fgPath = path.join(root, '.leerness/feature-graph.md');
    if (exists(fgPath)) {
      const fg = read(fgPath).replace(/[^\S\r\n]+/g, ' ');
      const tokens = lower.split(/\s+/).filter(t => t.length >= 4);
      for (const node of _featureGraphNodeRanges(fg)) {
        const bl = fg.slice(node.start, node.end).toLowerCase();
        if (tokens.some(t => bl.includes(t))) featureConflicts.push({ kind: 'feature', id: node.id, title: node.title });
      }
    }
  } catch {}

   
  const recommendedSteps = {
    feature: [
      '1) leerness reuse-check "<기능>" — 외부 OSS 빌드 vs 재사용 판단 (1.9.285)',
      '2) leerness reuse find "<핵심 capability>" — 내부 중복 구현 사전 차단',
      '3) leerness plan add "<milestone>" — 진행 추적',
      '4) leerness contract verify SPEC.md src/<mod>.js — 사양 ↔ 구현 일치 검증',
      '5) verify-claim --run-tests 로 evidence 의무화'
    ],
    bugfix: [
      '1) leerness brainstorm "<버그 키워드>" — 과거 같은 영역 lesson 회수',
      '2) leerness verify-claim T-XXX --strict-claims — 낙관적 표시 사전 감지',
      '3) verify-code --run-tests — 재현 + fix 검증',
      '4) leerness lesson save "<root cause>" — 같은 실수 재발 차단'
    ],
    refactor: [
      '1) leerness reuse-map — 영향 범위 파악',
      '2) leerness impact <file> — 강한/약한 참조 분리',
      '3) leerness contract verify — 외부 인터페이스 보존 확인',
      '4) verify-code --run-tests + 회귀 테스트'
    ],
    research: [
      '1) leerness brainstorm "<주제>" — 누적 컨텍스트 회수',
      '2) leerness lessons --query "<주제>" — 과거 같은 영역 결정',
      '3) leerness review <file> --persona research — 깊이 검토',
      '4) leerness decision add "<결론>" — 회수 가능하게 영구화'
    ],
    planning: [
      '1) leerness plan add "<milestone>" — 분해 시작',
      '2) leerness reuse-map — 기존 자원 인벤토리',
      '3) leerness agents recommend planning — sub-agent 분배',
      '4) leerness session close — 결정 영구화'
    ],
    release: [
      '1) leerness health — production-ready 확인',
      '2) leerness audit + verify-code — 보안 + 검수',
      '3) leerness release bump + note + publish'
    ],
    consistency: [
      '1) leerness audit — design/reuse/handoff 일관성 검사',
      '2) leerness consistency check — 잠재 일관성 위반',
      '3) leerness drift check --auto-fix — 자동 회복'
    ]
  }[estimatedType] || [];

   
  const efficiencyHints = [];
  if (reuseCandidates.length > 0) {
    efficiencyHints.push(`🔁 기존 자원 ${reuseCandidates.length}건 발견 — 신규 구현 전 재사용 검토 권장`);
  }
  if (conflictHints.length > 0) {
    efficiencyHints.push(`⚠ 충돌 신호 ${conflictHints.length}건 — 과거 task-log 실패 / 진행 중 task 확인 필요`);
  }
  if (planConflicts.length > 0) {
    efficiencyHints.push(`📋 진행 중 milestone ${planConflicts.length}건과 영역 겹침 가능 — plan 정렬 권장`);
  }
  if (featureConflicts.length > 0) {
    efficiencyHints.push(`🕸 Feature Graph ${featureConflicts.length}건 영역 겹침 — 의존성 사전 확인`);
  }
   
  if (estimatedType === 'feature' || estimatedType === 'planning') {
    efficiencyHints.push(`👥 leerness agents recommend ${estimatedType} — 작업 유형별 sub-agent 매핑 활용 가능`);
  }
  if (efficiencyHints.length === 0) {
    efficiencyHints.push('✨ 충돌 신호 없음 — 즉시 진행 안전');
  }

   
  let constraintsCheck = { matched: [], suggestions: [] };
  try {
    constraintsCheck = _checkRequestConstraints(root, text);
    if (constraintsCheck.matched.length > 0) {
      efficiencyHints.push(`⚠ 플랫폼 제약 ${constraintsCheck.matched.length}건 — leerness constraints check 로 상세 확인`);
    }
  } catch {}

   
  const broadHits = [...new Set((text.match(/(전체|싹\s*다|모두|전부|모든\s*(?:코드|파일|것)|리팩토링|리팩터|재구성|재작성|갈아\s*엎|overhaul|rewrite\s+everything|refactor\s+everything)/gi) || []).map(s => s.trim()))];
  const specHits = [...new Set((text.match(/(나중에|추후|미래\s*대비|확장\s*가능|유연하게|범용화|일반화|추상화|future[-\s]?proof|extensible|pluggable|일단\s*만들)/gi) || []).map(s => s.trim()))];
  const simplicitySignals = { broad: broadHits, speculative: specHits };
  if (broadHits.length) efficiencyHints.push(`🤔 범위 과대 신호(${broadHits.slice(0, 3).join(', ')}) — 더 작게 쪼갤 수 있나? 요청에 명시된 것만 (Karpathy 단순성)`);
  if (specHits.length) efficiencyHints.push(`🧪 투기적 신호(${specHits.slice(0, 3).join(', ')}) — 지금 필요한 범위만, 추측성 일반화 보류 (Karpathy 단순성)`);

   
   
   
   
   
   
  let ladder = null;
  if (has && has('--ladder')) {
    const _rung = (id, question, status, evidence) => ({ id, question, status, evidence: evidence || '' });
    ladder = {
       
       
      note: 'advisory — 근거 없는 칸은 unknown 입니다. 순서는 비용 순서일 뿐 정답 순서가 아닙니다(보안/접근성은 더 비싼 단이 옳을 수 있음). 사다리 내용은 저장되지 않습니다(명령 실행 기록은 다른 명령과 동일하게 남습니다).',
      rungs: [
        _rung('needed', '이 기능이 정말 필요한가? (요청 자체를 줄이거나 없앨 수 있나)', 'unknown', '요청 텍스트만으로는 판정 불가 — 사용자에게 확인'),
        _rung('in-codebase', '이미 이 코드베이스에 있나?', reuseCandidates.length ? 'candidate' : 'unknown',
          reuseCandidates.length ? `reuse 후보 ${reuseCandidates.length}건(토큰 매칭 — 확정 아님): ${reuseCandidates.slice(0, 3).map(r => _reuseCandidateLabel(r)).filter(Boolean).join(', ')}` : 'reuse-map 매칭 없음 — 부재 증명은 아님 (leerness reuse find "<capability>")'),
        _rung('stdlib', '표준 라이브러리가 이미 하나?', 'unknown', '런타임/버전/배포 타깃 의존 — 사람이 확인'),
        _rung('native', '플랫폼 네이티브 기능이 있나? (예: <input type="date">)', 'unknown', '타깃 플랫폼·브라우저 지원 범위 확인 필요'),
        _rung('installed', '이미 설치된 의존성으로 되나?', 'unknown', '설치됨 ≠ 적합 — 보안/유지보수/스코프 확인 (leerness reuse-check)'),
        _rung('compose', '기존 것 조합/짧은 코드로 되나?', 'unknown', '"한 줄"은 목표가 아니라 질문 — 검증·에러처리를 숨기지 말 것'),
        _rung('minimum', '위가 모두 아니면: 동작하는 최소 구현은?', 'unknown', '여기까지 왔다면 범위를 명시적으로 적어두세요'),
      ],
      preserved: ['입력 검증(신뢰 경계)', '보안·비밀 취급', '접근성', '에러 처리·관측', '데이터 손실 방지'],
      preservedNote: '위 항목은 "줄이기" 대상이 아니다 — 더 비싼 단을 택해야 할 근거가 된다.',
    };
  }

   
   
  const lang = typeof uiLang === 'function' ? uiLang(root) : 'ko';
  const tr = (ko, en) => (lang === 'en' ? en : ko);
  const crudSignal = _crudRequestSignal(text);
  const crudCheck = crudSignal.signal
    ? { signal: true, matched: crudSignal.matched, operations: ['create', 'read', 'update', 'delete'], lens: 'leerness lens crud' }
    : { signal: false };

   
   
   
  const proceed = conflictHints.length < 3;

  const dt = Date.now() - t0;
  const out = {
    request: text,
    estimatedType,
    conflicts: conflictHints,
    reuseCandidates,
    lessonsRecall,
    planConflicts,
    featureConflicts,
    recommendedSteps,
    efficiencyHints,
    simplicitySignals,
    platformConstraints: constraintsCheck.matched,
    constraintSuggestions: constraintsCheck.suggestions,
    proceed,
    proceedReason: proceed ? '안전 — 충돌 신호 < 3' : '⚠ 충돌 critical — 사용자 확인 후 진행',
    crudCheck,
    ...(ladder ? { ladder } : {}),
    durationMs: dt
  };

  try { _recordRun(root, { kind: 'review_request', estimatedType, conflicts: conflictHints.length, reuse: reuseCandidates.length, durationMs: dt, ok: true }); } catch {}

  if (has('--json')) {
    log(JSON.stringify(out, null, 2));
    return;
  }

  log(`# leerness review-request (1.9.176 사전 검토)`);
  log(`요청: "${text.slice(0, 200)}${text.length > 200 ? '…' : ''}"`);
  log(`추정 작업 유형: ${estimatedType}`);
  log('');
  if (conflictHints.length) {
    log(`## ⚠ 충돌 신호 (${conflictHints.length})`);
     
    conflictHints.slice(0, 5).forEach(c => log(`  - [${c.kind}] ${[c.id, c.title, c.preview].map(storeText).filter(Boolean).join(' ')}`.trimEnd()));
    log('');
  }
  if (reuseCandidates.length) {
    log(`## 🔁 재사용 후보 (${reuseCandidates.length}) — 신규 구현 전 검토`);
    reuseCandidates.slice(0, 5).forEach(r => {
      const label = _reuseCandidateLabel(r, true);
      if (label) log(`  - ${label}`);
    });
    log('');
  }
  if (lessonsRecall.length) {
    log(`## 🧠 과거 컨텍스트 (${lessonsRecall.length}) — 관련 결정/교훈`);
     
    lessonsRecall.slice(0, 3).forEach(l => log(`  - [${l.kind}] ${storeText(l.title) || storeText(l.preview)}`.trimEnd()));
    log('');
  }
  if (planConflicts.length || featureConflicts.length) {
    log(`## 📋 진행 중 영역 (${planConflicts.length + featureConflicts.length})`);
    planConflicts.forEach(m => log(`  - [milestone] ${storeText(m.id)}: ${storeText(m.title)}`.trimEnd()));
    featureConflicts.slice(0, 5).forEach(f => log(`  - [feature] ${storeText(f.id)}: ${storeText(f.title)}`.trimEnd()));
    log('');
  }
  log(`## 💡 효율 제안`);
  efficiencyHints.forEach(h => log(`  ${h}`));
  log('');
   
  if (constraintsCheck.matched.length > 0) {
    log(`## 🚦 플랫폼/API 제약 사전 체크 (${constraintsCheck.matched.length})`);
    for (const m of constraintsCheck.matched) {
      log(`  - 📦 ${storeText(m.platform)}  (docs: ${storeText(m.docs) || '-'})`);
      for (const c of (m.constraints || []).slice(0, 3)) {
        const kind = storeText(c.kind);
        log(`     • ${kind ? `[${kind}] ` : ''}${storeText(c.detail)}`.trimEnd());
      }
    }
    log(`  → leerness constraints check "${text.slice(0, 40)}…" 로 상세 확인`);
    log('');
  }
  if (recommendedSteps.length) {
    log(`## 📍 권장 단계 (${estimatedType})`);
    recommendedSteps.forEach(s => log(`  ${s}`));
    log('');
  }
   
  if (crudCheck.signal) {
    log(tr('## 데이터 기능 CRUD 점검 (advisory)', '## Data feature CRUD check (advisory)'));
    log(tr(`  저장·관리되는 데이터를 다루는 요청으로 보입니다 (신호: ${crudCheck.matched.join(', ')}).`, `  This request looks like it works with stored data (signals: ${crudCheck.matched.join(', ')}).`));
    log(tr('  구현 전에 엔티티마다 필요한 조작을 정하고, 뺀 조작은 이유를 적으세요.', '  Before implementing, decide which operations each entity needs, and give the reason for any you leave out.'));
    log(tr('  | 엔티티 | 생성 | 조회(목록/상세) | 수정 | 삭제 | 뺀 조작과 이유 |', '  | Entity | Create | Read (list/detail) | Update | Delete | Left out, and why |'));
    log('  |---|---|---|---|---|---|');
    log(tr('  필요한 조작은 저장소→API→화면→권한·검증→테스트까지 구현합니다.', '  Implement each needed operation end to end: storage, API, UI, permissions and validation, tests.'));
    log(tr('  → 점검 질문: leerness lens crud', '  → Checklist: leerness lens crud'));
    log('');
  }
   
  if (ladder) {
    log(`## 🪜 최소성 결정 사다리 (--ladder · 자문)`);
    for (const r of ladder.rungs) {
      const mark = r.status === 'confirmed' ? '✅' : (r.status === 'candidate' ? '🔎' : (r.status === 'not-applicable' ? '➖' : '❔'));
      log(`  ${mark} [${r.status}] ${r.question}`);
      if (r.evidence) log(`        ${r.evidence}`);
    }
    log(`  🔒 줄이면 안 되는 것: ${ladder.preserved.join(' · ')}`);
    log(`     ${ladder.preservedNote}`);
    log(`  ⓘ ${ladder.note}`);
    log('');
  }
  log(`## ▶ 진행 권장: ${proceed ? '✓ 진행 안전' : '⚠ 사용자 확인 필요'}`);
  log(`   사유: ${out.proceedReason}`);
  log(`   분석 소요: ${dt}ms`);
}

module.exports = { reviewRequestCmd };
