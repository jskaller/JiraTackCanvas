import { exchangeSession, clearSession } from './auth.js';
import { getPins, listCanvasesForUser, createCanvas } from './api.js';
import { createOverlay, removeOverlay } from './overlay.js';
import { renderPins, createPendingPin } from './pins.js';
import { renderSidebar } from './sidebar.js';
import { installPinMode } from './pinMode.js';
import { captureScreenshot } from './screenshot.js';
import { renderTicketForm } from './form.js';
import { installFixedShift } from './fixedShift.js';
import { installFitScale } from './fitScale.js';
import { playDoneAnimation } from './done.js';
import { installSelectionTracking, clearLastSelection } from './selection.js';
import { installConsoleProxy, restoreConsoleProxy, clearConsoleBuffer } from './consoleProxy.js';
import { normalizeUrl, stripDeepLinkParams } from '../shared/urlNormalize.js';
import { buildRefreshUrl, isSdkOutdated } from '../shared/bookmarklet.js';
import { toSafeHttpUrl } from '../shared/safeUrl.js';
import styles from './styles.css?inline';

// Replaced at build time by scripts/embed-sdk.js with the bundle hash.
export const RUNNING_SDK_VERSION = '__JIRATACK_SDK_VERSION__';

const LOG_PREFIX = '[JiraTack]';
const SIDEBAR_WIDTH_PX = 320;
const LAYOUT_FIX_STYLE_ID = 'jiratack-layout-fix';
let current = null;
let debugConfig = null;

if (typeof window !== 'undefined' && !window.__jiratackLayoutDebug) {
  window.__jiratackLayoutDebug = () => {
    let bodyTransform = null;
    try {
      bodyTransform = document.body ? (document.body.style.transform || '(none)') : '(no body)';
    } catch (e) {
      bodyTransform = '(error)';
    }
    return {
      sdkVersion: debugConfig ? debugConfig.sdkVersion || '(unknown)' : '(not initialized)',
      runningSdkVersion: RUNNING_SDK_VERSION,
      mode: current ? current.layoutMode || 'push' : '(closed)',
      scale: current && current.fitScale ? current.fitScale.scale : 1,
      fixedShifted: current && current.fixedShift ? current.fixedShift.size() : 0,
      htmlMarginRight: (() => {
        try {
          return document.documentElement.style.marginRight || '(none)';
        } catch (e) {
          return '(error)';
        }
      })(),
      bodyTransform,
    };
  };
}

let savedHtmlMarginRight = null;
let savedHtmlTransition = null;
let savedBodyWidth = null;
let pushLayoutApplied = false;

function getInline(el, prop) {
  try {
    return {
      value: el.style.getPropertyValue(prop),
      priority: el.style.getPropertyPriority(prop),
    };
  } catch (e) {
    return { value: '', priority: '' };
  }
}

function setInline(el, prop, value, priority) {
  try {
    el.style.setProperty(prop, value, priority || '');
  } catch (e) {
    // ignore
  }
}

function restoreInline(el, prop, saved) {
  try {
    if (saved && saved.value) el.style.setProperty(prop, saved.value, saved.priority || '');
    else el.style.removeProperty(prop);
  } catch (e) {
    // ignore
  }
}

function applyPushLayout() {
  if (pushLayoutApplied) return;
  try {
    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    if (!htmlEl || !bodyEl) return;
    savedHtmlMarginRight = getInline(htmlEl, 'margin-right');
    savedHtmlTransition = getInline(htmlEl, 'transition');
    savedBodyWidth = getInline(bodyEl, 'width');

    // Fixed-width bodies would otherwise overflow once the margin reserves
    // space for the sidebar. Measure before applying the margin, while the
    // body width still reflects the unmodified viewport.
    const bodyWidthPx = Number.parseFloat(window.getComputedStyle(bodyEl).width);
    if (Number.isFinite(bodyWidthPx) && bodyWidthPx > htmlEl.clientWidth) {
      setInline(bodyEl, 'width', `calc(100% - ${SIDEBAR_WIDTH_PX}px)`, 'important');
    }

    setInline(htmlEl, 'transition', 'margin-right 0.2s ease-in-out', 'important');
    setInline(htmlEl, 'margin-right', `${SIDEBAR_WIDTH_PX}px`, 'important');
    pushLayoutApplied = true;
  } catch (e) {
    // ignore — overlay still works, the sidebar just covers content
  }
}

