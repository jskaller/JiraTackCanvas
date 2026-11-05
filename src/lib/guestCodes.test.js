import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseGuestCode,
  generateGuestCode,
  hashGuestCode,
  formatGuestCode,
} from './guestCodes.js';

test('a code is accepted in every shape a person might type', () => {
  assert.equal(normaliseGuestCode('JT-4F9K-2XQ7'), 'JT-4F9K-2XQ7');
  assert.equal(normaliseGuestCode('jt4f9k2xq7'), 'JT-4F9K-2XQ7');
  assert.equal(normaliseGuestCode(' JT 4F9K 2XQ7 '), 'JT-4F9K-2XQ7');
  assert.equal(normaliseGuestCode('4F9K2XQ7'), 'JT-4F9K-2XQ7');
});

test('ambiguous and out-of-alphabet characters are refused', () => {
  // 0/O and 1/I are excluded from the alphabet on purpose.
  assert.equal(normaliseGuestCode('JT-4F9K-2XQ0'), '');
  assert.equal(normaliseGuestCode('JT-4F9K-2XQ1'), '');
  assert.equal(normaliseGuestCode('JT-4F9K-2XQ7-EXTRA'), '');
  assert.equal(normaliseGuestCode('short'), '');
  assert.equal(normaliseGuestCode(''), '');
  assert.equal(normaliseGuestCode(null), '');
});

test('a generated code is always valid and never contains a lookalike', () => {
  for (let i = 0; i < 200; i += 1) {
    const code = generateGuestCode();
    assert.equal(normaliseGuestCode(code), code);
    assert.match(code, /^JT-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  }
});

test('the hash is stable and distinguishes codes', () => {
  const a = hashGuestCode('JT-4F9K-2XQ7');
  const b = hashGuestCode('jt-4f9k-2xq7');
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a, hashGuestCode('JT-4F9K-2XQ8'));
  assert.equal(hashGuestCode('nonsense'), '');
});

test('formatting keeps the readable groups', () => {
  assert.equal(formatGuestCode('4F9K2XQ7'), 'JT-4F9K-2XQ7');
});
