'use strict';
// T-0321: free text given to a command is exactly the positional text the user typed.
// Reported: `clarify "<request>" --path <dir>` appends <dir> to the request. That did not reproduce —
// main() builds args with nonFlagArgs(), which already drops registered value flags and their values; the
// first group pins it, with an in-probe control showing that a leaked form would be detected.
// What was broken is the opposite direction: a request that begins with "-" (a markdown bullet, "-5%")
// could not reach any free-text command. Before "--" such a token is an option; after "--" it is text, but
// dispatch sites re-filtered nonFlagArgs() with startsWith('-') and dropped it, the flag guards scanned past
// "--" and rejected "--"-leading text, and the 7 MCP free-text tools put the text before "--", so the child
// parsed a bullet list as an option and answered text_required.
// Cross-model review (gpt-6.1-sol) found, and this probe now covers: bugfix/referee parsers that treated
// tokens after "--" as options, so `drop <id> -- --path B` wrote to the cwd project once the guards stopped at
// "--"; agent, agents route and release note dropping text after "--"; release note keeping the value of any
// value flag but --path; and a literal "--json" after "--" sending success output to stderr.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-free-text-'));
const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
  LEERNESS_NO_AUTOCHCP: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_SKILL_HISTORY: '1' };
for (const key of ['LEERNESS_LANG', 'LEERNESS_OLLAMA_BASE_URL', 'LEERNESS_ENFORCE_POLICY']) delete env[key];
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) { env[key] = path.join(arena, 'env-' + key.toLowerCase()); fs.mkdirSync(env[key]); }
let passed = 0, failed = 0;
const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
const test = (name, fn) => { if (filter && !name.includes(filter)) return; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };
// Checks every site before failing, so one run names all the sites that lose the text.
const each = (items, fn) => {
  const misses = [];
  for (const item of items) { try { fn(item); } catch (e) { misses.push(String(e && e.message || e).split('\n')[0]); } }
  if (misses.length) throw new Error(`${misses.length}/${items.length} failed:\n  ${misses.join('\n  ')}`);
};

const project = name => {
  const dir = path.join(arena, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"proj","version":"0.1.0"}\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'init', dir, '--yes', '--language', 'ko', '--no-mcp'], { cwd: dir, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
  assert.strictEqual(r.status, 0, 'init ' + name + ' exit ' + r.status + '\n' + r.stdout + r.stderr);
  return dir;
};
const P = project('proj');
const runIn = (cwd, args, extra = {}) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 300000, windowsHide: true, env: { ...env, ...extra } });
const run = (args, extra) => runIn(P, args, extra);
const show = r => `exit ${r.status}\n${String(r.stdout || '').slice(0, 800)}${String(r.stderr || '').slice(0, 400)}`;
const json = (r, label) => { const out = String(r.stdout || ''); try { return JSON.parse(out.slice(out.indexOf('{'))); } catch { throw new Error(label + ': not JSON — ' + show(r)); } };
const ORCH_ENV = { LEERNESS_OLLAMA_BASE_URL: 'http://127.0.0.1:9' };   // nothing listens there: the model call fails at once

