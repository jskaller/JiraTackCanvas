import React, { useState } from 'react';
import { generateUserToken } from '../api';

/**
 * Bookmark scope (D43): selected canvases by default (guests usually want a
 * narrow bookmark), with an "all canvases" option that stays current as new
 * canvases appear.
 */
export default function BookmarkScopeDrawer({ canvases, onClose, onGenerated }) {
  const active = (canvases || []).filter((canvas) => canvas.archived !== true);
  const [scope, setScope] = useState('selected');
  const [selected, setSelected] = useState(() => new Set());
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const toggle = (name) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const visible = active.filter((canvas) => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return true;
    return String(canvas.canvasName || '').toLowerCase().includes(needle)
      || String(canvas.canvasKey || '').toLowerCase().includes(needle);
  });

  async function handleGenerate() {
    if (scope === 'selected' && selected.size === 0) {
      setError('Choose at least one canvas, or allow all canvases.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await generateUserToken(scope === 'selected' ? Array.from(selected) : undefined);
      if (result && result.ok && result.data) {
        if (onGenerated) onGenerated(result.data, scope);
      } else {
        setError((result && result.error && result.error.message) || 'Failed to generate the bookmark.');
      }
    } catch (e) {
      setError(e && e.message ? e.message : 'Failed to generate the bookmark.');
    }
    setBusy(false);
  }

  return (
    <div className="jt-drawer-backdrop" onClick={onClose}>
      <div className="jt-drawer" onClick={(event) => event.stopPropagation()}>
        <h2>Get bookmark</h2>
        <p className="jt-muted">
          Choose which canvases this bookmark can open. You can regenerate it at any time.
        </p>

        <label className="jt-radio-row">
          <input type="radio" checked={scope === 'selected'} onChange={() => setScope('selected')} />
          <span><strong>Selected canvases</strong> — a fixed list, best for guest-style use</span>
        </label>
        <label className="jt-radio-row">
          <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />
          <span><strong>All canvases</strong> — always current, including canvases added later</span>
        </label>

        {scope === 'selected' && (
          <>
            <input
              className="jt-input"
              type="search"
              placeholder="Filter canvases…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <div className="jt-checkbox-list">
              {visible.length === 0 ? (
                <div className="jt-muted">No canvases match.</div>
              ) : visible.map((canvas) => (
                <label className="jt-checkbox-row" key={canvas.canvasKey || canvas.canvasName}>
                  <input
                    type="checkbox"
                    checked={selected.has(canvas.canvasName)}
                    onChange={() => toggle(canvas.canvasName)}
                  />
                  <span className="jt-checkbox-label">
                    {canvas.canvasName}
                    {canvas.canvasKey ? <span className="jt-key-inline"> · {canvas.canvasKey}</span> : null}
                  </span>
                  <span className="jt-muted">{canvas.ticketCount || 0}</span>
                </label>
              ))}
            </div>
            <p className="jt-muted">
              {selected.size} selected. New canvases will not appear until you regenerate this bookmark.
            </p>
          </>
        )}

        {error && <div className="jt-banner jt-banner-error">{error}</div>}

        <div className="jt-modal-actions">
          <button type="button" className="jt-button jt-button-primary" onClick={handleGenerate} disabled={busy}>
            {busy ? 'Generating…' : 'Generate bookmark'}
          </button>
          <button type="button" className="jt-button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
