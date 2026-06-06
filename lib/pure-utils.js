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
  const A = String(a || '0'), B = String(b || '0');
  const sa = A.split('-')[0].split('.').map(n => parseInt(n || '0', 10));
  const sb = B.split('-')[0].split('.').map(n => parseInt(n || '0', 10));
  for (let i = 0; i < 3; i++) {
    const x = sa[i] || 0, y = sb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  // 1.9.354 (UR-0072 외부리뷰): 숫자 동일 시 pre-release(-beta/-next 등) < 정식 (semver 규칙). 이전: -beta 무시 → 동일 취급.
  const preA = A.includes('-'), preB = B.includes('-');
  if (preA && !preB) return -1;
  if (!preA && preB) return 1;
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
  let korean = 0, japanese = 0, chinese = 0, other = 0, han = 0;
  for (let i = 0; i < Math.min(buf.length, len); i++) {
    const b = buf[i];
    if (b < 0x80) continue;
    if (b >= 0xEA && b <= 0xED) korean++;
    else if (b === 0xE3) japanese++;          // kana/기호 (U+3000-3FFF) — 일본어 강한 신호
    else if (b >= 0xE4 && b <= 0xE9) han++;    // CJK 통합 한자 — 한·중·일 공유라 모호
    else other++;
  }
  // 1.9.354 (UR-0072 외부리뷰): 한자는 한·중·일 공유라 lead byte 만으로 판별 불가 → kana 가 있으면 일본어, 없으면 중국어로 귀속(휴리스틱). advisory 라벨 일본어 오판 완화.
  if (japanese > 0) japanese += han; else chinese += han;
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

// 1.9.318 (UR-0025): 순수 HTML 파싱 유틸 (api-skill 문서 수집용) — fs/네트워크 의존 0, URL/regex 만 사용.
function _htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|h[1-6]|tr|td|pre)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}
function _extractTitle(html) {
  const m = (html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  return _htmlToText(m[1]).slice(0, 200);
}
function _extractLinks(html, baseUrl, maxLinks) {
  if (!html) return [];
  const base = new URL(baseUrl);
  const found = new Map();
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
    let abs;
    try { abs = new URL(href, baseUrl).toString(); } catch { continue; }
    const u = new URL(abs);
    if (u.hostname !== base.hostname) continue; // same-domain only
    if (abs === baseUrl) continue;
    if (found.has(abs)) continue;
    const text = _htmlToText(m[2]).slice(0, 120);
    found.set(abs, { url: abs, text });
    if (found.size >= (maxLinks || 10)) break;
  }
  return Array.from(found.values());
}

