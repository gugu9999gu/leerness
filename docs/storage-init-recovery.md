# Interrupted initialization and Windows publication paths

## T-0377: admit only the initial marker's known residue

A first init can stop before HARNESS_VERSION is published. Its lock directory,
owner temporary file and exclusive publication temporary then survive without a
strong workspace marker. Previously a new operation classified these files as a
foreign workspace, before the existing lock-recovery code could run.

Admission now recognizes HARNESS_VERSION's existing lock/temporary naming rules
and `.HARNESS_VERSION.publish-<pid>-<24 lowercase hex>` single-link regular files.
The latter must not be a directory, a symbolic link or a hard-linked file.
Unknown names, conflicting legacy workspaces, unsupported runtime layouts and
existing write-admission protections remain refused. Classification grants no
new approval, does not trust file contents and does not delete residue.

A retried explicit init still takes the existing state lock. Empty old locks and
proven dead same-host owners follow the existing reclamation rules; live,
foreign-host, malformed and recovery-held owners are not forcibly stolen.
Unpublished source bytes and unrelated authored files are preserved. A completed
hard-link installation is settled only by the existing dead-owner recovery.
The fresh-marker test uses real child-process kills at five points. Lock timestamps
are aged in the isolated fixture, so it checks recovery semantics, not elapsed
production waiting times. It is not power-loss durability or every init phase.

The runtime-layout regression that previously expected an initial marker temp
file to block all later operations is deliberately updated: that expectation was
the retry defect. Unknown and unsafe-name negative tests retain the boundary.

## T-0381: keep long paths within the same publisher

Windows scratch directories may exceed the ordinary directory path limit before
the project path itself looks unusually long. The scratch mkdtemp and .NET
replacement boundary use an equivalent absolute Windows namespace path when
needed. Returned scratch paths retain their ordinary spelling for source checks,
recovery receipts and callers. The recovery directory, three-attempt ENOENT bound,
metadata-preserving replacement, original-file comparison, exclusive creation,
backup retention and no-delete-before-replace behavior remain unchanged.

There is no global long-path registry change, system temporary fallback, new
storage backend or automatic recovery of an already split pair. Multi-file writes
are still not transactions; process death, permissions or another independent
publication error can leave a partial result. Preserve its recovery receipt.

The Windows-only regression covers actual init, first/repeated decisions and
lessons at project lengths 170, 190, 212 and 270, exact generated content plus
retained source suffixes, empty scratch cleanup, alternate data streams, original
backups and stale-input rejection. Skipped Linux cases are not Windows evidence.

## References

- Node path API: https://github.com/nodejs/node/blob/main/doc/api/path.md
- Microsoft path semantics: https://learn.microsoft.com/dotnet/standard/io/file-path-formats
- File.Replace: https://learn.microsoft.com/en-us/dotnet/api/system.io.file.replace?view=netframework-4.8.1

Focused commands: `node --test scripts/interrupted-init-probe.js`,
`node --test scripts/windows-long-publication-probe.js`, and the existing
runtime-layout, install-text, mutation-integrity and recovery-receipt probes.

At project length 270 the CLI is launched from the short fixture directory with
an explicit project path. The first hosted test tried to start Node with that
long cwd and failed with ENOENT before CLI execution. That failed run is retained;
it is not a successful storage test or a product fix. The 170/190/212 cases still
launch within their project. This change does not promise that Windows can start
arbitrary external processes with a working directory longer than MAX_PATH.
