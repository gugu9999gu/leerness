'use strict';

const assert = require('node:assert/strict');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const F = require('./ui-review-run-fixture');
const API = require('../lib/openai-ui-review-dispatch');
const encode = JSON.stringify;
const materialBytes = { source: Buffer.from('PRIVATE_SOURCE 한글'), spec: Buffer.from('PRIVATE_SPEC'), diff: Buffer.from('PRIVATE_DIFF'),
  render: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5tQAAAAASUVORK5CYII=', 'base64') };
const config = { provider: 'openai', profile: { profileId: 'fixture', profileRevision: 'v1', projectId: 'proj_fixture', organizationId: 'org_fixture' },
  model: 'fixture-model', maxOutputTokens: 1024, timeoutMs: 2000, store: false };
function setup(root, extra = {}) { return F.setup(root, { ledger: false, materialBytes, ...extra }); }
function prepare(s, options = config) { return API.prepareOpenAiUiReviewDispatch(s.root, encode(s.run), encode(s.request), encode(s.input), encode(options)); }
function read(s) { return API.readOpenAiUiReviewDispatch(s.root, s.run.batchId, s.run.runId); }
function lookup(s, key, profile = config.profile) { return API.retrieveOpenAiUiReviewDispatch(s.root, encode(s.run), encode(profile), key); }
function certificate(dir) {
  const openssl = process.platform === 'win32' && fs.existsSync('C:\\Program Files\\Git\\usr\\bin\\openssl.exe')
    ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl';
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem'), cfg = path.join(dir, 'openssl.cnf');
  fs.writeFileSync(cfg, '[req]\ndistinguished_name=dn\n[dn]\n');
  const result = cp.spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-config', cfg,
    '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=api.openai.com', '-addext', 'subjectAltName=DNS:api.openai.com'],
  { windowsHide: true, timeout: 20000 });
  assert.equal(result.status, 0, 'ephemeral TLS certificate generation; no skip');
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}
function bridge(port, cert) {
  const original = https.request, errors = [];
  https.request = (options, cb) => {
    try {
      assert.equal(options.protocol, 'https:'); assert.equal(options.hostname, 'api.openai.com'); assert.equal(options.port, 443);
      assert.equal(options.servername, 'api.openai.com'); assert.equal(options.rejectUnauthorized, true); assert.equal(options.agent, false);
      if (options.method === 'POST') assert.equal(options.path, '/v1/responses');
      else { assert.equal(options.method, 'GET'); assert.match(options.path, /^\/v1\/responses\/[A-Za-z0-9_-]+$/); }
    } catch (e) { errors.push(e.message); throw e; }
    return original({ ...options, hostname: '127.0.0.1', port, ca: cert }, cb);
  };
  return { errors, restore() { https.request = original; } };
}
module.exports = { ...F, setup, prepare, read, lookup, config, materialBytes, certificate, bridge, API, encode };
