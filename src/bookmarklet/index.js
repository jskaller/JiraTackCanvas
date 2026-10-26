import { exchangeSession, clearSession } from './auth.js';
import { getPins, listCanvasesForUser, createCanvas } from './api.js';
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
  const universal = Boolean(current.universal);
  const hasCanvas = Boolean(current.canvasName);

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

  const canvasSelector = universal
    ? {
        canvases: current.canvases,
        selected: current.canvasName,
        onChange: handleCanvasSelect,
        onCreate: handleCreateCanvas,
      }
    : null;

  current.sidebarController = renderSidebar(overlay.sidebarEl, {
    canvasName: universal && !hasCanvas ? 'JiraTack Launcher' : current.canvasName,
    session,
    pins: current.pins,
    config,
    onSelect: (pin) => select(pin.key),
    onToast: showToast,
    onDone: handleDone,
    canvasSelector,
    emptyMessage: universal && !hasCanvas ? 'Select a canvas to start.' : undefined,
  });

  if (!universal || hasCanvas) {
    current.pinModeController = installPinMode({
      header: overlay.headerEl,
      session,
      onCapture: handleCapture,
    });
  }
}

async function handleCanvasSelect(canvasName) {
  if (!current || !current.universal) return;

  if (!canvasName) {
    current.canvasName = null;
    current.pins = [];
    window.__jiratackActiveCanvas = current.config.canvasId || 'universal';
    renderPinsAndSidebar();
    return;
  }

  window.__jiratackActiveCanvas = canvasName;

  try {
    const data = await getPins(current.config, current.session, canvasName, window.location.href);
    if (!current) return;
    current.canvasName = (data && data.canvasName) || canvasName;
    current.pins = (data && data.pins) || [];
    renderPinsAndSidebar();
  } catch (e) {
    showToast((e && e.message) || 'Failed to load canvas.');
  }
}

async function handleCreateCanvas() {
  if (!current || !current.universal) return;

  const entered = window.prompt('New canvas name');
  if (!entered || !entered.trim()) return;
  const canvasName = entered.trim();

  try {
    await createCanvas(current.config, current.session, canvasName, window.location.href);
    if (!current) return;
    const list = await listCanvasesForUser(current.config, current.session);
    if (!current) return;
    current.canvases = (list && list.canvases) || [];
    await handleCanvasSelect(canvasName);
    showToast(`Canvas "${canvasName}" created`);
  } catch (e) {
    showToast((e && e.message) || 'Failed to create canvas.');
  }
}

async function handleCapture(capture) {
  if (!current || !current.canvasName) return;
  const { config, session, overlay } = current;
  const activeAtStart = current.canvasName;

  const absX = capture.clientX + window.scrollX;
  const absY = capture.clientY + window.scrollY;
  const screenshotDataUrl = await captureScreenshot(absX, absY);

  if (!current || window.__jiratackActiveCanvas !== activeAtStart) return;

  const firstPin = current.pins && current.pins.length > 0 ? current.pins[0] : null;
  const defaultProject = firstPin && firstPin.projectKey ? firstPin.projectKey : undefined;
  const defaultAssignee = firstPin && firstPin.assignee ? { ...firstPin.assignee } : undefined;

  renderTicketForm(overlay.formEl, {
    config: { ...config, canvasId: current.canvasName },
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

  if (!config || !config.apiUrl || !config.token) {
    console.error(`${LOG_PREFIX} Init called with invalid config`);
    return;
  }

  if (config.canvasId && window.__jiratackActiveCanvas === config.canvasId) {
    window.__jiratackClose();
    return;
  }

  teardown(false);
  installConsoleProxy();
  window.__jiratackActiveCanvas = config.canvasId || 'universal';
  injectStyles();

  try {
    let session = await exchangeSession(config);

    if (session.scope === 'universal') {
      let canvasList;
      try {
        canvasList = await listCanvasesForUser(config, session);
      } catch (e) {
        if (e.code === 'TOKEN_EXPIRED' || e.code === 'TOKEN_INVALID') {
          session = await exchangeSession(config, { force: true });
          canvasList = await listCanvasesForUser(config, session);
        } else {
          throw e;
        }
      }

      const overlay = createOverlay();
      current = {
        config,
        session,
        overlay,
        universal: true,
        canvases: (canvasList && canvasList.canvases) || [],
        pins: [],
        canvasName: null,
        pinsController: null,
        sidebarController: null,
        pinModeController: null,
      };

      renderPinsAndSidebar();
      console.log(`${LOG_PREFIX} Universal launcher ready with ${current.canvases.length} canvas(es)`);
      return;
    }

    const canvasId = config.canvasId;
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
      universal: false,
      canvases: [],
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
