import api, { route } from '@forge/api';
import { getInstallationConfig } from '../../lib/config.js';
import { errorResult } from '../../lib/errors.js';
import { normalizeUrl } from '../../shared/urlNormalize.js';
import { METADATA_PROPERTY_KEY, metadataFromIssue } from '../../lib/metadata.js';
import { loadCanvasNameIndex, loadCanvasRecords, normaliseCanvasName } from '../../lib/canvasRegistry.js';
import { findRecordByName } from '../../lib/canvasNames.js';
import { findCanvasKeyInMaps } from '../../lib/canvasIdentity.js';

const PAGE_SIZE = 100;
const MAX_TICKETS = 2000;

export async function listCanvasesForUser(payload, claims) {
  const config = await getInstallationConfig();
  const archived = new Set(Array.isArray(config.archivedCanvases) ? config.archivedCanvases : []);
  const deleted = new Set(Array.isArray(config.deletedCanvases) ? config.deletedCanvases : []);

  const jql = 'labels = "jiratack" ORDER BY created DESC';
  const fields = ['project'];

  // Renaming only changes the registry record; tickets keep the name from
  // capture time. Group by the stable key and show the CURRENT name (D43).
  const records = await loadCanvasRecords();
  const nameIndex = await loadCanvasNameIndex();
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
        const capturedName = metadata.pin.canvas;
        if (!capturedName) continue;

        // One resolver decides which canvas a ticket belongs to (D42). A
        // keyless group is what listed one canvas twice.
        const canvasKey = findCanvasKeyInMaps(
          { canvasKey: metadata.pin.canvasId, canvasName: capturedName },
          records,
          nameIndex,
        );
        const record = (canvasKey && records.get(canvasKey))
          || findRecordByName(records, capturedName)
          || null;
        const displayName = (record && record.name) || capturedName;
        // Group by the stable key when one is known, otherwise by name so a
        // mixed set of old and new tickets still lands in one entry.
        const entryKey = canvasKey || `name:${normaliseCanvasName(displayName)}`;

        let entry = canvases.get(entryKey);
        if (!entry) {
          entry = {
            canvasKey,
            canvasName: displayName,
            names: new Set((record && record.names) || [capturedName]),
            urls: new Set(),
            projectKeys: new Set(),
          };
          canvases.set(entryKey, entry);
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

    // Selected-canvases bookmarks (D43): a list restricts the launcher to those
    // names; 'all' (or a missing claim) keeps every accessible canvas.
    const permittedCanvases = (claims && claims.permittedCanvases !== undefined)
      ? claims.permittedCanvases
      : 'all';
    const canvasAllowed = (entry) => {
      if (permittedCanvases === 'all' || !Array.isArray(permittedCanvases)) return true;
      if (permittedCanvases.includes(entry.canvasName)) return true;
      // A bookmark made before a rename still names the old label.
      return Array.from(entry.names || []).some((name) => permittedCanvases.includes(name));
    };
    const canAccess = (entry) => {
      if (permittedProjects === '*') return true;
      if (!Array.isArray(permittedProjects)) return false;
      if (entry.projectKeys.size === 0) return true;
      return Array.from(entry.projectKeys).some((key) => permittedProjects.includes(key));
    };

    // Last line of defence: one entry per canvas name. Entries are already
    // grouped by key, so this only merges a keyless leftover into the keyed
    // entry that owns the same label.
    const byLabel = new Map();
    for (const entry of canvases.values()) {
      const label = normaliseCanvasName(entry.canvasName);
      const existing = byLabel.get(label);
      if (!existing) {
        byLabel.set(label, entry);
        continue;
      }
      const winner = existing.canvasKey ? existing : entry;
      const loser = winner === existing ? entry : existing;
      winner.names = new Set([...(winner.names || []), ...(loser.names || [])]);
      (loser.urls || []).forEach((url) => winner.urls.add(url));
      (loser.projectKeys || []).forEach((key) => winner.projectKeys.add(key));
      byLabel.set(label, winner);
    }

    const result = Array.from(byLabel.values())
      .filter((entry) => canvasAllowed(entry))
      .filter(canAccess)
      .filter((entry) => !Array.from(entry.names).some((name) => archived.has(name) || deleted.has(name)))
      .map((entry) => ({
        canvasName: entry.canvasName,
        canvasKey: entry.canvasKey,
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
