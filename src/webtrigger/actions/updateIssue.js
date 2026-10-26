import api, { route } from '@forge/api';
import { getInstallationConfig } from '../../lib/config.js';
import { errorResult } from '../../lib/errors.js';

export async function updateIssue(payload) {
  const issueKey = payload && payload.issueKey;
  const input = (payload && payload.fields) || {};

  if (typeof issueKey !== 'string' || issueKey.length === 0) {
    return errorResult('BAD_REQUEST', 'issueKey is required.');
  }

  if (input.statusId) {
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition: { id: input.statusId } }),
    });
    if (!res.ok) {
      if (res.status === 400) {
        return errorResult('VALIDATION_ERROR', 'Jira rejected the transition.');
      }
      return errorResult('INTERNAL', `Jira transition failed with HTTP ${res.status}.`);
    }
  }

  const updateFields = {};
  if (Object.prototype.hasOwnProperty.call(input, 'priorityId')) {
    updateFields.priority = input.priorityId ? { id: input.priorityId } : null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'assigneeAccountId')) {
    updateFields.assignee = input.assigneeAccountId ? { accountId: input.assigneeAccountId } : null;
  }

  if (Object.keys(updateFields).length > 0) {
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: updateFields }),
    });
    if (!res.ok) {
      if (res.status === 400) {
        return errorResult('VALIDATION_ERROR', 'Jira rejected the issue update.');
      }
      return errorResult('INTERNAL', `Jira issue update failed with HTTP ${res.status}.`);
    }
  }

  const config = await getInstallationConfig();
  return { ok: true, data: { configVersion: config.configVersion || '' } };
}
