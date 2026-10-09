'use strict';
// T-0331: drop archive integrity record. Each decisions or lessons drop block starts, after its header line, with
// "- Archive check: N entries, sha256 <hex>" over the entry text the drop wrote. A restore refuses a block that no
// longer matches (archive_changed), so an edit or a cut anywhere in it is caught, including the cases T-0328 left as
// documented gaps of the structural checks. Line endings, trailing spaces and the block's ends do not count. Deleting
// the record line opts a block out on purpose: it is read as before. Blocks without a record (older drops) are read
// as before too.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const { renderLosslessArchiveEntries, readArchiveEntries, archiveCheckLine, readArchiveCheck, withoutArchiveCheck } = require('../lib/memory-archive');
const { _renderDecisionsMd, _renderLessonsMd, _stripDecisionFences, _countDatedBlocks } = require('../lib/pure-utils');
const { removeTree } = require('./temp-cleanup');

const cli = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
if (process.argv.includes('--match') && !filter) { console.error('--match needs a check name substring'); process.exit(1); }
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-memory-archive-check-'));
const seed = path.join(temp, 'seed');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC)$/i.test(key)));
for (const key of ['TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) { env[key] = path.join(temp, key.toLowerCase()); fs.mkdirSync(env[key], { recursive: true }); }
Object.assign(env, { LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1' });

const results = [];
let sequence = 0;
const sha = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
function check(name, fn) {
  if (filter && !name.includes(filter)) return;
  try { fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
function run(project, args) {
  const r = cp.spawnSync(process.execPath, [cli, ...args, '--path', project, '--json'], { cwd: project, env, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
  assert.strictEqual(r.error, undefined, r.error && r.error.message);
  return r;
}
const success = r => assert.strictEqual(r.status, 0, String(r.stdout || r.stderr).slice(-1000));
const code = r => { try { return JSON.parse(r.stdout).code; } catch { return '(no JSON) ' + String(r.stdout || r.stderr).slice(0, 200); } };
// A project holding `rows` (canonical JSON and its generated Markdown), dropped by `target`: the drop is the product's.
function dropped(surface, rows, target) {
  const project = path.join(temp, `case-${++sequence}`);
  fs.cpSync(seed, project, { recursive: true });
  const hd = path.join(project, '.leerness');
  const f = { project, surface, json: path.join(hd, `${surface}.json`), md: path.join(hd, `${surface}.md`), archive: path.join(hd, `${surface}.archive.md`) };
  fs.writeFileSync(f.json, JSON.stringify(rows, null, 2) + '\n');
  fs.writeFileSync(f.md, surface === 'decisions' ? _renderDecisionsMd(rows) : _renderLessonsMd(rows));
  f.before = () => ({ json: sha(f.json), md: sha(f.md), archive: sha(f.archive) });
  if (target !== undefined) success(run(project, [surface === 'decisions' ? 'decision' : 'lesson', 'drop', target]));
  return f;
}
const dateOf = f => fs.readFileSync(f.archive, 'utf8').match(/## 제거 (\d{4}-\d{2}-\d{2})/)[1];
const restore = (f, sel, ...flags) => run(f.project, ['memory', 'restore', f.surface, sel === undefined ? dateOf(f) : sel, ...flags]);
function refusedUnchanged(f, expected, label) {
  const before = f.before();
  for (const flags of [[], ['--force']]) {
    const r = restore(f, undefined, ...flags);
    assert(r.status > 0, `${label}${flags.length ? ' with --force' : ''}: restore unexpectedly succeeded`);
    assert.strictEqual(code(r), expected, `${label}${flags.length ? ' with --force' : ''}`);
    assert.deepStrictEqual(f.before(), before, `${label}: a refused restore changed memory-domain files`);
  }
}
const lesson = (text, tag = null) => ({ date: '2026-09-11', text, tag });
const decision = (title, extra = {}) => ({ date: '2026-09-11', title, decision: 'd', reason: null, alternatives: null, impact: null, ...extra });
const NBSP = String.fromCharCode(0xa0), TAB = String.fromCharCode(9), EMSP = String.fromCharCode(0x2003), BOM = String.fromCharCode(0xfeff), ZWSP = String.fromCharCode(0x200b);
const RECORD = /^- Archive check: (\d+) (entry|entries), sha256 ([0-9a-f]{64})$/m;

try {
  fs.mkdirSync(seed);
  success(run(seed, ['init', seed, '--yes', '--language', 'en', '--no-stale-check']));

  check('a drop writes one record right after its header, with the entry count and a hash of the entry text', () => {
    for (const [surface, rows, target, word] of [
      ['lessons', [lesson('ck first'), lesson(' ck padded '), lesson('ck tagged', 'tag')], 'ck ', '3 entries'],
      ['decisions', [decision('ck only one')], 'ck only', '1 entry'],
    ]) {
      const f = dropped(surface, rows, target);
      const lines = fs.readFileSync(f.archive, 'utf8').split('\n');
      const at = lines.findIndex(l => l.startsWith('## 제거 '));
      assert(at >= 0 && RECORD.test(lines[at + 1]), surface + ': record not right after the header: ' + JSON.stringify(lines.slice(at, at + 3)));
      assert(lines[at + 1].includes(': ' + word + ','), surface + ': ' + lines[at + 1]);
      // The entry text after the record is what the drop rendered before T-0331, byte for byte.
      const entryText = lines.slice(at + 2).join('\n');
      const rendered = renderLosslessArchiveEntries(surface, rows);
      assert.strictEqual(entryText.replace(/\n+$/, ''), rendered.replace(/\n+$/, ''), surface + ': entry text changed');
      assert.strictEqual(lines[at + 1] + '\n', archiveCheckLine(rows.length, rendered), surface + ': record differs from archiveCheckLine');
      assert.strictEqual(fs.readFileSync(f.archive, 'utf8').split('\n- Archive check: ').length, 2, surface + ': one record');
    }
  });

  check('untouched drops restore exactly, also with CRLF line endings and trailing spaces stripped', () => {
    for (const [surface, rows, target] of [
      ['lessons', [lesson('ut first' + NBSP), lesson(' ut padded '), lesson('ut' + TAB + 'tab', 'tag '), lesson('ut tail' + TAB)], 'ut'],
      ['decisions', [decision(' ut padded title '), decision('ut second', { impact: 'x' + NBSP })], 'ut'],
    ]) {
      for (const mode of ['as written', 'CRLF and stripped', 'trailing tabs added']) {
        const f = dropped(surface, rows, target);
        if (mode === 'CRLF and stripped') fs.writeFileSync(f.archive, fs.readFileSync(f.archive, 'utf8').replace(/[ \t]+$/gm, '').replace(/\n/g, '\r\n'));
        // The writer never ends a line with a tab (control characters become spaces), so only an edit adds one (review
        // round 4 ablation: trims that ignored tabs went unnoticed).
        if (mode === 'trailing tabs added') fs.writeFileSync(f.archive, fs.readFileSync(f.archive, 'utf8').replace(/\n/g, TAB + '\n'));
        success(restore(f));
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')), rows, `${surface} ${mode}`);
      }
    }
  });

  // Each change starts from the same untouched drop of three lessons (one carried by an exact line).
  const threeLessons = [lesson('ed first'), lesson(' ed padded '), lesson('ed third', 'tag')];
  const changeValue = t => { assert(t.includes('- Lesson: ed first'), 'value to change'); return t.replace('- Lesson: ed first', '- Lesson: ed f1rst'); };
  const edits = [
    ['a changed plain value', t => t.replace('- Lesson: ed first', '- Lesson: ed f1rst')],
    ['an indented exact line', t => t.replace('\n- Exact JSON: ', '\n - Exact JSON: ')],
    ['a cut inside the last heading line', t => t.slice(0, t.lastIndexOf('\n### ') + 3)],
    ['the last entry removed, heading included', t => t.slice(0, t.lastIndexOf('\n### ')) + '\n'],
    ['a heading removed, merging two entries', t => { const at = t.lastIndexOf('\n### '); return t.slice(0, at) + t.slice(t.indexOf('\n', at + 1)); }],
    ['a note appended to the block', t => t.replace(/\n*$/, '\n\nnote: checked by hand\n')],
    ['the record hash changed', t => t.replace(/sha256 ([0-9a-f])/, (m, c) => 'sha256 ' + (c === 'a' ? 'b' : 'a'))],
    ['the record count word wrong', t => t.replace('3 entries,', '3 entry,')],
    ['a second record in the block', t => { const rec = t.match(RECORD)[0]; return t.replace('\n### ', '\n' + rec + '\n\n### '); }],
    ['the record moved below the first heading', t => { const rec = t.match(RECORD)[0]; const without = t.replace(rec + '\n', ''); const at = without.indexOf('\n### '); const eol = without.indexOf('\n', at + 1); return without.slice(0, eol + 1) + rec + '\n' + without.slice(eol + 1); }],
    // Review round 1: a record that stops looking like one must not turn the block into one without a record.
    ['the record indented by a space, with a changed value', t => changeValue(t.replace(/^- Archive check/m, ' - Archive check'))],
    ['the record indented by a tab, with the last entry cut', t => { const s = t.replace(/^- Archive check/m, TAB + '- Archive check'); return s.slice(0, s.lastIndexOf('\n### ')) + '\n'; }],
    ['the record joined to the header line, with a changed value', t => changeValue(t.replace(/\)\n- Archive check/, ') - Archive check'))],
    ['the record lowercased, with a changed value', t => changeValue(t.replace(/^- Archive check/m, '- archive check'))],
    ['the record moved into the archive title, with a changed value', t => { const rec = t.match(RECORD)[0]; return changeValue(t.replace(rec + '\n', '').replace(/^# Lessons archive/, '# Lessons archive ' + rec)); }],
    ['a line ending changed to a lone CR', t => t.replace('### 2026-09-11\n- Lesson: ed first', '### 2026-09-11\r- Lesson: ed first')],
    // Review round 2: spacing outside spaces and tabs, or none, must not hide the record either.
    ['the record prefixed by a no-break space, with a changed value', t => changeValue(t.replace(/^- Archive check/m, NBSP + '- Archive check'))],
    ['the record prefixed by an em space, with the last entry cut', t => { const s = t.replace(/^- Archive check/m, EMSP + '- Archive check'); return s.slice(0, s.lastIndexOf('\n### ')) + '\n'; }],
    ['the record prefixed by a byte order mark, with a changed value', t => changeValue(t.replace(/^- Archive check/m, BOM + '- Archive check'))],
    ['a no-break space between the record words, with a changed value', t => changeValue(t.replace(/^- Archive check/m, '- Archive' + NBSP + 'check'))],
    ['a zero-width space inside a record word, with a changed value', t => changeValue(t.replace(/^- Archive check/m, '- Arch' + ZWSP + 'ive check'))],
    // The record's content, either half: a misspelled count word (the hash still there), or a hash cut short (the count).
    ['the record count word misspelled, with a changed value', t => changeValue(t.replace('3 entries,', '3 entires,'))],
    ['the record hash cut short, with a changed value', t => changeValue(t.replace(/(sha256 [0-9a-f]{40})[0-9a-f]{24}/, '$1'))],
    ['the space between the record words deleted, with the last entry cut', t => { const s = t.replace(/^- Archive check/m, '- Archivecheck'); return s.slice(0, s.lastIndexOf('\n### ')) + '\n'; }],
  ];
  check('an edit or a cut anywhere in a recorded block refuses the restore without writes, --force included', () => {
    // Every edit runs, so one run names all the edits that got through.
    const missed = [];
    for (const [label, change] of edits) {
      try {
        const f = dropped('lessons', threeLessons, 'ed ');
        const text = fs.readFileSync(f.archive, 'utf8');
        const changed = change(text);
        assert.notStrictEqual(changed, text, label + ': the edit changed nothing');
        fs.writeFileSync(f.archive, changed);
        refusedUnchanged(f, 'archive_changed', label);
      } catch (e) { missed.push(String(e && e.message || e).split('\n')[0]); }
    }
    assert.deepStrictEqual(missed, [], `${missed.length}/${edits.length} edits got through:\n  ${missed.join('\n  ')}`);
  });

  check('a decision cut right after its heading is refused (a gap the structural checks left, T-0328)', () => {
    const rows = [decision('dc first'), decision(' dc padded ', { reason: 'r', alternatives: 'a', impact: 'i' })];
    const f = dropped('decisions', rows, 'dc ');
    const text = fs.readFileSync(f.archive, 'utf8');
    const at = text.lastIndexOf('\n### ');
    fs.writeFileSync(f.archive, text.slice(0, text.indexOf('\n', at + 1) + 1));
    refusedUnchanged(f, 'archive_changed', 'decision heading cut');
    // Review round 1, decisions too: an indented record with the last entry cut.
    const g = dropped('decisions', rows, 'dc ');
    const s = fs.readFileSync(g.archive, 'utf8').replace(/^- Archive check/m, ' - Archive check');
    fs.writeFileSync(g.archive, s.slice(0, s.lastIndexOf('\n### ')) + '\n');
    refusedUnchanged(g, 'archive_changed', 'decision indented record with a cut');
    // Review round 2, decisions too: a record prefixed by a no-break space, with the last entry cut.
    const h = dropped('decisions', rows, 'dc ');
    const u = fs.readFileSync(h.archive, 'utf8').replace(/^- Archive check/m, NBSP + '- Archive check');
    fs.writeFileSync(h.archive, u.slice(0, u.lastIndexOf('\n### ')) + '\n');
    refusedUnchanged(h, 'archive_changed', 'decision record after a no-break space with a cut');
  });

  check('older blocks whose text only mentions an archive check restore as before (no count, no hash)', () => {
    // Review round 2: prose is not a record. Before T-0331 these restored; they still do, values exact.
    const cases = [
      ['a note line before the first heading', h => h + '\n- Archive check completed successfully\n'],
      ['a note line with a colon', h => h + '\n- Archive check: nightly backups verified\n'],
      ['trailing text on the header line', h => h + ' archive check findings\n'],
      // Review round 3: a hash without the words is text too.
      ['a note line with a hash but not the words', h => h + '\n- tarball sha256 ' + 'ab'.repeat(32) + '\n'],
    ];
    for (const [label, header] of cases) {
      const rows = [lesson('ac one'), lesson(' ac two ')];
      const f = dropped('lessons', [lesson('ac other')]);
      fs.writeFileSync(f.archive, '# Lessons archive\n\n\n' + header('## 제거 2026-09-01 (target: "ac")') + renderLosslessArchiveEntries('lessons', rows) + '\n');
      success(restore(f, 'ac'));
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')).map(l => l.text), ['ac other', 'ac one', ' ac two '], label);
    }
    // An archive title that mentions an archive check does not block the restore of a recorded block either.
    const g = dropped('lessons', [lesson('at one'), lesson('at two')], 'at ');
    fs.writeFileSync(g.archive, fs.readFileSync(g.archive, 'utf8').replace(/^# Lessons archive/, '# Lessons archive - archive check findings'));
    success(restore(g));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(g.json, 'utf8')).map(l => l.text), ['at one', 'at two'], 'title');
    // Review round 3: with an exact record first, the rest of the block is covered by the hash and not scanned, so a
    // lesson whose text carries a count after the words restores exactly.
    const counted = [lesson('Archive check: 3 entries completed'), lesson('ac plain')];
    const k = dropped('lessons', counted, 'ac');
    success(restore(k));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(k.json, 'utf8')), counted, 'a counted mention in a recorded block');
  });

  check('look-alike detection takes linear time on a line that repeats the words', () => {
    // Review round 3: searching for a hash again after every occurrence of the words took quadratic time (16,000
    // repetitions: about 6.7 seconds). A linear reading takes milliseconds; the limit leaves a wide margin.
    const block = '## 제거 2026-10-02 (target: "x")\n- note ' + 'archive check x '.repeat(16000) + '\n\n### 2026-09-11\n- Lesson: a\n';
    const t0 = Date.now();
    assert.strictEqual(readArchiveCheck(block).state, 'none');
    const ms = Date.now() - t0;
    assert(ms < 1000, 'took ' + ms + ' ms');
  });

  check('the reading paths take linear time on long runs of spaces', () => {
    // Review round 4: trailing trims written as [ \t]+$ tried again from every position of a long run of spaces that
    // did not reach the end of its line. With 128,000 spaces the round-4 candidate took 4.5 to 17 seconds per path.
    const S = ' '.repeat(128000), H = '## 제거 2026-10-02 (target: "x")';
    const entries = renderLosslessArchiveEntries('lessons', [lesson('a' + S + 'b')]);
    const exact = renderLosslessArchiveEntries('lessons', [lesson(' a' + S + 'b ')]);
    const paths = [
      ['a note on the first line', () => readArchiveCheck(H + '\n- note' + S + 'x\n\n### 2026-09-11\n- Lesson: a\n').state, 'none'],
      ['a recorded entry (the hash)', () => readArchiveCheck(H + '\n' + archiveCheckLine(1, entries) + entries).state, 'ok'],
      ['brainstorm leaving out a record', () => withoutArchiveCheck(H + '\n- note' + S + 'x\n').length, H.length + S.length + 9],
      ['an exact section (T-0328)', () => readArchiveEntries('lessons', exact.trim()).entries[0].text, ' a' + S + 'b '],
    ];
    const slow = [];
    for (const [label, fn, want] of paths) {
      const t0 = Date.now();
      assert.strictEqual(fn(), want, label);
      const ms = Date.now() - t0;
      if (ms >= 1000) slow.push(label + ': ' + ms + ' ms');
    }
    assert.deepStrictEqual(slow, []);
  });

  check('a record whose hash matches but whose count does not refuses the restore', () => {
    // The hash covers the entry text only; the count is checked against what the reader finds.
    const f = dropped('lessons', threeLessons, 'ed ');
    fs.writeFileSync(f.archive, fs.readFileSync(f.archive, 'utf8').replace('3 entries,', '2 entries,'));
    refusedUnchanged(f, 'archive_entry_invalid', 'wrong count');
  });

  check('deleting the record line opts the block out: an edited block is then read as before', () => {
    const f = dropped('lessons', threeLessons, 'ed ');
    const text = fs.readFileSync(f.archive, 'utf8').replace('- Lesson: ed first', '- Lesson: ed fixed by hand');
    fs.writeFileSync(f.archive, text.replace(RECORD, '').replace(/\n\n\n/, '\n\n'));
    success(restore(f));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')).map(l => l.text), ['ed fixed by hand', ' ed padded ', 'ed third']);
  });

  check('blocks without a record (older drops) restore as before, next to recorded ones', () => {
    const rows = [lesson('legacy one'), lesson('recorded one')];
    const f = dropped('lessons', rows);
    // An older drop's block, as the drop wrote it before T-0328 and T-0331: header, then the entries.
    fs.writeFileSync(f.archive, '# Lessons archive\n\n\n## 제거 2026-09-01 (target: "legacy")\n' + renderLosslessArchiveEntries('lessons', [rows[0]]) + '\n');
    fs.writeFileSync(f.json, JSON.stringify([rows[1]], null, 2) + '\n'); fs.writeFileSync(f.md, _renderLessonsMd([rows[1]]));
    success(run(f.project, ['lesson', 'drop', 'recorded one']));
    const archived = fs.readFileSync(f.archive, 'utf8');
    assert.strictEqual(archived.split('\n- Archive check: ').length, 2, 'only the new drop has a record');
    success(restore(f, 'legacy'));
    success(restore(f, 'recorded'));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json, 'utf8')).map(l => l.text).sort(), ['legacy one', 'recorded one']);
  });

  check('readers that do not know the record skip it: it sits before the first heading', () => {
    for (const [surface, rows] of [['lessons', threeLessons], ['decisions', [decision('rd one'), decision(' rd two ')]]]) {
      const entries = renderLosslessArchiveEntries(surface, rows);
      const read = readArchiveEntries(surface, (archiveCheckLine(rows.length, entries) + entries).trim());
      assert.deepStrictEqual([read.entries, read.damaged], [rows, 0], surface);
    }
  });

  check('brainstorm leaves the record out of its archive match and preview', () => {
    const f = dropped('lessons', [lesson('bs findable text')], 'bs findable');
    const hits = q => { const r = run(f.project, ['brainstorm', q]); success(r); return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))).hits.archive.lessons; };
    const found = hits('findable');
    assert(found.length === 1 && found[0].preview.includes('bs findable text') && !found[0].preview.includes('Archive check'), JSON.stringify(found));
    assert.deepStrictEqual(hits('sha256'), [], 'a word only the record holds matched');
    // Review round 2: only the record in its place is left out; an older note line that starts the same way is text.
    fs.writeFileSync(f.archive, fs.readFileSync(f.archive, 'utf8') + '\n## 제거 2026-09-01 (target: "old")\n- Archive check: nightly backups verified\n\n'
      + renderLosslessArchiveEntries('lessons', [lesson('old entry')]) + '\n');
    const note = hits('nightly');
    assert(note.length === 1 && note[0].target === 'old' && note[0].preview.includes('nightly backups verified'), JSON.stringify(note));
    // Review round 5: plan archives get no record, so a plan block's text is searched as it is, even a line shaped like one.
    fs.writeFileSync(path.join(f.project, '.leerness', 'plan.archive.md'), '# Plan archive\n\n## 제거 2026-09-01 (target: "pl")\n- Archive check: 1 entry, sha256 '
      + 'ab'.repeat(32) + '\n### M-0001 pl milestone\n');
    const r = run(f.project, ['brainstorm', 'sha256']);
    success(r);
    const plan = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))).hits.archive.plan;
    assert(plan.length === 1 && plan[0].target === 'pl' && plan[0].preview.includes('sha256'), JSON.stringify(plan));
  });

  check('decision fence stripping keeps its result in linear time', () => {
    // Review round 5: the fence expression searched to the end of the text again from every opening that never closes
    // (32,000 openings: about 3 seconds). It is now found in one pass (T-0335); the result is the same.
    const OLD = s => s.replace(/^```[^\n]*\n[\s\S]*?\n```\s*$/gm, '');
    const C = String.fromCharCode, parts = ['`', '```', '\n', '\n', '\r', ' ', TAB, 'a', '#', NBSP, C(0x2028), BOM, '\n```', '```md\n', '```md\r'];
    // xorshift32 (T-0335): the multiply-and-mask generator used here drew only 889 distinct texts of 20,000.
    let x = 2463534242, differ = 0;
    const rnd = n => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % n; };
    const seen = new Set();
    for (let t = 0; t < 20000; t++) {
      let s = '';
      for (let i = rnd(30); i > 0; i--) s += parts[rnd(parts.length)];
      seen.add(s);
      if (_stripDecisionFences(s) !== OLD(s)) differ++;
    }
    assert.ok(seen.size > 15000, 'only ' + seen.size + ' distinct texts');
    assert.strictEqual(differ, 0, differ + ' of 20,000 texts stripped differently');
    const slow = [];
    const timed = (label, fn, want) => { const t0 = Date.now(); assert.deepStrictEqual(fn(), want, label); const ms = Date.now() - t0; if (ms >= 1000) slow.push(label + ': ' + ms + ' ms'); };
    const openings = '```md\n'.repeat(64000);
    timed('one closing, then openings', () => _stripDecisionFences('```a\nb\n```\n' + openings).length, openings.length + 1);
    timed('openings in a decisions drop block', () => readArchiveEntries('decisions', '### 2026-09-11 — fd one\n- Decision: d\n' + openings).entries.map(e => e.title), ['fd one']);
    timed('the dated-block count', () => _countDatedBlocks('### 2026-09-11 — fd one\n```a\nb\n```\n' + openings), 1);
    // T-0335: openings separated by CR share one \n; with a closing at the very end the bound by the last closing did
    // not help (64,000 took about 10 seconds).
    timed('openings separated by CR, a closing at the end', () => readArchiveEntries('decisions', '### 2026-09-11 — fd one\n- Decision: d\n' + '```md\r'.repeat(64000) + '\n```').entries.map(e => e.title), ['fd one']);
    assert.deepStrictEqual(slow, []);
  });
  check('the record counts toward the archive input byte limit of a write policy', () => {
    // Policy shape as in memory-command-policy-probe.js (memory-write-budget-support.js limits); only the archive
    // input limit matters here.
    const arrayLimits = { maxInputBytes: 32768, maxItems: 100, maxItemBytes: 16384, maxCanonicalBytes: 32768, maxProjectionBytes: 32768, maxDepth: 16, maxNodes: 10000 };
    const policy = maxArchiveInputBytes => JSON.stringify({ mode: 'within-target',
      limits: { observation: { maxFileBytes: 32768, maxTotalFileBytes: 98304, maxRecoveryEntries: 100, maxRecoveryDepth: 8, maxRecoveryBytes: 10000 },
        source: { ...arrayLimits }, candidate: { ...arrayLimits },
        operation: { maxArchiveInputBytes, maxArchiveBytes: 65536, maxProjectionBytes: 65536, maxFinalPathBytes: 200000, maxNormalPeakPathBytes: 300000 } },
      targets: { items: 100, canonicalBytes: 65536, projectionBytes: 65536, archiveBytes: 65536, totalPathBytes: 200000 } });
    const rows = [lesson('bl one'), lesson('bl two')];
    const probe = dropped('lessons', rows);
    const size = () => (fs.existsSync(probe.archive) ? fs.statSync(probe.archive).size : 0);
    const was = size();
    success(run(probe.project, ['lesson', 'drop', 'bl ']));
    const appended = size() - was;   // everything the drop appended, which the limit counts
    const record = Buffer.byteLength(fs.readFileSync(probe.archive, 'utf8').match(RECORD)[0] + '\n');
    // appended - record is what the same drop appended before T-0331; it no longer fits.
    for (const [limit, ok] of [[appended, true], [appended - 1, false], [appended - record, false]]) {
      const f = dropped('lessons', rows);
      const before = f.before();
      const r = run(f.project, ['lesson', 'drop', 'bl ', '--write-policy-json', policy(limit)]);
      if (ok) { success(r); continue; }
      assert(r.status > 0, 'limit ' + limit + ' accepted');
      const j = JSON.parse(r.stdout);
      assert.deepStrictEqual([j.code, j.reasonCode, j.phase], ['memory_policy', 'archive_input_bytes_exceeded', 'operation'], 'limit ' + limit);
      assert.deepStrictEqual(f.before(), before, 'limit ' + limit + ': a refused drop changed memory-domain files');
    }
  });
} catch (error) {
  results.push({ name: 'setup', ok: false, error: error.message });
  console.error(error.stack || error.message);
}
const passed = results.filter(r => r.ok).length;
console.log(`memory archive check: ${passed}/${results.length}`);
if (filter && !results.length) console.error(`--match ${JSON.stringify(filter)} selected no check`);
try { removeTree(temp, { recursive: true, force: true }); } catch {}
if (passed !== results.length || (filter ? results.length === 0 : results.length !== 14)) process.exitCode = 1;
