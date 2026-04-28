# Skill: SmartStore API Integration

## Required env names
- `SMARTSTORE_CLIENT_ID`
- `SMARTSTORE_CLIENT_SECRET`
- `SMARTSTORE_ACCOUNT_ID`

## Rules
- Keep account identifiers configurable.
- Separate provider DTOs from internal DTOs.
- Never store API credentials in `.harness/`.

## Procedure
1. Create provider config schema.
2. Implement token/auth flow.
3. Build order/product sync functions.
4. Validate pagination and rate limits.
