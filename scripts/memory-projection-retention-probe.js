#!/usr/bin/env node
'use strict';

// T-0193: canonical JSON이 authoritative인 상태에서 projection Markdown 뒤에
// 붙은 사용자/producer 원문은 보존하고, projection 내부 divergence는 덮어쓰지 않는다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const { _renderDecisionsMd, _renderLessonsMd } = require('../lib/pure-utils');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin/leerness.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-memory-projection-retention-'));
const seed = path.join(temp, 'seed');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC)$/i.test(key)));
for (const key of ['TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
  env[key] = path.join(temp, key.toLowerCase());
  fs.mkdirSync(env[key], { recursive: true });
}
Object.assign(env, { LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1' });
const results = [];
let sequence = 0;
const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
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
function fixture(surface) {
  const project = path.join(temp, `case-${++sequence}`);
  require('../lib/copy-tree').copyTreeSync(seed, project);
  const hd = path.join(project, '.leerness');
  const p = ext => path.join(hd, `${surface}.${ext}`);
  const entry = surface === 'decisions'
    ? { date: '2026-09-11', title: 'base', decision: 'base', reason: 'reason', alternatives: null, impact: null }
    : { date: '2026-09-11', text: 'base', tag: 'tag' };
  // T-0318: the seed is an English project, so writers render the English header; the projection below carries
  // the Korean header earlier versions wrote in every project, which a write accepts and replaces.
  const render = (entries, lang = 'en') => surface === 'decisions' ? _renderDecisionsMd(entries, lang) : _renderLessonsMd(entries, lang);
  fs.writeFileSync(p('json'), JSON.stringify([entry], null, 2) + '\n');
  fs.writeFileSync(p('md'), render([entry], 'ko'));
  const suffix = surface === 'decisions'
    ? '\n<!-- manual-note -->\n사용자 전용 메모 | 그대로 보존\n'
    : '\n### 2026-09-11 multi-agent consensus — best=fixture\n- task: raw producer section\n- lesson: lower-case producer line must remain byte-exact\n';
  const domain = () => ({ json: hash(p('json')), md: hash(p('md')), archive: hash(p('archive.md')) });
  const load = () => JSON.parse(fs.readFileSync(p('json'), 'utf8'));
  return { project, p, entry, render, suffix, domain, load };
}
function appendSuffix(f) { fs.appendFileSync(f.p('md'), f.suffix); }
function assertSuffixExact(f) {
  const text = fs.readFileSync(f.p('md'), 'utf8');
  assert(text.endsWith(f.suffix), `projection suffix missing/changed: ${JSON.stringify(text.slice(-Math.max(200, f.suffix.length)))}`);
  assert.strictEqual(text.split(f.suffix).length - 1, 1, 'suffix duplicated');
}
function addArgs(surface, value) { return surface === 'decisions' ? ['decision', 'add', value] : ['lesson', 'save', value]; }
function dropArgs(surface, value) { return surface === 'decisions' ? ['decision', 'drop', value] : ['lesson', 'drop', value]; }
function archiveBlock(surface, value) {
  return surface === 'decisions'
    ? `# Decisions archive\n\n## 제거 2026-09-11 (target: "restore-me")\n\n### 2026-09-10 — ${value}\n- Decision: ${value}\n- Reason: archived\n- Alternatives:\n- Impact:\n\n`
    : `# Lessons archive\n\n## 제거 2026-09-11 (target: "restore-me")\n\n### 2026-09-10\n- Lesson: ${value}\n- Tag: archived\n\n`;
}

try {
  fs.mkdirSync(seed);
  success(run(seed, ['init', seed, '--yes', '--language', 'en', '--no-stale-check']));

  for (const surface of ['decisions', 'lessons']) {
    check(`${surface} add/save preserves exact appended Markdown suffix`, () => {
      const f = fixture(surface); appendSuffix(f);
      success(run(f.project, addArgs(surface, 'fresh')));
      assertSuffixExact(f);
      assert.deepStrictEqual(f.load().map(v => v.title || v.text), ['base', 'fresh']);
    });

    check(`${surface} drop preserves exact appended Markdown suffix`, () => {
      const f = fixture(surface); appendSuffix(f);
      success(run(f.project, dropArgs(surface, 'base')));
      assertSuffixExact(f);
      assert.deepStrictEqual(f.load(), []);
    });

    check(`${surface} restore preserves exact appended Markdown suffix`, () => {
      const f = fixture(surface); appendSuffix(f);
      fs.writeFileSync(f.p('archive.md'), archiveBlock(surface, 'restored'));
      success(run(f.project, ['memory', 'restore', surface, 'restore-me']));
      assertSuffixExact(f);
      assert.deepStrictEqual(f.load().map(v => v.title || v.text), ['base', 'restored']);
    });

    check(`${surface} projection interior divergence rejects without domain writes`, () => {
      const f = fixture(surface);
      const text = fs.readFileSync(f.p('md'), 'utf8');
      const changed = surface === 'decisions'
        ? text.replace('- Reason: reason', '- Reason: manually edited')
        : text.replace('- Tag: tag', '- Tag: manually-edited');
      assert.notStrictEqual(changed, text);
      fs.writeFileSync(f.p('md'), changed);
      const before = f.domain();
      const r = run(f.project, addArgs(surface, 'fresh'));
      assert(r.status > 0, 'diverged projection was overwritten');
      const payload = JSON.parse(r.stdout);
      assert.strictEqual(payload.code, 'projection_diverged');
      assert.deepStrictEqual(f.domain(), before, 'rejected mutation changed domain files');
    });

    check(`${surface} malformed UTF-8 projection rejects without domain writes`, () => {
      const f = fixture(surface);
      fs.writeFileSync(f.p('md'), Buffer.from([0xc3, 0x28]));
      const before = f.domain();
      const r = run(f.project, addArgs(surface, 'fresh'));
      assert(r.status > 0, 'malformed projection was accepted');
      const payload = JSON.parse(r.stdout);
      assert.strictEqual(payload.code, 'projection_corrupt');
      assert.deepStrictEqual(f.domain(), before, 'corrupt projection rejection changed domain files');
    });

    check(`${surface} missing projection is regenerated from canonical`, () => {
      const f = fixture(surface); fs.unlinkSync(f.p('md'));
      success(run(f.project, addArgs(surface, 'fresh')));
      assert.strictEqual(fs.readFileSync(f.p('md'), 'utf8'), f.render(f.load()));
    });

    check(`${surface} exact projection stays canonical without duplicate suffix`, () => {
      const f = fixture(surface);
      success(run(f.project, addArgs(surface, 'fresh')));
      assert.strictEqual(fs.readFileSync(f.p('md'), 'utf8'), f.render(f.load()));
    });

    check(`${surface} duplicate no-op leaves appended suffix byte-exact`, () => {
      const f = fixture(surface); appendSuffix(f);
      const before = fs.readFileSync(f.p('md'));
      success(run(f.project, addArgs(surface, 'base')));
      assert(fs.readFileSync(f.p('md')).equals(before));
    });
  }

  check('legacy decisions fallback behavior remains available', () => {
    const f = fixture('decisions');
    fs.unlinkSync(f.p('json'));
    success(run(f.project, ['decision', 'add', 'fresh']));
    assert.deepStrictEqual(f.load().map(v => v.title), ['base', 'fresh']);
  });
  check('legacy lessons fallback behavior remains available', () => {
    const f = fixture('lessons');
    fs.unlinkSync(f.p('json'));
    success(run(f.project, ['lesson', 'save', 'fresh']));
    assert.deepStrictEqual(f.load().map(v => v.text), ['base', 'fresh']);
  });
} catch (error) {
  results.push({ name: 'setup', ok: false, error: error.message });
  console.error(error.stack || error.message);
}
const passed = results.filter(r => r.ok).length;
fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify({ node: process.version, platform: process.platform, temp, passed, total: results.length, results }, null, 2) + '\n');
console.log(`memory projection retention: ${passed}/${results.length}; Evidence: ${temp}`);
if (passed !== results.length || results.length !== 18) process.exitCode = 1;
