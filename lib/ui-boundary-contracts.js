'use strict';

const { POLICY_VERSION, TAXONOMY, assessUiBoundary } = require('./ui-boundary');
const ROLE_SCHEMA = 'leerness.ui-boundary-role/v1';
const TASK_SCHEMA = 'leerness.ui-boundary-task/v1';
const REVIEW_SCHEMA = 'leerness.ui-boundary-review/v1';
const MAX_FINDINGS = 32;
const DOMAIN = 'ui_integrity/instruction_to_ui_leakage';
const ROLE_DUTIES = Object.freeze({ designer: 'designer', coder: 'implementer',
  tester: 'tester', reviewer: 'reviewer', security: 'security' });
const DUTIES = Object.freeze({
  designer: 'Establish the actual user need and distinguish intended product copy from planning context.',
  implementer: 'Render explicit or clearly required product copy; do not turn specifications, implementation notes or criteria into UI narration.',
  tester: 'Inspect actual rendered, DOM and accessibility surfaces for all five leakage subtypes; source scans alone do not prove UI quality.',
  reviewer: 'Compare fixed specification, diff and render evidence; distinguish self-review from independent review and reject stale approval claims.',
  security: 'Route sensitive UI exposures through security policy and retain minimal evidence provenance without copying secrets.',
});
const TASK_KINDS = ['ui', 'non-ui', 'unknown'];
const SOURCE_KINDS = ['product_copy', ...Object.keys(TAXONOMY), 'unknown'];
const DIGEST = /^sha256:[0-9a-f]{64}$/;

