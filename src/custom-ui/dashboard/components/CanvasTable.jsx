import React, { useState } from 'react';
import { formatDate } from '../api';
import { toSafeHttpUrl } from '@shared/safeUrl';
import { openExternal } from '../external';

function SafeLink({ url, children, className, title }) {
  const safe = toSafeHttpUrl(url);
  if (!safe) {
    return <span className={className} title={title}>{children}</span>;
  }
  return (
    <a
      className={className}
      href={safe}
      title={title}
      onClick={(event) => {
        event.preventDefault();
        openExternal(safe);
      }}
    >
      {children}
    </a>
  );
}

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

export default function CanvasTable({ canvases, onOpenCanvas, onOpenFields, onOpenJira, onDelete, onArchive, archivedView }) {
  const [expanded, setExpanded] = useState(() => new Set());

  function toggle(key) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (!canvases || canvases.length === 0) {
    return <div className="jt-empty">No canvases match.</div>;
  }

  return (
    <table className="jt-table">
      <thead>
        <tr>
          <th>Canvas</th>
          <th>Key</th>
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
          const isExpanded = expanded.has(canvas.canvasKey);
          const urls = canvas.urls || [];

          return (
            <React.Fragment key={canvas.canvasKey}>
              <tr>
                <td className="jt-canvas-name">
                  <button
                    type="button"
                    className="jt-expand"
                    aria-expanded={isExpanded}
                    title={isExpanded ? 'Hide pages' : 'Show pages'}
                    onClick={() => toggle(canvas.canvasKey)}
                  >
                    {isExpanded ? '▾' : '▸'}
                  </button>
                  <button
                    type="button"
                    className="jt-link-button jt-canvas-link"
                    onClick={() => onOpenCanvas(canvas)}
                    title="Open canvas"
                  >
                    {canvas.canvasName}
                  </button>
                </td>
                <td><span className="jt-chip">{canvas.canvasKey}</span></td>
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
                  <button type="button" className="jt-button" onClick={() => onOpenFields(canvas)}>
                    Fields
                  </button>
                  <button type="button" className="jt-button" onClick={() => onOpenJira(canvas)}>
                    Review All Tickets
                  </button>
                  {archivedView ? (
                    <button
                      type="button"
                      className="jt-button jt-button-danger"
                      onClick={() => onDelete(canvas)}
                    >
                      Permanently Delete
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="jt-button"
                        onClick={() => onArchive(canvas)}
                      >
                        Archive
                      </button>
                      <button
                        type="button"
                        className="jt-button jt-button-danger"
                        onClick={() => onDelete(canvas)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>

              {isExpanded && (
                <tr className="jt-url-row">
                  <td colSpan={8}>
                    <div className="jt-url-list">
                      <div className="jt-url-title">Pages ({urls.length})</div>
                      {urls.length === 0 ? (
                        <div className="jt-muted">No URLs recorded for this canvas.</div>
                      ) : (
                        urls.map((item) => (
                          <div className="jt-url-item" key={item.url}>
                            <SafeLink url={item.url}>{item.url}</SafeLink>
                            <span className="jt-url-count">
                              ({item.ticketCount} {item.ticketCount === 1 ? 'ticket' : 'tickets'})
                            </span>
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
