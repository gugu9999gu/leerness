// lib/session-close.js — session close 핸들러 (UR-0025/UR-0125 큰 핸들러 모듈화 10번째, 1.9.425)
//   bin/leerness.js 에서 sessionClose(599줄) 분리. DI: harness 고유 의존 다수 주입.
//   io 프리미티브는 ./io, _sanitizeFences/_parseArchiveBlocks 는 ./pure-utils, cp/os/path/fs 빌트인.
//   __filename→harnessPath(self-spawn). 동작/출력 무변경(9 카테고리 + 활성 룰 검증 + retro 등).
'use strict';
const cp = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { applyShellScriptUtf8Bom } = require('./shell-encoding');
const { log, ok, warn, fail, failJson, today, now, absRoot, exists, read, readBuf, mkdirp, writeUtf8, append, rel } = require('./io');
const { _sanitizeFences, _parseArchiveBlocks, _milestoneSurface, _recentChangesAggregate } = require('./pure-utils');
const { readExecutionEvents } = require('./role-fallback');

// 1.36.98 (사용자 보고, hive-analytics): session close 가 current-state.md 를 통째로 갈아치웠다.
//   종전 구현은 세 개의 정규식으로 섹션 본문을 '한 줄' 로 교체했고, 마지막 하나는 `/## Blockers\n[\s\S]*$/` 라
//   **Blockers 부터 파일 끝까지** 를 지웠다 — 그 아래에 사람이 적어 둔 섹션이 통째로 사라졌다.
//   실측(재현): 440자 → 88자, 사용자 작성 섹션 2개(결정 로그·인수인계 메모) 전부 소실.
//   session close 는 제품이 "매 세션 끝에 반드시 실행" 하라고 지시하는 명령이라 손실이 매번 일어났다.
//
//   고친 방식: 도구가 쓴 줄에 표지를 달고, **표지 있는 줄만** 교체한다. 표지 없는 줄은 절대 지우지 않는다.
//   섹션 범위도 EOF 가 아니라 '다음 ## 제목' 까지로 닫는다. 표지가 없던 구버전 파일의 마지막 생성 줄 하나는
//   한 번 남지만(누적되지 않는다), 사용자 문서를 지우는 것보다 그 편이 낫다 — 안전한 쪽으로 실패한다.
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
  if (!m) return md;                                    // 섹션이 없으면 만들지 않는다(문서 구조를 마음대로 바꾸지 않는다)
  const bodyStart = m.index + m[0].length;
  const nextIdx = md.indexOf('\n## ', bodyStart);
  const bodyEnd = nextIdx < 0 ? md.length : nextIdx + 1;
  const body = md.slice(bodyStart, bodyEnd);
  const kept = body.split('\n').filter(l => !l.includes(AUTO_MARK));
  while (kept.length && !kept[0].trim()) kept.shift();   // 섹션 머리의 빈 줄만 정리
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  const merged = autoLines.map(l => `${l} ${AUTO_MARK}`).concat(kept).join('\n');
  // 다음 제목 앞의 빈 줄은 되돌려 준다(가독성). 매 실행마다 꼬리 빈 줄을 걷어내므로 반복 실행해도 늘지 않는다.
  return md.slice(0, bodyStart) + merged + '\n' + (nextIdx < 0 ? '' : '\n' + md.slice(bodyEnd));
}

