'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const F = require('./openai-ui-review-fixture');
const G = require('../lib/review-control-git');
const A = require('../lib/ui-review-attempt');
const J = require('../lib/openai-ui-review-journal');
const R = require('../lib/ui-review-run-contract');
const C = require('../lib/review-control');
const O = require('../lib/ui-review-observation');
const { removeTree } = require('./temp-cleanup');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-post-'));
const children = new Set(), calls = [], key = 'fixture-' + randomUUID();
let sequence = 0, total = 0, passed = 0, server, network, cert, handler;
const setup = extra => F.setup(path.join(arena, 'c' + sequence++), extra);
const ctx = s => G.context(s.root, s.run.batchId);
const posts = () => calls.filter(r => r.method === 'POST').length;
const gets = () => calls.filter(r => r.method === 'GET').length;
const code = (fn, expected) => assert.throws(fn, e => !expected || e.code === expected, expected);
const rejected = (fn, expected) => assert.rejects(fn, e => !expected || e.code === expected, expected);
const send = (r, res, status = 200, value) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value || { object: 'response', id: r.method === 'POST' ? 'resp_' + posts() : r.url.split('/').pop(),
    status: r.method === 'POST' ? 'queued' : 'completed', model: 'fixture-model', created_at: 1741386163,
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'PRIVATE_OUTPUT' }] }] }));
};
const reclaim = s => C.writeReviewControl(s.root, F.encode({ ...s.common, operation: 'reclaim', operationId: 'new-owner', expectedHead: s.control.head, generation: 1, snapshot: null }));
const dispatch = (s, config) => { const h = F.prepare(s, config); return F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key); };
function worker(s, mode, gate = path.join(arena, 'g' + sequence++)) {
  const child = fork(path.join(__dirname, 'openai-ui-review-worker.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  children.add(child); let resolvePhase, resolveDone, result, stderr = '', contractErrors = [];
  const phase = new Promise(r => { resolvePhase = r; }), done = new Promise(r => { resolveDone = r; });
  const timer = setTimeout(() => child.kill(), 60000);
  child.stderr.on('data', b => { stderr += b; });
  child.on('message', m => {
    if (m.ready) child.send({ s, mode, gate, port: server.address().port, cert: cert.toString(), key });
    if (m.phase) resolvePhase(m.phase);
    if (m.result) { result = m.result; contractErrors = m.contractErrors; }
  });
  child.on('exit', (exitCode, signal) => {
    clearTimeout(timer); children.delete(child); resolvePhase('exited');
    resolveDone({ result, exitCode, signal, stderr, contractErrors });
  });
  return { child, phase, done };
}
async function lookedUp(s) {
  const before = F.snapshot(s.root), n = posts(), out = await worker(s, 'lookup').done;
  assert.equal(out.exitCode, 0, out.stderr); assert.deepEqual(out.contractErrors, []);
  assert.equal(out.result.ok, true, JSON.stringify(out.result));
  assert.equal(out.result.value.observation.ok, true);
  assert.equal(posts(), n); assert.deepEqual(F.snapshot(s.root), before);
  return out.result.value;
}
async function test(name, run, smoke = false) {
  if (process.argv.includes('--smoke') && !smoke) return;
  total++; handler = send;
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (e) { console.error('FAIL ' + name + ': ' + e.stack); }
}
async function main() {
  const pair = F.certificate(arena); cert = pair.cert;
  server = https.createServer(pair, (req, res) => {
    const r = { method: req.method, url: req.url, headers: req.headers, body: Buffer.alloc(0) };
    const chunks = [], respond = handler;
    req.on('data', b => chunks.push(b));
    req.on('end', () => { r.body = Buffer.concat(chunks); calls.push(r); respond(r, res); });
  });
  server.on('tlsClientError', () => {});
  await new Promise(r => server.listen(0, '127.0.0.1', r)); network = F.bridge(server.address().port, cert);
  await test('preview reads actual bytes without writes; copied buffers cannot mutate capture', () => {
    const s = setup(), before = F.snapshot(s.root), n = calls.length;
    assert.equal(F.read(s), null); const h = F.prepare(s);
    assert.equal(h.config.store, false); assert.ok(Object.isFrozen(h.config.profile)); assert.equal(h.materials.length, 4);
    const capture = O.captureUiReview(s.root, F.encode(s.request));
    const copies = O.readUiReviewMaterialSnapshot(capture); copies[0].bytes.fill(0);
    assert.notEqual(R.sha(O.readUiReviewMaterialSnapshot(capture)[0].bytes), R.sha(copies[0].bytes));
    assert.deepEqual(F.snapshot(s.root), before); assert.equal(calls.length, n);
  }, true);
  await test('explicit configuration, exact digest, credential and opaque handle required before writes', async () => {
    const s = setup(), before = F.snapshot(s.root), n = posts(), h = F.prepare(s);
    for (const cfg of [{ ...F.config, store: undefined }, { ...F.config, model: '' }, { ...F.config, endpoint: 'http://invalid.example' },
      { ...F.config, maxOutputTokens: 0 }, { ...F.config, profile: { ...F.config.profile, projectId: '' } }, { ...F.config, timeoutMs: 15001 }]) code(() => F.prepare(s, cfg));
    await rejected(() => F.API.dispatchOpenAiUiReviewRun(h, 'wrong', key), 'dispatch_approval_mismatch');
    await rejected(() => F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, 'bad\r\nkey'), 'dispatch_credential_invalid');
    await rejected(() => F.API.dispatchOpenAiUiReviewRun({ ...h }, h.requestDigest, key), 'dispatch_handle_invalid');
    assert.deepEqual(F.snapshot(s.root), before); assert.equal(posts(), n);
  }, true);
  await test('single POST binds body scope and response to run; fresh process GET is read-only', async () => {
    const s = setup(), h = F.prepare(s), n = posts(), out = await F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key);
    assert.equal(out.ok, true); assert.equal(out.state, 'response-located'); assert.equal(posts(), n + 1);
    const r = calls.at(-1), b = JSON.parse(r.body);
    assert.equal(R.sha(r.body), h.bodyDigest); assert.equal(r.headers.authorization, 'Bearer ' + key);
    assert.equal(r.headers['openai-project'], F.config.profile.projectId); assert.equal(r.headers['openai-organization'], F.config.profile.organizationId);
    assert.equal(b.store, false); assert.equal(b.background, true); assert.deepEqual(b.tools, []); assert.equal(b.model, F.config.model); assert.equal(b.max_output_tokens, 1024);
    const content = b.input[0].content;
    for (const kind of ['source', 'spec', 'diff']) assert.ok(content.some(c => c.text === F.materialBytes[kind].toString()));
    assert.ok(content.some(c => c.image_url === 'data:image/png;base64,' + F.materialBytes.render.toString('base64')));
    const recovered = await lookedUp(s); assert.equal(recovered.observation.response.id, out.response.id);
    for (const flag of ['approvalGranted', 'actorIdentityVerified', 'semanticVerified', 'executionBindingVerified', 'retryAllowed']) assert.equal(recovered[flag], false);
    const journal = J.read(ctx(s), s.run.runId);
    for (const head of [journal.intent.head, journal.locator.head]) {
      const bytes = G.readCommit(ctx(s), head).bytes;
      for (const secret of [key, s.run.owner.token, 'PRIVATE_SOURCE', 'PRIVATE_OUTPUT']) assert.equal(bytes.includes(secret), false);
    }
    assert.equal(G.readRef({ ...ctx(s), ref: A.runRef(ctx(s), s.run.runId) }), null);
    await rejected(() => F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key), 'dispatch_handle_invalid');
    code(() => F.prepare(s), 'execution_unknown'); assert.equal(posts(), n + 1);
  }, true);
  await test('changed material and owner prevent POST; invalid UTF-8 and render rejected', async () => {
    const n = posts(), s = setup(), h = F.prepare(s);
    fs.appendFileSync(path.join(s.root, 'source.bin'), 'changed');
    await rejected(() => F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key)); assert.equal(F.read(s), null);
    const t = setup(), p = F.prepare(t); reclaim(t);
    await rejected(() => F.API.dispatchOpenAiUiReviewRun(p, p.requestDigest, key), 'control_changed');
    code(() => F.prepare(setup({ materialBytes: { ...F.materialBytes, source: Buffer.from([255]) } })), 'material_text_invalid');
    code(() => F.prepare(setup({ materialBytes: { ...F.materialBytes, render: Buffer.from('not an image') } })), 'render_format_unsupported');
    assert.equal(posts(), n);
  });
  await test('profile revision scope and owner mismatch cannot select another GET response', async () => {
    const s = setup(); await dispatch(s); const n = gets();
    for (const field of ['profileId', 'profileRevision', 'projectId', 'organizationId']) {
      await rejected(() => F.lookup(s, key, { ...F.config.profile, [field]: 'other' }), 'dispatch_profile_mismatch');
    }
    await rejected(() => F.lookup(s, key, { ...F.config.profile, responseId: 'resp_other' }), 'dispatch_input_invalid');
    s.run.owner.token = 'a'.repeat(64); await rejected(() => F.lookup(s, key), 'dispatch_run_mismatch'); assert.equal(gets(), n);
  });
  await test('late response remains historical after reclaim but current lookup is denied', async () => {
    const s = setup(); handler = (r, res) => { reclaim(s); send(r, res); };
    assert.equal((await dispatch(s, { ...F.config, timeoutMs: 15000, store: true })).ok, true);
    assert.equal(JSON.parse(calls.at(-1).body).store, true);
    assert.equal(F.read(s).state, 'response-located'); const n = gets();
    await rejected(() => F.lookup(s, key), 'control_changed'); assert.equal(gets(), n);
  });
  await test('control and locator changes during GET invalidate returned output', async () => {
    const s = setup(); await dispatch(s, { ...F.config, timeoutMs: 15000 });
    handler = (r, res) => { reclaim(s); send(r, res); };
    await rejected(() => F.lookup(s, key), 'control_changed');
    handler = send; const t = setup(); await dispatch(t, { ...F.config, timeoutMs: 15000 });
    handler = (r, res) => { F.cmd(t.root, ['update-ref', '-d', J.context(ctx(t), t.run.runId, true).ref]); send(r, res); };
    await rejected(() => F.lookup(t, key), 'dispatch_changed');
  });
  for (const phase of ['before-intent', 'after-intent', 'after-start', 'before-locator', 'after-locator']) {
    await test('killed process at ' + phase + ' never guesses or repeats a sent request', async () => {
      const s = setup(), n = posts(), w = worker(s, phase);
      assert.equal(await w.phase, phase); w.child.kill(); await w.done;
      const beforeStart = ['before-intent', 'after-intent'].includes(phase);
      assert.equal(posts(), n + (['before-locator', 'after-locator'].includes(phase) ? 1 : 0));
      const history = F.read(s);
      if (phase === 'before-intent') assert.equal(history, null);
      else assert.equal(history.state, beforeStart ? 'reserved' : phase === 'after-locator' ? 'response-located' : 'execution-unknown');
      if (beforeStart) { const resumed = await worker(s, 'normal').done; assert.equal(resumed.result.value.ok, true); assert.equal(posts(), n + 1); }
      else { code(() => F.prepare(s), 'execution_unknown'); if (phase === 'after-locator') await lookedUp(s); else await rejected(() => F.lookup(s, key), 'dispatch_locator_missing'); }
    }, phase === 'after-locator');
  }
  for (const phase of ['intent', 'start', 'locator']) {
    await test('lost ' + phase + ' publication acknowledgment is reconciled without repeat POST', async () => {
      const s = setup(), n = posts(), original = G.run;
      G.run = (...args) => {
        const tx = String(args[2]), match = phase === 'intent' ? tx.includes('create refs/leerness/review-dispatches/')
          : phase === 'start' ? tx.includes('update refs/leerness/review-attempts/') : tx.includes('create refs/leerness/review-locators/');
        const result = original(...args); return match ? { ...result, status: 1, stderr: 'fixture lost acknowledgment' } : result;
      };
      try { await rejected(() => dispatch(s), 'publication_uncertain'); } finally { G.run = original; }
      assert.equal(posts(), n + (phase === 'locator' ? 1 : 0));
      if (phase === 'intent') { assert.equal((await dispatch(s)).ok, true); assert.equal(posts(), n + 1); }
      else { code(() => F.prepare(s), 'execution_unknown'); if (phase === 'locator') await lookedUp(s); }
    });
  }
  await test('two processes race at execution fence: exactly one POST', async () => {
    const s = setup(), gate = path.join(arena, 'race'), n = posts();
    const first = worker(s, 'before-start'); assert.equal(await first.phase, 'before-start');
    first.child.kill(); await first.done; // Establish the same durable reservation/intent for both competitors.
    const a = worker(s, 'before-start', gate), b = worker(s, 'before-start', gate);
    assert.equal(await a.phase, 'before-start'); assert.equal(await b.phase, 'before-start'); fs.writeFileSync(gate, 'go');
    const results = await Promise.all([a.done, b.done]);
    for (const out of results) assert.deepEqual(out.contractErrors, []);
    assert.equal(results.filter(r => r.result?.ok && r.result.value.ok).length, 1); assert.equal(posts(), n + 1);
    await lookedUp(s);
  });
  await test('POST accepted but response socket lost leaves unknown without locator or retry', async () => {
    const s = setup(), n = posts(); handler = (_r, res) => res.destroy();
    const out = await dispatch(s); assert.equal(out.ok, false); assert.equal(out.state, 'execution-unknown'); assert.equal(out.retryAllowed, false);
    assert.equal(F.read(s).state, 'execution-unknown'); code(() => F.prepare(s), 'execution_unknown'); assert.equal(posts(), n + 1);
  });
  await test('process killed after socket delivery cannot recover an unobserved response ID', async () => {
    const s = setup(), n = posts(); let received;
    const delivered = new Promise(r => { received = r; }); handler = () => received();
    const w = worker(s, 'normal'); await delivered; w.child.kill(); await w.done;
    assert.equal(posts(), n + 1); assert.equal(F.read(s).state, 'execution-unknown');
    code(() => F.prepare(s), 'execution_unknown'); await rejected(() => F.lookup(s, key), 'dispatch_locator_missing');
  });
  await test('stored intent forbids config substitution and is checked atomically at start', async () => {
    const s = setup(), w = worker(s, 'after-intent'), n = posts();
    assert.equal(await w.phase, 'after-intent'); w.child.kill(); await w.done;
    await rejected(() => dispatch(s, { ...F.config, store: true }), 'dispatch_conflict');
    const original = G.run;
    G.run = (...args) => {
      if (String(args[2]).includes('update refs/leerness/review-attempts/')) {
        F.cmd(s.root, ['update-ref', '-d', J.context(ctx(s), s.run.runId).ref]);
      }
      return original(...args);
    };
    try { await rejected(() => dispatch(s), 'publication_uncertain'); } finally { G.run = original; }
    assert.equal(posts(), n); assert.equal(A.read(ctx(s), s.run.runId).value.state, 'reserved');
  });
  await test('internal submission cannot forge receipt, change body or reuse consumed execution fence', async () => {
    const s = setup(), w = worker(s, 'after-intent'), n = posts();
    assert.equal(await w.phase, 'after-intent'); w.child.kill(); await w.done;
    const c = ctx(s), j = J.read(c, s.run.runId);
    assert.equal(J.locator, undefined, 'provider observations have no caller-JSON publication entry point');
    await rejected(() => J.submit(s.root, s.run.batchId, s.run.runId, j.intent.head, j.attempt.head, Buffer.from('forged body'), key), 'dispatch_body_changed');
    const attempted = A.start(c, s.run.runId, j.attempt, j.intent.head);
    await rejected(() => J.submit(s.root, s.run.batchId, s.run.runId, j.intent.head, attempted.head, Buffer.from('{}'), key), 'execution_unknown');
    assert.equal(F.read(s).state, 'execution-unknown'); assert.equal(posts(), n);
  }, true);
  await test('POST redirect invalid ID and denial never create locator or follow/retry', async () => {
    for (const mode of ['redirect', 'id', 'denied']) {
      const s = setup(), n = posts();
      handler = (r, res) => mode === 'id' ? send(r, res, 200, { object: 'response', id: '../bad', status: 'queued', model: 'fixture', created_at: 1, output: [] })
        : mode === 'redirect' ? (res.writeHead(307, { Location: 'https://invalid.example' }), res.end()) : send(r, res, 403);
      const out = await dispatch(s); assert.equal(out.ok, false); assert.equal(F.read(s).state, 'execution-unknown'); assert.equal(posts(), n + 1);
    }
  });
  await test('GET unavailable denied or timed out cannot grant execution permission', async () => {
    const s = setup(); await dispatch(s, { ...F.config, timeoutMs: 100 }); const n = posts();
    for (const status of [404, 403, null]) {
      handler = (r, res) => { if (status) send(r, res, status); };
      const out = await F.lookup(s, key); assert.equal(out.observation.ok, false); assert.equal(out.retryAllowed, false);
      code(() => F.prepare(s), 'execution_unknown');
    }
    assert.equal(posts(), n);
  });
  await test('malformed wrong-parent wrong-binding and symbolic journals fail closed', async () => {
    const s = setup(); await dispatch(s); const c = ctx(s), j = J.read(c, s.run.runId), ir = J.context(c, s.run.runId).ref, lr = J.context(c, s.run.runId, true).ref;
    for (const [bytes, parent] of [[R.encode(j.locator.value) + '\n', j.attempt.head], [R.encode(j.locator.value), s.control.head],
      [R.encode({ ...j.locator.value, intentHead: s.control.head }), j.attempt.head]]) {
      F.cmd(s.root, ['update-ref', lr, G.prepareCommit(c, parent, bytes)]); code(() => F.read(s));
    }
    F.cmd(s.root, ['update-ref', lr, j.locator.head]);
    const bad = { ...j.intent.value, bindingDigest: 'sha256:' + 'a'.repeat(64) };
    F.cmd(s.root, ['update-ref', ir, G.prepareCommit(c, G.readCommit(c, j.intent.head).parents[0], R.encode(bad))]); code(() => F.read(s));
    F.cmd(s.root, ['update-ref', ir, j.intent.head]); F.cmd(s.root, ['symbolic-ref', lr, c.ref]); code(() => F.read(s), 'ref_invalid');
  });
  await test('dry run and incompatible runtime block before POST', async () => {
    const s = setup(), h = F.prepare(s), before = F.snapshot(s.root), n = posts(), git = require('../lib/git');
    git.setGitDryRun(true);
    try { await rejected(() => F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key), 'E_DRY_RUN_WRITE'); } finally { git.setGitDryRun(false); }
    assert.deepEqual(F.snapshot(s.root), before);
    fs.mkdirSync(path.join(s.root, '.git/leerness')); fs.writeFileSync(path.join(s.root, '.git/leerness/layout.json'), '{"schemaVersion":999}');
    await rejected(() => dispatch(s), 'E_RUNTIME_LAYOUT_INCOMPATIBLE'); assert.equal(posts(), n);
  }, true);
  await test('SHA-256 GC retains locator; linked worktree cannot act as original owner', async () => {
    const s = setup({ format: 'sha256' }); await dispatch(s); F.cmd(s.root, ['gc', '--prune=now', '--quiet']);
    assert.equal(F.read(s).locatorHead.length, 64); await lookedUp(s);
    const linked = path.join(arena, 'linked'); F.cmd(s.root, ['worktree', 'add', '-q', '--detach', linked]);
    const t = { ...s, root: linked }; assert.equal(F.read(t).locatorHead, F.read(s).locatorHead);
    await rejected(() => F.lookup(t, key), 'owner_mismatch');
  });
  assert.deepEqual(network.errors, [], 'transport assertions cannot be swallowed');
  console.log(`${passed}/${total} PASS; actual Git, processes and loopback TLS; no provider calls`);
  if (passed !== total) process.exitCode = 1;
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(async () => {
  for (const child of children) child.kill();
  network?.restore();
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  const resolved = fs.realpathSync(arena); assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('lr-post-'));
  removeTree(resolved, { recursive: true, force: true });
});
