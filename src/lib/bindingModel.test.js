import assert from 'node:assert/strict';
import {
  normaliseEmail,
  bindingIdFor,
  monthKeyOf,
  createBinding,
  applyPin,
} from './bindingModel.js';

const SECRET = 'a'.repeat(64);
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

// Email normalisation: trim + lowercase only. +tags are distinct reviewers per PR-03.
check('trim/lower', normaliseEmail('  Ada@Example.COM '), 'ada@example.com');
check('plus-tag distinct', normaliseEmail('ada+qa@example.com'), 'ada+qa@example.com');
check('non-string', normaliseEmail(null), '');

// Deterministic HMAC identity
const id1 = bindingIdFor('ada@example.com', SECRET);
const id2 = bindingIdFor('  ADA@example.com ', SECRET);
const id3 = bindingIdFor('grace@example.com', SECRET);
check('binding id 64 hex', /^[a-f0-9]{64}$/.test(id1), true);
check('normalisation stable', id1, id2);
check('distinct emails differ', id1 === id3, false);
check('missing secret', bindingIdFor('ada@example.com', ''), null);
check('missing email', bindingIdFor('', SECRET), null);

// UTC month bucket
check('month key', monthKeyOf(Date.UTC(2026, 9, 31, 23, 59)), '2026-10');
check('month key rolls', monthKeyOf(Date.UTC(2026, 10, 1, 0, 0)), '2026-11');
check('month key invalid', monthKeyOf('not-a-date'), null);

// First pin flips issued -> active and stamps firstPinAt once
const now = Date.UTC(2026, 9, 31, 12, 0);
const created = createBinding({
  bindingId: id1,
  email: 'ada@example.com',
  issuedBy: 'acct-issuer',
  canvasName: 'Q3 Marketing',
  now,
});
check('initial state', created.state, 'issued');
check('initial pinCount', created.pinCount, 0);

const afterFirst = applyPin(created, { canvasName: 'Q3 Marketing', now });
check('first pin activates', afterFirst.state, 'active');
check('firstPinAt stamped', afterFirst.firstPinAt, now);
check('pinCount incremented', afterFirst.pinCount, 1);
check('monthPinCount', afterFirst.monthPinCount, 1);
check('canvas deduped', afterFirst.canvasAccess.length, 1);

const nextMonth = Date.UTC(2026, 10, 2, 9, 0);
const afterSecond = applyPin(afterFirst, { canvasName: 'Landing Page', now: nextMonth });
check('firstPinAt unchanged', afterSecond.firstPinAt, now);
check('lifetime pinCount', afterSecond.pinCount, 2);
check('month rolls over', afterSecond.monthKey, '2026-11');
check('monthPinCount reset', afterSecond.monthPinCount, 1);
check('canvas appended', afterSecond.canvasAccess.join(','), 'Q3 Marketing,Landing Page');

// Input is not mutated
check('pure: original untouched', created.state, 'issued');

// Revoked bindings are not silently reactivated
const revoked = { ...afterFirst, state: 'revoked' };
const afterRevokedPin = applyPin(revoked, { canvasName: 'Q3 Marketing', now: nextMonth });
check('revoked stays revoked', afterRevokedPin.state, 'revoked');

console.log(`\n${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
