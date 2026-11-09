 
 
 
 
'use strict';
const fs = require('fs');
const path = require('path');

 
 
 
 
 
 
 
 
function findCorruptedStateJson(root) {
  const dir = path.join(root, '.leerness');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }   
  const corrupted = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const p = path.join(dir, e.name);
    let text;
    try { text = fs.readFileSync(p, 'utf8'); }
    catch { continue; }   
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   
    if (text.trim() === '') continue;                           
    try { JSON.parse(text); }
    catch (err) { corrupted.push({ file: '.leerness/' + e.name, error: String((err && err.message) || err).slice(0, 200) }); }
  }
  corrupted.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return corrupted;
}

module.exports = { findCorruptedStateJson };
