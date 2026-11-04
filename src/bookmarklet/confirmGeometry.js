/**
 * Where the move confirmation bar goes: next to the pin, on-screen, and clear
 * of the sidebar. Pure geometry so the flip/clamp behaviour is unit-tested.
 *
 * All inputs are CSS pixels in the viewport's coordinate space.
 */
const GAP = 10;
const EDGE = 8;
const CARET_INSET = 14;

export function placeConfirmBar({ pin, bar, viewport, reservedRight = 0 }) {
  const pinCentreX = pin.left + pin.width / 2;
  const fitsBelow = pin.top + pin.height + GAP + bar.height <= viewport.height - EDGE;

  const wantedTop = fitsBelow ? pin.top + pin.height + GAP : pin.top - GAP - bar.height;
  const maxTop = Math.max(EDGE, viewport.height - EDGE - bar.height);
  const maxLeft = Math.max(EDGE, viewport.width - reservedRight - EDGE - bar.width);

  const left = Math.min(Math.max(pinCentreX - bar.width / 2, EDGE), maxLeft);
  const caretLeft = Math.min(
    Math.max(pinCentreX - left, CARET_INSET),
    Math.max(CARET_INSET, bar.width - CARET_INSET),
  );

  return {
    left: Math.round(left),
    top: Math.round(Math.min(Math.max(wantedTop, EDGE), maxTop)),
    placement: fitsBelow ? 'below' : 'above',
    caretLeft: Math.round(caretLeft),
  };
}
