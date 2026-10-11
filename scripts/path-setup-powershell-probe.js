'use strict';
// T-0351: the Windows PATH registration of `leerness path-setup --apply` (_winPathPsScript and _registerPath in
// bin/leerness.js). From 1.9.254 the script's lines were joined with spaces only, so PowerShell refused it as a whole
// (UnexpectedToken after SetEnvironmentVariable) and the registration never ran. It also used Write-Output and
// Where-Object, module cmdlets that cost 21.5-52 s per launch without PSModulePath on a GitHub Windows runner (T-0343).
// The script now edits HKCU\Environment\Path keeping its raw text and registry type.
// This probe parses the script with PowerShell's own parser (CommandAst nodes and parse errors), then runs it through
// _registerPath without PSModulePath against a throwaway registry key. The spawn hook checks that it is about to run
// exactly the product script, points its one registry open at the throwaway key, and replaces the settings broadcast
// with a marker; afterwards nothing in the script may still reach HKCU\Environment. The probe also checks that the
// real user Path (raw text and type) is unchanged.
const assert = require('assert');
const cp = require('child_process');
const crypto = require('crypto');
const path = require('path');

const original = { spawn: cp.spawnSync };
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error && error.stack || error)); }
  finally { cp.spawnSync = original.spawn; }
}

if (process.platform !== 'win32') {
  console.log('path-setup PowerShell probe: skipped, it needs Windows PowerShell (platform ' + process.platform + ')');
  process.exit(0);
}

const cli = require('../bin/leerness.js');
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const SCRIPT = cli._winPathPsScript();
// The script as shipped from 1.9.254 to 1.36.297, kept as the control for the command check.
const OLD_SCRIPT = [
  "$b = $env:LEERNESS_PATH_BIN;",
  "$u = [Environment]::GetEnvironmentVariable('PATH','User'); if (-not $u) { $u = '' }",
  "$parts = $u.Split(';') | Where-Object { $_ -ne '' }",
  "if ($parts -notcontains $b) {",
  "  $nu = if ($u -eq '') { $b } else { $u.TrimEnd(';') + ';' + $b }",
  "  [Environment]::SetEnvironmentVariable('PATH', $nu, 'User')",
  "  Write-Output 'ADDED'",
  "} else { Write-Output 'EXISTS' }",
].join(' ');
const OPEN_REAL = "[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)";
const NOTIFY = "[Environment]::SetEnvironmentVariable('LEERNESS_PATH_SETUP_NOTIFY', $null, 'User')";
const WRITE = "$k.SetValue('Path', $nu, $kind)";
const PARENT_KEY = 'Software\\leerness-t0351-probe';
const TEST_KEY = PARENT_KEY + '\\' + process.pid + '-' + Date.now().toString(36);

function ps(command, env = {}) {
  const r = original.spawn.call(cp, powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, env: { ...process.env, ...env } });
  assert.strictEqual(r.status, 0, 'PowerShell helper failed: ' + (r.error ? r.error.code : r.stderr));
  return r.stdout;
}
// PowerShell's parser counts CommandAst nodes (cmdlets, aliases, functions, programs; not text inside strings) and
// parse errors. The parse is a .NET call and invokes no command.
const commandsAndErrors = text => ps("$e = $null; $a = [System.Management.Automation.Language.Parser]::ParseInput($env:T0351_COMMAND, [ref]$null, [ref]$e); "
  + "[Console]::Out.Write(('{0}|{1}' -f @($a.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)).Count, @($e).Count))",
  { T0351_COMMAND: text }).trim();
// Type and raw text of a Path value (no expansion), or 'absent' / 'nokey'.
const READ_PATH = "$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($env:T0351_KEY); if ($null -eq $k) { [Console]::Out.Write('nokey') } "
  + "else { try { if ($k.GetValueNames() -contains 'Path') { $v = $k.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); "
  + "if ($v -is [array]) { $v = $v -join '|' }; [Console]::Out.Write([string]$k.GetValueKind('Path') + '=' + $v) } else { [Console]::Out.Write('absent') } } finally { $k.Close() } }";
