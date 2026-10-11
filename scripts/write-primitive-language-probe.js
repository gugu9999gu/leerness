'use strict';
// T-0338: the write primitives' fixed-language texts follow the project language. In lib/io.js the dry-run guard,
// the compare-and-set refusal (E_CONCURRENT_MODIFICATION) with its recovery backup and recovery artifact suffixes, the
// link and file type refusals, the two Windows replacement failures and the damaged-JSON notice were Korean in every
// project; the three hard-link detach failures were English in every project. The CLI's own dry-run refusal
// (dry_run_unsupported) and lib/git.js's git dry-run text were Korean in every project. The modules ask
// lib/error-language.js, where the CLI registers the language of its own text; the CLI's refusal uses the rule of its
// shared errors (_errorUiLang, so `mode --json` keeps its Korean canonical text). Codes are unchanged, every existing
// text stays byte for byte in the language that had it, and with no language registered nothing changes. Not changed
// (owner's scope): the platform refusal and publication buffer limit that no current caller reaches, and the two cleanup
// fallbacks that cannot be reached; the source check below pins them. Module texts are checked whole, in every
// language state, by direct calls in a child process with faults injected there (the Windows replacement cases only
// on Windows, where io.js uses it); the command tests run the CLI on copies of initialized seeds in folders with Hangul
// in their names, from the arena.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
const CLI = path.resolve(__dirname, '../bin/leerness.js'), LIB = path.resolve(__dirname, '../lib');
const WIN = process.platform === 'win32';

// [code, English, Korean] for each text; the language that had it before is noted by `was`.
const TEXT = {
  dryRun: { code: 'E_DRY_RUN_WRITE', was: 'ko', en: f => `--dry-run was given, but a write was attempted: ${f}`, ko: f => `--dry-run 인데 쓰려고 했습니다: ${f}` },
  gitDryRun: { code: 'E_DRY_RUN_WRITE', was: 'ko', en: v => `--dry-run was given, but git ${v} was about to run`, ko: v => `--dry-run 인데 git ${v} 를 실행하려 했습니다` },
  concurrent: { code: 'E_CONCURRENT_MODIFICATION', was: 'ko', en: f => `The file changed after it was checked, so it was not overwritten: ${f}`,
    ko: f => `검사 후 파일이 변경되어 덮어쓰기를 거부했습니다: ${f}` },
  backup: { was: 'ko', en: b => ` (recovery backup: ${b})`, ko: b => ` (복구 백업: ${b})` },
  artifacts: { was: 'ko', en: d => ` (recovery artifacts: ${d})`, ko: d => ` (복구 아티팩트: ${d})` },
  unsafeLink: { code: 'E_UNSAFE_LINK', was: 'ko', en: f => `A symbolic link is not replaced automatically: ${f}`, ko: f => `심볼릭 링크 대상은 자동 교체하지 않습니다: ${f}` },
  unsafeFileType: { code: 'E_UNSAFE_FILE_TYPE', was: 'ko', en: f => `Only a regular file can be replaced automatically: ${f}`, ko: f => `일반 파일만 자동 교체할 수 있습니다: ${f}` },
  atomicReplace: { code: 'E_ATOMIC_REPLACE', was: 'ko', en: d => `Windows metadata-preserving replacement failed: ${d}`, ko: d => `Windows 메타데이터 보존 교체 실패: ${d}` },
  replaceUncertain: { code: 'E_ATOMIC_REPLACE_UNCERTAIN', was: 'ko', en: t => `Windows reported the replacement as successful, but the replacement source is still there: ${t}`,
    ko: t => `Windows 교체가 성공을 보고했지만 replacement source가 남았습니다: ${t}` },
  detachFailed: { code: 'E_HARDLINK_DETACH_FAILED', was: 'en', en: a => `committed hard-link alias could not be detached: ${a}`, ko: a => `저장한 파일의 임시 하드 링크를 떼어내지 못했습니다: ${a}` },
  detachGone: { code: 'E_HARDLINK_DETACH_FAILED', was: 'en', en: l => `committed file disappeared while detaching its prepared alias: ${l}`,
    ko: l => `준비한 하드 링크를 떼어내는 동안 저장한 파일이 사라졌습니다: ${l}` },
  detachInvalid: { code: 'E_HARDLINK_DETACH_FAILED', was: 'en', en: l => `committed file failed post-detach validation: ${l}`,
    ko: l => `하드 링크를 떼어낸 뒤 저장한 파일이 검증을 통과하지 못했습니다: ${l}` },
  rescue: { was: 'ko', en: b => `⚠ Damaged JSON found — the original was moved aside before saving: ${b} (for manual recovery)\n`,
    ko: b => `⚠ 손상 JSON 감지 — 원본 대피 후 저장: ${b} (수동 복구용)\n` },
  refusal: { code: 'dry_run_unsupported', was: 'ko', en: f => `This command does not implement --dry-run — it stopped before writing ${f}. Nothing was changed (run it without --dry-run).`,
    ko: f => `이 명령은 --dry-run 을 구현하지 않았습니다 — ${f} 을(를) 쓰려다 멈췄습니다. 변경된 것은 없습니다(--dry-run 을 빼고 실행하세요).` },
};
// A text in a language state: the other language only when that language is registered; otherwise the old text.
const say = (state, name, ...args) => { const t = TEXT[name]; return t[state === 'en' || state === 'ko' ? state : t.was](...args); };
const detail = artifacts => artifacts.map(a => `${a.role}=${a.path} (${a.content || a.kind})`).join(', ');
// Language states of the direct calls: nothing registered, the two languages, then three that count as nothing
// registered: a resolver that throws, a value that is not a function and a resolver that answers another language.
const STATES = [['unset', undefined], ['ko', () => 'ko'], ['en', () => 'en'], ['throws', () => { throw new Error('no language'); }], ['value', 'ko'], ['other', () => 'fr']];

