'use strict';

const { TransportError, MAX_OUTPUT_BYTES, parseInputJson, readJsonStdin } = require('./review-checkpoint-transport');
const { TestNodeRunnerInputError, runNodeSelection } = require('./test-node-runner');
const { TestScriptInputError } = require('./test-npm-script-probe');
const { TestNpmScriptRunnerInputError, runNamedNpmScript } = require('./test-npm-script-runner');
const { TestSuiteListInputError, runSuiteList } = require('./test-suite-list-runner');

const RESPONSE_SCHEMA = 'leerness.test-run-response/v1';
const USAGE = 'Usage: leerness test-run node|npm-script|suite-list --stdin [--json]\n'
  + 'node runs one in-project Node test name after a controlled selector fixture.\n'
  + 'npm-script runs one exact named npm script after digest preflight; it cannot prove one test was selected.\n'
  + 'suite-list invokes a trusted Node wrapper with --list and reports listed/excluded counts; it does not verify a test pass.\n'
  + 'Project code may have side effects. None of these commands replaces final CI.\n';
function failure(code, field = '$') {
  return { schema: RESPONSE_SCHEMA, ok: false, error: { code, field,
    message: 'The test-run request could not be completed. No passing test result was recorded.' } };
}
function safeError(error) {
  if (error instanceof TransportError) return failure(error.code);
  if (error instanceof TestNodeRunnerInputError) return failure(error.code, error.field);
  if (error instanceof TestScriptInputError) return failure(error.code, error.field);
  if (error instanceof TestNpmScriptRunnerInputError) return failure(error.code, error.field);
  if (error instanceof TestSuiteListInputError) return failure(error.code, error.field);
  return failure('test_run_failed');
}
async function nodeRunJson(text, projectRoot = process.cwd()) {
  try {
    const run = await runNodeSelection(parseInputJson(text), projectRoot);
    const result = { schema: RESPONSE_SCHEMA, ok: true, run };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_OUTPUT_BYTES) throw new TransportError('output_too_large');
    return result;
  } catch (error) { return safeError(error); }
}
async function npmScriptRunJson(text, projectRoot = process.cwd()) {
  try {
    const run = await runNamedNpmScript(parseInputJson(text), projectRoot);
    const result = { schema: RESPONSE_SCHEMA, ok: true, run };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_OUTPUT_BYTES) throw new TransportError('output_too_large');
    return result;
  } catch (error) { return safeError(error); }
}
async function suiteListJson(text, projectRoot = process.cwd()) {
  try {
    const run = await runSuiteList(parseInputJson(text), projectRoot);
    const result = { schema: RESPONSE_SCHEMA, ok: true, run };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_OUTPUT_BYTES) throw new TransportError('output_too_large');
    return result;
  } catch (error) { return safeError(error); }
}
function summarize(result) {
  if (!result.ok) return `Test run request rejected (${result.error.code}). No passing result.\n`;
  const run = result.run;
  if (run.scope === 'wrapper-list-observation') {
    return `Wrapper list: ${run.executionStatus}; target: ${run.targetStatus || 'unverified'}; `
      + `selected: ${run.selectedCount ?? 'unknown'}, skipped: ${run.skippedCount ?? 'unknown'}.\n`
      + 'This list is not proof that a test ran, passed, or will be selected in execution mode.\n';
  }
  if (run.scope === 'one-named-npm-script-entry') {
    return `Named npm script: ${run.executionStatus}.\n`
      + 'The number of tests selected, service readiness, reusable evidence and final CI remain unverified.\n';
  }
  return `Direct Node selection: ${run.selectionStatus}; execution: ${run.executionStatus}.\n`
    + 'npm script selection, complete coverage, reusable evidence and final CI remain unverified.\n';
}
async function runCli(argv, input = process.stdin, output = process.stdout) {
  const write = value => new Promise((resolve, reject) => {
    const onError = error => reject(error);
    output.once('error', onError);
    output.write(value, error => {
      if (error) reject(error);
      else { output.removeListener('error', onError); resolve(); }
    });
  });
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) { await write(USAGE); return 0; }
  const flags = argv.slice(1);
  const valid = ['node', 'npm-script', 'suite-list'].includes(argv[0]) && flags.includes('--stdin')
    && flags.every(flag => ['--stdin', '--json'].includes(flag)) && new Set(flags).size === flags.length;
  let result;
  if (!valid) result = failure('invalid_cli_arguments');
  else {
    try {
      const document = await readJsonStdin(input);
      result = argv[0] === 'npm-script' ? await npmScriptRunJson(document)
        : argv[0] === 'suite-list' ? await suiteListJson(document) : await nodeRunJson(document);
    }
    catch (error) { result = safeError(error); }
  }
  await write(argv.includes('--json') ? JSON.stringify(result) + '\n' : summarize(result));
  return !result.ok ? 2 : result.run.scope === 'one-named-npm-script-entry'
    ? (result.run.scriptExitZeroObserved ? 0 : 1)
    : result.run.scope === 'wrapper-list-observation'
      ? (result.run.focusListed ? 0 : 1) : (result.run.selectedTestPassed ? 0 : 1);
}

module.exports = { RESPONSE_SCHEMA, USAGE, nodeRunJson, npmScriptRunJson, suiteListJson, summarize, runCli };
