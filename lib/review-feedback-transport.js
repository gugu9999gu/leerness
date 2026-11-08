'use strict';

const fs = require('fs');
const path = require('path');
const { readJsonStdin, readJsonFile, TransportError } = require('./review-checkpoint-transport');
const C = require('./review-feedback-contract');
const F = require('./review-feedback');
const USAGE = 'Usage: leerness review-feedback start|submit|resume --stdin|--file FILE [--path PROJECT] [--json] [--language ko|en]\n'
  + '       leerness review-feedback show REVIEW-ID [--path PROJECT] [--json] [--language ko|en] [--brief]\n'
  + '--brief prints only what a re-review needs: open findings, fixed criteria, latest checks, decisions and the last reviewed\n'
  + 'revision; resolved findings and earlier rounds are named, not repeated (show --json keeps the full history).\n'
  + 'Start freezes a named reviewer, scope, criteria and maxRounds (1..10; suggested 3), or with the v2 schema an\n'
  + 'ordered list of stages (for example a first and a final reviewer), each with its reviewer and maxRounds.\n'
  + 'Submit records declared feedback, not authenticated model execution or approval.\n'
  + 'Resume records a caller-declared owner decision for one more review within the frozen budget; it does not authenticate the owner.\n'
  + 'Use show --json result.nextResumeTemplate; staged decisions also require the current stageId.\n'
  + 'Budget exhaustion and scope-changing serious risks cannot be waived by resume.\n'
  + 'A successful resume keeps NEEDS_DECISION/NO GO and returns exit 1; use --json and inspect ok and result.\n'
  + 'Resume JSON: {"schema":"leerness.review-feedback-resume/v1","reviewId":"...","taskId":"...",\n'
  + '  "contractDigest":"sha256:...","expectedRound":1,"lastRoundId":"...","stopReasons":["verification-incomplete"],\n'
  + '  "decisionId":"...","decisionSource":"source of owner decision","evidence":["decision evidence reference"]}.\n'
  + '--file reads the same JSON from FILE (relative to the current directory) instead of stdin.\n'
  + 'Every output shows what GO still needs; JSON adds result.goRoute and result.nextRoundTemplate.\n';
const { summarize, brief, renderBrief } = require('./review-feedback-report');
// A refused operation is either the caller's input breaking the contract or the tool itself (ledger, history, I/O)
// failing. Neither is evidence about the product under review.
function errorKind(error) {
  if (error instanceof TransportError) return 'rejected';
  if (!(error instanceof C.ReviewFeedbackError)) return 'tool-error';
  return error.source === 'history' || error.code === 'feedback_history_unavailable' ? 'tool-error' : 'rejected';
}
 
 
function uiLanguage(root, flag) {
  if (flag === 'en' || flag === 'ko') return flag;
  const env = String(process.env.LEERNESS_LANG || '').toLowerCase();
  if (env === 'en' || env === 'ko') return env;
  try {
     
     
    const raw = fs.readFileSync(path.join(root, '.leerness', 'manifest.json'), 'utf8');
    const l = String((JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw) || {}).language || '').toLowerCase();
    if (l === 'en' || l === 'ko') return l;
  } catch {}
  return 'ko';
}
async function runCli(argv, input = process.stdin, output = process.stdout) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) { output.write(USAGE); return 0; }
  let result, code = 2;
  try {
    const op = argv[0]; let root = process.cwd(), json = false, stdin = false, file = null, reviewId, language = null, short = false;
    const seen = new Set();
    for (let i = 1; i < argv.length; i++) {
      const flag = argv[i];
      if (flag === '--path' || flag === '--json' || flag === '--stdin' || flag === '--file' || flag === '--language' || flag === '--brief') {
        if (seen.has(flag)) C.fail('feedback_cli_arguments'); seen.add(flag);
        if (flag === '--path') { root = argv[++i]; if (!root || root.startsWith('--')) C.fail('feedback_cli_arguments'); }
        if (flag === '--json') json = true;
        if (flag === '--brief') short = true;
        if (flag === '--stdin') stdin = true;
        if (flag === '--file') { file = argv[++i]; if (!file || file.startsWith('--')) C.fail('feedback_cli_arguments'); }
        if (flag === '--language') { language = argv[++i]; if (!['ko', 'en'].includes(language)) C.fail('feedback_cli_arguments'); }
      } else if (op === 'show' && !reviewId && !flag.startsWith('-')) reviewId = flag;
      else C.fail('feedback_cli_arguments');
    }
    if (!['start', 'submit', 'resume', 'show'].includes(op) || (op === 'show' ? !reviewId || stdin || file : stdin === !!file || short)) C.fail('feedback_cli_arguments');
    const state = op === 'show' ? F.show(root, reviewId) : F[op](root, file ? readJsonFile(path.resolve(process.cwd(), file)) : await readJsonStdin(input));
    if (short) result = json ? JSON.stringify({ ok: true, result: brief(state) }) + '\n' : renderBrief(state, uiLanguage(root, language));
    else result = json ? JSON.stringify({ ok: true, result: state }) + '\n' : summarize(state, uiLanguage(root, language));
     
    code = ['FAIL', 'NEEDS_DECISION'].includes(state.status) ? 1 : 0;
  } catch (error) {
    result = JSON.stringify({ ok: false, error: { code: error.code || 'feedback_failed', kind: errorKind(error) }, approvalGranted: false }) + '\n';
  }
  await new Promise((resolve, reject) => { output.once('error', reject); output.write(result, error => error ? reject(error) : resolve()); });
  return code;
}
module.exports = { runCli, summarize, uiLanguage, USAGE };
