/**
 * Ticket ordering for the sidebar (D45).
 *
 * The API returns tickets oldest-first (the scan is `ORDER BY created ASC`), so
 * the sidebar used to read bottom-up: the ticket a reviewer just made appeared
 * at the bottom of the list. Newest-first is the useful order.
 */

function timeOf(pin) {
  const value = pin && pin.createdAt ? Date.parse(pin.createdAt) : NaN;
  return Number.isFinite(value) ? value : 0;
}

/**
 * A new array, newest first. Ties keep their incoming order (Array#sort is
 * stable), and pins with no usable date sort last rather than jumping to the top.
 */
export function sortPinsNewestFirst(pins) {
  return (Array.isArray(pins) ? pins : [])
    .slice()
    .sort((a, b) => timeOf(b) - timeOf(a));
}
