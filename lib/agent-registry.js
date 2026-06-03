// lib/agent-registry.js — 외부 AI CLI 에이전트 레지스트리 (순수 데이터, 부작용 0)
// 1.9.291 (UR-0025 2단계): bin/harness.js 단일 대형 파일에서 비파괴 분리. selftest(EXTERNAL_AGENTS 10종 / AGENT_SLASH_COMMANDS 5종)가 동작 검증.
// 런타임 변형 없음 — 사용자 override 는 _loadAgentSlashCommands 가 별도 객체에 병합(base 불변).
'use strict';

// 1.9.30: 외부 AI CLI 오케스트레이션 — claude/codex/agy/copilot 가용성 + 활성화 체크
// 사용자 정책: 환경변수로 활성화 명시 + 실제 PATH 존재 확인 + 메인이 sub-agent 분배 시 참조
// 1.9.32: installCmd 추가 — setup-agents 시 자동 설치 시도 가능
const EXTERNAL_AGENTS = [
  { id: 'claude',  bin: 'claude',  envFlag: 'LEERNESS_ENABLE_CLAUDE',  versionArgs: ['--version'], desc: 'Anthropic Claude Code CLI',
    installCmd: 'npm i -g @anthropic-ai/claude-code', installHint: 'https://docs.anthropic.com/en/docs/claude-code/setup' },
  { id: 'codex',   bin: 'codex',   envFlag: 'LEERNESS_ENABLE_CODEX',   versionArgs: ['--version'], desc: 'OpenAI Codex CLI (격리 sandbox)',
    installCmd: 'npm i -g @openai/codex', installHint: 'https://github.com/openai/codex' },
  // 1.9.248 (사용자 명시 UR-0017): Gemini CLI 제거 + Antigravity CLI (agy 명령어) 교체
  //   Google Antigravity 는 IDE 기반 멀티 모달 에이전트 도구. agy CLI 는 워크스페이스 직접 수정 가능 모드 지원.
  //   기존 LEERNESS_ENABLE_AGY 환경변수는 LEERNESS_ENABLE_AGY 로 교체. provider id 도 'agy' 로 통일.
  { id: 'agy',     bin: 'agy',     envFlag: 'LEERNESS_ENABLE_AGY',     versionArgs: ['--version'], desc: 'Google Antigravity CLI (멀티모달 에이전트, --yolo 워크스페이스 수정 가능)',
    installCmd: 'npm i -g @google/antigravity-cli', installHint: 'https://antigravity.google.com (Antigravity IDE/CLI)' },
  // 1.9.268: grok 정식 provider 승격 (1.9.266 후속 task) — 기존 슬래시 레지스트리(grok)만 보유하던 상태에서 EXTERNAL_AGENTS 로 편입.
  //   → provider cycle / setup-agents / dispatch / slash-commands --refresh probe 가 grok 도 자동 처리.
  { id: 'grok',    bin: 'grok',    envFlag: 'LEERNESS_ENABLE_GROK',    versionArgs: ['--version'], desc: 'xAI Grok CLI (커뮤니티 grok-cli, /model grok-beta 등)',
    installCmd: 'npm i -g @vibe-kit/grok-cli', installHint: 'https://github.com/superagent-ai/grok-cli (xAI API 키 필요 — /login 또는 GROK_API_KEY)' },
  // 1.9.277 (사용자 명시): 신규 CLI 에이전트 4종 — opencode/qwen/aider/goose. 활성 시 sub-agent dispatch/roles 라우팅 대상.
  { id: 'opencode', bin: 'opencode', envFlag: 'LEERNESS_ENABLE_OPENCODE', versionArgs: ['--version'], desc: 'opencode — 오픈소스 터미널 AI 코딩 에이전트 (provider-agnostic)',
    installCmd: 'npm i -g opencode-ai', installHint: 'https://opencode.ai (또는 curl -fsSL https://opencode.ai/install | bash)' },
  { id: 'qwen',    bin: 'qwen',    envFlag: 'LEERNESS_ENABLE_QWEN',    versionArgs: ['--version'], desc: 'Qwen Code CLI (Alibaba qwen3-coder 등)',
    installCmd: 'npm i -g @qwen-code/qwen-code', installHint: 'https://github.com/QwenLM/qwen-code (DASHSCOPE/OpenAI 호환 키)' },
  { id: 'aider',   bin: 'aider',   envFlag: 'LEERNESS_ENABLE_AIDER',   versionArgs: ['--version'], desc: 'Aider — git-aware 페어 프로그래밍 CLI (--model 임의 지정)',
    installCmd: 'python -m pip install aider-install && aider-install', installHint: 'https://aider.chat (pip install aider-chat · API 키 env)' },
  { id: 'goose',   bin: 'goose',   envFlag: 'LEERNESS_ENABLE_GOOSE',   versionArgs: ['--version'], desc: 'Goose — Block 오픈소스 범용 로컬 AI 에이전트 (MCP 확장)',
    installCmd: 'curl -fsSL https://github.com/block/goose/releases/latest/download/download_cli.sh | bash', installHint: 'https://block.github.io/goose (goose configure 로 provider/model 설정)' },
  { id: 'copilot', bin: 'gh',      envFlag: 'LEERNESS_ENABLE_COPILOT', versionArgs: ['copilot', '--version'], desc: 'GitHub Copilot CLI (gh copilot)',
    installCmd: 'gh extension install github/gh-copilot', installHint: 'https://github.com/github/gh-copilot (gh CLI 선행 설치 필요)' },
  // 1.9.146: Ollama 추가 (사용자 명시 요청 #3) — 로컬 LLM, HTTP API 11434
  { id: 'ollama',  bin: 'ollama',  envFlag: 'LEERNESS_ENABLE_OLLAMA',  versionArgs: ['--version'], desc: 'Ollama 로컬 LLM (http://localhost:11434, llama3/qwen 등)',
    installCmd: 'curl -fsSL https://ollama.com/install.sh | sh (또는 https://ollama.com/download)', installHint: 'ollama serve 실행 + ollama pull <model>' }
];

