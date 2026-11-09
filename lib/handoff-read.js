'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createSnapshot } = require('./stored-read-snapshot');
const { parseProgressRows } = require('./progress-rows');
const { selectNextTask } = require('./session-next');
const { _decisionsFromMd, _parseLessonEntries, _parseArchiveBlocks, _lineSafe, compareVer, parseHarnessVersion } = require('./pure-utils');
const authoringLanguage = require('./authoring-language');
const contextReading = require('./context-reading-guidance');
const VERSION = require('../package.json').version;
const STATUSES = ['requested', 'planned', 'in-progress', 'waiting', 'on-hold', 'blocked', 'incomplete', 'done', 'dropped'];
function initializationNotice(root, language, tty = false) {
  const t = (ko, en) => language === 'en' ? en : ko;
  const yel = text => tty ? `\x1b[33m${text}\x1b[0m` : text;
  const dim = text => tty ? `\x1b[2m${text}\x1b[0m` : text;
  return ['', yel(t('  ⚠  leerness init 미실행 디렉토리', '  ⚠  leerness is not initialized in this directory')),
    dim('     ' + root), dim(t('     handoff가 표시할 컨텍스트(plan/progress/decisions)가 없습니다.', '     there is no context (plan/progress/decisions) for handoff to show.')),
    '', dim(t('     해결:', '     fix:')), '       ' + yel(`leerness init "${root}" --yes --language ${language}`), '',
    dim(t('     (--no-init-check 로 끄기)', '     (disable with --no-init-check)')), ''].join('\n') + '\n';
}
function previewApprovalNotice(state, language) {
  const t = (ko, en) => language === 'en' ? en : ko;
  if (!state.known) return t(`⚠ 미리보기 승인 상태 불명 (${state.code}) — 복구 전 승인 완료로 간주 금지`, `⚠ preview approval unknown (${state.code}) — do not treat as approved until repaired`);
  return state.pendingCount ? t(`미승인 미리보기 ${state.pendingCount}건 (approve 전 코드 금지)`, `${state.pendingCount} preview(s) awaiting approval (no code before approve)`) : '';
}
function handoffRead(root, options, deps) {
  root = path.resolve(root);
  const snapshot = createSnapshot(root), output = [];
  let reminderFailure = null;
  const read = snapshot.read, exists = snapshot.exists;
  const log = (line = '') => output.push(line);
  const warn = line => log('⚠ ' + line);
  if (options.includeInitializationNotice && !fs.existsSync(path.join(root, '.leerness'))) {
    output.push(initializationNotice(root, options.language === 'en' ? 'en' : 'ko').slice(0, -1));
  }
  const _hL = options.language === 'en' ? 'en' : 'ko', _ht = (ko, en) => _hL === 'en' ? en : ko;
  const _uiLang = () => _hL;
  const has = flag => flag === '--json' ? !!options.json : flag === '--compact' ? !!options.compact : flag === '--no-workflow-guide' ? !!options.noWorkflowGuide : false;
  const today = () => new Date().toISOString().slice(0, 10);
  const absRoot = value => path.resolve(value);
  const rel = (base, file) => path.relative(base, file).split(path.sep).join('/');
  const sourcePath = name => path.join(root, '.leerness', name);
  const handoffPath = () => sourcePath('session-handoff.md'), currentStatePath = () => sourcePath('current-state.md');
  const planPath = () => sourcePath('plan.md'), progressPath = () => sourcePath('progress-tracker.md');
  const decisionsPath = () => sourcePath('decisions.md'), taskLogPath = () => sourcePath('task-log.md');
  const detectProjectName = () => { try { const pkg = JSON.parse(read(path.join(root, 'package.json'))); if (pkg.name) return pkg.name; } catch {} return path.basename(root); };
  const readRules = () => deps.readRules(root, read(sourcePath('rules.md')));
  const memory = (surface, parse) => {
    const file = sourcePath(surface + '.json');
    if (exists(file)) { try { const value = JSON.parse(read(file)); if (Array.isArray(value)) return value; } catch {} }
    return parse(read(sourcePath(surface + '.md')));
  };
  const _loadDecisions = () => memory('decisions', _decisionsFromMd);
  const _loadLessons = () => memory('lessons', _parseLessonEntries);
  const _loadUserRequests = () => {
    try { const value = JSON.parse(read(sourcePath('user-requests.json'))); return { requests: Array.isArray(value?.requests) ? value.requests : Array.isArray(value) ? value : [] }; }
    catch { return { requests: [] }; }
  };
  const _sessionSignal = () => deps.sessionSignal(root, { env: options.env, language: _hL, readOnly: true, reader: options.json || options.compact ? snapshot : null });
  const _sessionSignalFlags = deps.sessionSignalFlags;
  const _agentReminderSignal = () => { try { return deps.agentReminderSignal(root, snapshot); } catch (error) { reminderFailure ||= error; throw error; } };
  const _previewApprovalSurface = (_, include = true) => deps.previewApprovalSurface(root, include, snapshot), _previewApprovalText = deps.previewApprovalText;
  const _readFeatureGraph = () => deps.readFeatureGraph(root, snapshot);
  const _projectMode = () => deps.projectMode(root), _tgl = { toggleOn: (_, id) => deps.toggles.toggleOn(root, id, snapshot) };
  const detectLanguageValue = () => deps.detectLanguageValue(root, 'auto', snapshot);
  const handoffRows = parseProgressRows(read(progressPath()));
  const handoffPlan = read(planPath());
  let nextTask;
  try { nextTask = selectNextTask(handoffRows, handoffPlan).row; }
  catch { throw Object.assign(new Error(_ht('plan.md의 작업 우선순위 표식을 확인하세요. 세션 기록을 갱신하지 않았습니다.',
    'Check the owner-priority markers in plan.md. No session receipt was written.')), { code: 'invalid_owner_priorities' }); }
  snapshot.capture(sourcePath('manifest.json'));
function _handoffVersionSkew(root) {
  try {
    const versionFile = path.join(absRoot(root), '.leerness', 'HARNESS_VERSION');
    if (!exists(versionFile)) return null;
    const parsed = parseHarnessVersion(read(versionFile));

    const harnessVersion = parsed.base;
    if (!harnessVersion) return { detected: true, kind: 'invalid-harness-version', cliVersion: VERSION, harnessVersion: _lineSafe(parsed.raw) };
    const order = compareVer(VERSION, harnessVersion);
    if (order === 0) return null;
    return {
      detected: true,
      kind: order < 0 ? 'cli-older' : 'harness-older',
      cliVersion: VERSION,
      harnessVersion,
      action: order < 0 ? 'update the leerness CLI before write commands' : 'run leerness update --yes for this project'
    };
  } catch { return null; }
}
function _emitHandoffVersionSkew(skew, lang) {
  if (!skew) return;
  const _ht = (ko, en) => (lang === 'en' ? en : ko);
  if (skew.kind === 'cli-older') {
    warn(_ht(`버전 불일치: 실행 CLI v${_lineSafe(skew.cliVersion)} < 프로젝트 하네스 v${_lineSafe(skew.harnessVersion)} — 쓰기 명령 전 CLI를 업데이트하세요`, `version mismatch: CLI v${_lineSafe(skew.cliVersion)} < project harness v${_lineSafe(skew.harnessVersion)} — update the CLI before write commands`));
  } else if (skew.kind === 'harness-older') {
    warn(_ht(`버전 불일치: 실행 CLI v${_lineSafe(skew.cliVersion)} > 프로젝트 하네스 v${_lineSafe(skew.harnessVersion)} — leerness update --yes 권장`, `version mismatch: CLI v${_lineSafe(skew.cliVersion)} > project harness v${_lineSafe(skew.harnessVersion)} — run leerness update --yes`));
  } else {
    warn(_ht(`프로젝트 HARNESS_VERSION 을 해석할 수 없습니다: ${_lineSafe(skew.harnessVersion)}`, `cannot parse the project HARNESS_VERSION: ${_lineSafe(skew.harnessVersion)}`));
  }
}
  const _versionSkew = _handoffVersionSkew(root);
  if (has('--json')) {
    const result = {
      date: today(),
      project: detectProjectName(root),
      version: VERSION,
      versionSkew: _versionSkew,
      files: {}
    };

    function _addFile(key, p, tailFirst) {
      if (!exists(p)) return;
      const content = read(p);
      if (content.length <= 8000) { result.files[key] = { path: rel(root, p), content }; return; }

      const _safe = (s, n, fromEnd) => {
        const cps = Array.from(s); let len = 0, k = 0;
        if (fromEnd) { for (let i = cps.length - 1; i >= 0 && len + cps[i].length <= n; i--) { len += cps[i].length; k++; } return cps.slice(cps.length - k).join(''); }
        for (let i = 0; i < cps.length && len + cps[i].length <= n; i++) { len += cps[i].length; k++; }
        return cps.slice(0, k).join('');
      };

      const MARK = '\n…(truncated)';
      const budget = 8000 - MARK.length;
      const cut = tailFirst ? MARK.trimStart() + '\n' + _safe(content, budget, true) : _safe(content, budget, false) + MARK;
      result.files[key] = { path: rel(root, p), content: cut, truncated: true, totalChars: content.length, kept: tailFirst ? 'tail' : 'head' };
    }
    _addFile('sessionHandoff', handoffPath(root));
    _addFile('currentState', currentStatePath(root));
    _addFile('plan', planPath(root));
    _addFile('progressTracker', progressPath(root), true);
    _addFile('decisions', decisionsPath(root), true);
    _addFile('taskLog', taskLogPath(root), true);

    const activeRules = readRules(root).filter(r => r.status === 'active');
    if (activeRules.length) result.activeRules = activeRules.map(r => ({ id: r.id, trigger: r.trigger, rule: r.rule }));
    result.ruleVerificationNotice = require('../lib/rule-verification').ruleObservationNotice(_uiLang(root));

    try {
      const rows = handoffRows;
      const tasksByStatus = {};
      for (const s of STATUSES) tasksByStatus[s] = 0;
      for (const r of rows) tasksByStatus[r.status] = (tasksByStatus[r.status] || 0) + 1;
      const tasksInProgress = tasksByStatus['in-progress'] || 0;
      result.nextTask = nextTask;
      const decisionsCount = _loadDecisions(root).length;
      const rules = readRules(root);
      const rulesActive = rules.filter(r => r.status === 'active').length;
      const planText = exists(planPath(root)) ? read(planPath(root)) : '';
      const milestones = (planText.match(/^### M-\d{4,}\./gm) || []).length;
      const lessonsCount = _loadLessons(root).length;

      const archiveCountsH = { decisions: 0, lessons: 0, plan: 0, total: 0 };
      try {
        const hdH = path.join(root, '.leerness');
        for (const [key, file] of [['decisions', 'decisions.archive.md'], ['lessons', 'lessons.archive.md'], ['plan', 'plan.archive.md']]) {
          const fpH = path.join(hdH, file);
          if (exists(fpH)) {
            const entries = _parseArchiveBlocks(read(fpH));
            archiveCountsH[key] = entries.length;
            archiveCountsH.total += entries.length;
          }
        }
      } catch {}
      result.memorySurface = {
        tasks: { inProgress: tasksInProgress, total: rows.length, byStatus: tasksByStatus },
        decisions: { count: decisionsCount },
        rules: { active: rulesActive, total: rules.length },
        plan: { milestones },
        lessons: { count: lessonsCount },
        archive: archiveCountsH,
        summary: `T${tasksInProgress}/D${decisionsCount}/R${rulesActive}/P${milestones}/L${lessonsCount}`,
      };

      try {
        const { nodes: fNodesH } = _readFeatureGraph(root);
        const edgeCount = fNodesH.reduce((s, n) => s + (n.dependsOn?.length || 0) + (n.affects?.length || 0) + (n.coChangesWith?.length || 0), 0);
        const linkedSet = new Set();
        for (const n of fNodesH) {
          for (const x of [...(n.dependsOn||[]), ...(n.affects||[]), ...(n.coChangesWith||[])]) { linkedSet.add(n.id); linkedSet.add(x); }
        }
        const isolated = fNodesH.length ? (fNodesH.length - linkedSet.size) : 0;
        result.featureGraph = {
          total: fNodesH.length,
          edges: edgeCount,
          isolated: Math.max(0, isolated),
          summary: `F${fNodesH.length}/E${edgeCount}${isolated > 0 ? `/iso${isolated}` : ''}`
        };
      } catch {}
    } catch {}

    {
      result.inspection = { status: 'not_inspected', command: 'leerness handoff --inspect' };
      result.sessions = _sessionSignal(root, { readOnly: true });
      try { const _rem = _agentReminderSignal(root); if (_rem) result.agentReminders = _rem; } catch {}
      result.previewApproval = _previewApprovalSurface(root);
      result.authoringPolicy = authoringLanguage.readPolicy(root, detectLanguageValue(root, 'auto'));
      result.reportingPolicy = require('../lib/plain-language-reporting').state(root, snapshot);
      result.loopGuard = deps.loopSummary(root, { git: snapshot.git }, _hL).doc;
      if (reminderFailure) throw reminderFailure;
      snapshot.verify();
      return { text: JSON.stringify(result, null, 2) + '\n', data: result, snapshot };
    }
  }
  const authoringPolicy = authoringLanguage.readPolicy(root, detectLanguageValue(root, 'auto'));
  if (authoringPolicy.explicit) log(authoringLanguage.guidance(authoringPolicy));
  const reportingPolicy = require('../lib/plain-language-reporting').state(root, snapshot);
  _emitHandoffVersionSkew(_versionSkew, _hL);
  for (const line of deps.loopSummary(root, { git: snapshot.git }, _hL).lines) log(line);

  if (has('--compact')) {
    const rows = handoffRows;
    const byStatus = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    const done = byStatus['done'] || 0, wip = byStatus['in-progress'] || 0, blocked = byStatus['blocked'] || 0;
    const pct = rows.length ? Math.round(done / rows.length * 100) : 0;
    const decN = _loadDecisions(root).length;
    const rulesActive = readRules(root).filter(r => r.status === 'active').length;
    const lessN = _loadLessons(root).length;
    const planText = exists(planPath(root)) ? read(planPath(root)) : '';
    const mileN = (planText.match(/^### M-\d{4,}\./gm) || []).length;
    const openReq = (_loadUserRequests(root).requests || []).filter(r => r.status === 'open' || r.status === 'in-progress').length;
    const nx = nextTask;
    const flags = [_ht('환경·진단: 미확인', 'environment/diagnostics: not inspected')];
    if (openReq) flags.push(_ht(`미답 ${openReq}`, `unanswered ${openReq}`));
    if (blocked) flags.push(`blocked ${blocked}`);

    try { const _ss = _sessionSignal(root); flags.push(..._sessionSignalFlags(_ss, _hL)); } catch {}
    try { const _rm = _agentReminderSignal(root); if (_rm) flags.push(_ht(`리마인더 ${_rm.lines ?? 'unknown'}줄`, `reminders ${_rm.lines ?? 'unknown'} line(s)`)); } catch {}

    const _pa = _previewApprovalSurface(root, false);
    flags.push(`${_pa.known ? '' : '⚠ '}${_previewApprovalText(_pa)}`);
    if (reportingPolicy.status === 'active') flags.push(`report: ${reportingPolicy.path}`);
    else if (reportingPolicy.status !== 'off') flags.push(`report: ${reportingPolicy.status}`);
    log(_lineSafe(`leerness compact: ${detectProjectName(root)} · ${done}/${rows.length}(${pct}%) done · WIP ${wip} · T${wip}/D${decN}/R${rulesActive}/P${mileN}/L${lessN}${flags.length ? ' · ' + flags.join(' · ') : ''}`));
    if (nx) log(_lineSafe(_ht(`다음: ${nx.id} [${nx.status}] ${nx.nextAction || nx.request || ''}`, `Next: ${nx.id} [${nx.status}] ${nx.nextAction || nx.request || ''}`)).slice(0, 200));
    log(contextReading.COMPACT_RULES);
    for (const r of readRules(root).filter(r => r.status === 'active')) log(`- ${r.id} [${r.trigger}] ${r.rule}`);
    if (reminderFailure) throw reminderFailure;
    snapshot.verify();
    return { text: output.join('\n') + '\n', data: null, snapshot };
  }
  if (reportingPolicy.status === 'active') log(_ht('쉬운 설명 보고가 켜져 있습니다. 정책 원문: ', 'Plain-language reporting is on; read ') + reportingPolicy.path);
  else if (reportingPolicy.status !== 'off') log(_ht('쉬운 설명 보고 적용 불가: ', 'Plain-language reporting unavailable: ') + reportingPolicy.status);
  const sections = [];

  const BODY_CAP = 4000;
  function block(label, p, tailLines, supplied) {
    if (supplied === undefined && !exists(p)) return;
    const body = supplied === undefined ? read(p).trim() : supplied.trim();

    let ls = body ? body.split('\n') : [];
    const total = ls.length;
    if (tailLines && ls.length > tailLines) ls = ls.slice(-tailLines);
    let truncated = false;

    if (ls.length) {

      let acc = 0, keep = 0;
      const fits = (i) => acc + (keep ? 1 : 0) + ls[i].length <= BODY_CAP;
      if (tailLines) { for (let i = ls.length - 1; i >= 0; i--) { if (!fits(i) && keep > 0) break; acc += (keep ? 1 : 0) + ls[i].length; keep++; } if (keep < ls.length) { ls = ls.slice(-keep); truncated = true; } }
      else { for (let i = 0; i < ls.length; i++) { if (!fits(i) && keep > 0) break; acc += (keep ? 1 : 0) + ls[i].length; keep++; } if (keep < ls.length) { ls = ls.slice(0, keep); truncated = true; } }
    }

    if (ls.length === 1 && ls[0].length > BODY_CAP) {
      const cp = Array.from(ls[0]);
      let n = 0, len = 0;
      if (tailLines) { for (let i = cp.length - 1; i >= 0 && len + cp[i].length <= BODY_CAP; i--) { len += cp[i].length; n++; } ls = [cp.slice(cp.length - n).join('')]; }
      else { for (let i = 0; i < cp.length && len + cp[i].length <= BODY_CAP; i++) { len += cp[i].length; n++; } ls = [cp.slice(0, n).join('')]; }
      truncated = true;
    }
    const note = (tailLines || truncated)
      ? _ht(` — ${ls.length}/${total} 줄${truncated ? ' (상한으로 잘림)' : ''}`, ` — ${ls.length}/${total} lines${truncated ? ' (cut at the size cap)' : ''}`)
      : '';
    sections.push(`\n=== ${label}${note} (${rel(root,p)}) ===\n${ls.join('\n')}`);
  }

  const reminderPath = path.join(root, '.leerness', 'agent-reminders.md');
  const reminder = require('./reminder-text').readReminder(root, snapshot);
  if (reminder.unreadable) sections.push('\n=== Agent Reminders (pending) (' + rel(root, reminderPath) + ') ===\n' + _ht('표시하지 않음: UTF-8 로 읽을 수 없는 바이트가 있습니다. 파일은 바꾸지 않았습니다. UTF-8 로 저장하면 여기에 표시됩니다.', 'Not shown: this file has bytes that are not valid UTF-8. It was left unchanged. Save it as UTF-8 to show it here.'));
  else if (reminder.exists) block('Agent Reminders (pending)', reminderPath, null, reminder.text);
  block('Session Handoff', handoffPath(root));
  block('Current State', currentStatePath(root));
  block('Plan', planPath(root));
  block('Progress Tracker', progressPath(root));
  block('Decisions (last 40 lines)', decisionsPath(root), 40);
  block('Task Log (last 60 lines)', taskLogPath(root), 60);
  const out = sections.join('\n');
  log('# Session Start Context');
  log(`Date: ${today()}`);
  log(`Project: ${detectProjectName(root)}`);

  if (!has('--no-workflow-guide') && !has('--compact')) {
    try {
      const reportPath = path.join(root, '.leerness', 'migration-report.md');
      if (exists(reportPath)) {
        snapshot.observeMetadata(reportPath);
        const stat = fs.statSync(reportPath);
        const ageHr = (Date.now() - stat.mtimeMs) / 3600000;
        if (ageHr < 24) {
          const rep = read(reportPath);
          const aiBlock = rep.match(/## 🤖 AI must re-read[\s\S]*?(?=\n## )/);
          if (aiBlock) {
            const isTty = process.stdout && process.stdout.isTTY;
            const yel = s => isTty ? `\x1b[33m${s}\x1b[0m` : s;
            log('');
            log(yel(_ht(`## 최근 ${ageHr.toFixed(1)}시간 전 migrate 차분 — AI 에이전트는 신규 도구 우선 시도`, `## Migrated ${ageHr.toFixed(1)}h ago — AI agents should try the new tools first`)));
            log(aiBlock[0].trim());
            log('');
          }
        }
      }
    } catch {}
  }
  {
    const rows = handoffRows;
    const next = nextTask;
    const _paNotice = previewApprovalNotice(_previewApprovalSurface(root, false), _hL);
    if (_paNotice) log(_paNotice);
    log(_ht('환경·진단: 미확인 (not_inspected). 명시적 검사: leerness handoff --inspect',
      'Environment/diagnostics: not inspected. Explicit inspection: leerness handoff --inspect'));
    if (next) log(`${next.id} [${next.status}] ${next.request}
${_ht('다음', 'Next')}: ${next.nextAction}`);
    if (!options.noHeadline) {
      const parts = [];
      try { parts.push(...deps.sessionSignalParts(_sessionSignal(), _hL)); } catch {}
      try { const _rm = _agentReminderSignal(root); if (_rm) parts.push(_ht(`에이전트 리마인더 대기 ${_rm.lines ?? 'unknown'}줄 → ${_rm.path}`, `${_rm.lines ?? 'unknown'} line(s) of pending agent reminders → ${_rm.path}`)); } catch {}
      if (parts.length) log(parts.join(' · '));
    }
  }
  const activeRules = readRules(root).filter(r => r.status === 'active');
  if (activeRules.length) {
    log('');
    log(_ht('## ⚡ Active User Rules (사용자가 명시 중지/제거 요청 전까지 매 세션 자동 노출)', '## ⚡ Active User Rules (shown every session until the user explicitly pauses or removes them)'));
    log(require('../lib/rule-verification').ruleObservationNotice(_uiLang(root)));
    for (const r of activeRules) log(`- ${r.id} [${r.trigger}] ${r.rule} (lastVerified: ${r.lastVerified || '-'})`);
    log('');
  }

  if (_projectMode(root) === 'minimal' || !_tgl.toggleOn(root, 'full-reread')) {
    log(_ht(`(문서 본문 생략. 필요할 때 읽으세요: .leerness/current-state.md · plan.md · progress-tracker.md · decisions.md)`,
      `(document bodies omitted. Read on demand: .leerness/current-state.md · plan.md · progress-tracker.md · decisions.md)`));
    log(_ht(`되돌리기: leerness toggle set full-reread on  ·  등급: leerness mode set standard`,
      `Restore: leerness toggle set full-reread on  ·  tier: leerness mode set standard`));
  } else {
    log(out);
  }

  log('✓ handoff loaded');
  if (reminderFailure) throw reminderFailure;
  snapshot.verify();
  return { text: output.join('\n') + '\n', data: null, snapshot };
}
module.exports = { handoffRead, initializationNotice, previewApprovalNotice };
