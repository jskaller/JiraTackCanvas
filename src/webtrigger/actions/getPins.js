import api, { route } from '@forge/api';
import { getInstallationConfig } from '../../lib/config.js';
import { errorResult } from '../../lib/errors.js';
import { normalizeUrl } from '../../shared/urlNormalize.js';
import { getEffectiveRetirementDays, buildOverlayJql } from '../../lib/jql.js';
import { canAccessProject } from '../middleware/scope.js';

function mapUser(user) {
  if (!user) return null;
  return {
    accountId: user.accountId || null,
    displayName: user.displayName || null,
    avatarUrl: (user.avatarUrls && user.avatarUrls['48x48']) || null,
  };
}

function mapPin(issue, fieldRegistry) {
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
    assignee: mapUser(fields.assignee),
    reporter: mapUser(fields.reporter),
    pinPosition: fieldRegistry.pinField ? (fields[fieldRegistry.pinField] || null) : null,
    selector: fieldRegistry.selectorField ? (fields[fieldRegistry.selectorField] || null) : null,
    issueType: fields.issuetype ? { name: fields.issuetype.name } : null,
    createdAt: fields.created || null,
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

  const config = await getInstallationConfig();
  const fieldRegistry = config.fieldRegistry || {};
  if (!fieldRegistry.canvasField || !fieldRegistry.urlField) {
    return errorResult('INTERNAL', 'Custom fields are not provisioned.');
  }

  const normalizedUrl = normalizeUrl(url);
  const retirementDays = await getEffectiveRetirementDays(canvasName, config);
  const jql = buildOverlayJql({
    canvasFieldId: fieldRegistry.canvasField,
    urlFieldId: fieldRegistry.urlField,
    canvasName,
    normalizedUrl,
    retirementDays,
  });

  const fieldsParam = [
    'summary',
    'status',
    'priority',
    'assignee',
    'reporter',
    'issuetype',
    'created',
    'project',
    fieldRegistry.canvasField,
    fieldRegistry.urlField,
    fieldRegistry.pinField,
    fieldRegistry.selectorField,
  ].filter(Boolean);

  const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql, fields: fieldsParam, maxResults: 100 }),
  });

  if (!res.ok) {
    return errorResult('INTERNAL', `Jira search failed with HTTP ${res.status}.`);
  }

  const data = await res.json();
  const issues = (data && data.issues) || [];

  const pins = issues
    .filter((issue) => {
      const projectKey = issue.fields && issue.fields.project && issue.fields.project.key;
      return canAccessProject(claims.permittedProjects, projectKey);
    })
    .map((issue) => mapPin(issue, fieldRegistry));

  return {
    ok: true,
    data: {
      pins,
      canvasName: claims.canvasName || canvasName,
      configVersion: config.configVersion || '',
    },
  };
}
