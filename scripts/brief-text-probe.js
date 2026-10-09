'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-brief-text-'));
  try {
    const env = { ...process.env, BRIEF_PROBE_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 240000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');
    if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-brief-text-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.BRIEF_PROBE_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const sample = '한글 English 日本語 中文 🐝 e\u0301 \uFFFD';
const brief = '---\nleernessRole: project-brief\ncustom: ' + sample + '\n---\n# Project Brief\n\n## Project\n사용자 프로젝트\n\n## Intro\n이전 소개\n\n## Purpose\n' + sample + '\n\n## Features\n- 첫째 ' + sample + '\n- 둘째\n\n## Direction History\n- 2026-01-01: 이전 방향\n\n## User Notes\n보존 ' + sample + '\n';
const start = '<!-- leerness:project-brief:start -->', end = '<!-- leerness:project-brief:end -->';
const readme = '# Readme\n사용자 소개\n\n' + start + '\nold generated\n' + end + '\n\n## User footer\n' + sample + '\n';
const plan = '# Plan\n\n## Goal\n사용자 목표\n\n## Notes\n' + sample + '\n';
let sequence = 0, passed = 0, failed = 0;
const filterAt = process.argv.indexOf('--match'), filter = filterAt < 0 ? '' : process.argv[filterAt + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
function state(file) { if (!fs.existsSync(file)) return null;const s = fs.statSync(file, { bigint: true });return { sha: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(s.mtimeNs) }; }
function fixture(b = brief, r = readme) {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  for (const [name, value] of Object.entries({ HARNESS_VERSION: require('../package.json').version, LANGUAGE: 'en', 'project-brief.md': b, 'plan.md': plan })) if (value !== null) fs.writeFileSync(path.join(ws, name), value);
  if (r !== null) fs.writeFileSync(path.join(dir, 'README.md'), r);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'brief-test', version: '1.0.0', description: 'Useful ' + sample }));
  return { dir, ws, brief: path.join(ws, 'project-brief.md'), readme: path.join(dir, 'README.md'), plan: path.join(ws, 'plan.md'), out: path.join(dir, '내보내기.md') };
}
const snapshot = f => [f.brief, f.readme, f.plan, f.out].map(state), text = p => fs.readFileSync(p, 'utf8');
const hook = path.join(arena, 'boundary-hook.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),cp=require('child_process'),path=require('path'),target=process.env.BRIEF_TARGET,mode=process.env.BRIEF_MODE,other=process.env.BRIEF_OTHER;
const bytes=Buffer.from(process.env.BRIEF_WINNER,'base64'),write=fs.writeFileSync.bind(fs);let fired=false;
if(process.env.BRIEF_STARTED)write(process.env.BRIEF_STARTED,'started');
const inject=p=>{if(!fired&&p===target){fired=true;write(p,bytes);}};
if(['surrogate','oversize'].includes(mode)){const i=process.argv.indexOf(process.env.BRIEF_FLAG);if(i<0)throw Error('fixture flag missing');process.argv[i+1]=mode==='surrogate'?'\uD800':'a'.repeat(4*1024*1024+1);}
const base=process.env.BRIEF_LIB;
const checked=require(path.join(base,'memory-input')),captureInput=checked.captureCheckedFileInput;
checked.captureCheckedFileInput=function(p,o){const result=captureInput(p,o);if(mode==='source-capture')inject(p);return result;};
const mod=require(path.join(base,'managed-text')),capture=mod.captureTextEdit,publish=mod.publishTextEdit;
mod.captureTextEdit=function(p){if(mode==='before-capture')inject(p);const result=capture(p);if(mode==='after-capture')inject(p);if(mode==='hold'&&p===target){write(process.env.BRIEF_READY,'ready');const end=Date.now()+12000;while(!fs.existsSync(process.env.BRIEF_GO)){if(Date.now()>end)throw Error('holder deadline');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}}return result;};
mod.publishTextEdit=function(e,p,s){const result=publish(e,p,s);if(mode==='between'&&p===other)inject(target);return result;};
const rename=fs.renameSync.bind(fs);fs.renameSync=function(a,b){if(mode==='publication'&&a===target)inject(a);return rename(a,b);};
const open=fs.openSync.bind(fs);fs.openSync=function(p,flags,...args){if(mode==='publication'&&p===target&&flags==='wx')inject(p);return open(p,flags,...args);};
const spawn=cp.spawnSync.bind(cp);cp.spawnSync=function(a,b,o){if(o?.env?.LEERNESS_REPLACE_TO===target){if(mode==='publication')inject(target);const r=spawn(a,b,o);if(mode==='after-publication'&&r.status===0)inject(target);return r;}return spawn(a,b,o);};
const link=fs.linkSync.bind(fs);fs.linkSync=function(a,b){if(mode==='publication')inject(b);const r=link(a,b);if(mode==='after-publication')inject(b);return r;};
`);
// T-0337: the partial-save notes and the memory input and output errors follow the project language of the commands'
// own text. These fixtures carry .leerness/LANGUAGE=en without a manifest, which that rule reads as Korean, so the
// English expectations run with LEERNESS_LANG=en.
function call(f, args, opts = {}) {
  const r = cp.spawnSync(process.execPath, [...(opts.mode ? ['--require', hook] : []), cli, ...args, '--path', f.dir, ...(opts.human ? [] : ['--json'])], { cwd: f.dir, encoding: 'utf8', timeout: 45000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_LANG: 'en',
      BRIEF_LIB: path.resolve(__dirname, '../lib'), BRIEF_MODE: opts.mode || '', BRIEF_TARGET: opts.target || f.brief, BRIEF_OTHER: opts.other || '', BRIEF_FLAG: opts.flag || '', BRIEF_WINNER: Buffer.from(opts.winner || 'competing ' + sample).toString('base64') } });
  assert.ifError(r.error);return r;
}
const success = r => assert.strictEqual(r.status, 0, r.stdout + r.stderr);
const failure = r => { assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);assert.ok(!/"ok"\s*:\s*true/.test(r.stdout));return r; };
function rejectUnchanged(f, args, opts) { const before = snapshot(f), r = failure(call(f, args, opts));assert.deepStrictEqual(snapshot(f), before);return r; }
function retained(dir, bytes) { return fs.readdirSync(dir, { withFileTypes: true }).some(e => { const p = path.join(dir, e.name);return e.isDirectory() ? retained(p, bytes) : e.isFile() && fs.readFileSync(p).equals(bytes); }); }
const set = ['brief', 'set', '--intro', '새 소개 ' + sample], update = ['brief', 'update', '--direction', '새 방향 ' + sample], anchor = ['anchors', 'draft', '--apply'];
test('set refuses malformed brief before either file changes', () => { rejectUnchanged(fixture(Buffer.concat([Buffer.from(brief), Buffer.from([0xff])])), set); });
test('update preflights malformed README before saving the brief', () => { rejectUnchanged(fixture(brief, Buffer.concat([Buffer.from(readme), Buffer.from([0xff])])), update); });
test('set preserves other fields parsed from CRLF', () => {
  const f = fixture(brief.replace(/\n/g, '\r\n'));success(call(f, set));assert.ok(text(f.brief).includes(sample + '\r\n'));assert.ok(text(f.readme).includes('**목적**: ' + sample));
});
test('set retains authored metadata and unknown sections', () => { const f = fixture();success(call(f, set));assert.ok(text(f.brief).startsWith(brief.split('## Project')[0]));assert.ok(text(f.brief).endsWith('## User Notes\n보존 ' + sample + '\n')); });
test('ambiguous README markers are refused before either file changes', () => { rejectUnchanged(fixture(brief, '# Keep\n' + start + '\n' + sample), set); });
test('anchor application refuses malformed brief before writing a purpose', () => { rejectUnchanged(fixture(Buffer.concat([Buffer.from('# Brief\n\n## Purpose\n\n## Notes\n'), Buffer.from([0xff])])), anchor); });
test('export refuses malformed source instead of generating repaired text', () => {
  const f = fixture(Buffer.concat([Buffer.from(brief), Buffer.from([0xff])]));rejectUnchanged(f, ['brief', 'export', '--out', f.out]);
});
test('export refuses malformed existing output before replacing it', () => { const f = fixture();fs.writeFileSync(f.out, Buffer.from([0xff]));rejectUnchanged(f, ['brief', 'export', '--out', f.out]); });
test('set changes only requested sections and keeps valid Unicode and existing signatures', () => {
  const f = fixture('\uFEFF' + brief, '\uFEFF' + readme), suffix = brief.slice(brief.indexOf('## Purpose'));
  success(call(f, set));assert.ok(text(f.brief).startsWith('\uFEFF'));assert.ok(text(f.brief).endsWith(suffix));assert.ok(text(f.readme).startsWith('\uFEFF# Readme\n사용자 소개'));assert.ok(text(f.readme).endsWith('## User footer\n' + sample + '\n'));assert.ok(text(f.readme).includes('새 소개 ' + sample));
});
test('all public fields can be changed without deleting unknown sections', () => {
  const f = fixture(), fields = require('../lib/pure-utils')._BRIEF_FIELDS;
  const args = ['brief', 'set', '--project', sample, ...fields.flatMap(x => ['--' + x.flag, sample])];success(call(f, args));const r = call(f, ['brief', 'show']);success(r);const b = JSON.parse(r.stdout);
  assert.strictEqual(b.project, sample);for (const field of fields) assert.deepStrictEqual(b[field.key], field.multi ? [sample] : sample);assert.ok(text(f.brief).includes('## User Notes\n보존 ' + sample));
});
test('direction update keeps existing CRLF history and other sections', () => {
  const original = brief.replace(/\n/g, '\r\n'), f = fixture(original);success(call(f, update));assert.ok(text(f.brief).startsWith(original.split('## Direction History')[0]));assert.ok(text(f.brief).includes('2026-01-01: 이전 방향'));assert.ok(text(f.brief).includes('새 방향 ' + sample));assert.ok(text(f.readme).includes('이전 방향') && text(f.readme).includes('새 방향 ' + sample));
});
test('new brief uses canonical fields and creates a matching README', () => {
  const f = fixture(null, null);success(call(f, set));assert.ok(text(f.brief).startsWith('---\nleernessRole: project-brief'));assert.ok(text(f.brief).includes('## Non-Goals'));assert.ok(text(f.readme).startsWith('# brief-test\n'));assert.ok(!text(f.brief).startsWith('\uFEFF'));
});
test('README without markers keeps existing content and receives one block', () => {
  const f = fixture(brief, '# Readme\r\n' + sample + '\r\n');success(call(f, set));success(call(f, set));assert.ok(text(f.readme).startsWith('# Readme\r\n' + sample));assert.strictEqual(text(f.readme).split(start).length, 2);assert.strictEqual(text(f.readme).split(end).length, 2);
});
test('existing sections at EOF and explicitly cleared fields remain readable', () => {
  const f = fixture('# Brief\n\n## Intro');success(call(f, set));assert.ok(text(f.brief).includes('## Intro\n새 소개'));assert.strictEqual((text(f.brief).match(/## Intro/g) || []).length, 1);
  success(call(f, ['brief', 'set', '--intro', '']));const r = call(f, ['brief', 'show']);success(r);assert.strictEqual(JSON.parse(r.stdout).intro, '');
});
test('set without fields remains a read-only usage failure', () => { rejectUnchanged(fixture(Buffer.from([0xff])), ['brief', 'set']); });
test('duplicate known brief headings fail before either file changes', () => {
  for (const heading of ['Intro', 'Purpose', 'Project', 'Direction History']) rejectUnchanged(fixture(brief + '\n## ' + heading + '\nextra\n'), set);
});
test('duplicate unknown headings remain authored text', () => { const f = fixture(brief + '\n## User Notes\nMore notes\n');success(call(f, set));assert.ok(text(f.brief).endsWith('\n## User Notes\nMore notes\n')); });
test('duplicate or reversed README markers are rejected unchanged', () => {
  for (const r of [end, end + start, readme + start + end, start + start + end, start + end + end]) rejectUnchanged(fixture(brief, r), update);
});
test('candidate values cannot create ambiguous managed README markers', () => { rejectUnchanged(fixture(), ['brief', 'set', '--intro', start]); });
test('human output and force retain the malformed-input boundary', () => { rejectUnchanged(fixture(Buffer.from([0xff])), [...set, '--force'], { human: true }); });
test('truncated UTF-8 and UTF-16 are rejected without transcoding', () => {
  for (const bad of [Buffer.from([0xe3, 0x81]), Buffer.from([0xff, 0xfe, 0x61, 0])]) { rejectUnchanged(fixture(bad), set);rejectUnchanged(fixture(brief, bad), update); }
});
test('unpaired candidate Unicode is rejected in set and update', () => {
  rejectUnchanged(fixture(), set, { mode: 'surrogate', flag: '--intro' });rejectUnchanged(fixture(), update, { mode: 'surrogate', flag: '--direction' });
});
test('oversized input files and generated output are rejected unchanged', () => {
  const huge = 'a'.repeat(4 * 1024 * 1024 + 1);rejectUnchanged(fixture(huge), set);rejectUnchanged(fixture(brief, huge), update);rejectUnchanged(fixture(), set, { mode: 'oversize', flag: '--intro' });
  const f = fixture();fs.writeFileSync(f.out, huge);rejectUnchanged(f, ['brief', 'export', '--out', f.out]);
});
test('README expansion is rejected before saving a valid brief candidate', () => {
  const f = fixture(brief.replace('이전 소개', '한'.repeat(500000)), '# Readme\n' + 'a'.repeat(3 * 1024 * 1024));rejectUnchanged(f, update);
});
test('hard-linked sources and targets are rejected and their aliases preserved', () => {
  for (const which of ['brief', 'readme', 'out']) { const f = fixture();if (which === 'out') fs.writeFileSync(f.out, sample);const alias = path.join(f.dir, 'alias');fs.linkSync(f[which], alias);const before = state(alias);rejectUnchanged(f, which === 'out' ? ['brief', 'export', '--out', f.out] : set);assert.deepStrictEqual(state(alias), before); }
});
test('directory README is rejected before brief changes', () => { const f = fixture(brief, null);fs.mkdirSync(f.readme);const before = state(f.brief);failure(call(f, set));assert.deepStrictEqual(state(f.brief), before);assert.ok(fs.statSync(f.readme).isDirectory()); });
test('both paired captures reject stale inputs without losing the competitor', () => {
  for (const which of ['brief', 'readme']) { const f = fixture(), other = which === 'brief' ? 'readme' : 'brief', before = state(f[other]);failure(call(f, set, { mode: 'after-capture', target: f[which] }));assert.strictEqual(text(f[which]), 'competing ' + sample);assert.deepStrictEqual(state(f[other]), before); }
});
test('later README conflict reports the already saved brief', () => {
  const f = fixture(), r = failure(call(f, update, { mode: 'between', target: f.readme, other: f.brief }));assert.match(r.stdout + r.stderr, /brief was saved, but README publication failed/);assert.ok(text(f.brief).includes('새 방향 ' + sample));assert.strictEqual(text(f.readme), 'competing ' + sample);
});
test('final paired publication races retain competing bytes and do not report success', () => {
  for (const which of ['brief', 'readme']) { const f = fixture(), before = state(f.readme);const r = failure(call(f, set, { mode: 'publication', target: f[which] }));assert.ok(retained(f.dir, Buffer.from('competing ' + sample)));if (which === 'brief') assert.deepStrictEqual(state(f.readme), before);else assert.match(r.stdout + r.stderr, /not rolled back/); }
});
test('late publication races are failed rather than treated as completed pairs', () => {
  const f = fixture();failure(call(f, set, { mode: 'after-publication' }));assert.ok(retained(f.dir, Buffer.from('competing ' + sample)));
});
test('new README publication respects an independently created file', () => {
  const f = fixture(brief, null), r = failure(call(f, set, { mode: 'publication', target: f.readme }));assert.match(r.stdout + r.stderr, /not rolled back/);assert.strictEqual(text(f.readme), 'competing ' + sample);
});
test('export preserves source files and existing output signature', () => {
  const f = fixture(), before = snapshot(f).slice(0, 3);fs.writeFileSync(f.out, '\uFEFFold');success(call(f, ['brief', 'export', '--out', f.out]));assert.deepStrictEqual(snapshot(f).slice(0, 3), before);assert.ok(text(f.out).startsWith('\uFEFF# 사용자 프로젝트'));assert.ok(text(f.out).includes(sample));
});
test('export creates nested destinations and accepts an explicit relative path', () => {
  const f = fixture(), name = path.join('새 폴더', '소개.md');success(call(f, ['brief', 'export', '--out', name]));assert.ok(text(path.join(f.dir, name)).includes(sample));
});
test('export rechecks its source and target snapshots', () => {
  for (const which of ['brief', 'out']) {
    const f = fixture(), before = snapshot(f);failure(call(f, ['brief', 'export', '--out', f.out], { mode: which === 'brief' ? 'source-capture' : 'after-capture', target: f[which] }));
    assert.strictEqual(text(f[which]), 'competing ' + sample);for (const [i, key] of ['brief', 'readme', 'plan', 'out'].entries()) if (key !== which) assert.deepStrictEqual(state(f[key]), before[i]);
  }
});
test('export final-publication conflicts preserve competing output', () => {
  for (const exists of [false, true]) { const f = fixture(), before = state(f.brief);if (exists) fs.writeFileSync(f.out, 'previous');failure(call(f, ['brief', 'export', '--out', f.out], { mode: 'publication', target: f.out }));assert.deepStrictEqual(state(f.brief), before);assert.ok(retained(f.dir, Buffer.from('competing ' + sample))); }
});
test('export refuses invalid generated project Unicode', () => {
  const f = fixture(null);fs.writeFileSync(path.join(f.dir, 'package.json'), JSON.stringify({ name: '\uD800', version: '1.0.0' }));rejectUnchanged(f, ['brief', 'export', '--out', f.out]);
});
test('anchor application preserves Unicode and notes while keeping other documents unchanged', () => {
  const original = '\uFEFF# Brief\r\n\r\n## Purpose\r\n\r\n## Notes\r\n' + sample + '\r\n', f = fixture(original), before = snapshot(f);success(call(f, anchor));assert.ok(text(f.brief).startsWith('\uFEFF'));assert.ok(text(f.brief).includes('draft: leerness anchors') && text(f.brief).includes('## Notes\n' + sample));assert.deepStrictEqual(snapshot(f).slice(1), before.slice(1));
});
test('anchor stale capture refuses publication but fresh authored content stays a no-op', () => {
  const source = '# Brief\n\n## Purpose\n\n## Notes\n' + sample;
  const f = fixture(source);failure(call(f, anchor, { mode: 'after-capture' }));assert.strictEqual(text(f.brief), 'competing ' + sample);
  const g = fixture(source);success(call(g, anchor, { mode: 'before-capture', winner: brief }));assert.strictEqual(text(g.brief), brief);
});
test('anchor rejects invalid generated Unicode without changing a document', () => {
  const f = fixture('# Brief\n\n## Purpose\n\n## Notes\n' + sample);fs.writeFileSync(path.join(f.dir, 'package.json'), JSON.stringify({ name: 'brief-test', description: '\uD800' }));rejectUnchanged(f, anchor);
});
test('later anchor plan failure reports the already saved brief draft', () => {
  const f = fixture('# Brief\n\n## Purpose\n\n## Notes\n' + sample);fs.writeFileSync(f.plan, Buffer.concat([Buffer.from('# Plan\n\n## Goal\n\n## Notes\n'), Buffer.from([0xff])]));const before = state(f.plan);
  const r = failure(call(f, anchor));assert.match(r.stdout + r.stderr, /brief draft was saved before plan publication failed/);assert.ok(text(f.brief).includes('draft: leerness anchors'));assert.deepStrictEqual(state(f.plan), before);
});
test('anchor no-op and read-only brief views are not general encoding audits', () => {
  const f = fixture(), before = snapshot(f);success(call(f, anchor));success(call(f, ['brief', 'show']));success(call(f, ['brief', 'export']));assert.deepStrictEqual(snapshot(f), before);
});
test('cooperating direction updates retain both entries through canonical locks', () => {
  const f = fixture(), runner = path.join(arena, 'cooperators.cjs');
  fs.writeFileSync(runner, String.raw`
const cp=require('child_process'),fs=require('fs'),path=require('path');
const [cli,hook,dir,lib]=process.argv.slice(2),ready=dir+'-ready',go=dir+'-go',started=dir+'-started';
const children=[];const wait=async file=>{const end=Date.now()+12000;while(!fs.existsSync(file)){if(Date.now()>end)throw Error('coordinator deadline');await new Promise(r=>setTimeout(r,10));}};
const launch=(mode,direction)=>{const c=cp.spawn(process.execPath,['--require',hook,cli,'brief','update','--direction',direction,'--path',dir,'--json'],{windowsHide:true,env:{...process.env,LEERNESS_INTERNAL:'1',LEERNESS_OFFLINE:'1',LEERNESS_NO_AUTOCHCP:'1',LEERNESS_NO_STALE_CHECK:'1',BRIEF_LIB:lib,BRIEF_MODE:mode,BRIEF_TARGET:path.join(dir,'.leerness','project-brief.md'),BRIEF_WINNER:'',BRIEF_READY:ready,BRIEF_GO:go,BRIEF_STARTED:mode==='peer'?started:''}});children.push(c);let output='';c.stdout.on('data',d=>output+=d);c.stderr.on('data',d=>output+=d);return new Promise((resolve,reject)=>{c.on('error',reject);c.on('close',code=>resolve({code,output}));});};
(async()=>{try{const first=launch('hold','first');await wait(ready);const second=launch('peer','second');await wait(started);fs.writeFileSync(go,'go');const results=await Promise.all([first,second]);if(results.some(r=>r.code!==0))throw Error(JSON.stringify(results));console.log('both updates completed');}finally{fs.writeFileSync(go,'go');for(const c of children)if(c.exitCode===null)c.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
`);
  const r = cp.spawnSync(process.execPath, [runner, cli, hook, f.dir, path.resolve(__dirname, '../lib')], { encoding: 'utf8', timeout: 35000, windowsHide: true });assert.ifError(r.error);success(r);
  const b = JSON.parse(call(f, ['brief', 'show']).stdout);assert.strictEqual(b.directionHistory.length, 3);assert.ok(b.directionHistory.some(x => x.endsWith(': first')) && b.directionHistory.some(x => x.endsWith(': second')));assert.ok(text(f.readme).includes(': first') && text(f.readme).includes(': second'));
});
test('dry-run writes remain unsupported and preserve all fixture files', () => {
  const tree = dir => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(e => [e.name, e.isDirectory() ? tree(path.join(dir, e.name)) : state(path.join(dir, e.name))]);
  for (const args of [set, update, ['brief', 'export', '--out', 'out.md'], anchor]) { const f = fixture('# Brief\n\n## Purpose\n\n## Notes\n' + sample), before = tree(f.dir);const r = failure(call(f, [...args, '--dry-run']));assert.strictEqual(JSON.parse(r.stdout).code, 'dry_run_unsupported');assert.deepStrictEqual(tree(f.dir), before); }
});
console.log(`Tests: ${passed}/${passed + failed} passed`);process.exitCode = failed ? 1 : 0;
