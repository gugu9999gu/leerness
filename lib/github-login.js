'use strict';

const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { parseInputJson } = require('./review-checkpoint-transport');
const { fail } = require('./review-control-contract');
const { authority } = require('./ui-review-run-contract');
const http = require('./github-login-http');

const SCHEMA = 'leerness.github-login/v1';
const LOGIN_TTL = 300000, SESSION_TTL = 120000;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const token = v => typeof v === 'string' && /^[A-Za-z0-9._~-]{1,4096}$/.test(v);
const id = v => typeof v === 'string' && /^[1-9][0-9]{0,15}$/.test(v) && Number.isSafeInteger(Number(v));
function config(text, secret) {
  try {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 8192 || !token(secret)) throw new Error();
    const v = parseInputJson(text);
    if (!plain(v) || Object.keys(v).some(k => !['clientId', 'redirectUri', 'allowedAccountIds', 'timeoutMs'].includes(k))
      || typeof v.clientId !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(v.clientId)
      || typeof v.redirectUri !== 'string' || v.redirectUri.length > 2048 || /[\s\\]/.test(v.redirectUri)
      || !Array.isArray(v.allowedAccountIds) || !v.allowedAccountIds.length || v.allowedAccountIds.length > 128
      || v.allowedAccountIds.some(x => !id(x)) || new Set(v.allowedAccountIds).size !== v.allowedAccountIds.length
      || (v.timeoutMs !== undefined && (!Number.isInteger(v.timeoutMs) || v.timeoutMs < 100 || v.timeoutMs > 15000))) throw new Error();
    const url = new URL(v.redirectUri);
    if (url.href !== v.redirectUri || url.username || url.password || url.search || url.hash
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error();
    return { ...v, timeoutMs: v.timeoutMs ?? 5000 };
  } catch { fail('github_config_invalid'); }
}
function live(issuedAt, expiresAt) {
  const now = Date.now();
  if (!Number.isSafeInteger(now) || now < issuedAt || now >= expiresAt) fail('github_session_expired');
}
function callback(text, redirectUri, state) {
  try {
    if (typeof text !== 'string' || text.length > 8192 || /[\s\\]/.test(text)) throw new Error();
    const url = new URL(text), target = new URL(redirectUri);
    if (url.origin !== target.origin || url.pathname !== target.pathname || url.username || url.password || url.hash
      || url.searchParams.getAll('state').length !== 1
      || [...url.searchParams.keys()].some(k => !['state', 'code', 'error', 'error_description', 'error_uri'].includes(k))) throw new Error();
    for (const key of url.searchParams.keys()) if (url.searchParams.getAll(key).length !== 1) throw new Error();
    const supplied = url.searchParams.get('state');
    if (!/^[A-Za-z0-9_-]{43}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(state))) throw new Error();
    if (url.searchParams.has('error')) {
      if (url.searchParams.has('code')) throw new Error();
      return null;
    }
    if (url.searchParams.has('error_description') || url.searchParams.has('error_uri')) throw new Error();
    const code = url.searchParams.get('code');
    if (!token(code)) throw new Error();
    return code;
  } catch { fail('github_callback_invalid'); }
}

// Server-side client: callers protect the opaque handles with their browser session.
// Neither a copied projection nor a login name is an authorization credential.
function createGitHubLogin(configJson, clientSecret) {
  const settings = config(configJson, clientSecret);
  let attempts = new WeakMap(), identities = new WeakMap(), closed = false;
  const active = () => { if (closed) fail('github_client_closed'); };
  return Object.freeze({
    begin() {
      active();
      const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
      const issuedAt = Date.now(), expiresAt = issuedAt + LOGIN_TTL;
      live(issuedAt, expiresAt);
      const url = new URL('https://github.com/login/oauth/authorize');
      url.search = new URLSearchParams({ client_id: settings.clientId, redirect_uri: settings.redirectUri,
        scope: '', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256', prompt: 'select_account' }).toString();
      const handle = Object.freeze({ authorizationUrl: url.href, expiresAt });
      attempts.set(handle, { state, verifier, issuedAt, expiresAt });
      return handle;
    },
    cancel(handle) { active(); return attempts.delete(handle); },
    async finish(handle, callbackUrl) {
      active();
      const attempt = attempts.get(handle);
      if (!attempt) fail('github_attempt_invalid');
      // Consume synchronously before validation/network so racing callbacks cannot exchange twice.
      attempts.delete(handle);
      const remaining = () => { active(); live(attempt.issuedAt, attempt.expiresAt); return Math.min(settings.timeoutMs, attempt.expiresAt - Date.now()); };
      remaining();
      const code = callback(callbackUrl, settings.redirectUri, attempt.state);
      if (code === null) fail('github_login_denied');
      let exchange;
      try {
        exchange = await http.request('token', { client_id: settings.clientId, client_secret: clientSecret,
          redirect_uri: settings.redirectUri, code, code_verifier: attempt.verifier }, remaining());
        remaining();
        if (!plain(exchange) || Object.hasOwn(exchange, 'error') || !token(exchange.access_token)
          || exchange.token_type !== 'bearer' || exchange.scope !== '') fail('github_token_invalid');
        const user = await http.request('user', exchange.access_token, remaining());
        remaining();
        if (!plain(user) || !Number.isSafeInteger(user.id) || user.id <= 0 || user.type !== 'User'
          || typeof user.login !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(user.login)) fail('github_identity_invalid');
        const accountId = String(user.id);
        if (!settings.allowedAccountIds.includes(accountId)) fail('github_account_denied');
        const verifiedAt = Date.now(), expiresAt = Math.min(verifiedAt + SESSION_TTL, attempt.expiresAt);
        live(verifiedAt, expiresAt);
        const session = Object.freeze({ schema: SCHEMA, identity: Object.freeze({ host: 'github.com', accountId, login: user.login }),
          verifiedAt, expiresAt, ...authority(), actorIdentityVerified: true, accountAllowed: true });
        identities.set(session, session);
        return session;
      } finally {
        // No persistent credential store, refresh, retry or token-bearing error output.
        if (plain(exchange)) { delete exchange.access_token; delete exchange.refresh_token; }
        attempt.verifier = ''; attempt.state = '';
      }
    },
    readIdentity(session) {
      active(); const known = identities.get(session);
      if (!known) fail('github_identity_session_invalid');
      live(known.verifiedAt, known.expiresAt); return known;
    },
    invalidate(session) { active(); return identities.delete(session); },
    close() { closed = true; clientSecret = undefined; attempts = new WeakMap(); identities = new WeakMap(); }
  });
}

module.exports = { SCHEMA, createGitHubLogin };
