import crypto from 'crypto';
import api, { route, getAppContext } from '@forge/api';
import { WhereConditions } from '@forge/kvs';
import { getInstallationConfig, mutateInstallationConfig } from '../../lib/config.js';
import { kvs, kvsGet, kvsSet, kvsQueryAll } from '../../lib/kvs.js';
import { trackLicensedUser } from '../../lib/license.js';
import { generateSessionJwt } from '../../lib/tokens.js';
import { errorResponse, errorResult } from '../../lib/errors.js';
import { resolveWebtriggerUrls } from '../../lib/webtriggerUrls.js';
import { createSeedTicket } from '../../lib/canvas.js';
import { createInvite } from '../../lib/invites.js';
import { tokenReference } from '../../lib/tokenRef.js';
import { isJiraAdmin, requireAdmin } from '../../lib/access.js';
import { METADATA_PROPERTY_KEY, metadataFromIssue } from '../../lib/metadata.js';
import { SDK_VERSION } from '../../lib/version.js';

const CANVAS_TOKEN_TTL_SECONDS = 2592000;
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function resolveInstallationId(context) {
  try {
    const ari = getAppContext().installationAri;
    if (ari) return ari.toString();
  } catch (e) {
    // fall through
  }
  return (context && context.installationId) || (context && context.extension && context.extension.installation && context.extension.installation.id) || '';
}

async function lookupUser(accountId) {
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

async function computePermittedProjects(mode, canvasName) {
  if (mode === 'open') {
    return { ok: true, permittedProjects: '*' };
  }

  const raw = await api.asUser().requestJira(route`/rest/api/3/project/search?action=browse&maxResults=100`);
  const payload = await raw.json();
  const values = (payload && payload.values) || payload || [];
  const projects = Array.isArray(values) ? values : [];
  const permittedProjects = projects.length >= 100 ? '*' : projects.map((p) => p.key);

  if (permittedProjects === '*' || !canvasName) {
    return { ok: true, permittedProjects };
  }

  const search = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql: 'labels = "jiratack"',
      fields: ['project'],
      properties: [METADATA_PROPERTY_KEY],
      maxResults: 100,
    }),
  });
  const searchPayload = await search.json();
  const issues = (searchPayload && searchPayload.issues) || [];
  const pinProjectKeys = [...new Set(
    issues
      .filter((issue) => {
        const metadata = metadataFromIssue(issue);
        return metadata && metadata.pin.canvas === canvasName;
      })
      .map((issue) => issue.fields && issue.fields.project && issue.fields.project.key)
      .filter(Boolean),
  )];
  const intersection = pinProjectKeys.filter((k) => permittedProjects.includes(k));

  if (pinProjectKeys.length > 0 && intersection.length === 0) {
    return {
      ok: false,
      error: errorResponse('NO_CANVAS_ACCESS', 'You do not have access to any project in this canvas.'),
    };
  }

  return { ok: true, permittedProjects };
}

