const SHIFT_PX = 360;
const RESCAN_MS = 250;

function viewportZoneLeft() {
  return window.innerWidth - SHIFT_PX;
}

function isJiraTackNode(el) {
  try {
    return Boolean(el && el.closest && el.closest('#jiratack-overlay'));
  } catch (e) {
    return false;
  }
}

function isFixed(el) {
  try {
    return window.getComputedStyle(el).position === 'fixed';
  } catch (e) {
    return false;
  }
}

function overlapsSidebar(el) {
  try {
    const rect = el.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return false;
    return rect.right > viewportZoneLeft();
  } catch (e) {
    return false;
  }
}

export function installFixedShift() {
  const shifted = new Map();
  let disposed = false;
  let debounce = null;
  let pendingRoots = [];
  let pendingTargets = [];

  let supported = false;
  try {
    supported = typeof CSS !== 'undefined'
      && typeof CSS.supports === 'function'
      && CSS.supports('translate: -360px 0');
  } catch (e) {
    supported = false;
  }

  function shift(el) {
    if (!supported || shifted.has(el)) return;
    shifted.set(el, el.style.getPropertyValue('translate'));
    try {
      el.style.setProperty('translate', `-${SHIFT_PX}px 0`);
    } catch (e) {
      shifted.delete(el);
    }
  }

  function unshift(el) {
    if (!shifted.has(el)) return;
    const original = shifted.get(el);
    shifted.delete(el);
    try {
      if (original) el.style.setProperty('translate', original);
      else el.style.removeProperty('translate');
    } catch (e) {
      // ignore
    }
  }

  function evaluate(el) {
    if (disposed || !el || el.nodeType !== 1) return;
    if (el.tagName === 'HTML' || el.tagName === 'HEAD') return;
    if (isJiraTackNode(el)) return;
    if (isFixed(el) && overlapsSidebar(el)) shift(el);
    else unshift(el);
  }

  function scanSubtree(root) {
    if (disposed || !root || root.nodeType !== 1) return;
    if (root.id === 'jiratack-overlay') return;
    evaluate(root);
    let walker = null;
    try {
      walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
          if (node.id === 'jiratack-overlay') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
    } catch (e) {
      return;
    }
    let node = walker.nextNode();
    while (node) {
      evaluate(node);
      node = walker.nextNode();
    }
  }

  function pruneDisconnected() {
    Array.from(shifted.keys()).forEach((el) => {
      if (!el.isConnected) shifted.delete(el);
    });
  }

  function flush() {
    debounce = null;
    if (disposed) return;
    const roots = pendingRoots;
    const targets = pendingTargets;
    pendingRoots = [];
    pendingTargets = [];
    roots.forEach(scanSubtree);
    targets.forEach(evaluate);
    pruneDisconnected();
  }

  function scheduleFlush() {
    if (disposed) return;
    if (debounce) window.clearTimeout(debounce);
    debounce = window.setTimeout(flush, RESCAN_MS);
  }

  function fullScan() {
    if (disposed || !document.body) return;
    pendingRoots.push(document.body);
    scheduleFlush();
  }

  let observer = null;
  try {
    observer = new MutationObserver((records) => {
      if (disposed) return;
      records.forEach((record) => {
        if (record.type === 'childList') {
          record.addedNodes.forEach((node) => {
            if (node && node.nodeType === 1) pendingRoots.push(node);
          });
        } else if (record.type === 'attributes' && record.target) {
          pendingTargets.push(record.target);
        }
      });
      scheduleFlush();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
  } catch (e) {
    observer = null;
  }

  function handleResize() {
    fullScan();
  }
  window.addEventListener('resize', handleResize);

  fullScan();

  return {
    rescan: fullScan,
    destroy() {
      disposed = true;
      if (debounce) {
        window.clearTimeout(debounce);
        debounce = null;
      }
      if (observer) {
        try {
          observer.disconnect();
        } catch (e) {
          // ignore
        }
        observer = null;
      }
      window.removeEventListener('resize', handleResize);
      Array.from(shifted.keys()).forEach(unshift);
      shifted.clear();
      pendingRoots = [];
      pendingTargets = [];
    },
  };
}
