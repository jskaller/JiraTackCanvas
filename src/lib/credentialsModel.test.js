import assert from 'node:assert/strict';
import {
  MAX_PAIRINGS,
  hashToken,
  parentRefOf,
  remainingTtlSeconds,
  pairingAllowed,
  buildCredentialRecord,
  credentialIndexKey,
  credentialKey,
} from './credentialsModel.js';

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

const raw = 'a'.repeat(64);
const now = Date.UTC(2026, 9, 31, 12, 0);

check('hash is 64 hex', /^[a-f0-9]{64}$/.test(hashToken(raw)), true);
check('hash deterministic', hashToken(raw), hashToken(raw));
check('parentRef 16 hex', /^[a-f0-9]{16}$/.test(parentRefOf(raw)), true);
check('distinct tokens differ', hashToken(raw) === hashToken('b'.repeat(64)), false);

check('ttl ceil', remainingTtlSeconds(now + 90_000, now), 90);
check('ttl floor', remainingTtlSeconds(now - 10_000, now), 60);

check('missing parent', pairingAllowed(null).code, 'TOKEN_INVALID');
check('revoked parent', pairingAllowed({ revoked: true }).code, 'TOKEN_INVALID');
check('at cap', pairingAllowed({ pairingCount: MAX_PAIRINGS }).code, 'PAIRING_LIMIT');
check('under cap', pairingAllowed({ pairingCount: 2 }).ok, true);
check('missing count treated as 0', pairingAllowed({}).ok, true);

const parent = { expiresAt: now + 3600_000, scope: 'guest_create' };
const record = buildCredentialRecord({ raw, parent, parentToken: raw, deviceLabel: 'Chrome 140 / macOS', now });
check('record has id', record.credentialId, hashToken(raw));
check('raw not stored', 'token' in record || 'raw' in record, false);
check('starts active', record.state, 'active');
check('binding unset', record.bindingId, null);
check('inherits expiry', record.expiresAt, parent.expiresAt);
check('device label', record.deviceLabel, 'Chrome 140 / macOS');
check('pairing id present', typeof record.pairingId, 'string');

check('credential key', credentialKey(record.credentialId), `credentialTokens:${record.credentialId}`);
check(
  'index key',
  credentialIndexKey(record.parentRef, record.credentialId),
  `credentialsByParent:${record.parentRef}:${record.credentialId}`,
);

console.log(`\n${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
