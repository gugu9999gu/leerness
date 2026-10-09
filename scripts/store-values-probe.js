'use strict';
// T-0325: values from hand-edited stores that are not text. skill.json (displayNameKo, description, capabilities, sources,
// patterns, usage) and platform-constraints.json (docs, kind, detail) are written by people and third-party skill packs, so
// an object, an array or nothing can sit where text or a number is expected. Text commands printed "[object Object]", a
// comma-joined array, "undefined" or the letter count of a string as a capability count; generated files (SKILL.md,
// README.md, skill-index.md, roadmap.html, skill-suggestions.md) kept that text; array methods crashed (skill search/info/
// consolidate/export/publish/optimize, retro, init with such a skill pack, constraints list/check, review-request); skill
// learn crashed on any skill.json without sources/patterns — including the built-in skills — and skill use saved NaN as
// null. One display rule (lib/store-display.js) now shapes what is shown, write commands refuse a field of another shape
// without touching the file, the constraints loader rejects malformed entries like other invalid stores, and --json keeps
// the stored values. review-request's store text is also line-safe now, as constraints check already was.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-store-values-'));
const controlled = { LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
  LEERNESS_NO_AUTOCHCP: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1' };
const env = { ...process.env };
const ignored = Object.keys(env).filter(k => /^LEERNESS_/i.test(k) && !(k in controlled));
for (const k of ignored) delete env[k];
Object.assign(env, controlled);
if (ignored.length) console.log('ignoring ambient ' + ignored.join(', '));
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) { env[key] = path.join(arena, 'env-' + key.toLowerCase()); fs.mkdirSync(env[key]); }
// The skill catalog is pinned to the built-in skills. Otherwise a leerness-skillpack beside the CLI or in the global npm
// root is loaded (the catalog lookup does not read HOME), and its skills enter export-all, publish and search output.
const pinnedPack = path.join(arena, 'builtin-pack.json');
fs.writeFileSync(pinnedPack, JSON.stringify({ name: 'builtin-pinned', version: '0', skills: Object.entries(require('../lib/catalogs').BUILTIN_CATALOG).map(([id, v]) => ({ id, ...v })) }));
env.LEERNESS_SKILLPACK_PATH = pinnedPack;
let seq = 0, passed = 0, failed = 0;
const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
const test = (name, fn) => { if (filter && !name.includes(filter)) return; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };
const run = (dir, args, extra = {}) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', timeout: 300000, windowsHide: true, env: { ...env, ...extra } });
const both = r => String(r.stdout || '') + String(r.stderr || '');
const must = (r, label) => { assert.ifError(r.error); assert.strictEqual(r.status, 0, label + ' exit ' + r.status + '\n' + both(r)); return String(r.stdout || ''); };
const json = (r, label) => { const out = must(r, label); try { return JSON.parse(out); } catch (e) { throw new Error(label + ': stdout is not one JSON object\n' + out.slice(0, 800)); } };
// init takes most of the run time, so it runs once; each test works on its own copy, with no installed skills.
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
const store = (dir, ...parts) => path.join(dir, '.leerness', ...parts);
const skill = (dir, id, fields) => {
  fs.mkdirSync(store(dir, 'skills', id), { recursive: true });
  fs.writeFileSync(store(dir, 'skills', id, 'skill.json'), JSON.stringify({ name: id, ...fields }, null, 2) + '\n');
};
const constraints = (dir, platforms) => fs.writeFileSync(store(dir, 'platform-constraints.json'), JSON.stringify({ platforms }, null, 2) + '\n');
// What a non-text value turned into: an object, a comma-joined array, a missing value.
const BAD = /\[object Object\]|undefined|얼룩말,목록/;
const JS_ERROR = /is not a function|Cannot read properties|is not iterable|of undefined|of null/;
const clean = (text, label) => { assert.ok(!BAD.test(text), label + ' printed a non-text value:\n' + text.slice(0, 1500)); assert.ok(!JS_ERROR.test(text), label + ' crashed:\n' + text.slice(0, 1500)); };
const noControl = (text, label) => {
  const bad = [...String(text)].find(ch => { const c = ch.charCodeAt(0); return (c < 32 && c !== 10 && c !== 13) || c === 127; });
  assert.ok(bad === undefined, label + ' printed control character ' + (bad && bad.charCodeAt(0)));
};
const SKILLS = {
  'obj-name': { displayNameKo: { ko: '얼룩말' }, capabilities: ['zebra export'], usage: { count: 2 } },
  'arr-name': { displayNameKo: ['얼룩말', '목록'], capabilities: ['zebra export'], usage: { count: 1 } },
  'no-name': { capabilities: ['zebra export'], usage: { count: 1 } },
  'objitem-caps': { displayNameKo: '객체 항목', capabilities: [{ k: 'zebra' }, 'zebra export'], usage: { count: 1 } },
  'obj-desc': { displayNameKo: '설명 객체', description: { en: 'zebra export' }, capabilities: ['zebra export'], version: { v: 1 } },
};

