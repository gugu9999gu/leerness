#!/usr/bin/env node
'use strict';

// T-0307: session close keeps user-written handoff text by position, and every reader of the
// handoff looks at the current generated region rather than the whole file.
//   - a note under the title or a section the generator never writes survives, exactly once
//   - the generator's own title / Last generated / sections are still replaced (no over-keeping)
//   - drift and audit read the region, so legacy text kept below it no longer reports stale state
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const current = require('../lib/context-current');

const cli = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const START = '<!-- leerness:current-handoff:start -->';
const END = '<!-- leerness:current-handoff:end -->';
const block = when => ['# Session Handoff', '', `Last generated: ${when}`, '', '## Completed', '- T-0001 done', '',
  '## Next Exact Step', '- continue', ''].join('\n');
const count = (text, needle) => text.split(needle).length - 1;

// 1. updateHandoff keeps user text by position.
{
  const userNote = '## 2026-09-10 수동 인계 — KEEP-NOTE\n\n사용자가 직접 쓴 문단.\n\n```md\n## Completed\n예시 코드 안의 제목\n```';
  const userTail = '## My follow-ups\n- ask the owner about KEEP-TAIL';
  const region = ['# Session Handoff', '', userNote, '', 'Last generated: 2026-09-01T00:00:00.000Z', '',
    '## Completed', '- T-0000 stale generated line', '', '## Next Exact Step', '- old step', '', userTail, ''].join('\n');
  const doc = `---\nleernessRole: session-handoff\n---\n${START}\n${region}${END}\n\n# Legacy notes\nolder text\n`;
  const once = current.updateHandoff(doc, block('2026-09-28T00:00:00.000Z'), 'fixture');
  const after = once.slice(once.indexOf(END));
  assert(after.includes('KEEP-NOTE') && after.includes('사용자가 직접 쓴 문단.'), 'the note under the title moves after the region');
  assert(after.includes('예시 코드 안의 제목'), 'a heading inside fenced code stays part of the user text');
  assert(after.includes('KEEP-TAIL'), 'a section the generator never writes is kept');
  assert(once.endsWith('# Legacy notes\nolder text\n'), 'text after the region is untouched');
  assert(!once.includes('T-0000 stale generated line') && !once.includes('- old step'), 'generator sections are replaced');
  assert.strictEqual(count(current.currentHandoffRegion(once), 'Last generated:'), 1, 'one Last generated in the region');
  assert(!after.includes('2026-09-01T00:00:00.000Z'), 'an old Last generated line is not carried outside');
  const twice = current.updateHandoff(once, block('2026-09-29T00:00:00.000Z'), 'fixture');
  assert.strictEqual(count(twice, 'KEEP-NOTE'), 1, 'a second close keeps the note exactly once');
  assert.strictEqual(count(twice, 'KEEP-TAIL'), 1, 'a second close keeps the section exactly once');
  const indented = current.updateHandoff(`${START}\n# Session Handoff\n\n    indented owner note\n\nLast generated: 2026-09-01T00:00:00.000Z\n\n## Completed\n- x\n${END}\n`,
    block('2026-09-28T00:00:00.000Z'), 'fixture');
  assert(indented.includes(`${END}\n\n    indented owner note\n`), 'kept text keeps its indentation');
  // Control: when the generator itself writes free text under the title, that text is its own.
  const first = current.updateHandoff('# User\n', '# Session Handoff\nfirst\n', 'fixture');
  const second = current.updateHandoff(first, '# Session Handoff\nsecond\n', 'fixture');
  assert(!second.includes('first\n') && second.includes('second\n'), 'generated head text is not kept as user text');
  assert.strictEqual(current.currentHandoffRegion('no markers'), null);
  console.log('PASS: updateHandoff keeps user text by position, once, and still replaces generated text');
}

// 2. Real session close, drift and audit.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-handoff-keep-'));
const env = {
  ...process.env,
  LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_AUTO_ROADMAP: '1',
  LEERNESS_NO_STALE_CHECK: '1', LEERNESS_INTERNAL: '1', LEERNESS_CACHE_DIR: path.join(root, 'machine-cache'),
};
function cliRun(args, cwd) {
  const result = cp.spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024 });
  assert.strictEqual(result.status, 0, `${args.join(' ')} exited ${result.status}: ${String(result.stderr || result.stdout).slice(0, 600)}`);
  return result.stdout;
}
const handoffAge = dir => JSON.parse(cliRun(['drift', 'check', dir, '--json'], dir)).signals.find(s => s.file === 'session-handoff.md').ageDays;
try {
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  cliRun(['init', project, '--yes'], project);
  const file = path.join(project, '.leerness', 'session-handoff.md');
  cliRun(['session', 'close', project, '--no-suggest'], project);
  const closed = fs.readFileSync(file, 'utf8');
  const at = closed.indexOf('Last generated:', closed.indexOf(START));
  fs.writeFileSync(file, closed.slice(0, at) + '## Owner note — KEEP-CLOSE\n\nWritten between the title and Last generated.\n\n' + closed.slice(at));
  cliRun(['session', 'close', project, '--no-suggest'], project);
  const kept = fs.readFileSync(file, 'utf8');
  assert.strictEqual(count(kept, 'KEEP-CLOSE'), 1, 'session close keeps the owner note exactly once');
  assert(kept.indexOf('KEEP-CLOSE') > kept.indexOf(END), 'the owner note now sits outside the generated region');
  assert(handoffAge(project) < 1, 'drift reads the fresh generated region');
  assert(!/never auto-generated/.test(cliRun(['audit', project], project)), 'audit sees the generated region after close');
  console.log('PASS: session close keeps the owner note; drift and audit read the current region');

  // A legacy handoff without markers keeps its text below the new region; its old date is history.
  const legacy = path.join(root, 'legacy');
  fs.mkdirSync(legacy);
  cliRun(['init', legacy, '--yes'], legacy);
  const legacyFile = path.join(legacy, '.leerness', 'session-handoff.md');
  fs.writeFileSync(legacyFile, '# Session Handoff\n\n## Manual — KEEP-LEGACY\n\nOwner text.\n\nLast generated: 2001-01-01T00:00:00.000Z\n\n## Completed\n- old\n');
  cliRun(['session', 'close', legacy, '--no-suggest'], legacy);
  assert(fs.readFileSync(legacyFile, 'utf8').includes('KEEP-LEGACY'), 'legacy owner text is kept');
  assert(handoffAge(legacy) < 1, 'drift does not read the legacy date kept below the region');
  console.log('PASS: legacy handoff text is kept and its old date no longer reads as stale');
} finally {
  const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(root));
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    'temporary cleanup target must remain inside the system temp directory');
  fs.rmSync(root, { recursive: true, force: true });
}
