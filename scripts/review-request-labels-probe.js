'use strict';
// T-0320: `review-request --ladder` printed "[object Object]" in the in-codebase rung, in text and in --json, for every
// reuse-map candidate. The rung labelled a candidate with r.name || r.id; reuse-map rows ({ capability, where }) have
// neither, so it fell back to the row object. The rung and the reuse-candidate section now share one label per kind:
// a skill by its id, a reuse-map row by its capability (the section also shows the skill's display name and the row's
// location, the latter only when the row has one). Values read from hand-edited stores that are not text (a skill.json
// displayNameKo, platform-constraints.json docs/kind/detail) print nothing instead of "[object Object]", a comma-joined
// array or "undefined"; --json keeps those values as they are.
// The fixture writes its own skills: init installs whichever skill catalog the host resolves (LEERNESS_SKILLPACK_PATH,
// an installed leerness-skillpack), which changed the candidate list (T-0322 cross-model review).
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-review-request-labels-'));
const controlled = { LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
  LEERNESS_NO_AUTOCHCP: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1' };
const env = { ...process.env };
const ignored = Object.keys(env).filter(k => /^LEERNESS_/i.test(k) && !(k in controlled));
for (const k of ignored) delete env[k];
Object.assign(env, controlled);
if (ignored.length) console.log('ignoring ambient ' + ignored.join(', '));
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) { env[key] = path.join(arena, 'env-' + key.toLowerCase()); fs.mkdirSync(env[key]); }
let seq = 0, passed = 0, failed = 0;
const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
const test = (name, fn) => { if (filter && !name.includes(filter)) return; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };
const run = (dir, args) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
const must = (r, label) => { assert.ifError(r.error); assert.strictEqual(r.status, 0, label + ' exit ' + r.status + '\n' + r.stdout + r.stderr); return r.stdout; };
// --json must print one JSON object and nothing else.
const json = (r, label) => { const out = must(r, label); try { return JSON.parse(out); } catch (e) { throw new Error(label + ': stdout is not one JSON object\n' + out.slice(0, 800)); } };
// init takes most of the run time, so it runs once; each test works on its own copy of that project, with no skills.
let template = null;
const project = () => {
  if (!template) {
    template = path.join(arena, 'template'); fs.mkdirSync(template);
    fs.writeFileSync(path.join(template, 'package.json'), '{"name":"proj","version":"0.1.0"}\n');
    must(run(template, ['init', template, '--yes', '--language', 'ko', '--no-setup-agents', '--no-mcp']), 'init');
    fs.rmSync(path.join(template, '.leerness', 'skills'), { recursive: true, force: true });
    fs.mkdirSync(path.join(template, '.leerness', 'skills'));
  }
  const dir = path.join(arena, 'p' + (++seq));
  fs.cpSync(template, dir, { recursive: true });
  return dir;
};
const skill = (dir, id, displayNameKo, capabilities) => {
  const d = path.join(dir, '.leerness', 'skills', id); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'skill.json'), JSON.stringify({ name: id, displayNameKo, capabilities }, null, 2) + '\n');
};
// Rows go through the product writer, which puts each new row first under the table header.
const register = (dir, name, where) => must(run(dir, ['reuse', 'register', name, '--where', where, '--kind', 'helper', '--path', dir]), 'reuse register ' + name);
const review = (dir, request, ...flags) => run(dir, ['review-request', request, ...flags, '--path', dir]);
const inCodebase = j => ((j.ladder && j.ladder.rungs || []).find(r => r.id === 'in-codebase') || {}).evidence;
const lines = text => String(text).split(/\r?\n/).map(l => l.trimEnd());
// The lines of one "## <icon> ..." section, up to the blank line (or the given end marker) that closes it.
const section = (text, icon, endPrefix) => {
  const all = lines(text), start = all.findIndex(l => l.startsWith('## ' + icon));
  assert.ok(start >= 0, 'section ' + icon + ' missing\n' + text);
  const out = [];
  for (const l of all.slice(start + 1)) { if (!l || (endPrefix && l.startsWith(endPrefix))) break; out.push(l); }
  return out;
};
const NO_MATCH = 'reuse-map 매칭 없음 — 부재 증명은 아님 (leerness reuse find "<capability>")';

