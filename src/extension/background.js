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

// A page running the bookmarklet exposes the same config it bootstrapped with
// (src/bookmarklet/index.js picks a safe, token-bearing view). The extension
// enrolls itself from it — no bookmark paste — and it also repairs a stale
// stored config: whichever source still exchanges successfully wins (D39).

function pickEnrollConfig(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  var out = {};
  var keys = ['token', 'apiUrl', 'sdkUrl', 'canvasId', 'canvasName', 'sdkVersion'];
  for (var i = 0; i < keys.length; i++) {
    if (typeof candidate[keys[i]] === 'string') out[keys[i]] = candidate[keys[i]];
  }
  if (!out.token || !out.apiUrl || !/^https:\/\//i.test(out.apiUrl)) return null;
  return out;
}

function configDiffers(a, b) {
  if (!a || !b) return true;
  return a.apiUrl !== b.apiUrl || a.token !== b.token;
}

// When a config is already stored, a candidate from another origin cannot
// replace it — an attacker page could otherwise appoint its own canvas to the
// extension. A moved JiraTack webtrigger stays on the same host, so legitimate
// repairs still pass (D39).
function sameOrigin(a, b) {
  if (!a || !b) return true;
  try {
    return new URL(a.apiUrl).origin === new URL(b.apiUrl).origin;
  } catch (e) {
    return false;
  }
}

// Supplied configs are only trusted after the real API accepts the token: an
// exchange against the submitted apiUrl either succeeds for the whole config
// or the config is rejected. This is what makes the page-supplied path safe.
function validateEnrollConfig(config, cb) {
  fetch(config.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'exchangeToken', payload: { canvasToken: config.token } }),
  }).then(function (response) {
    return response.json().then(function (body) {
      if (body && body.ok === true) {
        cb(true, null);
      } else {
        cb(false, (body && body.error && body.error.message) || 'The API rejected this token.');
      }
    }, function () {
      cb(false, 'The endpoint answered with something other than the JiraTack API.');
    });
  }, function () {
    cb(false, 'The endpoint could not be reached.');
  });
}

function readPageEnroll(tabId, cb) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: 'MAIN',
    func: function () {
      // D43: the guest invite page publishes the config itself, so enrollment no
      // longer needs a live overlay on the page. The candidate still has to win
      // a real exchange before it is stored.
      if (!window.__jiratackConfig) return null;
      return {
        config: window.__jiratackConfig,
        overlayLive: Boolean(window.__jiratackActiveCanvas),
      };
    },
  }, function (results) {
    if (chrome.runtime.lastError) { cb(null); return; }
    cb(results && results[0] ? results[0].result : null);
  });
}

// Flow 1 (D46). Only the Jira pages the relay runs on, plus the extension's own
// pages (the options page may reconnect), may ask for a sign-in exchange.
function trustedSender(sender) {
  var url = sender && sender.url ? String(sender.url) : '';
  if (/^(chrome-extension|moz-extension):\/\//i.test(url)) return true;
  return /^https:\/\/([a-z0-9-]+\.)*(atlassian\.net|atlassian\.com|atlassian-dev\.net)(\/|$)/i.test(url);
}

// Trade the dashboard's one-time code for the credential the SDK already knows
// how to use. The layout is identical to a pasted canvas link, so nothing
// downstream changes — only how the credential arrives.
function connectExtension(message, sendResponse) {
  var apiUrl = typeof message.apiUrl === 'string' ? message.apiUrl : '';
  var code = typeof message.code === 'string' ? message.code : '';
  // Production endpoints are HTTPS. Loopback HTTP exists only so the extension
  // harness can drive this path without a certificate.
  var acceptable = /^https:\/\//i.test(apiUrl)
    || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(apiUrl);

  if (!acceptable || !/^[a-f0-9]{64}$/.test(code)) {
    sendResponse({ ok: false, reason: 'That connection request was not valid.' });
    return;
  }

  fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'exchangeLoginCode', payload: { code: code } }),
  }).then(function (response) {
    return response.json().then(function (body) { return body; }, function () { return null; });
  }).then(function (body) {
    if (!body || body.ok !== true) {
      sendResponse({
        ok: false,
        reason: (body && body.error && body.error.message) || 'JiraTack rejected the sign-in.',
      });
      return;
    }
    var data = body.data || {};
    if (!data.token) {
      sendResponse({ ok: false, reason: 'JiraTack did not return a credential.' });
      return;
    }
    var config = {
      token: data.token,
      apiUrl: data.apiUrl || apiUrl,
      sdkUrl: data.sdkUrl || '',
      // The launcher: the signed-in user may reach every canvas the server
      // permits, so the extension is not bound to one canvas.
      canvasId: 'universal',
      canvasName: 'JiraTack',
      sdkVersion: data.currentSdkVersion || '',
      accountId: data.accountId || null,
      displayName: data.displayName || null,
      connectedVia: 'extension_login',
    };
    chrome.storage.local.set({ jiratackConfig: config }, function () {
      sendResponse({ ok: true, displayName: config.displayName, accountId: config.accountId });
    });
  }, function () {
    sendResponse({ ok: false, reason: 'The JiraTack API could not be reached.' });
  });
}

