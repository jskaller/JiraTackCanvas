import React, { useState, useEffect } from 'react';
import ForgeReconciler, {
  Button,
  DynamicTable,
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
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const HEAD = {
  cells: [
    { key: 'guest', content: 'Guest', width: 26 },
    { key: 'sponsor', content: 'Sponsor', width: 18 },
    { key: 'status', content: 'Status', width: 10 },
    { key: 'link', content: 'Link expires', width: 14 },
    { key: 'usage', content: 'Pairings · pins', width: 14 },
    { key: 'actions', content: 'Actions', width: 18 },
  ],
};

const AdminApp = () => {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [error, setError] = useState(null);
  const [invites, setInvites] = useState([]);
  const [invitesError, setInvitesError] = useState(null);
  const [busyRef, setBusyRef] = useState(null);
  const [confirmRef, setConfirmRef] = useState(null);
  const [showLegacy, setShowLegacy] = useState(false);

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
  const named = invites.filter((invite) => invite.guestName || invite.guestEmail);
  const legacy = invites.filter((invite) => !invite.guestName && !invite.guestEmail);

  const actionsFor = (invite, isLegacy) => {
    const busy = busyRef === invite.tokenRef;
    const buttons = [];
    if (!isLegacy && invite.status === 'active') {
      buttons.push(
        <Button key="toggle" appearance="subtle" isDisabled={busy} onClick={() => act(invite.tokenRef, 'setGuestInviteActive', { active: false })}>
          Deactivate
        </Button>,
      );
    }
    if (!isLegacy && invite.status === 'inactive') {
      buttons.push(
        <Button key="toggle" appearance="subtle" isDisabled={busy} onClick={() => act(invite.tokenRef, 'setGuestInviteActive', { active: true })}>
          Activate
        </Button>,
      );
    }
    if (!isLegacy && invite.status !== 'revoked') {
      buttons.push(
        <Button key="relink" appearance="subtle" isDisabled={busy} onClick={() => act(invite.tokenRef, 'regenerateGuestInvite')}>
          New link
        </Button>,
      );
    }
    if (invite.installerUrl) {
      buttons.push(
        <Button
          key="open"
          appearance="subtle"
          onClick={() => window.open(invite.installerUrl, '_blank', 'noopener,noreferrer')}
        >
          Open link
        </Button>,
      );
    }
    if (invite.status !== 'revoked') {
      buttons.push(
        <Button
          key="revoke"
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
        </Button>,
      );
    }
    return <Inline space="space.050">{buttons}</Inline>;
  };

  const rowsFor = (list, isLegacy) => list.map((invite) => ({
    key: invite.tokenRef,
    cells: [
      {
        key: 'guest',
        content: (
          <Stack space="space.025">
            <Text>{isLegacy ? 'Legacy link' : invite.guestName}</Text>
            <Text>{isLegacy ? 'no reviewer recorded' : invite.guestEmail}</Text>
          </Stack>
        ),
      },
      { key: 'sponsor', content: <Text>{invite.issuedByName || invite.issuedBy || 'unknown'}</Text> },
      {
        key: 'status',
        content: <Lozenge appearance={STATUS_APPEARANCE[invite.status] || 'default'}>{invite.status}</Lozenge>,
      },
      { key: 'link', content: <Text>{formatWhen(invite.linkExpiresAt)}</Text> },
      {
        key: 'usage',
        content: <Text>{invite.pairings} of {invite.pairingsLimit} · {invite.pinCount} pins</Text>,
      },
      { key: 'actions', content: actionsFor(invite, isLegacy) },
    ],
  }));

  return (
    <Stack space="space.400">
      <Heading level="h2">JiraTack admin</Heading>

      {error && (
        <SectionMessage appearance="error" title="Configuration error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      <Stack space="space.100">
        <Heading level="h4">Access model</Heading>
        <Text>
          Guests see the projects their sponsor can browse, restricted to the canvases you selected when
          issuing the link.
        </Text>
        <Inline space="space.100">
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
        </Inline>
      </Stack>

      <Stack space="space.100">
        <Heading level="h4">Guest invitations</Heading>
        <Text>One reviewer per invitation. Deactivating pauses access; revoking is permanent.</Text>

        {invitesError && (
          <SectionMessage appearance="error" title="Invitations">
            <Text>{invitesError}</Text>
          </SectionMessage>
        )}

        <DynamicTable
          head={HEAD}
          rows={rowsFor(named, false)}
          emptyView={<Text>No guest invitations issued.</Text>}
        />

        {legacy.length > 0 && (
          <Stack space="space.100">
            <SectionMessage appearance="warning" title={`${legacy.length} legacy link(s) cannot be identified`}>
              <Stack space="space.100">
                <Text>
                  These were issued before invitations carried a reviewer name and email. Revoke them and
                  issue new links.
                </Text>
                <Inline>
                  <Button appearance="subtle" onClick={() => setShowLegacy((value) => !value)}>
                    {showLegacy ? 'Hide legacy links' : 'Show legacy links'}
                  </Button>
                </Inline>
              </Stack>
            </SectionMessage>
            {showLegacy && <DynamicTable head={HEAD} rows={rowsFor(legacy, true)} />}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
};

ForgeReconciler.render(<AdminApp />);
