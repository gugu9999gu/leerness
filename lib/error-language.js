'use strict';
 
 
 
 
 
 
 
const { AsyncLocalStorage } = require('node:async_hooks');
const scope = new AsyncLocalStorage();
let resolver = null;
const resolving = new WeakSet();
function setErrorLanguage(resolve) { resolver = resolve; }
function errorLanguage() {
  try {
    let language = scope.getStore();
    if (language == null) {
      const current = resolver;
      if (typeof current !== 'function' || resolving.has(current)) return null;
      resolving.add(current);
      try { language = current(); } finally { resolving.delete(current); }
    }
    return language === 'en' || language === 'ko' ? language : null;
  } catch { return null; }
}
function withErrorLanguage(language, action) {
  return scope.run(language === 'en' ? 'en' : 'ko', action);
}
module.exports = { setErrorLanguage, errorLanguage, withErrorLanguage };