// Every CLI site whose command takes free text, and where the text it received can be read back.
const queueTitles = () => json(run(['next-action', 'list', '--path', P, '--json']), 'next-action list').queue.map(a => a.title);
const lastRoute = () => { const e = json(run(['agents', 'route', '--log', '--path', P, '--json']), 'route log').entries; return e.length ? e[e.length - 1].task : undefined; };
const changelogNotes = () => { try { return fs.readFileSync(path.join(P, 'CHANGELOG.md'), 'utf8').split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2)); } catch { return []; } };
const lineAfter = (prefix, out) => { const l = String(out || '').split(/\r?\n/).find(x => x.startsWith(prefix)); return l === undefined ? undefined : l.slice(prefix.length); };
const SITES = [
  { site: 'brainstorm', cmd: ['brainstorm'], field: 'topic' },
  { site: 'review-request', cmd: ['review-request'], field: 'request' },
  { site: 'intent classify', cmd: ['intent', 'classify'], field: 'text' },
  { site: 'intent expand', cmd: ['intent', 'expand'], field: 'text' },
  { site: 'constraints check', cmd: ['constraints', 'check'], field: 'query' },
  { site: 'skill match', cmd: ['skill', 'match'], field: 'query' },
  { site: 'skill search', cmd: ['skill', 'search'], field: 'query' },
  { site: 'reuse find', cmd: ['reuse', 'find'], field: 'query' },
  { site: 'reuse-check', cmd: ['reuse-check'], field: 'feature' },
  { site: 'register-pending', cmd: ['register-pending'], field: 'request' },
  // These print no JSON with the text; what they received is read back from where they put it.
  { site: 'next-action add', cmd: ['next-action', 'add'], json: false, read: () => queueTitles(), stored: true },
  { site: 'agents route', cmd: ['agents', 'route'], read: () => lastRoute() },
  { site: 'release note', cmd: ['release', 'note'], json: false, read: () => changelogNotes(), stored: true },
  { site: 'agent', cmd: ['agent'], flags: ['--dry-run'], json: false, read: r => lineAfter('task: ', r.stdout) },
  { site: 'orchestrate', cmd: ['orchestrate'], flags: ['--agents', '1', '--timeout', '5000'], json: false, env: ORCH_ENV, read: r => lineAfter('목표: ', r.stdout) },
];
const argvFor = (s, before, after) => [...s.cmd, ...before, ...(s.flags || []), ...(s.json === false ? [] : ['--json']), ...after];
const expectReceived = (s, r, text, label) => {
  const got = s.read ? s.read(r) : json(r, label)[s.field];
  if (s.stored) { assert.ok(got.includes(text), `${label}: ${JSON.stringify(text)} not stored (exit ${r.status}); stored: ${JSON.stringify(got.slice(-3))}`); return; }
  assert.strictEqual(got, text, `${label}: received ${JSON.stringify(got)} instead of ${JSON.stringify(text)} — ${show(r)}`);
};
const runSite = (s, argv) => run(argv, s.env);
// clarify echoes no text: its signal kinds are the only view of what it received (a same-signal corruption is invisible).
const clarify = (r, label) => { const j = json(r, label); assert.strictEqual(j.ok, true, `${label}: ${j.code || 'not ok'} (exit ${r.status})`); return j.signals.map(x => x.kind).sort().join(','); };
let seq = 0;
const unique = text => `${text} [${++seq}]`;   // stored entries stay distinct across calls

test('registered value flags never reach the free text (16 CLI sites)', () => {
  // Control: the leaked form itself is visible to clarify, so the clarify checks below can fail.
  assert.strictEqual(clarify(run(['clarify', 'A 또는 ' + P, '--json']), 'control'), 'alternative');
  for (const argv of [['clarify', 'A 또는', '--path', P, '--language', 'en', '--json'], ['clarify', '--path=' + P, '--json', 'A 또는'], ['clarify', 'A 또는', '-y', '--json']]) {
    assert.strictEqual(clarify(run(argv), argv.join(' ')), '', argv.join(' '));
  }
  each(SITES, s => {
    const a = unique('결제 plain request'), b = unique('결제 plain request');
    expectReceived(s, runSite(s, argvFor(s, [a, '--path', P, '--language', 'en'], [])), a, s.site + ' value after text');
    expectReceived(s, runSite(s, argvFor(s, ['--path=' + P], [b])), b, s.site + ' equals form before text');
  });
});

test('text after -- reaches every CLI free-text site verbatim, even when it starts with - or --', () => {
  const cases = [];
  for (const s of SITES) {
    cases.push({ s, label: '"-" text', text: unique('- 로그인 버튼 적당히 고쳐줘') });
    cases.push({ s, label: '"--" text', text: unique('--force 옵션 추가해줘') });
    // Tokens after -- are text even when they spell a flag: no missing --path value, no second --json.
    const first = unique('- 첫째');
    cases.push({ s, label: 'flag-shaped tokens', text: first, tokens: [first, '--path', '--json'], expected: first + ' --path --json' });
  }
  const clarifyCases = [
    { label: 'clarify "-" text', tokens: ['- 그거 적당히 고쳐줘'], kinds: 'pronoun,vague-quality' },
    { label: 'clarify "--" text', tokens: ['--force 로 그거 고쳐줘'], kinds: 'pronoun' },
    { label: 'clarify flag-shaped tokens', tokens: ['- 그거', '--path', '--json'], kinds: 'pronoun' },
    // Without a real --path before --, these reach the --path value check and the init-only --authoring-language check.
    { label: 'clarify "--path=" text', argv: ['clarify', '--json', '--', '--path=그거 고쳐줘'], kinds: 'pronoun' },
    { label: 'clarify "--authoring-language=" text', argv: ['clarify', '--json', '--', '--authoring-language=en 그거'], kinds: 'pronoun' },
  ];
  each([...cases, ...clarifyCases], c => {
    if (c.kinds) {
      assert.strictEqual(clarify(run(c.argv || ['clarify', '--path', P, '--json', '--', ...c.tokens]), c.label), c.kinds, c.label);
    } else {
      expectReceived(c.s, runSite(c.s, argvFor(c.s, ['--path', P], ['--', ...(c.tokens || [c.text])])), c.expected || c.text, `${c.s.site} ${c.label}`);
    }
  });
});

