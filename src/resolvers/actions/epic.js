import api, { route } from '@forge/api';
import { errorResult } from '../../lib/errors.js';
import { normalizeUrl } from '../../shared/urlNormalize.js';
import { METADATA_PROPERTY_KEY, metadataFromIssue } from '../../lib/metadata.js';

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
    body: JSON.stringify({
      jql,
      fields,
      properties: [METADATA_PROPERTY_KEY],
      maxResults,
    }),
  });
  if (!res.ok) {
    throw new Error(`JQL query failed with HTTP ${res.status}.`);
  }
  const data = await res.json();
  return (data && data.issues) || [];
}

export async function epicPanelData(context, payload) {
  const epicKey = payload && payload.epicKey;
  if (typeof epicKey !== 'string' || epicKey.length === 0) {
    return errorResult('BAD_REQUEST', 'epicKey is required.');
  }

  const escapedEpic = escapeJql(epicKey);

  const companyJql = `"Epic Link" = "${escapedEpic}"`;
  const teamJql = `parent = "${escapedEpic}"`;

  const issuesByKey = new Map();
  const warnings = [];

  try {
    const companyIssues = await searchIssues(companyJql, ['project'], 100);
    companyIssues.forEach((issue) => issuesByKey.set(issue.key, issue));
  } catch (e) {
    warnings.push(`Company-managed query failed: ${e && e.message ? e.message : e}`);
  }

  try {
    const teamIssues = await searchIssues(teamJql, ['project'], 100);
    teamIssues.forEach((issue) => issuesByKey.set(issue.key, issue));
  } catch (e) {
    warnings.push(`Team-managed query failed: ${e && e.message ? e.message : e}`);
  }

  if (warnings.length === 2) {
    return errorResult('INTERNAL', 'Both epic queries failed.');
  }

  const canvases = new Map();

  for (const issue of issuesByKey.values()) {
    const metadata = metadataFromIssue(issue);
    if (!metadata) continue;
    const canvasName = metadata.pin.canvas;
    if (!canvasName) continue;

    let entry = canvases.get(canvasName);
    if (!entry) {
      entry = { canvasName, epicTicketCount: 0, urls: new Set() };
      canvases.set(canvasName, entry);
    }

    entry.epicTicketCount += 1;
    if (metadata.pin.url) {
      entry.urls.add(normalizeUrl(metadata.pin.url));
    }
  }

  const summaries = Array.from(canvases.values()).map((entry) => ({
    canvasName: entry.canvasName,
    epicTicketCount: entry.epicTicketCount,
    totalTicketCount: entry.epicTicketCount,
    urlCount: entry.urls.size,
  }));

  summaries.sort((a, b) => a.canvasName.localeCompare(b.canvasName));

  return {
    ok: true,
    data: {
      canvases: summaries,
      warnings,
      jiraBaseUrl: await fetchJiraBaseUrl(),
    },
  };
}
