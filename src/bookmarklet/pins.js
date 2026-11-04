import { filterPinsByUrl } from '../shared/urlNormalize.js';
import { attachPinDrag } from './pinDrag.js';

const SELECTED_CLASS = 'jiratack-pin-selected';
const HOVERED_CLASS = 'jiratack-pin-hovered';
const PING_CLASS = 'jiratack-pin-ping';
const ARRIVE_CLASS = 'jiratack-pin-arrive';
const COLLISION_RADIUS = 14;
const SELECTED_Z_INDEX = 9999;

function parsePair(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split(',');
  if (parts.length !== 2) return null;
  const x = Number(parts[0].trim());
  const y = Number(parts[1].trim());
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

function resolvePlacement(pin) {
  const pair = parsePair(pin.pinPosition);

  if (pin.selector) {
    let element = null;
    try {
      element = document.querySelector(pin.selector);
    } catch (e) {
      element = null;
    }
    if (element && pair) {
      return { mode: 'selector', element, relX: pair[0], relY: pair[1] };
    }
  }

  // Only a pin captured without a selector stores document pixels. If a
  // selector was recorded but no longer resolves, the numbers are element
  // percentages and must not be read as pixels — that put pins near the origin.
  if (pair && !pin.selector) {
    return { mode: 'absolute', x: pair[0], y: pair[1] };
  }

  return { mode: 'detached' };
}

/**
 * The pin's anchor in DOCUMENT coordinates, for scrolling the page.
 *
 * The pin marker itself is `position: absolute` inside the fixed overlay, so
 * `pinEl.scrollIntoView()` is a no-op — only the anchor can tell the page where
 * the pin belongs. Returns null for a detached pin (lost selector and no stored
 * pixels), which has no page location to scroll to.
 */
export function pinPagePoint(pin) {
  if (!pin) return null;
  const placement = resolvePlacement(pin);
  if (placement.mode === 'selector') {
    const rect = placement.element.getBoundingClientRect();
    return {
      x: rect.left + (placement.relX / 100) * rect.width + window.scrollX,
      y: rect.top + (placement.relY / 100) * rect.height + window.scrollY,
    };
  }
  if (placement.mode === 'absolute') {
    return { x: placement.x, y: placement.y };
  }
  return null;
}

export function renderPins(container, pins, options = {}) {
  const onSelect = options.onSelect;
  const onHover = options.onHover;
  const currentUrl = options.pageUrl || window.location.href;
  const visiblePins = filterPinsByUrl(pins, currentUrl, options.matchMode || 'smart');

  container.innerHTML = '';

  const cluster = document.createElement('div');
  cluster.className = 'jiratack-detached-cluster';
  cluster.id = 'jiratack-detached';
  container.appendChild(cluster);

  const entries = [];
  const elementsByKey = new Map();
  const entriesByKey = new Map();
  const placementsByKey = new Map();
  const drags = [];
  let detachedCount = 0;
  let selectedKey = null;

  visiblePins.forEach((pin) => {
    const placement = resolvePlacement(pin);
    // A pin that cannot be anchored to its element is positioned by document
    // pixels, which do not follow reflow. Say so rather than drawing it as if
    // the position were trustworthy.
    if (placement.mode !== 'selector') {
      console.warn(
        `[JiraTack] pin ${pin.key} is ${placement.mode}: selector=${JSON.stringify(pin.selector)} position=${JSON.stringify(pin.pinPosition)}`,
      );
    }
    const el = document.createElement('div');
    el.className = 'jiratack-pin';
    el.dataset.key = pin.key;
    // Hover only highlights the pin and its card (D33 follow-up): no label
    // popup, and no native title tooltip either.
    if (pin.status && pin.status.category === 'done') {
      el.classList.add('jiratack-pin-done');
    }

    el.addEventListener('mouseenter', () => {
      if (onHover) onHover(pin);
    });
    el.addEventListener('mouseleave', () => {
      if (onHover) onHover(null);
    });
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      select(pin.key);
      if (onSelect) onSelect(pin);
    });

    if (placement.mode === 'detached') {
      detachedCount += 1;
      cluster.appendChild(el);
    } else {
      container.appendChild(el);
    }

    entries.push({ el, pin, placement });
    elementsByKey.set(pin.key, el);
    entriesByKey.set(pin.key, { el });
    placementsByKey.set(pin.key, entries[entries.length - 1]);

    if (typeof options.onMove === 'function') {
      drags.push(attachPinDrag(el, pin, {
        onDrop: options.onMove,
        canStart: options.canStartDrag,
        onArm: () => {
          if (onHover) onHover(pin);
        },
        onCancel: () => {
          if (onHover) onHover(null);
        },
      }));
    }
  });

  cluster.style.display = detachedCount > 0 ? 'flex' : 'none';

  function update() {
    const positioned = [];

    entries.forEach(({ el, pin, placement }) => {
      if (placement.mode === 'selector') {
        const rect = placement.element.getBoundingClientRect();
        const x = rect.left + (placement.relX / 100) * rect.width;
        const y = rect.top + (placement.relY / 100) * rect.height;
        positioned.push({ el, pin, x, y });
      } else if (placement.mode === 'absolute') {
        positioned.push({
          el,
          pin,
          x: placement.x - window.scrollX,
          y: placement.y - window.scrollY,
        });
      }
    });

    const buckets = new Map();
    positioned.forEach((item) => {
      const key = `${Math.round(item.x)},${Math.round(item.y)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    });

    buckets.forEach((bucket) => {
      if (bucket.length === 1) {
        const item = bucket[0];
        item.el.style.left = `${Math.round(item.x)}px`;
        item.el.style.top = `${Math.round(item.y)}px`;
        item.el.style.zIndex = item.pin.key === selectedKey ? String(SELECTED_Z_INDEX) : '';
        return;
      }

      bucket.forEach((item, index) => {
        if (index === 0) {
          item.el.style.left = `${Math.round(item.x)}px`;
          item.el.style.top = `${Math.round(item.y)}px`;
          item.el.style.zIndex = item.pin.key === selectedKey ? String(SELECTED_Z_INDEX) : '1';
          return;
        }

        const angle = (Math.PI * 2 * (index - 1)) / Math.max(1, bucket.length - 1) - Math.PI / 2;
        const ring = COLLISION_RADIUS + Math.floor((index - 1) / 6) * COLLISION_RADIUS;
        item.el.style.left = `${Math.round(item.x + Math.cos(angle) * ring)}px`;
        item.el.style.top = `${Math.round(item.y + Math.sin(angle) * ring)}px`;
        item.el.style.zIndex = item.pin.key === selectedKey
          ? String(SELECTED_Z_INDEX)
          : String(index + 1);
      });
    });
  }

  let frame = null;
  function scheduleUpdate() {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      update();
    });
  }

  window.addEventListener('scroll', scheduleUpdate, true);
  window.addEventListener('resize', scheduleUpdate);
  update();

  function triggerPing(el) {
    el.classList.remove(PING_CLASS);
    // Force a reflow so re-selecting replays the one-shot animation.
    void el.offsetWidth;
    el.classList.add(PING_CLASS);
    window.setTimeout(() => {
      el.classList.remove(PING_CLASS);
    }, 700);
  }

  function select(key) {
    const changed = key !== selectedKey;
    selectedKey = key;
    elementsByKey.forEach((el, elKey) => {
      const isSelected = elKey === key;
      el.classList.toggle(SELECTED_CLASS, isSelected);
      if (!isSelected) el.classList.remove(PING_CLASS);
    });
    if (changed && key && elementsByKey.has(key)) {
      triggerPing(elementsByKey.get(key));
    }
    scheduleUpdate();
  }

  function setHover(key) {
    entriesByKey.forEach((entry, elKey) => {
      entry.el.classList.toggle(HOVERED_CLASS, elKey === key);
    });
  }

  function flash(key) {
    const entry = entriesByKey.get(key);
    if (!entry) return false;
    entry.el.classList.remove(ARRIVE_CLASS);
    void entry.el.offsetWidth;
    entry.el.classList.add(ARRIVE_CLASS);
    window.setTimeout(() => {
      entry.el.classList.remove(ARRIVE_CLASS);
    }, 1200);
    return true;
  }

  function updatePin(pin) {
    if (!pin) return false;
    const entry = entriesByKey.get(pin.key);
    if (!entry) return false;
    entry.el.classList.toggle('jiratack-pin-done', Boolean(pin.status && pin.status.category === 'done'));
    return true;
  }

  /**
   * Re-anchors one pin without re-rendering the layer. A move must not tear
   * down an open inline edit in the sidebar, so this updates the placement in
   * place — including the detached fallback when the drop resolved no element.
   */
  function setPlacement(key, capture) {
    const entry = placementsByKey.get(key);
    if (!entry) return false;
    entry.placement = resolvePlacement({
      selector: capture && capture.selector ? capture.selector : null,
      pinPosition: capture ? capture.pinPosition : null,
    });
    update();
    return true;
  }

  function destroy() {
    drags.forEach((drag) => drag.destroy());
    window.removeEventListener('scroll', scheduleUpdate, true);
    window.removeEventListener('resize', scheduleUpdate);
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
  }

  return { select, update, updatePin, setPlacement, setHover, flash, destroy, elementsByKey };
}

export function createPendingPin(container, capture) {
  const el = document.createElement('div');
  el.className = 'jiratack-pin jiratack-pin-pending';
  el.title = 'Creating ticket…';
  container.appendChild(el);

  const placement = resolvePlacement({
    selector: capture && capture.selector ? capture.selector : null,
    pinPosition: capture && capture.pinPosition ? capture.pinPosition : null,
  });

  function update() {
    if (placement.mode === 'selector') {
      const rect = placement.element.getBoundingClientRect();
      const x = rect.left + (placement.relX / 100) * rect.width;
      const y = rect.top + (placement.relY / 100) * rect.height;
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y)}px`;
    } else if (placement.mode === 'absolute') {
      el.style.left = `${Math.round(placement.x - window.scrollX)}px`;
      el.style.top = `${Math.round(placement.y - window.scrollY)}px`;
    } else if (capture) {
      el.style.left = `${Math.round(capture.clientX)}px`;
      el.style.top = `${Math.round(capture.clientY)}px`;
    }
  }

  let frame = null;
  function scheduleUpdate() {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      update();
    });
  }

  window.addEventListener('scroll', scheduleUpdate, true);
  window.addEventListener('resize', scheduleUpdate);
  update();

  return {
    el,
    setKey(key) {
      if (!key) return;
      el.dataset.key = key;
      el.title = key;
      el.classList.remove('jiratack-pin-pending');
    },
    destroy() {
      window.removeEventListener('scroll', scheduleUpdate, true);
      window.removeEventListener('resize', scheduleUpdate);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      el.remove();
    },
  };
}
