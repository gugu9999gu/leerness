'use strict';

// 역할은 안정적으로 유지하고 provider/model은 교체 가능한 실행 자원으로 다룬다.
// 이 모듈은 후보 평가·사용자 선택 계약·append-only provenance만 담당하며,
// 외부 모델을 직접 호출하거나 자격증명 값을 읽지 않는다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');
const { absRoot, now, assertWriteAllowed, detachCommittedHardLink } = require('./io');
const { redactSecrets, stripDefaultIgnorables, isValidModelIdentifier } = require('./pure-utils');
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
// Native v2 Provider IDs share the schema's 64-character ceiling. Persisted
// pre-v2 registry entries are read through canonicalLegacyProviderIdentity;
// new provider/role mutations must never mint a value native v2 cannot hold.
const PROVIDER_IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const LEGACY_PROVIDER_IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9._-]*$/;
const PROVENANCE_IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+~-]{0,199}$/;
const EVENT_IDENTIFIER_RE = /^[a-z][a-z0-9._-]{0,119}$/;

function _identityText(value) {
  return stripDefaultIgnorables(value, { nfkc: true, visibleIdentity: true })
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '')
    .trim();
}

function normalizeProviderIdentifier(value) {
  const provider = _identityText(value);
  return PROVIDER_IDENTIFIER_RE.test(provider) ? provider : null;
}

function _normalizeLegacyExecutorProviderIdentifier(value) {
  const provider = _identityText(value);
  return LEGACY_PROVIDER_IDENTIFIER_RE.test(provider) ? provider : null;
}

function canonicalProviderIdentity(value) {
  const raw = String(value == null ? '' : value);
  const normalized = normalizeProviderIdentifier(raw);
  // Persisted/provider-policy inputs must already use the visible canonical
  // spelling. Case remains compatible for legacy registries, while comparison
  // uses one case-insensitive identity key.
  return normalized && raw === normalized ? normalized.toLowerCase() : null;
}

function canonicalLegacyProviderIdentity(value) {
  const raw = String(value == null ? '' : value);
  const visible = _identityText(raw);
  return raw === visible && LEGACY_PROVIDER_IDENTIFIER_RE.test(visible)
    ? visible.toLowerCase()
    : null;
}

function normalizeProvenanceIdentifier(value) {
  const identifier = _identityText(value);
  return PROVENANCE_IDENTIFIER_RE.test(identifier) ? identifier : null;
}

function normalizeModelIdentifier(value) {
  const model = _identityText(value);
  return isValidModelIdentifier(model) ? model : null;
}

// Model names may legitimately start with `sk-`, so a prefix alone cannot be
// rejected. Long values that the shared redactor classifies as credentials are
// not safe provenance identifiers: persisting them would turn the audit ledger
// into a secret store.
function _credentialShapedIdentifier(value) {
  const normalized = stripDefaultIgnorables(value, { nfkc: true, visibleIdentity: true });
  return normalized.length >= 24 && redactSecrets(normalized) !== normalized;
}

function normalizeFallbackPolicy(value, fallback = 'balanced') {
  const v = String(value || '').trim().toLowerCase();
  return FALLBACK_POLICIES.includes(v) ? v : fallback;
}

function _string(value, max = 400) {
  const s = String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .trim();
  return redactSecrets(s, max).slice(0, max);
}

function normalizeModelFamily(value) {
  const family = _string(_identityText(value || ''), 160).toLowerCase();
  return family || null;
}

// Conservative derivation only for model IDs whose family is explicit in the ID.
// Provider names are intentionally not used because gateways (OpenRouter/Aider/etc.)
// can expose several unrelated model families.
function inferModelFamily(model) {
  const id = _string(_identityText(model || ''), 240).toLowerCase();
  if (!id) return null;
  const matches = new Set();
  const add = (condition, family) => { if (condition) matches.add(family); };
  add(id.includes('claude'), 'claude');
  add(id.includes('grok'), 'grok');
  add(id.includes('gemini') || id.includes('antigravity'), 'gemini');
  add(id.includes('qwen'), 'qwen');
  add(id.includes('kimi') || id.includes('moonshot'), 'kimi');
  add(id.includes('deepseek'), 'deepseek');
  add(id.includes('llama'), 'llama');
  add(id.includes('mistral') || id.includes('mixtral'), 'mistral');
  add(id.includes('command-r'), 'command-r');
  add(/(^|[\/:_.-])glm(?:[\/:_.-]|$)/.test(id), 'glm');
  add(/(^|[\/:_.-])gpt(?:[\/:_.-]|$)/.test(id) || /(^|[\/:_.-])o[1345](?:[\/:_.-]|$)/.test(id), 'openai-gpt');
  // A composite/ambiguous identifier (for example `claude-gpt-5`) cannot
  // prove reviewer independence. Fail closed instead of trusting first-match order.
  return matches.size === 1 ? matches.values().next().value : null;
}

function normalizeExecutorIdentity(value, options = {}) {
  const raw = value && typeof value === 'object' ? value : {};
  const provider = options.allowLegacyProviderIds === true
    ? _normalizeLegacyExecutorProviderIdentifier(raw.provider || '')
    : normalizeProviderIdentifier(raw.provider || '');
  const model = normalizeModelIdentifier(raw.model || '');
  const explicitFamily = normalizeModelFamily(raw.modelFamily);
  const inferredFamily = inferModelFamily(model);
  return {
    provider,
    model,
    // A recognizable model ID is stronger evidence than a conflicting label.
    // Opaque IDs may still use an explicit registry-provided family.
    modelFamily: inferredFamily || explicitFamily,
    modelFamilyEvidence: inferredFamily ? 'inferred-model-id' : explicitFamily ? 'declared' : 'missing',
    sessionId: normalizeProvenanceIdentifier(raw.sessionId || ''),
    identitySource: _string(raw.identitySource || '', 80) || 'unknown',
  };
}

