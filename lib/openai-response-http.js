'use strict';

const https = require('node:https');
const { TextDecoder } = require('node:util');
const { parseInputJson } = require('./review-checkpoint-transport');

const MAX_BYTES = 65536;
const SCHEMA = 'leerness.openai-response-retrieval/v1';
const STATUSES = new Set(['queued', 'in_progress', 'completed', 'failed', 'cancelled', 'incomplete']);
const token = (value, max) => typeof value === 'string' && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function result(extra) {
  // A caller-selected response ID is not an authenticated dispatch locator.
  return { schema: SCHEMA, executionBindingVerified: false, retryAllowed: false, approvalGranted: false, ...extra };
}
function failure(code) { return result({ ok: false, error: { code } }); }

function credential(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.length > 4096 || !/^[A-Za-z0-9._~+/-]+=*$/.test(apiKey)) throw new Error();
}
function input(text, apiKey) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 4096) throw new Error();
  const value = parseInputJson(text);
  if (!plain(value) || Object.keys(value).some(k => !['responseId', 'projectId', 'organizationId', 'timeoutMs'].includes(k))
    || !token(value.responseId, 256) || !token(value.projectId, 128)
    || (Object.hasOwn(value, 'organizationId') && !token(value.organizationId, 128))
    || (Object.hasOwn(value, 'timeoutMs') && (!Number.isInteger(value.timeoutMs) || value.timeoutMs < 100 || value.timeoutMs > 15000))) throw new Error();
  credential(apiKey);
  return { ...value, timeoutMs: value.timeoutMs ?? 5000 };
}

function projection(bytes, responseId) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const value = parseInputJson(text);
  if (!plain(value) || value.object !== 'response' || !token(value.id, 256) || (responseId !== undefined && value.id !== responseId) || !STATUSES.has(value.status)
    || typeof value.model !== 'string' || value.model.length > 256 || !/^[A-Za-z0-9._:/-]+$/.test(value.model)
    || !Number.isSafeInteger(value.created_at) || value.created_at < 0 || !Array.isArray(value.output)
    || value.output.some(item => !plain(item) || !token(item.type, 128))) throw new Error();
  // Preserve output item order and type. No tool call is executed or assumed to
  // be assistant text. Instructions, metadata and raw provider errors stay out.
  return { id: value.id, status: value.status, model: value.model, createdAt: value.created_at, output: value.output };
}

function requestOnce(value, apiKey, body) {
  return new Promise(resolve => {
    let request, response, timer, settled = false, size = 0;
    const chunks = [];
    function finish(outcome) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chunks.length = 0;
      // Keep error handlers attached for late errors from destroyed sockets.
      response?.destroy();
      request?.destroy();
      resolve(outcome);
    }
    const fail = code => finish(failure(code));
    const headers = { Authorization: `Bearer ${apiKey}`, 'OpenAI-Project': value.projectId,
      Accept: 'application/json', 'Accept-Encoding': 'identity' };
    if (value.organizationId) headers['OpenAI-Organization'] = value.organizationId;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = body.length; }
    // An absolute deadline includes DNS, TLS, headers and a trickling body.
    timer = setTimeout(() => fail('retrieval_timeout'), value.timeoutMs);
    try {
      request = https.request({ protocol: 'https:', hostname: 'api.openai.com', port: 443,
        servername: 'api.openai.com', method: body === undefined ? 'GET' : 'POST', path: body === undefined ? `/v1/responses/${value.responseId}` : '/v1/responses',
        headers, agent: false, rejectUnauthorized: true, maxHeaderSize: 16384 }, incoming => {
        response = incoming;
        response.on('error', () => fail('retrieval_unavailable'));
        response.on('aborted', () => fail('retrieval_incomplete'));
        response.on('close', () => { if (!response.complete) fail('retrieval_incomplete'); });
        if (settled) { response.destroy(); return; }
        // Do not consume/log error bodies, follow Location, or retry any status.
        if (response.statusCode !== 200) {
          const code = response.statusCode;
          return fail(code >= 300 && code < 400 ? 'redirect_rejected'
            : code === 401 || code === 403 ? 'retrieval_denied'
              : code === 404 || code === 410 ? 'response_unavailable'
                : code === 429 ? 'retrieval_rate_limited' : 'retrieval_http_error');
        }
        const type = response.headers['content-type'];
        const encoding = response.headers['content-encoding'];
        const length = response.headers['content-length'];
        if (typeof type !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(type)
          || (encoding !== undefined && encoding !== 'identity')) return fail('response_format_invalid');
        if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) return fail('response_too_large');
        const organization = response.headers['openai-organization'];
        if (value.organizationId && organization !== undefined && organization !== value.organizationId) return fail('response_scope_mismatch');
        response.on('data', chunk => {
          if (settled) return;
          size += chunk.length;
          if (size > MAX_BYTES) return fail('response_too_large');
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          if (!response.complete) return fail('retrieval_incomplete');
          try {
            const observed = projection(Buffer.concat(chunks, size), value.responseId);
            finish(result({ ok: true, requestedScope: { projectId: value.projectId, organizationId: value.organizationId ?? null }, response: observed }));
          } catch { fail('response_invalid'); }
        });
      });
      request.on('error', () => fail('retrieval_unavailable'));
      request.on('close', () => { if (!response) fail('retrieval_unavailable'); });
      request.end(body);
    } catch { fail('retrieval_unavailable'); }
  });
}

// Internal fixed-endpoint transport. Public wrappers validate inputs and fence dispatch.
module.exports = { input, credential, failure, requestOnce, projection, token };