// 1.9.324 (UR-0025): 순수 메모리 MD 파서 — 코드펜스(```md 템플릿 예시) 제거 후 날짜 블록(### YYYY-MM-DD) 카운트/추출.
//   count drift(템플릿 오집계) 방지의 단일 진실소스. decisions/lessons 카운터가 공유.
function _countDatedBlocks(text) {
  const cleaned = String(text || '').replace(/^```[^\n]*\n[\s\S]*?\n```\s*$/gm, '');  // 코드펜스(템플릿) 제거
  return (cleaned.match(/^### \d{4}-\d{2}-\d{2}/gm) || []).length;
}
function _extractDecisionBlocks(text) {
  // 줄 시작의 ```부터 줄 시작의 ```까지를 코드블록으로 인식 (인라인 백틱 무시)
  const cleaned = String(text || '').replace(/^```[^\n]*\n[\s\S]*?\n```\s*$/gm, '');
  return cleaned.split(/\n(?=### )/).filter(b =>
    b.startsWith('### ') && !/^### (Template|템플릿)\b/.test(b.trim())
  );
}

// 1.9.325 (UR-0025): 순수 intent 분류 — 사용자 텍스트의 precise/broad 신호로 의도 추정 (fs/상태 의존 0).
function _classifyIntent(text) {
  if (!text || typeof text !== 'string') return { intent: 'default', signals: [] };
  const signals = [];
  // precise 신호: "정확히 / 그것만 / 그대로 / only / just / 만"
  const preciseKws = ['정확히', '그것만', '그대로', 'only', 'just only', '말한대로', '말한 그대로'];
  for (const kw of preciseKws) {
    if (text.toLowerCase().includes(kw.toLowerCase())) signals.push({ kind: 'precise', match: kw });
  }
  // broad 신호: "기본 / 포괄적 / 등등 / 다양한 / 전체 / 기본적인 / etc / overall"
  const broadKws = ['기본', '포괄적', '등등', '다양한', '전체', '기본적인', 'etc', 'overall', '필요한', '관련', 'comprehensive', 'including'];
  for (const kw of broadKws) {
    if (text.toLowerCase().includes(kw.toLowerCase())) signals.push({ kind: 'broad', match: kw });
  }
  const preciseCount = signals.filter(s => s.kind === 'precise').length;
  const broadCount = signals.filter(s => s.kind === 'broad').length;
  let intent;
  if (preciseCount > broadCount && preciseCount >= 1) intent = 'precise';
  else if (broadCount >= 1) intent = 'broad';
  else intent = 'default';
  return { intent, signals, preciseCount, broadCount };
}

// 1.9.326 (UR-0025): 순수 문자열/셸/env 유틸.
// 코드펜스(```) 중립화 — 임베딩 텍스트가 외부 마크다운을 깨지 않게. (``` → ''', 인라인 백틱 보존)
function _sanitizeFences(s) { return String(s || '').replace(/```+/g, "'''"); }
// shell:true spawn 인자 셸-안전 인용 — POSIX(sh) single-quote / Windows(cmd) double-quote + inner " 이스케이프.
function _shellQuoteArg(s) {
  s = String(s == null ? '' : s);
  if (process.platform === 'win32') return '"' + s.replace(/"/g, '""') + '"';
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
// Windows PowerShell 실행 env 감지 — pwsh 6/7 신뢰 마커(POWERSHELL_DISTRIBUTION_CHANNEL / pwsh 전용 경로)만 판별(ps5.1 자동판별 안 함).
function _detectPwshFromEnv(e) {
  e = e || process.env;
  const channel = e.POWERSHELL_DISTRIBUTION_CHANNEL || '';
  const pmp = e.PSModulePath || '';
  if (channel || /[\\/]PowerShell[\\/][67][\\/]/i.test(pmp) || /Documents[\\/]+PowerShell[\\/]/i.test(pmp)) {
    return { isPowerShell: true, version: '7', edition: 'Core' };
  }
  return { isPowerShell: false, version: null, edition: null };
}

// 1.9.327 (UR-0025): 순수 TZ/날짜 포맷 — ISO UTC 저장 유지, 표시 시 local 변환 (env LEERNESS_TZ / 시스템 tz / Asia/Seoul fallback).
function _getLocalTz() {
  if (process.env.LEERNESS_TZ) return process.env.LEERNESS_TZ;
  try {
    const sys = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (sys && sys !== 'UTC') return sys;
  } catch {}
  return 'Asia/Seoul';
}
function _formatLocal(iso, opts) {
  if (!iso) return '?';
  opts = opts || {};
  const tz = opts.tz || _getLocalTz();
  try {
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    if (isNaN(d.getTime())) return String(iso);
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false
    });
    const parts = fmt.formatToParts(d);
    const get = (t) => (parts.find(p => p.type === t) || {}).value || '';
    const date = `${get('year')}-${get('month')}-${get('day')}`;
    const time = `${get('hour')}:${get('minute')}`;
    const tzShort = tz === 'Asia/Seoul' ? 'KST' : tz === 'Asia/Tokyo' ? 'JST' : tz === 'UTC' ? 'UTC' : tz.split('/').pop().slice(0, 3);
    return opts.dateOnly ? date : `${date} ${time} ${tzShort}`;
  } catch { return String(iso); }
}

// 1.9.328 (UR-0025): 순수 문자열 유틸 — 절단(말줄임표) / 콤마 리스트 분할.
function _truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function _splitList(v) { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }

// 1.9.329 (UR-0025): 순수 roadmap MD 파서 — 상태 정규화 / 마일스톤·토큰 추출 (fs 의존 0).
function _roadmapMapStatus(s) {
  s = String(s || '').toLowerCase();
  if (s === 'done' || s === 'in-progress' || s === 'on-hold' || s === 'waiting' || s === 'incomplete' || s === 'blocked' || s === 'dropped') return s;
  if (s === 'planned' || s === 'requested') return 'planned';
  return 'planned';
}
function _roadmapParseMilestones(text) {
  const s = String(text || '');
  const out = [];
  // 1.9.352 (UR-0068 외부리뷰): 다음 milestone 직전까지 block 한정 — 이전 구현은 slice(m.index) 로 다음 milestone 의 Status/Progress 를 누출했음
  const matches = [...s.matchAll(/^### (M-\d{4})\.\s*(.+?)$/gm)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].index : s.length;
    const block = s.slice(m.index, end);
    const sm = block.match(/^Status:\s*(\S+)/m);
    const pm = block.match(/^Progress:\s*(\d+)%/m);
    out.push({ id: m[1], title: m[2].trim(), status: sm ? sm[1] : 'planned', progress: pm ? parseInt(pm[1], 10) : 0 });
  }
  return out;
}
function _roadmapParseTokens(text) {
  const tokens = {};
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\|\s*([\w.\-]+)\s*\|\s*([^|]+?)\s*\|/);
    if (!m) continue;
    const key = m[1].trim(), val = m[2].trim();
    if (!key || !val || key === 'Token' || /^-+$/.test(key) || val === 'Value' || /\(실제 값으로 업데이트\)/.test(val)) continue;
    if (val.length > 80) continue;
    tokens[key] = val;
  }
  return tokens;
}

// 1.9.330 (UR-0025): project-brief 필드 config(순수 데이터) + 채움 카운트 derivation.
const _BRIEF_FIELDS = [
  { key: 'intro', h: 'Intro', label: '소개', flag: 'intro', multi: false },
  { key: 'purpose', h: 'Purpose', label: '목적', flag: 'purpose', multi: false },
  { key: 'problem', h: 'Problem', label: '해결 문제', flag: 'problem', multi: false },
  { key: 'features', h: 'Features', label: '핵심 기능', flag: 'features', multi: true },
  { key: 'stack', h: 'Tech Stack', label: '기술 스택', flag: 'stack', multi: true },
  { key: 'architecture', h: 'Architecture', label: '아키텍처', flag: 'architecture', multi: false },
  { key: 'users', h: 'Users', label: '사용자', flag: 'users', multi: true },
  { key: 'success', h: 'Success Criteria', label: '성공 기준', flag: 'success', multi: true },
  { key: 'nonGoals', h: 'Non-Goals', label: '비목표', flag: 'non-goals', multi: true },
  { key: 'currentState', h: 'Current State', label: '현재 상태', flag: 'current-state', multi: false },
];
function _briefFilled(brief) { return _BRIEF_FIELDS.filter(f => (f.multi ? (brief[f.key] && brief[f.key].length) : brief[f.key])).length; }
// 1.9.331 (UR-0025): project-brief 텍스트 빌더 (순수) — README 개요 블록 / 복사용 청사진. VERSION 은 인자로 주입.
const BRIEF_START = '<!-- leerness:project-brief:start -->';
const BRIEF_END = '<!-- leerness:project-brief:end -->';
function _briefReadmeBlock(brief) {
  const L = [BRIEF_START, '## 프로젝트 개요', ''];
  if (brief.intro) L.push(brief.intro, '');
  if (brief.purpose) L.push(`**목적**: ${brief.purpose}`, '');
  if (brief.problem) L.push(`**해결 문제**: ${brief.problem}`, '');
  if (brief.features && brief.features.length) { L.push('**핵심 기능**'); brief.features.forEach(x => L.push(`- ${x}`)); L.push(''); }
  if (brief.stack && brief.stack.length) L.push(`**기술 스택**: ${brief.stack.join(', ')}`, '');
  if (brief.directionHistory && brief.directionHistory.length) { L.push('**최근 개발 방향 변경**'); brief.directionHistory.slice(-3).forEach(x => L.push(`- ${x}`)); L.push(''); }
  if (_briefFilled(brief) === 0) L.push('_아직 개요 미입력 — `leerness brief set --intro "..." --purpose "..."` 로 작성._', '');
  L.push('<sub>이 섹션은 `leerness brief` 로 관리됩니다. 전체 청사진(복사용): `leerness brief export`.</sub>', BRIEF_END);
  return L.join('\n');
}
function _briefBlueprint(brief, version) {
  const L = [`# ${brief.project} — 프로젝트 청사진 (Blueprint)`,
    `> 이 문서만으로 프로젝트를 기초부터 재구성할 수 있도록 작성. \`leerness brief export\` 생성 (leerness v${version || '?'}).`, ''];
  const sec = (h, v, multi) => { if (multi ? (v && v.length) : v) { L.push(`## ${h}`, multi ? v.map(x => `- ${x}`).join('\n') : v, ''); } };
  sec('소개 (Intro)', brief.intro); sec('목적 (Purpose)', brief.purpose); sec('해결 문제 (Problem)', brief.problem);
  sec('핵심 기능 (Features)', brief.features, true); sec('기술 스택 (Tech Stack)', brief.stack, true);
  sec('아키텍처 (Architecture)', brief.architecture); sec('사용자 (Users)', brief.users, true);
  sec('성공 기준 (Success Criteria)', brief.success, true); sec('비목표 (Non-Goals)', brief.nonGoals, true);
  sec('현재 상태 (Current State)', brief.currentState);
  sec('개발 방향 이력 (Direction History)', brief.directionHistory, true);
  L.push('---', '## 신규 프로젝트 시작 가이드', '', '1. 위 소개·목적·기능·아키텍처·스택을 신규 레포의 계획으로 복사.', '2. `leerness init .` 후 이 파일을 `.harness/project-brief.md` 로 복사하거나 `leerness brief set` 으로 재입력.', '3. Features 를 `leerness plan add` / `leerness task add` 로 분해.', '');
  return L.join('\n');
}

// 1.9.332 (UR-0025): 순수 lessons.md 파서 — 블록(### 날짜)→엔트리 {date, text, tag}. 필터는 호출측.
function _parseLessonEntries(text) {
  const out = [];
  for (const block of String(text || '').split(/\n(?=### )/)) {
    if (!block.startsWith('### ')) continue;
    const dateMatch = block.match(/^### (\d{4}-\d{2}-\d{2}[^\n]*)/);
    const lessonMatch = block.match(/- Lesson:[ \t]*(.+)/);
    const tagMatch = block.match(/- Tag:[ \t]*(.+)/);
    if (!lessonMatch) continue;
    out.push({ date: dateMatch ? dateMatch[1].trim() : null, text: lessonMatch[1].trim(), tag: tagMatch ? tagMatch[1].trim() : null });
  }
  return out;
}

// UR-0058: canonical lessons 객체 배열 → lessons.md projection. _parseLessonEntries 와 round-trip 안전.
function _renderLessonsMd(lessons) {
  const preamble = '# Lessons (1.9.112)\n\n과거 실수/통찰/패턴 영구 기록 — handoff 자동 회수와 통합.\n';
  const body = (lessons || []).map(l =>
    `\n### ${l.date}\n- Lesson: ${l.text}\n${l.tag ? `- Tag: ${l.tag}\n` : ''}`
  ).join('');
  return preamble + body;
}

// 1.9.341 (UR-0025 심층): 내장 스킬 catalog → _source:'builtin' 부여 맵 (skillpack fallback 순수 변환).
function _withBuiltinSource(catalog) {
  const out = {};
  for (const [k, v] of Object.entries(catalog || {})) out[k] = { ...v, _source: 'builtin' };
  return out;
}

// 1.9.345 (UR-0025 심층): HTML escape (roadmap.html 등 출력 인젝션 방지) — 순수, null-safe.
function _esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 1.9.346 (UR-0025 심층): roadmap.html :root CSS 변수 빌더 — designTokens/cssVariables 주입, 순수(모듈 의존 0).
function _roadmapTokenStyles(designTokens, cssVariables) {
  const dt = designTokens || {}, cv = cssVariables || {};
  const vars = {};
  const map = [
    ['color.primary', 'color-primary', 'lr-primary'], ['color.surface', 'color-surface', 'lr-surface'],
    ['color.text', 'color-text', 'lr-text'], ['color.muted', 'color-muted', 'lr-muted'],
    ['space.1', 'space-1', 'lr-space-1'], ['space.2', 'space-2', 'lr-space-2'],
    ['space.3', 'space-3', 'lr-space-3'], ['space.4', 'space-4', 'lr-space-4'],
    ['radius', 'radius', 'lr-radius']
  ];
  for (const [ds, css, vn] of map) { const v = cv[css] || dt[ds]; if (v) vars[vn] = v; }
  for (const [k, v] of Object.entries(cv)) if (!vars[`lr-${k}`]) vars[`lr-${k}`] = v;
  if (!vars['lr-card-bg']) vars['lr-card-bg'] = vars['lr-surface'] || '#ffffff';
  if (!vars['lr-edge']) vars['lr-edge'] = vars['lr-muted'] || '#cbd5e1';
  if (!vars['lr-page-bg']) vars['lr-page-bg'] = '#f8fafc';
  // 1.9.350 (UR-0060/0061 외부리뷰): CSS 값 살균 — whitelist 로 } < > ; { @ : / 등 제거(:root 규칙 breakout + </style> HTML 탈출 차단). 색상/길이 형식은 보존.
  const _safeCss = v => String(v == null ? '' : v).replace(/[^#a-zA-Z0-9(),.%\s_-]/g, '').slice(0, 80);
  return ':root {\n' + Object.entries(vars).map(([k, v]) => `    --${k}: ${_safeCss(v)};`).join('\n') + '\n  }';
}

// 1.9.347 (UR-0025 심층): SKILL.md frontmatter 파서 — { meta, body }, BOM-aware (Windows Notepad 호환). 순수.
function _parseSkillMd(text) {
  const cleaned = String(text || '').replace(/^﻿/, '');  // BOM strip (U+FEFF)
  const m = cleaned.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: cleaned };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const km = line.match(/^([a-zA-Z_-]+):\s*(.+)$/);
    if (km) meta[km[1].trim()] = km[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2] };
}

// 1.9.333 (UR-0025 심층): 순수 플랫폼 제약 매칭 — catalog + 텍스트 → 매칭 플랫폼/제약/제안 (fs 의존 0, catalog 주입).
function _matchConstraints(catalog, text) {
  if (!text || typeof text !== 'string' || !catalog || !catalog.platforms) return { matched: [], suggestions: [] };
  const lower = text.toLowerCase();
  const matched = [];
  for (const [pid, plat] of Object.entries(catalog.platforms)) {
    const aliases = plat.aliases || [];
    const hit = aliases.find(a => lower.includes(a.toLowerCase()));
    if (hit) matched.push({ platform: pid, matchedAlias: hit, docs: plat.docs, constraints: plat.constraints });
  }
  const suggestions = [];
  const generic = /\bapi\b|연동|integration|호출|rate|limit|quota|webhook/i.test(text);
  if (generic && matched.length === 0) {
    suggestions.push('일반적 API 연동 키워드 감지 — leerness constraints list 로 사전 등록된 플랫폼 catalog 확인 권장');
  }
  return { matched, suggestions, totalPlatforms: Object.keys(catalog.platforms).length };
}

// 1.9.333 패턴 적용: 순수 도메인 매칭 — catalog + 텍스트 → 첫 매칭 domain/alias/components (fs 의존 0, catalog 주입).
function _matchDomain(catalog, text) {
  if (!text || typeof text !== 'string' || !catalog || !catalog.domains) return { domain: null, alias: null };
  const lower = text.toLowerCase();
  for (const [domain, info] of Object.entries(catalog.domains)) {
    for (const a of info.aliases || []) {
      if (lower.includes(a.toLowerCase())) {
        return { domain, alias: a, components: info.components };
      }
    }
  }
  return { domain: null, alias: null };
}

// 1.9.335 (UR-0025 심층): LSP 서브시스템 — 순수 언어 감지 (파일 확장자 → 언어)
function _detectLspLang(file) {
  const ext = ((file || '').match(/\.[a-zA-Z0-9]+$/) || [''])[0].toLowerCase();
  if (/^\.(py|pyw|pyi)$/.test(ext)) return 'python';
  if (ext === '.go') return 'go';
  if (ext === '.rs') return 'rust';
  if (/^\.(java|kt|scala)$/.test(ext)) return 'java';
  if (/^\.(ts|tsx|js|jsx|mjs|cjs)$/.test(ext)) return 'javascript';
  return 'javascript';  // default — 기본 JS 패턴 (.txt/.md 등 미지원 확장자)
}

// 1.9.335 (UR-0025 심층): LSP 서브시스템 — 순수 정규식 심볼 매처 (catalog 주입, constraints/domain 패턴 동일)
// catalog: { <lang>: [{ re, kind }, ...] } · content: 소스 텍스트 · lang: 언어 키
function _matchLspSymbols(catalog, content, lang) {
  const symbols = [];
  if (!catalog || typeof content !== 'string') return symbols;
  const lines = content.split(/\r?\n/);
  const patterns = catalog[lang || 'javascript'] || catalog.javascript || [];
  lines.forEach((line, idx) => {
    for (const p of patterns) {
      const m = line.match(p.re);
      // 키워드 false-positive 제거 (예: java method 정규식이 if(/for( 등에 매치되는 경우)
      if (m && !/^(if|for|while|switch|catch|return|throw|new)$/.test(m[1])) {
        symbols.push({ name: m[1], kind: p.kind, line: idx + 1 });
        break;
      }
    }
  });
  return symbols;
}

// 1.9.27: URL/메서드 단위 매핑 — evidence에서 "POST /users" 같은 구체 경로를 추출하고 코드에 같은 경로 존재 확인
function _extractUrlClaims(evidence) {
  const claims = [];
  // "POST /users" / "GET /api/v1/items" 등
  const re = /\b(GET|POST|PUT|DELETE|PATCH)\s+(\/[\w\-\/]*)/gi;
  let m;
  while ((m = re.exec(evidence)) !== null) {
    claims.push({ method: m[1].toUpperCase(), path: m[2] });
  }
  return claims;
}
function _verifyUrlClaim(claim, codeText) {
  // claim.path 가 코드에 등장해야 함 (fetch('https://.../users') 또는 라우트 정의 'POST /users')
  if (!claim.path || claim.path.length < 2) return true;
  // path를 그대로 검색 (URL 또는 라우트 정의)
  const escaped = claim.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'i');
  return re.test(codeText);
}

function _detectOptimism(patterns, evidence, codeText) {
  // 각 패턴 검사: evidence에 주장 있고 코드에 흔적 없으면 의심
  const suspects = [];
  if (!Array.isArray(patterns)) return suspects;
  for (const p of patterns) {
    if (p.evidenceRe.test(evidence) && !p.codeRe.test(codeText)) {
      suspects.push({ kind: p.kind, label: p.label, severity: 'high' });
    }
  }
  // 1.9.27: URL/메서드 단위 매핑 — API 패턴에선 통과해도 구체 경로가 코드에 없으면 추가 의심
  const urlClaims = _extractUrlClaims(evidence);
  for (const claim of urlClaims) {
    if (!_verifyUrlClaim(claim, codeText)) {
      suspects.push({
        kind: 'URL',
        label: `구체 경로 "${claim.method} ${claim.path}" 코드에 미발견`,
        severity: 'medium',
        claim
      });
    }
  }
  return suspects;
}

// 1.9.27: 신뢰도 점수 (0=완전 의심, 1=신뢰)
// 1.9.28: high suspect 단일 케이스 floor 0.15 — 단일 의심도 정량 차등 가능하게
function _computeConfidence(patterns, evidence, codeText) {
  if (!Array.isArray(patterns)) return 1.0;
  const suspects = _detectOptimism(patterns, evidence, codeText);
  const high = suspects.filter(s => s.severity === 'high').length;
  const medium = suspects.filter(s => s.severity === 'medium').length;
  // 가중치: high 1.0 / medium 0.5
  const totalPenalty = high * 1.0 + medium * 0.5;
  // 패턴 검사로 발견된 evidence 주장이 많을수록 신뢰도 산정 base 변경
  const evidenceClaims = patterns.filter(p => p.evidenceRe.test(evidence)).length + _extractUrlClaims(evidence).length;
  if (evidenceClaims === 0) return 1.0; // 외부 작용 주장 자체가 없으면 신뢰 1.0
  let confidence = Math.max(0, 1 - totalPenalty / evidenceClaims);
  // 1.9.28: single high suspect에서 confidence 0.0이 일률적 → severity 기반 floor 적용
  if (suspects.length > 0 && high > 0 && confidence < 0.15) {
    // 의심 발견은 명확하지만 0보다는 명시적 신호로
    confidence = 0.15;
  }
  return Math.round(confidence * 100) / 100;
}

// 1.9.337 (UR-0025 심층): persona catalog → 요약 목록 (id/name/description) 순수 변환 (list 명령 JSON 경로)
function _personaSummaries(catalog) {
  return Object.values(catalog || {}).map(p => ({ id: p.id, name: p.name, description: p.description }));
}

// 1.9.338 (UR-0025 심층): i18n 순수 조회 — strings catalog 주입, key → lang 값 (fallback: ko → key 자체)
function _translate(strings, key, lang) {
  const entry = strings && strings[key];
  if (!entry) return key;
  return entry[lang || 'ko'] || entry.ko || key;
}

// 1.9.339 (UR-0053): decision MD 블록(문자열) → 정규 객체 (canonical 스키마). list/load 단일 파서.
function _parseDecisionBlock(block) {
  const titleMatch = String(block || '').match(/^### (.+)$/m);
  const titleLine = titleMatch ? titleMatch[1].trim() : '';
  const dateTitle = titleLine.match(/^(\d{4}-\d{2}-\d{2})\s*—\s*(.+)$/);
  const g = re => { const m = String(block || '').match(re); const v = m ? m[1].trim() : null; return v || null; };  // 빈 값 → null 정규화 (render↔parse round-trip 멱등)
  return {
    date: dateTitle ? dateTitle[1] : null,
    title: dateTitle ? dateTitle[2].trim() : titleLine,
    decision: g(/- Decision:[ \t]*(.+)/),
    reason: g(/- Reason:[ \t]*(.+)/),
    alternatives: g(/- Alternatives:[ \t]*(.+)/),
    impact: g(/- Impact:[ \t]*(.+)/)
  };
}

// 1.9.339 (UR-0053): decisions.md 본문 → canonical 객체 배열 (template/code 블록 제외, title 있는 것만).
function _decisionsFromMd(text) {
  return _extractDecisionBlocks(text).map(_parseDecisionBlock).filter(d => d.title);
}

// 1.9.339 (UR-0053): canonical 객체 배열 → decisions.md projection (init template preamble 보존, round-trip 안전).
function _renderDecisionsMd(decisions) {
  // preamble 의 코드펜스(```)는 single-quote 문자열로 안전 처리 (template literal 충돌 회피)
  const preamble = '# Decisions\n\n## Template (예시 — 실제 결정은 아래 코드블록 밖에 추가)\n\n'
    + '```md\n### YYYY-MM-DD — Decision 제목\n- Decision:\n- Reason:\n- Alternatives:\n- Impact:\n```\n';
  const body = (decisions || []).map(d => {
    const head = d.date ? `${d.date} — ${d.title}` : d.title;
    return `\n### ${head}\n- Decision: ${d.decision || ''}\n- Reason: ${d.reason || ''}\n- Alternatives: ${d.alternatives || ''}\n- Impact: ${d.impact || ''}\n`;
  }).join('');
  return preamble + body;
}

// 1.9.365 (외부리뷰 CV-6/UR-0081): 시크릿 스캐너 오탐(FP) 억제 — 명백한 placeholder/예시 값은 시크릿 아님.
//   assignment 패턴(secret/api_key = VALUE)의 VALUE 에만 적용 (provider 형식 키엔 미적용 → FN 방지).
function _isPlaceholderSecret(value) {
  if (value == null) return true;
  let v = String(value).trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
  if (!v) return true;
  // 전체가 placeholder 토큰
  if (/^(?:x{3,}|\*{3,}|\.{3,}|-+|0+|1234567890?|12345678|abc123|secret|password|passwd|changeme|change[-_]me|replace[-_]?me|placeholder|example|examples?|sample|dummy|test|testing|foo|bar|baz|tbd|todo|none|null|undefined|nil|empty|redacted|hidden|value|string|here)$/.test(v)) return true;
  // 부분 placeholder 신호
  if (v.includes('example') || v.includes('placeholder') || v.includes('change-me') || v.includes('changeme') || v.includes('replace-me') || v.includes('your-') || v.includes('your_') || v.includes('my-secret') || v.includes('xxxx') || v.includes('<') || v.includes('${') || v.includes('{{')) return true;
  return false;
}
// 1.9.365 (외부리뷰 CV-6/UR-0081): unquoted assignment 값이 '시크릿스러운지' 판정 — 코드 식별자 오탐 억제용.
//   숫자 포함 8+ 또는 24+ 만 시크릿 후보 (camelCase 식별자 같은 무-숫자 단어는 제외).
function _looksSecretLike(value) {
  const v = String(value || '');
  if (!v) return false;
  return (/\d/.test(v) && v.length >= 8) || v.length >= 24;
}

// 1.9.367 (UR-0025): 라인 머지 순수 코어 — 기존 텍스트에 없는 라인만 append (substring 중복 방지). mergeLinesFile 의 I/O 분리.
function _mergeLines(currentText, lines) {
  let next = currentText || '';
  for (const line of (lines || [])) if (!next.includes(line)) next += (next.endsWith('\n') || !next ? '' : '\n') + line + '\n';
  return next;
}
// 1.9.367 (UR-0025): .env key-aware 머지 순수 코어 — 기존 KEY 값 보존(덮어쓰기 X), 신규 KEY/주석만 append. mergeEnvFile 의 I/O 분리.
function _mergeEnvLines(currentText, lines) {
  const current = currentText || '';
  const existingKeys = new Set();
  for (const ln of current.split(/\r?\n/)) { const m = ln.match(/^\s*([A-Z][A-Z0-9_]+)\s*=/); if (m) existingKeys.add(m[1]); }
  let next = current;
  for (const line of (lines || [])) {
    const km = line.match(/^\s*([A-Z][A-Z0-9_]+)\s*=/);
    if (km) { if (existingKeys.has(km[1])) continue; next += (next.endsWith('\n') || !next ? '' : '\n') + line + '\n'; existingKeys.add(km[1]); }
    else { if (!next.includes(line)) next += (next.endsWith('\n') || !next ? '' : '\n') + line + '\n'; }
  }
  return next;
}

// 1.9.368 (UR-0025): README 관리섹션 머지 순수 코어 — 마커 사이 교체, 없으면 append. 마커는 인자로 주입(harness 상수 비결합).
function _mergeReadmeSection(existing, block, START, END) {
  if (!existing) return `# Project\n\n${block}`;
  const s = existing.indexOf(START); const e = existing.indexOf(END);
  if (s >= 0 && e >= s) return existing.slice(0, s).trimEnd() + '\n\n' + block + '\n' + existing.slice(e + END.length).trimStart();
  return existing.trimEnd() + '\n\n' + block;
}
// 1.9.368 (UR-0025): 관리 파일 마이그레이션 머지 순수 코어 — 이전 내용을 migration-preserved 블록으로 보존(데이터/인덱스 파일은 overwrite).
//   archiveRel(사전 계산된 표시 경로) + overwriteSet 을 인자로 주입 → path/process/상수 비결합(순수).
function _managedMerge(file, next, previous, archiveRel, overwriteSet) {
  if (!previous || previous.trim() === next.trim()) return next;
  const tag = '<!-- leerness:migration-preserved -->';
  if (previous.includes(tag)) return next;
  if (overwriteSet && overwriteSet.has(String(file).replace(/\\/g, '/'))) return next;
  const ar = archiveRel || '.harness/archive';
  return next.trimEnd() + `\n\n---\n${tag}\n## Preserved previous content\n\nPrevious content was backed up before migration. Archive reference:\n\n\`${ar}\`\n\n<details>\n<summary>Previous ${file}</summary>\n\n\`\`\`md\n${previous.replace(/```/g, '\\`\\`\\`')}\n\`\`\`\n\n</details>\n`;
}

// 1.9.369 (UR-0025): --skills 값 파싱 순수 코어 — catalog 주입(harness skillCatalog 비결합). all/recommended/csv 처리 + catalog 필터.
function _parseSkillsValue(v, catalog) {
  if (!v || v === true) return [];
  if (v === 'all') return Object.keys(catalog || {});
  if (v === 'recommended') return ['office', 'commerce-api', 'ai-verified-skill-publisher', 'feature-implementation', 'project-roadmap-generator'];
  return String(v).split(',').map(s => s.trim()).filter(Boolean).filter(s => (catalog || {})[s]);
}

// 1.9.370 (UR-0025): memory archive 블록 파서 순수 코어 — "## 제거 DATE (target: \"...\")" 블록 → {date,target,originalHeader}[].
function _parseArchiveBlocks(text) {
  const entries = [];
  if (!text) return entries;
  const blocks = text.split(/\n(?=## 제거 )/);
  for (const b of blocks) {
    const m = b.match(/^## 제거 (\d{4}-\d{2}-\d{2})\s*\(target:\s*"([^"]*)"\)/);
    if (!m) continue;
    const headerMatch = b.match(/^### (.+)$/m);
    entries.push({ date: m[1], target: m[2], originalHeader: headerMatch ? headerMatch[1].trim() : null });
  }
  return entries;
}
// 1.9.370 (UR-0025): skill 카탈로그 파서 순수 코어 — JSON/RSS·Atom/markdown 링크/llms.txt 형식 → {name,url,description,format}[].
function _parseSkillCatalog(body, sourceUrl) {
  const entries = [];
  const trimmed = String(body || '').trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const j = JSON.parse(trimmed);
      const arr = Array.isArray(j) ? j : (j.skills || j.entries || j.items || []);
      for (const e of arr) {
        if (!e || (!e.name && !e.id)) continue;
        entries.push({ name: e.name || e.id, url: e.url || e.path || (sourceUrl ? sourceUrl.replace(/[^/]+$/, '') + (e.id || e.name) + '/SKILL.md' : ''), description: e.description || '', format: 'json' });
      }
      if (entries.length) return entries;
    } catch {}
  }
  if (/<rss|<feed|<channel|<item>/i.test(body)) {
    for (const m of String(body).matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)) {
      const item = m[0];
      const title = (item.match(/<title>([^<]+)<\/title>/i) || [])[1];
      const link = (item.match(/<link[^>]*>([^<]+)<\/link>/i) || item.match(/<link\s+href="([^"]+)"/i) || [])[1];
      const desc = (item.match(/<description>([^<]+)<\/description>/i) || item.match(/<summary>([^<]+)<\/summary>/i) || [])[1];
      if (title) entries.push({ name: title.trim(), url: (link || '').trim(), description: (desc || '').trim(), format: 'rss' });
    }
    if (entries.length) return entries;
  }
  for (const m of String(body).matchAll(/^\s*[-*]\s*\[([^\]]+)\]\(([^)]+)\)\s*[-—:]\s*(.+)$/gm)) {
    entries.push({ name: m[1], url: m[2], description: m[3].trim(), format: 'markdown' });
  }
  if (entries.length) return entries;
  for (const m of String(body).matchAll(/^\s*[-*]\s*\[([^\]]+)\]\(([^)]+\.md)\)/gm)) {
    entries.push({ name: m[1], url: m[2], description: '', format: 'markdown' });
  }
  if (entries.length) return entries;
  for (const m of String(body).matchAll(/(https?:\/\/[^\s)]+SKILL\.md)/g)) {
    entries.push({ name: m[1].split('/').slice(-2)[0], url: m[1], description: '', format: 'urls' });
  }
  return entries;
}

