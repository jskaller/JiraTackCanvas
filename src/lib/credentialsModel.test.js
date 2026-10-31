import assert from 'node:assert/strict';
import {
  MAX_PAIRINGS,
  INSTALL_ID_RE,
  hashToken,
  parentRefOf,
  remainingTtlSeconds,
  pairingIdFor,
  remainingPairings,
  buildPairingRecord,
  pairingKey,
  pairingIndexKey,
  pairingIndexPrefix,
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

const invite = 'a'.repeat(64);
const installId = 'b'.repeat(32);
const now = Date.UTC(2026, 9, 31, 12, 0);

check('cap is 10', MAX_PAIRINGS, 10);
check('installId format', INSTALL_ID_RE.test(installId), true);
check('uuid rejected', INSTALL_ID_RE.test('123e4567-e89b-12d3-a456-426614174000'), false);
check('uppercase hex rejected', INSTALL_ID_RE.test('B'.repeat(32)), false);

check('hash deterministic', hashToken(invite), hashToken(invite));
check('parentRef 16 hex', /^[a-f0-9]{16}$/.test(parentRefOf(invite)), true);
check('ttl ceil', remainingTtlSeconds(now + 90_000, now), 90);
check('ttl floor', remainingTtlSeconds(now - 10_000, now), 60);

check('pairing id 64 hex', /^[a-f0-9]{64}$/.test(pairingIdFor(invite, installId)), true);
check('pairing id stable', pairingIdFor(invite, installId), pairingIdFor(invite, installId));
check('install matters', pairingIdFor(invite, installId) === pairingIdFor(invite, 'c'.repeat(32)), false);
check('legacy differs from a real install', pairingIdFor(invite, '') === pairingIdFor(invite, installId), false);

check('remaining full', remainingPairings(0), 10);
check('remaining partial', remainingPairings(7), 3);
check('remaining floor', remainingPairings(12), 0);

const record = buildPairingRecord({
  inviteToken: invite,
  installId,
  userAgent: 'Mozilla/5.0',
  now,
  expiresAt: now + 3600_000,
});
check('record id', record.pairingId, pairingIdFor(invite, installId));
check('record ref', record.inviteTokenRef, parentRefOf(invite));
check('record install', record.installId, installId);
check('record state', record.state, 'active');
check('record firstSeen', record.firstSeenAt, now);
check('record ua', record.userAgent, 'Mozilla/5.0');
check('no secret on record', 'token' in record || 'raw' in record || 'credentialId' in record, false);
check('no binding on record', 'bindingId' in record, false);

const legacy = buildPairingRecord({ inviteToken: invite, installId: '', now });
check('legacy install empty', legacy.installId, '');
check('legacy id differs', legacy.pairingId === record.pairingId, false);

check('pairing key', pairingKey('f'.repeat(64)), `pairings:${'f'.repeat(64)}`);
check(
  'index key',
  pairingIndexKey('0123456789abcdef', 'f'.repeat(64)),
  `pairingIndex:0123456789abcdef:${'f'.repeat(64)}`,
);
check('index prefix', pairingIndexPrefix('0123456789abcdef'), 'pairingIndex:0123456789abcdef:');

console.log(`\n${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
