'use strict';

const https = require('node:https');
const { TextDecoder } = require('node:util');
const { parseInputJson } = require('./review-checkpoint-transport');
const { fail } = require('./review-control-contract');

// Internal fixed-endpoint transport. No ambient credential or endpoint lookup.
function request(stage, credential, timeoutMs) {
  if (stage !== 'token' && stage !== 'user') fail('github_input_invalid');
  const tokenStage = stage === 'token';
  const hostname = tokenStage ? 'github.com' : 'api.github.com';
  const body = tokenStage ? Buffer.from(new URLSearchParams(credential).toString()) : undefined;
  return new Promise((resolve, reject) => {
    let outgoing, response, settled = false, size = 0;
    const chunks = [];
    const finish = (code, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); chunks.length = 0;
      response?.destroy(); outgoing?.destroy(); body?.fill(0);
      if (code) { try { fail(code); } catch (error) { reject(error); } } else resolve(value);
    };
    // Absolute deadline includes DNS, TLS, response headers and trickling bodies.
    const timer = setTimeout(() => finish('github_timeout'), timeoutMs);
    const headers = { Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'leerness-github-login' };
    if (tokenStage) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers['Content-Length'] = body.length;
    } else {
      headers.Authorization = `Bearer ${credential}`; headers['X-GitHub-Api-Version'] = '2026-03-10';
    }
    try {
      outgoing = https.request({ protocol: 'https:', hostname, servername: hostname, port: 443,
        path: tokenStage ? '/login/oauth/access_token' : '/user', method: tokenStage ? 'POST' : 'GET',
        headers, agent: false, rejectUnauthorized: true, maxHeaderSize: 16384 }, incoming => {
        response = incoming;
        response.on('error', () => finish('github_unavailable'));
        response.on('aborted', () => finish('github_incomplete'));
        response.on('close', () => { if (!response.complete) finish('github_incomplete'); });
        if (settled) { response.destroy(); return; }
        if (response.statusCode !== 200) return finish(response.statusCode >= 300 && response.statusCode < 400
          ? 'github_redirect_rejected' : response.statusCode === 401 || response.statusCode === 403
            ? 'github_denied' : response.statusCode === 429 ? 'github_rate_limited' : 'github_http_error');
        const type = response.headers['content-type'], encoding = response.headers['content-encoding'], length = response.headers['content-length'];
        if (typeof type !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(type)
          || (encoding !== undefined && encoding !== 'identity')) return finish('github_response_invalid');
        if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > 65536)) return finish('github_response_too_large');
        response.on('data', chunk => {
          if (settled) return;
          size += chunk.length;
          if (size > 65536) return finish('github_response_too_large');
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          if (!response.complete) return finish('github_incomplete');
          try {
            const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, size));
            finish(null, parseInputJson(text));
          } catch { finish('github_response_invalid'); }
        });
      });
      outgoing.on('error', () => finish('github_unavailable'));
      outgoing.on('close', () => { if (!response) finish('github_unavailable'); });
      outgoing.end(body);
    } catch { finish('github_unavailable'); }
  });
}

module.exports = { request };
