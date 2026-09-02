#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const env = {
  ...process.env,
  LEERNESS_OFFLINE: '1',
  LEERNESS_NO_PROMPT: '1',
  LEERNESS_NO_AUTOCHCP: '1',
  LEERNESS_NO_AUTO_ROADMAP: '1',
  LEERNESS_INTERNAL: '1',
  LEERNESS_NO_STALE_CHECK: '1',
};

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 30000,
    env,
  });
}

function json(result) {
  try { return JSON.parse(result.stdout || ''); } catch { return null; }
}

function treeSnapshot(root) {
  const rows = [];
  function walk(dir, relative = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = path.join(relative, entry.name).replace(/\\/g, '/');
      const absolute = path.join(dir, entry.name);
      const stat = fs.lstatSync(absolute, { bigint: true });
      const metadata = [Number(stat.mode), stat.size.toString(), stat.mtimeNs.toString()];
      if (entry.isDirectory()) {
        rows.push([rel, 'directory', ...metadata]);
        walk(absolute, rel);
      } else if (entry.isFile()) {
        rows.push([rel, 'file', ...metadata, crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')]);
      } else if (entry.isSymbolicLink()) {
        rows.push([rel, 'symlink', ...metadata, fs.readlinkSync(absolute)]);
      } else {
        rows.push([rel, 'other', ...metadata]);
      }
    }
  }
  walk(root);
  return JSON.stringify(rows);
}

const failures = [];
function check(label, condition, result) {
  if (condition) {
    console.log(`✓ ${label}`);
    return;
  }
  failures.push(label);
  const detail = result
    ? `exit=${result.status}\nstdout=${String(result.stdout || '').slice(0, 300)}\nstderr=${String(result.stderr || '').slice(0, 300)}`
    : '';
  console.log(`✗ ${label}${detail ? `\n${detail}` : ''}`);
}

const catalog = run(['commands', '--json']);
const catalogJson = json(catalog);
const catalogRows = catalogJson?.categories ? Object.values(catalogJson.categories).flat() : [];
check('commands --json returns the machine-readable catalog',
  catalog.status === 0 && catalogJson?.totalCommands === 100 && catalogJson?.categories && !catalog.stderr,
  catalog);
check('commands totalCommands equals the category sum',
  catalogJson?.totalCommands === catalogRows.length,
  catalog);
check('commands catalog includes verify-code, contract verify, and exact-file lease',
  catalogRows.some(row => /^verify-code\b/.test(row.cmd))
    && catalogRows.some(row => /^contract verify\b/.test(row.cmd))
    && catalogRows.some(row => /^lease acquire\|release\|list\|check\b/.test(row.cmd)),
  catalog);

const englishCatalog = run(['commands', '--language', 'en', '--json']);
check('commands accepts --language and returns an English catalog',
  englishCatalog.status === 0 && json(englishCatalog)?.lang === 'en' && !englishCatalog.stderr,
  englishCatalog);

const englishCatalogEquals = run(['commands', '--language=en', '--json']);
check('commands accepts the documented equals form for value flags',
  englishCatalogEquals.status === 0 && json(englishCatalogEquals)?.lang === 'en' && !englishCatalogEquals.stderr,
  englishCatalogEquals);

const missingLanguage = run(['commands', '--language', '--json']);
check('a value flag without a value fails instead of falling back',
  missingLanguage.status === 1 && json(missingLanguage)?.code === 'missing_flag_value' && !missingLanguage.stderr,
  missingLanguage);

const invalidLanguage = run(['commands', '--language', 'xx', '--json', '--no-stale-check']);
check('an invalid language value fails instead of silently falling back',
  invalidLanguage.status === 1 && json(invalidLanguage)?.code === 'invalid_flag_value' && !invalidLanguage.stderr,
  invalidLanguage);

const known = run(['commands', '--path', process.cwd(), '--json']);
check('commands accepts its documented global flags',
  known.status === 0 && json(known)?.categories && !known.stderr,
  known);

const nonexistent = run(['commands', '--definitely-unknown', '--json']);
const nonexistentJson = json(nonexistent);
check('a nonexistent flag fails closed with one JSON error',
  nonexistent.status === 1 && nonexistentJson?.ok === false
    && nonexistentJson?.code === 'unknown_flag'
    && String(nonexistentJson?.error || '').includes('--definitely-unknown')
    && !nonexistent.stderr,
  nonexistent);

const nonexistentEquals = run(['commands', '--definitely-unknown=value', '--json']);
check('an equals-form nonexistent flag also fails closed',
  nonexistentEquals.status === 1 && json(nonexistentEquals)?.code === 'unknown_flag' && !nonexistentEquals.stderr,
  nonexistentEquals);

const nonexistentHuman = run(['commands', '--definitely-unknown']);
check('human-mode unknown flags stay visible on stderr while failing closed',
  nonexistentHuman.status === 1 && /알 수 없는 플래그|Unknown flag/.test(nonexistentHuman.stderr || '')
    && !(nonexistentHuman.stdout || '').trim(),
  nonexistentHuman);

const booleanEquals = run(['commands', '--json=true']);
check('boolean flags reject equals-form values that their consumers would ignore',
  booleanEquals.status === 1 && /--json=true/.test((booleanEquals.stdout || '') + (booleanEquals.stderr || '')),
  booleanEquals);

const missingMeasure = run(['benchmark', '--measure']);
check('missing values retain a user-facing command-usage hint',
  missingMeasure.status === 1 && /사용법|usage|task/i.test((missingMeasure.stdout || '') + (missingMeasure.stderr || '')),
  missingMeasure);

const missingPath = run(['status', '--path']);
check('missing --path retains its specific no-value diagnostic',
  missingPath.status === 1 && /--path 에 값이 없습니다|--path was given without a value/.test((missingPath.stdout || '') + (missingPath.stderr || '')),
  missingPath);

// --cmd exists elsewhere in leerness, so the global registry alone cannot catch
// it. The commands command must reject a foreign, command-specific flag too.
const foreign = run(['commands', '--cmd', 'ignored-value', '--json']);
const foreignJson = json(foreign);
check('commands rejects a known-but-foreign command flag',
  foreign.status === 1 && foreignJson?.ok === false
    && foreignJson?.code === 'unknown_flag'
    && String(foreignJson?.error || '').includes('--cmd')
    && !foreign.stderr,
  foreign);

const foreignTestCommand = run(['commands', '--test-cmd', 'ignored-command', '--json']);
check('commands rejects a value flag owned by another command',
  foreignTestCommand.status === 1 && json(foreignTestCommand)?.code === 'unknown_flag' && !foreignTestCommand.stderr,
  foreignTestCommand);

const lensUnknown = run(['lens', '--type', 'database', '--json']);
check('lens rejects an unknown value flag before its value becomes a domain',
  lensUnknown.status === 1 && json(lensUnknown)?.code === 'unknown_flag' && !lensUnknown.stderr,
  lensUnknown);

const lensForeign = run(['lens', '--test-cmd', 'database', '--json']);
check('lens rejects a known-but-foreign value flag',
  lensForeign.status === 1 && json(lensForeign)?.code === 'unknown_flag' && !lensForeign.stderr,
  lensForeign);

const contractUnknown = run(['contract', 'verify', 'missing-spec.md', '--type', 'missing-impl.md', '--json']);
check('contract verify rejects an unknown flag before positional error meaning changes',
  contractUnknown.status === 1 && json(contractUnknown)?.code === 'unknown_flag'
    && json(contractUnknown)?.code !== 'spec_not_found' && !contractUnknown.stderr,
  contractUnknown);

const aboutForeign = run(['about', '--test-cmd', 'ignored-command', '--json']);
check('about rejects a known-but-foreign value flag',
  aboutForeign.status === 1 && json(aboutForeign)?.code === 'unknown_flag' && !aboutForeign.stderr,
  aboutForeign);

// The external evaluation's concrete case was verify-code --cmd/--test-cmd:
// both are valid names elsewhere, but this command does not consume them.
const emptyProject = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-command-flags-'));
try {
  const initialized = run(['init', emptyProject, '--yes', '--json']);
  check('route-arity fixture initializes successfully',
    initialized.status === 0 && json(initialized)?.ok === true,
    initialized);

  for (const mutationFlag of ['--fix', '--baseline', '--auto-track']) {
    const beforeInvalidGate = treeSnapshot(emptyProject);
    const invalidGate = run(['gate', emptyProject, '--require-referee', mutationFlag, '--json']);
    check(`gate rejects foreign ${mutationFlag} before any sub-check can write`,
      invalidGate.status === 1 && json(invalidGate)?.code === 'unknown_flag'
        && String(json(invalidGate)?.error || '').includes(mutationFlag)
        && treeSnapshot(emptyProject) === beforeInvalidGate,
      invalidGate);
  }

  const updateCheck = run(['update', emptyProject, '--check', '--json']);
  check('update keeps --check as a boolean flag',
    updateCheck.status === 0 && json(updateCheck)?.code !== 'missing_flag_value'
      && typeof json(updateCheck)?.verdict === 'string',
    updateCheck);

  const updateCheckEquals = run(['update', emptyProject, '--check=true', '--json']);
  check('update rejects a value attached to its boolean --check',
    updateCheckEquals.status === 1 && json(updateCheckEquals)?.code === 'invalid_flag_syntax',
    updateCheckEquals);

  const previewKeep = run(['preview', 'serve', 'P-NOT-FOUND', '--keep', '--path', emptyProject, '--json']);
  check('preview serve keeps --keep as a boolean flag',
    previewKeep.status === 1 && json(previewKeep)?.code === 'not_found',
    previewKeep);

  const previewKeepBeforeId = run(['preview', 'serve', '--keep', 'P-NOT-FOUND', '--path', emptyProject, '--json']);
  check('preview serve does not let --keep swallow a following preview id',
    previewKeepBeforeId.status === 1 && json(previewKeepBeforeId)?.code === 'not_found'
      && String(json(previewKeepBeforeId)?.error || '').includes('P-NOT-FOUND'),
    previewKeepBeforeId);

  const previewKeepBeforeSubcommand = run(['preview', '--keep', 'serve', 'P-NOT-FOUND', '--path', emptyProject, '--json']);
  check('preview serve resolves its boolean --keep even before the subcommand',
    previewKeepBeforeSubcommand.status === 1 && json(previewKeepBeforeSubcommand)?.code === 'not_found'
      && String(json(previewKeepBeforeSubcommand)?.error || '').includes('P-NOT-FOUND'),
    previewKeepBeforeSubcommand);

  const refereeMissingCheck = run(['referee', 'add', 'route-arity-missing', '--check', '--good', 'node -e "process.exit(0)"', '--bad', 'node -e "process.exit(1)"', '--path', emptyProject, '--json']);
  check('referee add still requires a value for --check',
    refereeMissingCheck.status === 1 && json(refereeMissingCheck)?.code === 'missing_flag_value',
    refereeMissingCheck);

  const cleanupMissingKeep = run(['release', 'cleanup', '--keep', '--path', emptyProject, '--json']);
  check('release cleanup still requires a numeric value for --keep',
    cleanupMissingKeep.status === 1 && json(cleanupMissingKeep)?.code === 'missing_flag_value',
    cleanupMissingKeep);

  const gateMissingReferee = run(['gate', emptyProject, '--require-referee', '--json']);
  check('gate retains its structured missing-referee check before dispatch',
    gateMissingReferee.status === 1 && Array.isArray(json(gateMissingReferee)?.checks)
      && json(gateMissingReferee).checks.some(row => row?.code === 'referee_missing_value'),
    gateMissingReferee);

  const spec = path.join(emptyProject, 'contract.md');
  const impl = path.join(emptyProject, 'contract.js');
  fs.writeFileSync(spec, '- charge()\n', 'utf8');
  fs.writeFileSync(impl, 'function charge() {}\nmodule.exports = { charge };\n', 'utf8');
  const contractWithGlobalPath = run(['contract', 'verify', spec, impl, '--path', emptyProject, '--json']);
  check('contract verify retains the global --path compatibility flag',
    contractWithGlobalPath.status === 0 && json(contractWithGlobalPath)?.ok === true && !contractWithGlobalPath.stderr,
    contractWithGlobalPath);

  const verifyForeign = run(['verify-code', emptyProject, '--cmd', 'ignored-command']);
  check('verify-code rejects flags it does not implement',
    verifyForeign.status === 1 && /--cmd/.test((verifyForeign.stdout || '') + (verifyForeign.stderr || '')),
    verifyForeign);

  const verifyTestCommand = run(['verify-code', emptyProject, '--test-cmd', 'ignored-command']);
  check('verify-code rejects --test-cmd instead of recording unrelated auto-detected evidence',
    verifyTestCommand.status === 1 && /--test-cmd/.test((verifyTestCommand.stdout || '') + (verifyTestCommand.stderr || '')),
    verifyTestCommand);

  const strictEquals = run(['verify-code', emptyProject, '--strict=true']);
  check('verify-code rejects a boolean value form instead of losing strict mode',
    strictEquals.status === 1 && /--strict=true/.test((strictEquals.stdout || '') + (strictEquals.stderr || '')),
    strictEquals);

  const claimOwnsTestCommand = run(['verify-claim', 'T-NOT-FOUND', '--run-tests', '--test-cmd', 'node -e "process.exit(0)"', '--path', emptyProject, '--json']);
  check('verify-claim retains its supported --test-cmd contract',
    claimOwnsTestCommand.status === 1 && json(claimOwnsTestCommand)?.code !== 'unknown_flag',
    claimOwnsTestCommand);

  const claimRaw = run(['verify-claim', '--all', '--raw', '--path', emptyProject, '--json']);
  check('verify-claim --all retains its supported raw-audit contract',
    claimRaw.status === 0 && json(claimRaw)?.baseline?.state === 'ignored',
    claimRaw);

  const claimForeignBoundary = run(['verify-claim', 'T-NOT-FOUND', '--before', 'T-0002', '--path', emptyProject, '--json']);
  check('per-task verify-claim rejects the baseline-only --before flag',
    claimForeignBoundary.status === 1 && json(claimForeignBoundary)?.code === 'unknown_flag',
    claimForeignBoundary);

  const baselineForeignRun = run(['verify-claim', 'baseline', 'show', '--run-tests', '--path', emptyProject, '--json']);
  check('claims baseline show rejects verification-only mutation flags',
    baselineForeignRun.status === 1 && json(baselineForeignRun)?.code === 'unknown_flag',
    baselineForeignRun);

  const gateForeignRaw = run(['gate', emptyProject, '--raw', '--json']);
  check('gate rejects --raw because raw audit belongs to verify-claim --all',
    gateForeignRaw.status === 1 && json(gateForeignRaw)?.code === 'unknown_flag',
    gateForeignRaw);
} finally {
  fs.rmSync(emptyProject, { recursive: true, force: true });
}

// Invalid input must not trigger the legacy workspace auto-migration that is
// normally allowed for a valid command.
const legacyProject = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-command-flags-legacy-'));
try {
  const legacyWorkspaceName = ['.', 'harness'].join('');
  const legacyDir = path.join(legacyProject, legacyWorkspaceName);
  fs.mkdirSync(legacyDir);
  fs.writeFileSync(path.join(legacyDir, 'HARNESS_VERSION'), '1.36.161\n', 'utf8');
  const before = fs.readFileSync(path.join(legacyDir, 'HARNESS_VERSION'), 'utf8');
  for (const mutationFlag of ['--fix', '--baseline', '--auto-track']) {
    const beforeInvalidGate = treeSnapshot(legacyProject);
    const invalidGate = run(['gate', '--require-referee', mutationFlag, '--path', legacyProject, '--json']);
    check(`gate ${mutationFlag} rejection cannot migrate or mutate a legacy workspace`,
      invalidGate.status === 1 && json(invalidGate)?.code === 'unknown_flag'
        && fs.existsSync(legacyDir) && !fs.existsSync(path.join(legacyProject, '.leerness'))
        && treeSnapshot(legacyProject) === beforeInvalidGate,
      invalidGate);
  }
  const invalidLegacy = run(['commands', '--unknown-value', 'database', '--path', legacyProject, '--json']);
  check('unknown flags fail before legacy workspace migration or writes',
    invalidLegacy.status === 1 && json(invalidLegacy)?.code === 'unknown_flag'
      && fs.existsSync(legacyDir) && !fs.existsSync(path.join(legacyProject, '.leerness'))
      && fs.readFileSync(path.join(legacyDir, 'HARNESS_VERSION'), 'utf8') === before,
    invalidLegacy);

  const invalidKeepLegacy = run(['init', '--keep', 'abc', '--path', legacyProject, '--json']);
  check('invalid value semantics fail before legacy workspace migration or writes',
    invalidKeepLegacy.status === 1 && json(invalidKeepLegacy)?.code === 'invalid_keep'
      && fs.existsSync(legacyDir) && !fs.existsSync(path.join(legacyProject, '.leerness'))
      && fs.readFileSync(path.join(legacyDir, 'HARNESS_VERSION'), 'utf8') === before,
    invalidKeepLegacy);

  const missingRefereeLegacy = run(['gate', '--require-referee', '--path', legacyProject, '--json']);
  check('command-specific malformed diagnostics also run before legacy migration',
    missingRefereeLegacy.status === 1 && Array.isArray(json(missingRefereeLegacy)?.checks)
      && json(missingRefereeLegacy).checks.some(row => row?.code === 'referee_missing_value')
      && fs.existsSync(legacyDir) && !fs.existsSync(path.join(legacyProject, '.leerness')),
    missingRefereeLegacy);
} finally {
  fs.rmSync(legacyProject, { recursive: true, force: true });
}

if (failures.length) {
  console.log(`UNKNOWN_FLAGS_ACCEPTED: ${failures.join('; ')}`);
  process.exitCode = 1;
} else {
  console.log('command flags probe passed');
}
