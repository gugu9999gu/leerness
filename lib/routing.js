// lib/routing.js — 작업 난이도별 모델 라우팅 (1.36.89, P-0007 · 사용자 승인 범위 = **제안 + 확인 후 실행**).
//
// 사용자 요청: "codex/claude 등의 CLI 설치·사용 가능 여부에 따라 작업 난이도별 AI 모델을 라우팅, 켜고 끌 수 있게".
//
// 검토(codex 27차 + 자체)에서 **기각/제한한 것**:
//   · 자유 텍스트로부터의 **조용한 자동 라우팅** — 잘못된 등급이 조용히 선택되면 사용자는 알 수 없고,
//     비싼 등급이 선택되면 과금이 발생한다. 그래서 기본은 제안이고, 실행은 명시 확인(--dispatch)이 필요하다.
//   · **모델 이름 하드코딩** — 벤더 모델은 몇 달마다 바뀐다. 정책은 추상 역할(architect/commander/coder/reviewer)로만
//     쓰고, 역할→provider+model 매핑은 사용자 설정(`leerness roles set`)에 맡긴다.
//   · **"설치됨 = 사용 가능"** — `--version` 이 도는 것은 인증·모델 사용권한·쿼터·비대화형 동작·과금 권한을
//     아무것도 증명하지 않는다. 그래서 상태를 그대로 라벨링하고, 검증하지 않은 것은 검증하지 않았다고 적는다.
//   · **변경 파일 수 기준 라우팅** — 일이 끝나야 알 수 있는 값이라 초기 라우팅 근거가 될 수 없다.
//
// 정직성 계약: 여기서 판정하는 것은 **텍스트에 대한 결정적 규칙 매칭**뿐이다. 난이도를 "측정"하지 않는다.
//   규칙이 겹치거나(오타 수정인데 인증 도메인) 신호가 약하면 그 사실을 그대로 노출하고 보수적으로 normal 이상을 준다.
'use strict';
const path = require('path');
const { absRoot, exists, read, writeUtf8, mkdirp, log, ok, warn, failJson, now } = require('./io');
const { stripDefaultIgnorables } = require('./pure-utils');
const { assessReviewerIndependence, normalizeApprover } = require('./role-fallback');
const roleStore = require('./role-store');

const TIERS = ['tiny', 'normal', 'high-risk'];

// 고위험 도메인 — 결정적 규칙. 여기 걸리면 tiny 로 내려가지 않는다(과대평가는 비용, 과소평가는 사고).
//   한글은 단어경계(\b)가 동작하지 않으므로 부분일치를 쓰고, 영문만 경계를 건다.
//   1.36.89 (codex 28차 #5): 종전엔 `\b(auth|permission|concurren|idempoten)\b` 처럼 **뒤쪽 \b** 를 붙여
//   `authentication` · `authorization` · `permissions` · `concurrency` · `idempotency` 가 전부 매치되지 않았다.
//   그 결과 "fix typo in authentication middleware" 가 **tiny** 로 떨어졌다(실측). 어간 + `\w*` 로 바꾼다.
//   오탐 가드: `author`(글쓴이)는 매치되면 안 되므로 authentic/authoriz 어간을 따로 적고,
//   `tokenizer`(파서 용어)를 피하려 token 뒤 `iz` 를 제외한다.
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

// 초소형 — **범위가 명시적으로 좁을 때만**. 고위험 신호가 하나라도 있으면 적용하지 않는다.
const TINY = [
  { id: 'typo', ko: '오타·문구', re: /\b(typo\w*|wording|copy fix)\b|오타|문구 수정|띄어쓰기/i },
  { id: 'rename', ko: '이름 변경', re: /\b(rename|변수명|함수명)\b|이름 변경|네이밍/i },
  { id: 'style', ko: '포맷·린트·CSS', re: /\b(lint\w*|format\w*|prettier|eslint|css|padding|margin|색상)\b|포맷|린트|여백|스타일/i },
  { id: 'comment', ko: '주석·문서 문구', re: /\b(comment\w*|docstring\w*)\b|주석/i },
  { id: 'single-test', ko: '테스트 1건', re: /\b(add a test|one test|테스트 한|테스트 1)\b/i },
];

