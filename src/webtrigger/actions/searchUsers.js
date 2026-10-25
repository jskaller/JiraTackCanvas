import api, { route } from '@forge/api';
import { errorResult } from '../../lib/errors.js';

export async function searchUsers(payload) {
  const projectKey = payload && payload.projectKey;
  const query = (payload && payload.query) || '';

  if (typeof projectKey !== 'string' || projectKey.length === 0) {
    return errorResult('BAD_REQUEST', 'projectKey is required.');
  }

  const res = await api.asApp().requestJira(
    route`/rest/api/3/user/assignable/search?project=${projectKey}&query=${encodeURIComponent(query)}&maxResults=10`,
  );
  if (!res.ok) {
    if (res.status === 404) {
      return errorResult('NOT_FOUND', 'Project not found.');
    }
    return errorResult('INTERNAL', `Jira user search failed with HTTP ${res.status}.`);
  }

  const data = await res.json();
  const values = Array.isArray(data) ? data : ((data && data.values) || []);
  const users = values.map((u) => ({
    accountId: u.accountId,
    displayName: u.displayName,
    avatarUrl: (u.avatarUrls && u.avatarUrls['48x48']) || null,
  }));

  return { ok: true, data: { users } };
}
