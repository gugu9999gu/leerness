 
//
 
//
 
 
 
 
 
 
 
 
//
 
 
'use strict';
const path = require('path');
const { absRoot, exists, read, writeUtf8, mkdirp, log, ok, warn, failJson, now } = require('./io');
const { stripDefaultIgnorables } = require('./pure-utils');
const { assessReviewerIndependence, normalizeApprover } = require('./role-fallback');
const roleStore = require('./role-store');

const TIERS = ['tiny', 'normal', 'high-risk'];

 
 
 
 
 
 
 
const HIGH_RISK = [
  { id: 'auth', ko: '인증·인가', re: /\b(auth|authn|authz|authentic\w*|authoriz\w*|authoris\w*|login|log in|logout|sign in|session\w*|token(?!iz)\w*|jwt|oauth|sso|permission\w*|privilege\w*|rbac|acl)\b|인증|인가|로그인|세션|토큰|권한/i },
  { id: 'payment', ko: '결제·정산', re: /\b(payment\w*|billing|checkout|invoice\w*|refund\w*|subscription\w*|stripe|paypal)\b|결제|정산|환불|청구|구독/i },
  { id: 'data-migration', ko: '데이터 마이그레이션·스키마', re: /\b(migrat\w*|schema\w*|alter table|drop table|backfill\w*)\b|마이그레이션|스키마|백필/i },
  { id: 'pii', ko: '개인정보', re: /\b(pii|gdpr|personal data|ssn|passport)\b|개인정보|주민등록|여권/i },
  { id: 'secrets', ko: '시크릿·키', re: /\b(secret\w*|credential\w*|api key|private key|password\w*)\b|시크릿|비밀번호|자격증명|비밀키/i },
  { id: 'public-api', ko: '공개 API 계약', re: /\b(public api|breaking change\w*|api contract|versioning)\b|공개 api|하위호환|호환성 깨/i },
  { id: 'concurrency', ko: '동시성·트랜잭션', re: /\b(concurren\w*|transaction\w*|race condition\w*|deadlock\w*|idempoten\w*|mutex|semaphore)\b|동시성|트랜잭션|경쟁 상태|교착|멱등/i },
  { id: 'infra', ko: '인프라·배포', re: /\b(deploy\w*|infra\w*|terraform|kubernetes|k8s|dockerfile|ci\/cd|pipeline\w*)\b|배포|인프라|파이프라인/i },
  { id: 'destructive', ko: '파괴적 작업', re: /\b(delete all|truncate\w*|rm -rf|purge\w*|wipe\w*)\b|전체 삭제|일괄 삭제|초기화/i },
];

 
const TINY = [
  { id: 'typo', ko: '오타·문구', re: /\b(typo\w*|wording|copy fix)\b|오타|문구 수정|띄어쓰기/i },
  { id: 'rename', ko: '이름 변경', re: /\b(rename|변수명|함수명)\b|이름 변경|네이밍/i },
  { id: 'style', ko: '포맷·린트·CSS', re: /\b(lint\w*|format\w*|prettier|eslint|css|padding|margin|색상)\b|포맷|린트|여백|스타일/i },
  { id: 'comment', ko: '주석·문서 문구', re: /\b(comment\w*|docstring\w*)\b|주석/i },
  { id: 'single-test', ko: '테스트 1건', re: /\b(add a test|one test|테스트 한|테스트 1)\b/i },
];

 
 
 
const BROAD = /\b(entire|whole|all |everything|rewrite|overhaul|refactor all|across the|end.to.end)\b|전체|전면|모든|갈아엎|재작성|통째/i;
const TINY_MAX_LEN = 80;

 
 
 
function _norm(s) {
  const raw = String(s == null ? '' : s).trim();
   
   
   
  return stripDefaultIgnorables(raw, { nfkc: true, visibleIdentity: true });
}

 
 
const _SCRIPTS = [
  ['일본어', /[぀-ヿ]/],
  ['중국어(한자)', /[一-鿿]/],
  ['키릴', /[Ѐ-ӿ]/],
  ['아랍어', /[؀-ۿ]/],
  ['히브리어', /[֐-׿]/],
  ['태국어', /[฀-๿]/],
  ['데바나가리', /[ऀ-ॿ]/],
  ['그리스', /[\u0370-\u03ff]/],
   
   
   
   
  ['비영어 라틴(악센트)', /[\u00c0-\u024f]/],
];
function _hasUncoveredScript(t) {
  const hit = _SCRIPTS.find(([, re]) => re.test(t));
  return hit ? hit[0] : null;
}

 
 
 
 
