'use strict';
// leerness loop (design .leerness/loop-guard-design-20261025.md): a durable round counter per subject. It records and surfaces
// repeated review or fix rounds; it needs agent compliance and prevents nothing by itself.
// One ledger per repository, <git-common-dir>/leerness/control/projects/<projectKey>/loop-ledger.json, so every worktree sees it;
// outside git it is <project>/.leerness/loop-ledger.json. Every path component below the canonical base is checked with lstat before
// anything is created, locked or read; writes reuse withStateLock and captureMemoryOutput/publishMemoryOutput.
// Process contract (review r3 F01) is about OWNERSHIP, not a list of programs: this module starts no process and imports no process API.
// `loop status` reaches git only through the shared gateway (state-paths -> state-git -> git -> portable-process), shared with every command that
// resolves the repository. What the gateway launches depends on how `git` resolves on the host (native git; on Windows `where.exe git` first; a shim
// may run `node <script>` or another executable; an unresolved or unsupported shim ends in its refusal helper) and is not constrained here. open,
// round and decide read the admission snapshot of the CLI process, which ran that gateway chain once before this module; on Windows the shared write
// primitive (lib/io.js) also runs PowerShell to replace an existing ledger. Handoff and session close start nothing. LG10 judges who spawned each launch it observes (the seven child_process functions it wraps).
const fs = require('fs');
const path = require('path');
const { CANONICAL_WORKSPACE_DIR } = require('./workspace-dir');
const { _parseAddTitle, _lineSafe } = require('./pure-utils');
const { projectKeyFor } = require('./project-key');

const SCHEMA = 'leerness.loop-ledger/v1', OUT_SCHEMA = 'leerness.loop/v1';
const MAX_BYTES = 262144, DEFAULT_CAP = 3, MAX_EXTENSIONS = 2, MAX_ROUNDS = 16, MAX_LOOPS = 32, MAX_DECISIONS = 8;
const CHOICES = ['accept-residual', 'cut', 'redesign', 'park', 'extend'];
const ID = /^L-\d{4,}$/, SPOT = /^[a-z0-9][a-z0-9._:/-]{0,63}$/;

class LoopError extends Error { constructor(code, details = {}) { super(code); this.code = code; Object.assign(this, details); } }
const cps = s => Array.from(s).length;
const FORMAT = /\p{Cf}/u;   // bidi controls, zero-width characters, byte-order mark, tag characters, soft hyphen (emoji joiners too, on purpose)
const unclean = s => cps(s) === 0 || _lineSafe(s) !== s || FORMAT.test(s);   // empty, or holds a control or a format character
const clip = (s, n = 60) => { const p = Array.from(_lineSafe(s)); return p.length > n ? p.slice(0, n).join('') + '…' : p.join(''); };
const subj = l => `"${clip(l.subject)}"`;
const counted = l => l.rounds.filter(r => !r.overCap).length;
const bySpot = l => { const m = new Map(); for (const r of l.rounds) if (!r.overCap && r.result === 'no-go') m.set(r.spot, [...(m.get(r.spot) || []), r.n]); return m; };
const stopSpot = l => (l.stop && l.rounds[l.stop.round - 1] ? l.rounds[l.stop.round - 1].spot : null);

// ---- arguments: positional list from the dispatcher (with its `--` position), flag(name) -> string|null, has(name) -> boolean
function parse(args, flag, has) {
  const usage = field => new LoopError('loop_usage', { field });
  const sub = args[1] === undefined ? 'status' : String(args[1]);
  if (!['open', 'round', 'decide', 'status'].includes(sub)) throw usage('subcommand');
  if (sub === 'open') {
    const raw = _parseAddTitle(args, 2), subject = raw.replace(/\s+/g, ' ').trim();
    if (FORMAT.test(raw) || unclean(subject) || cps(subject) > 120) throw usage('subject');   // a byte-order mark inside the subject is white space for \s: look before it is collapsed (at either end the argument trim has already removed it)
    return { action: 'open', subject, subjectKey: subject.normalize('NFC').toLowerCase() };
  }
  const id = args[2];
  if (args.length > 3 || (id !== undefined && !ID.test(id))) throw usage('id');
  if (sub === 'status') return { action: 'status', id: id || null, strict: has('--strict-exit') };
  if (id === undefined) throw usage('id');
  const text = (name, max) => { const v = flag(name); if (v !== null && (unclean(v) || cps(v) > max)) throw usage(name); return v; };
  if (sub === 'round') {
    const result = flag('--result') === null ? 'no-go' : flag('--result'), spot = flag('--spot') === null ? null : flag('--spot').toLowerCase(), findings = flag('--findings');
    if (!['no-go', 'go'].includes(result)) throw usage('--result');
    if (result === 'go' ? spot !== null || findings !== null : spot === null) throw usage('--spot');
    if (spot !== null && !SPOT.test(spot)) throw usage('--spot');
    if (findings !== null && !/^(0|[1-9]\d{0,2})$/.test(findings)) throw usage('--findings');
    return { action: 'round', id, result, spot, findings: findings === null ? null : Number(findings), note: text('--note', 120) };
  }
  const choice = flag('--choice'), quote = text('--quote', 300), add = flag('--add');
  if (!CHOICES.includes(choice)) throw usage('--choice');
  if (quote === null) throw usage('--quote');
  if (choice === 'extend' ? !['1', '2'].includes(add) : add !== null) throw usage('--add');
  return { action: 'decide', id, choice, quote, add: add === null ? null : Number(add) };
}

