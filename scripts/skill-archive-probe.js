'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
// T-0352: the archive step of `leerness skill publish --bundle-only` (_createArchive in bin/leerness.js).
// It ran `tar -czf <absolute path>`. Git for Windows' GNU tar, first on PATH in Git Bash and in agent shells built on
// it, reads the drive letter of an absolute Windows path as a remote host and failed, so the .zip fallback ran
// instead of the .tgz. The e2e check accepted either. This probe asks for the .tgz with each tar the machine has
// first on PATH and checks that tar made it, with the expected entries.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { _createArchive } = require('../bin/leerness.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error && error.stack || error)); }
}
// Entry names of a .tgz, read with zlib and the ustar header layout (name at 0, prefix at 345).
function tgzEntries(file) {
  const tar = zlib.gunzipSync(fs.readFileSync(file)), names = [];
  for (let at = 0; at + 512 <= tar.length;) {
    const header = tar.subarray(at, at + 512);
    if (header.every(byte => byte === 0)) break;
    const text = (from, length) => header.subarray(from, from + length).toString('utf8').replace(/\0[\s\S]*$/, '');
    const name = text(0, 100), prefix = text(345, 155), size = parseInt(text(124, 12).trim() || '0', 8);
    const type = text(156, 1);
    if (type !== 'x' && type !== 'g' && type !== 'L') names.push((prefix ? prefix + '/' : '') + name);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return names.map(n => n.replace(/\/$/, '')).sort();
}
const arena = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-skill-archive-'));
function project(name) {
  const root = path.join(arena, name), source = path.join(root, '.leerness', 'skills-publish');
  fs.mkdirSync(path.join(source, 'skill-a'), { recursive: true });
  fs.writeFileSync(path.join(source, 'manifest.json'), '{"skills":1}\n');
  fs.writeFileSync(path.join(source, 'skill-a', 'SKILL.md'), '# Skill A\n');
  return path.join(root, '.leerness');
}
const tars = [['the tar found on PATH', null]];
if (process.platform === 'win32') {
  const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  if (fs.existsSync(path.join(system32, 'tar.exe'))) tars.push(["System32's bsdtar first on PATH", system32]);
  const gitUsrBin = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin');
  if (fs.existsSync(path.join(gitUsrBin, 'tar.exe'))) tars.push(["Git for Windows' GNU tar first on PATH", gitUsrBin]);
  else console.log("SKIP Git for Windows' GNU tar first on PATH (not installed)");
}
const expected = ['skills-publish', 'skills-publish/manifest.json', 'skills-publish/skill-a', 'skills-publish/skill-a/SKILL.md'];
const originalPath = process.env.PATH;
try {
  for (const [name, dir] of tars) {
    for (const [where, out] of [['below the working folder', cwd => path.join(cwd, 'skills-publish-tarball', 'bundle.tgz')],
      ['beside the working folder', cwd => path.join(path.dirname(cwd), 'out', 'bundle.tgz')]]) {
      test(`.tgz with ${name}, archive ${where}`, () => {
        const cwd = project(`p-${passed + failed}`), file = out(cwd);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (dir) process.env.PATH = dir + path.delimiter + originalPath;
        let made;
        try { made = _createArchive(cwd, 'skills-publish', file); } finally { process.env.PATH = originalPath; }
        assert.deepStrictEqual({ ok: made.ok, method: made.method, path: made.path }, { ok: true, method: 'tar', path: file }, JSON.stringify(made));
        assert.deepStrictEqual(tgzEntries(file), expected);
      });
    }
  }
} finally {
  process.env.PATH = originalPath;
  fs.rmSync(arena, { recursive: true, force: true });
}
console.log(`skill archive probe: ${passed}/${passed + failed} passed (${process.platform})`);
process.exitCode = failed ? 1 : 0;
