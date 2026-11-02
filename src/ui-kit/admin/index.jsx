import React, { useState, useEffect } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  ButtonGroup,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Stack,
  Text,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const DEFAULT_CONFIG = {
  viewPermissionMode: 'per_user_projects',
};

const STATUS_APPEARANCE = {
  active: 'success',
  inactive: 'default',
  expired: 'warning',
  revoked: 'removed',
};

function formatWhen(value) {
  if (!value) return 'never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString();
}

const AdminApp = () => {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [error, setError] = useState(null);
  const [invites, setInvites] = useState([]);
  const [invitesError, setInvitesError] = useState(null);
  const [busyRef, setBusyRef] = useState(null);
  const [confirmRef, setConfirmRef] = useState(null);

  const loadInvites = async () => {
    try {
      const res = await invoke('listGuestInvites', {});
      if (res && res.ok && res.data) {
        setInvites(res.data.invites || []);
        setInvitesError(null);
      } else {
        setInvitesError((res && res.error && res.error.message) || 'Could not load invitations.');
      }
    } catch (e) {
      setInvitesError(e && e.message ? e.message : 'Could not load invitations.');
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await invoke('getInstallationConfig', {});
        if (mounted && res && res.ok && res.data) {
          setConfig({ ...DEFAULT_CONFIG, ...res.data });
        }
      } catch (e) {
        if (mounted) setError(e && e.message ? e.message : 'Unknown error');
      }
      if (mounted) await loadInvites();
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

  const act = async (ref, action, payload) => {
    setBusyRef(ref);
    setInvitesError(null);
    try {
      const res = await invoke(action, { tokenRef: ref, ...(payload || {}) });
      if (!res || !res.ok) {
        throw new Error((res && res.error && res.error.message) || 'Action failed.');
      }
      await loadInvites();
    } catch (err) {
      setInvitesError(err && err.message ? err.message : 'Action failed.');
    } finally {
      setBusyRef(null);
      setConfirmRef(null);
    }
  };

  const mode = (config && config.viewPermissionMode) || 'per_user_projects';

  return (
    <Stack space="space.400">
      <Heading level="h2">JiraTack admin</Heading>

      {error && (
        <SectionMessage appearance="error" title="Configuration error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      <Stack space="space.150">
        <Heading level="h4">View permission mode</Heading>
        <Text>per_user_projects — each viewer sees pins only in projects they can browse.</Text>
        <Text>open — everyone with a bookmarklet sees all pins regardless of project access.</Text>
        <ButtonGroup>
          <Button
            appearance={mode === 'per_user_projects' ? 'primary' : 'default'}
            onClick={() => setMode('per_user_projects')}
          >
            Per-user projects
          </Button>
          <Button
            appearance={mode === 'open' ? 'primary' : 'default'}
            onClick={() => setMode('open')}
          >
            Open
          </Button>
        </ButtonGroup>
      </Stack>

      <Stack space="space.150">
        <Heading level="h4">Guest invitations</Heading>
        <Text>Each invitation names one reviewer. Deactivating pauses access; revoking is permanent.</Text>

        {invitesError && (
          <SectionMessage appearance="error" title="Invitations">
            <Text>{invitesError}</Text>
          </SectionMessage>
        )}

        {invites.length === 0 && !invitesError && <Text>No guest invitations issued.</Text>}

        {invites.map((invite) => {
          const legacy = !invite.guestName && !invite.guestEmail;
          const busy = busyRef === invite.tokenRef;
          return (
            <Box key={invite.tokenRef} padding="space.150">
              <Stack space="space.100">
                <Inline space="space.100" shouldWrap>
                  <Text>{legacy ? 'Legacy link (no reviewer identity)' : invite.guestName}</Text>
                  {!legacy && <Text>{invite.guestEmail}</Text>}
                  <Text>· sponsor {invite.issuedByName || invite.issuedBy || 'unknown'}</Text>
                  <Lozenge appearance={STATUS_APPEARANCE[invite.status] || 'default'}>
                    {invite.status}
                  </Lozenge>
                </Inline>

                <Inline space="space.100" shouldWrap>
                  <Text>Link expires {formatWhen(invite.linkExpiresAt)}</Text>
                  <Text>· {invite.pairings} of {invite.pairingsLimit} pairings</Text>
                  <Text>· {invite.pinCount} pins</Text>
                </Inline>

                <Text>{(invite.canvases || []).join(', ')}</Text>

                <ButtonGroup>
                  {invite.status === 'active' && (
                    <Button appearance="subtle" isDisabled={busy} onClick={() => act(invite.tokenRef, 'setGuestInviteActive', { active: false })}>
                      Deactivate
                    </Button>
                  )}
                  {invite.status === 'inactive' && (
                    <Button appearance="subtle" isDisabled={busy} onClick={() => act(invite.tokenRef, 'setGuestInviteActive', { active: true })}>
                      Activate
                    </Button>
                  )}
                  {!legacy && invite.status !== 'revoked' && (
                    <Button appearance="subtle" isDisabled={busy} onClick={() => act(invite.tokenRef, 'regenerateGuestInvite')}>
                      New link
                    </Button>
                  )}
                  {invite.status !== 'revoked' && (
                    <Button
                      appearance="subtle"
                      isDisabled={busy}
                      onClick={() => {
                        if (confirmRef === invite.tokenRef) {
                          act(invite.tokenRef, 'revokeGuestInvite');
                        } else {
                          setConfirmRef(invite.tokenRef);
                        }
                      }}
                    >
                      {confirmRef === invite.tokenRef ? 'Confirm revoke' : 'Revoke'}
                    </Button>
                  )}
                </ButtonGroup>
              </Stack>
            </Box>
          );
        })}
      </Stack>
    </Stack>
  );
};

ForgeReconciler.render(<AdminApp />);
