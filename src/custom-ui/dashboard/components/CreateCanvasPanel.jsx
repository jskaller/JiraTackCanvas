import React, { useEffect, useState } from 'react';
import { createCanvas, listAvailableTextFields } from '../api';
import FieldPrefillEditor from './FieldPrefillEditor';

/**
 * Inline create-canvas panel (D42): name, URL and the field ↔ value map.
 * No project picker — the seed ticket uses the installation's default project.
 */
export default function CreateCanvasPanel({ onCancel, onCreated }) {
  const [canvasName, setCanvasName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [availableFields, setAvailableFields] = useState([]);
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [fieldsError, setFieldsError] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    listAvailableTextFields()
      .then((result) => {
        if (!alive) return;
        const fields = result && result.ok && result.data ? result.data.fields || [] : [];
        setAvailableFields(fields);
        if (result && !result.ok) {
          setFieldsError((result.error && result.error.message) || 'Fields could not be loaded.');
        }
      })
      .catch(() => {
        if (alive) setFieldsError('Fields could not be loaded.');
      })
      .finally(() => {
        if (alive) setFieldsLoading(false);
      });
    return () => { alive = false; };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canvasName.trim()) {
      setError('Canvas name is required.');
      return;
    }
    const filled = rows.filter((row) => row.fieldId || row.value.trim());
    for (const row of filled) {
      if (!row.fieldId) {
        setError('Choose a Jira field for every pre-filled value.');
        return;
      }
      if (!row.value.trim()) {
        setError('Every chosen field needs a value.');
        return;
      }
    }

    const catalogue = new Map(availableFields.map((field) => [field.id, field.name]));
    const prefillFields = filled.map((row) => ({
      fieldId: row.fieldId,
      fieldName: catalogue.get(row.fieldId) || '',
      value: row.value.trim(),
    }));

    setBusy(true);
    setError(null);
    try {
      const result = await createCanvas(canvasName.trim(), targetUrl.trim(), prefillFields);
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
    <form className="jt-create-panel" onSubmit={handleSubmit}>
      <h3>New canvas</h3>
      <div className="jt-create-grid">
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
      </div>

      <details className="jt-accordion">
        <summary>Additional fields (optional)</summary>
        <FieldPrefillEditor
          availableFields={availableFields}
          rows={rows}
          onChange={setRows}
          loading={fieldsLoading}
          error={fieldsError}
        />
      </details>

      {error && <div className="jt-banner jt-banner-error">{error}</div>}

      <div className="jt-modal-actions">
        <button type="submit" className="jt-button jt-button-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create canvas'}
        </button>
        <button type="button" className="jt-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
