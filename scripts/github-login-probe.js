'use strict';

// Real loopback TLS; only the test intercepts DNS destination/trust roots.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const https = require('node:https');
const net = require('node:net');
const crypto = require('node:crypto');
const { createGitHubLogin } = require('../lib/github-login');
const { removeTree } = require('./temp-cleanup');

const tests = [], test = (name, run) => tests.push({ name, run });
const secret = crypto.randomBytes(24).toString('hex'), accessToken = crypto.randomBytes(24).toString('hex');
const settings = { clientId: 'fixture-client', redirectUri: 'http://127.0.0.1:8123/callback', allowedAccountIds: ['101'], timeoutMs: 1500 };
const client = (changes = {}) => createGitHubLogin(JSON.stringify({ ...settings, ...changes }), secret);
const profile = () => ({ id: 101, login: 'sample-person', type: 'User', email: 'private-fixture', bio: 'not approval' });
const exchange = () => ({ access_token: accessToken, token_type: 'bearer', scope: '' });
const callback = handle => settings.redirectUri + '?' + new URLSearchParams({ code: 'fixture-code', state: new URL(handle.authorizationUrl).searchParams.get('state') });
const json = (res, value, headers = {}) => { res.writeHead(200, { 'content-type': 'application/json', ...headers }); res.end(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); };
const normal = (req, res) => json(res, req.url === '/user' ? profile() : exchange());
let handler = normal, server, originalRequest, dir, trusted = true, wrongName = false, specialStage, stallPort;
let attempted = 0, received = 0;
const requests = [], contractErrors = [];
const expectedError = code => error => {
  assert.equal(error.code, code); assert.ok(!error.message.includes(secret) && !error.message.includes(accessToken)); return true;
};
const login = async (changes = {}) => { const c = client(changes), h = c.begin(); return { c, h, session: await c.finish(h, callback(h)) }; };
async function failureAt(stage, code, respond, changes = {}) {
  handler = (req, res) => ((req.url === '/user' ? 'user' : 'token') === stage ? respond : normal)(req, res);
  const c = client(changes), h = c.begin(), before = attempted;
  await assert.rejects(c.finish(h, callback(h)), expectedError(code));
  assert.equal(attempted - before, stage === 'token' ? 1 : 2, 'no retry or redirect');
  await assert.rejects(c.finish(h, callback(h)), expectedError('github_attempt_invalid'));
}

test('OAuth exchange uses matching PKCE, exact callback, explicit empty scope and authenticated user', async () => {
  const before = requests.length, { c, h, session } = await login();
  const url = new URL(h.authorizationUrl), [post, get] = requests.slice(before), body = new URLSearchParams(post.body);
  assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(url.searchParams.get('scope'), ''); assert.equal(url.searchParams.get('prompt'), 'select_account');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(body.get('client_secret'), secret); assert.equal(body.get('client_id'), settings.clientId);
  assert.equal(body.get('redirect_uri'), settings.redirectUri); assert.equal(body.get('code'), 'fixture-code');
  assert.equal(crypto.createHash('sha256').update(body.get('code_verifier')).digest('base64url'), url.searchParams.get('code_challenge'));
  assert.equal(post.method, 'POST'); assert.equal(post.headers.authorization, undefined);
  assert.equal(get.method, 'GET'); assert.equal(get.body, ''); assert.equal(get.headers.authorization, `Bearer ${accessToken}`);
  assert.equal(get.headers['x-github-api-version'], '2026-03-10');
  assert.deepEqual(session.identity, { host: 'github.com', accountId: '101', login: 'sample-person' });
  assert.equal(c.readIdentity(session), session); assert.equal(session.actorIdentityVerified, true);
  assert.equal(session.accountAllowed, true); assert.equal(session.approvalGranted, false);
  assert.equal(session.acceptedAuthorityVerified, false); assert.equal(session.semanticVerified, false);
  assert.equal(session.cleanupAllowed, false); assert.equal(session.independentReview, 'not-verified');
  for (const value of [secret, accessToken, body.get('code_verifier'), 'private-fixture', 'not approval']) assert.ok(!JSON.stringify(session).includes(value));
  assert.ok(Object.isFrozen(session) && Object.isFrozen(session.identity));
  assert.notEqual(c.begin().authorizationUrl, h.authorizationUrl);
});

