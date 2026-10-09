'use strict';

const { runMigration, response } = require('./memory-migration-write');
const { OPERATION_ID } = require('./memory-migration-material');
const ACTIONS = ['prepare', 'apply', 'rollback'], SURFACES = ['decisions', 'lessons'];
const USAGE = 'memory-migration prepare decisions|lessons --confirm [--path <project>] [--json]\n'
  + 'memory-migration apply|rollback decisions|lessons <operation-id> --confirm [--path <project>] [--json]\n';
function invalid() {
  return response({ action: null, surface: null, operationId: null, stage: 'arguments',
    retentionVerified: false, retentionMayExist: false, activeMutationStarted: false }, false, 'migration_arguments_invalid');
}
function parseArguments(argv, defaultRoot = process.cwd()) {
  const [action, surface] = argv;
  if (!ACTIONS.includes(action) || !SURFACES.includes(surface)) return null;
  const operationId = action === 'prepare' ? null : argv[2];
  if (action !== 'prepare' && !OPERATION_ID.test(operationId || '')) return null;
  const seen = new Set(); let root = defaultRoot;
  for (let i = action === 'prepare' ? 2 : 3; i < argv.length; i++) {
    const flag = argv[i];
    if (!['--path', '--json', '--confirm'].includes(flag) || seen.has(flag)) return null;
    seen.add(flag);
    if (flag === '--path') {
      root = argv[++i];
      if (typeof root !== 'string' || !root || root.startsWith('--') || root.includes('\0') || root.length > 32768) return null;
    }
  }
  return seen.has('--confirm') ? { root, action, surface, operationId } : null;
}
function runCli(argv, dependencies, output = process.stdout) {
  const args = parseArguments(argv);
  const result = args ? runMigration(args.root, args.action, args.surface, args.operationId, dependencies) : invalid();
  output.write(JSON.stringify(result) + '\n'); return result.ok ? 0 : 2;
}
module.exports = { USAGE, parseArguments, runCli, invalid };
