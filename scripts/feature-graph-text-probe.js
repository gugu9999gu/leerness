'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-feature-text-'));
  try {
    const env = { ...process.env, FEATURE_TEXT_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 240000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if (r.error) process.stderr.write(r.error.message + '\n');process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-feature-text-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.FEATURE_TEXT_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const sample = '한글 日本語 e\u0301 🐝 \uFFFD';
const original = '\uFEFF---\r\ncustom: keep 한글\r\n---\r\n# My graph\r\n\r\n## Nodes\r\n\r\n' +
  '## F-0001 첫 기능\r\n- depends-on: F-0002\r\n- affects: \r\n- notes: ' + sample + '\r\n  continuation 유지\r\n- custom: preserve\r\n\r\n' +
  '## F-0002 Second\r\n- notes: second\r\n\r\n## User appendix\r\n원문 유지\r\n';
let sequence = 0, passed = 0, failed = 0;
const at = process.argv.indexOf('--match'), filter = at < 0 ? '' : process.argv[at + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
const state = file => [fs.readFileSync(file), fs.statSync(file, { bigint: true }).mtimeNs];
function fixture(bytes = original) {
  const dir = path.join(arena, (++sequence) + '-한글 graph'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'HARNESS_VERSION'), require('../package.json').version);fs.writeFileSync(path.join(ws, 'LANGUAGE'), 'en');
  const file = path.join(ws, 'feature-graph.md');if (bytes !== null) fs.writeFileSync(file, bytes);
  return { dir, ws, file };
}
const hook = path.join(arena, 'feature-hook.cjs');
fs.writeFileSync(hook, `const fs=require('fs'),p=require(${JSON.stringify(path.resolve(__dirname, '../lib/pure-utils'))});
const parse=p._parseFeatureGraph,block=p._featureBlock,mode=process.env.FEATURE_TEXT_MODE,target=process.env.FEATURE_TEXT_TARGET;let fired=false;
const compete=()=>fs.writeFileSync(target,Buffer.from(process.env.FEATURE_TEXT_WINNER,'base64'));
p._parseFeatureGraph=function(text){const out=parse(text);if(!fired&&['after-parse','delete-after-parse'].includes(mode)){fired=true;if(mode==='after-parse')compete();else fs.unlinkSync(target);}return out;};
p._featureBlock=function(node){const out=block(node);return mode==='bad-output'?out+String.fromCharCode(0xd800):mode==='large-output'?out+'x'.repeat(4*1024*1024):out;};
const o=require(${JSON.stringify(path.resolve(__dirname, '../lib/memory-output'))}),publish=o.publishMemoryOutput;
o.publishMemoryOutput=function(snapshot,file,bytes){if(file===target){if(mode==='before-publication')compete();if(mode==='publish-error')throw Object.assign(Error('Injected publication failure'),{code:'E_FEATURE_TEST'});if(mode==='after-publication-error'){const before=fs.readFileSync(file);publish(snapshot,file,bytes);const backupFile=file+'.recovery';fs.writeFileSync(backupFile,before);throw Object.assign(Error('Injected failure after publication'),{code:'E_FEATURE_AFTER_PUBLISH',outputMutationStarted:true,outputPublished:true,backupFile,recoveryArtifacts:[{role:'displaced-original',path:backupFile}]});}}return publish(snapshot,file,bytes);};
`);
function call(f, args, mode = '', winner = original + 'concurrent author\n', json = true) {
  const r = cp.spawnSync(process.execPath, [...(mode ? ['--require', hook] : []), cli, 'feature', ...args, '--path', f.dir, ...(json ? ['--json'] : [])], {
    cwd: f.dir, encoding: 'utf8', timeout: 45000, windowsHide: true, env: { ...process.env,
      LEERNESS_INTERNAL: '1', LEERNESS_HOOK: '', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
      FEATURE_TEXT_MODE: mode, FEATURE_TEXT_TARGET: f.file, FEATURE_TEXT_WINNER: Buffer.from(winner).toString('base64') }
  });assert.ifError(r.error);return r;
}
function success(r) { assert.strictEqual(r.status, 0, r.stdout + r.stderr); }
function reject(r) { assert.notStrictEqual(r.status, 0, 'unexpected success: ' + r.stdout + r.stderr);assert.ok(!/feature added:|링크 \d+건 추가/.test(r.stderr)); }
for (const args of [['add', 'New'], ['link', 'F-0001', '--affects', 'F-0002']]) test('repro invalid graph bytes are rejected without rewriting: ' + args[0], () => {
  const f = fixture(Buffer.concat([Buffer.from(original), Buffer.from([0xff])])), before = state(f.file);
  reject(call(f, args));assert.deepStrictEqual(state(f.file), before);
});
test('repro adding preserves all existing prose, signature and line endings', () => {
  const f = fixture();success(call(f, ['add', '새 기능']));const saved = fs.readFileSync(f.file, 'utf8');
  assert.ok(saved.startsWith(original));const listed = JSON.parse(call(f, ['list']).stdout);
  assert.deepStrictEqual(listed.features.map(n => n.id), ['F-0001', 'F-0002', 'F-0003']);assert.strictEqual(listed.features[0].notes, sample);
});
test('repro linking preserves everything outside the requested field', () => {
  const f = fixture();success(call(f, ['link', 'F-0001', '--affects', 'F-0002']));
  assert.strictEqual(fs.readFileSync(f.file, 'utf8'), original.replace('- affects: \r\n', '- affects: F-0002\r\n'));
});
test('repro a source changed after parsing is not overwritten', () => {
  const f = fixture(), winner = original + 'competing change\n';reject(call(f, ['add', 'New'], 'after-parse', winner));
  assert.strictEqual(fs.readFileSync(f.file, 'utf8'), winner);
});
test('repro invalid generated text cannot create an intermediate graph', () => {
  const f = fixture(null);reject(call(f, ['add', 'New'], 'bad-output'));assert.ok(!fs.existsSync(f.file));
});
for (const [name, bytes] of [['truncated sequence', Buffer.from([0xe3, 0x81])], ['UTF-16', Buffer.from([0xff, 0xfe, 0x00, 0x41])], ['over limit', Buffer.alloc(4 * 1024 * 1024 + 1, 32)]]) {
  test('checked source rejects ' + name, () => { const f = fixture(bytes), before = state(f.file);reject(call(f, ['add', 'New']));assert.deepStrictEqual(state(f.file), before); });
}
for (const bytes of [null, original]) for (const mode of ['bad-output', 'large-output', 'publish-error']) {
  test('candidate/publication failure preserves ' + (bytes === null ? 'absence' : 'source') + ': ' + mode, () => {
    const f = fixture(bytes), before = bytes === null ? null : state(f.file);reject(call(f, ['add', 'New'], mode));
    if (before) assert.deepStrictEqual(state(f.file), before);else assert.ok(!fs.existsSync(f.file));
  });
}
for (const args of [['add', 'New'], ['link', 'F-0001', '--affects', 'F-0002']]) {
  test('source replacement at publication preserves the other writer: ' + args[0], () => {
    const f = fixture(), winner = original + 'winner at publication\n';reject(call(f, args, 'before-publication', winner));assert.strictEqual(fs.readFileSync(f.file, 'utf8'), winner);
  });
  test('source deletion after parsing is not undone: ' + args[0], () => {
    const f = fixture();reject(call(f, args, 'delete-after-parse'));assert.ok(!fs.existsSync(f.file));
  });
}
for (const args of [['add', '첫 기능'], ['link', 'F-0001', '--depends-on', 'F-0002'], ['link', 'F-0001']]) {
  test('duplicate/no-op leaves exact bytes and time: ' + args.join(' '), () => {
    const f = fixture(), before = state(f.file);success(call(f, args));assert.deepStrictEqual(state(f.file), before);
  });
}
test('missing graph is created once with a complete node', () => {
  const f = fixture(null);success(call(f, ['add', '새 기능', '--files', 'src/a.js,src/b.js', '--affects', 'F-0099']));
  const list = JSON.parse(call(f, ['list']).stdout);assert.strictEqual(list.total, 1);assert.strictEqual(list.features[0].id, 'F-0001');
  assert.deepStrictEqual(list.features[0].files, ['src/a.js', 'src/b.js']);assert.deepStrictEqual(list.features[0].affects, ['F-0099']);
});
test('link to an absent graph fails without creating it', () => { const f = fixture(null);reject(call(f, ['link', 'F-0001', '--affects', 'F-0002']));assert.ok(!fs.existsSync(f.file)); });
test('uninitialized add leaves no harness directory', () => {
  const dir = path.join(arena, (++sequence) + '-uninitialized');fs.mkdirSync(dir);reject(call({ dir, file: path.join(dir, '.leerness/feature-graph.md') }, ['add', 'New']));assert.deepStrictEqual(fs.readdirSync(dir), []);
});
test('explicit force on an uninitialized add retains the existing creation contract', () => {
  const dir = path.join(arena, (++sequence) + '-forced');fs.mkdirSync(dir);
  const f = { dir, file: path.join(dir, '.leerness/feature-graph.md') };success(call(f, ['add', 'Forced', '--force']));
  assert.strictEqual(JSON.parse(call(f, ['list']).stdout).features[0].title, 'Forced');
});
test('AGENTS-only initialization can create its first graph under a lock', () => {
  const dir = path.join(arena, (++sequence) + '-agents-marker');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Instructions\n');
  const f = { dir, file: path.join(dir, '.leerness/feature-graph.md') };success(call(f, ['add', 'First']));assert.ok(fs.existsSync(f.file));
});
test('forced dry-run cannot create a harness directory for the lock', () => {
  const dir = path.join(arena, (++sequence) + '-force-dry');fs.mkdirSync(dir);
  reject(call({ dir, file: path.join(dir, '.leerness/feature-graph.md') }, ['add', 'First', '--force', '--dry-run']));assert.deepStrictEqual(fs.readdirSync(dir), []);
});
for (const args of [['add', 'New'], ['link', 'F-0001', '--affects', 'F-0002']]) test('dry-run prevents writes: ' + args[0], () => {
  const f = fixture(), before = state(f.file);reject(call(f, [...args, '--dry-run']));assert.deepStrictEqual(state(f.file), before);
});
for (const [name, text] of [['LF', original.replace(/\r\n/g, '\n')], ['CRLF', original], ['mixed', original.replace('custom: keep 한글\r\n', 'custom: keep 한글\n')]]) {
  test('only the selected field changes with ' + name + ' source', () => {
    const f = fixture(text);success(call(f, ['link', 'F-0001', '--depends-on', 'F-0002,F-0003,F-0003']));
    assert.strictEqual(fs.readFileSync(f.file, 'utf8'), text.replace('- depends-on: F-0002', '- depends-on: F-0002, F-0003'));
  });
}
test('missing relationship fields are inserted before notes without replacing the body', () => {
  const raw = '# Source\n## F-0001 Name\n- notes: ' + sample + '\n\n## Appendix\nfree text\n', f = fixture(raw);
  success(call(f, ['link', 'F-0001', '--affects', 'F-0002', '--depends-on', 'F-0003', '--co-changes-with', 'F-0004']));
  const saved = fs.readFileSync(f.file, 'utf8');assert.ok(saved.endsWith('- notes: ' + sample + '\n\n## Appendix\nfree text\n'));
  const node = JSON.parse(call(f, ['show', 'F-0001']).stdout);
  assert.deepStrictEqual([node.dependsOn, node.affects, node.coChangesWith], [['F-0003'], ['F-0002'], ['F-0004']]);
});
test('field case, tab spacing and unrequested duplicates are retained', () => {
  const raw = '## F-0001 Name\n- AFFECTS:\tF-0002\n- affects: custom duplicate\n- notes: Keep\n', f = fixture(raw);
  success(call(f, ['link', 'F-0001', '--affects', 'F-0003']));
  assert.strictEqual(fs.readFileSync(f.file, 'utf8'), raw.replace('- AFFECTS:\tF-0002', '- AFFECTS:\tF-0002, F-0003'));
});
for (const raw of ['', '\uFEFF', '## F-0001 Name', '# custom header without Nodes\n', '## F-0002 Second\n- notes: preserve']) {
  test('append preserves short or nonstandard header: ' + JSON.stringify(raw), () => {
    const f = fixture(raw);success(call(f, ['add', 'New']));assert.ok(fs.readFileSync(f.file, 'utf8').startsWith(raw));
    const list = JSON.parse(call(f, ['list']).stdout);assert.strictEqual(list.features.at(-1).id, raw.includes('F-0001') ? 'F-0002' : 'F-0001');
  });
}
test('impact still follows reverse dependencies and cycles without duplicate results', () => {
  const f = fixture();success(call(f, ['add', 'Third', '--depends-on', 'F-0001', '--affects', 'F-0002']));
  const result = JSON.parse(call(f, ['impact', 'F-0002']).stdout);assert.strictEqual(result.total, 2);
  assert.deepStrictEqual(result.impacted.map(n => n.id).sort(), ['F-0001', 'F-0003']);
});
test('concurrent CLI additions retain both nodes and unique IDs', () => {
  const f = fixture();const source = `const cp=require('child_process');Promise.all(['Concurrent A','Concurrent B'].map(title=>new Promise(resolve=>{const p=cp.spawn(process.execPath,[process.argv[1],'feature','add',title,'--path',process.argv[2],'--json'],{windowsHide:true,env:{...process.env,LEERNESS_INTERNAL:'1',LEERNESS_OFFLINE:'1',LEERNESS_NO_STALE_CHECK:'1',LEERNESS_NO_AUTOCHCP:'1'}});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('error',e=>resolve({code:1,out:String(e)}));p.on('close',code=>resolve({code,out}));}))).then(results=>{console.log(JSON.stringify(results));process.exitCode=results.some(r=>r.code!==0)?1:0;});`;
  const result = cp.spawnSync(process.execPath, ['-e', source, cli, f.dir], { cwd: f.dir, encoding: 'utf8', timeout: 45000, windowsHide: true });
  assert.ifError(result.error);success(result);const list = JSON.parse(call(f, ['list']).stdout);
  assert.strictEqual(list.total, 4);assert.strictEqual(new Set(list.features.map(n => n.id)).size, 4);assert.ok(fs.readFileSync(f.file, 'utf8').startsWith(original));
});
function mcp(f, name, args) {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'feature-text-probe', version: '1' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: { ...args, path: f.dir } } }
  ];
  const r = cp.spawnSync(process.execPath, [cli, 'mcp', 'serve', '--profile', 'full'], { cwd: f.dir, encoding: 'utf8', input: input.map(x => JSON.stringify(x)).join('\n') + '\n', timeout: 45000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_AUTOCHCP: '1' } });
  assert.ifError(r.error);success(r);const response = r.stdout.trim().split(/\r?\n/).map(x => JSON.parse(x)).find(x => x.id === 2);assert.ok(response?.result, r.stdout);return response.result;
}
test('existing MCP add/link use the same checked storage and retain prose', () => {
  const f = fixture();assert.ok(!mcp(f, 'leerness_feature_add', { title: 'MCP new' }).isError);
  assert.ok(fs.readFileSync(f.file, 'utf8').startsWith(original));assert.ok(!mcp(f, 'leerness_feature_link', { id: 'F-0001', affects: 'F-0002' }).isError);
  assert.ok(fs.readFileSync(f.file, 'utf8').startsWith(original.replace('- affects: \r\n', '- affects: F-0002\r\n')));
});
test('MCP rejects malformed source instead of reporting a successful edit', () => {
  const f = fixture(Buffer.from([0xff])), before = state(f.file);assert.strictEqual(mcp(f, 'leerness_feature_add', { title: 'MCP new' }).isError, true);assert.deepStrictEqual(state(f.file), before);
});
test('failure details identify checked source rejection without a saved claim', () => {
  const f = fixture(Buffer.from([0xff]));const r = call(f, ['add', 'New']);reject(r);const error = JSON.parse(r.stdout);
  assert.strictEqual(error.code, 'E_TEXT_ENCODING');assert.strictEqual(error.file, f.file);assert.strictEqual(error.stage, 'read');
});
test('partial publication reports its saved state and recoverable original', () => {
  const f = fixture();const r = call(f, ['add', 'New'], 'after-publication-error');reject(r);const error = JSON.parse(r.stdout);
  assert.strictEqual(error.stage, 'publish');assert.strictEqual(error.outputPublished, true);assert.strictEqual(error.outputMutationStarted, true);
  assert.strictEqual(error.backupFile, f.file + '.recovery');assert.strictEqual(fs.readFileSync(error.backupFile, 'utf8'), original);
  assert.strictEqual(error.recoveryArtifacts[0].path, error.backupFile);assert.ok(fs.readFileSync(f.file, 'utf8').includes('## F-0003 New'));
});
test('human failure output also includes publication state and recovery path', () => {
  const f = fixture();const r = call(f, ['add', 'New'], 'after-publication-error', original, false);reject(r);
  assert.match(r.stdout + r.stderr, /outputPublished.*true/);assert.match(r.stdout + r.stderr, /feature-graph\.md\.recovery/);
});
console.log(`Tests: ${passed}/${passed + failed} passed`);process.exitCode = failed ? 1 : 0;
