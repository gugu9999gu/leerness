'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

// T-0309: the UI copy boundary reaches the UI-building agent as an on-demand skill.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const guide = require('../lib/ui-copy-boundary');
const { MINIMAL_SKIP_KEYS } = require('../lib/catalogs');
const core = require('../bin/leerness');
const { removeTree } = require('./temp-cleanup');
const cli = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ui-copy-'));
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); }
}
const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1',
  LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1', LEERNESS_NO_DRIFT_CHECK: '1' };
function run(root, args, input) {
  const result = cp.spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 90000, windowsHide: true, env, input });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
const INIT = ['--yes', '--no-setup-agents', '--no-mcp', '--no-auto-roadmap', '--no-official-skills', '--no-banner'];
// Frontmatter as a YAML loader sees it: a plain scalar may not contain ": " (the first English
// description did, which a YAML loader rejects); a double-quoted scalar must parse.
function frontmatter(skill) {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  assert.ok(block, 'frontmatter block');
  const out = {};
  for (const line of block[1].split('\n')) {
    const kv = /^([a-z]+): (.*)$/.exec(line);
    assert.ok(kv, 'frontmatter line: ' + line);
    if (kv[2].startsWith('"')) out[kv[1]] = JSON.parse(kv[2]);
    else {
      assert.ok(!/: |\s#|^[-?:,[\]{}#&*!|>'"%@`]/.test(kv[2]), 'plain scalar is valid YAML: ' + kv[2]);
      out[kv[1]] = kv[2];
    }
  }
  return out;
}
const project = (name, lang) => {
  const dir = path.join(arena, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'ui-copy-' + name, version: '1.0.0' }));
  return dir;
};
try {
  test('Korean and English generation give one managed guide and two thin skill pointers', () => {
    for (const lang of ['ko', 'en']) {
      const files = core.coreFiles(arena, lang);
      const text = files[guide.GUIDE_PATH];
      assert.ok(text.startsWith('<!-- leerness:managed -->'));
      assert.ok(text.includes(lang === 'ko' ? '사용자에게 하는 말인가, 만드는 사람에게 하는 말인가' : 'speak to the user or to the builder'));
      assert.ok(text.includes('leerness ui scan --stdin') && text.includes('leerness ui review packet --stdin'));
      for (const name of guide.SKILL_PATHS) {
        const skill = files[name];
        const meta = frontmatter(skill);
        assert.strictEqual(meta.name, 'ui-copy-boundary');
        assert.ok(typeof meta.description === 'string' && meta.description.length > 40);
        assert.ok(skill.includes(guide.GUIDE_PATH));
        // A pointer, not a copy: the rule list lives only in the guide.
        assert.ok(!skill.includes(lang === 'ko' ? '## 예외' : '## Exceptions'));
        assert.ok(skill.length < text.length / 2);
      }
    }
  });
  test('skill description names the UI surfaces that should load it and the work that should not', () => {
    const en = frontmatter(core.coreFiles(arena, 'en')[guide.SKILL_PATHS[1]]).description;
    for (const word of ['user-facing text', 'buttons', 'placeholders', 'tooltips', 'error states', 'Skip backend']) assert.ok(en.includes(word), word);
    const ko = frontmatter(core.coreFiles(arena, 'ko')[guide.SKILL_PATHS[1]]).description;
    for (const word of ['사용자용 문구', '버튼', 'placeholder', '툴팁', '오류', '백엔드']) assert.ok(ko.includes(word), word);
  });
  test('the example input in each guide is accepted by the real scanner CLI', () => {
    for (const lang of ['ko', 'en']) {
      const line = core.coreFiles(arena, lang)[guide.GUIDE_PATH].split('\n').find(l => l.trim().startsWith('{"schema"'));
      assert.ok(line, 'guide example');
      const out = JSON.parse(run(arena, ['ui', 'scan', '--stdin', '--json'], line.trim()));
      assert.strictEqual(out.ok, true); assert.strictEqual(out.result.status, 'no-pattern-match');
    }
  });
  test('standard installation writes the guide and both skills in the project language', () => {
    for (const lang of ['ko', 'en']) {
      const dir = project('standard-' + lang, lang);
      run(dir, ['init', dir, '--language', lang, ...INIT]);
      const text = fs.readFileSync(path.join(dir, guide.GUIDE_PATH), 'utf8');
      assert.ok(text.includes(lang === 'ko' ? '# 화면 문구 경계' : '# UI copy boundary'));
      for (const name of guide.SKILL_PATHS) assert.ok(fs.existsSync(path.join(dir, name)), name);
    }
  });
  test('minimal installation leaves the advisory guidance out and still verifies', () => {
    for (const file of [guide.GUIDE_PATH, ...guide.SKILL_PATHS]) assert.ok(MINIMAL_SKIP_KEYS.has(file), file);
    const dir = project('minimal', 'ko');
    run(dir, ['init', dir, '--minimal', '--language', 'ko', ...INIT]);
    for (const file of [guide.GUIDE_PATH, ...guide.SKILL_PATHS]) assert.ok(!fs.existsSync(path.join(dir, file)), file);
    run(dir, ['verify', dir]);
  });
  test('reinstall refreshes the managed guide and keeps an authored project note', () => {
    const dir = path.join(arena, 'standard-ko');
    const file = path.join(dir, guide.GUIDE_PATH);
    // An older managed wording plus a team note: reinstall must bring the current guide back
    // (the file is managed) without dropping what the team wrote.
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('# 화면 문구 경계', '# 옛 화면 문구 안내')
      + '\n## 우리 팀 규칙\n관리 화면의 필드 이름은 영어 원문을 유지한다.\n');
    run(dir, ['init', dir, '--language', 'ko', ...INIT]);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.includes('관리 화면의 필드 이름은 영어 원문을 유지한다.'));
    assert.ok(text.startsWith('<!-- leerness:managed -->\n# 화면 문구 경계'), text.slice(0, 120));
  });
  test('the check named in the guide runs and reports a leaked note as a candidate only', () => {
    const input = JSON.stringify({ schema: 'leerness.ui-boundary-scan-input/v1', policyVersion: 'leerness.ui-boundary/v1', taskKind: 'ui',
      surfaces: [{ kind: 'text', exposure: 'rendered', text: '개발자 메모: 결제 문구 교체', attribute: null },
        { kind: 'text', exposure: 'rendered', text: '아직 예약이 없습니다', attribute: null }] });
    const out = JSON.parse(run(arena, ['ui', 'scan', '--stdin', '--json'], input));
    assert.strictEqual(out.ok, true);
    assert.deepStrictEqual(out.result.findings.map(f => [f.surfaceIndex, f.severity]), [[0, 'advisory']]);
    assert.strictEqual(out.result.effects.autoRemove, false);
    run(arena, ['ui', 'review', 'packet', '--help']);
  });
} finally {
  const resolved = fs.realpathSync(arena);
  assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(resolved).startsWith('leerness-ui-copy-'));
  removeTree(resolved, { recursive: true, force: true });
}
console.log(`UI copy boundary: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