// A declared content script is not added to pages that were already open when
// the extension was installed. The user is asked to return to the JiraTack tab
// after installing, so inject the relay there now rather than making them
// reload and wonder why nothing happened.
function installRelayIntoOpenTabs() {
  if (!chrome.scripting || !chrome.tabs) return;
  chrome.tabs.query({
    url: ['https://*.atlassian.net/*', 'https://*.hello.atlassian-dev.net/*'],
  }, function (tabs) {
    void chrome.runtime.lastError;
    (tabs || []).forEach(function (tab) {
      if (!tab || !tab.id) return;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['connect.js'],
      }, function () {
        void chrome.runtime.lastError;
      });
    });
  });
}

chrome.runtime.onInstalled.addListener(function () {
  installRelayIntoOpenTabs();
});

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
  delete carryOverlay[tabId];
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

function sendToTab(tabId, payload) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, payload, function () {
    void chrome.runtime.lastError;
  });
}

function reportResize(tabId, ok, width, message) {
  sendToTab(tabId, {
    type: 'jiratack-resize-result',
    ok: ok === true,
    width: width === null || width === undefined ? null : Number(width),
    message: message || '',
  });
}

function ensureOffscreen(cb) {
  if (!chrome.offscreen) {
    cb(false);
    return;
  }
  chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Record the current tab as ticket evidence',
  }, function () {
    var error = chrome.runtime.lastError;
    // A second start reuses the existing document. Any other failure is real.
    if (error && !/single offscreen/i.test(error.message || '')) {
      cb(false);
      return;
    }
    cb(true);
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

// Zero-click enrollment from an allowed web origin (D43). The page still has to
// present a config the real API accepts, and an existing installation can only
// be replaced with the same-origin rule (otherwise it becomes a pending choice
// on the options page).
chrome.runtime.onMessageExternal.addListener(function (message, sender, sendResponse) {
  if (!message || message.type !== 'jiratack-enroll') return false;
  var candidate = pickEnrollConfig(message.config);
  if (!candidate) { sendResponse({ ok: false, reason: 'invalid' }); return false; }
  withConfig(function (stored) {
    if (stored && !sameOrigin(candidate, stored)) {
      chrome.storage.local.set({ jiratackPendingConfig: candidate });
      sendResponse({ ok: false, reason: 'different-installation' });
      return;
    }
    validateEnrollConfig(candidate, function (ok) {
      if (!ok) { sendResponse({ ok: false, reason: 'rejected' }); return; }
      chrome.storage.local.set({ jiratackConfig: candidate }, function () {
        sendResponse({ ok: true });
      });
    });
  });
  return true;
});

// Remember each window's original width so "Fit" can put it back.
var previousWidths = {};

// Tabs where the reviewer asked the overlay to survive one navigation (D40).
// Cleared as soon as it is used, so normal browsing never carries it along.
var carryOverlay = {};

chrome.tabs.onRemoved.addListener(function (tabId) {
  delete carryOverlay[tabId];
  delete previousWidths[tabId];
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (!changeInfo || changeInfo.status !== 'complete') return;
  if (!carryOverlay[tabId]) return;
  var carry = carryOverlay[tabId];
  delete carryOverlay[tabId];

  chrome.tabs.get(tabId, function (tab) {
    if (chrome.runtime.lastError || !tab) return;
    var url = String(tab.url || '');
    if (!/^https?:\/\//i.test(url)) return;
    // A page the extension cannot touch (chrome://, the Web Store, a PDF).
    if (/^(chrome|edge|about|view-source|devtools):/i.test(url) || url.indexOf('chrome-extension://') === 0) return;

    withConfig(function (config) {
      if (!config) return;
      // Never re-inject into a tab whose overlay survived (an in-page router).
      isActive(tabId, function (active, error) {
        if (error || active) return;
        startOverlay(tabId, config);
      });
    });
  });
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message) return;

  // Flow 1 (D46): the Jira relay asks the background to sign this browser in.
  // Returning true keeps the channel open for the async reply.
  if (message.type === 'jiratack-connect') {
    if (!trustedSender(sender)) {
      sendResponse({ ok: false, reason: 'Untrusted origin.' });
      return false;
    }
    connectExtension(message, sendResponse);
    return true;
  }

  if (message.type === 'jiratack-capture-tab' && sender && sender.tab) {
    // captureVisibleTab always captures the active tab; make sure it is the
    // tab that owns this overlay, even if the reviewer switched away.
    chrome.tabs.update(sender.tab.id, { active: true }, function () {
      void chrome.runtime.lastError;
      chrome.windows.update(sender.tab.windowId, { focused: true }, function () {
        void chrome.runtime.lastError;
        chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, function (dataUrl) {
          var error = chrome.runtime.lastError;
          sendToTab(sender.tab.id, {
            type: 'jiratack-capture-tab-result',
            requestId: message.requestId,
            dataUrl: error ? null : (dataUrl || null),
          });
        });
      });
    });
    return;
  }

  if (message.type === 'jiratack-record-start' && sender && sender.tab) {
    var tabId = sender.tab.id;
    var requestId = message.requestId;
    ensureOffscreen(function (ok) {
      if (!ok) {
        sendToTab(tabId, {
          type: 'jiratack-record-error',
          requestId: requestId,
          message: 'Current-tab recording is not available in this browser.',
        });
        return;
      }
      if (!chrome.tabCapture) {
        sendToTab(tabId, {
          type: 'jiratack-record-error',
          requestId: requestId,
          message: 'Current-tab recording is not available in this browser.',
        });
        return;
      }
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, function (streamId) {
        var error = chrome.runtime.lastError;
        if (error || !streamId) {
          sendToTab(tabId, {
            type: 'jiratack-record-error',
            requestId: requestId,
            message: error ? error.message : 'The current tab could not be captured.',
          });
          return;
        }
        chrome.runtime.sendMessage({
          type: 'jiratack-offscreen-start',
          streamId: streamId,
          requestId: requestId,
          tabId: tabId,
        }, function () {
          void chrome.runtime.lastError;
        });
      });
    });
    return;
  }

  if (message.type === 'jiratack-record-stop' && sender && sender.tab) {
    chrome.runtime.sendMessage({
      type: 'jiratack-offscreen-stop',
      requestId: message.requestId,
      tabId: sender.tab.id,
    }, function () {
      void chrome.runtime.lastError;
    });
    return;
  }

  if (message.type === 'jiratack-offscreen-started'
    || message.type === 'jiratack-offscreen-result'
    || message.type === 'jiratack-offscreen-error') {
    sendToTab(message.tabId, {
      type: message.type.replace('jiratack-offscreen-', 'jiratack-record-'),
      requestId: message.requestId,
      dataUrl: message.dataUrl,
      message: message.message,
    });
    return;
  }

  if (message.type === 'jiratack-replace-config') {
    chrome.storage.local.get(['jiratackPendingConfig'], function (result) {
      var candidate = result && result.jiratackPendingConfig;
      if (!candidate) return;
      validateEnrollConfig(candidate, function (ok) {
        if (!ok) return;
        chrome.storage.local.set({ jiratackConfig: candidate }, function () {
          chrome.storage.local.remove(['jiratackPendingConfig']);
        });
      });
    });
    return;
  }

  if (message.type === 'jiratack-api' && sender && sender.tab) {
    var apiTabId = sender.tab.id;
    var apiRequestId = message.requestId;
    var apiUrl = typeof message.apiUrl === 'string' ? message.apiUrl : '';
    withConfig(function (stored) {
      // Only the configured endpoint: a page cannot use this as an open proxy.
      if (!stored || !stored.apiUrl || apiUrl !== stored.apiUrl) {
        sendToTab(apiTabId, {
          type: 'jiratack-api-result',
          requestId: apiRequestId,
          error: 'That endpoint is not the configured JiraTack API.',
        });
        return;
      }
      fetch(apiUrl, {
        method: 'POST',
        headers: message.headers && typeof message.headers === 'object' ? message.headers : { 'Content-Type': 'application/json' },
        body: JSON.stringify(message.payload || {}),
      }).then(function (response) {
        return response.text().then(function (text) {
          var body = null;
          try { body = JSON.parse(text); } catch (e) { body = null; }
          sendToTab(apiTabId, {
            type: 'jiratack-api-result',
            requestId: apiRequestId,
            ok: response.ok,
            status: response.status,
            body: body,
            text: text,
            contentType: (response.headers && response.headers.get('content-type')) || '',
          });
        });
      }, function (error) {
        sendToTab(apiTabId, {
          type: 'jiratack-api-result',
          requestId: apiRequestId,
          error: (error && error.message) || 'The request failed.',
        });
      });
    });
    return;
  }

  if (message.type === 'jiratack-carry-overlay' && sender && sender.tab) {
    carryOverlay[sender.tab.id] = { url: message.url || '' };
    return;
  }

  if (message.type !== 'jiratack-resize' || !sender || !sender.tab) return;
  var windowId = sender.tab.windowId;

  if (message.width === null) {
    var restore = previousWidths[windowId];
    if (restore) {
      // Fit must undo both things a preset can change: the width and the
      // window state (a preset normalises a maximised/full-screen window).
      chrome.windows.update(windowId, { state: 'normal', width: restore.width }, function () {
        void chrome.runtime.lastError;
        if (restore.state && restore.state !== 'normal') {
          chrome.windows.update(windowId, { state: restore.state }, function () {
            void chrome.runtime.lastError;
          });
        }
      });
      delete previousWidths[windowId];
    }
    return;
  }

  var width = Number(message.width);
  if (!isFinite(width) || width < 320 || width > 2560) return;
  var chromeWidth = Number(message.chromeWidth) || 0;
  var sidebarWidth = Number(message.sidebarWidth) || 0;
  var reportTabId = sender.tab.id;

  chrome.windows.get(windowId, function (current) {
    if (chrome.runtime.lastError || !current) {
      reportResize(reportTabId, false, null, 'The browser window could not be read.');
      return;
    }
    if (!previousWidths[windowId]) {
      previousWidths[windowId] = { width: current.width, state: current.state || 'normal' };
    }
    var target = Math.round(width + chromeWidth + sidebarWidth);

    function apply() {
      chrome.windows.update(windowId, { width: target }, function () {
        var updateError = chrome.runtime.lastError;
        // Chrome ignores `width` on a maximised or full-screen window, and it
        // says nothing when it does. Re-read the window and tell the page, so a
        // preset that cannot apply is visible instead of silently dead.
        chrome.windows.get(windowId, function (after) {
          var refused = Boolean(updateError) || !after
            || Math.abs(Number(after.width) - target) > 4;
          if (refused) {
            reportResize(
              reportTabId,
              false,
              after ? after.width : null,
              'Chrome refused the window size — the window may be maximised or full-screen.',
            );
          } else {
            reportResize(reportTabId, true, after.width, '');
          }
        });
      });
    }

    // A maximised/full-screen window ignores width changes, so normalise the
    // state first. The original state is remembered and Fit puts it back.
    if (current.state && current.state !== 'normal') {
      chrome.windows.update(windowId, { state: 'normal' }, function () {
        void chrome.runtime.lastError;
        apply();
      });
      return;
    }
    apply();
  });
});

