'use strict';

const { captureMemoryFootprint, footprintErrorCode } = require('./memory-footprint-capture');
const SCHEMA = 'leerness.memory-footprint/v1';
const result = (surface, error = null, measurement = null) => ({ schema: SCHEMA, schemaVersion: 1, surface,
  ok: error === null, readOnly: true, filesRechecked: error === null, recoveryMetadataRechecked: error === null,
  atomicObservation: false, contentValidated: false, approvalGranted: false, writesPerformed: false,
  physicalBytes: null, reservationGranted: false, measurement, error: error ? { code: error } : null });

function inspectMemoryFootprint(root, surface, limitsJson) {
  if (typeof root !== 'string' || !root || root.includes('\0') || root.length > 32768
    || (surface !== 'decisions' && surface !== 'lessons')) return result(null,'invalid_arguments');
  try {
    const captured = captureMemoryFootprint(root,surface,limitsJson);
    captured.recheck();
    return result(surface,null,captured.measurement);
  } catch (error) { return result(surface,footprintErrorCode(error)); }
}

module.exports = { inspectMemoryFootprint };