test('skill.json values that are not text print as nothing in every text command', () => {
  const dir = project();
  for (const [id, fields] of Object.entries(SKILLS)) skill(dir, id, fields);
  must(run(dir, ['task', 'add', 'zebra export', '--status', 'in-progress', '--no-review', '--path', dir]), 'task add');
  const outputs = {
    brainstorm: must(run(dir, ['brainstorm', 'zebra', '--path', dir]), 'brainstorm'),
    search: must(run(dir, ['skill', 'search', 'zebra', '--path', dir]), 'skill search'),
    match: must(run(dir, ['skill', 'match', 'zebra', '--path', dir]), 'skill match'),
    insights: must(run(dir, ['insights', '--path', dir]), 'insights'),
    retro: must(run(dir, ['retro', '--path', dir]), 'retro'),
    handoff: must(run(dir, ['handoff', dir, '--no-record']), 'handoff'),
    review: must(run(dir, ['review-request', 'zebra export', '--path', dir]), 'review-request'),
    workspace: must(run(dir, ['brainstorm', 'zebra', '--include', dir, '--path', dir]), 'brainstorm --include'),
  };
  for (const id of Object.keys(SKILLS)) outputs['info ' + id] = must(run(dir, ['skill', 'info', id, '--path', dir]), 'skill info ' + id);
  for (const [label, out] of Object.entries(outputs)) clean(out, label);
  // Not a pass by silence: the skills are listed, by id, where these commands list skills.
  for (const label of ['brainstorm', 'search', 'match']) for (const id of Object.keys(SKILLS)) assert.ok(outputs[label].includes(id), label + ' does not list ' + id + '\n' + outputs[label]);
  assert.ok(outputs.insights.includes('obj-name'), 'insights does not list obj-name\n' + outputs.insights);
  assert.ok(/objitem-caps/.test(outputs['info objitem-caps']) && /zebra export/.test(outputs['info objitem-caps']), outputs['info objitem-caps']);
});

