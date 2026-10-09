'use strict';

const assert = require('node:assert/strict');
const api = require('../lib/memory-migration-plan');
const { _decisionsFromMd, _parseLessonEntries, _renderDecisionsMd, _renderLessonsMd } = require('../lib/pure-utils');
const { assessLegacyMemoryMigration: assess, MemoryMigrationInputError } = api;
let total = 0;
let passed = 0;
const test = (name, run) => {
  total++;
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack}`); }
};
const fixture = (surface = 'decisions', raw = Buffer.from('### Note\n- Decision: keep\n')) => ({
  schemaVersion: 1, surface, canonicalState: 'absent',
  legacy: { state: raw === null ? 'absent' : 'present', bytesBase64: raw === null ? null : raw.toString('base64') }
});
const call = input => assess(JSON.stringify(input));
const parse = (surface, text) => surface === 'decisions' ? _decisionsFromMd(text.replace(/^\ufeff/, '')) : _parseLessonEntries(text.replace(/^\ufeff/, ''));
const render = (surface, entries) => surface === 'decisions' ? _renderDecisionsMd(entries) : _renderLessonsMd(entries);
const checkMetrics = (surface, text, disposition) => {
  const input = fixture(surface, Buffer.from(text));
  const original = JSON.stringify(input);
  const report = assess(original);
  const entries = parse(surface, text);
  const generated = render(surface, entries);
  const expectedProjection = text.startsWith(generated) ? text : entries.length ? generated : generated + text;
  assert.equal(report.disposition, disposition);
  assert.equal(report.inputBytes, Buffer.byteLength(text));
  assert.equal(report.parsedRecordCount, entries.length);
  assert.equal(report.candidateCanonicalBytes, Buffer.byteLength(JSON.stringify(entries, null, 2) + '\n'));
  assert.equal(report.candidateProjectionBytes, Buffer.byteLength(expectedProjection));
  assert.equal(report.rawRetentionBytes, disposition === 'not-needed' ? 0 : Buffer.byteLength(text));
  assert.equal(JSON.stringify(input), original);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.reasonCodes), true);
  assert.equal(report.sourceTrust, 'caller-supplied');
  assert.equal(report.semanticCoverage, 'unknown');
  for (const key of ['sourceVerified', 'approvalGranted', 'writesPerformed']) assert.equal(report[key], false);
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= api.MAX_METADATA_BYTES);
  return report;
};

for (const value of [undefined, null, true, 1, [], {}, { toJSON() { throw Error('must not execute'); } }]) {
  test(`reject nonserialized input ${typeof value}`, () => assert.throws(() => assess(value), e => e instanceof MemoryMigrationInputError && e.code === 'serialized_json_required'));
}
test('never access caller object getters', () => {
  let invoked = false;
  const input = Object.defineProperty({}, 'surface', { get() { invoked = true; throw Error('getter'); } });
  assert.throws(() => assess(input), MemoryMigrationInputError);
  assert.equal(invoked, false);
});
for (const [name, mutate, code] of [
  ['missing canonical state', x => delete x.canonicalState, 'input_shape_invalid'],
  ['unknown field', x => x.approvalGranted = true, 'input_shape_invalid'],
  ['wrong schema', x => x.schemaVersion = 2, 'schema_unsupported'],
  ['schema string', x => x.schemaVersion = '1', 'schema_unsupported'],
  ['wrong surface', x => x.surface = 'tasks', 'surface_unsupported'],
  ['canonical shape', x => x.canonicalState = {}, 'canonical_state_invalid'],
  ['legacy array', x => x.legacy = [], 'legacy_shape_invalid'],
  ['legacy extra field', x => x.legacy.digest = 'claim', 'legacy_shape_invalid'],
  ['legacy unknown state', x => x.legacy.state = 'missing', 'legacy_shape_invalid'],
  ['present without bytes', x => x.legacy.bytesBase64 = null, 'legacy_bytes_invalid'],
  ['absent with bytes', x => x.legacy.state = 'absent', 'legacy_bytes_invalid'],
  ['noncanonical pad bits', x => x.legacy.bytesBase64 = 'Zh==', 'base64_invalid'],
  ['whitespace base64', x => x.legacy.bytesBase64 = ' Zg=', 'base64_invalid'],
  ['missing padding', x => x.legacy.bytesBase64 = 'Zg', 'base64_invalid'],
  ['extra padding', x => x.legacy.bytesBase64 = 'Z===', 'base64_invalid']
]) test(name, () => { const input = fixture(); mutate(input); assert.throws(() => call(input), e => e.code === code); });
test('invalid JSON errors omit input and parser message', () => {
  assert.throws(() => assess('{"private-canary-not-for-output"'), e => e.code === 'json_invalid' && !e.message.includes('private-canary'));
});
test('envelope UTF-8 bytes are bounded before parse', () => {
  assert.throws(() => assess('가'.repeat(Math.floor(api.MAX_ENVELOPE_BYTES / 3) + 1)), e => e.code === 'envelope_too_large');
});
test('envelope character length is bounded', () => {
  assert.throws(() => assess(' '.repeat(api.MAX_ENVELOPE_BYTES + 1)), e => e.code === 'envelope_too_large');
});
for (const offset of [-1, 0, 1]) test(`envelope byte boundary ${offset}`, () => {
  const base = JSON.stringify(fixture());
  const input = base + ' '.repeat(api.MAX_ENVELOPE_BYTES + offset - Buffer.byteLength(base));
  if (offset > 0) assert.throws(() => assess(input), e => e.code === 'envelope_too_large');
  else assert.equal(assess(input).disposition, 'candidate-requires-raw-retention');
});

for (const surface of ['decisions', 'lessons']) {
  for (const state of ['present', 'corrupt', 'unreadable', 'unsupported', 'unknown']) {
    test(`${surface}: canonical ${state} never falls back`, () => {
      const input = fixture(surface, Buffer.from([0xff])); input.canonicalState = state;
      const report = call(input);
      assert.equal(report.disposition, state === 'present' ? 'not-applicable' : 'blocked');
      assert.deepEqual(report.reasonCodes, [`canonical_${state}`]);
      assert.equal(report.parsedRecordCount, null);
      assert.equal(report.inputBytes, null);
    });
  }
  test(`${surface}: both absent uses existing initialization`, () => assert.equal(call(fixture(surface, null)).disposition, 'not-applicable'));
  for (const state of ['unknown', 'unreadable', 'unsupported']) {
    test(`${surface}: legacy ${state} is incomplete`, () => {
      const input = fixture(surface, null); input.legacy.state = state;
      const report = call(input);
      assert.equal(report.disposition, 'incomplete');
      assert.equal(report.candidateCanonicalBytes, null);
      assert.deepEqual(report.reasonCodes, [`legacy_${state}`]);
    });
  }
  const entry = surface === 'decisions'
    ? { date: '2026-09-12', title: 'Fixture', decision: 'Keep', reason: null, alternatives: null, impact: null }
    : { date: '2026-09-12', text: 'Keep', tag: null };
  const generated = render(surface, [entry]);
  test(`${surface}: exact generated`, () => checkMetrics(surface, generated, 'not-needed'));
  test(`${surface}: generated with opaque suffix`, () => checkMetrics(surface, generated + '\nManual 가 note\r\n', 'not-needed'));
  test(`${surface}: arbitrary preamble requires retention`, () => checkMetrics(surface, 'Manual preamble\n' + generated, 'candidate-requires-raw-retention'));
  test(`${surface}: CRLF requires retention`, () => checkMetrics(surface, generated.replace(/\n/g, '\r\n'), 'candidate-requires-raw-retention'));
  test(`${surface}: BOM is parsed like checked input but retained`, () => checkMetrics(surface, '\ufeff' + generated, 'candidate-requires-raw-retention'));
  test(`${surface}: first-heading BOM still parses a record`, () => {
    const raw = surface === 'decisions' ? '\ufeff### First\n- Decision: Yes\n' : '\ufeff### 2026-09-12\n- Lesson: Yes\n';
    assert.equal(checkMetrics(surface, raw, 'candidate-requires-raw-retention').parsedRecordCount, 1);
  });
  for (const text of ['', 'Manual only\r\n\ufeff', render(surface, [])]) test(`${surface}: no-record ${text.length}`, () => checkMetrics(surface, text, 'not-needed'));
  for (const raw of [[0xff], [0xc3, 0x28], [0xed, 0xa0, 0x80], [0xf0, 0x9f]]) {
    test(`${surface}: invalid UTF-8 ${raw.join('-')}`, () => {
      const report = call(fixture(surface, Buffer.from(raw)));
      assert.equal(report.disposition, 'incomplete');
      assert.deepEqual(report.reasonCodes, ['legacy_utf8_invalid']);
      assert.equal(report.parsedRecordCount, null);
    });
  }
}
test('lowercase producer lesson remains opaque, never extraction-complete', () => {
  const report = checkMetrics('lessons', '### 2026-09-12\n- lesson: raw canary\n', 'not-needed');
  assert.equal(report.parsedRecordCount, 0);
  assert.equal(report.semanticCoverage, 'unknown');
});
test('empty fields and null use existing parser semantics', () => checkMetrics('decisions', '### X\n- Decision:\n- Reason:\n', 'candidate-requires-raw-retention'));
test('unknown fields, duplicate records and multiline notes do not claim complete extraction', () => {
  const text = '### X\n- Decision: first\n  continuation\n- Custom: retain\n### X\n- Decision: second\n';
  const report = checkMetrics('decisions', text, 'candidate-requires-raw-retention');
  assert.equal(report.parsedRecordCount, 2);
});
test('metadata omits payloads, paths and user text', () => {
  const canary = 'private-canary-unique-content';
  const input = fixture('decisions', Buffer.from(`### ${canary}\n- Decision: ${canary}\n`));
  const report = JSON.stringify(call(input));
  assert.equal(report.includes(canary), false);
  assert.equal(report.includes(input.legacy.bytesBase64), false);
  assert.equal(report.includes('bytesBase64'), false);
});

