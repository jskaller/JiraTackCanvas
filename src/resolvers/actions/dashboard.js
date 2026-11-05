import api, { route } from '@forge/api';
import { getInstallationConfig } from '../../lib/config.js';
import { errorResult } from '../../lib/errors.js';
import { normalizeUrl, stripDeepLinkParams } from '../../shared/urlNormalize.js';
import { trackLicensedUser } from '../../lib/license.js';
import { SDK_VERSION } from '../../lib/version.js';
import { METADATA_PROPERTY_KEY, metadataFromIssue } from '../../lib/metadata.js';
import {
  adoptLegacyThumbnail,
  ensureCanvasRecord,
  loadCanvasNameIndex,
  loadCanvasRecords,
  loadPreviewCache,
  normaliseCanvasName,
  readPreviewStamp,
  savePreviewCache,
} from '../../lib/canvasRegistry.js';
import { findCanvasKeyInMaps } from '../../lib/canvasIdentity.js';
import { kvsGet, kvsSet, kvsDelete } from '../../lib/kvs.js';
import { countActive } from '../../lib/metering.js';

const PAGE_SIZE = 100;
const MAX_TICKETS = 2000;
const MAX_PARTICIPANTS = 5;
// The scan is expensive; a short per-user cache keeps a dashboard refresh from
// paying for it again (D43). It is per user because the scan runs as the user.
const CACHE_TTL_MS = 120000;
const CACHE_PREFIX = 'canvasSummary:';

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

async function computeIsAdmin(context) {
  if (context && context.userAccess && typeof context.userAccess.isAdmin === 'boolean') {
    return context.userAccess.isAdmin;
  }
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
    if (res.ok) {
      const data = await res.json();
      const permission = data && data.permissions && data.permissions.ADMINISTER;
      return Boolean(permission && permission.havePermission);
    }
  } catch (e) {
    return false;
  }
  return false;
}

function mapUser(user) {
  if (!user || !user.accountId) return null;
  return {
    accountId: user.accountId,
    displayName: user.displayName || null,
    avatarUrl: (user.avatarUrls && user.avatarUrls['48x48']) || null,
  };
}