export async function generateCanvasToken(context, payload) {
  await trackLicensedUser(context);

  const canvasName = payload && payload.canvasName;
  const scope = payload && payload.scope;

  if (typeof canvasName !== 'string' || canvasName.length < 1 || canvasName.length > 255) {
    return errorResult('BAD_REQUEST', 'canvasName must be a string between 1 and 255 characters.');
  }
  if (scope !== 'create' && scope !== 'view') {
    return errorResult('BAD_REQUEST', 'scope must be "create" or "view".');
  }

  if (scope === 'create' && context && context.userAccess && context.userAccess.hasAccess === false) {
    return errorResult('LICENSE_INACTIVE', 'JiraTack license is not active.');
  }

  const config = await getInstallationConfig();

  let permitted;
  try {
    permitted = await computePermittedProjects(config.viewPermissionMode, canvasName);
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
  if (!permitted.ok) return permitted;

  const permittedProjects = permitted.permittedProjects;
  const userId = (context && (context.accountId || context.userId)) || '';
  const installationId = resolveInstallationId(context);

  const token = crypto.randomBytes(32).toString('hex');
  const issuedAt = Date.now();
  const expiresAt = issuedAt + CANVAS_TOKEN_TTL_SECONDS * 1000;

  const record = {
    canvasName: String(canvasName),
    userId: String(userId),
    installationId: String(installationId),
    scope: String(scope),
    isAdmin: await isJiraAdmin(context),
    issuedAt,
    expiresAt,
    revoked: false,
    permittedProjectsJson: JSON.stringify(permittedProjects),
  };

  try {
    console.log('[JiraTack] Saving token record:', record);
    await kvsSet(`canvasTokens:${token}`, record, { ttl: { value: 30, unit: 'DAYS' } });
  } catch (e) {
    return errorResult('INTERNAL', `Failed to persist canvas token: ${e && e.message ? e.message : e}`);
  }

  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: 'jiratack',
    sub: userId,
    aud: installationId,
    canvasId: canvasName,
    canvasName,
    scope,
    permittedProjects,
    isAdmin: record.isAdmin === true,
    iat,
    exp: iat + SESSION_TTL_SECONDS,
  };

  let sessionJwt = null;
  try {
    sessionJwt = await generateSessionJwt(claims);
  } catch (e) {
    return errorResult('INTERNAL', `Failed to sign session JWT: ${e && e.message ? e.message : e}`);
  }

  const { apiUrl, sdkUrl } = await resolveWebtriggerUrls(config);

  return {
    ok: true,
    data: {
      token,
      sessionJwt,
      apiUrl,
      sdkUrl,
      sdkVersion: SDK_VERSION,
      canvasId: canvasName,
      canvasName,
      scope,
      permittedProjects,
    },
  };
}

