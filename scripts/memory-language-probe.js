'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
// T-0318: decision add / lesson add re-render decisions.md and lessons.md behind a generated header. The header
// was Korean in every project; it now follows the harness authoring language (explicit choice, else the stored
// project language). Existing files keep working: every known header variant is accepted as the generated one and
// replaced on the next write, records and appended text still have to match exactly, and Korean projects are
// written byte for byte as before.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
const P = require('../lib/pure-utils');
const { inspectMemoryWriteBudget } = require('../lib/memory-write-budget');
const { captureMemoryWriteAdmission } = require('../lib/memory-write-admission');
const { memoryDocumentLanguage } = require('../lib/memory-language');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const HANGUL = /\p{Script=Hangul}/u;
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-memory-language-'));
const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
  LEERNESS_NO_AUTOCHCP: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1' };
delete env.LEERNESS_LANG;
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) { env[key] = path.join(arena, 'env-' + key.toLowerCase()); fs.mkdirSync(env[key]); }
let seq = 0, passed = 0, failed = 0;
const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
const test = (name, fn) => { if (filter && !name.includes(filter)) return; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };
const run = (dir, args, extra = {}) => cp.spawnSync(process.execPath, [CLI, ...args, '--path', dir], { cwd: dir, encoding: 'utf8', timeout: 300000, windowsHide: true, env: { ...env, ...extra } });
const must = (r, label) => { assert.ifError(r.error); assert.strictEqual(r.status, 0, label + ' exit ' + r.status + '\n' + r.stdout + r.stderr); return r; };
const project = (lang, extra = []) => {
  const dir = path.join(arena, (++seq) + '-' + lang); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"proj","version":"0.1.0"}\n');
  must(run(dir, ['init', dir, '--yes', '--language', lang, '--no-setup-agents', '--no-mcp', ...extra]), 'init');
  return dir;
};
const file = (dir, name) => path.join(dir, '.leerness', name);
const text = p => fs.readFileSync(p, 'utf8');
const bytes = p => fs.readFileSync(p);
const render = (surface, rows, lang) => surface === 'decisions' ? P._renderDecisionsMd(rows, lang) : P._renderLessonsMd(rows, lang);
const add = (dir, surface, value, extra) => run(dir, surface === 'decisions' ? ['decision', 'add', value, '--reason', 'probe reason'] : ['lesson', 'save', value], extra);
const rows = (dir, surface) => JSON.parse(text(file(dir, surface + '.json')));
const row = surface => surface === 'decisions'
  ? { date: '2026-09-01', title: 'Existing choice', decision: 'kept', reason: null, alternatives: null, impact: null }
  : { date: '2026-09-01', text: 'Existing lesson', tag: null };
// A project whose memory files were written before this change (or before a language switch): canonical JSON plus
// a projection with the given header and an appended note the writer must keep.
const seeded = (lang, surface, headerLang, note = '\nNOTE appended by hand 사용자 메모\n') => {
  const dir = project(lang);
  fs.writeFileSync(file(dir, surface + '.json'), JSON.stringify([row(surface)], null, 2) + '\n');
  fs.writeFileSync(file(dir, surface + '.md'), render(surface, [row(surface)], headerLang) + note);
  return { dir, note };
};

