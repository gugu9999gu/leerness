# Past fixes at completion (bugfix areas)

Local development behavior, unreleased 1.36.296 (T-0330).

`leerness bugfix receipt <T-ID> --areas "lib/orders.js,src/sync"` declares the files or folders a fix is about.
When a later task's evidence names a file inside one of those areas, `verify-claim` shows that bugfix: for one
whose task is marked done, its id, its declared root cause and the probe to re-run; the others are listed apart. This is
the "prevent" half of a corrective action: what was learned from a fix comes back when someone works on the same
code again.

## Declaring areas

- A comma-separated list of repository-relative files or folders. Whitespace around each one, line breaks and
  tabs included, is trimmed; backslashes become `/`, a leading `./` and a trailing `/` are dropped, and each area
  is kept once.
- Refused with exit 1, leaving the receipt as it was (the other fields given in the same call are not saved
  either):
  - a blank value or an empty list, such as `--areas " "` or `--areas ","` (`empty_areas`);
  - the whole repository (`.`), an absolute path or a drive letter, a `..`, `.` or empty segment, or a
    control character inside the path (`invalid_area`).

  As with every command, the usage counter in `.leerness/cache` still moves; that runtime metadata is outside
  this guarantee.
- A path that does not exist is saved as written and reported (`missingAreas` in `--json`, a warning in
  text), so a typo is visible while a fix to a deleted file can still be recorded.
- Each `--areas` replaces the stored list. `bugfix list` shows it (`areas` in `--json`).
- Areas are a declaration, like the root cause and the sibling scope: Leerness does not check that they are
  right. They are never inferred. Guessed hotspots were rejected when the receipt was designed, because files
  that change often for ordinary reasons cannot be told apart from fragile ones.

## What verify-claim shows

- The files are the repository-relative paths verify-claim reads from the task's evidence, the same list it
  checks for existence. The git diff is not used, and an absolute path or a path outside the repository is not
  compared.
- A file matches an area when it is the area or lies under it, compared by path segment: `src/sync` holds
  `src/sync/a.js` but not `src/syncer.js`. Case is ignored on Windows and macOS.
- The task's own receipt is left out. A receipt exists from `bugfix start` on, so whether its task is done comes
  from the tracker, retained history included. Only the exact status words `done`, `completed`, `verified` and
  `완료` count as done (any case, also inside one pair of brackets as older trackers wrote them, `[완료]`);
  `unverified`, `not-done` or `미완료` do not. verify-claim, `verify-claim --all`, the claims baseline, lazy
  detection, the bugfix done gate, `task fix-evidence`, session close's completion-honesty checks and
  `task export` read statuses the same way (T-0332).
  - "📚 Learned from past fixes": receipts whose task is marked done, newest first, five shown, then "… N more".
    Each shows the files that matched, the root cause (or "not recorded") and the probe, with "task marked done
    — check that it exits 0": done is the tracker's status, not proof that the probe passes.
  - "🔧 Bugfixes not known to be done": receipts whose task is not marked done (with its status), is not in the
    tracker, or sits in retained history that cannot be read ("status unknown"). They show the root cause but no
    probe line, since that probe may still fail.
- The blocks appear whatever this task's status, so the probes can be re-run before the task is declared done.
- It is advice. It never changes `ok`, `reasons` or the exit code, and it does not run the probes.
  `verify-claim --all` and `gate --claims` collect verdicts only and do not include it.
- With no declared areas, or no evidence file inside one, nothing is printed.
- `--json` always has `pastFixes: { advisory: true, readable, fixes, skipped }`. Each fix is
  `{ id, areas, files, rootCause, repro, taskStatus, status, statusNote }`, where `taskStatus` is `done`, `open`
  or `unknown`, `status` is the task's status or null, and `statusNote` is null, `not-in-tracker` or
  `history-unreadable` (then `statusError` holds the history error code, such as `history_source_changed`).
  - `readable: false` means `.leerness/bugfix-receipts.json` cannot be read; the text output says so only
    when the evidence names a file.
  - `skipped` lists receipts whose stored `areas` is malformed (for example a hand-edited string). Such a
    receipt does not make the store invalid, since the bugfix done gate reads the same store; the text
    output names the skipped ids.

## Limits

- "Done" is the tracker's status. With the bugfix done gate off (the default), a task can be marked done
  without its probe passing, so a past fix's probe can still fail; re-running it is the point.
- A receipt is joined to the tracker by its task ID only. If an ID is reused for other work (a dropped task
  updated back to life), or the receipt store and the tracker come from branches whose IDs collide, the receipt
  shows the status of whatever task holds that ID now.
- Matching compares the evidence paths as text: a moved or renamed file, or one reached through a link,
  does not match its old area. On a case-sensitive macOS volume, `Src` and `src` are different folders but
  match the same area.
- Older Leerness versions keep `areas` in the store and ignore it.
- The receipt's success lines, the `bugfix list` line and the new messages follow the project language; the
  bugfix module's other messages are still Korean in English projects. Blank values of the receipt's other
  flags (`--root-cause`, `--siblings`, `--siblings-na`, `--previous-gap`) are still ignored as before.

Run `node scripts/bugfix-areas-probe.js` (16 tests; `--match <text>` runs one, each on its own project) for the
declaration rules, the lookup, status words and unreadable history, the advice in both languages and the unchanged
verdict.
