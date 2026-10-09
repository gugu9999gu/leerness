'use strict';
const S = require('./memory-migration-test-support');
const {fs,path,assert,test,command} = S;
const { _renderDecisionsMd, _renderLessonsMd } = require('../lib/pure-utils');
const fields = { decisions: ['date','title','decision','reason','alternatives','impact'], lessons: ['date','text','tag'] };
const names = ['decisions.json','decisions.md','decisions.archive.md','lessons.json','lessons.md','lessons.archive.md',
  'task-log.md','review-evidence.md','progress-tracker.md','current-state.md','session-handoff.md'];
const render = (surface, rows) => surface === 'decisions' ? _renderDecisionsMd(rows) : _renderLessonsMd(rows);
const normal = (surface, value='existing') => surface === 'decisions'
  ? { date:'2026-09-01',title:value,decision:value,reason:null,alternatives:null,impact:null }
  : { date:'2026-09-01',text:value,tag:null };
function fixture(surface, rows) {
  const restored = normal(surface, 'restored');
  return S.project({ HARNESS_VERSION: require('../package.json').version, [surface+'.json']:JSON.stringify(rows),
    [surface+'.archive.md']:'# Archive\n\n## 제거 2026-09-02 (target: "selected")\n'+render(surface,[restored]).slice(render(surface,[]).length) });
}
const file = (root,surface) => path.join(root,'.leerness',surface+'.json');
function snapshot(root) {
  return names.map(name => {
    const p=path.join(root,'.leerness',name);
    if(!fs.existsSync(p)) return [name,null];
    const stat=fs.statSync(p,{bigint:true});
    return [name,fs.readFileSync(p).toString('base64'),String(stat.mtimeNs)];
  });
}
function run(root,args,prefix=[]) { const r=command(root,[...args,'--path',root,'--json'],'',prefix); return {...r, json: (()=>{try{return JSON.parse(r.stdout)}catch{return null}})()}; }
const add = surface => [surface==='decisions'?'decision':'lesson',surface==='decisions'?'add':'save'];
function reject(surface, rows, args, expectedIndex, expectedField) {
  const root=fixture(surface,rows), before=snapshot(root), r=run(root,args);
  assert.equal(r.status,1,r.stdout+r.stderr); assert(r.json, r.stdout+r.stderr);
  assert.equal(r.json.code,'store_item_unsupported',r.stdout);
  assert.equal(r.json.surface,surface); assert.equal(r.json.index,expectedIndex); assert.equal(r.json.field,expectedField);
  assert(!r.stdout.includes(S.PRIVATE)); assert.deepEqual(snapshot(root),before);
}
const baselineOnly=process.argv.includes('--invalid-only');
for(const surface of ['decisions','lessons']) {
  for(const [name,value] of [['null',null],['number',17],['boolean',false],['string',S.PRIVATE],['array',[]]]) {
    test(surface+' rejects '+name+' item before add',()=>reject(surface,[normal(surface),value],[...add(surface),'new'],1,null));
  }
  for(const field of fields[surface]) test(surface+' rejects object field '+field,()=>{
    reject(surface,[{...normal(surface),[field]:{private:S.PRIVATE}}],[...add(surface),'new'],0,field);
  });
  const invalid={...normal(surface),[surface==='decisions'?'reason':'tag']:9};
  for(const [name,args] of [['duplicate',[...add(surface),'existing']],['force',[...add(surface),'existing','--force']],
    ['drop',[surface==='decisions'?'decision':'lesson','drop','existing']],
    ['drop no match',[surface==='decisions'?'decision':'lesson','drop','not-found']],
    ['restore',['memory','restore',surface,'selected']],['force restore',['memory','restore',surface,'selected','--force']]]) {
    test(surface+' invalid whole array blocks '+name,()=>reject(surface,[normal(surface),invalid],args,1,surface==='decisions'?'reason':'tag'));
  }
  if(baselineOnly) continue;
  test(surface+' rechecks generated restore candidates before publication',()=>{
    const {hook,modulePath}=require('./memory-migration-write-support');
    const name=surface==='decisions'?'_decisionsFromMd':'_parseLessonEntries';
    const field=surface==='decisions'?'reason':'tag';
    const rows=[normal(surface)],root=fixture(surface,rows),before=snapshot(root);
    const prefix=hook('const p=require('+modulePath('pure-utils')+'),original=p.'+name+';p.'+name+'=text=>{const rows=original(text);if(text.includes("restored"))for(const row of rows)row.'+field+'=7;return rows};');
    const r=run(root,['memory','restore',surface,'selected','--force'],prefix);
    assert.equal(r.status,1,r.stdout+r.stderr);assert.equal(r.json.code,'store_item_unsupported');
    assert.equal(r.json.index,1);assert.equal(r.json.field,field);assert.deepEqual(snapshot(root),before);
  });
  test(surface+' preserves missing null empty multiline and unknown JSON fields',()=>{
    const extra={nested:[1,null,true,[],{label:S.PRIVATE}]};
    const rows=[{},Object.fromEntries(fields[surface].map(f=>[f,null])),Object.fromEntries(fields[surface].map(f=>[f,''])),
      {...normal(surface),'extension':extra,[surface==='decisions'?'reason':'tag']:'line1\nline2'}];
    const root=fixture(surface,rows), r=run(root,[...add(surface),'new']);
    assert.equal(r.status,0,r.stdout+r.stderr); const after=JSON.parse(fs.readFileSync(file(root,surface)));
    assert.deepEqual(after.slice(0,rows.length),rows); assert.equal(after.length,rows.length+1);
  });
  test(surface+' preserves CLI whitespace handling, duplicate skip and force append',()=>{
    const root=fixture(surface,[normal(surface)]), before=snapshot(root);
    const skip=run(root,[...add(surface),'existing']); assert.equal(skip.status,0,skip.stdout); assert.equal(skip.json.skipped,true);
    assert.deepEqual(snapshot(root),before);
    const spaced=run(root,[...add(surface),' existing ']); assert.equal(spaced.status,0);
    assert.equal(!!spaced.json.skipped,surface==='decisions');
    assert.equal(run(root,[...add(surface),'existing','--force']).status,0);
    assert.equal(JSON.parse(fs.readFileSync(file(root,surface))).length,surface==='decisions'?2:3);
  });
  test(surface+' drop matches date while preserving survivors',()=>{
    const survivor={...normal(surface,'keep'),extension:{saved:[1,null]}};
    const rows=[normal(surface,'drop-one'),normal(surface,'drop-two'),survivor];
    rows[2].date='2026-09-03'; const root=fixture(surface,rows);
    const r=run(root,[surface==='decisions'?'decision':'lesson','drop','2026-09-01']);
    assert.equal(r.status,0,r.stdout); assert.equal(r.json.removedCount,2);
    assert.deepEqual(JSON.parse(fs.readFileSync(file(root,surface))),[survivor]);
  });
  test(surface+' restore conflict and force preserve canonical values',()=>{
    const rows=[normal(surface,'restored')], root=fixture(surface,rows), before=snapshot(root);
    const r=run(root,['memory','restore',surface,'selected']); assert.equal(r.json.code,'restore_conflict',r.stdout); assert.deepEqual(snapshot(root),before);
    assert.equal(run(root,['memory','restore',surface,'selected','--force']).status,0);
    const after=JSON.parse(fs.readFileSync(file(root,surface))); assert.equal(after.length,2); assert.deepEqual(after[0],rows[0]);
  });
  test(surface+' list retains permissive read behavior for unsupported items',()=>{
    const rows=[7,{...normal(surface),[surface==='decisions'?'reason':'tag']:false}],root=fixture(surface,rows),before=snapshot(root);
    const r=run(root,[surface==='decisions'?'decision':'lesson','list']);
    assert.equal(r.status,0,r.stdout+r.stderr); assert.deepEqual(snapshot(root),before);
  });
}
if(!baselineOnly) {
  test('decision duplicate identity still uses title OR decision',()=>{
    const root=fixture('decisions',[{...normal('decisions','title'),'decision':'alias'}]),before=snapshot(root);
    assert.equal(run(root,['decision','add','alias']).json.skipped,true); assert.deepEqual(snapshot(root),before);
  });
  test('decision restore duplicate identity does not use decision text',()=>{
    const root=fixture('decisions',[{...normal('decisions','unique'),'decision':'restored'}]);
    const r=run(root,['memory','restore','decisions','selected']); assert.equal(r.status,0,r.stdout);
    assert.equal(JSON.parse(fs.readFileSync(file(root,'decisions'))).length,2);
  });
}
S.finish('memory item admission');
