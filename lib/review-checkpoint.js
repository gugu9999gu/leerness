'use strict';

// RB-01: a pure, bounded advisory over caller-supplied JSON. No repository reads,
// persistence, model invocation, reviewer approval, or enforcement changes.
const { createHash } = require('node:crypto');
const { validateUiBoundaryTask, uiBoundaryTaskCoverage, UiBoundaryContractError } = require('./ui-boundary-contracts');
const INPUT_SCHEMA = 'leerness.review-checkpoint-input/v1';
const OUTPUT_SCHEMA = 'leerness.review-checkpoint-assessment/v1';
const MAX_BYTES = 65536;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RISK = ['low', 'normal', 'high', 'critical', 'unknown'];
const TAGS = ['authentication', 'authorization', 'payment', 'destructive-migration', 'sensitive-data', 'irreversible-change'];
const ASPECTS = ['code', 'security', 'data', 'compatibility', 'performance', 'ux', 'tests'];
const EVENTS = ['task-report', 'handoff', 'manual-review', 'integration', 'release', 'risk-apply'];

class ReviewCheckpointInputError extends Error {
  constructor(code, field) {
    super(`${code} at ${field}`); // Do not echo potentially sensitive input values.
    this.name = 'ReviewCheckpointInputError';
    this.code = code;
    this.field = field;
  }
}
function fail(code, field) { throw new ReviewCheckpointInputError(code, field); }

