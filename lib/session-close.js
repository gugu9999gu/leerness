 
 
 
 
'use strict';
const cp = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { applyShellScriptUtf8Bom } = require('./shell-encoding');
const { log, ok, warn, fail, failJson, today, now, absRoot, exists, read, readBuf, mkdirp, rel, assertWriteAllowed } = require('./io');
const { captureCheckedFileInput, assertCheckedFileCurrent } = require('./memory-input');
const { readCheckedText, captureTextEdit, assertTextEditCurrent, publishTextEdit, decodeText, MAX_TEXT_BYTES } = require('./managed-text');
const { withStateLock } = require('./state-lock');
const { _sanitizeFences, _parseArchiveBlocks, _milestoneSurface, _recentChangesAggregate, _taskMatchText, _isDoneStatus } = require('./pure-utils');
const { readExecutionEvents } = require('./role-fallback');
const { summarizeRuleObservations, ruleObservationNotice } = require('./rule-verification');
const contextCurrent = require('./context-current');
const { selectNextTask } = require('./session-next');

 
 
 
 
 
//
 
 
 
function _executionProvenanceSummary(root, limit = 12) {
  const history = readExecutionEvents(root, limit);
  const events = Array.isArray(history.events) ? history.events : [];
  const clean = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const lines = events.map(event => {
    const executor = event.actualExecutor && typeof event.actualExecutor === 'object' ? event.actualExecutor : {};
    const who = executor.provider
      ? `${clean(executor.provider)}${executor.model ? '/' + clean(executor.model) : ''}${executor.modelFamily ? ' family=' + clean(executor.modelFamily) : ''}`
      : '-';
    const summary = event.result && event.result.summary ? ` — ${clean(event.result.summary).slice(0, 160)}` : '';
    const independent = event.review && Object.prototype.hasOwnProperty.call(event.review, 'reviewerIndependence')
      ? ` · independence=${clean(event.review.reviewerIndependence)}` : '';
    return `- ${clean(event.at).slice(0, 19)} ${clean(event.event) || 'unknown-event'} · role=${clean(event.role) || '-'} · ${who}${independent}${summary}`;
  });
  return {
    known: history.ok === true,
    partial: !!(history.invalidLines || history.truncated),
    code: history.code || null,
    error: history.error || null,
    invalidLines: history.invalidLines || 0,
    truncated: !!history.truncated,
    totalRead: history.totalRead || 0,
    events,
    markdownLines: lines.length ? lines : ['- none'],
    file: history.file,
  };
}

const AUTO_MARK = '<!-- leerness:auto -->';
function _upsertAutoLines(md, heading, autoLines) {
  const re = new RegExp(`(?:^|\\n)## ${heading}[ \\t]*\\r?\\n`);
  const m = re.exec(md);
  if (!m) return md;                                     
  const bodyStart = m.index + m[0].length;
  const nextIdx = md.indexOf('\n## ', bodyStart);
  const bodyEnd = nextIdx < 0 ? md.length : nextIdx + 1;
  const body = md.slice(bodyStart, bodyEnd);
  const kept = body.split('\n').filter(l => !l.includes(AUTO_MARK));
  while (kept.length && !kept[0].trim()) kept.shift();    
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  const merged = autoLines.map(l => `${l} ${AUTO_MARK}`).concat(kept).join('\n');
   
  return md.slice(0, bodyStart) + merged + '\n' + (nextIdx < 0 ? '' : '\n' + md.slice(bodyEnd));
}

 
 
 
const _gitSpawn = require('./git').gitSpawn;
const { renderCloseHandoff: _renderCloseHandoff } = require('./session-close-handoff');

