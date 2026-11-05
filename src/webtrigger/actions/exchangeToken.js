import api, { route } from '@forge/api';
import crypto from 'crypto';
import { kvsGet, kvsSet, kvsDelete } from '../../lib/kvs.js';
import { getInstallationConfig } from '../../lib/config.js';
import { generateSessionJwt } from '../../lib/tokens.js';
import { pairingService } from '../../lib/credentials.js';
import { parseCompositeToken } from '../../lib/tokenParser.js';
import { invitationState, canPairNewDevice } from '../../lib/inviteModel.js';
import { pairingIdFor } from '../../lib/credentialsModel.js';
import { errorResult } from '../../lib/errors.js';
import { resolveWebtriggerUrls } from '../../lib/webtriggerUrls.js';
import { heartbeat } from '../../lib/metering.js';
import { SDK_VERSION } from '../../lib/version.js';

const SESSION_TTL_SECONDS = 8 * 60 * 60;
// Matches USER_TOKEN_TTL_DAYS in the resolver: the credential the extension
// stores after login is the same family the pasted link used to carry.
const USER_TOKEN_TTL_DAYS = 90;
let cachedJiraBaseUrl = null;
const displayNameCache = new Map();

async function getDisplayName(accountId) {
  if (!accountId) return null;
  if (displayNameCache.has(accountId)) return displayNameCache.get(accountId);
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`);
    if (res.ok) {
      const data = await res.json();
      const name = data && data.displayName ? data.displayName : null;
      displayNameCache.set(accountId, name);
      return name;
    }
  } catch (e) {
    return null;
  }
  return null;
}

async function getUserProfile(accountId) {
  if (!accountId) return { displayName: null, emailAddress: null };
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`);
    if (!res.ok) return { displayName: null, emailAddress: null };
    const data = await res.json();
    return {
      displayName: (data && data.displayName) || null,
      emailAddress: (data && data.emailAddress) || null,
    };
  } catch (e) {
    return { displayName: null, emailAddress: null };
  }
}