for (const surface of ['decisions', 'lessons']) {
  test(`${surface}: an English project writes the English header and no Korean`, () => {
    const dir = project('en');
    must(add(dir, surface, 'Use JSON storage'), 'first add');
    must(add(dir, surface, 'Keep the parser small'), 'second add');
    const md = text(file(dir, surface + '.md'));
    assert.ok(md.startsWith(render(surface, rows(dir, surface), 'en')), md);
    assert.ok(!HANGUL.test(md), md);
    assert.strictEqual(rows(dir, surface).length, 2);
  });

  test(`${surface}: a Korean project is written exactly as before, whatever the UI language`, () => {
    const dir = project('ko'), md = file(dir, surface + '.md'), before = fs.existsSync(md) ? text(md) : '';
    must(add(dir, surface, 'Use JSON storage', { LEERNESS_LANG: 'en' }), 'add with an English UI');
    // First write: the Korean header plus the records, then any init template kept whole as the appended part.
    assert.strictEqual(text(md), render(surface, rows(dir, surface), 'ko') + before);
  });

  for (const [lang, other] of [['en', 'ko'], ['ko', 'en']]) {
    test(`${surface}: a ${other} header in a ${lang} project is accepted and replaced, and the appended text is kept`, () => {
      const { dir, note } = seeded(lang, surface, other);
      must(add(dir, surface, 'Another entry'), 'add over an older header');
      const all = rows(dir, surface);
      assert.strictEqual(all.length, 2);
      assert.strictEqual(text(file(dir, surface + '.md')), render(surface, all, lang) + note);
    });
  }

  test(`${surface}: edits inside the generated part are still refused under either header`, () => {
    for (const headerLang of ['en', 'ko']) {
      const { dir } = seeded('en', surface, headerLang);
      const md = file(dir, surface + '.md'), original = text(md);
      const edited = surface === 'decisions' ? original.replace('- Decision: kept', '- Decision: changed by hand') : original.replace('- Lesson: Existing lesson', '- Lesson: changed by hand');
      assert.notStrictEqual(edited, original);
      fs.writeFileSync(md, edited);
      const canonical = bytes(file(dir, surface + '.json')), projection = bytes(md);
      const r = add(dir, surface, 'Another entry');
      assert.notStrictEqual(r.status, 0, headerLang + ' header: edit was accepted');
      assert.match(r.stdout + r.stderr, /E_PROJECTION_DIVERGED|projection/i);
      assert.deepStrictEqual([bytes(file(dir, surface + '.json')), bytes(md)], [canonical, projection], 'refused write changed a file');
    }
  });

  test(`${surface}: the write preflight accepts either header, refuses edits and measures the file the writer writes`, () => {
    const limits = { observation: { maxFileBytes: 65536, maxTotalFileBytes: 262144, maxRecoveryEntries: 100, maxRecoveryDepth: 8, maxRecoveryBytes: 10000 } };
    const arrays = { maxInputBytes: 65536, maxItems: 100, maxItemBytes: 16384, maxCanonicalBytes: 65536, maxProjectionBytes: 65536, maxDepth: 16, maxNodes: 10000 };
    Object.assign(limits, { source: { ...arrays }, candidate: { ...arrays }, operation: { maxArchiveInputBytes: 65536, maxArchiveBytes: 131072,
      maxProjectionBytes: 131072, maxFinalPathBytes: 1000000, maxNormalPeakPathBytes: 2000000 } });
    const next = [row(surface), surface === 'decisions' ? { ...row(surface), title: 'Second choice' } : { ...row(surface), text: 'Second lesson' }];
    const inspect = dir => inspectMemoryWriteBudget(dir, surface, JSON.stringify(next), JSON.stringify({ kind: 'update', archiveText: null }), JSON.stringify(limits));
    for (const [lang, headerLang] of [['en', 'en'], ['en', 'ko'], ['ko', 'ko'], ['ko', 'en']]) {
      const { dir, note } = seeded(lang, surface, headerLang);
      const result = inspect(dir);
      assert.strictEqual(result.ok, true, `${lang}/${headerLang}: ${JSON.stringify(result.error)}`);
      assert.strictEqual(result.measurement.next.projection, Buffer.byteLength(render(surface, next, lang) + note), `${lang}/${headerLang} projection bytes`);
    }
    const { dir } = seeded('en', surface, 'en');
    const md = file(dir, surface + '.md');
    fs.writeFileSync(md, text(md).replace('# ', '# Edited '));
    const refused = inspect(dir);
    assert.strictEqual(refused.ok, false); assert.strictEqual(refused.error.code, 'projection_diverged');
  });

  test(`${surface}: the source budget is measured with the project's header at the exact limit`, () => {
    // Cross-model review 2026-09-30: the source phase measured every projection with the Korean header, so an
    // English decisions file (2 bytes shorter) was refused at its exact size and an English lessons file (18 bytes
    // longer) passed a limit it exceeded.
    const arrays = size => ({ maxInputBytes: 65536, maxItems: 100, maxItemBytes: 16384, maxCanonicalBytes: 65536, maxProjectionBytes: size, maxDepth: 16, maxNodes: 10000 });
    const limits = size => ({ observation: { maxFileBytes: 65536, maxTotalFileBytes: 262144, maxRecoveryEntries: 100, maxRecoveryDepth: 8, maxRecoveryBytes: 10000 },
      source: arrays(size), candidate: arrays(65536), operation: { maxArchiveInputBytes: 65536, maxArchiveBytes: 131072, maxProjectionBytes: 131072,
        maxFinalPathBytes: 1000000, maxNormalPeakPathBytes: 2000000 } });
    for (const lang of ['en', 'ko']) {
      const { dir } = seeded(lang, surface, lang, '');
      const size = Buffer.byteLength(render(surface, [row(surface)], lang));
      const inspect = limit => inspectMemoryWriteBudget(dir, surface, JSON.stringify([row(surface)]), JSON.stringify({ kind: 'update', archiveText: null }), JSON.stringify(limits(limit)));
      const exact = inspect(size);
      assert.strictEqual(exact.ok, true, `${lang}: refused at its exact size ${size}: ${JSON.stringify(exact.error)}`);
      const under = inspect(size - 1);
      assert.strictEqual(under.ok, false, `${lang}: accepted one byte under its size ${size}`);
      assert.strictEqual(under.error.code, 'projection_bytes_exceeded');
      // The write admission path measures the same source.
      const big = 1 << 22, policy = limit => JSON.stringify({ limits: limits(limit), mode: 'within-target',
        targets: { items: 1000, canonicalBytes: big, projectionBytes: big, archiveBytes: big, totalPathBytes: big } });
      assert.doesNotThrow(() => captureMemoryWriteAdmission(dir, surface, policy(size)), `${lang}: admission refused its exact size ${size}`);
      assert.throws(() => captureMemoryWriteAdmission(dir, surface, policy(size - 1)), e => e.code === 'projection_bytes_exceeded', `${lang}: admission accepted one byte under`);
    }
  });
}

