const RESIZE_MS = 300;

export function computeFitZoom(viewportWidth, sidebarWidthPx) {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return null;
  if (!Number.isFinite(sidebarWidthPx) || sidebarWidthPx <= 0) return null;
  if (viewportWidth <= sidebarWidthPx) return null;
  return (viewportWidth - sidebarWidthPx) / viewportWidth;
}

export function installFitZoom(options = {}) {
  const sidebarWidth = options.sidebarWidth || 360;
  const minZoom = typeof options.minZoom === 'number' ? options.minZoom : 0.5;
  const { onBelowFloor, onZoomChange } = options;

  const bodyEl = document.body;
  if (!bodyEl) return null;

  let zoom = computeFitZoom(window.innerWidth, sidebarWidth);
  if (zoom === null || zoom < minZoom) return null;

  let previousZoom = null;
  let previousPriority = '';
  try {
    previousZoom = bodyEl.style.getPropertyValue('zoom');
    previousPriority = bodyEl.style.getPropertyPriority('zoom');
  } catch (e) {
    previousZoom = null;
    previousPriority = '';
  }

  let disposed = false;
  let debounce = null;

  function apply(next) {
    zoom = next;
    try {
      bodyEl.style.setProperty('zoom', String(next), 'important');
    } catch (e) {
      // ignore
    }
  }

  apply(zoom);

  function handleResize() {
    if (disposed) return;
    if (debounce) window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      debounce = null;
      if (disposed) return;
      const next = computeFitZoom(window.innerWidth, sidebarWidth);
      if (next === null || next < minZoom) {
        if (onBelowFloor) onBelowFloor();
        return;
      }
      if (Math.abs(next - zoom) > 0.005) {
        apply(next);
        if (onZoomChange) onZoomChange(next);
      }
    }, RESIZE_MS);
  }
  window.addEventListener('resize', handleResize);

  return {
    get zoom() {
      return zoom;
    },
    destroy() {
      disposed = true;
      if (debounce) {
        window.clearTimeout(debounce);
        debounce = null;
      }
      window.removeEventListener('resize', handleResize);
      try {
        if (previousZoom) bodyEl.style.setProperty('zoom', previousZoom, previousPriority || '');
        else bodyEl.style.removeProperty('zoom');
      } catch (e) {
        // ignore
      }
    },
  };
}