async function getJiraBaseUrl() {
  if (cachedJiraBaseUrl) return cachedJiraBaseUrl;
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/serverInfo`);
    if (res.ok) {
      const data = await res.json();
      cachedJiraBaseUrl = data && data.baseUrl ? data.baseUrl : null;
    }
  } catch (e) {
    cachedJiraBaseUrl = null;
  }
  return cachedJiraBaseUrl;
}

function tokenFromPayload(payload) {
  if (!payload) return '';
  return payload.canvasToken || payload.userToken || payload.token || '';
}

function headerValue(request, name) {
  const headers = (request && request.headers) || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  if (!key) return null;
  const value = headers[key];
  return Array.isArray(value) ? value[0] : value;
}

async function commonResponse(config, extra) {
  const { apiUrl, sdkUrl, installUrl } = await resolveWebtriggerUrls(config);
  const jiraBaseUrl = await getJiraBaseUrl();
  return {
    ok: true,
    data: {
      apiUrl,
      sdkUrl,
      installUrl: installUrl || null,
      currentSdkVersion: SDK_VERSION,
      jiraBaseUrl,
      configVersion: config.configVersion || '',
      ...extra,
    },
  };
}

export async function exchangeToken(payload, request) {
  const token = tokenFromPayload(payload);
  if (typeof token !== 'string' || token.length === 0) {
    return errorResult('BAD_REQUEST', 'canvasToken is required.');
  }
  // Guard the KVS boundary: tokens are lowercase hex, optionally with a single
  // dot for a composite. Anything else would reach KVS as an invalid key and
  // throw, which surfaced as INTERNAL 500 for a merely malformed token.
  if (token.length > 128 || !/^[a-f0-9.]+$/.test(token)) {
    return errorResult('TOKEN_INVALID', 'Token is not valid.');
  }

  const now = Date.now();
  const iat = Math.floor(now / 1000);
  const exp = iat + SESSION_TTL_SECONDS;

  const userRecord = await kvsGet(`userTokens:${token}`);
  if (userRecord) {
    if (userRecord.revoked) {
      return errorResult('TOKEN_INVALID', 'User token has been revoked.');
    }
    if (userRecord.expiresAt && userRecord.expiresAt < now) {
      return errorResult('TOKEN_EXPIRED', 'User token has expired.');
    }

    let permittedProjects = '*';
    if (typeof userRecord.permittedProjectsJson === 'string') {
      try {
        permittedProjects = JSON.parse(userRecord.permittedProjectsJson);
      } catch (e) {
        permittedProjects = [];
      }
    }

    const scope = userRecord.scope || 'create';

    let permittedCanvases = 'all';
    if (typeof userRecord.permittedCanvasesJson === 'string') {
      try {
        permittedCanvases = JSON.parse(userRecord.permittedCanvasesJson);
      } catch (e) {
        permittedCanvases = 'all';
      }
    }

    const sessionJwt = await generateSessionJwt({
      iss: 'jiratack',
      sub: userRecord.userId,
      aud: userRecord.installationId,
      scope,
      permittedCanvases,
      permittedProjects,
      isAdmin: userRecord.isAdmin === true,
      iat,
      exp,
    });

    const config = await getInstallationConfig();
    const displayName = await getDisplayName(userRecord.userId);
    await heartbeat({ kind: 'user', id: userRecord.userId });
    return commonResponse(config, {
      sessionJwt,
      expiresAt: exp * 1000,
      canvasId: null,
      canvasName: null,
      scope,
      permittedProjects,
      isAdmin: userRecord.isAdmin === true,
      displayName,
      accountId: userRecord.userId || null,
    });
  }

  // Invite branch. A bare invite is the legacy form (installId ""); a composite
  // is `inviteToken.installId`. Malformed composites fall through so a stray dot
  // cannot mask a valid canvas token.
  const parsed = parseCompositeToken(token);
  if (!parsed.malformedComposite && parsed.inviteToken) {
    let invite = await kvsGet(`canvasTokens:${parsed.inviteToken}`);
    if (invite && invite.scope === 'guest_create') {
      if (invite.revoked) {
        return errorResult('TOKEN_INVALID', 'This invitation has been revoked.');
      }
      if (invitationState(invite) === 'inactive') {
        return errorResult('TOKEN_INVALID', 'This invitation is paused. Ask the person who sent it to reactivate it.');
      }

      // Invitations minted before D29 have no named reviewer. Fail here rather
      // than issuing a session whose form would render three empty fields.
      if (!invite.guestName || !invite.guestEmail) {
        console.error('[JiraTack] Invitation predates named issuance:', parsed.inviteToken.slice(0, 8));
        return errorResult(
          'TOKEN_INVALID',
          'This invitation is out of date. Ask the person who sent it for a new link.',
        );
      }

      // Jira privacy often hides emailAddress at issuance. Retry once when the
      // guest opens the link, and persist it so the installer/list can show it.
      if (invite.issuer && (!invite.issuerEmail || !invite.issuedByName)) {
        const profile = await getUserProfile(invite.issuer);
        const patch = {};
        if (!invite.issuerEmail && profile.emailAddress) patch.issuerEmail = profile.emailAddress;
        if (!invite.issuedByName && profile.displayName) patch.issuedByName = profile.displayName;
        if (Object.keys(patch).length > 0) {
          invite = { ...invite, ...patch };
          try {
            await kvsSet(`canvasTokens:${parsed.inviteToken}`, invite);
          } catch (e) {
            // Advisory; never block the exchange.
          }
        }
      }

      const pairingId = pairingIdFor(parsed.inviteToken, parsed.installId);
      const existing = await pairingService.getPairing(pairingId);

      if (existing) {
        if (existing.state !== 'active') {
          return errorResult('TOKEN_INVALID', 'This pairing has been revoked.');
        }
        // Existing pairings keep working after the 72h link expires (D29).
        await pairingService.recordPairing({
          inviteToken: parsed.inviteToken,
          installId: parsed.installId,
          inviteRecord: invite,
          userAgent: headerValue(request, 'user-agent'),
          now,
        });
      } else {
        if (!canPairNewDevice(invite, now)) {
          return errorResult('TOKEN_EXPIRED', 'This link has expired. Ask the person who sent it for a new one.');
        }
        const created = await pairingService.recordPairing({
          inviteToken: parsed.inviteToken,
          installId: parsed.installId,
          inviteRecord: invite,
          userAgent: headerValue(request, 'user-agent'),
          now,
        });
        if (!created.ok) return errorResult(created.code, created.message);
      }

      let permittedProjects = '*';
      if (typeof invite.permittedProjectsJson === 'string') {
        try {
          permittedProjects = JSON.parse(invite.permittedProjectsJson);
        } catch (e) {
          permittedProjects = [];
        }
      }
      const permittedCanvases = Array.isArray(invite.permittedCanvases) ? invite.permittedCanvases : [];

      // Flow 2/4 (D46): one stable identity per guest, so an extension session
      // and a bookmarklet session for the same person meter as one user rather
      // than two. Derived from the invite, never from the sponsor.
      const guestId = crypto.createHash('sha256').update(parsed.inviteToken).digest('hex').slice(0, 16);

      const sessionJwt = await generateSessionJwt({
        iss: 'jiratack',
        sub: invite.issuer,
        aud: invite.installationId,
        scope: 'guest_create',
        issuer: invite.issuer,
        guestId,
        permittedCanvases,
        permittedProjects,
        pairingId,
        isAdmin: false,
        iat,
        exp,
      });

      const config = await getInstallationConfig();
      const displayName = await getDisplayName(invite.issuer);
      await heartbeat({ kind: 'guest', id: guestId });
      return commonResponse(config, {
        sessionJwt,
        expiresAt: exp * 1000,
        canvasId: null,
        canvasName: null,
        scope: 'guest_create',
        issuer: invite.issuer,
        guestId,
        permittedCanvases,
        permittedProjects,
        isAdmin: false,
        displayName,
        pairingId,
        accountId: invite.issuer || null,
        guestName: invite.guestName || null,
        guestEmail: invite.guestEmail || null,
        issuerName: invite.issuedByName || displayName || null,
        issuerEmail: invite.issuerEmail || null,
      });
    }
  }

  const record = await kvsGet(`canvasTokens:${token}`);
  if (!record) {
    return errorResult('TOKEN_INVALID', 'Canvas token not found.');
  }
  if (record.revoked) {
    return errorResult('TOKEN_INVALID', 'Canvas token has been revoked.');
  }
  if (record.expiresAt && record.expiresAt < now) {
    return errorResult('TOKEN_EXPIRED', 'Canvas token has expired.');
  }

  // Guest invites are handled by the invite branch above; a guest record here
  // would bypass pairing entirely, so it is refused rather than minted.
  if (record.scope === 'guest_create') {
    return errorResult('TOKEN_INVALID', 'This invite must be used from its installer link.');
  }

  let permittedProjects;
  if (typeof record.permittedProjectsJson === 'string') {
    try {
      permittedProjects = JSON.parse(record.permittedProjectsJson);
    } catch (e) {
      permittedProjects = [];
    }
  } else {
    permittedProjects = record.permittedProjects === undefined ? [] : record.permittedProjects;
  }

  const sessionJwt = await generateSessionJwt({
    iss: 'jiratack',
    sub: record.userId,
    aud: record.installationId,
    canvasId: record.canvasName,
    canvasName: record.canvasName,
    scope: record.scope,
    permittedProjects,
    isAdmin: record.isAdmin === true,
    iat,
    exp,
  });

  const config = await getInstallationConfig();
  const displayName = await getDisplayName(record.userId);
  await heartbeat({ kind: 'user', id: record.userId });
  return commonResponse(config, {
    sessionJwt,
    expiresAt: exp * 1000,
    canvasId: record.canvasName,
    canvasName: record.canvasName,
    scope: record.scope,
    permittedProjects,
    isAdmin: record.isAdmin === true,
    displayName,
    accountId: record.userId || null,
  });
}

/**
 * Flow 1 (D46): trade the one-time code a Jira tab minted for the credential the
 * extension stores. The result has the same shape the pasted link used to carry,
 * so the extension and the SDK keep working unchanged; only the delivery is new.
 */
export async function exchangeLoginCode(payload, request) {
  const code = payload && typeof payload.code === 'string' ? payload.code : '';
  if (!/^[a-f0-9]{64}$/.test(code)) {
    return errorResult('TOKEN_INVALID', 'This login code is not valid.');
  }

  const key = `extensionLoginCodes:${code}`;
  const record = await kvsGet(key);
  if (!record) {
    return errorResult('TOKEN_INVALID', 'This login code has expired or was already used. Sign in again from Jira.');
  }
  if (record.expiresAt && record.expiresAt < Date.now()) {
    return errorResult('TOKEN_EXPIRED', 'This login code has expired. Sign in again from Jira.');
  }

  // Single-use, and removed before minting so a lost reply costs a second
  // sign-in rather than leaving a live code behind.
  await kvsDelete(key);

  let permittedProjects = [];
  try {
    permittedProjects = JSON.parse(record.permittedProjectsJson || '[]');
  } catch (e) {
    permittedProjects = [];
  }

  const token = crypto.randomBytes(32).toString('hex');
  const issuedAt = Date.now();
  const expiresAt = issuedAt + USER_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

  try {
    await kvsSet(`userTokens:${token}`, {
      userId: String(record.accountId || ''),
      installationId: String(record.installationId || ''),
      scope: 'create',
      isAdmin: record.isAdmin === true,
      issuedAt,
      expiresAt,
      revoked: false,
      permittedProjectsJson: JSON.stringify(permittedProjects),
      permittedCanvasesJson: JSON.stringify('all'),
      issuedVia: 'extension_login',
    }, { ttl: { value: USER_TOKEN_TTL_DAYS, unit: 'DAYS' } });
  } catch (e) {
    return errorResult('INTERNAL', `Failed to persist the extension credential: ${e && e.message ? e.message : e}`);
  }

  const config = await getInstallationConfig();
  const displayName = await getDisplayName(record.accountId);
  await heartbeat({ kind: 'user', id: record.accountId });

  return commonResponse(config, {
    token,
    accountId: record.accountId || null,
    isAdmin: record.isAdmin === true,
    permittedProjects,
    permittedCanvases: 'all',
    displayName,
    expiresAt,
  });
}
