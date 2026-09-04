'use strict';

// 역할은 안정적으로 유지하고 provider/model은 교체 가능한 실행 자원으로 다룬다.
// 이 모듈은 후보 평가·사용자 선택 계약·append-only provenance만 담당하며,
// 외부 모델을 직접 호출하거나 자격증명 값을 읽지 않는다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { absRoot, exists, mkdirp, now } = require('./io');
const { redactSecrets } = require('./pure-utils');
const {
  ROLE_CATALOG,
  ROLE_REQUIREMENTS,
} = require('./role-catalog');

const FALLBACK_POLICIES = Object.freeze(['strict', 'balanced', 'continuity']);
const AVAILABILITY_VALUES = Object.freeze({
  authentication: ['ok', 'no', 'unknown'],
  policy: ['allowed', 'denied', 'unknown'],
  entitlement: ['yes', 'no', 'unknown'],
  quota: ['available', 'exhausted', 'unknown'],
  reachability: ['yes', 'no', 'unknown'],
});
const AVAILABILITY_REASON_DEFAULTS = Object.freeze({
  'not-authenticated': { authenticated: 'no' },
  'credentials-invalid': { authenticated: 'no' },
  'credentials-expired': { authenticated: 'no' },
  'model-not-entitled': { modelEntitled: 'no' },
  'quota-exhausted': { quota: 'exhausted' },
  'rate-limited': { rateLimited: true },
  'policy-denied': { policyAllowed: 'denied' },
  'unreachable': { reachable: 'no' },
});
const LEDGER_SCHEMA_VERSION = 1;
const LEDGER_MAX_BYTES = 64 * 1024 * 1024;
const LEDGER_READ_BYTES = 4 * 1024 * 1024;
// Model IDs are emitted as command-line arguments by dispatch. Keep the accepted
// alphabet shell-inert across cmd, PowerShell, and POSIX shells instead of trying
// to maintain three subtly different quoting implementations.
const MODEL_IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;

function isValidModelIdentifier(value) {
  const model = String(value == null ? '' : value).trim();
  return !!model && MODEL_IDENTIFIER_RE.test(model);
}

function normalizeFallbackPolicy(value, fallback = 'balanced') {
  const v = String(value || '').trim().toLowerCase();
  return FALLBACK_POLICIES.includes(v) ? v : fallback;
}

function _string(value, max = 400) {
  const s = String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .trim();
  return redactSecrets(s, max).slice(0, max);
}

function normalizeModelFamily(value) {
  const family = _string(value || '', 160).toLowerCase();
  return family || null;
}

// Conservative derivation only for model IDs whose family is explicit in the ID.
// Provider names are intentionally not used because gateways (OpenRouter/Aider/etc.)
// can expose several unrelated model families.
function inferModelFamily(model) {
  const id = _string(model || '', 240).toLowerCase();
  if (!id) return null;
  if (id.includes('claude')) return 'claude';
  if (id.includes('grok')) return 'grok';
  if (id.includes('gemini') || id.includes('antigravity')) return 'gemini';
  if (id.includes('qwen')) return 'qwen';
  if (id.includes('kimi') || id.includes('moonshot')) return 'kimi';
  if (id.includes('deepseek')) return 'deepseek';
  if (id.includes('llama')) return 'llama';
  if (id.includes('mistral') || id.includes('mixtral')) return 'mistral';
  if (id.includes('command-r')) return 'command-r';
  if (/(^|[\/:_.-])glm(?:[\/:_.-]|$)/.test(id)) return 'glm';
  if (/(^|[\/:_.-])gpt(?:[\/:_.-]|$)/.test(id) || /(^|[\/:_.-])o[1345](?:[\/:_.-]|$)/.test(id)) return 'openai-gpt';
  return null;
}

function normalizeExecutorIdentity(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const provider = _string(raw.provider || '', 120) || null;
  const model = _string(raw.model || '', 200) || null;
  const explicitFamily = normalizeModelFamily(raw.modelFamily);
  const inferredFamily = inferModelFamily(model);
  return {
    provider,
    model,
    // A recognizable model ID is stronger evidence than a conflicting label.
    // Opaque IDs may still use an explicit registry-provided family.
    modelFamily: inferredFamily || explicitFamily,
    sessionId: _string(raw.sessionId || '', 200) || null,
    identitySource: _string(raw.identitySource || '', 80) || 'unknown',
  };
}

// `true` is reserved for proven different model families. Merely using different
// provider IDs is not enough because gateways can proxy the same model family.
function assessReviewerIndependence(reviewerValue, implementerValue) {
  const reviewer = normalizeExecutorIdentity(reviewerValue);
  const implementer = normalizeExecutorIdentity(implementerValue);
  let reviewerIndependent = null;
  let basis = 'model-family-unverified';
  if (reviewer.sessionId && implementer.sessionId && reviewer.sessionId === implementer.sessionId) {
    reviewerIndependent = false;
    basis = 'same-session';
  } else if (reviewer.model && implementer.model && reviewer.model.toLowerCase() === implementer.model.toLowerCase()) {
    reviewerIndependent = false;
    basis = 'same-model';
  } else if (reviewer.model && implementer.model && reviewer.modelFamily && implementer.modelFamily) {
    // Family labels without concrete model identities are declarations, not proof
    // that the selected executors are actually from different model families.
    reviewerIndependent = reviewer.modelFamily !== implementer.modelFamily;
    basis = reviewerIndependent ? 'different-model-family' : 'same-model-family';
  }
  return {
    reviewerIndependent,
    status: reviewerIndependent === true ? 'independent'
      : reviewerIndependent === false ? 'not-independent' : 'unverified',
    basis,
    reviewer,
    implementer,
  };
}

