#!/usr/bin/env node
'use strict';

// T-0094: advertised options must change observable behavior (or fail closed).
// This probe intentionally uses isolated projects and real CLI processes so a
// flag that is merely present in source/help cannot pass.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const roots = [];
const children = [];
const failures = [];

function temp(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function write(p, text) { mkdirp(path.dirname(p)); fs.writeFileSync(p, text, 'utf8'); }

function run(args, opts = {}) {
  return cp.spawnSync(process.execPath, [CLI, ...args], {
    cwd: opts.cwd || os.tmpdir(),
    encoding: 'utf8',
    timeout: opts.timeout || 30000,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      LEERNESS_NO_PROMPT: '1',
      LEERNESS_NO_STALE_CHECK: '1',
      ...(opts.env || {}),
    },
  });
}

function git(root, args) {
  const r = cp.spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 15000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`);
  return (r.stdout || '').trim();
}

function json(result) {
  try { return JSON.parse((result.stdout || '').trim()); }
  catch { throw new Error(`invalid JSON (exit ${result.status}): ${(result.stdout || result.stderr || '').slice(0, 300)}`); }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(name, fn) {
  try {
    await fn();
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    process.stdout.write(`not ok - ${name}: ${error.message}\n`);
  }
}

function snapshotFiles(root, rels) {
  return rels.map(rel => {
    const fp = path.join(root, rel);
    return fs.existsSync(fp) ? fs.readFileSync(fp).toString('base64') : null;
  });
}

async function waitForFile(file, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${file}`);
}

