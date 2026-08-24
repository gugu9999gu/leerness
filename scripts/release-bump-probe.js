#!/usr/bin/env node
'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sourceRoot = path.resolve(__dirname, '..');

function nextPatch(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/);
  if (!match) throw new Error(`unsupported fixture version: ${version}`);
  return match[4] ? `${match[1]}.${match[2]}.${match[3]}` : `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function versionFromSource(file) {
  const match = fs.readFileSync(file, 'utf8').match(/const VERSION = '([^']+)'/);
  return match && match[1];
}

function copyFixture(root) {
  for (const dir of ['bin', 'lib']) fs.cpSync(path.join(sourceRoot, dir), path.join(root, dir), { recursive: true });
  for (const file of ['package.json', 'README.md']) fs.copyFileSync(path.join(sourceRoot, file), path.join(root, file));
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  fs.writeFileSync(path.join(root, '.harness', 'HARNESS_VERSION'), `${version}\n`);
}

function runProbe(root) {
  const before = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const expected = nextPatch(before);
  const cli = path.join(root, 'bin', 'leerness.js');
  // Windows는 대소문자를 구별하지 않지만 path.resolve는 문자열 대소문자를 보존한다.
  // 실제 사용자가 소문자 드라이브 문자로 넘긴 경우도 자체 패키지 판별이 유지돼야 한다.
  const rootArg = process.platform === 'win32' ? root.slice(0, 1).toLowerCase() + root.slice(1) : root;
  const run = cp.spawnSync(process.execPath, [cli, 'release', 'bump', '--patch', '--path', rootArg], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000
  });
  const after = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const harnessVersion = fs.readFileSync(path.join(root, '.harness', 'HARNESS_VERSION'), 'utf8').trim();
  const binVersion = versionFromSource(cli);
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const unknownFlag = /unknown flag|알 수 없는 플래그/i.test(`${run.stdout}\n${run.stderr}`);
  const ok = run.status === 0 && !unknownFlag && after === expected && harnessVersion === expected
    && binVersion === expected && readme.includes(`Leerness v${expected}`);
  return { ok, before, expected, after, harnessVersion, binVersion, unknownFlag, exit: run.status };
}

function runGenericProbe(root) {
  const readmeBefore = '# Independent package\n';
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'independent-package', version: '1.0.0' }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'README.md'), readmeBefore);
  const run = cp.spawnSync(process.execPath, [path.join(sourceRoot, 'bin', 'leerness.js'), 'release', 'bump', '--patch', '--path', root], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000
  });
  const after = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const readmeAfter = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const unknownFlag = /unknown flag|알 수 없는 플래그/i.test(`${run.stdout}\n${run.stderr}`);
  return { ok: run.status === 0 && !unknownFlag && after === '1.0.1' && readmeAfter === readmeBefore, after, unknownFlag, exit: run.status };
}

function runPreflightFailureProbe(root) {
  copyFixture(root);
  const cli = path.join(root, 'bin', 'leerness.js');
  const source = fs.readFileSync(cli, 'utf8');
  // 유효한 JS이지만 release preflight가 요구하는 단일 선언 표면은 의도적으로 깨뜨린다.
  fs.writeFileSync(cli, source.replace(/^const VERSION = '([^']+)';$/m, "const VERSION = String('$1');"));
  const targets = [
    path.join(root, 'package.json'),
    path.join(root, '.harness', 'HARNESS_VERSION'),
    cli,
    path.join(root, 'README.md')
  ];
  const before = new Map(targets.map(file => [file, fs.readFileSync(file)]));
  const run = cp.spawnSync(process.execPath, [cli, 'release', 'bump', '--patch', '--path', root, '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000
  });
  const unchanged = targets.every(file => fs.readFileSync(file).equals(before.get(file)));
  let payload = null; try { payload = JSON.parse(run.stdout || ''); } catch {}
  return { ok: run.status !== 0 && unchanged && payload?.code === 'release_preflight_failed', exit: run.status, unchanged, code: payload?.code };
}

function runPartialRollbackProbe(root) {
  copyFixture(root);
  const cli = path.join(root, 'bin', 'leerness.js');
  const targets = [
    path.join(root, 'package.json'),
    path.join(root, '.harness', 'HARNESS_VERSION'),
    cli,
    path.join(root, 'README.md')
  ];
  const before = new Map(targets.map(file => [file, fs.readFileSync(file)]));
  const api = require(cli);
  const snapshots = targets.map(api._releaseFileSnapshot);
  const transaction = api._runReleaseTransaction(snapshots, () => {
    // 실제 release 순서와 같이 package → harness → bin까지 일부 변경한 뒤 실패를 주입한다.
    const pkg = JSON.parse(fs.readFileSync(targets[0], 'utf8'));
    pkg.version = '9.9.9';
    fs.writeFileSync(targets[0], JSON.stringify(pkg, null, 2) + '\n');
    fs.writeFileSync(targets[1], '9.9.9\n');
    fs.writeFileSync(targets[2], fs.readFileSync(targets[2], 'utf8')
      .replace(/^const VERSION = '[^']+';$/m, "const VERSION = '9.9.9';"));
    throw new Error('injected after partial release writes');
  });
  const unchanged = targets.every(file => fs.readFileSync(file).equals(before.get(file)));
  return {
    ok: transaction.ok === false && unchanged && transaction.rollbackErrors.length === 0
      && /injected after partial/.test(String(transaction.error && transaction.error.message)),
    unchanged,
    rollbackErrors: transaction.rollbackErrors
  };
}

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-release-bump-probe-'));
try {
  copyFixture(fixture);
  const own = runProbe(fixture);
  const generic = runGenericProbe(path.join(fixture, 'generic-package'));
  const preflight = runPreflightFailureProbe(path.join(fixture, 'broken-own-package'));
  const partialRollback = runPartialRollbackProbe(path.join(fixture, 'partial-rollback-own-package'));
  if (!(own.ok && generic.ok && preflight.ok && partialRollback.ok)) {
    process.stderr.write(`release-bump probe failed: ${JSON.stringify({ own, generic, preflight, partialRollback })}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`release-bump probe passed: ${own.before} -> ${own.after}; harness ${own.harnessVersion}; generic ${generic.after}; preflight ${preflight.code}; partial rollback restored\n`);
  }
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
