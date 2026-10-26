import React, { useState, useEffect } from 'react';
import ForgeReconciler, { Button, Text, Stack, SectionMessage } from '@forge/react';
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

const AdminApp = () => {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

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
    </Stack>
  );
};

ForgeReconciler.render(<AdminApp />);
