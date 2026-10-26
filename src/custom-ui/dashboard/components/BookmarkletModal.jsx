import React, { useState } from 'react';
import { buildBookmarklet } from '../api';

export default function BookmarkletModal({ data, scope, onClose }) {
  const [copied, setCopied] = useState(false);
  const url = buildBookmarklet(data);
  const canvasName = data.canvasName || data.canvasId || 'Canvas';

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setCopied(false);
    }
  }

  return (
    <div className="jt-modal-backdrop" onClick={onClose}>
      <div className="jt-modal" onClick={(event) => event.stopPropagation()}>
        <h2>
          {scope === 'create'
            ? 'Write bookmarklet'
            : scope === 'universal'
              ? 'Universal launcher'
              : 'Review bookmarklet'}
        </h2>
        <p className="jt-modal-canvas">{canvasName}</p>

        {scope === 'create' ? (
          <p>Anyone with this bookmarklet can add pins to this canvas. Keep it in your bookmarks bar.</p>
        ) : scope === 'universal' ? (
          <p>
            This is your personal launcher. Click it on any page, then choose a canvas from the sidebar to view
            or add pins.
          </p>
        ) : (
          <p>Anyone with this bookmarklet can see all pins and summaries in this canvas. Share carefully.</p>
        )}

        <p className="jt-modal-instruction">Drag this button to your bookmarks bar.</p>

        <a
          className="jt-bookmarklet-link"
          href={url}
          draggable="true"
          title="Drag to your bookmarks bar"
        >
          📌 JiraTack
        </a>

        <div className="jt-modal-actions">
          <button type="button" className="jt-button jt-button-primary" onClick={copyUrl}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="jt-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