test('the in-codebase rung names skill and reuse-map candidates by kind, in text and --json', () => {
  const dir = project();
  skill(dir, 'roadmap-kit', '로드맵 키트', ['roadmap renderer']);
  register(dir, 'Roadmap SVG renderer', 'lib/roadmap.js: renderRoadmap, layoutTree');
  register(dir, 'Timeline roadmap export', 'lib/export.js');
  register(dir, 'Solo roadmap sketch', '');
  // "roadmap" matches the fixture skill and all three rows. Skills come first, then rows in file order; the rung shows
  // the first three of the four.
  const j = json(review(dir, 'roadmap', '--ladder', '--json'), 'roadmap --json');
  assert.deepStrictEqual(j.reuseCandidates.map(r => r.kind + ':' + (r.kind === 'skill' ? r.id : r.capability)),
    ['skill:roadmap-kit', 'reuse-map:Solo roadmap sketch', 'reuse-map:Timeline roadmap export', 'reuse-map:Roadmap SVG renderer']);
  const want = 'reuse 후보 4건(토큰 매칭 — 확정 아님): [skill] roadmap-kit, [reuse] Solo roadmap sketch, [reuse] Timeline roadmap export';
  assert.strictEqual(inCodebase(j), want);
  const text = must(review(dir, 'roadmap', '--ladder'), 'roadmap text');
  assert.ok(lines(text).some(l => l.trim() === want), 'text rung differs from --json\n' + text);
  // Rows only: the shape observed on this repository's own workspace, where every label printed as [object Object].
  const rows = json(review(dir, 'renderer export', '--ladder', '--json'), 'rows --json');
  assert.strictEqual(inCodebase(rows), 'reuse 후보 2건(토큰 매칭 — 확정 아님): [reuse] Timeline roadmap export, [reuse] Roadmap SVG renderer');
  const rowsText = must(review(dir, 'renderer export', '--ladder'), 'rows text');
  assert.ok(lines(rowsText).some(l => l.trim() === inCodebase(rows)), 'text rung differs from --json\n' + rowsText);
  for (const out of [text, rowsText, JSON.stringify(j), JSON.stringify(rows)]) assert.ok(!out.includes('[object Object]'), out);
  // No candidate: the rung keeps its unknown status and wording.
  const none = json(review(dir, 'zzqx', '--ladder', '--json'), 'none --json');
  const rung = none.ladder.rungs.find(r => r.id === 'in-codebase');
  assert.deepStrictEqual([rung.status, rung.evidence], ['unknown', NO_MATCH]);
});

test('the reuse-candidate section uses the same labels and shows where only when the row has one', () => {
  const dir = project();
  skill(dir, 'roadmap-kit', '로드맵 키트', ['roadmap renderer']);
  register(dir, 'Roadmap SVG renderer', 'lib/roadmap.js: renderRoadmap, layoutTree');
  register(dir, 'Solo roadmap sketch', '');
  const text = must(review(dir, 'roadmap'), 'roadmap text');
  assert.deepStrictEqual(section(text, '🔁'), [
    '  - [skill] roadmap-kit · 로드맵 키트',
    '  - [reuse] Solo roadmap sketch',
    '  - [reuse] Roadmap SVG renderer @ lib/roadmap.js: renderRoadmap, layoutTree',
  ]);
});

test('store values that are not text print nothing instead of [object Object], a joined array or undefined', () => {
  const dir = project();
  skill(dir, 'object-name-skill', { ko: '스케치패드' }, ['sketchpad export']);
  skill(dir, 'array-name-skill', ['스케치패드', '내보내기'], ['sketchpad export']);
  const detail = { ko: '초당 5회' }, docs = { url: 'https://acme.example/docs' }, kind = { k: 'quota' };
  fs.writeFileSync(path.join(dir, '.leerness', 'platform-constraints.json'), JSON.stringify({ platforms: {
    acme: { aliases: ['acmepay'], docs,
      constraints: [{ kind: 'rate-limit', detail }, { kind: 'auth', detailEn: 'OAuth only' }, { kind: 'cost', detail: '월 100건 무료' }] },
    bolt: { aliases: ['boltpay'], docs: 'https://bolt.example/docs', constraints: [{ kind, detail: '분당 60회' }] },
  } }, null, 2) + '\n');
  // Directory order differs between file systems, so the two skill lines are compared as a set.
  const skillsText = must(review(dir, 'sketchpad', '--ladder'), 'sketchpad text');
  assert.deepStrictEqual(section(skillsText, '🔁').sort(), ['  - [skill] array-name-skill', '  - [skill] object-name-skill']);
  const constraintsText = must(review(dir, 'acmepay boltpay'), 'constraints text');
  assert.deepStrictEqual(section(constraintsText, '🚦', '  →'), [
    '  - 📦 acme  (docs: -)', '     • [rate-limit]', '     • [auth]', '     • [cost] 월 100건 무료',
    '  - 📦 bolt  (docs: https://bolt.example/docs)', '     • 분당 60회',
  ]);
  for (const out of [skillsText, constraintsText]) assert.ok(!/\[object Object\]|undefined|스케치패드,내보내기/.test(out), out);
  // --json reports the stored values unchanged; only the text rendering leaves them out.
  const j = json(review(dir, 'sketchpad', '--json'), 'sketchpad --json');
  const byId = id => j.reuseCandidates.filter(r => r.id === id).map(r => r.displayNameKo);
  assert.deepStrictEqual([byId('object-name-skill'), byId('array-name-skill')], [[{ ko: '스케치패드' }], [['스케치패드', '내보내기']]]);
  const cj = json(review(dir, 'acmepay boltpay', '--json'), 'constraints --json');
  const plat = id => cj.platformConstraints.find(m => m.platform === id) || {};
  assert.deepStrictEqual([plat('acme').docs, plat('acme').constraints[0].detail, plat('bolt').constraints[0].kind], [docs, detail, kind]);
});

console.log(`Tests: ${passed}/${passed + failed} passed`);
try { removeTree(arena, { recursive: true, force: true }); } catch {}
process.exitCode = failed ? 1 : 0;
