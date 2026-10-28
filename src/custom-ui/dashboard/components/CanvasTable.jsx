import React, { useState } from 'react';
import { formatDate } from '../api';

function ProjectSpan({ projectKeys }) {
  if (!projectKeys || projectKeys.length === 0) return <span className="jt-muted">—</span>;
  if (projectKeys.length === 1) return <span className="jt-chip">{projectKeys[0]}</span>;
  return (
    <span className="jt-chip" title={projectKeys.join(', ')}>
      {projectKeys.length} projects
    </span>
  );
}

function Participants({ participants }) {
  if (!participants || participants.length === 0) return <span className="jt-muted">—</span>;
  return (
    <div className="jt-avatars">
      {participants.map((person) => {
        const label = person.displayName || person.accountId || '?';
        if (person.avatarUrl) {
          return (
            <img
              key={person.accountId}
              className="jt-avatar"
              src={person.avatarUrl}
              alt={label}
              title={label}
            />
          );
        }
        return (
          <span key={person.accountId} className="jt-avatar jt-avatar-fallback" title={label}>
            {label.slice(0, 1).toUpperCase()}
          </span>
        );
      })}
    </div>
  );
}

export default function CanvasTable({ canvases, onOpenJira, onDelete, onArchive, archivedView }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [copiedUrl, setCopiedUrl] = useState(null);

  function toggle(canvasName) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(canvasName)) {
        next.delete(canvasName);
      } else {
        next.add(canvasName);
      }
      return next;
    });
  }

  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      window.setTimeout(() => {
        setCopiedUrl((current) => (current === url ? null : current));
      }, 1500);
    } catch (e) {
      setCopiedUrl(null);
    }
  }

  if (!canvases || canvases.length === 0) {
    return (
      <div className="jt-empty">
        No canvases yet. Create a ticket with a new canvas name in the JiraTack Canvas field and it will appear
        here automatically.
      </div>
    );
  }

  return (
    <table className="jt-table">
      <thead>
        <tr>
          <th>Canvas</th>
          <th>Projects</th>
          <th>Open / total</th>
          <th>URLs</th>
          <th>Last updated</th>
          <th>Participants</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {canvases.map((canvas) => {
          const isExpanded = expanded.has(canvas.canvasName);
          const urls = canvas.urls || [];

          return (
            <React.Fragment key={canvas.canvasName}>
              <tr>
                <td className="jt-canvas-name">
                  <button
                    type="button"
                    className="jt-expand"
                    aria-expanded={isExpanded}
                    title={isExpanded ? 'Hide pages' : 'Show pages'}
                    onClick={() => toggle(canvas.canvasName)}
                  >
                    {isExpanded ? '▾' : '▸'}
                  </button>
                  {urls.length > 0 ? (
                    <a
                      className="jt-canvas-link"
                      href={urls[0].url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open original page"
                    >
                      {canvas.canvasName} <span className="jt-external-icon">↗</span>
                    </a>
                  ) : (
                    canvas.canvasName
                  )}
                </td>
                <td>
                  <ProjectSpan projectKeys={canvas.projectKeys} />
                </td>
                <td>
                  {canvas.openCount} / {canvas.ticketCount}
                </td>
                <td>{canvas.urlCount}</td>
                <td>{formatDate(canvas.lastUpdated)}</td>
                <td>
                  <Participants participants={canvas.participants} />
                </td>
                <td className="jt-actions">
                  <button type="button" className="jt-button" onClick={() => onOpenJira(canvas)}>
                    Review All Tickets
                  </button>
                  {archivedView ? (
                    <button
                      type="button"
                      className="jt-button jt-button-danger"
                      onClick={() => onDelete(canvas.canvasName)}
                    >
                      Permanently Delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="jt-button"
                      onClick={() => onArchive(canvas.canvasName)}
                    >
                      Archive Canvas
                    </button>
                  )}
                </td>
              </tr>

              {isExpanded && (
                <tr className="jt-url-row">
                  <td colSpan={7}>
                    <div className="jt-url-list">
                      <div className="jt-url-title">Pages ({urls.length})</div>
                      {urls.length === 0 ? (
                        <div className="jt-muted">No URLs recorded for this canvas.</div>
                      ) : (
                        urls.map((item) => (
                          <div className="jt-url-item" key={item.url}>
                            <a href={item.url} target="_blank" rel="noopener noreferrer">
                              {item.url}
                            </a>
                            <span className="jt-url-count">
                              ({item.ticketCount} {item.ticketCount === 1 ? 'ticket' : 'tickets'})
                            </span>
                            <button
                              type="button"
                              className="jt-copy"
                              title="Copy URL"
                              onClick={() => copyUrl(item.url)}
                            >
                              {copiedUrl === item.url ? '✓' : '⧉'}
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
