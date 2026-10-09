'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-context-current-'));
  try {
    const env = { ...process.env, CONTEXT_PROBE_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 240000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');
    if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-context-current-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.CONTEXT_PROBE_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const current = require('../lib/context-current');
const sample = '한글 English 日本語 e\u0301 🐝';
const header = '# Progress\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n';
const row = (id, status, request = sample, updated = '2026-09-22') => `| ${id} | ${status} | ${request} | source-${id} | next-${id} | ${updated} |\n`;
const tracker = header + row('T-0001', 'in-progress') + row('T-0002', 'done');
const rules = '# Rules\nCustom read instruction: keep this intact.\n| R-0001 | every-round | ' + sample + ' | today | active | - |\n';
const legacy = '---\r\ncustom: preserved\r\n---\r\n# User handoff\r\nDo not deploy without approval.\r\n' + sample + '\r\n';
let sequence = 0, passed = 0, failed = 0;
const filterAt = process.argv.indexOf('--match'), filter = filterAt < 0 ? '' : process.argv[filterAt + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
function fixture(values = {}) {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  const files = { HARNESS_VERSION: require('../package.json').version, LANGUAGE: 'en', 'progress-tracker.md': tracker, 'rules.md': rules, 'session-handoff.md': legacy, 'current-state.md': '# State\n## Now\nUser now\n## Next\nUser next\n## Blockers\nUser hold\n## Notes\n' + sample, 'task-log.md': '# Log\n', 'review-evidence.md': '# Evidence\nkeep this source\n', ...values };
  for (const [name, value] of Object.entries(files)) if (value !== null) fs.writeFileSync(path.join(ws, name), value);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'context-fixture', version: '1.0.0' }));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Explicit user read instructions remain authoritative.');
  return { dir, ws, file: name => path.join(ws, name) };
}
function state(file) { const s = fs.statSync(file, { bigint: true });return { sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(s.mtimeNs) }; }
function tree(dir) { return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(e => [e.name, e.isDirectory() ? tree(path.join(dir, e.name)) : state(path.join(dir, e.name))]); }
const hook = path.join(arena, 'read-boundary.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),cp=require('child_process'),path=require('path'),mode=process.env.CONTEXT_READ_MODE;
const forbidden=p=>typeof p==='string'&&(/[/\\]archive[/\\]/.test(p)||(mode==='metadata'&&/[/\\]\.leerness[/\\].*\.md$/.test(p)));
for(const name of ['readFileSync','openSync']){const original=fs[name];fs[name]=function(p,...args){if(forbidden(p))throw Error('Forbidden history/body read: '+p);return original.call(fs,p,...args);};}
cp.spawnSync=()=>{throw Error('Unexpected child process');};
if(mode==='changed'){const mod=require(path.join(process.env.CONTEXT_LIB,'memory-input')),capture=mod.captureCheckedFileInput;let fired=false;mod.captureCheckedFileInput=function(p,o){const value=capture(p,o);if(!fired&&p.endsWith('progress-tracker.md')){fired=true;fs.appendFileSync(p,'\nConcurrent source winner\n');}return value;};}
`);
function call(f, args, { human = false, mode = '', positional = false, cwd = f.dir } = {}) {
  const r = cp.spawnSync(process.execPath, [...(mode ? ['--require', hook] : []), cli, ...args, ...(positional ? [f.dir] : ['--path', f.dir]), ...(human ? [] : ['--json'])], { cwd, encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, LEERNESS_LANG: 'en', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1', CONTEXT_READ_MODE: mode, CONTEXT_LIB: path.resolve(__dirname, '../lib') } });
  assert.ifError(r.error);return r;
}
function good(r) { assert.strictEqual(r.status, 0, r.stdout + r.stderr);return JSON.parse(r.stdout); }
function bad(r, code) { assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);const data = JSON.parse(r.stdout);if (code) assert.strictEqual(data.code, code);return data; }
test('metadata-only sizes never read document bodies or spawn handoff', () => {
  const f = fixture({ 'session-handoff.md': 'x'.repeat(5 * 1024 * 1024) }), before = tree(f.dir);
  const data = good(call(f, ['context', 'budget', '--files-only'], { mode: 'metadata' }));
  assert.strictEqual(data.files.length, 12);assert.strictEqual(data.over, true);assert.strictEqual(data.archiveBodiesRead, 0);
  assert.strictEqual(data.files.find(x => x.file.endsWith('session-handoff.md')).bytes, 5 * 1024 * 1024);assert.deepStrictEqual(tree(f.dir), before);
});
test('missing files are distinct from unavailable file sizes', () => {
  const f = fixture();fs.mkdirSync(f.file('plan.md'));
  const data = JSON.parse(call(f, ['context', 'budget', '--files-only']).stdout);
  assert.strictEqual(data.ok, false);assert.strictEqual(data.nonRuleBytes, null);assert.strictEqual(data.over, null);
  assert.strictEqual(data.files.find(x => x.file.endsWith('plan.md')).state, 'unavailable');assert.strictEqual(data.files.find(x => x.file.endsWith('guideline.md')).state, 'missing');
});
test('missing harness stays absent on observation', () => {
  const dir = path.join(arena, 'no-harness');fs.mkdirSync(dir);fs.mkdirSync(path.join(dir, '.harness')); // workspace-dir-legacy-fixture
  const f = { dir };const before = tree(dir);bad(call(f, ['context', 'budget', '--files-only']), 'harness_missing');assert.deepStrictEqual(tree(dir), before);
});
test('current view retains full task fields and rules without side effects', () => {
  const f = fixture(), before = tree(f.dir);const data = good(call(f, ['context', 'current']));
  assert.strictEqual(data.rules.text, rules);assert.strictEqual(data.tasks[0].request, sample);assert.strictEqual(data.tasks[0].evidence, 'source-T-0001');
  assert.strictEqual(data.tasks[0].nextAction, 'next-T-0001');assert.strictEqual(data.counts.done, 1);assert.strictEqual(data.navigationOnly, true);
  assert.strictEqual(data.sources[0].sha256, state(f.file('progress-tracker.md')).sha256);assert.deepStrictEqual(tree(f.dir), before);
});
test('large terminal history yields bounded references and full canonical totals', () => {
  const history = Array.from({ length: 1000 }, (_, i) => row(`T-${String(i + 2).padStart(4, '0')}`, 'done', 'Historical narrative '.repeat(8))).join('');
  const f = fixture({ 'progress-tracker.md': header + row('T-0001', 'blocked') + history });
  fs.mkdirSync(path.join(f.ws, 'archive'));fs.writeFileSync(path.join(f.ws, 'archive', 'old.md'), 'Do not read');
  const before = tree(f.dir), data = good(call(f, ['context', 'current'], { mode: 'archive' }));
  assert.strictEqual(data.counts.done, 1000);assert.strictEqual(data.history.shown, 10);assert.strictEqual(data.history.omitted, 990);assert.strictEqual(data.tasks[0].status, 'blocked');
  assert.strictEqual(data.history.references[0].id, 'T-1001');assert.ok(!JSON.stringify(data).includes('Historical narrative'));assert.deepStrictEqual(tree(f.dir), before);
});
test('explicit completed task selection returns its complete evidence and next action', () => {
  const f = fixture();const data = good(call(f, ['context', 'current', '--task', 'T-0002']));assert.strictEqual(data.tasks.length, 1);assert.strictEqual(data.tasks[0].evidence, 'source-T-0002');assert.strictEqual(data.history.shown, 0);
});
test('terminal aliases are counted and unknown statuses remain active', () => {
  const f = fixture({ 'progress-tracker.md': header + row('T-0001', 'completed') + row('T-0002', 'cancelled') + row('T-0003', 'needs-owner') });
  const data = good(call(f, ['context', 'current']));assert.strictEqual(data.counts.done, 1);assert.strictEqual(data.counts.dropped, 1);assert.strictEqual(data.counts.other, 1);assert.deepStrictEqual(data.tasks.map(t => t.id), ['T-0003']);
});
test('overflow keeps all required task and rule text', () => {
  const long = sample.repeat(1000), f = fixture({ 'progress-tracker.md': header + row('T-0001', 'waiting', long), 'rules.md': rules + long });
  const data = good(call(f, ['context', 'current']));assert.strictEqual(data.size.over, true);assert.strictEqual(data.size.truncated, false);assert.strictEqual(data.tasks[0].request, long);assert.strictEqual(data.rules.text, rules + long);
});
for (const value of ['0', '51', '-1', '1.5', 'banana']) test('invalid recent limit is rejected: ' + value, () => {
  const f = fixture(), before = tree(f.dir);bad(call(f, ['context', 'current', '--limit', value]), value === '-1' ? 'invalid_context_option' : 'invalid_limit');assert.deepStrictEqual(tree(f.dir), before);
});
test('reference limit and positional project selection are honored', () => {
  const f = fixture(), data = good(call(f, ['context', 'current', '--limit', '1'], { positional: true, cwd: arena }));assert.strictEqual(data.root, f.dir);assert.strictEqual(data.history.shown, 1);
});
test('unknown task and invalid task IDs never widen scope', () => {
  const f = fixture();bad(call(f, ['context', 'current', '--task', 'T-9999']), 'task_not_found');bad(call(f, ['context', 'current', '--task', '../elsewhere']), 'invalid_task');
});
test('missing or repeated task and limit values do not silently widen scope', () => {
  const f = fixture();for (const flags of [['--task'], ['--task='], ['--limit'], ['--limit', '1', '--limit', '2'], ['--task', 'T-0001', '--task', 'T-0002']]) {
    const result = bad(call(f, ['context', 'current', ...flags]));assert.ok(['missing_flag_value', 'invalid_context_option'].includes(result.code));
  }
});
for (const name of ['progress-tracker.md', 'rules.md']) test('invalid UTF-8 refuses current view: ' + name, () => {
  const f = fixture();fs.appendFileSync(f.file(name), Buffer.from([0xff]));const before = tree(f.dir);bad(call(f, ['context', 'current']), 'E_TEXT_ENCODING');assert.deepStrictEqual(tree(f.dir), before);
});
test('oversized source fails instead of truncating rules', () => {
  const f = fixture({ 'rules.md': 'x'.repeat(4 * 1024 * 1024 + 1) });bad(call(f, ['context', 'current']), 'E_STORE_LIMIT');
});
test('missing required rules fail rather than implying no rules', () => {
  const f = fixture({ 'rules.md': null });bad(call(f, ['context', 'current']), 'context_source_missing');
});
test('duplicate and malformed task rows refuse misleading totals', () => {
  for (const extra of [row('T-0001', 'done'), '| T-0003 | broken |\n']) { const f = fixture({ 'progress-tracker.md': tracker + extra });bad(call(f, ['context', 'current']), 'context_source_invalid'); }
});
test('source changes during capture fail without overwriting the winner', () => {
  const f = fixture();bad(call(f, ['context', 'current'], { mode: 'changed' }), 'E_STORE_CHANGED');assert.ok(fs.readFileSync(f.file('progress-tracker.md'), 'utf8').includes('Concurrent source winner'));
});
test('source digest changes after an actual rule edit', () => {
  const f = fixture(), first = good(call(f, ['context', 'current']));fs.appendFileSync(f.file('rules.md'), '\nChanged constraint\n');const second = good(call(f, ['context', 'current']));assert.notStrictEqual(first.sources[1].sha256, second.sources[1].sha256);
});
test('human output exposes required reads, full rules and overflow', () => {
  const f = fixture({ 'rules.md': rules.repeat(200) });const r = call(f, ['context', 'current'], { human: true });assert.strictEqual(r.status, 0);assert.ok(r.stdout.includes('OVER'));assert.ok(r.stdout.includes('Explicit') || r.stdout.includes('AGENTS.md'));assert.ok(r.stdout.includes(rules.repeat(200)));
});
test('handoff preserves old frontmatter and custom prose across repeated updates', () => {
  const first = current.updateHandoff(legacy, '# Session Handoff\nfirst\n', 'fixture');
  const second = current.updateHandoff(first, '# Session Handoff\nsecond\n', 'fixture');
  assert.ok(second.startsWith(legacy.split('# User')[0]));assert.ok(second.endsWith(legacy.slice(legacy.indexOf('# User'))));
  assert.strictEqual((second.match(/current-handoff:start/g) || []).length, 1);assert.ok(!second.includes('first\n'));assert.ok(second.includes('second\n'));
});
test('malformed ownership markers fail without guessing their scope', () => {
  for (const value of ['<!-- leerness:current-handoff:start -->\n', '<!-- leerness:current-handoff:end -->\n<!-- leerness:current-handoff:start -->', 'inline <!-- leerness:current-handoff:start -->\n<!-- leerness:current-handoff:end -->']) assert.throws(() => current.updateHandoff(value, 'new', 'fixture'), { code: 'E_TEXT_FORMAT' });
});
test('reserved markers in generated user input are rejected', () => {
  assert.throws(() => current.updateHandoff('', '<!-- leerness:current-handoff:start -->', 'fixture'), { code: 'E_TEXT_FORMAT' });
});
test('markers in code examples or metadata are not treated as owned prose', () => {
  const marked = '<!-- leerness:current-handoff:start -->\nexample\n<!-- leerness:current-handoff:end -->\n';
  for (const input of ['```md\n' + marked + '```\n', '~~~\n' + marked + '~~~\n', '---\n' + marked + '---\n']) assert.throws(() => current.updateHandoff(input, 'new', 'fixture'), { code: 'E_TEXT_FORMAT' });
});
test('session close limits generated history while keeping canonical tasks and user prose', () => {
  const history = Array.from({ length: 45 }, (_, i) => row(`T-${String(i + 10).padStart(4, '0')}`, i % 2 ? 'done' : 'dropped', 'OLD_NARRATIVE_' + i)).join('');
  const f = fixture({ 'progress-tracker.md': tracker + row('T-0003', 'planned') + row('T-0004', 'requested') + row('T-0005', 'needs-owner') + history });
  const original = state(f.file('progress-tracker.md'));
  const first = good(call(f, ['session', 'close', '--no-suggest', '--no-record']));
  assert.strictEqual(first.historyReferences.done.shown, 10);assert.strictEqual(first.historyReferences.dropped.shown, 10);
  assert.strictEqual(first.contextReading.mode, 'metadata-only');assert.deepStrictEqual(state(f.file('progress-tracker.md')), original);
  let handoff = fs.readFileSync(f.file('session-handoff.md'), 'utf8');assert.ok(!handoff.includes('OLD_NARRATIVE_'));assert.ok(handoff.includes('T-0003'));assert.ok(handoff.includes('T-0004'));assert.ok(handoff.includes('T-0005'));assert.ok(handoff.endsWith(legacy.slice(legacy.indexOf('# User'))));
  good(call(f, ['session', 'close', '--no-suggest', '--no-record']));handoff = fs.readFileSync(f.file('session-handoff.md'), 'utf8');
  assert.strictEqual((handoff.match(/current-handoff:start/g) || []).length, 1);assert.deepStrictEqual(state(f.file('progress-tracker.md')), original);
  const cs = fs.readFileSync(f.file('current-state.md'), 'utf8');for (const value of ['User now', 'User next', 'User hold', sample]) assert.ok(cs.includes(value));
});
test('close human output references full terminal totals without full historical requests', () => {
  const f = fixture({ 'progress-tracker.md': header + row('T-0001', 'done', 'UNIQUE_OLD_REQUEST') });const r = call(f, ['session', 'close', '--no-suggest', '--no-record'], { human: true });assert.strictEqual(r.status, 0, r.stdout + r.stderr);assert.ok(r.stdout.includes('1 total'));assert.ok(!r.stdout.includes('UNIQUE_OLD_REQUEST'));
});
console.log(`context-current: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
