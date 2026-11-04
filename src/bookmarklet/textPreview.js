/**
 * "View on page" for a suggested text change.
 *
 * Inline where it is safe: the selection lives inside one text node, so the
 * original can be split out, struck through and the replacement inserted next
 * to it. The original Text node is kept detached and re-inserted on hide, so
 * the page is restored exactly.
 *
 * Anything else (a range spanning elements, an input's selection, or a page
 * that re-rendered under us) falls back to a non-destructive overlay: red
 * rectangles over the range plus a bubble showing old → new.
 *
 * The Range is re-resolved from the captured anchor on every show, because a
 * framework can replace the text node between previews. Preview only. Nothing
 * here persists, and the ticket description is written independently.
 */
import { resolveAnchor, resolveAnchorText } from './textAnchor.js';

const ARROW = '→';
const EDGE = 8;
const BUBBLE_GAP = 8;

function trimmed(value) {
  return String(value || '').trim();
}

function canInline(range) {
  try {
    return Boolean(range)
      && range.startContainer === range.endContainer
      && range.startContainer.nodeType === 3
      && range.startContainer.isConnected
      && range.startOffset < range.endOffset;
  } catch (e) {
    return false;
  }
}

function rangeIsUsable(range) {
  try {
    return Boolean(range)
      && Boolean(range.startContainer)
      && range.startContainer.isConnected
      && Boolean(range.toString());
  } catch (e) {
    return false;
  }
}

function scrollRangeIntoView(range) {
  try {
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.top >= 0 && rect.bottom <= window.innerHeight)) return;
    const node = range.startContainer;
    const element = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (element) element.scrollIntoView({ block: 'center' });
  } catch (e) {
    // The range can be detached; the preview falls back or does nothing.
  }
}

