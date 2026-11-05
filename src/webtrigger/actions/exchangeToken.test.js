import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

import { readKvs, resetKvs, seedKvs, kvsKeys } from '../../../scripts/test-support/stubs/forge-kvs.mjs';
import { resetApi, onPath, jsonResponse, unmatchedRequests } from '../../../scripts/test-support/stubs/forge-api.mjs';
import { exchangeToken } from './exchangeToken.js';
import { getSigningSecret } from '../../lib/tokens.js';

const TOKEN = 'a'.repeat(64);
const NOW = Date.now();

function canvasRecord(overrides = {}) {
  return {
    canvasName: 'Shopify + Example.com',
    userId: 'acc-1',
    installationId: 'inst-1',
    scope: 'create',
    isAdmin: false,
    issuedAt: NOW,
    expiresAt: NOW + 24 * 60 * 60 * 1000,
    revoked: false,
    permittedProjectsJson: '["TEST"]',
    permittedCanvasesJson: '["Shopify + Example.com"]',
    ...overrides,
  };
}

// The signer caches the secret in memory, so ask it rather than the store (a
// reset between tests clears the record but not the module's promise).
async function claimsOf(sessionJwt) {
  const secret = await getSigningSecret();
  return jwt.verify(sessionJwt, secret);
}

beforeEach(() => {
  resetKvs();
  resetApi();
  onPath('/rest/api/3/user', () => jsonResponse(200, { displayName: 'Reviewer', emailAddress: 'r@example.com' }));
  onPath('/rest/api/3/serverInfo', () => jsonResponse(200, { baseUrl: 'https://stub.atlassian.net' }));
});

/**
 * Every surface depends on this path: a canvas token becomes a session whose
 * claims decide what the overlay may read and write. It had no tests.
 */
test('a canvas token mints a session carrying its scope and permissions', async () => {
  seedKvs({ [`canvasTokens:${TOKEN}`]: canvasRecord() });

  const result = await exchangeToken({ canvasToken: TOKEN }, { headers: {} });

  assert.equal(result.ok, true);
  assert.equal(result.data.scope, 'create');
  assert.equal(result.data.canvasName, 'Shopify + Example.com');
  assert.equal(result.data.isAdmin, false);
  assert.deepEqual(result.data.permittedProjects, ['TEST']);

  const claims = await claimsOf(result.data.sessionJwt);
  assert.equal(claims.scope, 'create');
  assert.equal(claims.canvasName, 'Shopify + Example.com');
  assert.equal(claims.isAdmin, false);
  assert.deepEqual(claims.permittedProjects, ['TEST']);
  assert.ok(claims.exp > claims.iat);
});

test('a user token mints a session with no canvas and its permitted canvases', async () => {
  seedKvs({
    [`userTokens:${TOKEN}`]: {
      userId: 'acc-2',
      installationId: 'inst-1',
      scope: 'universal',
      isAdmin: true,
      issuedAt: NOW,
      expiresAt: NOW + 24 * 60 * 60 * 1000,
      revoked: false,
      permittedProjectsJson: '*',
      permittedCanvasesJson: '["One", "Two"]',
    },
  });

  const result = await exchangeToken({ canvasToken: TOKEN }, { headers: {} });

  assert.equal(result.ok, true);
  assert.equal(result.data.canvasId, null);
  assert.equal(result.data.isAdmin, true);

  const claims = await claimsOf(result.data.sessionJwt);
  assert.deepEqual(claims.permittedCanvases, ['One', 'Two']);
  assert.equal(claims.isAdmin, true);
  assert.equal(claims.canvasName, undefined);
});

