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

/**
 * One batched KVS read instead of one per candidate. Returns a Set so callers
 * avoid N individual round-trips in search hot paths.
 */
export async function findLicensedUsers(accountIds) {
  const ids = (Array.isArray(accountIds) ? accountIds : [])
    .filter((id) => typeof id === 'string' && id.length > 0);
  const licensed = new Set();
  if (ids.length === 0) return licensed;

  try {
    const values = await kvsGet(ids.map(licensedUserKey));
    ids.forEach((id, index) => {
      if (Array.isArray(values) ? values[index] : values) licensed.add(id);
    });
  } catch (e) {
    console.error('[JiraTack] Batched licensed-user read failed, falling back:', e);
    const results = await Promise.all(ids.map(async (id) => ({ id, ok: await isLicensedUser(id) })));
    results.forEach(({ id, ok }) => { if (ok) licensed.add(id); });
  }
  return licensed;
}
