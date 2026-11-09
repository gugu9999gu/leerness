 
 
'use strict';

function _shellGuardAnalyze(cmd, ctx) {
  const c = String(cmd || '');
  const shell = (ctx && ctx.shell) || 'unknown';
  const psVer = ctx && ctx.psVersion != null ? parseInt(ctx.psVersion, 10) : null;
  const issues = [];
  const isWinPowerShell = shell === 'powershell' && psVer != null && psVer < 6;   
   
  if (isWinPowerShell && /&&|\|\|/.test(c)) {   
    issues.push({ rule: 'ps5-chain', severity: 'error', detail: 'Windows PowerShell 5.1 은 && / || 연산자를 지원하지 않습니다 (PowerShell 7+ 부터 지원).', suggestion: 'A; if ($?) { B }  (조건부) 또는 A; B  (무조건) 로 분리. 또는 pwsh 7 설치.' });
  }
   
  if (shell === 'powershell' && /2>\s*\/dev\/null/.test(c)) {
    issues.push({ rule: 'ps-devnull', severity: 'error', detail: 'PowerShell 은 /dev/null 경로가 없습니다.', suggestion: '2>$null 사용 (PowerShell 리다이렉트).' });
  }
   
  if (shell === 'powershell' && /^[A-Z_][A-Z0-9_]*=[^\s]+\s+\S/.test(c.trim())) {
    issues.push({ rule: 'ps-inline-env', severity: 'error', detail: 'PowerShell 은 VAR=val cmd 형식의 inline 환경변수를 지원하지 않습니다.', suggestion: "$env:VAR='val'; cmd  로 분리." });
  }
   
  if (shell === 'powershell' && /\brm\s+-rf\b/.test(c)) {
    issues.push({ rule: 'ps-rm-rf', severity: 'warn', detail: 'PowerShell 에서 rm -rf 는 -rf 플래그 파싱 오류 가능 (rm 은 Remove-Item 별칭).', suggestion: 'Remove-Item -Recurse -Force <path> 사용.' });
  }
   
  if (shell === 'cmd' && /;/.test(c) && !/&&|\|\|/.test(c)) {
    issues.push({ rule: 'cmd-semicolon', severity: 'warn', detail: 'CMD 는 ; 를 명령 구분자로 처리하지 않습니다 (인자로 전달됨).', suggestion: 'A && B  (조건부) 또는 A & B  (무조건) 사용.' });
  }
   
  if (shell === 'powershell' && psVer == null && /&&|\|\|/.test(c)) {   
    issues.push({ rule: 'ps-version-unknown', severity: 'info', detail: 'PowerShell 버전 미상 — 5.1 이면 && 미지원, 7+ 이면 지원.', suggestion: '$PSVersionTable.PSVersion 확인. 안전하게 A; if ($?) { B } 권장.' });
  }
  return { shell, psVersion: psVer, issues };
}
 
 
 
 
 
 
 
 
const _VC_FILE_EXTS = 'webmanifest|properties|tscn|tres|godot|json5|prisma|swift|java|jsx|tsx|yaml|html|scss|sass|less|gltf|conf|json|toml|lock|mdx|xml|css|svg|yml|cfg|ini|env|php|sql|mjs|cjs|vue|svelte|pyi|md|js|ts|gd|cs|py|rb|go|rs|kt|sh|cpp|c|h';
 
const _VC_BARE_FILES = 'Dockerfile|Containerfile|Makefile|Gemfile|Procfile|Rakefile|Jenkinsfile|Vagrantfile|Caddyfile|Brewfile|Justfile|CODEOWNERS|LICENCE|LICENSE|NOTICE';
 
const _VC_DOTFILES = '\\.(?:gitignore|gitattributes|gitmodules|dockerignore|npmrc|npmignore|nvmrc|editorconfig|prettierrc|eslintrc|babelrc|browserslistrc)';
 
 
 
 
 
const _VC_PREFIX = '(?:\\.?[A-Za-z0-9_][A-Za-z0-9._-]*[\\/\\\\])*';
 
 
const _VC_BASE = `(?:[A-Za-z0-9_][\\w.-]*\\.(?:${_VC_FILE_EXTS})\\b|(?:${_VC_BARE_FILES})(?:\\.[A-Za-z0-9_-]+)?(?![\\w.-])|${_VC_DOTFILES}(?![\\w-]))`;
function _EVIDENCE_FILE_RE(flags = '') { return new RegExp(`${_VC_PREFIX}${_VC_BASE}`, flags); }

