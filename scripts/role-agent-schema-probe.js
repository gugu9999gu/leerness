#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const MODULE = path.resolve(__dirname, '..', 'lib', 'role-agent-schema.js');
const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');

function stableEnv() {
  return JSON.stringify(Object.keys(process.env).sort().map(key => [key, process.env[key]]));
}

let writeCalls = 0;
let spawnCalls = 0;
let clockCalls = 0;
const originalDateNow = Date.now;
Date.now = function observedDateNow() { clockCalls++; return originalDateNow(); };
const patched = [];
for (const [object, key] of [
  [fs, 'writeFileSync'], [fs, 'appendFileSync'], [fs, 'mkdirSync'], [fs, 'renameSync'], [fs, 'rmSync'],
  [childProcess, 'spawn'], [childProcess, 'spawnSync'], [childProcess, 'execFile'], [childProcess, 'execFileSync'],
]) {
  const original = object[key];
  patched.push(() => { object[key] = original; });
  object[key] = function patchedSideEffect(...args) {
    if (object === childProcess) spawnCalls++;
    else writeCalls++;
    return original.apply(this, args);
  };
}
const envBeforeRequire = stableEnv();
delete require.cache[MODULE];
const schema = require(MODULE);
const envAfterRequire = stableEnv();
for (const restore of patched.reverse()) restore();
Date.now = originalDateNow;

const {
  SCHEMA_VERSION,
  STORE_FILES,
  PERMISSION_TIERS,
  BUILTIN_ROLE_IDS,
  LEGACY_PERSISTED_ROLE_IDS,
  canonicalRoleId,
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
} = schema;

