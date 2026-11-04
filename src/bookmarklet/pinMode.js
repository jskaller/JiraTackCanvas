import { getBufferSnapshot } from './consoleProxy.js';
import { collectCaptureContext } from './captureContext.js';

const OUTLINE_CLASS = 'jiratack-pin-outline';

function cssEscape(value) {
  if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(value);
  }
  return String(value).replace(/([^\w-])/g, '\\$1');
}

function isUniqueSelector(selector, element) {
  try {
    const matches = document.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  } catch (e) {
    return false;
  }
}

function buildClassSelector(element) {
  const classes = Array.from(element.classList)
    .filter((name) => /^[a-zA-Z_][\w-]*$/.test(name))
    // Our own interaction classes exist only while pin mode is active, so a
    // selector built from one can never resolve afterwards.
    .filter((name) => !name.startsWith('jiratack-'))
    .slice(0, 2);
  if (classes.length === 0) return '';
  return `.${classes.map(cssEscape).join('.')}`;
}

export function generateSelector(element) {
  if (!element || element.nodeType !== 1) return null;

  const tag = element.tagName.toLowerCase();

  if (element.id) {
    const byId = `#${cssEscape(element.id)}`;
    if (isUniqueSelector(byId, element)) return byId;
  }

  const testId = element.getAttribute('data-testid');
  if (testId) {
    const byTestId = `[data-testid="${String(testId).replace(/"/g, '\\"')}"]`;
    if (isUniqueSelector(byTestId, element)) return byTestId;
  }

  const classSelector = buildClassSelector(element);
  if (classSelector) {
    const byClass = `${tag}${classSelector}`;
    if (isUniqueSelector(byClass, element)) return byClass;
  }

  const role = element.getAttribute('role');
  if (role) {
    const byRole = `${tag}[role="${String(role).replace(/"/g, '\\"')}"]`;
    if (isUniqueSelector(byRole, element)) return byRole;
  }

  const path = [];
  let node = element;
  for (let depth = 0; depth < 5 && node && node.nodeType === 1; depth += 1) {
    if (node.id) {
      path.unshift(`#${cssEscape(node.id)}`);
      const withId = path.join(' > ');
      if (isUniqueSelector(withId, element)) return withId;
      break;
    }

    let segment = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
      if (siblings.length > 1) {
        segment += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
    }
    path.unshift(segment);
    node = node.parentElement;
  }

  const byPath = path.join(' > ');
  return isUniqueSelector(byPath, element) ? byPath : null;
}

export function computePinPosition(element, clientX, clientY) {
  const rawSelector = generateSelector(element);
  const captureContext = collectCaptureContext(element);

  // A click on the page background targets <body>, and a container spanning
  // most of the viewport is just as meaningless an anchor: a percentage inside
  // it moves whenever the page reflows. Both degrade to document pixels.
  // The root check is explicit: on a short page <body> can cover well under
  // 80% of the viewport and still be the page background.
  let selector = rawSelector;
  if (element === document.body || element === document.documentElement) {
    selector = null;
  } else if (element && element.getBoundingClientRect) {
    const box = element.getBoundingClientRect();
    const viewport = Math.max(1, window.innerWidth * window.innerHeight);
    if (box.width * box.height > viewport * 0.8) selector = null;
  }

  if (selector) {
    const rect = element.getBoundingClientRect();
    const relX = rect.width > 0 ? ((clientX - rect.left) / rect.width) * 100 : 50;
    const relY = rect.height > 0 ? ((clientY - rect.top) / rect.height) * 100 : 50;
    return { selector, pinPosition: `${relX.toFixed(1)},${relY.toFixed(1)}`, captureContext };
  }

  const absX = Math.round(clientX + window.scrollX);
  const absY = Math.round(clientY + window.scrollY);
  return { selector: null, pinPosition: `${absX},${absY}`, captureContext };
}

