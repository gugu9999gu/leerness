// lib/review-request.js — review-request 핸들러 (UR-0125 큰 핸들러 모듈화, 1.9.420)
//   bin/leerness.js 에서 reviewRequestCmd(277줄) 분리. DI: harness 고유 의존(has · harnessPath · _checkRequestConstraints · _recordRun) 주입.
//   io 프리미티브는 ./io, cp/path 는 빌트인. 동작/출력 무변경(thin wrapper 위임).
'use strict';
const cp = require('child_process');
const path = require('path');
const { absRoot, exists, read, log, fail, failJson } = require('./io');

function reviewRequestCmd(root, request, deps = {}) {
  const { has, harnessPath, _checkRequestConstraints, _recordRun } = deps;
  root = absRoot(root || process.cwd());
  if (!request || !String(request).trim()) {
    // 1.9.428 (10th 외부평가 UR-0128): --json 오류 경로도 순수 JSON (failJson 이 모드 분기)
    return failJson(!!(has && has('--json')), 'review_request_empty', 'leerness review-request "<request>" — 사용자 요청 텍스트 필요');
  }
  const t0 = Date.now();
  const text = String(request).trim();

  // 1) 작업 유형 추정 (route 기반 키워드 매핑)
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
  let estimatedType = 'feature';  // default
  let maxScore = 0;
  for (const [type, kws] of Object.entries(routeKw)) {
    const score = kws.filter(k => lower.includes(k)).length;
    if (score > maxScore) { maxScore = score; estimatedType = type; }
  }

  // 2) 기존 자원 회수 — brainstorm spawn (모든 surface 통합 회수)
  const conflictHints = [];  // ⚠ 같은 키워드 + 실패/오류 패턴
  const reuseCandidates = []; // 🔁 기존 skill / reuse-map / decision 후보
  const lessonsRecall = [];   // 🧠 과거 lesson
  const planConflicts = [];   // 📋 진행 중 milestone과 충돌 가능

  // brainstorm 호출 (1.9.13~) — JSON 결과 회수
  try {
    const r = cp.spawnSync(process.execPath, [harnessPath, 'brainstorm', text, '--path', root, '--json'], {
      encoding: 'utf8', timeout: 12000,
      env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '1' }
    });
    if (r.stdout) {
      const j = JSON.parse(r.stdout);
      const hits = j.hits || {};
      // decisions — 과거 결정 후보
      (hits.decisions || []).slice(0, 5).forEach(d => {
        lessonsRecall.push({ kind: 'decision', title: d.title, line: d.line, preview: (d.preview || '').slice(0, 100) });
      });
      // lessons — 과거 교훈 (특히 실패 키워드)
      (hits.lessons || []).slice(0, 5).forEach(l => {
        const preview = (l.text || l.preview || '').slice(0, 100);
        const isFailure = /실패|오류|에러|fail|error|bug|문제|warning/i.test(preview);
        if (isFailure) {
          conflictHints.push({ kind: 'lesson-failure', preview, tags: l.tags });
        } else {
          lessonsRecall.push({ kind: 'lesson', preview, tags: l.tags });
        }
      });
      // skills — 기존 skill 후보
      (hits.skills || []).slice(0, 3).forEach(s => {
        reuseCandidates.push({ kind: 'skill', id: s.id, displayNameKo: s.displayNameKo, capabilities: s.capabilities });
      });
      // tasks — 진행 중 task 충돌
      (hits.tasks || []).slice(0, 3).forEach(tsk => {
        if (tsk.status && /in-progress|진행/.test(String(tsk.status))) {
          conflictHints.push({ kind: 'task-in-progress', id: tsk.id, title: tsk.title });
        }
      });
      // plan milestones — 진행 중 milestone
      (hits.planMilestones || []).slice(0, 3).forEach(m => {
        if (m.status && /in-progress|진행/.test(String(m.status))) {
          planConflicts.push({ kind: 'milestone-in-progress', id: m.id, title: m.title });
        }
      });
      // taskLogFails — 과거 같은 키워드 실패 흔적
      (hits.taskLogFails || []).slice(0, 3).forEach(f => {
        conflictHints.push({ kind: 'task-log-failure', preview: (f.preview || f.text || '').slice(0, 100) });
      });
    }
  } catch {}

  // 3) reuse-map 매칭 — 기존 capability 등록 후보
  try {
    const reusePath = path.join(root, '.harness/reuse-map.md');
    if (exists(reusePath)) {
      const reuseLines = read(reusePath).split('\n');
      const tokens = lower.split(/\s+/).filter(t => t.length >= 3);
      for (const line of reuseLines) {
        if (!/^\| /.test(line)) continue;  // 테이블 row만
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

  // 4) feature_graph — 같은 영역 변경 가능성
  const featureConflicts = [];
  try {
    const fgPath = path.join(root, '.harness/feature_graph.md');
    if (exists(fgPath)) {
      const fg = read(fgPath);
      const tokens = lower.split(/\s+/).filter(t => t.length >= 4);
      // F-XXXX 노드 라인 추출
      const nodeBlocks = fg.split(/\n### /);
      for (const blk of nodeBlocks.slice(1)) {
        const bl = blk.toLowerCase();
        const matched = tokens.filter(t => bl.includes(t)).length;
        if (matched > 0) {
          const titleMatch = blk.match(/^([^\n]+)/);
          const idMatch = blk.match(/F-\d+/);
          if (titleMatch && idMatch) {
            featureConflicts.push({ kind: 'feature', id: idMatch[0], title: titleMatch[1].trim() });
          }
        }
      }
    }
  } catch {}

  // 5) 권장 단계 (작업 유형별)
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

  // 6) 효율 제안 (적용 가능한 sub-agent + skill)
  const efficiencyHints = [];
  if (reuseCandidates.length > 0) {
    efficiencyHints.push(`🔁 기존 자원 ${reuseCandidates.length}건 발견 — 신규 구현 전 재사용 검토 권장`);
  }
  if (conflictHints.length > 0) {
    efficiencyHints.push(`⚠ 충돌 신호 ${conflictHints.length}건 — 과거 실패 lesson / 진행 중 task 확인 필요`);
  }
  if (planConflicts.length > 0) {
    efficiencyHints.push(`📋 진행 중 milestone ${planConflicts.length}건과 영역 겹침 가능 — plan 정렬 권장`);
  }
  if (featureConflicts.length > 0) {
    efficiencyHints.push(`🕸 Feature Graph ${featureConflicts.length}건 영역 겹침 — 의존성 사전 확인`);
  }
  // 다중 에이전트 분배 추천
  if (estimatedType === 'feature' || estimatedType === 'planning') {
    efficiencyHints.push(`👥 leerness agents recommend ${estimatedType} — 작업 유형별 sub-agent 매핑 활용 가능`);
  }
  if (efficiencyHints.length === 0) {
    efficiencyHints.push('✨ 충돌 신호 없음 — 즉시 진행 안전');
  }

  // 6.5) 1.9.208: 플랫폼/API 제약 사전 체크 — 사용자 명시 ("호출속도 초당 5회" 같은 규정 사전 확인)
  let constraintsCheck = { matched: [], suggestions: [] };
  try {
    constraintsCheck = _checkRequestConstraints(root, text);
    if (constraintsCheck.matched.length > 0) {
      efficiencyHints.push(`⚠ 플랫폼 제약 ${constraintsCheck.matched.length}건 — leerness constraints check 로 상세 확인`);
    }
  } catch {}

  // 7) proceed 권장 (충돌 critical 시 false)
  const proceed = conflictHints.length < 3 && planConflicts.length === 0;

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
    platformConstraints: constraintsCheck.matched,
    constraintSuggestions: constraintsCheck.suggestions,
    proceed,
    proceedReason: proceed ? '안전 — 충돌 신호 < 3 + plan 충돌 0' : '⚠ 충돌 critical — 사용자 확인 후 진행',
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
    conflictHints.slice(0, 5).forEach(c => log(`  - [${c.kind}] ${c.title || c.id || ''} ${c.preview || ''}`.trim()));
    log('');
  }
  if (reuseCandidates.length) {
    log(`## 🔁 재사용 후보 (${reuseCandidates.length}) — 신규 구현 전 검토`);
    reuseCandidates.slice(0, 5).forEach(r => {
      if (r.kind === 'skill') log(`  - [skill] ${r.id}${r.displayNameKo ? ' · ' + r.displayNameKo : ''}`);
      else if (r.kind === 'reuse-map') log(`  - [reuse] ${r.capability} @ ${r.where}`);
    });
    log('');
  }
  if (lessonsRecall.length) {
    log(`## 🧠 과거 컨텍스트 (${lessonsRecall.length}) — 관련 결정/교훈`);
    lessonsRecall.slice(0, 3).forEach(l => log(`  - [${l.kind}] ${l.title || l.preview}`));
    log('');
  }
  if (planConflicts.length || featureConflicts.length) {
    log(`## 📋 진행 중 영역 (${planConflicts.length + featureConflicts.length})`);
    planConflicts.forEach(m => log(`  - [milestone] ${m.id}: ${m.title}`));
    featureConflicts.slice(0, 5).forEach(f => log(`  - [feature] ${f.id}: ${f.title}`));
    log('');
  }
  log(`## 💡 효율 제안`);
  efficiencyHints.forEach(h => log(`  ${h}`));
  log('');
  // 1.9.208: 플랫폼/API 제약 사전 노출 (사용자 명시)
  if (constraintsCheck.matched.length > 0) {
    log(`## 🚦 플랫폼/API 제약 사전 체크 (${constraintsCheck.matched.length})`);
    for (const m of constraintsCheck.matched) {
      log(`  - 📦 ${m.platform}  (docs: ${m.docs || '-'})`);
      for (const c of (m.constraints || []).slice(0, 3)) {
        log(`     • [${c.kind}] ${c.detail}`);
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
  log(`## ▶ 진행 권장: ${proceed ? '✓ 진행 안전' : '⚠ 사용자 확인 필요'}`);
  log(`   사유: ${out.proceedReason}`);
  log(`   분석 소요: ${dt}ms`);
}

module.exports = { reviewRequestCmd };
