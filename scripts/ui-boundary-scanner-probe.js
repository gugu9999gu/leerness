'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { scanUiBoundary: scan, UiBoundaryScanError, INPUT_SCHEMA, OUTPUT_SCHEMA, SCANNER_VERSION,
  POLICY_VERSION, MAX_INPUT_BYTES, MAX_SURFACES, MAX_TEXT_BYTES } = require('../lib/ui-boundary-scanner');
const { validateUiBoundaryReview } = require('../lib/ui-boundary-contracts');
const { SECRET_PATTERNS } = require('../lib/catalogs');
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const surface = (text, extra = {}) => ({ kind: 'text', exposure: 'rendered', text, attribute: null, ...extra });
const packet = (surfaces = [], taskKind = 'ui') => ({ schema: INPUT_SCHEMA, policyVersion: POLICY_VERSION, taskKind, surfaces });
const run = (text, extra) => scan(JSON.stringify(packet([surface(text, extra)])));
const evaluate = value => scan(JSON.stringify(value));
const key = 'gh' + 'p_' + 'a1B2c3D4'.repeat(5);
const mixed = 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ';
function noAuthority(result) {
  assert.deepEqual(result.verification, { sourceVerified: false, renderVerified: false, semanticVerified: false, independentReview: 'not-run' });
  assert.ok(Object.values(result.effects).every(value => value === false));
  assert.equal(result.review.evidenceVerified, false);
  assert.deepEqual(validateUiBoundaryReview(result.review), result.review);
}
function reject(value, code, field) {
  assert.throws(() => scan(value), e => {
    assert.ok(e instanceof UiBoundaryScanError);
    assert.equal(e.code, 'ui_boundary_scan_' + code);
    if (field) assert.equal(e.field, field);
    assert.ok(!JSON.stringify(e).includes('PRIVATE_MARKER'));
    assert.ok(!String(e).includes('PRIVATE_MARKER'));
    return true;
  });
}

