import React, { useState, useEffect } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Checkbox,
  DynamicTable,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { invoke, router } from '@forge/bridge';

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
  const [confirmGuestRef, setConfirmGuestRef] = useState(null);
  const [showLegacy, setShowLegacy] = useState(false);
  const [showRevokedFor, setShowRevokedFor] = useState({});
  const [textFields, setTextFields] = useState(null);
  const [fieldCatalogueError, setFieldCatalogueError] = useState(null);
  const [fieldsSaved, setFieldsSaved] = useState(false);
  const [storeUrls, setStoreUrls] = useState({ chromeStoreUrl: '', firefoxXpiUrl: '' });
  const [storeSaved, setStoreSaved] = useState(false);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [repairNote, setRepairNote] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);

  const loadHealth = async () => {
    setHealthBusy(true);
    setHealthError(null);
    try {
      const res = await invoke('registryHealth', {});
      if (res && res.ok && res.data) setHealth(res.data);
      else setHealthError((res && res.error && res.error.message) || 'Could not read the registry.');
    } catch (e) {
      setHealthError(e && e.message ? e.message : 'Could not read the registry.');
    }
    setHealthBusy(false);
  };

  const repairIndex = async () => {
    setHealthBusy(true);
    setHealthError(null);
    setRepairNote(null);
    try {
      const res = await invoke('repairCanvasIndex', {});
      if (res && res.ok && res.data) {
        setRepairNote(
          `Indexed ${res.data.repaired} name(s); ${res.data.skipped} left alone because another canvas owns them.`,
        );
        const again = await invoke('registryHealth', {});
        if (again && again.ok && again.data) setHealth(again.data);
      } else {
        setHealthError((res && res.error && res.error.message) || 'Could not repair the index.');
      }
    } catch (e) {
      setHealthError(e && e.message ? e.message : 'Could not repair the index.');
    }
    setHealthBusy(false);
  };

  const removeStray = async (canvasKey) => {
    if (removeTarget !== canvasKey) {
      setRemoveTarget(canvasKey);
      return;
    }
    setHealthBusy(true);
    setHealthError(null);
    try {
      const res = await invoke('deleteStrayCanvasRecord', { canvasKey });
      if (res && res.ok) {
        setRepairNote(`Removed the stray record ${canvasKey}.`);
        setRemoveTarget(null);
        const again = await invoke('registryHealth', {});
        if (again && again.ok && again.data) setHealth(again.data);
      } else {
        setHealthError((res && res.error && res.error.message) || 'Could not remove that record.');
      }
    } catch (e) {
      setHealthError(e && e.message ? e.message : 'Could not remove that record.');
    }
    setHealthBusy(false);
  };

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
          setStoreUrls({
            chromeStoreUrl: res.data.chromeStoreUrl || '',
            firefoxXpiUrl: res.data.firefoxXpiUrl || '',
          });
        }
      } catch (e) {
        if (mounted) setError(e && e.message ? e.message : 'Unknown error');
      }
      try {
        const res = await invoke('listTextFields', {});
        if (mounted) {
          if (res && res.ok && res.data) setTextFields(res.data.fields || []);
          else {
            setTextFields([]);
            setFieldCatalogueError((res && res.error && res.error.message) || 'Text fields could not be loaded.');
          }
        }
      } catch (e) {
        if (mounted) {
          setTextFields([]);
          setFieldCatalogueError(e && e.message ? e.message : 'Text fields could not be loaded.');
        }
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

  const selectedFieldIds = Array.isArray(config.textFields) ? config.textFields.map((field) => field.id) : [];

  const saveTextFields = async (nextIds) => {
    setFieldCatalogueError(null);
    setFieldsSaved(false);
    const catalogue = new Map((textFields || []).map((field) => [field.id, field.name]));
    const textFieldsPayload = nextIds
      .filter((id) => catalogue.has(id))
      .map((id) => ({ id, name: catalogue.get(id) }));
    setConfig((current) => ({ ...current, textFields: textFieldsPayload }));
    try {
      const res = await invoke('setInstallationConfig', { textFields: textFieldsPayload });
      if (res && res.ok && res.data) {
        setConfig({ ...DEFAULT_CONFIG, ...res.data });
        setFieldsSaved(true);
      } else {
        setFieldCatalogueError((res && res.error && res.error.message) || 'Could not save fields.');
      }
    } catch (e) {
      setFieldCatalogueError(e && e.message ? e.message : 'Could not save fields.');
    }
  };

  const toggleTextField = (fieldId, checked) => {
    const next = new Set(selectedFieldIds);
    if (checked) next.add(fieldId);
    else next.delete(fieldId);
    saveTextFields(Array.from(next));
  };

  const saveStoreUrls = async () => {
    setStoreSaved(false);
    try {
      const res = await invoke('setInstallationConfig', { ...storeUrls });
      if (res && res.ok && res.data) {
        setStoreSaved(true);
      } else {
        setError((res && res.error && res.error.message) || 'Could not save the extension links.');
      }
    } catch (e) {
      setError(e && e.message ? e.message : 'Could not save the extension links.');
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
      setConfirmGuestRef(null);
    }
  };

  const mode = (config && config.viewPermissionMode) || 'per_user_projects';
  const named = invites.filter((invite) => invite.guestName || invite.guestEmail);
  const legacy = invites.filter((invite) => !invite.guestName && !invite.guestEmail);

  // One card per person (D48): invites are grouped by reviewer email, which is
  // what the reviewer binding is derived from. Active first, then soonest expiry.
  const guestGroups = (() => {
    const byEmail = new Map();
    named.forEach((invite) => {
      const key = invite.guestEmail || invite.tokenRef;
      if (!byEmail.has(key)) {
        byEmail.set(key, {
          key,
          name: invite.guestName || 'Guest',
          email: invite.guestEmail || '',
          invites: [],
        });
      }
      byEmail.get(key).invites.push(invite);
    });

    const groups = [...byEmail.values()].map((group) => {
      const active = group.invites
        .filter((invite) => invite.status !== 'revoked')
        .sort((a, b) => (a.linkExpiresAt || 0) - (b.linkExpiresAt || 0));
      const revoked = group.invites
        .filter((invite) => invite.status === 'revoked')
        .sort((a, b) => (b.linkExpiresAt || 0) - (a.linkExpiresAt || 0));
      const sponsor = active[0] || group.invites[0] || {};
      // The pin count lives on the reviewer binding, so it is one number for the
      // person, not one per invite.
      const pins = Math.max(0, ...group.invites.map((invite) => Number(invite.pinCount) || 0));
      return {
        ...group,
        active,
        revoked,
        pins,
        sponsor: sponsor.issuedByName || sponsor.issuedBy || 'unknown',
      };
    });

    groups.sort((a, b) => {
      const aLive = a.active.length > 0;
      const bLive = b.active.length > 0;
      if (aLive !== bLive) return aLive ? -1 : 1;
      const aNext = a.active[0] ? a.active[0].linkExpiresAt || 0 : 0;
      const bNext = b.active[0] ? b.active[0].linkExpiresAt || 0 : 0;
      return aNext - bNext;
    });

    return groups;
  })();

  const inviteRow = (invite) => (
    <Stack key={invite.tokenRef} space="space.050">
      <Inline space="space.100" alignBlock="center">
        <Lozenge appearance={STATUS_APPEARANCE[invite.status] || 'default'}>{invite.status}</Lozenge>
        <Text>{(invite.canvases || []).join(', ') || 'No canvases'}</Text>
        <Text>expires {formatWhen(invite.linkExpiresAt)}</Text>
        <Text>{invite.pairings} of {invite.pairingsLimit} devices</Text>
      </Inline>
      {actionsFor(invite, false)}
    </Stack>
  );

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
          onClick={async () => {
            try {
              await router.open(invite.installerUrl);
            } catch (e) {
              setInvitesError(e && e.message ? e.message : 'Could not open the installer link.');
            }
          }}
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
        <Heading level="h4">Browser extension links</Heading>
        <Text>
          Where the dashboard and guest invite pages send people to install the extension. Leave a
          field empty until that listing exists.
        </Text>
        <Textfield
          label="Chrome Web Store URL"
          value={storeUrls.chromeStoreUrl}
          onChange={(value) => setStoreUrls({ ...storeUrls, chromeStoreUrl: value && value.target ? value.target.value : value })}
        />
        <Textfield
          label="Firefox add-on (.xpi) URL"
          value={storeUrls.firefoxXpiUrl}
          onChange={(value) => setStoreUrls({ ...storeUrls, firefoxXpiUrl: value && value.target ? value.target.value : value })}
        />
        <Inline space="space.100">
          <Button onClick={saveStoreUrls}>Save links</Button>
          {storeSaved && <Text>Saved.</Text>}
        </Inline>
      </Stack>

      <Stack space="space.100">
        <Heading level="h4">Available text fields</Heading>
        <Text>
          Fields a canvas can pre-fill on new tickets, across the whole installation. Only text
          and URL fields are listed. A canvas picks from this list; values are written when the
          field is on the Create screen for the ticket's type, otherwise they go into the
          description.
        </Text>
        {fieldCatalogueError && (
          <SectionMessage appearance="error" title="Text fields">
            <Text>{fieldCatalogueError}</Text>
          </SectionMessage>
        )}
        {textFields === null && <Text>Loading fields…</Text>}
        {textFields && textFields.length === 0 && (
          <Text>No text fields are available. Custom fields of type Text or URL appear here.</Text>
        )}
        {textFields && textFields.length > 0 && (
          <Stack space="space.100">
            {textFields.map((field) => (
              <Checkbox
                key={field.id}
                label={field.name}
                isChecked={selectedFieldIds.includes(field.id)}
                onChange={(e) => toggleTextField(field.id, !!(e && e.target ? e.target.checked : e))}
              />
            ))}
          </Stack>
        )}
        {fieldsSaved && <Text>Saved.</Text>}
      </Stack>

      <Stack space="space.100">
        <Heading level="h4">Canvas registry</Heading>
        <Text>
          What JiraTack actually has stored: canvases, name-index rows, card previews, and
          tickets it cannot place. The legacy counts are what keep the compatibility fallbacks
          alive — this is a read-only report.
        </Text>
        {healthError && (
          <SectionMessage appearance="error" title="Registry">
            <Text>{healthError}</Text>
          </SectionMessage>
        )}
        <Inline space="space.100">
          <Button onClick={loadHealth} isDisabled={healthBusy}>
            {healthBusy ? 'Checking…' : 'Check registry'}
          </Button>
          <Button appearance="subtle" onClick={repairIndex} isDisabled={healthBusy}>
            Repair index
          </Button>
        </Inline>
        {repairNote && <Text>{repairNote}</Text>}
        {health && (
          <Stack space="space.100">
            <Text>
              Canvases: {health.canvases} · name-index rows: {health.nameIndexRows} · duplicate
              labels: {health.duplicateLabels}
            </Text>
            <Text>
              Orphaned index rows: {health.orphanIndexRows} · unindexed canvases:{' '}
              {health.unindexedCanvases}
            </Text>
            <Text>
              Previews: {health.previews.captured} stored, {health.previews.missing} missing ·
              legacy preview keys: {health.legacyPreviewKeys}
            </Text>
            <Text>
              Tickets scanned: {health.tickets.scanned} · without a canvas key:{' '}
              {health.tickets.withoutCanvasId} · unresolvable: {health.tickets.unresolved}
            </Text>
            {health.unindexedCanvases > 0 && (
              <SectionMessage appearance="warning" title="Canvases with an unindexed name">
                <Text>
                  {health.samples.unindexedCanvases
                    .map((row) => `${row.canvasKey}: ${row.names.join(', ')}`)
                    .join(' · ')}
                </Text>
                <Text>Repair index restores these; no ticket is changed.</Text>
              </SectionMessage>
            )}
            {health.duplicateLabels > 0 && (
              <SectionMessage appearance="warning" title="Two canvases share a label">
                {health.samples.duplicateLabels.map((entry) => (
                  <Stack key={entry.label} space="space.100">
                    <Text>{entry.name || entry.label}</Text>
                    {entry.records.map((record) => (
                      <Inline key={record.canvasKey} space="space.100" alignBlock="center">
                        <Text>
                          {record.canvasKey} — {record.ticketCount}{' '}
                          {record.ticketCount === 1 ? 'ticket' : 'tickets'}
                        </Text>
                        {record.ticketCount === 0 && (
                          <Button
                            appearance="subtle"
                            isDisabled={healthBusy}
                            onClick={() => removeStray(record.canvasKey)}
                          >
                            {removeTarget === record.canvasKey ? 'Confirm remove' : 'Remove'}
                          </Button>
                        )}
                      </Inline>
                    ))}
                  </Stack>
                ))}
                <Text>
                  Only the canvas with tickets appears in the dashboard. Remove is offered for the
                  record with none, and the real canvas is never affected.
                </Text>
              </SectionMessage>
            )}
            {health.orphanIndexRows > 0 && (
              <SectionMessage appearance="warning" title="Orphaned name-index rows">
                <Text>
                  {health.samples.orphanIndexRows
                    .map((row) => `${row.name} → ${row.canvasKey}`)
                    .join(', ')}
                </Text>
              </SectionMessage>
            )}
            {health.tickets.unresolved > 0 && (
              <SectionMessage appearance="warning" title="Tickets without a canvas">
                <Text>
                  {health.samples.unresolved
                    .map((row) => `${row.key} (${row.canvasId || row.canvasName})`)
                    .join(', ')}
                </Text>
              </SectionMessage>
            )}
          </Stack>
        )}
      </Stack>

      <Stack space="space.100">
        <Heading level="h4">Guest invitations</Heading>
        <Text>One reviewer, one card. Deactivating pauses an invite; revoking it is permanent. Use Revoke all invites to end every invite for that person.</Text>

        {invitesError && (
          <SectionMessage appearance="error" title="Invitations">
            <Text>{invitesError}</Text>
          </SectionMessage>
        )}

        {guestGroups.length === 0 ? (
          <Text>No guest invitations issued.</Text>
        ) : (
          <Stack space="space.200">
            {guestGroups.map((group) => {
              const activeCount = group.active.length;
              const total = group.invites.length;
              const busy = busyRef ? group.invites.some((invite) => invite.tokenRef === busyRef) : false;
              const showRevoked = Boolean(showRevokedFor[group.key]);
              return (
                <Box
                  key={group.key}
                  padding="space.200"
                  xcss={{
                    borderWidth: 'border.width',
                    borderStyle: 'solid',
                    borderColor: 'color.border',
                    borderRadius: 'radius.medium',
                    backgroundColor: 'elevation.surface',
                  }}
                >
                  <Stack space="space.150">
                    <Inline space="space.100" alignBlock="center" spread="space-between">
                      <Inline space="space.100" alignBlock="center">
                        <Text weight="medium">{group.name}</Text>
                        <Text>{group.email}</Text>
                        <Lozenge appearance={activeCount > 0 ? 'success' : 'removed'}>
                          {activeCount > 0 ? `${activeCount} active` : 'none active'}
                        </Lozenge>
                        <Text>
                          {total} {total === 1 ? 'invite' : 'invites'}
                          {' · '}
                          {group.pins} {group.pins === 1 ? 'pin' : 'pins'}
                          {' · '}
                          {group.sponsor}
                        </Text>
                      </Inline>
                      {activeCount > 1 && (
                        <Button
                          appearance="subtle"
                          isDisabled={busy}
                          onClick={() => {
                            if (confirmGuestRef === group.key) {
                              act(group.active[0].tokenRef, 'revokeGuestInvites');
                            } else {
                              setConfirmGuestRef(group.key);
                            }
                          }}
                        >
                          {confirmGuestRef === group.key
                            ? `Confirm revoke all invites for ${group.name}`
                            : 'Revoke all invites'}
                        </Button>
                      )}
                    </Inline>

                    {group.active.length > 0 && (
                      <Stack space="space.100">
                        {group.active.map((invite) => inviteRow(invite))}
                      </Stack>
                    )}

                    {group.revoked.length > 0 && (
                      <Stack space="space.100">
                        <Inline>
                          <Button
                            appearance="subtle"
                            onClick={() => setShowRevokedFor((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                          >
                            {showRevoked ? 'Hide' : 'Show'} {group.revoked.length} revoked {group.revoked.length === 1 ? 'invite' : 'invites'}
                          </Button>
                        </Inline>
                        {showRevoked && (
                          <Stack space="space.100">
                            {group.revoked.map((invite) => inviteRow(invite))}
                          </Stack>
                        )}
                      </Stack>
                    )}
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        )}

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
