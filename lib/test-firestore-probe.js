'use strict';

const http = require('node:http');
const { performance } = require('node:perf_hooks');
const { probeFirebaseHub } = require('./test-firebase-hub-probe');

const INPUT_SCHEMA = 'leerness.test-firestore-probe-input/v1';
const OUTPUT_SCHEMA = 'leerness.test-firestore-probe/v1';
const HOSTS = new Set(['127.0.0.1', '::1']);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;
const PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const MAX_BODY_BYTES = 65536;

class TestFirestoreInputError extends Error {
  constructor(code, field) {
    super(`${code} at ${field}`);
    this.name = 'TestFirestoreInputError';
    this.code = `test_firestore_${code}`;
    this.field = field;
  }
}
function fail(code, field) { throw new TestFirestoreInputError(code, field); }
function record(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('object_required', field);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key))) fail('fields_invalid', field);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('data_field_required', `${field}.${key}`);
    }
  }
}
function validate(input) {
  record(input, ['schema', 'endpoints'], '$');
  if (input.schema !== INPUT_SCHEMA) fail('schema_unsupported', '$.schema');
  if (!Array.isArray(input.endpoints) || input.endpoints.length < 1 || input.endpoints.length > 16) {
    fail('endpoints_invalid', '$.endpoints');
  }
  const seen = new Set();
  input.endpoints.forEach((endpoint, index) => {
    const field = `$.endpoints[${index}]`;
    const hubRequested = endpoint && typeof endpoint === 'object' && !Array.isArray(endpoint)
      && Object.hasOwn(endpoint, 'hubPort');
    record(endpoint, hubRequested
      ? ['id', 'host', 'port', 'projectId', 'timeoutMs', 'hubPort']
      : ['id', 'host', 'port', 'projectId', 'timeoutMs'], field);
    if (typeof endpoint.id !== 'string' || !ID_PATTERN.test(endpoint.id)) fail('id_invalid', `${field}.id`);
    if (seen.has(endpoint.id)) fail('id_duplicate', `${field}.id`);
    seen.add(endpoint.id);
    if (!HOSTS.has(endpoint.host)) fail('host_not_loopback', `${field}.host`);
    if (!Number.isSafeInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) fail('port_invalid', `${field}.port`);
    if (hubRequested && (!Number.isSafeInteger(endpoint.hubPort)
      || endpoint.hubPort < 1 || endpoint.hubPort > 65535)) fail('hub_port_invalid', `${field}.hubPort`);
    if (typeof endpoint.projectId !== 'string' || !PROJECT_PATTERN.test(endpoint.projectId)) {
      fail('project_invalid', `${field}.projectId`);
    }
    if (!Number.isSafeInteger(endpoint.timeoutMs) || endpoint.timeoutMs < 1 || endpoint.timeoutMs > 2000) {
      fail('timeout_invalid', `${field}.timeoutMs`);
    }
  });
  return input.endpoints;
}
function protocolShape(body) {
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && parsed.rules && typeof parsed.rules === 'object' && !Array.isArray(parsed.rules)
      && Array.isArray(parsed.rules.files);
  } catch { return false; }
}
function probeFirestoreEndpoint(endpoint) {
  return new Promise(resolve => {
    const started = performance.now();
    let request;
    let settled = false;
    let httpResponseObserved = false;
    let observedStatus = null;
    const finish = status => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (request) request.destroy();
      resolve({ id: endpoint.id, status, protocolShapeObserved: status === 'firestore-protocol-shape',
        httpResponseObserved, observedStatus, elapsedMs: Math.max(0, Math.round(performance.now() - started)) });
    };
    const timer = setTimeout(() => finish('timeout'), endpoint.timeoutMs);
    try {
      request = http.request({ hostname: endpoint.host, port: endpoint.port,
        path: `/emulator/v1/projects/${endpoint.projectId}:ruleCoverage`,
        method: 'GET', agent: false, timeout: endpoint.timeoutMs,
        headers: { Accept: 'application/json' } }, response => {
        httpResponseObserved = true;
        observedStatus = response.statusCode || null;
        response.once('error', () => finish('http-protocol-error'));
        response.once('aborted', () => finish('http-protocol-error'));
        if (observedStatus !== 200) { finish('http-status-mismatch'); return; }
        const contentType = response.headers['content-type'];
        if (typeof contentType !== 'string' || contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
          finish('content-type-mismatch'); return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) finish('http-response-too-large');
          else if (!settled) chunks.push(chunk);
        });
        response.once('end', () => {
          if (!settled) finish(protocolShape(Buffer.concat(chunks))
            ? 'firestore-protocol-shape' : 'protocol-shape-mismatch');
        });
      });
      request.once('error', error => finish(error.code === 'ECONNREFUSED' ? 'connection-refused' : 'connection-error'));
      request.end();
    } catch { finish('connection-error'); }
  });
}
async function probeFirestorePrerequisites(input) {
  const endpoints = validate(input);
  const results = await Promise.all(endpoints.map(async endpoint => {
    if (!Object.hasOwn(endpoint, 'hubPort')) return probeFirestoreEndpoint(endpoint);
    const [firestore, hub] = await Promise.all([probeFirestoreEndpoint(endpoint), probeFirebaseHub(endpoint)]);
    return { ...firestore, hubStatus: hub.status, hubMappingObserved: hub.hubMappingObserved,
      hubElapsedMs: hub.elapsedMs };
  }));
  const hubResults = results.filter(result => Object.hasOwn(result, 'hubStatus'));
  const hubObservation = hubResults.length
    ? { allHubMappingsObserved: hubResults.every(result => result.hubMappingObserved) } : {};
  return { schema: OUTPUT_SCHEMA, observed: true, probeKind: 'firestore-rule-coverage-shape', results,
    allProtocolShapesObserved: results.every(result => result.protocolShapeObserved),
    ...hubObservation,
    projectIdentityVerified: false, serviceReadyVerified: false, testPassVerified: false,
    finalGatePassed: false, evidenceReusable: false };
}

module.exports = { INPUT_SCHEMA, OUTPUT_SCHEMA, TestFirestoreInputError, probeFirestoreEndpoint, probeFirestorePrerequisites };
