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
  if (isWinPowerShell && /&&|\|\|/.test(c)) {  // 1.12.5 (15th 버그헌트 P2, UR-0018): 공백 무관 — PS5.1 은 a&&b 도 거부(이전 /\s&&\s/ 는 양쪽 공백 요구해 npm 체인 a&&b 미탐).
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
  if (shell === 'powershell' && psVer == null && /&&|\|\|/.test(c)) {  // 1.12.5 (UR-0018): 공백 무관 매칭
    issues.push({ rule: 'ps-version-unknown', severity: 'info', detail: 'PowerShell 버전 미상 — 5.1 이면 && 미지원, 7+ 이면 지원.', suggestion: '$PSVersionTable.PSVersion 확인. 안전하게 A; if ($?) { B } 권장.' });
  }
  return { shell, psVersion: psVer, issues };
}
// 1.36.82 (검수 High#2): evidence 에서 파일 경로를 알아보는 **단일 출처**.
//   이전엔 bin 의 FILE_RE 와 여기 hasFile 정규식이 각자 따로 있어(주석만 "정합") 실제로는 어긋났고,
//   "대조 0건이면 FAIL" 을 도입한 뒤로는 추출기 사각지대가 곧 정직한 주장의 거짓 차단이 됐다.
//   실측으로 확인된 사각지대: 다단계 경로의 확장자 없는 파일(ops/containers/Dockerfile),
//   선두 점 디렉토리(.github/workflows/ci.yml → github/… 로 잘림), 점파일(.gitignore),
//   그리고 Dockerfile.dev 가 Dockerfile 로 잘려 "없는 파일" 이 되던 것.
const _VC_FILE_EXTS = 'webmanifest|properties|tscn|tres|godot|json5|prisma|swift|java|jsx|tsx|yaml|html|scss|sass|less|gltf|conf|json|toml|lock|mdx|xml|css|svg|yml|cfg|ini|env|php|sql|mjs|cjs|vue|svelte|md|js|ts|gd|cs|py|rb|go|rs|kt|sh|cpp|c|h';
// 확장자 없는 표준 파일명 — 임의의 대문자 단어가 아니라 정확한 철자만(대소문자 구분)으로 FP 억제.
const _VC_BARE_FILES = 'Dockerfile|Containerfile|Makefile|Gemfile|Procfile|Rakefile|Jenkinsfile|Vagrantfile|Caddyfile|Brewfile|Justfile|CODEOWNERS|LICENCE|LICENSE|NOTICE';
// 점파일 — 확장자 규칙으로는 잡히지 않지만 명백한 파일 참조.
const _VC_DOTFILES = '\\.(?:gitignore|gitattributes|gitmodules|dockerignore|npmrc|npmignore|nvmrc|editorconfig|prettierrc|eslintrc|babelrc|browserslistrc)';
// 경로 접두: 0개 이상 세그먼트(각 세그먼트는 선두 점 허용) — `ops/containers/`, `.github/workflows/` 모두 포함.
const _VC_PREFIX = '(?:\\.?[A-Za-z0-9][A-Za-z0-9._-]*[\\/\\\\])*';
// basename: (a) 확장자 파일 (b) 표준 bare 파일명(뒤에 .확장자가 오면 (a)에 양보) (c) 점파일
//   bare 파일은 관례적 접미사를 허용한다(Dockerfile.dev / Makefile.local) — 없으면 그 주장이 "파일 0건"이 된다.
const _VC_BASE = `(?:[A-Za-z0-9][\\w.-]*\\.(?:${_VC_FILE_EXTS})\\b|(?:${_VC_BARE_FILES})(?:\\.[A-Za-z0-9_-]+)?(?![\\w.-])|${_VC_DOTFILES}(?![\\w-]))`;
function _EVIDENCE_FILE_RE(flags = '') { return new RegExp(`${_VC_PREFIX}${_VC_BASE}`, flags); }

