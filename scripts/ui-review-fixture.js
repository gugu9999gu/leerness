'use strict';

const { createUiReviewPacket: create, INPUT_SCHEMA,
  RECEIPT_SCHEMA, POLICY_VERSION, SUBTYPES } = require('../lib/ui-review');
const { createUiBoundaryTask, REVIEW_SCHEMA } = require('../lib/ui-boundary-contracts');
const { INPUT_SCHEMA: SNAPSHOT_INPUT, MATERIAL_SCHEMA } = require('../lib/review-snapshot');
const hash = c => 'sha256:' + c.repeat(64);
const clone = v => JSON.parse(JSON.stringify(v));
const encode = v => JSON.stringify(v);
const identity = (provider = 'provider-a', model = 'gpt-unit-v1', sessionId = 'session-implementation') => ({ provider, model, sessionId });
function fixture() {
  return { schema: INPUT_SCHEMA, policyVersion: POLICY_VERSION,
    snapshot: { schema: SNAPSHOT_INPUT,
      batch: { id: 'batch-ui', revision: 1, objectiveRevision: 'criteria-1', policyRevision: 'policy-1' },
      materials: { schema: MATERIAL_SCHEMA, manifestDigest: hash('1'), acceptanceDigest: hash('2'),
        policyDigest: hash('3'), evidenceDigest: hash('4'), implementationDigest: hash('5'), dependenciesDigest: hash('6') },
      checkpoint: { schema: 'leerness.review-checkpoint-input/v1',
        objective: { id: 'O-ui', criteria: ['C-copy'] }, context: { event: 'task-report', purposeComplete: true, executionMode: 'direct' },
        snapshot: { kind: 'git', baseCommit: 'a'.repeat(40), headCommit: 'b'.repeat(40) },
        limits: { maxTasks: 100, maxFiles: 10, maxChangedLines: 400, maxWaitingHours: 24 },
        metrics: { fileCount: 2, changedLines: 20, waitingHours: 1 },
        tasks: [{ id: 'T-ui', objectiveId: 'O-ui', criteria: ['C-copy'], dependsOn: [], implementation: 'implemented',
          verification: 'passed', evidenceRefs: ['E-copy'], risk: 'normal', riskTags: [], aspects: ['ux', 'tests'], uiBoundary: createUiBoundaryTask('ui') }],
      } },
    uiMaterials: [{ taskId: 'T-ui', sourceDigest: hash('7'), specDigest: hash('8'), diffDigest: hash('9'), renderDigest: hash('a') }],
    contributors: [{ attemptId: 'implementation-1', taskIds: ['T-ui'], executor: identity() }],
  };
}
const packet = input => create(encode(input));
function receipt(input = fixture()) {
  const p = packet(input);
  return { schema: RECEIPT_SCHEMA, policyVersion: POLICY_VERSION, packetId: p.packetId,
    attemptId: 'review-1', execution: 'completed', reviewer: identity('provider-b', 'claude-unit-v1', 'session-review'),
    coverage: p.taskCoverage.flatMap(t => SUBTYPES.map(subtype => ({ taskId: t.taskId, subtype, outcome: 'no-finding', findingIndexes: [] }))),
    review: { schema: REVIEW_SCHEMA, policyVersion: POLICY_VERSION,
      taskKind: p.applicability === 'not-applicable' ? 'non-ui' : p.applicability === 'unknown' ? 'unknown' : 'ui', evidenceVerified: false, findings: [] },
  };
}
module.exports = { fixture, receipt, clone, encode, identity, packet, hash };