// 1.36.133: git 호출 초크포인트 — `--no-optional-locks` 로 사용자 저장소의 `.git/index` 재기록을 막는다(실측).
// 1.36.140: git 실행은 `lib/git.js` **단일** 초크포인트를 쓴다(복제본은 환경 세척이 없어
//   상속된 `GIT_DIR` 아래에서 `branch -d` 가 남의 저장소를 지웠다 — 실측).
const _gitSpawn = require('./git').gitSpawn;
function sessionClose(root, opts = {}, deps = {}) {
  const { VERSION, STATUSES, MARK, has, arg, uiLang, harnessPath, readProgressRows, evidencePath, handoffPath, currentStatePath, taskLogPath, verifyRules, _autoRoadmap, _readUsageStats, readSessionCounter, writeSessionCounter, _retroAggregate, _retroOneLine, retroCmd, _loadDecisions, readRules, planPath, _loadLessons, _readFeatureGraph, _auditUserRequests, _detectDeliveredRequests, _computeRoundHistory, _computeMilestones, _computeRecentChanges, _collectPyFiles, _analyzePyFile, _collectRuntimeEnv, _scanShellScriptsEncoding, _listAPISkills, _matchAPISkills, _loadShellFailures, _shellEnvDrift, _runPreWakeAudit, _saveAndAppendPreWakeReport, _runIdempotencyAudit, _detectAbnormalShutdown, _updateUserRequest, _detectOptimism, _scanCodeForPatterns, _collectSecretFindings } = deps;
  // 1.22.1 (UR-0010 Phase 4): 마감 보고 UI 언어 — 영어 opt-in, 한국어 기본(uiLang 미주입 시 ko).
  const t = (ko, en) => (uiLang === 'en' ? en : ko);
  root = absRoot(root);
  // 1.10.4 (13th 버그헌트 P2, UR-0167): 경로 없음/디렉토리 아님 → 구조화 에러 + exit 1. mkdir <path>/.leerness ENOTDIR 크래시 & 실패를 성공(exit 0)으로 오판하던 문제 차단.
  if (!exists(root) || !fs.statSync(root).isDirectory()) { failJson(!!opts.json || has('--json'), 'path_not_found', `경로 없음 또는 디렉토리 아님: ${root}`); return; }
  // 1.9.103: --json 모드 — stdout 억제 후 구조화 출력
  const jsonMode = !!opts.json || has('--json');
  const _origWrite = process.stdout.write.bind(process.stdout);
  if (jsonMode) process.stdout.write = () => true;
  const jsonResult = { version: VERSION, root, closedAt: now() };
  try {
  const rows = readProgressRows(root);
  const buckets = {};
  for (const s of STATUSES) buckets[s] = [];
  // 1.36.34 (codex 3차 #10): 별칭/미지 상태가 어느 카테고리에도 안 담겨 마감 보고에서 조용히 사라짐
  //   (completed/cancelled 3건 중 1건만 집계 실측). 별칭은 정규화, 미지는 'other' 버킷으로 — 소실 0.
  const _STATUS_ALIAS = { completed: 'done', complete: 'done', finished: 'done', verified: 'done', cancelled: 'dropped', canceled: 'dropped', cancel: 'dropped', in_progress: 'in-progress', wip: 'in-progress', on_hold: 'on-hold', hold: 'on-hold' };
  buckets.other = [];
  for (const r of rows) {
    const s0 = String(r.status || '').toLowerCase().trim();
    const s = buckets[s0] ? s0 : (_STATUS_ALIAS[s0] && buckets[_STATUS_ALIAS[s0]] ? _STATUS_ALIAS[s0] : 'other');
    buckets[s].push(r);
  }
  // 1.9.103: JSON 결과 누적
  jsonResult.taskCounts = {};
  for (const s of STATUSES) jsonResult.taskCounts[s] = (buckets[s] || []).length;
  if (buckets.other.length) jsonResult.taskCounts.other = buckets.other.length;
  jsonResult.recommendedDirection = (buckets['in-progress'][0]?.request) || (buckets['planned'][0]?.request) || (buckets['requested'][0]?.request) || null;
  jsonResult.nextExactStep = (buckets['in-progress'][0]?.nextAction) || (buckets['planned'][0]?.nextAction) || (buckets['requested'][0]?.nextAction) || null;
  // 1.12.3 (14th 버그헌트 P3, UR-0183): 마감 시 완료 정직성 advisory — done 인데 evidence 가 비었거나 placeholder 인 task 노출(차단 X, 정직성 환기). lazy detect 의 done_no_evidence 휴리스틱과 동일.
  const _doneNoEvidence = (buckets['done'] || []).filter(r => !r.evidence || /^(\s*|user-request|-)$/.test(r.evidence) || /^plan:M-\d{4,}\s*$/.test(r.evidence));
  jsonResult.completionHonesty = { doneTotal: (buckets['done'] || []).length, doneWithoutEvidence: _doneNoEvidence.length, ids: _doneNoEvidence.slice(0, 5).map(r => r.id) };
  if (_doneNoEvidence.length) log(t(`  ⚠ 완료 정직성: done ${_doneNoEvidence.length}건 evidence 없음/placeholder (${_doneNoEvidence.slice(0, 3).map(r => r.id).join(', ')}) — verify-claim 권장 (advisory)`, `  ⚠ completion honesty: ${_doneNoEvidence.length} done with no/placeholder evidence (${_doneNoEvidence.slice(0, 3).map(r => r.id).join(', ')}) — verify-claim recommended (advisory)`));
  // 1.17.6 (UR-0049 마감 정합): done 의 미해소 낙관 의심 재확인 — verify-claim 을 건너뛴 거짓 주장(evidence 에 API/DB 주장 있는데 코드 흔적 없음)이
  //   평범한 'done' 으로 마감을 무사 통과하던 것(5축 실증 P2: 거짓 DB 주장이 done 으로 마감, gate 실패 중 'clean' 선언) — 마감이 마지막 관문 역할을 하도록 재확인. advisory.
  let _doneOptimism = [];
  try {
    if (_detectOptimism && _scanCodeForPatterns && (buckets['done'] || []).length) {
      const _codeText = _scanCodeForPatterns(root);
      _doneOptimism = (buckets['done'] || []).map(r => ({ id: r.id, suspects: _detectOptimism(r.evidence || '', _codeText) || [] })).filter(x => x.suspects.length);
    }
  } catch {}
  jsonResult.completionHonesty.optimismUnresolved = _doneOptimism.map(x => ({ id: x.id, kinds: x.suspects.map(s => s.kind) }));
  if (_doneOptimism.length) log(t(`  ⚠ 완료 정직성: done ${_doneOptimism.length}건 낙관 의심 미해소 (${_doneOptimism.slice(0, 3).map(x => x.id).join(', ')}) — evidence 주장 vs 코드 흔적 불일치, 마감 전 verify-claim 재확인 권장 (advisory)`, `  ⚠ completion honesty: ${_doneOptimism.length} done with unresolved optimism (${_doneOptimism.slice(0, 3).map(x => x.id).join(', ')}) — evidence claim vs code trace mismatch, re-check with verify-claim before closing (advisory)`));
  // 1.17.6 (UR-0049): 마감 보안 재확인 — 커밋 대상 시크릿이 살아있으면 'clean' 으로 마감하지 않도록 표면화. advisory(차단 X).
  let _closeSecrets = 0;
  // 1.36.104 (P-0014): 인정된 픽스처 제외 — 다른 표면과 같은 술어(미인정만 '미해소').
  try { if (_collectSecretFindings) { const _s = _collectSecretFindings(root) || {}; _closeSecrets = (_s.unacknowledged || _s.committed || []).length; } } catch {}
  jsonResult.closeSecurity = { committedSecrets: _closeSecrets };
  if (_closeSecrets) log(t(`  🚨 마감 보안: 커밋 대상 시크릿 ${_closeSecrets}건 미해소 — clean 아님, leerness scan secrets 확인 후 마감 권장`, `  🚨 close security: ${_closeSecrets} committed secret(s) unresolved — not clean, run leerness scan secrets before closing`));

  function rowsToList(arr) {
    if (!arr || !arr.length) return t('- 없음', '- none');  // 1.24.1 (UR-0010): en 보고 본문 정합(헤더는 이미 영어)
    return arr.map(r => `- ${r.id} ${r.request} → next: ${r.nextAction}`).join('\n');
  }

  // 1.9.287 (Codex 리뷰 수렴): evidence 임베딩 시 코드펜스(```) 가 session-handoff.md 마크다운을 깨뜨리는 품질 버그 수정.
  const evidenceSummary = _sanitizeFences(exists(evidencePath(root)) ? (read(evidencePath(root)).split('\n').slice(-30).join('\n')) : '(no review-evidence.md)');
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
    rowsToList(buckets['done']),
    ``,
    `## In Progress`,
    rowsToList(buckets['in-progress']),
    ``,
    `## Incomplete / Waiting / On Hold / Blocked`,
    rowsToList([...(buckets['incomplete']||[]), ...(buckets['waiting']||[]), ...(buckets['on-hold']||[]), ...(buckets['blocked']||[]), ...(buckets.other||[])]),   // 1.36.34 (#10): 미지 상태도 소실 없이 표기
    ``,
    `## Dropped`,
    rowsToList(buckets['dropped']),
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
    `- ${(buckets['in-progress'][0]?.request) || (buckets['planned'][0]?.request) || (buckets['requested'][0]?.request) || '다음 우선순위를 사용자와 정합니다.'}`,
    ``,
    `## Next Exact Step`,
    `- ${(buckets['in-progress'][0]?.nextAction) || (buckets['planned'][0]?.nextAction) || (buckets['requested'][0]?.nextAction) || '없음'}`,
    ``
  ].join('\n');
  // 1.36.108 (T-0097): 두 문서 모두 **읽어서 사용자 내용을 보존한 뒤 다시 쓰는** read-modify-write 다
  //   (handoff 는 프론트매터를, current-state 는 사용자가 쓴 본문을 지킨다). 락 밖이면 그 보존이
  //   낡은 스냅샷 기준이라 옆 프로세스(audit --fix / handoff)의 갱신을 덮는다.
  //   **쓰기 구간만** 감싼다 — 명령 전체를 감싸면 session close 의 하위 감사가 길어져 stale(30s) 에 락을 뺏긴다
  //   (lib/referee.js 가 같은 이유로 verify 를 락 밖에 둔다).
  //   1.36.108 (codex 검수 P2, 재현됨): 처음엔 두 파일을 **하나의 락(session-handoff.md.lock)** 으로 감쌌다.
  //   그건 보호가 아니다 — `audit --fix` 는 current-state.md 의 락을 잡으므로 둘이 서로를 배제하지 못하고,
  //   검수가 audit 의 갱신이 session close 의 낡은 스냅샷에 덮이는 것을 재현했다(양쪽 다 '락 보유' 로 보인 채로).
  //   락은 **지키는 파일의 이름으로** 잡아야 한다. 파일마다 따로, 중첩 없이(중첩이 없으니 교착도 없다).
  const _lk = (typeof deps._withLock === 'function') ? deps._withLock : ((f, fn) => fn());
  _lk(handoffPath(root), () => {
    const cur = exists(handoffPath(root)) ? read(handoffPath(root)) : '';
    // 1.9.316 (drift 마커 버그): 프론트매터는 파일이 '---' 로 시작할 때만 추출.
    //   이전: 본문의 '---'(수평선/구분자)을 프론트매터 종료로 오인 → 구 블록(구 'Last generated')을 보존 →
    //   session-handoff.md 에 'Last generated' 중복 누적 → drift 가 첫(=구) 매치를 읽어 'session close 누락' 영구 오발화.
    let frontmatter = '';
    if (/^---\r?\n/.test(cur)) {
      const fmEnd = cur.indexOf('\n---\n', 4);
      if (fmEnd > 0) frontmatter = cur.slice(0, fmEnd + 5) + MARK + '\n';
    }
    writeUtf8(handoffPath(root), frontmatter + block);
  });
  _lk(currentStatePath(root), () => {
    if (!exists(currentStatePath(root))) return;
    let cs = read(currentStatePath(root));   // 락 안에서 읽는다 — 밖에서 읽은 사본으로 쓰면 그 사이 갱신을 지운다
    cs = cs.replace(/Updated: \d{4}-\d{2}-\d{2}/, `Updated: ${today()}`);
    cs = _upsertAutoLines(cs, 'Now', [`- ${(buckets['in-progress'][0]?.request) || '대기 중'}`]);
    cs = _upsertAutoLines(cs, 'Next', [`- ${(buckets['planned'][0]?.request) || (buckets['requested'][0]?.request) || '계획된 작업 없음'}`]);
    cs = _upsertAutoLines(cs, 'Blockers', (buckets['blocked'] || []).length ? buckets['blocked'].map(b => `- ${b.id} ${b.request}`) : ['- (없음)']);
    writeUtf8(currentStatePath(root), cs);
  });

  append(taskLogPath(root), `\n## ${today()} session-close\n- Generated session-handoff.md and refreshed current-state.md.\n`);

  log('# Session Close');
  log('## Task Lists');
  for (const s of STATUSES) {
    log(`\n### ${s}`);
    log(rowsToList(buckets[s]));
  }
  log('\n## Agent / Model Provenance');
  executionProvenance.markdownLines.forEach(line => log(line));
  if (executionProvenance.partial) warn(t(`execution ledger가 일부만 신뢰 가능합니다: ${executionProvenance.code || 'truncated'}`, `execution ledger is only partially reliable: ${executionProvenance.code || 'truncated'}`));
  // 1.9.8: 룰 검증 자동 수행 + 보고
  const ruleResults = verifyRules(root);
  jsonResult.rules = ruleResults.map(r => ({ id: r.id, trigger: r.trigger, verified: r.verified, note: r.note }));
  log('\n## ⚡ User Rules verification');
  if (!ruleResults.length) log(t('- 활성 룰 없음', '- no active rules'));
  else {
    log('| ID | Trigger | Rule | Verified | Note |');
    log('|---|---|---|---|---|');
    const ic = { pass: '✓ pass', pending: '⓿ pending', manual: 'ⓘ manual', baseline: '○ baseline' };
    for (const r of ruleResults) log(`| ${r.id} | ${r.trigger} | ${r.rule.slice(0, 40)} | ${ic[r.verified] || '?'} | ${r.note} |`);
  }
  log('\n## Required final response sections');
  log(t('- 완료 작업\n- 진행 중 작업\n- 미완료/예정/대기/보류/차단/드랍 작업\n- 검증 결과\n- 추천 방향\n- 다음 정확한 작업\n- ⚡ 활성 룰별 검증 결과', '- Completed tasks\n- In-progress tasks\n- Incomplete/planned/waiting/on-hold/blocked/dropped tasks\n- Verification results\n- Recommended direction\n- Next exact step\n- ⚡ Per-rule verification results'));
  ok(`session-handoff.md and current-state.md updated`);
  // 1.9.12: session close 끝에 roadmap.html 자동 갱신
  _autoRoadmap(root, 'session-close');
  // 1.36.68 (8차 헌트 F14 재구현, 검수: --no-suggest 에서도 노출): 미승인 미리보기(approve 대기)를 마감 보고에 노출 —
  //   1.36.67 이연 원인: 삽입 지점이 jsonMode 전용 후처리 구간이라 텍스트 경로가 도달조차 안 했다.
  //   이제 텍스트 렌더 구간에서 출력하고 JSON 필드는 동일 데이터로 채운다(양 모드 일치).
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
  // 1.9.57: --suggest 옵션 — 마감 시 skill suggest + drift check + lessons 통합 보고
  // 1.9.59: default 활성 — --no-suggest로 명시 비활성 가능
  const suggestEnabled = (has('--suggest') || (!has('--no-suggest') && process.env.LEERNESS_NO_SUGGEST !== '1'));
  if (suggestEnabled) {
    const isTty = process.stdout && process.stdout.isTTY;
    const cy = s => isTty ? `\x1b[36m${s}\x1b[0m` : s;
    const dim = s => isTty ? `\x1b[2m${s}\x1b[0m` : s;
    log('');
    log(cy(t('## 💡 다음 라운드 추천 (1.9.57 --suggest)', '## 💡 Next-round suggestions (--suggest)')));
    // 1) skill suggest
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
    // 2) drift check
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

    // 3) usage stats top
    try {
      const stats = _readUsageStats(root);
      const entries = Object.entries(stats.commands || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (entries.length) {
        log(dim(t(`  📊 가장 많이 쓴 명령: ${entries.map(([c, n]) => `${c}(${n})`).join(', ')}`, `  📊 Most-used commands: ${entries.map(([c, n]) => `${c}(${n})`).join(', ')}`)));
        jsonResult.topCommands = entries.map(([command, count]) => ({ command, count }));
      }
      // 1.9.74: MCP tools/call 통계 + rare 도구 노출
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
    // 1.9.74: skill match query top (skill-suggestions.md 누적)
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
          // 같은 query 개수 카운트
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
  // 1.9.13: 세션 카운터 + 자동 한 줄 요약 + 5세션마다 깊은 회고
  try {
    const sc = readSessionCounter(root);
    sc.count = (sc.count || 0) + 1;
    sc.lastCloseAt = now();
    writeSessionCounter(root, sc);
    const agg = _retroAggregate(root);
    log(t(`\n## 📈 진행 요약 (session #${sc.count})`, `\n## 📈 Progress summary (session #${sc.count})`));
    log(`  ${_retroOneLine(agg, uiLang)}`);  // 1.24.1 (UR-0010): 진행 요약 한 줄 en
    // 1.9.132: archive 활동 1줄 요약 — 마감 시점에 DELETE 활동 가시화 (handoff 7번째 회수와 symmetric)
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
    // 1.9.16: 워크스페이스 안내 (다른 leerness 프로젝트가 있으면)
    try {
      const wsCands = [path.resolve(root, '_apps'), path.resolve(root, '..', '_apps')];
      let wsCount = 0;
      for (const base of wsCands) {
        if (!exists(base)) continue;
        try { if (!fs.statSync(base).isDirectory()) continue; } catch { continue; }
        for (const e of fs.readdirSync(base)) {
          try {
            const p = path.join(base, e);
            if (fs.statSync(p).isDirectory() && exists(path.join(p, '.leerness')) && p !== root) wsCount++;
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
    // 1.9.103: stdout 복원
    if (jsonMode) process.stdout.write = _origWrite;
  }
  // 1.36.177 (T-0022): mutation must not depend on the renderer. Previously
  // this lived only in the human-output branch, so `--json` accepted the flag,
  // returned success, and silently skipped every file. Run once before either
  // renderer and retain every applied/skipped/failed result for honest output.
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
  // 1.9.103: JSON 모드 — 구조화 출력
  if (jsonMode) {
    try {
      const sc = readSessionCounter(root);
      jsonResult.sessionNumber = sc.count;
    } catch {}
    // 1.9.122: memorySurface 통합 (handoff --json 1.9.115 와 동일 패턴)
    try {
      const rows0 = readProgressRows(root);
      const tasksByStatus0 = {};
      for (const s of STATUSES) tasksByStatus0[s] = 0;
      for (const r of rows0) tasksByStatus0[r.status] = (tasksByStatus0[r.status] || 0) + 1;
      const tasksInProgress0 = tasksByStatus0['in-progress'] || 0;
      const decisionsCount0 = _loadDecisions(root).length;  // 1.9.339 (UR-0053): canonical 단일 진실소스
      const rules0 = readRules(root);
      const rulesActive0 = rules0.filter(r => r.status === 'active').length;
      const planText0 = exists(planPath(root)) ? read(planPath(root)) : '';
      const milestones0 = (planText0.match(/^### M-\d{4,}\./gm) || []).length;
      const lessonsCount0 = _loadLessons(root).length;
      // 1.9.130: archive 카운트 통합
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
        archive: archiveCountsS,  // 1.9.130
        summary: `T${tasksInProgress0}/D${decisionsCount0}/R${rulesActive0}/P${milestones0}/L${lessonsCount0}`,
      };
      // 1.9.142: featureCounts 통합 — session close JSON에 Feature Graph 통계
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

    // 1.9.217: session close 자동 통합 — 1.9.207 + 1.9.209 + 1.9.212
    //   마감 시 미답 요청 / pre-wake audit / 멱등성 검사 자동 실행 + JSON 통합
    try {
      // 1.9.207: 미답 사용자 요청 audit
      const reqAudit = _auditUserRequests(root);
      jsonResult.userRequestsAudit = {
        total: reqAudit.total,
        open: reqAudit.open,
        missing: reqAudit.missing ? reqAudit.missing.length : 0,
        tracked: reqAudit.tracked ? reqAudit.tracked.length : 0,
        stale: reqAudit.stale ? reqAudit.stale.length : 0
      };
      // 1.9.223: delivered 패턴 자동 감지 통합
      try {
        const delivered = _detectDeliveredRequests(root);
        jsonResult.deliveredRequests = {
          candidates: delivered.candidates.length,
          currentVersion: delivered.currentVersion,
          autoCompleteAvailable: delivered.candidates.length > 0
        };
      } catch {}
      // 1.9.227: roundHistory 통합 (session close JSON 6번째 통합 필드)
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
      // 1.9.230: milestones 통합 (session close JSON 7번째 통합 필드)
      try {
        const ms = _computeMilestones(root);
        jsonResult.milestones = _milestoneSurface(ms);
      } catch (err) {
        jsonResult.milestones = _milestoneSurface({ gitHistoryState: 'unavailable', gitHistoryError: { code: 'git_history_unavailable', reason: 'aggregate_exception', error: String(err && err.message || err) } });
      }
      // 1.9.234: recentChanges 통합 (session close JSON 8번째 통합 필드) — 최근 5 라운드 변경
      try {
        Object.assign(jsonResult, _recentChangesAggregate(_computeRecentChanges(root, 5)));
      } catch (err) {
        Object.assign(jsonResult, _recentChangesAggregate({ state: 'unavailable', error: { code: 'git_history_unavailable', reason: 'aggregate_exception', error: String(err && err.message || err) } }));
      }
      // 1.9.240: pyFiles 통합 (session close JSON 9번째 통합 필드) — UR-0013 2단계
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
      // 1.9.242: envInfo 통합 (session close JSON 10번째 통합 필드) — UR-0014 2단계
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
          // 1.9.249 (UR-0018): 터미널 출력 인코딩 안전 여부 + 자동 회복 결과
          terminalEncodingOk: runtimeEnv.locale.codepage === 65001 || !runtimeEnv.locale.isKoreanWindows,
          autoChcpApplied: process.env._LEERNESS_AUTOCHCP_APPLIED || null,
          // 1.9.250 (UR-0018 2단계): POSIX (Linux/macOS/WSL) terminal encoding 점검
          posixEncodingOk: runtimeEnv.locale.posixEncodingOk,
          isWSL: runtimeEnv.locale.isWSL || false
        };
      } catch {}
      // 1.9.245: apiSkills 통합 (session close JSON 11번째 통합 필드) — UR-0015
      try {
        const allSkills = _listAPISkills(root);
        let currentTaskText = '';
        try {
          const rows = readProgressRows(root);
          const ip = rows.find(r => r.status === 'in-progress');
          if (ip) currentTaskText = (ip.title || '') + ' ' + (ip.notes || '');
        } catch {}
        const matched = currentTaskText ? _matchAPISkills(root, currentTaskText) : [];
        jsonResult.apiSkills = {
          total: allSkills.length,
          matched: matched.length,
          matchedIds: matched.slice(0, 5).map(s => s.id),
          ids: allSkills.slice(0, 10).map(s => s.id)
        };
      } catch {}
      // 1.9.264: shellGuard 통합 (session close JSON 12번째 통합 필드) — UR-0020 셸 실패 메모리 + 환경 변동
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
      // 1.9.209: pre-wake-audit 자동 실행 + 저장 (sleep 전 자동 점검)
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
      // 1.9.212: 멱등성 검사 자동 실행 (rule/task/user-requests/wakeups 4영역)
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
      // 1.9.221: abnormalShutdown 자동 감지 (1.9.220 통합) — session close 시 다음 재개 가이드 회수
      const ad = _detectAbnormalShutdown(root);
      jsonResult.abnormalShutdown = {
        detected: ad.abnormalShutdown,
        severity: ad.severity,
        signalCount: ad.signals.length,
        signals: ad.signals.map(s => ({ kind: s.kind, severity: s.severity, detail: s.detail })),
        resumeGuide: ad.resumeGuide
      };
    } catch {}

    process.stdout.write(JSON.stringify(jsonResult, null, 2) + '\n');
  } else {
    // 1.9.217: human 출력 모드에서도 통합 보고 노출 (마감 직전)
    try {
      const isTty = process.stdout.isTTY;
      const grn = s => isTty ? `\x1b[32m${s}\x1b[0m` : s;
      const yel = s => isTty ? `\x1b[33m${s}\x1b[0m` : s;
      const red = s => isTty ? `\x1b[31m${s}\x1b[0m` : s;
      const dim = s => isTty ? `\x1b[2m${s}\x1b[0m` : s;

      log('');
      log(t(`## 🔚 session close 자동 통합 보고 (1.9.217)`, `## 🔚 session close integrated report`));
      // 1.9.207 + 1.9.223 (delivered 패턴 자동 권장) + 1.9.224 (--auto-apply-delivered 옵션)
      try {
        const reqAudit = _auditUserRequests(root);
        const missCnt = reqAudit.missing ? reqAudit.missing.length : 0;
        let delivered = { candidates: [] };
        try { delivered = _detectDeliveredRequests(root); } catch {}
        if (delivered.candidates && delivered.candidates.length > 0) {
          if (has('--auto-apply-delivered')) {
            // 1.9.224: 자동 정리 (마감 시 호출 — 안전: 패턴 매칭 + 버전 가드)
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
      // 1.9.209
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
      // 1.9.212
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
      // 1.9.264: 셸 실패 메모리 + 환경 변동 요약 (UR-0020) — 마감 시 이번 세션 셸 실패를 회고에 노출
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
      // 1.9.237: session close --auto-cleanup-branches — 50+ release/* branches 시 자동 정리
      //   1.9.224 패턴 (--auto-apply-delivered) 확장 — 마감 시 운영 누적 폐기물 자동 정리
      //   안전: keep 10, merged 만, 현재 branch 보호
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
      // 1.9.243: session close --auto-fix-encoding — 셸 스크립트 인코딩 위험 자동 회복 (UR-0014 3단계)
      //   1.9.224 (--auto-apply-delivered) / 1.9.237 (--auto-cleanup-branches) 패턴 확장
      //   마감 시 한국어/일본어/중국어 PowerShell 인코딩 위험 자동 BOM 추가
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
      // 1.9.232: 마감 시 pulse 한 줄 자동 노출 — 다음 라운드 진입 시 즉시 상태 인지
      try {
        const rh = _computeRoundHistory(root, { allowWorkspaceError: true });
        const ms = _computeMilestones(root);
        const rows = readProgressRows(root);
        const tIn = rows.filter(r => r.status === 'in-progress').length;
        const dCnt = _loadDecisions(root).length;  // 1.9.339 (UR-0053): canonical 단일 진실소스
        const rActive = readRules(root).filter(r => r.status === 'active').length;
        const planText = exists(planPath(root)) ? read(planPath(root)) : '';
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
}

module.exports = { sessionClose, _upsertAutoLines, _executionProvenanceSummary };   // 1.36.98: 보존 규칙을 selftest 가 직접 검증할 수 있게 노출