// This API accepts inert JSON data, not executable objects. Reject cycles,
// accessors, exotic prototypes, sparse arrays, hidden fields and excessive depth.
// Proxy traps are outside this contract; this is not a JavaScript sandbox.
function jsonData(value) {
  const ancestors = new Set();
  let nodes = 0;
  let scalarBytes = 0;
  function account(text, field) {
    if (text.length > MAX_BYTES) fail('input_too_large', field);
    scalarBytes += Buffer.byteLength(JSON.stringify(text), 'utf8');
    if (scalarBytes > MAX_BYTES) fail('input_too_large', field);
  }
  function visit(v, field, depth) {
    if (++nodes > 10000 || depth > 16) fail('input_structure_limit', field);
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'string') {
      account(v, field);
      return;
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) fail('json_value_invalid', field);
      return;
    }
    if (typeof v !== 'object') fail('json_value_invalid', field);
    if (ancestors.has(v)) fail('input_cycle', field);
    const array = Array.isArray(v);
    const prototype = Object.getPrototypeOf(v);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      fail('json_object_invalid', field);
    }
    const keys = Reflect.ownKeys(v);
    if (keys.some(k => typeof k !== 'string')) fail('json_key_invalid', field);
    if (array && (v.length > 1000 || keys.length !== v.length + 1)) fail('json_array_invalid', field);
    ancestors.add(v);
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (!array) account(key, field);
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) fail('json_accessor_or_hidden_field', field);
      if (array && !/^(?:0|[1-9][0-9]*)$/.test(key)) fail('json_array_invalid', field);
      visit(d.value, array ? `${field}[]` : `${field}.*`, depth + 1);
    }
    if (array) for (let i = 0; i < v.length; i++) if (!Object.hasOwn(v, i)) fail('json_array_invalid', field);
    ancestors.delete(v);
  }
  visit(value, '$', 0);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_BYTES) fail('input_too_large', '$');
}
function object(v, field, required, optional = []) {
  if (!v || Array.isArray(v) || typeof v !== 'object') fail('object_required', field);
  for (const key of Object.keys(v)) if (!required.includes(key) && !optional.includes(key)) fail('unknown_field', field);
  for (const key of required) if (!Object.hasOwn(v, key)) fail('field_required', `${field}.${key}`);
}
function identifier(v, field) { if (typeof v !== 'string' || !ID.test(v)) fail('identifier_invalid', field); }
function choice(v, values, field) { if (!values.includes(v)) fail('enum_invalid', field); }
function list(v, field, min, max, validate) {
  if (!Array.isArray(v) || v.length < min || v.length > max) fail('array_limit', field);
  const seen = new Set();
  v.forEach((item, i) => {
    validate(item, `${field}[${i}]`);
    if (typeof item === 'string') {
      if (seen.has(item)) fail('duplicate_value', field);
      seen.add(item);
    }
  });
}
function ids(v, field, min = 0, max = 100) { list(v, field, min, max, identifier); }
function number(v, field, min, max, integer = true) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) fail('number_invalid', field);
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateReviewCheckpointInput(input) {
  jsonData(input);
  object(input, '$', ['schema', 'objective', 'tasks', 'context', 'snapshot', 'limits', 'metrics'], ['externalDependencies']);
  if (input.schema !== INPUT_SCHEMA) fail('schema_unsupported', '$.schema');
  object(input.objective, '$.objective', ['id', 'criteria']);
  identifier(input.objective.id, '$.objective.id');
  ids(input.objective.criteria, '$.objective.criteria', 1, 100);
  object(input.context, '$.context', ['event', 'purposeComplete', 'executionMode']);
  choice(input.context.event, EVENTS, '$.context.event');
  if (typeof input.context.purposeComplete !== 'boolean') fail('boolean_required', '$.context.purposeComplete');
  choice(input.context.executionMode, ['direct', 'delegated', 'parallel'], '$.context.executionMode');
  object(input.limits, '$.limits', ['maxTasks', 'maxFiles', 'maxChangedLines'], ['maxWaitingHours']);
  number(input.limits.maxTasks, '$.limits.maxTasks', 1, 100);
  number(input.limits.maxFiles, '$.limits.maxFiles', 1, 1000000);
  number(input.limits.maxChangedLines, '$.limits.maxChangedLines', 1, 10000000);
  if (Object.hasOwn(input.limits, 'maxWaitingHours')) number(input.limits.maxWaitingHours, '$.limits.maxWaitingHours', 0.001, 87600, false);
  object(input.metrics, '$.metrics', ['fileCount', 'changedLines', 'waitingHours']);
  for (const key of ['fileCount', 'changedLines', 'waitingHours']) {
    if (input.metrics[key] !== null) number(input.metrics[key], `$.metrics.${key}`, 0, 100000000, key !== 'waitingHours');
  }
  if (input.snapshot !== null) {
    if (input.snapshot && input.snapshot.kind === 'git') {
      object(input.snapshot, '$.snapshot', ['kind', 'baseCommit', 'headCommit']);
      for (const key of ['baseCommit', 'headCommit']) {
        if (typeof input.snapshot[key] !== 'string' || !COMMIT.test(input.snapshot[key])) fail('commit_invalid', `$.snapshot.${key}`);
      }
      if (input.snapshot.baseCommit.length !== input.snapshot.headCommit.length) fail('commit_algorithm_mismatch', '$.snapshot');
    } else {
      object(input.snapshot, '$.snapshot', ['kind', 'digest']);
      if (input.snapshot.kind !== 'content') fail('snapshot_kind_invalid', '$.snapshot.kind');
      if (typeof input.snapshot.digest !== 'string' || !DIGEST.test(input.snapshot.digest)) fail('digest_invalid', '$.snapshot.digest');
    }
  }
  const tasks = new Map();
  list(input.tasks, '$.tasks', 1, 100, (task, field) => {
    object(task, field, ['id', 'objectiveId', 'criteria', 'dependsOn', 'implementation', 'verification', 'evidenceRefs', 'risk', 'riskTags', 'aspects'], ['uiBoundary']);
    if (Object.hasOwn(task, 'uiBoundary')) {
      try { validateUiBoundaryTask(task.uiBoundary); }
      catch (error) {
        if (!(error instanceof UiBoundaryContractError)) throw error;
        fail(error.code, `${field}.uiBoundary${error.field.slice(1)}`);
      }
    }
    identifier(task.id, `${field}.id`);
    if (tasks.has(task.id)) fail('duplicate_task', field);
    tasks.set(task.id, task);
    identifier(task.objectiveId, `${field}.objectiveId`);
    ids(task.criteria, `${field}.criteria`, 1, 100);
    for (const criterion of task.criteria) if (!input.objective.criteria.includes(criterion)) fail('criterion_unknown', `${field}.criteria`);
    ids(task.dependsOn, `${field}.dependsOn`, 0, 100);
    if (task.dependsOn.includes(task.id)) fail('dependency_cycle', `${field}.dependsOn`);
    choice(task.implementation, ['planned', 'implementing', 'implemented', 'blocked'], `${field}.implementation`);
    choice(task.verification, ['not-run', 'passed', 'failed', 'partial', 'inconclusive'], `${field}.verification`);
    ids(task.evidenceRefs, `${field}.evidenceRefs`, 0, 100);
    choice(task.risk, RISK, `${field}.risk`);
    list(task.riskTags, `${field}.riskTags`, 0, TAGS.length, (v, f) => choice(v, TAGS, f));
    list(task.aspects, `${field}.aspects`, 1, ASPECTS.length, (v, f) => choice(v, ASPECTS, f));
  });
  const external = new Map();
  list(Object.hasOwn(input, 'externalDependencies') ? input.externalDependencies : [], '$.externalDependencies', 0, 100, (dep, field) => {
    object(dep, field, ['id', 'state', 'revision']);
    identifier(dep.id, `${field}.id`);
    choice(dep.state, ['satisfied', 'pending', 'unknown'], `${field}.state`);
    if (dep.revision !== null) identifier(dep.revision, `${field}.revision`);
    if (dep.state === 'satisfied' && dep.revision === null) fail('dependency_revision_required', field);
    if (tasks.has(dep.id) || external.has(dep.id)) fail('duplicate_dependency', field);
    external.set(dep.id, dep);
  });
  const usedExternal = new Set();
  for (const task of tasks.values()) {
    for (const id of task.dependsOn) {
      if (!tasks.has(id) && !external.has(id)) fail('dependency_missing', '$.tasks[].dependsOn');
      if (external.has(id)) usedExternal.add(id);
    }
  }
  if ([...external.keys()].some(id => !usedExternal.has(id))) fail('dependency_unused', '$.externalDependencies');
  const visiting = new Set();
  const visited = new Set();
  function walk(id) {
    if (visiting.has(id)) fail('dependency_cycle', '$.tasks[].dependsOn');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of tasks.get(id).dependsOn) if (tasks.has(dep)) walk(dep);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of tasks.keys()) walk(id);
  return { schema: INPUT_SCHEMA, valid: true };
}

