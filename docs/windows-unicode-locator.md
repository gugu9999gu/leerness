# Windows Unicode PATH discovery

The original Windows role-store failure was reproduced as a product discovery defect, not dismissed as an invalid shim fixture.

A source-pinned Windows control compared the same trusted `System32/where.exe` lookup with `windowsHide:false` and `windowsHide:true`. In the tested Node 22 runner, hidden-console output encoded an accented filename with byte 0x82 and replaced Korean filename characters with literal question marks. Decoding that output as UTF-8 could not recover the original path. The existing PATH-containment check then rejected the damaged candidate. Named dispatch failed while the same file's absolute portable launch worked.

The correction keeps the trusted locator, shell-free invocation, hidden console and timeout/error handling. Only after the trusted locator reports success, a command or canonical PATH containing non-ASCII characters is resolved by literal Unicode filesystem candidate names. It respects canonical PATH order, the existing explicit-in-PATH cwd precedence and PATHEXT. Cwd-only executables and arbitrary locator stdout cannot add candidates. Wildcards, separators and traversal-like extensions are not expanded. Supported npm/PowerShell shims still pass through existing recognition; arbitrary shell scripts are not executed.

A locator timeout or unsuccessful status is not turned into filesystem success. The implementation does not change the user's console code page, start a shell, add provider retries, disable containment or claim to stop every descendant process. Synchronous filesystem calls are not a new hard OS deadline guarantee.

Regression: `node --test scripts/windows-locator-unicode-probe.js`, included in the existing runtime-compatibility tier. Tests cover accent/Korean/emoji/combining paths, lossy stdout, precedence, PATHEXT, cwd shadows, unsupported scripts, out-of-PATH output, wildcard and timeout behavior; real named-vs-absolute launch cases run on Windows. Existing role-store, release-runtime, Git-cache, which, environment-budget and runtime-bridge cases remain intact. Record exact sources, runs, and installed-package observations separately.
