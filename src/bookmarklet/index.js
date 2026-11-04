import { exchangeSession, clearSession } from './auth.js';
import { getPins, listCanvasesForUser, createCanvas, updatePinPosition, uploadAttachment } from './api.js';
import { createOverlay, removeOverlay } from './overlay.js';
import { renderPins, createPendingPin, pinPagePoint } from './pins.js';
import { renderSidebar } from './sidebar.js';
import { installPinMode } from './pinMode.js';
import { computePinPosition } from './pinMode.js';
import { installTextSuggest } from './textSuggest.js';
import { openPinPopover, openTextPopover } from './capturePopover.js';
import { buildAnchor } from './textAnchor.js';
import { captureVisibleTab, supportsTabScreenshot } from './tabScreenshot.js';
import { getBufferSnapshot } from './consoleProxy.js';
import { createMoveConfirm } from './moveConfirm.js';
import { createTextPreview } from './textPreview.js';
import { captureScreenshot, captureCanvasThumbnail } from './screenshot.js';
import { renderTicketForm } from './form.js';
import { installFixedShift } from './fixedShift.js';
import { installFitScale } from './fitScale.js';
import { playDoneAnimation } from './done.js';
import { installConsoleProxy, restoreConsoleProxy, clearConsoleBuffer } from './consoleProxy.js';
import { normalizeUrl, stripDeepLinkParams } from '../shared/urlNormalize.js';
import { screenshotFilename } from '../shared/pinMove.js';
import { isSeedPin } from '../shared/seedPin.js';
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

/**
 * Bring a pin into the middle of the page.
 *
 * Used when the reviewer picks a ticket from the sidebar (click or arrow keys):
 * the pin may be anywhere on a long page, and "highlighted in the list" is only
 * useful if the page shows you where it is. Never triggered by clicking the pin
 * itself — it is already where the reviewer is looking — and never on hover.
 */
function centrePinOnPage(key) {
  if (!current) return;
  const pin = (current.pins || []).find((entry) => entry.key === key);
  if (!pin) return;
  const point = pinPagePoint(pin);
  if (!point) return;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const viewY = point.y - window.scrollY;
  const viewX = point.x - window.scrollX;

  const centredVertically = Math.abs(viewY - viewportHeight / 2) <= viewportHeight * 0.18;
  const onScreenHorizontally = viewX >= 0 && viewX <= viewportWidth;
  if (centredVertically && onScreenHorizontally) return;

  const next = { top: Math.max(0, Math.round(point.y - viewportHeight / 2)), behavior: 'smooth' };
  // Only pull horizontally when the pin is actually off-screen: horizontal
  // scrolling reflows many pages for no benefit when the pin is already visible.
  if (!onScreenHorizontally) {
    next.left = Math.max(0, Math.round(point.x - viewportWidth / 2));
  }
  try {
    window.scrollTo(next);
  } catch (e) {
    window.scrollTo(next.left || window.scrollX, next.top);
  }
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
}

