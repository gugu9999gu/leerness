'use strict';
const { collectUtf8Process } = require('./process-output');
const { createHash } = require('crypto');

// In Unicode mode a valid surrogate pair is one scalar, so only unpaired
// surrogates match. Do not normalize valid combining marks, BOMs or emoji.
const hasLoneSurrogate = text => /[\uD800-\uDFFF]/u.test(text);

async function cliChatStream(root, provider, promptText, opts, deps) {
  const { agents, checkAgent, spawn, scrubEnv, recordRun, output, env, cwd } = deps;
  opts = opts || {};
  const fail = (errorCode, error) => ({ ok: false, provider, executed: false, errorCode, error });
  const agent = agents.find(a => a.id === provider);
  if (!agent) return fail('provider_unknown', `unknown provider: ${provider}`);
  const status = checkAgent(agent);
  if (status.status !== 'ready') return fail('provider_disabled', `${provider} 비활성 (${status.status}) — .env 에서 ${agent.envFlag}=1 필요`);
  const timeoutMs = opts.timeout === undefined ? 120000 : opts.timeout;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) return fail('timeout_invalid', 'Invalid stream timeout.');
  if (typeof promptText !== 'string' || hasLoneSurrogate(promptText)) return fail('input_encoding_invalid', 'Prompt must contain valid Unicode.');
  const jsonMode = provider === 'claude' && env.LEERNESS_REPL_STREAM_FORMAT === 'json';
  let cmd, args, useStdin = false;
  if (provider === 'claude') {
    cmd = 'claude';args = jsonMode ? ['--print', '--output-format=stream-json', '--verbose'] : ['--print'];useStdin = true;
  } else if (provider === 'codex') {
    cmd = 'codex';args = ['exec', '--skip-git-repo-check', '-'];useStdin = true;
  } else if (provider === 'agy') { cmd = 'agy';args = ['-p', promptText]; }
  else if (provider === 'copilot') { cmd = 'gh';args = ['copilot', 'suggest', promptText]; }
  else return fail('provider_unsupported', `provider ${provider} 미지원`);

  const started = Date.now(), tty = !!output.isTTY;
  const style = code => text => tty ? `\x1b[${code}m${text}\x1b[0m` : text;
  const dim = style(2), cyan = style(36), green = style(32), red = style(31), yellow = style(33);
  let response = '', frame = '', line = '', firstFrame = true, protocolError = false;
  let renderFailed = false, spinnerActive = false, spinnerIndex = 0, lastActivity = started;
  const write = text => {
    if (renderFailed) return;
    try { output.write(text); } catch { renderFailed = true; }
  };
  function stopSpinner() {
    if (spinnerActive) { write('\r\x1b[K');spinnerActive = false; }
    lastActivity = Date.now();
  }
  function writeColored(text) {
    line += text;
    const lines = line.split('\n');line = lines.pop();
    for (const item of lines) {
      const color = /^\+(?!\+\+)/.test(item) ? green : /^-(?!--)/.test(item) ? red
        : /^@@.*@@/.test(item) ? cyan : /^(diff --git|---|\+\+\+|index )/.test(item) ? yellow : x => x;
      write(color(item) + '\n');
    }
  }
  function textField(value) {
    if (typeof value !== 'string' || hasLoneSurrogate(value)) throw new TypeError('Invalid stream text');
    return value;
  }
  function parseFrame(raw) {
    if (!raw.trim()) return;
    try {
      const event = JSON.parse(raw);
      if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') throw new TypeError('Invalid event');
      if (event.type === 'error' || event.is_error === true) throw new TypeError('Provider error event');
      stopSpinner();
      if (event.type === 'content_block_delta' && event.delta?.text !== undefined) {
        const text = textField(event.delta.text);response += text;writeColored(text);
      } else if (event.type === 'message_start' && firstFrame) {
        firstFrame = false;write(dim(`  [${textField(event.message?.model ?? provider)}] `));
      } else if (event.type === 'thinking_delta' && event.delta?.thinking !== undefined) {
        write(dim(textField(event.delta.thinking)));
      } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        write(cyan(`\n  Tool: ${textField(event.content_block.name ?? 'tool')} 호출 중...\n`));
      }
      // Unknown event types carry no assistant text. Do not stringify them into a response.
    } catch {
      protocolError = true;
      throw new TypeError('Invalid stream response');
    }
  }
  function onText(name, text) {
    stopSpinner();
    if (name === 'stderr') write(dim(text));
    else if (!jsonMode) { response += text;writeColored(text); }
    else {
      frame += text;
      const frames = frame.split('\n');frame = frames.pop();
      for (const part of frames) parseFrame(part);
    }
    if (renderFailed) throw new Error('Stream display failed');
  }
  write(dim(`\n  ── ${provider} stream ──\n`));
  if (renderFailed) return fail('output_display_error', 'Stream display failed.');
  let child, spinner;
  let result;
  try {
    child = spawn(cmd, args, { cwd, env: scrubEnv({}), stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  } catch {
    result = fail('process_error', 'The child process could not be started.');
  }
  if (child) {
    const frames = ['|', '/', '-', '\\'];
    if (tty && !opts.noSpinner) spinner = setInterval(() => {
      const idle = Date.now() - lastActivity;
      if (idle > 800 && !renderFailed) {
        spinnerActive = true;
        write(`\r\x1b[K${dim(frames[spinnerIndex++ % frames.length] + ' 추론중... (' + Math.floor(idle / 1000) + 's)')}`);
      }
    }, 120);
    try {
      result = await collectUtf8Process(child, { timeoutMs, input: useStdin ? Buffer.from(promptText, 'utf8') : undefined,
        onText, onEnd: () => { if (jsonMode && frame) parseFrame(frame); } });
    } finally {
      clearInterval(spinner);stopSpinner();
    }
  }
  // Prefixes already rendered cannot be retracted. Only a complete, successful
  // response may reach the REPL's assistant history; failures contain no raw output.
  write(line);line = '';
  const durationMs = Date.now() - started;
  write(dim(`\n  ── /stream (${durationMs}ms) ──\n`));
  const errorCode = protocolError ? 'response_format_invalid' : renderFailed ? 'output_display_error'
    : result.errorCode || (!response.trim() ? 'empty_response' : null);
  const error = protocolError ? 'Stream response has invalid JSON, Unicode or an error event.' : renderFailed ? 'Stream display failed.'
    : result.error || (errorCode ? 'No assistant response was received.' : null);
  const ok = !errorCode;
  const metadata = { kind: 'agent_repl_cli_stream', provider, durationMs, ok, errorCode,
    exitCode: result.exit ?? null, executed: !!result.executed, responseChars: response.length,
    outputComplete: !!result.outputComplete, stdoutBytes: result.stdoutBytes || 0, stderrBytes: result.stderrBytes || 0,
    timedOut: !!result.timedOut, terminationRequested: !!result.terminationRequested, terminationConfirmed: !!result.terminationConfirmed,
    stdinBytes: useStdin ? Buffer.byteLength(promptText, 'utf8') : null,
    stdinSha256: useStdin ? createHash('sha256').update(promptText, 'utf8').digest('hex') : null,
    stdoutSha256: result.stdoutSha256 || null, stderrSha256: result.stderrSha256 || null };
  try { recordRun(root, metadata); } catch { /* Observability is best effort; never retry the process. */ }
  return { ok, provider, durationMs, executed: !!result.executed, errorCode, error,
    outputComplete: !!result.outputComplete, timedOut: !!result.timedOut, terminationConfirmed: !!result.terminationConfirmed,
    ...(ok ? { response: response.trim(), model: provider } : {}) };
}

module.exports = { cliChatStream };
