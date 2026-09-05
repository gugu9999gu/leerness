// lib/role-agent-schema.js — pure Role / Agent / Routing v2 contracts.
//
// This module is intentionally side-effect-free:
// - no filesystem or environment access
// - no process spawning
// - no clock access
// - no implicit migration or dispatch
//
// It validates strict v2 documents and provides a deterministic, reversible
// projection for the legacy .leerness/agent-roles.json assignment store.
'use strict';

const { stripDefaultIgnorables, isValidModelIdentifier } = require('./pure-utils');

const SCHEMA_VERSION = 2;
const LEGACY_SCHEMA_VERSION = 1;
const LEGACY_READ_SCHEMA_VERSIONS = Object.freeze([1, 2]);

const STORE_FILES = Object.freeze({
  roleDefinitions: 'role-definitions.json',
  agentInstances: 'agent-instances.json',
  routingPolicy: 'routing-policy.json',
  legacyAssignments: 'agent-roles.json',
});

const PERMISSION_TIERS = Object.freeze([
  'read-only',
  'safe-write',
  'project-write',
  'shell-read',
  'shell-write',
  'git-write',
  'network',
  'publish',
]);

// Persisted compatibility IDs remain canonical in v2. New roles are additive.
const BUILTIN_ROLE_IDS = Object.freeze([
  'commander',
  'coder',
  'dispatcher',
  'reviewer',
  'architect',
  'designer',
  'debugger',
  'router',
  'tester',
  'security',
  'release',
  'observer',
  'director',
]);

// Project definitions may specialize built-ins, but cannot grant them more
// authority than the product role contract. Missing fields inherit these
// ceilings; explicit fields may only narrow them.
const BUILTIN_ROLE_PERMISSION_CEILINGS = Object.freeze({
  commander: Object.freeze({ requiredTier: 'project-write', codeWrite: false, approve: true, release: false }),
  coder: Object.freeze({ requiredTier: 'project-write', codeWrite: true, approve: false, release: false }),
  dispatcher: Object.freeze({ requiredTier: 'safe-write', codeWrite: false, approve: false, release: false }),
  reviewer: Object.freeze({ requiredTier: 'shell-read', codeWrite: false, approve: true, release: false }),
  architect: Object.freeze({ requiredTier: 'read-only', codeWrite: false, approve: true, release: false }),
  designer: Object.freeze({ requiredTier: 'project-write', codeWrite: true, approve: false, release: false }),
  debugger: Object.freeze({ requiredTier: 'project-write', codeWrite: true, approve: false, release: false }),
  router: Object.freeze({ requiredTier: 'read-only', codeWrite: false, approve: false, release: false }),
  tester: Object.freeze({ requiredTier: 'shell-read', codeWrite: false, approve: false, release: false }),
  security: Object.freeze({ requiredTier: 'shell-read', codeWrite: false, approve: true, release: false }),
  release: Object.freeze({ requiredTier: 'publish', codeWrite: false, approve: false, release: true }),
  observer: Object.freeze({ requiredTier: 'read-only', codeWrite: false, approve: false, release: false }),
  director: Object.freeze({ requiredTier: 'read-only', codeWrite: false, approve: true, release: false }),
});

// Only these seven identifiers were canonical persisted roles before v2.
// New input aliases and additive v2 built-ins must not reinterpret an old
// user-forced custom key merely because its spelling now has a new meaning.
const LEGACY_PERSISTED_ROLE_IDS = Object.freeze([
  'commander',
  'coder',
  'dispatcher',
  'reviewer',
  'architect',
  'designer',
  'debugger',
]);

const ROLE_INPUT_ALIASES = Object.freeze({
  orchestrator: 'commander',
  commander: 'commander',
  '지휘': 'commander',
  '지휘관': 'commander',
  '사령관': 'commander',
  implementer: 'coder',
  worker: 'coder',
  coder: 'coder',
  '코딩': 'coder',
  '코더': 'coder',
  '코딩담당': 'coder',
  reviewer: 'reviewer',
  '검수': 'reviewer',
  '검수자': 'reviewer',
  '리뷰': 'reviewer',
  '리뷰어': 'reviewer',
  architect: 'architect',
  '설계': 'architect',
  '설계담당': 'architect',
  '아키텍트': 'architect',
  designer: 'designer',
  '디자인': 'designer',
  '디자인담당': 'designer',
  debugger: 'debugger',
  '디버그': 'debugger',
  '디버거': 'debugger',
  '디버깅': 'debugger',
  dispatcher: 'dispatcher',
  'assignment-dispatcher': 'dispatcher',
  '분배': 'dispatcher',
  '분배담당': 'dispatcher',
  '오케스트레이터': 'dispatcher',
  router: 'router',
  tester: 'tester',
  qa: 'tester',
  security: 'security',
  release: 'release',
  observer: 'observer',
  director: 'director',
});

const HIGH_RISK_REQUIRED_ROLES = Object.freeze([
  'architect',
  'commander',
  'coder',
  'tester',
  'reviewer',
]);

const NAMED_PIPELINE_ROLE_ORDER = Object.freeze({
  tiny: Object.freeze(['coder', 'tester']),
  normal: Object.freeze(['commander', 'coder', 'tester', 'reviewer']),
  'high-risk': HIGH_RISK_REQUIRED_ROLES,
  'review-only': Object.freeze(['reviewer']),
});

const NAMED_PIPELINE_MINIMUM_REQUIREMENTS = Object.freeze({
  tiny: Object.freeze(['verifyClaim', 'leaseForWrites']),
  normal: Object.freeze(['independentReviewer', 'verifyClaim', 'gate', 'leaseForWrites']),
  'high-risk': Object.freeze(['humanApproval', 'independentReviewer', 'verifyClaim', 'gate', 'leaseForWrites']),
  'review-only': Object.freeze([]),
});

const ROLE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const AGENT_ID_RE = /^[a-z][a-z0-9._-]{0,79}$/;
const PROVIDER_ID_RE = /^[a-z][a-z0-9._-]{0,63}$/;
// The pre-v2 provider registry accepts case-preserving user IDs. Legacy input
// must continue to read those IDs; the stricter lowercase predicate applies only
// to native v2 Agent documents.
const LEGACY_PROVIDER_ID_RE = /^[A-Za-z][A-Za-z0-9._-]*$/;
const PIPELINE_ID_RE = /^[a-z][a-z0-9._-]{0,63}$/;
const TAG_RE = /^[a-z0-9][a-z0-9._:-]{0,39}$/;

function _isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function _normalizeToken(value) {
  let text = stripDefaultIgnorables(value, { nfkc: true, visibleIdentity: true }).trim();
  return text.toLowerCase();
}

function canonicalRoleId(value) {
  const token = _normalizeToken(value);
  return Object.prototype.hasOwnProperty.call(ROLE_INPUT_ALIASES, token)
    ? ROLE_INPUT_ALIASES[token]
    : token;
}

