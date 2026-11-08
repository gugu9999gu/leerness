'use strict';
require('./temp-cleanup').trackTemp(module);  
 
 
 
 
 
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-api-skill-'));
const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
  LEERNESS_NO_AUTOCHCP: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1' };
delete env.LEERNESS_LANG;
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) { env[key] = path.join(arena, 'env-' + key.toLowerCase()); fs.mkdirSync(env[key]); }
let seq = 0, passed = 0, failed = 0;
const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
const test = (name, fn) => { if (filter && !name.includes(filter)) return; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };
const run = (dir, args, extra = {}) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', timeout: 300000, windowsHide: true, env: { ...env, ...extra } });
const must = (r, label) => { assert.ifError(r.error); assert.strictEqual(r.status, 0, label + ' exit ' + r.status + '\n' + r.stdout + r.stderr); return r.stdout; };
const json = (r, label) => { const out = String(r.stdout || ''); try { return JSON.parse(out.slice(out.indexOf('{'))); } catch (e) { throw new Error(label + ': not JSON (exit ' + r.status + ')\n' + out.slice(0, 800) + r.stderr); } };
const project = (lang, task, next) => {
  const dir = path.join(arena, (++seq) + '-' + lang); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"proj","version":"0.1.0"}\n');
  must(run(dir, ['init', dir, '--yes', '--language', lang, '--no-setup-agents', '--no-mcp']), 'init');
  must(run(dir, ['task', 'add', task, '--status', 'in-progress', ...(next ? ['--next', next] : []), '--path', dir]), 'task add');
  return dir;
};
const skill = (dir, id, name, direction, url, body) => {
  const d = path.join(dir, '.leerness', 'api-skills'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, id + '.md'), `---\nid: ${id}\nname: ${name}\ndirection: "${direction}"\ncaptured_at: 2026-09-30\nurls:\n  - ${url}\n---\n${body}\n`);
};
 
const stripe = dir => skill(dir, 'stripe-webhooks', 'Stripe webhooks', 'verify stripe payment webhook signatures',
  'https://stripe.com/docs/webhooks', 'The Stripe API sends signed events to the endpoint and the client verifies them with the API.');
const slack = dir => skill(dir, 'slack-chat', 'Slack chat', 'post chat messages to a channel',
  'https://api.slack.com/methods/chat.postMessage', 'The API posts a message and the client reads the response from the API.');
const surfaces = dir => ({
  handoff: must(run(dir, ['handoff', dir, '--no-record', '--inspect', '--no-drift-check']), 'handoff --inspect'),
  handoffJson: json(run(dir, ['handoff', dir, '--no-record', '--inspect', '--json']), 'handoff --inspect --json').apiSkills,
  health: json(run(dir, ['health', dir, '--json']), 'health --json').apiSkills,
  close: json(run(dir, ['session', 'close', dir, '--json']), 'session close --json').apiSkills,
});

test('API skill terminal fields reject control characters without changing stored or JSON text', () => {
  const dir = project('en', 'Integrate the Stripe payment webhook');
  const id = 'stripe\u001b[2J-webhooks', name = 'Stripe\u0007 webhooks\u0085 한글 e\u0301';
  const direction = 'verify stripe\u001b[2J signatures', url = 'https://stripe.com/\u0007webhooks';
  const stored = path.join(dir, '.leerness', 'api-skills', 'stripe-webhooks.md');
  skill(dir, 'stripe-webhooks', name, direction, url, 'Stripe webhook signature.');
  fs.writeFileSync(stored, fs.readFileSync(stored, 'utf8').replace('id: stripe-webhooks', 'id: ' + id));
  const before = fs.readFileSync(stored);
  const controls = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/;
  for (const args of [
    ['api-skill', 'list', '--path', dir],
    ['api-skill', 'match', 'stripe\u001b[2J', '--path', dir],
    ['handoff', dir, '--no-record', '--inspect', '--no-drift-check'],
  ]) {
    const result = must(run(dir, args), args.slice(0, 2).join(' '));
    assert.ok(result.includes('Stripe'), 'the relevant skill was not displayed');
    assert.ok(!controls.test(result), 'raw terminal controls in ' + args.slice(0, 2).join(' '));
    assert.ok(result.includes('한글 e\u0301'), 'valid Unicode was lost');
  }
  const listed = json(run(dir, ['api-skill', 'list', '--path', dir, '--json']), 'raw list').skills[0];
  assert.strictEqual(listed.name, name);
  assert.strictEqual(listed.id, id);
  assert.strictEqual(listed.urls[0], url);
  const matched = json(run(dir, ['api-skill', 'match', 'stripe', '--path', dir, '--json']), 'raw match').matches[0];
  assert.strictEqual(matched.name, name);
  assert.strictEqual(matched.id, id);
  assert.ok(fs.readFileSync(stored).equals(before), 'display sanitization changed the source');
});