function assessReviewCheckpoint(input) {
  validateReviewCheckpointInput(input);
  const { tasks, objective, context, metrics, limits } = input;
  const split = [];
  const missing = [];
  const triggers = [];
  if (tasks.some(t => t.objectiveId !== objective.id)) split.push('mixed-objectives');
  // Connectivity is an explicit dependency or shared acceptance criterion, not
  // a guessed relationship from filenames, timestamps or model names.
  const reached = new Set([tasks[0].id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) if (!reached.has(task.id) && tasks.some(other => reached.has(other.id) && (
      task.dependsOn.includes(other.id) || other.dependsOn.includes(task.id) || task.criteria.some(c => other.criteria.includes(c))
    ))) { reached.add(task.id); changed = true; }
  }
  if (reached.size !== tasks.length) split.push('disconnected-scope');
  const covered = new Set(tasks.filter(t => t.objectiveId === objective.id).flatMap(t => t.criteria));
  const uncoveredCriteria = objective.criteria.filter(id => !covered.has(id));
  if (uncoveredCriteria.length) missing.push('acceptance-coverage-missing');
  const sizes = [['tasks', tasks.length, limits.maxTasks], ['files', metrics.fileCount, limits.maxFiles], ['changed-lines', metrics.changedLines, limits.maxChangedLines]];
  for (const [name, value, limit] of sizes) {
    if (value === null) missing.push(`${name}-unknown`);
    else if (value > limit) split.push(`${name}-limit-exceeded`);
    if (value !== null && value >= limit) triggers.push('capacity-boundary');
  }
  if (Object.hasOwn(limits, 'maxWaitingHours')) {
    if (metrics.waitingHours === null) missing.push('waiting-time-unknown');
    else if (metrics.waitingHours >= limits.maxWaitingHours) triggers.push('waiting-boundary');
  }
  if (tasks.some(t => t.risk === 'unknown')) missing.push('risk-unknown');
  if (tasks.some(t => ['high', 'critical'].includes(t.risk) || t.riskTags.length > 0) || context.event === 'risk-apply') triggers.push('risk-boundary');
  if (context.purposeComplete) triggers.push('purpose-boundary');
  if (['manual-review', 'integration', 'release'].includes(context.event)) triggers.push(context.event);
  const gaps = [...missing];
  if (!input.snapshot) gaps.push('snapshot-missing');
  if (!context.purposeComplete) gaps.push('purpose-incomplete');
  for (const task of tasks) {
    if (task.implementation !== 'implemented') gaps.push(task.implementation === 'blocked' ? 'implementation-blocked' : 'implementation-incomplete');
    if (task.verification !== 'passed') gaps.push(task.verification === 'failed' ? 'verification-failed' : 'verification-incomplete');
    if (!task.evidenceRefs.length) gaps.push('evidence-missing');
  }
  if ((input.externalDependencies || []).some(dep => dep.state !== 'satisfied')) gaps.push('dependency-unresolved');
  const unique = values => [...new Set(values)];
  const due = triggers.length > 0;
  const groupingState = split.length ? 'split-required' : missing.length ? 'needs-context' : 'eligible';
  const taskCoverage = tasks.map(task => {
    const aspects = new Set(['code', ...task.aspects]);
    if (['high', 'critical'].includes(task.risk) || task.riskTags.length) aspects.add('security');
    if (task.riskTags.includes('destructive-migration')) { aspects.add('data'); aspects.add('compatibility'); }
    const uiBoundary = Object.hasOwn(task, 'uiBoundary') ? uiBoundaryTaskCoverage(task.uiBoundary) : null;
    if (uiBoundary) aspects.add('ux');
    return { taskId: task.id, criteria: [...task.criteria], requestedAspects: [...aspects].sort(), reviewStatus: 'not-reviewed', evidenceStatus: 'unverified',
      ...(uiBoundary ? { uiBoundary } : {}) };
  });
  return {
    schema: OUTPUT_SCHEMA,
    inputDigest: `sha256:${createHash('sha256').update(stable(input)).digest('hex')}`,
    sourceTrust: 'caller-supplied',
    grouping: { state: groupingState, reasonCodes: unique([...split, ...missing]), uncoveredCriteria },
    checkpoint: { state: due ? 'due' : missing.length ? 'needs-context' : 'not-due', triggerCodes: unique(triggers), earlyReviewSuggested: triggers.includes('risk-boundary') && !context.purposeComplete },
    preparation: { state: split.length ? 'split-required' : gaps.length ? 'needs-evidence' : 'packet-candidate', reasonCodes: unique([...split, ...gaps]) },
    execution: { requestedMode: context.executionMode, defaultImplementationMode: 'direct', delegationAssessmentRequired: context.executionMode !== 'direct', agentCreated: false },
    snapshot: input.snapshot === null ? null : { ...input.snapshot },
    taskCoverage,
    verification: { snapshotVerified: false, evidenceVerified: false, independentReview: 'not-run' },
    effects: { modelInvoked: false, filesRead: false, filesWritten: false, approvalGranted: false, enforceChanged: false }
  };
}

module.exports = { INPUT_SCHEMA, OUTPUT_SCHEMA, MAX_BYTES, ReviewCheckpointInputError, validateReviewCheckpointInput, assessReviewCheckpoint };
