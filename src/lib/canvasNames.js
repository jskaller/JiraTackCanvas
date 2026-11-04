/**
 * Canvas naming helpers (D42).
 *
 * Kept free of Forge imports so they can be unit-tested and used from both the
 * web triggers and the dashboard resolvers.
 */

export function normaliseCanvasName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Find the record whose current name — or any name it has ever had — matches.
 *
 * `canvasName:<name>` index rows can be missing (an interrupted write, an old
 * build, a registry that failed to load), and tickets written before
 * `pin.canvasId` existed then group under a keyless entry: the launcher showed
 * one canvas twice. The records themselves are the fallback source of truth.
 */
export function findRecordByName(records, name) {
  const target = normaliseCanvasName(name);
  if (!target || !records) return null;
  const values = records instanceof Map ? records.values() : Object.values(records);
  for (const record of values) {
    if (!record) continue;
    const names = [record.name, ...(Array.isArray(record.names) ? record.names : [])];
    if (names.some((candidate) => normaliseCanvasName(candidate) === target)) {
      return record;
    }
  }
  return null;
}
