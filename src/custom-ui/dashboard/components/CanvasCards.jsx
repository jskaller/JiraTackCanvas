import React from 'react';
import { formatDate } from '../api';
import { openExternal } from '../external';

/**
 * Pastel-style canvas cards (D43 follow-up).
 *
 * The title is a link to the canvas's primary URL, the card is image-shaped
 * with the actions/meta on a darkened hover overlay, and "Open canvas" sits in
 * the middle. There is deliberately no third-party screenshot service: a
 * thumbnail only appears when JiraTack itself captured one (`canvas.thumbnail`),
 * otherwise the card shows the hostname. Server-side capture of an arbitrary
 * URL needs infrastructure a Forge app does not have.
 */

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

export default function CanvasCards({ canvases, archivedView, jiraBaseUrl, onOpenCanvas, onOpenFields, onOpenJira, onArchive, onDelete }) {
  if (!canvases || canvases.length === 0) {
    return <div className="jt-empty">No canvases match.</div>;
  }

  return (
    <div className="jt-card-grid">
      {canvases.map((canvas) => {
        const pageUrl = canvas.urls && canvas.urls[0] ? canvas.urls[0].url : null;
        return (
          <article className="jt-canvas-card" key={canvas.canvasKey}>
            {pageUrl ? (
              <a
                className="jt-card-title"
                href={pageUrl}
                title={pageUrl}
                onClick={(event) => {
                  event.preventDefault();
                  openExternal(pageUrl);
                }}
              >
                {canvas.canvasName}
              </a>
            ) : (
              <span className="jt-card-title">{canvas.canvasName}</span>
            )}

            <div className="jt-card-shot">
              {canvas.thumbnail ? (
                <img className="jt-card-shot-img" src={canvas.thumbnail} alt="" loading="lazy" />
              ) : (
                <div className="jt-card-shot-empty">
                  <span className="jt-card-host">{hostOf(pageUrl) || 'No pages yet'}</span>
                  {pageUrl && <span className="jt-card-hint">No preview captured</span>}
                </div>
              )}

              <div className="jt-card-overlay">
                <button
                  type="button"
                  className="jt-card-open"
                  onClick={() => onOpenCanvas(canvas)}
                >
                  Open canvas
                </button>

                <div className="jt-card-overlay-meta">
                  <span className="jt-card-key">{canvas.canvasKey}</span>
                  <span>{canvas.openCount} open / {canvas.ticketCount} total</span>
                  <span>{canvas.urlCount} {canvas.urlCount === 1 ? 'page' : 'pages'}</span>
                  <span>{formatDate(canvas.lastUpdated)}</span>
                </div>

                <div className="jt-card-overlay-actions">
                  <button type="button" onClick={() => onOpenFields(canvas)}>Fields</button>
                  {jiraBaseUrl && (
                    <button type="button" onClick={() => onOpenJira(canvas)}>View tickets</button>
                  )}
                  {!archivedView && (
                    <button type="button" onClick={() => onArchive(canvas)}>Archive</button>
                  )}
                  <button type="button" className="jt-danger" onClick={() => onDelete(canvas)}>
                    {archivedView ? 'Permanently delete' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
