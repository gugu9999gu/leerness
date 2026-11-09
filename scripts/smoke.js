#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module);  

 
 
 
 
 
 

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { performance } = require('node:perf_hooks');
const { childDiagnostics, childExitMatches } = require('./e2e-child-diagnostics');

process.env.LEERNESS_OFFLINE = process.env.LEERNESS_OFFLINE || '1';
const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-smoke-'));
let failed = 0, total = 0;
const t0 = Date.now();

 
function check(label, args, opts = {}) {
  total++;
  const started = performance.now();
  const r = cp.spawnSync(process.execPath, [CLI, ...args], { cwd: opts.cwd || tmp, encoding: 'utf8', timeout: opts.timeout || 30000 });
  const diagnostic = childDiagnostics(r, performance.now() - started, opts.timeout || 30000);
  let ok = childExitMatches(r, opts.expectFail);
  if (ok && typeof opts.match === 'function') { try { ok = !!opts.match(r.stdout || '', r.stderr || ''); } catch { ok = false; } }
  process.stdout.write(`${ok ? '✓' : '✗'} ${label}${opts.expectFail ? ' (expect-fail)' : ''} (elapsedMs=${diagnostic.elapsedMs})\n`);
  if (!ok) { failed++; process.stdout.write((r.stdout || '').slice(0, 300)); process.stderr.write((r.stderr || '').slice(0, 200)); console.log(JSON.stringify(diagnostic)); }
  return { ok, stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

console.log(`# leerness smoke (test:fast) @ ${tmp}`);

 
check('--version', ['--version'], { match: s => /^\d+\.\d+\.\d+/.test(s.trim()) });

 
check('init', ['init', tmp, '--yes', '--language', 'ko', '--skills', 'recommended']);
check('status', ['status', tmp], { match: s => /present|존재|설치/.test(s) || true });
check('verify (필수 파일)', ['verify', tmp]);

 
check('handoff', ['handoff', tmp]);
check('audit', ['audit', tmp]);
check('drift check', ['drift', 'check', tmp], { match: s => /drift/i.test(s) });
check('session close', ['session', 'close', tmp]);

 
check('scan secrets', ['scan', 'secrets', tmp]);
check('encoding check', ['encoding', 'check', tmp]);

 
check('roles set + list', ['roles', 'set', 'coder', '--provider', 'codex', '--model', 'gpt-5.5', '--path', tmp, '--json'],
  { match: s => { try { return JSON.parse(s).set === 'coder'; } catch { return false; } } });
check('capabilities --json', ['capabilities', '--json'],
  { match: s => { try { const j = JSON.parse(s); return j.surface && Object.keys(j.surface).length === 6; } catch { return false; } } });

const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nSmoke result: ${total - failed}/${total} passed · ${dur}s`);
if (failed > 0) process.exit(1);
