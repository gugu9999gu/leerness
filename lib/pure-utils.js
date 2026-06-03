'use strict';

// 1.9.274 (UR-0025 1단계, GPT-5.5 리뷰): bin/harness.js 단일 대형 파일 모듈 분리 — 점진적·비파괴 시작.
//   여기에는 harness 내부 상태/다른 함수에 의존하지 않는 "순수 함수"만 추출한다 (부작용 0, 단위 테스트 대상).
//   harness.js 는 이 모듈을 require 해 동일 이름으로 사용한다. 동작 동일 — selftest 가 7종 모두 검증.

// 보안: 환경변수 키가 시크릿(TOKEN/SECRET/PASSWORD/API_KEY/PRIVATE)인지 판별.
function _isSecretKey(k) {
  return /TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE/i.test(k);
}

// semver 비교: a>b → 1, a<b → -1, 같음 → 0. (누락 파트/null 안전)
function compareVer(a, b) {
  const sa = String(a || '0').split('.').map(n => parseInt(n || '0', 10));
  const sb = String(b || '0').split('.').map(n => parseInt(n || '0', 10));
  for (let i = 0; i < 3; i++) {
    const x = sa[i] || 0, y = sb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// harness 버전 문자열 파싱: canonical "1.9.0" / legacy plus "leerness@1.8.0+plus@1.0.1" / "leerness@1.8.0".
function parseHarnessVersion(text) {
  const t = String(text || '').trim();
  const plus = t.match(/plus@(\d+\.\d+\.\d+)/);
  const baseAt = t.match(/leerness@(\d+\.\d+\.\d+)/);
  const bare = t.match(/^(\d+\.\d+\.\d+)\s*$/);
  return {
    plus: plus ? plus[1] : null,
    base: baseAt ? baseAt[1] : (bare ? bare[1] : null),
    raw: t || '(not installed)'
  };
}

// UTF-8 바이트열의 CJK 분류 (한국어/일본어/중국어/기타) — 인코딩 오인식 위험 감지용.
function _classifyCJK(buf, len) {
  let korean = 0, japanese = 0, chinese = 0, other = 0;
  for (let i = 0; i < Math.min(buf.length, len); i++) {
    const b = buf[i];
    if (b < 0x80) continue;
    if (b >= 0xEA && b <= 0xED) korean++;
    else if (b === 0xE3) japanese++;
    else if (b >= 0xE4 && b <= 0xE9) chinese++;
    else other++;
  }
  return { korean, japanese, chinese, other };
}

// CJK 분류 결과 → 위험 라벨 (Windows 코드페이지 오인식 안내).
function _riskLabel(cjk) {
  if (cjk.korean >= cjk.japanese && cjk.korean >= cjk.chinese && cjk.korean > 0) {
    return { type: 'korean', risk: 'Windows 한국어 PowerShell 에서 CP949 로 오인식 가능 (BOM 추가 권장)' };
  }
  if (cjk.japanese > cjk.korean && cjk.japanese >= cjk.chinese) {
    return { type: 'japanese', risk: 'Windows 일본어 PowerShell 에서 CP932 (Shift-JIS) 로 오인식 가능 (BOM 추가 권장)' };
  }
  if (cjk.chinese > 0) {
    return { type: 'chinese', risk: 'Windows 중국어 PowerShell 에서 CP936 (GBK) 로 오인식 가능 (BOM 추가 권장)' };
  }
  return { type: 'non-ascii', risk: 'Windows 비-ASCII 셸 스크립트 — BOM 없는 UTF-8 인코딩 오인식 가능 (BOM 추가 권장)' };
}

// OS 시스템 언어 감지 (UR-0022): POSIX env > Intl ICU locale > null.
function _detectSystemLang(env) {
  env = env || process.env;
  const raw = String(env.LC_ALL || env.LC_CTYPE || env.LANG || env.LANGUAGE || '').toLowerCase();
  if (raw && raw !== 'c' && raw !== 'posix') {
    if (/(^|[^a-z])ko([_\-.]|$)|korean|[_-]kr([_\-.]|$)/.test(raw)) return 'ko';
    if (/(^|[^a-z])en([_\-.]|$)|english|[_-](us|gb)([_\-.]|$)/.test(raw)) return 'en';
  }
  try {
    const loc = (Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase();
    const primary = loc.split('-')[0];
    if (primary === 'ko') return 'ko';
    if (primary === 'en') return 'en';
  } catch {}
  return null;
}

// CLI `--help` 출력에서 슬래시 명령/하위명령 best-effort 파싱 (UR-0021 3단계). 순수 문자열 처리.
function _parseSlashFromHelp(text, invoke = 'slash') {
  const out = [];
  const seen = new Set();
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const ln = raw.replace(/\x1b\[[0-9;]*m/g, ''); // ANSI 색상 제거
    if (invoke === 'subcommand') {
      const m = ln.match(/^\s{2,}([a-z][a-z0-9][\w-]*)\s{2,}(\S.*)$/);
      if (m && !/^--/.test(m[1])) {
        const cmd = m[1];
        if (!seen.has(cmd) && cmd.length <= 24) { seen.add(cmd); out.push({ cmd, desc: m[2].trim().slice(0, 80) }); }
      }
      continue;
    }
    const m = ln.match(/^\s*(\/[a-zA-Z][\w-]*)(?:\s+[-–:]?\s*(.*))?$/);
    if (m) {
      const cmd = m[1];
      if (!seen.has(cmd) && cmd.length <= 24) { seen.add(cmd); out.push({ cmd, desc: (m[2] || '').trim().slice(0, 80) }); }
    }
  }
  return out;
}

// 1.9.283 (UR-0025 2단계): 권한 등급(permission tiers) 순수 로직 — capabilities/policy 공유.
const PERMISSION_TIERS = ['read-only', 'safe-write', 'project-write', 'shell-read', 'shell-write', 'git-write', 'network', 'publish'];
function _tierRank(t) { const i = PERMISSION_TIERS.indexOf(String(t || '')); return i < 0 ? PERMISSION_TIERS.length : i; }
// 명령/capability → 요구 등급 (순수 매핑)
function _requiredTier(cmd) {
  const c = String(cmd || '').toLowerCase();
  if (/release\s+publish|npm\s+publish|\bpublish\b/.test(c)) return 'publish';
  if (/\bweb\b/.test(c)) return 'network';
  if (/git\s+push|sync-main/.test(c)) return 'git-write';
  if (/multi\s+--execute|dispatch\s+--write|--yolo|\bpc\b/.test(c)) return 'shell-write';
  if (/agents\s+(list|quota|bench)|--run-tests/.test(c)) return 'shell-read';
  if (/\binit\b|\badapter\b|update\s+--yes|\bmigrate\b/.test(c)) return 'project-write';
  if (/state\s+(start|record|verify|handoff)|decision|lesson|plan\s+add|task\s+add|rule\s+add/.test(c)) return 'safe-write';
  return 'read-only';
}
function _policyAllows(allowedTier, requiredTier) { return _tierRank(requiredTier) <= _tierRank(allowedTier); }

// 1.9.283: npm dist-tag 결정 (UR-0026) — latest(안정)/next(실험), 잘못된 형식은 latest.
function _resolveNpmTag(explicit, env) {
  env = env || process.env;
  const raw = String(explicit || env.LEERNESS_NPM_TAG || 'latest').trim().toLowerCase();
  return /^[a-z][a-z0-9-]{0,38}$/.test(raw) ? raw : 'latest';
}

// 1.9.283: .mcp.json 내용 (UR-0033) — leerness MCP 서버 등록.
function _mcpJsonContent() {
  return JSON.stringify({ mcpServers: { leerness: { command: 'npx', args: ['leerness', 'mcp', 'serve'] } } }, null, 2) + '\n';
}

// 1.9.283: run 레코드 빌더 (UR-0032) — GPT-5.5 권고 14필드. startedAt 주입 가능(테스트).
function _newRunRecord(opts = {}) {
  return {
    schemaVersion: 1,
    run_id: opts.run_id || null,
    task_id: opts.task_id || null,
    agent_name: opts.agent_name || null,
    model_name: opts.model_name || null,
    started_at: opts.started_at || new Date().toISOString(),
    ended_at: opts.ended_at || null,
    goal: opts.goal || '',
    files_read: Array.isArray(opts.files_read) ? opts.files_read : [],
    files_changed: Array.isArray(opts.files_changed) ? opts.files_changed : [],
    commands_run: Array.isArray(opts.commands_run) ? opts.commands_run : [],
    tests_run: Array.isArray(opts.tests_run) ? opts.tests_run : [],
    errors: Array.isArray(opts.errors) ? opts.errors : [],
    decisions: Array.isArray(opts.decisions) ? opts.decisions : [],
    verification_result: opts.verification_result || null,
    handoff_summary: opts.handoff_summary || null,
    status: opts.status || 'in-progress'
  };
}

module.exports = {
  _isSecretKey, compareVer, parseHarnessVersion,
  _classifyCJK, _riskLabel, _detectSystemLang, _parseSlashFromHelp,
  // 1.9.283 (UR-0025 2단계)
  PERMISSION_TIERS, _tierRank, _requiredTier, _policyAllows, _resolveNpmTag, _mcpJsonContent, _newRunRecord
};
