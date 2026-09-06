'use strict';

// Observation integration only: original E2E predicates, real temp files, no heavyweight CLI.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const cp = require('node:child_process'), vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..'), CLI = path.join(root, 'bin', 'leerness.js');
const e2e = path.join(__dirname, 'e2e.js'), helper = path.join(__dirname, 'e2e-child-diagnostics.js');
const source = fs.readFileSync(e2e, 'utf8').replace(/\r\n/g, '\n');
const tempBase = fs.realpathSync(os.tmpdir());
const arena = fs.mkdtempSync(path.join(tempBase, 'leerness-e2e-child-diagnostics-'));
const failures = []; let passed = 0;
const check = (name, body) => {
  try { body(); passed++; console.log('PASS ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.error('FAIL ' + name + ': ' + e.message); }
};
const snapshot = file => ({ sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtimeMs: fs.statSync(file).mtimeMs });
const files = [e2e, CLI, ...(fs.existsSync(helper) ? [helper] : [])];
const before = files.map(snapshot);
const unique = marker => {
  const i = source.indexOf(marker);
  assert(i >= 0 && source.indexOf(marker, i + marker.length) === -1, 'source marker missing/ambiguous: ' + marker);
  return i;
};
const extract = (start, end, precedingCounter = false) => {
  let a = unique(start); const b = unique(end);
  if (precedingCounter) {
    const counter = source.lastIndexOf('total++;\n{', a);
    assert(counter >= 0 && /^total\+\+;\n\{\s*$/.test(source.slice(counter, a)), 'handoff counter boundary drift');
    a = counter;
  }
  assert(b > a, 'source markers reversed');
  const block = source.slice(a, b);
  assert.equal((block.match(/total\+\+;/g) || []).length, 1, 'expected exactly one original case');
  return block;
};
const objects = lines => {
  const found = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, 'status') && Object.hasOwn(value, 'timeoutMs')) found.push(value);
    Object.values(value).forEach(visit);
  };
  for (const line of lines) for (let i = 0; i < line.length; i++) {
    if (!'{['.includes(line[i])) continue;
    try { visit(JSON.parse(line.slice(i))); break; } catch {}
  }
  return found;
};
const diagnostics = (run, result, timeoutMs, report) => {
  const d = objects(run.lines).find(x => x.timeoutMs === timeoutMs && x.status === result.status);
  assert(d, 'original failure output omitted child diagnostics');
  for (const key of ['status', 'signal']) assert.equal(d[key], result[key] ?? null, key);
  for (const [key, value] of [['errorCode', result.error?.code], ['errno', result.error?.errno]]) assert.equal(d[key], value ?? null, key);
  assert.equal(d.errorMessage, result.error ? String(result.error.message).slice(0, 160) : null);
  assert(Number.isFinite(d.elapsedMs) && d.elapsedMs >= 0, 'elapsedMs must be a nonnegative number');
  for (const stream of ['stdout', 'stderr']) {
    const text = result[stream] == null ? null : String(result[stream]);
    assert.equal(d[stream + 'Bytes'], text === null ? null : Buffer.byteLength(text), stream + ' bytes');
    assert.equal(d[stream + 'Tail'], text === null ? null : text.slice(-256), stream + ' bounded tail');
  }
  if (!report) return assert.equal(d.selftest, null);
  assert(d.selftest, 'doctor selftest diagnostics missing');
  for (const key of ['pass', 'total', 'ok']) assert.equal(d.selftest[key], report.selftest[key]);
  assert.equal(d.selftest.failedCount, report.selftest.failed.length);
  assert.deepEqual(d.selftest.failed, report.selftest.failed.slice(0, 5).map(x => String(x).slice(0, 120)));
};

