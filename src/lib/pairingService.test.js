import assert from 'node:assert/strict';
import { createPairingService } from './pairingService.js';
import { MAX_PAIRINGS, pairingIndexKey, parentRefOf } from './credentialsModel.js';

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  try {
    assert.equal(actual, expected);
    passed += 1;
    console.log(`PASS  ${label}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL  ${label}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}

/** In-memory store that honours keyPolicy, matching KVS semantics. */
function createStore() {
  const map = new Map();
  const writes = [];
  return {
    writes,
    map,
    async get(key) {
      return map.has(key) ? JSON.parse(map.get(key)) : undefined;
    },
    async set(key, value, options) {
      writes.push({ key, options });
      if (options && options.keyPolicy === 'FAIL_IF_EXISTS' && map.has(key)) {
        const err = new Error('key exists');
        err.code = 'CONFLICT';
        throw err;
      }
      map.set(key, JSON.stringify(value));
    },
    async query(prefix) {
      return [...map.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, value]) => JSON.parse(value));
    },
  };
}

const invite = 'a'.repeat(64);
const inviteRecord = { expiresAt: Date.UTC(2026, 9, 31, 18, 0) };
const now = Date.UTC(2026, 9, 31, 12, 0);
const ref = parentRefOf(invite);

const run = async () => {
  // Idempotent first/create
  {
    const store = createStore();
    const svc = createPairingService(store);
    const a = await svc.recordPairing({ inviteToken: invite, installId: 'b'.repeat(32), inviteRecord, now });
    const b = await svc.recordPairing({ inviteToken: invite, installId: 'b'.repeat(32), inviteRecord, now });
    check('first is new', a.ok && a.isNew, true);
    check('second is existing', b.ok && b.isNew, false);
    check('same pairing id', a.pairingId, b.pairingId);
    check('one index row', (await svc.countPairingsForInvite(ref)), 1);
    check('index key shape', store.map.has(pairingIndexKey(ref, a.pairingId)), true);
  }

  // Concurrency: CAS means only one index row even if both read before write
  {
    const store = createStore();
    const svc = createPairingService(store);
    const installId = 'c'.repeat(32);
    const results = await Promise.all([
      svc.recordPairing({ inviteToken: invite, installId, inviteRecord, now }),
      svc.recordPairing({ inviteToken: invite, installId, inviteRecord, now }),
    ]);
    check('both resolve ok', results.every((r) => r.ok), true);
    check('exactly one isNew', results.filter((r) => r.isNew).length, 1);
    check('one index row under concurrency', (await svc.countPairingsForInvite(ref)), 1);
  }

  // Cap from index; existing pairing still resolves at the cap
  {
    const store = createStore();
    const svc = createPairingService(store);
    for (let i = 0; i < MAX_PAIRINGS; i += 1) {
      await svc.recordPairing({
        inviteToken: invite,
        installId: i.toString(16).padStart(32, '0'),
        inviteRecord,
        now,
      });
    }
    check('at cap', (await svc.countPairingsForInvite(ref)), MAX_PAIRINGS);
    const blocked = await svc.recordPairing({ inviteToken: invite, installId: 'd'.repeat(32), inviteRecord, now });
    check('new device blocked', blocked.ok, false);
    check('blocked code', blocked.code, 'PAIRING_LIMIT');

    const existing = await svc.recordPairing({
      inviteToken: invite,
      installId: '0'.repeat(32),
      inviteRecord,
      now,
    });
    check('existing device still allowed at cap', existing.ok, true);
    check('existing not new', existing.isNew, false);
  }

  // Legacy empty installId occupies its own pairing
  {
    const store = createStore();
    const svc = createPairingService(store);
    const legacy = await svc.recordPairing({ inviteToken: invite, installId: '', inviteRecord, now });
    check('legacy allowed', legacy.ok, true);
    check('legacy recorded', (await svc.countPairingsForInvite(ref)), 1);
  }

  // Pairings do not expire: lifetime ends on deactivation/revocation
  {
    const store = createStore();
    const svc = createPairingService(store);
    await svc.recordPairing({ inviteToken: invite, installId: 'f'.repeat(32), inviteRecord, now });
    const write = store.writes.find((w) => w.key.startsWith('pairings:'));
    check('no ttl on pairing writes', write.options && write.options.ttl, undefined);
    const row = store.map.get(write.key);
    check('no expiry on the record', JSON.parse(row).expiresAt, undefined);
  }

  console.log(`\n${passed}/${passed + failed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
