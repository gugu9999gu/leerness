'use strict';
const { _cellUnescape } = require('./pure-utils');
const ROW = /^\|\s*(?:T|M|D|R|UR|F|P)-\d{3,}\s*\|/;
function parseProgressRows(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!ROW.test(line)) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(s => _cellUnescape(s).trim());
    if (cells.length < 6) continue;
    const [id, status, request, evidence, nextAction, updated] = cells;
    rows.push({ id, status, request, evidence, nextAction, updated });
  }
  return rows;
}
function rawProgressRow(bytes, id) {
  if (!Buffer.isBuffer(bytes) || typeof id !== 'string' || !/^(?:T|M|D|R|UR|F|P)-\d{3,32}$/.test(id)) return null;
  const prefix = new RegExp('^\\|\\s*' + id + '\\s*\\|');
  let start = 0, found = null;
  while (start < bytes.length) {
    let end = bytes.indexOf(10, start);
    end = end === -1 ? bytes.length : end + 1;
    const raw = bytes.subarray(start, end);
    if (prefix.test(raw.toString('utf8').replace(/^\ufeff/, ''))) {
      if (found) throw Object.assign(new Error('Duplicate task source.'), { code: 'task_source_invalid' });
      found = raw;
    }
    start = end;
  }
  return found;
}
module.exports = { parseProgressRows, rawProgressRow, ROW };
