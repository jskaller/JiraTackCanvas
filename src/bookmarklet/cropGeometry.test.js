import assert from 'node:assert/strict';
import { maskRect } from './cropGeometry.js';

function recorder() {
  const calls = [];
  return {
    calls,
    ctx: {
      fillStyle: '',
      fillRect(x, y, width, height) {
        calls.push({ x, y, width, height, style: this.fillStyle });
      },
    },
  };
}

const source = { left: 0, top: 0, right: 400, bottom: 400 };
const output = { width: 800, height: 800 }; // 2× scale

// Sidebar fully outside the crop: nothing to hide.
{
  const { calls, ctx } = recorder();
  assert.equal(maskRect(ctx, { left: 500, top: 0, right: 600, bottom: 400 }, source, output), false);
  assert.deepEqual(calls, []);
}

// A sidebar on the right edge of the crop masks exactly that strip, scaled.
{
  const { calls, ctx } = recorder();
  assert.equal(maskRect(ctx, { left: 300, top: 0, right: 400, bottom: 400 }, source, output), true);
  assert.deepEqual(calls, [{ x: 600, y: 0, width: 200, height: 800, style: '#ffffff' }]);
}

// Partial overlap is clamped to the source region, not to the sidebar.
{
  const { calls, ctx } = recorder();
  maskRect(ctx, { left: -50, top: 350, right: 50, bottom: 500 }, source, output);
  assert.deepEqual(calls, [{ x: 0, y: 700, width: 100, height: 100, style: '#ffffff' }]);
}

// A missing rect (no sidebar) is a no-op.
{
  const { calls, ctx } = recorder();
  assert.equal(maskRect(ctx, null, source, output), false);
  assert.deepEqual(calls, []);
}

// Degenerate source cannot divide by zero.
{
  const { calls, ctx } = recorder();
  assert.equal(
    maskRect(ctx, { left: 0, top: 0, right: 10, bottom: 10 }, { left: 0, top: 0, right: 0, bottom: 0 }, output),
    false,
  );
  assert.deepEqual(calls, []);
}

console.log('PASS  crop geometry');
