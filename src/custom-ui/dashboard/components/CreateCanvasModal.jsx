import React, { useState } from 'react';
import { createCanvas } from '../api';

export default function CreateCanvasModal({ onClose, onCreated }) {
  const [canvasName, setCanvasName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canvasName.trim()) {
      setError('Canvas name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await createCanvas(canvasName.trim(), targetUrl.trim());
      if (result && result.ok && result.data) {
        if (onCreated) onCreated(result.data);
      } else {
        setError((result && result.error && result.error.message) || 'Failed to create canvas.');
      }
    } catch (e) {
      setError(e && e.message ? e.message : 'Failed to create canvas.');
    }
    setBusy(false);
  }

  return (
    <div className="jt-modal-backdrop" onClick={onClose}>
      <form
        className="jt-modal jt-modal-small"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>Create New Canvas</h2>

        <label className="jt-form-field">
          <span>Canvas name</span>
          <input
            className="jt-input"
            value={canvasName}
            onChange={(event) => setCanvasName(event.target.value)}
            placeholder="e.g. Q3 Marketing"
            autoFocus
          />
        </label>

        <label className="jt-form-field">
          <span>Target URL (optional)</span>
          <input
            className="jt-input"
            value={targetUrl}
            onChange={(event) => setTargetUrl(event.target.value)}
            placeholder="https://example.com/page"
          />
        </label>

        {error && <div className="jt-banner jt-banner-error">{error}</div>}

        <div className="jt-modal-actions">
          <button type="submit" className="jt-button jt-button-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create canvas'}
          </button>
          <button type="button" className="jt-button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