// 1.9.371 (UR-0073 Phase A): agent team 정의 → teams.md projection (canonical JSON 주, MD 투영). 순수 렌더러.
function _renderTeamsMd(teams) {
  const preamble = '# Agent Teams (UR-0073)\n\n페르소나 기반 에이전트 팀 정의 — **opt-in · 정의 전용(자동 실행 없음)**. `leerness team add|list|show|remove` 로 관리.\n'
    + '향후 단계에서 스케줄 기반 실행(리뷰/배포/블로그)이 opt-in 으로 추가될 수 있습니다. 현재는 메타데이터만 저장합니다.\n';
  const body = (teams || []).map(t => {
    return `\n## ${t.id}${t.name ? ' — ' + t.name : ''}\n`
      + `- Purpose: ${t.purpose || ''}\n`
      + `- Personas: ${(t.personas || []).join(', ')}\n`
      + `- Members: ${(t.members || []).join(', ')}\n`
      + `- Schedule: ${t.schedule || 'manual'}\n`
      + `- Deploy: ${t.deployCommand || '-'}\n`
      + `- Status: ${t.status || 'active'}\n`;
  }).join('');
  return preamble + body;
}

// 1.9.372 (UR-0073 Phase B): team 실행 계획 컴포저 (순수, dry-run 미리보기). 실제 실행/spawn 없음 — 멤버별 dispatch 명령 문자열만 생성.
function _composeTeamPlan(team, task) {
  const t = team || {};
  const effTask = (task && task !== true) ? String(task) : (t.purpose || '(작업 미지정)');
  const personas = Array.isArray(t.personas) ? t.personas : [];
  const members = Array.isArray(t.members) ? t.members : [];
  const personaTag = personas.length ? ` [페르소나: ${personas.join(', ')}]` : '';
  const steps = members.map(m => {
    const prompt = `${effTask}${personaTag}`;
    return { member: m, personas, dispatchPrompt: prompt, suggestedCommand: `leerness agents dispatch "${prompt}" --to ${m}` };
  });
  return { teamId: t.id || null, name: t.name || '', task: effTask, schedule: t.schedule || 'manual', memberCount: members.length, steps };
}