test('options before -- are still validated, and a value flag cannot take its value from across --', () => {
  const unknown = run(['clarify', '--definitely-unknown', '--json', '--', 'x']);
  assert.ok(unknown.status === 1 && json(unknown, 'unknown').code === 'unknown_flag', show(unknown));
  const strict = run(['intent', 'expand', '--no-save', '--json', '--', 'x']);
  assert.ok(strict.status === 1 && json(strict, 'strict').code === 'unknown_flag', show(strict));
  const across = run(['clarify', 'x', '--json', '--path', '--', 'y']);
  assert.ok(across.status === 1 && json(across, 'across').ok === false, show(across));
  const typed = run(['clarify', 'x', '--language', 'xx', '--json', '--', 'y']);
  assert.ok(typed.status === 1 && json(typed, 'invalid value').ok === false, show(typed));
});

test('tokens after -- never retarget or get dropped by a write, and a literal --json after -- is text', () => {
  const A = project('writes-a'), B = project('writes-b');
  assert.strictEqual(runIn(A, ['task', 'add', 'probe target', '--path', A]).status, 0, 'task add');
  const start = runIn(A, ['bugfix', 'start', 'T-0001', '--repro', 'node -e "console.log(\'BADSIG\');process.exit(1)"', '--expect-bad', 'BADSIG', '--json']);
  assert.strictEqual(json(start, 'bugfix start').ok, true, 'bugfix start ' + show(start));
  const add = runIn(A, ['referee', 'add', 'r1', '--check', 'node -e 0', '--good', 'node -e 0', '--bad', 'node -e 1', '--expect-bad', 'x', '--json']);
  assert.strictEqual(json(add, 'referee add').ok, true, 'referee add ' + show(add));
  const ids = file => { try { const v = JSON.parse(fs.readFileSync(path.join(A, '.leerness', file), 'utf8')); return (Array.isArray(v) ? v : []).map(x => x.id); } catch { return []; } };
  const bf = runIn(A, ['bugfix', 'drop', 'T-0001', '--json', '--', '--path', B]);
  assert.ok(bf.status === 1 && ids('bugfix-receipts.json').includes('T-0001'), 'bugfix drop -- --path B changed ' + A + ': ' + show(bf));
  const rf = runIn(A, ['referee', 'drop', 'r1', '--json', '--', '--path', B]);
  assert.ok(rf.status === 1 && json(rf, 'referee drop').code === 'too_many_arguments' && ids('referees.json').includes('r1'), 'referee drop -- --path B: ' + show(rf));
  // Controls: the same drops without the stray tokens succeed, so the refusals above were not a broken setup.
  assert.ok(runIn(A, ['bugfix', 'drop', 'T-0001', '--json']).status === 0 && !ids('bugfix-receipts.json').includes('T-0001'), 'bugfix drop control');
  assert.ok(runIn(A, ['referee', 'drop', 'r1', '--json']).status === 0 && !ids('referees.json').includes('r1'), 'referee drop control');
  // `-- --json` is a title, not a switch to JSON mode: the confirmation stays on stdout (lib/io.js),
  const na = run(['next-action', 'add', '--path', P, '--', '--json']);
  assert.ok(na.status === 0 && /next-action/.test(na.stdout) && !/next-action/.test(na.stderr) && queueTitles().includes('--json'), 'next-action add -- --json: ' + show(na));
  // and an error raised through main's catch handler stays human-readable too.
  const dry = run(['release', 'note', '--dry-run', '--path', P, '--', '--json']);
  assert.ok(dry.status === 1 && !String(dry.stdout).trimStart().startsWith('{') && /--dry-run/.test(dry.stdout), 'release note --dry-run -- --json: ' + show(dry));
});

