#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
// T-0359: split CI work across parallel jobs. Until 1.36.300 each Windows gate job ran e2e.js (167-226 min) and the
//   command-surface leaves (43-52 min) one after the other, and the Windows fast job ran its leaves for 79 min, so a
//   release waited about five hours for CI (run 38193803239). A shard runs part of that work. Shards 1..k of one job
//   together run every unit exactly once, because every shard computes the same assignment from the same inputs:
//   the units in source order, weighted by measured seconds (scripts/ci-shard-weights.json), placed largest first on
//   the least-loaded shard, ties to the earlier unit and the lower shard.
//
//   node ./scripts/ci-shard.js npm <script> <i>/<k>    run the leaves of an npm script that shard i of k owns
//   node ./scripts/ci-shard.js plan npm <script> <k>   print the assignment
//   node ./scripts/ci-shard.js plan e2e <k>            print the assignment of the e2e.js cases
//   node ./scripts/ci-shard.js weights e2e|npm <times.json>...   replace weights with measured seconds, written by
//                                                       LEERNESS_E2E_TIMES=<file> (e2e.js) or LEERNESS_CI_SHARD_TIMES=<file>
//
// A leaf is `node <file> [args]`, or `npm run <name>`, which is expanded. Any other shape is refused rather than
//   guessed: running it differently from npm would test something else. Leaves run with node directly, in the
//   package root, in their order in the script. A shard runs all of its leaves and fails if any failed, so one CI
//   run reports every failing leaf of the shard (a plain `&&` chain stops at the first).
// T-0357: each leaf records the temp folders it makes (scripts/temp-cleanup.js trackTemp, into a directory this runner
//   gives it through LEERNESS_TEMP_RECORD), and the runner removes them after the leaf ended with status 0, no signal
//   and no spawn error: the verdict it uses for pass/fail, read from the exit status, which no code in the leaf can
//   change afterwards. A failed leaf's folders are kept for inspection.
// e2e.js uses e2eShard() below: each top-level case is `if (e2eShard.take('<key>')) {`, and finish() checks that the
//   file has no unguarded top-level block and that every guard was reached exactly once.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const temp = require('./temp-cleanup');

const ROOT = path.resolve(__dirname, '..');
const WEIGHTS_FILE = path.join(__dirname, 'ci-shard-weights.json');

function parseShard(text) {
  const m = /^([1-9]\d{0,2})\/([1-9]\d{0,2})$/.exec(String(text == null ? '' : text).trim());
  if (!m || Number(m[1]) > Number(m[2])) throw new Error(`shard must be i/k with 1 <= i <= k, got "${text}"`);
  return { index: Number(m[1]), count: Number(m[2]) };
}

// units: [{ key, weight }] in source order. Returns the shard (1..count) of each unit and each shard's load.
function assign(units, count) {
  for (const u of units) {
    if (!(typeof u.weight === 'number' && Number.isFinite(u.weight) && u.weight >= 0)) throw new Error(`bad weight for ${u.key}: ${u.weight}`);
  }
  const order = units.map((u, i) => i).sort((a, b) => (units[b].weight - units[a].weight) || (a - b));
  const load = new Array(count).fill(0);
  const shardOf = new Array(units.length);
  for (const i of order) {
    let best = 0;
    for (let s = 1; s < count; s++) if (load[s] < load[best]) best = s;
    shardOf[i] = best + 1;
    load[best] += units[i].weight;
  }
  return { shardOf, load };
}

function loadWeights(file = WEIGHTS_FILE) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const kind of ['e2e', 'npm']) {
    const table = data[kind];
    if (!table || typeof table !== 'object' || Array.isArray(table)) throw new Error(`${path.basename(file)}: "${kind}" table missing`);
    for (const [key, value] of Object.entries(table)) {
      if (!(typeof value === 'number' && Number.isFinite(value) && value >= 0)) throw new Error(`${path.basename(file)}: bad ${kind} weight for ${key}`);
    }
  }
  return data;
}

