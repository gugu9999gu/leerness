'use strict';
const service = require('./context-packet');
const USAGE = 'leerness context packet [--path DIR] [--task ID] [--with-memory] [--memory-query TEXT] [--json]\n'
  + 'leerness context source --id ID --revision SHA256 [--offset BYTES] [--path DIR] [--json]\n'
  + 'Returns compact JSON, at most 8192 UTF-8 bytes including the newline. Sources are exact base64 byte pages.\n';
const invalid = () => { throw Object.assign(new Error('Invalid context options.'), { code: 'invalid_arguments' }); };
function evaluate(operation, args, defaultRoot = process.cwd(), authorize = null) {
  try {
    if (!['packet', 'source'].includes(operation) || !args || typeof args !== 'object' || Array.isArray(args)) invalid();
    const allowed = operation === 'packet' ? ['path', 'task', 'includeMemory', 'memoryQuery'] : ['path', 'id', 'revision', 'offset'];
    if (Reflect.ownKeys(args).some(key => !allowed.includes(key))) invalid();
    for (const key of Object.keys(args)) {
      const descriptor = Object.getOwnPropertyDescriptor(args, key);
      if (!Object.hasOwn(descriptor, 'value') || (key === 'includeMemory' ? typeof descriptor.value !== 'boolean' : key === 'offset' ? !Number.isSafeInteger(descriptor.value) || descriptor.value < 0
        : typeof descriptor.value !== 'string' || !descriptor.value.trim())) invalid();
    }
    const root = Object.hasOwn(args, 'path') ? args.path : defaultRoot;
    if (authorize && !authorize(root)) throw Object.assign(new Error('Policy blocked.'), { code: 'policy_blocked' });
    if (operation === 'packet') return service.currentPacket(root, { task: args.task ?? null, includeMemory: args.includeMemory ?? Object.hasOwn(args, 'memoryQuery'), memoryQuery: args.memoryQuery ?? null });
    return service.exactSource(root, { id: args.id, revision: args.revision, offset: args.offset ?? 0 });
  } catch (error) { return service.failure(error); }
}
function mcpResult(operation, args, root) {
  const response = evaluate(operation, args, root);
  return { content: [{ type: 'text', text: JSON.stringify(response) }], isError: !response.ok };
}
function runCli(argv, output = process.stdout, authorize = null) {
  if (argv.length === 2 && ['packet', 'source'].includes(argv[0]) && ['--help', '-h'].includes(argv[1])) {
    output.write(USAGE); return 0;
  }
  let response;
  try {
    const operation = argv[0], args = {}, seen = new Set();
    const values = operation === 'packet' ? ['--path', '--task', '--memory-query'] : ['--path', '--id', '--revision', '--offset'];
    for (let i = 1; i < argv.length; i++) {
      const flag = argv[i];
      if (seen.has(flag)) invalid();
      seen.add(flag);
      if (flag === '--json') continue;
      if (flag === '--with-memory' && operation === 'packet') { args.includeMemory = true; continue; }
      if (!values.includes(flag) || !argv[i + 1] || argv[i + 1].startsWith('--')) invalid();
      const value = argv[++i];
      if (flag === '--offset' && !/^(?:0|[1-9][0-9]*)$/.test(value)) invalid();
      args[flag === '--memory-query' ? 'memoryQuery' : flag.slice(2)] = flag === '--offset' ? Number(value) : value;
    }
    response = evaluate(operation, args, process.cwd(), authorize);
  } catch (error) { response = service.failure(error); }
  output.write(JSON.stringify(response) + '\n');
  return response.ok ? 0 : 1;
}
module.exports = { evaluate, mcpResult, runCli, USAGE };
