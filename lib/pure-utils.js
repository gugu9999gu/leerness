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
  const out = [];
  for (const m of String(text || '').matchAll(/^### (M-\d{4})\.\s*(.+?)$/gm)) {
    const after = text.slice(m.index);
    const sm = after.match(/^Status:\s*(\S+)/m);
    const pm = after.match(/^Progress:\s*(\d+)%/m);
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
  return ':root {\n' + Object.entries(vars).map(([k, v]) => `    --${k}: ${v};`).join('\n') + '\n  }';
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

module.exports = {
  _isSecretKey, compareVer, parseHarnessVersion,
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
  _parseDecisionBlock, _decisionsFromMd, _renderDecisionsMd
};
