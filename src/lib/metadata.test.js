import assert from 'node:assert/strict';
import { normalizeMetadata, metadataFromIssue } from './metadataModel.js';

const BINDING = 'b'.repeat(64);
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

const base = {
  pin: { canvas: 'Q3 Marketing', url: 'https://example.com/p?page=2', position: '45.2,32.8', selector: '#hero' },
  version: 1,
};

// bindingId survives normalisation on write
const withBinding = normalizeMetadata({ ...base, bindingId: BINDING });
check('bindingId preserved', withBinding.bindingId, BINDING);

// pairingId survives normalisation on write
const PAIRING = 'c'.repeat(64);
const withPairing = normalizeMetadata({ ...base, pairingId: PAIRING });
check('pairingId preserved', withPairing.pairingId, PAIRING);

// Both survive a read through metadataFromIssue (read-side drop is the trap)
const issue = { properties: { 'com.jiratack.metadata': { ...base, bindingId: BINDING, pairingId: PAIRING } } };
check('bindingId readable', metadataFromIssue(issue).bindingId, BINDING);
check('pairingId readable', metadataFromIssue(issue).pairingId, PAIRING);

// Absent ids stay absent — legacy tickets are valid
check('legacy has no bindingId', 'bindingId' in normalizeMetadata(base), false);
check('legacy has no pairingId', 'pairingId' in normalizeMetadata(base), false);

// Malformed ids are dropped rather than persisted
check('short id dropped', 'bindingId' in normalizeMetadata({ ...base, bindingId: 'abc' }), false);
check('short pairing dropped', 'pairingId' in normalizeMetadata({ ...base, pairingId: 'abc' }), false);
check('uppercase hex dropped', 'bindingId' in normalizeMetadata({ ...base, bindingId: BINDING.toUpperCase() }), false);

// Guest + pin shape unchanged
const guestMeta = normalizeMetadata({
  ...base,
  bindingId: BINDING,
  guest: { name: 'Ada', email: 'ada@example.com' },
});
check('guest preserved', guestMeta.guest.email, 'ada@example.com');
check('version defaults', normalizeMetadata({ pin: base.pin }).version, 1);

// Invalid pins are still rejected
check('missing pin', normalizeMetadata({ version: 1 }), null);
check('empty canvas', normalizeMetadata({ pin: { ...base.pin, canvas: '' } }), null);

// The property is dropped when the issue carries none
check('no property', metadataFromIssue({ properties: {} }), null);

console.log(`\n${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
