import React, { useState } from 'react';
import { generateGuestToken } from '../api';

export default function GuestLinkModal({ canvases, defaultCanvas, onClose }) {
  const [selected, setSelected] = useState(() => new Set(defaultCanvas ? [defaultCanvas] : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  function toggle(canvasName) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(canvasName)) {
        next.delete(canvasName);
      } else {
        next.add(canvasName);
      }
      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const permittedCanvases = Array.from(selected);
    if (permittedCanvases.length === 0) {
      setError('Select at least one canvas.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await generateGuestToken(permittedCanvases);
      if (!response || !response.ok || !response.data) {
        setError((response && response.error && response.error.message) || 'Failed to generate guest link.');
      } else if (!response.data.installerUrl) {
        setError(
          'The guest token was created, but the installer URL is unavailable. Deploy the app and try again.',
        );
      } else {
        setResult(response.data);
      }
    } catch (e) {
      setError(e && e.message ? e.message : 'Failed to generate guest link.');
    }
    setBusy(false);
  }

  async function copyUrl() {
    if (!result || !result.installerUrl) return;
    try {
      await navigator.clipboard.writeText(result.installerUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setCopied(false);
    }
  }

  return (
    <div className="jt-modal-backdrop" onClick={onClose}>
      <form
        className="jt-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>Generate Guest Link</h2>

        {result ? (
          <>
            <p className="jt-modal-canvas">Guest canvases: {result.permittedCanvases.join(', ')}</p>
            <p>
              Send this link to your client. They will use it to install the review bookmark.
            </p>
            <textarea
              className="jt-bookmarklet-url"
              readOnly
              rows={3}
              value={result.installerUrl}
              onFocus={(event) => event.target.select()}
            />
            <div className="jt-modal-actions">
              <button type="button" className="jt-button jt-button-primary" onClick={copyUrl}>
                {copied ? 'Copied' : 'Copy to Clipboard'}
              </button>
              <button type="button" className="jt-button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="jt-modal-canvas">Choose which canvases this guest can view and add pins to.</p>

            <div className="jt-checkbox-list">
              {canvases.length === 0 ? (
                <div className="jt-muted">No active canvases.</div>
              ) : (
                canvases.map((canvas) => (
                  <label className="jt-checkbox-row" key={canvas.canvasName}>
                    <input
                      type="checkbox"
                      checked={selected.has(canvas.canvasName)}
                      onChange={() => toggle(canvas.canvasName)}
                    />
                    <span className="jt-checkbox-label">{canvas.canvasName}</span>
                    <span className="jt-muted">
                      {canvas.ticketCount || 0} {canvas.ticketCount === 1 ? 'ticket' : 'tickets'}
                    </span>
                  </label>
                ))
              )}
            </div>

            {error && <div className="jt-banner jt-banner-error">{error}</div>}

            <div className="jt-modal-actions">
              <button
                type="submit"
                className="jt-button jt-button-primary"
                disabled={busy || canvases.length === 0}
              >
                {busy ? 'Generating…' : 'Generate link'}
              </button>
              <button type="button" className="jt-button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
