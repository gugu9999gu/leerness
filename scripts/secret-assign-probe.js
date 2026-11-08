'use strict';
// T-0084: display redaction of NAME=value assignments. Design notes (empty values, setting flags,
// KEY-only identifiers) stay readable; password/secret/token/credential/auth/API values stay masked.
const assert = require('assert');
const { redactSecrets } = require('../lib/pure-utils');
let passed = 0, failed = 0;
// Built at runtime so the source holds no token-shaped literal (synthetic value, not a credential).
const FAKE = ['gh', 'p_', 'abcdefghijklmnopqrstuvwxyz', '0123456789'].join('');
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); } }

test('reproduced false positives keep their text', () => {
  for (const text of ['idempotency_key=run:phase:step', "auth_scheme=''", 'PROJECT_DEV_HEADER_AUTH=false', 'idempotency_key: "run:phase:step"',
    'SORT_KEY=createdAt', 'secret: ""', 'FEATURE_AUTH=true', 'primary_key: null']) assert.strictEqual(redactSecrets(text), text, text);
});
test('secret values stay masked', () => {
  const masked = {
    'PASSWORD=hunter': 'PASSWORD=***', 'DB_PASSWORD=false': 'DB_PASSWORD=***', 'API_KEY=abcdefghij': 'API_KEY=***', 'apikey: short': 'apikey=***',
    'AUTH=admin:password': 'AUTH=***', 'MY_TOKEN=x': 'MY_TOKEN=***', 'SECRET=null': 'SECRET=***', 'client_credential=abc': 'client_credential=***',
    'ENCRYPTION_KEY=Zx81kq0pLm2nB7vC4xR9': 'ENCRYPTION_KEY=***', 'ACCESS_KEY=letters': 'ACCESS_KEY=***', 'PRIVATE_KEY=abc': 'PRIVATE_KEY=***',
    'session_key=abcdefghijklmnopqrstuvwxyzABCD': 'session_key=***', 'BASIC_AUTH="user:pass"': 'BASIC_AUTH=***',
  };
  for (const [text, want] of Object.entries(masked)) assert.strictEqual(redactSecrets(text), want, text);
  const token = 'GITHUB_TOKEN=' + FAKE;
  assert.ok(!redactSecrets(token).includes(FAKE), token);
});
test('a kept assignment is still checked by the shape rules', () => {
  const out = redactSecrets('sort_key=' + FAKE);
  assert.ok(!out.includes(FAKE), out);
});
test('mixed lines mask only the secret part', () => {
  const out = redactSecrets('idempotency_key=run:phase:step PASSWORD=hunter2 auth_scheme=bearer');
  assert.ok(out.includes('idempotency_key=run:phase:step'), out); assert.ok(out.includes('PASSWORD=***'), out); assert.ok(out.includes('auth_scheme=***'), out);
});
console.log(`${passed}/${passed + failed} passed`); process.exitCode = failed ? 1 : 0;
