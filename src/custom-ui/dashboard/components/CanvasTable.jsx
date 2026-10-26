import React from 'react';
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

export default function CanvasTable({ canvases, hasAccess, onWrite, onReview, onOpenJira }) {
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
        {canvases.map((canvas) => (
          <tr key={canvas.canvasName}>
            <td className="jt-canvas-name">{canvas.canvasName}</td>
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
              <button
                type="button"
                className="jt-button"
                disabled={!hasAccess}
                title={hasAccess ? '' : 'Your Jira admin has not granted you access to JiraTack'}
                onClick={() => onWrite(canvas.canvasName)}
              >
                Get write bookmarklet
              </button>
              <button type="button" className="jt-button" onClick={() => onReview(canvas.canvasName)}>
                Copy review bookmarklet
              </button>
              <button type="button" className="jt-button" onClick={() => onOpenJira(canvas.canvasName)}>
                Open in Jira
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
