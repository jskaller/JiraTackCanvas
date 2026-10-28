import api, { route } from '@forge/api';
import { errorResult } from '../../lib/errors.js';
import { findLicensedUsers } from '../../lib/license.js';

export async function searchUsers(payload, claims) {
  const projectKey = payload && payload.projectKey;
  const query = (payload && payload.query) || '';

  if (typeof projectKey !== 'string' || projectKey.length === 0) {
    return errorResult('BAD_REQUEST', 'projectKey is required.');
  }

  const guest = Boolean(claims && claims.scope === 'guest_create');
  const maxResults = guest ? 50 : 10;

  const res = await api.asApp().requestJira(
    route`/rest/api/3/user/assignable/search?project=${projectKey}&query=${encodeURIComponent(query)}&maxResults=${maxResults}`,
  );
  if (!res.ok) {
    if (res.status === 404) {
      return errorResult('NOT_FOUND', 'Project not found.');
    }
    return errorResult('INTERNAL', `Jira user search failed with HTTP ${res.status}.`);
  }

  const data = await res.json();
  const values = Array.isArray(data) ? data : ((data && data.values) || []);
  let users = values.map((u) => ({
    accountId: u.accountId,
    displayName: u.displayName,
    avatarUrl: (u.avatarUrls && u.avatarUrls['48x48']) || null,
  }));

  if (guest) {
    // Guests may only assign tickets to users known to hold a JiraTack license.
    const licensed = await findLicensedUsers(users.map((user) => user.accountId));
    users = users.filter((user) => licensed.has(user.accountId));
  }

  return { ok: true, data: { users } };
}