function restorePushLayout() {
  if (!pushLayoutApplied) return;
  try {
    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    if (htmlEl) {
      restoreInline(htmlEl, 'margin-right', savedHtmlMarginRight);
      restoreInline(htmlEl, 'transition', savedHtmlTransition);
    }
    if (bodyEl) {
      restoreInline(bodyEl, 'width', savedBodyWidth);
    }
  } catch (e) {
    // ignore
  }
  pushLayoutApplied = false;
  savedHtmlMarginRight = null;
  savedHtmlTransition = null;
  savedBodyWidth = null;
}

function buildLayoutFixCss() {
  return `html{margin-right:${SIDEBAR_WIDTH_PX}px !important;}`;
}

function injectLayoutFix() {
  try {
    if (!document.head || document.getElementById(LAYOUT_FIX_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = LAYOUT_FIX_STYLE_ID;
    style.textContent = buildLayoutFixCss();
    document.head.appendChild(style);
  } catch (e) {
    // ignore — fixed elements just stay under the sidebar
  }
}

function removeLayoutFix() {
  try {
    const el = document.getElementById(LAYOUT_FIX_STYLE_ID);
    if (el) el.remove();
  } catch (e) {
    // ignore
  }
}

const LAYOUT_MODE_KEY = 'jiratack_layout_mode';
const MIN_FIT_SCALE = 0.5;

function getStoredLayoutMode() {
  try {
    return window.sessionStorage.getItem(LAYOUT_MODE_KEY) === 'fit' ? 'fit' : 'push';
  } catch (e) {
    return 'push';
  }
}

function setStoredLayoutMode(mode) {
  try {
    window.sessionStorage.setItem(LAYOUT_MODE_KEY, mode);
  } catch (e) {
    // ignore
  }
}

function teardownLayout() {
  if (current && current.fitScale) {
    try {
      current.fitScale.destroy();
    } catch (e) {
      // ignore
    }
    current.fitScale = null;
  }
  if (current && current.fixedShift) {
    try {
      current.fixedShift.destroy();
    } catch (e) {
      // ignore
    }
    current.fixedShift = null;
  }
  removeLayoutFix();
  restorePushLayout();
}

function applyLayoutMode(mode) {
  if (!current) return 'push';
  teardownLayout();
  let effective = mode === 'fit' ? 'fit' : 'push';
  if (effective === 'fit') {
    let installed = null;
    try {
      installed = installFitScale({
        sidebarWidth: SIDEBAR_WIDTH_PX,
        minScale: MIN_FIT_SCALE,
        onBelowFloor: () => {
          if (current && current.layoutMode === 'fit') {
            applyLayoutMode('push');
            setStoredLayoutMode('push');
            renderPinsAndSidebar();
            showToast('Window too narrow — using Actual size.');
          }
        },
        onScaleChange: () => {
          if (current && current.layoutMode === 'fit') {
            renderPinsAndSidebar();
          }
        },
      });
    } catch (e) {
      installed = null;
    }
    if (!installed) {
      effective = 'push';
    } else {
      current.fitScale = installed;
    }
  }
  if (effective === 'push') {
    applyPushLayout();
    injectLayoutFix();
    try {
      current.fixedShift = installFixedShift();
    } catch (e) {
      current.fixedShift = null;
    }
  }
  current.layoutMode = effective;
  return effective;
}

function handleLayoutModeChange(next) {
  if (!current || next === current.layoutMode) return;
  applyLayoutMode(next);
  setStoredLayoutMode(current.layoutMode);
  renderPinsAndSidebar();
}

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
  current.selectedKey = key;
  if (current.pinsController) current.pinsController.select(key);
  if (current.sidebarController) current.sidebarController.select(key);
  scrollPairIntoView(key);
}

function handlePinHover(pin) {
  if (!current || !current.sidebarController || !current.sidebarController.setHover) return;
  current.sidebarController.setHover(pin ? pin.key : null);
}

function handleCardHover(pin) {
  if (!current || !current.pinsController || !current.pinsController.setHover) return;
  current.pinsController.setHover(pin ? pin.key : null);
}

const WALK_DIRECTION = { ArrowDown: 1, ArrowUp: -1 };
const NAV_STATE_KEY = 'jiratack_nav_state';

function saveNavState(state) {
  try {
    window.sessionStorage.setItem(NAV_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    // ignore
  }
}

function readNavState() {
  try {
    const raw = window.sessionStorage.getItem(NAV_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

function clearNavState() {
  try {
    window.sessionStorage.removeItem(NAV_STATE_KEY);
  } catch (e) {
    // ignore
  }
}

function restoreNavFilter(canvasName) {
  const state = readNavState();
  clearNavState();
  if (!state || state.canvasName !== canvasName) return null;
  return state.filter === 'page' ? 'page' : 'all';
}

const CROSS_PAGE_NOTICE_MS = 3000;

function showPageNotice(message, durationMs, onProceed) {
  if (!message) return null;
  const host = document.getElementById('jiratack-overlay') || document.body;
  if (!host) return null;
  const notice = document.createElement('div');
  notice.className = 'jiratack-page-notice';
  notice.textContent = message;
  if (typeof onProceed === 'function') {
    notice.classList.add('jiratack-page-notice-clickable');
    notice.setAttribute('role', 'button');
    notice.tabIndex = 0;
    notice.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onProceed();
    });
    notice.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        onProceed();
      }
    });
  } else {
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
  }
  host.appendChild(notice);
  const lifetime = (typeof durationMs === 'number' ? durationMs : CROSS_PAGE_NOTICE_MS) + 800;
  window.setTimeout(() => {
    notice.remove();
  }, lifetime);
  return notice;
}

