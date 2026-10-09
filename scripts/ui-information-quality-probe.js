'use strict';

const assert = require('assert');
const cp = require('child_process');
const path = require('path');
const { INPUT_SCHEMA, assessUiInformation, UiInformationInputError } = require('../lib/ui-information-quality');
const cli = path.resolve(__dirname, '../bin/leerness.js');
let passed = 0;
let failed = 0;
function test(name, fn) { try { fn();passed++;console.log('PASS ' + name); } catch (error) { failed++;console.error('FAIL ' + name + ': ' + error.stack); } }
function item(id, changes = {}) {
  return { id, logicalId: id, viewId: 'desktop', metricId: 'gross-sales', lineageId: 'orders.gross.sum',
    questionId: 'sales-total', scope: { subject: 'all', filter: 'all', period: 'September', snapshot: '2026-09-23', unit: 'KRW', aggregation: 'sum' },
    purpose: 'none', purposeReason: null, ...changes };
}
function assess(first, second) { return assessUiInformation({ schema: INPUT_SCHEMA, items: [first, second] }).pairs[0].classification; }
function cliCall(input, args = ['ui', 'information', '--stdin', '--json']) {
  const result = cp.spawnSync(process.execPath, [cli, ...args], { input: JSON.stringify(input), encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.ifError(result.error);
  return { exit: result.status, data: JSON.parse(result.stdout) };
}
test('same declared fact, question and viewport is a candidate', () => assert.strictEqual(assess(item('a'), item('b')), 'duplicate-candidate'));
test('same lineage with renamed metric asks for semantic review', () => assert.strictEqual(assess(item('a'), item('b', { metricId: 'revenue' })), 'semantic-review'));
test('different canonical metrics remain distinct even if their displayed values happen to match', () => assert.strictEqual(assess(item('a'), item('b', { metricId: 'users', lineageId: 'accounts.count' })), 'distinct-metric'));
test('different period is not collapsed into one fact', () => assert.strictEqual(assess(item('a'), item('b', { scope: { ...item('x').scope, period: 'August' } })), 'distinct-scope'));
test('different user question is preserved', () => assert.strictEqual(assess(item('a'), item('b', { questionId: 'sales-trend' })), 'distinct-question'));
test('summary and justified detail are preserved', () => assert.strictEqual(assess(item('a'), item('b', { purpose: 'detail', purposeReason: 'Opens the order-level breakdown' })), 'purposeful-repeat'));
test('chart and justified accessible table are preserved', () => assert.strictEqual(assess(item('a'), item('b', { purpose: 'accessibility', purposeReason: 'Screen-reader table' })), 'purposeful-repeat'));
test('unexplained purpose remains unknown', () => assert.strictEqual(assess(item('a'), item('b', { purpose: 'detail' })), 'unknown'));
test('DOM and accessibility observations of one declared logical element are not counted as two cards', () => assert.strictEqual(assess(item('a'), item('b', { logicalId: 'a' })), 'same-element-declared'));
test('exclusive viewport states are separated', () => assert.strictEqual(assess(item('a'), item('b', { viewId: 'mobile' })), 'separate-view'));
test('missing lineage remains unknown', () => assert.strictEqual(assess(item('a'), item('b', { lineageId: null })), 'unknown'));
test('unsafe output identifier is rejected before echo', () => assert.throws(() => assessUiInformation({ schema: INPUT_SCHEMA, items: [item('Bearer secret')] }), UiInformationInputError));
test('CLI JSON returns advisory-only results without raw metric or approval', () => {
  const result = cliCall({ schema: INPUT_SCHEMA, items: [item('a'), item('b')] });
  assert.strictEqual(result.exit, 0);assert.strictEqual(result.data.result.counts['duplicate-candidate'], 1);
  assert.strictEqual(result.data.result.approvalGranted, false);assert.strictEqual(result.data.result.autoRemoval, false);
  assert.deepStrictEqual([result.data.result.pairs[0].firstIndex, result.data.result.pairs[0].secondIndex], [0, 1]);
  assert.ok(!JSON.stringify(result.data).includes('"first":"a"'));
  assert.ok(!JSON.stringify(result.data).includes('orders.gross.sum'));
});
test('CLI rejects malformed metadata with a bounded failure', () => {
  const result = cliCall({ schema: INPUT_SCHEMA, items: [{ ...item('a'), metricId: '' }] });
  assert.strictEqual(result.exit, 2);assert.strictEqual(result.data.ok, false);
  assert.strictEqual(result.data.error.code, 'ui_information_text_invalid');
});
console.log(`ui information quality: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
