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
// 1.36.109 (codex 검수 P2): `pyi` 추가 — 타입 스텁(PEP 561)은 실제 산출물인데 추출조차 안 돼
//   `pkg/__init__.pyi` 만 인용한 정직한 주장이 "파일 0건" 으로 거부됐다. 길이 내림차순 규칙상 `py` 앞에 둔다.
const _VC_FILE_EXTS = 'webmanifest|properties|tscn|tres|godot|json5|prisma|swift|java|jsx|tsx|yaml|html|scss|sass|less|gltf|conf|json|toml|lock|mdx|xml|css|svg|yml|cfg|ini|env|php|sql|mjs|cjs|vue|svelte|pyi|md|js|ts|gd|cs|py|rb|go|rs|kt|sh|cpp|c|h';
// 확장자 없는 표준 파일명 — 임의의 대문자 단어가 아니라 정확한 철자만(대소문자 구분)으로 FP 억제.
const _VC_BARE_FILES = 'Dockerfile|Containerfile|Makefile|Gemfile|Procfile|Rakefile|Jenkinsfile|Vagrantfile|Caddyfile|Brewfile|Justfile|CODEOWNERS|LICENCE|LICENSE|NOTICE';
// 점파일 — 확장자 규칙으로는 잡히지 않지만 명백한 파일 참조.
const _VC_DOTFILES = '\\.(?:gitignore|gitattributes|gitmodules|dockerignore|npmrc|npmignore|nvmrc|editorconfig|prettierrc|eslintrc|babelrc|browserslistrc)';
// 경로 접두: 0개 이상 세그먼트(각 세그먼트는 선두 점 허용) — `ops/containers/`, `.github/workflows/` 모두 포함.
// 1.36.109 (완료게이트 사냥): 첫 글자에 `_` 가 없어서 `src/_helpers.js` 가 `helpers.js` 로 **잘려서** 추출됐다 —
//   "파일 없음" 이 아니라 **없는 파일을 찾아** files-missing 으로 정직한 주장을 거부했다(실측).
//   흔한 이름들이 여기 걸린다: Next.js `pages/_app.tsx` · `_document.tsx` · 파이썬 `__init__.py` · `_private/…`.
//   false-BLOCK 은 false-PASS 보다 나쁘다 — 사용자는 이유 없이 막히고 게이트를 끄게 된다.
const _VC_PREFIX = '(?:\\.?[A-Za-z0-9_][A-Za-z0-9._-]*[\\/\\\\])*';
// basename: (a) 확장자 파일 (b) 표준 bare 파일명(뒤에 .확장자가 오면 (a)에 양보) (c) 점파일
//   bare 파일은 관례적 접미사를 허용한다(Dockerfile.dev / Makefile.local) — 없으면 그 주장이 "파일 0건"이 된다.
const _VC_BASE = `(?:[A-Za-z0-9_][\\w.-]*\\.(?:${_VC_FILE_EXTS})\\b|(?:${_VC_BARE_FILES})(?:\\.[A-Za-z0-9_-]+)?(?![\\w.-])|${_VC_DOTFILES}(?![\\w-]))`;
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
// 1.36.110 (T-0099): `opts.claimedDone` — 호출부가 **이미 완료 주장임을 아는** 경우.
//   verify-claim 은 status 가 done 인 행에만 이 검사를 돌린다(claimsChecked). 그 문맥에서
//   "산문에 완료 낱말이 있는가" 를 다시 요구하는 건 중복이고, 실제로 그것이 재현율의 병목이었다 —
//   홀드아웃에서 놓친 6건 중 5건이 결론 어휘 미등록("마쳤/잡은/shipped/applied/gone")이었다.
//   완료 동의어를 두 언어로 계속 채우는 건 끝이 없다(휴리스틱 토끼굴). 호출부가 아는 사실을 받는다.
//   기본값은 종전 그대로 — `honesty-check --text` 같은 독립 표면의 동작은 바뀌지 않는다.
function _epistemicHonestyCheck(text, opts) {
  const t = String(text || '');
  const claimedDone = !!(opts && opts.claimedDone);
  const findings = [];
  // 공통: 근거/출처 흔적 (파일경로·URL·테스트결과·Exit·문서·api-skill·인용·조회 흔적)
  const hasSource = /(?:[\w./-]+\.(?:js|ts|tsx|jsx|py|go|rs|rb|md|json|ya?ml|toml|sql|sh)\b)|https?:\/\/|\bExit\s*[:=]|\d+\s*\/\s*\d+\s*(?:통과|passed)|\b(?:passed|passing)\b|근거[:：]|출처[:：]|api-skill|공식\s*문서|문서\s*(?:확인|참조|에\s*따르면)|읽었|조회(?:함|했|함\b)|확인(?:함|했|됨)|grep|로그[:：]/i.test(t);
  // 차원1: 모르는 걸 아는 척 — 단정 표현인데 근거 없음
  const definitive = /(반드시|항상|언제나|무조건|확실(?:히|함|하게)|당연히|틀림없|100\s*%|always|never|guaranteed|definitely|obviously|certainly)/i.test(t);
  if (definitive && !hasSource) findings.push({ dim: 'pretend-knowledge', severity: 'high', label: '근거 없는 단정', detail: '단정적 표현이 있으나 근거/출처(파일·문서·테스트·로그)가 없음 — 모르는 정보를 아는 척할 위험.' });
  // 차원2: 미검증 섣부른 판단 — 추정 표현 + 완료/성공 결론인데 근거 없음
  // 1.36.110 (T-0099): 이 판정은 **언어에 상관없이** 같아야 하는데 실측 재현율이 영어 2/4 · 한국어 0/8 이었다.
  //   같은 뜻의 주장이 표기 언어에 따라 통과/차단이 갈리면 그건 판정이 아니라 우연이다
  //   (`should work, will test later` 는 잡고 `아마 동작할 겁니다. 나중에 테스트 예정.` 은 통과시켰다).
  //   측정 결과 원인은 둘이었다:
  //   (a) 결론 어휘가 좁다 — `작동` 은 있는데 `동작` 이 없고, `수정했`·`반영`·`적용` 이 빠져 있었다.
  //   (b) **미검증 자백** 신호가 아예 없었다 — "테스트는 아직 안 돌렸지만 완료했습니다" 에는 추정 표현이
  //       하나도 없다. 이건 헤지가 아니라 **자기모순**이라 헤지보다 강한 신호다.
  //   강화 전에 FP 코퍼스를 먼저 고정했다(정직한 주장 무탐지 100%). `!hasSource` 가 그 방어선이고,
  //   근거를 댄 주장은 어떤 표현을 쓰든 통과한다 — "20/20 통과 … 성능은 추후 측정 예정" 같은 정직한 문장이 그 예다.
  //   ⚠ 세 목록은 **언어 대칭**을 유지해야 한다. 한쪽에만 표현을 더하면 같은 뜻의 주장이 표기 언어에 따라
  //   갈린다 — 실제로 1차 강화에서 4쌍이 갈렸고(ko HIT / en MISS 등) 대칭 검사가 그걸 잡았다.
  //   새 표현을 넣을 때는 반대 언어의 짝을 같이 넣고, 코퍼스에 그 쌍을 추가한다.
  //   ⚠ 한국어 **음절 합성** 함정: `듯\s*(?:하|싶)` 는 "듯하다" 는 잡지만 "듯합니다" 는 못 잡는다 —
  //   하 + ㅂ 이 한 음절 `합` 으로 합쳐지기 때문이다. 대칭 검사가 이 한 글자 차이로 ko/en 판정이 갈린 것을 잡았다.
  //   한국어 표현을 넣을 때는 활용형(하/해/한/했/함/합)을 함께 적어야 한다.
  const assumption = /(아마|추정|것\s*같|듯\s*(?:하|해|한|했|함|합|싶)|probably|likely|maybe|perhaps|i\s*(?:think|assume|guess|believe|suppose)|seems?\s*to|appears?\s*to|looks?\s*(?:like|good|fine|ok|resolved|fixed|done)|should\s*(?:work|be|pass|fix)|expect(?:ed|s)?\s*to|생각(?:됩니다|된다|함|돼)|일\s*것|예상(?:됩니다|된다|됨|돼)|짐작)/i.test(t);
  // 미검증 자백 — "아직 안 했다 / 나중에 하겠다" 를 스스로 말하면서 완료를 주장하는 형태.
  //   `(?!\s*없)` 는 "검증 필요 없는 오타 수정" 같은 **반대 의미**를 배제한다(FP 코퍼스가 잡아냈다).
  //   ⚠ **미래 범위 표현은 넣지 않는다** — "추후 확인 예정"·"will check later" 는 두 가지를 뜻할 수 있다:
  //   (a) 이 작업을 검증하지 않았다 (b) 앞으로 더 볼 것이 남았다. 정규식으로 둘을 가를 수 없다.
  //   자체 FP 헌트에서 그 표현들이 문서 수정·설정 변경·의존성 bump·revert 를 막았다(실측 4건) —
  //   전부 정직한 완료 주장이다. 애매하면 통과시킨다: false-BLOCK 이 false-PASS 보다 나쁘다.
  //   여기 남기는 것은 **이미 일어난 일에 대한 부정**뿐이다("아직 안 돌렸다"·"not tested yet"·"unchecked").
  const unverified = /(아직\s*(?:안|못)\s*(?:돌|해|확인|테스트|검증)|테스트\s*(?:는\s*)?(?:아직|안\s*(?:했|돌))|확인(?:은|을)?\s*(?:못|안)\s*(?:해|했|함)|안\s*(?:봤|돌렸|해봤)|미확인|not\s*(?:yet\s*)?(?:tested|verified|checked)|have\s*not\s*(?:tested|verified|checked)|untested|unverified|unchecked|yet\s*to\s*(?:test|verify|check)|todo\s*:?\s*(?:verify|test))/i.test(t);
  const conclusion = /(완료|done|성공|통과|해결(?:됨|된|했|함|되었)|fixed|resolv(?:e|es|ed)|works?\b|complete[ds]?\b|implement(?:ed|s|ation)?\b|작동(?:함|한다|됨|할)|동작(?:함|한다|됨|할)|구현(?:됨|했|완료)|수정(?:됨|했|완료)|반영(?:됨|했|완료)|적용(?:됨|했|완료)|처리(?:됨|했|완료)|고쳤|고쳐(?:짐|졌)|끝냈|마무리(?:함|했|됨))/i.test(t);
  // 1.36.110 (행위 가드가 순수 측정의 오류를 잡았다): `hasSource` 는 "파일을 언급했는가" 다.
  //   그런데 verify-claim 의 evidence 는 **거의 항상 파일을 인용한다**(안 하면 files-missing/unverifiable 로 이미 막힌다) —
  //   그래서 이 판정이 정작 필요한 문맥에서 도달 불가였다(실제 done 이력 139건 발화 0 의 진짜 이유).
  //   "아직 테스트 안 했다" 를 반박하는 것은 파일 이름이 아니라 **실행 증거**다. done 문맥에서만 기준을 그것으로 좁힌다.
  //   기본 표면(`honesty-check --text`)의 판정은 종전 그대로 — 범위를 넘어 조이지 않는다.
  //   ⚠ 러너 **이름을 열거하지 않는다**. 처음엔 npm/pytest/cargo/jest… 를 나열했는데, 자체 FP 헌트에서
  //   Gradle · .NET · RSpec · PHPUnit · Elixir · Swift · 커스텀 스크립트가 **실제로 테스트를 돌렸는데도** 막혔다.
  //   생태계마다 러너를 채우는 건 끝이 없다(완료 동의어와 같은 토끼굴). 러너 이름이 아니라
  //   **실행/결과의 흔적**을 본다: 실행 마커(Exit/Command) · 결과 수치 · 테스트 어휘 + 실행/통과 낱말.
  const execMarker = /\bExit\s*[:=]|\bCommand\s*[:=]|exit\s*code/i.test(t);
  const testOutcome = /\d+\s*(?:\/\s*\d+\s*)?(?:통과|passed|passing|성공)|\ball\s+(?:tests?\s+)?(?:passed|green)\b|BUILD\s+SUCCESS/i.test(t);
  // 테스트/검증 어휘가 **실행·통과 낱말과 가까이** 있으면 실행 흔적으로 본다(러너 무관).
  //   ⚠ **부정을 건너뛰면 안 된다**: 처음엔 단순히 "테스트 낱말 … 실행/통과" 로 잡았는데,
  //   그러면 `테스트는 아직 안 돌렸지만` 이 "테스트를 돌렸다" 로 읽혀 이 라운드의 대표 케이스가 통과했다.
  //   사이에 부정어(안/못/않/없/not/no)가 오면 실행 흔적으로 세지 않는다(tempered 매칭).
  //   부정어는 **뒤에 공백이 오는 것만** 본다 — "안정성"·"못지않게" 같은 낱말을 부정으로 오인하면
  //   실행 흔적을 못 세고, 그건 곧 정직한 주장의 오차단으로 이어진다.
  const NEG = '(?:(?!안\\s|못\\s|않|없|\\bnot\\b|\\bno\\b)[^\\n])';
  const testWords = 'test|spec|unit|e2e|integration|verify|테스트|스펙|검증|점검';
  const ranWords = '실행|돌렸|돌림|통과|성공|passed|passing|ran\\b|run\\b|green|success';
  const testRun = new RegExp(`(?:${testWords})${NEG}{0,24}(?:${ranWords})`, 'i').test(t)
    || new RegExp(`(?:실행|ran|run)${NEG}{0,24}(?:${testWords})`, 'i').test(t);
  const ranSomething = execMarker || testOutcome || testRun;
  const refuted = claimedDone ? ranSomething : hasSource;
  // 종전 차원(추정 표현 + 결론 + 근거 없음)은 **그대로** 유지한다 — 기존 사용자의 게이팅 동작을 바꾸지 않는다.
  if (assumption && conclusion && !hasSource) findings.push({ dim: 'premature-judgment', severity: 'high', label: '검증 없는 섣부른 판단', detail: '가정·추정 표현과 완료·성공 결론이 함께 있으나 검증 근거가 없음 — 검증 없이 섣부르게 판단할 위험.' });
  // 1.36.110 (T-0099) — **권고(medium)로 낸다. 차단하지 않는다.** 왜 그렇게 정했는지 남긴다:
  //   이 신호를 차단으로 쓰려고 두 라운드를 넓혔는데, 자체 FP 헌트가 6건(실제로 테스트를 돌린 Gradle·.NET·
  //   RSpec·PHPUnit·Elixir·Swift 등)을, 외부 검수가 3건을 더 찾았다. 근본 이유 셋:
  //   (a) 직접 자백 표현이 두 언어에서 유계가 아니다("아직 테스트를 수행하지 않았습니다" 같은 어순 변형).
  //   (b) "검증 안 함" · "부분만 검증" · "해당 없음(문서 수정)" 을 정규식으로 가를 수 없다.
  //   (c) evidence 에 `Exit: 0` 한 줄만 적어도 반박된다 — 차단은 쉽게 우회되고, 그만큼 일관되지 못하다.
  //   가끔 정직한 작업을 막고 자주 놓치는 게이트는 **명확한 권고보다 나쁘다**. 차단으로 올리려면
  //   산문 파싱이 아니라 도구 자신의 실행 증거(`--run-tests` 결과)를 근거로 삼아야 한다 — 그건 별도 과제다.
  //   `unverified` 는 호출부가 done 을 보증할 때만 본다(기본 표면 동작 불변 약속을 지키기 위해).
  if (claimedDone && unverified && !refuted) findings.push({ dim: 'unverified-admission', severity: 'medium', label: '미검증 자백', detail: '완료로 표시했으나 evidence 가 스스로 "아직 확인하지 않았다"고 말하며 실행 증거(테스트 결과·Exit·실행 흔적)가 없음 — 차단하지는 않되 재확인 권장.' });
  // 차원3: 정보 미수집 — 외부 API/라이브러리/버전/스펙 언급인데 수집·근거 흔적 없음
  //   \bAPI\b(?!\.[a-z]) 로 파일경로(api.js/api.ts) 오탐 제외. 강한 근거(hasSource)나 수집 흔적(gathered) 있으면 통과.
  const externalRef = /(\bAPI\b(?!\.[a-z])|\bSDK\b|라이브러리|\blibrary\b|\bpackage\b|엔드포인트|\bendpoint\b|버전\s*\d|v\d+\.\d+|\bspec\b|rate\s*limit|레이트\s*리밋|문서에\s*따르면)/i.test(t);
  const gathered = /(https?:\/\/|api-skill|공식\s*문서|\bdocs?\b|문서\s*(?:확인|참조|읽)|읽었|조회(?:함|했)|확인(?:함|했|됨)|fetch|검색(?:함|했)|레퍼런스|reference)/i.test(t);
  if (externalRef && !gathered && !hasSource) findings.push({ dim: 'no-info-gathering', severity: 'medium', label: '외부 정보 미수집', detail: '외부 API/라이브러리/버전/스펙 언급이 있으나 정보 수집(공식문서·api-skill·조회) 흔적이 없음 — 정확한 정보를 먼저 수집 권장.' });
  return { ok: findings.length === 0, findings, dimensions: ['pretend-knowledge', 'premature-judgment', 'no-info-gathering'] };
}

module.exports = { _evidenceQuality, _parseEvidenceStats, _shellGuardAnalyze, _claimFileInGit, _epistemicHonestyCheck, _EVIDENCE_FILE_RE };
