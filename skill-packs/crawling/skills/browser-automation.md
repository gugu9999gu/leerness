# Skill: Browser Automation

## Rules
- Prefer official APIs when available.
- Respect site terms, robots restrictions, and rate limits.
- Do not store cookies, passwords, or session tokens in `.harness/`.
- Keep selectors stable and add screenshots on failure.

## Procedure
1. Identify whether API exists.
2. Define login/session handling using runtime secrets.
3. Use robust selectors and explicit waits.
4. Add retry, timeout, and failure screenshot capture.
5. Keep downloaded files in a controlled output path.