// A unit without a measurement weighs the median of its table, so a new case or leaf lands like an ordinary one.
function weigh(keys, table) {
  const values = Object.values(table).sort((a, b) => a - b);
  const median = values.length ? values[Math.floor(values.length / 2)] : 1;
  const plain = key => key.replace(/ #\d+$/, '');
  return keys.map(key => ({ key, weight: Object.prototype.hasOwnProperty.call(table, key) ? table[key]
    : Object.prototype.hasOwnProperty.call(table, plain(key)) ? table[plain(key)] : median }));
}

// Measured seconds (the LEERNESS_E2E_TIMES / LEERNESS_CI_SHARD_TIMES files) replace those units' weights; the
//   table is kept sorted so a refresh diffs cleanly. A repeated leaf (`<text> #2`) is stored under its text.
function withMeasured(data, kind, measured) {
  const table = { ...data[kind] };
  let updated = 0;
  for (const times of measured) {
    for (const [key, seconds] of Object.entries(times)) {
      if (!(typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0)) throw new Error(`bad seconds for ${key}: ${seconds}`);
      table[key.replace(/ #\d+$/, '')] = Math.round(seconds * 10) / 10; updated++;
    }
  }
  const sorted = Object.fromEntries(Object.entries(table).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { data: { ...data, [kind]: sorted }, updated };
}

function uniqueKeys(texts) {
  const seen = new Map();
  return texts.map(text => { const n = (seen.get(text) || 0) + 1; seen.set(text, n); return n === 1 ? text : `${text} #${n}`; });
}

// ---- npm script leaves ----
const LEAF_TOKEN = /^[\w./:=@+-]+$/;

function npmLeaves(scripts, name, stack = []) {
  if (!Object.prototype.hasOwnProperty.call(scripts, name)) throw new Error(`npm script not found: ${name}`);
  if (stack.includes(name)) throw new Error(`npm script cycle: ${[...stack, name].join(' -> ')}`);
  // `npm run <name>` also runs pre<name> and post<name> (review round 1). This runner does not run lifecycle
  //   scripts, so a script that has one is refused instead of losing it.
  for (const hook of [`pre${name}`, `post${name}`]) {
    if (Object.prototype.hasOwnProperty.call(scripts, hook)) {
      throw new Error(`unsupported npm script ${name}: npm would also run its lifecycle script ${hook}, which ci-shard.js does not run`);
    }
  }
  const out = [];
  for (const part of String(scripts[name]).split('&&').map(p => p.trim())) {
    const nested = /^npm run ([\w:.-]+)$/.exec(part);
    if (nested) { out.push(...npmLeaves(scripts, nested[1], [...stack, name])); continue; }
    const argv = part.split(/\s+/);
    if (argv[0] !== 'node' || argv.length < 2 || !argv.every(t => LEAF_TOKEN.test(t)) || argv[1].startsWith('-')) {
      throw new Error(`unsupported step in npm script ${name}: "${part}" (expected node <file> [args] or npm run <name>)`);
    }
    out.push({ text: argv.join(' '), file: argv[1], args: argv.slice(2), from: name });
  }
  return out;
}

function readScripts() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').replace(/^\uFEFF/, '')).scripts || {};
}

function planNpm(scripts, name, count, weights) {
  const leaves = npmLeaves(scripts, name);
  const keys = uniqueKeys(leaves.map(l => l.text));
  const units = weigh(keys, weights.npm);
  const { shardOf, load } = assign(units, count);
  return { leaves: leaves.map((l, i) => ({ ...l, key: keys[i], weight: units[i].weight, shard: shardOf[i] })), load };
}

function runNpm(name, spec, opts = {}) {
  const root = opts.root || ROOT;
  const env = opts.env || process.env;
  const scripts = opts.scripts || readScripts();
  const weights = opts.weights || loadWeights();
  const { leaves } = planNpm(scripts, name, spec.count, weights);
  const mine = leaves.filter(l => l.shard === spec.index);
  const log = opts.log || (line => process.stdout.write(line + '\n'));
  const grouped = env.GITHUB_ACTIONS === 'true';
  // Leaves do not see this runner's times file: a leaf that runs runNpm itself (ci-shard-probe.js) would overwrite it.
  const leafEnv = { ...env };
  for (const k of Object.keys(leafEnv)) if (['LEERNESS_CI_SHARD_TIMES', temp.RECORD_ENV].includes(k.toUpperCase())) delete leafEnv[k];
  log(`ci-shard: ${name} shard ${spec.index}/${spec.count} runs ${mine.length} of ${leaves.length} leaves`);
  // T-0357: one record directory per leaf, below a root this runner makes. Each is checked right after it is made (an
  //   empty directory, not a link, its identity kept): a wrapper of fs.mkdtempSync or fs.mkdirSync installed before
  //   the runner could put an existing folder there (1.36.304 review round 3). A leaf whose directory fails the check
  //   gets no variable and records nothing; only checked directories are removed, and the root only when it is empty.
  const freshDir = d => {
    try {
      const st = fs.lstatSync(d, { bigint: true });
      return st.isSymbolicLink() || !st.isDirectory() || fs.readdirSync(d).length ? null : temp.ownTree(d);
    } catch { return null; }
  };
  let recordRoot = null;
  try { recordRoot = freshDir(fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-temp-record-'))); } catch { /* nothing recorded */ }
  const tempCount = { removed: 0, left: 0, unrecorded: 0 };
  const results = [];
  for (const [i, leaf] of mine.entries()) {
    if (grouped) log(`::group::${leaf.key}`);
    let recordDir = null;
    if (recordRoot) { const d = path.join(recordRoot.dir, String(i)); try { fs.mkdirSync(d); recordDir = freshDir(d); } catch { /* nothing recorded */ } }
    if (!recordDir) tempCount.unrecorded++;
    const started = Date.now();
    const r = cp.spawnSync(process.execPath, [path.resolve(root, leaf.file), ...leaf.args], { cwd: root, stdio: opts.stdio || 'inherit', env: recordDir ? { ...leafEnv, [temp.RECORD_ENV]: recordDir.dir } : leafEnv });
    const seconds = (Date.now() - started) / 1000;
    const ok = r.status === 0 && !r.signal && !r.error;
    if (ok && recordDir) { const t = temp.removeRecorded(recordDir.dir); tempCount.removed += t.removed; tempCount.left += t.left; }
    if (recordDir) try { temp.removeOwnedTree(recordDir, { timeoutMs: 2000 }); } catch { /* left behind */ }
    results.push({ key: leaf.key, ok, seconds, status: r.status, signal: r.signal || null, error: r.error ? String(r.error.code || r.error.message) : null });
    if (grouped) log('::endgroup::');
    log(`ci-shard: ${ok ? 'ok  ' : 'FAIL'} ${seconds.toFixed(1).padStart(7)} s  ${leaf.key}${ok ? '' : ` (exit ${r.status}${r.signal ? `, signal ${r.signal}` : ''}${r.error ? `, ${r.error.code || r.error.message}` : ''})`}`);
  }
  if (recordRoot) {
    try {
      const st = fs.lstatSync(recordRoot.dir, { bigint: true });
      if (!st.isSymbolicLink() && st.dev === recordRoot.dev && st.ino === recordRoot.ino) fs.rmdirSync(recordRoot.dir);
    } catch { /* not empty or replaced: left behind */ }
  }
  const failed = results.filter(r => !r.ok);
  const total = results.reduce((s, r) => s + r.seconds, 0);
  log(`ci-shard: ${name} shard ${spec.index}/${spec.count}: ${results.length - failed.length}/${results.length} leaves passed · ${total.toFixed(0)} s`);
  for (const f of failed) log(`ci-shard: failed: ${f.key}`);
  log(`ci-shard: temp folders: ${tempCount.removed} removed after passing leaves${tempCount.left ? `, ${tempCount.left} left (replaced, outside the temp directory, or still held)` : ''}${tempCount.unrecorded ? `, ${tempCount.unrecorded} leaves not recorded (their record directory was not the one made)` : ''}; a failed leaf keeps its own`);
  if (env.LEERNESS_CI_SHARD_TIMES) {
    fs.writeFileSync(env.LEERNESS_CI_SHARD_TIMES, JSON.stringify(Object.fromEntries(results.map(r => [r.key, Math.round(r.seconds * 10) / 10])), null, 1) + '\n');
  }
  return { ran: results.length, of: leaves.length, failed: failed.map(f => f.key), results };
}

// ---- e2e.js cases ----
// A case is a top-level `if (e2eShard.take('<key>')) {` block. Its text, for the check below, runs to the next guard:
//   a column-0 `}` can sit inside a template literal, and a short text could hide a mention.
// The helper is created by one line naming the file's shared top-level state (the fixture project and its helpers,
//   whose state one case leaves for the next). Every case whose text mentions one of those names runs in the same
//   shard as the others, in source order; the other cases are placed one by one.
const GUARD = /^if \(e2eShard\.take\('([^'\\\n]+)'\)\) \{$/;
const CREATE = /^const e2eShard = require\('\.\/ci-shard'\)\.e2eShard\(__filename, \[((?:'[\w$]+'(?:, )?)*)\]\);$/;
const SHARED_GROUP = '(cases using the shared fixture)';
// A case's block ends at its first column-0 `}`. The cases start after the line `// e2e-shard: cases start here`;
//   from there, top-level code outside a case only prepares what later cases use (smoke `run()` calls, fixture files,
//   environment switches). A block, a control-flow block, an immediately invoked function or a case counter there is
//   a case without a guard: review round 1 found a block opened by `{ // comment`, round 2 an `if (false) {` in place
//   of the first guard (the boundary was the first guard then). Whatever wraps a case, its `total++` stays outside
//   a guard and is reported. The preamble above the line may use any statement except a bare block. The run-wide
//   section, from a column-0 `setImmediate(` to its column-0 `});` (a comment may follow), ends the file; each of
//   its own counters carries `// e2e-shard: run-wide check`.
const CASES_START = /^\/\/ e2e-shard: cases start here\b/;
const RUN_WIDE_CHECK = /\/\/ e2e-shard: run-wide check\s*$/;
const CASE_COUNTER = /(^|[^\w$.])total\s*(?:\+\+|\+=)/;
const OUTSIDE_A_CASE = [
  [/^\s*\{/, 'a block'],
  [/^\s*(?:if|else|for|while|do|try|switch)\b.*\{\s*(?:\/\/.*)?$/, 'a control-flow block'],
  [/^\s*[(!;+~-]\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)/, 'an immediately invoked function'],
  [CASE_COUNTER, 'a case counter'],
];

function e2eCases(source) {
  const lines = String(source).replace(/\r\n/g, '\n').split('\n');
  const keys = [], problems = [], at = new Map(), text = new Map();
  let shared = null, current = null, inCase = false, casesStarted = false, runWide = false, runWideEnded = false;
  lines.forEach((line, i) => {
    const c = CREATE.exec(line);
    if (c) {
      if (shared) problems.push(`line ${i + 1}: a second e2eShard(...) line`);
      shared = [...c[1].matchAll(/'([\w$]+)'/g)].map(m => m[1]);
      return;
    }
    const m = GUARD.exec(line);
    if (m) {
      if (!casesStarted) problems.push(`line ${i + 1}: case "${m[1]}" before the line "// e2e-shard: cases start here"`);
      if (runWide) problems.push(`line ${i + 1}: case "${m[1]}" in or after the run-wide section`);
      if (inCase) problems.push(`line ${i + 1}: case "${m[1]}" starts inside case "${current}"`);
      if (at.has(m[1])) { problems.push(`key "${m[1]}" repeats (lines ${at.get(m[1])} and ${i + 1})`); current = null; }
      else { at.set(m[1], i + 1); keys.push(m[1]); current = m[1]; text.set(current, []); }
      inCase = true;
      return;
    }
    if (current) text.get(current).push(line);
    if (/e2eShard\.take\(/.test(line) && !/^\s*\/\//.test(line)) {
      problems.push(`line ${i + 1}: e2eShard.take outside the guard form "if (e2eShard.take('<key>')) {"`);
      return;
    }
    if (inCase) { if (/^\}/.test(line)) inCase = false; return; }
    if (CASES_START.test(line)) {
      if (casesStarted) problems.push(`line ${i + 1}: a second "cases start here" line`);
      casesStarted = true;
      return;
    }
    if (runWideEnded) {
      if (line.trim() && !/^\s*\/\//.test(line)) problems.push(`line ${i + 1}: code after the run-wide section`);
      return;
    }
    if (runWide) {
      // Review round 3: `}); // end` left the section open, so a case after it was exempt.
      if (/^\}\)\s*;?\s*(?:\/\/.*|\/\*.*\*\/\s*)?$/.test(line)) { runWideEnded = true; return; }
      // The section's own checks say so; any other counter there is a case without a guard.
      if (CASE_COUNTER.test(line) && !RUN_WIDE_CHECK.test(line)) {
        problems.push(`line ${i + 1}: a case counter in the run-wide section without "// e2e-shard: run-wide check"`);
      }
      return;
    }
    if (casesStarted && /^setImmediate\(/.test(line)) { runWide = true; return; }
    if (/^\s*\/\//.test(line)) return;
    for (const [re, what] of casesStarted ? OUTSIDE_A_CASE : OUTSIDE_A_CASE.slice(0, 1)) {
      if (re.test(line)) { problems.push(`line ${i + 1}: ${what} outside a case, without an e2eShard.take guard`); break; }
    }
  });
  if (!casesStarted) problems.push('no line "// e2e-shard: cases start here"');
  if (runWide && !runWideEnded) problems.push('the run-wide section (column-0 "setImmediate(") never closes with a column-0 "});"');
  if (!shared) { problems.push("no line \"const e2eShard = require('./ci-shard').e2eShard(__filename, [<shared names>]);\""); shared = []; }
  const mentions = shared.map(n => new RegExp(`(^|[^\\w$.])${n.replace(/\$/g, '\\$')}([^\\w$]|$)`, 'm'));
  const usesShared = new Set(keys.filter(k => { const t = text.get(k).join('\n'); return mentions.some(re => re.test(t)); }));
  return { keys, problems, shared, usesShared };
}

function planE2e(source, count, weights) {
  const { keys, problems, shared, usesShared } = e2eCases(source);
  const weighed = weigh(keys, weights.e2e);
  // One unit for the cases using shared state, at the position of the first of them; one unit per other case.
  const units = [], unitOf = new Map();
  weighed.forEach(u => {
    if (!usesShared.has(u.key)) { unitOf.set(u.key, units.length); units.push({ key: u.key, weight: u.weight }); return; }
    if (!unitOf.has(SHARED_GROUP)) { unitOf.set(SHARED_GROUP, units.length); units.push({ key: SHARED_GROUP, weight: 0 }); }
    units[unitOf.get(SHARED_GROUP)].weight += u.weight;
    unitOf.set(u.key, unitOf.get(SHARED_GROUP));
  });
  const { shardOf, load } = assign(units, count);
  return { cases: weighed.map(u => ({ key: u.key, weight: u.weight, shared: usesShared.has(u.key), shard: shardOf[unitOf.get(u.key)] })),
    load, problems, shared };
}

function e2eShard(file, shared, env = process.env, opts = {}) {
  const raw = env.LEERNESS_E2E_SHARD;
  const timesOut = env.LEERNESS_E2E_TIMES || null;
  // Children see the environment of an unsharded run: a test that starts this file again runs all of it.
  delete env.LEERNESS_E2E_SHARD; delete env.LEERNESS_E2E_TIMES;
  const spec = raw === undefined || raw === '' ? null : parseShard(raw);
  const source = fs.readFileSync(file, 'utf8');
  const parsed = e2eCases(source);
  const { keys, problems } = parsed;
  if (JSON.stringify(shared) !== JSON.stringify(parsed.shared)) problems.push(`shared names passed (${JSON.stringify(shared)}) differ from the file's e2eShard line (${JSON.stringify(parsed.shared)})`);
  const known = new Set(keys);
  let mine = null;
  if (spec) {
    const { cases } = planE2e(source, spec.count, opts.weights || loadWeights());
    mine = new Set(cases.filter(c => c.shard === spec.index).map(c => c.key));
  }
  const reached = new Map(), times = {};
  let current = null, since = 0;
  const stop = () => { if (current !== null) times[current] = Math.round((times[current] || 0) * 10 + (Date.now() - since) / 100) / 10; current = null; };
  return {
    spec,
    take(key) {
      stop();
      reached.set(key, (reached.get(key) || 0) + 1);
      // A key the parser did not see (a guard in another form) runs in every shard: finish() fails the run, but no
      //   shard drops the case.
      const run = !mine || mine.has(key) || !known.has(key);
      if (run) { current = key; since = Date.now(); }
      return run;
    },
    finish() {
      stop();
      const missing = keys.filter(k => !reached.has(k));
      const repeated = [...reached].filter(([, n]) => n > 1).map(([k]) => k);
      const unknown = [...reached.keys()].filter(k => !known.has(k));
      if (timesOut) { try { fs.writeFileSync(timesOut, JSON.stringify(times, null, 1) + '\n'); } catch (e) { problems.push(`times file not written: ${e.message}`); } }
      const ok = !problems.length && !missing.length && !repeated.length && !unknown.length;
      return { ok, spec, ran: mine ? keys.filter(k => mine.has(k)).length + unknown.length : keys.length, total: keys.length, problems, missing, repeated, unknown };
    },
  };
}

// ---- .github/workflows/ci.yml shard lists ----
// The jobs of a workflow written the way ci.yml is: two-space job keys under `jobs:`, matrix entries as one-line flow
//   mappings (`- { os: windows-latest, node: 18, shard: 1, shards: 4 }`), steps with `run:` and `env:` lines.
//   Returns { <job>: { entries: [{ key: value }], runs: [command], lines: [line] } }.
function workflowJobs(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const jobs = {};
  let job = null, inJobs = false;
  for (const line of lines) {
    if (/^\S/.test(line)) { inJobs = line === 'jobs:'; job = null; continue; }
    if (!inJobs) continue;
    const head = /^ {2}([\w-]+):\s*$/.exec(line);
    if (head) { job = jobs[head[1]] = { entries: [], runs: [], lines: [] }; continue; }
    if (!job) continue;
    job.lines.push(line);
    const entry = /^\s+- \{ (.+) \}\s*$/.exec(line);
    if (entry) {
      job.entries.push(Object.fromEntries(entry[1].split(/,\s*/).map(pair => {
        const at = pair.indexOf(':');
        return at < 0 ? [pair.trim(), ''] : [pair.slice(0, at).trim(), pair.slice(at + 1).trim()];
      })));
      continue;
    }
    const run = /^\s+(?:- )?run:\s*(.+?)\s*$/.exec(line);
    if (run) job.runs.push(run[1]);
  }
  return jobs;
}

// The configurations of a job's entries (an entry without shard/shards), and for a sharded job the configurations
//   whose entries are not exactly shards 1..k of one k.
function shardLists(entries) {
  const groups = new Map();
  for (const e of entries) {
    const { shard, shards, ...config } = e;
    const id = Object.entries(config).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(' ');
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({ shard, shards });
  }
  const problems = [];
  for (const [id, list] of groups) {
    const k = Number(list[0].shards);
    const got = list.map(x => Number(x.shard)).sort((a, b) => a - b);
    const sameK = list.every(x => x.shards === list[0].shards);
    if (!sameK || !Number.isInteger(k) || k < 1 || got.length !== k || got.some((s, i) => s !== i + 1)) {
      problems.push(`${id}: ${list.map(x => `${x.shard}/${x.shards}`).join(', ')}`);
    }
  }
  return { configs: [...groups.keys()], problems };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'npm' && rest.length === 2) {
    const r = runNpm(rest[0], parseShard(rest[1]));
    return r.failed.length ? 1 : 0;
  }
  if (cmd === 'plan' && ((rest[0] === 'npm' && rest.length === 3) || (rest[0] === 'e2e' && rest.length === 2))) {
    const count = parseShard(`1/${rest[rest.length - 1]}`).count;
    const weights = loadWeights();
    const plan = rest[0] === 'npm' ? planNpm(readScripts(), rest[1], count, weights)
      : planE2e(fs.readFileSync(path.join(__dirname, 'e2e.js'), 'utf8'), count, weights);
    const units = plan.leaves || plan.cases;
    for (let s = 1; s <= count; s++) {
      const own = units.filter(u => u.shard === s);
      console.log(`shard ${s}/${count}: ${own.length} units, ${(plan.load[s - 1] / 60).toFixed(1)} min measured`);
      for (const u of own) console.log(`  ${u.weight.toFixed(1).padStart(8)} s  ${u.shared ? '[shared] ' : ''}${u.key}`);
    }
    if (plan.shared) console.log(`shared names: ${plan.shared.join(', ')}; cases using them: ${plan.cases.filter(c => c.shared).length}`);
    for (const p of plan.problems || []) console.log(`problem: ${p}`);
    return plan.problems && plan.problems.length ? 1 : 0;
  }
  if (cmd === 'weights' && ['e2e', 'npm'].includes(rest[0]) && rest.length >= 2) {
    const measured = rest.slice(1).map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
    const { data, updated } = withMeasured(loadWeights(), rest[0], measured);
    fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(data, null, 1) + '\n');
    console.log(`ci-shard: ${updated} ${rest[0]} weights updated in ${path.relative(ROOT, WEIGHTS_FILE)}`);
    return 0;
  }
  console.error('usage: ci-shard.js npm <script> <i>/<k> | plan npm <script> <k> | plan e2e <k> | weights e2e|npm <times.json>...');
  return 2;
}

module.exports = { parseShard, assign, loadWeights, weigh, withMeasured, uniqueKeys, npmLeaves, planNpm, runNpm, e2eCases, planE2e, e2eShard,
  workflowJobs, shardLists, WEIGHTS_FILE };

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(`ci-shard: ${e.message}`); process.exitCode = 2; }
}
