import assert from 'node:assert/strict';
import { placeConfirmBar } from './confirmGeometry.js';

const viewport = { width: 800, height: 600 };
const bar = { width: 180, height: 34 };
const pin = { left: 200, top: 100, width: 18, height: 18 };

const below = placeConfirmBar({ pin, bar, viewport, reservedRight: 320 });
assert.equal(below.placement, 'below');
assert.equal(below.top, pin.top + pin.height + 10);
assert.equal(below.left, Math.round(200 + 9 - 90));
assert.equal(below.caretLeft, 90);

// Near the bottom the bar flips above the pin instead of leaving the viewport.
const flipped = placeConfirmBar({
  pin: { ...pin, top: 560 },
  bar,
  viewport,
  reservedRight: 320,
});
assert.equal(flipped.placement, 'above');
assert.equal(flipped.top, 560 - 10 - 34);

// The sidebar is reserved: the bar never slides under it.
const pinnedRight = placeConfirmBar({
  pin: { ...pin, left: 470 },
  bar,
  viewport,
  reservedRight: 320,
});
assert.equal(pinnedRight.left, 800 - 320 - 8 - 180);
assert.ok(pinnedRight.left + bar.width <= 800 - 320 - 8);

// The caret tracks the pin centre but stays inside the rounded corners.
assert.equal(
  placeConfirmBar({ pin: { ...pin, left: 8 }, bar, viewport }).caretLeft,
  14,
);
// A narrow bar cannot stay centred under a pin near the edge; the caret is
// pulled in so it never sits on the rounded corner.
assert.equal(
  placeConfirmBar({
    pin: { ...pin, left: 780 },
    bar: { width: 40, height: 34 },
    viewport,
  }).caretLeft,
  26,
);

// A tiny viewport still yields an on-screen bar.
const clipped = placeConfirmBar({
  pin: { left: 0, top: 0, width: 18, height: 18 },
  bar: { width: 400, height: 34 },
  viewport: { width: 320, height: 240 },
});
assert.equal(clipped.left, 8);
assert.ok(clipped.top >= 8 && clipped.top + 34 <= 240);

console.log('PASS  confirm bar geometry');
