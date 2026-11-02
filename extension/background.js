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
    func: function () { return window.__jiratackActiveCanvas || null; },
  }, function (results) {
    if (chrome.runtime.lastError) { cb(null, chrome.runtime.lastError.message); return; }
    cb(results && results[0] ? results[0].result : null, null);
  });
}

function closeOverlay(tabId) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function () {
      if (typeof window.__jiratackClose === 'function') window.__jiratackClose();
    },
  }, function () {
    void chrome.runtime.lastError;
  });
}

function startOverlay(tabId, config) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['sdk.js'],
  }, function () {
    if (chrome.runtime.lastError) return;
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function (cfg) {
        if (typeof window.__jiratackInit !== 'function') return { ok: false, reason: 'sdk-missing' };
        if (window.__jiratackActiveCanvas) { window.__jiratackClose(); return { ok: true, closed: true }; }
        window.__jiratackInit(cfg);
        return { ok: true };
      },
      args: [config],
    }, function () {
      void chrome.runtime.lastError;
    });
  });
}

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