chrome.action.onClicked.addListener(function (tab) {
  if (!tab || !tab.id) return;
  isActive(tab.id, function (active, error) {
    // Restricted pages (chrome://, the Web Store, PDF viewer) refuse injection.
    if (error) return;
    if (active) { closeOverlay(tab.id); return; }

    withConfig(function (stored) {
      readPageEnroll(tab.id, function (page) {
        var candidate = page && pickEnrollConfig(page.config);

        // Page config wins when it differs from what is stored: the overlay on
        // this page is demonstrably working, so a diverging stored config is
        // the stale one (a moved webtrigger URL, an old canvas link).
        if (candidate && configDiffers(candidate, stored)) {
          if (stored && !sameOrigin(candidate, stored)) {
            // A different origin cannot take over an existing installation
            // silently (D39). Keep the stored config running and let the
            // reviewer confirm a replacement on the options page (D43).
            chrome.storage.local.set({ jiratackPendingConfig: candidate }, function () {
              chrome.runtime.openOptionsPage();
            });
            return;
          }
          validateEnrollConfig(candidate, function (ok, reason) {
            if (!ok) {
              // Keep the stored config; the page's copy could not be verified.
              if (stored) { startOverlay(tab.id, stored); return; }
              chrome.runtime.openOptionsPage();
              return;
            }
            chrome.storage.local.set({ jiratackConfig: candidate }, function () {
              startOverlay(tab.id, candidate);
            });
          });
          return;
        }

        if (stored) { startOverlay(tab.id, stored); return; }

        // Nothing stored and no working overlay on the page: give up gracefully.
        if (!candidate) { chrome.runtime.openOptionsPage(); return; }
      });
    });
  });
});