// 1.9.373 (UR-0073 Phase C): 비-manual·active 팀의 handoff 스케줄 알림 라인 (순수). 실행 트리거 아님 — 미리보기 안내만.
function _teamHandoffReminders(teams) {
  return (teams || [])
    .filter(t => t && t.schedule && t.schedule !== 'manual' && (t.status || 'active') === 'active' && t.id)
    .map(t => `🤝 ${t.id} (${t.schedule})${Array.isArray(t.members) && t.members.length ? ' · ' + t.members.length + '명' : ''} — 미리보기: leerness team preview ${t.id}`);
}

// 1.9.374 (UR-0074): 릴리스 케이던스 평가 (순수) — releases/day → 수준 + 권장. 외부리뷰 "릴리스 빈도 과다" 가시화.
function _cadenceAssessment(perDay, total, daysActive) {
  const r = Number(perDay) || 0;
  let level, recommendation;
  if (r >= 5) { level = 'very-high'; recommendation = 'batched minor 릴리스 강력 권장 — 관련 패치를 묶어 주 1~2회 minor 로. stable/next 채널 분리 + 사용자에겐 stable 만 권고.'; }
  else if (r >= 2) { level = 'high'; recommendation = 'cadence 높음 — 연관 변경을 묶어 배포 빈도 축소 권장. 릴리스 노트에 실행 환경/검증 명시.'; }
  else if (r >= 0.5) { level = 'moderate'; recommendation = '적정 범위 — 안정성 우선 시 minor 묶음 고려.'; }
  else { level = 'healthy'; recommendation = '건강한 케이던스.'; }
  return { releasesPerDay: r, total: Number(total) || 0, daysActive: Number(daysActive) || 0, level, recommendation };
}

