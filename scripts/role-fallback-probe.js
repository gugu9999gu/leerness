'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.join(__dirname, '..', 'bin', 'leerness.js');
const {
  validateRoleDefinitionShape,
  normalizeRoleDefinition,
  normalizeAvailability,
  normalizeExecutorIdentity,
  assessReviewerIndependence,
  resolveRoleFallback,
  selectFallbackOption,
  normalizeExecutionEvent,
  appendExecutionEvent,
  readExecutionEvents,
  appendAvailabilityObservation,
  appendAvailabilityClear,
  readAvailabilityObservations,
  availabilityExtrasForCandidate,
} = require('../lib/role-fallback');
const { _parseAgentPositional, _findAgentAction } = require('../lib/agents');
const { _executionProvenanceSummary } = require('../lib/session-close');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`✗ ${name}: ${error.stack || error.message}`);
  }
}

function run(args, opts = {}) {
  return cp.spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: opts.timeout || 30000,
    cwd: opts.cwd || path.dirname(CLI),
    env: {
      ...process.env,
      LEERNESS_NO_BANNER: '1',
      LEERNESS_NO_PROMPT: '1',
      LEERNESS_NO_DRIFT_CHECK: '1',
      LEERNESS_NO_STALE_CHECK: '1',
      ...(opts.env || {}),
    },
  });
}

function json(result) {
  try { return JSON.parse(String(result.stdout || '').trim()); }
  catch { return null; }
}

function provider(id, envFlag) {
  return { id, bin: process.execPath, envFlag, versionArgs: ['--version'], desc: id };
}

function checkFor(ready) {
  return (definition) => ({
    id: definition.id,
    status: ready.has(definition.id) ? 'ready' : 'disabled',
    installed: true,
    enabled: ready.has(definition.id),
    version: 'synthetic-1',
    auth: ready.has(definition.id) ? 'ok' : 'unknown',
  });
}

test('agent task parser skips option values by argv position and accepts flags before text', () => {
  assert.strictEqual(_parseAgentPositional(['fix auth', '--to', 'codex', '--model', 'm1']), 'fix auth');
  assert.strictEqual(_parseAgentPositional(['--to', 'codex', 'fix auth', '--role', 'coder']), 'fix auth');
  assert.strictEqual(_parseAgentPositional(['provider', 'fix auth', '--approved-by', 'owner'], 1), 'fix auth');
  assert.strictEqual(_parseAgentPositional(['--json', '--', '-literal task']), '-literal task');
});

test('agent action parser accepts flags before fallback/record action tokens', () => {
  assert.deepStrictEqual(_findAgentAction(['--role', 'coder', 'provider', 'task'], new Set(['provider'])), { action: 'provider', index: 2 });
  assert.deepStrictEqual(_findAgentAction(['--task', 'T-1', 'completed', '--summary', 'done'], new Set(['completed'])), { action: 'completed', index: 2 });
});

test('MCP availability authentication enum matches the internal ok/no/unknown contract', () => {
  const tool = require('../lib/mcp-tools').find(item => item.name === 'leerness_agents_availability');
  assert.ok(tool);
  assert.deepStrictEqual(tool.inputSchema.properties.authenticated.enum, ['ok', 'no', 'unknown']);
});

test('reviewer independence requires concrete model identities and known different model families', () => {
  assert.strictEqual(assessReviewerIndependence({ provider: 'gateway-a', modelFamily: 'claude' }, { provider: 'gateway-b', modelFamily: 'openai-gpt' }).reviewerIndependent, null);
  assert.strictEqual(assessReviewerIndependence({ provider: 'gateway-a', model: 'review-a', modelFamily: 'claude' }, { provider: 'gateway-b', model: 'worker-b', modelFamily: 'claude' }).reviewerIndependent, false);
  assert.strictEqual(assessReviewerIndependence({ provider: 'same', model: 'review-a', modelFamily: 'claude' }, { provider: 'same', model: 'worker-b', modelFamily: 'openai-gpt' }).reviewerIndependent, true);
  assert.strictEqual(normalizeExecutorIdentity({ model: 'claude-opus-4-7', modelFamily: 'openai-gpt' }).modelFamily, 'claude');
  assert.strictEqual(assessReviewerIndependence({ provider: 'a' }, { provider: 'b' }).reviewerIndependent, null);
});

test('stored role validation rejects malformed nested policy input instead of weakening it', () => {
  assert.strictEqual(validateRoleDefinitionShape('coder', { provider: 'codex', model: null }).ok, true);
  assert.strictEqual(validateRoleDefinitionShape('coder', { primary: { provider: 'codex' }, fallbackPolicy: 'strict' }).ok, true);
  assert.strictEqual(validateRoleDefinitionShape('coder', { primary: { provider: '' }, fallbackPolicy: 'strict' }).ok, false);
  assert.strictEqual(validateRoleDefinitionShape('coder', { primary: { provider: 'codex' }, candidates: { provider: 'backup' } }).ok, false);
  assert.strictEqual(validateRoleDefinitionShape('coder', { provider: 'codex', fallbackPolicy: 'strcit' }).ok, false);
  assert.strictEqual(validateRoleDefinitionShape('coder', { provider: 'codex', model: 'gpt-5.6;echo-injected' }).ok, false);
  assert.strictEqual(validateRoleDefinitionShape('reviewer', { provider: 'claude', model: 'claude-opus-4-7', modelFamily: 'openai-gpt' }).ok, false);
  assert.strictEqual(validateRoleDefinitionShape('coder', { provider: 'codex', primary: { provider: 'claude' } }).ok, false);
});

test('schema v1 role definition remains readable', () => {
  const r = normalizeRoleDefinition('coder', { provider: 'codex', model: 'm1', persona: 'worker' });
  assert.deepStrictEqual(r.primary, { provider: 'codex', model: 'm1', modelFamily: null, source: 'primary' });
  assert.strictEqual(r.fallbackPolicy, 'balanced');
  assert.strictEqual(r.persona, 'worker');
  assert.ok(r.requirements.coding);
});

test('schema v2 primary/candidates/policy are normalized and deduplicated', () => {
  const r = normalizeRoleDefinition('reviewer', {
    primary: { provider: 'claude', model: 'a' },
    candidates: [
      { provider: 'claude', model: 'a' },
      { provider: 'codex', model: 'b' },
      'grok:c',
    ],
    fallbackPolicy: 'strict',
  });
  assert.strictEqual(r.primary.provider, 'claude');
  assert.strictEqual(r.candidates.length, 2);
  assert.strictEqual(r.fallbackPolicy, 'strict');
  assert.ok(r.requirements.independence);
});

test('recorded authentication denial overrides a stale successful or unknown CLI auth probe', () => {
  const def = provider('codex', 'Codex');
  for (const probeAuth of ['ok', 'unknown']) {
    const availability = normalizeAvailability(def, { status: 'ready', installed: true, enabled: true, auth: probeAuth }, { authenticated: 'no' });
    assert.strictEqual(availability.authenticated, 'no');
    assert.strictEqual(availability.eligible, false);
    assert.ok(availability.blockingReasons.includes('not-authenticated'));
  }
});