export function installPinMode(options = {}) {
  const { header, session, onCapture } = options;
  const canCreate = session
    && (session.scope === 'create' || session.scope === 'universal' || session.scope === 'guest_create');
  if (!header || !canCreate) return null;

  const shell = document.createElement('div');
  shell.className = 'jiratack-pinmode';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'jiratack-pinmode-toggle';
  button.textContent = 'New Pin';
  button.setAttribute('aria-pressed', 'false');
  button.title = 'Click an element to pin it, or select text to suggest an edit';

  const hint = document.createElement('div');
  hint.className = 'jiratack-pinmode-hint';
  hint.textContent = 'Click an element to pin it, or select text to suggest an edit.';

  shell.appendChild(button);
  shell.appendChild(hint);
  header.appendChild(shell);

  const outline = document.createElement('div');
  outline.className = OUTLINE_CLASS;
  const tooltip = document.createElement('div');
  tooltip.className = 'jiratack-pin-tooltip';
  outline.appendChild(tooltip);

  let active = false;

  function hideOutline() {
    outline.style.display = 'none';
  }

  function onMove(event) {
    if (!active) return;
    const target = event.target;
    if (!target || target.nodeType !== 1) return;
    if (target.closest && target.closest('#jiratack-overlay, #jiratack-viewport-bar')) {
      hideOutline();
      return;
    }
    const rect = target.getBoundingClientRect();
    outline.style.display = 'block';
    outline.style.left = `${rect.left}px`;
    outline.style.top = `${rect.top}px`;
    outline.style.width = `${rect.width}px`;
    outline.style.height = `${rect.height}px`;
    const tag = target.tagName.toLowerCase();
    const id = target.id ? `#${target.id}` : '';
    const cls = target.classList && target.classList.length > 0
      ? `.${Array.from(target.classList)[0]}`
      : '';
    tooltip.textContent = `${tag}${id}${cls}`;
  }

  function onClick(event) {
    if (!active) return;
    const target = event.target;
    if (!target || target.nodeType !== 1) return;
    if (target.closest && target.closest('#jiratack-overlay, #jiratack-viewport-bar')) return;

    // A drag that ends on a text selection is the selection pill's gesture,
    // not a pin. Let it through so the reviewer can suggest an edit.
    try {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        const text = String(selection).trim();
        if (text) return;
      }
    } catch (e) {
      // Fall through to the pin path.
    }

    event.preventDefault();
    event.stopPropagation();

    const result = computePinPosition(target, event.clientX, event.clientY);
    const consoleSnapshot = getBufferSnapshot();
    const elementTag = target.tagName.toLowerCase();

    deactivate();
    if (onCapture) {
      onCapture({
        ...result,
        consoleSnapshot,
        elementTag,
        textSelection: null,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }
  }

  function onKey(event) {
    if (active && event.key === 'Escape') deactivate();
  }

  function activate() {
    if (active) return;
    active = true;
    button.classList.add('jiratack-pinmode-toggle-active');
    button.setAttribute('aria-pressed', 'true');
    hint.textContent = 'Click any element to place the pin. Esc cancels.';
    shell.classList.add('jiratack-pinmode-armed');
    document.body.classList.add('jiratack-pin-mode');
    try {
      const scope = (header.closest && header.closest('#jiratack-overlay')) || document.body;
      scope.appendChild(outline);
    } catch (e) {
      document.body.appendChild(outline);
    }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    button.classList.remove('jiratack-pinmode-toggle-active');
    button.setAttribute('aria-pressed', 'false');
    hint.textContent = 'Click an element to pin it, or select text to suggest an edit.';
    shell.classList.remove('jiratack-pinmode-armed');
    document.body.classList.remove('jiratack-pin-mode');
    hideOutline();
    outline.remove();
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function destroy() {
    deactivate();
    shell.remove();
  }

  button.addEventListener('click', () => {
    if (active) deactivate();
    else activate();
  });

  return {
    activate,
    deactivate,
    destroy,
    isActive: () => active,
  };
}
