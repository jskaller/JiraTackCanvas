const RESIZE_MS = 300;

export function computeFitScale(viewportWidth, sidebarWidthPx) {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return null;
  if (!Number.isFinite(sidebarWidthPx) || sidebarWidthPx <= 0) return null;
  if (viewportWidth <= sidebarWidthPx) return null;
  return (viewportWidth - sidebarWidthPx) / viewportWidth;
}

function getInline(el, prop) {
  try {
    return {
      value: el.style.getPropertyValue(prop),
      priority: el.style.getPropertyPriority(prop),
    };
  } catch (e) {
    return { value: '', priority: '' };
  }
}

function setInline(el, prop, value, priority) {
  try {
    el.style.setProperty(prop, value, priority || '');
  } catch (e) {
    // ignore
  }
}

function restoreInline(el, prop, saved) {
  try {
    if (saved && saved.value) setInline(el, prop, saved.value, saved.priority || '');
    else el.style.removeProperty(prop);
  } catch (e) {
    // ignore
  }
}

export function installFitScale(options = {}) {
  const sidebarWidth = options.sidebarWidth || 360;
  const minScale = typeof options.minScale === 'number' ? options.minScale : 0.5;
  const { onBelowFloor, onScaleChange } = options;

  const bodyEl = document.body;
  const htmlEl = document.documentElement;
  if (!bodyEl || !htmlEl) return null;

  let scale = computeFitScale(window.innerWidth, sidebarWidth);
  if (scale === null || scale < minScale) return null;

  const previous = {
    transform: getInline(bodyEl, 'transform'),
    transformOrigin: getInline(bodyEl, 'transform-origin'),
    htmlOverflowX: getInline(htmlEl, 'overflow-x'),
  };

  let disposed = false;
  let debounce = null;

  function apply(next) {
    scale = next;
    setInline(bodyEl, 'transform', `scale(${next})`, 'important');
    setInline(bodyEl, 'transform-origin', '0 0', 'important');
    // Clip the rigid, untransformed layout width so a fixed-width page that
    // is wider than the viewport cannot produce a horizontal scrollbar.
    setInline(htmlEl, 'overflow-x', 'clip', 'important');
  }

  apply(scale);

  function handleResize() {
    if (disposed) return;
    if (debounce) window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      debounce = null;
      if (disposed) return;
      const next = computeFitScale(window.innerWidth, sidebarWidth);
      if (next === null || next < minScale) {
        if (onBelowFloor) onBelowFloor();
        return;
      }
      if (Math.abs(next - scale) > 0.005) {
        apply(next);
        if (onScaleChange) onScaleChange(next);
      }
    }, RESIZE_MS);
  }
  window.addEventListener('resize', handleResize);

  return {
    get scale() {
      return scale;
    },
    destroy() {
      disposed = true;
      if (debounce) {
        window.clearTimeout(debounce);
        debounce = null;
      }
      window.removeEventListener('resize', handleResize);
      restoreInline(bodyEl, 'transform', previous.transform);
      restoreInline(bodyEl, 'transform-origin', previous.transformOrigin);
      restoreInline(htmlEl, 'overflow-x', previous.htmlOverflowX);
    },
  };
}
