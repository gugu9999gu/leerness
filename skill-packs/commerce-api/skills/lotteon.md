# Skill: LotteON API Integration

## Required env names
- `LOTTEON_CLIENT_ID`
- `LOTTEON_CLIENT_SECRET`
- `LOTTEON_SELLER_ID`

## Rules
- Keep auth refresh flow separate from business logic.
- Mask all token values in logs.
- Record only endpoint names and schema notes in harness files.

## Procedure
1. Define env config and validation.
2. Implement token acquisition/refresh module.
3. Wrap provider API with a stable internal interface.
4. Add fake fixtures for order/product sync.
