'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ordinary = require('../lib/memory-migration-plan');
const root = path.resolve(__dirname, '..');
const sources = Object.fromEntries(['pure-utils', 'memory-json-size', 'memory-migration-budget', 'memory-migration-plan'].map(name => [name, fs.readFileSync(path.join(root, 'lib', `${name}.js`), 'utf8')]));
const encode = (raw, canonicalState = 'absent') => JSON.stringify({
  schemaVersion: 1, surface: 'decisions', canonicalState,
  legacy: { state: 'present', bytesBase64: raw.toString('base64') }
});
const good = encode(Buffer.from('### X\n- Decision: keep\n'));
let total = 0;
let passed = 0;
const test = (name, run) => {
  total++;
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack}`); }
};

const isolated = (options = {}) => {
  const denied = () => { throw Error('forbidden effect'); };
  const cache = {};
  const counters = { renderedOutputs: 0, parsed: 0 };
  const instrument = exports => ({
    ...exports,
    _decisionsFromMd: text => {
      counters.parsed++;
      if (options.forbidParse) throw Error('parser must not run');
      return exports._decisionsFromMd(text);
    },
    _renderDecisionsMd: entries => {
      if (entries.length) {
        counters.renderedOutputs++;
        if (options.forbidOutput) throw Error('whole output must not be allocated');
      }
      return exports._renderDecisionsMd(entries) + (options.formatDrift && entries.length ? 'extra' : '');
    }
  });
  const load = name => {
    if (name === 'node:util') return { TextDecoder: require('node:util').TextDecoder };
    const key = name.replace(/^\.\//, '');
    if (!Object.hasOwn(sources, key)) throw Error('forbidden require');
    if (cache[key]) return cache[key].exports;
    const module = { exports: {} }; cache[key] = module;
    const inertJson = { parse: JSON.parse, stringify(value, ...args) {
      if (Array.isArray(value)) throw Error('canonical payload must not be allocated');
      return JSON.stringify(value, ...args);
    } };
    const context = vm.createContext({ module, exports: module.exports, require: load, Buffer, JSON: inertJson,
      process: new Proxy({}, { get: denied }), Date: new Proxy(denied, { get: denied }),
      setTimeout: denied, setInterval: denied, fetch: denied });
    new vm.Script(sources[key], { filename: key }).runInContext(context, { timeout: 5000 });
    if (key === 'pure-utils') module.exports = instrument(module.exports);
    return module.exports;
  };
  return { api: load('./memory-migration-plan'), counters };
};

test('load and successful assessment without I/O, clock or canonical stringify', () => {
  const sandbox = isolated();
  assert.equal(JSON.stringify(sandbox.api.assessLegacyMemoryMigration(good)), JSON.stringify(ordinary.assessLegacyMemoryMigration(good)));
  assert.equal(sandbox.counters.parsed, 1);
  assert.equal(sandbox.counters.renderedOutputs, 1); // Positive control: trap is reached.
});
test('output expansion is refused before whole projection allocation', () => {
  const sandbox = isolated({ forbidOutput: true });
  const input = encode(Buffer.from('### X\n- Decision: ' + '\u0001'.repeat(700000) + '\n'));
  const result = sandbox.api.assessLegacyMemoryMigration(input);
  assert.equal(result.reasonCodes[0], 'output_budget_exceeded');
  assert.equal(sandbox.counters.parsed, 1);
  assert.equal(sandbox.counters.renderedOutputs, 0);
});
test('raw input over budget never calls the legacy parser', () => {
  const sandbox = isolated({ forbidParse: true });
  const result = sandbox.api.assessLegacyMemoryMigration(encode(Buffer.alloc(ordinary.MAX_LEGACY_BYTES + 1, 0x61)));
  assert.equal(result.reasonCodes[0], 'input_budget_exceeded');
  assert.equal(sandbox.counters.parsed, 0);
});
test('repeated unmatched fence input is refused before the slow legacy parser', () => {
  const sandbox = isolated({ forbidParse: true });
  const raw = Buffer.from('```x\n'.repeat(Math.floor(ordinary.MAX_LEGACY_BYTES / 5)));
  const result = sandbox.api.assessLegacyMemoryMigration(encode(raw));
  assert.equal(result.reasonCodes[0], 'parser_budget_exceeded');
  assert.equal(result.parsedRecordCount, null);
  assert.equal(sandbox.counters.parsed, 0);
});
for (const offset of [-1, 0, 1]) test(`fence work estimate boundary ${offset}`, () => {
  const sandbox = isolated({ forbidParse: offset > 0 });
  const fenceStarts = 64;
  const length = ordinary.MAX_FENCE_SCAN_UNITS / fenceStarts + offset;
  const prefix = '```x\n'.repeat(fenceStarts);
  const result = sandbox.api.assessLegacyMemoryMigration(encode(Buffer.from(prefix + 'x'.repeat(length - prefix.length))));
  assert.equal(result.disposition, offset <= 0 ? 'not-needed' : 'incomplete');
  assert.equal(sandbox.counters.parsed, offset <= 0 ? 1 : 0);
});
test('leading BOM cannot hide a fence opener from the parser budget', () => {
  const sandbox = isolated({ forbidParse: true });
  const length = ordinary.MAX_FENCE_SCAN_UNITS / 64 + 1;
  const prefix = '```x\n'.repeat(64);
  const result = sandbox.api.assessLegacyMemoryMigration(encode(Buffer.from('\ufeff' + prefix + 'x'.repeat(length - prefix.length))));
  assert.equal(result.reasonCodes[0], 'parser_budget_exceeded');
  assert.equal(sandbox.counters.parsed, 0);
});
test('invalid UTF-8 never calls the legacy parser', () => {
  const sandbox = isolated({ forbidParse: true });
  assert.equal(sandbox.api.assessLegacyMemoryMigration(encode(Buffer.from([0xff]))).reasonCodes[0], 'legacy_utf8_invalid');
  assert.equal(sandbox.counters.parsed, 0);
});
test('canonical present never parses legacy or allocates outputs', () => {
  const sandbox = isolated({ forbidParse: true, forbidOutput: true });
  assert.equal(sandbox.api.assessLegacyMemoryMigration(encode(Buffer.from('invalid-legacy'), 'present')).reasonCodes[0], 'canonical_present');
  assert.equal(sandbox.counters.parsed, 0);
});
test('unexpected projection format cannot produce a candidate', () => {
  const sandbox = isolated({ formatDrift: true });
  const result = sandbox.api.assessLegacyMemoryMigration(good);
  assert.equal(result.disposition, 'incomplete');
  assert.equal(result.reasonCodes[0], 'projection_format_changed');
  assert.equal(result.candidateProjectionBytes, null);
});

console.log(`memory-migration-isolation: ${passed}/${total} passed`);
console.log(JSON.stringify({ suite: 'memory-migration-isolation', passed, total, failed: total - passed }));
process.exitCode = passed === total ? 0 : 1;
