import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { resetKvs, seedKvs, readKvs } from '../../../scripts/test-support/stubs/forge-kvs.mjs';
import { resetApi, onPath, jsonResponse } from '../../../scripts/test-support/stubs/forge-api.mjs';
import { exchangeLoginCode } from './exchangeToken.js';

const CODE = 'b'.repeat(64);

function loginRecord(overrides = {}) {
  return {
    accountId: 'acc-user',
    installationId: 'inst-1',
    isAdmin: false,
    permittedProjectsJson: '["TEST"]',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 120 * 1000,
    ...overrides,
  };
}

beforeEach(() => {
  resetKvs();
  resetApi();
  onPath('/rest/api/3/user', () => jsonResponse(200, { displayName: 'Reviewer', emailAddress: 'r@example.com' }));
  onPath('/rest/api/3/serverInfo', () => jsonResponse(200, { baseUrl: 'https://stub.atlassian.net' }));
});

test('a login code becomes a 90-day user token for the same account', async () => {
  seedKvs({ [`extensionLoginCodes:${CODE}`]: loginRecord() });

  const result = await exchangeLoginCode({ code: CODE }, { headers: {} });

  assert.equal(result.ok, true);
  assert.match(result.data.token, /^[a-f0-9]{64}$/);
  assert.equal(result.data.accountId, 'acc-user');
  assert.equal(result.data.isAdmin, false);
  assert.deepEqual(result.data.permittedProjects, ['TEST']);
  assert.equal(result.data.apiUrl, 'https://stub.invalid/jiratack-api');

  const stored = readKvs(`userTokens:${result.data.token}`);
  assert.equal(stored.userId, 'acc-user');
  assert.equal(stored.installationId, 'inst-1');
  assert.equal(stored.scope, 'create');
  assert.equal(stored.issuedVia, 'extension_login');
  assert.equal(stored.permittedCanvasesJson, '"all"');
  assert.ok(stored.expiresAt > Date.now() + 80 * 24 * 60 * 60 * 1000);
});

test('a login code is single-use', async () => {
  seedKvs({ [`extensionLoginCodes:${CODE}`]: loginRecord() });

  const first = await exchangeLoginCode({ code: CODE }, { headers: {} });
  assert.equal(first.ok, true);

  const second = await exchangeLoginCode({ code: CODE }, { headers: {} });
  assert.equal(second.ok, false);
  assert.equal(second.error.code, 'TOKEN_INVALID');
  assert.equal(readKvs(`extensionLoginCodes:${CODE}`), undefined);
});

test('an expired login code is refused', async () => {
  seedKvs({ [`extensionLoginCodes:${CODE}`]: loginRecord({ expiresAt: Date.now() - 1000 }) });

  const result = await exchangeLoginCode({ code: CODE }, { headers: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TOKEN_EXPIRED');
});

test('a malformed code is refused before the store is read', async () => {
  const result = await exchangeLoginCode({ code: 'nope' }, { headers: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TOKEN_INVALID');
});
