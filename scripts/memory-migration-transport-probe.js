'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
const S = require('./memory-migration-test-support');
const { assert, fs, path, test, project, snapshot, command, privateMetadata, legacy } = S;
const adapter = require('../lib/memory-migration-transport');
const call = (id, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'leerness_memory_migration_inspect', arguments: args } });
function rpc(cwd, requests, profile = 'full', prefix = []) {
  const r = command(cwd, ['mcp', 'serve', '--profile', profile], requests.map(r => JSON.stringify(r)).join('\n') + '\n', prefix);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}
const root = project({ 'decisions.md': legacy('decisions'), 'lessons.md': legacy('lessons') });
const empty = project(); fs.rmdirSync(path.join(empty, '.leerness'));
const legacyRoot = project({ 'HARNESS_VERSION': '1.36.100', 'decisions.md': legacy('decisions') }, '.harness'); // workspace-dir-legacy-fixture
const other = project({ 'decisions.json': '{' + S.PRIVATE });
const gitRoot = project({ 'decisions.md': legacy('decisions') });
assert.equal(S.cp.spawnSync('git', ['init', '--quiet', gitRoot], { windowsHide: true }).status, 0);
for (const cwd of [root, empty, legacyRoot, other, gitRoot]) {
  test('whole CLI repeat and rejected commands preserve ' + path.basename(cwd), () => {
    const before = snapshot(S.arena);
    for (const surface of ['decisions', 'lessons']) {
      const args = ['memory-migration', 'inspect', surface, '--path', cwd, '--json'];
      const a = command(empty, args), b = command(empty, args);
      assert([0, 2].includes(a.status), a.stderr); assert.equal(a.stdout, b.stdout);
      const result = JSON.parse(a.stdout); privateMetadata(result);
      if (cwd === root || (cwd === gitRoot && surface === 'decisions')) assert.equal(result.ok, true);
    }
    for (const args of [[], ['inspect'], ['erase', 'decisions'], ['inspect', '../decisions'],
      ['inspect', 'decisions', '--force'], ['inspect', 'lessons', '--path'],
      ['inspect', 'decisions', '--json', '--json'], ['inspect', 'decisions', '--path', cwd, '--path', root]]) {
      const result = command(cwd, ['memory-migration', ...args]);
      assert.equal(result.status, 2); privateMetadata(JSON.parse(result.stdout));
    }
    assert.deepEqual(snapshot(S.arena), before);
  });
  test('whole MCP startup calls and rejection preserve ' + path.basename(cwd), () => {
    const before = snapshot(S.arena);
    const requests = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      call(2, { surface: 'decisions', path: root }), call(3, { surface: 'lessons', path: cwd }),
      call(4, { surface: 'decisions', path: root, payload: S.PRIVATE }),
      call(5, { surface: 'unknown', path: root }), call(6, { surface: 'decisions', path: root })];
    const replies = rpc(cwd, requests), result = id => replies.find(r => r.id === id).result;
    assert.equal(replies.length, 6); assert.equal(result(2).isError, false);
    assert.equal(result(4).isError, true); assert.equal(result(5).isError, true);
    assert.deepEqual(result(2), result(6));
    for (const id of [2, 3, 4, 5, 6]) privateMetadata(JSON.parse(result(id).content[0].text));
    assert.deepEqual(snapshot(S.arena), before);
  });
}
test('MCP schema is read-only, core refuses undisclosed tool', () => {
  const tools = rpc(root, [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }])[0].result.tools;
  const tool = tools.find(t => t.name === 'leerness_memory_migration_inspect');
  assert.equal(tool.requiredTier, 'read-only'); assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal(rpc(root, [call(2, { surface: 'decisions' })], 'core')[0].error.code, -32601);
});
test('MCP direct invalid descriptors do not evaluate caller getters', () => {
  let evaluated = false;
  for (const args of [null, [], {}, { surface: 'decisions', path: '' }, { surface: 'decisions', approval: true },
    { get surface() { evaluated = true; return 'decisions'; } }, { surface: 'decisions', [Symbol('extra')]: true }]) {
    assert.equal(adapter.mcpResult(args).isError, true);
  }
  assert.equal(evaluated, false);
  const inherited = Object.create({ get path() { evaluated = true; return S.PRIVATE; } });
  inherited.surface = 'decisions'; assert.equal(adapter.mcpResult(inherited, root).isError, false);
  assert.equal(evaluated, false);
});
test('actual CLI and MCP discard a candidate when canonical appears during assessment', () => {
  const hook = path.join(S.arena, 'source-race.cjs');
  const moduleFile = path.resolve(__dirname, '../lib/memory-migration-plan.js');
  for (const transport of ['cli', 'mcp']) {
    const target = project({ 'decisions.md': legacy('decisions') });
    const file = path.join(target, '.leerness/decisions.json');
    fs.writeFileSync(hook, `const domain=require(${JSON.stringify(moduleFile)}),original=domain.assessLegacyMemoryMigration;domain.assessLegacyMemoryMigration=text=>{const result=original(text);require('fs').writeFileSync(${JSON.stringify(file)},'[]');return result};\n`);
    const before = snapshot(target);
    const prefix = ['--require', hook];
    let result;
    if (transport === 'cli') {
      const r = command(target, ['memory-migration', 'inspect', 'decisions'], '', prefix);
      assert.equal(r.status, 2); result = JSON.parse(r.stdout);
    } else {
      const r = rpc(target, [call(1, { surface: 'decisions' })], 'full', prefix)[0];
      assert.equal(r.result.isError, true); result = JSON.parse(r.result.content[0].text);
    }
    privateMetadata(result); assert.equal(result.assessment, null); assert.equal(result.sourceRechecked, false);
    assert.equal(fs.readFileSync(file, 'utf8'), '[]');
    const after = snapshot(target);
    assert.equal(after['./.leerness/decisions.md'].hash, before['./.leerness/decisions.md'].hash);
    assert.equal(after['./.leerness/decisions.md'].mtime, before['./.leerness/decisions.md'].mtime);
    assert.deepEqual(Object.keys(after).filter(k => !Object.hasOwn(before, k)), ['./.leerness/decisions.json']);
  }
});
test('help preserves the complete fixture inventory', () => {
  const before = snapshot(S.arena);
  for (const flag of ['--help', '-h']) assert.equal(command(legacyRoot, ['memory-migration', flag]).status, 0);
  assert.deepEqual(snapshot(S.arena), before);
});
test('CLI and MCP cannot attempt filesystem mutations, including swallowed errors', () => {
  const guard = path.join(S.arena, 'deny-writes.cjs');
  fs.writeFileSync(guard, "const fs=require('fs');let attempts=0;const deny=()=>{attempts++;throw Error('unexpected write')};\n"
    + "for(const name of ['writeFile','appendFile','mkdir','mkdtemp','rename','unlink','rm','rmdir','truncate','ftruncate','link','symlink','copyFile','chmod','chown','utimes','lutimes','write','writev']){if(fs[name])fs[name]=deny;if(fs[name+'Sync'])fs[name+'Sync']=deny;if(fs.promises[name])fs.promises[name]=deny;}\n"
    + "for(const name of ['openSync','open']){const original=fs[name];fs[name]=function(file,flags,...rest){if(typeof flags==='string'?flags!=='r':(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND)))return deny();return original.call(this,file,flags,...rest)}}\n"
    + "fs.createWriteStream=deny;process.on('exit',()=>{if(attempts)process.exitCode=91});\n");
  const before = snapshot(S.arena), prefix = ['--require', guard];
  for (const cwd of [root, legacyRoot]) {
    const r = command(cwd, ['memory-migration', 'inspect', 'decisions', '--path', root], '', prefix);
    assert.equal(r.status, 0, r.stderr);
    const reply = rpc(cwd, [call(1, { surface: 'decisions', path: root })], 'full', prefix)[0];
    assert.equal(reply.result.isError, false);
  }
  assert.deepEqual(snapshot(S.arena), before);
});
S.finish('memory migration transport');
