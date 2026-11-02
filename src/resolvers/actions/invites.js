import { errorResult } from '../../lib/errors.js';
import { isJiraAdmin } from '../../lib/access.js';
import { listInvites, setInviteState, revokeInvite, regenerateInvite } from '../../lib/invites.js';
import { resolveWebtriggerUrls } from '../../lib/webtriggerUrls.js';
import { getInstallationConfig } from '../../lib/config.js';

function viewerOf(context) {
  return (context && (context.accountId || context.userId)) || '';
}

function hasSeat(context) {
  return !(context && context.userAccess && context.userAccess.hasAccess === false);
}

/**
 * Delegators manage their own invitations; admins manage all. Resolvers are
 * reachable by any logged-in user, so the check is server-side per operation.
 */
export async function listGuestInvites(context) {
  const viewer = viewerOf(context);
  const admin = await isJiraAdmin(context);
  if (!admin && !hasSeat(context)) {
    return errorResult('LICENSE_INACTIVE', 'JiraTack license is not active.');
  }
  try {
    const invites = await listInvites({ viewerAccountId: viewer, isAdmin: admin });
    return { ok: true, data: { invites, isAdmin: admin } };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

export async function setGuestInviteActive(context, payload) {
  const viewer = viewerOf(context);
  const admin = await isJiraAdmin(context);
  if (!admin && !hasSeat(context)) {
    return errorResult('LICENSE_INACTIVE', 'JiraTack license is not active.');
  }
  const ref = payload && payload.tokenRef;
  const active = Boolean(payload && payload.active);
  if (typeof ref !== 'string' || ref.length === 0) {
    return errorResult('BAD_REQUEST', 'tokenRef is required.');
  }
  const result = await setInviteState({ ref, active, viewerAccountId: viewer, isAdmin: admin });
  return result.ok ? { ok: true, data: result.data } : errorResult(result.code, result.message);
}

export async function revokeGuestInvite(context, payload) {
  const viewer = viewerOf(context);
  const admin = await isJiraAdmin(context);
  if (!admin && !hasSeat(context)) {
    return errorResult('LICENSE_INACTIVE', 'JiraTack license is not active.');
  }
  const ref = payload && payload.tokenRef;
  if (typeof ref !== 'string' || ref.length === 0) {
    return errorResult('BAD_REQUEST', 'tokenRef is required.');
  }
  const result = await revokeInvite({ ref, viewerAccountId: viewer, isAdmin: admin, reason: 'revoked' });
  return result.ok ? { ok: true, data: result.data } : errorResult(result.code, result.message);
}

export async function regenerateGuestInvite(context, payload) {
  const viewer = viewerOf(context);
  const admin = await isJiraAdmin(context);
  if (!admin && !hasSeat(context)) {
    return errorResult('LICENSE_INACTIVE', 'JiraTack license is not active.');
  }
  const ref = payload && payload.tokenRef;
  if (typeof ref !== 'string' || ref.length === 0) {
    return errorResult('BAD_REQUEST', 'tokenRef is required.');
  }

  let installationId = '';
  try {
    const config = await getInstallationConfig();
    void config;
  } catch (e) {
    installationId = '';
  }

  const result = await regenerateInvite({
    ref,
    viewerAccountId: viewer,
    isAdmin: admin,
    installationId: installationId || (context && context.installationId) || '',
  });
  if (!result.ok) return errorResult(result.code, result.message);

  let installerUrl = null;
  try {
    const config = await getInstallationConfig();
    const { installUrl } = await resolveWebtriggerUrls(config);
    installerUrl = installUrl
      ? `${installUrl}${installUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(result.data.token)}`
      : null;
  } catch (e) {
    installerUrl = null;
  }

  return { ok: true, data: { installerUrl, tokenRef: payload.tokenRef } };
}