try {
  const blocks = {
    handoff: extract('// handoff가 fresh migration-report (24h 내) 시 자동 알림', '// 1.9.40 회귀: release pack 통합 명령', true),
    surface: extract('// 1.9.315 회귀 (UR-0054 설치리뷰): doc/surface 정합', '// 1.9.316 회귀 (drift 마커 버그):'),
    json: extract('// 1.36.121 — `--json` stderr 계약을 **selftest 하나가 아니라 명령 전반**에 건다.', '// 1.36.124 — MCP 서버를 **실제 JSON-RPC 로** 두드린다.'),
  };
  const childDiagnostics = /\bchildDiagnostics\b/.test(source) ? require(helper).childDiagnostics : undefined;
  if (/\bchildDiagnostics\b/.test(source)) assert.equal(typeof childDiagnostics, 'function');
  const healthyReport = { version: 'diagnostic-fixture', mcpTools: 98, healthy: true, ok: true, selftest: { pass: 1, total: 1, ok: true, failed: [] } };
  const unhealthyReport = { ...healthyReport, healthy: false, ok: false, selftest: { pass: 0, total: 7, ok: false, failed: ['diagnostic-doctor-owned-failure', ...Array.from({ length: 6 }, (_, i) => 'failure-' + i + '-' + 'x'.repeat(150))] } };
  const capture = (code, timeout) => {
    const started = performance.now();
    const r = cp.spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout, cwd: arena, windowsHide: true });
    console.log('native fixture ' + JSON.stringify({ status: r.status, signal: r.signal, errorCode: r.error?.code ?? null, errno: r.error?.errno ?? null, elapsedMs: performance.now() - started, timeoutMs: timeout, stdoutBytes: Buffer.byteLength(r.stdout || ''), stderrBytes: Buffer.byteLength(r.stderr || '') }));
    return r;
  };
  const timed = capture('setInterval(() => {}, 1000)', 300);
  assert.equal(timed.status, null); assert.equal(timed.error?.code, 'ETIMEDOUT');
  const unhealthy = capture('process.stdout.write(' + JSON.stringify(JSON.stringify(unhealthyReport)) + '); process.stderr.write("fixture-stderr-" + "e".repeat(300)); process.exitCode = 1;', 5000);
  assert.equal(unhealthy.status, 1); assert.equal(unhealthy.error, undefined);
  const success = { status: 0, signal: null, stdout: JSON.stringify(healthyReport), stderr: '' };
  const ignored = { ...success, stdout: null, stderr: null };
  const execute = (name, failingResult) => {
    const lines = [], calls = [];
    const context = { fs, path, os: { ...os, tmpdir: () => arena }, process: { execPath: process.execPath, env: { ...process.env } }, CLI, performance, childDiagnostics, total: 0, failed: 0,
      console: { log: (...args) => lines.push(args.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')) },
      cp: { spawnSync: (executable, args, options) => {
        assert.equal(executable, process.execPath); assert.equal(args[0], CLI);
        const command = args[1]; calls.push({ command, options });
        if (failingResult && command === (name === 'handoff' ? 'handoff' : 'doctor')) return failingResult;
        if (command === 'migrate') return ignored;
        if (command === 'handoff' && name === 'handoff') return { ...success, stdout: 'AI must re-read' };
        if (command === 'commands' && name === 'surface') return { ...success, stdout: 'MCP 도구: 98' };
        return success;
      } } };
    vm.runInNewContext(blocks[name], context, { filename: 'original-e2e-' + name + '.js', timeout: 5000 });
    assert.equal(context.total, 1); assert.equal(context.failed, failingResult ? 1 : 0, 'original case verdict changed');
    assert(lines.some(line => line.startsWith(failingResult ? '✗' : '✓')), 'original verdict output missing');
    return { lines, calls };
  };
  const healthy = {};
  for (const name of Object.keys(blocks)) check(name + ' original healthy predicates', () => { healthy[name] = execute(name); });
  check('original child budgets and doctor parent margin', () => {
    assert.deepEqual(healthy.handoff.calls.map(c => c.options.timeout), [60000, 15000]);
    assert.equal(healthy.handoff.calls[0].options.stdio, 'ignore');
    assert.deepEqual(healthy.surface.calls.map(c => c.options.timeout), [300000, 15000]);
    const bin = fs.readFileSync(CLI, 'utf8');
    const internal = bin.slice(bin.indexOf('function _doctorSelftestReport()'), bin.indexOf('function doctorCmd('));
    const budgets = [...internal.matchAll(/timeout:\s*(\d+)/g)];
    assert.equal(budgets.length, 1, 'doctor internal timeout marker drift');
    assert.equal(Number(budgets[0][1]), 900000);
    assert.equal(healthy.json.calls.length, 16); assert.equal(healthy.json.calls[0].options.timeout, 300000);
    for (const call of healthy.json.calls.slice(1)) assert.equal(call.options.timeout, call.command === 'doctor' ? Number(budgets[0][1]) + 90000 : 180000, call.command + ' timeout');
    assert.equal(healthy.json.calls.filter(c => c.command === 'doctor').length, 1);
  });
  for (const name of Object.keys(blocks)) check(name + ' actual timeout remains failure with diagnostics', () => {
    const run = execute(name, timed);
    diagnostics(run, timed, name === 'handoff' ? 15000 : name === 'surface' ? 300000 : 990000);
    if (name === 'handoff') diagnostics(run, ignored, 60000);
  });
  for (const name of ['surface', 'json']) check(name + ' actual unhealthy selftest remains failure with bounded names', () => {
    diagnostics(execute(name, unhealthy), unhealthy, name === 'surface' ? 300000 : 990000, unhealthyReport);
  });
} catch (e) { failures.push(e.stack || String(e)); }
finally {
  check('input source SHA256 and mtime preserved', () => assert.deepEqual(files.map(snapshot), before));
  check('owned fixture cleanup', () => {
    assert.equal(path.dirname(arena), tempBase); assert(path.basename(arena).startsWith('leerness-e2e-child-diagnostics-'));
    assert(!fs.lstatSync(arena).isSymbolicLink()); fs.rmSync(arena, { recursive: true, force: true });
  });
}
console.log(`E2E child diagnostics probe: ${passed}/${passed + failures.length} checks passed (not product E2E evidence)`);
if (failures.length) { console.error('E2E child diagnostics contract failed\n' + failures.join('\n')); process.exitCode = 1; }
