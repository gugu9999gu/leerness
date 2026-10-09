'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bench-utf8-'));
  try {
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], {
      env: { ...process.env, BENCH_PROBE_ROOT: arena }, encoding: 'utf8', timeout: 45000,
    });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');
    if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena), parent = fs.realpathSync(os.tmpdir());
    assert.strictEqual(path.dirname(resolved).toLowerCase(), parent.toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-bench-utf8-'));
    removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const { agentsCmd } = require('../lib/agents');
const { readExecutionEvents } = require('../lib/role-fallback');
const { collectBenchProcess, MAX_OUTPUT_BYTES } = require('../lib/agent-bench-output');
const { setQuiet } = require('../lib/io');
const crypto = require('crypto');
const arena = process.env.BENCH_PROBE_ROOT;
let passed = 0, failed = 0, caseId = 0;
const sample = '한글 English 日本語 中文 🐝 e\u0301';
function fakeChild(action) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.killedCount = 0; child.kill = () => { child.killedCount++; return true; };
  process.nextTick(() => action(child));
  return child;
}
function close(child, code = 0, signal = null) {
  child.stdout.end(); child.stderr.end(); child.emit('close', code, signal);
}
async function bench(spawn, options = {}) {
  const root = path.join(arena, String(++caseId));fs.mkdirSync(path.join(root, '.leerness'), { recursive: true });
  const oldWrite = process.stdout.write, oldExit = process.exitCode;
  const oldFlag = process.env.LEERNESS_ENABLE_CODEX;process.env.LEERNESS_ENABLE_CODEX = '1';
  let output = '', calls = 0;process.exitCode = 0;setQuiet(false);
  process.stdout.write = function (chunk, ...args) { output += chunk; const cb = args.find(a => typeof a === 'function'); if (cb) cb(); return true; };
  try {
    const result = await agentsCmd(root, 'bench', ['utf8 probe'], {
      VERSION: 'test', uiLang: 'en', rawArgv: ['agents', 'bench'],
      has: f => f === '--json', arg: (f, fallback) => f === '--timeout' ? (options.timeout || '1') : fallback,
      _allProviders: () => (options.providers || ['codex']).map(id => ({ id, bin: id, envFlag: 'LEERNESS_ENABLE_CODEX' })),
      _checkAgent: () => ({ status: 'ready' }), _loadEnvFile: () => {}, _normalizeRole: x => x,
      _spawnPortable: () => { calls++;return spawn(calls); },
    });
    return { result, output, calls, exitCode: process.exitCode || 0, events: readExecutionEvents(root, 100).events };
  } finally {
    process.stdout.write = oldWrite;process.exitCode = oldExit;setQuiet(false);
    if (oldFlag === undefined) delete process.env.LEERNESS_ENABLE_CODEX;else process.env.LEERNESS_ENABLE_CODEX = oldFlag;
  }
}
async function test(name, fn) {
  try { await fn();passed++;console.log('PASS ' + name); }
  catch (error) { failed++;console.error('FAIL ' + name + ': ' + error.message); }
}
(async () => {
  await test('actual bench preserves UTF-8 split at every byte boundary', async () => {
    const r = await bench(() => fakeChild(c => { for (const byte of Buffer.from(sample)) c.stdout.write(Buffer.from([byte]));close(c); }));
    assert.strictEqual(r.result[0].stdout, sample);
    assert.strictEqual(r.result[0].ok, true);
    assert.strictEqual(r.events.filter(e => e.event === 'benchmark.completed').length, 1);
  });
  if (process.argv.includes('--repro')) return;
  await test('stderr decodes split Unicode without exposing diagnostic text', async () => {
    const r = await bench(() => fakeChild(c => { c.stdout.write('ready');for (const b of Buffer.from(sample)) c.stderr.write(Buffer.from([b]));close(c); }));
    assert.strictEqual(r.result[0].stderrLen, sample.length);
    assert.strictEqual(r.result[0].stderrBytes, Buffer.byteLength(sample));
    assert.strictEqual(r.result[0].ok, true);assert.ok(!r.output.includes(sample));
  });
  await test('full counts and digest remain distinct from last three display lines', async () => {
    const content = sample + '\r\nfirst\r\nsecond\r\nthird\r\n';
    const r = await bench(() => fakeChild(c => { c.stdout.write(content);close(c); }));const e = r.result[0];
    assert.strictEqual(e.stdout, 'first\nsecond\nthird');assert.strictEqual(e.stdoutChars, content.length);
    assert.strictEqual(e.stdoutBytes, Buffer.byteLength(content));assert.strictEqual(e.stdoutSha256, crypto.createHash('sha256').update(content).digest('hex'));
    assert.strictEqual(e.stdoutTruncated, true);assert.strictEqual(e.outputComplete, true);
    assert.ok(r.events.find(x => x.event === 'benchmark.completed').result.evidence.includes('responseChars=' + content.length));
  });
  await test('bounded display tail cannot manufacture a lone surrogate', async () => {
    const content = 'start🐝' + 'x'.repeat(4095);
    const r = await bench(() => fakeChild(c => { c.stdout.write(content);close(c); }));const e = r.result[0];
    assert.ok(e.stdout.length <= 4096);assert.strictEqual(e.stdoutChars, content.length);
    assert.strictEqual(Buffer.from(e.stdout).toString(), e.stdout);assert.strictEqual(e.ok, true);
  });
  await test('invalid stdout cannot become success even when close reports zero', async () => {
    const r = await bench(() => fakeChild(c => { c.stdout.write(Buffer.from([255]));close(c); }));const e = r.result[0];
    assert.strictEqual(e.errorCode, 'output_encoding_invalid');assert.strictEqual(e.errorStream, 'stdout');
    assert.strictEqual(e.stdout, '');assert.strictEqual(e.stdoutSha256, null);assert.strictEqual(r.exitCode, 1);
    assert.strictEqual(r.events.filter(x => x.event === 'benchmark.failed').length, 1);
    assert.strictEqual(r.events.filter(x => x.event === 'benchmark.completed').length, 0);
  });
  await test('final decoder flush rejects an incomplete character', async () => {
    const r = await bench(() => fakeChild(c => { c.stdout.write(Buffer.from([0xe3, 0x81]));close(c); }));
    assert.strictEqual(r.result[0].errorCode, 'output_encoding_invalid');assert.strictEqual(r.result[0].outputComplete, false);
  });
  await test('invalid stderr is explicit rather than silently reinterpreted', async () => {
    const r = await bench(() => fakeChild(c => { c.stdout.write('answer');c.stderr.write(Buffer.from([255]));close(c); }));
    assert.strictEqual(r.result[0].errorStream, 'stderr');assert.strictEqual(r.result[0].ok, false);
  });
  await test('combined output limit rejects excess instead of publishing a partial response', async () => {
    const r = await bench(() => fakeChild(c => { c.stdout.write(Buffer.alloc(MAX_OUTPUT_BYTES, 65));c.stderr.write('x');close(c); }));
    assert.strictEqual(r.result[0].errorCode, 'output_limit');assert.strictEqual(r.result[0].stdout, '');assert.strictEqual(r.exitCode, 1);
  });
  await test('exact byte cap is valid and tail truncation is only presentation', async () => {
    const content = Buffer.alloc(MAX_OUTPUT_BYTES, 65);
    const e = await collectBenchProcess(fakeChild(c => { c.stdout.write(content);close(c); }), { timeoutMs: 1000 });
    assert.strictEqual(e.ok, true);assert.strictEqual(e.stdoutBytes, MAX_OUTPUT_BYTES);assert.strictEqual(e.stdout.length, 4096);
    assert.strictEqual(e.stdoutSha256, crypto.createHash('sha256').update(content).digest('hex'));
  });
  await test('stream error produces one failure and redacts the original message', async () => {
    const r = await bench(() => fakeChild(c => { c.stdout.emit('error', new Error('private diagnostic'));close(c); }));
    assert.strictEqual(r.result[0].errorCode, 'output_stream_error');assert.ok(!r.output.includes('private diagnostic'));
    assert.strictEqual(r.events.filter(x => x.event === 'benchmark.failed').length, 1);
  });
  await test('timeout settles without close and ignores later error/close events', async () => {
    let child;const t = Date.now();
    const r = await bench(() => (child = fakeChild(c => { c.stdout.write('partial'); })));
    assert.ok(Date.now() - t < 5000);assert.strictEqual(r.result[0].timedOut, true);
    assert.strictEqual(r.result[0].terminationConfirmed, false);assert.strictEqual(r.result[0].stdout, '');
    assert.strictEqual(child.killedCount, 1);child.emit('error', new Error('late'));child.emit('close', 0);
    assert.strictEqual(r.events.filter(x => x.event === 'benchmark.failed').length, 1);
  });
  await test('spawn error followed by close is one non-executed failure', async () => {
    const r = await bench(() => fakeChild(c => { c.emit('error', new Error('spawn private'));close(c, -1); }));
    assert.strictEqual(r.result[0].executed, false);assert.strictEqual(r.events.filter(x => x.event === 'benchmark.failed').length, 1);
  });
  await test('post-spawn process error retains execution evidence', async () => {
    const r = await bench(() => fakeChild(c => { c.emit('spawn');c.emit('error', new Error('late'));close(c, -1); }));
    assert.strictEqual(r.result[0].executed, true);assert.strictEqual(r.result[0].errorCode, 'process_error');
  });
  await test('invalid timeout is rejected before provider launch or ledger writes', async () => {
    for (const timeout of ['abc', '0', '-1', '1.5', '1s', '3601', '2147483648', 'Infinity']) {
      const r = await bench(() => { throw new Error('must not launch'); }, { timeout });
      assert.strictEqual(r.calls, 0);assert.strictEqual(r.events.length, 0);assert.strictEqual(r.exitCode, 1);
      assert.strictEqual(JSON.parse(r.output).code, 'invalid_bench_timeout');
    }
  });
  await test('one failed provider does not discard a concurrent successful provider', async () => {
    const r = await bench(n => fakeChild(c => { c.stdout.write(n === 1 ? Buffer.from([255]) : sample);close(c); }), { providers: ['codex', 'claude'] });
    assert.strictEqual(r.result.length, 2);assert.strictEqual(r.result.filter(e => e.ok).length, 1);
    assert.strictEqual(r.events.filter(e => /^benchmark\.(completed|failed)$/.test(e.event)).length, 2);assert.strictEqual(r.exitCode, 1);
  });
  await test('real Node child preserves bytes delivered one at a time', async () => {
    const code = `const b=Buffer.from('${Buffer.from(sample).toString('base64')}','base64');let i=0;function next(){if(i<b.length)process.stdout.write(b.subarray(i,i+1),()=>{i++;setTimeout(next,2);});}next();`;
    const r = await bench(() => cp.spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] }));
    assert.strictEqual(r.result[0].stdout, sample);assert.strictEqual(r.result[0].terminationConfirmed, true);
  });
  await test('real Node child timeout is bounded and reported as a timeout', async () => {
    const child = cp.spawn(process.execPath, ['-e', "process.stdout.write('ready');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'pipe'] });
    const e = await collectBenchProcess(child, { timeoutMs: 100, graceMs: 1000 });
    assert.strictEqual(e.timedOut, true);assert.strictEqual(e.ok, false);assert.strictEqual(e.executed, true);
    assert.strictEqual(e.terminationConfirmed, true);
  });
  await test('stderr-only and nonzero exit retain explicit transport failure semantics', async () => {
    const r = await bench(() => fakeChild(c => { c.stderr.write(sample);close(c); }));
    assert.strictEqual(r.result[0].errorCode, 'empty_stdout');assert.strictEqual(r.result[0].stderrBytes, Buffer.byteLength(sample));
    const e = await collectBenchProcess(fakeChild(c => { c.stdout.write('partial');close(c, 3); }), { timeoutMs: 1000 });
    assert.strictEqual(e.errorCode, 'process_exit');assert.strictEqual(e.exit, 3);assert.strictEqual(e.outputComplete, true);
  });
  await test('already-decoded output is rejected because byte provenance is lost', async () => {
    const e = await collectBenchProcess(fakeChild(c => { c.stdout.setEncoding('utf8');c.stdout.write(sample);close(c); }), { timeoutMs: 1000 });
    assert.strictEqual(e.errorCode, 'output_chunk_invalid');
  });
})().catch(error => { failed++;console.error(error.stack); }).finally(() => {
  console.log(`Tests: ${passed}/${passed + failed} passed`);process.exitCode = failed ? 1 : 0;
});
