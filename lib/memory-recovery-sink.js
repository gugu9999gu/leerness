'use strict';

// A synchronous named-file sink. It never exposes descriptors or raw fs methods
// to the producer. Runtime recovery supplies its private primitives only after
// its existing authority check; project recovery supplies intercepted fs methods.
const path = require('path');
const fail = code => { throw Object.assign(new Error('Memory recovery sink: '+code), { code }); };
function createRecoverySink(io, dir, options) {
  const { maxChunkBytes, maxBytes = null, maxFiles = 128 } = options;
  if (!Number.isSafeInteger(maxChunkBytes) || maxChunkBytes < 1 || maxChunkBytes > 4 * 1024 * 1024) fail('E_RECOVERY_CHUNK_INVALID');
  let active = true, writing = false, totalBytes = 0;
  const files = [];
  function write(name, produce) {
    if (!active || writing) fail('E_RECOVERY_SINK_CLOSED');
    if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\0:]/.test(name)
      || name !== path.basename(name) || typeof produce !== 'function') fail('E_RECOVERY_BUNDLE_INVALID');
    if (files.length >= maxFiles) fail('E_RECOVERY_BUNDLE_INVALID');
    const item = { name, created: false, bytesWritten: 0, complete: false };
    files.push(item);writing = true;
    let fd = null, producerActive = false, failure = null;
    const chunk = bytes => {
      if (!active || !producerActive) fail('E_RECOVERY_SINK_CLOSED');
      if (!Buffer.isBuffer(bytes) || bytes.length > maxChunkBytes) fail('E_RECOVERY_CHUNK_INVALID');
      if (maxBytes !== null && totalBytes + bytes.length > maxBytes) fail('E_RECOVERY_BUNDLE_TOO_LARGE');
      let offset = 0;
      while (offset < bytes.length) {
        const n = io.writeSync(fd,bytes,offset,bytes.length-offset,null);
        if (!Number.isSafeInteger(n) || n <= 0 || n > bytes.length-offset) fail('E_RECOVERY_WRITE_STALLED');
        offset += n;totalBytes += n;item.bytesWritten += n;
      }
    };
    try {
      fd = io.openSync(path.join(dir,name),'wx',0o600);item.created = true;producerActive = true;
      const result = produce(chunk);
      producerActive = false;
      if (result && typeof result.then === 'function') fail('E_RECOVERY_BUNDLE_INVALID');
      if (io.fsyncSync) io.fsyncSync(fd);
      item.complete = true;
      return item.bytesWritten;
    } catch (error) { failure = error;item.error = error.code || 'write_failed';throw error; }
    finally {
      producerActive = false;writing = false;
      if (fd !== null) {
        try { io.closeSync(fd); }
        catch (error) {
          item.complete = false;item.closeError = error.code || 'close_failed';
          if (!failure) {item.error = item.closeError;throw error;}
        }
      }
    }
  }
  return { write, close: () => { active = false; },
    snapshot: () => ({ bytesWritten: totalBytes, files: files.map(item => ({ ...item })) }) };
}
module.exports = { createRecoverySink };
