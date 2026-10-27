import React, { useCallback, useEffect, useState } from 'react';
import { router } from '@forge/bridge';
import { aggregate, generateUserToken, buildJqlUrl, deleteCanvas, archiveCanvas } from './api';
import CanvasTable from './components/CanvasTable';
import BookmarkletModal from './components/BookmarkletModal';
import RecoveryPanel from './components/RecoveryPanel';
import ConfirmDialog from './components/ConfirmDialog';
import CreateCanvasModal from './components/CreateCanvasModal';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [canvases, setCanvases] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [jiraBaseUrl, setJiraBaseUrl] = useState(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [universalLoading, setUniversalLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [viewArchived, setViewArchived] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const aggregateResult = await aggregate();
      console.log('Dashboard data:', aggregateResult);

      if (aggregateResult && aggregateResult.ok && aggregateResult.data) {
        setCanvases(aggregateResult.data.canvases || []);
        setIsAdmin(Boolean(aggregateResult.data.isAdmin));
        setJiraBaseUrl(aggregateResult.data.jiraBaseUrl || null);
      } else {
        setError(
          (aggregateResult && aggregateResult.error && aggregateResult.error.message)
            || 'Failed to load canvases.',
        );
        setCanvases([]);
      }
    } catch (e) {
      console.error('Failed to load dashboard:', e);
      setError(e && e.message ? e.message : String(e));
      setCanvases([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUniversalBookmarklet() {
    setUniversalLoading(true);
    setActionError(null);
    try {
      const result = await generateUserToken();
      if (result && result.ok && result.data) {
        setModal({
          data: { ...result.data, canvasId: 'universal', canvasName: 'JiraTack Launcher' },
          scope: 'universal',
        });
      } else {
        setActionError({
          message:
            (result && result.error && result.error.message) || 'Failed to generate universal bookmarklet.',
        });
      }
    } catch (e) {
      setActionError({ message: e && e.message ? e.message : String(e) });
    }
    setUniversalLoading(false);
  }

  function handleOpenJira(canvasName) {
    const url = buildJqlUrl(jiraBaseUrl, canvasName);
    if (!url) {
      setActionError({ canvasName, message: 'Jira base URL is unavailable.' });
      return;
    }
    router.open(url);
  }

  function handleArchiveCanvas(canvasName) {
    setConfirm({
      kind: 'archive',
      canvasName,
      title: 'Archive canvas',
      message:
        'The canvas will be hidden from the dashboard and launcher. Jira tickets are not changed. You can permanently delete it later from the archived view.',
      confirmLabel: 'Archive canvas',
      destructive: false,
    });
  }

  function handleDeleteCanvas(canvasName) {
    setConfirm({
      kind: 'delete',
      canvasName,
      title: 'Permanently delete canvas',
      message:
        'This permanently removes the canvas from JiraTack. It is only allowed when every ticket in the canvas is Done. Jira tickets themselves are not deleted.',
      confirmLabel: 'Permanently delete',
      destructive: true,
    });
  }

  async function confirmAction() {
    if (!confirm) return;
    const canvasName = confirm.canvasName;
    const kind = confirm.kind;
    setConfirm(null);
    setActionError(null);
    try {
      const result = kind === 'archive'
        ? await archiveCanvas(canvasName)
        : await deleteCanvas(canvasName);
      if (!result || !result.ok) {
        setActionError({
          canvasName,
          message:
            (result && result.error && result.error.message)
            || (kind === 'archive' ? 'Failed to archive canvas.' : 'Failed to delete canvas.'),
        });
        return;
      }
      load();
    } catch (e) {
      setActionError({ canvasName, message: e && e.message ? e.message : String(e) });
    }
  }

  const visibleCanvases = canvases.filter((canvas) =>
    viewArchived ? canvas.archived === true : canvas.archived !== true,
  );

  const filteredCanvases = visibleCanvases.filter((canvas) =>
    canvas.canvasName.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className="jt-app">
      <header className="jt-header">
        <div>
          <h1>JiraTack Canvases</h1>
          <p className="jt-subtitle">
            Pick a canvas to review its pages, or create a new one to start pinning.
          </p>
        </div>
        <button
          type="button"
          className="jt-button jt-button-primary jt-universal-button"
          disabled={universalLoading}
          onClick={handleUniversalBookmarklet}
        >
          {universalLoading ? 'Generating…' : 'Get JiraTack Bookmarklet'}
        </button>
      </header>

      <div className="jt-toolbar">
        <input
          className="jt-search"
          type="search"
          placeholder="Search canvases…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {!viewArchived && (
          <button type="button" className="jt-button jt-button-primary" onClick={() => setCreateOpen(true)}>
            Create New Canvas
          </button>
        )}
        <button
          type="button"
          className="jt-button"
          onClick={() => setViewArchived((current) => !current)}
        >
          {viewArchived ? 'View Active Canvases' : 'View Archived Canvases'}
        </button>
      </div>

      {actionError && (
        <div className="jt-banner jt-banner-error">
          {actionError.canvasName ? <strong>{actionError.canvasName}: </strong> : null}
          {actionError.message}
        </div>
      )}

      {error && <div className="jt-banner jt-banner-error">{error}</div>}

      <section className="jt-section">
        <h2>{viewArchived ? 'Archived Canvases' : 'Canvases'}</h2>
        {loading ? (
          <div className="jt-empty">Loading canvases…</div>
        ) : visibleCanvases.length === 0 ? (
          <div className="jt-empty">
            <div>
              {viewArchived
                ? 'No archived canvases.'
                : 'No canvases yet. Use Create New Canvas to make your first one.'}
            </div>
            {!viewArchived && isAdmin && (
              <div className="jt-empty-hint">
                If older JiraTack tickets are missing their canvas fields, use Maintenance below to recover
                them.
              </div>
            )}
          </div>
        ) : (
          <CanvasTable
            canvases={filteredCanvases}
            onOpenJira={handleOpenJira}
            onDelete={handleDeleteCanvas}
            onArchive={handleArchiveCanvas}
            archivedView={viewArchived}
          />
        )}
      </section>

      {isAdmin && <RecoveryPanel onRecovered={load} />}

      {modal && (
        <BookmarkletModal data={modal.data} scope={modal.scope} onClose={() => setModal(null)} />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          destructive={confirm.destructive}
          onConfirm={confirmAction}
          onCancel={() => setConfirm(null)}
        />
      )}

      {createOpen && (
        <CreateCanvasModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}