// ---- ledger: validation on every read (exact key sets and types, limits, ids, rounds 1..n, state invariants, cap)
const fresh = () => ({ schema: SCHEMA, createdAt: new Date().toISOString(), rev: 0, nextId: 1, loops: [] });
function validate(v) {
  const corrupt = field => new LoopError('loop_ledger_corrupt', { field });
  const exact = (o, keys, field) => { if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).length !== keys.length || !keys.every(k => k in o)) throw corrupt(field); };
  const iso = (s, field) => { const ms = typeof s === 'string' ? Date.parse(s) : NaN; if (Number.isNaN(ms) || new Date(ms).toISOString() !== s) throw corrupt(field); };   // exactly what the writer emits
  const int = (n, lo, hi, field) => { if (!Number.isSafeInteger(n) || n < lo || n > hi) throw corrupt(field); };
  const text = (s, max, field) => { if (typeof s !== 'string' || unclean(s) || cps(s) > max) throw corrupt(field); };
  exact(v, ['schema', 'createdAt', 'rev', 'nextId', 'loops'], 'ledger');
  if (v.schema !== SCHEMA) throw corrupt('schema');
  iso(v.createdAt, 'createdAt'); int(v.rev, 0, Number.MAX_SAFE_INTEGER, 'rev'); int(v.nextId, 1, Number.MAX_SAFE_INTEGER, 'nextId');
  if (!Array.isArray(v.loops) || v.loops.length > MAX_LOOPS) throw corrupt('loops');
  const ids = new Set();
  for (const l of v.loops) {
    exact(l, ['id', 'subject', 'subjectKey', 'openedAt', 'cap', 'extensions', 'state', 'stop', 'rounds', 'decisions', 'closedAt', 'outcome'], 'loop');
    if (typeof l.id !== 'string' || !ID.test(l.id) || Number(l.id.slice(2)) >= v.nextId || ids.has(l.id)) throw corrupt('id');
    ids.add(l.id);
    text(l.subject, 120, 'subject');
    if (l.subject !== l.subject.replace(/\s+/g, ' ').trim() || l.subjectKey !== l.subject.normalize('NFC').toLowerCase()) throw corrupt('subjectKey');
    iso(l.openedAt, 'openedAt'); int(l.cap, 1, 1000, 'cap'); int(l.extensions, 0, MAX_EXTENSIONS, 'extensions');
    if (!['open', 'stopped', 'closed'].includes(l.state)) throw corrupt('state');
    if (l.stop !== null) { exact(l.stop, ['reason', 'round'], 'stop'); int(l.stop.round, 1, MAX_ROUNDS, 'stop'); if (!['cap_reached', 'same_spot'].includes(l.stop.reason)) throw corrupt('stop'); }
    if ((l.state === 'stopped') !== (l.stop !== null)) throw corrupt('stop');
    if (l.outcome !== null && !['passed', ...CHOICES.filter(c => c !== 'extend')].includes(l.outcome)) throw corrupt('outcome');
    if ((l.state === 'closed') !== (l.outcome !== null) || (l.state === 'closed') !== (l.closedAt !== null)) throw corrupt('outcome');
    if (l.closedAt !== null) iso(l.closedAt, 'closedAt');
    if (!Array.isArray(l.rounds) || l.rounds.length > MAX_ROUNDS || !Array.isArray(l.decisions) || l.decisions.length > MAX_DECISIONS) throw corrupt('rounds');
    l.rounds.forEach((r, i) => {
      exact(r, ['n', 'at', 'result', 'spot', 'findings', 'note', 'overCap'], 'round');
      if (r.n !== i + 1 || !['no-go', 'go'].includes(r.result) || typeof r.overCap !== 'boolean') throw corrupt('round');
      iso(r.at, 'round.at');
      if (r.spot !== null && !(typeof r.spot === 'string' && SPOT.test(r.spot))) throw corrupt('round.spot');
      if (r.findings !== null) int(r.findings, 0, 999, 'round.findings');
      if (r.note !== null) text(r.note, 120, 'round.note');
    });
    let cap = DEFAULT_CAP, extensions = 0;
    for (const d of l.decisions) {
      exact(d, ['at', 'choice', 'add', 'capAfter', 'quote'], 'decision');
      iso(d.at, 'decision.at'); text(d.quote, 300, 'decision.quote');
      if (!CHOICES.includes(d.choice)) throw corrupt('decision.choice');
      if (d.choice === 'extend') { if (![1, 2].includes(d.add)) throw corrupt('decision.add'); int(d.capAfter, 1, 1000, 'decision.capAfter'); if (d.capAfter > cap + d.add) throw corrupt('decision.capAfter'); cap = d.capAfter; extensions++; }
      else if (d.add !== null || d.capAfter !== null) throw corrupt('decision.add');
    }
    if (l.cap !== cap || l.extensions !== extensions) throw corrupt('cap');
    if (l.decisions.length !== extensions + (l.state === 'closed' && l.outcome !== 'passed' ? 1 : 0)) throw corrupt('decisions');   // each extension, plus the closing choice
    if (counted(l) > l.cap) throw corrupt('rounds');   // review r2 F01: a counted round past the cap is a state the writer never makes, whatever the state
    if (l.state === 'open' && (counted(l) >= l.cap || l.rounds.length + l.cap - counted(l) > MAX_ROUNDS)) throw corrupt('rounds');   // an open loop can still reach its cap inside the stored-round limit, so a STOP is never lost there
  }
}
function parseLedger(bytes) {
  let text, v;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new LoopError('loop_ledger_corrupt', { field: 'encoding' }); }
  try { v = JSON.parse(text); } catch { throw new LoopError('loop_ledger_corrupt', { field: 'json' }); }
  validate(v);
  return v;
}
function serialize(ledger) {   // oldest closed loops make room; nothing else is ever dropped
  for (;;) {
    const text = JSON.stringify(ledger, null, 1) + '\n';
    if (ledger.loops.length <= MAX_LOOPS && Buffer.byteLength(text) <= MAX_BYTES) return text;
    const i = ledger.loops.findIndex(l => l.state === 'closed');
    if (i < 0) throw new LoopError('loop_ledger_limit');
    ledger.loops.splice(i, 1);
  }
}