function _candidate(value, source) {
  if (typeof value === 'string') {
    const at = value.indexOf(':');
    const provider = (at >= 0 ? value.slice(0, at) : value).trim();
    const model = at >= 0 ? value.slice(at + 1).trim() : '';
    return provider ? { provider, model: model || null, modelFamily: inferModelFamily(model), source } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const provider = String(value.provider || value.id || '').trim();
  if (!provider) return null;
  const model = value.model == null || value.model === '' ? null : String(value.model).trim();
  return {
    provider,
    model,
    modelFamily: inferModelFamily(model) || normalizeModelFamily(value.modelFamily),
    source: value.source || source,
  };
}

function _plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Stored role configuration is policy input. Invalid nested fields must not be
// normalized away because a typo such as "strcit" -> balanced silently weakens
// the user's policy. Unknown extension fields are preserved, but every field
// consumed by the resolver is validated before the store is accepted.
function validateRoleDefinitionShape(roleName, rawDefinition) {
  const role = String(roleName || '').trim().toLowerCase();
  const fail = (reason, field = null) => ({
    ok: false,
    code: 'role_definition_invalid',
    role,
    field,
    error: `${role || '(empty-role)'}: ${reason}`,
  });
  if (!role) return fail('role name is empty', 'role');
  if (!_plainObject(rawDefinition)) return fail('role definition must be an object', 'definition');
  const raw = rawDefinition;
  if (Object.prototype.hasOwnProperty.call(raw, 'schemaVersion')
    && (!Number.isInteger(raw.schemaVersion) || ![1, 2].includes(raw.schemaVersion))) {
    return fail('schemaVersion must be 1 or 2', 'schemaVersion');
  }
  const nullableString = value => value == null || typeof value === 'string';
  const validateCandidate = (value, label) => {
    if (typeof value === 'string') {
      const at = value.indexOf(':');
      const provider = (at >= 0 ? value.slice(0, at) : value).trim();
      const model = at >= 0 ? value.slice(at + 1).trim() : '';
      if (!provider) return `${label}.provider is empty`;
      if (/[\r\n\u2028\u2029]/.test(provider)) return `${label}.provider contains a line separator`;
      if (model && !isValidModelIdentifier(model)) return `${label}.model is not a safe model identifier`;
      return null;
    }
    if (!_plainObject(value)) return `${label} must be a string or object`;
    if (value.provider != null && typeof value.provider !== 'string') return `${label}.provider must be a string`;
    if (value.id != null && typeof value.id !== 'string') return `${label}.id must be a string`;
    const provider = String(value.provider || value.id || '').trim();
    if (!provider) return `${label}.provider is empty`;
    if (/[\r\n\u2028\u2029]/.test(provider)) return `${label}.provider contains a line separator`;
    if (value.provider != null && value.id != null
      && String(value.provider).trim() !== String(value.id).trim()) return `${label}.provider conflicts with ${label}.id`;
    if (!nullableString(value.model)) return `${label}.model must be a string or null`;
    if (!nullableString(value.modelFamily)) return `${label}.modelFamily must be a string or null`;
    const model = value.model == null ? '' : String(value.model).trim();
    const modelFamily = value.modelFamily == null ? '' : String(value.modelFamily).trim().toLowerCase();
    if (model && !isValidModelIdentifier(model)) return `${label}.model is not a safe model identifier`;
    if (/[\r\n\u2028\u2029]/.test(modelFamily)) return `${label}.modelFamily contains a line separator`;
    const inferredFamily = inferModelFamily(model);
    if (modelFamily && inferredFamily && modelFamily !== inferredFamily) {
      return `${label}.modelFamily conflicts with inferred family ${inferredFamily}`;
    }
    if (value.source != null && typeof value.source !== 'string') return `${label}.source must be a string`;
    if (typeof value.source === 'string' && /[\r\n\u2028\u2029]/.test(value.source)) return `${label}.source contains a line separator`;
    return null;
  };

  const hasPrimary = Object.prototype.hasOwnProperty.call(raw, 'primary');
  const primaryRaw = hasPrimary ? raw.primary : raw;
  const primaryError = validateCandidate(primaryRaw, 'primary');
  if (primaryError) return fail(primaryError, 'primary');

  if (hasPrimary) {
    if (raw.provider != null) {
      if (typeof raw.provider !== 'string' || !raw.provider.trim()) return fail('provider must be a non-empty string', 'provider');
      const primaryProvider = String(primaryRaw.provider || primaryRaw.id || '').trim();
      if (raw.provider.trim() !== primaryProvider) return fail('legacy provider conflicts with primary.provider', 'provider');
    }
    const compatible = (key, normalize = value => value == null || value === '' ? null : String(value).trim()) => {
      if (!Object.prototype.hasOwnProperty.call(raw, key)
        || !Object.prototype.hasOwnProperty.call(primaryRaw, key)) return true;
      return normalize(raw[key]) === normalize(primaryRaw[key]);
    };
    if (!nullableString(raw.model)) return fail('model must be a string or null', 'model');
    if (!nullableString(raw.modelFamily)) return fail('modelFamily must be a string or null', 'modelFamily');
    if (!compatible('model')) return fail('legacy model conflicts with primary.model', 'model');
    if (!compatible('modelFamily', value => value == null || value === '' ? null : String(value).trim().toLowerCase())) {
      return fail('legacy modelFamily conflicts with primary.modelFamily', 'modelFamily');
    }
  }

  for (const field of ['candidates', 'fallbacks']) {
    if (!Object.prototype.hasOwnProperty.call(raw, field)) continue;
    if (!Array.isArray(raw[field])) return fail(`${field} must be an array`, field);
    for (let i = 0; i < raw[field].length; i++) {
      const error = validateCandidate(raw[field][i], `${field}[${i}]`);
      if (error) return fail(error, `${field}[${i}]`);
    }
  }
  const policies = [];
  for (const field of ['fallbackPolicy', 'policy']) {
    if (!Object.prototype.hasOwnProperty.call(raw, field)) continue;
    if (typeof raw[field] !== 'string' || !FALLBACK_POLICIES.includes(raw[field].trim().toLowerCase())) {
      return fail(`${field} must be one of ${FALLBACK_POLICIES.join('|')}`, field);
    }
    policies.push(raw[field].trim().toLowerCase());
  }
  if (policies.length === 2 && policies[0] !== policies[1]) return fail('fallbackPolicy conflicts with policy', 'fallbackPolicy');
  if (raw.persona != null && typeof raw.persona !== 'string') return fail('persona must be a string', 'persona');
  if (raw.requirements != null && !_plainObject(raw.requirements)) return fail('requirements must be an object', 'requirements');
  return { ok: true, code: null, role, error: null };
}

function normalizeRoleDefinition(roleName, rawDefinition) {
  const role = String(roleName || '').trim().toLowerCase();
  const raw = rawDefinition && typeof rawDefinition === 'object' ? rawDefinition : {};
  const primaryRaw = raw.primary && typeof raw.primary === 'object' ? raw.primary : raw;
  const primary = _candidate(primaryRaw, 'primary');
  const explicit = Array.isArray(raw.candidates)
    ? raw.candidates
    : Array.isArray(raw.fallbacks)
      ? raw.fallbacks
      : [];
  const candidates = [];
  const seen = new Set(primary ? [`${primary.provider}\u0000${primary.model || ''}`] : []);
  for (const item of explicit) {
    const c = _candidate(item, 'configured');
    if (!c) continue;
    const key = `${c.provider}\u0000${c.model || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(c);
  }
  return {
    role,
    primary,
    candidates,
    persona: _string(raw.persona || '', 1000),
    fallbackPolicy: normalizeFallbackPolicy(raw.fallbackPolicy || raw.policy),
    requirements: raw.requirements && typeof raw.requirements === 'object'
      ? { ...raw.requirements }
      : { ...(ROLE_REQUIREMENTS[role] || {}) },
    schemaVersion: Number(raw.schemaVersion || 2),
  };
}

function buildCandidatePool(roleName, rawDefinition, opts = {}) {
  const normalized = normalizeRoleDefinition(roleName, rawDefinition);
  const catalog = opts.roleCatalog || ROLE_CATALOG;
  const roleDef = catalog[normalized.role] || {};
  const pool = [];
  const seen = new Set();
  const add = (candidate) => {
    if (!candidate || !candidate.provider) return;
    // A ready provider does not prove that a catalog model still exists, is entitled,
    // has quota, or is even selectable by that CLI. Only explicitly configured
    // model IDs survive here; catalog-only candidates use the provider default
    // and keep model entitlement as unknown.
    const model = candidate.model || null;
    const key = `${candidate.provider}\u0000${model || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    pool.push({ ...candidate, model: model || null, modelFamily: inferModelFamily(model) || normalizeModelFamily(candidate.modelFamily) });
  };
  add(normalized.primary && { ...normalized.primary, source: 'primary' });
  normalized.candidates.forEach(add);
  for (const provider of (roleDef.prefer || [])) {
    add({ provider, model: null, source: 'catalog' });
  }
  return { normalized, pool };
}

function _enum(value, allowed, fallback = 'unknown') {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

function normalizeAvailability(providerDefinition, rawCheck, extra = {}) {
  const provider = providerDefinition && providerDefinition.id
    ? String(providerDefinition.id)
    : String(extra.provider || '');
  const check = rawCheck && typeof rawCheck === 'object' ? rawCheck : {};
  const status = String(check.status || extra.status || (providerDefinition ? 'unknown' : 'unknown-provider'));
  const installed = check.installed === true || (check.installed == null && status === 'ready');
  const enabled = check.enabled === true || (check.enabled == null && status === 'ready');
  // A newer explicit observation is the safety override. CLI auth probes can
  // be stale, unavailable, or only provider-wide; they must not mask a recorded
  // credentials-expired/not-authenticated result.
  const authenticated = _enum(extra.authenticated != null ? extra.authenticated : check.auth, AVAILABILITY_VALUES.authentication);
  const policyAllowed = _enum(extra.policyAllowed, AVAILABILITY_VALUES.policy);
  const modelEntitled = _enum(extra.modelEntitled, AVAILABILITY_VALUES.entitlement);
  const quota = _enum(extra.quota, AVAILABILITY_VALUES.quota);
  const reachable = _enum(extra.reachable || (status === 'ready' ? 'yes' : 'unknown'), AVAILABILITY_VALUES.reachability);
  const rateLimited = extra.rateLimited === true;
  const blockingReasons = [];
  const warningReasons = [];

  if (!providerDefinition) blockingReasons.push('unknown-provider');
  if (!installed || status === 'not-installed') blockingReasons.push('not-installed');
  if (!enabled || status === 'disabled') blockingReasons.push('disabled');
  if (status !== 'ready' && !['not-installed', 'disabled'].includes(status)) blockingReasons.push(`status:${status}`);
  if (authenticated === 'no') blockingReasons.push('not-authenticated');
  if (policyAllowed === 'denied') blockingReasons.push('policy-denied');
  if (modelEntitled === 'no') blockingReasons.push('model-not-entitled');
  if (quota === 'exhausted') blockingReasons.push('quota-exhausted');
  if (reachable === 'no') blockingReasons.push('unreachable');
  if (rateLimited) blockingReasons.push('rate-limited');

  if (authenticated === 'unknown') warningReasons.push('authentication-unverified');
  if (policyAllowed === 'unknown') warningReasons.push('execution-policy-unverified');
  if (modelEntitled === 'unknown') warningReasons.push('model-entitlement-unverified');
  if (quota === 'unknown') warningReasons.push('quota-unverified');
  if (reachable === 'unknown') warningReasons.push('reachability-unverified');

  const eligible = blockingReasons.length === 0;
  const confidence = !eligible
    ? 'high'
    : warningReasons.length === 0
      ? 'high'
      : authenticated === 'ok' && warningReasons.length <= 3
        ? 'medium'
        : 'low';

  return {
    provider,
    status,
    installed,
    enabled,
    authenticated,
    policyAllowed,
    modelEntitled,
    quota,
    rateLimited,
    retryAfter: extra.retryAfter || null,
    reachable,
    eligible,
    confidence,
    blockingReasons,
    warningReasons,
    evidence: {
      version: check.version || null,
      authSource: check.authSource || null,
      authEvidence: check.authEvidence || null,
      checkedAt: extra.checkedAt || now(),
      observationSource: extra.observationSource || null,
      observationReason: extra.observationReason || null,
      observationExpiresAt: extra.observationExpiresAt || null,
      observationEventId: extra.observationEventId || null,
    },
  };
}

function _availabilityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function _optionalAvailabilityEnum(value, allowed, label) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (!allowed.includes(normalized)) throw _availabilityError('availability_invalid_value', `${label} must be one of ${allowed.join('|')}`);
  return normalized;
}

function _optionalIso(value, label) {
  if (value == null || value === '') return null;
  const time = Date.parse(String(value));
  if (!Number.isFinite(time)) throw _availabilityError('availability_invalid_time', `${label} must be an ISO-compatible date/time`);
  return new Date(time).toISOString();
}

function normalizeAvailabilityObservation(value = {}) {
  const raw = value && typeof value === 'object' ? value : {};
  const provider = _string(raw.provider || '', 120);
  if (!provider) throw _availabilityError('availability_provider_required', 'provider is required');
  const model = _string(raw.model || '', 200) || null;
  if (model && !isValidModelIdentifier(model)) throw _availabilityError('availability_invalid_model', 'model is not a safe model identifier');
  const reason = _string(raw.reason || '', 160).toLowerCase();
  const defaults = AVAILABILITY_REASON_DEFAULTS[reason] || {};
  const authenticated = _optionalAvailabilityEnum(raw.authenticated != null ? raw.authenticated : defaults.authenticated, AVAILABILITY_VALUES.authentication, 'authenticated');
  const policyAllowed = _optionalAvailabilityEnum(raw.policyAllowed != null ? raw.policyAllowed : defaults.policyAllowed, AVAILABILITY_VALUES.policy, 'policyAllowed');
  const modelEntitled = _optionalAvailabilityEnum(raw.modelEntitled != null ? raw.modelEntitled : defaults.modelEntitled, AVAILABILITY_VALUES.entitlement, 'modelEntitled');
  const quota = _optionalAvailabilityEnum(raw.quota != null ? raw.quota : defaults.quota, AVAILABILITY_VALUES.quota, 'quota');
  const reachable = _optionalAvailabilityEnum(raw.reachable != null ? raw.reachable : defaults.reachable, AVAILABILITY_VALUES.reachability, 'reachable');
  const rateLimited = raw.rateLimited === true || defaults.rateLimited === true ? true : null;
  const retryAfter = _optionalIso(raw.retryAfter, 'retryAfter');
  let expiresAt = _optionalIso(raw.expiresAt, 'expiresAt');
  const ttlMin = raw.ttlMin == null || raw.ttlMin === '' ? null : Number(raw.ttlMin);
  if (ttlMin != null && (!Number.isFinite(ttlMin) || ttlMin <= 0 || ttlMin > 60 * 24 * 365)) {
    throw _availabilityError('availability_invalid_ttl', 'ttlMin must be > 0 and <= 525600');
  }
  if (!expiresAt && ttlMin != null) expiresAt = new Date(Date.now() + ttlMin * 60000).toISOString();
  if (!expiresAt && rateLimited && retryAfter) expiresAt = retryAfter;
  const hasState = [authenticated, policyAllowed, modelEntitled, quota, reachable].some(Boolean) || rateLimited === true;
  if (!hasState) throw _availabilityError('availability_state_required', 'provide a recognized --reason or at least one availability state');
  return {
    provider,
    model,
    modelFamily: inferModelFamily(model) || normalizeModelFamily(raw.modelFamily),
    reason: reason || 'manual-observation',
    authenticated,
    policyAllowed,
    modelEntitled,
    quota,
    rateLimited,
    retryAfter,
    reachable,
    observedAt: raw.observedAt ? _optionalIso(raw.observedAt, 'observedAt') : now(),
    expiresAt,
    source: _string(raw.source || '', 80) || 'user-declared',
  };
}

function _assertExecutionHistoryHealthy(root) {
  const history = readExecutionEvents(root, 2000, { preserveAll: false, maxBytes: LEDGER_MAX_BYTES });
  if (history.ok === false || history.truncated === true) {
    const error = new Error(history.error || 'execution ledger history is incomplete');
    error.code = history.code || 'ledger_history_partial';
    throw error;
  }
}

function _assertAvailabilityHistoryHealthy(root) {
  return _assertExecutionHistoryHealthy(root);
}

function _appendAvailabilityEvent(root, event, deps = {}) {
  // appendExecutionEvent performs validation and append under the same supplied
  // canonical lock; keeping a second outer lock would deadlock non-reentrant locks.
  return appendExecutionEvent(root, event, { withLock: deps.withLock });
}

function appendAvailabilityObservation(root, observation, deps = {}) {
  const normalized = normalizeAvailabilityObservation(observation);
  return _appendAvailabilityEvent(root, {
    event: 'availability.observed',
    actualExecutor: normalizeExecutorIdentity({
      provider: normalized.provider,
      model: normalized.model,
      modelFamily: normalized.modelFamily,
      identitySource: normalized.source,
    }),
    availability: normalized,
    result: { summary: normalized.reason },
    executed: false,
  }, deps);
}

function appendAvailabilityClear(root, value, deps = {}) {
  const raw = value && typeof value === 'object' ? value : {};
  const provider = _string(raw.provider || '', 120);
  if (!provider) throw _availabilityError('availability_provider_required', 'provider is required');
  const model = _string(raw.model || '', 200) || null;
  return _appendAvailabilityEvent(root, {
    event: 'availability.cleared',
    actualExecutor: normalizeExecutorIdentity({ provider, model, modelFamily: raw.modelFamily, identitySource: raw.source || 'user-declared' }),
    availability: { provider, model, reason: _string(raw.reason || 'manual-clear', 160), clearedAt: now() },
    executed: false,
  }, deps);
}

function _availabilityKey(provider, model) {
  return `${String(provider || '')}\u0000${String(model || '')}`;
}

function readAvailabilityObservations(root, limit = 2000, at = Date.now()) {
  // Availability is safety-critical state. Reconstruct it from the complete
  // bounded ledger (64 MiB maximum) instead of a tail that could silently omit
  // an old, still-active quota/auth/policy observation.
  const history = readExecutionEvents(root, limit, { preserveAll: true, maxBytes: LEDGER_MAX_BYTES });
  const active = new Map();
  for (const event of history.events || []) {
    if (!event || !['availability.observed', 'availability.cleared'].includes(event.event)) continue;
    const executor = event.actualExecutor && typeof event.actualExecutor === 'object' ? event.actualExecutor : {};
    const availability = event.availability && typeof event.availability === 'object' ? event.availability : {};
    const provider = String(availability.provider || executor.provider || '').trim();
    if (!provider) continue;
    const model = String(availability.model || executor.model || '').trim() || null;
    if (event.event === 'availability.cleared') {
      if (model) active.delete(_availabilityKey(provider, model));
      else for (const key of [...active.keys()]) if (key.startsWith(provider + '\u0000')) active.delete(key);
      continue;
    }
    const key = _availabilityKey(provider, model);
    const list = active.get(key) || [];
    list.push({ ...availability, provider, model, eventId: event.eventId, at: event.at });
    active.set(key, list);
  }
  const nowMs = Number.isFinite(Number(at)) ? Number(at) : Date.now();
  // Keep independent observations for the same target. Each axis can have its
  // own TTL; collapsing them at write/read time would either lose a restriction
  // or make a short-lived restriction permanent.
  const observations = [...active.values()].flat().filter(observation => {
    if (!observation.expiresAt) return true;
    const expires = Date.parse(String(observation.expiresAt));
    return !Number.isFinite(expires) || expires > nowMs;
  });
  const { events: _historyEvents, ...historyMeta } = history;
  return {
    ...historyMeta,
    observations,
    activeCount: observations.length,
    partial: history.ok === false || history.truncated === true,
  };
}

function availabilityExtrasForCandidate(state, candidate) {
  const provider = candidate && candidate.provider ? String(candidate.provider) : '';
  const model = candidate && candidate.model ? String(candidate.model) : null;
  const observations = state && Array.isArray(state.observations) ? state.observations : [];
  const exact = model ? observations.filter(o => o.provider === provider && o.model === model) : [];
  const providerWide = observations.filter(o => o.provider === provider && !o.model);
  if (!exact.length && !providerWide.length) return {};
  const latestValue = (list, key) => {
    for (let i = list.length - 1; i >= 0; i--) if (list[i][key] != null) return list[i][key];
    return undefined;
  };
  // Exact-model state overrides a provider-wide floor only for axes the exact
  // observations actually state. Multiple observations on one target merge by
  // latest non-null axis, preserving independent TTLs.
  const pick = (key) => {
    const exactValue = latestValue(exact, key);
    return exactValue !== undefined ? exactValue : latestValue(providerWide, key);
  };
  const evidence = providerWide.concat(exact);
  const observedTimes = evidence.map(o => o.observedAt || o.at).filter(Boolean)
    .sort((a, b) => Date.parse(String(b)) - Date.parse(String(a)));
  const expiries = evidence.map(o => o.expiresAt).filter(Boolean)
    .sort((a, b) => Date.parse(String(a)) - Date.parse(String(b)));
  return {
    authenticated: pick('authenticated'),
    policyAllowed: pick('policyAllowed'),
    modelEntitled: pick('modelEntitled'),
    quota: pick('quota'),
    rateLimited: evidence.some(o => o.rateLimited === true),
    retryAfter: pick('retryAfter') || null,
    reachable: pick('reachable'),
    checkedAt: observedTimes[0] || now(),
    observationSource: [...new Set(evidence.map(o => o.source || 'execution-ledger'))].join('+'),
    observationReason: [...new Set(evidence.map(o => o.reason).filter(Boolean))].join('+') || null,
    observationExpiresAt: expiries[0] || null,
    observationEventId: evidence.map(o => o.eventId).filter(Boolean),
  };
}

function sessionIdentityFromEnv(env = process.env) {
  const source = _string(env.LEERNESS_SESSION_IDENTITY_SOURCE || '', 80) || 'unknown';
  return normalizeExecutorIdentity({
    sessionId: env.LEERNESS_SESSION_ID,
    provider: env.LEERNESS_SESSION_PROVIDER,
    model: env.LEERNESS_SESSION_MODEL,
    modelFamily: env.LEERNESS_SESSION_MODEL_FAMILY,
    identitySource: source,
  });
}

function _providerOptionId(prefix, provider, model) {
  return `${prefix}:${encodeURIComponent(provider || '')}:${encodeURIComponent(model || '')}`;
}

function resolveRoleFallback(opts = {}) {
  const role = String(opts.role || '').trim().toLowerCase();
  const tier = ['tiny', 'normal', 'high-risk'].includes(opts.tier) ? opts.tier : 'normal';
  const { normalized, pool } = buildCandidatePool(role, opts.roleDefinition || {});
  const policy = normalizeFallbackPolicy(opts.policy || normalized.fallbackPolicy);
  const providers = Array.isArray(opts.providers) ? opts.providers : [];
  const providerMap = new Map(providers.filter(Boolean).map(p => [String(p.id), p]));
  const checkProvider = typeof opts.checkProvider === 'function' ? opts.checkProvider : () => ({ status: 'unknown' });
  const implementerIdentity = normalizeExecutorIdentity(opts.implementerIdentity || {});
  const reviewerAssessment = executor => role === 'reviewer'
    ? assessReviewerIndependence(executor, implementerIdentity)
    : { reviewerIndependent: null, status: 'not-applicable', basis: 'not-reviewer' };
  const reviewerSelectable = assessment => role !== 'reviewer' || tier !== 'high-risk' || assessment.reviewerIndependent === true;
  const assessed = pool.map((candidate, index) => {
    const definition = providerMap.get(candidate.provider) || null;
    let rawCheck = {};
    try { rawCheck = definition ? (checkProvider(definition, candidate) || {}) : {}; }
    catch (error) { rawCheck = { status: 'check-error', error: error && error.message }; }
    const availability = normalizeAvailability(definition, rawCheck, {
      provider: candidate.provider,
      ...(typeof opts.availabilityExtras === 'function'
        ? (opts.availabilityExtras(candidate, definition, rawCheck) || {})
        : {}),
    });
    return { ...candidate, index, definition, availability };
  });

  const primary = assessed[0] && assessed[0].source === 'primary' ? assessed[0] : null;
  const options = [];
  if (primary) {
    const executor = { provider: primary.provider, model: primary.model, modelFamily: primary.modelFamily || null };
    const independence = reviewerAssessment(executor);
    options.push({
      id: _providerOptionId('primary', primary.provider, primary.model),
      kind: 'primary',
      executor,
      source: primary.source,
      availability: primary.availability,
      selectable: primary.availability.eligible && reviewerSelectable(independence),
      requiresConfirmation: false,
      reviewerIndependent: independence.reviewerIndependent,
      reviewerIndependence: independence.status,
      independenceBasis: independence.basis,
      warnings: role === 'reviewer' && independence.status !== 'independent' ? [`reviewer-independence-${independence.status}`] : [],
    });
  }

  for (const candidate of assessed.slice(primary ? 1 : 0)) {
    const sameProvider = !!primary && candidate.provider === primary.provider;
    const executor = { provider: candidate.provider, model: candidate.model, modelFamily: candidate.modelFamily || null };
    const independence = reviewerAssessment(executor);
    options.push({
      id: _providerOptionId(sameProvider ? 'compatible-model' : 'compatible-provider', candidate.provider, candidate.model),
      kind: sameProvider ? 'compatible-model' : 'compatible-provider',
      executor,
      source: candidate.source,
      availability: candidate.availability,
      selectable: policy !== 'strict' && candidate.availability.eligible && reviewerSelectable(independence),
      requiresConfirmation: true,
      reviewerIndependent: independence.reviewerIndependent,
      reviewerIndependence: independence.status,
      independenceBasis: independence.basis,
      warnings: role === 'reviewer' && independence.status !== 'independent' ? [`reviewer-independence-${independence.status}`] : [],
    });
  }

  const session = opts.sessionIdentity || sessionIdentityFromEnv();
  if (policy !== 'strict') {
    const sessionWarnings = [];
    const sessionIdentityComplete = !!(session.provider && session.model);
    if (!sessionIdentityComplete) sessionWarnings.push('session-model-identity-incomplete');
    if (role === 'reviewer') sessionWarnings.push('reviewer-independence-unverified');
    const takeoverIndependence = reviewerAssessment(session);
    options.push({
      id: 'session-takeover',
      kind: 'session-takeover',
      executor: session,
      selectable: sessionIdentityComplete && reviewerSelectable(takeoverIndependence),
      requiresConfirmation: true,
      reviewerIndependent: takeoverIndependence.reviewerIndependent,
      reviewerIndependence: takeoverIndependence.status,
      independenceBasis: takeoverIndependence.basis,
      warnings: sessionWarnings.concat(role === 'reviewer' && takeoverIndependence.status !== 'independent' ? [`reviewer-independence-${takeoverIndependence.status}`] : []),
      contract: {
        action: 'session_takeover',
        role,
        executionAuthority: 'host',
        externalModelCalledByLeerness: false,
        preserveRoleContract: true,
        requireCheckpointBeforeModelSwitch: true,
      },
    });
    const directIndependence = role === 'reviewer'
      ? { reviewerIndependent: false, status: 'not-independent', basis: 'session-direct-self-review' }
      : reviewerAssessment(session);
    options.push({
      id: 'session-direct',
      kind: 'session-direct',
      executor: session,
      selectable: sessionIdentityComplete && reviewerSelectable(directIndependence),
      requiresConfirmation: true,
      reviewerIndependent: directIndependence.reviewerIndependent,
      reviewerIndependence: directIndependence.status,
      independenceBasis: directIndependence.basis,
      warnings: sessionWarnings.concat(role === 'reviewer' ? ['same-session-review-is-not-independent'] : [], role === 'reviewer' && directIndependence.status !== 'independent' ? [`reviewer-independence-${directIndependence.status}`] : []),
      contract: {
        action: 'session_direct',
        role,
        executionAuthority: 'host',
        externalModelCalledByLeerness: false,
        formalRoleDelegation: false,
        requireCheckpointBeforeModelSwitch: true,
      },
    });
  }
  options.push({
    id: 'hold',
    kind: 'hold',
    executor: null,
    selectable: true,
    requiresConfirmation: false,
    reviewerIndependence: 'not-applicable',
    contract: { action: 'hold', role, until: 'explicit-resume-or-provider-recovery' },
  });

  const primaryOption = options.find(o => o.kind === 'primary');
  const primaryReady = !!(primaryOption && primaryOption.selectable);
  const readyFallback = options.find(o => ['compatible-model', 'compatible-provider'].includes(o.kind) && o.selectable);
  let recommendedOptionId;
  let recommendationReason;
  if (primaryReady) {
    recommendedOptionId = options.find(o => o.kind === 'primary').id;
    recommendationReason = 'primary-eligible';
  } else if (tier === 'high-risk') {
    recommendedOptionId = 'hold';
    recommendationReason = 'high-risk-requires-explicit-human-selection';
  } else if (policy === 'strict') {
    recommendedOptionId = 'hold';
    recommendationReason = 'strict-policy-primary-unavailable';
  } else if (readyFallback) {
    recommendedOptionId = readyFallback.id;
    recommendationReason = 'compatible-provider-or-model-available';
  } else if (policy === 'continuity' && options.some(o => o.id === 'session-takeover' && o.selectable)) {
    recommendedOptionId = 'session-takeover';
    recommendationReason = 'continuity-policy-no-provider-candidate';
  } else {
    recommendedOptionId = 'hold';
    recommendationReason = 'no-verified-provider-candidate';
  }

  return {
    schemaVersion: 1,
    role,
    tier,
    policy,
    requirements: normalized.requirements,
    primary: primary ? {
      provider: primary.provider,
      model: primary.model,
      modelFamily: primary.modelFamily || null,
      availability: primary.availability,
    } : null,
    options,
    decision: {
      primaryReady,
      requiresUserChoice: !primaryReady,
      recommendedOptionId,
      recommendationReason,
      autoSelected: false,
    },
    implementerIdentity,
    notes: [
      'installed/enabled/authenticated/model-entitled/quota/policy are separate axes',
      'high-risk reviewer selection requires proven different model families',
      'unknown values are disclosed, not guessed',
      'high-risk fallback is never silently selected',
    ],
  };
}

function selectFallbackOption(resolution, selector = {}) {
  if (!resolution || !Array.isArray(resolution.options)) {
    return { ok: false, code: 'resolution_missing', error: 'fallback resolution is missing' };
  }
  const choice = String(selector.choice || '').trim().toLowerCase();
  let option = null;
  if (choice === 'provider' || choice === 'model') {
    const provider = String(selector.provider || '').trim();
    const model = selector.model == null ? '' : String(selector.model).trim();
    if (!provider) return { ok: false, code: 'fallback_provider_required', error: 'fallback provider is required' };
    if (choice === 'model' && !model) return { ok: false, code: 'fallback_model_required', error: 'fallback model is required' };
    if (model && !isValidModelIdentifier(model)) return { ok: false, code: 'fallback_model_invalid', error: 'fallback model is not a safe model identifier' };
    const matches = resolution.options.filter(o => o.executor && o.executor.provider === provider
      && (!model || o.executor.model === model)
      && ['primary', 'compatible-model', 'compatible-provider'].includes(o.kind));
    if (model) option = matches[0] || null;
    else {
      const selectable = matches.filter(o => o.selectable);
      if (selectable.length === 1) option = selectable[0];
      else if (selectable.length > 1 || matches.length > 1) {
        return { ok: false, code: 'fallback_choice_ambiguous', error: `multiple models match provider ${provider}; specify --model`, options: matches };
      } else option = matches[0] || null;
    }
  } else {
    const aliases = {
      primary: 'primary',
      session: 'session-takeover',
      'session-takeover': 'session-takeover',
      takeover: 'session-takeover',
      direct: 'session-direct',
      worker: 'session-direct',
      'session-direct': 'session-direct',
      hold: 'hold',
      defer: 'hold',
      pause: 'hold',
    };
    const id = aliases[choice] || choice;
    option = resolution.options.find(o => o.id === id || o.kind === id);
  }
  if (!option) return { ok: false, code: 'fallback_choice_not_found', error: `fallback choice not found: ${choice || '(empty)'}` };
  if (!option.selectable) return { ok: false, code: 'fallback_choice_blocked', error: `fallback choice is blocked by policy or availability: ${option.id}`, option };
  const isNonPrimary = option.kind !== 'primary' && option.kind !== 'hold';
  if (resolution.tier === 'high-risk' && isNonPrimary && !_string(selector.approvedBy || '', 200)) {
    return { ok: false, code: 'human_approval_required', error: 'high-risk fallback requires --approved-by', option };
  }
  return {
    ok: true,
    option,
    approvedBy: _string(selector.approvedBy || '', 200) || null,
  };
}

function executionLedgerPath(root) {
  return path.join(absRoot(root), '.leerness', 'execution-ledger.jsonl');
}

function _isSensitiveLedgerKey(value) {
  const normalized = String(value == null ? '' : value)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  if (!normalized) return false;
  // Audit metadata such as tokenCount or secretScanStatus is not a credential.
  // Keep those measurements while redacting values under credential-bearing keys.
  if (/_(?:count|total|status|state|enabled|present|source|reason|policy|type|kind|name|ref|refs|scan|scanning|usage|budget|limit|input|output|prompt|completion|estimate|estimated)$/.test(normalized)) return false;
  if (/^(?:input|output|prompt|completion)_tokens?$/.test(normalized)) return false;
  if (/(?:^|_)token(?:_|$)/.test(normalized)) return true;
  if (/(?:^|_)secret(?:_|$)/.test(normalized)) return true;
  return /(?:^|_)(?:password|passwd|pwd|api_key|private_key|secret_key|access_key|secret_access_key|authorization|proxy_authorization|auth_header|cookie|cookies|set_cookie|credential|credentials)(?:_|$)/.test(normalized);
}

function _sanitize(value, depth = 0) {
  if (depth > 7) return '[depth-limit]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return _string(value, 2000);
  if (Array.isArray(value)) return value.slice(0, 100).map(v => _sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      const safeKey = _string(key, 120);
      if (!safeKey) continue;
      out[safeKey] = _isSensitiveLedgerKey(safeKey) ? '***' : _sanitize(item, depth + 1);
    }
    return out;
  }
  return _string(value, 2000);
}

function normalizeExecutionEvent(event) {
  const payload = _plainObject(event) ? event : {};
  const eventName = _string(payload.event || '', 120);
  if (!eventName) {
    const error = new Error('execution ledger event is required');
    error.code = 'ledger_event_required';
    throw error;
  }
  const requestedExecutor = _plainObject(payload.requestedExecutor)
    ? normalizeExecutorIdentity(payload.requestedExecutor) : null;
  const actualExecutor = _plainObject(payload.actualExecutor)
    ? normalizeExecutorIdentity(payload.actualExecutor) : null;
  const review = _plainObject(payload.review) ? payload.review : null;
  const result = _plainObject(payload.result)
    ? payload.result
    : payload.result == null ? null : { summary: String(payload.result) };
  const requestedRole = _string(payload.requestedRole || payload.role || '', 120) || null;
  const attemptId = _string(payload.attemptId || '', 200) || null;
  const parentAttemptId = _string(payload.parentAttemptId || '', 200) || null;
  const reviewOfAttemptId = _string(
    payload.reviewOfAttemptId
      || (review && review.reviewOfAttemptId)
      || (eventName.startsWith('review.') ? parentAttemptId : ''),
    200,
  ) || null;
  const rawIndependent = Object.prototype.hasOwnProperty.call(payload, 'reviewerIndependent')
    ? payload.reviewerIndependent
    : review && Object.prototype.hasOwnProperty.call(review, 'reviewerIndependent')
      ? review.reviewerIndependent : null;
  const reviewerIndependent = rawIndependent === true ? true : rawIndependent === false ? false : null;
  let evidenceRefs = payload.evidenceRefs;
  if (!Array.isArray(evidenceRefs)) evidenceRefs = evidenceRefs == null ? [] : [evidenceRefs];
  if (!evidenceRefs.length && result && result.evidence != null) evidenceRefs = [result.evidence];
  evidenceRefs = evidenceRefs.map(value => _string(value, 1000)).filter(Boolean).slice(0, 100);
  const sessionId = _string(
    payload.sessionId
      || (actualExecutor && actualExecutor.sessionId)
      || (requestedExecutor && requestedExecutor.sessionId)
      || '',
    200,
  ) || null;
  return {
    ...payload,
    event: eventName,
    taskId: _string(payload.taskId || '', 200) || null,
    sessionId,
    attemptId,
    parentAttemptId,
    requestedRole,
    requestedExecutor,
    actualExecutor,
    substitution: _plainObject(payload.substitution) ? payload.substitution : null,
    reviewOfAttemptId,
    reviewerIndependent,
    result,
    evidenceRefs,
    executed: payload.executed === true,
  };
}

function appendExecutionEvent(root, event, deps = {}) {
  const file = executionLedgerPath(root);
  const payload = normalizeExecutionEvent(event);
  const canonical = {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    event: payload.event,
    eventId: payload.eventId || `evt-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}`,
    at: payload.at || now(),
    taskId: payload.taskId,
    sessionId: payload.sessionId,
    attemptId: payload.attemptId,
    parentAttemptId: payload.parentAttemptId,
    requestedRole: payload.requestedRole,
    requestedExecutor: payload.requestedExecutor,
    actualExecutor: payload.actualExecutor,
    substitution: payload.substitution,
    reviewOfAttemptId: payload.reviewOfAttemptId,
    reviewerIndependent: payload.reviewerIndependent,
    result: payload.result,
    evidenceRefs: payload.evidenceRefs,
    executed: payload.executed,
  };
  // Put canonical envelope fields first. Object-key overwrites keep their original
  // insertion order, so an extension payload with >100 keys cannot push eventId,
  // schemaVersion, or execution truth out of the bounded sanitizer.
  const record = _sanitize({ ...canonical, ...payload, ...canonical });
  const line = JSON.stringify(record) + '\n';
  const bytes = Buffer.byteLength(line, 'utf8');
  if (bytes > 128 * 1024) {
    const error = new Error(`execution ledger event too large: ${bytes} bytes`);
    error.code = 'ledger_event_too_large';
    throw error;
  }
  const write = () => {
    if (exists(file)) _assertExecutionHistoryHealthy(root);
    mkdirp(path.dirname(file));
    if (exists(file)) {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        const error = new Error(`execution ledger is not a regular file: ${file}`);
        error.code = 'ledger_not_regular_file';
        throw error;
      }
      if (stat.size + bytes > LEDGER_MAX_BYTES) {
        const error = new Error(`execution ledger would exceed ${LEDGER_MAX_BYTES} bytes`);
        error.code = 'ledger_too_large';
        throw error;
      }
    }
    fs.appendFileSync(file, line, { encoding: 'utf8', mode: 0o600 });
    return { ok: true, file, event: record };
  };
  return typeof deps.withLock === 'function' ? deps.withLock(file, write) : write();
}