const positives = [
  ['unfinished action', 'TODO: 연결 필요', 'developer-marker', 'DEVELOPER_NOTE'],
  ['fix marker', '  FIXME: replace label', 'developer-marker', 'DEVELOPER_NOTE'],
  ['bracket marker', '[TODO] wire the button', 'developer-marker', 'DEVELOPER_NOTE'],
  ['lowercase note', 'todo: replace this', 'developer-marker', 'DEVELOPER_NOTE'],
  ['Korean adjacent note', 'TODO:연결 필요', 'developer-marker', 'DEVELOPER_NOTE'],
  ['later line note', 'Title\r\nTODO: replace', 'developer-marker', 'DEVELOPER_NOTE'],
  ['placeholder', 'Lorem ipsum dolor sit amet', 'placeholder-copy', 'DEVELOPER_NOTE'],
  ['debug line', 'DEBUG: payload received', 'debug-prefix', 'DEBUG_METADATA'],
  ['lowercase adjacent debug', 'debug:내부 상태', 'debug-prefix', 'DEBUG_METADATA'],
  ['bracket debug', '[DEBUG] internal event', 'debug-prefix', 'DEBUG_METADATA'],
  ['exception', 'Uncaught TypeError: cannot read property', 'exception-detail', 'DEBUG_METADATA'],
  ['stack frame', 'Error: failed\n    at execute (C:\\private\\app.js:20:4)', 'stack-frame', 'DEBUG_METADATA'],
  ['unix stack', '    at /srv/app.js:5:20', 'stack-frame', 'DEBUG_METADATA'],
  ['python stack', 'Traceback (most recent call last):\n  File "/private/app.py", line 3, in run', 'python-traceback', 'DEBUG_METADATA'],
  ['localhost endpoint', 'http://localhost:3000/api', 'loopback-url', 'DEBUG_METADATA'],
  ['ipv4 endpoint', 'https://127.0.0.1/path', 'loopback-url', 'DEBUG_METADATA'],
  ['ipv6 endpoint', 'http://[::1]:3000/', 'loopback-url', 'DEBUG_METADATA'],
  ['raw metadata', 'debug payload: internal events', 'internal-metadata', 'DEBUG_METADATA'],
  ['raw status', 'raw_status = STATE_WAITING_09', 'internal-metadata', 'DEBUG_METADATA'],
  ['quoted internal label', '"system_prompt": "internal instruction"', 'internal-metadata', 'DEBUG_METADATA'],
  ['JSON internal label', '{"status":"ok","system_prompt":"internal instruction"}', 'internal-metadata', 'DEBUG_METADATA'],
  // v2: a matching view keeps full-width, wide-space, zero-width and bulleted markers recognizable.
  ['full-width colon', 'TODO\uFF1Areplace', 'developer-marker', 'DEVELOPER_NOTE'],
  ['full-width letters', '\uFF34\uFF2F\uFF24\uFF2F\uFF1Areplace', 'developer-marker', 'DEVELOPER_NOTE'],
  ['non-breaking indent', '\u00A0TODO: replace', 'developer-marker', 'DEVELOPER_NOTE'],
  ['zero-width split', 'TO\u200BDO: replace', 'developer-marker', 'DEVELOPER_NOTE'],
  ['bulleted marker', '• TODO: replace', 'developer-marker', 'DEVELOPER_NOTE'],
  ['hack marker', 'HACK: success message until backend is ready', 'developer-marker', 'DEVELOPER_NOTE'],
  ['developer note label', 'Developer note: add a meaningful label here', 'developer-note-label', 'DEVELOPER_NOTE'],
  ['internal note label', 'Internal note: swap these testimonials', 'developer-note-label', 'DEVELOPER_NOTE'],
  ['Korean developer memo', '개발자 메모: 정식 출시 전에 제목 교체', 'developer-note-label', 'DEVELOPER_NOTE'],
  ['Korean bracket label', '[작업 필요] 목록 생성 버튼 연결', 'developer-note-label', 'DEVELOPER_NOTE'],
  ['Korean full-width label', '수정 필요\uFF1A결제 연동 후 이 문구 제거', 'developer-note-label', 'DEVELOPER_NOTE'],
  ['filler copy', 'Placeholder text — waiting for marketing', 'placeholder-copy', 'DEVELOPER_NOTE'],
  ['Korean temporary copy', '임시 문구입니다', 'placeholder-copy', 'DEVELOPER_NOTE'],
  ['before shipping', 'Replace me before shipping', 'maintenance-note', 'DEVELOPER_NOTE'],
  ['Korean replace when confirmed', '다국어 문구 확정되면 교체', 'maintenance-note', 'DEVELOPER_NOTE'],
  ['Korean fix later', '임시 버튼 - 나중에 수정', 'maintenance-note', 'DEVELOPER_NOTE'],
  ['visible HTML comment', '<!-- replace hero -->', 'rendered-comment', 'DEVELOPER_NOTE'],
  ['visible line comment', '// wire up analytics', 'rendered-comment', 'DEVELOPER_NOTE'],
  ['Korean debug label', '디버그: 선택된 숙소 ID = 42', 'debug-prefix', 'DEBUG_METADATA'],
  ['exception after a localized prefix', '저장 실패: TypeError: invalid value', 'exception-detail', 'DEBUG_METADATA'],
  ['camelCase metadata key', '{"rawResponse":{"ok":true}}', 'internal-metadata', 'DEBUG_METADATA'],
  ['object coercion', '[object Object]', 'object-coercion', 'DEBUG_METADATA'],
  ['object coercion in a label', '닫기 [object Object]', 'object-coercion', 'DEBUG_METADATA'],
  ['unresolved mustache', '{{user.name}}님의 대시보드', 'unresolved-template', 'DEBUG_METADATA'],
  ['unresolved Hangul mustache', '{{페이지제목}}', 'unresolved-template', 'DEBUG_METADATA'],
  ['unresolved template literal', '${price}원', 'unresolved-template', 'DEBUG_METADATA'],
  ['unresolved format specifier', '%s님, 환영합니다', 'unresolved-template', 'DEBUG_METADATA'],
  ['missing value greeting', 'undefined님, 환영합니다!', 'missing-value', 'DEBUG_METADATA'],
  ['missing count', '총 NaN개의 상품', 'missing-value', 'DEBUG_METADATA'],
  ['missing labelled value', '조회 결과: undefined', 'missing-value', 'DEBUG_METADATA'],
  ['missing price', '$NaN', 'missing-value', 'DEBUG_METADATA'],
  ['invalid date', 'Invalid Date', 'missing-value', 'DEBUG_METADATA'],
  ['raw localization key', 'home.hero.title', 'raw-i18n-key', 'DEBUG_METADATA'],
  ['response dump', '{"ok":true,"savedId":42}', 'json-dump', 'DEBUG_METADATA'],
  ['labelled response dump', '상태 확인: {"state":"idle","retry":0}', 'json-dump', 'DEBUG_METADATA'],
  // Independent review (Codex, 1.36.288): exemptions that were too broad, and JSON framing that was too narrow.
  ['object coercion before an ordinary verb', 'Your order [object Object] is ready.', 'object-coercion', 'DEBUG_METADATA'],
  ['object coercion opening a sentence', '[object Object] is typing…', 'object-coercion', 'DEBUG_METADATA'],
  // Same class in Korean: a topic particle alone is an ordinary sentence, not an explanation.
  ['object coercion as a Korean topic', '[object Object]는 품절입니다.', 'object-coercion', 'DEBUG_METADATA'],
  ['explanation word in the next sentence', '[object Object]는 품절입니다. 다른 상품은 아래에 표시됩니다.', 'object-coercion', 'DEBUG_METADATA'],
  ['placeholder beside the word variable', 'Your variable interest rate is ${rate}%.', 'unresolved-template', 'DEBUG_METADATA'],
  ['template word on another line', 'Choose a template\nWelcome, {{name}}', 'unresolved-template', 'DEBUG_METADATA'],
  ['template product price', '템플릿 구매 가격: ${price}원', 'unresolved-template', 'DEBUG_METADATA'],
  ['full-width quote inside a JSON string', '{"message":"\uFF02"}', 'json-dump', 'DEBUG_METADATA'],
  ['JSON after a leading newline', '\n{"ok":true}', 'json-dump', 'DEBUG_METADATA'],
  ['JSON on the line after its label', 'state:\n{"ok":true}', 'json-dump', 'DEBUG_METADATA'],
];
for (const [name, text, code, subtype] of positives) test(name, () => {
  const r = run(text); assert.equal(r.status, 'findings'); assert.equal(r.findings.length, 1);
  const f = r.findings[0]; assert.equal(f.category, 'instruction_to_ui_leakage');
  assert.equal(f.subtype, subtype); assert.ok(f.signals.some(s => s.code === code));
  assert.equal(f.severity, 'advisory'); assert.equal(f.disposition, 'review-remediation');
  assert.equal(f.certainty, 'candidate'); assert.ok(!JSON.stringify(r).includes(text)); noAuthority(r);
});
for (const name of ['data-debug', 'data-debug-only', 'data-internal-debug', 'data-source-prompt']) test('debug attribute ' + name, () => {
  const r = run('', { kind: 'attribute', attribute: name });
  assert.equal(r.findings[0].signals[0].code, 'debug-attribute'); noAuthority(r);
});

