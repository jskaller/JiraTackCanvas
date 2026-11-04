/**
 * In-memory `@forge/kvs` for resolver tests.
 *
 * Values are structured-cloned on read and write, because the real store
 * serialises: a test that accidentally aliases a stored object would hide a
 * mutation bug the platform would not.
 */

const store = new Map();
const secrets = new Map();

// Call counters, so a test can prove a flow stopped scanning (the point of the
// call-budget work) instead of trusting a comment.
const stats = { gets: 0, sets: 0, deletes: 0, queries: {} };

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function resetKvs() {
  store.clear();
  secrets.clear();
  stats.gets = 0;
  stats.sets = 0;
  stats.deletes = 0;
  stats.queries = {};
}

export function kvsStats() {
  return {
    gets: stats.gets,
    sets: stats.sets,
    deletes: stats.deletes,
    queries: { ...stats.queries },
  };
}

export function seedKvs(entries) {
  for (const [key, value] of Object.entries(entries || {})) {
    store.set(key, clone(value));
  }
}

export function readKvs(key) {
  return clone(store.get(key));
}

export function kvsKeys() {
  return [...store.keys()].sort();
}

export const WhereConditions = {
  beginsWith: (value) => ({ type: 'beginsWith', value }),
  equalTo: (value) => ({ type: 'equalTo', value }),
};

function matches(key, condition) {
  if (!condition) return true;
  if (condition.type === 'beginsWith') return key.startsWith(condition.value);
  if (condition.type === 'equalTo') return key === condition.value;
  return true;
}

export const kvs = {
  async get(key) {
    stats.gets += 1;
    return clone(store.get(key));
  },
  async set(key, value, options) {
    stats.sets += 1;
    if (options && options.keyPolicy === 'FAIL_IF_EXISTS' && store.has(key)) {
      throw new Error('The key already exists.');
    }
    store.set(key, clone(value));
  },
  async delete(key) {
    stats.deletes += 1;
    store.delete(key);
  },
  async getSecret(key) {
    return clone(secrets.get(key));
  },
  async setSecret(key, value, options) {
    if (options && options.keyPolicy === 'FAIL_IF_EXISTS' && secrets.has(key)) {
      throw new Error('The secret already exists.');
    }
    secrets.set(key, clone(value));
  },
  async deleteSecret(key) {
    secrets.delete(key);
  },
  query() {
    let condition = null;
    let limit = 50;
    let cursor = null;

    const builder = {
      where(field, value) {
        if (field === 'key') condition = value;
        return builder;
      },
      limit(value) {
        limit = value;
        return builder;
      },
      cursor(value) {
        cursor = value;
        return builder;
      },
      async getMany() {
        const prefix = condition && condition.type === 'beginsWith' ? condition.value : '(all)';
        stats.queries[prefix] = (stats.queries[prefix] || 0) + 1;
        const keys = [...store.keys()].filter((key) => matches(key, condition)).sort();
        const start = cursor ? keys.indexOf(cursor) + 1 : 0;
        const slice = keys.slice(start, start + limit);
        const nextCursor = start + limit < keys.length ? keys[start + limit] : null;
        return {
          results: slice.map((key) => ({ key, value: clone(store.get(key)) })),
          nextCursor,
        };
      },
    };

    return builder;
  },
};

export default { kvs, WhereConditions };
