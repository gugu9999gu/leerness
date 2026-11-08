'use strict';
const path = require('node:path');
const { createSnapshot } = require('./stored-read-snapshot');
const { parseProgressRows } = require('./progress-rows');
const { _cellSafe } = require('./pure-utils');
const _historyRetention = require('./history-retention');
const VERSION = require('../package.json').version;
const absRoot = root => path.resolve(root);
const progressPath = root => path.join(root, '.leerness/progress-tracker.md');
function taskList(root, options = {}) {
  root = path.resolve(root);
  const snapshot = createSnapshot(root), output = [];
  const log = line => output.push(line);
  const has = flag => flag === '--json' ? options.json !== false : flag === '--all' && !!options.all;
  const arg = (flag, fallback) => flag === '--status' ? (options.status || fallback) : flag === '--limit' ? String(options.limit ?? fallback) : fallback;


  const trackerFile = progressPath(root);
  const trackerInput = snapshot.capture(trackerFile) || require('./memory-input').captureCheckedFileInput(trackerFile);
  const activeRows = parseProgressRows(
    require('../lib/managed-text').decodeText(trackerInput?.bytes || Buffer.alloc(0), trackerFile));
  snapshot.directory(path.join(root, '.leerness', 'archive', 'history'));
  const retainedMeta = _historyRetention.historyTaskMetadata(root, snapshot.observe);
  _historyRetention.combineTaskRows(activeRows.filter(r => /^T-/.test(r.id || '')), retainedMeta);
  const statusFilter = arg('--status', '');
  const activeFiltered = statusFilter ? activeRows.filter(r => r.status === statusFilter) : activeRows;
  const retainedFiltered = statusFilter ? retainedMeta.filter(r => r.status === statusFilter) : retainedMeta;
  const total = activeFiltered.length + retainedFiltered.length;
  if (has('--json')) {



    const _rawLim = parseInt(arg('--limit', '100'), 10);
    const _lim = has('--all') ? total : (Number.isFinite(_rawLim) && _rawLim > 0 ? _rawLim : 100);
    const activeShown = has('--all') ? activeFiltered : activeFiltered.slice(-_lim);
    const retainedNeed = has('--all') ? retainedFiltered.length : Math.max(0, _lim - activeShown.length);
    const retainedSelected = retainedNeed ? retainedFiltered.slice(-retainedNeed) : [];
    const retainedShown = retainedSelected.length ? _historyRetention.listArchivedTasks(root, retainedSelected, snapshot.observe) : [];
    const _shownRows = [...retainedShown, ...activeShown];
    const payload = {
      version: VERSION,
      root: absRoot(root),
      total,
      shown: _shownRows.length,
      truncated: _shownRows.length < total,
      tasks: _shownRows.map(r => ({
        id: r.id,
        status: r.status,
        request: r.request,
        evidence: r.evidence,
        nextAction: r.nextAction,
        updated: r.updated,
        ...(r.retained ? { retained: true, historySource: r.historySource } : {})
      }))
    };
    if (statusFilter) payload.statusFilter = statusFilter;
    snapshot.verify();
    return { text: JSON.stringify(payload, null, 2) + '\n', data: payload, snapshot };
  }
  const retainedRows = retainedFiltered.length ? _historyRetention.listArchivedTasks(root, retainedFiltered, snapshot.observe) : [];
  const filtered = [...retainedRows, ...activeFiltered];
  snapshot.verify();
  if (!filtered.length) log('(no tasks)');
  else {
  log('| ID | Status | Request | Evidence | Next Action | Updated |');
  log('|---|---|---|---|---|---|');
  for (const r of filtered) log(`| ${r.id} | ${r.status} | ${_cellSafe(r.request)} | ${_cellSafe(r.evidence)} | ${_cellSafe(r.nextAction)} | ${r.updated} |`);

  }
  return { text: output.join('\n') + '\n', data: null, snapshot };
}
module.exports = { taskList };
