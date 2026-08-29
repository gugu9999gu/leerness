// lib/shell-encoding.js — shared precondition + atomic mutation for UTF-8 BOM fixes.
'use strict';

const fs = require('fs');
const path = require('path');
const { writeBufferIfUnchanged } = require('./io');

const UTF8_BOM = Buffer.from([0xEF, 0xBB, 0xBF]);

function _validUtf8(buf) {
  return Buffer.from(buf.toString('utf8'), 'utf8').equals(buf);
}

function _validCp949(buf) {
  let decoder;
  try {
    // WHATWG euc-kr is the Windows-compatible unified Korean decoder. Node 18+
    // normally ships it through ICU. Small-ICU/custom builds may not expose the
    // decoder at all; that is "unknown", not proof that the bytes are invalid
    // CP949. `fatal` matters because replacement characters would turn arbitrary
    // bytes into false encoding provenance.
    decoder = new TextDecoder('euc-kr', { fatal: true });
  } catch {
    return null;
  }
  try {
    decoder.decode(buf);
    return true;
  } catch {
    return false;
  }
}

// Detection and mutation are deliberately joined at the final write boundary:
// callers may act on a scan result that is already stale. Re-read the current
// bytes and re-check every destructive precondition immediately before writing.
function planShellScriptUtf8Bom(file, input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const ext = path.extname(String(file || '')).toLowerCase();
  if (buf.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) {
    if (!_validUtf8(buf.subarray(UTF8_BOM.length))) {
      return { action: 'skipped-invalid-bom-body (UTF-8 BOM 뒤 본문이 유효한 UTF-8이 아님 — 기존 손상 가능성, 수동 복구 필요)' };
    }
    return { action: 'skipped-existing-bom' };
  }
  const shebang = buf.length >= 2 && buf[0] === 0x23 && buf[1] === 0x21;
  if (ext === '.sh' || shebang) {
    return { action: 'skipped-shebang (BOM은 shebang을 깨뜨림 — .sh는 no-BOM UTF-8 유지)' };
  }
  if (ext === '.bat' || ext === '.cmd') {
    return { action: 'skipped-batch (cmd.exe: 첫 줄에 chcp 65001 추가가 정답 — BOM은 코드페이지를 안 바꿈)' };
  }
  if (ext !== '.ps1') {
    return { action: 'skipped-unsupported (자동 BOM 적용 대상은 .ps1만 지원)' };
  }
  if (!buf.some((byte) => byte >= 0x80)) {
    return { action: 'skipped-ascii (비-ASCII 인코딩 위험 없음)' };
  }
  if (!_validUtf8(buf)) {
    return { action: 'skipped-nonutf8 (본문이 비-UTF-8(CP949 등) — BOM 추가는 손상. UTF-8 로 먼저 transcode 필요)' };
  }
  const cp949Validity = _validCp949(buf);
  if (cp949Validity !== false) {
    return { action: cp949Validity === true
      ? 'skipped-ambiguous-encoding (UTF-8과 CP949 모두로 유효하지만 의미가 다를 수 있음 — 명시적 transcode 후 재시도)'
      : 'skipped-ambiguous-encoding (CP949 decoder unavailable — 레거시 인코딩이 아님을 증명할 수 없어 자동 수정 거부)' };
  }
  return { action: 'utf8-bom-added', bytes: Buffer.concat([UTF8_BOM, buf]) };
}

