/**
 * Current-tab recording for the extension (D37).
 *
 * Chrome will not let a page skip the display picker for getDisplayMedia, so
 * the extension records the active tab through chrome.tabCapture instead. The
 * page world cannot call chrome APIs; this module talks to bridge.js, which
 * relays to the background worker and an offscreen doc.
 *
 * The bookmarklet has no extension APIs and keeps the display picker.
 */
const START_TIMEOUT_MS = 6000;

export function supportsTabRecording(config) {
  return Boolean(
    config
    && config.channel === 'extension'
    && typeof window !== 'undefined'
    && window.top === window,
  );
}

export function recordCurrentTab(options = {}) {
  const { onStatus, onResult, onError } = options;
  const requestId = `rec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let done = false;
  let started = false;
  let startTimer = null;
  let postTimer = null;
  let watchdog = null;

  function cleanup() {
    window.removeEventListener('message', onMessage);
    if (startTimer) {
      window.clearTimeout(startTimer);
      startTimer = null;
    }
    if (postTimer) {
      window.clearTimeout(postTimer);
      postTimer = null;
    }
    if (watchdog) {
      window.clearTimeout(watchdog);
      watchdog = null;
    }
  }

  function finish(dataUrl) {
    if (done) return;
    done = true;
    cleanup();
    if (onResult) onResult(dataUrl);
  }

  function fail(message) {
    if (done) return;
    done = true;
    cleanup();
    if (onError) onError(message);
  }

  function onMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'jiratack' || data.requestId !== requestId) return;

    if (data.type === 'jiratack-record-started') {
      started = true;
      if (startTimer) {
        window.clearTimeout(startTimer);
        startTimer = null;
      }
      if (onStatus) onStatus('recording');
      // The offscreen recorder caps at 60s; allow a margin for encoding.
      watchdog = window.setTimeout(() => {
        fail('The recording did not finish. Try again.');
      }, 70000);
      return;
    }
    if (data.type === 'jiratack-record-result') {
      finish(data.dataUrl || null);
      return;
    }
    if (data.type === 'jiratack-record-error') {
      fail(data.message || 'Recording failed.');
    }
  }

  window.addEventListener('message', onMessage);

  startTimer = window.setTimeout(() => {
    if (!started) fail('The current tab could not be recorded.');
  }, START_TIMEOUT_MS);

  // Defer so the returned controller exists before any synchronous failure.
  postTimer = window.setTimeout(() => {
    postTimer = null;
    if (done) return;
    try {
      window.postMessage({ source: 'jiratack', type: 'record-start', requestId }, '*');
    } catch (e) {
      fail('The current tab could not be recorded.');
    }
  }, 0);

  return {
    stop() {
      if (done) return;
      if (onStatus) onStatus('stopping');
      try {
        window.postMessage({ source: 'jiratack', type: 'record-stop', requestId }, '*');
      } catch (e) {
        // The extension was reloaded; the start timeout will report it.
      }
    },
    destroy() {
      if (done) return;
      try {
        window.postMessage({ source: 'jiratack', type: 'record-stop', requestId }, '*');
      } catch (e) {
        // ignore
      }
      done = true;
      cleanup();
    },
  };
}