const _AVAIL_NOTE = '인증 확인은 **--confirm 으로 고위험 구성을 확정할 때만** 실행합니다(제안 단계에서는 외부 CLI 를 띄우지 않습니다). 확인하더라도 무료·비대화형 확인 명령이 등록된 provider 만 판정되며, 모델 사용권한·쿼터·과금 권한은 어느 provider 도 확인하지 않습니다(상세: leerness agents check).';
const _CLASS_NOTE = '난이도는 텍스트 규칙 매칭 결과이며 측정값이 아닙니다.';
 
 
 
 
const _EXEC_NOTE = 'leerness 는 여기서 작업을 대신 수행하지 않습니다 — 계획을 확정하고 기록할 뿐이며, 모델 호출(과금)은 하지 않습니다. (고위험 구성을 --confirm 으로 확정할 때만, 인증 확인을 위해 해당 CLI 의 버전 확인과 로그인 상태 명령을 실행합니다.)';

 
function classify(text, opts = {}) {
  const t = _norm(text);
  const declared = _norm(opts.tier).toLowerCase();
  const high = HIGH_RISK.filter(r => r.re.test(t));
  const tiny = TINY.filter(r => r.re.test(t));
  const signals = [
    ...high.map(r => ({ kind: 'high-risk', id: r.id, ko: r.ko })),
    ...tiny.map(r => ({ kind: 'tiny', id: r.id, ko: r.ko })),
  ];
  const reasons = [];

   
   
  if (!t) return { ok: false, code: 'empty_task', error: '작업 설명이 비어 있습니다 — leerness agents route "<작업 설명>"' };

  if (declared) {
    if (!TIERS.includes(declared)) return { ok: false, code: 'invalid_tier', error: `--tier 는 ${TIERS.join('|')} (받음: ${declared})` };
    reasons.push(`사용자가 --tier ${declared} 로 명시 — 규칙 판정보다 우선합니다`);
    if (declared !== 'high-risk' && high.length) {
      reasons.push(`⚠ 고위험 신호(${high.map(r => r.ko).join(', ')})가 있는데 ${declared} 로 지정됐습니다 — 의도한 것인지 확인하세요`);
    }
    return { ok: true, tier: declared, confidence: 'declared', signals, reasons, conflict: declared !== 'high-risk' && high.length > 0 };
  }

  if (high.length) {
     
    const conflict = tiny.length > 0;
    reasons.push(`고위험 도메인 규칙 매칭: ${high.map(r => r.ko).join(', ')}`);
    if (conflict) reasons.push(`동시에 초소형 신호(${tiny.map(r => r.ko).join(', ')})도 있습니다 — 규칙으로는 가릴 수 없어 보수적으로 high-risk 로 둡니다. 사소한 작업이면 --tier tiny 로 낮추세요`);
    return { ok: true, tier: 'high-risk', confidence: conflict ? 'low' : 'high', signals, reasons, conflict };
  }

   
  if (!tiny.length) {
    const weak = t.length < 12;
    reasons.push(weak
      ? '매칭된 규칙이 없고 설명이 짧습니다 — 판정 근거가 부족해 기본값 normal 로 둡니다'
      : '매칭된 고위험/초소형 규칙 없음 — 기본값 normal');
    return { ok: true, tier: 'normal', confidence: weak ? 'low' : 'medium', signals, reasons, conflict: false };
  }

   
  const broad = BROAD.test(t);
  const longText = t.length > TINY_MAX_LEN;
   
   
   
   
  const uncovered = _hasUncoveredScript(t);
  if (uncovered) {
    reasons.push(`고위험 규칙이 다루지 않는 문자 체계(${uncovered})가 섞여 있습니다 — 규칙이 읽지 못하는 언어에서는 "범위가 좁다"고 단정할 수 없어 normal 로 둡니다. 실제로 사소하면 --tier tiny 로 지정하세요`);
    return { ok: true, tier: 'normal', confidence: 'low', signals, reasons, conflict: true };
  }
  if (broad || longText) {
    reasons.push(`초소형 신호(${tiny.map(r => r.ko).join(', ')})가 있지만 ${broad ? '광범위 신호가 함께 있어' : `설명이 ${t.length}자로 길어(기준 ${TINY_MAX_LEN}자)`} 좁은 범위로 볼 수 없습니다 — normal 로 둡니다`);
    return { ok: true, tier: 'normal', confidence: 'low', signals, reasons, conflict: true };
  }
  reasons.push(`초소형 신호 매칭: ${tiny.map(r => r.ko).join(', ')} · 고위험/광범위 신호 없음`);
  return { ok: true, tier: 'tiny', confidence: 'medium', signals, reasons, conflict: false };
}

