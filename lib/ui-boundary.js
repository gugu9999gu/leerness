'use strict';

// UIB-01: metadata advice only. The caller supplies intent and provenance;
// this module cannot establish the meaning or safety of actual UI text.
const INPUT_SCHEMA = 'leerness.ui-boundary-input/v1';
const OUTPUT_SCHEMA = 'leerness.ui-boundary-assessment/v1';
const POLICY_VERSION = 'leerness.ui-boundary/v1';
const MAX_INPUT_BYTES = 4096;
const TAXONOMY = Object.freeze({
  specification: 'SPEC_TO_COPY',
  implementation_instruction: 'IMPLEMENTATION_NARRATION',
  developer_note: 'DEVELOPER_NOTE',
  acceptance_criterion: 'CRITERIA_TO_COPY',
  debug_metadata: 'DEBUG_METADATA',
});
const SOURCES = ['product_copy', ...Object.keys(TAXONOMY), 'unknown'];
const NEEDS = ['understand', 'decide', 'act', 'status', 'configure', 'none', 'unknown'];

class UiBoundaryInputError extends Error {
  constructor(code, field) {
    super(`${code} at ${field}`);
    this.name = 'UiBoundaryInputError';
    this.code = code;
    this.field = field; // Fixed schema paths only, never caller keys or values.
  }
}
function fail(code, field) { throw new UiBoundaryInputError(code, field); }
function object(value, field, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('object_required', field);
  if (Object.keys(value).some(key => !keys.includes(key))) fail('unknown_field', field);
  for (const key of keys) if (!Object.hasOwn(value, key)) fail('field_required', `${field}.${key}`);
}
function choice(value, values, field) {
  if (!values.includes(value)) fail('enum_invalid', field);
}
function parseInput(text) {
  // Accept serialized JSON rather than arbitrary executable objects/accessors.
  if (typeof text !== 'string') fail('serialized_json_required', '$');
  if (text.length > MAX_INPUT_BYTES || Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) {
    fail('input_too_large', '$');
  }
  let input;
  try { input = JSON.parse(text); } catch { fail('json_invalid', '$'); }
  object(input, '$', ['schema', 'policyVersion', 'taskKind', 'candidate']);
  if (input.schema !== INPUT_SCHEMA) fail('schema_unsupported', '$.schema');
  if (input.policyVersion !== POLICY_VERSION) fail('policy_unsupported', '$.policyVersion');
  choice(input.taskKind, ['ui', 'non-ui', 'unknown'], '$.taskKind');
  if (input.taskKind === 'non-ui') {
    if (input.candidate !== null) fail('candidate_must_be_null', '$.candidate');
    return input;
  }
  const candidate = input.candidate;
  object(candidate, '$.candidate', ['sourceKind', 'intent', 'userNeed', 'use', 'surface', 'sensitivity']);
  choice(candidate.sourceKind, SOURCES, '$.candidate.sourceKind');
  choice(candidate.intent, ['explicit', 'clearly-required', 'internal', 'unclear'], '$.candidate.intent');
  choice(candidate.userNeed, NEEDS, '$.candidate.userNeed');
  choice(candidate.use, ['product-copy', 'context', 'unknown'], '$.candidate.use');
  choice(candidate.surface, ['proposed', 'rendered'], '$.candidate.surface');
  choice(candidate.sensitivity, ['none', 'suspected', 'confirmed', 'unknown'], '$.candidate.sensitivity');
  return input;
}

function assessUiBoundary(inputJson) {
  const input = parseInput(inputJson);
  const result = {
    schema: OUTPUT_SCHEMA,
    policyVersion: POLICY_VERSION,
    assessmentBasis: 'caller-declared-metadata',
    applicability: input.taskKind === 'ui' ? 'applicable' : input.taskKind === 'non-ui' ? 'not-applicable' : 'unknown',
    recommendation: 'review-required',
    eligibleForCopy: false,
    reasonCodes: [],
    findings: [],
    reviewDomains: [],
    verification: { sourceVerified: false, renderVerified: false, semanticVerified: false, independentReview: 'not-run' },
    effects: { filesRead: false, filesWritten: false, modelInvoked: false, approvalGranted: false,
      enforcementChanged: false, autoRemove: false },
  };
  if (input.taskKind === 'non-ui') {
    result.recommendation = 'not-applicable';
    result.reasonCodes.push('non_ui_task');
    return result;
  }
  const c = input.candidate;
  const subtype = TAXONOMY[c.sourceKind] || null;
  const security = c.sensitivity === 'confirmed' || c.sensitivity === 'suspected';
  const context = c.use === 'context' || c.intent === 'internal';
  const needKnown = c.userNeed !== 'none' && c.userNeed !== 'unknown';
  const intentKnown = c.intent === 'explicit' || c.intent === 'clearly-required';

  // Sensitive findings are routed once to the existing security domain. A UI
  // subtype is supporting context, not a second severity system or approval.
  if (security) {
    result.reasonCodes.push('sensitive_content_declared');
    result.reviewDomains.push('security');
    result.findings.push({ category: 'security', uiBoundarySubtype: subtype,
      basis: 'caller-declared-sensitivity', sensitivity: c.sensitivity, severity: 'delegated',
      disposition: c.surface === 'proposed' ? 'withhold-pending-review' : 'review-remediation' });
  }
  if (input.taskKind === 'unknown') result.reasonCodes.push('task_kind_unknown');
  if (context) result.reasonCodes.push('context_is_non_renderable');
  if (!intentKnown) result.reasonCodes.push('user_facing_intent_not_established');
  if (!needKnown) result.reasonCodes.push('user_need_not_established');
  if (c.use === 'unknown') result.reasonCodes.push('copy_use_unknown');
  if (c.sourceKind === 'unknown') result.reasonCodes.push('source_kind_unknown');
  if (c.sensitivity === 'unknown') result.reasonCodes.push('sensitivity_not_assessed');

  if (input.taskKind === 'ui' && !security && c.sensitivity === 'none' && !context
    && intentKnown && needKnown && c.use === 'product-copy' && c.sourceKind !== 'unknown') {
    result.recommendation = 'eligible-copy';
    result.eligibleForCopy = true;
    result.reasonCodes.push('user_facing_copy_declared');
    return result;
  }

  // Never convert a source match into an automatic deletion of existing UI.
  result.recommendation = c.surface === 'proposed' && input.taskKind === 'ui' ? 'withhold' : 'review-required';
  result.reviewDomains.push('ui_integrity/instruction_to_ui_leakage');
  if (subtype && context && !security) {
    result.findings.push({ category: 'instruction_to_ui_leakage', subtype,
      basis: 'caller-declared-context', certainty: 'candidate',
      disposition: c.surface === 'proposed' ? 'exclude-from-copy' : 'review-remediation' });
  }
  return result;
}

module.exports = { assessUiBoundary, UiBoundaryInputError, INPUT_SCHEMA, OUTPUT_SCHEMA,
  POLICY_VERSION, MAX_INPUT_BYTES, TAXONOMY };
