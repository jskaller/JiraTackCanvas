import React, { useCallback, useEffect, useState } from 'react';
import { router } from '@forge/bridge';
import {
  aggregate,
  buildJqlUrl,
  createExtensionLogin,
  deleteCanvas,
  archiveCanvas,
} from './api';
import CanvasTable from './components/CanvasTable';
import CanvasCards from './components/CanvasCards';
import CanvasDetail from './components/CanvasDetail';
import CreateCanvasPanel from './components/CreateCanvasPanel';
import BookmarkletModal from './components/BookmarkletModal';
import ConfirmDialog from './components/ConfirmDialog';
import GuestLinkModal from './components/GuestLinkModal';
import BookmarkScopeDrawer from './components/BookmarkScopeDrawer';

const VIEW_KEY = 'jiratack:dashboardView';



function readView() {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards';
  } catch (e) {
    return 'cards';
  }
}

function readRouteKey() {
  const hash = String(window.location.hash || '');
  const prefix = '#/canvas/';
  if (!hash.startsWith(prefix)) return { key: null, tab: null };
  const rest = hash.slice(prefix.length);
  const [rawKey, tab] = rest.split('/');
  try {
    const key = decodeURIComponent(rawKey) || null;
    return { key, tab: key && tab === 'fields' ? 'fields' : null };
  } catch (e) {
    return { key: null, tab: null };
  }
}

/**
 * Flow 1 (D46): the dashboard cannot call `chrome.*`, so it posts to the parent
 * window where the extension's relay listens and waits for the matching answer.
 * A null result means the extension is not installed (or did not answer).
 */
function askExtension(payload, expectedType, requestId, timeoutMs) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || window.parent === window) {
      resolve(null);
      return;
    }
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      resolve(null);
    }, timeoutMs);
    function onMessage(event) {
      const data = event.data;
      if (!data || data.source !== 'jiratack' || data.type !== expectedType) return;
      if (data.requestId !== requestId) return;
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(data);
    }
    window.addEventListener('message', onMessage);
    try {
      window.parent.postMessage(payload, '*');
    } catch (e) {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(null);
    }
  });
}

