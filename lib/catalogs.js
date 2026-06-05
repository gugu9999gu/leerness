// lib/catalogs.js — capability/adapter/reuse 정적 데이터 카탈로그 (순수 데이터, 부작용 0)
// 1.9.295 (UR-0025 4단계): bin/harness.js 에서 비파괴 분리. selftest(CAPABILITY_SURFACE 6영역 + ADAPTERS + REUSE)가 동작 검증.
// 런타임 변형 없음 — capabilitiesCmd/adapterCmd/_reuseDetect/reuseCheckCmd 소비처 모두 읽기 전용.
'use strict';

const CAPABILITY_SURFACE = {
  filesystem:        { risk: 'low',    desc: '.harness/ 메타파일 생성·갱신, 변경 전 .harness/archive/ 자동 백업. 소스코드는 직접 수정 안 함.', optOut: '핵심 동작 (백업으로 보호)' },
  network:           { risk: 'low',    desc: 'npm 최신 버전 비교(update --check)만. 그 외 외부 URL 자동 fetch 안 함.', optOut: 'LEERNESS_OFFLINE=1' },
  childProcess:      { risk: 'medium', desc: 'git(명시 명령 시 status/commit/push), npm test(verify-code), 외부 CLI --version 감지. 셸 spawn.', optOut: 'verify 계열 한정 · 외부 CLI 는 opt-in' },
  externalAgents:    { risk: 'medium', desc: 'agents dispatch/multi — 외부 AI CLI(claude/codex/agy/grok/copilot) 호출. 기본은 명령 텍스트만 생성, multi --execute 시 실제 spawn.', optOut: 'LEERNESS_ENABLE_* 미설정 시 비활성 (기본 off)' },
  automationBridges: { risk: 'high',   desc: 'web(playwright)/pc(robotjs)/lsp(typescript) 브리지 — opt-in 의존성. pc 는 마우스/키보드 제어(full 권한).', optOut: '의존성 미설치 시 비활성 (기본 off, 명시 설치 필요)' },
  claudeHook:        { risk: 'low',    desc: 'init 시 .claude/settings.local.json 에 SessionStart hook(update --check) 설치.', optOut: 'leerness init . --no-auto-update' }
};
const POWERFUL_COMMANDS = [
  { cmd: 'init',                   note: '.harness/ 50+ 파일 + .claude hook 생성 (변경 전 백업)' },
  { cmd: 'update --yes',           note: '자동 마이그레이션 — 메타파일 갱신' },
  { cmd: 'agents multi --execute', note: '외부 AI CLI 실제 spawn (병렬 실행)' },
  { cmd: 'release publish / sync-main', note: 'git push + npm publish + GitHub release' },
  { cmd: 'pc <click|type|...>',    note: '마우스/키보드 제어 (robotjs, full 권한)' },
  { cmd: 'web <...>',              note: '헤드리스 브라우저 자동화 (playwright)' },
  { cmd: 'setup-agents',           note: '외부 CLI 활성화 + 자동 설치 시도' }
];
const ADAPTERS = {
  claude:   { label: 'Anthropic Claude Code', keys: ['CLAUDE.md', '.claude/commands/handoff.md', '.claude/commands/session-close.md', '.claude/commands/audit.md', '.claude/commands/lazy-detect.md', '.claude/commands/update.md', '.claude/skills/leerness.md'], mcp: true },
  cursor:   { label: 'Cursor', keys: ['.cursor/rules/leerness.mdc'], mcp: true },
  copilot:  { label: 'GitHub Copilot', keys: ['.github/copilot-instructions.md'], mcp: false },
  codex:    { label: 'OpenAI Codex CLI', keys: ['AGENTS.md'], mcp: true },
  goose:    { label: 'Goose (Block)', keys: ['AGENTS.md'], mcp: true },
  gemini:   { label: 'Gemini CLI / Antigravity', keys: ['AGENTS.md'], mcp: false },
  opencode: { label: 'opencode', keys: ['AGENTS.md'], mcp: true },
  aider:    { label: 'Aider', keys: ['AGENTS.md'], mcp: false },
  qwen:     { label: 'Qwen Code', keys: ['AGENTS.md'], mcp: false }
};
const REUSE_CATEGORIES = [
  { key: 'auth', kw: ['auth', 'login', 'oauth', 'jwt', 'session', '인증', '로그인', '토큰'], candidates: 'auth.js(NextAuth), lucia, passport, jose(JWT)' },
  { key: 'http', kw: ['http client', 'fetch', 'api client', 'request', 'rest client', 'axios'], candidates: 'axios, ky, got, undici(내장 fetch)' },
  { key: 'date', kw: ['date', 'time', 'datetime', 'timezone', '날짜', '시간', '달력'], candidates: 'date-fns, dayjs, luxon, Temporal(표준)' },
  { key: 'validation', kw: ['validation', 'schema', 'validate', 'parse input', '검증', '유효성', '스키마'], candidates: 'zod, valibot, yup, joi' },
  { key: 'state', kw: ['state management', 'store', 'global state', '상태 관리', '스토어'], candidates: 'zustand, redux-toolkit, jotai, nanostores' },
  { key: 'ui', kw: ['ui component', 'design system', 'button', 'modal', 'component library', '컴포넌트', '디자인 시스템'], candidates: 'shadcn/ui, radix, MUI, Ark UI' },
  { key: 'markdown', kw: ['markdown', 'md parser', 'mdx', '마크다운'], candidates: 'marked, markdown-it, remark/unified' },
  { key: 'cli', kw: ['cli', 'command line', 'argv', 'arg parser', '명령행', '인자 파싱'], candidates: 'commander, yargs, clipanion, citty' },
  { key: 'db', kw: ['orm', 'database', 'sql', 'query builder', 'migration', 'db', '데이터베이스', '쿼리'], candidates: 'prisma, drizzle, kysely' },
  { key: 'test', kw: ['test', 'unit test', 'e2e', 'mock', '테스트', '목'], candidates: 'vitest, jest, playwright, node:test' },
  { key: 'pdf', kw: ['pdf', 'generate pdf', 'pdf 생성'], candidates: 'pdf-lib, pdfkit, puppeteer(렌더)' },
  { key: 'csv', kw: ['csv', 'excel', 'xlsx', 'spreadsheet', '스프레드시트'], candidates: 'papaparse, csv-parse, exceljs' },
  { key: 'queue', kw: ['queue', 'job', 'worker', 'cron', 'scheduler', '큐', '작업 스케줄'], candidates: 'bullmq, p-queue, node-cron, croner' },
  { key: 'i18n', kw: ['i18n', 'translation', 'localization', '국제화', '다국어'], candidates: 'i18next, lingui, format.js' },
  { key: 'logging', kw: ['log', 'logger', 'logging', '로깅'], candidates: 'pino, winston, consola' }
];
const REUSE_CHECKLIST = [
  '라이선스: 프로젝트와 호환되는가 (MIT/Apache vs GPL 등)',
  '유지보수: 최근 커밋/릴리스가 활발한가, 이슈 응답이 있는가',
  '보안: 알려진 취약점이 없는가 (npm audit / advisory)',
  '적합성: 요구사항의 80%+ 를 충족하는가 (과한 의존성/기능 과잉 아닌가)',
  '통합 비용: 학습+통합 비용 < 직접 구현 비용인가',
  '제어: 핵심 로직이면 외부 의존 리스크를 감수할 가치가 있는가'
];