test('a revoked token is refused', async () => {
  seedKvs({ [`canvasTokens:${TOKEN}`]: canvasRecord({ revoked: true }) });

  const result = await exchangeToken({ canvasToken: TOKEN }, { headers: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TOKEN_INVALID');
});

test('an expired token says so instead of failing to sign', async () => {
  seedKvs({ [`canvasTokens:${TOKEN}`]: canvasRecord({ expiresAt: NOW - 1000 }) });

  const result = await exchangeToken({ canvasToken: TOKEN }, { headers: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TOKEN_EXPIRED');
});

test('a malformed token never reaches the KV store', async () => {
  const result = await exchangeToken({ canvasToken: 'NOT-HEX-💥' }, { headers: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TOKEN_INVALID');
});

test('a guest invitation mints a confined guest session', async () => {
  seedKvs({
    [`canvasTokens:${TOKEN}`]: {
      scope: 'guest_create',
      guestName: 'Guest Reviewer',
      guestEmail: 'guest@example.com',
      issuer: 'acc-issuer',
      installationId: 'inst-1',
      permittedProjectsJson: '*',
      permittedCanvases: ['Guarded canvas'],
      issuedAt: NOW,
      linkExpiresAt: NOW + 24 * 60 * 60 * 1000,
      revoked: false,
    },
  });

  const result = await exchangeToken({ canvasToken: TOKEN }, { headers: { 'user-agent': 'test-agent' } });

  assert.equal(result.ok, true);
  assert.equal(result.data.scope, 'guest_create');
  assert.equal(result.data.isAdmin, false);
  assert.equal(result.data.guestName, 'Guest Reviewer');

  const claims = await claimsOf(result.data.sessionJwt);
  assert.equal(claims.scope, 'guest_create');
  assert.equal(claims.isAdmin, false);
  assert.deepEqual(claims.permittedCanvases, ['Guarded canvas']);
});

test('an invitation without a named reviewer is refused with a clear message', async () => {
  seedKvs({ [`canvasTokens:${TOKEN}`]: canvasRecord({ scope: 'guest_create' }) });

  const result = await exchangeToken({ canvasToken: TOKEN }, { headers: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TOKEN_INVALID');
  assert.match(result.error.message, /out of date/i);
});

test('an unknown token is refused', async () => {
  const result = await exchangeToken({ canvasToken: TOKEN }, { headers: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TOKEN_INVALID');
  assert.deepEqual(unmatchedRequests(), []);
});

// D47: the exchange is the only moment the server knows both who is present
// and that they are still running, so it is where the usage meter is fed.
test('a successful exchange records the user as active, and a failure does not', async () => {
  seedKvs({
    [`userTokens:${TOKEN}`]: {
      userId: 'acc-2',
      installationId: 'inst-1',
      scope: 'create',
      isAdmin: false,
      issuedAt: NOW,
      expiresAt: NOW + 24 * 60 * 60 * 1000,
      revoked: false,
      permittedProjectsJson: '*',
      permittedCanvasesJson: '"all"',
    },
  });

  const ok = await exchangeToken({ canvasToken: TOKEN }, { headers: {} });
  assert.equal(ok.ok, true);
  assert.ok(readKvs('meterActive:user:acc-2'));

  resetKvs();
  const refused = await exchangeToken({ canvasToken: TOKEN }, { headers: {} });
  assert.equal(refused.ok, false);
  assert.equal(readKvs('meterActive:user:acc-2'), undefined);
});

test('a guest heartbeat is keyed by the guest, not the sponsor', async () => {
  seedKvs({
    [`canvasTokens:${TOKEN}`]: {
      scope: 'guest_create',
      guestName: 'Guest Reviewer',
      guestEmail: 'guest@example.com',
      issuer: 'acc-issuer',
      installationId: 'inst-1',
      permittedProjectsJson: '*',
      permittedCanvases: ['Guarded canvas'],
      issuedAt: NOW,
      linkExpiresAt: NOW + 24 * 60 * 60 * 1000,
      revoked: false,
    },
  });

  const result = await exchangeToken({ canvasToken: TOKEN }, { headers: { 'user-agent': 'test-agent' } });
  assert.equal(result.ok, true);
  assert.ok(result.data.guestId);

  const guestKey = kvsKeys().find((key) => key.startsWith('meterActive:guest:'));
  assert.ok(guestKey, kvsKeys().join(','));
  assert.equal(readKvs(guestKey).id, result.data.guestId);
  assert.equal(readKvs('meterActive:user:acc-issuer'), undefined);
});
