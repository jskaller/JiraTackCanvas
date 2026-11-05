import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { resetKvs, seedKvs, readKvs, kvsKeys } from '../../../scripts/test-support/stubs/forge-kvs.mjs';
import { resetApi } from '../../../scripts/test-support/stubs/forge-api.mjs';
import { exchangeGuestCode } from './exchangeGuestCode.js';
import { hashGuestCode, codeIndexKey } from '../../lib/guestCodes.js';

const CODE = 'JT-4F9K-2XQ7';
const TOKEN = 'e'.repeat(64);
const INSTALL_ID = 'f'.repeat(32);
const DAY = 24 * 60 * 60 * 1000;

function inviteRecord(overrides = {}) {
  return {
    scope: 'guest_create',
    issuer: 'acc-sponsor',
    issuedByName: 'Sponsor',
    issuerEmail: 'sponsor@example.com',
    guestName: 'Guest User',
    guestEmail: 'guest@example.com',
    permittedCanvases: ['Canvas A'],
    permittedProjectsJson: '["TEST"]',
    installationId: 'inst-1',
    state: 'active',
    issuedAt: Date.now(),
    linkExpiresAt: Date.now() + 90 * DAY,
    revoked: false,
    codeHash: hashGuestCode(CODE),
    ...overrides,
  };
}

function seedCode(overrides = {}, index = {}) {
  seedKvs({
    [codeIndexKey(hashGuestCode(CODE))]: {
      inviteToken: TOKEN,
      installationId: 'inst-1',
      expiresAt: Date.now() + 90 * DAY,
      ...index,
    },
    [`canvasTokens:${TOKEN}`]: inviteRecord(overrides),
  });
}

beforeEach(() => {
  resetKvs();
  resetApi();
});

test('a guest code becomes the composite guest credential', async () => {
  seedCode();

  const result = await exchangeGuestCode({ code: CODE, installId: INSTALL_ID }, { headers: {} });

  assert.equal(result.ok, true);
  assert.equal(result.data.token, `${TOKEN}.${INSTALL_ID}`);
  // The page composes the bare token with its own device id; returning only a
  // composite would make it compose twice (`invite.install.install`).
  assert.equal(result.data.inviteToken, TOKEN);
  assert.equal(result.data.token.split('.').length, 2);
  assert.equal(result.data.scope, 'guest_create');
  assert.equal(result.data.guestName, 'Guest User');
  assert.equal(result.data.guestEmail, 'guest@example.com');
  assert.deepEqual(result.data.permittedCanvases, ['Canvas A']);
  assert.equal(result.data.apiUrl, 'https://stub.invalid/jiratack-api');
});

test('the exchange pairs the device, so the device cap still applies', async () => {
  seedCode();

  const result = await exchangeGuestCode({ code: CODE, installId: INSTALL_ID }, { headers: {} });
  assert.equal(result.ok, true);

  const pairingKeys = kvsKeys().filter((key) => key.startsWith('pairings:'));
  assert.equal(pairingKeys.length, 1);
  assert.equal(readKvs(pairingKeys[0]).installId, INSTALL_ID);
});

test('a revoked invitation refuses its code even though the index still exists', async () => {
  seedCode({ revoked: true });

  const result = await exchangeGuestCode({ code: CODE, installId: INSTALL_ID }, { headers: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TOKEN_INVALID');
});

test('a paused invitation refuses its code', async () => {
  seedCode({ state: 'inactive' });

  const result = await exchangeGuestCode({ code: CODE, installId: INSTALL_ID }, { headers: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TOKEN_INVALID');
});

test('an unknown code is refused', async () => {
  const result = await exchangeGuestCode({ code: 'JT-2222-2222', installId: INSTALL_ID }, { headers: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TOKEN_INVALID');
});

test('a malformed code is refused without a store read', async () => {
  const result = await exchangeGuestCode({ code: 'nope', installId: INSTALL_ID }, { headers: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TOKEN_INVALID');
});

test('an expired code is refused', async () => {
  seedCode({}, { expiresAt: Date.now() - 1000 });

  const result = await exchangeGuestCode({ code: CODE, installId: INSTALL_ID }, { headers: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TOKEN_EXPIRED');
});

test('education: an unlisted invite shape is refused rather than half-issued', async () => {
  seedCode({ guestName: '' });

  const result = await exchangeGuestCode({ code: CODE, installId: INSTALL_ID }, { headers: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TOKEN_INVALID');
});