test('MCP free-text tools deliver the text of any shape and keep their flags before -- (7 tools)', () => {
  const bullet = '- 그거 적당히 고쳐줘\n- 나중에 테스트', ddash = '--force 옵션 추가해줘';
  const TOOLS = [
    { tool: 'leerness_clarify', arg: 'text' },
    { tool: 'leerness_brainstorm', arg: 'topic', field: 'topic' },
    { tool: 'leerness_skill_match', arg: 'query', field: 'query' },
    { tool: 'leerness_skill_search', arg: 'capability', field: 'query' },
    { tool: 'leerness_review_request', arg: 'request', field: 'request' },
    { tool: 'leerness_constraints_check', arg: 'request', field: 'query' },
    { tool: 'leerness_intent_classify', arg: 'request', field: 'text' },
  ];
  const calls = [];
  for (const t of TOOLS) for (const text of [bullet, ddash]) calls.push({ t, text, args: { [t.arg]: text, path: P } });
  calls.push({ t: TOOLS[0], text: 'A 또는', args: { text: 'A 또는', path: P }, leak: true });
  calls.push({ t: TOOLS[1], text: bullet, args: { topic: bullet, path: P, allApps: true }, allApps: true });
  calls.push({ t: TOOLS[2], text: bullet, args: { query: bullet, path: P, useEmbedding: true }, embedding: true });
  const input = calls.map((c, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name: c.t.tool, arguments: c.args } })).join('\n') + '\n';
  const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: P, encoding: 'utf8', timeout: 600000, windowsHide: true, input, env, maxBuffer: 32 << 20 });
  const replies = new Map();
  for (const line of String(r.stdout || '').split('\n')) { try { const j = JSON.parse(line); if (j.id != null) replies.set(j.id, j); } catch {} }
  each(calls.map((c, i) => ({ ...c, id: i + 1 })), c => {
    const label = `${c.t.tool} ${JSON.stringify(c.text).slice(0, 30)}${c.allApps ? ' allApps' : ''}${c.embedding ? ' useEmbedding' : ''}`;
    const reply = replies.get(c.id);
    assert.ok(reply && reply.result, label + ': no result ' + JSON.stringify(reply || r.stderr).slice(0, 300));
    const text = reply.result.content[0].text;
    const oneLine = text.replace(/\s+/g, ' ').slice(0, 240);
    if (c.embedding) {   // --embedding stayed an option: without an Ollama URL the command refuses instead of matching the text
      assert.ok(reply.result.isError === true && /LEERNESS_OLLAMA_BASE_URL/.test(text), `${label}: --embedding was not applied — ${oneLine}`);
      return;
    }
    assert.strictEqual(reply.result.isError, false, `${label}: isError — ${oneLine}`);
    const inner = JSON.parse(text.slice(text.indexOf('{')));
    if (c.t.field) assert.strictEqual(inner[c.t.field], c.text, `${label}: received ${JSON.stringify(inner[c.t.field])}`);
    else {
      const kinds = inner.signals.map(x => x.kind).sort().join(',');
      assert.strictEqual(kinds, c.leak ? '' : c.text === bullet ? 'pronoun,undefined-later,vague-quality' : '', `${label}: signals ${kinds}`);
    }
    if (c.allApps) assert.ok(Array.isArray(inner.projects), `${label}: --all-apps was not applied — ${oneLine}`);
  });
});

test('no dispatch site re-filters positional tokens with startsWith("-") (source ratchet for new commands)', () => {
  // The behavior checks above cover the known sites; this catches a new command copying the old idiom,
  // including the startsWith('--') variant and a block-bodied callback. Comment lines are not code.
  const pkg = path.resolve(__dirname, '..');
  const files = ['bin/leerness.js', ...fs.readdirSync(path.join(pkg, 'lib')).filter(f => f.endsWith('.js')).map(f => 'lib/' + f)];
  const re = /\.filter\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*(?:\{\s*return\s+)?!\s*\1\.startsWith\(\s*(['"])--?\2\s*\)/g;
  const hits = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(pkg, rel), 'utf8');
    for (const m of src.matchAll(re)) {
      const lineStart = src.lastIndexOf('\n', m.index) + 1;
      if (/\/\/|^\s*\*/.test(src.slice(lineStart, m.index))) continue;
      hits.push(`${rel}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepStrictEqual(hits, [], 'nonFlagArgs() output is already free of options before --; re-filtering it drops text after --: ' + hits.join(', '));
  // The pattern itself: it must see each spelling of the idiom and skip it in a comment.
  const sample = "a.filter(x => !x.startsWith('-'))\nb.filter((t) => { return !t.startsWith(\"--\"); })\n// c.filter(x => !x.startsWith('-'))\n";
  assert.strictEqual([...sample.matchAll(re)].filter(m => !/\/\//.test(sample.slice(sample.lastIndexOf('\n', m.index) + 1, m.index))).length, 2, 'ratchet pattern self-check');
});

console.log(`Tests: ${passed}/${passed + failed} passed`);
try { removeTree(arena, { recursive: true, force: true }); } catch {}
process.exitCode = failed ? 1 : 0;
