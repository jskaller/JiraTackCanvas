import { exchangeSession, clearSession } from './auth.js';
import { getPins, listCanvasesForUser, createCanvas } from './api.js';
import { createOverlay, removeOverlay } from './overlay.js';
import { renderPins, createPendingPin } from './pins.js';
import { renderSidebar } from './sidebar.js';
import { installPinMode } from './pinMode.js';
import { captureScreenshot } from './screenshot.js';
import { renderTicketForm } from './form.js';
import { playDoneAnimation } from './done.js';
import { installConsoleProxy, restoreConsoleProxy, clearConsoleBuffer } from './consoleProxy.js';
import { normalizeUrl, stripDeepLinkParams } from '../shared/urlNormalize.js';
import styles from './styles.css?inline';

const LOG_PREFIX = '[JiraTack]';
let current = null;

function getPageUrl() {
  return normalizeUrl(stripDeepLinkParams(window.location.href));
}

function removeBootstrapLoading() {
  const loader = document.getElementById('jiratack-bootstrap-loading');
  if (loader) loader.remove();
  const style = document.getElementById('jiratack-bootstrap-style');
  if (style) style.remove();
}

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

function scrollPairIntoView(key) {
  if (!current) return;

  try {
    const escaped = String(key).replace(/"/g, '\\"');
    const card = document.querySelector(
      `#jiratack-sidebar .jiratack-ticket-card[data-key="${escaped}"]`,
    );
    if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (e) {
    // ignore
  }

  const pinEl = current.pinsController && current.pinsController.elementsByKey
    ? current.pinsController.elementsByKey.get(key)
    : null;
  if (pinEl) pinEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function select(key) {
  if (!current) return;
  if (current.pinsController) current.pinsController.select(key);
  if (current.sidebarController) current.sidebarController.select(key);
  scrollPairIntoView(key);
}

function handleDone({ pin, cardEl }) {
  const pinEl = current && current.pinsController && current.pinsController.elementsByKey
    ? current.pinsController.elementsByKey.get(pin.key)
    : null;
  playDoneAnimation({ pinEl, cardEl });
}

function handleFilterChange(filter) {
  if (!current) return;
  current.filter = filter;
  renderPinsAndSidebar();
}

function clearPendingPin() {
  if (current && current.pendingPin) {
    current.pendingPin.destroy();
    current.pendingPin = null;
  }
}

function stripLocationDeepLinks() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('jiratack_ticket') && !url.searchParams.has('jiratack_canvas')) return;
    window.history.replaceState({}, '', stripDeepLinkParams(url.toString()));
  } catch (e) {
    // ignore
  }
}

function selectAndScroll(key) {
  select(key);
}

function renderPinsAndSidebar() {
  if (!current) return;
  const { overlay, config, session } = current;
  const universal = Boolean(current.universal);
  const hasCanvas = Boolean(current.canvasName);
  const guest = Boolean(session && session.scope === 'guest_create');

  if (current.pinModeController) {
    current.pinModeController.destroy();
    current.pinModeController = null;
  }
  if (current.pinsController) {
    current.pinsController.destroy();
    current.pinsController = null;
  }

  const pageUrl = getPageUrl();

  current.pinsController = renderPins(overlay.pinsEl, current.pins, {
    pageUrl,
    onSelect: (pin) => select(pin.key),
  });

  const canvasSelector = universal
    ? {
        canvases: current.canvases,
        selected: current.canvasName,
        onChange: handleCanvasSelect,
        onCreate: session && session.scope === 'view' ? undefined : handleCreateCanvas,
        onSwitch: () => {
          if (!current) return;
          current.canvasName = null;
          current.pins = [];
          window.__jiratackActiveCanvas = current.config.canvasId || 'universal';
          renderPinsAndSidebar();
        },
      }
    : null;

  const guestCanvases = guest && Array.isArray(current.permittedCanvases)
    ? current.permittedCanvases
    : [];
  const guestSelector = guestCanvases.length > 0
    ? {
        canvases: guestCanvases,
        selected: current.canvasName,
        onChange: handleGuestCanvasSelect,
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
    guestSelector,
    emptyMessage: universal && !hasCanvas ? 'Select a canvas to start.' : undefined,
    loading: Boolean(current.loading),
    loadingLabel: current.loadingLabel || '',
    loadError: current.loadError || '',
    pageUrl,
    filter: current.filter || 'all',
    onFilterChange: handleFilterChange,
  });

  if (!current.loading && (!universal || hasCanvas)) {
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
    current.loading = false;
    window.__jiratackActiveCanvas = current.config.canvasId || 'universal';
    renderPinsAndSidebar();
    return;
  }

  current.canvasName = canvasName;
  current.loading = true;
  window.__jiratackActiveCanvas = canvasName;
  renderPinsAndSidebar();

  try {
    const data = await getPins(current.config, current.session, canvasName, getPageUrl(), true);
    if (!current) return;
    current.canvasName = (data && data.canvasName) || canvasName;
    current.pins = (data && data.pins) || [];
  } catch (e) {
    if (current) current.pins = [];
    showToast((e && e.message) || 'Failed to load canvas.');
  }

  if (!current) return;
  current.loading = false;
  renderPinsAndSidebar();
}

