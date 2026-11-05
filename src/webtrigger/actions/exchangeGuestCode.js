import { kvsGet } from '../../lib/kvs.js';
import { getInstallationConfig } from '../../lib/config.js';
import { resolveWebtriggerUrls } from '../../lib/webtriggerUrls.js';
import { resolveGuestCode, noteGuestCodeMiss, guestCodeAttemptsLocked } from '../../lib/guestCodes.js';
import { pairingService } from '../../lib/credentials.js';
import { invitationState, canPairNewDevice } from '../../lib/inviteModel.js';
import { pairingIdFor } from '../../lib/credentialsModel.js';
import { buildCompositeToken } from '../../lib/tokenParser.js';
import { errorResult } from '../../lib/errors.js';
import { SDK_VERSION } from '../../lib/version.js';

const INSTALL_ID_RE = /^[a-f0-9]{32}$/;

function headerValue(request, name) {
  const headers = (request && request.headers) || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  if (!key) return null;
  const value = headers[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Pairs this device exactly as the invite branch of `exchangeToken` does, so the
 * device cap, revocation and pause semantics are the ones already tested.
 */
async function ensurePairing({ inviteToken, installId, invite, userAgent, now }) {
  const pairingId = pairingIdFor(inviteToken, installId);
  const existing = await pairingService.getPairing(pairingId);

  if (existing) {
    if (existing.state !== 'active') {
      return { ok: false, code: 'TOKEN_INVALID', message: 'This pairing has been revoked.' };
    }
    await pairingService.recordPairing({ inviteToken, installId, inviteRecord: invite, userAgent, now });
    return { ok: true, pairingId };
  }

  if (!canPairNewDevice(invite, now)) {
    return { ok: false, code: 'TOKEN_EXPIRED', message: 'This link has expired. Ask the person who sent it for a new one.' };
  }

  const created = await pairingService.recordPairing({ inviteToken, installId, inviteRecord: invite, userAgent, now });
  if (!created.ok) return created;
  return { ok: true, pairingId };
}

/**
 * Flow 2/4 (D46): trade the sponsor's short code for the guest credential the
 * extension and the installer page already know how to use.
 *
 * The returned `token` is the composite invite token, so every downstream path
 * — session claims, pairing, revocation, the 10-device cap — is unchanged. The
 * short code is only the way in.
 */
export async function exchangeGuestCode(payload, request) {
  const code = payload && typeof payload.code === 'string' ? payload.code : '';
  const rawInstallId = payload && payload.installId;
  const installId = typeof rawInstallId === 'string' && INSTALL_ID_RE.test(rawInstallId)
    ? rawInstallId
    : '';

  const now = Date.now();

  // Entropy already makes guessing impractical; this bounds the noise a single
  // installation can generate if someone tries anyway.
  if (await guestCodeAttemptsLocked(now)) {
    return errorResult('TOKEN_INVALID', 'Too many attempts. Try again in a little while.');
  }

  const row = await resolveGuestCode(code);
  if (!row) {
    await noteGuestCodeMiss(now);
    return errorResult('TOKEN_INVALID', 'That guest code is not valid.');
  }

  if (row.expiresAt && row.expiresAt < now) {
    return errorResult('TOKEN_EXPIRED', 'This guest code has expired. Ask for a new one.');
  }

  const invite = await kvsGet(`canvasTokens:${row.inviteToken}`);
  if (!invite || invite.scope !== 'guest_create') {
    return errorResult('TOKEN_INVALID', 'That guest code is not valid.');
  }
  if (invite.revoked) {
    return errorResult('TOKEN_INVALID', 'This invitation has been revoked.');
  }
  if (invitationState(invite) === 'inactive') {
    return errorResult('TOKEN_INVALID', 'This invitation is paused. Ask the person who sent it to reactivate it.');
  }
  if (!invite.guestName || !invite.guestEmail) {
    return errorResult('TOKEN_INVALID', 'This invitation is out of date. Ask the person who sent it for a new link.');
  }

  const paired = await ensurePairing({
    inviteToken: row.inviteToken,
    installId,
    invite,
    userAgent: headerValue(request, 'user-agent'),
    now,
  });
  if (!paired.ok) return errorResult(paired.code, paired.message);

  const config = await getInstallationConfig();
  const { apiUrl, sdkUrl, installUrl } = await resolveWebtriggerUrls(config);

  return {
    ok: true,
    data: {
      token: buildCompositeToken(row.inviteToken, installId),
      // The bare invite token, so the installer page can compose it with the
      // device it chose rather than double-composing what we return here.
      inviteToken: row.inviteToken,
      installId,
      scope: 'guest_create',
      guestName: invite.guestName,
      guestEmail: invite.guestEmail,
      issuer: invite.issuer,
      issuerName: invite.issuedByName || null,
      issuerEmail: invite.issuerEmail || null,
      permittedCanvases: Array.isArray(invite.permittedCanvases) ? invite.permittedCanvases : [],
      expiresAt: invite.linkExpiresAt,
      apiUrl,
      sdkUrl,
      installUrl: installUrl || null,
      sdkVersion: SDK_VERSION,
      currentSdkVersion: SDK_VERSION,
      canvasId: 'guest',
      canvasName: 'Guest canvases',
    },
  };
}