test('array fields that are not arrays do not crash skill commands, and skill learn works on minimal skill.json', () => {
  const dir = project();
  skill(dir, 'str-caps', { displayNameKo: '문자열 능력', capabilities: 'zebra export' });
  skill(dir, 'obj-caps', { displayNameKo: '객체 능력', capabilities: { a: 'zebra export' }, sources: 'https://example.com', patterns: { p: 1 } });
  skill(dir, 'plain', { displayNameKo: '기본', capabilities: ['zebra export'] });   // no sources/patterns, like the built-in skills
  skill(dir, 'odd-usage', { displayNameKo: '사용 기록', capabilities: ['zebra export'], usage: { count: { n: 1 } }, optimizations: 'none' });
  skill(dir, 'empty-usage', { displayNameKo: '빈 사용', capabilities: ['zebra export'], usage: {} });
  // Lists whose items are not the expected objects: a pattern that is text, a source without url, a null source.
  skill(dir, 'str-items', { displayNameKo: '문자열 항목', capabilities: ['zebra export'], patterns: ['run it'], optimizations: ['faster'], sources: [{ note: 'no url' }, null, { url: '' }], verification: null });
  skill(dir, 'good-sources', { displayNameKo: '출처 있음', capabilities: ['zebra export'], sources: ['https://string.example', { url: 'https://object.example' }] });
  for (const args of [['skill', 'search', 'zebra'], ['skill', 'info', 'str-caps'], ['skill', 'info', 'obj-caps'], ['skill', 'info', 'str-items'], ['skill', 'consolidate'],
    ['skill', 'export', 'str-caps'], ['skill', 'export', 'obj-caps'], ['skill', 'export', 'str-items'], ['skill', 'export', 'good-sources'], ['skill', 'export-all'], ['skill', 'publish'],
    ['skill', 'learn', 'obj-caps'], ['skill', 'learn', 'str-items'], ['skill', 'learn', 'str-items', '--doc', 'https://kite.example'], ['skill', 'learn', 'good-sources']]) {
    clean(must(run(dir, [...args, '--path', dir]), args.join(' ')), args.join(' '));
  }
  for (const id of ['obj-caps', 'str-items']) clean(fs.readFileSync(store(dir, 'skills', id, 'README.md'), 'utf8'), id + ' README.md');
  // Valid sources still show, as text or as { url }: leaving every source out would pass the checks above.
  const shown = [must(run(dir, ['skill', 'info', 'good-sources', '--path', dir]), 'info good-sources'),
    fs.readFileSync(store(dir, 'skills-export', 'good-sources', 'SKILL.md'), 'utf8'), fs.readFileSync(store(dir, 'skills', 'good-sources', 'README.md'), 'utf8')];
  for (const text of shown) assert.ok(text.includes('https://string.example') && text.includes('https://object.example'), text);
  assert.ok(fs.readFileSync(store(dir, 'skills', 'str-items', 'README.md'), 'utf8').includes('https://kite.example'), 'the learned source is missing from the README');
  clean(fs.readFileSync(store(dir, 'skills-export', 'str-items', 'SKILL.md'), 'utf8'), 'str-items SKILL.md');   // a source whose url is empty
  // skill info --json reports these as stored instead of crashing (a null source, a null verification, sources that are one string).
  const info = json(run(dir, ['skill', 'info', 'str-items', '--path', dir, '--json']), 'skill info str-items --json');
  assert.deepStrictEqual([info.sources.slice(0, 3), info.verification], [[{ note: 'no url' }, null, { url: '' }], null]);
  assert.strictEqual(json(run(dir, ['skill', 'info', 'obj-caps', '--path', dir, '--json']), 'skill info obj-caps --json').sources, 'https://example.com');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(store(dir, 'skills', 'str-items', 'skill.json'), 'utf8')).sources.slice(0, 2), [{ note: 'no url' }, null]);   // kept as written
  // A minimal skill gains the capability and keeps everything it had.
  clean(must(run(dir, ['skill', 'learn', 'plain', '--capability', 'zebra import', '--path', dir]), 'learn plain'), 'learn plain');
  const plain = JSON.parse(fs.readFileSync(store(dir, 'skills', 'plain', 'skill.json'), 'utf8'));
  assert.deepStrictEqual([plain.displayNameKo, plain.capabilities], ['기본', ['zebra export', 'zebra import']]);
  // Adding to a field that is not a list is refused, in either language, and the file is left as it was.
  const before = fs.readFileSync(store(dir, 'skills', 'str-caps', 'skill.json'), 'utf8');
  for (const lang of ['ko', 'en']) {
    const r = run(dir, ['skill', 'learn', 'str-caps', '--capability', 'zebra import', '--language', lang, '--path', dir]);
    assert.strictEqual(r.status, 1, 'learn into a non-list must fail\n' + both(r));
    assert.ok(/capabilities/.test(both(r)) && !JS_ERROR.test(both(r)), both(r));
    assert.ok(lang === 'en' ? !/[가-힣]/.test(both(r)) : /[가-힣]/.test(both(r)), lang + ' message: ' + both(r));
  }
  assert.strictEqual(fs.readFileSync(store(dir, 'skills', 'str-caps', 'skill.json'), 'utf8'), before);
  // skill use counts from zero when there is no count (it saved NaN as null); a count that is not a number and optimizations
  // that are not a list are refused the same way.
  must(run(dir, ['skill', 'use', 'empty-usage', '--path', dir]), 'use empty-usage');
  assert.strictEqual(JSON.parse(fs.readFileSync(store(dir, 'skills', 'empty-usage', 'skill.json'), 'utf8')).usage.count, 1);
  const odd = fs.readFileSync(store(dir, 'skills', 'odd-usage', 'skill.json'), 'utf8');
  for (const [args, field] of [[['skill', 'use', 'odd-usage'], 'usage.count'], [['skill', 'optimize', 'odd-usage', '--note', 'faster'], 'optimizations']]) {
    const r = run(dir, [...args, '--path', dir]);
    assert.strictEqual(r.status, 1, args.join(' ') + ' must fail\n' + both(r));
    assert.ok(both(r).includes('"' + field + '"') && !JS_ERROR.test(both(r)), both(r));
  }
  assert.strictEqual(fs.readFileSync(store(dir, 'skills', 'odd-usage', 'skill.json'), 'utf8'), odd);
  // learn without additions still rewrites the README mirror, whose usage line read the count as text.
  clean(must(run(dir, ['skill', 'learn', 'odd-usage', '--path', dir]), 'learn odd-usage'), 'learn odd-usage');
  clean(fs.readFileSync(store(dir, 'skills', 'odd-usage', 'README.md'), 'utf8'), 'odd-usage README.md');
  // A skill.json that is not a JSON object is not rewritten: with an array root the added fields were dropped on save while
  // success was reported, and text that does not parse was overwritten.
  const files = { 'arr-root': '[]\n', 'bad-json': '{ "name": "bad-json",\n' };
  for (const [id, body] of Object.entries(files)) {
    fs.mkdirSync(store(dir, 'skills', id), { recursive: true });
    fs.writeFileSync(store(dir, 'skills', id, 'skill.json'), body);
    for (const [args, lang] of [[['skill', 'learn', id, '--capability', 'zebra import'], 'ko'], [['skill', 'use', id], 'en'], [['skill', 'optimize', id, '--note', 'faster'], 'ko']]) {
      const r = run(dir, [...args, '--language', lang, '--path', dir]);
      assert.ok(r.status === 1 && (lang === 'en' ? /JSON object/ : /JSON 객체/).test(both(r)) && !JS_ERROR.test(both(r)), args.join(' ') + '\n' + both(r));
    }
    assert.strictEqual(fs.readFileSync(store(dir, 'skills', id, 'skill.json'), 'utf8'), body, id + ' was rewritten');
  }
});

