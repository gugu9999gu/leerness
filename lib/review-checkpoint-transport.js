'use strict';

// RB-01 transport only. All grouping/risk decisions stay in review-checkpoint.js.
const fs = require('node:fs');
const { TextDecoder } = require('node:util');
const {
  MAX_BYTES, ReviewCheckpointInputError, assessReviewCheckpoint,
} = require('./review-checkpoint');

const RESPONSE_SCHEMA = 'leerness.review-checkpoint-response/v1';
const MAX_OUTPUT_BYTES = 65536;
const STDIN_TIMEOUT_MS = 5000;
const USAGE = 'Usage: leerness review-checkpoint assess --stdin [--json]\n'
  + 'Reads one UTF-8 JSON document (maximum 65536 bytes) from stdin.\n'
  + 'Advisory only: no model invocation, project writes, or approval.\n';

class TransportError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function reject(code) { throw new TransportError(code); }
function failure(code, field = '$') {
  return { schema: RESPONSE_SCHEMA, ok: false, advisoryOnly: true,
    error: { code, field, message: 'Review checkpoint input could not be assessed; no approval was granted.' } };
}
function safeError(error) {
  if (error instanceof TransportError) return failure(error.code);
  if (error instanceof ReviewCheckpointInputError) return failure(error.code, error.field);
  return failure('assessment_failed');
}

// JSON.parse establishes grammar; this bounded second pass detects duplicate raw
// object keys, including escaped-equivalent spellings, before domain validation.
// No value/key from an invalid document is copied into an error response.
function assertUniqueKeys(text) {
  let index = 0;
  let nodes = 0;
  const whitespace = () => { while (/^[\x20\t\r\n]$/.test(text[index] || '')) index++; };
  function string() {
    const start = index++;
    while (index < text.length) {
      const c = text[index++];
      if (c === '\\') index++;
      else if (c === '"') return JSON.parse(text.slice(start, index));
    }
    reject('invalid_json');
  }
  function value(depth) {
    if (depth > 16 || ++nodes > 10000) reject('input_structure_limit');
    whitespace();
    if (text[index] === '{') {
      index++; whitespace();
      const keys = new Set();
      if (text[index] === '}') { index++; return; }
      while (index < text.length) {
        whitespace();
        const key = string();
        if (keys.has(key)) reject('duplicate_json_key');
        keys.add(key);
        whitespace(); index++; // colon; syntax already checked by JSON.parse
        value(depth + 1); whitespace();
        if (text[index++] === '}') return;
      }
    } else if (text[index] === '[') {
      index++; whitespace();
      if (text[index] === ']') { index++; return; }
      let count = 0;
      while (index < text.length) {
        if (++count > 1000) reject('input_structure_limit');
        value(depth + 1); whitespace();
        if (text[index++] === ']') return;
      }
    } else if (text[index] === '"') string();
    else {
      while (index < text.length && !/[\x20\t\r\n,\]}]/.test(text[index])) index++;
    }
  }
  value(0);
}

function parseInputJson(text) {
  if (typeof text !== 'string') reject('input_json_required');
  if (text.length > MAX_BYTES || Buffer.byteLength(text, 'utf8') > MAX_BYTES) reject('input_too_large');
  if (text.charCodeAt(0) === 0xFEFF) reject('utf8_bom_not_allowed');
  let input;
  try { input = JSON.parse(text); } catch { reject('invalid_json'); }
  assertUniqueKeys(text);
  return input;
}

function assessReviewCheckpointJson(text) {
  try {
    const assessment = assessReviewCheckpoint(parseInputJson(text));
    const result = { schema: RESPONSE_SCHEMA, ok: true, advisoryOnly: true, assessment };
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_OUTPUT_BYTES) reject('output_too_large');
    return result;
  } catch (error) { return safeError(error); }
}

function validateMcpArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'invalid_arguments';
  const keys = Reflect.ownKeys(args);
  if (keys.length !== 1 || keys[0] !== 'inputJson') return 'input_json_only';
  const descriptor = Object.getOwnPropertyDescriptor(args, 'inputJson');
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') return 'input_json_required';
  return null;
}
function mcpResult(args) {
  const invalid = validateMcpArgs(args);
  const result = invalid ? failure(invalid) : assessReviewCheckpointJson(args.inputJson);
  // Keep the whole bounded JSON response. The generic MCP pagination would cut
  // JSON mid-document and needlessly repeat the assessment to fetch a page.
  return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: !result.ok };
}

