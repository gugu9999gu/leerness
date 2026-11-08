 
 
 
 
 
'use strict';
const { absRoot, log, ok, warn, fail, failJson } = require('./io');
const { _nextFeatureId, _featureImpactBfs } = require('./pure-utils');

function featureAddCmd(root, title, deps = {}) {
  const { _readFeatureGraph, _writeFeatureGraph, arg, _requireInit } = deps;
  root = absRoot(root);
  if (!title) return fail('feature add: title 필요 — leerness feature add "<title>"');
   
   
  if (typeof _requireInit === 'function' && !_requireInit(root, 'feature add')) return;
  const { nodes } = _readFeatureGraph(root);
  if (nodes.some(n => n.title.toLowerCase() === title.toLowerCase())) {
    return warn(`이미 존재: "${title}"`);
  }
  const id = _nextFeatureId(nodes);
  const node = {
    id, title,
    dependsOn: [], affects: [], coChangesWith: [],
    files: [], input: '', output: '', errorModes: [], tests: [], notes: ''
  };
   
  const depends = arg('--depends-on', '');
  const affects = arg('--affects', '');
  const coChanges = arg('--co-changes-with', '');
  const files = arg('--files', '');
  if (depends) node.dependsOn = depends.split(/[,\s]+/).filter(Boolean);
  if (affects) node.affects = affects.split(/[,\s]+/).filter(Boolean);
  if (coChanges) node.coChangesWith = coChanges.split(/[,\s]+/).filter(Boolean);
  if (files) node.files = files.split(/[,\s]+/).filter(Boolean);
  nodes.push(node);
  _writeFeatureGraph(root, nodes, { type: 'add', node });
  ok(`feature added: ${id} · ${title}`);
}
function featureLinkCmd(root, fromId, deps = {}) {
  const { _readFeatureGraph, _writeFeatureGraph, arg } = deps;
  root = absRoot(root);
  if (!fromId || !/^F-\d{4,}$/.test(fromId)) return fail('feature link: 첫 인자는 F-XXXX 형식 ID');
  const { nodes } = _readFeatureGraph(root);
  const node = nodes.find(n => n.id === fromId);
  if (!node) return fail(`feature ${fromId} 없음 — feature add 먼저`);
  const dep = arg('--depends-on', '');
  const aff = arg('--affects', '');
  const co = arg('--co-changes-with', '');
  let changes = 0;
  const fields = {};
  for (const [raw, property, field] of [[dep, 'dependsOn', 'depends-on'], [aff, 'affects', 'affects'], [co, 'coChangesWith', 'co-changes-with']]) {
    const before = changes;
    for (const id of raw.split(/[,\s]+/).filter(Boolean)) if (!node[property].includes(id)) { node[property].push(id);changes++; }
    if (changes > before) fields[field] = node[property];
  }
  if (!changes) return warn('변경 없음 — --depends-on / --affects / --co-changes-with 중 하나 이상 지정');
  _writeFeatureGraph(root, nodes, { type: 'link', id: fromId, fields });
  ok(`feature ${fromId} 링크 ${changes}건 추가`);
}
function featureImpactCmd(root, fromId, deps = {}) {
  const { _readFeatureGraph, has } = deps;
  root = absRoot(root);
  const _j = has('--json');   
  if (!fromId || !/^F-\d{4,}$/.test(fromId)) return failJson(_j, 'bad_id', 'feature impact: F-XXXX ID 필요');
  const { nodes } = _readFeatureGraph(root);
  const node = nodes.find(n => n.id === fromId);
  if (!node) return failJson(_j, 'not_found', `feature ${fromId} 없음`);
  const impacted = _featureImpactBfs(nodes, fromId);
  if (has('--json')) {
    log(JSON.stringify({ feature: { id: node.id, title: node.title }, total: impacted.length, impacted }, null, 2));
    return;
  }
  log(`# Feature Impact: ${node.id} · ${node.title}`);
  if (!impacted.length) { ok('영향받는 다른 feature 없음 (또는 link 미설정)'); return; }
  log(`\n총 ${impacted.length} feature에 영향:\n`);
  for (const it of impacted) {
    log(`  ${it.id} · ${it.title}  [depth=${it.depth}, via=${it.via}]`);
    if (it.files && it.files.length) log(`    files: ${it.files.join(', ')}`);
    if (it.errorModes && it.errorModes.length) log(`    error-modes: ${it.errorModes.join(', ')}`);
  }
  log(`\n💡 코드 변경 전 위 ${impacted.length}개 feature의 테스트/계약 확인 권장`);
}
function featureListCmd(root, deps = {}) {
  const { _readFeatureGraph, has } = deps;
  root = absRoot(root);
  const { nodes } = _readFeatureGraph(root);
  if (has('--json')) {
    log(JSON.stringify({ total: nodes.length, features: nodes }, null, 2));
    return;
  }
  log(`# Features (${nodes.length}개)`);
  if (!nodes.length) {
    log('  (없음) — leerness feature add "<title>"');
    return;
  }
  for (const n of nodes) {
    log(`  ${n.id} · ${n.title}`);
    if (n.dependsOn.length) log(`    ↓ depends-on: ${n.dependsOn.join(', ')}`);
    if (n.affects.length) log(`    → affects: ${n.affects.join(', ')}`);
    if (n.coChangesWith.length) log(`    ↔ co-changes-with: ${n.coChangesWith.join(', ')}`);
  }
}
function featureShowCmd(root, fromId, deps = {}) {
  const { _readFeatureGraph, has } = deps;
  root = absRoot(root);
  const _j = has('--json');   
  if (!fromId || !/^F-\d{4,}$/.test(fromId)) return failJson(_j, 'bad_id', 'feature show: F-XXXX ID 필요');
  const { nodes } = _readFeatureGraph(root);
  const node = nodes.find(n => n.id === fromId);
  if (!node) return failJson(_j, 'not_found', `feature ${fromId} 없음`);
  if (has('--json')) { log(JSON.stringify(node, null, 2)); return; }
  log(`# ${node.id} · ${node.title}`);
  log(`  depends-on:      ${node.dependsOn.join(', ') || '(없음)'}`);
  log(`  affects:         ${node.affects.join(', ') || '(없음)'}`);
  log(`  co-changes-with: ${node.coChangesWith.join(', ') || '(없음)'}`);
  log(`  files:           ${node.files.join(', ') || '(없음)'}`);
  log(`  input:           ${node.input || '(없음)'}`);
  log(`  output:          ${node.output || '(없음)'}`);
  log(`  error-modes:     ${node.errorModes.join(', ') || '(없음)'}`);
  log(`  tests:           ${node.tests.join(', ') || '(없음)'}`);
  log(`  notes:           ${node.notes || '(없음)'}`);
}

module.exports = { featureAddCmd, featureLinkCmd, featureImpactCmd, featureListCmd, featureShowCmd };
