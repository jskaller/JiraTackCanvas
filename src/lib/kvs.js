import { kvs } from '@forge/kvs';

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

export async function kvsGetSecret(key) {
  return kvs.getSecret(key);
}

export async function kvsSetSecret(key, value, options) {
  return kvs.setSecret(key, value, options);
}

export async function kvsSetSecretIfAbsent(key, value) {
  return kvs.setSecret(key, value, { keyPolicy: 'FAIL_IF_EXISTS' });
}

export async function kvsDeleteSecret(key) {
  return kvs.deleteSecret(key);
}
