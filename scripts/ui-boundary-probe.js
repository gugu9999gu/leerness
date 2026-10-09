'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { assessUiBoundary: assess, UiBoundaryInputError, INPUT_SCHEMA, OUTPUT_SCHEMA,
  POLICY_VERSION, MAX_INPUT_BYTES, TAXONOMY } = require('../lib/ui-boundary');
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const base = () => ({ schema: INPUT_SCHEMA, policyVersion: POLICY_VERSION, taskKind: 'ui',
  candidate: { sourceKind: 'product_copy', intent: 'explicit', userNeed: 'act',
    use: 'product-copy', surface: 'proposed', sensitivity: 'none' } });
const evaluate = (candidate = {}, taskKind = 'ui') => {
  const input = base(); input.taskKind = taskKind; Object.assign(input.candidate, candidate);
  return assess(JSON.stringify(input));
};
function rejected(input, code, field) {
  assert.throws(() => assess(input), error => {
    assert.ok(error instanceof UiBoundaryInputError);
    assert.equal(error.code, code);
    if (field) assert.equal(error.field, field);
    assert.ok(!String(error).includes('PRIVATE_MARKER'));
    return true;
  });
}
function noAuthority(result) {
  assert.deepEqual(result.verification, { sourceVerified: false, renderVerified: false,
    semanticVerified: false, independentReview: 'not-run' });
  assert.ok(Object.values(result.effects).every(value => value === false));
  assert.equal(result.assessmentBasis, 'caller-declared-metadata');
}

// Human-labelled controls. Sample strings describe the intended fixture; the
// API only receives the declarations. These are not semantic/scanner scores.
const controls = [
  ['save action', '저장', {}, 'eligible-copy', null],
  ['required recovery action', '다시 시도', { intent: 'clearly-required' }, 'eligible-copy', null],
  ['spec as subtitle', '아래에 최근 주문을 보여준다', { sourceKind: 'specification', use: 'context' }, 'withhold', 'SPEC_TO_COPY'],
  ['implementation narration', 'React 컴포넌트로 렌더링합니다', { sourceKind: 'implementation_instruction', use: 'context' }, 'withhold', 'IMPLEMENTATION_NARRATION'],
  ['developer note', 'TODO: 이 버튼 연결', { sourceKind: 'developer_note', intent: 'internal' }, 'withhold', 'DEVELOPER_NOTE'],
  ['acceptance criterion', '직관적이고 한눈에 보여야 한다', { sourceKind: 'acceptance_criterion', use: 'context' }, 'withhold', 'CRITERIA_TO_COPY'],
  ['raw debug payload', 'debug payload: internal run status', { sourceKind: 'debug_metadata', use: 'context' }, 'withhold', 'DEBUG_METADATA'],
  ['framework documentation', 'React 시작하기', { userNeed: 'understand' }, 'eligible-copy', null],
  ['provider selection', 'OpenAI', { userNeed: 'configure' }, 'eligible-copy', null],
  ['administration model field', '실행 모델', { sourceKind: 'debug_metadata', userNeed: 'configure' }, 'eligible-copy', null],
  ['administration status field', '작업 상태', { sourceKind: 'debug_metadata', userNeed: 'status' }, 'eligible-copy', null],
  ['local development guide', 'localhost 연결 설정', { sourceKind: 'implementation_instruction', userNeed: 'configure' }, 'eligible-copy', null],
  ['quote in requirements guide', '직관적이어야 한다', { sourceKind: 'acceptance_criterion', userNeed: 'understand' }, 'eligible-copy', null],
  ['existing deliberate copy resembles spec', '최근 주문', { sourceKind: 'specification', surface: 'rendered', userNeed: 'understand' }, 'eligible-copy', null],
  ['existing internal note needs review', 'TODO: 문구 변경', { sourceKind: 'developer_note', use: 'context', surface: 'rendered' }, 'review-required', 'DEVELOPER_NOTE'],
  ['unestablished intent', '한눈에 확인하세요', { intent: 'unclear' }, 'withhold', null],
  ['unknown provenance', '상태 확인', { sourceKind: 'unknown' }, 'withhold', null],
];
for (const [name, sample, fields, recommendation, subtype] of controls) test(name, () => {
  const result = evaluate(fields);
  assert.equal(result.recommendation, recommendation);
  assert.equal(result.eligibleForCopy, recommendation === 'eligible-copy');
  assert.equal(result.findings.length, subtype ? 1 : 0);
  if (subtype) assert.equal(result.findings[0].subtype, subtype);
  assert.ok(!JSON.stringify(result).includes(sample));
  noAuthority(result);
});