// 1.9.376 (UR-0073 Phase D): team 배포 실행 게이트 결정 (순수). 안전: dry-run 기본, 실행은 --yes + env 이중 게이트.
//   mode: no-command(설정 없음) / dry-run(실행 안 함) / gated(env 미충족 거부) / execute(실행 허용).
function _teamDeployGate(team, opts) {
  const t = team || {}; opts = opts || {};
  const command = (t.deployCommand && t.deployCommand !== true) ? String(t.deployCommand) : '';
  if (!command) return { mode: 'no-command', command: '', message: 'deployCommand 미설정 — team add --deploy "<명령>" 으로 지정' };
  if (!opts.yes) return { mode: 'dry-run', command, message: 'dry-run (실행 없음) — 실행하려면 --yes + LEERNESS_TEAM_DEPLOY=1' };
  if (!opts.envOn) return { mode: 'gated', command, message: '실행 게이트 미충족 — LEERNESS_TEAM_DEPLOY=1 환경변수 필요 (의도적 opt-in)' };
  return { mode: 'execute', command, message: '실행 허용 (--yes + env 게이트 충족)' };
}

// 1.9.377 (UR-0025): 워크스페이스 레퍼런스 가이드 빌더 (순수) — dirName/version/generatedAt 주입. harness 인라인(~57줄) 분리.
function _renderWorkspaceReferenceGuide(dirName, version, generatedAt) {
  const lines = [];
  lines.push(`# Leerness Workspace Reference Guide`);
  lines.push('');
  lines.push(`> AI 에이전트가 leerness 워크스페이스에서 어떤 파일을 어디서 찾는지 안내합니다 (1.9.211).`);
  lines.push('');
  lines.push(`Generated: ${generatedAt} by leerness ${version}`);
  lines.push(`Workspace dir: \`${dirName}/\``);
  lines.push('');
  lines.push(`## 📁 디렉토리 구조 (핵심)`);
  lines.push('');
  lines.push('```');
  lines.push(`${dirName}/`);
  lines.push(`├── plan.md                    ← 무엇을 할 것인가 (사용자 메모리)`);
  lines.push(`├── progress-tracker.md        ← 무엇을 했는가 (증거 포함, 사용자 메모리)`);
  lines.push(`├── decisions.md               ← 왜 그렇게 했는가 (사용자 메모리)`);
  lines.push(`├── session-handoff.md         ← 다음 세션 인계 (사용자 메모리)`);
  lines.push(`├── lessons.md                 ← 과거 교훈 (자동 fuzzy 회수)`);
  lines.push(`├── rules.md                   ← 자연어 룰 (매 세션 자동 노출, R-XXXX)`);
  lines.push(`├── task-log.md                ← in-progress / dropped task 이력`);
  lines.push(`├── reuse-map.md               ← 워크스페이스 capability 매핑`);
  lines.push(`├── skill-suggestions.md       ← skill rolling history`);
  lines.push(`├── feature-graph.md           ← 기능 의존 그래프 (F-XXXX)`);
  lines.push(`├── manifest.json              ← 워크스페이스 메타`);
  lines.push(`├── leerness-config.json       ← 비시크릿 LEERNESS_* 설정 (1.9.187, AI 가시)`);
  lines.push(`├── user-requests.json         ← 사용자 명시 요청 누적 (1.9.207)`);
  lines.push(`├── active-wakeups.json        ← ScheduleWakeup 상태 (1.9.205)`);
  lines.push(`├── pre-wake-report.json       ← sleep 전 sub-agent audit (1.9.209)`);
  lines.push(`├── wakeup-history.json        ← adaptive wakeup 이력 (1.9.210)`);
  lines.push(`├── platform-constraints.json  ← API 제약 catalog (1.9.208)`);
  lines.push(`├── auto-resume-plan.json      ← 다음 라운드 plan (1.9.203)`);
  lines.push(`├── next-action-queue.json     ← 다음 next-action 큐 (1.9.201)`);
  lines.push(`├── last-handoff.json          ← 마지막 handoff timestamp`);
  lines.push(`├── environment.json           ← 환경 변동 추적 (1.9.145)`);
  lines.push(`├── skills/                    ← 설치된 skill 디렉토리`);
  lines.push(`└── templates/                 ← 워크스페이스 템플릿`);
  lines.push('```');
  lines.push('');
  lines.push(`## 🧭 자주 묻는 위치`);
  lines.push('');
  lines.push(`| 찾는 것 | 위치 |`);
  lines.push(`|---|---|`);
  lines.push(`| 현재 진행 중인 task | \`${dirName}/progress-tracker.md\` (status: in-progress) |`);
  lines.push(`| 사용자가 명시한 영구 룰 | \`${dirName}/rules.md\` (active R-XXXX) |`);
  lines.push(`| 직전 sleep 전 audit 결과 | \`${dirName}/pre-wake-report.json\` (1.9.209) |`);
  lines.push(`| 미답 사용자 요청 | \`${dirName}/user-requests.json\` (status: open) |`);
  lines.push(`| 다음 라운드 권장 단계 | \`${dirName}/auto-resume-plan.json\` (1.9.203) |`);
  lines.push(`| API 제약 catalog | \`${dirName}/platform-constraints.json\` (1.9.208) |`);
  lines.push(`| 자동 wakeup 권장 간격 | \`${dirName}/wakeup-history.json\` (1.9.210) |`);
  lines.push('');
  lines.push(`## 🔄 마이그레이션 안내`);
  lines.push('');
  lines.push(`이 워크스페이스는 \`.harness\` → \`.leerness\` 로 마이그레이션되었을 수 있습니다.`);
  lines.push(`- \`.leerness/MIGRATED_FROM_HARNESS\` 존재 → 마이그레이션 완료, \`.leerness\` 우선 사용`);
  lines.push(`- \`.harness/MIGRATED_TO_LEERNESS.md\` 존재 → \`.leerness/\` 로 가야 함`);
  lines.push(`- 양쪽 모두 없음 → 기본 \`.harness\` 사용 중`);
  lines.push('');
  lines.push(`AI 에이전트는 \`leerness handoff .\` 결과를 신뢰하십시오 — 자동으로 올바른 디렉토리를 사용합니다.`);
  lines.push('');
  return lines.join('\n');
}

