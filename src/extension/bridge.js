/**
 * Isolated-world bridge (plan 6.6).
 *
 * The SDK runs in the page's world by requirement, which means it cannot touch
 * extension APIs. Window sizing and current-tab recording are extension APIs, so
 * a request is posted across and relayed here. Payloads are validated on both
 * sides; recording is limited to start/stop and a known request id.
 */
window.addEventListener('message', function (event) {
  if (event.source !== window) return;
  var data = event.data;
  if (!data || data.source !== 'jiratack') return;

  if (data.type === 'record-start' || data.type === 'record-stop' || data.type === 'capture-tab') {
    if (typeof data.requestId !== 'string' || data.requestId.length < 6) return;
    var messageType = data.type === 'record-start'
      ? 'jiratack-record-start'
      : (data.type === 'record-stop' ? 'jiratack-record-stop' : 'jiratack-capture-tab');
    try {
      chrome.runtime.sendMessage({
        type: messageType,
        requestId: data.requestId,
      }, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) {
      // The extension was reloaded; the caller reports its own timeout.
    }
    return;
  }

  if (data.type === 'api-request') {
    // Relayed API call (D43): the SDK runs in the page's world, where a strict
    // connect-src policy can block its fetch. The isolated world is exempt.
    if (typeof data.requestId !== 'string' || data.requestId.length < 6) return;
    if (typeof data.apiUrl !== 'string') return;
    var headers = {};
    if (data.headers && typeof data.headers === 'object') {
      ['Content-Type', 'Authorization'].forEach(function (name) {
        var value = data.headers[name];
        if (typeof value === 'string' && value.length <= 8000) headers[name] = value;
      });
    }
    try {
      chrome.runtime.sendMessage({
        type: 'jiratack-api',
        requestId: data.requestId,
        apiUrl: data.apiUrl,
        payload: data.payload,
        headers: headers,
      }, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) {
      // The extension was reloaded; the caller times out.
    }
    return;
  }

  if (data.type === 'carry-overlay') {
    // The reviewer picked a ticket that lives on another URL. The background
    // re-injects the overlay on the next page (D40), but only for this
    // navigation: a plain link click elsewhere must not follow them around.
    try {
      chrome.runtime.sendMessage({
        type: 'jiratack-carry-overlay',
        url: typeof data.url === 'string' ? data.url : '',
      }, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) {
      // The extension was reloaded; the page still navigates.
    }
    return;
  }

  if (data.type !== 'resize') return;

  var width = data.width === null ? null : Number(data.width);
  if (width !== null && (!isFinite(width) || width < 320 || width > 2560)) return;

  var chromeWidth = Number(data.chromeWidth);
  var sidebarWidth = Number(data.sidebarWidth);
  try {
    chrome.runtime.sendMessage({
      type: 'jiratack-resize',
      width: width,
      chromeWidth: isFinite(chromeWidth) ? chromeWidth : 0,
      sidebarWidth: isFinite(sidebarWidth) ? sidebarWidth : 0,
    });
  } catch (e) {
    // The extension was reloaded; the page keeps working without presets.
  }
});

chrome.runtime.onMessage.addListener(function (message) {
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'jiratack-api-result') {
    window.postMessage({
      source: 'jiratack',
      type: 'api-result',
      requestId: message.requestId,
      ok: message.ok === true,
      status: message.status,
      body: message.body,
      text: message.text,
      contentType: message.contentType,
      error: message.error,
    }, '*');
    return;
  }
  if (message.type === 'jiratack-resize-result') {
    window.postMessage({
      source: 'jiratack',
      type: 'resize-result',
      ok: message.ok === true,
      width: message.width,
      message: message.message,
    }, '*');
    return;
  }
  if (message.type.indexOf('jiratack-record-') !== 0
    && message.type !== 'jiratack-capture-tab-result') return;
  window.postMessage({
    source: 'jiratack',
    type: message.type,
    requestId: message.requestId,
    dataUrl: message.dataUrl,
    message: message.message,
  }, '*');
});