function requestId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [canvases, setCanvases] = useState([]);
  const [hasAccess, setHasAccess] = useState(true);
  const [jiraBaseUrl, setJiraBaseUrl] = useState(null);
  const [store, setStore] = useState({ chrome: '', firefox: '' });
  const [isAdmin, setIsAdmin] = useState(false);
  const [meter, setMeter] = useState(null);
  const [sdkVersion, setSdkVersion] = useState('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [viewArchived, setViewArchived] = useState(false);
  const [guestMode, setGuestMode] = useState(null);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [extension, setExtension] = useState({
    status: 'unknown', // unknown | absent | present | connecting | connected | error
    message: '',
    displayName: null,
  });
  const [view, setView] = useState(readView);
  const [folder, setFolder] = useState('');
  const [route, setRoute] = useState(readRouteKey);

  useEffect(() => {
    const onHash = () => setRoute(readRouteKey());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const aggregateResult = await aggregate();
      if (aggregateResult && aggregateResult.ok && aggregateResult.data) {
        setCanvases(aggregateResult.data.canvases || []);
        setHasAccess(aggregateResult.data.hasAccess !== false);
        setJiraBaseUrl(aggregateResult.data.jiraBaseUrl || null);
        setStore(aggregateResult.data.store || { chrome: '', firefox: '' });
        setIsAdmin(aggregateResult.data.isAdmin === true);
        setMeter(aggregateResult.data.meter || null);
        setSdkVersion(aggregateResult.data.sdkVersion || '');
      } else {
        setError(
          (aggregateResult && aggregateResult.error && aggregateResult.error.message)
            || 'Failed to load canvases.',
        );
        setCanvases([]);
      }
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
      setCanvases([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Flow 1 (D46): ping the extension's Jira relay so the card can say whether
  // this browser already has it. Stops once connected, and is harmless when the
  // page is not embedded (askExtension resolves null immediately).
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    async function ping() {
      const id = requestId('ping');
      const answer = await askExtension(
        { source: 'jiratack', type: 'jiratack-extension-ping', requestId: id },
        'jiratack-extension-pong',
        id,
        1200,
      );
      if (cancelled) return;
      setExtension((prev) => (prev.status === 'connected'
        ? prev
        : { status: answer ? 'present' : 'absent', message: '', displayName: prev.displayName }));
      timer = window.setTimeout(ping, 3000);
    }
    ping();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  function switchView(next) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch (e) {
      // ignore
    }
  }

  function openCanvas(canvas) {
    window.location.hash = `#/canvas/${encodeURIComponent(canvas.canvasKey)}`;
  }

  function openCanvasFields(canvas) {
    window.location.hash = `#/canvas/${encodeURIComponent(canvas.canvasKey)}/fields`;
  }

  function closeCanvas() {
    window.location.hash = '';
  }

  function handleUniversalBookmarklet() {
    setBookmarkOpen(true);
  }

  function openGuest(mode) {
    setGuestMode(mode);
  }

  function openStore(browser) {
    const raw = browser === 'firefox' ? store.firefox : store.chrome;
    const url = /^https:\/\//i.test(raw || '') ? raw : '';
    if (!url) {
      setActionError({
        message: `The ${browser === 'firefox' ? 'Firefox add-on' : 'Chrome extension'} is not published yet — use the bookmarklet for now.`,
      });
      return;
    }
    router.open(url);
  }

  async function handleConnectExtension() {
    setExtension({ status: 'connecting', message: '', displayName: null });

    const result = await createExtensionLogin();
    if (!result || !result.ok) {
      setExtension({
        status: 'error',
        message: (result && result.error && result.error.message) || 'Could not start the sign-in.',
        displayName: null,
      });
      return;
    }

    const data = result.data || {};
    const id = requestId('connect');
    const answer = await askExtension(
      {
        source: 'jiratack',
        type: 'jiratack-extension-connect',
        requestId: id,
        apiUrl: data.apiUrl,
        code: data.code,
      },
      'jiratack-extension-connect-result',
      id,
      8000,
    );

    if (!answer) {
      setExtension({
        status: 'error',
        message: 'The extension is not detected. Install it, then reload this page and try again.',
        displayName: null,
      });
      return;
    }
    if (!answer.ok) {
      setExtension({
        status: 'error',
        message: answer.error || 'The extension could not sign in.',
        displayName: null,
      });
      return;
    }
    setExtension({ status: 'connected', message: '', displayName: answer.displayName || null });
  }

  function handleOpenJira(canvas) {
    const url = buildJqlUrl(jiraBaseUrl, canvas && canvas.canvasName);
    if (!url) {
      setActionError({ canvasName: canvas && canvas.canvasName, message: 'Jira base URL is unavailable.' });
      return;
    }
    router.open(url);
  }

  function handleArchiveCanvas(canvas) {
    setConfirm({
      kind: 'archive',
      canvas,
      title: 'Archive canvas',
      message:
        'The canvas will be hidden from the dashboard and launcher. Jira tickets are not changed. You can permanently delete it later from the archived view.',
      confirmLabel: 'Archive canvas',
      destructive: false,
    });
  }

  function handleDeleteCanvas(canvas) {
    setConfirm({
      kind: 'delete',
      canvas,
      title: 'Permanently delete canvas',
      message:
        'This permanently removes the canvas from JiraTack. It is only allowed when every ticket in the canvas is Done. Jira tickets themselves are not deleted.',
      confirmLabel: 'Permanently delete',
      destructive: true,
    });
  }

  async function confirmAction() {
    if (!confirm) return;
    const canvas = confirm.canvas;
    const kind = confirm.kind;
    setConfirm(null);
    setActionError(null);
    try {
      const result = kind === 'archive'
        ? await archiveCanvas(canvas)
        : await deleteCanvas(canvas);
      if (!result || !result.ok) {
        setActionError({
          canvasName: canvas && canvas.canvasName,
          message:
            (result && result.error && result.error.message)
            || (kind === 'archive' ? 'Failed to archive canvas.' : 'Failed to delete canvas.'),
        });
        return;
      }
      if (kind === 'delete' && route.key && canvas && canvas.canvasKey === route.key) closeCanvas();
      load();
    } catch (e) {
      setActionError({ canvasName: canvas && canvas.canvasName, message: e && e.message ? e.message : String(e) });
    }
  }

  const visibleCanvases = canvases.filter((canvas) =>
    viewArchived ? canvas.archived === true : canvas.archived !== true,
  );

  const folderCounts = visibleCanvases.reduce((map, canvas) => {
    const name = canvas.folder || '';
    map.set(name, (map.get(name) || 0) + 1);
    return map;
  }, new Map());

  const folderNames = Array.from(folderCounts.keys())
    .filter((name) => name)
    .sort((a, b) => a.localeCompare(b));

  const inFolder = (canvas) => {
    if (!folder) return true;
    if (folder === '__unfiled__') return !canvas.folder;
    return canvas.folder === folder;
  };

  const filteredCanvases = visibleCanvases.filter((canvas) =>
    inFolder(canvas)
    && (String(canvas.canvasName || '').toLowerCase().includes(search.trim().toLowerCase())
      || String(canvas.canvasKey || '').toLowerCase().includes(search.trim().toLowerCase())),
  );

  const routedCanvas = route.key
    ? canvases.find((canvas) => canvas.canvasKey === route.key)
    : null;

  return (
    <div className="jt-app">
      <header className="jt-header">
        <div>
          <h1>JiraTack</h1>
          <p className="jt-subtitle">Pin feedback on any page and turn it into Jira tickets.</p>
          {isAdmin && meter && meter.total > 0 && (
            <p className="jt-meter">
              {meter.total} {meter.total === 1 ? 'person' : 'people'} active in the last {meter.windowMinutes} minutes
              {meter.guests > 0 ? ` (${meter.guests} guest${meter.guests === 1 ? '' : 's'})` : ''}.
            </p>
          )}
        </div>
        <nav className="jt-anchors" aria-label="Sections">
          <a href="#install">Install</a>
          <a href="#canvases">Canvases</a>
        </nav>
      </header>

      {actionError && (
        <div className="jt-banner jt-banner-error">
          {actionError.canvasName ? <strong>{actionError.canvasName}: </strong> : null}
          {actionError.message}
        </div>
      )}

      {error && <div className="jt-banner jt-banner-error">{error}</div>}

      <section className="jt-section" id="install">
        <h2>Install JiraTack</h2>
        <div className="jt-install-grid">
          <article className="jt-install-card">
            <h3>Bookmarklet</h3>
            <p>One bookmark, every canvas you can access. Regenerate it any time.</p>
            <div className="jt-install-actions">
              <button
                type="button"
                className="jt-button jt-button-primary"
                onClick={handleUniversalBookmarklet}
              >
                Get bookmark
              </button>
              <button
                type="button"
                className="jt-button"
                disabled={!hasAccess}
                onClick={() => openGuest('bookmark')}
              >
                Create a guest bookmark
              </button>
            </div>
          </article>
          <article className="jt-install-card">
            <h3>Browser extension</h3>
            <p>
              For sites that block the bookmarklet. Install it, come back to this tab, then
              connect this browser.
            </p>
            <div className="jt-install-actions">
              <button type="button" className="jt-button" onClick={() => openStore('chrome')}>
                Get Chrome extension
              </button>
              <button type="button" className="jt-button" onClick={() => openStore('firefox')}>
                Get Firefox add-on
              </button>
              <button
                type="button"
                className="jt-button jt-button-primary"
                disabled={!hasAccess || extension.status === 'connecting'}
                onClick={handleConnectExtension}
              >
                {extension.status === 'connected' ? 'Connected' : 'Connect this browser'}
              </button>
              <button
                type="button"
                className="jt-button"
                disabled={!hasAccess}
                onClick={() => openGuest('extension')}
              >
                Create a guest extension link
              </button>
            </div>
            <p className={`jt-connect-status jt-connect-${extension.status}`}>
              {extension.status === 'connected'
                ? `Connected${extension.displayName ? ` as ${extension.displayName}` : ''} — this browser is signed in.`
                : extension.status === 'connecting'
                  ? 'Connecting…'
                  : extension.status === 'error'
                    ? extension.message
                    : extension.status === 'present'
                      ? 'Extension detected — click Connect this browser.'
                      : extension.status === 'absent'
                        ? 'Extension not detected in this browser yet.'
                        : 'Checking for the extension…'}
            </p>
            {/* TEMPORARY (D46): the unpacked fallback goes away with the store listing. */}
            <p className="jt-temp-note">
              <strong>Temporary while the store listing is pending:</strong> install with
              Chrome&apos;s <em>Developer mode → Load unpacked</em> → <code>dist/extension-chrome</code>,
              or Firefox&apos;s <em>about:debugging → Load Temporary Add-on</em> →
              <code>dist/extension-firefox/manifest.json</code>. Remove this note when the
              listings are live.
            </p>
          </article>
        </div>
      </section>

      <section className="jt-section" id="canvases">
        {routedCanvas ? (
          <CanvasDetail
            canvas={routedCanvas}
            initialTab={route.tab}
            jiraBaseUrl={jiraBaseUrl}
            buildJqlUrl={buildJqlUrl}
            onBack={closeCanvas}
            onRefresh={load}
            onOpenJira={handleOpenJira}
            onGuestLink={() => openGuest('bookmark')}
            folders={folderNames}
          />
        ) : (
          <>
            <div className="jt-section-head">
              <h2>Canvases</h2>
              <div className="jt-view-toggle" role="group" aria-label="View">
                <button
                  type="button"
                  className={`jt-button${view === 'cards' ? ' jt-button-primary' : ''}`}
                  onClick={() => switchView('cards')}
                >
                  Cards
                </button>
                <button
                  type="button"
                  className={`jt-button${view === 'table' ? ' jt-button-primary' : ''}`}
                  onClick={() => switchView('table')}
                >
                  List
                </button>
              </div>
            </div>

            {route.key && !routedCanvas && !loading && (
              <div className="jt-banner jt-banner-error">
                That canvas is not available. <button type="button" className="jt-link-button" onClick={closeCanvas}>Show all canvases</button>
              </div>
            )}

            {folderNames.length > 0 && (
              <nav className="jt-folder-rail" aria-label="Folders">
                <button
                  type="button"
                  className={`jt-folder${folder === '' ? ' jt-folder-active' : ''}`}
                  onClick={() => setFolder('')}
                >
                  All canvases <span className="jt-folder-count">{visibleCanvases.length}</span>
                </button>
                {folderCounts.get('') > 0 && (
                  <button
                    type="button"
                    className={`jt-folder${folder === '__unfiled__' ? ' jt-folder-active' : ''}`}
                    onClick={() => setFolder('__unfiled__')}
                  >
                    Unfiled <span className="jt-folder-count">{folderCounts.get('')}</span>
                  </button>
                )}
                {folderNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={`jt-folder${folder === name ? ' jt-folder-active' : ''}`}
                    onClick={() => setFolder(name)}
                  >
                    {name} <span className="jt-folder-count">{folderCounts.get(name)}</span>
                  </button>
                ))}
              </nav>
            )}

            <div className="jt-toolbar">
              <input
                className="jt-search"
                type="search"
                placeholder="Search by name or key…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {!viewArchived && (
                <button
                  type="button"
                  className="jt-button jt-button-primary"
                  onClick={() => setCreateOpen((current) => !current)}
                >
                  {createOpen ? 'Close' : 'New canvas'}
                </button>
              )}
              <button
                type="button"
                className="jt-button"
                onClick={() => setViewArchived((current) => !current)}
              >
                {viewArchived ? 'View active' : 'View archived'}
              </button>
            </div>

            {createOpen && !viewArchived && (
              <CreateCanvasPanel
                onCancel={() => setCreateOpen(false)}
                onCreated={(data) => {
                  setCreateOpen(false);
                  load().then(() => {
                    if (data && data.canvasKey) {
                      window.location.hash = `#/canvas/${encodeURIComponent(data.canvasKey)}`;
                    }
                  });
                }}
              />
            )}

            {loading ? (
              <div className="jt-empty">Loading canvases…</div>
            ) : visibleCanvases.length === 0 ? (
              <div className="jt-empty">
                {viewArchived
                  ? 'No archived canvases.'
                  : 'No canvases yet. Use New canvas to make your first one.'}
              </div>
            ) : view === 'cards' ? (
              <CanvasCards
                canvases={filteredCanvases}
                archivedView={viewArchived}
                jiraBaseUrl={jiraBaseUrl}
                onOpenCanvas={openCanvas}
                onOpenFields={openCanvasFields}
                onOpenJira={handleOpenJira}
                onArchive={handleArchiveCanvas}
                onDelete={handleDeleteCanvas}
              />
            ) : (
              <CanvasTable
                canvases={filteredCanvases}
                onOpenCanvas={openCanvas}
                onOpenFields={openCanvasFields}
                onOpenJira={handleOpenJira}
                onDelete={handleDeleteCanvas}
                onArchive={handleArchiveCanvas}
                archivedView={viewArchived}
              />
            )}
          </>
        )}
      </section>

      {bookmarkOpen && (
        <BookmarkScopeDrawer
          canvases={canvases}
          onClose={() => setBookmarkOpen(false)}
          onGenerated={(data) => {
            setBookmarkOpen(false);
            setModal({
              data: { ...data, canvasId: 'universal', canvasName: 'JiraTack Launcher' },
              scope: 'universal',
            });
          }}
        />
      )}

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

      <footer className="jt-version">
        JiraTack · SDK {sdkVersion || '—'} · UI {typeof __JIRATACK_UI_BUILD__ === 'string' ? __JIRATACK_UI_BUILD__ : 'dev'}
      </footer>

      {guestMode && (
        <GuestLinkModal
          mode={guestMode}
          canvases={canvases.filter((canvas) => canvas.archived !== true)}
          defaultCanvas={routedCanvas ? routedCanvas.canvasName : (canvases.find((canvas) => canvas.archived !== true)?.canvasName || null)}
          onClose={() => setGuestMode(null)}
        />
      )}
    </div>
  );
}
