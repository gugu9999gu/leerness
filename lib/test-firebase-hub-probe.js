'use strict';

const http = require('node:http');
const { performance } = require('node:perf_hooks');
const { TextDecoder } = require('node:util');
const { assertUniqueKeys } = require('./review-checkpoint-transport');

const MAX_BODY_BYTES = 16384;

function mapped(record, name, host, port) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || record.name !== name || record.port !== port) return false;
  if (Object.hasOwn(record, 'listen')) return Array.isArray(record.listen)
    && record.listen.some(item => item && item.address === host && item.port === port);
  return record.host === host;
}
function classify(body, endpoint) {
  let payload;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    payload = JSON.parse(text);
    assertUniqueKeys(text);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'hub-json-invalid';
  } catch { return 'hub-json-invalid'; }
  if (!mapped(payload.hub, 'hub', endpoint.host, endpoint.hubPort)) return 'hub-self-mismatch';
  if (!payload.firestore || payload.firestore.name !== 'firestore') return 'hub-firestore-missing';
  if (payload.firestore.port !== endpoint.port) return 'hub-port-mismatch';
  if (!mapped(payload.firestore, 'firestore', endpoint.host, endpoint.port)) return 'hub-host-mismatch';
  return 'hub-firestore-mapped';
}
function probeFirebaseHub(endpoint) {
  return new Promise(resolve => {
    const started = performance.now();
    let request;
    let settled = false;
    const finish = status => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (request) request.destroy();
      resolve({ status, hubMappingObserved: status === 'hub-firestore-mapped',
        elapsedMs: Math.max(0, Math.round(performance.now() - started)) });
    };
    const timer = setTimeout(() => finish('hub-timeout'), endpoint.timeoutMs);
    try {
      request = http.request({ hostname: endpoint.host, port: endpoint.hubPort,
        path: '/emulators', method: 'GET', agent: false, timeout: endpoint.timeoutMs,
        headers: { Accept: 'application/json' } }, response => {
        response.once('error', () => finish('hub-protocol-error'));
        response.once('aborted', () => finish('hub-protocol-error'));
        if (response.statusCode !== 200) { finish('hub-http-status-mismatch'); return; }
        const contentType = response.headers['content-type'];
        if (typeof contentType !== 'string' || contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
          finish('hub-content-type-mismatch'); return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) finish('hub-response-too-large');
          else if (!settled) chunks.push(chunk);
        });
        response.once('end', () => { if (!settled) finish(classify(Buffer.concat(chunks), endpoint)); });
      });
      request.once('error', error => finish(error.code === 'ECONNREFUSED'
        ? 'hub-connection-refused' : 'hub-connection-error'));
      request.end();
    } catch { finish('hub-connection-error'); }
  });
}

module.exports = { probeFirebaseHub };