test('durable account ID permits renamed login, denies reused login and non-person accounts', async () => {
  handler = (req, res) => json(res, req.url === '/user' ? { ...profile(), login: 'renamed-person' } : exchange());
  assert.equal((await login()).session.identity.accountId, '101');
  for (const update of [{ id: 102 }, { type: 'Bot' }, { type: 'Organization' }, { id: '101' }, { id: 0 }, { id: -1 }, { id: 1.5 }, { id: 9007199254740992 }, { login: '<b>x</b>' }]) {
    await failureAt('user', update.id === 102 ? 'github_account_denied' : 'github_identity_invalid', (_q, r) => json(r, { ...profile(), ...update }));
  }
});

test('invalid config cannot make requests or select ambient credentials or endpoints', async () => {
  const before = attempted;
  for (const update of [{ allowedAccountIds: [] }, { allowedAccountIds: [101] }, { allowedAccountIds: ['01'] }, { allowedAccountIds: ['101', '101'] },
    { allowedAccountIds: ['9007199254740992'] }, { redirectUri: 'http://example.com/callback' }, { redirectUri: 'http://localhost/callback' },
    { redirectUri: 'https://x.invalid/path?x=y' }, { redirectUri: 'https://x.invalid/#x' }, { redirectUri: 'https://u:p@x.invalid/' },
    { clientId: 'x\r\n' }, { timeoutMs: 99 }, { timeoutMs: 15001 }, { endpoint: 'https://x.invalid' }, { transport: {} }]) {
    assert.throws(() => client(update), expectedError('github_config_invalid'));
  }
  for (const text of ['{}', 'null', '{', '{"clientId":"a","clientId":"b"}', JSON.stringify({ ...settings, __proto__: null }) + 'x']) {
    assert.throws(() => createGitHubLogin(text, secret), expectedError('github_config_invalid'));
  }
  for (const value of [undefined, '', 'x\r\ny', 'x'.repeat(4097)]) assert.throws(() => createGitHubLogin(JSON.stringify(settings), value), expectedError('github_config_invalid'));
  assert.equal(attempted, before);
  const saved = process.env.GITHUB_API_URL; process.env.GITHUB_API_URL = 'https://invalid.example';
  try { handler = normal; assert.equal((await login()).session.identity.host, 'github.com'); }
  finally { if (saved === undefined) delete process.env.GITHUB_API_URL; else process.env.GITHUB_API_URL = saved; }
});

test('callback URL, duplicate keys, wrong state, cancellation and copied handles reject before network', async () => {
  const before = attempted;
  for (const alter of [u => u.replace('8123', '8124'), u => u.replace('/callback?', '/other?'), u => u + '&state=x',
    u => u + '&%63ode=other', u => u + '&next=x', u => u + '#x', u => u.replace('state=', 'state=x'),
    u => u.replace('code=fixture-code', 'code='), u => u.replace('127.0.0.1', 'evil.invalid'), u => u + '&error=denied']) {
    const c = client(), h = c.begin();
    await assert.rejects(c.finish(h, alter(callback(h))), expectedError('github_callback_invalid'));
    await assert.rejects(c.finish(h, callback(h)), expectedError('github_attempt_invalid'));
  }
  const c = client(), h = c.begin();
  await assert.rejects(c.finish({ ...h }, callback(h)), expectedError('github_attempt_invalid'));
  await assert.rejects(client().finish(h, callback(h)), expectedError('github_attempt_invalid'));
  assert.equal(c.cancel(h), true); await assert.rejects(c.finish(h, callback(h)), expectedError('github_attempt_invalid'));
  const denied = c.begin();
  await assert.rejects(c.finish(denied, callback(denied).replace('code=fixture-code', 'error=access_denied')), expectedError('github_login_denied'));
  assert.equal(attempted, before);
});

test('simultaneous callbacks exchange once; session copy, other client and invalidation cannot authenticate', async () => {
  const c = client(), h = c.begin(), before = attempted;
  const pending = c.finish(h, callback(h));
  await assert.rejects(c.finish(h, callback(h)), expectedError('github_attempt_invalid'));
  const session = await pending; assert.equal(attempted - before, 2);
  assert.throws(() => c.readIdentity(JSON.parse(JSON.stringify(session))), expectedError('github_identity_session_invalid'));
  assert.throws(() => client().readIdentity(session), expectedError('github_identity_session_invalid'));
  assert.equal(c.invalidate(session), true); assert.throws(() => c.readIdentity(session), expectedError('github_identity_session_invalid'));
});

