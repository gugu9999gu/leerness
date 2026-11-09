'use strict';
const fs = require('node:fs');
const path = require('node:path');
const defaultReader = { exists: fs.existsSync, readdir: fs.readdirSync,
  read: file => { const text = fs.readFileSync(file, 'utf8'); return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text; } };
const _isRunId = id => typeof id === 'string' && /^run-\d{1,12}$/.test(id);
const _leernessStateDir = root => path.join(path.resolve(root), '.leerness');
const _runStoreError = (message, file) => Object.assign(new Error(message), { code: 'E_STORE_CORRUPT', file });
function detectProjectName(root, reader) {
  try { const pkg = JSON.parse(reader.read(path.join(root, 'package.json'))); if (pkg.name) return pkg.name; } catch {}
  return path.basename(root);
}
function _runFile(root, id) {
  if (!_isRunId(id)) throw _runStoreError('.leerness run id 스키마 무효 — 읽기/쓰기 거부 (run-<숫자> 형식만 허용)', path.join(_leernessStateDir(root), 'runs'));
  return path.join(_leernessStateDir(root), 'runs', `${id}.json`);
}
function loadState(root, reader = defaultReader) {
  const { exists, read, readdir } = reader;
  const f = path.join(_leernessStateDir(root), 'state.json');
  if (!exists(f)) return { schemaVersion: 1, project: detectProjectName(root, reader), currentRunId: null, runCounter: 0, updatedAt: null };

  let _st;
  try { _st = JSON.parse(read(f)); } catch { throw Object.assign(new Error(`.leerness/state.json 손상 — 덮어쓰기 거부: ${f} (복구/삭제 후 재시도)`), { code: 'E_STORE_CORRUPT', file: f }); }



  const _shapeOk = _st && typeof _st === 'object' && !Array.isArray(_st)
    && Number.isInteger(_st.runCounter) && _st.runCounter >= 0



    && (_st.currentRunId === null || _isRunId(_st.currentRunId))



    && (_st.runsBySession === undefined
      || (_st.runsBySession && typeof _st.runsBySession === 'object' && !Array.isArray(_st.runsBySession)
        && Object.values(_st.runsBySession).every(_isRunId)));

  let _maxRun = 0;
  try {
    for (const x of readdir(path.join(_leernessStateDir(root), 'runs'))) {
      const m = /^run-(\d+)\.json$/.exec(x);
      if (m) _maxRun = Math.max(_maxRun, parseInt(m[1], 10));
    }
  } catch {}
  if (!_shapeOk) {
    if (_maxRun > 0) throw Object.assign(new Error(`.leerness/state.json 스키마 무효 — 덮어쓰기 거부: ${f} (runs/ 에 기존 기록 있음 · 복구/삭제 후 재시도)`), { code: 'E_STORE_CORRUPT', file: f });
    return { schemaVersion: 1, project: detectProjectName(root, reader), currentRunId: null, runCounter: 0, updatedAt: null };
  }


  if (_st.runCounter < _maxRun) {
    throw Object.assign(new Error(`.leerness/state.json 카운터 불일치 — 덮어쓰기 거부: runCounter=${_st.runCounter} < 실재 run-${String(_maxRun).padStart(4, '0')} (${f} 복구 또는 runCounter 를 ${_maxRun} 이상으로 수정 후 재시도)`), { code: 'E_STORE_CORRUPT', file: f });
  }
  return _st;
}
function loadRun(root, id, reader = defaultReader) {
  const { exists, read } = reader;
  const f = _runFile(root, id);
  if (!exists(f)) return null;
  let rec;
  try { rec = JSON.parse(read(f)); }
  catch { throw _runStoreError(`.leerness run record 손상 — 읽기/쓰기 거부: ${f}`, f); }
  if (!rec || typeof rec !== 'object' || Array.isArray(rec) || !_isRunId(rec.run_id) || rec.run_id !== id) {
    throw _runStoreError(`.leerness run record 스키마 무효 — 읽기/쓰기 거부: ${f}`, f);
  }
  return rec;
}
module.exports = { loadState, loadRun };
