'use strict';
const fs = require('fs');
const path = require('path');

function assertPublicationAbsent(file, changed, additionalPrefixes = []) {
  const parent = path.dirname(file), prefixes = [`.${path.basename(file)}.publish-cas-`, ...additionalPrefixes];
  const pending = fs.readdirSync(parent).some(name => prefixes.some(prefix => name.startsWith(prefix)
    && /^[A-Za-z0-9]+$/.test(name.slice(prefix.length))));
  if (pending) throw changed(file);
  try { fs.lstatSync(file); }
  catch (cause) { if (cause.code === 'ENOENT') return; throw cause; }
  throw changed(file);
}
module.exports = { assertPublicationAbsent };