test('the header language is the authoring language, not the UI language', () => {
  const dir = project('ko', ['--authoring-language', 'en']);
  assert.strictEqual(memoryDocumentLanguage(dir), 'en');
  must(add(dir, 'decisions', 'Use JSON storage'), 'add');
  assert.ok(text(file(dir, 'decisions.md')).startsWith(render('decisions', rows(dir, 'decisions'), 'en')));
  // A stored LANGUAGE file answers when the manifest has no language; nothing readable keeps the Korean default.
  const bare = path.join(arena, 'bare'); fs.mkdirSync(path.join(bare, '.leerness'), { recursive: true });
  assert.strictEqual(memoryDocumentLanguage(bare), 'ko');
  fs.writeFileSync(path.join(bare, '.leerness', 'LANGUAGE'), 'en\n');
  assert.strictEqual(memoryDocumentLanguage(bare), 'en');
  fs.writeFileSync(path.join(bare, '.leerness', 'manifest.json'), '{ not json');
  assert.strictEqual(memoryDocumentLanguage(bare), 'en');
  fs.writeFileSync(path.join(bare, '.leerness', 'manifest.json'), JSON.stringify({ language: 'ko' }));
  assert.strictEqual(memoryDocumentLanguage(bare), 'ko');
});

test('renderers keep the Korean default and every header variant parses to no records', () => {
  assert.strictEqual(P._renderDecisionsMd([]), P._renderDecisionsMd([], 'ko'));
  assert.strictEqual(P._renderLessonsMd([]), P._renderLessonsMd([], 'ko'));
  for (const lang of ['ko', 'en']) {
    assert.strictEqual(P._decisionsFromMd(P._renderDecisionsMd([], lang)).length, 0, lang);
    assert.strictEqual(P._parseLessonEntries(P._renderLessonsMd([], lang)).length, 0, lang);
    const d = [{ date: '2026-09-02', title: 'T', decision: 'D', reason: null, alternatives: null, impact: null }];
    assert.deepStrictEqual(P._decisionsFromMd(P._renderDecisionsMd(d, lang)), d, lang + ' decisions round trip');
  }
  assert.ok(!HANGUL.test(P._renderDecisionsMd([], 'en') + P._renderLessonsMd([], 'en')));
});

console.log(`Tests: ${passed}/${passed + failed} passed`);
try { removeTree(arena, { recursive: true, force: true }); } catch {}
process.exitCode = failed ? 1 : 0;
