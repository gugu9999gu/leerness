'use strict';
require('./temp-cleanup').trackTemp(module);

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { createHash } = require('node:crypto');
const core = require('../bin/leerness');
const guidance = require('../lib/context-reading-guidance');

const readmes = new Map();
function canonicalReadme(lang) {
  if (readmes.has(lang)) return readmes.get(lang);
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lean-readme-'));
  const root = path.join(arena, 'project');
  fs.mkdirSync(path.join(root, '.leerness'), { recursive: true });
  for (const [name, value] of Object.entries(core.coreFiles(root, lang))) {
    const file = path.join(root, name);fs.mkdirSync(path.dirname(file), { recursive: true });fs.writeFileSync(file, value);
  }
  fs.writeFileSync(path.join(root, '.leerness', 'LANGUAGE'), lang + '\n');
  const start = '<!-- leerness:project-readme:start -->';
  const end = '<!-- leerness:project-readme:end -->';
  const prefix = '# Owner README\nOwner rule: require independent deployment approval. 한글 e\u0301';
  const suffix = '## Owner notes\nKeep original project rules and evidence. 日本語\n';
  const original = Buffer.from(prefix + '\n\n' + start + '\nPrevious generated region\n' + end + '\n' + suffix);
  const readme = path.join(root, 'README.md');
  fs.writeFileSync(readme, original);
  fs.writeFileSync(path.join(arena, 'README.original.bin'), original);
  const cli = path.resolve(__dirname, '../bin/leerness.js');
  const source = fs.readFileSync(cli);
  const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_LANG: lang,
    LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1' };
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR']) {
    env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key], { recursive: true });
  }
  for (const key of Object.keys(env)) if (/^LEERNESS_ENABLE_/.test(key)) env[key] = '0';
  env.LEERNESS_AUTO_SECURITY_FIX = '0';env.LEERNESS_AUTO_APPLY_DELIVERED = '0';
  let generated;
  for (let round = 0; round < 2; round++) {
    const result = cp.spawnSync(process.execPath, [cli, 'readme', 'sync', root], {
      cwd: root, env, encoding: 'utf8', timeout: 45000, windowsHide: true
    });
    assert.ifError(result.error);assert.equal(result.status, 0, result.stdout + result.stderr);
    const current = fs.readFileSync(readme);
    if (generated) assert.deepEqual(current, generated, 'repeat canonical README sync must be stable');
    generated = current;
  }
  assert.deepEqual(fs.readFileSync(cli), source, 'README generation must preserve source bytes');
  const text = generated.toString('utf8');
  assert.equal(text.slice(0, text.indexOf(start)), prefix + '\n\n');
  assert.equal(text.slice(text.indexOf(end) + end.length), '\n' + suffix);
  assert.doesNotMatch(text, /Previous generated region/);
  assert.match(text, new RegExp('Leerness v' + core.VERSION.replace(/\./g, '\\.')));
  fs.writeFileSync(path.join(arena, 'binding.json'), JSON.stringify({ language: lang, sourceSha256:
    createHash('sha256').update(source).digest('hex'), originalSha256: createHash('sha256').update(original).digest('hex'),
  generatedSha256: createHash('sha256').update(generated).digest('hex') }, null, 2) + '\n');
  console.log('Canonical README fixture ' + lang + ': ' + arena);
  readmes.set(lang, text);return text;
}