export async function generateGuestToken(context, payload) {
  await trackLicensedUser(context);

  // A guest link is mintable by any user holding a JiraTack seat, not just
  // site admins; the seat is the authorisation boundary.
  if (context && context.userAccess && context.userAccess.hasAccess === false) {
    return errorResult('LICENSE_INACTIVE', 'JiraTack license is not active.');
  }

  const rawCanvases = payload && payload.permittedCanvases;
  if (!Array.isArray(rawCanvases) || rawCanvases.length === 0) {
    return errorResult('VALIDATION_ERROR', 'permittedCanvases must be a non-empty array of canvas names.');
  }
  if (rawCanvases.length > 50) {
    return errorResult('VALIDATION_ERROR', 'permittedCanvases cannot contain more than 50 canvases.');
  }

  const permittedCanvases = [];
  for (const rawCanvas of rawCanvases) {
    const name = typeof rawCanvas === 'string' ? rawCanvas.trim() : '';
    if (name.length === 0 || name.length > 255) {
      return errorResult('VALIDATION_ERROR', 'Each permitted canvas must be a string between 1 and 255 characters.');
    }
    if (!permittedCanvases.includes(name)) permittedCanvases.push(name);
  }

  const config = await getInstallationConfig();

  let permitted;
  try {
    permitted = await computePermittedProjects(config.viewPermissionMode, null);
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
  if (!permitted.ok) return permitted;

  const guestName = typeof (payload && payload.guestName) === 'string' ? payload.guestName.trim() : '';
  const guestEmail = typeof (payload && payload.guestEmail) === 'string' ? payload.guestEmail.trim() : '';
  if (guestName.length === 0 || guestName.length > 200) {
    return errorResult('VALIDATION_ERROR', 'guestName is required (1-200 characters).');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail) || guestEmail.length > 320) {
    return errorResult('VALIDATION_ERROR', 'A valid guestEmail is required.');
  }

  const issuer = (context && (context.accountId || context.userId)) || '';
  const installationId = resolveInstallationId(context);
  const sponsor = await lookupUser(issuer);

  let created;
  try {
    created = await createInvite({
      issuer,
      issuedByName: sponsor.displayName,
      issuerEmail: sponsor.emailAddress,
      guestName,
      guestEmail,
      permittedCanvases,
      permittedProjects: permitted.permittedProjects,
      installationId,
    });
  } catch (e) {
    return errorResult('INTERNAL', `Failed to create the guest invitation: ${e && e.message ? e.message : e}`);
  }
  const token = created.token;

  let installUrl = null;
  try {
    ({ installUrl } = await resolveWebtriggerUrls(config));
  } catch (e) {
    installUrl = null;
  }
  const installerUrl = installUrl
    ? `${installUrl}${installUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
    : null;

  return {
    ok: true,
    data: {
      token,
      installerUrl,
      scope: 'guest_create',
      permittedCanvases,
      permittedProjects: permitted.permittedProjects,
      expiresAt: created.record.linkExpiresAt,
      guestName: created.record.guestName,
      guestEmail: created.record.guestEmail,
    },
  };
}

/**
 * Tokens are credentials. The admin surface never needs the raw value, so
 * records are identified by a short non-reversible reference instead.
 */
async function queryCanvasTokenEntries() {
  return kvsQueryAll('canvasTokens:');
}

export async function listCanvasTokens(context) {
  const denied = await requireAdmin(context, 'Only Jira admins can list tokens.');
  if (denied) return denied;

  try {
    const tokens = (await queryCanvasTokenEntries())
      .map(({ key, value }) => ({
        tokenRef: tokenReference(String(key).replace('canvasTokens:', '')),
        canvasName: value.canvasName,
        userId: value.userId,
        scope: value.scope,
        issuedAt: value.issuedAt,
        expiresAt: value.expiresAt,
        revoked: Boolean(value.revoked),
      }))
      .sort((a, b) => (b.issuedAt || 0) - (a.issuedAt || 0));

    return { ok: true, data: { tokens } };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

export async function revokeCanvasToken(context, payload) {
  const denied = await requireAdmin(context, 'Only Jira admins can revoke tokens.');
  if (denied) return denied;

  const token = payload && payload.token;
  const ref = payload && payload.tokenRef;

  try {
    let key = null;
    if (typeof token === 'string' && token.length > 0) {
      key = `canvasTokens:${token}`;
    } else if (typeof ref === 'string' && ref.length > 0) {
      const entries = await queryCanvasTokenEntries();
      const match = entries.find(({ key: entryKey }) => (
        tokenReference(String(entryKey).replace('canvasTokens:', '')) === ref
      ));
      key = match ? match.key : null;
    } else {
      return errorResult('BAD_REQUEST', 'tokenRef is required.');
    }

    if (!key) {
      return errorResult('NOT_FOUND', 'Canvas token not found.');
    }

    const existing = await kvsGet(key);
    if (!existing) {
      return errorResult('NOT_FOUND', 'Canvas token not found.');
    }

    // Tombstone, never delete (D24/S2): credentials derived from this invite
    // must remain resolvable to a revoked parent, and the admin list needs the
    // audit trail. 90 days covers the invitation review window.
    await kvsSet(
      key,
      { ...existing, revoked: true, revokedAt: Date.now() },
      { ttl: { value: 90, unit: 'DAYS' } },
    );
    return { ok: true, data: { revoked: true } };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

const USER_TOKEN_TTL_DAYS = 90;

export async function generateUserToken(context) {
  await trackLicensedUser(context);

  const scope = (context && context.userAccess && context.userAccess.hasAccess === false) ? 'view' : 'create';

  const config = await getInstallationConfig();

  let permitted;
  try {
    permitted = await computePermittedProjects(config.viewPermissionMode, null);
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
  if (!permitted.ok) return permitted;

  const permittedProjects = permitted.permittedProjects;
  const userId = (context && (context.accountId || context.userId)) || '';
  const installationId = resolveInstallationId(context);
  const token = crypto.randomBytes(32).toString('hex');
  const issuedAt = Date.now();
  const expiresAt = issuedAt + USER_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

  const record = {
    userId: String(userId),
    installationId: String(installationId),
    scope,
    isAdmin: await isJiraAdmin(context),
    issuedAt,
    expiresAt,
    revoked: false,
    permittedProjectsJson: JSON.stringify(permittedProjects),
  };

  try {
    console.log('[JiraTack] Saving user token record:', {
      userId: record.userId,
      scope,
      permittedProjects,
      expiresAt,
    });
    await kvsSet(`userTokens:${token}`, record, { ttl: { value: USER_TOKEN_TTL_DAYS, unit: 'DAYS' } });
  } catch (e) {
    return errorResult('INTERNAL', `Failed to persist user token: ${e && e.message ? e.message : e}`);
  }

  const { apiUrl, sdkUrl } = await resolveWebtriggerUrls(config);

  return {
    ok: true,
    data: {
      token,
      apiUrl,
      sdkUrl,
      sdkVersion: SDK_VERSION,
    },
  };
}

export async function createCanvas(context, payload) {
  const denied = await requireAdmin(context, 'Only Jira admins can create canvases.');
  if (denied) return denied;

  try {
    return await createSeedTicket({
      requester: api.asUser(),
      reporterAccountId: context && context.accountId,
      canvasName: payload && payload.canvasName,
      targetUrl: payload && payload.targetUrl,
      projectKey: payload && payload.projectKey,
      issueTypeId: payload && payload.issueTypeId,
    });
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

export async function deleteCanvas(context, payload) {
  const isAdmin = await isJiraAdmin(context);
  if (!isAdmin) {
    return errorResult('INSUFFICIENT_SCOPE', 'Admin access is required.');
  }

  const canvasName = payload && payload.canvasName;
  if (typeof canvasName !== 'string' || canvasName.trim().length === 0) {
    return errorResult('BAD_REQUEST', 'canvasName is required.');
  }

  const jql = `labels = "jiratack" ORDER BY created ASC`;
  const issues = [];
  let nextPageToken = null;
  const MAX_SCANNED = 2000;

  try {
    while (issues.length < MAX_SCANNED) {
      const body = { jql, fields: ['status'], properties: [METADATA_PROPERTY_KEY], maxResults: 100 };
      if (nextPageToken) body.nextPageToken = nextPageToken;

      const res = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        return errorResult('INTERNAL', `Canvas query failed with HTTP ${res.status}.`);
      }

      const data = await res.json();
      const batch = (data && data.issues) || [];
      issues.push(...batch);

      if (batch.length === 0) break;
      if (data && (data.isLast || !data.nextPageToken)) break;
      nextPageToken = data && data.nextPageToken;
      if (!nextPageToken) break;
    }
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }

  const canvasIssues = issues.filter((issue) => {
    const metadata = metadataFromIssue(issue);
    return Boolean(metadata && metadata.pin.canvas === canvasName);
  });

  const openIssues = canvasIssues.filter((issue) => {
    const category = issue.fields && issue.fields.status && issue.fields.status.statusCategory
      ? issue.fields.status.statusCategory.key
      : '';
    return category !== 'done';
  });

  if (openIssues.length > 0) {
    return errorResult(
      'CANVAS_NOT_EMPTY',
      'Cannot delete: This canvas still has open tickets.',
      { openCount: openIssues.length, total: canvasIssues.length },
    );
  }

  try {
    await mutateInstallationConfig((draft) => {
      draft.archivedCanvases = draft.archivedCanvases.filter((name) => name !== canvasName);
      if (!draft.deletedCanvases.includes(canvasName)) {
        draft.deletedCanvases.push(canvasName);
      }
      return draft;
    });
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }

  return { ok: true, data: { canvasName, deleted: true, ticketCount: canvasIssues.length } };
}


export async function archiveCanvas(context, payload) {
  const isAdmin = await isJiraAdmin(context);
  if (!isAdmin) {
    return errorResult('INSUFFICIENT_SCOPE', 'Admin access is required.');
  }

  const canvasName = payload && payload.canvasName;
  if (typeof canvasName !== 'string' || canvasName.trim().length === 0) {
    return errorResult('BAD_REQUEST', 'canvasName is required.');
  }

  try {
    await mutateInstallationConfig((draft) => {
      if (!draft.archivedCanvases.includes(canvasName)) {
        draft.archivedCanvases.push(canvasName);
      }
      return draft;
    });
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }

  return { ok: true, data: { canvasName, archived: true } };
}