test('expired and backward-clock login or identity are rejected, including expiry during either response', async () => {
  const now = Date.now;
  try {
    let time = now(); Date.now = () => time;
    const c = client(), h = c.begin(), before = attempted; time = h.expiresAt;
    await assert.rejects(c.finish(h, callback(h)), expectedError('github_session_expired')); assert.equal(attempted, before);
    const h2 = c.begin(); time--; await assert.rejects(c.finish(h2, callback(h2)), expectedError('github_session_expired'));
    time = now(); const { c: logged, session } = await login(); time = session.expiresAt;
    assert.throws(() => logged.readIdentity(session), expectedError('github_session_expired'));
    time = session.verifiedAt - 1; assert.throws(() => logged.readIdentity(session), expectedError('github_session_expired'));
    for (const stage of ['token', 'user']) {
      time = now();
      await failureAt(stage, 'github_session_expired', (req, res) => { time += 300001; normal(req, res); });
    }
  } finally { Date.now = now; }
});

test('closing the client invalidates pending requests and all issued sessions', async () => {
  const { c, session } = await login(); c.close();
  assert.throws(() => c.readIdentity(session), expectedError('github_client_closed'));
  assert.throws(() => c.begin(), expectedError('github_client_closed'));
  const pendingClient = client(), h = pendingClient.begin();
  handler = (req, res) => { pendingClient.close(); normal(req, res); };
  const before = attempted; await assert.rejects(pendingClient.finish(h, callback(h)), expectedError('github_client_closed'));
  assert.equal(attempted - before, 1);
});

test('token errors, broad scopes and malformed credentials never reach user endpoint', async () => {
  for (const value of [null, [], {}, { ...exchange(), error: secret }, { ...exchange(), scope: 'repo' }, { ...exchange(), scope: 'read:user' },
    { ...exchange(), scope: undefined }, { ...exchange(), token_type: 'mac' }, { ...exchange(), access_token: 'x\r\ny' }]) {
    await failureAt('token', 'github_token_invalid', (_q, r) => json(r, value));
  }
});

test('TLS trust and hostname verification protect both credential destinations', async () => {
  for (const stage of ['token', 'user']) for (const mode of ['trust', 'name']) {
    specialStage = stage; trusted = mode !== 'trust'; wrongName = mode === 'name'; const before = received;
    try { await failureAt(stage, 'github_unavailable', normal); assert.equal(received - before, stage === 'token' ? 0 : 1); }
    finally { specialStage = undefined; trusted = true; wrongName = false; }
  }
});

test('redirects, rate limits and HTTP errors are sanitized with no retry', async () => {
  for (const stage of ['token', 'user']) for (const status of [301, 302, 303, 307, 308, 401, 403, 429, 500, 204]) {
    await failureAt(stage, status < 400 ? (status === 204 ? 'github_http_error' : 'github_redirect_rejected')
      : status === 401 || status === 403 ? 'github_denied' : status === 429 ? 'github_rate_limited' : 'github_http_error', (_q, r) => {
      r.writeHead(status, { Location: 'https://invalid.example/capture', 'Retry-After': '0' }); r.end(secret);
    });
  }
});

test('invalid content type, compressed data, JSON duplicates and invalid UTF-8 fail closed', async () => {
  for (const stage of ['token', 'user']) {
    for (const headers of [{ 'content-type': 'text/html' }, { 'content-encoding': 'gzip' }]) {
      await failureAt(stage, 'github_response_invalid', (_q, r) => json(r, exchange(), headers));
    }
    for (const value of ['{', '{"id":101,"\\u0069d":102}', Buffer.from([0xc3, 0x28]), Buffer.from('\ufeff{}'), '['.repeat(18) + '0' + ']'.repeat(18)]) {
      await failureAt(stage, 'github_response_invalid', (_q, r) => json(r, value));
    }
  }
});

