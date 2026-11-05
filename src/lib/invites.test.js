import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { resetKvs, readKvs } from '../../scripts/test-support/stubs/forge-kvs.mjs';
import { resetApi } from '../../scripts/test-support/stubs/forge-api.mjs';
import { createInvite, revokeGuestByRef } from './invites.js';
import { tokenReference } from './tokenRef.js';
import { hashGuestCode, codeIndexKey } from './guestCodes.js';

const BASE = {
  issuer: 'acc-sponsor',
  issuedByName: 'Sponsor',
  issuerEmail: 'sponsor@example.com',
  guestName: 'Jane Doe',
  guestEmail: 'jane@example.com',
  permittedCanvases: ['Canvas A'],
  permittedProjects: ['TEST'],
  installationId: 'inst-1',
};

beforeEach(() => {
  resetKvs();
  resetApi();
});

test('revoking a guest ends every invitation for that person, and only that person', async () => {
  const first = await createInvite(BASE);
  const second = await createInvite({ ...BASE, permittedCanvases: ['Canvas B'] });
  const someoneElse = await createInvite({ ...BASE, guestName: 'Sam', guestEmail: 'sam@example.com' });

  const result = await revokeGuestByRef({
    ref: tokenReference(first.token),
    viewerAccountId: 'acc-sponsor',
    isAdmin: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.revoked, 2);
  assert.equal(readKvs(`canvasTokens:${first.token}`).revoked, true);
  assert.equal(readKvs(`canvasTokens:${second.token}`).revoked, true);
  assert.equal(readKvs(`canvasTokens:${someoneElse.token}`).revoked, false);
});

test('revoking a guest also kills their typed codes', async () => {
  const invite = await createInvite(BASE);
  const indexPath = codeIndexKey(hashGuestCode(invite.code));
  assert.ok(readKvs(indexPath));

  await revokeGuestByRef({ ref: tokenReference(invite.token), viewerAccountId: 'acc-sponsor', isAdmin: false });

  assert.equal(readKvs(indexPath), undefined);
});

test('a sponsor cannot revoke another sponsor’s guest', async () => {
  const invite = await createInvite(BASE);

  const result = await revokeGuestByRef({
    ref: tokenReference(invite.token),
    viewerAccountId: 'acc-other',
    isAdmin: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'INSUFFICIENT_SCOPE');
  assert.equal(readKvs(`canvasTokens:${invite.token}`).revoked, false);
});

test('an admin can revoke any guest', async () => {
  const invite = await createInvite(BASE);

  const result = await revokeGuestByRef({
    ref: tokenReference(invite.token),
    viewerAccountId: 'acc-admin',
    isAdmin: true,
  });

  assert.equal(result.ok, true);
  assert.equal(readKvs(`canvasTokens:${invite.token}`).revoked, true);
});
