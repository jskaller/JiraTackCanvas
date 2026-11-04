import React from 'react';

/**
 * Canvas field pre-fill rows (D41).
 *
 * `availableFields` is the project's configured text fields; the dropdown is
 * limited to them, so a creator can only pre-fill what an admin made available.
 * Rendered inside a closed `<details>` by the modals so the form stays compact.
 */
export default function FieldPrefillEditor({ availableFields, rows, onChange, loading, error }) {
  const fields = availableFields || [];

  function update(index, patch) {
    onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  }

  function add() {
    onChange([...rows, { key: `prefill-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, fieldId: '', value: '' }]);
  }

  function remove(index) {
    onChange(rows.filter((_, at) => at !== index));
  }

  if (!loading && fields.length === 0) {
    return (
      <p className="jt-prefill-empty">
        No text fields are available for this project yet. An admin can add them under
        {' '}<strong>Project settings → JiraTack</strong>.
      </p>
    );
  }

  return (
    <div className="jt-prefill">
      {loading && <p className="jt-prefill-empty">Loading fields…</p>}
      {error && <div className="jt-banner jt-banner-error">{error}</div>}

      {!loading && fields.length > 0 && rows.length === 0 && (
        <p className="jt-prefill-empty">No pre-filled fields on this canvas.</p>
      )}

      {rows.map((row, index) => (
        <div className="jt-prefill-row" key={row.key || index}>
          <select
            className="jt-input jt-prefill-field"
            value={row.fieldId}
            onChange={(event) => update(index, { fieldId: event.target.value })}
            aria-label="Jira field"
          >
            <option value="">Choose a field…</option>
            {fields.map((field) => (
              <option key={field.id} value={field.id}>{field.name}</option>
            ))}
          </select>
          <input
            className="jt-input jt-prefill-value"
            value={row.value}
            onChange={(event) => update(index, { value: event.target.value })}
            placeholder="Value, e.g. https://figma.com/file/…"
            aria-label="Pre-filled value"
          />
          <button
            type="button"
            className="jt-button jt-prefill-remove"
            onClick={() => remove(index)}
            aria-label="Remove pre-filled field"
          >
            Remove
          </button>
        </div>
      ))}

      {!loading && fields.length > 0 && (
        <button
          type="button"
          className="jt-button jt-prefill-add"
          onClick={add}
          disabled={rows.length >= 10}
        >
          Add field
        </button>
      )}

      <p className="jt-prefill-hint">
        Values are written to the chosen field when it is on the Create screen for the
        ticket's type; otherwise they are added to the description.
      </p>
    </div>
  );
}
