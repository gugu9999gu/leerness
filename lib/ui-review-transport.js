'use strict';

const { TransportError, MAX_OUTPUT_BYTES, parseInputJson, readJsonStdin } = require('./review-checkpoint-transport');
const { scanUiBoundary, UiBoundaryScanError } = require('./ui-boundary-scanner');
const { createUiReviewPacket, assessUiReview, UiReviewInputError } = require('./ui-review');
const { assessUiInformation, UiInformationInputError } = require('./ui-information-quality');
const RESPONSE_SCHEMA = 'leerness.ui-review-response/v1';
const OPERATIONS = Object.freeze(['scan', 'packet', 'assess', 'information']);
const USAGE = 'Usage: leerness ui scan --stdin [--json]\n'
  + '       leerness ui review packet|assess --stdin [--json]\n'
  + '       leerness ui information --stdin [--json]\n'
  + 'Reads one UTF-8 JSON document, at most 65536 bytes, within 5 seconds.\n'
  + 'Scan: UI surface input. Packet: UI review input.\n'
  + 'Assess: {"original": <review input>, "current": <review input>, "receipt": <optional receipt>}.\n'
  + 'No login, project changes, model calls or approval.\n';
function failure(code, field = '$') {
  return { schema: RESPONSE_SCHEMA, ok: false, advisoryOnly: true,
    error: { code, field, message: 'The input could not be checked. No approval was granted.' } };
}
function safeError(error) {
  if (error instanceof TransportError) return failure(error.code);
  if (error instanceof UiBoundaryScanError || error instanceof UiReviewInputError || error instanceof UiInformationInputError) return failure(error.code, error.field);
  return failure('ui_evaluation_failed');
}
function assessEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Object.hasOwn(value, 'original') || !Object.hasOwn(value, 'current')
    || Object.keys(value).some(k => !['original', 'current', 'receipt'].includes(k))) throw new TransportError('invalid_assessment_envelope');
  return assessUiReview(JSON.stringify(value.original), JSON.stringify(value.current),
    Object.hasOwn(value, 'receipt') ? JSON.stringify(value.receipt) : undefined);
}
function evaluateUiJson(operation, text) {
  if (!OPERATIONS.includes(operation)) return failure('invalid_operation');
  try {
    const input = parseInputJson(text);
    const result = operation === 'scan' ? scanUiBoundary(JSON.stringify(input))
      : operation === 'information' ? assessUiInformation(input)
        : operation === 'packet' ? createUiReviewPacket(JSON.stringify(input)) : assessEnvelope(input);
    const response = { schema: RESPONSE_SCHEMA, ok: true, advisoryOnly: true, operation, result };
    if (Buffer.byteLength(JSON.stringify(response)) > MAX_OUTPUT_BYTES) throw new TransportError('output_too_large');
    return response;
  } catch (error) { return safeError(error); }
}

// 1.36.288: the same unresolved-value or template shapes are the product itself in template editors,
// API clients, localization tools and programming lessons, so say so instead of "debug text".
const RENDER_ARTIFACTS = new Set(['object-coercion', 'unresolved-template', 'missing-value', 'raw-i18n-key', 'json-dump']);
function describeUiFinding(finding) {
  const codes = (finding.signals || []).map(signal => signal.code);
  if (codes.length && codes.every(code => RENDER_ARTIFACTS.has(code))) {
    return 'possible unresolved value, template or data dump; fine only where the product shows it on purpose (template editors, API tools, programming lessons)';
  }
  if (codes.length && finding.subtype === 'DEVELOPER_NOTE') return 'possible developer note or temporary copy; check whether users need it';
  return 'possible development or debug text; check whether users need it';
}

