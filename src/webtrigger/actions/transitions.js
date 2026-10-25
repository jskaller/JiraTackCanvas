import api, { route } from '@forge/api';
import { errorResult } from '../../lib/errors.js';

export async function getTransitions(payload) {
  const issueKey = payload && payload.issueKey;
  if (typeof issueKey !== 'string' || issueKey.length === 0) {
    return errorResult('BAD_REQUEST', 'issueKey is required.');
  }

  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions`);
  if (!res.ok) {
    if (res.status === 404) {
      return errorResult('NOT_FOUND', 'Issue not found.');
    }
    return errorResult('INTERNAL', `Jira transitions lookup failed with HTTP ${res.status}.`);
  }

  const data = await res.json();
  const transitions = ((data && data.transitions) || []).map((t) => ({
    id: t.id,
    name: t.name,
    to: {
      id: t.to && t.to.id,
      name: t.to && t.to.name,
      statusCategory: { key: t.to && t.to.statusCategory && t.to.statusCategory.key },
    },
  }));

  return { ok: true, data: { transitions } };
}