// `true` is reserved for proven different providers and different concrete model
// families. A single provider can alias, proxy, or coordinate multiple model IDs,
// so it cannot supply independent review evidence by itself.
function assessReviewerIndependence(reviewerValue, implementerValue) {
  // Execution history may legitimately reference a provider registered before
  // native v2 introduced its 64-character ID ceiling. Comparison preserves that
  // canonical legacy identity; it never creates or updates a provider record.
  const legacyIdentity = { allowLegacyProviderIds: true };
  const reviewer = normalizeExecutorIdentity(reviewerValue, legacyIdentity);
  const implementer = normalizeExecutorIdentity(implementerValue, legacyIdentity);
  let reviewerIndependent = null;
  let basis = 'model-family-unverified';
  if (reviewer.sessionId && implementer.sessionId && reviewer.sessionId === implementer.sessionId) {
    reviewerIndependent = false;
    basis = 'same-session';
  } else if (reviewer.provider && implementer.provider
    && reviewer.provider.toLowerCase() === implementer.provider.toLowerCase()) {
    reviewerIndependent = false;
    basis = 'same-provider';
  } else if (reviewer.model && implementer.model && reviewer.model.toLowerCase() === implementer.model.toLowerCase()) {
    reviewerIndependent = false;
    basis = 'same-model';
  } else {
    const reviewerInferredFamily = inferModelFamily(reviewer.model);
    const implementerInferredFamily = inferModelFamily(implementer.model);
    if (reviewer.model && implementer.model && reviewerInferredFamily && implementerInferredFamily) {
      if (!reviewer.provider || !implementer.provider) {
        basis = 'provider-unverified';
      } else {
        reviewerIndependent = reviewerInferredFamily !== implementerInferredFamily;
        basis = reviewerIndependent ? 'different-provider-and-model-family' : 'same-model-family';
      }
    } else if (reviewer.modelFamily && implementer.modelFamily) {
      // User/ambient family labels are useful diagnostics, but cannot prove
      // high-risk independence for opaque model IDs.
      if (reviewer.modelFamily === implementer.modelFamily) {
        reviewerIndependent = false;
        basis = 'declared-same-model-family';
      } else basis = 'declared-model-family-unverified';
    }
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

function _candidate(value, source, options = {}) {
  const providerIdentity = options.allowLegacyProviderIds === true
    ? canonicalLegacyProviderIdentity
    : canonicalProviderIdentity;
  if (typeof value === 'string') {
    const at = value.indexOf(':');
    const provider = providerIdentity(at >= 0 ? value.slice(0, at) : value);
    const model = at >= 0 ? value.slice(at + 1).trim() : '';
    return provider ? { provider, model: model || null, modelFamily: inferModelFamily(model), source } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const provider = providerIdentity(value.provider || value.id || '');
  if (!provider) return null;
  const model = value.model == null || value.model === '' ? null : String(value.model).trim();
  return {
    provider,
    model,
    modelFamily: inferModelFamily(model) || normalizeModelFamily(value.modelFamily),
    // Provenance is assigned by the resolver path, never trusted from stored
    // user configuration (which could otherwise impersonate `primary`/`catalog`).
    source,
  };
}

function _plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Stored role configuration is policy input. Invalid nested fields must not be
// normalized away because a typo such as "strcit" -> balanced silently weakens
// the user's policy. Unknown extension fields are preserved, but every field
// consumed by the resolver is validated before the store is accepted.
function validateRoleDefinitionShape(roleName, rawDefinition, options = {}) {
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
  const providerIdentity = value => {
    const raw = String(value == null ? '' : value);
    if (options.allowLegacyProviderIds === true) {
      const visible = _identityText(raw);
      return raw === visible && LEGACY_PROVIDER_IDENTIFIER_RE.test(visible) ? visible.toLowerCase() : null;
    }
    return canonicalProviderIdentity(raw);
  };
  const validateCandidate = (value, label) => {
    if (typeof value === 'string') {
      const at = value.indexOf(':');
      const providerRaw = at >= 0 ? value.slice(0, at) : value;
      const provider = providerIdentity(providerRaw);
      const model = at >= 0 ? value.slice(at + 1).trim() : '';
      if (!provider) return `${label}.provider is empty`;
      if (/[\r\n\u2028\u2029]/.test(provider)) return `${label}.provider contains a line separator`;
      if (model && !isValidModelIdentifier(model)) return `${label}.model is not a safe model identifier`;
      return null;
    }
    if (!_plainObject(value)) return `${label} must be a string or object`;
    if (value.provider != null && typeof value.provider !== 'string') return `${label}.provider must be a string`;
    if (value.id != null && typeof value.id !== 'string') return `${label}.id must be a string`;
    const providerValue = value.provider || value.id || '';
    const provider = providerIdentity(providerValue);
    if (!provider) return `${label}.provider is empty`;
    if (/[\r\n\u2028\u2029]/.test(provider)) return `${label}.provider contains a line separator`;
    if (value.provider != null && value.id != null
      && providerIdentity(value.provider) !== providerIdentity(value.id)) return `${label}.provider conflicts with ${label}.id`;
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

function normalizeRoleDefinition(roleName, rawDefinition, options = {}) {
  const role = String(roleName || '').trim().toLowerCase();
  const raw = rawDefinition && typeof rawDefinition === 'object' ? rawDefinition : {};
  const primaryRaw = raw.primary && typeof raw.primary === 'object' ? raw.primary : raw;
  const primary = _candidate(primaryRaw, 'primary', options);
  const explicit = Array.isArray(raw.candidates)
    ? raw.candidates
    : Array.isArray(raw.fallbacks)
      ? raw.fallbacks
      : [];
  const candidates = [];
  const seen = new Set(primary ? [`${primary.provider}\u0000${primary.model || ''}`] : []);
  for (const item of explicit) {
    const c = _candidate(item, 'configured', options);
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
  const normalized = normalizeRoleDefinition(roleName, rawDefinition, opts);
  const catalog = opts.roleCatalog || ROLE_CATALOG;
  const roleDef = catalog && Object.prototype.hasOwnProperty.call(catalog, normalized.role)
    ? catalog[normalized.role]
    : {};
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
  // Authentication denial is fail-closed across both evidence sources. A stale
  // positive observation must not mask a current CLI denial, and a stale/limited
  // CLI positive must not mask a recorded credentials-expired denial.
  const checkedAuth = _enum(check.auth, AVAILABILITY_VALUES.authentication);
  const observedAuth = extra.authenticated == null
    ? 'unknown'
    : _enum(extra.authenticated, AVAILABILITY_VALUES.authentication);
  const authenticated = checkedAuth === 'no' || observedAuth === 'no'
    ? 'no'
    : observedAuth !== 'unknown'
      ? observedAuth
      : checkedAuth;
  const policyAllowed = _enum(extra.policyAllowed, AVAILABILITY_VALUES.policy);
  const modelEntitled = _enum(extra.modelEntitled, AVAILABILITY_VALUES.entitlement);
  const quota = _enum(extra.quota, AVAILABILITY_VALUES.quota);
  const reachable = _enum(extra.reachable || (status === 'ready' ? 'yes' : 'unknown'), AVAILABILITY_VALUES.reachability);
  const rateLimited = extra.rateLimited == null ? null : extra.rateLimited === true;
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
  if (rateLimited === true) blockingReasons.push('rate-limited');

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
  const provider = canonicalProviderIdentity(raw.provider || '');
  if (!provider) throw _availabilityError('availability_provider_required', 'provider is required');
  if (_credentialShapedIdentifier(provider)) throw _availabilityError('availability_sensitive_provider', 'provider resembles a credential and cannot be persisted');
  const modelRaw = raw.model == null || raw.model === '' ? '' : String(raw.model);
  const model = modelRaw ? normalizeModelIdentifier(modelRaw) : null;
  if (modelRaw && !model) throw _availabilityError('availability_invalid_model', 'model is not a safe model identifier');
  if (model && _credentialShapedIdentifier(model)) throw _availabilityError('availability_sensitive_model', 'model resembles a credential and cannot be persisted');
  const reason = _string(raw.reason || '', 160).toLowerCase();
  const defaults = AVAILABILITY_REASON_DEFAULTS[reason] || {};
  const authenticated = _optionalAvailabilityEnum(raw.authenticated != null ? raw.authenticated : defaults.authenticated, AVAILABILITY_VALUES.authentication, 'authenticated');
  const policyAllowed = _optionalAvailabilityEnum(raw.policyAllowed != null ? raw.policyAllowed : defaults.policyAllowed, AVAILABILITY_VALUES.policy, 'policyAllowed');
  const modelEntitled = _optionalAvailabilityEnum(raw.modelEntitled != null ? raw.modelEntitled : defaults.modelEntitled, AVAILABILITY_VALUES.entitlement, 'modelEntitled');
  const quota = _optionalAvailabilityEnum(raw.quota != null ? raw.quota : defaults.quota, AVAILABILITY_VALUES.quota, 'quota');
  const reachable = _optionalAvailabilityEnum(raw.reachable != null ? raw.reachable : defaults.reachable, AVAILABILITY_VALUES.reachability, 'reachable');
  let rateLimited = defaults.rateLimited === true ? true : null;
  if (Object.prototype.hasOwnProperty.call(raw, 'rateLimited')) {
    if (raw.rateLimited !== null && typeof raw.rateLimited !== 'boolean') {
      throw _availabilityError('availability_invalid_value', 'rateLimited must be true, false, or null');
    }
    rateLimited = raw.rateLimited;
  }
  const retryAfter = _optionalIso(raw.retryAfter, 'retryAfter');
  let expiresAt = _optionalIso(raw.expiresAt, 'expiresAt');
  const ttlMin = raw.ttlMin == null || raw.ttlMin === '' ? null : Number(raw.ttlMin);
  if (ttlMin != null && (!Number.isFinite(ttlMin) || ttlMin <= 0 || ttlMin > 60 * 24 * 365)) {
    throw _availabilityError('availability_invalid_ttl', 'ttlMin must be > 0 and <= 525600');
  }
  if (!expiresAt && ttlMin != null) expiresAt = new Date(Date.now() + ttlMin * 60000).toISOString();
  if (!expiresAt && rateLimited && retryAfter) expiresAt = retryAfter;
  const hasState = [authenticated, policyAllowed, modelEntitled, quota, reachable].some(Boolean) || rateLimited !== null;
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
  const history = readExecutionEvents(root, 2000, { preserveAll: true, maxBytes: LEDGER_MAX_BYTES });
  if (history.ok === false || history.truncated === true) {
    const error = new Error(history.error || 'execution ledger history is incomplete');
    error.code = history.code || 'ledger_history_partial';
    throw error;
  }
  let invalidAvailabilityEvents = 0;
  for (const event of history.events) {
    if (!event || !['availability.observed', 'availability.cleared'].includes(event.event)) continue;
    try { _normalizeStoredAvailabilityEvent(event); }
    catch { invalidAvailabilityEvents += 1; }
  }
  if (invalidAvailabilityEvents) {
    const error = new Error(`execution ledger contains ${invalidAvailabilityEvents} invalid availability event(s)`);
    error.code = 'availability_events_invalid';
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
  const provider = canonicalProviderIdentity(raw.provider || '');
  if (!provider) throw _availabilityError('availability_provider_required', 'provider is required');
  if (_credentialShapedIdentifier(provider)) throw _availabilityError('availability_sensitive_provider', 'provider resembles a credential and cannot be persisted');
  const modelRaw = raw.model == null || raw.model === '' ? '' : String(raw.model);
  const model = modelRaw ? normalizeModelIdentifier(modelRaw) : null;
  if (modelRaw && !model) throw _availabilityError('availability_invalid_model', 'model is not a safe model identifier');
  if (model && _credentialShapedIdentifier(model)) throw _availabilityError('availability_sensitive_model', 'model resembles a credential and cannot be persisted');
  return _appendAvailabilityEvent(root, {
    event: 'availability.cleared',
    actualExecutor: normalizeExecutorIdentity({ provider, model, modelFamily: raw.modelFamily, identitySource: raw.source || 'user-declared' }),
    availability: { provider, model, reason: _string(raw.reason || 'manual-clear', 160), clearedAt: now() },
    executed: false,
  }, deps);
}

function _availabilityKey(provider, model) {
  return `${canonicalProviderIdentity(provider) || ''}\u0000${String(model || '')}`;
}

function _normalizeStoredAvailabilityEvent(event) {
  if (!_plainObject(event) || !_plainObject(event.availability)) {
    throw _availabilityError('availability_event_invalid', 'availability event must contain an availability object');
  }
  const availability = event.availability;
  const executor = _plainObject(event.actualExecutor) ? event.actualExecutor : {};
  const availabilityProvider = availability.provider == null || availability.provider === ''
    ? null : canonicalProviderIdentity(availability.provider);
  const executorProvider = executor.provider == null || executor.provider === ''
    ? null : canonicalProviderIdentity(executor.provider);
  if ((availability.provider && !availabilityProvider) || (executor.provider && !executorProvider)) {
    throw _availabilityError('availability_event_invalid', 'availability provider identity is not canonical');
  }
  if (availabilityProvider && executorProvider && availabilityProvider !== executorProvider) {
    throw _availabilityError('availability_event_invalid', 'availability provider conflicts with actualExecutor.provider');
  }
  const provider = availabilityProvider || executorProvider;
  if (!provider) throw _availabilityError('availability_provider_required', 'provider is required');
  if (_credentialShapedIdentifier(provider)) throw _availabilityError('availability_sensitive_provider', 'provider resembles a credential and cannot be persisted');

  const availabilityModelRaw = availability.model == null || availability.model === '' ? '' : String(availability.model);
  const executorModelRaw = executor.model == null || executor.model === '' ? '' : String(executor.model);
  const availabilityModel = availabilityModelRaw ? normalizeModelIdentifier(availabilityModelRaw) : null;
  const executorModel = executorModelRaw ? normalizeModelIdentifier(executorModelRaw) : null;
  if ((availabilityModelRaw && !availabilityModel) || (executorModelRaw && !executorModel)) {
    throw _availabilityError('availability_invalid_model', 'model is not a safe model identifier');
  }
  if (availabilityModel && executorModel && availabilityModel !== executorModel) {
    throw _availabilityError('availability_event_invalid', 'availability model conflicts with actualExecutor.model');
  }
  const model = availabilityModel || executorModel;
  if (model && _credentialShapedIdentifier(model)) throw _availabilityError('availability_sensitive_model', 'model resembles a credential and cannot be persisted');

  if (event.event === 'availability.cleared') {
    const clearedAt = _optionalIso(availability.clearedAt || event.at, 'clearedAt');
    if (!clearedAt) throw _availabilityError('availability_invalid_time', 'clearedAt or event.at is required');
    return {
      kind: 'cleared',
      provider,
      model,
      availability: {
        ...availability,
        provider,
        model,
        reason: _string(availability.reason || 'manual-clear', 160),
        clearedAt,
      },
    };
  }

  const observedAt = _optionalIso(availability.observedAt || event.at, 'observedAt');
  if (!observedAt) throw _availabilityError('availability_invalid_time', 'observedAt or event.at is required');
  const normalized = normalizeAvailabilityObservation({
    ...availability,
    provider,
    model,
    observedAt,
    source: availability.source || executor.identitySource || 'execution-ledger',
  });
  return { kind: 'observed', provider, model, availability: normalized };
}

function readAvailabilityObservations(root, limit = 2000, at = Date.now()) {
  // Availability is safety-critical state. Reconstruct it from the complete
  // bounded ledger (64 MiB maximum) instead of a tail that could silently omit
  // an old, still-active quota/auth/policy observation.
  const history = readExecutionEvents(root, limit, { preserveAll: true, maxBytes: LEDGER_MAX_BYTES });
  const active = new Map();
  let ledgerOrdinal = 0;
  let invalidAvailabilityEvents = 0;
  for (const event of history.events || []) {
    ledgerOrdinal += 1;
    if (!event || !['availability.observed', 'availability.cleared'].includes(event.event)) continue;
    let stored;
    try { stored = _normalizeStoredAvailabilityEvent(event); }
    catch { invalidAvailabilityEvents += 1; continue; }
    const { provider, model, availability } = stored;
    if (stored.kind === 'cleared') {
      if (model) active.delete(_availabilityKey(provider, model));
      else for (const key of [...active.keys()]) if (key.startsWith(provider + '\u0000')) active.delete(key);
      continue;
    }
    const key = _availabilityKey(provider, model);
    const list = active.get(key) || [];
    list.push({ ...availability, provider, model, eventId: event.eventId, at: event.at, ledgerOrdinal });
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
  const revision = `availability:sha256:${crypto.createHash('sha256')
    .update(JSON.stringify(observations
      .slice()
      .sort((a, b) => Number(a.ledgerOrdinal || 0) - Number(b.ledgerOrdinal || 0))
      .map(observation => ({
        eventId: observation.eventId || null,
        provider: observation.provider,
        model: observation.model || null,
        authenticated: observation.authenticated == null ? null : observation.authenticated,
        policyAllowed: observation.policyAllowed == null ? null : observation.policyAllowed,
        modelEntitled: observation.modelEntitled == null ? null : observation.modelEntitled,
        quota: observation.quota == null ? null : observation.quota,
        rateLimited: observation.rateLimited == null ? null : observation.rateLimited,
        reachable: observation.reachable == null ? null : observation.reachable,
        expiresAt: observation.expiresAt || null,
      }))))
    .digest('hex')}`;
  const { events: _historyEvents, ...historyMeta } = history;
  const semanticInvalid = invalidAvailabilityEvents > 0;
  return {
    ...historyMeta,
    ok: history.ok !== false && !semanticInvalid,
    code: semanticInvalid ? 'availability_events_invalid' : historyMeta.code,
    error: semanticInvalid
      ? `execution ledger contains ${invalidAvailabilityEvents} invalid availability event(s)`
      : historyMeta.error,
    observations,
    revision,
    activeCount: observations.length,
    invalidAvailabilityEvents,
    partial: history.ok === false || history.truncated === true || semanticInvalid,
  };
}

function availabilityExtrasForCandidate(state, candidate) {
  const provider = canonicalProviderIdentity(candidate && candidate.provider ? candidate.provider : '') || '';
  const model = candidate && candidate.model ? String(candidate.model) : null;
  const observations = state && Array.isArray(state.observations) ? state.observations : [];
  // Retain ledger order. A provider-wide statement applies to every model and
  // a model-specific statement applies only to that model; for each axis, the
  // newest applicable statement wins regardless of specificity. This prevents
  // an old model-level allow from defeating a newer provider-wide denial.
  const evidence = observations
    .filter(o => o.provider === provider && (!o.model || (model && o.model === model)))
    .sort((a, b) => Number(a.ledgerOrdinal || 0) - Number(b.ledgerOrdinal || 0));
  if (!evidence.length) return {};
  const latestValue = (list, key) => {
    for (let i = list.length - 1; i >= 0; i--) if (list[i][key] != null) return list[i][key];
    return undefined;
  };
  const pick = (key) => latestValue(evidence, key);
  const observedTimes = evidence.map(o => o.observedAt || o.at).filter(Boolean)
    .sort((a, b) => Date.parse(String(b)) - Date.parse(String(a)));
  const expiries = evidence.map(o => o.expiresAt).filter(Boolean)
    .sort((a, b) => Date.parse(String(a)) - Date.parse(String(b)));
  return {
    authenticated: pick('authenticated'),
    policyAllowed: pick('policyAllowed'),
    modelEntitled: pick('modelEntitled'),
    quota: pick('quota'),
    rateLimited: pick('rateLimited') == null ? null : pick('rateLimited') === true,
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
  const mcpConnectionId = normalizeProvenanceIdentifier(env.LEERNESS_MCP_CONNECTION_ID || '');
  const source = mcpConnectionId
    ? 'mcp-connection'
    : (_string(env.LEERNESS_SESSION_IDENTITY_SOURCE || '', 80) || 'unknown');
  return normalizeExecutorIdentity({
    sessionId: mcpConnectionId || env.LEERNESS_SESSION_ID,
    provider: env.LEERNESS_SESSION_PROVIDER,
    model: env.LEERNESS_SESSION_MODEL,
    modelFamily: env.LEERNESS_SESSION_MODEL_FAMILY,
    identitySource: source,
  }, { allowLegacyProviderIds: true });
}

function _providerOptionId(prefix, provider, model) {
  return `${prefix}:${encodeURIComponent(provider || '')}:${encodeURIComponent(model || '')}`;
}

function resolveRoleFallback(opts = {}) {
  const role = String(opts.role || '').trim().toLowerCase();
  const tier = ['tiny', 'normal', 'high-risk'].includes(opts.tier) ? opts.tier : 'normal';
  const { normalized, pool } = buildCandidatePool(role, opts.roleDefinition || {}, {
    allowLegacyProviderIds: opts.allowLegacyProviderIds === true,
    roleCatalog: opts.roleCatalog,
  });
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
      'high-risk reviewer selection requires distinct providers and proven different model families',
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
  const approvedBy = normalizeApprover(selector.approvedBy);
  if (resolution.tier === 'high-risk' && isNonPrimary && !approvedBy) {
    return { ok: false, code: 'human_approval_required', error: 'high-risk fallback requires --approved-by', option };
  }
  return {
    ok: true,
    option,
    approvedBy: approvedBy || null,
  };
}

function normalizeApprover(value) {
  const text = _identityText(value);
  // Punctuation/symbol-only values are visible but do not identify an approver or
  // communicate a meaningful downgrade reason. Require at least one letter/number.
  if (!text || !/[\p{L}\p{N}]/u.test(text)) return '';
  const safe = _string(text, 200);
  return /[\p{L}\p{N}]/u.test(safe) ? safe : '';
}

function executionLedgerPath(root) {
  return path.join(absRoot(root), '.leerness', 'execution-ledger.jsonl');
}

function _isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function _realpath(value) {
  return typeof fs.realpathSync.native === 'function' ? fs.realpathSync.native(value) : fs.realpathSync(value);
}

function _ledgerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function _assertExecutionLedgerBoundary(root, options = {}) {
  const absoluteRoot = absRoot(root);
  let rootStat;
  try { rootStat = fs.statSync(absoluteRoot); }
  catch { throw _ledgerError('ledger_root_unavailable', `execution ledger root is unavailable: ${absoluteRoot}`); }
  if (!rootStat.isDirectory()) throw _ledgerError('ledger_root_invalid', `execution ledger root is not a directory: ${absoluteRoot}`);
  const realRoot = _realpath(absoluteRoot);
  const harness = path.join(absoluteRoot, '.leerness');
  let stat;
  try { stat = fs.lstatSync(harness); }
  catch (error) {
    if (!(error && error.code === 'ENOENT')) throw _ledgerError('ledger_parent_unreadable', `execution ledger parent cannot be inspected: ${harness}`);
    if (!options.create) return { exists: false, absoluteRoot, realRoot, harness };
    try { fs.mkdirSync(harness); }
    catch (mkdirError) {
      if (!(mkdirError && mkdirError.code === 'EEXIST')) throw _ledgerError('ledger_parent_unavailable', `execution ledger parent cannot be created: ${harness}`);
    }
    try { stat = fs.lstatSync(harness); }
    catch { throw _ledgerError('ledger_parent_unreadable', `execution ledger parent cannot be inspected after creation: ${harness}`); }
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw _ledgerError('ledger_parent_linked', `execution ledger parent must be a project-local directory: ${harness}`);
  }
  let realHarness;
  try { realHarness = _realpath(harness); }
  catch { throw _ledgerError('ledger_parent_unreadable', `execution ledger parent cannot be resolved: ${harness}`); }
  if (!_isWithin(realRoot, realHarness)) {
    throw _ledgerError('ledger_parent_escape', `execution ledger parent resolves outside the project: ${harness}`);
  }
  return {
    exists: true,
    absoluteRoot,
    realRoot,
    harness,
    realHarness,
    harnessIdentity: { dev: stat.dev, ino: stat.ino },
  };
}

function _sameLedgerIdentity(a, b) {
  return !!a && !!b && String(a.dev) === String(b.dev) && String(a.ino) === String(b.ino);
}

function _sameLedgerSnapshot(a, b) {
  return _sameLedgerIdentity(a, b)
    && Number(a.size) === Number(b.size)
    && Number(a.mtimeMs) === Number(b.mtimeMs)
    && Number(a.ctimeMs) === Number(b.ctimeMs);
}

function _assertExecutionLedgerBoundaryUnchanged(boundary) {
  if (!boundary || boundary.exists !== true || !boundary.harnessIdentity) {
    throw _ledgerError('ledger_parent_changed', 'execution ledger parent changed during operation');
  }
  let stat;
  try { stat = fs.lstatSync(boundary.harness); }
  catch { throw _ledgerError('ledger_parent_changed', 'execution ledger parent changed during operation'); }
  if (stat.isSymbolicLink() || !stat.isDirectory() || !_sameLedgerIdentity(stat, boundary.harnessIdentity)) {
    throw _ledgerError('ledger_parent_changed', 'execution ledger parent changed during operation');
  }
  let realHarness;
  try { realHarness = _realpath(boundary.harness); }
  catch { throw _ledgerError('ledger_parent_changed', 'execution ledger parent changed during operation'); }
  if (realHarness !== boundary.realHarness || !_isWithin(boundary.realRoot, realHarness)) {
    throw _ledgerError('ledger_parent_changed', 'execution ledger parent changed during operation');
  }
  return stat;
}

function _executionLedgerLstat(file) {
  try { return fs.lstatSync(file); }
  catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw _ledgerError('ledger_unreadable', `execution ledger cannot be inspected: ${file}`);
  }
}

function _assertExecutionLedgerFile(file, stat = fs.lstatSync(file)) {
  if (!stat.isFile() || stat.isSymbolicLink()) {
    const error = new Error(`execution ledger is not a regular file: ${file}`);
    error.code = 'ledger_not_regular_file';
    throw error;
  }
  // Shared file identity lets a write under this project's lock alter another
  // path/project. Match the role-store fail-closed boundary for hard links.
  if (Number(stat.nlink) > 1) {
    const error = new Error(`execution ledger is hard-linked: ${file}`);
    error.code = 'ledger_hard_link_rejected';
    throw error;
  }
  return stat;
}

function _isSensitiveLedgerKey(value) {
  const normalized = stripDefaultIgnorables(value, { nfkc: true, visibleIdentity: true })
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  if (!normalized) return false;
  // Only narrowly named measurements are exempt. Generic suffix exemptions such
  // as `input`/`output` let apiKeyInput and passwordOutput leak into the ledger.
  if (/^(?:input|output|prompt|completion)_tokens?$/.test(normalized)) return false;
  if (/^(?:token_(?:count|total|status|state|usage|budget|limit|estimate|estimated)|secret_scan_(?:status|state|count|total))$/.test(normalized)) return false;
  // Acronym-heavy camel case (`APIKey`, `clientAPIKey`, `JWTToken`) does not
  // always produce underscore boundaries. Inspect a compact form after the
  // explicit metric exemptions so those credential keys cannot evade masking.
  const compact = normalized.replace(/_/g, '');
  return /(?:token|secret|password|passwd|passphrase|apikey|privatekey|accesskey|authorization|authheader|cookie|credential|bearer|pwd)/.test(compact);
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
  const eventNameRaw = _identityText(payload.event || '').toLowerCase();
  const eventName = EVENT_IDENTIFIER_RE.test(eventNameRaw) ? eventNameRaw : '';
  if (!eventName) {
    const error = new Error('execution ledger event is required');
    error.code = 'ledger_event_required';
    throw error;
  }
  const executorIdentifiers = [
    payload.requestedExecutor && payload.requestedExecutor.provider,
    payload.requestedExecutor && payload.requestedExecutor.model,
    payload.actualExecutor && payload.actualExecutor.provider,
    payload.actualExecutor && payload.actualExecutor.model,
    payload.review && payload.review.reviewOf && payload.review.reviewOf.provider,
    payload.review && payload.review.reviewOf && payload.review.reviewOf.model,
    payload.availability && payload.availability.provider,
    payload.availability && payload.availability.model,
  ].filter(value => value != null && value !== '');
  if (executorIdentifiers.some(_credentialShapedIdentifier)) {
    const error = new Error('execution ledger executor identifier resembles a credential');
    error.code = 'ledger_sensitive_identifier';
    throw error;
  }
  const requestedExecutor = _plainObject(payload.requestedExecutor)
    ? normalizeExecutorIdentity(payload.requestedExecutor, { allowLegacyProviderIds: true }) : null;
  const actualExecutor = _plainObject(payload.actualExecutor)
    ? normalizeExecutorIdentity(payload.actualExecutor, { allowLegacyProviderIds: true }) : null;
  const review = _plainObject(payload.review) ? payload.review : null;
  const result = _plainObject(payload.result)
    ? payload.result
    : payload.result == null ? null : { summary: String(payload.result) };
  const requestedRole = normalizeProvenanceIdentifier(payload.requestedRole || payload.role || '');
  const eventId = normalizeProvenanceIdentifier(payload.eventId || '');
  const attemptId = normalizeProvenanceIdentifier(payload.attemptId || '');
  const parentAttemptId = normalizeProvenanceIdentifier(payload.parentAttemptId || '');
  const reviewOfAttemptId = normalizeProvenanceIdentifier(
    payload.reviewOfAttemptId
      || (review && review.reviewOfAttemptId)
      || (eventName.startsWith('review.') ? parentAttemptId : ''),
  );
  const rawIndependent = Object.prototype.hasOwnProperty.call(payload, 'reviewerIndependent')
    ? payload.reviewerIndependent
    : review && Object.prototype.hasOwnProperty.call(review, 'reviewerIndependent')
      ? review.reviewerIndependent : null;
  const reviewerIndependent = rawIndependent === true ? true : rawIndependent === false ? false : null;
  let evidenceRefs = payload.evidenceRefs;
  if (!Array.isArray(evidenceRefs)) evidenceRefs = evidenceRefs == null ? [] : [evidenceRefs];
  if (!evidenceRefs.length && result && result.evidence != null) evidenceRefs = [result.evidence];
  evidenceRefs = evidenceRefs
    .map(value => _string(stripDefaultIgnorables(value, { visibleIdentity: true }), 1000))
    .filter(Boolean)
    .slice(0, 100);
  const sessionId = normalizeProvenanceIdentifier(
    payload.sessionId
      || (actualExecutor && actualExecutor.sessionId)
      || (requestedExecutor && requestedExecutor.sessionId)
      || '',
  );
  return {
    ...payload,
    event: eventName,
    eventId,
    taskId: normalizeProvenanceIdentifier(payload.taskId || ''),
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

const TERMINAL_EXECUTION_EVENTS = Object.freeze([
  'execution.completed', 'execution.failed', 'review.completed', 'validation.completed',
]);

function executionEventSemanticProblem(value) {
  let event;
  try { event = normalizeExecutionEvent(value); }
  catch (error) { return { code: (error && error.code) || 'ledger_event_invalid', message: (error && error.message) || String(error) }; }
  if (!TERMINAL_EXECUTION_EVENTS.includes(event.event)) return null;
  const missing = [];
  if (!event.taskId) missing.push('taskId');
  if (!event.attemptId) missing.push('attemptId');
  if (!event.actualExecutor || !event.actualExecutor.provider) missing.push('actualExecutor.provider');
  if (!Array.isArray(event.evidenceRefs) || event.evidenceRefs.length === 0) missing.push('evidenceRefs');
  if (event.event !== 'execution.failed' && event.executed !== true) missing.push('executed=true');
  if (['review.completed', 'validation.completed'].includes(event.event) && !event.parentAttemptId) missing.push('parentAttemptId');
  if (event.requestedRole && !event.parentAttemptId) missing.push('parentAttemptId-for-requestedRole');
  return missing.length
    ? { code: 'ledger_terminal_incomplete', message: `terminal execution event is missing: ${missing.join(', ')}` }
    : null;
}

function _restoreCanonicalExecutorIdentity(sanitized, canonical) {
  if (!canonical) return null;
  return {
    ...(sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized) ? sanitized : {}),
    provider: canonical.provider,
    model: canonical.model,
    modelFamily: canonical.modelFamily,
    modelFamilyEvidence: canonical.modelFamilyEvidence,
    sessionId: canonical.sessionId,
    identitySource: canonical.identitySource,
  };
}

function _sanitizeExecutionRecord(payload, canonical) {
  const record = _sanitize({ ...canonical, ...payload, ...canonical });
  // Canonical envelope identifiers are identifiers, not credential values. A
  // token-shaped but valid task/model/session ID must remain byte-stable or the
  // successful append would create a line that its own reader rejects.
  for (const key of [
    'schemaVersion', 'event', 'eventId', 'at', 'taskId', 'sessionId', 'attemptId',
    'parentAttemptId', 'requestedRole', 'reviewOfAttemptId', 'reviewerIndependent', 'executed',
  ]) record[key] = canonical[key];
  record.requestedExecutor = _restoreCanonicalExecutorIdentity(record.requestedExecutor, canonical.requestedExecutor);
  record.actualExecutor = _restoreCanonicalExecutorIdentity(record.actualExecutor, canonical.actualExecutor);
  if (record.review && canonical.review && canonical.review.reviewOf) {
    record.review.reviewOf = _restoreCanonicalExecutorIdentity(record.review.reviewOf, canonical.review.reviewOf);
  }
  return record;
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
    review: payload.review,
    result: payload.result,
    evidenceRefs: payload.evidenceRefs,
    executed: payload.executed,
  };
  // Put canonical envelope fields first. Object-key overwrites keep their original
  // insertion order, so an extension payload with >100 keys cannot push eventId,
  // schemaVersion, or execution truth out of the bounded sanitizer.
  const record = _sanitizeExecutionRecord(payload, canonical);
  const finalNormalized = normalizeExecutionEvent(record);
  const semanticProblem = executionEventSemanticProblem(finalNormalized);
  const line = JSON.stringify(record) + '\n';
  const bytes = Buffer.byteLength(line, 'utf8');
  if (bytes > 128 * 1024) {
    const error = new Error(`execution ledger event too large: ${bytes} bytes`);
    error.code = 'ledger_event_too_large';
    throw error;
  }
  // Descriptor writes bypass the global fs path wrappers, so enforce dry-run
  // before any parent or scratch path can be created.
  assertWriteAllowed(file);
  // Validate the parent before the shared lock creates its sibling lock path.
  // Otherwise a linked `.leerness` directory could redirect even lock metadata
  // outside the project before the append callback gets a chance to reject it.
  _assertExecutionLedgerBoundary(root, { create: true });
  const beforeLock = _executionLedgerLstat(file);
  if (beforeLock) _assertExecutionLedgerFile(file, beforeLock);
  const write = () => {
    const boundary = _assertExecutionLedgerBoundary(root, { create: false });
    _assertExecutionLedgerBoundaryUnchanged(boundary);
    const current = _executionLedgerLstat(file);
    if (current) _assertExecutionHistoryHealthy(root);
    if (current) {
      const stat = _assertExecutionLedgerFile(file, current);
      if (stat.size + bytes > LEDGER_MAX_BYTES) {
        const error = new Error(`execution ledger would exceed ${LEDGER_MAX_BYTES} bytes`);
        error.code = 'ledger_too_large';
        throw error;
      }
    }
    if (semanticProblem) {
      const error = new Error(semanticProblem.message);
      error.code = semanticProblem.code;
      throw error;
    }
    const lineBytes = Buffer.from(line, 'utf8');
    if (current) _appendExecutionLedgerBytes(file, lineBytes, current, boundary);
    else _createExecutionLedger(file, lineBytes, boundary);
    return { ok: true, file, event: record };
  };
  return typeof deps.withLock === 'function' ? deps.withLock(file, write) : write();
}

function _writeAll(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const written = fs.writeSync(fd, buffer, offset, buffer.length - offset, null);
    if (!Number.isInteger(written) || written <= 0) throw _ledgerError('ledger_write_failed', 'execution ledger write made no progress');
    offset += written;
  }
}

function _appendExecutionLedgerBytes(file, bytes, expectedStat, boundary) {
  const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | noFollow);
    const opened = _assertExecutionLedgerFile(file, fs.fstatSync(fd));
    const pathStat = _assertExecutionLedgerFile(file, fs.lstatSync(file));
    _assertExecutionLedgerBoundaryUnchanged(boundary);
    if (!_sameLedgerSnapshot(opened, expectedStat) || !_sameLedgerIdentity(opened, pathStat)) {
      throw _ledgerError('ledger_file_changed', 'execution ledger changed before append');
    }
    if (Number(opened.size) + bytes.length > LEDGER_MAX_BYTES) {
      throw _ledgerError('ledger_too_large', `execution ledger would exceed ${LEDGER_MAX_BYTES} bytes`);
    }
    _writeAll(fd, bytes);
    const afterHandle = fs.fstatSync(fd);
    const afterPath = _assertExecutionLedgerFile(file, fs.lstatSync(file));
    _assertExecutionLedgerBoundaryUnchanged(boundary);
    if (!_sameLedgerIdentity(opened, afterHandle) || !_sameLedgerIdentity(afterHandle, afterPath)
      || Number(afterHandle.size) !== Number(opened.size) + bytes.length) {
      throw _ledgerError('ledger_file_changed', 'execution ledger changed during append');
    }
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function _createExecutionLedger(file, bytes, boundary) {
  const temporary = path.join(path.dirname(file), `.execution-ledger-create-${process.pid}-${crypto.randomBytes(12).toString('hex')}`);
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    _assertExecutionLedgerBoundaryUnchanged(boundary);
    // The random source lives in the validated parent. A pathname swap makes
    // that source absent in the replacement directory, while link remains an
    // exclusive install and cannot overwrite a competing creator.
    fs.linkSync(temporary, file);
    detachCommittedHardLink(temporary, file, bytes);
    _assertExecutionLedgerBoundaryUnchanged(boundary);
    const installed = _assertExecutionLedgerFile(file, fs.lstatSync(file));
    if (Number(installed.nlink) !== 1 || !fs.readFileSync(file).equals(bytes)) {
      throw _ledgerError('ledger_file_changed', 'new execution ledger failed post-install validation');
    }
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function _readTail(file, maxBytes, expectedStat, boundary) {
  const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
  try {
    const stat = _assertExecutionLedgerFile(file, fs.fstatSync(fd));
    const pathStat = _assertExecutionLedgerFile(file, fs.lstatSync(file));
    _assertExecutionLedgerBoundaryUnchanged(boundary);
    if (!_sameLedgerSnapshot(stat, expectedStat) || !_sameLedgerIdentity(stat, pathStat)) {
      throw _ledgerError('ledger_file_changed', 'execution ledger changed before read');
    }
    const length = Math.min(stat.size, maxBytes);
    const start = Math.max(0, stat.size - length);
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, start);
    const observed = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
    let complete = observed;
    if (start > 0) {
      const firstNewline = observed.indexOf(0x0a);
      complete = firstNewline >= 0 ? observed.subarray(firstNewline + 1) : Buffer.alloc(0);
    }
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(complete); }
    catch { throw _ledgerError('ledger_invalid_utf8', `execution ledger is not valid UTF-8: ${file}`); }
    const afterHandle = fs.fstatSync(fd);
    const afterPath = _assertExecutionLedgerFile(file, fs.lstatSync(file));
    _assertExecutionLedgerBoundaryUnchanged(boundary);
    if (!_sameLedgerSnapshot(stat, afterHandle) || !_sameLedgerIdentity(afterHandle, afterPath)) {
      throw _ledgerError('ledger_file_changed', 'execution ledger changed during read');
    }
    const revision = `sha256:${crypto.createHash('sha256').update(String(afterHandle.size)).update('\0').update(observed).digest('hex')}`;
    return { text, truncated: start > 0, revision };
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
  try {
    const boundary = _assertExecutionLedgerBoundary(root, { create: false });
    if (!boundary.exists) return { ok: true, code: null, error: null, file, revision: 'missing', totalRead: 0, invalidLines: 0, truncated: false, events: [] };
    const fileStat = _executionLedgerLstat(file);
    if (!fileStat) return { ok: true, code: null, error: null, file, revision: 'missing', totalRead: 0, invalidLines: 0, truncated: false, events: [] };
    _assertExecutionLedgerFile(file, fileStat);
    const tail = _readTail(file, readBytes, fileStat, boundary);
    const events = [];
    let invalidLines = 0;
    for (const line of tail.text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line);
        const normalized = value && typeof value === 'object' && !Array.isArray(value)
          ? normalizeExecutionEvent(value) : null;
        const canonicalOptional = (raw, canonical) => raw == null || raw === canonical;
        const executorCanonical = raw => !raw || (typeof raw === 'object'
          && canonicalOptional(raw.provider, _normalizeLegacyExecutorProviderIdentifier(raw.provider || ''))
          && canonicalOptional(raw.model, normalizeModelIdentifier(raw.model || ''))
          && canonicalOptional(raw.sessionId, normalizeProvenanceIdentifier(raw.sessionId || '')));
        const valid = value && typeof value === 'object' && !Array.isArray(value)
          && value.schemaVersion === LEDGER_SCHEMA_VERSION
          && value.event === normalized.event
          && typeof value.eventId === 'string' && value.eventId === normalized.eventId
          && canonicalOptional(value.taskId, normalized.taskId)
          && canonicalOptional(value.sessionId, normalized.sessionId)
          && canonicalOptional(value.attemptId, normalized.attemptId)
          && canonicalOptional(value.parentAttemptId, normalized.parentAttemptId)
          && canonicalOptional(value.reviewOfAttemptId, normalized.reviewOfAttemptId)
          && executorCanonical(value.requestedExecutor)
          && executorCanonical(value.actualExecutor)
          && executionEventSemanticProblem(normalized) === null;
        if (valid) events.push(value);
        else invalidLines++;
      } catch { invalidLines++; }
    }
    return {
      ok: invalidLines === 0,
      code: invalidLines ? 'ledger_invalid_lines' : null,
      error: invalidLines ? `execution ledger contains ${invalidLines} invalid line(s)` : null,
      file,
      revision: tail.revision,
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
      revision: null,
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
  normalizeProviderIdentifier,
  canonicalProviderIdentity,
  canonicalLegacyProviderIdentity,
  normalizeProvenanceIdentifier,
  isValidModelIdentifier,
  inferModelFamily,
  normalizeExecutorIdentity,
  assessReviewerIndependence,
  normalizeApprover,
  validateRoleDefinitionShape,
  normalizeRoleDefinition,
  buildCandidatePool,
  normalizeAvailability,
  normalizeAvailabilityObservation,
  appendAvailabilityObservation: require('./runtime-writes').projectWriter(appendAvailabilityObservation),
  appendAvailabilityClear: require('./runtime-writes').projectWriter(appendAvailabilityClear),
  readAvailabilityObservations,
  availabilityExtrasForCandidate,
  sessionIdentityFromEnv,
  resolveRoleFallback,
  selectFallbackOption,
  executionLedgerPath,
  normalizeExecutionEvent,
  appendExecutionEvent: require('./runtime-writes').projectWriter(appendExecutionEvent),
  readExecutionEvents,
};