// ---- direct calls, in a child process of this file ------------------------------------------------------------------
const directAt = process.argv.indexOf('--direct');
if (directAt >= 0) {
  const [dir, outFile] = process.argv.slice(directAt + 1);
  const language = require('../lib/error-language'), io = require('../lib/io'), git = require('../lib/git');
  const child = require('child_process');
  const swap = (owner, key, make, fn) => { const real = owner[key]; owner[key] = make(real); try { return fn(); } finally { owner[key] = real; } };
  const fault = code => Object.assign(new Error('probe fault'), { code });
  const observe = fn => { try { fn(); return null; } catch (e) { return { code: e.code, message: e.message, backupFile: e.backupFile || null, recoveryArtifacts: e.recoveryArtifacts || null }; } };
  let made = 0;
  const fresh = (name, bytes) => { const p = path.join(dir, `${++made}-${name}`); if (bytes !== undefined) fs.writeFileSync(p, bytes); return p; };
  const isReplace = (opts, file) => !!(opts && opts.env && opts.env.LEERNESS_REPLACE_TO === file);
  const cases = {
    dryRun: () => { const f = fresh('dry.txt'); io.setDryRunGuard(true); try { return [f, observe(() => io.writeUtf8(f, 'x'))]; } finally { io.setDryRunGuard(false); } },
    gitDryRun: () => { git.setGitDryRun(true); try { return ['commit', observe(() => git.assertGitWriteAllowed('commit'))]; } finally { git.setGitDryRun(false); } },
    detachFailed: () => {
      // The alias cannot be removed or replaced, so the committed name is rolled back and the detach fails.
      const live = fresh('live.txt', 'committed'), alias = live + '.alias';
      fs.linkSync(live, alias);
      const blocked = (real, at) => function (...args) { if (args[at] === alias) throw fault('EPERM'); return real.apply(fs, args); };
      return [alias, swap(fs, 'unlinkSync', r => blocked(r, 0), () => swap(fs, 'rmSync', r => blocked(r, 0),
        () => swap(fs, 'renameSync', r => blocked(r, 1), () => observe(() => io.detachCommittedHardLink(alias, live, Buffer.from('committed'))))))];
    },
    detachGone: () => { const alias = fresh('alias.txt', 'x'), live = fresh('gone.txt'); return [live, observe(() => io.detachCommittedHardLink(alias, live, Buffer.from('x')))]; },
    detachInvalid: () => { const alias = fresh('alias.txt', 'x'), live = fresh('live.txt', 'actual'); return [live, observe(() => io.detachCommittedHardLink(alias, live, Buffer.from('expected')))]; },
    rescue: () => {
      // A damaged JSON file is moved aside before a valid one is written; the notice goes to stderr.
      const f = fresh('store.json', '{"broken": '), writes = [];
      swap(process.stderr, 'write', () => chunk => { writes.push(String(chunk)); return true; }, () => io.writeUtf8(f, '{"ok":true}\n'));
      const moved = fs.readdirSync(dir).filter(n => n.startsWith(path.basename(f) + '.corrupt-'));
      return [moved, { stderr: writes.join(''), written: fs.readFileSync(f, 'utf8') }];
    },
  };
  // io.js replaces existing files only on Windows (writeBufferIfUnchanged refuses other platforms before any of these).
  if (WIN) Object.assign(cases, {
    concurrent: () => { const f = fresh('cas.txt', 'current\n'); return [f, observe(() => io.writeBufferIfUnchanged(f, Buffer.from('expected\n'), Buffer.from('next\n')))]; },
    concurrentAfterReplace: () => {
      // Another writer changes the file right after the replacement: the displaced original is kept as the backup.
      const f = fresh('race.txt', 'expected\n');
      return [f, swap(child, 'spawnSync', real => function (cmd, args, opts) {
        const r = real.apply(this, arguments);
        if (isReplace(opts, f) && r.status === 0) fs.writeFileSync(f, 'another writer\n');
        return r;
      }, () => observe(() => io.writeBufferIfUnchanged(f, Buffer.from('expected\n'), Buffer.from('next\n'))))];
    },
    unsafeLink: () => {
      const f = fresh('link.txt', 'expected\n');
      return [f, swap(fs, 'lstatSync', real => function (p, ...rest) {
        const s = real.call(fs, p, ...rest);
        return p === f ? Object.assign(Object.create(Object.getPrototypeOf(s)), s, { isSymbolicLink: () => true }) : s;
      }, () => observe(() => io.writeBufferIfUnchanged(f, Buffer.from('expected\n'), Buffer.from('next\n'))))];
    },
    unsafeFileType: () => { const d = path.join(dir, `${++made}-folder`); fs.mkdirSync(d); return [d, observe(() => io.writeBufferIfUnchanged(d, Buffer.from('a'), Buffer.from('b')))]; },
    atomicReplace: () => {
      const f = fresh('denied.txt', 'expected\n');
      return [f, swap(child, 'spawnSync', real => function (cmd, args, opts) {
        return isReplace(opts, f) ? { status: 1, stdout: '', stderr: 'LEERNESS_REPLACE_ERROR:5:Access is denied.' } : real.apply(this, arguments);
      }, () => observe(() => io.writeBufferIfUnchanged(f, Buffer.from('expected\n'), Buffer.from('next\n'))))];
    },
    replaceUncertain: () => {
      const f = fresh('uncertain.txt', 'expected\n');
      return [f, swap(child, 'spawnSync', real => function (cmd, args, opts) {
        return isReplace(opts, f) ? { status: 0, stdout: '', stderr: '' } : real.apply(this, arguments);
      }, () => observe(() => io.writeBufferIfUnchanged(f, Buffer.from('expected\n'), Buffer.from('next\n'))))];
    },
  });
  const out = {};
  for (const [label, resolve] of STATES) {
    if (resolve !== undefined) language.setErrorLanguage(resolve);
    out[label] = { answer: language.errorLanguage(), cases: Object.fromEntries(Object.entries(cases).map(([name, make]) => { const [subject, got] = make(); return [name, { subject, got }]; })) };
  }
  fs.writeFileSync(outFile, JSON.stringify(out));
  process.exit(0);
}

