'use strict';

// 1.9.274 (UR-0025 1단계, GPT-5.5 리뷰): bin/harness.js 단일 대형 파일 모듈 분리 — 점진적·비파괴 시작.
//   여기에는 harness 내부 상태/다른 함수에 의존하지 않는 "순수 함수"만 추출한다 (부작용 0, 단위 테스트 대상).
//   harness.js 는 이 모듈을 require 해 동일 이름으로 사용한다. 동작 동일 — selftest 가 7종 모두 검증.

// 보안: 환경변수 키가 시크릿(TOKEN/SECRET/PASSWORD/API_KEY/PRIVATE)인지 판별.
function _isSecretKey(k) {
  return /TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE/i.test(k);
}

// 표시용 자유 텍스트에서 시크릿 값을 가린다 — 키 이름은 남겨 맥락을 유지하고 **값만** 지운다.
//   1.36.91: 대시보드와 인증 확인 evidence 두 곳이 필요해 여기(순수 함수)로 올렸다.
//   표면마다 다시 구현하면 한쪽만 고쳐지는 불일치가 생긴다(1.36.90 에서 이미 겪은 클래스).
const _SECRET_ASSIGN = /\b([A-Za-z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH)[A-Za-z0-9_]*)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi;
// 1.36.92 (헌트 #13): `Authorization: Bearer <토큰>` 이 통과했다 — 키 이름 뒤 값이 `Bearer` 로 끝나 거기서 멈추고
//   실제 토큰은 다음 토큰이라 그대로 남았다. 게다가 옆에 `***` 가 찍혀 **가려졌다는 거짓 안심**을 줬다
//   (안 가리는 것보다 나쁘다). 스킴 뒤의 값까지 함께 지운다.
// 1.36.92 (codex 32차 #4/#6): 종전 규칙은 두 방향으로 틀렸다 —
//   ① 짧은 자격증명을 놓쳤다: `Authorization: Basic YTpi`(= a:b) 가 그대로 남았고, token68 에 허용되는 `~` 가
//      문자군에 없어 `Bearer abcdefgh~SECRET` 의 뒷부분이 살아남았다.
//   ② 멀쩡한 산문을 훼손했다: `Basic authentication flow` → `Basic *** flow`, `Token release/1.2.3` → `Token ***`.
//   그래서 **authorization 헤더 문맥에 앵커**하고, 값은 token68 전체를 길이 제한 없이 지운다.
//   (헤더 밖의 맨 `Bearer <값>` 은 아래 SHAPE 규칙이 형태로 잡는다 — 산문 훼손 위험을 감수하지 않는다.)
const _SECRET_AUTH_HEADER = /\b((?:proxy-)?authorization)([ \t]*[:=][ \t]*)(?:(Bearer|Basic|Token|ApiKey|Digest)([ \t]+))?([A-Za-z0-9._~+/-]+=*)/gi;
const _SECRET_SHAPE = /\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|ghs_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,}|ASIA[0-9A-Z]{12,}|AIza[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g;
// 1.36.96 (검수 P1): 마스킹이 **스캐너와 다른(더 약한) 목록**을 쓰고 있었다. 실측으로 6종이 그대로 새어
//   화면에 실렸다 — DB 접속문자열 비밀번호 · GitLab PAT · npm 토큰 · Stripe live 키 · SendGrid · 개인키 블록.
//   전부 `SECRET_PATTERNS`(catalogs.js)에 **이미 있던** 패턴이다. 한쪽만 강화된 전형적인 표면 불일치라
//   같은 목록을 공유한다. placeholder/entropy 가드도 스캐너와 동일하게 적용해 오탐을 늘리지 않는다.
//   (catalogs.js 는 require 가 없어 순환이 생기지 않는다. 그래도 지연 로드 + 실패 시 기존 규칙만 사용.)
// 개인키는 **블록 전체**를 지운다. 스캐너는 BEGIN 줄만 탐지하면 충분하지만(있다/없다), 화면에 싣는
//   텍스트는 본문(base64)이 남으면 키가 그대로 노출된다 — 실측에서 BEGIN 줄만 *** 가 되고 본문은 남았다.
//   `[\s\S]*?` 는 **BEGIN 과 무관한 END 사이의 산문까지** 삼킨다 — 종료되지 않은 키 하나가 문서 뒤쪽의
//   END 줄과 짝지어져 그 사이 전부가 사라질 수 있다(변이 실험 중 발견). 사이에는 PEM 헤더·base64·빈 줄만 허용한다.
//   **문턱과 문자 조성으로는 키 본문과 산문을 가를 수 없다.** 네 번 시도했고 매번 한쪽이 깨졌다:
//     16자 → 인용 문서의 식별자 삼킴 · 40자 → 짧게 감긴 키 누출 ·
//     "숫자/기호 포함" → 영문자만인 실제 키 줄 누출(검수가 진짜 RSA 키로 51줄 누출을 재현) ·
//     그 역 → `PolicyVersion2026Final` 같은 정상 식별자 삼킴.
//   그래서 값이 아니라 **문맥과 실패 방향**으로 정한다. BEGIN 마커 뒤의 **공백 없는 한 줄**은 키 재료로 본다.
//   산문은 거의 항상 공백을 포함하므로 문단은 살아남고, 어떤 조성의 키 본문도 새지 않는다.
//   대가: BEGIN 을 인용한 문서에서 **바로 뒤의 단일 토큰 한 줄**이 가려진다. 원본 파일은 그대로이고
//   이건 표시용 스냅샷이므로, 누출보다 이 쪽이 낫다 — 표시용 마스킹은 안전한 쪽으로 실패해야 한다.
//   PGP 블록의 `=CRC` 줄도 이 규칙에 자연히 포함된다.
const _PEM_HDR = '(?:Proc-Type|DEK-Info|Comment|Subject|Originator|Version|MessageID|Charset|X-[A-Za-z0-9-]+):[^\\r\\n]*';
//   줄 **끝까지** 공백이 없어야 한다 — 앵커가 없으면 산문 줄의 첫 낱말만 먹고 나머지를 남긴다(실측).
const _PEM_BODY = '(?!-----)\\S+(?=[ \\t]*(?:\\r?\\n|$))';
// 1.36.96: **값 단위 마스킹이 완벽해야 하는 구조를 버린다.**
//   문서 뷰어에서 다섯 라운드 동안 누출 경로가 계속 나왔다 — 인용문(`> `)으로 감싼 PEM, base64 의 `/`·`+`,
//   소문자 `bearer`, placeholder 모양 토큰, 줄 앞 접두어… 값의 형태로 가르려는 시도마다 반례가 있었다.
//   그래서 **자격증명 표지가 하나라도 있으면 그 문서의 본문을 아예 싣지 않는다.** 마스킹은 방어의 두 번째 층으로만 남고,
//   "완벽한 마스킹"이 안전의 전제에서 빠진다.
//   비용 실측(실제 문서 156개): 표지가 걸린 파일 **1개(0.6%)** — 사실상 공짜다.
//   표지는 **값이 아니라 형식**으로만 정의한다(줄 앞 접두어·대소문자·본문 조성에 의존하지 않는다).
//   검수가 표지를 빠져나가는 네 형태를 실행으로 보였다 — RFC6750 의 짧은(19자) Bearer, 세션 쿠키,
//   compact JWE(5분절이라 `eyJ…eyJ` 형태가 아니다), 마크다운 강조로 감싼 `` `Bearer` `` .
//   넓히기 전에 비용을 쟀다: 실제 문서 156개에서 **추가로 걸리는 파일 0개**. 그래서 셋 다 넓힌다.
const _CRED_MARKERS = [
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/,
  //   JWT(3분절)와 JWE(5분절)를 함께 — 두 번째 분절이 비어 있을 수 있다(dir 알고리즘)
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{2,}/,
  //   스킴과 값 사이에 마크다운 강조(`**` · `` ` ``)가 낄 수 있다. RFC6750 토큰은 짧을 수 있어 16자로 잡는다.
  /\bbearer\b[^A-Za-z0-9\r\n]{0,4}[A-Za-z0-9_\-.=+/~]{16,}/i,
  /\b(?:proxy-)?authorization[ \t]*[:=]/i,
  /\b(?:set-)?cookie[ \t]*[:=]/i,
  /\b(?:gh[pousr]_|github_pat_|sk-|sk_live_|rk_live_|xox[baprs]-|xapp-|AKIA|ASIA|AIza|ya29\.|glpat-|npm_|SG\.)/,
  /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/@]+:[^@\s/]+@/i,
];
function hasCredentialMarker(s) {
  const t = String(s == null ? '' : s);
  return _CRED_MARKERS.some(re => re.test(t));
}

// 카탈로그의 Bearer 문자군은 `[A-Za-z0-9_\-.=]` 라 base64 의 `/` `+` 에서 끊긴다 — 앞 조각이 20자 미만이면
//   `Bearer <실토큰>` 이 통째로 남는다(실측: 앞 8자 뒤 `/` 인 40자 토큰이 전혀 가려지지 않았다).
//   `Authorization:` 헤더 형태는 _SECRET_AUTH_HEADER 가 잡지만 맨 `Bearer …` 는 이 규칙이 필요하다.
//   스캐너 쪽 문자군도 같은 구멍이 있다(T-0085 로 남겼다) — 여기서는 표시 누출부터 막는다.
const _SECRET_BEARER = /\bBearer\s+[A-Za-z0-9_\-.=+/]{20,}/g;
const _SECRET_PEM = new RegExp('-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----(?:[ \\t]*\\r?\\n[ \\t]*(?:' + _PEM_HDR + '|' + _PEM_BODY + ')?)*[ \\t]*\\r?\\n[ \\t]*-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----', 'g');
//   END 줄이 없으면 위 규칙이 매치되지 않아 BEGIN 줄만 지워지고 **본문 base64 가 그대로 남았다**(검수 실측).
//   붙여넣다 잘린 키가 흔하므로, BEGIN 뒤에 이어지는 base64/헤더 줄까지 함께 지운다.
//   ① 암호화 키는 `Proc-Type:`/`DEK-Info:` 헤더 뒤 **빈 줄**이 오고 본문이 시작한다 — 빈 줄에서 멈추면 본문이 샌다.
//   ② 반대로 아무 `Name: value` 줄이나 먹으면 BEGIN 을 인용한 정책 문서의 산문을 삼킨다(둘 다 검수 실측).
//   그래서 헤더는 **PEM 표준 이름만** 허용하고, 본문 base64 줄이 **최소 하나** 있을 때만 확장한다.
const _SECRET_PEM_OPEN = new RegExp('-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----(?:[ \\t]*\\r?\\n[ \\t]*' + _PEM_HDR + ')*(?:[ \\t]*\\r?\\n[ \\t]*)*(?:[ \\t]*\\r?\\n[ \\t]*(?:' + _PEM_BODY + '))+[ \\t]*\\r?\\n?', 'g');

// **탐지용 문맥 휴리스틱은 가림에 그대로 쓰면 안 된다.** 탐지의 오탐은 경고 한 줄이지만, 가림의 오탐은
//   사용자가 보는 문서를 조용히 파괴한다(대시보드도 이 함수를 쓴다). 검수 실측으로 확인한 두 가지:
//     'AWS secret commit <40자 커밋해시> was reverted' → 문장 전체가 *** 로 사라졌다.
//     'Use Bearer authenticationMiddleware for API requests.' → 'Use *** for API requests.'
//   엔트로피 게이트(_looksSecretLike)로는 갈리지 않았다 — 진짜 AWS 키까지 placeholder 로 판정된다(실측).
//   그래서 문맥 패턴은 가림에서 제외하고, Bearer 는 값에 숫자가 있을 때만 가린다.
//   남는 구멍: `Authorization:` 없이 적힌 **영문자만으로 된** Bearer 토큰. 헤더 형태는 _SECRET_AUTH_HEADER 가,
//   실제 토큰 형식(JWT·ghp_·AKIA·sk- 등)은 형태 패턴이 잡는다.
//   초판은 AWS 문맥 패턴을 통째로 제외했는데, 그러면 `aws secret access key <40자>` 처럼 **구분자 없는 실값이
//   샌다**(검수 실측). 문장을 삼키지 않으면서 값만 지우도록, 이 패턴은 **꼬리 자격증명만** 치환한다.
//   commit 해시가 같은 형태라 가려지는 것은 감수한다 — 문장 구조는 남으므로 파괴가 아니다.
const _REDACT_SKIP = new Set();
const _REDACT_TAIL = {
  'AWS Secret Access Key (context)': /(["']?)([A-Za-z0-9/+]{40})(["']?)$/,
};
//   Bearer 값도 같은 결론이다. 길이 문턱(32자)은 20~31자 실토큰을 놓쳤고, 모양 판별(camelCase 예외)은
//   `Bearer abcdefghijklmnopqrst` · `Bearer CorrectHorseBatteryStaple` 같은 **유효한 불투명 토큰을 산문으로
//   판정해 노출**했다(검수 실측). 불투명 토큰이 소문자나 낱말꼴이 아니라는 보장이 없다 — 예외를 없앤다.
//   대가: `Use Bearer authenticationMiddleware for API requests.` 같은 문장이 `Use *** for …` 가 된다.
//   카탈로그가 이미 20자 이상만 후보로 잡으므로 `Bearer 인증` 같은 짧은 표현은 영향이 없다.
const _REDACT_GUARD = {};
let _SECRET_CATALOG = null;
function _secretCatalog() {
  if (_SECRET_CATALOG) return _SECRET_CATALOG;
  try { _SECRET_CATALOG = require('./catalogs').SECRET_PATTERNS || []; } catch { _SECRET_CATALOG = []; }
  return _SECRET_CATALOG;
}
function redactSecrets(s, max) {
  let out = String(s == null ? '' : s)
    .replace(_SECRET_AUTH_HEADER, (m, key, sep, scheme, gap) => `${key}${sep}${scheme ? scheme + (gap || ' ') : ''}***`)
    .replace(_SECRET_ASSIGN, (m, k) => `${k}=***`)
    .replace(_SECRET_SHAPE, '***')
    .replace(_SECRET_PEM, '***')
    .replace(_SECRET_PEM_OPEN, '***\n')
    .replace(_SECRET_BEARER, '***');
  for (const p of _secretCatalog()) {
    const { re, valueGroup, requireSecretLike } = p;
    if (!re || _REDACT_SKIP.has(p.name)) continue;
    const guard = _REDACT_GUARD[p.name];
    try {
      out = out.replace(re, (...args) => {
        const m0 = args[0];
        const val = (valueGroup != null) ? args[valueGroup] : m0;
        if (!val) return m0;
        if (guard && !guard(m0)) return m0;                                         // 가림 전용 추가 가드
        const tailRe = _REDACT_TAIL[p.name];                                        // 꼬리 값만 지우는 패턴
        if (tailRe) { const t = m0.match(tailRe); return t ? m0.slice(0, m0.length - t[0].length) + t[1] + '***' + t[3] : m0; }
        if (_isPlaceholderSecret(val)) return m0;                                   // .env.example 의 더미값
        if (valueGroup != null && requireSecretLike && !_looksSecretLike(val)) return m0;
        if (valueGroup == null) return '***';
        const i = m0.indexOf(val);                                                  // 값만 지우고 맥락은 남긴다
        return i < 0 ? '***' : m0.slice(0, i) + '***' + m0.slice(i + val.length);
      });
    } catch { /* 한 패턴이 실패해도 나머지 마스킹은 계속한다 */ }
  }
  if (max && out.length > max) out = out.slice(0, max) + '…';
  return out;
}

// semver 비교: a>b → 1, a<b → -1, 같음 → 0. (누락 파트/null 안전)
function compareVer(a, b) {
  const A = String(a || '0'), B = String(b || '0');
  const sa = A.split('-')[0].split('.').map(n => parseInt(n || '0', 10));
  const sb = B.split('-')[0].split('.').map(n => parseInt(n || '0', 10));
  for (let i = 0; i < 3; i++) {
    const x = sa[i] || 0, y = sb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  // 1.9.354 (UR-0072 외부리뷰): 숫자 동일 시 pre-release(-beta/-next 등) < 정식 (semver 규칙). 이전: -beta 무시 → 동일 취급.
  const preA = A.includes('-'), preB = B.includes('-');
  if (preA && !preB) return -1;
  if (!preA && preB) return 1;
  // 1.36.34 (codex 3차 #5): 둘 다 pre-release 면 식별자 세그먼트 비교(semver §11) — 종전엔 0 반환이라 beta.10 == beta.2 오답.
  if (preA && preB) {
    const pa = A.slice(A.indexOf('-') + 1).split('.'), pb = B.slice(B.indexOf('-') + 1).split('.');
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i], y = pb[i];
      if (x === undefined) return -1;   // 짧은 쪽이 낮음 (semver: 세그먼트 적은 쪽 <)
      if (y === undefined) return 1;
      const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      if (nx && ny) { const d = parseInt(x, 10) - parseInt(y, 10); if (d) return d > 0 ? 1 : -1; }
      else if (nx !== ny) return nx ? -1 : 1;   // 숫자 < 문자 (semver 규칙)
      else if (x !== y) return x > y ? 1 : -1;
    }
  }
  return 0;
}

// harness 버전 문자열 파싱: canonical "1.9.0" / legacy plus "leerness@1.8.0+plus@1.0.1" / "leerness@1.8.0".
function parseHarnessVersion(text) {
  const t = String(text || '').trim();
  const plus = t.match(/plus@(\d+\.\d+\.\d+)/);
  const baseAt = t.match(/leerness@(\d+\.\d+\.\d+)/);
  const bare = t.match(/^(\d+\.\d+\.\d+)\s*$/);
  return {
    plus: plus ? plus[1] : null,
    base: baseAt ? baseAt[1] : (bare ? bare[1] : null),
    raw: t || '(not installed)'
  };
}

// UTF-8 바이트열의 CJK 분류 (한국어/일본어/중국어/기타) — 인코딩 오인식 위험 감지용.
function _classifyCJK(buf, len) {
  let korean = 0, japanese = 0, chinese = 0, other = 0, han = 0;
  for (let i = 0; i < Math.min(buf.length, len); i++) {
    const b = buf[i];
    if (b < 0x80) continue;
    if (b >= 0xEA && b <= 0xED) korean++;
    else if (b === 0xE3) japanese++;          // kana/기호 (U+3000-3FFF) — 일본어 강한 신호
    else if (b >= 0xE4 && b <= 0xE9) han++;    // CJK 통합 한자 — 한·중·일 공유라 모호
    else other++;
  }
  // 1.9.354 (UR-0072 외부리뷰): 한자는 한·중·일 공유라 lead byte 만으로 판별 불가 → kana 가 있으면 일본어, 없으면 중국어로 귀속(휴리스틱). advisory 라벨 일본어 오판 완화.
  if (japanese > 0) japanese += han; else chinese += han;
  return { korean, japanese, chinese, other };
}

// CJK 분류 결과 → 위험 라벨 (Windows 코드페이지 오인식 안내).
function _riskLabel(cjk) {
  if (cjk.korean >= cjk.japanese && cjk.korean >= cjk.chinese && cjk.korean > 0) {
    return { type: 'korean', risk: 'Windows 한국어 PowerShell 에서 CP949 로 오인식 가능 (BOM 추가 권장)' };
  }
  if (cjk.japanese > cjk.korean && cjk.japanese >= cjk.chinese) {
    return { type: 'japanese', risk: 'Windows 일본어 PowerShell 에서 CP932 (Shift-JIS) 로 오인식 가능 (BOM 추가 권장)' };
  }
  if (cjk.chinese > 0) {
    return { type: 'chinese', risk: 'Windows 중국어 PowerShell 에서 CP936 (GBK) 로 오인식 가능 (BOM 추가 권장)' };
  }
  return { type: 'non-ascii', risk: 'Windows 비-ASCII 셸 스크립트 — BOM 없는 UTF-8 인코딩 오인식 가능 (BOM 추가 권장)' };
}

// OS 시스템 언어 감지 (UR-0022): POSIX env > Intl ICU locale > null.
function _detectSystemLang(env) {
  env = env || process.env;
  const raw = String(env.LC_ALL || env.LC_CTYPE || env.LANG || env.LANGUAGE || '').toLowerCase();
  if (raw && raw !== 'c' && raw !== 'posix') {
    if (/(^|[^a-z])ko([_\-.]|$)|korean|[_-]kr([_\-.]|$)/.test(raw)) return 'ko';
    if (/(^|[^a-z])en([_\-.]|$)|english|[_-](us|gb)([_\-.]|$)/.test(raw)) return 'en';
  }
  try {
    const loc = (Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase();
    const primary = loc.split('-')[0];
    if (primary === 'ko') return 'ko';
    if (primary === 'en') return 'en';
  } catch {}
  return null;
}

// CLI `--help` 출력에서 슬래시 명령/하위명령 best-effort 파싱 (UR-0021 3단계). 순수 문자열 처리.
function _parseSlashFromHelp(text, invoke = 'slash') {
  const out = [];
  const seen = new Set();
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const ln = raw.replace(/\x1b\[[0-9;]*m/g, ''); // ANSI 색상 제거
    if (invoke === 'subcommand') {
      const m = ln.match(/^\s{2,}([a-z][a-z0-9][\w-]*)\s{2,}(\S.*)$/);
      if (m && !/^--/.test(m[1])) {
        const cmd = m[1];
        if (!seen.has(cmd) && cmd.length <= 24) { seen.add(cmd); out.push({ cmd, desc: m[2].trim().slice(0, 80) }); }
      }
      continue;
    }
    const m = ln.match(/^\s*(\/[a-zA-Z][\w-]*)(?:\s+[-–:]?\s*(.*))?$/);
    if (m) {
      const cmd = m[1];
      if (!seen.has(cmd) && cmd.length <= 24) { seen.add(cmd); out.push({ cmd, desc: (m[2] || '').trim().slice(0, 80) }); }
    }
  }
  return out;
}

// 1.9.283 (UR-0025 2단계): 권한 등급(permission tiers) 순수 로직 — capabilities/policy 공유.
const PERMISSION_TIERS = ['read-only', 'safe-write', 'project-write', 'shell-read', 'shell-write', 'git-write', 'network', 'publish'];
function _tierRank(t) { const i = PERMISSION_TIERS.indexOf(String(t || '')); return i < 0 ? PERMISSION_TIERS.length : i; }
// 명령/capability → 요구 등급 (순수 매핑)
function _requiredTier(cmd) {
  const c = String(cmd || '').toLowerCase();
  if (/release\s+publish|npm\s+publish|\bpublish\b/.test(c)) return 'publish';
  if (/\bweb\b/.test(c)) return 'network';
  if (/git\s+push|sync-main/.test(c)) return 'git-write';
  if (/multi\s+--execute|dispatch\s+--write|--yolo|\bpc\b/.test(c)) return 'shell-write';
  if (/agents\s+(list|quota|bench)|--run-tests/.test(c)) return 'shell-read';
  if (/\binit\b|\badapter\b|update\s+--yes|\bmigrate\b/.test(c)) return 'project-write';
  if (/state\s+(start|record|verify|handoff)|decision|lesson|plan\s+add|task\s+add|rule\s+add/.test(c)) return 'safe-write';
  return 'read-only';
}
function _policyAllows(allowedTier, requiredTier) { return _tierRank(requiredTier) <= _tierRank(allowedTier); }

// 1.9.283: npm dist-tag 결정 (UR-0026) — latest(안정)/next(실험), 잘못된 형식은 latest.
function _resolveNpmTag(explicit, env) {
  env = env || process.env;
  const raw = String(explicit || env.LEERNESS_NPM_TAG || 'latest').trim().toLowerCase();
  return /^[a-z][a-z0-9-]{0,38}$/.test(raw) ? raw : 'latest';
}

// 1.9.283: .mcp.json 내용 (UR-0033) — leerness MCP 서버 등록.
function _mcpJsonContent() {
  // 1.36.116 (검수 #13): `-y` 없으면 npx 가 설치 여부를 되묻고, GUI 클라이언트는 그 프롬프트에 답할 수 없다.
  //   `_mergeMcpJson` · `mcp install` 안내와 **같은 값**이어야 한다(사본 3벌 드리프트 방지).
  return JSON.stringify({ mcpServers: { leerness: { command: 'npx', args: ['-y', 'leerness', 'mcp', 'serve'] } } }, null, 2) + '\n';
}

// 1.9.283: run 레코드 빌더 (UR-0032) — GPT-5.5 권고 14필드. startedAt 주입 가능(테스트).
function _newRunRecord(opts = {}) {
  return {
    schemaVersion: 1,
    run_id: opts.run_id || null,
    task_id: opts.task_id || null,
    agent_name: opts.agent_name || null,
    model_name: opts.model_name || null,
    started_at: opts.started_at || new Date().toISOString(),
    ended_at: opts.ended_at || null,
    goal: opts.goal || '',
    files_read: Array.isArray(opts.files_read) ? opts.files_read : [],
    files_changed: Array.isArray(opts.files_changed) ? opts.files_changed : [],
    commands_run: Array.isArray(opts.commands_run) ? opts.commands_run : [],
    tests_run: Array.isArray(opts.tests_run) ? opts.tests_run : [],
    errors: Array.isArray(opts.errors) ? opts.errors : [],
    decisions: Array.isArray(opts.decisions) ? opts.decisions : [],
    verification_result: opts.verification_result || null,
    handoff_summary: opts.handoff_summary || null,
    status: opts.status || 'in-progress'
  };
}

// 1.9.443 (GPT-5.5 전략리뷰 §6.3/6.4, UR-0153): evidence-first 완료 게이트 — run-record 증거로 "완료 주장 가능" 여부 파생.
//   허용 조건: 변경 파일 존재 + 검증 실행(tests/commands) + 미해결 errors 0 + verification_result === 'pass'.
//   verification 미실행/실패는 불허(증거 없는 완료 차단). reasons 로 불허 사유 명시. 순수 함수(저장 X, 읽을 때 계산).
function _completionClaimAllowed(rec) {
  const r = rec || {};
  const A = (x) => (Array.isArray(x) ? x : []);
  const reasons = [];
  if (A(r.files_changed).length === 0) reasons.push('no_files_changed');
  if (A(r.tests_run).length === 0 && A(r.commands_run).length === 0) reasons.push('no_verification_run');
  if (A(r.errors).length > 0) reasons.push('unresolved_errors');
  const vr = String(r.verification_result || '').toLowerCase();
  if (vr === 'fail') reasons.push('verification_failed');
  else if (vr !== 'pass') reasons.push('not_verified');
  return { allowed: reasons.length === 0, reasons };
}

// 1.9.318 (UR-0025): 순수 HTML 파싱 유틸 (api-skill 문서 수집용) — fs/네트워크 의존 0, URL/regex 만 사용.
function _htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|h[1-6]|tr|td|pre)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}
function _extractTitle(html) {
  const m = (html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  return _htmlToText(m[1]).slice(0, 200);
}
function _extractLinks(html, baseUrl, maxLinks) {
  if (!html) return [];
  const base = new URL(baseUrl);
  const found = new Map();
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
    let abs;
    try { abs = new URL(href, baseUrl).toString(); } catch { continue; }
    const u = new URL(abs);
    if (u.hostname !== base.hostname) continue; // same-domain only
    if (abs === baseUrl) continue;
    if (found.has(abs)) continue;
    const text = _htmlToText(m[2]).slice(0, 120);
    found.set(abs, { url: abs, text });
    if (found.size >= (maxLinks || 10)) break;
  }
  return Array.from(found.values());
}

