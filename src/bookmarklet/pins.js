const SELECTED_CLASS = 'jiratack-pin-selected';

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

  if (pair) {
    return { mode: 'absolute', x: pair[0], y: pair[1] };
  }

  return { mode: 'detached' };
}

export function renderPins(container, pins, options = {}) {
  const onSelect = options.onSelect;
  container.innerHTML = '';

  const cluster = document.createElement('div');
  cluster.className = 'jiratack-detached-cluster';
  cluster.id = 'jiratack-detached';
  container.appendChild(cluster);

  const entries = [];
  const elementsByKey = new Map();
  let detachedCount = 0;

  pins.forEach((pin) => {
    const placement = resolvePlacement(pin);
    const el = document.createElement('div');
    el.className = 'jiratack-pin';
    el.dataset.key = pin.key;
    el.title = pin.key + (pin.summary ? ` — ${pin.summary}` : '');
    if (pin.status && pin.status.category === 'done') {
      el.classList.add('jiratack-pin-done');
    }
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
  });

  cluster.style.display = detachedCount > 0 ? 'flex' : 'none';

  function update() {
    entries.forEach(({ el, placement }) => {
      if (placement.mode === 'selector') {
        const rect = placement.element.getBoundingClientRect();
        const x = rect.left + (placement.relX / 100) * rect.width;
        const y = rect.top + (placement.relY / 100) * rect.height;
        el.style.left = `${Math.round(x)}px`;
        el.style.top = `${Math.round(y)}px`;
      } else if (placement.mode === 'absolute') {
        el.style.left = `${Math.round(placement.x - window.scrollX)}px`;
        el.style.top = `${Math.round(placement.y - window.scrollY)}px`;
      }
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

  function select(key) {
    elementsByKey.forEach((el, elKey) => {
      el.classList.toggle(SELECTED_CLASS, elKey === key);
    });
  }

  function destroy() {
    window.removeEventListener('scroll', scheduleUpdate, true);
    window.removeEventListener('resize', scheduleUpdate);
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
  }

  return { select, update, destroy, elementsByKey };
}
