import assert from 'node:assert/strict';
import { createSessionManager } from './auth.js';

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

function createStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    keys: (prefix) => [...map.keys()].filter((k) => k.startsWith(prefix)),
    _map: map,
  };
}

let calls = 0;
let responder = () => ({ ok: true, guestName: null, guestEmail: null });

globalThis.fetch = async (url, options) => {
  calls += 1;
  const payload = JSON.parse(options.body);
  const data = responder(payload.payload.canvasToken);
  return {
    ok: true,
    async json() {
      return {
        ok: true,
        data: {
          sessionJwt: `jwt-${calls}`,
          expiresAt: Date.now() + 3600_000,
          scope: data.scope || 'create',
          permittedProjects: [],
          isAdmin: false,
          displayName: 'Sponsor',
          ...data,
        },
      };
    },
  };
};

const run = async () => {
  const storage = createStorage();
  const manager = createSessionManager(storage);

  // A session minted for invitation A
  responder = () => ({ scope: 'guest_create', guestName: 'Jane', guestEmail: 'jane@acme.com', issuer: 'acct-1' });
  const first = await manager.exchange({ canvasId: 'guest', apiUrl: 'https://api', token: 'inviteA.install1' });
  check('first exchange calls fetch', calls, 1);
  check('first has identity', first.guestName, 'Jane');

  // Same token is cached
  const cached = await manager.exchange({ canvasId: 'guest', apiUrl: 'https://api', token: 'inviteA.install1' });
  check('same token uses cache', calls, 1);
  check('cached identity', cached.guestEmail, 'jane@acme.com');

  // A different invitation must NOT reuse the cached session
  responder = () => ({ scope: 'guest_create', guestName: 'Sam', guestEmail: 'sam@acme.com', issuer: 'acct-2' });
  const second = await manager.exchange({ canvasId: 'guest', apiUrl: 'https://api', token: 'inviteB.install2' });
  check('new token re-exchanges', calls, 2);
  check('new token has new identity', second.guestName, 'Sam');
  check('new token has new sponsor', second.issuer, 'acct-2');

  // Legacy shape (no schema/tokenKey) is never reused
  storage.setItem('jiratack_jwt_guest', JSON.stringify({ jwt: 'old', expiresAt: Date.now() + 1000, displayName: 'x', isAdmin: false }));
  responder = () => ({ scope: 'guest_create', guestName: 'Jane', guestEmail: 'jane@acme.com' });
  await manager.exchange({ canvasId: 'guest', apiUrl: 'https://api', token: 'inviteA.install1' });
  check('legacy session is re-exchanged', calls, 3);

  console.log(`\n${passed}/${passed + failed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