// 1.9.265 (사용자 명시 UR-0021): CLI AI 에이전트별 슬래시 명령어 레지스트리.
//   목적: 각 CLI (claude/codex/agy/grok/copilot) 의 슬래시 명령어를 큐레이션·기록하고, 서브에이전트 dispatch 시 알맞게 참조.
//   "항상 최신화" 3중 경로: (1) 빌트인은 leerness 릴리스마다 갱신(asOf), (2) 사용자 .harness/agent-slash-commands.json override 병합,
//   (3) [1.9.267 완료] `slash-commands --refresh` — 설치된 CLI 의 `--help` probe 로 자동 갱신(best-effort, 검출 0건이면 큐레이션 유지). 0-dep·offline-first.
//   주의: 외부 CLI 의 슬래시 명령은 버전마다 변동 → asOf 표기 + 사용자 override 우선. type='subcommand' 는 슬래시가 아닌 하위명령(예: gh copilot).
const AGENT_SLASH_COMMANDS = {
  claude: {
    label: 'Anthropic Claude Code', asOf: '1.9.265', invoke: 'slash',
    commands: [
      { cmd: '/help', desc: '명령 목록' },
      { cmd: '/clear', desc: '대화 컨텍스트 초기화' },
      { cmd: '/compact', desc: '대화 압축 (컨텍스트 절약)' },
      { cmd: '/init', desc: 'CLAUDE.md 생성/갱신' },
      { cmd: '/model', desc: '모델 전환' },
      { cmd: '/review', desc: 'PR/변경 리뷰' },
      { cmd: '/agents', desc: '서브에이전트 관리' },
      { cmd: '/mcp', desc: 'MCP 서버 상태/관리' },
      { cmd: '/memory', desc: '메모리 파일 편집' },
      { cmd: '/permissions', desc: '권한 설정' },
      { cmd: '/cost', desc: '토큰 비용 표시' },
      { cmd: '/resume', desc: '이전 세션 재개' },
      { cmd: '/config', desc: '설정' }
    ]
  },
  codex: {
    label: 'OpenAI Codex CLI', asOf: '1.9.265', invoke: 'slash',
    commands: [
      { cmd: '/init', desc: '프로젝트 컨텍스트 초기화' },
      { cmd: '/compact', desc: '대화 압축' },
      { cmd: '/diff', desc: '작업 트리 diff 표시' },
      { cmd: '/mention', desc: '파일 멘션/첨부' },
      { cmd: '/status', desc: '세션 상태/사용량' },
      { cmd: '/model', desc: '모델 전환' },
      { cmd: '/approvals', desc: '승인 모드 변경 (sandbox)' },
      { cmd: '/new', desc: '새 대화 시작' },
      { cmd: '/clear', desc: '컨텍스트 초기화' },
      { cmd: '/quit', desc: '종료' }
    ]
  },
  agy: {
    label: 'Google Antigravity CLI', asOf: '1.9.265', invoke: 'slash',
    note: '큐레이션(best-effort) — agy CLI 는 신규 도구라 슬래시 명령이 변동 가능. --refresh(2단계) 또는 사용자 override 권장.',
    commands: [
      { cmd: '/help', desc: '명령 목록' },
      { cmd: '/init', desc: '워크스페이스 초기화' },
      { cmd: '/model', desc: '모델 전환' },
      { cmd: '/new', desc: '새 세션' },
      { cmd: '/clear', desc: '컨텍스트 초기화' },
      { cmd: '/status', desc: '상태 표시' }
    ]
  },
  grok: {
    label: 'xAI Grok CLI', asOf: '1.9.268', invoke: 'slash',
    note: '1.9.268 정식 provider 승격 — slash-commands --refresh 로 자동 probe 가능. 커뮤니티 Grok CLI(@vibe-kit/grok-cli) 기준 큐레이션, 배포판마다 차이 가능.',
    commands: [
      { cmd: '/help', desc: '명령 목록' },
      { cmd: '/clear', desc: '대화 초기화' },
      { cmd: '/model', desc: '모델 전환 (grok-beta 등)' },
      { cmd: '/new', desc: '새 대화' },
      { cmd: '/login', desc: 'xAI API 키 로그인' },
      { cmd: '/exit', desc: '종료' }
    ]
  },
  copilot: {
    label: 'GitHub Copilot CLI (gh copilot)', asOf: '1.9.265', invoke: 'subcommand',
    note: '슬래시가 아닌 gh 하위명령. 호출 형식: gh copilot <sub> "<질의>".',
    commands: [
      { cmd: 'suggest', desc: '명령/코드 제안 (gh copilot suggest "...")' },
      { cmd: 'explain', desc: '명령 설명 (gh copilot explain "...")' },
      { cmd: 'config', desc: 'gh copilot 설정' }
    ]
  },
  // 1.9.277: 신규 4종 슬래시/세션 명령 (best-effort 큐레이션 — 배포판마다 차이 가능, 사용자 override 권장)
  opencode: {
    label: 'opencode', asOf: '1.9.277', invoke: 'slash',
    note: 'TUI 세션 슬래시 — 배포판마다 차이 가능.',
    commands: [
      { cmd: '/help', desc: '명령 목록' }, { cmd: '/new', desc: '새 세션' }, { cmd: '/models', desc: '모델 선택' },
      { cmd: '/init', desc: '프로젝트 컨텍스트' }, { cmd: '/undo', desc: '되돌리기' }, { cmd: '/share', desc: '세션 공유' }, { cmd: '/exit', desc: '종료' }
    ]
  },
  qwen: {
    label: 'Qwen Code CLI', asOf: '1.9.277', invoke: 'slash',
    note: 'Gemini CLI 계열 슬래시(qwen-code) 기준 큐레이션.',
    commands: [
      { cmd: '/help', desc: '명령 목록' }, { cmd: '/clear', desc: '컨텍스트 초기화' }, { cmd: '/memory', desc: '메모리 관리' },
      { cmd: '/tools', desc: '도구 목록' }, { cmd: '/model', desc: '모델 전환' }, { cmd: '/quit', desc: '종료' }
    ]
  },
  aider: {
    label: 'Aider', asOf: '1.9.277', invoke: 'slash',
    note: 'aider 세션 내 슬래시 명령 (in-chat commands).',
    commands: [
      { cmd: '/add', desc: '파일 컨텍스트 추가' }, { cmd: '/drop', desc: '파일 제거' }, { cmd: '/ask', desc: '코드 수정 없이 질문' },
      { cmd: '/run', desc: '셸 명령 실행' }, { cmd: '/test', desc: '테스트 실행' }, { cmd: '/diff', desc: '변경 diff' },
      { cmd: '/commit', desc: '커밋' }, { cmd: '/undo', desc: '마지막 커밋 취소' }, { cmd: '/help', desc: '도움말' }
    ]
  },
  goose: {
    label: 'Goose (Block)', asOf: '1.9.277', invoke: 'slash',
    note: 'goose 세션 내 명령 (배포판마다 차이 가능).',
    commands: [
      { cmd: '/?', desc: '도움말' }, { cmd: '/mode', desc: '모드 전환(auto/approve/chat)' }, { cmd: '/extension', desc: 'MCP 확장 관리' },
      { cmd: '/builtin', desc: '빌트인 확장' }, { cmd: '/exit', desc: '종료' }
    ]
  }
};

module.exports = { EXTERNAL_AGENTS, AGENT_SLASH_COMMANDS };