// ---- where the ledger lives, and the component walk below the canonical base
const sameKey = (a, b) => (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));
const realRoot = root => fs.realpathSync.native(path.resolve(root));
const admitted = projectRoot => require('./runtime-writes').runtimeWriteAdmissions().map(a => a.snapshot).find(s => s && s.root && sameKey(s.root, projectRoot));   // this process's admission snapshot: the topology without a git process
function place(projectRoot, git) {
  const loc = git
    ? { scope: 'git-common', base: git.gitCommonDir, parts: ['leerness', 'control', 'projects', projectKeyFor(path.relative(git.worktreeRoot, projectRoot).split(path.sep).join('/') || '.'), 'loop-ledger.json'] }
    : { scope: 'project-local', base: projectRoot, parts: [CANONICAL_WORKSPACE_DIR, 'loop-ledger.json'] };
  return { ...loc, file: path.join(loc.base, ...loc.parts) };
}
function locate(root) {
  try {
    const projectRoot = realRoot(root), own = admitted(projectRoot);
    return place(projectRoot, own ? own.git : require('./state-paths').resolveStatePaths(projectRoot).git);
  } catch (e) {
    if (e && (e.name === 'StatePathError' || e.code === 'ENOENT' || e.code === 'ENOTDIR')) throw new LoopError(`loop_ledger_unavailable:${e.name === 'StatePathError' ? e.code : 'path_not_found'}`);
    throw e;
  }
}
function walk(loc, create) {   // ENOENT = absent (nothing created unless `create`, one component at a time); a link or foreign kind = unsafe
  let dir = loc.base;
  for (let i = 0; i < loc.parts.length; i++) {
    const here = path.join(dir, loc.parts[i]), last = i === loc.parts.length - 1;
    let st;
    try { st = fs.lstatSync(here); } catch (e) {
      if (e.code !== 'ENOENT') throw new LoopError('loop_ledger_unreadable');
      if (last || !create) return { present: false };
      try { fs.mkdirSync(here); } catch (m) { if (m.code !== 'EEXIST') throw m; }
      i--; continue;
    }
    if (st.isSymbolicLink() || (last ? !st.isFile() || (!create && st.nlink !== 1) : !st.isDirectory())) throw new LoopError('loop_ledger_unsafe');
    dir = here;
  }
  return { present: true };
}
const fromIo = e => {
  const c = e && e.code;
  if (e instanceof LoopError) return e;
  if (c === 'E_STORE_LIMIT' || c === 'E_OUTPUT_LIMIT') return new LoopError('loop_ledger_too_large');
  if (c === 'E_STORE_CORRUPT') return new LoopError('loop_ledger_corrupt', { field: 'encoding' });
  if (c === 'E_STORE_INVALID') return new LoopError('loop_ledger_unsafe');
  if (c === 'E_STORE_CHANGED' || c === 'E_OUTPUT_CHANGED') return new LoopError('loop_ledger_changed');
  return c && /^E_STORE_/.test(c) ? new LoopError('loop_ledger_unreadable') : e;
};

// ---- the state machine (rounds, STOP, decisions); returns what happened, never prints
function find(ledger, id) { const l = ledger.loops.find(x => x.id === id); if (!l) throw new LoopError('loop_not_found', { id }); return l; }
function apply(ledger, op, now) {
  const at = now.toISOString();
  if (op.action === 'open') {
    const hit = ledger.loops.find(l => l.subjectKey === op.subjectKey && l.state !== 'closed');
    if (hit) return { changed: false, existing: true, loop: hit, stop: hit.state === 'stopped', reason: hit.stop && hit.stop.reason };
    if (!Number.isSafeInteger(ledger.nextId + 1)) throw new LoopError('loop_limit');
    const loop = { id: `L-${String(ledger.nextId).padStart(4, '0')}`, subject: op.subject, subjectKey: op.subjectKey, openedAt: at, cap: DEFAULT_CAP, extensions: 0, state: 'open', stop: null, rounds: [], decisions: [], closedAt: null, outcome: null };
    const stoppedElsewhere = ledger.loops.filter(l => l.state === 'stopped');
    ledger.nextId += 1; ledger.loops.push(loop);
    return { changed: true, existing: false, loop, stop: false, stoppedElsewhere };
  }
  const loop = find(ledger, op.id);
  if (loop.state === 'closed') throw new LoopError('loop_closed', { id: loop.id });
  if (op.action === 'decide') {
    if (op.choice === 'extend') {
      if (loop.state !== 'stopped') throw new LoopError('loop_not_stopped', { id: loop.id });
      if (loop.extensions >= MAX_EXTENSIONS) throw new LoopError('loop_extend_limit', { id: loop.id });
      if (loop.rounds.length + op.add > MAX_ROUNDS) throw new LoopError('loop_extend_round_limit', { id: loop.id, rounds: loop.rounds.length, add: op.add });   // the loop would reach the round limit without a STOP on record
      Object.assign(loop, { cap: counted(loop) + op.add, extensions: loop.extensions + 1, state: 'open', stop: null });
      loop.decisions.push({ at, choice: 'extend', add: op.add, capAfter: loop.cap, quote: op.quote });
    } else {
      Object.assign(loop, { state: 'closed', stop: null, outcome: op.choice, closedAt: at });
      loop.decisions.push({ at, choice: op.choice, add: null, capAfter: null, quote: op.quote });
    }
    return { changed: true, loop, stop: false };
  }
  const stopped = loop.state === 'stopped';
  if (loop.rounds.length >= MAX_ROUNDS) return { changed: false, loop, stop: true, reason: 'round_limit' };
  if (stopped && op.result === 'go') return { changed: false, loop, stop: true, reason: loop.stop.reason };   // a go never clears a STOP
  const round = { n: loop.rounds.length + 1, at, result: op.result, spot: op.spot, findings: op.findings, note: op.note, overCap: stopped };
  loop.rounds.push(round);
  if (stopped) return { changed: true, loop, round, stop: true, reason: loop.stop.reason };
  if (op.result === 'go') { Object.assign(loop, { state: 'closed', outcome: 'passed', closedAt: at }); return { changed: true, loop, round, stop: false }; }
  const same = bySpot(loop).get(op.spot), reason = same.length >= 3 ? 'same_spot' : counted(loop) >= loop.cap ? 'cap_reached' : null;
  if (reason) Object.assign(loop, { state: 'stopped', stop: { reason, round: round.n } });
  return { changed: true, loop, round, stop: !!reason, reason, repeat: same.length === 2 ? same : null };
}

