import api, { route } from '@forge/api';
import { getInstallationConfig } from '../../lib/config.js';
import { errorResult } from '../../lib/errors.js';
import { normalizeUrl } from '../../shared/urlNormalize.js';

const PAGE_SIZE = 100;
const MAX_TICKETS = 2000;
const MAX_PARTICIPANTS = 5;

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

export async function dashboardAggregate(context) {
  const config = await getInstallationConfig();
  const fieldRegistry = config.fieldRegistry || {};

  if (!fieldRegistry.canvasField) {
    return {
      ok: true,
      data: {
        canvases: [],
        configVersion: config.configVersion || '',
        hasAccess: true,
        isAdmin: await computeIsAdmin(context),
        jiraBaseUrl: null,
        canvasFieldId: null,
      },
    };
  }

  const fields = [
    fieldRegistry.canvasField,
    fieldRegistry.urlField,
    'status',
    'updated',
    'assignee',
    'reporter',
    'project',
  ].filter(Boolean);

  const jql = `labels = "jiratack" ORDER BY created DESC`;

  const canvases = new Map();
  let nextPageToken = null;
  let fetched = 0;

  try {
    do {
      const body = {
        jql,
        fields,
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
        const issueFields = issue.fields || {};
        const canvasName = issueFields[fieldRegistry.canvasField];
        if (!canvasName) continue;

        let entry = canvases.get(canvasName);
        if (!entry) {
          entry = {
            canvasName,
            ticketCount: 0,
            openCount: 0,
            urls: new Map(),
            lastUpdated: null,
            projectKeys: new Set(),
            participants: new Map(),
          };
          canvases.set(canvasName, entry);
        }

        entry.ticketCount += 1;

        const statusCategory = issueFields.status && issueFields.status.statusCategory
          ? issueFields.status.statusCategory.key
          : null;
        if (statusCategory !== 'done') {
          entry.openCount += 1;
        }

        if (fieldRegistry.urlField && issueFields[fieldRegistry.urlField]) {
          const normalized = normalizeUrl(issueFields[fieldRegistry.urlField]);
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
      .map((entry) => ({
        canvasName: entry.canvasName,
        ticketCount: entry.ticketCount,
        openCount: entry.openCount,
        urlCount: entry.urls.size,
        urls: Array.from(entry.urls.entries())
          .map(([url, ticketCount]) => ({ url, ticketCount }))
          .sort((a, b) => {
            if (b.ticketCount !== a.ticketCount) return b.ticketCount - a.ticketCount;
            return a.url.localeCompare(b.url);
          }),
        lastUpdated: entry.lastUpdated,
        projectKeys: Array.from(entry.projectKeys),
        participants: Array.from(entry.participants.values()),
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
        configVersion: config.configVersion || '',
        hasAccess,
        isAdmin,
        jiraBaseUrl,
        canvasFieldId: fieldRegistry.canvasField,
      },
    };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}
