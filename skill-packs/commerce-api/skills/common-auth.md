# Skill: Commerce API Common Auth

## Sensitive data policy
Do not write access keys, secret keys, refresh tokens, passwords, cookies, or bearer tokens into `.harness/`.
Only record variable names and where the runtime should read them.

## Required pattern
- Local development: `.env.local`
- CI/CD: GitHub Actions Secrets or provider secret manager
- Server runtime: cloud environment variables or secret manager

## Standard variables
- `COMMERCE_API_BASE_URL`
- `COMMERCE_API_TIMEOUT_MS`
- Provider-specific credentials such as `COUPANG_ACCESS_KEY` or `LOTTEON_CLIENT_SECRET`

## Procedure
1. Read provider documentation before coding.
2. Create a typed config loader that validates required env names.
3. Centralize signing/auth header creation.
4. Mask sensitive values in logs.
5. Store request/response examples with fake data only.