test('counts from values that are not lists or numbers show as zero', () => {
  const dir = project();
  skill(dir, 'str-caps', { displayNameKo: '문자열 능력', capabilities: 'zebra export', usage: { count: 1 } });
  skill(dir, 'odd-usage', { displayNameKo: '사용 기록', capabilities: ['zebra export'], usage: { count: { n: 1 }, lastUsed: { at: 'x' } }, optimizations: 'none' });
  const out = {
    brainstorm: must(run(dir, ['brainstorm', 'zebra', '--path', dir]), 'brainstorm'),
    retro: must(run(dir, ['retro', '--path', dir]), 'retro'),
    insights: must(run(dir, ['insights', '--path', dir]), 'insights'),
    info: must(run(dir, ['skill', 'info', 'odd-usage', '--path', dir]), 'skill info'),
  };
  must(run(dir, ['roadmap', '--path', dir]), 'roadmap');
  out.roadmap = fs.readFileSync(path.join(dir, 'roadmap.html'), 'utf8');
  for (const [label, text] of Object.entries(out)) clean(text, label);
  // Not the 12 letters of "zebra export", and a count that is not a number counts as 0 (not "1[object Object]").
  assert.ok(out.brainstorm.includes('str-caps (문자열 능력) · 사용 1회 · cap 0'), out.brainstorm);
  assert.ok(out.retro.includes('str-caps: 사용 1회, 최적화 0건, capabilities 0개') && out.retro.includes('odd-usage: 사용 0회, 최적화 0건'), out.retro);
  assert.ok(out.insights.includes('총 스킬 사용: 1회'), out.insights);
  assert.ok(out.info.includes('사용: 0회 / 마지막: -'), out.info);
  assert.ok(out.roadmap.includes('<strong>str-caps</strong> · 문자열 능력 <span class="meta">사용 1회 · cap 0</span>'), 'roadmap.html skill row');
  assert.ok(!out.roadmap.includes('cap 12'), 'roadmap.html counted the letters of a capabilities string');   // board node and skill row
});

test('retro counts a stored count that is not a number as zero, in its order, suggestion and workspace view too', () => {
  const dir = project();
  skill(dir, 'str-count', { displayNameKo: '문자열 횟수', capabilities: ['zebra export'], usage: { count: '3' } });
  skill(dir, 'one-use', { displayNameKo: '한 번', capabilities: ['zebra export'], usage: { count: 1 } });
  const retro = must(run(dir, ['retro', '--path', dir]), 'retro');
  const at = s => retro.indexOf(s);
  assert.ok(at('one-use: 사용 1회') !== -1 && at('one-use: 사용 1회') < at('str-count: 사용 0회') && retro.includes('가장 활발한 스킬 "one-use"'), retro);
  // Alone, the skill with the text count is not suggested as the most used, and the workspace view counts it as 0.
  const lone = project();
  skill(lone, 'str-count', { displayNameKo: '문자열 횟수', capabilities: ['zebra export'], usage: { count: '3' } });
  const alone = must(run(lone, ['retro', '--path', lone]), 'retro alone');
  assert.ok(alone.includes('str-count: 사용 0회') && !alone.includes('가장 활발한 스킬'), alone);
  const ws = must(run(lone, ['retro', '--include', lone, '--path', lone]), 'retro --include');
  assert.ok(ws.includes('📚 top 스킬: str-count (0회)'), ws);
});

