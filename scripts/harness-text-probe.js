'use strict';
// Exercise actual generation, migration and handoff; never filter user Unicode.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const crypto = require('crypto');
const { removeTree } = require('./temp-cleanup');
const cli = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-harness-text-'));
const env = { ...process.env, TEMP: arena, TMP: arena, TMPDIR: arena,
  LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_BANNER: '1',
  LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_AUTOCHCP: '1' };
delete env.LEERNESS_LANG;
for (const key of Object.keys(env)) if (/^LEERNESS_ENABLE_/.test(key)) env[key] = '0';
env.LEERNESS_AUTO_SECURITY_FIX = '0';env.LEERNESS_AUTO_APPLY_DELIVERED = '0';
const evidence = 'Original 🧪️ 🇰🇷 👨‍👩‍👧‍👦 한글 中文 e\u0301 ? \uFFFD';
const files = ['AGENTS.md', 'CLAUDE.md', '.leerness/session-workflow.md',
  '.leerness/language-policy.md', '.leerness/encoding-policy.md'];
const summaries = [];
let passed = 0, failed = 0;
function run(root, args) {
  const r = cp.spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 0, `${args[0]}: ${r.error || r.stderr || r.stdout}`);
  return r.stdout;
}
function read(root, name) { return fs.readFileSync(path.join(root, name), 'utf8'); }
function snapshot(root, names) {
  return names.map(name => { const p = path.join(root, name);return [name, crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'), fs.statSync(p).mtimeMs]; });
}
function test(name, fn) {
  try { fn();passed++;console.log('PASS ' + name); }
  catch (error) { failed++;console.error('FAIL ' + name + ': ' + error.message); }
}
try {
  for (const lang of ['ko', 'en']) {
    const root = path.join(arena, lang + '-프로젝트 🐝');fs.mkdirSync(root);
    run(root, ['init', root, '--yes', '--language', lang, '--no-setup-agents']);
    test(lang + ' generated instructions omit decoration and retain the workflow', () => {
      // Unicode classifies the bidirectional relation arrow as pictographic too;
      // it conveys meaning in the workflow and must not be treated as decoration.
      for (const name of files) assert.doesNotMatch(read(root, name).replace(/↔/g, ''), /\p{Extended_Pictographic}/u, name);
      assert.ok(read(root, '.leerness/session-workflow.md').includes('↔'));
      for (const name of ['AGENTS.md', 'CLAUDE.md']) {
        const doc = read(root, name);assert.match(doc, /leerness:managed/);
        const check = name === 'AGENTS.md' ? 'leerness check' : 'leerness verify-claim';
        for (const cmd of ['leerness handoff', check, 'leerness session close']) assert.ok(doc.includes(cmd), name + ': ' + cmd);
      }
      assert.match(read(root, '.leerness/session-workflow.md'), /CRITICAL/);
      assert.match(read(root, '.leerness/language-policy.md'), new RegExp('Selected language: ' + lang));
      const strategy = read(root, '.leerness/testing-strategy.md');
      assert.ok(strategy.includes('leerness test-run suite-list --stdin --json'));
      assert.ok(strategy.includes(lang === 'en' ? 'listing never proves execution-mode selection'
        : '목록은 실제 실행 시의 선택이나 검사 통과를 증명하지 않습니다'));
    });
    test(lang + ' encoding guidance reaches the installed project with separate I/O boundaries', () => {
      const policy = read(root, '.leerness/encoding-policy.md');
      for (const term of ['PowerShell 5.1', '.ps1', 'BOM', 'stdin', 'stdout', 'Get-Content -Raw -Encoding UTF8', '$OutputEncoding', 'flush']) assert.ok(policy.includes(term), term);
      assert.match(policy, /Check limits/);
      assert.doesNotMatch(policy, /All text files are|모든 텍스트 파일은|Python 2/);
    });
    const note = '.leerness/unicode-원문 🐝.md';fs.writeFileSync(path.join(root, note), evidence + '\n');
    fs.appendFileSync(path.join(root, 'AGENTS.md'), '\n## Custom instructions\n' + evidence + '\n');
    fs.appendFileSync(path.join(root, '.leerness/session-handoff.md'), '\n' + evidence + '\n');
    run(root, ['task', 'add', evidence, '--status', 'in-progress', '--json']);
    const tracked = [...files, note, '.leerness/progress-tracker.md', '.leerness/session-handoff.md'];
    test(lang + ' human and JSON handoff preserve user symbols without decorative labels', () => {
      const before = snapshot(root, tracked);
      const human = run(root, ['handoff', root, '--no-skill-suggest']);
      const structured = JSON.parse(run(root, ['handoff', root, '--json']));
      assert.ok(human.includes(evidence), 'human source evidence missing');
      assert.ok(JSON.stringify(structured).includes(evidence), 'JSON source evidence missing');
      assert.doesNotMatch(human, /(?:🧠 mem|📊 Headline|📊 헤드라인|🛠 Session|🛠 세션|📋 project-brief)/u);
      assert.deepStrictEqual(snapshot(root, tracked), before);
      summaries.push({ language: lang, generatedBytes: files.reduce((sum, name) => sum + Buffer.byteLength(read(root, name)), 0), handoffBytes: Buffer.byteLength(human) });
    });
    test(lang + ' project names with meaningful emoji remain exact', () => {
      const overview = read(root, '.leerness/project-brief.md');
      assert.ok(overview.includes(path.basename(root)), 'project identity changed');
      assert.strictEqual(read(root, note), evidence + '\n');
    });
    test(lang + ' migrate preserves custom Unicode and generates undecorated current sections', () => {
      const old = snapshot(root, [note]);
      // Simulate the decorated heading used by older Leerness releases.
      const agents = read(root, 'AGENTS.md').replace('## ' + (lang === 'en' ? 'First action every session' : '매 세션 첫 행동'), '## ⭐ ' + (lang === 'en' ? 'First action every session' : '매 세션 첫 행동'));
      fs.writeFileSync(path.join(root, 'AGENTS.md'), agents);
      run(root, ['migrate', root, '--force']);
      const migrated = read(root, 'AGENTS.md');
      assert.ok(migrated.includes(evidence), 'custom instructions lost');
      const current = migrated.split('<!-- leerness:migration-preserved -->')[0];
      assert.doesNotMatch(current, /\p{Extended_Pictographic}/u);
      assert.deepStrictEqual(snapshot(root, [note]), old);
      assert.strictEqual(read(root, '.leerness/LANGUAGE').trim(), lang);
    });
    test(lang + ' minimal instructions retain plain-writing guidance and required commands', () => {
      run(root, ['mode', 'set', 'minimal']);
      const agents = read(root, 'AGENTS.md').split('<!-- leerness:migration-preserved -->')[0];
      assert.match(agents, /minimal/);
      assert.doesNotMatch(agents, /\p{Extended_Pictographic}/u);
      assert.ok(agents.includes(lang === 'en' ? 'decorative emoji' : '장식용 이모지'));
      for (const cmd of ['leerness handoff', 'leerness verify-claim', 'leerness session close']) assert.ok(agents.includes(cmd));
    });
  }
  console.log('Measurement: ' + JSON.stringify(summaries));
  console.log(`Tests: ${passed}/${passed + failed} passed`);
  process.exitCode = failed ? 1 : 0;
} finally {
  const resolved = fs.realpathSync(arena), parent = fs.realpathSync(os.tmpdir());
  assert.strictEqual(path.dirname(resolved).toLowerCase(), parent.toLowerCase());
  assert.ok(path.basename(resolved).startsWith('leerness-harness-text-'));
  removeTree(resolved, { recursive: true, force: true });
}
