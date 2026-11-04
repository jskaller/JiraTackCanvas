import assert from 'node:assert/strict';
import { isSeedPin } from './seedPin.js';

assert.equal(isSeedPin({ summary: 'Canvas created' }), true);
assert.equal(isSeedPin({ summary: '[JiraTack] Canvas created' }), true);
assert.equal(isSeedPin({ summary: '[jiratack]   Canvas created ' }), true);
assert.equal(isSeedPin({ summary: 'Canvas created the layout' }), false);
assert.equal(isSeedPin({ summary: 'Hero image misaligned' }), false);
assert.equal(isSeedPin({}), false);
assert.equal(isSeedPin(null), false);

console.log('PASS  seed pin detection');
