export const PIN_MARKER_PREFIX = '📌 JiraTack pin:';

export function findMarkerText(node) {
  if (!node || typeof node !== 'object') return null;

  if (node.type === 'paragraph' && Array.isArray(node.content)) {
    const firstText = node.content.find((child) => child && child.type === 'text');
    const text = firstText && typeof firstText.text === 'string' ? firstText.text : '';
    if (text.startsWith(PIN_MARKER_PREFIX)) {
      return text.slice(PIN_MARKER_PREFIX.length).trim();
    }
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const found = findMarkerText(child);
      if (found) return found;
    }
  }

  return null;
}

export function parsePinMarker(descriptionAdf) {
  const raw = findMarkerText(descriptionAdf);
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;
  }

  if (!parsed || typeof parsed.canvas !== 'string' || !parsed.canvas) return null;
  if (typeof parsed.url !== 'string' || !parsed.url) return null;
  if (typeof parsed.position !== 'string' || !parsed.position) return null;

  return {
    canvas: parsed.canvas,
    url: parsed.url,
    position: parsed.position,
    selector: typeof parsed.selector === 'string' && parsed.selector ? parsed.selector : null,
  };
}

export function buildMarkerText({ canvas, url, position, selector }) {
  const marker = { canvas, url, position };
  if (typeof selector === 'string' && selector.length > 0) {
    marker.selector = selector;
  }
  return `${PIN_MARKER_PREFIX} ${JSON.stringify(marker)}`;
}

export function appendPinMarker(descriptionAdf, markerPayload) {
  const base = descriptionAdf && Array.isArray(descriptionAdf.content)
    ? { ...descriptionAdf, content: [...descriptionAdf.content] }
    : { type: 'doc', version: 1, content: [] };

  base.content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: buildMarkerText(markerPayload) }],
  });

  return base;
}
