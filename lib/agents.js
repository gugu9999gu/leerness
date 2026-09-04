// lib/agents.js — agents 오케스트레이션 핸들러 (UR-0025/UR-0125 큰 핸들러 모듈화 9번째, 1.9.424)
//   bin/leerness.js 에서 agentsCmd(442줄) 분리. DI: harness 고유 의존(VERSION, has, arg, _agentSlashHint, _allProviders, _checkAgent, _cliChat, _dispatchCommand, _harnessBrief, _loadEnvFile, _normalizeRole, _policyEnforce, _readUserProviders, _recommendAgent, _recordRun, _resolveRole, lessonsPath, taskLogPath) 주입.
//   io 프리미티브는 ./io, EXTERNAL_AGENTS 는 ./agent-registry, cp/path/fs 빌트인.
//   시그니처 (root, sub, ...args) → (root, sub, args[], deps): rest 를 배열 인자로 받아 재귀에 deps 전달. 동작 무변경.
'use strict';
const path = require('path');
const fs = require('fs');
const { log, ok, warn, fail, failJson, today, now, absRoot, exists, read, readBuf, mkdirp, writeUtf8, append, rel } = require('./io');
const { EXTERNAL_AGENTS, AGENT_SLASH_COMMANDS } = require('./agent-registry');
const { spawnPortable } = require('./portable-process');
const { classify } = require('./routing');
const {
  resolveRoleFallback, selectFallbackOption, sessionIdentityFromEnv,
  normalizeExecutorIdentity, assessReviewerIndependence, isValidModelIdentifier,
  appendExecutionEvent, readExecutionEvents,
  appendAvailabilityObservation, appendAvailabilityClear,
  readAvailabilityObservations, availabilityExtrasForCandidate,
} = require('./role-fallback');

function _benchLaunchSpec(agent, task, writeMode) {
  if (!agent || !agent.id) return { unsupported: 'provider definition missing' };
  const prompt = String(task || '');
  switch (agent.id) {
    case 'claude':
      return { file: agent.bin, args: writeMode ? ['--print', '--dangerously-skip-permissions', prompt] : ['--print', prompt], stdin: 'ignore' };
    case 'codex':
      return { file: agent.bin, args: writeMode
        ? ['exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', prompt]
        : ['exec', '--skip-git-repo-check', prompt], stdin: 'ignore' };
    case 'agy':
      return { file: agent.bin, args: writeMode ? ['-p', prompt, '--yolo'] : ['-p', prompt], stdin: 'ignore' };
    case 'grok':
      return { file: agent.bin, args: writeMode ? ['--yolo', prompt] : [prompt], stdin: 'ignore' };
    case 'opencode':
      return { file: agent.bin, args: ['run', prompt], stdin: 'ignore' };
    case 'qwen':
      return { file: agent.bin, args: ['-p', prompt], stdin: 'ignore' };
    case 'aider':
      return { file: agent.bin, args: ['--message', prompt, writeMode ? '--yes' : '--no-auto-commits'], stdin: 'ignore' };
    case 'goose':
      return { file: agent.bin, args: ['run', '-t', prompt], stdin: 'ignore' };
    case 'copilot':
      return { file: agent.bin, args: ['copilot', 'suggest', prompt], stdin: 'ignore' };
    case 'ollama':
      return { unsupported: 'ollama bench requires an explicit model; use leerness agent --provider ollama' };
    default:
      return { unsupported: `provider ${agent.id} has no non-interactive bench invocation` };
  }
}

const _AGENT_VALUE_FLAGS = new Set([
  '--to', '--provider', '--model', '-m', '--role', '--only', '--task', '--tier', '--preset',
  '--approved-by', '--id', '--result', '--summary', '--status', '--agent', '--target', '--evidence',
  '--limit', '--timeout', '--path', '--language',
  '--session-id', '--session-provider', '--session-model', '--session-model-family',
  '--model-family', '--agent-model', '--agent-model-family', '--agent-session',
  '--auth-state', '--entitlement', '--quota-state', '--policy-state', '--reachability',
  '--retry-after', '--expires-at', '--ttl-min', '--reason',
]);

// Parse task/summary text without confusing option values for user text.  The former
// value-based filter could drop a legitimate task whose text happened to equal a model
// name, and it did not cover newly added fallback/provenance flags.  This parser follows
// argv positions instead: known value flags consume exactly their following argument,
// boolean/unknown flags are skipped, and `--` explicitly starts literal text.
function _parseAgentPositional(argv, start = 0) {
  const list = Array.isArray(argv) ? argv : [];
  const out = [];
  for (let i = Math.max(0, start | 0); i < list.length; i++) {
    const token = String(list[i] == null ? '' : list[i]);
    if (token === '--') {
      for (let j = i + 1; j < list.length; j++) out.push(String(list[j] == null ? '' : list[j]));
      break;
    }
    if (_AGENT_VALUE_FLAGS.has(token)) { if (i + 1 < list.length) i++; continue; }
    if (/^--[^=]+=/.test(token) || token.startsWith('-')) continue;
    out.push(token);
  }
  return out.join(' ').trim();
}

function _findAgentAction(argv, allowedActions) {
  const allowed = allowedActions instanceof Set ? allowedActions : new Set(allowedActions || []);
  const list = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < list.length; i++) {
    const token = String(list[i] == null ? '' : list[i]);
    if (token === '--') break;
    if (_AGENT_VALUE_FLAGS.has(token)) { if (i + 1 < list.length) i++; continue; }
    if (/^--[^=]+=/.test(token) || token.startsWith('-')) continue;
    const action = token.trim().toLowerCase();
    if (allowed.has(action)) return { action, index: i };
  }
  return { action: null, index: -1 };
}