function select(key, options = {}) {
  if (!current) return;
  current.selectedKey = key;
  if (current.pinsController) current.pinsController.select(key);
  if (current.sidebarController) current.sidebarController.select(key);
  scrollPairIntoView(key);
  if (options.centre) centrePinOnPage(key);
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
// Long enough for the carry message to reach the extension before the page
// goes away, short enough to feel like a normal link.
const CARRY_NOTICE_MS = 400;

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

  // The extension can put the overlay back on the next page: the background
  // keeps a one-shot carry flag for this tab and re-injects after the
  // navigation completes (D40). Tell it before we leave, and keep the notice
  // short — there is nothing to re-open by hand.
  if (current.config && current.config.channel === 'extension') {
    try {
      window.postMessage({ source: 'jiratack', type: 'carry-overlay', url: pin && pin.url ? pin.url : null }, '*');
    } catch (e) {
      // no bridge: fall through to the manual notice
    }
    showPageNotice(
      `Opening ${label} on its page. JiraTack will reopen there.`,
      CARRY_NOTICE_MS,
      proceed,
    );
    return CARRY_NOTICE_MS;
  }

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
  select(keys[next], { centre: true });
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

// The single visibility control (D38, amended). The project rule is the default;
// the reviewer's per-canvas choice (localStorage) overrides it; View All is a
// temporary peek that changes nothing.
const STATUS_FILTER_PREFIX = 'jiratack:statusFilter:';

function statusNameOf(pin) {
  return pin && pin.status && pin.status.name ? String(pin.status.name) : '';
}

function readStatusRule(canvasName) {
  if (!canvasName) return null;
  try {
    const raw = window.localStorage.getItem(`${STATUS_FILTER_PREFIX}${canvasName}`);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((name) => typeof name === 'string' && name.length > 0);
  } catch (e) {
    return null;
  }
}

function writeStatusRule(canvasName, names) {
  if (!canvasName) return;
  try {
    if (names === null) {
      window.localStorage.removeItem(`${STATUS_FILTER_PREFIX}${canvasName}`);
      return;
    }
    const unique = Array.from(new Set(names.filter((name) => typeof name === 'string' && name.length > 0)));
    window.localStorage.setItem(`${STATUS_FILTER_PREFIX}${canvasName}`, JSON.stringify(unique));
  } catch (e) {
    // Storage blocked: the choice still applies for this session.
  }
}

function statusesOnCanvas(pins) {
  const counts = new Map();
  pins.forEach((pin) => {
    const name = statusNameOf(pin);
    if (!name) return;
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveStatusState(pins) {
  if (!current) {
    return { hidden: new Set(), groups: [], hiddenCount: 0, rule: [], ruleIsDefault: true, showAll: false };
  }
  // Re-read the stored rule when the canvas changed, so one canvas's choice
  // never leaks into another.
  if (current.statusHiddenCanvas !== current.canvasName) {
    current.statusHidden = readStatusRule(current.canvasName);
    current.statusHiddenCanvas = current.canvasName;
    current.statusShowAll = false;
    current.statusPanelOpen = false;
  }

  const groups = statusesOnCanvas(pins);
  // The project rule comes down as a per-pin flag on the pins it hides.
  const defaultHidden = new Set(pins.filter((pin) => pin.filtered).map(statusNameOf).filter(Boolean));
  const ruleList = current.statusHidden === null ? Array.from(defaultHidden) : current.statusHidden;
  const rule = new Set(ruleList);
  const showAll = Boolean(current.statusShowAll);
  const hidden = showAll ? new Set() : new Set(rule);
  // The count describes what the FILTER is holding back, even while View All is
  // showing everything — that is the number the badge offers to re-hide.
  const hiddenCount = pins.filter((pin) => rule.has(statusNameOf(pin))).length;

  current.statusRule = Array.from(rule);
  return {
    hidden,
    groups,
    hiddenCount,
    rule: current.statusRule,
    ruleIsDefault: current.statusHidden === null,
    showAll,
  };
}

function applyStatusRule(names) {
  if (!current) return;
  writeStatusRule(current.canvasName, names);
  current.statusHidden = names;
  current.statusHiddenCanvas = current.canvasName;
  current.statusShowAll = false;
  renderPinsAndSidebar();
}

function handleStatusFilterChange(mode) {
  if (!current) return;
  current.statusShowAll = mode === 'all';
  renderPinsAndSidebar();
}

function handleStatusPanelToggle() {
  if (!current) return;
  current.statusPanelOpen = !current.statusPanelOpen;
  renderPinsAndSidebar();
}

function handleStatusToggle(name, show) {
  if (!current || !name) return;
  const next = new Set(Array.isArray(current.statusRule) ? current.statusRule : []);
  if (show) next.delete(name);
  else next.add(name);
  applyStatusRule(Array.from(next));
}

function handleStatusAll() {
  applyStatusRule([]);
}

function handleStatusNone() {
  if (!current) return;
  const pins = (current.pins || []).filter((pin) => !isSeedPin(pin));
  applyStatusRule(statusesOnCanvas(pins).map((group) => group.name));
}

function handleStatusReset() {
  applyStatusRule(null);
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
  destroyCapturePopover();
  if (current && current.formController) {
    try {
      current.formController.destroy();
    } catch (e) {
      // ignore
    }
    current.formController = null;
  }
  if (current) {
    current.composing = false;
    current.composeListOpen = false;
  }
  if (current && current.overlay && current.overlay.formEl) {
    current.overlay.formEl.innerHTML = '';
  }
  clearPendingPin();
  // Leave compose mode: restore filters and the ticket list immediately.
  if (current) renderPinsAndSidebar();
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

/**
 * Post-creation text-change preview (D35). The selection is gone, so the
 * passage is re-found from the stored pair: scoped to the pinned element first,
 * then document-wide only when unique. Never highlight the wrong occurrence.
 */
function handleTextChangeToggle(pin) {
  if (!current || !current.textPreview || !pin || !pin.textChange) return;
  const preview = current.textPreview;
  const showingThis = current.activeTextChangeKey === pin.key
    && preview.isVisible()
    && preview.isAttached();
  if (showingThis) {
    preview.hide();
    current.activeTextChangeKey = null;
    if (current.sidebarController && current.sidebarController.setTextChangeActive) {
      current.sidebarController.setTextChangeActive(null);
    }
    return;
  }

  preview.hide();
  const storedAnchor = pin.textChange.anchor || null;
  const anchor = storedAnchor
    ? { ...storedAnchor, text: pin.textChange.original }
    : { text: pin.textChange.original, ancestorSelector: pin.selector || null };
  const mode = preview.show({
    text: pin.textChange.original,
    anchor,
    replacement: pin.textChange.suggested,
  });
  if (!mode) {
    current.activeTextChangeKey = null;
    if (current.sidebarController && current.sidebarController.setTextChangeActive) {
      current.sidebarController.setTextChangeActive(null);
    }
    showToast('Could not locate that text on the page.');
    return;
  }

  current.activeTextChangeKey = pin.key;
  if (current.sidebarController && current.sidebarController.setTextChangeActive) {
    current.sidebarController.setTextChangeActive(pin.key);
  }
}

function renderPinsAndSidebar() {
  if (!current) return;
  const { overlay, config, session } = current;
  const universal = Boolean(current.universal);
  const hasCanvas = Boolean(current.canvasName);
  const guest = Boolean(session && session.scope === 'guest_create');
  const composing = Boolean(current.composing);

  if (current.pinModeController) {
    current.pinModeController.destroy();
    current.pinModeController = null;
  }
  if (current.pinsController) {
    current.pinsController.destroy();
    current.pinsController = null;
  }

  const pageUrl = getPageUrl();
  const canWrite = Boolean(session)
    && ['create', 'universal', 'guest_create'].includes(session.scope);
  // The canvas seed ticket is bookkeeping, not a pin: it has position 0,0 and
  // would otherwise draw a card and a marker at the document origin.
  const withSeedRemoved = (current.pins || []).filter((pin) => !isSeedPin(pin));

  // Status filter (D38, amended): the project rule is the DEFAULT, the reviewer
  // owns a per-canvas choice, and View All is a temporary peek at everything.
  const statusState = resolveStatusState(withSeedRemoved);
  const displayPins = withSeedRemoved.filter(
    (pin) => !statusState.hidden.has(statusNameOf(pin)),
  );

  if (current.activeTextChangeKey) {
    const stillThere = displayPins.some((pin) => pin.key === current.activeTextChangeKey && pin.textChange);
    if (!stillThere || !current.textPreview || !current.textPreview.isAttached()) {
      if (current.textPreview) current.textPreview.hide();
      current.activeTextChangeKey = null;
    }
  }

  current.pinsController = renderPins(overlay.pinsEl, displayPins, {
    pageUrl,
    // Pins are spatial: they only make sense on their own page, so the pin layer
    // always uses the page matcher even when the list is showing all canvases.
    matchMode: current.matchMode || 'smart',
    onSelect: (pin) => select(pin.key),
    onHover: handlePinHover,
    onMove: canWrite && !composing ? handlePinMove : undefined,
    // A pending confirmation blocks every drag, not just the same pin. While a
    // ticket is being written, pins are not draggable either.
    canStartDrag: canWrite
      ? () => !current || (!current.pendingMove && !current.composing && !current.capturePopover)
      : undefined,
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
          if (!current || current.composing) return;
          cancelHydration();
          cancelPendingMoveIfAny();
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
    pins: displayPins,
    config,
    composing,
    composeListOpen: Boolean(current.composeListOpen),
    keepForm: Boolean(current.formController),
    activeTextChangeKey: current.activeTextChangeKey,
    onTextChangeToggle: handleTextChangeToggle,
    onToggleComposeList: () => {
      if (!current) return;
      current.composeListOpen = !current.composeListOpen;
      renderPinsAndSidebar();
    },
    onSelect: (pin) => select(pin.key, { centre: true }),
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
    runningSdkVersion: RUNNING_SDK_VERSION,
    statusState,
    statusPanelOpen: Boolean(current.statusPanelOpen),
    onStatusFilterChange: handleStatusFilterChange,
    onStatusPanelToggle: handleStatusPanelToggle,
    onStatusToggle: handleStatusToggle,
    onStatusAll: handleStatusAll,
    onStatusNone: handleStatusNone,
    onStatusReset: handleStatusReset,
  });

  if (current.session && !current.outdatedWarned) {
    current.outdatedWarned = true;
    warnIfOutdated(current.config, current.session);
  }

  if (!current.loading && (!universal || hasCanvas) && !composing) {
    current.pinModeController = installPinMode({
      header: overlay.headerEl,
      session,
      onCapture: handleCapture,
      onHint: showToast,
    });
  }
}

async function handleCanvasSelect(canvasName) {
  if (!current || !current.universal || current.composing) return;

  cancelHydration();
  cancelPendingMoveIfAny();
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
  if (current.composing) return;

  cancelHydration();
  cancelPendingMoveIfAny();
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

function destroyCapturePopover() {
  if (current && current.capturePopover) {
    try {
      current.capturePopover.destroy();
    } catch (e) {
      // ignore
    }
    current.capturePopover = null;
  }
}

/**
 * Screenshot at the capture point, taken only after the composer is submitted.
 * The extension uses the fast visible-tab capture; if that is unavailable the
 * ticket is created without an image rather than freezing the page. The
 * bookmarklet has no extension APIs, so it pays for html2canvas once, with the
 * sidebar kept on screen and omitted from the raster.
 */
async function captureThumbnailForTicket() {
  if (current && supportsTabScreenshot(current.config)) {
    const shot = await captureCanvasThumbnail({ captureTab: captureVisibleTab });
    if (shot) return shot;
  }
  // The visible-tab capture can be refused (lost activeTab, restricted frame);
  // fall back to an in-page render rather than leaving the canvas without one.
  return captureCanvasThumbnail();
}

async function captureForTicket(clientX, clientY) {
  if (current && supportsTabScreenshot(current.config)) {
    return captureScreenshot(clientX, clientY, { captureTab: captureVisibleTab });
  }
  return captureScreenshot(clientX, clientY, {
    scale: 1,
    keepVisibleIds: ['jiratack-sidebar'],
  });
}

/**
 * Defaults from the most recent tickets on the canvas, newest first, using the
 * newest non-empty value for each field. The seed ticket is bookkeeping, not a
 * previous ticket.
 */
function computeDefaults() {
  if (!current || !current.session) return {};
  const session = current.session;
  const pins = (current.pins || []).filter((pin) => !isSeedPin(pin));
  const sorted = pins.slice().sort((a, b) => {
    const aTime = a && a.createdAt ? Date.parse(a.createdAt) : 0;
    const bTime = b && b.createdAt ? Date.parse(b.createdAt) : 0;
    return bTime - aTime;
  });
  const pick = (fn) => {
    for (const pin of sorted) {
      const value = fn(pin);
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
  };
  const permitted = Array.isArray(session.permittedProjects) ? session.permittedProjects : [];
  const projectKey = pick((pin) => pin.projectKey)
    || (permitted.length === 1 ? permitted[0] : null);
  const issueTypeId = pick((pin) => pin.issueTypeId);
  const priorityId = pick((pin) => pin.priorityId);
  const parentKey = pick((pin) => pin.parentKey);
  const previousAssignee = pick((pin) => (pin.assignee && pin.assignee.accountId ? pin.assignee : null));
  const sponsor = session.scope === 'guest_create' && session.issuer
    ? { accountId: session.issuer, displayName: session.issuerName || session.displayName || session.issuer }
    : null;
  const self = session.accountId
    ? { accountId: session.accountId, displayName: session.displayName || null }
    : null;
  return {
    projectKey,
    issueTypeId,
    priorityId,
    parentKey,
    assignee: previousAssignee || sponsor || self || null,
  };
}

function openTicketForm(options) {
  if (!current) return;
  const { config, session, overlay } = current;
  const { capture, screenshotDataUrl, initialSummary, initialDescription, textChange, textSelection, defaults } = options;
  current.composing = true;
  current.composeListOpen = false;
  if (current.textSuggest) current.textSuggest.hide();
  renderPinsAndSidebar();
  current.formController = renderTicketForm(overlay.formEl, {
    config: { ...config, canvasId: current.canvasName },
    session,
    capture,
    textSelection,
    textChange,
    textPreview: current.textPreview,
    capturePopoverHost: overlay.capturePopoverHostEl,
    initialSummary,
    initialDescription,
    screenshotDataUrl,
    screenshotFailed: !screenshotDataUrl,
    needsCanvasThumbnail: Boolean(current && !current.canvasHasThumbnail),
    captureCanvasThumbnail: captureThumbnailForTicket,
    defaultProject: defaults.projectKey,
    defaultAssignee: defaults.assignee,
    defaultIssueTypeId: defaults.issueTypeId,
    defaultPriorityId: defaults.priorityId,
    defaultParentKey: defaults.parentKey,
    onCancel: () => {
      dismissTicketForm();
    },
    onCreated: ({ result, capture: createdCapture, summary, projectKey, issueTypeId, priorityId, textChange: createdTextChange, assignee, parentKey }) => {
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
          parentKey: parentKey || null,
          status: { name: '', category: '', colorName: '' },
          priority: null,
          assignee: assignee || null,
          reporter: null,
          pinPosition: createdCapture.pinPosition,
          selector: createdCapture.selector || null,
          textChange: createdTextChange || null,
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

async function handleCapture(capture) {
  if (!current || !current.canvasName) return;
  if (current.composing) return;
  if (current.textSuggest) current.textSuggest.hide();
  if (current.textPreview) {
    current.textPreview.hide();
    current.activeTextChangeKey = null;
  }
  destroyCapturePopover();
  cancelPendingMoveIfAny();
  const { overlay } = current;

  clearPendingPin();
  current.pendingPin = createPendingPin(overlay.overlayEl, capture);

  const defaults = computeDefaults();
  const canvasAtStart = current.canvasName;
  let screenshotDataUrl = null;

  current.capturePopover = openPinPopover({
    host: overlay.capturePopoverHostEl,
    anchor: {
      left: capture.clientX,
      top: capture.clientY,
      right: capture.clientX,
      bottom: capture.clientY,
    },
    onAdd: async ({ summary, description }) => {
      if (!current) return;
      current.capturePopover = null;
      const slowNotice = window.setTimeout(() => showToast('Preparing screenshot…'), 300);
      screenshotDataUrl = await captureForTicket(capture.clientX, capture.clientY);
      window.clearTimeout(slowNotice);
      if (!current || current.canvasName !== canvasAtStart) return;
      openTicketForm({
        capture,
        screenshotDataUrl,
        initialSummary: summary,
        initialDescription: description,
        textChange: null,
        textSelection: null,
        defaults,
      });
    },
    onCancel: () => {
      current.capturePopover = null;
      if (current) clearPendingPin();
    },
  });
}

async function handleTextSuggest(suggestion) {
  if (!current || !current.canvasName || current.composing || !suggestion) return;
  if (current.pinModeController) current.pinModeController.deactivate();
  if (current.textSuggest) current.textSuggest.hide();
  if (current.textPreview) {
    current.textPreview.hide();
    current.activeTextChangeKey = null;
  }
  destroyCapturePopover();
  cancelPendingMoveIfAny();

  const { overlay } = current;
  const result = computePinPosition(suggestion.target, suggestion.clientX, suggestion.clientY);
  const capture = {
    ...result,
    consoleSnapshot: getBufferSnapshot(),
    elementTag: suggestion.target.tagName.toLowerCase(),
    clientX: suggestion.clientX,
    clientY: suggestion.clientY,
  };

  clearPendingPin();
  current.pendingPin = createPendingPin(overlay.overlayEl, capture);
  const defaults = computeDefaults();
  const textSelection = {
    text: suggestion.text,
    range: suggestion.range,
    anchor: buildAnchor(suggestion.range, suggestion.text),
  };
  const initialSummary = `Text change: ${suggestion.text.slice(0, 60)}`;
  const canvasAtStart = current.canvasName;
  let screenshotDataUrl = null;

  current.capturePopover = openTextPopover({
    host: overlay.capturePopoverHostEl,
    anchor: suggestion.anchorRect,
    selection: textSelection,
    initialReplacement: '',
    preview: current.textPreview,
    submitLabel: 'Add to ticket',
    onAdd: async ({ replacement }) => {
      if (!current) return;
      current.capturePopover = null;
      const slowNotice = window.setTimeout(() => showToast('Preparing screenshot…'), 300);
      screenshotDataUrl = await captureForTicket(suggestion.clientX, suggestion.clientY);
      window.clearTimeout(slowNotice);
      if (!current || current.canvasName !== canvasAtStart) return;
      openTicketForm({
        capture,
        screenshotDataUrl,
        initialSummary,
        initialDescription: '',
        textChange: { original: suggestion.text, suggested: replacement },
        textSelection,
        defaults,
      });
    },
    onCancel: () => {
      current.capturePopover = null;
      if (current) clearPendingPin();
    },
  });
}

/**
 * A pin was dropped (SPEC §10.3, D33). Nothing is written yet: the pin renders
 * at the drop point, the screenshot is captured and held in memory, and a bar
 * beside the pin asks for confirmation. Confirm commits; Cancel, Escape or
 * closing the overlay restores the previous selector and position and sends
 * nothing. There is no timer and no auto-commit.
 */
function revertPendingMove(pending) {
  if (!current) return;
  const target = (current.pins || []).find((candidate) => candidate.key === pending.key);
  if (target) {
    target.selector = pending.previous.selector;
    target.pinPosition = pending.previous.pinPosition;
  }
  if (current.pinsController) {
    current.pinsController.setPlacement(pending.key, pending.previous);
  }
}

function clearPendingMove(pending) {
  if (current && current.pendingMove === pending) current.pendingMove = null;
  if (pending && pending.controller) {
    pending.controller.destroy();
    pending.controller = null;
  }
}

function cancelPendingMove(pending) {
  if (!current || current.pendingMove !== pending || pending.busy) return;
  revertPendingMove(pending);
  clearPendingMove(pending);
}

function cancelPendingMoveIfAny() {
  if (current && current.pendingMove) cancelPendingMove(current.pendingMove);
}

function handlePinMove(move) {
  if (!current || !current.session || !move || !move.pin) return;
  if (current.composing) return;
  // One move at a time. The drag controller is also gated, so this is a second
  // line of defence rather than the primary control.
  if (current.pendingMove) return;

  // A drag and a composer cannot own the page at the same time.
  destroyCapturePopover();
  if (current.textSuggest) current.textSuggest.hide();
  if (current.textPreview) {
    current.textPreview.hide();
    current.activeTextChangeKey = null;
  }

  const { pin } = move;
  if (!pin.key) return;

  const previous = {
    selector: typeof pin.selector === 'string' && pin.selector.length > 0 ? pin.selector : null,
    pinPosition: pin.pinPosition,
  };
  if (previous.selector === move.selector && previous.pinPosition === move.pinPosition) return;

  const pending = {
    key: pin.key,
    previous,
    next: {
      selector: move.selector,
      pinPosition: move.pinPosition,
      captureContext: move.captureContext || null,
      clientX: move.clientX,
      clientY: move.clientY,
      movedPixels: Math.round(move.movedPixels),
    },
    // Identity of the overlay this move belongs to. A confirmed commit is
    // allowed to finish after the overlay closes; an unconfirmed one never
    // leaves the page.
    overlay: current.overlay,    capture: null,
    controller: null,
    busy: false,
  };
  current.pendingMove = pending;

  pin.selector = pending.next.selector;
  pin.pinPosition = pending.next.pinPosition;
  if (current.pinsController) current.pinsController.setPlacement(pin.key, pending.next);

  pending.capture = captureScreenshot(pending.next.clientX, pending.next.clientY, { png: true })
    .catch((e) => {
      console.error(`${LOG_PREFIX} Move screenshot capture failed:`, e);
      return null;
    });

  // Show the bar only once the capture has finished. The capture hides the
  // whole overlay, so a bar created before it would be invisible for that
  // window while still occupying its position — an immediate click would land
  // on the page underneath. The pin itself moves straight away, so there is
  // still instant feedback.
  pending.capture
    .then((dataUrl) => {
      if (!current || current.pendingMove !== pending) return;
      pending.dataUrl = dataUrl;
      pending.controller = createMoveConfirm({
        host: current.overlay.overlayEl,
        key: pending.key,
        reservedRight: SIDEBAR_WIDTH_PX,
        onConfirm: () => confirmPendingMove(pending),
        onCancel: () => cancelPendingMove(pending),
      });
    })
    .catch((e) => {
      console.error(`${LOG_PREFIX} Move confirmation failed:`, e);
      cancelPendingMove(pending);
    });
}

async function confirmPendingMove(pending) {
  if (!current || current.pendingMove !== pending || pending.busy) return;
  const { config, session } = current;
  pending.busy = true;
  if (pending.controller) pending.controller.setBusy(true);

  try {
    const dataUrl = await pending.capture;
    if (!current || current.overlay !== pending.overlay) return;

    let screenshotUploadId = null;
    if (dataUrl) {
      try {
        screenshotUploadId = await uploadAttachment(config, session, {
          dataUrl,
          filename: screenshotFilename(pending.key, Date.now()),
          mimeType: 'image/png',
        });
      } catch (e) {
        console.error(`${LOG_PREFIX} Move screenshot upload failed:`, e);
      }
    } else {
      console.error(`${LOG_PREFIX} Move screenshot capture failed`);
    }

    const result = await updatePinPosition(config, session, {
      issueKey: pending.key,
      pinPosition: pending.next.pinPosition,
      selector: pending.next.selector,
      captureContext: pending.next.captureContext,
      movedPixels: pending.next.movedPixels,
      screenshotUploadId,
    });

    if (!current || current.overlay !== pending.overlay) return;
    if (current.pendingMove === pending) {
      clearPendingMove(pending);
      if (result && Array.isArray(result.warnings) && result.warnings.includes('screenshot-not-attached')) {
        showToast(`${pending.key} moved, but the screenshot could not be attached.`);
      }
    }
  } catch (e) {
    console.error(`${LOG_PREFIX} Pin move failed:`, e);
    if (current && current.overlay === pending.overlay) {
      revertPendingMove(pending);
      if (current.pendingMove === pending) clearPendingMove(pending);
      showToast((e && e.message) || 'Could not move this pin.');
    }
  } finally {
    pending.busy = false;
  }
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
      if (data && data.canvasHasThumbnail !== undefined) {
        current.canvasHasThumbnail = Boolean(data.canvasHasThumbnail);
      }
      // Polling must not undo a move the reviewer is still confirming.
      if (current.pendingMove) {
        const pendingPin = next.find((pin) => pin.key === current.pendingMove.key);
        if (pendingPin) {
          pendingPin.selector = current.pendingMove.next.selector;
          pendingPin.pinPosition = current.pendingMove.next.pinPosition;
        }
      }
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
  if (current && current.pinRepositionTimer) {
    window.clearTimeout(current.pinRepositionTimer);
    current.pinRepositionTimer = null;
  }
  teardownLayout();
  cancelHydration();
  clearPendingPin();
  if (current && current.textSuggest) {
    try {
      current.textSuggest.destroy();
    } catch (e) {
      // ignore
    }
    current.textSuggest = null;
  }
  if (current && current.capturePopover) {
    try {
      current.capturePopover.destroy();
    } catch (e) {
      // ignore
    }
    current.capturePopover = null;
  }
  if (current && current.textPreview) {
    try {
      current.textPreview.hide();
    } catch (e) {
      // ignore
    }
    current.textPreview = null;
  }
  // An unconfirmed move is discarded, never committed: closing the overlay is
  // the "oops" exit. A confirmed move already in flight continues.
  if (current && current.pendingMove) {
    try {
      if (current.pendingMove.controller) current.pendingMove.controller.destroy();
    } catch (e) {
      // ignore
    }
    current.pendingMove = null;
  }
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

/**
 * Session failures that a reviewer can fix themselves (D43). A token that has
 * expired or been replaced reads as "invalid token" from the API, which is
 * useless advice; name the recovery instead.
 */
function friendlyAuthError(error) {
  const code = error && error.code;
  const message = (error && error.message) || 'Failed to load JiraTack.';
  if (code === 'TOKEN_EXPIRED' || code === 'TOKEN_INVALID' || code === 'TOKEN_REVOKED') {
    return 'Your JiraTack session has expired. Open a fresh JiraTack link, or click the JiraTack toolbar button on a page where the bookmarklet is running, to reconnect.';
  }
  if (code === 'BAD_EXCHANGE_RESPONSE') return message;
  return message;
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

  // A safe, token-bearing view for the extension to enroll itself from (D39):
  // clicking the toolbar button on this page connects without any paste. The
  // bootstrap already used this token on the page, so this exposes nothing new.
  window.__jiratackConfig = {
    token: config.token,
    apiUrl: config.apiUrl,
    sdkUrl: config.sdkUrl || '',
    canvasId: config.canvasId || 'universal',
    canvasName: config.canvasName || 'Canvas',
    sdkVersion: config.sdkVersion || '',
  };

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
    // The preset bar lives inside the overlay so page layout (the push-mode
    // fixed-shift pass, page CSS, page z-index) can never move or cover it.
    // Available in every mode: the launcher link is the one most people copy.
    renderViewportBar(config, overlay.overlayEl);
    removeBootstrapLoading();
    debugConfig = config;
    console.log(`${LOG_PREFIX} SDK ${RUNNING_SDK_VERSION} ready (enrolled config ${config.sdkVersion || 'unknown'})`);
    overlay.sidebarEl.tabIndex = -1;
    overlay.sidebarEl.addEventListener('mousedown', handleSidebarMouseDown);
    overlay.sidebarEl.addEventListener('keydown', handleSidebarKeydown);

    current = {
      config,
      session: null,
      overlay,
      textPreview: createTextPreview(),
      activeTextChangeKey: null,
      textSuggest: null,
      capturePopover: null,
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
      pendingMove: null,
      composing: false,
      composeListOpen: false,
    };
    current.layoutMode = applyLayoutMode(getStoredLayoutMode());
    setStoredLayoutMode(current.layoutMode);
    current.textSuggest = installTextSuggest({
      host: overlay.overlayEl,
      canStart: () => Boolean(
        current
        && current.session
        && current.canvasName
        && !current.composing
        && !current.capturePopover
        && !current.pendingMove
        && !current.loading
        && ['create', 'universal', 'guest_create'].includes(current.session.scope)
      ),
      onSuggest: handleTextSuggest,
    });
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
      // This branch returns before the end of init, so the timer must be armed
      // here too — the launcher link is the one most people install.
      startPolling();
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
    current.canvasHasThumbnail = Boolean(data && data.canvasHasThumbnail);
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
      current.loadError = friendlyAuthError(e);
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
function renderViewportBar(config, host) {
  if (!config || config.channel !== 'extension') return;
  const existing = document.getElementById('jiratack-viewport-bar');
  if (existing) existing.remove();

  const bar = document.createElement('div');
  bar.id = 'jiratack-viewport-bar';
  // The bar must survive the narrowest preset it offers: wrap rather than
  // overflow, and never exceed the viewport it is measuring.
  bar.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;display:flex;flex-wrap:wrap;gap:3px;align-items:center;padding:3px 5px;max-width:calc(100vw - 16px);box-sizing:border-box;border-radius:6px;background:#fff;color:#172b4d;color-scheme:light;border:1px solid #dfe1e6;box-shadow:0 4px 12px rgba(9,30,66,.2);font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;pointer-events:auto;';
  bar.title = 'Page width, sidebar excluded. Real layout, not device emulation.';

  // The extension refuses a size Chrome will not grant (a maximised or
  // full-screen window). Say so instead of letting the click look dead.
  if (!window.__jiratackResizeResultBound) {
    window.__jiratackResizeResultBound = true;
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== 'jiratack' || data.type !== 'resize-result') return;
      if (data.ok) return;
      showToast(data.message || 'Chrome refused the window size.');
    });
  }

  const buttonStyle = 'padding:2px 5px;min-width:30px;border:1px solid #dfe1e6;border-radius:3px;background:#fff;color:#172b4d;color-scheme:light;cursor:pointer;font:600 11px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
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
  custom.style.cssText = 'width:56px;padding:2px 4px;border:1px solid #dfe1e6;border-radius:3px;background:#fff;color:#172b4d;color-scheme:light;font:600 11px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
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

  (host || document.documentElement).appendChild(bar);
}

window.__jiratackInit = init;
window.__jiratackClose = close;
