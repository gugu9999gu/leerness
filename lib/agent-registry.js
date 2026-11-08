 
 
 
'use strict';

 
 
 
const EXTERNAL_AGENTS = [
  { id: 'claude',  bin: 'claude',  envFlag: 'LEERNESS_ENABLE_CLAUDE',  versionArgs: ['--version'], desc: 'Anthropic Claude Code CLI', descEn: 'Anthropic Claude Code CLI',
    installCmd: 'npm i -g @anthropic-ai/claude-code', installHint: 'https://docs.anthropic.com/en/docs/claude-code/setup' },
   
   
   
   
   
   
 
 
 
 
  { id: 'codex',   bin: 'codex',   envFlag: 'LEERNESS_ENABLE_CODEX',   versionArgs: ['--version'], desc: 'OpenAI Codex CLI (격리 sandbox)', descEn: 'OpenAI Codex CLI (isolated sandbox)',
    authCheck: { args: ['login', 'status'], timeoutMs: 8000, noPattern: 'not logged in|logged out|no credentials|run .*login|sign in', note: 'codex login status (실측 158ms · 모델 호출 없음)' },
    installCmd: 'npm i -g @openai/codex', installHint: 'https://github.com/openai/codex' },
   
   
   
  { id: 'agy',     bin: 'agy',     envFlag: 'LEERNESS_ENABLE_AGY',     versionArgs: ['--version'], desc: 'Google Antigravity CLI (멀티모달 에이전트, --yolo 워크스페이스 수정 가능)', descEn: 'Google Antigravity CLI (multimodal agent; --yolo can modify the workspace)',
    installCmd: 'npm i -g @google/antigravity-cli', installHint: 'https://antigravity.google.com (Antigravity IDE/CLI)' },
   
   
  { id: 'grok',    bin: 'grok',    envFlag: 'LEERNESS_ENABLE_GROK',    versionArgs: ['--version'], desc: 'xAI Grok CLI (커뮤니티 grok-cli, /model grok-beta 등)', descEn: 'xAI Grok CLI (community grok-cli; /model supports grok-beta)',
    installCmd: 'npm i -g @vibe-kit/grok-cli', installHint: 'https://github.com/superagent-ai/grok-cli (xAI API 키 필요 — /login 또는 GROK_API_KEY)' },
   
  { id: 'opencode', bin: 'opencode', envFlag: 'LEERNESS_ENABLE_OPENCODE', versionArgs: ['--version'], desc: 'opencode — 오픈소스 터미널 AI 코딩 에이전트 (provider-agnostic)', descEn: 'opencode — open-source terminal AI coding agent (provider-agnostic)',
    installCmd: 'npm i -g opencode-ai', installHint: 'https://opencode.ai (또는 curl -fsSL https://opencode.ai/install | bash)' },
  { id: 'qwen',    bin: 'qwen',    envFlag: 'LEERNESS_ENABLE_QWEN',    versionArgs: ['--version'], desc: 'Qwen Code CLI (Alibaba qwen3-coder 등)', descEn: 'Qwen Code CLI (Alibaba qwen3-coder and others)',
    installCmd: 'npm i -g @qwen-code/qwen-code', installHint: 'https://github.com/QwenLM/qwen-code (DASHSCOPE/OpenAI 호환 키)' },
  { id: 'aider',   bin: 'aider',   envFlag: 'LEERNESS_ENABLE_AIDER',   versionArgs: ['--version'], desc: 'Aider — git-aware 페어 프로그래밍 CLI (--model 임의 지정)', descEn: 'Aider — git-aware pair-programming CLI (custom model supported)',
    installCmd: 'python -m pip install aider-install && aider-install', installHint: 'https://aider.chat (pip install aider-chat · API 키 env)' },
  { id: 'goose',   bin: 'goose',   envFlag: 'LEERNESS_ENABLE_GOOSE',   versionArgs: ['--version'], desc: 'Goose — Block 오픈소스 범용 로컬 AI 에이전트 (MCP 확장)', descEn: "Goose — Block's open-source general local AI agent (MCP extensible)",
    installCmd: 'curl -fsSL https://github.com/block/goose/releases/latest/download/download_cli.sh | bash', installHint: 'https://block.github.io/goose (goose configure 로 provider/model 설정)' },
  { id: 'copilot', bin: 'gh',      envFlag: 'LEERNESS_ENABLE_COPILOT', versionArgs: ['copilot', '--version'], desc: 'GitHub Copilot CLI (gh copilot)', descEn: 'GitHub Copilot CLI (gh copilot)',
    installCmd: 'gh extension install github/gh-copilot', installHint: 'https://github.com/github/gh-copilot (gh CLI 선행 설치 필요)' },
   
  { id: 'ollama',  bin: 'ollama',  envFlag: 'LEERNESS_ENABLE_OLLAMA',  versionArgs: ['--version'], desc: 'Ollama 로컬 LLM (http://localhost:11434, llama3/qwen 등)', descEn: 'Ollama local LLM (http://localhost:11434; llama3/qwen and others)',
    installCmd: 'curl -fsSL https://ollama.com/install.sh | sh (또는 https://ollama.com/download)', installHint: 'ollama serve 실행 + ollama pull <model>' }
];

 
 
 
 
 
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