function applyDeclaredRiskFloor(classification, opts = {}) {
  const cls = classification && typeof classification === 'object' ? classification : {};
  const detectedHighRisk = Array.isArray(cls.signals) && cls.signals.some(signal => signal && signal.kind === 'high-risk');
  if (!cls.ok || !detectedHighRisk || cls.tier === 'high-risk' || cls.confidence !== 'declared') return cls;
  const approvedBy = normalizeApprover(opts.approvedBy);
  const reason = normalizeApprover(opts.reason);
  const accepted = !!(approvedBy && reason);
  return {
    ...cls,
    tier: accepted ? cls.tier : 'high-risk',
    declaredTier: cls.tier,
    detectedTier: 'high-risk',
    riskDowngrade: {
      requested: true,
      accepted,
      approvedBy: approvedBy || null,
      reason: reason || null,
      requirements: ['visible-approved-by', 'visible-reason'],
    },
    reasons: (cls.reasons || []).concat(accepted
      ? [`고위험 신호를 ${cls.tier}로 낮춘 예외가 승인자와 사유와 함께 명시됐습니다`]
      : [`고위험 신호의 등급 하향은 가시적인 --approved-by와 --reason이 모두 필요하므로 high-risk를 유지합니다`]),
  };
}

 
const TIER_ROLES = {
  tiny: { roles: ['coder'], humanApproval: false, ko: '작업자 1명 + 기존 테스트' },
  normal: { roles: ['commander', 'coder', 'reviewer'], humanApproval: false, ko: '지휘·구현·검수' },
  'high-risk': { roles: ['architect', 'commander', 'coder', 'reviewer'], humanApproval: true, ko: '설계 선행 · 독립 검수 · 사람 승인' },
};

 
function plan(root, cls, deps = {}) {
   
   
  const spec = TIER_ROLES[cls.tier] || TIER_ROLES['high-risk'];
  const resolve = typeof deps._resolveRole === 'function' ? deps._resolveRole : () => null;
   
   
  let roleStoreFailure = null;
  let resolvedBatch = null;
  if (typeof deps._resolveRoles === 'function') {
    try {
      const values = deps._resolveRoles(root, spec.roles.slice());
      if (!Array.isArray(values) || values.length !== spec.roles.length) {
        throw Object.assign(new Error('role snapshot resolver returned an invalid result'), { code: 'role_snapshot_invalid' });
      }
      resolvedBatch = values;
    } catch (error) {
      roleStoreFailure = error instanceof roleStore.RoleStoreError
        ? roleStore.publicError(error.roleStoreState)
        : { code: (error && error.code) || 'role_store_error', error: (error && error.message) || 'agent-roles.json을 읽을 수 없습니다' };
    }
  }
  const assignments = spec.roles.map((role, index) => {
    let r = null;
    try { r = resolvedBatch ? resolvedBatch[index] : (roleStoreFailure ? null : resolve(root, role)); }
    catch (error) {
      if (!roleStoreFailure) {
        roleStoreFailure = error instanceof roleStore.RoleStoreError
          ? roleStore.publicError(error.roleStoreState)
          : { code: (error && error.code) || 'role_store_error', error: (error && error.message) || 'agent-roles.json을 읽을 수 없습니다' };
      }
    }
    const provider = r && typeof r.provider === 'string' ? r.provider.trim() : '';
    return {
      role,
      provider: provider || null,
      model: (r && r.model) || null,
      modelFamily: (r && r.modelFamily) || null,
      storeRevision: (r && r.storeRevision) || null,
      resolved: !!provider,
    };
  });
  const observedRevisions = new Set(assignments.map(a => a.storeRevision).filter(Boolean));
  if (!resolvedBatch && observedRevisions.size > 1) {
    roleStoreFailure = {
      code: 'role_store_revision_mixed',
      error: '역할 해석 중 agent-roles.json revision이 변경되어 혼합 스냅샷 라우팅을 거부합니다',
    };
  }
  const unresolved = assignments.filter(a => !a.resolved).map(a => a.role);
  const coder = assignments.find(a => a.role === 'coder');
  const reviewer = assignments.find(a => a.role === 'reviewer');
   
   
  const reviewerAssessment = roleStoreFailure
    ? { reviewerIndependent: null, status: 'unverified', basis: 'role-store-snapshot-invalid' }
    : !reviewer || !reviewer.resolved || !coder || !coder.resolved
      ? { reviewerIndependent: null, status: 'unverified', basis: 'role-unresolved' }
    : assessReviewerIndependence(reviewer, coder);
  const reviewerIndependent = reviewerAssessment.reviewerIndependent;
   
   
   
   
   
   
   
   
   
  const mayCheck = spec.humanApproval && deps.authAllowed === true && typeof deps._providerAuth === 'function';
  const authOf = mayCheck ? deps._providerAuth : () => 'unknown';
   
   
  const authReason = mayCheck ? 'checked' : 'not-checked-at-this-tier';
  assignments.forEach(a => { a.auth = a.resolved ? authOf(a.provider) : null; a.authReason = a.resolved ? authReason : null; });
  const notAuthed = assignments.filter(a => a.resolved && a.auth === 'no').map(a => `${a.role}:${a.provider}`);

  const blockers = [];
  if (roleStoreFailure) blockers.push(roleStoreFailure);
  else if (unresolved.length) blockers.push({ code: 'role_unresolved', message: `역할 미설정: ${unresolved.join(', ')} — leerness roles set <역할> --provider <id>` });
  if (spec.humanApproval && notAuthed.length) blockers.push({ code: 'provider_not_authenticated', message: `인증되지 않은 provider 로 고위험 작업을 확정할 수 없습니다: ${notAuthed.join(', ')} — 해당 CLI 로 로그인 후 leerness agents check 로 재확인` });
  if (spec.humanApproval && reviewerIndependent === false) blockers.push({ code: 'reviewer_not_independent', message: `검수자와 구현자의 모델 패밀리가 독립적이지 않습니다(${reviewerAssessment.basis}) — 고위험 작업에서는 독립 검수가 필요합니다` });
  if (spec.humanApproval && reviewerIndependent == null && reviewer && coder && reviewer.resolved && coder.resolved) blockers.push({ code: 'reviewer_independence_unverified', message: '검수자/구현자 모델 패밀리 중 하나 이상이 없어 독립성을 확인할 수 없습니다 — roles set에서 --model-family 또는 모델 ID를 명시하세요' });
  return { tier: cls.tier, ko: spec.ko, humanApproval: spec.humanApproval, assignments, unresolved, reviewerIndependent, reviewerIndependence: reviewerAssessment, roleStoreFailure, blockers };
}