test('taxonomy version and all five stable subtype codes', () => {
  assert.equal(INPUT_SCHEMA, 'leerness.ui-boundary-input/v1');
  assert.equal(OUTPUT_SCHEMA, 'leerness.ui-boundary-assessment/v1');
  assert.equal(POLICY_VERSION, 'leerness.ui-boundary/v1');
  assert.deepEqual(TAXONOMY, { specification: 'SPEC_TO_COPY', implementation_instruction: 'IMPLEMENTATION_NARRATION',
    developer_note: 'DEVELOPER_NOTE', acceptance_criterion: 'CRITERIA_TO_COPY', debug_metadata: 'DEBUG_METADATA' });
  assert.equal(evaluate().schema, OUTPUT_SCHEMA);
  assert.equal(evaluate().policyVersion, POLICY_VERSION);
  assert.throws(() => { TAXONOMY.specification = 'allowed'; }, TypeError);
});
for (const sourceKind of Object.keys(TAXONOMY)) {
  test(`${sourceKind}: rendered context is a candidate, never deletion`, () => {
    const r = evaluate({ sourceKind, use: 'context', surface: 'rendered' });
    assert.equal(r.recommendation, 'review-required');
    assert.deepEqual(r.findings[0], { category: 'instruction_to_ui_leakage', subtype: TAXONOMY[sourceKind],
      basis: 'caller-declared-context', certainty: 'candidate', disposition: 'review-remediation' });
    noAuthority(r);
  });
  test(`${sourceKind}: caller's meaningful adapted product copy is eligible`, () => {
    assert.equal(evaluate({ sourceKind }).eligibleForCopy, true);
  });
}
for (const sensitivity of ['suspected', 'confirmed']) for (const surface of ['proposed', 'rendered']) {
  test(`${sensitivity} sensitive ${surface} metadata routes once to security`, () => {
    const r = evaluate({ sourceKind: 'debug_metadata', use: 'context', sensitivity, surface });
    assert.equal(r.eligibleForCopy, false);
    assert.equal(r.findings.length, 1);
    assert.deepEqual(r.findings[0], { category: 'security', uiBoundarySubtype: 'DEBUG_METADATA',
      basis: 'caller-declared-sensitivity', sensitivity, severity: 'delegated',
      disposition: surface === 'proposed' ? 'withhold-pending-review' : 'review-remediation' });
    assert.equal(r.reviewDomains.filter(x => x === 'security').length, 1);
    noAuthority(r);
  });
}
test('sensitive declared product copy cannot bypass security', () => {
  const r = evaluate({ sensitivity: 'confirmed' });
  assert.equal(r.eligibleForCopy, false);
  assert.equal(r.findings[0].category, 'security');
  assert.equal(r.findings[0].uiBoundarySubtype, null);
});
test('unknown task kind still routes sensitive data without granting eligibility', () => {
  const r = evaluate({ sensitivity: 'suspected' }, 'unknown');
  assert.equal(r.recommendation, 'review-required');
  assert.equal(r.applicability, 'unknown');
  assert.ok(r.reasonCodes.includes('task_kind_unknown'));
  assert.ok(r.reviewDomains.includes('security'));
});
test('valid non-UI has no findings, review requests or copy grant', () => {
  const input = base(); input.taskKind = 'non-ui'; input.candidate = null;
  const r = assess(JSON.stringify(input));
  assert.equal(r.recommendation, 'not-applicable');
  assert.equal(r.eligibleForCopy, false);
  assert.deepEqual(r.findings, []); assert.deepEqual(r.reviewDomains, []); noAuthority(r);
});
test('unknown task kind does not infer UI applicability', () => {
  const r = evaluate({}, 'unknown');
  assert.equal(r.recommendation, 'review-required'); assert.equal(r.eligibleForCopy, false);
});
for (const [field, value, reason] of [
  ['intent', 'unclear', 'user_facing_intent_not_established'],
  ['intent', 'internal', 'context_is_non_renderable'],
  ['userNeed', 'none', 'user_need_not_established'],
  ['userNeed', 'unknown', 'user_need_not_established'],
  ['use', 'context', 'context_is_non_renderable'],
  ['use', 'unknown', 'copy_use_unknown'],
  ['sourceKind', 'unknown', 'source_kind_unknown'],
  ['sensitivity', 'unknown', 'sensitivity_not_assessed'],
]) test(`${field}=${value} cannot silently become eligible`, () => {
  const r = evaluate({ [field]: value }); assert.equal(r.eligibleForCopy, false);
  assert.ok(r.reasonCodes.includes(reason));
  assert.equal(evaluate({ [field]: value, surface: 'rendered' }).recommendation, 'review-required');
});
test('ambiguity alone does not fabricate a leakage finding', () => {
  const r = evaluate({ sourceKind: 'specification', intent: 'unclear' });
  assert.equal(r.recommendation, 'withhold'); assert.deepEqual(r.findings, []);
});
for (const userNeed of ['understand', 'decide', 'act', 'status', 'configure']) {
  test(`clearly required ${userNeed} copy does not require a string allowlist`, () => {
    const r = evaluate({ intent: 'clearly-required', userNeed });
    assert.equal(r.recommendation, 'eligible-copy'); assert.deepEqual(r.reviewDomains, []);
  });
}
test('each call returns independent results and does not change input bytes', () => {
  const input = JSON.stringify(base()); const original = input;
  const a = assess(input); a.effects.approvalGranted = true; a.reasonCodes.length = 0;
  a.findings.push({ category: 'fabricated' }); a.verification.semanticVerified = true;
  const b = assess(input); noAuthority(b); assert.equal(input, original);
  assert.deepEqual(b, assess(input)); assert.deepEqual(b.findings, []);
});
test('input object getters and toString are not executed', () => {
  let called = false;
  const input = { get schema() { called = true; throw Error('PRIVATE_MARKER'); },
    toString() { called = true; throw Error('PRIVATE_MARKER'); } };
  rejected(input, 'serialized_json_required', '$'); assert.equal(called, false);
});
for (const value of [null, undefined, 7, true, Buffer.from('{}'), new String('{}')]) {
  test(`reject non-string ${Object.prototype.toString.call(value)}`, () => rejected(value, 'serialized_json_required'));
}
test('malformed JSON uses sanitized errors', () => rejected('{PRIVATE_MARKER', 'json_invalid', '$'));
for (const value of [null, [], false, 123, 'PRIVATE_MARKER']) {
  test(`reject root ${JSON.stringify(value)}`, () => rejected(JSON.stringify(value), 'object_required', '$'));
}
for (const field of Object.keys(base())) {
  test(`missing envelope field ${field}`, () => {
    const input = base(); delete input[field]; rejected(JSON.stringify(input), 'field_required', `$.${field}`);
  });
}
for (const field of Object.keys(base().candidate)) {
  test(`missing candidate field ${field}`, () => {
    const input = base(); delete input.candidate[field]; rejected(JSON.stringify(input), 'field_required', `$.candidate.${field}`);
  });
  test(`invalid candidate enum ${field} is not echoed`, () => {
    const input = base(); input.candidate[field] = 'PRIVATE_MARKER'; rejected(JSON.stringify(input), 'enum_invalid', `$.candidate.${field}`);
  });
}
for (const [field, code] of [['schema', 'schema_unsupported'], ['policyVersion', 'policy_unsupported'], ['taskKind', 'enum_invalid']]) {
  test(`unsupported ${field} is not accepted`, () => {
    const input = base(); input[field] = 'PRIVATE_MARKER'; rejected(JSON.stringify(input), code, `$.${field}`);
  });
}
test('candidate must be object', () => {
  for (const candidate of [null, [], 'PRIVATE_MARKER', 5]) {
    const input = base(); input.candidate = candidate; rejected(JSON.stringify(input), 'object_required', '$.candidate');
  }
});
test('non-UI candidate must be null', () => {
  const input = base(); input.taskKind = 'non-ui'; rejected(JSON.stringify(input), 'candidate_must_be_null');
});
for (const key of ['PRIVATE_MARKER', '__proto__', 'constructor', 'renderedText', 'model', 'approvalGranted']) {
  test(`extra field ${key} is rejected at both schema boundaries`, () => {
    for (const nested of [false, true]) {
      const input = base(); Object.defineProperty(nested ? input.candidate : input, key, { value: 'PRIVATE_MARKER', enumerable: true });
      rejected(JSON.stringify(input), 'unknown_field', nested ? '$.candidate' : '$');
    }
  });
}
test('exact envelope byte limit succeeds and one extra byte fails', () => {
  const text = JSON.stringify(base()); const exact = text + ' '.repeat(MAX_INPUT_BYTES - Buffer.byteLength(text));
  assert.equal(Buffer.byteLength(exact), 4096); assert.equal(assess(exact).eligibleForCopy, true);
  rejected(exact + ' ', 'input_too_large', '$');
});
test('UTF-8 byte limit is not JavaScript character length', () => {
  const input = base(); input.candidate.intent = '가'.repeat(1400); const text = JSON.stringify(input);
  assert.ok(text.length < MAX_INPUT_BYTES); assert.ok(Buffer.byteLength(text) > MAX_INPUT_BYTES);
  rejected(text, 'input_too_large', '$');
});
test('deep inert JSON cannot force recursive schema traversal', () => {
  rejected('['.repeat(1500) + '0' + ']'.repeat(1500), 'object_required', '$');
});
test('duplicate fields follow documented JSON parse behavior without granting effects', () => {
  const text = JSON.stringify(base()).replace('"intent":"explicit"', '"intent":"internal","intent":"explicit"');
  const r = assess(text); assert.equal(r.eligibleForCopy, true); noAuthority(r);
});
test('module evaluates without filesystem, process, model, network or clock globals', () => {
  const source = fs.readFileSync(require.resolve('../lib/ui-boundary'), 'utf8');
  const sandbox = { module: { exports: {} }, Buffer };
  vm.runInNewContext(source, sandbox, { timeout: 1000 });
  const result = sandbox.module.exports.assessUiBoundary(JSON.stringify(base()));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), evaluate());
});
test('cross-product safety invariants hold for all 4704 valid UI declarations', () => {
  let count = 0;
  for (const sourceKind of ['product_copy', ...Object.keys(TAXONOMY), 'unknown'])
    for (const intent of ['explicit', 'clearly-required', 'internal', 'unclear'])
      for (const userNeed of ['understand', 'decide', 'act', 'status', 'configure', 'none', 'unknown'])
        for (const use of ['product-copy', 'context', 'unknown'])
          for (const surface of ['proposed', 'rendered'])
            for (const sensitivity of ['none', 'suspected', 'confirmed', 'unknown']) {
              const r = evaluate({ sourceKind, intent, userNeed, use, surface, sensitivity }); count++;
              assert.equal(r.effects.autoRemove, false); assert.equal(r.effects.approvalGranted, false);
              assert.equal(r.verification.semanticVerified, false);
              assert.ok(r.reasonCodes.length > 0);
              if (surface === 'rendered') assert.notEqual(r.recommendation, 'withhold');
              if (intent === 'internal' || use === 'context' || sensitivity !== 'none') assert.equal(r.eligibleForCopy, false);
              if (sensitivity === 'confirmed' || sensitivity === 'suspected') {
                assert.equal(r.findings.length, 1); assert.equal(r.findings[0].category, 'security');
              }
            }
  assert.equal(count, 4704);
});

let failed = 0;
for (const { name, fn } of cases) {
  try { fn(); process.stdout.write(`PASS ${name}\n`); }
  catch (error) { failed++; process.stderr.write(`FAIL ${name}: ${error.stack}\n`); }
}
process.stdout.write(`UI boundary probe: ${cases.length - failed}/${cases.length} passed\n`);
if (failed) process.exitCode = 1;
