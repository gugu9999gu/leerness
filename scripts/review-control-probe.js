'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const git = require('../lib/git');

if (process.argv[2] === '--worker') {
  const [, , , root, json, mode] = process.argv;
  const original = git.gitSpawn;
  git.gitSpawn = (args, options) => {
    const publishing = args.includes('update-ref');
    if (publishing && mode.startsWith('race:')) {
      process.send({ phase: 'cas-ready' });
      const deadline = Date.now() + 15000;
      while (!fs.existsSync(mode.slice(5))) {
        if (Date.now() > deadline) throw new Error('CAS barrier timeout');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    if (publishing && mode === 'incompatible') {
      const dir = path.join(root, '.git', 'leerness'); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'layout.json'), '{"schemaVersion":999}');
    }
    if (publishing && mode === 'before') { process.send({ phase: 'before' }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); }
    const value = original(args, options);
    if (publishing && mode === 'after' && value.status === 0) { process.send({ phase: 'after' }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); }
    return value;
  };
  const { writeReviewControl } = require('../lib/review-control');
  process.on('message', () => {
    let result;
    try { result = { ok: true, value: writeReviewControl(root, json) }; }
    catch (error) { result = { ok: false, code: error.code }; }
    process.send({ result }, () => process.exit(0));
  });
  process.send({ ready: true });
} else main().catch(error => { console.error(error.stack); process.exitCode = 1; });

