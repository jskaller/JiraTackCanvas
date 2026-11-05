import React, { useState } from 'react';
import { generateGuestToken } from '../api';

export default function GuestLinkModal({ canvases, defaultCanvas, mode, onClose }) {
  const extension = mode === 'extension';
  const [selected, setSelected] = useState(() => new Set(defaultCanvas ? [defaultCanvas] : []));
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [filter, setFilter] = useState('');

  const allSelected = canvases.length > 0 && selected.size === canvases.length;
  const linkFor = (value) => {
    if (!value || !value.installerUrl) return '';
    if (!extension) return value.installerUrl;
    return `${value.installerUrl}${value.installerUrl.includes('?') ? '&' : '?'}mode=extension`;
  };

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(canvases.map((canvas) => canvas.canvasName)));
  }

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
    const name = guestName.trim();
    const email = guestEmail.trim();
    if (permittedCanvases.length === 0) {
      setError('Select at least one canvas.');
      return;
    }
    if (name.length === 0) {
      setError('Enter the guest\u2019s name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid guest email address.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await generateGuestToken({ permittedCanvases, guestName: name, guestEmail: email });
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

  function emailUrl() {
    if (!result || !result.installerUrl) return;
    const to = result.guestEmail || guestEmail;
    const name = result.guestName || guestName || 'there';
    const subject = 'Your JiraTack review link';
    const how = extension
      ? 'Install the JiraTack extension, come back to the link, and click Connect this browser. If the link does not fill it in, enter this guest code:'
      : 'Open this link and drag the JiraTack button to your bookmarks bar. If the link does not fill it in, enter this guest code:';
    const codeLine = result.code ? `\n\nGuest code: ${result.code}` : '';
    const body = `Hi ${name},\n\nHere is your JiraTack review link. ${how}${codeLine}\n\n${linkFor(result)}\n\nThe link is valid for 90 days.`;
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function copyCode() {
    if (!result || !result.code) return;
    try {
      await navigator.clipboard.writeText(result.code);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 2000);
    } catch (e) {
      setCodeCopied(false);
    }
  }

  async function copyUrl() {
    if (!result || !result.installerUrl) return;
    try {
      await navigator.clipboard.writeText(linkFor(result));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setCopied(false);
    }
  }

  return (
    <div className="jt-drawer-backdrop" onClick={onClose}>
      <form
        className="jt-drawer"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>{extension ? 'Guest extension link' : 'Guest bookmark link'}</h2>

        {result ? (
          <>
            <p className="jt-modal-canvas">
              Invited: {result.guestName || guestName} &lt;{result.guestEmail || guestEmail}&gt;
            </p>
            <p className="jt-modal-canvas">Guest canvases: {result.permittedCanvases.join(', ')}</p>
            {result.code && (
              <div className="jt-guest-code">
                <span className="jt-form-label">Guest code</span>
                <code>{result.code}</code>
                <button type="button" className="jt-button" onClick={copyCode}>
                  {codeCopied ? 'Copied' : 'Copy code'}
                </button>
              </div>
            )}
            <p>
              {extension
                ? 'Send this link to your client. They install the JiraTack extension, open the link and click Connect this browser. The link fills the code in; they can also type it.'
                : 'Send this link to your client. They open it and drag the JiraTack button to their bookmarks bar. The link fills the code in; they can also type it.'}
            </p>
            <textarea
              className="jt-bookmarklet-url"
              readOnly
              rows={3}
              value={linkFor(result)}
              onFocus={(event) => event.target.select()}
            />
            <div className="jt-modal-actions">
              <button type="button" className="jt-button jt-button-primary" onClick={copyUrl}>
                {copied ? 'Copied' : 'Copy to Clipboard'}
              </button>
              <button type="button" className="jt-button" onClick={emailUrl}>
                Email link
              </button>
              <button type="button" className="jt-button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="jt-modal-canvas">
              Name the reviewer, then choose which canvases they can view and add pins to.
              {extension ? ' The link also connects the JiraTack browser extension.' : ''}
            </p>
            <input
              className="jt-input"
              type="search"
              placeholder="Filter canvases…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault();
              }}
            />

            <div className="jt-form-row">
              <span className="jt-form-label">Guest name</span>
              <input
                className="jt-input"
                type="text"
                value={guestName}
                maxLength={200}
                placeholder="Jane Doe"
                onChange={(event) => setGuestName(event.target.value)}
              />
            </div>
            <div className="jt-form-row">
              <span className="jt-form-label">Guest email</span>
              <input
                className="jt-input"
                type="email"
                value={guestEmail}
                maxLength={320}
                placeholder="jane@example.com"
                onChange={(event) => setGuestEmail(event.target.value)}
              />
            </div>

            <div className="jt-checkbox-list">
              {canvases.length > 0 && (
                <label className="jt-checkbox-row">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                  <span className="jt-checkbox-label">All canvases</span>
                  <span className="jt-muted">
                    {selected.size} of {canvases.length} selected
                  </span>
                </label>
              )}
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