function handleBeforeNavigate(pin, proceed) {
  if (!current) return 0;
  saveNavState({
    canvasName: current.canvasName,
    filter: current.filter || 'all',
    selectedKey: pin ? pin.key : null,
  });
  const label = pin && pin.key ? pin.key : 'the ticket';
  showPageNotice(
    `Opening ${label}. This is on another page. You will need to re-open the JiraTack bookmark to continue.`,
    CROSS_PAGE_NOTICE_MS,
    proceed,
  );
  return CROSS_PAGE_NOTICE_MS;
}

function isInteractiveTarget(el) {
  if (!el || !el.closest) return false;
  return Boolean(el.closest('input, textarea, select, a, button, [contenteditable="true"]'));
}

function handleSidebarMouseDown(event) {
  if (isInteractiveTarget(event.target)) return;
  const sidebar = event.currentTarget;
  try {
    sidebar.focus({ preventScroll: true });
  } catch (e) {
    sidebar.focus();
  }
}

function handleSidebarKeydown(event) {
  if (!current) return;
  if (event.defaultPrevented) return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const direction = WALK_DIRECTION[event.key];
  if (!direction) return;
  if (isInteractiveTarget(event.target)) return;

  const keys = current.sidebarController && current.sidebarController.getKeys
    ? current.sidebarController.getKeys()
    : [];
  if (keys.length === 0) return;

  event.preventDefault();
  const index = keys.indexOf(current.selectedKey);
  let next;
  if (index === -1) {
    next = direction > 0 ? 0 : keys.length - 1;
  } else {
    next = Math.min(keys.length - 1, Math.max(0, index + direction));
  }
  select(keys[next]);
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

function handleMatchModeChange(mode) {
  if (!current) return;
  current.matchMode = mode === 'exact' || mode === 'path' ? mode : 'smart';
  renderPinsAndSidebar();
}

function clearPendingPin() {
  if (current && current.pendingPin) {
    current.pendingPin.destroy();
    current.pendingPin = null;
  }
}

const HYDRATION_RETRY_MS = 1500;

function cancelHydration() {
  if (!current) return;
  if (typeof current.hydrationToken !== 'number') current.hydrationToken = 0;
  if (!(current.hydrationKeys instanceof Set)) current.hydrationKeys = new Set();
  current.hydrationToken += 1;
  current.hydrationKeys.clear();
  current.hydrationRunning = false;
}

function scheduleHydration(key) {
  if (!current || !key) return;
  if (!(current.hydrationKeys instanceof Set)) current.hydrationKeys = new Set();
  current.hydrationKeys.add(key);
  if (current.hydrationRunning) return;
  runHydration();
}

async function runHydration() {
  if (!current) return;
  current.hydrationRunning = true;
  const token = current.hydrationToken;
  const canvasAtStart = current.canvasName;
  const keys = current.hydrationKeys;

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!current || current.hydrationToken !== token) return;

      let data = null;
      try {
        data = await getPins(current.config, current.session, canvasAtStart, getPageUrl(), true);
      } catch (e) {
        data = null;
      }

      if (!current || current.hydrationToken !== token || current.canvasName !== canvasAtStart) {
        return;
      }

      if (data) {
        const byKey = new Map(((data && data.pins) || []).map((pin) => [pin.key, pin]));
        Array.from(keys).forEach((key) => {
          const fresh = byKey.get(key);
          if (!fresh) return;
          const existing = (current.pins || []).find((pin) => pin.key === key);
          if (!existing) return;
          Object.assign(existing, fresh);
          if (current.sidebarController && current.sidebarController.updatePin) {
            current.sidebarController.updatePin(key, existing);
          }
          if (current.pinsController && current.pinsController.updatePin) {
            current.pinsController.updatePin(existing);
          }
          keys.delete(key);
        });
      }

      if (keys.size === 0) return;
      if (attempt === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, HYDRATION_RETRY_MS));
      }
    }
  } finally {
    if (current && current.hydrationToken === token) {
      current.hydrationRunning = false;
    }
  }
}