async function main() {
  const API = require('../lib/review-control');
  const C = require('../lib/review-control-contract');
  const G = require('../lib/review-control-git');
  const { createReviewSnapshotCandidate } = require('../lib/review-snapshot');
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-review-control-'));
  const repo = path.join(arena, 'main'), linked = path.join(arena, 'linked');
  let passed = 0, total = 0;
  async function test(name, fn) {
    total++;
    try { await fn(); passed++; console.log(`PASS ${name}`); }
    catch (error) { console.error(`FAIL ${name}: ${error.stack}`); }
  }
  function command(root, args, options = {}) {
    const argv = ['-C', root, ...args];
    const result = git.gitSpawn(argv, { cwd: root, encoding: 'utf8', timeout: 15000, ...options });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    return result.stdout.trim();
  }
  function setup(root, format, refFormat) {
    fs.mkdirSync(root);
    command(root, ['init', '-q', '--template=', ...(format ? [`--object-format=${format}`] : []), ...(refFormat ? [`--ref-format=${refFormat}`] : [])]);
    command(root, ['config', 'user.name', 'Control Fixture']); command(root, ['config', 'user.email', 'fixture@example.invalid']);
    command(root, ['config', 'core.hooksPath', path.join(arena, 'empty-hooks')]);
    workspace(root); fs.writeFileSync(path.join(root, 'source.txt'), 'unchanged\n');
    command(root, ['add', 'source.txt']); command(root, ['commit', '-qm', 'fixture source']);
  }
  function workspace(root) {
    fs.mkdirSync(path.join(root, '.leerness'));
    fs.writeFileSync(path.join(root, '.leerness', 'HARNESS_VERSION'), '1.0.0\n');
  }
  function snapshot(batchId, revision = 1) {
    const hash = c => `sha256:${c.repeat(64)}`;
    return { schema: 'leerness.review-snapshot-input/v1',
      batch: { id: batchId, revision, objectiveRevision: 'objective-v1', policyRevision: 'policy-v1' },
      materials: { schema: 'leerness.review-snapshot-materials/v1', manifestDigest: hash('1'), acceptanceDigest: hash('2'),
        policyDigest: hash('3'), evidenceDigest: hash('4'), implementationDigest: hash('5'), dependenciesDigest: hash('6') },
      checkpoint: { schema: 'leerness.review-checkpoint-input/v1', objective: { id: 'O-ui', criteria: ['C-copy'] },
        context: { event: 'task-report', purposeComplete: true, executionMode: 'direct' },
        snapshot: { kind: 'git', baseCommit: 'a'.repeat(40), headCommit: 'b'.repeat(40) },
        limits: { maxTasks: 5, maxFiles: 10, maxChangedLines: 400, maxWaitingHours: 24 },
        metrics: { fileCount: 1, changedLines: 2, waitingHours: 0 },
        tasks: [{ id: 'T-ui', objectiveId: 'O-ui', criteria: ['C-copy'], dependsOn: [], implementation: 'implemented',
          verification: 'passed', evidenceRefs: ['E-ui'], risk: 'normal', riskTags: [], aspects: ['code', 'tests'] }] } };
  }
  const owner = () => ({ sessionId: 'session-a', token: API.createReviewControlToken() });
  function request(batchId, who = owner()) {
    return { schema: API.INPUT_SCHEMA, operation: 'claim', batchId, operationId: 'op-claim', expectedHead: null,
      generation: 0, owner: who, snapshot: null };
  }
  const write = (root, req) => API.writeReviewControl(root, JSON.stringify(req));
  const reject = (fn, code) => assert.throws(fn, error => error instanceof API.ReviewControlError && (!code || error.code === code));
  function next(req, state, operation, operationId, extra = {}) {
    return { ...req, operation, operationId, expectedHead: state.head, generation: state.generation,
      snapshot: operation === 'publish' ? snapshot(req.batchId) : null, ...extra };
  }
  function stamp(root) {
    const out = {};
    function walk(dir) { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else { const s = fs.statSync(file, { bigint: true }); out[path.relative(root, file)] = [C.digest(fs.readFileSync(file).toString('base64')), String(s.mtimeNs)]; }
    } }
    walk(root); return out;
  }
  function worker(root, req, mode = '') {
    const child = fork(__filename, ['--worker', root, JSON.stringify(req), mode],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    let readyResolve, phaseResolve, doneResolve, doneReject, result, killed = false;
    const ready = new Promise(resolve => { readyResolve = resolve; });
    const phase = new Promise(resolve => { phaseResolve = resolve; });
    const done = new Promise((resolve, rejectPromise) => { doneResolve = resolve; doneReject = rejectPromise; });
    const timer = setTimeout(() => { child.kill(); doneReject(new Error('worker timeout')); }, 25000);
    child.on('message', msg => {
      if (msg.ready) readyResolve();
      if (msg.result) result = msg.result;
      if (msg.phase === 'cas-ready') phaseResolve();
      else if (msg.phase) { killed = true; child.kill('SIGKILL'); }
    });
    child.on('error', error => { clearTimeout(timer); doneReject(error); });
    child.on('exit', code => { clearTimeout(timer); if (killed || code === 0) doneResolve({ result, killed }); else doneReject(new Error('worker failed')); });
    return { ready, phase, done, start: () => child.send('go') };
  }
  try {
    setup(repo);
    const branch = command(repo, ['rev-parse', 'HEAD']);
    const sourceBefore = fs.readFileSync(path.join(repo, 'source.txt'));
    const indexBefore = fs.readFileSync(path.join(repo, '.git', 'index'));
    await test('empty read has no writes including Git metadata', () => {
      const before = stamp(repo); assert.equal(API.readReviewControl(repo, 'B-empty').head, null); assert.deepEqual(stamp(repo), before);
    });
    await test('a project folder too deep for Git refs on Windows is refused before any write and works once core.longpaths is on', () => {
      // T-0326: refs here are refs/leerness/<family>/v1/project-<64 hex>/<64 hex>. On Windows, Git without core.longpaths
      // cannot lock such a ref once its lock path reaches 260 characters (the claim used to fail as git_failed), and a
      // ref written with long paths breaks the user's own Git there (git log --all, fsck and gc fail). So the claim and
      // the read are refused with git_long_paths_required before anything is written; after
      // `git config core.longpaths true` both work and the user's own Git still reads the repository.
      // The user's global and system Git configuration are switched off so that every machine runs the same case.
      const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM, GIT_DEFAULT_REF_FORMAT: process.env.GIT_DEFAULT_REF_FORMAT };
      const empty = path.join(arena, 'empty.gitconfig'); fs.writeFileSync(empty, '');
      process.env.GIT_CONFIG_GLOBAL = empty; process.env.GIT_CONFIG_NOSYSTEM = '1'; process.env.GIT_DEFAULT_REF_FORMAT = 'files';
      try {
        let deep = path.join(arena, 'deep');
        while (deep.length < 130) deep = path.join(deep, 'nested-project-folder');
        fs.mkdirSync(path.dirname(deep), { recursive: true }); setup(deep);
        const req = request('B-deep');
        if (process.platform === 'win32') {
          const before = stamp(deep);
          reject(() => write(deep, req), 'git_long_paths_required');
          reject(() => API.readReviewControl(deep, req.batchId), 'git_long_paths_required');
          assert.deepEqual(stamp(deep), before);
          // Only ref operands count: a path given to ls-tree after `--` is not a ref, however it is spelled.
          const listed = G.run(G.context(deep, req.batchId), ['ls-tree', '-z', 'HEAD', '--', `refs/leerness/${'a'.repeat(200)}/run.json`]);
          assert.equal(listed.status, 0, String(listed.stderr));
          command(deep, ['config', 'core.longpaths', 'true']);
          assert.ok(path.join(deep, '.git', G.context(deep, req.batchId).ref + '.lock').length >= 260, 'the case must reach MAX_PATH');
        }
        const claimed = write(deep, req);
        assert.equal(API.readReviewControl(deep, req.batchId).head, claimed.head);
        assert.ok(command(deep, ['log', '--all', '--format=%H']).split('\n').includes(claimed.head));
        command(deep, ['fsck', '--no-progress']);
      } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      }
    });
    await test('at the exact boundary only what Git cannot do is refused: a 260-character lock, not a 259-character lock or a 259-character read', () => {
      // Measured with Git for Windows 2.54.0 without core.longpaths: update-ref works up to a 259-character lock path
      // and fails from 260; a read works up to a 259-character ref path. The review-control ref has 169 characters, so
      // its ref file path is the project root plus 175 characters and its lock file the root plus 180. Lengths come
      // from the real path (a TEMP given in 8.3 form is longer once resolved), and the 259 case has a capital dotted I,
      // which lower-casing turns into two characters. Other platforms have no such limit and run the same claims.
      const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM, GIT_DEFAULT_REF_FORMAT: process.env.GIT_DEFAULT_REF_FORMAT };
      const empty = path.join(arena, 'empty.gitconfig'); fs.writeFileSync(empty, '');
      process.env.GIT_CONFIG_GLOBAL = empty; process.env.GIT_CONFIG_NOSYSTEM = '1'; process.env.GIT_DEFAULT_REF_FORMAT = 'files';
      try {
        const base = fs.realpathSync.native(arena), windows = process.platform === 'win32';
        const at = (target, name) => {
          const pad = target - base.length - 1 - name.length;
          if (pad >= 0) return path.join(base, name + 'x'.repeat(pad));
          assert.ok(!windows, `the test folder (${base.length} characters) is too deep to place a ${target}-character project`);
          return path.join(base, name);
        };
        const edge = at(79, 'edge' + String.fromCharCode(0x130)), first = at(80, 'first'), band = at(84, 'band');
        for (const root of [edge, first, band]) setup(root);
        const req = request('B-edge'), lock = root => path.join(root, '.git', G.context(root, req.batchId).ref + '.lock');
        if (windows) { assert.equal(lock(edge).length, 259); assert.equal(lock(first).length, 260); assert.equal(lock(band).length, 264); }
        // A 259-character lock: Git can take it, so the claim works without the setting.
        const edgeClaim = write(edge, req);
        assert.equal(API.readReviewControl(edge, req.batchId).head, edgeClaim.head);
        if (windows) {
          // A 260-character lock: refused with no ref written (the claim's Git objects may already exist, unreachable),
          // and the 255-character read still works.
          reject(() => write(first, req), 'git_long_paths_required');
          assert.equal(API.readReviewControl(first, req.batchId).head, null);
          assert.equal(command(first, ['-c', 'core.longpaths=true', 'for-each-ref', 'refs/leerness/']), '');
          command(band, ['config', 'core.longpaths', 'true']);
        }
        // A 259-character ref with a 264-character lock: written with the setting on, read with it off; the next write
        // is refused until the setting is back.
        const bandClaim = write(band, req);
        if (windows) command(band, ['config', '--unset', 'core.longpaths']);
        assert.equal(API.readReviewControl(band, req.batchId).head, bandClaim.head);
        const publish = next(req, bandClaim, 'publish', 'op-publish');
        if (windows) {
          reject(() => write(band, publish), 'git_long_paths_required');
          assert.equal(API.readReviewControl(band, req.batchId).head, bandClaim.head);
          command(band, ['config', 'core.longpaths', 'true']);
        }
        assert.notEqual(write(band, publish).head, bandClaim.head);
      } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      }
    });
    await test('a claim is refused exactly when the user\'s own Git cannot lock a ref of the same length, whatever git config reports', () => {
      // Git for Windows 2.54.0 does not combine core.longpaths the usual way (measured): with a global true and a
      // repository false it handles long paths, with a global false and a repository true it does not, while
      // `git config --get` reports the repository's value. Whatever a Git version does, the claim must be refused exactly
      // when that Git cannot lock a ref as long as the claim's, and what is written must be readable by that Git.
      const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM, GIT_DEFAULT_REF_FORMAT: process.env.GIT_DEFAULT_REF_FORMAT };
      process.env.GIT_CONFIG_NOSYSTEM = '1'; process.env.GIT_DEFAULT_REF_FORMAT = 'files';
      try {
        for (const [globalValue, repositoryValue] of [['true', 'false'], ['false', 'true']]) {
          const globalFile = path.join(arena, `longpaths-${globalValue}.gitconfig`);
          fs.writeFileSync(globalFile, `[core]\n\tlongpaths = ${globalValue}\n`); process.env.GIT_CONFIG_GLOBAL = globalFile;
          let deep = path.join(arena, `combo-${globalValue}`);
          while (deep.length < 130) deep = path.join(deep, 'nested-project-folder');
          fs.mkdirSync(path.dirname(deep), { recursive: true }); setup(deep);
          command(deep, ['config', 'core.longpaths', repositoryValue]);
          const req = request('B-combo'), own = G.context(deep, req.batchId).ref;
          const twin = own.slice(0, -1) + (own.endsWith('0') ? '1' : '0');
          const head = command(deep, ['rev-parse', 'HEAD']);
          const plain = git.gitSpawn(['-C', deep, 'update-ref', twin, head], { cwd: deep, encoding: 'utf8', timeout: 15000 });
          const label = `global ${globalValue}, repository ${repositoryValue}, the user's Git ${plain.status === 0 ? 'can' : 'cannot'} lock it`;
          if (plain.status === 0) {
            const claimed = write(deep, req);
            assert.ok(command(deep, ['log', '--all', '--format=%H']).split('\n').includes(claimed.head), label);
          } else {
            assert.equal(process.platform, 'win32', label);
            assert.throws(() => write(deep, req), error => error.code === 'git_long_paths_required', label);
          }
        }
      } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      }
    });
    await test('a reftable repository in a deep folder needs no long paths: a claim is written and read back', () => {
      // With the reftable format Git keeps refs in a few short table files, so a long ref name does not reach the path
      // limit and the check must not refuse. Skipped only when this Git does not know the reftable format.
      const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM, GIT_DEFAULT_REF_FORMAT: process.env.GIT_DEFAULT_REF_FORMAT };
      const empty = path.join(arena, 'empty.gitconfig'); fs.writeFileSync(empty, '');
      process.env.GIT_CONFIG_GLOBAL = empty; process.env.GIT_CONFIG_NOSYSTEM = '1'; process.env.GIT_DEFAULT_REF_FORMAT = 'files';
      try {
        const known = git.gitSpawn(['init', '-q', '--template=', '--ref-format=reftable', path.join(arena, 'reftable-capability')], { encoding: 'utf8', timeout: 15000 });
        if (known.status !== 0) {
          assert.match(String(known.stderr), /unknown option|ref-format|ref storage format/i, String(known.stderr || known.error));
          console.log('  (this Git does not know the reftable format; skipped)'); return;
        }
        let deep = path.join(arena, 'reftable');
        while (deep.length < 130) deep = path.join(deep, 'nested-project-folder');
        fs.mkdirSync(path.dirname(deep), { recursive: true }); setup(deep, undefined, 'reftable');
        assert.equal(command(deep, ['rev-parse', '--show-ref-format']), 'reftable');
        const req = request('B-reftable'), claimed = write(deep, req);
        assert.equal(API.readReviewControl(deep, req.batchId).head, claimed.head);
        assert.ok(command(deep, ['log', '--all', '--format=%H']).split('\n').includes(claimed.head));
      } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      }
    });
    await test('a damaged control ref in a deep folder with long paths on gets the code it gets in a shallow folder, not git_long_paths_required', () => {
      // The check reads a name next to the ref that Leerness never creates, never the ref itself, so damage to a record
      // ref is reported the same way at any depth.
      const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM, GIT_DEFAULT_REF_FORMAT: process.env.GIT_DEFAULT_REF_FORMAT };
      const empty = path.join(arena, 'empty.gitconfig'); fs.writeFileSync(empty, '');
      process.env.GIT_CONFIG_GLOBAL = empty; process.env.GIT_CONFIG_NOSYSTEM = '1'; process.env.GIT_DEFAULT_REF_FORMAT = 'files';
      try {
        const damagedCode = root => {
          const req = request('B-damaged'); write(root, req);
          const ctx = G.context(root, req.batchId);
          fs.writeFileSync(path.join(ctx.commonDir, ...ctx.ref.split('/')), 'not an object id\n');
          try { API.readReviewControl(root, req.batchId); } catch (error) { return error.code; }
          return 'read succeeded';
        };
        const shallow = path.join(arena, 'ds'); setup(shallow);
        assert.ok(path.join(shallow, '.git', G.context(shallow, 'B-damaged').ref + '.lock').length < 260, 'the comparison project must be shallow');
        let deep = path.join(arena, 'damaged-deep');
        while (deep.length < 130) deep = path.join(deep, 'nested-project-folder');
        fs.mkdirSync(path.dirname(deep), { recursive: true }); setup(deep);
        if (process.platform === 'win32') command(deep, ['config', 'core.longpaths', 'true']);
        const expected = damagedCode(shallow);
        assert.notEqual(expected, 'read succeeded'); assert.notEqual(expected, 'git_long_paths_required');
        assert.equal(damagedCode(deep), expected);
      } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      }
    });
    const mutations = [
      x => { x.extra = true; }, x => { x.schema = 'future'; }, x => { x.operation = 'approve'; },
      x => { x.batchId = '../escape'; }, x => { x.operationId = ['op']; }, x => { x.expectedHead = []; },
      x => { x.generation = -1; }, x => { x.generation = 0.5; }, x => { x.owner.token = ['a'.repeat(64)]; },
      x => { x.owner.extra = true; }, x => { x.owner.sessionId = '\n'; }, x => { x.snapshot = {}; },
      x => { x.operation = 'publish'; }, x => { x.operation = 'publish'; x.snapshot = snapshot('wrong'); }
    ];
    for (let i = 0; i < mutations.length; i++) await test(`invalid request ${i + 1} rejected before path access`, () => {
      const req = request('B-invalid'); mutations[i](req);
      reject(() => write(path.join(arena, 'nonexistent'), req), 'input_invalid');
    });
    await test('duplicate keys, BOM, huge JSON and executable objects rejected', () => {
      for (const raw of ['{"schema":1,"schema":2}', '\ufeff{}', ' '.repeat(65537), { toJSON() { throw new Error('executed'); } }]) {
        reject(() => API.writeReviewControl(repo, raw), 'input_invalid');
      }
      reject(() => API.readReviewControl('.', 'B'), 'root_invalid');
    });
    const req = request('B-main'); let state;
    await test('claim persists and read in fresh process restores generation', async () => {
      state = write(repo, req); assert.equal(state.generation, 1); assert.equal(state.revision, 1);
      const w = worker(repo, req); await w.ready; w.start(); const r = await w.done;
      assert.equal(r.result.value.applied, false); assert.equal(r.result.value.head, state.head);
    });
    await test('same operation with different payload conflicts', () => {
      reject(() => write(repo, { ...req, owner: owner() }), 'idempotency_conflict');
    });
    let published, publishReq;
    await test('publish binds existing snapshot identity and stores only digests', () => {
      publishReq = next(req, state, 'publish', 'op-publish'); published = write(repo, publishReq);
      assert.equal(published.snapshot.snapshotId, createReviewSnapshotCandidate(JSON.stringify(publishReq.snapshot)).snapshotId);
      const ctx = G.context(repo, req.batchId), raw = command(repo, ['show', `${published.head}:record.json`]);
      assert.ok(!raw.includes(req.owner.token)); assert.ok(!raw.includes('C-copy'));
      assert.equal(G.read(ctx).value.revision, 2);
      assert.equal(published.actorIdentityVerified, false); assert.equal(published.approvalGranted, false);
      assert.equal(published.cleanupAllowed, false); assert.equal(published.retention, 'local-git-ref');
    });
    await test('changed metrics under same operation are a payload conflict', () => {
      const altered = structuredClone(publishReq); altered.snapshot.checkpoint.metrics.changedLines++;
      reject(() => write(repo, altered), 'idempotency_conflict');
    });
    await test('same head publisher must own token/session/worktree and generation', () => {
      const candidate = next(req, published, 'publish', 'op-wrong', { snapshot: snapshot(req.batchId, 2) });
      reject(() => write(repo, { ...candidate, owner: owner() }), 'owner_mismatch');
      reject(() => write(repo, { ...candidate, generation: 0 }), 'stale_generation');
      reject(() => write(repo, { ...candidate, expectedHead: state.head }), 'revision_conflict');
      reject(() => write(repo, next(req, published, 'publish', 'op-old-snapshot')), 'snapshot_not_advanced');
    });
    await test('replay after newer record reports original revision without overwriting current head', () => {
      const before = stamp(repo), replay = write(repo, req);
      assert.equal(replay.operationRevision, 1); assert.equal(replay.revision, 2); assert.equal(replay.head, published.head);
      assert.deepEqual(stamp(repo), before);
    });
    await test('linked worktree shares control, cannot impersonate original owner', () => {
      command(repo, ['worktree', 'add', '-q', '-b', 'fixture-linked', linked]);
      workspace(linked);
      assert.equal(API.readReviewControl(linked, req.batchId).head, published.head);
      reject(() => write(linked, next(req, published, 'release', 'wrong-worktree')), 'owner_mismatch');
    });
    let reclaimed;
    const replacement = { sessionId: 'session-b', token: API.createReviewControlToken() };
    await test('explicit reclaim fences former owner even with latest head', () => {
      reclaimed = write(linked, next(req, published, 'reclaim', 'op-reclaim', { owner: replacement }));
      assert.equal(reclaimed.generation, 2);
      reject(() => write(repo, next(req, reclaimed, 'release', 'old-owner')), 'owner_mismatch');
      reject(() => write(repo, next(req, published, 'release', 'old-generation')), 'stale_generation');
    });
    await test('release and new claim advance generation without deleting snapshots/history', () => {
      const release = next(req, reclaimed, 'release', 'op-release', { owner: replacement });
      const released = write(linked, release); assert.equal(released.owner, null);
      const claimed = write(repo, next(req, released, 'claim', 'op-claim-again'));
      assert.equal(claimed.generation, 3); assert.equal(claimed.snapshot.generation, 1);
      const commits = command(repo, ['rev-list', claimed.head]).split('\n'); assert.equal(commits.length, claimed.revision);
      assert.ok(commits.includes(published.head));
    });
    await test('two real processes racing same revision commit exactly one successor', async () => {
      const r = request('B-race'), current = write(repo, r);
      const gate = path.join(arena, 'cas-gate');
      const a = worker(repo, next(r, current, 'publish', 'race-a'), `race:${gate}`);
      const b = worker(repo, next(r, current, 'publish', 'race-b'), `race:${gate}`);
      await Promise.all([a.ready, b.ready]); a.start(); b.start();
      await Promise.all([a.phase, b.phase]); fs.writeFileSync(gate, 'go');
      const results = (await Promise.all([a.done, b.done])).map(x => x.result);
      assert.equal(results.filter(x => x.ok).length, 1);
      assert.equal(results.find(x => !x.ok).code, 'publication_uncertain');
      const observed = API.readReviewControl(repo, r.batchId); assert.equal(observed.revision, 2);
      assert.equal(command(repo, ['rev-list', observed.head]).split('\n').length, 2);
    });
    for (const phase of ['before', 'after']) await test(`process killed ${phase} CAS recovers via same operation`, async () => {
      const r = request(`B-crash-${phase}`), current = write(repo, r), p = next(r, current, 'publish', 'crash-publish');
      const w = worker(repo, p, phase); await w.ready; w.start(); assert.equal((await w.done).killed, true);
      const observed = API.readReviewControl(repo, r.batchId); assert.equal(observed.revision, phase === 'before' ? 1 : 2);
      const recovered = write(repo, p); assert.equal(recovered.revision, 2); assert.equal(recovered.applied, phase === 'before');
    });
    await test('clock moves do not expire a claim or permit theft', () => {
      const r = request('B-clock'), current = write(repo, r), original = Date.now;
      try { Date.now = () => 0; reject(() => write(repo, next(r, current, 'claim', 'clock-steal', { owner: owner() })), 'claim_state_conflict'); }
      finally { Date.now = original; }
    });
    await test('dry-run rejects object writes and preserves full repository bytes/mtimes', () => {
      const before = stamp(repo); git.setGitDryRun(true);
      try { reject(() => write(repo, request('B-dry')), 'E_DRY_RUN_WRITE'); }
      finally { git.setGitDryRun(false); }
      assert.deepEqual(stamp(repo), before);
    });
    await test('runtime migration indicator blocks writes without activating a layout', () => {
      const dir = path.join(repo, '.git', 'leerness'); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'layout.json'); fs.writeFileSync(file, '{"schemaVersion":999}');
      const before = stamp(repo);
      try { reject(() => write(repo, request('B-blocked')), 'E_RUNTIME_LAYOUT_INCOMPATIBLE'); assert.deepEqual(stamp(repo), before); }
      finally { fs.unlinkSync(file); }
    });
    await test('incompatible layout appearing immediately before CAS prevents publication', async () => {
      const r = request('B-late-block'), w = worker(repo, r, 'incompatible');
      await w.ready; w.start(); const observed = await w.done;
      try {
        assert.equal(observed.result.ok, false); assert.equal(observed.result.code, 'E_RUNTIME_LAYOUT_INCOMPATIBLE');
        assert.equal(API.readReviewControl(repo, r.batchId).head, null);
      } finally { fs.unlinkSync(path.join(repo, '.git', 'leerness', 'layout.json')); }
    });
    await test('symbolic control ref cannot redirect writes into another ref', () => {
      const ctx = G.context(repo, 'B-symbolic'); command(repo, ['symbolic-ref', ctx.ref, 'refs/heads/missing-fixture']);
      reject(() => API.readReviewControl(repo, 'B-symbolic'), 'ref_invalid');
      reject(() => write(repo, request('B-symbolic')), 'ref_invalid');
      assert.equal(command(repo, ['symbolic-ref', ctx.ref]), 'refs/heads/missing-fixture');
      command(repo, ['symbolic-ref', '--delete', ctx.ref]);
    });
    await test('malformed record is rejected and preserved', () => {
      const r = request('B-corrupt'), current = write(repo, r), ctx = G.context(repo, r.batchId);
      const blob = command(repo, ['hash-object', '-w', '--stdin'], { input: '{"schema":"future"}\n' });
      const tree = command(repo, ['mktree'], { input: `100644 blob ${blob}\trecord.json\n` });
      const bad = command(repo, ['commit-tree', tree, '-p', current.head], { input: 'corrupt fixture\n' });
      command(repo, ['update-ref', ctx.ref, bad, current.head]); const before = stamp(repo);
      reject(() => API.readReviewControl(repo, r.batchId), 'record_invalid');
      reject(() => write(repo, next(r, current, 'release', 'corrupt-release')), 'record_invalid');
      assert.deepEqual(stamp(repo), before);
    });
    await test('non-Git has no silent local backend or files', () => {
      const dir = path.join(arena, 'nongit'); fs.mkdirSync(dir); const before = stamp(dir);
      reject(() => API.readReviewControl(dir, 'B'), 'git_required'); reject(() => write(dir, request('B')), 'git_required');
      assert.deepEqual(stamp(dir), before);
    });
    await test('monorepo project keys isolate claims and foreign Git environment is scrubbed', () => {
      const sub = path.join(repo, 'sub'); fs.mkdirSync(sub); workspace(sub);
      assert.equal(API.readReviewControl(sub, req.batchId).head, null);
      const prior = process.env.GIT_DIR; process.env.GIT_DIR = path.join(linked, '.git');
      try { assert.equal(API.readReviewControl(repo, req.batchId).generation, 3); }
      finally { if (prior === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = prior; }
    });
    await test('SHA256 repositories retain correct CAS object lengths', () => {
      const sha = path.join(arena, 'sha256'); setup(sha, 'sha256'); const r = request('B-sha');
      const current = write(sha, r); assert.equal(current.head.length, 64);
      assert.equal(write(sha, next(r, current, 'publish', 'sha-publish')).revision, 2);
    });
    await test('bounded history never silently forgets idempotency keys', () => {
      const r = request('B-bound'), normalized = C.request(JSON.stringify(r)), ctx = G.context(repo, r.batchId);
      let previous = null;
      for (let i = 0; i < API.MAX_OPERATIONS; i++) {
        const input = { ...normalized, operation: i === 0 ? 'claim' : 'reclaim', operationId: `bound-${i}`, generation: i };
        previous = C.transition(previous, input, ctx.worktreeDigest, ctx.projectKey).next;
      }
      C.record(C.stable(previous), ctx.projectKey, r.batchId);
      reject(() => C.transition(previous, { ...normalized, operation: 'reclaim', operationId: 'overflow', generation: 128 }, ctx.worktreeDigest, ctx.projectKey), 'history_limit');
    });
    await test('retained ref restores after GC and explicit local transfer without source branch changes', () => {
      const ctx = G.context(repo, req.batchId), before = API.readReviewControl(repo, req.batchId);
      command(repo, ['gc', '--quiet']); assert.equal(API.readReviewControl(repo, req.batchId).head, before.head);
      const restored = path.join(arena, 'restored'); setup(restored);
      command(restored, ['-c', 'protocol.file.allow=always', 'fetch', '-q', repo, `${ctx.ref}:${ctx.ref}`]);
      const copy = API.readReviewControl(restored, req.batchId); assert.equal(copy.head, before.head);
      assert.equal(command(restored, ['rev-list', copy.head]).split('\n').length, copy.revision);
      assert.equal(command(repo, ['rev-parse', 'HEAD']), branch);
      assert.deepEqual(fs.readFileSync(path.join(repo, 'source.txt')), sourceBefore);
      assert.deepEqual(fs.readFileSync(path.join(repo, '.git', 'index')), indexBefore);
    });
  } finally {
    const absolute = fs.realpathSync(arena), parent = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(absolute), parent); assert.ok(path.basename(absolute).startsWith('leerness-review-control-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  }
  console.log(`review control: ${passed}/${total} passed`);
  if (passed !== total) process.exitCode = 1;
}