// ---- reading and writing the ledger file
function read(root, op) {   // observation only: no lock, nothing created
  const loc = locate(root);
  try {
    const w = walk(loc, false);
    let ledger = null;
    if (w.present) { const got = require('./memory-input').captureCheckedFileInput(loc.file, { maxBytes: MAX_BYTES }); if (got.exists) ledger = parseLedger(got.bytes); }
    const all = ledger ? ledger.loops : [];
    const loops = op.id ? [find({ loops: all }, op.id)] : all.filter(l => l.state !== 'closed');
    const stop = loops.some(l => l.state === 'stopped');
    return { scope: loc.scope, state: ledger ? 'present' : 'absent', loops, stop, code: op.strict && stop ? 3 : 0, counts: { stopped: all.filter(l => l.state === 'stopped').length, open: all.filter(l => l.state === 'open').length, closed: all.filter(l => l.state === 'closed').length } };
  } catch (e) { const mapped = fromIo(e); throw mapped instanceof LoopError ? Object.assign(mapped, { file: loc.file }) : mapped; }
}
function mutate(root, op, hooks = {}) {
  const loc = locate(root);
  let afterPublish = false, out;
  try {
    walk(loc, true);
    require('./state-lock').withStateLock(loc.file, () => {
      walk(loc, false);   // a publish killed between its link and its unlink leaves two names and taking the lock removes one, so with `create` the two-link check runs here
      const { captureMemoryOutput, publishMemoryOutput } = require('./memory-output');
      const token = captureMemoryOutput(loc.file, { maxBytes: MAX_BYTES });
      const ledger = token.exists ? parseLedger(token.bytes) : fresh();
      out = apply(ledger, op, new Date());
      if (!out.changed) return;
      if (!Number.isSafeInteger(ledger.rev + 1)) throw new LoopError('loop_rev_limit');
      ledger.rev += 1;
      if (hooks.beforePublish) hooks.beforePublish(ledger);
      const text = serialize(ledger);
      try { parseLedger(Buffer.from(text)); } catch (e) { throw e instanceof LoopError && e.code === 'loop_ledger_corrupt' ? new LoopError('loop_result_unreadable', { field: e.field }) : e; }   // the writer publishes only text the reader accepts
      const published = publishMemoryOutput(token, loc.file, text);
      afterPublish = true;
      out.recoveryArtifacts = (published.recoveryArtifacts || []).map(a => a.path || String(a));
      if (hooks.afterPublish) hooks.afterPublish();
    });
  } catch (e) {
    const c = e && e.code;
    const uncertain = afterPublish || (e && (e.outputPublished || e.outputMutationStarted)) || c === 'E_LOCK_RELEASE' || c === 'E_LOCK_OWNERSHIP_LOST';
    const mapped = uncertain ? new LoopError('loop_write_uncertain', { cause: c || 'E_AFTER_PUBLISH', outputPublished: !!(afterPublish || e.outputPublished), outputMutationStarted: !!e.outputMutationStarted, recoveryArtifacts: (e.recoveryArtifacts || []).map(a => a.path || String(a)), lockPath: e.lockPath || null, releasePath: e.releasePath || null })
      : c === 'E_LOCK_TIMEOUT' ? new LoopError('loop_ledger_locked', { lockPath: e.lockPath, detail: e.message }) : fromIo(e);
    if (mapped instanceof LoopError) throw Object.assign(mapped, { file: loc.file });
    throw mapped;   // E_DRY_RUN_WRITE, E_RUNTIME_LAYOUT_INCOMPATIBLE and anything unexpected reach the CLI's own handlers
  }
  return Object.assign(out, { scope: loc.scope, code: out.stop ? 3 : 0, recoveryArtifacts: out.recoveryArtifacts || [] });
}

