'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const HANGUL = /[가-힣ㄱ-ㆎ]/;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-i18n-priority-'));
const project = path.join(tmp, 'project');

const baseEnv = {
  ...process.env,
  TMPDIR: tmp,
  TEMP: tmp,
  TMP: tmp,
  LEERNESS_INTERNAL: '1',
  LEERNESS_NO_BANNER: '1',
  LEERNESS_NO_STALE_CHECK: '1',
  LEERNESS_OFFLINE: '1',
};
// The English assertions must be driven by the project manifest written by
// `init --language en`; an inherited env override would make that path untested.
delete baseEnv.LEERNESS_LANG;
for (const key of [
  'LEERNESS_ENABLE_CLAUDE', 'LEERNESS_ENABLE_CODEX', 'LEERNESS_ENABLE_AGY',
  'LEERNESS_ENABLE_GROK', 'LEERNESS_ENABLE_OPENCODE', 'LEERNESS_ENABLE_QWEN',
  'LEERNESS_ENABLE_AIDER', 'LEERNESS_ENABLE_GOOSE', 'LEERNESS_ENABLE_COPILOT',
  'LEERNESS_ENABLE_OLLAMA',
]) baseEnv[key] = '0';

function run(args, env = baseEnv) {
  return cp.spawnSync(process.execPath, [CLI, ...args], {
    cwd: project,
    env,
    encoding: 'utf8',
    timeout: 300000,
  });
}

function outputOf(result) {
  return String(result.stdout || '') + String(result.stderr || '');
}

function requireSuccess(label, result) {
  const output = outputOf(result);
  if (result.status !== 0 || !output.trim()) {
    throw new Error(`${label} probe command failed or was silent (exit ${result.status}): ${output.slice(0, 500)}`);
  }
  return output;
}

function requireFailure(label, result) {
  const output = outputOf(result);
  if (result.status === 0 || !output.trim()) {
    throw new Error(`${label} probe command unexpectedly succeeded or was silent (exit ${result.status}): ${output.slice(0, 500)}`);
  }
  return output;
}

function hangulLines(output) {
  return String(output).split(/\r?\n/).filter(line => HANGUL.test(line));
}

try {
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"i18n-probe","version":"0.1.0"}\n');
  requireSuccess('init', run(['init', project, '--yes', '--language', 'en']));

  requireSuccess('task add', run(['task', 'add', 'Implement the parser', '--path', project]));
  requireSuccess('decision add', run(['decision', 'add', 'Use JSON storage', '--reason', 'simplest', '--path', project]));
  requireSuccess('lesson save', run(['lesson', 'save', 'Keep outputs deterministic', '--tag', 'test', '--path', project]));
  requireSuccess('plan add', run(['plan', 'add', 'Ship the parser', '--path', project]));

  // Exercise the rejected-provider branch without executing an unsafe command.
  // `provider add` creates the canonical store; the fixture then simulates a
  // hand-edited/remote catalog that the production sanitizer must reject.
  requireSuccess('provider add unsafe-bin', run(['provider', 'add', 'unsafe-bin', '--bin', 'missing-i18n-bin', '--path', project]));
  requireSuccess('provider add unsafe-args', run(['provider', 'add', 'unsafe-args', '--bin', 'missing-i18n-args', '--path', project]));
  const providersFile = path.join(project, '.leerness', 'providers.json');
  const providersRaw = JSON.parse(fs.readFileSync(providersFile, 'utf8'));
  const providers = Array.isArray(providersRaw) ? providersRaw : providersRaw.providers;
  const unsafeBin = providers.find(p => p.id === 'unsafe-bin');
  const unsafeArgs = providers.find(p => p.id === 'unsafe-args');
  if (!unsafeBin || !unsafeArgs) throw new Error('provider rejection fixtures were not persisted');
  unsafeBin.bin = 'unsafe provider bin';
  unsafeArgs.versionArgs = ['--version', '&', 'never-run'];
  fs.writeFileSync(providersFile, JSON.stringify(providersRaw, null, 2) + '\n');

  const surfaces = [
    ['agents list', ['agents', 'list', '--path', project]],
    ['insights', ['insights', '--path', project]],
    ['insights workspace', ['insights', '--include', project, '--path', project]],
    ['toggle list', ['toggle', 'list', '--path', project]],
    ['toggle get', ['toggle', 'get', 'gate', '--path', project]],
    ['toggle set', ['toggle', 'set', 'gate', 'off', '--path', project]],
  ];
  const leaks = [];
  for (const [label, args] of surfaces) {
    const output = requireSuccess(label, run(args));
    const lines = hangulLines(output);
    if (lines.length) leaks.push(`${label}=${lines.length} (${lines.slice(0, 2).join(' | ')})`);
  }

  const koEnv = { ...baseEnv, LEERNESS_LANG: 'ko' };
  for (const [label, args] of [
    ['agents list Korean control', ['agents', 'list', '--path', project]],
    ['insights Korean control', ['insights', '--path', project]],
    ['toggle list Korean control', ['toggle', 'list', '--path', project]],
  ]) {
    const output = requireSuccess(label, run(args, koEnv));
    if (!HANGUL.test(output)) throw new Error(`${label} lost Hangul; the probe cannot distinguish locales`);
  }

  const unknownOutput = requireFailure('toggle unknown English error', run(['toggle', 'get', 'missing-toggle', '--path', project]));
  const unknownLines = hangulLines(unknownOutput);
  if (unknownLines.length) leaks.push(`toggle unknown error=${unknownLines.length} (${unknownLines.slice(0, 2).join(' | ')})`);

  const toggleFile = path.join(project, '.leerness', 'toggles.json');
  fs.writeFileSync(toggleFile, '{broken json\n');
  const corruptList = requireSuccess('toggle corrupt list', run(['toggle', 'list', '--path', project]));
  const corruptSet = requireFailure('toggle corrupt set', run(['toggle', 'set', 'gate', 'on', '--path', project]));
  for (const [label, output] of [['toggle corrupt list', corruptList], ['toggle corrupt set', corruptSet]]) {
    const lines = hangulLines(output);
    if (lines.length) leaks.push(`${label}=${lines.length} (${lines.slice(0, 2).join(' | ')})`);
  }

  // Machine output remains locale-neutral in shape: do not expose the private
  // English projection or replace the canonical registry payload.
  fs.rmSync(toggleFile, { force: true });
  const toggleJson = JSON.parse(requireSuccess('toggle JSON contract', run(['toggle', 'list', '--path', project, '--json'])));
  if (!toggleJson.registry || !toggleJson.registry.gate || toggleJson.registry.gate.descEn !== undefined
    || !HANGUL.test(toggleJson.registry.gate.desc || '')) {
    throw new Error('toggle JSON registry no longer exposes the canonical shape');
  }

  if (leaks.length) throw new Error(`English UI leaked Hangul: ${leaks.join('; ')}`);
  console.log('✓ English priority surfaces and edge paths contain no Hangul; 3/3 Korean controls and JSON shape remain intact');
} catch (error) {
  console.error(`✗ ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
