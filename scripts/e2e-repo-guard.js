 
//
 
 
 
 
//
 
 
'use strict';
require('./temp-cleanup').trackTemp(module);  
const fs = require('fs');
const os = require('os');
const path = require('path');

function snapshot(dir) {
  const out = new Map();
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch (error) {
      if (error.code !== 'ENOENT') out.set(path.relative(dir, d).replace(/\\/g, '/') + '/', 'unreadable:' + error.code);
      return;
    }
    for (const entry of entries) {
      const p = path.join(d, entry.name);
      const rel = path.relative(dir, p).replace(/\\/g, '/');
      if (entry.isDirectory()) { out.set(rel + '/', 'dir'); walk(p); continue; }
      try { const s = fs.lstatSync(p, { bigint: true }); out.set(rel, `${s.size}:${s.mtimeNs}:${s.ino}`); }
      catch (error) { out.set(rel, 'unreadable:' + error.code); }
    }
  };
  walk(dir);
  return out;
}

 
function diff(before, after) {
  const changed = [];
  for (const [key, value] of after) {
    if (!before.has(key)) changed.push('+ ' + key);
    else if (before.get(key) !== value) changed.push('~ ' + key);
  }
  for (const key of before.keys()) if (!after.has(key)) changed.push('- ' + key);
  return changed.sort();
}

module.exports = { snapshot, diff };

 
 
if (require.main === module) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-repo-guard-selftest-'));
  try {
    fs.mkdirSync(path.join(root, 'cache'));
    fs.writeFileSync(path.join(root, 'ledger.jsonl'), '{"a":1}\n');
    fs.writeFileSync(path.join(root, 'cache', 'usage.json'), '{"n":1}');
    fs.writeFileSync(path.join(root, 'gone.md'), 'x');
    const s0 = snapshot(root);
    const quiet = diff(s0, snapshot(root)).length === 0;
    const later = new Date(Date.now() + 5000);
    fs.appendFileSync(path.join(root, 'ledger.jsonl'), '{"a":2}\n');
    fs.mkdirSync(path.join(root, 'cache', 'agent-runs'));
    fs.writeFileSync(path.join(root, 'cache', 'agent-runs', 'run-1.jsonl'), '{}');
    fs.writeFileSync(path.join(root, 'cache', 'usage.json'), '{"n":2}');
    fs.utimesSync(path.join(root, 'cache', 'usage.json'), later, later);
    fs.unlinkSync(path.join(root, 'gone.md'));
    const got = diff(s0, snapshot(root));
    const want = ['+ cache/agent-runs/', '+ cache/agent-runs/run-1.jsonl', '- gone.md', '~ cache/usage.json', '~ ledger.jsonl'].sort();
    if (!quiet || JSON.stringify(got) !== JSON.stringify(want)) {
      process.stderr.write(`e2e-repo-guard selftest failed: ${JSON.stringify({ quiet, got, want })}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write('e2e-repo-guard selftest passed: silent without writes; reports append, new directory and file, same-size rewrite and removal\n');
    }
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
}
