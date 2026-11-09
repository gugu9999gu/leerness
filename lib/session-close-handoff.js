'use strict';
const context = require('./context-current');
const { errorLanguage } = require('./error-language');

function scan(text) {
  const lines = [];
  let start = 0, fence = null;
  while (start < text.length) {
    const at = text.indexOf('\n', start);
    const end = at < 0 ? text.length : at + 1;
    const raw = text.slice(start, end);
    const eol = raw.endsWith('\r\n') ? '\r\n' : raw.endsWith('\n') ? '\n' : '';
    const value = raw.slice(0, raw.length - eol.length);
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(value);
    const fenced = !!fence || !!marker;
    if (fence && marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
    else if (!fence && marker) fence = marker[1];
    lines.push({ start, end, value, eol, fenced });
    start = end;
  }
  return lines;
}
function ambiguous(file) {
  return Object.assign(new Error(errorLanguage() === 'ko'
    ? `현재 인계 문서의 다음 작업 구역이 모호합니다. 원문을 보존하고 중복 제목이나 작업 지시를 정리하세요: ${file}`
    : `Ambiguous current handoff next step. Preserve the source and reconcile duplicate headings or task instructions: ${file}`), { code: 'E_TEXT_FORMAT' });
}
function renderCloseHandoff(text, generated, selected, action, file, emptyStep) {
  const generatedResult = context.updateHandoff(text, generated, file);
  const region = context.currentHandoffRegion(text);
  if (region === null) return generatedResult;
  const lines = scan(region);
  const completed = lines.find(line => !line.fenced && /^## Completed[ \t]*$/.test(line.value));
  if (lines.some(line => !line.fenced && /^Last generated: /.test(line.value) && (!completed || line.start < completed.start))) return generatedResult;
  const headings = lines.filter(line => !line.fenced && /^## Next Exact Step[ \t]*$/.test(line.value));
  if (headings.length > 1) throw ambiguous(file);
  const id = selected.row && selected.row.id;
  const desired = '- ' + (id ? id + ' — ' : '') + String(action || emptyStep).replace(/[\r\n]+/g, ' ').trim();
  const marker = '<!-- leerness:current-handoff:start -->';
  const at = text.indexOf(marker) + marker.length;
  const replace = next => text.slice(0, at) + next + text.slice(at + region.length);
  const eol = lines.find(line => line.eol)?.eol || '\n';
  if (!headings.length) {
    const separator = region.endsWith(eol + eol) ? '' : region.endsWith(eol) ? eol : eol + eol;
    return replace(region + separator + '## Next Exact Step' + eol + desired + eol);
  }
  const heading = headings[0];
  const following = lines.find(line => line.start >= heading.end && !line.fenced && /^#{1,2} /.test(line.value));
  const bodyEnd = following ? following.start : region.length;
  const body = lines.filter(line => line.start >= heading.end && line.start < bodyEnd && !line.fenced);
  const actions = body.filter(line => /^- (?:T|M|D|R|UR|F|P)-\d{3,}(?:[ \t]|$)/.test(line.value));
  if (actions.length > 1) throw ambiguous(file);
  const current = actions[0] || body.find(line => line.value.trim() === '- ' + emptyStep);
  if (current) {
    if (current.value === desired) return text;
    return replace(region.slice(0, current.start) + desired + current.eol + region.slice(current.end));
  }
  return replace(region.slice(0, heading.end) + (heading.eol ? '' : eol) + desired + eol + region.slice(heading.end));
}
module.exports = { renderCloseHandoff };