test('catalog fallback keeps model null instead of inventing a static model ID from provider readiness', () => {
  const providers = [provider('dead', 'D'), provider('codex', 'C')];
  const r = resolveRoleFallback({
    role: 'coder',
    roleDefinition: { primary: { provider: 'dead', model: 'explicit-primary' }, fallbackPolicy: 'balanced' },
    providers,
    tier: 'normal',
    checkProvider: checkFor(new Set(['codex'])),
  });
  const catalog = r.options.find(o => o.executor && o.executor.provider === 'codex');
  assert.ok(catalog);
  assert.strictEqual(catalog.executor.model, null);
  assert.strictEqual(catalog.availability.modelEntitled, 'unknown');
  assert.strictEqual(r.decision.recommendedOptionId, catalog.id);
});

test('availability keeps installation, opt-in, auth, entitlement, quota and policy as separate axes', () => {
  const a = normalizeAvailability(provider('codex', 'X'), {
    status: 'ready', installed: true, enabled: true, auth: 'unknown', version: '1',
  });
  assert.strictEqual(a.eligible, true);
  assert.strictEqual(a.authenticated, 'unknown');
  assert.strictEqual(a.modelEntitled, 'unknown');
  assert.strictEqual(a.quota, 'unknown');
  assert.strictEqual(a.policyAllowed, 'unknown');
  assert.ok(a.warningReasons.includes('authentication-unverified'));

  const blocked = normalizeAvailability(provider('codex', 'X'), {
    status: 'ready', installed: true, enabled: true, auth: 'no',
  }, { quota: 'exhausted' });
  assert.strictEqual(blocked.eligible, false);
  assert.ok(blocked.blockingReasons.includes('not-authenticated'));
  assert.ok(blocked.blockingReasons.includes('quota-exhausted'));
});