test('skill lint and skill impact take a name or description that is not text as missing', () => {
  const dir = project();
  skill(dir, 'obj-id', { name: { en: 'x' }, displayNameKo: { ko: '객체' }, description: 'Use when drawing zebra charts for reports', capabilities: ['zebra export'] });
  skill(dir, 'obj-desc', { displayNameKo: '설명 객체', description: { en: 'zebra export' }, capabilities: ['zebra export'] });
  // lint checked an object name as the text "[object Object]", and passed an object description as 15 characters of text.
  const idLint = run(dir, ['skill', 'lint', 'obj-id', '--path', dir]);
  clean(both(idLint), 'lint obj-id');
  assert.strictEqual(idLint.status, 0, both(idLint));
  const descLint = run(dir, ['skill', 'lint', 'obj-desc', '--json', '--path', dir]);
  assert.deepStrictEqual(JSON.parse(String(descLint.stdout)).results[0].errors.map(e => e.code), ['description_missing'], both(descLint));
  // impact counted uses under an object id, so a skill whose name is not text never showed as used.
  must(run(dir, ['skill', 'match', 'zebra', '--path', dir]), 'skill match');
  const impact = must(run(dir, ['skill', 'impact', '--path', dir]), 'skill impact');
  clean(impact, 'skill impact');
  assert.ok(/× obj-id obj-id/.test(impact), impact);
  const ij = json(run(dir, ['skill', 'impact', '--path', dir, '--json']), 'skill impact --json');
  assert.ok(ij.skills.every(s => typeof s.id === 'string' && typeof s.name === 'string'), JSON.stringify(ij.skills));
});

test('generated files hold text only, and the export description still prefers description', () => {
  const dir = project();
  for (const [id, fields] of Object.entries(SKILLS)) skill(dir, id, fields);
  skill(dir, 'described', { displayNameKo: '설명 있음', description: 'Use when drawing zebra charts', capabilities: ['zebra export'] });
  for (const args of [['skill', 'export', 'obj-desc'], ['skill', 'export-all'], ['skill', 'publish'], ['skill', 'learn', 'obj-name'], ['skill', 'learn', 'objitem-caps'],
    ['roadmap'], ['skill', 'match', 'zebra']]) must(run(dir, [...args, '--path', dir]), args.join(' '));
  // Only what these commands write: exported/published bundles, skill READMEs, the roadmap page, the match history.
  const files = [path.join(dir, 'roadmap.html'), store(dir, 'skill-suggestions.md')].filter(f => fs.existsSync(f));
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(md|json)$/.test(e.name) && e.name !== 'skill.json') files.push(p); } };   // skill.json is the malformed input itself
  for (const d of ['skills-export', 'skills-publish', 'skills']) walk(store(dir, d));
  for (const want of [store(dir, 'skills-export', 'obj-desc', 'SKILL.md'), store(dir, 'skills-publish', 'manifest.json'), store(dir, 'skills', 'obj-name', 'README.md'), path.join(dir, 'roadmap.html')]) {
    assert.ok(files.includes(want), 'missing generated file ' + want);
  }
  for (const f of files) clean(fs.readFileSync(f, 'utf8'), path.relative(dir, f));
  const desc = f => (fs.readFileSync(f, 'utf8').match(/^description: (.*)$/m) || [])[1];
  assert.strictEqual(desc(store(dir, 'skills-export', 'obj-desc', 'SKILL.md')), '설명 객체');   // description not text → display name
  assert.strictEqual(desc(store(dir, 'skills-export', 'described', 'SKILL.md')), 'Use when drawing zebra charts');
  const manifest = JSON.parse(fs.readFileSync(store(dir, 'skills-publish', 'manifest.json'), 'utf8'));
  assert.deepStrictEqual(manifest.skills.filter(s => s.id === 'obj-name').map(s => s.name), ['obj-name']);
});

