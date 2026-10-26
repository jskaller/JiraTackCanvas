import api, { route } from '@forge/api';
import { errorResult } from '../../lib/errors.js';

export async function getIssueTypes(payload) {
  try {
    const rawKey = payload && payload.projectKey;
    const projectKey = typeof rawKey === 'string' ? rawKey.trim().toUpperCase() : '';

    if (!projectKey) {
      return errorResult('BAD_REQUEST', 'projectKey is required.');
    }

    console.log('[JiraTack] getIssueTypes for project:', projectKey);

    const res = await api.asApp().requestJira(
      route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`,
    );

    if (!res.ok) {
      console.error('[JiraTack] getIssueTypes failed with HTTP', res.status);
      if (res.status === 404) {
        return errorResult('NOT_FOUND', 'Project not found. Check the key and try again.');
      }
      return errorResult('INTERNAL', `Jira issue types lookup failed with HTTP ${res.status}.`);
    }

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      return errorResult('INTERNAL', 'Jira returned an invalid issue types response.');
    }

    const list = (data && data.issueTypes) || (data && data.values) || [];
    const issueTypes = list.map((type) => ({
      id: String(type.id),
      name: type.name,
      subtask: Boolean(type.subtask),
    }));

    return { ok: true, data: { issueTypes } };
  } catch (e) {
    console.error('[JiraTack] getIssueTypes exception:', e);
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}
