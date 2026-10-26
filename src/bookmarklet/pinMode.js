import { getBufferSnapshot } from './consoleProxy.js';

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
  const selector = generateSelector(element);

  if (selector) {
    const rect = element.getBoundingClientRect();
    const relX = rect.width > 0 ? ((clientX - rect.left) / rect.width) * 100 : 50;
    const relY = rect.height > 0 ? ((clientY - rect.top) / rect.height) * 100 : 50;
    return { selector, pinPosition: `${relX.toFixed(1)},${relY.toFixed(1)}` };
  }

  const absX = Math.round(clientX + window.scrollX);
  const absY = Math.round(clientY + window.scrollY);
  return { selector: null, pinPosition: `${absX},${absY}` };
}

export function installPinMode(options = {}) {
  const { header, session, onCapture } = options;
  if (!header || !session || (session.scope !== 'create' && session.scope !== 'universal')) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'jiratack-pinmode-toggle';
  button.textContent = 'Pin mode';
  header.appendChild(button);

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
    if (target.closest && target.closest('#jiratack-overlay')) {
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
    if (target.closest && target.closest('#jiratack-overlay')) return;

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
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }
  }

  function onKey(event) {
    if (active && event.key === 'Escape') {
      deactivate();
    }
  }

  function activate() {
    if (active) return;
    active = true;
    button.classList.add('jiratack-pinmode-toggle-active');
    document.body.classList.add('jiratack-pin-mode');
    document.body.appendChild(outline);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    button.classList.remove('jiratack-pinmode-toggle-active');
    document.body.classList.remove('jiratack-pin-mode');
    hideOutline();
    outline.remove();
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function destroy() {
    deactivate();
    button.remove();
  }

  button.addEventListener('click', () => {
    if (active) {
      deactivate();
    } else {
      activate();
    }
  });

  return {
    activate,
    deactivate,
    destroy,
    isActive: () => active,
  };
}
