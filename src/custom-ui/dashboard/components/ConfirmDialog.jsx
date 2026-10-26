import React from 'react';

export default function ConfirmDialog({ title, message, confirmLabel, destructive, onConfirm, onCancel }) {
  return (
    <div className="jt-modal-backdrop" onClick={onCancel}>
      <div className="jt-modal jt-modal-small" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="jt-modal-actions">
          <button
            type="button"
            className={`jt-button ${destructive ? 'jt-button-danger' : 'jt-button-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel || 'Confirm'}
          </button>
          <button type="button" className="jt-button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