// 1.9.333 (UR-0025 심층): 플랫폼/API 제약 기본 catalog (순수 데이터) — constraints 서브시스템 핵심 데이터.
const _DEFAULT_PLATFORM_CONSTRAINTS = {
  version: '1.9.208',
  platforms: {
    stripe: {
      aliases: ['stripe', 'stripe api', 'payment', '결제'],
      docs: 'https://stripe.com/docs/rate-limits',
      constraints: [
        { kind: 'rate-limit', detail: 'read: 100 req/s, write: 100 req/s (live mode), test mode: 25 req/s' },
        { kind: 'idempotency', detail: 'Idempotency-Key 헤더 24h 유지 — 중복 결제 방지 필수' },
        { kind: 'webhook', detail: 'webhook 서명 검증 필수 (Stripe-Signature header + endpoint secret)' }
      ]
    },
    openai: {
      aliases: ['openai', 'gpt', 'chatgpt', 'gpt-4', 'gpt-3'],
      docs: 'https://platform.openai.com/docs/guides/rate-limits',
      constraints: [
        { kind: 'rate-limit', detail: 'tier-based: Free 3 RPM / Tier 1 500 RPM / Tier 5 10,000 RPM' },
        { kind: 'token-limit', detail: 'TPM (tokens/min) 별도 — 큰 입력 시 RPM 도달 전 차단 가능' },
        { kind: 'cost', detail: 'gpt-4: $30/$60 per 1M input/output tokens — 대량 호출 전 비용 추정 필수' }
      ]
    },
    anthropic: {
      aliases: ['anthropic', 'claude', 'claude api', 'sonnet', 'opus', 'haiku'],
      docs: 'https://docs.anthropic.com/claude/reference/rate-limits',
      constraints: [
        { kind: 'rate-limit', detail: 'tier-based: Free 5 RPM / Tier 1 50 RPM / Tier 4 4,000 RPM' },
        { kind: 'context-window', detail: 'claude-sonnet 200K context, claude-opus 200K, 1M tier 별도' },
        { kind: 'cost', detail: 'sonnet: $3/$15 per 1M tokens (1M context tier 2x)' }
      ]
    },
    github: {
      aliases: ['github', 'github api', 'gh api', 'octokit'],
      docs: 'https://docs.github.com/en/rest/rate-limit',
      constraints: [
        { kind: 'rate-limit', detail: 'authenticated: 5,000 req/hr, unauthenticated: 60 req/hr' },
        { kind: 'rate-limit', detail: 'search API: 30 req/min (authenticated)' },
        { kind: 'secondary', detail: 'secondary rate limit — concurrent + content creation 별도 가드' }
      ]
    },
    discord: {
      aliases: ['discord', 'discord api', 'discord bot'],
      docs: 'https://discord.com/developers/docs/topics/rate-limits',
      constraints: [
        { kind: 'rate-limit', detail: 'global: 50 req/s, per-route 별도' },
        { kind: 'invalid', detail: '10,000 invalid req/10min → 1h ban 위험' }
      ]
    },
    twitter: {
      aliases: ['twitter', 'twitter api', 'x api', 'x.com api'],
      docs: 'https://developer.twitter.com/en/docs/twitter-api/rate-limits',
      constraints: [
        { kind: 'rate-limit', detail: 'tier-based: Free 1,500 posts/month, Basic 50,000 posts/month' },
        { kind: 'auth', detail: 'OAuth 2.0 PKCE 필수 (user context), App-only는 별도 endpoint' }
      ]
    }
  }
};

