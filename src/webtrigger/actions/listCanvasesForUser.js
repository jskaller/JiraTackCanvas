import api, { route } from '@forge/api';
import { getInstallationConfig } from '../../lib/config.js';
import { errorResult } from '../../lib/errors.js';
import { normalizeUrl } from '../../shared/urlNormalize.js';

const PAGE_SIZE = 100;
const MAX_TICKETS = 2000;

export async function listCanvasesForUser(payload, claims) {
  const config = await getInstallationConfig();
  const fieldRegistry = config.fieldRegistry || {};

  if (!fieldRegistry.canvasField) {
    return { ok: true, data: { canvases: [] } };
  }

  const jql = `labels = "jiratack" ORDER BY created DESC`;
  const fields = [fieldRegistry.canvasField, fieldRegistry.urlField, 'project'].filter(Boolean);

  const canvases = new Map();
  let nextPageToken = null;
  let fetched = 0;

  try {
    do {
      const body = { jql, fields, maxResults: PAGE_SIZE };
      if (nextPageToken) body.nextPageToken = nextPageToken;

      const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        return errorResult('INTERNAL', `Jira search failed with HTTP ${res.status}.`);
      }

      const data = await res.json();
      const issues = (data && data.issues) || [];

      for (const issue of issues) {
        const issueFields = issue.fields || {};
        const canvasName = issueFields[fieldRegistry.canvasField];
        if (!canvasName) continue;

        let entry = canvases.get(canvasName);
        if (!entry) {
          entry = { canvasName, urls: new Set(), projectKeys: new Set() };
          canvases.set(canvasName, entry);
        }

        if (issueFields.project && issueFields.project.key) {
          entry.projectKeys.add(issueFields.project.key);
        }

        if (fieldRegistry.urlField && issueFields[fieldRegistry.urlField]) {
          entry.urls.add(normalizeUrl(issueFields[fieldRegistry.urlField]));
        }
      }

      fetched += issues.length;
      nextPageToken = data && !data.isLast ? data.nextPageToken : null;
      if (!nextPageToken || issues.length === 0) break;
    } while (fetched < MAX_TICKETS);

    const permittedProjects = claims && claims.permittedProjects !== undefined
      ? claims.permittedProjects
      : [];
    const canAccess = (entry) => {
      if (permittedProjects === '*') return true;
      if (!Array.isArray(permittedProjects)) return false;
      return Array.from(entry.projectKeys).some((key) => permittedProjects.includes(key));
    };

    const result = Array.from(canvases.values())
      .filter(canAccess)
      .map((entry) => ({ canvasName: entry.canvasName, urlCount: entry.urls.size }))
      .sort((a, b) => a.canvasName.localeCompare(b.canvasName));

    return { ok: true, data: { canvases: result } };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}
