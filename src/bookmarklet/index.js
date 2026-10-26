import { exchangeSession, clearSession } from './auth.js';
import { getPins } from './api.js';
import { createOverlay, removeOverlay } from './overlay.js';
import { renderPins } from './pins.js';
import { renderSidebar } from './sidebar.js';
import { installPinMode } from './pinMode.js';
import { captureScreenshot } from './screenshot.js';
import { renderTicketForm } from './form.js';
import { playDoneAnimation } from './done.js';
import { installConsoleProxy, restoreConsoleProxy, clearConsoleBuffer } from './consoleProxy.js';
import styles from './styles.css?inline';

const LOG_PREFIX = '[JiraTack]';
let current = null;

function injectStyles() {
  if (document.getElementById('jiratack-styles')) return;
  const style = document.createElement('style');
  style.id = 'jiratack-styles';
  style.textContent = styles;
  document.head.appendChild(style);
}

function showToast(message) {
  const container = document.getElementById('jiratack-toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'jiratack-toast';
  toast.textContent = message;
  container.appendChild(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 4000);
}

function select(key) {
  if (current && current.pinsController) current.pinsController.select(key);
  if (current && current.sidebarController) current.sidebarController.select(key);
}

function handleDone({ pin, cardEl }) {
  const pinEl = current && current.pinsController && current.pinsController.elementsByKey
    ? current.pinsController.elementsByKey.get(pin.key)
    : null;
  playDoneAnimation({ pinEl, cardEl });
}

function renderPinsAndSidebar() {
  if (!current) return;
  const { overlay, config, session } = current;

  if (current.pinModeController) {
    current.pinModeController.destroy();
    current.pinModeController = null;
  }
  if (current.pinsController) {
    current.pinsController.destroy();
    current.pinsController = null;
  }

  current.pinsController = renderPins(overlay.pinsEl, current.pins, {
    onSelect: (pin) => select(pin.key),
  });

  current.sidebarController = renderSidebar(overlay.sidebarEl, {
    canvasName: current.canvasName,
    session,
    pins: current.pins,
    config,
    onSelect: (pin) => select(pin.key),
    onToast: showToast,
    onDone: handleDone,
  });

  current.pinModeController = installPinMode({
    header: overlay.headerEl,
    session,
    onCapture: handleCapture,
  });
}

async function handleCapture(capture) {
  if (!current) return;
  const { config, session, overlay } = current;
  const canvasIdAtStart = config.canvasId;

  const absX = capture.clientX + window.scrollX;
  const absY = capture.clientY + window.scrollY;
  const screenshotDataUrl = await captureScreenshot(absX, absY);

  if (!current || window.__jiratackActiveCanvas !== canvasIdAtStart) return;

  const firstPin = current.pins && current.pins.length > 0 ? current.pins[0] : null;
  const defaultProject = firstPin && firstPin.projectKey ? firstPin.projectKey : undefined;
  const defaultAssignee = firstPin && firstPin.assignee ? { ...firstPin.assignee } : undefined;

  renderTicketForm(overlay.formEl, {
    config,
    session,
    capture,
    screenshotDataUrl,
    defaultProject,
    defaultAssignee,
    onCancel: () => {
      if (current && current.overlay) current.overlay.formEl.innerHTML = '';
    },
    onCreated: ({ result, capture: createdCapture, summary }) => {
      if (!current) return;
      current.pins = current.pins.concat([
        {
          key: result.key,
          summary,
          status: { name: '', category: '', colorName: '' },
          priority: null,
          assignee: null,
          reporter: null,
          pinPosition: createdCapture.pinPosition,
          selector: createdCapture.selector || null,
          issueType: null,
          createdAt: new Date().toISOString(),
        },
      ]);
      renderPinsAndSidebar();
      showToast(`Created ${result.key}`);
    },
  });
}

function teardown(clearStoredSession) {
  if (current) {
    try {
      if (current.pinModeController) current.pinModeController.destroy();
    } catch (e) {
      // ignore
    }
    try {
      if (current.pinsController) current.pinsController.destroy();
    } catch (e) {
      // ignore
    }
    try {
      if (current.sidebarController) current.sidebarController.destroy();
    } catch (e) {
      // ignore
    }
  }

  if (clearStoredSession) {
    clearSession(current && current.config ? current.config.canvasId : undefined);
  }

  removeOverlay();

  const style = document.getElementById('jiratack-styles');
  if (style) style.remove();

  document
    .querySelectorAll('[id^="jiratack-"], [class^="jiratack-"], [class*=" jiratack-"]')
    .forEach((node) => node.remove());

  restoreConsoleProxy();
  clearConsoleBuffer();

  current = null;
  window.__jiratackActiveCanvas = null;
}

function close() {
  teardown(true);
  console.log(`${LOG_PREFIX} Close called`);
}

async function init(config) {
  installConsoleProxy();

  if (!config || !config.apiUrl || !config.token || !config.canvasId) {
    console.error(`${LOG_PREFIX} Init called with invalid config`);
    return;
  }

  const canvasId = config.canvasId;
  if (window.__jiratackActiveCanvas === canvasId) {
    window.__jiratackClose();
    return;
  }

  teardown(false);
  installConsoleProxy();
  window.__jiratackActiveCanvas = canvasId;
  injectStyles();

  try {
    let session = await exchangeSession(config);
    let data;
    try {
      data = await getPins(config, session, canvasId, window.location.href);
    } catch (e) {
      if (e.code === 'TOKEN_EXPIRED' || e.code === 'TOKEN_INVALID') {
        session = await exchangeSession(config, { force: true });
        data = await getPins(config, session, canvasId, window.location.href);
      } else {
        throw e;
      }
    }

    const overlay = createOverlay();

    current = {
      config,
      session,
      overlay,
      pins: (data && data.pins) || [],
      canvasName: (data && data.canvasName) || config.canvasName,
      pinsController: null,
      sidebarController: null,
      pinModeController: null,
    };

    renderPinsAndSidebar();
    console.log(`${LOG_PREFIX} Init called with canvas: ${current.canvasName}`);
  } catch (e) {
    console.error(`${LOG_PREFIX} Init failed:`, e);
    teardown(false);
  }
}

window.__jiratackInit = init;
window.__jiratackClose = close;
