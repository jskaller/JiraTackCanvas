import { kvs, WhereConditions } from '@forge/kvs';

export { kvs };

export async function kvsGet(key) {
  return kvs.get(key);
}

export async function kvsSet(key, value, options) {
  return kvs.set(key, value, options);
}

/**
 * Conditional create. `keyPolicy: 'FAIL_IF_EXISTS'` is the only compare-and-set
 * the KVS API actually supports — the older `{ version: { type: 'must_be_missing' } }`
 * shape is silently ignored, which made every "CAS" in this codebase a plain
 * overwrite until 2026-10-31.
 */
export async function kvsSetIfAbsent(key, value, options) {
  return kvs.set(key, value, { ...(options || {}), keyPolicy: 'FAIL_IF_EXISTS' });
}

export async function kvsDelete(key) {
  return kvs.delete(key);
}

/**
 * KVS rejects list queries at or above 100 rows, so every prefix scan pages
 * with the cursor. `max` keeps the caller's overall ceiling.
 */
export async function kvsQueryAll(prefix, { pageSize = 50, max = 1000 } = {}) {
  const entries = [];
  let cursor = null;
  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(pageSize);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    const results = (page && page.results) || [];
    entries.push(...results);
    cursor = page && page.nextCursor ? page.nextCursor : null;
    if (entries.length >= max) break;
  } while (cursor);
  return entries.slice(0, max);
}

export async function kvsGetSecret(key) {
  return kvs.getSecret(key);
}

export async function kvsSetSecretIfAbsent(key, value) {
  return kvs.setSecret(key, value, { keyPolicy: 'FAIL_IF_EXISTS' });
}

