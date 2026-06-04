// lib/role-catalog.js — 역할/모델 레지스트리 (순수 데이터, 부작용 0)
// 1.9.294 (UR-0025 3단계): bin/harness.js 에서 비파괴 분리. selftest(ROLE_CATALOG 7종 + _normalizeRole + _pickModel)가 동작 검증.
// 런타임 변형 없음 — _normalizeRole/_pickModel/_AGENT_ROLE_PROMPTS 소비처 모두 읽기 전용.
'use strict';

// 1.9.155: provider 별 추천 모델 카탈로그 — REPL :models 명령에서 노출 (실제 가용성은 사용자 CLI 가 결정)
// 1.9.170: provider × 실제 모델 catalog 확장 (Tab cycle 지원 — 사용자 명시 요청)
//   각 provider 의 최신 실제 모델 ID 를 반영. Tab/Shift+Tab 키로 cycle.
const _PROVIDER_MODEL_CATALOG = {
  claude: [
    { id: 'claude-opus-4-7', note: '최신 1M context (Anthropic Opus 4.7)' },
    { id: 'claude-opus-4-5', note: '안정 Opus 4.5' },
    { id: 'claude-sonnet-4-7', note: '균형형 — Sonnet 4.7 (속도/품질)' },
    { id: 'claude-sonnet-4-5', note: 'Sonnet 4.5 안정' },
    { id: 'claude-haiku-4-5', note: '빠름 — Haiku 4.5' }
  ],
  codex: [
    { id: 'gpt-5.5', note: 'OpenAI 최신 추론 모델' },
    { id: 'gpt-5.4', note: 'OpenAI 안정 (이전 세대)' },
    { id: 'gpt-5', note: 'OpenAI gpt-5 (base)' },
    { id: 'gpt-5-codex', note: '코드 특화 (Codex)' },
    { id: 'o4-mini', note: '빠른 reasoning' }
  ],
  agy: [
    { id: 'antigravity-pro', note: 'Antigravity 최고급 (1M+ context)' },
    { id: 'antigravity-flash', note: '빠른 응답' },
    { id: 'antigravity-experimental', note: '실험적 (사용 가능 시)' }
  ],
  grok: [
    { id: 'grok-beta', note: 'xAI 최신 (1.9.268 provider 승격)' },
    { id: 'grok-2', note: 'xAI Grok 2' },
    { id: 'grok-2-mini', note: '빠른 응답' }
  ],
  // 1.9.277: 신규 provider 4종 모델 (provider-agnostic 인 도구는 default + 설정 안내)
  opencode: [
    { id: 'default', note: 'opencode 설정 모델 (opencode auth/models 로 provider별 지정)' },
    { id: 'anthropic/claude-sonnet', note: 'Anthropic 경유' },
    { id: 'openai/gpt-5', note: 'OpenAI 경유' }
  ],
  qwen: [
    { id: 'qwen3-coder-plus', note: '코드 특화 최신' },
    { id: 'qwen-max', note: '최고 성능' },
    { id: 'qwen-plus', note: '균형' },
    { id: 'qwen-turbo', note: '빠름' }
  ],
  aider: [
    { id: 'sonnet', note: 'Anthropic Sonnet (aider --model)' },
    { id: 'gpt-5', note: 'OpenAI' },
    { id: 'deepseek', note: 'DeepSeek (가성비)' },
    { id: 'o1-mini', note: '빠른 reasoning' }
  ],
  goose: [
    { id: 'default', note: 'goose configure 로 설정한 provider/model' },
    { id: 'claude-sonnet', note: 'Anthropic 경유' },
    { id: 'gpt-5', note: 'OpenAI 경유' }
  ],
  copilot: [
    { id: 'default', note: 'gh copilot 기본 (모델 선택 불가)' }
  ],
  ollama: [
    { id: 'llama3', note: 'Meta — :models 로 실시간 조회 권장' },
    { id: 'qwen2.5-coder', note: 'Alibaba — 코드 특화' },
    { id: 'gpt-oss', note: 'OpenAI 오픈소스' },
    { id: 'deepseek-coder-v2', note: 'DeepSeek 코드 모델' }
  ]
};

// 1.9.170: provider cycle 순서 (Tab) — 빌트인 6종(1.9.268 grok 추가). user provider는 동적으로 뒤에 추가.
const _PROVIDER_CYCLE_ORDER = ['ollama', 'claude', 'codex', 'agy', 'grok', 'opencode', 'qwen', 'aider', 'goose', 'copilot'];

