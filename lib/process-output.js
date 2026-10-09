'use strict';
const crypto = require('crypto');
const MAX_OUTPUT_BYTES = 1024 * 1024;
const TAIL_CHARS = 4096;
const STOP_GRACE_MS = 250;
const ERRORS = Object.freeze({
  output_encoding_invalid: 'Process output is not valid UTF-8.',
  output_limit: 'Combined process output exceeded the byte limit.',
  output_chunk_invalid: 'Process output was decoded before the byte collector.',
  output_stream_error: 'A process output stream failed.',
  output_handler_error: 'Process output could not be consumed.',
  input_stream_error: 'The process input could not be delivered.',
  process_error: 'The child process reported an error.',
  timeout: 'The process or its output pipes exceeded the time limit.',
  process_exit: 'The child process exited unsuccessfully.',
  empty_stdout: 'No non-whitespace stdout response was received.',
});

// The hard byte cap is independent of the display tail. Never decode a buffer
// after cutting it at an arbitrary byte boundary, or guess a legacy code page.
function collectUtf8Process(child, { timeoutMs, maxBytes = MAX_OUTPUT_BYTES, graceMs = STOP_GRACE_MS,
  onText, onEnd, input } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647
      || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_OUTPUT_BYTES
      || !Number.isSafeInteger(graceMs) || graceMs < 1 || graceMs > 1000
      || (input !== undefined && !Buffer.isBuffer(input))) throw new TypeError('Invalid process collection options');
  return new Promise(resolve => {
    const state = () => ({ decoder: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }),
      hash: crypto.createHash('sha256'), bytes: 0, chars: 0, tail: '', hasText: false });
    const stdout = state(), stderr = state();
    let settled = false, errorCode = null, errorStream = null, timedOut = false;
    let executed = Number.isInteger(child.pid), exited = false, closed = false;
    let exitCode = null, signal = null, terminationRequested = false, grace;
    const ignoreError = () => {};
    function decoded(name, stream, text) {
      stream.chars += text.length;stream.hasText ||= /\S/u.test(text);
      stream.tail = (stream.tail + text).slice(-TAIL_CHARS);
      // Display truncation must not expose a lone low surrogate.
      if (/^[\uDC00-\uDFFF]/u.test(stream.tail)) stream.tail = stream.tail.slice(1);
      if (text && onText) onText(name, text);
    }
    function decode(name, stream, chunk) {
      let text;
      try { text = chunk === undefined ? stream.decoder.decode() : stream.decoder.decode(chunk, { stream: true }); }
      catch { stop('output_encoding_invalid', name);return; }
      try { decoded(name, stream, text); }
      catch { stop('output_handler_error', name); }
    }
    function finish() {
      if (settled) return;
      if (!errorCode && closed) {
        for (const [name, stream] of [['stdout', stdout], ['stderr', stderr]]) {
          decode(name, stream);
          if (errorCode) break;
        }
        if (!errorCode && onEnd) {
          try { onEnd(); } catch { stop('output_handler_error'); }
        }
      }
      settled = true;clearTimeout(timer);clearTimeout(grace);
      child.removeListener('spawn', onSpawn);child.removeListener('exit', onExit);
      child.removeListener('close', onClose);child.removeListener('error', onError);
      child.on('error', ignoreError); // Late error/close after forced settlement is not a second result.
      if (input !== undefined && child.stdin) {
        child.stdin.removeListener('error', onInputError);child.stdin.on('error', ignoreError);
        if (!closed) child.stdin.destroy();
      }
      for (const [stream, listener] of [[child.stdout, onStdout], [child.stderr, onStderr]]) {
        stream.removeListener('data', listener);stream.removeListener('error', onStreamError);
        stream.on('error', ignoreError);
        if (!closed) stream.destroy();
      }
      if (!closed && typeof child.unref === 'function') child.unref();
      const outputComplete = closed && !errorCode;
      const failure = errorCode || (exitCode !== 0 ? 'process_exit' : !stdout.hasText ? 'empty_stdout' : null);
      const tail = errorCode ? '' : stdout.tail.trim().split(/\r?\n/).slice(-3).join('\n');
      resolve({ exit: exitCode, signal, executed, ok: !failure, error: failure ? ERRORS[failure] : null,
        errorCode: failure, errorStream, timedOut, terminationRequested, terminationConfirmed: closed || exited,
        outputComplete, stdout: tail, stdoutChars: stdout.chars, stdoutBytes: stdout.bytes,
        stdoutTruncated: stdout.chars > tail.length, stderrLen: stderr.chars, stderrBytes: stderr.bytes,
        stdoutSha256: outputComplete ? stdout.hash.digest('hex') : null,
        stderrSha256: outputComplete ? stderr.hash.digest('hex') : null });
    }
    function stop(code, stream = null) {
      if (settled || errorCode) return;
      errorCode = code;errorStream = stream;timedOut = code === 'timeout';
      if (closed) return; // A final decode/consumer failure needs no second close or kill.
      terminationRequested = true;
      // Set the bound before kill: injected/portable children may close synchronously.
      grace = setTimeout(finish, graceMs);
      try { child.kill(); } catch { /* Unconfirmed termination is reported after the grace period. */ }
    }
    function receive(name, stream, chunk) {
      if (settled || errorCode) return;
      executed = true;
      if (!Buffer.isBuffer(chunk)) { stop('output_chunk_invalid', name);return; }
      stream.bytes += chunk.length;
      if (stdout.bytes + stderr.bytes > maxBytes) { stop('output_limit', name);return; }
      stream.hash.update(chunk);
      decode(name, stream, chunk);
    }
    function onSpawn() { executed = true; }
    function onExit(code, sig) { executed = true;exited = true;exitCode = code;signal = sig || null; }
    function onClose(code, sig) {
      closed = true;exitCode = code;signal = sig || signal;
      if (typeof code === 'number' && code >= 0) executed = true;
      finish();
    }
    function onError() { stop('process_error'); }
    function onStreamError() { stop('output_stream_error'); }
    function onInputError() { stop('input_stream_error', 'stdin'); }
    const onStdout = chunk => receive('stdout', stdout, chunk);
    const onStderr = chunk => receive('stderr', stderr, chunk);
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    child.on('spawn', onSpawn);child.on('exit', onExit);child.on('close', onClose);child.on('error', onError);
    child.stdout.on('data', onStdout);child.stderr.on('data', onStderr);
    child.stdout.on('error', onStreamError);child.stderr.on('error', onStreamError);
    // Attach every listener before writing, including asynchronous EPIPE failures.
    if (input !== undefined) {
      if (!child.stdin) onInputError();
      else {
        child.stdin.on('error', onInputError);
        try { child.stdin.end(input); } catch { onInputError(); }
      }
    }
  });
}

module.exports = { collectUtf8Process, MAX_OUTPUT_BYTES, TAIL_CHARS, STOP_GRACE_MS };
