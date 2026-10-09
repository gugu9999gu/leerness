'use strict';

const { createHash } = require('node:crypto');

const DIMENSIONS = ['taskType', 'event', 'environment', 'operation'];
const SOURCE_KINDS = ['rule', 'runbook', 'gate', 'instruction'];
const CONCERNS = ['quota-exceeded', 'scope-too-broad', 'possible-duplicate', 'superseded-claim'];
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const invalid = () => {
  const error = new TypeError('Invalid rule assessment input.');
  error.code = 'E_RULE_ASSESSMENT_INVALID';
  throw error;
};

// Inspect descriptors so ordinary accessors are rejected without invoking them.
const assertObject = (value, allowed, required = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) invalid();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid();
  }
  if (required.some(key => !hasOwn(value, key))) invalid();
};

const assertString = (value, max, identifier = false) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) invalid();
  if (/[\p{Cc}\p{Cf}]/u.test(value) || !value.trim()) invalid();
  if (identifier && /\s/u.test(value)) invalid();
};

const assertArray = (value, max) => {
  if (!Array.isArray(value) || value.length > max) invalid();
  if (Object.getPrototypeOf(value) !== Array.prototype) invalid();
  if (Reflect.ownKeys(value).length !== value.length + 1) invalid();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid();
  }
};

const assertDimensions = value => {
  for (const dimension of DIMENSIONS) {
    if (hasOwn(value, dimension)) assertString(value[dimension], 80, true);
  }
};

const assertRule = rule => {
  assertObject(rule, ['id', 'text', 'source', 'appliesWhen', 'concerns'], ['id', 'text', 'source']);
  assertString(rule.id, 80, true);
  assertString(rule.text, 4000);
  assertObject(rule.source, ['kind', 'ref'], ['kind', 'ref']);
  if (!SOURCE_KINDS.includes(rule.source.kind)) invalid();
  assertString(rule.source.ref, 300);
  if (hasOwn(rule, 'appliesWhen')) {
    assertObject(rule.appliesWhen, DIMENSIONS);
    assertDimensions(rule.appliesWhen);
  }
  if (hasOwn(rule, 'concerns')) {
    assertArray(rule.concerns, CONCERNS.length);
    if (rule.concerns.some(concern => !CONCERNS.includes(concern))) invalid();
    if (new Set(rule.concerns).size !== rule.concerns.length) invalid();
  }
};

const assertInput = input => {
  assertObject(input, ['schema', 'task', 'rules'], ['schema', 'task', 'rules']);
  if (input.schema !== 'leerness.rule-assessment-input/v1') invalid();
  assertObject(input.task, ['id', ...DIMENSIONS], ['id']);
  assertString(input.task.id, 80, true);
  assertDimensions(input.task);
  assertArray(input.rules, 50);
  const ids = new Set();
  for (const rule of input.rules) {
    assertRule(rule);
    if (ids.has(rule.id)) invalid();
    ids.add(rule.id);
  }
};

const applicabilityFor = (task, conditions) => {
  const keys = Object.keys(conditions || {});
  if (keys.length === 0) return 'unknown';
  if (keys.some(key => hasOwn(task, key) && task[key] !== conditions[key])) return 'not-applicable';
  if (keys.some(key => !hasOwn(task, key))) return 'unknown';
  return 'applicable';
};

const assessRule = (task, rule) => {
  const applicability = applicabilityFor(task, rule.appliesWhen);
  const concerns = rule.concerns || [];
  const review = applicability === 'not-applicable' || concerns.length > 0;
  const reasons = [applicability === 'unknown' ? 'insufficient-explicit-context'
    : applicability === 'applicable' ? 'explicit-conditions-match' : 'explicit-condition-mismatch'];
  for (const concern of concerns) reasons.push(`caller-reported-${concern}`);
  return {
    ruleId: rule.id,
    source: {
      kind: rule.source.kind,
      ref: rule.source.ref,
      textSha256: createHash('sha256').update(rule.text, 'utf8').digest('hex')
    },
    applicability,
    advisory: review ? 'review-suggested' : 'none',
    exception: 'none',
    verification: 'not-run',
    sourceTrust: 'caller-supplied',
    enforceChanged: false,
    reasons,
    questions: review ? [
      'Should the rule owner review the stated scope while keeping the existing gate unchanged?',
      'What authoritative evidence, preserved objectives and residual risks support any proposed change?'
    ] : []
  };
};

// Explicit caller assertions only: this does not inspect sources or run gates.
const assessRuleApplicability = input => {
  assertInput(input);
  return {
    schema: 'leerness.rule-assessment/v1',
    advisoryOnly: true,
    enforceChanged: false,
    approvalApplied: false,
    sourceTrust: 'caller-supplied',
    task: { ...input.task },
    assessments: input.rules.map(rule => assessRule(input.task, rule)),
    limitations: [
      'Task dimensions, source references, conditions and concerns are unverified caller assertions.',
      'The digest identifies supplied text only; no source file, authority or deployment was inspected.',
      'Condition mismatch is advisory and does not authorize skipping or changing an existing gate.',
      'Cost, quota, duplication and superseded claims do not establish that a rule is unnecessary.',
      'No approval, exception, verification, source discovery or enforcement change is performed.'
    ]
  };
};

module.exports = { assessRuleApplicability };
