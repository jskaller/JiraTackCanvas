import React, { useState, useEffect } from 'react';
import ForgeReconciler, { Button, Text, Stack, SectionMessage } from '@forge/react';
import { invoke } from '@forge/bridge';

const DEFAULT_CONFIG = {
  viewPermissionMode: 'per_user_projects',
};

function formatWhen(value) {
  if (!value) return 'never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString();
}

function describeToken(token) {
  const parts = [token.tokenRef];
  parts.push(token.canvasName ? token.canvasName : 'guest link');
  if (token.scope) parts.push(token.scope);
  if (token.revoked) parts.push('revoked');
  parts.push(`expires ${formatWhen(token.expiresAt)}`);
  return parts.join(' · ');
}

const AdminApp = () => {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [error, setError] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [tokensError, setTokensError] = useState(null);
  const [busyRef, setBusyRef] = useState(null);

  const loadTokens = async () => {
    try {
      const res = await invoke('listCanvasTokens');
      if (res && res.ok && res.data) {
        setTokens(res.data.tokens || []);
        setTokensError(null);
      } else {
        setTokensError((res && res.error && res.error.message) || 'Could not load tokens.');
      }
    } catch (e) {
      setTokensError(e && e.message ? e.message : 'Could not load tokens.');
    }
  };

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
      if (mounted) await loadTokens();
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

  const revoke = async (tokenRef) => {
    setBusyRef(tokenRef);
    setTokensError(null);
    try {
      const res = await invoke('revokeCanvasToken', { tokenRef });
      if (!res || !res.ok) {
        throw new Error((res && res.error && res.error.message) || 'Revoke failed.');
      }
      await loadTokens();
    } catch (err) {
      setTokensError(err && err.message ? err.message : 'Revoke failed.');
    } finally {
      setBusyRef(null);
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

      <Text>Canvas and guest tokens</Text>
      <Text>Revoking blocks new exchanges immediately. Sessions already open stay valid for up to 8 hours.</Text>
      {tokensError && (
        <SectionMessage appearance="error" title="Token list">
          <Text>{tokensError}</Text>
        </SectionMessage>
      )}
      {tokens.length === 0 && !tokensError && <Text>No tokens issued.</Text>}
      {tokens.map((token) => (
        <Stack key={token.tokenRef} space="space.050">
          <Text>{describeToken(token)}</Text>
          <Button
            appearance="subtle"
            isDisabled={Boolean(token.revoked) || busyRef === token.tokenRef}
            onClick={() => revoke(token.tokenRef)}
          >
            {token.revoked ? 'Revoked' : busyRef === token.tokenRef ? 'Revoking…' : 'Revoke'}
          </Button>
        </Stack>
      ))}
    </Stack>
  );
};

ForgeReconciler.render(<AdminApp />);