// 1.9.379 (UR-0025 심화): Memory Surface 포맷 (순수) — T/D/R/P/L 카운트 → 문자열. pulse/memory-status 단일출처.
function _memorySurface(counts) {
  const c = counts || {};
  return `T${c.tasks || 0}/D${c.decisions || 0}/R${c.rules || 0}/P${c.milestones || 0}/L${c.lessons || 0}`;
}
// 1.9.379 (UR-0025 심화): pulse 한 줄 요약 조합 (순수) — gather(I/O)된 data → 한 줄 문자열. pulse 핸들러 렌더 코어.
function _renderPulseLine(data) {
  const d = data || {};
  let line = `📍 v${d.version} · 🔄 R${d.roundCount} · 🔌 MCP ${d.mcpTools} · 🧠 ${d.memorySurface}`;
  if (d.nextMilestone) {
    const eta = d.etaDays != null ? ` (${d.etaDays}d)` : '';
    line += ` · 🎯 R${d.nextMilestone}${eta}`;
  }
  if (d.abnormalShutdown && d.abnormalShutdown !== 'none') {
    line += ` · 🔌 abnormal:${d.abnormalShutdown}`;
  }
  return line;
}

module.exports = {
  _isSecretKey, compareVer, parseHarnessVersion,
  _isPlaceholderSecret, _looksSecretLike,
  _mergeLines, _mergeEnvLines, _mergeReadmeSection, _managedMerge, _parseSkillsValue,
  _parseArchiveBlocks, _parseSkillCatalog, _renderTeamsMd, _composeTeamPlan, _teamHandoffReminders, _cadenceAssessment, _teamDeployGate, _renderWorkspaceReferenceGuide, _memorySurface, _renderPulseLine,
  _classifyCJK, _riskLabel, _detectSystemLang, _parseSlashFromHelp,
  // 1.9.283 (UR-0025 2단계)
  PERMISSION_TIERS, _tierRank, _requiredTier, _policyAllows, _resolveNpmTag, _mcpJsonContent, _newRunRecord,
  // 1.9.318 (UR-0025): 순수 HTML 파싱 유틸
  _htmlToText, _extractTitle, _extractLinks,
  // 1.9.324 (UR-0025): 순수 메모리 MD 파서
  _countDatedBlocks, _extractDecisionBlocks,
  // 1.9.325 (UR-0025): 순수 intent 분류
  _classifyIntent,
  // 1.9.326 (UR-0025): 순수 문자열/셸/env 유틸
  _sanitizeFences, _shellQuoteArg, _detectPwshFromEnv,
  // 1.9.327 (UR-0025): 순수 TZ/날짜 포맷
  _getLocalTz, _formatLocal,
  // 1.9.328 (UR-0025): 순수 문자열 유틸
  _truncate, _splitList,
  // 1.9.329 (UR-0025): 순수 roadmap MD 파서
  _roadmapMapStatus, _roadmapParseMilestones, _roadmapParseTokens,
  // 1.9.330 (UR-0025): project-brief 필드 config + 채움 카운트
  _BRIEF_FIELDS, _briefFilled,
  // 1.9.331 (UR-0025): project-brief 텍스트 빌더 + 마커
  BRIEF_START, BRIEF_END, _briefReadmeBlock, _briefBlueprint,
  // 1.9.332/UR-0058: 순수 lessons.md 파서 + canonical projection renderer
  _parseLessonEntries, _renderLessonsMd,
  // 1.9.341 (UR-0025 심층): 내장 스킬 catalog _source 부여
  _withBuiltinSource,
  // 1.9.345 (UR-0025 심층): HTML escape (출력 인젝션 방지)
  _esc,
  // 1.9.346 (UR-0025 심층): roadmap CSS 변수 빌더
  _roadmapTokenStyles,
  // 1.9.347 (UR-0025 심층): SKILL.md frontmatter 파서 (BOM-aware)
  _parseSkillMd,
  // 1.9.333 (UR-0025 심층): 순수 플랫폼 제약 매칭
  _matchConstraints,
  // 1.9.333 패턴 적용: 순수 도메인 매칭
  _matchDomain,
  // 1.9.335 (UR-0025 심층): LSP 서브시스템 — 순수 언어감지 + 정규식 심볼 매처
  _detectLspLang, _matchLspSymbols,
  // anti-laziness optimism-check 순수 로직
  _extractUrlClaims, _verifyUrlClaim, _detectOptimism, _computeConfidence,
  // 1.9.337 (UR-0025 심층): persona 요약 목록
  _personaSummaries,
  // 1.9.338 (UR-0025 심층): i18n 순수 조회
  _translate,
  // 1.9.339 (UR-0053): decisions canonical 파서/렌더 (JSON canonical, MD projection)
  _parseDecisionBlock, _decisionsFromMd, _renderDecisionsMd,
  // 1.9.355 (UR-0075 Phase A): 크로스버전 마이그레이션 가이드
  _migrationGuideText,
  // 1.9.385 (UR-0086, 5th외부평가): contract spec 순수 파서 (markdown bullet 함수 선언 감지)
  _parseContractSpec,
  // 1.9.386 (UR-0087, 5th외부평가): 간이 .gitignore 매칭 + glob (bare .env → .env.* 과잉보호 제거)
  _gitignoreMatch, _globToRe,
  // 1.9.390 (UR-0025): feature-graph 순수 코어 (템플릿/파서/ID/블록)
  _featureGraphTemplate, _parseFeatureGraph, _nextFeatureId, _featureBlock,
  // 1.9.391 (UR-0025): feature 영향 BFS (순수, 공유)
  _featureImpactBfs,
  // 1.9.393 (UR-0025): CHANGELOG 버전 구간 차분 파서 (순수, 공유)
  _parseChangelogBetween
};