// 1.36.89 (codex 28차 #4): 초소형 키워드가 **하나라도** 있으면 tiny 로 떨어지던 것 —
//   "Rewrite the entire compiler, replace the storage engine, and also fix one typo" 가 tiny 였다(실측).
//   tiny 는 "범위가 좁다"는 주장이므로, 광범위 신호가 있거나 설명이 길면 그 주장을 인정하지 않는다.
const BROAD = /\b(entire|whole|all |everything|rewrite|overhaul|refactor all|across the|end.to.end)\b|전체|전면|모든|갈아엎|재작성|통째/i;
const TINY_MAX_LEN = 80;

// 1.36.92 (자체 적대 검증): 전각 문자로 고위험 규칙을 우회할 수 있었다 —
//   `ＰＡＹＭＥＮＴ ｒｅｆｕｎｄ` 는 어떤 규칙에도 안 걸려 normal 로 떨어졌다(반각은 high-risk).
//   매칭 전에 NFKC 로 정규화한다(실측 비용: 3500자 200회에 4ms). 표시·기록은 원문을 쓴다.
function _norm(s) {
  const raw = String(s == null ? '' : s).trim();
  // 비가시 서식 문자·variation selector·시각적 공백을 끼워 넣으면 영문
  // 키워드가 쪼개져 고위험 규칙을 빠져나간다. 승인/증거 식별자와 같은
  // Unicode 단일출처를 사용해 신규 default-ignorable 범위도 함께 막는다.
  return stripDefaultIgnorables(raw, { nfkc: true, visibleIdentity: true });
}

// 규칙이 커버하는 문자 체계는 라틴(영문)과 한글뿐이다 — 그 외가 섞이면 고위험 규칙이 침묵한다는 뜻이므로,
//   tiny 로 내리는 근거가 될 수 없다. 어떤 체계가 섞였는지 이름을 돌려 사용자에게 사유를 그대로 보여준다.
const _SCRIPTS = [
  ['일본어', /[぀-ヿ]/],
  ['중국어(한자)', /[一-鿿]/],
  ['키릴', /[Ѐ-ӿ]/],
  ['아랍어', /[؀-ۿ]/],
  ['히브리어', /[֐-׿]/],
  ['태국어', /[฀-๿]/],
  ['데바나가리', /[ऀ-ॿ]/],
  ['그리스', /[\u0370-\u03ff]/],
  // codex 32차 #3: "라틴 문자면 커버된다"는 가정이 틀렸다 — 규칙 어휘는 **영어**뿐이라
  //   "modificar lógica de reembolso de pago css"(스페인어 결제 환불) 가 tiny 로 떨어졌다.
  //   악센트 라틴이 섞이면 영어가 아닐 가능성이 크므로 tiny 주장을 인정하지 않는다.
  //   한계(정직하게): 악센트 없는 비영어 라틴 문장(예: "pago reembolso css")은 여전히 구분하지 못한다.
  ['비영어 라틴(악센트)', /[\u00c0-\u024f]/],
];
function _hasUncoveredScript(t) {
  const hit = _SCRIPTS.find(([, re]) => re.test(t));
  return hit ? hit[0] : null;
}

