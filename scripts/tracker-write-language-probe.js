'use strict';
// T-0336: errors on the shared progress-tracker write path follow the project language. The row-loss guard in
// writeProgressRows (E_PROGRESS_ROW_LOSS) printed Korean in English projects through the commands that rewrite tracker
// rows (task fix-evidence --set, task add, task update, task sync and others); lib/managed-text.js errors
// (E_TEXT_ENCODING, E_TEXT_LIMIT, E_TEXT_LOCK, ...) and writeProgressRows' own missing-snapshot check (E_TEXT_SNAPSHOT)
// printed English in Korean projects; memory restore's archive refusals (archive_corrupt) were English for the plan and
// Korean for decisions and lessons in every project. All now use the language of the commands' own text: --language,
// then LEERNESS_LANG, then the manifest of the project named by --path or a path argument. Codes are unchanged; every
// existing text stays byte for byte in the language that had it (the expected strings below); a refused write leaves
// the files as they were. Rows are made through the product; only the malformed row and the invalid bytes are written
// by hand, as Buffers. Every test works on its own copy of an initialized seed in a folder with Hangul in its name, and
// the CLI runs outside the project (in the arena, or in a project of the other language).
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
// Six values and no closing pipe: it looks like a tracker row, but reads as five cells.
const MALFORMED = '| T-0900 | done | six values | no closing pipe | none | 2026-10-07\n';
const observe = fn => { try { fn(); return null; } catch (e) { return { code: e && e.code, message: e && e.message }; } };

// Direct calls run in a child process of this file, so loading the CLI module and replacing a library function stay out
// of the probe's own process. The child prints what it observed as JSON; the tests below do the asserting.
const directAt = process.argv.indexOf('--direct');
if (directAt >= 0) {
  const [mode, dir] = process.argv.slice(directAt + 1);
  const out = {};
  if (mode === 'row-loss') {
    // The second message (fewer rows to write than were read) has no command path: every caller writes the rows it
    // read, less the removals it expects. In the CLI module's process the language comes from the project's manifest.
    const cli = require(CLI), { captureTextEdit } = require('../lib/managed-text');
    const file = path.join(dir, '.leerness', 'progress-tracker.md'), original = fs.readFileSync(file);
    const rows = original.toString('utf8').split('\n').filter(l => /^\| T-\d{4} \|/.test(l)).map(l => {
      const [id, status, request, evidence, nextAction, updated] = l.split('|').slice(1, -1).map(s => s.trim());
      return { id, status, request, evidence, nextAction, updated };
    });
    const write = (list, opts = {}) => observe(() => cli._withLock(file, () => cli.writeProgressRows(dir, '# Progress Tracker', list, { input: captureTextEdit(file), ...opts })));
    out.snapshot = observe(() => cli.writeProgressRows(dir, '# Progress Tracker', rows, {}));   // a caller without the checked text
    out.fewer = write(rows.slice(1));
    out.shrink = write(rows.slice(2), { expectedShrink: 1 });
    fs.writeFileSync(file, Buffer.concat([original, Buffer.from(MALFORMED, 'utf8')]));
    out.malformed = write(rows);
    fs.writeFileSync(file, original);
    out.control = write(rows);   // the same rows on the same file are written: the refusals above were the guard's
  } else if (mode === 'managed-text') {
    // E_TEXT_CHANGED needs the output capture to read other bytes than the input capture while the input check sees no
    // change, which takes a race; so the output capture is replaced before managed-text loads it.
    const memoryOutput = require('../lib/memory-output'), realCapture = memoryOutput.captureMemoryOutput;
    let changeNext = false;
    memoryOutput.captureMemoryOutput = (file, options) => {
      const token = realCapture(file, options);
      if (!changeNext) return token;
      changeNext = false;
      return { ...token, bytes: Buffer.from('changed elsewhere') };
    };
    const mt = require('../lib/managed-text'), { withStateLock } = require('../lib/state-lock');
    const file = path.join(dir, 'managed.md');
    fs.writeFileSync(file, 'text\n');
    const locked = fn => () => withStateLock(file, fn);
    const cases = {
      lock: () => mt.captureTextEdit(file),
      utf8: () => mt.decodeText(Buffer.from([0xff, 0xfe]), file),
      type: () => mt.validateText(12, file),
      surrogate: () => mt.validateText('a' + String.fromCharCode(0xd800), file),
      limitOption: locked(() => mt.captureTextEdit(file, { maxBytes: mt.MAX_TEXT_BYTES + 1 })),
      changed: locked(() => { changeNext = true; mt.captureTextEdit(file); }),
      snapshot: locked(() => mt.publishTextEdit({}, file, 'x')),
      overBytes: locked(() => mt.publishTextEdit(mt.captureTextEdit(file, { maxBytes: 64 }), file, 'x'.repeat(65))),
      over4MiB: locked(() => mt.publishTextEdit(mt.captureTextEdit(file), file, 'x'.repeat(mt.MAX_TEXT_BYTES + 1))),
    };
    // Nothing registered first; a resolver that fails and a value that is not a function count as nothing registered.
    for (const [label, resolve] of [['unset', undefined], ['ko', () => 'ko'], ['en', () => 'en'], ['throws', () => { throw new Error('no language'); }], ['value', 'ko']]) {
      if (resolve !== undefined) mt.setErrorLanguage(resolve);
      out[label] = Object.fromEntries(Object.entries(cases).map(([name, fn]) => [name, observe(fn)]));
    }
    out.unchanged = fs.readFileSync(file, 'utf8');
  } else throw new Error('unknown direct mode: ' + mode);
  process.stdout.write(JSON.stringify(out));
  return;
}