const readPath = key => ps(READ_PATH, { T0351_KEY: key });
// Sets the throwaway Path (or removes it), and optionally one more REG_SZ value named `extraName`.
function presetTestPath(kind, raw, extraName = '', extraValue = '') {
  ps("$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($env:T0351_KEY); try { if ($env:T0351_KIND -eq 'absent') { $k.DeleteValue('Path', $false) } "
    // Not `$v = if (...) { [string[]]... }`: an if expression unrolls a one-item array into a string.
    + "elseif ($env:T0351_KIND -eq 'MultiString') { $k.SetValue('Path', [string[]]@($env:T0351_RAW), [Microsoft.Win32.RegistryValueKind]::MultiString) } "
    + "else { $k.SetValue('Path', $env:T0351_RAW, [Microsoft.Win32.RegistryValueKind]$env:T0351_KIND) }; "
    + "foreach ($n in $k.GetValueNames()) { if ($n -ne 'Path') { $k.DeleteValue($n) } }; "
    + "if ($env:T0351_EXTRA_NAME) { $k.SetValue($env:T0351_EXTRA_NAME, $env:T0351_EXTRA_VALUE, [Microsoft.Win32.RegistryValueKind]::String) } } finally { $k.Close() }",
  { T0351_KEY: TEST_KEY, T0351_KIND: kind, T0351_RAW: raw, T0351_EXTRA_NAME: extraName, T0351_EXTRA_VALUE: extraValue });
}
// The other values of the throwaway key, as name=value lines.
const readOthers = () => ps("$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($env:T0351_KEY); try { foreach ($n in $k.GetValueNames()) { if ($n -ne 'Path') { [Console]::Out.Write($n + '=' + $k.GetValue($n) + ';') } } } finally { $k.Close() }",
  { T0351_KEY: TEST_KEY });
