'use strict';
const contextCurrent = require('./context-current');

const START = '<!-- leerness:owner-priorities:start -->';
const END = '<!-- leerness:owner-priorities:end -->';
const ACTIONABLE = new Set(['in-progress', 'planned', 'requested', 'incomplete']);

function priorityIds(planText) {
  const lines = String(planText || '').split(/\r?\n/);
  const starts = [], ends = [];
  lines.forEach((line, index) => {
    if (line === START) starts.push(index);
    if (line === END) ends.push(index);
  });
  if (!starts.length && !ends.length) return [];
  if (starts.length !== 1 || ends.length !== 1 || ends[0] <= starts[0]) {
    const error = new Error('Owner priorities have ambiguous markers; correct plan.md before session close.');
    error.code = 'invalid_owner_priorities';
    throw error;
  }
  const ids = [];
  for (const line of lines.slice(starts[0] + 1, ends[0])) {
    if (!/^\s*[1-9]\d*\.\s/.test(line)) continue;
    for (const match of line.matchAll(/\b(?:T|M|D|R|UR|F|P)-\d{3,}\b/g)) {
      if (!ids.includes(match[0])) ids.push(match[0]);
    }
  }
  return ids;
}

function selectNextTask(rows, planText = '', explicitId = null) {
  const active = rows.filter(row => ACTIONABLE.has(contextCurrent.normalizeStatus(row.status)));
  const find = id => active.find(row => row.id === id);
  if (explicitId !== null) {
    if (typeof explicitId !== 'string' || !/^(?:T|M|D|R|UR|F|P)-\d{3,}$/.test(explicitId) || !find(explicitId)) {
      const error = new Error('Selected next task is missing or not actionable: ' + String(explicitId));
      error.code = 'invalid_next_task';
      throw error;
    }
    return { row: find(explicitId), source: 'explicit-task' };
  }
  for (const id of priorityIds(planText)) {
    const row = find(id);
    if (row) return { row, source: 'owner-priorities' };
  }
  for (const status of ['in-progress', 'planned', 'requested', 'incomplete']) {
    const latest = contextCurrent.recentRows(active.filter(row => contextCurrent.normalizeStatus(row.status) === status), 1)[0];
    if (latest) return { row: latest, source: 'recent-' + status };
  }
  return { row: null, source: 'none' };
}

module.exports = { priorityIds, selectNextTask };
