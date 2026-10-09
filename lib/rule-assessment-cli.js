'use strict';

const { assessRuleApplicability } = require('./rule-applicability');
const MAX_INPUT_BYTES = 16 * 1024;
const invalid = () => {
  const error = new TypeError('Invalid rule assessment input.');
  error.code = 'E_RULE_ASSESSMENT_INVALID';
  throw error;
};

// A JSON literal, never a filename/stdin reference or a request for discovery.
const assessRuleArguments = args => {
  let input;
  let jsonSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--json' && !jsonSeen) {
      jsonSeen = true;
      continue;
    }
    if (token === '--input' || token.startsWith('--input=')) {
      if (input !== undefined) invalid();
      input = token === '--input' ? args[++index] : token.slice('--input='.length);
      if (typeof input !== 'string' || !input || input.startsWith('--')) invalid();
      continue;
    }
    invalid();
  }
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > MAX_INPUT_BYTES) invalid();
  let parsed;
  try { parsed = JSON.parse(input); } catch { invalid(); }
  return assessRuleApplicability(parsed);
};

const formatRuleAssessment = report => [
  'Rule applicability advisory (caller-supplied input; no enforcement changes)',
  ...report.assessments.map(row => `${row.ruleId}: ${row.applicability}; ${row.advisory}; verification: not-run`),
  ...report.limitations
].join('\n');

module.exports = { assessRuleArguments, formatRuleAssessment, MAX_INPUT_BYTES };
