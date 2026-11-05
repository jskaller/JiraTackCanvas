import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { resetKvs, readKvs } from '../../../scripts/test-support/stubs/forge-kvs.mjs';
import { resetApi, onPath, jsonResponse } from '../../../scripts/test-support/stubs/forge-api.mjs';
import { createExtensionLogin } from './admin.js';

// The resolver is the only place that knows the real Jira user, so the code it
// mints is the whole identity proof for Flow 1 (D46).
const CONTEXT = {
  accountId: 'acc-user',
  installationId: 'inst-1',
  userAccess: { hasAccess: true, isAdmin: false },
};

beforeEach(() => {
  resetKvs();
  resetApi();
  onPath('/rest/api/3/project/search', () => jsonResponse(200, { values: [{ key: 'TEST' }] }));
});

test('mints a one-time code bound to the signed-in user', async () => {
  const result = await createExtensionLogin(CONTEXT);

  assert.equal(result.ok, true);
  assert.match(result.data.code, /^[a-f0-9]{64}$/);
  assert.equal(result.data.apiUrl, 'https://stub.invalid/jiratack-api');
  assert.equal(result.data.sdkUrl, 'https://stub.invalid/jiratack-sdk');
  assert.ok(result.data.expiresAt > Date.now());

  const record = readKvs(`extensionLoginCodes:${result.data.code}`);
  assert.equal(record.accountId, 'acc-user');
  assert.equal(record.installationId, 'inst-1');
  assert.equal(record.isAdmin, false);
  assert.equal(record.permittedProjectsJson, '["TEST"]');
  assert.ok(record.expiresAt > Date.now());
});

test('carries admin rights resolved at issuance, not a client claim', async () => {
  const result = await createExtensionLogin({
    ...CONTEXT,
    accountId: 'acc-admin',
    userAccess: { hasAccess: true, isAdmin: true },
  });

  assert.equal(result.ok, true);
  assert.equal(readKvs(`extensionLoginCodes:${result.data.code}`).isAdmin, true);
});

test('refuses a context with no signed-in user', async () => {
  const result = await createExtensionLogin({});

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'BAD_REQUEST');
});
