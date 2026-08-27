#!/usr/bin/env node
'use strict';

// T-0110: MCP lifecycle calls with an explicit sessionKey must participate in
// the same presence registry as direct CLI handoff/session-close calls. Generic
// internal subprocesses and unaddressed MCP calls must remain invisible.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const SP = require('../lib/session-presence');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const roots = [];
let total = 0;
let failed = 0;

const baseEnv = {
  ...process.env,
  LEERNESS_OFFLINE: '1',
  LEERNESS_NO_PROMPT: '1',
  LEERNESS_NO_AUTOCHCP: '1',
};
const controlledEnvKeys = new Set([
  'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
  'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'LEERNESS_SESSION_ID', 'CODEX_THREAD_ID',
  'LEERNESS_MCP_ADDRESS_EXPLICIT', 'LEERNESS_MCP_PROFILE', 'LEERNESS_NO_SESSION_PRESENCE',
  'LEERNESS_NO_SUGGEST', 'LEERNESS_NO_SKILL_SUGGEST', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG',
  'CI', 'GITHUB_ACTIONS', 'CLAUDECODE', 'CURSOR_AGENT', 'CODEX_MANAGED_BY_NPM',
].map(key => key.toLowerCase()));
// Windows에서 실제로 발생한 lower-case 상속 오염을 모든 OS에서 재현한다. scrub이 다시
// exact-case delete로 퇴행하면 첫 assertion이 실패하므로, 뒤의 "파일 없음" 검사가 거짓 통과하지 않는다.
baseEnv.leerness_no_session_presence = '1';
for (const key of Object.keys(baseEnv)) {
  if (controlledEnvKeys.has(key.toLowerCase())) delete baseEnv[key];
}
const baseEnvIsolated = !Object.keys(baseEnv).some(key => controlledEnvKeys.has(key.toLowerCase()));

function check(label, condition, detail = '') {
  total++;
  const ok = !!condition;
  process.stdout.write(`${ok ? '✓' : '✗'} ${label}${!ok && detail ? `\n    ${detail}` : ''}\n`);
  if (!ok) failed++;
}

function fresh(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `leerness-mcp-presence-${name}-`));
  roots.push(root);
  const result = cp.spawnSync(process.execPath, [CLI, 'init', root, '--yes', '--minimal'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    env: baseEnv,
  });
  if (result.status !== 0) throw new Error(`init failed (${result.status}): ${result.stderr || result.stdout}`);
  return root;
}

function rpcCall(name, args, id) {
  return JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
}

function runMcp(root, calls, extraEnv = {}) {
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'presence-probe', version: '1' },
    } }),
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    ...calls,
  ].join('\n') + '\n';
  const result = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve', '--profile', 'full'], {
    cwd: root,
    input,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...baseEnv, ...extraEnv },
  });
  const messages = String(result.stdout || '').split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  return { result, messages, byId: (id) => messages.find((message) => message.id === id) || null };
}

function sessionDir(root) {
  return path.join(root, '.leerness', 'cache', 'sessions');
}

function sessionFiles(root) {
  try { return fs.readdirSync(sessionDir(root)).filter((name) => /^[A-Za-z0-9_-]{8,64}\.json$/.test(name)); }
  catch { return []; }
}

function readSession(root, key) {
  try { return JSON.parse(fs.readFileSync(path.join(sessionDir(root), `${key}.json`), 'utf8')); }
  catch { return null; }
}

function runFiles(root) {
  try { return fs.readdirSync(path.join(root, '.leerness', 'runs')).filter((name) => /^run-\d+\.json$/.test(name)); }
  catch { return []; }
}

function rpcErrorCode(batch, id) {
  return batch.byId(id) && batch.byId(id).error && batch.byId(id).error.code;
}

