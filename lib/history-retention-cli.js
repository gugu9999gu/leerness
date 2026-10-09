'use strict';
const path = require('path');
const W = require('./history-retention-write');
const ACTIONS = new Set(['preview', 'apply', 'preview-restore', 'restore', 'preview-recover', 'recover', 'status']);
const VALUES = new Set(['--path', '--tasks', '--reason', '--expect', '--operation']);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
function run(argv, io = process, authorize = () => true) {
  const asJson = argv.includes('--json');
  try {
    const [action, ...args] = argv, options = {};
    if (!ACTIONS.has(action)) fail('history_command_invalid', 'Use context history preview, apply, preview-restore, restore, status, preview-recover or recover.');
    for (let i = 0; i < args.length; i++) {
      const flag = args[i];
      if (Object.hasOwn(options, flag)) fail('history_option_invalid', `Supply ${flag} once.`);
      if (flag === '--json' || flag === '--dry-run') { options[flag] = true;continue; }
      if (!VALUES.has(flag) || !args[i + 1] || args[i + 1].startsWith('--')) fail('history_option_invalid', `Unknown option or missing value: ${flag}`);
      options[flag] = args[++i];
    }
    const specific = ['preview', 'apply'].includes(action) ? ['--tasks', '--reason'] : action === 'status' ? [] : ['--operation'];
    const mutates = ['apply', 'restore', 'recover'].includes(action);
    const allowed = new Set(['--path', '--json', '--dry-run', ...specific, ...(mutates ? ['--expect'] : [])]);
    for (const flag of Object.keys(options)) if (!allowed.has(flag)) fail('history_option_invalid', `${flag} does not apply to ${action}.`);
    if (mutates && options['--dry-run']) fail('history_preview_required', 'Use the matching preview command; applying history in --dry-run is unsupported.');
    const root = path.resolve(options['--path'] || process.cwd());
    if (mutates && !authorize(root)) fail('history_policy_blocked', 'Project-write permission is required for this explicit history operation.');
    const selection = { tasks: options['--tasks'] === undefined ? undefined : options['--tasks'].split(','), reason: options['--reason'], expected: options['--expect'] };
    const operation = { operationId: options['--operation'], expected: options['--expect'] };
    const result = action === 'preview' ? W.preview(root, selection)
      : action === 'apply' ? W.apply(root, selection)
        : action === 'preview-restore' ? W.previewRestore(root, operation.operationId)
          : action === 'restore' ? W.restore(root, operation)
            : action === 'preview-recover' ? W.previewRecover(root, operation.operationId)
              : action === 'recover' ? W.recover(root, operation) : W.status(root);
    if (asJson) io.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      io.stdout.write(`History ${result.state || result.action}: ${result.operationId || 'none'}\n`);
      if (result.tasks) for (const task of result.tasks) io.stdout.write(typeof task === 'string' ? `- ${task}\n` : `- ${task.id} (${task.status}): ${task.request}\n`);
      if (result.bytes) io.stdout.write(`Active tracker: ${result.bytes.activeBefore} -> ${result.bytes.activeAfter} bytes. Original retained: ${result.bytes.retainedOriginal} bytes.\n`);
      if (result.expected) io.stdout.write(`Expected preview digest: ${result.expected}\n`);
      io.stdout.write((result.note || result.next) + '\n');
    }
    if (!result.ok) io.exitCode = 1;
    return result;
  } catch (error) {
    const result = { ok: false, code: error.code === 'E_RUNTIME_LAYOUT_INCOMPATIBLE' ? 'runtime_layout_incompatible' : error.code || 'history_unavailable', message: error.message,
      ...(error.operationId ? { operationId: error.operationId } : {}), ...(error.recovery ? { recovery: error.recovery } : {}) };
    io.stdout.write(asJson ? JSON.stringify(result, null, 2) + '\n' : `${result.code}: ${result.message}\n${result.recovery || ''}\n`);
    io.exitCode = 1;return result;
  }
}
module.exports = { run };
