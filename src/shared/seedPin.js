/**
 * The canvas seed ticket ("Canvas created") is bookkeeping, not a pin.
 *
 * It is a real Jira ticket with metadata and a position of `0,0`, so without
 * this filter it appears as a ticket card and a pin at the document origin. The
 * overlay hides it; the dashboard and epic panel still count it.
 */
export function isSeedPin(pin) {
  if (!pin || typeof pin.summary !== 'string') return false;
  return pin.summary.replace(/^\[JiraTack\]\s*/i, '').trim() === 'Canvas created';
}
