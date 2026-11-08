'use strict';
 
 
 
 
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
