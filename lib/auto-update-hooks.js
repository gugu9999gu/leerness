'use strict';

const CHECK = Object.freeze({ matcher: '*', command: 'leerness update --check --quiet' });
const CONTEXT = Object.freeze({ matcher: 'startup|clear|compact', command: 'leerness hook session-start' });
const OLD_CHECK = Object.freeze({ ...CHECK, command: 'leerness update --check' });
function matcher(value) { return value === undefined || value.trim() === '' ? '*' : value.trim(); }
function exactHook(group, expected) {
  return !!(group && !Object.hasOwn(group, 'command') && matcher(group.matcher) === expected.matcher
    && Array.isArray(group.hooks) && group.hooks.some(h => h && h.type === 'command'
      && typeof h.command === 'string' && h.command.trim() === expected.command));
}
function hookGroup(expected) {
  return { matcher: expected.matcher, hooks: [{ type: 'command', command: expected.command }] };
}
function replacement(command, groupMatcher) {
  if (groupMatcher === CHECK.matcher && [CHECK.command, OLD_CHECK.command,
    'leerness-plus update --check', 'leerness-plus update --check --quiet'].includes(command)) return CHECK.command;
  if (groupMatcher === CONTEXT.matcher && command === CONTEXT.command) return CONTEXT.command;
  return null;
}

// Normalize only recognized Leerness commands. Preserve custom siblings and
// handler options, rather than removing a whole user-owned matcher group.
function repairSessionStart(groups) {
  let repaired = groups.map(group => {
    const m = matcher(group.matcher);
    if (!Object.hasOwn(group, 'hooks') && typeof group.command === 'string'
      && (group.type === undefined || group.type === 'command')) {
      const command = replacement(group.command.trim(), m);
      if (command) {
        const { matcher: _matcher, ...handler } = group;
        return { matcher: group.matcher === undefined ? '*' : group.matcher, hooks: [{ ...handler, type: 'command', command }] };
      }
    }
    if (!Object.hasOwn(group, 'command') && Array.isArray(group.hooks)) {
      return { ...group, hooks: group.hooks.map(handler => {
        if (handler.type !== 'command' || typeof handler.command !== 'string') return handler;
        const command = replacement(handler.command.trim(), m);
        return command ? { ...handler, command } : handler;
      }) };
    }
    return group;
  });
  // Earlier installers appended a flat default next to an existing nested one.
  // Remove only redundant default groups; custom options/metadata stay intact.
  repaired = repaired.filter((group, i, all) => {
    const expected = [CHECK, CONTEXT].find(e => exactHook(group, e));
    if (!expected || Object.keys(group).some(k => k !== 'matcher' && k !== 'hooks')
      || group.hooks.length !== 1 || Object.keys(group.hooks[0]).some(k => k !== 'type' && k !== 'command')) return true;
    return !all.some((other, j) => j < i && exactHook(other, expected));
  });
  for (const expected of [CHECK, CONTEXT]) {
    if (!repaired.some(group => exactHook(group, expected))) repaired.push(hookGroup(expected));
  }
  return repaired;
}

module.exports = { CHECK, CONTEXT, OLD_CHECK, exactHook, hookGroup, repairSessionStart };
