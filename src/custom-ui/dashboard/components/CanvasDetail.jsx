import React, { useEffect, useState } from 'react';
import {
  getCanvasConfig,
  setCanvasConfig,
  listAvailableTextFields,
  renameCanvas,
  assignCanvasFolder,
  clearCanvasPreview,
} from '../api';
import FieldPrefillEditor from './FieldPrefillEditor';
import { toSafeHttpUrl } from '@shared/safeUrl';
import { openExternal } from '../external';

/**
 * Canvas detail: Pages | Fields | Access (D42).
 *
 * The canvas key is the identity; the name is an editable label. Fields are the
 * per-canvas pre-fills, chosen from the installation catalogue.
 */
export default function CanvasDetail({ canvas, initialTab, folders, jiraBaseUrl, buildJqlUrl, onBack, onRefresh, onOpenJira, onGuestLink }) {
  const [tab, setTab] = useState(initialTab === 'fields' ? 'fields' : 'pages');
  const [name, setName] = useState(canvas.canvasName);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState(null);
  const [folderName, setFolderName] = useState(canvas.folder || '');
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState(null);
  const [previewNote, setPreviewNote] = useState(null);
  const [previewCaptured, setPreviewCaptured] = useState(null);
  const [previewReason, setPreviewReason] = useState(null);

  const [availableFields, setAvailableFields] = useState([]);
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [fieldsError, setFieldsError] = useState(null);
  const [rows, setRows] = useState([]);
  const [fieldsBusy, setFieldsBusy] = useState(false);
  const [fieldsSaved, setFieldsSaved] = useState(false);

  useEffect(() => {
    setName(canvas.canvasName);
    setFolderName(canvas.folder || '');
  }, [canvas.canvasName, canvas.folder]);

  useEffect(() => {
    if (initialTab === 'fields') setTab('fields');
  }, [initialTab]);

  useEffect(() => {
    let alive = true;
    setFieldsLoading(true);
    Promise.all([listAvailableTextFields(), getCanvasConfig(canvas.canvasKey)])
      .then(([catalogue, stored]) => {
        if (!alive) return;
        const fields = catalogue && catalogue.ok && catalogue.data ? catalogue.data.fields || [] : [];
        setAvailableFields(fields);
        if (catalogue && !catalogue.ok) {
          setFieldsError((catalogue.error && catalogue.error.message) || 'Fields could not be loaded.');
        }
        if (stored && stored.ok && stored.data) {
          setPreviewCaptured(Boolean(stored.data.thumbnailCaptured));
          setPreviewReason(stored.data.thumbnailNote || null);
        }
        const prefill = stored && stored.ok && stored.data ? stored.data.prefillFields || [] : [];
        setRows(prefill.map((field, index) => ({
          key: `stored-${index}`,
          fieldId: field.fieldId || '',
          value: field.value || '',
        })));
      })
      .catch(() => {
        if (alive) setFieldsError('Fields could not be loaded.');
      })
      .finally(() => {
        if (alive) setFieldsLoading(false);
      });
    return () => { alive = false; };
  }, [canvas.canvasKey]);

  async function handleRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === canvas.canvasName) return;
    setRenameBusy(true);
    setRenameError(null);
    try {
      const result = await renameCanvas(canvas.canvasKey, trimmed);
      if (result && result.ok) {
        onRefresh();
      } else {
        setRenameError((result && result.error && result.error.message) || 'Could not rename.');
      }
    } catch (e) {
      setRenameError(e && e.message ? e.message : 'Could not rename.');
    }
    setRenameBusy(false);
  }

  async function handleMoveFolder() {
    setFolderBusy(true);
    setFolderError(null);
    try {
      const result = await assignCanvasFolder(canvas.canvasKey, folderName.trim());
      if (result && result.ok) {
        onRefresh();
      } else {
        setFolderError((result && result.error && result.error.message) || 'Could not move the canvas.');
      }
    } catch (e) {
      setFolderError(e && e.message ? e.message : 'Could not move the canvas.');
    }
    setFolderBusy(false);
  }

  async function handleClearPreview() {
    setPreviewNote(null);
    try {
      const result = await clearCanvasPreview(canvas.canvasKey);
      if (result && result.ok) {
        // Reflect the clear immediately: the status line is the whole point of
        // this control, so it must not keep claiming an image is stored.
        setPreviewCaptured(false);
        setPreviewReason(null);
        setPreviewNote('Preview cleared. The next ticket on this canvas captures a new one.');
        onRefresh();
      } else {
        setPreviewNote((result && result.error && result.error.message) || 'Could not clear the preview.');
      }
    } catch (e) {
      setPreviewNote(e && e.message ? e.message : 'Could not clear the preview.');
    }
  }

  async function handleSaveFields() {
    const filled = rows.filter((row) => row.fieldId || row.value.trim());
    for (const row of filled) {
      if (!row.fieldId) {
        setFieldsError('Choose a Jira field for every pre-filled value.');
        return;
      }
      if (!row.value.trim()) {
        setFieldsError('Every chosen field needs a value.');
        return;
      }
    }
    const catalogue = new Map(availableFields.map((field) => [field.id, field.name]));
    const prefillFields = filled.map((row) => ({
      fieldId: row.fieldId,
      fieldName: catalogue.get(row.fieldId) || '',
      value: row.value.trim(),
    }));

    setFieldsBusy(true);
    setFieldsError(null);
    setFieldsSaved(false);
    try {
      const result = await setCanvasConfig(canvas.canvasKey, prefillFields);
      if (result && result.ok) {
        setFieldsSaved(true);
      } else {
        setFieldsError((result && result.error && result.error.message) || 'Could not save fields.');
      }
    } catch (e) {
      setFieldsError(e && e.message ? e.message : 'Could not save fields.');
    }
    setFieldsBusy(false);
  }

  return (
    <section className="jt-canvas-page">
      <button type="button" className="jt-button jt-back" onClick={onBack}>
        ← All canvases
      </button>

      <header className="jt-canvas-head">
        <div className="jt-canvas-title">
          <h2>{canvas.canvasName}</h2>
          <span className="jt-chip">{canvas.canvasKey}</span>
        </div>
        <div className="jt-canvas-meta">
          {canvas.openCount} open / {canvas.ticketCount} total · {canvas.urlCount} {canvas.urlCount === 1 ? 'page' : 'pages'}
          {' · '}
          preview {previewCaptured === null ? 'unknown' : (previewCaptured ? 'stored' : 'not captured')}
        </div>
      </header>

      <div className="jt-folder-row">
        <span className="jt-form-label">Folder</span>
        <input
          className="jt-input"
          list="jt-folder-options"
          value={folderName}
          placeholder="No folder"
          onChange={(event) => setFolderName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              handleMoveFolder();
            }
          }}
        />
        <datalist id="jt-folder-options">
          {(folders || []).map((name) => <option key={name} value={name} />)}
        </datalist>
        <button
          type="button"
          className="jt-button"
          onClick={handleMoveFolder}
          disabled={folderBusy || folderName.trim() === (canvas.folder || '')}
        >
          {folderBusy ? 'Moving…' : 'Move'}
        </button>
      </div>
      {folderError && <div className="jt-banner jt-banner-error">{folderError}</div>}

      <div className="jt-tabs" role="tablist">
        {[
          ['pages', `Pages (${canvas.urlCount})`],
          ['fields', 'Fields'],
          ['access', 'Access'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`jt-tab${tab === id ? ' jt-tab-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'pages' && (
        <div className="jt-tab-body">
          {(canvas.urls || []).length === 0 ? (
            <div className="jt-muted">No pages yet. Create a pin to record one.</div>
          ) : (
            (canvas.urls || []).map((item) => (
              <div className="jt-url-item" key={item.url}>
                {toSafeHttpUrl(item.url) ? (
                  <a
                    href={toSafeHttpUrl(item.url)}
                    onClick={(event) => {
                      event.preventDefault();
                      openExternal(item.url);
                    }}
                  >{item.url}</a>
                ) : (
                  <span>{item.url}</span>
                )}
                <span className="jt-url-count">
                  ({item.ticketCount} {item.ticketCount === 1 ? 'ticket' : 'tickets'})
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'fields' && (
        <div className="jt-tab-body">
          <div className="jt-preview-status">
            <strong>Card preview:</strong>{' '}
            {previewCaptured === null
              ? 'state unavailable'
              : (previewCaptured ? 'stored for this canvas' : 'not captured yet')}
            <button type="button" className="jt-link-button" onClick={handleClearPreview}>
              Clear
            </button>
          </div>
          {previewCaptured === false && previewReason && (
            <p className="jt-muted">Last attempt: {previewReason}</p>
          )}
          {previewNote && <p className="jt-muted">{previewNote}</p>}

          <label className="jt-form-field">
            <span>Canvas name</span>
            <div className="jt-rename-row">
              <input
                className="jt-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleRename();
                  }
                }}
              />
              <button
                type="button"
                className="jt-button"
                onClick={handleRename}
                disabled={renameBusy || !name.trim() || name.trim() === canvas.canvasName}
              >
                {renameBusy ? 'Renaming…' : 'Rename'}
              </button>
            </div>
          </label>
          {renameError && <div className="jt-banner jt-banner-error">{renameError}</div>}

          <h3 className="jt-subhead">Pre-filled fields</h3>
          <p className="jt-muted">
            Values are added to every new ticket on this canvas. A value is written to the field
            when it is on the Create screen for the ticket's type; otherwise it goes into the
            description.
          </p>
          <FieldPrefillEditor
            availableFields={availableFields}
            rows={rows}
            onChange={setRows}
            loading={fieldsLoading}
            error={fieldsError}
          />
          {fieldsSaved && <div className="jt-banner jt-banner-success">Saved.</div>}
          <div className="jt-modal-actions">
            <button type="button" className="jt-button jt-button-primary" onClick={handleSaveFields} disabled={fieldsBusy}>
              {fieldsBusy ? 'Saving…' : 'Save fields'}
            </button>
          </div>


        </div>
      )}

      {tab === 'access' && (
        <div className="jt-tab-body">
          <h3 className="jt-subhead">Share this canvas</h3>
          <div className="jt-access-row">
            <button type="button" className="jt-button" onClick={() => onOpenJira(canvas)}>
              Open tickets in Jira
            </button>
            <button type="button" className="jt-button" onClick={() => onGuestLink()}>
              Invite a guest
            </button>
          </div>
          <p className="jt-muted">
            The bookmarklet and extension are generated from the <strong>Install JiraTack</strong>
            {' '}section above; select this canvas there to keep the link scoped to it.
          </p>
        </div>
      )}
    </section>
  );
}
