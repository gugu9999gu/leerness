'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { Readable, Writable } = require('node:stream');
const adapter = require('../lib/ui-review-transport');
const scan = require('../lib/ui-boundary-scanner');
const review = require('../lib/ui-review');
const F = require('./ui-review-fixture');
const { LEGACY_WORKSPACE_DIR } = require('../lib/workspace-dir');
const { removeTree } = require('./temp-cleanup');
const entry = path.resolve(__dirname, '../bin/leerness.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-ui-cli-'));
const tests = [], test = (name, run) => tests.push({ name, run });
const surface = text => ({ kind: 'text', exposure: 'rendered', text, attribute: null });
const input = (surfaces = [surface('TODO: PRIVATE_MARKER')], taskKind = 'ui') => ({ schema: scan.INPUT_SCHEMA, policyVersion: scan.POLICY_VERSION, taskKind, surfaces });
const encode = JSON.stringify;
function cli(args, value = input(), cwd = root, prefix = []) {
  const result = cp.spawnSync(process.execPath, [...prefix, entry, 'ui', ...args], { cwd,
    input: Buffer.isBuffer(value) || typeof value === 'string' ? value : encode(value), encoding: 'utf8', timeout: 15000,
    env: { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1' } });
  assert.equal(result.error, undefined); assert.equal(result.stderr, ''); return result;
}
function parsed(args, value) {
  const out = cli([...args, '--stdin', '--json'], value); assert.equal(out.status, 0, out.stdout);
  const response = JSON.parse(out.stdout); assert.equal(response.ok, true); assert.equal(response.advisoryOnly, true);
  assert.ok(Object.values(response.result.effects).every(v => v === false)); return response.result;
}
function state(envelope, expected) { assert.equal(parsed(['review', 'assess'], envelope).state, expected); }
function snapshot(dir) {
  const out = {};
  const walk = (folder, prefix = '') => {
    for (const name of fs.readdirSync(folder).sort()) {
      const file = path.join(folder, name), key = prefix + name, st = fs.lstatSync(file);
      out[key] = { mode: st.mode, mtime: st.mtimeMs, size: st.isDirectory() ? null : st.size };
      if (st.isDirectory()) walk(file, key + '/');
      else out[key].hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  }; walk(dir); return out;
}
function captureOutput(write) {
  let text = '';
  const output = new Writable({ write(chunk, encoding, callback) { text += chunk; write ? write(callback) : callback(); } });
  return { output, text: () => text };
}

test('scan CLI exactly preserves the existing scanner result without raw text', () => {
  const value = input(); const result = parsed(['scan'], value);
  assert.deepEqual(result, scan.scanUiBoundary(encode(value))); assert.equal(result.status, 'findings');
  assert.ok(!encode(result).includes('PRIVATE_MARKER'));
});
test('plain summary gives numbered candidates and distinguishes no match, empty, non-UI and unknown', () => {
  const found = cli(['scan', '--stdin']); assert.equal(found.status, 0); assert.match(found.stdout, /Surface 1/); assert.ok(!found.stdout.includes('PRIVATE_MARKER'));
  const cases = [[input([surface('Continue')]), 'no-pattern-match', /does not prove/], [input([]), 'no-surfaces', /nothing was scanned/],
    [input([], 'non-ui'), 'not-applicable', /no UI scan was needed/]];
  for (const [value, expected, message] of cases) {
    assert.equal(parsed(['scan'], value).status, expected); assert.match(cli(['scan', '--stdin'], value).stdout, message);
  }
  assert.equal(parsed(['scan'], input([surface('Continue')], 'unknown')).applicability, 'unknown');
  assert.match(cli(['scan', '--stdin'], input([surface('Continue')], 'unknown')).stdout, /still unknown/);
});
test('plain summary names render artifacts, developer notes and debug text differently', () => {
  const value = input([surface('{{name}}님, 환영합니다'), surface('개발자 메모: 교체'), surface('DEBUG: state'), surface('저장')]);
  const lines = cli(['scan', '--stdin'], value).stdout.split('\n');
  assert.match(lines.find(l => l.startsWith('- Surface 1:')), /unresolved value, template or data dump; fine only where the product shows it on purpose/);
  assert.match(lines.find(l => l.startsWith('- Surface 2:')), /developer note or temporary copy/);
  assert.match(lines.find(l => l.startsWith('- Surface 3:')), /development or debug text/);
  assert.ok(!lines.some(l => l.startsWith('- Surface 4:')));
  // A surface mixing an artifact with a note keeps the general wording rather than excusing the note.
  const mixed = cli(['scan', '--stdin'], input([surface('TODO: fix\n{{title}}')])).stdout;
  assert.match(mixed, /- Surface 1: possible development or debug text/);
});
test('security matches stay one finding with no secret in either output format', () => {
  const secret = 'ghp_' + crypto.randomBytes(18).toString('hex');
  const value = input([surface('DEBUG: ' + secret)]);
  const result = parsed(['scan'], value); assert.equal(result.findings.length, 1); assert.equal(result.findings[0].category, 'security');
  for (const args of [['scan', '--stdin'], ['scan', '--stdin', '--json']]) {
    const out = cli(args, value); assert.equal(out.status, 0); assert.ok(!out.stdout.includes(secret));
  }
});
test('packet CLI exposes existing review questions without executing a reviewer', () => {
  const value = F.fixture(); const result = parsed(['review', 'packet'], value);
  assert.deepEqual(result, review.createUiReviewPacket(encode(value))); assert.equal(result.taskCoverage[0].requiredSubtypes.length, 5);
  assert.match(cli(['review', 'packet', '--stdin'], value).stdout, /No reviewer was run/);
  value.uiMaterials[0].renderDigest = null;
  assert.match(cli(['review', 'packet', '--stdin'], value).stdout, /context is missing/);
});
test('assessment preserves candidate, missing receipt, self-review and stale distinctions', () => {
  const original = F.fixture(), current = F.clone(original), receipt = F.receipt(original), envelope = { original, current, receipt };
  const candidate = parsed(['review', 'assess'], envelope);
  assert.deepEqual(candidate, review.assessUiReview(encode(original), encode(current), encode(receipt)));
  assert.equal(candidate.state, 'review-candidate'); assert.equal(candidate.verification.independentReview, 'not-verified');
  assert.match(cli(['review', 'assess', '--stdin'], envelope).stdout, /not authenticated/);
  state({ original, current }, 'not-reviewed');
  const self = F.clone(receipt); self.reviewer = original.contributors[0].executor;
  state({ original, current, receipt: self }, 'self-review');
  assert.match(cli(['review', 'assess', '--stdin'], { original, current, receipt: self }).stdout, /self-review/);
  current.uiMaterials[0].renderDigest = F.hash('d'); state(envelope, 'stale');
  assert.match(cli(['review', 'assess', '--stdin'], envelope).stdout, /no longer matches/);
});
test('failed execution or missing coverage never becomes a completed review', () => {
  const original = F.fixture(), receipt = F.receipt(original);
  receipt.execution = 'failed'; state({ original, current: original, receipt }, 'incomplete');
  receipt.execution = 'completed'; receipt.coverage.pop(); state({ original, current: original, receipt }, 'incomplete');
});
test('exact assessment envelope and receipt validation reject unknown and null data', () => {
  const f = F.fixture();
  for (const value of [{}, null, [], { original: f }, { original: f, current: f, receipt: null }, { original: f, current: f, path: 'PRIVATE_MARKER' }]) {
    const out = cli(['review', 'assess', '--stdin', '--json'], value); assert.equal(out.status, 2);
    assert.equal(JSON.parse(out.stdout).ok, false); assert.ok(!out.stdout.includes('PRIVATE_MARKER'));
  }
});
test('strict transport rejects duplicate and escaped-equivalent JSON keys for every operation', () => {
  for (const operation of ['scan', 'packet', 'assess']) for (const value of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}']) {
    const response = adapter.evaluateUiJson(operation, value); assert.equal(response.ok, false); assert.equal(response.error.code, 'duplicate_json_key');
  }
});
test('stdin encoding and size limits reject malformed data without echoing it', () => {
  for (const [bytes, code] of [[Buffer.from([0xc3, 0x28]), 'invalid_utf8'], [Buffer.from('\ufeff{}'), 'utf8_bom_not_allowed'],
    [Buffer.alloc(65537, 32), 'input_too_large'], ['{"secret":"PRIVATE_MARKER"', 'invalid_json']]) {
    const out = cli(['scan', '--stdin', '--json'], bytes); assert.equal(out.status, 2);
    assert.equal(JSON.parse(out.stdout).error.code, code); assert.ok(!out.stdout.includes('PRIVATE_MARKER'));
  }
  const body = encode(input([surface('한글 확인')])); const padded = body + ' '.repeat(65536 - Buffer.byteLength(body));
  assert.equal(cli(['scan', '--stdin', '--json'], padded).status, 0);
});
test('invalid CLI options are rejected before reading stdin', () => {
  for (const args of [['scan'], ['scan', '--stdin', '--stdin'], ['scan', '--stdin', '--path', root], ['scan', '--stdin', '--yes'],
    ['review'], ['review', 'scan', '--stdin'], ['review', 'assess', '--json'], ['review', 'packet', '--stdin', '--json', '--json']]) {
    const out = cli([...args, ...(args.includes('--json') ? [] : ['--json'])]); assert.equal(out.status, 2);
    assert.equal(JSON.parse(out.stdout).error.code, 'invalid_cli_arguments');
  }
  for (const args of [['scan', '--help'], ['review', '--help'], ['review', 'packet', '-h'], ['review', 'assess', '--help']]) {
    const out = cli(args); assert.equal(out.status, 0); assert.match(out.stdout, /No login/);
  }
});
test('current, legacy, nested and empty workspaces remain byte and mtime identical on all routes', () => {
  for (const name of ['current', 'legacy', 'nested', 'empty']) {
    const dir = path.join(root, name); fs.mkdirSync(dir);
    if (name !== 'empty') {
      const workspace = path.join(dir, name === 'legacy' ? LEGACY_WORKSPACE_DIR : '.leerness'); fs.mkdirSync(workspace);
      fs.writeFileSync(path.join(workspace, 'HARNESS_VERSION'), '0.1.0\n'); fs.writeFileSync(path.join(workspace, 'decisions.json'), '{broken');
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'fixture');
    }
    const cwd = name === 'nested' ? path.join(dir, 'child') : dir; if (cwd !== dir) fs.mkdirSync(cwd);
    const before = snapshot(dir), f = F.fixture();
    for (const [args, value] of [[['scan', '--stdin', '--json'], input()], [['review', 'packet', '--stdin', '--json'], f],
      [['review', 'assess', '--stdin', '--json'], { original: f, current: f }], [['review', 'bad', '--json'], {}], [['scan', '--help'], {}]]) cli(args, value, cwd);
    assert.deepEqual(snapshot(dir), before);
  }
});
test('preload fences writes, subprocesses and network for valid, invalid and help routes', () => {
  const preload = path.join(root, 'no-effects.cjs');
  fs.writeFileSync(preload, "const deny=()=>{throw Error('effect forbidden')};const fs=require('node:fs');"
    + "for(const k of ['writeFileSync','appendFileSync','mkdirSync','rmSync','renameSync','unlinkSync','writeFile','appendFile','mkdir','rename','unlink'])fs[k]=deny;"
    + "const cp=require('node:child_process');for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=deny;"
    + "for(const name of ['node:http','node:https']){const m=require(name);m.request=deny;m.get=deny;}require('node:net').connect=deny;global.fetch=deny;\n");
  const f = F.fixture();
  for (const [args, value, status] of [[['scan', '--stdin', '--json'], input(), 0], [['review', 'packet', '--stdin', '--json'], f, 0],
    [['review', 'assess', '--stdin', '--json'], { original: f, current: f }, 0], [['scan', '--stdin', '--bad'], {}, 2], [['scan', '--help'], {}, 0]]) {
    assert.equal(cli(args, value, root, ['--require', preload]).status, status);
  }
});
test('TTY input and non-buffer streams return sanitized input failures', async () => {
  for (const [stream, code] of [[Object.assign(new Readable({ read() {} }), { isTTY: true }), 'stdin_pipe_required'],
    [Readable.from(['PRIVATE_MARKER']), 'stdin_binary_required']]) {
    const out = captureOutput(); assert.equal(await adapter.runCli(['scan', '--stdin', '--json'], stream, out.output), 2);
    assert.equal(JSON.parse(out.text()).error.code, code); assert.ok(!out.text().includes('PRIVATE_MARKER')); stream.destroy();
  }
});
test('stdout backpressure is awaited and broken pipes reject without an unhandled error', async () => {
  let drained = false;
  const out = captureOutput(callback => setTimeout(() => { drained = true; callback(); }, 25));
  assert.equal(await adapter.runCli(['scan', '--stdin'], Readable.from([Buffer.from(encode(input()))]), out.output), 0); assert.equal(drained, true);
  const bad = captureOutput(callback => callback(Object.assign(new Error('fixture'), { code: 'EPIPE' })));
  await assert.rejects(adapter.runCli(['scan', '--help'], Readable.from([]), bad.output), { code: 'EPIPE' });
  await new Promise(resolve => setImmediate(resolve));
});
test('unclosed stdin reaches the bounded deadline without touching the project', async () => {
  const before = snapshot(root);
  const result = await new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [entry, 'ui', 'scan', '--stdin', '--json'], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('child exceeded deadline')); }, 9000);
    child.on('error', reject); child.stdin.on('error', () => {}); child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; });
    child.on('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); }); child.stdin.write('{');
  });
  assert.equal(result.status, 2); assert.equal(result.stderr, ''); assert.equal(JSON.parse(result.stdout).error.code, 'stdin_timeout');
  assert.deepEqual(snapshot(root), before);
});

(async () => {
  let passed = 0;
  for (const { name, run } of tests) {
    try { await run(); passed++; console.log('PASS ' + name); }
    catch (error) { console.error('FAIL ' + name + '\n' + error.stack); }
  }
  console.log(`Tests: ${passed} passed, ${tests.length - passed} failed, ${tests.length} total`);
  if (passed !== tests.length) process.exitCode = 1;
})().finally(() => {
  const resolved = fs.realpathSync(root), temp = fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(resolved), temp); assert.ok(path.basename(resolved).startsWith('lr-ui-cli-'));
  removeTree(resolved, { recursive: true });
});
