#!/usr/bin/env node
'use strict';

// T-0193: real CLI coverage for fail-closed legacy archive retention plus
// operation-local checked-file snapshot primitives used by restore.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const { captureCheckedFileInput, assertCheckedFileCurrent } = require('../lib/memory-input');
const { inspectArchiveEntry } = require('../lib/memory-archive');
const { _renderDecisionsMd, _renderLessonsMd } = require('../lib/pure-utils');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin/leerness.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-memory-archive-retention-'));
const seed = path.join(temp, 'seed');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC)$/i.test(key)));
for (const key of ['TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
  env[key] = path.join(temp, key.toLowerCase());
  fs.mkdirSync(env[key], { recursive: true });
}
Object.assign(env, { LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1' });

const results = [];
let sequence = 0;
const sha = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
function run(project, args) {
  const r = cp.spawnSync(process.execPath, [cli, ...args, '--path', project, '--json'], { cwd: project, env, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
  assert.strictEqual(r.error, undefined, r.error && r.error.message);
  assert.strictEqual(r.signal, null);
  return r;
}
function success(r) { assert.strictEqual(r.status, 0, String(r.stdout || r.stderr).slice(-1000)); }
function fixture(surface, entry) {
  const project = path.join(temp, `case-${++sequence}`);
  require('../lib/copy-tree').copyTreeSync(seed, project);
  const hd = path.join(project, '.leerness');
  const json = path.join(hd, `${surface}.json`);
  const md = path.join(hd, `${surface}.md`);
  const archive = path.join(hd, `${surface}.archive.md`);
  fs.writeFileSync(json, JSON.stringify([entry], null, 2) + '\n');
  fs.writeFileSync(md, surface === 'decisions' ? _renderDecisionsMd([entry]) : _renderLessonsMd([entry]));
  const before = () => ({ json: sha(json), md: sha(md), archive: sha(archive) });
  const target = surface === 'decisions' ? entry.title : entry.text;
  return { project, json, md, archive, before, target };
}
function rejectedUnchanged(surface, entry, expectedCode = 'archive_lossy') {
  const f = fixture(surface, entry);
  const before = f.before();
  const r = run(f.project, [surface === 'decisions' ? 'decision' : 'lesson', 'drop', f.target]);
  assert(r.status > 0, 'destructive drop unexpectedly succeeded');
  const payload = JSON.parse(r.stdout);
  assert.strictEqual(payload.code, expectedCode);
  assert.deepStrictEqual(f.before(), before, 'rejected drop changed memory-domain files');
}
// T-0328: characters the exact line must never carry raw (they break or forge lines in viewers and terminals).
const RAW_FORBIDDEN = [0x85, 0x7f, 0x2028, 0x2029].map(code => String.fromCharCode(code));
function archiveDate(f) {
  const m = fs.readFileSync(f.archive, 'utf8').match(/## 제거 (\d{4}-\d{2}-\d{2})/);
  assert(m, 'the archive has no drop header');
  return m[1];
}
// T-0331: a drop now starts each block with an integrity record ("- Archive check: ..."), which refuses any edit before
// the structural checks run. The tests that edit an archive by hand check those structural checks, which still read
// blocks without a record (older drops, or a record deleted on purpose), so they delete the record first.
function withoutRecord(f) { fs.writeFileSync(f.archive, fs.readFileSync(f.archive, 'utf8').replace(/^- Archive check: [^\n]*\n/gm, '')); }
// Drop by `target` (the entry's own text by default), check the exact line, restore by the drop date, compare.
function dropRestoresExactly(surface, entry, target) {
  const f = fixture(surface, entry);
  success(run(f.project, [surface === 'decisions' ? 'decision' : 'lesson', 'drop', target === undefined ? f.target : target]));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')), []);
  const archived = fs.readFileSync(f.archive, 'utf8');
  assert(archived.includes('\n- Exact JSON: '), 'the archive has no exact line: ' + JSON.stringify(archived));
  for (const ch of RAW_FORBIDDEN) assert(!archived.includes(ch), 'raw U+' + ch.charCodeAt(0).toString(16) + ' in the archive');
  success(run(f.project, ['memory', 'restore', surface, archiveDate(f)]));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')), [entry]);
}

try {
  fs.mkdirSync(seed);
  success(run(seed, ['init', seed, '--yes', '--language', 'en', '--no-stale-check']));

  check('decision archive round-trip accepts ordinary canonical entry', () => {
    const entry = { date: '2026-09-11', title: 'ordinary-decision', decision: 'ordinary-decision', reason: 'reason', alternatives: null, impact: null };
    const inspected = inspectArchiveEntry('decisions', entry);
    assert.strictEqual(inspected.lossless, true);
    assert.deepStrictEqual(inspected.restored, entry);
  });
  check('lesson archive round-trip accepts ordinary canonical entry', () => {
    const entry = { date: '2026-09-11', text: 'ordinary-lesson', tag: 'tag' };
    const inspected = inspectArchiveEntry('lessons', entry);
    assert.strictEqual(inspected.lossless, true);
    assert.deepStrictEqual(inspected.restored, entry);
  });
  check('decision drop rejects unknown canonical fields without writes', () => rejectedUnchanged('decisions', {
    date: '2026-09-11', title: 'decision-extra', decision: 'decision-extra', reason: 'reason', alternatives: null, impact: null,
    extension: { nested: [1, null, { keep: true }] },
  }));
  // T-0328 (owner's choice): multi-line values used to be refused here; the exact line now carries them.
  check('decision drop archives multiline values exactly and restore brings them back', () => dropRestoresExactly('decisions', {
    date: '2026-09-11', title: 'decision-multiline', decision: 'decision-multiline', reason: 'line1\nline2', alternatives: null, impact: null,
  }));
  check('lesson drop rejects unknown canonical fields without writes', () => rejectedUnchanged('lessons', {
    date: '2026-09-11', text: 'lesson-extra', tag: null, extension: { keep: true },
  }));
  check('lesson drop archives multiline values exactly and restore brings them back', () => dropRestoresExactly('lessons', {
    date: '2026-09-11', text: 'lesson-multiline\nline2', tag: 'tag',
  }, 'lesson-multiline'));

  for (const surface of ['decisions', 'lessons']) {
    check(`${surface} ordinary drop still writes a restorable archive`, () => {
      const entry = surface === 'decisions'
        ? { date: '2026-09-11', title: 'normal-decision', decision: 'normal-decision', reason: 'reason', alternatives: null, impact: null }
        : { date: '2026-09-11', text: 'normal-lesson', tag: 'tag' };
      const f = fixture(surface, entry);
      const drop = run(f.project, [surface === 'decisions' ? 'decision' : 'lesson', 'drop', f.target]);
      success(drop);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')), []);
      assert(fs.readFileSync(f.archive, 'utf8').includes(f.target));
      const restore = run(f.project, ['memory', 'restore', surface, f.target]);
      success(restore);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')), [entry]);
    });
  }

  // T-0328: text fields the plain archive lines cannot carry exactly get an exact line; nothing else changes.
  check('archive round-trip carries exact text fields and still refuses unknown fields and non-string values', () => {
    const [NEL, DEL, LS] = RAW_FORBIDDEN;
    const exact = [
      ['lessons', { date: '2026-09-11', text: ' padded ', tag: null }],
      ['lessons', { date: '2026-09-11', text: '   ', tag: '' }],
      ['lessons', { date: '2026/09/11', text: 'a\tb' + NEL + LS + DEL + 'c\n### 2026-01-01\n- Lesson: forged', tag: ' - Lesson: x ' }],
      ['lessons', { date: '2026-09-11', text: 'see - Tag: fake', tag: null }],
      ['decisions', { date: '2026-09-11', title: ' Padded ', decision: 'line1\nline2', reason: '', alternatives: '- Reason: fake', impact: null }],
      ['decisions', { date: null, title: '2026-01-01 — looks dated', decision: 'd', reason: null, alternatives: null, impact: '  ' }],
    ];
    for (const [surface, entry] of exact) {
      const inspected = inspectArchiveEntry(surface, entry);
      assert.strictEqual(inspected.lossless, true, JSON.stringify(entry));
      assert.deepStrictEqual(inspected.restored, entry);
      assert.strictEqual(inspected.text.split('\n### ').length, 2, 'one heading per entry: ' + JSON.stringify(inspected.text));
      for (const ch of RAW_FORBIDDEN) assert(!inspected.text.includes(ch), 'raw U+' + ch.charCodeAt(0).toString(16));
    }
    for (const [surface, entry] of [
      ['lessons', { date: '2026-09-11', text: 'numeric tag', tag: 7 }],
      ['lessons', { date: '2026-09-11', text: 'extra', tag: null, extension: { keep: true } }],
      ['decisions', { date: '2026-09-11', title: 'n', decision: 'n', reason: 5, alternatives: null, impact: null }],
    ]) assert.strictEqual(inspectArchiveEntry(surface, entry).lossless, false, JSON.stringify(entry));
    // An entry the plain lines carry gets no exact line, so archives of such entries keep their bytes.
    for (const [surface, entry] of [['lessons', { date: '2026-09-11', text: 'ordinary', tag: 'tag' }],
      ['decisions', { date: '2026-09-11', title: 't', decision: 'd', reason: null, alternatives: null, impact: null }]]) {
      assert(!inspectArchiveEntry(surface, entry).text.includes('Exact'), JSON.stringify(entry));
    }
  });
  check('lessons with surrounding or only whitespace, tabs, an empty tag or another date form drop and restore exactly', () => {
    for (const [entry, target] of [
      [{ date: '2026-09-11', text: ' padded lesson ', tag: null }],
      [{ date: '2026-09-11', text: '   ', tag: null }],
      [{ date: '2026-09-11', text: 'tab\tinside', tag: 'tag' }],
      [{ date: '2026-09-11', text: 'empty tag', tag: '' }],
      [{ date: '2026/09/11', text: 'other date form', tag: null }],
    ]) dropRestoresExactly('lessons', entry, target);
  });
  check('decisions with a padded title, an empty reason or a blank impact drop and restore exactly', () => {
    for (const entry of [
      { date: '2026-09-11', title: ' padded decision ', decision: 'd', reason: null, alternatives: null, impact: null },
      { date: '2026-09-11', title: 'empty reason', decision: 'd', reason: '', alternatives: null, impact: '  ' },
    ]) dropRestoresExactly('decisions', entry);
  });
  check('a lesson saved with surrounding spaces through the CLI drops and restores exactly', () => {
    const project = path.join(temp, `case-${++sequence}`);
    require('../lib/copy-tree').copyTreeSync(seed, project);
    const json = path.join(project, '.leerness', 'lessons.json');
    success(run(project, ['lesson', 'save', ' existing ']));
    const saved = JSON.parse(fs.readFileSync(json, 'utf8'));
    assert.deepStrictEqual(saved.map(l => l.text), [' existing ']);
    success(run(project, ['lesson', 'drop', ' existing ']));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(json, 'utf8')), []);
    success(run(project, ['memory', 'restore', 'lessons', archiveDate({ archive: path.join(project, '.leerness', 'lessons.archive.md') })]));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(json, 'utf8')), saved);
  });
  check('restore keeps the trimmed-text conflict rule and --force restores the exact value', () => {
    const f = fixture('lessons', { date: '2026-09-11', text: ' dup ', tag: null });
    success(run(f.project, ['lesson', 'drop', ' dup ']));
    success(run(f.project, ['lesson', 'save', 'dup']));
    const conflict = run(f.project, ['memory', 'restore', 'lessons', archiveDate(f)]);
    assert(conflict.status > 0, 'restore over a trimmed duplicate unexpectedly succeeded');
    assert.strictEqual(JSON.parse(conflict.stdout).code, 'restore_conflict');
    success(run(f.project, ['memory', 'restore', 'lessons', archiveDate(f), '--force']));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')).map(l => l.text).sort(), [' dup ', 'dup']);
  });
  check('restore refuses an archive whose exact line is damaged or cut off, without writes', () => {
    // Review round 1: a payload cut off at the marker (then trimmed with the selected block), or a lost colon, must
    // still count as an exact line and refuse, not restore the normalized plain text.
    for (const damage of ['- Exact JSON: {not json', '- Exact JSON: {"text":" x ","extra":"y"}', '- Exact JSON: {"text":5}',
      '- Exact JSON: []', '- Exact JSON: {}', '- Exact JSON: ', '- Exact JSON:', '- Exact JSON', '- Exact JSON {"text":" damaged exact "}']) {
      const f = fixture('lessons', { date: '2026-09-11', text: ' damaged exact ', tag: null });
      success(run(f.project, ['lesson', 'drop', ' damaged exact ']));
      withoutRecord(f); const archived = fs.readFileSync(f.archive, 'utf8');
      assert(archived.includes('\n- Exact JSON: '), 'no exact line to damage');
      fs.writeFileSync(f.archive, archived.replace(/\n- Exact JSON: [^\n]*/, '\n' + damage));
      const before = f.before();
      const r = run(f.project, ['memory', 'restore', 'lessons', archiveDate(f)]);
      assert(r.status > 0, 'restore of a damaged exact line unexpectedly succeeded: ' + damage);
      assert.strictEqual(JSON.parse(r.stdout).code, 'archive_entry_invalid', damage);
      assert.deepStrictEqual(f.before(), before, 'a refused restore changed memory-domain files: ' + damage);
    }
  });
  check('one damaged exact line in a drop of several entries refuses the whole restore, so no entry is lost', () => {
    const f = fixture('lessons', { date: '2026-09-11', text: ' first padded ', tag: null });
    const both = [{ date: '2026-09-11', text: ' first padded ', tag: null }, { date: '2026-09-11', text: ' second padded ', tag: null }];
    fs.writeFileSync(f.json, JSON.stringify(both, null, 2) + '\n');
    fs.writeFileSync(f.md, _renderLessonsMd(both));
    success(run(f.project, ['lesson', 'drop', 'padded']));
    withoutRecord(f); const archived = fs.readFileSync(f.archive, 'utf8');
    assert.strictEqual(archived.split('\n- Exact JSON: ').length, 3, 'both entries carry an exact line');
    fs.writeFileSync(f.archive, archived.replace(/\n- Exact JSON: [^\n]*/, '\n- Exact JSON: {not json'));
    const before = f.before();
    const r = run(f.project, ['memory', 'restore', 'lessons', archiveDate(f)]);
    assert(r.status > 0, 'restore with one damaged entry unexpectedly succeeded');
    assert.strictEqual(JSON.parse(r.stdout).code, 'archive_entry_invalid');
    assert.deepStrictEqual(f.before(), before, 'a refused restore changed memory-domain files');
  });
  // Review round 1: what a restore reads is the archive as stored (UTF-8) and the selected drop block trimmed.
  const writeBoth = (f, rows) => { fs.writeFileSync(f.json, JSON.stringify(rows, null, 2) + '\n'); fs.writeFileSync(f.md, _renderLessonsMd(rows)); };
  check('a lone surrogate survives through the exact line instead of turning into U+FFFD', () => {
    // The second entry needs the exact line only because of the lone surrogate: compared as JavaScript strings its
    // plain lines look lossless, but the archive is stored in UTF-8.
    for (const entry of [{ date: '2026-09-11', text: ' x ', tag: 'tag' + String.fromCharCode(0xd800) },
      { date: '2026-09-11', text: 'plain x', tag: 'tag' + String.fromCharCode(0xd800) }]) {
      const inspected = inspectArchiveEntry('lessons', entry);
      assert.strictEqual(inspected.lossless, true, JSON.stringify(entry));
      assert(inspected.text.includes(String.fromCharCode(92) + 'ud800'), 'the exact line does not escape the lone surrogate: ' + JSON.stringify(entry));
      // Without lessons.md the drop goes through (with it, the projection guard refuses such an entry first).
      const f = fixture('lessons', entry);
      fs.unlinkSync(f.md);
      success(run(f.project, ['lesson', 'drop', entry.text]));
      success(run(f.project, ['memory', 'restore', 'lessons', archiveDate(f)]));
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')), [entry], JSON.stringify(entry));
    }
  });
  check('an empty lesson text at the end of a dropped block restores exactly', () => {
    const rows = [{ date: '2026-09-11', text: 'first', tag: null }, { date: '2026-09-11', text: '', tag: null }];
    const f = fixture('lessons', rows[0]); writeBoth(f, rows);
    success(run(f.project, ['lesson', 'drop', '2026-09-11']));
    success(run(f.project, ['memory', 'restore', 'lessons', archiveDate(f)]));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')), rows);
  });
  check('an entry left with only its heading refuses the restore instead of being left out of it', () => {
    const rows = [{ date: '2026-09-11', text: 'kept-one', tag: null }, { date: '2026-09-11', text: 'cut-two', tag: null }];
    const f = fixture('lessons', rows[0]); writeBoth(f, rows);
    success(run(f.project, ['lesson', 'drop', '2026-09-11']));
    withoutRecord(f); const archived = fs.readFileSync(f.archive, 'utf8');
    assert(archived.includes('- Lesson: cut-two\n'), 'no lesson line to cut');
    fs.writeFileSync(f.archive, archived.replace('- Lesson: cut-two\n', ''));
    const before = f.before();
    const r = run(f.project, ['memory', 'restore', 'lessons', archiveDate(f)]);
    assert(r.status > 0, 'restore with an unreadable entry unexpectedly succeeded');
    assert.strictEqual(JSON.parse(r.stdout).code, 'archive_entry_invalid');
    assert.deepStrictEqual(f.before(), before, 'a refused restore changed memory-domain files');
  });
  check('a cut exact line in one of several selected drops refuses the whole restore', () => {
    const rows = [{ date: '2026-09-11', text: ' one ', tag: null }, { date: '2026-09-11', text: ' two ', tag: null }];
    const f = fixture('lessons', rows[0]); writeBoth(f, rows);
    success(run(f.project, ['lesson', 'drop', ' one ']));
    success(run(f.project, ['lesson', 'drop', ' two ']));
    withoutRecord(f); const archived = fs.readFileSync(f.archive, 'utf8');
    assert.strictEqual(archived.split('\n## 제거 ').length, 3, 'two drop blocks');
    const two = /\n- Exact JSON: [^\n]*" two "[^\n]*/;
    assert(two.test(archived), 'no exact line to cut');
    fs.writeFileSync(f.archive, archived.replace(two, '\n- Exact JSON:'));
    const before = f.before();
    const r = run(f.project, ['memory', 'restore', 'lessons', archiveDate(f)]);
    assert(r.status > 0, 'restore with a cut exact line unexpectedly succeeded');
    assert.strictEqual(JSON.parse(r.stdout).code, 'archive_entry_invalid');
    assert.deepStrictEqual(f.before(), before, 'a refused restore changed memory-domain files');
  });
  check('an archive cut off inside an exact entry is refused before the exact line and restored exactly after it', () => {
    // The exact line comes right after the heading and holds every field: a cut that removes it takes the plain lines
    // with it (the entry cannot be read, so the restore refuses); a cut after it leaves enough to restore exactly.
    const rows = [{ date: '2026-09-11', text: ' first ', tag: 'kept tag' }, { date: '2026-09-11', text: ' last ', tag: 'cut tag' }];
    for (const where of ['after the heading', 'after the exact line', 'the last line removed']) {
      const f = fixture('lessons', rows[0]); writeBoth(f, rows);
      success(run(f.project, ['lesson', 'drop', '2026-09-11']));
      withoutRecord(f); const archived = fs.readFileSync(f.archive, 'utf8');
      const lastHeading = archived.lastIndexOf('\n### ');
      const exactAt = archived.indexOf('\n- Exact JSON: ', lastHeading);
      assert(lastHeading > 0 && exactAt > lastHeading, 'the last entry has no exact line');
      // 'the last line removed' drops the archive's last non-empty line, whatever it is.
      const body = archived.replace(/\n+$/, '');
      const cut = where === 'after the heading' ? archived.indexOf('\n', lastHeading + 1) + 1
        : where === 'after the exact line' ? archived.indexOf('\n', exactAt + 1) + 1
        : body.lastIndexOf('\n') + 1;
      fs.writeFileSync(f.archive, (where === 'the last line removed' ? body : archived).slice(0, cut));
      const before = f.before();
      const r = run(f.project, ['memory', 'restore', 'lessons', archiveDate(f)]);
      if (where === 'after the heading') {
        assert(r.status > 0, 'restore of a cut entry unexpectedly succeeded');
        assert.strictEqual(JSON.parse(r.stdout).code, 'archive_entry_invalid');
        assert.deepStrictEqual(f.before(), before, 'a refused restore changed memory-domain files');
      } else {
        success(r);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')), rows);
      }
    }
  });
  check('a drop by a target with quotes stays restorable by date and by target', () => {
    for (const by of ['date', 'target']) {
      const entry = { date: '2026-09-11', text: ' "quoted" lesson ', tag: null };
      const f = fixture('lessons', entry);
      success(run(f.project, ['lesson', 'drop', entry.text]));
      assert(fs.readFileSync(f.archive, 'utf8').includes('(target: " "quoted" lesson ")'), 'unexpected drop header');
      success(run(f.project, ['memory', 'restore', 'lessons', by === 'date' ? archiveDate(f) : '"quoted"']));
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')), [entry], 'restore by ' + by);
    }
  });
  check('a whitespace-only lesson whose tag holds "- Lesson: X" restores without a false conflict', () => {
    // The exact line holds `- Lesson: X "}`; an active lesson with exactly that text must not count as the same lesson.
    // (The plain lesson line always comes first and is what identities read; restore also reads them from the plain
    // lines only, which no rendered archive needs but a hand-edited one could.)
    const f = fixture('lessons', { date: '2026-09-11', text: '   ', tag: ' - Lesson: X ' });
    success(run(f.project, ['lesson', 'drop', '   ']));
    assert(fs.readFileSync(f.archive, 'utf8').includes('- Lesson: X "}'), 'the exact line does not hold the decoy');
    success(run(f.project, ['lesson', 'save', 'X "}']));
    success(run(f.project, ['memory', 'restore', 'lessons', archiveDate(f)]));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')).map(l => l.text).sort(), ['   ', 'X "}']);
  });
  // Review round 2.
  const writeDecisions = (f, rows) => { fs.writeFileSync(f.json, JSON.stringify(rows, null, 2) + '\n'); fs.writeFileSync(f.md, _renderDecisionsMd(rows)); };
  const refusedUnchanged = (f, label) => {
    const before = f.before();
    const r = run(f.project, ['memory', 'restore', f.surface || 'lessons', archiveDate(f)]);
    assert(r.status > 0, label + ': restore unexpectedly succeeded');
    assert.strictEqual(JSON.parse(r.stdout).code, 'archive_entry_invalid', label);
    assert.deepStrictEqual(f.before(), before, label + ': a refused restore changed memory-domain files');
  };
  check('a duplicate is found from the exact line alone, and --force still restores (both surfaces)', () => {
    // The conflict check read the archive's plain lines, so an archive cut right after the exact line let a duplicate
    // through without --force and consumed its block.
    for (const surface of ['lessons', 'decisions']) {
      const entry = surface === 'lessons' ? { date: '2026-09-11', text: ' dup ', tag: 'tag' }
        : { date: '2026-09-11', title: ' dupd ', decision: 'd', reason: 'r', alternatives: null, impact: null };
      const f = fixture(surface, entry);
      success(run(f.project, [surface === 'lessons' ? 'lesson' : 'decision', 'drop', f.target]));
      success(run(f.project, surface === 'lessons' ? ['lesson', 'save', 'dup'] : ['decision', 'add', 'dupd']));
      withoutRecord(f); const archived = fs.readFileSync(f.archive, 'utf8');
      const exactAt = archived.indexOf('\n- Exact JSON: ');
      assert(exactAt > 0, surface + ': no exact line');
      fs.writeFileSync(f.archive, archived.slice(0, archived.indexOf('\n', exactAt + 1) + 1));
      const before = f.before();
      const conflict = run(f.project, ['memory', 'restore', surface, archiveDate(f)]);
      assert(conflict.status > 0, surface + ': restore over a duplicate unexpectedly succeeded');
      assert.strictEqual(JSON.parse(conflict.stdout).code, 'restore_conflict', surface);
      assert.deepStrictEqual(f.before(), before, surface + ': a refused restore changed memory-domain files');
      success(run(f.project, ['memory', 'restore', surface, archiveDate(f), '--force']));
      const rows = JSON.parse(fs.readFileSync(f.json, 'utf8'));
      assert.deepStrictEqual([rows.length, rows[1]], [2, entry], surface + ': --force restores the exact entry');
    }
  });
  check('an archive cut right after an undated heading is refused (the trim leaves a bare ###)', () => {
    const rows = [{ date: '2026-09-11', text: 'zz first', tag: null }, { date: null, text: ' zz last ', tag: null }];
    const f = fixture('lessons', rows[0]); writeBoth(f, rows);
    success(run(f.project, ['lesson', 'drop', 'zz']));
    withoutRecord(f); const archived = fs.readFileSync(f.archive, 'utf8');
    const lastHeading = archived.lastIndexOf('\n### \n');
    assert(lastHeading > 0, 'no undated heading');
    fs.writeFileSync(f.archive, archived.slice(0, lastHeading + '\n### \n'.length));
    refusedUnchanged(f, 'bare heading at the end');
  });
  check('headings whose trailing space an editor stripped still restore every entry', () => {
    const rows = [{ date: null, text: 'trim-a', tag: null }, { date: null, text: 'trim-b', tag: 'tag' }];
    const f = fixture('lessons', rows[0]); writeBoth(f, rows);
    success(run(f.project, ['lesson', 'drop', 'trim-']));
    const archived = fs.readFileSync(f.archive, 'utf8');
    assert.strictEqual(archived.split('\n### \n').length, 3, 'two undated headings');
    fs.writeFileSync(f.archive, archived.replace(/[ \t]+$/gm, ''));
    success(run(f.project, ['memory', 'restore', 'lessons', archiveDate(f)]));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')), rows);
  });
  check('a decision block renamed to "Template" is refused when it has an exact line; a plain one is skipped as before', () => {
    // Round 2 restored the renamed exact block from its line; round 3: an exact section must match what the writer
    // wrote for its entry, so an edited heading refuses instead of being ignored.
    const rows = [{ date: '2026-09-11', title: 'tmpl first', decision: 'd1', reason: null, alternatives: null, impact: null },
      { date: null, title: ' tmpl second ', decision: 'd2', reason: null, alternatives: null, impact: null }];
    for (const which of ['exact', 'plain']) {
      const f = fixture('decisions', rows[0]); writeDecisions(f, rows);
      f.surface = 'decisions';
      success(run(f.project, ['decision', 'drop', 'tmpl']));
      withoutRecord(f); const archived = fs.readFileSync(f.archive, 'utf8');
      const heading = which === 'exact' ? '\n###  tmpl second \n' : '\n### 2026-09-11 — tmpl first\n';
      assert(archived.includes(heading), which + ': heading not found');
      fs.writeFileSync(f.archive, archived.replace(heading, '\n### Template ' + which + '\n'));
      if (which === 'exact') { refusedUnchanged(f, 'renamed exact block'); continue; }
      success(run(f.project, ['memory', 'restore', 'decisions', archiveDate(f)]));
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')), [rows[1]], which);
    }
  });
  // Review round 3.
  const dropBoth = (surface, rows, target) => {
    const f = fixture(surface, rows[0]); (surface === 'decisions' ? writeDecisions : writeBoth)(f, rows); f.surface = surface;
    success(run(f.project, [surface === 'decisions' ? 'decision' : 'lesson', 'drop', target]));
    return f;
  };
  const removeLastHeading = f => {
    withoutRecord(f); const archived = fs.readFileSync(f.archive, 'utf8');
    const at = archived.lastIndexOf('\n### ');
    assert(at > 0, 'no heading to remove');
    fs.writeFileSync(f.archive, archived.slice(0, at) + archived.slice(archived.indexOf('\n', at + 1)));
  };
  check('an exact entry cannot take over a neighbour whose heading was removed (both surfaces, both orders, also with --force)', () => {
    const lesson = text => ({ date: '2026-09-11', text, tag: null });
    const decision = title => ({ date: '2026-09-11', title, decision: 'd', reason: null, alternatives: null, impact: null });
    for (const [surface, make] of [['lessons', lesson], ['decisions', decision]]) {
      for (const rows of [[make('mx ordinary'), make(' mx padded ')], [make(' mx padded '), make('mx ordinary')]]) {
        const f = dropBoth(surface, rows, 'mx');
        assert.strictEqual(fs.readFileSync(f.archive, 'utf8').split('\n- Exact JSON: ').length, 2, 'one exact entry');
        removeLastHeading(f);
        const label = `${surface} ${JSON.stringify(rows.map(r => r.text || r.title))}`;
        refusedUnchanged(f, label);
        const before = f.before();
        const forced = run(f.project, ['memory', 'restore', surface, archiveDate(f), '--force']);
        assert(forced.status > 0 && JSON.parse(forced.stdout).code === 'archive_entry_invalid', label + ' with --force');
        assert.deepStrictEqual(f.before(), before, label + ': --force changed files');
      }
    }
  });
  check('two plain entries merged by a removed heading are refused, not read as the first one', () => {
    const f = dropBoth('lessons', [{ date: '2026-09-11', text: 'pm one', tag: null }, { date: '2026-09-11', text: 'pm two', tag: null }], 'pm ');
    assert(!fs.readFileSync(f.archive, 'utf8').includes('Exact JSON'), 'ordinary entries only');
    removeLastHeading(f);
    refusedUnchanged(f, 'merged plain entries');
  });
  check('an undated "Template x" decision drops through its exact line and still conflicts with an active "Template x"', () => {
    // The decisions Markdown skips a "### Template" block; the conflict check must not (round 3: the duplicate went through).
    const entry = { date: null, title: 'Template x', decision: 'd', reason: null, alternatives: null, impact: null };
    const f = fixture('decisions', entry);
    success(run(f.project, ['decision', 'drop', 'Template x']));
    assert(fs.readFileSync(f.archive, 'utf8').includes('- Exact JSON: '), 'carried by the exact line');
    success(run(f.project, ['decision', 'add', 'Template x']));
    const before = f.before();
    const conflict = run(f.project, ['memory', 'restore', 'decisions', archiveDate(f)]);
    assert(conflict.status > 0 && JSON.parse(conflict.stdout).code === 'restore_conflict', 'restore over an active "Template x" succeeded');
    assert.deepStrictEqual(f.before(), before, 'a refused restore changed memory-domain files');
    success(run(f.project, ['memory', 'restore', 'decisions', archiveDate(f), '--force']));
    const rows = JSON.parse(fs.readFileSync(f.json, 'utf8'));
    assert.deepStrictEqual([rows.length, rows[1]], [2, entry]);
  });
  check('an archive turned to CRLF with trailing spaces stripped still restores exact and plain entries exactly', () => {
    // An exact section is compared with what the writer wrote, ignoring line endings (git can convert them) and trailing
    // spaces (editors strip them), so neither turns a good entry into a refusal.
    const rows = [{ date: null, text: ' es padded ', tag: null }, { date: '2026-09-11', text: 'es plain', tag: 'tag' }];
    const f = fixture('lessons', rows[0]); writeBoth(f, rows);
    success(run(f.project, ['lesson', 'drop', 'es ']));
    const archived = fs.readFileSync(f.archive, 'utf8');
    assert(archived.includes('- Exact JSON: ') && archived.includes('\n### \n'), 'an undated exact entry');
    fs.writeFileSync(f.archive, archived.replace(/[ \t]+$/gm, '').replace(/\n/g, '\r\n'));
    success(run(f.project, ['memory', 'restore', 'lessons', archiveDate(f)]));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')), rows);
  });
  check('untouched drops of several entries restore exactly when a field ends with a Unicode space', () => {
    // Review round 4: the writer's text was trimmed before the comparison, so an exact entry whose last line ends with an
    // NBSP (or another space JavaScript trims) was refused when another entry followed it, with no edit to the archive.
    for (const code of [0xa0, 0x2003, 0x3000, 0xfeff]) {
      const ws = String.fromCharCode(code);
      for (const surface of ['lessons', 'decisions']) {
        const rows = surface === 'lessons'
          ? [{ date: '2026-09-11', text: 'uw first' + ws, tag: null }, { date: '2026-09-11', text: 'uw second', tag: 'tag' + ws }, { date: '2026-09-11', text: 'uw third', tag: null }]
          : [{ date: '2026-09-11', title: 'uw first', decision: 'd', reason: null, alternatives: null, impact: 'x' + ws }, { date: '2026-09-11', title: 'uw second', decision: 'd', reason: null, alternatives: null, impact: null }];
        const f = dropBoth(surface, rows, 'uw ');
        success(run(f.project, ['memory', 'restore', surface, archiveDate(f)]));
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')), rows, surface + ' U+' + code.toString(16));
      }
    }
  });
  check('a drop made by a target with a tab is selected by the target as the header wrote it, not by the original', () => {
    // The drop header holds the target on one line (control characters made spaces); restore matches that header.
    const entry = { date: '2026-09-11', text: 'tab' + String.fromCharCode(9) + 'here', tag: null };
    const f = fixture('lessons', entry);
    success(run(f.project, ['lesson', 'drop', entry.text]));
    assert(fs.readFileSync(f.archive, 'utf8').includes('(target: "tab here")'), 'header target');
    const before = f.before();
    const missed = run(f.project, ['memory', 'restore', 'lessons', entry.text]);
    assert(missed.status > 0, 'the original target with a tab matched');
    assert.deepStrictEqual(f.before(), before, 'a missed restore changed memory-domain files');
    success(run(f.project, ['memory', 'restore', 'lessons', 'tab here']));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')), [entry]);
  });
  check('an older note line starting with "- Exact JSON" refuses the restore (documented change)', () => {
    const f = fixture('lessons', { date: '2026-09-11', text: 'noted lesson', tag: null });
    success(run(f.project, ['lesson', 'drop', 'noted lesson']));
    withoutRecord(f); const archived = fs.readFileSync(f.archive, 'utf8');
    assert(archived.includes('- Lesson: noted lesson\n'), 'no lesson line');
    fs.writeFileSync(f.archive, archived.replace('- Lesson: noted lesson\n', '- Lesson: noted lesson\n- Exact JSON format is documented below\n'));
    refusedUnchanged(f, 'note line with the marker');
  });
  check('an exact line that lost its heading refuses the restore', () => {
    const rows = [{ date: '2026-09-11', text: ' pre-a ', tag: null }, { date: '2026-09-11', text: 'pre-b', tag: null }];
    const f = fixture('lessons', rows[0]); writeBoth(f, rows);
    success(run(f.project, ['lesson', 'drop', 'pre-']));
    withoutRecord(f); const archived = fs.readFileSync(f.archive, 'utf8');
    const first = archived.indexOf('\n### 2026-09-11\n- Exact JSON: ');
    assert(first > 0, 'the first entry has no exact line');
    fs.writeFileSync(f.archive, archived.slice(0, first) + archived.slice(first + '\n### 2026-09-11'.length));
    refusedUnchanged(f, 'exact line without heading');
  });
  check('fenced code inside a decisions drop block is not read as an entry, as the decisions Markdown reads it', () => {
    // The writer never puts a fence in an archive, but an older archive kept raw blocks and an archive can be edited by
    // hand; a `### ` line inside a fence must not start a decision (the ablation found no test for this).
    const entry = { date: '2026-09-11', title: 'fenced decision', decision: 'd', reason: null, alternatives: null, impact: null };
    const f = fixture('decisions', entry);
    success(run(f.project, ['decision', 'drop', entry.title]));
    withoutRecord(f); const archived = fs.readFileSync(f.archive, 'utf8');
    assert(archived.includes('- Impact: \n'), 'no impact line');
    fs.writeFileSync(f.archive, archived.replace('- Impact: \n', '- Impact: \n```md\n### not a decision\n- Decision: inside a fence\n```\n'));
    success(run(f.project, ['memory', 'restore', 'decisions', archiveDate(f)]));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')), [entry]);
  });
  check('memory archive list and memory status count a drop by a quoted target', () => {
    const entry = { date: '2026-09-11', text: ' "listed" lesson ', tag: null };
    const f = fixture('lessons', entry);
    success(run(f.project, ['lesson', 'drop', entry.text]));
    const list = JSON.parse(run(f.project, ['memory', 'archive', 'list', '--surface', 'lessons']).stdout);
    assert.deepStrictEqual(list.lessons.map(e => e.target), [entry.text]);
    assert.strictEqual(JSON.parse(run(f.project, ['memory', 'status']).stdout).archive.lessons, 1);
  });
  // Admission refuses a non-string field before the archive is reached; the archive refuses it too (checked above).
  check('lesson drop still refuses a non-string tag without writes', () => rejectedUnchanged('lessons', {
    date: '2026-09-11', text: 'numeric-tag', tag: 7,
  }, 'store_item_unsupported'));

  check('checked archive snapshot accepts unchanged bytes', () => {
    const file = path.join(seed, '.leerness', 'decisions.archive.md');
    fs.writeFileSync(file, '# Decisions archive\n');
    const snap = captureCheckedFileInput(file);
    assert.strictEqual(snap.exists, true);
    assertCheckedFileCurrent(snap, file);
  });
  check('checked archive snapshot detects byte changes', () => {
    const file = path.join(seed, '.leerness', 'lessons.archive.md');
    fs.writeFileSync(file, '# Lessons archive\n');
    const snap = captureCheckedFileInput(file);
    fs.appendFileSync(file, 'changed\n');
    assert.throws(() => assertCheckedFileCurrent(snap, file), e => e && e.code === 'E_STORE_CHANGED');
  });
  check('checked archive snapshot detects deletion', () => {
    const file = path.join(seed, '.leerness', 'plan.archive.md');
    fs.writeFileSync(file, '# Plan archive\n');
    const snap = captureCheckedFileInput(file);
    fs.unlinkSync(file);
    assert.throws(() => assertCheckedFileCurrent(snap, file), e => e && e.code === 'E_STORE_CHANGED');
  });
} catch (error) {
  results.push({ name: 'setup', ok: false, error: error.message });
  console.error(error.stack || error.message);
}
const passed = results.filter(r => r.ok).length;
const report = { node: process.version, platform: process.platform, temp, passed, total: results.length, results };
fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`memory archive retention: ${passed}/${results.length}; Evidence: ${temp}`);
if (passed !== results.length || results.length !== 40) process.exitCode = 1;
