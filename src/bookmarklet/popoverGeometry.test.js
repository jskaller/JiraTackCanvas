import assert from 'node:assert/strict';
import { placePopover } from './popoverGeometry.js';

const viewport = { width: 800, height: 600 };
const size = { width: 340, height: 220 };

const below = placePopover({
  anchor: { left: 200, top: 100, right: 300, bottom: 120 },
  size,
  viewport,
});
assert.equal(below.left, 200);
assert.equal(below.top, 128);

const flipped = placePopover({
  anchor: { left: 200, top: 500, right: 300, bottom: 520 },
  size,
  viewport,
});
assert.equal(flipped.top, 500 - 8 - 220);

const rightClamp = placePopover({
  anchor: { left: 700, top: 100, right: 760, bottom: 120 },
  size,
  viewport,
});
assert.equal(rightClamp.left, 760 - 340);
assert.ok(rightClamp.left + size.width <= viewport.width - 8);

const narrow = placePopover({
  anchor: { left: 0, top: 0, right: 10, bottom: 10 },
  size: { width: 900, height: 100 },
  viewport: { width: 375, height: 400 },
});
assert.equal(narrow.left, 8);
assert.ok(narrow.top >= 8);

console.log('PASS  popover geometry');