// 사용자에게 반복 노출되는 고지 — **이 모듈이 실제로 한 일만** 말한다.
//   1.36.89 (codex 28차 #7): 종전 문구는 "설치·활성 여부만 확인했습니다"였는데, 이 모듈은 역할 매핑만 읽고
//   설치 확인(`--version`)을 **한 번도 하지 않는다**. 하지 않은 확인을 했다고 말하는 것이 바로 이 제품이 잡는 결함이다.
//   1.36.91: 인증 축이 생겼다 — 확인 가능한 provider 만 판정하고 나머지는 '확인안됨' 이다. 쿼터·과금 권한은 여전히 아무도 확인하지 않는다.
const _AVAIL_NOTE = '인증 확인은 **--confirm 으로 고위험 구성을 확정할 때만** 실행합니다(제안 단계에서는 외부 CLI 를 띄우지 않습니다). 확인하더라도 무료·비대화형 확인 명령이 등록된 provider 만 판정되며, 모델 사용권한·쿼터·과금 권한은 어느 provider 도 확인하지 않습니다(상세: leerness agents check).';
const _CLASS_NOTE = '난이도는 텍스트 규칙 매칭 결과이며 측정값이 아닙니다.';
//   1.36.91 (codex 30차 #3): 인증 축이 생기면서 이 문구가 **거짓이 됐다** — 인증 확인은 외부 CLI 를
//   실제로 실행한다(`<bin> --version` · 등록된 status 명령). "모델을 호출하지 않는다"와 "프로세스를 전혀
//   띄우지 않는다"는 다른 말이고, 전자만 참이다. 문구를 사실에 맞춘다.
//   1.36.92 (헌트 #3): "상태 명령만 실행" 도 부정확했다 — 인증 확인은 `--version` 도 함께 돌린다(감지용).
const _EXEC_NOTE = 'leerness 는 여기서 작업을 대신 수행하지 않습니다 — 계획을 확정하고 기록할 뿐이며, 모델 호출(과금)은 하지 않습니다. (고위험 구성을 --confirm 으로 확정할 때만, 인증 확인을 위해 해당 CLI 의 버전 확인과 로그인 상태 명령을 실행합니다.)';

// 난이도 판정 — 순서가 곧 정책이다. (1) 사용자 명시 (2) 고위험 도메인 (3) 초소형 (4) 기본 normal
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

  // 1.36.89 (codex 28차 #3): 빈 작업 검사가 declared 분기 **뒤에** 있어, `--tier tiny` 만 주면
  //   빈 작업이 통과했다(실측). 어떤 경로로도 빈 작업은 받지 않는다.
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
    // 고위험 + 초소형 신호 동시 매칭(예: "인증 문서 오타 수정")은 규칙만으로 못 가른다 — 사실을 노출하고 보수적으로 간다.
    const conflict = tiny.length > 0;
    reasons.push(`고위험 도메인 규칙 매칭: ${high.map(r => r.ko).join(', ')}`);
    if (conflict) reasons.push(`동시에 초소형 신호(${tiny.map(r => r.ko).join(', ')})도 있습니다 — 규칙으로는 가릴 수 없어 보수적으로 high-risk 로 둡니다. 사소한 작업이면 --tier tiny 로 낮추세요`);
    return { ok: true, tier: 'high-risk', confidence: conflict ? 'low' : 'high', signals, reasons, conflict };
  }

  // 신호가 없고 설명이 짧으면 판정 근거가 없는 것이다 — tiny 로 내리지 않고 normal 로 둔다(과소평가 금지).
  if (!tiny.length) {
    const weak = t.length < 12;
    reasons.push(weak
      ? '매칭된 규칙이 없고 설명이 짧습니다 — 판정 근거가 부족해 기본값 normal 로 둡니다'
      : '매칭된 고위험/초소형 규칙 없음 — 기본값 normal');
    return { ok: true, tier: 'normal', confidence: weak ? 'low' : 'medium', signals, reasons, conflict: false };
  }

  // tiny 는 "범위가 좁다"는 주장이다 — 광범위 신호가 있거나 설명이 길면 그 주장을 인정하지 않는다.
  const broad = BROAD.test(t);
  const longText = t.length > TINY_MAX_LEN;
  //   1.36.92 (헌트 #15, High): 고위험 규칙은 **영어·한국어 어휘만** 담고 있다. 설명이 다른 언어로 쓰이면
  //   고위험 규칙은 통째로 침묵하는데, tiny 어휘(css/lint/typo/rename/format)는 라틴 문자라 그대로 살아남아
  //   결제·인증·전체삭제 작업이 **tiny 로 확정**됐다(실측). 규칙이 못 읽는 언어에서 "좁다"고 단정할 근거가 없다.
  //   → 커버하지 않는 문자 체계가 섞여 있으면 tiny 주장을 인정하지 않는다(normal 로 보수 처리).
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

