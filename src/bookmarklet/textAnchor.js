/**
 * A selection that can be found again after the page re-renders.
 *
 * A live Range is convenient but dies when a framework replaces the text node.
 * We keep a node path + offsets (the precise route) and the selected text (the
 * fallback). The precise route is tried first; when it is stale, the text
 * fallback is best-effort: it prefers the anchor element, then the first
 * occurrence in the document. Refusing outright made a repeated word such as
 * "News" un-previewable even when the reviewer could see it on the page.
 */

function inOwnUi(node) {
  try {
    const element = node && (node.nodeType === 1 ? node : node.parentElement);
    return Boolean(element && element.closest
      && element.closest('#jiratack-overlay, #jiratack-viewport-bar'));
  } catch (e) {
    return false;
  }
}

function cssEscape(value) {
  if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(value);
  }
  return String(value).replace(/([^\w-])/g, '\\$1');
}

function pathOf(node) {
  const path = [];
  let current = node;
  while (current && current !== document.documentElement) {
    const parent = current.parentNode;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
    current = parent;
  }
  return current === document.documentElement ? path : null;
}

function nodeAt(path) {
  if (!Array.isArray(path)) return null;
  let node = document.documentElement;
  for (let i = 0; i < path.length; i += 1) {
    if (!node) return null;
    node = node.childNodes[path[i]];
  }
  return node || null;
}

function buildAnchor(range, text) {
  if (!range) return null;
  try {
    const startPath = pathOf(range.startContainer);
    const endPath = pathOf(range.endContainer);
    if (!startPath || !endPath) return null;

    let ancestor = range.startContainer.nodeType === 1
      ? range.startContainer
      : range.startContainer.parentElement;
    let ancestorSelector = null;
    while (ancestor && ancestor !== document.body) {
      if (ancestor.id) {
        ancestorSelector = `#${cssEscape(ancestor.id)}`;
        break;
      }
      ancestor = ancestor.parentElement;
    }

    return {
      text: String(text || ''),
      start: { path: startPath, offset: range.startOffset },
      end: { path: endPath, offset: range.endOffset },
      ancestorSelector,
    };
  } catch (e) {
    return null;
  }
}

function rangeFromPaths(anchor, needle) {
  const startNode = nodeAt(anchor.start.path);
  const endNode = nodeAt(anchor.end.path);
  if (!startNode || !endNode) return null;
  // The paths are captured while the composer is open; they must never resolve
  // into JiraTack's own sidebar/preview text (D35 follow-up).
  if (inOwnUi(startNode) || inOwnUi(endNode)) return null;
  try {
    const range = document.createRange();
    range.setStart(startNode, anchor.start.offset);
    range.setEnd(endNode, anchor.end.offset);
    return range.toString().trim() === needle ? range : null;
  } catch (e) {
    return null;
  }
}

function findMatches(root, needle) {
  const matches = [];
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    while (node) {
      if (inOwnUi(node)) {
        node = walker.nextNode();
        continue;
      }
      const value = node.nodeValue || '';
      let index = value.indexOf(needle);
      while (index !== -1) {
        matches.push({ node, index });
        if (matches.length > 1) return matches;
        index = value.indexOf(needle, index + 1);
      }
      node = walker.nextNode();
    }
  } catch (e) {
    return matches;
  }
  return matches;
}

function rangeForMatch(match, needle) {
  try {
    const range = document.createRange();
    range.setStart(match.node, match.index);
    range.setEnd(match.node, match.index + needle.length);
    return range;
  } catch (e) {
    return null;
  }
}

function findBestText(anchor, needle) {
  if (anchor.ancestorSelector) {
    try {
      const scopedRoot = document.querySelector(anchor.ancestorSelector);
      if (scopedRoot) {
        const scoped = findMatches(scopedRoot, needle);
        if (scoped.length > 0) return rangeForMatch(scoped[0], needle);
      }
    } catch (e) {
      // Fall through to the document.
    }
  }

  const global = findMatches(document.documentElement, needle);
  return global.length > 0 ? rangeForMatch(global[0], needle) : null;
}

/** A text-only resolution that ignores the stored node paths (D35 follow-up). */
export function resolveAnchorText(anchor) {
  if (!anchor) return null;
  const needle = String(anchor.text || '').trim();
  if (!needle) return null;
  return findBestText(anchor, needle);
}

/** Resolves a fresh Range for this anchor, or null when it is no longer safe. */
export function resolveAnchor(anchor) {
  if (!anchor) return null;
  const needle = String(anchor.text || '').trim();
  if (!needle) return null;
  if (anchor.start && anchor.end) {
    const fromPath = rangeFromPaths(anchor, needle);
    if (fromPath) return fromPath;
  }
  return findBestText(anchor, needle);
}

export { buildAnchor };
