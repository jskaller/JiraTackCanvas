import { kvs } from '@forge/kvs';

export { kvs };

export async function kvsGet(key) {
  return kvs.get(key);
}

export async function kvsSet(key, value, options) {
  return kvs.set(key, value, options);
}
