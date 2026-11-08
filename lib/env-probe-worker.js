'use strict';
// T-0363: one probe lane of lib/env-tool-probe. Preloads (--require / NODE_OPTIONS) already ran in
// this thread, so the exports captured here are the same seams bin captures at load.
const { workerData } = require('worker_threads');
const { performance } = require('perf_hooks');
const portable = require('./portable-process');
const npm = require('./npm-process');
const { probeTool, laneLoop, plainRecord, slotDeadline } = require('./env-tool-probe');

const { sab, port, queue, tools, cwd, deadlineHr } = workerData;
const deadlineAt = performance.now() + Number(deadlineHr - process.hrtime.bigint()) / 1e6;
const deps = { spawnPortableSync: portable.spawnPortableSync, spawnNpmSync: npm.spawnNpmSync,
  resolveNpmCliPath: npm.resolveNpmCliPath, resolvePortableLaunch: portable.resolvePortableLaunch };
laneLoop(new Int32Array(sab), queue, i => probeTool(tools[i].name, tools[i].args, { cwd, deadlineAt: slotDeadline(deadlineAt) }, deps),
  record => port.postMessage(plainRecord(record)));
