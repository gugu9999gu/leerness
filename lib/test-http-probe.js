'use strict';

const http = require('node:http');
const { performance } = require('node:perf_hooks');

const INPUT_SCHEMA = 'leerness.test-http-probe-input/v1';
const OUTPUT_SCHEMA = 'leerness.test-http-probe/v1';
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;
const PATH_PATTERN = /^\/[A-Za-z0-9/._~-]{0,127}$/;
const HOSTS = new Set(['127.0.0.1', '::1']);
const MAX_BODY_BYTES = 16384;

class TestHttpInputError extends Error {
  constructor(code, field) {
    super(`${code} at ${field}`);
    this.name = 'TestHttpInputError';
    this.code = `test_http_${code}`;
    this.field = field;
  }
}
function fail(code, field) { throw new TestHttpInputError(code, field); }
function record(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('object_required', field);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key))) fail('fields_invalid', field);
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !desc.enumerable || !Object.hasOwn(desc, 'value')) fail('data_field_required', `${field}.${key}`);
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
    record(endpoint, ['id', 'host', 'port', 'path', 'expectedStatus', 'bodyIncludes', 'timeoutMs'], field);
    if (typeof endpoint.id !== 'string' || !ID_PATTERN.test(endpoint.id)) fail('id_invalid', `${field}.id`);
    if (seen.has(endpoint.id)) fail('id_duplicate', `${field}.id`);
    seen.add(endpoint.id);
    if (!HOSTS.has(endpoint.host)) fail('host_not_loopback', `${field}.host`);
    if (!Number.isSafeInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) fail('port_invalid', `${field}.port`);
    if (typeof endpoint.path !== 'string' || !PATH_PATTERN.test(endpoint.path)
      || endpoint.path.includes('//') || endpoint.path.split('/').includes('..')) fail('path_invalid', `${field}.path`);
    if (!Number.isSafeInteger(endpoint.expectedStatus) || endpoint.expectedStatus < 200
      || endpoint.expectedStatus > 299) fail('status_invalid', `${field}.expectedStatus`);
    if (endpoint.bodyIncludes !== null && (typeof endpoint.bodyIncludes !== 'string'
      || !/^[\x20-\x7e]{1,128}$/.test(endpoint.bodyIncludes))) fail('body_invalid', `${field}.bodyIncludes`);
    if (!Number.isSafeInteger(endpoint.timeoutMs) || endpoint.timeoutMs < 1 || endpoint.timeoutMs > 2000) {
      fail('timeout_invalid', `${field}.timeoutMs`);
    }
  });
  return input.endpoints;
}
function probeHttpEndpoint(endpoint) {
  return new Promise(resolve => {
    const started = performance.now();
    let request;
    let settled = false;
    let responseObserved = false;
    let observedStatus = null;
    const finish = status => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (request) request.destroy();
      resolve({ id: endpoint.id, status, httpExpectationMet: status === 'http-expected',
        httpResponseObserved: responseObserved, observedStatus,
        elapsedMs: Math.max(0, Math.round(performance.now() - started)) });
    };
    const timer = setTimeout(() => finish('timeout'), endpoint.timeoutMs);
    try {
      request = http.request({ hostname: endpoint.host, port: endpoint.port, path: endpoint.path,
        method: 'GET', agent: false, timeout: endpoint.timeoutMs }, response => {
        responseObserved = true;
        observedStatus = response.statusCode || null;
        response.once('error', () => finish('http-protocol-error'));
        response.once('aborted', () => finish('http-protocol-error'));
        if (observedStatus !== endpoint.expectedStatus) { finish('http-status-mismatch'); return; }
        if (endpoint.bodyIncludes === null) { finish('http-expected'); return; }
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) finish('http-response-too-large');
          else if (!settled) chunks.push(chunk);
        });
        response.once('end', () => {
          if (!settled) finish(Buffer.concat(chunks).includes(Buffer.from(endpoint.bodyIncludes, 'ascii'))
            ? 'http-expected' : 'http-body-mismatch');
        });
      });
      request.once('error', error => finish(error.code === 'ECONNREFUSED' ? 'connection-refused' : 'connection-error'));
      request.end();
    } catch { finish('connection-error'); }
  });
}
async function probeHttpPrerequisites(input) {
  const endpoints = validate(input);
  const results = await Promise.all(endpoints.map(probeHttpEndpoint));
  return { schema: OUTPUT_SCHEMA, observed: true, probeKind: 'loopback-http-get',
    results, allHttpExpectationsMet: results.every(result => result.httpExpectationMet),
    serviceReadyVerified: false, finalGatePassed: false, evidenceReusable: false };
}

module.exports = { INPUT_SCHEMA, OUTPUT_SCHEMA, TestHttpInputError, probeHttpEndpoint, probeHttpPrerequisites };