async function computeAggregate(context) {
  const config = await getInstallationConfig();
  const archived = new Set(Array.isArray(config.archivedCanvases) ? config.archivedCanvases : []);
  const deleted = new Set(Array.isArray(config.deletedCanvases) ? config.deletedCanvases : []);

  // Canvas identity (D42): group by the stable key, not the display name. A
  // ticket written before keys existed resolves through the name index, and a
  // canvas that predates the registry gets a record lazily.
  const records = await loadCanvasRecords();

  // One-time migration (D43): a preview still sitting in the pre-5.72
  // `canvasThumb:` key is adopted onto its record and the old key removed, so
  // the dead generation disappears instead of being carried forever.
  for (const [recordKey, record] of records) {
    if (record.thumbnailVersion === 2 && record.thumbnail) continue;
    const adopted = await adoptLegacyThumbnail(recordKey);
    if (adopted) records.set(recordKey, adopted);
  }

  const nameIndex = await loadCanvasNameIndex();

  // The preview map rides alongside the summary but not inside it: data URLs
  // would blow the cache document (see canvasRegistry.savePreviewCache).
  const previews = {};
  for (const [recordKey, record] of records) {
    if (record.thumbnailVersion === 2 && record.thumbnail) previews[recordKey] = record.thumbnail;
  }

  async function canvasKeyFor(metadata) {
    const pin = (metadata && metadata.pin) || {};
    const known = findCanvasKeyInMaps(
      { canvasKey: pin.canvasId, canvasName: pin.canvas },
      records,
      nameIndex,
    );
    if (known) return known;
    if (!pin.canvas) return null;

    // A canvas that predates the registry still needs a record so it can gain
    // a folder and a preview (D42).
    const ensured = await ensureCanvasRecord({ name: pin.canvas });
    if (!ensured || !ensured.record) return null;
    records.set(ensured.record.key, ensured.record);
    ensured.record.names.forEach((entry) => nameIndex.set(normaliseCanvasName(entry), ensured.record.key));
    return ensured.record.key;
  }

  const fields = ['status', 'updated', 'assignee', 'reporter', 'project'];
  const jql = 'labels = "jiratack" ORDER BY created DESC';

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

      const res = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
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
        const canvasKey = await canvasKeyFor(metadata);
        if (!canvasKey) continue;
        const canvasName = metadata.pin.canvas;
        if (!canvasName) continue;

        let entry = canvases.get(canvasKey);
        if (!entry) {
          const record = records.get(canvasKey) || null;
          entry = {
            canvasKey,
            canvasName: (record && record.name) || canvasName,
            names: (record && record.names) || [canvasName],
            folder: (record && record.folder) || null,
            registryArchived: Boolean(record && record.archived),
            ticketCount: 0,
            openCount: 0,
            urls: new Map(),
            lastUpdated: null,
            projectKeys: new Set(),
            participants: new Map(),
          };
          canvases.set(canvasKey, entry);
        }

        entry.ticketCount += 1;

        const issueFields = issue.fields || {};
        const statusCategory = issueFields.status && issueFields.status.statusCategory
          ? issueFields.status.statusCategory.key
          : null;
        if (statusCategory !== 'done') {
          entry.openCount += 1;
        }

        const urlValue = metadata.pin.url;
        if (urlValue) {
          const normalized = normalizeUrl(stripDeepLinkParams(urlValue));
          entry.urls.set(normalized, (entry.urls.get(normalized) || 0) + 1);
        }

        if (issueFields.updated && (!entry.lastUpdated || issueFields.updated > entry.lastUpdated)) {
          entry.lastUpdated = issueFields.updated;
        }

        if (issueFields.project && issueFields.project.key) {
          entry.projectKeys.add(issueFields.project.key);
        }

        for (const user of [issueFields.assignee, issueFields.reporter]) {
          const mapped = mapUser(user);
          if (mapped && entry.participants.size < MAX_PARTICIPANTS && !entry.participants.has(mapped.accountId)) {
            entry.participants.set(mapped.accountId, mapped);
          }
        }
      }

      fetched += issues.length;
      nextPageToken = data && !data.isLast ? data.nextPageToken : null;
      if (!nextPageToken || issues.length === 0) break;
    } while (fetched < MAX_TICKETS);

    const summaries = Array.from(canvases.values())
      .filter((entry) => !entry.names.some((name) => deleted.has(name)))
      .map((entry) => ({
        canvasKey: entry.canvasKey,
        canvasName: entry.canvasName,
        folder: entry.folder,
        names: entry.names,
        ticketCount: entry.ticketCount,
        openCount: entry.openCount,
        urlCount: entry.urls.size,
        urls: Array.from(entry.urls.entries())
          .map(([url, ticketCount]) => ({ url, ticketCount }))
          .sort((a, b) => {
            if (b.ticketCount !== a.ticketCount) return b.ticketCount - a.ticketCount;
            return a.url.localeCompare(b.url);
          })
          .slice(0, 100),
        lastUpdated: entry.lastUpdated,
        projectKeys: Array.from(entry.projectKeys),
        participants: Array.from(entry.participants.values()),
        archived: entry.registryArchived
          || entry.names.some((name) => archived.has(name)),
      }))
      .sort((a, b) => {
        if (a.lastUpdated === b.lastUpdated) return a.canvasName.localeCompare(b.canvasName);
        if (!a.lastUpdated) return 1;
        if (!b.lastUpdated) return -1;
        return a.lastUpdated < b.lastUpdated ? 1 : -1;
      });

    const hasAccess = !(context && context.userAccess && context.userAccess.hasAccess === false);
    const isAdmin = await computeIsAdmin(context);
    const jiraBaseUrl = await fetchJiraBaseUrl();

    return {
      ok: true,
      data: {
        canvases: summaries,
        previews,
        configVersion: config.configVersion || '',
        hasAccess,
        isAdmin,
        jiraBaseUrl,
      },
    };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

