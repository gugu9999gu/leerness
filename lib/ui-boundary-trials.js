'use strict';

const { parseInputJson } = require('./review-checkpoint-transport');
const { POLICY_VERSION, TAXONOMY } = require('./ui-boundary');
const INPUT_SCHEMA = 'leerness.ui-boundary-trials/v1';
const OUTPUT_SCHEMA = 'leerness.ui-boundary-trial-summary/v1';
const MAX_TRIALS = 128;
const SUBTYPES = Object.values(TAXONOMY);
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const digest = value => typeof value==='string' && DIGEST.test(value);
class UiBoundaryTrialError extends Error {
  constructor() { super('ui_boundary_trials_invalid'); this.name='UiBoundaryTrialError'; this.code='ui_boundary_trials_invalid'; }
}
function check(value) { if (!value) throw new UiBoundaryTrialError(); }
function exact(value, keys) {
  check(value && typeof value==='object' && !Array.isArray(value)
    && Object.keys(value).length===keys.length && keys.every(k=>Object.hasOwn(value,k)));
}
function observation(value) {
  exact(value,['state','findings','digest']);
  check(['observed','partial','stale','failed'].includes(value.state));
  if (['observed','partial'].includes(value.state)) {
    check(Number.isInteger(value.findings) && value.findings>=0 && value.findings<=4096 && digest(value.digest));
  } else check(value.findings===null && value.digest===null);
}
const ratio = (a,b) => b ? a/b : null;

function summarizeUiBoundaryTrials(inputJson) {
  let input;
  try { input=parseInputJson(inputJson); } catch { throw new UiBoundaryTrialError(); }
  exact(input,['schema','policyVersion','fixtureDigest','trials']);
  check(input.schema===INPUT_SCHEMA && input.policyVersion===POLICY_VERSION && digest(input.fixtureDigest));
  check(Array.isArray(input.trials) && input.trials.length>0 && input.trials.length<=MAX_TRIALS);
  const ids=new Set();
  for(const trial of input.trials) {
    exact(trial,['id','expected','subtype','before','after','repair']);
    check(typeof trial.id==='string' && /^[a-z][a-z0-9-]{0,63}$/.test(trial.id) && !ids.has(trial.id));ids.add(trial.id);
    check(['leakage','allowed'].includes(trial.expected));
    check(trial.expected==='leakage' ? SUBTYPES.includes(trial.subtype) : trial.subtype===null);
    observation(trial.before);
    check((trial.after===null)===(trial.repair===null));
    if(trial.after!==null) {
      check(trial.expected==='leakage');observation(trial.after);
      exact(trial.repair,['kind','attempts','elapsedMs']);
      check(trial.repair.kind==='fixture-repair' && Number.isInteger(trial.repair.attempts)
        && trial.repair.attempts>=1 && trial.repair.attempts<=100);
      check(trial.repair.elapsedMs===null || Number.isSafeInteger(trial.repair.elapsedMs)
        && trial.repair.elapsedMs>=0 && trial.repair.elapsedMs<=86400000);
    }
  }
  const matrix={tp:0,fp:0,tn:0,fn:0,unscored:0};
  const bySubtype=Object.fromEntries(SUBTYPES.map(k=>[k,{detected:0,missed:0,unscored:0}]));
  const repairs={trials:0,attempts:0,knownTimingTrials:0,elapsedMs:0,unknownTimingTrials:0,
    eligibleDetectedTrials:0,candidatesCleared:0,stillCandidates:0,unscoredAfter:0};
  const results=[];
  for(const t of input.trials) {
    const positive=t.expected==='leakage';
    const outcome=t.before.state!=='observed' ? 'unscored'
      : t.before.findings>0 ? positive?'tp':'fp' : positive?'fn':'tn';
    matrix[outcome]++;
    if(positive) bySubtype[t.subtype][outcome==='unscored'?'unscored':outcome==='tp'?'detected':'missed']++;
    if(t.repair) {
      repairs.trials++;repairs.attempts+=t.repair.attempts;
      if(t.repair.elapsedMs===null)repairs.unknownTimingTrials++;
      else {repairs.knownTimingTrials++;repairs.elapsedMs+=t.repair.elapsedMs;}
      // Only an initially detected positive with a fully observed after-state
      // belongs in the candidate-removal denominator. A missed leak is not fixed
      // merely because the scanner still sees no candidates after a repair.
      if(outcome==='tp') {
        if(t.after.state!=='observed')repairs.unscoredAfter++;
        else {
          repairs.eligibleDetectedTrials++;
          if(t.after.findings===0)repairs.candidatesCleared++;else repairs.stillCandidates++;
        }
      }
    }
    results.push({id:t.id,outcome});
  }
  return {schema:OUTPUT_SCHEMA,policyVersion:POLICY_VERSION,fixtureDigest:input.fixtureDigest,
    basis:'host-labelled-fixture-trials',unit:'scenario-presence-not-observation-count',
    trialCount:input.trials.length,matrix,bySubtype,
    rates:{precision:ratio(matrix.tp,matrix.tp+matrix.fp),recall:ratio(matrix.tp,matrix.tp+matrix.fn),
      falsePositiveRate:ratio(matrix.fp,matrix.fp+matrix.tn)},
    repairs:{...repairs,candidateRemovalRate:ratio(repairs.candidatesCleared,repairs.eligibleDetectedTrials)},results,
    verification:{labelsVerified:false,observationProvenanceVerified:false,semanticFixVerified:false,independentReview:'not-run'},
    effects:{approvalGranted:false,autoRemove:false}};
}
module.exports={summarizeUiBoundaryTrials,UiBoundaryTrialError,INPUT_SCHEMA,OUTPUT_SCHEMA,MAX_TRIALS};
