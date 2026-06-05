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

module.exports = { CAPABILITY_SURFACE, POWERFUL_COMMANDS, ADAPTERS, REUSE_CATEGORIES, REUSE_CHECKLIST, _DEFAULT_PLATFORM_CONSTRAINTS };
