import { route } from '@forge/api';
import { getInstallationConfig } from './config.js';
import { errorResult } from './errors.js';

function chooseProject(config, permittedProjects, projectKey) {
  if (projectKey) return projectKey;

  const projects = config.projects || {};
  const configured = Object.keys(projects).filter((key) => !projects[key] || projects[key].enabled !== false);
  const permitted = permittedProjects === '*' ? null : permittedProjects;

  const allowed = configured.filter((key) => !permitted || !Array.isArray(permitted) || permitted.includes(key));
  if (allowed.length > 0) return allowed[0];

  if (Array.isArray(permitted) && permitted.length > 0) return permitted[0];
  return null;
}

async function resolveIssueType(requester, projectKey, config, issueTypeId) {
  if (issueTypeId) return issueTypeId;

  const projectConfig = config.projects && config.projects[projectKey];
  if (projectConfig && projectConfig.defaultIssueTypeId) return projectConfig.defaultIssueTypeId;

  const res = await requester.requestJira(route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`);
  if (!res.ok) return null;

  const data = await res.json();
  const list = (data && data.issueTypes) || (data && data.values) || [];
  const type = list.find((entry) => !entry.subtask) || list[0];
  return type ? String(type.id) : null;
}

export async function createSeedTicket(options) {
  const {
    requester,
    reporterAccountId,
    canvasName,
    targetUrl,
    projectKey,
    issueTypeId,
    permittedProjects,
  } = options;

  if (typeof canvasName !== 'string' || canvasName.trim().length === 0) {
    return errorResult('BAD_REQUEST', 'canvasName is required.');
  }

  const config = await getInstallationConfig();
  const fieldRegistry = config.fieldRegistry || {};
  if (!fieldRegistry.canvasField || !fieldRegistry.urlField) {
    return errorResult('BAD_REQUEST', 'Provision fields before creating a canvas.');
  }

  const resolvedProject = chooseProject(config, permittedProjects, projectKey);
  if (!resolvedProject) {
    return errorResult('BAD_REQUEST', 'No project is available to create the canvas in.');
  }

  const resolvedIssueType = await resolveIssueType(requester, resolvedProject, config, issueTypeId);
  if (!resolvedIssueType) {
    return errorResult('BAD_REQUEST', 'No issue type is available for the project.');
  }

  const url = typeof targetUrl === 'string' && targetUrl.trim().length > 0
    ? targetUrl.trim()
    : 'https://example.com';

  const fields = {
    summary: 'Canvas created',
    description: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `JiraTack canvas created: ${canvasName.trim()}` }],
        },
      ],
    },
    issuetype: { id: resolvedIssueType },
    project: { key: resolvedProject },
    labels: ['jiratack'],
    [fieldRegistry.canvasField]: canvasName.trim(),
    [fieldRegistry.urlField]: url,
  };

  if (reporterAccountId) {
    fields.reporter = { accountId: reporterAccountId };
  }

  const res = await requester.requestJira(
    route`/rest/api/3/issue?overrideScreenSecurity=true&overrideEditableFlag=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    },
  );

  if (!res.ok) {
    let raw = '';
    try {
      raw = await res.text();
    } catch (e) {
      raw = '';
    }
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch (e) {
      body = null;
    }
    const details = {
      status: res.status,
      errorMessages: (body && body.errorMessages) || [],
      errors: (body && body.errors) || {},
      raw: body ? undefined : String(raw).slice(0, 800),
    };
    console.error('[JiraTack] createCanvas rejected:', details);
    return errorResult('VALIDATION_ERROR', 'Jira rejected the canvas seed ticket.', details);
  }

  const created = await res.json();
  return { ok: true, data: { canvasName: canvasName.trim(), key: created.key, id: created.id } };
}
