'use strict';

const fs = require('fs');
const { errorLanguage } = require('./error-language');

// Explicit bounded reads for diagnostics/admission. Omitted limits preserve the
// original writer path; no environment-wide writer default is introduced here.
function readMemoryInputBytes(fd, maxBytes, file, size) {
  if (maxBytes === null) return fs.readFileSync(fd);
  // T-0337: Korean in a Korean project (lib/error-language.js); the English text everywhere else, as before.
  const limit = bytesRead => Object.assign(new Error(errorLanguage() === 'ko' ? '파일이 바이트 한도를 넘었습니다.' : 'Memory diagnostic byte limit exceeded.'),
    { code: 'E_STORE_LIMIT', file, bytesRead });
  if (size > BigInt(maxBytes)) throw limit(0);
  const buffer = Buffer.alloc(maxBytes + 1);
  let bytesRead = 0;
  while (bytesRead < buffer.length) {
    const count = fs.readSync(fd, buffer, bytesRead, buffer.length - bytesRead, bytesRead);
    if (count === 0) break;
    bytesRead += count;
  }
  if (bytesRead > maxBytes) throw limit(bytesRead);
  return Buffer.from(buffer.subarray(0, bytesRead));
}

module.exports = { readMemoryInputBytes };