function handleEditStart(pin) {
  if (!current || !pin || !(current.hydrationKeys instanceof Set)) return;
  current.hydrationKeys.delete(pin.key);
}

function schedulePinReposition(delay) {
  if (!current) return;
  if (current.pinRepositionTimer) {
    window.clearTimeout(current.pinRepositionTimer);
  }
  current.pinRepositionTimer = window.setTimeout(() => {
    if (!current) return;
    current.pinRepositionTimer = null;
    if (current.pinsController && current.pinsController.update) {
      current.pinsController.update();
    }
  }, typeof delay === 'number' ? delay : 320);
}

function dismissTicketForm() {
  if (current && current.formController) {
    try {
      current.formController.destroy();
    } catch (e) {
      // ignore
    }
    current.formController = null;
  }
  if (current && current.overlay && current.overlay.formEl) {
    current.overlay.formEl.innerHTML = '';
  }
  clearPendingPin();
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

/**
 * The bundle is fetched with ?v=<version baked into the bookmark>, so a bookmark
 * dragged from an older build keeps running old code with no way to notice.
 * The exchange reports the live SDK version; when they differ, offer a one-click
 * replacement link that preserves the invitation and pairing.
 */
function warnIfOutdated(config, session) {
  // In the extension the SDK ships inside the package, so "re-drag the
  // bookmarklet" is not a remedy — the store update is. Suppress rather than
  // nag after every server-side release (D32).
  if (config && config.channel === 'extension') return;
  if (!session || !session.currentSdkVersion) return;
  if (!isSdkOutdated(RUNNING_SDK_VERSION, session.currentSdkVersion)) return;
  const sidebar = document.getElementById('jiratack-sidebar');
  if (!sidebar || document.getElementById('jiratack-outdated')) return;

  const banner = document.createElement('div');
  banner.id = 'jiratack-outdated';
  banner.className = 'jiratack-outdated';
  banner.appendChild(document.createTextNode('This bookmarklet is out of date.'));

  const href = toSafeHttpUrl(buildRefreshUrl(session.installUrl, config.token));
  if (href) {
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Get the new bookmarklet';
    banner.appendChild(document.createTextNode(' '));
    banner.appendChild(link);
  } else {
    banner.appendChild(document.createTextNode(' Re-drag it from Jira.'));
  }

  sidebar.insertBefore(banner, sidebar.firstChild);
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
    // Pins are spatial: they only make sense on their own page, so the pin layer
    // always uses the page matcher even when the list is showing all canvases.
    matchMode: current.matchMode || 'smart',
    onSelect: (pin) => select(pin.key),
    onHover: handlePinHover,
  });
  // The push margin animates; re-read element rects once it settles so pins
  // stay on their targets when toggling layout modes.
  schedulePinReposition(320);

  const canvasSelector = universal
    ? {
        canvases: current.canvases,
        selected: current.canvasName,
        onChange: handleCanvasSelect,
        onCreate: session && session.scope === 'view' ? undefined : handleCreateCanvas,
        onSwitch: () => {
          if (!current) return;
          cancelHydration();
          dismissTicketForm();
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
    onEditStart: handleEditStart,
    onHover: handleCardHover,
    onBeforeNavigate: handleBeforeNavigate,
    layoutMode: current.layoutMode || 'push',
    onLayoutModeChange: handleLayoutModeChange,
    canvasSelector,
    guestSelector,
    emptyMessage: universal && !hasCanvas ? 'Select a canvas to start.' : undefined,
    loading: Boolean(current.loading),
    loadingLabel: current.loadingLabel || '',
    loadError: current.loadError || '',
    pageUrl,
    filter: current.filter || 'all',
    matchMode: current.matchMode || 'smart',
    onFilterChange: handleFilterChange,
    onMatchModeChange: handleMatchModeChange,
  });

  if (current.session && !current.outdatedWarned) {
    current.outdatedWarned = true;
    warnIfOutdated(current.config, current.session);
  }

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

  cancelHydration();
  dismissTicketForm();

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

  cancelHydration();
  dismissTicketForm();
  current.canvasName = canvasName;
  current.loading = true;
  current.loadError = null;
  window.__jiratackActiveCanvas = canvasName;
  renderPinsAndSidebar();

  try {
    let data;
    try {
      data = await getPins(current.config, current.session, canvasName, getPageUrl(), true);
    } catch (e) {
      if (e && (e.code === 'TOKEN_EXPIRED' || e.code === 'TOKEN_INVALID')) {
        const session = await exchangeSession(current.config, { force: true });
        if (!current) return;
        current.session = session;
        if (Array.isArray(session.permittedCanvases)) {
          current.permittedCanvases = session.permittedCanvases;
        }
        data = await getPins(current.config, session, canvasName, getPageUrl(), true);
      } else {
        throw e;
      }
    }

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
  // The canvas seed ticket ("Canvas created", an Epic) must not drive defaults.
  const isSeedTicket = (pin) => Boolean(pin)
    && typeof pin.summary === 'string'
    && pin.summary.replace(/^\[JiraTack\]\s*/i, '').trim() === 'Canvas created';
  const usablePins = sortedPins.filter((pin) => !isSeedTicket(pin));
  const newestPin = usablePins.length > 0 ? usablePins[0] : null;
  const defaultProject = newestPin && newestPin.projectKey ? newestPin.projectKey : undefined;
  const sponsorAssignee = session && session.scope === 'guest_create' && session.issuer
    ? { accountId: session.issuer, displayName: session.issuerName || session.displayName || session.issuer }
    : undefined;
  // "Last entered" first, sponsor as the initial fallback for guests.
  const defaultAssignee = (newestPin && newestPin.assignee ? { ...newestPin.assignee } : undefined)
    || sponsorAssignee;
  const defaultIssueTypeId = newestPin && newestPin.issueTypeId ? newestPin.issueTypeId : undefined;
  const defaultPriorityId = newestPin && newestPin.priorityId ? newestPin.priorityId : undefined;

  current.formController = renderTicketForm(overlay.formEl, {
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
      dismissTicketForm();
    },
    onCreated: ({ result, capture: createdCapture, summary, projectKey, issueTypeId, priorityId, assignee }) => {
      if (!current) return;
      dismissTicketForm();
      const displaySummary = summary && summary.startsWith('[JiraTack]')
        ? summary
        : `[JiraTack] ${summary || ''}`.trim();
      current.pins = current.pins.concat([
        {
          key: result.key,
          summary: displaySummary,
          projectKey: projectKey || null,
          issueTypeId: issueTypeId || null,
          priorityId: priorityId || null,
          status: { name: '', category: '', colorName: '' },
          priority: null,
          assignee: assignee || null,
          reporter: null,
          pinPosition: createdCapture.pinPosition,
          selector: createdCapture.selector || null,
          issueType: null,
          createdAt: new Date().toISOString(),
          url: getPageUrl(),
        },
      ]);
      renderPinsAndSidebar();
      scheduleHydration(result.key);
      if (current.pinsController && current.pinsController.flash) {
        current.pinsController.flash(result.key);
      }
      if (result.warning === 'metadata-not-stored') {
        showToast(`${result.key} was created but its pin could not be saved. Recreate it or contact an admin.`);
      } else {
        showToast(`Created ${result.key}`);
      }
    },
  });
}

