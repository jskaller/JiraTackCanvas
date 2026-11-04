/**
 * API transport (D43).
 *
 * The extension injects the SDK into the page's MAIN world, where the page's
 * `connect-src` CSP applies to its fetches — a strict site can block every API
 * call while the overlay itself works. The isolated-world bridge is exempt, so
 * the extension channel relays requests through it. The bookmarklet keeps a
 * normal fetch and reports the URL when the network refuses.
 */

const pending = new Map();
let sequence = 0;
let listening = false;

function makeResponse(data) {
  return {
    ok: data.ok === true,
    status: data.status || 0,
    headers: {
      get: (name) => (String(name).toLowerCase() === 'content-type' ? (data.contentType || '') : ''),
    },
    json: async () => data.body,
    text: async () => (typeof data.text === 'string' ? data.text : JSON.stringify(data.body)),
  };
}

function ensureListener() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'jiratack' || data.type !== 'api-result') return;
    const entry = pending.get(data.requestId);
    if (!entry) return;
    pending.delete(data.requestId);
    window.clearTimeout(entry.timer);
    if (data.error) {
      const error = new Error(data.error);
      error.code = 'BRIDGE_FETCH_FAILED';
      entry.reject(error);
      return;
    }
    entry.resolve(makeResponse(data));
  });
}

function bridgePost(apiUrl, payload, headers, timeoutMs) {
  ensureListener();
  return new Promise((resolve, reject) => {
    sequence += 1;
    const requestId = `api-${Date.now().toString(36)}-${sequence.toString(36)}`;
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      const error = new Error(`JiraTack could not reach ${apiUrl} through the extension bridge.`);
      error.code = 'BRIDGE_TIMEOUT';
      reject(error);
    }, typeof timeoutMs === 'number' ? timeoutMs : 20000);
    pending.set(requestId, { resolve, reject, timer });
    window.postMessage({
      source: 'jiratack',
      type: 'api-request',
      requestId,
      apiUrl,
      payload,
      headers: headers || {},
    }, '*');
  });
}

export async function postJson(config, payload, headers) {
  const requestHeaders = { 'Content-Type': 'application/json', ...(headers || {}) };
  if (config && config.channel === 'extension') {
    return bridgePost(config.apiUrl, payload, requestHeaders);
  }

  try {
    return await fetch(config.apiUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const error = new Error(
      `Could not reach ${config.apiUrl}. This is usually the page's security policy blocking requests to JiraTack, or a network problem. Open a working JiraTack bookmarklet on this page and click the toolbar button to reconnect.`,
    );
    error.code = 'NETWORK_UNREACHABLE';
    throw error;
  }
}
