import crypto from 'crypto';
import api, { route } from '@forge/api';
import { kvsGet, kvsSet, kvsQueryAll } from './kvs.js';
import { getBindingSecret } from './secrets.js';
import { bindingIdFor } from './bindingModel.js';
import { ensureBinding, getBinding } from './bindings.js';
import { parentRefOf } from './credentialsModel.js';
import { pairingService } from './credentials.js';
import { tokenReference } from './tokenRef.js';
import { getInstallationConfig } from './config.js';
import { resolveWebtriggerUrls } from './webtriggerUrls.js';
import {
  LINK_TTL_MS,
  invitationState,
  invitationStatus,
  linkExpiresAt,
} from './inviteModel.js';

/**
 * Guest invitations: one reviewer, named at issuance by a licensed sponsor.
 *
 * The record has no KVS TTL — the link expires (linkExpiresAt) but the
 * invitation and its pairings persist until deactivated or revoked (D29).
 */

const PREFIX = 'canvasTokens:';

export function inviteKey(token) {
  return `${PREFIX}${token}`;
}

export async function createInvite({
  issuer,
  issuedByName,
  issuerEmail,
  guestName,
  guestEmail,
  permittedCanvases,
  permittedProjects,
  installationId,
  now = Date.now(),
}) {
  const secret = await getBindingSecret();
  const bindingId = bindingIdFor(guestEmail, secret);
  if (!bindingId) throw new Error('A valid guest email is required.');

  await ensureBinding({
    email: guestEmail,
    issuedBy: issuer,
    canvasNames: permittedCanvases,
    now,
  });

  const token = crypto.randomBytes(32).toString('hex');
  const record = {
    scope: 'guest_create',
    issuer: String(issuer),
    issuedByName: issuedByName || null,
    issuerEmail: issuerEmail || null,
    guestName: String(guestName).trim().slice(0, 200),
    guestEmail: String(guestEmail).trim().toLowerCase().slice(0, 320),
    bindingId,
    permittedCanvases,
    permittedProjectsJson: JSON.stringify(permittedProjects),
    installationId: String(installationId),
    state: 'active',
    issuedAt: now,
    linkExpiresAt: now + LINK_TTL_MS,
    revoked: false,
    mintedAfterCutover: true,
  };

  await kvsSet(inviteKey(token), record);
  return { token, record };
}

async function loadInvites() {
  const entries = await kvsQueryAll(PREFIX);
  return entries
    .filter((row) => row.value && row.value.scope === 'guest_create')
    .map((row) => ({
      token: String(row.key).slice(PREFIX.length),
      key: row.key,
      record: row.value,
    }));
}

export async function findInviteByRef(ref) {
  if (typeof ref !== 'string' || ref.length === 0) return null;
  const invites = await loadInvites();
  return invites.find((entry) => tokenReference(entry.token) === ref) || null;
}

export function canManageInvite(viewerAccountId, isAdmin, invite) {
  if (isAdmin) return true;
  return Boolean(invite && invite.issuer && invite.issuer === viewerAccountId);
}

