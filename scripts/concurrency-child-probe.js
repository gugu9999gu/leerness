'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { watchChild, childPassed } = require('./e2e-concurrency');
const launch = args => cp.spawn(process.execPath, args, { stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
const fake = () => Object.assign(new EventEmitter(), { pid: 42, unref() { this.unreferenced = true; } });

test('actual zero exit is successful only after close', async () => {
  const result = await watchChild(launch(['-e', 'process.exit(0)'])).done;
  assert.equal(childPassed(result), true); assert.equal(result.closed, true); assert.equal(result.timedOut, false);
});
test('actual nonzero exit is preserved, not success', async () => {
  const result = await watchChild(launch(['-e', 'process.exit(7)'])).done;
  assert.equal(result.status, 7); assert.equal(childPassed(result), false); assert.equal(childPassed(result, 7), true);
});
test('actual spawn error is recorded without an unhandled rejection', async () => {
  const child = cp.spawn(path.join(path.dirname(process.execPath), 'leerness-missing-child-' + process.pid), [], { stdio: 'ignore', windowsHide: true });
  const result = await watchChild(child).done;
  assert(result.error); assert.equal(result.closed, true); assert.equal(childPassed(result), false);
});
test('actual hanging child is terminated within its deadline', async () => {
  const child = launch(['-e', 'setInterval(() => {}, 1000)']);
  const result = await watchChild(child, { timeoutMs: 300, shutdownMs: 5000 }).done;
  assert.equal(result.timedOut, true); assert.equal(result.closed, true); assert.equal(childPassed(result), false);
  assert.notEqual(child.exitCode === null && child.signalCode === null, true);
});
test('actual cleanup cancellation waits for confirmed child termination', async () => {
  const watched = watchChild(launch(['-e', 'setInterval(() => {}, 1000)']));
  watched.cancel('cleanup'); const result = await watched.done;
  assert.equal(result.cancelled, true); assert.equal(result.timedOut, false); assert.equal(result.closed, true);
  assert.equal(childPassed(result), false);
});
test('an exit event alone is not mistaken for stream closure', async () => {
  const child = fake(); let stopped = false;
  const watched = watchChild(child, { timeoutMs: 20, shutdownMs: 20, stop() { stopped = true; } });
  child.emit('exit', 0, null);
  const result = await watched.done;
  assert(stopped); assert.equal(result.closed, false); assert.equal(result.timedOut, true); assert(child.unreferenced);
  assert.equal(childPassed(result), false);
});
test('a close code of zero after deadline cannot turn timeout into success', async () => {
  const child = fake();
  const watched = watchChild(child, { timeoutMs: 10, shutdownMs: 50, stop() { child.emit('close', 0, null); } });
  const result = await watched.done;
  assert.equal(result.status, 0); assert.equal(result.closed, true); assert.equal(result.timedOut, true);
  assert.equal(childPassed(result), false);
});
test('signal termination is refused even with status zero', async () => {
  const child = fake(), watched = watchChild(child);
  child.emit('close', 0, 'SIGTERM'); const result = await watched.done;
  assert.equal(childPassed(result), false); assert.equal(result.signal, 'SIGTERM');
});
test('spawn error is retained even with a later close code of zero', async () => {
  const child = fake(), watched = watchChild(child);
  child.emit('error', Object.assign(new Error('spawn refused'), { code: 'EACCES' }));
  child.emit('close', 0, null); const result = await watched.done;
  assert.equal(result.error.code, 'EACCES'); assert.equal(childPassed(result), false);
});
test('kill failure settles as unconfirmed, never as clean termination', async () => {
  const child = fake(), watched = watchChild(child, { timeoutMs: 10, shutdownMs: 10, stop() { throw new Error('kill refused'); } });
  const result = await watched.done;
  assert.equal(result.stopError, 'kill refused'); assert.equal(result.closed, false); assert.equal(childPassed(result), false);
});
test('cleanup is idempotent and a settled result is not rewritten by late events', async () => {
  const child = fake(); let calls = 0;
  const watched = watchChild(child, { timeoutMs: 100, shutdownMs: 10, stop() { calls++; } });
  watched.cancel('cleanup'); watched.cancel('cleanup'); const result = await watched.done;
  child.emit('close', 0, null); watched.cancel('cleanup');
  assert.equal(calls, 1); assert.equal(result.closed, false); assert.equal(childPassed(result), false);
});
test('completed children are not killed during cleanup', async () => {
  const child = fake(); let calls = 0;
  const watched = watchChild(child, { stop() { calls++; } }); child.emit('close', 0, null);
  const result = await watched.done; watched.cancel('cleanup');
  assert.equal(calls, 0); assert.equal(childPassed(result), true);
});
test('invalid deadlines are refused', () => {
  for (const value of [0, -1, NaN, Infinity, '10']) {
    assert.throws(() => watchChild(fake(), { timeoutMs: value }), TypeError);
    assert.throws(() => watchChild(fake(), { shutdownMs: value }), TypeError);
  }
});
test('missing or fractional exit codes cannot pass', () => {
  for (const status of [null, undefined, 0.5, '0']) assert.equal(childPassed({ closed: true, status }), false);
});