try {
  check('probe environment cleanup is case-insensitive', baseEnvIsolated,
    JSON.stringify(Object.keys(baseEnv).filter(key => controlledEnvKeys.has(key.toLowerCase()))));
  const mixedCaseOptOut = SP.normalizePresenceEnv({
    LeErNeSs_No_SeSsIoN_PrEsEnCe: '1',
    LeErNeSs_SeSsIoN_Id: 'mixed-case-session',
  }, { caseInsensitive: true });
  check('presence evaluation preserves Windows case-insensitive env semantics',
    SP.suppressionReason(mixedCaseOptOut, true) === 'opt-out'
      && SP.deriveSessionKey(mixedCaseOptOut) === 'mixed-case-session',
    JSON.stringify(mixedCaseOptOut));

  const alpha = 'mcp-alpha-session';
  const bravo = 'mcp-bravo-session';
  const root = fresh('lifecycle');
  const batch = runMcp(root, [
    rpcCall('leerness_handoff', { path: root, sessionKey: alpha }, 2),
    rpcCall('leerness_handoff', { path: root, sessionKey: bravo }, 3),
    rpcCall('leerness_handoff', { path: root, sessionKey: alpha }, 4),
    rpcCall('leerness_session_close', { path: root, sessionKey: alpha }, 5),
  ]);
  check('MCP lifecycle batch exits successfully', batch.result.status === 0,
    `exit=${batch.result.status} stderr=${String(batch.result.stderr || '').slice(0, 300)}`);

  const listed = batch.byId(1);
  const tools = listed && listed.result && Array.isArray(listed.result.tools) ? listed.result.tools : [];
  for (const name of ['leerness_handoff', 'leerness_session_close']) {
    const tool = tools.find((entry) => entry.name === name);
    const hasSessionKey = !!(tool && tool.inputSchema && tool.inputSchema.properties
      && tool.inputSchema.properties.sessionKey);
    check(`${name} advertises sessionKey`, hasSessionKey);
  }

  const files = sessionFiles(root);
  check('addressed MCP handoffs register both sessions', files.includes(`${alpha}.json`) && files.includes(`${bravo}.json`),
    `files=${JSON.stringify(files)}`);
  const thirdText = batch.byId(4)?.result?.content?.[0]?.text || '';
  check('addressed MCP handoff sees the other session', /다른 세션 1/.test(thirdText), thirdText.slice(0, 300));
  const alphaRecord = readSession(root, alpha);
  const bravoRecord = readSession(root, bravo);
  check('MCP session_close closes only its addressed session',
    !!(alphaRecord && alphaRecord.closedAt) && !!(bravoRecord && !bravoRecord.closedAt),
    `alpha=${JSON.stringify(alphaRecord)} bravo=${JSON.stringify(bravoRecord)}`);

  // 외부 Codex P2: lifecycle이 아닌 도구에 숨은 sessionKey를 주면 marker가 agent-mode의
  // nested handoff까지 전파됐다. 광고하지 않은 주소 입력은 실행 전에 거절해야 한다.
  const unsupportedRoot = fresh('unsupported-address');
  const unsupported = runMcp(unsupportedRoot, [
    rpcCall('leerness_agent_mode', { path: unsupportedRoot, sub: 'start', sessionKey: 'mcp-hidden-address' }, 2),
  ]);
  check('non-addressable MCP tools reject hidden sessionKey without side effects',
    rpcErrorCode(unsupported, 2) === -32602 && sessionFiles(unsupportedRoot).length === 0,
    `reply=${JSON.stringify(unsupported.byId(2))} files=${JSON.stringify(sessionFiles(unsupportedRoot))}`);

  const anonymousRoot = fresh('anonymous');
  const anonymous = runMcp(anonymousRoot, [rpcCall('leerness_handoff', { path: anonymousRoot }, 2)]);
  check('unaddressed MCP handoff stays unregistered', anonymous.result.status === 0 && sessionFiles(anonymousRoot).length === 0,
    `exit=${anonymous.result.status} files=${JSON.stringify(sessionFiles(anonymousRoot))}`);

  const internalRoot = fresh('internal');
  const internal = cp.spawnSync(process.execPath, [CLI, 'handoff', internalRoot, '--compact'], {
    cwd: internalRoot,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...baseEnv, LEERNESS_INTERNAL: '1', LEERNESS_SESSION_ID: 'generic-internal-session' },
  });
  check('generic internal subprocess stays unregistered', internal.status === 0 && sessionFiles(internalRoot).length === 0,
    `exit=${internal.status} files=${JSON.stringify(sessionFiles(internalRoot))}`);

  const childRoot = fresh('child');
  const child = runMcp(childRoot, [
    rpcCall('leerness_handoff', { path: childRoot, sessionKey: 'mcp-child-addressed' }, 2),
  ], { CLAUDE_CODE_CHILD_SESSION: '1' });
  check('per-call MCP sessionKey survives inherited child marker',
    child.result.status === 0 && sessionFiles(childRoot).includes('mcp-child-addressed.json'),
    `exit=${child.result.status} files=${JSON.stringify(sessionFiles(childRoot))}`);

  // 공백이 있는 임시 경로에서도 NODE_OPTIONS preload가 한 토큰으로 전달되어야 한다.
  const suppressedRoot = fresh('hook ci suppression');
  const childEnvLog = path.join(suppressedRoot, 'child-env.ndjson');
  const noRecordEnvLog = path.join(suppressedRoot, 'no-record-child-env.ndjson');
  const preloadPath = path.join(suppressedRoot, 'capture-child-env.js');
  // NODE_OPTIONS 파서는 인용된 Windows 역슬래시도 escape로 소비한다. Node가 Windows에서도
  // 절대 경로로 이해하는 forward-slash 표기로 바꾼 뒤 한 인자로 묶는다.
  const preloadModule = preloadPath.replace(/\\/g, '/');
  const preloadOption = `--require="${preloadModule.replace(/"/g, '\\"')}"`;
  fs.writeFileSync(preloadPath, [
    "'use strict';",
    "const fs = require('fs');",
    "const row = { argv: process.argv.slice(1, 8), marker: process.env.LEERNESS_MCP_ADDRESS_EXPLICIT || null };",
    "process.on('exit', () => { try { fs.appendFileSync(process.env.LEERNESS_TEST_CHILD_ENV_LOG, JSON.stringify(row) + '\\n'); } catch {} });",
  ].join('\n') + '\n', 'utf8');
  const hookSuppressed = runMcp(suppressedRoot, [
    rpcCall('leerness_handoff', { path: suppressedRoot, sessionKey: 'mcp-hook-address' }, 2),
  ], { LEERNESS_HOOK: '1' });
  const hookClose = runMcp(suppressedRoot, [
    rpcCall('leerness_session_close', { path: suppressedRoot, sessionKey: 'mcp-hook-close' }, 2),
  ], {
    LEERNESS_HOOK: '1',
    NODE_OPTIONS: preloadOption,
    LEERNESS_TEST_CHILD_ENV_LOG: childEnvLog,
  });
  const ciSuppressed = runMcp(suppressedRoot, [
    rpcCall('leerness_handoff', { path: suppressedRoot, sessionKey: 'mcp-ci-addressed' }, 2),
  ], { CI: '1' });
  check('hook and CI suppression still win over lifecycle marker',
    hookSuppressed.result.status === 0 && ciSuppressed.result.status === 0 && sessionFiles(suppressedRoot).length === 0,
    `files=${JSON.stringify(sessionFiles(suppressedRoot))}`);
  let childEnvRows = [];
  try { childEnvRows = fs.readFileSync(childEnvLog, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); } catch {}
  const nestedRows = childEnvRows.filter(row => Array.isArray(row.argv)
    && (row.argv.includes('skill') || row.argv.includes('drift')));
  check('hook-suppressed MCP session_close strips marker before nested children',
    hookClose.result.status === 0 && nestedRows.length >= 2 && nestedRows.every(row => row.marker === null),
    `exit=${hookClose.result.status} rows=${JSON.stringify(childEnvRows)}`);

  const noRecordClose = cp.spawnSync(process.execPath,
    [CLI, 'session', 'close', suppressedRoot, '--no-record'], {
      cwd: suppressedRoot,
      encoding: 'utf8',
      timeout: 120000,
      env: {
        ...baseEnv,
        LEERNESS_INTERNAL: '1',
        LEERNESS_SESSION_ID: 'mcp-no-record-close',
        LEERNESS_MCP_ADDRESS_EXPLICIT: '1',
        NODE_OPTIONS: preloadOption,
        LEERNESS_TEST_CHILD_ENV_LOG: noRecordEnvLog,
      },
    });
  let noRecordRows = [];
  try { noRecordRows = fs.readFileSync(noRecordEnvLog, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); } catch {}
  const noRecordNestedRows = noRecordRows.filter(row => Array.isArray(row.argv)
    && (row.argv.includes('skill') || row.argv.includes('drift')));
  check('marker-bearing session_close --no-record strips marker before nested children',
    noRecordClose.status === 0 && noRecordNestedRows.length >= 2
      && noRecordNestedRows.every(row => row.marker === null) && sessionFiles(suppressedRoot).length === 0,
    `exit=${noRecordClose.status} stderr=${String(noRecordClose.stderr || '').slice(0, 300)} rows=${JSON.stringify(noRecordRows)}`);

  // T-0110의 옛 currentRunId 단일 슬롯 결함은 1.36.145 이후 이미 sessionKey별 run으로
  // 격리돼 있다. lifecycle presence 수정이 그 상태 귀속을 되돌리지 않는지 같은 MCP 경계에서 확인한다.
  const stateRoot = fresh('state-isolation');
  const state = runMcp(stateRoot, [
    rpcCall('leerness_state_start', { path: stateRoot, goal: 'alpha', sessionKey: alpha }, 2),
    rpcCall('leerness_state_start', { path: stateRoot, goal: 'bravo', sessionKey: bravo }, 3),
    rpcCall('leerness_state_record', { path: stateRoot, filesChanged: 'alpha.js', sessionKey: alpha }, 4),
    rpcCall('leerness_state_verify', { path: stateRoot, result: 'pass', sessionKey: bravo }, 5),
  ]);
  const resultJson = (id) => {
    try { return JSON.parse(state.byId(id).result.content[0].text); } catch { return null; }
  };
  const startedAlpha = resultJson(2);
  const startedBravo = resultJson(3);
  const recordedAlpha = resultJson(4);
  const verifiedBravo = resultJson(5);
  check('MCP state runs remain isolated by sessionKey',
    !!(startedAlpha && startedBravo && startedAlpha.started !== startedBravo.started
      && recordedAlpha && recordedAlpha.recorded === startedAlpha.started
      && verifiedBravo && verifiedBravo.verified === startedBravo.started
      && verifiedBravo.result === 'pass' && verifiedBravo.run
      && verifiedBravo.run.verification_result === 'pass'),
    `alpha=${JSON.stringify(startedAlpha)} bravo=${JSON.stringify(startedBravo)} record=${JSON.stringify(recordedAlpha)} verify=${JSON.stringify(verifiedBravo)}`);
  check('one session cannot borrow another session evidence',
    !!(verifiedBravo && verifiedBravo.completion_claim_allowed
      && verifiedBravo.completion_claim_allowed.allowed === false),
    JSON.stringify(verifiedBravo));
  check('state-only MCP calls do not create presence records', sessionFiles(stateRoot).length === 0,
    `files=${JSON.stringify(sessionFiles(stateRoot))}`);

  // 외부 Codex P1: 명시된 잘못된 값이 서버의 CODEX_THREAD_ID로 폴백하면 호출자는 주소가
  // 거절된 줄 모르고 공유 run 슬롯을 다시 쓴다. 세 형태 모두 -32602이며 파일을 만들지 않아야 한다.
  const invalidRoot = fresh('invalid-address');
  const beforeRuns = runFiles(invalidRoot);
  const invalid = runMcp(invalidRoot, [
    rpcCall('leerness_state_start', { path: invalidRoot, goal: 'bad-space', sessionKey: 'bad key' }, 2),
    rpcCall('leerness_state_start', { path: invalidRoot, goal: 'blank', sessionKey: '   ' }, 3),
    rpcCall('leerness_state_start', { path: invalidRoot, goal: 'reserved', sessionKey: 'unaddressed' }, 4),
    rpcCall('leerness_state_start', { path: invalidRoot, goal: 'trim-bypass', sessionKey: ' mcp-alpha-session ' }, 5),
  ], { CODEX_THREAD_ID: 'server-fallback-session' });
  check('invalid MCP sessionKey values are rejected before inherited fallback',
    [2, 3, 4, 5].every((id) => rpcErrorCode(invalid, id) === -32602)
      && JSON.stringify(runFiles(invalidRoot)) === JSON.stringify(beforeRuns)
      && sessionFiles(invalidRoot).length === 0,
    `replies=${JSON.stringify([invalid.byId(2), invalid.byId(3), invalid.byId(4), invalid.byId(5)])} runs=${JSON.stringify(runFiles(invalidRoot))}`);

  const malformedValues = [
    'not-a-date', '0', '1', '2024-02-30T00:00:00.000Z',
    '2024-02-30T00:00:00Z', ' 2024-01-01T00:00:00.000Z ',
  ];
  const malformed = Array.from({ length: 21 }, (_, i) => {
    const key = `broken${String(i).padStart(3, '0')}`;
    return { name: `${key}.json`, record: { sessionKey: key, hostId: 'same-host', closedAt: malformedValues[i % malformedValues.length] } };
  });
  malformed.push({ name: 'wrongpeer.json', record: { sessionKey: 'otherpeer', hostId: 'same-host', closedAt: 'not-a-date' } });
  const validClose = new Date(1700000000000).toISOString();
  check('only canonical real closedAt values are confirmed; malformed values stay unconfirmed',
    SP.selectPrunable(malformed, { selfKey: 'selfpeer', nowMs: Date.now() }).length === 0
      && malformed.every(entry => !SP.hasConfirmedClose(entry.record))
      && SP.countOtherSessions([malformed[0].record], 'selfpeer', 'same-host') === 1
      && SP.confirmedCloseMs({ closedAt: validClose }) === 1700000000000,
    JSON.stringify(SP.selectPrunable(malformed, { selfKey: 'selfpeer', nowMs: Date.now() })));

  // POSIX legacy case variants are logically collapsed by read-only sessions, then migrated on the
  // next canonical write. Windows cannot hold two case variants, so only the logical assertion applies.
  const legacyRoot = fresh('legacy-case');
  fs.mkdirSync(sessionDir(legacyRoot), { recursive: true });
  const legacyName = 'CaseGhost01';
  const foldedLegacy = legacyName.toLowerCase();
  const legacyPath = path.join(sessionDir(legacyRoot), `${legacyName}.json`);
  fs.writeFileSync(legacyPath, JSON.stringify({
    schemaVersion: 1, sessionKey: legacyName, openedAt: new Date().toISOString(),
    lastHandoffAt: new Date().toISOString(), closedAt: null,
  }, null, 2) + '\n', 'utf8');
  const caseSensitive = !fs.existsSync(path.join(sessionDir(legacyRoot), `${foldedLegacy}.json`));
  const listedLegacy = cp.spawnSync(process.execPath, [CLI, 'sessions', legacyRoot, '--json'], {
    cwd: legacyRoot, encoding: 'utf8', timeout: 120000,
    env: { ...baseEnv, LEERNESS_SESSION_ID: foldedLegacy },
  });
  let legacyJson = null;
  try { legacyJson = JSON.parse(listedLegacy.stdout); } catch {}
  const migratedLegacy = cp.spawnSync(process.execPath, [CLI, 'handoff', legacyRoot, '--compact'], {
    cwd: legacyRoot, encoding: 'utf8', timeout: 120000,
    env: { ...baseEnv, LEERNESS_SESSION_ID: foldedLegacy },
  });
  const migratedFiles = sessionFiles(legacyRoot);
  check('legacy mixed-case presence is one self record and migrates without a ghost',
    listedLegacy.status === 0 && legacyJson && legacyJson.total === 1 && legacyJson.selfRecordPresent === true
      && legacyJson.sessions[0].sessionKey === foldedLegacy && migratedLegacy.status === 0
      && (!caseSensitive || (migratedFiles.includes(`${foldedLegacy}.json`) && !migratedFiles.includes(`${legacyName}.json`))),
    `caseSensitive=${caseSensitive} listed=${JSON.stringify(legacyJson)} files=${JSON.stringify(migratedFiles)}`);

  // 대소문자 구분 저장소의 두 열린 legacy variant는 서로 다른 구버전 세션일 수 있다.
  // 자동 병합/삭제하지 않고 canonical record와 조회 표면에 충돌을 남긴다.
  const ambiguousRoot = fresh('legacy-case-conflict');
  fs.mkdirSync(sessionDir(ambiguousRoot), { recursive: true });
  const variantA = 'CaseTwin01';
  const variantB = 'CASETWIN01';
  const canonicalTwin = variantA.toLowerCase();
  const openRecord = (sessionKey) => ({
    schemaVersion: 1, sessionKey, openedAt: new Date().toISOString(),
    lastHandoffAt: new Date().toISOString(), closedAt: null,
  });
  fs.writeFileSync(path.join(sessionDir(ambiguousRoot), `${variantA}.json`),
    JSON.stringify(openRecord(variantA), null, 2) + '\n', 'utf8');
  const ambiguousCaseSensitive = !fs.existsSync(path.join(sessionDir(ambiguousRoot), `${canonicalTwin}.json`));
  const pureConflict = SP.caseVariantConflict([
    { name: `${variantA}.json`, record: openRecord(variantA) },
    { name: `${variantB}.json`, record: openRecord(variantB) },
  ]);
  let physicalConflictOk = true;
  let physicalDetail = { caseSensitive: ambiguousCaseSensitive };
  if (ambiguousCaseSensitive) {
    fs.writeFileSync(path.join(sessionDir(ambiguousRoot), `${variantB}.json`),
      JSON.stringify(openRecord(variantB), null, 2) + '\n', 'utf8');
    const wrote = cp.spawnSync(process.execPath, [CLI, 'handoff', ambiguousRoot, '--compact'], {
      cwd: ambiguousRoot, encoding: 'utf8', timeout: 120000,
      env: { ...baseEnv, LEERNESS_SESSION_ID: canonicalTwin },
    });
    const filesAfter = sessionFiles(ambiguousRoot);
    const canonicalRecord = readSession(ambiguousRoot, canonicalTwin);
    const listed = cp.spawnSync(process.execPath, [CLI, 'sessions', ambiguousRoot, '--json'], {
      cwd: ambiguousRoot, encoding: 'utf8', timeout: 120000,
      env: { ...baseEnv, LEERNESS_SESSION_ID: canonicalTwin },
    });
    let listedJson = null;
    try { listedJson = JSON.parse(listed.stdout); } catch {}
    const row = listedJson && listedJson.sessions && listedJson.sessions.find(item => item.sessionKey === canonicalTwin);
    physicalConflictOk = wrote.status === 0
      && filesAfter.includes(`${variantA}.json`) && filesAfter.includes(`${variantB}.json`)
      && canonicalRecord && canonicalRecord.caseVariantConflict && canonicalRecord.caseVariantConflict.count === 2
      && row && row.caseVariantConflict && row.caseVariantConflict.count === 3;
    physicalDetail = { caseSensitive: true, filesAfter, canonicalRecord, row };
  }
  check('ambiguous open case variants are preserved and explicitly flagged',
    pureConflict && pureConflict.count === 2 && physicalConflictOk,
    JSON.stringify(physicalDetail));
} catch (error) {
  check('probe completed without exception', false, error && error.stack ? error.stack : String(error));
} finally {
  for (const root of roots) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
}

process.stdout.write(`MCP presence probe: ${total - failed}/${total} passed\n`);
process.exitCode = failed ? 1 : 0;
