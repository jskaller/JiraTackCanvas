import { placeConfirmBar } from './confirmGeometry.js';

/**
 * The move is not written until it is confirmed (D33).
 *
 * No timer and no auto-commit: the reviewer either confirms, cancels, presses
 * Escape, or closes the overlay (which discards the move). While this bar is
 * open, no other pin can be dragged — one move at a time.
 */
export function createMoveConfirm(options = {}) {
  const { host, key, reservedRight = 0, onConfirm, onCancel } = options;

  const bar = document.createElement('div');
  bar.className = 'jiratack-move-confirm';
  bar.dataset.placement = 'below';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', `Confirm pin move for ${key}`);
  bar.style.visibility = 'hidden';

  const message = document.createElement('span');
  message.className = 'jiratack-move-confirm-message';
  message.textContent = `Move ${key} here?`;

  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'jiratack-move-confirm-accept';
  accept.textContent = 'Confirm';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'jiratack-move-confirm-cancel';
  cancel.textContent = 'Cancel';

  bar.appendChild(message);
  bar.appendChild(accept);
  bar.appendChild(cancel);

  let frame = null;
  let closed = false;
  let busy = false;

  function pinElement() {
    const pins = document.getElementById('jiratack-pins');
    if (!pins) return null;
    const candidates = pins.querySelectorAll('.jiratack-pin');
    for (let i = 0; i < candidates.length; i += 1) {
      if (candidates[i].dataset.key === key) return candidates[i];
    }
    return null;
  }

  function position() {
    if (closed) return;
    const pinEl = pinElement();
    if (!pinEl) {
      // The pin can disappear mid-capture if the reviewer changes a filter or
      // the canvas re-renders. Keep the bar usable rather than invisible and
      // unclickable: park it at the bottom of the page area.
      const width = bar.offsetWidth;
      const height = bar.offsetHeight;
      bar.style.left = `${Math.max(8, Math.round((window.innerWidth - reservedRight - width) / 2))}px`;
      bar.style.top = `${Math.max(8, window.innerHeight - height - 24)}px`;
      bar.style.visibility = '';
      return;
    }
    const spot = placeConfirmBar({
      pin: pinEl.getBoundingClientRect(),
      bar: { width: bar.offsetWidth, height: bar.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      reservedRight,
    });
    bar.style.left = `${spot.left}px`;
    bar.style.top = `${spot.top}px`;
    bar.dataset.placement = spot.placement;
    bar.style.setProperty('--jiratack-caret-left', `${spot.caretLeft}px`);
    bar.style.visibility = '';
  }

  function schedulePosition() {
    if (frame !== null || closed) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      position();
    });
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (!busy && onCancel) onCancel();
  }

  function destroy() {
    if (closed) return;
    closed = true;
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
    window.removeEventListener('scroll', schedulePosition, true);
    window.removeEventListener('resize', schedulePosition);
    document.removeEventListener('keydown', onKeyDown, true);
    bar.remove();
  }

  function setBusy(value) {
    busy = Boolean(value);
    bar.dataset.busy = busy ? 'true' : 'false';
    accept.disabled = busy;
    cancel.disabled = busy;
    message.textContent = busy ? `Moving ${key}…` : `Move ${key} here?`;
  }

  accept.addEventListener('click', () => {
    if (!busy && onConfirm) onConfirm();
  });
  cancel.addEventListener('click', () => {
    if (!busy && onCancel) onCancel();
  });

  host.appendChild(bar);
  // Measure before showing: offsetWidth/Height are layout reads, so the bar is
  // never painted at 0,0 even for one frame.
  position();

  window.addEventListener('scroll', schedulePosition, true);
  window.addEventListener('resize', schedulePosition);
  document.addEventListener('keydown', onKeyDown, true);

  try {
    accept.focus({ preventScroll: true });
  } catch (e) {
    accept.focus();
  }

  return { destroy, setBusy, element: bar };
}
