'use strict';
// T-0350: a decisions or lessons restore with an explicit write policy must work when the project root is spelled
// differently from its real path. Until 1.36.297 the footprint capture named its snapshots under the realpath.native
// workspace while admission and preparation named the same files under the caller's spelling, so
// assertCheckedFileCurrent refused every such restore with "snapshot does not belong to this file".
// Spellings: as created, and on Windows a lowercase drive letter, a junction and the 8.3 short name (reported as
// skipped when the volume has no short names); elsewhere a symlink. Each restore must leave the same files as the
// restore through the real path. One MCP restore per surface uses a non-canonical spelling too.
const S = require('./memory-write-budget-support');
const { assert, fs, path, cp, arena, entry, test, finish, fixture, row, options } = S;
const { renderLosslessArchiveEntries } = require('../lib/memory-archive');
const policy = JSON.stringify({ limits: options(), mode: 'within-target',
  targets: { items: 100, canonicalBytes: 65536, projectionBytes: 65536, archiveBytes: 65536, totalPathBytes: 200000 } });
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC)$/i.test(k)));
for (const key of ['TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA']) { env[key] = path.join(arena,'env-'+key.toLowerCase()); fs.mkdirSync(env[key]); }
Object.assign(env,{ LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1' });
const win = process.platform === 'win32';

const make = s => fixture(s,[row(s,'base')],'\nPRIVATE suffix\n',
  { [s+'.archive.md']: '# Archive\n\n## 제거 2026-09-01 (target: "recover")\n'+renderLosslessArchiveEntries(s,[row(s,'revive')])+'\n' });
// What a restore leaves, read through the real path.
const state = (p, s) => ({ rows: JSON.parse(fs.readFileSync(path.join(p,'.leerness',s+'.json'),'utf8')),
  projection: fs.readFileSync(path.join(p,'.leerness',s+'.md'),'utf8'), archive: fs.readFileSync(path.join(p,'.leerness',s+'.archive.md'),'utf8') });
// The 8.3 name of an existing folder, or null when the volume gives none.
function shortName(p) {
  const r = cp.spawnSync(process.env.ComSpec || 'cmd.exe', ['/d','/s','/c',`"for %I in ("${p}") do @echo %~sI"`],
    { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true });
  const out = String(r.stdout || '').trim();
  return r.status === 0 && out && !out.includes('"') && out.toLowerCase() !== p.toLowerCase() ? out : null;
}
const spellings = [
  ['as created', p => p],
  ...(win ? [
    ['a lowercase drive letter', p => /^[A-Z]:/.test(p) ? p[0].toLowerCase() + p.slice(1) : null],
    ['a junction', p => { const link = p + '-junction'; fs.symlinkSync(p, link, 'junction'); return link; }],
    ['the 8.3 short name', shortName],
  ] : [
    ['a symlink', p => { const link = p + '-symlink'; fs.symlinkSync(p, link, 'dir'); return link; }],
  ]),
];
function restoreCli(spelled, s) {
  const r = cp.spawnSync(process.execPath,[entry,'memory','restore',s,'recover','--path',spelled,'--write-policy-json',policy,'--json'],
    { cwd: spelled, env, encoding: 'utf8', timeout: 60000, maxBuffer: 1048576, windowsHide: true });
  assert(!r.error && !r.signal, r.error && r.error.message);
  return r;
}
function restoreMcp(spelled, s) {
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'leerness_memory_restore', arguments: { surface: s, target: 'recover', path: spelled, writePolicyJson: policy } } };
  const r = cp.spawnSync(process.execPath,[entry,'mcp','serve','--profile','full'],
    { cwd: spelled, env, input: JSON.stringify(request)+'\n', encoding: 'utf8', timeout: 60000, maxBuffer: 1048576, windowsHide: true });
  assert(!r.error && !r.signal, r.error && r.error.message); assert.equal(r.status,0,r.stderr);
  return JSON.parse(r.stdout.trim().split(/\r?\n/)[0]);
}
// T-0355: a spelling this machine cannot give counts as absent: a test arena on a UNC path has no drive letter, and
// a link may be refused there. The MCP and resolve-check tests take the first non-canonical spelling that exists.
const trySpell = (spell, p) => { try { return spell(p); } catch { return null; } };
function alternate(p) {
  for (const [name, spell] of spellings.slice(1)) { const spelled = trySpell(spell, p); if (spelled && spelled !== p) return [name, spelled]; }
  return null;
}