function removeTestKey() {
  ps("[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($env:T0351_KEY, $false); $p = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($env:T0351_PARENT); "
    + "if ($null -ne $p) { $n = $p.SubKeyCount + $p.ValueCount; $p.Close(); if ($n -eq 0) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($env:T0351_PARENT, $false) } }",
  { T0351_KEY: TEST_KEY, T0351_PARENT: PARENT_KEY });
}
// The product script pointed at the throwaway key. Each swap must match exactly once. Afterwards the script may not
// open HKCU\Environment, set an environment variable, or reach any other hive.
function againstTestKey(script, { readOnly = false, markWrite = false } = {}) {
  const open = readOnly ? `[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${TEST_KEY}', $false)` : `[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${TEST_KEY}')`;
  const swaps = [[OPEN_REAL, open], [NOTIFY, "[Console]::Error.Write('NOTIFY;')"]];
  // The marker shows the script reached the write, so a script that never runs (a parse error) cannot pass.
  if (markWrite) swaps.push([WRITE, "[Console]::Error.Write('BEFORE_WRITE;'); " + WRITE]);
  let out = script;
  for (const [from, to] of swaps) {
    assert.strictEqual(out.split(from).length, 2, 'expected exactly one ' + from);
    out = out.replace(from, () => to);
  }
  assert(!/SetEnvironmentVariable|LocalMachine|Registry::|HK(CU|LM|EY_[A-Z_]+):|OpenSubKey\(\s*["']Environment/i.test(out), 'the test script can still reach the real environment');
  // Case-insensitive counts: one hive reference and one key open, both the throwaway key's (round 2: a lowercase
  // `currentuser.OpenSubKey(('Environ' + 'ment'), $true)` passed a case-sensitive count).
  assert.strictEqual((out.match(/CurrentUser/gi) || []).length, 1, 'only the throwaway key may be opened');
  assert.strictEqual((out.match(/OpenSubKey|CreateSubKey|OpenBaseKey|OpenRemoteBaseKey/gi) || []).length, 1, 'only one key open is allowed');
  // Round 3: the static Registry members write by path (Registry::SetValue('HKEY_CURRENT_USER\Environment', ...)).
  // Only the one Registry member reference (CurrentUser) and the one key write ($k.SetValue) may remain.
  assert.strictEqual((out.match(/Registry\s*\]\s*::/gi) || []).length, 1, 'only one Registry member reference is allowed');
  assert.strictEqual((out.match(/SetValue/gi) || []).length, 1, 'only one registry write is allowed');
  assert(!/Delete(Value|SubKey)/i.test(out), 'the test script may not delete registry values or keys');
  assert(out.includes(open), 'the throwaway key open is missing');
  return out;
}
// Installs the spawn hook used while _registerPath runs. The caller restores cp.spawnSync.
function hookRegistration(options = {}) {
  const seen = [];
  cp.spawnSync = function (command, args, spawnOptions) {
    // While _registerPath runs, only two launches may happen: where.exe resolving `powershell` (read-only), and
    // PowerShell with exactly the product script, which is then pointed at the throwaway key. Anything else is
    // refused without running, so a future change that writes another way cannot reach the real user Path.
    if (/^where(\.exe)?$/i.test(path.basename(String(command)))) return original.spawn.call(this, command, args, spawnOptions);
    assert(/^powershell(\.exe)?$/i.test(path.basename(String(command))), 'unexpected launch during registration: ' + command);
    // The whole argument list, not just the -Command value: PowerShell joins every argument after -Command into the
    // command text, so an extra argument could carry its own write (round 2).
    assert.deepStrictEqual(args, ['-NoProfile', '-Command', SCRIPT], 'the PATH spawn must run exactly the product script');
    const env = { ...spawnOptions.env, ...(options.env || {}) };
    for (const key of Object.keys(env)) if (/^PSModule(Path|AnalysisCachePath)$/i.test(key)) delete env[key];
    const run = ['-NoProfile', '-Command', againstTestKey(SCRIPT, options)];
    const result = original.spawn.call(this, command, run, { ...spawnOptions, env });
    seen.push({ env, stdout: Buffer.from(result.stdout || ''), stderr: String(result.stderr || ''), status: result.status });
    return result;
  };
  return seen;
}
// Runs _registerPath with the spawn hook. Returns its result, what the child printed, and the throwaway Path after.
function register(bin, preset, options = {}) {
  presetTestPath(...preset);
  const seen = hookRegistration(options);
  let result;
  try { result = cli._registerPath({ globalBin: bin, platform: 'win32' }); }
  finally { cp.spawnSync = original.spawn; }
  return { result, seen, after: readPath(TEST_KEY) };
}

const BIN = 'C:\\Users\\example\\AppData\\Roaming\\npm';
const REAL = 'Environment';
const realBefore = crypto.createHash('sha256').update(readPath(REAL)).digest('hex');
try {
  test('the command check counts cmdlets and parse errors, not text in strings', () => {
    assert.deepStrictEqual([OLD_SCRIPT, "Write-Output 'ADDED'", "[Console]::Out.Write('Write-Output')"].map(commandsAndErrors),
      ['3|1', '1|0', '0|0']);
  });
  test('the PATH script parses and invokes no command', () => {
    assert.strictEqual(commandsAndErrors(SCRIPT), '0|0');
    assert(SCRIPT.includes('$env:LEERNESS_PATH_BIN'), 'the bin path must stay a data channel');
  });
  // The two guards that keep the runs below off the real user Path, checked without running anything.
  test('the registration hook refuses any other launch without running it', () => {
    hookRegistration();
    assert.throws(() => cp.spawnSync('reg.exe', ['add', 'HKCU\\Environment', '/v', 'Path', '/d', 'x', '/f']), /unexpected launch/);
    assert.throws(() => cp.spawnSync(powershell, ['-NoProfile', '-Command', "[Console]::Out.Write('x')"]), /exactly the product script/);
    // Round 2: PowerShell joins the arguments after -Command, so an appended argument would run as more script.
    assert.throws(() => cp.spawnSync(powershell, ['-NoProfile', '-Command', SCRIPT, "; [Environment]::SetEnvironmentVariable('PATH','BROKEN','User')"]),
      /exactly the product script/);
  });
  test('the throwaway-key rewrite refuses a script that could still reach the real environment', () => {
    againstTestKey(SCRIPT); // the product script itself is accepted, so the refusals below are about the extra text
    for (const extra of ['; [Environment]::SetEnvironmentVariable("PATH", $nu, "User")',
      '; $x = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)',
      '; $x = [Microsoft.Win32.Registry]::LocalMachine', '; $x = Get-Item HKCU:\\Environment',
      "; $x = [Microsoft.Win32.Registry]::currentuser.OpenSubKey(('Environ' + 'ment'), $true)",
      "; [Microsoft.Win32.Registry]::SetValue('HKEY_CURRENT_USER\\Environment','Path','BROKEN')"]) {
      assert.throws(() => againstTestKey(SCRIPT + extra), extra);
    }
  });
  const windowsApps = '%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;';
  const cases = [
    ['no user Path yet', ['absent', ''], 'ADDED', 'ExpandString=' + BIN],
    ['REG_EXPAND_SZ keeps its %VAR% text and type', ['ExpandString', windowsApps], 'ADDED', 'ExpandString=%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;' + BIN],
    ['REG_SZ keeps its type', ['String', 'C:\\a;C:\\b'], 'ADDED', 'String=C:\\a;C:\\b;' + BIN],
    ['present among empty entries', ['String', 'C:\\a;;' + BIN + ';'], 'EXISTS', 'String=C:\\a;;' + BIN + ';'],
    // Round 3 (owner's choice): entries count only as written. A %VAR% entry that this shell would expand to the bin
    // path is not taken as present, since new terminals may lack the variable; the bin path is added as text.
    ['a %VAR% entry counts only as written', ['ExpandString', 'C:\\a;%LEERNESS_T0351_DIR%'], 'ADDED', 'ExpandString=C:\\a;%LEERNESS_T0351_DIR%;' + BIN, { LEERNESS_T0351_DIR: BIN }],
    ['present in other letter case', ['String', 'C:\\a;' + BIN.toUpperCase()], 'EXISTS', 'String=C:\\a;' + BIN.toUpperCase()],
    // Round 2: Windows expands %VAR% in a REG_EXPAND_SZ Path only, and the bin path's own data channel is gone before
    // the comparison, so neither can make an entry look present.
    ['REG_SZ is compared as written', ['String', '%LEERNESS_T0351_DIR%'], 'ADDED', 'String=%LEERNESS_T0351_DIR%;' + BIN, { LEERNESS_T0351_DIR: BIN }],
    ['%LEERNESS_PATH_BIN% never matches', ['ExpandString', '%LEERNESS_PATH_BIN%'], 'ADDED', 'ExpandString=%LEERNESS_PATH_BIN%;' + BIN],
  ];
  for (const [name, preset, word, after, env] of cases) test(`registration without PSModulePath: ${name}`, () => {
    const r = register(BIN, preset, { env });
    assert.strictEqual(r.seen.length, 1);
    assert(!Object.keys(r.seen[0].env).some(key => /^PSModulePath$/i.test(key)), 'the child must run without PSModulePath');
    assert.strictEqual(r.seen[0].status, 0, r.seen[0].stderr);
    assert.strictEqual(r.seen[0].stdout.toString('hex'), Buffer.from(word + '\r\n').toString('hex'));
    assert.strictEqual(r.seen[0].stderr, word === 'ADDED' ? 'NOTIFY;' : '', 'the settings broadcast follows a write only');
    assert.strictEqual(r.after, after);
    assert.deepStrictEqual({ ok: r.result.ok, method: r.result.method }, { ok: true, method: word === 'ADDED' ? 'powershell-user-path' : 'already' });
  });
  test('a bin path with PowerShell syntax is added as text', () => {
    const hostile = "C:\\safe $(Write-Output INJECTED) `tick 'q' t\\";
    const r = register(hostile, ['String', 'C:\\a']);
    assert.strictEqual(r.seen[0].stdout.toString(), 'ADDED\r\n');
    assert.strictEqual(r.after, 'String=C:\\a;' + hostile);
    assert.strictEqual(r.result.method, 'powershell-user-path');
  });
  test('a Path of another registry type is refused and left as it is', () => {
    const r = register(BIN, ['MultiString', 'C:\\a']);
    assert.strictEqual(r.seen[0].status, 1);
    // The script's own refusal, not a later SetValue failure on the wrong value type.
    // PowerShell may wrap the error text at the console width, so whitespace is ignored.
    assert(r.seen[0].stderr.replace(/\s+/g, '').includes('theuserPathhasregistrytypeMultiString'), r.seen[0].stderr.slice(0, 300));
    assert.strictEqual(r.seen[0].stdout.toString(), '');
    assert.strictEqual(r.after, 'MultiString=C:\\a');
    assert.deepStrictEqual({ ok: r.result.ok, method: r.result.method }, { ok: false, method: 'powershell-user-path' });
  });
  test('an existing LEERNESS_PATH_SETUP_NOTIFY user variable stops the script before any change', () => {
    const r = register(BIN, ['ExpandString', '%LEERNESS_PATH_SETUP_NOTIFY%\\bin', 'LEERNESS_PATH_SETUP_NOTIFY', 'C:\\tools']);
    assert.strictEqual(r.seen[0].status, 1);
    assert(r.seen[0].stderr.replace(/\s+/g, '').includes('theuservariableLEERNESS_PATH_SETUP_NOTIFYexists'), r.seen[0].stderr.slice(0, 300));
    assert.strictEqual(r.seen[0].stdout.toString(), '');
    assert.strictEqual(r.after, 'ExpandString=%LEERNESS_PATH_SETUP_NOTIFY%\\bin');
    assert.strictEqual(readOthers(), 'LEERNESS_PATH_SETUP_NOTIFY=C:\\tools;');
    assert.deepStrictEqual({ ok: r.result.ok, method: r.result.method }, { ok: false, method: 'powershell-user-path' });
  });
  test('a failed write exits 1 without printing ADDED, and registration reports failure', () => {
    const r = register(BIN, ['String', 'C:\\a'], { readOnly: true, markWrite: true });
    assert.strictEqual(r.seen[0].status, 1);
    assert(r.seen[0].stderr.startsWith('BEFORE_WRITE;'), 'the script must have run up to the write: ' + r.seen[0].stderr.slice(0, 200));
    assert.strictEqual(r.seen[0].stdout.toString(), '');
    assert.strictEqual(r.after, 'String=C:\\a');
    assert.deepStrictEqual({ ok: r.result.ok, method: r.result.method }, { ok: false, method: 'powershell-user-path' });
    assert.match(r.result.detail, /exit 1/);
  });
  for (const [name, bin] of [['a semicolon', 'C:\\npm;tools'], ['a percent sign', 'C:\\npm%x%']]) test(`a bin path with ${name} is refused before PowerShell runs`, () => {
    const r = register(bin, ['String', 'C:\\a']);
    assert.strictEqual(r.seen.length, 0, 'PowerShell must not run');
    assert.strictEqual(r.after, 'String=C:\\a');
    assert.deepStrictEqual({ ok: r.result.ok, method: r.result.method }, { ok: false, method: 'powershell-user-path' });
    assert(r.result.detail.includes("';' 또는 '%'"), r.result.detail);
  });
} finally {
  cp.spawnSync = original.spawn;
  removeTestKey();
  assert.strictEqual(readPath(TEST_KEY), 'nokey', 'the throwaway key was not removed');
  assert.strictEqual(crypto.createHash('sha256').update(readPath(REAL)).digest('hex'), realBefore, 'the probe changed the real user Path');
}
console.log('path-setup PowerShell probe: ' + passed + '/' + (passed + failed) + ' PASS');
process.exitCode = failed ? 1 : 0;
