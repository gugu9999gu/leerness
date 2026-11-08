'use strict';
const fs = require('fs'), path = require('path');
const { createHash } = require('crypto');
const { captureCheckedFileInput, captureCheckedFilePrefix, describeCheckedFileInput, assertCheckedFileCurrent } = require('./memory-input');
const { captureTextEdit, publishTextEdit, decodeText, MAX_TEXT_BYTES } = require('./managed-text');
const { withStateLock } = require('./state-lock');
const { assertWriteAllowed } = require('./io');

function readReminder(root, reader = null) {
  const file = path.resolve(root, '.leerness/agent-reminders.md');
  const snapshot = reader || require('./stored-read-snapshot').createSnapshot(root);
  let result = { exists: false, text: '', truncated: false, unreadable: false };
  try {
    if (snapshot.directory(path.dirname(file)).stat) {
      const input = captureCheckedFilePrefix(file);
      snapshot.observe({ file, input });
      if (input.exists) {
        const truncated = BigInt(describeCheckedFileInput(input, file).stat.size) > BigInt(input.bytes.length);
        try {
          const text = new (require('util').TextDecoder)('utf-8', { fatal: true }).decode(input.bytes, { stream: truncated });
          result = { exists: true, text, truncated, unreadable: false };
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          result = { exists: true, text: '', truncated, unreadable: true, reasonCode: 'invalid_utf8' };
        }
      }
    }
    if (!reader) snapshot.verify();
    return result;
  } catch (error) { error.storeRead = true; throw error; }
}

const reminderBodyHash = body => createHash('sha256').update(String(body)).digest('hex').slice(0, 16);
const autoReminderText = (body, eol = '\n') => `<!-- leerness:managed:auto sha=${reminderBodyHash(body)} -->${eol}${body}`;
function isOwnedReminder(text) {
  const nl = text.indexOf('\n');
  if (nl < 0) return false;
  const marker = /^<!-- leerness:managed:auto sha=([0-9a-f]{16}) -->\r?$/.exec(text.slice(0, nl));
  return !!marker && reminderBodyHash(text.slice(nl + 1)) === marker[1];
}
function updateReminder(root, action, body) {
  const file = path.resolve(root, '.leerness/agent-reminders.md');
  let phase = 'permission', published = false, removalStarted = false, removedConfirmed = false;
  try {
    assertWriteAllowed(file);phase = 'lock';
    return withStateLock(file, () => {
      phase = 'read';
      const input = action === 'refresh' ? captureTextEdit(file) : captureCheckedFileInput(file, { maxBytes: MAX_TEXT_BYTES });
      const text = action === 'refresh' ? input.text : decodeText(input.bytes || Buffer.alloc(0), file);
      let status;
      if (input.exists && !isOwnedReminder(text)) status = 'preserved';
      else if (action === 'refresh') {
        const eol = (text.match(/\r?\n/) || ['\n'])[0];
        const candidate = autoReminderText(body.replace(/\r\n/g, '\n').replace(/\n/g, eol), eol);
        phase = 'publication';published = publishTextEdit(input, file, candidate).published;status = published ? 'saved' : 'unchanged';
      } else if (input.exists) {
        phase = 'source-check';assertCheckedFileCurrent(input, file);
         
         
        phase = 'removal';removalStarted = true;fs.unlinkSync(file);removedConfirmed = true;status = 'removed';
      } else status = 'absent';
      phase = 'lock-release';return { file, status };
    });
  } catch (error) {
    error.reminderStorage = { file, action, phase: error.lockReleaseError || /LOCK_RELEASE/.test(error.code || '') ? 'lock-release' : phase,
      removalStarted, removedConfirmed };
    if (published) error.outputPublished = true;
    throw error;
  }
}
module.exports = { readReminder, reminderBodyHash, autoReminderText, isOwnedReminder,
  refreshReminder: (root, body) => updateReminder(root, 'refresh', body), cleanReminder: root => updateReminder(root, 'cleanup') };