const POLL_INTERVAL_MS = 15000;
let pollTimer = null;

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function pinSignature(pins) {
  return (pins || [])
    .map((pin) => `${pin.key}:${pin.summary || ''}:${(pin.status && pin.status.name) || ''}`)
    .join('|');
}

/**
 * Forge has no server push, so liveness is polling: cheap, paused when the tab
 * is hidden, and silent on failure — a failed poll must never disturb an open
 * overlay.
 */
function startPolling() {
  stopPolling();
  pollTimer = window.setInterval(async () => {
    if (!current || !current.session || !current.canvasName || current.loading || current.polling) return;
    if (document.hidden) return;
    current.polling = true;
    try {
      const data = await getPins(current.config, current.session, current.canvasName, getPageUrl(), true);
      if (!current) return;
      const next = (data && data.pins) || [];
      if (pinSignature(next) === pinSignature(current.pins)) return;
      current.pins = next;
      renderPinsAndSidebar();
    } catch (e) {
      // best effort
    } finally {
      if (current) current.polling = false;
    }
  }, POLL_INTERVAL_MS);
}

function teardown(clearStoredSession) {
  stopPolling();
  clearLastSelection();
  if (current && current.pinRepositionTimer) {
    window.clearTimeout(current.pinRepositionTimer);
    current.pinRepositionTimer = null;
  }
  teardownLayout();
  cancelHydration();
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
    try {
      if (current.formController) current.formController.destroy();
    } catch (e) {
      // ignore
    }
    current.formController = null;
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
  installSelectionTracking();
  // Available in every mode: the launcher link is the one most people copy.
  renderViewportBar(config);

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
    debugConfig = config;
    console.log(`${LOG_PREFIX} SDK ${config.sdkVersion || 'unknown'} ready`);
    overlay.sidebarEl.tabIndex = -1;
    overlay.sidebarEl.addEventListener('mousedown', handleSidebarMouseDown);
    overlay.sidebarEl.addEventListener('keydown', handleSidebarKeydown);

    current = {
      config,
      session: null,
      overlay,
      universal: isLauncher,
      canvases: [],
      pins: [],
      canvasName: isLauncher ? (deepCanvas || null) : (config.canvasName || config.canvasId),
      filter: 'all',
      matchMode: 'smart',
      loading: true,
      loadingLabel: 'Connecting to Jira…',
      loadError: null,
      pinsController: null,
      sidebarController: null,
      pinModeController: null,
      formController: null,
      fixedShift: null,
      fitScale: null,
      layoutMode: null,
      selectedKey: null,
      pinRepositionTimer: null,
      hydrationKeys: new Set(),
      hydrationToken: 0,
      hydrationRunning: false,
    };
    current.layoutMode = applyLayoutMode(getStoredLayoutMode());
    setStoredLayoutMode(current.layoutMode);
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
      current.filter = restoreNavFilter(current.canvasName) || current.filter;
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
      current.filter = restoreNavFilter(current.canvasName) || 'all';
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
    current.filter = restoreNavFilter(current.canvasName) || (deepTicket ? 'all' : current.filter);
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

  // Arm the timer unconditionally: the tick itself checks that an overlay and a
  // session exist, so early returns from init cannot leave a stray interval.
  startPolling();
}

