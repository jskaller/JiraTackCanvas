import React, { useState, useEffect } from 'react';
import ForgeReconciler, { Button, Text, Stack, SectionMessage, Textfield, Link } from '@forge/react';
import { invoke } from '@forge/bridge';
import FieldAudit from './FieldAudit.jsx';
import RecoveryPanel from './RecoveryPanel.jsx';

const DEFAULT_CONFIG = {
  fieldRegistry: {},
  viewPermissionMode: 'per_user_projects',
};

const toText = (value, fallback = 'Unknown error') => {
  if (value === null || value === undefined) return fallback;
  return typeof value === 'string' ? value : String(value);
};

const inputValue = (event) => (event && event.target ? event.target.value : event);

const buildBookmarklet = (data) => {
  const resolvedCanvasName = data.canvasName || data.canvasId || 'Test Canvas';
  const resolvedCanvasId = data.canvasId || resolvedCanvasName;
  const config = {
    token: data.token,
    apiUrl: data.apiUrl,
    sdkUrl: data.sdkUrl,
    canvasId: resolvedCanvasId,
    canvasName: resolvedCanvasName,
    sdkVersion: data.sdkVersion,
  };
  const code = `(function(){var c=${JSON.stringify(config)};if(window.__jiratackActiveCanvas===c.canvasId){window.__jiratackClose();return;}var s=document.createElement('script');s.src=c.sdkUrl+'?v='+c.sdkVersion;s.onload=function(){window.__jiratackInit(c);};document.head.appendChild(s);})();`;
  return `javascript:${code}`;
};

const AdminApp = () => {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [canvasName, setCanvasName] = useState('Test Canvas');
  const [bookmarklet, setBookmarklet] = useState(null);
  const [bookmarkletError, setBookmarkletError] = useState(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await invoke('getInstallationConfig');
        if (mounted && res && res.ok && res.data) {
          setConfig({ ...DEFAULT_CONFIG, ...res.data });
        }
      } catch (e) {
        if (mounted) setError(e && e.message ? e.message : 'Unknown error');
      }
    })();
    return () => { mounted = false; };
  }, []);

  const provision = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoke('provisionFields');
      if (res && res.ok) {
        const next = (res.data && res.data.warnings) || res.warnings || [];
        setWarnings(next.map((w) => toText(w)).filter(Boolean));
        const cfg = await invoke('getInstallationConfig');
        if (cfg && cfg.ok && cfg.data) {
          setConfig({ ...DEFAULT_CONFIG, ...cfg.data });
        }
      } else if (res && res.error) {
        setError(toText(res.error.message));
      } else {
        setError('Provisioning returned no result.');
      }
    } catch (err) {
      setError(err && err.message ? err.message : 'Unknown error');
    }
    setLoading(false);
  };

  const setMode = async (mode) => {
    setError(null);
    try {
      const res = await invoke('setInstallationConfig', { viewPermissionMode: mode });
      if (res && res.ok && res.data) {
        setConfig({ ...DEFAULT_CONFIG, ...res.data });
      }
    } catch (err) {
      setError(err && err.message ? err.message : 'Unknown error');
    }
  };

  const generateBookmarklet = async () => {
    setGenerating(true);
    setBookmarklet(null);
    setBookmarkletError(null);
    try {
      const res = await invoke('generateCanvasToken', {
        canvasName: canvasName && canvasName.trim() ? canvasName.trim() : 'Test Canvas',
        scope: 'create',
      });
      if (res && res.ok && res.data) {
        setBookmarklet(buildBookmarklet(res.data));
      } else if (res && res.error) {
        setBookmarkletError(toText(res.error.message));
      } else {
        setBookmarkletError('Token generation returned no result.');
      }
    } catch (err) {
      setBookmarkletError(err && err.message ? err.message : 'Unknown error');
    }
    setGenerating(false);
  };

  const registry = (config && config.fieldRegistry) || {};
  const mode = (config && config.viewPermissionMode) || 'per_user_projects';

  const refreshConfig = async () => {
    try {
      const cfg = await invoke('getInstallationConfig');
      if (cfg && cfg.ok && cfg.data) {
        setConfig({ ...DEFAULT_CONFIG, ...cfg.data });
      }
    } catch (e) {
      // ignore refresh errors
    }
  };

  return (
    <Stack space="space.200">
      <Text>JiraTack Admin</Text>
      {error && (
        <SectionMessage appearance="error" title="Provisioning error">
          <Text>{error}</Text>
        </SectionMessage>
      )}
      <Button onClick={provision} isDisabled={loading}>{loading ? 'Provisioning…' : 'Provision Fields'}</Button>
      {Object.keys(registry).length > 0 && (
        <Stack space="space.100">
          <Text>Field Registry</Text>
          {Object.entries(registry).map(([k, v]) => (
            <Text key={k}>{k}: {toText(v, 'not provisioned')}</Text>
          ))}
        </Stack>
      )}
      <Text>View permission mode</Text>
      <Text>per_user_projects: each viewer sees pins only in projects they can browse.</Text>
      <Text>open: everyone with a bookmarklet sees all pins regardless of project access.</Text>
      <Button appearance={mode === 'per_user_projects' ? 'primary' : 'default'} onClick={() => setMode('per_user_projects')}>Per-user projects</Button>
      <Button appearance={mode === 'open' ? 'primary' : 'default'} onClick={() => setMode('open')}>Open</Button>
      {warnings.map((w, i) => (
        <Text key={i}>{w}</Text>
      ))}

      <FieldAudit onUpdated={refreshConfig} />

      <RecoveryPanel onRecovered={refreshConfig} />

      <Text>Generate Test Bookmarklet</Text>
      <Textfield
        label="Canvas name"
        value={canvasName}
        onChange={(event) => setCanvasName(inputValue(event))}
      />
      <Button onClick={generateBookmarklet} isDisabled={generating}>
        {generating ? 'Generating…' : 'Generate Test Bookmarklet'}
      </Button>
      {bookmarkletError && (
        <SectionMessage appearance="error" title="Bookmarklet error">
          <Text>{bookmarkletError}</Text>
        </SectionMessage>
      )}
      {bookmarklet && (
        <Stack space="space.100">
          <Text>Drag this link to your bookmarks bar, or copy the URL below.</Text>
          <Link href={bookmarklet}>{`JiraTack — ${canvasName || 'Test Canvas'}`}</Link>
          <Textfield label="Bookmarklet URL" value={bookmarklet} isReadOnly />
        </Stack>
      )}
    </Stack>
  );
};

ForgeReconciler.render(<AdminApp />);
