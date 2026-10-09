#!/usr/bin/env node
'use strict';

// T-0193: legacy-only Markdown mutation must retain opaque suffixes or refuse
// before domain writes. Exercise the actual CLI, including migration backfill.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const { _renderDecisionsMd, _renderLessonsMd } = require('../lib/pure-utils');
const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin/leerness.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-memory-legacy-retention-'));
const seed = path.join(temp, 'seed');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC)$/i.test(key)));
for (const key of ['TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
  env[key] = path.join(temp, key.toLowerCase());
  fs.mkdirSync(env[key], { recursive: true });
}
Object.assign(env, { LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1' });
const results = [];
let sequence = 0;
function check(name, fn) {
  if (process.argv.includes('--repro-only') && name !== 'decisions add refuses lossy preamble with unchanged files') return;
  try { fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.error(`FAIL ${name}: ${e.message}`); }
}
function run(project, args) {
  const r = cp.spawnSync(process.execPath, [cli, ...args, '--path', project, '--json'], {
    cwd: project, env, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.strictEqual(r.error, undefined, r.error && r.error.message);
  assert.strictEqual(r.signal, null);
  return r;
}
function success(r) { assert.strictEqual(r.status, 0, String(r.stdout || r.stderr).slice(-1000)); }
function fileState(file) {
  try {
    return { sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      mtime: fs.statSync(file, { bigint: true }).mtimeNs.toString() };
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function fixture(surface) {
  const project = path.join(temp, `case-${++sequence}`);
  fs.cpSync(seed, project, { recursive: true });
  const p = ext => path.join(project, '.leerness', `${surface}.${ext}`);
  const entry = value => surface === 'decisions'
    ? { date: '2026-09-12', title: value, decision: value, reason: 'reason', alternatives: null, impact: null }
    : { date: '2026-09-12', text: value, tag: 'tag' };
  // T-0318: the seed is an English project, so writers render the English header. The legacy files below carry the
  // Korean header every earlier version wrote; a write must accept it and replace only that header.
  const render = (rows, lang = 'en') => (surface === 'decisions' ? _renderDecisionsMd : _renderLessonsMd)(rows, lang);
  const entries = [entry('survivor'), entry('selected')];
  if (fs.existsSync(p('json'))) fs.unlinkSync(p('json'));
  fs.writeFileSync(p('md'), render(entries, 'ko'));
  const body = render([entry('restored')], 'ko').slice(render([], 'ko').length);
  fs.writeFileSync(p('archive.md'), '# Archive\n\n## 제거 2026-09-12 (target: "restore-me")\n' + body + '\n');
  const domain = () => Object.fromEntries(['json', 'md', 'archive.md'].map(ext => [ext, fileState(p(ext))]));
  const load = () => JSON.parse(fs.readFileSync(p('json'), 'utf8'));
  return { project, p, entry, entries, render, domain, load };
}
const commands = surface => ({
  add: [surface === 'decisions' ? 'decision' : 'lesson', surface === 'decisions' ? 'add' : 'save', 'fresh'],
  drop: [surface === 'decisions' ? 'decision' : 'lesson', 'drop', 'selected'],
  restore: ['memory', 'restore', surface, 'restore-me'],
  backfill: ['migrate', 'apply', '--yes'],
});
const suffix = '\n<!-- raw user notes -->\n보존할 문단\r\n- lower-case producer: 그대로\n\ufeff끝\n';

try {
  fs.mkdirSync(seed);
  success(run(seed, ['init', seed, '--yes', '--language', 'en', '--no-stale-check']));
  for (const surface of ['decisions', 'lessons']) {
    for (const [operation, args] of Object.entries(commands(surface))) {
      check(`${surface} ${operation} retains appended legacy bytes`, () => {
        const f = fixture(surface);
        fs.appendFileSync(f.p('md'), suffix);
        success(run(f.project, args));
        const md = fs.readFileSync(f.p('md'), 'utf8');
        assert(md.endsWith(suffix), 'legacy suffix was lost');
        assert.strictEqual(md.split(suffix).length - 1, 1, 'suffix duplicated');
        const expected = operation === 'drop' ? ['survivor'] : operation === 'add'
          ? ['survivor', 'selected', 'fresh'] : operation === 'restore'
            ? ['survivor', 'selected', 'restored'] : ['survivor', 'selected'];
        assert.deepStrictEqual(f.load().map(e => e.title || e.text), expected);
        // Once canonical exists, another mutation must not duplicate retained text.
        success(run(f.project, [...commands(surface).add.slice(0, 2), 'second']));
        assert.strictEqual(fs.readFileSync(f.p('md'), 'utf8'), f.render(f.load()) + suffix);
      });
      for (const location of ['preamble', 'interior', 'bom']) {
        check(`${surface} ${operation} refuses lossy ${location} with unchanged files`, () => {
          const f = fixture(surface);
          let text = fs.readFileSync(f.p('md'), 'utf8');
          if (location === 'preamble') text = '사용자 원문 머리말\n\n' + text;
          if (location === 'interior') text = text.replace(surface === 'decisions' ? '- Reason: reason' : '- Tag: tag', '$&\n보존할 여러 줄 설명');
          if (location === 'bom') text = '\ufeff' + text;
          fs.writeFileSync(f.p('md'), text);
          const before = f.domain();
          const r = run(f.project, args);
          assert(r.status > 0, 'lossy legacy mutation was accepted');
          assert.strictEqual(JSON.parse(r.stdout).code, 'projection_diverged');
          assert.deepStrictEqual(f.domain(), before, 'rejection changed domain bytes/mtime/presence');
        });
      }
    }
    check(`${surface} exact legacy continues to initialize canonical`, () => {
      const f = fixture(surface);
      success(run(f.project, commands(surface).add));
      assert.deepStrictEqual(f.load().map(e => e.title || e.text), ['survivor', 'selected', 'fresh']);
      assert.strictEqual(fs.readFileSync(f.p('md'), 'utf8'), f.render(f.load()));
    });
    check(`${surface} read-only and duplicate preserve arbitrary legacy original`, () => {
      const f = fixture(surface);
      fs.writeFileSync(f.p('md'), '手動 preamble\n' + f.render(f.entries));
      const before = f.domain();
      success(run(f.project, [surface === 'decisions' ? 'decision' : 'lesson', 'list']));
      success(run(f.project, [...commands(surface).add.slice(0, 2), 'survivor']));
      assert.deepStrictEqual(f.domain(), before);
    });
    check(`${surface} record-free original is retained as an opaque suffix`, () => {
      const f = fixture(surface);
      const original = '\ufeff# Manual only\r\n\r\n사용자 메모\n- lower-case producer: raw\n';
      fs.writeFileSync(f.p('md'), original);
      success(run(f.project, commands(surface).add));
      assert.deepStrictEqual(f.load().map(e => e.title || e.text), ['fresh']);
      assert.strictEqual(fs.readFileSync(f.p('md'), 'utf8'), f.render(f.load()) + original);
      success(run(f.project, [...commands(surface).add.slice(0, 2), 'second']));
      assert.strictEqual(fs.readFileSync(f.p('md'), 'utf8'), f.render(f.load()) + original);
    });
    check(`${surface} fresh init remains usable and retains its template`, () => {
      const project = path.join(temp, `case-${++sequence}`);
      fs.cpSync(seed, project, { recursive: true });
      const md = path.join(project, '.leerness', `${surface}.md`);
      const original = fs.existsSync(md) ? fs.readFileSync(md, 'utf8') : '';
      success(run(project, commands(surface).add));
      const entries = JSON.parse(fs.readFileSync(path.join(project, '.leerness', `${surface}.json`), 'utf8'));
      assert.deepStrictEqual(entries.map(e => e.title || e.text), ['fresh']);
      if (original) assert(fs.readFileSync(md, 'utf8').endsWith(original));
    });
    check(`${surface} force cannot waive legacy preservation`, () => {
      const f = fixture(surface);
      fs.writeFileSync(f.p('md'), '手動 preamble\n' + f.render(f.entries));
      const before = f.domain();
      const r = run(f.project, [...commands(surface).add.slice(0, 2), 'survivor', '--force']);
      assert(r.status > 0);
      assert.strictEqual(JSON.parse(r.stdout).code, 'projection_diverged');
      assert.deepStrictEqual(f.domain(), before);
    });
    check(`${surface} backfill dry-run leaves arbitrary legacy bytes untouched`, () => {
      const f = fixture(surface);
      fs.writeFileSync(f.p('md'), '手動 preamble\n' + f.render(f.entries));
      const before = f.domain();
      success(run(f.project, ['migrate', 'apply']));
      assert.deepStrictEqual(f.domain(), before);
    });
    check(`${surface} canonical projection BOM is not silently removed`, () => {
      const f = fixture(surface);
      fs.writeFileSync(f.p('json'), JSON.stringify(f.entries));
      fs.writeFileSync(f.p('md'), '\ufeff' + f.render(f.entries));
      const before = f.domain();
      const r = run(f.project, commands(surface).add);
      assert(r.status > 0);
      assert.strictEqual(JSON.parse(r.stdout).code, 'projection_diverged');
      assert.deepStrictEqual(f.domain(), before);
    });
    check(`${surface} CRLF legacy records are refused without normalization`, () => {
      const f = fixture(surface);
      fs.writeFileSync(f.p('md'), f.render(f.entries).replace(/\n/g, '\r\n'));
      const before = f.domain();
      const r = run(f.project, commands(surface).add);
      assert(r.status > 0);
      assert.strictEqual(JSON.parse(r.stdout).code, 'projection_diverged');
      assert.deepStrictEqual(f.domain(), before);
    });
  }
} catch (e) { results.push({ name: 'setup', ok: false, error: e.message }); console.error(e.stack); }
const passed = results.filter(r => r.ok).length;
fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify({ node: process.version, platform: process.platform, temp, passed, total: results.length, results }, null, 2) + '\n');
console.log(`memory legacy retention: ${passed}/${results.length}; Evidence: ${temp}`);
if (passed !== results.length || results.length !== (process.argv.includes('--repro-only') ? 1 : 48)) process.exitCode = 1;
