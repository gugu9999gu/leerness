#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const childProcess = require('child_process');

const VERSION = '1.5.0';
const MARK = '<!-- leerness:managed -->';
const MIGRATED = '<!-- leerness:migrated-legacy -->';
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const PACKS_DIR = path.join(PACKAGE_ROOT, 'skill-packs');
const DEFAULT_GIT_REPOSITORY = 'https://github.com/gugu9999gu/leerness';
const c = { reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m', green:'\x1b[32m', yellow:'\x1b[33m', cyan:'\x1b[36m', red:'\x1b[31m', magenta:'\x1b[35m' };

const legacyItems = ['AI_HARNESS.md','HARNESS.md','PROJECT_CONTEXT.md','CONTEXT.md','ARCHITECTURE.md','DECISIONS.md','CURRENT_STATE.md','TASK_LOG.md','AGENT.md','AGENTS.md','CLAUDE.md','.cursorrules','.cursor/rules/project-rules.mdc','.cursor/rules/leerness.mdc','.github/copilot-instructions.md','docs/guideline.md','docs/history.md','.ai','harness','.harness'];

function log(m=''){ console.log(m); }
function ok(m){ log(c.green+'✓'+c.reset+' '+m); }
function info(m){ log(c.cyan+'ℹ'+c.reset+' '+m); }
function warn(m){ log(c.yellow+'⚠'+c.reset+' '+m); }
function fail(m){ log(c.red+'✗'+c.reset+' '+m); }
function exists(p){ return fs.existsSync(p); }
function read(p){ return fs.readFileSync(p,'utf8'); }
function write(p,s){ fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,s,'utf8'); }
function rel(root,p){ return path.relative(root,p).replace(/\\/g,'/') || '.'; }
function parseJsonSafe(s,fallback){ try { return JSON.parse(s); } catch { return fallback; } }
function isTextFile(p){ return /\.(md|mdc|txt|json|js|ts|tsx|jsx|yml|yaml|env|gitignore)$/i.test(p) || !path.extname(p); }
function banner(){ log(''); log(c.bold+c.magenta+'Leerness v'+VERSION+c.reset); log(c.dim+'plan orchestration · progress tracking · context routing · debug'+c.reset); log(''); }
function installGuide(){
  log(c.bold+'설치/마이그레이션 안내'+c.reset);
  log('  - 기존 파일은 먼저 .harness/archive/ 에 백업합니다.');
  log('  - project-brief/current-state/release-checklist 등 기존 프로젝트 메모리는 기본 보존합니다.');
  log('  - .env.example과 .gitignore는 덮어쓰지 않고 필요한 항목만 병합합니다.');
  log('  - AGENTS/CLAUDE/Cursor/Copilot 지침과 AX 라우팅 가이드는 최신 기준으로 갱신합니다.');
  log('  - 기존 메모리 파일까지 강제로 템플릿 재생성하려면 --force를 명시하세요.');
  log('  - 세션 종료 시 진행/미완료/추천 방향을 반드시 session-handoff에 남깁니다.');
  log('');
}
function projectName(root){ try{ const pkg=JSON.parse(read(path.join(root,'package.json'))); if(pkg.name) return String(pkg.name).replace(/^@[^/]+\//,''); }catch{} return path.basename(root); }
function now(){ return new Date().toISOString(); }
function today(){ return now().slice(0,10); }
function fill(t,ctx){ return t.replace(/{{([A-Z_]+)}}/g,(_,k)=>ctx[k]||''); }
function slug(s){ return String(s||'skill').toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'') || 'skill'; }

function normalizeLanguage(v){
  const raw=String(v||'auto').toLowerCase();
  if(['ko','kr','korean','한국어','hangul'].includes(raw)) return 'ko';
  if(['en','english'].includes(raw)) return 'en';
  if(raw==='auto') return 'auto';
  return raw;
}
function languageName(code){ return code==='ko'?'Korean':code==='en'?'English':code; }
function hasKorean(text){ return /[가-힣]/.test(String(text||'')); }
function detectLanguage(root){
  const candidates=['README.md','AGENTS.md','CLAUDE.md','docs/guideline.md','.harness/project-brief.md','.harness/current-state.md'];
  let ko=0,total=0;
  for(const f of candidates){ const p=path.join(root,f); if(!exists(p)) continue; const body=read(p).slice(0,8000); total+=body.length; const m=body.match(/[가-힣]/g); if(m) ko+=m.length; }
  if(ko>=20 || (total && ko/Math.max(total,1)>0.02)) return 'ko';
  return 'en';
}
function readConfiguredLanguage(root){

  const pf=path.join(root,'.harness/plan.md');
  if(exists(pf)){ const b=read(pf); if(b.includes('## Milestones')) ok('plan.md milestones 확인'); else { warnings++; warn('plan.md에 Milestones 섹션이 없습니다.'); } }
  const gf=path.join(root,'.harness/guideline.md');
  if(exists(gf)){ const b=read(gf); if(b.includes('plan.md')&&b.includes('progress-tracker.md')) ok('guideline.md가 plan/progress를 참조합니다.'); else { failures++; fail('guideline.md가 plan.md/progress-tracker.md를 참조하지 않습니다.'); } }
  const mf=path.join(root,'.harness/manifest.json');
  if(exists(mf)){ const j=parseJsonSafe(read(mf),{}); if(j.language) return normalizeLanguage(j.language); }
  const lp=path.join(root,'.harness/LANGUAGE');
  if(exists(lp)) return normalizeLanguage(read(lp).trim());
  return null;
}
async function chooseLanguage(root,flags){
  const requested=normalizeLanguage(flags.language||flags.lang||'auto');
  const configured=readConfiguredLanguage(root);
  if(requested!=='auto') return requested;
  if(configured) return configured;
  const detected=detectLanguage(root);
  if(flags.yes||flags.y||!process.stdin.isTTY) return detected;
  log(c.bold+'문서 작성 언어 선택'+c.reset);
  log('  1) 자동 감지: '+languageName(detected));
  log('  2) 한국어');
  log('  3) English');
  const ans=await ask('\n선택 (Enter=자동 감지): ');
  if(ans==='2') return 'ko';
  if(ans==='3') return 'en';
  return detected;
}
function languagePolicyBody(code){
  if(code==='ko') return `${MARK}\n---\nleernessRole: language-policy\nreadWhen: [every-task, documentation, skill-writing, session-close]\nupdateWhen: [user-language-preference-change, project-language-change]\ndoNotStore: [secrets, tokens, credentials]\n---\n\n# Language Policy\n\n## Primary Language\n\nKorean\n\n## Rule\n\n- 하네스 문서, 스킬 문서, 세션 인수인계, 진행 작업 목록은 한국어로 작성한다.\n- 코드 식별자, 파일명, 명령어, API 필드명, 환경변수명은 원문을 유지한다.\n- 외부 오류 메시지는 원문을 보존하고, 필요한 경우 한국어 설명을 덧붙인다.\n- 스킬 라이브러리에는 한글명(displayNameKo)과 가능한 작업(capabilities)을 반드시 유지한다.\n`;
  return `${MARK}\n---\nleernessRole: language-policy\nreadWhen: [every-task, documentation, skill-writing, session-close]\nupdateWhen: [user-language-preference-change, project-language-change]\ndoNotStore: [secrets, tokens, credentials]\n---\n\n# Language Policy\n\n## Primary Language\n\nEnglish\n\n## Rule\n\n- Write harness documents, skill documents, session handoffs, and progress lists in English.\n- Preserve code identifiers, filenames, commands, API fields, and environment variable names exactly.\n- Preserve external error messages verbatim and add explanations when useful.\n- Skill libraries must keep displayNameKo when available and list clear capabilities.\n`;
}

function copyRecursive(src,dst,ignoreAbs=[]){
  const abs=path.resolve(src); if(ignoreAbs.some(i=>abs===i||abs.startsWith(i+path.sep))) return;
  const st=fs.statSync(src);
  if(st.isDirectory()){ fs.mkdirSync(dst,{recursive:true}); for(const n of fs.readdirSync(src)) copyRecursive(path.join(src,n),path.join(dst,n),ignoreAbs); }
  else { fs.mkdirSync(path.dirname(dst),{recursive:true}); fs.copyFileSync(src,dst); }
}
function detectLegacy(root){
  return legacyItems.map(item=>({item,full:path.join(root,item)})).filter(e=>{
    if(!exists(e.full)) return false;
    if(e.item==='.harness'){
      const vf=path.join(root,'.harness/HARNESS_VERSION');
      return !exists(vf) || read(vf).trim()!==VERSION;
    }
    try{
      if(fs.statSync(e.full).isFile() && isTextFile(e.item)){
        const b=read(e.full);
        if(b.includes(MARK)||b.includes(MIGRATED)) return false;
      }
    }catch{}
    return true;
  });
}
function collectLegacyText(found){ const out={}; for(const f of found){ try{ if(fs.statSync(f.full).isFile() && isTextFile(f.item)) out[f.item]=read(f.full); }catch{} } return out; }
function pick(obj,keys){ const out={}; for(const k of keys) if(obj[k]) out[k]=obj[k]; return out; }
function legacyBlock(title,obj){ const entries=Object.entries(obj).filter(([,v])=>String(v).trim()); if(!entries.length) return ''; return '\n---\n## Migrated legacy notes: '+title+'\n\n'+entries.map(([k,v])=>'### '+k+'\n\n'+String(v).trim()+'\n').join('\n'); }
function archiveLegacy(root,found,dryRun){
  if(!found.length) return null;
  const stamp=now().replace(/[:.]/g,'-');
  const archive=path.join(root,'.harness/archive/legacy-migration-'+stamp);
  if(dryRun) return archive;
  fs.mkdirSync(archive,{recursive:true});
  const archiveRoot=path.resolve(path.join(root,'.harness/archive'));
  for(const f of found){
    try{ copyRecursive(f.full,path.join(archive,f.item==='.harness'?'.harness-before-v'+VERSION:f.item),[archiveRoot]); }
    catch(e){ warn('백업 실패: '+f.item+' ('+e.message+')'); }
  }
  write(path.join(archive,'migration-manifest.json'),JSON.stringify({version:VERSION,archivedAt:now(),items:found.map(x=>x.item)},null,2)+'\n');
  return archive;
}
function targetForLegacy(item){ if(/ARCHITECTURE/i.test(item)) return '.harness/architecture.md'; if(/DECISION/i.test(item)) return '.harness/decisions.md'; if(/CURRENT|TASK_LOG|history/i.test(item)) return '.harness/current-state.md'; if(/AGENT|CLAUDE|cursor|copilot|cursorrules/i.test(item)) return 'AGENTS.md'; return '.harness/project-brief.md'; }
function noteLegacyPreserved(root,found,dryRun){
  for(const f of found){
    if(f.item==='.harness'||coreFiles[f.item]) continue;
    try{ if(!fs.statSync(f.full).isFile()) continue; }catch{ continue; }
    const target=targetForLegacy(f.item);
    if(dryRun) info('[dry-run] legacy file preserved: '+f.item+' (suggested source: '+target+')');
    else info('보존: '+f.item+' (참조 권장: '+target+')');
  }
}

const coreFiles = {
  'AGENTS.md': `${MARK}
# {{PROJECT}} AI Agent Harness

Agent = Model + Leerness Harness.

## Core Rule
Before editing, route the task. Read .harness/language-policy.md, .harness/context-routing.md, and use \`leerness route <task-type>\` when the task type is unclear.

## Universal Read Order
1. .harness/plan.md
2. .harness/progress-tracker.md
3. .harness/project-brief.md
4. .harness/current-state.md
5. .harness/language-policy.md
6. .harness/context-routing.md
7. .harness/writeback-policy.md
8. .harness/task-type-map.md
9. .harness/context-map.md
10. .harness/guideline.md
11. .harness/guardrails.md
12. .harness/skills-lock.json

## Language Rule
- Before writing or updating any harness/skill/session document, read .harness/language-policy.md.
- Use the configured project language consistently.
- Preserve code names, commands, file paths, environment variables, and API field names exactly.

## Task Routing
- Feature/API work: architecture.md, feature-contracts.md, context-map.md, skills/feature-implementation.md.
- UI/design work: design-system.md, feature-contracts.md, skills/ui-consistency.md.
- Debugging: task-log.md, current-state.md, skills/debugging.md, related feature contract.
- Refactoring: architecture.md, decisions.md, guardrails.md, skills/refactoring.md.
- Release/deploy: release-checklist.md, testing-strategy.md, current-state.md, decisions.md.
- Migration: AX_MIGRATION_GUIDE.md, context-routing.md, writeback-policy.md.
- New install: AX_NEW_PROJECT_GUIDE.md and actual project config/source files.
- Skill/library work: AX_SKILL_LIBRARY_GUIDE.md and ai-verified-skill-publisher when installed.
- Harness debug: debug-guide.md, language-policy.md, context-routing.md, writeback-policy.md, progress-tracker.md.

## Writeback Rules
- Always update current-state.md, task-log.md, and session-handoff.md after meaningful work.
- Update plan.md and progress-tracker.md when user scope, milestones, task status, exclusions, or planned work changes.
- Update guideline.md when execution standards, quality gates, or plan-following rules change.
- Update decisions.md when a structural, technology, API, schema, deployment, or irreversible decision is made.
- Update feature-contracts.md when input/output/state/error behavior changes.
- Update design-system.md when UI rules, components, layout, spacing, or states change.
- Update release-checklist.md when deployment, environment variables, rollback, CI, npm, or git release requirements change.
- Update context-map.md when important files, modules, routes, commands, or ownership areas change.
- Update project-brief.md only when product purpose, target users, success criteria, or project direction changes.

## Non-Destructive Migration Policy
- Never overwrite existing project memory files unless the user explicitly requests --force.
- Preserve .env.example and .gitignore; append missing Leerness entries only.
- Keep secrets, tokens, cookies, credentials, and customer private data out of harness files.


## Plan Rule
- Use .harness/plan.md as the source of truth for the user's goal, project scope, milestones, included work, excluded work, and plan changes.
- Before starting feature/release/refactor/migration work, check whether the request maps to an existing plan item.
- If the user adds scope, update plan.md and progress-tracker.md.
- If the user excludes scope, mark it under Dropped / Out of Scope instead of deleting history.
- If the project looks new or lacks a usable plan, do not start broad implementation blindly. First create or ask for enough information to create .harness/plan.md.

## Guideline Rule
- Use .harness/guideline.md for execution standards.
- guideline.md must reference plan.md and progress-tracker.md, but should not become the primary progress database.
- Progress is tracked in plan.md milestones and progress-tracker.md task rows.

## Progress Tracker Rule
- Track user-requested work in .harness/progress-tracker.md.
- Use statuses: requested, planned, in-progress, waiting, on-hold, blocked, incomplete, done, dropped.
- If the user drops a task, mark it as dropped with reason instead of deleting the history.
- Every session close must list active unresolved work: requested, planned, waiting, on-hold, blocked, in-progress, incomplete.

## End-of-Session Contract
Every meaningful session must close with a handoff. Do not stop at "done". Before the final answer, check .harness/session-close-policy.md, .harness/progress-tracker.md, and .harness/anti-lazy-work-policy.md.

At the end of each session, list:
1. Completed work in this session.
2. User-requested work still in progress.
3. User-requested work not started or incomplete.
4. Planned, on-hold, waiting, blocked, requested, and incomplete work from progress-tracker.md.
5. User-dropped work, if any.
6. Verification performed and results.
7. Memory files updated.
8. Risks, assumptions, or blockers.
9. Recommended next directions.
10. The single next exact action.

## Anti-Lazy Work Rule
- Do not hide unfinished work behind vague summaries.
- Do not claim completion without verification or explicit limits.
- If partial, say exactly what is partial and what remains.
- Prefer concrete file names, commands, and checks over generic phrases.
- If tests or verification were skipped, state why and what should be run next.

## Response Contract
- Task type and files consulted
- Summary
- Completed work
- In-progress work
- Incomplete requested work
- Files changed
- Verification
- Memory files updated
- Risks or assumptions
- Recommended next directions
- Next exact step
{{LEGACY_AGENT}}
`,
  'CLAUDE.md': `${MARK}\n# Claude Code Instructions\n\nUse AGENTS.md as the source of truth. Route every task through .harness/context-routing.md and .harness/task-type-map.md. Do not overwrite existing project memory during migration unless --force is explicit.\n`,
  '.cursor/rules/leerness.mdc': `${MARK}\n---\nalwaysApply: true\n---\nRead AGENTS.md first. Follow .harness/context-routing.md, writeback-policy.md, installed skills, design-system, feature-contracts, and guardrails.\n`,
  '.github/copilot-instructions.md': `${MARK}\n# GitHub Copilot Instructions\n\nUse AGENTS.md and .harness/ as the project memory. Preserve existing project memory files unless --force is explicit.\n`,
  '.gitignore': `# Leerness local-only files\n.env\n.env.local\n*.secret.json\n.harness/skill-config.local.json\n.harness/skill-publish.local.json\n`,
  '.env.example': `# Leerness examples only. Copy to .env.local and fill locally. Never commit real secrets.\n`,
  '.harness/LANGUAGE': '{{LANGUAGE}}\n',
  '.harness/language-policy.md': '{{LANGUAGE_POLICY}}',
  '.harness/HARNESS_VERSION': '{{VERSION}}\n',
  '.harness/manifest.json': '{{MANIFEST}}\n',
  '.harness/skills-lock.json': '{{SKILLS_LOCK}}\n',
  '.harness/skill-config.schema.json': `${MARK}\n{\n  "$schema": "https://json-schema.org/draft/2020-12/schema",\n  "title": "Leerness Skill Config",\n  "type": "object",\n  "additionalProperties": true\n}\n`,
  '.harness/plan.md': `${MARK}
---
leernessRole: plan
readWhen: [planning, every-feature, scope-change, new-project, resume-work, session-close]
updateWhen: [new-user-request, scope-added, scope-dropped, milestone-change, progress-change, plan-reprioritized]
doNotStore: [secrets, tokens, credentials, raw-private-data]
---

# Project Plan

Updated: {{DATE}}

## Project Goal
- Define the user's requested purpose here.

## Scope
- Included work should be listed here.

## Out of Scope / Dropped
| Item | Reason | Dropped At |
|---|---|---|

## Milestones
| ID | Milestone | Status | Progress | Related Tasks | Notes |
|---|---|---|---:|---|---|
| M-0001 | Establish Leerness plan | planned | 0% | T-0001 | Replace with project-specific milestones. |

## Plan Change Log
| Date | Change | Reason | Requested By |
|---|---|---|---|
| {{DATE}} | Plan file created | Leerness v{{VERSION}} installation or migration | Leerness |

## Rules
- Add new user-requested scope before implementation when it changes the overall plan.
- Do not silently implement dropped or out-of-scope work.
- Link plan milestones to progress-tracker task IDs when possible.
- Keep this file high-level; detailed task status belongs in progress-tracker.md.
{{LEGACY_PLAN}}
`,
  '.harness/guideline.md': `${MARK}
---
leernessRole: guideline
readWhen: [every-task, planning, implementation, review, release]
updateWhen: [standard-change, quality-gate-change, plan-following-rule-change, repeated-process-failure]
doNotStore: [secrets, tokens, credentials, raw-private-data]
---

# Project Guideline

## Source of Direction
- Primary plan: .harness/plan.md
- Task status and progress: .harness/progress-tracker.md
- Current handoff state: .harness/current-state.md and .harness/session-handoff.md

## How to Use the Plan
1. Check whether the user request exists in plan.md.
2. If it is new scope, add it to plan.md and progress-tracker.md before broad implementation.
3. If it is excluded or dropped, do not implement it unless the user reopens it.
4. Update progress after implementation or verification changes.

## Progress Policy
- guideline.md describes how progress should be handled.
- plan.md and progress-tracker.md store actual progress values.
- Do not duplicate detailed task tables here.

## Quality Gates
- Follow context-routing.md before editing.
- Follow writeback-policy.md after editing.
- Verify with project-specific commands before marking work done.
- Never mark work done if requested scope remains incomplete.
`,
  '.harness/project-brief.md': `${MARK}\n---\nleernessRole: project-brief\nreadWhen: [every-task, planning, product-direction, onboarding]\nupdateWhen: [purpose-change, user-change, success-criteria-change, product-direction-change]\ndoNotStore: [secrets, tokens, credentials, raw-customer-data]\n---\n\n# Project Brief: {{PROJECT}}\n\n## Purpose\n\n## Success Criteria\n\n## Users\n\n## Product Direction\n{{LEGACY_BRIEF}}\n`,
  '.harness/current-state.md': `${MARK}\n---\nleernessRole: current-state\nreadWhen: [every-task, resume-work, planning, debugging, release]\nupdateWhen: [after-meaningful-work, blocker-change, next-step-change, status-change]\ndoNotStore: [secrets, tokens, credentials]\n---\n\n# Current State\n\nUpdated: {{DATE}}\n\n## Now\n- Leerness v{{VERSION}} installed or migrated.\n\n## Next\n- Fill plan.md, project-brief, context-map, design-system, and feature-contracts.\n\n## Blockers\n- None recorded.\n{{LEGACY_STATE}}\n`,
  '.harness/architecture.md': `${MARK}\n---\nleernessRole: architecture\nreadWhen: [feature, refactor, integration, api, database, deployment]\nupdateWhen: [module-change, data-flow-change, integration-change, boundary-change]\ndoNotStore: [secrets, credentials]\n---\n\n# Architecture\n\n## Overview\n\n## Main Modules\n\n## Data Flow\n\n## External Services\n\n## Boundaries\n{{LEGACY_ARCH}}\n`,
  '.harness/context-map.md': `${MARK}\n---\nleernessRole: context-map\nreadWhen: [every-task, file-discovery, impact-analysis]\nupdateWhen: [new-important-file, moved-module, new-route, new-service, ownership-change]\ndoNotStore: [secrets, tokens]\n---\n\n# Context Map\n\n| Area | Files | Notes |\n|---|---|---|\n| UI | src/components/**, app/** | Check design-system.md first. |\n| API | src/api/**, server/**, functions/** | Preserve response contracts. |\n| Data | db/**, firestore/**, prisma/** | Confirm migrations. |\n| Tests | test/**, tests/**, __tests__/** | Add or update checks. |\n`,
  '.harness/decisions.md': `${MARK}\n---\nleernessRole: decisions\nreadWhen: [architecture, refactor, release, dependency-change, irreversible-change]\nupdateWhen: [important-decision, tradeoff, architecture-change, dependency-change, rollback-relevant-change]\ndoNotStore: [secrets, credentials]\n---\n\n# Decision Log\n\n## Template\n\n### YYYY-MM-DD — Title\n- Decision:\n- Reason:\n- Alternatives:\n- Impact:\n{{LEGACY_DECISIONS}}\n`,
  '.harness/task-log.md': `${MARK}\n---\nleernessRole: task-log\nreadWhen: [debugging, audit, handoff, regression]\nupdateWhen: [after-meaningful-work, failed-attempt, verification-result]\ndoNotStore: [secrets, tokens]\n---\n\n# Task Log\n\n## {{DATE}}\n- Leerness v{{VERSION}} installed or migrated.\n`,
  '.harness/constraints.md': `${MARK}\n# Constraints\n\n- Runtime/framework/deployment constraints\n- Security/privacy/business constraints\n`,
  '.harness/guardrails.md': `${MARK}\n---\nleernessRole: guardrails\nreadWhen: [every-task, security, integration, refactor]\nupdateWhen: [new-risk, repeated-error, policy-change]\ndoNotStore: [secrets, tokens, private-data]\n---\n\n# Guardrails\n\n## Never\n- Store real secrets in code or harness files.\n- Overwrite existing project memory during migration without --force.\n- Change API responses, DB schema, env names, or auth flow without impact review.\n- Perform broad refactoring unless requested.\n\n## Always\n- Preserve architecture and contracts.\n- Record decisions and update writeback files.\n`,
  '.harness/design-system.md': `${MARK}\n---\nleernessRole: design-system\nreadWhen: [ui, layout, component, style, visual-consistency]\nupdateWhen: [new-component-pattern, style-rule-change, state-pattern-change]\ndoNotStore: [secrets, user-private-data]\n---\n\n# Design System Memory\n\n## Layout\n\n## Components\n\n## States\n- Loading\n- Empty\n- Error\n- Success\n`,
  '.harness/feature-contracts.md': `${MARK}\n---\nleernessRole: feature-contracts\nreadWhen: [feature, api, ui-state, debugging, refactor]\nupdateWhen: [input-change, output-change, state-change, error-change, contract-change]\ndoNotStore: [secrets, raw-private-data]\n---\n\n# Feature Contracts\n\n## Template\n- Feature:\n- Entry point:\n- Input:\n- Output:\n- UI states:\n- Error states:\n- Related files:\n- Tests:\n`,
  '.harness/testing-strategy.md': `${MARK}\n---\nleernessRole: testing-strategy\nreadWhen: [feature, debugging, refactor, release]\nupdateWhen: [test-command-change, new-critical-flow, regression-added]\ndoNotStore: [secrets]\n---\n\n# Testing Strategy\n\n## Commands\n\n## Critical Flows\n\n## Regression Notes\n`,
  '.harness/review-checklist.md': `${MARK}\n# Review Checklist\n\n- [ ] Architecture preserved\n- [ ] Feature contract preserved or updated\n- [ ] Design system followed\n- [ ] No secrets stored\n- [ ] Writeback files updated\n`,
  '.harness/release-checklist.md': `${MARK}\n---\nleernessRole: release-checklist\nreadWhen: [release, deploy, ci, npm-publish, git-push, env-change]\nupdateWhen: [deploy-failure, new-env-var, ci-change, rollback-change, release-rule-change]\ndoNotStore: [secrets, tokens, passwords, cookies]\n---\n\n# Release Checklist\n\n## Commands\n\n## Required Environment Variables\n\n## Verification\n\n## Rollback\n`,
  '.harness/session-handoff.md': `${MARK}
---
leernessRole: session-handoff
readWhen: [resume-work, every-new-session, end-of-session]
updateWhen: [end-of-session, handoff, blocked-work, partial-completion]
doNotStore: [secrets, tokens, raw-private-data]
---

# Session Handoff

## Session Summary
- Date:
- Task type:
- User request:

## Completed This Session
-

## In Progress From User Requests
-

## Incomplete / Not Started From User Requests
-

## Files Changed
-

## Verification Performed
- Command/check:
- Result:

## Memory Files Updated
-

## Risks / Assumptions / Blockers
-

## Recommended Next Directions
-

## Next Exact Step
-
`,
  '.harness/session-close-policy.md': `${MARK}\n---\nleernessRole: session-close-policy\nreadWhen: [end-of-session, every-final-response, partial-completion, handoff]\nupdateWhen: [session-close-format-change, repeated-handoff-failure, reporting-standard-change]\ndoNotStore: [secrets, tokens, credentials, raw-private-data]\n---\n\n# Session Close Policy\n\nEvery meaningful AI work session must end with a concrete handoff. This prevents hidden unfinished work and makes the next session restartable.\n\n## Required Final Checklist\n\nBefore the final answer, the AI must inspect whether the session had meaningful work. If yes, it must provide or update:\n\n1. Completed work in this session.\n2. User-requested work still in progress.\n3. User-requested work incomplete or not started.\n4. Verification performed and exact results.\n5. Files or documents changed.\n6. Harness memory files updated.\n7. Risks, assumptions, blockers, or skipped checks.\n8. Recommended next directions.\n9. The single next exact action.\n\n## Required Memory Writeback\n\nUpdate these files when meaningful work occurred:\n\n- current-state.md\n- task-log.md\n- session-handoff.md\n\nUpdate these when relevant:\n\n- decisions.md\n- feature-contracts.md\n- design-system.md\n- release-checklist.md\n- context-map.md\n- progress-tracker.md\n\n## Completion Labels\n\nUse one of these labels for each requested item:\n\n- done\n- in-progress\n- blocked\n- incomplete\n- skipped-with-reason\n\nNever mark work done if verification was not performed or if key requested scope remains unfinished.\n`,
  '.harness/progress-tracker.md': `${MARK}
---
leernessRole: progress-tracker
readWhen: [planning, resume-work, end-of-session, multi-step-work]
updateWhen: [task-started, task-completed, task-blocked, task-dropped, scope-change, end-of-session]
doNotStore: [secrets, tokens, credentials, raw-private-data]
---

# Progress Tracker

Use this file to track user-requested work across sessions. Keep entries concrete and checkable. Link tasks to plan.md milestones when possible. At session close, unresolved statuses must be listed.

| ID | User Request | Status | Owner | Last Update | Evidence / Notes | Next Action |
|---|---|---|---|---|---|---|
| T-0001 | Initialize Leerness project memory | done | AI | {{DATE}} | Leerness v{{VERSION}} installed or migrated. | Fill project-specific details. |

## Status Values

- requested
- planned
- in-progress
- waiting
- on-hold
- blocked
- incomplete
- done
- dropped

## Drop Policy

Dropped tasks are not deleted. Mark Status as dropped and write the reason in Evidence / Notes.

## Session Close Rule

Every session-close report must list all tasks whose Status is planned, waiting, on-hold, blocked, in-progress, incomplete, or requested.
`,
  '.harness/anti-lazy-work-policy.md': `${MARK}\n---\nleernessRole: anti-lazy-work-policy\nreadWhen: [every-task, end-of-session, verification, planning]\nupdateWhen: [quality-failure, repeated-shortcut, missed-verification, reporting-rule-change]\ndoNotStore: [secrets, tokens, credentials]\n---\n\n# Anti-Lazy Work Policy\n\nThe AI must not appear productive while leaving important work vague or incomplete.\n\n## Required Behavior\n\n- State exactly what was done and what was not done.\n- Prefer concrete file paths, commands, checks, and outputs.\n- Do not skip obvious verification when tools are available.\n- If a check cannot be run, say so and provide the exact command to run.\n- Do not collapse multiple unfinished user requests into a generic sentence.\n- Do not overwrite project memory to avoid doing the harder merge.\n- Do not call a task complete only because files were generated. Confirm behavior or clearly label it unverified.\n\n## Laziness Warning Signs\n\n- done without changed files or verification.\n- should work without a check.\n- No mention of incomplete user-requested items.\n- No next exact action.\n- Memory files not updated after meaningful work.\n\n## Minimum Final Answer Standard\n\nA final answer after meaningful work must include:\n\n- Completed\n- In progress\n- Incomplete\n- Verification\n- Updated memory\n- Risks\n- Recommended next directions\n`,
  '.harness/templates/end-of-session-report.md': `${MARK}\n# End-of-Session Report\n\n## Completed This Session\n-\n\n## In Progress From User Requests\n-\n\n## Incomplete / Not Started From User Requests\n-\n\n## Planned Tasks\n-\n\n## Waiting Tasks\n-\n\n## On-Hold Tasks\n-\n\n## Blocked Tasks\n-\n\n## Dropped By User\n-\n\n## Verification\n-\n\n## Files Changed\n-\n\n## Memory Files Updated\n-\n\n## Risks / Assumptions / Blockers\n-\n\n## Recommended Next Directions\n-\n\n## Next Exact Step\n-\n`,
  '.harness/debug-guide.md': `${MARK}\n# Leerness Debug Guide\n\nUse this when checking whether the harness is actually guiding the AI.\n\n## Debug Checklist\n\n- AGENTS.md references plan.md, guideline.md, language-policy, context-routing, writeback-policy, progress-tracker, and anti-lazy policy.\n- language-policy.md exists and defines one primary language.\n- context-routing.md maps task types to read/update files.\n- writeback-policy.md explains where each kind of information goes.\n- plan.md exists and contains milestones/out-of-scope areas.
- guideline.md references plan.md and progress-tracker.md.
- progress-tracker.md contains a task table and unresolved status values.\n- session-close-policy.md forces active unresolved work to be listed.\n- anti-lazy-work-policy.md prevents unverified completion claims.\n- skills-lock.json records installed skills.\n\nRun: leerness debug [path]\n`,
  '.harness/skill-index.md': `${MARK}\n# Skill Index\n\n| Task | Skill |\n|---|---|\n| Codebase analysis | skills/codebase-analysis.md |\n| Feature implementation | skills/feature-implementation.md |\n| Debugging | skills/debugging.md |\n| UI consistency | skills/ui-consistency.md |\n| Release | skills/release-check.md |\n`,
  '.harness/context-routing.md': `${MARK}\n# Context Routing\n\nUse this file to decide what to read before work and what to update afterward.\n\n## feature\nRead: project-brief, current-state, architecture, context-map, feature-contracts, skills/feature-implementation.\nUpdate: current-state, task-log, session-handoff, feature-contracts, context-map when paths change.\n\n## ui\nRead: design-system, feature-contracts, context-map, skills/ui-consistency.\nUpdate: design-system, feature-contracts, current-state, task-log, session-handoff.\n\n## debugging\nRead: current-state, task-log, feature-contracts, testing-strategy, skills/debugging.\nUpdate: task-log, current-state, session-handoff, testing-strategy when regression coverage changes.\n\n## release\nRead: release-checklist, testing-strategy, current-state, decisions, secret-policy.\nUpdate: release-checklist, task-log, current-state, session-handoff.\n\n## migration\nRead: AX_MIGRATION_GUIDE, writeback-policy, task-type-map.\nUpdate: only missing files by default; preserve project memory unless --force.\n\n## session-close\nRead: session-close-policy, progress-tracker, current-state, task-log, session-handoff, anti-lazy-work-policy.\nUpdate: session-handoff, progress-tracker, current-state, task-log, and any relevant memory files changed by the session.\n`,
  '.harness/writeback-policy.md': `${MARK}\n# Writeback Policy\n\n## current-state.md\nCurrent progress, blockers, next work.\n\n## task-log.md\nWhat changed, when, and verification result.\n\n## session-handoff.md\nEnough context for the next AI session to continue.\n\n## decisions.md\nImportant choices and tradeoffs.\n\n## release-checklist.md\nDeploy commands, env requirements, rollback, failures.\n\n## design-system.md\nUI rules and reusable patterns.\n\n## feature-contracts.md\nInput/output/state/error contracts.\n\n## project-brief.md\nProduct purpose and success criteria only.\n\n## progress-tracker.md\nUser-requested work items, status, evidence, and next actions across sessions.\n\n## session-close-policy.md\nFinal response and handoff rules. Update only when the reporting standard changes.\n\n## anti-lazy-work-policy.md\nQuality guardrails that prevent vague or incomplete closure. Update when repeated failure patterns appear.\n`,
  '.harness/task-type-map.md': `${MARK}\n# Task Type Map\n\n| User request | Task type | First files |\n|---|---|---|\n| 계획 수립/수정 | planning | plan, progress-tracker, guideline |
| 새 기능 | feature | feature-contracts, architecture |\n| 디자인/UI | ui | design-system |\n| 오류 수정 | debugging | task-log, debugging skill |\n| 구조 개선 | refactor | architecture, decisions |\n| 배포 | release | release-checklist |\n| 하네스 전환 | migration | AX_MIGRATION_GUIDE |\n| 신규 적용 | new-install | AX_NEW_PROJECT_GUIDE |\n| 스킬 저장/배포 | skill-library | AX_SKILL_LIBRARY_GUIDE |\n`,
  '.harness/AX_MIGRATION_GUIDE.md': `${MARK}\n# AX Migration Guide\n\n## Goal\nMigrate old harness files without losing project memory.\n\n## Procedure\n1. Run: leerness migrate --dry-run\n2. Confirm archive target.\n3. Run: leerness migrate\n4. Check .env.example and .gitignore were merged, not replaced.\n5. Check project memory files were preserved.\n6. Fill only missing context using archived legacy files.\n7. Run: leerness status && leerness verify.\n\n## Critical Rule\nDo not overwrite existing project-brief, current-state, architecture, decisions, release-checklist, feature-contracts, or design-system unless the user explicitly asks for --force.\n`,
  '.harness/AX_PLAN_GUIDE.md': `${MARK}
# AX Plan Guide

Use this guide when creating, updating, dropping, or syncing the project plan.

## Purpose
plan.md keeps the user's intended outcome, scope, milestones, exclusions, and plan changes visible across sessions. progress-tracker.md keeps concrete task states. guideline.md defines how the plan should be followed.

## When a user asks for new work
1. Check .harness/plan.md.
2. Decide whether the request is an existing milestone, a subtask, new scope, or out of scope.
3. If new scope, add a milestone or task reference.
4. Add or update the matching row in progress-tracker.md.
5. Route implementation using context-routing.md.

## When a user drops work
1. Do not delete history.
2. Mark the task dropped in progress-tracker.md.
3. Add it to plan.md Out of Scope / Dropped with the reason.
4. Mention the drop in session-handoff.md.

## New project detection
If the project lacks a meaningful plan, project brief, source structure, or clear success criteria, first create a plan draft from the user request. If the user request is not enough, ask for the missing goal/scope before broad implementation.

## Sync rule
Run or follow: leerness plan sync
- plan.md: milestones and scope
- progress-tracker.md: concrete task statuses
- guideline.md: execution standards and progress policy
- current-state.md: immediate next work
`,
  '.harness/AX_NEW_PROJECT_GUIDE.md': `${MARK}\n# AX New Project Guide\n\n## Goal\nAfter initial installation, populate Leerness memory from the actual project.\n\n## Read actual project files\n- package/config files\n- app/routes/pages\n- API/server/functions\n- DB/schema/rules\n- deploy/CI files\n- tests\n\n## Fill memory files\n- plan.md: user goal, scope, milestones, dropped/out-of-scope work
- project-brief.md: purpose and success criteria\n- architecture.md: modules and data flow\n- context-map.md: important files and routes\n- design-system.md: existing UI patterns\n- feature-contracts.md: major features and states\n- release-checklist.md: real deploy commands and env requirements\n`,
  '.harness/AX_SKILL_LIBRARY_GUIDE.md': `${MARK}\n# AX Skill Library Guide\n\n## AI-verified skill lifecycle\n1. Learn from a validated implementation.\n2. Remove secrets and keep env variable names only.\n3. Add displayNameKo, capabilities, lastUpdated, verification metadata.\n4. Run validate.\n5. Run verify --ai.\n6. Build.\n7. Publish dry-run.\n8. Publish with --execute only after token gate passes.\n`,
  '.harness/skills/codebase-analysis.md': `${MARK}\n# Skill: Codebase Analysis\n\nRead context-map, architecture, current-state, and related source files before proposing changes.\n`,
  '.harness/skills/feature-implementation.md': `${MARK}\n# Skill: Feature Implementation\n\nDefine contract, inspect existing patterns, implement minimal change, verify, update memory.\n`,
  '.harness/skills/refactoring.md': `${MARK}\n# Skill: Refactoring\n\nPreserve behavior and contracts. Record important decisions.\n`,
  '.harness/skills/debugging.md': `${MARK}\n# Skill: Debugging\n\nReproduce, isolate cause, patch minimally, verify, add regression note.\n`,
  '.harness/skills/ui-consistency.md': `${MARK}\n# Skill: UI Consistency\n\nRead design-system and existing adjacent screens before styling.\n`,
  '.harness/skills/security-review.md': `${MARK}\n# Skill: Security Review\n\nCheck secrets, auth, permissions, logging, and sensitive data exposure.\n`,
  '.harness/skills/release-check.md': `${MARK}\n# Skill: Release Check\n\nCheck tests, build, env vars, migration, rollback, publish token gate.\n`,
  '.harness/skills/documentation-update.md': `${MARK}\n# Skill: Documentation Update\n\nFollow writeback-policy and update the specific memory file.\n`,
  '.harness/templates/session-summary.md': `${MARK}\n# Session Summary\n\n## Done\n\n## Files Changed\n\n## Verification\n\n## Next\n`,
  '.harness/templates/decision.md': `${MARK}\n# Decision\n\n## Decision\n\n## Reason\n\n## Alternatives\n\n## Impact\n`
};

const memoryFiles = new Set(['.harness/plan.md','.harness/guideline.md','.harness/project-brief.md','.harness/current-state.md','.harness/architecture.md','.harness/context-map.md','.harness/decisions.md','.harness/task-log.md','.harness/constraints.md','.harness/guardrails.md','.harness/design-system.md','.harness/feature-contracts.md','.harness/testing-strategy.md','.harness/review-checklist.md','.harness/release-checklist.md','.harness/session-handoff.md','.harness/progress-tracker.md','.harness/language-policy.md','.harness/debug-guide.md','.harness/skill-index.md','.harness/secret-policy.md']);
const refreshableFiles = new Set(['AGENTS.md','CLAUDE.md','.cursor/rules/leerness.mdc','.github/copilot-instructions.md','.harness/context-routing.md','.harness/writeback-policy.md','.harness/task-type-map.md','.harness/AX_PLAN_GUIDE.md','.harness/AX_SKILL_LIBRARY_GUIDE.md','.harness/AX_MIGRATION_GUIDE.md','.harness/AX_NEW_PROJECT_GUIDE.md','.harness/session-close-policy.md','.harness/anti-lazy-work-policy.md','.harness/templates/end-of-session-report.md','.harness/debug-guide.md','.harness/language-policy.md','.harness/LANGUAGE','.harness/manifest.json','.harness/HARNESS_VERSION']);
function uniqueLinesAppend(current, addition){
  const lines=current.split(/\r?\n/); const seen=new Set(lines.map(x=>x.trim()).filter(Boolean));
  const add=addition.split(/\r?\n/).filter(line=>{ const t=line.trim(); if(!t||seen.has(t)) return false; seen.add(t); return true; });
  if(!add.length) return current;
  return current.replace(/\s*$/,'\n')+add.join('\n')+'\n';
}
function mergeSkillLockJson(current,incoming){ const a=parseJsonSafe(current,{installedSkills:{}}), b=parseJsonSafe(incoming,{installedSkills:{}}); const merged={...b,...a}; merged.harnessVersion=VERSION; merged.updatedAt=now(); merged.installedSkills={...(b.installedSkills||{}),...(a.installedSkills||{})}; return JSON.stringify(merged,null,2)+'\n'; }
function writeCoreSafely(root,file,body,opts={}){
  const target=path.join(root,file), dryRun=Boolean(opts.dryRun), force=Boolean(opts.force), existed=exists(target);
  if(!existed){ if(dryRun) info('[dry-run] 생성: '+file); else { write(target,body); ok('생성: '+file); } return 'created'; }
  const current=read(target); if(current===body){ if(dryRun) info('[dry-run] 유지: '+file); else ok('유지: '+file); return 'same'; }
  if(file==='.gitignore'||file==='.env.example'){
    const merged=uniqueLinesAppend(current,body); if(merged===current){ if(dryRun) info('[dry-run] 보존: '+file); else ok('보존: '+file); return 'preserved'; }
    if(dryRun) info('[dry-run] 병합: '+file); else { write(target,merged); ok('병합: '+file); } return 'merged';
  }
  if(file==='.harness/skills-lock.json'){
    const merged=mergeSkillLockJson(current,body); if(dryRun) info('[dry-run] 병합: '+file); else { write(target,merged); ok('병합: '+file); } return 'merged';
  }
  if(force || refreshableFiles.has(file)){
    if(dryRun) info('[dry-run] '+(force?'강제 ':'')+'갱신: '+file); else { write(target,body); ok((force?'강제 ':'')+'갱신: '+file); } return 'updated';
  }
  if(memoryFiles.has(file)){
    if(dryRun) info('[dry-run] 보존: '+file+' (기존 프로젝트 메모리 유지)'); else ok('보존: '+file+' (기존 프로젝트 메모리 유지)'); return 'preserved';
  }
  if(dryRun) info('[dry-run] 보존: '+file+' (덮어쓰려면 --force)'); else ok('보존: '+file+' (덮어쓰려면 --force)'); return 'preserved';
}
function manifest(root,selectedSkills,language){ return JSON.stringify({name:projectName(root),harnessVersion:VERSION,language,languageName:languageName(language),installedAt:now(),managedFiles:Object.keys(coreFiles),selectedSkills,nonDestructiveMigration:true,taskStatuses:['requested','planned','in-progress','waiting','on-hold','blocked','incomplete','done','dropped'],planEnabled:true},null,2); }
function skillsLock(root,selectedSkills){ const lock={harnessVersion:VERSION,installedAt:now(),installedSkills:{}}; for(const name of selectedSkills){ const meta=getSkillMeta(name); if(meta) lock.installedSkills[name]={version:meta.version,source:'bundled',title:meta.title,displayNameKo:meta.displayNameKo||meta.title,lastUpdated:meta.lastUpdated,verificationStatus:(meta.verification||{}).status||'unknown'}; } return JSON.stringify(lock,null,2); }
function makeContext(root,legacyText,selectedSkills,language){ const lang=normalizeLanguage(language||readConfiguredLanguage(root)||detectLanguage(root)); return { PROJECT:projectName(root), DATE:today(), VERSION, LANGUAGE:lang, LANGUAGE_NAME:languageName(lang), LANGUAGE_POLICY:languagePolicyBody(lang), LEGACY_AGENT:legacyBlock('agent instructions',pick(legacyText,['AGENTS.md','AGENT.md','CLAUDE.md','.cursorrules','.cursor/rules/project-rules.mdc','.cursor/rules/leerness.mdc','.github/copilot-instructions.md'])), LEGACY_PLAN:legacyBlock('plan context',pick(legacyText,['PLAN.md','plan.md','.harness/plan.md'])), LEGACY_BRIEF:legacyBlock('project context',pick(legacyText,['PROJECT_CONTEXT.md','CONTEXT.md','docs/guideline.md','AI_HARNESS.md','HARNESS.md'])), LEGACY_STATE:legacyBlock('state',pick(legacyText,['CURRENT_STATE.md','TASK_LOG.md','docs/history.md'])), LEGACY_ARCH:legacyBlock('architecture',pick(legacyText,['ARCHITECTURE.md'])), LEGACY_DECISIONS:legacyBlock('decisions',pick(legacyText,['DECISIONS.md'])), MANIFEST:manifest(root,selectedSkills,lang), SKILLS_LOCK:skillsLock(root,selectedSkills) }; }

function listSkillPacks(){ if(!exists(PACKS_DIR)) return []; return fs.readdirSync(PACKS_DIR).map(n=>getSkillMeta(n)).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name)); }
function getSkillMeta(name){ const metaPath=path.join(PACKS_DIR,name,'skill.json'); if(!exists(metaPath)) return null; const meta=parseJsonSafe(read(metaPath),null); if(!meta||!meta.name) return null; return meta; }
function updateSkillLock(root,meta,remove=false){ const lp=path.join(root,'.harness/skills-lock.json'); const lock=exists(lp)?parseJsonSafe(read(lp),{harnessVersion:VERSION,installedSkills:{}}):{harnessVersion:VERSION,installedSkills:{}}; lock.harnessVersion=VERSION; lock.updatedAt=now(); lock.installedSkills=lock.installedSkills||{}; if(remove) delete lock.installedSkills[meta.name]; else lock.installedSkills[meta.name]={version:meta.version,source:meta.source||'bundled',title:meta.title,displayNameKo:meta.displayNameKo||meta.title,categoryKo:meta.categoryKo||meta.category,capabilities:meta.capabilities||[],requiresEnv:meta.requiresEnv||[],lastUpdated:meta.lastUpdated,lastUpdatedAt:meta.lastUpdatedAt,verificationStatus:(meta.verification||{}).status||'unknown'}; write(lp,JSON.stringify(lock,null,2)+'\n'); }
function appendEnvExample(root,meta){ const ep=path.join(root,'.env.example'); const existing=exists(ep)?read(ep):''; const missing=(meta.requiresEnv||[]).filter(n=>!existing.includes(n+'=')); if(!missing.length) return; write(ep,existing.replace(/\s*$/,'\n')+'\n# '+(meta.title||meta.name)+' ('+meta.name+')\n'+missing.map(n=>n+'=').join('\n')+'\n'); }
function installSkill(root,name,dryRun=false){ const meta=getSkillMeta(name); if(!meta){ fail('알 수 없는 스킬 라이브러리: '+name); info('사용 가능 목록: '+listSkillPacks().map(x=>x.name).join(', ')); return false; } const packRoot=path.join(PACKS_DIR,name); const destRoot=path.join(root,'.harness/skills',name); if(dryRun){ info('[dry-run] install skill: '+name); return true; } fs.mkdirSync(destRoot,{recursive:true}); for(const file of meta.files||[]){ const src=path.join(packRoot,file); const dest=path.join(destRoot,path.basename(file)); if(exists(src)){ write(dest,read(src)); ok('스킬 설치: '+rel(root,dest)); } } write(path.join(destRoot,'skill.json'),JSON.stringify(meta,null,2)+'\n'); updateSkillLock(root,meta,false); appendEnvExample(root,meta); return true; }
function removeSkill(root,name){ const meta=getSkillMeta(name)||{name,title:name}; const dest=path.join(root,'.harness/skills',name); if(exists(dest)) fs.rmSync(dest,{recursive:true,force:true}); updateSkillLock(root,meta,true); ok('스킬 제거: '+name); }

function parseArgs(argv){ const out={flags:{},positionals:[]}; const valueFlags=new Set(['skills','path','from','out','target','package','repo','version','title','description','category','source','name','registry','branch','message','reviewer','by','token-env','language','lang','status','reason','owner','evidence','next','action']); for(let i=0;i<argv.length;i++){ const a=argv[i]; if(a.startsWith('--')){ const eq=a.indexOf('='); const key=eq>=0?a.slice(2,eq):a.slice(2); if(eq>=0) out.flags[key]=a.slice(eq+1); else if(valueFlags.has(key)&&argv[i+1]&&!argv[i+1].startsWith('-')) out.flags[key]=argv[++i]; else out.flags[key]=true; } else if(a.startsWith('-')) out.flags[a.slice(1)]=true; else out.positionals.push(a); } return out; }
function splitSkills(value){ if(!value||value===true) return []; if(value==='recommended') return ['office','commerce-api','crawling','ai-verified-skill-publisher']; if(value==='all') return listSkillPacks().map(x=>x.name); return String(value).split(',').map(x=>x.trim()).filter(Boolean); }
function ask(q){ const rl=readline.createInterface({input:process.stdin,output:process.stdout}); return new Promise(resolve=>rl.question(q,a=>{rl.close();resolve(a.trim());})); }
async function chooseSkills(autoYes,provided){ if(provided!==undefined) return splitSkills(provided); if(autoYes||!process.stdin.isTTY) return []; const packs=listSkillPacks(); if(!packs.length) return []; log(c.bold+'설치할 스킬 라이브러리 선택'+c.reset); log('  0) 기본 하네스만 설치'); packs.forEach((p,i)=>{ log('  '+(i+1)+') '+(p.displayNameKo||p.title)+' ('+p.name+')'); if((p.capabilities||[]).length) log('     가능 작업: '+p.capabilities.slice(0,4).join(', ')); }); log('  all) 전체 설치'); const ans=await ask('\n선택 (예: 1,3 또는 all, Enter=기본): '); if(!ans||ans==='0') return []; if(ans.toLowerCase()==='all') return packs.map(p=>p.name); return ans.split(',').map(s=>parseInt(s.trim(),10)).filter(n=>n>=1&&n<=packs.length).map(n=>packs[n-1].name); }

async function init(root,flags){
  root=path.resolve(root||process.cwd()); fs.mkdirSync(root,{recursive:true}); banner(); installGuide(); info('대상: '+root);
  const selectedLanguage=await chooseLanguage(root,flags); info('문서 언어: '+languageName(selectedLanguage));
  const selectedSkills=await chooseSkills(Boolean(flags.yes||flags.y),flags.skills);
  const found=detectLegacy(root), legacyText=collectLegacyText(found);
  if(found.length){ warn('기존 하네스/지침 파일 감지: '+found.length+'개'); found.forEach(f=>log('  - '+f.item)); }
  const archive=archiveLegacy(root,found,false); if(archive) info('백업 완료: '+rel(root,archive));
  noteLegacyPreserved(root,found,false);
  const ctx=makeContext(root,legacyText,selectedSkills,selectedLanguage);
  for(const [file,template] of Object.entries(coreFiles)) writeCoreSafely(root,file,fill(template,ctx),{force:Boolean(flags.force)});
  if(selectedSkills.length){ log(''); info('선택 스킬 설치 중: '+selectedSkills.join(', ')); for(const name of selectedSkills) installSkill(root,name,false); }
  ok('설치 완료'); info('신규 프로젝트라면 .harness/AX_NEW_PROJECT_GUIDE.md를 따라 실제 프로젝트 내용을 반영하세요.');
}
function migrate(root,flags){
  root=path.resolve(root||process.cwd()); banner(); installGuide(); const dryRun=Boolean(flags['dry-run']); const force=Boolean(flags.force);
  const found=detectLegacy(root);
  if(!found.length) ok('마이그레이션할 legacy 항목이 없습니다. 누락/라우팅 파일만 점검합니다.');
  else { warn('마이그레이션 대상: '+found.length+'개'); found.forEach(f=>log('  - '+f.item)); }
  const archive=archiveLegacy(root,found,dryRun); if(archive) info((dryRun?'[dry-run] 백업 예정: ':'백업 완료: ')+rel(root,archive));
  noteLegacyPreserved(root,found,dryRun);
  const selectedLanguage=normalizeLanguage(flags.language||flags.lang||readConfiguredLanguage(root)||detectLanguage(root)); info('문서 언어: '+languageName(selectedLanguage));
  const ctx=makeContext(root,collectLegacyText(found),[],selectedLanguage);
  for(const [file,template] of Object.entries(coreFiles)) writeCoreSafely(root,file,fill(template,ctx),{dryRun,force});
  if(!dryRun){ ok('마이그레이션 완료'); info('기존 프로젝트 메모리 파일은 보존되었습니다. 템플릿 재생성이 필요하면 --force를 명시하세요.'); }
}
function status(root){ root=path.resolve(root||process.cwd()); const vf=path.join(root,'.harness/HARNESS_VERSION'); const version=exists(vf)?read(vf).trim():'not installed'; const missing=Object.keys(coreFiles).filter(f=>!exists(path.join(root,f))); const lp=path.join(root,'.harness/skills-lock.json'); const lock=exists(lp)?parseJsonSafe(read(lp),{installedSkills:{}}):{installedSkills:{}}; banner(); log('대상: '+root); log('버전: '+version); log('파일: '+(Object.keys(coreFiles).length-missing.length)+'/'+Object.keys(coreFiles).length); if(missing.length){ warn('누락 파일'); missing.forEach(x=>log('  - '+x)); } else ok('필수 파일 모두 존재'); const names=Object.keys(lock.installedSkills||{}); log('설치 스킬: '+(names.length?names.join(', '):'없음')); }
function scanSensitivePath(root){ const out=[]; if(!exists(root)) return out; const patterns=[{type:'npm token',re:/npm_[A-Za-z0-9]{20,}/},{type:'github token',re:/gh[pousr]_[A-Za-z0-9_]{20,}/},{type:'private key',re:/-----BEGIN [A-Z ]*PRIVATE KEY-----/},{type:'password assignment',re:/(password|secret|token|api[_-]?key)\s*[:=]\s*['\"][^'\"]{8,}/i}]; function walk(p){ const st=fs.statSync(p); if(st.isDirectory()){ const b=path.basename(p); if(['node_modules','.git','archive','dist'].includes(b)) return; for(const n of fs.readdirSync(p)) walk(path.join(p,n)); } else if(st.isFile()&&isTextFile(p)){ const body=read(p); for(const pat of patterns){ const m=body.match(pat.re); if(m) out.push({file:p,type:pat.type,sample:m[0].slice(0,60)}); } } } try{ walk(root); }catch{} return out; }
function verify(root){ root=path.resolve(root||process.cwd()); let failures=0; banner(); for(const file of Object.keys(coreFiles)){ const target=path.join(root,file); if(!exists(target)){ failures++; warn('누락: '+file); continue; } const body=read(target); if(/{{[A-Z_]+}}/.test(body)){ failures++; warn('플레이스홀더 남음: '+file); } } const suspicious=[]; for(const x of ['.harness','AGENTS.md','CLAUDE.md']) for(const f of scanSensitivePath(path.join(root,x))) suspicious.push(f); if(suspicious.length){ failures+=suspicious.length; suspicious.forEach(x=>warn('민감정보 의심: '+rel(root,x.file)+' · '+x.type)); } if(failures){ fail('검증 실패: '+failures); process.exitCode=1; } else ok('검증 완료'); }

function skillDisplayName(meta){ return meta.displayNameKo || meta.titleKo || meta.title || meta.name; }
function verificationLabel(meta){ const v=(meta||{}).verification||{}; return v.status ? (v.status+(v.verifiedAt?' '+String(v.verifiedAt).slice(0,10):'')) : 'unknown'; }
function renderSkillMeta(meta){ log('- '+meta.name+'@'+meta.version+' · '+skillDisplayName(meta)); if(meta.categoryKo||meta.category) log('  분류: '+(meta.categoryKo||meta.category)); if(meta.description) log('  설명: '+meta.description); if(Array.isArray(meta.capabilities)&&meta.capabilities.length){ log('  가능한 작업:'); meta.capabilities.forEach(x=>log('    - '+x)); } log('  업데이트: '+(meta.lastUpdated||'unknown')+' · 검증: '+verificationLabel(meta)); if((meta.requiresEnv||[]).length) log('  필요한 환경변수: '+meta.requiresEnv.join(', ')); }
function skillCommand(args,flags){ const sub=args[1]||'list'; const root=path.resolve(flags.path||process.cwd()); if(sub==='list'){ banner(); log('사용 가능한 스킬 라이브러리'); for(const p of listSkillPacks()) renderSkillMeta(p); return; } if(sub==='info'||sub==='show'){ const name=args[2]; if(!name) return fail('스킬 이름이 필요합니다.'); const meta=getSkillMeta(name); if(!meta) return fail('알 수 없는 스킬: '+name); banner(); renderSkillMeta(meta); const rp=path.join(PACKS_DIR,name,'README.md'); if(exists(rp)){ log('\n--- README ---\n'); log(read(rp)); } return; } const name=args[2]; if(!name) return fail('스킬 이름이 필요합니다.'); if(sub==='add'||sub==='install'||sub==='update') return installSkill(root,name,Boolean(flags['dry-run'])); if(sub==='remove'||sub==='rm') return removeSkill(root,name); if(sub==='learn') return learnSkillLibrary(root,{...flags,name}); fail('알 수 없는 skill 명령: '+sub); }

function skillLibraryFiles(dir){ const out=[]; if(!exists(dir)) return out; function walk(p){ const st=fs.statSync(p); if(st.isDirectory()){ const b=path.basename(p); if(['node_modules','.git','dist'].includes(b)) return; for(const n of fs.readdirSync(p)) walk(path.join(p,n)); } else if(st.isFile()) out.push(p); } walk(dir); return out; }
function inferEnvNames(body){ const set=new Set(); const re=/\b[A-Z][A-Z0-9_]{3,}\b/g; let m; while((m=re.exec(body))){ const v=m[0]; if(/(KEY|TOKEN|SECRET|PASSWORD|CLIENT|VENDOR|ID|URL|HOST|BUCKET|PROJECT)/.test(v)) set.add(v); } return Array.from(set).sort(); }
function readSkillLibraryMeta(dir){ for(const cnd of [path.join(dir,'skill-library.json'),path.join(dir,'skill.json'),path.join(dir,'package.json')]){ if(!exists(cnd)) continue; const data=parseJsonSafe(read(cnd),null); if(!data) continue; if(path.basename(cnd)==='package.json') return {name:data.harnessSkill?.name||data.name,version:data.version||'0.1.0',title:data.harnessSkill?.title||data.description||data.name,description:data.description||'',requiresEnv:data.harnessSkill?.requiresEnv||[],verification:data.harnessSkill?.verification,lastUpdated:data.harnessSkill?.lastUpdated,lastUpdatedAt:data.harnessSkill?.lastUpdatedAt}; return data; } return null; }
function validateSkillLibrary(dir,opts={}){ dir=path.resolve(dir); let failures=0; const meta=readSkillLibraryMeta(dir); if(!meta||!meta.name){ failures++; fail('skill-library.json 또는 skill.json에 name이 필요합니다.'); } const sd=path.join(dir,'skills'); if(!exists(sd)||!skillLibraryFiles(sd).some(f=>f.endsWith('.md'))){ failures++; fail('skills/*.md 파일이 필요합니다.'); } const findings=scanSensitivePath(dir); if(findings.length){ failures+=findings.length; fail('민감정보 의심 패턴 감지.'); findings.slice(0,10).forEach(f=>warn(rel(dir,f.file)+' · '+f.type)); } if(opts.strictAi){ const v=(meta||{}).verification||{}; if(!(v.status==='passed'&&/ai/i.test(String(v.method||''))&&v.verifiedAt)){ failures++; fail('AI 검증 메타데이터가 필요합니다.'); } } if(!opts.silent){ if(failures) fail('검증 실패: '+failures); else ok('스킬 라이브러리 검증 완료: '+meta.name); } return {ok:failures===0,meta,findings}; }
function learnSkillLibrary(root,flags){ root=path.resolve(root||process.cwd()); const from=path.resolve(flags.from||path.join(root,'.harness/skills')); const name=slug(flags.name||path.basename(from)); const outRoot=path.resolve(flags.out||path.join(root,'.harness/library',name)); if(!exists(from)){ fail('학습할 스킬 경로가 없습니다: '+from); process.exitCode=1; return; } const files=skillLibraryFiles(from).filter(f=>isTextFile(f)&&!f.includes(path.sep+'archive'+path.sep)); fs.mkdirSync(path.join(outRoot,'skills'),{recursive:true}); const envs=new Set(), copied=[]; for(const f of files){ const body=read(f); inferEnvNames(body).forEach(e=>envs.add(e)); const dest='skills/'+path.basename(f).replace(/[^a-zA-Z0-9._-]/g,'-'); write(path.join(outRoot,dest),body); copied.push(dest); } const meta={name,version:String(flags.version||'0.1.0'),title:flags.title||name,description:flags.description||'Learned Leerness skill library.',category:flags.category||'custom',requiresEnv:Array.from(envs).sort(),files:copied,lastUpdated:today(),lastUpdatedAt:now(),verification:{status:'needs-review',method:'none',verifiedBy:null,verifiedAt:null,checks:[]}}; write(path.join(outRoot,'skill-library.json'),JSON.stringify(meta,null,2)+'\n'); write(path.join(outRoot,'README.md'),'# '+meta.title+'\n\n'+meta.description+'\n'); ok('스킬 라이브러리 학습 완료: '+outRoot); info('다음: leerness library verify '+outRoot+' --ai --reviewer leerness-ai'); }
function verifySkillLibrary(dir,flags){ dir=path.resolve(dir||process.cwd()); const res=validateSkillLibrary(dir,{silent:false}); if(!res.ok){ process.exitCode=1; return; } const meta=res.meta; meta.verification={status:'passed',method:'ai-assisted-review',verifiedBy:String(flags.reviewer||flags.by||'leerness-ai'),verifiedAt:now(),checks:['structure','secret-scan','env-reference-only','metadata']}; meta.lastUpdated=today(); meta.lastUpdatedAt=now(); write(path.join(dir,'skill-library.json'),JSON.stringify(meta,null,2)+'\n'); write(path.join(dir,'ai-verification.json'),JSON.stringify(meta.verification,null,2)+'\n'); ok('AI 검증 완료: '+meta.name); }
function buildSkillLibrary(dir,flags){ dir=path.resolve(dir||process.cwd()); const res=validateSkillLibrary(dir,{silent:false,strictAi:Boolean(flags['strict-ai'])}); if(!res.ok){ process.exitCode=1; return; } const meta=res.meta; const out=path.resolve(flags.out||path.join(dir,'dist')); const libRoot=path.join(out,slug(meta.name)); if(exists(libRoot)) fs.rmSync(libRoot,{recursive:true,force:true}); fs.mkdirSync(libRoot,{recursive:true}); for(const item of ['README.md','skill-library.json','skill.json','ai-verification.json','env.example','skills','examples','migrations']){ const src=path.join(dir,item); if(exists(src)) copyRecursive(src,path.join(libRoot,item)); } const pkg={name:flags.package||('leerness-skill-'+slug(meta.name)),version:meta.version||'0.1.0',description:meta.description||meta.title||meta.name,type:'commonjs',files:['skill-library.json','ai-verification.json','README.md','env.example','skills/','examples/','migrations/'],keywords:['leerness','harness-skill','ai-skill-library'],license:'MIT',publishConfig:{access:'public'},harnessSkill:meta}; write(path.join(libRoot,'package.json'),JSON.stringify(pkg,null,2)+'\n'); ok('스킬 라이브러리 빌드 완료: '+libRoot); }
function resolvePublishToken(target,flags){ if(flags['token-env','language','lang','status','reason','owner','evidence','next','action']&&process.env[flags['token-env','language','lang','status','reason','owner','evidence','next','action']]) return process.env[flags['token-env','language','lang','status','reason','owner','evidence','next','action']]; const names=target==='npm'?['LEERNESS_NPM_TOKEN','NPM_TOKEN','NODE_AUTH_TOKEN']:['LEERNESS_GIT_TOKEN','LEERNESS_GITHUB_TOKEN','GITHUB_TOKEN','GH_TOKEN']; for(const n of names) if(process.env[n]) return process.env[n]; return null; }
function publishSkillLibrary(dir,flags){ dir=path.resolve(dir||process.cwd()); const target=String(flags.target||'npm'); const execute=Boolean(flags.execute); const res=validateSkillLibrary(dir,{silent:false,strictAi:true}); if(!res.ok){ process.exitCode=1; return; } if(!execute){ info('[dry-run] '+target+' publish target: '+dir); info('실제 업로드는 --execute가 필요합니다.'); return; } const token=resolvePublishToken(target,flags); if(!token && flags['no-prompt']){ fail('업로드 토큰이 없습니다. 환경변수 또는 --token-env를 설정하세요.'); process.exitCode=1; return; } if(target==='npm'){ const env={...process.env}; if(token) env.NODE_AUTH_TOKEN=token; const r=childProcess.spawnSync('npm',['publish','--access','public'],{cwd:dir,stdio:'inherit',env,shell:process.platform==='win32'}); process.exitCode=r.status||0; return; } if(target==='git'){ const repo=flags.repo||DEFAULT_GIT_REPOSITORY; info('Git target: '+repo); const run=(cmd,args)=>{ const r=childProcess.spawnSync(cmd,args,{cwd:dir,stdio:'inherit',shell:process.platform==='win32'}); if(r.status) process.exit(r.status); }; if(!exists(path.join(dir,'.git'))) run('git',['init']); try{ run('git',['remote','add','origin',repo]); }catch{} run('git',['add','.']); run('git',['commit','-m',flags.message||('Publish skill library '+res.meta.name)]); run('git',['branch','-M',flags.branch||'main']); run('git',['push','-u','origin',flags.branch||'main']); return; } fail('지원하지 않는 target: '+target); }
function libraryGuide(root){ root=path.resolve(root||process.cwd()); const p=path.join(root,'.harness/AX_SKILL_LIBRARY_GUIDE.md'); if(exists(p)) log(read(p)); else log(coreFiles['.harness/AX_SKILL_LIBRARY_GUIDE.md']); }
function libraryCommand(args,flags){ const sub=args[1]||'help'; if(sub==='guide') return libraryGuide(args[2]||flags.path||process.cwd()); if(sub==='validate') return validateSkillLibrary(args[2]||process.cwd(),{silent:false,strictAi:Boolean(flags['strict-ai'])}); if(sub==='verify') return verifySkillLibrary(args[2]||process.cwd(),flags); if(sub==='build') return buildSkillLibrary(args[2]||process.cwd(),flags); if(sub==='publish'||sub==='upload') return publishSkillLibrary(args[2]||process.cwd(),flags); if(sub==='status'){ const meta=readSkillLibraryMeta(args[2]||process.cwd()); if(!meta) return fail('메타데이터 없음'); renderSkillMeta(meta); return; } fail('알 수 없는 library 명령: '+sub); }



function planFile(root){ return path.join(root,'.harness/plan.md'); }
function ensurePlan(root){
  const p=planFile(root);
  if(!exists(p)){
    const ctx=makeContext(root,{},[],readConfiguredLanguage(root)||detectLanguage(root));
    writeCoreSafely(root,'.harness/plan.md',fill(coreFiles['.harness/plan.md'],ctx),{force:false,dryRun:false});
  }
  return p;
}
function readPlanText(root){ const p=ensurePlan(root); return read(p); }
function writePlanText(root,body){ write(planFile(root),body); }
function nextMilestoneId(body){ let max=0; for(const m of body.matchAll(/\bM-(\d+)\b/g)) max=Math.max(max,parseInt(m[1],10)); return 'M-'+String(max+1).padStart(4,'0'); }
function appendPlanChange(body,change,reason,by){
  const row=`| ${today()} | ${String(change).replace(/\|/g,'/')} | ${String(reason||'-').replace(/\|/g,'/')} | ${String(by||'user').replace(/\|/g,'/')} |`;
  if(body.includes('## Plan Change Log')) return body.replace(/(## Plan Change Log[\s\S]*?\n\|---\|---\|---\|---\|\n)/, '$1'+row+'\n');
  return body.replace(/\s*$/,'\n\n## Plan Change Log\n| Date | Change | Reason | Requested By |\n|---|---|---|---|\n'+row+'\n');
}
function planAdd(root,text,flags={}){
  root=path.resolve(root||process.cwd()); const file=ensurePlan(root); let body=read(file); const id=nextMilestoneId(body);
  const status=String(flags.status||'planned'); const progress=String(flags.progress||'0').replace(/%$/,'')+'%';
  const row=`| ${id} | ${String(text).replace(/\|/g,'/')} | ${status} | ${progress} | - | ${String(flags.note||'Added from user request').replace(/\|/g,'/')} |`;
  if(body.includes('## Milestones')){
    body=body.replace(/(## Milestones[\s\S]*?\n\|---\|---\|---\|---:?\|---\|---\|\n)/, '$1'+row+'\n');
  } else {
    body=body.replace(/\s*$/,'\n\n## Milestones\n| ID | Milestone | Status | Progress | Related Tasks | Notes |\n|---|---|---|---:|---|---|\n'+row+'\n');
  }
  body=appendPlanChange(body,'Added '+id+': '+text,flags.reason||'new user request',flags.by||'user');
  writePlanText(root,body); ok('계획 추가: '+id);
  const tasks=readProgressTasks(root); tasks.push({id:nextTaskId(tasks),request:text,status:status==='done'?'done':'planned',owner:'AI',lastUpdate:today(),evidence:'Linked to '+id,nextAction:String(flags.next||'Start or refine this plan item')}); writeProgressTasks(root,tasks);
}
function planDrop(root,item,flags={}){
  root=path.resolve(root||process.cwd()); const file=ensurePlan(root); let body=read(file); const reason=String(flags.reason||'Dropped by user');
  const row=`| ${String(item).replace(/\|/g,'/')} | ${reason.replace(/\|/g,'/')} | ${today()} |`;
  if(body.includes('## Out of Scope / Dropped')) body=body.replace(/(## Out of Scope \/ Dropped[\s\S]*?\n\|---\|---\|---\|\n)/, '$1'+row+'\n');
  else body=body.replace(/\s*$/,'\n\n## Out of Scope / Dropped\n| Item | Reason | Dropped At |\n|---|---|---|\n'+row+'\n');
  body=appendPlanChange(body,'Dropped: '+item,reason,flags.by||'user'); writePlanText(root,body); ok('계획 드랍 기록: '+item);
  const tasks=readProgressTasks(root); let matched=false; for(const t of tasks){ if(String(t.request).includes(item)||String(item).includes(t.request)){ t.status='dropped'; t.evidence=reason; t.nextAction='None'; t.lastUpdate=today(); matched=true; } }
  if(!matched) tasks.push({id:nextTaskId(tasks),request:item,status:'dropped',owner:'AI',lastUpdate:today(),evidence:reason,nextAction:'None'}); writeProgressTasks(root,tasks);
}
function planUpdate(root,id,flags={}){
  root=path.resolve(root||process.cwd()); const file=ensurePlan(root); let body=read(file); let changed=false;
  body=body.split(/\r?\n/).map(line=>{
    if(!line.startsWith('| '+id+' |')) return line;
    const cols=splitTableLine(line); if(cols.length<6) return line;
    if(flags.title||flags.name) cols[1]=String(flags.title||flags.name).replace(/\|/g,'/');
    if(flags.status) cols[2]=String(flags.status);
    if(flags.progress!==undefined) cols[3]=String(flags.progress).replace(/%$/,'')+'%';
    if(flags.tasks) cols[4]=String(flags.tasks).replace(/\|/g,'/');
    if(flags.note) cols[5]=String(flags.note).replace(/\|/g,'/');
    changed=true; return '| '+cols.join(' | ')+' |';
  }).join('\n');
  if(!changed){ fail('계획 ID를 찾을 수 없습니다: '+id); process.exitCode=1; return; }
  body=appendPlanChange(body,'Updated '+id,flags.reason||'plan update',flags.by||'user'); writePlanText(root,body); ok('계획 업데이트: '+id);
}
function planProgress(root){
  root=path.resolve(root||process.cwd()); const body=readPlanText(root); const rows=[];
  for(const line of body.split(/\r?\n/)){ if(/^\|\s*M-/.test(line)){ const c=splitTableLine(line); if(c.length>=6) rows.push({id:c[0],milestone:c[1],status:c[2],progress:c[3],tasks:c[4],notes:c[5]}); } }
  banner(); log('Plan progress: '+root); if(!rows.length){ warn('계획 milestone이 없습니다. leerness plan add 를 사용하세요.'); return; }
  rows.forEach(r=>log(`  - ${r.id} [${r.status}] ${r.progress} ${r.milestone} :: tasks=${r.tasks}`));
}
function planSync(root){
  root=path.resolve(root||process.cwd()); ensurePlan(root); const tasks=readProgressTasks(root);
  const active=tasks.filter(t=>ACTIVE_TASK_STATUSES.has(t.status));
  const done=tasks.filter(t=>t.status==='done').length; const total=tasks.filter(t=>t.status!=='dropped').length; const pct=total?Math.round(done/total*100):0;
  const cs=path.join(root,'.harness/current-state.md');
  if(exists(cs)){
    let body=read(cs); const block=`\n## Plan Sync\n- Updated: ${today()}\n- Non-dropped task progress: ${done}/${total} (${pct}%)\n- Active unresolved tasks: ${active.length}\n- Source: plan.md + progress-tracker.md\n`;
    if(body.includes('## Plan Sync')) body=body.replace(/\n## Plan Sync[\s\S]*?(?=\n## |$)/, block);
    else body=body.replace(/\s*$/, block+'\n');
    write(cs,body); ok('current-state.md plan sync 갱신');
  }
  ok('plan/progress sync 완료: '+done+'/'+total+' = '+pct+'%');
}
function planCommand(args,flags){
  const sub=args[1]||'show'; const root=path.resolve(flags.path||((sub==='show'||sub==='progress'||sub==='sync'||sub==='init')?args[2]:process.cwd())||process.cwd());
  if(sub==='show'){ log(readPlanText(root)); return; }
  if(sub==='init'){ ensurePlan(root); if(flags.goal){ planAdd(root,String(flags.goal),{status:'planned',reason:'initial project goal',by:'user'}); } ok('plan.md 준비 완료'); return; }
  if(sub==='add'){ const text=args[2]||flags.title||flags.name; if(!text){ fail('추가할 계획 내용을 입력하세요.'); process.exitCode=1; return; } return planAdd(root,text,flags); }
  if(sub==='drop'||sub==='remove'){ const item=args[2]||flags.title||flags.name; if(!item){ fail('드랍할 계획 항목을 입력하세요.'); process.exitCode=1; return; } return planDrop(root,item,flags); }
  if(sub==='update'){ const id=args[2]; if(!id){ fail('업데이트할 계획 ID를 입력하세요.'); process.exitCode=1; return; } return planUpdate(root,id,flags); }
  if(sub==='progress') return planProgress(root);
  if(sub==='sync') return planSync(root);
  fail('알 수 없는 plan 명령: '+sub);
}


const ACTIVE_TASK_STATUSES = new Set(['requested','planned','in-progress','waiting','on-hold','blocked','incomplete']);
const ALL_TASK_STATUSES = new Set(['requested','planned','in-progress','waiting','on-hold','blocked','incomplete','done','dropped']);
function progressFile(root){ return path.join(root,'.harness/progress-tracker.md'); }
function splitTableLine(line){ return line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(x=>x.trim()); }
function readProgressTasks(root){
  const file=progressFile(root); if(!exists(file)) return [];
  const tasks=[];
  for(const line of read(file).split(/\r?\n/)){
    if(!/^\|\s*T-[0-9A-Za-z_-]+\s*\|/.test(line)) continue;
    const cols=splitTableLine(line); if(cols.length<7) continue;
    tasks.push({id:cols[0],request:cols[1],status:cols[2],owner:cols[3],lastUpdate:cols[4],evidence:cols[5],nextAction:cols[6]});
  }
  return tasks;
}
function taskTable(tasks){
  return '| ID | User Request | Status | Owner | Last Update | Evidence / Notes | Next Action |\n|---|---|---|---|---|---|---|\n'+tasks.map(t=>`| ${t.id} | ${String(t.request||'').replace(/\|/g,'/')} | ${t.status||'requested'} | ${t.owner||'AI'} | ${t.lastUpdate||today()} | ${String(t.evidence||'').replace(/\|/g,'/')} | ${String(t.nextAction||'').replace(/\|/g,'/')} |`).join('\n')+'\n';
}
function writeProgressTasks(root,tasks){
  const file=progressFile(root);
  const lang=readConfiguredLanguage(root)||detectLanguage(root);
  const intro=lang==='ko'
    ? '# Progress Tracker\n\n사용자가 요청한 작업을 세션 간 추적합니다. 세션 종료 시 미완료/예정/보류/대기/진행중 작업은 반드시 표시합니다.\n\n'
    : '# Progress Tracker\n\nTrack user-requested work across sessions. At session close, unresolved/planned/on-hold/waiting/in-progress tasks must be listed.\n\n';
  const status='\n## Status Values\n\n- requested\n- planned\n- in-progress\n- waiting\n- on-hold\n- blocked\n- incomplete\n- done\n- dropped\n\n## Drop Policy\n\nDropped tasks are not deleted. Mark Status as dropped and write the reason in Evidence / Notes.\n';
  write(file,`${MARK}\n---\nleernessRole: progress-tracker\nreadWhen: [planning, resume-work, end-of-session, multi-step-work]\nupdateWhen: [task-started, task-completed, task-blocked, task-dropped, scope-change, end-of-session]\ndoNotStore: [secrets, tokens, credentials, raw-private-data]\n---\n\n`+intro+taskTable(tasks)+status);
}
function nextTaskId(tasks){
  let max=0; for(const t of tasks){ const m=String(t.id||'').match(/T-(\d+)/); if(m) max=Math.max(max,parseInt(m[1],10)); }
  return 'T-'+String(max+1).padStart(4,'0');
}
function renderTasks(tasks,filterStatuses){
  const filtered=filterStatuses?tasks.filter(t=>filterStatuses.has(t.status)):tasks;
  if(!filtered.length){ log('  - 없음'); return; }
  for(const t of filtered) log(`  - ${t.id} [${t.status}] ${t.request} :: next=${t.nextAction||'-'} :: note=${t.evidence||'-'}`);
}
function taskCommand(args,flags){
  const sub=args[1]||'list'; const root=path.resolve(flags.path||args[3]||process.cwd());
  const tasks=readProgressTasks(root);
  if(sub==='list'){
    banner();
    const status=flags.status?new Set(String(flags.status).split(',').map(x=>x.trim()).filter(Boolean)):null;
    log('Progress tasks: '+root); renderTasks(tasks,status); return;
  }
  if(sub==='add'){
    const request=args[2]||flags.title||flags.name; if(!request){ fail('추가할 작업 내용을 입력하세요. 예: leerness task add "배포 검증" --status planned'); process.exitCode=1; return; }
    const status=String(flags.status||'planned'); if(!ALL_TASK_STATUSES.has(status)){ fail('지원하지 않는 status: '+status); process.exitCode=1; return; }
    const t={id:nextTaskId(tasks),request,status,owner:String(flags.owner||'AI'),lastUpdate:today(),evidence:String(flags.evidence||'added by leerness task add'),nextAction:String(flags.next||flags.action||'Define next exact step')};
    tasks.push(t); writeProgressTasks(root,tasks); ok('작업 추가: '+t.id); return;
  }
  if(sub==='update'){
    const id=args[2]; const t=tasks.find(x=>x.id===id); if(!t){ fail('작업 ID를 찾을 수 없습니다: '+id); process.exitCode=1; return; }
    if(flags.status){ const st=String(flags.status); if(!ALL_TASK_STATUSES.has(st)){ fail('지원하지 않는 status: '+st); process.exitCode=1; return; } t.status=st; }
    if(flags.evidence) t.evidence=String(flags.evidence);
    if(flags.next||flags.action) t.nextAction=String(flags.next||flags.action);
    if(flags.owner) t.owner=String(flags.owner);
    t.lastUpdate=today(); writeProgressTasks(root,tasks); ok('작업 업데이트: '+id); return;
  }
  if(sub==='drop'||sub==='remove'){
    const id=args[2]; const t=tasks.find(x=>x.id===id); if(!t){ fail('작업 ID를 찾을 수 없습니다: '+id); process.exitCode=1; return; }
    t.status='dropped'; t.lastUpdate=today(); t.evidence=String(flags.reason||flags.evidence||'Dropped by user'); t.nextAction='None'; writeProgressTasks(root,tasks); ok('작업 드랍 처리: '+id); return;
  }
  fail('알 수 없는 task 명령: '+sub);
}
function debugHarness(root){
  root=path.resolve(root||process.cwd()); banner(); let failures=0,warnings=0;
  const required=['AGENTS.md','.harness/plan.md','.harness/guideline.md','.harness/language-policy.md','.harness/context-routing.md','.harness/writeback-policy.md','.harness/task-type-map.md','.harness/session-close-policy.md','.harness/progress-tracker.md','.harness/anti-lazy-work-policy.md','.harness/debug-guide.md'];
  for(const f of required){ if(exists(path.join(root,f))) ok('존재: '+f); else { failures++; fail('누락: '+f); } }
  const ag=path.join(root,'AGENTS.md');
  if(exists(ag)){
    const body=read(ag);
    for(const term of ['plan.md','guideline.md','language-policy.md','context-routing.md','writeback-policy.md','progress-tracker.md','anti-lazy-work-policy.md','End-of-Session Contract']){
      if(body.includes(term)) ok('AGENTS 방향지시 포함: '+term); else { failures++; fail('AGENTS 방향지시 누락: '+term); }
    }
  }

  const pf=path.join(root,'.harness/plan.md');
  if(exists(pf)){ const b=read(pf); if(b.includes('## Milestones')) ok('plan.md milestones 확인'); else { warnings++; warn('plan.md에 Milestones 섹션이 없습니다.'); } }
  const gf=path.join(root,'.harness/guideline.md');
  if(exists(gf)){ const b=read(gf); if(b.includes('plan.md')&&b.includes('progress-tracker.md')) ok('guideline.md가 plan/progress를 참조합니다.'); else { failures++; fail('guideline.md가 plan.md/progress-tracker.md를 참조하지 않습니다.'); } }
  const mf=path.join(root,'.harness/manifest.json');
  if(exists(mf)){ const m=parseJsonSafe(read(mf),{}); if(m.language) ok('언어 설정: '+m.language+' ('+(m.languageName||languageName(m.language))+')'); else { warnings++; warn('manifest language 누락'); } }
  const tasks=readProgressTasks(root);
  const active=tasks.filter(t=>ACTIVE_TASK_STATUSES.has(t.status));
  log('\nActive unresolved tasks:'); renderTasks(active);
  const badSensitive=scanSensitivePath(path.join(root,'.harness')).filter(x=>!x.file.includes(path.sep+'archive'+path.sep));
  if(badSensitive.length){ failures+=badSensitive.length; badSensitive.forEach(x=>fail('민감정보 의심: '+rel(root,x.file)+' '+x.type)); } else ok('하네스 민감정보 스캔 통과');
  log('\nDebug summary: '+(failures?'FAIL':'PASS')+' / warnings='+warnings+' / failures='+failures);
  if(failures) process.exitCode=1;
}

function closeSession(root){
  root=path.resolve(root||process.cwd());
  banner();
  const template=path.join(root,'.harness/templates/end-of-session-report.md');
  const policy=path.join(root,'.harness/session-close-policy.md');
  const progress=path.join(root,'.harness/progress-tracker.md');
  log('Session close checklist');
  log('');
  log('Read before closing:');
  ['.harness/session-close-policy.md','.harness/plan.md','.harness/guideline.md','.harness/progress-tracker.md','.harness/current-state.md','.harness/task-log.md','.harness/session-handoff.md','.harness/anti-lazy-work-policy.md'].forEach(x=>log('  - '+x));
  log('');
  log('Required final report sections:');
  ['Plan Progress Summary','Completed This Session','In Progress From User Requests','Incomplete / Not Started From User Requests','Planned Tasks','Waiting Tasks','On-Hold Tasks','Blocked Tasks','Dropped By User','Verification','Files Changed','Memory Files Updated','Risks / Assumptions / Blockers','Recommended Next Directions','Next Exact Step'].forEach(x=>log('  - '+x));
  log('');
  if(exists(template)) log(read(template));
  else log('# End-of-Session Report\n\n## Completed This Session\n-\n\n## In Progress From User Requests\n-\n\n## Incomplete / Not Started From User Requests\n-\n\n## Planned Tasks\n-\n\n## Waiting Tasks\n-\n\n## On-Hold Tasks\n-\n\n## Blocked Tasks\n-\n\n## Dropped By User\n-\n\n## Verification\n-\n\n## Files Changed\n-\n\n## Memory Files Updated\n-\n\n## Risks / Assumptions / Blockers\n-\n\n## Recommended Next Directions\n-\n\n## Next Exact Step\n-\n');
  const tasks=readProgressTasks(root);
  const active=tasks.filter(t=>ACTIVE_TASK_STATUSES.has(t.status));
  const dropped=tasks.filter(t=>t.status==='dropped');
  log('');
  log('Tracked unresolved / planned / waiting / on-hold / in-progress work:');
  renderTasks(active);
  log('');
  log('Dropped by user:');
  renderTasks(dropped);
  if(!exists(policy)) warn('session-close-policy.md가 없습니다. leerness migrate를 실행하세요.');
  if(!exists(progress)) warn('progress-tracker.md가 없습니다. leerness migrate를 실행하세요.');
}
function sessionCommand(args){ const sub=args[1]||'close'; if(sub==='close'||sub==='handoff'||sub==='end') return closeSession(args[2]||process.cwd()); fail('알 수 없는 session 명령: '+sub); }

const routeData={planning:{read:['plan.md','progress-tracker.md','project-brief.md','current-state.md','guideline.md'],update:['plan.md','progress-tracker.md','current-state.md','session-handoff.md']},feature:{read:['plan.md','progress-tracker.md','project-brief.md','current-state.md','architecture.md','context-map.md','feature-contracts.md'],update:['current-state.md','task-log.md','session-handoff.md','feature-contracts.md']},ui:{read:['design-system.md','feature-contracts.md','context-map.md'],update:['design-system.md','feature-contracts.md','current-state.md','task-log.md']},debugging:{read:['current-state.md','task-log.md','feature-contracts.md','testing-strategy.md'],update:['task-log.md','current-state.md','session-handoff.md']},refactor:{read:['architecture.md','decisions.md','guardrails.md'],update:['architecture.md','decisions.md','task-log.md']},release:{read:['plan.md','progress-tracker.md','release-checklist.md','testing-strategy.md','current-state.md','decisions.md','secret-policy.md'],update:['release-checklist.md','task-log.md','current-state.md','session-handoff.md']},migration:{read:['AX_MIGRATION_GUIDE.md','context-routing.md','writeback-policy.md'],update:['Only missing files by default','Use --force only when requested']},'new-install':{read:['AX_NEW_PROJECT_GUIDE.md','AX_PLAN_GUIDE.md','actual project files'],update:['plan.md','project-brief.md','architecture.md','context-map.md','design-system.md','feature-contracts.md','release-checklist.md']},'skill-library':{read:['AX_SKILL_LIBRARY_GUIDE.md','skill-index.md','secret-policy.md'],update:['skill-index.md','skills-lock.json','task-log.md']},documentation:{read:['writeback-policy.md','context-routing.md'],update:['specific memory file','task-log.md','session-handoff.md']},debug:{read:['debug-guide.md','AGENTS.md','plan.md','guideline.md','language-policy.md','context-routing.md','writeback-policy.md','progress-tracker.md','session-close-policy.md'],update:['debug findings in task-log.md','progress-tracker.md when user-requested debug work changes']},'session-close':{read:['session-close-policy.md','plan.md','guideline.md','progress-tracker.md','current-state.md','task-log.md','session-handoff.md','anti-lazy-work-policy.md'],update:['session-handoff.md','progress-tracker.md','current-state.md','task-log.md','relevant changed memory files']}};
function routePath(x){ if(String(x).includes('/')||String(x).endsWith('.md')&&['AGENTS.md','CLAUDE.md','README.md'].includes(String(x))) return String(x); if(String(x).includes(' ')) return String(x); return '.harness/'+x; }
function routeCommand(task){ banner(); if(!task||task==='list'){ log('사용 가능한 task type: '+Object.keys(routeData).join(', ')); return; } const r=routeData[task]; if(!r){ fail('알 수 없는 task type: '+task); process.exitCode=1; return; } log('Task route: '+task); log('\nRead before work:'); r.read.forEach(x=>log('  - '+routePath(x))); log('\nUpdate after work:'); r.update.forEach(x=>log('  - '+routePath(x))); }
function help(){ log(['Leerness v'+VERSION,'','Usage:','  leerness init [path] [--yes] [--language auto|ko|en] [--skills recommended|all|office,commerce-api] [--force]','  leerness migrate [path] [--dry-run] [--language auto|ko|en] [--force]','  leerness status [path]','  leerness verify [path]','  leerness debug [path]','  leerness route <planning|feature|ui|debugging|refactor|release|migration|new-install|skill-library|documentation|debug|session-close>','','Plan:','  leerness plan show [path]','  leerness plan init [path] --goal "project goal"','  leerness plan add "milestone or scope" [--status planned]','  leerness plan drop "item" --reason "user excluded"','  leerness plan update M-0002 --status in-progress --progress 40','  leerness plan progress [path]','  leerness plan sync [path]','','Tasks:','  leerness task list [--status planned,waiting,on-hold]','  leerness task add "request" [--status planned]','  leerness task update T-0002 --status in-progress','  leerness task drop T-0002 --reason "user dropped"','','Session:','  leerness session close [path]','','Skills:','  leerness skill list','  leerness skill info <name>','  leerness skill add <name> [--path <project>]','  leerness skill remove <name> [--path <project>]','  leerness skill learn <name> --from <validated-skill-path>','','Skill library:','  leerness library guide [path]','  leerness library validate <path> [--strict-ai]','  leerness library verify <path> --ai --reviewer leerness-ai','  leerness library build <path> [--package leerness-skill-name]','  leerness library publish <built-library> --target npm|git [--execute]',''].join('\n')); }
async function main(){ const parsed=parseArgs(process.argv.slice(2)); const args=parsed.positionals, flags=parsed.flags; if(flags.version||flags.v){ log(VERSION); return; } if(flags.help||flags.h){ help(); return; } const cmd=args[0]||'init'; if(cmd==='init') return init(args[1]||process.cwd(),flags); if(cmd==='migrate') return migrate(args[1]||process.cwd(),flags); if(cmd==='status') return status(args[1]||process.cwd()); if(cmd==='verify') return verify(args[1]||process.cwd()); if(cmd==='route') return routeCommand(args[1]||'list'); if(cmd==='debug') return debugHarness(args[1]||process.cwd()); if(cmd==='plan') return planCommand(args,flags); if(cmd==='task') return taskCommand(args,flags); if(cmd==='session') return sessionCommand(args); if(cmd==='skill') return skillCommand(args,flags); if(cmd==='library') return libraryCommand(args,flags); help(); process.exitCode=1; }
main().catch(err=>{ fail(err.stack||err.message); process.exit(1); });
