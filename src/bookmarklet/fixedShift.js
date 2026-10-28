const SHIFT_PX = 360;
const RESCAN_MS = 350;
const SCAN_BUDGET_MS = 12;
const SCAN_CHECK_EVERY = 128;

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
    let original = null;
    try {
      original = {
        value: el.style.getPropertyValue('translate'),
        priority: el.style.getPropertyPriority('translate'),
      };
    } catch (e) {
      original = null;
    }
    shifted.set(el, original);
    try {
      el.style.setProperty('translate', `-${SHIFT_PX}px 0`, 'important');
    } catch (e) {
      shifted.delete(el);
    }
  }

  function unshift(el) {
    if (!shifted.has(el)) return;
    const original = shifted.get(el);
    shifted.delete(el);
    try {
      if (original && original.value) {
        el.style.setProperty('translate', original.value, original.priority || '');
      } else {
        el.style.removeProperty('translate');
      }
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

  function scanSubtree(root, deadline) {
    if (disposed || !root || root.nodeType !== 1) return true;
    if (root.id === 'jiratack-overlay') return true;
    try {
      if (!root.isConnected) return true;
    } catch (e) {
      // ignore
    }
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
      return true;
    }
    let count = 0;
    let node = walker.nextNode();
    while (node) {
      evaluate(node);
      count += 1;
      if (deadline !== null && count % SCAN_CHECK_EVERY === 0) {
        try {
          if (performance.now() > deadline) return false;
        } catch (e) {
          // ignore timing errors, keep scanning
        }
      }
      node = walker.nextNode();
    }
    return true;
  }

  function pruneDisconnected() {
    Array.from(shifted.keys()).forEach((el) => {
      if (!el.isConnected) shifted.delete(el);
    });
  }

  let initialLogged = false;

  function flush() {
    debounce = null;
    if (disposed) return;
    try {
      if (typeof document !== 'undefined' && document.hidden) {
        pendingRoots = [];
        pendingTargets = [];
        return;
      }
    } catch (e) {
      // ignore
    }
    let deadline = null;
    try {
      deadline = performance.now() + SCAN_BUDGET_MS;
    } catch (e) {
      deadline = null;
    }
    const roots = pendingRoots;
    const targets = pendingTargets;
    pendingRoots = [];
    pendingTargets = [];
    const remaining = [];
    roots.forEach((root) => {
      if (!scanSubtree(root, deadline)) remaining.push(root);
    });
    if (remaining.length > 0) {
      pendingRoots.unshift(...remaining);
      scheduleFlush();
    }
    targets.forEach(evaluate);
    pruneDisconnected();
    if (!initialLogged && pendingRoots.length === 0 && pendingTargets.length === 0) {
      initialLogged = true;
      try {
        console.log(`[JiraTack] fixed-shift: ${shifted.size} element(s) shifted`);
      } catch (e) {
        // ignore
      }
    }
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

  function handleVisibility() {
    if (!disposed) {
      try {
        if (!document.hidden) fullScan();
      } catch (e) {
        // ignore
      }
    }
  }
  try {
    document.addEventListener('visibilitychange', handleVisibility);
  } catch (e) {
    // ignore
  }

  fullScan();

  return {
    rescan: fullScan,
    size() {
      return shifted.size;
    },
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
      try {
        document.removeEventListener('visibilitychange', handleVisibility);
      } catch (e) {
        // ignore
      }
      Array.from(shifted.keys()).forEach(unshift);
      shifted.clear();
      pendingRoots = [];
      pendingTargets = [];
    },
  };
}
