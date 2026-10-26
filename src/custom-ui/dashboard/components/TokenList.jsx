import React from 'react';
import { formatDate } from '../api';

export default function TokenList({ tokens, onRevoke }) {
  if (!tokens || tokens.length === 0) {
    return <div className="jt-empty">No canvas tokens have been issued yet.</div>;
  }

  return (
    <table className="jt-table">
      <thead>
        <tr>
          <th>Scope</th>
          <th>User</th>
          <th>Canvas</th>
          <th>Issued</th>
          <th>Expires</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {tokens.map((entry) => (
          <tr key={entry.token}>
            <td>
              <span className={`jt-chip ${entry.scope === 'create' ? 'jt-chip-write' : ''}`}>
                {entry.scope === 'create' ? 'Write' : 'View'}
              </span>
            </td>
            <td className="jt-token-user">{entry.userId || '—'}</td>
            <td>{entry.canvasName}</td>
            <td>{formatDate(entry.issuedAt)}</td>
            <td>{formatDate(entry.expiresAt)}</td>
            <td>
              <button type="button" className="jt-button jt-button-danger" onClick={() => onRevoke(entry.token)}>
                Revoke access
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
