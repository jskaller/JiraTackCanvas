import { placePopover } from './popoverGeometry.js';

/**
 * The "Suggest edit" pill that appears after a text selection.
 *
 * It is an affordance, not a mode: selecting text only offers the action; the
 * reviewer must click it. It ignores selections inside JiraTack and form
 * controls, and it never auto-opens the composer.
 */
export function installTextSuggest(options = {}) {
  const { host, canStart, onSuggest } = options;
  if (!host) return null;

  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'jiratack-suggest-pill';
  pill.textContent = 'Suggest edit';
  pill.title = 'Suggest a replacement for the selected text';
  pill.style.display = 'none';
  host.appendChild(pill);

  let current = null;
  let timer = null;
  let frame = null;
  let dragFrame = null;
  let dragging = false;

  function hide() {
    pill.style.display = 'none';
    current = null;
  }

  function position() {
    if (!current) return;
    // The native selection may be gone by the time the reviewer reaches the
    // pill. Re-read the cloned range while it is still connected so scroll and
    // resize keep the pill next to the text; fall back to the captured rect.
    try {
      const range = current.range;
      if (range && range.startContainer && range.startContainer.isConnected) {
        const rects = Array.from(range.getClientRects())
          .filter((rect) => rect.width > 1 && rect.height > 1);
        if (rects.length > 0) {
          const last = rects[rects.length - 1];
          current.anchorRect = { left: last.left, top: last.top, right: last.right, bottom: last.bottom };
        }
      }
    } catch (e) {
      // Keep the captured rect.
    }
    const anchor = current.anchorRect;
    const size = { width: pill.offsetWidth || 110, height: pill.offsetHeight || 26 };
    const spot = placePopover({ anchor, size, viewport: { width: window.innerWidth, height: window.innerHeight }, gap: 6 });
    pill.style.left = `${spot.left}px`;
    pill.style.top = `${spot.top}px`;
  }

  function schedulePosition() {
    if (frame !== null || !current) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      position();
    });
  }

  function update() {
    if (typeof canStart === 'function' && !canStart()) {
      hide();
      return;
    }
    let selection;
    try {
      selection = window.getSelection();
    } catch (e) {
      hide();
      return;
    }
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      // A page often collapses the native selection on mouseup. The cloned
      // range is still valid, so keep the pill until the reviewer clicks away.
      if (!current) hide();
      return;
    }
    const range = selection.getRangeAt(0);
    const text = String(selection).trim();
    if (!text || text.length > 2000) {
      hide();
      return;
    }
    const container = range.startContainer;
    const target = container.nodeType === 1 ? container : container.parentElement;
    if (!target) {
      hide();
      return;
    }
    if (target.closest && target.closest('#jiratack-overlay, #jiratack-viewport-bar')) {
      hide();
      return;
    }
    if (target.isContentEditable || (target.closest && target.closest('input, textarea, select, [contenteditable="true"]'))) {
      hide();
      return;
    }

    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 1 && rect.height > 1);
    const first = rects[0] || range.getBoundingClientRect();
    const last = rects[rects.length - 1] || first;
    if (!first || (!first.width && !first.height)) {
      hide();
      return;
    }

    current = {
      text,
      range: range.cloneRange(),
      target,
      clientX: first.left + first.width / 2,
      clientY: first.top + first.height / 2,
      anchorRect: { left: last.left, top: last.top, right: last.right, bottom: last.bottom },
    };
    if (dragging) return;
    position();
    pill.style.display = 'block';
  }

  function scheduleUpdate() {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      update();
    }, 160);
  }

  function onDragMove() {
    if (!dragging || dragFrame !== null) return;
    dragFrame = window.requestAnimationFrame(() => {
      dragFrame = null;
      if (dragging) update();
    });
  }

  function onDocumentMouseDown(event) {
    if (event.target === pill || (pill.contains && pill.contains(event.target))) return;
    hide();
    dragging = true;
  }

  function onDocumentMouseUp() {
    if (!dragging) return;
    dragging = false;
    // The final selectionchange may still be debounced. Read the selection
    // before the page's own mouseup handlers can clear it.
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
    update();
    if (!current) return;
    if (typeof canStart === 'function' && !canStart()) {
      hide();
      return;
    }
    position();
    pill.style.display = 'block';
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && current) hide();
  }

  function onClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!current) return;
    const suggestion = current;
    hide();
    try {
      const selection = window.getSelection();
      if (selection) selection.removeAllRanges();
    } catch (e) {
      // A selection that will not clear is cosmetic; the captured range is a clone.
    }
    if (onSuggest) onSuggest(suggestion);
  }

  pill.addEventListener('mousedown', (event) => event.preventDefault());
  pill.addEventListener('click', onClick);
  document.addEventListener('selectionchange', scheduleUpdate);
  document.addEventListener('mousedown', onDocumentMouseDown, true);
  document.addEventListener('mousemove', onDragMove, true);
  document.addEventListener('mouseup', onDocumentMouseUp, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', schedulePosition, true);
  window.addEventListener('resize', schedulePosition);

  return {
    hide,
    destroy() {
      if (timer) window.clearTimeout(timer);
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (dragFrame !== null) window.cancelAnimationFrame(dragFrame);
      document.removeEventListener('selectionchange', scheduleUpdate);
      document.removeEventListener('mousedown', onDocumentMouseDown, true);
      document.removeEventListener('mousemove', onDragMove, true);
      document.removeEventListener('mouseup', onDocumentMouseUp, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', schedulePosition, true);
      window.removeEventListener('resize', schedulePosition);
      pill.remove();
      current = null;
    },
  };
}
