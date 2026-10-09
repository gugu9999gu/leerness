# GitHub account login adapter

`require('leerness/lib/github-login').createGitHubLogin(configJson, clientSecret)` implements server-side GitHub.com OAuth authorization-code login. It returns a frozen client with `begin`, `finish`, `readIdentity`, `cancel`, `invalidate` and `close` methods. No CLI command, browser listener, cookie middleware or hosted service is installed.

The trusted host supplies this JSON configuration from protected configuration, never from a review candidate or incoming HTTP request:

```json
{
  "clientId": "registered-oauth-app-id",
  "redirectUri": "https://your-host.example/login/github/callback",
  "allowedAccountIds": ["123456"],
  "timeoutMs": 5000
}
```

Use a dedicated registered OAuth app and supply its secret directly from the host's secret manager. No environment variable, Git credential, developer `gh` session or repository configuration is searched for credentials. Secrets must not be included in CLI arguments or committed configuration. The callback must be canonical HTTPS, or HTTP on literal `127.0.0.1`/`[::1]` for a local host; queries, fragments and embedded credentials are disallowed. Unknown configuration fields are rejected. `timeoutMs` is optional, 100–15000 per HTTP request. Account IDs are unique positive safe-integer decimal strings, maximum 128 entries; login names are not authorization identifiers. Changing the allowlist requires closing the old client and creating a new one.

## Integration contract

1. The host calls `client.begin()`. Keep the returned opaque object in the initiating browser's protected server session and redirect that browser to `handle.authorizationUrl`. Each request contains random state and PKCE S256, an explicit empty scope and an account picker. The handle expires after five minutes. Do not log the authorization URL or use a global state-to-handle lookup in place of browser-session binding.
2. On the registered callback, retrieve that same handle from the same browser session, then call `await client.finish(handle, absoluteCallbackUrl)`. Build the absolute URL from the configured origin, not untrusted forwarded/Host headers. Apply secure session cookies, login-CSRF protections, callback log redaction and appropriate rate limits in the host. The adapter checks the callback path/origin and state; it cannot verify cookies or the browser connection itself.
3. `finish` consumes the attempt before network work. Any error requires a fresh login attempt; automatic retry, duplicate callback and copied/deserialized handles are rejected. It POSTs once to `https://github.com/login/oauth/access_token` and then GETs once from `https://api.github.com/user` using the returned token. Both hops validate TLS and reject redirects, excessive bodies, malformed UTF-8/JSON, duplicate JSON keys and non-200 statuses. Total network work is at most two request deadlines and remains bounded by the login expiry. Returned token scopes must be empty; previously granted broad scopes produce `github_token_invalid`. Use a dedicated minimal-scope app or have the user review its grants before trying again.
4. An allowed `type=User` response produces an opaque identity session. `session.identity` contains only `{host: "github.com", accountId, login}`. GitHub's numeric ID determines allowlist membership; a renamed login remains the same identity. Bot/organization identities and unknown IDs are rejected. Private profile data, access/refresh tokens, authorization codes and verifier are not included in the result or persisted. Dropping JavaScript references is not a guarantee of cryptographic memory erasure. The adapter does not refresh or remotely revoke issued GitHub tokens.
5. Before using an identity, call `client.readIdentity(session)`. This checks that the exact result came from this client, was not invalidated and has not expired. The local identity lasts at most two minutes and never beyond the original login deadline. `invalidate(session)` ends it locally. `cancel(handle)` cancels an attempt not yet submitted; `close()` invalidates all handles and sessions, including outstanding completions. There is no process-restart persistence. A saved JSON copy is display data, never an authentication credential.

The returned identity sets `actorIdentityVerified: true` and `accountAllowed: true` only within this protected-host contract. GitHub proves control of an account, not a civil identity, a new password/MFA challenge, independent review or consent to a particular target. Cached identity does not observe remote revocation immediately; the host must invalidate it when appropriate and request a new login for fresh authentication. Trusted host code, configuration, system clock, TLS trust roots and browser-session handling are required.

## Approval remains separate

`approvalGranted`, `acceptedAuthorityVerified`, `semanticVerified` and `cleanupAllowed` remain false. The adapter does not sign an approval proof or call `host.consume`. Next integration must present the exact review target, capture explicit consent from the same protected browser session, recheck current policy/identity/target, and bind those facts to the signed approval record. Never treat `accountAllowed` or OAuth consent as target approval.

No actual GitHub app registration or live browser login was performed as part of the offline tests. A production host must register the app and callback, configure its secret and allowed IDs, implement the browser session/listener, and test the real flow before claiming it deployed.

## Verification and references

`node scripts/github-login-probe.js` runs real loopback TLS integration tests using an ephemeral certificate. It does not contact GitHub or use real accounts. The shipped adapter has no endpoint/trust-root/transport override; the probe interception is confined to its own process. The PC development workflow runs the same probe.

[GitHub OAuth authorization, state and PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) and [authenticated user endpoint](https://docs.github.com/en/rest/users/users#get-the-authenticated-user), checked 2026-09-16. The user request uses API version `2026-03-10`. Scope-free OAuth tokens authenticate the owner and provide the public user fields needed here.
