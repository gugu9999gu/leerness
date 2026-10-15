'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
// T-0346: the e2e-concurrency handshake (scripts/lock-probe.js reports, scripts/race-overlap.js judgement) with two
// small processes instead of leerness commands, so each schedule is fixed. The first process takes
// .leerness/x.json.lock (and y.json.lock when asked), prepares x.json and renames it into place; the preload stalls
// that rename. The second process does what each case says. A race may count only when the second process really
// met the stalled section.
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { overlapOf } = require('./race-overlap');

const PRELOAD = path.join(__dirname, 'lock-probe.js');
const STALL_MS = 1200;
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-race-overlap-'));
let passed = 0, failed = 0, seq = 0;
function test(name, fn) {
  return fn().then(() => { passed++; console.log('PASS ' + name); },
    error => { failed++; console.error('FAIL ' + name + ': ' + (error && error.stack || error)); });
}
const wait = child => new Promise(resolve => child.on('close', code => resolve(code)));
const nap = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
// Shared by both processes: `sleep(ms)` and `takeLock(name)` (retry on EEXIST, as leerness locks do). The first
// process holds x.json.lock and, when asked, y.json.lock, a lock the race knows only from the first one's `heldOn`.
const PRELUDE = `
  const fs = require('fs'), path = require('path');
  const hd = path.join(process.argv[1], '.leerness'), target = path.join(hd, 'x.json'), lock = target + '.lock';
  const other = path.join(hd, 'y.json.lock');
  const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const takeLock = (name = lock) => { for (;;) { try { fs.mkdirSync(name); return; } catch (e) { if (e.code !== 'EEXIST') throw e; sleep(20); } } };
`;
const FIRST = PRELUDE + `
  const both = process.argv[2] === 'both';
  takeLock(); if (both) takeLock(other);
  const tmp = target + '.tmp-1-1';
  fs.writeFileSync(tmp, JSON.stringify({ by: 'first' }));
  fs.renameSync(tmp, target);
  if (both) fs.rmdirSync(other);
  fs.rmdirSync(lock);
`;
// `heldFile`: what the second process reads as the first one's held locks: 'ready' (the ready file itself),
// 'corrupt-after-read' (a copy that the race overwrites with half a JSON object once the second process has
// reported its read, as a rewrite caught midway would look), or 'corrupt' (half a JSON object from the start).
// `failAfter`: report writes after that many fail in the second process (LOCKPROBE_REPORT_FAIL_AFTER), as for a
// report file that turned read-only, whoever runs the test.
async function race(second, { waitMaxMs = 15000, firstLocks = 'one', heldFile = 'ready', failAfter } = {}) {
  const d = path.join(arena, 'case-' + (++seq));
  fs.mkdirSync(path.join(d, '.leerness'), { recursive: true });
  fs.writeFileSync(path.join(d, '.leerness', 'x.json'), JSON.stringify({ by: 'seed' }));
  const ready = path.join(d, 'ready.json'), reach = path.join(d, 'reach.json'), heldCopy = path.join(d, 'held.json');
  const first = cp.spawn(process.execPath, ['--require', PRELOAD, '-e', FIRST, d, firstLocks], { stdio: 'ignore', env: { ...process.env,
    LOCKPROBE_STALL_TARGET: 'x.json', LOCKPROBE_STALL_MS: String(STALL_MS), LOCKPROBE_READY_FILE: ready,
    LOCKPROBE_WAIT_FILE: reach, LOCKPROBE_WAIT_MAX_MS: String(waitMaxMs) } });
  let stalled = false;
  for (let i = 0; i < 800 && !stalled; i++) { stalled = (readJson(ready) || {}).target === 'x.json'; if (!stalled) nap(10); }
  const half = '{"target":"x.json","heldOn":["x.js';
  if (heldFile !== 'ready') fs.writeFileSync(heldCopy, heldFile === 'corrupt' ? half : fs.readFileSync(ready));
  const started = Date.now();
  const child = cp.spawn(process.execPath, ['--require', PRELOAD, '-e', PRELUDE + second, d], { stdio: 'ignore', env: { ...process.env,
    LOCKPROBE_REACH_TARGET: 'x.json', LOCKPROBE_REACH_FILE: reach, LOCKPROBE_REACH_LOCKS_FILE: heldFile === 'ready' ? ready : heldCopy,
    ...(failAfter === undefined ? {} : { LOCKPROBE_REPORT_FAIL_AFTER: String(failAfter) }) } });
  if (heldFile === 'corrupt-after-read') {
    for (let i = 0; i < 1500 && !(readJson(reach) || {}).read; i++) nap(10);
    fs.writeFileSync(heldCopy, half);
  }
  const exits = await Promise.all([wait(first), wait(child)]);
  const r = { stalled, ready: readJson(ready), reach: readJson(reach), exits, secondStartedAt: started };
  return { ...r, ...overlapOf(r) };
}
(async () => {
  try {
    await test('a lock attempt that waits on the stalled section counts', async () => {
      const r = await race('takeLock(); fs.rmdirSync(lock);');
      assert.deepStrictEqual(r.exits, [0, 0]);
      assert.strictEqual(r.reach.lock.result, 'contended', JSON.stringify(r.reach));
      assert.strictEqual(r.overlapped, true, r.why);
    });
    await test('a delay before the first access does not let the stall end first', async () => {
      // The schedule of review round 1: the second process is slow to reach its lock attempt. The report is written
      // after the attempt ran, so the first process is still stalled when it happens.
      const r = await race('sleep(1500); takeLock(); fs.rmdirSync(lock);');
      assert.strictEqual(r.reach.lock.result, 'contended', JSON.stringify(r.reach));
      assert.ok(r.ready.waitedMs >= 1400, 'the first process waited for the report: ' + r.ready.waitedMs);
      assert.ok(r.reach.lock.at <= r.ready.resumedAt, 'the attempt came before the first process resumed');
      assert.strictEqual(r.overlapped, true, r.why);
    });
    await test('a read during the stall followed by a lock taken after the release does not count', async () => {
      const r = await race(`fs.existsSync(target); sleep(${STALL_MS + 1300}); takeLock(); fs.rmdirSync(lock);`);
      assert.strictEqual(r.reach.read.how, 'exists');
      assert.strictEqual(r.reach.lock.result, 'acquired', JSON.stringify(r.reach));
      assert.strictEqual(r.overlapped, false, r.why);
    });
    await test('a command that only reads counts when its read finished while stalled', async () => {
      const r = await race('fs.readFileSync(target);');
      assert.ok(['read', 'open'].includes(r.reach.read.how), JSON.stringify(r.reach)); // readFileSync opens through openSync
      assert.strictEqual(r.reach.lock, undefined);
      assert.ok(r.reach.read.at <= r.ready.resumedAt);
      assert.strictEqual(r.overlapped, true, r.why);
    });
    await test("a lock attempt that waits on another lock the first process holds counts", async () => {
      const r = await race('takeLock(other); fs.rmdirSync(other);', { firstLocks: 'both' });
      assert.strictEqual(r.reach.lock.target, 'y.json.lock', JSON.stringify(r.reach));
      assert.strictEqual(r.reach.lock.result, 'contended');
      assert.strictEqual(r.overlapped, true, r.why);
    });
    await test('review round 2: a held-locks file broken after the read does not hide a lock taken after the release', async () => {
      // The second process read the held locks when it started; a rewrite caught midway later must not change them.
      const r = await race(`fs.existsSync(target); sleep(${STALL_MS + 1300}); takeLock(other); fs.rmdirSync(other);`,
        { firstLocks: 'both', heldFile: 'corrupt-after-read' });
      assert.strictEqual(r.reach.lock && r.reach.lock.result, 'acquired', JSON.stringify(r.reach));
      assert.strictEqual(r.overlapped, false, r.why);
    });
    await test('review round 3: a report that can no longer be rewritten does not let an earlier read count', async () => {
      // The read report lands; the later "acquired" cannot be written (the first write succeeds, later ones fail).
      const r = await race(`fs.existsSync(target); sleep(${STALL_MS + 1300}); takeLock(other); fs.rmdirSync(other);`,
        { firstLocks: 'both', failAfter: 1 });
      assert.ok(r.reach && r.reach.read && !r.reach.lock && r.reach.complete === undefined, JSON.stringify(r.reach));
      assert.strictEqual(r.exits[1], 97, 'the second process fails when its report cannot be written');
      assert.strictEqual(r.overlapped, false, r.why);
    });
    await test('review round 4: a lock taken in a later exit listener whose report fails makes the second process fail', async () => {
      // The preload's closing listener marks the read report complete (write 2); a listener registered after it then
      // takes a held lock after the release, and that report (write 3) fails. The completed read report stays, so
      // only the exit code can tell the race.
      const r = await race(`fs.existsSync(target); process.on('exit', () => { sleep(${STALL_MS + 1300}); takeLock(other); fs.rmdirSync(other); });`,
        { firstLocks: 'both', failAfter: 2 });
      assert.ok(r.reach && r.reach.read && r.reach.complete === true && !r.reach.lock, JSON.stringify(r.reach));
      assert.strictEqual(r.exits[1], 97, 'the failed write after completion still fails the process');
    });
    await test('held locks that cannot be read make the race not count', async () => {
      const r = await race('takeLock(); fs.rmdirSync(lock);', { heldFile: 'corrupt' });
      assert.strictEqual(r.reach.heldUnknown, true, JSON.stringify(r.reach));
      assert.strictEqual(r.overlapped, false, r.why);
    });
    await test('a command that never reaches the stalled section does not count', async () => {
      const r = await race("fs.readFileSync(path.join(process.argv[1], 'ready.json'));", { waitMaxMs: 1500 });
      assert.strictEqual(r.ready.reached, false);
      assert.strictEqual(r.reach, null);
      assert.strictEqual(r.overlapped, false, r.why);
    });
  } finally {
    fs.rmSync(arena, { recursive: true, force: true });
  }
  console.log(`race overlap probe: ${passed}/${passed + failed} passed (${process.platform})`);
  process.exitCode = failed ? 1 : 0;
})();
