// lib/agents.js — agents 오케스트레이션 핸들러 (UR-0025/UR-0125 큰 핸들러 모듈화 9번째, 1.9.424)
//   bin/leerness.js 에서 agentsCmd(442줄) 분리. DI: harness 고유 의존(VERSION, has, arg, _agentSlashHint, _allProviders, _checkAgent, _cliChat, _dispatchCommand, _loadEnvFile, _normalizeRole, _policyEnforce, _readUserProviders, _recommendAgent, _recordRun, _resolveRole, _shellQuoteArg, lessonsPath, taskLogPath) 주입.
//   io 프리미티브는 ./io, EXTERNAL_AGENTS 는 ./agent-registry, cp/path/fs 빌트인.
//   시그니처 (root, sub, ...args) → (root, sub, args[], deps): rest 를 배열 인자로 받아 재귀에 deps 전달. 동작 무변경.
'use strict';
const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const { log, ok, warn, fail, failJson, today, now, absRoot, exists, read, readBuf, mkdirp, writeUtf8, append, rel } = require('./io');
const { EXTERNAL_AGENTS, AGENT_SLASH_COMMANDS } = require('./agent-registry');

function agentsCmd(root, sub, args = [], deps = {}) {
  const { VERSION, has, arg, _agentSlashHint, _allProviders, _checkAgent, _cliChat, _dispatchCommand, _loadEnvFile, _normalizeRole, _policyEnforce, _readUserProviders, _recommendAgent, _recordRun, _resolveRole, _shellQuoteArg, lessonsPath, taskLogPath } = deps;
  root = absRoot(root || process.cwd());
  // 1.9.435 (11th 외부평가 Codex P2, UR-0137): dispatch/multi task 파싱 — flag 값이 task 본문에 흡수되던 버그 수정.
  //   상위(bin)에서 args 는 '--to' flag 만 제거되고 값(codex)은 positional 로 남아 기존 filter 가 task 에 흡수시켰음.
  //   → flag 에서 break + lib 가 소비하는 값-flag(--to/--model/--role/--only) 값을 제외. 명시 task 는 --task 폴백.
  const _taskArg = () => {
    const consumed = new Set([arg('--to', null), arg('--model', null), arg('--role', null), arg('--only', null)].filter(Boolean));
    const p = [];
    for (const a of args) { if (a.startsWith('-')) break; if (consumed.has(a)) continue; p.push(a); }
    return p.join(' ').trim() || arg('--task', null);
  };
  // .env 자동 로드 (1.9.22)
  _loadEnvFile(root);
  _loadEnvFile(path.join(root, '..'));

  if (!sub || sub === 'list') {
    // 1.9.157: Provider Registry 통합 — 빌트인 5종 + 사용자 정의 provider 포함
    const providers = _allProviders(root);
    const userIds = new Set(_readUserProviders(root).map(u => u.id));
    const checks = providers.map(a => ({ ...(_checkAgent(a)), source: userIds.has(a.id) ? 'user' : 'builtin' }));
    if (has('--json')) { log(JSON.stringify({ agents: checks }, null, 2)); return; }
    log(`# 외부 AI CLI 오케스트레이션 (1.9.30)`);
    log('');
    log(`| Agent | source | env (${'env=1 활성'}) | 설치 | 버전 | 상태 |`);
    log(`|---|---|---|---|---|---|`);
    for (const c of checks) {
      const envMark = c.enabled ? '✓' : '✗';
      const instMark = c.installed ? '✓' : '✗';
      const statusEmoji = c.status === 'ready' ? '🟢 ready' : c.status === 'not-installed' ? '⚪ 미설치' : c.status === 'disabled' ? '🟡 비활성' : '❓';
      log(`| ${c.id} | ${c.source} | ${envMark} ${c.envFlag} | ${instMark} | ${c.version || '-'} | ${statusEmoji} |`);
    }
    const ready = checks.filter(c => c.status === 'ready');
    log('');
    log(`## 활성 (${ready.length}/${checks.length}): ${ready.map(c => c.id).join(', ') || '(없음)'}`);
    if (!ready.length) {
      log('');
      log(`💡 활성화 방법:`);
      log(`  1) CLI 설치 (예: \`npm i -g @openai/codex-cli\`, \`npm i -g @google/antigravity-cli\`)`);
      log(`  2) .env 또는 환경변수: LEERNESS_ENABLE_CODEX=1, LEERNESS_ENABLE_AGY=1`);
      log(`  3) \`leerness agents check\`로 재확인`);
      log(`  💡 1.9.157: 빌트인 외 CLI 추가: \`leerness provider add <id> --bin <cmd>\``);
    } else {
      log('');
      log(`💡 메인 에이전트가 sub-agent 분배 시 위 ${ready.length}개 CLI 활용 가능:`);
      log(`   \`leerness agents dispatch "<task>" --to <id>\` 로 프롬프트 전달`);
    }
    return;
  }

  if (sub === 'check') {
    // list의 alias, 단 명시적 재확인 (JSON 출력 기본)
    // 1.9.157: Provider Registry 통합
    const providers = _allProviders(root);
    const userIds = new Set(_readUserProviders(root).map(u => u.id));
    const checks = providers.map(a => ({ ...(_checkAgent(a)), source: userIds.has(a.id) ? 'user' : 'builtin' }));
    if (has('--json')) { log(JSON.stringify({ agents: checks, ready: checks.filter(c => c.status === 'ready').map(c => c.id) }, null, 2)); return; }
    return agentsCmd(root, 'list', [], deps); // 비-JSON은 list와 동일
  }

  // 1.9.152: agents multi — 1.9.151 install 복수 선택된 ready 에이전트들에 일괄 dispatch 명령 생성
  // 단일 task → 활성 N개 에이전트 동시 dispatch 명령들. 사용자가 한 번에 복사 실행하거나 메인 에이전트가 spawn.
  if (sub === 'multi') {
    const task = _taskArg();
    if (!task) { fail('multi "<task>" 또는 --task 필요'); return process.exit(1); }
    const onlyArg = arg('--only', null);  // 'claude,codex' 처럼 콤마 구분 — 활성 중에서 추가 필터
    const writeMode = has('--write');
    const execute = has('--execute');  // 1.9.156: 명령 출력 → 실제 spawn + consensus 합의
    const checks = EXTERNAL_AGENTS.map(a => ({ def: a, status: _checkAgent(a) }));
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
          const r = await _cliChat(root, def.id, task, { timeout });
          return {
            agent: def.id,
            elapsed: Date.now() - start,
            ok: r.ok,
            response: r.response || '',
            error: r.error || null,
            responseTokens: Math.ceil((r.response || '').length / 4)  // 대략 token 추정
          };
        }));
        const totalElapsed = Date.now() - t0;
        const ok = results.filter(r => r.ok);
        const failures = results.filter(r => !r.ok);
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
            failures
          }, null, 2));
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
        if (failures.length && !best) {
          process.exitCode = 1;
        }
      })();
    }
    if (has('--json')) {
      log(JSON.stringify({
        task, count: ready.length,
        agents: ready.map(x => ({ id: x.def.id, version: x.status.version })),
        commands: ready.map(x => _dispatchCommand(x.def.id, task, writeMode)),
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
      log(_dispatchCommand(def.id, task, writeMode));
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
    if (roleArg && !target) {
      const resolved = _resolveRole(root, roleArg);
      if (!resolved) { fail(`역할 미설정: ${_normalizeRole(roleArg)} — leerness roles set ${_normalizeRole(roleArg)} --provider <id> 또는 roles suggest --apply`); return process.exit(1); }
      target = resolved.provider;
      if (!roleModel) roleModel = resolved.model;
      rolePersona = resolved.persona || '';
      log(`🎭 역할 ${_normalizeRole(roleArg)} → ${target}${roleModel ? ' / ' + roleModel : ''}`);
      if (rolePersona) log(`   persona: ${rolePersona}`);
    }
    if (!target) { fail('--to <agent_id> 또는 --role <role> 필요 (claude/codex/agy/grok/copilot) — 활성 전체 일괄은 `leerness agents multi`'); return process.exit(1); }
    const agentDef = EXTERNAL_AGENTS.find(a => a.id === target);
    if (!agentDef) { fail(`알 수 없는 agent: ${target}`); return process.exit(1); }
    // 1.9.36: 작업 유형 키워드 분석 → 최적 CLI 추천 (ready 체크 전에 출력 — 비활성이어도 추천)
    const recommendation = _recommendAgent(task);
    const recommended = recommendation.target;
    if (recommended && recommended !== target) {
      log(`💡 추천: 이 작업은 ${recommended}가 더 적합 (${recommendation.reason})`);
    }
    const status = _checkAgent(agentDef);
    if (status.status !== 'ready') {
      fail(`${target} 비활성 (${status.status}). 환경변수 ${agentDef.envFlag}=1 + CLI 설치 필요.`);
      return process.exit(1);
    }
    // 1.9.36: --write 시 파일 수정 가능 권장 플래그 자동 첨부, 미명시 시 read-only 안전 모드
    const writeMode = has('--write');
    const readOnly = has('--readonly') || !writeMode;
    // 실제 호출은 안 함 — 프롬프트만 생성 (사용자가 명시적으로 실행)
    log(`# leerness agents dispatch (1.9.36)`);
    log(`대상: ${target} (${agentDef.bin})`);
    log(`상태: 🟢 ready, 버전 ${status.version || '?'}`);
    log(`모드: ${writeMode ? '✏ write (파일 수정 가능)' : '🔒 read-only (분석 전용, 안전)'}`);
    log('');
    log(`## 실행 명령 (사용자가 복사해서 실행)`);
    if (roleModel) log(`# 🎭 모델: ${roleModel} (역할 기반 라우팅, 1.9.270)`);
    log('');
    // 1.9.270: _dispatchCommand 로 통일 (roleModel 주입) — 명령 빌더 단일화
    log(_dispatchCommand(target, task, writeMode, roleModel));
    if (target === 'claude' && writeMode) log(`# ⚠ --dangerously-skip-permissions: 도구 권한 자동 승인 (파일 수정 가능)`);
    if (target === 'codex') { log(`# ℹ codex는 PowerShell 경유 — POSIX /tmp 경로는 C:\\tmp\\로 해석됨`); if (writeMode) log(`# ⚠ --dangerously-bypass-approvals-and-sandbox: sandbox 우회`); }
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
    const ready = EXTERNAL_AGENTS.map(a => ({ agent: a, status: _checkAgent(a) }))
                                  .filter(x => x.status.status === 'ready');
    if (!ready.length) {
      fail('ready CLI 없음 — leerness setup-agents 또는 .env에 LEERNESS_ENABLE_X=1 설정 필요');
      return process.exit(1);
    }
    log(`# leerness agents bench (1.9.36)`);
    log(`task: ${task.slice(0, 80)}${task.length > 80 ? '…' : ''}`);
    log(`참여 CLI: ${ready.map(r => r.agent.id).join(', ')} (${ready.length}개)`);
    log(`타임아웃: ${timeoutS}s/CLI · 모드: ${writeMode ? 'write' : 'read-only'}`);
    log('');
    log('병렬 호출 중... (병렬 fork 후 wait)');
    log('');
    const results = [];
    const promises = ready.map(({ agent, status }) => new Promise((resolve) => {
      const t0 = Date.now();
      let cmd, cmdArgs;
      // 1.9.352 (UR-0066 외부리뷰): shell:true 경로에 raw task 전달 시 셸 메타문자(& | $() 백틱) 주입 위험 → _shellQuoteArg 로 단일 토큰화 (안전 경로 _cliChat 와 일관)
      const qTask = _shellQuoteArg(task);
      if (agent.id === 'claude') {
        cmdArgs = writeMode ? ['--print', '--dangerously-skip-permissions', qTask] : ['--print', qTask];
        cmd = 'claude';
      } else if (agent.id === 'codex') {
        cmdArgs = writeMode
          ? ['exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', qTask]
          : ['exec', '--skip-git-repo-check', qTask];
        cmd = 'codex';
      } else if (agent.id === 'agy') {
        cmdArgs = writeMode ? ['-p', qTask, '--yolo'] : ['-p', qTask];
        cmd = 'agy';
      } else if (agent.id === 'copilot') {
        cmdArgs = ['copilot', 'suggest', qTask];
        cmd = 'gh';
      }
      const r = cp.spawn(cmd, cmdArgs, { shell: true });
      let stdout = '', stderr = '';
      r.stdout.on('data', d => { stdout += d; });
      r.stderr.on('data', d => { stderr += d; });
      const timer = setTimeout(() => { r.kill(); }, timeoutS * 1000);
      r.on('close', (code) => {
        clearTimeout(timer);
        const elapsed = Date.now() - t0;
        results.push({
          id: agent.id, exit: code, elapsed,
          stdout: stdout.trim().split('\n').slice(-3).join('\n'),
          stderrLen: stderr.length,
          ok: code === 0 && stdout.trim().length > 0
        });
        resolve();
      });
      r.on('error', (err) => {
        clearTimeout(timer);
        results.push({ id: agent.id, exit: -1, elapsed: Date.now() - t0, stdout: '', stderrLen: 0, error: err.message, ok: false });
        resolve();
      });
    }));
    return Promise.all(promises).then(() => {
      if (has('--json')) { log(JSON.stringify({ task, results }, null, 2)); return; }
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
    });
  }

  if (sub === 'quota') {
    // 1.9.31: 각 CLI 사용량/쿼터 추정 + provider 대시보드 링크
    const results = [];
    for (const agent of EXTERNAL_AGENTS) {
      const base = _checkAgent(agent);
      const out = { id: agent.id, bin: agent.bin, status: base.status, quota: null, hint: null, raw: null };
      if (base.status !== 'ready') {
        out.hint = base.status === 'not-installed' ? `${agent.bin} CLI 미설치` : base.status === 'disabled' ? `${agent.envFlag}=1 필요` : '알 수 없음';
        results.push(out); continue;
      }
      // CLI별 quota 탐지 시도
      try {
        if (agent.id === 'claude') {
          // claude는 /status 슬래시 (대화형)만 지원. 비대화형 추정 불가.
          out.quota = 'unknown';
          out.hint = '대화 내 `/status` 슬래시 또는 https://console.anthropic.com/settings/usage 확인';
        } else if (agent.id === 'codex') {
          // codex CLI: codex --help에 usage 명령 있는지 확인
          const r = cp.spawnSync(agent.bin, ['--help'], { encoding: 'utf8', timeout: 4000, shell: true });
          const help = (r.stdout || r.stderr || '').toLowerCase();
          if (help.includes('usage') || help.includes('quota')) {
            out.quota = 'cli-supported';
            out.hint = '`codex usage` 또는 `codex quota` 시도 가능';
          } else {
            out.quota = 'unknown';
            out.hint = 'https://platform.openai.com/account/usage 확인';
          }
          out.raw = help.slice(0, 200);
        } else if (agent.id === 'agy') {
          // agy CLI (Antigravity): 무료 티어는 분당 60req 제한, CLI 자체에선 노출 안 됨
          out.quota = 'rate-limited';
          out.hint = '무료 티어: 60 req/min, 1000 req/day · Antigravity 유료 플랜은 https://antigravity.google.com';
        } else if (agent.id === 'copilot') {
          // gh copilot은 GitHub Copilot 구독 (월 단위 quota 없음, individual/business 플랜)
          const r = cp.spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', timeout: 4000, shell: true });
          const authed = r.status === 0;
          out.quota = authed ? 'subscription' : 'not-authed';
          out.hint = authed ? 'Copilot 구독자 무제한 (월 플랜) · https://github.com/settings/copilot' : '`gh auth login` 필요';
        }
      } catch (e) {
        out.quota = 'error';
        out.hint = e.message;
      }
      results.push(out);
    }
    if (has('--json')) { log(JSON.stringify({ quota: results }, null, 2)); return; }
    log(`# 외부 AI CLI quota 추정 (1.9.31)`);
    log('');
    log(`| Agent | 상태 | quota | 안내 |`);
    log(`|---|---|---|---|`);
    for (const q of results) {
      const statusEmoji = q.status === 'ready' ? '🟢' : q.status === 'not-installed' ? '⚪' : q.status === 'disabled' ? '🟡' : '❓';
      log(`| ${q.id} | ${statusEmoji} ${q.status} | ${q.quota || '-'} | ${q.hint || '-'} |`);
    }
    log('');
    log(`## 주의`);
    log(`  - leerness는 CLI 사용량을 직접 추적하지 않음 (provider 대시보드 참조)`);
    log(`  - rate-limit/quota는 plan/티어에 따라 달라짐`);
    log(`  - sub-agent 분배 시 quota 여유 큰 CLI 우선 활용 권장`);
    return;
  }

  fail('사용법: leerness agents list|check|quota|dispatch|bench [--write] "<task>" [--to <id>]');
  return process.exit(1);
}

module.exports = { agentsCmd };
