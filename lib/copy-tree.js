'use strict';

 
 
 
 
 
 
const fs = require('fs');
const path = require('path');

function copyTreeSync(src, dst) {
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) {
    let target = fs.readlinkSync(src);
    let type;
    if (process.platform === 'win32') {
      try { type = fs.statSync(src).isDirectory() ? 'junction' : 'file'; } catch { type = 'file'; }
       
       
       
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
