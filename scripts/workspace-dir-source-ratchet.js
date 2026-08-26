'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ALLOWED = new Set([
  path.normalize('lib/workspace-dir.js'),
  path.normalize('lib/pure-utils.js'),
  path.normalize('scripts/workspace-dir-migration-probe.js'),
  path.normalize('scripts/installed-cleanroom-probe.js'),
  path.normalize('scripts/workspace-dir-source-ratchet.js'),
]);
const violations = [];

function walk(rel) {
  const abs = path.join(ROOT, rel);
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) walk(child);
    else if (entry.isFile() && /\.(?:js|md|json|html)$/.test(entry.name)) inspect(child);
  }
}

function inspect(rel) {
  if (ALLOWED.has(path.normalize(rel))) return;
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    // E2E fixtures may name the one supported legacy directory explicitly.
    // Requiring this line-local marker keeps the exception reviewable instead
    // of exempting the entire (large) E2E suite from the production ratchet.
    if (lines[i].includes('workspace-dir-legacy-fixture')) continue;
    // Match the legacy directory token, not compatible data fields such as
    // `versionSkew.harnessVersion` that happen to share the same characters.
    if (/\.harness(?=$|[\\/"'`\s])/.test(lines[i])) violations.push(`${rel.replace(/\\/g, '/')}:${i + 1}`);
  }
}

for (const dir of ['bin', 'lib', 'scripts']) walk(dir);
if (violations.length) {
  process.stderr.write(`LEGACY_WORKSPACE_REFERENCE_LEAK\n${violations.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('WORKSPACE_DIR_SOURCE_RATCHET_OK\n');
