#!/usr/bin/env node
'use strict';
// T-0359: CI runs e2e.js cases and npm-script leaves in parallel shards (scripts/ci-shard.js). A shard that drops a
//   unit fails nothing — the unit silently stops running — so this probe checks the parts that decide what runs:
//   the assignment is a deterministic partition, every leaf of the real sharded scripts parses and lands in exactly
//   one shard, the e2e guard parser and runtime helper catch unguarded, repeated, unreached and unknown cases, and
//   the workflow lists every shard of every configuration. Each detector is also run on a broken input.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cs = require('./ci-shard');

const ROOT = path.resolve(__dirname, '..');
const results = [];
const check = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, ok: false }); console.log(`FAIL ${name}: ${e && e.message}`); }
};
// Deterministic pseudo-random weights (no Math.random: a failure must reproduce).
const prng = seed => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const workflowText = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
const weights = cs.loadWeights();
const e2eSource = fs.readFileSync(path.join(__dirname, 'e2e.js'), 'utf8');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ci-shard-probe-'));

try {
  check('parseShard accepts i/k with 1 <= i <= k and refuses the rest', () => {
    assert.deepStrictEqual(cs.parseShard('3/4'), { index: 3, count: 4 });
    assert.deepStrictEqual(cs.parseShard(' 1/1 '), { index: 1, count: 1 });
    for (const bad of ['', '0/2', '3/2', '1/0', 'a/b', '1/2/3', '2', '-1/2', '1.5/2', undefined, null]) {
      assert.throws(() => cs.parseShard(bad), /shard must be/, `accepted ${bad}`);
    }
  });

  check('assign is a deterministic partition with the greedy load bound', () => {
    const rand = prng(7);
    for (let round = 0; round < 200; round++) {
      const n = 1 + Math.floor(rand() * 60), k = 1 + Math.floor(rand() * 8);
      const units = Array.from({ length: n }, (_, i) => ({ key: `u${i}`, weight: Math.floor(rand() * 1000) / 10 }));
      const a = cs.assign(units, k), b = cs.assign(units.map(u => ({ ...u })), k);
      assert.deepStrictEqual(a.shardOf, b.shardOf, 'same input, different assignment');
      assert.strictEqual(a.shardOf.length, n);
      assert(a.shardOf.every(s => Number.isInteger(s) && s >= 1 && s <= k), 'shard out of range');
      const load = new Array(k).fill(0);
      a.shardOf.forEach((s, i) => { load[s - 1] += units[i].weight; });
      load.forEach((l, i) => assert(Math.abs(l - a.load[i]) < 1e-9, 'reported load differs'));
      const sum = units.reduce((s, u) => s + u.weight, 0), max = Math.max(...units.map(u => u.weight));
      assert(Math.max(...load) <= sum / k + max + 1e-9, 'greedy bound exceeded');
    }
    // Equal weights: source order, round robin from shard 1 (ties to the earlier unit and the lower shard).
    const even = cs.assign(Array.from({ length: 7 }, (_, i) => ({ key: `e${i}`, weight: 5 })), 3).shardOf;
    assert.deepStrictEqual(even, [1, 2, 3, 1, 2, 3, 1]);
    for (const w of [NaN, -1, Infinity, '3', null]) assert.throws(() => cs.assign([{ key: 'x', weight: w }], 2), /bad weight/);
  });

  check('weights file has both tables; an unmeasured unit weighs the median', () => {
    assert(Object.keys(weights.e2e).length > 0 && Object.keys(weights.npm).length > 0, 'empty weights table');
    const units = cs.weigh(['a', 'b #2', 'zzz'], { a: 1, b: 10, c: 4 });
    assert.deepStrictEqual(units.map(u => u.weight), [1, 10, 4]);
    const before = { _about: 'x', e2e: { b: 2, a: 1 }, npm: { n: 3 } };
    const { data, updated } = cs.withMeasured(before, 'e2e', [{ c: 4.04, 'a #2': 7 }, { b: 0 }]);
    assert.strictEqual(updated, 3);
    assert.deepStrictEqual(data, { _about: 'x', e2e: { a: 7, b: 0, c: 4 }, npm: { n: 3 } });
    assert.deepStrictEqual(Object.keys(data.e2e), ['a', 'b', 'c'], 'table not sorted');
    assert.deepStrictEqual(before.e2e, { b: 2, a: 1 }, 'input mutated');
    assert.throws(() => cs.withMeasured(before, 'npm', [{ x: -1 }]), /bad seconds/);
  });

  check('npm leaves: nested expansion in order, refused shapes, cycles', () => {
    const fixture = {
      all: 'node a.js && npm run inner && node ./c.js --x=1',
      inner: 'node b.js && npm run deeper',
      deeper: 'node d.js selftest',
      loop1: 'npm run loop2', loop2: 'npm run loop1',
    };
    assert.deepStrictEqual(cs.npmLeaves(fixture, 'all').map(l => l.text),
      ['node a.js', 'node b.js', 'node d.js selftest', 'node ./c.js --x=1']);
    assert.throws(() => cs.npmLeaves(fixture, 'loop1'), /cycle: loop1 -> loop2 -> loop1$/);
    assert.throws(() => cs.npmLeaves(fixture, 'missing'), /not found/);
    // `npm run X` also runs preX and postX; the runner refuses a script with one, at any depth.
    for (const [hooks, hook] of [[{ preinner: 'node pre.js' }, 'preinner'], [{ postdeeper: 'node post.js' }, 'postdeeper'],
      [{ preall: 'node pre.js' }, 'preall'], [{ postall: 'node post.js' }, 'postall']]) {
      assert.throws(() => cs.npmLeaves({ ...fixture, ...hooks }, 'all'), new RegExp(`lifecycle script ${hook}`), `hook ${hook} not refused`);
    }
    for (const step of ['echo hi', 'node a.js | tee x', 'cross-env A=1 node a.js', 'node "a b.js"', 'npm run all -- --y',
      'node --inspect a.js', 'node', 'node a.js; node b.js', 'node a.js > out', 'A=1 node a.js', 'node $FILE', 'npm test']) {
      assert.throws(() => cs.npmLeaves({ s: step }, 's'), /unsupported step|cycle/, `accepted: ${step}`);
    }
  });

  // The sharded scripts are the ones the workflow names in its ci-shard.js run lines.
  const jobs = cs.workflowJobs(workflowText);
  const sharded = [];
  for (const job of Object.values(jobs)) {
    for (const run of job.runs) {
      const m = /^node \.\/scripts\/ci-shard\.js npm (\S+) \$\{\{ matrix\.shard \}\}\/\$\{\{ matrix\.shards \}\}$/.exec(run);
      if (m) sharded.push(m[1]);
    }
  }

  check('every leaf of each sharded npm script runs in exactly one shard, in script order', () => {
    assert(sharded.length >= 2, `expected the workflow to shard at least two npm scripts, found ${sharded.join(', ')}`);
    for (const name of sharded) {
      const full = cs.npmLeaves(scripts, name).map(l => l.text);
      assert(full.length > 0, `${name} has no leaves`);
      for (let k = 1; k <= 6; k++) {
        const plan = cs.planNpm(scripts, name, k, weights);
        const union = [];
        for (let i = 1; i <= k; i++) union.push(...plan.leaves.filter(l => l.shard === i).map(l => l.key));
        assert.deepStrictEqual([...union].sort(), cs.uniqueKeys(full).sort(), `${name} ${k} shards: leaves lost or repeated`);
        assert.deepStrictEqual(plan.leaves.map(l => l.text), full, `${name}: plan changed the leaf order`);
      }
    }
  });

  check('runNpm runs only its shard, keeps going after a failure, and reports it', () => {
    const dir = path.join(arena, 'npm');
    fs.mkdirSync(dir);
    for (const [name, code] of [['a', 0], ['b', 3], ['c', 0], ['d', 0]]) {
      fs.writeFileSync(path.join(dir, `${name}.js`), `require('fs').writeFileSync(${JSON.stringify(path.join(dir, `${name}.ran`))}, '1'); process.exit(${code});\n`);
    }
    const fixture = { suite: 'node ./a.js && node ./b.js && npm run more', more: 'node ./c.js && node ./d.js' };
    const w = { e2e: {}, npm: { 'node ./a.js': 4, 'node ./b.js': 3, 'node ./c.js': 2, 'node ./d.js': 1 } };
    const lines = [];
    const quiet = { root: dir, scripts: fixture, weights: w, stdio: 'ignore', env: { ...process.env, GITHUB_ACTIONS: '' }, log: l => lines.push(l) };
    const one = cs.runNpm('suite', { index: 1, count: 1 }, quiet);
    assert.strictEqual(one.ran, 4); assert.deepStrictEqual(one.failed, ['node ./b.js']);
    assert(['a', 'b', 'c', 'd'].every(n => fs.existsSync(path.join(dir, `${n}.ran`))), 'a leaf after the failure did not run');
    assert(lines.some(l => /FAIL .*node \.\/b\.js \(exit 3\)/.test(l)), 'failure line missing');
    for (const n of ['a', 'b', 'c', 'd']) fs.unlinkSync(path.join(dir, `${n}.ran`));
    const s1 = cs.runNpm('suite', { index: 1, count: 2 }, quiet), s2 = cs.runNpm('suite', { index: 2, count: 2 }, quiet);
    const ran = [...s1.results, ...s2.results].map(r => r.key).sort();
    assert.deepStrictEqual(ran, ['node ./a.js', 'node ./b.js', 'node ./c.js', 'node ./d.js']);
    assert.deepStrictEqual(s1.results.map(r => r.key), ['node ./a.js', 'node ./d.js']);
  });

  check('runNpm keeps LEERNESS_CI_SHARD_TIMES to itself: leaves do not see it, the runner still writes its times', () => {
    // 1.36.303: the full run's times file was overwritten mid-run by this probe's own runNpm, which inherited the
    //   variable from the outer runner through the leaf environment.
    const dir = path.join(arena, 'times-env');
    fs.mkdirSync(dir);
    const seen = path.join(dir, 'seen.txt'), times = path.join(dir, 'times.json');
    fs.writeFileSync(path.join(dir, 'e.js'), `require('fs').writeFileSync(${JSON.stringify(seen)}, Object.keys(process.env).filter(k => k.toUpperCase() === 'LEERNESS_CI_SHARD_TIMES').length ? 'set' : 'unset');\n`);
    const env = { ...process.env, GITHUB_ACTIONS: '', LEERNESS_CI_SHARD_TIMES: times };
    const r = cs.runNpm('suite', { index: 1, count: 1 }, { root: dir, scripts: { suite: 'node ./e.js' }, weights: { e2e: {}, npm: {} }, stdio: 'ignore', env, log: () => {} });
    assert.deepStrictEqual(r.failed, []);
    assert.strictEqual(fs.readFileSync(seen, 'utf8'), 'unset', 'a leaf saw the runner\'s times variable');
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(times, 'utf8'))), ['node ./e.js'], 'the runner did not write its own times');
    assert.strictEqual(env.LEERNESS_CI_SHARD_TIMES, times, 'the caller\'s environment object was changed');
  });

  const CREATE = names => `const e2eShard = require('./ci-shard').e2eShard(__filename, [${names.map(n => `'${n}'`).join(', ')}]);`;
  const START = '// e2e-shard: cases start here';

  check('e2e guard parser: the real file is clean; unguarded, repeated and malformed guards are reported', () => {
    const real = cs.e2eCases(e2eSource);
    assert.deepStrictEqual(real.problems, []);
    assert(real.keys.length >= 400, `only ${real.keys.length} cases found`);
    const bad = [
      CREATE(['fx']),                                             // 1
      'if (setupNeeded) {', '  total++;', '}',                    // 2-4: preamble, above the marker: allowed
      START,                                                      // 5
      "if (e2eShard.take('a')) {", '  total++;', '}',             // 6-8
      '{ // accidentally unguarded case', '}',                    // 9-10: a block opened with a comment
      "if (e2eShard.take('a')) {", '}',                           // 11-12: repeated key
      'if (e2eShard.take("b")) {', '}',                           // 13-14: another guard form
      "// if (e2eShard.take('in a comment')) {",                  // 15
      '  {', '  }',                                               // 16-17: an indented block between cases
      'if (flag) {', '}',                                         // 18-19: a control-flow block
      '(() => {', '})();',                                        // 20-21: an immediately invoked function
      'total++;',                                                 // 22: a counter outside a case
      'run("smoke", []);',                                        // 23: allowed between cases
      '  const x = `', '{', '`;',                                 // 24-26: a column-0 "{" in a template literal
      'setImmediate(() => {', '  total++; // e2e-shard: run-wide check', '  if (ok) {', '  }', // 27-30: run-wide: allowed
      '  total++;',                                               // 31: a run-wide counter without its mark
      '}); // end of the run',                                    // 32: the closer, with a comment
      'run("late", []);',                                         // 33: code after the run-wide section
    ].join('\n');
    const r = cs.e2eCases(bad);
    assert.deepStrictEqual(r.keys, ['a']);
    const expected = [
      /line 9: a block outside a case/, /key "a" repeats/, /line 13: e2eShard\.take outside the guard form/,
      /line 16: a block outside a case/, /line 18: a control-flow block outside a case/,
      /line 20: an immediately invoked function outside a case/, /line 22: a case counter outside a case/,
      // The parser reads lines, not JavaScript: a column-0 "{" inside a template literal is reported (a false alarm
      //   that fails loudly, never a dropped case).
      /line 25: a block outside a case/, /line 31: a case counter in the run-wide section without/,
      /line 33: code after the run-wide section/,
    ];
    assert.strictEqual(r.problems.length, expected.length, r.problems.join(' | '));
    for (const re of expected) assert(r.problems.some(p => re.test(p)), `missing ${re}: ${r.problems.join(' | ')}`);
    // The reviewers' cases on the real file. Round 1: one guard replaced by a block opened with a comment. Round 2:
    //   the first guard replaced by `if (false) {`; the preamble then ended at the next guard and the case vanished.
    //   Other wrappers too: whatever wraps a case, its counter is outside a guard.
    const first = "if (e2eShard.take('update --check (offline): 조회 실패를')) {", middle = "if (e2eShard.take('B(1.9.29)')) {";
    for (const [anchor, wrap] of [[middle, '{ // accidentally unguarded case'], [first, 'if (false) {'],
      [first, 'function never() {'], [middle, 'skip: {'], [middle, 'class Never { static {']]) {
      assert.strictEqual(e2eSource.split(anchor).length, 2, 'anchor case missing: ' + anchor);
      const broken = cs.e2eCases(e2eSource.replace(anchor, wrap));
      assert.strictEqual(broken.keys.length, real.keys.length - 1);
      assert(broken.problems.some(p => /outside a case/.test(p)), `${wrap}: ${broken.problems.join(' | ')}`);
    }
    // Round 3: a comment on the run-wide closer left the section open, and a case appended after it was exempt.
    const closer = e2eSource.lastIndexOf('\n});');
    assert(closer > 0 && /^\s*$/.test(e2eSource.slice(closer + 4)), 'run-wide closer not at the end of e2e.js');
    const appended = e2eSource.slice(0, closer) + '\n}); // end\nif (false) {\n  total++;\n}\n';
    const late = cs.e2eCases(appended);
    assert(late.problems.some(p => /code after the run-wide section/.test(p)), late.problems.join(' | '));
    const unclosed = cs.e2eCases(e2eSource.slice(0, closer) + '\n');
    assert(unclosed.problems.some(p => /never closes/.test(p)), unclosed.problems.join(' | '));
    const noCreate = cs.e2eCases("if (e2eShard.take('a')) {\n}\n");
    assert(noCreate.problems.some(p => /no line "const e2eShard = require/.test(p)), noCreate.problems.join(' | '));
    assert(noCreate.problems.some(p => /no line "\/\/ e2e-shard: cases start here"/.test(p)), noCreate.problems.join(' | '));
    assert(noCreate.problems.some(p => /before the line "\/\/ e2e-shard: cases start here"/.test(p)), noCreate.problems.join(' | '));
    const twoCreate = cs.e2eCases([CREATE(['fx']), CREATE(['fx']), START, START].join('\n'));
    assert(twoCreate.problems.some(p => /second e2eShard/.test(p)) && twoCreate.problems.some(p => /second "cases start here"/.test(p)));
  });

  check('e2e cases that mention a shared name run in one shard, in order; others are placed one by one', () => {
    const src = [
      CREATE(['fx', 'helper']), START,
      "if (e2eShard.take('s1')) {", '  helper(1);', '}',
      // Not mentions: a longer name, a property, a `$` prefix. A mention inside a string does count (s3b below):
      //   grouping a case too many is only slower, grouping one too few can break it.
      "if (e2eShard.take('free1')) {", '  const fxy = 1; obj.fx = 2; const $fx = 3;', '}',
      "if (e2eShard.take('s3b')) {", '  const label = "fx-name";', '}',
      "if (e2eShard.take('s2')) {", '  const t = `', '}', '`; use(fx);', '}',
      "if (e2eShard.take('free2')) {", '}',
      "if (e2eShard.take('s3')) {", '  fs.readFileSync(path.join(fx, "a"));', '}',
      "if (e2eShard.take('free3')) {", '}',
    ].join('\n');
    const parsed = cs.e2eCases(src);
    assert.deepStrictEqual(parsed.problems, []);
    assert.deepStrictEqual([...parsed.usesShared], ['s1', 's3b', 's2', 's3']);
    // Equal weights would spread the shared cases over the shards if they were placed one by one.
    const w = { e2e: { s1: 10, free1: 10, s3b: 10, s2: 10, free2: 10, s3: 10, free3: 10 }, npm: {} };
    for (let k = 1; k <= 6; k++) {
      const { cases, load } = cs.planE2e(src, k, w);
      const shards = new Set(cases.filter(c => c.shared).map(c => c.shard));
      assert.strictEqual(shards.size, 1, `${k} shards: shared cases split over ${[...shards]}`);
      assert.strictEqual(load.reduce((a, b) => a + b, 0), 70);
    }
    // On the real file: the B(1.9.8) rule cases leave rules in the shared project for the next ones, and the
    //   session-close case reads them (Linux, shard 1/2 of the first version: three of them failed apart).
    const real = cs.e2eCases(e2eSource);
    assert(real.shared.includes('tmp') && real.shared.includes('run'), `shared names ${real.shared}`);
    for (const k of ['B(1.9.8)', 'B(1.9.8) #2', 'B(1.9.8) #3', 'pass']) assert(real.usesShared.has(k), `${k} not grouped`);
    for (let k = 2; k <= 6; k++) {
      const { cases } = cs.planE2e(e2eSource, k, weights);
      assert.strictEqual(new Set(cases.filter(c => c.shared).map(c => c.shard)).size, 1, `${k} shards split the shared cases`);
    }
  });

  check('e2e cases: every case of the real file runs in exactly one shard, for 1..6 shards', () => {
    const keys = cs.e2eCases(e2eSource).keys;
    for (let k = 1; k <= 6; k++) {
      const { cases } = cs.planE2e(e2eSource, k, weights);
      const union = [];
      for (let i = 1; i <= k; i++) union.push(...cases.filter(c => c.shard === i).map(c => c.key));
      assert.deepStrictEqual([...union].sort(), [...keys].sort(), `${k} shards: cases lost or repeated`);
    }
  });

  check('e2eShard runtime: shards take disjoint cases; finish reports unreached, repeated and unknown keys', () => {
    const file = path.join(arena, 'cases.js');
    const names = ['k1', 'k2', 'k3', 'k4', 'k5'];
    fs.writeFileSync(file, CREATE(['fx']) + '\n' + START + '\n' + names.map(k => `if (e2eShard.take('${k}')) {\n  total++;\n}\n`).join(''));
    const w = { e2e: { k1: 9, k2: 1, k3: 5, k4: 5, k5: 2 }, npm: {} };
    const taken = [];
    for (let i = 1; i <= 3; i++) {
      const timesFile = path.join(arena, `times-${i}.json`);
      const env = { LEERNESS_E2E_SHARD: `${i}/3`, LEERNESS_E2E_TIMES: timesFile };
      const s = cs.e2eShard(file, ['fx'], env, { weights: w });
      assert(!('LEERNESS_E2E_SHARD' in env) && !('LEERNESS_E2E_TIMES' in env), 'shard env leaked to children');
      const mine = names.filter(k => s.take(k));
      taken.push(...mine);
      const f = s.finish();
      assert(f.ok, JSON.stringify(f));
      assert.strictEqual(f.ran, mine.length);
      assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(timesFile, 'utf8'))).sort(), [...mine].sort());
    }
    assert.deepStrictEqual([...taken].sort(), names);
    const all = cs.e2eShard(file, ['fx'], {}, { weights: w });
    assert(names.every(k => all.take(k)), 'an unsharded run skipped a case');
    assert(all.finish().ok);
    const missing = cs.e2eShard(file, ['fx'], {}, { weights: w });
    names.slice(1).forEach(k => missing.take(k));
    assert.deepStrictEqual(missing.finish().missing, ['k1']);
    const twice = cs.e2eShard(file, ['fx'], {}, { weights: w });
    names.forEach(k => twice.take(k)); twice.take('k2');
    assert.deepStrictEqual(twice.finish().repeated, ['k2']);
    const unknown = cs.e2eShard(file, ['fx'], { LEERNESS_E2E_SHARD: '2/3' }, { weights: w });
    names.forEach(k => unknown.take(k));
    assert.strictEqual(unknown.take('not-a-guard'), true, 'an unparsed key must run in every shard');
    const u = unknown.finish();
    assert(!u.ok && u.unknown[0] === 'not-a-guard');
    const drift = cs.e2eShard(file, ['fx', 'other'], {}, { weights: w });
    names.forEach(k => drift.take(k));
    const d = drift.finish();
    assert(!d.ok && d.problems.some(p => /differ from the file/.test(p)), JSON.stringify(d.problems));
  });

  check('readme sync counts a case whose counter sits inside its shard guard', () => {
    // The README e2e badge estimate counts column-0 `total++;` and `run(` lines; guarded cases moved the counter.
    const dir = path.join(arena, 'badge');
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"b","version":"1.2.3"}\n');
    fs.writeFileSync(path.join(dir, 'README.md'), '# b\n\n![e2e](https://img.shields.io/badge/e2e-1%2F1-success)\n');
    fs.writeFileSync(path.join(dir, 'scripts', 'e2e.js'), [
      'total++;', "run('x', []);",
      "if (e2eShard.take('a')) {", '  total++;', '}',
      "if (e2eShard.take('b')) {", '  total++;', '}',
      "if (e2eShard.take('c')) {", '  const x = 1;', '}',
    ].join('\n') + '\n');
    const r = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'bin', 'leerness.js'), 'readme', 'sync', dir],
      { encoding: 'utf8', timeout: 60000, env: { ...process.env, LEERNESS_OFFLINE: '1' } });
    assert.strictEqual(r.status, 0, (r.stdout || '') + (r.stderr || ''));
    assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /badge\/e2e-4%2F4-success/);
  });

  check('workflow: every sharded job lists shards 1..k of each configuration; the gate jobs cover one set', () => {
    for (const name of ['test', 'commands', 'fast']) {
      assert(jobs[name] && jobs[name].entries.length, `job ${name} has no matrix entries`);
      assert.deepStrictEqual(cs.shardLists(jobs[name].entries).problems, [], `job ${name}`);
    }
    const configs = name => cs.shardLists(jobs[name].entries).configs.sort();
    assert.deepStrictEqual(configs('test'), configs('core'), 'e2e and core jobs cover different configurations');
    assert.deepStrictEqual(configs('commands'), configs('core'), 'commands and core jobs cover different configurations');
    assert(configs('core').includes('node=24 os=windows-latest'), 'Windows Node 24 missing from the gate');
    assert(jobs.test.runs.includes('node ./scripts/e2e.js'), 'e2e job does not run e2e.js');
    assert(jobs.test.lines.some(l => /^\s+LEERNESS_E2E_SHARD: \$\{\{ matrix\.shard \}\}\/\$\{\{ matrix\.shards \}\}$/.test(l)), 'e2e job does not pass its shard');
    assert.deepStrictEqual([...sharded].sort(), ['test:commands', 'test:fast']);
  });

  check('workflow checks catch a dropped, repeated or mismatched shard entry', () => {
    const drop = workflowText.replace('          - { os: windows-latest, node: 24, shard: 3, shards: 4 }\n', '');
    const dup = workflowText.replace('          - { os: ubuntu-latest, node: 20, shard: 2, shards: 2 }\n',
      '          - { os: ubuntu-latest, node: 20, shard: 1, shards: 2 }\n');
    const mixed = workflowText.replace('          - { os: windows-latest, node: 18, shard: 2, shards: 2 }\n',
      '          - { os: windows-latest, node: 18, shard: 2, shards: 3 }\n');
    for (const [label, text, job] of [['drop', drop, 'test'], ['dup', dup, 'test'], ['mixed', mixed, 'commands']]) {
      assert.notStrictEqual(text, workflowText, `${label}: fixture edit did not apply`);
      assert.strictEqual(cs.shardLists(cs.workflowJobs(text)[job].entries).problems.length, 1, label);
    }
    const lessCommands = workflowText.replace('          - { os: ubuntu-latest, node: 22, shard: 1, shards: 1 }\n', '');
    assert.notStrictEqual(lessCommands, workflowText);
    const j = cs.workflowJobs(lessCommands);
    assert.notDeepStrictEqual(cs.shardLists(j.commands.entries).configs.sort(), cs.shardLists(j.core.entries).configs.sort());
  });
} finally {
  fs.rmSync(arena, { recursive: true, force: true });
}

const failed = results.filter(r => !r.ok);
console.log(`ci-shard probe: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
