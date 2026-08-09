// scripts/lock-probe.js — 상태 스토어 쓰기가 **락 안에서** 일어나는지 실행으로 관측하는 계측 모듈.
//
// 왜 소스 검사가 아니라 계측인가: 정적으로 "이 writeUtf8 이 _withLock 안인가" 를 판정하려 했더니
// 괄호 균형 스캐너가 주석/정규식 리터럴에서 폭주해 selftest 픽스처 수천 줄을 "락 안" 으로 분류했다.
// 락은 **파일별이 아니라 구간별**이기도 하다 — leerness 는 decisions.json 의 락을 쥔 채 decisions.md 를 쓴다.
// 그래서 _withLock 이 하는 것과 똑같이(O_EXCL 로 <target>.lock 생성 → 끝나면 unlink) 보유 집합을 미러링하고,
// 쓰기 시점에 "이 프로세스가 락을 하나라도 쥐고 있었나" 를 기록한다.
//
// 사용: node --require scripts/lock-probe.js bin/leerness.js <명령> ...   (LOCKPROBE_OUT 에 jsonl 기록)
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = process.env.LOCKPROBE_OUT;
const rec = [];
const held = new Set();
const norm = p => { try { return path.resolve(String(p)); } catch { return String(p); } };
// archive/ 는 백업 사본이라 경쟁 대상이 아니다. .lock 자체와 원자쓰기 임시파일도 제외(최종 경로는 rename 이 알려준다).
const isState = p => /[\\/]\.harness[\\/]/.test(p) && !/[\\/]archive[\\/]/.test(p) && !/\.lock$/.test(p) && !/\.tmp-\d+-\d+$/.test(p);
const relOf = p => (p.split(/[\\/]\.harness[\\/]/)[1] || p).replace(/\\/g, '/');

const _open = fs.openSync.bind(fs);
fs.openSync = function (p, flags, ...a) {
  const r = _open(p, flags, ...a);
  try { if (String(flags) === 'wx' && /\.lock$/.test(String(p))) held.add(norm(p)); } catch {}
  return r;
};
const _unlink = fs.unlinkSync.bind(fs);
fs.unlinkSync = function (p, ...a) {
  try { if (/\.lock$/.test(String(p))) held.delete(norm(p)); } catch {}
  return _unlink(p, ...a);
};

// 1.36.108 (codex 검수 P2, 재현됨): "락을 하나라도 쥐었나" 는 **너무 약한 질문**이다.
//   session close 는 session-handoff.md 의 락을 쥔 채 current-state.md 를 썼고, audit --fix 는
//   current-state.md 의 락을 쥔다 — 둘 다 '락 보유' 인데 서로를 배제하지 못해 갱신이 덮였다.
//   그래서 **어느 락을 쥐었는지**(heldOn)를 함께 남긴다. 가드는 파일마다 락 키가 일관되는지까지 본다.
const note = (target, how) => {
  const t = norm(target);
  if (!isState(t)) return;
  rec.push({ file: relOf(t), how, locked: held.size > 0, heldOn: [...held].map(relOf).sort() });
};
const _w = fs.writeFileSync.bind(fs);
fs.writeFileSync = function (p, ...a) { try { note(p, 'write'); } catch {} return _w(p, ...a); };
const _r = fs.renameSync.bind(fs);
fs.renameSync = function (from, to) { try { note(to, 'rename'); } catch {} return _r(from, to); };
const _a = fs.appendFileSync.bind(fs);
fs.appendFileSync = function (p, ...args) { try { note(p, 'append'); } catch {} return _a(p, ...args); };

process.on('exit', () => {
  if (!OUT) return;
  try { fs.appendFileSync(OUT, rec.map(r => JSON.stringify(r)).join('\n') + (rec.length ? '\n' : ''), 'utf8'); } catch {}
});