// 1.9.148: planner/reviewer/actor 역할 시스템 프롬프트 (Gemini 권고 — 자기-승인 편향 방지)
const _AGENT_ROLE_PROMPTS = {
  planner: '역할: planner. task를 step 3-6개로 분해, 각 step의 입출력/검증 방법 명시. 코드 작성 금지, 계획만.',
  reviewer: '역할: reviewer. planner 의 계획 또는 actor 의 결과를 비판적으로 검토. 누락된 검증, 잠재 cascade, 오류 가능성 지적. 동의/수정 결론 명시.',
  actor: '역할: actor. 계획에 따라 정확한 명령/코드만 실행. evidence(파일 경로 + 테스트 결과) 함께 기록. 새 계획 생성 금지.'
};
// ===== 1.9.270: Agent Roles — 모델별 역할 부여 (사용자 명시) =====
//   여러 AI 에이전트 활성 시 역할(코딩/검수/지휘/디자인/디버그/설계/분배)을 provider+model 에 매핑.
//   사용자 설정: .harness/agent-roles.json { schemaVersion, roles: { <role>: { provider, model, persona } } }
//   dispatch --role <role> → 역할 기반 provider+model 라우팅. roles suggest → 활성 에이전트 기반 최적 배치 판단.
//   방향성 판단(사용자 요청): 모델별 강점이 분명하고(추론/코드/멀티모달) 작업이 분해 가능할 때, 역할 특화는
//   품질·정확도를 올림 — 강추론 모델의 독립 검수는 자기승인 편향을 차단, 코드 특화 모델은 구현 정확도↑.
//   단 조율 오버헤드 < 이득이어야 하므로 opt-in + verify(비활성 provider 배정 경고)로 오설정을 방지.
const ROLE_CATALOG = {
  commander:  { ko: '지휘관', desc: '전체 계획 수립·작업 분해·최종 의사결정', prefer: ['claude', 'codex', 'grok'], modelKind: 'top',  why: '최강 추론 모델이 전체 맥락을 쥐고 분해/결정 → 일관성↑' },
  reviewer:   { ko: '검수자', desc: '구현 결과 비판적 검수·버그/누락 적발',   prefer: ['claude', 'codex', 'grok'], modelKind: 'top',  why: '독립 강추론 모델의 적대적 검수가 자기승인 편향 차단 → 정확도↑' },
  coder:      { ko: '코딩 담당', desc: '구현·패치·리팩터',                   prefer: ['codex', 'agy', 'claude', 'grok'], modelKind: 'code', why: '코드 특화 모델이 구현 정확도/속도↑' },
  architect:  { ko: '설계 담당', desc: '아키텍처·데이터 모델·인터페이스 설계', prefer: ['codex', 'claude'],         modelKind: 'top',  why: '깊은 코드 추론 모델이 설계 트레이드오프 분석' },
  designer:   { ko: '디자인 담당', desc: 'UI/UX·시각 디자인·레이아웃',        prefer: ['agy', 'claude', 'grok'],   modelKind: 'top',  why: '멀티모달/시각 역량 모델이 디자인 산출물↑' },
  debugger:   { ko: '디버그 담당', desc: '버그 진단·근본원인·재현',          prefer: ['codex', 'claude', 'grok'], modelKind: 'top',  why: '깊은 추론 모델의 가설-검증이 디버깅 효율↑' },
  dispatcher: { ko: '하위 분배 담당', desc: '서브에이전트 업무 분배·병렬 조율', prefer: ['claude', 'grok', 'codex'], modelKind: 'fast', why: '빠른 응답 모델이 분배 오버헤드↓' }
};
const _ROLE_ALIASES = {
  '코딩': 'coder', '코더': 'coder', '코딩담당': 'coder',
  '검수': 'reviewer', '검수자': 'reviewer', '리뷰': 'reviewer', '리뷰어': 'reviewer',
  '지휘': 'commander', '지휘관': 'commander', '사령관': 'commander',
  '디자인': 'designer', '디자인담당': 'designer',
  '디버그': 'debugger', '디버거': 'debugger', '디버깅': 'debugger',
  '설계': 'architect', '설계담당': 'architect', '아키텍트': 'architect',
  '분배': 'dispatcher', '분배담당': 'dispatcher', '오케스트레이터': 'dispatcher'
};

module.exports = { _PROVIDER_MODEL_CATALOG, _AGENT_ROLE_PROMPTS, ROLE_CATALOG, _ROLE_ALIASES };
