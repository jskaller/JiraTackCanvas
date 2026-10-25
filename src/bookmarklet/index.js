import { exchangeSession, clearSession } from './auth.js';
import { getPins } from './api.js';
import { createOverlay, removeOverlay } from './overlay.js';
import { renderPins } from './pins.js';
import { renderSidebar } from './sidebar.js';
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

function teardown(clearStoredSession) {
  if (current) {
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
    .forEach((el) => el.remove());

  current = null;
  window.__jiratackActiveCanvas = null;
}

function close() {
  teardown(true);
  console.log(`${LOG_PREFIX} Close called`);
}

async function init(config) {
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
    const pins = (data && data.pins) || [];
    let pinsController = null;
    let sidebarController = null;

    const select = (key) => {
      if (pinsController) pinsController.select(key);
      if (sidebarController) sidebarController.select(key);
    };

    pinsController = renderPins(overlay.pinsEl, pins, {
      onSelect: (pin) => select(pin.key),
    });

    sidebarController = renderSidebar(overlay.sidebarEl, {
      canvasName: (data && data.canvasName) || config.canvasName,
      session,
      pins,
      config,
      onSelect: (pin) => select(pin.key),
    });

    current = { config, session, pinsController, sidebarController };
    console.log(`${LOG_PREFIX} Init called with canvas: ${(data && data.canvasName) || config.canvasName}`);
  } catch (e) {
    console.error(`${LOG_PREFIX} Init failed:`, e);
    teardown(false);
  }
}

window.__jiratackInit = init;
window.__jiratackClose = close;
