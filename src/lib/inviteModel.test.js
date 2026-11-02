import assert from 'node:assert/strict';
import {
  LINK_TTL_MS,
  linkExpiresAt,
  invitationState,
  invitationStatus,
  canPairNewDevice,
  canUseExistingPairing,
} from './inviteModel.js';

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

const now = Date.UTC(2026, 10, 2, 12, 0);
const live = { state: 'active', linkExpiresAt: now + 60_000 };
const linkExpired = { state: 'active', linkExpiresAt: now - 60_000 };

check('ttl is 72h', LINK_TTL_MS, 72 * 60 * 60 * 1000);
check('linkExpiresAt preferred', linkExpiresAt({ linkExpiresAt: 1, expiresAt: 2 }), 1);
check('expiresAt fallback', linkExpiresAt({ expiresAt: 2 }), 2);
check('missing invite', linkExpiresAt(null), null);

check('state active', invitationState({ state: 'active' }), 'active');
check('state default active', invitationState({}), 'active');
check('state inactive', invitationState({ state: 'inactive' }), 'inactive');
check('revoked wins', invitationState({ state: 'inactive', revoked: true }), 'revoked');

check('status active', invitationStatus(live, now), 'active');
check('status expired link', invitationStatus(linkExpired, now), 'expired');
check('status inactive', invitationStatus({ state: 'inactive', linkExpiresAt: now + 1 }, now), 'inactive');
check('status revoked', invitationStatus({ revoked: true }, now), 'revoked');

check('new device allowed', canPairNewDevice(live, now), true);
check('new device blocked by expiry', canPairNewDevice(linkExpired, now), false);
check('new device blocked by inactive', canPairNewDevice({ state: 'inactive', linkExpiresAt: now + 1 }, now), false);

check('existing pairing survives link expiry', canUseExistingPairing(linkExpired), true);
check('existing pairing dies with revoke', canUseExistingPairing({ revoked: true }), false);
check('existing pairing dies with inactive', canUseExistingPairing({ state: 'inactive' }), false);

console.log(`\n${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
