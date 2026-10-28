import React, { useState, useEffect } from 'react';
import ForgeReconciler, { Button, Text, Stack, SectionMessage } from '@forge/react';
import { invoke } from '@forge/bridge';

const DEFAULT_CONFIG = {
  viewPermissionMode: 'per_user_projects',
};

const AdminApp = () => {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [error, setError] = useState(null);

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

  const mode = (config && config.viewPermissionMode) || 'per_user_projects';

  return (
    <Stack space="space.200">
      <Text>JiraTack Admin</Text>
      {error && (
        <SectionMessage appearance="error" title="Configuration error">
          <Text>{error}</Text>
        </SectionMessage>
      )}
      <Text>View permission mode</Text>
      <Text>per_user_projects: each viewer sees pins only in projects they can browse.</Text>
      <Text>open: everyone with a bookmarklet sees all pins regardless of project access.</Text>
      <Button appearance={mode === 'per_user_projects' ? 'primary' : 'default'} onClick={() => setMode('per_user_projects')}>Per-user projects</Button>
      <Button appearance={mode === 'open' ? 'primary' : 'default'} onClick={() => setMode('open')}>Open</Button>
    </Stack>
  );
};

ForgeReconciler.render(<AdminApp />);
