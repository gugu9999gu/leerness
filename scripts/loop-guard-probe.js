#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

// Loop guard (.leerness/loop-guard-design-20261025.md section 7.1): rows LG1-LG7, LG9, LG10, LG12 (U1a) and LG8, LG11 (U1b).
// Every row runs real CLI processes in temp repositories (never the package root), passes --path and cwd, and starts from a clean
// environment. A crashed child (stack, engine error text, signal, spawn error) is a HARNESS-ERROR (exit 3), never an assertion result. So is an
// exit 1 whose whole response (stdout and stderr) holds an error line that is not one of the loop's own diagnostics (or the one the call said
// to expect), and so is an unexpected exception of an in-process call. A refusal document, a loop answer or those diagnostics alone are answers.
// The classifier is a tripwire and cannot prove where an error line came from. It does not cover a crash that prints no error line after valid
// loop output, and it ACCEPTS a crash whose message starts like a loop diagnostic anywhere in an otherwise accepted response (for example after
// valid STOP output): a known limit, shown by a control in the mutant runner, not a guarantee that such a crash is never counted as a kill.
// Usage: node scripts/loop-guard-probe.js [--row LGn]
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const { removeTree } = require('./temp-cleanup');
const BIN = path.resolve(__dirname, '..', 'bin', 'leerness.js');
for (const k of Object.keys(process.env)) if (/^GIT_|^LEERNESS_(?!TEMP_RECORD$)/i.test(k)) delete process.env[k];
Object.assign(process.env, { LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_PATH_CHECK: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' });
const arena = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-loop-guard-'));

class Harness extends Error {}
const ENGINE = /TypeError|ReferenceError|SyntaxError|RangeError|Cannot read propert|is not a function|is not defined|is not iterable|Maximum call stack|Unexpected (token|end)|in JSON at position|Invalid time value|is not a constructor|Cannot (destructure|convert|set propert|access)/;
const STACK = /^\s+at .+:\d+:\d+\)?\s*$/m;
// The loop's own text-mode refusals (the error table of lib/loop-guard.js in en and ko) and the shared runtime layout and lock refusals it can
// surface: a product answer when they are the only error lines, so a mutant that makes a row's call refuse fails an assertion; any other
// exit 1 text (a thrown Error's message) is not, unless it starts like one of these (see the limit above).
const DIAGNOSTIC = /^(✗|⚠) (Invalid argument: |No such loop: |Loop L-\d+ (is closed|is not stopped|was already extended|already stores)|No more loop ids|Loop ledger (is corrupt|exceeds)|Lock acquisition failed|A part of the loop ledger|The loop ledger |LOOP WRITE UNCERTAIN|This change would produce a loop ledger|Runtime layout blocks writes|Lock ownership could not be confirmed|인자가 올바르지 않습니다|이 변경은 이 버전이|락 소유권을 확인하지 못해|락 획득 실패|해당 loop 가 없습니다|Loop L-\d+ (는|에는)|더 이상 loop id|Loop ledger (가|의|경로|한도|위치)|작업하는 동안 Loop ledger)/m;
function classify(args, r, { allow = [], expect = null } = {}) {
  const where = `child [${args.join(' ')}]`, text = r.out + r.err;
  if (r.error || r.signal) throw new Harness(`${where}: ${r.error ? r.error.code || r.error.message : r.signal}`);
  if (STACK.test(r.err) || ENGINE.test(text)) throw new Harness(`${where}: crash shape: ${text.slice(0, 300)}`);
  let json = null;
  if (args.includes('--json')) { try { json = JSON.parse(r.out); } catch { throw new Harness(`${where}: stdout is not one JSON document: ${r.out.slice(0, 200)}`); } }
  if (![0, 1, 3, ...allow].includes(r.status)) throw new Harness(`${where}: exit ${r.status}`);
  if (r.status === 1) {   // whole-response recognition: an error line the answer does not account for means a crash came before or after it
    const all = text.split(/\r?\n/), errs = all.filter(l => /^(✗|⚠) /.test(l)), known = errs.every(l => DIAGNOSTIC.test(l) || !!(expect && expect.test(l)));
    const answer = known && (json ? (json.ok === false && typeof json.code === 'string' && json.code !== 'error') || json.schema === 'leerness.loop/v1' : errs.length > 0 || all.some(l => /^LOOP /.test(l)));
    if (!answer) throw new Harness(`${where}: exit 1 whose whole response is not a structured refusal, a loop answer or the loop's own diagnostics (an error line it does not account for): ${text.slice(0, 200)}`);
  }
  return { status: r.status, out: r.out, text, json };
}
function run(args, o = {}) {
  const r = cp.spawnSync(process.execPath, [BIN, ...args], { cwd: o.cwd, env: { ...process.env, LEERNESS_LANG: o.lang || 'en', ...o.env }, input: o.input || '', encoding: 'utf8', timeout: 120000, windowsHide: true });
  return classify(args, { status: r.status, signal: r.signal, error: r.error, out: r.stdout || '', err: r.stderr || '' }, o);
}
const loop = (dir, args, o = {}) => run(['loop', ...args, '--path', dir], { cwd: dir, ...o });
const loopAsync = (dir, args) => new Promise(resolve => {
  const argv = ['loop', ...args, '--path', dir, '--json'], c = cp.spawn(process.execPath, [BIN, ...argv], { cwd: dir, env: { ...process.env, LEERNESS_LANG: 'en' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '', err = '';
  c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { err += d; });
  c.on('error', error => resolve({ argv, error, out, err }));
  c.on('close', (status, signal) => resolve({ argv, status, signal, out, err }));
});

const git = (cwd, ...a) => { const r = cp.spawnSync('git', a, { cwd, env: process.env, encoding: 'utf8', windowsHide: true }); if (r.status !== 0) throw new Harness(`fixture git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
let seq = 0;
function repo(label, withGit = true) {
  const dir = path.join(arena, `${++seq}-${label}`);
  fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.leerness', 'HARNESS_VERSION'), '1.36.305\n');
  if (withGit) { for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.name', 'probe'], ['config', 'user.email', 'probe@example.invalid'], ['config', 'core.autocrlf', 'false'], ['add', '-A'], ['commit', '-qm', 'fixture']]) git(dir, ...a); }
  else if (cp.spawnSync('git', ['rev-parse'], { cwd: dir, env: process.env }).status === 0) throw new Harness('fixture: the non-git project lies inside a repository');
  return dir;
}
function worktree(dir, name) {
  const wt = path.join(arena, `${seq}-${name}`);
  git(dir, 'worktree', 'add', '-q', '-b', name, wt);
  if (git(wt, 'rev-parse', '--path-format=absolute', '--git-dir') === git(wt, 'rev-parse', '--path-format=absolute', '--git-common-dir')) throw new Harness('fixture: not a linked worktree');
  return wt;
}
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const commonDir = dir => path.resolve(git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
const ledgerDir = dir => path.join(commonDir(dir), 'leerness', 'control', 'projects', 'project-' + sha('.'));
const ledgerFile = dir => path.join(ledgerDir(dir), 'loop-ledger.json');
const readLedger = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { loops: [], rev: NaN }; } };
const slurp = f => (fs.existsSync(f) ? fs.readFileSync(f) : null);
const sameBytes = (a, b) => a === b || (!!a && !!b && a.equals(b));
const loopOf = (dir, id = 'L-0001') => readLedger(ledgerFile(dir)).loops.find(l => l.id === id) || { rounds: [], decisions: [] };
const lines = r => r.out.replace(/\r/g, '').split('\n').map(l => l.trimEnd());
const norm = l => l.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}Z/g, '<T>').replace(/^(Opened|시작): .*$/, '$1: <times>');
const snap = dir => {
  const m = {};
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isSymbolicLink()) m[f] = 'link'; else if (e.isDirectory()) { m[f] = 'dir'; walk(f); } else { const s = fs.statSync(f); m[f] = `${s.size}:${s.mtimeMs}:${sha(fs.readFileSync(f))}`; } } };
  walk(dir);
  return JSON.stringify(m);
};

let bad = [];
const skips = [];
const check = (label, ok, detail = '') => { if (!ok) bad.push(`  - ${label}${detail === '' ? '' : ' :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300)}`); };
const is = (r, status, code) => r.status === status && (code === undefined || (r.json && r.json.code === code));
const same = (label, r, status, expected) => {
  const got = lines(r).map(norm).filter(Boolean);
  const at = expected.findIndex((l, i) => l !== got[i]);
  check(label, r.status === status && at < 0 && got.length === expected.length, `exit ${r.status} (want ${status}); ${at < 0 ? `${got.length} lines (want ${expected.length})` : `line ${at}: got [${got[at]}] want [${expected[at]}]`}`);
};
const rows = {};
const row = (id, title, fn) => { rows[id] = { title, fn }; };

// ---- exact texts (design 4.3), both languages
const X = {
  en: {
    open: (id, s) => `LOOP ${id} opened: "${s}" (cap 3). After each completed failed cycle: leerness loop round ${id} --spot <key>`,
    round: (id, n, spot, k) => `LOOP ${id} round ${n} of 3 recorded (spot ${spot}). ${k} left before STOP.`,
    stop: (id, s, why) => [`LOOP STOP ${id} "${s}": ${why}. Owner decision required; a project rule is not a decision.`, 'Stop work on this subject, continue other authorized work, show the owner this card and record the answer with leerness loop decide.'],
    why: 'round 3 of 3',
    card: (id, s, rowLines, findings) => [`LOOP CARD ${id} - owner decision required`, `Subject: "${s}"`, 'State: stopped (round 3 of 3) | extensions 0 of 2', 'Opened: <times>', 'Rounds:', ...rowLines, findings,
      'Choices: accept-residual, cut, redesign, park, extend --add 1|2', 'Meaning: accept-residual = finish with the remaining findings known, cut = drop the remaining part from scope, redesign = change the approach, park = defer it, extend = allow more rounds', `Record the owner's answer: leerness loop decide ${id} --choice <choice> --quote "<owner's words>"`],
    rowLine: (n, spot, f) => `  ${n}  <T>  spot ${spot}  findings ${f}`, findings: '4 -> 2 -> 3 (not falling)', findingsLabel: 'Findings: ', scope: 'Loop ledger: shared by all worktrees of this repository', local: 'Loop ledger: project-local (not shared across worktrees)',
    existing: 'LOOP L-0001 is already open for this subject (2/3 rounds); keep using L-0001.', repeat: 'REPEAT spot s1 (rounds 1, 2): change the structure; do not add a third patch.',
    extended: 'LOOP L-0001 extended by 1 (cap 4). Owner quote recorded.', passed: 'LOOP L-0001 closed: passed at round 4 of 4.', cut: 'LOOP L-0002 closed: cut. Owner quote recorded.',
  },
  ko: {
    open: (id, s) => `LOOP ${id} 열림: "${s}" (한도 3회). 끝난 실패 회차마다: leerness loop round ${id} --spot <key>`,
    round: (id, n, spot, k) => `LOOP ${id} ${n}/3회 기록 (spot ${spot}). STOP 까지 ${k}회 남음.`,
    stop: (id, s, why) => [`LOOP STOP ${id} "${s}": ${why}. 소유자 결정이 필요합니다. 프로젝트 룰은 결정이 아닙니다.`, '이 주제의 작업을 멈추고 다른 승인된 작업을 계속하며, 이 카드를 소유자에게 보여 주고 답을 leerness loop decide 로 기록하세요.'],
    why: '3/3회 도달',
    card: (id, s, rowLines, findings) => [`LOOP CARD ${id} - 소유자 결정 필요`, `주제: "${s}"`, '상태: 중단 (3/3회) | 연장 0/2', '시작: <times>', '회차:', ...rowLines, findings,
      '선택지: accept-residual, cut, redesign, park, extend --add 1|2', '뜻: accept-residual=남은 지적을 알고 이대로 마침, cut=남은 부분을 범위에서 뺌, redesign=접근을 바꿔 다시 설계, park=나중으로 미룸, extend=회차를 더 허용', `소유자 답 기록: leerness loop decide ${id} --choice <choice> --quote "<owner's words>"`],
    rowLine: (n, spot, f) => `  ${n}  <T>  spot ${spot}  지적 ${f}`, findings: '4 -> 2 -> 3 (줄지 않음)', findingsLabel: '지적 수: ', scope: 'Loop ledger: 이 저장소의 모든 worktree 가 공유', local: 'Loop ledger: 프로젝트 로컬 (worktree 간 공유 안 됨)',
    existing: 'LOOP L-0001 이 이 주제로 이미 열려 있습니다 (2/3회). L-0001 을 계속 쓰세요.', repeat: 'REPEAT spot s1 (1, 2회차): 구조를 바꾸고 세 번째 땜질을 하지 마세요.',
    extended: 'LOOP L-0001 1회 연장 (한도 4). 소유자 원문을 기록했습니다.', passed: 'LOOP L-0001 종료: 4/4회차에 통과.', cut: 'LOOP L-0002 종료: cut. 소유자 원문을 기록했습니다.',
  },
};

// Unicode format characters (\p{Cf}): bidi controls, zero-width space and joiner, byte-order mark, tag characters, soft hyphen
const FMT = Object.fromEntries([['bidi', 0x202e], ['zwsp', 0x200b], ['bom', 0xfeff], ['tag', 0xe0001], ['shy', 0xad], ['zwj', 0x200d]].map(([k, c]) => [k, String.fromCodePoint(c)]));
// ---- LG1
row('LG1', 'Grammar', () => {
  const dir = repo('lg1'), ledger = ledgerFile(dir), a = n => 'a'.repeat(n), R = ['round', 'L-0001', '--spot', 'a'];
  check('fixture: open L-0001', loop(dir, ['open', 'grammar subject']).status === 0);
  const before = slurp(ledger);
  const invalid = [['no subject', ['open']], ['121-char subject', ['open', a(121)]], ['control character', ['open', `a${String.fromCharCode(7)}b`]],
    ['round without --spot', ['round', 'L-0001']], ['spot with a space', ['round', 'L-0001', '--spot', 'A B']], ['--findings -1', [...R, '--findings', '-1']],
    ['--findings 1e3', [...R, '--findings', '1e3']], ['--findings 01', [...R, '--findings', '01']], ['--findings 1000', [...R, '--findings', '1000']],
    ['duplicate --spot', [...R, '--spot', 'b'], 'duplicate_flag'], ['--result maybe', [...R, '--result', 'maybe']], ['--result go with --spot', ['round', 'L-0001', '--result', 'go', '--spot', 'x']],
    ['121-char note', [...R, '--note', a(121)]], ['decide without --quote', ['decide', 'L-0001', '--choice', 'cut']], ['301-char quote', ['decide', 'L-0001', '--choice', 'cut', '--quote', a(301)]],
    ['unknown choice', ['decide', 'L-0001', '--choice', 'nope', '--quote', 'q']], ['extend without --add', ['decide', 'L-0001', '--choice', 'extend', '--quote', 'q']],
    ['--add 3', ['decide', 'L-0001', '--choice', 'extend', '--add', '3', '--quote', 'q']], ['--add 1 with cut', ['decide', 'L-0001', '--choice', 'cut', '--add', '1', '--quote', 'q']],
    ['unknown subcommand', ['bogus']], ['unknown id L-9999', ['round', 'L-9999', '--spot', 'a'], 'loop_not_found'], ['--max', [...R, '--max', '3'], 'unknown_flag']];
  for (const [label, argv, code = 'loop_usage'] of invalid) { const r = loop(dir, [...argv, '--json']); check(`invalid argv exits 1 ${code}: ${label}`, is(r, 1, code), r.text); }
  for (const [name, ch] of Object.entries(FMT)) for (const [field, argv] of [['subject', ['open', `a${ch}b`]], ['--note', [...R, '--note', `a${ch}b`]], ['--quote', ['decide', 'L-0001', '--choice', 'extend', '--add', '1', '--quote', `a${ch}b`]]]) {
    const r = loop(dir, [...argv, '--json']); check(`format character (${name}) in ${field}: exit 1 loop_usage`, is(r, 1, 'loop_usage') && !!r.json?.error?.includes(field), r.text);
  }
  for (const lang of ['en', 'ko']) {   // the first --spot a Korean-speaking agent writes is Hangul: the refusal says what a key is
    const hangul = loop(dir, ['round', 'L-0001', '--spot', '설계문서', '--findings', '5'], { lang }), other = loop(dir, ['round', 'L-0001', '--spot', 'a', '--findings', '-1'], { lang });
    check(`${lang}: a Hangul --spot is refused with the key format`, hangul.status === 1 && hangul.text.includes(lang === 'en' ? 'Invalid argument: --spot (lowercase ASCII key, for example design-doc)' : '인자가 올바르지 않습니다: --spot (영문 소문자·숫자 키, 예: design-doc)'), hangul.text);
    check(`${lang}: another invalid argument has no key format hint`, other.status === 1 && !other.text.includes('design-doc'), other.text);
  }
  check('invalid argv leave the ledger bytes unchanged', sameBytes(slurp(ledger), before));
  for (const [id, code] of [['L-10000', 'loop_not_found'], ['L-9999', 'loop_not_found'], ['L-001', 'loop_usage']]) { const r = loop(dir, ['status', id, '--json']); check(`id ${id} is ${code}`, is(r, 1, code), r.text); }
  const valid = [['status', 'L-0001'], ['status', 'L-0001', '--strict-exit'], ['round', 'L-0001', '--spot', 'A', '--findings', '0', '--note', 'n'], ['round', 'L-0001', '--spot', 'b', '--findings', '999'], ['open', a(120)], ['open', '한글 주제 (괄호) — “따옴표”'], ['open', `no${String.fromCharCode(0xa0)}break space`]];
  for (const argv of valid) { const r = loop(dir, argv); check(`valid argv exits 0: ${argv.join(' ') || '(bare)'}`, r.status === 0, `exit ${r.status}: ${r.text}`); }
  check('spot keys are lowercased', loopOf(dir).rounds[0]?.spot === 'a');
});

// ---- LG2
function lg2(lang) {
  const x = X[lang], o = { lang }, dir = repo(`lg2-${lang}`), S = 'Release gate checker', j = (...a) => loop(dir, [...a, '--json'], o).json;
  same(`${lang}: open exits 0 with the exact opened line`, loop(dir, ['open', S], o), 0, [x.open('L-0001', S)]);
  same(`${lang}: round 1 exits 0 with the exact round line`, loop(dir, ['round', 'L-0001', '--spot', 'checker:regex', '--findings', '4'], o), 0, [x.round('L-0001', 1, 'checker:regex', 2)]);
  check(`${lang}: counted is 1 after round 1`, j('status', 'L-0001')?.loops?.[0]?.counted === 1);
  same(`${lang}: round 2 exits 0 with the exact round line`, loop(dir, ['round', 'L-0001', '--spot', 'checker:classify', '--findings', '2'], o), 0, [x.round('L-0001', 2, 'checker:classify', 1)]);
  check(`${lang}: counted is 2 after round 2`, j('status', 'L-0001')?.loops?.[0]?.counted === 2);
  const rowLines = [x.rowLine(1, 'checker:regex', 4), x.rowLine(2, 'checker:classify', 2), x.rowLine(3, 'checker:parse', 3)];
  same(`${lang}: round 3 exits 3 with the exact STOP lines and card`, loop(dir, ['round', 'L-0001', '--spot', 'checker:parse', '--findings', '3'], o), 3,
    [...x.stop('L-0001', S, x.why), ...x.card('L-0001', S, rowLines, x.findingsLabel + x.findings)]);
  const r4 = loop(dir, ['round', 'L-0001', '--spot', 'checker:parse'], o);
  check(`${lang}: round 4 exits 3 with the STOP lines`, r4.status === 3 && JSON.stringify(lines(r4).filter(Boolean).slice(0, 2)) === JSON.stringify(x.stop('L-0001', S, x.why)), r4.text);
  const stored = loopOf(dir).rounds;
  check(`${lang}: round 4 is stored with overCap true`, stored.length === 4 && stored[3].overCap === true && stored[2].overCap === false, JSON.stringify(stored[3]));
  check(`${lang}: counted stays 3 after the over-cap round`, j('status', 'L-0001')?.loops?.[0]?.counted === 3);
  check(`${lang}: status exits 0`, loop(dir, ['status'], o).status === 0);
  check(`${lang}: status --strict-exit exits 3`, loop(dir, ['status', '--strict-exit'], o).status === 3);
  const stat = loop(dir, ['status', 'L-0001'], o), statLines = lines(stat).filter(Boolean);
  check(`${lang}: status of a stopped loop prints the scope line, the STOP lines, then the card`, stat.status === 0 && JSON.stringify(statLines.slice(0, 3)) === JSON.stringify([x.scope, ...x.stop('L-0001', S, x.why)]) && !!statLines[3] && statLines[3].startsWith('LOOP CARD L-0001'), stat.text);
}
row('LG2', 'Cap and STOP', () => { lg2('en'); lg2('ko'); });

// ---- LG3
row('LG3', 'Shared and non-blocking', () => {
  const main = repo('lg3'), wt1 = worktree(main, 'wt1'), wt2 = worktree(main, 'wt2'), S = X.en.scope;
  const id = loop(wt1, ['open', 'shared subject', '--json']).json?.loop?.id || 'L-0001';
  check('(a) round from the second worktree', loop(wt2, ['round', id, '--spot', 'two']).status === 0);
  check('(a) round from the main worktree', loop(main, ['round', id, '--spot', 'one']).status === 0);
  for (const [name, d] of [['main', main], ['wt1', wt1], ['wt2', wt2]]) {
    const r = loop(d, ['status', id, '--json']), s = loop(d, ['status']);
    check(`(a) ${name} agrees on id, counts and scope`, r.status === 0 && r.json?.loops?.[0]?.id === id && r.json?.loops?.[0]?.counted === 2 && r.json?.loops?.[0]?.rounds === 2 && r.json?.ledger?.scope === 'git-common' && lines(s).includes(S), r.text);
  }
  check('(a) the ledger is the one file under the common dir', fs.existsSync(ledgerFile(main)) && readLedger(ledgerFile(main)).loops.length === 1);
  const plain = repo('lg3-plain', false), file = path.join(plain, '.leerness', 'loop-ledger.json');
  check('(b) non-git: open, round and status exit 0', loop(plain, ['open', 'plain subject']).status === 0 && loop(plain, ['round', 'L-0001', '--spot', 'a']).status === 0);
  const ps = loop(plain, ['status']), pj = loop(plain, ['status', '--json']);
  check('(b) non-git: the ledger is .leerness/loop-ledger.json with the project-local text', fs.existsSync(file) && lines(ps).includes(X.en.local) && pj.json?.ledger?.scope === 'project-local', ps.text);
  const o = loop(main, ['open', 'non blocking']), t = run(['task', 'add', 'x', '--no-review', '--path', main], { cwd: main });
  check('(c) open exits 0 and a following task add exits 0', o.status === 0 && t.status === 0, `${o.status} ${t.status} ${t.text}`);
});

// ---- LG4 (stress, not proof)
row('LG4', 'Concurrency (stress)', async () => {
  const main = repo('lg4'), wt = worktree(main, 'wt4');
  check('fixture: open', loop(main, ['open', 'stress subject']).status === 0);
  const rev = readLedger(ledgerFile(main)).rev;
  const done = await Promise.all(['s1', 's2', 's3', 's4', 's5', 's6'].map((s, i) => loopAsync(i % 2 ? wt : main, ['round', 'L-0001', '--spot', s])));
  const results = done.map(r => classify(r.argv, r));
  check('two exits 0 and four exits 3, no exit 1', results.map(r => r.status).sort().join() === '0,0,3,3,3,3', results.map(r => r.status).join());
  const led = readLedger(ledgerFile(main)), rounds = loopOf(main).rounds;
  check('rounds 1..6 are stored exactly once', rounds.map(r => r.n).join() === '1,2,3,4,5,6' && new Set(rounds.map(r => r.spot)).size === 6, JSON.stringify(rounds.map(r => [r.n, r.spot])));
  check('rev advanced by exactly 6', led.rev === rev + 6, `rev ${rev} -> ${led.rev}`);
});

// ---- LG5
row('LG5', 'Decisions', () => {
  const dir = repo('lg5'), j = (argv, o) => loop(dir, [...argv, '--json'], o);
  const open = s => j(['open', s]).json?.loop?.id || 'L-0001', rnd = (id, spot) => j(['round', id, '--spot', spot]), dec = (id, ...a) => j(['decide', id, ...a]);
  const A = open('alpha');
  let r = dec(A, '--choice', 'extend', '--add', '1', '--quote', 'q');
  check('extend on an open loop: exit 1 loop_not_stopped', is(r, 1, 'loop_not_stopped'), r.text);
  rnd(A, 'a1'); rnd(A, 'a2');
  check('round 3 exits 3', rnd(A, 'a3').status === 3);
  r = rnd(A, 'a4');
  check('round 4 after STOP exits 3 and is over cap', r.status === 3 && r.json?.round?.overCap === true, r.text);
  r = j(['round', A, '--result', 'go']);
  check('--result go on a stopped loop exits 3 and records nothing', r.status === 3 && j(['status', A]).json?.loops?.[0]?.rounds === 4, r.text);
  r = dec(A, '--choice', 'extend', '--add', '2', '--quote', 'one more look');
  check('extend +2 after STOP: cap is 5 (3 counted + 2) and the loop is open again', r.status === 0 && r.json?.loop?.cap === 5 && r.json?.loop?.state === 'open' && r.json?.loop?.extensions === 1, r.text);
  const card = lines(loop(dir, ['status', A]));
  check('status shows the owner quote under a Recorded heading', card.includes('Recorded owner decisions:') && card.some(l => l.includes('one more look')), card.join(' / '));
  check('counted round 4 exits 0', rnd(A, 'a5').status === 0);
  check('counted round 5 exits 3', rnd(A, 'a6').status === 3);
  const B = open('beta');
  rnd(B, 'x'); rnd(B, 'x'); r = rnd(B, 'x');
  check('the third failure at one spot is a same_spot STOP', r.status === 3 && r.json?.reason === 'same_spot', r.text);
  check('extend +1 after same_spot exits 0', dec(B, '--choice', 'extend', '--add', '1', '--quote', 'q1').status === 0);
  r = rnd(B, 'x');
  check('the next failure at that spot exits 3 at once (the spot is not reset)', r.status === 3 && r.json?.reason === 'same_spot', r.text);
  check('a second extend exits 0', dec(B, '--choice', 'extend', '--add', '1', '--quote', 'q2').status === 0);
  rnd(B, 'x');
  r = dec(B, '--choice', 'extend', '--add', '1', '--quote', 'q3');
  check('a third extend exits 1 loop_extend_limit', is(r, 1, 'loop_extend_limit'), r.text);
  const Q = '그만, 범위를 줄입니다 "A"';
  r = dec(B, '--choice', 'cut', '--quote', Q);
  check('cut closes the loop', r.status === 0 && r.json?.loop?.state === 'closed' && r.json?.loop?.outcome === 'cut', r.text);
  const stored = loopOf(dir, B).decisions.at(-1) || {};
  check('the quote is stored byte-identical', stored.quote === Q && stored.choice === 'cut', JSON.stringify(stored));
  r = rnd(B, 'y');
  check('round on a closed loop exits 1 loop_closed', is(r, 1, 'loop_closed'), r.text);
  const C = open('gamma');
  r = j(['round', C, '--result', 'go']);
  check('--result go on an open loop closes it as passed (round 1, exit 0)', r.status === 0 && r.json?.round?.n === 1 && r.json?.round?.result === 'go' && r.json?.loop?.state === 'closed' && r.json?.loop?.outcome === 'passed', r.text);
  // the stored-round limit: an extension that cannot be used up is refused, so the STOP is never forgotten
  const lim = repo('lg5-limit'), ext = (id, add) => loop(lim, ['decide', id, '--choice', 'extend', '--add', String(add), '--quote', 'q', '--json']), file = ledgerFile(lim);
  seed(lim, [stoppedLoop(1, 16), stoppedLoop(2, 15)]);
  const full = slurp(file), sh = run(['handoff', '--path', lim, '--compact'], { cwd: lim });
  r = ext('L-0001', 1);
  check('16 stored rounds: extend +1 exits 1 loop_extend_round_limit and changes nothing', is(r, 1, 'loop_extend_round_limit') && sameBytes(slurp(file), full), r.text);
  check('16 stored rounds: the card offers no extend; strict status, a repeated open and the handoff summary still show the STOP', lines(loop(lim, ['status', 'L-0001'])).includes('Choices: accept-residual, cut, redesign, park') && loop(lim, ['status', 'L-0001', '--strict-exit']).status === 3 && loop(lim, ['open', 's1']).status === 3 && lines(sh).some(l => l.startsWith('LOOP STOP L-0001 ')), sh.text);
  const meaningFull = lines(loop(lim, ['status', 'L-0001'])).find(l => l.startsWith('Meaning: '));
  check('16 stored rounds: the meaning line explains the four choices and names no extend', !!meaningFull && meaningFull.includes('accept-residual = finish with the remaining findings known') && meaningFull.endsWith('park = defer it'), meaningFull);
  check('15 stored rounds: the card offers extend --add 1 only', lines(loop(lim, ['status', 'L-0002'])).includes('Choices: accept-residual, cut, redesign, park, extend --add 1'));
  check('15 stored rounds: the meaning line also explains extend', lines(loop(lim, ['status', 'L-0002'])).some(l => l.startsWith('Meaning: ') && l.endsWith(', extend = allow more rounds')));
  r = ext('L-0002', 2);
  check('15 stored rounds: extend +2 exits 1 loop_extend_round_limit', is(r, 1, 'loop_extend_round_limit'), r.text);
  check('15 stored rounds: extend +1 exits 0 and the next round stops by cap', ext('L-0002', 1).status === 0 && loop(lim, ['round', 'L-0002', '--spot', 'z', '--json']).json?.reason === 'cap_reached');
});

// ---- LG6
row('LG6', 'Repeat and navigation', () => {
  const dir = repo('lg6'), j = (argv) => loop(dir, [...argv, '--json']);
  loop(dir, ['open', 'Release Gate']);
  loop(dir, ['round', 'L-0001', '--spot', 's1']); loop(dir, ['round', 'L-0001', '--spot', 's1']);   // the exact REPEAT and existing lines, en and ko, are judged by LG9
  let r = j(['open', '  RELEASE   gate ']);
  check('the json says existing, same id, and no loop was created', r.status === 0 && r.json?.existing === true && r.json?.loop?.id === 'L-0001' && readLedger(ledgerFile(dir)).loops.length === 1, r.text);
  loop(dir, ['round', 'L-0001', '--spot', 's2']);
  r = loop(dir, ['open', 'release gate']);
  check('open with a stopped loop subject exits 3 with that loop card', r.status === 3 && lines(r).includes('LOOP CARD L-0001 - owner decision required'), r.text);
  check('no loop was created', readLedger(ledgerFile(dir)).loops.length === 1);
  check('close the loop', loop(dir, ['decide', 'L-0001', '--choice', 'park', '--quote', 'parked']).status === 0);
  r = j(['open', 'release gate']);
  check('after the loop is closed the same subject opens a new loop', r.status === 0 && r.json?.existing === false && r.json?.loop?.id === 'L-0002', r.text);
});

// ---- LG7
const ledgerV1 = loops => ({ schema: 'leerness.loop-ledger/v1', createdAt: '2026-10-25T00:00:00.000Z', rev: 1, nextId: loops.length + 1, loops });
const TS = '2026-10-25T00:00:00.000Z';
const emptyLoop = n => ({ id: `L-${String(n).padStart(4, '0')}`, subject: `s${n}`, subjectKey: `s${n}`, openedAt: TS, cap: 3, extensions: 0, state: 'open', stop: null, rounds: [], decisions: [], closedAt: null, outcome: null });
const mkRound = (n, extra) => ({ n, at: TS, result: 'no-go', spot: `s${n}`, findings: null, note: null, overCap: false, ...extra });
const stoppedLoop = (n, stored) => ({ ...emptyLoop(n), state: 'stopped', stop: { reason: 'cap_reached', round: 3 }, rounds: Array.from({ length: stored }, (_, i) => mkRound(i + 1, { overCap: i >= 3 })) });
const seed = (dir, loops, edit) => { const v = ledgerV1(loops); if (edit) edit(v); fs.mkdirSync(ledgerDir(dir), { recursive: true }); fs.writeFileSync(ledgerFile(dir), JSON.stringify(v, null, 1) + '\n'); };
row('LG7', 'Ledger safety', () => {
  const dir = repo('lg7'), ledger = ledgerFile(dir);
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  const bad7 = [['"{"', Buffer.from('{'), 'loop_ledger_corrupt'], ['a v2 schema', Buffer.from(JSON.stringify({ ...ledgerV1([]), schema: 'leerness.loop-ledger/v2' })), 'loop_ledger_corrupt'],
    ['invalid UTF-8', Buffer.from([0xff, 0xfe, 0x7b, 0x7d]), 'loop_ledger_corrupt'], ['262145 bytes', Buffer.alloc(262145, 0x20), 'loop_ledger_too_large']];
  for (const [label, bytes, code] of bad7) {
    fs.writeFileSync(ledger, bytes);
    const mtime = fs.statSync(ledger).mtimeMs;
    for (const argv of [['open', 'x'], ['round', 'L-0001', '--spot', 'a'], ['status']]) { const r = loop(dir, [...argv, '--json']); check(`${label}: ${argv[0]} exits 1 ${code}`, is(r, 1, code), r.text); }
    check(`${label}: bytes and mtime unchanged`, sameBytes(slurp(ledger), bytes) && fs.statSync(ledger).mtimeMs === mtime);
  }
  seed(dir, [emptyLoop(1)]);
  const outside = path.join(arena, 'lg7-outside');
  fs.mkdirSync(outside);
  const unsafe = label => {
    const before = snap(outside);
    for (const argv of [['open', 'x'], ['round', 'L-0001', '--spot', 'a'], ['status']]) { const r = loop(dir, [...argv, '--json']); check(`${label}: ${argv[0]} exits 1 loop_ledger_unsafe`, is(r, 1, 'loop_ledger_unsafe'), r.text); }
    check(`${label}: the outside tree is unchanged`, snap(outside) === before);
  };
  for (const name of ['control', 'projects']) {
    const link = name === 'control' ? path.join(commonDir(dir), 'leerness', 'control') : path.join(commonDir(dir), 'leerness', 'control', 'projects');
    fs.renameSync(link, link + '.moved');
    try { fs.symlinkSync(outside, link, 'junction'); unsafe(`${name} is a junction`); } finally { try { fs.rmdirSync(link); } catch { try { fs.unlinkSync(link); } catch {} } fs.renameSync(link + '.moved', link); }
  }
  fs.linkSync(ledger, ledger + '.alias');
  unsafe('the ledger has two hard links');
  fs.unlinkSync(ledger + '.alias');
  fs.renameSync(ledger, ledger + '.real');
  try { fs.symlinkSync(ledger + '.real', ledger, 'file'); unsafe('the ledger is a symlink'); fs.unlinkSync(ledger); } catch (e) { if (e.code === 'EPERM' || e.code === 'EACCES') skips.push(`LG7 file symlink: ${e.code}`); else throw e; } finally { fs.renameSync(ledger + '.real', ledger); }
  const full = repo('lg7-full');
  seed(full, Array.from({ length: 32 }, (_, i) => emptyLoop(i + 1)));
  const fullBytes = slurp(ledgerFile(full));
  const rf = loop(full, ['open', 'one more', '--json']);
  check('32 open loops and no closed one: open exits 1 loop_ledger_limit', is(rf, 1, 'loop_ledger_limit'), rf.text);
  check('the limit leaves the bytes unchanged', sameBytes(slurp(ledgerFile(full)), fullBytes));
  const fresh = repo('lg7-absent'), sb = snap(fresh), rs = loop(fresh, ['status']), rj = loop(fresh, ['status', '--json']);
  check('absent: status exits 0 and says nothing about a ledger', rs.status === 0 && !/LOOP|[Ll]edger/.test(rs.out), rs.text);
  check('absent: json state is absent with no loops', rj.status === 0 && rj.json?.ledger?.state === 'absent' && rj.json?.loops?.length === 0, rj.text);
  check('absent: nothing was created', snap(fresh) === sb && !fs.existsSync(path.join(commonDir(fresh), 'leerness')));
  const hook = repo('lg7-hook');
  seed(hook, [emptyLoop(1)]);
  const LG = require('../lib/loop-guard');
  const inproc = (dir, op, hooks) => { try { LG.mutate(dir, op, hooks); return null; } catch (e) { if (!(e instanceof LG.LoopError)) throw new Harness(`in-process mutate raised ${e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e}`); return e; } };
  const err = inproc(hook, { action: 'round', id: 'L-0001', result: 'no-go', spot: 'hook', findings: null, note: null }, { afterPublish() { throw new Error('injected after publication'); } });
  check('mutate with a throw after publication: loop_write_uncertain', !!err && err.code === 'loop_write_uncertain', err && (err.code || err.message));
  const stored = loopOf(hook).rounds;
  check('the ledger holds the round exactly once', stored.length === 1 && stored[0].spot === 'hook', JSON.stringify(stored));
  const st = loop(hook, ['status', 'L-0001', '--json']);
  check('status lists the round', st.status === 0 && st.json?.loops?.[0]?.rounds === 1, st.text);
  // review r2 F01: the writer publishes only what the reader accepts. The proposed ledger is made invalid by a hook, so the guard itself is judged
  const gate = repo('lg7-gate'), gf = ledgerFile(gate);
  seed(gate, [emptyLoop(1)]);
  const gBytes = slurp(gf);
  const gerr = inproc(gate, { action: 'round', id: 'L-0001', result: 'no-go', spot: 'gate', findings: null, note: null }, { beforePublish(v) { v.loops[0].cap = 99; } });
  check('mutate whose proposed ledger the reader would reject: loop_result_unreadable, bytes unchanged, no lock left, the next round exits 0', !!gerr && gerr.code === 'loop_result_unreadable' && sameBytes(slurp(gf), gBytes) && fs.readdirSync(path.dirname(gf)).join() === 'loop-ledger.json' && loop(gate, ['round', 'L-0001', '--spot', 'gate']).status === 0, gerr && (gerr.code || gerr.message));
  try { fs.rmSync(outside, { recursive: true }); } catch {}
  // the validator names the field of each impossible ledger (review r1: F01 text and time, F03 limit, F07 caps, decisions as a counter)
  const closed = (l, choice, d) => Object.assign(l, { state: 'closed', outcome: choice, closedAt: TS, decisions: [{ at: TS, choice, add: null, capAfter: null, quote: 'q', ...d }] });
  const corrupt = [['a bidi control in the subject', l => { l.subject = l.subjectKey = `a${FMT.bidi}b`; }, 'subject'], ['a zero-width space in a round note', l => { l.rounds = [mkRound(1, { note: `a${FMT.zwsp}b` })]; }, 'round.note'],
    ['a byte-order mark in a decision quote', l => closed(l, 'cut', { quote: `a${FMT.bom}b` }), 'decision.quote'], ['openedAt with newlines', l => { l.openedAt = '2026\n10\n26'; }, 'openedAt'],
    ['a date-only round time', l => { l.rounds = [mkRound(1, { at: '2026-10-25' })]; }, 'round.at'], ['a date-only closedAt', l => Object.assign(l, { state: 'closed', outcome: 'passed', closedAt: '2026-10-25' }), 'closedAt'],
    ['a loose decision time', l => closed(l, 'cut', { at: '2026-10-25 00:00:00' }), 'decision.at'], ['a loose createdAt', (l, v) => { v.createdAt = '2026-10-25 00:00:00'; }, 'createdAt'],
    ['an open loop at the stored-round limit', l => { l.rounds = Array.from({ length: 16 }, (_, i) => mkRound(i + 1, { overCap: i > 0 })); }, 'rounds'], ['an open loop whose counted rounds reached its cap', l => { l.rounds = [1, 2, 3].map(n => mkRound(n)); }, 'rounds'],
    ['cap 1000 after one +1 extension', l => Object.assign(l, { cap: 1000, extensions: 1, decisions: [{ at: TS, choice: 'extend', add: 1, capAfter: 1000, quote: 'q' }] }), 'decision.capAfter'],
    ['eight decisions on a loop with no extension', l => { l.decisions = Array.from({ length: 8 }, () => ({ at: TS, choice: 'cut', add: null, capAfter: null, quote: 'q' })); }, 'decisions']];
  for (const [label, edit, field] of corrupt) { seed(dir, [emptyLoop(1)], v => edit(v.loops[0], v)); const r = loop(dir, ['status', '--json']); check(`corrupt ledger: ${label} (field ${field})`, is(r, 1, 'loop_ledger_corrupt') && !!r.json?.error?.includes(`field: ${field})`), r.text); }
  const rv = repo('lg7-rev');
  seed(rv, [emptyLoop(1)], v => { v.rev = Number.MAX_SAFE_INTEGER; });
  const rvBytes = slurp(ledgerFile(rv)), rvTime = fs.statSync(ledgerFile(rv)).mtimeMs, rr = loop(rv, ['round', 'L-0001', '--spot', 'a', '--json']);
  check('rev at the maximum safe integer: round exits 1 loop_rev_limit, bytes and mtime unchanged, status still reads', is(rr, 1, 'loop_rev_limit') && sameBytes(slurp(ledgerFile(rv)), rvBytes) && fs.statSync(ledgerFile(rv)).mtimeMs === rvTime && loop(rv, ['status', '--json']).status === 0, rr.text);
  // review r2 F01: the finding's ledger (stopped, cap 3, four counted rounds) is corrupt on read, so an extension cannot publish a ledger the reader rejects
  const over = repo('lg7-over'), overFile = ledgerFile(over);
  seed(over, [emptyLoop(1)], v => Object.assign(v.loops[0], { state: 'stopped', stop: { reason: 'cap_reached', round: 3 }, rounds: [1, 2, 3, 4].map(n => mkRound(n)) }));
  const overBytes = slurp(overFile), overRead = [loop(over, ['status', '--json']), loop(over, ['decide', 'L-0001', '--choice', 'extend', '--add', '1', '--quote', 'q', '--json'])];
  check('a stopped loop with four counted rounds at cap 3: status and extend exit 1 loop_ledger_corrupt (field: rounds), bytes unchanged', overRead.every(r => is(r, 1, 'loop_ledger_corrupt') && !!r.json?.error?.includes('field: rounds)')) && sameBytes(slurp(overFile), overBytes), overRead.map(r => r.text).join(' / '));
});

// ---- LG8 (U1b): handoff and session close lines, the json field, absence and an unreadable ledger
const L8 = {
  en: { stop: 'LOOP STOP L-0001 "stopped subject" 3/3 rounds - owner decision required: leerness loop status L-0001',
    open: 'LOOP L-0002 "open subject" 1/3 rounds - after each completed failed cycle: leerness loop round L-0002 --spot <key>',
    ext: q => `LOOP L-0003 "extended subject" 3/4 rounds - after each completed failed cycle: leerness loop round L-0003 --spot <key> - extension quote recorded: "${q}"`,
    bad: /^LOOP LEDGER UNREADABLE \(loop_ledger_corrupt\): (.+) - round limits cannot be checked; tell the owner$/ },
  ko: { stop: 'LOOP STOP L-0001 "stopped subject" 3/3회 - 소유자 결정 필요: leerness loop status L-0001',
    open: 'LOOP L-0002 "open subject" 1/3회 - 끝난 실패 회차마다: leerness loop round L-0002 --spot <key>',
    ext: q => `LOOP L-0003 "extended subject" 3/4회 - 끝난 실패 회차마다: leerness loop round L-0003 --spot <key> - 연장 원문 기록: "${q}"` },
};
const surfaces = (dir, lang, all = true) => ({
  compact: run(['handoff', '--path', dir, '--compact'], { cwd: dir, lang }), close: run(['session', 'close', '--path', dir], { cwd: dir, lang }),
  ...(all ? { full: run(['handoff', '--path', dir], { cwd: dir, lang }), hjson: run(['handoff', '--path', dir, '--json'], { cwd: dir, lang }), cjson: run(['session', 'close', '--path', dir, '--json'], { cwd: dir, lang }) } : {}),
});
row('LG8', 'Surfaces and absence', () => {
  const none = repo('lg8-absent'), sNone = surfaces(none, 'en');
  check('absent: every handoff and close form exits 0 and prints no LOOP line', Object.values(sNone).every(r => r.status === 0 && !/LOOP/.test(r.text)), Object.values(sNone).map(r => r.status).join());
  check('absent: json loopGuard is absent, with no loops and no error', [sNone.hjson, sNone.cjson].every(r => r.json?.loopGuard?.state === 'absent' && r.json.loopGuard.error === null && r.json.loopGuard.open.length === 0 && r.json.loopGuard.stopped.length === 0), JSON.stringify(sNone.hjson.json?.loopGuard));
  check('absent: nothing was created under the git common dir', !fs.existsSync(path.join(commonDir(none), 'leerness')));
  const dir = repo('lg8'), Q = 'q'.repeat(45), clip40 = 'q'.repeat(40) + '…', go = (...a) => loop(dir, a);
  go('open', 'stopped subject'); for (const s of ['a', 'b', 'c']) go('round', 'L-0001', '--spot', s);
  go('open', 'open subject'); go('round', 'L-0002', '--spot', 'x');
  go('open', 'extended subject'); for (const s of ['a', 'b', 'c']) go('round', 'L-0003', '--spot', s);
  go('decide', 'L-0003', '--choice', 'extend', '--add', '1', '--quote', Q);
  const doc = { schema: 'leerness.loop-summary/v1', state: 'present', scope: 'git-common', error: null,
    open: [{ id: 'L-0002', subject: 'open subject', rounds: 1, cap: 3 }, { id: 'L-0003', subject: 'extended subject', rounds: 3, cap: 4 }],
    stopped: [{ id: 'L-0001', subject: 'stopped subject', rounds: 3, cap: 3, reason: 'cap_reached' }] };
  const want = lang => [L8[lang].stop, L8[lang].open, L8[lang].ext(clip40)], before = slurp(ledgerFile(dir));
  const inOrder = (r, wanted) => { const ls = lines(r), at = wanted.map(w => ls.indexOf(w)); return r.status === 0 && at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])); };
  const en = surfaces(dir, 'en'), compactLines = lines(en.compact);
  check('en: handoff holds the three lines in order', inOrder(en.full, want('en')), en.full.text.slice(0, 300));
  check('en: handoff --compact holds them before the compact summary', inOrder(en.compact, want('en')) && compactLines.findIndex(l => l.startsWith('leerness compact:')) > compactLines.indexOf(want('en')[2]), en.compact.text);
  check('en: handoff --json holds loopGuard exactly', JSON.stringify(en.hjson.json?.loopGuard) === JSON.stringify(doc), JSON.stringify(en.hjson.json?.loopGuard));
  check('en: session close holds the lines indented by two spaces', inOrder(en.close, want('en').map(l => '  ' + l)), en.close.text.slice(0, 300));
  check('en: session close --json holds loopGuard exactly', JSON.stringify(en.cjson.json?.loopGuard) === JSON.stringify(doc), JSON.stringify(en.cjson.json?.loopGuard));
  const ko = surfaces(dir, 'ko', false);
  check('ko: handoff --compact and session close hold the ko lines', inOrder(ko.compact, want('ko')) && inOrder(ko.close, want('ko').map(l => '  ' + l)), ko.compact.text);
  const bad = repo('lg8-bad'), file = ledgerFile(bad), junk = Buffer.from('{');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, junk);
  const sBad = surfaces(bad, 'en');
  const shows = r => { const m = lines(r).map(l => l.trim()).map(l => L8.en.bad.exec(l)).find(Boolean); return !!m && path.resolve(m[1]).toLowerCase() === path.resolve(file).toLowerCase(); };
  check('unreadable: handoff and close print the UNREADABLE line with the ledger path and exit 0', ['full', 'compact', 'close'].every(k => sBad[k].status === 0 && shows(sBad[k])), sBad.compact.text);
  check('unreadable: json loopGuard says unreadable with the error code, exit 0', [sBad.hjson, sBad.cjson].every(r => r.status === 0 && r.json?.loopGuard?.state === 'unreadable' && r.json.loopGuard.error === 'loop_ledger_corrupt'), JSON.stringify(sBad.hjson.json?.loopGuard));
  check('the surfaces did not change either ledger (good or unreadable)', sameBytes(slurp(ledgerFile(dir)), before) && sameBytes(slurp(file), junk));
  // the ledger path in the UNREADABLE line goes through the same line clean-up as the subjects: a project folder named with a C1 control (U+009B)
  const c1 = repo(`lg8-c1${String.fromCharCode(0x9b)}`), c1File = ledgerFile(c1), hasC1 = s => Array.from(s).some(ch => ch.codePointAt(0) >= 0x80 && ch.codePointAt(0) <= 0x9f);
  fs.mkdirSync(path.dirname(c1File), { recursive: true }); fs.writeFileSync(c1File, junk);
  const c1Compact = run(['handoff', '--path', c1, '--compact'], { cwd: c1 }), c1Hook = run(['hook', 'session-start', '--path', c1], { cwd: c1 });
  const c1Lines = [...lines(c1Compact), ...JSON.parse(c1Hook.out).hookSpecificOutput.additionalContext.split('\n')].filter(l => l.startsWith('LOOP LEDGER UNREADABLE'));
  check('a ledger path with a C1 control: --compact and the session-start hook print the UNREADABLE line without it', c1Lines.length === 2 && !c1Lines.some(hasC1), JSON.stringify(c1Lines));
  const code = `const g=require.resolve(process.argv[1]);require.cache[g]={id:g,filename:g,loaded:true,exports:new Proxy({},{get(){throw new Error('lib/git.js was used')}})};` +
    `const s=require(process.argv[2]).summary(process.argv[3],{git:JSON.parse(process.argv[4])},'en');process.stdout.write(JSON.stringify(s.doc));`;
  const real = fs.realpathSync.native(dir), top = { worktreeRoot: real, gitDir: commonDir(dir), gitCommonDir: commonDir(dir) };
  const stub = cp.spawnSync(process.execPath, ['-e', code, path.resolve(__dirname, '..', 'lib', 'git.js'), path.resolve(__dirname, '..', 'lib', 'loop-guard.js'), real, JSON.stringify(top)], { encoding: 'utf8', env: process.env, timeout: 60000, windowsHide: true });
  check('summary(root, topology) returns the loops with lib/git.js replaced by a throwing stub', stub.status === 0 && stub.stdout === JSON.stringify(doc), `${stub.status} ${stub.stderr.split('\n')[0]} ${stub.stdout.slice(0, 120)}`);
});

// ---- LG9
function lg9(lang) {
  const dir = repo(`lg9-${lang}`), o = { lang }, outs = [], res = {};
  const go = (name, argv, expect) => { const r = loop(dir, argv, { ...o, expect }); outs.push(r.text); if (name) res[name] = r; return r; };
  go('', ['open', 'ascii subject']); go('', ['round', 'L-0001', '--spot', 's1', '--findings', '2', '--note', 'first']);
  go('rep', ['round', 'L-0001', '--spot', 's1', '--findings', '1']); go('existing', ['open', 'ASCII  subject']);
  go('', ['round', 'L-0001', '--spot', 's2']); go('status', ['status']); go('', ['status', 'L-0001']);
  go('ext', ['decide', 'L-0001', '--choice', 'extend', '--add', '1', '--quote', 'ascii quote']); go('passed', ['round', 'L-0001', '--result', 'go']);
  go('', ['open', 'second subject']);
  for (const s of ['t1', 't2', 't3', 't4']) go('', ['round', 'L-0002', '--spot', s]);
  go('cut', ['decide', 'L-0002', '--choice', 'cut', '--quote', 'ascii cut']); go('', ['round', 'L-0099', '--spot', 'a'], /No such loop: L-0099|해당 loop 가 없습니다: L-0099/);
  go('', ['decide', 'L-0002', '--choice', 'cut', '--quote', 'again'], /Loop L-0002 (is closed|는 종료됐습니다)/);
  return { outs, res, doc: loop(dir, ['status', 'L-0001', '--json'], o).json };
}
const strip = v => Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !/^(at|.*At|elapsedSeconds)$/.test(k)).map(([k, w]) => [k, strip(w)])) : v;
row('LG9', 'Generated labels', () => {
  const en = lg9('en'), ko = lg9('ko');
  const hangul = en.outs.filter(t => /[가-힣]/.test(t)).length;
  check('en: no Hangul in any output of the scenario', hangul === 0, en.outs.find(t => /[가-힣]/.test(t)));
  for (const lang of ['en', 'ko']) {
    const x = X[lang], r = (lang === 'en' ? en : ko).res;
    same(`${lang}: existing line`, r.existing, 0, [x.existing]);
    same(`${lang}: round 2 prints the REPEAT line`, r.rep, 0, [x.round('L-0001', 2, 's1', 1), x.repeat]);
    same(`${lang}: extend line`, r.ext, 0, [x.extended]);
    same(`${lang}: passed line`, r.passed, 0, [x.passed]);
    same(`${lang}: cut line`, r.cut, 0, [x.cut]);
    check(`${lang}: status prints the scope line first`, lines(r.status)[0] === x.scope, lines(r.status)[0]);
  }
  check('json is identical across languages after removing timestamps', JSON.stringify(strip(en.doc)) === JSON.stringify(strip(ko.doc)), JSON.stringify(strip(ko.doc)).slice(0, 200));
});

