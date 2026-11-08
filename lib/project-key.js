'use strict';
// The project key of a repository-relative path. lib/state-paths.js and lib/loop-guard.js share it, so the loop summary of handoff and
// session close can locate its ledger without loading the Git gateway.
const crypto = require('crypto');
module.exports = { projectKeyFor: relative => `project-${crypto.createHash('sha256').update(relative).digest('hex')}` };
