import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { resetKvs } from '../../../scripts/test-support/stubs/forge-kvs.mjs';
import { resetApi } from '../../../scripts/test-support/stubs/forge-api.mjs';
import { handler } from '../install.js';

beforeEach(() => {
  resetKvs();
  resetApi();
});

test('a code link renders the code entry page', async () => {
  const res = await handler({ queryParameters: { code: 'JT-4F9K-2XQ7' } });

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /JT-4F9K-2XQ7/);
  assert.match(res.body, /exchangeGuestCode/);
  // The code page exchanges the code, so it must not publish a token first.
  assert.doesNotMatch(res.body, /__jiratackConfig/);
});

test('the code page keeps the mode through the redirect', async () => {
  const res = await handler({ queryParameters: { code: 'JT-4F9K-2XQ7', mode: 'extension' } });

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /mode=extension/);
});

test('neither a token nor a code is not found', async () => {
  const res = await handler({ queryParameters: {} });
  assert.equal(res.statusCode, 404);
});

test('a token link still goes through the install phases', async () => {
  const res = await handler({ queryParameters: { token: 'a'.repeat(64) } });

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /installId/);
});
