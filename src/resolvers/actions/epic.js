import api, { route } from '@forge/api';
import { getInstallationConfig } from '../../lib/config.js';
import { errorResult } from '../../lib/errors.js';
import { normalizeUrl } from '../../shared/urlNormalize.js';

function escapeJql(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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

async function searchIssues(jql, fields, maxResults) {
  const res = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql, fields, maxResults }),
  });
  if (!res.ok) {
    throw new Error(`JQL query failed with HTTP ${res.status}.`);
  }
  const data = await res.json();
  return (data && data.issues) || [];
}

async function countIssues(jql) {
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/search/approximate-count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.count === 'number') return data.count;
    }
  } catch (e) {
    // fall through to paginated count
  }

  let total = 0;
  let nextPageToken = null;
  for (let page = 0; page < 20; page += 1) {
    const body = { jql, fields: ['key'], maxResults: 100 };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const res = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) break;
    const data = await res.json();
    const issues = (data && data.issues) || [];
    total += issues.length;
    if (data && (data.isLast || !data.nextPageToken)) break;
    nextPageToken = data && data.nextPageToken;
    if (!nextPageToken) break;
  }
  return total;
}

export async function epicPanelData(context, payload) {
  const epicKey = payload && payload.epicKey;
  if (typeof epicKey !== 'string' || epicKey.length === 0) {
    return errorResult('BAD_REQUEST', 'epicKey is required.');
  }

  const config = await getInstallationConfig();
  const fieldRegistry = config.fieldRegistry || {};
  if (!fieldRegistry.canvasField) {
    return { ok: true, data: { canvases: [], jiraBaseUrl: null, canvasFieldId: null } };
  }

  const fields = [fieldRegistry.canvasField, fieldRegistry.urlField].filter(Boolean);
  const escapedEpic = escapeJql(epicKey);

  const companyJql = `"Epic Link" = "${escapedEpic}" AND "${fieldRegistry.canvasField}" is not EMPTY`;
  const teamJql = `parent = "${escapedEpic}" AND "${fieldRegistry.canvasField}" is not EMPTY`;

  const issuesByKey = new Map();
  const warnings = [];

  try {
    const companyIssues = await searchIssues(companyJql, fields, 100);
    companyIssues.forEach((issue) => issuesByKey.set(issue.key, issue));
  } catch (e) {
    warnings.push(`Company-managed query failed: ${e && e.message ? e.message : e}`);
  }

  try {
    const teamIssues = await searchIssues(teamJql, fields, 100);
    teamIssues.forEach((issue) => issuesByKey.set(issue.key, issue));
  } catch (e) {
    warnings.push(`Team-managed query failed: ${e && e.message ? e.message : e}`);
  }

  if (warnings.length === 2) {
    return errorResult('INTERNAL', 'Both epic queries failed.');
  }

  const canvases = new Map();

  for (const issue of issuesByKey.values()) {
    const issueFields = issue.fields || {};
    const canvasName = issueFields[fieldRegistry.canvasField];
    if (!canvasName) continue;

    let entry = canvases.get(canvasName);
    if (!entry) {
      entry = { canvasName, epicTicketCount: 0, urls: new Set() };
      canvases.set(canvasName, entry);
    }

    entry.epicTicketCount += 1;
    if (fieldRegistry.urlField && issueFields[fieldRegistry.urlField]) {
      entry.urls.add(normalizeUrl(issueFields[fieldRegistry.urlField]));
    }
  }

  const summaries = [];
  for (const entry of canvases.values()) {
    let totalTicketCount = entry.epicTicketCount;
    try {
      totalTicketCount = await countIssues(
        `"${fieldRegistry.canvasField}" = "${escapeJql(entry.canvasName)}"`,
      );
    } catch (e) {
      warnings.push(`Total count failed for ${entry.canvasName}: ${e && e.message ? e.message : e}`);
    }

    summaries.push({
      canvasName: entry.canvasName,
      epicTicketCount: entry.epicTicketCount,
      totalTicketCount,
      urlCount: entry.urls.size,
    });
  }

  summaries.sort((a, b) => a.canvasName.localeCompare(b.canvasName));

  return {
    ok: true,
    data: {
      canvases: summaries,
      warnings,
      jiraBaseUrl: await fetchJiraBaseUrl(),
      canvasFieldId: fieldRegistry.canvasField,
    },
  };
}
