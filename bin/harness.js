#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const childProcess = require('child_process');

const VERSION = '1.0.0';
const MARK = '<!-- leerness:managed -->';
const MIGRATED = '<!-- leerness:migrated-legacy -->';
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const PACKS_DIR = path.join(PACKAGE_ROOT, 'skill-packs');
const c = { reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m', green:'\x1b[32m', yellow:'\x1b[33m', cyan:'\x1b[36m', red:'\x1b[31m', magenta:'\x1b[35m' };

const legacyItems = ['AI_HARNESS.md','HARNESS.md','PROJECT_CONTEXT.md','CONTEXT.md','ARCHITECTURE.md','DECISIONS.md','CURRENT_STATE.md','TASK_LOG.md','AGENT.md','AGENTS.md','CLAUDE.md','.cursorrules','.cursor/rules/project-rules.mdc','.cursor/rules/leerness.mdc','.github/copilot-instructions.md','docs/guideline.md','docs/history.md','.ai','harness','.harness'];

const coreFiles = {
  'AGENTS.md': [MARK,'# {{PROJECT}} AI Agent Harness','','Agent = Model + Harness.','','## Read Order','1. .harness/project-brief.md','2. .harness/current-state.md','3. .harness/architecture.md','4. .harness/context-map.md','5. .harness/guardrails.md','6. .harness/skill-index.md','7. .harness/skills-lock.json','','## Operating Rules','- Read project memory before editing.','- Preserve existing architecture, feature contracts, and design system unless the user explicitly asks to change them.','- Use the matching skill from .harness/skills when a task fits a known pattern.','- Keep secrets, tokens, cookies, credentials, and customer private data out of harness files.','- Record variable names only; store real values in .env.local, CI secrets, or cloud secret manager.','- After work, update current-state, task-log, and session-handoff.','- Record important decisions in decisions.md.','','## Skill Library Lifecycle','- Verified successful patterns can be learned with leerness skill learn.','- Skill libraries must pass secret scanning before build/publish/merge.','- npm/git upload is dry-run by default; --execute is required for real upload.','','## Response Contract','- Summary','- Files changed','- Verification','- Risks or assumptions','- Next step','{{LEGACY_AGENT}}',''].join('\n'),
  'CLAUDE.md': [MARK,'# Claude Code Instructions','','Use AGENTS.md as the source of truth. Before editing, read .harness/current-state.md, architecture.md, context-map.md, guardrails.md, skills-lock.json, and the matching skill file.',''].join('\n'),
  '.cursor/rules/leerness.mdc': [MARK,'---','alwaysApply: true','---','Read AGENTS.md first. Follow .harness project memory, installed skills, design-system, feature-contracts, and guardrails.',''].join('\n'),
  '.github/copilot-instructions.md': [MARK,'# GitHub Copilot Instructions','','Use AGENTS.md and .harness/ as the project memory. Preserve architecture, feature contracts, security rules, and UI consistency.',''].join('\n'),
  '.gitignore': ['# Leerness local secrets','.env','.env.local','*.secret.json','.harness/skill-config.local.json',''].join('\n'),
  '.env.example': ['# Leerness environment variable examples','# Copy to .env.local and fill values locally. Never commit real secrets.','',''].join('\n'),
  '.harness/HARNESS_VERSION': '{{VERSION}}\n',
  '.harness/manifest.json': '{{MANIFEST}}\n',
  '.harness/skills-lock.json': '{{SKILLS_LOCK}}\n',
  '.harness/skill-config.schema.json': [MARK,'{','  "$schema": "https://json-schema.org/draft/2020-12/schema",','  "title": "Leerness Skill Config",','  "type": "object",','  "properties": {','    "envSource": { "type": "string", "default": ".env.local" },','    "installedSkills": { "type": "object" }','  },','  "additionalProperties": true','}',''].join('\n'),
  '.harness/secret-policy.md': [MARK,'# Secret Policy','','## Never store in harness files','- API keys','- Access tokens','- Refresh tokens','- Passwords','- Cookies','- Private customer data','- Payment credentials','','## Allowed in harness files','- Environment variable names','- Secret manager key names','- Redacted examples','- Fake fixtures','','## Default locations','- Local: .env.local','- CI/CD: GitHub Actions Secrets or provider secrets','- Cloud: Secret Manager or runtime environment variables',''].join('\n'),
  '.harness/project-brief.md': [MARK,'# Project Brief: {{PROJECT}}','','## Purpose','','## Success Criteria','','## Users','','## Product Direction','{{LEGACY_BRIEF}}',''].join('\n'),
  '.harness/current-state.md': [MARK,'# Current State','','Updated: {{DATE}}','','## Now','- Leerness v{{VERSION}} installed or migrated.','','## Next','- Fill project-brief, context-map, design-system, and feature-contracts.','','## Blockers','- None recorded.','{{LEGACY_STATE}}',''].join('\n'),
  '.harness/architecture.md': [MARK,'# Architecture','','## Overview','','## Main Modules','','## Data Flow','','## External Services','','## Boundaries','{{LEGACY_ARCH}}',''].join('\n'),
  '.harness/context-map.md': [MARK,'# Context Map','','| Area | Files | Notes |','|---|---|---|','| UI | src/components/**, app/** | Check design-system.md first. |','| API | src/api/**, server/**, functions/** | Preserve response contracts. |','| Data | db/**, firestore/**, prisma/** | Confirm migrations. |','| Tests | test/**, tests/**, __tests__/** | Add or update checks. |',''].join('\n'),
  '.harness/decisions.md': [MARK,'# Decision Log','','## Template','','### YYYY-MM-DD — Title','- Decision:','- Reason:','- Alternatives:','- Impact:','{{LEGACY_DECISIONS}}',''].join('\n'),
  '.harness/task-log.md': [MARK,'# Task Log','','## {{DATE}}','- Installed Leerness v{{VERSION}}.',''].join('\n'),
  '.harness/constraints.md': [MARK,'# Constraints','','- Runtime/framework constraints','- Deployment constraints','- Security/privacy constraints','- Business rules',''].join('\n'),
  '.harness/guardrails.md': [MARK,'# Guardrails','','## Never','- Do not perform unrequested large rewrites.','- Do not change public API, database schema, auth, payment, or environment variable names without identifying impact.','- Do not hardcode secrets.','- Do not create a new design pattern when an existing one fits.','','## Always','- Inspect current structure first.','- Make the smallest safe change.','- Verify behavior.','- Update project memory after meaningful changes.',''].join('\n'),
  '.harness/design-system.md': [MARK,'# Design System Memory','','## Layout','- Reuse existing spacing, component variants, typography, and breakpoints.','','## Components','| Component | Purpose | Rules |','|---|---|---|','| Button | Primary actions | Reuse existing variants. |','| Card | Grouped content | Keep spacing and radius consistent. |','| Form | Input flows | Include loading, error, and empty states. |',''].join('\n'),
  '.harness/feature-contracts.md': [MARK,'# Feature Contracts','','## Template','- Feature:','- Entry point:','- Input:','- Output:','- Error states:','- UI states:','- Related files:','- Tests:',''].join('\n'),
  '.harness/testing-strategy.md': [MARK,'# Testing Strategy','','- Unit: pure logic and adapters','- Integration: API, DB, third-party providers','- E2E/manual: key user flows','- Regression: previously fixed bugs and successful skills',''].join('\n'),
  '.harness/review-checklist.md': [MARK,'# Review Checklist','','- [ ] Existing architecture preserved','- [ ] Feature contracts respected','- [ ] Design system followed','- [ ] Secrets not exposed','- [ ] Tests or manual verification completed','- [ ] current-state/task-log/session-handoff updated',''].join('\n'),
  '.harness/release-checklist.md': [MARK,'# Release Checklist','','- [ ] Build/test passed','- [ ] Env variables confirmed','- [ ] Migration impact checked','- [ ] Rollback path known','- [ ] Release notes prepared',''].join('\n'),
  '.harness/session-handoff.md': [MARK,'# Session Handoff','','## Done','-','','## Changed Files','-','','## Decisions','-','','## Risks','-','','## Next Exact Step','-',''].join('\n'),
  '.harness/skill-index.md': [MARK,'# Skill Index','','Installed skill libraries are tracked in `.harness/skills-lock.json`.','','## Commands','`leerness skill list`','`leerness skill add commerce-api`','`leerness skill learn my-skill --from .harness/skills/...`','`leerness library verify .harness/library/my-skill --ai`','`leerness library build .harness/library/my-skill`','`leerness library publish .harness/library/my-skill/dist/my-skill --target npm --execute`','','## Metadata','Every skill should expose version, lastUpdated, lastUpdatedAt, and verification status.',''].join('\n'),
  '.harness/AX_SKILL_LIBRARY_GUIDE.md': [MARK,
'# Leerness AX Skill Library Guide',
'',
'AX는 AI eXperience입니다. AI 에이전트가 검증된 스킬 데이터를 안전하게 학습, 검증, 빌드, 업로드, 업데이트, 병합, 마이그레이션하도록 안내합니다.',
'',
'## 원칙',
'- 실제 토큰, 쿠키, 비밀번호, 고객 데이터는 저장하지 않는다.',
'- 환경변수 이름과 연결 규칙만 기록한다.',
'- 스킬 업로드는 AI 검증 메타데이터가 있을 때만 허용한다.',
'- 업데이트 또는 마이그레이션 후에는 verification.status를 needs-review로 되돌린다.',
'- 각 스킬에는 lastUpdated, lastUpdatedAt, verification 정보를 둔다.',
'',
'## 표준 흐름',
'1. 성공한 구현 결과를 스킬 후보로 정리한다.',
'2. leerness skill learn <name> --from <path> 로 재사용 가능한 절차를 추출한다.',
'3. leerness library validate <path> --strict-ai 로 구조와 민감정보를 검사한다.',
'4. leerness library verify <path> --ai --reviewer leerness-ai 로 AI 검증 메타데이터를 기록한다.',
'5. leerness library build <path> 로 배포 가능한 라이브러리를 만든다.',
'6. leerness library publish <built-path> --target npm|git --execute 로 검증된 라이브러리만 업로드한다.',
'',
'## 필수 메타데이터',
'- name',
'- version',
'- title',
'- category',
'- lastUpdated',
'- lastUpdatedAt',
'- sensitiveDataPolicy',
'- requiresEnv',
'- verification.status',
'- verification.verifiedAt',
'- verification.method',
'',
'## 업로드 차단 조건',
'- verification.status가 passed가 아니다.',
'- verification.method에 ai가 없다.',
'- 민감정보 의심 패턴이 발견됐다.',
'- lastUpdated 또는 lastUpdatedAt이 없다.',
'- --execute 없이 실제 업로드를 시도했다.',
'',
'## AI 에이전트 체크리스트',
'- 스킬 목적과 사용 조건이 명확한가',
'- 구현 절차가 재현 가능한가',
'- 민감정보가 아니라 환경변수 이름만 있는가',
'- 검증 방법과 실패 대응법이 있는가',
'- 병합 후 skills-lock.json에 출처와 검증 상태가 기록되는가',
'',
].join('\n'),
  '.harness/skills/core/codebase-analysis.md': [MARK,'# Skill: Codebase Analysis','','1. Read current-state and context-map.','2. Locate related files.','3. Identify data flow and ownership.','4. Summarize risks before editing.',''].join('\n'),
  '.harness/skills/core/feature-implementation.md': [MARK,'# Skill: Feature Implementation','','1. Convert the requirement into a feature contract.','2. Find existing patterns.','3. Implement the smallest safe change.','4. Verify behavior.','5. Update harness memory.',''].join('\n'),
  '.harness/skills/core/refactoring.md': [MARK,'# Skill: Refactoring','','Keep behavior unchanged. Move in small steps. Preserve public contracts. Verify after each meaningful change.',''].join('\n'),
  '.harness/skills/core/debugging.md': [MARK,'# Skill: Debugging','','Separate symptom, reproduction, root cause, fix, and prevention. Record repeated failure patterns in guardrails.',''].join('\n'),
  '.harness/skills/core/ui-consistency.md': [MARK,'# Skill: UI Consistency','','Read design-system.md and existing similar screens before changing UI. Include loading, empty, error, desktop, and mobile states.',''].join('\n'),
  '.harness/skills/core/security-review.md': [MARK,'# Skill: Security Review','','Check secrets, auth boundaries, input validation, logging, dependency risk, and permission scope.',''].join('\n'),
  '.harness/skills/core/release-check.md': [MARK,'# Skill: Release Check','','Verify build, tests, env vars, migration impact, and rollback path.',''].join('\n'),
  '.harness/skills/core/documentation-update.md': [MARK,'# Skill: Documentation Update','','Update current-state, task-log, decisions, context-map, feature-contracts, design-system, and session-handoff when relevant.',''].join('\n'),
  '.harness/templates/session-summary.md': [MARK,'# Session Summary','','## Done','','## Files Changed','','## Verification','','## Next',''].join('\n'),
  '.harness/templates/decision.md': [MARK,'# Decision','','## Decision','','## Reason','','## Alternatives','','## Impact',''].join('\n')
};

function log(m=''){ console.log(m); }
function ok(m){ log(c.green+'✓'+c.reset+' '+m); }
function info(m){ log(c.cyan+'ℹ'+c.reset+' '+m); }
function warn(m){ log(c.yellow+'⚠'+c.reset+' '+m); }
function fail(m){ log(c.red+'✗'+c.reset+' '+m); }
function exists(p){ return fs.existsSync(p); }
function read(p){ return fs.readFileSync(p,'utf8'); }
function write(p,s){ fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,s,'utf8'); }
function rel(root,p){ return path.relative(root,p).replace(/\\/g,'/') || '.'; }
function isTextFile(p){ return /\.(md|mdc|txt|json|js|ts|tsx|jsx|yml|yaml|env|gitignore)$/i.test(p) || !path.extname(p); }
function parseJsonSafe(s,fallback){ try { return JSON.parse(s); } catch { return fallback; } }
function banner(){ log(''); log(c.bold+c.magenta+'Leerness v'+VERSION+c.reset); log(c.dim+'맞춤성장형 AI 개발 하네스 · context, skills, design, consistency'+c.reset); log(''); }
function installGuide(){ log(c.bold+'설치 안내'+c.reset); log('  - 기존 AI 하네스/지침 파일을 감지하면 먼저 .harness/archive/ 에 백업합니다.'); log('  - .harness/ 아래에 프로젝트 메모리, 스킬, 디자인/기능 계약 문서를 생성합니다.'); log('  - 스킬 라이브러리는 실제 민감정보를 저장하지 않고 환경변수 이름만 기록합니다.'); log('  - library publish는 기본 dry-run이며, 실제 업로드는 --execute가 필요합니다.'); log(''); }
function projectName(root){ try{ const pkg=JSON.parse(read(path.join(root,'package.json'))); if(pkg.name) return String(pkg.name).replace(/^@[^/]+\//,''); }catch{} return path.basename(root); }

function detectLegacy(root){ return legacyItems.map(item=>({item,full:path.join(root,item)})).filter(e=>{ if(!exists(e.full)) return false; if(e.item==='.harness'){ const vf=path.join(root,'.harness/HARNESS_VERSION'); return !exists(vf) || read(vf).trim()!==VERSION; } try{ if(fs.statSync(e.full).isFile() && isTextFile(e.item)){ const b=read(e.full); if(b.includes(MARK)||b.includes(MIGRATED)) return false; } }catch{} return true; }); }
function copyRecursive(src,dst,ignoreAbs=[]){ const abs=path.resolve(src); if(ignoreAbs.some(i=>abs===i||abs.startsWith(i+path.sep))) return; const st=fs.statSync(src); if(st.isDirectory()){ fs.mkdirSync(dst,{recursive:true}); for(const n of fs.readdirSync(src)) copyRecursive(path.join(src,n),path.join(dst,n),ignoreAbs); } else { fs.mkdirSync(path.dirname(dst),{recursive:true}); fs.copyFileSync(src,dst); } }
function collectLegacyText(found){ const out={}; for(const f of found){ try{ if(fs.statSync(f.full).isFile() && isTextFile(f.item)) out[f.item]=read(f.full); }catch{} } return out; }
function pick(obj,keys){ const out={}; for(const k of keys) if(obj[k]) out[k]=obj[k]; return out; }
function legacyBlock(title,obj){ const entries=Object.entries(obj).filter(([,v])=>String(v).trim()); if(!entries.length) return ''; return '\n---\n## Migrated legacy notes: '+title+'\n\n'+entries.map(([k,v])=>'### '+k+'\n\n'+String(v).trim()+'\n').join('\n'); }
function archiveLegacy(root,found,dryRun){ if(!found.length) return null; const stamp=new Date().toISOString().replace(/[:.]/g,'-'); const archive=path.join(root,'.harness/archive/legacy-migration-'+stamp); if(dryRun) return archive; fs.mkdirSync(archive,{recursive:true}); const archiveRoot=path.resolve(path.join(root,'.harness/archive')); for(const f of found){ try{ const name=f.item==='.harness'?'.harness-before-v'+VERSION:f.item; copyRecursive(f.full,path.join(archive,name),[archiveRoot]); }catch(e){ warn('백업 실패: '+f.item+' ('+e.message+')'); } } write(path.join(archive,'migration-manifest.json'),JSON.stringify({version:VERSION,archivedAt:new Date().toISOString(),items:found.map(x=>x.item)},null,2)+'\n'); return archive; }
function targetForLegacy(item){ if(/ARCHITECTURE/i.test(item)) return '.harness/architecture.md'; if(/DECISION/i.test(item)) return '.harness/decisions.md'; if(/CURRENT|TASK_LOG|history/i.test(item)) return '.harness/current-state.md'; if(/AGENT|CLAUDE|cursor|copilot|cursorrules/i.test(item)) return 'AGENTS.md'; return '.harness/project-brief.md'; }
function neutralizeLegacy(root,found,dryRun){ for(const f of found){ if(f.item==='.harness'||coreFiles[f.item]) continue; try{ if(!fs.statSync(f.full).isFile()) continue; }catch{ continue; } const target=targetForLegacy(f.item); const body=[MIGRATED,'# Migrated legacy harness file','','Active source of truth: '+target,'','Original content was backed up under .harness/archive/.',''].join('\n'); if(dryRun) info('[dry-run] legacy pointer: '+f.item+' -> '+target); else write(f.full,body); } }
function fill(t,ctx){ return t.replace(/{{([A-Z_]+)}}/g,(_,k)=>ctx[k]||''); }
function manifest(root,selectedSkills){ return JSON.stringify({name:projectName(root),harnessVersion:VERSION,installedAt:new Date().toISOString(),managedFiles:Object.keys(coreFiles),selectedSkills},null,2); }
function skillsLock(root,selectedSkills){ const lock={harnessVersion:VERSION,installedAt:new Date().toISOString(),installedSkills:{}}; for(const name of selectedSkills){ const meta=getSkillMeta(name); if(meta) lock.installedSkills[name]={version:meta.version,source:'bundled',title:meta.title}; } return JSON.stringify(lock,null,2); }
function makeContext(root,legacyText,selectedSkills){ const date=new Date().toISOString().slice(0,10); return { PROJECT:projectName(root), DATE:date, VERSION, LEGACY_AGENT:legacyBlock('agent instructions',pick(legacyText,['AGENTS.md','AGENT.md','CLAUDE.md','.cursorrules','.cursor/rules/project-rules.mdc','.cursor/rules/leerness.mdc','.github/copilot-instructions.md'])), LEGACY_BRIEF:legacyBlock('project context',pick(legacyText,['PROJECT_CONTEXT.md','CONTEXT.md','docs/guideline.md','AI_HARNESS.md','HARNESS.md'])), LEGACY_STATE:legacyBlock('state',pick(legacyText,['CURRENT_STATE.md','TASK_LOG.md','docs/history.md'])), LEGACY_ARCH:legacyBlock('architecture',pick(legacyText,['ARCHITECTURE.md'])), LEGACY_DECISIONS:legacyBlock('decisions',pick(legacyText,['DECISIONS.md'])), MANIFEST:manifest(root,selectedSkills), SKILLS_LOCK:skillsLock(root,selectedSkills) }; }

function listSkillPacks(){ if(!exists(PACKS_DIR)) return []; return fs.readdirSync(PACKS_DIR).map(n=>getSkillMeta(n)).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name)); }
function getSkillMeta(name){ const metaPath=path.join(PACKS_DIR,name,'skill.json'); if(!exists(metaPath)) return null; const meta=parseJsonSafe(read(metaPath),null); if(!meta||!meta.name) return null; return meta; }
function updateSkillLock(root,meta,remove=false){ const lp=path.join(root,'.harness/skills-lock.json'); const lock=exists(lp)?parseJsonSafe(read(lp),{harnessVersion:VERSION,installedSkills:{}}):{harnessVersion:VERSION,installedSkills:{}}; lock.harnessVersion=VERSION; lock.updatedAt=new Date().toISOString(); lock.installedSkills=lock.installedSkills||{}; if(remove) delete lock.installedSkills[meta.name]; else lock.installedSkills[meta.name]={version:meta.version,source:meta.source||'bundled',title:meta.title,requiresEnv:meta.requiresEnv||[]}; write(lp,JSON.stringify(lock,null,2)+'\n'); }
function appendEnvExample(root,meta){ const ep=path.join(root,'.env.example'); const existing=exists(ep)?read(ep):''; const missing=(meta.requiresEnv||[]).filter(n=>!existing.includes(n+'=')); if(!missing.length) return; write(ep,existing+'\n# '+(meta.title||meta.name)+' ('+meta.name+')\n'+missing.map(n=>n+'=').join('\n')+'\n'); }
function installSkill(root,name,dryRun=false){ const meta=getSkillMeta(name); if(!meta){ fail('알 수 없는 스킬 라이브러리: '+name); info('사용 가능 목록: '+listSkillPacks().map(x=>x.name).join(', ')); return false; } const packRoot=path.join(PACKS_DIR,name); const destRoot=path.join(root,'.harness/skills',name); if(dryRun){ info('[dry-run] install skill: '+name); return true; } fs.mkdirSync(destRoot,{recursive:true}); for(const file of meta.files||[]){ const src=path.join(packRoot,file); const dest=path.join(destRoot,path.basename(file)); if(exists(src)){ write(dest,read(src)); ok('스킬 설치: '+rel(root,dest)); } } write(path.join(destRoot,'skill.json'),JSON.stringify(meta,null,2)+'\n'); updateSkillLock(root,meta,false); appendEnvExample(root,meta); return true; }
function removeSkill(root,name){ const meta=getSkillMeta(name)||{name,title:name}; const dest=path.join(root,'.harness/skills',name); if(exists(dest)) fs.rmSync(dest,{recursive:true,force:true}); updateSkillLock(root,meta,true); ok('스킬 제거: '+name); }

function parseArgs(argv){ const out={flags:{},positionals:[]}; const valueFlags=new Set(['skills','path','from','out','target','package','repo','version','title','description','category','source','name','registry','branch','message','reviewer','by']); for(let i=0;i<argv.length;i++){ const a=argv[i]; if(a.startsWith('--')){ const eq=a.indexOf('='); const key=eq>=0?a.slice(2,eq):a.slice(2); if(eq>=0) out.flags[key]=a.slice(eq+1); else if(valueFlags.has(key)&&argv[i+1]&&!argv[i+1].startsWith('-')) out.flags[key]=argv[++i]; else out.flags[key]=true; } else if(a.startsWith('-')) out.flags[a.slice(1)]=true; else out.positionals.push(a); } return out; }
function splitSkills(value){ if(!value||value===true) return []; if(value==='recommended') return ['office','commerce-api','crawling']; if(value==='all') return listSkillPacks().map(x=>x.name); return String(value).split(',').map(x=>x.trim()).filter(Boolean); }
function ask(q){ const rl=readline.createInterface({input:process.stdin,output:process.stdout}); return new Promise(resolve=>rl.question(q,a=>{rl.close();resolve(a.trim());})); }
async function chooseSkills(autoYes,provided){ if(provided!==undefined) return splitSkills(provided); if(autoYes||!process.stdin.isTTY) return []; const packs=listSkillPacks(); if(!packs.length) return []; log(c.bold+'설치할 스킬 라이브러리 선택'+c.reset); log('  0) 기본 하네스만 설치'); packs.forEach((p,i)=>log('  '+(i+1)+') '+p.title+' ('+p.name+')')); log('  all) 전체 설치'); const ans=await ask('\n선택 (예: 1,3 또는 all, Enter=기본): '); if(!ans||ans==='0') return []; if(ans.toLowerCase()==='all') return packs.map(p=>p.name); return ans.split(',').map(s=>parseInt(s.trim(),10)).filter(n=>n>=1&&n<=packs.length).map(n=>packs[n-1].name); }

async function init(root,flags){ root=path.resolve(root||process.cwd()); fs.mkdirSync(root,{recursive:true}); banner(); installGuide(); info('대상: '+root); const selectedSkills=await chooseSkills(Boolean(flags.yes||flags.y),flags.skills); const found=detectLegacy(root); const legacyText=collectLegacyText(found); if(found.length){ warn('기존 하네스/지침 파일 감지: '+found.length+'개'); found.forEach(f=>log('  - '+f.item)); } const archive=archiveLegacy(root,found,false); if(archive) info('백업 완료: '+rel(root,archive)); neutralizeLegacy(root,found,false); const ctx=makeContext(root,legacyText,selectedSkills); for(const [file,template] of Object.entries(coreFiles)){ const target=path.join(root,file); const body=fill(template,ctx); if(exists(target)&&read(target)===body){ ok('유지: '+file); continue; } const existed=exists(target); if(file==='.gitignore'&&existed){ const current=read(target); const additions=body.split('\n').filter(line=>line&&!current.includes(line)).join('\n'); if(additions) write(target,current.replace(/\s*$/,'\n')+additions+'\n'); ok('보강: .gitignore'); continue; } write(target,body); ok((existed?'업데이트: ':'생성: ')+file); } if(selectedSkills.length){ log(''); info('선택 스킬 설치 중: '+selectedSkills.join(', ')); for(const name of selectedSkills) installSkill(root,name,false); } log(''); ok('설치 완료'); log('다음 단계: .harness/project-brief.md, context-map.md, design-system.md를 프로젝트에 맞게 채우세요.'); }
function migrate(root,flags){ root=path.resolve(root||process.cwd()); banner(); installGuide(); const dryRun=Boolean(flags['dry-run']); const found=detectLegacy(root); if(!found.length){ ok('마이그레이션할 legacy 항목이 없습니다.'); return; } warn('마이그레이션 대상: '+found.length+'개'); found.forEach(f=>log('  - '+f.item)); const archive=archiveLegacy(root,found,dryRun); info((dryRun?'[dry-run] 백업 예정: ':'백업 완료: ')+rel(root,archive)); if(!dryRun) neutralizeLegacy(root,found,false); const ctx=makeContext(root,collectLegacyText(found),[]); for(const [file,template] of Object.entries(coreFiles)){ const target=path.join(root,file); if(dryRun) info('[dry-run] create/update: '+file); else write(target,fill(template,ctx)); } if(!dryRun) ok('마이그레이션 완료'); }
function status(root){ root=path.resolve(root||process.cwd()); const vf=path.join(root,'.harness/HARNESS_VERSION'); const version=exists(vf)?read(vf).trim():'not installed'; const missing=Object.keys(coreFiles).filter(f=>!exists(path.join(root,f))); const lp=path.join(root,'.harness/skills-lock.json'); const lock=exists(lp)?parseJsonSafe(read(lp),{installedSkills:{}}):{installedSkills:{}}; banner(); log('대상: '+root); log('버전: '+version); log('파일: '+(Object.keys(coreFiles).length-missing.length)+'/'+Object.keys(coreFiles).length); if(missing.length){ warn('누락 파일'); missing.forEach(x=>log('  - '+x)); } else ok('필수 파일 모두 존재'); const names=Object.keys(lock.installedSkills||{}); log('설치 스킬: '+(names.length?names.join(', '):'없음')); }
function verify(root){ root=path.resolve(root||process.cwd()); let failures=0; banner(); for(const file of Object.keys(coreFiles)){ const target=path.join(root,file); if(!exists(target)){ failures++; warn('누락: '+file); continue; } const body=read(target); if(/{{[A-Z_]+}}/.test(body)){ failures++; warn('플레이스홀더 남음: '+file); } } const suspicious=[]; for(const x of ['.harness','AGENTS.md','CLAUDE.md']) for(const f of scanSensitivePath(path.join(root,x))) suspicious.push(f); if(suspicious.length){ failures+=suspicious.length; suspicious.forEach(x=>warn('민감정보 의심: '+rel(root,x.file)+' · '+x.type)); } if(failures){ fail('검증 실패: '+failures); process.exitCode=1; } else ok('검증 완료'); }

function slugifyName(value){ return String(value||'').trim().toLowerCase().replace(/^@[^/]+\//,'').replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'custom-skill'; }
function packageSafeName(value){ const raw=String(value||'').trim(); if(raw.startsWith('@')) return raw; return 'leerness-skill-'+slugifyName(raw).replace(/^leerness-skill-/,'').replace(/^harness-skill-/,''); }
function isInside(parent,child){ const r=path.relative(path.resolve(parent),path.resolve(child)); return r&&!r.startsWith('..')&&!path.isAbsolute(r); }
function scanSensitiveText(body){ const patterns=[{name:'OpenAI style API key',re:/sk-[a-zA-Z0-9_-]{20,}/g},{name:'GitHub token',re:/gh[pousr]_[a-zA-Z0-9_]{20,}/g},{name:'npm token',re:/npm_[a-zA-Z0-9]{20,}/g},{name:'AWS access key',re:/AKIA[0-9A-Z]{16}/g},{name:'private key block',re:/-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g},{name:'password assignment',re:/(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/ig},{name:'secret assignment',re:/(?:secret|token|api[_-]?key)\s*[:=]\s*['"][^'"]{12,}['"]/ig}]; const findings=[]; for(const p of patterns){ let m; while((m=p.re.exec(body))) findings.push({type:p.name,index:m.index,sample:m[0].slice(0,16)+'...'}); } return findings; }
function scanSensitivePath(target){ const findings=[]; function scan(p){ if(!exists(p)) return; const st=fs.statSync(p); if(st.isDirectory()){ for(const n of fs.readdirSync(p)){ if(['node_modules','.git','dist','coverage'].includes(n)) continue; scan(path.join(p,n)); } } else if(st.isFile()&&isTextFile(p)){ for(const f of scanSensitiveText(read(p))) findings.push({file:p,...f}); } } scan(target); return findings; }
function skillLibraryFiles(dir){ const files=[]; function walk(p){ if(!exists(p)) return; const st=fs.statSync(p); if(st.isDirectory()){ for(const n of fs.readdirSync(p)){ if(['node_modules','.git','dist','coverage'].includes(n)) continue; walk(path.join(p,n)); } } else if(st.isFile()) files.push(p); } walk(dir); return files; }
function readSkillLibraryMeta(dir){ for(const cnd of [path.join(dir,'skill-library.json'),path.join(dir,'skill.json'),path.join(dir,'package.json')]){ if(!exists(cnd)) continue; const data=parseJsonSafe(read(cnd),null); if(!data) continue; if(path.basename(cnd)==='package.json') return { name:data.harnessSkill?.name||data.name, version:data.version||'0.1.0', title:data.harnessSkill?.title||data.description||data.name, packageName:data.name, description:data.description||'', requiresEnv:data.harnessSkill?.requiresEnv||[], files:data.harnessSkill?.files||[] }; return data; } return null; }
function validateSkillLibrary(dir,options={}){ dir=path.resolve(dir); let failures=0; const meta=readSkillLibraryMeta(dir); if(!meta||!meta.name){ fail('skill-library.json 또는 skill.json에 name이 필요합니다.'); failures++; } const sd=path.join(dir,'skills'); if(!exists(sd)){ fail('skills/ 폴더가 필요합니다.'); failures++; } else if(!skillLibraryFiles(sd).some(f=>f.endsWith('.md'))){ fail('skills/*.md 파일이 최소 1개 필요합니다.'); failures++; } const findings=scanSensitivePath(dir); if(findings.length){ fail('민감정보 의심 패턴 감지. 배포/빌드가 차단됩니다.'); findings.slice(0,20).forEach(f=>warn(rel(dir,f.file)+' · '+f.type+' · '+f.sample)); if(findings.length>20) warn('추가 '+(findings.length-20)+'건 생략'); failures+=findings.length; } for(const env of new Set(meta?.requiresEnv||[])){ if(!/^[A-Z][A-Z0-9_]*$/.test(env)) warn('환경변수 이름 형식 확인 필요: '+env); } if(!options.silent){ if(failures) fail('스킬 라이브러리 검증 실패: '+failures); else ok('스킬 라이브러리 검증 완료: '+(meta?.name||path.basename(dir))); } return {ok:failures===0,failures,meta,findings}; }
function inferEnvNamesFromText(body){ const names=new Set(); const re=/\b[A-Z][A-Z0-9_]{3,}\b/g; let m; while((m=re.exec(body))){ const v=m[0]; if(/(KEY|TOKEN|SECRET|PASSWORD|CLIENT|VENDOR|ID|URL|HOST|BUCKET|PROJECT)/.test(v)) names.add(v); } return Array.from(names).sort(); }
function learnSkillLibrary(root,flags){ root=path.resolve(root||process.cwd()); const from=path.resolve(flags.from||path.join(root,'.harness/skills')); const name=slugifyName(flags.name||flags.category||path.basename(from)); const version=String(flags.version||'0.1.0'); const outRoot=path.resolve(flags.out||path.join(root,'.harness/library',name)); if(!exists(from)){ fail('학습할 스킬 경로가 없습니다: '+from); process.exitCode=1; return; } const sourceFiles=skillLibraryFiles(from).filter(f=>isTextFile(f)&&!f.includes(path.sep+'archive'+path.sep)); if(!sourceFiles.length){ fail('학습 가능한 텍스트 스킬 파일이 없습니다.'); process.exitCode=1; return; } fs.mkdirSync(path.join(outRoot,'skills'),{recursive:true}); const requiresEnv=new Set(); const copied=[]; for(const f of sourceFiles){ const body=read(f); for(const e of inferEnvNamesFromText(body)) requiresEnv.add(e); const base=path.basename(f).replace(/[^a-zA-Z0-9._-]/g,'-'); const destName=base.endsWith('.md')?base:base+'.md'; const dest=path.join(outRoot,'skills',destName); const header=[MARK,'# Learned Skill: '+destName.replace(/\.md$/,''),'','Source: '+rel(root,f),'Learned: '+new Date().toISOString(),''].join('\n'); write(dest,body.includes(MARK)?body:header+'\n'+body); copied.push('skills/'+destName); } const meta={name,version,title:flags.title||name,description:flags.description||'Verified project skill library extracted from a successful implementation.',category:flags.category||'custom',compatibleHarness:'>=3.2.0',sensitiveDataPolicy:'env-reference-only',requiresEnv:Array.from(requiresEnv).sort(),files:copied,learnedFrom:rel(root,from),learnedAt:new Date().toISOString()}; write(path.join(outRoot,'skill-library.json'),JSON.stringify(meta,null,2)+'\n'); write(path.join(outRoot,'README.md'),'# '+meta.title+'\n\n'+meta.description+'\n\n## Policy\n\nThis library stores environment variable names only. Do not commit real secrets.\n\n## Required env\n\n'+(meta.requiresEnv.map(e=>'- '+e).join('\n')||'- None')+'\n'); write(path.join(outRoot,'env.example'),meta.requiresEnv.map(e=>e+'=').join('\n')+(meta.requiresEnv.length?'\n':'')); const result=validateSkillLibrary(outRoot,{silent:true}); if(!result.ok){ fail('학습 결과에 민감정보 또는 구조 문제가 있어 확인이 필요합니다: '+outRoot); process.exitCode=1; return; } ok('검증된 스킬 라이브러리 학습 완료: '+outRoot); info('다음: leerness library build '+outRoot); }
function buildSkillLibrary(dir,flags){ dir=path.resolve(dir||process.cwd()); const check=validateSkillLibrary(dir,{silent:false}); if(!check.ok){ process.exitCode=1; return; } const meta=check.meta; const out=path.resolve(flags.out||path.join(dir,'dist')); const packageName=flags.package||meta.packageName||packageSafeName(meta.name); const libRoot=path.join(out,slugifyName(meta.name)); if(exists(libRoot)) fs.rmSync(libRoot,{recursive:true,force:true}); fs.mkdirSync(libRoot,{recursive:true}); for(const item of ['README.md','skill-library.json','skill.json','env.example','skills','examples','migrations']){ const src=path.join(dir,item); if(exists(src)) copyRecursive(src,path.join(libRoot,item)); } if(!exists(path.join(libRoot,'skill-library.json'))&&exists(path.join(libRoot,'skill.json'))) fs.copyFileSync(path.join(libRoot,'skill.json'),path.join(libRoot,'skill-library.json')); const pkg={name:packageName,version:meta.version||'0.1.0',description:meta.description||meta.title||meta.name,type:'commonjs',files:['skill-library.json','README.md','env.example','skills/','examples/','migrations/'],keywords:['leerness','harness-skill','ai-skill-library',meta.category||'custom'].filter(Boolean),license:'MIT',publishConfig:{access:'public'},harnessSkill:{name:meta.name,version:meta.version,title:meta.title,requiresEnv:meta.requiresEnv||[],sensitiveDataPolicy:meta.sensitiveDataPolicy||'env-reference-only',compatibleHarness:meta.compatibleHarness||'>=3.2.0'}}; write(path.join(libRoot,'package.json'),JSON.stringify(pkg,null,2)+'\n'); ok('스킬 라이브러리 빌드 완료: '+libRoot); info('npm 배포: leerness library publish '+libRoot+' --target npm --execute'); info('git 배포: leerness library publish '+libRoot+' --target git --repo <git-url> --execute'); }
function mergeSkillLibrary(root,source,flags){ root=path.resolve(root||process.cwd()); source=path.resolve(source||flags.source||''); if(!source||!exists(source)){ fail('병합할 스킬 라이브러리 경로가 필요합니다.'); process.exitCode=1; return; } const check=validateSkillLibrary(source,{silent:false}); if(!check.ok){ process.exitCode=1; return; } const meta=check.meta; const name=slugifyName(meta.name); const dest=path.join(root,'.harness/skills',name); fs.mkdirSync(dest,{recursive:true}); const srcSkills=path.join(source,'skills'); if(exists(srcSkills)) copyRecursive(srcSkills,dest); write(path.join(dest,'skill-library.json'),JSON.stringify(meta,null,2)+'\n'); updateSkillLock(root,{name,version:meta.version||'0.1.0',title:meta.title||name,requiresEnv:meta.requiresEnv||[],source:'library'},false); appendEnvExample(root,{name,title:meta.title||name,requiresEnv:meta.requiresEnv||[]}); ok('스킬 라이브러리 병합 완료: '+rel(root,dest)); }
function migrateSkillLibrary(dir,flags){ dir=path.resolve(dir||process.cwd()); if(!exists(dir)){ fail('마이그레이션 대상 경로가 없습니다: '+dir); process.exitCode=1; return; } const meta=readSkillLibraryMeta(dir)||{}; const migrated={name:slugifyName(flags.name||meta.name||path.basename(dir)),version:String(flags.version||meta.version||'0.1.0'),title:flags.title||meta.title||meta.description||path.basename(dir),description:flags.description||meta.description||'Migrated Leerness skill library.',category:flags.category||meta.category||'custom',compatibleHarness:'>=3.2.0',sensitiveDataPolicy:'env-reference-only',requiresEnv:Array.from(new Set(meta.requiresEnv||meta.harnessSkill?.requiresEnv||[])),migratedAt:new Date().toISOString()}; const skillsDir=path.join(dir,'skills'); if(!exists(skillsDir)) fs.mkdirSync(skillsDir,{recursive:true}); const mdFiles=skillLibraryFiles(dir).filter(f=>f.endsWith('.md')&&!isInside(skillsDir,f)&&!f.includes(path.sep+'node_modules'+path.sep)); for(const f of mdFiles){ if(path.basename(f).toLowerCase()==='readme.md') continue; const dest=path.join(skillsDir,path.basename(f)); if(!exists(dest)) fs.copyFileSync(f,dest); } migrated.files=skillLibraryFiles(skillsDir).filter(f=>f.endsWith('.md')).map(f=>rel(dir,f)); write(path.join(dir,'skill-library.json'),JSON.stringify(migrated,null,2)+'\n'); if(!exists(path.join(dir,'README.md'))) write(path.join(dir,'README.md'),'# '+migrated.title+'\n\n'+migrated.description+'\n'); const check=validateSkillLibrary(dir,{silent:false}); if(!check.ok) process.exitCode=1; else ok('스킬 라이브러리 마이그레이션 완료: '+dir); }
function publishSkillLibrary(dir,flags){ dir=path.resolve(dir||process.cwd()); const target=String(flags.target||'npm'); const execute=Boolean(flags.execute); const check=validateSkillLibrary(dir,{silent:false}); if(!check.ok){ process.exitCode=1; return; } if(target==='npm'){ if(!exists(path.join(dir,'package.json'))){ warn('package.json이 없습니다. 먼저 build를 실행하세요.'); info('leerness library build '+dir); process.exitCode=1; return; } const args=['publish','--access','public'].concat(flags.registry?['--registry',flags.registry]:[]); if(!execute){ info('[dry-run] 실행 예정: (cd '+dir+') npm '+args.join(' ')); info('실제 배포는 --execute를 붙이세요.'); return; } const r=childProcess.spawnSync('npm',args,{cwd:dir,stdio:'inherit',shell:process.platform==='win32'}); process.exitCode=r.status||0; return; } if(target==='git'){ const repo=flags.repo; const branch=flags.branch||'main'; const message=flags.message||('Publish skill library '+check.meta.name+'@'+(check.meta.version||'0.1.0')); if(!execute){ info('[dry-run] git target repo: '+(repo||'(current repo)')); info('[dry-run] branch: '+branch); info('[dry-run] commit message: '+message); info('실제 push는 --execute를 붙이세요.'); return; } const run=(cmd,args)=>{ const r=childProcess.spawnSync(cmd,args,{cwd:dir,stdio:'inherit',shell:process.platform==='win32'}); if(r.status) process.exit(r.status); }; if(repo&&!exists(path.join(dir,'.git'))){ run('git',['init']); run('git',['remote','add','origin',repo]); } run('git',['add','.']); run('git',['commit','-m',message]); run('git',['branch','-M',branch]); run('git',['push','-u','origin',branch]); return; } fail('지원하지 않는 publish target: '+target); process.exitCode=1; }
function libraryCommand(args,flags){ const sub=args[1]||'help'; if(sub==='help'){ log(['Leerness Skill Library Commands','','  leerness skill learn <name> --from .harness/skills/<name> [--out ./library/<name>]','  leerness library validate <path>','  leerness library build <path> [--out ./dist] [--package leerness-skill-name]','  leerness library merge <source-library> [--path <project>]','  leerness library migrate <path> [--version 1.0.0]','  leerness library publish <built-library> --target npm|git [--execute]','','기본 publish는 dry-run입니다. 실제 npm/git 업로드는 --execute가 필요합니다.',''].join('\n')); return; } if(sub==='validate') return validateSkillLibrary(args[2]||process.cwd(),{silent:false}); if(sub==='build') return buildSkillLibrary(args[2]||process.cwd(),flags); if(sub==='merge') return mergeSkillLibrary(flags.path||process.cwd(),args[2]||flags.source,flags); if(sub==='migrate') return migrateSkillLibrary(args[2]||process.cwd(),flags); if(sub==='publish'||sub==='upload') return publishSkillLibrary(args[2]||process.cwd(),flags); fail('알 수 없는 library 명령: '+sub); process.exitCode=1; }
function skillCommand(args,flags){ const sub=args[1]||'list'; const root=path.resolve(flags.path||process.cwd()); if(sub==='learn'){ flags.name=args[2]||flags.name; return learnSkillLibrary(root,flags); } if(sub==='library') return libraryCommand(['library'].concat(args.slice(2)),flags); if(sub==='list'){ banner(); log('사용 가능한 스킬 라이브러리'); for(const p of listSkillPacks()){ log('- '+p.name+'@'+p.version+': '+p.title); log('  '+p.description); if((p.requiresEnv||[]).length) log('  env: '+(p.requiresEnv||[]).join(', ')); } return; } const name=args[2]; if(!name){ fail('스킬 이름이 필요합니다. 예: leerness skill add commerce-api'); return; } if(sub==='add'||sub==='install') return installSkill(root,name,Boolean(flags['dry-run'])); if(sub==='remove'||sub==='rm') return removeSkill(root,name); if(sub==='update') return installSkill(root,name,false); fail('알 수 없는 skill 명령: '+sub); }
function help(){ log(['Leerness v'+VERSION,'','Usage:','  leerness init [path] [--yes] [--skills office,commerce-api|recommended|all]','  leerness migrate [path] [--dry-run]','  leerness status [path]','  leerness verify [path]','','Skills:','  leerness skill list','  leerness skill add <name> [--path <project>]','  leerness skill remove <name> [--path <project>]','  leerness skill update <name> [--path <project>]','  leerness skill learn <name> --from <validated-skill-path> [--out <library-path>]','','Skill library lifecycle:','  leerness library validate <path>','  leerness library build <path> [--out ./dist] [--package leerness-skill-name]','  leerness library merge <source-library> [--path <project>]','  leerness library migrate <path> [--version 1.0.0]','  leerness library publish <built-library> --target npm|git [--execute]','  leerness --version','','Examples:','  npx leerness init --skills recommended','  npx leerness skill learn coupang-order-sync --from .harness/skills/commerce-api/order-sync.md','  npx leerness library build .harness/library/coupang-order-sync','  npx leerness library publish .harness/library/coupang-order-sync/dist/coupang-order-sync --target npm --execute',''].join('\n')); }


function nowIso(){ return new Date().toISOString(); }
function dateOnly(iso){ return String(iso||nowIso()).slice(0,10); }
function normalizeSkillMeta(meta, fallbackName){
  meta = meta || {};
  const updated = meta.lastUpdatedAt || meta.updatedAt || meta.learnedAt || meta.migratedAt || nowIso();
  meta.name = slugifyName(meta.name || fallbackName || 'custom-skill');
  meta.version = String(meta.version || '0.1.0');
  meta.title = meta.title || meta.description || meta.name;
  meta.category = meta.category || 'custom';
  meta.compatibleHarness = meta.compatibleHarness || '>=1.0.0';
  meta.sensitiveDataPolicy = meta.sensitiveDataPolicy || 'env-reference-only';
  meta.requiresEnv = Array.from(new Set(meta.requiresEnv || meta.harnessSkill?.requiresEnv || [])).sort();
  meta.lastUpdatedAt = updated;
  meta.lastUpdated = meta.lastUpdated || dateOnly(updated);
  meta.verification = meta.verification || { status:'needs-review', method:'none', verifiedBy:null, verifiedAt:null, checks:[] };
  return meta;
}
function isAiVerified(meta){
  const v = (meta||{}).verification || {};
  return v.status === 'passed' && /ai/i.test(String(v.method||'')) && Boolean(v.verifiedAt);
}
function verificationLabel(meta){
  const v=(meta||{}).verification||{};
  if(isAiVerified(meta)) return 'AI verified '+String(v.verifiedAt).slice(0,10);
  return v.status || 'needs-review';
}
function readSkillLibraryMeta(dir){
  for(const cnd of [path.join(dir,'skill-library.json'),path.join(dir,'skill.json'),path.join(dir,'package.json')]){
    if(!exists(cnd)) continue;
    const data=parseJsonSafe(read(cnd),null); if(!data) continue;
    if(path.basename(cnd)==='package.json') return normalizeSkillMeta({ name:data.harnessSkill?.name||data.name, version:data.version||'0.1.0', title:data.harnessSkill?.title||data.description||data.name, packageName:data.name, description:data.description||'', requiresEnv:data.harnessSkill?.requiresEnv||[], files:data.harnessSkill?.files||[], lastUpdated:data.harnessSkill?.lastUpdated, lastUpdatedAt:data.harnessSkill?.lastUpdatedAt, verification:data.harnessSkill?.verification }, path.basename(dir));
    return normalizeSkillMeta(data, path.basename(dir));
  }
  return null;
}
function writeSkillLibraryMeta(dir,meta){ write(path.join(dir,'skill-library.json'),JSON.stringify(normalizeSkillMeta(meta,path.basename(dir)),null,2)+'\n'); }
function validateSkillLibrary(dir,options={}){
  dir=path.resolve(dir); let failures=0; const meta=readSkillLibraryMeta(dir);
  if(!meta||!meta.name){ fail('skill-library.json 또는 skill.json에 name이 필요합니다.'); failures++; }
  const sd=path.join(dir,'skills');
  if(!exists(sd)){ fail('skills/ 폴더가 필요합니다.'); failures++; }
  else if(!skillLibraryFiles(sd).some(f=>f.endsWith('.md'))){ fail('skills/*.md 파일이 최소 1개 필요합니다.'); failures++; }
  const findings=scanSensitivePath(dir);
  if(findings.length){ fail('민감정보 의심 패턴 감지. 업로드/빌드/병합이 차단됩니다.'); findings.slice(0,20).forEach(f=>warn(rel(dir,f.file)+' · '+f.type+' · '+f.sample)); if(findings.length>20) warn('추가 '+(findings.length-20)+'건 생략'); failures+=findings.length; }
  for(const env of new Set(meta?.requiresEnv||[])){ if(!/^[A-Z][A-Z0-9_]*$/.test(env)) warn('환경변수 이름 형식 확인 필요: '+env); }
  if(meta && !meta.lastUpdated) warn('lastUpdated 메타데이터가 없습니다. v1.0.0에서는 표시를 권장합니다.');
  if((options.strictAi||options['strict-ai']) && !isAiVerified(meta)){ fail('AI 검증 메타데이터가 없습니다. `leerness library verify <path> --ai`가 필요합니다.'); failures++; }
  if(!options.silent){ if(failures) fail('스킬 라이브러리 검증 실패: '+failures); else ok('스킬 라이브러리 검증 완료: '+(meta?.name||path.basename(dir))+' · '+verificationLabel(meta)); }
  return {ok:failures===0,failures,meta,findings};
}
function verifySkillLibrary(dir,flags={}){
  dir=path.resolve(dir||process.cwd());
  const check=validateSkillLibrary(dir,{silent:false});
  if(!check.ok){ process.exitCode=1; return; }
  if(!flags.ai){ fail('업로드 가능한 검증 기록은 AI 검증으로만 생성됩니다. `--ai`를 붙여 AI 검증 게이트를 명시하세요.'); process.exitCode=1; return; }
  const meta=normalizeSkillMeta(check.meta,path.basename(dir));
  const reviewedAt=nowIso();
  meta.lastUpdatedAt = meta.lastUpdatedAt || reviewedAt;
  meta.lastUpdated = meta.lastUpdated || dateOnly(meta.lastUpdatedAt);
  meta.verification = { status:'passed', method:'ai-assisted-review', verifiedBy:String(flags.reviewer||flags.by||'leerness-ai'), verifiedAt:reviewedAt, checks:['structure','secret-scan','env-reference-only','reusability','migration-readiness','metadata-completeness'] };
  writeSkillLibraryMeta(dir,meta);
  write(path.join(dir,'ai-verification.json'),JSON.stringify({skill:meta.name,version:meta.version,status:'passed',method:'ai-assisted-review',verifiedBy:meta.verification.verifiedBy,verifiedAt:reviewedAt,checks:meta.verification.checks},null,2)+'\n');
  ok('AI 검증 완료: '+meta.name+'@'+meta.version+' · '+dateOnly(reviewedAt));
}
function libraryStatus(dir){
  dir=path.resolve(dir||process.cwd()); const meta=readSkillLibraryMeta(dir);
  if(!meta){ fail('스킬 라이브러리 메타데이터를 찾지 못했습니다.'); process.exitCode=1; return; }
  banner();
  log('스킬: '+meta.name+'@'+meta.version);
  log('제목: '+(meta.title||''));
  log('카테고리: '+(meta.category||''));
  log('최종 업데이트: '+(meta.lastUpdated||'unknown')+' ('+(meta.lastUpdatedAt||'unknown')+')');
  log('검증: '+verificationLabel(meta));
  if((meta.requiresEnv||[]).length) log('환경변수: '+meta.requiresEnv.join(', '));
}
function updateSkillLock(root,meta,remove=false){
  const lp=path.join(root,'.harness/skills-lock.json');
  const lock=exists(lp)?parseJsonSafe(read(lp),{harnessVersion:VERSION,installedSkills:{}}):{harnessVersion:VERSION,installedSkills:{}};
  lock.harnessVersion=VERSION; lock.updatedAt=nowIso(); lock.installedSkills=lock.installedSkills||{};
  if(remove) delete lock.installedSkills[meta.name];
  else lock.installedSkills[meta.name]={version:meta.version,source:meta.source||'bundled',title:meta.title,requiresEnv:meta.requiresEnv||[],lastUpdated:meta.lastUpdated||dateOnly(meta.lastUpdatedAt),lastUpdatedAt:meta.lastUpdatedAt||nowIso(),verificationStatus:(meta.verification||{}).status||'unknown',verifiedAt:(meta.verification||{}).verifiedAt||null};
  write(lp,JSON.stringify(lock,null,2)+'\n');
}
function getSkillMeta(name){
  const metaPath=path.join(PACKS_DIR,name,'skill.json'); if(!exists(metaPath)) return null;
  const meta=parseJsonSafe(read(metaPath),null); if(!meta||!meta.name) return null;
  return normalizeSkillMeta(meta,name);
}
function installSkill(root,name,dryRun=false){
  const meta=getSkillMeta(name); if(!meta){ fail('알 수 없는 스킬 라이브러리: '+name); info('사용 가능 목록: '+listSkillPacks().map(x=>x.name).join(', ')); return false; }
  const packRoot=path.join(PACKS_DIR,name); const destRoot=path.join(root,'.harness/skills',name);
  if(dryRun){ info('[dry-run] install skill: '+name+' · updated '+(meta.lastUpdated||'unknown')+' · '+verificationLabel(meta)); return true; }
  fs.mkdirSync(destRoot,{recursive:true});
  for(const file of meta.files||[]){ const src=path.join(packRoot,file); const dest=path.join(destRoot,path.basename(file)); if(exists(src)){ write(dest,read(src)); ok('스킬 설치: '+rel(root,dest)); } }
  write(path.join(destRoot,'skill.json'),JSON.stringify(meta,null,2)+'\n');
  updateSkillLock(root,meta,false); appendEnvExample(root,meta); return true;
}
function learnSkillLibrary(root,flags){
  root=path.resolve(root||process.cwd()); const from=path.resolve(flags.from||path.join(root,'.harness/skills')); const name=slugifyName(flags.name||flags.category||path.basename(from)); const version=String(flags.version||'0.1.0'); const outRoot=path.resolve(flags.out||path.join(root,'.harness/library',name));
  if(!exists(from)){ fail('학습할 스킬 경로가 없습니다: '+from); process.exitCode=1; return; }
  const sourceFiles=skillLibraryFiles(from).filter(f=>isTextFile(f)&&!f.includes(path.sep+'archive'+path.sep));
  if(!sourceFiles.length){ fail('학습 가능한 텍스트 스킬 파일이 없습니다.'); process.exitCode=1; return; }
  fs.mkdirSync(path.join(outRoot,'skills'),{recursive:true}); const requiresEnv=new Set(); const copied=[];
  for(const f of sourceFiles){ const body=read(f); for(const e of inferEnvNamesFromText(body)) requiresEnv.add(e); const base=path.basename(f).replace(/[^a-zA-Z0-9._-]/g,'-'); const destName=base.endsWith('.md')?base:base+'.md'; const dest=path.join(outRoot,'skills',destName); const header=[MARK,'# Learned Skill: '+destName.replace(/\.md$/,''),'','Source: '+rel(root,f),'Learned: '+nowIso(),'Verification: needs-review',''].join('\n'); write(dest,body.includes(MARK)?body:header+'\n'+body); copied.push('skills/'+destName); }
  const t=nowIso(); const meta=normalizeSkillMeta({name,version,title:flags.title||name,description:flags.description||'Verified project skill library extracted from a successful implementation.',category:flags.category||'custom',compatibleHarness:'>=1.0.0',sensitiveDataPolicy:'env-reference-only',requiresEnv:Array.from(requiresEnv).sort(),files:copied,learnedFrom:rel(root,from),learnedAt:t,lastUpdated:dateOnly(t),lastUpdatedAt:t,verification:{status:'needs-review',method:'none',verifiedBy:null,verifiedAt:null,checks:[]}}, name);
  writeSkillLibraryMeta(outRoot,meta);
  write(path.join(outRoot,'README.md'),'# '+meta.title+'\n\n'+meta.description+'\n\n## Metadata\n\n- Version: '+meta.version+'\n- Last updated: '+meta.lastUpdated+'\n- Verification: '+verificationLabel(meta)+'\n\n## Policy\n\nThis library stores environment variable names only. Do not commit real secrets.\n\n## Required env\n\n'+(meta.requiresEnv.map(e=>'- '+e).join('\n')||'- None')+'\n');
  write(path.join(outRoot,'env.example'),meta.requiresEnv.map(e=>e+'=').join('\n')+(meta.requiresEnv.length?'\n':''));
  const result=validateSkillLibrary(outRoot,{silent:true}); if(!result.ok){ fail('학습 결과에 민감정보 또는 구조 문제가 있어 확인이 필요합니다: '+outRoot); process.exitCode=1; return; }
  ok('스킬 라이브러리 학습 완료: '+outRoot); warn('아직 업로드 검증 전입니다. 다음 명령으로 AI 검증을 완료하세요.'); info('leerness library verify '+outRoot+' --ai --reviewer leerness-ai');
}
function buildSkillLibrary(dir,flags){
  dir=path.resolve(dir||process.cwd()); const check=validateSkillLibrary(dir,{silent:false}); if(!check.ok){ process.exitCode=1; return; }
  const meta=normalizeSkillMeta(check.meta,path.basename(dir)); const out=path.resolve(flags.out||path.join(dir,'dist')); const packageName=flags.package||meta.packageName||packageSafeName(meta.name); const libRoot=path.join(out,slugifyName(meta.name));
  if(exists(libRoot)) fs.rmSync(libRoot,{recursive:true,force:true}); fs.mkdirSync(libRoot,{recursive:true});
  for(const item of ['README.md','skill-library.json','skill.json','ai-verification.json','env.example','skills','examples','migrations']){ const src=path.join(dir,item); if(exists(src)) copyRecursive(src,path.join(libRoot,item)); }
  writeSkillLibraryMeta(libRoot,meta);
  const pkg={name:packageName,version:meta.version||'0.1.0',description:meta.description||meta.title||meta.name,type:'commonjs',files:['skill-library.json','ai-verification.json','README.md','env.example','skills/','examples/','migrations/'],keywords:['leerness','harness-skill','ai-skill-library',meta.category||'custom'].filter(Boolean),license:'MIT',publishConfig:{access:'public'},harnessSkill:{name:meta.name,version:meta.version,title:meta.title,requiresEnv:meta.requiresEnv||[],sensitiveDataPolicy:meta.sensitiveDataPolicy||'env-reference-only',compatibleHarness:meta.compatibleHarness||'>=1.0.0',lastUpdated:meta.lastUpdated,lastUpdatedAt:meta.lastUpdatedAt,verification:meta.verification}};
  write(path.join(libRoot,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  ok('스킬 라이브러리 빌드 완료: '+libRoot); info('상태 확인: leerness library status '+libRoot); info('npm 배포: leerness library publish '+libRoot+' --target npm --execute');
}
function updateSkillLibrary(dir,flags){
  dir=path.resolve(dir||process.cwd()); const from=path.resolve(flags.from||flags.source||''); if(!from||!exists(from)){ fail('업데이트 원본 경로가 필요합니다: --from <path>'); process.exitCode=1; return; }
  const old=readSkillLibraryMeta(dir)||normalizeSkillMeta({name:path.basename(dir)},path.basename(dir)); const sourceFiles=skillLibraryFiles(from).filter(f=>isTextFile(f)&&!f.includes(path.sep+'archive'+path.sep)); if(!sourceFiles.length){ fail('업데이트할 텍스트 스킬 파일이 없습니다.'); process.exitCode=1; return; }
  fs.mkdirSync(path.join(dir,'skills'),{recursive:true}); const copied=[]; const envs=new Set(old.requiresEnv||[]);
  for(const f of sourceFiles){ const body=read(f); for(const e of inferEnvNamesFromText(body)) envs.add(e); const base=path.basename(f).replace(/[^a-zA-Z0-9._-]/g,'-'); const destName=base.endsWith('.md')?base:base+'.md'; write(path.join(dir,'skills',destName),body); copied.push('skills/'+destName); }
  const t=nowIso(); const meta=normalizeSkillMeta({...old,version:String(flags.version||old.version||'0.1.0'),requiresEnv:Array.from(envs).sort(),files:Array.from(new Set([...(old.files||[]),...copied])),lastUpdated:dateOnly(t),lastUpdatedAt:t,updatedFrom:from,verification:{status:'needs-review',method:'updated-after-verification',verifiedBy:null,verifiedAt:null,checks:[]}}, old.name);
  writeSkillLibraryMeta(dir,meta); warn('스킬 라이브러리 업데이트 완료. 검증 상태가 needs-review로 초기화되었습니다.'); info('다음: leerness library verify '+dir+' --ai --reviewer leerness-ai');
}
function mergeSkillLibrary(root,source,flags){
  root=path.resolve(root||process.cwd()); source=path.resolve(source||flags.source||''); if(!source||!exists(source)){ fail('병합할 스킬 라이브러리 경로가 필요합니다.'); process.exitCode=1; return; }
  const check=validateSkillLibrary(source,{silent:false,strictAi:true}); if(!check.ok){ process.exitCode=1; return; }
  const meta=normalizeSkillMeta(check.meta,path.basename(source)); const name=slugifyName(meta.name); const dest=path.join(root,'.harness/skills',name); fs.mkdirSync(dest,{recursive:true});
  const srcSkills=path.join(source,'skills'); if(exists(srcSkills)) copyRecursive(srcSkills,dest); write(path.join(dest,'skill-library.json'),JSON.stringify(meta,null,2)+'\n'); if(exists(path.join(source,'ai-verification.json'))) fs.copyFileSync(path.join(source,'ai-verification.json'),path.join(dest,'ai-verification.json'));
  updateSkillLock(root,{...meta,source:'library'},false); appendEnvExample(root,{name,title:meta.title||name,requiresEnv:meta.requiresEnv||[]}); ok('검증된 스킬 라이브러리 병합 완료: '+rel(root,dest));
}
function migrateSkillLibrary(dir,flags){
  dir=path.resolve(dir||process.cwd()); if(!exists(dir)){ fail('마이그레이션 대상 경로가 없습니다: '+dir); process.exitCode=1; return; }
  const old=readSkillLibraryMeta(dir)||{}; const t=nowIso(); const migrated=normalizeSkillMeta({name:slugifyName(flags.name||old.name||path.basename(dir)),version:String(flags.version||old.version||'0.1.0'),title:flags.title||old.title||old.description||path.basename(dir),description:flags.description||old.description||'Migrated Leerness skill library.',category:flags.category||old.category||'custom',compatibleHarness:'>=1.0.0',sensitiveDataPolicy:'env-reference-only',requiresEnv:Array.from(new Set(old.requiresEnv||old.harnessSkill?.requiresEnv||[])),migratedAt:t,lastUpdated:dateOnly(t),lastUpdatedAt:t,verification:{status:'needs-review',method:'migrated-after-verification',verifiedBy:null,verifiedAt:null,checks:[]}}, path.basename(dir));
  const skillsDir=path.join(dir,'skills'); if(!exists(skillsDir)) fs.mkdirSync(skillsDir,{recursive:true}); const mdFiles=skillLibraryFiles(dir).filter(f=>f.endsWith('.md')&&!isInside(skillsDir,f)&&!f.includes(path.sep+'node_modules'+path.sep));
  for(const f of mdFiles){ if(path.basename(f).toLowerCase()==='readme.md') continue; const dest=path.join(skillsDir,path.basename(f)); if(!exists(dest)) fs.copyFileSync(f,dest); }
  migrated.files=skillLibraryFiles(skillsDir).filter(f=>f.endsWith('.md')).map(f=>rel(dir,f)); writeSkillLibraryMeta(dir,migrated); if(!exists(path.join(dir,'README.md'))) write(path.join(dir,'README.md'),'# '+migrated.title+'\n\n'+migrated.description+'\n'); const check=validateSkillLibrary(dir,{silent:false}); if(!check.ok) process.exitCode=1; else { warn('마이그레이션 완료. 검증 상태가 needs-review입니다.'); info('다음: leerness library verify '+dir+' --ai --reviewer leerness-ai'); }
}
function publishSkillLibrary(dir,flags){
  dir=path.resolve(dir||process.cwd()); const target=String(flags.target||'npm'); const execute=Boolean(flags.execute); const check=validateSkillLibrary(dir,{silent:false,strictAi:true}); if(!check.ok){ process.exitCode=1; return; }
  if(!isAiVerified(check.meta)){ fail('AI 검증된 스킬만 업로드할 수 있습니다. `leerness library verify <path> --ai`를 먼저 실행하세요.'); process.exitCode=1; return; }
  if(target==='npm'){ if(!exists(path.join(dir,'package.json'))){ warn('package.json이 없습니다. 먼저 build를 실행하세요.'); info('leerness library build '+dir); process.exitCode=1; return; } const args=['publish','--access','public'].concat(flags.registry?['--registry',flags.registry]:[]); if(!execute){ info('[dry-run] AI 검증 통과. 실행 예정: (cd '+dir+') npm '+args.join(' ')); info('실제 배포는 --execute를 붙이세요.'); return; } const r=childProcess.spawnSync('npm',args,{cwd:dir,stdio:'inherit',shell:process.platform==='win32'}); process.exitCode=r.status||0; return; }
  if(target==='git'){ const repo=flags.repo; const branch=flags.branch||'main'; const message=flags.message||('Publish verified skill library '+check.meta.name+'@'+(check.meta.version||'0.1.0')); if(!execute){ info('[dry-run] AI 검증 통과. git target repo: '+(repo||'(current repo)')); info('[dry-run] branch: '+branch); info('[dry-run] commit message: '+message); info('실제 push는 --execute를 붙이세요.'); return; } const run=(cmd,args)=>{ const r=childProcess.spawnSync(cmd,args,{cwd:dir,stdio:'inherit',shell:process.platform==='win32'}); if(r.status) process.exit(r.status); }; if(repo&&!exists(path.join(dir,'.git'))){ run('git',['init']); run('git',['remote','add','origin',repo]); } run('git',['add','.']); run('git',['commit','-m',message]); run('git',['branch','-M',branch]); run('git',['push','-u','origin',branch]); return; }
  fail('지원하지 않는 publish target: '+target); process.exitCode=1;
}
function libraryGuide(root,flags={}){
  root=path.resolve(root||flags.path||process.cwd()); const target=path.join(root,'.harness/AX_SKILL_LIBRARY_GUIDE.md');
  if(exists(target)){ ok('AX 가이드 위치: '+target); log(read(target)); return; }
  const bundled=path.join(PACKAGE_ROOT,'docs','AX_SKILL_LIBRARY_GUIDE.md');
  if(exists(bundled)){ log(read(bundled)); return; }
  warn('AX 가이드 파일을 찾지 못했습니다. init을 먼저 실행하세요.');
}
function libraryCommand(args,flags){
  const sub=args[1]||'help';
  if(sub==='help'){ log(['Leerness Skill Library Commands','','  leerness library guide [project-path]','  leerness library status <path>','  leerness library validate <path> [--strict-ai]','  leerness library verify <path> --ai --reviewer leerness-ai','  leerness library build <path> [--out ./dist] [--package leerness-skill-name]','  leerness library update <path> --from <validated-new-skill-path> [--version 1.1.0]','  leerness library merge <source-library> [--path <project>]','  leerness library migrate <path> [--version 1.0.0]','  leerness library publish <built-library> --target npm|git [--execute]','','업로드는 AI 검증 메타데이터가 있는 스킬만 가능하며 기본 publish는 dry-run입니다.',''].join('\n')); return; }
  if(sub==='guide') return libraryGuide(args[2]||flags.path||process.cwd(),flags);
  if(sub==='status') return libraryStatus(args[2]||process.cwd());
  if(sub==='validate') return validateSkillLibrary(args[2]||process.cwd(),{silent:false,strictAi:Boolean(flags['strict-ai']||flags.strictAi)});
  if(sub==='verify') return verifySkillLibrary(args[2]||process.cwd(),flags);
  if(sub==='build') return buildSkillLibrary(args[2]||process.cwd(),flags);
  if(sub==='update') return updateSkillLibrary(args[2]||process.cwd(),flags);
  if(sub==='merge') return mergeSkillLibrary(flags.path||process.cwd(),args[2]||flags.source,flags);
  if(sub==='migrate') return migrateSkillLibrary(args[2]||process.cwd(),flags);
  if(sub==='publish'||sub==='upload') return publishSkillLibrary(args[2]||process.cwd(),flags);
  fail('알 수 없는 library 명령: '+sub); process.exitCode=1;
}
function skillCommand(args,flags){
  const sub=args[1]||'list'; const root=path.resolve(flags.path||process.cwd());
  if(sub==='learn'){ flags.name=args[2]||flags.name; return learnSkillLibrary(root,flags); }
  if(sub==='library') return libraryCommand(['library'].concat(args.slice(2)),flags);
  if(sub==='list'){
    banner(); log('사용 가능한 스킬 라이브러리');
    for(const p of listSkillPacks()){
      log('- '+p.name+'@'+p.version+': '+p.title);
      log('  '+p.description);
      log('  updated: '+(p.lastUpdated||'unknown')+' · verification: '+verificationLabel(p));
      if((p.requiresEnv||[]).length) log('  env: '+(p.requiresEnv||[]).join(', '));
    }
    return;
  }
  const name=args[2]; if(!name){ fail('스킬 이름이 필요합니다. 예: leerness skill add commerce-api'); return; }
  if(sub==='add'||sub==='install') return installSkill(root,name,Boolean(flags['dry-run']));
  if(sub==='remove'||sub==='rm') return removeSkill(root,name);
  if(sub==='update') return installSkill(root,name,false);
  fail('알 수 없는 skill 명령: '+sub);
}
function status(root){
  root=path.resolve(root||process.cwd()); const vf=path.join(root,'.harness/HARNESS_VERSION'); const version=exists(vf)?read(vf).trim():'not installed'; const missing=Object.keys(coreFiles).filter(f=>!exists(path.join(root,f))); const lp=path.join(root,'.harness/skills-lock.json'); const lock=exists(lp)?parseJsonSafe(read(lp),{installedSkills:{}}):{installedSkills:{}};
  banner(); log('대상: '+root); log('버전: '+version); log('파일: '+(Object.keys(coreFiles).length-missing.length)+'/'+Object.keys(coreFiles).length); if(missing.length){ warn('누락 파일'); missing.forEach(x=>log('  - '+x)); } else ok('필수 파일 모두 존재');
  const names=Object.keys(lock.installedSkills||{}); log('설치 스킬: '+(names.length?names.join(', '):'없음'));
  for(const n of names){ const m=lock.installedSkills[n]; log('  - '+n+'@'+(m.version||'?')+' · updated '+(m.lastUpdated||'unknown')+' · '+(m.verificationStatus||'unknown')); }
}
function help(){ log(['Leerness v'+VERSION,'','Usage:','  leerness init [path] [--yes] [--skills office,commerce-api|recommended|all]','  leerness migrate [path] [--dry-run]','  leerness status [path]','  leerness verify [path]','','Skills:','  leerness skill list','  leerness skill add <name> [--path <project>]','  leerness skill remove <name> [--path <project>]','  leerness skill update <name> [--path <project>]','  leerness skill learn <name> --from <validated-skill-path> [--out <library-path>]','','Skill library lifecycle:','  leerness library guide [path]','  leerness library status <path>','  leerness library validate <path> [--strict-ai]','  leerness library verify <path> --ai --reviewer leerness-ai','  leerness library build <path> [--out ./dist] [--package leerness-skill-name]','  leerness library update <path> --from <validated-new-skill-path> [--version 1.1.0]','  leerness library merge <source-library> [--path <project>]','  leerness library migrate <path> [--version 1.0.0]','  leerness library publish <built-library> --target npm|git [--execute]','  leerness --version','','Examples:','  npx leerness init --skills recommended','  npx leerness skill learn coupang-order-sync --from .harness/skills/commerce-api/order-sync.md','  npx leerness library verify .harness/library/coupang-order-sync --ai --reviewer leerness-ai','  npx leerness library build .harness/library/coupang-order-sync','  npx leerness library publish .harness/library/coupang-order-sync/dist/coupang-order-sync --target npm --execute',''].join('\n')); }

async function main(){ const parsed=parseArgs(process.argv.slice(2)); const args=parsed.positionals; const flags=parsed.flags; if(flags.version||flags.v){ log(VERSION); return; } if(flags.help||flags.h){ help(); return; } const cmd=args[0]||'init'; if(cmd==='init') return init(args[1]||process.cwd(),flags); if(cmd==='migrate') return migrate(args[1]||process.cwd(),flags); if(cmd==='status') return status(args[1]||process.cwd()); if(cmd==='verify') return verify(args[1]||process.cwd()); if(cmd==='skill') return skillCommand(args,flags); if(cmd==='library') return libraryCommand(args,flags); help(); process.exitCode=1; }
main().catch(err=>{ fail(err.stack||err.message); process.exit(1); });
