'use strict';

const fs = require('fs');
const path = require('path');
const { readJsonStdin, readJsonFile } = require('./review-checkpoint-transport');
const C = require('./review-feedback-contract');
const F = require('./review-feedback');
const USAGE = 'Usage: leerness review-feedback start|submit --stdin|--file FILE [--path PROJECT] [--json] [--language ko|en]\n'
  + '       leerness review-feedback show REVIEW-ID [--path PROJECT] [--json] [--language ko|en]\n'
  + 'Start freezes a named reviewer, scope, criteria and maxRounds (1..10; suggested 3), or with the v2 schema an\n'
  + 'ordered list of stages (for example a first and a final reviewer), each with its reviewer and maxRounds.\n'
  + 'Submit records declared feedback, not authenticated model execution or approval.\n'
  + '--file reads the same JSON from FILE (relative to the current directory) instead of stdin.\n'
  + 'Every output shows what GO still needs; JSON adds result.goRoute and result.nextRoundTemplate.\n';
const { summarize } = require('./review-feedback-report');
// Same order as the CLI's UI language (bin/leerness.js _uiLang): --language, LEERNESS_LANG, the project manifest,
// then Korean. This command runs before the CLI bootstrap, so it resolves the language itself.
function uiLanguage(root, flag) {
  if (flag === 'en' || flag === 'ko') return flag;
  const env = String(process.env.LEERNESS_LANG || '').toLowerCase();
  if (env === 'en' || env === 'ko') return env;
  try {
    // Strip a byte-order mark as the CLI's reader does: JSON.parse throws on one, and an English manifest saved by
    // an editor that adds it made review output Korean (cross-model review 2026-09-30).
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
    const op = argv[0]; let root = process.cwd(), json = false, stdin = false, file = null, reviewId, language = null;
    const seen = new Set();
    for (let i = 1; i < argv.length; i++) {
      const flag = argv[i];
      if (flag === '--path' || flag === '--json' || flag === '--stdin' || flag === '--file' || flag === '--language') {
        if (seen.has(flag)) C.fail('feedback_cli_arguments'); seen.add(flag);
        if (flag === '--path') { root = argv[++i]; if (!root || root.startsWith('--')) C.fail('feedback_cli_arguments'); }
        if (flag === '--json') json = true;
        if (flag === '--stdin') stdin = true;
        if (flag === '--file') { file = argv[++i]; if (!file || file.startsWith('--')) C.fail('feedback_cli_arguments'); }
        if (flag === '--language') { language = argv[++i]; if (!['ko', 'en'].includes(language)) C.fail('feedback_cli_arguments'); }
      } else if (op === 'show' && !reviewId && !flag.startsWith('-')) reviewId = flag;
      else C.fail('feedback_cli_arguments');
    }
    if (!['start', 'submit', 'show'].includes(op) || (op === 'show' ? !reviewId || stdin || file : stdin === !!file)) C.fail('feedback_cli_arguments');
    const state = op === 'show' ? F.show(root, reviewId) : F[op](root, file ? readJsonFile(path.resolve(process.cwd(), file)) : await readJsonStdin(input));
    result = json ? JSON.stringify({ ok: true, result: state }) + '\n' : summarize(state, uiLanguage(root, language));
    // FAIL/NEEDS_DECISION must stop a shell-driven loop, even though storage succeeded.
    code = ['FAIL', 'NEEDS_DECISION'].includes(state.status) ? 1 : 0;
  } catch (error) {
    result = JSON.stringify({ ok: false, error: { code: error.code || 'feedback_failed' }, approvalGranted: false }) + '\n';
  }
  await new Promise((resolve, reject) => { output.once('error', reject); output.write(result, error => error ? reject(error) : resolve()); });
  return code;
}
module.exports = { runCli, summarize, uiLanguage, USAGE };
