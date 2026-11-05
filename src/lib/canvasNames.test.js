import assert from 'node:assert/strict';
import { canvasNameKeySuffix, normaliseCanvasName, findRecordByName } from './canvasNames.js';

assert.equal(normaliseCanvasName('  Shopify +  Example.com '), 'shopify + example.com');
assert.equal(normaliseCanvasName('A\u00a0B'), 'a b');

const records = new Map([
  ['c-c2fe5a78', { key: 'c-c2fe5a78', name: 'Shopify + Example.com', names: ['Shopify + Example.com'] }],
  ['KAN-90', { key: 'KAN-90', name: 'Cancer Pages', names: ['Cancer Pages', 'Cancer'] }],
]);

// A ticket written before pin.canvasId existed still resolves to its record,
// including with different casing or spacing.
assert.equal(findRecordByName(records, 'Shopify + Example.com').key, 'c-c2fe5a78');
assert.equal(findRecordByName(records, 'shopify + example.com').key, 'c-c2fe5a78');
assert.equal(findRecordByName(records, '  Shopify   + Example.com  ').key, 'c-c2fe5a78');

// Historical names keep resolving after a rename.
assert.equal(findRecordByName(records, 'Cancer').key, 'KAN-90');

assert.equal(findRecordByName(records, 'Not a canvas'), null);
assert.equal(findRecordByName(records, ''), null);
assert.equal(findRecordByName(null, 'Shopify + Example.com'), null);

// Works with a plain object too (defensive: callers pass either shape).
assert.equal(
  findRecordByName({ 'c-x': { key: 'c-x', name: 'Thing', names: [] } }, 'thing').key,
  'c-x',
);

console.log('PASS  canvas name resolution');

/**
 * Names are free text; KVS keys are not. `Shopify + Example.com` contains `+`,
 * which the store rejects — the index write failed silently for that reason and
 * the canvas looked unindexed. Every suffix must be a legal key.
 */
const KVS_KEY = /^[a-zA-Z0-9:._\s#-]+$/;
for (const name of [
  'Shopify + Example.com',
  "Bob's / QA & co",
  '50% off (2026)',
  '🎯 test',
  'a+b',
]) {
  const key = `canvasName:${canvasNameKeySuffix(name)}`;
  assert.match(key, KVS_KEY, `key for ${JSON.stringify(name)} is not KVS-safe`);
  assert.ok(key.length <= 200, 'key stays well under the store limit');
}

// Deterministic: the same name always finds its row, whatever the spacing.
assert.equal(
  canvasNameKeySuffix('Shopify + Example.com'),
  canvasNameKeySuffix('  shopify   + example.com '),
);

// Two names that slug the same still get different rows.
assert.notEqual(canvasNameKeySuffix('a+b'), canvasNameKeySuffix('a-b'));
