import { kvs, WhereConditions } from '@forge/kvs';
import { createPairingService } from './pairingService.js';

export { createPairingService };

const kvsAdapter = {
  get: (key) => kvs.get(key),
  set: (key, value, options) => kvs.set(key, value, options),
  async query(prefix) {
    const result = await kvs
      .query()
      .where('key', WhereConditions.beginsWith(prefix))
      .limit(100)
      .getMany();
    return ((result && result.results) || []).map((row) => row.value);
  },
};

export const pairingService = createPairingService(kvsAdapter);