const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
// A filter must name something: a missing value or one that selects no test is a failure, not "0/0 passed".
// Checked before any temporary folder exists, so this exit leaves nothing behind.
if (process.argv.includes('--match') && !filter) { console.error('--match needs a test name substring'); process.exit(1); }
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-write-primitive-language-'));
const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
  LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_BANNER: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_SKILL_HISTORY: '1' };
for (const key of ['LEERNESS_LANG', 'LEERNESS_NO_LOCK_WARN', 'LEERNESS_OLLAMA_BASE_URL', 'LEERNESS_ENFORCE_POLICY']) delete env[key];
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) { env[key] = path.join(arena, 'env-' + key.toLowerCase()); fs.mkdirSync(env[key]); }
let passed = 0, failed = 0, ran = 0;
const test = (name, fn) => { if (filter && !name.includes(filter)) return; ran++; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };
const HANGUL = /\p{Script=Hangul}/u;
const show = r => `exit ${r.status}\n${String(r.stdout || '').slice(-1500)}${String(r.stderr || '').slice(0, 600)}`;

test('direct calls: every changed write-primitive text in each language state, codes unchanged', () => {
  const dir = fs.mkdtempSync(path.join(arena, 'direct-')), outFile = path.join(arena, 'direct.json');
  const r = cp.spawnSync(process.execPath, [__filename, '--direct', dir, outFile], { cwd: arena, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
  assert.strictEqual(r.status, 0, show(r));
  const got = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const names = ['dryRun', 'gitDryRun', 'detachFailed', 'detachGone', 'detachInvalid', 'rescue', ...(WIN ? ['concurrent', 'concurrentAfterReplace', 'unsafeLink', 'unsafeFileType', 'atomicReplace', 'replaceUncertain'] : [])];
  for (const [state] of STATES) {
    const lang = state === 'ko' || state === 'en' ? state : 'unset', c = got[state].cases;
    assert.strictEqual(got[state].answer, lang === 'unset' ? null : lang, `${state}: errorLanguage()`);
    assert.deepStrictEqual(Object.keys(c).sort(), [...names].sort(), `${state}: the cases that ran`);
    const plain = (name, text) => assert.deepStrictEqual(c[name].got, { code: TEXT[text || name].code, message: say(state, text || name, c[name].subject), backupFile: null, recoveryArtifacts: null }, `${state} ${name}`);
    plain('dryRun'); plain('gitDryRun'); plain('detachFailed'); plain('detachGone'); plain('detachInvalid');
    // The notice names the moved-aside file; the valid JSON was written.
    assert.strictEqual(c.rescue.subject.length, 1, `${state} rescue: one moved-aside file`);
    assert.deepStrictEqual(c.rescue.got, { stderr: say(state, 'rescue', c.rescue.subject[0]), written: '{"ok":true}\n' }, `${state} rescue`);
    if (!WIN) continue;
    plain('concurrent'); plain('unsafeLink'); plain('unsafeFileType');
    // After a replacement: the backup and the recovery artifacts are named in the same language as the sentence.
    const race = c.concurrentAfterReplace.got;
    assert.ok(race && race.backupFile && Array.isArray(race.recoveryArtifacts) && race.recoveryArtifacts.length, `${state} race: ${JSON.stringify(race)}`);
    assert.deepStrictEqual(race, { code: 'E_CONCURRENT_MODIFICATION', backupFile: race.backupFile, recoveryArtifacts: race.recoveryArtifacts,
      message: say(state, 'concurrent', c.concurrentAfterReplace.subject) + say(state, 'backup', race.backupFile) + say(state, 'artifacts', detail(race.recoveryArtifacts)) }, `${state} race`);
    assert.deepStrictEqual(race.recoveryArtifacts.map(a => a.role), ['live-target', 'displaced-original'], `${state} race artifacts`);
    for (const [name, text, subject] of [['atomicReplace', 'atomicReplace', () => 'Access is denied.'], ['replaceUncertain', 'replaceUncertain', a => a.find(x => x.role === 'planned-source').path]]) {
      const e = c[name].got;
      assert.ok(e && Array.isArray(e.recoveryArtifacts), `${state} ${name}: ${JSON.stringify(e)}`);
      assert.deepStrictEqual(e, { code: TEXT[text].code, backupFile: e.backupFile, recoveryArtifacts: e.recoveryArtifacts,
        message: say(state, text, subject(e.recoveryArtifacts)) + say(state, 'artifacts', detail(e.recoveryArtifacts)) }, `${state} ${name}`);
      assert.deepStrictEqual(e.recoveryArtifacts.map(a => [a.role, a.content]), [['live-target', 'expected-original'], ['planned-source', 'planned-replacement']], `${state} ${name} artifacts`);
    }
  }
});

// The arguments of each call to `name(` in a source, split at top-level commas. Strings, template literals (with
// their ${} parts), comments and brackets are read as units.
function callArgs(source, name) {
  const skipString = (s, i, q) => { for (i++; i < s.length; i++) { if (s[i] === '\\') i++; else if (s[i] === q) return i; } return i; };
  const skipComment = (s, i) => s[i + 1] === '/' ? s.indexOf('\n', i) : s.indexOf('*/', i + 2) + 1;
  const skipTemplate = (s, i) => { for (i++; i < s.length; i++) { if (s[i] === '\\') i++; else if (s[i] === '`') return i; else if (s[i] === '$' && s[i + 1] === '{') i = scan(s, i + 2, null); } return i; };
  function scan(s, i, args) {
    let depth = 0, start = i;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === "'" || c === '"') i = skipString(s, i, c);
      else if (c === '`') i = skipTemplate(s, i);
      else if (c === '/' && (s[i + 1] === '/' || s[i + 1] === '*')) i = skipComment(s, i);
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (depth === 0) { if (args) args.push(s.slice(start, i).trim()); return i; } depth--; }
      else if (c === ',' && depth === 0 && args) { args.push(s.slice(start, i).trim()); start = i + 1; }
    }
    return i;
  }
  const calls = [], re = new RegExp('(?<![\\w$.])' + name + '\\(', 'g');
  for (let m; (m = re.exec(source));) { const args = []; scan(source, m.index + m[0].length, args); calls.push(args); }
  return calls;
}

