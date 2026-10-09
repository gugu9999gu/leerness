'use strict';

const { failure, inspectMemoryMigration } = require('./memory-migration-observe');
const USAGE = 'Usage: leerness memory-migration inspect decisions|lessons [--path <project>] [--json]\n'
  + 'Read-only migration candidate metadata. No source payload, migration or approval.\n';

function validateMcpArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'invalid_arguments';
  const keys = Reflect.ownKeys(args);
  if (!keys.includes('surface') || keys.some(key => !['surface', 'path'].includes(key))) return 'invalid_arguments';
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(args, key);
    if (!property || !Object.hasOwn(property, 'value') || typeof property.value !== 'string'
      || !property.value || property.value.includes('\0') || property.value.length > 32768) return 'invalid_arguments';
  }
  return ['decisions', 'lessons'].includes(args.surface) ? null : 'invalid_arguments';
}
function mcpResult(args, defaultRoot = process.cwd()) {
  const invalid = validateMcpArgs(args);
  const response = invalid ? failure(invalid)
    : inspectMemoryMigration(Object.hasOwn(args, 'path') ? args.path : defaultRoot, args.surface);
  return { content: [{ type: 'text', text: JSON.stringify(response) }], isError: !response.ok };
}
function cliResult(argv, defaultRoot = process.cwd()) {
  if (argv[0] !== 'inspect' || !['decisions', 'lessons'].includes(argv[1])) return failure('invalid_cli_arguments');
  let root = defaultRoot;
  const seen = new Set();
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag) || !['--path', '--json'].includes(flag)) return failure('invalid_cli_arguments');
    seen.add(flag);
    if (flag === '--path') {
      root = argv[++i];
      if (typeof root !== 'string' || !root || root.startsWith('--')) return failure('invalid_cli_arguments');
    }
  }
  return inspectMemoryMigration(root, argv[1]);
}
function runCli(argv, output = process.stdout) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) { output.write(USAGE); return 0; }
  const result = cliResult(argv);
  output.write(JSON.stringify(result) + '\n');
  return result.ok ? 0 : 2;
}

module.exports = { USAGE, validateMcpArgs, mcpResult, cliResult, runCli };
