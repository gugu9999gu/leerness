'use strict';

 
 
function shouldRunDoctorSelftest(opts = {}, env = process.env) {
  if (typeof opts.selftest === 'boolean') return opts.selftest;
  return env.LEERNESS_DOCTOR_SELFTEST === '1';
}

function executionError(reason) {
  return {
    status: 'error', pass: 0, total: 0, ok: false,
    failed: ['selftest execution failed'], reason,
  };
}

function normalizeReport(report) {
  if (!report || !Number.isSafeInteger(report.pass)
      || !Number.isSafeInteger(report.total) || report.total <= 0
      || report.pass < 0 || report.pass > report.total
      || !Array.isArray(report.failed)
      || !report.failed.every(name => typeof name === 'string' && name.trim())
      || report.failed.length !== report.total - report.pass
      || typeof report.ok !== 'boolean'
      || report.ok !== (report.pass === report.total)) {
    return executionError('invalid_report');
  }
  return {
    status: report.ok ? 'passed' : 'failed',
    pass: report.pass, total: report.total, ok: report.ok,
    failed: report.failed.slice(),
  };
}

function runDoctorSelftest(enabled, deps = {}) {
  if (enabled !== true) {
    return {
      status: 'not_run', pass: 0, total: 0, ok: null, failed: [],
      reason: 'opt_in_required', command: 'leerness selftest',
    };
  }

   
   
  if (typeof deps._selfTestReport === 'function') {
    try { return normalizeReport(deps._selfTestReport()); }
    catch { return executionError('subprocess_error'); }
  }
  if (typeof deps._selfTestCases !== 'function') {
    return executionError('runner_unavailable');
  }

   
  let controlledEnv;
  let result;
  try {
    if (typeof deps._controlSelftestEnv === 'function') {
      controlledEnv = deps._controlSelftestEnv();
    }
    const cases = deps._selfTestCases();
    if (!Array.isArray(cases) || cases.length === 0
        || cases.some(c => !c || typeof c.name !== 'string' || !c.name.trim()
          || typeof c.run !== 'function')) {
      result = executionError('invalid_cases');
    } else {
      let pass = 0;
      const failed = [];
      for (const c of cases) {
        let ok = false;
        try {
          const value = c.run();
          if (value && typeof value.then === 'function') {
             
            Promise.resolve(value).catch(() => {});
          } else {
            ok = !!value;
          }
        } catch {   }
        if (ok) pass++; else failed.push(c.name);
      }
      result = normalizeReport({ pass, total: cases.length, failed, ok: failed.length === 0 });
    }
  } catch {
    result = executionError('inline_execution_error');
  } finally {
    try {
      if (controlledEnv && typeof controlledEnv.restore === 'function') controlledEnv.restore();
    } catch {
      result = executionError('environment_restore_error');
    }
  }
  return result;
}

module.exports = { shouldRunDoctorSelftest, runDoctorSelftest };
