import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { resetKvs, seedKvs, readKvs } from '../../scripts/test-support/stubs/forge-kvs.mjs';
import { heartbeat, countActive, identityKey, ACTIVE_WINDOW_MS } from './metering.js';

beforeEach(() => {
  resetKvs();
});

test('a heartbeat records the identity and refreshes one row', async () => {
  const key = await heartbeat({ kind: 'user', id: 'acc-1' }, 1000);
  assert.equal(key, identityKey('user', 'acc-1'));
  assert.deepEqual(readKvs(key), { kind: 'user', id: 'acc-1', lastSeenAt: 1000 });

  await heartbeat({ kind: 'user', id: 'acc-1' }, 5000);
  assert.equal(readKvs(key).lastSeenAt, 5000);
});

test('an identity that cannot be named is not recorded', async () => {
  assert.equal(await heartbeat({ kind: 'user', id: '' }, 1000), null);
  assert.equal(await heartbeat({ kind: 'nonsense', id: 'x' }, 1000), null);
});

test('only identities inside the window count', async () => {
  const now = 1_000_000;
  seedKvs({
    [identityKey('user', 'fresh')]: { kind: 'user', id: 'fresh', lastSeenAt: now - 1000 },
    [identityKey('user', 'stale')]: { kind: 'user', id: 'stale', lastSeenAt: now - ACTIVE_WINDOW_MS - 1 },
    [identityKey('guest', 'g1')]: { kind: 'guest', id: 'g1', lastSeenAt: now - 2000 },
  });

  const meter = await countActive(now);

  assert.equal(meter.users, 1);
  assert.equal(meter.guests, 1);
  assert.equal(meter.total, 2);
  assert.equal(meter.windowMinutes, 20);
  assert.equal(meter.unavailable, false);
});

test('a guest is counted as themselves, not as the sponsor they report through', async () => {
  const now = 2_000_000;
  seedKvs({
    [identityKey('user', 'acc-sponsor')]: { kind: 'user', id: 'acc-sponsor', lastSeenAt: now - 500 },
    [identityKey('guest', 'guest-1')]: { kind: 'guest', id: 'guest-1', lastSeenAt: now - 500 },
  });

  const meter = await countActive(now);

  assert.equal(meter.total, 2);
  assert.equal(meter.users, 1);
  assert.equal(meter.guests, 1);
});

test('a malformed row is ignored rather than counted as a person', async () => {
  const now = 3_000_000;
  seedKvs({
    [identityKey('user', 'ok')]: { kind: 'user', id: 'ok', lastSeenAt: now - 1 },
    'meterActive:user:broken': { kind: 'user', lastSeenAt: now - 1 },
  });

  const meter = await countActive(now);

  assert.equal(meter.total, 1);
});
