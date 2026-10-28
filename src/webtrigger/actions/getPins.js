import api, { route } from '@forge/api';
import { getInstallationConfig } from '../../lib/config.js';
import { errorResult } from '../../lib/errors.js';
import { normalizeUrl } from '../../shared/urlNormalize.js';
import { getEffectiveRetirementDays } from '../../lib/jql.js';
import { canAccessCanvas, canAccessProject } from '../middleware/scope.js';
import { METADATA_PROPERTY_KEY, metadataFromIssue } from '../../lib/metadata.js';

const PAGE_SIZE = 100;
const MAX_SCANNED = 2000;

function mapUser(user) {
  if (!user) return null;
  return {
    accountId: user.accountId || null,
    displayName: user.displayName || null,
    avatarUrl: (user.avatarUrls && user.avatarUrls['48x48']) || null,
  };
}

function statusChangedAt(fields) {
  const raw = fields.statuscategorychangedate || fields.statusCategoryChangedDate || null;
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isNaN(time) ? null : time;
}

function mapPin(issue, metadata) {
  const fields = issue.fields || {};
  const status = fields.status || {};
  const category = status.statusCategory || {};

  return {
    key: issue.key,
    summary: fields.summary || '',
    projectKey: fields.project && fields.project.key ? fields.project.key : null,
    status: {
      name: status.name || '',
      category: category.key || '',
      colorName: category.colorName || '',
    },
    priority: fields.priority ? { id: fields.priority.id, name: fields.priority.name } : null,
    priorityId: fields.priority && fields.priority.id ? String(fields.priority.id) : null,
    issueTypeId: fields.issuetype && fields.issuetype.id ? String(fields.issuetype.id) : null,
    assignee: mapUser(fields.assignee),
    reporter: mapUser(fields.reporter),
    pinPosition: metadata.pin.position,
    selector: metadata.pin.selector,
    issueType: fields.issuetype ? { name: fields.issuetype.name } : null,
    createdAt: fields.created || null,
    url: metadata.pin.url,
    guest: metadata.guest || null,
  };
}

export async function getPinsForCanvasAndUrl(payload, claims) {
  const canvasName = payload && payload.canvasId;
  const url = payload && payload.url;
  if (typeof canvasName !== 'string' || canvasName.length === 0) {
    return errorResult('BAD_REQUEST', 'canvasId is required.');
  }
  if (typeof url !== 'string' || url.length === 0) {
    return errorResult('BAD_REQUEST', 'url is required.');
  }

  if (!canAccessCanvas(claims, canvasName)) {
    return errorResult('INSUFFICIENT_SCOPE', 'This canvas is not available to you.');
  }

  const config = await getInstallationConfig();

  const normalizedUrl = normalizeUrl(url);
  const wantAll = Boolean(payload && payload.all);
  const retirementDays = await getEffectiveRetirementDays(canvasName, config);
  const retirementCutoff = retirementDays > 0 ? Date.now() - retirementDays * 24 * 60 * 60 * 1000 : null;

  const fieldsParam = [
    'summary',
    'status',
    'priority',
    'assignee',
    'reporter',
    'issuetype',
    'created',
    'project',
    'statuscategorychangedate',
  ];

  const jql = `labels = "jiratack" ORDER BY created ASC`;
  const pins = [];
  let nextPageToken = null;
  let scanned = 0;

  try {
    do {
      const body = {
        jql,
        fields: fieldsParam,
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
        if (metadata.pin.canvas !== canvasName) continue;

        const issueUrl = metadata.pin.url;
        if (!wantAll) {
          if (!issueUrl) continue;
          if (normalizeUrl(issueUrl) !== normalizedUrl) continue;
        }

        const issueFields = issue.fields || {};
        const category = issueFields.status && issueFields.status.statusCategory
          ? issueFields.status.statusCategory.key
          : null;
        if (category === 'done') {
          if (!retirementCutoff) continue;
          const changedAt = statusChangedAt(issueFields);
          if (!changedAt || changedAt < retirementCutoff) continue;
        }

        const projectKey = issueFields.project && issueFields.project.key;
        if (!canAccessProject(claims.permittedProjects, projectKey)) continue;

        pins.push(mapPin(issue, metadata));
      }

      scanned += issues.length;
      nextPageToken = data && !data.isLast ? data.nextPageToken : null;
      if (!nextPageToken || issues.length === 0) break;
    } while (scanned < MAX_SCANNED);
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }

  return {
    ok: true,
    data: {
      pins,
      canvasName: claims.canvasName || canvasName,
      configVersion: config.configVersion || '',
      // Scan caps can silently drop pins; tell the client the list may be partial.
      truncated: scanned >= MAX_SCANNED && Boolean(nextPageToken),
    },
  };
}
