// Emit only the test lifecycle fields needed to count an exact selection.
// Project stdout, stderr, assertions and error objects never enter this report.
export default async function* reportSelection(events) {
  for await (const event of events) {
    if (!['test:start', 'test:pass', 'test:fail'].includes(event.type)) continue;
    const data = event.data || {};
    yield JSON.stringify({ type: event.type, name: data.name,
      skipped: Object.hasOwn(data, 'skip') && data.skip !== false,
      todo: Object.hasOwn(data, 'todo') && data.todo !== false }) + '\n';
  }
}
