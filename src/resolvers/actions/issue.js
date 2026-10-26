import api, { route } from '@forge/api';
import { getInstallationConfig } from '../../lib/config.js';
import { errorResult } from '../../lib/errors.js';

function escapeJql(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function appendTicketParam(url, issueKey) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('jiratack_ticket', issueKey);
    return parsed.toString();
  } catch (e) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}jiratack_ticket=${encodeURIComponent(issueKey)}`;
  }
}

async function fetchJiraBaseUrl() {
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/serverInfo`);
    if (res.ok) {
      const data = await res.json();
      return data && data.baseUrl ? data.baseUrl : null;
    }
  } catch (e) {
    return null;
  }
  return null;
}

export async function issuePanelData(context, payload) {
  const issueKey = payload && payload.issueKey;
  if (typeof issueKey !== 'string' || issueKey.length === 0) {
    return errorResult('BAD_REQUEST', 'issueKey is required.');
  }

  const config = await getInstallationConfig();
  const fieldRegistry = config.fieldRegistry || {};
  if (!fieldRegistry.canvasField) {
    return { ok: true, data: { isJiraTack: false } };
  }

  const fieldsParam = [fieldRegistry.canvasField, fieldRegistry.urlField].filter(Boolean).join(',');

  let issue;
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}?fields=${fieldsParam}`);
    if (!res.ok) {
      if (res.status === 404) {
        return errorResult('NOT_FOUND', 'Issue not found.');
      }
      return errorResult('INTERNAL', `Failed to read issue with HTTP ${res.status}.`);
    }
    issue = await res.json();
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }

  const issueFields = (issue && issue.fields) || {};
  const canvasName = issueFields[fieldRegistry.canvasField];
  if (!canvasName) {
    return { ok: true, data: { isJiraTack: false } };
  }

  const url = fieldRegistry.urlField ? (issueFields[fieldRegistry.urlField] || null) : null;
  let relatedTickets = [];

  if (url && fieldRegistry.urlField) {
    const jql = `"${fieldRegistry.canvasField}" = "${escapeJql(canvasName)}" AND "${fieldRegistry.urlField}" = "${escapeJql(url)}" AND key != ${issueKey} ORDER BY created ASC`;
    try {
      const res = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jql,
          fields: ['summary', 'status', 'issuetype'],
          maxResults: 20,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        relatedTickets = ((data && data.issues) || []).map((related) => ({
          key: related.key,
          summary: (related.fields && related.fields.summary) || '',
          status: {
            name: (related.fields && related.fields.status && related.fields.status.name) || '',
          },
          issueType: {
            name: (related.fields && related.fields.issuetype && related.fields.issuetype.name) || '',
          },
        }));
      }
    } catch (e) {
      relatedTickets = [];
    }
  }

  return {
    ok: true,
    data: {
      canvasName,
      url,
      relatedTickets,
      deepLink: appendTicketParam(url, issueKey),
      jiraBaseUrl: await fetchJiraBaseUrl(),
    },
  };
}
