'use strict';
// T-0337: the remaining fixed-language errors on the shared write path follow the project language. lib/memory-input.js
// and lib/memory-output.js gave every project an English reason with Korean advice; lib/memory-input-bytes.js,
// lib/memory-publication-read.js, the session handoff update (lib/context-current.js) and two state-lock errors were
// English everywhere; the state-lock timeout, fail-open and release messages were Korean everywhere; and the ten notes
// that say what a partly finished save left behind were English, appended to errors in either language. The modules ask
// lib/error-language.js, where the CLI registers the language of its own text (--language, LEERNESS_LANG, then the
// manifest of the project named by --path or a path argument); the notes use that rule directly. Codes are unchanged,
// every existing text stays byte for byte in the language that had it, and a program that loads the modules without
// the CLI keeps the text they had before. Module messages are checked whole, in every language state, by direct calls
// in a child process (faults are injected there, never in this process); the command tests run the CLI against copies
// of initialized seeds in folders with Hangul in their names, from the arena, never from the project.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
const CLI = path.resolve(__dirname, '../bin/leerness.js'), LIB = path.resolve(__dirname, '../lib');
const observe = fn => { try { fn(); return null; } catch (e) { return { code: e && e.code, message: e && e.message }; } };
const observeAsync = async fn => { try { await fn(); return null; } catch (e) { return { code: e && e.code, message: e && e.message }; } };

// Every reason a module gives, as [code, English, Korean]. The call-shape test below requires the sources to name
// exactly these pairs, so a reason added without its Korean text, or changed in one language only, fails here.
const MEMORY_INPUT = {
  parentNotDirectory: ['E_STORE_INVALID', 'parent is not a regular directory', '읽으려는 파일의 상위 폴더가 일반 폴더가 아닙니다'],
  hardLinked: ['E_STORE_INVALID', 'is not a single-link regular file', '읽으려는 파일이 하드 링크가 하나뿐인 일반 파일이 아닙니다'],
  overLimit: ['E_STORE_LIMIT', 'exceeds diagnostic byte limit', '읽으려는 파일이 바이트 한도를 넘습니다'],
  identity: ['E_STORE_INVALID', 'descriptor identity is unavailable', '읽으려는 파일의 식별 정보를 얻을 수 없습니다'],
  unreadable: ['E_STORE_UNREADABLE', 'could not be read', '파일을 읽지 못했습니다'],
  unclosed: ['E_STORE_UNREADABLE', 'could not be closed', '파일을 닫지 못했습니다'],
  malformed: ['E_STORE_CORRUPT', 'has malformed UTF-8', '파일에 UTF-8 로 읽을 수 없는 바이트가 있습니다'],
  limitsInvalid: ['E_STORE_INVALID', 'explicit input limits are invalid', '지정한 입력 한도가 올바르지 않습니다'],
  tooDeep: ['E_STORE_LIMIT', 'exceeds declared JSON depth', 'JSON 의 깊이가 지정한 한도를 넘습니다'],
  invalidJson: ['E_STORE_CORRUPT', 'has invalid JSON', '파일의 JSON 이 올바르지 않습니다'],
  notArray: ['E_STORE_INVALID', 'JSON root is not an array', 'JSON 의 최상위가 배열이 아닙니다'],
  legacyNotArray: ['E_STORE_INVALID', 'legacy parser did not return an array', '이전 형식을 읽은 결과가 배열이 아닙니다'],
  byteLimitInvalid: ['E_STORE_INVALID', 'diagnostic byte limit is invalid', '지정한 바이트 한도가 올바르지 않습니다'],
  legacySnapshot: ['E_STORE_INVALID', 'legacy snapshot does not belong to this file', '이전 형식 스냅숏이 이 파일의 것이 아닙니다'],
  fileSnapshot: ['E_STORE_INVALID', 'snapshot does not belong to this file', '스냅숏이 이 파일의 것이 아닙니다'],
  storeSnapshot: ['E_STORE_INVALID', 'snapshot does not belong to this store', '스냅숏이 이 저장소의 것이 아닙니다'],
  describedSnapshot: ['E_STORE_INVALID', 'snapshot does not belong to file', '스냅숏이 이 파일의 것이 아닙니다'],
  changed: ['E_STORE_CHANGED', 'changed during operation', '작업하는 동안 파일이 바뀌었습니다'],
};
const MEMORY_OUTPUT = {
  changed: ['E_OUTPUT_CHANGED', 'changed before publication', '저장하기 전에 파일이 바뀌었습니다'],
  parentResolution: ['E_OUTPUT_CHANGED', 'parent resolution is unreadable', '대상 파일의 상위 폴더 경로를 확인할 수 없습니다'],
  parentUnreadable: ['E_OUTPUT_CHANGED', 'parent is unreadable', '대상 파일의 상위 폴더를 읽을 수 없습니다'],
  parentNotDirectory: ['E_OUTPUT_CHANGED', 'parent is not a stable directory', '대상 파일의 상위 폴더가 안정된 일반 폴더가 아닙니다'],
  targetUnreadable: ['E_OUTPUT_CHANGED', 'target is unreadable', '대상 파일을 읽을 수 없습니다'],
  absenceParentChanged: ['E_OUTPUT_CHANGED', 'parent changed while observing absence', '파일이 없음을 확인하는 동안 상위 폴더가 바뀌었습니다'],
  hardLinked: ['E_OUTPUT_CHANGED', 'target is not a single-link regular file', '대상 파일이 하드 링크가 하나뿐인 일반 파일이 아닙니다'],
  overLimit: ['E_OUTPUT_LIMIT', 'exceeds declared byte limit', '대상 파일이 지정한 바이트 한도를 넘습니다'],
  unsafe: ['E_OUTPUT_CHANGED', 'target could not be observed safely', '대상 파일을 안전하게 확인하지 못했습니다'],
  snapshot: ['E_OUTPUT_CHANGED', 'snapshot does not belong to target', '스냅숏이 이 대상 파일의 것이 아닙니다'],
  createdByOther: ['E_OUTPUT_CHANGED', 'another writer created the target', '다른 작업이 대상 파일을 먼저 만들었습니다'],
  newTargetInvalid: ['E_OUTPUT_CHANGED', 'new target failed post-publication validation', '새로 만든 대상 파일이 저장 후 검증을 통과하지 못했습니다'],
  changedAfter: ['E_OUTPUT_CHANGED', 'target or parent changed after publication', '저장한 뒤 대상 파일이나 상위 폴더가 바뀌었습니다'],
  // The next three are on the POSIX rename-away path only: the call-shape test covers them, the direct calls do not.
  wonWindow: ['E_OUTPUT_CHANGED', 'another writer won the compare-and-publish window', '비교하고 저장하는 사이에 다른 작업이 먼저 썼습니다'],
  createdDuring: ['E_OUTPUT_CHANGED', 'another writer created the target during publication', '저장하는 동안 다른 작업이 대상 파일을 만들었습니다'],
  publishedInvalid: ['E_OUTPUT_CHANGED', 'published target failed validation', '저장한 대상 파일이 검증을 통과하지 못했습니다'],
  preparedOverLimit: ['E_OUTPUT_LIMIT', 'prepared output exceeds declared byte limit', '저장할 내용이 지정한 바이트 한도를 넘습니다'],
};
const UNAVAILABLE = {
  limitInvalid: ['E_OUTPUT_CAS_UNAVAILABLE', 'explicit byte limit is invalid', '지정한 바이트 한도가 올바르지 않습니다'],
  linkFailed: ['E_OUTPUT_CAS_UNAVAILABLE', 'exclusive hard-link install failed (${error.code})', '하드 링크로 새 파일을 단독 설치하지 못했습니다 (${error.code})'],
};
const HANDOFF = {
  frontmatter: ['Session handoff frontmatter is not closed', '세션 인계 문서의 머리말(frontmatter)이 닫혀 있지 않습니다'],
  reserved: ['Generated content contains reserved handoff markers', '생성한 내용에 인계 문서 예약 표식이 들어 있습니다'],
  ambiguous: ['Ambiguous generated handoff markers', '인계 문서의 생성 구역 표식이 모호합니다'],
};
const ADVICE = { input: ['preserve the original, check its state and retry', '원본을 보존하고 상태를 확인한 뒤 재시도하세요'],
  output: ['preserve the external change and retry', '외부 변경을 보존하고 다시 시도하세요'] };