// 1.9.355 (UR-0075 Phase A): AI 에이전트용 크로스버전 마이그레이션 안전 워크플로 가이드 (순수 텍스트). 임시설치 + --path + 백업 + diff 검증.
function _migrationGuideText(version) {
  const v = version || 'latest';
  const L = [
    '# leerness 크로스버전 마이그레이션 가이드 (UR-0075, AI 에이전트용)',
    '',
    '아주 오래된 구버전부터 신규(' + v + ')까지 — 기존 프로젝트의 .harness 내용을 안전·비파괴로 마이그레이션.',
    '',
    '## 0. 원칙',
    '- 비파괴: leerness 는 migrate/update 시 .harness/archive 에 자동 백업. 그래도 git 커밋/브랜치 선행 권장.',
    '- dry-run 우선: 먼저 --check 로 감지, diff 로 확인 후 적용.',
    '',
    '## 1. 안전 스냅샷 (권장)',
    '  git add -A && git commit -m "chore: pre-leerness-migration snapshot"   # 또는 브랜치: git checkout -b chore/leerness-migrate',
    '',
    '## 2. 신규 버전 감지 (구버전 프로젝트 대상)',
    '  npx leerness@latest update --check --path <project>      # 현재 버전 vs 최신 비교 (네트워크 비차단, 비파괴)',
    '',
    '## 3. 마이그레이션 적용 (임시설치 = npx 캐시, 격리)',
    '  npx leerness@latest update --yes --path <project>        # 자동 마이그레이션 (.harness/archive 백업 + 신 스키마 반영)',
    '  # 또는: npx leerness@latest migrate <project> --force    # 강제 재스캐폴딩(비파괴, 기존 내용 보존)',
    '',
    '## 4. 검증 (필수)',
    '  git -C <project> diff                                    # 생성/수정 파일 전수 확인 (예상치 못한 변경 점검)',
    '  npx leerness@latest selftest                             # 코어 무결성 (위치독립, 어디서든 통과)',
    '  npx leerness@latest check --path <project>               # 프로젝트 무결성',
    '  npx leerness@latest doctor                               # 설치 진단',
    '',
    '## 5. 크로스버전 메모',
    '- decisions/lessons: 구 MD-only → canonical JSON 자동 백필(첫 write 시). decisions.json/lessons.json 이 진실소스, .md 는 projection.',
    '- 아주 구버전: update 가 단계적으로 누적 마이그레이션. 한 번에 안 되면 update --yes 재실행.',
    '- 보호 파일(.harness/protected-files.md): 삭제 금지 — merge/archive/deprecated 마커 사용.',
    '',
    '## 6. 롤백',
    '  git -C <project> checkout -- .                           # git 스냅샷 복원',
    '  # 또는 .harness/archive/<timestamp> 에서 수동 복구 · leerness memory restore <surface> <target>',
    ''
  ];
  return L.join('\n');
}