function isCanonicalRoleId(value) {
  if (typeof value !== 'string') return false;
  const token = _normalizeToken(value);
  // Persisted v2 IDs are already-normalized data. Accepting whitespace, case,
  // or full-width variants here would validate one spelling while retaining a
  // different object key, creating cross-document ambiguity.
  return value === token && ROLE_ID_RE.test(token) && canonicalRoleId(token) === token;
}

function _hasForbiddenControls(value, allowMultiline) {
  const text = String(value == null ? '' : value);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/.test(text)) return true;
  if (!allowMultiline && /[\r\n]/.test(text)) return true;
  return false;
}

function _validText(value, options = {}) {
  if (typeof value !== 'string') return false;
  const min = options.min == null ? 0 : options.min;
  const max = options.max == null ? 4096 : options.max;
  if (value.length < min || value.length > max) return false;
  return !_hasForbiddenControls(value, options.multiline === true);
}

function _validNullableText(value, options = {}) {
  return value === null || _validText(value, options);
}

function _validNonNegativeIntegerOrNull(value) {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER);
}

function _cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

// Bracket assignment to `__proto__` invokes Object.prototype's legacy setter
// on ordinary objects. Compatibility projection must preserve arbitrary legacy
// role keys as own JSON data without changing an object's prototype.
function _setOwnDataProperty(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function _canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(_canonical).join(',') + ']';
  if (_isObject(value)) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + _canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function stableStringify(value) {
  return _canonical(value);
}

function _cmpText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function _problem(code, path, detail) {
  const row = { code, path };
  if (detail !== undefined && detail !== '') row.detail = String(detail);
  return row;
}

function _sortedProblems(problems) {
  const seen = new Set();
  return problems
    .filter(problem => {
      const key = `${problem.path}\u0000${problem.code}\u0000${problem.detail || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => _cmpText(a.path, b.path) || _cmpText(a.code, b.code) || _cmpText(a.detail || '', b.detail || ''));
}

function _finish(problems, extra = {}) {
  const rows = _sortedProblems(problems);
  return {
    ok: rows.length === 0,
    code: rows.length ? rows[0].code : 'ok',
    problems: rows,
    ...extra,
  };
}

function _unknownFields(value, allowed, path, problems) {
  if (!_isObject(value)) return;
  const allow = new Set(allowed);
  for (const key of Object.keys(value).sort()) {
    if (!allow.has(key)) problems.push(_problem('unknown-field', `${path}.${key}`));
  }
}

function _validateSchemaHeader(doc, kind, path, allowedTop, problems) {
  if (!_isObject(doc)) {
    problems.push(_problem('root-not-object', path));
    return false;
  }
  _unknownFields(doc, allowedTop, path, problems);
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    problems.push(_problem(
      Number.isInteger(doc.schemaVersion) ? 'unsupported-schema-version' : 'invalid-schema-version',
      `${path}.schemaVersion`,
      doc.schemaVersion,
    ));
  }
  if (doc.kind !== kind) problems.push(_problem('wrong-kind', `${path}.kind`, doc.kind));
  return true;
}

function _validateSource(source, path, problems) {
  if (!_isObject(source)) {
    problems.push(_problem('invalid-source', path));
    return;
  }
  _unknownFields(source, ['kind', 'file'], path, problems);
  if (!_validText(source.kind, { min: 1, max: 80 })) problems.push(_problem('invalid-source-kind', `${path}.kind`));
  if (!_validText(source.file, { min: 1, max: 160 })) problems.push(_problem('invalid-source-file', `${path}.file`));
}

function _validateBudget(budget, path, problems) {
  if (!_isObject(budget)) {
    problems.push(_problem('invalid-budget', path));
    return;
  }
  _unknownFields(budget, ['inputTokens', 'outputTokens', 'retries'], path, problems);
  if (!_validNonNegativeIntegerOrNull(budget.inputTokens)) problems.push(_problem('invalid-input-token-budget', `${path}.inputTokens`));
  if (!_validNonNegativeIntegerOrNull(budget.outputTokens)) problems.push(_problem('invalid-output-token-budget', `${path}.outputTokens`));
  if (!Number.isInteger(budget.retries) || budget.retries < 0 || budget.retries > 10) problems.push(_problem('invalid-retry-budget', `${path}.retries`));
}

function _validateStringArray(value, path, problems, options = {}) {
  if (!Array.isArray(value)) {
    problems.push(_problem(options.code || 'not-array', path));
    return [];
  }
  const out = [];
  const seen = new Set();
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    const valid = typeof options.validator === 'function'
      ? options.validator(item)
      : _validText(item, { min: 1, max: options.max || 160 });
    if (!valid) {
      problems.push(_problem(options.itemCode || 'invalid-array-item', itemPath));
      return;
    }
    const normalized = options.normalize ? options.normalize(item) : item;
    if (seen.has(normalized)) problems.push(_problem(options.duplicateCode || 'duplicate-array-item', itemPath, normalized));
    else {
      seen.add(normalized);
      out.push(normalized);
    }
  });
  return out;
}

function validateRoleDefinitions(doc) {
  const problems = [];
  const path = '$.roleDefinitions';
  if (!_validateSchemaHeader(doc, 'role-definitions', path, ['schemaVersion', 'kind', 'roles', 'source'], problems)) return _finish(problems);
  if (doc.source !== undefined) _validateSource(doc.source, `${path}.source`, problems);
  if (!_isObject(doc.roles)) {
    problems.push(_problem('roles-not-object', `${path}.roles`));
    return _finish(problems);
  }

  for (const roleId of Object.keys(doc.roles).sort()) {
    const rolePath = `${path}.roles.${roleId}`;
    if (!isCanonicalRoleId(roleId)) problems.push(_problem('non-canonical-role-id', rolePath, canonicalRoleId(roleId)));
    const def = doc.roles[roleId];
    if (!_isObject(def)) {
      problems.push(_problem('role-definition-not-object', rolePath));
      continue;
    }
    _unknownFields(def, [
      'label', 'extends', 'responsibilities', 'requiredTier', 'codeWrite', 'approve', 'release',
      'forbidden', 'requiredInputs', 'requiredOutputs', 'contextPolicy', 'defaultBudget',
    ], rolePath, problems);

    if (def.label !== undefined) {
      if (!_isObject(def.label)) problems.push(_problem('invalid-role-label', `${rolePath}.label`));
      else {
        _unknownFields(def.label, ['ko', 'en'], `${rolePath}.label`, problems);
        if (!_validText(def.label.ko, { min: 1, max: 80 })) problems.push(_problem('invalid-role-label-ko', `${rolePath}.label.ko`));
        if (!_validText(def.label.en, { min: 1, max: 80 })) problems.push(_problem('invalid-role-label-en', `${rolePath}.label.en`));
      }
    }
    if (def.extends !== undefined && def.extends !== null && !isCanonicalRoleId(def.extends)) problems.push(_problem('invalid-role-extends', `${rolePath}.extends`, canonicalRoleId(def.extends)));
    if (def.requiredTier !== undefined && !PERMISSION_TIERS.includes(def.requiredTier)) problems.push(_problem('invalid-required-tier', `${rolePath}.requiredTier`, def.requiredTier));
    for (const key of ['codeWrite', 'approve', 'release']) {
      if (def[key] !== undefined && typeof def[key] !== 'boolean') problems.push(_problem('invalid-role-boolean', `${rolePath}.${key}`));
    }
    if (def.responsibilities !== undefined) _validateStringArray(def.responsibilities, `${rolePath}.responsibilities`, problems, { max: 240, itemCode: 'invalid-role-responsibility', duplicateCode: 'duplicate-role-responsibility' });
    if (def.forbidden !== undefined) _validateStringArray(def.forbidden, `${rolePath}.forbidden`, problems, { max: 120, itemCode: 'invalid-forbidden-action', duplicateCode: 'duplicate-forbidden-action' });
    if (def.requiredInputs !== undefined) _validateStringArray(def.requiredInputs, `${rolePath}.requiredInputs`, problems, { itemCode: 'invalid-required-input', duplicateCode: 'duplicate-required-input' });
    if (def.requiredOutputs !== undefined) _validateStringArray(def.requiredOutputs, `${rolePath}.requiredOutputs`, problems, { itemCode: 'invalid-required-output', duplicateCode: 'duplicate-required-output' });
    if (def.contextPolicy !== undefined && !_validText(def.contextPolicy, { min: 1, max: 160 })) problems.push(_problem('invalid-context-policy', `${rolePath}.contextPolicy`));
    if (def.defaultBudget !== undefined) _validateBudget(def.defaultBudget, `${rolePath}.defaultBudget`, problems);

    const builtinCeiling = Object.prototype.hasOwnProperty.call(BUILTIN_ROLE_PERMISSION_CEILINGS, roleId)
      ? BUILTIN_ROLE_PERMISSION_CEILINGS[roleId] : null;
    if (builtinCeiling) {
      if (def.requiredTier !== undefined
        && PERMISSION_TIERS.includes(def.requiredTier)
        && PERMISSION_TIERS.indexOf(def.requiredTier) < PERMISSION_TIERS.indexOf(builtinCeiling.requiredTier)) {
        problems.push(_problem('builtin-role-tier-widening', `${rolePath}.requiredTier`, `${def.requiredTier} < ${builtinCeiling.requiredTier}`));
      }
      for (const key of ['codeWrite', 'approve', 'release']) {
        if (def[key] === true && builtinCeiling[key] !== true) {
          problems.push(_problem('builtin-role-authority-widening', `${rolePath}.${key}`, roleId));
        }
      }
      if (def.extends) {
        const extendedCeiling = Object.prototype.hasOwnProperty.call(BUILTIN_ROLE_PERMISSION_CEILINGS, def.extends)
          ? BUILTIN_ROLE_PERMISSION_CEILINGS[def.extends] : null;
        const extendsWider = !extendedCeiling
          || PERMISSION_TIERS.indexOf(extendedCeiling.requiredTier) < PERMISSION_TIERS.indexOf(builtinCeiling.requiredTier)
          || ['codeWrite', 'approve', 'release'].some(key => extendedCeiling[key] === true && builtinCeiling[key] !== true);
        if (extendsWider) problems.push(_problem('builtin-role-extends-widening', `${rolePath}.extends`, def.extends));
      }
    }

    // Custom project roles need an explicit label and permission ceiling. Built-in
    // entries are narrow overrides, so every field may remain optional.
    if (!BUILTIN_ROLE_IDS.includes(roleId)) {
      if (!_isObject(def.label)) problems.push(_problem('custom-role-label-required', `${rolePath}.label`));
      if (!Array.isArray(def.responsibilities)) problems.push(_problem('custom-role-responsibilities-required', `${rolePath}.responsibilities`));
      if (!PERMISSION_TIERS.includes(def.requiredTier)) problems.push(_problem('custom-role-tier-required', `${rolePath}.requiredTier`));
      for (const key of ['codeWrite', 'approve', 'release']) {
        if (typeof def[key] !== 'boolean') problems.push(_problem('custom-role-boolean-required', `${rolePath}.${key}`));
      }
      if (!Array.isArray(def.forbidden)) problems.push(_problem('custom-role-forbidden-required', `${rolePath}.forbidden`));
      if (!Array.isArray(def.requiredInputs)) problems.push(_problem('custom-role-inputs-required', `${rolePath}.requiredInputs`));
      if (!Array.isArray(def.requiredOutputs)) problems.push(_problem('custom-role-outputs-required', `${rolePath}.requiredOutputs`));
      if (!_validText(def.contextPolicy, { min: 1, max: 160 })) problems.push(_problem('custom-role-context-required', `${rolePath}.contextPolicy`));
      if (!_isObject(def.defaultBudget)) problems.push(_problem('custom-role-budget-required', `${rolePath}.defaultBudget`));
    }

    const effective = builtinCeiling
      ? {
        requiredTier: def.requiredTier === undefined ? builtinCeiling.requiredTier : def.requiredTier,
        codeWrite: def.codeWrite === undefined ? builtinCeiling.codeWrite : def.codeWrite,
        release: def.release === undefined ? builtinCeiling.release : def.release,
      }
      : def;
    const tierRank = PERMISSION_TIERS.indexOf(effective.requiredTier);
    if (effective.codeWrite === true && tierRank >= 0 && tierRank < PERMISSION_TIERS.indexOf('project-write')) {
      problems.push(_problem('code-write-tier-too-low', `${rolePath}.requiredTier`, effective.requiredTier));
    }
    if (effective.release === true && tierRank >= 0 && tierRank < PERMISSION_TIERS.indexOf('publish')) {
      problems.push(_problem('release-tier-too-low', `${rolePath}.requiredTier`, effective.requiredTier));
    }
  }
  return _finish(problems, { roleIds: Object.keys(doc.roles).sort() });
}

function _validateLegacyProjection(value, path, problems) {
  if (!_isObject(value)) {
    problems.push(_problem('invalid-legacy-projection', path));
    return;
  }
  _unknownFields(value, ['file', 'roleKey', 'provider', 'primary'], path, problems);
  if (value.file !== STORE_FILES.legacyAssignments) problems.push(_problem('invalid-legacy-file', `${path}.file`, value.file));
  if (!_validText(value.roleKey, { min: 1, max: 128 })) problems.push(_problem('invalid-legacy-role-key', `${path}.roleKey`));
  if (value.provider !== undefined
    && (typeof value.provider !== 'string' || !LEGACY_PROVIDER_ID_RE.test(value.provider))) {
    problems.push(_problem('invalid-legacy-provider', `${path}.provider`, value.provider));
  }
  if (typeof value.primary !== 'boolean') problems.push(_problem('invalid-legacy-primary', `${path}.primary`));
}

function validateAgentInstances(doc) {
  const problems = [];
  const path = '$.agentInstances';
  if (!_validateSchemaHeader(doc, 'agent-instances', path, ['schemaVersion', 'kind', 'agents', 'source'], problems)) return _finish(problems);
  if (doc.source !== undefined) _validateSource(doc.source, `${path}.source`, problems);
  if (!Array.isArray(doc.agents)) {
    problems.push(_problem('agents-not-array', `${path}.agents`));
    return _finish(problems);
  }

  const ids = new Set();
  doc.agents.forEach((agent, index) => {
    const agentPath = `${path}.agents[${index}]`;
    if (!_isObject(agent)) {
      problems.push(_problem('agent-not-object', agentPath));
      return;
    }
    _unknownFields(agent, [
      'id', 'role', 'provider', 'model', 'persona', 'enabled', 'maxConcurrency',
      'sessionKeyPolicy', 'budget', 'fallback', 'tags', 'legacyProjection',
    ], agentPath, problems);

    if (typeof agent.id !== 'string' || !AGENT_ID_RE.test(agent.id)) problems.push(_problem('invalid-agent-id', `${agentPath}.id`, agent.id));
    else if (ids.has(agent.id)) problems.push(_problem('duplicate-agent-id', `${agentPath}.id`, agent.id));
    else ids.add(agent.id);

    if (!isCanonicalRoleId(agent.role)) problems.push(_problem('non-canonical-agent-role', `${agentPath}.role`, canonicalRoleId(agent.role)));
    if (typeof agent.provider !== 'string' || !PROVIDER_ID_RE.test(agent.provider)) problems.push(_problem('invalid-agent-provider', `${agentPath}.provider`, agent.provider));
    if (!_validNullableText(agent.model, { min: 1, max: 200 })
      || (typeof agent.model === 'string' && !isValidModelIdentifier(agent.model))) {
      problems.push(_problem('invalid-agent-model', `${agentPath}.model`));
    }
    if (agent.persona !== undefined && !_validText(agent.persona, { max: 4000, multiline: true })) problems.push(_problem('invalid-agent-persona', `${agentPath}.persona`));
    if (typeof agent.enabled !== 'boolean') problems.push(_problem('invalid-agent-enabled', `${agentPath}.enabled`));
    if (!Number.isInteger(agent.maxConcurrency) || agent.maxConcurrency < 1 || agent.maxConcurrency > 64) problems.push(_problem('invalid-agent-concurrency', `${agentPath}.maxConcurrency`));
    if (!['required-for-write', 'optional', 'forbidden'].includes(agent.sessionKeyPolicy)) problems.push(_problem('invalid-session-key-policy', `${agentPath}.sessionKeyPolicy`, agent.sessionKeyPolicy));
    _validateBudget(agent.budget, `${agentPath}.budget`, problems);

    const fallback = _validateStringArray(agent.fallback, `${agentPath}.fallback`, problems, {
      validator: value => typeof value === 'string' && AGENT_ID_RE.test(value),
      itemCode: 'invalid-fallback-agent-id',
      duplicateCode: 'duplicate-fallback-agent-id',
    });
    if (typeof agent.id === 'string' && fallback.includes(agent.id)) problems.push(_problem('self-fallback', `${agentPath}.fallback`, agent.id));

    _validateStringArray(agent.tags, `${agentPath}.tags`, problems, {
      validator: value => typeof value === 'string' && TAG_RE.test(value),
      itemCode: 'invalid-agent-tag',
      duplicateCode: 'duplicate-agent-tag',
    });
    if (agent.legacyProjection !== undefined) _validateLegacyProjection(agent.legacyProjection, `${agentPath}.legacyProjection`, problems);
  });

  return _finish(problems, { agentIds: Array.from(ids).sort() });
}

function _validateRequirement(value, path, problems) {
  if (!_isObject(value)) {
    problems.push(_problem('invalid-pipeline-requirement', path));
    return;
  }
  const keys = ['humanApproval', 'independentReviewer', 'verifyClaim', 'gate', 'leaseForWrites'];
  _unknownFields(value, keys, path, problems);
  for (const key of keys) {
    if (typeof value[key] !== 'boolean') problems.push(_problem('invalid-pipeline-requirement-boolean', `${path}.${key}`));
  }
}

function validateRoutingPolicy(doc) {
  const problems = [];
  const path = '$.routingPolicy';
  if (!_validateSchemaHeader(doc, 'routing-policy', path, ['schemaVersion', 'kind', 'defaultMode', 'pipelines', 'requirements', 'source'], problems)) return _finish(problems);
  if (doc.source !== undefined) _validateSource(doc.source, `${path}.source`, problems);
  if (!['suggest', 'confirm'].includes(doc.defaultMode)) problems.push(_problem('invalid-default-mode', `${path}.defaultMode`, doc.defaultMode));
  if (!_isObject(doc.pipelines)) problems.push(_problem('pipelines-not-object', `${path}.pipelines`));
  if (!_isObject(doc.requirements)) problems.push(_problem('requirements-not-object', `${path}.requirements`));
  if (!_isObject(doc.pipelines) || !_isObject(doc.requirements)) return _finish(problems);

  const pipelineIds = Object.keys(doc.pipelines).sort();
  for (const pipelineId of pipelineIds) {
    const pipelinePath = `${path}.pipelines.${pipelineId}`;
    if (!PIPELINE_ID_RE.test(pipelineId)) problems.push(_problem('invalid-pipeline-id', pipelinePath));
    const normalizedRoles = _validateStringArray(doc.pipelines[pipelineId], pipelinePath, problems, {
      validator: value => isCanonicalRoleId(value),
      normalize: value => _normalizeToken(value),
      itemCode: 'non-canonical-pipeline-role',
      duplicateCode: 'duplicate-pipeline-role',
    });
    if (Array.isArray(doc.pipelines[pipelineId]) && normalizedRoles.length === 0) {
      problems.push(_problem('empty-pipeline', pipelinePath));
    }
  }
  for (const pipelineId of pipelineIds) {
    if (!Object.prototype.hasOwnProperty.call(doc.requirements, pipelineId)) {
      problems.push(_problem('pipeline-requirement-missing', `${path}.requirements.${pipelineId}`));
    }
  }
  for (const pipelineId of Object.keys(doc.requirements).sort()) {
    if (!Object.prototype.hasOwnProperty.call(doc.pipelines, pipelineId)) problems.push(_problem('requirement-without-pipeline', `${path}.requirements.${pipelineId}`));
    _validateRequirement(doc.requirements[pipelineId], `${path}.requirements.${pipelineId}`, problems);
  }

  for (const pipelineId of pipelineIds) {
    const requirement = doc.requirements[pipelineId];
    const roles = Array.isArray(doc.pipelines[pipelineId])
      ? doc.pipelines[pipelineId].map(canonicalRoleId)
      : [];
    if (_isObject(requirement) && requirement.independentReviewer === true && !roles.includes('reviewer')) {
      problems.push(_problem('independent-reviewer-role-missing', `${path}.pipelines.${pipelineId}`, 'reviewer'));
    }
  }

  for (const pipelineId of Object.keys(NAMED_PIPELINE_ROLE_ORDER).sort()) {
    if (!Object.prototype.hasOwnProperty.call(doc.pipelines, pipelineId) || !Array.isArray(doc.pipelines[pipelineId])) continue;
    const roles = doc.pipelines[pipelineId].map(canonicalRoleId);
    const required = NAMED_PIPELINE_ROLE_ORDER[pipelineId];
    let previous = -1;
    let orderInvalid = false;
    for (const role of required) {
      const index = roles.indexOf(role);
      if (index < 0) {
        if (pipelineId !== 'high-risk') problems.push(_problem('named-pipeline-role-missing', `${path}.pipelines.${pipelineId}`, role));
        continue;
      }
      if (index < previous) orderInvalid = true;
      previous = Math.max(previous, index);
    }
    if (orderInvalid) {
      problems.push(_problem(
        pipelineId === 'high-risk' ? 'high-risk-role-order-invalid' : 'named-pipeline-role-order-invalid',
        `${path}.pipelines.${pipelineId}`,
        required.join(' -> '),
      ));
    }
  }

  if (!Object.prototype.hasOwnProperty.call(doc.pipelines, 'high-risk')) {
    problems.push(_problem('high-risk-pipeline-required', `${path}.pipelines.high-risk`));
  } else if (Array.isArray(doc.pipelines['high-risk'])) {
    const roles = new Set(doc.pipelines['high-risk'].map(canonicalRoleId));
    for (const role of HIGH_RISK_REQUIRED_ROLES) {
      if (!roles.has(role)) problems.push(_problem('high-risk-role-missing', `${path}.pipelines.high-risk`, role));
    }
  }
  for (const pipelineId of Object.keys(NAMED_PIPELINE_MINIMUM_REQUIREMENTS).sort()) {
    const requirement = doc.requirements[pipelineId];
    if (!_isObject(requirement)) {
      if (pipelineId === 'high-risk') problems.push(_problem('high-risk-requirements-required', `${path}.requirements.high-risk`));
      continue;
    }
    for (const key of NAMED_PIPELINE_MINIMUM_REQUIREMENTS[pipelineId]) {
      if (requirement[key] !== true) {
        problems.push(_problem(
          pipelineId === 'high-risk' ? 'high-risk-requirement-disabled' : 'named-pipeline-requirement-disabled',
          `${path}.requirements.${pipelineId}.${key}`,
          key,
        ));
      }
    }
  }

  return _finish(problems, { pipelineIds });
}

function validateLegacyRoleStore(doc) {
  const problems = [];
  const warnings = [];
  const unknownFields = [];
  const path = '$.legacyAssignments';
  if (!_isObject(doc)) return _finish([_problem('root-not-object', path)], { warnings, unknownFields });

  const versionPresent = Object.prototype.hasOwnProperty.call(doc, 'schemaVersion');
  if (versionPresent && !LEGACY_READ_SCHEMA_VERSIONS.includes(doc.schemaVersion)) {
    problems.push(_problem(
      Number.isInteger(doc.schemaVersion) ? 'unsupported-schema-version' : 'invalid-schema-version',
      `${path}.schemaVersion`,
      doc.schemaVersion,
    ));
  }
  for (const key of Object.keys(doc).sort()) {
    if (!['schemaVersion', 'updatedAt', 'roles'].includes(key)) unknownFields.push(`${path}.${key}`);
  }
  if (doc.updatedAt !== undefined && !_validText(doc.updatedAt, { min: 1, max: 80 })) problems.push(_problem('invalid-updated-at', `${path}.updatedAt`));

  let roles = doc.roles;
  if (!Object.prototype.hasOwnProperty.call(doc, 'roles')) {
    problems.push(_problem('roles-missing', `${path}.roles`));
    roles = {};
  } else if (!_isObject(roles)) {
    problems.push(_problem('roles-not-object', `${path}.roles`));
    roles = {};
  }

  const canonicalOwners = new Map();
  for (const roleKey of Object.keys(roles).sort()) {
    const rolePath = `${path}.roles.${roleKey}`;
    if (!_validText(roleKey, { min: 1, max: 128 })) {
      problems.push(_problem('invalid-legacy-role-key', rolePath));
      continue;
    }
    const canonical = legacyRoleId(roleKey);
    if (canonicalOwners.has(canonical) && canonicalOwners.get(canonical) !== roleKey) {
      problems.push(_problem('legacy-role-alias-collision', rolePath, `${canonicalOwners.get(canonical)} -> ${canonical}`));
    } else canonicalOwners.set(canonical, roleKey);

    const entry = roles[roleKey];
    if (!_isObject(entry)) {
      problems.push(_problem('legacy-role-not-object', rolePath));
      continue;
    }
    for (const key of Object.keys(entry).sort()) {
      if (!['provider', 'model', 'persona'].includes(key)) unknownFields.push(`${rolePath}.${key}`);
    }
    if (typeof entry.provider !== 'string' || !LEGACY_PROVIDER_ID_RE.test(entry.provider)) problems.push(_problem('invalid-legacy-provider', `${rolePath}.provider`, entry.provider));
    if (entry.model !== undefined && !_validNullableText(entry.model, { min: 1, max: 200 })) problems.push(_problem('invalid-legacy-model', `${rolePath}.model`));
    if (entry.persona !== undefined && !_validText(entry.persona, { max: 4000, multiline: true })) problems.push(_problem('invalid-legacy-persona', `${rolePath}.persona`));
  }

  return _finish(problems, {
    warnings: warnings.sort(),
    unknownFields: unknownFields.sort(),
    version: versionPresent ? doc.schemaVersion : null,
    unversioned: !versionPresent,
    roleKeys: Object.keys(roles).sort(),
  });
}

function parseLegacyRoleStoreText(text) {
  if (typeof text !== 'string') return _finish([_problem('invalid-input-text', '$.legacyAssignments')], { state: 'invalid-input', doc: null });
  let source = text;
  if (source.charCodeAt(0) === 0xFEFF) source = source.slice(1);
  if (!source.trim()) {
    // Missing files are handled by the filesystem caller. An existing zero-byte
    // or BOM-only store is incomplete data and must not become an empty config.
    return _finish([_problem('empty-document', '$.legacyAssignments')], { state: 'empty-document', doc: null });
  }
  let doc;
  try { doc = JSON.parse(source); }
  catch {
    // JSON parser messages can echo malformed source text. Keep diagnostics
    // stable and credential-safe by returning only the canonical error code.
    return _finish([_problem('invalid-json', '$.legacyAssignments')], { state: 'invalid-json', doc: null });
  }
  const validation = validateLegacyRoleStore(doc);
  return {
    ...validation,
    state: validation.ok ? 'valid' : 'invalid',
    doc,
    validation,
  };
}

function legacySemanticAssignments(doc) {
  const roles = _isObject(doc) && _isObject(doc.roles) ? doc.roles : {};
  const out = {};
  for (const roleKey of Object.keys(roles).sort()) {
    const entry = _isObject(roles[roleKey]) ? roles[roleKey] : {};
    _setOwnDataProperty(out, roleKey, {
      provider: typeof entry.provider === 'string' ? entry.provider : null,
      model: typeof entry.model === 'string' ? entry.model : null,
      persona: typeof entry.persona === 'string' ? entry.persona : '',
    });
  }
  return out;
}

function _fnv1a64(text) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  const value = String(text);
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

function _slug(value, max = 32) {
  const normalized = _normalizeToken(value);
  const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
  return slug || 'role';
}

function legacyRoleId(roleKey) {
  // Persist only the original v1 canonical set as built-ins. For example, a
  // user could previously create `implementer` or `tester` with --force; v2
  // must preserve that custom identity instead of silently granting a newly
  // introduced built-in meaning.
  if (typeof roleKey === 'string' && LEGACY_PERSISTED_ROLE_IDS.includes(roleKey)) return roleKey;
  return `legacy-role-${_slug(roleKey, 28)}-${_fnv1a64(_normalizeToken(roleKey))}`;
}

function stableLegacyAgentId(roleKey) {
  return `legacy-${_slug(roleKey, 32)}-${_fnv1a64(roleKey)}`;
}

function _legacyProviderProjectionId(provider) {
  const lower = String(provider).toLowerCase();
  // Preserve a lowercase native ID directly. Case-preserving legacy IDs need a
  // distinct marker; otherwise changing `MyProvider` to the real `myprovider`
  // is indistinguishable from leaving the projection untouched.
  return provider === lower && PROVIDER_ID_RE.test(lower)
    ? lower : `legacy-provider-${_fnv1a64(provider)}`;
}

function _legacyProjectionSource() {
  return { kind: 'legacy-agent-roles-v1', file: STORE_FILES.legacyAssignments };
}

function _builtInRoutingSource() {
  return { kind: 'built-in-default', file: 'lib/role-agent-schema.js' };
}

function defaultRoutingPolicyDocument(source) {
  const provenance = source === undefined ? _builtInRoutingSource() : source;
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'routing-policy',
    defaultMode: 'suggest',
    pipelines: {
      tiny: ['coder', 'tester'],
      normal: ['commander', 'coder', 'tester', 'reviewer'],
      'high-risk': ['architect', 'commander', 'coder', 'tester', 'reviewer'],
      'review-only': ['reviewer'],
    },
    requirements: {
      tiny: {
        humanApproval: false,
        independentReviewer: false,
        verifyClaim: true,
        gate: false,
        leaseForWrites: true,
      },
      normal: {
        humanApproval: false,
        independentReviewer: true,
        verifyClaim: true,
        gate: true,
        leaseForWrites: true,
      },
      'high-risk': {
        humanApproval: true,
        independentReviewer: true,
        verifyClaim: true,
        gate: true,
        leaseForWrites: true,
      },
      'review-only': {
        humanApproval: false,
        independentReviewer: false,
        verifyClaim: false,
        gate: false,
        leaseForWrites: false,
      },
    },
    source: _cloneJson(provenance),
  };
}

function projectLegacyRoleStore(doc) {
  const checked = validateLegacyRoleStore(doc);
  if (!checked.ok) return { ok: false, code: checked.code, problems: checked.problems, validation: checked };
  const roles = _isObject(doc.roles) ? doc.roles : {};
  const projectedRoleDefinitions = {};
  const agents = Object.keys(roles).sort().map(roleKey => {
    const entry = roles[roleKey];
    const role = legacyRoleId(roleKey);
    if (!BUILTIN_ROLE_IDS.includes(role) && !Object.prototype.hasOwnProperty.call(projectedRoleDefinitions, role)) {
      projectedRoleDefinitions[role] = {
        label: { ko: roleKey.slice(0, 80), en: roleKey.slice(0, 80) },
        responsibilities: [],
        requiredTier: 'read-only',
        codeWrite: false,
        approve: false,
        release: false,
        forbidden: ['permission-widening-without-explicit-review'],
        requiredInputs: [],
        requiredOutputs: [],
        contextPolicy: 'legacy-unclassified',
        defaultBudget: { inputTokens: null, outputTokens: null, retries: 1 },
      };
    }
    return {
      id: stableLegacyAgentId(roleKey),
      role,
      // Legacy stores accepted case-preserving and unbounded registered IDs.
      // Keep the exact spelling in projection provenance while the native v2
      // field receives a deterministic bounded canonical ID.
      provider: _legacyProviderProjectionId(entry.provider),
      model: Object.prototype.hasOwnProperty.call(entry, 'model') ? entry.model : null,
      persona: typeof entry.persona === 'string' ? entry.persona : '',
      enabled: true,
      maxConcurrency: 1,
      sessionKeyPolicy: 'required-for-write',
      budget: { inputTokens: null, outputTokens: null, retries: 1 },
      fallback: [],
      tags: [],
      legacyProjection: {
        file: STORE_FILES.legacyAssignments,
        roleKey,
        provider: entry.provider,
        primary: true,
      },
    };
  });
  const source = _legacyProjectionSource();
  const roleDefinitions = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'role-definitions',
    roles: projectedRoleDefinitions,
    source: _cloneJson(source),
  };
  const agentInstances = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'agent-instances',
    agents,
    source: _cloneJson(source),
  };
  const routingPolicy = defaultRoutingPolicyDocument(source);
  const bundleValidation = validateConfigBundle({ roleDefinitions, agentInstances, routingPolicy });
  if (!bundleValidation.ok) return { ok: false, code: 'projection-invalid', problems: bundleValidation.problems, validation: bundleValidation };
  return {
    ok: true,
    code: 'ok',
    roleDefinitions,
    agentInstances,
    routingPolicy,
    legacySemantic: legacySemanticAssignments(doc),
    assignmentReady: bundleValidation.assignmentReady,
    assignmentGaps: bundleValidation.assignmentGaps,
    readinessScope: bundleValidation.readinessScope,
    providerReadinessChecked: bundleValidation.providerReadinessChecked,
  };
}

function projectAgentInstancesToLegacy(agentInstances, baseLegacyDocument) {
  const agentValidation = validateAgentInstances(agentInstances);
  if (!agentValidation.ok) return { ok: false, code: agentValidation.code, problems: agentValidation.problems };
  const base = baseLegacyDocument === undefined ? { schemaVersion: LEGACY_SCHEMA_VERSION, roles: {} } : baseLegacyDocument;
  const legacyValidation = validateLegacyRoleStore(base);
  if (!legacyValidation.ok) return { ok: false, code: legacyValidation.code, problems: legacyValidation.problems };

  const disabledPrimary = agentInstances.agents
    .filter(agent => agent.legacyProjection && agent.legacyProjection.primary === true && agent.enabled !== true)
    .map(agent => _problem('disabled-primary-legacy-projection', `$.agentInstances.agents.${agent.id}.legacyProjection`, agent.id));
  if (disabledPrimary.length) return _finish(disabledPrimary);

  const projected = agentInstances.agents
    .filter(agent => agent.legacyProjection && agent.legacyProjection.primary === true)
    .slice()
    .sort((a, b) => _cmpText(a.legacyProjection.roleKey, b.legacyProjection.roleKey));
  const seen = new Set();
  const problems = [];
  for (const agent of projected) {
    const roleKey = agent.legacyProjection.roleKey;
    if (seen.has(roleKey)) problems.push(_problem('duplicate-legacy-role-key', '$.agentInstances.agents', roleKey));
    else seen.add(roleKey);
    if (legacyRoleId(roleKey) !== agent.role) problems.push(_problem('legacy-role-mismatch', `$.agentInstances.agents.${agent.id}.legacyProjection.roleKey`, `${roleKey} -> ${agent.role}`));
  }
  if (problems.length) return _finish(problems);

  const out = _cloneJson(base);
  if (!_isObject(out.roles)) out.roles = {};
  for (const agent of projected) {
    const roleKey = agent.legacyProjection.roleKey;
    const current = _isObject(out.roles[roleKey]) ? out.roles[roleKey] : {};
    const previousProvider = typeof current.provider === 'string' ? current.provider : null;
    const previousModel = typeof current.model === 'string' ? current.model : null;
    const projectedLegacyProvider = typeof agent.legacyProjection.provider === 'string'
      ? agent.legacyProjection.provider : null;
    const provider = projectedLegacyProvider
      && agent.provider === _legacyProviderProjectionId(projectedLegacyProvider)
      ? projectedLegacyProvider
      : agent.provider;
    const assignmentChanged = previousProvider !== provider || previousModel !== agent.model;
    const next = { ...current, provider };
    if (agent.model !== null || Object.prototype.hasOwnProperty.call(current, 'model')) next.model = agent.model;
    if ((typeof agent.persona === 'string' && agent.persona !== '') || Object.prototype.hasOwnProperty.call(current, 'persona')) next.persona = agent.persona || '';
    // `primary`/`modelFamily` are known legacy runtime extensions, not opaque
    // metadata. Keeping their old assignment while replacing the flat fields
    // creates a document that projection reports as valid but runtime rejects.
    if (assignmentChanged && Object.prototype.hasOwnProperty.call(next, 'modelFamily')) delete next.modelFamily;
    if (_isObject(current.primary)) {
      const primary = { ...current.primary, provider };
      if (agent.model !== null || Object.prototype.hasOwnProperty.call(current.primary, 'model')) primary.model = agent.model;
      if (assignmentChanged && Object.prototype.hasOwnProperty.call(primary, 'modelFamily')) delete primary.modelFamily;
      next.primary = primary;
    }
    _setOwnDataProperty(out.roles, roleKey, next);
  }
  const finalValidation = validateLegacyRoleStore(out);
  if (!finalValidation.ok) return { ok: false, code: finalValidation.code, problems: finalValidation.problems };
  // The v2 schema deliberately preserves legacy extension fields. Validate the
  // final projection with the runtime consumer as well so stale primary/model
  // metadata or malformed fallback extensions cannot pass the schema layer and
  // then be rejected only when routing begins.
  const { validateRoleDefinitionShape } = require('./role-fallback');
  const runtimeProblems = [];
  for (const roleKey of Object.keys(out.roles).sort()) {
    // Reverse projection writes a legacy document. Existing registry IDs may
    // exceed native v2's 64-character bound and are carried losslessly through
    // legacyProjection; validate with the legacy read contract here.
    const runtimeValidation = validateRoleDefinitionShape(roleKey, out.roles[roleKey], { allowLegacyProviderIds: true });
    if (!runtimeValidation.ok) {
      runtimeProblems.push(_problem(
        'legacy-runtime-invalid',
        `$.roles.${roleKey}${runtimeValidation.field ? '.' + runtimeValidation.field : ''}`,
        runtimeValidation.error,
      ));
    }
  }
  if (runtimeProblems.length) return { ok: false, code: 'projection-runtime-invalid', problems: runtimeProblems };
  return {
    ok: true,
    code: 'ok',
    document: out,
    semantic: legacySemanticAssignments(out),
  };
}

function _prefixProblems(problems, prefix) {
  return (problems || []).map(problem => ({
    ...problem,
    path: `${prefix}${problem.path.startsWith('$') ? problem.path.slice(1) : '.' + problem.path}`,
  }));
}

function validateConfigBundle(bundle) {
  const problems = [];
  const path = '$.bundle';
  if (!_isObject(bundle)) return _finish([_problem('root-not-object', path)]);
  _unknownFields(bundle, ['roleDefinitions', 'agentInstances', 'routingPolicy'], path, problems);

  const roleValidation = validateRoleDefinitions(bundle.roleDefinitions);
  const agentValidation = validateAgentInstances(bundle.agentInstances);
  const routingValidation = validateRoutingPolicy(bundle.routingPolicy);
  problems.push(..._prefixProblems(roleValidation.problems, '$.bundle'));
  problems.push(..._prefixProblems(agentValidation.problems, '$.bundle'));
  problems.push(..._prefixProblems(routingValidation.problems, '$.bundle'));

  if (!roleValidation.ok || !agentValidation.ok || !routingValidation.ok) return _finish(problems);

  const roleIds = new Set(BUILTIN_ROLE_IDS);
  for (const roleId of Object.keys(bundle.roleDefinitions.roles)) roleIds.add(roleId);

  const roleDefs = bundle.roleDefinitions.roles;
  for (const roleId of Object.keys(roleDefs).sort()) {
    const parent = roleDefs[roleId].extends;
    if (parent !== undefined && parent !== null && !roleIds.has(parent)) {
      problems.push(_problem('role-extends-target-missing', `$.bundle.roleDefinitions.roles.${roleId}.extends`, parent));
    }
  }
  const roleVisited = new Set();
  const roleVisiting = new Set();
  const roleStack = [];
  const roleCycles = new Set();
  function visitRole(roleId) {
    if (roleVisiting.has(roleId)) {
      const start = roleStack.indexOf(roleId);
      roleCycles.add(roleStack.slice(start).concat(roleId).join(' -> '));
      return;
    }
    if (roleVisited.has(roleId)) return;
    roleVisiting.add(roleId);
    roleStack.push(roleId);
    const def = roleDefs[roleId];
    const parent = def && def.extends;
    if (parent && Object.prototype.hasOwnProperty.call(roleDefs, parent)) visitRole(parent);
    roleStack.pop();
    roleVisiting.delete(roleId);
    roleVisited.add(roleId);
  }
  for (const roleId of Object.keys(roleDefs).sort()) visitRole(roleId);
  for (const cycle of Array.from(roleCycles).sort()) problems.push(_problem('role-extends-cycle', '$.bundle.roleDefinitions.roles', cycle));

  const agents = bundle.agentInstances.agents;
  const byId = new Map(agents.map(agent => [agent.id, agent]));
  const effectiveRolePermissions = roleId => {
    const def = Object.prototype.hasOwnProperty.call(roleDefs, roleId) ? roleDefs[roleId] : {};
    const builtin = Object.prototype.hasOwnProperty.call(BUILTIN_ROLE_PERMISSION_CEILINGS, roleId)
      ? BUILTIN_ROLE_PERMISSION_CEILINGS[roleId] : null;
    return {
      requiredTier: def.requiredTier === undefined ? (builtin && builtin.requiredTier) : def.requiredTier,
      codeWrite: def.codeWrite === undefined ? !!(builtin && builtin.codeWrite) : def.codeWrite === true,
      release: def.release === undefined ? !!(builtin && builtin.release) : def.release === true,
    };
  };
  const sessionPolicyRank = Object.freeze({ forbidden: 0, optional: 1, 'required-for-write': 2 });

  const primaryLegacyByKey = new Map();
  const primaryLegacyByRole = new Map();
  for (const agent of agents.slice().sort((a, b) => _cmpText(a.id, b.id))) {
    const agentPath = `$.bundle.agentInstances.agents.${agent.id}`;
    if (!roleIds.has(agent.role)) problems.push(_problem('unknown-agent-role', `${agentPath}.role`, agent.role));
    const effectivePermissions = effectiveRolePermissions(agent.role);
    if ((effectivePermissions.codeWrite === true || effectivePermissions.release === true)
      && agent.sessionKeyPolicy !== 'required-for-write') {
      problems.push(_problem('write-agent-session-key-required', `${agentPath}.sessionKeyPolicy`, agent.sessionKeyPolicy));
    }
    for (const fallbackId of agent.fallback.slice().sort()) {
      const target = byId.get(fallbackId);
      if (!target) problems.push(_problem('fallback-target-missing', `${agentPath}.fallback`, fallbackId));
      else if (target.role !== agent.role) problems.push(_problem('fallback-role-mismatch', `${agentPath}.fallback`, `${fallbackId}:${target.role}`));
      else if (sessionPolicyRank[target.sessionKeyPolicy] < sessionPolicyRank[agent.sessionKeyPolicy]) {
        problems.push(_problem('fallback-session-policy-weakening', `${agentPath}.fallback`, `${fallbackId}:${target.sessionKeyPolicy}`));
      }
    }

    const projection = agent.legacyProjection;
    if (projection && projection.primary === true) {
      const roleKey = projection.roleKey;
      const projectionPath = `${agentPath}.legacyProjection.roleKey`;
      const projectedRole = legacyRoleId(roleKey);
      if (agent.enabled !== true) {
        problems.push(_problem('disabled-primary-legacy-projection', projectionPath, agent.id));
      }
      if (projectedRole !== agent.role) {
        problems.push(_problem('legacy-role-mismatch', projectionPath, `${roleKey} -> ${agent.role}`));
      }
      if (primaryLegacyByKey.has(roleKey)) {
        problems.push(_problem('duplicate-legacy-role-key', projectionPath, roleKey));
      } else {
        primaryLegacyByKey.set(roleKey, agent.id);
      }
      const semanticOwner = primaryLegacyByRole.get(projectedRole);
      if (semanticOwner && semanticOwner.roleKey !== roleKey) {
        problems.push(_problem('legacy-role-alias-collision', projectionPath, `${semanticOwner.roleKey} -> ${projectedRole}`));
      } else if (!semanticOwner) {
        primaryLegacyByRole.set(projectedRole, { roleKey, agentId: agent.id });
      }
    }
  }

  const visited = new Set();
  const visiting = new Set();
  const stack = [];
  const cycles = new Set();
  function visit(agentId) {
    if (visiting.has(agentId)) {
      const start = stack.indexOf(agentId);
      const cycle = stack.slice(start).concat(agentId).join(' -> ');
      cycles.add(cycle);
      return;
    }
    if (visited.has(agentId)) return;
    visiting.add(agentId);
    stack.push(agentId);
    const agent = byId.get(agentId);
    if (agent) {
      for (const next of agent.fallback.slice().sort()) {
        if (next !== agentId && byId.has(next)) visit(next);
      }
    }
    stack.pop();
    visiting.delete(agentId);
    visited.add(agentId);
  }
  for (const agentId of Array.from(byId.keys()).sort()) visit(agentId);
  for (const cycle of Array.from(cycles).sort()) problems.push(_problem('fallback-cycle', '$.bundle.agentInstances.agents', cycle));

  const enabledRoles = new Set(agents.filter(agent => agent.enabled === true).map(agent => agent.role));
  const assignmentGaps = [];
  for (const pipelineId of Object.keys(bundle.routingPolicy.pipelines).sort()) {
    const roles = bundle.routingPolicy.pipelines[pipelineId];
    for (const roleId of roles) {
      if (!roleIds.has(roleId)) problems.push(_problem('unknown-pipeline-role', `$.bundle.routingPolicy.pipelines.${pipelineId}`, roleId));
      if (!enabledRoles.has(roleId)) {
        assignmentGaps.push({
          code: 'pipeline-role-unassigned',
          pipeline: pipelineId,
          role: roleId,
          reason: 'no-enabled-agent',
        });
      }
    }
  }

  return _finish(problems, {
    roleIds: Array.from(roleIds).sort(),
    agentIds: Array.from(byId.keys()).sort(),
    pipelineIds: Object.keys(bundle.routingPolicy.pipelines).sort(),
    assignmentReady: problems.length === 0 && assignmentGaps.length === 0,
    assignmentGaps,
    readinessScope: 'configured-enabled-agent-assignments-only',
    providerReadinessChecked: false,
  });
}

function validateStoreDocument(kind, doc) {
  if (kind === 'role-definitions') return validateRoleDefinitions(doc);
  if (kind === 'agent-instances') return validateAgentInstances(doc);
  if (kind === 'routing-policy') return validateRoutingPolicy(doc);
  if (kind === 'legacy-agent-roles') return validateLegacyRoleStore(doc);
  return _finish([_problem('unknown-store-kind', '$.kind', kind)]);
}

module.exports = {
  SCHEMA_VERSION,
  LEGACY_SCHEMA_VERSION,
  STORE_FILES,
  PERMISSION_TIERS,
  BUILTIN_ROLE_IDS,
  BUILTIN_ROLE_PERMISSION_CEILINGS,
  LEGACY_PERSISTED_ROLE_IDS,
  ROLE_INPUT_ALIASES,
  HIGH_RISK_REQUIRED_ROLES,
  NAMED_PIPELINE_MINIMUM_REQUIREMENTS,
  canonicalRoleId,
  isCanonicalRoleId,
  stableStringify,
  legacyRoleId,
  stableLegacyAgentId,
  validateRoleDefinitions,
  validateAgentInstances,
  validateRoutingPolicy,
  validateLegacyRoleStore,
  parseLegacyRoleStoreText,
  legacySemanticAssignments,
  defaultRoutingPolicyDocument,
  projectLegacyRoleStore,
  projectAgentInstancesToLegacy,
  validateConfigBundle,
  validateStoreDocument,
};