test('source check: io.js keeps exactly four one-language error texts, the ones outside the owner\'s scope', () => {
  // A new error added in one language fails here. Kept as they were: the platform refusal and the publication buffer
  // limit (no current caller reaches them) and the two cleanup fallbacks (unreachable: the retry loop always keeps the
  // file system error).
  const errors = callArgs(fs.readFileSync(path.join(LIB, 'io.js'), 'utf8'), 'Error').map(a => a[0]);
  const fixed = errors.filter(a => /^[`'"]/.test(a)).map(a => a.slice(1, -1));
  assert.deepStrictEqual(fixed.sort(), ['Memory publication buffer exceeds declared byte limit', '메타데이터 보존 원자 교체를 지원하지 않는 플랫폼입니다: ${process.platform}',
    '임시 쓰기 디렉터리를 정리하지 못했습니다: ${p}', '임시 쓰기 아티팩트를 정리하지 못했습니다: ${p}'].sort());
  // Every other error picks one of two texts, one Korean and one not, by the registered language (9 sites; `en` is the
  // local copy of _english() in the compare-and-set refusal).
  const chosen = errors.filter(a => !/^[`'"]/.test(a));
  assert.strictEqual(chosen.length, 9, JSON.stringify(chosen));
  for (const a of chosen) {
    const m = /^(_english\(\)|_korean\(\)|en) \?\s*`([^`]*)`\s*:\s*`([^`]*)`$/.exec(a);
    assert.ok(m && HANGUL.test(m[2]) !== HANGUL.test(m[3]), a);
    // _english() picks English first, _korean() Korean first.
    assert.strictEqual(HANGUL.test(m[2]), m[1] === '_korean()', a);
  }
});

// ---- the commands ----------------------------------------------------------------------------------------------------
const seeds = {};
const seed = lang => {
  if (seeds[lang]) return seeds[lang];
  const dir = path.join(arena, 'seed-' + lang);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"proj","version":"0.1.0"}\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'init', dir, '--yes', '--language', lang, '--no-mcp'], { cwd: dir, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
  assert.strictEqual(r.status, 0, 'init ' + lang + ' ' + show(r));
  return (seeds[lang] = dir);
};
let copies = 0;
// T-0343: the fixture folders have Korean names, and Node 22.23.3's fs.cpSync crashes on non-ASCII paths on Windows.
const { copyTreeSync } = require('../lib/copy-tree');
const fresh = lang => { const dir = path.join(arena, 'p' + (++copies) + ' 한글'); copyTreeSync(seed(lang), dir); return dir; };
const ws = (P, name) => path.join(P, '.leerness', name);
const hook = path.join(arena, 'write-hook.cjs');
// WPL_MODE=race: another writer changes the target right before the compare-and-set replacement checks it (the Windows
// memory output path). mode-json: the first JSON payload `mode` prints throws E_DRY_RUN_WRITE, so the error passes the
// mode handler's own catch and reaches the CLI's top-level refusal. lookup: after the dry-run guard stops a write, the
// current folder can no longer be read, so the refusal's language lookup fails.
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),path=require('path');
const io=require(path.join(process.env.WPL_LIB,'io')),mode=process.env.WPL_MODE;let fired=false;
const dry=file=>Object.assign(new Error('probe dry-run'),{code:'E_DRY_RUN_WRITE',file});
if(mode==='race'){const real=io.writeBufferIfUnchanged;io.writeBufferIfUnchanged=function(p,...rest){if(!fired&&p===process.env.WPL_TARGET){fired=true;fs.appendFileSync(p,'another writer'+String.fromCharCode(10));}return real.call(this,p,...rest);};}
if(mode==='mode-json'){const real=io.log;io.log=function(s,...rest){if(typeof s==='string'&&s.includes('"modes"'))throw dry(process.env.WPL_TARGET);return real.call(this,s,...rest);};}
if(mode==='lookup'){const real=io.assertWriteAllowed;io.assertWriteAllowed=function(...a){try{return real.apply(this,a);}catch(e){if(e&&e.code==='E_DRY_RUN_WRITE')process.cwd=()=>{throw new Error('probe: no current folder');};throw e;}};}
`);
const run = (args, extra = {}, opts = {}) => cp.spawnSync(process.execPath, [...(opts.hook ? ['--require', hook] : []), CLI, ...args],
  { cwd: opts.cwd || arena, encoding: 'utf8', timeout: 300000, windowsHide: true, env: { ...env, WPL_LIB: LIB, ...extra } });
// The error line in the project language once the paths are left out.
const languageOf = (text, ...dirs) => HANGUL.test(dirs.reduce((t, d) => t.split(d).join('<dir>'), String(text))) ? 'ko' : 'en';

for (const lang of ['en', 'ko']) {
  test(`${lang}: the dry-run refusal and the dry-run guard text reach the commands in the project language`, () => {
    const P = fresh(lang), decisions = ws(P, 'decisions.json'), manifest = ws(P, 'manifest.json');
    const t = run(['decision', 'add', 'Probe', '--dry-run', '--path', P]);
    assert.deepStrictEqual([t.status, t.stdout, t.stderr], [1, '✗ ' + say(lang, 'refusal', decisions) + '\n', ''], show(t));
    const j = run(['decision', 'add', 'Probe', '--dry-run', '--path', P, '--json']);
    assert.deepStrictEqual([j.status, JSON.parse(j.stdout), j.stderr], [1, { ok: false, error: say(lang, 'refusal', decisions), code: 'dry_run_unsupported' }, ''], show(j));
    // mode set wraps the guard's own text; its human wrapper follows the project, its --json wrapper stays Korean (T-0164).
    const wrapper = lang === 'en' ? 'Mode change stopped at .leerness/manifest.json. Completed save steps: none. This command did not save any of the three files. '
      : '등급 변경 중단: .leerness/manifest.json. 완료된 저장 단계: 없음. 이 명령은 세 파일을 저장하지 않았습니다. ';
    const m = run(['mode', 'set', 'minimal', '--dry-run', '--path', P]);
    assert.deepStrictEqual([m.status, m.stdout, m.stderr], [1, '✗ ' + wrapper + say(lang, 'dryRun', manifest) + '\n', ''], show(m));
    const mj = run(['mode', 'set', 'minimal', '--dry-run', '--path', P, '--json']);
    const doc = JSON.parse(mj.stdout);
    assert.deepStrictEqual([mj.status, doc.code, doc.causeCode, doc.error], [1, 'mode_update_failed', 'E_DRY_RUN_WRITE',
      '등급 변경 중단: .leerness/manifest.json. 완료된 저장 단계: 없음. 이 명령은 세 파일을 저장하지 않았습니다. ' + say(lang, 'dryRun', manifest)], show(mj));
    for (const out of [t.stdout, m.stdout]) assert.strictEqual(languageOf(out, P), lang, out);
  });

  test(`${lang}: a damaged JSON store is moved aside with the notice in the project language`, () => {
    const P = fresh(lang), store = ws(P, 'glossary.json');
    fs.writeFileSync(store, '{"broken": ');
    const r = run(['glossary', 'build', '--path', P]);
    const moved = fs.readdirSync(ws(P, '')).filter(n => n.startsWith('glossary.json.corrupt-'));
    assert.strictEqual(moved.length, 1, show(r));
    assert.deepStrictEqual([r.status, r.stderr], [0, say(lang, 'rescue', moved[0])], show(r));
    assert.strictEqual(fs.readFileSync(path.join(ws(P, ''), moved[0]), 'utf8'), '{"broken": ', 'the moved-aside file keeps the damaged bytes');
  });

  if (WIN) test(`${lang}: a change caught by the Windows compare-and-set check reaches memory commands in the project language (E_OUTPUT_CHANGED)`, () => {
    // T-0337 left this text fixed; memory output passes it on under its own code. The change lands before the check
    // that precedes the native replacement; the direct calls above cover a change after the replacement.
    const P = fresh(lang), tracker = ws(P, 'progress-tracker.md');
    const r = run(['task', 'add', 'row', '--path', P, '--json'], { WPL_MODE: 'race', WPL_TARGET: tracker }, { hook: true });
    let doc = null;
    try { doc = JSON.parse(r.stdout); } catch {}
    assert.deepStrictEqual([r.status, doc, r.stderr], [1, { ok: false, error: say(lang, 'concurrent', tracker), code: 'error' }, '✗ ' + say(lang, 'concurrent', tracker) + '\n'], show(r));
    assert.ok(fs.readFileSync(tracker, 'utf8').endsWith('another writer\n'), 'the other writer\'s change was kept');
  });
}

test('the CLI refusal keeps mode --json Korean (T-0164) and falls back to Korean when the project cannot be read', () => {
  // Review round 1: mode set catches the guard itself, so the top-level refusal needs an error past mode's own catch.
  const P = fresh('en'), manifest = ws(P, 'manifest.json'), decisions = ws(P, 'decisions.json');
  const j = run(['mode', 'get', '--path', P, '--json'], { WPL_MODE: 'mode-json', WPL_TARGET: manifest }, { hook: true });
  assert.deepStrictEqual([j.status, JSON.parse(j.stdout), j.stderr], [1, { ok: false, error: say('ko', 'refusal', manifest), code: 'dry_run_unsupported' }, ''], show(j));
  const lost = run(['decision', 'add', 'Probe', '--dry-run', '--path', P], { WPL_MODE: 'lookup' }, { hook: true });
  assert.deepStrictEqual([lost.status, lost.stdout, lost.stderr], [1, '✗ ' + say('ko', 'refusal', decisions) + '\n', ''], show(lost));
  // Control: the same English project without the hooks gets the English refusal.
  const plain = run(['decision', 'add', 'Probe', '--dry-run', '--path', P]);
  assert.deepStrictEqual([plain.status, plain.stdout], [1, '✗ ' + say('en', 'refusal', decisions) + '\n'], show(plain));
});

test('the language follows --language, LEERNESS_LANG and the --path project, not the cwd', () => {
  const cases = [
    ['a Korean project, LEERNESS_LANG=en', 'ko', { LEERNESS_LANG: 'en' }, [], 'en'],
    ['an English project, LEERNESS_LANG=ko', 'en', { LEERNESS_LANG: 'ko' }, [], 'ko'],
    ['--language ko over LEERNESS_LANG=en', 'en', { LEERNESS_LANG: 'en' }, ['--language', 'ko'], 'ko'],
    ['--language en over LEERNESS_LANG=ko', 'ko', { LEERNESS_LANG: 'ko' }, ['--language', 'en'], 'en'],
  ];
  for (const [label, projectLang, extra, flags, want] of cases) {
    const P = fresh(projectLang), r = run(['decision', 'add', 'Probe', '--dry-run', '--path', P, ...flags], extra);
    assert.deepStrictEqual([r.status, r.stdout], [1, '✗ ' + say(want, 'refusal', ws(P, 'decisions.json')) + '\n'], `${label}: ${show(r)}`);
  }
  const en = fresh('en'), ko = fresh('ko');
  for (const [P, cwd, want] of [[en, ko, 'en'], [ko, en, 'ko']]) {
    const r = run(['decision', 'add', 'Probe', '--dry-run', '--path', P], {}, { cwd });
    assert.deepStrictEqual([r.status, r.stdout], [1, '✗ ' + say(want, 'refusal', ws(P, 'decisions.json')) + '\n'], `--path ${want}: ${show(r)}`);
  }
});

console.log(`write primitive language: ${passed}/${passed + failed}`);
if (filter && !ran) console.error(`--match ${JSON.stringify(filter)} selected no test`);
try { removeTree(arena, { recursive: true, force: true }); } catch {}
if (failed || (filter ? ran === 0 : ran !== 2 + 2 * (WIN ? 3 : 2) + 2)) process.exitCode = 1;