/**
 * Viewport presets (plan 6.6). Resizing the real window is the only honest
 * option: DevTools device emulation needs the debugger permission and a
 * permanent warning bar. This is a real layout at a real width, so media
 * queries fire; it is not device emulation, and the copy says so.
 */
function renderViewportBar(config) {
  if (!config || config.channel !== 'extension') return;
  const existing = document.getElementById('jiratack-viewport-bar');
  if (existing) existing.remove();

  const bar = document.createElement('div');
  bar.id = 'jiratack-viewport-bar';
  bar.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;gap:4px;align-items:center;padding:4px 6px;border-radius:6px;background:#fff;border:1px solid #dfe1e6;box-shadow:0 4px 12px rgba(9,30,66,.2);font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
  bar.title = 'Page width, sidebar excluded. Real layout, not device emulation.';

  const buttonStyle = 'padding:2px 8px;min-width:36px;border:1px solid #dfe1e6;border-radius:3px;background:#fff;color:#172b4d;cursor:pointer;font:600 12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
  // A preset is the width of the *page*, so the window must also carry the
  // sidebar (320) and the browser chrome. Without this, 375 left ~55px of page
  // and the layout collapsed.
  const SIDEBAR_WIDTH = 320;
  const chromeWidth = window.outerWidth - window.innerWidth;

  [375, 768, 1024, 1280].forEach((width) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(width);
    button.style.cssText = buttonStyle;
    button.addEventListener('click', () => {
      window.postMessage({ source: 'jiratack', type: 'resize', width, chromeWidth, sidebarWidth: SIDEBAR_WIDTH }, '*');
    });
    bar.appendChild(button);
  });

  // Custom width. Key events are stopped so typing a width cannot trigger the
  // host page's own keyboard shortcuts.
  const custom = document.createElement('input');
  custom.type = 'number';
  custom.min = '320';
  custom.max = '2560';
  custom.placeholder = 'Width';
  custom.style.cssText = 'width:72px;padding:2px 6px;border:1px solid #dfe1e6;border-radius:3px;color:#172b4d;font:600 12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
  const applyCustom = document.createElement('button');
  applyCustom.type = 'button';
  applyCustom.textContent = 'Go';
  applyCustom.style.cssText = buttonStyle;
  applyCustom.title = 'Apply this page width';

  const commitCustom = () => {
    const value = Number(custom.value);
    if (!Number.isFinite(value) || value < 320 || value > 2560) return;
    window.postMessage({
      source: 'jiratack', type: 'resize', width: Math.round(value), chromeWidth, sidebarWidth: SIDEBAR_WIDTH,
    }, '*');
  };
  applyCustom.addEventListener('click', commitCustom);
  custom.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commitCustom();
    }
  });
  custom.addEventListener('keyup', (e) => e.stopPropagation());

  bar.appendChild(custom);
  bar.appendChild(applyCustom);

  const fit = document.createElement('button');
  fit.type = 'button';
  fit.textContent = 'Fit';
  fit.style.cssText = buttonStyle;
  fit.addEventListener('click', () => {
    window.postMessage({ source: 'jiratack', type: 'resize', width: null, chromeWidth, sidebarWidth: SIDEBAR_WIDTH }, '*');
  });
  bar.appendChild(fit);

  document.body.appendChild(bar);
}

window.__jiratackInit = init;
window.__jiratackClose = close;