function _logPath(root) { return path.join(absRoot(root), '.leerness', 'routing-log.json'); }
const _LOG_CAP = 200;

const _LOG_MAX_BYTES = 4 * 1024 * 1024;    

function _loadLog(root) {
  const f = _logPath(root);
  if (!exists(f)) return { list: [], invalid: false };
  try {
    const sz = require('fs').statSync(f).size;
    if (sz > _LOG_MAX_BYTES) return { list: [], invalid: true, reason: `파일이 너무 큽니다(${Math.round(sz / 1048576)}MB > 4MB)` };
    const j = JSON.parse(read(f));
    if (!Array.isArray(j)) return { list: [], invalid: true, reason: '최상위가 배열이 아닙니다' };
    return { list: j, invalid: false };
  } catch (e) { return { list: [], invalid: true, reason: 'JSON 파싱 실패' }; }
}

 
 
 
function _appendLog(root, rec, deps = {}) {
  const f = _logPath(root);
  const write = () => {
    const cur = _loadLog(root);
    if (cur.invalid) return { written: false, invalid: true, reason: cur.reason || '형상 무효' };
    const list = cur.list.concat([rec]).slice(-_LOG_CAP);
    mkdirp(path.dirname(f));
    const tmp = f + '.tmp' + process.pid;
    writeUtf8(tmp, JSON.stringify(list, null, 2) + '\n');
    require('fs').renameSync(tmp, f);
    return { written: true, invalid: false, total: list.length };
  };
  return (typeof deps._withLock === 'function') ? deps._withLock(f, write) : write();
}

 
function routeCmd(root, taskText, deps = {}) {
  const { has, arg } = deps;
  root = absRoot(root);
  const json = !!(has && has('--json'));
  if (!exists(path.join(root, '.leerness'))) { failJson(json, 'harness_missing', `leerness 미설치: ${root} — 먼저 leerness init`); return; }

  if (has && has('--log')) return _showLog(root, json);

  const classified = classify(taskText, { tier: (arg ? arg('--tier', '') : '') || '' });
  const cls = applyDeclaredRiskFloor(classified, {
    approvedBy: arg ? arg('--approved-by', '') : '',
    reason: arg ? arg('--reason', '') : '',
  });
  if (!cls.ok) { failJson(json, cls.code, cls.error); return; }
  const wantDispatch = !!(has && (has('--confirm') || has('--dispatch')));
  const gateOn = typeof deps._toggleOn === 'function' ? deps._toggleOn(root, 'difficulty-routing') : false;
   
   
  const p = plan(root, cls, Object.assign({}, deps, { authAllowed: wantDispatch && gateOn }));
  if (p.roleStoreFailure) {
    const payload = { ok: false, ...p.roleStoreFailure };
    if (json) log(JSON.stringify(payload, null, 2));
    else failJson(false, payload.code || 'role_store_error', payload.error || payload.message || '역할 설정 파일이 유효하지 않아 라우팅을 중단합니다');
    process.exitCode = 1;
    return { cls, plan: p, confirmed: false };
  }
   
   
  const approvedBy = normalizeApprover(arg ? arg('--approved-by', '') : '');

   
  const refusals = [];
  if (wantDispatch && !gateOn) refusals.push({ code: 'routing_disabled', message: '난이도 라우팅 토글이 꺼져 있습니다 — leerness toggle set difficulty-routing on' });
  if (wantDispatch && p.blockers.length) p.blockers.forEach(b => refusals.push(b));
  if (wantDispatch && p.humanApproval && !approvedBy) refusals.push({ code: 'human_approval_required', message: '고위험 작업은 사람 승인이 필요합니다 — --approved-by "<승인자>"' });

   
   
   
  const confirmed = wantDispatch && !refusals.length;
  const rec = {
    at: now(),
     
     
    task: require('./pure-utils').redactSecrets(String(taskText == null ? '' : taskText).trim(), 300),
    tier: cls.tier, confidence: cls.confidence, conflict: !!cls.conflict,
    declaredTier: cls.declaredTier || null,
    detectedTier: cls.detectedTier || null,
    riskDowngrade: cls.riskDowngrade || null,
    signals: cls.signals.map(s => `${s.kind}:${s.id}`),
    assignments: p.assignments.map(a => ({ role: a.role, provider: a.provider, model: a.model, modelFamily: a.modelFamily || null })),
    reviewerIndependent: p.reviewerIndependent,
    reviewerIndependence: p.reviewerIndependence,
    requested: wantDispatch ? 'confirm' : 'suggest',
    confirmed, executed: false, approvedBy: approvedBy || null,
    refusals: refusals.map(r => r.code),
  };
  const logged = _appendLog(root, rec, deps) || {};

  if (json) {
    log(JSON.stringify({
      ok: !wantDispatch || confirmed, tier: cls.tier, confidence: cls.confidence, conflict: !!cls.conflict,
      declaredTier: cls.declaredTier || null, detectedTier: cls.detectedTier || null,
      riskDowngrade: cls.riskDowngrade || null,
      signals: cls.signals, reasons: cls.reasons, plan: p, gateEnabled: gateOn,
      confirmed, executed: false, refusals,
      auditWritten: logged.written !== false, auditWarning: logged.invalid ? `감사 기록에 남기지 못했습니다(${logged.reason}) — ${_logPath(root)}` : undefined,
      availabilityNote: _AVAIL_NOTE,
      classificationNote: _CLASS_NOTE,
      executionNote: _EXEC_NOTE,
    }, null, 2));
    if (wantDispatch && !confirmed) process.exitCode = 1;
    return { cls, plan: p, confirmed };
  }

  log(`# leerness agents route — 난이도 ${cls.tier} (신뢰도 ${cls.confidence}${cls.conflict ? ' · 규칙 충돌' : ''})`);
  cls.reasons.forEach(r => log(`  · ${r}`));
  log(`\n  구성(${p.ko}):`);
  p.assignments.forEach(a => {
     
    const authMark = a.auth === 'ok' ? ' [인증 확인됨]' : a.auth === 'no' ? ' [🔴 미인증]'
      : a.resolved ? (a.authReason === 'checked' ? ' [인증 확인 수단 없음]' : ' [인증 미확인 — 이 등급에서는 확인하지 않음]') : '';
    log(`    ${a.role.padEnd(10)} ${a.resolved ? `${a.provider}${a.model ? ' / ' + a.model : ''}${authMark}` : '⚠ 미설정 — leerness roles set ' + a.role + ' --provider <id>'}`);
  });
  if (p.reviewerIndependent === false) log(`    ⚠ 검수자와 구현자의 모델 패밀리가 같거나 세션이 같습니다 — 독립 검수가 아닙니다`);
  else if (p.reviewerIndependent == null && p.assignments.some(a => a.role === 'reviewer')) log(`    ⚠ 검수자 독립성 미확인 — 모델 패밀리 증거가 필요합니다`);
  log(`\n  ⓘ ${_AVAIL_NOTE}`);
  log(`  ⓘ ${_CLASS_NOTE} 틀렸다면 --tier ${TIERS.join('|')} 로 지정하세요.`);
  if (logged.invalid) warn(`  감사 기록에 남기지 못했습니다(${logged.reason}) — ${_logPath(root)} 를 고치거나 삭제하세요`);
  if (!wantDispatch) {
    log(`\n  → 이 구성을 확정: leerness agents route "<작업>" --confirm${p.humanApproval ? ' --approved-by "<승인자>"' : ''}${gateOn ? '' : '  (먼저 leerness toggle set difficulty-routing on)'}`);
  } else if (!confirmed) {
    warn(`확정하지 않았습니다:`);
    refusals.forEach(r => log(`    - ${r.message}`));
    process.exitCode = 1;
  } else {
    ok(`라우팅 확정 — ${p.assignments.filter(a => a.resolved).map(a => `${a.role}:${a.provider}`).join(' · ')}`);
    log(`  ⓘ ${_EXEC_NOTE}`);
    log(`  아래 명령을 직접 실행하세요:`);
    p.assignments.filter(a => a.resolved).forEach(a => log(`    leerness agents dispatch "<${a.role} 작업 계약>" --role ${a.role}`));
    log(`  ⓘ 기록: ${_logPath(root)} (leerness agents route --log 로 열람)`);
  }
  return { cls, plan: p, confirmed };
}

