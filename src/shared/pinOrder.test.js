import assert from 'node:assert/strict';
import { sortPinsNewestFirst } from './pinOrder.js';

const oldest = { key: 'OLD', createdAt: '2026-11-01T10:00:00.000+0000' };
const middle = { key: 'MID', createdAt: '2026-11-03T10:00:00.000+0000' };
const newest = { key: 'NEW', createdAt: '2026-11-05T10:00:00.000+0000' };
const undated = { key: 'NONE' };
const broken = { key: 'BAD', createdAt: 'not a date' };

// Newest first, which is the order a reviewer expects at the top of the list.
assert.deepEqual(
  sortPinsNewestFirst([oldest, newest, middle]).map((pin) => pin.key),
  ['NEW', 'MID', 'OLD'],
);

// Pins with no usable date go to the bottom, not the top.
assert.deepEqual(
  sortPinsNewestFirst([undated, oldest, broken]).map((pin) => pin.key),
  ['OLD', 'NONE', 'BAD'],
);

// Equal timestamps keep their incoming order.
assert.deepEqual(
  sortPinsNewestFirst([
    { key: 'A', createdAt: '2026-11-05T10:00:00.000+0000' },
    { key: 'B', createdAt: '2026-11-05T10:00:00.000+0000' },
  ]).map((pin) => pin.key),
  ['A', 'B'],
);

// The caller's array is never mutated.
const input = [oldest, newest];
sortPinsNewestFirst(input);
assert.deepEqual(input.map((pin) => pin.key), ['OLD', 'NEW']);

// Tolerates junk.
assert.deepEqual(sortPinsNewestFirst(null), []);
assert.deepEqual(sortPinsNewestFirst(undefined), []);
assert.deepEqual(sortPinsNewestFirst([]), []);

console.log('PASS  pin order');
