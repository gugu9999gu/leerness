// lib/analyzers.js — 순수 분석/검증 함수 (부작용 0, 입력→출력).
// 1.9.304 (UR-0025): bin/harness.js 에서 비파괴 분리. selftest(evidenceQuality/parseEvidenceStats/shellGuardAnalyze/claimFileInGit)가 동작 검증.
'use strict';

function _shellGuardAnalyze(cmd, ctx) {
  const c = String(cmd || '');
  const shell = (ctx && ctx.shell) || 'unknown';
  const psVer = ctx && ctx.psVersion != null ? parseInt(ctx.psVersion, 10) : null;
  const issues = [];
  const isWinPowerShell = shell === 'powershell' && psVer != null && psVer < 6;  // 5.1 = Windows PowerShell
  // 규칙 1: PowerShell 5.1 에서 && / || 체이닝 미지원 (pwsh 7+ 부터 지원)
  if (isWinPowerShell && /\s&&\s|\s\|\|\s/.test(c)) {
    issues.push({ rule: 'ps5-chain', severity: 'error', detail: 'Windows PowerShell 5.1 은 && / || 연산자를 지원하지 않습니다 (PowerShell 7+ 부터 지원).', suggestion: 'A; if ($?) { B }  (조건부) 또는 A; B  (무조건) 로 분리. 또는 pwsh 7 설치.' });
  }
  // 규칙 2: PowerShell 에서 2>/dev/null → 2>$null
  if (shell === 'powershell' && /2>\s*\/dev\/null/.test(c)) {
    issues.push({ rule: 'ps-devnull', severity: 'error', detail: 'PowerShell 은 /dev/null 경로가 없습니다.', suggestion: '2>$null 사용 (PowerShell 리다이렉트).' });
  }
  // 규칙 3: PowerShell 에서 inline env (VAR=val cmd) 미지원
  if (shell === 'powershell' && /^[A-Z_][A-Z0-9_]*=[^\s]+\s+\S/.test(c.trim())) {
    issues.push({ rule: 'ps-inline-env', severity: 'error', detail: 'PowerShell 은 VAR=val cmd 형식의 inline 환경변수를 지원하지 않습니다.', suggestion: "$env:VAR='val'; cmd  로 분리." });
  }
  // 규칙 4: PowerShell 에서 Unix 전용 명령 (rm -rf / ls -la 등) — 별칭은 되나 플래그 오류 가능
  if (shell === 'powershell' && /\brm\s+-rf\b/.test(c)) {
    issues.push({ rule: 'ps-rm-rf', severity: 'warn', detail: 'PowerShell 에서 rm -rf 는 -rf 플래그 파싱 오류 가능 (rm 은 Remove-Item 별칭).', suggestion: 'Remove-Item -Recurse -Force <path> 사용.' });
  }
  // 규칙 5: CMD 에서 ; 는 명령 구분자가 아님 (한 줄로 실행됨)
  if (shell === 'cmd' && /;/.test(c) && !/&&|\|\|/.test(c)) {
    issues.push({ rule: 'cmd-semicolon', severity: 'warn', detail: 'CMD 는 ; 를 명령 구분자로 처리하지 않습니다 (인자로 전달됨).', suggestion: 'A && B  (조건부) 또는 A & B  (무조건) 사용.' });
  }
  // 규칙 6: PowerShell 에서 && 가 있으나 버전 미상 — 정보성
  if (shell === 'powershell' && psVer == null && /\s&&\s/.test(c)) {
    issues.push({ rule: 'ps-version-unknown', severity: 'info', detail: 'PowerShell 버전 미상 — 5.1 이면 && 미지원, 7+ 이면 지원.', suggestion: '$PSVersionTable.PSVersion 확인. 안전하게 A; if ($?) { B } 권장.' });
  }
  return { shell, psVersion: psVer, issues };
}
function _evidenceQuality(evidence) {
  const e = String(evidence || '');
  const hasFile = /(?:[A-Za-z][\w-]*[\/\\])?[A-Za-z][\w./\\-]*\.(?:js|ts|tsx|jsx|mjs|cjs|py|go|rs|rb|kt|cs|gd|java|php|swift|c|cpp|h|html|css|scss|vue|svelte|json|yaml|yml|toml|md|sql|sh)\b/i.test(e);
  const hasTest = /(\d+)\s*(?:\/\s*\d+\s*)?(?:통과|passed|passing|개\s*테스트)|\btests?\b\s*[:=]?\s*\d|Tests?:\s*\d|\b\d+\s*tests?\b/i.test(e);
  const hasLog = /Exit\s*[:=]|exit\s*code|Command\s*[:=]|npm\s+(?:test|run)|pytest|cargo\s+test|go\s+test/i.test(e);
  const missing = [];
  if (!hasFile) missing.push('수정 파일 경로');
  if (!hasTest) missing.push('테스트명/개수');
  if (!hasLog) missing.push('실행 로그(Command/Exit)');
  return { hasFile, hasTest, hasLog, ok: hasFile && hasTest, missing };
}
function _claimFileInGit(claimed, gitSet) {
  if (!gitSet) return null;
  const c = String(claimed).replace(/\\/g, '/').replace(/^\.\//, '');
  for (const g of gitSet) { if (g === c || g.endsWith('/' + c) || c.endsWith('/' + g)) return true; }
  return false;
}
function _parseEvidenceStats(text) {
  const t = String(text || '');
  const blocks = t.split(/\n(?=## )/).filter(b => /Command:|Exit:|verify|test/i.test(b));
  let pass = 0, fail = 0;
  for (const b of blocks) {
    const exitM = b.match(/Exit:\s*(-?\d+)/i);
    if (exitM) { (parseInt(exitM[1], 10) === 0 ? pass++ : fail++); continue; }
    if (/\bPASS\b|통과|성공|✓/i.test(b)) pass++;
    else if (/\bFAIL\b|실패|오류|error|✗/i.test(b)) fail++;
  }
  const entries = blocks.length;
  return { entries, pass, fail, rate: (pass + fail) ? Math.round(pass / (pass + fail) * 100) : null };
}

module.exports = { _evidenceQuality, _parseEvidenceStats, _shellGuardAnalyze, _claimFileInGit };