function agentsCmd(root, sub, args = [], deps = {}) {
  const { VERSION, has, arg, _agentSlashHint, _allProviders, _checkAgent, _cliChat, _dispatchCommand, _harnessBrief, _loadEnvFile, _normalizeRole, _policyEnforce, _readUserProviders, _recommendAgent, _recordRun, _resolveRole, _withLock, lessonsPath, taskLogPath } = deps;
  const _spawnPortable = deps._spawnPortable || spawnPortable;
  root = absRoot(root || process.cwd());
  const en = deps.uiLang === 'en';
  const t = (ko, enText) => (en ? enText : ko);
  // 1.9.435 (11th 외부평가 Codex P2, UR-0137): dispatch/multi task 파싱 — flag 값이 task 본문에 흡수되던 버그 수정.
  //   상위(bin)에서 args 는 '--to' flag 만 제거되고 값(codex)은 positional 로 남아 기존 filter 가 task 에 흡수시켰음.
  //   → flag 에서 break + lib 가 소비하는 값-flag(--to/--model/--role/--only) 값을 제외. 명시 task 는 --task 폴백.
  const _positionalText = (start = 0) => _parseAgentPositional(args, start);
  const _taskArg = () => _positionalText(0) || arg('--task', null);
  const _taskArgFrom = (start = 0) => _positionalText(start) || arg('--task', null);
  // .env 자동 로드 (1.9.22)
  _loadEnvFile(root);
  _loadEnvFile(path.join(root, '..'));


  const _ledgerEvent = (event) => {
    try { return appendExecutionEvent(root, event, { withLock: _withLock }); }
    catch (error) { return { ok: false, error: error && error.message ? error.message : String(error), code: error && error.code ? error.code : 'ledger_write_failed' }; }
  };
  const _sessionIdentity = () => {
    const base = sessionIdentityFromEnv(process.env);
    const explicit = [
      '--session-id', '--session-provider', '--session-model', '--session-model-family',
    ].some(flag => has(flag));
    return normalizeExecutorIdentity({
      sessionId: arg('--session-id', base.sessionId),
      provider: arg('--session-provider', base.provider),
      model: arg('--session-model', base.model),
      modelFamily: arg('--session-model-family', base.modelFamily),
      identitySource: explicit ? 'user-declared' : base.identitySource,
    });
  };
  const _roleResolution = (roleArg, task) => {
    const role = _normalizeRole(roleArg);
    let resolved;
    try { resolved = _resolveRole(root, role); }
    catch (error) { return { ok: false, code: (error && error.code) || 'role_store_error', error: (error && error.message) || 'agent-roles.json을 읽을 수 없습니다', role }; }
    if (!resolved) return { ok: false, code: 'role_unconfigured', error: `역할 미설정: ${role}`, role };
    const cls = classify(task, { tier: arg('--tier', '') || '' });
    if (!cls.ok) return { ok: false, code: cls.code, error: cls.error, role };
    const providers = _allProviders(root);
    const availabilityState = readAvailabilityObservations(root, 2000);
    if (availabilityState.ok === false || availabilityState.partial) {
      return {
        ok: false,
        code: availabilityState.code || 'availability_history_partial',
        error: availabilityState.error || 'availability observation history is incomplete',
        role,
      };
    }
    const resolution = resolveRoleFallback({
      role,
      roleDefinition: resolved,
      providers,
      tier: cls.tier,
      policy: arg('--preset', resolved.fallbackPolicy || 'balanced'),
      sessionIdentity: _sessionIdentity(),
      implementerIdentity: normalizeExecutorIdentity({
        provider: arg('--agent', null),
        model: arg('--agent-model', null),
        modelFamily: arg('--agent-model-family', null),
        sessionId: arg('--agent-session', null),
        identitySource: 'user-declared',
      }),
      checkProvider: (definition) => _checkAgent(definition, {
        auth: !!(definition && definition.envFlag && process.env[definition.envFlag] === '1'),
      }),
      availabilityExtras: candidate => availabilityExtrasForCandidate(availabilityState, candidate),
    });
    resolution.availabilityObservationState = {
      activeCount: availabilityState.activeCount,
      partial: availabilityState.partial,
      truncated: availabilityState.truncated,
    };
    return { ok: true, role, resolved, cls, resolution };
  };
  const _renderResolution = (result, task) => {
    const r = result.resolution;
    log(t(`# 역할 실행자 해석: ${r.role} · 위험도 ${r.tier} · 정책 ${r.policy}`, `# Role executor resolution: ${r.role} · risk ${r.tier} · policy ${r.policy}`));
    if (r.primary) {
      log(t(
        `기본: ${r.primary.provider}${r.primary.model ? ' / ' + r.primary.model : ''} [${r.primary.availability.status}]`,
        `Primary: ${r.primary.provider}${r.primary.model ? ' / ' + r.primary.model : ''} [${r.primary.availability.status}]`,
      ));
    } else log(t('기본 실행자: 미설정', 'Primary executor: unconfigured'));
    log(t(`추천: ${r.decision.recommendedOptionId} (${r.decision.recommendationReason})`, `Recommended: ${r.decision.recommendedOptionId} (${r.decision.recommendationReason})`));
    log('');
    log(t('## 선택지', '## Choices'));
    for (const option of r.options) {
      const mark = option.selectable ? '✓' : '×';
      const executor = option.executor && option.executor.provider
        ? `${option.executor.provider}${option.executor.model ? ' / ' + option.executor.model : ''}`
        : option.executor && option.executor.identitySource
          ? `${option.executor.provider || 'unknown'} / ${option.executor.model || 'unknown'} (${option.executor.identitySource})`
          : '-';
      const blockers = option.availability && option.availability.blockingReasons && option.availability.blockingReasons.length
        ? ` · blocked=${option.availability.blockingReasons.join(',')}` : '';
      log(`  ${mark} ${option.id} → ${executor}${blockers}`);
    }
    log('');
    log(t('선택 명령:', 'Selection commands:'));
    log(`  leerness agents fallback provider ${JSON.stringify(task)} --role ${r.role} --to <provider> [--model <model>]`);
    log(`  leerness agents fallback session ${JSON.stringify(task)} --role ${r.role}`);
    log(`  leerness agents fallback direct ${JSON.stringify(task)} --role ${r.role}`);
    log(`  leerness agents fallback hold ${JSON.stringify(task)} --role ${r.role}`);
    if (r.tier === 'high-risk') log(t('  고위험 대체는 --approved-by "<승인자>"가 필요합니다.', '  High-risk substitution requires --approved-by "<approver>".'));
  };

  if (!sub || sub === 'list') {
    // 1.9.157: Provider Registry 통합 — 빌트인 5종 + 사용자 정의 provider 포함
    const providers = _allProviders(root);
    const userIds = new Set(_readUserProviders(root).map(u => u.id));
    const checks = providers.map(a => ({ ...(_checkAgent(a)), source: userIds.has(a.id) ? 'user' : 'builtin' }));
    if (has('--json')) { log(JSON.stringify({ agents: checks }, null, 2)); return; }
    log(t(`# 외부 AI CLI 오케스트레이션 (1.9.30)`, `# External AI CLI orchestration (1.9.30)`));
    log('');
    log(t(`| Agent | source | env (${'env=1 활성'}) | 설치 | 버전 | 상태 |`, `| Agent | source | env (env=1 enabled) | installed | version | status |`));
    log(`|---|---|---|---|---|---|`);
    for (const c of checks) {
      const envMark = c.enabled ? '✓' : '✗';
      const instMark = c.installed ? '✓' : '✗';
      const statusEmoji = c.status === 'ready' ? '🟢 ready'
        : c.status === 'not-installed' ? t('⚪ 미설치', '⚪ not installed')
          : c.status === 'disabled' ? t('🟡 비활성', '🟡 disabled') : '❓';
      log(`| ${c.id} | ${c.source} | ${envMark} ${c.envFlag} | ${instMark} | ${c.version || '-'} | ${statusEmoji} |`);
    }
    //   1.36.94: 무시한 설정을 **평문에서도** 말한다 — JSON 에만 넣으면 사람은 왜 미설치로 보이는지 모른다.
    const _rejected = checks.filter(c => c.binRejected || c.versionArgsRejected);
    if (_rejected.length) {
      log('');
      _rejected.forEach(c => {
        // Rejection reasons are canonical diagnostic fields and remain unchanged
        // in --json. Human English output uses a semantic rendering so Korean
        // sanitizer text (including provider-specific reasons) cannot leak.
        const reason = en
          ? (c.binRejected
            ? 'providers.json bin is not a safe executable name/path, so it was not run'
            : 'providers.json versionArgs contain unsafe shell syntax, so they were ignored and --version was used')
          : (c.binRejected || c.versionArgsRejected);
        log(`⚠ ${c.id}: ${reason}`);
      });
    }
    const ready = checks.filter(c => c.status === 'ready');
    log('');
    log(t(
      `## 활성 (${ready.length}/${checks.length}): ${ready.map(c => c.id).join(', ') || '(없음)'}`,
      `## Active (${ready.length}/${checks.length}): ${ready.map(c => c.id).join(', ') || '(none)'}`,
    ));
    if (!ready.length) {
      log('');
      log(t(`💡 활성화 방법:`, `💡 How to enable:`));
      log(t(
        `  1) CLI 설치 (예: \`npm i -g @openai/codex-cli\`, \`npm i -g @google/antigravity-cli\`)`,
        `  1) Install a CLI (for example, \`npm i -g @openai/codex-cli\` or \`npm i -g @google/antigravity-cli\`)`,
      ));
      log(t(
        `  2) .env 또는 환경변수: LEERNESS_ENABLE_CODEX=1, LEERNESS_ENABLE_AGY=1`,
        `  2) Set .env or environment variables: LEERNESS_ENABLE_CODEX=1, LEERNESS_ENABLE_AGY=1`,
      ));
      log(t(`  3) \`leerness agents check\`로 재확인`, `  3) Run \`leerness agents check\` to check again`));
      log(t(
        `  💡 1.9.157: 빌트인 외 CLI 추가: \`leerness provider add <id> --bin <cmd>\``,
        `  💡 1.9.157: Add a CLI beyond the built-ins: \`leerness provider add <id> --bin <cmd>\``,
      ));
    } else {
      log('');
      log(t(
        `💡 메인 에이전트가 sub-agent 분배 시 위 ${ready.length}개 CLI 활용 가능:`,
        `💡 The primary agent can use the ${ready.length} enabled CLI(s) for sub-agent delegation:`,
      ));
      log(t(
        `   \`leerness agents dispatch "<task>" --to <id>\` 로 프롬프트 전달`,
        `   Pass a prompt with \`leerness agents dispatch "<task>" --to <id>\``,
      ));
    }
    return;
  }

  if (sub === 'availability') {
    const found = _findAgentAction(args, new Set(['list', 'mark', 'set', 'clear', 'remove']));
    const action = found.action || 'list';
    if (action === 'list') {
      const state = readAvailabilityObservations(root, parseInt(arg('--limit', '200'), 10));
      if (has('--json')) {
        log(JSON.stringify(state, null, 2));
        if (state.ok === false || state.partial) process.exitCode = 1;
        return state;
      }
      log(t(`# agents availability — active ${state.activeCount}`, `# agents availability — active ${state.activeCount}`));
      for (const item of state.observations) {
        const axes = [
          item.authenticated && `auth=${item.authenticated}`,
          item.modelEntitled && `entitlement=${item.modelEntitled}`,
          item.quota && `quota=${item.quota}`,
          item.policyAllowed && `policy=${item.policyAllowed}`,
          item.reachable && `reachable=${item.reachable}`,
          item.rateLimited && 'rate-limited=true',
        ].filter(Boolean).join(' · ');
        log(`  ${item.provider}${item.model ? '/' + item.model : ''} — ${item.reason || 'manual-observation'}${axes ? ' · ' + axes : ''}${item.expiresAt ? ' · expires=' + item.expiresAt : ''}`);
      }
      if (state.ok === false || state.partial) { warn(state.error || state.code || 'availability history partial'); process.exitCode = 1; }
      return state;
    }
    const positional = found.index >= 0 ? _parseAgentPositional(args, found.index + 1) : '';
    const provider = (positional.split(/\s+/).filter(Boolean)[0] || arg('--to', null) || arg('--provider', null));
    if (!provider) { failJson(has('--json'), 'availability_provider_required', 'agents availability mark|clear <provider> [--model <id>]'); return; }
    try {
      const written = (action === 'clear' || action === 'remove')
        ? appendAvailabilityClear(root, { provider, model: arg('--model', null), reason: arg('--reason', 'manual-clear'), source: 'user-declared' }, { withLock: _withLock })
        : appendAvailabilityObservation(root, {
          provider,
          model: arg('--model', null),
          modelFamily: arg('--model-family', null),
          reason: arg('--reason', null),
          authenticated: arg('--auth-state', null),
          modelEntitled: arg('--entitlement', null),
          quota: arg('--quota-state', null),
          policyAllowed: arg('--policy-state', null),
          reachable: arg('--reachability', null),
          rateLimited: has('--rate-limited'),
          retryAfter: arg('--retry-after', null),
          expiresAt: arg('--expires-at', null),
          ttlMin: arg('--ttl-min', null),
          source: 'user-declared',
        }, { withLock: _withLock });
      const state = readAvailabilityObservations(root, 2000);
      const out = { ok: true, action: action === 'clear' || action === 'remove' ? 'cleared' : 'marked', event: written.event, active: state.observations, file: written.file };
      if (has('--json')) { log(JSON.stringify(out, null, 2)); return out; }
      ok(t(`availability ${out.action}: ${provider}${arg('--model', null) ? '/' + arg('--model', null) : ''}`, `availability ${out.action}: ${provider}${arg('--model', null) ? '/' + arg('--model', null) : ''}`));
      return out;
    } catch (error) {
      failJson(has('--json'), (error && error.code) || 'availability_write_failed', (error && error.message) || String(error));
      return;
    }
  }

  if (sub === 'resolve') {
    const task = _taskArg();
    const roleArg = arg('--role', null);
    if (!task || !roleArg) { failJson(has('--json'), 'role_and_task_required', 'agents resolve "<task>" --role <role>'); return; }
    const result = _roleResolution(roleArg, task);
    if (!result.ok) { failJson(has('--json'), result.code, result.error); return; }
    const audit = _ledgerEvent({
      event: 'routing.proposed',
      task: task.slice(0, 300),
      role: result.role,
      tier: result.cls.tier,
      policy: result.resolution.policy,
      requestedExecutor: result.resolution.primary ? { provider: result.resolution.primary.provider, model: result.resolution.primary.model } : null,
      decision: result.resolution.decision,
      options: result.resolution.options.map(o => ({ id: o.id, kind: o.kind, executor: o.executor || null, selectable: o.selectable, requiresConfirmation: o.requiresConfirmation })),
      executed: false,
    });
    const out = { ok: true, task, role: result.role, classification: result.cls, resolution: result.resolution, auditWritten: audit.ok === true, auditError: audit.ok === true ? null : audit.error };
    if (has('--json')) { log(JSON.stringify(out, null, 2)); return out; }
    _renderResolution(result, task);
    if (!audit.ok) warn(`실행 이력 기록 실패: ${audit.error}`);
    return out;
  }

  if (sub === 'fallback') {
    const action = _findAgentAction(args, new Set(['primary', 'provider', 'model', 'session', 'session-takeover', 'takeover', 'direct', 'worker', 'session-direct', 'hold', 'defer', 'pause']));
    const choice = action.action || '';
    const task = action.index >= 0 ? (_parseAgentPositional(args, action.index + 1) || arg('--task', null)) : null;
    const roleArg = arg('--role', null);
    if (!choice || !task || !roleArg) { failJson(has('--json'), 'fallback_arguments_required', 'agents fallback provider|session|direct|hold "<task>" --role <role>'); return; }
    const result = _roleResolution(roleArg, task);
    if (!result.ok) { failJson(has('--json'), result.code, result.error); return; }
    const selection = selectFallbackOption(result.resolution, {
      choice,
      provider: arg('--to', null) || arg('--provider', null),
      model: arg('--model', null),
      approvedBy: arg('--approved-by', null),
    });
    if (!selection.ok) { failJson(has('--json'), selection.code, selection.error); return; }
    const option = selection.option;
    if (option.executor && option.executor.provider && ['primary', 'compatible-model', 'compatible-provider'].includes(option.kind)) {
      const delegatedTask = (has('--raw') || typeof _harnessBrief !== 'function') ? task : (_harnessBrief() + task);
      try { option.command = _dispatchCommand(option.executor.provider, delegatedTask, has('--write'), option.executor.model); }
      catch (error) { failJson(has('--json'), (error && error.code) || 'dispatch_command_invalid', (error && error.message) || 'dispatch command could not be prepared'); return; }
    }
    const eventName = option.kind === 'hold' ? 'task.held' : 'fallback.selected';
    const audit = _ledgerEvent({
      event: eventName,
      task: task.slice(0, 300),
      taskId: arg('--id', null),
      role: result.role,
      tier: result.cls.tier,
      policy: result.resolution.policy,
      requestedExecutor: result.resolution.primary ? { provider: result.resolution.primary.provider, model: result.resolution.primary.model } : null,
      actualExecutor: option.executor || null,
      substitution: {
        occurred: option.kind !== 'primary' && option.kind !== 'hold',
        kind: option.kind,
        reason: result.resolution.primary && result.resolution.primary.availability
          ? result.resolution.primary.availability.blockingReasons : ['primary-unconfigured'],
        approvedBy: selection.approvedBy,
      },
      contract: option.contract || null,
      executed: false,
    });
    if (!audit.ok) { failJson(has('--json'), audit.code, `fallback 선택을 기록하지 못해 적용하지 않았습니다: ${audit.error}`); return; }
    const out = {
      ok: true,
      action: option.kind,
      role: result.role,
      tier: result.cls.tier,
      selected: option,
      command: option.command || null,
      contract: option.contract ? { ...option.contract, task: task.slice(0, 300), session: option.executor || null } : null,
      executed: false,
      auditEventId: audit.event.eventId,
    };
    if (has('--json')) { log(JSON.stringify(out, null, 2)); return out; }
    if (option.command) {
      log(t(`# fallback 선택: ${option.kind} → ${option.executor.provider}${option.executor.model ? ' / ' + option.executor.model : ''}`, `# Fallback selected: ${option.kind} → ${option.executor.provider}${option.executor.model ? ' / ' + option.executor.model : ''}`));
      log(option.command);
      log(t('  ⓘ 명령만 준비했으며 아직 모델을 호출하지 않았습니다.', '  ⓘ Command prepared; no model has been called yet.'));
    } else if (option.kind === 'hold') {
      ok(t(`작업 보류 기록: 역할 ${result.role}`, `Work hold recorded: role ${result.role}`));
    } else {
      log(`# ${option.kind}`);
      log(JSON.stringify(out.contract, null, 2));
      log(t('  ⓘ 현재 채팅 Host가 이 계약을 받아 역할을 수행해야 합니다.', '  ⓘ The current chat host must consume this contract and perform the role.'));
    }
    return out;
  }

  if (sub === 'record') {
    const action = _findAgentAction(args, new Set(['start', 'started', 'partial', 'complete', 'completed', 'fail', 'failed', 'review', 'reviewed', 'validate', 'validated']));
    const rawEvent = action.action || '';
    const eventMap = {
      start: 'execution.started', started: 'execution.started',
      partial: 'execution.partial', complete: 'execution.completed', completed: 'execution.completed',
      fail: 'execution.failed', failed: 'execution.failed',
      review: 'review.completed', reviewed: 'review.completed',
      validate: 'validation.completed', validated: 'validation.completed',
    };
    const eventName = eventMap[rawEvent];
    const summary = (action.index >= 0 ? _parseAgentPositional(args, action.index + 1) : '') || arg('--result', null) || arg('--summary', null);
    if (!eventName || !summary) { failJson(has('--json'), 'record_arguments_required', 'agents record started|partial|completed|failed|reviewed|validated "<summary>" [--task T-ID]'); return; }
    const session = sessionIdentityFromEnv(process.env);
    const explicitProvider = arg('--to', null) || arg('--provider', null);
    const explicitModel = arg('--model', null);
    const explicitFamily = arg('--model-family', null);
    const explicitSessionId = arg('--session-id', null);
    const explicitIdentity = !!(explicitProvider || explicitModel || explicitFamily || explicitSessionId);
    const actualExecutor = normalizeExecutorIdentity({
      provider: explicitProvider || session.provider,
      model: explicitModel || (explicitProvider ? null : session.model),
      modelFamily: explicitFamily || (explicitProvider ? null : session.modelFamily),
      // Ambient host session identity is not assumed to be the external model's
      // session. Callers can state the actual executor session explicitly.
      sessionId: explicitSessionId || (explicitProvider ? null : session.sessionId),
      identitySource: explicitIdentity ? 'user-declared' : session.identitySource,
    });
    const implementer = normalizeExecutorIdentity({
      provider: arg('--agent', null),
      model: arg('--agent-model', null),
      modelFamily: arg('--agent-model-family', null),
      sessionId: arg('--agent-session', null),
      identitySource: 'user-declared',
    });
    const independence = eventName === 'review.completed'
      ? assessReviewerIndependence(actualExecutor, implementer) : null;
    const evidence = arg('--evidence', null);
    const requestedRole = arg('--role', null);
    const reviewOfAttemptId = arg('--target', null);
    const audit = _ledgerEvent({
      event: eventName,
      taskId: arg('--task', null),
      sessionId: actualExecutor.sessionId,
      attemptId: arg('--id', null),
      parentAttemptId: reviewOfAttemptId,
      requestedRole,
      role: requestedRole,
      actualExecutor,
      status: arg('--status', rawEvent),
      result: { summary: String(summary).slice(0, 1000), evidence },
      evidenceRefs: evidence ? [evidence] : [],
      reviewOfAttemptId: eventName === 'review.completed' ? reviewOfAttemptId : null,
      reviewerIndependent: eventName === 'review.completed' ? independence.reviewerIndependent : null,
      review: eventName === 'review.completed' ? {
        reviewOfAttemptId,
        reviewOf: independence.implementer,
        reviewerIndependent: independence.reviewerIndependent,
        reviewerIndependence: independence.status,
        independenceBasis: independence.basis,
      } : null,
      executed: true,
    });
    if (!audit.ok) { failJson(has('--json'), audit.code, audit.error); return; }
    const out = { ok: true, event: audit.event, file: audit.file };
    if (has('--json')) { log(JSON.stringify(out, null, 2)); return out; }
    ok(t(`execution provenance 기록: ${audit.event.event} · ${audit.event.eventId}`, `execution provenance recorded: ${audit.event.event} · ${audit.event.eventId}`));
    log(`  ${audit.file}`);
    return out;
  }

  if (sub === 'history') {
    const history = readExecutionEvents(root, parseInt(arg('--limit', '20'), 10));
    if (history.ok === false && history.code !== 'ledger_invalid_lines') {
      failJson(has('--json'), history.code || 'ledger_read_failed', history.error || 'execution ledger를 읽을 수 없습니다');
      return history;
    }
    if (has('--json')) {
      log(JSON.stringify(history, null, 2));
      if (history.invalidLines) process.exitCode = 1;
      return history;
    }
    log(t(`# agents history — 최근 ${history.events.length}건`, `# agents history — latest ${history.events.length} event(s)`));
    for (const event of history.events) {
      const who = event.actualExecutor && event.actualExecutor.provider
        ? `${event.actualExecutor.provider}${event.actualExecutor.model ? '/' + event.actualExecutor.model : ''}` : '-';
      log(`  ${String(event.at || '').slice(0, 19)}  ${String(event.event || '').padEnd(22)} ${String(event.role || '-').padEnd(11)} ${who}`);
    }
    if (history.invalidLines) {
      warn(t(`해석하지 못한 ledger line ${history.invalidLines}건 (유효 이벤트는 보존)`, `${history.invalidLines} execution-ledger line(s) could not be parsed (valid events were preserved)`));
      process.exitCode = 1;
    }
    if (history.truncated) log(t('  ⓘ 최근 4MB 범위만 읽었습니다.', '  ⓘ Only the latest 4 MB was read.'));
    return history;
  }

  // 1.36.78 (10차 헌트 F5): review-request 가 광고하는 `agents recommend <task>` 가 핸들러 부재로 usage(exit 1)만 뱉던 것.
  //   내부 _recommendAgent 로직을 정식 서브명령으로 노출 — 작업 텍스트/유형 → 적합 CLI + 이유.
  if (sub === 'recommend') {
    const task = _taskArg();
    if (!task) { failJson(has('--json'), 'missing_task', 'Usage: leerness agents recommend "<작업 설명 또는 유형>"'); return; }
    const rec = _recommendAgent(task) || { target: null, reason: '' };
    if (has('--json')) { log(JSON.stringify({ ok: true, task, recommended: rec.target, reason: rec.reason }, null, 2)); return; }
    log(`# leerness agents recommend (1.36.78)`);
    log(`  작업: ${task.slice(0, 80)}${task.length > 80 ? '…' : ''}`);
    if (rec.target) { log(`  💡 추천: ${rec.target}${rec.reason ? ` — ${rec.reason}` : ''}`); }
    else { log(`  (특정 추천 없음 — 기본 provider 사용. leerness agents list 로 활성 확인)`); }
    return;
  }
  if (sub === 'check') {
    // list의 alias, 단 명시적 재확인 (JSON 출력 기본)
    // 1.9.157: Provider Registry 통합
    // 1.36.91: `check` 는 **명시적 재확인** 명령이므로 인증 확인까지 수행한다(`list` 는 지연 때문에 하지 않는다).
    //   확인 가능한 provider 만 ok/no 로 판정하고 나머지는 unknown 으로 남긴다 — 설치됨을 사용가능이라 부르지 않는다.
    const providers = _allProviders(root);
    const userIds = new Set(_readUserProviders(root).map(u => u.id));
    const checks = providers.map(a => ({ ...(_checkAgent(a, { auth: true })), source: userIds.has(a.id) ? 'user' : 'builtin' }));
    const authNote = '설치·활성은 확인했습니다. 인증은 무료·비대화형 확인 명령이 있는 provider 만 판정했고(auth: ok|no), 나머지는 unknown 입니다 — 쿼터·과금 권한은 어느 provider 도 확인하지 않았습니다.';
    if (has('--json')) {
      log(JSON.stringify({
        agents: checks, ready: checks.filter(c => c.status === 'ready').map(c => c.id),
        authVerified: checks.filter(c => c.auth === 'ok').map(c => c.id),
        authUnknown: checks.filter(c => c.auth === 'unknown').map(c => c.id),
        authNote,
      }, null, 2));
      return;
    }
    agentsCmd(root, 'list', [], deps); // 비-JSON은 list 표 + 아래 인증 축
    log(`\n## 인증 확인 (1.36.91)`);
    checks.filter(c => c.installed).forEach(c => {
      const mark = c.auth === 'ok' ? '🟢 확인됨' : c.auth === 'no' ? '🔴 미인증' : '⚪ 확인안됨';
      // codex 30차 #7: "확인 명령 없음"은 과장이다 — 없다고 증명한 게 아니라 **등록된 것이 없을** 뿐이다.
      const _why = c.authSource ? `(${c.authSource})`
        : c.authCheckDroppedReason ? `(⚠ ${c.authCheckDroppedReason})`
          : '(등록된 확인 명령 없음 — 무료·비대화형·부작용 없음이 확인된 것만 등록합니다)';
      log(`  ${mark}  ${c.id.padEnd(10)} ${_why}${c.authEvidence ? ' — ' + c.authEvidence : ''}`);
    });
    log(`  ⓘ ${authNote}`);
    return;
  }

  // 1.9.152: agents multi — 1.9.151 install 복수 선택된 ready 에이전트들에 일괄 dispatch 명령 생성
  // 단일 task → 활성 N개 에이전트 동시 dispatch 명령들. 사용자가 한 번에 복사 실행하거나 메인 에이전트가 spawn.
  if (sub === 'multi') {
    const task = _taskArg();
    if (!task) { fail('multi "<task>" 또는 --task 필요'); return process.exit(1); }
    // 1.36.29 (사용자 보고): dispatch 만 위임 브리프를 접두하고 multi(--execute 실 spawn 포함)는 원문 그대로 위임돼
    //   백그라운드 AI 가 leerness 프로토콜(handoff 적재/task 등록/evidence/session close)을 받지 못했다. dispatch 와 동일 규칙: --raw 로 옵트아웃.
    const briefTask = (has('--raw') || typeof _harnessBrief !== 'function') ? task : (_harnessBrief() + task);
    const onlyArg = arg('--only', null);  // 'claude,codex' 처럼 콤마 구분 — 활성 중에서 추가 필터
    const writeMode = has('--write');
    const execute = has('--execute');  // 1.9.156: 명령 출력 → 실제 spawn + consensus 합의
    const checks = _allProviders(root).map(a => ({ def: a, status: _checkAgent(a) }));
    let ready = checks.filter(x => x.status.status === 'ready');
    if (onlyArg) {
      const wanted = new Set(onlyArg.split(/[,\s]+/).filter(Boolean));
      ready = ready.filter(x => wanted.has(x.def.id));
    }
    if (!ready.length) {
      fail('활성 (ready) 에이전트 없음 — `leerness agents list` 로 확인. 1.9.151 install 흐름에서 복수 선택 후 .env 활성화 필요.');
      return process.exit(1);
    }
    // 1.9.281 (UR-0034): 권한 등급 게이트 — enforce ON 시 shell-write 초과 차단 (기본 OFF, 동작 불변)
    if (execute) {
      const pol = _policyEnforce(root, 'agents multi --execute');
      if (!pol.allowed) { fail(pol.reason); return process.exit(1); }
      if (pol.advisory) warn(`정책 advisory: 'agents multi --execute' 요구 등급 ${pol.required} > 허용 ${pol.allowedTier} (enforce OFF — 진행). leerness policy 로 등급 확인`);
    }
    // 1.9.156: --execute 모드 — 실제 spawn + 결과 수집 + multi-signal consensus
    if (execute) {
      return (async () => {
        const timeout = parseInt(arg('--timeout', '60'), 10) * 1000;
        const batchAudit = _ledgerEvent({
          event: 'execution.batch.started',
          taskId: arg('--id', null),
          task: task.slice(0, 300),
          role: arg('--role', null) ? _normalizeRole(arg('--role', null)) : null,
          mode: writeMode ? 'write' : 'read-only',
          result: { summary: 'agents multi --execute prepared', targets: ready.map(x => x.def.id) },
          executed: false,
        });
        if (!batchAudit.ok) {
          failJson(has('--json'), batchAudit.code || 'ledger_write_failed', `외부 모델 호출 전 실행 원장을 기록하지 못해 중단했습니다: ${batchAudit.error}`);
          return;
        }
        const batchEventId = batchAudit.event.eventId;
        if (!has('--json')) {
          log(`# leerness agents multi --execute (1.9.156) — ${ready.length}개 활성 에이전트 병렬 호출`);
          log(`task: ${task.slice(0, 120)}${task.length > 120 ? '…' : ''}`);
          log(`mode: ${writeMode ? '✏ write' : '🔒 read-only'} · timeout=${timeout / 1000}s`);
          log(`대상: ${ready.map(x => x.def.id).join(', ')}`);
          log('');
          log('## 병렬 호출 중...');
        }
        const t0 = Date.now();
        // 병렬 _cliChat 호출 (sandbox 자동: runCommandSafe + env scrub + observability)
        const results = await Promise.all(ready.map(async ({ def }) => {
          const start = Date.now();
          let r;
          try { r = await _cliChat(root, def.id, briefTask, { timeout }); }
          catch (error) { r = { ok: false, response: '', error: error && error.message ? error.message : String(error), executed: false }; }
          const result = {
            agent: def.id,
            model: null,
            identitySource: 'cli-default-unverified',
            executed: r.executed !== false,
            elapsed: Date.now() - start,
            ok: !!r.ok,
            response: r.response || '',
            error: r.error || null,
            responseTokens: Math.ceil((r.response || '').length / 4),
          };
          const resultAudit = _ledgerEvent({
            event: result.ok ? 'execution.completed' : 'execution.failed',
            taskId: arg('--id', null),
            parentAttemptId: batchEventId,
            task: task.slice(0, 300),
            role: arg('--role', null) ? _normalizeRole(arg('--role', null)) : null,
            actualExecutor: normalizeExecutorIdentity({ provider: def.id, model: null, identitySource: result.identitySource }),
            mode: writeMode ? 'write' : 'read-only',
            status: result.ok ? 'completed' : 'failed',
            result: {
              summary: result.ok ? 'agents multi --execute completed' : `agents multi --execute failed: ${result.error || 'unknown error'}`,
              evidence: `elapsedMs=${result.elapsed}; responseChars=${result.response.length}`,
            },
            executed: result.executed,
          });
          result.auditWritten = resultAudit.ok === true;
          result.auditEventId = resultAudit.ok === true ? resultAudit.event.eventId : null;
          result.auditError = resultAudit.ok === true ? null : resultAudit.error;
          return result;
        }));
        const totalElapsed = Date.now() - t0;
        const ok = results.filter(r => r.ok);
        const failures = results.filter(r => !r.ok);
        const auditFailures = results.filter(r => !r.auditWritten);
        _recordRun(root, { kind: 'agents_multi_execute', count: ready.length, success: ok.length, durationMs: totalElapsed, task: task.slice(0, 200) });
        // 1.9.155 consensus 로직 재사용 — multi-signal scoring (tokens + overlap + lengthFit)
        let best = null, scored = [];
        if (ok.length) {
          const tokenizer = (s) => new Set(String(s || '').toLowerCase().match(/[\w가-힣]{3,}/g) || []);
          const wordsOf = ok.map(o => tokenizer(o.response));
          const maxTokens = Math.max(...ok.map(o => o.responseTokens), 1);
          const avgLen = ok.reduce((s, o) => s + o.response.length, 0) / ok.length;
          const stdLen = Math.sqrt(ok.reduce((s, o) => s + (o.response.length - avgLen) ** 2, 0) / ok.length) || 1;
          scored = ok.map((o, i) => {
            const tokensNorm = o.responseTokens / maxTokens;
            const myWords = wordsOf[i];
            let overlapSum = 0;
            for (let j = 0; j < wordsOf.length; j++) {
              if (i === j) continue;
              let inter = 0;
              for (const w of myWords) if (wordsOf[j].has(w)) inter++;
              overlapSum += inter / Math.max(myWords.size, 1);
            }
            const overlap = (ok.length > 1) ? overlapSum / (ok.length - 1) : 0;
            const z = Math.abs((o.response.length - avgLen) / stdLen);
            const lengthFit = z <= 1.5 ? (1 - z / 1.5) : 0;
            const score = 0.4 * tokensNorm + 0.4 * overlap + 0.2 * lengthFit;
            return { ...o, score, tokensNorm, overlap, lengthFit };
          }).sort((a, b) => b.score - a.score);
          best = scored[0];
        }
        if (has('--json')) {
          log(JSON.stringify({
            task, count: ready.length, success: ok.length, totalElapsedMs: totalElapsed,
            results: scored.length ? scored : results,
            best: best ? { agent: best.agent, score: best.score, response: best.response } : null,
            failures,
            provenance: { batchEventId, complete: auditFailures.length === 0, failedWrites: auditFailures.map(r => ({ agent: r.agent, error: r.auditError })) },
          }, null, 2));
          if (auditFailures.length) process.exitCode = 1;
          return;
        }
        log(`\n## 결과: ${ok.length}/${ready.length} 성공 · 총 ${totalElapsed}ms (병렬)`);
        for (const r of results) {
          if (r.ok) log(`  ✓ ${r.agent.padEnd(8)} · ${r.elapsed}ms · ${r.responseTokens} 토큰`);
          else log(`  ✗ ${r.agent.padEnd(8)} · ${r.elapsed}ms · ${(r.error || '').slice(0, 60)}`);
        }
        if (best) {
          log('');
          log(`## 🏆 합의 선택 (multi-signal consensus, 1.9.155)`);
          log(`  best: ${best.agent} · score=${best.score.toFixed(3)} (tokens=${best.tokensNorm.toFixed(2)} · overlap=${best.overlap.toFixed(2)} · lengthFit=${best.lengthFit.toFixed(2)})`);
          if (scored.length > 1) {
            log(`  others: ${scored.slice(1, 4).map(s => `${s.agent}=${s.score.toFixed(2)}`).join(', ')}`);
          }
          log(`  --- 처음 600자 ---`);
          log(best.response.slice(0, 600));
          // task-log 기록
          try {
            const tlp = taskLogPath(root);
            const block = `\n## ${today()} agents multi --execute (1.9.156)\n- task: ${task.slice(0, 200)}\n- agents: ${ready.map(x => x.def.id).join(', ')}\n- success: ${ok.length}/${ready.length}\n- best: ${best.agent} (score=${best.score.toFixed(3)})\n`;
            append(tlp, block);
          } catch {}
          // 1.9.193: B축 (멀티 Sub-Agent 오케스트라) 보강 — consensus 결과를 lessons.md 에 자동 기록
          //   같은 task 재시도 시 과거 best agent + score 가 handoff lessons auto-recall 에서 매칭
          //   끄기: LEERNESS_NO_MULTIAGENT_LESSON=1
          if (process.env.LEERNESS_NO_MULTIAGENT_LESSON !== '1') {
            try {
              const lp = lessonsPath(root);
              const lessonBlock = `\n### ${today()} multi-agent consensus — best=${best.agent} (1.9.193)\n`
                + `- task: ${task.slice(0, 200)}\n`
                + `- agents: ${ready.map(x => x.def.id).join(', ')} (${ok.length}/${ready.length} success)\n`
                + `- best agent: ${best.agent}, score=${best.score.toFixed(3)}\n`
                + (scored.length > 1 ? `- others: ${scored.slice(1, 4).map(s => `${s.agent}=${s.score.toFixed(2)}`).join(', ')}\n` : '')
                + `- lesson: 같은 keyword 재발 시 ${best.agent} 우선 시도 (multi-signal consensus 입증)\n`;
              append(lp, lessonBlock);
            } catch {}
          }
        }
        if (auditFailures.length) {
          warn(`실행 provenance 기록 실패 ${auditFailures.length}건 — 결과를 완료 증거로 사용하지 마세요.`);
          process.exitCode = 1;
        }
        if (failures.length && !best) {
          process.exitCode = 1;
        }
      })();
    }
    if (has('--json')) {
      log(JSON.stringify({
        task, count: ready.length,
        agents: ready.map(x => ({ id: x.def.id, version: x.status.version })),
        commands: ready.map(x => _dispatchCommand(x.def.id, briefTask, writeMode)),
        // 1.9.266 (UR-0021 2단계): 각 에이전트 슬래시 명령 힌트 — sub-agent 가 알맞은 슬래시 사용
        slashCommands: ready.reduce((acc, x) => { const h = _agentSlashHint(root, x.def.id); if (h) acc[x.def.id] = { invoke: h.invoke, commands: h.commands.map(c => c.cmd) }; return acc; }, {})
      }, null, 2));
      return;
    }
    log(`# leerness agents multi (1.9.152) — ${ready.length}개 활성 에이전트 일괄 dispatch`);
    log(`task: ${task.slice(0, 120)}${task.length > 120 ? '…' : ''}`);
    log(`mode: ${writeMode ? '✏ write (파일 수정 가능)' : '🔒 read-only (분석 전용, 안전)'}`);
    log(`대상: ${ready.map(x => x.def.id).join(', ')}`);
    log('');
    log('## 각 에이전트 실행 명령 (사용자가 병렬 실행 또는 메인 에이전트가 spawn)');
    log('');
    for (const { def, status } of ready) {
      log(`### [${def.id}]  (v${status.version || '?'})`);
      log('```sh');
      log(_dispatchCommand(def.id, briefTask, writeMode));
      log('```');
      // 1.9.266 (UR-0021 2단계): 에이전트별 슬래시 명령 힌트
      try {
        const hint = _agentSlashHint(root, def.id);
        if (hint && hint.commands.length) log(`  🤖 슬래시: ${hint.commands.slice(0, 8).map(c => c.cmd).join(' ')}${hint.invoke === 'subcommand' ? ' (하위명령)' : ''}`);
      } catch {}
      log('');
    }
    log('## 정책 (1.9.152 / 1.9.156)');
    log(`  - 기본 모드: 명령 문자열만 출력 (사용자/메인 에이전트가 명시적으로 실행)`);
    log(`  - 1.9.156 신규: \`--execute\` 플래그 시 leerness가 직접 ${ready.length}개 sub-agent 병렬 spawn + multi-signal consensus 자동 합의`);
    log(`     예: leerness agents multi "<task>" --execute  (또는 --execute --json)`);
    log(`  - 활성 에이전트 변경: \`.env\`에서 LEERNESS_ENABLE_<CLI>=1/0 또는 \`leerness setup-agents\` 재실행`);
    log(`  - quota 체크: \`leerness agents quota\``);
    return;
  }
  if (sub === 'dispatch') {
    const task = _taskArg();
    let target = arg('--to', null);
    if (!task) { fail('dispatch "<task>" 또는 --task 필요'); return process.exit(1); }
    // 1.9.152: --multi 또는 --to=all 또는 --to 없음 + 활성 ≥2 → multi 모드로 routing
    if (has('--multi') || target === 'all' || target === '*') {
      return agentsCmd(root, 'multi', args, deps);
    }
    // 1.9.270: --role <role> — 설정된 역할 → provider+model 라우팅 (--to 없을 때)
    const roleArg = arg('--role', null);
    let roleModel = arg('--model', null);
    let rolePersona = '';
    let resolvedRole = null;
    let roleResolutionResult = null;
    if (roleArg) {
      try { resolvedRole = _resolveRole(root, roleArg); }
      catch (error) { failJson(has('--json'), (error && error.code) || 'role_store_error', (error && error.message) || 'agent-roles.json을 읽을 수 없습니다'); return; }
      if (!resolvedRole) {
        failJson(has('--json'), 'role_unconfigured', `역할 미설정: ${_normalizeRole(roleArg)} — roles set 또는 roles suggest --apply 후 다시 시도하세요`);
        return;
      }
      roleResolutionResult = _roleResolution(roleArg, task);
      if (!roleResolutionResult.ok) {
        failJson(has('--json'), roleResolutionResult.code, roleResolutionResult.error);
        return;
      }
    }
    if (roleArg && !target) {
      const resolved = resolvedRole;
      if (!resolved) { fail(`역할 미설정: ${_normalizeRole(roleArg)} — leerness roles set ${_normalizeRole(roleArg)} --provider <id> 또는 roles suggest --apply`); return process.exit(1); }
      target = resolved.provider;
      if (!roleModel) roleModel = resolved.model;
      rolePersona = resolved.persona || '';
      if (!has('--json')) {
        log(`🎭 역할 ${_normalizeRole(roleArg)} → ${target}${roleModel ? ' / ' + roleModel : ''}`);
        if (rolePersona) log(`   persona: ${rolePersona}`);
      }
    }
    if (!target) { fail('--to <agent_id> 또는 --role <role> 필요 (claude/codex/agy/grok/copilot) — 활성 전체 일괄은 `leerness agents multi`'); return process.exit(1); }
    const agentDef = _allProviders(root).find(a => a.id === target);
    if (!agentDef) { fail(`알 수 없는 agent: ${target}`); return process.exit(1); }
    // 1.9.36: 작업 유형 키워드 분석 → 최적 CLI 추천 (ready 체크 전에 출력 — 비활성이어도 추천)
    const recommendation = _recommendAgent(task);
    const recommended = recommendation.target;
    if (recommended && recommended !== target) {
      if (!has('--json')) log(`💡 추천: 이 작업은 ${recommended}가 더 적합 (${recommendation.reason})`);
    }
    const status = _checkAgent(agentDef);
    if (status.status !== 'ready') {
      if (roleArg && resolvedRole) {
        const result = roleResolutionResult || _roleResolution(roleArg, task);
        const audit = result.ok ? _ledgerEvent({
          event: 'routing.blocked', task: task.slice(0, 300), role: result.role, tier: result.cls.tier,
          requestedExecutor: { provider: target, model: roleModel || null },
          reason: status.status, decision: result.resolution.decision, executed: false,
        }) : { ok: false, error: result.error };
        if (has('--json')) {
          log(JSON.stringify({ ok: false, code: 'role_executor_unavailable', role: _normalizeRole(roleArg), target, status, resolution: result.ok ? result.resolution : null, auditWritten: audit.ok === true, auditError: audit.ok === true ? null : audit.error }, null, 2));
          process.exitCode = 1;
          return;
        }
        fail(`${target} 비활성 (${status.status}). 역할을 유지한 대체 선택지를 표시합니다.`);
        if (result.ok) _renderResolution(result, task);
        if (!audit.ok) warn(`실행 이력 기록 실패: ${audit.error}`);
        process.exitCode = 1;
        return;
      }
      failJson(has('--json'), 'agent_unavailable', `${target} 비활성 (${status.status}). 환경변수 ${agentDef.envFlag}=1 + CLI 설치 필요.`);
      return;
    }
    let selectedRoleOption = null;
    if (roleArg && roleResolutionResult) {
      const primary = roleResolutionResult.resolution.primary;
      const primarySelected = !!(primary
        && target === primary.provider
        && (!roleModel || roleModel === primary.model));
      const selection = selectFallbackOption(roleResolutionResult.resolution, {
        choice: primarySelected ? 'primary' : 'provider',
        provider: target,
        model: roleModel,
        approvedBy: arg('--approved-by', null),
      });
      if (!selection.ok) {
        const blocked = {
          ok: false,
          code: selection.code,
          error: selection.error,
          role: roleResolutionResult.role,
          target,
          model: roleModel || null,
          resolution: roleResolutionResult.resolution,
        };
        if (has('--json')) log(JSON.stringify(blocked, null, 2));
        else {
          fail(selection.error);
          _renderResolution(roleResolutionResult, task);
        }
        process.exitCode = 1;
        return;
      }
      selectedRoleOption = selection.option;
      if (selectedRoleOption.executor) {
        target = selectedRoleOption.executor.provider;
        roleModel = selectedRoleOption.executor.model || null;
      }
    }
    if (roleModel && !isValidModelIdentifier(roleModel)) {
      failJson(has('--json'), 'invalid_model_identifier', 'model is not a safe model identifier');
      return;
    }
    // 1.9.36: --write 시 파일 수정 가능 권장 플래그 자동 첨부, 미명시 시 read-only 안전 모드
    const writeMode = has('--write');
    const readOnly = has('--readonly') || !writeMode;
    // 실제 호출은 안 함 — 프롬프트만 생성 (사용자가 명시적으로 실행)
    if (!has('--json')) {
      log(`# leerness agents dispatch (1.9.36)`);
      log(`대상: ${target} (${agentDef.bin})`);
      log(`상태: 🟢 ready, 버전 ${status.version || '?'}`);
      log(`모드: ${writeMode ? '✏ write (파일 수정 가능)' : '🔒 read-only (분석 전용, 안전)'}`);
      log('');
      log(`## 실행 명령 (사용자가 복사해서 실행)`);
      if (roleModel) log(`# 🎭 모델: ${roleModel} (역할 기반 라우팅, 1.9.270)`);
      log('');
    }
    // 1.9.270: _dispatchCommand 로 통일 (roleModel 주입) — 명령 빌더 단일화
    // 1.35.6 (18th 위임실증): harness 계약 브리프 자동 접두 — codex 실측(0.141)에서 AGENTS.md 로드 시 준수는 확인됐으나,
    //   cwd 가 프로젝트 루트가 아니거나 AGENTS.md 미지원 CLI(aider/qwen 등)면 계약이 전달되지 않음 → 프롬프트 접두가 안전망. --raw 로 원문 위임.
    const dispatchTask = (has('--raw') || typeof _harnessBrief !== 'function') ? task : (_harnessBrief() + task);
    let preparedCommand;
    try { preparedCommand = _dispatchCommand(target, dispatchTask, writeMode, roleModel); }
    catch (error) { failJson(has('--json'), (error && error.code) || 'dispatch_command_invalid', (error && error.message) || 'dispatch command could not be prepared'); return; }
    const requestedExecutor = resolvedRole ? normalizeExecutorIdentity({
      provider: resolvedRole.provider,
      model: resolvedRole.model || null,
      modelFamily: resolvedRole.modelFamily || null,
      identitySource: 'role-config',
    }) : null;
    const actualExecutor = selectedRoleOption && selectedRoleOption.executor
      ? normalizeExecutorIdentity({ ...selectedRoleOption.executor, identitySource: 'role-resolution' })
      : normalizeExecutorIdentity({ provider: target, model: roleModel || null, identitySource: roleArg ? 'role-config' : 'user-declared' });
    const substituted = !!(requestedExecutor && (requestedExecutor.provider !== actualExecutor.provider || (requestedExecutor.model || null) !== (actualExecutor.model || null)));
    const audit = _ledgerEvent({
      event: 'dispatch.prepared',
      task: task.slice(0, 300),
      role: roleArg ? _normalizeRole(roleArg) : null,
      requestedExecutor,
      actualExecutor,
      substitution: { occurred: substituted, kind: substituted ? 'explicit-provider-or-model' : 'none' },
      mode: writeMode ? 'write' : 'read-only',
      commandPrepared: true,
      executed: false,
    });
    if (roleArg && !audit.ok) {
      failJson(has('--json'), audit.code || 'ledger_write_failed', `역할 실행 명령을 기록하지 못해 준비를 중단했습니다: ${audit.error}`);
      return;
    }
    if (has('--json')) {
      log(JSON.stringify({ ok: true, action: 'dispatch-prepared', role: roleArg ? _normalizeRole(roleArg) : null, target, model: roleModel || null, status, mode: writeMode ? 'write' : 'read-only', command: preparedCommand, executed: false, auditWritten: audit.ok === true, auditEventId: audit.ok === true ? audit.event.eventId : null, auditError: audit.ok === true ? null : audit.error }, null, 2));
      return;
    }
    log(preparedCommand);
    if (!audit.ok) warn(`실행 이력 기록 실패: ${audit.error}`);
    if (!has('--raw') && typeof _harnessBrief === 'function') log(`# ℹ harness 위임 브리프 자동 접두 (1.35.6) — 원문만 위임하려면 --raw`);
    if (target === 'claude' && writeMode) log(`# ⚠ --dangerously-skip-permissions: 도구 권한 자동 승인 (파일 수정 가능)`);
    if (target === 'codex') { log(`# ℹ codex는 PowerShell 경유 — POSIX /tmp 경로는 C:\\tmp\\로 해석됨`); log(`# ⚠ 비대화형 spawn 시 stdin 을 닫고 실행 — 열린 파이프면 codex 가 'Reading additional input from stdin...' EOF 대기로 hang (1.35.6 실측)`); if (writeMode) log(`# ⚠ --dangerously-bypass-approvals-and-sandbox: sandbox 우회`); }
    if (target === 'agy' && writeMode) log(`# ⚠ --yolo: 워크스페이스 파일 직접 수정 가능`);
    if (target === 'grok' && writeMode) log(`# ⚠ grok --yolo: 자동 승인 (배포판에 따라 플래그 상이 가능)`);
    // 1.9.266 (UR-0021 2단계): 대상 에이전트의 슬래시 명령 힌트 — sub-agent 작업 시 알맞은 슬래시 명령 참조
    try {
      const hint = _agentSlashHint(root, target);
      if (hint && hint.commands.length) {
        log('');
        log(`## 🤖 ${target} 슬래시 명령 (1.9.265, UR-0021)`);
        if (hint.invoke === 'subcommand') log(`  ※ 슬래시가 아닌 하위명령: ${hint.commands.map(c => c.cmd).join(' / ')}`);
        else log(`  세션 내 사용 가능: ${hint.commands.slice(0, 10).map(c => c.cmd).join('  ')}`);
        log(`  → 전체/기록: leerness slash-commands ${target} [--record]`);
      }
    } catch {}
    log('');
    log(`## 정책 (1.9.36)`);
    log(`  - leerness는 외부 CLI를 자동 호출하지 않음 (사용자 명시적 실행)`);
    log(`  - 메인 에이전트(Claude)가 위 명령을 보고 sub-agent로 spawn 가능`);
    log(`  - quota 체크: \`leerness agents quota\` (1.9.31+)`);
    log(`  - 동시 호출 시: \`leerness agents bench "<task>"\` (1.9.36)`);
    log('');
    log(`## 분배 시 안전 규칙 (1.9.35)`);
    log(`  - sub-agent 프롬프트에 "당신만 수정할 파일 경로"를 명시 (파일 경로 격리)`);
    log(`  - sub-agent에 "보고 시 \`stat <file>\` 또는 mtime 확인 결과 첨부" 요구 (자기 격리 검증)`);
    log(`  - 사양 사전 정의 (예: TICK_SPEC.md) → \`leerness contract verify\`로 사후 검증`);
    log(`  - 같은 파일 동시 쓰기는 last-writer-wins 위험 (1.9.34 검증)`);
    return;
  }

  if (sub === 'bench') {
    // 1.9.36: 같은 prompt를 ready CLI 모두에 동시 호출 + 시간/응답 길이/exit code 비교
    const task = _taskArg();
    if (!task) { fail('bench "<task>" 필요'); return process.exit(1); }
    const timeoutS = parseInt(arg('--timeout', '60'), 10);
    const writeMode = has('--write');
    // Disabled providers are not bench candidates. Filter before _checkAgent so a
    // bench that has no opted-in provider cannot execute installed third-party
    // CLIs merely to discover that they are disabled.
    const benchProviders = typeof _allProviders === 'function' ? _allProviders(root) : EXTERNAL_AGENTS;
    const ready = benchProviders.filter(a => process.env[a.envFlag] === '1')
                                .map(a => ({ agent: a, status: _checkAgent(a) }))
                                .filter(x => x.status.status === 'ready');
    if (!ready.length) {
      fail('ready CLI 없음 — leerness setup-agents 또는 .env에 LEERNESS_ENABLE_X=1 설정 필요');
      return process.exit(1);
    }
    const benchBatchAudit = _ledgerEvent({
      event: 'benchmark.batch.started',
      taskId: arg('--id', null),
      task: task.slice(0, 300),
      role: arg('--role', null) ? _normalizeRole(arg('--role', null)) : null,
      mode: writeMode ? 'write' : 'read-only',
      result: { summary: 'agents bench prepared', targets: ready.map(x => x.agent.id) },
      executed: false,
    });
    if (!benchBatchAudit.ok) {
      failJson(has('--json'), benchBatchAudit.code || 'ledger_write_failed', `외부 모델 호출 전 benchmark 원장을 기록하지 못해 중단했습니다: ${benchBatchAudit.error}`);
      return;
    }
    const benchBatchEventId = benchBatchAudit.event.eventId;
    const _recordBenchResult = (agent, entry, executed) => {
      const audit = _ledgerEvent({
        event: entry.ok ? 'benchmark.completed' : 'benchmark.failed',
        taskId: arg('--id', null),
        parentAttemptId: benchBatchEventId,
        task: task.slice(0, 300),
        role: arg('--role', null) ? _normalizeRole(arg('--role', null)) : null,
        actualExecutor: normalizeExecutorIdentity({ provider: agent.id, model: null, identitySource: 'cli-default-unverified' }),
        mode: writeMode ? 'write' : 'read-only',
        status: entry.ok ? 'completed' : 'failed',
        result: {
          summary: entry.ok ? 'agents bench completed' : `agents bench failed: ${entry.error || `exit ${entry.exit}`}`,
          evidence: `elapsedMs=${entry.elapsed}; responseChars=${String(entry.stdout || '').length}`,
        },
        executed: !!executed,
      });
      return { ...entry, model: null, identitySource: 'cli-default-unverified', auditWritten: audit.ok === true, auditEventId: audit.ok === true ? audit.event.eventId : null, auditError: audit.ok === true ? null : audit.error };
    };
    log(`# leerness agents bench (1.9.36)`);
    log(`task: ${task.slice(0, 80)}${task.length > 80 ? '…' : ''}`);
    log(`참여 CLI: ${ready.map(r => r.agent.id).join(', ')} (${ready.length}개)`);
    log(`타임아웃: ${timeoutS}s/CLI · 모드: ${writeMode ? 'write' : 'read-only'}`);
    log('');
    log('병렬 호출 중... (병렬 fork 후 wait)');
    log('');
    const results = [];
    const promises = ready.map(({ agent }) => new Promise((resolve) => {
      const t0 = Date.now();
      const spec = _benchLaunchSpec(agent, task, writeMode);
      if (spec.unsupported) {
        results.push(_recordBenchResult(agent, { id: agent.id, exit: null, elapsed: 0, stdout: '', stderrLen: 0, error: spec.unsupported, ok: false }, false));
        resolve();
        return;
      }
      // 1.35.6 (18th 위임실증): stdin 'ignore' — codex exec 는 stdin 이 열린 파이프면 'Reading additional input from stdin...' 에서
      //   EOF 를 무한 대기해 항상 타임아웃으로 왜곡됨(라이브 재현). 인자 모드 CLI 는 stdin 불필요 → 닫고 spawn.
      let r;
      try {
        r = _spawnPortable(spec.file, spec.args, { stdio: [spec.stdin, 'pipe', 'pipe'] });
      } catch (err) {
        results.push(_recordBenchResult(agent, { id: agent.id, exit: -1, elapsed: Date.now() - t0, stdout: '', stderrLen: 0, error: err.message, ok: false }, false));
        resolve();
        return;
      }
      let stdout = '', stderr = '';
      r.stdout.on('data', d => { stdout += d; });
      r.stderr.on('data', d => { stderr += d; });
      const timer = setTimeout(() => { r.kill(); }, timeoutS * 1000);
      let settled = false;
      const settle = (entry, executed) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // ChildProcess commonly emits `error` and then `close`. Create the
        // provenance event only after winning this settle boundary so one
        // invocation can never append two terminal events.
        results.push(_recordBenchResult(agent, entry, executed));
        resolve();
      };
      r.on('close', (code) => {
        const elapsed = Date.now() - t0;
        settle({
          id: agent.id, exit: code, elapsed,
          stdout: stdout.trim().split('\n').slice(-3).join('\n'),
          stderrLen: stderr.length,
          ok: code === 0 && stdout.trim().length > 0,
        }, true);
      });
      r.on('error', (err) => {
        settle({ id: agent.id, exit: -1, elapsed: Date.now() - t0, stdout: '', stderrLen: 0, error: err.message, ok: false }, false);
      });
    }));
    return Promise.all(promises).then(() => {
      const auditFailures = results.filter(r => !r.auditWritten);
      if (has('--json')) {
        log(JSON.stringify({ task, results, provenance: { batchEventId: benchBatchEventId, complete: auditFailures.length === 0, failedWrites: auditFailures.map(r => ({ agent: r.id, error: r.auditError })) } }, null, 2));
        if (auditFailures.length) process.exitCode = 1;
        return results;
      }
      log(`| CLI | 시간 | exit | 응답 길이 | 마지막 라인 |`);
      log(`|---|---:|---:|---:|---|`);
      // sort by elapsed
      results.sort((a, b) => a.elapsed - b.elapsed);
      for (const r of results) {
        const respLen = (r.stdout || '').length;
        const last = (r.stdout || '').split('\n').pop().slice(0, 50);
        log(`| ${r.id} | ${r.elapsed}ms | ${r.exit} | ${respLen} | ${last.replace(/\|/g, '\\|')} |`);
      }
      log('');
      const okCount = results.filter(r => r.ok).length;
      log(`결과: ${okCount}/${results.length} 성공`);
      const fastest = results.filter(r => r.ok).sort((a, b) => a.elapsed - b.elapsed)[0];
      if (fastest) log(`🏆 가장 빠름: ${fastest.id} (${fastest.elapsed}ms)`);
      if (auditFailures.length) {
        warn(`benchmark provenance 기록 실패 ${auditFailures.length}건 — 결과를 완료 증거로 사용하지 마세요.`);
        process.exitCode = 1;
      }
      return results;
    });
  }

  if (sub === 'quota') {
    const state = readAvailabilityObservations(root, 2000);
    if (state.ok === false || state.partial) {
      failJson(has('--json'), state.code || 'availability_history_partial', state.error || 'availability observation history is incomplete');
      return;
    }
    const results = [];
    for (const agent of _allProviders(root)) {
      const base = _checkAgent(agent);
      const observed = state.observations.filter(o => o.provider === agent.id).map(o => ({
        model: o.model || null,
        quota: o.quota || null,
        rateLimited: o.rateLimited === true,
        retryAfter: o.retryAfter || null,
        reason: o.reason || null,
        observedAt: o.observedAt || o.at || null,
        expiresAt: o.expiresAt || null,
      }));
      const quotaStates = new Set(observed.map(o => o.quota).filter(Boolean));
      const quota = quotaStates.size > 1 ? 'observed-mixed'
        : quotaStates.has('exhausted') ? 'observed-exhausted'
          : quotaStates.has('available') ? 'observed-available' : 'unknown';
      const out = {
        id: agent.id,
        bin: agent.bin,
        status: base.status,
        quota,
        verifiedRemainingAmount: null,
        observed,
        hint: base.status === 'not-installed' ? `${agent.bin} CLI 미설치`
          : base.status === 'disabled' ? `${agent.envFlag}=1 필요`
            : '안전한 공통 비대화형 잔여량 조회를 확인하지 못했습니다. provider 공식 사용량 화면을 확인하거나 실패를 agents availability mark로 기록하세요.',
        raw: null,
      };
      results.push(out);
    }
    const note = '설치·활성·일부 인증은 확인할 수 있지만, 모델 권한·남은 토큰/크레딧·과금 권한은 공통적으로 검증하지 않습니다. observed-*는 provider 수치 조회가 아니라 append-only 관측 기록입니다.';
    if (has('--json')) { log(JSON.stringify({ quota: results, note }, null, 2)); return; }
    log(`# 외부 AI CLI quota / availability`);
    log('');
    log(`| Agent | 상태 | quota | 관측 | 안내 |`);
    log(`|---|---|---|---:|---|`);
    for (const q of results) {
      const statusEmoji = q.status === 'ready' ? '🟢' : q.status === 'not-installed' ? '⚪' : q.status === 'disabled' ? '🟡' : '❓';
      log(`| ${q.id} | ${statusEmoji} ${q.status} | ${q.quota} | ${q.observed.length} | ${q.hint} |`);
    }
    log(`\n  ⓘ ${note}`);
    log(`  기록: leerness agents availability mark <provider> --model <id> --reason quota-exhausted --ttl-min <분>`);
    log(`  해제: leerness agents availability clear <provider> [--model <id>]`);
    return;
  }

  fail('사용법: leerness agents list|check|quota|availability|resolve|fallback|record|history|dispatch|multi|bench|recommend [--write] "<task>" [--to <id>]');
  return process.exit(1);
}

module.exports = { agentsCmd, _benchLaunchSpec, _parseAgentPositional, _findAgentAction };
