import crypto from 'node:crypto';

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

/** Characters KVS accepts in a key. A canvas name is free text, so it cannot be used raw. */
const UNSAFE_KEY_CHARS = /[^a-zA-Z0-9:._\s#-]/g;

/**
 * A KVS-safe, deterministic suffix for a canvas name.
 *
 * Names are free text — `Shopify + Example.com` contains `+`, which the store
 * rejects, and the index write failed silently for exactly that reason. The
 * suffix keeps the readable part (truncated) and appends a digest so two names
 * that slug the same cannot collide.
 */
export function canvasNameKeySuffix(name) {
  const normalised = normaliseCanvasName(name);
  const slug = normalised
    .replace(UNSAFE_KEY_CHARS, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
  const digest = crypto.createHash('sha1').update(normalised).digest('hex').slice(0, 8);
  return slug ? `${slug}-${digest}` : digest;
}
