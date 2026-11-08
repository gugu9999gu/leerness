# Legacy feedback oracle

`review-feedback-1.36.305.json.gz` contains the exact UTF-8 sources and SHA-256
digests of `review-feedback-contract.js`, `review-feedback.js`,
`review-feedback-report.js` and `role-fallback.js` from the published npm package
`leerness@1.36.305`. The snapshot records the archive's SHA-512 integrity from
https://registry.npmjs.org/leerness/1.36.305; that archive and all four module
sources were verified before freezing them. No private commit ID is shipped.

It is test data, not a production dependency. The test loader isolates these
modules' cache and uses the checkout's unchanged storage/runtime helpers.
The default feedback suite therefore checks the old replay and normalizer even
without network access or an installed old package, including a first-stage
continuation followed by later stages. Setting
`LEERNESS_PREVIOUS_INSTALL` to a complete old package also exercises its actual
CLI, ledger synchronization and handoff. Do not substitute a new implementation
for this oracle when extending the feedback format.
