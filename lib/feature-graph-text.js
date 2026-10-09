'use strict';
// Mutation-only boundary. General graph observations keep their existing reader.
const { captureTextEdit, publishTextEdit } = require('./managed-text');
const { assertWriteAllowed } = require('./io');
const { _parseFeatureGraph, _featureGraphNodeRanges, _featureGraphTemplate, _featureBlock, _lineSafe } = require('./pure-utils');
const linkFields = new Set(['depends-on', 'affects', 'co-changes-with']);
function invalid(message) { return Object.assign(new Error('Feature graph edit rejected: ' + message), { code: 'E_FEATURE_EDIT' }); }
const lineEnding = text => (text.match(/\r?\n/) || ['\n'])[0];
function atStage(stage, action) {
  try { return action(); }
  catch (error) { error.featureGraphStage = stage;throw error; }
}
function renderEdit(text, change) {
  const eol = lineEnding(text);
  if (change.type === 'add') {
    if (!change.node || !/^F-\d{4,}$/.test(change.node.id)) throw invalid('invalid node ID');
    const separator = !text || text.endsWith('\n\n') || text.endsWith('\r\n\r\n') ? '' : (text.endsWith('\n') ? eol : eol + eol);
    return text + separator + _featureBlock(change.node).replace(/\n/g, eol);
  }
  if (change.type !== 'link') throw invalid('unsupported operation');
  const range = _featureGraphNodeRanges(text).find(item => item.id === change.id);
  if (!range) throw invalid('node no longer matches the captured source');
  let block = text.slice(range.start, range.end);
  for (const [key, values] of Object.entries(change.fields)) {
    if (!linkFields.has(key) || !Array.isArray(values)) throw invalid('unsupported relationship field');
    const value = values.map(_lineSafe).join(', ');
    const pattern = new RegExp('^(- ' + key + ':)([ \\t]*)([^\\r\\n]*)(\\r?\\n|$)', 'im');
    const match = pattern.exec(block);
    if (match) {
      const line = match[1] + (match[2] || ' ') + value + match[4];
      block = block.slice(0, match.index) + line + block.slice(match.index + match[0].length);
    } else {
      // Place missing fields directly after the heading, before authored notes.
      const nextLine = block.indexOf('\n', range.headingEnd - range.start);
      const at = nextLine < 0 ? block.length : nextLine + 1;
      block = block.slice(0, at) + (at && !block.slice(0, at).endsWith('\n') ? eol : '') + '- ' + key + ': ' + value + eol + block.slice(at);
    }
  }
  return text.slice(0, range.start) + block + text.slice(range.end);
}
function createEditor(file) {
  let edit;
  return {
    read() {
      edit = atStage('read', () => captureTextEdit(file));
      return { nodes: _parseFeatureGraph(edit.text), text: edit.text };
    },
    write(change) {
      if (!edit) throw invalid('read the source under its existing lock first');
      atStage('permission', () => assertWriteAllowed(file));
      const candidate = atStage('render', () => renderEdit(edit.exists ? edit.text : _featureGraphTemplate(), change));
      return atStage('publish', () => publishTextEdit(edit, file, candidate));
    }
  };
}
module.exports = { createEditor };