async function handleGuestCanvasSelect(canvasName) {
  if (!current || !canvasName) return;
  if (!current.session || current.session.scope !== 'guest_create') return;

  clearPendingPin();
  current.canvasName = canvasName;
  current.loading = true;
  current.loadError = null;
  window.__jiratackActiveCanvas = canvasName;
  renderPinsAndSidebar();

  try {
    const data = await getPins(current.config, current.session, canvasName, getPageUrl(), true);
    if (!current) return;
    current.canvasName = (data && data.canvasName) || canvasName;
    current.pins = (data && data.pins) || [];
  } catch (e) {
    if (current) {
      current.pins = [];
      current.loadError = (e && e.message) || 'Failed to load canvas.';
    }
  }

  if (!current) return;
  current.loading = false;
  renderPinsAndSidebar();
}

async function handleCreateCanvas() {
  if (!current || !current.universal) return;

  const entered = window.prompt('New canvas name');
  if (!entered || !entered.trim()) return;
  const canvasName = entered.trim();

  try {
    await createCanvas(current.config, current.session, canvasName, getPageUrl());
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

  clearPendingPin();
  current.pendingPin = createPendingPin(overlay.overlayEl, capture);

  const screenshotDataUrl = await captureScreenshot(capture.clientX, capture.clientY);
  if (screenshotDataUrl) {
    console.log(`${LOG_PREFIX} Screenshot captured successfully`);
  } else {
    console.log(`${LOG_PREFIX} Screenshot failed`);
  }

  if (!current || window.__jiratackActiveCanvas !== activeAtStart) {
    clearPendingPin();
    return;
  }

  const sortedPins = (current.pins || []).slice().sort((a, b) => {
    const aTime = a && a.createdAt ? Date.parse(a.createdAt) : 0;
    const bTime = b && b.createdAt ? Date.parse(b.createdAt) : 0;
    return bTime - aTime;
  });
  const newestPin = sortedPins.length > 0 ? sortedPins[0] : null;
  const defaultProject = newestPin && newestPin.projectKey ? newestPin.projectKey : undefined;
  const defaultAssignee = newestPin && newestPin.assignee ? { ...newestPin.assignee } : undefined;
  const defaultIssueTypeId = newestPin && newestPin.issueTypeId ? newestPin.issueTypeId : undefined;
  const defaultPriorityId = newestPin && newestPin.priorityId ? newestPin.priorityId : undefined;

  renderTicketForm(overlay.formEl, {
    config: { ...config, canvasId: current.canvasName },
    session,
    capture,
    screenshotDataUrl,
    screenshotFailed: !screenshotDataUrl,
    pins: current.pins,
    defaultProject,
    defaultAssignee,
    defaultIssueTypeId,
    defaultPriorityId,
    onCancel: () => {
      clearPendingPin();
      if (current && current.overlay) current.overlay.formEl.innerHTML = '';
    },
    onCreated: ({ result, capture: createdCapture, summary, projectKey, issueTypeId, priorityId }) => {
      if (!current) return;
      clearPendingPin();
      current.pins = current.pins.concat([
        {
          key: result.key,
          summary,
          projectKey: projectKey || null,
          issueTypeId: issueTypeId || null,
          priorityId: priorityId || null,
          status: { name: '', category: '', colorName: '' },
          priority: null,
          assignee: null,
          reporter: null,
          pinPosition: createdCapture.pinPosition,
          selector: createdCapture.selector || null,
          issueType: null,
          createdAt: new Date().toISOString(),
          url: getPageUrl(),
        },
      ]);
      renderPinsAndSidebar();
      showToast(`Created ${result.key}`);
    },
  });
}

function teardown(clearStoredSession) {
  clearPendingPin();
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
    removeBootstrapLoading();
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

  const deepParams = new URLSearchParams(window.location.search);
  const deepCanvas = deepParams.get('jiratack_canvas');
  const deepTicket = deepParams.get('jiratack_ticket');
  if (deepCanvas || deepTicket) {
    stripLocationDeepLinks();
  }

  let overlay = null;

  try {
    const isLauncher = config.canvasId === 'universal';
    overlay = createOverlay();
    removeBootstrapLoading();

    current = {
      config,
      session: null,
      overlay,
      universal: isLauncher,
      canvases: [],
      pins: [],
      canvasName: isLauncher ? (deepCanvas || null) : (config.canvasName || config.canvasId),
      filter: 'all',
      loading: true,
      loadingLabel: 'Connecting to Jira…',
      loadError: null,
      pinsController: null,
      sidebarController: null,
      pinModeController: null,
    };
    renderPinsAndSidebar();

    let session = await exchangeSession(config);
    if (!current || current.overlay !== overlay) return;
    current.session = session;
    current.loadingLabel = isLauncher ? 'Loading canvases…' : 'Loading pins…';
    renderPinsAndSidebar();

    if (session.scope === 'guest_create') {
      const permittedCanvases = Array.isArray(session.permittedCanvases) ? session.permittedCanvases : [];
      current.permittedCanvases = permittedCanvases;

      const initialCanvas = deepCanvas && permittedCanvases.includes(deepCanvas)
        ? deepCanvas
        : (permittedCanvases[0] || null);
      current.canvasName = initialCanvas;

      if (!initialCanvas) {
        current.loading = false;
        current.loadError = 'No canvases are available for this link. Ask the person who sent it for a new one.';
        renderPinsAndSidebar();
        return;
      }

      current.loadingLabel = 'Loading pins…';
      window.__jiratackActiveCanvas = initialCanvas;
      renderPinsAndSidebar();

      try {
        const data = await getPins(config, session, initialCanvas, getPageUrl(), true);
        if (!current || current.overlay !== overlay) return;
        current.canvasName = (data && data.canvasName) || initialCanvas;
        current.pins = (data && data.pins) || [];
      } catch (e) {
        if (current && current.overlay === overlay) {
          current.pins = [];
          current.loadError = (e && e.message) || 'Failed to load pins.';
        }
      }

      if (!current || current.overlay !== overlay) return;
      current.loading = false;
      renderPinsAndSidebar();
      if (deepTicket) selectAndScroll(deepTicket);
      console.log(`${LOG_PREFIX} Guest bookmarklet ready for canvas: ${current.canvasName}`);
      return;
    }

    if (isLauncher) {
      let canvasList;
      try {
        canvasList = await listCanvasesForUser(config, session);
      } catch (e) {
        if (e.code === 'TOKEN_EXPIRED' || e.code === 'TOKEN_INVALID') {
          session = await exchangeSession(config, { force: true });
          if (current && current.overlay === overlay) current.session = session;
          canvasList = await listCanvasesForUser(config, session);
        } else {
          throw e;
        }
      }
      if (!current || current.overlay !== overlay) return;
      current.canvases = (canvasList && canvasList.canvases) || [];

      if (deepCanvas) {
        window.__jiratackActiveCanvas = deepCanvas;
        current.canvasName = deepCanvas;
        current.loadingLabel = 'Loading pins…';
        renderPinsAndSidebar();
        try {
          const data = await getPins(config, session, deepCanvas, getPageUrl(), true);
          if (current && current.overlay === overlay) {
            current.canvasName = (data && data.canvasName) || deepCanvas;
            current.pins = (data && data.pins) || [];
          }
        } catch (e) {
          console.error(`${LOG_PREFIX} Deep-link canvas load failed:`, e);
        }
      } else {
        const pageUrl = getPageUrl();
        const matchingCanvases = current.canvases.filter((canvas) =>
          Array.isArray(canvas.urls) && canvas.urls.some((canvasUrl) => normalizeUrl(canvasUrl) === pageUrl),
        );

        if (matchingCanvases.length === 1) {
          const autoCanvasName = matchingCanvases[0].canvasName;
          window.__jiratackActiveCanvas = autoCanvasName;
          current.canvasName = autoCanvasName;
          current.loadingLabel = 'Loading pins…';
          renderPinsAndSidebar();
          try {
            const data = await getPins(config, session, autoCanvasName, getPageUrl(), true);
            if (current && current.overlay === overlay) {
              current.canvasName = (data && data.canvasName) || autoCanvasName;
              current.pins = (data && data.pins) || [];
            }
          } catch (e) {
            console.error(`${LOG_PREFIX} Auto-select failed:`, e);
          }
        }
      }

      if (!current || current.overlay !== overlay) return;
      current.loading = false;
      current.loadError = null;
      current.filter = 'all';
      renderPinsAndSidebar();
      if (deepTicket) selectAndScroll(deepTicket);
      console.log(`${LOG_PREFIX} Universal launcher ready with ${current.canvases.length} canvas(es)`);
      return;
    }

    const canvasId = config.canvasId;
    let data;
    try {
      data = await getPins(config, session, canvasId, getPageUrl(), true);
    } catch (e) {
      if (e.code === 'TOKEN_EXPIRED' || e.code === 'TOKEN_INVALID') {
        session = await exchangeSession(config, { force: true });
        if (current && current.overlay === overlay) current.session = session;
        data = await getPins(config, session, canvasId, getPageUrl(), true);
      } else {
        throw e;
      }
    }

    if (!current || current.overlay !== overlay) return;
    current.pins = (data && data.pins) || [];
    current.canvasName = (data && data.canvasName) || config.canvasName || canvasId;
    current.loading = false;
    current.loadError = null;
    current.filter = deepTicket ? 'all' : current.filter;
    renderPinsAndSidebar();
    if (deepTicket) selectAndScroll(deepTicket);
    console.log(`${LOG_PREFIX} Init called with canvas: ${current.canvasName}`);
  } catch (e) {
    console.error(`${LOG_PREFIX} Init failed:`, e);
    if (current && overlay && current.overlay === overlay) {
      current.loading = false;
      current.loadError = (e && e.message) || 'Failed to load JiraTack.';
      renderPinsAndSidebar();
    } else {
      teardown(false);
    }
  }
}

window.__jiratackInit = init;
window.__jiratackClose = close;
