'use strict';

const { TransportError, MAX_OUTPUT_BYTES, parseInputJson, readJsonStdin } = require('./review-checkpoint-transport');
const { TestExecutionInputError, planTestExecution } = require('./test-execution-plan');
const { TestPrerequisiteInputError, probePrerequisites } = require('./test-prerequisite-probe');
const { TestHttpInputError, probeHttpPrerequisites } = require('./test-http-probe');
const { TestFirestoreInputError, probeFirestorePrerequisites } = require('./test-firestore-probe');
const { TestScriptInputError, probeNpmScripts } = require('./test-npm-script-probe');

const RESPONSE_SCHEMA = 'leerness.test-plan-response/v1';
const USAGE = 'Usage: leerness test-plan assess|probe|http-probe|firestore-probe|script-probe --stdin [--json]\n'
  + 'Reads one UTF-8 JSON document, at most 65536 bytes, within 5 seconds.\n'
  + 'Assess plans checks; probe, http-probe and firestore-probe observe local responses; script-probe checks exact named npm scripts. None runs tests or marks them passed.\n';
function failure(code, field = '$') {
  return { schema: RESPONSE_SCHEMA, ok: false, advisoryOnly: true,
    error: { code, field, message: 'The test-plan request could not be assessed; no test was run.' } };
}
function safeError(error) {
  if (error instanceof TransportError) return failure(error.code);
  if (error instanceof TestExecutionInputError) return failure(error.code, error.field);
  if (error instanceof TestPrerequisiteInputError) return failure(error.code, error.field);
  if (error instanceof TestHttpInputError) return failure(error.code, error.field);
  if (error instanceof TestFirestoreInputError) return failure(error.code, error.field);
  if (error instanceof TestScriptInputError) return failure(error.code, error.field);
  return failure('test_plan_failed');
}
function assessJson(text) {
  try {
    const plan = planTestExecution(parseInputJson(text));
    const result = { schema: RESPONSE_SCHEMA, ok: true, advisoryOnly: true, plan };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_OUTPUT_BYTES) throw new TransportError('output_too_large');
    return result;
  } catch (error) { return safeError(error); }
}
async function probeJson(text) {
  try {
    const probe = await probePrerequisites(parseInputJson(text));
    const result = { schema: RESPONSE_SCHEMA, ok: true, advisoryOnly: true, probe };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_OUTPUT_BYTES) throw new TransportError('output_too_large');
    return result;
  } catch (error) { return safeError(error); }
}
async function httpProbeJson(text) {
  try {
    const probe = await probeHttpPrerequisites(parseInputJson(text));
    const result = { schema: RESPONSE_SCHEMA, ok: true, advisoryOnly: true, probe };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_OUTPUT_BYTES) throw new TransportError('output_too_large');
    return result;
  } catch (error) { return safeError(error); }
}
async function firestoreProbeJson(text) {
  try {
    const probe = await probeFirestorePrerequisites(parseInputJson(text));
    const result = { schema: RESPONSE_SCHEMA, ok: true, advisoryOnly: true, probe };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_OUTPUT_BYTES) throw new TransportError('output_too_large');
    return result;
  } catch (error) { return safeError(error); }
}
function scriptProbeJson(text, projectRoot = process.cwd()) {
  try {
    const scriptProbe = probeNpmScripts(parseInputJson(text), projectRoot);
    const result = { schema: RESPONSE_SCHEMA, ok: true, advisoryOnly: true, scriptProbe };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_OUTPUT_BYTES) throw new TransportError('output_too_large');
    return result;
  } catch (error) { return safeError(error); }
}
function summarize(result) {
  if (!result.ok) return `Test plan input rejected (${result.error.code}). No test was run.\n`;
  if (result.scriptProbe) {
    const p = result.scriptProbe;
    return `Named npm scripts: ${p.results.filter(item => item.status === 'named-script-present').length}/${p.results.length} present.\n`
      + 'Runner filtering, test coverage and test execution remain unverified.\n';
  }
  if (result.probe) {
    const p = result.probe;
    if (p.probeKind === 'firestore-rule-coverage-shape') {
      const hubRequests = p.results.filter(item => Object.hasOwn(item, 'hubStatus'));
      return `Firestore response shapes: ${p.results.filter(item => item.protocolShapeObserved).length}/${p.results.length} observed.\n`
        + (hubRequests.length ? `Firebase Hub mappings: ${hubRequests.filter(item => item.hubMappingObserved).length}/${hubRequests.length} observed.\n` : '')
        + 'Project identity, service readiness, test execution and final coverage remain unverified.\n';
    }
    if (p.probeKind === 'loopback-http-get') {
      return `Local HTTP expectations: ${p.results.filter(item => item.httpExpectationMet).length}/${p.results.length} matched.\n`
        + 'Configured response matches do not prove service identity, test execution or final coverage.\n';
    }
    return `Loopback TCP: ${p.results.filter(item => item.tcpReachable).length}/${p.results.length} reachable.\n`
      + 'Service readiness, test execution and final coverage remain unverified.\n';
  }
  const p = result.plan;
  return `Declared plan: ${p.stages.focused.length} focused, ${p.stages.related.length} related, ${p.stages.final.length} final check(s).\n`
    + `Status: ${p.status}; ${p.unrunCheckIds.length} selected check(s) remain unrun.\n`
    + 'Commands, service readiness and final coverage were not independently verified. No test passed by this assessment.\n';
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
  const valid = ['assess', 'probe', 'http-probe', 'firestore-probe', 'script-probe'].includes(argv[0]) && flags.includes('--stdin')
    && flags.every(flag => ['--stdin', '--json'].includes(flag)) && new Set(flags).size === flags.length;
  let result;
  if (!valid) result = failure('invalid_cli_arguments');
  else {
    try {
      const document = await readJsonStdin(input);
      result = argv[0] === 'probe' ? await probeJson(document)
        : argv[0] === 'http-probe' ? await httpProbeJson(document)
          : argv[0] === 'firestore-probe' ? await firestoreProbeJson(document)
          : argv[0] === 'script-probe' ? scriptProbeJson(document) : assessJson(document);
    }
    catch (error) { result = safeError(error); }
  }
  await write(argv.includes('--json') ? JSON.stringify(result) + '\n' : summarize(result));
  return result.ok ? 0 : 2;
}

module.exports = { RESPONSE_SCHEMA, USAGE, assessJson, probeJson, httpProbeJson, firestoreProbeJson, scriptProbeJson, summarize, runCli };