/**
 * Drop one user's cached summary after a write that changes the canvas list, so
 * a new or renamed canvas appears immediately instead of after the TTL (D43).
 */
export async function invalidateCanvasSummary(accountId) {
  if (!accountId) return;
  try {
    await kvsDelete(`${CACHE_PREFIX}${accountId}`);
  } catch (e) {
    // The TTL still bounds staleness.
  }
}

export async function dashboardAggregate(context, payload) {
  await trackLicensedUser(context);

  const accountId = (context && (context.accountId || context.userId)) || 'unknown';
  const cacheKey = `${CACHE_PREFIX}${accountId}`;

  let cached = null;
  try {
    cached = await kvsGet(cacheKey);
  } catch (e) {
    cached = null;
  }

  let snapshot = cached && cached.at && (Date.now() - cached.at) < CACHE_TTL_MS ? cached : null;
  let previews = null;

  if (!snapshot) {
    const computed = await computeAggregate(context);
    if (!computed.ok) return computed;
    const { previews: computedPreviews, ...summary } = computed.data;
    previews = computedPreviews || {};
    snapshot = { at: Date.now(), ...summary };
    try {
      await kvsSet(cacheKey, snapshot, { ttl: { value: 1, unit: 'HOURS' } });
    } catch (e) {
      // A cache write failure only costs the next caller a rescan.
    }
    // Written after computing, so a preview adopted during the aggregate is
    // included and the stamp it is filed under is current.
    await savePreviewCache(previews, await readPreviewStamp());
  }

  const config = await getInstallationConfig();

  const search = payload && typeof payload.search === 'string' ? payload.search.trim().toLowerCase() : '';

  // Previews live on the canvas records. Reading every record on every page
  // view cost ~40 queries at the record cap, so they are cached under a stamp
  // that any write bumps; a changed stamp rebuilds once, in the background of
  // this request. Too many previews to cache falls back to reading records.
  if (!previews) {
    const stamp = await readPreviewStamp();
    const cachedPreviews = await loadPreviewCache();
    if (cachedPreviews && cachedPreviews.stamp === stamp) {
      previews = cachedPreviews.previews;
    } else {
      const records = await loadCanvasRecords();
      previews = {};
      for (const [recordKey, record] of records) {
        if (record.thumbnailVersion === 2 && record.thumbnail) previews[recordKey] = record.thumbnail;
      }
      await savePreviewCache(previews, stamp);
    }
  }

  let list = snapshot.canvases.map((canvas) => ({
    ...canvas,
    thumbnail: previews[canvas.canvasKey] || null,
  }));

  if (search) {
    list = list.filter((canvas) => String(canvas.canvasName || '').toLowerCase().includes(search)
      || String(canvas.canvasKey || '').toLowerCase().includes(search));
  }

  const pageSize = Math.min(500, Math.max(1, Number(payload && payload.pageSize) || 500));
  const page = Math.max(1, Number(payload && payload.page) || 1);
  const total = list.length;
  const start = (page - 1) * pageSize;

  return {
    ok: true,
    data: {
      canvases: list.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
      cachedAt: snapshot.at,
      configVersion: snapshot.configVersion,
      hasAccess: snapshot.hasAccess,
      isAdmin: snapshot.isAdmin,
      jiraBaseUrl: snapshot.jiraBaseUrl,
      sdkVersion: SDK_VERSION,
      store: {
        chrome: config.chromeStoreUrl || '',
        firefox: config.firefoxXpiUrl || '',
      },
      // D47: distinct identities seen inside the activity window. Measurement
      // only — no ceiling is applied here or anywhere else yet.
      meter: await countActive(),
    },
  };
}
