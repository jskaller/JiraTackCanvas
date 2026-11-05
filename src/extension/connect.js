/**
 * Jira-origin relay for the extension sign-in (D46).
 *
 * The JiraTack dashboard renders inside a Forge iframe, so it cannot call
 * `chrome.*`. It posts its request to the parent window; this relay forwards it
 * to the background worker — which owns the network call and the storage write —
 * and posts the answer back to the exact frame that asked.
 *
 * Declared for Jira origins only. It is also re-injected by `onInstalled` into
 * tabs that were already open when the extension was installed, because a
 * declared content script is not retroactively added to loaded pages. The guard
 * below makes that second injection a no-op.
 */
(function () {
  if (window.__jiratackConnectRelay) return;
  window.__jiratackConnectRelay = true;

  // The dashboard is served from an Atlassian app domain, the page itself is
  // the Jira site. Anything else is not ours to answer.
  function trustedOrigin(origin) {
    if (!origin) return false;
    if (origin === window.location.origin) return true;
    return /^https:\/\/([a-z0-9-]+\.)*(atlassian\.net|atlassian\.com|atlassian-dev\.net)$/i.test(origin);
  }

  function reply(source, origin, payload) {
    try {
      source.postMessage(payload, origin || '*');
    } catch (e) {
      // The frame navigated away; the caller times out and reports that.
    }
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.source !== 'jiratack') return;
    // Only a child frame may ask; the top page talking to itself is not a
    // dashboard and must not be able to drive the extension.
    if (!event.source || event.source === window) return;
    if (!trustedOrigin(event.origin)) return;

    if (data.type === 'jiratack-extension-ping') {
      reply(event.source, event.origin, {
        source: 'jiratack',
        type: 'jiratack-extension-pong',
        requestId: data.requestId || null,
      });
      return;
    }

    if (data.type !== 'jiratack-extension-connect') return;
    if (typeof data.requestId !== 'string' || data.requestId.length < 6) return;

    var answer = function (result) {
      reply(event.source, event.origin, {
        source: 'jiratack',
        type: 'jiratack-extension-connect-result',
        requestId: data.requestId,
        ok: Boolean(result && result.ok),
        displayName: result && result.displayName ? result.displayName : null,
        error: (result && result.reason) || null,
      });
    };

    try {
      chrome.runtime.sendMessage({
        type: 'jiratack-connect',
        apiUrl: data.apiUrl,
        code: data.code,
      }, function (response) {
        void chrome.runtime.lastError;
        answer(response);
      });
    } catch (e) {
      // The extension was reloaded under the page.
      answer({ ok: false, reason: 'The extension was reloaded. Try again.' });
    }
  });
})();