function scanShellScriptsEncoding(root, opts = {}) {
  const classifyCJK = typeof opts.classifyCJK === 'function'
    ? opts.classifyCJK : () => ({ korean: 0, japanese: 0, chinese: 0, other: 0 });
  const riskLabel = typeof opts.riskLabel === 'function'
    ? opts.riskLabel : () => ({ type: 'non-ascii', risk: 'BOM 없는 비-ASCII 셸 스크립트' });
  const result = { scanned: 0, atRisk: [], scanErrors: [], notes: [] };
  const scanError = (operation, fp, e) => result.scanErrors.push({
    operation,
    file: path.relative(root, fp) || '.',
    code: e && e.code ? e.code : 'error',
    error: e && e.message ? e.message : String(e),
  });
  function walk(dir, depth = 0) {
    if (depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { scanError('readdir', dir, e); return; }
    for (const entry of entries) {
      const fp = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (/^(node_modules|\.git|__pycache__|venv|\.venv|dist|build)$/.test(entry.name)) continue;
        walk(fp, depth + 1);
        continue;
      }
      if (!entry.isFile() || !/\.(ps1|bat|cmd|sh)$/i.test(entry.name)) continue;
      try {
        const buf = fs.readFileSync(fp);
        result.scanned++;
        const hasBOM = buf.subarray(0, UTF8_BOM.length).equals(UTF8_BOM);
        const plan = planShellScriptUtf8Bom(fp, buf);
        let nonAscii = false;
        for (let i = hasBOM ? UTF8_BOM.length : 0; i < Math.min(buf.length, 4096); i++) {
          if (buf[i] >= 0x80) { nonAscii = true; break; }
        }
        const invalidBomBody = plan.action.startsWith('skipped-invalid-bom-body');
        if ((!hasBOM && nonAscii) || invalidBomBody) {
          const cjk = classifyCJK(buf, 4096);
          const label = riskLabel(cjk);
          result.atRisk.push({
            file: path.relative(root, fp),
            ext: path.extname(fp),
            hasBOM,
            nonAscii: true,
            riskType: invalidBomBody ? 'invalid-bom-body' : label.type,
            cjk,
            risk: invalidBomBody
              ? 'UTF-8 BOM 뒤 본문이 유효한 UTF-8이 아님 — 기존 손상 가능성, 수동 복구 필요'
              : label.risk,
            fixAction: plan.action,
          });
        }
      } catch (e) {
        scanError('read', fp, e);
      }
    }
  }
  walk(root);
  if (result.atRisk.length > 0) {
    result.notes.push('해결: 인코딩 출처가 명확한 .ps1만 UTF-8로 transcode 후 BOM을 추가. UTF-8/CP949 양쪽으로 유효한 본문은 자동 수정하지 않음');
  }
  if (result.scanErrors.length > 0) result.notes.push('읽지 못한 경로가 있어 검사가 불완전함 — 권한/잠금을 해결한 뒤 다시 실행');
  result.riskTypeCounts = result.atRisk.reduce((m, r) => {
    m[r.riskType] = (m[r.riskType] || 0) + 1;
    return m;
  }, {});
  return result;
}

function applyShellScriptUtf8Bom(fullPath, displayFile = fullPath) {
  const linkStat = fs.lstatSync(fullPath);
  if (linkStat.isSymbolicLink()) return { file: displayFile, action: 'skipped-symlink (링크 대상을 자동 교체하지 않음)' };
  if (!linkStat.isFile()) return { file: displayFile, action: 'skipped-nonfile (일반 파일만 자동 교체)' };
  if (linkStat.nlink > 1) return { file: displayFile, action: 'skipped-multiple-links (하드링크 별칭 불일치 방지)' };
  const original = fs.readFileSync(fullPath);
  const afterRead = fs.lstatSync(fullPath);
  if (afterRead.isSymbolicLink() || afterRead.dev !== linkStat.dev || afterRead.ino !== linkStat.ino
      || afterRead.nlink !== 1 || afterRead.mode !== linkStat.mode) {
    const e = new Error(`읽는 동안 파일 정체성/링크/권한이 변경되어 자동 수정을 거부했습니다: ${displayFile}`);
    e.code = 'E_CONCURRENT_MODIFICATION';
    throw e;
  }
  const plan = planShellScriptUtf8Bom(fullPath, original);
  if (plan.action !== 'utf8-bom-added') return { file: displayFile, action: plan.action };
  // BOM is a Windows PowerShell compatibility repair. On POSIX, replacing an
  // inode atomically with Node cannot retain arbitrary ACLs/xattrs/ownership;
  // fail closed instead of claiming a safe repair while discarding metadata.
  if (process.platform !== 'win32') return { file: displayFile, action: 'skipped-platform (Windows 메타데이터 보존 교체만 지원)' };
  // Writability is a mutation precondition, not a scan/skip precondition. A
  // read-only .sh or a POSIX .ps1 is still a successful byte-exact no-op.
  if ((linkStat.mode & 0o222) === 0) {
    const e = new Error(`읽기 전용 파일은 자동 수정하지 않습니다: ${displayFile}`);
    e.code = 'E_READ_ONLY';
    throw e;
  }
  const written = writeBufferIfUnchanged(fullPath, original, plan.bytes, {
    expectedIdentity: { dev: linkStat.dev, ino: linkStat.ino, nlink: linkStat.nlink, mode: linkStat.mode },
  });
  return {
    file: displayFile,
    action: plan.action,
    ...(written && written.backupFile ? { backupFile: written.backupFile } : {}),
    ...(written && written.recoveryArtifacts ? { recoveryArtifacts: written.recoveryArtifacts } : {}),
  };
}

module.exports = { planShellScriptUtf8Bom, scanShellScriptsEncoding, applyShellScriptUtf8Bom };