// ---- output: ko/en text, the owner card and the JSON document
function renderer(lang, now) {
  const t = (ko, en) => (lang === 'en' ? en : ko);
  const age = ms => (ms < 0 ? t('알 수 없음', 'unknown') : ms >= 864e5 ? `${Math.floor(ms / 864e5)}d ${Math.floor(ms % 864e5 / 36e5)}h` : ms >= 36e5 ? `${Math.floor(ms / 36e5)}h` : `${Math.floor(ms / 6e4)}m`);
  const stamp = s => `${s.slice(0, 10)} ${s.slice(11, 16)}Z`;
  const why = (l, reason) => (reason === 'same_spot' ? t(`spot ${stopSpot(l)} 3회 실패`, `spot ${stopSpot(l)} failed 3 times`)
    : reason === 'round_limit' ? t('저장 회차 한도(16)', 'stored round limit (16)') : t(`${counted(l)}/${l.cap}회 도달`, `round ${counted(l)} of ${l.cap}`));
  const card = l => {
    const stopped = l.state === 'stopped', vals = l.rounds.filter(r => r.findings !== null).map(r => r.findings), shown = l.rounds.slice(-10);
    const states = { open: t('진행 중', 'open'), stopped: t('중단', 'stopped'), closed: t('종료', 'closed') };
    const first = Date.parse(l.openedAt), last = l.rounds.length ? Date.parse(l.rounds[l.rounds.length - 1].at) : null;
    const lines = [`LOOP CARD ${l.id}${stopped ? ' - ' + t('소유자 결정 필요', 'owner decision required') : ''}`, `${t('주제', 'Subject')}: ${subj(l)}`,
      `${t('상태', 'State')}: ${states[l.state]} (${t(`${counted(l)}/${l.cap}회`, `round ${counted(l)} of ${l.cap}`)}) | ${t(`연장 ${l.extensions}/2`, `extensions ${l.extensions} of 2`)}`,
      `${t('시작', 'Opened')}: ${stamp(l.openedAt)} (${age(now - first)}${t(' 전', ' ago')})${last === null ? '' : ` | ${t('회차 소요', 'rounds took')} ${age(last - first)} | ${t('마지막 회차', 'last round')} ${age(now - last)}${t(' 전', ' ago')}`}`,
      `${t('회차', 'Rounds')}:`];
    if (l.rounds.length > shown.length) lines.push(t(`  (이전 ${l.rounds.length - shown.length}회차)`, `  (${l.rounds.length - shown.length} earlier rounds)`));
    for (const r of shown) lines.push(`  ${r.n}  ${stamp(r.at)}  ${r.result === 'go' ? 'go' : `spot ${r.spot}`}${r.findings === null ? '' : `  ${t('지적', 'findings')} ${r.findings}`}${r.note === null ? '' : `  "${clip(r.note)}"`}${r.overCap ? `  ${t('한도 초과', 'over cap')}` : ''}`);
    for (const [spot, ns] of bySpot(l)) if (ns.length >= 2) lines.push(`${t('같은 지점 반복', 'Same spot again')}: ${spot} (${t('회차', 'rounds')} ${ns.join(', ')})`);
    if (vals.length) lines.push(`${t('지적 수', 'Findings')}: ${vals.join(' -> ')} (${vals.length < 2 ? t('알 수 없음', 'unknown') : vals[vals.length - 1] < vals[vals.length - 2] ? t('줄어듦', 'falling') : t('줄지 않음', 'not falling')})`);
    if (l.decisions.length) lines.push(`${t('기록된 소유자 결정', 'Recorded owner decisions')}:`, ...l.decisions.map(d => `  ${stamp(d.at)}  ${d.choice}${d.add ? ` +${d.add}` : ''}  "${clip(d.quote, 120)}"`));
    if (stopped) {
      const room = l.extensions < MAX_EXTENSIONS ? Math.min(2, MAX_ROUNDS - l.rounds.length) : 0;   // the largest extension the writer would accept
      const reset = l.stop.reason === 'same_spot' ? `; ${t(`연장해도 spot ${stopSpot(l)} 은 초기화되지 않음`, `extend does not reset spot ${stopSpot(l)}`)}` : '';
      lines.push(`${t('선택지', 'Choices')}: accept-residual, cut, redesign, park${room ? ', extend --add ' + (room === 2 ? '1|2' : '1') + reset : ''}`,
        `${t('뜻', 'Meaning')}: ${t('accept-residual=남은 지적을 알고 이대로 마침, cut=남은 부분을 범위에서 뺌, redesign=접근을 바꿔 다시 설계, park=나중으로 미룸', 'accept-residual = finish with the remaining findings known, cut = drop the remaining part from scope, redesign = change the approach, park = defer it')}${room ? t(', extend=회차를 더 허용', ', extend = allow more rounds') : ''}`,
        `${t('소유자 답 기록', "Record the owner's answer")}: leerness loop decide ${l.id} --choice <choice> --quote "<owner's words>"`);
    }
    return lines;
  };
  return {
    card, scope: s => (s === 'git-common' ? t('Loop ledger: 이 저장소의 모든 worktree 가 공유', 'Loop ledger: shared by all worktrees of this repository') : t('Loop ledger: 프로젝트 로컬 (worktree 간 공유 안 됨)', 'Loop ledger: project-local (not shared across worktrees)')),
    opened: l => t(`LOOP ${l.id} 열림: ${subj(l)} (한도 ${l.cap}회). 끝난 실패 회차마다: leerness loop round ${l.id} --spot <key>`, `LOOP ${l.id} opened: ${subj(l)} (cap ${l.cap}). After each completed failed cycle: leerness loop round ${l.id} --spot <key>`),
    elsewhere: ls => t(`중단된 loop 가 있습니다: ${ls.slice(0, 3).map(x => `${x.id} ${subj(x)}`).join(', ')}. 같은 일을 이름만 바꿔 다시 연 것이면 이 loop 를 쓰지 말고 그 카드를 소유자에게 보여 주세요: leerness loop status ${ls[0].id}`,
      `A stopped loop exists: ${ls.slice(0, 3).map(x => `${x.id} ${subj(x)}`).join(', ')}. If this is the same work under a new name, do not use this loop; show the owner that card: leerness loop status ${ls[0].id}`),
    existing: l => t(`LOOP ${l.id} 이 이 주제로 이미 열려 있습니다 (${counted(l)}/${l.cap}회). ${l.id} 을 계속 쓰세요.`, `LOOP ${l.id} is already open for this subject (${counted(l)}/${l.cap} rounds); keep using ${l.id}.`),
    round: (l, r) => t(`LOOP ${l.id} ${counted(l)}/${l.cap}회 기록 (spot ${r.spot}). STOP 까지 ${l.cap - counted(l)}회 남음.`, `LOOP ${l.id} round ${counted(l)} of ${l.cap} recorded (spot ${r.spot}). ${l.cap - counted(l)} left before STOP.`),
    repeat: (spot, [a, b]) => t(`REPEAT spot ${spot} (${a}, ${b}회차): 구조를 바꾸고 세 번째 땜질을 하지 마세요.`, `REPEAT spot ${spot} (rounds ${a}, ${b}): change the structure; do not add a third patch.`),
    stop: (l, reason) => [t(`LOOP STOP ${l.id} ${subj(l)}: ${why(l, reason)}. 소유자 결정이 필요합니다. 프로젝트 룰은 결정이 아닙니다.`, `LOOP STOP ${l.id} ${subj(l)}: ${why(l, reason)}. Owner decision required; a project rule is not a decision.`),
      t('이 주제의 작업을 멈추고 다른 승인된 작업을 계속하며, 이 카드를 소유자에게 보여 주고 답을 leerness loop decide 로 기록하세요.', 'Stop work on this subject, continue other authorized work, show the owner this card and record the answer with leerness loop decide.'), '', ...card(l)],
    passed: (l, r) => t(`LOOP ${l.id} 종료: ${r.n}/${l.cap}회차에 통과.`, `LOOP ${l.id} closed: passed at round ${r.n} of ${l.cap}.`),
    decided: (l, d) => (d.choice === 'extend' ? t(`LOOP ${l.id} ${d.add}회 연장 (한도 ${l.cap}). 소유자 원문을 기록했습니다.`, `LOOP ${l.id} extended by ${d.add} (cap ${l.cap}). Owner quote recorded.`)
      : t(`LOOP ${l.id} 종료: ${d.choice}. 소유자 원문을 기록했습니다.`, `LOOP ${l.id} closed: ${d.choice}. Owner quote recorded.`)),
    artifacts: paths => t(`복구용 파일 보존: ${paths.join(', ')}`, `Recovery files kept: ${paths.join(', ')}`),
    none: t('열린 loop 또는 중단된 loop 가 없습니다.', 'No open or stopped loops.'),
    error: (e, op) => {
      const f = e.file ? ` (${e.file})` : '', id = op && op.id ? op.id : '<id>';
      const table = {
        loop_usage: [`인자가 올바르지 않습니다: ${e.field}${e.field === '--spot' ? ' (영문 소문자·숫자 키, 예: design-doc)' : ''}. 확인: leerness loop open|round|decide|status`, `Invalid argument: ${e.field}${e.field === '--spot' ? ' (lowercase ASCII key, for example design-doc)' : ''}. See: leerness loop open|round|decide|status`],
        loop_not_found: [`해당 loop 가 없습니다: ${e.id}`, `No such loop: ${e.id}`],
        loop_closed: [`Loop ${e.id} 는 종료됐습니다. 새 loop 를 여세요.`, `Loop ${e.id} is closed; open a new loop for further rounds.`],
        loop_not_stopped: [`Loop ${e.id} 는 중단 상태가 아닙니다. 연장은 STOP 뒤에만 가능합니다.`, `Loop ${e.id} is not stopped; extend is allowed only after a STOP.`],
        loop_extend_limit: [`Loop ${e.id} 는 이미 두 번 연장됐습니다. accept-residual, cut, redesign, park 중 고르세요.`, `Loop ${e.id} was already extended twice; choose accept-residual, cut, redesign or park.`],
        loop_extend_round_limit: [`Loop ${e.id} 에는 회차가 이미 ${e.rounds}/${MAX_ROUNDS}개 저장돼 있어 ${e.add}회 연장을 기록할 수 없습니다. STOP 은 그대로 남습니다. 더 작은 --add 가 맞으면 그것을 쓰고, 아니면 accept-residual, cut, redesign, park 중 고르세요.`,
          `Loop ${e.id} already stores ${e.rounds} of ${MAX_ROUNDS} rounds, so an extension by ${e.add} cannot be recorded; the STOP stays. Use a smaller --add if one fits, or choose accept-residual, cut, redesign or park.`],
        loop_rev_limit: [`Loop ledger 의 수정 번호가 최대값에 닿아 더 기록할 수 없습니다${f}. 바뀐 것은 없습니다. 파일을 옮겨 두면 새로 시작합니다 (회차 기록은 사라집니다).`, `The loop ledger revision counter is at its maximum, so nothing more can be recorded${f}; nothing was changed. Move the file aside to start a new ledger (its rounds are lost).`],
        loop_limit: ['더 이상 loop id 를 만들 수 없습니다.', 'No more loop ids can be allocated.'],
        loop_result_unreadable: [`이 변경은 이 버전이 읽을 수 없는 Loop ledger 를 만들게 되어 기록하지 않았습니다 (필드: ${e.field})${f}. 바뀐 것은 없습니다.`, `This change would produce a loop ledger this version cannot read (field: ${e.field})${f}; nothing was changed.`],
        loop_ledger_corrupt: [`Loop ledger 가 손상됐습니다 (필드: ${e.field})${f}. 바뀐 것은 없습니다. 처음부터 하려면 파일을 옮겨 두세요 (회차 기록은 사라집니다).`, `Loop ledger is corrupt (field: ${e.field})${f}; it was not changed. Move the file aside to start over (its rounds are lost).`],
        loop_ledger_too_large: [`Loop ledger 가 ${MAX_BYTES} 바이트를 넘습니다${f}. 바뀐 것은 없습니다.`, `Loop ledger exceeds ${MAX_BYTES} bytes${f}; it was not changed.`],
        loop_ledger_unsafe: [`Loop ledger 경로에 링크이거나 일반 항목이 아닌 부분이 있어 아무것도 만들거나 잠그거나 읽지 않았습니다${f}.`, `A part of the loop ledger path is a link or not a regular entry; nothing was created, locked or read${f}.`],
        loop_ledger_unreadable: [`Loop ledger 경로를 읽을 수 없습니다${f}. 바뀐 것은 없습니다.`, `The loop ledger path cannot be read${f}; nothing was changed.`],
        loop_ledger_limit: [`Loop ledger 한도(${MAX_LOOPS}개 loop, ${MAX_BYTES} 바이트)에 닿았고 정리할 종료된 loop 가 없습니다. 바뀐 것은 없습니다.`, `The loop ledger limit (${MAX_LOOPS} loops, ${MAX_BYTES} bytes) is reached and no closed loop can make room; nothing was changed.`],
        loop_ledger_changed: ['작업하는 동안 Loop ledger 가 바뀌었습니다. 바뀐 것은 없으니 다시 시도하세요.', 'The loop ledger changed during the operation; nothing was changed, retry.'],
        loop_ledger_locked: [e.detail, e.detail],
        loop_write_uncertain: [`LOOP WRITE UNCERTAIN (${e.cause}): 변경이 저장됐을 수 있습니다. 다시 하기 전에 leerness loop status ${id} 를 확인하고, 이미 기록돼 있으면 다시 기록하지 마세요.`, `LOOP WRITE UNCERTAIN (${e.cause}): the change may have been saved. Run leerness loop status ${id} before retrying; do not record the round again if it is listed.`],
      };
      const pair = table[e.code] || [`Loop ledger 위치를 알 수 없습니다 (${e.code.replace(/^[^:]*:/, '')}). 다른 위치는 쓰지 않았습니다.`, `The loop ledger location is unavailable (${e.code.replace(/^[^:]*:/, '')}); no other location was used.`];
      return t(...pair) + (e.recoveryArtifacts && e.recoveryArtifacts.length ? '\n' + t(`복구용 파일 보존: ${e.recoveryArtifacts.join(', ')}`, `Recovery files kept: ${e.recoveryArtifacts.join(', ')}`) : '');
    },
  };
}
function view(l, now) {
  const last = l.rounds.length ? l.rounds[l.rounds.length - 1] : null, elapsed = Math.floor((now - Date.parse(l.openedAt)) / 1000);
  return { id: l.id, subject: l.subject, state: l.state, cap: l.cap, extensions: l.extensions, rounds: l.rounds.length, counted: counted(l), openedAt: l.openedAt, lastRoundAt: last ? last.at : null,
    elapsedSeconds: elapsed < 0 ? null : elapsed, spots: [...bySpot(l)].map(([spot, ns]) => ({ spot, count: ns.length })), findings: l.rounds.filter(r => !r.overCap && r.findings !== null).map(r => r.findings),
    stop: l.stop, decisions: l.decisions, outcome: l.outcome };
}
function document(op, out, now) {
  const head = { schema: OUT_SCHEMA, ok: true, action: op.action, ...(op.action === 'open' ? { existing: out.existing, ...(out.stoppedElsewhere && out.stoppedElsewhere.length ? { stoppedElsewhere: out.stoppedElsewhere.map(x => x.id) } : {}) } : {}), stop: !!out.stop, reason: out.reason || null };
  if (op.action === 'status') return { ...head, loops: out.loops.map(l => view(l, now)), ...out.counts, ledger: { scope: out.scope, state: out.state }, recoveryArtifacts: [] };
  const round = out.round ? { round: { n: out.round.n, spot: out.round.spot, findings: out.round.findings, result: out.round.result, overCap: out.round.overCap, repeat: !!out.repeat } } : {};
  return { ...head, ...round, loop: view(out.loop, now), ledger: { scope: out.scope, state: 'present' }, recoveryArtifacts: out.recoveryArtifacts };
}
function textOf(op, out, r) {
  const l = out.loop;
  if (op.action === 'status') return out.loops.length ? [r.scope(out.scope), ...out.loops.flatMap(x => ['', ...(x.state === 'stopped' ? r.stop(x, x.stop.reason) : r.card(x))])] : [r.none];
  if (op.action === 'open') return !out.existing ? [r.opened(l), ...(out.stoppedElsewhere.length ? [r.elsewhere(out.stoppedElsewhere)] : [])] : out.stop ? r.stop(l, out.reason) : [r.existing(l)];
  if (op.action === 'decide') return [r.decided(l, op)];
  const repeat = out.repeat ? [r.repeat(out.round.spot, out.repeat)] : [];
  if (out.stop) return [...repeat, ...r.stop(l, out.reason)];
  return out.round.result === 'go' ? [r.passed(l, out.round)] : [r.round(l, out.round), ...repeat];
}

