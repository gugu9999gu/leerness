'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-context-reading-'));
  try {
    const env = { ...process.env, CONTEXT_READING_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    // 3600 s and 300 s per call: on 2026-09-30 one `init` took 73-90 s on this machine while other sessions ran their
    // suites (the same for the previous tree), and a 90 s call limit failed the upgrade test before it reached migrate.
    // The limits catch a hang; they do not measure speed.
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 3600000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if (r.error) process.stderr.write(r.error.message + '\n');process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-context-reading-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.CONTEXT_READING_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js'), core = require('../bin/leerness');
let sequence = 0, passed = 0, failed = 0;
const at = process.argv.indexOf('--match'), filter = at < 0 ? '' : process.argv[at + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
const text = p => fs.readFileSync(p, 'utf8');
const state = p => [fs.readFileSync(p), fs.statSync(p, { bigint: true }).mtimeNs];
function fixture(lang = 'en', mode = 'standard') {
  const dir = path.join(arena, (++sequence) + '-한글 project');fs.mkdirSync(dir);
  for (const [name, value] of Object.entries(core.coreFiles(dir, lang, [], { mode }))) { const file = path.join(dir, name);fs.mkdirSync(path.dirname(file), { recursive: true });fs.writeFileSync(file, value); }
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"context-test","version":"1.0.0"}\n');return { dir, lang, file: n => path.join(dir, n) };
}
function call(f, args, hook) {
  const r = cp.spawnSync(process.execPath, [...(hook ? ['--require', hook] : []), cli, ...args], {
    cwd: f.dir, encoding: 'utf8', timeout: 300000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_HOOK: '', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1', LEERNESS_LANG: f.lang }
  });assert.ifError(r.error);assert.strictEqual(r.status, 0, r.stdout + r.stderr);return r;
}
const capture = path.join(arena, 'capture-dispatch.cjs');
fs.writeFileSync(capture, `const a=require(${JSON.stringify(path.resolve(__dirname, '../lib/agents'))});a.agentsCmd=(root,sub,args,deps)=>console.log(JSON.stringify({brief:deps._harnessBrief(),command:deps._dispatchCommand('codex',deps._harnessBrief()+'Inspect assigned files',false)}));`);
// Exercise the real dispatcher while replacing only local provider discovery.
// Preparing a command must not launch a coding agent or require credentials.
const dispatch = path.join(arena, 'dispatch-offline.cjs');
fs.writeFileSync(dispatch, `const a=require(${JSON.stringify(path.resolve(__dirname, '../lib/agents'))});const original=a.agentsCmd;a.agentsCmd=(root,sub,args,deps)=>original(root,sub,args,{...deps,_checkAgent:()=>({status:'ready',version:'fixture'}),_cliChat:()=>{throw Error('Unexpected provider call');}});`);
for (const lang of ['en', 'ko']) test('repro generated entry scopes the old blanket reading list: ' + lang, () => {
  const files = core.coreFiles(arena, lang);assert.ok(!files['AGENTS.md'].includes('## Mandatory read order'));
  assert.match(files['AGENTS.md'], /Context reading scope|컨텍스트 읽기 범위/);
});
for (const lang of ['en', 'ko']) test('generated owner-only start, writeback and close: ' + lang, () => {
  const agents = core.coreFiles(arena, lang)['AGENTS.md'];
  if (lang === 'ko') {
    assert.match(agents, /- 주 세션 담당자는 세션 시작 시 `leerness handoff \.`/);
    assert.match(agents, /- 주 세션 담당자는 의미 있는 변경 후 progress-tracker/);
    assert.match(agents, /- 주 세션 담당자는 세션 종료 시 `leerness session close \.`/);
    assert.ok(!agents.includes('- 작업 시작 시 `leerness handoff .`'));
    assert.ok(!agents.includes('- 의미 있는 변경 후 progress-tracker'));
    assert.ok(!agents.includes('- 매 세션 종료 시 `leerness session close .`'));
  } else {
    assert.match(agents, /- The main session owner runs `leerness handoff \.`/);
    assert.match(agents, /- After meaningful changes, the main session owner updates progress-tracker/);
    assert.match(agents, /- The main session owner closes with `leerness session close \.`/);
    assert.ok(!agents.includes('- Run `leerness handoff .` at session start'));
    assert.ok(!agents.includes('- After meaningful changes update progress-tracker'));
    assert.ok(!agents.includes('- Close every session with `leerness session close .`'));
  }
});
test('repro delegated dispatch does not demand a second task registration or session closure', () => {
  const data = JSON.parse(call(fixture(), ['agents', 'dispatch', 'Inspect assigned files', '--to', 'codex', '--json'], capture).stdout);
  assert.ok(!data.brief.includes('task add'));assert.ok(!data.brief.includes('session close'));assert.match(data.brief, /assigned task/i);assert.match(data.brief, /current.*rules/i);
});
test('repro route output is a targeted context index', () => {
  const r = call(fixture(), ['route', 'feature']);assert.match(r.stdout, /Context index/);assert.match(r.stdout, /relevant sections/);assert.ok(!r.stdout.includes('Read before work:'));
});
test('repro compact context does not invent project rules', () => {
  const r = call(fixture(), ['handoff', '.', '--compact', '--no-drift-check']);assert.ok(!r.stdout.includes('의존성0'));assert.match(r.stdout, /counts are not rule text/);assert.match(r.stdout, /rule list/);
});
test('repro global adapter distinguishes the session owner from delegates', () => {
  const f = fixture(), globalFile = path.join(os.homedir(), '.codex', 'AGENTS.md');fs.mkdirSync(path.dirname(globalFile), { recursive: true });fs.writeFileSync(globalFile, '# User guidance\nPreserve 한글\n');
  call(f, ['adapter', 'codex', '--global']);const saved = text(globalFile);assert.match(saved, /Context reading scope|컨텍스트 읽기 범위/);assert.ok(saved.includes('Preserve 한글'));
  call(f, ['adapter', 'codex', '--global']);assert.strictEqual(text(globalFile), saved);
  call(f, ['adapter', 'codex', '--global', '--remove']);assert.strictEqual(text(globalFile), '# User guidance\nPreserve 한글\n');
});
for (const lang of ['en', 'ko']) for (const mode of ['minimal', 'standard', 'advanced']) {
  test('generated scopes retain constraints and review criteria: ' + lang + '/' + mode, () => {
    const files = core.coreFiles(arena, lang, [], { mode });
    assert.match(files['AGENTS.md'], /Missing\/stale|누락·오래된/);
    assert.strictEqual((files['AGENTS.md'].match(/## (?:Context reading scope|컨텍스트 읽기 범위)/g) || []).length, 1);
    // T-0314 (owner decision, 2026-09-29): Leerness serves several agents, so AGENTS.md holds the one full copy of
    // the reading paragraph and the reviewer protocol; the other agent entry files and the workflow point to it.
    const cr = require('../lib/context-reading-guidance'), rf = require('../lib/review-feedback-guidance');
    for (const name of ['CLAUDE.md', '.cursor/rules/leerness.mdc', '.github/copilot-instructions.md', '.leerness/session-workflow.md']) {
      assert.ok(files[name].includes(cr.pointer(lang)), name + ': reading pointer missing');
      assert.ok(files[name].includes(rf.pointer(lang)), name + ': reviewer pointer missing');
      assert.ok(!/## (?:Context reading scope|컨텍스트 읽기 범위)/.test(files[name]), name + ': reading paragraph repeated');
      assert.ok(!/NEEDS_DECISION/.test(files[name]), name + ': reviewer protocol repeated');
    }
    for (const name of ['AGENTS.md', 'CLAUDE.md']) assert.ok(files[name].includes('verify-claim'), name);
    assert.ok(files['AGENTS.md'].includes('review-feedback start --stdin'));
    assert.match(files['AGENTS.md'], /NEEDS_DECISION/);
    // Claude Code expands this line at launch and loads the shared file (docs: "Share one file with other coding tools").
    assert.match(files['CLAUDE.md'], /^@AGENTS\.md$/m);
    // Minimal follows the paragraph directly: no context-routing reference, which context budget would load.
    if (mode === 'minimal') assert.ok(!files['AGENTS.md'].includes('context-routing.md'));
    else assert.ok(files['AGENTS.md'].includes('.leerness/context-routing.md'));
    const routing = files['.leerness/context-routing.md'];
    assert.match(routing, /IDs\/source revision or check time|출처 버전 또는 확인 시점/);
    assert.match(routing, /mandatory constraints|필수 제약/);
    assert.match(routing, /independently inspect source|근거를 독립 확인/);
    assert.match(routing, /Changed inputs|입력 변경/);
    assert.match(routing, /not.*proof of compliance|준수 증거가 아니다/);
    assert.match(files['.leerness/protected-files.md'], /explicit user approval/);
  });
}
// T-0314: a fresh project must fit its own context budget (the budget's stated basis). Guidance growth pushed
// a standard English project with one task, decision and plan to 12,076/12,000 and a fresh English minimal
// project to 4,148/1,200; only the 2.9-hour e2e noticed. `call` requires exit 0, which `context budget` gives
// only within budget. English is the tighter case for both modes (length-based token estimate).
test('fresh standard and minimal projects stay within their own context budget', () => {
  const project = (lang, extra) => {
    const dir = path.join(arena, (++sequence) + '-budget');fs.mkdirSync(dir);
    const f = { dir, lang, file: n => path.join(dir, n) };
    fs.writeFileSync(f.file('package.json'), '{"name":"budget-test","version":"0.1.0"}\n');
    call(f, ['init', '.', '--yes', '--no-setup-agents', '--no-mcp', '--no-auto-roadmap', '--no-official-skills', '--no-banner', '--language', lang, ...extra]);
    return f;
  };
  const std = project('en', []);
  call(std, ['task', 'add', 'Implement the parser', '--json']);
  call(std, ['decision', 'add', 'Use JSON storage', '--reason', 'simplest', '--json']);
  call(std, ['plan', 'add', 'Ship v1', '--json']);
  const s = JSON.parse(call(std, ['context', 'budget', '--json']).stdout);
  assert.strictEqual(s.mode, 'standard');
  assert.strictEqual(s.over, false, JSON.stringify({ total: s.total, budget: s.budget }));
  const min = project('en', ['--mode', 'minimal']);
  const m = JSON.parse(call(min, ['context', 'budget', '--json']).stdout);
  assert.strictEqual(m.mode, 'minimal');
  assert.strictEqual(m.over, false, JSON.stringify({ total: m.total, budget: m.budget }));
  assert.ok(!m.parts.some(p => p.key === 'referencedDocs'), 'minimal loads referenced documents');
});
test('selected authoring language also controls the reading policy', () => {
  const files = core.coreFiles(arena, 'ko', [], { authoringLanguage: 'en' });
  assert.match(files['AGENTS.md'], /## Context reading scope/);
  assert.match(files['.leerness/context-routing.md'], /## Context reading policy/);
  assert.strictEqual(files['.leerness/LANGUAGE'], 'ko\n');
});
test('real dispatch keeps the task and bounded context, without execution', () => {
  const f = fixture(), task = 'T-8 Review src/user.js against frozen criteria';
  const data = JSON.parse(call(f, ['agents', 'dispatch', task, '--to', 'codex', '--json'], dispatch).stdout);
  assert.strictEqual(data.executed, false);assert.strictEqual(data.mode, 'read-only');
  assert.ok(data.command.includes(task));assert.match(data.command, /current project rules/);
  assert.ok(!data.command.includes('task add'));assert.ok(!data.command.includes('session close'));
});
test('real dispatch raw and toggle opt-outs still retain the exact task', () => {
  const f = fixture(), task = 'Inspect src/user.js';
  const args = ['agents', 'dispatch', task, '--to', 'codex', '--json'];
  const raw = JSON.parse(call(f, [...args, '--raw'], dispatch).stdout);
  assert.ok(raw.command.includes(task));assert.ok(!raw.command.includes('Leerness delegated work'));
  call(f, ['toggle', 'set', 'delegation-brief', 'off', '--json']);
  const off = JSON.parse(call(f, args, dispatch).stdout);assert.strictEqual(off.command, raw.command);
});
test('reviewer guidance stays portable with independent source checks and fixed criteria', () => {
  const brief = require('../lib/context-reading-guidance').DELEGATED_CONTEXT;
  const review = require('../lib/review-feedback-guidance').REVIEW_GUIDANCE;
  assert.ok(!/[\r\n`$"\\]/u.test(brief));
  const command = core._dispatchCommand('codex', brief + 'Review T-8. ' + review, false);
  for (const term of ['independently check source', 'REQUIRED_OUTCOME', 'ACCEPTANCE_CRITERIA', 'NEEDS_DECISION', 'never restart']) assert.ok(command.includes(term), term);
});
test('workspace compact also avoids invented rules', () => {
  const f = fixture(), second = fixture();
  const r = call(f, ['handoff', '.', '--include', second.dir, '--compact', '--no-drift-check']);
  assert.match(r.stdout, /projects:/);assert.ok(!r.stdout.includes('의존성0'));
  assert.match(r.stdout, /counts are not rule text/);
});
const install = command => [command, '.', '--yes', '--no-setup-agents', '--no-mcp', '--no-auto-roadmap', '--no-official-skills', '--no-banner'];
for (const lang of ['en', 'ko']) test('actual init and legacy migration preserve custom rules and state: ' + lang, () => {
  const dir = path.join(arena, (++sequence) + '-install');fs.mkdirSync(dir);
  const f = { dir, lang, file: n => path.join(dir, n) };
  call(f, [...install('init'), '--language', lang]);
  assert.match(text(f.file('AGENTS.md')), /Context reading scope|컨텍스트 읽기 범위/);
  const note = 'CUSTOM preserve 사용자 원문 e\u0301';
  fs.appendFileSync(f.file('AGENTS.md'), '\n## Custom instructions\n' + note + '\n');
  fs.appendFileSync(f.file('.leerness/context-routing.md'), '\n## Custom route\n' + note + '\n');
  call(f, ['rule', 'add', 'Preserve customer constraints 한글', '--trigger', 'every-round', '--json']);
  call(f, ['task', 'add', 'Existing assigned work', '--status', 'in-progress', '--json']);
  const protectedNames = ['.leerness/rules.md', '.leerness/progress-tracker.md', '.leerness/session-handoff.md'];
  const before = protectedNames.map(n => state(f.file(n)));
  // Simulate the exact old bootstrap section, not arbitrary user instructions.
  const file = f.file('AGENTS.md');
  fs.writeFileSync(file, text(file).replace(/\n## (?:Context reading scope|컨텍스트 읽기 범위)\n[\s\S]*?(?=\n## )/, '\n').replace('## Context index (session owner; relevant sections)', '## Mandatory read order (session start)'));
  fs.writeFileSync(f.file('.leerness/HARNESS_VERSION'), '1.36.188\n');
  call(f, install('migrate'));
  for (const name of ['AGENTS.md', '.leerness/context-routing.md']) {
    const saved = text(f.file(name));assert.ok(saved.includes(note), name + ': custom content missing');
    assert.match(saved, /Context reading (?:scope|policy)|컨텍스트 읽기 (?:범위|정책)/);
  }
  assert.deepStrictEqual(protectedNames.map(n => state(f.file(n))), before);
  call(f, install('migrate'));
  for (const name of ['AGENTS.md', '.leerness/context-routing.md']) {
    const saved = text(f.file(name));assert.strictEqual(saved.split(note).length, 2);
    const heading = name === 'AGENTS.md' ? /## (?:Context reading scope|컨텍스트 읽기 범위)/g : /## (?:Context reading policy|컨텍스트 읽기 정책)/g;
    assert.strictEqual((saved.match(heading) || []).length, 1);
  }
  assert.deepStrictEqual(protectedNames.map(n => state(f.file(n))), before);
});
test('legacy Korean blanket reading instructions retire only with an exact original backup', () => {
  const dir = path.join(arena, (++sequence) + '-legacy-reading');fs.mkdirSync(dir);
  const f = { dir, lang: 'ko', file: n => path.join(dir, n) };
  call(f, [...install('init'), '--language', 'ko']);
  const agentFile = f.file('AGENTS.md');
  const currentLead = '## 매 세션 첫 행동\n주 세션 담당자는 .leerness/session-workflow.md부터 시작하고 위임 에이전트는 위 읽기 범위를 따른다.';
  const oldLead = '## ⭐ 매 세션 첫 행동\n**반드시 `.leerness/session-workflow.md`를 먼저 읽고 6단계 워크플로를 따른다**: 요청분석→계획→분배→sub-agent작업→종합검증→마감. 라운드 길이/복잡도 무관, drift 방지를 위해 모든 작업에 동일 흐름 유지.';
  const oldOwnerLines = [
    '- 작업 시작 시 `leerness handoff .`를 실행해 컨텍스트를 적재합니다 (handoff가 active rules를 자동 출력).',
    '- 의미 있는 변경 후 progress-tracker, current-state, task-log, session-handoff를 갱신합니다.',
    '- 매 세션 종료 시 `leerness session close .`로 9개 카테고리(완료/진행중/미완료/예정/대기/보류/차단/드랍/검증) + **활성 룰 검증 결과**를 보고합니다.',
  ];
  const newOwnerLines = [
    '- 주 세션 담당자는 세션 시작 시 `leerness handoff .`로 컨텍스트를 적재합니다 (handoff가 active rules를 자동 출력).',
    '- 주 세션 담당자는 의미 있는 변경 후 progress-tracker, current-state, task-log, session-handoff를 갱신합니다.',
    '- 주 세션 담당자는 세션 종료 시 `leerness session close .`로 9개 카테고리(완료/진행중/미완료/예정/대기/보류/차단/드랍/검증) + **활성 룰 검증 결과**를 보고합니다.',
  ];
  const custom = 'CUSTOM-KEEP: 사용자 지침은 검수에도 적용한다.';
  let older = text(agentFile).replace(currentLead, oldLead)
    .replace('## Context index (session owner; relevant sections)', '## Mandatory read order (session start)');
  for (let i = 0; i < oldOwnerLines.length; i++) older = older.replace(newOwnerLines[i], oldOwnerLines[i]);
  older = older.trimEnd() + '\n\n## Project-specific instruction\n' + custom + '\n';
  assert.ok(older.includes(oldLead));assert.ok(older.includes('## Mandatory read order (session start)'));
  fs.writeFileSync(agentFile, older);fs.writeFileSync(f.file('.leerness/HARNESS_VERSION'), '1.36.188\n');
  call(f, install('migrate'));
  const migrated = text(agentFile);
  assert.match(migrated, /## 컨텍스트 읽기 범위/);
  assert.ok(!migrated.includes(oldLead), 'retired generated first-action instruction survived');
  assert.ok(!migrated.includes('## Mandatory read order (session start)'), 'retired generated mandatory heading survived');
  for (let i = 0; i < oldOwnerLines.length; i++) {
    assert.ok(!migrated.includes(oldOwnerLines[i]), 'old owner-wide requirement survived');
    assert.ok(migrated.includes(newOwnerLines[i]), 'scoped owner requirement missing');
  }
  assert.strictEqual(migrated.split(custom).length, 2);
  const archives = fs.readdirSync(f.file('.leerness/archive')).filter(n => n.startsWith('leerness-')).sort();
  assert.ok(archives.length);
  const original = f.file('.leerness/archive/' + archives[archives.length - 1] + '/files/AGENTS.md');
  assert.strictEqual(text(original), older, 'exact original was not retained');
  call(f, install('migrate'));
  assert.strictEqual(text(agentFile).split(custom).length, 2);
  assert.ok(!text(agentFile).includes('## Mandatory read order (session start)'));
});
// Cross-model review 2026-09-30: development builds up to 1.36.289 wrote the context-reading section and the reviewer
// protocol into six managed files; after the pointer layout, migrate carried them into "Preserved previous content".
// The fixture is what the real 1.36.289 CLI wrote (whole files), independent of the retirement catalogue.
const LEGACY = require('./fixtures/legacy-guidance-1.36.289.json');
const MANAGED = ['AGENTS.md', 'CLAUDE.md', '.cursor/rules/leerness.mdc', '.github/copilot-instructions.md', '.leerness/session-workflow.md', '.leerness/review-checklist.md'];
const splitPreserved = s => { const at = s.indexOf('<!-- leerness:migration-preserved -->'); return at < 0 ? [s, ''] : [s.slice(0, at), s.slice(at)]; };
const keptLines = tail => tail.split('\n').filter(l => l.trim() && !/^<!--|^## Preserved previous content|^> /.test(l));
test('real 1.36.289 instruction files upgrade to the current layout; custom lines an earlier migration preserved stay', () => {
  // The custom line sits where an earlier migration put it: below the preserved marker, written by the product's own
  // merge (the "---" separator included). The head above it is the unedited 1.36.289 file, so its generated sections
  // retire and only the custom line is preserved.
  const { _managedMerge } = require('../lib/pure-utils');
  for (const [key, files] of Object.entries(LEGACY.files)) {
    const [lang, mode] = key.split('-');
    const fresh = path.join(arena, (++sequence) + '-legacy-fresh'), dir = path.join(arena, (++sequence) + '-legacy-old');
    for (const d of [fresh, dir]) { fs.mkdirSync(d); call({ dir: d, lang }, [...install('init'), '--language', lang, ...(mode === 'minimal' ? ['--mode', 'minimal'] : [])]); }
    const f = { dir, lang, file: n => path.join(dir, n) }, custom = n => 'CUSTOM-KEEP ' + key + ' ' + n + ' 사용자 지침';
    for (const n of MANAGED) {
      const old = _managedMerge(n, files[n], files[n].trimEnd() + '\n\n' + custom(n) + '\n', '.leerness/archive', null, { lang });
      assert.ok(old.startsWith(files[n].trimEnd() + '\n\n---\n<!-- leerness:migration-preserved -->'), 'fixture layout ' + n);
      fs.writeFileSync(f.file(n), old);
    }
    fs.writeFileSync(f.file('.leerness/HARNESS_VERSION'), '1.36.289\n');
    for (let pass = 1; pass <= 2; pass++) {
      call(f, install('migrate'));
      for (const n of MANAGED) {
        const [head, tail] = splitPreserved(text(f.file(n)).replace(/\r\n/g, '\n'));
        assert.strictEqual(head.trimEnd().replace(/\n---$/, '').trimEnd(), text(path.join(fresh, n)).replace(/\r\n/g, '\n').trimEnd(), key + ' pass ' + pass + ' ' + n + ': managed part differs from a fresh file');
        assert.deepStrictEqual(keptLines(tail), [custom(n)], key + ' pass ' + pass + ' ' + n + ': preserved lines');
      }
    }
  }
});
test('real 1.36.289 files with the user\'s own text in the managed part keep every old section, preserved with that text', () => {
  // Cross-model review rounds 3 and 4: text around a section cannot prove it generated, so a head with any line of the
  // user's keeps the old sections. Migrate carries them and the user's text into the preserved part, in order; the
  // managed part is still the fresh layout. Nothing is lost. Both places users add text: directly after the last
  // section, and under their own heading.
  const key = 'ko-standard', lang = 'ko', n = 'CLAUDE.md', old = LEGACY.files[key][n];
  const { RETIRED_SECTIONS } = require('../lib/retired-guidance-sections');
  const olds = RETIRED_SECTIONS.filter(s => old.includes(s)).sort((a, b) => old.indexOf(a) - old.indexOf(b));
  assert.strictEqual(olds.length, 2, 'fixture: CLAUDE.md has two generated sections');
  assert.ok(old.trimEnd().endsWith(olds[1]), 'fixture: CLAUDE.md ends with a generated section');
  const extra = '검수자 지정 작업에는 보안 검토도 포함한다.';
  for (const [label, added] of [['adjacent', '\n\n' + extra + '\n'], ['own heading', '\n\n## 프로젝트 지침\n' + extra + '\n']]) {
    const fresh = path.join(arena, (++sequence) + '-own-text-fresh'), dir = path.join(arena, (++sequence) + '-own-text-old');
    for (const d of [fresh, dir]) { fs.mkdirSync(d); call({ dir: d, lang }, [...install('init'), '--language', lang]); }
    const f = { dir, lang, file: x => path.join(dir, x) };
    fs.writeFileSync(f.file(n), old.trimEnd() + added);
    fs.writeFileSync(f.file('.leerness/HARNESS_VERSION'), '1.36.289\n');
    call(f, install('migrate'));
    const [head, tail] = splitPreserved(text(f.file(n)).replace(/\r\n/g, '\n'));
    assert.strictEqual(head.trimEnd().replace(/\n---$/, '').trimEnd(), text(path.join(fresh, n)).replace(/\r\n/g, '\n').trimEnd(), label + ': managed part differs from a fresh file');
    const kept = keptLines(tail), freshLines = new Set(text(path.join(fresh, n)).replace(/\r\n/g, '\n').split('\n').map(x => x.trim()));
    // Nothing lost: every old line is in the managed part or preserved, and each section's paragraphs are preserved.
    for (const s of olds) for (const l of s.split('\n').filter(x => x.trim())) assert.ok(kept.includes(l) || freshLines.has(l.trim()), label + ': lost: ' + l);
    for (const s of olds) for (const l of s.split('\n').slice(2).filter(x => x.trim())) assert.ok(kept.includes(l), label + ': section paragraph not preserved: ' + l.slice(0, 40));
    assert.strictEqual(kept[kept.length - 1], extra, label + ': the user\'s text is preserved last');
    assert.ok(kept.indexOf(olds[1].split('\n')[0]) < kept.indexOf(extra), label + ': order');
  }
});
test('a copied template heading and import line above a copy of the old protocol keep that copy through migrate', () => {
  // Review round 5: every line the user appended is template text or a retired section, yet the file is no layout any
  // build wrote. Through the real migrate (backup-backed merge), the copied protocol must survive.
  const dir = path.join(arena, (++sequence) + '-round5-copy'); fs.mkdirSync(dir);
  const f = { dir, lang: 'en', file: n => path.join(dir, n) };
  call(f, [...install('init'), '--language', 'en']);
  const { RETIRED_SECTIONS } = require('../lib/retired-guidance-sections');
  const S = RETIRED_SECTIONS.find(s => s.startsWith('## Assigned reviewer protocol'));
  const current = text(f.file('CLAUDE.md')).replace(/\r\n/g, '\n');
  const heading = current.split('\n').find(l => /^## /.test(l)), importLine = current.split('\n').find(l => /^@/.test(l));
  assert.ok(heading && importLine, 'fixture: the current CLAUDE.md has a level-2 heading and an import line');
  fs.writeFileSync(f.file('CLAUDE.md'), current.trimEnd() + '\n\n' + heading + '\n\n' + importLine + '\n\n' + S + '\n');
  fs.writeFileSync(f.file('.leerness/HARNESS_VERSION'), '1.36.289\n');
  call(f, install('migrate'));
  const after = text(f.file('CLAUDE.md')).replace(/\r\n/g, '\n');
  for (const l of S.split('\n').filter(x => x.trim())) assert.ok(after.includes(l), 'the copied protocol lost: ' + l.slice(0, 60));
});
test('a head that is exactly a file an old build wrote is dropped; any other head is left as it is', () => {
  // Cross-model review rounds 2 to 5: each rule that judged a section by its surroundings deleted something the user
  // wrote or copied. Migrate now drops a head only when its fingerprint is one of the generated layouts, taken from
  // every build that wrote a retired section (by a one-off script), and leaves any other head to the merge.
  const G = require('../lib/context-reading-guidance');
  const { RETIRED_SECTIONS, GENERATED_LAYOUTS } = require('../lib/retired-guidance-sections');
  const { _managedMerge } = require('../lib/pure-utils');
  const TAG = '<!-- leerness:migration-preserved -->', nbsp = String.fromCharCode(0xA0);
  let checked = 0;
  for (const [key, files] of Object.entries(LEGACY.files)) {
    const lang = key.split('-')[0];
    for (const n of MANAGED) {
      const old = files[n], S = RETIRED_SECTIONS.filter(s => old.includes(s));
      if (!S.length) continue;
      // The real 1.36.289 file is one of the layouts: alone, with CRLF line endings and trailing spaces, and above a
      // preserved block written by the product's own merge (the "---" separator included).
      assert.ok(GENERATED_LAYOUTS.includes(G.generatedHeadFingerprint(old)), key + ' ' + n + ': not in the catalogue');
      assert.strictEqual(G.retireGeneratedGuidance(old), '', key + ' ' + n + ': the generated head stayed');
      assert.strictEqual(G.retireGeneratedGuidance(old.replace(/\n/g, ' \r\n')), '', key + ' ' + n + ': CRLF and trailing spaces');
      const withTail = _managedMerge(n, old, old.trimEnd() + '\n\nCUSTOM ' + n + '\n', '.leerness/archive', null, { lang });
      assert.strictEqual(G.retireGeneratedGuidance(withTail), withTail.slice(withTail.indexOf(TAG)), key + ' ' + n + ': the preserved tail');
      // Any other head stays whole: a line of the user's at the top, around each section and at the end; the reviewer's
      // copied heading with a copy of the section (round 5); a copy after a template line under the user's heading
      // (round 4); fenced copies, one "closed" by a no-break space (round 4); a no-break space inside the section.
      const heading = old.split('\n').find(l => /^# /.test(l)), first = old.split('\n').find(l => /^[A-Za-z@]/.test(l) && !/^#/.test(l)) || 'Follow AGENTS.md.';
      const variants = [
        old.replace('\n', '\nUser note.\n'),
        ...S.map(s => old.replace(s, 'User note.\n\n' + s)),
        ...S.map(s => old.replace(s, s + '\n\nUser note.')),
        old.trimEnd() + '\n\nUser note.\n',
        old.trimEnd() + '\n\n' + heading + '\n\n' + S[0] + '\n',
        old.trimEnd() + '\n\n# Project policy\n\n' + first + '\n\n' + S[0] + '\n\n## Additional project rules\nKeep this protocol.\n',
        old.trimEnd() + '\n\n```\n' + S[0] + '\n```\n',
        old.trimEnd() + '\n\n~~~\n~~~' + nbsp + '\n' + S[0] + '\n~~~\n',
        old.replace(S[0], S[0].replace(' ', nbsp)),
      ];
      for (const [i, v] of variants.entries()) {
        assert.notStrictEqual(v, old, key + ' ' + n + ' variant ' + i + ' did not change the file');
        assert.strictEqual(G.retireGeneratedGuidance(v), v, key + ' ' + n + ' variant ' + i + ': an edited head was dropped');
        const vTail = _managedMerge(n, v, v.trimEnd() + '\n\nCUSTOM\n', '.leerness/archive', null, { lang });
        assert.strictEqual(G.retireGeneratedGuidance(vTail), vTail, key + ' ' + n + ' variant ' + i + ' with a tail');
      }
      checked++;
    }
  }
  assert.strictEqual(checked, 12, 'every fixture file with a retired section was checked');
  // The reviewer's round-5 input on the current template: its lines are all template lines, but it is no layout.
  const next = core.coreFiles(arena, 'en', [], { mode: 'standard' })['CLAUDE.md'];
  const r5 = next.trimEnd() + '\n\n## Natural-language standing rules\n\n@AGENTS.md\n\n' + RETIRED_SECTIONS[0] + '\n';
  assert.strictEqual(G.retireGeneratedGuidance(r5), r5, 'round 5: copied heading and import line');
  // A file without the managed layout, and the current templates themselves, are no old layout either.
  for (const t of Object.values(core.coreFiles(arena, 'ko', [], { mode: 'standard' }))) assert.strictEqual(G.retireGeneratedGuidance(t), t);
});
test('the canonical legacy helpers leave a file alone when it quotes the old text in a fence', () => {
  // Review round 3 swept the sibling helpers: they replace exact old blocks and never looked at fences either.
  const G = require('../lib/context-reading-guidance');
  const run = 'Follow AGENTS.md. Always run `leerness handoff .` at the start and `leerness session close .` before ending a session.';
  const first = '**⭐ 매 세션 첫 행동**: `.leerness/session-workflow.md`의 6단계 워크플로(요청분석→계획→분배→sub-agent→종합검증→마감)를 따라야 함. drift critical 시 `leerness drift check --auto-fix`로 자동 회복.';
  const claude = '<!-- leerness:managed -->\n# Claude Code Instructions\n\n' + run + '\n\n' + first + '\n\n**완료 주장 전**: verify-claim\n';
  assert.notStrictEqual(G.retireCanonicalLegacyClaudeReading(claude), claude, 'control: the exact old CLAUDE.md block retires');
  const claudeQuoted = claude + '\n```\n' + run + '\n```\n';
  assert.strictEqual(G.retireCanonicalLegacyClaudeReading(claudeQuoted), claudeQuoted, 'CLAUDE.md with a fenced quote');
  const mdc = '<!-- leerness:managed -->\n---\nalwaysApply: true\n---\n\nFollow AGENTS.md and .leerness/context-routing.md.\nRun: `leerness handoff .` at session start.\nRun: `leerness session close .` at session end.\nPreserve Leerness protected files.\n';
  assert.notStrictEqual(G.retireCanonicalLegacyAdapterReading('.cursor/rules/leerness.mdc', mdc), mdc, 'control: the exact old Cursor block retires');
  const mdcQuoted = mdc + '\n~~~\nRun: `leerness handoff .` at session start.\n~~~\n';
  assert.strictEqual(G.retireCanonicalLegacyAdapterReading('.cursor/rules/leerness.mdc', mdcQuoted), mdcQuoted, 'Cursor rules with a fenced quote');
  // Review round 4: a closing fence may be followed by spaces and tabs only. A "closer" with a no-break space leaves the
  // fence open, so the quote after it is still quoted; a closer with spaces and a tab does close it.
  const nbsp = String.fromCharCode(0xA0), quoteLine = 'Run: `leerness handoff .` at session start.';
  for (const fence of ['```', '~~~']) {
    const open = mdc + '\n' + fence + '\nexample\n' + fence + nbsp + '\n' + quoteLine + '\n' + fence + '\n';
    assert.strictEqual(G.retireCanonicalLegacyAdapterReading('.cursor/rules/leerness.mdc', open), open, fence + ': a no-break-space closer ended the fence');
    const closed = mdc + '\n' + fence + '\nexample\n' + fence + ' \t\n\n' + quoteLine + '\n';
    assert.notStrictEqual(G.retireCanonicalLegacyAdapterReading('.cursor/rules/leerness.mdc', closed), closed, fence + ': a space-and-tab closer did not end the fence');
  }
  const lead = '## ⭐ 매 세션 첫 행동';
  const agents = '<!-- leerness:managed -->\n# Leerness Agent Instructions\n\n## Mandatory read order (session start)\n1. **.leerness/session-workflow.md** (6단계 워크플로 — 최우선)\n2. .leerness/context-routing.md\n3. .leerness/session-handoff.md\n4. .leerness/current-state.md\n5. .leerness/plan.md\n6. .leerness/progress-tracker.md\n7. .leerness/guideline.md\n8. .leerness/protected-files.md\n9. .leerness/writeback-policy.md\n10. .leerness/anti-lazy-work-policy.md\n11. **.leerness/rules.md** (사용자 정의 영구 룰 — 매 세션 반드시 따름)\n\n## Required behavior\n- keep\n';
  assert.notStrictEqual(G.retireCanonicalLegacyReading(agents), agents, 'control: the exact old AGENTS.md read order retires');
  const agentsQuoted = agents + '\n```\n' + lead + '\n2. .leerness/context-routing.md\n```\n';
  assert.strictEqual(G.retireCanonicalLegacyReading(agentsQuoted), agentsQuoted, 'AGENTS.md with a fenced quote');
});
test('a byte-order-mark instruction file upgrades too, and keeps its mark', () => {
  const key = 'en-minimal', files = LEGACY.files[key];
  const fresh = path.join(arena, (++sequence) + '-bom-fresh'), dir = path.join(arena, (++sequence) + '-bom-old');
  for (const d of [fresh, dir]) { fs.mkdirSync(d); call({ dir: d, lang: 'en' }, [...install('init'), '--language', 'en', '--mode', 'minimal']); }
  const f = { dir, lang: 'en', file: n => path.join(dir, n) };
  fs.writeFileSync(f.file('CLAUDE.md'), Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(files['CLAUDE.md'])]));
  fs.writeFileSync(f.file('.leerness/HARNESS_VERSION'), '1.36.289\n');
  call(f, install('migrate'));
  const bytes = fs.readFileSync(f.file('CLAUDE.md'));
  assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'the byte-order mark was dropped');
  assert.strictEqual(bytes.subarray(3).toString('utf8').replace(/\r\n/g, '\n').trimEnd(), text(path.join(fresh, 'CLAUDE.md')).replace(/\r\n/g, '\n').trimEnd(), 'old guidance kept in a BOM file');
});
test('legacy reading retirement preserves modified and already-preserved instructions', () => {
  const retire = require('../lib/context-reading-guidance').retireCanonicalLegacyReading;
  const first = '## ⭐ 매 세션 첫 행동\n**반드시 `.leerness/session-workflow.md`를 먼저 읽고 6단계 워크플로를 따른다**: 요청분석→계획→분배→sub-agent작업→종합검증→마감. 라운드 길이/복잡도 무관, drift 방지를 위해 모든 작업에 동일 흐름 유지.';
  const original = '<!-- leerness:managed -->\n# Leerness Agent Instructions\n\n' + first + '\n\n## 정적 vs 동적 — leerness 역할 경계\nProject-specific guidance\n\n<!-- leerness:migration-preserved -->\n' + first + '\n';
  const cleaned = retire(original);
  assert.strictEqual(cleaned.split(first).length, 2, 'custom preserved copy must remain');
  assert.ok(cleaned.includes('Project-specific guidance'));
  const modified = original.replace(first + '\n\n## 정적', first + '\n사용자가 넣은 추가 조건\n\n## 정적');
  assert.strictEqual(retire(modified), modified, 'modified managed block must remain for manual review');
  assert.strictEqual(retire(original.replace('<!-- leerness:managed -->', '<!-- other -->')), original.replace('<!-- leerness:managed -->', '<!-- other -->'));
});
test('legacy Claude session-wide instructions retire only with an exact original backup', () => {
  const dir = path.join(arena, (++sequence) + '-legacy-claude-reading');fs.mkdirSync(dir);
  const f = { dir, lang: 'ko', file: n => path.join(dir, n) };
  call(f, [...install('init'), '--language', 'ko']);
  const file = f.file('CLAUDE.md');
  const oldRun = 'Follow AGENTS.md. Always run `leerness handoff .` at the start and `leerness session close .` before ending a session.';
  const oldFirst = '**⭐ 매 세션 첫 행동**: `.leerness/session-workflow.md`의 6단계 워크플로(요청분석→계획→분배→sub-agent→종합검증→마감)를 따라야 함. drift critical 시 `leerness drift check --auto-fix`로 자동 회복.';
  const custom = 'CUSTOM-KEEP: 검수 범위는 기존 계약을 따른다.';
  const original = text(file).replace('Follow AGENTS.md. The main session owner runs', 'Follow AGENTS.md. Always run')
    .replace('**매 세션 첫 행동**:', '**⭐ 매 세션 첫 행동**:').trimEnd() + '\n\n## Project-specific instruction\n' + custom + '\n';
  assert.ok(original.includes(oldRun));assert.ok(original.includes(oldFirst));
  fs.writeFileSync(file, original);fs.writeFileSync(f.file('.leerness/HARNESS_VERSION'), '1.36.188\n');
  call(f, install('migrate'));
  const migrated = text(file);
  assert.ok(!migrated.includes(oldRun), 'old session-wide start/close instruction survived');
  assert.ok(!migrated.includes(oldFirst), 'old session-wide first-action instruction survived');
  assert.strictEqual(migrated.split(custom).length, 2);
  const archives = fs.readdirSync(f.file('.leerness/archive')).filter(n => n.startsWith('leerness-')).sort();
  assert.ok(archives.length);
  assert.strictEqual(text(f.file('.leerness/archive/' + archives[archives.length - 1] + '/files/CLAUDE.md')), original);
  call(f, install('migrate'));
  assert.strictEqual(text(file).split(custom).length, 2);
  const retire = require('../lib/context-reading-guidance').retireCanonicalLegacyClaudeReading;
  const changed = original.replace('**완료 주장 전**', '사용자 조건\n\n**완료 주장 전**');
  assert.strictEqual(retire(changed), changed, 'edited legacy instruction must remain');
});
test('legacy Cursor and Copilot owner-wide instructions do not reappear after migration', () => {
  const dir = path.join(arena, (++sequence) + '-legacy-adapter-reading');fs.mkdirSync(dir);
  const f = { dir, lang: 'ko', file: n => path.join(dir, n) };
  call(f, [...install('init'), '--language', 'ko']);
  const cursorName = '.cursor/rules/leerness.mdc', copilotName = '.github/copilot-instructions.md';
  const oldCursor = 'Run: `leerness handoff .` at session start.\nRun: `leerness session close .` at session end.';
  const oldCopilot = 'Before completion, ensure plan.md, progress-tracker.md, current-state.md, session-handoff.md are updated.';
  const custom = 'CUSTOM-KEEP: 사용자별 검수 조건';
  const originals = {
    [cursorName]: text(f.file(cursorName)).replace(/Main session owner:/g, 'Run:').trimEnd() + '\n' + custom + '\n',
    [copilotName]: text(f.file(copilotName)).replace('Before completion, the main session owner ensures', 'Before completion, ensure').trimEnd() + '\n' + custom + '\n'
  };
  assert.ok(originals[cursorName].includes(oldCursor));assert.ok(originals[copilotName].includes(oldCopilot));
  for (const [name, value] of Object.entries(originals)) fs.writeFileSync(f.file(name), value);
  fs.writeFileSync(f.file('.leerness/HARNESS_VERSION'), '1.36.188\n');
  call(f, install('migrate'));
  assert.ok(!text(f.file(cursorName)).includes(oldCursor));
  assert.ok(!text(f.file(copilotName)).includes(oldCopilot));
  for (const name of [cursorName, copilotName]) {
    assert.strictEqual(text(f.file(name)).split(custom).length, 2);
    const archives = fs.readdirSync(f.file('.leerness/archive')).filter(n => n.startsWith('leerness-')).sort();
    assert.ok(archives.length);
    assert.strictEqual(text(f.file('.leerness/archive/' + archives[archives.length - 1] + '/files/' + name)), originals[name]);
  }
  const retire = require('../lib/context-reading-guidance').retireCanonicalLegacyAdapterReading;
  assert.strictEqual(retire(cursorName, originals[cursorName].replace('Run: `leerness handoff .`', 'Run once: `leerness handoff .`')), originals[cursorName].replace('Run: `leerness handoff .`', 'Run once: `leerness handoff .`'));
  assert.strictEqual(retire(copilotName, originals[copilotName].replace('Before completion, ensure', 'Before completion, maybe')), originals[copilotName].replace('Before completion, ensure', 'Before completion, maybe'));
});
console.log(`Tests: ${passed}/${passed + failed} passed`);process.exitCode = failed ? 1 : 0;
