/**
 * JiraTack extension shell (D32).
 *
 * The SDK is injected on demand rather than declared as a content script: the
 * bundle is ~290 KB and every open tab would pay for it while idle. A toolbar
 * click injects it into the tab's isolated world, which the page's CSP does not
 * govern — that exemption is the entire reason this channel exists (D22).
 *
 * `chrome.*` with callbacks is used deliberately: Chrome, Firefox and Safari
 * all accept it, whereas the promise form is uneven across Firefox MV3 and
 * older Safari.
 */
var CONFIG_KEY = 'jiratackConfig';

function withConfig(cb) {
  chrome.storage.local.get([CONFIG_KEY], function (result) {
    cb((result && result[CONFIG_KEY]) || null);
  });
}

function isActive(tabId, cb) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: 'MAIN',
    func: function () { return window.__jiratackActiveCanvas || null; },
  }, function (results) {
    if (chrome.runtime.lastError) { cb(null, chrome.runtime.lastError.message); return; }
    cb(results && results[0] ? results[0].result : null, null);
  });
}

function closeOverlay(tabId) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: 'MAIN',
    func: function () {
      if (typeof window.__jiratackClose === 'function') window.__jiratackClose();
    },
  }, function () {
    void chrome.runtime.lastError;
  });
}

function startOverlay(tabId, config) {
  // The bridge is isolated-world on purpose: the SDK cannot call chrome APIs.
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['bridge.js'],
  }, function () { void chrome.runtime.lastError; });

  chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: 'MAIN',
    files: ['sdk.js'],
  }, function () {
    if (chrome.runtime.lastError) return;
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: function (cfg) {
        if (typeof window.__jiratackInit !== 'function') return { ok: false, reason: 'sdk-missing' };
        if (window.__jiratackActiveCanvas) { window.__jiratackClose(); return { ok: true, closed: true }; }
        window.__jiratackInit(Object.assign({}, cfg, { channel: 'extension' }));
        return { ok: true };
      },
      args: [config],
    }, function () {
      void chrome.runtime.lastError;
    });
  });
}

// Remember each window's original width so "Fit" can put it back.
var previousWidths = {};

chrome.runtime.onMessage.addListener(function (message, sender) {
  if (!message || message.type !== 'jiratack-resize' || !sender || !sender.tab) return;
  var windowId = sender.tab.windowId;

  if (message.width === null) {
    var restore = previousWidths[windowId];
    if (restore) {
      chrome.windows.update(windowId, { width: restore }, function () { void chrome.runtime.lastError; });
      delete previousWidths[windowId];
    }
    return;
  }

  var width = Number(message.width);
  if (!isFinite(width) || width < 320 || width > 2560) return;
  var chromeWidth = Number(message.chromeWidth) || 0;
  var sidebarWidth = Number(message.sidebarWidth) || 0;

  chrome.windows.get(windowId, function (current) {
    if (chrome.runtime.lastError || !current) return;
    if (!previousWidths[windowId]) previousWidths[windowId] = current.width;
    chrome.windows.update(windowId, { width: Math.round(width + chromeWidth + sidebarWidth) }, function () {
      void chrome.runtime.lastError;
    });
  });
});

chrome.action.onClicked.addListener(function (tab) {
  if (!tab || !tab.id) return;
  isActive(tab.id, function (active, error) {
    // Restricted pages (chrome://, the Web Store, PDF viewer) refuse injection.
    if (error) return;
    if (active) { closeOverlay(tab.id); return; }
    withConfig(function (config) {
      if (!config) { chrome.runtime.openOptionsPage(); return; }
      startOverlay(tab.id, config);
    });
  });
});
