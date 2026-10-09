'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const { createRequire } = require('module');
const { createHash } = require('crypto');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { MAX_OUTPUT_BYTES } = require('../lib/process-output');
// Bound the entire probe, including leaked timers. All spawned programs are Node
// byte fixtures, never provider CLIs, models or credential-bearing commands.
if (!process.argv.includes('--worker')) {
  const r = cp.spawnSync(process.execPath, [__filename, '--worker'], { encoding: 'utf8', timeout: 45000 });
  process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');
  if (r.error) process.stderr.write(r.error.message + '\n');
  process.exitCode = r.status === 0 && !r.error ? 0 : 1;return;
}
const cli = path.resolve(__dirname, '../bin/leerness.js');
const source = fs.readFileSync(cli, 'utf8');
const body = source.slice(source.indexOf('async function _cliChatStream('), source.indexOf('// 1.9.149: observability lite'));
const sample = '한글 English 中文 日本語 🐝 e\u0301';
const digest = value => createHash('sha256').update(value).digest('hex');
const delta = text => JSON.stringify({ type: 'content_block_delta', delta: { text } });
const bytes = value => [...Buffer.from(value)].map(x => Buffer.from([x]));
let passed = 0, failed = 0;
function fakeChild(action, options = {}) {
  const child = new EventEmitter();child.pid = 123;
  child.stdout = new PassThrough();child.stderr = new PassThrough();child.stdin = new PassThrough();
  child.kills = 0;child.kill = () => { child.kills++;if (options.closeOnKill) close(child, null, 'SIGTERM');return true; };
  child.unref = () => { child.unreferenced = true; };
  process.nextTick(() => action(child));return child;
}
function close(child, code = 0, signal = null) {
  child.stdout.end();child.stderr.end();child.emit('close', code, signal);
}
async function invoke(action, options = {}) {
  const records = [], displayed = [], calls = [];
  let child, stdin = Buffer.alloc(0);
  const output = { isTTY: !!options.tty, write(text) {
    if (options.writeFailure && displayed.length >= options.writeFailure) throw new Error('PRIVATE render failure');
    displayed.push(String(text));return true;
  } };
  const context = { require: createRequire(cli), module: { exports: {} },
    process: { env: { LEERNESS_REPL_STREAM_FORMAT: options.json ? 'json' : '' }, cwd: () => process.cwd(), stdout: output },
    EXTERNAL_AGENTS: ['claude', 'codex', 'agy', 'copilot', 'unsupported'].map(id => ({ id, envFlag: 'PROBE_ONLY' })),
    _checkAgent: () => ({ status: options.disabled ? 'disabled' : 'ready' }),
    _scrubEnv: () => ({ PROBE: 'scrubbed' }),
    _recordRun: (_, record) => records.push(record),
    _spawnPortableArgv: (cmd, args, spawnOptions) => {
      calls.push({ cmd, args, ...spawnOptions });
      if (options.spawnThrow) throw new Error('PRIVATE spawn failure');
      child = options.realSpawn ? options.realSpawn() : fakeChild(action, options);
      if (!options.realSpawn) child.stdin.on('data', chunk => { stdin = Buffer.concat([stdin, chunk]); });
      if (options.inputThrow) child.stdin.end = () => { throw new Error('PRIVATE stdin failure'); };
      return child;
    },
  };
  vm.runInNewContext(body + '\nmodule.exports = _cliChatStream;', context, { filename: cli });
  const result = await context.module.exports(process.cwd(), options.provider || 'claude', options.prompt ?? sample,
    { noSpinner: options.spinner !== true, timeout: options.timeout ?? 1000 });
  return { result, records, displayed: displayed.join(''), calls, child, stdin };
}
function success(r, response = sample) {
  assert.strictEqual(r.result.ok, true);assert.strictEqual(r.result.response, response);
  assert.strictEqual(r.records.length, 1);assert.strictEqual(r.records[0].ok, true);
}
function failure(r, code) {
  assert.strictEqual(r.result.ok, false);assert.strictEqual(r.result.errorCode, code);
  assert.strictEqual(r.result.response, undefined);
  assert.strictEqual(r.records.length, 1);assert.strictEqual(r.records[0].ok, false);
  assert.ok(!JSON.stringify([r.result, r.records]).includes('PRIVATE'));
}
async function test(name, fn) {
  try { await fn();passed++;console.log('PASS ' + name); }
  catch (error) { failed++;console.error('FAIL ' + name + ': ' + error.stack); }
}
(async () => {
  await test('actual CLI wrapper preserves stdout and stderr split at every byte', async () => {
    const r = await invoke(c => { for (const b of bytes(sample)) { c.stdout.write(b);c.stderr.write(b); }close(c); });
    success(r);assert.ok(r.displayed.includes(sample));assert.ok(!r.displayed.includes('\uFFFD'));
    assert.deepStrictEqual(r.stdin, Buffer.from(sample));
    assert.strictEqual(r.records[0].stdinSha256, digest(sample));assert.strictEqual(r.records[0].stdoutSha256, digest(sample));
    assert.strictEqual(r.records[0].stderrBytes, Buffer.byteLength(sample));
    assert.ok(!JSON.stringify(r.records).includes(sample));
  });
  await test('final JSON frame without newline preserves split UTF-8', async () => {
    const r = await invoke(c => { for (const b of bytes(delta(sample))) c.stdout.write(b);close(c); }, { json: true });success(r);
    assert.strictEqual(r.records[0].stdoutSha256, digest(delta(sample)));
  });
  await test('JSON CRLF frames and last frame appear once', async () => {
    const r = await invoke(c => { c.stdout.write(delta('한글 ') + '\r\n\r\n' + delta('中文'));close(c); }, { json: true });
    success(r, '한글 中文');assert.strictEqual(r.displayed.split('한글 中文').length - 1, 1);
  });
  await test('valid replacement characters, BOM and decomposed Unicode are preserved', async () => {
    const text = 'x\uFEFF' + sample + '\uFFFD y\r\nz';
    const r = await invoke(c => { for (const b of bytes(text)) c.stdout.write(b);close(c); });success(r, text);
    assert.ok(r.displayed.includes(text));
  });
  await test('existing response trim does not remove BOM from display or byte digest', async () => {
    const raw = '\uFEFF' + sample + '\r\n';
    const r = await invoke(c => { c.stdout.write(raw);close(c); });success(r);assert.ok(r.displayed.includes(raw));
    assert.strictEqual(r.records[0].stdoutSha256, digest(raw));
  });
  for (const stream of ['stdout', 'stderr']) {
    await test('invalid ' + stream + ' fails despite exit zero', async () => {
      const r = await invoke(c => { c.stdout.write('PRIVATE prefix');c[stream].write(Buffer.from([255]));close(c); });
      failure(r, 'output_encoding_invalid');assert.strictEqual(r.result.outputComplete, false);assert.strictEqual(r.records[0].stdoutSha256, null);
    });
    await test('truncated ' + stream + ' fails at final decoder flush', async () => {
      const r = await invoke(c => { c.stdout.write('PRIVATE prefix');c[stream].write(Buffer.from([0xed, 0x95]));close(c); });failure(r, 'output_encoding_invalid');
    });
  }
  await test('malformed and truncated JSON cannot fall back to a successful answer', async () => {
    for (const frame of ['PRIVATE malformed\n', delta(sample) + '\n{"type":', 'null', '[]', '42']) {
      const r = await invoke(c => { c.stdout.write(frame);close(c); }, { json: true });failure(r, 'response_format_invalid');
    }
  });
  await test('escaped lone surrogates and non-string text fields are rejected', async () => {
    for (const value of ['\uD800', '\uDC00', 42, {}, null]) {
      const r = await invoke(c => { c.stdout.write(delta(value));close(c); }, { json: true });failure(r, 'response_format_invalid');
    }
  });
  await test('provider error events cannot accompany a successful partial answer', async () => {
    for (const event of [{ type: 'error', error: 'PRIVATE' }, { type: 'result', is_error: true }, { type: 'content_block_delta', is_error: true, delta: { text: sample } }]) {
      const r = await invoke(c => { c.stdout.write(delta('PRIVATE partial') + '\n' + JSON.stringify(event));close(c); }, { json: true });failure(r, 'response_format_invalid');
    }
  });
  await test('unknown events carry no fabricated assistant response', async () => {
    const r = await invoke(c => { c.stdout.write('{"type":"future_event","text":"PRIVATE"}');close(c); }, { json: true });failure(r, 'empty_response');
  });
  await test('existing thinking and tool labels preserve caller Unicode', async () => {
    const frames = [{ type: 'message_start', message: { model: '테스트' } }, { type: 'thinking_delta', delta: { thinking: sample } },
      { type: 'content_block_start', content_block: { type: 'tool_use', name: '읽기🐝' } }, { type: 'content_block_stop' }];
    const r = await invoke(c => { c.stdout.write(frames.map(x => JSON.stringify(x)).join('\n') + '\n' + delta(sample));close(c); }, { json: true });
    success(r);assert.ok(r.displayed.includes('Tool: 읽기🐝'));assert.ok(!r.displayed.includes('🔧'));assert.ok(r.displayed.includes('[테스트]'));
  });
  await test('blank stdout and stderr-only runs are failures', async () => {
    const r = await invoke(c => { c.stdout.write(' \r\n');c.stderr.write('PRIVATE');close(c); });failure(r, 'empty_stdout');
  });
  await test('combined one MiB limit prevents partial success', async () => {
    const r = await invoke(c => { c.stdout.write(Buffer.alloc(MAX_OUTPUT_BYTES, 65));c.stderr.write('x');close(c); });failure(r, 'output_limit');
  });
  await test('exact one MiB output cap succeeds without truncating response', async () => {
    const r = await invoke(c => { c.stdout.write(Buffer.alloc(MAX_OUTPUT_BYTES, 65));close(c); });success(r, 'A'.repeat(MAX_OUTPUT_BYTES));
  });
  await test('nonzero exit cannot save partial output as an assistant response', async () => {
    const r = await invoke(c => { c.stdout.write('PRIVATE prefix');c.stderr.write('PRIVATE diagnostic');close(c, 2); });failure(r, 'process_exit');
    assert.strictEqual(r.result.outputComplete, true);assert.strictEqual(r.records[0].exitCode, 2);
  });
  await test('asynchronous process error and late close produce one failed record', async () => {
    const r = await invoke(c => { c.emit('error', new Error('PRIVATE'));close(c); });failure(r, 'process_error');
    r.child.emit('error', new Error('PRIVATE late'));r.child.emit('close', 0);assert.strictEqual(r.records.length, 1);
  });
  await test('synchronous spawn error has one bounded record without error text', async () => {
    const r = await invoke(() => {}, { spawnThrow: true });failure(r, 'process_error');assert.strictEqual(r.result.executed, false);
  });
  await test('output stream errors and pre-decoded chunks cannot report success', async () => {
    const streamError = await invoke(c => { c.stdout.emit('error', new Error('PRIVATE'));close(c); });failure(streamError, 'output_stream_error');
    const decoded = await invoke(c => { c.stdout.emit('data', '한글');close(c); });failure(decoded, 'output_chunk_invalid');
  });
  await test('stdin synchronous and asynchronous errors prevent success', async () => {
    const sync = await invoke(c => close(c), { inputThrow: true });failure(sync, 'input_stream_error');
    const asyncError = await invoke(c => { c.stdin.emit('error', new Error('PRIVATE EPIPE'));c.stdout.write(sample);close(c); });failure(asyncError, 'input_stream_error');
  });
  await test('timeout settles when no close arrives and detaches late data', async () => {
    const start = Date.now();const r = await invoke(() => {}, { timeout: 20 });failure(r, 'timeout');
    assert.ok(Date.now() - start < 2000);assert.strictEqual(r.result.terminationConfirmed, false);
    assert.strictEqual(r.child.kills, 1);assert.strictEqual(r.child.unreferenced, true);
    r.child.stdout.emit('data', Buffer.from('late'));r.child.stdout.emit('error', new Error('PRIVATE late'));r.child.emit('close', 0);
    assert.strictEqual(r.records.length, 1);
  });
  await test('synchronous close during kill keeps timeout failure', async () => {
    const r = await invoke(() => {}, { timeout: 20, closeOnKill: true });failure(r, 'timeout');assert.strictEqual(r.result.terminationConfirmed, true);
  });
  await test('exit without drained pipes waits only until deadline', async () => {
    const r = await invoke(c => { c.stdout.write(sample);c.emit('exit', 0); }, { timeout: 20 });failure(r, 'timeout');assert.strictEqual(r.result.terminationConfirmed, true);
  });
  await test('TTY color and idle spinner terminate with the stream', async () => {
    const r = await invoke(c => setTimeout(() => { c.stdout.write('+ 한글\n- 中文\n@@ 日本 @@\n');close(c); }, 950),
      { tty: true, spinner: true, timeout: 2000 });success(r, '+ 한글\n- 中文\n@@ 日本 @@');
    assert.ok(r.displayed.includes('추론중'));assert.ok(r.displayed.includes('\x1b[32m+ 한글'));assert.ok(r.displayed.includes('\r\x1b[K'));
  });
  await test('renderer failure still cleans the child and records failure', async () => {
    const r = await invoke(c => { c.stdout.write('one\ntwo\n');close(c); }, { writeFailure: 1 });failure(r, 'output_display_error');
  });
  await test('preflight rejects invalid prompts, timeouts and disabled providers before spawn', async () => {
    for (const options of [{ prompt: '\uD800' }, { timeout: 0 }, { timeout: -1 }, { timeout: 2147483648 }, { timeout: '1' }, { disabled: true }, { provider: 'missing' }, { provider: 'unsupported' }]) {
      const r = await invoke(() => {}, options);assert.strictEqual(r.result.ok, false);assert.strictEqual(r.calls.length, 0);assert.strictEqual(r.records.length, 0);
    }
  });
  await test('provider command contracts, scrubbed environment and cwd remain intact', async () => {
    for (const provider of ['claude', 'codex', 'agy', 'copilot']) {
      const r = await invoke(c => { c.stdout.write(sample);close(c); }, { provider, json: provider !== 'claude', prompt: sample + ' $(unsafe);"' });success(r);
      const call = r.calls[0];assert.strictEqual(call.cwd, process.cwd());assert.deepStrictEqual(call.env, { PROBE: 'scrubbed' });
      assert.strictEqual(call.shell, undefined);
      if (['claude', 'codex'].includes(provider)) { assert.ok(!call.args.includes(sample + ' $(unsafe);"'));assert.strictEqual(r.stdin.toString(), sample + ' $(unsafe);"'); }
      else { assert.strictEqual(call.args.at(-1), sample + ' $(unsafe);"');assert.strictEqual(r.stdin.length, 0); }
    }
  });
  await test('real Node child receives exact stdin bytes and returns split Unicode', async () => {
    const script = "const chunks=[];process.stdin.on('data',b=>chunks.push(b));process.stdin.on('end',()=>{const b=Buffer.concat(chunks);let i=0;function next(){if(i===b.length)return;process.stdout.write(b.subarray(i,i+1));i++;setImmediate(next);}next();});";
    const r = await invoke(() => {}, { timeout: 5000, realSpawn: () => cp.spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'] }) });success(r);
    assert.strictEqual(r.records[0].stdinSha256, r.records[0].stdoutSha256);
  });
  await test('real Node child with unfinished UTF-8 fails after close', async () => {
    const r = await invoke(() => {}, { timeout: 5000, realSpawn: () => cp.spawn(process.execPath, ['-e', "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(Buffer.from([0xed,0x95])));"], { stdio: ['pipe', 'pipe', 'pipe'] }) });failure(r, 'output_encoding_invalid');
  });
  console.log(`Tests: ${passed}/${passed + failed} passed`);if (failed) process.exitCode = 1;
})().catch(error => { console.error(error);process.exitCode = 1; });