test('append-only availability observations block quota and clear without mutating prior evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-availability-ledger-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    appendAvailabilityObservation(dir, { provider: 'codex', model: 'm1', reason: 'quota-exhausted', ttlMin: 10 });
    let state = readAvailabilityObservations(dir);
    assert.strictEqual(state.activeCount, 1);
    let extra = availabilityExtrasForCandidate(state, { provider: 'codex', model: 'm1' });
    assert.strictEqual(extra.quota, 'exhausted');
    assert.strictEqual(extra.observationReason, 'quota-exhausted');
    appendAvailabilityClear(dir, { provider: 'codex', model: 'm1' });
    state = readAvailabilityObservations(dir);
    assert.strictEqual(state.activeCount, 0);
    const history = readExecutionEvents(dir, 20);
    assert.ok(history.events.some(e => e.event === 'availability.observed'));
    assert.ok(history.events.some(e => e.event === 'availability.cleared'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('separate exact-model observations preserve independent axes and latest value per axis', () => {
  const state = {
    observations: [
      { provider: 'gateway', model: 'm1', policyAllowed: 'denied', reason: 'policy-denied', eventId: 'e1' },
      { provider: 'gateway', model: 'm1', quota: 'exhausted', reason: 'quota-exhausted', eventId: 'e2' },
      { provider: 'gateway', model: 'm1', quota: 'available', reason: 'quota-restored', eventId: 'e3' },
    ],
  };
  const extra = availabilityExtrasForCandidate(state, { provider: 'gateway', model: 'm1' });
  assert.strictEqual(extra.policyAllowed, 'denied');
  assert.strictEqual(extra.quota, 'available');
  assert.deepStrictEqual(extra.observationEventId, ['e1', 'e2', 'e3']);
});

test('provider-wide denial is retained when an exact-model observation supplies another axis', () => {
  const state = {
    observations: [
      { provider: 'gateway', model: null, policyAllowed: 'denied', reason: 'policy-denied', eventId: 'wide' },
      { provider: 'gateway', model: 'm1', quota: 'available', reason: 'quota-confirmed', eventId: 'exact' },
    ],
  };
  const extra = availabilityExtrasForCandidate(state, { provider: 'gateway', model: 'm1' });
  assert.strictEqual(extra.policyAllowed, 'denied');
  assert.strictEqual(extra.quota, 'available');
  assert.deepStrictEqual(extra.observationEventId, ['wide', 'exact']);
});

test('availability validation and append share one lock boundary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-availability-lock-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    const ledger = path.join(dir, '.leerness', 'execution-ledger.jsonl');
    const withLock = (_file, fn) => {
      fs.writeFileSync(ledger, '{ race-corrupt\n');
      return fn();
    };
    assert.throws(
      () => appendAvailabilityObservation(dir, { provider: 'codex', reason: 'quota-exhausted' }, { withLock }),
      error => error && error.code === 'ledger_invalid_lines',
    );
    assert.strictEqual(fs.readFileSync(ledger, 'utf8'), '{ race-corrupt\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('availability mark and clear refuse a corrupt ledger without changing its bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-availability-corrupt-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    const ledger = path.join(dir, '.leerness', 'execution-ledger.jsonl');
    fs.writeFileSync(ledger, '{ broken\n');
    const before = fs.readFileSync(ledger);
    assert.throws(() => appendAvailabilityObservation(dir, { provider: 'codex', reason: 'quota-exhausted' }), error => error && error.code === 'ledger_invalid_lines');
    assert.throws(() => appendAvailabilityClear(dir, { provider: 'codex' }), error => error && error.code === 'ledger_invalid_lines');
    assert.deepStrictEqual(fs.readFileSync(ledger), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('provider-only fallback rejects multiple selectable models and chooses a unique selectable model', () => {
  const providers = [provider('p', 'P')];
  const ready = resolveRoleFallback({
    role: 'coder',
    roleDefinition: { primary: { provider: 'p', model: 'm1' }, candidates: [{ provider: 'p', model: 'm2' }], fallbackPolicy: 'balanced' },
    providers,
    checkProvider: checkFor(new Set(['p'])),
  });
  let selected = selectFallbackOption(ready, { choice: 'provider', provider: 'p' });
  assert.strictEqual(selected.ok, false);
  assert.strictEqual(selected.code, 'fallback_choice_ambiguous');
  const blockedPrimary = resolveRoleFallback({
    role: 'coder',
    roleDefinition: { primary: { provider: 'p', model: 'm1' }, candidates: [{ provider: 'p', model: 'm2' }], fallbackPolicy: 'balanced' },
    providers,
    checkProvider: checkFor(new Set(['p'])),
    availabilityExtras: candidate => candidate.model === 'm1' ? { quota: 'exhausted' } : {},
  });
  selected = selectFallbackOption(blockedPrimary, { choice: 'provider', provider: 'p' });
  assert.strictEqual(selected.ok, true);
  assert.strictEqual(selected.option.executor.model, 'm2');
});

test('balanced policy recommends a ready compatible provider without auto-selecting it', () => {
  const providers = [provider('primary', 'P'), provider('backup', 'B')];
  const r = resolveRoleFallback({
    role: 'coder',
    roleDefinition: {
      primary: { provider: 'primary', model: 'p' },
      candidates: [{ provider: 'backup', model: 'b' }],
      fallbackPolicy: 'balanced',
    },
    providers,
    tier: 'normal',
    checkProvider: checkFor(new Set(['backup'])),
    sessionIdentity: { provider: 'host', model: 'session-model', identitySource: 'host-reported' },
  });
  assert.strictEqual(r.decision.primaryReady, false);
  assert.strictEqual(r.decision.autoSelected, false);
  assert.match(r.decision.recommendedOptionId, /^compatible-provider:/);
  const backup = r.options.find(o => o.executor && o.executor.provider === 'backup');
  assert.strictEqual(backup.selectable, true);
  assert.strictEqual(backup.requiresConfirmation, true);
});

test('strict policy exposes hold and blocks non-primary provider substitution', () => {
  const providers = [provider('primary', 'P'), provider('backup', 'B')];
  const r = resolveRoleFallback({
    role: 'coder',
    roleDefinition: {
      primary: { provider: 'primary' },
      candidates: [{ provider: 'backup' }],
      fallbackPolicy: 'strict',
    },
    providers,
    tier: 'normal',
    checkProvider: checkFor(new Set(['backup'])),
  });
  assert.strictEqual(r.decision.recommendedOptionId, 'hold');
  assert.strictEqual(r.options.some(o => o.kind === 'session-takeover'), false);
  assert.strictEqual(r.options.find(o => o.executor && o.executor.provider === 'backup').selectable, false);
});

test('incomplete current-session identity is visible but blocked and never recommended', () => {
  const r = resolveRoleFallback({
    role: 'coder',
    roleDefinition: { primary: { provider: 'primary' }, fallbackPolicy: 'continuity' },
    providers: [provider('primary', 'P')],
    tier: 'normal',
    checkProvider: checkFor(new Set()),
    sessionIdentity: { provider: null, model: null, identitySource: 'unknown' },
  });
  assert.strictEqual(r.options.find(o => o.id === 'session-takeover').selectable, false);
  assert.strictEqual(r.options.find(o => o.id === 'session-direct').selectable, false);
  assert.strictEqual(r.decision.recommendedOptionId, 'hold');
});

test('continuity policy can recommend current-session takeover when no provider candidate is ready', () => {
  const r = resolveRoleFallback({
    role: 'coder',
    roleDefinition: { primary: { provider: 'primary' }, fallbackPolicy: 'continuity' },
    providers: [provider('primary', 'P')],
    tier: 'normal',
    checkProvider: checkFor(new Set()),
    sessionIdentity: { provider: 'chat-host', model: 'model-x', identitySource: 'host-reported' },
  });
  assert.strictEqual(r.decision.recommendedOptionId, 'session-takeover');
  assert.strictEqual(r.options.find(o => o.id === 'session-takeover').contract.externalModelCalledByLeerness, false);
});

test('high-risk substitution requires explicit human approval and defaults to hold', () => {
  const providers = [provider('primary', 'P'), provider('backup', 'B')];
  const r = resolveRoleFallback({
    role: 'coder',
    roleDefinition: {
      primary: { provider: 'primary' },
      candidates: [{ provider: 'backup' }],
      fallbackPolicy: 'balanced',
    },
    providers,
    tier: 'high-risk',
    checkProvider: checkFor(new Set(['backup'])),
  });
  assert.strictEqual(r.decision.recommendedOptionId, 'hold');
  const denied = selectFallbackOption(r, { choice: 'provider', provider: 'backup' });
  assert.strictEqual(denied.code, 'human_approval_required');
  const approved = selectFallbackOption(r, { choice: 'provider', provider: 'backup', approvedBy: 'owner' });
  assert.strictEqual(approved.ok, true);
});

 test('session-direct can never satisfy high-risk independent review even with a different model family', () => {
  const r = resolveRoleFallback({
    role: 'reviewer',
    roleDefinition: { fallbackPolicy: 'continuity' },
    tier: 'high-risk',
    providers: [],
    implementerIdentity: { provider: 'a', model: 'claude-opus', modelFamily: 'claude', sessionId: 'implementation' },
    sessionIdentity: { provider: 'openai', model: 'gpt-5.6', modelFamily: 'openai-gpt', sessionId: 'review-host', identitySource: 'host-reported' },
  });
  const takeover = r.options.find(o => o.id === 'session-takeover');
  const direct = r.options.find(o => o.id === 'session-direct');
  assert.strictEqual(takeover.selectable, true);
  assert.strictEqual(takeover.reviewerIndependent, true);
  assert.strictEqual(direct.selectable, false);
  assert.strictEqual(direct.reviewerIndependent, false);
  assert.strictEqual(direct.independenceBasis, 'session-direct-self-review');
});

test('high-risk reviewer fallback is blocked until different model families are proven', () => {
  const providers = [provider('primary', 'P'), provider('backup', 'B')];
  let r = resolveRoleFallback({
    role: 'reviewer',
    roleDefinition: {
      primary: { provider: 'primary', model: 'claude-sonnet-4-7', modelFamily: 'claude' },
      candidates: [{ provider: 'backup', model: 'claude-opus-4-7', modelFamily: 'claude' }],
      fallbackPolicy: 'balanced',
    },
    providers,
    tier: 'high-risk',
    checkProvider: checkFor(new Set(['backup'])),
    implementerIdentity: { provider: 'worker', model: 'claude-sonnet-4-7', modelFamily: 'claude' },
  });
  const sameFamily = r.options.find(o => o.executor && o.executor.provider === 'backup');
  assert.strictEqual(sameFamily.selectable, false);
  assert.strictEqual(sameFamily.reviewerIndependence, 'not-independent');
  assert.strictEqual(r.decision.recommendedOptionId, 'hold');

  r = resolveRoleFallback({
    role: 'reviewer',
    roleDefinition: {
      primary: { provider: 'primary', model: 'claude-sonnet-4-7', modelFamily: 'claude' },
      candidates: [{ provider: 'backup', model: null, modelFamily: 'openai-gpt' }],
      fallbackPolicy: 'balanced',
    },
    providers,
    tier: 'high-risk',
    checkProvider: checkFor(new Set(['backup'])),
    implementerIdentity: { provider: 'worker', model: 'claude-sonnet-4-7', modelFamily: 'claude' },
  });
  const familyOnly = r.options.find(o => o.executor && o.executor.provider === 'backup');
  assert.strictEqual(familyOnly.selectable, false);
  assert.strictEqual(familyOnly.reviewerIndependence, 'unverified');

  r = resolveRoleFallback({
    role: 'reviewer',
    roleDefinition: {
      primary: { provider: 'primary', model: 'claude-sonnet-4-7', modelFamily: 'claude' },
      candidates: [{ provider: 'backup', model: 'gpt-5.6', modelFamily: 'openai-gpt' }],
      fallbackPolicy: 'balanced',
    },
    providers,
    tier: 'high-risk',
    checkProvider: checkFor(new Set(['backup'])),
    implementerIdentity: { provider: 'worker', model: 'claude-sonnet-4-7', modelFamily: 'claude' },
  });
  const differentFamily = r.options.find(o => o.executor && o.executor.provider === 'backup');
  assert.strictEqual(differentFamily.selectable, true);
  assert.strictEqual(differentFamily.reviewerIndependence, 'independent');
  const approved = selectFallbackOption(r, { choice: 'provider', provider: 'backup', approvedBy: 'owner' });
  assert.strictEqual(approved.ok, true);
});

test('all execution ledger appends reject corrupt history without changing its bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ledger-failclosed-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    const ledger = path.join(dir, '.leerness', 'execution-ledger.jsonl');
    fs.writeFileSync(ledger, '{ corrupt history\n', 'utf8');
    const before = fs.readFileSync(ledger);
    assert.throws(
      () => appendExecutionEvent(dir, { event: 'execution.completed', taskId: 'T-X', result: { summary: 'must not append' }, executed: true }, { withLock: (_file, fn) => fn() }),
      error => error && error.code === 'ledger_invalid_lines',
    );
    assert.deepStrictEqual(fs.readFileSync(ledger), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('execution ledger preserves its canonical envelope when extension fields exceed the object bound', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ledger-envelope-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    const extensions = {};
    for (let i = 0; i < 150; i++) extensions[`extension${i}`] = `value-${i}`;
    const written = appendExecutionEvent(dir, {
      ...extensions,
      event: 'execution.completed',
      taskId: 'T-ENVELOPE',
      requestedRole: 'coder',
      actualExecutor: { provider: 'synthetic', model: 'model-x' },
      result: { summary: 'bounded extension payload' },
      executed: true,
    });
    assert.strictEqual(written.event.schemaVersion, 1);
    assert.strictEqual(written.event.event, 'execution.completed');
    assert.ok(written.event.eventId);
    assert.ok(written.event.at);
    assert.strictEqual(written.event.taskId, 'T-ENVELOPE');
    assert.strictEqual(written.event.executed, true);
    const history = readExecutionEvents(dir, 10);
    assert.strictEqual(history.ok, true, history.error);
    assert.strictEqual(history.events.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('execution events expose canonical role, attempt, review and evidence fields', () => {
  const normalized = normalizeExecutionEvent({
    event: 'review.completed', taskId: 'T-1', role: 'reviewer', attemptId: 'review-2', parentAttemptId: 'impl-1',
    actualExecutor: { provider: 'reviewer', model: 'gpt-x', modelFamily: 'openai-gpt', sessionId: 'review-session' },
    review: { reviewerIndependent: true }, result: { summary: 'pass', evidence: 'reports/review.md' }, executed: true,
  });
  assert.strictEqual(normalized.requestedRole, 'reviewer');
  assert.strictEqual(normalized.sessionId, 'review-session');
  assert.strictEqual(normalized.reviewOfAttemptId, 'impl-1');
  assert.strictEqual(normalized.reviewerIndependent, true);
  assert.deepStrictEqual(normalized.evidenceRefs, ['reports/review.md']);
});

test('concurrent CLI provenance appends retain every unique attempt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ledger-concurrency-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    const inline = String.raw`
      const { spawn } = require('child_process');
      const count = 8;
      const jobs = [];
      for (let i = 0; i < count; i++) {
        jobs.push(new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [process.env.PROBE_CLI, 'agents', 'record', 'completed', 'concurrent-' + i,
            '--task', 'T-CONCURRENT', '--id', 'attempt-' + i, '--role', 'coder', '--to', 'synthetic',
            '--evidence', 'exit-0-' + i, '--path', process.env.PROBE_ROOT, '--json'],
            { stdio: 'ignore', env: { ...process.env, LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '1', LEERNESS_NO_STALE_CHECK: '1' } });
          child.on('error', reject);
          child.on('exit', code => code === 0 ? resolve() : reject(new Error('child exit ' + code)));
        }));
      }
      Promise.all(jobs).then(() => process.exit(0)).catch(error => { console.error(error); process.exit(2); });
    `;
    const result = cp.spawnSync(process.execPath, ['-e', inline], {
      cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 60000,
      env: { ...process.env, PROBE_CLI: CLI, PROBE_ROOT: dir },
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const history = readExecutionEvents(dir, 100, { preserveAll: true });
    assert.strictEqual(history.ok, true, history.error);
    const concurrent = history.events.filter(event => event.taskId === 'T-CONCURRENT');
    assert.strictEqual(concurrent.length, 8);
    assert.strictEqual(new Set(concurrent.map(event => event.attemptId)).size, 8);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('execution ledger masks credential-bearing keys without hiding audit metrics', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ledger-key-redaction-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    appendExecutionEvent(dir, {
      event: 'execution.completed',
      result: {
        summary: 'key redaction fixture',
        apiKey: 'opaque-api-value',
        cookie: { sid: 'opaque-cookie-value' },
        authorization: 'opaque-auth-value',
        credentials: { username: 'u', password: 'opaque-password-value' },
        refreshToken: 'opaque-refresh-value',
        accessTokenValue: 'opaque-access-token-value',
        clientSecretValue: 'opaque-client-secret-value',
        tokenCount: 17,
        tokenUsage: 23,
        tokenBudget: 100,
        secretScanStatus: 'clean',
        secretPolicy: 'no plaintext values',
      },
    });
    const history = readExecutionEvents(dir, 10);
    assert.strictEqual(history.ok, true);
    const event = history.events[history.events.length - 1];
    assert.strictEqual(event.result.apiKey, '***');
    assert.strictEqual(event.result.cookie, '***');
    assert.strictEqual(event.result.authorization, '***');
    assert.strictEqual(event.result.credentials, '***');
    assert.strictEqual(event.result.refreshToken, '***');
    assert.strictEqual(event.result.accessTokenValue, '***');
    assert.strictEqual(event.result.clientSecretValue, '***');
    assert.strictEqual(event.result.tokenCount, 17);
    assert.strictEqual(event.result.tokenUsage, 23);
    assert.strictEqual(event.result.tokenBudget, 100);
    assert.strictEqual(event.result.secretScanStatus, 'clean');
    assert.strictEqual(event.result.secretPolicy, 'no plaintext values');
    const raw = fs.readFileSync(path.join(dir, '.leerness', 'execution-ledger.jsonl'), 'utf8');
    assert.doesNotMatch(raw, /opaque-(?:api|cookie|auth|password|refresh|access-token|client-secret)-value/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('append-only ledger redacts secret-looking values and tolerates one corrupt line on read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-role-ledger-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    appendExecutionEvent(dir, { schemaVersion: 999, event: 'execution.completed', taskId: 'T-1', result: { summary: 'token=sk-live-LEAKME' } });
    appendExecutionEvent(dir, { event: 'review.completed', taskId: 'T-1', actualExecutor: { provider: 'reviewer-b' } });
    const file = path.join(dir, '.leerness', 'execution-ledger.jsonl');
    fs.appendFileSync(file, '{broken\n', 'utf8');
    const history = readExecutionEvents(dir, 20);
    assert.strictEqual(history.events.length, 2);
    assert.strictEqual(history.ok, false);
    assert.strictEqual(history.code, 'ledger_invalid_lines');
    assert.strictEqual(history.invalidLines, 1);
    assert.ok(history.events.every(e => e.schemaVersion === 1));
    assert.doesNotMatch(JSON.stringify(history.events), /sk-live-LEAKME/);
    assert.match(JSON.stringify(history.events), /token=\*\*\*/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('actual multi and bench paths write provider-level provenance once per settled call without inventing model IDs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-agent-exec-provenance-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    const inline = String.raw`
      const fs = require('fs');
      const path = require('path');
      const { PassThrough } = require('stream');
      const { EventEmitter } = require('events');
      const { agentsCmd } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'agents.js'))});
      const { readExecutionEvents } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'role-fallback.js'))});
      const root = process.env.PROBE_ROOT;
      const base = {
        VERSION: 'test',
        arg: (flag, fallback = null) => flag === '--timeout' ? '1' : flag === '--only' ? 'codex' : fallback,
        _agentSlashHint: () => null,
        _allProviders: () => [{ id: 'codex', bin: 'codex', envFlag: 'LEERNESS_ENABLE_CODEX', versionArgs: ['--version'] }],
        _checkAgent: (def) => ({ id: def.id, status: def.id === 'codex' ? 'ready' : 'disabled', installed: true, enabled: def.id === 'codex', version: 'synthetic', auth: 'unknown' }),
        _cliChat: async () => ({ ok: true, response: 'synthetic response' }),
        _dispatchCommand: () => 'synthetic',
        _harnessBrief: () => '',
        _loadEnvFile: () => {},
        _normalizeRole: x => x,
        _policyEnforce: () => ({ allowed: true, advisory: false }),
        _readUserProviders: () => [],
        _recommendAgent: () => ({ target: null, reason: '' }),
        _recordRun: () => null,
        _resolveRole: () => null,
        _withLock: (_file, fn) => fn(),
        lessonsPath: () => path.join(root, '.leerness', 'lessons.md'),
        taskLogPath: () => path.join(root, '.leerness', 'task-log.md'),
      };
      function fakeChild() {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => {};
        process.nextTick(() => {
          child.stdout.write('synthetic bench response');
          child.stdout.end();
          child.stderr.end();
          child.emit('close', 0);
        });
        return child;
      }
      function fakeErrorThenCloseChild() {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => {};
        process.nextTick(() => {
          child.emit('error', new Error('synthetic spawn failure'));
          child.stdout.end();
          child.stderr.end();
          child.emit('close', -1);
        });
        return child;
      }
      (async () => {
        await agentsCmd(root, 'multi', ['synthetic multi'], { ...base, has: flag => flag === '--execute' || flag === '--json' });
        await agentsCmd(root, 'multi', ['synthetic multi preflight'], {
          ...base,
          has: flag => flag === '--execute' || flag === '--json',
          _cliChat: async () => ({ ok: false, response: '', error: 'synthetic preflight rejection', executed: false }),
        });
        process.env.LEERNESS_ENABLE_CODEX = '1';
        await agentsCmd(root, 'bench', ['synthetic bench'], { ...base, has: flag => flag === '--json', _spawnPortable: fakeChild });
        await agentsCmd(root, 'bench', ['synthetic bench error'], { ...base, has: flag => flag === '--json', _spawnPortable: fakeErrorThenCloseChild });
        const history = readExecutionEvents(root, 100);
        const required = ['execution.batch.started', 'execution.completed', 'benchmark.batch.started', 'benchmark.completed'];
        if (!required.every(name => history.events.some(event => event.event === name))) process.exit(3);
        const executed = history.events.filter(event => event.event === 'execution.completed' || event.event === 'benchmark.completed');
        if (!executed.every(event => event.executed === true && event.actualExecutor && event.actualExecutor.provider === 'codex' && event.actualExecutor.model === null && event.actualExecutor.identitySource === 'cli-default-unverified')) process.exit(4);
        const preflight = history.events.filter(event => event.task === 'synthetic multi preflight' && event.event === 'execution.failed');
        if (preflight.length !== 1 || preflight[0].executed !== false) process.exit(7);
        const terminal = history.events.filter(event => event.task === 'synthetic bench error' && event.event === 'benchmark.failed');
        const batches = history.events.filter(event => event.task === 'synthetic bench error' && event.event === 'benchmark.batch.started');
        if (terminal.length !== 1 || batches.length !== 1 || terminal[0].executed !== false) process.exit(6);
      })().catch(error => { console.error(error); process.exit(5); });
    `;
    const result = cp.spawnSync(process.execPath, ['-e', inline], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PROBE_ROOT: dir, LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1' },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-role-fallback-cli-'));
try {
  fs.mkdirSync(path.join(fixture, '.leerness'), { recursive: true });
  fs.writeFileSync(path.join(fixture, '.leerness', 'providers.json'), JSON.stringify({
    schemaVersion: 1,
    providers: [
      { id: 'dead', bin: 'node', envFlag: 'LEERNESS_ENABLE_DEAD', versionArgs: ['--version'], desc: 'dead' },
      { id: 'live', bin: 'node', envFlag: 'LEERNESS_ENABLE_LIVE', versionArgs: ['--version'], desc: 'live' },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(fixture, '.leerness', 'agent-roles.json'), JSON.stringify({
    schemaVersion: 2,
    roles: {
      coder: {
        primary: { provider: 'dead', model: 'primary-model' },
        provider: 'dead', model: 'primary-model',
        candidates: [{ provider: 'live', model: 'backup-model' }],
        fallbackPolicy: 'balanced',
      },
    },
  }, null, 2));
  const env = { LEERNESS_ENABLE_DEAD: '0', LEERNESS_ENABLE_LIVE: '1' };

  test('CLI agents resolve returns structured choices and writes routing provenance', () => {
    const result = run(['agents', 'resolve', '작은 API 수정', '--role', 'coder', '--path', fixture, '--json'], { env });
    const out = json(result);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.ok(out && out.ok === true);
    assert.strictEqual(out.resolution.primary.provider, 'dead');
    assert.strictEqual(out.resolution.primary.availability.eligible, false);
    assert.match(out.resolution.decision.recommendedOptionId, /^compatible-provider:/);
    assert.strictEqual(out.auditWritten, true);
  });

  test('CLI observed quota exhaustion blocks the exact model until a clear event', () => {
    let result = run(['agents', 'availability', 'mark', 'live', '--model', 'backup-model', '--reason', 'quota-exhausted', '--ttl-min', '60', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(json(result).active.length, 1);
    result = run(['agents', 'resolve', '작은 API 수정', '--role', 'coder', '--path', fixture, '--json'], { env });
    let out = json(result);
    const live = out.resolution.options.find(o => o.executor && o.executor.provider === 'live' && o.executor.model === 'backup-model');
    assert.strictEqual(live.availability.quota, 'exhausted');
    assert.strictEqual(live.availability.eligible, false);
    assert.ok(live.availability.blockingReasons.includes('quota-exhausted'));
    assert.strictEqual(out.resolution.decision.recommendedOptionId, 'hold');
    result = run(['roles', 'verify', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    let verified = json(result).results.find(row => row.role === 'coder');
    assert.strictEqual(verified.fallbackReady, false);
    assert.strictEqual(verified.routable, false);
    result = run(['agents', 'availability', 'clear', 'live', '--model', 'backup-model', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    result = run(['agents', 'resolve', '작은 API 수정', '--role', 'coder', '--path', fixture, '--json'], { env });
    out = json(result);
    assert.match(out.resolution.decision.recommendedOptionId, /^compatible-provider:/);
    result = run(['roles', 'verify', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    verified = json(result).results.find(row => row.role === 'coder');
    assert.strictEqual(verified.fallbackReady, true);
    assert.strictEqual(verified.routable, true);
  });

  test('CLI quota output distinguishes observations from verified remaining amounts', () => {
    let result = run(['agents', 'availability', 'mark', 'live', '--model', 'backup-model', '--reason', 'quota-exhausted', '--ttl-min', '60', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    result = run(['agents', 'quota', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const out = json(result);
    const live = out.quota.find(row => row.id === 'live');
    assert.strictEqual(live.quota, 'observed-exhausted');
    assert.strictEqual(live.verifiedRemainingAmount, null);
    assert.match(out.note, /관측 기록/);
    result = run(['agents', 'availability', 'clear', 'live', '--model', 'backup-model', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  });

  test('CLI role dispatch fails honestly and includes fallback options when primary is unavailable', () => {
    const result = run(['agents', 'dispatch', '작은 API 수정', '--role', 'coder', '--path', fixture, '--json'], { env });
    const out = json(result);
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.ok(out && out.code === 'role_executor_unavailable');
    assert.ok(Array.isArray(out.resolution.options));
    assert.ok(out.resolution.options.some(o => o.executor && o.executor.provider === 'live' && o.selectable));
  });

  test('CLI role dispatch cannot bypass high-risk approval or reviewer-family independence with --to', () => {
    let result = run(['roles', 'set', 'reviewer', '--provider', 'dead', '--model', 'claude-sonnet-4-7', '--model-family', 'claude', '--candidate', 'live:gpt-5.6', '--candidate-family', 'openai-gpt', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    result = run(['agents', 'dispatch', '결제 검수', '--role', 'reviewer', '--to', 'live', '--model', 'gpt-5.6', '--tier', 'high-risk', '--agent-model', 'claude-sonnet-4-7', '--agent-model-family', 'claude', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'human_approval_required');

    result = run(['agents', 'dispatch', '결제 검수', '--role', 'reviewer', '--to', 'live', '--model', 'gpt-5.6', '--tier', 'high-risk', '--agent-model', 'gpt-5.7', '--agent-model-family', 'openai-gpt', '--approved-by', 'owner', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'fallback_choice_blocked');

    result = run(['agents', 'dispatch', '결제 검수', '--role', 'reviewer', '--to', 'live', '--model', 'gpt-5.6', '--tier', 'high-risk', '--agent-model', 'claude-sonnet-4-7', '--agent-model-family', 'claude', '--approved-by', 'owner', '--path', fixture, '--json'], { env });
    const out = json(result);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(out.action, 'dispatch-prepared');
    assert.strictEqual(out.executed, false);
  });

  test('CLI explicit --to cannot bypass an unconfigured role', () => {
    const result = run(['agents', 'dispatch', '작은 API 수정', '--role', 'architect', '--to', 'live', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'role_unconfigured');
  });

  test('CLI successful direct dispatch emits one valid JSON document and records prepared-not-executed provenance', () => {
    const result = run(['agents', 'dispatch', '작은 API 수정', '--to', 'live', '--model', 'backup-model', '--path', fixture, '--json'], { env });
    const out = json(result);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.ok(out && out.action === 'dispatch-prepared');
    assert.strictEqual(out.executed, false);
    assert.strictEqual(out.auditWritten, true);
    assert.ok(out.command);
  });

  test('CLI explicit provider fallback prepares but does not execute a command and records selection', () => {
    const result = run(['agents', 'fallback', 'provider', '작은 API 수정', '--role', 'coder', '--to', 'live', '--model', 'backup-model', '--path', fixture, '--json'], { env });
    const out = json(result);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.ok(out && out.ok === true);
    assert.strictEqual(out.executed, false);
    assert.strictEqual(out.selected.executor.provider, 'live');
    assert.ok(out.command);
    assert.ok(out.auditEventId);
  });

  test('CLI session fallback rejects incomplete identity and accepts explicit host identity', () => {
    let result = run(['agents', 'fallback', 'session', '작은 API 수정', '--role', 'coder', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'fallback_choice_blocked');
    result = run(['agents', 'fallback', '--role', 'coder', 'session', '작은 API 수정', '--session-provider', 'openai', '--session-model', 'gpt-5.6-pro', '--session-model-family', 'openai-gpt', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(json(result).selected.executor.provider, 'openai');
    assert.strictEqual(json(result).selected.executor.model, 'gpt-5.6-pro');
  });

  test('CLI hold and execution/review record surfaces are visible in history', () => {
    let result = run(['agents', 'fallback', 'hold', '작은 API 수정', '--role', 'coder', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    result = run(['agents', 'record', 'completed', '구현과 테스트 통과', '--task', 'T-9999', '--role', 'coder', '--to', 'live', '--model', 'backup-model', '--evidence', 'test exit 0', '--path', fixture, '--json'], {
      env: {
        ...env,
        LEERNESS_SESSION_ID: 'host-session',
        LEERNESS_SESSION_PROVIDER: 'host-provider',
        LEERNESS_SESSION_MODEL: 'host-model',
        LEERNESS_SESSION_MODEL_FAMILY: 'host-family',
        LEERNESS_SESSION_IDENTITY_SOURCE: 'host-reported',
      },
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(json(result).event.actualExecutor.identitySource, 'user-declared');
    assert.strictEqual(json(result).event.actualExecutor.provider, 'live');
    assert.strictEqual(json(result).event.actualExecutor.model, 'backup-model');
    assert.strictEqual(json(result).event.actualExecutor.modelFamily, null);
    assert.strictEqual(json(result).event.actualExecutor.sessionId, null);
    assert.strictEqual(json(result).event.requestedRole, 'coder');
    assert.deepStrictEqual(json(result).event.evidenceRefs, ['test exit 0']);
    result = run(['agents', 'record', '--task', 'T-9999', 'reviewed', '--summary', '독립 검수 통과', '--role', 'reviewer', '--to', 'reviewer-b', '--model', 'review-b-v1', '--model-family', 'family-b', '--agent', 'live', '--agent-model', 'worker-a-v1', '--agent-model-family', 'family-a', '--evidence', 'no P0/P1', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(json(result).event.reviewerIndependent, true);
    result = run(['agents', 'record', 'reviewed', '같은 세션 검수', '--task', 'T-9999', '--id', 'review-same', '--target', 'impl-same', '--role', 'reviewer', '--to', 'reviewer-c', '--model-family', 'family-b', '--session-id', 'shared-session', '--agent', 'live', '--agent-model-family', 'family-a', '--agent-session', 'shared-session', '--evidence', 'same session', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(json(result).event.reviewerIndependent, false);
    assert.strictEqual(json(result).event.review.independenceBasis, 'same-session');
    assert.strictEqual(json(result).event.reviewOfAttemptId, 'impl-same');
    result = run(['agents', 'record', 'completed', '--task', 'T-9998', '--summary', '플래그 뒤 요약', '--role', 'coder', '--to', 'live', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(json(result).event.taskId, 'T-9998');
    assert.strictEqual(json(result).event.result.summary, '플래그 뒤 요약');
    const historyResult = run(['agents', 'history', '--limit', '50', '--path', fixture, '--json'], { env });
    const history = json(historyResult);
    assert.strictEqual(historyResult.status, 0, historyResult.stderr || historyResult.stdout);
    assert.ok(history.events.some(e => e.event === 'task.held'));
    assert.ok(history.events.some(e => e.event === 'execution.completed' && e.taskId === 'T-9999'));
    assert.ok(history.events.some(e => e.event === 'review.completed' && e.review && e.review.reviewerIndependent === true && e.review.reviewerIndependence === 'independent'));
  });

  test('roles set without --model preserves provider-default uncertainty instead of inventing a catalog model', () => {
    const result = run(['roles', 'set', 'architect', '--provider', 'live', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const out = json(result);
    assert.strictEqual(out.model, null);
    assert.strictEqual(out.modelFamily, null);
    const stored = JSON.parse(fs.readFileSync(path.join(fixture, '.leerness', 'agent-roles.json'), 'utf8'));
    assert.strictEqual(stored.roles.architect.model, null);
    assert.strictEqual(stored.roles.architect.primary.model, null);
  });

  test('roles set writes schema v2 while retaining v1 top-level compatibility fields', () => {
    const result = run(['roles', 'set', 'debugger', '--provider', 'live', '--model', 'debug-model', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const store = JSON.parse(fs.readFileSync(path.join(fixture, '.leerness', 'agent-roles.json'), 'utf8'));
    assert.strictEqual(store.schemaVersion, 2);
    assert.strictEqual(store.roles.debugger.provider, 'live');
    assert.deepStrictEqual(store.roles.debugger.primary, { provider: 'live', model: 'debug-model', modelFamily: null });
    assert.strictEqual(store.roles.debugger.fallbackPolicy, 'balanced');
    assert.ok(store.roles.debugger.requirements.reproduction);
    assert.strictEqual(json(result).warning, null, 'registered custom provider must use its real definition');
  });

  test('roles set rejects unsafe or contradictory model identity without mutating the store', () => {
    const file = path.join(fixture, '.leerness', 'agent-roles.json');
    const before = fs.readFileSync(file);
    let result = run(['roles', 'set', 'debugger', '--provider', 'live', '--model', 'gpt-5.6;echo-injected', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'role_definition_invalid');
    assert.deepStrictEqual(fs.readFileSync(file), before);

    result = run(['roles', 'set', 'reviewer', '--provider', 'dead', '--model', 'claude-opus-4-7', '--model-family', 'openai-gpt', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'role_definition_invalid');
    assert.deepStrictEqual(fs.readFileSync(file), before);
  });

  test('roles set can configure ordered candidates, model families and fallback policy; verify reports fallback routability', () => {
    let result = run(['roles', 'set', 'reviewer', '--provider', 'dead', '--model', 'claude-sonnet-4-7', '--model-family', 'claude', '--policy', 'continuity', '--candidate', 'live:gpt-5.6', '--candidate-family', 'openai-gpt', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const configured = json(result);
    assert.strictEqual(configured.fallbackPolicy, 'continuity');
    assert.strictEqual(configured.candidates.length, 1);
    assert.strictEqual(configured.candidates[0].provider, 'live');
    assert.strictEqual(configured.candidates[0].modelFamily, 'openai-gpt');
    let store = JSON.parse(fs.readFileSync(path.join(fixture, '.leerness', 'agent-roles.json'), 'utf8'));
    assert.strictEqual(store.roles.reviewer.primary.modelFamily, 'claude');
    assert.strictEqual(store.roles.reviewer.candidates[0].model, 'gpt-5.6');
    result = run(['roles', 'verify', '--path', fixture, '--json'], { env });
    const verified = json(result);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const row = verified.results.find(r => r.role === 'reviewer');
    assert.strictEqual(row.primaryReady, false);
    assert.strictEqual(row.fallbackReady, true);
    assert.strictEqual(row.routable, true);
    result = run(['roles', 'set', 'reviewer', '--provider', 'dead', '--clear-candidates', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    store = JSON.parse(fs.readFileSync(path.join(fixture, '.leerness', 'agent-roles.json'), 'utf8'));
    assert.strictEqual(store.roles.reviewer.candidates.length, 0);
  });

  test('roles set removes a legacy string candidate without dropping the remaining ordered candidates', () => {
    const file = path.join(fixture, '.leerness', 'agent-roles.json');
    const store = JSON.parse(fs.readFileSync(file, 'utf8'));
    store.roles.coder.candidates = ['live:backup-model', 'dead:secondary-model'];
    fs.writeFileSync(file, JSON.stringify(store, null, 2) + '\n', 'utf8');
    const result = run(['roles', 'set', 'coder', '--provider', 'dead', '--model', 'primary-model', '--remove-candidate', 'live:backup-model', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const updated = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepStrictEqual(updated.roles.coder.candidates.map(item => `${item.provider}:${item.model || ''}`), ['dead:secondary-model']);
  });

  test('execution provenance summary is bounded and lifecycle-ready', () => {
    const summary = _executionProvenanceSummary(fixture, 50);
    assert.ok(summary.events.some(e => e.event === 'execution.completed'));
    assert.ok(summary.events.some(e => e.event === 'review.completed'));
    assert.ok(summary.markdownLines.some(line => /review\.completed/.test(line)));
    assert.strictEqual(summary.known, true);
  });

  test('MCP exposes and round-trips role fallback, availability, provenance and extended role configuration', () => {
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'role-fallback-probe', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'leerness_agents_resolve', arguments: { path: fixture, task: '작은 API 수정', role: 'coder', sessionKey: 'mcp-role-session' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'leerness_agents_availability', arguments: { path: fixture, action: 'list' } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'leerness_agents_quota', arguments: { path: fixture } } },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'leerness_agents_fallback', arguments: { path: fixture, action: 'hold', task: '작은 API 수정', role: 'coder', taskId: 'T-MCP-1' } } },
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'leerness_agents_record', arguments: { path: fixture, event: 'completed', summary: 'MCP implementation complete', taskId: 'T-MCP-1', role: 'coder', provider: 'live', model: 'backup-model', evidence: 'synthetic exit 0', sessionKey: 'mcp-role-session' } } },
      { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'leerness_agents_history', arguments: { path: fixture, limit: 100 } } },
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'leerness_roles', arguments: { path: fixture, sub: 'set', role: 'dispatcher', provider: 'dead', model: 'claude-dispatch', modelFamily: 'claude', candidates: ['live:gpt-dispatch', 'codex:gpt-5'], candidateFamilies: ['openai-gpt', 'openai-gpt'], fallbackPolicy: 'continuity' } } },
      { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'leerness_agents_list', arguments: { path: fixture } } },
      { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'leerness_agents_availability', arguments: { path: fixture, action: 'mark', provider: 'live', authenticated: 'ok', reason: 'credentials-confirmed', ttlMin: 5 } } },
    ];
    const result = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve', '--profile', 'full'], {
      cwd: path.join(__dirname, '..'),
      input: requests.map(request => JSON.stringify(request)).join('\n') + '\n',
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '1', LEERNESS_NO_STALE_CHECK: '1',
        ...env,
      },
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const messages = String(result.stdout || '').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const byId = id => messages.find(message => message.id === id);
    const payload = id => {
      const message = byId(id);
      assert.ok(message && message.result && message.result.content && message.result.content[0], `missing MCP payload id=${id}: ${JSON.stringify(message)}`);
      return JSON.parse(message.result.content[0].text);
    };
    const tools = byId(2).result.tools.map(tool => tool.name);
    for (const name of ['leerness_agents_resolve', 'leerness_agents_fallback', 'leerness_agents_availability', 'leerness_agents_record', 'leerness_agents_history', 'leerness_agents_quota']) assert.ok(tools.includes(name), name);
    assert.strictEqual(payload(3).resolution.role, 'coder');
    assert.strictEqual(payload(4).activeCount >= 0, true);
    const quota = payload(5);
    assert.ok(quota.quota.every(row => row.verifiedRemainingAmount === null));
    assert.strictEqual(payload(6).action, 'hold');
    assert.strictEqual(payload(7).event.taskId, 'T-MCP-1');
    const history = payload(8);
    assert.ok(history.events.some(event => event.event === 'task.held' && event.taskId === 'T-MCP-1'));
    assert.ok(history.events.some(event => event.event === 'execution.completed' && event.taskId === 'T-MCP-1'));
    assert.strictEqual(payload(9).fallbackPolicy, 'continuity');
    const listed = payload(10);
    assert.ok(listed.agents.some(agent => agent.id === 'dead'));
    assert.ok(listed.agents.some(agent => agent.id === 'live'));
    assert.strictEqual(payload(11).event.availability.authenticated, 'ok');
    const store = JSON.parse(fs.readFileSync(path.join(fixture, '.leerness', 'agent-roles.json'), 'utf8'));
    assert.strictEqual(store.roles.dispatcher.primary.modelFamily, 'claude');
    assert.strictEqual(store.roles.dispatcher.candidates.length, 2);
    assert.strictEqual(store.roles.dispatcher.candidates[0].modelFamily, 'openai-gpt');
    assert.strictEqual(store.roles.dispatcher.candidates[1].provider, 'codex');
    assert.strictEqual(store.roles.dispatcher.fallbackPolicy, 'continuity');
  });

  test('malformed nested role store is rejected and never rewritten by roles set', () => {
    const file = path.join(fixture, '.leerness', 'agent-roles.json');
    const valid = fs.readFileSync(file, 'utf8');
    const invalidStores = [
      { schemaVersion: 2, roles: { coder: { primary: { provider: 'dead' }, fallbackPolicy: 'strcit' } } },
      { schemaVersion: 2, roles: { coder: { primary: { provider: 'dead' }, candidates: { provider: 'live' }, fallbackPolicy: 'strict' } } },
      { schemaVersion: 2, roles: { coder: { provider: 'dead', primary: { provider: 'live' }, fallbackPolicy: 'strict' } } },
    ];
    try {
      for (const store of invalidStores) {
        const bytes = JSON.stringify(store, null, 2) + '\n';
        fs.writeFileSync(file, bytes, 'utf8');
        let result = run(['roles', 'list', '--path', fixture, '--json'], { env });
        assert.strictEqual(result.status, 1, result.stderr || result.stdout);
        assert.strictEqual(json(result).code, 'store_invalid');
        result = run(['roles', 'set', 'coder', '--provider', 'live', '--path', fixture, '--json'], { env });
        assert.strictEqual(result.status, 1, result.stderr || result.stdout);
        assert.strictEqual(json(result).code, 'store_invalid');
        assert.strictEqual(fs.readFileSync(file, 'utf8'), bytes);
      }
    } finally {
      fs.writeFileSync(file, valid, 'utf8');
    }
  });

  test('corrupt agent-roles store is reported and never overwritten by list, set, or role resolution', () => {
    const file = path.join(fixture, '.leerness', 'agent-roles.json');
    const corrupt = '{ broken role store\n';
    fs.writeFileSync(file, corrupt, 'utf8');
    let result = run(['roles', 'list', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'store_corrupt');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), corrupt);
    result = run(['roles', 'set', 'coder', '--provider', 'live', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'store_corrupt');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), corrupt);
    result = run(['agents', 'resolve', '작은 API 수정', '--role', 'coder', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'store_corrupt');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), corrupt);
  });


  test('history reports a non-regular ledger as a structured error instead of crashing', () => {
    const ledger = path.join(fixture, '.leerness', 'execution-ledger.jsonl');
    fs.rmSync(ledger, { recursive: true, force: true });
    fs.mkdirSync(ledger);
    const result = run(['agents', 'history', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'ledger_not_regular_file');
    assert.ok(fs.statSync(ledger).isDirectory());
  });
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log(`\nROLE_FALLBACK_PROBE ${passed}/${passed + failed}`);
if (failed) process.exitCode = 1;
