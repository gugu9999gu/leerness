'use strict';

const { createHash } = require('node:crypto');

const INPUT_SCHEMA = 'leerness.test-execution-input/v1';
const OUTPUT_SCHEMA = 'leerness.test-execution-plan/v1';
const CHECK_KEYS = ['id', 'stage', 'argv', 'cwd', 'timeoutMs', 'testIds', 'relatedTo', 'coverageIds', 'prerequisites'];
const STAGES = ['focused', 'related', 'final'];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;

class TestExecutionInputError extends Error {
  constructor(code, field) { super(`${code} at ${field}`); this.name = 'TestExecutionInputError'; this.code = `test_plan_${code}`; this.field = field; }
}
function fail(code, field) { throw new TestExecutionInputError(code, field); }
function record(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('object_required', field);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key))) fail('fields_invalid', field);
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !desc.enumerable || !Object.hasOwn(desc, 'value')) fail('data_field_required', `${field}.${key}`);
  }
}
function id(value, field) { if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail('id_invalid', field); }
function ids(value, field, max = 64, empty = true) {
  if (!Array.isArray(value) || value.length > max || (!empty && value.length === 0)) fail('list_invalid', field);
  const seen = new Set();
  value.forEach((entry, i) => {
    id(entry, `${field}[${i}]`);
    if (seen.has(entry)) fail('id_duplicate', `${field}[${i}]`);
    seen.add(entry);
  });
}
function command(check, field) {
  if (!Array.isArray(check.argv) || check.argv.length < 1 || check.argv.length > 16) fail('argv_invalid', `${field}.argv`);
  check.argv.forEach((entry, i) => {
    if (typeof entry !== 'string' || !entry.trim() || entry.length > 256 || /[\u0000-\u001f\u007f]/.test(entry)) fail('argv_invalid', `${field}.argv[${i}]`);
  });
  if (typeof check.cwd !== 'string' || check.cwd.length > 160 || !/^(?:\.|[A-Za-z0-9._/-]+)$/.test(check.cwd)
    || check.cwd.split('/').some(part => part === '..' || part === '') || check.cwd.startsWith('/')) fail('cwd_invalid', `${field}.cwd`);
  if (!Number.isSafeInteger(check.timeoutMs) || check.timeoutMs < 1 || check.timeoutMs > 14400000) fail('timeout_invalid', `${field}.timeoutMs`);
}
function validate(input) {
  record(input, ['schema', 'checks', 'failedTestIds', 'requiredCoverage', 'readiness'], '$');
  if (input.schema !== INPUT_SCHEMA) fail('schema_unsupported', '$.schema');
  if (!Array.isArray(input.checks) || input.checks.length < 2 || input.checks.length > 64) fail('checks_invalid', '$.checks');
  ids(input.failedTestIds, '$.failedTestIds', 64, false);
  ids(input.requiredCoverage, '$.requiredCoverage', 64, false);
  if (!Array.isArray(input.readiness) || input.readiness.length > 64) fail('readiness_invalid', '$.readiness');
  const checks = new Map();
  input.checks.forEach((check, i) => {
    const field = `$.checks[${i}]`;
    record(check, CHECK_KEYS, field);
    id(check.id, `${field}.id`);
    if (checks.has(check.id)) fail('id_duplicate', `${field}.id`);
    if (!STAGES.includes(check.stage)) fail('stage_invalid', `${field}.stage`);
    command(check, field);
    ids(check.testIds, `${field}.testIds`);
    ids(check.relatedTo, `${field}.relatedTo`);
    ids(check.coverageIds, `${field}.coverageIds`);
    ids(check.prerequisites, `${field}.prerequisites`);
    if (check.stage === 'focused' && !check.testIds.length) fail('focused_tests_required', `${field}.testIds`);
    if (check.stage !== 'focused' && check.testIds.length) fail('focused_tests_only', `${field}.testIds`);
    if (check.stage === 'related' && !check.relatedTo.length) fail('related_mapping_required', `${field}.relatedTo`);
    if (check.stage === 'final' && !check.coverageIds.length) fail('final_coverage_required', `${field}.coverageIds`);
    if (check.stage !== 'related' && check.relatedTo.length) fail('related_mapping_invalid', `${field}.relatedTo`);
    checks.set(check.id, check);
  });
  if (![...checks.values()].some(check => check.stage === 'final')) fail('final_required', '$.checks');
  const readiness = new Map();
  input.readiness.forEach((entry, i) => {
    const field = `$.readiness[${i}]`;
    record(entry, ['id', 'status'], field);
    id(entry.id, `${field}.id`);
    if (readiness.has(entry.id)) fail('id_duplicate', `${field}.id`);
    if (!['ready', 'unavailable', 'unknown'].includes(entry.status)) fail('readiness_status_invalid', `${field}.status`);
    readiness.set(entry.id, entry.status);
  });
  for (const [checkId, check] of checks) {
    for (const target of check.relatedTo) if (checks.get(target)?.stage !== 'focused') fail('related_target_invalid', `check:${checkId}.relatedTo`);
    for (const prerequisite of check.prerequisites) if (!readiness.has(prerequisite)) fail('prerequisite_missing', `check:${checkId}.prerequisites`);
  }
  const failureMap = new Map();
  for (const check of checks.values()) if (check.stage === 'focused') {
    for (const testId of check.testIds) {
      const mapped = failureMap.get(testId) || [];
      mapped.push(check.id);
      failureMap.set(testId, mapped);
    }
  }
  for (const testId of input.failedTestIds) {
    const mapped = failureMap.get(testId) || [];
    if (mapped.length !== 1) fail(mapped.length ? 'test_ambiguous' : 'test_unmapped', '$.failedTestIds');
  }
  return { checks, readiness, failureMap };
}

