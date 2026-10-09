'use strict';

// RB-02 read-only adapter. Snapshot identity stays in the existing pure module;
// byte/UTF-8/duplicate-key limits reuse the reviewed checkpoint transport.
const {
  TransportError, MAX_OUTPUT_BYTES, parseInputJson, readJsonStdin,
} = require('./review-checkpoint-transport');
const {
  ReviewSnapshotInputError, createReviewSnapshotCandidate, compareReviewSnapshotInputs,
} = require('./review-snapshot');

const RESPONSE_SCHEMA = 'leerness.review-snapshot-response/v1';
const OPERATIONS = Object.freeze(['candidate', 'compare']);
const USAGE = 'Usage: leerness review-snapshot candidate|compare --stdin [--json]\n'
  + 'Reads one UTF-8 JSON document, maximum 65536 bytes, from stdin.\n'
  + 'Candidate: snapshot input. Compare: {"previous": <input>, "current": <input>}.\n'
  + 'No source inspection, persistence, model invocation, or approval.\n';
function failure(code, field = '$') {
  return { schema: RESPONSE_SCHEMA, ok: false, advisoryOnly: true,
    error: { code, field, message: 'Snapshot input could not be evaluated; no approval was granted.' } };
}
function safeError(error) {
  if (error instanceof TransportError) return failure(error.code);
  if (error instanceof ReviewSnapshotInputError) return failure(error.code, error.field);
  return failure('snapshot_evaluation_failed');
}
function compareEnvelope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== 2 || !Object.hasOwn(input, 'previous')
      || !Object.hasOwn(input, 'current')) throw new TransportError('invalid_comparison_envelope');
  return compareReviewSnapshotInputs(JSON.stringify(input.previous), JSON.stringify(input.current));
}
function evaluateSnapshotJson(operation, text) {
  if (!OPERATIONS.includes(operation)) return failure('invalid_operation');
  try {
    const input = parseInputJson(text);
    const result = operation === 'candidate'
      ? createReviewSnapshotCandidate(JSON.stringify(input)) : compareEnvelope(input);
    const response = { schema: RESPONSE_SCHEMA, ok: true, advisoryOnly: true, operation, result };
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') > MAX_OUTPUT_BYTES) throw new TransportError('output_too_large');
    return response;
  } catch (error) { return safeError(error); }
}
function validateMcpArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'invalid_arguments';
  const keys = Reflect.ownKeys(args);
  if (keys.length !== 2 || !keys.includes('operation') || !keys.includes('inputJson')) return 'invalid_arguments';
  for (const key of ['operation', 'inputJson']) {
    const descriptor = Object.getOwnPropertyDescriptor(args, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') return 'invalid_arguments';
  }
  if (!OPERATIONS.includes(args.operation)) return 'invalid_operation';
  return null;
}
function mcpResult(args) {
  const invalid = validateMcpArgs(args);
  const response = invalid ? failure(invalid) : evaluateSnapshotJson(args.operation, args.inputJson);
  return { content: [{ type: 'text', text: JSON.stringify(response) }], isError: !response.ok };
}
async function runCli(argv, input = process.stdin, output = process.stdout) {
  const write = text => new Promise((resolve, reject) => {
    const onError = error => reject(error);
    output.once('error', onError);
    output.write(text, error => {
      if (error) reject(error); // retain the listener for Writable's later error event
      else { output.removeListener('error', onError); resolve(); }
    });
  });
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) {
    await write(USAGE);
    return 0;
  }
  const flags = argv.slice(1);
  const valid = OPERATIONS.includes(argv[0]) && flags.includes('--stdin')
    && flags.every(flag => flag === '--stdin' || flag === '--json')
    && new Set(flags).size === flags.length;
  let response;
  if (!valid) response = failure('invalid_cli_arguments');
  else {
    try { response = evaluateSnapshotJson(argv[0], await readJsonStdin(input)); }
    catch (error) { response = safeError(error); }
  }
  await write(JSON.stringify(response) + '\n');
  return response.ok ? 0 : 2;
}
module.exports = { RESPONSE_SCHEMA, OPERATIONS, USAGE, evaluateSnapshotJson, validateMcpArgs, mcpResult, runCli };