// 1.9.324 (UR-0025): 순수 메모리 MD 파서 — 코드펜스(```md 템플릿 예시) 제거 후 날짜 블록(### YYYY-MM-DD) 카운트/추출.
//   count drift(템플릿 오집계) 방지의 단일 진실소스. decisions/lessons 카운터가 공유.
function _countDatedBlocks(text) {
  const cleaned = String(text || '').replace(/^```[^\n]*\n[\s\S]*?\n```\s*$/gm, '');  // 코드펜스(템플릿) 제거
  return (cleaned.match(/^### \d{4}-\d{2}-\d{2}/gm) || []).length;
}
function _extractDecisionBlocks(text) {
  // 줄 시작의 ```부터 줄 시작의 ```까지를 코드블록으로 인식 (인라인 백틱 무시)
  const cleaned = String(text || '').replace(/^```[^\n]*\n[\s\S]*?\n```\s*$/gm, '');
  return cleaned.split(/\n(?=### )/).filter(b =>
    b.startsWith('### ') && !/^### (Template|템플릿)\b/.test(b.trim())
  );
}

// 1.36.85 (검수 M1): decision 블록 + **정확한 오프셋/줄번호**.
//   기존 소비부는 줄번호를 `decLines.findIndex(line => line === '### ' + title)` 로 구해,
//   같은 제목의 decision 이 둘이면 **둘 다 첫 번째 위치**를 보고했다(실측 [3,3], 기대 [3,10]).
//   `_extractDecisionBlocks` 는 코드펜스를 **삭제**해 길이가 변하므로 오프셋을 쓸 수 없다 →
//   여기서는 같은 길이의 공백으로 **마스킹**해 원문과 1:1 대응을 유지한다(펜스 안의 `### ` 은 여전히 헤딩으로
//   인식되지 않고, 펜스 내용은 매칭에도 걸리지 않는다 — 기존 의도 보존).
function _decisionBlocksWithOffset(text) {
  const raw = String(text || '');
  const masked = raw.replace(/^```[^\n]*\n[\s\S]*?\n```[ \t]*$/gm, (m) => m.replace(/[^\n]/g, ' '));
  return _blocksWithOffset(masked, /\n(?=### )/)
    .filter(x => x.block.startsWith('### ') && !/^### (Template|템플릿)\b/.test(x.block.trim()));
}

// 1.9.325 (UR-0025): 순수 intent 분류 — 사용자 텍스트의 precise/broad 신호로 의도 추정 (fs/상태 의존 0).
function _classifyIntent(text) {
  if (!text || typeof text !== 'string') return { intent: 'default', signals: [] };
  const signals = [];
  // precise 신호: "정확히 / 그것만 / 그대로 / only / just / 만"
  const preciseKws = ['정확히', '그것만', '그대로', 'only', 'just only', '말한대로', '말한 그대로'];
  for (const kw of preciseKws) {
    if (text.toLowerCase().includes(kw.toLowerCase())) signals.push({ kind: 'precise', match: kw });
  }
  // broad 신호: "기본 / 포괄적 / 등등 / 다양한 / 전체 / 기본적인 / etc / overall"
  const broadKws = ['기본', '포괄적', '등등', '다양한', '전체', '기본적인', 'etc', 'overall', '필요한', '관련', 'comprehensive', 'including'];
  for (const kw of broadKws) {
    if (text.toLowerCase().includes(kw.toLowerCase())) signals.push({ kind: 'broad', match: kw });
  }
  const preciseCount = signals.filter(s => s.kind === 'precise').length;
  const broadCount = signals.filter(s => s.kind === 'broad').length;
  let intent;
  if (preciseCount > broadCount && preciseCount >= 1) intent = 'precise';
  else if (broadCount >= 1) intent = 'broad';
  else intent = 'default';
  return { intent, signals, preciseCount, broadCount };
}

// 1.9.326 (UR-0025): 순수 문자열/셸/env 유틸.
// 코드펜스(```) 중립화 — 임베딩 텍스트가 외부 마크다운을 깨지 않게. (``` → ''', 인라인 백틱 보존)
function _sanitizeFences(s) { return String(s || '').replace(/```+/g, "'''"); }
// shell:true spawn 인자 셸-안전 인용 — POSIX(sh) single-quote / Windows(cmd) double-quote + inner " 이스케이프.
function _shellQuoteArg(s) {
  s = String(s == null ? '' : s);
  if (process.platform === 'win32') return '"' + s.replace(/"/g, '""') + '"';
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
// Windows PowerShell 실행 env 감지 — pwsh 6/7 신뢰 마커(POWERSHELL_DISTRIBUTION_CHANNEL / pwsh 전용 경로)만 판별(ps5.1 자동판별 안 함).
function _detectPwshFromEnv(e) {
  e = e || process.env;
  const channel = e.POWERSHELL_DISTRIBUTION_CHANNEL || '';
  const pmp = e.PSModulePath || '';
  if (channel || /[\\/]PowerShell[\\/][67][\\/]/i.test(pmp) || /Documents[\\/]+PowerShell[\\/]/i.test(pmp)) {
    return { isPowerShell: true, version: '7', edition: 'Core' };
  }
  return { isPowerShell: false, version: null, edition: null };
}

// 1.9.327 (UR-0025): 순수 TZ/날짜 포맷 — ISO UTC 저장 유지, 표시 시 local 변환 (env LEERNESS_TZ / 시스템 tz / Asia/Seoul fallback).
function _getLocalTz() {
  if (process.env.LEERNESS_TZ) return process.env.LEERNESS_TZ;
  try {
    const sys = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (sys && sys !== 'UTC') return sys;
  } catch {}
  return 'Asia/Seoul';
}
function _formatLocal(iso, opts) {
  if (!iso) return '?';
  opts = opts || {};
  const tz = opts.tz || _getLocalTz();
  try {
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    if (isNaN(d.getTime())) return String(iso);
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false
    });
    const parts = fmt.formatToParts(d);
    const get = (t) => (parts.find(p => p.type === t) || {}).value || '';
    const date = `${get('year')}-${get('month')}-${get('day')}`;
    const time = `${get('hour')}:${get('minute')}`;
    const tzShort = tz === 'Asia/Seoul' ? 'KST' : tz === 'Asia/Tokyo' ? 'JST' : tz === 'UTC' ? 'UTC' : tz.split('/').pop().slice(0, 3);
    return opts.dateOnly ? date : `${date} ${time} ${tzShort}`;
  } catch { return String(iso); }
}

// 1.9.328 (UR-0025): 순수 문자열 유틸 — 절단(말줄임표) / 콤마 리스트 분할.
function _truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function _splitList(v) { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }

// 1.9.329 (UR-0025): 순수 roadmap MD 파서 — 상태 정규화 / 마일스톤·토큰 추출 (fs 의존 0).
function _roadmapMapStatus(s) {
  s = String(s || '').toLowerCase();
  if (s === 'done' || s === 'in-progress' || s === 'on-hold' || s === 'waiting' || s === 'incomplete' || s === 'blocked' || s === 'dropped') return s;
  if (s === 'planned' || s === 'requested') return 'planned';
  return 'planned';
}
function _roadmapParseMilestones(text) {
  const s = String(text || '');
  const out = [];
  // 1.9.352 (UR-0068 외부리뷰): 다음 milestone 직전까지 block 한정 — 이전 구현은 slice(m.index) 로 다음 milestone 의 Status/Progress 를 누출했음
  const matches = [...s.matchAll(/^### (M-\d{4,})\.[ \t]*(.+?)$/gm)];  // 17th 버그헌트 P2: \s* 가 개행 흡수해 빈 제목 milestone 이 다음 줄(Status:)을 제목으로 먹던 것 차단
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].index : s.length;
    const block = s.slice(m.index, end);
    const sm = block.match(/^Status:\s*(\S+)/m);
    const pm = block.match(/^Progress:\s*(\d+)%/m);
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
    if (!key || !val || key === 'Token' || /^-+$/.test(key) || val === 'Value' || /\(실제 값으로 업데이트\)|\(update with real value\)/i.test(val)) continue;   // 1.36.61: en placeholder 병기
    if (val.length > 80) continue;
    tokens[key] = val;
  }
  return tokens;
}

// 1.9.330 (UR-0025): project-brief 필드 config(순수 데이터) + 채움 카운트 derivation.
const _BRIEF_FIELDS = [
  { key: 'intro', h: 'Intro', label: '소개', flag: 'intro', multi: false },
  { key: 'purpose', h: 'Purpose', label: '목적', flag: 'purpose', multi: false },
  { key: 'problem', h: 'Problem', label: '해결 문제', flag: 'problem', multi: false },
  { key: 'features', h: 'Features', label: '핵심 기능', flag: 'features', multi: true },
  { key: 'stack', h: 'Tech Stack', label: '기술 스택', flag: 'stack', multi: true },
  { key: 'architecture', h: 'Architecture', label: '아키텍처', flag: 'architecture', multi: false },
  { key: 'users', h: 'Users', label: '사용자', flag: 'users', multi: true },
  { key: 'success', h: 'Success Criteria', label: '성공 기준', flag: 'success', multi: true },
  { key: 'nonGoals', h: 'Non-Goals', label: '비목표', flag: 'non-goals', multi: true },
  { key: 'currentState', h: 'Current State', label: '현재 상태', flag: 'current-state', multi: false },
];
function _briefFilled(brief) { return _BRIEF_FIELDS.filter(f => (f.multi ? (brief[f.key] && brief[f.key].length) : brief[f.key])).length; }
// 1.9.331 (UR-0025): project-brief 텍스트 빌더 (순수) — README 개요 블록 / 복사용 청사진. VERSION 은 인자로 주입.
const BRIEF_START = '<!-- leerness:project-brief:start -->';
const BRIEF_END = '<!-- leerness:project-brief:end -->';
function _briefReadmeBlock(brief) {
  const L = [BRIEF_START, '## 프로젝트 개요', ''];
  if (brief.intro) L.push(brief.intro, '');
  if (brief.purpose) L.push(`**목적**: ${brief.purpose}`, '');
  if (brief.problem) L.push(`**해결 문제**: ${brief.problem}`, '');
  if (brief.features && brief.features.length) { L.push('**핵심 기능**'); brief.features.forEach(x => L.push(`- ${x}`)); L.push(''); }
  if (brief.stack && brief.stack.length) L.push(`**기술 스택**: ${brief.stack.join(', ')}`, '');
  if (brief.directionHistory && brief.directionHistory.length) { L.push('**최근 개발 방향 변경**'); brief.directionHistory.slice(-3).forEach(x => L.push(`- ${x}`)); L.push(''); }
  if (_briefFilled(brief) === 0) L.push('_아직 개요 미입력 — `leerness brief set --intro "..." --purpose "..."` 로 작성._', '');
  L.push('<sub>이 섹션은 `leerness brief` 로 관리됩니다. 전체 청사진(복사용): `leerness brief export`.</sub>', BRIEF_END);
  return L.join('\n');
}
function _briefBlueprint(brief, version) {
  const L = [`# ${brief.project} — 프로젝트 청사진 (Blueprint)`,
    `> 이 문서만으로 프로젝트를 기초부터 재구성할 수 있도록 작성. \`leerness brief export\` 생성 (leerness v${version || '?'}).`, ''];
  const sec = (h, v, multi) => { if (multi ? (v && v.length) : v) { L.push(`## ${h}`, multi ? v.map(x => `- ${x}`).join('\n') : v, ''); } };
  sec('소개 (Intro)', brief.intro); sec('목적 (Purpose)', brief.purpose); sec('해결 문제 (Problem)', brief.problem);
  sec('핵심 기능 (Features)', brief.features, true); sec('기술 스택 (Tech Stack)', brief.stack, true);
  sec('아키텍처 (Architecture)', brief.architecture); sec('사용자 (Users)', brief.users, true);
  sec('성공 기준 (Success Criteria)', brief.success, true); sec('비목표 (Non-Goals)', brief.nonGoals, true);
  sec('현재 상태 (Current State)', brief.currentState);
  sec('개발 방향 이력 (Direction History)', brief.directionHistory, true);
  L.push('---', '## 신규 프로젝트 시작 가이드', '', '1. 위 소개·목적·기능·아키텍처·스택을 신규 레포의 계획으로 복사.', '2. `leerness init .` 후 이 파일을 `.harness/project-brief.md` 로 복사하거나 `leerness brief set` 으로 재입력.', '3. Features 를 `leerness plan add` / `leerness task add` 로 분해.', '');
  return L.join('\n');
}

// 1.36.85: 블록 분할 + **정확한 오프셋**. brainstorm 계열이 줄번호를 `text.indexOf(block)` 으로 구했는데,
//   내용이 같은 블록이 둘 이상이면 항상 **첫 번째** 위치를 돌려줘 서로 다른 항목이 같은 줄번호로 보고됐다
//   (실측: 3행·9행의 동일 lesson 블록이 둘 다 line=3). 순회하며 누적한 오프셋은 그 오류가 없다.
//   sep 은 `/\n(?=…)/` 형태의 lookahead 분할을 전제한다 — 조각들은 '\n' 로 다시 이어붙으면 원문이 되므로
//   각 조각의 시작 = 앞 조각들의 길이 합 + (제거된 개행 수). 다른 형태의 sep 에는 쓰지 말 것.
//   (검수 1.36.85 M4) `line` 도 **순회 중 누적**한다 — 블록마다 처음부터 slice+split 로 재스캔하면 O(n²) 라
//   대량 파일에서 사실상 멈춘다(실측: lesson 40k건 ≈ 62s). 누적은 O(n).
function _blocksWithOffset(text, sep) {
  const out = [];
  let pos = 0, line = 1;
  for (const block of String(text || '').split(sep)) {
    out.push({ block, offset: pos, line });
    // 이 조각이 소비한 줄 수 + 분할에서 사라진 '\n' 1줄
    line += (block.match(/\n/g) || []).length + 1;
    pos += block.length + 1;
  }
  return out;
}
// 오프셋 → 1-기반 줄번호.
function _lineOfOffset(text, offset) {
  if (!(offset >= 0)) return 0;
  return String(text || '').slice(0, offset).split('\n').length;
}

// 1.9.332 (UR-0025): 순수 lessons.md 파서 — 블록(### 날짜)→엔트리 {date, text, tag}. 필터는 호출측.
function _parseLessonEntries(text) {
  const out = [];
  for (const block of String(text || '').split(/\n(?=### )/)) {
    if (!block.startsWith('### ')) continue;
    const dateMatch = block.match(/^### (\d{4}-\d{2}-\d{2}[^\n]*)/);
    const lessonMatch = block.match(/- Lesson:[ \t]*(.+)/);
    const tagMatch = block.match(/- Tag:[ \t]*(.+)/);
    if (!lessonMatch) continue;
    out.push({ date: dateMatch ? dateMatch[1].trim() : null, text: lessonMatch[1].trim(), tag: tagMatch ? tagMatch[1].trim() : null });
  }
  return out;
}

// UR-0058: canonical lessons 객체 배열 → lessons.md projection. _parseLessonEntries 와 round-trip 안전.
function _renderLessonsMd(lessons) {
  const preamble = '# Lessons (1.9.112)\n\n과거 실수/통찰/패턴 영구 기록 — handoff 자동 회수와 통합.\n';
  const body = (lessons || []).map(l =>
    // 1.9.402 (UR-0108): text/tag 개행 → 공백(MD projection 라인 위조 차단). canonical JSON 은 raw 유지.
    `\n### ${_lineSafe(l.date)}\n- Lesson: ${_lineSafe(l.text)}\n${l.tag ? `- Tag: ${_lineSafe(l.tag)}\n` : ''}`
  ).join('');
  return preamble + body;
}

// 1.9.341 (UR-0025 심층): 내장 스킬 catalog → _source:'builtin' 부여 맵 (skillpack fallback 순수 변환).
function _withBuiltinSource(catalog) {
  const out = {};
  for (const [k, v] of Object.entries(catalog || {})) out[k] = { ...v, _source: 'builtin' };
  return out;
}

// 1.9.345 (UR-0025 심층): HTML escape (roadmap.html 등 출력 인젝션 방지) — 순수, null-safe.
function _esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 1.9.346 (UR-0025 심층): roadmap.html :root CSS 변수 빌더 — designTokens/cssVariables 주입, 순수(모듈 의존 0).
function _roadmapTokenStyles(designTokens, cssVariables) {
  const dt = designTokens || {}, cv = cssVariables || {};
  const vars = {};
  const map = [
    ['color.primary', 'color-primary', 'lr-primary'], ['color.surface', 'color-surface', 'lr-surface'],
    ['color.text', 'color-text', 'lr-text'], ['color.muted', 'color-muted', 'lr-muted'],
    ['space.1', 'space-1', 'lr-space-1'], ['space.2', 'space-2', 'lr-space-2'],
    ['space.3', 'space-3', 'lr-space-3'], ['space.4', 'space-4', 'lr-space-4'],
    ['radius', 'radius', 'lr-radius']
  ];
  for (const [ds, css, vn] of map) { const v = cv[css] || dt[ds]; if (v) vars[vn] = v; }
  for (const [k, v] of Object.entries(cv)) if (!vars[`lr-${k}`]) vars[`lr-${k}`] = v;
  if (!vars['lr-card-bg']) vars['lr-card-bg'] = vars['lr-surface'] || '#ffffff';
  if (!vars['lr-edge']) vars['lr-edge'] = vars['lr-muted'] || '#cbd5e1';
  if (!vars['lr-page-bg']) vars['lr-page-bg'] = '#f8fafc';
  // 1.9.350 (UR-0060/0061 외부리뷰): CSS 값 살균 — whitelist 로 } < > ; { @ : / 등 제거(:root 규칙 breakout + </style> HTML 탈출 차단). 색상/길이 형식은 보존.
  const _safeCss = v => String(v == null ? '' : v).replace(/[^#a-zA-Z0-9(),.%\s_-]/g, '').slice(0, 80);
  return ':root {\n' + Object.entries(vars).map(([k, v]) => `    --${k}: ${_safeCss(v)};`).join('\n') + '\n  }';
}

// 1.9.347 (UR-0025 심층): SKILL.md frontmatter 파서 — { meta, body }, BOM-aware (Windows Notepad 호환). 순수.
function _parseSkillMd(text) {
  // 1.9.408 (8번째 버그헌트, UR-0112): BOM strip + CRLF/CR→LF 정규화.
  //   기존 버그: frontmatter 값 정규식 (.+)$ 의 '.'은 CR(\r)을 매칭 못 해 'name: x\r' 라인이 통째로 실패 → CRLF SKILL.md(Windows/Notepad)의 meta 전체 소실 → skill install "name 필수" 실패.
  const cleaned = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');  // BOM strip (U+FEFF) + 줄바꿈 정규화
  const m = cleaned.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: cleaned };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const km = line.match(/^([a-zA-Z_-]+):\s*(.+)$/);
    if (km) meta[km[1].trim()] = km[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2] };
}

// 1.36.26 (obra/superpowers P1): SKILL 메타 품질 lint — 순수함수(의존 0), _parseSkillMd 산출(meta, body) 을 받는다.
//   설계 원칙(메모리 교훈 — 게이트 휴리스틱은 false-PASS 로 편향, false-BLOCK 금지):
//   · ERROR = 기계적 판정만(FP 0 이 확실한 것) — 이것만 exit 1 대상.
//   · WARNING = 형태 검사(저FP — displayNameKo 합성 흔적 등). 기본 exit 0, --strict 시에만 승격.
//   · INFO = 주관적 권고(트리거절 부재 등) — 절대 실패 아님.
//   한국어 적응: 트리거절은 ko("~할 때 사용"/"언제 사용")·en("Use when/for") 모두 인정. 3인칭 검사는 한국어(인칭 무표지)에
//   부적용이라 제외. 본문 예산은 CJK 분기 — 공백분리 단어수를 한국어에 쓰면 어절 카운트라 전면 오발(비CJK=단어수, CJK=char).
function _lintSkillMeta(meta, body, opts = {}) {
  const errors = [], warnings = [], infos = [];
  const m = meta || {};
  const b = String(body || '');
  const name = String(m.name || '').trim();
  const desc = String(m.description || '').trim();
  // ERROR — 기계적
  if (!name) errors.push({ code: 'name_missing', msg: 'frontmatter name 필수' });
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) errors.push({ code: 'name_charset', msg: `name 은 소문자/숫자/하이픈만: "${name}"` });
  if (!desc) errors.push({ code: 'description_missing', msg: 'frontmatter description 필수 — 에이전트가 "지금 로드할까"를 판단하는 유일한 신호' });
  else if (desc.length > 1024) errors.push({ code: 'description_too_long', msg: `description ${desc.length}자 > 1024 (트리거 조건만 담을 것)` });
  // WARNING — 저FP 형태
  if (desc && name && desc.toLowerCase() === name.toLowerCase()) warnings.push({ code: 'description_repeats_name', msg: 'description 이 name 반복 — 트리거 조건이 없음' });
  if (desc && desc.length < 40) warnings.push({ code: 'description_too_short', msg: `description ${desc.length}자 < 40 — 표시명 합성 흔적("~스킬" 류)일 가능성` });
  if (desc && /^[^,]+(, [^,]+){2,}$/.test(desc) && !/(사용|때|Use when|use this)/i.test(desc)) warnings.push({ code: 'description_capability_list', msg: 'description 이 capabilities 나열 형태 — 트리거 조건으로 재작성 권장' });
  // INFO — 주관적(절대 실패 아님)
  const hasTrigger = /Use (when|this when|for)\b/i.test(desc) || /(할|일|하는|이런)\s*(때|경우)에?\s*사용|언제\s*사용|때\s*사용/.test(desc);
  if (desc && !hasTrigger) infos.push({ code: 'no_trigger_clause', msg: '트리거절 없음 — "~할 때 사용" / "Use when …" 형태 권장' });
  // 본문 예산 — CJK 분기 (Hangul/한자/가나 비율 30%+ 면 CJK 로 판단; 문자 기반)
  const cjkChars = (b.match(/[ㄱ-힝一-鿿぀-ヿ]/g) || []).length;
  const totalChars = b.replace(/\s/g, '').length;
  const isCjk = totalChars > 0 && cjkChars / totalChars >= 0.3;
  const wordCount = b.split(/\s+/).filter(Boolean).length;
  const charCount = b.length;
  if (isCjk) { if (charCount > 12000) infos.push({ code: 'body_budget', msg: `본문 ${charCount}자 (CJK 기준 12000자 초과) — 자주 로드되는 스킬이면 분할 권장` }); }
  else if (wordCount > 5000) infos.push({ code: 'body_budget', msg: `본문 ${wordCount}단어 (5000 초과) — 분할 권장` });
  return { errors, warnings, infos, wordCount, charCount, lang: isCjk ? 'cjk' : 'latin' };
}

// 1.9.333 (UR-0025 심층): 순수 플랫폼 제약 매칭 — catalog + 텍스트 → 매칭 플랫폼/제약/제안 (fs 의존 0, catalog 주입).
// 1.31.2 (UR-0010): optional lang ('en') → 영어 suggestion. 기본 'ko' (무회귀, selftest 2-arg 호출 보존).
function _matchConstraints(catalog, text, lang) {
  if (!text || typeof text !== 'string' || !catalog || !catalog.platforms) return { matched: [], suggestions: [] };
  const lower = text.toLowerCase();
  const matched = [];
  for (const [pid, plat] of Object.entries(catalog.platforms)) {
    const aliases = plat.aliases || [];
    const hit = aliases.find(a => lower.includes(a.toLowerCase()));
    if (hit) matched.push({ platform: pid, matchedAlias: hit, docs: plat.docs, constraints: plat.constraints });
  }
  const suggestions = [];
  const generic = /\bapi\b|연동|integration|호출|rate|limit|quota|webhook/i.test(text);
  if (generic && matched.length === 0) {
    suggestions.push(lang === 'en'
      ? 'generic API-integration keywords detected — run leerness constraints list to review the pre-registered platform catalog'
      : '일반적 API 연동 키워드 감지 — leerness constraints list 로 사전 등록된 플랫폼 catalog 확인 권장');
  }
  return { matched, suggestions, totalPlatforms: Object.keys(catalog.platforms).length };
}

// 1.36.28 (codex 미검토표면 헌트 #10): alias 매칭 — 순수 ASCII 단어 alias 는 단어경계를 요구해
//   'rest'→'restore', 'cli'→'client' 같은 부분문자열 오탐을 막는다. 구두점/CJK alias 는 경계 개념이 없어 substring 유지.
function _aliasHit(lowerText, alias) {
  const a = String(alias || '').toLowerCase();
  if (!a) return false;
  if (/^[a-z0-9]+$/.test(a)) return new RegExp('(?:^|[^a-z0-9])' + a + '(?![a-z0-9])').test(lowerText);
  return lowerText.includes(a);
}

// 1.9.333 패턴 적용: 순수 도메인 매칭 — catalog + 텍스트 → 첫 매칭 domain/alias/components (fs 의존 0, catalog 주입).
function _matchDomain(catalog, text) {
  if (!text || typeof text !== 'string' || !catalog || !catalog.domains) return { domain: null, alias: null };
  const lower = text.toLowerCase();
  for (const [domain, info] of Object.entries(catalog.domains)) {
    for (const a of info.aliases || []) {
      if (_aliasHit(lower, a)) {
        return { domain, alias: a, components: info.components };
      }
    }
  }
  return { domain: null, alias: null };
}

// 1.9.335 (UR-0025 심층): LSP 서브시스템 — 순수 언어 감지 (파일 확장자 → 언어)
function _detectLspLang(file) {
  const ext = ((file || '').match(/\.[a-zA-Z0-9]+$/) || [''])[0].toLowerCase();
  if (/^\.(py|pyw|pyi)$/.test(ext)) return 'python';
  if (ext === '.go') return 'go';
  if (ext === '.rs') return 'rust';
  if (/^\.(java|kt|scala)$/.test(ext)) return 'java';
  if (/^\.(ts|tsx|js|jsx|mjs|cjs)$/.test(ext)) return 'javascript';
  return 'javascript';  // default — 기본 JS 패턴 (.txt/.md 등 미지원 확장자)
}

// 1.9.335 (UR-0025 심층): LSP 서브시스템 — 순수 정규식 심볼 매처 (catalog 주입, constraints/domain 패턴 동일)
// catalog: { <lang>: [{ re, kind }, ...] } · content: 소스 텍스트 · lang: 언어 키
function _matchLspSymbols(catalog, content, lang) {
  const symbols = [];
  if (!catalog || typeof content !== 'string') return symbols;
  const lines = content.split(/\r?\n/);
  const patterns = catalog[lang || 'javascript'] || catalog.javascript || [];
  lines.forEach((line, idx) => {
    for (const p of patterns) {
      const m = line.match(p.re);
      // 키워드 false-positive 제거 (예: java method 정규식이 if(/for( 등에 매치되는 경우)
      if (m && !/^(if|for|while|switch|catch|return|throw|new)$/.test(m[1])) {
        symbols.push({ name: m[1], kind: p.kind, line: idx + 1 });
        break;
      }
    }
  });
  return symbols;
}

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

function _detectOptimism(patterns, evidence, codeText) {
  // 각 패턴 검사: evidence에 주장 있고 코드에 흔적 없으면 의심
  const suspects = [];
  if (!Array.isArray(patterns)) return suspects;
  for (const p of patterns) {
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
function _computeConfidence(patterns, evidence, codeText) {
  if (!Array.isArray(patterns)) return 1.0;
  const suspects = _detectOptimism(patterns, evidence, codeText);
  const high = suspects.filter(s => s.severity === 'high').length;
  const medium = suspects.filter(s => s.severity === 'medium').length;
  // 가중치: high 1.0 / medium 0.5
  const totalPenalty = high * 1.0 + medium * 0.5;
  // 패턴 검사로 발견된 evidence 주장이 많을수록 신뢰도 산정 base 변경
  const evidenceClaims = patterns.filter(p => p.evidenceRe.test(evidence)).length + _extractUrlClaims(evidence).length;
  if (evidenceClaims === 0) return 1.0; // 외부 작용 주장 자체가 없으면 신뢰 1.0
  let confidence = Math.max(0, 1 - totalPenalty / evidenceClaims);
  // 1.9.28: single high suspect에서 confidence 0.0이 일률적 → severity 기반 floor 적용
  if (suspects.length > 0 && high > 0 && confidence < 0.15) {
    // 의심 발견은 명확하지만 0보다는 명시적 신호로
    confidence = 0.15;
  }
  return Math.round(confidence * 100) / 100;
}

// 1.9.337 (UR-0025 심층): persona catalog → 요약 목록 (id/name/description) 순수 변환 (list 명령 JSON 경로)
function _personaSummaries(catalog) {
  return Object.values(catalog || {}).map(p => ({ id: p.id, name: p.name, description: p.description }));
}

// 1.9.338 (UR-0025 심층): i18n 순수 조회 — strings catalog 주입, key → lang 값 (fallback: ko → key 자체)
function _translate(strings, key, lang) {
  const entry = strings && strings[key];
  if (!entry) return key;
  return entry[lang || 'ko'] || entry.ko || key;
}

// 1.9.339 (UR-0053): decision MD 블록(문자열) → 정규 객체 (canonical 스키마). list/load 단일 파서.
function _parseDecisionBlock(block) {
  const titleMatch = String(block || '').match(/^### (.+)$/m);
  const titleLine = titleMatch ? titleMatch[1].trim() : '';
  const dateTitle = titleLine.match(/^(\d{4}-\d{2}-\d{2})\s*—\s*(.+)$/);
  const g = re => { const m = String(block || '').match(re); const v = m ? m[1].trim() : null; return v || null; };  // 빈 값 → null 정규화 (render↔parse round-trip 멱등)
  return {
    date: dateTitle ? dateTitle[1] : null,
    title: dateTitle ? dateTitle[2].trim() : titleLine,
    decision: g(/- Decision:[ \t]*(.+)/),
    reason: g(/- Reason:[ \t]*(.+)/),
    alternatives: g(/- Alternatives:[ \t]*(.+)/),
    impact: g(/- Impact:[ \t]*(.+)/)
  };
}

// 1.9.339 (UR-0053): decisions.md 본문 → canonical 객체 배열 (template/code 블록 제외, title 있는 것만).
function _decisionsFromMd(text) {
  return _extractDecisionBlocks(text).map(_parseDecisionBlock).filter(d => d.title);
}

// 1.9.339 (UR-0053): canonical 객체 배열 → decisions.md projection (init template preamble 보존, round-trip 안전).
function _renderDecisionsMd(decisions) {
  // preamble 의 코드펜스(```)는 single-quote 문자열로 안전 처리 (template literal 충돌 회피)
  const preamble = '# Decisions\n\n## Template (예시 — 실제 결정은 아래 코드블록 밖에 추가)\n\n'
    + '```md\n### YYYY-MM-DD — Decision 제목\n- Decision:\n- Reason:\n- Alternatives:\n- Impact:\n```\n';
  const body = (decisions || []).map(d => {
    // 1.9.402 (UR-0108): 필드 개행 → 공백(MD projection '### '/'- field:' 라인 위조 블록 주입 차단). canonical JSON 은 raw 유지.
    const head = d.date ? `${_lineSafe(d.date)} — ${_lineSafe(d.title)}` : _lineSafe(d.title);
    return `\n### ${head}\n- Decision: ${_lineSafe(d.decision || '')}\n- Reason: ${_lineSafe(d.reason || '')}\n- Alternatives: ${_lineSafe(d.alternatives || '')}\n- Impact: ${_lineSafe(d.impact || '')}\n`;
  }).join('');
  return preamble + body;
}

// 1.9.365 (외부리뷰 CV-6/UR-0081): 시크릿 스캐너 오탐(FP) 억제 — 명백한 placeholder/예시 값은 시크릿 아님.
//   assignment 패턴(secret/api_key = VALUE)의 VALUE 에만 적용 (provider 형식 키엔 미적용 → FN 방지).
function _isPlaceholderSecret(value) {
  if (value == null) return true;
  let v = String(value).trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
  if (!v) return true;
  // 전체가 placeholder 토큰
  // 1.26.1 (13번째 외부리뷰 P2): DB URI 등 placeholder 자격증명(user:password / root:root / yourpassword …) 추가 — 전체-값 정확 일치만 매칭하므로 실키(길고 고엔트로피)에는 FN 영향 0.
  // 1.35.14 (codex 헌트 FP #1): postgres/guest/mysql/mongodb/redis 등 로컬-개발 기본 자격증명 추가 — docker-compose 의 postgres://postgres:postgres@ / amqp://guest:guest@ 오탐(빌드 파손) 차단. root/admin 과 동일 성격(정확-일치만이라 실키 FN 0).
  if (/^(?:x{3,}|\*{3,}|\.{3,}|-+|0+|1234567890?|12345678|abc123|secret|password|passwd|pass|changeme|change[-_]me|changeit|replace[-_]?me|placeholder|example|examples?|sample|dummy|test|testing|foo|bar|baz|tbd|todo|none|null|undefined|nil|empty|redacted|hidden|value|string|here|root|admin|user|username|yourpassword|your[-_]?password|mypassword|postgres|postgresql|guest|mysql|mongodb|mongo|redis)$/.test(v)) return true;
  // 1.9.405 (8번째 버그헌트 회귀수정, UR-0109): placeholder 단어 신호를 entropy 가드보다 먼저 검사.
  //   1.9.401 회귀: 긴 서술형 placeholder('your-super-secret-api-key-example-value')가 고엔트로피(영숫자24+ & 고유12+)를 넘어 실키로 오탐(FP).
  //   → placeholder 마커 단어가 있으면 entropy 가드 무시하고 placeholder 로 판정. 실키 prefix(sk-/AKIA 등)는 마커보다 우선(FN 방지).
  const alnum = v.replace(/[^a-z0-9]/g, '');
  const distinct = new Set(alnum).size;
  const hasMarker = v.includes('example') || v.includes('placeholder') || v.includes('change-me') || v.includes('changeme') || v.includes('replace-me') || v.includes('your-') || v.includes('your_') || v.includes('my-secret') || v.includes('xxxx') || v.includes('<') || v.includes('${') || v.includes('{{');
  const hasRealPrefix = /^(?:sk-|sk-proj-|pk_|rk_|akia|ghp_|gho_|ghs_|ghr_|github_pat_|xox[baprs]-|aiza|ya29\.|glpat-|-----begin)/.test(v);
  // 1.9.436 (11th 외부평가 Opus P3): prefix 가 있어도 본문이 동일문자 8+연속(AKIAXXXX…/…00000000…)이면 명백한 더미 → placeholder. 실키는 고엔트로피라 무영향.
  if (/(.)\1{7,}/.test(alnum)) return true;
  // 1.10.1 (12th 외부평가 Opus P3, UR-0144): 'example' 로 끝나면(접미사) placeholder — AWS 공식 예제키 AKIAIOSFODNN7EXAMPLE 등.
  //   중간에 'example' 이 있는 실키(sk-EXAMPLEab12…, sk-proj-realKEYexample…)는 접미사 아니라 미해당 → 기존 FN 정책(UR-0105) 보존. 실키는 'example' 로 끝날 확률 0.
  if (/example$/.test(v)) return true;
  // 실키 prefix → 항상 실키(마커 무시). 그 외 마커 단어 있으면 placeholder(고엔트로피여도). prefix 없고 마커 없고 고엔트로피 → 실키.
  if (hasRealPrefix) return false;
  if (hasMarker) return true;
  if (alnum.length >= 24 && distinct >= 12) return false;  // prefix·마커 없는 고엔트로피 = 실키
  // 1.34.2 (dogfood #177): 'test' 토큰('test-…'/'…-test'/'…-tests'/'TEST_…')을 가진 저엔트로피 비-실키 값은 테스트 픽스처 → placeholder.
  //   여기 도달 = 실키 prefix 아님 + 고엔트로피 아님(둘 다 위에서 이미 return) → AKIA/ghp_/고엔트로피 실키엔 절대 도달 X (FN-safe).
  //   'test-webhook-secret-123' / 'webhook-secret-for-tests' 류 FP 억제. leerness-gate product dogfood 에서 발견.
  if (/(?:^|[-_])test(?:s|ing)?(?:[-_]|$)/.test(v)) return true;
  return false;
}
// 1.9.365 (외부리뷰 CV-6/UR-0081): unquoted assignment 값이 '시크릿스러운지' 판정 — 코드 식별자 오탐 억제용.
//   숫자 포함 8+ 또는 24+ 만 시크릿 후보 (camelCase 식별자 같은 무-숫자 단어는 제외).
function _looksSecretLike(value) {
  const v = String(value || '');
  if (!v) return false;
  return (/\d/.test(v) && v.length >= 8) || v.length >= 24;
}

// 1.9.367 (UR-0025): 라인 머지 순수 코어 — 기존 텍스트에 없는 라인만 append (substring 중복 방지). mergeLinesFile 의 I/O 분리.
function _mergeLines(currentText, lines) {
  // 1.36.65 (검수 HIGH 파생, 선재 버그): substring 포함 검사는 '.env' 가 '.env.local' 에 흡수돼 영영 미복구 —
  //   정확한 라인 단위 존재 검사로 교체.
  let next = currentText || '';
  const have = new Set(next.split(/\r?\n/).map(l => l.trim()).filter(Boolean));
  for (const line of (lines || [])) {
    const t = String(line).trim();
    if (t && have.has(t)) continue;
    next += (next.endsWith('\n') || !next ? '' : '\n') + line + '\n';
    if (t) have.add(t);
  }
  return next;
}
// 1.9.367 (UR-0025): .env key-aware 머지 순수 코어 — 기존 KEY 값 보존(덮어쓰기 X), 신규 KEY/주석만 append. mergeEnvFile 의 I/O 분리.
function _mergeEnvLines(currentText, lines) {
  const current = currentText || '';
  const existingKeys = new Set();
  for (const ln of current.split(/\r?\n/)) { const m = ln.match(/^\s*([A-Z][A-Z0-9_]+)\s*=/); if (m) existingKeys.add(m[1]); }
  let next = current;
  for (const line of (lines || [])) {
    const km = line.match(/^\s*([A-Z][A-Z0-9_]+)\s*=/);
    if (km) { if (existingKeys.has(km[1])) continue; next += (next.endsWith('\n') || !next ? '' : '\n') + line + '\n'; existingKeys.add(km[1]); }
    else { if (!next.includes(line)) next += (next.endsWith('\n') || !next ? '' : '\n') + line + '\n'; }
  }
  return next;
}

// 1.9.368 (UR-0025): README 관리섹션 머지 순수 코어 — 마커 사이 교체, 없으면 append. 마커는 인자로 주입(harness 상수 비결합).
function _mergeReadmeSection(existing, block, START, END) {
  // 1.36.63 (검수 #4): 블록 말단 개행을 정규화해 재실행 바이트 멱등 — 종전엔 1차 재init 가 빈 줄 1개를 더했다
  block = String(block).trimEnd();
  if (!existing) return `# Project\n\n${block}\n`;
  const s = existing.indexOf(START); const e = existing.indexOf(END);
  if (s >= 0 && e >= s) return existing.slice(0, s).trimEnd() + '\n\n' + block + '\n' + existing.slice(e + END.length).trimStart();
  return existing.trimEnd() + '\n\n' + block + '\n';
}
// 1.9.368 (UR-0025): 관리 파일 마이그레이션 머지 순수 코어 — 이전 내용을 migration-preserved 블록으로 보존(데이터/인덱스 파일은 overwrite).
//   archiveRel(사전 계산된 표시 경로) + overwriteSet 을 인자로 주입 → path/process/상수 비결합(순수).
// 1.36.112: 이월 블록의 경계는 **쓰는 쪽과 읽는 쪽이 같은 상수**를 봐야 한다.
//   종전엔 이 태그가 _managedMerge 안의 지역 변수라 밖에서 재구현할 수밖에 없었고,
//   그 재구현이 1.36.88→90 에서 판정 불일치를 되살린 것과 같은 형태다(술어를 공유하지 않으면 표면마다 진실이 갈린다).
const PRESERVED_TAG = '<!-- leerness:migration-preserved -->';
function _managedMerge(file, next, previous, archiveRel, overwriteSet, opts = {}) {
  if (!previous || previous.trim() === next.trim()) return next;
  const tag = PRESERVED_TAG;
  if (overwriteSet && overwriteSet.has(String(file).replace(/\\/g, '/'))) return next;
  // 1.36.60 (F-05 2회차, 검수 High): 언어 전환 시 구 언어 canonical 템플릿(altTemplate)의 라인도 차감 —
  //   종전엔 KO→EN 재init 에서 KO 템플릿 전체가 "커스텀"으로 오인돼 Preserved 에 통째 이월됐다.
  //   (검수 2차 High): 차감은 "출현 횟수" 기반 — canonical 1회분만 소비해, 사용자가 의도적으로 템플릿 라인을
  //   복제한 커스텀(2번째 출현)은 생존한다. Set 차감은 그 복제본까지 지웠다.
  const altCounts = new Map();
  for (const l of String(opts.altTemplate || '').split('\n').map(x => x.trim()).filter(Boolean)) altCounts.set(l, (altCounts.get(l) || 0) + 1);
  // 1.36.28 (사용자 보고 — 반복 마이그레이션 데이터 유실): 종전 <details> 중첩 설계는 previous 에 preserved 태그가
  //   있으면 통째로 next 만 반환 → 2번째 마이그레이션부터 사용자가 CLAUDE/AGENTS 에 직접 쓴 커스텀 지시가 조용히
  //   사라졌다(매 버전 AI 마이그레이션 흐름에서 상시 발화). 재설계: 라인-집합 diff 로 "새 템플릿에 없는 라인"만
  //   Preserved 섹션에 평문으로 이월 — 멱등(재실행해도 동일), 중첩 없음, 크기는 커스텀 라인 수에 비례.
  //   편향은 false-PRESERVE(과보존은 무해) 쪽 — false-DROP(유실)이 버그다.
  const nextLines = new Set(next.split('\n').map(l => l.trim()).filter(Boolean));
  const seen = new Set();
  const custom = [];
  for (const raw of previous.split('\n')) {
    const l = raw.trim();
    if (!l || nextLines.has(l)) continue;
    const _ac = altCounts.get(l);
    if (_ac > 0) { altCounts.set(l, _ac - 1); continue; }   // canonical 출현분만 소비 (복제 커스텀 생존)
    // 1.36.60 의 자동생성 이력 필터(`- .*MCP **N 도구` · `- MCP **N` · `- 🏆 마일스톤` · `- 🎉 **N 라운드`)는
    //   1.36.95 에서 **삭제했다**. "사용자 산문이 이 패턴과 겹칠 확률은 무시 가능"이라고 적혀 있었지만
    //   검수가 겹치는 실제 문장으로 삭제를 재현했다:
    //     `- 프로젝트 정책: MCP **3 도구는 별도 승인 후 사용한다` · `- 🏆 마일스톤은 고객 승인 뒤에만 확정한다`
    //   이번 라운드가 템플릿에서 이력 43줄을 지우면서 그 줄들이 처음으로 이 경로를 타게 됐고,
    //   실측에서 설치본 21개의 이력 731줄 중 **346줄이 삭제**됐으며 사용자 문장
    //   `- 사용자 메모: MCP **77 도구** 는 우리 내부 표현이며 삭제 금지` 도 함께 사라졌다.
    //   이 릴리스는 "삭제하지 않는 변경만" 담기로 했으므로 필터를 걷어낸다 — 이력 줄은 Preserved 로 이월된다.
    //   과보존은 이 파일의 계약상 무해하고(false-DROP 이 버그), 기존 설치본 정리는 provenance 라운드로 미룬다.
    // preserved 래퍼 자체의 보일러플레이트는 이월 대상 아님 (구 <details> 형식 + 신 평문 형식 + en 래퍼 모두)
    if (l === tag || l === '---' || l === '<details>' || l === '</details>') continue;
    if (/^```/.test(l) || /^<summary>/.test(l)) continue;
    if (/^## Preserved previous content|^Previous content was backed up|^`[^`]*archive[^`]*`$|^> 이전 버전에서 이어진|^> Custom user\/project content carried over|^> ⚠ \d+ Korean lines were preserved below\. If this project never had Korean customizations.*with certainty\.$/.test(l)) continue;   // (검수 #2) 생성 문장 전체 앵커 — 같은 접두의 사용자 커스텀 라인 오삭제 방지
    if (seen.has(l)) continue;
    seen.add(l);
    custom.push(raw.replace(/\\`\\`\\`/g, '```'));   // 구 형식에서 이스케이프된 펜스 복원
  }
  if (!custom.length) return next;
  // 1.36.122 (자기 저장소 도그푸딩 실측): 새 백업을 만들지 않는 실행(`adapter` 등)이 `archiveRel` 없이 들어오면
  //   이 안내가 **구체 백업 경로를 일반 경로로 덮어썼다** — 보존이 목적인 블록에서의 정보 손실이다.
  //   (우리 repo 에서 `.harness/archive/leerness-1.36.100-2026-08-05T…` → `.harness/archive` 로 격하되는 걸 확인했다.)
  //   이전 문서가 이미 구체 경로를 가리키면 그대로 둔다.
  let ar = archiveRel;
  if (!ar) {
    const _prevAr = /(?:전체 원본 백업|Full original backup):\s*`([^`]+)`/.exec(String(previous || ''));
    ar = (_prevAr && _prevAr[1]) || '.harness/archive';
  }
  // 1.36.60 (검수): 보존 래퍼 문구도 프로젝트 언어를 따른다 — en 프로젝트에 한글 래퍼가 새 한글원을 만들던 것 해소
  let note = opts.lang === 'en'
    ? `> Custom user/project content carried over from the previous version — re-carried automatically on every migration. Full original backup: \`${ar}\``
    : `> 이전 버전에서 이어진 사용자/프로젝트 커스텀 내용 — 마이그레이션마다 자동 이월됩니다. 전체 원본 백업: \`${ar}\``;
  // 1.36.73 (8차 헌트 F9 설계 결정): 초고령 KO canonical(현행 altTemplate 에 없는 구판 템플릿)이 en 프로젝트에
  //   커스텀으로 오인 이월될 수 있다. 자동 차감은 데이터 손실 위험(어느 라인이 템플릿인지 확신 불가 — false-DROP 이 버그)
  //   이라 하지 않고, 한글 비중이 높으면 "검토·정리 안내"를 명시해 조용한 동결만 없앤다.
  if (opts.lang === 'en') {
    const hangulLines = custom.filter(l => /[가-힣]/.test(l)).length;
    if (hangulLines >= 10 && hangulLines > custom.length * 0.5) {
      note += `\n> ⚠ ${hangulLines} Korean lines were preserved below. If this project never had Korean customizations, most of these are likely template text from an old Korean install — review and prune manually (data is also in the backup above). leerness will not auto-delete them: it cannot distinguish old template lines from your own notes with certainty.`;
    }
  }
  // 1.36.105 (P-0015): 여기에 이월 상한(preservedCap)을 넣었다가 **뺐다**.
  //   설계는 "삭제가 아니라 이동" 이었다 — 꼬리(최신)만 남기고 나머지는 위 note 가 가리키는 archive 백업에 맡긴다.
  //   codex 검수가 전제를 깼다: 사용자가 새 지시를 **앞에** 붙이면 그게 최신인데 꼬리 규칙이 그걸 지우고,
  //   재현에서 보관본에도 남지 않았다. 즉 "이동" 이라는 주장이 성립하지 않는 입력이 있다.
  //   이 파일의 계약은 명시적으로 false-DROP 이 버그다(1.36.95 가 패턴 필터로 346줄을 지운 전례도 같은 자리다).
  //   안전을 증명할 수 없는 절감은 싣지 않는다 — 최소 등급의 절감은 AGENTS/CLAUDE/handoff 계층화로 이미 얻는다
  //   (실측 2,800 → 284 tok). 오래된 이월을 줄이는 일은 별도 라운드에서 provenance 를 갖춰 다룬다.
  return next.trimEnd() + `\n\n---\n${tag}\n## Preserved previous content\n\n${note}\n\n` + custom.join('\n') + '\n';
}

// 1.36.112: 위가 쓴 이월 블록을 **되읽는** 짝. `context budget` 이 지침 파일을 관리분/이월분으로 가르는 데 쓴다.
//   왜 필요한가: 이월분은 1.36.95·1.36.105 에서 두 번 "provenance 라운드로 미룬다" 며 남겨졌는데,
//   그동안 **비용을 한 번도 재지 않았다**. 이 함수로 잰 실측(설치본 45개)에서 12개가 이월분을 갖고 합계 10,895 tok,
//   최악(이 저장소)은 지침 파일의 78.0%(6,048 tok)이고, minimal 등급으로 낮춰도 적재 7,242 tok 중 83% 가 그것이다.
//   여기서 하는 일은 **재는 것뿐**이다 — 지우지 않는다. 삭제를 막은 두 번의 판단(false-DROP 이 버그)은 그대로 유효하다.
// 1.36.116 — "존재하지만 아무도 실행하지 않는 가드" 탐지 (순수 코어).
//   왜: 실제 프로젝트(hive-analytics)의 CI 파일이 자기 사고를 이렇게 적어 놨다 —
//   "가드가 여럿 있는데 CI 에 하나도 연결돼 있지 않았다. 배포 전 검수가 세 번 연속 실질 결함을 찾아냈고,
//    그중 여러 건이 '가드는 있는데 아무도 안 돌렸다' 에서 왔다. 사람이 돌려야만 유효한 검사는 결국 안 돌아간다."
//   leerness 는 프로젝트 위생을 감사하는 도구인데 이 클래스를 보지 않았다.
//
//   ⚠ 설계에서 제일 중요한 것은 **오탐 방지**다. 잘 만든 프로젝트는 CI 에 검사 이름을 일일이 적지 않고
//   package.json 을 **동적으로 열거**한다(hive 의 `run-ci-checks.mjs` 가 그렇다). 그걸 못 알아보면
//   가장 모범적인 저장소에서 수십 건 오탐이 나고, 그러면 사용자는 이 경고를 꺼 버린다.
//   그래서 편향은 false-PASS 다: 동적 열거자가 하나라도 보이면 npm 스크립트는 전부 '덮임' 으로 본다.
// 1.36.116 (검수 #3): `guard:*` 가 후보 어휘에 없었다 — 이 기능이 잡으려는 것의 **이름 그 자체**인데
//   `guard:firestore-parity` 같은 스크립트는 후보가 0개라 구조적으로 못 봤다. `validate` 도 접미 위치에 없었다.
const _GUARD_NAME_RE = /^(?:pre|post)?(?:test|check|verify|validate|guard|gate|lint|typecheck|audit|scan|e2e|smoke)\b|[:-](?:test|check|verify|validate|guard|gate|lint|audit|scan|e2e|smoke)\b/i;
// 경로 표기 정규화 — 이 파일 안의 모든 경로 매칭이 같은 규칙을 쓴다(정규화가 갈리면 한쪽만 맞는다).
//   ① backslash → `/` (이스케이프된 `\\` 도 접힌다) ② 반복 `/./` 축약 ③ 중복 `//` 축약.
function _normPath(s) {
  let t = String(s).replace(/\\+/g, '/');
  let prev;
  do { prev = t; t = t.split('/./').join('/'); } while (t !== prev);
  do { prev = t; t = t.split('//').join('/'); } while (t !== prev);
  return t;
}
// 동적 열거자 판정은 **두 신호를 독립적으로** 본다 — 한 파일이 package.json 을 읽고, scripts 를 열거한다.
//   ⚠ 근접 창(예: 400자)을 요구했다가 실측에서 깨졌다: 실제 열거자는 읽기(L42)와 열거(L98)가 56줄 떨어져 있었고,
//   그 결과 가장 잘 만든 프로젝트에서 85건 오탐이 났다. 거리 가정을 쓰지 않는다.
const _READS_PKG_RE = /package\.json/;
const _ENUMS_SCRIPTS_RE = /\b(?:Object\.(?:keys|entries)\s*\(\s*[\w.?\s]*\bscripts\b|for\s*\(\s*const\s+\w+\s+in\s+[\w.]*\bscripts\b)/;
// 열거자가 **무엇을 덮는지**도 뽑는다 — `startsWith("test:")` 처럼 접두를 거르면 그 밖은 안 도는 게 사실이다.
//   1.36.116 (검수 #6): `/^test:/.test(name)` 형태를 못 뽑아 접두가 0개가 되고, 그러면 "전부 덮는다" 로 처리돼
//   같은 파일의 `check:dead` 까지 실행된 것으로 계상됐다(미탐). 정규식 리터럴 + `.test(` 형태를 추가한다.
const _ENUM_PREFIX_RE = /startsWith\s*\(\s*["'`]([\w:.-]+)["'`]\s*\)|\.match\s*\(\s*\/\^([\w:.-]+)|\/\^([\w:.-]+)[^/\n]*\/[a-z]*\s*\.test\s*\(/g;
// 1.36.127 (T-0105/T-0106 실측): `opts.ignoreOwnEntryText` — 패키지 **자신의 진입점**의 텍스트를 배선 근거에서만
//   뺀다(러너 자격·도달성 루트로는 그대로 남긴다). 판정을 바꾸려는 것이 아니라 **무엇이 가려졌는지 재기 위한
//   반사실**이다. 우리 저장소에서 실측: 기본 0건 → 진입점 텍스트 제외 시 `test:core`·`test:smoke` 2건.
//   왜 이 방식인가: "문자열인가 호출인가" 를 가리려면 파서가 필요하고, 이 저장소는 0-deps 로 손수 만든
//   마스커에 이미 한 번 빠졌다(검수 7회 → 되돌림). 그래서 **판정 로직은 손대지 않고** 차이만 보고한다.
function _detectOrphanGuards(input, opts) {
  const _ignoreOwnEntryText = !!(opts && opts.ignoreOwnEntryText);
  const scripts = (input && input.packageScripts) || {};      // { name: body }
  const runners = ((input && input.runners) || [])            // [{ file, text }] — CI 워크플로 등
    .map(r => (_ignoreOwnEntryText && r && r.ownEntry) ? Object.assign({}, r, { text: '' }) : r);
  const scriptFiles = (input && input.scriptFiles) || [];     // ['scripts/check-x.js', ...]
  // ⚠ 관례상 **진입점**인 이름은 대상이 아니다 — `npm test` 는 사람도 CI 도 직접 부르는 표준 동사다.
  //   신규 프로젝트(스크립트 `test` 하나, CI 없음)에서 그걸 "아무도 안 부른다" 고 하면 그건 잡음이고,
  //   잡음은 이 경고를 죽인다. 우리가 잡으려는 것은 **네임스페이스 잎 가드**(`test:foo`·`check-bar`)다 —
  //   그건 누가 모아 주지 않으면 실제로 아무도 안 부른다.
  const ENTRYPOINTS = new Set(['test', 'start', 'build', 'lint', 'typecheck', 'check', 'verify', 'audit', 'e2e', 'prepare', 'prepublishOnly']);
  // npm 생명주기 훅(`preX`/`postX`)은 **npm 자신이 러너**다 — X 가 존재하면 자동으로 돈다.
  //   이걸 고아라고 하면 오탐이고, 오탐이 이 경고를 죽인다(작성 중 `pretest`/`posttest` 로 실제 발생).
  const NPM_LIFECYCLE = new Set(['test', 'start', 'restart', 'stop', 'install', 'publish', 'pack', 'version', 'prepare']);
  const isLifecycleHook = (n) => {
    const m = /^(pre|post)(.+)$/.exec(n);
    if (!m) return false;
    const base = m[2];
    return Object.prototype.hasOwnProperty.call(scripts, base) || NPM_LIFECYCLE.has(base);
  };
  const guardNames = Object.keys(scripts).filter(n => _GUARD_NAME_RE.test(n) && !ENTRYPOINTS.has(n) && !isLifecycleHook(n));

  // ① 동적 열거자와 그것이 덮는 접두
  //   ⚠ 알려진 한계: **문자열 리터럴 안의 코드 모양**도 열거자로 본다. 실제로 이 저장소의 e2e 픽스처가
  //   그렇게 잡혀 leerness 자신의 고아(`test:smoke`)가 가려진 적이 있다(자기참조 함정).
  //   따옴표 구간을 손으로 가려 보려다 **정상 입력에서 짝이 어긋나 더 나빠졌다** — 손으로 만든 JS 마스커는
  //   이 저장소가 이미 한 번 토끼굴에 빠졌던 자리다(1.36.x, 검수 7회). 그래서 마스킹을 쓰지 않는다.
  //   이 오인의 방향은 **과소 보고(false-PASS)** 이고, 그건 이 기능의 의도된 편향이다 —
  //   오탐이 나면 사용자가 경고 자체를 꺼 버리기 때문이다. 대신 픽스처 쪽에서 리터럴을 쪼개 자기참조를 없앤다.
  const dynamicRunners = [];
  const coveredPrefixes = new Set();
  const _scriptNames = Object.keys(scripts);
  // 뽑은 접두를 그대로 믿으면 안 된다 — 큰 소스 파일에서는 `--*`·`_*`·`.*`·`https:*` 같은 것이 수십 개 나오고,
  //   그중 하나만 스크립트 이름에 걸려도 전부가 '덮임' 이 돼 진짜 고아가 사라진다(leerness 자신에서 실측).
  //   접두로 인정하는 조건: **이 패키지의 스크립트 이름에 실제로 붙고**, 이름 전체가 아니며, 너무 짧지 않다.
  //   ⚠ 길이 3 을 요구했다가 `startsWith("ci")` 같은 **정상 열거자**를 통째로 버렸다(검수 P2) — 그러면 그 열거자가
  //   실제로 돌리는 `ci-check`·`ci-guard` 가 고아로 나온다. 진짜 판별자는 길이가 아니라
  //   "이 패키지의 스크립트 이름에 실제로 붙는가" 다. 길이는 1글자만 막는다.
  const _plausible = (p) => !!p && (/[:._-]$/.test(p) || p.length >= 2)
    && _scriptNames.some(n => n !== p && n.startsWith(p));
  // 열거자 판정도 **실제로 도는 러너**에서만 해야 한다. 아무도 안 부르는 스크립트가 참조하는 열거자 파일이
  //   "전부 태운다" 로 잡히면 경고 전체가 꺼진다 — turbo 우회로와 같은 클래스다(검수·자체 헌트 양쪽에서 재현).
  //   liveness 는 도달성에 의존하고 도달성은 열거 범위에 의존하므로, 아래 고정점 반복 안에서 함께 돌린다.
  //   두 집합 모두 **커지기만** 하므로 수렴한다.
  let enumCoversAll = false;
  const _scannedRunners = new Set();
  const _scanEnumerators = (isLiveRunner) => {
    let added = false;
    for (const r of runners) {
      if (_scannedRunners.has(r.file) || !isLiveRunner(r)) continue;
      _scannedRunners.add(r.file);
      const raw = String(r.text || '');
      if (!(_READS_PKG_RE.test(raw) && _ENUMS_SCRIPTS_RE.test(raw))) continue;
      // 접두는 **원문**에서 뽑는다(가린 텍스트에는 문자열이 지워져 있다)
      let m; const re = new RegExp(_ENUM_PREFIX_RE.source, 'g');
      const rawFound = [], valid = [];
      while ((m = re.exec(raw))) { const p = m[1] || m[2] || m[3]; if (p) { rawFound.push(p); if (_plausible(p)) valid.push(p); } }
      // 접두 후보는 많은데 이 패키지의 스크립트와 하나도 안 맞으면, 그건 열거자의 필터가 아니라 남의 코드다 —
      //   "전부 덮는다" 로 올리면 이 경고가 통째로 죽으므로 **열거자로 치지 않는다**.
      if (rawFound.length && !valid.length) continue;
      dynamicRunners.push(r.file);
      for (const p of valid) coveredPrefixes.add(p);
      // 접두를 못 뽑았으면 "전부 덮는다" 로 본다 — 편향은 false-PASS 다(오탐이 이 경고를 죽인다).
      if (!valid.length) enumCoversAll = true;
      added = true;
    }
    return added;
  };

  // ② 이름 언급 — 호출 문법을 파싱하지 않고 **이름이 러너 텍스트에 나오는가**로 본다.
  //   `spawn("npm",["run","test:unit"])` 같은 배열 형태를 문법 파싱으로 잡으려다 실측에서 놓쳤다.
  //   느슨한 쪽(false-PASS)이 옳다 — 산문에 우연히 나와도 '덮임' 으로 보는 편이 오탐보다 낫다.
  const allRunnerText = runners.map(r => String(r.text || '')).join('\n') + '\n'
    + Object.entries(scripts).map(([n, b]) => `${n} ${b}`).join('\n');
  const mentions = (name) => {
    const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\w:.-])${esc}([^\\w:.-]|$)`, 'm').test(allRunnerText);
  };
  const coveredByEnum = (n) => enumCoversAll || [...coveredPrefixes].some(p => n.startsWith(p));
  // **주석 줄의 언급은 실행이 아니다.** 이 저장소에서 실제로 겪었다 — 이 함정을 설명하려고 쓴 주석에
  //   스크립트 이름을 적었더니 그 이름이 '덮임' 으로 처리돼 진짜 고아가 사라졌다(자기참조 3회차).
  //   전면 문자열 마스킹은 앞서 정상 입력에서 깨졌으므로 쓰지 않는다 — 줄 시작이 주석인 줄만 뺀다(저위험).
  //   ⚠ 수집기(lib/audit.js)와 **같은 주석 표기**를 써야 한다 — 1.36.120 에서 수집기에만 CMD 표기(`::`·`@REM`)를
  //   넣고 판정기에 안 넣어서, CMD 주석 줄의 이름이 '호출됨' 으로 계상돼 진짜 고아가 사라졌다(검수 재현).
  //   `--`·`;` 는 여기서도 주석이 아니다(여러 줄 명령의 연속 인자를 지운다).
  const _dropCommentLines = (s) => String(s).split('\n').filter(l => !/^\s*(\/\/|#|\*|::|@?REM\s)/i.test(l)).join('\n');
  const _has = (hay, name) => {
    const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\w:.-])${esc}([^\\w:.-]|$)`, 'm').test(hay);
  };
  const names = Object.keys(scripts);

  // ②-a 우리가 그래프를 볼 수 없는 오케스트레이터가 있으면 **아무것도 보고하지 않는다**.
  //   turbo/nx/lerna 는 배선이 자기 설정 파일(turbo.json 의 dependsOn 등)에 있어서 스크립트 본문만 봐선 안 보인다.
  //   못 보는 배선을 "없는 배선" 이라고 하면 정상 저장소에서 대량 오탐이 나고, 그러면 사용자는 이 경고를 끈다.
  //   ⚠ 처음엔 `\b(turbo|nx|lerna)\b` 로 **모든 러너 텍스트**를 봤다가 leerness 자신에서 오발화했다:
  //   수집기가 27k 줄짜리 `bin/leerness.js` 도 러너로 담는데 거기 어딘가에 `nx` 가 있어서 판정이 통째로 보류되고
  //   진짜 고아(`test:smoke`)가 사라졌다. 짧은 단어를 큰 텍스트에 대면 반드시 걸린다 —
  //   **호출 형태**를 요구하고, 러너는 CI 설정 파일로 한정한다.
  const _ORCH_RE = /(?:^|[\s"'`&|;(])(?:npx\s+|pnpm\s+|yarn\s+)?(?:turbo|nx|lerna)\s+(?:run|affected|exec|watch)\b/;
  const _isConfigRunner = (f) => /(?:\.ya?ml|Makefile|makefile|GNUmakefile|Jenkinsfile|justfile)$|\.husky\//.test(String(f || ''));

  // ②-b **러너 루트에서의 도달성**으로 판정한다. 이전 구현은 "이름이 어디든 나오면 덮임" 이었고,
  //   그건 양방향으로 틀렸다(검수 재현 2건):
  //     · 오탐 — `"test":"npm-run-all test:*"` 는 glob 이라 `test:unit` 이라는 문자열이 어디에도 없다 → 정상 배선이 고아.
  //     · 미탐 — 아무도 안 부르는 `dead-wrapper` 가 `npm run check:schema` 를 적어 두면 leaf 가 '덮임'.
  //       고아끼리 순환(`check:a ⇄ check:b`)이면 둘 다 덮임이 된다.
  //   그래서 간선(스크립트→스크립트)을 만들고 루트에서 BFS 한다.
  const edges = new Map();
  for (const [a, bodyRaw] of Object.entries(scripts)) {
    const body = _dropCommentLines(String(bodyRaw || ''));
    const out = new Set();
    for (const b of names) if (b !== a && _has(body, b)) out.add(b);
    // glob 간선 — `npm-run-all test:*` / `run-s "check:*"` 는 이름을 적지 않고 접두로 태운다.
    //   ⚠ 와일드카드가 있다고 다 실행은 아니다(검수 P2): `"test": "echo \"test:*\""` 는 아무것도 안 돌리는데
    //   간선을 만들어 진짜 고아를 숨겼다. **스크립트를 실행하는 문맥**일 때만 glob 을 간선으로 본다.
    if (/\b(?:npm-run-all|run-s|run-p|npm\s+run|yarn\s+run|pnpm\s+run)\b/.test(body)) {
      for (const m of body.matchAll(/([\w:.-]+)\*/g)) {
        for (const b of names) if (b !== a && b.startsWith(m[1])) out.add(b);
      }
    }
    edges.set(a, out);
  }
  // 루트 = ① CI 설정 러너 텍스트에 이름이 나오는 것 ② 관례상 사람이 직접 부르는 진입점 동사
  //        ③ npm 자신이 돌리는 생명주기 스크립트 ④ **도달 가능한** 스크립트가 부르는 러너 파일에 나오는 것
  //   ④ 때문에 루트 집합이 도달성에 의존한다 → 고정점까지 반복한다(검수 P2: 죽은 wrapper 가 참조하는
  //   러너 파일이 잎을 살려 주던 우회로를 닫는다).
  const NPM_SELF_RUN = ['prepare', 'prepack', 'postpack', 'prepublishOnly', 'postinstall', 'preinstall', 'install'];
  const seedRoots = new Set();
  for (const n of names) if (ENTRYPOINTS.has(n)) seedRoots.add(n);
  for (const n of names) if (NPM_SELF_RUN.includes(n) || isLifecycleHook(n)) seedRoots.add(n);
  const reachable = new Set();
  const usedRunners = new Set();
  const roots = new Set(seedRoots);
  const _bfs = () => {
    reachable.clear();
    const queue = [...roots];
    while (queue.length) {
      const n = queue.shift();
      if (reachable.has(n)) continue;
      reachable.add(n);
      for (const b of (edges.get(n) || [])) if (!reachable.has(b)) queue.push(b);
      // npm 생명주기 훅은 base 가 도는 순간 npm 이 같이 돌린다
      for (const p of ['pre' + n, 'post' + n]) if (Object.prototype.hasOwnProperty.call(scripts, p) && !reachable.has(p)) queue.push(p);
    }
  };
  // 출처가 여럿이면 **하나라도 살아 있으면** 그 러너는 실제로 돈다. 하나만 보면 선언 순서가 판정을 바꾼다(실측).
  const _liveRunner = (r) => {
    if (r.unconditional) return true;   // CI 설정이 직접 부르는 파일 — 어떤 스크립트에도 종속되지 않는다
    const via = Array.isArray(r.viaScripts) && r.viaScripts.length ? r.viaScripts : (r.viaScript ? [r.viaScript] : []);
    return via.length === 0 || via.some(n => reachable.has(n) || coveredByEnum(n));
  };
  for (let pass = 0; pass <= runners.length + 2; pass++) {
    _bfs();
    // 열거 범위가 넓어지면 더 많은 스크립트가 live 가 되고, 그러면 더 많은 러너가 유효해진다 — 같은 반복 안에서 돈다.
    let grew = _scanEnumerators(_liveRunner);
    for (const r of runners) {
      if (usedRunners.has(r.file) || !_liveRunner(r)) continue;
      usedRunners.add(r.file);
      // ⚠ 러너 텍스트에 이름이 **나오기만** 하면 루트로 봤더니, 이 저장소의 테스트 파일(scripts/e2e.js)이
      //   러너로 수집되는 탓에 거기 데이터로 적힌 스크립트 이름이 전부 '호출됨' 이 됐다 —
      //   자기 기준값을 단언하려고 이름을 적자마자 그 기준값이 사라졌다(자기참조 6회차).
      //   리터럴을 또 쪼개는 것은 이 함정이 재발할 자리를 남기므로, **호출 문맥이 있는 줄**만 본다.
      //   줄 단위라 거리 가정(예전에 85건 오탐을 낸 근접 창)은 쓰지 않고, `spawn("npm",["run","x"])` 같은
      //   배열 형태도 같은 줄에 `npm` 이 있어 그대로 잡힌다.
      //   ⚠ 줄 필터를 **CI 설정 파일에까지** 걸면 matrix/여러 줄 배선을 놓친다(검수 P2):
      //   `script: [check:a, check:b]` 은 `npm` 이 다른 줄에 있다. CI 설정은 그 자체가 배선이므로 전문을 본다.
      //   줄 필터는 **코드 파일**에만 건다 — 거기서만 이름이 데이터로 등장한다(우리 e2e.js 가 그랬다).
      //   ⚠ CI 설정을 전문으로 보되 **설명용 필드는 뺀다**: `- name: TODO check:leaf 를 붙이자`,
      //   `env: { FOO: check:x }`, artifact 이름 같은 것이 그것만으로 '호출됨' 이 됐다(자체 헌트 + 검수 재현).
      //   ⚠ 한때 **허용 목록**(실행 키만 본다)으로 뒤집었다가 되돌렸다. 그건 정상 배선을 버렸다(검수 재현):
      //   `matrix: { target: [check:leaf] }` + `run: npm run ${{ matrix.target }}` 에서 `target` 은 실행 키가
      //   아니므로 잘려 나가고, 실행 줄에는 이름이 없어 **정상 가드가 고아로 보고**된다. Azure 의 `customCommand:` 도 같다.
      //   이 저장소의 편향은 명시적이다 — **오탐이 이 경고를 죽인다**. 그래서 방향은 과소 보고다:
      //   사람이 읽는 설명 필드만 빼고 나머지는 그대로 본다.
      //   그 대가(측정됨): `env: { TARGET: check:x }`·`key: check:x-hash` 처럼 **데이터 값**에 이름이 있으면
      //   그것을 호출로 보고 진짜 고아를 가린다. 그건 미탐이라 감수한다.
      //   ⚠ `name:` 을 **무조건** 설명으로 보면 matrix 변수명이 `name` 인 정상 배선이 잘려 나간다(검수 재현):
      //   `matrix: { name: [check:leaf] }` + `run: npm run ${{ matrix.name }}`. 값이 **산문일 때만** 설명으로 본다 —
      //   목록(`[...]`)이나 공백 없는 단일 토큰은 데이터일 수 있으므로 남긴다(편향은 과소 보고).
      const _DESCRIPTIVE = /^\s*-?\s*(?:name|description|title|summary|comment|displayName|label)\s*:\s*(.*)$/i;
      const _configLineOk = (l) => {
        const m = _DESCRIPTIVE.exec(l);
        if (!m) return true;
        const v = String(m[1]).trim();
        return !v || v.startsWith('[') || !/\s/.test(v);
      };
      const _raw = _dropCommentLines(String(r.text || ''));
      const t = _isConfigRunner(r.file)
        ? _raw.split('\n').filter(_configLineOk).join('\n')
        : _raw.split('\n').filter(l => /\b(?:npm|npx|yarn|pnpm|make|run|exec)\b/.test(l)).join('\n');
      for (const n of names) if (!roots.has(n) && _has(t, n)) { roots.add(n); grew = true; }
      grew = true;
    }
    if (!grew) break;
  }
  _bfs();
  const isLive = (n) => reachable.has(n) || coveredByEnum(n);
  // 오케스트레이터 판정도 **실행되는 스크립트**에서만 본다 — 죽은 `"note":"echo turbo run test"` 한 줄로
  //   경고 전체를 끌 수 있으면 그건 우회로다(검수 P2).
  //   CI 설정 쪽도 **주석은 빼고** 본다 — "# turbo 로 옮길지 검토중" 한 줄로 경고 전체가 꺼지면 안 된다(검수 P2).
  const unknownOrchestrator = Object.entries(scripts).some(([n, b]) => isLive(n) && _ORCH_RE.test(String(b || '')))
    || runners.some(r => _isConfigRunner(r.file) && _ORCH_RE.test(_dropCommentLines(String(r.text || ''))));
  // 1.36.127 (T-0105 도그푸딩): 잡으려는 것은 **잠든 검사**이지 단축키가 아니다. `test:core` 처럼
  //   자기가 부르는 파일이 **전부 다른 곳에서 이미 도는** 스크립트는, 아무도 그 이름을 부르지 않아도
  //   검사가 잠들지 않는다 — 사람용 별칭일 뿐이다. 그런 것을 "아무도 실행하지 않는 검사" 라 부르면
  //   오탐이고, 오탐이 이 경고를 죽인다. 파일을 하나도 안 부르는 스크립트(인라인 `node -e` 등)는
  //   판단 근거가 없으므로 **면제하지 않는다**(빈 집합 공허참 차단).
  //   ⚠ 알려진 한계(false-PASS 편향대로 유지): 같은 파일을 **다른 플래그**로 부르는 경우
  //     (`x.js` vs `x.js --strict`)는 별칭으로 보고 면제한다 — 플래그 차이까지 보려면 명령 파싱이 필요하다.
  //   ⚠ (검수 P1, 실측 재현) 확장자 뒤 **경계**가 없으면 `scripts/check.tsx` 가 `scripts/check.ts` 로 잘려
  //     서로 다른 두 파일이 같은 것으로 보이고, 죽은 스크립트가 별칭으로 면제된다. 경계를 요구한다.
  const _filesOf = (body) => [...String(body || '').matchAll(/(?:\.{0,2}[/\\])?[\w.-]+[/\\][\w./\\-]*\.(?:m?js|cjs|mts|cts|tsx?|sh)(?![\w])/g)]
    .map(m => _normPath(m[0]).replace(/^\.\//, ''));
  const _reachedElsewhere = (name) => {
    const mine = _filesOf(scripts[name]);
    if (!mine.length) return false;                        // 파일 없는 스크립트는 근거가 없다 — 면제 안 함
    const others = Object.entries(scripts).filter(([n]) => n !== name && isLive(n)).map(([, b]) => _filesOf(b)).flat();
    //   ⚠ (검수 P1, 실측 재현) 러너 텍스트를 원문 그대로 보면 **주석 속 경로**가 면제 근거가 된다
    //     (`# scripts/dead.js 는 나중에 정리` 한 줄로 그 가드가 사라졌다). 주석은 빼고 본다 —
    //     같은 함정을 파일 판정 쪽에서 이미 한 번 고쳤는데(검수 재현) 이 신규 경로에 그대로 되살아났다.
    const runnerText = _normPath(_dropCommentLines(runners.filter(_liveRunner).map(r => String(r.text || '')).join('\n')));
    return mine.every(f => others.includes(f) || runnerText.includes(f));
  };
  const orphanScripts = unknownOrchestrator ? [] : guardNames.filter(n => !isLive(n) && !_reachedElsewhere(n));
  void mentions;

  // ③ scripts/ 아래 파일 가드 — 어디에서도 참조되지 않는 것
  //    npm 스크립트 본문 · 러너 텍스트 어디에도 파일명이 안 나오면 사람이 기억해야만 도는 검사다.
  //    1.36.116: 참조하는 쪽이 **도달 가능해야** 덮은 것으로 본다 — 아무도 안 부르는 스크립트가 파일을
  //    언급해 봐야 그 파일도 안 도는 건 마찬가지다(스크립트 쪽 #7 과 같은 결함이 파일 쪽에도 있었다).
  const liveScripts = Object.entries(scripts).filter(([n]) => isLive(n));
  //    ⚠ 매칭 전에 경로 구분자를 정규화한다. Windows CI 는 `node scripts\x\check.js` 로 적는데
  //    후보 경로는 `/` 표기라 전체 경로가 안 맞고, basename 경계 판정은 앞의 `\` 때문에 걸러져
  //    **실제로 실행되는 가드가 고아로 보고됐다**(자체 헌트 실측: POSIX 표기만 통과).
  //    `scripts/./check.js` 같은 dot-segment 도 편다 — 전체 경로 비교가 정규화를 안 해서 실제 호출이
  //    고아로 보고됐다(검수 재현). basename 경계는 앞의 `/` 를 거부하므로 폴백으로도 안 잡혔다.
  //    ⚠ 정규화는 **한 곳**에서 한다(`_normPath`): 실제 JS 원문에는 이스케이프된 `\\` 가 들어 있고
  //    (`require(".\\check.js")` 의 파일 바이트는 backslash 2개), `a/././b` 처럼 dot-segment 가 반복될 수 있다.
  //    한 번만 치환하면 `.//check.js` 나 `a//b` 가 남아 실제 호출을 놓친다(검수 재현, 실제 파일 바이트로 확인).
  const allText = _normPath(runners.filter(_liveRunner).map(r => String(r.text || '')).join('\n') + '\n'
    + liveScripts.map(([, b]) => String(b || '')).join('\n'));
  //    ⚠ basename 만으로 덮였다고 보면 **동명 파일이 서로를 살린다**(검수 P2): `a/check.js` 를 부르는 배선이
  //    `b/check.js` 까지 덮어 버린다. basename 은 그 이름이 유일할 때만 근거로 쓴다.
  const _baseCount = new Map();
  for (const f of scriptFiles) { const b = String(f).split(/[\\/]/).pop(); _baseCount.set(b, (_baseCount.get(b) || 0) + 1); }
  //    ⚠ 그런데 유일성만으로 끄면 **해석 가능한 상대 호출**까지 잃는다(검수 P2): `scripts/a/run.js` 안의
  //    `require('./check.js')` 는 `scripts/a/check.js` 를 가리키는데, 동명 파일이 있다는 이유로 그것까지 고아가 됐다.
  //    참조한 러너의 디렉터리를 기준으로 상대 경로를 **해석해서** 덮인 집합에 넣는다.
  //    ⚠ 원문을 그대로 훑으면 **주석 속 참조**도 실행으로 계상되고(검수 재현: `// require("./a/check.js")`),
  //    `..` 가 루트 밖으로 나가면 남은 조각이 엉뚱한 루트 내부 파일로 해석된다. 둘 다 막는다.
  //    구분자는 `\` 도 받는다(`require(".\\a\\check.js")`).
  const _resolved = new Set();
  for (const r of runners.filter(_liveRunner)) {
    //    ⚠ 기준 디렉터리가 다르다: **CI 설정의 명령은 프로젝트 루트에서 실행**된다(`run: node ./scripts/x.js`).
    //    설정 파일 위치(`.github/workflows`) 기준으로 풀면 `.github/workflows/scripts/x.js` 가 돼 실제 호출을 놓친다(검수 재현).
    //    코드 파일 안의 `require('./x')` 는 그 파일 기준이 맞다.
    //    러너 자신의 경로도 정규화한다 — `node scripts/./a/run.js` 로 수집된 러너는 `r.file` 에 dot-segment 가
    //    남아 있어 해석 결과가 후보와 어긋났다(검수 재현: 실제로 도는 가드가 고아로 보고됨).
    const dir = _isConfigRunner(r.file) ? [] : _normPath(String(r.file || '')).split('/').slice(0, -1);
    //    원문을 먼저 정규화한다 — 실제 JS 는 `.\\check.js`(backslash 2개)로 저장되고, 한 번만 치환하면
    //    `.//check.js` 가 남아 아래 정규식에 안 걸린다(검수 재현: 실제로 도는 가드가 고아로 보고됐다).
    const body = _normPath(_dropCommentLines(String(r.text || '')));
    for (const m of body.matchAll(/(\.{1,2}(?:[/\\][\w.-]+)+\.(?:m?js|cjs|ts|sh))/g)) {
      const segs = dir.slice();
      let escaped = false;
      for (const s of _normPath(m[1]).split('/')) {
        if (s === '.' || s === '') continue;
        if (s === '..') { if (!segs.length) { escaped = true; break; } segs.pop(); } else segs.push(s);
      }
      // `scripts/./check.js` 처럼 중간 dot-segment 가 남아 있으면 여기서 이미 걸러진다(위 루프가 `.` 를 건너뛴다).
      if (!escaped) _resolved.add(segs.join('/'));
    }
  }
  const orphanFiles = unknownOrchestrator ? [] : scriptFiles.filter(f => {
    const full = String(f).replace(/\\/g, '/');
    if (allText.includes(full) || _resolved.has(full)) return false;
    const base = full.split('/').pop();
    //    basename 폴백은 **경로의 일부**를 잡으면 안 된다: `../../outside/check.js` 가 우리 `scripts/check.js` 를
    //    덮어 버렸다(자체 검증에서 실측). 앞에 경로 구분자가 없는 **단독 언급**일 때만 근거로 쓴다.
    const _bnRe = new RegExp(`(^|[^\\w./\\\\-])${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w.-]|$)`);
    if (_baseCount.get(base) === 1 && _bnRe.test(allText)) return false;
    return true;
  });

  // 1.36.116 (검수 #9): 수집이 불완전했으면 그 사실을 결과에 실어야 한다 — 읽기 실패는 곧 **오탐**이 되고
  //   (그 러너가 부르던 정상 가드가 '아무도 안 부름' 이 된다), 사용자는 근거를 봐야 그 목록을 믿을지 정한다.
  const scanIncomplete = (Number(input && input.readErrors) || 0) + (Number(input && input.skippedLarge) || 0);
  // monorepo 는 루트 package.json 만 보므로 **범위 밖**이다. 조용히 0건이라고 하면 안 되고, 범위를 밝혀야 한다(검수 P2).
  const monorepoOutOfScope = !!(input && input.workspaces);
  const _incompleteNote = (scanIncomplete
    ? ` ⚠ 수집 불완전(읽기실패 ${Number(input.readErrors) || 0} · 대용량 제외 ${Number(input.skippedLarge) || 0}) — 이 목록은 과다보고일 수 있다`
    : '')
    + (monorepoOutOfScope ? ` ⚠ workspaces 저장소 — 루트 package.json 만 봤다(하위 패키지는 범위 밖)` : '');
  // 1.36.127: 반사실 — 자기 진입점의 **텍스트만** 배선 근거에서 빼면 무엇이 더 보이는가.
  //   판정(orphanScripts/orphanFiles)은 그대로 두고 차이만 싣는다. 재귀는 한 단계로 막는다.
  //   이 값이 비어 있지 않다는 것은 "0건이라는 결과를 그대로 믿지 말라" 는 뜻이다 — 조용한 0건을 없앤다.
  let maskedByOwnEntry = null;
  if (!_ignoreOwnEntryText && runners.some(r => r && r.ownEntry && String(r.text || ''))) {
    try {
      const cf = _detectOrphanGuards(input, { ignoreOwnEntryText: true });
      const sMore = (cf.orphanScripts || []).filter(x => !orphanScripts.includes(x));
      const fMore = (cf.orphanFiles || []).filter(x => !orphanFiles.includes(x));
      if (sMore.length || fMore.length) maskedByOwnEntry = { scripts: sMore, files: fMore };
    } catch { /* 반사실을 못 재면 그냥 안 싣는다 — 본 판정에 영향 없음 */ }
  }
  return {
    guardCount: guardNames.length,
    dynamicRunners,
    enumPrefixes: [...coveredPrefixes],
    orphanScripts,
    orphanFiles,
    scanIncomplete,
    monorepoOutOfScope,
    maskedByOwnEntry,
    deferred: unknownOrchestrator,
    // 판정 근거를 함께 돌려준다 — 숫자만 보고 못 믿는 일이 없도록(사용자가 근거 없이 목록을 받으면 그냥 끈다)
    reason: (unknownOrchestrator
      ? 'turbo/nx/lerna 배선은 설정 파일에 있어 스크립트 그래프로 볼 수 없다 — 판정 보류(보고 안 함)'
      : dynamicRunners.length
        ? (enumCoversAll
          ? `동적 열거자(${dynamicRunners.join(', ')})가 전체를 태운다`
          : `동적 열거자(${dynamicRunners.join(', ')})가 ${[...coveredPrefixes].map(p => p + '*').join(', ')} 만 태운다 — 그 밖은 별도 배선 필요`)
        : `러너 ${runners.length}개 + 진입점 ${[...roots].length}개에서 도달성 추적 (도달 ${reachable.size}/${names.length})`) + _incompleteNote,
  };
}

const _TAG_ESC = PRESERVED_TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 경계는 **생성기가 쓰는 opener 전체**로만 확정한다. 태그 하나 또는 제목 하나로 정하면 두 가지를 오인한다
//   (검수 재현): (a) 사용자가 직접 쓴 `## Preserved previous content` 섹션 51B, (b) 문서에 인용된 태그 60B.
//   그 뒤 전부가 '이월분' 으로 계상되고, 도구는 사용자에게 **자기 산문을 옮기라고** 권하게 된다.
//   그래서 편향을 **과소 보고** 쪽에 둔다 — 못 세는 것보다 잘못 권하는 쪽이 나쁘다.
const _OPENER_RE = new RegExp(`^[ \\t]*${_TAG_ESC}[ \\t\\r]*$\\r?\\n^#{1,3}[ \\t]*Preserved previous content[ \\t\\r]*$`, 'm');
const _HEAD_RE = /^#{1,3}[ \t]*Preserved previous content[ \t\r]*$/gm;
// 태그가 없는 구형 설치본은 제목 **뒤에 생성 안내문이 따라올 때만** 인정한다(제목만으로는 사용자 섹션과 구분 불가).
const _NOTE_RE = /전체 원본 백업|Full original backup|Previous content was backed up|이전 버전에서 이어진|Custom user\/project content carried over/;
function _splitPreserved(text) {
  const s = String(text == null ? '' : text);
  let at = -1;
  const m1 = _OPENER_RE.exec(s);
  if (m1) at = m1.index;
  if (at < 0) {
    _HEAD_RE.lastIndex = 0;
    let h;
    while ((h = _HEAD_RE.exec(s))) {
      if (_NOTE_RE.test(s.slice(h.index, h.index + 800))) { at = h.index; break; }
    }
  }
  if (at < 0) return { managed: s, preserved: '', at: -1 };
  // 앞의 `---` 구분선도 생성물이라 이월분에 포함시킨다(관리분에 남기면 관리분이 그만큼 부풀어 보인다).
  //   ⚠ 여기서 접두 **전체**를 정규식으로 훑으면 개행만 긴 입력에서 2차식이 된다 —
  //   검수 재현에서 개행 40만 개 입력이 52.8초였다(5만 0.6s → 40만 52.8s). 꼬리 64자만 본다.
  const before = s.slice(0, at);
  const tail = before.slice(-64);
  const hr = /(?:\r?\n)*---[ \t]*(?:\r?\n)+$/.exec(tail);
  const start = hr ? at - (tail.length - hr.index) : at;
  return { managed: s.slice(0, start), preserved: s.slice(start), at: start };
}

// 1.9.369 (UR-0025): --skills 값 파싱 순수 코어 — catalog 주입(harness skillCatalog 비결합). all/recommended/csv 처리 + catalog 필터.
function _parseSkillsValue(v, catalog) {
  if (!v || v === true) return [];
  if (v === 'all') return Object.keys(catalog || {});
  // 1.36.80 (사용자 지시): 내장 기본에서 작성자 개인 도메인 스킬(커머스/GA4/앱스토어/오피스/크롤링/파이어베이스/퍼블리셔) 제거 —
  //   검증 근거 없이 verification:'passed' 를 주장했고 내용은 설명 4줄짜리 메타데이터뿐이라 전역 배포본의 기본값으로 부적절.
  //   남는 2종은 leerness 자체 워크플로(기능 구현 계약·로드맵 산출)라 도구와 함께 유지된다.
  if (v === 'recommended') return Object.keys(catalog || {});
  // 1.36.80 (검수 #10): 명시 요청한 미지/제거된 id 를 조용히 걸러 exit 0 + 0개 설치로 끝나던 것 —
  //   호출부가 unknown 을 보고 분명히 거절할 수 있도록 함께 반환한다(하위호환: 반환은 여전히 배열).
  const req = String(v).split(',').map(s => s.trim()).filter(Boolean);
  const known = req.filter(s => (catalog || {})[s]);
  const unknown = req.filter(s => !(catalog || {})[s]);
  if (unknown.length) { try { Object.defineProperty(known, 'unknown', { value: unknown, enumerable: false }); } catch {} }
  return known;
}

// 1.9.370 (UR-0025): memory archive 블록 파서 순수 코어 — "## 제거 DATE (target: \"...\")" 블록 → {date,target,originalHeader}[].
function _parseArchiveBlocks(text) {
  const entries = [];
  if (!text) return entries;
  const blocks = text.split(/\n(?=## 제거 )/);
  for (const b of blocks) {
    const m = b.match(/^## 제거 (\d{4}-\d{2}-\d{2})\s*\(target:\s*"([^"]*)"\)/);
    if (!m) continue;
    const headerMatch = b.match(/^### (.+)$/m);
    entries.push({ date: m[1], target: m[2], originalHeader: headerMatch ? headerMatch[1].trim() : null });
  }
  return entries;
}
// 1.9.370 (UR-0025): skill 카탈로그 파서 순수 코어 — JSON/RSS·Atom/markdown 링크/llms.txt 형식 → {name,url,description,format}[].
function _parseSkillCatalog(body, sourceUrl) {
  const entries = [];
  const trimmed = String(body || '').trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const j = JSON.parse(trimmed);
      const arr = Array.isArray(j) ? j : (j.skills || j.entries || j.items || []);
      for (const e of arr) {
        if (!e || (!e.name && !e.id)) continue;
        entries.push({ name: e.name || e.id, url: e.url || e.path || (sourceUrl ? sourceUrl.replace(/[^/]+$/, '') + (e.id || e.name) + '/SKILL.md' : ''), description: e.description || '', format: 'json' });
      }
      if (entries.length) return entries;
    } catch {}
  }
  if (/<rss|<feed|<channel|<item>/i.test(body)) {
    for (const m of String(body).matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)) {
      const item = m[0];
      const title = (item.match(/<title>([^<]+)<\/title>/i) || [])[1];
      const link = (item.match(/<link[^>]*>([^<]+)<\/link>/i) || item.match(/<link\s+href="([^"]+)"/i) || [])[1];
      const desc = (item.match(/<description>([^<]+)<\/description>/i) || item.match(/<summary>([^<]+)<\/summary>/i) || [])[1];
      if (title) entries.push({ name: title.trim(), url: (link || '').trim(), description: (desc || '').trim(), format: 'rss' });
    }
    if (entries.length) return entries;
  }
  for (const m of String(body).matchAll(/^\s*[-*]\s*\[([^\]]+)\]\(([^)]+)\)\s*[-—:]\s*(.+)$/gm)) {
    entries.push({ name: m[1], url: m[2], description: m[3].trim(), format: 'markdown' });
  }
  if (entries.length) return entries;
  for (const m of String(body).matchAll(/^\s*[-*]\s*\[([^\]]+)\]\(([^)]+\.md)\)/gm)) {
    entries.push({ name: m[1], url: m[2], description: '', format: 'markdown' });
  }
  if (entries.length) return entries;
  for (const m of String(body).matchAll(/(https?:\/\/[^\s)]+SKILL\.md)/g)) {
    entries.push({ name: m[1].split('/').slice(-2)[0], url: m[1], description: '', format: 'urls' });
  }
  return entries;
}

// 1.9.371 (UR-0073 Phase A): agent team 정의 → teams.md projection (canonical JSON 주, MD 투영). 순수 렌더러.
function _renderTeamsMd(teams) {
  const preamble = '# Agent Teams (UR-0073)\n\n페르소나 기반 에이전트 팀 정의 — **opt-in · 정의 전용(자동 실행 없음)**. `leerness team add|list|show|remove` 로 관리.\n'
    + '향후 단계에서 스케줄 기반 실행(리뷰/배포/블로그)이 opt-in 으로 추가될 수 있습니다. 현재는 메타데이터만 저장합니다.\n';
  const body = (teams || []).map(t => {
    return `\n## ${t.id}${t.name ? ' — ' + t.name : ''}\n`
      + `- Purpose: ${t.purpose || ''}\n`
      + `- Personas: ${(t.personas || []).join(', ')}\n`
      + `- Members: ${(t.members || []).join(', ')}\n`
      + `- Schedule: ${t.schedule || 'manual'}\n`
      + `- Deploy: ${t.deployCommand || '-'}\n`
      + `- Review: ${t.review !== false ? '메인 검수 필요' : '생략'}\n`
      + `- Status: ${t.status || 'active'}\n`;
  }).join('');
  return preamble + body;
}

// 1.9.372 (UR-0073 Phase B): team 실행 계획 컴포저 (순수, dry-run 미리보기). 실제 실행/spawn 없음 — 멤버별 dispatch 명령 문자열만 생성.
function _composeTeamPlan(team, task) {
  const t = team || {};
  const effTask = (task && task !== true) ? String(task) : (t.purpose || '(작업 미지정)');
  const personas = Array.isArray(t.personas) ? t.personas : [];
  const members = Array.isArray(t.members) ? t.members : [];
  const personaTag = personas.length ? ` [페르소나: ${personas.join(', ')}]` : '';
  const steps = members.map(m => {
    const prompt = `${effTask}${personaTag}`;
    return { member: m, personas, dispatchPrompt: prompt, suggestedCommand: `leerness agents dispatch "${prompt}" --to ${m}` };
  });
  // 1.9.414 (UR-0119/0120): 메인 에이전트 검수 단계 — sub-agent 분배 후 메인이 산출물을 교차검증(기본 on, team.review===false 시 생략).
  const review = t.review !== false;
  const reviewStep = review ? {
    type: 'review',
    note: '메인 에이전트가 각 sub-agent 산출물을 독립 검증(교차 검수). verify-claim/contract verify/review 사용.',
    suggestedCommand: 'leerness verify-claim <T-ID> --run-tests --strict-claims  ·  leerness review <file> --persona ' + (personas.join(',') || 'security'),
  } : null;
  return { teamId: t.id || null, name: t.name || '', task: effTask, schedule: t.schedule || 'manual', memberCount: members.length, review, steps, reviewStep };
}

// 1.9.373 (UR-0073 Phase C): 비-manual·active 팀의 handoff 스케줄 알림 라인 (순수). 실행 트리거 아님 — 미리보기 안내만.
// 1.31.3 (UR-0010): optional lang ('en') → 영어 라벨. 기본 'ko' (무회귀, 1-arg 호출 보존).
function _teamHandoffReminders(teams, lang) {
  const en = lang === 'en';
  return (teams || [])
    .filter(t => t && t.schedule && t.schedule !== 'manual' && (t.status || 'active') === 'active' && t.id)
    .map(t => {
      const n = Array.isArray(t.members) ? t.members.length : 0;
      const memberPart = n ? (en ? ` · ${n} member${n === 1 ? '' : 's'}` : ` · ${n}명`) : '';
      const reviewPart = t.review !== false ? (en ? ' · review needed' : ' · 검수필요') : '';
      const preview = en ? 'preview' : '미리보기';
      return `🤝 ${t.id} (${t.schedule})${memberPart}${reviewPart} — ${preview}: leerness team preview ${t.id}`;
    });
}

// 1.9.374 (UR-0074): 릴리스 케이던스 평가 (순수) — releases/day → 수준 + 권장. 외부리뷰 "릴리스 빈도 과다" 가시화.
function _cadenceAssessment(perDay, total, daysActive) {
  const r = Number(perDay) || 0;
  let level, recommendation;
  if (r >= 5) { level = 'very-high'; recommendation = 'batched minor 릴리스 강력 권장 — 관련 패치를 묶어 주 1~2회 minor 로. stable/next 채널 분리 + 사용자에겐 stable 만 권고.'; }
  else if (r >= 2) { level = 'high'; recommendation = 'cadence 높음 — 연관 변경을 묶어 배포 빈도 축소 권장. 릴리스 노트에 실행 환경/검증 명시.'; }
  else if (r >= 0.5) { level = 'moderate'; recommendation = '적정 범위 — 안정성 우선 시 minor 묶음 고려.'; }
  else { level = 'healthy'; recommendation = '건강한 케이던스.'; }
  return { releasesPerDay: r, total: Number(total) || 0, daysActive: Number(daysActive) || 0, level, recommendation };
}

// 1.9.376 (UR-0073 Phase D): team 배포 실행 게이트 결정 (순수). 안전: dry-run 기본, 실행은 --yes + env 이중 게이트.
//   mode: no-command(설정 없음) / dry-run(실행 안 함) / gated(env 미충족 거부) / execute(실행 허용).
function _teamDeployGate(team, opts) {
  const t = team || {}; opts = opts || {};
  const command = (t.deployCommand && t.deployCommand !== true) ? String(t.deployCommand) : '';
  if (!command) return { mode: 'no-command', command: '', message: 'deployCommand 미설정 — team add --deploy "<명령>" 으로 지정' };
  if (!opts.yes) return { mode: 'dry-run', command, message: 'dry-run (실행 없음) — 실행하려면 --yes + LEERNESS_TEAM_DEPLOY=1' };
  if (!opts.envOn) return { mode: 'gated', command, message: '실행 게이트 미충족 — LEERNESS_TEAM_DEPLOY=1 환경변수 필요 (의도적 opt-in)' };
  return { mode: 'execute', command, message: '실행 허용 (--yes + env 게이트 충족)' };
}

// 1.9.377 (UR-0025): 워크스페이스 레퍼런스 가이드 빌더 (순수) — dirName/version/generatedAt 주입. harness 인라인(~57줄) 분리.
function _renderWorkspaceReferenceGuide(dirName, version, generatedAt) {
  const lines = [];
  lines.push(`# Leerness Workspace Reference Guide`);
  lines.push('');
  lines.push(`> AI 에이전트가 leerness 워크스페이스에서 어떤 파일을 어디서 찾는지 안내합니다 (1.9.211).`);
  lines.push('');
  lines.push(`Generated: ${generatedAt} by leerness ${version}`);
  lines.push(`Workspace dir: \`${dirName}/\``);
  lines.push('');
  lines.push(`## 📁 디렉토리 구조 (핵심)`);
  lines.push('');
  lines.push('```');
  lines.push(`${dirName}/`);
  lines.push(`├── plan.md                    ← 무엇을 할 것인가 (사용자 메모리)`);
  lines.push(`├── progress-tracker.md        ← 무엇을 했는가 (증거 포함, 사용자 메모리)`);
  lines.push(`├── decisions.md               ← 왜 그렇게 했는가 (사용자 메모리)`);
  lines.push(`├── session-handoff.md         ← 다음 세션 인계 (사용자 메모리)`);
  lines.push(`├── lessons.md                 ← 과거 교훈 (자동 fuzzy 회수)`);
  lines.push(`├── rules.md                   ← 자연어 룰 (매 세션 자동 노출, R-XXXX)`);
  lines.push(`├── task-log.md                ← in-progress / dropped task 이력`);
  lines.push(`├── reuse-map.md               ← 워크스페이스 capability 매핑`);
  lines.push(`├── skill-suggestions.md       ← skill rolling history`);
  lines.push(`├── feature-graph.md           ← 기능 의존 그래프 (F-XXXX)`);
  lines.push(`├── manifest.json              ← 워크스페이스 메타`);
  lines.push(`├── leerness-config.json       ← 비시크릿 LEERNESS_* 설정 (1.9.187, AI 가시)`);
  lines.push(`├── user-requests.json         ← 사용자 명시 요청 누적 (1.9.207)`);
  lines.push(`├── active-wakeups.json        ← ScheduleWakeup 상태 (1.9.205)`);
  lines.push(`├── pre-wake-report.json       ← sleep 전 sub-agent audit (1.9.209)`);
  lines.push(`├── wakeup-history.json        ← adaptive wakeup 이력 (1.9.210)`);
  lines.push(`├── platform-constraints.json  ← API 제약 catalog (1.9.208)`);
  lines.push(`├── auto-resume-plan.json      ← 다음 라운드 plan (1.9.203)`);
  lines.push(`├── next-action-queue.json     ← 다음 next-action 큐 (1.9.201)`);
  lines.push(`├── last-handoff.json          ← 마지막 handoff timestamp`);
  lines.push(`├── environment.json           ← 환경 변동 추적 (1.9.145)`);
  lines.push(`├── skills/                    ← 설치된 skill 디렉토리`);
  lines.push(`└── templates/                 ← 워크스페이스 템플릿`);
  lines.push('```');
  lines.push('');
  lines.push(`## 🧭 자주 묻는 위치`);
  lines.push('');
  lines.push(`| 찾는 것 | 위치 |`);
  lines.push(`|---|---|`);
  lines.push(`| 현재 진행 중인 task | \`${dirName}/progress-tracker.md\` (status: in-progress) |`);
  lines.push(`| 사용자가 명시한 영구 룰 | \`${dirName}/rules.md\` (active R-XXXX) |`);
  lines.push(`| 직전 sleep 전 audit 결과 | \`${dirName}/pre-wake-report.json\` (1.9.209) |`);
  lines.push(`| 미답 사용자 요청 | \`${dirName}/user-requests.json\` (status: open) |`);
  lines.push(`| 다음 라운드 권장 단계 | \`${dirName}/auto-resume-plan.json\` (1.9.203) |`);
  lines.push(`| API 제약 catalog | \`${dirName}/platform-constraints.json\` (1.9.208) |`);
  lines.push(`| 자동 wakeup 권장 간격 | \`${dirName}/wakeup-history.json\` (1.9.210) |`);
  lines.push('');
  // 1.36.126 (T-0107, 검수 P1): 이 절은 AI 에게 **"마커가 있으면 `.leerness` 를 쓰라"** 고 지시하고 있었다.
  //   메커니즘(해석기)은 고쳐 놓고 지시문을 남기면, 그 지시문이 같은 버그를 계속 재생산한다.
  //   실측: `.leerness` 는 옛 migrate 가 만든 **얼어붙은 사본**이고 이후 모든 쓰기는 `.harness` 로 간다.
  lines.push(`## 🔄 \`.leerness\` 디렉터리를 보셨다면`);
  lines.push('');
  lines.push(`이 빌드가 읽고 쓰는 워크스페이스는 **\`${dirName}/\` 하나뿐**입니다.`);
  lines.push(`- \`.leerness/\` 가 있어도 **읽지 마십시오** — 옛 \`migrate-workspace-dir\` 가 만든 사본이며 그 시점에 멈춰 있습니다.`);
  lines.push(`- \`.leerness/MIGRATED_FROM_HARNESS\` 마커도 마찬가지입니다 — 이 빌드에서는 아무 효력이 없습니다.`);
  lines.push(`- \`.harness/MIGRATED_TO_LEERNESS.md\` 안내문 역시 낡았습니다.`);
  lines.push(`- \`migrate-workspace-dir\` 는 1.36.126 부터 사유를 설명하고 거부합니다 (T-0107).`);
  lines.push('');
  lines.push(`AI 에이전트는 \`leerness handoff .\` 결과를 신뢰하십시오 — 항상 살아 있는 워크스페이스를 씁니다.`);
  lines.push('');
  return lines.join('\n');
}

// 1.9.379 (UR-0025 심화): Memory Surface 포맷 (순수) — T/D/R/P/L 카운트 → 문자열. pulse/memory-status 단일출처.
function _memorySurface(counts) {
  const c = counts || {};
  return `T${c.tasks || 0}/D${c.decisions || 0}/R${c.rules || 0}/P${c.milestones || 0}/L${c.lessons || 0}`;
}
// 1.9.379 (UR-0025 심화): pulse 한 줄 요약 조합 (순수) — gather(I/O)된 data → 한 줄 문자열. pulse 핸들러 렌더 코어.
function _renderPulseLine(data) {
  const d = data || {};
  let line = `📍 v${d.version} · 🔄 R${d.roundCount} · 🔌 MCP ${d.mcpTools} · 🧠 ${d.memorySurface}`;
  if (d.nextMilestone) {
    const eta = d.etaDays != null ? ` (${d.etaDays}d)` : '';
    line += ` · 🎯 R${d.nextMilestone}${eta}`;
  }
  if (d.abnormalShutdown && d.abnormalShutdown !== 'none') {
    line += ` · 🔌 abnormal:${d.abnormalShutdown}`;
  }
  return line;
}


// 1.9.429 (10th 외부평가 UR-0129): impl 소스에서 export 식별자 추출.
//   브레이스 균형으로 module.exports={...} 의 top-level 키만(함수 본문/중첩객체 안전 — 멀티라인 첫키만 버그 수정)
//   + exports.foo + ESM(export function/const/let/var/class, export {a, b as c}) 인식.
function _parseImplExports(src) {
  const out = new Set();
  const add = n => { if (n && /^[A-Za-z_$][\w$]*$/.test(n)) out.add(n); };
  // 1) module.exports = { _decisionBlocksWithOffset, _blocksWithOffset, _lineOfOffset, ... } — 브레이스 균형 + top-level 키
  const re = /module\.exports\s*=\s*\{/g; let mm;
  while ((mm = re.exec(src))) {
    const i = src.indexOf('{', mm.index); let depth = 0, end = -1;
    for (let j = i; j < src.length; j++) { const c = src[j]; if (c === '{') depth++; else if (c === '}') { if (--depth === 0) { end = j; break; } } }
    if (end < 0) break;
    const inner = src.slice(i + 1, end);
    let d = 0, seg = ''; const segs = [];
    for (const c of inner) { if (c === '{' || c === '(' || c === '[') d++; else if (c === '}' || c === ')' || c === ']') d--; if (d === 0 && c === ',') { segs.push(seg); seg = ''; } else seg += c; }
    if (seg.trim()) segs.push(seg);
    for (const s of segs) { const m = s.match(/^\s*\.{0,3}\s*([A-Za-z_$][\w$]*)/); if (m && !/^\s*\.\.\./.test(s)) add(m[1]); }
    re.lastIndex = end;
  }
  // 2) exports.foo = / module.exports.foo =
  for (const m of src.matchAll(/(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) add(m[1]);
  // 2b) 1.35.11 (codex 교차 헌트 #8): bracket 표기 exports["foo"] / module.exports['foo'] = ... — 종전 dot 표기만 인식해 bracket export 를 미노출(FP: contract 가 실존 함수를 누락으로 오판).
  for (const m of src.matchAll(/(?:module\.)?exports\s*\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\]\s*=/g)) add(m[1]);
  // 3) ESM 선언: export [async] function*/const/let/var/class foo
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  // 4) ESM 목록/재export: export { foo, bar as baz } / export { default as X } from './m' → 외부이름(as 뒤) 우선.
  //   1.9.438 (11th 외부평가 Sonnet P3, UR-0139): `default as X` 는 별칭 X 가 named export → as 별칭을 먼저 채택(이전엔 'default' 시작이라 통째로 스킵). 'export * from' 은 이름 정적불가라 미지원.
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const seg = part.trim(); if (!seg) continue;
      const asM = seg.match(/\bas\s+([A-Za-z_$][\w$]*)/);
      if (asM) { add(asM[1]); continue; }            // a as b / default as b → b
      if (/^(?:default|type)\b/.test(seg)) continue;  // 단독 default / type X 제외
      add((seg.match(/^([A-Za-z_$][\w$]*)/) || [])[1]);
    }
  }
  return [...out];
}

// 1.11.4 (UR-0007): 용어집(glossary) 순수 코어 — 의존성→큐레이션 카탈로그 매칭 + MD 렌더. 무LLM·0deps. (외부 3-에이전트 평가 종합 설계)
function _matchTool(catalog, name) {
  if (!catalog || !catalog.tools || !name) return null;
  const n = String(name).toLowerCase().trim();
  for (const [id, t] of Object.entries(catalog.tools)) {
    if ((t.aliases || []).some(a => a.toLowerCase() === n)) {
      return { id, category: t.category || 'other', plainKo: t.plainKo || '', plainEn: t.plainEn || '', docs: t.docs || null };
    }
  }
  return null;
}
// package.json 본문 → 의존성 이름 배열(dependencies + devDependencies + peerDependencies). 순수(텍스트 입력).
function _parsePackageJsonDeps(pkgJsonText) {
  let pkg; try { pkg = JSON.parse(pkgJsonText); } catch { return []; }
  const out = [];
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const o = pkg && pkg[field]; if (o && typeof o === 'object') for (const k of Object.keys(o)) if (!out.includes(k)) out.push(k);
  }
  return out;
}
// requirements.txt 본문 → 파이썬 패키지명 배열(버전/주석 제거). 순수.
function _parseRequirementsTxt(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim(); if (!line) continue;
    // 1.12.5 (15th 버그헌트 P3, UR-0021): pip 디렉티브(-e/-r/--hash/-c) skip + 패키지명은 영숫자로 시작(이전엔 -e/-r/--hash/. 가 패키지로 파싱됨).
    if (line.startsWith('-')) continue;
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9_.\-]*)/); if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
// 의존성 목록 + 카탈로그 → 용어집 엔트리(매칭 + 미매칭 gap). descFor(name)=로컬 fallback 설명(없으면 null). 순수.
function _buildGlossary({ deps = [], catalog, descFor = () => null } = {}) {
  const entries = [], gaps = []; const seen = new Set();
  for (const name of deps) {
    if (seen.has(name)) continue; seen.add(name);
    const hit = _matchTool(catalog, name);
    if (hit) { entries.push({ term: name, plainKo: hit.plainKo, plainEn: hit.plainEn, category: hit.category, source: 'catalog', docs: hit.docs }); continue; }
    const d = descFor(name);
    if (d) entries.push({ term: name, plainKo: _lineSafe(d), plainEn: _lineSafe(d), category: 'dependency', source: 'package-description', docs: null });
    else gaps.push({ term: name, category: 'dependency', source: 'unknown', needsDefinition: true });
  }
  entries.sort((a, b) => a.term.localeCompare(b.term));
  return { entries, gaps, stats: { total: deps.length, defined: entries.length, gaps: gaps.length } };
}
const GLOSSARY_START = '<!-- leerness:glossary:start -->';
const GLOSSARY_END = '<!-- leerness:glossary:end -->';
// 용어집 엔트리 → 이중언어 MD(마커 래핑, drift-aware). 순수.
function _renderGlossaryMd(entries, opts = {}) {
  const lang = opts.lang || 'both'; const gaps = opts.gaps || [];
  let s = `${GLOSSARY_START}\n# 용어집 / Glossary\n\n> 이 프로젝트가 사용하는 도구/라이브러리를 비개발자도 알 수 있게 한 줄로 설명합니다. (leerness glossary)\n\n`;
  if (!entries.length && !gaps.length) { s += '_(의존성 없음 — package.json/requirements.txt 미발견)_\n'; return s + GLOSSARY_END + '\n'; }
  if (entries.length) {
    s += '| 패키지 | 쉽게 말하면 (KO) | In plain terms (EN) | 분류 | 출처 |\n|---|---|---|---|---|\n';
    for (const e of entries) {
      // 1.12.4 (15th 버그헌트 P2, UR-0015): 표 셀은 _cellSafe(파이프 escape) — _lineSafe 는 개행만 제거해 description 의 '|' 가 칼럼을 깨뜨렸음(node_modules description fallback 벡터).
      const ko = lang === 'en' ? '' : _cellSafe(e.plainKo || '');
      const en = lang === 'ko' ? '' : _cellSafe(e.plainEn || '');
      s += `| ${_cellSafe(e.term)} | ${ko} | ${en} | ${_cellSafe(e.category || '')} | ${e.source} |\n`;
    }
    s += '\n';
  }
  if (gaps.length) {
    s += `## 미정의 (${gaps.length}) — AI 에이전트가 채울 항목\n\n카탈로그·로컬 설명에 없는 의존성입니다. 사용 중인 AI 에이전트에게 아래를 요청하세요:\n\n`;
    s += '> 다음 패키지들을 비개발자도 이해할 한 줄(한국어+영어)로 설명해줘: ' + gaps.map(g => _lineSafe(g.term)).join(', ') + '\n';
  }
  return s + GLOSSARY_END + '\n';
}

// 1.36.19 (실사용 7 프로젝트 dogfood): 전략 앵커(project-brief Purpose / plan Goal) 미작성 감지.
//   현장 관찰 — 동적 상태(current-state/decisions)는 7/7 유지되나 정체성 앵커는 brief 5/7·plan 7/7 이 템플릿 placeholder
//   그대로 방치됨(27개 결정 쌓은 프로젝트조차 brief 빈칸). 인계받은 AI 가 "프로젝트가 무엇인지"를 못 받는 근본원인 →
//   audit/handoff 가 표면화하도록 순수 detector. bullet/문단 무관, 빈 섹션·placeholder 문구를 모두 미작성으로 판정.
//   섹션 자체가 없으면(구조 미상) 미플래그(FP 회피). `<!-- leerness:na -->` 스킵은 캘러(audit)가 처리.
function _mdSectionBody(content, heading) {
  const lines = String(content || '').split('\n');
  const h = new RegExp('^##\\s*' + heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
  const i = lines.findIndex(l => h.test(l));
  if (i < 0) return null;
  const body = [];
  for (let j = i + 1; j < lines.length; j++) { if (/^##\s/.test(lines[j])) break; body.push(lines[j]); }
  return body.join('\n');
}
const _BRIEF_PLACEHOLDER_RE = /실제\s*(?:내용|목적)\s*으로\s*업데이트|describe .*purpose here|update .*with (?:the )?real/i;
const _PLAN_GOAL_PLACEHOLDER_RE = /전체\s*계획을\s*유지합니다|사용자\s*목적을\s*기준으로|state your goal here|maintain the overall plan/i;
function _sectionUnfilled(content, heading, placeholderRe) {
  const body = _mdSectionBody(content, heading);
  if (body == null) return false;                                       // 섹션 없음 → 미플래그
  if (placeholderRe.test(body)) return true;                            // 템플릿 문구 그대로
  return !body.split('\n').some(l => l.replace(/^\s*[-*]\s*/, '').trim().length > 0);  // 실내용(bullet/문단) 0 → 빈칸
}
function _briefUnfilled(content) { return _sectionUnfilled(content, 'Purpose', _BRIEF_PLACEHOLDER_RE); }
function _planGoalUnfilled(content) { return _sectionUnfilled(content, 'Goal', _PLAN_GOAL_PLACEHOLDER_RE); }

// 1.36.36 (도그푸딩 실측 후속): 정체성앵커 초안 합성 — 실신호(package.json/README/milestones/tasks)만으로 순수 조합.
//   배경: 1.36.19 감지 출하 후에도 실프로젝트 7곳 재실측에서 brief 미작성 4/7 · plan Goal 미작성 6/7 — 노출만으론 전환 안 됨.
//   원칙: 발명 금지(신호에 없는 내용은 쓰지 않음) + 초안 표식 명시(확정은 AI/사용자 몫) — 과장 방지.
function _draftAnchors(sig = {}) {
  const purpose = [];
  const goal = [];
  // 1.36.49 (codex 6차 #3 High): 외부 신호 한 줄 정규화 — description 에 개행/헤딩(`##`)이 들어오면
  //   섹션 본문에 구조 마크다운이 박혀 다음 --apply 의 섹션 경계 인식이 밀리고 파일이 실행마다 자란다.
  //   개행→공백, 줄머리 헤딩 마커 제거(불릿 "- " 접두가 있으므로 줄 중간 # 은 무해).
  const _oneLine = (s) => String(s || '').replace(/\s*\r?\n\s*/g, ' ').replace(/^#+\s*/, '').trim();
  const desc = _oneLine(sig.pkgDescription);
  // README 첫 문단: 제목/배지/빈줄 건너뛰고 첫 산문 줄
  let readmeLead = '';
  for (const line of String(sig.readmeText || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('![') || t.startsWith('[!') || t.startsWith('<')) continue;
    readmeLead = t; break;
  }
  // 1.36.47 (실적용 품질 결함): slice 가 구 중간을 절단해 "…주문 목록  를(을)…" 같은 어색문이 실프로젝트에 박혔다 —
  //   단어/구두점 경계 절단 + 조사 병기 없는 문형으로.
  const _cutAt = (s, n) => {
    s = String(s || '').trim();
    if (s.length <= n) return s;
    const head = s.slice(0, n);
    const brk = Math.max(head.lastIndexOf(' '), head.lastIndexOf(','), head.lastIndexOf('·'), head.lastIndexOf('。'), head.lastIndexOf('.'));
    return (brk > n * 0.5 ? head.slice(0, brk) : head).replace(/[\s,·]+$/, '') + '…';
  };
  if (desc) purpose.push(`- ${desc}`);
  if (readmeLead && readmeLead !== desc) purpose.push(`- ${_cutAt(readmeLead, 200)}`);
  const ms = (sig.milestones || []).filter(m => m && m.title).slice(0, 3);
  const activeTasks = (sig.tasks || []).filter(t => t && /in-progress|planned|requested/.test(String(t.status || ''))).slice(0, 3);
  // 1.36.66 (8차 헌트 F11): en 프로젝트는 초안 마커·기본 goal 도 영어
  const _en = String(sig.lang || '').toLowerCase() === 'en';
  if (desc || readmeLead) goal.push(_en ? `- Keep the product working and evolving it: ${_cutAt(desc || readmeLead, 140)}` : `- 제품을 동작 상태로 유지·발전시킨다: ${_cutAt(desc || readmeLead, 140)}`);
  for (const m of ms) goal.push(`- [${m.id || 'M'}] ${_oneLine(m.title).slice(0, 120)}${m.status ? ` (${m.status})` : ''}`);
  if (!goal.length && activeTasks.length) for (const t of activeTasks) goal.push(`- ${t.id}: ${_oneLine(t.request).slice(0, 100)}`);
  const marker = _en
    ? '<!-- draft: leerness anchors — draft from real signals. Remove this comment after AI/user review to confirm -->'
    : '<!-- draft: leerness anchors — 실신호 기반 초안. AI/사용자가 검토·수정 후 이 주석을 지우면 확정 -->';
  return {
    hasSignal: purpose.length > 0 || goal.length > 0,
    purpose: purpose.length ? [marker, ...purpose] : [],
    goal: goal.length ? [marker, ...goal] : [],
  };
}

// 섹션 본문 교체(## <heading> 다음부터 다음 ## 전까지) — 파일 나머지는 불변.
// 대상 섹션 없으면 원문 그대로(appendIfMissing 지정 시 파일 끝에 `## <heading>` 신설 — 1.36.49 codex 6차 #4).
function _replaceMdSection(content, heading, newBodyLines, opts = {}) {
  // 1.36.49 (codex 6차 #3 방어층): 본문 줄 안의 개행 평탄화 — 어떤 호출자가 개행 포함 줄을 넘겨도 구조 오염 방지.
  newBodyLines = (newBodyLines || []).flatMap(l => String(l).split('\n'));
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(l => l.trim().replace(/^#+\s*/, '').toLowerCase() === String(heading).toLowerCase() && /^#+\s/.test(l.trim()));
  if (start < 0) {
    if (!opts.appendIfMissing) return content;
    const base = String(content || '').replace(/\r\n/g, '\n').replace(/\n*$/, '');
    return (base ? base + '\n\n' : '') + `## ${heading}\n\n` + newBodyLines.join('\n') + '\n';
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }
  return [...lines.slice(0, start + 1), '', ...newBodyLines, '', ...lines.slice(end)].join('\n');
}

module.exports = { _decisionBlocksWithOffset, _blocksWithOffset, _lineOfOffset,
  // 1.36.127 (검수 P1): 경로 접기 규칙은 **한 곳**이어야 한다 — 수집기가 따로 구현했다가 중간 dot-segment 에서
  //   갈라져 `ownEntry` 판정이 어긋났다(같은 파일을 다른 이름으로 봄).
  _normPath,
  _parseImplExports, _briefUnfilled, _planGoalUnfilled, _mdSectionBody, _draftAnchors, _replaceMdSection,
  _matchTool, _parsePackageJsonDeps, _parseRequirementsTxt, _buildGlossary, _renderGlossaryMd, GLOSSARY_START, GLOSSARY_END,
  _isSecretKey, redactSecrets, hasCredentialMarker, compareVer, parseHarnessVersion,
  _isPlaceholderSecret, _looksSecretLike,
  _mergeLines, _mergeEnvLines, _mergeReadmeSection, _managedMerge, _splitPreserved, PRESERVED_TAG, _detectOrphanGuards, _parseSkillsValue,
  _parseArchiveBlocks, _parseSkillCatalog, _renderTeamsMd, _composeTeamPlan, _teamHandoffReminders, _cadenceAssessment, _teamDeployGate, _renderWorkspaceReferenceGuide, _memorySurface, _renderPulseLine,
  _classifyCJK, _riskLabel, _detectSystemLang, _parseSlashFromHelp,
  // 1.9.283 (UR-0025 2단계)
  PERMISSION_TIERS, _tierRank, _requiredTier, _policyAllows, _resolveNpmTag, _mcpJsonContent, _newRunRecord,
  // 1.9.318 (UR-0025): 순수 HTML 파싱 유틸
  _htmlToText, _extractTitle, _extractLinks,
  // 1.9.324 (UR-0025): 순수 메모리 MD 파서
  _countDatedBlocks, _extractDecisionBlocks,
  // 1.9.325 (UR-0025): 순수 intent 분류
  _classifyIntent,
  // 1.9.326 (UR-0025): 순수 문자열/셸/env 유틸
  _sanitizeFences, _shellQuoteArg, _detectPwshFromEnv,
  // 1.9.327 (UR-0025): 순수 TZ/날짜 포맷
  _getLocalTz, _formatLocal,
  // 1.9.328 (UR-0025): 순수 문자열 유틸
  _truncate, _splitList,
  // 1.9.329 (UR-0025): 순수 roadmap MD 파서
  _roadmapMapStatus, _roadmapParseMilestones, _roadmapParseTokens,
  // 1.9.330 (UR-0025): project-brief 필드 config + 채움 카운트
  _BRIEF_FIELDS, _briefFilled,
  // 1.9.331 (UR-0025): project-brief 텍스트 빌더 + 마커
  BRIEF_START, BRIEF_END, _briefReadmeBlock, _briefBlueprint,
  // 1.9.332/UR-0058: 순수 lessons.md 파서 + canonical projection renderer
  _parseLessonEntries, _renderLessonsMd,
  // 1.9.341 (UR-0025 심층): 내장 스킬 catalog _source 부여
  _withBuiltinSource,
  // 1.9.345 (UR-0025 심층): HTML escape (출력 인젝션 방지)
  _esc,
  // 1.9.346 (UR-0025 심층): roadmap CSS 변수 빌더
  _roadmapTokenStyles,
  // 1.9.347 (UR-0025 심층): SKILL.md frontmatter 파서 (BOM-aware)
  _parseSkillMd, _lintSkillMeta,
  // 1.9.333 (UR-0025 심층): 순수 플랫폼 제약 매칭
  _matchConstraints,
  // 1.9.333 패턴 적용: 순수 도메인 매칭
  _matchDomain, _aliasHit,
  // 1.9.335 (UR-0025 심층): LSP 서브시스템 — 순수 언어감지 + 정규식 심볼 매처
  _detectLspLang, _matchLspSymbols,
  // anti-laziness optimism-check 순수 로직
  _extractUrlClaims, _verifyUrlClaim, _detectOptimism, _computeConfidence,
  // 1.9.337 (UR-0025 심층): persona 요약 목록
  _personaSummaries,
  // 1.9.338 (UR-0025 심층): i18n 순수 조회
  _translate,
  // 1.9.339 (UR-0053): decisions canonical 파서/렌더 (JSON canonical, MD projection)
  _parseDecisionBlock, _decisionsFromMd, _renderDecisionsMd,
  // 1.9.355 (UR-0075 Phase A): 크로스버전 마이그레이션 가이드
  _migrationGuideText,
  // 1.9.385 (UR-0086, 5th외부평가): contract spec 순수 파서 (markdown bullet 함수 선언 감지)
  _parseContractSpec,
  // 1.9.386 (UR-0087, 5th외부평가): 간이 .gitignore 매칭 + glob (bare .env → .env.* 과잉보호 제거)
  _gitignoreMatch, _globToRe,
  // 1.9.390 (UR-0025): feature-graph 순수 코어 (템플릿/파서/ID/블록)
  _featureGraphTemplate, _parseFeatureGraph, _nextFeatureId, _featureBlock,
  // 1.9.391 (UR-0025): feature 영향 BFS (순수, 공유)
  _featureImpactBfs,
  // 1.9.393 (UR-0025): CHANGELOG 버전 구간 차분 파서 (순수, 공유)
  _parseChangelogBetween,
  // 1.9.399 (7번째 버그헌트 P1-A, UR-0104): markdown 테이블 셀 안전화(파이프/개행 injection 차단)
  _cellSafe, _cellUnescape,
  // 1.9.402 (7번째 버그헌트 P1-A 잔여, UR-0108): MD projection 라인 안전화(개행→공백)
  _lineSafe,
  // 1.9.407 (8번째 버그헌트, UR-0111): --limit 안전 파싱(NaN/음수/0 → 기본값)
  _parseLimit,
  // 1.9.416 (9th 외부평가, UR-0122): add 류 제목 파싱(flag/경로 break) 단일 출처
  _parseAddTitle,
  // 1.9.442 (12th 외부평가, UR-0141): task 계열 positional path 안전 추출
  _taskPositionalPath,
  // 1.9.443 (GPT-5.5 전략리뷰 §6.3, UR-0153): evidence-first 완료 게이트
  _completionClaimAllowed,
  // 1.9.446 (R-0011/UR-0160): npm 배포 minor-gate
  _minorKey, _shouldPublishNpm
};

// 1.9.355 (UR-0075 Phase A): AI 에이전트용 크로스버전 마이그레이션 안전 워크플로 가이드 (순수 텍스트). 임시설치 + --path + 백업 + diff 검증.
function _migrationGuideText(version) {
  const v = version || 'latest';
  const L = [
    '# leerness 크로스버전 마이그레이션 가이드 (UR-0075, AI 에이전트용)',
    '',
    '아주 오래된 구버전부터 신규(' + v + ')까지 — 기존 프로젝트의 .harness 내용을 안전·비파괴로 마이그레이션.',
    '',
    '## 0. 원칙',
    '- 비파괴: leerness 는 migrate/update 시 .harness/archive 에 자동 백업. 그래도 git 커밋/브랜치 선행 권장.',
    '- dry-run 우선: 먼저 --check 로 감지, diff 로 확인 후 적용.',
    '',
    '## 1. 안전 스냅샷 (권장)',
    '  git add -A && git commit -m "chore: pre-leerness-migration snapshot"   # 또는 브랜치: git checkout -b chore/leerness-migrate',
    '',
    '## 2. 신규 버전 감지 (구버전 프로젝트 대상)',
    '  npx leerness@latest update --check --path <project>      # 현재 버전 vs 최신 비교 (네트워크 비차단, 비파괴)',
    '',
    '## 3. 마이그레이션 적용 (임시설치 = npx 캐시, 격리)',
    '  npx leerness@latest update --yes --path <project>        # 자동 마이그레이션 (.harness/archive 백업 + 신 스키마 반영)',
    '  # 또는: npx leerness@latest migrate <project> --force    # 강제 재스캐폴딩 — 관리 .md 를 템플릿으로 교체(기존 내용은 .harness/archive 로 백업, in-place 보존 아님). 커스텀 편집 보존은 --force 없이 migrate / update --yes 사용',
    '',
    '## 4. 검증 (필수)',
    '  git -C <project> diff                                    # 생성/수정 파일 전수 확인 (예상치 못한 변경 점검)',
    '  npx leerness@latest selftest                             # 코어 무결성 (위치독립, 어디서든 통과)',
    '  npx leerness@latest check --path <project>               # 프로젝트 무결성',
    '  npx leerness@latest doctor                               # 설치 진단',
    '',
    '## 5. 크로스버전 메모',
    '- decisions/lessons: 구 MD-only → canonical JSON 자동 백필(첫 write 시). decisions.json/lessons.json 이 진실소스, .md 는 projection.',
    '- 아주 구버전: update 가 단계적으로 누적 마이그레이션. 한 번에 안 되면 update --yes 재실행.',
    '- 보호 파일(.harness/protected-files.md): 삭제 금지 — merge/archive/deprecated 마커 사용.',
    '',
    '## 6. 롤백',
    '  git -C <project> checkout -- .                           # git 스냅샷 복원',
    '  # 또는 .harness/archive/<timestamp> 에서 수동 복구 · leerness memory restore <surface> <target>',
    ''
  ];
  return L.join('\n');
}

// 1.9.385 (UR-0086, 5번째 외부평가): contract spec 함수/필드 추출 — 순수 파서.
//   declared(강선언, 검사 대상): "function name(" + markdown bullet "- name(args)" / "* " / "1. ".
//   mentioned(약언급, 표시만): backtick `name(` — 산문 인라인 언급일 수 있어 누락검사 제외(기존 관대성 유지).
//   fields: tick.name. bullet 패턴은 name 직후 '(' (공백 불허) → 산문 "- 합 (a+b)" 오탐 방지, ASCII 식별자만.
function _parseContractSpec(specText) {
  // 1.35.11 (codex 교차 헌트 #9): 코드펜스(```...```) 안 예제 코드를 계약으로 오인하던 FP — 예: spec 의 ```js function helper(){} ``` 가 declared 로 잡혀 impl 에 helper 강제.
  //   모든 선언/필드 추출은 펜스 제거본(펜스→개행 치환, 줄 구조 보존)에서 수행. 인라인 single-backtick 은 미영향(triple-backtick 블록만 제거).
  const s = (specText || '').replace(/```[\s\S]*?```/g, '\n');
  const declared = new Set();
  const mentioned = new Set();
  const fields = new Set();
  for (const m of s.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) declared.add(m[1]);
  // 1.9.433 (11th 외부평가 Opus P1): bullet 시작 backtick 허용 — `- ` + ` `name()` `(CLI 자체 관례)도 강선언. 인라인 산문 backtick(아래)은 약언급 유지.
  for (const m of s.matchAll(/^\s*(?:[-*+]|\d+\.)\s+`?([A-Za-z_$][\w$]*)\(/gm)) declared.add(m[1]);
  for (const m of s.matchAll(/`([A-Za-z_$][\w$]*)\s*\(/g)) mentioned.add(m[1]);
  for (const m of s.matchAll(/tick\.([A-Za-z_$][\w$]*)/g)) fields.add(m[1]);
  // 1.9.417 (9th 외부평가 Opus, UR-0123): `## Fields`(또는 `## 필드`) 섹션 불릿도 필드로 인식.
  //   기존엔 tick. 프리픽스 전용이라 범용 spec 의 필드 계약이 무력화(원래 TICK_SPEC 예제 잔재). 섹션 한정 파싱이라 산문 오탐 없음.
  //   불릿 식별자 추출: "- userId" / "* userId: string" / "- userId (설명)" → userId. 식별자 직후 ( 면 함수라 제외(:|공백|줄끝만 허용).
  {
    const lines = s.split(/\r\n?|\n/);
    let inFields = false;
    for (const line of lines) {
      const h = line.match(/^#{1,6}\s+(.+?)\s*$/);
      if (h) { const t = h[1].trim().toLowerCase(); inFields = t === 'fields' || t.startsWith('fields ') || h[1].trim().startsWith('필드'); continue; }
      if (!inFields) continue;
      // 1.9.433 (11th 외부평가 Codex P2): bullet 시작 backtick 허용 — `- ` + ` `name`: desc `(설명 붙은 필드 관용 표기)도 필드로 인식.
      const b = line.match(/^\s*(?:[-*+]|\d+\.)\s+`?([A-Za-z_$][\w$]*)`?\s*(?::|\s|$)/);
      if (b) fields.add(b[1]);
    }
  }
  return { declared: [...declared], mentioned: [...mentioned], fields: [...fields] };
}

// 1.9.386 (UR-0087, 5번째 외부평가): 간이 glob → 정규식. '*' → [^/]* (경로구분 제외), 나머지는 리터럴.
function _globToRe(glob) {
  const esc = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp('^' + esc + '$');
}
// 1.9.386 (UR-0087, 5번째 외부평가): 간이 .gitignore 매칭 (순수). full semantics 아님 — 정확매칭 / glob(*) / dir(/) 지원.
//   1.9.365 의 과잉 휴리스틱(bare '.env' → 모든 '.env.*' 보호) 제거 → git 실제 동작과 일치:
//   '.env' 는 '.env' 만 매칭(.env.bad 미보호 = 커밋 대상). '.env.*' / '.env*' 같은 명시 glob 만 .env.bad 보호.
function _gitignoreMatch(giText, fileRel) {
  if (!giText) return false;
  const relPosix = String(fileRel).replace(/\\/g, '/');
  const base = relPosix.split('/').pop();
  // 1.9.401 (7번째 버그헌트 P1-C, UR-0106): 부정(!) 패턴 + last-match-wins(git 실제 동작).
  //   종전: '!' 라인 무시 → '*.example' + '!.env.example' 시 .env.example(커밋대상)을 gitignored 로 오판 → 시크릿 FN.
  //   수정: 매칭마다 ignored 갱신, '!' 매칭은 un-ignore, 마지막 매칭이 최종.
  let ignored = false;
  for (let pat of String(giText).split(/\r?\n/)) {
    pat = pat.trim();
    if (!pat || pat.startsWith('#')) continue;
    let negate = false;
    if (pat.startsWith('!')) { negate = true; pat = pat.slice(1); }
    const isDir = pat.endsWith('/');
    const p = pat.replace(/^\/+|\/+$/g, '');
    if (!p) continue;
    let m = false;
    if (p === relPosix || p === base) m = true;                                     // 정확 매칭 (.env → .env)
    else if (isDir && (relPosix === p || relPosix.startsWith(p + '/'))) m = true;   // dir/
    else if (p.includes('*')) { const re = _globToRe(p); if (re.test(p.includes('/') ? relPosix : base)) m = true; }  // glob
    if (m) ignored = !negate;  // last-match-wins; '!' 는 un-ignore
  }
  return ignored;
}

// 1.9.390 (UR-0025): feature-graph 순수 코어 — 템플릿/파서/ID/블록 렌더 (I/O 없음). harness 의 _readFeatureGraph/_writeFeatureGraph 가 사용.
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
  const re = /^## (F-\d{4,})\s+(.+?)\s*$/gm;
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
function _nextFeatureId(nodes) {
  const used = new Set(nodes.map(n => parseInt(n.id.slice(2), 10)));
  let n = 1; while (used.has(n)) n++;
  return 'F-' + String(n).padStart(4, '0');
}
function _featureBlock(node) {
  // 1.11.1 (14th 버그헌트 P1, UR-0177): 모든 보간 값 _lineSafe(개행→공백) — 기존엔 title/input/output/notes 를 raw 기록해 'X\n## F-9999 …' 로 가짜 노드(헤더) 위조 가능했음. decisions/lessons(_lineSafe)와 동일 정책.
  const arr = (a) => (a || []).map(_lineSafe).join(', ');
  return `## ${node.id} ${_lineSafe(node.title || '')}\n` +
    `- depends-on: ${arr(node.dependsOn)}\n` +
    `- affects: ${arr(node.affects)}\n` +
    `- co-changes-with: ${arr(node.coChangesWith)}\n` +
    `- files: ${arr(node.files)}\n` +
    `- input: ${_lineSafe(node.input || '')}\n` +
    `- output: ${_lineSafe(node.output || '')}\n` +
    `- error-modes: ${arr(node.errorModes)}\n` +
    `- tests: ${arr(node.tests)}\n` +
    `- notes: ${_lineSafe(node.notes || '')}\n\n`;
}
// 1.9.391 (UR-0025): feature 영향 BFS — affects + co-changes-with transitive + depends-on 역방향. 순수(nodes,startId→result). harness(handoff/audit)+lib/feature 공유.
function _featureImpactBfs(nodes, startId) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  // 역방향 인접: X 에 depends-on 하는 노드들 (BFS 안에서 전이 확장하려고 사전 구축)
  const dependents = new Map();
  for (const n of nodes) for (const dep of n.dependsOn || []) {
    if (!dependents.has(dep)) dependents.set(dep, []);
    dependents.get(dep).push(n.id);
  }
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
    // 1.36.28 (codex 미검토표면 헌트 #8): 역방향 depends-on 도 BFS 안에서 확장 — 전이 영향(A←B←C 에서 A 변경이 C 까지)을
    //   잡는다. 종전엔 BFS 종료 후 1-홉만 추가해 간접 의존이 누락됐다. visited 로 사이클 안전.
    for (const next of dependents.get(cur.id) || []) queue.push({ id: next, depth: cur.depth + 1, via: 'depends-on(reverse)' });
  }
  return result;
}
// 1.9.393 (UR-0025): CHANGELOG 버전 구간 차분 파서 — from < V <= to 섹션 + 신규 명령/플래그/파일 추출. 순수. harness(update/whats-new) 공유.
//   BUG-fix(1.9.393): (1) 헤더 꼬리가 '## X — DATE — title' 의 ' — title' 를 소비 못 해 0건 반환 → 헤더에 '[^\n]*' 허용.
//   (2) 기존 본문 캡처 '([\s\S]*?)(?=^##…|$)' 가 /m 모드 '$'(줄 끝) 때문에 본문을 첫 줄로 절단 → _parseFeatureGraph 식 '위치 기반 분할'로 교체.
//   '## X'(제목 없음) / '## X — DATE' / '## X — DATE — title' 모두 매칭, 본문은 다음 헤더(또는 끝)까지 전체 캡처.
function _parseChangelogBetween(changelogText, fromV, toV) {
  const text = changelogText || '';
  const headerRe = /^## (\d+\.\d+\.\d+)(?:\s+—\s+(\d{4}-\d{2}-\d{2}))?[^\n]*$/gm;
  const positions = [];
  let hm;
  while ((hm = headerRe.exec(text)) !== null) positions.push({ version: hm[1], date: hm[2] || null, start: hm.index, bodyStart: hm.index + hm[0].length });
  const sections = [];
  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1].start : text.length;
    sections.push({ version: positions[i].version, date: positions[i].date, body: text.slice(positions[i].bodyStart, end).trim() });
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
// 1.9.399 (7번째 버그헌트 P1-A, UR-0104): markdown 테이블 셀 안전화 — 개행(행 주입)·파이프(컬럼 시프트) 차단.
//   _cellSafe: 쓰기 시 개행→공백, '|'→'\|'(이스케이프). _cellUnescape: 읽기 시 '\|'→'|' 복원.
//   table 파서는 split(/(?<!\\)\|/) 로 비이스케이프 파이프에서만 분리 → 사용자 텍스트의 파이프/개행이 데이터 손상·가짜행 주입을 못 일으킴.
function _cellSafe(s) { return String(s == null ? '' : s).replace(/\r\n|\r|\n/g, ' ').replace(/\|/g, '\\|'); }
function _cellUnescape(s) { return String(s == null ? '' : s).replace(/\\\|/g, '|'); }
// 1.9.402 (7번째 버그헌트 P1-A 잔여, UR-0108): 라인 안전화 — 개행만 공백으로(파이프 보존). decisions/lessons MD projection 의 '### '/'- field:' 라인 개행 주입 차단(canonical JSON 은 raw 유지).
function _lineSafe(s) { return String(s == null ? '' : s).replace(/\r\n|\r|\n/g, ' '); }
// 1.9.407 (8번째 버그헌트, UR-0111): --limit 안전 파싱 — NaN(예: '--limit abc')/음수/0 은 slice(0,NaN)=[] 로 모든 결과를 조용히 숨김 → 기본값으로 폴백.
function _parseLimit(raw, def) { const n = parseInt(raw, 10); return (Number.isFinite(n) && n > 0) ? n : def; }

// 1.9.446 (R-0011/UR-0160): npm 배포 minor-gate. current(현재 버전) vs published(npm latest) 의 major.minor 비교.
//   minor 가 올라갔으면(또는 최초/major↑) publish, 같은 minor 내 patch 면 skip. force 면 무조건 publish.
function _minorKey(v) { const m = String(v || '').match(/^(\d+)\.(\d+)/); return m ? `${m[1]}.${m[2]}` : null; }
function _shouldPublishNpm(current, published, force) {
  if (force) return { publish: true, reason: 'forced' };
  const cm = String(current || '').match(/^(\d+)\.(\d+)/);
  if (!cm) return { publish: false, reason: 'invalid_current' };
  const pm = String(published || '').match(/^(\d+)\.(\d+)/);
  if (!pm) return { publish: true, reason: 'no_published' };          // 최초 배포
  const c = [Number(cm[1]), Number(cm[2])], p = [Number(pm[1]), Number(pm[2])];
  if (c[0] > p[0] || (c[0] === p[0] && c[1] > p[1])) return { publish: true, reason: 'minor_bump' };  // major/minor ↑
  if (c[0] === p[0] && c[1] === p[1]) return { publish: false, reason: 'same_minor' };                // patch — 미배포
  return { publish: false, reason: 'not_ahead' };                                                      // 동일/하위
}

// 1.9.416 (9th 외부평가 Sonnet/Codex, UR-0122): add 류(task/requests/decision) 제목 파싱 단일 출처.
//   positional 을 join 하되 첫 --flag 또는 경로형 토큰(/x, C:\x, ./x, ../x)에서 멈춤 →
//   `task add "제목" /some/path` 가 경로를 제목에 흡수하던 오염(decision add 는 이미 차단)을 일관 적용.
function _parseAddTitle(args, startIdx = 0) {
  const parts = [];
  for (let i = startIdx; i < (args || []).length; i++) {
    const a = args[i];
    if (typeof a !== 'string') break;
    if (a.startsWith('--') || /^([A-Za-z]:[\\/]|\/|\.\.?[\\/])/.test(a)) break;
    parts.push(a);
  }
  return parts.join(' ').trim();
}

// 1.9.442 (12th 외부평가 Sonnet UR-0141): task 계열 positional path 안전 추출.
//   _parseAddTitle 과 동일한 path-like 판정(선행 구분자 / ./ ../ C:\)으로 제목/ID/맨이름은 경로로 오인 안 함(src/auth 같은 내부 슬래시 제목 보호).
//   값-취하는 플래그(--evidence /abs/log 등)의 값은 root 후보에서 제외(직전 토큰이 값-플래그면 skip) → 오탐 차단. 첫 path-like positional 만 반환, 없으면 null.
const _TASK_VALUE_FLAGS = new Set(['--status', '--evidence', '--priority', '--note', '--reason', '--title', '--desc', '--summary', '--id', '--limit', '--from', '--to', '--trigger', '--tag', '--files', '--depends-on', '--affects', '--co-changes-with']);  // 1.9.445 (UR-0151): rule/lesson add 값-플래그(--trigger/--tag) 포함. 1.36.2 (UR-0184): feature add 값-플래그(--files 등) 값이 path-like 여도 root 로 오인 안 하게 포함
function _taskPositionalPath(args, startIdx = 2) {
  const a = args || [];
  for (let i = startIdx; i < a.length; i++) {
    if (typeof a[i] !== 'string') continue;
    if (_TASK_VALUE_FLAGS.has(a[i - 1])) continue;          // 값-플래그의 값(예: --evidence /abs) 은 경로 아님
    if (a[i].startsWith('-')) continue;                       // 플래그 자체 제외
    if (/^([A-Za-z]:[\\/]|\/|\.\.?[\\/])/.test(a[i])) return a[i];  // 선행 구분자 path-like 만
  }
  return null;
}