export function createTextPreview() {
  let active = null;
  let frame = null;

  function host() {
    // A dedicated layer before the sidebar: it paints below the sidebar and is
    // not cleared when the pin layer re-renders.
    return document.getElementById('jiratack-text-preview-host')
      || document.getElementById('jiratack-overlay')
      || document.body;
  }

  function cancelFrame() {
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
  }

  function showInline(range, replacement) {
    const node = range.startContainer;
    const parent = node.parentNode;
    if (!parent) return null;

    const full = node.nodeValue || '';
    const start = range.startOffset;
    const end = range.endOffset;
    const originalText = full.slice(start, end);
    if (!originalText) return null;

    const before = document.createTextNode(full.slice(0, start));
    const after = document.createTextNode(full.slice(end));

    const holder = document.createElement('span');
    holder.className = 'jiratack-text-preview';
    const original = document.createElement('span');
    original.className = 'jiratack-text-preview-original';
    original.textContent = originalText;
    const inserted = document.createElement('span');
    inserted.className = 'jiratack-text-preview-replacement';
    inserted.textContent = replacement;
    holder.appendChild(original);
    holder.appendChild(inserted);

    parent.insertBefore(before, node);
    parent.insertBefore(holder, node);
    parent.insertBefore(after, node);
    parent.removeChild(node);

    function restore() {
      if (!before.isConnected || !holder.isConnected || !after.isConnected) return;
      parent.insertBefore(node, before);
      before.remove();
      holder.remove();
      after.remove();
      // Do not normalize(): merging text nodes would detach the Range's text
      // node and make a second preview impossible.
    }

    return { mode: 'inline', restore, holder };
  }

  function drawBubble(entry) {
    const layer = entry.layer;
    const range = entry.range;
    if (!rangeIsUsable(range)) {
      hide();
      return;
    }

    layer.querySelectorAll('.jiratack-text-preview-box').forEach((box) => box.remove());
    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 1 && rect.height > 1);
    if (rects.length === 0) {
      hide();
      return;
    }

    rects.forEach((rect) => {
      const box = document.createElement('div');
      box.className = 'jiratack-text-preview-box';
      box.style.left = `${Math.round(rect.left)}px`;
      box.style.top = `${Math.round(rect.top)}px`;
      box.style.width = `${Math.round(rect.width)}px`;
      box.style.height = `${Math.round(rect.height)}px`;
      layer.appendChild(box);
    });

    const first = rects[0];
    const bubble = entry.bubble;
    const width = bubble.offsetWidth || 240;
    const height = bubble.offsetHeight || 34;
    const left = Math.min(
      Math.max(first.left, EDGE),
      Math.max(EDGE, window.innerWidth - EDGE - width),
    );
    const below = first.bottom + BUBBLE_GAP;
    const top = below + height <= window.innerHeight - EDGE
      ? below
      : Math.max(EDGE, first.top - BUBBLE_GAP - height);
    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(top)}px`;
  }

  function scheduleDraw(entry) {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      if (active === entry) drawBubble(entry);
    });
  }

  function showBubble(range, replacement) {
    const layer = document.createElement('div');
    layer.className = 'jiratack-text-preview-layer';

    const bubble = document.createElement('div');
    bubble.className = 'jiratack-text-preview-bubble';
    const original = document.createElement('span');
    original.className = 'jiratack-text-preview-original';
    original.textContent = trimmed(range.toString()).slice(0, 240);
    const arrow = document.createElement('span');
    arrow.className = 'jiratack-text-preview-arrow';
    arrow.textContent = ARROW;
    const inserted = document.createElement('span');
    inserted.className = 'jiratack-text-preview-replacement';
    inserted.textContent = replacement;
    bubble.appendChild(original);
    bubble.appendChild(arrow);
    bubble.appendChild(inserted);
    layer.appendChild(bubble);

    host().appendChild(layer);

    const entry = { mode: 'bubble', layer, bubble, range };
    const redraw = () => scheduleDraw(entry);
    window.addEventListener('scroll', redraw, true);
    window.addEventListener('resize', redraw);
    entry.removeListeners = () => {
      window.removeEventListener('scroll', redraw, true);
      window.removeEventListener('resize', redraw);
    };

    drawBubble(entry);
    return entry;
  }

  function show({ text, range, anchor, replacement }) {
    hide();
    const value = typeof replacement === 'string' ? replacement.trim() : '';
    if (!value) return null;

    // Re-resolve every time: the stored Range may have been detached by a page
    // re-render between previews. The anchor is the durable representation.
    let resolved = null;
    if (anchor) resolved = resolveAnchor(anchor);
    if (!resolved && rangeIsUsable(range)) resolved = range;

    // A stored node path can survive a re-render as a range that spans nodes
    // (or starts on an element). That preview can only be drawn as a box, but
    // the reviewer expects the replacement inline. Prefer a single text-node
    // match for the same phrase before giving up on inline mode.
    if (resolved && anchor && !canInline(resolved)) {
      const inlineMatch = resolveAnchorText(anchor);
      if (inlineMatch && canInline(inlineMatch)
        && inlineMatch.toString().trim() === trimmed(text)) {
        resolved = inlineMatch;
      }
    }

    if (!rangeIsUsable(resolved)) return null;
    if (resolved.toString().trim() !== trimmed(text)) return null;

    scrollRangeIntoView(resolved);

    if (canInline(resolved)) {
      const inline = showInline(resolved, value);
      if (inline) {
        active = inline;
        return 'inline';
      }
    }

    const bubble = showBubble(resolved, value);
    if (!bubble) return null;
    active = bubble;
    return 'bubble';
  }

  function hide() {
    cancelFrame();
    if (!active) return;
    if (active.mode === 'inline') {
      try {
        active.restore();
      } catch (e) {
        // The page may have replaced the nodes; there is nothing to restore.
      }
    } else if (active.mode === 'bubble') {
      if (active.removeListeners) active.removeListeners();
      active.layer.remove();
    }
    active = null;
  }

  return {
    show,
    hide,
    isVisible: () => Boolean(active),
    isAttached: () => {
      if (!active) return false;
      if (active.mode === 'inline') return active.holder.isConnected;
      return active.layer.isConnected;
    },
    mode: () => (active ? active.mode : null),
  };
}
