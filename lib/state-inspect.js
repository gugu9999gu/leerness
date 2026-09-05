'use strict';

const path = require('path');
const { resolveStatePaths } = require('./state-paths');
const { inspectLegacyInventory } = require('./state-inventory');

function inspectState(root, options = {}) {
  const resolved = resolveStatePaths(root, options);
  // Legacy project memory and canonical runtime/substrate can coexist. Selection
  // determines the project reader, not whether residual state exists elsewhere.
  const locations = [...new Set([resolved.workspace.selectedPath, ...resolved.workspace.detectedPaths])];
  const inventory = locations.flatMap(workspacePath => inspectLegacyInventory(workspacePath).map(row => ({
    ...row, workspacePath, selectedWorkspace: workspacePath === resolved.workspace.selectedPath,
  })));
  return { ...resolved, schema: 'leerness.state-inspection/v1', ok: true,
    inventory };
}

function formatStateInspection(report, language = 'en') {
  const ko = language === 'ko';
  const lines = [ko ? 'Leerness 상태 범위 진단 (읽기 전용)' : 'Leerness state scopes (read-only)',
    `${ko ? '프로젝트' : 'Project'}: ${report.projectRoot}`,
    `${ko ? '현재 저장소' : 'Current workspace'}: ${report.workspace.selectedPath} (${report.workspace.status})`,
    ko ? '기존 배치 유지 · runtime 활성화 안 됨 · 마이그레이션 미구현'
      : 'Legacy layout retained; runtime NOT activated; migration NOT implemented.', '',
    ko ? '제안 경로 (생성/이동하지 않음):' : 'Proposed paths (nothing created or moved):'];
  for (const value of Object.values(report.scopes)) {
    const paths = value.proposedPaths || { path: value.proposedPath };
    for (const [name, target] of Object.entries(paths)) {
      lines.push(`  ${value.scope}${name === 'path' ? '' : ` / ${name}`}: ${target || (ko ? '사용 불가 (Git 없음)' : 'unavailable (non-Git)')}`);
    }
  }
  lines.push('', ko ? '기존 상태 목록 (내용/하위 폴더는 읽지 않음):' : 'Legacy inventory (no contents or recursive traversal):');
  for (const row of report.inventory) lines.push(`  ${path.basename(row.workspacePath)}/${row.relativePath}: ${row.metadata.status} -> ${row.proposedScope}`);
  if (report.warnings.length) lines.push(`\n${ko ? '주의' : 'Warnings'}: ${report.warnings.join(', ')}`);
  return lines.join('\n');
}

module.exports = { inspectState, formatStateInspection };
