# Skill: Firebase Functions Deploy

## Rules
- Check runtime version and function generation before deploy.
- Keep region, memory, timeout, and invoker settings explicit.
- Avoid broad public invoker unless required.

## Procedure
1. Inspect `firebase.json`, `.firebaserc`, and functions package.
2. Validate environment variables and secrets.
3. Build and test locally when possible.
4. Deploy targeted functions first for risky changes.
5. Record deploy result in `task-log.md`.