function sessionClose(root, opts = {}, deps = {}) {
  let diagnosticFailure = null, closeRows = [], closePlan = '';
  const closeDocumentsPublished = [];
  const diagnose = fn => {
    try { return fn(); }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ELOOP') error.code = 'E_STORE_CHANGED';
      if (['EACCES', 'EPERM', 'EIO'].includes(error.code)) error.code = 'E_STORE_UNREADABLE';
      error.storeRead = true; diagnosticFailure ||= error; throw error;
    }
  };
  const assertDiagnosticReads = () => {
    if (!diagnosticFailure) return;
    if (closeDocumentsPublished.length) {
      diagnosticFailure.closeDocumentsPublished = closeDocumentsPublished.slice();
      diagnosticFailure.message += ' Session close diagnostics stopped after publishing ' + closeDocumentsPublished.map(file => path.basename(file)).join(', ') + '. Earlier writes were not rolled back; inspect the documents before retrying.';
    }
    throw diagnosticFailure;
  };
  const tracked = { ...deps };
  for (const name of ['readProgressRows', '_loadDecisions', 'readRules', '_loadLessons', '_readFeatureGraph', '_auditUserRequests', '_detectDeliveredRequests', 'readSessionCounter', '_retroAggregate', '_loadShellFailures', '_readUsageStats', '_runPreWakeAudit', '_runIdempotencyAudit', '_detectAbnormalShutdown', '_collectSecretFindings', '_listAPISkills', '_matchAPISkills']) {
    const fn = deps[name];
    if (typeof fn === 'function') tracked[name] = (...args) => diagnose(() => fn(...args));
  }
  deps = tracked;
  const read = file => diagnose(() => readCheckedText(file).text);
  const exists = file => diagnose(() => readCheckedText(file).exists);
  const { VERSION, STATUSES, MARK, has, arg, uiLang, harnessPath, readProgressRows, evidencePath, handoffPath, currentStatePath, taskLogPath, verifyRules, _autoRoadmap, _readUsageStats, readSessionCounter, writeSessionCounter, _retroAggregate, _retroOneLine, retroCmd, _loadDecisions, readRules, planPath, _loadLessons, _readFeatureGraph, _auditUserRequests, _detectDeliveredRequests, _computeRoundHistory, _computeMilestones, _computeRecentChanges, _collectPyFiles, _analyzePyFile, _collectRuntimeEnv, _scanShellScriptsEncoding, _listAPISkills, _matchAPISkills, _loadShellFailures, _shellEnvDrift, _runPreWakeAudit, _saveAndAppendPreWakeReport, _runIdempotencyAudit, _detectAbnormalShutdown, _updateUserRequest, _detectOptimism, _scanCodeForPatterns, _collectSecretFindings } = deps;
   
  const t = (ko, en) => (uiLang === 'en' ? en : ko);
  root = absRoot(root);
   
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) { failJson(!!opts.json || has('--json'), 'path_not_found', `경로 없음 또는 디렉토리 아님: ${root}`); return; }
   
  const jsonMode = !!opts.json || has('--json');
  const _origWrite = process.stdout.write.bind(process.stdout);
  if (jsonMode) process.stdout.write = () => true;
  const jsonResult = { version: VERSION, root, closedAt: now() };
  try {
  const authoringPolicy = require('./authoring-language').readPolicy(root, uiLang);
  const doc = (ko, en) => (authoringPolicy.language === 'en' ? en : ko);
  jsonResult.authoringPolicy = authoringPolicy;
   
   
   
   
   
   
   
   
  const _captureLock = typeof deps._withLock === 'function' ? deps._withLock : withStateLock;
  const sources = [deps.progressPath(root), evidencePath(root), planPath(root)].map(file => _captureLock(file, () => {
    const input = captureCheckedFileInput(file, { maxBytes: MAX_TEXT_BYTES });
    return { file, input, text: decodeText(input.bytes || Buffer.alloc(0), file) };
  }));
  const rows = readProgressRows(root, sources[0].text);
  closeRows = rows; closePlan = sources[2].text;
  const selected = selectNextTask(rows, sources[2].text, has('--task') ? arg('--task', null) : null);
  jsonResult.nextTask = { id: selected.row?.id || null, source: selected.source };
  const buckets = {};
  for (const s of STATUSES) buckets[s] = [];
   
   
  buckets.other = [];
  for (const r of rows) {
    const s = contextCurrent.normalizeStatus(r.status);
    buckets[s].push(r);
  }
   
  jsonResult.taskCounts = {};
  for (const s of STATUSES) jsonResult.taskCounts[s] = (buckets[s] || []).length;
  if (buckets.other.length) jsonResult.taskCounts.other = buckets.other.length;
  jsonResult.recommendedDirection = selected.row?.request || null;
  jsonResult.nextExactStep = selected.row?.nextAction || null;
   
   
   
   
  const _doneClaims = rows.filter(r => _isDoneStatus(r.status));
  const _doneNoEvidence = _doneClaims.filter(r => !r.evidence || /^(\s*|user-request|-)$/.test(r.evidence) || /^plan:M-\d{4,}\s*$/.test(r.evidence));
  jsonResult.completionHonesty = { doneTotal: _doneClaims.length, doneWithoutEvidence: _doneNoEvidence.length, ids: _doneNoEvidence.slice(0, 5).map(r => r.id) };
  if (_doneNoEvidence.length) log(t(`  ⚠ 완료 정직성: done ${_doneNoEvidence.length}건 evidence 없음/placeholder (${_doneNoEvidence.slice(0, 3).map(r => r.id).join(', ')}) — verify-claim 권장 (advisory)`, `  ⚠ completion honesty: ${_doneNoEvidence.length} done with no/placeholder evidence (${_doneNoEvidence.slice(0, 3).map(r => r.id).join(', ')}) — verify-claim recommended (advisory)`));
   
   
  let _doneOptimism = [];
  try {
    if (_detectOptimism && _scanCodeForPatterns && _doneClaims.length) {
      const _codeText = _scanCodeForPatterns(root);
      _doneOptimism = _doneClaims.map(r => ({ id: r.id, suspects: _detectOptimism(r.evidence || '', _codeText) || [] })).filter(x => x.suspects.length);
    }
  } catch {}
  jsonResult.completionHonesty.optimismUnresolved = _doneOptimism.map(x => ({ id: x.id, kinds: x.suspects.map(s => s.kind) }));
  if (_doneOptimism.length) log(t(`  ⚠ 완료 정직성: done ${_doneOptimism.length}건 낙관 의심 미해소 (${_doneOptimism.slice(0, 3).map(x => x.id).join(', ')}) — evidence 주장 vs 코드 흔적 불일치, 마감 전 verify-claim 재확인 권장 (advisory)`, `  ⚠ completion honesty: ${_doneOptimism.length} done with unresolved optimism (${_doneOptimism.slice(0, 3).map(x => x.id).join(', ')}) — evidence claim vs code trace mismatch, re-check with verify-claim before closing (advisory)`));
   
  let _closeSecrets = 0;
   
  try { if (_collectSecretFindings) { const _s = _collectSecretFindings(root) || {}; _closeSecrets = (_s.unacknowledged || _s.committed || []).length; } } catch {}
  jsonResult.closeSecurity = { committedSecrets: _closeSecrets };
  try { const loopGuard = require('./loop-guard').summaryFor(root, uiLang); jsonResult.loopGuard = loopGuard.doc; for (const line of loopGuard.lines) log('  ' + line); } catch {}   // loop guard: read-only, nothing when no ledger exists, exit code unchanged
  if (_closeSecrets) log(t(`  🚨 마감 보안: 커밋 대상 시크릿 ${_closeSecrets}건 미해소 — clean 아님, leerness scan secrets 확인 후 마감 권장`, `  🚨 close security: ${_closeSecrets} committed secret(s) unresolved — not clean, run leerness scan secrets before closing`));

  function rowsToList(arr, translate = t) {
    if (!arr || !arr.length) return translate('- 없음', '- none');   
    return arr.map(r => `- ${r.id} ${r.request} → next: ${r.nextAction}`).join('\n');
  }
  const terminalList = (arr, translate) => contextCurrent.historyReferences(arr, contextCurrent.DEFAULT_RECENT, translate);
  jsonResult.historyReferences = Object.fromEntries(['done', 'dropped'].map(status => [status, {
    total: buckets[status].length,
    shown: Math.min(buckets[status].length, contextCurrent.DEFAULT_RECENT),
    ids: contextCurrent.recentRows(buckets[status]).map(r => r.id),
  }]));

   
  const evidenceSummary = _sanitizeFences(sources[1].input.exists ? sources[1].text.split('\n').slice(-30).join('\n') : '(no review-evidence.md)');
  const executionProvenance = _executionProvenanceSummary(root, 12);
  jsonResult.executionProvenance = {
    known: executionProvenance.known,
    partial: executionProvenance.partial,
    code: executionProvenance.code,
    error: executionProvenance.error,
    invalidLines: executionProvenance.invalidLines,
    truncated: executionProvenance.truncated,
    totalRead: executionProvenance.totalRead,
    events: executionProvenance.events,
  };
  if (!executionProvenance.known && executionProvenance.code) process.exitCode = 1;
  const block = [
    `# Session Handoff`,
    ``,
    `Last generated: ${now()}`,
    ``,
    `## Completed`,
    terminalList(buckets['done'], doc),
    ``,
    `## In Progress`,
    rowsToList(buckets['in-progress'], doc),
    ``,
    `## Planned / Requested`,
    rowsToList([...(buckets['planned'] || []), ...(buckets['requested'] || [])], doc),
    ``,
    `## Incomplete / Waiting / On Hold / Blocked`,
    rowsToList([...(buckets['incomplete']||[]), ...(buckets['waiting']||[]), ...(buckets['on-hold']||[]), ...(buckets['blocked']||[]), ...(buckets.other||[])], doc),    
    ``,
    `## Dropped`,
    terminalList(buckets['dropped'], doc),
    ``,
    `## Verification`,
    '```',
    evidenceSummary.trim() || '(empty)',
    '```',
    ``,
    `## Agent / Model Provenance`,
    ...executionProvenance.markdownLines,
    ...(executionProvenance.partial ? [`- ⚠ ledger partial: ${executionProvenance.code || 'truncated'}`] : []),
    ``,
    `## Recommended Direction`,
    `- ${jsonResult.recommendedDirection || doc('다음 우선순위를 사용자와 정합니다.', 'Agree the next priority with the user.')}`,
    ``,
    `## Next Exact Step`,
    '- ' + (selected.row ? selected.row.id + ' — ' : '') + (jsonResult.nextExactStep || doc('없음', 'none')),
    ``
  ].join('\n');
   
   
   
   
  const _lk = typeof deps._withLock === 'function' ? deps._withLock : withStateLock;
  const targets = [
    { file: handoffPath(root), render: cur => _renderCloseHandoff(cur, block, selected, jsonResult.nextExactStep, handoffPath(root), doc('없음', 'none')) },
    { file: currentStatePath(root), optional: true, render: cur => {
      let cs = cur.replace(/Updated: \d{4}-\d{2}-\d{2}/, `Updated: ${today()}`);
      cs = _upsertAutoLines(cs, 'Now', [`- ${jsonResult.recommendedDirection || doc('대기 중', 'waiting')}`]);
      cs = _upsertAutoLines(cs, 'Next', [`- ${jsonResult.nextExactStep || doc('계획된 작업 없음', 'no planned tasks')}`]);
      return _upsertAutoLines(cs, 'Blockers', (buckets['blocked'] || []).length ? buckets['blocked'].map(b => `- ${b.id} ${b.request}`) : [doc('- (없음)', '- (none)')]);
    } },
    { file: taskLogPath(root), render: cur => cur + `\n## ${today()} session-close\n- Generated session-handoff.md and refreshed current-state.md.\n` },
  ];
  assertDiagnosticReads();
  const edits = targets.map(target => _lk(target.file, () => {
     
     
    assertWriteAllowed(target.file);
    const edit = captureTextEdit(target.file);
    if (target.optional && !edit.exists) return null;
    const text = target.render(edit.text);
    assertTextEditCurrent(edit, target.file, text);
    return { file: target.file, edit, text };
  })).filter(Boolean);
  const published = closeDocumentsPublished;
  try {
    for (const entry of edits) _lk(entry.file, () => {
      for (const source of sources) assertCheckedFileCurrent(source.input, source.file);
      publishTextEdit(entry.edit, entry.file, entry.text);
      published.push(entry.file);
    });
  } catch (error) {
    if (published.length) {
      error.closeDocumentsPublished = published.slice();
      const names = published.map(file => path.basename(file)).join(', ');
      error.message += t(` 세션 마감이 ${names} 를 저장한 뒤 멈췄습니다. 앞서 저장한 내용은 되돌리지 않았습니다. 다시 시도하기 전에 이 문서들을 확인하세요.`,
        ` Session close stopped after publishing ${names}; earlier writes were not rolled back. Inspect these documents before retrying.`);
    }
    throw error;
  }

  log('# Session Close');
  log('## Task Lists');
  for (const s of STATUSES) {
    log(`\n### ${s}`);
    log(['done', 'dropped'].includes(s) ? terminalList(buckets[s], t) : rowsToList(buckets[s]));
  }
  if (buckets.other.length) { log('\n### other');log(rowsToList(buckets.other)); }
  jsonResult.contextReading = contextCurrent.readingSize(root);
  if (jsonResult.contextReading.over || jsonResult.contextReading.partial) {
    log(t('현재 문서 읽기 분량: 기준 초과 또는 크기 미확인. context budget --files-only로 확인하세요. 필수 내용과 기존 원문은 보존했습니다.', 'Current reading set exceeds its advisory size or has unknown sizes. Inspect context budget --files-only. Required content and existing source prose were retained.'));
  }
  log('\n## Agent / Model Provenance');
  executionProvenance.markdownLines.forEach(line => log(line));
  if (executionProvenance.partial) warn(t(`execution ledger가 일부만 신뢰 가능합니다: ${executionProvenance.code || 'truncated'}`, `execution ledger is only partially reliable: ${executionProvenance.code || 'truncated'}`));
   
  const ruleResults = verifyRules(root);
  jsonResult.rules = ruleResults.map(r => ({ id: r.id, trigger: r.trigger, verified: r.verified, note: r.note,
    verificationScope: r.verificationScope, applicability: r.applicability, compliance: r.compliance, clauses: r.clauses }));
  jsonResult.ruleVerification = summarizeRuleObservations(ruleResults);
  jsonResult.ruleVerification.notice = ruleObservationNotice(uiLang);
  log('\n## User Rule observations');
  log(ruleObservationNotice(uiLang));
  if (!ruleResults.length) log(t('- 활성 룰 없음', '- no active rules'));
  else {
    log('| ID | Trigger | Rule | Verified | Note |');
    log('|---|---|---|---|---|');
    const ic = { observed: 'observed (unverified)', pending: 'pending', manual: 'manual', baseline: 'baseline' };
    for (const r of ruleResults) log(`| ${r.id} | ${r.trigger} | ${r.rule.slice(0, 40)} | ${ic[r.verified] || '?'} | ${r.note} |`);
  }
  log('\n## Required final response sections');
  log(t('- 완료 작업\n- 진행 중 작업\n- 미완료/예정/대기/보류/차단/드랍 작업\n- 검증 결과\n- 추천 방향\n- 다음 정확한 작업\n- ⚡ 활성 룰별 검증 결과', '- Completed tasks\n- In-progress tasks\n- Incomplete/planned/waiting/on-hold/blocked/dropped tasks\n- Verification results\n- Recommended direction\n- Next exact step\n- ⚡ Per-rule verification results'));
  ok(`session-handoff.md and current-state.md updated`);
   
  _autoRoadmap(root, 'session-close');
   
   
   
  let _pa;
  try {
    if (typeof deps.previewApprovalState === 'function') _pa = deps.previewApprovalState(root);
    else if (typeof deps.pendingPreviews === 'function') {
      const legacyItems = deps.pendingPreviews(root);
      _pa = { known: true, count: legacyItems.length, code: null, items: legacyItems };
    } else _pa = require('./clarify').previewApprovalState(root);
  } catch (e) {
    _pa = { known: false, count: null, code: (e && e.code) || 'approval_state_unavailable', items: [] };
  }
  const _pend = Array.isArray(_pa.items) ? _pa.items : [];
  jsonResult.pendingPreviews = {
    known: _pa.known === true,
    count: _pa.known === true ? _pend.length : null,
    code: _pa.known === true ? null : (_pa.code || 'approval_state_unavailable'),
    items: _pend.slice(0, 10).map(p => ({ id: p.id, title: p.title, status: p.status })),
  };
  if (_pa.known !== true) {
    warn(t(`  ⚠ 미리보기 승인 상태를 확인할 수 없습니다 (${jsonResult.pendingPreviews.code}) — previews.json 복구 전 승인 완료로 간주하지 마세요.`, `  ⚠ Preview approval state is unknown (${jsonResult.pendingPreviews.code}) — do not treat it as approved until previews.json is repaired.`));
  } else if (_pend.length) {
    log(t(`  🎨 미승인 미리보기 ${_pend.length}건 — approve 전 해당 기능 코드 작성 금지`, `  🎨 ${_pend.length} preview(s) awaiting approval — no code before approve`));
    for (const p of _pend.slice(0, 5)) log(`    - ${p.id} ${p.title} [${p.status}]`);
    log(t('    → 승인: leerness preview approve <P-ID>  ·  수정요구: leerness preview revise <P-ID> --note "..."', '    → approve: leerness preview approve <P-ID>  ·  revise: leerness preview revise <P-ID> --note "..."'));
  }
   
   
  const suggestEnabled = (has('--suggest') || (!has('--no-suggest') && process.env.LEERNESS_NO_SUGGEST !== '1'));
  if (suggestEnabled) {
    const isTty = process.stdout && process.stdout.isTTY;
    const cy = s => isTty ? `\x1b[36m${s}\x1b[0m` : s;
    const dim = s => isTty ? `\x1b[2m${s}\x1b[0m` : s;
    log('');
    log(cy(t('## 💡 다음 라운드 추천 (1.9.57 --suggest)', '## 💡 Next-round suggestions (--suggest)')));
     
    try {
      const r = cp.spawnSync(process.execPath, [harnessPath, 'skill', 'suggest', '--path', root, '--min', '3', '--json'],
        { encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '1' } });
      const j = JSON.parse(r.stdout);
      if (j.candidates && j.candidates.length) {
        log(dim(t('  📌 신규 skill 후보 (Hermes-style 자동 학습):', '  📌 New skill candidates (Hermes-style auto-learning):')));
        for (const c of j.candidates.slice(0, 3)) log(t(`    • ${c.keyword} (${c.count}회 등장, 출처: ${c.source})`, `    • ${c.keyword} (seen ${c.count}x, source: ${c.source})`));
        jsonResult.skillCandidates = j.candidates.slice(0, 5);
      }
    } catch {}
     
    try {
      const r = cp.spawnSync(process.execPath, [harnessPath, 'drift', 'check', root, '--json'],
        { encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '0' } });
      const j = JSON.parse(r.stdout.trim());
      if (j.level) {
        log(dim(t(`  🩺 drift 상태: ${j.level} ${j.score}/200`, `  🩺 drift status: ${j.level} ${j.score}/200`)));
        if (j.fired && j.fired.length) log(dim(t(`    🔥 ${j.fired.length}건 임계 초과 — \`leerness drift check\` 상세`, `    🔥 ${j.fired.length} over threshold — \`leerness drift check\` for details`)));
        jsonResult.drift = { level: j.level, score: j.score, fired: (j.fired || []).map(f => ({ label: f.label, weight: f.weight })) };
      }
    } catch {}

     
    try {
      const stats = _readUsageStats(root);
      const entries = Object.entries(stats.commands || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (entries.length) {
        log(dim(t(`  📊 가장 많이 쓴 명령: ${entries.map(([c, n]) => `${c}(${n})`).join(', ')}`, `  📊 Most-used commands: ${entries.map(([c, n]) => `${c}(${n})`).join(', ')}`)));
        jsonResult.topCommands = entries.map(([command, count]) => ({ command, count }));
      }
       
      if (stats.mcp && stats.mcp.tools) {
        const mcpEntries = Object.entries(stats.mcp.tools).sort((a, b) => b[1] - a[1]);
        if (mcpEntries.length) {
          const mcpTotal = mcpEntries.reduce((s, [, n]) => s + n, 0);
          log(dim(t(`  🔌 MCP 호출 (1.9.74): 총 ${mcpTotal}회, top: ${mcpEntries.slice(0, 3).map(([tool, n]) => `${tool}(${n})`).join(', ')}`, `  🔌 MCP calls: ${mcpTotal} total, top: ${mcpEntries.slice(0, 3).map(([tool, n]) => `${tool}(${n})`).join(', ')}`)));
          const threshold = Math.max(1, Math.floor(mcpTotal * 0.05));
          const rare = mcpEntries.filter(([, n]) => n <= threshold).map(([tool]) => tool);
          if (rare.length && mcpTotal >= 5) log(dim(t(`    💡 드물게 호출된 MCP: ${rare.slice(0, 4).join(', ')}`, `    💡 Rarely-called MCP: ${rare.slice(0, 4).join(', ')}`)));
          jsonResult.mcpStats = { total: mcpTotal, top: mcpEntries.slice(0, 5).map(([tool, count]) => ({ tool, count })), rare: rare.slice(0, 10) };
        }
      }
    } catch {}
     
    try {
      const histPath = path.join(root, '.leerness', 'skill-suggestions.md');
      if (exists(histPath)) {
        const histTxt = read(histPath);
        const queries = [];
        for (const block of histTxt.split(/\n(?=## )/)) {
          const h = block.match(/^## ([\d-]+ [\d:]+) — query "([^"]+)"/);
          if (h) queries.push(h[2]);
        }
        if (queries.length) {
           
          const counts = {};
          for (const q of queries) counts[q] = (counts[q] || 0) + 1;
          const topQueries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
          log(dim(t(`  📒 skill match query 누적 (1.9.74): 총 ${queries.length}회 / 종류 ${Object.keys(counts).length}개`, `  📒 skill match queries: ${queries.length} total / ${Object.keys(counts).length} distinct`)));
          for (const [q, n] of topQueries) log(dim(`    • "${q.slice(0, 50)}"${n > 1 ? t(` (${n}회)`, ` (${n}x)`) : ''}`));
        }
      }
    } catch {}
    log('');
  }
   
  try {
    const sc = _lk(path.join(root, '.leerness', 'cache', 'session-counter.json'), () => diagnose(() => {
      const current = readSessionCounter(root);
      current.count = (current.count || 0) + 1;
      current.lastCloseAt = now();
      writeSessionCounter(root, current);
      return current;
    }));
    const agg = _retroAggregate(root);
    log(t(`\n## 📈 진행 요약 (session #${sc.count})`, `\n## 📈 Progress summary (session #${sc.count})`));
    log(`  ${_retroOneLine(agg, uiLang)}`);   
     
    try {
      const hdSC = path.join(root, '.leerness');
      const arc = { d: 0, l: 0, p: 0, total: 0 };
      for (const [k, f] of [['d', 'decisions.archive.md'], ['l', 'lessons.archive.md'], ['p', 'plan.archive.md']]) {
        const fp = path.join(hdSC, f);
        if (exists(fp)) {
          const entries = _parseArchiveBlocks(read(fp));
          arc[k] = entries.length;
          arc.total += entries.length;
        }
      }
      if (arc.total > 0) {
        log(t(`  🗑  archive 누적: D${arc.d}/L${arc.l}/P${arc.p} (${arc.total}건) — 복원 후보: leerness memory archive list`, `  🗑  archive total: D${arc.d}/L${arc.l}/P${arc.p} (${arc.total}) — restore via: leerness memory archive list`));
      }
    } catch {}
    if (sc.count % 5 === 0) {
      log(t(`\n## 🔄 ${sc.count}세션 마일스톤 — 자동 회고 (5세션마다)`, `\n## 🔄 ${sc.count}-session milestone — auto retro (every 5 sessions)`));
      retroCmd(root);
      sc.lastDeepRetroAt = now();
      writeSessionCounter(root, sc);
    } else {
      const left = 5 - (sc.count % 5);
      log(t(`  💡 ${left}세션 후 자동 깊은 회고 — \`leerness retro\`로 즉시 실행 가능`, `  💡 deep retro in ${left} session(s) — run \`leerness retro\` now to trigger immediately`));
    }
     
    try {
      const wsCands = [path.resolve(root, '_apps'), path.resolve(root, '..', '_apps')];
      let wsCount = 0;
      for (const base of wsCands) {
        if (!fs.existsSync(base)) continue;
        try { if (!fs.statSync(base).isDirectory()) continue; } catch { continue; }
        for (const e of diagnose(() => fs.readdirSync(base))) {
          try {
            const p = path.join(base, e);
            if (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, '.leerness')) && p !== root) wsCount++;
          } catch {}
        }
      }
      if (wsCount > 0) log(t(`  🌐 워크스페이스에 ${wsCount}개 다른 leerness 프로젝트 — \`leerness retro --all-apps\`로 통합 회고`, `  🌐 ${wsCount} other leerness project(s) in workspace — \`leerness retro --all-apps\` for combined retro`));
      jsonResult.workspacePeers = wsCount;
    } catch {}
  } catch (e) {
    warn(t('retro 요약 실패: ', 'retro summary failed: ') + (e && e.message ? e.message : e));
    jsonResult.retroSummaryError = e && e.message ? e.message : String(e);
  }
  } finally {
     
    if (jsonMode) process.stdout.write = _origWrite;
  }
   
   
   
   
  let encodingAutoFix = null;
  if (has('--auto-fix-encoding')) {
    encodingAutoFix = { requested: true, scanned: 0, atRisk: 0, added: 0, skipped: 0, failed: 0, scanErrors: [], results: [] };
    try {
      const encScan = _scanShellScriptsEncoding(root);
      encodingAutoFix.scanned = encScan.scanned || 0;
      encodingAutoFix.atRisk = Array.isArray(encScan.atRisk) ? encScan.atRisk.length : 0;
      encodingAutoFix.scanErrors = Array.isArray(encScan.scanErrors) ? encScan.scanErrors.slice() : [];
      for (const scanError of encodingAutoFix.scanErrors) {
        encodingAutoFix.failed++;
        encodingAutoFix.results.push({ file: scanError.file, action: 'failed-scan', code: scanError.code, error: scanError.error, operation: scanError.operation });
      }
      for (const r of (encScan.atRisk || [])) {
        try {
          const applied = applyShellScriptUtf8Bom(path.join(root, r.file), r.file);
          encodingAutoFix.results.push(applied);
          if (applied.action === 'utf8-bom-added') encodingAutoFix.added++;
          else if (applied.action.startsWith('skipped-')) encodingAutoFix.skipped++;
        } catch (e) {
          encodingAutoFix.failed++;
          encodingAutoFix.results.push({ file: r.file, action: 'failed', code: e.code || 'error', error: e.message, ...(e.backupFile ? { backupFile: e.backupFile } : {}), ...(e.recoveryArtifacts ? { recoveryArtifacts: e.recoveryArtifacts } : {}) });
          console.error(t(`⚠ 인코딩 자동 수정 거부: ${r.file} — ${e.message}`, `⚠ encoding auto-fix refused: ${r.file} — ${e.message}`));
        }
      }
    } catch (e) {
      encodingAutoFix.failed++;
      encodingAutoFix.results.push({ file: null, action: 'failed', code: e.code || 'error', error: e.message, ...(e.backupFile ? { backupFile: e.backupFile } : {}), ...(e.recoveryArtifacts ? { recoveryArtifacts: e.recoveryArtifacts } : {}) });
      console.error(t(`⚠ 인코딩 자동 수정 오류: ${e.message}`, `⚠ encoding auto-fix error: ${e.message}`));
    }
    if (encodingAutoFix.failed > 0) process.exitCode = 1;
    jsonResult.encodingAutoFix = encodingAutoFix;
  }
   
  if (jsonMode) {
    try {
      const sc = readSessionCounter(root);
      jsonResult.sessionNumber = sc.count;
    } catch {}
     
    try {
      const rows0 = closeRows;
      const tasksByStatus0 = {};
      for (const s of STATUSES) tasksByStatus0[s] = 0;
      for (const r of rows0) tasksByStatus0[r.status] = (tasksByStatus0[r.status] || 0) + 1;
      const tasksInProgress0 = tasksByStatus0['in-progress'] || 0;
      const decisionsCount0 = _loadDecisions(root).length;   
      const rules0 = readRules(root);
      const rulesActive0 = rules0.filter(r => r.status === 'active').length;
      const planText0 = closePlan;
      const milestones0 = (planText0.match(/^### M-\d{4,}\./gm) || []).length;
      const lessonsCount0 = _loadLessons(root).length;
       
      const archiveCountsS = { decisions: 0, lessons: 0, plan: 0, total: 0 };
      try {
        const hdS = path.join(root, '.leerness');
        for (const [key, file] of [['decisions', 'decisions.archive.md'], ['lessons', 'lessons.archive.md'], ['plan', 'plan.archive.md']]) {
          const fpS = path.join(hdS, file);
          if (exists(fpS)) {
            const entries = _parseArchiveBlocks(read(fpS));
            archiveCountsS[key] = entries.length;
            archiveCountsS.total += entries.length;
          }
        }
      } catch {}
      jsonResult.memorySurface = {
        tasks: { inProgress: tasksInProgress0, total: rows0.length, byStatus: tasksByStatus0 },
        decisions: { count: decisionsCount0 },
        rules: { active: rulesActive0, total: rules0.length },
        plan: { milestones: milestones0 },
        lessons: { count: lessonsCount0 },
        archive: archiveCountsS,   
        summary: `T${tasksInProgress0}/D${decisionsCount0}/R${rulesActive0}/P${milestones0}/L${lessonsCount0}`,
      };
       
      try {
        const { nodes: fNodesC } = _readFeatureGraph(root);
        const edgeCount = fNodesC.reduce((s, n) => s + (n.dependsOn?.length || 0) + (n.affects?.length || 0) + (n.coChangesWith?.length || 0), 0);
        const linkedIds = new Set();
        for (const n of fNodesC) {
          for (const x of [...(n.dependsOn||[]), ...(n.affects||[]), ...(n.coChangesWith||[])]) { linkedIds.add(n.id); linkedIds.add(x); }
        }
        const isolated = fNodesC.length ? (fNodesC.length - linkedIds.size) : 0;
        jsonResult.featureGraph = {
          total: fNodesC.length,
          edges: edgeCount,
          isolated: Math.max(0, isolated),
          summary: `F${fNodesC.length}/E${edgeCount}${isolated > 0 ? `/iso${isolated}` : ''}`
        };
      } catch {}
    } catch {}

     
     
    try {
       
      const reqAudit = _auditUserRequests(root);
      jsonResult.userRequestsAudit = {
        total: reqAudit.total,
        open: reqAudit.open,
        missing: reqAudit.missing ? reqAudit.missing.length : 0,
        tracked: reqAudit.tracked ? reqAudit.tracked.length : 0,
        stale: reqAudit.stale ? reqAudit.stale.length : 0
      };
       
      try {
        const delivered = _detectDeliveredRequests(root);
        jsonResult.deliveredRequests = {
          candidates: delivered.candidates.length,
          currentVersion: delivered.currentVersion,
          autoCompleteAvailable: delivered.candidates.length > 0
        };
      } catch {}
       
      try {
        const rh = _computeRoundHistory(root, { allowWorkspaceError: true });
        jsonResult.roundHistory = {
          roundCount: rh.roundCount,
          baselineVersion: rh.baselineVersion,
          nextMilestone: rh.nextMilestone,
          roundsToNextMilestone: rh.roundsToNextMilestone,
          daysActive: rh.daysActive,
          avgRoundsPerDay: rh.avgRoundsPerDay,
          gitHistoryState: rh.gitHistoryState,
          gitHistoryError: rh.gitHistoryError,
          workspaceError: rh.workspaceError || null
        };
      } catch {}
       
      try {
        const ms = _computeMilestones(root);
        jsonResult.milestones = _milestoneSurface(ms);
      } catch (err) {
        jsonResult.milestones = _milestoneSurface({ gitHistoryState: 'unavailable', gitHistoryError: { code: 'git_history_unavailable', reason: 'aggregate_exception', error: String(err && err.message || err) } });
      }
       
      try {
        Object.assign(jsonResult, _recentChangesAggregate(_computeRecentChanges(root, 5)));
      } catch (err) {
        Object.assign(jsonResult, _recentChangesAggregate({ state: 'unavailable', error: { code: 'git_history_unavailable', reason: 'aggregate_exception', error: String(err && err.message || err) } }));
      }
       
      try {
        const pyFiles = _collectPyFiles(root, 200);
        const analyses = pyFiles.slice(0, 200).map(f => _analyzePyFile(f)).filter(Boolean);
        jsonResult.pyFiles = {
          total: pyFiles.length,
          analyzed: analyses.length,
          totalLOC: analyses.reduce((s, a) => s + a.loc, 0),
          totalImports: analyses.reduce((s, a) => s + a.imports, 0),
          totalFuncs: analyses.reduce((s, a) => s + a.funcs, 0),
          totalClasses: analyses.reduce((s, a) => s + a.classes, 0)
        };
      } catch {}
       
      try {
        const runtimeEnv = _collectRuntimeEnv();
        const encScan = _scanShellScriptsEncoding(root);
        jsonResult.envInfo = {
          os: runtimeEnv.os.platform,
          isKoreanWindows: runtimeEnv.locale.isKoreanWindows || false,
          codepage: runtimeEnv.locale.codepage || null,
          nodeVersion: runtimeEnv.node.version,
          shellScriptsScanned: encScan.scanned,
          encodingRiskCount: encScan.atRisk.length,
          encodingRiskFiles: encScan.atRisk.slice(0, 5).map(r => r.file),
          encodingScanErrorCount: (encScan.scanErrors || []).length,
          encodingScanErrors: (encScan.scanErrors || []).slice(0, 5),
           
          terminalEncodingOk: runtimeEnv.locale.codepage === 65001 || !runtimeEnv.locale.isKoreanWindows,
          autoChcpApplied: process.env._LEERNESS_AUTOCHCP_APPLIED || null,
           
          posixEncodingOk: runtimeEnv.locale.posixEncodingOk,
          isWSL: runtimeEnv.locale.isWSL || false
        };
      } catch {}
       
      try {
        const allSkills = _listAPISkills(root);
        let currentTaskText = '';
        try {
          const rows = closeRows;
          const ip = rows.find(r => r.status === 'in-progress');
          currentTaskText = _taskMatchText(ip);
        } catch {}
        const matched = currentTaskText ? _matchAPISkills(root, currentTaskText) : [];
        jsonResult.apiSkills = {
          total: allSkills.length,
          matched: matched.length,
          matchedIds: matched.slice(0, 5).map(s => s.id),
          ids: allSkills.slice(0, 10).map(s => s.id)
        };
      } catch {}
       
      try {
        const sf = _loadShellFailures(root);
        const drift = _shellEnvDrift(root);
        jsonResult.shellGuard = {
          failureCount: sf.failures.length,
          recent: sf.failures.slice(-3).map(f => ({ cmd: (f.cmd || '').slice(0, 50), exitCode: f.exitCode, shell: f.shell, rules: f.issues || [] })),
          envDriftChanges: drift && drift.changes ? drift.changes.length : 0,
          envDrift: drift ? drift.changes : null
        };
      } catch {}
    } catch {}
    try {
       
      if (!opts.noPreWake && !has('--no-pre-wake')) {
        const audit = _runPreWakeAudit(root);
        _saveAndAppendPreWakeReport(root, audit);
        jsonResult.preWakeAudit = {
          auditedAt: audit.auditedAt,
          critical: audit.summary.criticalCount,
          warning: audit.summary.warningCount,
          info: audit.summary.infoCount,
          needsAttention: audit.summary.needsAttention
        };
      }
    } catch {}
    try {
       
      const idemp = _runIdempotencyAudit(root);
      jsonResult.idempotencyAudit = {
        violations: idemp.summary.totalViolations,
        high: idemp.summary.highSeverity,
        medium: idemp.summary.mediumSeverity,
        low: idemp.summary.lowSeverity,
        verified: idemp.summary.verifiedAreas,
        overall: idemp.summary.overall
      };
    } catch {}
    try {
       
      const ad = _detectAbnormalShutdown(root);
      jsonResult.abnormalShutdown = {
        detected: ad.abnormalShutdown,
        severity: ad.severity,
        signalCount: ad.signals.length,
        signals: ad.signals.map(s => ({ kind: s.kind, severity: s.severity, detail: s.detail })),
        resumeGuide: ad.resumeGuide
      };
    } catch {}

    assertDiagnosticReads();
    process.stdout.write(JSON.stringify(jsonResult, null, 2) + '\n');
  } else {
     
    try {
      const isTty = process.stdout.isTTY;
      const grn = s => isTty ? `\x1b[32m${s}\x1b[0m` : s;
      const yel = s => isTty ? `\x1b[33m${s}\x1b[0m` : s;
      const red = s => isTty ? `\x1b[31m${s}\x1b[0m` : s;
      const dim = s => isTty ? `\x1b[2m${s}\x1b[0m` : s;

      log('');
      log(t(`## 🔚 session close 자동 통합 보고 (1.9.217)`, `## 🔚 session close integrated report`));
       
      try {
        const reqAudit = _auditUserRequests(root);
        const missCnt = reqAudit.missing ? reqAudit.missing.length : 0;
        let delivered = { candidates: [] };
        try { delivered = _detectDeliveredRequests(root); } catch {}
        if (delivered.candidates && delivered.candidates.length > 0) {
          if (has('--auto-apply-delivered')) {
             
            let ok = 0;
            for (const c of delivered.candidates) {
              const u = _updateUserRequest(root, c.id, { status: 'completed', autoCompletedAt: new Date().toISOString(), autoCompleteReason: 'session-close-auto-apply-1.9.224' });
              if (u) ok++;
            }
            log(grn(t(`  ✓ delivered 패턴 ${ok}건 자동 완료 (--auto-apply-delivered 1.9.224)`, `  ✓ ${ok} delivered pattern(s) auto-completed (--auto-apply-delivered)`)));
          } else {
            log(yel(t(`  📥 delivered 패턴 ${delivered.candidates.length}건 (1.9.223) — 자동 완료 가능`, `  📥 ${delivered.candidates.length} delivered pattern(s) — auto-completable`)));
            log(dim(t(`     → leerness requests auto-complete --apply (수동) 또는 session close --auto-apply-delivered (1.9.224)`, `     → leerness requests auto-complete --apply (manual) or session close --auto-apply-delivered`)));
          }
        } else if (missCnt > 0) {
          log(red(t(`  ⚠ 미답 사용자 요청 ${missCnt}건 (task-log/plan/decisions 매칭 안 됨)`, `  ⚠ ${missCnt} unanswered user request(s) (no task-log/plan/decisions match)`)));
        } else if (reqAudit.open > 0) {
          log(grn(t(`  ✓ 사용자 요청 ${reqAudit.open}건 모두 tracked`, `  ✓ all ${reqAudit.open} user request(s) tracked`)));
        } else {
          log(dim(t(`  ℹ 사용자 요청 없음 (UR 백로그 비어있음)`, `  ℹ no user requests (UR backlog empty)`)));
        }
      } catch {}
       
      try {
        if (!opts.noPreWake && !has('--no-pre-wake')) {
          const audit = _runPreWakeAudit(root);
          _saveAndAppendPreWakeReport(root, audit);
          const sum = audit.summary;
          if (sum.criticalCount > 0) {
            log(red(t(`  🚨 pre-wake-audit: critical ${sum.criticalCount} (다음 깨어남 시 점검 필요)`, `  🚨 pre-wake-audit: critical ${sum.criticalCount} (check before next wake)`)));
          } else if (sum.warningCount > 0) {
            log(yel(`  ⚠ pre-wake-audit: warning ${sum.warningCount}`));
          } else {
            log(grn(t(`  ✓ pre-wake-audit: clean (sleep 안전)`, `  ✓ pre-wake-audit: clean (safe to sleep)`)));
          }
        }
      } catch {}
       
      try {
        const idemp = _runIdempotencyAudit(root);
        const v = idemp.summary.totalViolations;
        if (v > 0) {
          log(red(t(`  ⚠ 멱등성 위반 ${v}건 (high: ${idemp.summary.highSeverity})`, `  ⚠ ${v} idempotency violation(s) (high: ${idemp.summary.highSeverity})`)));
          log(dim(t(`     → leerness idempotency audit 으로 상세 확인`, `     → see details with leerness idempotency audit`)));
        } else {
          log(grn(t(`  ✓ 멱등성 검사 통과 — verified ${idemp.summary.verifiedAreas} 영역`, `  ✓ idempotency check passed — ${idemp.summary.verifiedAreas} area(s) verified`)));
        }
      } catch {}
       
      try {
        const sf = _loadShellFailures(root);
        const drift = _shellEnvDrift(root);
        const driftN = drift && drift.changes ? drift.changes.length : 0;
        if (sf.failures.length > 0 || driftN > 0) {
          if (driftN > 0) log(yel(t(`  ⚠ 환경 버전 변동 ${driftN}건 — 다음 세션 셸 실패 기록 재검토 권장`, `  ⚠ ${driftN} environment version change(s) — review shell-failure log next session`)));
          if (sf.failures.length > 0) {
            log(yel(t(`  🐚 셸 실패 누적 ${sf.failures.length}건 — 다음 handoff 가 자동 노출`, `  🐚 ${sf.failures.length} accumulated shell failure(s) — surfaced by next handoff`)));
            log(dim(t(`     → 명령 실행 전 점검: leerness shell-guard "<command>"`, `     → check before running: leerness shell-guard "<command>"`)));
          }
        } else {
          log(grn(t(`  ✓ 셸 실패 기록 없음 (터미널 호환성 양호)`, `  ✓ no shell-failure records (terminal compatibility OK)`)));
        }
      } catch {}
       
       
       
      try {
        const branchR = _gitSpawn(['branch', '--merged', 'main', '--list', 'release/*'], { cwd: root, encoding: 'utf8' });
        if (branchR.status === 0) {
          const merged = (branchR.stdout || '').split('\n')
            .map(l => l.replace(/^\*?\s+/, '').trim())
            .filter(l => l && /^release\/\d+\.\d+\.\d+$/.test(l));
          if (merged.length > 50) {
            if (has('--auto-cleanup-branches')) {
              merged.sort((a, b) => {
                const va = a.replace('release/', '').split('.').map(n => parseInt(n, 10) || 0);
                const vb = b.replace('release/', '').split('.').map(n => parseInt(n, 10) || 0);
                for (let i = 0; i < 3; i++) if (va[i] !== vb[i]) return vb[i] - va[i];
                return 0;
              });
              const curR = _gitSpawn(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' });
              const cur = (curR.stdout || '').trim();
              const toDelete = merged.slice(10).filter(b => b !== cur);
              let okCnt = 0;
              for (const b of toDelete) {
                const r = _gitSpawn(['branch', '-d', b], { cwd: root, encoding: 'utf8' });
                if (r.status === 0) okCnt++;
              }
              log(grn(t(`  ✓ release 정리 ${okCnt}/${toDelete.length}건 (--auto-cleanup-branches 1.9.237, keep 10)`, `  ✓ release cleanup ${okCnt}/${toDelete.length} (--auto-cleanup-branches, keep 10)`)));
            } else {
              log(yel(t(`  🗑 release/* merged ${merged.length}개 (50+) — cleanup 가능 (1.9.235)`, `  🗑 ${merged.length} merged release/* branches (50+) — cleanup available`)));
              log(dim(t(`     → leerness release cleanup --apply --keep 10 (수동)`, `     → leerness release cleanup --apply --keep 10 (manual)`)));
              log(dim(t(`     → 또는 session close --auto-cleanup-branches (1.9.237 자동)`, `     → or session close --auto-cleanup-branches (auto)`)));
            }
          }
        }
      } catch {}
       
       
       
      try {
        if (encodingAutoFix) {
          const a = encodingAutoFix;
          if (a.atRisk > 0) log(grn(t(`  ✓ 인코딩 위험 ${a.added}/${a.atRisk}건 UTF-8 BOM 자동 추가${a.skipped > 0 ? ` · 안전상 건너뜀 ${a.skipped}건` : ''}${a.failed > 0 ? ` · 실패 ${a.failed}건` : ''} (--auto-fix-encoding 1.9.243)`, `  ✓ ${a.added}/${a.atRisk} encoding risk(s) auto-fixed${a.skipped > 0 ? ` · safely skipped ${a.skipped}` : ''}${a.failed > 0 ? ` · ${a.failed} failed` : ''} (--auto-fix-encoding)`)));
          for (const r of a.results.filter(r => r.backupFile)) log(yel(t(`     ↳ 원본/동시 편집 복구본 보존: ${r.backupFile}`, `     ↳ retained original/concurrent recovery copy: ${r.backupFile}`)));
        } else {
          const encScan = _scanShellScriptsEncoding(root);
          if (encScan.scanErrors && encScan.scanErrors.length > 0) log(yel(t(`  ⚠ 인코딩 스캔 읽기 실패 ${encScan.scanErrors.length}건 — 결과 불완전`, `  ⚠ ${encScan.scanErrors.length} encoding scan read error(s) — result incomplete`)));
          if (encScan.atRisk && encScan.atRisk.length > 0) {
            log(yel(t(`  ⚠ 셸 스크립트 인코딩 위험 ${encScan.atRisk.length}건 (1.9.241) — 자동 회복 가능`, `  ⚠ ${encScan.atRisk.length} shell-script encoding risk(s) — auto-fixable`)));
            log(dim(t(`     → leerness env encoding --apply (수동) 또는 session close --auto-fix-encoding (1.9.243 자동)`, `     → leerness env encoding --apply (manual) or session close --auto-fix-encoding (auto)`)));
          }
        }
      } catch {}
       
      try {
        const rh = _computeRoundHistory(root, { allowWorkspaceError: true });
        const ms = _computeMilestones(root);
        const rows = closeRows;
        const tIn = rows.filter(r => r.status === 'in-progress').length;
        const dCnt = _loadDecisions(root).length;   
        const rActive = readRules(root).filter(r => r.status === 'active').length;
        const planText = closePlan;
        const pCnt = (planText.match(/^### M-\d{4,}\./gm) || []).length;
        const lCnt = _loadLessons(root).length;
        const mem = `T${tIn}/D${dCnt}/R${rActive}/P${pCnt}/L${lCnt}`;
        const roundLabel = rh.roundCount == null ? 'unavailable' : `R${rh.roundCount}`;
        let pulseLine = `📍 v${VERSION} · 🔄 ${roundLabel} · 🧠 ${mem}`;
        if (ms.next) {
          const eta = ms.next.etaDays != null ? ` (${ms.next.etaDays}d)` : '';
          pulseLine += ` · 🎯 R${ms.next.milestone}${eta}`;
        }
        log('');
        log(`  ${pulseLine}  ${dim('— leerness pulse (1.9.232)')}`);
        if (rh.gitHistoryError) log(yel(t(`  ⚠ Git 이력 측정 불가: ${rh.gitHistoryError.reason}`, `  ⚠ Git history unavailable: ${rh.gitHistoryError.reason}`)));
        if (rh.workspaceError) log(yel(t(`  ⚠ 워크스페이스 출처 판독 불가: ${rh.workspaceError.code}`, `  ⚠ workspace provenance unavailable: ${rh.workspaceError.code}`)));
      } catch {}
    } catch {}
  }
  assertDiagnosticReads();
}

module.exports = { sessionClose: require('./runtime-writes').projectWriter(sessionClose), _upsertAutoLines, _executionProvenanceSummary };    
