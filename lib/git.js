// lib/git.js — git 실행 **단일** 초크포인트 (1.36.140)
//
//   왜 모듈로 옮겼나: 1.36.135/139 가 `bin/leerness.js` 의 초크포인트에만 환경 세척을 넣었고,
//   `lib/drift.js` 와 `lib/session-close.js` 는 같은 이름의 함수를 **복제**해 두고 세척이 없었다.
//   실측(재검수 라운드): 저장소 A 에서 `drift check --auto-fix` 를 돌리는데 환경에 `GIT_DIR=B/.git` 이 있으면
//   **B 의 브랜치 50개가 지워졌다**(60 → 10). 대조군(GIT_DIR 없음)은 35 → 35, 0건.
//   `git branch -d` 를 부르는 쪽이 세척 없는 복제본이었기 때문이다.
//
//   기존 e2e 가드는 "인라인 배열 형태의 직접 호출 0건" 만 셌다 — 세 복제본이 전부 변수 형태였으므로
//   **모양은 통과하고 성질은 새는** 상태였다. 가드가 밟지 않는 경로는 가드가 지키지 못한다.
//   그래서 세척을 각 파일에 다시 심지 않고, 실행 지점 자체를 하나로 만든다.
'use strict';
const { spawnPortableSync } = require('./portable-process');

//   우리는 항상 `-C <root>` 또는 `cwd` 로 대상을 명시한다. 그 명시를 **덮어쓰는** 환경변수만 걷어낸다.
//   ⚠ `GIT_*` 전체를 접두로 쓸어내지 않는다 — `GIT_AUTHOR_NAME` / `GIT_EDITOR` / `GIT_SSH_COMMAND` 처럼
//     사용자 설정을 지우면 정상 동작이 깨진다. 지우는 것은 **저장소 위치를 바꾸는 것들**로 한정한다.
//   1.36.140 (재검수): 목록을 **클래스로** 넓혔다 — 지적은 한 변수였지만 같은 성질의 이웃이 더 있었다.
//     · `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` / `GIT_CONFIG` / `GIT_CONFIG_PARAMETERS`
//       — **한 번의 실행에만** 사는 설정 주입이다. 이걸로 `core.hooksPath` 를 주면 우리가 훅을 *다른 저장소*
//       디렉토리에 쓰고, 그 환경변수가 사라진 뒤에는 지목한 저장소에 강제가 **아예 없다**
//       (실측: foreign=True, target=False). 설치는 지속되는 변경이므로 한 번짜리 주입 위에 세우지 않는다.
//   ⚠ `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` 은 **걷어내지 않는다** — 그것은 사용자의 설정 파일을 가리키는
//     지속 설정이고, git 이 사용자 커밋에서도 똑같이 쓴다. 그 경우의 `core.hooksPath` 는 정직하게 따르되
//     `hooksPathShared: true` 로 **고지**한다(실측 확인).
//   ⚠ `GIT_CONFIG_NOSYSTEM` 도 **걷어내지 않는다.** 저장소 대상을 바꾸는 값이 아니라 시스템 설정을 읽을지의
//     실행 의미다. 이것만 내부 git 에서 지우면 설치기는 system `core.hooksPath` 에 훅을 쓰고, 같은 셸의 실제
//     `git commit` 은 기본 `.git/hooks` 를 보게 되어 강제를 우회한다. 현재 호출자가 시스템 설정을 숨기면
//     설치기 역시 같은 설정을 보아야 한다.
//   ⚠ `GIT_CEILING_DIRECTORIES` 도 **걷어내지 않는다.** 한 번 넣었다가 뺐다 — 내가 틀렸다.
//     "정상 저장소를 not-a-repo 로 오판" 이라 읽었지만, 그 환경변수는 사용자가 **일부러 그은 경계**이고
//     git 은 그 경계 밖으로 올라가지 않는 것이 정답이다. 우리가 걷어내면 사용자가 막아 둔 **상위 저장소**를
//     찾아 거기에 훅을 설치한다(재검수가 지적, 더 나쁜 결과). 경계를 존중하고, 그 아래에서 저장소를 못 찾으면
//     `not-a-repo` 라고 정직하게 답한다.
const GIT_LOCATION_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE',
  'GIT_CONFIG', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS'];
const _DROP = new Set(GIT_LOCATION_ENV);
//   `GIT_CONFIG_KEY_0`, `GIT_CONFIG_VALUE_0`, … 은 개수가 정해져 있지 않으므로 접두로 판별한다.
const _DROP_PREFIX = /^GIT_CONFIG_(KEY|VALUE)_\d+$/;
const _shouldDrop = (name) => { const u = String(name).toUpperCase(); return _DROP.has(u) || _DROP_PREFIX.test(u); };

