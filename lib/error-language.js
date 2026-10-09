'use strict';
// T-0337: the language of errors built deep in shared modules that have no project root (managed-text, memory-input
// with its byte limit, memory-output with its publication read, state-lock, the session handoff update). The CLI
// registers one resolver (bin/leerness.js, require.main block: the project language of the command's target, the rule
// of the commands' own text); a module asks it when it builds an error. Only an answer of 'en' or 'ko' counts: with
// nothing registered, something that is not a function, a resolver that throws or one that answers anything else,
// errorLanguage() is null and each module keeps the text it had before, so a program that loads these modules without
// the CLI sees no change.
let resolver = null;
function setErrorLanguage(resolve) { resolver = resolve; }
function errorLanguage() {
  try {
    const language = typeof resolver === 'function' ? resolver() : null;
    return language === 'en' || language === 'ko' ? language : null;
  } catch { return null; }
}
module.exports = { setErrorLanguage, errorLanguage };
