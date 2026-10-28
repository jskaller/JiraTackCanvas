import api, { route } from '@forge/api';
import { getInstallationConfig } from '../../lib/config.js';
import { errorResult } from '../../lib/errors.js';
import { normalizeUrl } from '../../shared/urlNormalize.js';
import { METADATA_PROPERTY_KEY, metadataFromIssue } from '../../lib/metadata.js';

const PAGE_SIZE = 100;
const MAX_TICKETS = 2000;

export async function listCanvasesForUser(payload, claims) {
  const config = await getInstallationConfig();
  const archived = new Set(Array.isArray(config.archivedCanvases) ? config.archivedCanvases : []);
  const deleted = new Set(Array.isArray(config.deletedCanvases) ? config.deletedCanvases : []);

  const jql = 'labels = "jiratack" ORDER BY created DESC';
  const fields = ['project'];

  const canvases = new Map();
  let nextPageToken = null;
  let fetched = 0;

  try {
    do {
      const body = {
        jql,
        fields,
        properties: [METADATA_PROPERTY_KEY],
        maxResults: PAGE_SIZE,
      };
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
        const metadata = metadataFromIssue(issue);
        if (!metadata) continue;
        const canvasName = metadata.pin.canvas;
        if (!canvasName) continue;

        let entry = canvases.get(canvasName);
        if (!entry) {
          entry = { canvasName, urls: new Set(), projectKeys: new Set() };
          canvases.set(canvasName, entry);
        }

        const issueFields = issue.fields || {};
        if (issueFields.project && issueFields.project.key) {
          entry.projectKeys.add(issueFields.project.key);
        }

        if (metadata.pin.url) {
          entry.urls.add(normalizeUrl(metadata.pin.url));
        }
      }

      fetched += issues.length;
      nextPageToken = data && !data.isLast ? data.nextPageToken : null;
      if (!nextPageToken || issues.length === 0) break;
    } while (fetched < MAX_TICKETS);

    const permittedProjects = (claims && claims.permittedProjects !== undefined)
      ? claims.permittedProjects
      : '*';
    const canAccess = (entry) => {
      if (permittedProjects === '*') return true;
      if (!Array.isArray(permittedProjects)) return false;
      if (entry.projectKeys.size === 0) return true;
      return Array.from(entry.projectKeys).some((key) => permittedProjects.includes(key));
    };

    const result = Array.from(canvases.values())
      .filter(canAccess)
      .filter((entry) => !archived.has(entry.canvasName) && !deleted.has(entry.canvasName))
      .map((entry) => ({
        canvasName: entry.canvasName,
        urlCount: entry.urls.size,
        urls: Array.from(entry.urls),
      }))
      .sort((a, b) => a.canvasName.localeCompare(b.canvasName));

    console.log('[JiraTack] listCanvasesForUser:', {
      scanned: fetched,
      totalCanvases: canvases.size,
      returned: result.length,
      permittedProjects,
    });

    return { ok: true, data: { canvases: result } };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}