async function main() {
  await check('memory archive positional path survives value flags', () => {
    const root = temp('leerness-dead-memory-');
    write(path.join(root, '.leerness', 'decisions.archive.md'), '# Decisions archive\n\n## 제거 2026-01-01 (target: "T-9")\n\n### Old decision\n- Decision: keep evidence\n');
    write(path.join(root, '.leerness', 'lessons.archive.md'), '# Lessons archive\n\n## 제거 2026-01-02 (target: "other")\n\n### Other lesson\n');
    const r = run(['memory', 'archive', 'list', '--surface', 'decisions', '--query', 'T-9', root, '--json']);
    const j = json(r);
    assert(r.status === 0 && j.root === path.resolve(root), `wrong root/status: ${j.root || r.status}; ${JSON.stringify(j)}`);
    assert(j.totals.decisions === 1 && j.totals.lessons === 0 && j.totals.all === 1, `wrong totals: ${JSON.stringify(j.totals)}`);
  });

  await check('intent expand remains exact dry-run and rejects ghost approval flags', () => {
    const root = temp('leerness-dead-intent-');
    const progress = path.join(root, '.leerness', 'progress-tracker.md');
    write(progress, '# Progress\n\n| ID | Request | Status | Evidence | Next action |\n|---|---|---|---|---|\n');
    const before = snapshotFiles(root, ['.leerness/progress-tracker.md', '.leerness/plan.md']);
    const request = '기본 게임 기능을 만들어줘';
    const base = run(['intent', 'expand', request, '--path', root, '--json']);
    const bj = json(base);
    assert(base.status === 0 && bj.text === request && bj.mode === 'dry-run', `base contract drift: ${base.stdout.slice(0, 240)}`);
    for (const extra of [['--expand-all'], ['--select', '1']]) {
      const r = run(['intent', 'expand', request, ...extra, '--path', root, '--json']);
      const j = json(r);
      assert(r.status !== 0 && j.code === 'unknown_flag', `${extra[0]} did not fail closed: ${r.status}/${j.code}`);
    }
    assert(JSON.stringify(snapshotFiles(root, ['.leerness/progress-tracker.md', '.leerness/plan.md'])) === JSON.stringify(before), 'dry-run changed task state');
  });

  await check('auto-update status reports installed, missing, and corrupt state without writes', () => {
    const root = temp('leerness-dead-autoupdate-');
    const settings = path.join(root, '.claude', 'settings.local.json');
    const slash = path.join(root, '.claude', 'commands', 'update.md');
    write(settings, JSON.stringify({ permissions: { allow: ['Read'] }, hooks: { SessionStart: [
      { matcher: '*', command: 'leerness update --check --quiet' },
      { matcher: 'startup|clear|compact', command: 'leerness hook session-start' },
    ] } }, null, 2) + '\n');
    write(slash, '# /update\n\n```\n!leerness update --yes\n```\n\n```\n!leerness update --check\n```\n');
    const before = snapshotFiles(root, ['.claude/settings.local.json', '.claude/commands/update.md']);
    const r = run(['auto-update', 'status', root, '--json']);
    const j = json(r);
    assert(r.status === 0 && j.ok === true && j.installed === true, `installed state not reported: ${r.status}/${r.stdout.slice(0, 240)}`);
    assert(j.hooks && j.hooks.updateCheck === true && j.hooks.contextInjection === true && j.slashCommand === true, 'component status missing');
    assert(JSON.stringify(snapshotFiles(root, ['.claude/settings.local.json', '.claude/commands/update.md'])) === JSON.stringify(before), 'status mutated installed files');

    write(settings, JSON.stringify({ hooks: { SessionStart: [
      { matcher: '*', command: 'leerness update --check' },
      { matcher: 'startup|clear|compact', command: 'leerness hook session-start' },
    ] } }, null, 2) + '\n');
    const degraded = json(run(['auto-update', 'status', root, '--json']));
    assert(degraded.installed === false && degraded.hooks.updateCheck === true && degraded.hooks.updateQuiet === false,
      'non-quiet legacy hook was reported as fully installed');

    write(settings, JSON.stringify({ hooks: { SessionStart: [
      { matcher: '*', command: 'echo leerness update --check --quiet' },
      { matcher: 'startup|clear|compact', command: 'echo leerness hook session-start' },
    ] } }, null, 2) + '\n');
    write(slash, '# /update\n');
    const inert = json(run(['auto-update', 'status', root, '--json']));
    assert(inert.installed === false && inert.hooks.updateCheck === false && inert.hooks.contextInjection === false && inert.slashCommand === false,
      'inert lookalikes were reported as executable installation');
    const repaired = run(['auto-update', 'install', root]);
    const repairedStatus = json(run(['auto-update', 'status', root, '--json']));
    assert(repaired.status === 0 && repairedStatus.installed === true, 'install did not repair inert lookalikes');

    const missing = temp('leerness-dead-autoupdate-missing-');
    const mr = run(['auto-update', 'status', missing, '--json']);
    const mj = json(mr);
    assert(mr.status === 0 && mj.ok === true && mj.installed === false && mj.exists === false, 'missing state is not an honest non-error');
    assert(fs.readdirSync(missing).length === 0, 'missing status created files');

    const corrupt = temp('leerness-dead-autoupdate-corrupt-');
    const corruptFile = path.join(corrupt, '.claude', 'settings.local.json');
    write(corruptFile, '{broken');
    const cr = run(['auto-update', 'status', corrupt, '--json']);
    const cj = json(cr);
    assert(cr.status !== 0 && cj.ok === false && cj.code === 'settings_corrupt' && cj.installed === false, 'corrupt state did not fail honestly');
    assert(fs.readFileSync(corruptFile, 'utf8') === '{broken', 'corrupt status rewrote source');

    for (const malformed of [
      'null',
      '[]',
      '{"hooks":[]}',
      '{"hooks":{"SessionStart":{}}}',
      '{"hooks":{"SessionStart":[42]}}',
      '{"hooks":{"SessionStart":[{"matcher":42,"command":"leerness update --check --quiet"}]}}',
      '{"hooks":{"SessionStart":[{"hooks":[null]}]}}',
    ]) {
      const malformedRoot = temp('leerness-dead-autoupdate-shape-');
      const malformedFile = path.join(malformedRoot, '.claude', 'settings.local.json');
      write(malformedFile, malformed);
      const sr = run(['auto-update', 'status', malformedRoot, '--json']);
      const sj = json(sr);
      assert(sr.status !== 0 && sj.code === 'settings_corrupt' && sj.valid === false,
        `malformed settings accepted by status: ${malformed}`);
      const ir = run(['auto-update', 'install', malformedRoot]);
      assert(ir.status !== 0 && fs.readFileSync(malformedFile, 'utf8') === malformed,
        `malformed settings overwritten by install: ${malformed}`);
    }

    const notDir = path.join(temp('leerness-dead-autoupdate-file-'), 'package.json');
    write(notDir, '{}\n');
    const fr = run(['auto-update', 'status', notDir, '--json']);
    const fj = json(fr);
    assert(fr.status !== 0 && fj.code === 'path_not_directory', `file root accepted: ${fr.status}/${fr.stdout.slice(0, 200)}`);
  });

  await check('release cleanup honors keep=0 and rejects negative keep', () => {
    const root = temp('leerness-dead-release-');
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'probe@example.invalid']);
    git(root, ['config', 'user.name', 'Leerness Probe']);
    write(path.join(root, 'seed.txt'), 'seed\n');
    git(root, ['add', 'seed.txt']);
    git(root, ['commit', '-m', 'seed']);
    git(root, ['branch', 'release/1.0.0']);
    git(root, ['branch', 'release/1.0.1']);
    const r = run(['release', 'cleanup', root, '--keep', '0', '--json']);
    const j = json(r);
    assert(r.status === 0 && j.keep === 0 && j.deleteCount === 2 && j.apply === false, `keep=0 ignored: ${r.stdout.slice(0, 240)}`);
    assert(git(root, ['branch', '--list', 'release/*']).split(/\r?\n/).filter(Boolean).length === 2, 'dry-run deleted branches');
    const nr = run(['release', 'cleanup', root, '--keep', '-3', '--json']);
    const nj = json(nr);
    assert(nr.status !== 0 && nj.code === 'invalid_keep', `negative keep accepted: ${nr.status}/${nr.stdout.slice(0, 160)}`);
  });

  await check('setup-agents no-setup flag is an explicit read-only skip', () => {
    const root = temp('leerness-dead-agents-');
    write(path.join(root, 'keep.txt'), 'keep\n');
    const before = snapshotFiles(root, ['keep.txt', '.env', '.leerness/providers.json']);
    const r = run(['setup-agents', '--no-setup-agents', '--path', root, '--json']);
    const j = json(r);
    assert(r.status === 0 && j.ok === true && j.skipped === true && j.reason === 'no_setup_agents' && j.root === path.resolve(root), `skip not explicit: ${r.status}/${r.stdout.slice(0, 240)}`);
    assert(JSON.stringify(snapshotFiles(root, ['keep.txt', '.env', '.leerness/providers.json'])) === JSON.stringify(before), 'skip mutated project');

    const configured = temp('leerness-dead-agents-init-');
    const configFile = path.join(configured, '.leerness', 'leerness-config.json');
    write(configFile, JSON.stringify({ LEERNESS_ENABLE_CODEX: '1', CUSTOM_KEEP: 'yes' }, null, 2) + '\n');
    const init = run(['init', configured, '--yes', '--no-setup-agents', '--minimal', '--no-env', '--no-auto-update', '--no-auto-roadmap', '--no-enforce', '--no-mcp', '--no-banner', '--language', 'en', '--json'], { timeout: 120000 });
    assert(init.status === 0, `init opt-out failed: ${(init.stdout || init.stderr).slice(0, 240)}`);
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    assert(config.LEERNESS_ENABLE_CODEX === '1' && config.CUSTOM_KEEP === 'yes', 'init opt-out overwrote existing agent configuration');
    assert(!Object.keys(config).some(k => /^LEERNESS_ENABLE_/.test(k) && k !== 'LEERNESS_ENABLE_CODEX'), 'init opt-out introduced provider decisions');

    const fresh = temp('leerness-dead-agents-fresh-');
    const freshInit = run(['init', fresh, '--yes', '--no-setup-agents', '--minimal', '--no-env', '--no-auto-update', '--no-auto-roadmap', '--no-enforce', '--no-mcp', '--no-banner', '--language', 'en', '--json'], { timeout: 120000 });
    assert(freshInit.status === 0, `fresh init opt-out failed: ${(freshInit.stdout || freshInit.stderr).slice(0, 240)}`);
    const freshConfig = JSON.parse(fs.readFileSync(path.join(fresh, '.leerness', 'leerness-config.json'), 'utf8'));
    assert(!Object.keys(freshConfig).some(k => /^LEERNESS_ENABLE_/.test(k)), 'fresh init opt-out wrote implicit provider flags');
  });

  await check('provider add persists and exposes env/version/description options', () => {
    const root = temp('leerness-dead-provider-');
    // A value that itself starts with "--" uses the CLI's documented
    // --flag=value spelling so it cannot be mistaken for another option.
    const add = run(['provider', 'add', 'probeai', '--bin', 'probe-ai', '--env-flag', 'PROBE_AI_ON', '--version-args=--version --verbose', '--desc', 'Probe provider', '--path', root]);
    assert(add.status === 0, `provider add failed: ${(add.stdout || add.stderr).slice(0, 240)}`);
    const stored = JSON.parse(fs.readFileSync(path.join(root, '.leerness', 'providers.json'), 'utf8'));
    const entry = (Array.isArray(stored) ? stored : stored.providers).find(p => p.id === 'probeai');
    assert(entry && entry.envFlag === 'PROBE_AI_ON' && entry.desc === 'Probe provider', 'stored fields missing');
    assert(JSON.stringify(entry.versionArgs) === JSON.stringify(['--version', '--verbose']), `stored versionArgs wrong: ${JSON.stringify(entry && entry.versionArgs)}`);
    const lr = run(['provider', 'list', '--path', root, '--json']);
    const listed = json(lr).providers.find(p => p.id === 'probeai');
    assert(listed && listed.envFlag === 'PROBE_AI_ON' && listed.desc === 'Probe provider', 'list omits env/desc');
    assert(JSON.stringify(listed.versionArgs) === JSON.stringify(['--version', '--verbose']), 'list omits versionArgs');
    const enList = run(['provider', 'list', '--path', root, '--language', 'en']);
    assert(enList.status === 0 && !/[가-힣ㄱ-ㆎ]/.test(enList.stdout + enList.stderr), 'English provider list leaked Korean built-in descriptions');
  });

  await check('reuse-map strict-elements changes duplicate analysis', () => {
    const a = temp('leerness-dead-reuse-a-');
    const b = temp('leerness-dead-reuse-b-');
    write(path.join(a, '.leerness', 'reuse-map.md'), '# Reuse Map\n\n| Capability | Element | Method | Notes |\n|---|---|---|---|\n| HtmlEscape | src/util.js (escapeHtml) | util | XSS |\n');
    write(path.join(b, '.leerness', 'reuse-map.md'), '# Reuse Map\n\n| Capability | Element | Method | Notes |\n|---|---|---|---|\n| MarkupEscape | src/build.js (escapeHtml) | util | markup |\n');
    const include = `${a},${b}`;
    const base = json(run(['reuse-map', '--include', include, '--json']));
    const strict = json(run(['reuse-map', '--include', include, '--strict-elements', '--json']));
    assert(base.strictElements === false && base.fuzzyDuplicates.length === 0, 'default unexpectedly ran fuzzy analysis');
    assert(strict.strictElements === true && strict.fuzzyDuplicates.length === 1 && strict.fuzzyDuplicates[0].functionName === 'escapehtml', 'strict analysis missing');
  });

  await check('api-skill no-crawl suppresses secondary HTTP requests', async () => {
    const serverRoot = temp('leerness-dead-api-server-');
    const serverFile = path.join(serverRoot, 'server.js');
    const portFile = path.join(serverRoot, 'port.txt');
    const countFile = path.join(serverRoot, 'counts.json');
    write(serverFile, [
      "'use strict';",
      "const fs=require('fs'); const http=require('http');",
      "const portFile=process.argv[2], countFile=process.argv[3]; const count={root:0,related:0};",
      "const save=()=>fs.writeFileSync(countFile,JSON.stringify(count));",
      "const server=http.createServer((req,res)=>{",
      " if(req.url==='/related'){count.related++;save();res.end('<html><title>Related</title><body>secondary</body></html>');return;}",
      " count.root++;save();res.end('<html><title>Root API</title><body>primary<a href=\"/related\">related</a></body></html>');",
      "});",
      "server.listen(0,'127.0.0.1',()=>fs.writeFileSync(portFile,String(server.address().port)));",
      "process.on('SIGTERM',()=>server.close(()=>process.exit(0)));",
    ].join('\n'));
    const child = cp.spawn(process.execPath, [serverFile, portFile, countFile], { stdio: 'ignore' });
    children.push(child);
    await waitForFile(portFile);
    const url = `http://127.0.0.1:${fs.readFileSync(portFile, 'utf8').trim()}/`;
    const noRoot = temp('leerness-dead-api-no-');
    const nr = run(['api-skill', 'add', url, '--no-crawl', '--path', noRoot, '--json']);
    const nj = json(nr);
    const afterNo = JSON.parse(fs.readFileSync(countFile, 'utf8'));
    assert(nr.status === 0 && nj.ok === true && nj.crawl === false && nj.related_count === 0, `no-crawl result opaque/wrong: ${nr.stdout.slice(0, 240)}`);
    assert(afterNo.root === 1 && afterNo.related === 0, `secondary fetch occurred: ${JSON.stringify(afterNo)}`);
    const beforeRoot = afterNo.root;
    const noRootFirst = temp('leerness-dead-api-no-first-');
    const nfr = run(['api-skill', 'add', '--no-crawl', url, '--path', noRootFirst, '--json']);
    const nfj = json(nfr);
    const afterFirst = JSON.parse(fs.readFileSync(countFile, 'utf8'));
    assert(nfr.status === 0 && nfj.crawl === false && afterFirst.root === beforeRoot + 1 && afterFirst.related === 0,
      `boolean-before-positional order failed: ${nfr.status}/${nfr.stdout.slice(0, 200)}`);
    const yesRoot = temp('leerness-dead-api-yes-');
    const yr = run(['api-skill', 'add', url, '--path', yesRoot, '--json']);
    const yj = json(yr);
    const afterYes = JSON.parse(fs.readFileSync(countFile, 'utf8'));
    assert(yr.status === 0 && yj.crawl === true && yj.related_count >= 1 && afterYes.related >= 1, `default crawl did not fetch related link: ${yr.stdout.slice(0, 240)}`);
    child.kill();
  });

  await check('parent adopt select value is not mistaken for a project path', () => {
    const parent = temp('leerness-dead-parent-');
    const child = path.join(parent, 'child');
    mkdirp(child);
    write(path.join(parent, '.leerness', 'design-system.md'), '# Parent design\n');
    const r = run(['parent', 'adopt', '--select', 'design-system', '--apply', '--json'], { cwd: child });
    const j = json(r);
    assert(r.status === 0 && j.applied === true && j.root === path.resolve(child), `cwd root lost: ${r.status}/${r.stdout.slice(0, 240)}`);
    const link = JSON.parse(fs.readFileSync(path.join(child, '.leerness', 'PARENT_LINK.json'), 'utf8'));
    assert(JSON.stringify(link.adoptedKinds) === JSON.stringify(['design-system']), `selection ignored: ${JSON.stringify(link.adoptedKinds)}`);
  });

  await check('toggle get returns one read-only toggle', () => {
    const root = temp('leerness-dead-toggle-');
    const r = run(['toggle', 'get', 'gate', '--path', root, '--json']);
    const j = json(r);
    assert(r.status === 0 && j.ok === true && j.id === 'gate' && j.value === true && j.corrupt === false && j.source === 'default', `toggle get failed: ${r.status}/${r.stdout.slice(0, 240)}`);
    assert(fs.readdirSync(root).length === 0, 'toggle get created state');

    const toggles = path.join(root, '.leerness', 'toggles.json');
    write(toggles, JSON.stringify({ lens: false }) + '\n');
    const absent = json(run(['toggle', 'get', 'gate', '--path', root, '--json']));
    assert(absent.source === 'default' && absent.value === true, 'unpersisted id was mislabeled stored');
    write(toggles, JSON.stringify({ gate: 'banana' }) + '\n');
    const unreadable = json(run(['toggle', 'get', 'gate', '--path', root, '--json']));
    assert(unreadable.source === 'default' && unreadable.unreadable === true && unreadable.value === true,
      'unreadable id was mislabeled stored');
    for (const inherited of ['toString', 'constructor', '__proto__']) {
      const badGet = run(['toggle', 'get', inherited, '--path', root, '--json']);
      assert(badGet.status !== 0 && json(badGet).ok === false, `prototype toggle id accepted by get: ${inherited}`);
      const badSet = run(['toggle', 'set', inherited, 'on', '--path', root, '--json']);
      assert(badSet.status !== 0 && json(badSet).ok === false, `prototype toggle id accepted by set: ${inherited}`);
    }
  });

  await check('MCP mirrors provider metadata and api no-crawl options', () => {
    const tools = require('../lib/mcp-tools');
    const provider = tools.find(tool => tool.name === 'leerness_provider_list');
    const api = tools.find(tool => tool.name === 'leerness_api_skill');
    const src = fs.readFileSync(CLI, 'utf8');
    assert(provider && /versionArgs/.test(provider.description) && /installHint/.test(provider.description), 'provider MCP contract is stale');
    assert(api && api.inputSchema.properties.noCrawl && api.inputSchema.properties.name, 'api MCP schema omits noCrawl/name');
    assert(/args\.noCrawl === true\) cliArgs\.push\('--no-crawl'\)/.test(src), 'api MCP dispatcher drops noCrawl');
  });

  if (failures.length) {
    process.stderr.write(`DEAD_FLAGS_PROBE_FAILED: ${failures.length}\n${failures.map(x => `- ${x}`).join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('dead flags probe passed\n');
  }
}

main().catch(error => {
  process.stderr.write(`DEAD_FLAGS_PROBE_FAILED: fatal: ${error.stack || error.message}\n`);
  process.exitCode = 1;
}).finally(() => {
  for (const child of children) { try { child.kill(); } catch {} }
  for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} }
});
