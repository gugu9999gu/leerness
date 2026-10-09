'use strict';
const S = require('./memory-migration-write-support');
const { fs, path, cp, assert, fixture, prepared, hook, modulePath } = S;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 15000;
  while (!predicate()) { assert(Date.now() < deadline, 'barrier timed out'); await pause(25); }
}
function launch(root, surface, id, prefix) {
  const child = cp.spawn(process.execPath, [...prefix, S.entry, 'memory-migration', 'apply', surface, id,
    '--confirm', '--path', root, '--json'], { cwd: root, windowsHide: true,
    env: { ...process.env, LEERNESS_NO_AUTOCHCP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const run = { child, done: false, stdout: '', stderr: '' };
  child.stdout.on('data', data => { run.stdout += data; }); child.stderr.on('data', data => { run.stderr += data; });
  run.result = new Promise(resolve => {
    child.on('error', error => { run.error = error; });
    child.on('close', status => { run.done = true; run.status = status; resolve(run); });
  });
  return run;
}
async function scenario(surface, different) {
  const root = fixture(surface), first = prepared(root, surface), second = different ? prepared(root, surface) : first;
  const barrier = fs.mkdtempSync(path.join(S.arena, 'barrier-'));
  const ready = path.join(barrier, 'ready'), release = path.join(barrier, 'release'), waiting = path.join(barrier, 'waiting');
  const ownerHook = hook(`const fs=require('fs'),out=require(${modulePath('memory-output')}),original=out.publishMemoryOutput;
out.publishMemoryOutput=(t,f,b)=>{if(f.endsWith(${JSON.stringify(surface + '.json')})){fs.writeFileSync(${JSON.stringify(ready)},'ready');const deadline=Date.now()+15000;while(!fs.existsSync(${JSON.stringify(release)})){if(Date.now()>deadline)throw Error('barrier timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}}return original(t,f,b)};`);
  const waiterHook = hook(`const fs=require('fs'),original=fs.mkdirSync;
fs.mkdirSync=(p,...args)=>{try{return original(p,...args)}catch(e){if(String(p).endsWith(${JSON.stringify(surface + '.json.lock')})&&e.code==='EEXIST')fs.writeFileSync(${JSON.stringify(waiting)},'wait');throw e}};`);
  let a, b;
  try {
    a = launch(root, surface, first.operationId, ownerHook); await until(() => fs.existsSync(ready) || a.done);
    assert(!a.done, a.stdout + a.stderr);
    b = launch(root, surface, second.operationId, waiterHook); await until(() => fs.existsSync(waiting) || b.done);
    assert(fs.existsSync(waiting), b.stdout + b.stderr); assert(!b.done);
    assert(!fs.existsSync(S.file(root, surface, '.json')), 'waiter published while owner held lock');
    fs.writeFileSync(release, 'release'); await until(() => a.done && b.done);
    await Promise.all([a.result, b.result]); assert(!a.error && !b.error);
    const ar = JSON.parse(a.stdout), br = JSON.parse(b.stdout);
    assert.equal(a.status, 0); assert.equal(ar.ok, true); assert.equal(ar.activeMutationStarted, true);
    assert.equal(b.status, different ? 2 : 0); assert.equal(br.ok, !different); assert.equal(br.activeMutationStarted, false);
    assert(fs.readFileSync(S.file(root, surface, '.md'), 'utf8').includes(first.operationId));
    assert.equal(S.invoke(root, 'rollback', surface, first.operationId).ok, true);
  } finally {
    if (!fs.existsSync(release)) fs.writeFileSync(release, 'release');
    for (const run of [a, b]) if (run && !run.done) { run.child.kill(); await run.result; }
  }
}
(async () => {
  for (const surface of ['decisions', 'lessons']) for (const different of [false, true]) {
    let error = null;
    try { await scenario(surface, different); } catch (caught) { error = caught; }
    S.test(`${surface}: actual competing CLI ${different ? 'different bundles refuse adoption' : 'same bundle serializes and retries'}`, () => { if (error) throw error; });
  }
  S.finish('memory migration concurrency');
})().catch(error => { console.error(error); process.exitCode = 1; });