test('--json keeps the stored values', () => {
  const dir = project();
  for (const [id, fields] of Object.entries(SKILLS)) skill(dir, id, fields);
  skill(dir, 'str-count', { displayNameKo: '문자열 횟수', capabilities: ['zebra export'], usage: { count: '3' } });
  // retro and insights report each skill's stored count; only the total counts numbers (2 + 1 + 1 + 1, not "3" appended).
  for (const cmd of ['retro', 'insights']) {
    const j = json(run(dir, [cmd, '--path', dir, '--json']), cmd + ' --json');
    const data = j.data || j;
    assert.deepStrictEqual([data.skillUsage.filter(s => s.id === 'str-count').map(s => s.count), data.totalSkillUsage], [['3'], 5], cmd);
  }
  const b = json(run(dir, ['brainstorm', 'zebra', '--path', dir, '--json']), 'brainstorm --json');
  assert.deepStrictEqual(b.hits.skills.filter(s => s.id === 'obj-name').map(s => s.displayNameKo), [{ ko: '얼룩말' }]);
  const info = json(run(dir, ['skill', 'info', 'objitem-caps', '--path', dir, '--json']), 'skill info --json');
  assert.deepStrictEqual(info.capabilities, [{ k: 'zebra' }, 'zebra export']);
  constraints(dir, { acme: { aliases: ['acmepay'], docs: { url: 'https://acme.example' }, constraints: [{ kind: 'cost', detail: { ko: '월 100건' } }] } });
  const list = json(run(dir, ['constraints', 'list', '--path', dir, '--json']), 'constraints list --json');
  assert.deepStrictEqual([list.platforms.acme.docs, list.platforms.acme.constraints[0].detail, list.corruptStore], [{ url: 'https://acme.example' }, { ko: '월 100건' }, undefined]);
});

test('platform-constraints.json values that are not text print as nothing', () => {
  const dir = project();
  constraints(dir, { acme: { aliases: ['acmepay'], docs: { url: 'x' }, constraints: [{ kind: { k: 1 }, detail: '분당 60회' }, { kind: 'auth' }, { kind: 'cost', detail: { ko: 'x' } }] } });
  for (const args of [['constraints', 'list'], ['constraints', 'check', 'acmepay'], ['review-request', 'acmepay']]) clean(must(run(dir, [...args, '--path', dir]), args.join(' ')), args.join(' '));
  const check = must(run(dir, ['constraints', 'check', 'acmepay', '--path', dir]), 'check');
  assert.ok(/분당 60회/.test(check) && /\[auth\]/.test(check) && /\[cost\]/.test(check), check);
  // A platform written without a constraints list is valid, and add starts the list (it crashed on the missing list).
  constraints(dir, { bolt: { aliases: ['boltpay'], docs: 'https://bolt.example' } });
  must(run(dir, ['constraints', 'add', 'bolt', '--constraint', 'cost:per call', '--path', dir]), 'add to a platform without constraints');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(store(dir, 'platform-constraints.json'), 'utf8')).platforms.bolt.constraints, [{ kind: 'cost', detail: 'per call' }]);
});

test('malformed platform-constraints.json entries are reported as an invalid store instead of crashing', () => {
  const shapes = {
    'constraints is an object': { acme: { aliases: ['acmepay'], constraints: { kind: 'rate-limit', detail: 'x' } } },
    'aliases is a string': { acme: { aliases: 'acmepay', constraints: [{ kind: 'cost', detail: 'x' }] } },
    'a platform is null': { acme: null },
    'a constraint is null': { acme: { aliases: ['acmepay'], constraints: [null, { kind: 'cost', detail: 'x' }] } },
    'an alias is not text': { acme: { aliases: [7], constraints: [] } },
  };
  for (const [label, platforms] of Object.entries(shapes)) {
    const dir = project();
    constraints(dir, platforms);
    const before = fs.readFileSync(store(dir, 'platform-constraints.json'), 'utf8');
    for (const args of [['constraints', 'list'], ['constraints', 'check', 'acmepay']]) {
      const out = must(run(dir, [...args, '--path', dir]), label + ': ' + args.join(' '));
      clean(out, label + ': ' + args.join(' '));
      assert.ok(/platform-constraints\.json 손상/.test(out), label + ': ' + args.join(' ') + ' does not report the invalid store\n' + out);
    }
    clean(must(run(dir, ['review-request', 'acmepay', '--path', dir]), label + ': review-request'), label + ': review-request');
    assert.strictEqual(json(run(dir, ['constraints', 'list', '--path', dir, '--json']), label + ': list --json').corruptStore, true, label);
    const add = run(dir, ['constraints', 'add', 'acme', '--constraint', 'cost:x', '--path', dir]);
    assert.strictEqual(add.status, 1, label + ': add must refuse\n' + both(add));
    assert.strictEqual(fs.readFileSync(store(dir, 'platform-constraints.json'), 'utf8'), before, label + ': file changed');
  }
  // More inputs reach the damaged-store notes now, so they follow the project language too.
  const dir = project();
  constraints(dir, shapes['aliases is a string']);
  const add = run(dir, ['constraints', 'add', 'acme', '--constraint', 'cost:x', '--language', 'en', '--path', dir]);
  assert.ok(add.status === 1 && /damaged/.test(both(add)) && !/[가-힣]/.test(both(add)), both(add));
  const note = json(run(dir, ['constraints', 'list', '--json', '--language', 'en', '--path', dir]), 'list --json en').note;
  assert.ok(/damaged/.test(note) && !/[가-힣]/.test(note), note);
});

