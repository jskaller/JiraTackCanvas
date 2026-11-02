/**
 * Remembers the last real text selection (plan 6.4).
 *
 * The selection cannot be read when the form opens: placing the pin is a click,
 * and a click collapses the selection first. `selectionchange` fires during the
 * drag, including a final empty event when it collapses — so ignore empties and
 * keep the last non-empty value.
 */
let lastSelection = '';

export function installSelectionTracking() {
  if (typeof window === 'undefined' || window.__jiratackSelectionTracking) return;
  window.__jiratackSelectionTracking = true;

  document.addEventListener('selectionchange', () => {
    let text = '';
    try {
      text = String(window.getSelection() || '').trim();
    } catch (e) {
      text = '';
    }
    // Collapse fires with an empty value; that is not a new selection.
    if (text) lastSelection = text.slice(0, 2000);
  });
}

export function getLastSelection() {
  return lastSelection;
}

export function clearLastSelection() {
  lastSelection = '';
}