function summarize(response) {
  if (!response.ok) return `The input could not be checked (${response.error.code}).\nCheck the input format and command options; no approval was granted.\n`;
  const r = response.result;
  if (response.operation === 'scan') {
    const message = { findings: `Found ${r.findings.length} surface(s) that need review among ${r.scannedSurfaces} supplied surface(s).`,
      'no-pattern-match': `No configured pattern matched the ${r.scannedSurfaces} supplied surface(s). This does not prove the screen is correct.`,
      'no-surfaces': 'No screen text was supplied; nothing was scanned.',
      'not-applicable': 'The input declares a non-UI task; no UI scan was needed.' }[r.status];
    const locations = r.findings.map(f => `- Surface ${f.surfaceIndex + 1}: ${f.category === 'security' ? 'possible sensitive information; review security' : describeUiFinding(f)}.`);
    return [message, ...locations, ...(r.applicability === 'unknown' ? ['Whether this is a UI task is still unknown.'] : []),
      'Actual rendering and meaning were not verified. No text was changed or approved.\n'].join('\n');
  }
  if (response.operation === 'packet') {
    return `Prepared review questions for ${r.taskCoverage.length} UI task(s).\n`
      + (r.preparation.state === 'needs-context' ? 'Some required context is missing; supply it before review.\n'
        : r.preparation.state === 'not-applicable' ? 'No UI review tasks were declared.\n' : 'Use --json to pass the packet to a reviewer.\n')
      + 'No reviewer was run and no approval was granted.\n';
  }
  if (response.operation === 'information') {
    const counts = r.counts;
    return `Possible repeated facts: ${counts['duplicate-candidate'] || 0}; semantic review: ${counts['semantic-review'] || 0}; unknown: ${counts.unknown || 0}.\n`
      + 'The declarations and actual screen were not independently verified. No element was removed or approved.\n';
  }
  const message = {
    'not-applicable': 'No UI review applies to the current task declarations.',
    stale: 'The review no longer matches the current inputs. Review the changed material again.',
    'not-reviewed': 'No completed review was supplied. Run the required review first.',
    'needs-context': 'Required context is missing. Supply the missing evidence before review.',
    incomplete: 'The declared review is incomplete. Check execution and missing review areas.',
    findings: 'The declared review contains findings. Resolve them before requesting approval.',
    'self-review': 'This is a self-review declaration; it does not establish independent review.',
    'not-independent': 'The reviewer and implementer declarations do not meet the independence policy.',
    'identity-unverified': 'Reviewer independence cannot be established from the supplied declarations.',
    'review-candidate': 'The review declarations are consistent, but the evidence and reviewer identity are not authenticated.'
  }[r.state] || 'The supplied review needs further verification.';
  return `${message}\nSource, rendering and actual review execution were not verified. No approval was granted.\n`;
}

async function runCli(argv, input = process.stdin, output = process.stdout) {
  const write = text => new Promise((resolve, reject) => {
    const onError = error => reject(error); output.once('error', onError);
    output.write(text, error => { if (error) reject(error); else { output.removeListener('error', onError); resolve(); } });
  });
  const head = argv[0], nested = head === 'review', operation = nested ? argv[1] : head;
  const flags = argv.slice(nested ? 2 : 1);
  if ((['scan', 'information'].includes(head) && argv.length === 2 && ['--help', '-h'].includes(argv[1]))
    || (nested && argv.length === 2 && ['--help', '-h'].includes(argv[1]))
    || (nested && ['packet', 'assess'].includes(operation) && flags.length === 1 && ['--help', '-h'].includes(flags[0]))) {
    await write(USAGE); return 0;
  }
  const valid = (nested ? ['packet', 'assess'].includes(operation) : ['scan', 'information'].includes(operation))
    && flags.includes('--stdin') && flags.every(f => ['--stdin', '--json'].includes(f)) && new Set(flags).size === flags.length;
  let response;
  if (!valid) response = failure('invalid_cli_arguments');
  else {
    try { response = evaluateUiJson(operation, await readJsonStdin(input)); }
    catch (error) { response = safeError(error); }
  }
  await write(argv.includes('--json') ? JSON.stringify(response) + '\n' : summarize(response));
  return response.ok ? 0 : 2;
}

module.exports = { RESPONSE_SCHEMA, OPERATIONS, USAGE, evaluateUiJson, summarize, runCli };
