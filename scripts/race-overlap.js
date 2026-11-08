'use strict';
 
 
 
 
 
 
 
 
 
function overlapOf({ stalled, ready, reach }) {
  if (!stalled || !ready || ready.reached !== true || !reach || (!reach.read && !reach.lock)) {
    return { overlapped: false, why: 'no report while the first command was stalled' };
  }
   
  if (reach.heldUnknown) return { overlapped: false, why: "the first command's held locks could not be read" };
   
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
