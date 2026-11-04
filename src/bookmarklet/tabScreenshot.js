/**
 * Visible-tab screenshot for the extension (fast path).
 *
 * html2canvas clones the whole document and is expensive on heavy pages. When
 * the overlay runs in the extension, the background can capture the visible tab
 * directly. The page hides its own chrome, waits a frame, asks the bridge, and
 * crops the returned image around the click.
 */
const TIMEOUT_MS = 600;

export function supportsTabScreenshot(config) {
  return Boolean(
    config
    && config.channel === 'extension'
    && config.tabScreenshot !== false
    && typeof window !== 'undefined'
    && window.top === window,
  );
}

export function captureVisibleTab() {
  return new Promise((resolve) => {
    const requestId = `shot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let done = false;

    function finish(dataUrl) {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(dataUrl || null);
    }

    function onMessage(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== 'jiratack' || data.requestId !== requestId) return;
      if (data.type === 'jiratack-capture-tab-result') finish(data.dataUrl);
    }

    const timer = window.setTimeout(() => finish(null), TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    try {
      window.postMessage({ source: 'jiratack', type: 'capture-tab', requestId }, '*');
    } catch (e) {
      finish(null);
    }
  });
}
