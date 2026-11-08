'use strict';
const path = require('node:path');
const { createSnapshot } = require('./stored-read-snapshot');
const store = require('./legacy-run-store');
const _SPst = require('./session-presence');
const { _completionClaimAllowed } = require('./pure-utils');
function stateShow(root, { json = true, env = process.env } = {}) {
  root = path.resolve(root);
  const snapshot = createSnapshot(root), output = [];
  const log = line => output.push(line);
  const _sessKey = _SPst.deriveSessionKey(env);
  const _badKey = _SPst.invalidExplicitKey(env);
  const warning = _badKey && !json ? `⚠ LEERNESS_SESSION_ID 가 형식에 맞지 않아 무시됩니다("${_badKey}") — 이 세션은 주소 없이 전역 슬롯을 씨니다` : null;
  const _ownedBy = (st) => {
    const raw = (st && st.runsBySession && typeof st.runsBySession === 'object' && !Array.isArray(st.runsBySession)) ? st.runsBySession : {};
    const o = Object.create(null);
    for (const k of Object.keys(raw)) if (typeof raw[k] === 'string' && raw[k]) o[k] = raw[k];
    return o;
  };


  const _resolveRunId = (st) => {
    const owned = _ownedBy(st);
    if (_sessKey && owned[_sessKey]) return owned[_sessKey];
    const others = new Set(Object.entries(owned).filter(([k]) => k !== _sessKey).map(([, v]) => v));
    if (st.currentRunId && !others.has(st.currentRunId)) return st.currentRunId;
    return null;
  };
  const state = store.loadState(root, snapshot);
  const curId = _resolveRunId(state);
  const rec = curId ? store.loadRun(root, curId, snapshot) : null;

  if (json) {
    const _redactedOwners = Object.fromEntries(Object.keys(_ownedBy(state)).map((k) => [
      k === _sessKey ? k : (String(k).slice(0, 6) + '…'), _ownedBy(state)[k]]));
    const _stateOut = Object.assign({}, state, { runsBySession: _redactedOwners });
    const data = {
      state: _stateOut, currentRun: rec, completion_claim_allowed: rec ? _completionClaimAllowed(rec) : null,
      sessionKey: _sessKey || null, keySource: _SPst.keySource(env) || null,


      runsBySession: Object.fromEntries(Object.keys(_ownedBy(state)).map((k) => [
        k === _sessKey ? k : (String(k).slice(0, 6) + '…'), _ownedBy(state)[k]])),
      resolvedRunId: curId,
    };
    snapshot.verify();
    return { text: JSON.stringify(data, null, 2) + '\n', data, snapshot, warning };
  }
  log(`# leerness state (1.9.278, UR-0032) — .leerness/ 구조화 상태`);
  log(`project: ${state.project} · runs 누적: ${state.runCounter || 0} · 현재 run: ${curId || '(없음)'}`);
  if (rec) {
    log('');
    log(`## ${rec.run_id} [${rec.status}]`);
    log(`  goal: ${rec.goal || '-'}`);
    log(`  agent/model: ${rec.agent_name || '-'} / ${rec.model_name || '-'}`);
    log(`  files_changed: ${rec.files_changed.join(', ') || '-'}`);
    log(`  commands_run: ${rec.commands_run.join(', ') || '-'}`);
    log(`  tests_run: ${rec.tests_run.join(', ') || '-'} · verification: ${rec.verification_result || '-'}`);
    if (rec.decisions.length) log(`  decisions: ${rec.decisions.length}`);
    const _cca = _completionClaimAllowed(rec);
    log(`  completion_claim_allowed: ${_cca.allowed ? 'yes ✓' : 'no ✗ (' + _cca.reasons.join(', ') + ')'}`);
  } else {
    log(`  → 시작: leerness state start "<goal>" [--agent claude --model claude-opus-4-7 --task T-0001]`);
  }
  snapshot.verify();
  return { text: output.join('\n') + '\n', data: null, snapshot, warning };
}
module.exports = { stateShow };