// Human-labelled controls for this finite syntax policy, not a corpus estimate.
const controls = [
  '저장', '다시 시도', '작업 상태', '실행 모델', 'OpenAI', 'Claude', 'React 시작하기',
  'Next.js 설정', 'Node.js 버전', 'DEBUG 모드 안내', 'Todo list', 'FIXME라는 주석의 의미',
  'Learn about TODO: comments', 'localhost 연결 설정', '127.0.0.1 주소 안내',
  'https://localhost.example.com/path', 'https://127.0.0.10/path', 'https://example.com/localhost',
  'model: example-model', 'agent: reviewer', 'status: running', 'HTTP 500 오류: 다시 시도하세요',
  'Error recovery guide', 'TypeError handling', 'Stack trace documentation', 'Basic authentication flow',
  'API key 설정', 'Bearer 인증', 'password="provided"', 'api_key="your-api-key-here"',
  // v2 counterexamples: legitimate copy next to each new rule.
  '할 일 3개 남음', 'TODO 리스트 앱 — 할 일을 추가해 보세요', 'Life hack: 5분 정리법', 'Note: changes apply to all members.',
  'The Developer notes section lists release changes.', '수정 필요 항목 3건', '개발 중인 기능입니다',
  '임시 저장됨', '임시 비밀번호가 발급되었습니다', '배터리 교체 예정일: 10월 3일', '나중에 다시 연결해 주세요',
  '기기를 나중에 연결할 수 있어요', '추후 지원 예정', 'Replace this photo', 'Remove before use',
  '[object Object] means an object was converted to a string.', '[object Object]는 객체를 문자열로 변환할 때 표시됩니다.',
  '[object Object]란 객체가 문자열로 바뀐 결과입니다.', '[object Object]가 보이면 값이 객체로 전달된 것입니다.',
  '[object Object]는 객체가 문자열로 변환되었다는 뜻입니다.',
  'Template variables like {{name}} are replaced when the email is sent.', '템플릿 변수 {{고객명}}은 발송할 때 바뀝니다',
  'NaN은 숫자가 아닌 연산 결과를 나타냅니다.', 'Undefined variables are highlighted in red.', 'Null safety explained',
  'The limit is undefined at x = 0.', 'naver.com', 'config.json', 'Node.js', 'leerness.dev', 'e.g.', 'v1.2.3',
  'JSON으로 내보내기', '[1, 2, 3]', 'Price: $19.99', '할인율 30%', '100% 완료', 'https://example.com/docs',
  'example.info', 'archive.tar.gz', 'report.final.docx',
];
for (const text of controls) test('normal control ' + text, () => {
  const r = run(text); assert.equal(r.status, 'no-pattern-match'); assert.deepEqual(r.findings, []); noAuthority(r);
});
test('ordinary attribute is not a blanket metadata ban', () => {
  for (const attribute of ['data-model', 'data-agent', 'data-status', 'aria-label', 'title', 'href']) {
    assert.equal(run('Running', { kind: 'attribute', attribute }).findings.length, 0);
  }
});
test('technical docs with exact debug syntax remain advisory, never auto removed', () => {
  noAuthority(run('http://localhost:3000'));
  assert.equal(run('TODO: example of a comment').findings[0].severity, 'advisory');
});
// Tooling products legitimately show these shapes (a template editor's variable, a localization
// manager's key, an API client's response). Syntax cannot tell; the candidate goes to review.
test('tooling-context artifacts stay advisory review candidates', () => {
  for (const text of ['{{customer.name}}', 'home.title', '{"id":7,"status":"sent"}']) {
    const r = run(text); assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].severity, 'advisory'); assert.equal(r.findings[0].disposition, 'review-remediation'); noAuthority(r);
  }
});
test('matching view never rewrites the supplied text or its evidence', () => {
  const s = surface('\uFF34\uFF2F\uFF24\uFF2F\uFF1Areplace\u00A0now');
  const r = evaluate(packet([s]));
  assert.equal(r.findings[0].evidenceDigest, 'sha256:' + crypto.createHash('sha256').update(JSON.stringify([
    SCANNER_VERSION, POLICY_VERSION, 'ui', 0, s.kind, s.exposure, s.attribute, s.text,
  ])).digest('hex'));
  assert.ok(!JSON.stringify(r).includes('TODO:replace'));
});
test('several new signals on one surface stay one finding with every signal kept', () => {
  const r = run('개발자 메모: 교체\n{{title}}\n[object Object]');
  assert.equal(r.findings.length, 1); assert.equal(r.findings[0].subtype, 'DEBUG_METADATA');
  assert.deepEqual(r.findings[0].signals.map(s => s.code).sort(), ['developer-note-label', 'object-coercion', 'unresolved-template']);
});

