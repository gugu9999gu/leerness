# Skill: Commerce Order Sync

## Procedure
1. Define sync cursor: date range, order id, or updated timestamp.
2. Fetch in pages and save checkpoints.
3. Normalize provider response into internal schema.
4. Deduplicate by provider order id.
5. Log counts, not sensitive values.
6. Add retry and dead-letter handling for failed items.
