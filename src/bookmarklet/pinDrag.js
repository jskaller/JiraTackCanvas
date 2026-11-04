import { computePinPosition } from './pinMode.js';

/**
 * Long-press to move a pin (SPEC §10.3, D33).
 *
 * A plain click must keep selecting the pin, so the drag only arms after the
 * pointer has stayed down for a moment. Once armed, a ghost follows the cursor
 * and the drop resolves the element under it through the same capture code pin
 * mode uses — a moved pin is captured exactly like a new one, so it can never
 * gain an anchor pin mode would refuse (body/html, an oversized box, or one of
 * our own classes).
 */
export const DRAG_ARM_DELAY_MS = 400;
const PRE_ARM_SLOP_PX = 6;
const GHOST_CLASS = 'jiratack-pin-ghost';
const DRAGGING_CLASS = 'jiratack-pin-dragging';
const BODY_ARMED_CLASS = 'jiratack-pin-drag-armed';

function ownUi(target) {
  return Boolean(target && target.closest && target.closest('#jiratack-overlay, #jiratack-viewport-bar'));
}

/**
 * The page element under the drop, or null for the document background.
 *
 * `null` is a valid outcome (the pin becomes a pixel pin). Releasing over our
 * own UI is not: the page underneath is invisible, so the move is abandoned
 * rather than anchored to something the reviewer cannot see. That also makes a
 * long-press with no pointer movement a no-op instead of re-anchoring the pin
 * to itself.
 */
function resolveDrop(clientX, clientY) {
  const target = document.elementFromPoint(clientX, clientY);
  if (!target || target.nodeType !== 1) return { blocked: true, element: null };
  if (ownUi(target)) return { blocked: true, element: null };
  if (target === document.body || target === document.documentElement) {
    return { blocked: false, element: null };
  }
  return { blocked: false, element: target };
}

function suppressNextClick() {
  const guard = (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.removeEventListener('click', guard, true);
  };
  // Capture on window runs before the pin's own handler and before pin mode's
  // document-level capture listener, so a drop can never also create a pin.
  window.addEventListener('click', guard, true);
  window.setTimeout(() => window.removeEventListener('click', guard, true), 0);
}

export function attachPinDrag(pinEl, pin, options = {}) {
  const { onDrop, onArm, onCancel, canStart } = options;

  let armTimer = null;
  let armed = false;
  let cancelled = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  let ghost = null;
  let destroyed = false;

  function removeGhost() {
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
  }

  /**
   * Where the ghost lives.
   *
   * It must be inside JiraTack's own overlay: the push-mode fixed-shift pass
   * moves *page* `position: fixed` elements that overlap the sidebar, and a
   * ghost parented to `document.body` looked exactly like one — it was shoved
   * 320px away from the cursor, so the reviewer lost the drag indicator
   * exactly when the pin was dragged towards the sidebar.
   */
  function ghostHost() {
    try {
      const overlay = pinEl.closest && pinEl.closest('#jiratack-overlay');
      if (overlay) return overlay;
    } catch (e) {
      // fall through
    }
    return document.body;
  }

  function restoreVisuals() {
    pinEl.classList.remove(DRAGGING_CLASS);
    document.body.classList.remove(BODY_ARMED_CLASS);
    removeGhost();
  }

  function detachWindowListeners() {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('keydown', onKey, true);
  }

  function clearArmTimer() {
    if (armTimer !== null) {
      window.clearTimeout(armTimer);
      armTimer = null;
    }
  }

  function cancel() {
    if (destroyed) return;
    cancelled = true;
    clearArmTimer();
    detachWindowListeners();
    restoreVisuals();
    if (armed && onCancel) onCancel(pin);
    armed = false;
  }

  function arm() {
    armTimer = null;
    if (destroyed || cancelled) return;
    armed = true;

    const rect = pinEl.getBoundingClientRect();
    originX = rect.left + rect.width / 2;
    originY = rect.top + rect.height / 2;

    ghost = document.createElement('div');
    ghost.className = `${GHOST_CLASS}`;
    ghost.style.left = `${originX}px`;
    ghost.style.top = `${originY}px`;
    ghostHost().appendChild(ghost);

    pinEl.classList.add(DRAGGING_CLASS);
    document.body.classList.add(BODY_ARMED_CLASS);
    if (onArm) onArm(pin);
  }

  function onMove(event) {
    if (cancelled) return;
    if (!armed) {
      // Moving while pressed is a grab, not a click: arm immediately instead
      // of waiting out the hold. Cancelling here made every press that slid a
      // few pixels — which is how hands actually press on a small target — a
      // silent dead gesture with no feedback at all. A click keeps being a
      // click because a click never moves the pointer past the slop.
      if (Math.abs(event.clientX - startX) > PRE_ARM_SLOP_PX
        || Math.abs(event.clientY - startY) > PRE_ARM_SLOP_PX) {
        clearArmTimer();
        arm();
        if (ghost) {
          ghost.style.left = `${event.clientX}px`;
          ghost.style.top = `${event.clientY}px`;
        }
      }
      return;
    }
    if (ghost) {
      ghost.style.left = `${event.clientX}px`;
      ghost.style.top = `${event.clientY}px`;
    }
  }

  function onUp(event) {
    if (!armed) {
      cancel();
      return;
    }

    const clientX = event.clientX;
    const clientY = event.clientY;
    clearArmTimer();
    detachWindowListeners();
    restoreVisuals();
    armed = false;

    if (destroyed) return;

    const drop = resolveDrop(clientX, clientY);
    if (drop.blocked) {
      // Released over the overlay/sidebar/viewport bar (or outside the page):
      // abandon the move rather than reinterpret it. The click that follows
      // still selects the pin, which is the harmless half of a long press.
      if (onCancel) onCancel(pin);
      return;
    }

    suppressNextClick();
    const capture = computePinPosition(drop.element, clientX, clientY);
    const movedPixels = Math.hypot(clientX - originX, clientY - originY);

    if (onDrop) {
      onDrop({
        pin,
        ...capture,
        elementTag: drop.element ? drop.element.tagName.toLowerCase() : null,
        clientX,
        clientY,
        movedPixels,
      });
    }
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      suppressNextClick();
    }
  }

  function onMouseDown(event) {
    if (destroyed || event.button !== 0) return;
    if (event.defaultPrevented) return;
    // One move at a time: while a confirmation is open, no other pin (and not
    // this one) may start another drag.
    if (typeof canStart === 'function' && !canStart()) return;
    cancelled = false;
    armed = false;
    startX = event.clientX;
    startY = event.clientY;
    // Stop the page from starting a native drag or a text selection while the
    // user holds. A click is still dispatched, so selection keeps working.
    event.preventDefault();
    clearArmTimer();
    detachWindowListeners();
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('keydown', onKey, true);
    armTimer = window.setTimeout(arm, DRAG_ARM_DELAY_MS);
  }

  pinEl.addEventListener('mousedown', onMouseDown);

  return {
    destroy() {
      destroyed = true;
      clearArmTimer();
      detachWindowListeners();
      restoreVisuals();
      pinEl.removeEventListener('mousedown', onMouseDown);
    },
    isArmed: () => armed,
  };
}
