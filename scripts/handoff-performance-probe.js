'use strict';
require('./temp-cleanup').trackTemp(module);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const cli = path.resolve(__dirname, '../bin/leerness.js');
const source = path.dirname(path.dirname(cli));
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-handoff-perf-'));
const samples = 30;
const version = require('../package.json').version;
const fixtureFiles = {
  'manifest.json': JSON.stringify({ project: 'handoff-performance-fixture', language: 'en', leernessVersion: version }),
  'HARNESS_VERSION': version + '\n', 'LANGUAGE': 'en\n',
  'progress-tracker.md': '# Tasks\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n'
    + Array.from({ length: 1000 }, (_, i) => `| T-${String(i + 1).padStart(4, '0')} | ${i < 980 ? 'done' : 'in-progress'} | Fixture task ${i + 1} | not_run | Continue task ${i + 1} | 2026-10-30 |\n`).join(''),
  'plan.md': '# Plan\n<!-- leerness:owner-priorities:start -->\n1. T-1000\n<!-- leerness:owner-priorities:end -->\n',
  'current-state.md': '# Current\nContinue the selected task.\n',
  'session-handoff.md': '# Handoff\nNext: T-1000\n',
  'rules.md': '# Rules\n| ID | Trigger | Rule | Added | Status | Last Verified |\n|---|---|---|---|---|---|\n| R-0001 | always | Preserve source records | 2026-10-30 | active | |\n',
  'decisions.md': '# Decisions\n', 'lessons.md': '# Lessons\n',
  'task-log.md': '# Recent observations\n' + Array.from({ length: 20 }, (_, i) => `- RUN-${i + 1}: not_run; observation fixture only.\n`).join(''),
};
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(LEERNESS_|NODE_OPTIONS)/i.test(key)) delete env[key];
function makeFixture(name) {
  const root = path.join(arena, name), ws = path.join(root, '.leerness');
  fs.mkdirSync(ws, { recursive: true });
  for (const [file, content] of Object.entries(fixtureFiles)) fs.writeFileSync(path.join(ws, file), content);
  return root;
}
function invoke(root, cache) {
  const started = performance.now();
  const result = cp.spawnSync(process.execPath, [cli, 'handoff', root], {
    cwd: root, env: { ...env, LEERNESS_CACHE_DIR: cache, LEERNESS_NO_PROMPT: '1' },
    encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024,
  });
  const elapsed = performance.now() - started;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.error, undefined);
  assert.match(result.stdout, /T-1000/);
  assert.match(result.stdout, /not inspected/);
  assert.equal(fs.existsSync(cache), false);
  return { elapsed, outputBytes: Buffer.byteLength(result.stdout) };
}
function summarize(observations) {
  const times = observations.map(x => x.elapsed).sort((a, b) => a - b);
  const p = fraction => times[Math.ceil(times.length * fraction) - 1];
  return { samples: times.length, p50Ms: p(0.5), p95Ms: p(0.95), minMs: times[0], maxMs: times[times.length - 1],
    outputBytes: observations[0].outputBytes, elapsedMs: observations.map(x => x.elapsed) };
}
try {
  const cold = [], warm = [];
  for (let i = 0; i < samples; i++) cold.push(invoke(makeFixture(`cold-${i}-한글`), path.join(arena, `cache-cold-${i}`)));
  const root = makeFixture('warm-한글'), cache = path.join(arena, 'cache-warm');
  invoke(root, cache);
  for (let i = 0; i < samples; i++) warm.push(invoke(root, cache));
  for (const [file, content] of Object.entries(fixtureFiles)) assert.equal(fs.readFileSync(path.join(root, '.leerness', file), 'utf8'), content);
  const digest = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(source, file))).digest('hex');
  const result = {
    kind: 'candidate latency observation, not a baseline speedup or release certificate',
    schemaVersion: 1, sourceRevision: process.env.LEERNESS_BENCH_SOURCE || null,
    environment: { platform: process.platform, arch: process.arch, node: process.version, osRelease: os.release(), cpu: os.cpus()[0]?.model || null },
    fixture: { tasks: 1000, recentLogEntries: 20, selectedTask: 'T-1000', bytes: Object.values(fixtureFiles).reduce((sum, text) => sum + Buffer.byteLength(text), 0) },
    command: 'node bin/leerness.js handoff <fixture>',
    timing: 'wall time for a fresh CLI process; fixture setup and assertions excluded',
    coldDefinition: 'unique fixture path and absent Leerness cache per call; OS disk cache is not flushed',
    warmDefinition: 'same fixture after one priming call; every measurement is a fresh CLI process',
    percentile: 'nearest-rank', cold: summarize(cold), warm: summarize(warm),
    sourceSha256: Object.fromEntries(['bin/leerness.js', 'lib/process-deadline.js', 'scripts/handoff-performance-probe.js'].map(file => [file, digest(file)])),
  };
  result.warmTargetMs = process.platform === 'win32' ? 1000 : process.platform === 'linux' ? 500 : null;
  result.warmTargetMet = result.warmTargetMs === null ? null : result.warm.p95Ms <= result.warmTargetMs;
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally { fs.rmSync(arena, { recursive: true, force: true }); }
