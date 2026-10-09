'use strict';
// T-0318: decisions.md and lessons.md are harness documents, so their generated header follows the harness
// authoring language: the explicit authoring choice, else the stored project language (manifest, then
// LANGUAGE). The UI language of one command never changes a file, and unreadable settings keep the Korean
// default, which is also what projects without a stored language have always been written in.
const fs = require('fs');
const { workspacePath } = require('./workspace-dir');
const { readManifest, resolvePolicy } = require('./authoring-language');

function storedLanguageFile(root) {
  try {
    const value = fs.readFileSync(workspacePath(root, 'LANGUAGE'), 'utf8').trim().toLowerCase();
    return value === 'en' || value === 'ko' ? value : null;
  } catch { return null; }
}
function memoryDocumentLanguage(root) {
  try {
    const { data } = readManifest(root, { recover: true });
    const stored = data.language === 'en' || data.language === 'ko' ? data.language : storedLanguageFile(root);
    return resolvePolicy(stored || 'ko', data).language;
  } catch { return 'ko'; }
}

module.exports = { memoryDocumentLanguage };
