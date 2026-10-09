'use strict';
const fs = require('fs'), path = require('path');
const { createHash } = require('crypto');
const { captureCheckedFileInput, assertCheckedFileCurrent } = require('./memory-input');
const { captureTextEdit, publishTextEdit, decodeText, MAX_TEXT_BYTES } = require('./managed-text');
const { withStateLock } = require('./state-lock');
const { assertWriteAllowed } = require('./io');

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
        // Cooperative writers share this lock. Node has no conditional unlink:
        // a non-cooperating writer can still race the final check-to-unlink gap.
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
module.exports = { reminderBodyHash, autoReminderText, isOwnedReminder,
  refreshReminder: (root, body) => updateReminder(root, 'refresh', body), cleanReminder: root => updateReminder(root, 'cleanup') };
