import { kvsGet, kvsSet } from './kvs.js';

const LICENSED_USER_PREFIX = 'jiratack_licensed_users:';

export function licensedUserKey(accountId) {
  return `${LICENSED_USER_PREFIX}${accountId}`;
}

/**
 * Records that a Jira user currently holds a JiraTack license.
 * Runs inside Jira resolvers, where context.userAccess is available.
 * Never throws: tracking must not break the resolver.
 */
export async function trackLicensedUser(context) {
  if (!context || !context.userAccess || context.userAccess.hasAccess !== true) return;
  const accountId = context.accountId || context.userId;
  if (!accountId) return;

  try {
    await kvsSet(licensedUserKey(accountId), true);
  } catch (e) {
    console.error('[JiraTack] Failed to track licensed user:', e);
  }
}

export async function isLicensedUser(accountId) {
  if (typeof accountId !== 'string' || accountId.length === 0) return false;
  try {
    return Boolean(await kvsGet(licensedUserKey(accountId)));
  } catch (e) {
    console.error('[JiraTack] Failed to read licensed user:', e);
    return false;
  }
}