// The message each language state gives. 'unset' is a program without the CLI: the text from before T-0337.
const inputText = (state, [, en, ko], file) => state === 'ko' ? `${ko}: ${file} — ${ADVICE.input[1]}`
  : `Memory input ${en}: ${file} — ${state === 'en' ? ADVICE.input[0] : ADVICE.input[1]}`;
const outputText = (state, [, en, ko], file) => state === 'ko' ? `${ko}: ${file} — ${ADVICE.output[1]}`
  : `Memory output ${en}: ${file} — ${state === 'en' ? ADVICE.output[0] : ADVICE.output[1]}`;
const unavailableText = (state, en, ko, file) => state === 'ko' ? `파일을 비교한 뒤 저장하는 방식을 쓸 수 없습니다: ${file} — ${ko}`
  : `Memory output compare-and-publish unavailable: ${file} — ${en}`;
const BYTES_TEXT = ['Memory diagnostic byte limit exceeded.', '파일이 바이트 한도를 넘었습니다.'];
const READ_TEXT = ['Memory publication read failed', '저장 대상 파일을 읽어 확인하지 못했습니다'];
const LOCK = {
  ownership: ['state lock ownership was lost before nested work', '중첩 작업을 시작하기 전에 상태 잠금 소유권을 잃었습니다'],
  busy: ['state lock is held by another async operation in this process', '같은 프로세스의 다른 비동기 작업이 상태 잠금을 잡고 있습니다'],
  stopped: (file, why) => [`Lock acquisition failed — stopped to protect the data from concurrent writes: ${file} (${why})`,
    `락 획득 실패 — 동시 쓰기로부터 데이터를 보호하기 위해 중단합니다: ${file} (${why})`],
  warning: (file, why) => [`⚠ Lock acquisition failed — continuing without protection for a non-critical record only: ${file} (${why}).\n`,
    `⚠ 락 획득 실패 — 비핵심 기록만 보호 없이 진행합니다: ${file} (${why}).\n`],
  release: (file, reason) => [`Lock ownership could not be confirmed, so the result is not reported as a success: ${file} (${reason})`,
    `락 소유권을 확인하지 못해 작업 결과를 성공으로 확정하지 않습니다: ${file} (${reason})`],
};
// The release failure is also written to stderr as a warning.
const releaseWarning = (state, file, reason) => `⚠ ${LOCK.release(file, reason)[state === 'en' ? 0 : 1]}\n`;
// Language states of the direct calls: nothing registered, the two languages, then three that count as nothing
// registered: a resolver that throws, a value that is not a function and a resolver that answers another language.
const STATES = [['unset', undefined], ['ko', () => 'ko'], ['en', () => 'en'], ['throws', () => { throw new Error('no language'); }], ['value', 'ko'], ['other', () => 'fr']];
const pick = (state, [en, ko]) => state === 'ko' ? ko : en;

