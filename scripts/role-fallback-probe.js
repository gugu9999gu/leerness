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
  normalizeAvailabilityObservation,
  inferModelFamily,
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
  normalizeApprover,
} = require('../lib/role-fallback');
const { agentsCmd, _parseAgentPositional, _findAgentAction } = require('../lib/agents');
const { classify, applyDeclaredRiskFloor, plan: routingPlan } = require('../lib/routing');
const roleStore = require('../lib/role-store');
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

function seedRoleExecutionParent(root, taskId, attemptId, role = 'coder') {
  return appendExecutionEvent(root, {
    event: 'execution.started',
    taskId,
    attemptId,
    requestedRole: role,
    actualExecutor: { provider: 'live', identitySource: 'synthetic-test' },
    result: { summary: 'synthetic role execution parent' },
    executed: true,
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
  assert.strictEqual(assessReviewerIndependence({ provider: 'same', model: 'review-a', modelFamily: 'claude' }, { provider: 'same', model: 'worker-b', modelFamily: 'openai-gpt' }).reviewerIndependent, false);
  const sameProvider = assessReviewerIndependence({ provider: 'same', model: 'gpt-5.6' }, { provider: 'same', model: 'claude-sonnet-4-7' });
  assert.strictEqual(sameProvider.reviewerIndependent, false);
  assert.strictEqual(sameProvider.basis, 'same-provider');
  assert.strictEqual(assessReviewerIndependence({ provider: 'reviewer', model: 'gpt-5.6' }, { provider: 'implementer', model: 'claude-sonnet-4-7' }).reviewerIndependent, true);
  const providerMissing = assessReviewerIndependence({ model: 'gpt-5.6' }, { model: 'claude-sonnet-4-7' });
  assert.strictEqual(providerMissing.reviewerIndependent, null);
  assert.strictEqual(providerMissing.basis, 'provider-unverified');
  assert.strictEqual(normalizeExecutorIdentity({ model: 'claude-opus-4-7', modelFamily: 'openai-gpt' }).modelFamily, 'claude');
  assert.strictEqual(assessReviewerIndependence({ provider: 'a' }, { provider: 'b' }).reviewerIndependent, null);
  assert.strictEqual(inferModelFamily('claude-gpt-5'), null);
  assert.strictEqual(assessReviewerIndependence(
    { provider: 'gateway-a', model: 'claude-gpt-5' },
    { provider: 'gateway-b', model: 'gpt-5' },
  ).reviewerIndependent, null);
  const invisibleAlias = assessReviewerIndependence(
    { provider: 'gate\u200bway', model: 'gpt-5.6' },
    { provider: 'gateway', model: 'claude-sonnet-4-7' },
  );
  assert.strictEqual(invisibleAlias.reviewerIndependent, false);
  assert.strictEqual(invisibleAlias.basis, 'same-provider');
});

test('high-risk routing rejects role assignments combined from different store revisions', () => {
  let calls = 0;
  const mixed = routingPlan('.', { tier: 'high-risk' }, {
    _resolveRole: (_root, role) => {
      calls += 1;
      const secondSnapshot = calls === 4;
      return {
        role,
        provider: secondSnapshot ? 'claude-provider' : 'gpt-provider',
        model: secondSnapshot ? 'claude-sonnet-4-7' : 'gpt-5.6',
        modelFamily: secondSnapshot ? 'claude' : 'openai-gpt',
        storeRevision: secondSnapshot ? 'sha256:snapshot-b' : 'sha256:snapshot-a',
      };
    },
  });
  assert.strictEqual(mixed.roleStoreFailure.code, 'role_store_revision_mixed');
  assert.strictEqual(mixed.reviewerIndependent, null);
  assert.strictEqual(mixed.reviewerIndependence.basis, 'role-store-snapshot-invalid');
});

test('approval and risk normalization reject punctuation and Unicode invisible bypasses', () => {
  const nonIdentities = ['.', '!!!', '\u034f', '\u115f', '\u1160', '\u2063', '\u2800', '\u3164', '\uffa0'];
  for (const value of nonIdentities) assert.strictEqual(normalizeApprover(value), '');
  assert.strictEqual(normalizeApprover('Owner 7'), 'Owner 7');

  for (const invisible of ['\u034f', '\u115f', '\u1160', '\u2063', '\u2064', '\u2800', '\u3164', '\uffa0', '\u{1bca0}']) {
    const classified = classify(`pa${invisible}yment re${invisible}fund typo`);
    assert.strictEqual(classified.tier, 'high-risk', `risk bypass accepted for U+${invisible.codePointAt(0).toString(16)}`);
  }

  const downgrade = classify('payment refund typo', { tier: 'tiny' });
  assert.strictEqual(applyDeclaredRiskFloor(downgrade, { approvedBy: '.', reason: 'valid reason' }).tier, 'high-risk');
  assert.strictEqual(applyDeclaredRiskFloor(downgrade, { approvedBy: 'owner', reason: '!!!' }).tier, 'high-risk');
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

test('stored candidate fields cannot forge resolver provenance labels', () => {
  const r = normalizeRoleDefinition('coder', {
    primary: { provider: 'codex', model: 'gpt-5.6', source: 'catalog' },
    candidates: [{ provider: 'claude', model: 'claude-sonnet-4-7', source: 'primary' }],
  });
  assert.strictEqual(r.primary.source, 'primary');
  assert.strictEqual(r.candidates[0].source, 'configured');
});

test('authentication denial from either recorded or live evidence dominates stale positive or unknown evidence', () => {
  const def = provider('codex', 'Codex');
  for (const probeAuth of ['ok', 'unknown']) {
    const availability = normalizeAvailability(def, { status: 'ready', installed: true, enabled: true, auth: probeAuth }, { authenticated: 'no' });
    assert.strictEqual(availability.authenticated, 'no');
    assert.strictEqual(availability.eligible, false);
    assert.ok(availability.blockingReasons.includes('not-authenticated'));
  }
  for (const recordedAuth of ['ok', 'unknown']) {
    const availability = normalizeAvailability(def, { status: 'ready', installed: true, enabled: true, auth: 'no' }, { authenticated: recordedAuth });
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
  assert.strictEqual(a.rateLimited, null);
  assert.ok(a.warningReasons.includes('authentication-unverified'));

  const blocked = normalizeAvailability(provider('codex', 'X'), {
    status: 'ready', installed: true, enabled: true, auth: 'no',
  }, { quota: 'exhausted' });
  assert.strictEqual(blocked.eligible, false);
  assert.ok(blocked.blockingReasons.includes('not-authenticated'));
  assert.ok(blocked.blockingReasons.includes('quota-exhausted'));
});

test('availability preserves unknown/false rate-limit states and accepts safe token-like model IDs', () => {
  const unknown = availabilityExtrasForCandidate({
    observations: [{ provider: 'gateway', model: 'sk-aaaaaaaaaaa', quota: 'available', ledgerOrdinal: 1 }],
  }, { provider: 'gateway', model: 'sk-aaaaaaaaaaa' });
  const explicitFalse = availabilityExtrasForCandidate({
    observations: [{ provider: 'gateway', model: 'sk-aaaaaaaaaaa', rateLimited: false, ledgerOrdinal: 1 }],
  }, { provider: 'gateway', model: 'sk-aaaaaaaaaaa' });
  assert.strictEqual(unknown.rateLimited, null);
  assert.strictEqual(explicitFalse.rateLimited, false);
  assert.strictEqual(normalizeAvailability(provider('gateway', 'X'), {
    status: 'ready', installed: true, enabled: true, auth: 'ok',
  }, unknown).rateLimited, null);
  assert.strictEqual(normalizeAvailabilityObservation({
    provider: 'gateway', model: 'sk-aaaaaaaaaaa', quota: 'available',
  }).model, 'sk-aaaaaaaaaaa');
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

test('provider aliases share one availability identity and spoofed spellings poison the ledger closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-availability-alias-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    appendAvailabilityObservation(dir, { provider: 'LIVE', model: 'm1', reason: 'quota-exhausted' });
    let state = readAvailabilityObservations(dir);
    const extra = availabilityExtrasForCandidate(state, { provider: 'live', model: 'm1' });
    assert.strictEqual(state.ok, true, state.error);
    assert.strictEqual(state.observations[0].provider, 'live');
    assert.strictEqual(extra.quota, 'exhausted');

    const poisoned = {
      schemaVersion: 1,
      event: 'availability.observed',
      eventId: 'evt-provider-spoof',
      at: new Date().toISOString(),
      actualExecutor: { provider: 'live' },
      availability: { provider: 'li\u200bve', quota: 'available', observedAt: new Date().toISOString() },
    };
    fs.appendFileSync(path.join(dir, '.leerness', 'execution-ledger.jsonl'), JSON.stringify(poisoned) + '\n', 'utf8');
    state = readAvailabilityObservations(dir);
    assert.strictEqual(state.ok, false);
    assert.strictEqual(state.code, 'availability_events_invalid');
    assert.strictEqual(state.partial, true);
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

test('newer provider-wide policy denial overrides an older exact-model allow', () => {
  const state = {
    observations: [
      { provider: 'gateway', model: 'm1', policyAllowed: 'allowed', reason: 'old-exact-allow', eventId: 'exact-old', ledgerOrdinal: 1 },
      { provider: 'gateway', model: null, policyAllowed: 'denied', reason: 'new-wide-denial', eventId: 'wide-new', ledgerOrdinal: 2 },
    ],
  };
  const extra = availabilityExtrasForCandidate(state, { provider: 'gateway', model: 'm1' });
  assert.strictEqual(extra.policyAllowed, 'denied');
  assert.match(extra.observationReason, /new-wide-denial/);
  assert.deepStrictEqual(extra.observationEventId, ['exact-old', 'wide-new']);
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

test('semantically invalid availability events make routing state partial and block later appends', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-availability-semantic-corrupt-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    const ledger = path.join(dir, '.leerness', 'execution-ledger.jsonl');
    const malformed = {
      schemaVersion: 1,
      event: 'availability.observed',
      eventId: 'evt-invalid-availability',
      at: new Date().toISOString(),
      actualExecutor: { provider: 'codex' },
      availability: { provider: 'codex', quota: 'plenty' },
    };
    fs.writeFileSync(ledger, JSON.stringify(malformed) + '\n', 'utf8');
    const before = fs.readFileSync(ledger);
    const state = readAvailabilityObservations(dir, 2000);
    assert.strictEqual(state.ok, false);
    assert.strictEqual(state.partial, true);
    assert.strictEqual(state.code, 'availability_events_invalid');
    assert.strictEqual(state.invalidAvailabilityEvents, 1);
    assert.throws(() => appendAvailabilityClear(dir, { provider: 'codex' }), error => error && error.code === 'availability_events_invalid');
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
  for (const invisible of ['.', '!!!', '\u034f', '\u115f', '\u1160', '\u200b', '\u200d', '\u2060', '\u2063', '\u2800', '\u3164', '\uffa0']) {
    const bypass = selectFallbackOption(r, { choice: 'provider', provider: 'backup', approvedBy: invisible });
    assert.strictEqual(bypass.code, 'human_approval_required');
  }
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

test('high-risk reviewer fallback is blocked until distinct providers and model families are proven', () => {
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

test('malformed UTF-8 in the execution ledger fails availability reads and later appends closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ledger-utf8-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    appendAvailabilityObservation(dir, {
      provider: 'live', model: 'backup-model', policyAllowed: 'denied', reason: 'policy-denied',
    });
    const ledger = path.join(dir, '.leerness', 'execution-ledger.jsonl');
    const bytes = fs.readFileSync(ledger);
    const marker = Buffer.from('availability.observed', 'utf8');
    const markerAt = bytes.indexOf(marker);
    assert.ok(markerAt >= 0);
    bytes[markerAt + 5] = 0xff;
    fs.writeFileSync(ledger, bytes);
    const before = fs.readFileSync(ledger);
    const history = readExecutionEvents(dir, 20);
    const availability = readAvailabilityObservations(dir, 20);
    assert.strictEqual(history.ok, false);
    assert.strictEqual(history.code, 'ledger_invalid_utf8');
    assert.strictEqual(availability.ok, false);
    assert.strictEqual(availability.code, 'ledger_invalid_utf8');
    assert.deepStrictEqual(availability.observations, []);
    assert.throws(
      () => appendAvailabilityClear(dir, { provider: 'live', model: 'backup-model' }),
      error => error && error.code === 'ledger_invalid_utf8',
    );
    assert.deepStrictEqual(fs.readFileSync(ledger), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('linked execution-ledger parents are rejected before any external target is touched', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ledger-parent-link-'));
  const dir = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  const harness = path.join(dir, '.leerness');
  try {
    fs.mkdirSync(dir);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'unchanged\n', 'utf8');
    fs.symlinkSync(outside, harness, process.platform === 'win32' ? 'junction' : 'dir');
    const before = fs.readFileSync(path.join(outside, 'sentinel.txt'));
    const history = readExecutionEvents(dir, 20);
    assert.strictEqual(history.ok, false);
    assert.strictEqual(history.code, 'ledger_parent_linked');
    assert.throws(
      () => appendExecutionEvent(dir, { event: 'execution.started', taskId: 'T-LINK' }),
      error => error && error.code === 'ledger_parent_linked',
    );
    assert.strictEqual(fs.existsSync(path.join(outside, 'execution-ledger.jsonl')), false);
    assert.deepStrictEqual(fs.readFileSync(path.join(outside, 'sentinel.txt')), before);
  } finally {
    try { fs.rmSync(harness, { force: true }); } catch {}
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('execution-ledger reads and appends bind validation to the opened inode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ledger-inode-race-'));
  const ledger = path.join(dir, '.leerness', 'execution-ledger.jsonl');
  const moved = path.join(dir, 'moved-ledger.jsonl');
  try {
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    appendExecutionEvent(dir, { event: 'execution.started', taskId: 'T-INODE', attemptId: 'start-inode', executed: true });
    const replacement = JSON.stringify(normalizeExecutionEvent({
      schemaVersion: 1, event: 'execution.started', eventId: 'evt-replacement',
      at: new Date().toISOString(), taskId: 'T-OUTSIDE', attemptId: 'outside', executed: true,
    })) + '\n';
    const originalOpen = fs.openSync;
    let readSwapped = false;
    try {
      fs.openSync = function swappedRead(target, flags, ...rest) {
        if (!readSwapped && target === ledger && (flags === 'r' || (typeof flags === 'number' && (flags & fs.constants.O_WRONLY) === 0))) {
          readSwapped = true;
          fs.renameSync(ledger, moved);
          fs.writeFileSync(ledger, replacement, 'utf8');
        }
        return originalOpen.call(fs, target, flags, ...rest);
      };
      const history = readExecutionEvents(dir, 20);
      assert.strictEqual(readSwapped, true);
      assert.strictEqual(history.ok, false);
      assert.strictEqual(history.code, 'ledger_file_changed');
    } finally { fs.openSync = originalOpen; }

    fs.rmSync(ledger, { force: true });
    fs.renameSync(moved, ledger);
    const replacementBytes = Buffer.from(replacement);
    let writeSwapped = false;
    try {
      fs.openSync = function swappedWrite(target, flags, ...rest) {
        if (!writeSwapped && target === ledger && typeof flags === 'number' && (flags & fs.constants.O_WRONLY) !== 0) {
          writeSwapped = true;
          fs.renameSync(ledger, moved);
          fs.writeFileSync(ledger, replacementBytes);
        }
        return originalOpen.call(fs, target, flags, ...rest);
      };
      assert.throws(
        () => appendExecutionEvent(dir, { event: 'execution.started', taskId: 'T-INODE', attemptId: 'second', executed: true }),
        error => error && error.code === 'ledger_file_changed',
      );
      assert.strictEqual(writeSwapped, true);
      assert.deepStrictEqual(fs.readFileSync(ledger), replacementBytes);
    } finally { fs.openSync = originalOpen; }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dangling execution-ledger symlinks are rejected without creating their target', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ledger-dangling-'));
  const dir = path.join(base, 'project');
  const ledger = path.join(dir, '.leerness', 'execution-ledger.jsonl');
  const missingTarget = path.join(base, 'outside-missing.jsonl');
  try {
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    try { fs.symlinkSync(missingTarget, ledger, 'file'); }
    catch { return; }
    const history = readExecutionEvents(dir, 20);
    assert.strictEqual(history.ok, false);
    assert.strictEqual(history.code, 'ledger_not_regular_file');
    assert.throws(
      () => appendExecutionEvent(dir, { event: 'execution.started', taskId: 'T-DANGLING' }),
      error => error && error.code === 'ledger_not_regular_file',
    );
    assert.strictEqual(fs.existsSync(missingTarget), false);
  } finally {
    try { fs.rmSync(ledger, { force: true }); } catch {}
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('hard-linked execution ledgers fail closed for reads and appends without touching the peer file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ledger-hardlink-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    const peer = path.join(dir, 'peer-ledger.jsonl');
    const ledger = path.join(dir, '.leerness', 'execution-ledger.jsonl');
    fs.writeFileSync(peer, '', 'utf8');
    let linked = false;
    try { fs.linkSync(peer, ledger); linked = true; } catch {}
    if (!linked) return;
    const before = fs.readFileSync(peer);
    const history = readExecutionEvents(dir, 20);
    assert.strictEqual(history.ok, false);
    assert.strictEqual(history.code, 'ledger_hard_link_rejected');
    assert.throws(
      () => appendExecutionEvent(dir, { event: 'execution.completed', taskId: 'T-LINKED' }),
      error => error && error.code === 'ledger_hard_link_rejected',
    );
    assert.deepStrictEqual(fs.readFileSync(peer), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('initial execution-ledger installation survives prepared-alias cleanup failure without poisoning the live inode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ledger-create-cleanup-'));
  const harness = path.join(dir, '.leerness');
  const ledger = path.join(harness, 'execution-ledger.jsonl');
  const originalUnlink = fs.unlinkSync;
  const originalRm = fs.rmSync;
  let cleanupInjected = false;
  let appendError = null;
  const isCreateAlias = target => path.dirname(String(target)) === harness
    && path.basename(String(target)).startsWith('.execution-ledger-create-')
    && !String(target).includes('.detach-');
  try {
    fs.mkdirSync(harness, { recursive: true });
    fs.unlinkSync = function blockedLedgerAliasUnlink(target, ...args) {
      if (isCreateAlias(target)) {
        cleanupInjected = true;
        throw Object.assign(new Error('injected ledger-alias unlink failure'), { code: 'EACCES' });
      }
      return originalUnlink.call(fs, target, ...args);
    };
    fs.rmSync = function blockedLedgerAliasRm(target, ...args) {
      if (process.platform !== 'win32' && isCreateAlias(target)) {
        throw Object.assign(new Error('injected ledger-alias rm failure'), { code: 'EACCES' });
      }
      return originalRm.call(fs, target, ...args);
    };
    appendExecutionEvent(dir, {
      event: 'execution.started', taskId: 'T-CREATE-CLEANUP', attemptId: 'impl-create-cleanup', executed: true,
    });
  } catch (error) { appendError = error; }
  finally {
    fs.unlinkSync = originalUnlink;
    fs.rmSync = originalRm;
  }
  try {
    const history = readExecutionEvents(dir, 20);
    assert.strictEqual(cleanupInjected, true);
    assert.strictEqual(appendError, null, appendError && appendError.stack);
    assert.strictEqual(Number(fs.lstatSync(ledger).nlink), 1);
    assert.strictEqual(history.ok, true, history.error);
    assert.strictEqual(history.events.length, 1);
    assert.strictEqual(history.events[0].taskId, 'T-CREATE-CLEANUP');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('initial execution-ledger installation rolls back its canonical path when every alias detach method fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ledger-create-rollback-'));
  const harness = path.join(dir, '.leerness');
  const ledger = path.join(harness, 'execution-ledger.jsonl');
  const originalUnlink = fs.unlinkSync;
  const originalRm = fs.rmSync;
  const originalRename = fs.renameSync;
  let renameFailureInjected = false;
  let appendError = null;
  const isCreateAlias = target => path.dirname(String(target)) === harness
    && path.basename(String(target)).startsWith('.execution-ledger-create-')
    && !String(target).includes('.detach-');
  try {
    fs.mkdirSync(harness, { recursive: true });
    fs.unlinkSync = function blockedLedgerRollbackUnlink(target, ...args) {
      if (isCreateAlias(target)) throw Object.assign(new Error('injected ledger rollback unlink failure'), { code: 'EACCES' });
      return originalUnlink.call(fs, target, ...args);
    };
    fs.rmSync = function blockedLedgerRollbackRm(target, ...args) {
      if (isCreateAlias(target)) throw Object.assign(new Error('injected ledger rollback rm failure'), { code: 'EACCES' });
      return originalRm.call(fs, target, ...args);
    };
    fs.renameSync = function blockedLedgerRollbackRename(from, to, ...args) {
      if (String(from).includes('.detach-') && isCreateAlias(to)) {
        renameFailureInjected = true;
        throw Object.assign(new Error('injected ledger rollback rename failure'), { code: 'EACCES' });
      }
      return originalRename.call(fs, from, to, ...args);
    };
    appendExecutionEvent(dir, {
      event: 'execution.started', taskId: 'T-CREATE-ROLLBACK', attemptId: 'impl-create-rollback', executed: true,
    });
  } catch (error) { appendError = error; }
  finally {
    fs.unlinkSync = originalUnlink;
    fs.rmSync = originalRm;
    fs.renameSync = originalRename;
  }
  try {
    const artifacts = fs.readdirSync(harness)
      .map(name => path.join(harness, name))
      .filter(file => fs.lstatSync(file).isFile());
    assert.strictEqual(renameFailureInjected, true);
    assert.ok(appendError && appendError.code === 'E_HARDLINK_DETACH_FAILED', appendError && appendError.stack);
    assert.strictEqual(appendError.canonicalRolledBack, true);
    assert.strictEqual(fs.existsSync(ledger), false);
    assert.ok(artifacts.every(file => Number(fs.lstatSync(file).nlink) === 1));
    const history = readExecutionEvents(dir, 20);
    assert.strictEqual(history.ok, true);
    assert.deepStrictEqual(history.events, []);
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
      attemptId: 'impl-envelope',
      parentAttemptId: 'route-envelope',
      requestedRole: 'coder',
      actualExecutor: { provider: 'synthetic', model: 'model-x' },
      result: { summary: 'bounded extension payload' },
      evidenceRefs: ['envelope-evidence'],
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

test('token-shaped canonical provenance IDs remain readable after a successful append', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ledger-token-id-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    appendExecutionEvent(dir, {
      event: 'execution.completed', taskId: 'sk-abcdefghijk', attemptId: 'impl-token-id',
      actualExecutor: { provider: 'synthetic', model: 'sk-modeltoken' },
      result: { summary: 'token-shaped identifiers are public provenance IDs' },
      evidenceRefs: ['token-id-evidence'], executed: true,
    });
    const history = readExecutionEvents(dir, 10);
    assert.strictEqual(history.ok, true, history.error);
    assert.strictEqual(history.events[0].taskId, 'sk-abcdefghijk');
    assert.strictEqual(history.events[0].actualExecutor.model, 'sk-modeltoken');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('credential-shaped model values are rejected before ledger or availability persistence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ledger-sensitive-model-'));
  const sensitiveModel = `sk-proj-${'A'.repeat(48)}`;
  const fullwidthSensitiveModel = `ｓｋ－ｐｒｏｊ－${'Ａ'.repeat(48)}`;
  const sensitiveProvider = `sk-proj-${'B'.repeat(48)}`;
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    assert.throws(
      () => appendExecutionEvent(dir, {
        event: 'execution.completed', taskId: 'T-SENSITIVE', attemptId: 'impl-sensitive',
        actualExecutor: { provider: 'synthetic', model: sensitiveModel },
        evidenceRefs: ['evidence'], executed: true,
      }),
      error => error && error.code === 'ledger_sensitive_identifier',
    );
    assert.throws(
      () => normalizeAvailabilityObservation({ provider: 'synthetic', model: sensitiveModel, quota: 'available' }),
      error => error && error.code === 'availability_sensitive_model',
    );
    assert.throws(
      () => appendExecutionEvent(dir, {
        event: 'execution.completed', taskId: 'T-FULLWIDTH-SENSITIVE', attemptId: 'impl-fullwidth-sensitive',
        actualExecutor: { provider: 'synthetic', model: fullwidthSensitiveModel },
        evidenceRefs: ['evidence'], executed: true,
      }),
      error => error && error.code === 'ledger_sensitive_identifier',
    );
    assert.throws(
      () => normalizeAvailabilityObservation({ provider: 'synthetic', model: fullwidthSensitiveModel, quota: 'available' }),
      error => error && error.code === 'availability_sensitive_model',
    );
    assert.throws(
      () => appendExecutionEvent(dir, {
        event: 'execution.completed', taskId: 'T-SENSITIVE-PROVIDER', attemptId: 'impl-sensitive-provider',
        actualExecutor: { provider: sensitiveProvider, model: 'model-x' },
        evidenceRefs: ['evidence'], executed: true,
      }),
      error => error && error.code === 'ledger_sensitive_identifier',
    );
    assert.throws(
      () => normalizeAvailabilityObservation({ provider: sensitiveProvider, model: 'model-x', quota: 'available' }),
      error => error && error.code === 'availability_sensitive_provider',
    );
    assert.strictEqual(fs.existsSync(path.join(dir, '.leerness', 'execution-ledger.jsonl')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('incomplete terminal rows fail both append-time and stored-history validation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ledger-terminal-shape-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    assert.throws(
      () => appendExecutionEvent(dir, {
        event: 'execution.completed', taskId: 'T-INCOMPLETE', attemptId: 'impl-incomplete',
        actualExecutor: { provider: 'synthetic' }, executed: true,
      }),
      error => error && error.code === 'ledger_terminal_incomplete',
    );
    const ledger = path.join(dir, '.leerness', 'execution-ledger.jsonl');
    fs.writeFileSync(ledger, JSON.stringify({
      schemaVersion: 1, event: 'execution.completed', eventId: 'evt-incomplete',
      at: new Date().toISOString(), taskId: 'T-INCOMPLETE', attemptId: 'impl-incomplete',
      actualExecutor: { provider: 'synthetic' }, evidenceRefs: [], executed: true,
    }) + '\n');
    const history = readExecutionEvents(dir, 10);
    assert.strictEqual(history.ok, false);
    assert.strictEqual(history.invalidLines, 1);
    assert.deepStrictEqual(history.events, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('terminal execution rows require executed=true at append and read time', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ledger-executed-false-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    const contradictory = {
      event: 'execution.completed', taskId: 'T-FALSE', attemptId: 'impl-false',
      actualExecutor: { provider: 'synthetic' }, evidenceRefs: ['evidence'], executed: false,
    };
    assert.throws(() => appendExecutionEvent(dir, contradictory), error => error && error.code === 'ledger_terminal_incomplete');
    const ledger = path.join(dir, '.leerness', 'execution-ledger.jsonl');
    fs.writeFileSync(ledger, JSON.stringify({
      ...normalizeExecutionEvent({ ...contradictory, eventId: 'evt-false', at: new Date().toISOString() }),
    }) + '\n');
    const history = readExecutionEvents(dir, 10);
    assert.strictEqual(history.ok, false);
    assert.strictEqual(history.invalidLines, 1);
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
    for (let i = 0; i < 8; i++) seedRoleExecutionParent(dir, 'T-CONCURRENT', `selection-${i}`);
    const inline = String.raw`
      const { spawn } = require('child_process');
      const count = 8;
      const jobs = [];
      for (let i = 0; i < count; i++) {
        jobs.push(new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [process.env.PROBE_CLI, 'agents', 'record', 'completed', 'concurrent-' + i,
            '--task', 'T-CONCURRENT', '--id', 'attempt-' + i, '--role', 'coder', '--to', 'live',
            '--target', 'selection-' + i, '--evidence', 'exit-0-' + i, '--path', process.env.PROBE_ROOT, '--json'],
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
    const concurrent = history.events.filter(event => event.taskId === 'T-CONCURRENT' && event.event === 'execution.completed');
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
    const fullwidthApiKey = '\uff41\uff50\uff49\uff2b\uff45\uff59';
    const fullwidthPassword = '\uff50\uff41\uff53\uff53\uff57\uff4f\uff52\uff44';
    appendExecutionEvent(dir, {
      event: 'execution.completed',
      taskId: 'T-KEY-REDACTION',
      attemptId: 'impl-key-redaction',
      actualExecutor: { provider: 'synthetic' },
      evidenceRefs: ['key-redaction-evidence'],
      executed: true,
      result: {
        summary: 'key redaction fixture',
        apiKey: 'opaque-api-value',
        cookie: { sid: 'opaque-cookie-value' },
        authorization: 'opaque-auth-value',
        credentials: { username: 'u', password: 'opaque-password-value' },
        refreshToken: 'opaque-refresh-value',
        accessTokenValue: 'opaque-access-token-value',
        clientSecretValue: 'opaque-client-secret-value',
        apiKeyInput: 'opaque-api-input-value',
        passwordOutput: 'opaque-password-output-value',
        passphrase: 'opaque-passphrase-value',
        passPhrase: 'opaque-pass-phrase-value',
        APIKey: 'opaque-uppercase-api-key-value',
        clientAPIKey: 'opaque-client-uppercase-api-key-value',
        JWTToken: 'opaque-jwt-token-value',
        authorizationPrompt: 'opaque-authorization-prompt-value',
        [fullwidthApiKey]: 'opaque-fullwidth-api-key-value',
        [fullwidthPassword]: 'opaque-fullwidth-password-value',
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
    assert.strictEqual(event.result.apiKeyInput, '***');
    assert.strictEqual(event.result.passwordOutput, '***');
    assert.strictEqual(event.result.passphrase, '***');
    assert.strictEqual(event.result.passPhrase, '***');
    assert.strictEqual(event.result.APIKey, '***');
    assert.strictEqual(event.result.clientAPIKey, '***');
    assert.strictEqual(event.result.JWTToken, '***');
    assert.strictEqual(event.result.authorizationPrompt, '***');
    assert.strictEqual(event.result[fullwidthApiKey], '***');
    assert.strictEqual(event.result[fullwidthPassword], '***');
    assert.strictEqual(event.result.tokenCount, 17);
    assert.strictEqual(event.result.tokenUsage, 23);
    assert.strictEqual(event.result.tokenBudget, 100);
    assert.strictEqual(event.result.secretScanStatus, 'clean');
    assert.strictEqual(event.result.secretPolicy, '***');
    const raw = fs.readFileSync(path.join(dir, '.leerness', 'execution-ledger.jsonl'), 'utf8');
    assert.doesNotMatch(raw, /opaque-(?:api|uppercase-api-key|client-uppercase-api-key|fullwidth-api-key|fullwidth-password|jwt-token|cookie|auth|password|passphrase|pass-phrase|refresh|access-token|client-secret)(?:-(?:input|output|prompt))?-value/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('append-only ledger redacts secret-looking values and tolerates one corrupt line on read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-role-ledger-'));
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    appendExecutionEvent(dir, {
      schemaVersion: 999, event: 'execution.completed', taskId: 'T-1', attemptId: 'impl-1',
      actualExecutor: { provider: 'worker-a' }, result: { summary: 'token=sk-live-LEAKME' },
      evidenceRefs: ['implementation-evidence'], executed: true,
    });
    appendExecutionEvent(dir, {
      event: 'review.completed', taskId: 'T-1', attemptId: 'review-1', parentAttemptId: 'impl-1',
      reviewOfAttemptId: 'impl-1', actualExecutor: { provider: 'reviewer-b' },
      evidenceRefs: ['review-evidence'], executed: true,
    });
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
        for (const task of ['synthetic multi', 'synthetic multi preflight', 'synthetic bench', 'synthetic bench error']) {
          const events = history.events.filter(event => event.task === task);
          if (!events.length || events.some(event => typeof event.taskId !== 'string' || !event.taskId)) process.exit(8);
          if (new Set(events.map(event => event.taskId)).size !== 1) process.exit(9);
        }
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

test('dispatch refuses to commit a role resolution after availability policy changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-role-resolution-cas-'));
  const argv = ['role CAS task', '--role', 'coder', '--to', 'live', '--model', 'backup-model'];
  const valueFor = (flag, fallback = null) => {
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
  };
  const previousExitCode = process.exitCode;
  const previousLog = console.log;
  try {
    fs.mkdirSync(path.join(dir, '.leerness'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.leerness', 'agent-roles.json'), JSON.stringify({
      schemaVersion: 1,
      roles: {
        coder: {
          provider: 'dead', model: 'primary-model',
          primary: { provider: 'dead', model: 'primary-model' },
          candidates: [{ provider: 'live', model: 'backup-model' }],
          fallbackPolicy: 'balanced',
        },
      },
    }, null, 2) + '\n', 'utf8');
    const providers = [provider('dead', 'D'), provider('live', 'L')];
    const immediateLock = (_file, fn) => fn();
    let policyChanged = false;
    console.log = () => {};
    process.exitCode = 0;
    agentsCmd(dir, 'dispatch', argv, {
      VERSION: 'test',
      has: flag => argv.includes(flag),
      arg: valueFor,
      _agentSlashHint: () => null,
      _allProviders: () => providers,
      _checkAgent: def => ({ id: def.id, status: def.id === 'live' ? 'ready' : 'disabled', installed: true, enabled: def.id === 'live', auth: 'ok' }),
      _dispatchCommand: () => {
        appendAvailabilityObservation(dir, {
          provider: 'live', model: 'backup-model', policyAllowed: 'denied', reason: 'policy-changed-during-dispatch',
        }, { withLock: immediateLock });
        policyChanged = true;
        return 'synthetic command';
      },
      _harnessBrief: () => '',
      _loadEnvFile: () => {},
      _normalizeRole: value => value,
      _policyEnforce: () => ({ allowed: true, advisory: false }),
      _readUserProviders: () => [],
      _recommendAgent: () => ({ target: null, reason: '' }),
      _recordRun: () => null,
      _resolveRole: (root, role) => {
        const state = roleStore.readRoleStore(root);
        const normalized = normalizeRoleDefinition(role, state.roles[role]);
        return {
          role,
          provider: normalized.primary.provider,
          model: normalized.primary.model,
          modelFamily: normalized.primary.modelFamily,
          persona: normalized.persona,
          candidates: normalized.candidates,
          fallbackPolicy: normalized.fallbackPolicy,
          requirements: normalized.requirements,
          primary: normalized.primary,
          storeRevision: state.revision,
        };
      },
      _withLock: immediateLock,
      lessonsPath: () => path.join(dir, '.leerness', 'lessons.md'),
      taskLogPath: () => path.join(dir, '.leerness', 'task-log.md'),
    });
    assert.strictEqual(policyChanged, true);
    assert.strictEqual(process.exitCode, 1);
    const history = readExecutionEvents(dir, 100, { preserveAll: true });
    assert.strictEqual(history.events.some(event => event.event === 'dispatch.prepared'), false);
    assert.strictEqual(history.events.some(event => event.event === 'availability.observed'), true);
  } finally {
    console.log = previousLog;
    process.exitCode = previousExitCode;
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
    schemaVersion: 1,
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

  test('CLI invalid fallback preset fails closed before writing a routing decision', () => {
    const before = readExecutionEvents(fixture, 200, { preserveAll: true }).events.length;
    const result = run(['agents', 'resolve', '작은 API 수정', '--role', 'coder', '--preset', 'strcit', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'invalid_fallback_policy');
    const after = readExecutionEvents(fixture, 200, { preserveAll: true }).events.length;
    assert.strictEqual(after, before);
  });

  test('CLI rejects duplicate role, preset and fallback executor selectors before resolution or provider launch', () => {
    const before = readExecutionEvents(fixture, 200, { preserveAll: true }).events.length;
    let result = run(['agents', 'multi', 'duplicate role', '--role', '', '--role', 'coder', '--execute', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'duplicate_flag');
    result = run(['agents', 'resolve', 'duplicate preset', '--role', 'coder', '--preset', 'balanced', '--preset', 'strcit', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'duplicate_flag');
    result = run(['agents', 'fallback', 'provider', 'duplicate provider', '--role', 'coder', '--to', 'live', '--to', 'dead', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'duplicate_flag');
    result = run(['agents', 'fallback', 'model', 'duplicate model alias', '--role', 'coder', '--to', 'live', '--model', 'backup-model', '-m', 'other-model', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'duplicate_flag');
    const after = readExecutionEvents(fixture, 200, { preserveAll: true }).events.length;
    assert.strictEqual(after, before);
  });

  test('CLI cannot lower detected high risk without a visible approver and reason', () => {
    let result = run(['agents', 'resolve', '운영 결제 DB 삭제', '--role', 'coder', '--tier', 'normal', '--path', fixture, '--json'], { env });
    let out = json(result);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(out.classification.tier, 'high-risk');
    assert.strictEqual(out.classification.riskDowngrade.accepted, false);
    assert.strictEqual(out.resolution.decision.recommendedOptionId, 'hold');

    result = run(['agents', 'resolve', '운영 결제 DB 삭제', '--role', 'coder', '--tier', 'normal', '--approved-by', 'owner', '--reason', 'approved maintenance window', '--path', fixture, '--json'], { env });
    out = json(result);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(out.classification.tier, 'normal');
    assert.strictEqual(out.classification.riskDowngrade.accepted, true);
    assert.match(out.resolution.decision.recommendedOptionId, /^compatible-provider:/);
  });

  test('legacy agents route shares the same explicit high-risk downgrade gate', () => {
    let result = run(['agents', 'route', '운영 결제 DB 삭제', '--tier', 'normal', '--path', fixture, '--json'], { env });
    let out = json(result);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(out.tier, 'high-risk');
    assert.strictEqual(out.riskDowngrade.accepted, false);

    result = run(['agents', 'route', '운영 결제 DB 삭제', '--tier', 'normal', '--approved-by', 'owner', '--reason', 'approved maintenance window', '--path', fixture, '--json'], { env });
    out = json(result);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(out.tier, 'normal');
    assert.strictEqual(out.riskDowngrade.accepted, true);
  });

  test('CLI multi and bench reject role-bound execution before provider launch', () => {
    let result = run(['agents', 'multi', 'role fanout', '--role', 'coder', '--execute', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'role_multi_execution_unsupported');
    result = run(['agents', 'bench', 'role benchmark', '--role', 'coder', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'role_benchmark_execution_unsupported');
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
    assert.strictEqual(live.quotaState, 'observed-exhausted');
    assert.strictEqual(live.remaining, null);
    assert.ok(live.availabilityObservations.some(observation => observation.model === 'backup-model' && observation.quota === 'exhausted'));
    assert.deepStrictEqual(live.observed, live.availabilityObservations);
    assert.strictEqual(typeof out.note, 'string');
    assert.match(out.note, /모델 권한|append-only/);
    assert.ok(out.limitations.includes('recorded_availability_is_not_official_capacity'));
    assert.strictEqual(out.policy.recordedAvailabilityTreatedAsOfficialCapacity, false);
    result = run(['agents', 'availability', 'clear', 'live', '--model', 'backup-model', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  });

  test('CLI quota summary applies newer provider-wide recovery to older exact-model state', () => {
    let result = run(['agents', 'availability', 'mark', 'live', '--model', 'backup-model', '--quota-state', 'exhausted', '--rate-limited', '--reason', 'quota-exhausted', '--ttl-min', '60', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    result = run(['agents', 'availability', 'mark', 'live', '--quota-state', 'available', '--not-rate-limited', '--reason', 'capacity-restored', '--ttl-min', '60', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    result = run(['agents', 'quota', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const live = json(result).quota.find(row => row.id === 'live');
    assert.strictEqual(live.quotaState, 'observed-available');
    assert.strictEqual(live.quota, 'observed-available');
    result = run(['agents', 'availability', 'clear', 'live', '--path', fixture, '--json'], { env });
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

    result = run(['agents', 'dispatch', '결제 검수', '--role', 'reviewer', '--to', 'live', '--model', 'gpt-5.6', '--tier', 'high-risk', '--agent', 'worker', '--agent-model', 'claude-sonnet-4-7', '--agent-model-family', 'claude', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'human_approval_required');

    result = run(['agents', 'dispatch', '결제 검수', '--role', 'reviewer', '--to', 'live', '--model', 'gpt-5.6', '--tier', 'high-risk', '--agent', 'worker', '--agent-model', 'gpt-5.7', '--agent-model-family', 'openai-gpt', '--approved-by', 'owner', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'fallback_choice_blocked');

    result = run(['agents', 'dispatch', '결제 검수', '--role', 'reviewer', '--to', 'live', '--model', 'gpt-5.6', '--tier', 'high-risk', '--agent', 'worker', '--agent-model', 'claude-sonnet-4-7', '--agent-model-family', 'claude', '--approved-by', 'owner', '--path', fixture, '--json'], { env });
    const out = json(result);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(out.action, 'dispatch-prepared');
    assert.strictEqual(out.executed, false);
    assert.match(out.taskId, /^task-/);
    assert.match(out.auditEventId, /^evt-/);
    const prepared = readExecutionEvents(fixture, 200, { preserveAll: true }).events
      .find(event => event.eventId === out.auditEventId);
    assert.ok(prepared);
    assert.strictEqual(prepared.taskId, out.taskId);
    assert.strictEqual(prepared.requestedRole, 'reviewer');
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
    seedRoleExecutionParent(fixture, 'T-9999', 'selection-9999');
    result = run(['agents', 'record', 'completed', '구현과 테스트 통과', '--task', 'T-9999', '--id', 'impl-9999', '--target', 'selection-9999', '--role', 'coder', '--to', 'live', '--model', 'claude-sonnet-4-7', '--evidence', 'test exit 0', '--path', fixture, '--json'], {
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
    assert.strictEqual(json(result).event.actualExecutor.model, 'claude-sonnet-4-7');
    assert.strictEqual(json(result).event.actualExecutor.modelFamily, 'claude');
    assert.strictEqual(json(result).event.actualExecutor.sessionId, null);
    assert.strictEqual(json(result).event.requestedRole, 'coder');
    assert.deepStrictEqual(json(result).event.evidenceRefs, ['test exit 0']);

    seedRoleExecutionParent(fixture, 'T-SAME-SESSION', 'selection-same-session');
    const sharedSessionEnv = {
      ...env,
      LEERNESS_SESSION_ID: 'mcp-shared-session',
      LEERNESS_SESSION_IDENTITY_SOURCE: 'mcp',
    };
    let sameSession = run(['agents', 'record', 'completed', 'same host implementation', '--task', 'T-SAME-SESSION', '--id', 'impl-same-session', '--target', 'selection-same-session', '--role', 'coder', '--to', 'live', '--model', 'claude-sonnet-4-7', '--evidence', 'implementation evidence', '--path', fixture, '--json'], {
      env: { ...sharedSessionEnv, LEERNESS_SESSION_PROVIDER: 'live', LEERNESS_SESSION_MODEL: 'claude-sonnet-4-7' },
    });
    assert.strictEqual(sameSession.status, 0, sameSession.stderr || sameSession.stdout);
    assert.strictEqual(json(sameSession).event.actualExecutor.sessionId, 'mcp-shared-session');
    sameSession = run(['agents', 'record', 'reviewed', 'same host review', '--task', 'T-SAME-SESSION', '--id', 'review-same-session', '--target', 'impl-same-session', '--role', 'reviewer', '--to', 'reviewer-b', '--model', 'gpt-5.6', '--evidence', 'review evidence', '--path', fixture, '--json'], {
      env: { ...sharedSessionEnv, LEERNESS_SESSION_PROVIDER: 'reviewer-b', LEERNESS_SESSION_MODEL: 'gpt-5.6' },
    });
    assert.strictEqual(sameSession.status, 0, sameSession.stderr || sameSession.stdout);
    assert.strictEqual(json(sameSession).event.actualExecutor.sessionId, 'mcp-shared-session');
    assert.strictEqual(json(sameSession).event.reviewerIndependent, false);
    assert.strictEqual(json(sameSession).event.review.independenceBasis, 'same-session');

    result = run(['agents', 'record', '--task', 'T-9999', 'reviewed', '--summary', '독립 검수 통과', '--id', 'review-9999', '--target', 'impl-9999', '--role', 'reviewer', '--to', 'reviewer-b', '--model', 'gpt-5.6', '--agent', 'live', '--agent-model', 'claude-sonnet-4-7', '--evidence', 'no P0/P1', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(json(result).event.reviewerIndependent, true);
    seedRoleExecutionParent(fixture, 'T-9999', 'selection-same');
    result = run(['agents', 'record', 'completed', '같은 세션 구현', '--task', 'T-9999', '--id', 'impl-same', '--target', 'selection-same', '--role', 'coder', '--to', 'live', '--model', 'claude-sonnet-4-7', '--session-id', 'shared-session', '--evidence', 'implementation evidence', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    result = run(['agents', 'record', 'reviewed', '같은 세션 검수', '--task', 'T-9999', '--id', 'review-same', '--target', 'impl-same', '--role', 'reviewer', '--to', 'reviewer-c', '--model-family', 'family-b', '--session-id', 'shared-session', '--evidence', 'same session', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(json(result).event.reviewerIndependent, false);
    assert.strictEqual(json(result).event.review.independenceBasis, 'same-session');
    assert.strictEqual(json(result).event.reviewOfAttemptId, 'impl-same');
    seedRoleExecutionParent(fixture, 'T-9998', 'selection-9998');
    result = run(['agents', 'record', 'completed', '--task', 'T-9998', '--id', 'impl-9998', '--target', 'selection-9998', '--summary', '플래그 뒤 요약', '--role', 'coder', '--to', 'live', '--evidence', 'flag-order-evidence', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(json(result).event.taskId, 'T-9998');
    assert.strictEqual(json(result).event.result.summary, '플래그 뒤 요약');
    result = run(['agents', 'record', 'failed', '중복 terminal', '--task', 'T-9998', '--id', 'impl-9998', '--target', 'selection-9998', '--role', 'coder', '--to', 'live', '--evidence', 'duplicate evidence', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'attempt_already_terminal');
    const historyResult = run(['agents', 'history', '--limit', '50', '--path', fixture, '--json'], { env });
    const history = json(historyResult);
    assert.strictEqual(historyResult.status, 0, historyResult.stderr || historyResult.stdout);
    assert.ok(history.events.some(e => e.event === 'task.held'));
    assert.ok(history.events.some(e => e.event === 'execution.completed' && e.taskId === 'T-9999'));
    assert.strictEqual(history.events.filter(e => e.attemptId === 'impl-9998' && ['execution.completed', 'execution.failed'].includes(e.event)).length, 1);
    assert.ok(history.events.some(e => e.event === 'review.completed' && e.review && e.review.reviewerIndependent === true && e.review.reviewerIndependence === 'independent'));
  });

  test('CLI review provenance is bound to one prior implementation attempt', () => {
    let result = run(['agents', 'record', 'reviewed', 'missing target', '--task', 'T-BIND', '--id', 'review-missing', '--target', 'impl-missing', '--to', 'reviewer-b', '--model', 'gpt-5.6', '--evidence', 'review evidence', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'review_target_not_found');

    seedRoleExecutionParent(fixture, 'T-BIND', 'selection-bound');
    result = run(['agents', 'record', 'completed', 'bound implementation', '--task', 'T-BIND', '--id', 'impl-bound', '--target', 'selection-bound', '--to', 'live', '--model', 'claude-sonnet-4-7', '--evidence', 'implementation evidence', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    result = run(['agents', 'record', 'reviewed', 'forged implementer', '--task', 'T-BIND', '--id', 'review-forged', '--target', 'impl-bound', '--to', 'reviewer-b', '--model', 'gpt-5.6', '--agent', 'someone-else', '--agent-model', 'claude-sonnet-4-7', '--evidence', 'review evidence', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'review_target_identity_mismatch');

    result = run(['agents', 'record', 'reviewed', 'bound review', '--task', 'T-BIND', '--id', 'review-bound', '--target', 'impl-bound', '--to', 'reviewer-b', '--model', 'gpt-5.6', '--evidence', 'review evidence', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const event = json(result).event;
    assert.strictEqual(event.review.reviewOf.provider, 'live');
    assert.strictEqual(event.review.reviewOf.model, 'claude-sonnet-4-7');
    assert.strictEqual(event.reviewerIndependent, true);
  });

  test('CLI terminal provenance rejects missing role-execution and validation parents', () => {
    let result = run(['agents', 'record', 'completed', 'missing role parent', '--task', 'T-PARENT', '--id', 'impl-parent', '--target', 'selection-missing', '--role', 'coder', '--to', 'live', '--evidence', 'evidence', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'execution_target_not_found');
    result = run(['agents', 'record', 'completed', 'missing unscoped parent', '--task', 'T-PARENT', '--id', 'impl-parent-unscoped', '--target', 'selection-unscoped-missing', '--to', 'live', '--evidence', 'evidence', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'execution_target_not_found');

    seedRoleExecutionParent(fixture, 'T-PARENT', 'selection-identity');
    result = run(['agents', 'record', 'completed', 'mismatched executor', '--task', 'T-PARENT', '--id', 'impl-parent-identity', '--target', 'selection-identity', '--role', 'coder', '--to', 'dead', '--evidence', 'evidence', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'execution_target_identity_mismatch');

    seedRoleExecutionParent(fixture, 'T-PARENT', 'selection-role');
    result = run(['agents', 'record', 'completed', 'mismatched role', '--task', 'T-PARENT', '--id', 'impl-parent-role', '--target', 'selection-role', '--role', 'reviewer', '--to', 'live', '--evidence', 'evidence', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'execution_target_role_mismatch');

    appendExecutionEvent(fixture, {
      event: 'dispatch.prepared', taskId: 'T-PARENT', attemptId: 'selection-nonrole',
      actualExecutor: { provider: 'live', identitySource: 'synthetic-test' }, executed: false,
    });
    result = run(['agents', 'record', 'completed', 'role against non-role parent', '--task', 'T-PARENT', '--id', 'impl-parent-nonrole', '--target', 'selection-nonrole', '--role', 'coder', '--to', 'live', '--evidence', 'evidence', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'execution_target_role_mismatch');

    seedRoleExecutionParent(fixture, 'T-PARENT', 'selection-invisible-evidence');
    result = run(['agents', 'record', 'completed', 'invisible evidence', '--task', 'T-PARENT', '--id', 'impl-invisible-evidence', '--target', 'selection-invisible-evidence', '--role', 'coder', '--to', 'live', '--evidence', '\u{1bca0}', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'provenance_fields_required');
    assert.match(json(result).error, /--evidence/);

    result = run(['agents', 'record', 'validated', 'missing validation parent', '--task', 'T-PARENT', '--id', 'validation-parent', '--target', 'impl-missing', '--to', 'live', '--evidence', 'evidence', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'validation_target_not_found');
  });

  test('CLI rejects terminal identifiers that normalize or truncate before duplicate checks', () => {
    const cases = [
      ['--task', ' T-CANON '],
      ['--task', 'T-CA\u200bNON'],
      ['--id', 'impl\ncanon'],
      ['--id', 'x'.repeat(201)],
      ['--target', 'selection\tcanon'],
      ['--to', 'li\u200bve'],
      ['--to', '\uff4c\uff49\uff56\uff45'],
      ['--model', 'backup\u200b-model'],
      ['--model-family', 'openai\u200b-gpt'],
      ['--session-id', 'session\rcanon'],
    ];
    for (const [flag, value] of cases) {
      const args = ['agents', 'record', 'completed', 'noncanonical identifier', '--task', 'T-CANON', '--id', 'impl-canon', '--target', 'selection-canon', '--to', 'live', '--evidence', 'evidence', '--path', fixture, '--json'];
      const at = args.indexOf(flag);
      if (at >= 0) args[at + 1] = value;
      else args.splice(args.indexOf('--path'), 0, flag, value);
      const result = run(args, { env });
      assert.strictEqual(result.status, 1, `${flag}: ${result.stderr || result.stdout}`);
      assert.strictEqual(json(result).code, 'invalid_provenance_identifier', flag);
    }
  });

  test('CLI terminal provenance requires task, attempt, executor, evidence and links', () => {
    const result = run(['agents', 'record', 'completed', '불완전 완료', '--task', 'T-INCOMPLETE', '--role', 'coder', '--to', 'live', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(json(result).code, 'provenance_fields_required');
    assert.match(json(result).error, /--id/);
    assert.match(json(result).error, /--evidence/);
    assert.match(json(result).error, /--target/);
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

  test('roles set replaces the legacy policy alias without retaining contradictory stale policy', () => {
    const file = path.join(fixture, '.leerness', 'agent-roles.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    stored.roles.architect.policy = 'strict';
    delete stored.roles.architect.fallbackPolicy;
    fs.writeFileSync(file, JSON.stringify(stored, null, 2) + '\n', 'utf8');
    const result = run(['roles', 'set', 'architect', '--provider', 'live', '--policy', 'continuity', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const updated = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(Object.prototype.hasOwnProperty.call(updated.roles.architect, 'policy'), false);
    assert.strictEqual(updated.roles.architect.fallbackPolicy, 'continuity');
  });

  test('roles set keeps legacy schema v1 while retaining extended compatibility fields', () => {
    const result = run(['roles', 'set', 'debugger', '--provider', 'live', '--model', 'debug-model', '--path', fixture, '--json'], { env });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const store = JSON.parse(fs.readFileSync(path.join(fixture, '.leerness', 'agent-roles.json'), 'utf8'));
    assert.strictEqual(store.schemaVersion, 1);
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
    seedRoleExecutionParent(fixture, 'T-MCP-1', 'selection-mcp-1');
    seedRoleExecutionParent(fixture, 'T-MCP-SELF', 'selection-mcp-self');
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'role-fallback-probe', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'leerness_agents_resolve', arguments: { path: fixture, task: '작은 API 수정', role: 'coder', sessionKey: 'mcp-role-session' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'leerness_agents_availability', arguments: { path: fixture, action: 'list' } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'leerness_agents_quota', arguments: { path: fixture } } },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'leerness_agents_fallback', arguments: { path: fixture, action: 'hold', task: '작은 API 수정', role: 'coder', taskId: 'T-MCP-1' } } },
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'leerness_agents_record', arguments: { path: fixture, event: 'completed', summary: 'MCP implementation complete', taskId: 'T-MCP-1', attemptId: 'impl-mcp-1', targetAttemptId: 'selection-mcp-1', role: 'coder', provider: 'live', model: 'backup-model', evidence: 'synthetic exit 0', sessionKey: 'mcp-role-session' } } },
      { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'leerness_agents_history', arguments: { path: fixture, limit: 20 } } },
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'leerness_roles', arguments: { path: fixture, sub: 'set', role: 'dispatcher', provider: 'dead', model: 'claude-dispatch', modelFamily: 'claude', candidates: ['live:gpt-dispatch', 'codex:gpt-5'], candidateFamilies: ['openai-gpt', 'openai-gpt'], fallbackPolicy: 'continuity' } } },
      { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'leerness_agents_list', arguments: { path: fixture } } },
      { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'leerness_agents_availability', arguments: { path: fixture, action: 'mark', provider: 'live', authenticated: 'ok', reason: 'credentials-confirmed', ttlMin: 5 } } },
      { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'leerness_roles_validate', arguments: { path: fixture } } },
      { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'leerness_roles_validate', arguments: { path: fixture, typoPath: path.dirname(fixture) } } },
      { jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'leerness_agents_availability', arguments: { path: fixture, action: 'mark', provider: 'live', rateLimited: true, reason: 'rate-limited', ttlMin: 5 } } },
      { jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'leerness_agents_availability', arguments: { path: fixture, action: 'mark', provider: 'live', rateLimited: false, quota: 'available', reason: 'capacity-restored', ttlMin: 5 } } },
      { jsonrpc: '2.0', id: 16, method: 'tools/call', params: { name: 'leerness_agents_quota', arguments: { path: fixture } } },
      { jsonrpc: '2.0', id: 17, method: 'tools/call', params: { name: 'leerness_agents_record', arguments: { path: fixture, event: 'completed', summary: 'same MCP connection implementation', taskId: 'T-MCP-SELF', attemptId: 'impl-mcp-self', targetAttemptId: 'selection-mcp-self', role: 'coder', provider: 'live', model: 'claude-sonnet-4-7', evidence: 'implementation evidence', sessionKey: 'mcp-impl-session' } } },
      { jsonrpc: '2.0', id: 18, method: 'tools/call', params: { name: 'leerness_agents_record', arguments: { path: fixture, event: 'reviewed', summary: 'same MCP connection review', taskId: 'T-MCP-SELF', attemptId: 'review-mcp-self', targetAttemptId: 'impl-mcp-self', role: 'reviewer', provider: 'dead', model: 'gpt-5.6', evidence: 'review evidence', sessionKey: 'mcp-review-session' } } },
      { jsonrpc: '2.0', id: 19, method: 'tools/call', params: { name: 'leerness_agents_record', arguments: { path: fixture, event: 'partial', summary: 'forged MCP executor session A', executorSession: 'attacker-session-a' } } },
      { jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'leerness_agents_record', arguments: { path: fixture, event: 'partial', summary: 'forged MCP executor session B', executorSession: 'attacker-session-b' } } },
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
    for (const name of ['leerness_agents_resolve', 'leerness_agents_fallback', 'leerness_agents_availability', 'leerness_agents_record', 'leerness_agents_history', 'leerness_agents_quota', 'leerness_roles_validate']) assert.ok(tools.includes(name), name);
    const rolesValidateTool = require('../lib/mcp-tools').find(tool => tool.name === 'leerness_roles_validate');
    const recordTool = require('../lib/mcp-tools').find(tool => tool.name === 'leerness_agents_record');
    assert.strictEqual(rolesValidateTool.requiredTier, 'read-only');
    assert.match(rolesValidateTool.description, /native v2 파일은 아직 읽지 않으며/);
    assert.strictEqual(recordTool.inputSchema.additionalProperties, false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(recordTool.inputSchema.properties, 'executorSession'), false);
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
    assert.strictEqual(payload(12).ok, true);
    assert.strictEqual(byId(13)?.error?.code, -32602);
    assert.match(byId(13)?.error?.message || '', /unknown property 'typoPath'/);
    assert.strictEqual(payload(14).event.availability.rateLimited, true);
    assert.strictEqual(payload(15).event.availability.rateLimited, false);
    const restoredLive = payload(16).quota.find(row => row.id === 'live');
    assert.strictEqual(restoredLive.routingEligibility, 'eligible');
    assert.strictEqual(restoredLive.quotaState, 'observed-available');
    assert.match(payload(17).event.actualExecutor.sessionId, /^mcp-[0-9a-f]{32}$/);
    assert.strictEqual(payload(18).event.actualExecutor.sessionId, payload(17).event.actualExecutor.sessionId);
    assert.strictEqual(payload(18).event.reviewerIndependent, false);
    assert.strictEqual(payload(18).event.review.independenceBasis, 'same-session');
    for (const id of [19, 20]) {
      assert.strictEqual(byId(id)?.error?.code, -32602);
      assert.match(byId(id)?.error?.message || '', /unknown property 'executorSession'/);
    }
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
      { schemaVersion: 1, roles: { coder: { provider: 'dead', primary: { provider: 'dead' }, fallbackPolicy: 'strcit' } } },
      { schemaVersion: 1, roles: { coder: { provider: 'dead', primary: { provider: 'dead' }, candidates: { provider: 'live' }, fallbackPolicy: 'strict' } } },
      { schemaVersion: 1, roles: { coder: { provider: 'dead', primary: { provider: 'live' }, fallbackPolicy: 'strict' } } },
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
