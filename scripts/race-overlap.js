'use strict';
// T-0346: did a race's second command overlap the first command's stalled publication? Judged from the first
// command's ready file (scripts/lock-probe.js: `reached`, `resumedAt`) and the second command's report (`read`,
// `lock`), which lock-probe.js writes only after the operation ran.
//   - A lock attempt that failed with EEXIST (the stalled file's lock, or a lock the first command held when it
//     stalled) shows that the second command waited on the stalled section.
//   - A first such attempt that took the lock shows that the first command had already released it: the second
//     command's locked section ran after the publication, so it did not overlap.
//   - A command that never tried one of those locks overlapped when its read of the stalled file finished before the
//     first command resumed. The first command waits for that report, so this holds unless its wait timed out.
function overlapOf({ stalled, ready, reach }) {
  if (!stalled || !ready || ready.reached !== true || !reach || (!reach.read && !reach.lock)) {
    return { overlapped: false, why: 'no report while the first command was stalled' };
  }
  // Without the first command's held locks, a lock taken after the release could go unreported.
  if (reach.heldUnknown) return { overlapped: false, why: "the first command's held locks could not be read" };
  // Only a report that the second command closed at its exit is whole: a later rewrite may have failed.
  if (reach.complete !== true || reach.failed) return { overlapped: false, why: 'the report was not completed' };
  if (reach.lock) {
    return reach.lock.result === 'contended'
      ? { overlapped: true, why: 'a lock attempt was contended' }
      : { overlapped: false, why: 'a lock the first command held was taken without contention' };
  }
  if (typeof ready.resumedAt === 'number' && reach.read.at <= ready.resumedAt) return { overlapped: true, why: 'the read finished while stalled' };
  return { overlapped: false, why: 'the read finished after the first command resumed' };
}

module.exports = { overlapOf };