test('API skill malformed filename fallback is safe on terminal output', () => {
  const dir = project('en', 'Read docs');
  const folder = path.join(dir, '.leerness', 'api-skills');fs.mkdirSync(folder, { recursive: true });
  const id = 'fallback\u0085-name';
  fs.writeFileSync(path.join(folder, id + '.md'), 'No frontmatter.\n');
  const shown = must(run(dir, ['api-skill', 'list', '--path', dir]), 'fallback');
  assert.ok(shown.includes('fallback'));
  assert.ok(!shown.includes('\u0085'));
  assert.strictEqual(json(run(dir, ['api-skill', 'list', '--path', dir, '--json']), 'fallback JSON').skills[0].id, id);
});

test('handoff --inspect, handoff --inspect --json, health --json and session close --json match the in-progress task; a default read leaves API skills out', () => {
  const dir = project('en', 'Integrate the Stripe payment webhook');
  stripe(dir); slack(dir);
  const s = surfaces(dir);
  assert.match(s.handoff, /## 1 related API skill\(s\) found \(UR-0015\)/, s.handoff);
  assert.match(s.handoff, /stripe-webhooks — Stripe webhooks/);
  assert.ok(!/slack-chat/.test(s.handoff), 'unrelated skill listed');
  for (const name of ['handoffJson', 'health', 'close']) {
    assert.strictEqual(s[name].total, 2, name);
    assert.strictEqual(s[name].matched, 1, name + ' ' + JSON.stringify(s[name]));
    assert.deepStrictEqual(s[name].matchedIds, ['stripe-webhooks'], name);
  }
  const plain = json(run(dir, ['handoff', dir, '--no-record', '--json']), 'default handoff --json');
  assert.strictEqual(plain.inspection.status, 'not_inspected');
  assert.strictEqual(plain.apiSkills, undefined, 'a default read reported API skills');
  assert.ok(!must(run(dir, ['handoff', dir, '--no-record']), 'default handoff').includes('stripe-webhooks'), 'a default read listed API skills');
   
  const next = project('en', 'Build the checkout flow', 'verify the stripe webhook signature');
  stripe(next); slack(next);
  assert.deepStrictEqual(json(run(next, ['handoff', next, '--no-record', '--inspect', '--json']), 'next action').apiSkills.matchedIds, ['stripe-webhooks']);
});

test('common words, URL parts and the placeholder next action do not make every saved skill match', () => {
   
  const dir = project('en', 'Fix the login page layout for the https site');
  stripe(dir); slack(dir);
  skill(dir, 'notes', 'Notes', 'store notes', 'https://example.com/notes', 'Write notes to the server.');
  const s = surfaces(dir);
  assert.match(s.handoff, /3 API skill\(s\) saved \(none match the current task/, s.handoff);
  for (const name of ['handoffJson', 'health', 'close']) assert.strictEqual(s[name].matched, 0, name + ' ' + JSON.stringify(s[name]));
});

test('Korean task text matches a skill without its trailing particles', () => {
   
  const dir = project('ko', '결제를 웹훅으로 붙인다');
  skill(dir, 'pay-hook', '결제 웹훅', '결제 웹훅 연동', 'https://example.com/pay', '결제가 끝나면 웹훅을 보낸다.');
  skill(dir, 'chat', '채팅', '채팅 메시지 전송', 'https://example.com/chat', '메시지를 보낸다.');
  const s = surfaces(dir);
  assert.match(s.handoff, /## 관련 API skill 1건 발견/, s.handoff);
  assert.deepStrictEqual(s.handoffJson.matchedIds, ['pay-hook']);
  const other = project('ko', '로그인 화면 정리');
  skill(other, 'pay-hook', '결제 웹훅', '결제 웹훅 연동', 'https://example.com/pay', '결제가 끝나면 웹훅을 보낸다.');
  assert.strictEqual(json(run(other, ['handoff', other, '--no-record', '--inspect', '--json']), 'ko other').apiSkills.matched, 0);
});

test('an explicit api-skill match query keeps working, including one made only of common words', () => {
  const dir = project('en', 'Write docs');
  stripe(dir); slack(dir);
  const ids = query => json(run(dir, ['api-skill', 'match', query, '--path', dir, '--json']), 'match ' + query).matches.map(m => m.id).sort();
  assert.deepStrictEqual(ids('stripe'), ['stripe-webhooks']);
  assert.deepStrictEqual(ids('slack messages'), ['slack-chat']);
   
  assert.deepStrictEqual(ids('api'), ['slack-chat', 'stripe-webhooks']);
});

test('audit warns about an API task without a relevant saved skill', () => {
  const dir = project('en', 'Add the Stripe API webhook endpoint');
  slack(dir);
  const kinds = () => json(run(dir, ['audit', dir, '--json']), 'audit --json').findings.map(f => f.kind);
  assert.ok(kinds().includes('api_skill_missing'), 'common words matched the unrelated skill and hid the warning');
  stripe(dir);
  assert.ok(!kinds().includes('api_skill_missing'), 'relevant skill not matched');
});

test('documentation words and URL paths neither match unrelated skills nor hide the audit warning', () => {
   
  const dir = project('en', 'Read GitHub API docs');
  stripe(dir); slack(dir);
  const hj = () => json(run(dir, ['handoff', dir, '--no-record', '--inspect', '--json']), 'handoff --inspect --json').apiSkills;
  assert.strictEqual(hj().matched, 0, JSON.stringify(hj()));
  assert.deepStrictEqual(json(run(dir, ['api-skill', 'match', 'Read GitHub API docs', '--path', dir, '--json']), 'match').matches, []);
  assert.ok(json(run(dir, ['audit', dir, '--json']), 'audit').findings.some(f => f.kind === 'api_skill_missing'), 'unrelated skills hid the warning');
  skill(dir, 'github-rest', 'GitHub REST', 'call the github rest endpoints', 'https://docs.github.com/en/rest', 'GitHub REST reference.');
  assert.deepStrictEqual(hj().matchedIds, ['github-rest']);
});

test('Korean documentation words, URL paths in a body and one shared body word do not match; two body words do', () => {
   
  // (https://stripe.com/methods) matched "methods". A task needs the skill's name, direction or host, or two body words.
  const ko = project('ko', 'GitHub API 문서 읽기');
  skill(ko, 'stripe-ko', 'Stripe 결제', '결제 웹훅 검증', 'https://stripe.com/docs', 'Stripe API 문서에 따라 서명을 검증한다.');
  skill(ko, 'slack-ko', 'Slack 채팅', '채널 메시지 전송', 'https://api.slack.com', 'Slack API 문서의 예제를 따른다.');
  assert.strictEqual(json(run(ko, ['handoff', ko, '--no-record', '--inspect', '--json']), 'ko handoff').apiSkills.matched, 0);
  assert.ok(json(run(ko, ['audit', ko, '--json']), 'ko audit').findings.some(f => f.kind === 'api_skill_missing'), 'Korean documentation words hid the warning');
  const en = project('en', 'Read GitHub API methods');
  skill(en, 'stripe-body-url', 'Stripe charges', 'create charges', 'https://stripe.com/docs', 'See https://stripe.com/methods for every call.');
  assert.strictEqual(json(run(en, ['handoff', en, '--no-record', '--inspect', '--json']), 'en handoff').apiSkills.matched, 0);
  const two = project('en', 'Handle invoice retries for billing');
  skill(two, 'payments', 'Payments', 'take card payments', 'https://example.com/pay', 'Each invoice can fail; billing retries it later.');
  skill(two, 'one-word', 'Mailer', 'send mail', 'https://example.com/mail', 'Billing mail goes out nightly.');
  assert.deepStrictEqual(json(run(two, ['handoff', two, '--no-record', '--inspect', '--json']), 'two-word handoff').apiSkills.matchedIds, ['payments']);
});

test('an uncertain skill match is reported without a warning, so a strict audit does not fail on it', () => {
   
   
  const dir = project('en', 'Integrate OAuth API');
  const base = json(run(dir, ['audit', dir, '--json']), 'audit without a skill');
  assert.ok(base.findings.some(f => f.kind === 'api_skill_missing'), 'control: no warning without any skill');
   
  const strict = label => { const r = run(dir, ['audit', dir, '--json', '--strict', '--threshold', String(base.warnings)]); return { r, a: json(r, label) }; };
  const before = strict('strict audit without a skill');
  assert.notStrictEqual(before.r.status, 0, 'control: strict audit passed with the API warning');
  skill(dir, 'auth', 'Authentication', 'login', 'https://auth0.com', 'OAuth 2 authorization');
  const { r, a } = strict('strict audit with the skill');
  assert.ok(!a.findings.some(f => f.kind === 'api_skill_missing'), 'the uncertain match became a warning: ' + JSON.stringify(a.findings));
  const weak = a.findings.find(f => f.kind === 'api_skill_weak_match');
  assert.ok(weak && weak.severity === 'info' && weak.weakMatchIds.includes('auth'), JSON.stringify(a.findings));
  assert.strictEqual(a.warnings, base.warnings - 1, 'only the API warning went away');
  assert.strictEqual(r.status, 0, 'strict audit failed on an uncertain match\n' + r.stdout + r.stderr);
   
  assert.strictEqual(json(run(dir, ['handoff', dir, '--no-record', '--inspect', '--json']), 'handoff').apiSkills.matched, 0);
});

test('a word repeated in the task counts once toward the two body words', () => {
   
  const dir = project('en', 'Read GitHub API methods methods');
  skill(dir, 'stripe-methods', 'Stripe charges', 'create charges', 'https://stripe.com', 'Every call lists its methods.');
  assert.strictEqual(json(run(dir, ['handoff', dir, '--no-record', '--inspect', '--json']), 'handoff --inspect --json').apiSkills.matched, 0);
});

test('the audit leaves out the placeholder next action', () => {
   
  const kinds = dir => json(run(dir, ['audit', dir, '--json']), 'audit --json').findings.map(f => f.kind);
  const en = project('en', 'Add the Stripe API webhook endpoint');
  skill(en, 'notes', 'Notes', 'store notes', 'https://example.com/notes', 'Write notes to the server.');
  assert.ok(kinds(en).includes('api_skill_missing'), 'the placeholder matched an unrelated skill (en)');
  const ko = project('ko', '결제 API 웹훅 연동');
  skill(ko, 'chat', '채팅', '채팅 메시지 전송', 'https://example.com/chat', '다음 단계에서 메시지를 작성해 보낸다.');
  assert.ok(kinds(ko).includes('api_skill_missing'), 'the placeholder matched an unrelated skill (ko)');
});

test('lazy detection flags a blocked task whose next action is a placeholder, and only then', () => {
   
  const dir = project('en', 'Ship the release');
  const flagged = () => json(run(dir, ['lazy', 'detect', dir, '--json']), 'lazy detect').findings.some(f => f.kind === 'blocker_no_next_action');
  const added = must(run(dir, ['task', 'add', 'Waiting for the vendor key', '--status', 'blocked', '--next', 'n/a', '--path', dir]), 'blocked task');
  const id = (added.match(/T-\d{4}/) || [])[0];
  assert.ok(id, added);
  assert.ok(flagged(), 'placeholder next action not flagged');
  must(run(dir, ['task', 'update', id, '--next', 'ask the vendor for a test key', '--path', dir]), 'real next action');
  assert.ok(!flagged(), 'real next action flagged');
  const { _isTrivialNextAction: trivial } = require('../lib/pure-utils');
  for (const v of ['', '  ', '없음', '-', '---', 'n/a', 'NA', 'none', 'TBD', 'todo', '...', '?', 'write the next action', '다음 액션 작성']) assert.ok(trivial(v), JSON.stringify(v));
  for (const v of ['verify the webhook', 'na-na rollout', 'ask the vendor']) assert.ok(!trivial(v), JSON.stringify(v));
   
  for (const v of ['Implement the UI to write the next action for Stripe payments', '다음 액션 작성 화면에 결제 연동']) assert.ok(!trivial(v), JSON.stringify(v));
  const { _taskMatchText } = require('../lib/pure-utils');
  assert.strictEqual(_taskMatchText({ request: 'Fix the editor', nextAction: 'Implement the UI to write the next action for Stripe payments' }),
    'Fix the editor Implement the UI to write the next action for Stripe payments');
});

console.log(`Tests: ${passed}/${passed + failed} passed`);
try { removeTree(arena, { recursive: true, force: true }); } catch {}
process.exitCode = failed ? 1 : 0;
