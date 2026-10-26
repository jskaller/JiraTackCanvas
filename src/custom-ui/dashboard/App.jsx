import React, { useCallback, useEffect, useState } from 'react';
import { router } from '@forge/bridge';
import { aggregate, listTokens, revokeToken, generateToken, buildJqlUrl } from './api';
import CanvasTable from './components/CanvasTable';
import TokenList from './components/TokenList';
import BookmarkletModal from './components/BookmarkletModal';
import ConfirmDialog from './components/ConfirmDialog';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [canvases, setCanvases] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [hasAccess, setHasAccess] = useState(true);
  const [jiraBaseUrl, setJiraBaseUrl] = useState(null);
  const [canvasFieldId, setCanvasFieldId] = useState(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const aggregateResult = await aggregate();
      console.log('Dashboard data:', aggregateResult);

      if (aggregateResult && aggregateResult.ok && aggregateResult.data) {
        setCanvases(aggregateResult.data.canvases || []);
        setHasAccess(aggregateResult.data.hasAccess !== false);
        setJiraBaseUrl(aggregateResult.data.jiraBaseUrl || null);
        setCanvasFieldId(aggregateResult.data.canvasFieldId || null);
      } else {
        setError(
          (aggregateResult && aggregateResult.error && aggregateResult.error.message)
            || 'Failed to load canvases.',
        );
        setCanvases([]);
      }

      try {
        const tokensResult = await listTokens();
        if (tokensResult && tokensResult.ok && tokensResult.data) {
          setTokens(tokensResult.data.tokens || []);
        }
      } catch (tokenError) {
        console.error('Failed to load tokens:', tokenError);
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

  function handleRevoke(token) {
    setConfirm({
      kind: 'revoke',
      token,
      title: 'Revoke canvas token',
      message:
        'This deletes the token. Bookmarklets using it stop working immediately for new exchanges, and existing sessions expire within 8 hours. Continue?',
      confirmLabel: 'Revoke',
      destructive: true,
    });
  }

  async function confirmAction() {
    if (!confirm) return;
    if (confirm.kind === 'review') {
      const canvasName = confirm.canvasName;
      setConfirm(null);
      issueToken(canvasName, 'view');
      return;
    }
    if (confirm.kind === 'revoke') {
      const token = confirm.token;
      setConfirm(null);
      setActionError(null);
      try {
        const result = await revokeToken(token);
        if (!result || !result.ok) {
          setActionError({
            message: (result && result.error && result.error.message) || 'Failed to revoke token.',
          });
        }
      } catch (e) {
        setActionError({ message: e && e.message ? e.message : String(e) });
      }
      load();
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
            Create a ticket with a new canvas name in the JiraTack Canvas field; the canvas appears here
            automatically.
          </p>
        </div>
      </header>

      <input
        className="jt-search"
        type="search"
        placeholder="Search canvases…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

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
            No canvases found. Create a Jira ticket with the JiraTack Canvas field set to get started.
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

      <section className="jt-section">
        <h2>Canvas tokens</h2>
        <TokenList tokens={tokens} onRevoke={handleRevoke} />
      </section>

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
    </div>
  );
}