// ---- direct calls, in a child process of this file ------------------------------------------------------------------
const directAt = process.argv.indexOf('--direct');
if (directAt >= 0) {
  const [mode, dir, outFile] = process.argv.slice(directAt + 1);
  const language = require('../lib/error-language');
  const swap = (owner, key, make, fn) => { const real = owner[key]; owner[key] = make(real); try { return fn(); } finally { owner[key] = real; } };
  const fault = code => Object.assign(new Error('probe fault'), { code });
  let made = 0;
  const fresh = (name, bytes) => { const p = path.join(dir, `${++made}-${name}`); if (bytes !== undefined) fs.writeFileSync(p, bytes); return p; };
  const statCopy = (s, change) => Object.assign(Object.create(Object.getPrototypeOf(s)), s, change);
  const main = async () => {
    const out = {};
    if (mode === 'modules') {
      const input = require('../lib/memory-input'), bytes = require('../lib/memory-input-bytes'), read = require('../lib/memory-publication-read');
      const output = require('../lib/memory-output'), handoff = require('../lib/context-current'), io = require('../lib/io');
      // Each case gives the file its message names and the call; it runs once in every language state.
      const inputCases = {
        parentNotDirectory: () => { const f = path.join(fresh('parent.txt', 'x'), 'store.json'); return [f, () => input.captureCheckedFileInput(f)]; },
        hardLinked: () => { const f = fresh('linked.json', '[]'); fs.linkSync(f, f + '.2'); return [f, () => input.captureCheckedFileInput(f)]; },
        overLimit: () => { const f = fresh('big.json', '[1,2,3,4,5]'); return [f, () => input.captureCheckedFileInput(f, { maxBytes: 4 })]; },
        unreadable: () => { const f = fresh('denied.json', '[]'); return [f, () => swap(fs, 'lstatSync', real => function (p, ...rest) { if (p === f) throw fault('EACCES'); return real.call(fs, p, ...rest); }, () => input.captureCheckedFileInput(f))]; },
        unclosed: () => { const f = fresh('close.json', '[]'); return [f, () => swap(fs, 'closeSync', () => () => { throw fault('EIO'); }, () => input.captureCheckedFileInput(f))]; },
        malformed: () => { const f = fresh('bad.json', Buffer.from([0x5b, 0xff, 0x5d])); return [f, () => input.captureMemoryInput(f, fresh('bad.md'), () => [])]; },
        limitsInvalid: () => { const f = fresh('limits.json', '[]'); return [f, () => input.captureMemoryInput(f, fresh('limits.md'), () => [], { maxBytes: -1 })]; },
        tooDeep: () => { const f = fresh('deep.json', '[[[1]]]'); return [f, () => input.captureMemoryInput(f, fresh('deep.md'), () => [], { maxDepth: 1 })]; },
        invalidJson: () => { const f = fresh('open.json', '['); return [f, () => input.captureMemoryInput(f, fresh('open.md'), () => [])]; },
        notArray: () => { const f = fresh('object.json', '{}'); return [f, () => input.captureMemoryInput(f, fresh('object.md'), () => [])]; },
        legacyNotArray: () => { const f = fresh('legacy.md', '# legacy\n'); return [f, () => input.captureMemoryInput(fresh('absent.json'), f, () => ({}))]; },
        byteLimitInvalid: () => { const f = fresh('limit.json', '[]'); return [f, () => input.captureCheckedFileInput(f, { maxBytes: -1 })]; },
        legacySnapshot: () => { const f = fresh('other.md'); return [f, () => input.getLegacyMemoryInput({}, f)]; },
        fileSnapshot: () => { const f = fresh('other.json'); return [f, () => input.assertCheckedFileCurrent({}, f)]; },
        storeSnapshot: () => { const f = fresh('store.json'); return [f, () => input.assertMemoryInputCurrent({}, f, fresh('store.md'))]; },
        describedSnapshot: () => { const f = fresh('described.json'); return [f, () => input.describeCheckedFileInput({}, f)]; },
        changed: () => { const f = fresh('changed.json', '[1]'); return [f, () => { const snapshot = input.captureCheckedFileInput(f); fs.writeFileSync(f, '[1,2]'); input.assertCheckedFileCurrent(snapshot, f); }]; },
      };
      // Windows only: a descriptor without a volume or file id cannot certify the file.
      if (process.platform === 'win32') inputCases.identity = () => { const f = fresh('identity.json', '[]'); return [f, () => swap(fs, 'fstatSync', real => function (...args) { return statCopy(real.apply(fs, args), { ino: 0n }); }, () => input.captureCheckedFileInput(f))]; };
      const absent = name => fresh(name);
      const outputCases = {
        changed: () => { const f = fresh('out-changed.txt', 'before\n'); return [f, () => { const token = output.captureMemoryOutput(f); fs.writeFileSync(f, 'after\n'); output.assertMemoryOutputCurrent(token, f); }]; },
        parentResolution: () => { const f = fresh('out-resolve.txt', 'x'); return [f, () => swap(fs.realpathSync, 'native', () => () => { throw fault('EACCES'); }, () => output.captureMemoryOutput(f))]; },
        parentUnreadable: () => { const f = fresh('out-parent.txt', 'x'); return [f, () => swap(fs, 'lstatSync', real => function (p, ...rest) { if (p === path.dirname(f)) throw fault('EACCES'); return real.call(fs, p, ...rest); }, () => output.captureMemoryOutput(f))]; },
        parentNotDirectory: () => { const f = path.join(fresh('out-parent-file.txt', 'x'), 'target.txt'); return [f, () => output.captureMemoryOutput(f)]; },
        targetUnreadable: () => { const f = fresh('out-denied.txt', 'x'); return [f, () => swap(fs, 'lstatSync', real => function (p, ...rest) { if (p === f) throw fault('EACCES'); return real.call(fs, p, ...rest); }, () => output.captureMemoryOutput(f))]; },
        absenceParentChanged: () => { const f = absent('out-absent.txt'); let calls = 0; return [f, () => swap(fs, 'lstatSync', real => function (p, ...rest) { const s = real.call(fs, p, ...rest); return p === path.dirname(f) && ++calls === 2 ? statCopy(s, { dev: s.dev + 1 }) : s; }, () => output.captureMemoryOutput(f))]; },
        hardLinked: () => { const f = fresh('out-linked.txt', 'x'); fs.linkSync(f, f + '.2'); return [f, () => output.captureMemoryOutput(f)]; },
        overLimit: () => { const f = fresh('out-big.txt', '0123456789'); return [f, () => output.captureMemoryOutput(f, { maxBytes: 2 })]; },
        unsafe: () => { const f = fresh('out-open.txt', 'x'); return [f, () => swap(fs, 'openSync', real => function (p, ...rest) { if (p === f) throw fault('EACCES'); return real.call(fs, p, ...rest); }, () => output.captureMemoryOutput(f))]; },
        snapshot: () => { const f = fresh('out-other.txt'); return [f, () => output.assertMemoryOutputCurrent({}, f)]; },
        createdByOther: () => { const f = absent('out-created.txt'); return [f, () => { const token = output.captureMemoryOutput(f); swap(fs, 'linkSync', () => () => { throw fault('EEXIST'); }, () => output.publishMemoryOutput(token, f, 'new\n')); }]; },
        newTargetInvalid: () => { const f = absent('out-new.txt'); return [f, () => { const token = output.captureMemoryOutput(f); swap(io, 'detachCommittedHardLink', real => function (...args) { const r = real.apply(io, args); fs.writeFileSync(f, 'tampered\n'); return r; }, () => output.publishMemoryOutput(token, f, 'new\n')); }]; },
        preparedOverLimit: () => { const f = fresh('out-small.txt', 'ab'); return [f, () => output.publishMemoryOutput(output.captureMemoryOutput(f, { maxBytes: 4 }), f, '0123456789')]; },
      };
      // Windows replaces an existing target in one step; a change right after that step is caught by the check after it.
      if (process.platform === 'win32') outputCases.changedAfter = () => { const f = fresh('out-after.txt', 'before\n'); return [f, () => { const token = output.captureMemoryOutput(f); swap(io, 'writeBufferIfUnchanged', real => function (...args) { const r = real.apply(io, args); fs.writeFileSync(f, 'tampered\n'); return r; }, () => output.publishMemoryOutput(token, f, 'after\n')); }]; };
      const unavailableCases = {
        limitInvalid: () => { const f = absent('out-limit.txt'); return [f, () => output.captureMemoryOutput(f, { maxBytes: -1 })]; },
        linkFailed: () => { const f = absent('out-link.txt'); return [f, () => { const token = output.captureMemoryOutput(f); swap(fs, 'linkSync', () => () => { throw fault('EPERM'); }, () => output.publishMemoryOutput(token, f, 'new\n')); }]; },
      };
      const otherCases = {
        bytes: () => { const f = fresh('bytes.txt', '0123456789'); return [f, () => { const fd = fs.openSync(f, 'r'); try { bytes.readMemoryInputBytes(fd, 1, f, 10n); } finally { fs.closeSync(fd); } }]; },
        readInvalid: () => [null, () => read.readPublicationBytes(fresh('read.txt', 'x'), -1)],
        readLimit: () => { const f = fresh('read-big.txt', '0123456789'); return [f, () => read.readPublicationBytes(f, 2)]; },
        readNotFile: () => { const f = path.join(dir, `${++made}-folder`); fs.mkdirSync(f); return [f, () => read.readPublicationBytes(f, 10)]; },
      };
      const handoffFile = path.join(dir, 'session-handoff.md');
      const handoffCases = {
        frontmatter: () => [handoffFile, () => handoff.updateHandoff('---\nleernessRole: session-handoff\n\n# Handoff\n', 'block\n', handoffFile)],
        reserved: () => [handoffFile, () => handoff.updateHandoff('# Handoff\n', 'a <!-- leerness:current-handoff:start --> b\n', handoffFile)],
        ambiguous: () => [handoffFile, () => handoff.updateHandoff('# Handoff\n<!-- leerness:current-handoff:start -->\nx\n', 'block\n', handoffFile)],
      };
      const runAll = cases => Object.fromEntries(Object.entries(cases).map(([name, make]) => { const [file, fn] = make(); return [name, { file, error: observe(fn) }]; }));
      for (const [label, resolve] of STATES) {
        if (resolve !== undefined) language.setErrorLanguage(resolve);
        out[label] = { answer: language.errorLanguage(), input: runAll(inputCases), output: runAll(outputCases), unavailable: runAll(unavailableCases), other: runAll(otherCases), handoff: runAll(handoffCases) };
      }
      // A successful handoff update does not ask the resolver: the language is asked only for an error.
      let asked = 0;
      language.setErrorLanguage(() => { asked++; return 'ko'; });
      handoff.updateHandoff('# Handoff\n', 'block\n', handoffFile);
      out.askedOnSuccess = asked;
    } else if (mode === 'lock') {
      const lock = require('../lib/state-lock');
      // Also the code a failed release left on an error that was already being thrown (lockReleaseError).
      const observeRelease = fn => { try { fn(); return null; } catch (e) { return { code: e && e.code, message: e && e.message, lockReleaseError: e && e.lockReleaseError || null }; } };
      const writes = [];
      const capture = fn => swap(process.stderr, 'write', () => chunk => { writes.push(String(chunk)); return true; }, fn);
      const refuse = (lockPath, code, fn) => swap(fs, 'mkdirSync', real => function (p, ...rest) { if (p === lockPath) throw fault(code); return real.call(fs, p, ...rest); }, fn);
      for (const [label, resolve] of STATES) {
        if (resolve !== undefined) language.setErrorLanguage(resolve);
        const target = name => path.join(dir, `${label}-${name}.json`);
        const r = {};
        for (const [name, code, opts] of [['timeout', 'EEXIST', {}], ['persisted', 'EPERM', {}], ['bail', 'ENOSPC', {}], ['failOpen', 'EEXIST', { failOpen: true }], ['failOpenPersisted', 'EPERM', { failOpen: true }]]) {
          const t = target(name);
          writes.length = 0;
          let ran = false;
          const error = capture(() => refuse(t + '.lock', code, () => observe(() => lock.withStateLock(t, () => { ran = true; }, { maxWaitMs: 30, ...opts }))));
          const diagnostics = lock.stateLockDiagnostics().filter(d => d.file === path.basename(t)).map(d => d.reason);
          r[name] = { file: path.basename(t), error, ran, stderr: writes.join(''), diagnostics };
        }
        {
          // A nested call after the lock's owner record disappeared; the outer release then cannot confirm ownership.
          const t = target('ownership');
          writes.length = 0;
          const error = capture(() => observeRelease(() => lock.withStateLock(t, () => {
            for (const name of fs.readdirSync(t + '.lock')) fs.unlinkSync(path.join(t + '.lock', name));
            return lock.withStateLock(t, () => 'inner');
          })));
          r.ownership = { file: path.basename(t + '.lock'), error, stderr: writes.join('') };
        }
        // Work that succeeded, then a release that fails: the release error is what the caller gets. The owner record
        // gone gives E_LOCK_OWNERSHIP_LOST; another file left in the lock folder gives E_LOCK_RELEASE.
        for (const [name, spoil] of [['releaseLost', t => { for (const n of fs.readdirSync(t + '.lock')) fs.unlinkSync(path.join(t + '.lock', n)); }],
          ['releaseContaminated', t => fs.writeFileSync(path.join(t + '.lock', 'other-file.txt'), 'x')]]) {
          const t = target(name);
          writes.length = 0;
          let ran = false;
          const error = capture(() => observeRelease(() => lock.withStateLock(t, () => { spoil(t); ran = true; return 'done'; })));
          r[name] = { file: path.basename(t + '.lock'), error, ran, stderr: writes.join('') };
        }
        {
          // Another async operation of this process asks for a lock held by a pending one.
          const t = target('busy');
          let release;
          const held = lock.withStateLock(t, () => new Promise(resolveHeld => { release = resolveHeld; }));
          const error = await new Promise(done => setImmediate(() => done(observe(() => lock.withStateLock(t, () => 'other')))));
          release();
          await held;
          r.busy = { error };
        }
        out[label] = r;
      }
    } else throw new Error('unknown direct mode: ' + mode);
    fs.writeFileSync(outFile, JSON.stringify(out));
  };
  main().then(() => process.exit(0), e => { console.error(e && e.stack || e); process.exit(1); });
  return;
}