// ---- handoff and session close: at most three stopped loops (then a count of the rest) and three open loops. Nothing is printed when no ledger exists, and nothing is created,
// locked or run (no git process, no lib/git.js): the topology is the caller's. Session close and `handoff --inspect` pass their runtime admission
// snapshot (summaryFor); a default read has no admission and passes the git topology of its stored-read snapshot. The ledger is read on its own and
// is never part of that snapshot's revalidation.
function admittedTopology(root) {
  try { const own = admitted(realRoot(root)); return own ? { git: own.git } : undefined; } catch { return undefined; }
}
function summary(root, topology, lang) {
  const t = (ko, en) => (lang === 'en' ? en : ko), doc = { schema: 'leerness.loop-summary/v1', state: 'absent', scope: null, error: null, open: [], stopped: [] }, quotes = {};
  let loc = null, ledger = null;
  if (!fs.existsSync(root)) return { doc, lines: [] };   // a path that is not there has no ledger; realRoot would call that unreadable
  try {
    if (!topology) throw new LoopError('loop_ledger_unavailable:topology');
    loc = place(realRoot(root), topology.git);
    doc.scope = loc.scope;
    if (walk(loc, false).present) { const got = require('./memory-input').captureCheckedFileInput(loc.file, { maxBytes: MAX_BYTES }); if (got.exists) ledger = parseLedger(got.bytes); }
  } catch (e) { const mapped = fromIo(e); doc.state = 'unreadable'; doc.error = mapped instanceof LoopError ? mapped.code : 'loop_ledger_unreadable'; }
  if (ledger) {
    doc.state = 'present';
    for (const l of ledger.loops) {
      const over = l.rounds.length - counted(l), row = { id: l.id, subject: l.subject, rounds: counted(l), cap: l.cap, ...(over ? { overCap: over } : {}) }, last = l.decisions[l.decisions.length - 1];
      if (l.state === 'stopped') doc.stopped.push({ ...row, reason: l.stop.reason });
      else if (l.state === 'open') { doc.open.push(row); if (last && last.choice === 'extend') quotes[l.id] = last.quote; }
    }
  }
  const lines = doc.stopped.slice(0, 3).map(s => t(`LOOP STOP ${s.id} ${subj(s)} ${s.rounds}/${s.cap}회${s.overCap ? ` (한도 뒤 ${s.overCap}회 더 진행)` : ''} - 소유자 결정 필요: leerness loop status ${s.id}`, `LOOP STOP ${s.id} ${subj(s)} ${s.rounds}/${s.cap} rounds${s.overCap ? ` (${s.overCap} more after the cap)` : ''} - owner decision required: leerness loop status ${s.id}`));
  if (doc.stopped.length > 3) lines.push(t(`외 ${doc.stopped.length - 3}건: leerness loop status`, `and ${doc.stopped.length - 3} more: leerness loop status`));
  for (const o of doc.open.slice(0, 3)) {
    const q = quotes[o.id] === undefined ? '' : t(` - 연장 원문 기록: "${clip(quotes[o.id], 40)}"`, ` - extension quote recorded: "${clip(quotes[o.id], 40)}"`);
    lines.push(t(`LOOP ${o.id} ${subj(o)} ${o.rounds}/${o.cap}회 - 끝난 실패 회차마다: leerness loop round ${o.id} --spot <key>`, `LOOP ${o.id} ${subj(o)} ${o.rounds}/${o.cap} rounds - after each completed failed cycle: leerness loop round ${o.id} --spot <key>`) + q);
  }
  if (doc.state === 'unreadable') lines.push(t(`LOOP LEDGER UNREADABLE (${doc.error}): ${loc ? _lineSafe(loc.file) : '(unknown)'} - 회차 한도를 확인할 수 없습니다. 소유자에게 알리세요`, `LOOP LEDGER UNREADABLE (${doc.error}): ${loc ? _lineSafe(loc.file) : '(unknown)'} - round limits cannot be checked; tell the owner`));
  return { doc, lines };
}
const summaryFor = (root, lang) => summary(root, admittedTopology(root), lang);

