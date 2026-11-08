'use strict';
 
 
 
 
 
 
 
 
 
 
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
 
 
const commandsAndErrors = text => ps("$e = $null; $a = [System.Management.Automation.Language.Parser]::ParseInput($env:T0351_COMMAND, [ref]$null, [ref]$e); "
  + "[Console]::Out.Write(('{0}|{1}' -f @($a.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)).Count, @($e).Count))",
  { T0351_COMMAND: text }).trim();
 
const READ_PATH = "$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($env:T0351_KEY); if ($null -eq $k) { [Console]::Out.Write('nokey') } "
  + "else { try { if ($k.GetValueNames() -contains 'Path') { $v = $k.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); "
  + "if ($v -is [array]) { $v = $v -join '|' }; [Console]::Out.Write([string]$k.GetValueKind('Path') + '=' + $v) } else { [Console]::Out.Write('absent') } } finally { $k.Close() } }";
const readPath = key => ps(READ_PATH, { T0351_KEY: key });
 
function presetTestPath(kind, raw, extraName = '', extraValue = '') {
  ps("$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($env:T0351_KEY); try { if ($env:T0351_KIND -eq 'absent') { $k.DeleteValue('Path', $false) } "
     
    + "elseif ($env:T0351_KIND -eq 'MultiString') { $k.SetValue('Path', [string[]]@($env:T0351_RAW), [Microsoft.Win32.RegistryValueKind]::MultiString) } "
    + "else { $k.SetValue('Path', $env:T0351_RAW, [Microsoft.Win32.RegistryValueKind]$env:T0351_KIND) }; "
    + "foreach ($n in $k.GetValueNames()) { if ($n -ne 'Path') { $k.DeleteValue($n) } }; "
    + "if ($env:T0351_EXTRA_NAME) { $k.SetValue($env:T0351_EXTRA_NAME, $env:T0351_EXTRA_VALUE, [Microsoft.Win32.RegistryValueKind]::String) } } finally { $k.Close() }",
  { T0351_KEY: TEST_KEY, T0351_KIND: kind, T0351_RAW: raw, T0351_EXTRA_NAME: extraName, T0351_EXTRA_VALUE: extraValue });
}
 
const readOthers = () => ps("$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($env:T0351_KEY); try { foreach ($n in $k.GetValueNames()) { if ($n -ne 'Path') { [Console]::Out.Write($n + '=' + $k.GetValue($n) + ';') } } } finally { $k.Close() }",
  { T0351_KEY: TEST_KEY });
function removeTestKey() {
  ps("[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($env:T0351_KEY, $false); $p = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($env:T0351_PARENT); "
    + "if ($null -ne $p) { $n = $p.SubKeyCount + $p.ValueCount; $p.Close(); if ($n -eq 0) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($env:T0351_PARENT, $false) } }",
  { T0351_KEY: TEST_KEY, T0351_PARENT: PARENT_KEY });
}
 
 
function againstTestKey(script, { readOnly = false, markWrite = false } = {}) {
  const open = readOnly ? `[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${TEST_KEY}', $false)` : `[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${TEST_KEY}')`;
  const swaps = [[OPEN_REAL, open], [NOTIFY, "[Console]::Error.Write('NOTIFY;')"]];
   
  if (markWrite) swaps.push([WRITE, "[Console]::Error.Write('BEFORE_WRITE;'); " + WRITE]);
  let out = script;
  for (const [from, to] of swaps) {
    assert.strictEqual(out.split(from).length, 2, 'expected exactly one ' + from);
    out = out.replace(from, () => to);
  }
  assert(!/SetEnvironmentVariable|LocalMachine|Registry::|HK(CU|LM|EY_[A-Z_]+):|OpenSubKey\(\s*["']Environment/i.test(out), 'the test script can still reach the real environment');
   
   
  assert.strictEqual((out.match(/CurrentUser/gi) || []).length, 1, 'only the throwaway key may be opened');
  assert.strictEqual((out.match(/OpenSubKey|CreateSubKey|OpenBaseKey|OpenRemoteBaseKey/gi) || []).length, 1, 'only one key open is allowed');
   
   
  assert.strictEqual((out.match(/Registry\s*\]\s*::/gi) || []).length, 1, 'only one Registry member reference is allowed');
  assert.strictEqual((out.match(/SetValue/gi) || []).length, 1, 'only one registry write is allowed');
  assert(!/Delete(Value|SubKey)/i.test(out), 'the test script may not delete registry values or keys');
  assert(out.includes(open), 'the throwaway key open is missing');
  return out;
}
 
function hookRegistration(options = {}) {
  const seen = [];
  cp.spawnSync = function (command, args, spawnOptions) {
     
     
     
    if (/^where(\.exe)?$/i.test(path.basename(String(command)))) return original.spawn.call(this, command, args, spawnOptions);
    assert(/^powershell(\.exe)?$/i.test(path.basename(String(command))), 'unexpected launch during registration: ' + command);
     
     
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
 
 
 
let commandCheck = null;
const scriptIsCommandFree = () => (commandCheck === null ? (commandCheck = commandsAndErrors(SCRIPT)) : commandCheck) === '0|0';
 
function register(bin, preset, options = {}) {
  assert(scriptIsCommandFree(), 'the PATH script must parse to zero commands before any registry run: ' + commandCheck);
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
   
  test('the registration hook refuses any other launch without running it', () => {
    hookRegistration();
    assert.throws(() => cp.spawnSync('reg.exe', ['add', 'HKCU\\Environment', '/v', 'Path', '/d', 'x', '/f']), /unexpected launch/);
    assert.throws(() => cp.spawnSync(powershell, ['-NoProfile', '-Command', "[Console]::Out.Write('x')"]), /exactly the product script/);
     
    assert.throws(() => cp.spawnSync(powershell, ['-NoProfile', '-Command', SCRIPT, "; [Environment]::SetEnvironmentVariable('PATH','BROKEN','User')"]),
      /exactly the product script/);
  });
  test('the throwaway-key rewrite refuses a script that could still reach the real environment', () => {
    againstTestKey(SCRIPT);  
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
     
     
    ['a %VAR% entry counts only as written', ['ExpandString', 'C:\\a;%LEERNESS_T0351_DIR%'], 'ADDED', 'ExpandString=C:\\a;%LEERNESS_T0351_DIR%;' + BIN, { LEERNESS_T0351_DIR: BIN }],
    ['present in other letter case', ['String', 'C:\\a;' + BIN.toUpperCase()], 'EXISTS', 'String=C:\\a;' + BIN.toUpperCase()],
     
     
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
   
   
  test('an entry that differs from the bin path by an ignorable character is not taken as present', () => {
    const softHyphen = String.fromCharCode(0xad);
    const lookalike = BIN.slice(0, -1) + softHyphen + BIN.slice(-1);
    const r = register(BIN, ['String', 'C:\\a;' + lookalike]);
    assert.strictEqual(r.seen[0].stdout.toString(), 'ADDED\r\n', r.seen[0].stderr);
    assert(r.after.startsWith('String=C:\\a;') && r.after.endsWith(';' + BIN), r.after);
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
