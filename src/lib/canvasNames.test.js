import assert from 'node:assert/strict';
import { normaliseCanvasName, findRecordByName } from './canvasNames.js';

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
