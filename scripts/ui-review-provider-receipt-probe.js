'use strict';

const assert = require('node:assert/strict');
const D = require('../lib/ui-review-provider-receipt');
const U = require('../lib/ui-review');
const Q = require('../lib/openai-ui-review-request');
const F = require('./ui-review-fixture');
const input = F.fixture(), config = { provider: 'openai', model: 'fixture-model', store: true };
const recovery = { policy: { reviewAttemptId: 'review-1' } }, policy = { schema: D.POLICY, modelMatch: 'exact' };
const value = { request: { input }, config, recovery, packetId: F.packet(input).packetId };
const locator = { id: 'resp_fixture', model: config.model, createdAt: 1 };
function receipt() { const r = F.receipt(input); r.reviewer = { provider: 'openai', model: config.model, sessionId: null }; return r; }
function response(r = receipt()) { return { ok: true, response: { ...locator, status: 'completed', output: [{
  id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(r), annotations: [] }] }] } }; }
const assess = (r, current = input) => D.assess(value, r, JSON.stringify(current), locator);
let passed = 0, total = 0;
function test(name, fn) { total++; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { console.error('FAIL ' + name + ': ' + e.stack); } }
test('explicit policy accepts exact model and stored original baseline', () => {
  assert.deepEqual(D.policy(policy, config, recovery), policy);
  assert.ok(D.instructions(policy, config, recovery, F.packet(input)).includes(value.packetId));
});
for (const [name, p, c, b] of [
  ['missing', null, config, recovery], ['unknown field', { ...policy, extra: true }, config, recovery],
  ['alias match', { ...policy, modelMatch: 'prefix' }, config, recovery], ['no store', policy, { ...config, store: false }, recovery],
  ['no baseline', policy, config, null], ['long attempt', policy, config, { policy: { reviewAttemptId: 'a'.repeat(81) } }],
  ['invalid model', policy, { ...config, model: 'bad model' }, recovery],
]) test('reject policy ' + name, () => assert.throws(() => D.policy(p, c, b)));
test('80-character attempt is supported without truncation', () => D.policy(policy, config, { policy: { reviewAttemptId: 'a'.repeat(80) } }));
test('valid complete receipt preserves original bytes and digest', () => {
  const r = response(), out = assess(r); assert.equal(out.state, 'receipt-observed');
  assert.equal(out.receiptJson, r.response.output[0].content[0].text); assert.equal(out.receiptDigest, Q.sha(out.receiptJson));
  assert.equal(out.assessment.execution, 'completed'); assert.equal(out.assessment.verification.semanticVerified, false);
});
for (const status of ['queued', 'in_progress', 'failed', 'cancelled', 'incomplete']) test('non-completed response ' + status, () => {
  const r = response(); r.response.status = status; assert.equal(assess(r).reasonCode, 'receipt_response_' + status);
});
for (const [field, next] of [['id', 'resp_other'], ['createdAt', 2], ['model', 'fixture-model-alias']]) test('original response ' + field + ' required', () => {
  const r = response(); r.response[field] = next; assert.equal(assess(r).reasonCode, 'receipt_response_mismatch');
});
const edits = [
  ['empty output', r => { r.response.output = []; }], ['two messages', r => { r.response.output.push(F.clone(r.response.output[0])); }],
  ['tool', r => { r.response.output[0].type = 'function_call'; }], ['wrong role', r => { r.response.output[0].role = 'user'; }],
  ['partial message', r => { r.response.output[0].status = 'in_progress'; }], ['empty content', r => { r.response.output[0].content = []; }],
  ['multiple text parts', r => { r.response.output[0].content.push({ type: 'output_text', text: '{}' }); }],
  ['null content', r => { r.response.output[0].content[0] = null; }], ['empty text', r => { r.response.output[0].content[0].text = ' '; }],
];
for (const [name, edit] of edits) test('reject ambiguous output ' + name, () => { const r = response(); edit(r); assert.equal(assess(r).reasonCode, 'receipt_output_invalid'); });
test('refusal has explicit non-receipt outcome', () => { const r = response(); r.response.output[0].content[0] = { type: 'refusal', refusal: 'private' }; assert.equal(assess(r).reasonCode, 'receipt_refused'); });
for (const [name, text] of [['markdown', '```json\n{}\n```'], ['duplicate keys', '{"schema":1,"schema":2}'], ['BOM', '\ufeff{}'],
  ['depth', '['.repeat(18) + '0' + ']'.repeat(18)], ['size', '{"text":"' + 'x'.repeat(65537) + '"}'], ['truncated', '{"schema":'], ['wrong shape', 'null']]) {
  test('strict receipt text ' + name, () => { const r = response(); r.response.output[0].content[0].text = text;
    const out = assess(r); assert.equal(out.reasonCode, 'receipt_invalid'); assert.equal(out.receiptJson, null); });
}
for (const [name, edit] of [
  ['packet', r => { r.packetId = F.hash('f'); }], ['attempt', r => { r.attemptId = 'another-review'; }],
  ['reviewer provider', r => { r.reviewer.provider = 'provider-other'; }], ['reviewer model', r => { r.reviewer.model = 'fixture-alias'; }],
  ['invented session', r => { r.reviewer.sessionId = 'invented'; }],
]) test('bound receipt ' + name, () => { const r = receipt(); edit(r); assert.equal(assess(response(r)).reasonCode, 'receipt_binding_mismatch'); });
for (const [name, edit] of [
  ['missing coverage', r => { r.coverage.pop(); }], ['inconclusive coverage', r => { r.coverage[0].outcome = 'inconclusive'; }],
  ['partial review', r => { r.execution = 'partial'; }],
]) test('incomplete remains incomplete: ' + name, () => {
  const r = receipt(); edit(r); const out = assess(response(r)); assert.equal(out.state, 'receipt-observed'); assert.equal(out.assessment.state, 'incomplete');
});
for (const [name, edit] of [
  ['duplicate coverage', r => { r.coverage.push(r.coverage[0]); }], ['other task', r => { r.coverage[0].taskId = 'T-other'; }],
  ['nonexistent finding', r => { r.coverage[0].outcome = 'finding'; r.coverage[0].findingIndexes = [0]; }],
  ['verified declaration', r => { r.review.evidenceVerified = true; }], ['extra top-level', r => { r.approvalGranted = true; }],
]) test('invalid receipt ' + name, () => { const r = receipt(); edit(r); assert.equal(assess(response(r)).reasonCode, 'receipt_invalid'); });
for (const bound of [true, false]) test('finding evidence ' + (bound ? 'bound' : 'foreign'), () => {
  const r = receipt(), subtype = 'SPEC_TO_COPY'; r.coverage.find(c => c.subtype === subtype).outcome = 'finding';
  r.coverage.find(c => c.subtype === subtype).findingIndexes = [0];
  r.review.findings.push({ category: 'instruction_to_ui_leakage', subtype, sourceKind: 'specification', severity: 'advisory', disposition: 'review-remediation', evidenceDigest: bound ? input.uiMaterials[0].specDigest : F.hash('e') });
  const out = assess(response(r)); assert.equal(out.reasonCode, bound ? null : 'receipt_material_unbound');
  if (bound) assert.equal(out.assessment.state, 'findings');
});
test('transport failure never exposes response text', () => assert.equal(assess({ ok: false, error: { code: 'retrieval_denied' } }).reasonCode, 'retrieval_denied'));
console.log(`Provider receipt contract: ${passed}/${total} PASS; pure contract checks only`);
if (passed !== total) process.exitCode = 1;
