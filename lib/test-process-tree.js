'use strict';

const cp = require('node:child_process');
const path = require('node:path');

function stopTestProcessTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    try {
      cp.spawnSync(path.join(root, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, timeout: 10000, stdio: 'ignore' });
    } catch { /* fallback to killing the direct child */ }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* child may have exited */ }
  }
  try { child.kill('SIGKILL'); } catch { /* child may have exited */ }
}

module.exports = { stopTestProcessTree };