// One set of rules for every JSON input: no byte-order mark, and fatal decoding so invalid byte sequences are never
// silently replaced.
function decodeJsonBytes(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) reject('utf8_bom_not_allowed');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return reject('invalid_utf8'); }
}
// The same input from a file, for shells without input redirection (PowerShell has no `<`; cross-model review
// 2026-09-30, round 2). Same size limit and decoding as stdin. Round 3: checking the path and then reading it read
// whatever the path held by then, in full (a file that grew or was replaced after the check); a FIFO blocked the
// read. The checks and the read now use one descriptor: opened without blocking, a regular file only, and at most
// MAX_BYTES + 1 bytes read whatever size it reports.
function readJsonFile(file) {
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0)); } catch { reject('input_file_unreadable'); }
  try {
    let st;
    try { st = fs.fstatSync(fd); } catch { reject('input_file_unreadable'); }
    if (!st.isFile()) reject('input_file_unreadable');
    if (st.size > MAX_BYTES) reject('input_too_large');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    for (;;) {
      let n;
      try { n = fs.readSync(fd, buffer, size, buffer.length - size, null); } catch { reject('input_file_unreadable'); }
      if (!n) break;
      size += n;
      if (size > MAX_BYTES) reject('input_too_large');
    }
    return decodeJsonBytes(buffer.subarray(0, size));
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

function readJsonStdin(stream, timeoutMs = STDIN_TIMEOUT_MS) {
  return new Promise((resolve, rejectPromise) => {
    if (stream.isTTY) return rejectPromise(new TransportError('stdin_pipe_required'));
    let settled = false;
    let size = 0;
    const chunks = [];
    let timer;
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      stream.removeListener('close', onClose);
      stream.pause();
      if (error) {
        stream.destroy();
        return rejectPromise(error);
      }
      try {
        resolve(decodeJsonBytes(Buffer.concat(chunks, size)));
      } catch (decodeError) {
        rejectPromise(decodeError instanceof TransportError ? decodeError : new TransportError('invalid_utf8'));
      }
    }
    function onData(chunk) {
      if (!Buffer.isBuffer(chunk)) return finish(new TransportError('stdin_binary_required'));
      size += chunk.length;
      if (size > MAX_BYTES) return finish(new TransportError('input_too_large'));
      chunks.push(chunk);
    }
    function onEnd() { finish(); }
    function onError() { finish(new TransportError('stdin_read_failed')); }
    function onClose() { finish(new TransportError('stdin_closed_early')); }
    timer = setTimeout(() => finish(new TransportError('stdin_timeout')), timeoutMs);
    stream.on('error', onError);
    stream.on('end', onEnd);
    stream.on('close', onClose);
    stream.on('data', onData);
  });
}

async function runCli(argv, input = process.stdin, output = process.stdout) {
  const write = text => new Promise((resolve, rejectPromise) => {
    const onError = error => rejectPromise(error);
    output.once('error', onError);
    output.write(text, error => {
      // On failure, Writable emits error after invoking this callback. Retain
      // the once listener for that event so a broken pipe is not an uncaught error.
      if (error) rejectPromise(error);
      else { output.removeListener('error', onError); resolve(); }
    });
  });
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    await write(USAGE);
    return 0;
  }
  const flags = argv.slice(1);
  const valid = argv[0] === 'assess' && flags.includes('--stdin')
    && flags.every(flag => flag === '--stdin' || flag === '--json')
    && new Set(flags).size === flags.length;
  let result;
  if (!valid) result = failure('invalid_cli_arguments');
  else {
    try { result = assessReviewCheckpointJson(await readJsonStdin(input)); }
    catch (error) { result = safeError(error); }
  }
  await write(JSON.stringify(result) + '\n');
  // Success means assessment completed, not that the requested work is approved.
  return result.ok ? 0 : 2;
}

module.exports = {
  RESPONSE_SCHEMA, MAX_OUTPUT_BYTES, STDIN_TIMEOUT_MS, USAGE,
  TransportError, assertUniqueKeys, parseInputJson, assessReviewCheckpointJson, validateMcpArgs, mcpResult, readJsonStdin, readJsonFile, decodeJsonBytes, runCli,
};