test('bounded response size, incomplete body and socket errors cannot authenticate', async () => {
  for (const stage of ['token', 'user']) {
    await failureAt(stage, 'github_response_too_large', (_q, r) => json(r, ' '.repeat(65537)));
    await failureAt(stage, 'github_response_too_large', (_q, r) => json(r, '{}', { 'content-length': '65537' }));
    await failureAt(stage, 'github_unavailable', req => req.socket.destroy());
    await failureAt(stage, 'github_incomplete', (_q, r) => {
      r.writeHead(200, { 'content-type': 'application/json', 'content-length': '2000' }); r.write('{'); setTimeout(() => r.destroy(), 20);
    });
  }
});

test('absolute deadlines cover headers and trickling bodies on both stages', async () => {
  for (const stage of ['token', 'user']) {
    await failureAt(stage, 'github_timeout', () => {}, { timeoutMs: 150 });
    await failureAt(stage, 'github_timeout', (_q, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }); res.write(' ');
      const timer = setInterval(() => res.write(' '), 25); res.on('close', () => clearInterval(timer));
    }, { timeoutMs: 150 });
  }
});

test('absolute deadline also includes a stalled TLS handshake', async () => {
  const sockets = new Set(), stalled = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => stalled.listen(0, '127.0.0.1', resolve));
  stallPort = stalled.address().port; specialStage = 'token'; const before = received;
  try { await failureAt('token', 'github_timeout', normal, { timeoutMs: 150 }); assert.equal(received, before); }
  finally { stallPort = undefined; specialStage = undefined; for (const socket of sockets) socket.destroy(); await new Promise(resolve => stalled.close(resolve)); }
});

async function main() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-github-'));
  const openssl = process.platform === 'win32' && fs.existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem'), conf = path.join(dir, 'openssl.cnf');
  fs.writeFileSync(conf, '[req]\ndistinguished_name=dn\n[dn]\n');
  const result = cp.spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-config', conf,
    '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=github.com', '-addext', 'subjectAltName=DNS:github.com,DNS:api.github.com'],
  { windowsHide: true, timeout: 20000, encoding: 'utf8' });
  assert.equal(result.status, 0, 'ephemeral certificate generation required; no skip');
  const certificate = fs.readFileSync(cert);
  server = https.createServer({ key: fs.readFileSync(key), cert: certificate }, (req, res) => {
    received++; const record = { method: req.method, url: req.url, headers: req.headers, body: '' }, respond = handler;
    requests.push(record); req.on('data', chunk => { record.body += chunk; }); req.on('end', () => respond(req, res));
  });
  server.on('tlsClientError', () => {}); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  originalRequest = https.request;
  https.request = (options, cb) => {
    attempted++; const stage = options.path === '/user' ? 'user' : 'token', special = specialStage === stage;
    try {
      assert.equal(options.hostname, stage === 'user' ? 'api.github.com' : 'github.com');
      assert.equal(options.servername, options.hostname); assert.equal(options.protocol, 'https:'); assert.equal(options.port, 443);
      assert.equal(options.path, stage === 'user' ? '/user' : '/login/oauth/access_token');
      assert.equal(options.method, stage === 'user' ? 'GET' : 'POST'); assert.equal(options.agent, false); assert.equal(options.rejectUnauthorized, true);
    } catch (error) { contractErrors.push(error); throw error; }
    return originalRequest({ ...options, hostname: '127.0.0.1', port: special && stallPort ? stallPort : server.address().port,
      ...(!special || trusted ? { ca: certificate } : {}), ...(special && wrongName ? { servername: 'wrong.invalid' } : {}) }, cb);
  };
  let passed = 0;
  for (const { name, run } of tests) {
    handler = normal;
    try { await run(); passed++; console.log('PASS ' + name); }
    catch (error) { console.error('FAIL ' + name + '\n' + error.stack); }
  }
  assert.equal(contractErrors.length, 0, 'do not swallow transport contract assertions');
  console.log(`Tests: ${passed} passed, ${tests.length - passed} failed, ${tests.length} total; real TLS, no GitHub calls`);
  if (passed !== tests.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (originalRequest) https.request = originalRequest;
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (dir) {
    const resolved = fs.realpathSync(dir), temp = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved), temp); assert.ok(path.basename(resolved).startsWith('lr-github-'));
    removeTree(resolved, { recursive: true });
  }
});
