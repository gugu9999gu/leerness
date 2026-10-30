# Leerness 1.36.306 hotfix candidate

Status: release candidate; publishing to npm, tagging, and main integration require verified release gates.

## Scope

- T-0085: recognize base64 / and + inside opaque Bearer token values in the shared secret detection catalog.
- Keep the existing minimum length and all other secret patterns unchanged.
- Regression cases cover previously missed slash/plus values, existing token values, short tokens and unrelated prose in the UI-boundary scanner.

## Evidence and limits

- A synthetic five-case regex control reproduced the old false-negative and passed with the revised pattern.
- The full repository CI, public release artifact digest, registry publication and final installed-package acceptance are not asserted by this document.
- T-0084 redaction false positives and T-0101 corrupted-store handling are separate unmodified follow-ups.
- This is a public-ancestry-only branch from v1.36.305. Do not include private .leerness plans, runtime, logs, or credentials.