for (const lang of ['en', 'ko']) {
  test('canonical README lifecycle is selected and respects current rules: ' + lang, () => {
    const text = canonicalReadme(lang);
    assert.doesNotMatch(text, /AI agents must load context|수행해야 합니다|at every session start|at every session end|# 3\. AI 세션 시작 시|# 4\. 세션 종료 시/);
    for (const command of ['handoff', 'check', 'audit', 'session close']) assert.ok(text.includes('leerness ' + command));
    if (lang === 'en') {
      assert.match(text, /only when relevant, explicitly selected, or required by applicable current user\/project rules/);
      assert.match(text, /Completion claims require actual evidence/);
      assert.match(text, /commands and writes require authorization for their scope/);
    } else {
      assert.match(text, /관련이 있거나 명시적으로 선택했거나 적용되는 현재 사용자·프로젝트 규칙이 요구할 때만/);
      assert.match(text, /완료 주장에는 실제 근거가 필요/);
      assert.match(text, /명령과 쓰기는 해당 범위의 승인이 필요/);
    }
  });
  test('canonical README autonomous signal does not authorize publication: ' + lang, () => {
    const text = canonicalReadme(lang);
    assert.match(text, /<<autonomous-loop-dynamic>>/);
    assert.doesNotMatch(text, /Send the `<<autonomous-loop-dynamic>>` signal and the AI will|신호만 보내면 AI가:/);
    if (lang === 'en') {
      assert.match(text, /do not treat the signal, a passing test or session close as release approval/);
      assert.match(text, /npm publication, Git tags, main pushes and scheduling the next round require explicit authorization for that action and target/);
    } else {
      assert.match(text, /신호·테스트 통과·session close는 배포 승인이 아니며/);
      assert.match(text, /npm 게시·Git 태그·main push·다음 라운드 예약은 해당 작업과 대상을 명시한 승인이 필요/);
    }
  });
}

test('standard generated guidance stops forcing every workflow and preview', () => {
  for (const lang of ['ko', 'en']) {
    const f = core.coreFiles(process.cwd(), lang, [], { mode: 'standard' });
    const agents = f['AGENTS.md'];
    assert.match(agents, /Session context \(on demand\)/);
    assert.doesNotMatch(agents, /미리보기 승인 의무|디자인 시안 의무|모호성 질문 의무/);
    assert.doesNotMatch(agents, /6단계 워크플로 — 최우선|매 세션 반드시 따름/);
    if (lang === 'ko') assert.match(agents, /해당 작업에 적용되는 사용자 규칙만 확인하고 준수/);
    else {
      assert.match(agents, /review and follow applicable current owner rules/);
      assert.doesNotMatch(agents, /Preview-approval duty|Design-mockup duty|highest priority|follow every session|Before claiming completion, self-verify/);
    }
    assert.match(agents, /optional|선택|필요/);
    assert.match(f['CLAUDE.md'], /universal gates|universal session gates|선택|may use/);
    assert.doesNotMatch(f['CLAUDE.md'], /Read \.leerness\/anti-lazy-work-policy\.md before claiming completion|즉시 `leerness rule add/);
    assert.doesNotMatch(f['.leerness/guideline.md'], /변경 후 .*verify.*audit.*check.*실행합니다/);
    assert.doesNotMatch(f['.leerness/session-workflow.md'], /단순 작업도 동일 흐름 유지/);
    assert.match(f['.cursor/rules/leerness.mdc'], /alwaysApply: false/);
    assert.match(f['.cursor/rules/leerness.mdc'], /description: Leerness project memory/);
    assert.match(f['.cursor/rules/leerness.mdc'],
      /^---\ndescription: [^\n]+\nalwaysApply: false\n---\n<!-- leerness:managed -->\n/);
    assert.doesNotMatch(f['.cursor/rules/leerness.mdc'], /\\nalwaysApply: false/);

    assert.doesNotMatch(f['.cursor/rules/leerness.mdc'], /alwaysApply: true/);

  }
});

test('minimal mode preserves evidence semantics without mandatory CLI lifecycle', () => {
  for (const lang of ['ko', 'en']) {
    const f = core.coreFiles(process.cwd(), lang, [], { mode: 'minimal' });
    assert.match(f['AGENTS.md'], /optional|선택|필요/);
    assert.match(f['AGENTS.md'], /verify-claim/);
    assert.doesNotMatch(f['CLAUDE.md'], /Three rules, always:/);
  }
});

test('owner-authored migration-preserved tail is retained verbatim', () => {
  const tail = '\n<!-- leerness:migration-preserved -->\n## User rule\nNever deploy without independent approval.\n';
  const f = { 'AGENTS.md': '<!-- leerness:managed -->\n# Leerness Agent Instructions\n' + tail };
  guidance.apply(f, 'en');
  assert.ok(f['AGENTS.md'].includes(tail));
});

test('default reading policy never claims independent approval', () => {
  const en = guidance.policy('en'), ko = guidance.policy('ko');
  assert.match(en, /actual evidence/); assert.match(en, /optional/);
  assert.match(ko, /실제 근거/); assert.match(ko, /선택적/);
  assert.match(en, /mandatory constraints/);
  assert.match(ko, /필수 제약/);
});

test('an owner-customized Cursor rule keeps its always-on override and original text', () => {
  const custom = '<!-- leerness:managed -->\n---\nalwaysApply: true\n---\n'
    + '<!-- leerness:migration-preserved -->\n## Owner-approved override\nKeep always-on for this project.\n';
  const files = { '.cursor/rules/leerness.mdc': custom };
  guidance.apply(files, 'en');
  assert.match(files['.cursor/rules/leerness.mdc'], /alwaysApply: true/);
  assert.match(files['.cursor/rules/leerness.mdc'], /Owner-approved override/);
  assert.match(files['.cursor/rules/leerness.mdc'], /Keep always-on for this project/);
  assert.doesNotMatch(files['.cursor/rules/leerness.mdc'], /alwaysApply: false/);
});

test('canonical Korean README performance guidance avoids unsupported runtime promises', () => {
  const section = canonicalReadme('ko').split('### 성능 가이드\n')[1]?.split('\n### ')[0];
  assert.ok(section);
  assert.doesNotMatch(section, /평균|~\s*\d|\d+\s*(?:ms|s)\b|모두 메모리 캐싱/);
  for (const command of ['leerness handoff .', 'leerness memory status --json', 'leerness task list --json',
    'leerness drift check --json', 'tools/list']) assert.ok(section.includes(command));
  assert.match(section, /데이터·환경·캐시 상태에 따라 달라집니다/);
  assert.match(section, /필요한 명령만 선택하고 같은 조건에서 직접 측정/);
});