//   ⚠ 인자 배열을 **변수로 먼저** 만든다. 인라인 배열 호출 형태를 여기 두면
//     이 함수가 자기 자신을 초크포인트 전환 대상으로 잡아 무한 재귀가 된다
//     (실제로 한 번 그렇게 만들어 스택 오버플로로 모든 git 조회가 'git-error' 가 됐다).
//     가드도 이 형태를 세므로 주석에도 적지 않는다(자기참조 트랩).
//   1.36.146 (재검수 P1, 재현): dry-run 가드는 파일만 봤고 **git 부작용**은 그대로였다 —
//     `release cleanup --apply --dry-run` 이 브랜치 60 → 10 으로 실제 삭제했다.
//     git 도 초크포인트가 하나니, 상태를 바꾸는 하위명령을 여기서 거절한다.
const _GIT_MUTATING = new Set(['add', 'rm', 'mv', 'commit', 'merge', 'rebase', 'reset', 'checkout', 'switch',
  'restore', 'branch', 'tag', 'push', 'fetch', 'pull', 'clone', 'init', 'worktree', 'stash', 'apply', 'cherry-pick',
  'revert', 'clean', 'gc', 'prune', 'update-ref', 'symbolic-ref', 'notes', 'submodule', 'config', 'remote']);
//   조회성 하위명령은 이름이 같아도 플래그로 갈라진다 — 읽기만 하는 형태는 통과시킨다.
const _GIT_READ_ONLY_FORM = (sub, rest) => {
  if (sub === 'branch') return !rest.some((x) => /^-(d|D|m|M|c|C)$|^--(delete|move|copy|set-upstream|unset-upstream|edit-description)/.test(x));
  if (sub === 'config') return rest.includes('--get') || rest.includes('--get-all') || rest.includes('--list') || rest.includes('--show-scope') || rest.includes('-l');
  if (sub === 'symbolic-ref') return rest.includes('-q') || rest.includes('--short') || rest.length <= 1;
  if (sub === 'worktree') return rest[0] === 'list';
  if (sub === 'stash') return rest[0] === 'list' || rest[0] === 'show';
  if (sub === 'tag') return !rest.some((x) => /^-(d|a|s|f)$|^--(delete|annotate|sign|force)/.test(x));
  if (sub === 'notes') return rest[0] === 'list' || rest[0] === 'show';
  if (sub === 'submodule') return rest[0] === 'status' || rest[0] === 'summary';
  if (sub === 'remote') return rest.length === 0 || rest[0] === '-v' || rest[0] === 'show' || rest[0] === 'get-url';
  return false;
};
let _gitDry = false;
function setGitDryRun(on) { _gitDry = !!on; }
function gitSpawn(args, opts) {
  if (_gitDry) {
    //   `-C <path>` 같은 선행 옵션을 건너뛰고 첫 하위명령을 찾는다.
    const a = Array.isArray(args) ? args.map(String) : [];
    let i = 0;
    while (i < a.length && (a[i].startsWith('-') || (i > 0 && a[i - 1] === '-C'))) i++;
    const sub = a[i] || '';
    if (_GIT_MUTATING.has(sub) && !_GIT_READ_ONLY_FORM(sub, a.slice(i + 1))) {
      throw Object.assign(new Error(`--dry-run 인데 git ${sub} 를 실행하려 했습니다`), { code: 'E_DRY_RUN_WRITE', file: `git ${sub}` });
    }
  }
  const _argv = ['--no-optional-locks', ...args];   // 사용자 저장소의 `.git/index` 재기록을 막는다(실측)
  //   ⚠ 키를 **접어서** 비교한다 — Windows 환경변수는 대소문자를 구분하지 않는데 JS 객체 키는 구분해서,
  //     대문자만 지웠을 때 소문자 `git_dir` 로 그대로 우회됐다(실측: 남의 저장소 훅이 1 → 2).
  const _env = Object.assign({}, (opts && opts.env) || process.env);
  for (const k of Object.keys(_env)) if (_shouldDrop(k)) delete _env[k];
  // Never let a caller re-enable a shell around argv.  Besides Node DEP0190,
  // `shell:true` turns an otherwise-safe array element containing `&`, `|`,
  // or redirection into a second command. Git is a native executable on every
  // supported platform, so no shell wrapper is needed.
  return spawnPortableSync('git', _argv, Object.assign({}, opts, { env: _env, shell: false }));
}

module.exports = { gitSpawn, GIT_LOCATION_ENV, _shouldDrop, setGitDryRun };