function _evidenceQuality(evidence) {
  const e = String(evidence || '');
  // codex 버그헌트 P2: basename 첫 글자에 숫자 허용 ('123.js' 등 숫자시작 실파일) — bin FILE_RE 와 정합.
  // 1.36.82: "파일을 언급했는가"의 정의가 두 곳(bin 추출기 · 여기)으로 갈리면 정직한 주장이 사유 없이 거부된다.
  //   판정을 단일 출처(_EVIDENCE_FILE_RE)로 통일한다.
  const hasFile = _EVIDENCE_FILE_RE().test(e);
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
  for (const g of gitSet) { if (g === c || g.endsWith('/' + c) || (g.indexOf('/') >= 0 && c.endsWith('/' + g))) return true; }  // 1.35.5: reverse match 는 git 경로가 다중세그먼트일 때만 — bare basename 충돌(src/test.js ↔ test.js) 차단
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

// 1.9.305 (사용자 명시): AI 인식론적 정직성 점검 — 모르는 걸 아는 척 / 정보 미수집 / 미검증 섣부른 판단 휴리스틱 탐지.
//   순수 함수(텍스트→findings). 휴리스틱 advisory — 단정/추정/외부참조 표현 vs 근거·수집 흔적 대조. opt-in 점검용.
function _epistemicHonestyCheck(text) {
  const t = String(text || '');
  const findings = [];
  // 공통: 근거/출처 흔적 (파일경로·URL·테스트결과·Exit·문서·api-skill·인용·조회 흔적)
  const hasSource = /(?:[\w./-]+\.(?:js|ts|tsx|jsx|py|go|rs|rb|md|json|ya?ml|toml|sql|sh)\b)|https?:\/\/|\bExit\s*[:=]|\d+\s*\/\s*\d+\s*(?:통과|passed)|\b(?:passed|passing)\b|근거[:：]|출처[:：]|api-skill|공식\s*문서|문서\s*(?:확인|참조|에\s*따르면)|읽었|조회(?:함|했|함\b)|확인(?:함|했|됨)|grep|로그[:：]/i.test(t);
  // 차원1: 모르는 걸 아는 척 — 단정 표현인데 근거 없음
  const definitive = /(반드시|항상|언제나|무조건|확실(?:히|함|하게)|당연히|틀림없|100\s*%|always|never|guaranteed|definitely|obviously|certainly)/i.test(t);
  if (definitive && !hasSource) findings.push({ dim: 'pretend-knowledge', severity: 'high', label: '근거 없는 단정', detail: '단정적 표현이 있으나 근거/출처(파일·문서·테스트·로그)가 없음 — 모르는 정보를 아는 척할 위험.' });
  // 차원2: 미검증 섣부른 판단 — 추정 표현 + 완료/성공 결론인데 근거 없음
  const assumption = /(아마|추정|것\s*같|듯\s*(?:하|싶)|probably|likely|maybe|perhaps|i\s*(?:think|assume|guess|believe|suppose)|should\s*(?:work|be|pass|fix)|생각(?:됩니다|된다|함|돼)|일\s*것|예상(?:됩니다|된다|됨)|짐작)/i.test(t);
  const conclusion = /(완료|done|성공|통과|해결(?:됨|했|함|되었)|fixed|resolved|works?\b|작동(?:함|한다|됨)|구현(?:됨|했|완료))/i.test(t);
  if (assumption && conclusion && !hasSource) findings.push({ dim: 'premature-judgment', severity: 'high', label: '검증 없는 섣부른 판단', detail: '가정·추정 표현과 완료·성공 결론이 함께 있으나 검증 근거가 없음 — 검증 없이 섣부르게 판단할 위험.' });
  // 차원3: 정보 미수집 — 외부 API/라이브러리/버전/스펙 언급인데 수집·근거 흔적 없음
  //   \bAPI\b(?!\.[a-z]) 로 파일경로(api.js/api.ts) 오탐 제외. 강한 근거(hasSource)나 수집 흔적(gathered) 있으면 통과.
  const externalRef = /(\bAPI\b(?!\.[a-z])|\bSDK\b|라이브러리|\blibrary\b|\bpackage\b|엔드포인트|\bendpoint\b|버전\s*\d|v\d+\.\d+|\bspec\b|rate\s*limit|레이트\s*리밋|문서에\s*따르면)/i.test(t);
  const gathered = /(https?:\/\/|api-skill|공식\s*문서|\bdocs?\b|문서\s*(?:확인|참조|읽)|읽었|조회(?:함|했)|확인(?:함|했|됨)|fetch|검색(?:함|했)|레퍼런스|reference)/i.test(t);
  if (externalRef && !gathered && !hasSource) findings.push({ dim: 'no-info-gathering', severity: 'medium', label: '외부 정보 미수집', detail: '외부 API/라이브러리/버전/스펙 언급이 있으나 정보 수집(공식문서·api-skill·조회) 흔적이 없음 — 정확한 정보를 먼저 수집 권장.' });
  return { ok: findings.length === 0, findings, dimensions: ['pretend-knowledge', 'premature-judgment', 'no-info-gathering'] };
}

module.exports = { _evidenceQuality, _parseEvidenceStats, _shellGuardAnalyze, _claimFileInGit, _epistemicHonestyCheck, _EVIDENCE_FILE_RE };