test('the graph page reads skill fields as text', () => {
  // leerness.html keys skill nodes by id: two object ids became one node "skill:[object Object]" and one skill vanished.
  const dir = project();
  skill(dir, 'g-one', { id: { x: 1 }, displayNameKo: '그래프 하나', category: { c: 1 }, summary: ['a', 'b'], capabilities: ['zebra export'] });
  skill(dir, 'g-two', { id: { x: 2 }, displayNameKo: '그래프 둘', capabilities: ['zebra export'] });
  // Ids are kept as written: folding control characters made "a<newline>b" and "a b" one node.
  skill(dir, 'g-nl', { id: 'a' + String.fromCharCode(10) + 'b', displayNameKo: '줄바꿈 id', capabilities: ['zebra export'] });
  skill(dir, 'g-sp', { id: 'a b', displayNameKo: '공백 id', capabilities: ['zebra export'] });
  must(run(dir, ['graph', '--html', '--path', dir]), 'graph --html');
  const html = fs.readFileSync(path.join(dir, 'leerness.html'), 'utf8');
  assert.ok(html.includes('skill:g-one') && html.includes('skill:g-two'), 'both skill nodes');
  assert.strictEqual((html.match(/"id":"skill:/g) || []).length, 4, 'one graph node per skill');
  assert.ok(!html.includes('[object Object]'), 'leerness.html printed an object');
});

test('review-request prints store text without control characters', () => {
  const dir = project();
  const ESC = String.fromCharCode(27), BEL = String.fromCharCode(7);
  skill(dir, 'kite-kit', { displayNameKo: 'kite' + ESC + '[2J name', capabilities: ['kite'] });
  fs.appendFileSync(store(dir, 'reuse-map.md'), '\n\n| Kite ' + ESC + '[31m renderer | lib/kite' + BEL + '.js | helper | - |\n');
  constraints(dir, { kiteco: { aliases: ['kite'], docs: 'https://k' + ESC + '.example', constraints: [{ kind: 'cost', detail: 'kite ' + ESC + '[1A limit' }] } });
  fs.appendFileSync(store(dir, 'decisions.md'), '\n### 2026-09-30 — kite ' + ESC + '[2K decision\n- Decision: kite\n');
  fs.appendFileSync(store(dir, 'plan.md'), '\n### M-9001. kite ' + ESC + '[2J milestone\nStatus: in-progress\n');
  fs.appendFileSync(store(dir, 'feature-graph.md'), '\n## F-0901 kite ' + ESC + '[1K feature\n- files: lib/kite.js\n');
  // task add already writes control characters as spaces, so the escape reaches the tracker only by a hand edit of the row.
  must(run(dir, ['task', 'add', 'kite task', '--status', 'in-progress', '--no-review', '--path', dir]), 'task add');
  const tracker = fs.readFileSync(store(dir, 'progress-tracker.md'), 'utf8');
  assert.ok(tracker.includes('| kite task |'), tracker);
  fs.writeFileSync(store(dir, 'progress-tracker.md'), tracker.replace('| kite task |', '| kite ' + ESC + '[2J task |'));
  const out = must(run(dir, ['review-request', 'kite', '--ladder', '--path', dir]), 'review-request');
  noControl(out, 'review-request');
  for (const want of ['kite-kit', 'Kite', 'renderer', 'lib/kite', 'limit', 'decision', 'milestone', 'feature', 'task']) assert.ok(out.includes(want), 'missing ' + want + '\n' + out);
});

test('skill list, lint, match, its history file, handoff and skill impact print skill text without control characters', () => {
  // Same values, the skill surfaces: a SKILL.md description, a skill.json display name and a skill.json name.
  const dir = project();
  const ESC = String.fromCharCode(27);
  skill(dir, 'kite-kit', { displayNameKo: 'kite' + ESC + '[2J name', capabilities: ['kite' + ESC + '[1A export'], lastUpdated: '2026' + ESC + '-09-30' });
  skill(dir, 'kite-lint', { name: 'kite' + ESC + '[2J', displayNameKo: 'kite lint', description: 'Use when linting kite charts in reports and exports' });
  skill(dir, 'kite-trail', { name: 'kite' + ESC, displayNameKo: 'kite trail', description: 'Use when linting kite charts in reports and exports' });   // checked as written, not after folding
  const list = must(run(dir, ['skill', 'list', '--path', dir]), 'skill list');
  noControl(list, 'skill list');
  assert.ok(/\| kite-kit \| kite \[2J name \|/.test(list), list);
  fs.mkdirSync(store(dir, 'skills', 'kite-mdname'), { recursive: true });
  fs.writeFileSync(store(dir, 'skills', 'kite-mdname', 'SKILL.md'), '---\nname: kite' + ESC + '[2J\ndescription: Use when linting kite charts in reports and exports\n---\n# kite\n');
  for (const id of ['kite-lint', 'kite-trail', 'kite-mdname']) {   // skill.json and SKILL.md names: each fails the charset check, and the message quotes it
    const lint = run(dir, ['skill', 'lint', id, '--path', dir]);
    noControl(both(lint), 'skill lint ' + id);
    assert.ok(/name_charset/.test(both(lint)), both(lint));
  }
  fs.mkdirSync(store(dir, 'skills', 'kite-md'), { recursive: true });
  fs.writeFileSync(store(dir, 'skills', 'kite-md', 'SKILL.md'), '---\nname: kite-md\ndescription: kite ' + ESC + '[2J chart helper, use when exporting kite charts\n---\n# kite\n');
  must(run(dir, ['task', 'add', 'kite export', '--status', 'in-progress', '--no-review', '--path', dir]), 'task add');
  const outputs = {
    match: must(run(dir, ['skill', 'match', 'kite export', '--path', dir]), 'skill match'),
    handoff: must(run(dir, ['handoff', dir, '--no-record']), 'handoff'),
    impact: must(run(dir, ['skill', 'impact', '--path', dir]), 'skill impact'),
  };
  outputs.history = fs.readFileSync(store(dir, 'skill-suggestions.md'), 'utf8');
  for (const [label, text] of Object.entries(outputs)) noControl(text, label);
  assert.ok(outputs.match.includes('chart helper') && outputs.history.includes('chart helper'), outputs.match);
  assert.ok(/kite-md/.test(outputs.handoff) && /skill: kite-kit \(kite/.test(outputs.handoff), outputs.handoff);
  assert.ok(/× kite-kit kite/.test(outputs.impact), outputs.impact);
});

test('a skill pack whose values are not text installs cleanly: skill add and the init skill index', () => {
  const dir = project();
  const pack = path.join(arena, 'pack' + (++seq)); fs.mkdirSync(pack);
  fs.writeFileSync(path.join(pack, 'catalog.json'), JSON.stringify({ name: 'pack', version: '1.0.0', skills: [
    { id: 'odd-pack', displayNameKo: { ko: '팩' }, capabilities: 'zebra export', lastUpdated: '2026-09-30', verification: 'unverified' }] }, null, 2));
  const withPack = { LEERNESS_SKILLPACK_PATH: path.join(pack, 'catalog.json') };
  const r = run(dir, ['skill', 'add', 'odd-pack', '--path', dir], withPack);
  clean(must(r, 'skill add'), 'skill add');
  clean(fs.readFileSync(store(dir, 'skills', 'odd-pack', 'README.md'), 'utf8'), 'README.md');
  // init writes the catalog into .leerness/skill-index.md — a capabilities string crashed it.
  const fresh = path.join(arena, 'fresh' + (++seq)); fs.mkdirSync(fresh);
  fs.writeFileSync(path.join(fresh, 'package.json'), '{"name":"fresh","version":"0.1.0"}\n');
  clean(must(run(fresh, ['init', fresh, '--yes', '--language', 'ko', '--no-setup-agents', '--no-mcp'], withPack), 'init with the pack'), 'init with the pack');
  const index = fs.readFileSync(store(fresh, 'skill-index.md'), 'utf8');
  clean(index, 'skill-index.md');
  assert.ok(/^\| odd-pack \| {2}\| {2}\| 2026-09-30 \| unverified \|$/m.test(index), index);
});

console.log(`Tests: ${passed}/${passed + failed} passed`);
try { removeTree(arena, { recursive: true, force: true }); } catch {}
process.exitCode = failed ? 1 : 0;