// 등급별 역할 구성 — **추상 역할 id 만** 쓴다(모델 이름 없음). 매핑은 `leerness roles set` 이 소유한다.
const TIER_ROLES = {
  tiny: { roles: ['coder'], humanApproval: false, ko: '작업자 1명 + 기존 테스트' },
  normal: { roles: ['commander', 'coder', 'reviewer'], humanApproval: false, ko: '지휘·구현·검수' },
  'high-risk': { roles: ['architect', 'commander', 'coder', 'reviewer'], humanApproval: true, ko: '설계 선행 · 독립 검수 · 사람 승인' },
};

// 라우팅 계획 — 역할을 사용자 설정으로 해석하고, 해석 못 한 역할과 독립성 결함을 그대로 보고한다.
function plan(root, cls, deps = {}) {
  // 알 수 없는 등급은 여기서 크래시할 게 아니라 가장 보수적인 구성으로 떨어뜨린다 —
  //   상류 검증이 사라져도 "조용히 느슨해지는" 대신 가장 엄격한 쪽으로 실패하게(fail-closed).
  const spec = TIER_ROLES[cls.tier] || TIER_ROLES['high-risk'];
  const resolve = typeof deps._resolveRole === 'function' ? deps._resolveRole : () => null;
  // 1.36.89 (codex 28차 #6): 종전엔 `resolved: !!r` 라 provider 가 빈 문자열이어도 "해석됨"이었다 —
  //   빈 provider 로 dispatch 가 통과하고 `coder:` 로 표시됐다(실측). 실제로 쓸 수 있는 값인지까지 본다.
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
  // 독립 검수는 provider 이름이 아니라 **확인된 모델 패밀리**로 판정한다.
  // Gateway/provider가 달라도 같은 Claude/GPT 패밀리를 중계할 수 있으므로, family가 없으면 unverified다.
  const reviewerAssessment = roleStoreFailure
    ? { reviewerIndependent: null, status: 'unverified', basis: 'role-store-snapshot-invalid' }
    : !reviewer || !reviewer.resolved || !coder || !coder.resolved
      ? { reviewerIndependent: null, status: 'unverified', basis: 'role-unresolved' }
    : assessReviewerIndependence(reviewer, coder);
  const reviewerIndependent = reviewerAssessment.reviewerIndependent;
  // 1.36.91: 인증이 **확인 결과 아님(no)** 인 provider 는 고위험에서 fail-closed.
  //   unknown 은 막지 않는다 — 대부분의 CLI 는 무료·비대화형 확인 수단이 없어서, unknown 을 막으면
  //   거의 모든 고위험 작업이 잠긴다(false-BLOCK). 확실히 아닌 것만 막고, 모르는 것은 모른다고 표시한다.
  //   codex 30차 #3: 인증 확인은 외부 프로세스를 띄운다(provider 당 최대 version 5s + status 8s).
  //   차단에 쓰이는 곳은 고위험뿐이므로 **고위험에서만** 확인한다 — tiny/normal 은 지연도 실행도 없다.
  //   1.36.92 (헌트 #2/#3): 그런데 **제안만 하는 호출에서도** 확인이 돌았다 — 토글 OFF·`--confirm` 없음·
  //   `LEERNESS_ENABLE_*` 미설정 상태에서 `agents route "..."` 한 번이 codex 를 두 번 띄웠다(실측 shim 로그).
  //   공개된 opt-out("LEERNESS_ENABLE_* 미설정 시 비활성")과 "사용자 동의 없이 외부 CLI 를 자동 호출하지 않는다"는
  //   주장에 정면으로 어긋난다. 그래서 **확정 요청(--confirm)일 때만** 확인한다 — 제안은 프로세스를 띄우지 않는다.
  const mayCheck = spec.humanApproval && deps.authAllowed === true && typeof deps._providerAuth === 'function';
  const authOf = mayCheck ? deps._providerAuth : () => 'unknown';
  //   왜 'unknown' 인지 사유를 구분한다 — 헌트 #1: 종전엔 tiny/normal 에서도 "확인 명령이 없어서"라고 설명해,
  //   유일하게 확인 명령이 등록된 codex 를 "확인 수단 없는 provider"로 읽게 만들었다.
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

const _LOG_MAX_BYTES = 4 * 1024 * 1024;   // codex 28차 #9: 파싱 전에 크기를 본다 — 거대 파일을 동기로 읽어 CLI 가 멎으면 안 된다

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

// 감사 기록 — 무엇을 보고 무엇을 골랐는지 남지 않으면 사후에 라우팅을 검증할 수 없다.
//   1.36.89 (codex 28차 #8): 손상 파일을 `[rec]` 으로 **조용히 덮어썼다**(실측) — 감사 기록을 파괴하는
//   동작이 감사 기록 기능 안에 있었다. 손상 시에는 쓰지 않고 그 사실을 반환한다(스토어 손상 = 덮어쓰기 거부, 기존 규율).
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

// `leerness agents route "<작업>" [--tier x] [--dispatch] [--approved-by "이름"] [--json]`
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
  //   인증 확인은 외부 프로세스를 띄운다 — **확정을 요청했고 토글도 켜져 있을 때만** 허용한다.
  //   codex 32차 #7: 종전엔 확정 요청만 보아, 토글이 꺼져 **어차피 거부될 호출**에서도 CLI 를 실행했다.
  const p = plan(root, cls, Object.assign({}, deps, { authAllowed: wantDispatch && gateOn }));
  if (p.roleStoreFailure) {
    const payload = { ok: false, ...p.roleStoreFailure };
    if (json) log(JSON.stringify(payload, null, 2));
    else failJson(false, payload.code || 'role_store_error', payload.error || payload.message || '역할 설정 파일이 유효하지 않아 라우팅을 중단합니다');
    process.exitCode = 1;
    return { cls, plan: p, confirmed: false };
  }
  //   승인자는 NFKC 정규화 후 보이지 않는 문자만 제거한다 — 제로폭 문자로 채운 값이
  //   "승인자 있음"으로 통과하면 감사 기록에 보이지 않는 승인자가 남는다.
  const approvedBy = normalizeApprover(arg ? arg('--approved-by', '') : '');

  // 실행 거부 사유 — 하나라도 있으면 dispatch 하지 않는다(고위험은 fail-closed).
  const refusals = [];
  if (wantDispatch && !gateOn) refusals.push({ code: 'routing_disabled', message: '난이도 라우팅 토글이 꺼져 있습니다 — leerness toggle set difficulty-routing on' });
  if (wantDispatch && p.blockers.length) p.blockers.forEach(b => refusals.push(b));
  if (wantDispatch && p.humanApproval && !approvedBy) refusals.push({ code: 'human_approval_required', message: '고위험 작업은 사람 승인이 필요합니다 — --approved-by "<승인자>"' });

  // 1.36.89 (codex 28차 #1): 종전 필드명은 `dispatched` 였는데 이 모듈은 **외부 CLI 를 실행하지 않는다** —
  //   실행했다고 보고하면서 아무것도 실행하지 않는, 이 제품이 가장 경계하는 형태의 거짓말이었다(실측).
  //   실제로 하는 일은 "계획을 확정하고 실행 명령을 내주는 것"이므로 그대로 `confirmed` 라고 부른다.
  const confirmed = wantDispatch && !refusals.length;
  const rec = {
    at: now(),
    //   1.36.92: 감사 기록은 **사용자가 실제로 입력한 문자열**을 남긴다(분류용 NFKC 정규화본이 아니라).
    //   다만 이 파일은 git 에 추적되므로 시크릿은 값만 가린다(헌트 #6 — 대시보드와 같은 술어).
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
    //   사유를 구분해 표시한다 — "확인 안 함"과 "확인할 수단이 없음"은 다른 말이다(헌트 #1).
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
  // codex 28차 #7: 고지가 --log 경로에는 없어서, 기록만 보는 사용자는 "provider/model 이 검증된 값"으로 읽었다.
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