const securityCases = [
  ['AWS Access Key', 'AK' + 'IA' + 'AB12CD34EF56GH78'],
  ['GitHub token', key],
  ['GitHub fine-grained PAT', 'github_' + 'pat_' + mixed.repeat(2)],
  ['OpenAI project/service key', 'sk-' + 'proj-' + mixed],
  ['OpenAI API key', 'sk-' + mixed],
  ['Anthropic API key', 'sk-' + 'ant-api03-' + mixed],
  ['Stripe secret key', 'sk_' + 'live_' + mixed],
  ['npm token', 'npm_' + 'a1B2'.repeat(9)],
  ['Google API key', 'AI' + 'za' + 'a1B2c'.repeat(7)],
  ['Google OAuth token', 'ya' + '29.' + mixed],
  ['Slack token', 'xo' + 'xb-' + mixed],
  ['Generic private key', '-----BE' + 'GIN PRIVATE KEY-----'],
  ['Hardcoded password assignment', 'pass' + 'word="q7W8e9R0u1"'],
  ['Hardcoded credential (unquoted)', 'api_' + 'key=q7W8e9R0u1'],
  ['GitLab PAT', 'gl' + 'pat-' + mixed],
  ['JWT', 'ey' + 'J' + mixed + '.eyJ' + mixed + '.' + mixed],
  ['DB connection string (embedded password)', 'postgres' + '://operator:q7W8e9R0u1@db.invalid/app'],
  ['SendGrid API key', 'S' + 'G.' + mixed.slice(0, 22) + '.' + mixed.repeat(2).slice(0, 43)],
  ['AWS Secret Access Key (context)', 'aws_secret_' + 'access_key = "' + mixed.repeat(2).slice(0, 40) + '"'],
  ['Hardcoded Bearer token', 'Bear' + 'er ' + mixed],
];
for (const [name, text] of securityCases) test('shared catalog ' + name, () => {
  const r = run(text); assert.equal(r.findings.length, 1); const f = r.findings[0];
  assert.equal(f.category, 'security'); assert.equal(f.severity, 'delegated');
  assert.ok(f.securityPatterns.includes(name)); assert.equal(f.subtype, 'DEBUG_METADATA');
  assert.equal(f.disposition, 'review-remediation'); assert.ok(!JSON.stringify(r).includes(text)); noAuthority(r);
});
test('Bearer catalog detects slash and plus within opaque tokens', () => {
  const pattern = SECRET_PATTERNS.find(p => p.name === 'Hardcoded Bearer token');
  assert.ok(pattern);
  for (const token of ['abc12345/' + mixed, 'abc12345+' + mixed]) {
    const text = 'Bearer ' + token;
    assert.equal(new RegExp(pattern.re.source, pattern.re.flags).test(text), true);
    const result = run(text);
    assert.equal(result.findings.length, 1);
    assert.ok(result.findings[0].securityPatterns.includes('Hardcoded Bearer token'));
    assert.ok(!JSON.stringify(result).includes(token));
  }
});
test('Bearer catalog retains short-token and unrelated-prose boundaries', () => {
  const pattern = SECRET_PATTERNS.find(p => p.name === 'Hardcoded Bearer token');
  for (const text of ['Bearer abc12/+', 'Use Bearer authentication for API requests']) {
    assert.equal(new RegExp(pattern.re.source, pattern.re.flags).test(text), false);
  }
});
test('all current security catalog rules have a fixture', () => {
  assert.deepEqual(securityCases.map(c => c[0]), SECRET_PATTERNS.map(p => p.name));
});
test('overlapping UI and security signals yield one security finding', () => {
  const r = run('TODO: remove\nDEBUG: api_key="' + key + '"');
  assert.equal(r.findings.length, 1); const f = r.findings[0];
  assert.equal(f.category, 'security'); assert.equal(f.signals.length, 2);
  assert.ok(f.securityPatterns.length >= 2); assert.equal(r.review.findings.length, 1);
});
test('repeated secrets and markers do not multiply a surface finding', () => {
  const r = run(('DEBUG: ' + key + '\n').repeat(20));
  assert.equal(r.findings.length, 1); assert.equal(r.findings[0].securityPatterns.length, 1);
});
test('two different secrets preserve both pattern kinds in one surface', () => {
  const r = run(key + '\n' + securityCases[0][1]);
  assert.equal(r.findings.length, 1); assert.equal(r.findings[0].securityPatterns.length, 2);
});
test('same text in distinct surfaces remains distinct with distinct evidence', () => {
  const r = evaluate(packet([surface(key), surface(key)]));
  assert.deepEqual(r.findings.map(f => f.surfaceIndex), [0, 1]);
  assert.notEqual(r.findings[0].evidenceDigest, r.findings[1].evidenceDigest);
});
test('proposed security withholds pending review without granting enforcement', () => {
  const r = run(key, { exposure: 'proposed' });
  assert.equal(r.findings[0].disposition, 'withhold-pending-review'); noAuthority(r);
});
test('proposed UI candidate stays advisory', () => {
  const r = run('TODO: connect', { exposure: 'proposed' });
  assert.equal(r.findings[0].disposition, 'review-remediation'); noAuthority(r);
});
test('placeholder guards also apply to prefixed secrets', () => {
  assert.equal(run('gh' + 'p_' + 'X'.repeat(40)).findings.length, 0);
  assert.equal(run('api_' + 'key="change-me"').findings.length, 0);
});
test('later real match after placeholder still escalates', () => {
  assert.equal(run('gh' + 'p_' + 'X'.repeat(40) + '\n' + key).findings[0].category, 'security');
});
test('secret attribute value still escalates alongside debug attribute', () => {
  const r = run(key, { kind: 'attribute', attribute: 'data-debug' });
  assert.equal(r.findings[0].category, 'security'); assert.equal(r.findings[0].signals[0].code, 'debug-attribute');
});
test('catalog cursors are not consumed or reset', () => {
  const saved = SECRET_PATTERNS.map(p => p.re.lastIndex);
  try {
    SECRET_PATTERNS.forEach(p => { p.re.lastIndex = 7; });
    assert.equal(run(key).findings[0].category, 'security');
    assert.ok(SECRET_PATTERNS.every(p => p.re.lastIndex === 7));
  } finally { SECRET_PATTERNS.forEach((p, i) => { p.re.lastIndex = saved[i]; }); }
});
test('deterministic after intervening unrelated scans', () => {
  const first = run(key); run('TODO: replace'); run('React'); assert.deepEqual(run(key), first);
});
test('review projection carries no raw text, arbitrary key or location', () => {
  const text = 'DEBUG: PRIVATE_MARKER /private/account/path ' + key;
  const r = run(text); const out = JSON.stringify(r);
  for (const value of ['PRIVATE_MARKER', '/private/account/path', key]) assert.ok(!out.includes(value));
  noAuthority(r);
});
test('evidence binds complete surface bytes and metadata in documented order', () => {
  const s = surface('TODO: replace');
  const r = evaluate(packet([s]));
  const expected = 'sha256:' + crypto.createHash('sha256').update(JSON.stringify([
    SCANNER_VERSION, POLICY_VERSION, 'ui', 0, s.kind, s.exposure, s.attribute, s.text,
  ])).digest('hex');
  assert.equal(r.findings[0].evidenceDigest, expected);
  for (const changed of [{ text: s.text + '!' }, { exposure: 'proposed' }, { kind: 'attribute', attribute: 'aria-label' }]) {
    assert.notEqual(evaluate(packet([{ ...s, ...changed }])).findings[0].evidenceDigest, expected);
  }
  assert.notEqual(evaluate(packet([s], 'unknown')).findings[0].evidenceDigest, expected);
});
test('unknown task does not claim applicability or approval', () => {
  const r = evaluate(packet([surface(key)], 'unknown')); assert.equal(r.applicability, 'unknown'); noAuthority(r);
});
test('non UI is not applicable and requests no scans', () => {
  const r = evaluate(packet([], 'non-ui')); assert.equal(r.status, 'not-applicable'); assert.equal(r.scannedSurfaces, 0); noAuthority(r);
});
test('empty UI input is explicitly unobserved', () => {
  const r = evaluate(packet()); assert.equal(r.status, 'no-surfaces'); noAuthority(r);
});
test('all 32 surfaces project without truncation', () => {
  const r = evaluate(packet(Array.from({ length: MAX_SURFACES }, () => surface(key))));
  assert.equal(r.findings.length, 32); assert.equal(r.review.findings.length, 32); noAuthority(r);
});
test('full 4096-byte text is scanned through its tail', () => {
  const suffix = '\nTODO: replace';
  assert.equal(run('x'.repeat(MAX_TEXT_BYTES - suffix.length) + suffix).findings.length, 1);
});
test('UTF-8 multibyte limits count bytes', () => {
  assert.equal(run('😀'.repeat(1024)).status, 'no-pattern-match');
  reject(JSON.stringify(packet([surface('😀'.repeat(1025))])), 'text_too_large');
});
test('input envelope exact limit is accepted, one byte over rejected', () => {
  const text = JSON.stringify(packet());
  assert.equal(scan(text + ' '.repeat(MAX_INPUT_BYTES - text.length)).status, 'no-surfaces');
  reject(text + ' '.repeat(MAX_INPUT_BYTES - text.length + 1), 'input_too_large');
});
test('no object coercion or accessor invocation', () => {
  let calls = 0; const input = { toString() { calls++; throw Error('PRIVATE_MARKER'); } };
  reject(input, 'serialized_json_required'); assert.equal(calls, 0);
});
const invalid = [
  ['not JSON', 'PRIVATE_MARKER', 'json_invalid'],
  ['null root', 'null', 'object_required'],
  ['array root', '[]', 'object_required'],
  ['unknown root', JSON.stringify({ ...packet(), PRIVATE_MARKER: true }), 'unknown_field'],
  ['missing surfaces', JSON.stringify({ schema: INPUT_SCHEMA, policyVersion: POLICY_VERSION, taskKind: 'ui' }), 'field_required'],
  ['wrong schema', JSON.stringify({ ...packet(), schema: 'PRIVATE_MARKER' }), 'schema_unsupported'],
  ['wrong policy', JSON.stringify({ ...packet(), policyVersion: 'PRIVATE_MARKER' }), 'policy_unsupported'],
  ['wrong task', JSON.stringify(packet([], 'PRIVATE_MARKER')), 'enum_invalid'],
  ['non UI surfaces', JSON.stringify(packet([surface('x')], 'non-ui')), 'non_ui_surfaces'],
  ['non array surfaces', JSON.stringify(packet({})), 'surfaces_limit'],
  ['too many surfaces', JSON.stringify(packet(Array.from({ length: 33 }, () => surface('x')))), 'surfaces_limit'],
  ['null surface', JSON.stringify(packet([null])), 'object_required'],
  ['unknown surface field', JSON.stringify(packet([surface('x', { PRIVATE_MARKER: true })])), 'unknown_field'],
  ['wrong kind', JSON.stringify(packet([surface('x', { kind: 'source' })])), 'enum_invalid'],
  ['wrong exposure', JSON.stringify(packet([surface('x', { exposure: 'verified' })])), 'enum_invalid'],
  ['non string text', JSON.stringify(packet([surface({ PRIVATE_MARKER: true })])), 'text_required'],
  ['oversized text', JSON.stringify(packet([surface('x'.repeat(4097))])), 'text_too_large'],
  ['high surrogate', JSON.stringify(packet([surface('\uD800')])), 'unicode_invalid'],
  ['low surrogate', JSON.stringify(packet([surface('\uDC00')])), 'unicode_invalid'],
  ['text with attribute', JSON.stringify(packet([surface('x', { attribute: 'title' })])), 'attribute_must_be_null'],
  ['attribute without name', JSON.stringify(packet([surface('x', { kind: 'attribute' })])), 'attribute_invalid'],
  ['arbitrary attribute code', JSON.stringify(packet([surface('x', { kind: 'attribute', attribute: 'PRIVATE_MARKER()' })])), 'attribute_invalid'],
  ['prototype root', '{"__proto__":{"PRIVATE_MARKER":true},"schema":"x"}', 'unknown_field'],
];
for (const [name, value, code] of invalid) test('reject ' + name, () => reject(value, code));
test('reject malformed tail before emitting any findings', () => {
  reject(JSON.stringify(packet([surface(key), null])), 'object_required');
});
test('native duplicate JSON key semantics are documented, not an auth envelope', () => {
  const text = JSON.stringify(packet()).replace('"taskKind":"ui"', '"taskKind":"unknown","taskKind":"ui"');
  assert.equal(scan(text).applicability, 'applicable');
});
test('scanning does not perform filesystem IO', () => {
  const saved = new Map(['readFileSync', 'writeFileSync', 'appendFileSync', 'readdirSync', 'statSync'].map(k => [k, fs[k]]));
  try {
    for (const k of saved.keys()) fs[k] = () => { throw Error('unexpected IO'); };
    assert.equal(run(key).schema, OUTPUT_SCHEMA);
  } finally { for (const [k, v] of saved) fs[k] = v; }
});

let passed = 0;
for (const { name, fn } of cases) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { console.error('FAIL ' + name + '\n' + error.stack); }
}
console.log(`UI boundary scanner: ${passed}/${cases.length} passed`);
process.exitCode = passed === cases.length ? 0 : 1;