// 1.9.333 패턴 적용: intent 도메인 기본 catalog (순수 데이터) — intent-domain 서브시스템 핵심 데이터.
const _DEFAULT_DOMAIN_CATALOG = {
  version: '1.9.213',
  domains: {
    game: {
      aliases: ['게임', 'game', 'unity', 'unreal', 'godot', 'phaser', 'gamedev'],
      components: [
        { key: 'map', desc: '맵/타일 시스템 + 영역/스폰' },
        { key: 'character', desc: '캐릭터/스프라이트 + 애니메이션 상태머신' },
        { key: 'gameLoop', desc: '게임 루프 (tick/render/update)' },
        { key: 'collision', desc: '충돌 감지 (AABB/SAT/grid)' },
        { key: 'camera', desc: '카메라 follow + 영역 제한' },
        { key: 'hud', desc: 'HUD/UI (HP/score/inventory)' },
        { key: 'audio', desc: '사운드 매니저 (BGM/SFX)' },
        { key: 'save', desc: '저장/로드 (slot 시스템)' },
        { key: 'menu', desc: '메뉴 (메인/일시정지/설정)' },
        { key: 'input', desc: '입력 핸들러 (키보드/패드/터치)' }
      ]
    },
    web: {
      aliases: ['웹', 'web', 'website', 'webapp', 'nextjs', 'react', 'vue', 'svelte', 'frontend'],
      components: [
        { key: 'routing', desc: '라우팅 (path/dynamic/nested)' },
        { key: 'state', desc: '상태 관리 (context/redux/zustand)' },
        { key: 'auth', desc: '인증 (OAuth/JWT/session)' },
        { key: 'api', desc: 'API 클라이언트 (fetch/axios/tanstack-query)' },
        { key: 'db', desc: 'DB 연동 (ORM/migration/seed)' },
        { key: 'ui', desc: 'UI 컴포넌트 라이브러리' },
        { key: 'test', desc: '테스트 (unit/e2e/visual)' },
        { key: 'deploy', desc: '배포 (Vercel/Netlify/Cloudflare)' }
      ]
    },
    api: {
      aliases: ['api', 'rest', 'graphql', 'endpoint', 'backend', 'server'],
      components: [
        { key: 'endpoint', desc: '엔드포인트 라우팅 + HTTP method' },
        { key: 'auth', desc: '인증/인가 (API key/OAuth/JWT)' },
        { key: 'rate-limit', desc: 'rate limit (RPS/RPM/token bucket)' },
        { key: 'validation', desc: '입력 검증 (zod/joi/yup)' },
        { key: 'error', desc: '에러 핸들링 + 응답 형식' },
        { key: 'logging', desc: '로깅 + 모니터링 (structured logs)' },
        { key: 'docs', desc: 'API 문서 (OpenAPI/Swagger)' }
      ]
    },
    cli: {
      aliases: ['cli', 'command-line', 'tool', 'utility', 'shell'],
      components: [
        { key: 'argParser', desc: '인자 파싱 (yargs/commander/clipanion)' },
        { key: 'help', desc: 'help / man / examples 텍스트' },
        { key: 'config', desc: '설정 파일 + env 변수' },
        { key: 'output', desc: '출력 (TTY 색상/JSON/quiet)' },
        { key: 'error', desc: '에러 처리 + exit code 규약' },
        { key: 'completion', desc: 'shell completion (bash/zsh/fish)' }
      ]
    },
    data: {
      aliases: ['data', 'pipeline', 'etl', 'analytics', 'ingest'],
      components: [
        { key: 'ingest', desc: '데이터 수집 (file/API/stream)' },
        { key: 'transform', desc: '변환 (cleaning/normalization/joining)' },
        { key: 'storage', desc: '저장소 (parquet/db/blob)' },
        { key: 'query', desc: '쿼리/분석 (SQL/aggregations)' },
        { key: 'validation', desc: '데이터 검증 (schema/contracts)' },
        { key: 'lineage', desc: '데이터 lineage 추적' }
      ]
    }
  }
};

