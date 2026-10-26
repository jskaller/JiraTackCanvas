import React, { useCallback, useEffect, useState } from 'react';
import { router } from '@forge/bridge';
import { aggregate, generateToken, generateUserToken, buildJqlUrl } from './api';
import CanvasTable from './components/CanvasTable';
import BookmarkletModal from './components/BookmarkletModal';
import ConfirmDialog from './components/ConfirmDialog';
import RecoveryPanel from './components/RecoveryPanel';
import CreateCanvasModal from './components/CreateCanvasModal';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [canvases, setCanvases] = useState([]);
  const [hasAccess, setHasAccess] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [jiraBaseUrl, setJiraBaseUrl] = useState(null);
  const [canvasFieldId, setCanvasFieldId] = useState(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [universalLoading, setUniversalLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const aggregateResult = await aggregate();
      console.log('Dashboard data:', aggregateResult);

      if (aggregateResult && aggregateResult.ok && aggregateResult.data) {
        setCanvases(aggregateResult.data.canvases || []);
        setHasAccess(aggregateResult.data.hasAccess !== false);
        setIsAdmin(Boolean(aggregateResult.data.isAdmin));
        setJiraBaseUrl(aggregateResult.data.jiraBaseUrl || null);
        setCanvasFieldId(aggregateResult.data.canvasFieldId || null);
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

  async function issueToken(canvasName, scope) {
    setActionError(null);
    try {
      const result = await generateToken(canvasName, scope);
      if (result && result.ok && result.data) {
        setModal({ data: result.data, scope });
        return;
      }
      const err = result && result.error;
      if (err && err.code === 'NO_CANVAS_ACCESS') {
        setActionError({
          canvasName,
          message:
            "You don't have access to any project in this canvas. Ask the canvas owner to grant access, or ask a licensed team member with access to share their view bookmarklet.",
        });
      } else if (err && err.code === 'LICENSE_INACTIVE') {
        setActionError({
          canvasName,
          message: 'Your Jira admin has not granted you access to JiraTack.',
        });
      } else {
        setActionError({
          canvasName,
          message: (err && err.message) || 'Failed to generate bookmarklet.',
        });
      }
    } catch (e) {
      setActionError({ canvasName, message: e && e.message ? e.message : String(e) });
    }
  }

  function handleWrite(canvasName) {
    issueToken(canvasName, 'create');
  }

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

  function handleReview(canvasName) {
    setConfirm({
      kind: 'review',
      canvasName,
      title: 'Copy review bookmarklet',
      message:
        'Review bookmarklets show pins from projects the viewer can browse. The server filters pins by permitted projects. You can share this bookmarklet with reviewers. Continue?',
      confirmLabel: 'Continue',
    });
  }

  function handleOpenJira(canvasName) {
    const url = buildJqlUrl(jiraBaseUrl, canvasFieldId, canvasName);
    if (!url) {
      setActionError({ canvasName, message: 'Jira base URL is unavailable.' });
      return;
    }
    router.open(url);
  }

  async function confirmAction() {
    if (!confirm) return;
    if (confirm.kind === 'review') {
      const canvasName = confirm.canvasName;
      setConfirm(null);
      issueToken(canvasName, 'view');
    }
  }

  const filteredCanvases = canvases.filter((canvas) =>
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
          {universalLoading ? 'Generating…' : 'Get Universal Launcher Bookmarklet'}
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
        <button type="button" className="jt-button jt-button-primary" onClick={() => setCreateOpen(true)}>
          Create New Canvas
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
        <h2>Canvases</h2>
        {loading ? (
          <div className="jt-empty">Loading canvases…</div>
        ) : canvases.length === 0 ? (
          <div className="jt-empty">
            <div>No canvases yet. Use Create New Canvas to make your first one.</div>
            {isAdmin && (
              <div className="jt-empty-hint">
                If older JiraTack tickets are missing their canvas fields, use Maintenance below to recover
                them.
              </div>
            )}
          </div>
        ) : (
          <CanvasTable
            canvases={filteredCanvases}
            hasAccess={hasAccess}
            onWrite={handleWrite}
            onReview={handleReview}
            onOpenJira={handleOpenJira}
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
