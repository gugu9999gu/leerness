'use strict';

// Derived navigation only. Canonical tasks, rules, criteria and evidence remain
// authoritative; this module never archives, deletes or changes their status.
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { captureCheckedFileInput, assertCheckedFileCurrent } = require('./memory-input');
const { decodeText, MAX_TEXT_BYTES } = require('./managed-text');
const historyStore = require('./history-retention');
const { errorLanguage } = require('./error-language');
const DEFAULT_RECENT = 10;
const STATUSES = ['requested', 'planned', 'in-progress', 'waiting', 'on-hold', 'blocked', 'incomplete', 'done', 'dropped'];
const ALIASES = { completed: 'done', complete: 'done', finished: 'done', verified: 'done', cancelled: 'dropped', canceled: 'dropped', cancel: 'dropped', in_progress: 'in-progress', wip: 'in-progress', on_hold: 'on-hold', hold: 'on-hold' };
const START = '<!-- leerness:current-handoff:start -->';
const END = '<!-- leerness:current-handoff:end -->';
const DOCUMENTS = ['session-handoff.md', 'current-state.md', 'progress-tracker.md', 'plan.md', 'task-log.md', 'session-workflow.md', 'context-routing.md', 'guideline.md', 'protected-files.md', 'writeback-policy.md', 'anti-lazy-work-policy.md', 'rules.md'];
const error = (code, message) => Object.assign(new Error(message), { code });
function normalizeStatus(value) {
  const status = String(value || '').toLowerCase().trim();
  return STATUSES.includes(status) ? status : ALIASES[status] || 'other';
}
function recentLimit(value = DEFAULT_RECENT) {
  if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(String(value))) throw error('invalid_limit', 'Recent reference limit must be an integer from 1 to 50.');
  return Number(value);
}
function recentRows(rows, limit = DEFAULT_RECENT) {
  limit = recentLimit(limit);
  // Updated is not a completion timestamp. Ties use later canonical row order;
  // no date or task ID is invented to imply completion chronology.
  const date = r => /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(r.updated) && Number.isFinite(Date.parse(r.updated)) ? Date.parse(r.updated) : -Infinity;
  return rows.map((row, index) => ({ row, index })).sort((a, b) => date(b.row) - date(a.row) || b.index - a.index).slice(0, limit).map(x => x.row);
}
function historyReferences(rows, limit = DEFAULT_RECENT, translate = (_ko, en) => en) {
  const recent = recentRows(rows, limit);
  const lines = recent.map(r => `- ${r.id} (${normalizeStatus(r.status)}, updated: ${r.updated || 'unknown'}) — progress-tracker.md: ${r.id}`);
  lines.push(translate(
    `- 전체 ${rows.length}건 중 최근 갱신 ${recent.length}건의 참조. 원문·근거는 progress-tracker.md, 전체 조회: leerness task list --all --json. 보관·삭제하지 않음.`,
    `- ${recent.length} recently updated references of ${rows.length} total. Full records/evidence: progress-tracker.md; list all: leerness task list --all --json. Nothing archived or deleted.`
  ));
  return lines.join('\n');
}
function workspace(root) {
  root = path.resolve(root);
  const dir = path.join(root, '.leerness');
  try {
    if (!fs.statSync(root).isDirectory()) throw error('path_not_found', 'Project root must be a directory.');
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw error('invalid_workspace', 'The .leerness workspace must be a regular directory.');
  } catch (e) { if (e.code === 'ENOENT') throw error('harness_missing', 'Project or .leerness workspace is missing.');throw e; }
  return { root, dir };
}
function readingSize(root) {
  const ws = workspace(root);
  // Metadata only: fixed list, no directory recursion, document reads, child
  // processes or persisted cache. This is not a content freshness certificate.
  const files = DOCUMENTS.map(name => {
    const file = '.leerness/' + name;
    const targetBytes = ['session-handoff.md', 'current-state.md'].includes(name) ? 8192 : null;
    try {
      const stat = fs.lstatSync(path.join(ws.dir, name));
      if (!stat.isFile() || stat.isSymbolicLink()) throw error('not_regular_file', 'Not a regular document.');
      return { file, state: 'measured', bytes: stat.size, modifiedAt: stat.mtime.toISOString(), targetBytes, over: targetBytes !== null && stat.size > targetBytes };
    } catch (e) {
      return { file, state: e.code === 'ENOENT' ? 'missing' : 'unavailable', bytes: null, targetBytes, over: null, code: e.code };
    }
  });
  const known = !files.some(f => f.state === 'unavailable');
  const nonRule = files.filter(f => !f.file.endsWith('/rules.md'));
  const measuredNonRuleBytes = nonRule.reduce((sum, f) => sum + (f.bytes || 0), 0);
  return { schemaVersion: 1, ok: known, root: ws.root, mode: 'metadata-only', files,
    nonRuleBytes: known ? measuredNonRuleBytes : null, measuredNonRuleBytes, targetBytes: 32768,
    over: known ? measuredNonRuleBytes > 32768 || files.some(f => f.over) : null,
    partial: !known, archiveBodiesRead: 0,
    notice: 'Advisory bytes for the named documents only, not tokens, total disk use or measured reading time. Missing files are listed; unavailable sizes make the total unknown. Keep required instructions and evidence even above the target.' };
}
function currentContext(root, { task = null, limit = DEFAULT_RECENT } = {}, readProgressRows) {
  const ws = workspace(root);limit = recentLimit(limit);
  if (task !== null && !/^(?:T|M|D|R|UR|F|P)-\d{3,}$/.test(task)) throw error('invalid_task', 'Use an exact canonical task ID.');
  const captured = ['progress-tracker.md', 'rules.md'].map(name => {
    const file = path.join(ws.dir, name);
    const input = captureCheckedFileInput(file, { maxBytes: MAX_TEXT_BYTES });
    if (!input.exists) throw error('context_source_missing', `Required context source is missing: .leerness/${name}`);
    return { file, name, input, text: decodeText(input.bytes, file) };
  });
  const rows = readProgressRows(ws.root, captured[0].text);
  const candidates = captured[0].text.split('\n').filter(line => /^\|\s*(?:T|M|D|R|UR|F|P)-\d{3,}\s*\|/.test(line));
  if (rows.length !== candidates.length || new Set(rows.map(r => r.id)).size !== rows.length) throw error('context_source_invalid', 'Malformed or duplicate task rows; preserve the tracker and inspect the source.');
  const retainedMeta = historyStore.historyTaskMetadata(ws.root);
  historyStore.combineTaskRows(rows.filter(r => /^T-/.test(r.id)), retainedMeta);
  const counts = Object.fromEntries([...STATUSES, 'other'].map(status => [status, 0]));
  for (const row of rows) counts[normalizeStatus(row.status)]++;
  for (const row of retainedMeta) counts[normalizeStatus(row.status)]++;
  const terminal = rows.filter(r => ['done', 'dropped'].includes(normalizeStatus(r.status)));
  let selected;
  if (task) {
    const active = rows.find(r => r.id === task) || null;
    const retained = /^T-/.test(task) ? historyStore.findArchivedTask(ws.root, task) : null;
    if (active && retained) throw error('history_task_duplicate', `Task ${task} exists in both active and retained history.`);
    selected = active ? [active] : retained ? [retained] : [];
  } else selected = rows.filter(r => !['done', 'dropped'].includes(normalizeStatus(r.status)));
  if (task && !selected.length) throw error('task_not_found', `Task ${task} was not found in the active tracker or indexed retained history.`);
  const retainedRefs = retainedMeta.map(r => ({ ...r, source: `.leerness/archive/history/${r.source}`, retained: true }));
  const activeRefs = terminal.map(r => ({ ...r, source: '.leerness/progress-tracker.md', retained: false }));
  const history = task ? [] : recentRows([...activeRefs, ...retainedRefs], limit).map(r => ({ id: r.id, status: r.status, updated: r.updated, source: r.source, retained: !!r.retained }));
  for (const source of captured) assertCheckedFileCurrent(source.input, source.file);
  const payload = { schemaVersion: 1, ok: true, root: ws.root, scope: task ? { task } : { currentTasks: true }, navigationOnly: true,
    counts, tasks: selected, history: { total: terminal.length + retainedMeta.length, active: terminal.length, retained: retainedMeta.length, shown: history.length, omitted: terminal.length + retainedMeta.length - history.length, order: 'updated-descending; canonical-row-descending for ties', references: history },
    rules: { source: '.leerness/rules.md', text: captured[1].text },
    sources: captured.map(s => ({ file: '.leerness/' + s.name, bytes: s.input.bytes.length, sha256: createHash('sha256').update(s.input.bytes).digest('hex') })),
    requiredReads: ['AGENTS.md', '.leerness/session-workflow.md', '.leerness/context-routing.md', '.leerness/current-state.md', '.leerness/plan.md', '.leerness/review-evidence.md'],
    notice: 'Derived task navigation, not a complete delegation/review packet or approval. Task fields and rule text are unabridged. Retrieve applicable user instructions, dependencies, fixed criteria, open findings and referenced evidence before acting. Exact IDs scope those reads; changed sources require refresh. Active history stays canonical; indexed retained task history contributes counts and references, and retained bodies are read only for exact retained-task lookup.' };
  payload.size = { contentBytes: Buffer.byteLength(JSON.stringify(payload)), targetBytes: 8192 };
  payload.size.over = payload.size.contentBytes > payload.size.targetBytes;
  payload.size.truncated = false;
  return payload;
}
function renderCurrent(data) {
  const lines = ['# Current task navigation', data.notice, '', `Tasks: ${Object.entries(data.counts).map(([s, n]) => `${s}=${n}`).join(', ')}`, ''];
  for (const r of data.tasks) lines.push(`## ${r.id} — ${r.status}`, r.request, `Next: ${r.nextAction}`, `Evidence: ${r.evidence}`, `Updated: ${r.updated}`, '');
  lines.push('## Recent history references', ...data.history.references.map(r => `- ${r.id} ${r.status} ${r.updated} — ${r.source}`), `Shown ${data.history.shown}/${data.history.total}; omitted ${data.history.omitted}.`, '', '## Rules source (unabridged)', data.rules.text, '', '## Required source navigation', ...data.requiredReads.map(f => '- ' + f), ...data.sources.map(s => `- ${s.file} sha256=${s.sha256}`));
  lines.push(`\nSize: ${data.size.contentBytes} content bytes, target ${data.size.targetBytes}; ${data.size.over ? 'OVER — required content retained' : 'within target'}.`);
  return lines.join('\n');
}
function renderSize(data) {
  return ['# Context reading size', data.notice, ...data.files.map(f => `- ${f.file}: ${f.bytes === null ? f.state : `${f.bytes} bytes`}${f.over ? ' — OVER target' : ''}`), `Non-rule total: ${data.nonRuleBytes === null ? 'unknown' : data.nonRuleBytes} bytes; target ${data.targetBytes}; ${data.over === null ? 'partial' : data.over ? 'OVER' : 'within target'}.`, 'Read current tasks: leerness context current [--task T-ID]. No records changed.'].join('\n');
}
// T-0307: user text inside the generated region is kept by position. The generator owns its title
// line, every "Last generated:" line and each `##` section heading it writes itself (with the body up
// to the next heading). Text under the title is the user's only when the generator writes nothing
// but the title and "Last generated:" there. Everything else — a note under the title, a section the
// generator never writes — moves verbatim to just after the region, where later closes leave it.
// Headings inside fenced code are content, not structure.
function _userTextInRegion(region, block) {
  const blockLines = block.split(/\r?\n/);
  const firstSection = blockLines.findIndex(line => /^## /.test(line));
  const blockHead = (firstSection < 0 ? blockLines : blockLines.slice(0, firstSection)).filter(line => line.trim());
  const titles = new Set(blockLines.filter(line => /^# /.test(line)).map(line => line.trim()));
  const sections = new Set(blockLines.filter(line => /^## /.test(line)).map(line => line.trim()));
  const headIsUsers = blockHead.every(line => titles.has(line.trim()) || /^Last generated:/.test(line));
  const kept = [];
  let head = true, owned = true, fence = null;
  for (const line of region.split(/\r?\n/)) {
    const mark = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = null;
    } else if (mark) {
      fence = mark[1];
    } else if (/^## /.test(line)) {
      head = false;
      owned = sections.has(line.trim());
      if (!owned) kept.push(line);
      continue;
    } else if (titles.has(line.trim()) || /^Last generated:/.test(line)) {
      continue;
    }
    if (head ? headIsUsers : !owned) kept.push(line);
  }
  // Drop only surrounding blank lines; indentation of the kept text is part of the user's text.
  while (kept.length && !kept[0].trim()) kept.shift();
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  return kept.length ? kept.join('\n') + '\n' : '';
}

// The generated region of a handoff document, or null when the document has no markers yet.
function currentHandoffRegion(text) {
  const a = text.indexOf(START), b = text.indexOf(END);
  return a >= 0 && b > a ? text.slice(a + START.length, b) : null;
}

function updateHandoff(text, block, file) {
  const frontmatter = /^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/.exec(text);
  // T-0337: these three are in Korean for a Korean project (lib/error-language.js) and keep their English text otherwise;
  // the language is asked only when one is thrown.
  const korean = () => errorLanguage() === 'ko';
  if (/^---\r?\n/.test(text) && !frontmatter) throw error('E_TEXT_FORMAT', korean() ? `세션 인계 문서의 머리말(frontmatter)이 닫혀 있지 않습니다: ${file}`
    : `Session handoff frontmatter is not closed: ${file}`);
  if (block.includes(START) || block.includes(END)) throw error('E_TEXT_FORMAT', korean() ? `생성한 내용에 인계 문서 예약 표식이 들어 있습니다: ${file}`
    : `Generated content contains reserved handoff markers: ${file}`);
  const starts = text.split(START).length - 1, ends = text.split(END).length - 1;
  const next = START + '\n' + block + (block.endsWith('\n') ? '' : '\n') + END;
  if (!starts && !ends) {
    const at = frontmatter ? frontmatter[0].length : 0;
    return text.slice(0, at) + (at && text[at - 1] !== '\n' ? '\n' : '') + next + '\n\n' + text.slice(at);
  }
  const a = text.indexOf(START), b = text.indexOf(END);
  const wholeLine = (at, marker) => (at === 0 || text[at - 1] === '\n') && /^(?:\r?\n|$)/.test(text.slice(at + marker.length));
  let fence = null, fencedMarker = false;
  for (const line of text.split(/\r?\n/)) {
    if (fence && (line.includes(START) || line.includes(END))) fencedMarker = true;
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (match && !fence) fence = match[1];
    else if (match && fence && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = null;
  }
  if (starts !== 1 || ends !== 1 || b <= a || (frontmatter && a < frontmatter[0].length) || fencedMarker || !wholeLine(a, START) || !wholeLine(b, END)) {
    throw error('E_TEXT_FORMAT', korean() ? `인계 문서의 생성 구역 표식이 모호합니다: ${file}` : `Ambiguous generated handoff markers: ${file}`);
  }
  const user = _userTextInRegion(text.slice(a + START.length, b), block);
  const after = text.slice(b + END.length);
  return text.slice(0, a) + next + (user ? '\n\n' + user.replace(/\n+$/, '') + (after.startsWith('\n') ? '' : '\n') : '') + after;
}

module.exports = { DEFAULT_RECENT, normalizeStatus, recentRows, historyReferences, readingSize, currentContext, renderCurrent, renderSize, updateHandoff, currentHandoffRegion };
