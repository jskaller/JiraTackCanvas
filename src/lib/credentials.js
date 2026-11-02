import { kvs, WhereConditions } from '@forge/kvs';
import { createPairingService } from './pairingService.js';

export { createPairingService };

const kvsAdapter = {
  get: (key) => kvs.get(key),
  set: (key, value, options) => kvs.set(key, value, options),
  async query(prefix) {
    const results = [];
    let cursor = null;
    do {
      let query = kvs
        .query()
        .where('key', WhereConditions.beginsWith(prefix))
        .limit(50);
      if (cursor) query = query.cursor(cursor);
      const page = await query.getMany();
      results.push(...((page && page.results) || []));
      cursor = page && page.nextCursor ? page.nextCursor : null;
      if (results.length >= 200) break;
    } while (cursor);
    return results.map((row) => row.value);
  },
};

export const pairingService = createPairingService(kvsAdapter);