for (const offset of [-1, 0, 1]) test(`raw input byte boundary ${offset}`, () => {
  const report = call(fixture('lessons', Buffer.alloc(api.MAX_LEGACY_BYTES + offset, 0x61)));
  assert.equal(report.disposition, offset <= 0 ? 'not-needed' : 'incomplete');
  if (offset > 0) assert.deepEqual(report.reasonCodes, ['input_budget_exceeded']);
});
test('multibyte raw input uses byte count', () => {
  const report = call(fixture('lessons', Buffer.from('가'.repeat(Math.ceil(api.MAX_LEGACY_BYTES / 3)))));
  assert.deepEqual(report.reasonCodes, ['input_budget_exceeded']);
});

// Compare the counter against the real existing serializers, not another copy
// of its formula. Includes escaping, C0/C1 controls, astral Unicode and fields.
test('generated-format byte measurements match 160 varied writer outputs', () => {
  const samples = ['가', '😀', '"\\', '\u0001', '\b\t\f\r', '\u0080\u009f', '\u2028\u2029', 'one two'];
  for (const surface of ['decisions', 'lessons']) for (let i = 0; i < 80; i++) {
    const word = samples[i % samples.length] + i;
    const raw = surface === 'decisions'
      ? `### ${word}\n- Decision: ${word}\n- Reason: ${word}\n- Alternatives: ${word}\n- Impact: ${word}\n`
      : `### 2026-09-12 ${word}\n- Lesson: ${word}\n- Tag: ${word}\n`;
    const text = raw.repeat(i % 5 + 1);
    checkMetrics(surface, text, parse(surface, text).length ? 'candidate-requires-raw-retention' : 'not-needed');
  }
});
for (const offset of [-1, 0, 1]) test(`combined output byte boundary ${offset}`, () => {
  const base = '### Boundary\n- Decision: ';
  const fixed = parse('decisions', base + '\u0001\n');
  const overhead = Buffer.byteLength(JSON.stringify(fixed, null, 2) + '\n') + Buffer.byteLength(render('decisions', fixed)) - 7;
  const target = api.MAX_OUTPUT_BYTES + offset;
  let ascii = 0;
  while ((target - overhead - 2 * ascii) % 7 !== 0) ascii++;
  const controls = (target - overhead - 2 * ascii) / 7;
  const raw = base + '\u0001'.repeat(controls) + 'x'.repeat(ascii) + '\n';
  assert.ok(Buffer.byteLength(raw) < api.MAX_LEGACY_BYTES);
  const entries = parse('decisions', raw);
  assert.equal(Buffer.byteLength(JSON.stringify(entries, null, 2) + '\n') + Buffer.byteLength(render('decisions', entries)), target);
  const report = call(fixture('decisions', Buffer.from(raw)));
  assert.equal(report.disposition, offset <= 0 ? 'candidate-requires-raw-retention' : 'incomplete');
  if (offset > 0) assert.deepEqual(report.reasonCodes, ['output_budget_exceeded']);
  else assert.equal(report.candidateCanonicalBytes + report.candidateProjectionBytes, target);
});

console.log(`memory-migration-plan: ${passed}/${total} passed`);
console.log(JSON.stringify({ suite: 'memory-migration-plan', passed, total, failed: total - passed }));
process.exitCode = passed === total ? 0 : 1;
