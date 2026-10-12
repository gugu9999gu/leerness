'use strict';

// T-0343: a recursive copy that does not use fs.cpSync. On Windows, Node 22.23.3's fs.cpSync ends the process
// with an access violation (exit 3221225477) when the source or the destination path has non-ASCII letters
// (measured; 18.20.8, 20.20.2, 22.11.0 and 26.3.0 copy them). A Windows user whose name is in Korean has such a
// temp directory, so the copies below the temp directory use this instead.
// Directories, regular files and symbolic links are copied. An existing destination directory is copied into (as
// fs.cpSync does); an existing file or link is never overwritten. Errors are thrown.
const fs = require('fs');
const path = require('path');

function copyTreeSync(src, dst) {
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) {
    let target = fs.readlinkSync(src);
    let type;
    if (process.platform === 'win32') {
      try { type = fs.statSync(src).isDirectory() ? 'junction' : 'file'; } catch { type = 'file'; }
      // T-0347: a junction's target must be absolute, and Node resolves a relative one against the process cwd.
      //   A relative directory link is resolved against the copy's own folder, so it still names the place it named
      //   relative to where it now is (fs.cpSync instead points it back into the source tree).
      if (type === 'junction' && !path.isAbsolute(target)) target = path.resolve(path.dirname(dst), target);
    }
    fs.symlinkSync(target, dst, type);
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) copyTreeSync(path.join(src, entry), path.join(dst, entry));
    return;
  }
  if (stat.isFile()) { fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL); return; }
  throw Object.assign(new Error(`copyTreeSync: not a file, directory or link: ${src}`), { code: 'E_COPY_UNSUPPORTED' });
}

module.exports = { copyTreeSync };
