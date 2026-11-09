'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderCloseHandoff } = require('../lib/session-close-handoff');
const context = require('../lib/context-current');
const START = '<!-- leerness:current-handoff:start -->', END = '<!-- leerness:current-handoff:end -->';
const generated = '# Session Handoff\n\nLast generated: 2026-11-03\n\n## Completed\n- none\n\n## Next Exact Step\n- T-0002 — run test\n';
const wrap = body => `${START}\n# Session Handoff\n\n${body}${END}\n\n## Historical handoff\nKeep original source.\n`;
const render = text => renderCloseHandoff(text, generated, { row: { id: 'T-0002' } }, 'run test', 'fixture', 'none');

test('changing the action retains authored paragraphs and other sections byte-for-byte', () => {
  const text = wrap('## Completed\n- T-0003 (done) — exact evidence\n\n## Next Exact Step\n- T-0001 — old\n\nKeep this recovery instruction.\n- Do not delete raw records.\n\n## Recommended Direction\nKeep native first.\n');
  assert.equal(render(text), text.replace('- T-0001 — old', '- T-0002 — run test'));
});
test('a substring of an obsolete action is not a canonical match', () => {
  const text = wrap('## Next Exact Step\n- T-0002 — run test then deploy\n');
  assert.equal(render(text), text.replace('run test then deploy', 'run test'));
});
for (const fence of ['```', '~~~~']) test('fenced examples are not next-step headings or task instructions: ' + fence, () => {
  const text = wrap(`## Examples\n${fence}md\n## Next Exact Step\n- T-9999 — example\n${fence}\n\n## Next Exact Step\n- T-0001 — old\n\n${fence}\n## Next Exact Step\n- T-9998 — keep this sample\n${fence}\n`);
  assert.equal(render(text), text.replace('- T-0001 — old', '- T-0002 — run test'));
});
test('an already canonical action preserves the complete document on repeated use', () => {
  const text = wrap('## Next Exact Step\n\n- T-0002 — run test\n\nKeep notes.\n');
  assert.equal(render(render(text)), text);
});
test('curated CRLF and frontmatter are retained', () => {
  const text = ('---\ncustom: 한글 e\u0301\n---\n' + wrap('## Next Exact Step\n- T-0001 — old\n\n메모\n')).replace(/\n/g, '\r\n');
  assert.equal(render(text), text.replace('- T-0001 — old', '- T-0002 — run test'));
});
test('a missing next heading is appended without deleting authored content', () => {
  const text = wrap('## Completed\n- owner evidence\n');
  const result = render(text);
  assert(result.includes('## Completed\n- owner evidence\n'));
  assert(result.includes('## Next Exact Step\n- T-0002 — run test\n'));
  assert.equal(render(result), result);
});
test('a next section without a task keeps its notes when the canonical action is inserted', () => {
  const text = wrap('## Next Exact Step\n\nConfirm with the owner.\n- Keep the recovery backup.\n');
  assert.equal(render(text), text.replace('## Next Exact Step\n', '## Next Exact Step\n- T-0002 — run test\n'));
});
test('duplicate next headings fail without choosing one', () => {
  assert.throws(() => render(wrap('## Next Exact Step\n- T-0001 — old\n\n## Next Exact Step\n- T-0002 — other\n')), { code: 'E_TEXT_FORMAT' });
});
test('multiple task instructions fail instead of guessing which to erase', () => {
  assert.throws(() => render(wrap('## Next Exact Step\n- T-0001 — old\n- T-0003 — other\n')), { code: 'E_TEXT_FORMAT' });
});
test('no actionable task removes only the previous canonical instruction', () => {
  const text = wrap('## Next Exact Step\n- T-0001 — old\n\nKeep explanation.\n');
  const result = renderCloseHandoff(text, generated, { row: null }, null, 'fixture', 'none');
  assert.equal(result, text.replace('- T-0001 — old', '- none'));
});
test('an empty placeholder is updated without accumulating duplicate lines', () => {
  const text = wrap('## Next Exact Step\n- none\n');
  assert.equal(render(text), text.replace('- none', '- T-0002 — run test'));
});
test('generated regions still refresh and legacy documents retain their prior source', () => {
  const text = START + '\n' + generated.replace('2026-11-03', '2026-01-01') + END + '\n';
  assert.equal(render(text), context.updateHandoff(text, generated, 'fixture'));
  const legacy = '# Original\nAuthored source.\n';
  assert.equal(render(legacy), context.updateHandoff(legacy, generated, 'fixture'));
});
test('malformed markers still fail before accepting a curated document', () => {
  assert.throws(() => render(START + '\n# Session Handoff\n## Next Exact Step\n- T-0002 — run test\n'), { code: 'E_TEXT_FORMAT' });
});