function _evidenceQuality(evidence) {
  const e = String(evidence || '');
   
   
   
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
  for (const g of gitSet) { if (g === c || g.endsWith('/' + c) || (g.indexOf('/') >= 0 && c.endsWith('/' + g))) return true; }   
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

 
 
 
 
 
 
 
 
function _epistemicHonestyCheck(text, opts) {
  const t = String(text || '');
  const claimedDone = !!(opts && opts.claimedDone);
  const findings = [];
   
  const hasSource = /(?:[\w./-]+\.(?:js|ts|tsx|jsx|py|go|rs|rb|md|json|ya?ml|toml|sql|sh)\b)|https?:\/\/|\bExit\s*[:=]|\d+\s*\/\s*\d+\s*(?:통과|passed)|\b(?:passed|passing)\b|근거[:：]|출처[:：]|api-skill|공식\s*문서|문서\s*(?:확인|참조|에\s*따르면)|읽었|조회(?:함|했|함\b)|확인(?:함|했|됨)|grep|로그[:：]/i.test(t);
   
  const definitive = /(반드시|항상|언제나|무조건|확실(?:히|함|하게)|당연히|틀림없|100\s*%|always|never|guaranteed|definitely|obviously|certainly)/i.test(t);
  if (definitive && !hasSource) findings.push({ dim: 'pretend-knowledge', severity: 'high', label: '근거 없는 단정', detail: '단정적 표현이 있으나 근거/출처(파일·문서·테스트·로그)가 없음 — 모르는 정보를 아는 척할 위험.' });
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
  const assumption = /(아마|추정|것\s*같|듯\s*(?:하|해|한|했|함|합|싶)|probably|likely|maybe|perhaps|i\s*(?:think|assume|guess|believe|suppose)|seems?\s*to|appears?\s*to|looks?\s*(?:like|good|fine|ok|resolved|fixed|done)|should\s*(?:work|be|pass|fix)|expect(?:ed|s)?\s*to|생각(?:됩니다|된다|함|돼)|일\s*것|예상(?:됩니다|된다|됨|돼)|짐작)/i.test(t);
   
   
   
   
   
   
   
  const unverified = /(아직\s*(?:안|못)\s*(?:돌|해|확인|테스트|검증)|테스트\s*(?:는\s*)?(?:아직|안\s*(?:했|돌))|확인(?:은|을)?\s*(?:못|안)\s*(?:해|했|함)|안\s*(?:봤|돌렸|해봤)|미확인|not\s*(?:yet\s*)?(?:tested|verified|checked)|have\s*not\s*(?:tested|verified|checked)|untested|unverified|unchecked|yet\s*to\s*(?:test|verify|check)|todo\s*:?\s*(?:verify|test))/i.test(t);
  const conclusion = /(완료|done|성공|통과|해결(?:됨|된|했|함|되었)|fixed|resolv(?:e|es|ed)|works?\b|complete[ds]?\b|implement(?:ed|s|ation)?\b|작동(?:함|한다|됨|할)|동작(?:함|한다|됨|할)|구현(?:됨|했|완료)|수정(?:됨|했|완료)|반영(?:됨|했|완료)|적용(?:됨|했|완료)|처리(?:됨|했|완료)|고쳤|고쳐(?:짐|졌)|끝냈|마무리(?:함|했|됨))/i.test(t);
   
   
   
   
   
   
   
   
   
  const execMarker = /\bExit\s*[:=]|\bCommand\s*[:=]|exit\s*code/i.test(t);
  const testOutcome = /\d+\s*(?:\/\s*\d+\s*)?(?:통과|passed|passing|성공)|\ball\s+(?:tests?\s+)?(?:passed|green)\b|BUILD\s+SUCCESS/i.test(t);
   
   
   
   
   
   
  const NEG = '(?:(?!안\\s|못\\s|않|없|\\bnot\\b|\\bno\\b)[^\\n])';
  const testWords = 'test|spec|unit|e2e|integration|verify|테스트|스펙|검증|점검';
  const ranWords = '실행|돌렸|돌림|통과|성공|passed|passing|ran\\b|run\\b|green|success';
  const testRun = new RegExp(`(?:${testWords})${NEG}{0,24}(?:${ranWords})`, 'i').test(t)
    || new RegExp(`(?:실행|ran|run)${NEG}{0,24}(?:${testWords})`, 'i').test(t);
  const ranSomething = execMarker || testOutcome || testRun;
  const refuted = claimedDone ? ranSomething : hasSource;
   
  if (assumption && conclusion && !hasSource) findings.push({ dim: 'premature-judgment', severity: 'high', label: '검증 없는 섣부른 판단', detail: '가정·추정 표현과 완료·성공 결론이 함께 있으나 검증 근거가 없음 — 검증 없이 섣부르게 판단할 위험.' });
   
   
   
   
   
   
   
   
   
  if (claimedDone && unverified && !refuted) findings.push({ dim: 'unverified-admission', severity: 'medium', label: '미검증 자백', detail: '완료로 표시했으나 evidence 가 스스로 "아직 확인하지 않았다"고 말하며 실행 증거(테스트 결과·Exit·실행 흔적)가 없음 — 차단하지는 않되 재확인 권장.' });
   
   
  const externalRef = /(\bAPI\b(?!\.[a-z])|\bSDK\b|라이브러리|\blibrary\b|\bpackage\b|엔드포인트|\bendpoint\b|버전\s*\d|v\d+\.\d+|\bspec\b|rate\s*limit|레이트\s*리밋|문서에\s*따르면)/i.test(t);
  const gathered = /(https?:\/\/|api-skill|공식\s*문서|\bdocs?\b|문서\s*(?:확인|참조|읽)|읽었|조회(?:함|했)|확인(?:함|했|됨)|fetch|검색(?:함|했)|레퍼런스|reference)/i.test(t);
  if (externalRef && !gathered && !hasSource) findings.push({ dim: 'no-info-gathering', severity: 'medium', label: '외부 정보 미수집', detail: '외부 API/라이브러리/버전/스펙 언급이 있으나 정보 수집(공식문서·api-skill·조회) 흔적이 없음 — 정확한 정보를 먼저 수집 권장.' });
  return { ok: findings.length === 0, findings, dimensions: ['pretend-knowledge', 'premature-judgment', 'no-info-gathering'] };
}

module.exports = { _evidenceQuality, _parseEvidenceStats, _shellGuardAnalyze, _claimFileInGit, _epistemicHonestyCheck, _EVIDENCE_FILE_RE };
