import api, { route } from '@forge/api';
import { errorResult } from './errors.js';

const ADMIN_MESSAGE = 'Jira admin access is required.';

/**
 * Prefer the resolver context's cached answer; fall back to an explicit
 * ADMINISTER permission lookup so callers never have to trust the client.
 */
export async function isJiraAdmin(context) {
  if (context && context.userAccess && typeof context.userAccess.isAdmin === 'boolean') {
    return context.userAccess.isAdmin;
  }
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
    if (!res.ok) return false;
    const data = await res.json();
    const permission = data && data.permissions && data.permissions.ADMINISTER;
    return Boolean(permission && permission.havePermission);
  } catch (e) {
    return false;
  }
}

/**
 * Server-side authorisation guard. Returns null when the caller may proceed,
 * or an error result to return straight to the client. The dashboard is a
 * licensed-user surface, so page-level access scopes are deliberately not used;
 * every privileged operation calls this instead.
 */
export async function requireAdmin(context, message) {
  const admin = await isJiraAdmin(context);
  if (admin) return null;
  return errorResult('INSUFFICIENT_SCOPE', message || ADMIN_MESSAGE);
}