const failures = [];
let total = 0;
function check(label, condition, detail) {
  total++;
  if (condition) {
    console.log(`✓ ${label}`);
    return;
  }
  failures.push(label);
  console.log(`✗ ${label}${detail ? `\n  ${detail}` : ''}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasProblem(result, code, detail) {
  return !!result && Array.isArray(result.problems) && result.problems.some(problem => problem.code === code && (detail === undefined || String(problem.detail || '').includes(detail)));
}

const legacy = {
  schemaVersion: 1,
  updatedAt: '2026-09-03T00:00:00.000Z',
  projectNote: { owner: 'local' },
  roles: {
    coder: {
      provider: 'codex',
      model: 'gpt-5-codex',
      persona: 'bounded implementer',
      customEntry: { keep: true },
    },
    reviewer: {
      provider: 'claude',
      model: null,
      persona: 'independent reviewer',
    },
  },
};

check('module require performs no file writes, process launches, or environment mutation',
  writeCalls === 0 && spawnCalls === 0 && clockCalls === 0 && envBeforeRequire === envAfterRequire,
  `writes=${writeCalls} spawns=${spawnCalls} clockCalls=${clockCalls} envChanged=${envBeforeRequire !== envAfterRequire}`);

check('v2 store filenames are explicit and keep agent-roles.json as compatibility input',
  SCHEMA_VERSION === 2
    && STORE_FILES.roleDefinitions === 'role-definitions.json'
    && STORE_FILES.agentInstances === 'agent-instances.json'
    && STORE_FILES.routingPolicy === 'routing-policy.json'
    && STORE_FILES.legacyAssignments === 'agent-roles.json');
const existingPermissionTiers = require('../lib/pure-utils').PERMISSION_TIERS;
check('schema permission tiers exactly reuse the existing Leerness policy taxonomy',
  stableStringify(PERMISSION_TIERS) === stableStringify(existingPermissionTiers),
  JSON.stringify({ schema: PERMISSION_TIERS, existing: existingPermissionTiers }));

const widenedBuiltinRoles = {
  schemaVersion: 2,
  kind: 'role-definitions',
  roles: {
    coder: { requiredTier: 'read-only', approve: true, release: true },
    router: { extends: 'release' },
  },
};
const widenedBuiltinResult = validateRoleDefinitions(widenedBuiltinRoles);
check('project overrides cannot widen built-in role permission tiers, authority, or inheritance',
  hasProblem(widenedBuiltinResult, 'builtin-role-tier-widening')
    && widenedBuiltinResult.problems.filter(problem => problem.code === 'builtin-role-authority-widening').length === 2
    && hasProblem(widenedBuiltinResult, 'builtin-role-extends-widening', 'release'),
  JSON.stringify(widenedBuiltinResult.problems));
const narrowedBuiltinRoles = {
  schemaVersion: 2,
  kind: 'role-definitions',
    roles: { coder: { requiredTier: 'publish', codeWrite: false, approve: false, release: false } },
};
check('project overrides may explicitly narrow a built-in role ceiling',
  validateRoleDefinitions(narrowedBuiltinRoles).ok,
  JSON.stringify(validateRoleDefinitions(narrowedBuiltinRoles).problems));

const designDocText = fs.readFileSync(path.resolve(__dirname, '..', 'docs', 'role-agent-routing-v2.md'), 'utf8');
const designJsonBlocks = Array.from(designDocText.matchAll(/```json\s*([\s\S]*?)```/g))
  .map(match => { try { return JSON.parse(match[1]); } catch { return null; } })
  .filter(Boolean);
const designRoleDoc = designJsonBlocks.find(doc => doc.kind === 'role-definitions');
const designAgentDoc = designJsonBlocks.find(doc => doc.kind === 'agent-instances');
const designRoutingDoc = designJsonBlocks.find(doc => doc.kind === 'routing-policy');
check('published v2 design JSON examples parse and pass their strict validators',
  designRoleDoc && validateRoleDefinitions(designRoleDoc).ok
    && designAgentDoc && validateAgentInstances(designAgentDoc).ok
    && designRoutingDoc && validateRoutingPolicy(designRoutingDoc).ok,
  JSON.stringify({
    role: designRoleDoc && validateRoleDefinitions(designRoleDoc).problems,
    agent: designAgentDoc && validateAgentInstances(designAgentDoc).problems,
    routing: designRoutingDoc && validateRoutingPolicy(designRoutingDoc).problems,
  }));

check('role input aliases normalize to compatibility persisted IDs without changing the catalog IDs',
  canonicalRoleId('orchestrator') === 'commander'
    && canonicalRoleId('implementer') === 'coder'
    && canonicalRoleId('worker') === 'coder'
    && canonicalRoleId('assignment-dispatcher') === 'dispatcher'
    && BUILTIN_ROLE_IDS.includes('tester')
    && BUILTIN_ROLE_IDS.includes('security')
    && stableStringify(LEGACY_PERSISTED_ROLE_IDS) === stableStringify(['commander', 'coder', 'dispatcher', 'reviewer', 'architect', 'designer', 'debugger']));

const canonicalSpellingRoleDefinitions = {
  schemaVersion: 2,
  kind: 'role-definitions',
  roles: {
    Coder: {},
    ' reviewer ': {},
    'ｔｅｓｔｅｒ': {},
  },
};
const canonicalSpellingResult = validateRoleDefinitions(canonicalSpellingRoleDefinitions);
check('persisted v2 role IDs reject case, surrounding whitespace, and full-width variants',
  canonicalSpellingResult.problems.filter(problem => problem.code === 'non-canonical-role-id').length === 3,
  JSON.stringify(canonicalSpellingResult.problems));
check('prototype-shaped tokens are ordinary inputs rather than inherited alias properties',
  canonicalRoleId('__proto__') === '__proto__'
    && canonicalRoleId('constructor') === 'constructor'
    && typeof canonicalRoleId('__proto__') === 'string'
    && legacyRoleId('__proto__').startsWith('legacy-role-'));

const legacyValidation = validateLegacyRoleStore(legacy);
check('canonical v1 legacy assignment store validates', legacyValidation.ok, JSON.stringify(legacyValidation.problems));
const priorGeneratedV2Legacy = {
  schemaVersion: 2,
  updatedAt: '2026-09-03T00:00:00.000Z',
  roles: { coder: { provider: 'MyProvider', model: 'custom-model' } },
};
check('previous releases schema-v2 legacy output and case-preserving registered providers remain readable',
  validateLegacyRoleStore(priorGeneratedV2Legacy).ok,
  JSON.stringify(validateLegacyRoleStore(priorGeneratedV2Legacy).problems));
const mixedProviderProjection = projectLegacyRoleStore(priorGeneratedV2Legacy);
const mixedProviderReverse = mixedProviderProjection.ok
  ? projectAgentInstancesToLegacy(mixedProviderProjection.agentInstances, priorGeneratedV2Legacy)
  : null;
check('case-preserving legacy provider IDs round-trip losslessly through canonical v2 projection',
  mixedProviderReverse && mixedProviderReverse.ok
    && /^legacy-provider-[0-9a-f]{16}$/.test(mixedProviderProjection.agentInstances.agents[0].provider)
    && mixedProviderProjection.agentInstances.agents[0].legacyProjection.provider === 'MyProvider'
    && mixedProviderReverse.document.roles.coder.provider === 'MyProvider',
  JSON.stringify(mixedProviderReverse && mixedProviderReverse.problems || mixedProviderProjection.problems || []));
const mixedProviderEditedAgents = JSON.parse(JSON.stringify(mixedProviderProjection.agentInstances));
mixedProviderEditedAgents.agents[0].provider = 'myprovider';
const mixedProviderEditedReverse = projectAgentInstancesToLegacy(mixedProviderEditedAgents, priorGeneratedV2Legacy);
check('changing a projected case-preserving provider to its lowercase spelling remains a real edit',
  mixedProviderEditedReverse.ok
    && mixedProviderEditedReverse.document.roles.coder.provider === 'myprovider',
  JSON.stringify(mixedProviderEditedReverse.problems || []));
const longLegacyProvider = 'P' + 'x'.repeat(64);
const longProviderLegacy = { schemaVersion: 1, roles: { coder: { provider: longLegacyProvider } } };
const longProviderProjection = projectLegacyRoleStore(longProviderLegacy);
const longProviderReverse = longProviderProjection.ok
  ? projectAgentInstancesToLegacy(longProviderProjection.agentInstances, longProviderLegacy)
  : null;
check('legacy provider IDs longer than native v2 limits use a deterministic lossless compatibility projection',
  validateLegacyRoleStore(longProviderLegacy).ok
    && longProviderProjection.ok
    && /^legacy-provider-[0-9a-f]{16}$/.test(longProviderProjection.agentInstances.agents[0].provider)
    && longProviderReverse && longProviderReverse.ok
    && longProviderReverse.document.roles.coder.provider === longLegacyProvider,
  JSON.stringify(longProviderProjection.problems || longProviderReverse && longProviderReverse.problems || []));
check('legacy unknown top-level and per-role fields are surfaced but remain compatible',
  legacyValidation.ok
    && legacyValidation.unknownFields.includes('$.legacyAssignments.projectNote')
    && legacyValidation.unknownFields.includes('$.legacyAssignments.roles.coder.customEntry'));

const unversioned = { roles: { coder: { provider: 'codex' } }, extension: 'keep' };
const unversionedValidation = validateLegacyRoleStore(unversioned);
check('unversioned legacy store remains readable and reports its provenance',
  unversionedValidation.ok && unversionedValidation.unversioned === true && unversionedValidation.version === null);
check('an existing document missing its roles authority fails closed',
  !validateLegacyRoleStore({ schemaVersion: 1 }).ok
    && hasProblem(validateLegacyRoleStore({ schemaVersion: 1 }), 'roles-missing'));

const projected = projectLegacyRoleStore(legacy);
check('valid legacy assignments deterministically project into all three v2 documents',
  projected.ok
    && projected.roleDefinitions.kind === 'role-definitions'
    && projected.agentInstances.kind === 'agent-instances'
    && projected.routingPolicy.kind === 'routing-policy'
    && projected.agentInstances.agents.length === 2,
  JSON.stringify(projected.problems || []));

const reverse = projected.ok ? projectAgentInstancesToLegacy(projected.agentInstances, legacy) : null;
check('legacy to v2 to legacy preserves exact assignment semantics',
  reverse && reverse.ok
    && stableStringify(reverse.semantic) === stableStringify(legacySemanticAssignments(legacy)),
  reverse ? JSON.stringify(reverse.problems || []) : 'projection failed');
check('reverse projection preserves unknown legacy top-level fields',
  reverse && reverse.ok && stableStringify(reverse.document.projectNote) === stableStringify(legacy.projectNote));
check('reverse projection preserves unknown fields inside legacy role entries',
  reverse && reverse.ok && stableStringify(reverse.document.roles.coder.customEntry) === stableStringify(legacy.roles.coder.customEntry));

const extendedLegacy = clone(legacy);
extendedLegacy.roles.coder.modelFamily = 'openai-gpt';
extendedLegacy.roles.coder.primary = {
  provider: 'codex',
  model: 'gpt-5-codex',
  modelFamily: 'openai-gpt',
  extension: 'preserve',
};
const extendedProjection = projectLegacyRoleStore(extendedLegacy);
if (extendedProjection.ok) {
  extendedProjection.agentInstances.agents.find(agent => agent.legacyProjection.roleKey === 'coder').provider = 'claude';
  extendedProjection.agentInstances.agents.find(agent => agent.legacyProjection.roleKey === 'coder').model = 'claude-sonnet-4-7';
}
const extendedReverse = extendedProjection.ok
  ? projectAgentInstancesToLegacy(extendedProjection.agentInstances, extendedLegacy)
  : null;
const extendedRuntimeShape = extendedReverse && extendedReverse.ok
  ? require('../lib/role-fallback').validateRoleDefinitionShape('coder', extendedReverse.document.roles.coder)
  : null;
check('reverse projection synchronizes legacy primary extensions and clears stale model-family claims',
  extendedReverse && extendedReverse.ok
    && extendedReverse.document.roles.coder.provider === 'claude'
    && extendedReverse.document.roles.coder.model === 'claude-sonnet-4-7'
    && extendedReverse.document.roles.coder.primary.provider === 'claude'
    && extendedReverse.document.roles.coder.primary.model === 'claude-sonnet-4-7'
    && extendedReverse.document.roles.coder.primary.extension === 'preserve'
    && !Object.prototype.hasOwnProperty.call(extendedReverse.document.roles.coder, 'modelFamily')
    && !Object.prototype.hasOwnProperty.call(extendedReverse.document.roles.coder.primary, 'modelFamily')
    && extendedRuntimeShape && extendedRuntimeShape.ok,
  JSON.stringify({ projection: extendedProjection.problems, reverse: extendedReverse && extendedReverse.problems, runtime: extendedRuntimeShape }));

const runtimeInvalidBase = clone(legacy);
runtimeInvalidBase.roles.coder.candidates = [{ provider: 'backup', model: 'unsafe;model' }];
const runtimeInvalidReverse = projected.ok
  ? projectAgentInstancesToLegacy(projected.agentInstances, runtimeInvalidBase)
  : null;
check('reverse projection validates the final legacy document with the runtime consumer',
  runtimeInvalidReverse && !runtimeInvalidReverse.ok
    && runtimeInvalidReverse.code === 'projection-runtime-invalid'
    && hasProblem(runtimeInvalidReverse, 'legacy-runtime-invalid'),
  JSON.stringify(runtimeInvalidReverse));

const aliasLegacy = {
  roles: {
    implementer: {
      provider: 'qwen',
      model: 'qwen-coder',
      aliasMetadata: 'must-survive',
    },
  },
};
const aliasProjection = projectLegacyRoleStore(aliasLegacy);
const aliasReverse = aliasProjection.ok ? projectAgentInstancesToLegacy(aliasProjection.agentInstances, aliasLegacy) : null;
check('legacy alias-like custom keys are not silently reinterpreted as new built-in roles',
  aliasProjection.ok
    && aliasProjection.agentInstances.agents[0].role === legacyRoleId('implementer')
    && aliasProjection.agentInstances.agents[0].role.startsWith('legacy-role-')
    && aliasProjection.agentInstances.agents[0].role !== 'coder'
    && aliasProjection.agentInstances.agents[0].legacyProjection.roleKey === 'implementer');
check('reverse projection restores the original alias key instead of silently rewriting it',
  aliasReverse && aliasReverse.ok
    && Object.prototype.hasOwnProperty.call(aliasReverse.document.roles, 'implementer')
    && !Object.prototype.hasOwnProperty.call(aliasReverse.document.roles, 'coder')
    && aliasReverse.document.roles.implementer.aliasMetadata === 'must-survive');

const distinctOldAndAliasLike = {
  schemaVersion: 1,
  roles: {
    coder: { provider: 'codex' },
    implementer: { provider: 'qwen' },
    tester: { provider: 'claude' },
  },
};
const distinctOldAndAliasLikeValidation = validateLegacyRoleStore(distinctOldAndAliasLike);
const distinctOldAndAliasLikeProjection = projectLegacyRoleStore(distinctOldAndAliasLike);
check('legacy canonical roles and later alias-like custom roles retain distinct identities',
  distinctOldAndAliasLikeValidation.ok
    && distinctOldAndAliasLikeProjection.ok
    && distinctOldAndAliasLikeProjection.agentInstances.agents.some(agent => agent.role === 'coder')
    && distinctOldAndAliasLikeProjection.agentInstances.agents.some(agent => agent.role === legacyRoleId('implementer') && agent.role !== 'coder')
    && distinctOldAndAliasLikeProjection.agentInstances.agents.some(agent => agent.role === legacyRoleId('tester') && agent.role !== 'tester'),
  JSON.stringify(distinctOldAndAliasLikeProjection.problems || []));

const customLegacy = {
  schemaVersion: 1,
  customTop: { preserve: true },
  roles: {
    'Special QA / 검수 01': { provider: 'codex', model: null, customRoleField: 'preserve' },
  },
};
const customLegacyBefore = stableStringify(customLegacy);
const customLegacyProjection = projectLegacyRoleStore(customLegacy);
const customProjectedRole = legacyRoleId('Special QA / 검수 01');
const customLegacyReverse = customLegacyProjection.ok
  ? projectAgentInstancesToLegacy(customLegacyProjection.agentInstances, customLegacy)
  : null;
check('legacy custom role keys accepted by existing --force behavior receive a stable conservative v2 role ID',
  customLegacyProjection.ok
    && customProjectedRole.startsWith('legacy-role-')
    && customLegacyProjection.agentInstances.agents[0].role === customProjectedRole
    && customLegacyProjection.roleDefinitions.roles[customProjectedRole].requiredTier === 'read-only'
    && customLegacyProjection.roleDefinitions.roles[customProjectedRole].codeWrite === false
    && customLegacyProjection.roleDefinitions.roles[customProjectedRole].forbidden.includes('permission-widening-without-explicit-review'),
  JSON.stringify(customLegacyProjection.problems || []));
check('custom legacy role projection round-trips the original key and unknown fields',
  customLegacyReverse && customLegacyReverse.ok
    && Object.prototype.hasOwnProperty.call(customLegacyReverse.document.roles, 'Special QA / 검수 01')
    && customLegacyReverse.document.roles['Special QA / 검수 01'].customRoleField === 'preserve'
    && customLegacyReverse.document.customTop.preserve === true);
check('projection functions do not mutate the supplied legacy document',
  stableStringify(customLegacy) === customLegacyBefore);

const protoLegacy = JSON.parse('{"schemaVersion":1,"roles":{"__proto__":{"provider":"codex","model":null}}}');
const protoProjection = projectLegacyRoleStore(protoLegacy);
const protoReverse = protoProjection.ok
  ? projectAgentInstancesToLegacy(protoProjection.agentInstances, { schemaVersion: 1, roles: {} })
  : null;
const protoSemantic = protoReverse && protoReverse.ok ? legacySemanticAssignments(protoReverse.document) : null;
check('legacy __proto__ role keys remain own JSON data without prototype mutation or semantic loss',
  protoProjection.ok
    && protoReverse && protoReverse.ok
    && Object.prototype.hasOwnProperty.call(protoReverse.document.roles, '__proto__')
    && Object.getPrototypeOf(protoReverse.document.roles) === Object.prototype
    && protoReverse.document.roles.__proto__.provider === 'codex'
    && protoSemantic && Object.prototype.hasOwnProperty.call(protoSemantic, '__proto__')
    && protoSemantic.__proto__.provider === 'codex'
    && ({}).provider === undefined,
  JSON.stringify(protoReverse && protoReverse.problems || protoProjection.problems || []));
const normalizedCustomCollision = validateLegacyRoleStore({
  schemaVersion: 1,
  roles: {
    'Special QA Role': { provider: 'codex' },
    ' special qa role ': { provider: 'claude' },
  },
});
check('legacy custom role keys that normalize to one runtime identity fail as an alias collision',
  !normalizedCustomCollision.ok && hasProblem(normalizedCustomCollision, 'legacy-role-alias-collision'));
const shorthandFormatCollision = validateLegacyRoleStore({
  schemaVersion: 1,
  roles: {
    specialist: { provider: 'codex' },
    ['spec\u{1bca0}ialist']: { provider: 'claude' },
  },
});
check('Shorthand Format Controls cannot create a second legacy role identity',
  !shorthandFormatCollision.ok && hasProblem(shorthandFormatCollision, 'legacy-role-alias-collision'),
  JSON.stringify(shorthandFormatCollision.problems));

const corruptSource = '{ \"apiKey\": \"SECRET-SHOULD-NOT-ECHO\" ';
const corrupt = parseLegacyRoleStoreText(corruptSource);
check('corrupt legacy JSON is distinct from schema invalidity and does not echo malformed source text',
  !corrupt.ok
    && corrupt.state === 'invalid-json'
    && hasProblem(corrupt, 'invalid-json')
    && !JSON.stringify(corrupt).includes('SECRET-SHOULD-NOT-ECHO'));
const empty = parseLegacyRoleStoreText('  \n\t');
const bomOnly = parseLegacyRoleStoreText('\ufeff');
check('existing zero-byte or BOM-only legacy text fails closed instead of becoming an empty assignment store',
  !empty.ok && empty.state === 'empty-document' && hasProblem(empty, 'empty-document')
    && !bomOnly.ok && bomOnly.state === 'empty-document' && hasProblem(bomOnly, 'empty-document'));
const futureLegacy = validateLegacyRoleStore({ schemaVersion: 9, roles: {} });
check('future legacy schema versions are rejected distinctly',
  !futureLegacy.ok && hasProblem(futureLegacy, 'unsupported-schema-version', '9'));

for (const [label, bad, code] of [
  ['invalid legacy provider is rejected', { roles: { coder: { provider: '' } } }, 'invalid-legacy-provider'],
  ['invalid legacy model is rejected', { roles: { coder: { provider: 'codex', model: { id: 'x' } } } }, 'invalid-legacy-model'],
  ['invalid legacy persona is rejected', { roles: { coder: { provider: 'codex', persona: { text: 'x' } } } }, 'invalid-legacy-persona'],
]) {
  const result = validateLegacyRoleStore(bad);
  check(label, !result.ok && hasProblem(result, code));
}

const legacyReordered = {
  roles: {
    reviewer: clone(legacy.roles.reviewer),
    coder: clone(legacy.roles.coder),
  },
  projectNote: clone(legacy.projectNote),
  updatedAt: legacy.updatedAt,
  schemaVersion: legacy.schemaVersion,
};
const projectedReordered = projectLegacyRoleStore(legacyReordered);
check('legacy projection is deterministic regardless of object insertion order',
  projected.ok && projectedReordered.ok
    && stableStringify(projected.roleDefinitions) === stableStringify(projectedReordered.roleDefinitions)
    && stableStringify(projected.agentInstances) === stableStringify(projectedReordered.agentInstances)
    && stableStringify(projected.routingPolicy) === stableStringify(projectedReordered.routingPolicy));
check('projected legacy Agent IDs are stable functions of the original role key',
  projected.ok
    && projected.agentInstances.agents.every(agent => agent.id === stableLegacyAgentId(agent.legacyProjection.roleKey)));

const roleDefinitions = projected.roleDefinitions;
const agentInstances = projected.agentInstances;
const routingPolicy = projected.routingPolicy;
check('projected role-definitions document passes strict v2 validation', validateRoleDefinitions(roleDefinitions).ok);
check('projected agent-instances document passes strict v2 validation', validateAgentInstances(agentInstances).ok);
check('projected routing-policy document passes strict v2 validation', validateRoutingPolicy(routingPolicy).ok);
check('null token budgets remain valid unknown values, not zero or unlimited',
  agentInstances.agents.every(agent => agent.budget.inputTokens === null && agent.budget.outputTokens === null)
    && validateAgentInstances(agentInstances).ok);

const twoWorkers = clone(agentInstances);
twoWorkers.agents = [
  {
    ...clone(agentInstances.agents[0]),
    id: 'worker-a',
    role: 'coder',
    provider: 'qwen',
    model: 'same-model',
    legacyProjection: undefined,
  },
  {
    ...clone(agentInstances.agents[0]),
    id: 'worker-b',
    role: 'coder',
    provider: 'qwen',
    model: 'same-model',
    legacyProjection: undefined,
  },
].map(agent => {
  delete agent.legacyProjection;
  return agent;
});
check('multiple Agents may share one role/provider/model while retaining distinct IDs',
  validateAgentInstances(twoWorkers).ok && twoWorkers.agents[0].id !== twoWorkers.agents[1].id);

const unknownRoleTop = clone(roleDefinitions);
unknownRoleTop.extra = true;
check('strict v2 validation reports unknown top-level fields distinctly',
  hasProblem(validateRoleDefinitions(unknownRoleTop), 'unknown-field', undefined));
const unknownAgentNested = clone(agentInstances);
unknownAgentNested.agents[0].providerTemplate = { provider: 'x', model: 'y' };
check('strict v2 validation rejects unknown nested Agent fields',
  hasProblem(validateAgentInstances(unknownAgentNested), 'unknown-field'));
const unsafeModelAgent = clone(agentInstances);
unsafeModelAgent.agents[0].model = 'unsafe;model';
check('strict v2 Agent validation rejects model identifiers that runtime dispatch cannot accept',
  hasProblem(validateAgentInstances(unsafeModelAgent), 'invalid-agent-model'));
const futureV2 = clone(agentInstances);
futureV2.schemaVersion = 3;
check('unsupported v2 schema version is distinct from an unknown field',
  hasProblem(validateAgentInstances(futureV2), 'unsupported-schema-version', '3')
    && !hasProblem(validateAgentInstances(futureV2), 'unknown-field'));

const validBundle = { roleDefinitions, agentInstances, routingPolicy };
const validBundleResult = validateConfigBundle(validBundle);
check('projected configuration bundle passes cross-document validation',
  validBundleResult.ok,
  JSON.stringify(validBundleResult.problems));
check('schema validity is not misreported as provider or executable readiness when assignments are incomplete',
  validBundleResult.ok
    && validBundleResult.assignmentReady === false
    && validBundleResult.readinessScope === 'configured-enabled-agent-assignments-only'
    && validBundleResult.providerReadinessChecked === false
    && validBundleResult.assignmentGaps.some(gap => gap.pipeline === 'high-risk' && gap.role === 'architect' && gap.reason === 'no-enabled-agent')
    && projected.assignmentReady === false
    && projected.providerReadinessChecked === false
    && projected.assignmentGaps.length === validBundleResult.assignmentGaps.length,
  JSON.stringify(validBundleResult.assignmentGaps));

function bundleWithAgents(agents) {
  return {
    roleDefinitions: clone(roleDefinitions),
    agentInstances: { schemaVersion: 2, kind: 'agent-instances', agents, source: clone(agentInstances.source) },
    routingPolicy: clone(routingPolicy),
  };
}
function baseAgent(id, role = 'coder') {
  return {
    id,
    role,
    provider: 'codex',
    model: null,
    persona: '',
    enabled: true,
    maxConcurrency: 1,
    sessionKeyPolicy: 'required-for-write',
    budget: { inputTokens: null, outputTokens: null, retries: 1 },
    fallback: [],
    tags: [],
  };
}

const fullyAssignedBundle = bundleWithAgents([
  baseAgent('architect-a', 'architect'),
  baseAgent('commander-a', 'commander'),
  baseAgent('worker-a', 'coder'),
  baseAgent('tester-a', 'tester'),
  baseAgent('reviewer-a', 'reviewer'),
]);
const fullyAssignedResult = validateConfigBundle(fullyAssignedBundle);
check('a fully staffed default pipeline is structurally valid and assignment-ready only',
  fullyAssignedResult.ok
    && fullyAssignedResult.assignmentReady === true
    && fullyAssignedResult.assignmentGaps.length === 0
    && fullyAssignedResult.readinessScope === 'configured-enabled-agent-assignments-only'
    && fullyAssignedResult.providerReadinessChecked === false,
  JSON.stringify(fullyAssignedResult));
const structurallyInvalidReadyBundle = clone(fullyAssignedBundle);
structurallyInvalidReadyBundle.agentInstances.agents.find(agent => agent.id === 'worker-a').fallback = ['worker-b'];
structurallyInvalidReadyBundle.agentInstances.agents.push({ ...baseAgent('worker-b'), fallback: ['worker-a'] });
const structurallyInvalidReadyResult = validateConfigBundle(structurallyInvalidReadyBundle);
check('an invalid bundle can never report assignmentReady even when every pipeline role has an enabled Agent',
  !structurallyInvalidReadyResult.ok
    && structurallyInvalidReadyResult.assignmentReady === false
    && hasProblem(structurallyInvalidReadyResult, 'fallback-cycle'));

const missingFallbackBundle = bundleWithAgents([
  { ...baseAgent('worker-a'), fallback: ['worker-missing'] },
]);
check('bundle validation rejects fallback targets that do not exist',
  hasProblem(validateConfigBundle(missingFallbackBundle), 'fallback-target-missing', 'worker-missing'));

const mismatchBundle = bundleWithAgents([
  { ...baseAgent('worker-a', 'coder'), fallback: ['reviewer-a'] },
  baseAgent('reviewer-a', 'reviewer'),
]);
check('bundle validation rejects fallback to a different role',
  hasProblem(validateConfigBundle(mismatchBundle), 'fallback-role-mismatch', 'reviewer-a'));

const weakenedSessionFallback = bundleWithAgents([
  { ...baseAgent('worker-a', 'coder'), fallback: ['worker-b'] },
  { ...baseAgent('worker-b', 'coder'), sessionKeyPolicy: 'forbidden' },
]);
const weakenedSessionFallbackResult = validateConfigBundle(weakenedSessionFallback);
check('write Agents require stable session keys and fallback cannot weaken the source session policy',
  hasProblem(weakenedSessionFallbackResult, 'write-agent-session-key-required')
    && hasProblem(weakenedSessionFallbackResult, 'fallback-session-policy-weakening', 'worker-b'));

const releaseWithoutSession = bundleWithAgents([
  { ...baseAgent('release-a', 'release'), sessionKeyPolicy: 'forbidden' },
]);
check('release-capable Agents require stable session keys even when codeWrite is false',
  hasProblem(validateConfigBundle(releaseWithoutSession), 'write-agent-session-key-required'));

const selfFallbackBundle = bundleWithAgents([
  { ...baseAgent('worker-a'), fallback: ['worker-a'] },
]);
check('self-fallback is rejected before execution planning',
  hasProblem(validateConfigBundle(selfFallbackBundle), 'self-fallback', 'worker-a'));

const cycleBundle = bundleWithAgents([
  { ...baseAgent('worker-a'), fallback: ['worker-b'] },
  { ...baseAgent('worker-b'), fallback: ['worker-a'] },
]);
check('fallback cycles are rejected deterministically',
  hasProblem(validateConfigBundle(cycleBundle), 'fallback-cycle', 'worker-a'));

const templateFallback = clone(agentInstances);
templateFallback.agents[0].fallback = [{ provider: 'qwen', model: 'x' }];
check('fallback accepts Agent IDs only and rejects provider/model templates',
  hasProblem(validateAgentInstances(templateFallback), 'invalid-fallback-agent-id'));

const missingHighRisk = clone(routingPolicy);
missingHighRisk.pipelines['high-risk'] = ['architect', 'commander', 'coder', 'reviewer'];
check('high-risk routing policy requires an explicit Tester stage',
  hasProblem(validateRoutingPolicy(missingHighRisk), 'high-risk-role-missing', 'tester'));
const emptyNormalPipeline = clone(routingPolicy);
emptyNormalPipeline.pipelines.normal = [];
check('named routing pipelines cannot be empty no-op configurations',
  hasProblem(validateRoutingPolicy(emptyNormalPipeline), 'empty-pipeline'));

const missingHighRiskRequirements = clone(routingPolicy);
delete missingHighRiskRequirements.requirements['high-risk'];
check('high-risk routing policy requires an explicit fail-closed requirement block',
  hasProblem(validateRoutingPolicy(missingHighRiskRequirements), 'high-risk-requirements-required'));
const missingNormalRequirements = clone(routingPolicy);
delete missingNormalRequirements.requirements.normal;
check('every routing pipeline requires its own explicit safety requirement block',
  hasProblem(validateRoutingPolicy(missingNormalRequirements), 'pipeline-requirement-missing')
    && validateRoutingPolicy(missingNormalRequirements).problems.some(problem => problem.path.endsWith('.requirements.normal')));
const reviewerRequirementWithoutStage = clone(routingPolicy);
reviewerRequirementWithoutStage.pipelines.normal = ['commander', 'coder', 'tester'];
check('independent-reviewer requirements cannot survive without a Reviewer stage',
  hasProblem(validateRoutingPolicy(reviewerRequirementWithoutStage), 'independent-reviewer-role-missing', 'reviewer'));
const namedPipelineContractBroken = clone(routingPolicy);
namedPipelineContractBroken.pipelines.normal = ['commander', 'coder', 'reviewer'];
namedPipelineContractBroken.pipelines['high-risk'] = ['commander', 'architect', 'coder', 'reviewer', 'tester'];
const namedPipelineContractResult = validateRoutingPolicy(namedPipelineContractBroken);
check('named pipeline minimum stages and safety order are fail-closed',
  hasProblem(namedPipelineContractResult, 'named-pipeline-role-missing', 'tester')
    && hasProblem(namedPipelineContractResult, 'high-risk-role-order-invalid', 'architect -> commander -> coder -> tester -> reviewer'));
const weakenedHighRisk = clone(routingPolicy);
weakenedHighRisk.requirements['high-risk'].humanApproval = false;
weakenedHighRisk.requirements['high-risk'].leaseForWrites = false;
const weakenedHighRiskResult = validateRoutingPolicy(weakenedHighRisk);
check('high-risk human approval and write-lease requirements cannot be silently disabled',
  hasProblem(weakenedHighRiskResult, 'high-risk-requirement-disabled', 'humanApproval')
    && hasProblem(weakenedHighRiskResult, 'high-risk-requirement-disabled', 'leaseForWrites'));
const weakenedNormal = clone(routingPolicy);
weakenedNormal.requirements.normal.independentReviewer = false;
weakenedNormal.requirements.normal.gate = false;
const weakenedNormalResult = validateRoutingPolicy(weakenedNormal);
check('normal pipeline independent review and gate minimums cannot be silently disabled',
  hasProblem(weakenedNormalResult, 'named-pipeline-requirement-disabled', 'independentReviewer')
    && hasProblem(weakenedNormalResult, 'named-pipeline-requirement-disabled', 'gate'));
const weakenedTiny = clone(routingPolicy);
weakenedTiny.requirements.tiny.verifyClaim = false;
weakenedTiny.requirements.tiny.leaseForWrites = false;
const weakenedTinyResult = validateRoutingPolicy(weakenedTiny);
check('tiny pipeline still requires evidence verification and write leases',
  hasProblem(weakenedTinyResult, 'named-pipeline-requirement-disabled', 'verifyClaim')
    && hasProblem(weakenedTinyResult, 'named-pipeline-requirement-disabled', 'leaseForWrites'));

const aliasInV2 = clone(routingPolicy);
aliasInV2.pipelines.normal = ['orchestrator', 'coder', 'tester', 'reviewer'];
check('v2 routing persists canonical compatibility role IDs rather than display aliases',
  hasProblem(validateRoutingPolicy(aliasInV2), 'non-canonical-pipeline-role'));

const unknownRoleBundle = bundleWithAgents([baseAgent('worker-a', 'custom-missing')]);
check('bundle validation rejects Agent roles absent from built-ins and project definitions',
  hasProblem(validateConfigBundle(unknownRoleBundle), 'unknown-agent-role', 'custom-missing'));

const customRoleDefinitions = clone(roleDefinitions);
customRoleDefinitions.roles['data-specialist'] = {
  label: { ko: '데이터 담당', en: 'Data specialist' },
  responsibilities: ['implement bounded data changes'],
  requiredTier: 'project-write',
  codeWrite: true,
  approve: false,
  release: false,
  forbidden: ['approve-own-work'],
  requiredInputs: ['task', 'allowedFiles'],
  requiredOutputs: ['changedFiles', 'tests', 'evidence'],
  contextPolicy: 'assigned-files-and-contract',
  defaultBudget: { inputTokens: null, outputTokens: null, retries: 1 },
};
const constructorRoleDefinitions = clone(roleDefinitions);
constructorRoleDefinitions.roles.constructor = clone(customRoleDefinitions.roles['data-specialist']);
check('custom role IDs that shadow Object prototype names are not mistaken for built-ins',
  validateRoleDefinitions(constructorRoleDefinitions).ok,
  JSON.stringify(validateRoleDefinitions(constructorRoleDefinitions).problems));
const unsafeReleaseRoleDefinitions = clone(customRoleDefinitions);
unsafeReleaseRoleDefinitions.roles['data-specialist'].requiredTier = 'read-only';
unsafeReleaseRoleDefinitions.roles['data-specialist'].release = true;
check('effective release and code-write capabilities require their minimum permission tiers',
  hasProblem(validateRoleDefinitions(unsafeReleaseRoleDefinitions), 'code-write-tier-too-low')
    && hasProblem(validateRoleDefinitions(unsafeReleaseRoleDefinitions), 'release-tier-too-low'));
const customAgent = baseAgent('data-worker', 'data-specialist');
const customBundle = {
  roleDefinitions: customRoleDefinitions,
  agentInstances: { schemaVersion: 2, kind: 'agent-instances', agents: [customAgent], source: clone(agentInstances.source) },
  routingPolicy: clone(routingPolicy),
};
check('explicit project role definitions allow a custom Agent role without provider coupling',
  validateConfigBundle(customBundle).ok,
  JSON.stringify(validateConfigBundle(customBundle).problems));
const controlRoleDefinitions = clone(customRoleDefinitions);
controlRoleDefinitions.roles['data-specialist'].label.en = 'bad\u0001label';
check('strict persisted text validation rejects the full C0 control range',
  hasProblem(validateRoleDefinitions(controlRoleDefinitions), 'invalid-role-label-en'));
const providerCoupledRole = clone(customRoleDefinitions);
providerCoupledRole.roles['data-specialist'].provider = 'codex';
providerCoupledRole.roles['data-specialist'].model = 'some-model';
const providerCoupledResult = validateRoleDefinitions(providerCoupledRole);
check('Role definitions reject provider/model coupling as strict unknown fields',
  hasProblem(providerCoupledResult, 'unknown-field')
    && providerCoupledResult.problems.some(problem => problem.path.endsWith('.provider'))
    && providerCoupledResult.problems.some(problem => problem.path.endsWith('.model')));

const missingRoleParentBundle = clone(customBundle);
missingRoleParentBundle.roleDefinitions.roles['data-specialist'].extends = 'missing-role';
check('role inheritance rejects a missing parent role',
  hasProblem(validateConfigBundle(missingRoleParentBundle), 'role-extends-target-missing', 'missing-role'));
const roleCycleBundle = clone(customBundle);
roleCycleBundle.roleDefinitions.roles['data-specialist'].extends = 'data-reviewer';
roleCycleBundle.roleDefinitions.roles['data-reviewer'] = {
  label: { ko: '데이터 검수', en: 'Data reviewer' },
  extends: 'data-specialist',
  responsibilities: ['review bounded data changes'],
  requiredTier: 'read-only',
  codeWrite: false,
  approve: true,
  release: false,
  forbidden: ['approve-own-work'],
  requiredInputs: [],
  requiredOutputs: [],
  contextPolicy: 'bounded-review',
  defaultBudget: { inputTokens: null, outputTokens: null, retries: 1 },
};
check('role inheritance cycles are rejected deterministically',
  hasProblem(validateConfigBundle(roleCycleBundle), 'role-extends-cycle', 'data-specialist'));

const mismatchedReverseAgents = clone(agentInstances);
mismatchedReverseAgents.agents[0].role = 'reviewer';
const mismatchedReverse = projectAgentInstancesToLegacy(mismatchedReverseAgents, legacy);
check('reverse projection rejects a legacy role-key and canonical-role mismatch',
  !mismatchedReverse.ok && hasProblem(mismatchedReverse, 'legacy-role-mismatch'));

const duplicateLegacyProjection = clone(agentInstances);
duplicateLegacyProjection.agents.push({
  ...clone(duplicateLegacyProjection.agents[0]),
  id: 'duplicate-projection',
});
const duplicateReverse = projectAgentInstancesToLegacy(duplicateLegacyProjection, legacy);
check('reverse projection rejects multiple primary Agents for one legacy role key',
  !duplicateReverse.ok && hasProblem(duplicateReverse, 'duplicate-legacy-role-key'));

const collidingBundle = bundleWithAgents([
  { ...baseAgent('legacy-custom-a', legacyRoleId('Special QA Role')), legacyProjection: { file: 'agent-roles.json', roleKey: 'Special QA Role', primary: true } },
  { ...baseAgent('legacy-custom-b', legacyRoleId('Special QA Role')), legacyProjection: { file: 'agent-roles.json', roleKey: ' special qa role ', primary: true } },
]);
check('bundle validation rejects distinct custom legacy keys that normalize to one runtime identity',
  hasProblem(validateConfigBundle(collidingBundle), 'legacy-role-alias-collision', legacyRoleId('Special QA Role')));
const mismatchedBundleProjection = bundleWithAgents([
  { ...baseAgent('legacy-reviewer-as-coder', 'reviewer'), legacyProjection: { file: 'agent-roles.json', roleKey: 'coder', primary: true } },
]);
check('bundle validation rejects a primary legacy projection whose semantic role differs from the Agent role',
  hasProblem(validateConfigBundle(mismatchedBundleProjection), 'legacy-role-mismatch', 'coder'));
const disabledPrimaryProjection = bundleWithAgents([
  { ...baseAgent('legacy-disabled', 'coder'), enabled: false, legacyProjection: { file: 'agent-roles.json', roleKey: 'coder', primary: true } },
]);
const disabledPrimaryBundleResult = validateConfigBundle(disabledPrimaryProjection);
const disabledPrimaryReverseResult = projectAgentInstancesToLegacy(disabledPrimaryProjection.agentInstances, { schemaVersion: 1, roles: {} });
check('disabled primary Agents cannot be projected into legacy storage as silently enabled assignments',
  hasProblem(disabledPrimaryBundleResult, 'disabled-primary-legacy-projection', 'legacy-disabled')
    && !disabledPrimaryReverseResult.ok
    && hasProblem(disabledPrimaryReverseResult, 'disabled-primary-legacy-projection', 'legacy-disabled'));

const defaultPolicy = defaultRoutingPolicyDocument();
check('default v2 routing remains suggestion-only and contains no execution flag',
  defaultPolicy.defaultMode === 'suggest'
    && !Object.prototype.hasOwnProperty.call(defaultPolicy, 'execute')
    && validateRoutingPolicy(defaultPolicy).ok);
check('standalone defaults and legacy projections carry distinct truthful provenance',
  defaultPolicy.source.kind === 'built-in-default'
    && defaultPolicy.source.file === 'lib/role-agent-schema.js'
    && projected.routingPolicy.source.kind === 'legacy-agent-roles-v1'
    && projected.routingPolicy.source.file === 'agent-roles.json');
check('Role definitions contain no provider or model coupling in the legacy projection',
  Object.keys(projected.roleDefinitions.roles).length === 0
    && !stableStringify(projected.roleDefinitions).includes('provider')
    && !stableStringify(projected.roleDefinitions).includes('model'));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-role-schema-'));
try {
  const stateDir = path.join(temp, '.leerness');
  fs.mkdirSync(stateDir, { recursive: true });
  const legacyFile = path.join(stateDir, STORE_FILES.legacyAssignments);
  const legacyBytes = JSON.stringify(legacy, null, 2) + '\n';
  fs.writeFileSync(legacyFile, legacyBytes, 'utf8');
  const beforeBytes = fs.readFileSync(legacyFile);
  const run = childProcess.spawnSync(process.execPath, [CLI, 'roles', 'list', '--path', temp, '--json'], {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      LEERNESS_INTERNAL: '1',
      LEERNESS_OFFLINE: '1',
      LEERNESS_NO_PROMPT: '1',
      LEERNESS_NO_STALE_CHECK: '1',
      LEERNESS_NO_AUTO_ROADMAP: '1',
      LEERNESS_NO_AUTOCHCP: '1',
    },
  });
  let parsed = null;
  try { parsed = JSON.parse(run.stdout); } catch {}
  const afterBytes = fs.readFileSync(legacyFile);
  check('existing CLI still reads a valid agent-roles.json without a ready provider or model execution',
    run.status === 0
      && parsed && parsed.count === 2
      && parsed.roles.coder.provider === 'codex'
      && parsed.roles.reviewer.provider === 'claude'
      && run.stderr === '',
    `exit=${run.status} stdout=${String(run.stdout || '').slice(0, 300)} stderr=${String(run.stderr || '').slice(0, 300)}`);
  check('existing roles list compatibility read leaves legacy bytes unchanged',
    Buffer.compare(beforeBytes, afterBytes) === 0);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`Role/Agent/Routing schema probe failed: ${failures.length}/${total}`);
  failures.forEach(label => console.error(`- ${label}`));
  process.exit(1);
}
console.log(`Role/Agent/Routing schema probe: ${total}/${total} passed`);