class UiBoundaryContractError extends Error {
  constructor(code, field) {
    super(`${code} at ${field}`);
    this.name = 'UiBoundaryContractError'; this.code = code; this.field = field;
  }
}
function fail(code, field) { throw new UiBoundaryContractError(`ui_boundary_${code}`, field); }
function object(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('object_required', field);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => !keys.includes(key))) fail('fields_invalid', field);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) fail('data_field_required', `${field}.${key}`);
  }
}
function choice(value, allowed, field) { if (!allowed.includes(value)) fail('enum_invalid', field); }
function header(value, schema, keys) {
  object(value, ['schema', 'policyVersion', ...keys], '$');
  if (value.schema !== schema) fail('schema_unsupported', '$.schema');
  if (value.policyVersion !== POLICY_VERSION) fail('policy_unsupported', '$.policyVersion');
}
function evidenceDigest(value, field) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail('digest_invalid', field);
}
function validateUiBoundaryRole(value, roleId) {
  header(value, ROLE_SCHEMA, ['responsibility']);
  choice(value.responsibility, Object.keys(DUTIES), '$.responsibility');
  if (roleId !== undefined && (typeof roleId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(roleId))) {
    fail('role_identifier_invalid', '$.roleId');
  }
  if (Object.hasOwn(ROLE_DUTIES, roleId) && value.responsibility !== ROLE_DUTIES[roleId]) {
    fail('role_duty_mismatch', '$.responsibility');
  }
  return { schema: ROLE_SCHEMA, policyVersion: POLICY_VERSION, responsibility: value.responsibility };
}
function createUiBoundaryRole(responsibility) {
  return validateUiBoundaryRole({ schema: ROLE_SCHEMA, policyVersion: POLICY_VERSION, responsibility });
}
function validateUiBoundaryTask(value) {
  header(value, TASK_SCHEMA, ['taskKind']);
  choice(value.taskKind, TASK_KINDS, '$.taskKind');
  return { schema: TASK_SCHEMA, policyVersion: POLICY_VERSION, taskKind: value.taskKind };
}
function createUiBoundaryTask(taskKind) {
  return validateUiBoundaryTask({ schema: TASK_SCHEMA, policyVersion: POLICY_VERSION, taskKind });
}
function uiBoundaryRoleInstructions(roleExtension, taskExtension) {
  if (taskExtension === undefined) return null;
  const task = validateUiBoundaryTask(taskExtension);
  if (task.taskKind === 'non-ui') return null;
  const role = validateUiBoundaryRole(roleExtension);
  return {
    policyVersion: POLICY_VERSION, responsibility: role.responsibility,
    rule: 'Only explicitly user-facing information may cross the UI boundary. Everything else is non-renderable by default.',
    userFacingCopy: 'explicit-or-clearly-required', contextRenderable: false,
    centralStringAllowlistRequired: false, duty: DUTIES[role.responsibility],
    subtypes: Object.values(TAXONOMY), permissionGrant: false,
  };
}
function uiBoundaryTaskCoverage(extension) {
  const task = validateUiBoundaryTask(extension);
  if (task.taskKind === 'non-ui') return null;
  return { policyVersion: POLICY_VERSION, applicability: task.taskKind === 'ui' ? 'applicable' : 'unknown',
    requestedDomains: [DOMAIN], reviewStatus: 'not-reviewed', evidenceStatus: 'unverified' };
}
function validateUiBoundaryReview(value) {
  header(value, REVIEW_SCHEMA, ['taskKind', 'findings', 'evidenceVerified']);
  choice(value.taskKind, TASK_KINDS, '$.taskKind');
  if (value.evidenceVerified !== false) fail('unverified_evidence_required', '$.evidenceVerified');
  const rows = value.findings;
  if (!Array.isArray(rows) || rows.length > MAX_FINDINGS) fail('findings_limit', '$.findings');
  // A dense plain array of own data properties; no inherited rows or accessors.
  if (Object.getPrototypeOf(rows) !== Array.prototype || Reflect.ownKeys(rows).length !== rows.length + 1) {
    fail('findings_array_invalid', '$.findings');
  }
  if (value.taskKind === 'non-ui' && rows.length) fail('non_ui_findings', '$.findings');
  const findings = [];
  for (let index = 0; index < rows.length; index++) {
    const field = '$.findings[]';
    const descriptor = Object.getOwnPropertyDescriptor(rows, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('data_field_required', field);
    const row = descriptor.value;
    const keys = ['category', 'subtype', 'sourceKind', 'severity', 'disposition', 'evidenceDigest'];
    object(row, keys, field);
    choice(row.sourceKind, SOURCE_KINDS, `${field}.sourceKind`);
    choice(row.category, ['instruction_to_ui_leakage', 'security'], `${field}.category`);
    const subtype = Object.hasOwn(TAXONOMY, row.sourceKind) ? TAXONOMY[row.sourceKind] : null;
    if (row.subtype !== subtype) fail('subtype_source_mismatch', `${field}.subtype`);
    if (row.category === 'instruction_to_ui_leakage') {
      if (subtype === null) fail('ui_subtype_required', `${field}.subtype`);
      choice(row.severity, ['advisory'], `${field}.severity`);
      choice(row.disposition, ['exclude-from-copy', 'review-remediation'], `${field}.disposition`);
    } else {
      choice(row.severity, ['delegated'], `${field}.severity`);
      choice(row.disposition, ['withhold-pending-review', 'review-remediation'], `${field}.disposition`);
    }
    evidenceDigest(row.evidenceDigest, `${field}.evidenceDigest`);
    findings.push(Object.fromEntries(keys.map(key => [key, row[key]])));
  }
  return { schema: REVIEW_SCHEMA, policyVersion: POLICY_VERSION, taskKind: value.taskKind, findings, evidenceVerified: false };
}
function createUiBoundaryReview(assessmentInputJson, digest) {
  const assessment = assessUiBoundary(assessmentInputJson);
  // Parsing happens only after UIB-01 has bounded and validated this inert string.
  const input = JSON.parse(assessmentInputJson);
  if (assessment.findings.length || digest !== undefined) evidenceDigest(digest, '$.evidenceDigest');
  return validateUiBoundaryReview({ schema: REVIEW_SCHEMA, policyVersion: POLICY_VERSION, taskKind: input.taskKind,
    evidenceVerified: false, findings: assessment.findings.map(finding => ({
      category: finding.category, subtype: finding.subtype || finding.uiBoundarySubtype || null,
      sourceKind: input.candidate.sourceKind, severity: finding.category === 'security' ? 'delegated' : 'advisory',
      disposition: finding.disposition, evidenceDigest: digest,
    })) });
}

module.exports = { ROLE_SCHEMA, TASK_SCHEMA, REVIEW_SCHEMA, MAX_FINDINGS, DOMAIN,
  UiBoundaryContractError, validateUiBoundaryRole, validateUiBoundaryTask, validateUiBoundaryReview,
  createUiBoundaryRole, createUiBoundaryTask, createUiBoundaryReview, uiBoundaryRoleInstructions, uiBoundaryTaskCoverage };
