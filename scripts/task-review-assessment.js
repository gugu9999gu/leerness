'use strict';

const { parseInputJson, readJsonStdin } = require('../lib/review-checkpoint-transport');
const { assessTaskReview, reviewPacket, TaskReviewInputError } = require('../lib/task-review-assessment');

const MODES = Object.freeze({ 'packet-initial': 'initial', 'packet-recheck': 'recheck', 'packet-independent': 'independent' });
async function run(argv, stream = process.stdin, output = process.stdout) {
  const action = argv[0], allowed = action === 'assess' || Object.hasOwn(MODES, action);
  if (!allowed || argv.length !== 2 || argv[1] !== '--stdin') {
    output.write(JSON.stringify({ ok: false, error: { code: 'invalid_arguments' } }) + '\n');
    return 2;
  }
  try {
    const request = parseInputJson(await readJsonStdin(stream));
    let result;
    if (action === 'assess') result = assessTaskReview(request);
    else {
      if (!request || typeof request !== 'object' || Array.isArray(request) ||
          Object.keys(request).sort().join(',') !== 'details,input') throw new TaskReviewInputError('shape_invalid', '$');
      result = reviewPacket(request.input, MODES[action], request.details);
    }
    output.write(JSON.stringify({ ok: true, result }) + '\n');
    return 0;
  } catch (error) {
    const known = error instanceof TaskReviewInputError ||
      (typeof error.code === 'string' && /^(invalid_|input_|utf8_|stdin_|duplicate_|json_|schema_)/.test(error.code));
    output.write(JSON.stringify({ ok: false, error: { code: known ? error.code : 'assessment_unavailable',
      field: error instanceof TaskReviewInputError ? error.field : '$' } }) + '\n');
    return 2;
  }
}
if (require.main === module) run(process.argv.slice(2)).then(code => { process.exitCode = code; })
  .catch(() => { process.exitCode = 2; });
module.exports = { run };
