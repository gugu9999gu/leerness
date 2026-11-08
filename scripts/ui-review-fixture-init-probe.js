'use strict';
require('./temp-cleanup').trackTemp(module);

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const fixtureFile = path.join(__dirname, 'ui-review-run-fixture.js');
const template = path.join(__dirname, 'fixtures/ui-review-git-template');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
let passed = 0, total = 0;
function test(name, fn) {
  if (process.argv.includes('--behavior-only') && !name.startsWith('actual ')) return;
  total++;
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack}`); }
}
function mockedSetup(format) {
  const calls = [], writes = [], file = new Module(fixtureFile, module);
  file.filename = fixtureFile; file.paths = Module._nodeModulePaths(__dirname);
  const input = { uiMaterials: [{}], snapshot: { batch: { id: 'B' }, checkpoint: {} } };
  const stubs = {
    'node:fs': { mkdirSync: p => writes.push(['mkdir', p]), writeFileSync: (p, value) => writes.push(['write', p, Buffer.from(value)]) },
    '../lib/git': { gitSpawn(args, options) { calls.push({ args, options }); return { status: 0, stdout: args.includes('rev-parse') ? 'a'.repeat(40) : '', stderr: '' }; } },
    '../lib/ui-review-run': { INPUT_SCHEMA: 'run' },
    '../lib/ui-review-run-contract': { sha },
    '../lib/review-control': { INPUT_SCHEMA: 'control', createReviewControlToken: () => 'f'.repeat(64), writeReviewControl: () => ({ head: 'c'.repeat(40), generation: 1 }) },
    './ui-review-fixture': { fixture: () => input, encode: JSON.stringify },
    '../lib/ui-review-observation': { KINDS: ['source', 'spec', 'diff', 'render'], INPUT_SCHEMA: 'observation' },
    '../lib/role-fallback': {},
  };
  file.require = name => Object.hasOwn(stubs, name) ? stubs[name] : Module.prototype.require.call(file, name);
  file._compile(fs.readFileSync(fixtureFile, 'utf8'), fixtureFile);
  const root = path.resolve('isolated-fixture');
  file.exports.setup(root, { ledger: false, format });
  return { calls, writes, root };
}
test('owned template contains fixed local fixture identity only', () => {
  assert.deepEqual(fs.readdirSync(template), ['config']);
  assert.equal(fs.readFileSync(path.join(template, 'config'), 'utf8'), '[user]\n\tname = Run Fixture\n\temail = run@example.invalid\n');
});
for (const format of [undefined, 'sha1', 'sha256']) {
  test(`contract ${format || 'default'} keeps explicit isolated template, hook fence and mutation order`, () => {
    const { calls, root, writes } = mockedSetup(format);
    assert.equal(calls.length, 5);
    assert.deepEqual(calls[0].args, ['-C', root, 'init', '-q', '--template=' + template, ...(format ? ['--object-format=' + format] : [])]);
    assert.deepEqual(calls[1].args, ['-C', root, 'config', 'core.hooksPath', path.join(root, 'empty-hooks')]);
    assert.equal(calls.filter(c => c.args.includes('user.name') || c.args.includes('user.email')).length, 0);
    assert.equal(calls[2].args[2], 'add'); assert.equal(calls[3].args[2], 'commit'); assert.equal(calls[4].args[2], 'rev-parse');
    for (const call of calls) { assert.equal(call.options.cwd, root); assert.equal(call.options.timeout, 15000); }
    assert.equal(writes.filter(w => w[0] === 'write').length, 5);
  });
}

if (!process.argv.includes('--contract-only')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-fi-'));
  const profile = path.join(arena, 'home'), hostile = path.join(arena, 'hostile-template');
  for (const d of [profile, hostile, path.join(hostile, 'hooks')]) fs.mkdirSync(d);
  fs.writeFileSync(path.join(hostile, 'foreign-template-marker'), 'owner template must not be copied\n');
  fs.writeFileSync(path.join(hostile, 'hooks/pre-commit'), '#!/bin/sh\nexit 91\n', { mode: 0o755 });
  const globalFile = path.join(profile, '.gitconfig');
  fs.writeFileSync(globalFile, '[user]\n\tname = Hostile Global\n\temail = global@example.invalid\n[init]\n\ttemplateDir = ' + JSON.stringify(hostile) + '\n');
  Object.assign(process.env, { HOME: profile, USERPROFILE: profile, APPDATA: path.join(profile, 'app'), LOCALAPPDATA: path.join(profile, 'local'), GIT_CONFIG_NOSYSTEM: '1', GIT_TEMPLATE_DIR: hostile });
  const globalsBefore = [sha(fs.readFileSync(globalFile)), String(fs.statSync(globalFile, { bigint: true }).mtimeNs), sha(fs.readFileSync(path.join(hostile, 'hooks/pre-commit')))];
  const git = require('../lib/git'), original = git.gitSpawn;
  let phase = null;
  const calls = [];
  git.gitSpawn = (args, options) => { if (phase) calls.push({ phase, args }); return original(args, options); };
  const F = require('./ui-review-run-fixture'), C = require('../lib/review-control');
  try {
    for (const format of ['sha1', 'sha256']) {
      const root = path.join(arena, format);
      phase = 'setup-' + format;
      const s = F.setup(root, { ledger: false, format });
      phase = null;
      test(`actual ${format} local identity, format and normal commit behavior`, () => {
        assert.equal(F.cmd(root, ['config', '--local', '--get-all', 'user.name']), 'Run Fixture');
        assert.equal(F.cmd(root, ['config', '--local', '--get-all', 'user.email']), 'run@example.invalid');
        assert.equal(F.cmd(root, ['rev-parse', '--show-object-format']), format);
        assert.equal(F.cmd(root, ['log', '-1', '--format=%an <%ae>|%cn <%ce>']), 'Run Fixture <run@example.invalid>|Run Fixture <run@example.invalid>');
      });
      test(`actual ${format} external template and global identity are isolated`, () => {
        assert.equal(fs.existsSync(path.join(root, '.git/foreign-template-marker')), false);
        assert.equal(fs.existsSync(path.join(root, '.git/hooks/pre-commit')), false);
        assert.equal(F.cmd(root, ['config', '--local', '--get', 'core.hooksPath']), path.join(root, 'empty-hooks'));
      });
      test(`actual ${format} source/data and original global configuration stay unchanged on read`, () => {
        const before = F.snapshot(root);
        assert.equal(C.readReviewControl(root, s.run.batchId).head, s.control.head);
        assert.deepEqual(F.snapshot(root), before);
        assert.deepEqual([sha(fs.readFileSync(globalFile)), String(fs.statSync(globalFile, { bigint: true }).mtimeNs), sha(fs.readFileSync(path.join(hostile, 'hooks/pre-commit')))], globalsBefore);
      });
      test(`actual ${format} intentional local hooks remain active`, () => {
        fs.mkdirSync(path.join(root, 'empty-hooks'));
        fs.writeFileSync(path.join(root, 'empty-hooks/pre-commit'), '#!/bin/sh\nprintf invoked > .leerness/hook-fired\nexit 1\n', { mode: 0o755 });
        const result = original(['-C', root, 'commit', '--allow-empty', '-qm', 'must reject'], { cwd: root, encoding: 'utf8', timeout: 15000 });
        assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.notEqual(result.status, 0);
        assert.equal(fs.readFileSync(path.join(root, '.leerness/hook-fired'), 'utf8'), 'invoked');
      });
    }
    console.log(JSON.stringify({ retainedArena: arena, setupGitInvocations: calls.length, explicitUserConfigInvocations: calls.filter(c => c.args.includes('user.name') || c.args.includes('user.email')).length,
      limits: 'Actual independent Git fixtures; no mutable fixture reuse, source/template/global bytes retained. This count is not a whole-CI timing result.' }));
  } finally { git.gitSpawn = original; }
}
console.log(`UI fixture initialization probe: ${passed}/${total}`);
if (passed !== total) process.exitCode = 1;
