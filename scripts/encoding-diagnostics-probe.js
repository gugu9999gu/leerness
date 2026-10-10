'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { LEGACY_WORKSPACE_DIR } = require('../lib/workspace-dir');
const { collectEncodingDiagnostics, MAX_FILE_BYTES, MAX_DEPTH, DETAIL_LIMIT } = require('../lib/encoding-diagnostics');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-encoding-scope-'));
  try {
    const r = cp.spawnSync(process.execPath, [__filename, '--worker'], { encoding: 'utf8', timeout: 60000,
      windowsHide: true, env: { ...process.env, ENCODING_PROBE_ROOT: arena } });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');
    if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-encoding-scope-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.ENCODING_PROBE_ROOT;
const cli = path.resolve(__dirname, '../bin/leerness.js');
const extensions = new Set(['.md', '.txt', '.js', '.json', '.ps1', '.sh', '.bat', '.cmd', '']);
const sample = '한글 English 日本語 中文 🐝 e\u0301';
let sequence = 0, passed = 0, failed = 0;
function fixture(files) {
  const dir = path.join(arena, (++sequence) + '-한글 project');fs.mkdirSync(dir);
  for (const [name, value] of Object.entries(files)) {
    const file = path.join(dir, name);fs.mkdirSync(path.dirname(file), { recursive: true });fs.writeFileSync(file, value);
  }
  return dir;
}
const scan = (dir, overrides = {}) => collectEncodingDiagnostics(dir, { textExtensions: extensions, skipPath: () => false, ...overrides });
const ioWith = overrides => new Proxy(fs, { get: (target, key) => Object.hasOwn(overrides, key) ? overrides[key] : target[key] });
function snapshot(dir) {
  const rows = {};
  function visit(file) {
    const stat = fs.lstatSync(file, { bigint: true }), rel = path.relative(dir, file) || '.';
    rows[rel] = { size: String(stat.size), mtime: String(stat.mtimeNs), mode: String(stat.mode) };
    if (stat.isSymbolicLink()) rows[rel].link = fs.readlinkSync(file);
    else if (stat.isDirectory()) for (const name of fs.readdirSync(file)) visit(path.join(file, name));
    else rows[rel].sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  visit(dir);return rows;
}
function command(dir, args = ['--json']) {
  const before = snapshot(dir);
  const result = cp.spawnSync(process.execPath, [cli, 'encoding', 'check', dir, ...args], { encoding: 'utf8', timeout: 12000,
    windowsHide: true, env: { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1' } });
  assert.ifError(result.error);assert.deepStrictEqual(snapshot(dir), before, 'diagnostic CLI changed the target');return result;
}
function test(name, fn) {
  try { fn();passed++;console.log('PASS ' + name); }
  catch (error) { failed++;console.error('FAIL ' + name + ': ' + error.stack); }
}
test('valid multilingual bytes preserve files while meaning remains unverified', () => {
  const dir = fixture({ '.leerness/planner.md': sample, 'AGENTS.md': sample, 'CLAUDE.md': sample });const before = snapshot(dir), r = scan(dir);
  assert.strictEqual(r.ok, true);assert.strictEqual(r.coverage.checkedFiles, 3);assert.strictEqual(r.textIntegrity.checkedFiles, 3);
  assert.strictEqual(r.byteValidity.status, 'valid-in-scope');assert.strictEqual(r.textIntegrity.status, 'unverified');assert.deepStrictEqual(snapshot(dir), before);
});
test('invalid and truncated UTF-8 cannot be classified as valid', () => {
  for (const bytes of [[0xff], [0xed, 0x95], [0xc7, 0xd1, 0xb1, 0xdb], [0xef, 0xbb, 0xbf, 0xc7, 0xd1]]) {
    const r = scan(fixture({ 'invalid.txt': Buffer.from(bytes) }));assert.strictEqual(r.ok, false);assert.strictEqual(r.byteValidity.invalidFiles, 1);
    assert.ok(r.findings.some(x => x.code === 'invalid_utf8'));assert.strictEqual(r.textIntegrity.checkedFiles, 0);
  }
});
test('BOM policy and physical byte validity are distinct', () => {
  const r = scan(fixture({ 'doc.md': '\uFEFF' + sample, 'script.ps1': '\uFEFF' + sample, 'script.cmd': '\uFEFF@chcp 65001\r\necho 한글' }));
  assert.strictEqual(r.byteValidity.validFiles, 3);assert.strictEqual(r.count, 1);assert.strictEqual(r.findings[0].code, 'utf8_bom');
});
test('UTF-16 and late NUL retain the existing policy findings', () => {
  const r = scan(fixture({ 'utf16.txt': Buffer.from([0xff, 0xfe, 65, 0]), 'late.txt': Buffer.concat([Buffer.alloc(5000, 65), Buffer.from([0])]) }));
  assert.ok(r.findings.some(x => x.issue === 'UTF-16 BOM'));assert.strictEqual(r.findings.filter(x => x.code === 'nul_byte').length, 2);
  assert.strictEqual(r.byteValidity.invalidFiles, 1);
});
test('ASCII batch controls and non-ASCII prefix warnings stay compatible', () => {
  const r = scan(fixture({ 'ascii.bat': '@echo off\r\necho hi', 'good.cmd': '@chcp 65001\r\necho 한글', 'bad.cmd': '@echo off\r\necho 한글' }));
  assert.strictEqual(r.count, 1);assert.strictEqual(r.findings[0].issue, '.cmd missing chcp 65001');
});
test('oversized selected text is skipped without opening or claiming success', () => {
  const dir = fixture({ 'large.md': Buffer.alloc(MAX_FILE_BYTES + 1, 65) });let opens = 0;
  const r = scan(dir, { io: ioWith({ openSync: () => { opens++;throw new Error('must not read'); } }) });
  assert.strictEqual(opens, 0);assert.strictEqual(r.coverage.skipped.size, 1);assert.strictEqual(r.coverage.complete, false);
  assert.strictEqual(r.ok, false);assert.strictEqual(r.count, 0);assert.strictEqual(r.byteValidity.status, 'incomplete');
});
test('exact size limit and empty file are actually checked', () => {
  const r = scan(fixture({ 'limit.txt': Buffer.alloc(MAX_FILE_BYTES, 65), 'empty.md': '' }));
  assert.strictEqual(r.ok, true);assert.strictEqual(r.coverage.checkedFiles, 2);assert.strictEqual(r.coverage.emptyFiles, 1);assert.strictEqual(r.coverage.checkedBytes, MAX_FILE_BYTES);
});
test('unsupported extensions and configured exclusions are explicit outside-scope entries', () => {
  const dir = fixture({ 'blob.png': Buffer.from([255]), 'vendor/broken.md': Buffer.from([255]), 'ok.md': sample });
  const r = scan(dir, { skipPath: name => name === 'vendor' });assert.strictEqual(r.ok, true);assert.strictEqual(r.coverage.exclusionCount, 2);
  assert.deepStrictEqual(r.coverage.excluded, { extensionFiles: 1, policyEntries: 1 });assert.strictEqual(r.coverage.checkedFiles, 1);
});
test('depth limit is a visible omission', () => {
  const r = scan(fixture({ ['nested/'.repeat(MAX_DEPTH + 1) + 'file.md']: sample }));
  assert.strictEqual(r.coverage.skipped.depth, 1);assert.strictEqual(r.ok, false);assert.strictEqual(r.coverage.checkedFiles, 0);
});
test('native directory links are not traversed or mutated', () => {
  const target = fixture({ 'external.md': Buffer.from([255]) }), dir = fixture({ 'safe.md': sample }), before = snapshot(target);
  fs.symlinkSync(target, path.join(dir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = scan(dir);assert.strictEqual(r.coverage.skipped.link, 1);assert.strictEqual(r.count, 0);assert.strictEqual(r.coverage.checkedFiles, 1);assert.deepStrictEqual(snapshot(target), before);
});
test('directory read errors retain successful siblings and no private error text', () => {
  const dir = fixture({ 'blocked/x.md': sample, 'ok.md': sample });
  const r = scan(dir, { io: ioWith({ readdirSync: (file, opts) => { if (path.basename(file) === 'blocked') throw new Error('PRIVATE_ERROR');return fs.readdirSync(file, opts); } }) });
  assert.strictEqual(r.coverage.skipped['directory-read'], 1);assert.strictEqual(r.coverage.checkedFiles, 1);assert.ok(!JSON.stringify(r).includes('PRIVATE_ERROR'));
});
test('stat failure cannot silently disappear', () => {
  const dir = fixture({ 'fault.md': sample });const r = scan(dir, { io: ioWith({ lstatSync: (file, opts) => { if (file.endsWith('fault.md')) throw new Error('PRIVATE_ERROR');return fs.lstatSync(file, opts); } }) });
  assert.strictEqual(r.coverage.skipped.stat, 1);assert.strictEqual(r.ok, false);
});
test('read and close failures prevent complete results', () => {
  const dir = fixture({ 'fault.md': sample });
  const read = scan(dir, { io: ioWith({ openSync: () => { throw new Error('PRIVATE_ERROR'); } }) });assert.strictEqual(read.coverage.skipped.read, 1);
  const close = scan(dir, { io: ioWith({ closeSync: fd => { fs.closeSync(fd);throw new Error('PRIVATE_ERROR'); } }) });assert.strictEqual(close.coverage.skipped.read, 1);assert.strictEqual(close.coverage.checkedFiles, 0);
});
test('growing file is bounded and reported changed', () => {
  const dir = fixture({ 'growing.md': sample }), file = path.join(dir, 'growing.md');let changed = false, requested = 0;
  const r = scan(dir, { io: ioWith({ readSync: (...args) => { requested += args[3];if (!changed) { changed = true;fs.appendFileSync(file, 'x'.repeat(100)); }return fs.readSync(...args); } }) });
  assert.strictEqual(r.coverage.skipped.changed, 1);assert.strictEqual(r.coverage.checkedFiles, 0);assert.ok(requested <= Buffer.byteLength(sample) + 1);
});
test('file replacement during reading cannot certify the new path', () => {
  const dir = fixture({ 'original.md': sample }), file = path.join(dir, 'original.md');let replaced = false;
  const r = scan(dir, { io: ioWith({ readSync: (...args) => {
    const n = fs.readSync(...args);if (!replaced) { replaced = true;fs.renameSync(file, file + '.saved');fs.writeFileSync(file, sample); }return n;
  } }) });assert.strictEqual(r.coverage.skipped.changed, 1);assert.strictEqual(r.coverage.checkedFiles, 0);
});
test('observed directory change marks traversal incomplete', () => {
  const dir = fixture({ 'file.md': sample });let calls = 0;
  const r = scan(dir, { io: ioWith({ lstatSync: (file, opts) => { const s = fs.lstatSync(file, opts);if (file === dir && ++calls === 2) { const copy = Object.create(s);copy.mtimeNs += 1n;return copy; }return s; } }) });
  assert.strictEqual(r.coverage.skipped['directory-changed'], 1);assert.strictEqual(r.ok, false);
});
// T-0343: an entry added within the directory's timestamp tick leaves its lstat unchanged, so a file the traversal
// never saw could still be reported as complete coverage. The directory timestamps are held fixed here.
test('entry added during traversal within one timestamp tick marks traversal incomplete', () => {
  const dir = fixture({ 'file.md': sample });let first = null, added = false;
  const r = scan(dir, { io: ioWith({
    lstatSync: (file, opts) => {
      const s = fs.lstatSync(file, opts);if (file !== dir) return s;
      if (!first) first = s;const copy = Object.create(s);copy.mtimeNs = first.mtimeNs;copy.ctimeNs = first.ctimeNs;return copy;
    },
    readSync: (...args) => { if (!added) { added = true;fs.writeFileSync(path.join(dir, 'new.md'), Buffer.from([0xff])); }return fs.readSync(...args); },
  }) });
  assert.ok(added);assert.strictEqual(r.coverage.skipped['directory-changed'], 1);assert.strictEqual(r.ok, false);
  assert.notStrictEqual(r.byteValidity.status, 'valid-in-scope');
});
test('non-regular selected entries are never opened', () => {
  const dir = fixture({ 'special.md': sample });let opens = 0;
  const r = scan(dir, { io: ioWith({ lstatSync: (file, opts) => { const s = fs.lstatSync(file, opts);if (file.endsWith('special.md')) s.isFile = () => false;return s; }, openSync: () => { opens++;throw new Error('unexpected'); } }) });
  assert.strictEqual(r.coverage.skipped['not-regular'], 1);assert.strictEqual(opens, 0);
});
test('nonzero device mismatches cannot use the Windows missing-device exception', () => {
  const dir = fixture({ 'file.md': sample });
  const r = scan(dir, { io: ioWith({
    lstatSync: (file, opts) => { const s = fs.lstatSync(file, opts);if (s.isFile()) s.dev = 123n;return s; },
    fstatSync: (fd, opts) => { const s = fs.fstatSync(fd, opts);s.dev = 456n;return s; },
  }) });assert.strictEqual(r.coverage.skipped.changed, 1);assert.strictEqual(r.coverage.checkedFiles, 0);
});
test('adjacent inode numbers above Number precision remain distinguishable', () => {
  const dir = fixture({ 'file.md': sample });
  const r = scan(dir, { io: ioWith({
    lstatSync: (file, opts) => { const s = fs.lstatSync(file, opts);if (s.isFile()) s.ino = 9007199254740992n;return s; },
    fstatSync: (fd, opts) => { const s = fs.fstatSync(fd, opts);s.ino = 9007199254740993n;return s; },
  }) });assert.strictEqual(r.coverage.skipped.changed, 1);assert.strictEqual(r.coverage.checkedFiles, 0);
});
test('a missing Windows path device requires a second matching handle', () => {
  const dir = fixture({ 'file.md': sample });let opens = 0, closes = 0;
  const r = scan(dir, { io: ioWith({
    lstatSync: (file, opts) => { const s = fs.lstatSync(file, opts);if (s.isFile()) s.dev = 0n;return s; },
    openSync: (...args) => { opens++;return fs.openSync(...args); }, closeSync: fd => { closes++;fs.closeSync(fd); },
  }) });
  assert.strictEqual(closes, opens);
  if (process.platform === 'win32') { assert.strictEqual(opens, 2);assert.strictEqual(r.ok, true); }
  else assert.strictEqual(r.ok, false); // Missing-device exception is Windows-specific.
});
test('a different confirmation handle rejects content and closes both handles', () => {
  const dir = fixture({ 'file.md': sample });let opens = 0, closes = 0, second;
  const r = scan(dir, { io: ioWith({
    lstatSync: (file, opts) => { const s = fs.lstatSync(file, opts);if (s.isFile()) s.dev = 0n;return s; },
    openSync: (...args) => { const fd = fs.openSync(...args);if (++opens === 2) second = fd;return fd; },
    fstatSync: (fd, opts) => { const s = fs.fstatSync(fd, opts);if (fd === second) s.dev += 1n;return s; },
    closeSync: fd => { closes++;fs.closeSync(fd); },
  }) });assert.strictEqual(r.ok, false);assert.strictEqual(r.coverage.skipped.changed, 1);assert.strictEqual(closes, opens);
  if (process.platform === 'win32') assert.strictEqual(opens, 2);
});
test('repeated control/replacement/signature and question gaps are advisory only', () => {
  const values = ['상태 \u0081\u009F 확인', '데이터 \uFFFD\uFFFD 확인', 'cafÃ© dÃ©jÃ©', '데??터??베이스'];
  for (const value of values) {
    const r = scan(fixture({ '.leerness/planner.md': value }));assert.strictEqual(r.ok, true);assert.strictEqual(r.count, 0);
    assert.strictEqual(r.textIntegrity.status, 'suspected');assert.strictEqual(r.textIntegrity.count, 1);assert.strictEqual(r.byteValidity.status, 'valid-in-scope');
  }
});
test('ordinary questions and isolated example characters are negative controls', () => {
  const normal = [sample, '왜??? 정말??? 맞나요?', '이것은 무엇인가요?', '대체 문자 예시: \uFFFD', '제어 문자 예시: \u0081', 'Português Ã é uma letra', '2026 © 저작권'];
  const r = scan(fixture({ '.leerness/planner.md': normal.join('\n') }));assert.strictEqual(r.textIntegrity.count, 0);
});
test('code fences, quoted examples and inline code are excluded with counts', () => {
  const bad = '설명 \uFFFD\uFFFD \u0081\u009f';
  const r = scan(fixture({ '.leerness/examples.md': ['```txt', bad, '```', '~~~', bad, '~~~', '    ' + bad, '> ' + bad, '`' + bad + '`'].join('\r\n') }));
  assert.strictEqual(r.textIntegrity.count, 0);assert.deepStrictEqual(r.textIntegrity.excluded, { fencedLines: 6, indentedLines: 1, quotedLines: 1, inlineCodeSpans: 1 });
});
test('generic source and non-harness prose get byte checks without prose heuristics', () => {
  const bad = 'literal \uFFFD\uFFFD';const r = scan(fixture({ 'src/file.js': bad, 'README.md': bad, '.leerness/state.json': JSON.stringify({ text: bad }) }));
  assert.strictEqual(r.coverage.checkedFiles, 3);assert.strictEqual(r.textIntegrity.checkedFiles, 0);assert.strictEqual(r.textIntegrity.outOfScopeFiles, 3);assert.strictEqual(r.textIntegrity.count, 0);
});
test('legacy harness and nested installed-project prose are recognized', () => {
  const r = scan(fixture({ [LEGACY_WORKSPACE_DIR + '/plan.md']: '상태 \uFFFD\uFFFD', 'nested/.leerness/plan.txt': '상태 \u0081\u009f' }));assert.strictEqual(r.textIntegrity.count, 2);
});
test('byte-valid text without recognizable signals is explicitly unverified', () => {
  const r = scan(fixture({ '.leerness/planner.md': '怨좎뼇瑗곌굅' }));assert.strictEqual(r.byteValidity.status, 'valid-in-scope');assert.strictEqual(r.textIntegrity.status, 'unverified');
});
test('advisory locations use Unicode columns without disclosing text', () => {
  const r = scan(fixture({ '.leerness/plan.md': 'safe\r\n🐝 상태 \u0081\u009f PRIVATE_CONTENT' }));
  const a = r.textIntegrity.advisories[0];assert.strictEqual(a.line, 2);assert.strictEqual(a.column, 6);assert.ok(!JSON.stringify(r).includes('PRIVATE_CONTENT'));
});
test('advisories have bounded details and one observation per affected line', () => {
  const r = scan(fixture({ '.leerness/plan.md': ('상태 \u0081\u009f \uFFFD\uFFFD\n').repeat(DETAIL_LIMIT + 3) }));
  assert.strictEqual(r.textIntegrity.count, DETAIL_LIMIT + 3);assert.strictEqual(r.textIntegrity.advisories.length, DETAIL_LIMIT);assert.strictEqual(r.textIntegrity.advisoriesTruncated, true);
});
test('omissions and exclusions retain totals beyond the detail cap', () => {
  const files = {};for (let i = 0; i < DETAIL_LIMIT + 2; i++) { files[i + '.md'] = 'x';files[i + '.png'] = 'x'; }
  const dir = fixture(files);const r = scan(dir, { io: ioWith({ lstatSync: (file, opts) => { const s = fs.lstatSync(file, opts);if (file.endsWith('.md')) s.size = BigInt(MAX_FILE_BYTES + 1);return s; } }) });
  assert.strictEqual(r.coverage.omissionCount, DETAIL_LIMIT + 2);assert.strictEqual(r.coverage.omissions.length, DETAIL_LIMIT);assert.strictEqual(r.coverage.omissionsTruncated, true);
  assert.strictEqual(r.coverage.exclusionCount, DETAIL_LIMIT + 2);assert.strictEqual(r.coverage.exclusionsTruncated, true);
});
test('empty scope is not described as verified sentence meaning', () => {
  const r = scan(fixture({ 'image.png': 'x' }));assert.strictEqual(r.byteValidity.status, 'not-checked');assert.strictEqual(r.textIntegrity.status, 'unverified');assert.strictEqual(r.coverage.checkedFiles, 0);
});
test('actual CLI is read-only even for an ambiguous workspace', () => {
  const dir = fixture({ '.leerness/planner.md': sample });const p = command(dir), r = JSON.parse(p.stdout);
  assert.strictEqual(p.status, 0);assert.strictEqual(r.error, undefined);assert.strictEqual(r.textIntegrity.status, 'unverified');
});
test('actual CLI reports advisories without changing byte-policy exit status', () => {
  const dir = fixture({ '.leerness/planner.md': '상태 \uFFFD\uFFFD PRIVATE_CONTENT' });const p = command(dir), r = JSON.parse(p.stdout);
  assert.strictEqual(p.status, 0);assert.strictEqual(r.ok, true);assert.strictEqual(r.textIntegrity.status, 'suspected');assert.ok(!p.stdout.includes('PRIVATE_CONTENT'));
});
test('actual CLI incomplete scan has exit one and zero fabricated encoding findings', () => {
  const dir = fixture({ 'large.md': Buffer.alloc(MAX_FILE_BYTES + 1, 65) });const p = command(dir), r = JSON.parse(p.stdout);
  assert.strictEqual(p.status, 1);assert.strictEqual(r.ok, false);assert.strictEqual(r.count, 0);assert.strictEqual(r.coverage.skipped.size, 1);
});
test('actual CLI reuses nested default exclusions and user skip configuration', () => {
  const dir = fixture({ 'nested/node_modules/bad.md': Buffer.from([255]), '.git/bad.md': Buffer.from([255]),
    'custom/bad.md': Buffer.from([255]), '.leerness-skip-dirs': 'custom\n', 'good.md': sample });
  const p = command(dir), r = JSON.parse(p.stdout);assert.strictEqual(p.status, 0);assert.strictEqual(r.coverage.excluded.policyEntries, 3);assert.strictEqual(r.byteValidity.invalidFiles, 0);
});
test('human Korean and English reports explain uncertainty without content excerpts', () => {
  const dir = fixture({ '.leerness/planner.md': '상태 \uFFFD\uFFFD PRIVATE_CONTENT' });
  const ko = command(dir, ['--language', 'ko']), en = command(dir, ['--language', 'en']);
  assert.ok(ko.stdout.includes('확정 오류는 아닙니다'));assert.ok(en.stdout.includes('not confirmed corruption'));
  assert.ok(en.stdout.includes('does not establish sentence meaning'));assert.ok(!ko.stdout.includes('PRIVATE_CONTENT'));assert.ok(!en.stdout.includes('PRIVATE_CONTENT'));
});
test('invalid path and invalid flags remain structured failures without target writes', () => {
  const dir = fixture({ 'file.md': sample });const badFlag = command(dir, ['--unknown-encoding-option', '--json']);assert.strictEqual(badFlag.status, 1);assert.strictEqual(JSON.parse(badFlag.stdout).ok, false);
  for (const target of [path.join(dir, 'missing'), path.join(dir, 'file.md')]) {
    const r = cp.spawnSync(process.execPath, [cli, 'encoding', 'check', target, '--json'], { encoding: 'utf8', timeout: 12000, windowsHide: true });
    assert.ifError(r.error);assert.strictEqual(r.status, 1);assert.strictEqual(JSON.parse(r.stdout).ok, false);
  }
});
console.log(`Tests: ${passed}/${passed + failed} passed`);if (failed) process.exitCode = 1;
