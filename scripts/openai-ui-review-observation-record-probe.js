'use strict';

const assert = require('node:assert/strict');
const K = require('../lib/openai-ui-review-observation-record');
const D = require('../lib/ui-review-provider-receipt');
const R = require('../lib/ui-review-run-contract');
const Q = require('../lib/openai-ui-review-request');
const F = require('./ui-review-fixture');
const input = F.fixture(), config = { provider: 'openai', model: 'fixture-model', store: true };
const policy = { schema: K.POLICY, retention: 'local-git-until-explicit-removal' };
const receiptPolicy = { schema: D.POLICY, modelMatch: 'exact' };
const ctx = { projectKey: 'project', batchId: input.snapshot.batch.id };
const baseline = { prefixBytes: 100, prefixDigest: F.hash('a'), implementationEventIds: ['impl-event'], reviewAttemptId: 'review-1' };
const intent = { runId: 'run-1', config, observationPolicy: policy, receiptPolicy, request: { input },
  packetId: F.packet(input).packetId, recovery: { ledger: baseline, policy: { reviewAttemptId: 'review-1' } } };
const journal = { intent: { head: '1'.repeat(40), value: intent }, attempt: { head: '2'.repeat(40) },
  locator: { head: '3'.repeat(40), value: { response: { id: 'resp_fixture', model: config.model, createdAt: 1 } } } };
function fixture() {
  const receipt = F.receipt(input); receipt.reviewer = { provider: 'openai', model: config.model, sessionId: null };
  return { schema: K.SCHEMA, ...ctx, runId: intent.runId, intentHead: journal.intent.head,
    locatorHead: journal.locator.head, attemptHead: journal.attempt.head, observationId: '12345678-1234-4123-8123-123456789abc',
    response: { ...journal.locator.value.response, status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(receipt) }] }] },
    ledger: { beforeBytes: 100, afterBytes: 100, beforeDigest: F.hash('a'), afterDigest: F.hash('a'),
      implementationEventIds: ['impl-event'], reviewAttemptId: 'review-1', prefixPreserved: true, trust: 'local-ledger-declarations' } };
}
const encode = v => K.encode(v, ctx, journal), decode = bytes => K.decode(bytes, ctx, journal);
let passed = 0, total = 0;
function test(name, fn) { total++; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { console.error('FAIL ' + name + ': ' + e.stack); } }
test('canonical response is stored once; receipt and assessment are derived', () => {
  const v = fixture(), bytes = encode(v), out = decode(bytes);
  assert.deepEqual(out.value, v); assert.equal(out.observed.state, 'receipt-observed');
  assert.equal(out.observed.receiptDigest, R.sha(v.response.output[0].content[0].text));
  assert.equal(Object.hasOwn(out.value, 'assessment'), false); assert.equal(Object.hasOwn(out.value, 'receiptJson'), false);
  assert.equal(out.observed.assessment.verification.semanticVerified, false);
});
test('observation retention is approval-bound without changing prior request digests', () => {
  const previous = Q.requestDigest(intent), copy = F.clone(intent); delete copy.observationPolicy;
  assert.notEqual(Q.requestDigest(copy), previous); assert.equal(Q.requestDigest({ ...copy, observationPolicy: undefined }), Q.requestDigest(copy));
});
for (const [name, p, receipt] of [
  ['missing', null, receiptPolicy], ['extra', { ...policy, approvalGranted: true }, receiptPolicy],
  ['retention', { ...policy, retention: 'forever' }, receiptPolicy], ['schema', { ...policy, schema: 'future' }, receiptPolicy],
  ['receipt missing', policy, null],
]) test('reject policy ' + name, () => assert.throws(() => K.policy(p, receipt)));
for (const [field, value] of [['schema', 'future'], ['projectKey', 'other'], ['batchId', 'other'], ['runId', 'other'],
  ['intentHead', '4'.repeat(40)], ['locatorHead', '4'.repeat(40)], ['attemptHead', '4'.repeat(40)],
  ['observationId', '12345678-1234-1123-8123-123456789abc'], ['approvalGranted', true], ['receiptJson', '{}']]) {
  test('reject record ' + field, () => { const v = fixture(); v[field] = value; assert.throws(() => encode(v)); });
}
for (const [field, value] of [['id', 'resp_other'], ['createdAt', 2], ['model', 'alias'], ['status', 'queued'], ['output', []], ['instructions', 'untrusted']]) {
  test('reject response ' + field, () => { const v = fixture(); v.response[field] = value; assert.throws(() => encode(v)); });
}
for (const [field, value] of [['beforeBytes', 99], ['beforeDigest', F.hash('b')], ['afterBytes', 99], ['afterBytes', 1048577],
  ['afterBytes', 100.5], ['afterDigest', 'sha256:bad'], ['afterDigest', F.hash('b')], ['reviewAttemptId', 'other'],
  ['implementationEventIds', ['other']], ['prefixPreserved', false], ['trust', 'provider-authenticated'], ['extra', true]]) {
  test('reject ledger ' + field + '=' + JSON.stringify(value), () => { const v = fixture(); v.ledger[field] = value; assert.throws(() => encode(v)); });
}
test('later observed prefix may grow within the ledger bound', () => { const v = fixture(); v.ledger.afterBytes = 200; v.ledger.afterDigest = F.hash('b'); assert.equal(decode(encode(v)).value.ledger.afterBytes, 200); });
test('valid missing coverage is retained as incomplete', () => {
  const v = fixture(), text = v.response.output[0].content[0], receipt = JSON.parse(text.text); receipt.coverage.pop(); text.text = JSON.stringify(receipt);
  assert.equal(decode(encode(v)).observed.assessment.state, 'incomplete');
});
test('future and noncanonical JSON cannot be recovered', () => {
  assert.throws(() => decode(JSON.stringify(fixture()))); assert.throws(() => decode(encode(fixture()) + '\n'));
  assert.throws(() => decode('{"schema":1,"schema":2}'));
});
test('oversized observation rejects before any Git operation', () => {
  const v = fixture(); v.response.output[0].content[0].text += ' '.repeat(65536);
  assert.throws(() => encode(v), e => e.code === 'observation_record_limit');
  assert.throws(() => decode(' '.repeat(65537)), e => e.code === 'observation_record_limit');
});
test('HTTP-valid nested output cannot exceed the stored record parser boundary', () => {
  const v = fixture(); let nested = 'leaf';
  for (let i = 0; i < 13; i++) nested = { nested };
  v.response.output[0].extra = nested;
  require('../lib/openai-response-http').projection(Buffer.from(JSON.stringify({ object: 'response', ...v.response, created_at: v.response.createdAt })));
  assert.throws(() => encode(v), e => e.code === 'observation_record_invalid');
});
console.log(`Provider observation record: ${passed}/${total} PASS; pure contract checks only`);
if (passed !== total) process.exitCode = 1;