function _readTail(file, maxBytes) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    const error = new Error(`execution ledger is not a regular file: ${file}`);
    error.code = 'ledger_not_regular_file';
    throw error;
  }
  const length = Math.min(stat.size, maxBytes);
  const start = Math.max(0, stat.size - length);
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    let text = buffer.toString('utf8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
    }
    return { text, truncated: start > 0 };
  } finally {
    fs.closeSync(fd);
  }
}

function readExecutionEvents(root, limit = 20, opts = {}) {
  const file = executionLedgerPath(root);
  const preserveAll = opts && opts.preserveAll === true;
  const cap = Math.max(1, Math.min(Number(limit) || 20, 2000));
  const requestedBytes = Number(opts && opts.maxBytes);
  const readBytes = Number.isFinite(requestedBytes)
    ? Math.max(1, Math.min(requestedBytes, LEDGER_MAX_BYTES))
    : LEDGER_READ_BYTES;
  if (!exists(file)) return { ok: true, code: null, error: null, file, totalRead: 0, invalidLines: 0, truncated: false, events: [] };
  try {
    const tail = _readTail(file, readBytes);
    const events = [];
    let invalidLines = 0;
    for (const line of tail.text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line);
        const valid = value && typeof value === 'object' && !Array.isArray(value)
          && value.schemaVersion === LEDGER_SCHEMA_VERSION
          && typeof value.event === 'string' && value.event.length > 0
          && typeof value.eventId === 'string' && value.eventId.length > 0;
        if (valid) events.push(value);
        else invalidLines++;
      } catch { invalidLines++; }
    }
    return {
      ok: invalidLines === 0,
      code: invalidLines ? 'ledger_invalid_lines' : null,
      error: invalidLines ? `execution ledger contains ${invalidLines} invalid line(s)` : null,
      file,
      totalRead: events.length,
      invalidLines,
      truncated: tail.truncated,
      events: preserveAll ? events : events.slice(-cap),
    };
  } catch (error) {
    return {
      ok: false,
      code: (error && error.code) || 'ledger_read_failed',
      error: error && error.message ? error.message : String(error),
      file,
      totalRead: 0,
      invalidLines: 0,
      truncated: false,
      events: [],
    };
  }
}

module.exports = {
  FALLBACK_POLICIES,
  AVAILABILITY_VALUES,
  normalizeFallbackPolicy,
  normalizeModelFamily,
  isValidModelIdentifier,
  inferModelFamily,
  normalizeExecutorIdentity,
  assessReviewerIndependence,
  validateRoleDefinitionShape,
  normalizeRoleDefinition,
  buildCandidatePool,
  normalizeAvailability,
  normalizeAvailabilityObservation,
  appendAvailabilityObservation,
  appendAvailabilityClear,
  readAvailabilityObservations,
  availabilityExtrasForCandidate,
  sessionIdentityFromEnv,
  resolveRoleFallback,
  selectFallbackOption,
  executionLedgerPath,
  normalizeExecutionEvent,
  appendExecutionEvent,
  readExecutionEvents,
};