function planTestExecution(input) {
  const { checks, readiness, failureMap } = validate(input);
  const focusedIds = new Set(input.failedTestIds.map(testId => failureMap.get(testId)[0]));
  const selected = [...checks.values()].filter(check => (check.stage === 'focused' && focusedIds.has(check.id))
    || (check.stage === 'related' && check.relatedTo.some(id => focusedIds.has(id))) || check.stage === 'final')
    .sort((left, right) => STAGES.indexOf(left.stage) - STAGES.indexOf(right.stage));
  const selectedIds = new Set(selected.map(check => check.id));
  const stages = Object.fromEntries(STAGES.map(stage => [stage, []]));
  const blockedCheckIds = [];
  for (const check of selected) {
    const missing = check.prerequisites.filter(prerequisite => readiness.get(prerequisite) !== 'ready');
    if (missing.length) blockedCheckIds.push(check.id);
    stages[check.stage].push({ checkId: check.id,
      commandDigest: createHash('sha256').update(JSON.stringify([check.argv, check.cwd, check.timeoutMs])).digest('hex'),
      failedTestIds: check.stage === 'focused' ? input.failedTestIds.filter(testId => check.testIds.includes(testId)) : [],
      declaredPrerequisitesNotReady: missing,
      executionStatus: 'not-run' });
  }
  const finalCoverage = new Set(selected.filter(check => check.stage === 'final').flatMap(check => check.coverageIds));
  const uncoveredRequiredCoverage = input.requiredCoverage.filter(item => !finalCoverage.has(item));
  const needsRelatedReview = stages.related.length === 0;
  const status = uncoveredRequiredCoverage.length ? 'incomplete-final-coverage'
    : blockedCheckIds.length ? 'declared-prerequisite-blocked'
      : needsRelatedReview ? 'needs-related-review' : 'advisory-plan';
  return { schema: OUTPUT_SCHEMA, advisoryOnly: true, executed: false, commandVerified: false,
    readinessVerified: false, coverageVerified: false, finalGatePassed: false, evidenceReusable: false,
    status, stages, blockedCheckIds, uncoveredRequiredCoverage, needsRelatedReview,
    unrunCheckIds: selected.map(check => check.id), notSelectedCheckIds: [...checks.keys()].filter(checkId => !selectedIds.has(checkId)) };
}

module.exports = { INPUT_SCHEMA, OUTPUT_SCHEMA, TestExecutionInputError, planTestExecution };
