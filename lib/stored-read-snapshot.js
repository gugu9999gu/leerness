'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { captureCheckedFileInput, assertCheckedFileCurrent, describeCheckedFileInput } = require('./memory-input');
const { decodeText } = require('./managed-text');
const { createRuntimeCompatibilityReader } = require('./runtime-layout');
const changed = () => { throw Object.assign(new Error('Stored read sources changed; retry the read.'), { code: 'E_STORE_CHANGED' }); };
const identity = s => s && [s.dev, s.ino, s.mode].map(String).join(':');
function createSnapshot(root) {
  root = path.resolve(root);
  const runtime = createRuntimeCompatibilityReader(root);
  const initial = runtime();
  if (!initial.compatible) throw Object.assign(new Error(`Runtime layout is not compatible with legacy stored reads (${initial.reasonCode}).`),
    { code: 'E_RUNTIME_LAYOUT_INCOMPATIBLE', reasonCode: initial.reasonCode });
  const canonicalRoot = runtime.snapshot.root;
  const rootExisted = fs.existsSync(root);
  const physical = file => {
    const absolute = path.resolve(file), relative = path.relative(root, absolute);
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
      ? path.resolve(canonicalRoot, relative) : absolute;
  };
  const files = new Map(), directories = new Map(), observed = [], metadata = new Map();
  function directory(file, names = false) {
    file = physical(file);
    if (directories.has(file)) {
      const value = directories.get(file);
      if (names && value.names === null && value.stat) value.names = fs.readdirSync(file).sort();
      return value;
    }
    let stat = null;
    try { stat = fs.lstatSync(file, { bigint: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw Object.assign(new Error('Stored read requires a regular directory.'), { code: 'E_STORE_INVALID', file });
    const value = { stat, names: names && stat ? fs.readdirSync(file).sort() : null };
    directories.set(file, value);
    const relative = path.relative(canonicalRoot, file);
    if (relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) directory(path.dirname(file));
    return value;
  }
  function capture(file) {
    file = physical(file);
    if (files.has(file)) return files.get(file);
    if (!directory(path.dirname(file)).stat) { files.set(file, null); return null; }
    const input = captureCheckedFileInput(file);
    files.set(file, input);
    return input;
  }
  function describe(file) {
    file = physical(file);
    const input = capture(file);
    return input ? describeCheckedFileInput(input, file) : null;
  }
  function observe(item) { observed.push(item); }
  function observeMetadata(file) {
    file = physical(file);
    if (metadata.has(file)) return;
    let value = null;
    try { value = fs.lstatSync(file, { bigint: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    metadata.set(file, value);
    directory(path.dirname(file));
  }
  const sameMetadata = (a, b) => identity(a) === identity(b) && (!a || ['size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]));
  function verify() {
    if (rootExisted) {
      try { if (fs.realpathSync.native(process.platform === 'win32' && root.length >= 260
        ? path.toNamespacedPath(root) : root) !== canonicalRoot) changed(); }
      catch { changed(); }
    }
    for (const [file, input] of files) if (input) assertCheckedFileCurrent(input, file);
    for (const { file, input } of observed) assertCheckedFileCurrent(input, file);
    for (const [file, before] of directories) {
      let now = null;
      try { now = fs.lstatSync(file, { bigint: true }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (identity(now) !== identity(before.stat) || (now && (!now.isDirectory() || now.isSymbolicLink()))) changed();
      if (before.names && JSON.stringify(before.names) !== JSON.stringify(fs.readdirSync(file).sort())) changed();
    }
    for (const [file, before] of metadata) {
      let current = null;
      try { current = fs.lstatSync(file, { bigint: true }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!sameMetadata(before, current)) changed();
    }
    const current = runtime();
    if (!current.compatible || JSON.stringify(current) !== JSON.stringify(initial)) changed();
  }
  function revision() {
    const selectedSources = [...files].filter(([, input]) => input !== null).map(([file, input]) => ({
      path: path.relative(canonicalRoot, file).split(path.sep).join('/'),
      exists: input.exists, byteLength: input.bytes?.length ?? null,
      sha256: input.exists ? createHash('sha256').update(input.bytes).digest('hex') : null,
    }));
    for (const { file, input } of observed) selectedSources.push({ path: path.relative(canonicalRoot, file).split(path.sep).join('/'),
      exists: input.exists, byteLength: input.bytes?.length ?? null,
      sha256: input.exists ? createHash('sha256').update(input.bytes).digest('hex') : null });
    return { selectedSources, selectionDigest: createHash('sha256').update(JSON.stringify(selectedSources)).digest('hex') };
  }
  return Object.freeze({ root, git: runtime.snapshot.git, capture, describe, observe, observeMetadata, verify, revision,
    exists: file => !!capture(file)?.exists,
    read: file => { const input = capture(file); return input?.exists ? decodeText(input.bytes, physical(file)) : ''; },
    readdir: file => { const value = directory(file, true); return value.names ? value.names.slice() : []; },
    directory });
}
module.exports = { createSnapshot };
