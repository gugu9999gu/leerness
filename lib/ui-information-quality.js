'use strict';

const INPUT_SCHEMA = 'leerness.ui-information-input/v1';
const OUTPUT_SCHEMA = 'leerness.ui-information-assessment/v1';
const SCOPE_FIELDS = ['subject', 'filter', 'period', 'snapshot', 'unit', 'aggregation'];
const ITEM_FIELDS = ['id', 'logicalId', 'viewId', 'metricId', 'lineageId', 'questionId', 'scope', 'purpose', 'purposeReason'];
const PURPOSES = ['none', 'detail', 'trend', 'comparison', 'composition', 'accessibility', 'navigation', 'warning', 'unknown'];

class UiInformationInputError extends Error {
  constructor(code, field) { super(`${code} at ${field}`);this.name = 'UiInformationInputError';this.code = `ui_information_${code}`;this.field = field; }
}
function fail(code, field) { throw new UiInformationInputError(code, field); }
function object(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('object_required', field);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key))) fail('fields_invalid', field);
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !desc.enumerable || !Object.hasOwn(desc, 'value')) fail('data_field_required', `${field}.${key}`);
  }
}
function boundedText(value, field, nullable = true) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) fail('text_invalid', field);
}
function validate(input) {
  object(input, ['schema', 'items'], '$');
  if (input.schema !== INPUT_SCHEMA) fail('schema_unsupported', '$.schema');
  if (!Array.isArray(input.items) || input.items.length > 16) fail('items_limit', '$.items');
  const ids = new Set();
  for (const [index, item] of input.items.entries()) {
    const field = `$.items[${index}]`;
    object(item, ITEM_FIELDS, field);
    boundedText(item.id, `${field}.id`, false);
    if (!/^[A-Za-z0-9._:-]{1,64}$/.test(item.id)) fail('id_invalid', `${field}.id`);
    if (ids.has(item.id)) fail('id_duplicate', `${field}.id`);
    ids.add(item.id);
    for (const key of ['logicalId', 'viewId', 'metricId', 'lineageId', 'questionId']) boundedText(item[key], `${field}.${key}`);
    object(item.scope, SCOPE_FIELDS, `${field}.scope`);
    for (const key of SCOPE_FIELDS) boundedText(item.scope[key], `${field}.scope.${key}`);
    if (!PURPOSES.includes(item.purpose)) fail('purpose_invalid', `${field}.purpose`);
    boundedText(item.purposeReason, `${field}.purposeReason`);
    if (item.purpose === 'none' && item.purposeReason !== null) fail('purpose_reason_conflict', `${field}.purposeReason`);
  }
}

function compare(a, b) {
  if (a.logicalId !== null && a.logicalId === b.logicalId) return ['same-element-declared', 'The caller declares two observations of one logical UI element; confirm this against the DOM and accessibility tree.'];
  if (a.viewId === null || b.viewId === null) return ['unknown', 'The simultaneous display context is unknown.'];
  if (a.viewId !== b.viewId) return ['separate-view', 'The declared views are mutually exclusive; actual rendering is not verified.'];
  if ([a.metricId, b.metricId, a.lineageId, b.lineageId, a.questionId, b.questionId,
    ...SCOPE_FIELDS.flatMap(key => [a.scope[key], b.scope[key]])].some(value => value === null)) return ['unknown', 'Metric meaning, source, user question or scope is missing.'];
  const sameScope = SCOPE_FIELDS.every(key => a.scope[key] === b.scope[key]);
  if (a.questionId !== b.questionId) return ['distinct-question', 'The declared user questions differ.'];
  if (!sameScope) return ['distinct-scope', 'Audience, filter, period, snapshot, unit or aggregation differs; label this difference in the UI.'];
  if (a.lineageId === b.lineageId && a.metricId !== b.metricId) return ['semantic-review', 'The data source and question match but metric names differ; a reviewer must check whether these are renamed copies.'];
  if (a.metricId !== b.metricId || a.lineageId !== b.lineageId) return ['distinct-metric', 'The declared metric or lineage differs; the declarations need independent confirmation.'];
  if (a.purpose === 'unknown' || b.purpose === 'unknown') return ['unknown', 'The additional purpose is unknown.'];
  if ((a.purpose !== 'none' && !a.purposeReason) || (b.purpose !== 'none' && !b.purposeReason)) return ['unknown', 'A claimed additional purpose has no reason.'];
  if (a.purpose !== 'none' || b.purpose !== 'none') return ['purposeful-repeat', 'At least one display declares a justified detail, analysis, accessibility or action purpose.'];
  return ['duplicate-candidate', 'Same declared fact and user question are displayed together without additional value.'];
}

function assessUiInformation(input) {
  const value = typeof input === 'string' ? JSON.parse(input) : input;
  validate(value);
  const pairs = [];
  const counts = {};
  for (let i = 0; i < value.items.length; i++) for (let j = i + 1; j < value.items.length; j++) {
    const [classification, reason] = compare(value.items[i], value.items[j]);
    pairs.push({ firstIndex: i, secondIndex: j, classification, reason });
    counts[classification] = (counts[classification] || 0) + 1;
  }
  return { schema: OUTPUT_SCHEMA, advisoryOnly: true, semanticVerified: false, renderingVerified: false,
    approvalGranted: false, autoRemoval: false, counts, pairs };
}

module.exports = { INPUT_SCHEMA, OUTPUT_SCHEMA, SCOPE_FIELDS, UiInformationInputError, assessUiInformation };
