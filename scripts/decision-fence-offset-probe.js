'use strict';
// T-0335: decision fences are found in one pass. Two readers matched fenced code with expressions that searched to the
// end of the text again from every opening that never closes: _decisionBlocksWithOffset (decisions.md with line
// numbers, /^```[^\n]*\n[\s\S]*?\n```[ \t]*$/gm, masked in place) and _stripDecisionFences (the decisions archive
// reader, decisions.md parsing and the dated-block count, /^```[^\n]*\n[\s\S]*?\n```\s*$/gm, removed). T-0331 had
// bounded the second by the last closing, which still left openings separated by \r, U+2028 or U+2029 quadratic with a
// closing at the very end (review round 1). Both now use one scanner; the results are the same as the expressions'.
const assert = require('assert');
const pu = require('../lib/pure-utils');

const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
if (process.argv.includes('--match') && !filter) { console.error('--match needs a test name substring'); process.exit(1); }
let passed = 0, failed = 0, ran = 0;
const test = (name, fn) => { if (filter && !name.includes(filter)) return; ran++; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };

// The two readers as they were before T-0331 and T-0335, from the same helpers.
const ORIGINAL_STRIP = text => String(text || '').replace(/^```[^\n]*\n[\s\S]*?\n```\s*$/gm, '');
const ORIGINAL_OFFSETS = text => {
  const raw = String(text || '');
  const masked = raw.replace(/^```[^\n]*\n[\s\S]*?\n```[ \t]*$/gm, m => m.replace(/[^\n]/g, ' '));
  return pu._blocksWithOffset(masked, /\n(?=### )/)
    .filter(x => x.block.startsWith('### ') && !/^### (Template|템플릿)\b/.test(x.block.trim()));
};
const C = String.fromCharCode;
const PARTS = ['`', '```', '````', '\n', '\n', '\r', '\r\n', ' ', ' ', C(9), 'a', '#', '### ', '### 2026-01-01 — d\n- Decision: x\n', '### Template\n',
  C(0xa0), C(0x2028), C(0x2029), C(0xfeff), C(0x0b), '\n```', '```md\n', '```md\r', '\n``` ', '\n```' + C(9) + '\n', '\n```\r'];

test('the same results as both expressions on random texts', () => {
  // xorshift32: the multiply-and-mask generator used before drew only 1,193 distinct texts of 30,000 (review round 1).
  let x = 88172645, differStrip = 0, differOffsets = 0, first = null;
  const rnd = n => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % n; };
  const seen = new Set();
  for (let t = 0; t < 30000; t++) {
    let s = '';
    for (let i = rnd(30); i > 0; i--) s += PARTS[rnd(PARTS.length)];
    seen.add(s);
    if (ORIGINAL_STRIP(s) !== pu._stripDecisionFences(s)) { differStrip++; if (!first) first = JSON.stringify(s); }
    if (JSON.stringify(ORIGINAL_OFFSETS(s)) !== JSON.stringify(pu._decisionBlocksWithOffset(s))) { differOffsets++; if (!first) first = JSON.stringify(s); }
  }
  assert.ok(seen.size > 25000, 'only ' + seen.size + ' distinct texts');
  assert.deepStrictEqual([differStrip, differOffsets], [0, 0], 'first differing text: ' + first);
});

test('a closed fence still hides a heading inside it, with the offsets of the original text', () => {
  const text = '### 2026-01-01 — one\n- Decision: a\n```md\n### 2026-01-02 — not a heading\n```\n### 2026-01-03 — two\n- Decision: b\n';
  const got = pu._decisionBlocksWithOffset(text).map(x => [x.block.split('\n')[0], x.line]);
  assert.deepStrictEqual(got, [['### 2026-01-01 — one', 1], ['### 2026-01-03 — two', 6]]);
  assert.deepStrictEqual(JSON.stringify(pu._decisionBlocksWithOffset(text)), JSON.stringify(ORIGINAL_OFFSETS(text)));
  assert.strictEqual(pu._stripDecisionFences(text), ORIGINAL_STRIP(text));
  assert.strictEqual(pu._countDatedBlocks(text), 2);
});

test('many unclosed openings are read in linear time, by every fence reader', () => {
  const N = 64000, openings = '```md\n'.repeat(N), slow = [];
  const shapes = [
    ['one closing, then openings', '### 2026-01-01 — d\n```a\nb\n```\n' + openings, 1],
    ['openings, then one closing', '### 2026-01-01 — d\n' + openings + '\n```\n### 2026-01-02 — e\n', 2],
    ['closing lines with text after them', '### 2026-01-01 — d\n' + '```md\nx\n``` y\n'.repeat(N / 4), 1],
    // Not a closing for the offsets expression (only spaces or tabs may follow the backticks).
    ['openings, then backticks with a no-break space after them', '### 2026-01-01 — d\n' + openings + '\n```' + C(0xa0) + '\n', 1],
    // Review round 1: openings that share one \n, with a closing at the very end.
    ['openings separated by CR, a closing at the end', '### 2026-01-01 — d\n' + '```md\r'.repeat(N) + '\n```', 1],
    ['openings separated by U+2028, a closing at the end', '### 2026-01-01 — d\n' + ('```md' + C(0x2028)).repeat(N) + '\n```', 1],
    ['openings separated by U+2029, a closing at the end', '### 2026-01-01 — d\n' + ('```md' + C(0x2029)).repeat(N) + '\n```', 1],
  ];
  for (const [label, text, blocks] of shapes) {
    for (const [reader, fn] of [['offsets', () => pu._decisionBlocksWithOffset(text).length], ['strip', () => pu._extractDecisionBlocks(text).length], ['count', () => pu._countDatedBlocks(text)]]) {
      const t0 = Date.now();
      const got = fn();
      const ms = Date.now() - t0;
      if (reader === 'offsets') assert.strictEqual(got, blocks, label);
      if (ms >= 1000) slow.push(reader + ', ' + label + ': ' + ms + ' ms');
    }
  }
  assert.deepStrictEqual(slow, []);
});

console.log(`decision fence offsets: ${passed}/${passed + failed}`);
if (filter && !ran) console.error(`--match ${JSON.stringify(filter)} selected no test`);
if (failed || (filter ? ran === 0 : ran !== 3)) process.exitCode = 1;
