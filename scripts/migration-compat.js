// 마이그레이션 사냥 v2 — 기록된 실패 모드를 정확히 겨냥한다.
//  (a) **반복** 마이그레이션 (1.36.28 사고: "2번째부터 사라졌다")
//  (b) 언어 전환 (1.36.60 사고: 구 언어 템플릿이 커스텀으로 오인돼 이월)
//  (c) 연쇄 업그레이드 (구버전 → 중간 → 현재)
//  (d) 사용자가 **템플릿과 같은 문장**을 의도적으로 쓴 경우(차감이 지우면 안 된다)
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const CUR = require('path').join(__dirname, '..', 'bin', 'leerness.js');   // 저장소 어디에 있든 동작
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mh2-'));
const E = (sb) => Object.assign({}, process.env, { LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTO_ROADMAP: '1', TMPDIR: sb, TEMP: sb, TMP: sb });
let bad = 0;
const t = (k, ok, n) => { if (!ok) bad++; console.log((ok ? '  ok  ' : '  ✗   ') + k.padEnd(52) + (n || '')); };
const FILES = ['AGENTS.md', 'CLAUDE.md', '.harness/current-state.md', '.harness/plan.md', '.harness/decisions.md', '.harness/project-brief.md'];
const plant = (proj, tag) => { const done = []; for (const rel of FILES) { const p = path.join(proj, rel); if (!fs.existsSync(p)) continue; fs.appendFileSync(p, `\nUSERMARK-${tag}-${rel.replace(/[^\w]/g, '')}\n`); done.push(rel); } return done; };
const liveHas = (proj, tag, rel) => { const p = path.join(proj, rel); if (!fs.existsSync(p)) return false; return fs.readFileSync(p, 'utf8').includes(`USERMARK-${tag}-${rel.replace(/[^\w]/g, '')}`); };
const anywhere = (proj, needle) => { let f = false; (function w(y) { for (const e of fs.readdirSync(y, { withFileTypes: true })) { const q = path.join(y, e.name); if (e.isDirectory()) { if (!/node_modules|\.git$/.test(e.name)) w(q); } else if (!f) { try { if (fs.readFileSync(q, 'utf8').includes(needle)) f = true; } catch { } } } })(proj); return f; };
const R = (sb, cli, a, cwd) => cp.spawnSync(process.execPath, [cli, ...a], { cwd, encoding: 'utf8', timeout: 900000, env: E(sb) });

function setupOld(ver, tag) {
  const sb = path.join(root, tag); fs.mkdirSync(sb, { recursive: true });
  fs.writeFileSync(path.join(sb, 'package.json'), JSON.stringify({ name: 'h', version: '0.1.0', private: true }));
  const inst = cp.spawnSync('npm', ['i', 'leerness@' + ver, '--no-audit', '--no-fund'], { cwd: sb, encoding: 'utf8', shell: true, timeout: 900000 });
  if (inst.status !== 0) return null;
  const OLD = path.join(sb, 'node_modules', 'leerness', 'bin', 'leerness.js');
  const proj = path.join(sb, 'proj'); fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"p","version":"0.1.0"}');
  if (R(sb, OLD, ['init', proj, '--yes'], proj).status !== 0) return null;
  return { sb, OLD, proj };
}

console.log('■ (a) 반복 마이그레이션 — 기록된 사고는 "2번째부터"');
{
  const s = setupOld('1.30.0', 'repeat');
  if (!s) { console.log('   설치 실패 — 건너뜀'); }
  else {
    const planted = plant(s.proj, 'REP');
    for (let i = 1; i <= 4; i++) {
      R(s.sb, CUR, ['init', s.proj, '--yes'], s.proj);
      const live = planted.filter(rel => liveHas(s.proj, 'REP', rel));
      const gone = planted.filter(rel => !anywhere(s.proj, `USERMARK-REP-${rel.replace(/[^\w]/g, '')}`));
      console.log(`   ${i}회차: 본문 생존 ${live.length}/${planted.length} · 완전손실 ${gone.length}` + (gone.length ? ' → ' + gone.join(', ') : ''));
      if (i === 4) { t('반복 4회 후 완전손실 0', gone.length === 0); t('반복 4회 후 본문 생존 전부', live.length === planted.length, live.length + '/' + planted.length); }
    }
    // 파일 크기 폭주도 함께 본다 (이월이 무한히 자라면 그것도 결함)
    const sz = fs.statSync(path.join(s.proj, 'CLAUDE.md')).size;
    t('반복해도 CLAUDE.md 가 폭주하지 않음', sz < 30000, sz + ' B');
  }
}

console.log('\n■ (b) 언어 전환 (ko → en) 후 사용자 커스텀');
{
  const s = setupOld('1.33.0', 'lang');
  if (!s) { console.log('   설치 실패 — 건너뜀'); }
  else {
    const planted = plant(s.proj, 'LANG');
    R(s.sb, CUR, ['init', s.proj, '--yes', '--language', 'en'], s.proj);
    const gone = planted.filter(rel => !anywhere(s.proj, `USERMARK-LANG-${rel.replace(/[^\w]/g, '')}`));
    const live = planted.filter(rel => liveHas(s.proj, 'LANG', rel));
    t('언어 전환 후 완전손실 0', gone.length === 0, gone.join(', '));
    t('언어 전환 후 본문 생존', live.length === planted.length, live.length + '/' + planted.length);
  }
}

console.log('\n■ (c) 연쇄 업그레이드 1.30.0 → 1.33.0 → 현재');
{
  const s = setupOld('1.30.0', 'chain');
  if (!s) { console.log('   설치 실패 — 건너뜀'); }
  else {
    const planted = plant(s.proj, 'CHAIN');
    const mid = path.join(s.sb, 'mid'); fs.mkdirSync(mid, { recursive: true });
    fs.writeFileSync(path.join(mid, 'package.json'), JSON.stringify({ name: 'm', version: '0.1.0', private: true }));
    const i2 = cp.spawnSync('npm', ['i', 'leerness@1.33.0', '--no-audit', '--no-fund'], { cwd: mid, encoding: 'utf8', shell: true, timeout: 900000 });
    if (i2.status === 0) R(s.sb, path.join(mid, 'node_modules', 'leerness', 'bin', 'leerness.js'), ['init', s.proj, '--yes'], s.proj);
    R(s.sb, CUR, ['init', s.proj, '--yes'], s.proj);
    const gone = planted.filter(rel => !anywhere(s.proj, `USERMARK-CHAIN-${rel.replace(/[^\w]/g, '')}`));
    t('연쇄 업그레이드 후 완전손실 0', gone.length === 0, gone.join(', '));
  }
}

console.log('\n■ (d) 사용자가 템플릿과 같은 문장을 쓴 경우 (차감이 지우면 안 된다)');
{
  const s = setupOld('1.33.0', 'dup');
  if (!s) { console.log('   설치 실패 — 건너뜀'); }
  else {
    const ag = path.join(s.proj, 'AGENTS.md');
    const first = fs.readFileSync(ag, 'utf8').split('\n').find(l => l.trim().length > 20 && !/^#/.test(l)) || '';
    fs.appendFileSync(ag, '\n' + first + '\nUSERMARK-DUP-copy\n');
    R(s.sb, CUR, ['init', s.proj, '--yes'], s.proj);
    t('템플릿 복제본 옆 사용자 표식 생존', anywhere(s.proj, 'USERMARK-DUP-copy'), '앵커=' + JSON.stringify(first.slice(0, 40)));
  }
}
console.log('\n실패 ' + bad + '건 · ' + root);
process.exit(bad ? 1 : 0);
