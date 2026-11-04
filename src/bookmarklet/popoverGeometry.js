/**
 * Anchored placement for the capture popover and the selection pill.
 * Pure geometry so the flip/clamp behaviour can be unit-tested.
 */
const GAP = 8;
const EDGE = 8;

export function placePopover({ anchor, size, viewport, gap = GAP }) {
  const width = Math.max(0, Number(size.width) || 0);
  const height = Math.max(0, Number(size.height) || 0);
  const maxLeft = Math.max(EDGE, viewport.width - EDGE - width);

  let left = anchor.left;
  if (left + width > viewport.width - EDGE) left = anchor.right - width;
  left = Math.min(Math.max(left, EDGE), maxLeft);

  let top = anchor.bottom + gap;
  if (top + height > viewport.height - EDGE) top = anchor.top - gap - height;
  const maxTop = Math.max(EDGE, viewport.height - EDGE - height);
  top = Math.min(Math.max(top, EDGE), maxTop);

  return { left: Math.round(left), top: Math.round(top) };
}