const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
// A filter must name something: a missing value or one that selects no test is a failure, not "0/0 passed".
// Checked before any temporary folder exists, so this exit leaves nothing behind.
if (process.argv.includes('--match') && !filter) { console.error('--match needs a test name substring'); process.exit(1); }
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-write-path-language-'));
const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
  LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_BANNER: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_SKILL_HISTORY: '1' };
for (const key of ['LEERNESS_LANG', 'LEERNESS_NO_LOCK_WARN', 'LEERNESS_OLLAMA_BASE_URL', 'LEERNESS_ENFORCE_POLICY']) delete env[key];
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) { env[key] = path.join(arena, 'env-' + key.toLowerCase()); fs.mkdirSync(env[key]); }
let passed = 0, failed = 0, ran = 0;
const test = (name, fn) => { if (filter && !name.includes(filter)) return; ran++; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };
const HANGUL = /\p{Script=Hangul}/u;
const show = r => `exit ${r.status}\n${String(r.stdout || '').slice(-1500)}${String(r.stderr || '').slice(0, 600)}`;
const direct = mode => {
  const dir = fs.mkdtempSync(path.join(arena, 'direct-' + mode + '-')), outFile = path.join(arena, 'direct-' + mode + '.json');
  const r = cp.spawnSync(process.execPath, [__filename, '--direct', mode, dir, outFile], { cwd: arena, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
  assert.strictEqual(r.status, 0, show(r));
  return JSON.parse(fs.readFileSync(outFile, 'utf8'));
};

test('direct calls: every memory input, memory output, publication read and handoff message in each language state', () => {
  const got = direct('modules');
  for (const [state] of STATES) {
    const lang = state === 'ko' ? 'ko' : state === 'en' ? 'en' : 'unset';
    // errorLanguage() itself: 'ko' or 'en' as registered, null for everything else (review round 1).
    const want = { answer: lang === 'unset' ? null : lang, input: {}, output: {}, unavailable: {}, other: {}, handoff: {} };
    for (const [name, { file }] of Object.entries(got[state].input)) want.input[name] = { file, error: { code: MEMORY_INPUT[name][0], message: inputText(lang, MEMORY_INPUT[name], file) } };
    for (const [name, { file }] of Object.entries(got[state].output)) want.output[name] = { file, error: { code: MEMORY_OUTPUT[name][0], message: outputText(lang, MEMORY_OUTPUT[name], file) } };
    const unavailable = { limitInvalid: UNAVAILABLE.limitInvalid.slice(1), linkFailed: ['exclusive hard-link install failed (EPERM)', '하드 링크로 새 파일을 단독 설치하지 못했습니다 (EPERM)'] };
    for (const [name, { file }] of Object.entries(got[state].unavailable)) want.unavailable[name] = { file, error: { code: 'E_OUTPUT_CAS_UNAVAILABLE', message: unavailableText(lang, ...unavailable[name], file) } };
    const other = got[state].other;
    want.other = {
      bytes: { file: other.bytes.file, error: { code: 'E_STORE_LIMIT', message: pick(state, BYTES_TEXT) } },
      readInvalid: { file: null, error: { code: 'E_OUTPUT_INVALID', message: pick(state, READ_TEXT) } },
      readLimit: { file: other.readLimit.file, error: { code: 'E_OUTPUT_LIMIT', message: pick(state, READ_TEXT) } },
      readNotFile: { file: other.readNotFile.file, error: { code: 'E_OUTPUT_CHANGED', message: pick(state, READ_TEXT) } },
    };
    for (const [name, { file }] of Object.entries(got[state].handoff)) want.handoff[name] = { file, error: { code: 'E_TEXT_FORMAT', message: `${pick(state, HANDOFF[name])}: ${file}` } };
    assert.deepStrictEqual(got[state], want, state);
  }
  // The cases ran, and the platform-only ones on their platform: no reason dropped out of the table above.
  const expectNames = (table, platformOnly, skipped = []) => Object.keys(table).filter(n => !skipped.includes(n) && (process.platform === 'win32' || !platformOnly.includes(n))).sort();
  assert.deepStrictEqual(Object.keys(got.ko.input).sort(), expectNames(MEMORY_INPUT, ['identity']));
  assert.deepStrictEqual(Object.keys(got.ko.output).sort(), expectNames(MEMORY_OUTPUT, ['changedAfter'], ['wonWindow', 'createdDuring', 'publishedInvalid']));
  assert.strictEqual(got.askedOnSuccess, 0, 'a successful handoff update asked for the language');
});

test('direct calls: state-lock timeout, fail-open, release, nested and busy messages in each language state', () => {
  const got = direct('lock');
  for (const [state] of STATES) {
    const r = got[state], en = state === 'en';
    const why = { timeout: 'timeout', persisted: en ? 'EPERM persisted (30ms)' : 'EPERM 지속(30ms)', bail: 'ENOSPC' };
    for (const name of ['timeout', 'persisted', 'bail']) {
      assert.deepStrictEqual(r[name], { file: r[name].file, error: { code: 'E_LOCK_TIMEOUT', message: LOCK.stopped(r[name].file, why[name])[en ? 0 : 1] }, ran: false, stderr: '', diagnostics: [] }, `${state} ${name}`);
    }
    // Fail-open goes on and warns; the recorded reason keeps its one form in every language.
    assert.deepStrictEqual(r.failOpen, { file: r.failOpen.file, error: null, ran: true, stderr: LOCK.warning(r.failOpen.file, 'timeout')[en ? 0 : 1], diagnostics: ['timeout'] }, `${state} failOpen`);
    assert.deepStrictEqual(r.failOpenPersisted, { file: r.failOpenPersisted.file, error: null, ran: true,
      stderr: LOCK.warning(r.failOpenPersisted.file, en ? 'EPERM persisted (30ms)' : 'EPERM 지속(30ms)')[en ? 0 : 1], diagnostics: ['EPERM 지속(30ms)'] }, `${state} failOpenPersisted`);
    // The nested call is refused in Korean only for ko (its text was English); the release message is English only for en.
    assert.deepStrictEqual(r.ownership, { file: r.ownership.file, error: { code: 'E_LOCK_OWNERSHIP_LOST', message: pick(state, LOCK.ownership), lockReleaseError: 'E_LOCK_OWNERSHIP_LOST' },
      stderr: releaseWarning(state, r.ownership.file, 'ownership-lost') }, `${state} ownership`);
    for (const [name, code, reason] of [['releaseLost', 'E_LOCK_OWNERSHIP_LOST', 'ownership-lost'], ['releaseContaminated', 'E_LOCK_RELEASE', 'release-tombstone-contaminated']]) {
      assert.deepStrictEqual(r[name], { file: r[name].file, error: { code, message: LOCK.release(r[name].file, reason)[en ? 0 : 1], lockReleaseError: null }, ran: true,
        stderr: releaseWarning(state, r[name].file, reason) }, `${state} ${name}`);
    }
    assert.deepStrictEqual(r.busy, { error: { code: 'E_LOCK_BUSY', message: pick(state, LOCK.busy) } }, `${state} busy`);
  }
});

// The arguments of each call to `name(` in a source, split at top-level commas. Strings, template literals (with
// their ${} parts), comments and brackets are read as units; a definition (`function name(`) is not a call.
function callArgs(source, name) {
  const skipString = (s, i, q) => { for (i++; i < s.length; i++) { if (s[i] === '\\') i++; else if (s[i] === q) return i; } return i; };
  const skipComment = (s, i) => s[i + 1] === '/' ? s.indexOf('\n', i) : s.indexOf('*/', i + 2) + 1;
  const skipTemplate = (s, i) => { for (i++; i < s.length; i++) { if (s[i] === '\\') i++; else if (s[i] === '`') return i; else if (s[i] === '$' && s[i + 1] === '{') i = scan(s, i + 2, null); } return i; };
  // Reads from i to the bracket that closes the current level; collects top-level arguments when args is an array.
  function scan(s, i, args) {
    let depth = 0, start = i;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === "'" || c === '"') i = skipString(s, i, c);
      else if (c === '`') i = skipTemplate(s, i);
      else if (c === '/' && (s[i + 1] === '/' || s[i + 1] === '*')) i = skipComment(s, i);
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (depth === 0) { if (args) args.push(s.slice(start, i).trim()); return i; } depth--; }
      else if (c === ',' && depth === 0 && args) { args.push(s.slice(start, i).trim()); start = i + 1; }
    }
    return i;
  }
  const calls = [], re = new RegExp('(?<![\\w$.])' + name + '\\(', 'g');
  for (let m; (m = re.exec(source));) {
    if (/function\s+$/.test(source.slice(Math.max(0, m.index - 12), m.index))) continue;
    const args = [];
    scan(source, m.index + m[0].length, args);
    calls.push(args);
  }
  return calls;
}
const literal = arg => /^(['"`])([\s\S]*)\1$/.exec(arg) ? arg.slice(1, -1) : null;

test('call shapes: every memory input and output reason in the sources has its Korean text, and only the reasons above', () => {
  const source = name => fs.readFileSync(path.join(LIB, name), 'utf8');
  const pairs = (calls, at) => calls.filter(a => a.length > at).map(a => [literal(a[at]), literal(a[at + 1])]);
  const table = t => Object.values(t).map(([, en, ko]) => [en, ko]);
  const sorted = list => list.map(p => JSON.stringify(p)).sort();
  const inputCalls = callArgs(source('memory-input.js'), 'error');
  assert.ok(inputCalls.length >= 18 && inputCalls.every(a => a.length === 4), 'memory-input error() calls: ' + JSON.stringify(inputCalls));
  assert.deepStrictEqual(sorted([...new Set(pairs(inputCalls, 2).map(p => JSON.stringify(p)))].map(p => JSON.parse(p))), sorted(table(MEMORY_INPUT)));
  const changedCalls = callArgs(source('memory-output.js'), 'changed');
  // A call without a reason gives the default one, which the direct test checks; every other call names both.
  assert.ok(changedCalls.length >= 26 && changedCalls.every(a => a.length === 1 || a.length === 3), 'memory-output changed() calls: ' + JSON.stringify(changedCalls));
  assert.deepStrictEqual(sorted([...new Set(pairs(changedCalls, 1).map(p => JSON.stringify(p)))].map(p => JSON.parse(p))),
    sorted(table(MEMORY_OUTPUT).filter(([en]) => en !== 'changed before publication')));
  const unavailableCalls = callArgs(source('memory-output.js'), 'unavailable');
  assert.ok(unavailableCalls.length === 3 && unavailableCalls.every(a => a.length === 3), 'memory-output unavailable() calls: ' + JSON.stringify(unavailableCalls));
  assert.deepStrictEqual(sorted([...new Set(pairs(unavailableCalls, 1).map(p => JSON.stringify(p)))].map(p => JSON.parse(p))), sorted(table(UNAVAILABLE)));
  for (const [en, ko] of [...table(MEMORY_INPUT), ...table(MEMORY_OUTPUT), ...table(UNAVAILABLE)]) {
    assert.ok(!HANGUL.test(en) && HANGUL.test(ko), `${en} / ${ko}`);
  }
});

// ---- the commands ----------------------------------------------------------------------------------------------------
const seeds = {};
const seed = lang => {
  if (seeds[lang]) return seeds[lang];
  const dir = path.join(arena, 'seed-' + lang);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"proj","version":"0.1.0"}\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'init', dir, '--yes', '--language', lang, '--no-mcp'], { cwd: dir, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
  assert.strictEqual(r.status, 0, 'init ' + lang + ' ' + show(r));
  return (seeds[lang] = dir);
};
let copies = 0;
// T-0343: the fixture folders have Korean names, and Node 22.23.3's fs.cpSync crashes on non-ASCII paths on Windows.
const { copyTreeSync } = require('../lib/copy-tree');
const fresh = lang => { const dir = path.join(arena, 'p' + (++copies) + ' 한글'); copyTreeSync(seed(lang), dir); return dir; };
const ws = (P, name) => path.join(P, '.leerness', name);
// A hook that changes one file just before a chosen publication of it through managed text (WPL_NTH, default the
// first), or just before memory output publishes it, as another writer would.
const hook = path.join(arena, 'write-hook.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),path=require('path');
const base=process.env.WPL_LIB,target=process.env.WPL_TARGET,mode=process.env.WPL_MODE,nth=Number(process.env.WPL_NTH||1);
let seen=0,fired=false;
const inject=p=>{if(!fired&&p===target){fired=true;fs.writeFileSync(p,Buffer.concat([fs.existsSync(p)?fs.readFileSync(p):Buffer.alloc(0),Buffer.from('another writer'+String.fromCharCode(10))]));}};
const out=require(path.join(base,'memory-output')),realPublish=out.publishMemoryOutput;
out.publishMemoryOutput=function(t,p,v){if(mode==='output')inject(p);return realPublish.call(this,t,p,v);};
const mt=require(path.join(base,'managed-text')),publish=mt.publishTextEdit;
mt.publishTextEdit=function(e,p,s){if(mode==='before'&&p===target&&++seen===nth)inject(p);return publish(e,p,s);};
`);
const run = (args, extra = {}, opts = {}) => cp.spawnSync(process.execPath, [...(opts.hook ? ['--require', hook] : []), CLI, ...args],
  { cwd: opts.cwd || arena, encoding: 'utf8', timeout: 300000, windowsHide: true, env: { ...env, WPL_LIB: LIB, ...extra } });
const succeed = (args, extra) => { const r = run(args, extra); assert.strictEqual(r.status, 0, args.join(' ') + ': ' + show(r)); return r; };
const before = (target, nth = 1) => ({ WPL_MODE: 'before', WPL_TARGET: target, WPL_NTH: String(nth) });
const lastLine = text => String(text).replace(/\n$/, '').split('\n').pop();

const TEXT = {
  input: (lang, name, file) => inputText(lang, MEMORY_INPUT[name], file),
  output: (lang, name, file) => outputText(lang, MEMORY_OUTPUT[name], file),
  encoding: (lang, file) => lang === 'en' ? `Managed text has invalid UTF-8; no replacement was attempted: ${file}. Preserve the original and retry after checking it.`
    : `관리 문서에 UTF-8 로 읽을 수 없는 바이트가 있어 대체 문자로 바꾸지 않았습니다: ${file}. 원본을 보존하고 확인한 뒤 다시 시도하세요.`,
};
// The notes, English as they were; numbers are the steps a run completed (a pattern below).
const NOTES = {
  generation: (f, n) => [` File generation stopped at ${f}; ${n} earlier file steps completed. Earlier changes and the backup were not rolled back.`,
    ` 파일 생성이 ${f} 에서 멈췄습니다. 앞선 파일 단계 ${n}개를 마쳤고, 앞서 바꾼 내용과 백업은 되돌리지 않았습니다.`],
  installation: (f, n, m) => [` Installation stopped at ${f}; ${n} core file steps and ${m} later text stages completed. Earlier changes and the backup were not rolled back.`,
    ` 설치가 ${f} 에서 멈췄습니다. 핵심 파일 단계 ${n}개와 이후 텍스트 단계 ${m}개를 마쳤고, 앞서 바꾼 내용과 백업은 되돌리지 않았습니다.`],
  anchors: () => [' The brief draft was saved before plan publication failed; earlier changes were not rolled back.',
    ' 계획(plan.md) 저장이 실패하기 전에 브리프 초안은 저장됐습니다. 앞서 바꾼 내용은 되돌리지 않았습니다.'],
  planRemove: () => [' Plan archive was saved before active-plan publication failed; inspect both files and any recovery paths.',
    ' 현재 계획 저장이 실패하기 전에 계획 보관 파일은 저장됐습니다. 두 파일과 복구 경로를 확인하세요.'],
  planRestore: () => [' Active plan was restored before archive publication failed; inspect both files and any recovery paths.',
    ' 보관 파일 저장이 실패하기 전에 현재 계획은 복원됐습니다. 두 파일과 복구 경로를 확인하세요.'],
  nonsecret: () => [' Nonsecret configuration was saved before environment publication failed; earlier changes were not rolled back.',
    ' 환경 파일 저장이 실패하기 전에 비밀이 아닌 설정은 저장됐습니다. 앞서 바꾼 내용은 되돌리지 않았습니다.'],
  ruleArchiveSaved: () => [' Rule archive saved before the rules update failed; earlier changes were not rolled back. Inspect both files and recovery paths before retrying.',
    ' 룰 갱신이 실패하기 전에 룰 보관 파일은 저장됐습니다. 앞서 바꾼 내용은 되돌리지 않았습니다. 다시 시도하기 전에 두 파일과 복구 경로를 확인하세요.'],
  ruleArchiveFailed: () => [' Rule removal stopped while saving the archive; active rules were not saved. Inspect the archive and recovery paths before retrying.',
    ' 보관 파일을 저장하는 중에 룰 제거가 멈췄습니다. 현재 룰은 저장하지 않았습니다. 다시 시도하기 전에 보관 파일과 복구 경로를 확인하세요.'],
  brief: () => [' The project brief was saved, but README publication failed; the earlier save was not rolled back. Inspect both files before retrying.',
    ' 프로젝트 브리프는 저장됐지만 README 저장이 실패했습니다. 앞선 저장은 되돌리지 않았습니다. 다시 시도하기 전에 두 파일을 확인하세요.'],
  adapter: (f, n) => [` Adapter generation stopped at ${f}; ${n} earlier file steps completed. Earlier changes were not rolled back.`,
    ` 어댑터 생성이 ${f} 에서 멈췄습니다. 앞선 파일 단계 ${n}개를 마쳤고, 앞서 바꾼 내용은 되돌리지 않았습니다.`],
  sessionClose: names => [` Session close stopped after publishing ${names}; earlier writes were not rolled back. Inspect these documents before retrying.`,
    ` 세션 마감이 ${names} 를 저장한 뒤 멈췄습니다. 앞서 저장한 내용은 되돌리지 않았습니다. 다시 시도하기 전에 이 문서들을 확인하세요.`],
};
const note = (lang, name, ...args) => NOTES[name](...args)[lang === 'en' ? 0 : 1];
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Expected error line with \d+ where a note reports how many steps were completed (marked by the N placeholder).
const N = '\u0000N\u0000';
const pattern = text => new RegExp('^' + escape(text).split(escape(N)).join('(\\d+)') + '$');
// A refused command: exit 1, the error line last on stdout (init prints its progress before it), nothing on stderr,
// and that line in the project language once its paths are left out. Returns the numbers the pattern captured.
const refused = (label, lang, expected, r, ...dirs) => {
  const line = lastLine(r.stdout), match = pattern('✗ ' + expected).exec(line);
  assert.ok(r.status === 1 && match && r.stderr === '', `${label}: expected\n✗ ${expected}\n${show(r)}`);
  const bare = dirs.reduce((t, d) => t.split(d).join('<dir>'), line);
  assert.strictEqual(HANGUL.test(bare), lang === 'ko', `${label}: the error line is not ${lang}\n${line}`);
  return match.slice(1);
};

for (const lang of ['en', 'ko']) {
  test(`${lang}: memory input and output refusals reach the commands in the project language, with their codes`, () => {
    // A tracker with a second hard link: task add refuses before writing (text, and --json with the error line on stderr).
    const P = fresh(lang), tracker = ws(P, 'progress-tracker.md');
    fs.linkSync(tracker, path.join(P, 'tracker-link.md'));
    const linked = TEXT.input(lang, 'hardLinked', tracker);
    refused('task add (hard link)', lang, linked, run(['task', 'add', 'row', '--path', P]), P);
    const j = run(['task', 'add', 'row', '--path', P, '--json']);
    assert.deepStrictEqual([j.status, JSON.parse(j.stdout), j.stderr], [1, { ok: false, error: linked, code: 'error' }, '✗ ' + linked + '\n'], show(j));
    // A decisions store with invalid JSON: decision add reports E_STORE_CORRUPT as store_corrupt.
    const Q = fresh(lang), decisions = ws(Q, 'decisions.json');
    fs.writeFileSync(decisions, '[{"broken": ');
    const corrupt = TEXT.input(lang, 'invalidJson', decisions);
    refused('decision add (invalid JSON)', lang, corrupt, run(['decision', 'add', 'Use X', '--path', Q]), Q);
    const d = run(['decision', 'add', 'Use X', '--path', Q, '--json']);
    assert.deepStrictEqual([d.status, JSON.parse(d.stdout), d.stderr], [1, { ok: false, error: corrupt, code: 'store_corrupt' }, ''], show(d));
    // Another writer changes the tracker between the checked read and its publication.
    const R = fresh(lang), raced = ws(R, 'progress-tracker.md');
    refused('task add (output race)', lang, TEXT.output(lang, 'changed', raced), run(['task', 'add', 'row', '--path', R], { WPL_MODE: 'output', WPL_TARGET: raced }, { hook: true }), R);
  });

  test(`${lang}: session close refuses an unclosed handoff frontmatter in the project language`, () => {
    const P = fresh(lang), handoff = ws(P, 'session-handoff.md');
    fs.writeFileSync(handoff, '---\nleernessRole: session-handoff\n\n# Session Handoff\n');
    const before = fs.readFileSync(handoff), message = `${pick(lang, HANDOFF.frontmatter)}: ${handoff}`;
    refused('session close', lang, message, run(['session', 'close', '--path', P, '--no-suggest', '--no-record']), P);
    const j = run(['session', 'close', '--path', P, '--no-suggest', '--no-record', '--json']);
    assert.deepStrictEqual([j.status, JSON.parse(j.stdout), j.stderr], [1, { ok: false, error: message, code: 'error' }, '✗ ' + message + '\n'], show(j));
    assert.ok(fs.readFileSync(handoff).equals(before), 'the refused close changed the handoff');
  });
}

// Each partly finished save: the cause in the project language, then the note in the same language. Every case runs
// in both languages, and the step counts a note reports must agree between them.
const partial = [
  ['plan remove: the archive was saved, the active plan was not', P => {
    succeed(['plan', 'add', 'Probe milestone', '--path', P]);
    return { args: ['plan', 'remove', 'Probe milestone', '--path', P], extra: before(ws(P, 'plan.md')),
      expected: lang => TEXT.input(lang, 'changed', ws(P, 'plan.md')) + note(lang, 'planRemove') };
  }],
  ['memory restore plan: the active plan was restored, the archive was not', P => {
    succeed(['plan', 'add', 'Probe milestone', '--path', P]);
    succeed(['plan', 'remove', 'Probe milestone', '--path', P]);
    return { args: ['memory', 'restore', 'plan', 'Probe milestone', '--path', P], extra: before(ws(P, 'plan.archive.md')),
      expected: lang => TEXT.input(lang, 'changed', ws(P, 'plan.archive.md')) + note(lang, 'planRestore') };
  }],
  ['rule remove: the archive was saved, the rules were not', P => {
    const id = /R-\d{4}/.exec(succeed(['rule', 'add', 'Probe rule text', '--path', P, '--json']).stdout)[0];
    return { args: ['rule', 'remove', id, '--path', P], extra: before(ws(P, 'rules.md')),
      expected: lang => TEXT.input(lang, 'changed', ws(P, 'rules.md')) + note(lang, 'ruleArchiveSaved') };
  }],
  ['rule remove: the archive was not saved', P => {
    const id = /R-\d{4}/.exec(succeed(['rule', 'add', 'Probe rule text', '--path', P, '--json']).stdout)[0];
    return { args: ['rule', 'remove', id, '--path', P], extra: before(ws(P, 'rules.archive.md')),
      expected: lang => TEXT.input(lang, 'changed', ws(P, 'rules.archive.md')) + note(lang, 'ruleArchiveFailed') };
  }],
  ['brief update: the brief was saved, README was not', P => {
    fs.writeFileSync(path.join(P, 'README.md'), '# Readme\n\n<!-- leerness:project-brief:start -->\nold generated\n<!-- leerness:project-brief:end -->\n');
    return { args: ['brief', 'update', '--direction', 'New direction', '--path', P], extra: before(path.join(P, 'README.md')),
      expected: lang => TEXT.input(lang, 'changed', path.join(P, 'README.md')) + note(lang, 'brief') };
  }],
  ['anchors draft --apply: the brief draft was saved, plan.md was not', P => {
    fs.writeFileSync(ws(P, 'project-brief.md'), '# Brief\n\n## Purpose\n\n## Notes\nx\n');
    fs.writeFileSync(ws(P, 'plan.md'), Buffer.concat([Buffer.from('# Plan\n\n## Goal\n\n## Notes\n'), Buffer.from([0xff])]));
    fs.writeFileSync(path.join(P, 'package.json'), JSON.stringify({ name: 'proj', version: '0.1.0', description: 'Useful probe project' }));
    return { args: ['anchors', 'draft', '--apply', '--path', P], extra: {}, expected: lang => TEXT.encoding(lang, ws(P, 'plan.md')) + note(lang, 'anchors') };
  }],
  ['session close: session-handoff.md was saved, current-state.md was not', P => (
    { args: ['session', 'close', '--path', P, '--no-suggest', '--no-record'], extra: before(ws(P, 'current-state.md')),
      expected: lang => TEXT.input(lang, 'changed', ws(P, 'current-state.md')) + note(lang, 'sessionClose', 'session-handoff.md') })],
  ['init: the .env merge step stopped', P => {
    fs.writeFileSync(path.join(P, '.env'), 'LEERNESS_OLLAMA_MODEL=probe-model\n');
    return { args: ['init', P, '--yes', '--no-setup-agents', '--no-mcp', '--no-auto-roadmap', '--no-official-skills', '--no-banner'], extra: before(path.join(P, '.env')),
      expected: lang => TEXT.input(lang, 'changed', path.join(P, '.env')) + note(lang, 'installation', '.env', N, N) };
  }],
  ['init: the nonsecret configuration was saved, .env was not', P => {
    fs.writeFileSync(path.join(P, '.env'), 'LEERNESS_OLLAMA_MODEL=probe-model\n');
    return { args: ['init', P, '--yes', '--no-setup-agents', '--no-mcp', '--no-auto-roadmap', '--no-official-skills', '--no-banner'], extra: before(path.join(P, '.env'), 2),
      expected: lang => TEXT.input(lang, 'changed', path.join(P, '.env')) + note(lang, 'nonsecret') + note(lang, 'installation', '.env nonsecret migration', N, N) };
  }],
  ['init: file generation stopped at AGENTS.md', P => {
    fs.writeFileSync(path.join(P, 'AGENTS.md'), Buffer.concat([fs.readFileSync(path.join(P, 'AGENTS.md')), Buffer.from([0xff])]));
    return { args: ['init', P, '--yes', '--minimal', '--no-setup-agents', '--no-mcp', '--no-auto-roadmap', '--no-official-skills', '--no-banner'], extra: {},
      expected: lang => TEXT.encoding(lang, path.join(P, 'AGENTS.md')) + note(lang, 'generation', 'AGENTS.md', N) };
  }],
  ['adapter codex: generation stopped at AGENTS.md', P => {
    fs.writeFileSync(path.join(P, 'AGENTS.md'), Buffer.concat([fs.readFileSync(path.join(P, 'AGENTS.md')), Buffer.from([0xff])]));
    return { args: ['adapter', 'codex', '--path', P], extra: {}, expected: lang => TEXT.encoding(lang, path.join(P, 'AGENTS.md')) + note(lang, 'adapter', 'AGENTS.md', N) };
  }],
];
for (const [name, setup] of partial) {
  test(`partial save, both languages: ${name}`, () => {
    const counts = {};
    for (const lang of ['en', 'ko']) {
      const P = fresh(lang), c = setup(P);
      counts[lang] = refused(`${lang} ${name}`, lang, c.expected(lang), run(c.args, c.extra, { hook: Object.keys(c.extra).length > 0 }), P);
    }
    assert.deepStrictEqual(counts.ko, counts.en, 'the step counts differ between the languages');
  });
}

test('the language follows --language, LEERNESS_LANG and the --path project, not the cwd', () => {
  // The registration moved to lib/error-language.js; the same cases as T-0336, now with a memory input error.
  const cases = [
    ['a Korean project, LEERNESS_LANG=en', 'ko', { LEERNESS_LANG: 'en' }, [], 'en'],
    ['an English project, LEERNESS_LANG=ko', 'en', { LEERNESS_LANG: 'ko' }, [], 'ko'],
    ['--language ko over LEERNESS_LANG=en', 'en', { LEERNESS_LANG: 'en' }, ['--language', 'ko'], 'ko'],
    ['--language en over LEERNESS_LANG=ko', 'ko', { LEERNESS_LANG: 'ko' }, ['--language', 'en'], 'en'],
  ];
  const corrupt = lang => { const P = fresh(lang); fs.writeFileSync(ws(P, 'decisions.json'), '[{"broken": '); return P; };
  for (const [label, projectLang, extra, flags, want] of cases) {
    const P = corrupt(projectLang);
    refused(label, want, TEXT.input(want, 'invalidJson', ws(P, 'decisions.json')), run(['decision', 'add', 'Use X', '--path', P, ...flags], extra), P);
  }
  // Run inside a project of the other language: the target named by --path decides.
  const en = corrupt('en'), ko = corrupt('ko');
  for (const [P, cwd, want] of [[en, ko, 'en'], [ko, en, 'ko']]) {
    refused(`--path ${want} from a ${want === 'en' ? 'Korean' : 'English'} project`, want, TEXT.input(want, 'invalidJson', ws(P, 'decisions.json')),
      run(['decision', 'add', 'Use X', '--path', P], {}, { cwd }), P, cwd);
  }
});

console.log(`write path language: ${passed}/${passed + failed}`);
if (filter && !ran) console.error(`--match ${JSON.stringify(filter)} selected no test`);
try { removeTree(arena, { recursive: true, force: true }); } catch {}
if (failed || (filter ? ran === 0 : ran !== 3 + 4 + partial.length + 1)) process.exitCode = 1;