// The managed AGENTS.md paragraph (standard mode only; lib/loop-guard is not loaded by generation otherwise).
const projectGuidance = lang => (lang === 'en'
  ? '\n## Loop limit\nBefore a second review of the same document or code, or a second fix of the same verifier, run `leerness loop open "<subject>"` once and reuse its id (a new version label is the same subject). Record each completed failed cycle once, earlier ones included: `leerness loop round <id> --spot <key>` (bookkeeping is not a cycle). Exit 3 = STOP.\n'
  : '\n## 반복 회차 한도\n같은 문서·코드의 두 번째 검수나 같은 검사 도구의 두 번째 수리 전에 `leerness loop open "<주제>"` 를 한 번 실행하고 그 id 를 계속 씁니다(판 번호가 바뀌어도 같은 주제). 이미 끝난 것도 포함해 실패한 회차마다 한 번 `leerness loop round <id> --spot <key>` 를 실행합니다(기록·조회·정정은 회차가 아님). 종료 코드 3 = STOP.\n');

function cli(args, ctx) {
  const io = require('./io');
  let op, out;
  try {
    op = parse(args, ctx.flag, ctx.has);
    if (op.action !== 'status' && ctx.requireInit && !ctx.requireInit(ctx.root, `loop ${op.action}`)) return;
    out = op.action === 'status' ? read(ctx.root, op) : mutate(ctx.root, op);
  } catch (e) {
    if (!(e instanceof LoopError)) throw e;
    const extra = e.code === 'loop_write_uncertain' ? { outputPublished: e.outputPublished, outputMutationStarted: e.outputMutationStarted, recoveryArtifacts: e.recoveryArtifacts, lockPath: e.lockPath, releasePath: e.releasePath } : e.code === 'loop_ledger_locked' ? { lockPath: e.lockPath } : null;
    if (ctx.json) e.file = null;   // the absolute path is for human output only
    return io.failJson(ctx.json, e.code, renderer(ctx.lang, Date.now()).error(e, op), extra);
  }
  const now = new Date(), r = renderer(ctx.lang, now.getTime());
  if (ctx.json) io.log(JSON.stringify(document(op, out, now.getTime()), null, 2));
  else io.log([...textOf(op, out, r), ...(out.recoveryArtifacts && out.recoveryArtifacts.length ? [r.artifacts(out.recoveryArtifacts)] : [])].join('\n'));
  if (out.code) process.exitCode = out.code;
}

module.exports = { cli, mutate, read, parse, validate, summary, summaryFor, admittedTopology, projectGuidance, LoopError };