async function resolveSponsor(record, cache, token) {
  if (!record.issuer) return record;
  if (record.issuedByName && record.issuerEmail) return record;
  if (cache.has(record.issuer)) {
    const cached = cache.get(record.issuer);
    return {
      ...record,
      issuedByName: record.issuedByName || cached.displayName,
      issuerEmail: record.issuerEmail || cached.emailAddress,
    };
  }
  let profile = { displayName: null, emailAddress: null };
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${record.issuer}`);
    if (res.ok) {
      const data = await res.json();
      profile = {
        displayName: (data && data.displayName) || null,
        emailAddress: (data && data.emailAddress) || null,
      };
    }
  } catch (e) {
    profile = { displayName: null, emailAddress: null };
  }
  cache.set(record.issuer, profile);
  const next = {
    ...record,
    issuedByName: record.issuedByName || profile.displayName,
    issuerEmail: record.issuerEmail || profile.emailAddress,
  };
  if (next.issuedByName !== record.issuedByName || next.issuerEmail !== record.issuerEmail) {
    try {
      if (token) await kvsSet(inviteKey(token), next);
    } catch (e) {
      // advisory backfill only
    }
  }
  return next;
}

export async function listInvites({ viewerAccountId, isAdmin, now = Date.now() }) {
  const invites = await loadInvites();
  let installUrl = null;
  try {
    const config = await getInstallationConfig();
    ({ installUrl } = await resolveWebtriggerUrls(config));
  } catch (e) {
    installUrl = null;
  }
  const visible = isAdmin
    ? invites
    : invites.filter((entry) => entry.record.issuer === viewerAccountId);

  const sponsorCache = new Map();
  const rows = await Promise.all(visible.map(async (entry) => {
    const record = await resolveSponsor(entry.record, sponsorCache, entry.token);
    const pairings = await pairingService.countPairingsForInvite(parentRefOf(entry.token));
    const binding = record.bindingId ? await getBinding(record.bindingId) : null;
    return {
      tokenRef: tokenReference(entry.token),
      guestName: record.guestName || null,
      guestEmail: record.guestEmail || null,
      issuedBy: record.issuer || null,
      issuedByName: record.issuedByName || null,
      issuerEmail: record.issuerEmail || null,
      state: invitationState(record),
      status: invitationStatus(record, now),
      linkExpiresAt: linkExpiresAt(record),
      pairings,
      pairingsLimit: 10,
      pinCount: binding ? binding.pinCount || 0 : 0,
      lastPinAt: binding ? binding.lastPinAt || null : null,
      canvases: Array.isArray(record.permittedCanvases) ? record.permittedCanvases : [],
      installerUrl: installUrl && !record.revoked
        ? `${installUrl}${installUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(entry.token)}`
        : null,
      revokedAt: record.revokedAt || null,
    };
  }));

  rows.sort((a, b) => (b.linkExpiresAt || 0) - (a.linkExpiresAt || 0));
  return rows;
}

export async function setInviteState({ ref, active, viewerAccountId, isAdmin, now = Date.now() }) {
  const entry = await findInviteByRef(ref);
  if (!entry) return { ok: false, code: 'NOT_FOUND', message: 'Invitation not found.' };
  if (!canManageInvite(viewerAccountId, isAdmin, entry.record)) {
    return { ok: false, code: 'INSUFFICIENT_SCOPE', message: 'You cannot manage this invitation.' };
  }
  if (invitationState(entry.record) === 'revoked') {
    return { ok: false, code: 'TOKEN_INVALID', message: 'This invitation has been revoked and cannot be reactivated.' };
  }
  const updated = { ...entry.record, state: active ? 'active' : 'inactive', updatedAt: now };
  await kvsSet(entry.key, updated);
  return { ok: true, data: { tokenRef: ref, state: updated.state } };
}

export async function revokeInvite({ ref, viewerAccountId, isAdmin, reason = 'revoked', now = Date.now() }) {
  const entry = await findInviteByRef(ref);
  if (!entry) return { ok: false, code: 'NOT_FOUND', message: 'Invitation not found.' };
  if (!canManageInvite(viewerAccountId, isAdmin, entry.record)) {
    return { ok: false, code: 'INSUFFICIENT_SCOPE', message: 'You cannot manage this invitation.' };
  }
  if (entry.record.revoked) {
    return { ok: true, data: { tokenRef: ref, revoked: true } };
  }
  const updated = {
    ...entry.record,
    revoked: true,
    revokedAt: now,
    revokedReason: reason,
    state: 'revoked',
  };
  await kvsSet(entry.key, updated);
  return { ok: true, data: { tokenRef: ref, revoked: true } };
}

/**
 * New link, same reviewer. The binding is reused, so the reviewer slot is not
 * consumed twice; the pairing cap resets because it is counted per invite.
 * The old invitation is tombstoned, which invalidates its pairings.
 */
export async function regenerateInvite({ ref, viewerAccountId, isAdmin, installationId, now = Date.now() }) {
  const entry = await findInviteByRef(ref);
  if (!entry) return { ok: false, code: 'NOT_FOUND', message: 'Invitation not found.' };
  if (!canManageInvite(viewerAccountId, isAdmin, entry.record)) {
    return { ok: false, code: 'INSUFFICIENT_SCOPE', message: 'You cannot manage this invitation.' };
  }
  if (entry.record.revoked) {
    return { ok: false, code: 'TOKEN_INVALID', message: 'This invitation has been revoked. Issue a new one.' };
  }

  let permittedProjects = '*';
  if (typeof entry.record.permittedProjectsJson === 'string') {
    try {
      permittedProjects = JSON.parse(entry.record.permittedProjectsJson);
    } catch (e) {
      permittedProjects = [];
    }
  }

  await revokeInvite({ ref, viewerAccountId, isAdmin, reason: 'regenerated', now });

  const created = await createInvite({
    issuer: entry.record.issuer,
    issuedByName: entry.record.issuedByName,
    issuerEmail: entry.record.issuerEmail,
    guestName: entry.record.guestName,
    guestEmail: entry.record.guestEmail,
    permittedCanvases: entry.record.permittedCanvases,
    permittedProjects,
    installationId: installationId || entry.record.installationId,
    now,
  });

  return { ok: true, data: { token: created.token, record: created.record } };
}
