'use strict';
// One optional field in the existing manifest. This is writing guidance, not a
// translator or a claim that a provider obeyed the requested language.
const { workspacePath } = require('./workspace-dir');
const fs = require('fs');
const { captureCheckedFileInput } = require('./memory-input');
const { decodeText } = require('./managed-text');
const MAX_MANIFEST_BYTES = 64 * 1024;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function invalid(reason) {
  return Object.assign(new Error(`Harness authoring language ${reason}. Use init or migrate --authoring-language en|ko|inherit.`), { code: 'E_AUTHORING_LANGUAGE' });
}
function readManifest(root, { recover = false } = {}) {
  const file = workspacePath(root, 'manifest.json');
  // First installation (including a dry-run with a missing root) has no store.
  // lstat keeps an existing symlink visible to the checked reader below.
  try { fs.lstatSync(file); } catch (e) {
    if (e.code === 'ENOENT') return { path: file, exists: false, corrupt: false, data: {} };
    throw e;
  }
  const input = captureCheckedFileInput(file, { maxBytes: MAX_MANIFEST_BYTES });
  if (!input.exists) return { path: file, exists: false, corrupt: false, data: {} };
  // Bad bytes, links and resource limits must not become a default selection.
  const text = decodeText(input.bytes, file);
  let data, reason;
  try { data = JSON.parse(text); } catch { reason = 'invalid_json'; }
  if (!reason && (!data || typeof data !== 'object' || Array.isArray(data))) reason = 'not_object';
  if (reason) {
    if (!recover) throw invalid('manifest is not a readable JSON object');
    return { path: file, exists: true, corrupt: true, reason, data: {} };
  }
  return { path: file, exists: true, corrupt: false, data };
}
function resolvePolicy(projectLanguage, manifest = {}, selection) {
  const project = projectLanguage === 'en' ? 'en' : 'ko';
  const chosen = selection === undefined
    ? (own(manifest, 'authoringLanguage') ? manifest.authoringLanguage : 'inherit') : selection;
  if (!['en', 'ko', 'inherit'].includes(chosen)) throw invalid('selection is invalid');
  return { selection: chosen, language: chosen === 'inherit' ? project : chosen,
    projectLanguage: project, explicit: chosen !== 'inherit' };
}
function readPolicy(root, projectLanguage, options) {
  const { data } = readManifest(root, options);
  return resolvePolicy(projectLanguage || data.language, data);
}
function guidance(policy) {
  if (!policy.explicit) return '';
  const name = policy.language === 'en' ? 'English' : 'Korean';
  const user = policy.projectLanguage === 'en' ? 'English' : 'Korean';
  return `Write new harness instructions, work notes and delegated artifacts in ${name}. Explain results to the user in their requested language, otherwise ${user}. Preserve quoted source, identifiers, original evidence and existing authored text; do not translate history automatically. This is writing guidance, not proof of model compliance or complete template localization.`;
}
function projectGuidance(policy) {
  const text = guidance(policy);
  return text ? `\n## Harness authoring language\n\n${text}\n` : '';
}
module.exports = { readManifest, resolvePolicy, readPolicy, guidance, projectGuidance, MAX_MANIFEST_BYTES };
