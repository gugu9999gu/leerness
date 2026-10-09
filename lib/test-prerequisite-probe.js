'use strict';

const net = require('node:net');
const { performance } = require('node:perf_hooks');

const INPUT_SCHEMA = 'leerness.test-prerequisite-probe-input/v1';
const OUTPUT_SCHEMA = 'leerness.test-prerequisite-probe/v1';
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;
const HOSTS = new Set(['127.0.0.1', '::1']);

class TestPrerequisiteInputError extends Error {
  constructor(code, field) {
    super(`${code} at ${field}`);
    this.name = 'TestPrerequisiteInputError';
    this.code = `test_probe_${code}`;
    this.field = field;
  }
}
function fail(code, field) { throw new TestPrerequisiteInputError(code, field); }
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
    record(endpoint, ['id', 'host', 'port', 'timeoutMs'], field);
    if (typeof endpoint.id !== 'string' || !ID_PATTERN.test(endpoint.id)) fail('id_invalid', `${field}.id`);
    if (seen.has(endpoint.id)) fail('id_duplicate', `${field}.id`);
    seen.add(endpoint.id);
    if (!HOSTS.has(endpoint.host)) fail('host_not_loopback', `${field}.host`);
    if (!Number.isSafeInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) fail('port_invalid', `${field}.port`);
    if (!Number.isSafeInteger(endpoint.timeoutMs) || endpoint.timeoutMs < 1 || endpoint.timeoutMs > 2000) {
      fail('timeout_invalid', `${field}.timeoutMs`);
    }
  });
  return input.endpoints;
}
function probeEndpoint(endpoint, connect = options => net.createConnection(options)) {
  return new Promise(resolve => {
    const started = performance.now();
    let socket;
    let settled = false;
    const finish = status => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket) socket.destroy();
      resolve({ id: endpoint.id, status, tcpReachable: status === 'tcp-open',
        elapsedMs: Math.max(0, Math.round(performance.now() - started)) });
    };
    const timer = setTimeout(() => finish('timeout'), endpoint.timeoutMs);
    try {
      socket = connect({ host: endpoint.host, port: endpoint.port });
      socket.once('connect', () => finish('tcp-open'));
      socket.once('error', error => finish(error.code === 'ECONNREFUSED' ? 'connection-refused' : 'connection-error'));
    } catch { finish('connection-error'); }
  });
}
async function probePrerequisites(input) {
  const endpoints = validate(input);
  const results = await Promise.all(endpoints.map(endpoint => probeEndpoint(endpoint)));
  return { schema: OUTPUT_SCHEMA, observed: true, probeKind: 'tcp-connect',
    results, allTcpReachable: results.every(result => result.tcpReachable),
    serviceReadyVerified: false, finalGatePassed: false, evidenceReusable: false };
}

module.exports = { INPUT_SCHEMA, OUTPUT_SCHEMA, TestPrerequisiteInputError, probeEndpoint, probePrerequisites };