// ---- LG10
row('LG10', 'Observation-only', () => {
  const main = repo('lg10'), wt = worktree(main, 'wt10'), dirs = [main, wt];
  loop(main, ['open', 'observe subject']); loop(main, ['round', 'L-0001', '--spot', 'a']);
  const before = dirs.map(snap), common = snap(commonDir(main));
  for (const argv of [['status'], [], ['status', 'L-0001', '--json'], ['status', '--strict-exit']]) { const r = loop(wt, argv); check(`observation: ${argv.join(' ') || '(bare)'} exits 0`, r.status === 0, r.text); }
  check('project, worktrees and common dir are unchanged (path, size, sha256, mtime)', dirs.map(snap).join() === before.join() && snap(commonDir(main)) === common);
  const { _cliMutationClass } = require('../bin/leerness.js');
  for (const argv of [['loop', 'status'], ['loop'], ['loop', 'status', 'L-0001'], ['loop', '--json']]) check(`classifier: ${argv.join(' ')} is observation-only`, _cliMutationClass(argv, 'loop') === 'observation-only');
  for (const argv of [['loop', 'open', 'x'], ['loop', 'round', 'L-0001'], ['loop', 'decide', 'L-0001']]) check(`classifier: ${argv.join(' ')} is stateful`, _cliMutationClass(argv, 'loop') === 'stateful');
  // the launch contract (design 3.1) is about OWNERSHIP: the loop module launches nothing, and every launch the trap sees is judged by who spawned it
  // (the first JS frame outside node), not by which program it is: a shim makes the shared gateway run a node script or another executable, and that is the gateway's.
  // The trap sees the seven child_process functions it wraps (spawnSync, execFileSync, execSync, spawn, execFile, exec, fork); ChildProcess.prototype.spawn, native bindings and workers are not observed.
  const trapFile = path.join(arena, 'spawn-trap.js'), trapOut = path.join(arena, 'spawn-trap.json'), win = process.platform === 'win32';
  fs.writeFileSync(trapFile, "const cp=require('child_process'),calls=[];const frame=()=>{const o=Error.prepareStackTrace;Error.prepareStackTrace=(e,s)=>s;const s=new Error().stack;Error.prepareStackTrace=o;return s.map(x=>x.getFileName()).filter(f=>f&&!/^node:/.test(f)&&f!==__filename)};for(const n of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])(o=>{cp[n]=function(c,a,...r){const t=[a,...r].find(x=>x&&typeof x==='object'&&!Array.isArray(x));calls.push({file:String(c),argv:Array.isArray(a)?a.map(String):[],timeout:t&&t.timeout,frames:frame().slice(0,2)});return o.call(this,c,a,...r)}})(cp[n]);process.on('exit',()=>require('fs').writeFileSync(process.env.TRAP_OUT,JSON.stringify(calls)));");
  const launches = (dir, argv, env) => {
    try { fs.rmSync(trapOut); } catch {}
    const r = loop(dir, argv, { env: { ...env, NODE_OPTIONS: `--require ${trapFile}`, TRAP_OUT: trapOut } });
    return { r, calls: JSON.parse(slurp(trapOut) || '[{"file":"(the trap wrote nothing)","argv":[],"frames":[]}]') };
  };
  const LIB = path.resolve(__dirname, '..', 'lib'), GATEWAY = ['portable-process.js', 'git.js', 'state-git.js'].map(f => path.join(LIB, f)), IO = path.join(LIB, 'io.js'), LOOPJS = path.join(LIB, 'loop-guard.js');   // io.js: the shared write primitive
  const SYS = process.env.SystemRoot || process.env.WINDIR || '', WHERE = path.join(SYS, 'System32', 'where.exe'), PS = path.join(SYS, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const at = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase(), real = d => fs.realpathSync.native(d);
  const REV = ['--no-optional-locks', '-C', '<root>', 'rev-parse', '--path-format=absolute', '--is-bare-repository', '--is-inside-git-dir', '--show-toplevel', '--git-dir', '--git-common-dir'];
  const spec = (() => {   // the gateway's own builders of its two refusal helpers: the expected helper argv is what the gateway builds, not a phrase
    const f = path.join(LIB, 'portable-process.js'), m = { exports: {} };
    new Function('require', 'module', 'exports', '__dirname', '__filename', fs.readFileSync(f, 'utf8') + '\nmodule.exports.t = { _unresolvedCommandSpec, _unsupportedShimSpec };')(p => require(p.startsWith('.') ? path.join(LIB, p) : p), m, m.exports, LIB, f);
    return m.exports.t;
  })();
  // provenance, count, argv and timeout are four predicates. Count: one gateway call starts at most a locator and one target or refusal, and a loop command makes one gateway call
  // (resolveStatePaths, or the admission). Argv only where it is an exact fact: native git, the where.exe locator, and the refusal helper (full argv from the builder).
  const faults = (calls, { write = false, root, helper = null, n = null }) => {
    const replace = x => write && at(x.file, PS) && x.argv.some(a => a.includes('[IO.File]::Replace')), gw = calls.filter(x => !replace(x)), last = gw[gw.length - 1];
    const from = (x, files) => !!x.frames[0] && files.some(f => at(x.frames[0], f)), isGit = x => /^git(\.exe)?$/i.test(path.basename(x.file));
    const exact = x => (isGit(x) ? x.argv.length === REV.length && x.argv.every((a, i) => (REV[i] === '<root>' ? at(a, root) : a === REV[i])) : win && at(x.file, WHERE) ? x.argv.join() === 'git' : true);
    const refusal = !helper || (!!last && at(last.file, process.execPath) && at(last.argv[last.argv.length - 1], helper.src) && JSON.stringify(last.argv) === JSON.stringify(helper.build(last.argv[last.argv.length - 1]).args));
    return [['provenance', calls.every(x => from(x, replace(x) ? [IO] : GATEWAY))], ['count', gw.length <= 2 && (n === null || gw.length === n)], ['argv', gw.every(exact) && refusal],
      ['timeout', gw.every(x => x.timeout > 0 && x.timeout <= 5000) && calls.filter(replace).every(x => x.timeout > 0 && x.timeout <= 30000)]].filter(([, ok]) => !ok).map(([d]) => d);
  };
  const wr = repo('lg10-write'), hide = fs.mkdtempSync(path.join(arena, 'no-git-')), shimDir = fs.mkdtempSync(path.join(arena, 'shim-')), noWin = fs.mkdtempSync(path.join(arena, 'no-where-'));
  const envKey = re => Object.keys(process.env).find(k => re.test(k)), pk = envKey(/^path$/i) || 'PATH', noWinEnv = win ? { [envKey(/^systemroot$/i) || 'SystemRoot']: noWin, [envKey(/^windir$/i) || 'windir']: noWin } : {};
  if (win) fs.writeFileSync(path.join(shimDir, 'git.cmd'), '@echo off\r\necho not a supported shim\r\n');
  loop(wr, ['open', 'launch subject']);
  const HU = { build: spec._unresolvedCommandSpec, src: 'git' }, HS = { build: spec._unsupportedShimSpec, src: path.join(shimDir, 'git.cmd') }, status = ['status', '--json'];
  const skipWhy = { missing: cp.spawnSync('git', ['--version'], { env: { ...process.env, [pk]: hide }, windowsHide: true }).status === 0 && 'this host still finds git with an empty PATH', shim: !win && 'the where.exe locator and the unsupported-shim refusal exist on win32 only',
    where: !win ? 'the where.exe locator exists on win32 only' : cp.spawnSync(process.execPath, ['-e', '0'], { env: { ...process.env, ...noWinEnv }, windowsHide: true }).status !== 0 && 'node cannot start here without its real SystemRoot (the branch is judged as a gateway-built list below)' };
  for (const [label, dir, argv, env, c, code, why] of [['status, git found', wt, status, {}, {}, 0], ['status, git missing', wt, status, { [pk]: hide }, { helper: win ? HU : null, n: win ? 2 : 1 }, 1, skipWhy.missing],
    ['status, unsupported shim', wt, status, { [pk]: shimDir }, { helper: HS, n: 2 }, 1, skipWhy.shim], ['status, where absent', wt, status, noWinEnv, { helper: HU, n: 1 }, 1, skipWhy.where], ['round, git found', wr, ['round', 'L-0001', '--spot', 'w'], {}, { write: true }, 0]]) {
    if (why) { skips.push(`LG10 ${label}: ${why}`); continue; }
    const { r, calls } = launches(dir, argv, env), f = faults(calls, { root: real(dir), ...c });
    for (const d of ['provenance', 'count', 'argv', 'timeout']) check(`loop ${label}: launch ${d}`, !f.includes(d), JSON.stringify(calls));
    check(`loop ${label}: ${code ? 'exit 1 loop_ledger_unavailable' : 'exit 0'}`, code ? r.status === 1 && /^loop_ledger_unavailable:/.test(r.json?.code || '') : r.status === 0, r.text);
  }
  const root = real(wt), mk = (file, argv, frame, timeout = 5000) => ({ file, argv, timeout, frames: [frame] }), node = argv => mk(process.execPath, argv, GATEWAY[0]), replaceCall = mk(PS, ['-Command', '[IO.File]::Replace(...)'], IO, 30000);
  const gitCall = mk(win ? path.join(path.dirname(process.execPath), 'git.exe') : 'git', REV.map(a => (a === '<root>' ? root : a)), GATEWAY[0]), norm = [...(win ? [mk(WHERE, ['git'], GATEWAY[0])] : []), gitCall];
  const swap = p => norm.map((c, i) => (i === norm.length - 1 ? { ...c, ...p } : c)), helped = argv => [...norm.slice(0, -1), node(argv)], marker = { file: process.execPath, argv: ['-e', '/* [IO.File]::Replace */'], timeout: 5000, frames: [LOOPJS] };
  for (const [label, calls, c] of [['the contract launches', norm, {}], ['a shim target (a node script) launched by the gateway', swap({ file: process.execPath, argv: ['cli.js', ...gitCall.argv] }), {}], ['the gateway refusal helper after a missing git', helped(spec._unresolvedCommandSpec('git').args), { helper: HU, n: norm.length }],
    ['the unsupported-shim refusal', helped(spec._unsupportedShimSpec(HS.src).args), { helper: HS, n: norm.length }], ['the helper alone when where.exe is absent', [node(spec._unresolvedCommandSpec('git').args)], { helper: HU, n: 1 }], ['the writer replace launch from the write primitive', [...norm, replaceCall], { write: true }]])
    check(`the launch checker accepts ${label}`, faults(calls, { root, ...c }).length === 0, faults(calls, { root, ...c }).join());
  for (const [label, calls, c, dim] of [['a launch whose spawning frame is the loop module', swap({ frames: [LOOPJS] }), {}, 'provenance'], ['a marker-carrying node child of the loop module in a write chain', [...norm, marker], { write: true }, 'provenance'],
    ['the same marker child in a status chain', [...norm, marker], {}, 'provenance'], ['the writer replace launch inside a status chain', [...norm, replaceCall], {}, 'provenance'], ['a refusal helper that keeps the phrase and runs other code', helped(['-e', 'doAnything(); // command not found on PATH', '--', 'git']), { helper: HU, n: norm.length }, 'argv'],
    ['a git launch with another argv', swap({ argv: [...gitCall.argv, '--other'] }), {}, 'argv'], ['a git launch without a timeout', swap({ timeout: undefined }), {}, 'timeout'], ['a repeated locator launch', [norm[0], ...norm, norm[0]], {}, 'count']])
    check(`the launch checker rejects ${label} (${dim})`, faults(calls, { root, ...c }).includes(dim), faults(calls, { root, ...c }).join());
  const dry = loop(main, ['round', 'L-0001', '--spot', 'b', '--dry-run', '--json']);
  check('a valid round with --dry-run exits 1 with the dry-run diagnostic', is(dry, 1, 'dry_run_unsupported'), dry.text);
  check('the dry run changed nothing', dirs.map(snap).join() === before.join() && snap(commonDir(main)) === common);
});

// ---- LG11 (U1b): the managed paragraph, standard mode only, and what an upgrade does with it
const PARA = {
  en: '\n## Loop limit\nBefore a second review of the same document or code, or a second fix of the same verifier, run `leerness loop open "<subject>"` once and reuse its id (a new version label is the same subject). Record each completed failed cycle once, earlier ones included: `leerness loop round <id> --spot <key>` (bookkeeping is not a cycle). Exit 3 = STOP.\n',
  ko: '\n## 반복 회차 한도\n같은 문서·코드의 두 번째 검수나 같은 검사 도구의 두 번째 수리 전에 `leerness loop open "<주제>"` 를 한 번 실행하고 그 id 를 계속 씁니다(판 번호가 바뀌어도 같은 주제). 이미 끝난 것도 포함해 실패한 회차마다 한 번 `leerness loop round <id> --spot <key>` 를 실행합니다(기록·조회·정정은 회차가 아님). 종료 코드 3 = STOP.\n',
};
row('LG11', 'Guidance', () => {
  const mk = (label, lang, mode) => {
    const d = path.join(arena, `${++seq}-${label}`);
    fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
    const r = run(['init', d, '--yes', '--language', lang, ...(mode ? ['--mode', mode] : [])], { cwd: d, lang });
    if (r.status !== 0) throw new Harness(`fixture init ${label}: ${r.text.slice(0, 200)}`);
    return d;
  };
  const agents = d => fs.readFileSync(path.join(d, 'AGENTS.md'), 'utf8'), times = (text, s) => text.split(s).length - 1;
  const budget = d => run(['context', 'budget', '--json', '--path', d], { cwd: d }).json || {};
  const G = require('../lib/context-reading-guidance'), { GENERATED_LAYOUTS } = require('../lib/retired-guidance-sections');
  const TAG = '<!-- leerness:migration-preserved -->';
  const backups = d => {
    const archive = path.join(d, '.leerness', 'archive');
    return fs.existsSync(archive) ? fs.readdirSync(archive).map(name => path.join(archive, name))
      .filter(dir => fs.lstatSync(dir).isDirectory()).map(dir => ({ dir, tree: snap(dir),
        agents: slurp(path.join(dir, 'files', 'AGENTS.md')) })) : [];
  };
  const update = (d, lang, label) => {
    const previous = fs.readFileSync(path.join(d, 'AGENTS.md')), before = backups(d);
    const u = run(['update', d, '--yes', '--force'], { cwd: d, lang });
    check(`${label} exits 0`, u.status === 0, u.text.slice(-200));
    for (const b of before) check(`${label} keeps existing backup ${path.basename(b.dir)} exact`, snap(b.dir) === b.tree);
    const added = backups(d).filter(b => !before.some(old => old.dir === b.dir));
    const exact = added.filter(b => b.agents && b.agents.equals(previous));
    check(`${label} saves one exact pre-update AGENTS.md backup`, exact.length === 1);
    return { text: agents(d), backup: exact[0] };
  };
  for (const lang of ['en', 'ko']) {
    const std = mk(`lg11-std-${lang}`, lang), min = mk(`lg11-min-${lang}`, lang, 'minimal'), p = PARA[lang];
    check(`${lang}: standard AGENTS.md holds the paragraph exactly once`, times(agents(std), p) === 1);
    check(`${lang}: minimal AGENTS.md has no loop paragraph`, !agents(min).includes('leerness loop'));
    const sB = budget(std), mB = budget(min);
    check(`${lang}: context budget is not over in standard and minimal`, sB.over === false && mB.over === false, `standard ${sB.total}/${sB.budget}, minimal ${mB.total}`);
    check(`${lang}: minimal loads less than a fifth of standard`, mB.total < sB.total / 5, `${mB.total} vs ${sB.total}`);
    const fresh = agents(std);
    for (const n of [1, 2]) {
      const u = update(std, lang, `${lang}: untouched update ${n}`);
      check(`${lang}: untouched update ${n} keeps exact fresh guidance and no preserved block`, u.text === fresh && !u.text.includes(TAG) && times(u.text, p) === 1);
    }
    const stripped = fresh.replace(p, '');
    fs.writeFileSync(path.join(std, 'AGENTS.md'), stripped);
    check(`${lang}: fixture: the stripped AGENTS.md has no loop paragraph`, !agents(std).includes('leerness loop'));
    check(`${lang}: stripped current head is not a known generated legacy layout`, !GENERATED_LAYOUTS.includes(G.generatedHeadFingerprint(stripped)) && G.retireGeneratedGuidance(stripped) === stripped);
    check(`${lang}: fixture generated and stripped bytes end with one newline`, fresh.endsWith('\n') && !fresh.endsWith('\n\n') && stripped.endsWith('\n'));
    const prefix = fresh.slice(0, -1) + `\n\n---\n${TAG}\n## Preserved previous content\n\n`;
    const note = lang === 'en'
      ? '> Custom user/project content carried over from the previous version — re-carried automatically on every migration. Full original backup: `'
      : '> 이전 버전에서 이어진 사용자/프로젝트 커스텀 내용 — 마이그레이션마다 자동 이월됩니다. 전체 원본 백업: `';
    let priorPayload = null;
    for (const n of [1, 2]) {
      const u = update(std, lang, `${lang}: edited update ${n}`);
      const reference = u.backup ? path.relative(std, u.backup.dir).replace(/\\/g, '/') : '<missing backup>';
      const wrapper = prefix + note + reference + '`\n\n', payload = u.text.slice(wrapper.length);
      check(`${lang}: edited update ${n} preserves exactly one whole original payload with only the generated backup reference`, u.text === wrapper + stripped && times(u.text, p) === 1 && times(u.text, TAG) === 1 && payload === stripped);
      if (priorPayload !== null) check(`${lang}: edited repeat keeps the preserved payload byte exact`, payload === priorPayload);
      priorPayload = payload;
    }
  }
  const old = require('./fixtures/legacy-guidance-1.36.289.json').files['ko-standard']['AGENTS.md'];
  check('legacy ko-standard source bytes and generated ownership are pinned', sha(Buffer.from(old)) === '0f7a6397fd87ea39a07788963c6f6e201b09a3e97379c6c82625c4a25920f5e0'
    && G.generatedHeadFingerprint(old) === '93fef1d7268cbdc7b3ba8b73aba26d7d' && GENERATED_LAYOUTS.includes(G.generatedHeadFingerprint(old)) && !old.includes('leerness loop'));
  const legacy = mk('lg11-known-legacy-ko', 'ko'), fresh = agents(legacy);
  fs.writeFileSync(path.join(legacy, 'AGENTS.md'), old);
  fs.writeFileSync(path.join(legacy, '.leerness', 'HARNESS_VERSION'), '1.36.289\n');
  const manifestFile = path.join(legacy, '.leerness', 'manifest.json'), manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  Object.assign(manifest, { leernessVersion: '1.36.289', language: 'ko', mode: 'standard', minimal: false });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  for (const n of [1, 2]) {
    const u = update(legacy, 'ko', `known legacy update ${n}`);
    check(`known legacy update ${n} restores exact fresh guidance with one loop paragraph and no preserved block`, u.text === fresh && times(u.text, PARA.ko) === 1 && !u.text.includes(TAG));
  }
});

// ---- LG12
row('LG12', 'Catalogs and flag isolation', () => {
  const LOOPCMD = 'loop open|round|decide|status [--json]';
  const desc = { ko: '같은 주제의 반복 검수·수리 회차 기록 (기본 한도 3회) — 모든 worktree 공유, STOP 은 exit 3', en: 'records repeated review or fix rounds on one subject (default cap 3); shared by all worktrees; STOP exits 3' };
  const dir = repo('lg12');
  for (const lang of ['ko', 'en']) {
    const c = run(['commands', '--json', '--path', dir], { cwd: dir, lang }), entry = Object.values(c.json?.categories || {}).flat().find(e => e.cmd === LOOPCMD);
    check(`commands --json (${lang}) holds the exact row`, !!entry && entry.desc === desc[lang], entry ? entry.desc : c.text.slice(0, 100));
    if (lang === 'en') check('the en row has no Hangul', !!entry && !/[가-힣]/.test(entry.cmd + entry.desc));
    const h = run(['--help', '--path', dir], { cwd: dir, lang }), line = lines(h).find(l => l.includes('loop open|round|decide|status'));
    check(`--help (${lang}) has the loop line`, !!line, h.text.slice(0, 80));
    if (lang === 'en') check('the en help line has no Hangul', !!line && !/[가-힣]/.test(line), line);
  }
  const bogus = loop(dir, ['round', 'L-0001', '--spot', 'a', '--bogus', '--json']);
  check('an unknown flag exits 1 unknown_flag before any write', is(bogus, 1, 'unknown_flag') && !fs.existsSync(path.join(commonDir(dir), 'leerness')), bogus.text);
  check('fixture: seed a task', run(['task', 'add', 'seed', '--no-review', '--path', dir], { cwd: dir }).status === 0);
  const before = snap(dir);
  const foreign = [['task', 'add', 'x', '--spot', 'a', '--no-review'], ['task', 'add', 'x', '--spot=a', '--no-review'], ['decision', 'add', 'y', '--quote', 'q'], ['task', 'list', '--findings', '1', '--json']];
  for (const argv of foreign) { const r = run([...argv, '--path', dir], { cwd: dir, expect: /unknown_flag|Unknown flag/ }); check(`foreign flag rejected: ${argv.join(' ')}`, r.status === 1 && /unknown_flag|Unknown flag/.test(r.text), r.text); }
  check('the rejected invocations changed nothing', snap(dir) === before);
  const lit = run(['task', 'add', '--no-review', '--path', dir, '--', '--spot a'], { cwd: dir });
  check('task add ... -- "--spot a" exits 0 with that literal title', lit.status === 0 && fs.readFileSync(path.join(dir, '.leerness', 'progress-tracker.md'), 'utf8').includes('--spot a'), lit.text);
  const rc = run(['review-checkpoint', 'assess', '--stdin', '--spot', 'a'], { cwd: dir, allow: [2] });
  check('review-checkpoint assess --stdin --spot a still exits 2', rc.status === 2, rc.text);
});

// ---- LG13: the default read (handoff, --compact, --json) finds the ledger through the topology of the stored-read snapshot
row('LG13', 'Default read topology', () => {
  const main = repo('lg13'), wt = worktree(main, 'wt13'), nested = path.join(main, 'sub', 'app');
  fs.mkdirSync(path.join(nested, '.leerness'), { recursive: true });
  fs.writeFileSync(path.join(nested, '.leerness', 'HARNESS_VERSION'), '1.36.305\n');
  const stop = (dir, subject) => { loop(dir, ['open', subject]); for (const spot of ['a', 'b', 'c']) loop(dir, ['round', 'L-0001', '--spot', spot]); };
  const stopLine = subject => `LOOP STOP L-0001 "${subject}" 3/3 rounds - owner decision required: leerness loop status L-0001`;
  const reads = dir => ({ full: run(['handoff', '--path', dir], { cwd: dir }), compact: run(['handoff', '--path', dir, '--compact'], { cwd: dir }), json: run(['handoff', '--path', dir, '--json'], { cwd: dir }) });
  const shows = (label, dir, subject) => {
    const r = reads(dir);
    for (const k of ['full', 'compact']) check(`${label}: handoff ${k === 'full' ? '' : '--compact '}holds the STOP line`, r[k].status === 0 && lines(r[k]).includes(stopLine(subject)), r[k].text.slice(0, 300));
    check(`${label}: handoff --json loopGuard holds the stopped loop, scope git-common`, r.json.status === 0 && r.json.json?.loopGuard?.scope === 'git-common' && r.json.json.loopGuard.stopped?.[0]?.subject === subject, JSON.stringify(r.json.json?.loopGuard));
  };
  const silent = (label, dir) => { const r = reads(dir); check(`${label}: no loop line and an absent ledger`, Object.values(r).every(x => x.status === 0 && !/LOOP/.test(x.text)) && r.json.json?.loopGuard?.state === 'absent', JSON.stringify(r.json.json?.loopGuard)); };
  stop(main, 'shared subject');
  shows('main worktree', main, 'shared subject');
  shows('linked worktree (the ledger is shared)', wt, 'shared subject');
  silent('a project inside the repository has its own ledger', nested);
  stop(nested, 'nested subject');
  shows('nested project', nested, 'nested subject');
  shows('main worktree after the nested project stopped', main, 'shared subject');
  const before = [main, wt, nested].map(snap).join(), common = snap(commonDir(main));
  reads(main); reads(wt); reads(nested);
  check('the reads changed neither the worktrees nor the common dir (path, size, sha256, mtime)', [main, wt, nested].map(snap).join() === before && snap(commonDir(main)) === common);
});

// ---- LG14: a folder outside Git that holds only AGENTS.md. A ledger there must not make the layout check refuse every later read and write
row('LG14', 'Uninitialized folder outside git', () => {
  const dir = path.join(arena, `${++seq}-lg14`), RL = /Runtime layout/;
  fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Agents\n');
  if (cp.spawnSync('git', ['rev-parse'], { cwd: dir, env: process.env }).status === 0) throw new Harness('fixture: the folder lies inside a repository');
  const compact = () => run(['handoff', '--path', dir, '--compact'], { cwd: dir, expect: RL }), shows = r => r.status === 0 && lines(r).some(l => l.startsWith('LOOP L-0001 '));
  check('open and two rounds exit 0', [['open', 'bare folder subject'], ['round', 'L-0001', '--spot', 'a'], ['round', 'L-0001', '--spot', 'b']].every(a => loop(dir, a, { expect: RL }).status === 0));
  const read = compact();
  check('handoff --compact exits 0 and holds the open loop line', shows(read), read.text.slice(0, 300));
  const task = run(['task', 'add', 'after the ledger', '--no-review', '--path', dir], { cwd: dir, expect: RL });
  check('a following task add exits 0', task.status === 0, task.text.slice(0, 300));
  const init = run(['init', dir, '--yes', '--language', 'en'], { cwd: dir, expect: RL }), after = compact();
  check('init exits 0, and the ledger and its loop line survive it', init.status === 0 && fs.existsSync(path.join(dir, '.leerness', 'loop-ledger.json')) && shows(after), `${init.text.slice(-200)} / ${after.text.slice(0, 200)}`);
});

// ---- LG15: a publish killed between its link and its unlink (the first write of a ledger) leaves two names for the ledger file; the next write finishes it
row('LG15', 'Dead publish of the first ledger write', () => {
  const dir = repo('lg15'), file = ledgerFile(dir), lock = file + '.lock', kill = path.join(arena, 'kill-after-link.js');
  fs.writeFileSync(kill, "const fs = require('fs'), link = fs.linkSync; fs.linkSync = function (a, b) { const r = link.apply(this, arguments); if (String(b).endsWith('loop-ledger.json')) process.kill(process.pid, 'SIGKILL'); return r; };\n");
  const k = cp.spawnSync(process.execPath, [BIN, 'loop', 'open', 'killed publish', '--path', dir], { cwd: dir, env: { ...process.env, LEERNESS_LANG: 'en', NODE_OPTIONS: `--require "${kill.replace(/\\/g, '/')}"` }, encoding: 'utf8', timeout: 120000, windowsHide: true });
  const names = fs.existsSync(path.dirname(file)) ? fs.readdirSync(path.dirname(file)) : [], alias = names.filter(n => /^\.loop-ledger\.json\.publish-\d+-[a-f0-9]{24}$/.test(n));
  if (k.status === 0 || !fs.existsSync(file) || fs.statSync(file).nlink !== 2 || alias.length !== 1 || !fs.existsSync(lock)) throw new Harness(`fixture: the kill did not leave one ledger with two names and its lock: exit ${k.status}, ${names.join()}`);
  const past = new Date(Date.now() - 60000);   // the owner record counts as dead only after it is older than 5 seconds
  for (const n of fs.readdirSync(lock)) fs.utimesSync(path.join(lock, n), past, past);
  const st = loop(dir, ['status', '--json']);
  check('fixture: a read still refuses the file with two names', is(st, 1, 'loop_ledger_unsafe'), st.text);
  const r = loop(dir, ['round', 'L-0001', '--spot', 'a', '--json']);
  check('round exits 0 and says it cleared the lock of the stopped process', r.status === 0 && r.json?.round?.n === 1 && r.text.includes('Cleared a lock left by a stopped process'), r.text);
  check('the ledger has one name and the folder holds nothing else', fs.statSync(file).nlink === 1 && fs.readdirSync(path.dirname(file)).join() === 'loop-ledger.json', fs.readdirSync(path.dirname(file)).join());
  const after = loop(dir, ['status', '--json']), compact = run(['handoff', '--path', dir, '--compact'], { cwd: dir });
  check('status and handoff --compact read the ledger with the round', after.status === 0 && after.json?.loops?.[0]?.rounds === 1 && compact.status === 0 && lines(compact).some(l => l.startsWith('LOOP L-0001 ')), `${after.text.slice(0, 200)} / ${compact.text.slice(0, 200)}`);
});

// ---- LG16: a lock timeout keeps the lock layer's own next step. A save that stopped after moving the ledger aside names the file to move back; the loop
// text used to replace that with "delete the lock", which loses the rounds. The real wait is 35 s, so the lock layer is made to refuse at once.
row('LG16', 'Lock timeout text', () => {
  const dir = repo('lg16'), LIB = path.resolve(__dirname, '..', 'lib'), lockPath = path.join(ledgerDir(dir), 'loop-ledger.json.lock'), pre = path.join(arena, 'lock-timeout.js');
  const MSG = `Lock acquisition failed - stopped to protect the data from concurrent writes: loop-ledger.json (timeout)\n  Lock path: ${lockPath}\n  What to do: A save stopped after moving a file aside. Its original is ${lockPath}/before, and it belongs to the file now missing beside loop-ledger.json. Move it back under that name, then delete that lock.`;
  const LG = require('../lib/loop-guard'), SL = require('../lib/state-lock'), real = SL.withStateLock;
  let err = null;
  SL.withStateLock = () => { throw Object.assign(new Error(MSG), { code: 'E_LOCK_TIMEOUT', lockPath }); };
  try { LG.mutate(dir, { action: 'round', id: 'L-0001', result: 'no-go', spot: 'a', findings: null, note: null }); } catch (e) { err = e; } finally { SL.withStateLock = real; }
  check('mutate on a lock timeout: loop_ledger_locked carrying the lock layer message and the lock path', !!err && err.code === 'loop_ledger_locked' && err.detail === MSG && err.lockPath === lockPath, err && `${err.code} ${err.detail}`);
  fs.writeFileSync(pre, `const sl = require(${JSON.stringify(path.join(LIB, 'state-lock.js'))}), orig = sl.withStateLock; sl.withStateLock = function (file) { if (String(file).endsWith('loop-ledger.json')) throw Object.assign(new Error(${JSON.stringify(MSG)}), { code: 'E_LOCK_TIMEOUT', lockPath: String(file) + '.lock' }); return orig.apply(this, arguments); };\n`);
  const env = { NODE_OPTIONS: `--require "${pre.replace(/\\/g, '/')}"` };
  for (const lang of ['en', 'ko']) {
    const r = loop(dir, ['round', 'L-0001', '--spot', 'a'], { lang, env, expect: /Loop ledger (is locked|가 잠겨)/ });   // the old general step stays recognizable, so a regression fails the row instead of ending it
    check(`${lang}: the lock timeout prints the lock layer message, not a general step`, r.status === 1 && r.text.includes('What to do: A save stopped after moving a file aside') && r.text.includes('Move it back under that name, then delete that lock.') && !/remove that directory by hand|폴더를 직접 지우고/.test(r.text), r.text);
  }
  const j = loop(dir, ['round', 'L-0001', '--spot', 'a', '--json'], { env });
  check('--json: loop_ledger_locked with the message in error and the lock path', is(j, 1, 'loop_ledger_locked') && !!j.json?.error?.includes('Move it back under that name') && j.json?.lockPath === lockPath, j.text);
});

// ---- LG17: rounds recorded after a STOP are not counted, and they are not hidden: the findings trend includes them and the handoff line says how many
row('LG17', 'Rounds after the cap', () => {
  const dir = repo('lg17'), go = (...a) => loop(dir, a);
  go('open', 'capped subject');
  for (const [spot, n] of [['a', 9], ['b', 6], ['c', 2], ['d', 30], ['e', 41], ['f', 50]]) go('round', 'L-0001', '--spot', spot, '--findings', String(n));
  const card = lines(loop(dir, ['status', 'L-0001'])), sj = loop(dir, ['status', 'L-0001', '--json']).json?.loops?.[0];
  check('the card trend holds the rounds after the cap and says not falling', card.includes('Findings: 9 -> 6 -> 2 -> 30 -> 41 -> 50 (not falling)'), card.join(' / '));
  check('the status json still counts 3 of 6 and lists the findings of the counted rounds only', sj?.counted === 3 && sj?.rounds === 6 && JSON.stringify(sj?.findings) === '[9,6,2]', JSON.stringify(sj));
  const en = surfaces(dir, 'en'), ko = surfaces(dir, 'ko', false);
  const enLine = 'LOOP STOP L-0001 "capped subject" 3/3 rounds (3 more after the cap) - owner decision required: leerness loop status L-0001';
  const koLine = 'LOOP STOP L-0001 "capped subject" 3/3회 (한도 뒤 3회 더 진행) - 소유자 결정 필요: leerness loop status L-0001';
  check('en: handoff, --compact and session close show the rounds after the cap', lines(en.full).includes(enLine) && lines(en.compact).includes(enLine) && lines(en.close).includes('  ' + enLine), en.compact.text);
  check('ko: --compact and session close show the rounds after the cap', lines(ko.compact).includes(koLine) && lines(ko.close).includes('  ' + koLine), ko.compact.text);
  const want = JSON.stringify({ id: 'L-0001', subject: 'capped subject', rounds: 3, cap: 3, overCap: 3, reason: 'cap_reached' });
  check('--json: the stopped row carries overCap after cap, in handoff and in session close', [en.hjson, en.cjson].every(r => JSON.stringify(r.json?.loopGuard?.stopped?.[0]) === want), JSON.stringify(en.hjson.json?.loopGuard));
});

// ---- LG18: opening a new subject while another loop is stopped names that loop, so a renamed subject (design v12, then v19) does not hide the STOP
row('LG18', 'New subject beside a stopped loop', () => {
  const dir = repo('lg18');
  const first = loop(dir, ['open', 'design review'], { lang: 'en' });
  check('fixture: a first open with no stopped loop prints no stopped-loop line', first.status === 0 && !first.text.includes('A stopped loop exists'), first.text);
  for (const spot of ['a', 'b', 'c']) loop(dir, ['round', 'L-0001', '--spot', spot]);
  const en = loop(dir, ['open', 'design review v19'], { lang: 'en' });
  check('en: the new loop opens and names the stopped one with its card command', en.status === 0 && lines(en).includes('A stopped loop exists: L-0001 "design review". If this is the same work under a new name, do not use this loop; show the owner that card: leerness loop status L-0001'), en.text);
  const ko = loop(dir, ['open', 'design review v20'], { lang: 'ko' });
  check('ko: the same line in Korean', ko.status === 0 && lines(ko).includes('중단된 loop 가 있습니다: L-0001 "design review". 같은 일을 이름만 바꿔 다시 연 것이면 이 loop 를 쓰지 말고 그 카드를 소유자에게 보여 주세요: leerness loop status L-0001'), ko.text);
  const j = loop(dir, ['open', 'design review v21', '--json']);
  check('--json: stoppedElsewhere lists the stopped loop ids', j.status === 0 && JSON.stringify(j.json?.stoppedElsewhere) === '["L-0001"]' && j.json?.existing === false, j.text);
  const again = loop(dir, ['open', 'design review v19', '--json']);
  check('--json: reopening an existing subject adds no stoppedElsewhere field', again.status === 0 && again.json?.existing === true && !('stoppedElsewhere' in (again.json || {})), again.text);
});

(async () => {
  const want = process.argv.includes('--row') ? process.argv[process.argv.indexOf('--row') + 1] : null;
  let failed = 0, harness = 0;
  if (want && !rows[want]) { console.log(`HARNESS-ERROR ${want}: no such row`); process.exitCode = 3; return; }
  for (const [id, { title, fn }] of Object.entries(rows)) {
    if (want && want !== id) continue;
    bad = [];
    try { await fn(); } catch (e) { harness++; console.log(`HARNESS-ERROR ${id} ${title}: ${e instanceof Harness ? e.message : e.stack}`); continue; }
    if (bad.length) { failed++; console.log(`FAIL ${id} ${title}`); bad.forEach(l => console.log(l)); } else console.log(`PASS ${id} ${title}`);
  }
  skips.forEach(s => console.log(`SKIP ${s}`));
  try { removeTree(arena, { recursive: true, force: true }); } catch (e) { console.log(`note: temp folder left: ${arena} (${e.code})`); }
  process.exitCode = harness ? 3 : failed ? 1 : 0;
})();