// 1.9.335 (UR-0025 심층): LSP 정규식 fallback 언어별 심볼 패턴 catalog (harness 에서 분리)
// 6개 언어 (JS/TS / Python / Go / Rust / Java) — LSP 미설치 시 regex 심볼 추출에 사용.
const _LSP_LANG_PATTERNS = {
  javascript: [
    { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/, kind: 'function' },
    { re: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
    { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
    { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\()/, kind: 'function' },
    { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, kind: 'type' },
    { re: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 'enum' }
  ],
  python: [
    { re: /^\s*async\s+def\s+([A-Za-z_][\w]*)\s*\(/, kind: 'function' },
    { re: /^\s*def\s+([A-Za-z_][\w]*)\s*\(/, kind: 'function' },
    { re: /^\s*class\s+([A-Za-z_][\w]*)\s*[(:]/, kind: 'class' }
  ],
  go: [
    { re: /^\s*func\s+(?:\([^)]*\)\s+)?([A-Za-z_][\w]*)\s*\(/, kind: 'function' },
    { re: /^\s*type\s+([A-Za-z_][\w]*)\s+struct\b/, kind: 'struct' },
    { re: /^\s*type\s+([A-Za-z_][\w]*)\s+interface\b/, kind: 'interface' },
    { re: /^\s*type\s+([A-Za-z_][\w]*)\s+[A-Za-z]/, kind: 'type' }
  ],
  rust: [
    { re: /^\s*(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/, kind: 'function' },
    { re: /^\s*(?:pub(?:\([^)]+\))?\s+)?struct\s+([A-Za-z_][\w]*)/, kind: 'struct' },
    { re: /^\s*(?:pub(?:\([^)]+\))?\s+)?enum\s+([A-Za-z_][\w]*)/, kind: 'enum' },
    { re: /^\s*(?:pub(?:\([^)]+\))?\s+)?trait\s+([A-Za-z_][\w]*)/, kind: 'trait' },
    { re: /^\s*impl\s+(?:[^{]+\s+for\s+)?([A-Za-z_][\w]*)/, kind: 'impl' },
    { re: /^\s*(?:pub(?:\([^)]+\))?\s+)?type\s+([A-Za-z_][\w]*)\s*=/, kind: 'type' }
  ],
  java: [
    { re: /^\s*(?:public|private|protected)?\s*(?:final\s+)?(?:abstract\s+)?class\s+([A-Za-z_][\w]*)/, kind: 'class' },
    { re: /^\s*(?:public|private|protected)?\s*(?:abstract\s+)?interface\s+([A-Za-z_][\w]*)/, kind: 'interface' },
    { re: /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?enum\s+([A-Za-z_][\w]*)/, kind: 'enum' },
    // method: visibility + return type + name(  (heuristic — 첫 번째 ( 매칭, 키워드 필터)
    { re: /^\s*(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:[A-Za-z_<>,\s\[\]]+\s+)?([A-Za-z_][\w]*)\s*\(/, kind: 'method' }
  ]
};

// 1.9.26: optimism-check — evidence의 외부 동작 주장 vs 실제 코드 호출 흔적 불일치 감지
// 사용자 요청 (1.9.26): "API 연동/작업 요청 시 실제로 일어나지 않았는데 일어난 것처럼 표시하는 낙관적 결과 방지"
//
// 패턴 (한국어 + 영어):
//   evidence에 "API 호출" / "HTTP 200|201" / "POST /" / "응답 확인" → 코드에 fetch/http.request/axios 흔적 없으면 의심
//   evidence에 "DB 저장" / "insert N건" / "DB에" → db.*/pg.*/mysql.*/mongoose.*/prisma.* 없으면 의심
//   evidence에 "이메일 발송" / "메일 전송" → sendMail/nodemailer/smtp 없으면 의심
// 1.9.27: 패턴 카탈로그 확장 (5 → 10) + URL/메서드 단위 매핑 추가
const OPTIMISM_PATTERNS = [
  { kind: 'API',     evidenceRe: /(API\s*호출|HTTP\s*\d{3}|POST\s*\/|GET\s*\/|PUT\s*\/|DELETE\s*\/|fetch|REST 응답|응답 확인|endpoint|엔드포인트)/i,
    codeRe: /\b(fetch\s*\(|http\.request|https\.request|axios\.|got\.|undici|node-fetch)/i,
    label: 'API/HTTP 호출' },
  { kind: 'DB',      evidenceRe: /(DB에?\s*저장|insert\s+\d+|데이터베이스|SQL\s*(INSERT|UPDATE|DELETE)|migration|마이그레이션 적용)/i,
    codeRe: /\b(db\.|pg\.|pool\.|mysql\.|mongoose\.|prisma\.|sequelize|knex|sqlite3|MongoClient|createConnection)/i,
    label: 'DB 호출' },
  { kind: 'Email',   evidenceRe: /(이메일[^.\n]{0,30}(발송|전송|보냈|보냄|완료)|메일[^.\n]{0,30}(발송|전송|보냈|보냄)|sendMail|smtp\s*(전송|발송))/i,
    codeRe: /\b(sendMail|nodemailer|smtp|@sendgrid|mailgun|aws-sdk\/ses|resend\.)/i,
    label: '이메일 전송' },
  { kind: 'Webhook', evidenceRe: /(웹훅\s*(호출|전송|발송)|webhook\s+(sent|posted|triggered))/i,
    codeRe: /\b(fetch\s*\(|http\.request|axios\.)/i,
    label: '웹훅' },
  { kind: 'Payment', evidenceRe: /(결제\s*(완료|성공|승인|취소)|payment\s+(processed|charged)|stripe 결제|toss\s*결제|카카오페이|네이버페이|kakaopay|nicepay|iamport 결제|페이팔|paypal)/i,
    codeRe: /\b(stripe|toss|@stripe|tosspayments|iamport|kakao|nicepay|naverpay|paypal-rest-sdk|@paypal)/i,
    label: '결제' },
  // 1.9.27 신규 카테고리
  { kind: 'FileIO',  evidenceRe: /(파일[^.\n]{0,20}(생성|저장|작성|기록)|\d+개[^.\n]{0,20}파일|디스크[^.\n]{0,20}저장|로그 파일 작성)/i,
    codeRe: /\b(fs\.write|fs\.appendFile|writeFileSync|appendFileSync|fs\/promises|fs\.createWriteStream)/i,
    label: '파일 I/O 쓰기' },
  { kind: 'Queue',   evidenceRe: /(메시지\s*큐|발행\s*완료|publish\s*(완료|성공)|RabbitMQ|Kafka|SQS|Redis Pub|이벤트 발행)/i,
    codeRe: /\b(amqp|kafkajs|rabbit|redis\.(publish|xadd)|@aws-sdk\/client-sqs|bull|bullmq)/i,
    label: '메시지 큐 발행' },
  { kind: 'Cache',   evidenceRe: /(Redis[^.\n]{0,20}(저장|set|get)|캐시[^.\n]{0,20}(저장|기록|적중)|memcache)/i,
    codeRe: /\b(redis\.|ioredis|memcached|node-cache|@upstash\/redis|connect-redis)/i,
    label: '캐시 저장' },
  { kind: 'Notify',  evidenceRe: /(슬랙\s*(알림|발송|전송)|Slack\s+(notification|sent|posted)|Discord\s+(알림|발송|webhook)|푸시 알림 전송)/i,
    codeRe: /\b(@slack\/web-api|slack-webhook|discord\.js|discord-webhook|@discordjs|firebase\/messaging|expo-notifications)/i,
    label: '슬랙/Discord 알림' },
  { kind: 'Storage', evidenceRe: /(S3\s*(업로드|저장)|GCS\s*업로드|Azure Blob|클라우드 스토리지 업로드|object storage 저장)/i,
    codeRe: /\b(@aws-sdk\/client-s3|aws-sdk[^a-z]|@google-cloud\/storage|@azure\/storage-blob|aws-s3)/i,
    label: '클라우드 스토리지' }
];


// 1.9.337 (UR-0025 심층): 리뷰 페르소나 catalog (5종: security/performance/ux/testing/docs) — harness 에서 분리.
const BUILT_IN_PERSONAS = {
  security: {
    id: 'security',
    name: '보안 엔지니어 (10년차)',
    description: 'OWASP Top 10, CWE, RFC, 한국 개인정보보호법/게임산업법 정통',
    body: `너는 **10년 경력의 시니어 보안 엔지니어**다. OWASP Top 10 2021, CWE, RFC 7235/6454, CORS 보안, secret 관리에 정통하며, 한국 금융사·카카오·네이버 등 대형 IT 기업의 보안 감사 경험이 있다. 코드를 볼 때 **위협 모델링**과 **공격 표면(attack surface)** 을 자동으로 시각화한다.

검토 영역: 입력 검증 / 인증·인가 / CORS / 시크릿/로그 노출 / DoS / 데이터 노출 / 의존성 attack surface / 한국 시장 특화 (개인정보보호법, 결제 정보)
보고에 포함: 위협 모델 / CWE ID 매핑 / 실 공격 시나리오 1건 (HTTP 페이로드) / P0/P1/P2 우선순위 / OWASP Top 10 2021 매핑`
  },
  performance: {
    id: 'performance',
    name: '성능 최적화 전문가 (V8 내부)',
    description: 'V8 엔진 (Ignition/TurboFan, hidden class), Node.js 이벤트 루프, libuv 정통',
    body: `너는 **V8 엔진 내부 (Ignition, TurboFan, hidden class)와 Node.js 이벤트 루프, libuv에 정통한 성능 최적화 전문가**다. Linux perf, node --prof, clinic.js, autocannon, FlameGraph 활용 경험이 풍부하다. 메모리 압박(GC pressure), CPU bound vs I/O bound 구분, hot path 식별이 직관이다.

검토 영역: Hot path 식별 / hidden class 안정성 / 메모리 할당 패턴 / 정규식 컴파일 / JSON.parse/stringify 비용 / 이벤트 루프 블로킹 / 라우트 매칭 복잡도
보고에 포함: 성능 프로필 요약 (RPS/latency 추정) / Hot path Top 5 / 비효율 표 (영향 high/med/low) / 벤치 시나리오 (autocannon 명령) / 권장 우선순위 (당장/부하증가/마이크로)`
  },
  ux: {
    id: 'ux',
    name: '한국어 UX 라이터 + DX 컨설턴트',
    description: '카카오/네이버/토스/라인 마이크로카피, API 디자인 (Stripe/GitHub/Google) 정통',
    body: `너는 **한국 사용자 대상 게임/SaaS 제품의 UX 라이터 + DX(Developer Experience) 컨설턴트**다. 카카오, 네이버, 토스, 라인의 한국어 마이크로카피 가이드라인을 숙지하고 있으며, 클라이언트 개발자의 API 통합 경험을 잘 안다. 에러 메시지, HTTP status, 응답 본문 일관성이 직관이다.

검토 영역: 한국어 에러 메시지 톤 / HTTP status 적절성 (400/404/422/409) / 응답 본문 일관성 / 한국어/영문 혼재 / 누락 정보 (rate limit, request id, version) / 클라이언트 SDK 친화성
보고에 포함: UX/DX 점수 (1-10) / 발견 이슈 표 / Before/After 메시지 5건 / SDK 친화성 점수 (1-5) / 권장 로드맵 (이번 PR / 1주 / 분기)`
  },
  testing: {
    id: 'testing',
    name: '테스트 엔지니어 (TDD + property-based)',
    description: 'TDD, property-based testing (fast-check), AAA 패턴, fuzz, mutation testing 정통',
    body: `너는 **TDD와 property-based testing (fast-check) 에 정통한 테스트 엔지니어**다. AAA 패턴, given/when/then, fuzz testing, mutation testing, contract testing 경험이 있다. 테스트 커버리지보다 **테스트 품질**과 **회귀 방어** 가치를 더 중시한다.

검토 영역: 테스트 누락 분기 / edge case / mocking 과다 / AAA 패턴 위반 / async 테스트 결함 (race) / property 후보 / 회귀 가능성
보고에 포함: 누락 테스트 목록 + 우선순위 / fast-check property 후보 3건 / 기존 테스트 약점 / 권장 회귀 시나리오`
  },
  docs: {
    id: 'docs',
    name: '기술 문서 작성자 (한국어)',
    description: 'README, API 문서, 사용 가이드 작성. Stripe Docs / Google Cloud / 카카오 dev 가이드 정통',
    body: `너는 **한국어 기술 문서 작성에 정통한 테크니컬 라이터**다. Stripe Docs, Google Cloud, AWS, 카카오 개발자 가이드 톤을 잘 안다. README 첫 60초 경험, 점진적 공개 (progressive disclosure), 코드 예시의 즉시 실행 가능성을 중시한다.

검토 영역: 60초 시작 가능성 / 예시 코드 정확성 / 누락된 사전 요구사항 / 한국어 자연스러움 / 시각적 균형 (이모지/표/코드블록) / 한국어/영문 혼재 / 다음 단계 명시
보고에 포함: 사용자 페르소나별 평가 (입문자/실무자/전문가) / 60초 안 첫 결과 가능 여부 / 누락 정보 / 권장 개선 표`
  }
};


// 1.9.338 (UR-0025 심층): i18n 문자열 catalog (ko/en) — harness 에서 분리. 조회는 순수 _translate(STRINGS, key, lang).
const STRINGS = {
  // 설치 가이드 prompt
  'install.lang.title': { ko: '설치 언어를 선택하세요', en: 'Select install language' },
  'install.lang.auto':  { ko: '자동 감지', en: 'Auto detect' },
  'install.lang.auto.desc': { ko: '디렉토리/파일 + 시스템(OS) 언어 자동 판별 (한국어/영어)', en: 'Auto-detect from dir/files + system (OS) locale (KO/EN)' },
  'install.lang.sysNotice': { ko: '시스템 언어 감지', en: 'System language detected' },
  'install.lang.ko': { ko: '한국어', en: 'Korean' },
  'install.lang.ko.desc': { ko: '모든 인스트럭션을 한국어로 생성', en: 'All instructions in Korean' },
  'install.lang.en': { ko: 'English', en: 'English' },
  'install.lang.en.desc': { ko: '모든 인스트럭션을 영어로 생성', en: 'All instructions in English' },
  'install.agents.title': { ko: 'CLI 에이전트 활성화 (복수 선택, Space 토글) — sub-agent 위임용',
                            en: 'Enable CLI agents (multi-select, Space toggle) — for sub-agent dispatch' },
  'install.agents.none': { ko: '선택 안함 (나중에 setup-agents)', en: 'None (later setup-agents)' },
  'install.complete': { ko: '✓ 설치 완료', en: '✓ Install complete' },
  // REPL agent 모드
  'repl.welcome.title': { ko: 'leerness REPL agent', en: 'leerness REPL agent' },
  'repl.welcome.subtitle': { ko: 'Tab provider · Shift+Tab model · :help · /slash', en: 'Tab provider · Shift+Tab model · :help · /slash' },
  'repl.welcome.start': { ko: '시작하려면 메시지를 입력하세요', en: 'Type a message to start' },
  // 공통
  'common.cancel': { ko: '취소됨', en: 'Cancelled' },
  'common.confirm': { ko: '확인', en: 'Confirm' },
  'common.ready': { ko: '준비 완료', en: 'Ready' }
};


// 1.9.341 (UR-0025 심층): 내장 스킬 catalog (9종) — harness 에서 분리. _loadSkillCatalog 의 builtin fallback.
const BUILTIN_CATALOG = {
  'office':                       { displayNameKo: '마이크로소프트 오피스 자동화 스킬 라이브러리', version: '1.0.0', lastUpdated: '2026-05-08', verification: 'passed', capabilities: ['Word/Excel/PowerPoint 문서 자동화', '템플릿 기반 문서 생성', '표/차트/요약 문서화', '민감정보 제외 규칙 적용'] },
  'commerce-api':                 { displayNameKo: '커머스 API 연동 스킬 라이브러리', version: '1.0.0', lastUpdated: '2026-05-08', verification: 'passed', capabilities: ['쿠팡·롯데온·스마트스토어 API 연동 설계', '주문/상품/매출 동기화', '환경변수 기반 인증 분리', '레이트리밋/재시도/오류 처리'] },
  'crawling':                     { displayNameKo: '크롤링·브라우저 자동화 스킬 라이브러리', version: '1.0.0', lastUpdated: '2026-05-08', verification: 'passed', capabilities: ['Playwright 기반 자동화', '다운로드/로그인 세션 처리', '스크린샷 기반 실패 진단', '약관/권한/차단 위험 점검'] },
  'firebase':                     { displayNameKo: 'Firebase·Cloud Functions 스킬 라이브러리', version: '1.0.0', lastUpdated: '2026-05-08', verification: 'passed', capabilities: ['Firebase Functions 배포 구조', '환경변수/시크릿 분리', '권한/IAM 점검', '로컬 에뮬레이터 검증'] },
  'ads-analytics':                { displayNameKo: '광고·GA4 분석 스킬 라이브러리', version: '1.0.0', lastUpdated: '2026-05-08', verification: 'passed', capabilities: ['GA4 이벤트/전환 점검', '광고 데이터 수집 구조화', '소스/매체 분석', '리포트 자동화'] },
  'appstore-review':              { displayNameKo: '앱스토어 심사 대응 스킬 라이브러리', version: '1.0.0', lastUpdated: '2026-05-08', verification: 'passed', capabilities: ['심사 문구 분석', '개인정보 라벨 점검', '리젝 대응 초안', '웹뷰/앱 데이터 수집 구분'] },
  'ai-verified-skill-publisher':  { displayNameKo: 'AI 검증 스킬 업로드·라이브러리화 스킬', version: '1.0.0', lastUpdated: '2026-05-08', verification: 'passed', capabilities: ['검증된 스킬 정규화', '민감정보 스캔', 'AI 검증 메타데이터 작성', 'npm/git 업로드 dry-run 및 실행 게이트'] },
  'feature-implementation':       { displayNameKo: '기능 구현 표준 스킬', version: '1.0.0', lastUpdated: '2026-05-08', verification: 'passed', capabilities: ['feature-contracts 작성', '재사용 우선 검사', '테스트 증거 수집', '핸드오프 트리거'] },
  // 1.9.11: 기본 내장 — 로드맵 자동 생성 스킬
  'project-roadmap-generator':    { displayNameKo: '프로젝트 로드맵 자동 생성 스킬', version: '0.2.0', lastUpdated: '2026-05-12', verification: 'passed', capabilities: ['leerness .harness/* 통합 파싱 (plan/progress/skills/rules/decisions/handoff/current-state)', '좌→우 수평 트리 + 상하 중앙정렬 SVG', '7개 상태 색상 (완료/진행/보류/검토/예정/미완료/오류)', 'design-system + CSS variables 자동 주입', '화이트보드 panning/zoom + 더블클릭 reset', '단일 HTML 출력 (외부 의존성 0)'] }
};

// 1.9.342 (UR-0025 심층): roadmap.html 상태 라벨/색상 맵 (status → ko 라벨 / hex 색상) — harness 에서 분리.
const ROADMAP_STATUS_LABEL = { done: '완료', 'in-progress': '진행', 'on-hold': '보류', waiting: '검토', incomplete: '미완료', planned: '예정', blocked: '오류', dropped: '취소', skill: '스킬', rule: '룰', meta: '프로젝트' };
const ROADMAP_STATUS_COLOR = { done: '#16a34a', 'in-progress': '#2563eb', 'on-hold': '#6b7280', waiting: '#eab308', incomplete: '#f97316', planned: '#94a3b8', blocked: '#dc2626', dropped: '#9ca3af', skill: '#8b5cf6', rule: '#06b6d4', meta: '#0f172a' };


// 1.9.343 (UR-0025 심층): 시크릿 값 스캔 정규식 catalog (13종) — harness 에서 분리. scan secrets 의 값 탐지. (_isSecretKey 키이름 휴리스틱과 보안 응집)
const SECRET_PATTERNS = [
  { name: 'AWS Access Key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },                       // ASIA=임시 자격증명 추가
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },                        // ghp_/gho_/ghu_/ghs_/ghr_ 통합
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { name: 'OpenAI project/service key', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/g }, // modern (하이픈/언더스코어 포함)
  { name: 'OpenAI API key', re: /\bsk-[A-Za-z0-9]{32,}\b/g },                             // legacy
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },                      // _ 포함 + 후행 \b 제거 (실제 키 호환)
  { name: 'Stripe secret key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  { name: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { name: 'Google OAuth token', re: /\bya29\.[A-Za-z0-9_-]{20,}/g },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'Generic private key', re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/g },
  { name: 'Hardcoded password assignment', re: /\b(?:password|passwd|pwd|secret|api_key|apikey)\s*[:=]\s*["'][^"'\s]{6,}["']/gi },
  // 1.9.350 (UR-0060 외부리뷰 3모델): 누락 패턴 보강
  { name: 'GitLab PAT', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'DB connection string (embedded password)', re: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/@]+:[^@\s/]+@/gi },
  { name: 'SendGrid API key', re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  { name: 'AWS Secret Access Key (context)', re: /\baws[^\n]{0,40}?(?:secret_access_key|secret_key|secret)[^\n]{0,12}?["']?[A-Za-z0-9/+]{40}["']?/gi },
  { name: 'Hardcoded Bearer token', re: /\bBearer\s+[A-Za-z0-9_\-.=]{20,}/g },
];

// 1.9.344 (UR-0025 심층): skill discover GitHub preset catalog (vercel/anthropic) — harness 에서 분리.
const SKILL_CATALOG_PRESETS = {
  'vercel':    { owner: 'vercel-labs', repo: 'agent-skills', branch: 'main', path: 'skills',
                  homepage: 'https://github.com/vercel-labs/agent-skills' },
  'anthropic': { owner: 'anthropics',  repo: 'skills',       branch: 'main', path: 'skills',
                  homepage: 'https://github.com/anthropics/skills' }
};

module.exports = { CAPABILITY_SURFACE, POWERFUL_COMMANDS, ADAPTERS, REUSE_CATEGORIES, REUSE_CHECKLIST, _DEFAULT_PLATFORM_CONSTRAINTS, _DEFAULT_DOMAIN_CATALOG, _LSP_LANG_PATTERNS, OPTIMISM_PATTERNS, BUILT_IN_PERSONAS, STRINGS, BUILTIN_CATALOG, ROADMAP_STATUS_LABEL, ROADMAP_STATUS_COLOR, SECRET_PATTERNS, SKILL_CATALOG_PRESETS };