for (const s of ['decisions','lessons']) {
  let expected = null;
  for (const [name, spell] of spellings) {
    const p = make(s), spelled = trySpell(spell, p);
    if (spelled === null) { console.log(`SKIP ${s}: policy restore through ${name} (this volume or path gives no such spelling)`); continue; }
    test(`${s}: policy restore through ${name} matches the restore through the real path`, () => {
      if (name !== 'as created') assert.notStrictEqual(spelled, p, 'the spelling must differ from the real path');
      const r = restoreCli(spelled, s);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const after = state(p, s);
      assert.deepEqual(after.rows.map(entry => entry.title || entry.text), ['base','revive']);
      assert(!after.archive.includes('target: "recover"'), 'the restored block must leave the archive');
      if (expected === null) expected = after; else assert.deepEqual(after, expected);
    });
  }
  const pm = make(s), alt = alternate(pm);
  if (!alt) { console.log(`SKIP ${s}: MCP policy restore (this volume or path gives no non-canonical spelling)`); continue; }
  const [mcpName, spelled] = alt; // a lowercase drive letter on Windows when there is one, a symlink elsewhere
  test(`${s}: MCP policy restore through ${mcpName}`, () => {
    const p = pm;
    const reply = restoreMcp(spelled, s);
    assert(reply.result, JSON.stringify(reply)); assert.equal(reply.result.isError, false, JSON.stringify(reply));
    assert.deepEqual(state(p, s).rows.map(entry => entry.title || entry.text), ['base','revive']);
  });
}
// The capture names files under the given spelling only after that spelling's workspace resolves to the resolved
// one. Make it resolve elsewhere (as a swapped link would between the two resolutions) and the capture must refuse
// before reading a file; without the check the files of the other folder would be measured as this project's.
const resolveCheckProject = make('decisions'), resolveCheckAlternate = alternate(resolveCheckProject);
if (!resolveCheckAlternate) console.log('SKIP a spelled workspace that resolves to another folder (no non-canonical spelling here)');
else test('a spelled workspace that resolves to another folder is refused before any file is read', () => {
  const { inspectMemoryFootprint } = require('../lib/memory-footprint');
  const p = resolveCheckProject, other = make('decisions'), spelled = resolveCheckAlternate[1];
  const limits = JSON.stringify(options().observation);
  assert.equal(inspectMemoryFootprint(spelled,'decisions',limits).ok, true, 'control: the spelling itself is accepted');
  const workspace = path.join(spelled,'.leerness'), same = (a, b) => win ? a.toLowerCase() === b.toLowerCase() : a === b;
  const real = fs.realpathSync.native, opened = [], open = fs.openSync;
  fs.realpathSync.native = function (file, ...rest) {
    return real.call(fs, same(path.resolve(String(file)), path.resolve(workspace)) ? path.join(other,'.leerness') : file, ...rest);
  };
  fs.openSync = function (file, ...rest) { opened.push(String(file)); return open.call(fs, file, ...rest); };
  try {
    const result = inspectMemoryFootprint(spelled,'decisions',limits);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'workspace_unavailable');
    assert.deepEqual(opened.filter(file => /\.leerness[\\/]decisions\./.test(file)), [], 'no store file may be opened');
  } finally { fs.realpathSync.native = real; fs.openSync = open; }
});
finish('memory policy root spelling');