const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
// A filter must name something: a missing value or one that selects no test is a failure, not "0/0 passed".
// Checked before any temporary folder exists, so this exit leaves nothing behind.
if (process.argv.includes('--match') && !filter) { console.error('--match needs a test name substring'); process.exit(1); }
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tracker-write-language-'));
const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
  LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_BANNER: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_SKILL_HISTORY: '1' };
for (const key of ['LEERNESS_LANG', 'LEERNESS_OLLAMA_BASE_URL', 'LEERNESS_ENFORCE_POLICY']) delete env[key];
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) { env[key] = path.join(arena, 'env-' + key.toLowerCase()); fs.mkdirSync(env[key]); }
let passed = 0, failed = 0, ran = 0;
const test = (name, fn) => { if (filter && !name.includes(filter)) return; ran++; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };

const HANGUL = /\p{Script=Hangul}/u;
const seeds = {};
const seed = lang => {
  if (seeds[lang]) return seeds[lang];
  const dir = path.join(arena, 'seed-' + lang);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"proj","version":"0.1.0"}\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'init', dir, '--yes', '--language', lang, '--no-mcp'], { cwd: dir, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
  assert.strictEqual(r.status, 0, 'init ' + lang + ' exit ' + r.status + '\n' + r.stdout + r.stderr);
  return (seeds[lang] = dir);
};
let copies = 0;
// Project folders have Hangul in their names, as a Korean user's folders may (review round 1), so the language checks
// below read the output without them: the messages print full paths.
const fresh = lang => { const dir = path.join(arena, 'p' + (++copies) + ' 한글'); fs.cpSync(seed(lang), dir, { recursive: true }); return dir; };
const withoutPaths = (text, ...dirs) => dirs.reduce((t, d) => t.split(d).join('<dir>').split(JSON.stringify(d).slice(1, -1)).join('<dir>'), String(text));
const run = (args, extraEnv = {}, cwd = arena) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 300000, windowsHide: true, env: { ...env, ...extraEnv } });
const show = r => `exit ${r.status}\n${String(r.stdout || '').slice(0, 1500)}${String(r.stderr || '').slice(0, 600)}`;
const direct = (mode, dir) => {
  const r = cp.spawnSync(process.execPath, [__filename, '--direct', mode, dir], { cwd: arena, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
  assert.strictEqual(r.status, 0, show(r));
  return JSON.parse(r.stdout);
};
const tracker = P => path.join(P, '.leerness', 'progress-tracker.md');
// The rows the product wrote: init's own row and one done row with placeholder evidence, so --set has a candidate.
const productRows = P => fs.readFileSync(tracker(P), 'utf8').split('\n').filter(l => /^\| T-\d{4} \|.*\|$/.test(l)).length;
const project = lang => {
  const P = fresh(lang);
  const a = run(['task', 'add', 'row a', '--path', P, '--json']);
  const id = JSON.parse(a.stdout.slice(a.stdout.indexOf('{'))).id;
  assert.ok(id, show(a));
  const u = run(['task', 'update', id, '--status', 'done', '--evidence', 'user-request', '--path', P]);
  assert.strictEqual(u.status, 0, show(u));
  return { P, id, rows: productRows(P) };
};
const append = (P, bytes) => fs.writeFileSync(tracker(P), Buffer.concat([fs.readFileSync(tracker(P)), bytes]));
// Invalid UTF-8 after the table (0xFF and 0xFE never occur in UTF-8): the rows still read, the write's check refuses.
const INVALID = Buffer.concat([Buffer.from('\nnote: ', 'utf8'), Buffer.from([0xff, 0xfe]), Buffer.from('\n', 'utf8')]);

const TEXT = {
  ko: {
    rowLoss: (file, shaped, parsable) => `progress-tracker.md 행 손실 위험 — 행-모양 ${shaped}건 중 ${parsable}건만 파싱 가능(셀 부족/형식 이상). ` +
      `쓰면 나머지 ${shaped - parsable}행이 사라지므로 중단합니다(데이터 보호): ${file} 의 해당 행을 6칸으로 고치거나 .leerness/archive 백업 복원 후 재시도`,
    shrink: (file, parsed, expected, writing) => `progress-tracker.md 행 손실 위험 — 파싱 ${parsed}행 − 예상감소 ${expected} > 쓰려는 ${writing}행. 쓰기 중단(데이터 보호): ${file}`,
    encoding: file => `관리 문서에 UTF-8 로 읽을 수 없는 바이트가 있어 대체 문자로 바꾸지 않았습니다: ${file}. 원본을 보존하고 확인한 뒤 다시 시도하세요.`,
    snapshot: '진행 추적 편집에는 검사한 텍스트 스냅숏이 필요합니다',
    archive: surface => surface === 'plan' ? 'plan.archive.md 에 UTF-8 로 읽을 수 없는 바이트가 있습니다. 두 파일 모두 바꾸지 않고 복원을 멈췄습니다. 원본을 보존하세요.'
      : `${surface}.archive.md 의 UTF-8 바이트 손상 — 파일이 잘렸거나 인코딩 깨짐. 복원 중단(아카이브 무변경) — 원본 복구 후 재시도`,
    taskImport: '가져올 작업 파일을 크기 제한 안의 UTF-8 JSON 으로 읽지 못했습니다. 원본을 보존하고 입력을 확인하세요.',
  },
  en: {
    rowLoss: (file, shaped, parsable) => `progress-tracker.md row loss risk — only ${parsable} of ${shaped} row-shaped lines can be parsed (missing cells or malformed). ` +
      `Writing would drop the other ${shaped - parsable} row(s), so the write stopped to protect the data: give the malformed row(s) six cells in ${file} or restore a backup from .leerness/archive, then retry`,
    shrink: (file, parsed, expected, writing) => `progress-tracker.md row loss risk — ${parsed} parsed rows minus ${expected} expected removals is more than the ${writing} rows to write. Write stopped to protect the data: ${file}`,
    encoding: file => `Managed text has invalid UTF-8; no replacement was attempted: ${file}. Preserve the original and retry after checking it.`,
    snapshot: 'Progress edit requires a checked text snapshot',
    archive: surface => surface === 'plan' ? 'plan.archive.md has invalid UTF-8; restore stopped without changing either file. Preserve the original.'
      : `${surface}.archive.md has damaged UTF-8 bytes — the file was cut or its encoding is broken. Restore stopped (archive unchanged) — recover the original and retry`,
    taskImport: 'Task import could not be read as bounded UTF-8 JSON. Preserve the original and check the input.',
  },
};
// Every managed-text message: [code, English reason, Korean sentence].
const MANAGED = {
  lock: ['E_TEXT_LOCK', 'requires its existing state lock', '관리 문서는 해당 상태 잠금을 잡은 상태에서만 편집할 수 있습니다'],
  utf8: ['E_TEXT_ENCODING', 'has invalid UTF-8; no replacement was attempted', '관리 문서에 UTF-8 로 읽을 수 없는 바이트가 있어 대체 문자로 바꾸지 않았습니다'],
  type: ['E_TEXT_TYPE', 'replacement must be a string', '관리 문서의 새 내용은 문자열이어야 합니다'],
  surrogate: ['E_TEXT_ENCODING', 'replacement contains an unpaired surrogate', '관리 문서의 새 내용에 짝이 없는 서로게이트 문자가 있습니다'],
  limitOption: ['E_TEXT_LIMIT', 'requires a byte limit within the 4 MiB boundary', '관리 문서의 바이트 한도는 4 MiB 이내여야 합니다'],
  changed: ['E_TEXT_CHANGED', 'changed while preparing the edit', '관리 문서가 편집을 준비하는 동안 바뀌었습니다'],
  snapshot: ['E_TEXT_SNAPSHOT', 'requires an unused snapshot for this exact path', '관리 문서 편집에는 이 경로에서 읽고 아직 쓰지 않은 스냅숏이 필요합니다'],
  overBytes: ['E_TEXT_LIMIT', 'replacement exceeds the 64 byte boundary', '관리 문서의 새 내용이 64 바이트 한도를 넘습니다'],
  over4MiB: ['E_TEXT_LIMIT', 'replacement exceeds the 4 MiB boundary', '관리 문서의 새 내용이 4 MiB 한도를 넘습니다'],
};
const managed = (lang, file) => Object.fromEntries(Object.entries(MANAGED).map(([name, [code, en, ko]]) => [name, { code,
  message: lang === 'ko' ? `${ko}: ${file}. 원본을 보존하고 확인한 뒤 다시 시도하세요.` : `Managed text ${en}: ${file}. Preserve the original and retry after checking it.` }]));

// A refused write: exit 1, the message on stdout as the CLI's error line (and nothing else), the tracker unchanged.
// With --json the message is the error of the JSON on stdout and the error line goes to stderr.
const refused = (label, lang, message, args, P, before, extraEnv, cwd) => {
  const r = run(args, extraEnv, cwd);
  const json = args.includes('--json');
  let got;
  try { got = json ? [r.status, JSON.parse(r.stdout), r.stderr] : [r.status, r.stdout, r.stderr]; } catch { got = [r.status, r.stdout, r.stderr]; }
  assert.deepStrictEqual(got, json ? [1, { ok: false, error: message, code: 'error' }, '✗ ' + message + '\n'] : [1, '✗ ' + message + '\n', ''], label + ': ' + show(r));
  assert.strictEqual(HANGUL.test(withoutPaths(r.stdout + r.stderr, P)), lang === 'ko', label + ': the output is not ' + lang + '\n' + r.stdout + r.stderr);
  assert.ok(fs.readFileSync(tracker(P)).equals(before), label + ': the refused write changed the tracker');
};
const writers = (P, id) => [
  ['task fix-evidence --set', ['task', 'fix-evidence', '--set', 'checked by hand', '--path', P]],
  ['task update', ['task', 'update', id, '--evidence', 'checked by hand', '--path', P]],
  ['task update --json', ['task', 'update', id, '--evidence', 'checked by hand', '--path', P, '--json']],
];

for (const lang of ['en', 'ko']) {
  test(`${lang}: a malformed tracker row stops task fix-evidence --set, task update and task add with the row-loss message`, () => {
    const { P, id, rows } = project(lang);
    append(P, Buffer.from(MALFORMED, 'utf8'));
    const before = fs.readFileSync(tracker(P)), message = TEXT[lang].rowLoss(tracker(P), rows + 1, rows);
    for (const [label, args] of [...writers(P, id), ['task add', ['task', 'add', 'row b', '--path', P]]]) refused(label, lang, message, args, P, before);
  });

  test(`${lang}: invalid UTF-8 in the tracker stops task fix-evidence --set and task update with the encoding message`, () => {
    const { P, id } = project(lang);
    append(P, INVALID);
    const before = fs.readFileSync(tracker(P)), message = TEXT[lang].encoding(tracker(P));
    for (const [label, args] of writers(P, id)) refused(label, lang, message, args, P, before);
  });
}

test('the language is chosen as for the commands\' own text: --language, then LEERNESS_LANG, then the manifest', () => {
  // Each override against the other source, in both directions. task update takes no --language, so the flag cases
  // run task fix-evidence --set.
  const cases = [
    ['a Korean project, LEERNESS_LANG=en', 'ko', 'update', { LEERNESS_LANG: 'en' }, 'en'],
    ['an English project, LEERNESS_LANG=ko', 'en', 'update', { LEERNESS_LANG: 'ko' }, 'ko'],
    ['--language ko over LEERNESS_LANG=en', 'en', 'set-ko', { LEERNESS_LANG: 'en' }, 'ko'],
    ['--language en over LEERNESS_LANG=ko', 'ko', 'set-en', { LEERNESS_LANG: 'ko' }, 'en'],
  ];
  for (const [label, projectLang, command, extraEnv, want] of cases) {
    for (const [kind, bytes] of [['row loss', Buffer.from(MALFORMED, 'utf8')], ['encoding', INVALID]]) {
      const { P, id, rows } = project(projectLang);
      append(P, bytes);
      const before = fs.readFileSync(tracker(P));
      const message = kind === 'row loss' ? TEXT[want].rowLoss(tracker(P), rows + 1, rows) : TEXT[want].encoding(tracker(P));
      const args = command === 'update' ? ['task', 'update', id, '--evidence', 'checked by hand', '--path', P]
        : ['task', 'fix-evidence', '--set', 'checked by hand', '--path', P, '--language', command.slice(4)];
      refused(`${label} (${kind})`, want, message, args, P, before, extraEnv);
    }
  }
});

test('the project is the one named by --path, else by a path argument, never the cwd', () => {
  // Review round 1: the other CLI cases all name the project with --path. Here each run starts in a project of the other
  // language, so a choice by the cwd shows, and --path is given together with a path argument to the other project.
  const en = project('en'), ko = project('ko'), enMode = fresh('en'), koMode = fresh('ko');
  for (const p of [en, ko]) append(p.P, Buffer.from(MALFORMED, 'utf8'));
  for (const P of [enMode, koMode]) { const a = path.join(P, 'AGENTS.md'); fs.writeFileSync(a, Buffer.concat([fs.readFileSync(a), Buffer.from([0xff, 0xfe])])); }
  const update = (p, ...rest) => ['task', 'update', p.id, '--evidence', 'checked by hand', ...rest];
  const rowCases = [
    ['an English project as a path argument, run in a Korean project', en, update(en, en.P), ko.P, 'en'],
    ['a Korean project as a path argument, run in an English project', ko, update(ko, ko.P), en.P, 'ko'],
    ['--path to an English project over a path argument to a Korean one', en, update(en, ko.P, '--path', en.P), ko.P, 'en'],
    ['--path to a Korean project over a path argument to an English one', ko, update(ko, en.P, '--path', ko.P), en.P, 'ko'],
  ];
  for (const [label, p, args, cwd, want] of rowCases) {
    const before = fs.readFileSync(tracker(p.P));
    refused(label, want, TEXT[want].rowLoss(tracker(p.P), p.rows + 1, p.rows), args, p.P, before, {}, cwd);
  }
  // The managed-text language comes from the resolver the CLI registers: the same cases through mode set.
  const modeCases = [
    ['mode set: an English project as a path argument, run in a Korean project', enMode, ['mode', 'set', 'minimal', enMode], koMode, 'en'],
    ['mode set: a Korean project as a path argument, run in an English project', koMode, ['mode', 'set', 'minimal', koMode], enMode, 'ko'],
    ['mode set: --path to an English project over a path argument to a Korean one', enMode, ['mode', 'set', 'minimal', koMode, '--path', enMode], koMode, 'en'],
  ];
  for (const [label, P, args, cwd, want] of modeCases) {
    const agents = path.join(P, 'AGENTS.md'), before = fs.readFileSync(agents);
    const r = run(args, {}, cwd);
    assert.deepStrictEqual([r.status, r.stdout.endsWith(' ' + TEXT[want].encoding(agents) + '\n'), r.stderr], [1, true, ''], label + ': ' + show(r));
    assert.strictEqual(HANGUL.test(withoutPaths(r.stdout, P)), want === 'ko', label + ': the output is not ' + want + '\n' + r.stdout);
    assert.ok(fs.readFileSync(agents).equals(before), label + ': the refused mode change changed AGENTS.md');
  }
});

for (const lang of ['en', 'ko']) {
  test(`${lang}: memory restore refuses invalid UTF-8 in the plan, decisions and lessons archives in the project language`, () => {
    // Review round 1: the plan restore put a fixed English sentence in place of the managed-text error, and the same
    // refusal for decisions and lessons was Korean in every project. Both follow the project now (code archive_corrupt).
    const P = fresh(lang), ws = path.join(P, '.leerness');
    for (const surface of ['plan', 'decisions', 'lessons']) {
      const archive = path.join(ws, surface + '.archive.md');
      fs.writeFileSync(archive, Buffer.concat([Buffer.from('# ' + surface + ' archive\n\n', 'utf8'), Buffer.from([0xff, 0xfe]), Buffer.from('\n', 'utf8')]));
      const watched = [archive, ...(surface === 'plan' ? ['plan.md'] : [surface + '.json', surface + '.md']).map(f => path.join(ws, f))];
      const state = () => watched.map(f => fs.existsSync(f) ? fs.readFileSync(f).toString('base64') : null);
      const before = state(), message = TEXT[lang].archive(surface);
      for (const json of [false, true]) {
        const label = `memory restore ${surface}${json ? ' --json' : ''}`;
        const r = run(['memory', 'restore', surface, 'x', '--path', P, ...(json ? ['--json'] : [])]);
        let got;
        try { got = json ? [r.status, JSON.parse(r.stdout), r.stderr] : [r.status, r.stdout, r.stderr]; } catch { got = [r.status, r.stdout, r.stderr]; }
        assert.deepStrictEqual(got, json ? [1, { ok: false, error: message, code: 'archive_corrupt' }, ''] : [1, '✗ ' + message + '\n', ''], label + ': ' + show(r));
        assert.strictEqual(HANGUL.test(withoutPaths(r.stdout + r.stderr, P)), lang === 'ko', label + ': the output is not ' + lang + '\n' + r.stdout + r.stderr);
        assert.deepStrictEqual(state(), before, label + ': the refused restore changed a file');
      }
    }
  });

  test(`${lang}: task sync --from refuses an import file with invalid UTF-8 or invalid JSON in the project language`, () => {
    // Review round 2: task sync put a fixed English sentence in place of the managed-text error (and of a JSON syntax
    // error). The code is the one the reading failed with: E_TEXT_ENCODING, or invalid_task_import for the syntax error.
    const P = fresh(lang), before = fs.readFileSync(tracker(P)), message = TEXT[lang].taskImport;
    const inputs = [['invalid UTF-8', Buffer.concat([Buffer.from('[{"content":"x', 'utf8'), Buffer.from([0xff, 0xfe]), Buffer.from('","status":"pending"}]', 'utf8')]), 'E_TEXT_ENCODING'],
      ['invalid JSON', Buffer.from('[{"content": "x",', 'utf8'), 'invalid_task_import']];
    for (const [kind, bytes, code] of inputs) {
      const file = path.join(arena, `import-${copies}-${code}.json`);
      fs.writeFileSync(file, bytes);
      for (const json of [false, true]) {
        const label = `task sync --from (${kind})${json ? ' --json' : ''}`;
        const r = run(['task', 'sync', '--from', file, '--path', P, ...(json ? ['--json'] : [])]);
        let got;
        try { got = json ? [r.status, JSON.parse(r.stdout), r.stderr] : [r.status, r.stdout, r.stderr]; } catch { got = [r.status, r.stdout, r.stderr]; }
        assert.deepStrictEqual(got, json ? [1, { ok: false, error: message, code }, ''] : [1, '✗ ' + message + '\n', ''], label + ': ' + show(r));
        assert.strictEqual(HANGUL.test(withoutPaths(r.stdout + r.stderr, P)), lang === 'ko', label + ': the output is not ' + lang + '\n' + r.stdout + r.stderr);
        assert.ok(fs.readFileSync(tracker(P)).equals(before) && fs.readFileSync(file).equals(bytes), label + ': the refused import changed a file');
      }
    }
  });

  test(`${lang}: mode set, which puts the managed-text message inside its own, gives that part in the project language`, () => {
    // Another module's wrapper: mode's own --json text is Korean in every project (T-0164), while the managed-text part
    // follows the project, so an English project keeps the English text it had there.
    const P = fresh(lang), agents = path.join(P, 'AGENTS.md');
    fs.writeFileSync(agents, Buffer.concat([fs.readFileSync(agents), Buffer.from([0xff, 0xfe])]));
    const before = fs.readFileSync(agents), message = TEXT[lang].encoding(agents);
    const t = run(['mode', 'set', 'minimal', '--path', P]);
    assert.deepStrictEqual([t.status, t.stdout.endsWith(' ' + message + '\n'), t.stderr], [1, true, ''], show(t));
    assert.strictEqual(HANGUL.test(withoutPaths(t.stdout, P)), lang === 'ko', 'the text output is not ' + lang + '\n' + t.stdout);
    const j = run(['mode', 'set', 'minimal', '--path', P, '--json']);
    let doc = {};
    try { doc = JSON.parse(j.stdout); } catch {}
    assert.deepStrictEqual([j.status, doc.causeCode, String(doc.error).endsWith(' ' + message)], [1, 'E_TEXT_ENCODING', true], show(j));
    assert.ok(fs.readFileSync(agents).equals(before), 'the refused mode change changed AGENTS.md');
  });

  test(`${lang}: writeProgressRows called directly: both row-loss messages and the missing-snapshot one keep their codes`, () => {
    const { P, rows } = project(lang);
    const file = tracker(P);
    assert.ok(rows >= 2, 'needs two product rows, has ' + rows);
    assert.deepStrictEqual(direct('row-loss', P), {
      snapshot: { code: 'E_TEXT_SNAPSHOT', message: TEXT[lang].snapshot },
      fewer: { code: 'E_PROGRESS_ROW_LOSS', message: TEXT[lang].shrink(file, rows, 0, rows - 1) },
      shrink: { code: 'E_PROGRESS_ROW_LOSS', message: TEXT[lang].shrink(file, rows, 1, rows - 2) },
      malformed: { code: 'E_PROGRESS_ROW_LOSS', message: TEXT[lang].rowLoss(file, rows + 1, rows) },
      control: null,
    });
  });
}

test('managed-text: every message in Korean only when the registered language is ko; codes do not change', () => {
  const dir = path.join(arena, 'managed');
  fs.mkdirSync(dir);
  const file = path.join(dir, 'managed.md');
  assert.deepStrictEqual(direct('managed-text', dir), {
    unset: managed('en', file), ko: managed('ko', file), en: managed('en', file), throws: managed('en', file), value: managed('en', file),
    unchanged: 'text\n',
  });
});

console.log(`tracker write language: ${passed}/${passed + failed}`);
if (filter && !ran) console.error(`--match ${JSON.stringify(filter)} selected no test`);
try { removeTree(arena, { recursive: true, force: true }); } catch {}
if (failed || (filter ? ran === 0 : ran !== 15)) process.exitCode = 1;
