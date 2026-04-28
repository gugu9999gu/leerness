# Skill: Coupang API Integration

## Required env names
- `COUPANG_ACCESS_KEY`
- `COUPANG_SECRET_KEY`
- `COUPANG_VENDOR_ID`

## Rules
- Do not hardcode keys.
- Do not log authorization headers.
- Keep API signing logic isolated in one module.
- Use fake fixtures for tests.

## Procedure
1. Create provider config from env.
2. Implement request signing in a small tested function.
3. Build API client wrapper with timeout/retry handling.
4. Normalize external response into internal order/product schema.
5. Add troubleshooting notes to `task-log.md` after a successful integration.