function _showLog(root, json) {
  const cur = _loadLog(root);
   
  if (json) { log(JSON.stringify({ ok: !cur.invalid, invalid: cur.invalid, reason: cur.reason, total: cur.list.length, entries: cur.list.slice(-20), availabilityNote: _AVAIL_NOTE, executionNote: _EXEC_NOTE }, null, 2)); if (cur.invalid) process.exitCode = 1; return; }
  if (cur.invalid) { warn(`routing-log.json 형상 무효(${cur.reason}): ${_logPath(root)}`); process.exitCode = 1; return; }
  if (!cur.list.length) { log('라우팅 기록 없음 — leerness agents route "<작업 설명>"'); return; }
  log(`# leerness agents route --log (최근 ${Math.min(20, cur.list.length)} / 총 ${cur.list.length})`);
  cur.list.slice(-20).forEach(e => {
    const state = e.executed ? '실행' : e.confirmed ? '확정' : (e.requested === 'confirm' || e.requested === 'dispatch') ? '거부' : '제안';
    log(`  ${String(e.at).slice(0, 16)}  ${String(e.tier).padEnd(9)} ${String(e.confidence).padEnd(8)} ${state}  ${String(e.task).slice(0, 46)}`);
  });
  log(`\n  ⓘ ${_AVAIL_NOTE}`);
  log(`  ⓘ ${_EXEC_NOTE}`);
}

module.exports = { routeCmd, classify, applyDeclaredRiskFloor, plan, TIERS, TIER_ROLES, HIGH_RISK, TINY, _logPath, _loadLog };