// 1.9.385 (UR-0086, 5번째 외부평가): contract spec 함수/필드 추출 — 순수 파서.
//   declared(강선언, 검사 대상): "function name(" + markdown bullet "- name(args)" / "* " / "1. ".
//   mentioned(약언급, 표시만): backtick `name(` — 산문 인라인 언급일 수 있어 누락검사 제외(기존 관대성 유지).
//   fields: tick.name. bullet 패턴은 name 직후 '(' (공백 불허) → 산문 "- 합 (a+b)" 오탐 방지, ASCII 식별자만.
function _parseContractSpec(specText) {
  const s = specText || '';
  const declared = new Set();
  const mentioned = new Set();
  const fields = new Set();
  for (const m of s.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) declared.add(m[1]);
  for (const m of s.matchAll(/^\s*(?:[-*+]|\d+\.)\s+([A-Za-z_$][\w$]*)\(/gm)) declared.add(m[1]);
  for (const m of s.matchAll(/`([A-Za-z_$][\w$]*)\s*\(/g)) mentioned.add(m[1]);
  for (const m of s.matchAll(/tick\.([A-Za-z_$][\w$]*)/g)) fields.add(m[1]);
  return { declared: [...declared], mentioned: [...mentioned], fields: [...fields] };
}

// 1.9.386 (UR-0087, 5번째 외부평가): 간이 glob → 정규식. '*' → [^/]* (경로구분 제외), 나머지는 리터럴.
function _globToRe(glob) {
  const esc = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp('^' + esc + '$');
}
// 1.9.386 (UR-0087, 5번째 외부평가): 간이 .gitignore 매칭 (순수). full semantics 아님 — 정확매칭 / glob(*) / dir(/) 지원.
//   1.9.365 의 과잉 휴리스틱(bare '.env' → 모든 '.env.*' 보호) 제거 → git 실제 동작과 일치:
//   '.env' 는 '.env' 만 매칭(.env.bad 미보호 = 커밋 대상). '.env.*' / '.env*' 같은 명시 glob 만 .env.bad 보호.
function _gitignoreMatch(giText, fileRel) {
  if (!giText) return false;
  const relPosix = String(fileRel).replace(/\\/g, '/');
  const base = relPosix.split('/').pop();
  for (let pat of String(giText).split(/\r?\n/)) {
    pat = pat.trim();
    if (!pat || pat.startsWith('#') || pat.startsWith('!')) continue;
    const isDir = pat.endsWith('/');
    const p = pat.replace(/^\/+|\/+$/g, '');
    if (!p) continue;
    if (p === relPosix || p === base) return true;                               // 정확 매칭 (.env → .env)
    if (isDir && (relPosix === p || relPosix.startsWith(p + '/'))) return true;  // dir/
    if (p.includes('*')) {                                                        // glob: *.pem / .env.* / .env*
      const re = _globToRe(p);
      if (re.test(p.includes('/') ? relPosix : base)) return true;
    }
  }
  return false;
}

// 1.9.390 (UR-0025): feature-graph 순수 코어 — 템플릿/파서/ID/블록 렌더 (I/O 없음). harness 의 _readFeatureGraph/_writeFeatureGraph 가 사용.
function _featureGraphTemplate() {
  return `# Feature Graph (1.9.141)\n\n` +
    `> **목적**: 각 기능의 인과관계를 정확히 정리해서 코드 작성 전 영향 범위를 자동 추적.\n` +
    `> 신규 기능 추가, 데이터 형식 변경, 외부 API 매칭 작업 전 \`leerness feature impact <id>\`로 확인.\n` +
    `> handoff가 현재 task 키워드로 자동 매칭해서 영향받는 feature 목록을 회수.\n\n` +
    `## How to use\n\n` +
    `\`\`\`bash\n` +
    `leerness feature add "User Auth"                           # F-0001 자동 부여\n` +
    `leerness feature link F-0002 --depends-on F-0001           # 의존 관계\n` +
    `leerness feature link F-0001 --affects F-0002,F-0005        # 영향 관계 (다수)\n` +
    `leerness feature link F-0001 --co-changes-with F-0011       # 함께 변해야 하는 기능\n` +
    `leerness feature impact F-0001                              # 영향받는 전체 (transitive)\n` +
    `leerness feature list --json                                # 그래프 JSON\n` +
    `leerness feature show F-0001                                # 단일 상세\n` +
    `\`\`\`\n\n` +
    `## Nodes\n\n`;
}
function _parseFeatureGraph(text) {
  if (!text) return [];
  const nodes = [];
  const re = /^## (F-\d{4})\s+(.+?)\s*$/gm;
  const positions = [];
  let m;
  while ((m = re.exec(text)) !== null) positions.push({ id: m[1], title: m[2], start: m.index });
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].start;
    const end = i + 1 < positions.length ? positions[i + 1].start : text.length;
    const block = text.slice(start, end);
    const parseField = (key) => {
      // 1.9.141 fix: \s 은 \n 도 포함하므로 [ \t]* 로 newline 비포함 horizontal whitespace 만 매칭
      const r = new RegExp(`^- ${key}:[ \\t]*(.*?)$`, 'mi');
      const mm = block.match(r);
      return mm ? mm[1].trim() : '';
    };
    const parseList = (key) => {
      const v = parseField(key);
      if (!v) return [];
      return v.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    };
    nodes.push({
      id: positions[i].id,
      title: positions[i].title,
      dependsOn: parseList('depends-on'),
      affects: parseList('affects'),
      coChangesWith: parseList('co-changes-with'),
      files: parseList('files'),
      input: parseField('input'),
      output: parseField('output'),
      errorModes: parseList('error-modes'),
      tests: parseList('tests'),
      notes: parseField('notes')
    });
  }
  return nodes;
}
function _nextFeatureId(nodes) {
  const used = new Set(nodes.map(n => parseInt(n.id.slice(2), 10)));
  let n = 1; while (used.has(n)) n++;
  return 'F-' + String(n).padStart(4, '0');
}
function _featureBlock(node) {
  return `## ${node.id} ${node.title}\n` +
    `- depends-on: ${(node.dependsOn || []).join(', ')}\n` +
    `- affects: ${(node.affects || []).join(', ')}\n` +
    `- co-changes-with: ${(node.coChangesWith || []).join(', ')}\n` +
    `- files: ${(node.files || []).join(', ')}\n` +
    `- input: ${node.input || ''}\n` +
    `- output: ${node.output || ''}\n` +
    `- error-modes: ${(node.errorModes || []).join(', ')}\n` +
    `- tests: ${(node.tests || []).join(', ')}\n` +
    `- notes: ${node.notes || ''}\n\n`;
}
// 1.9.391 (UR-0025): feature 영향 BFS — affects + co-changes-with transitive + depends-on 역방향. 순수(nodes,startId→result). harness(handoff/audit)+lib/feature 공유.
function _featureImpactBfs(nodes, startId) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const visited = new Set();
  const queue = [{ id: startId, depth: 0, via: 'self' }];
  const result = [];
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur.id)) continue;
    visited.add(cur.id);
    const node = byId.get(cur.id);
    if (!node) continue;
    if (cur.depth > 0) result.push({ id: cur.id, title: node.title, depth: cur.depth, via: cur.via, files: node.files, errorModes: node.errorModes });
    for (const next of node.affects || []) queue.push({ id: next, depth: cur.depth + 1, via: 'affects' });
    for (const next of node.coChangesWith || []) queue.push({ id: next, depth: cur.depth + 1, via: 'co-changes-with' });
  }
  // 역방향: 이 feature에 depends-on 하는 노드도 영향받음
  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    if ((n.dependsOn || []).includes(startId)) {
      result.push({ id: n.id, title: n.title, depth: 1, via: 'depends-on(reverse)', files: n.files, errorModes: n.errorModes });
      visited.add(n.id);
    }
  }
  return result;
}
// 1.9.393 (UR-0025): CHANGELOG 버전 구간 차분 파서 — from < V <= to 섹션 + 신규 명령/플래그/파일 추출. 순수. harness(update/whats-new) 공유.
//   BUG-fix(1.9.393): (1) 헤더 꼬리가 '## X — DATE — title' 의 ' — title' 를 소비 못 해 0건 반환 → 헤더에 '[^\n]*' 허용.
//   (2) 기존 본문 캡처 '([\s\S]*?)(?=^##…|$)' 가 /m 모드 '$'(줄 끝) 때문에 본문을 첫 줄로 절단 → _parseFeatureGraph 식 '위치 기반 분할'로 교체.
//   '## X'(제목 없음) / '## X — DATE' / '## X — DATE — title' 모두 매칭, 본문은 다음 헤더(또는 끝)까지 전체 캡처.
function _parseChangelogBetween(changelogText, fromV, toV) {
  const text = changelogText || '';
  const headerRe = /^## (\d+\.\d+\.\d+)(?:\s+—\s+(\d{4}-\d{2}-\d{2}))?[^\n]*$/gm;
  const positions = [];
  let hm;
  while ((hm = headerRe.exec(text)) !== null) positions.push({ version: hm[1], date: hm[2] || null, start: hm.index, bodyStart: hm.index + hm[0].length });
  const sections = [];
  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1].start : text.length;
    sections.push({ version: positions[i].version, date: positions[i].date, body: text.slice(positions[i].bodyStart, end).trim() });
  }
  // from < V <= to 만 (fromV 자체는 이미 적용된 버전이므로 제외)
  const ranged = sections.filter(s => {
    const cmp = (v1, v2) => {
      const a = v1.split('.').map(Number), b = v2.split('.').map(Number);
      for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
      return 0;
    };
    return cmp(s.version, fromV) > 0 && cmp(s.version, toV) <= 0;
  });
  // 각 섹션에서 신규 명령/플래그/파일 추출
  for (const s of ranged) {
    s.newCommands = [];
    s.newFlags = [];
    s.newFiles = [];
    // `leerness X [...]` 또는 backtick에 싸인 leerness 명령
    for (const cm of s.body.matchAll(/`leerness\s+([a-z][\w-]*(?:\s+[a-z][\w-]*)?)/g)) {
      const cmd = cm[1].trim();
      if (!s.newCommands.includes(cmd)) s.newCommands.push(cmd);
    }
    // `--xxx` 플래그
    for (const fm of s.body.matchAll(/`(--[a-z][\w-]*)`/g)) {
      if (!s.newFlags.includes(fm[1])) s.newFlags.push(fm[1]);
    }
    // .harness/X.md 같은 신규 파일
    for (const ff of s.body.matchAll(/`(\.harness\/[\w./-]+\.(?:md|json|jsonl))`/g)) {
      if (!s.newFiles.includes(ff[1])) s.newFiles.push(ff[1]);
    }
  }
  return ranged;
}
