import { route } from '@forge/api';
import { getInstallationConfig } from './config.js';
import { errorResult } from './errors.js';
import { canonicalUrl } from '../shared/urlNormalize.js';
import { buildIssueDescription } from './issueDescription.js';
import { writeMetadata } from './metadata.js';
import { kvsSet, kvsDelete } from './kvs.js';
import { normalizePrefillFields, prefillConfigKey } from './fieldPrefill.js';
import { ensureCanvasRecord } from './canvasRegistry.js';
import { resolveCanvasTarget } from './targetUrl.js';

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
    prefillFields,
  } = options;

  if (typeof canvasName !== 'string' || canvasName.trim().length === 0) {
    return errorResult('BAD_REQUEST', 'canvasName is required.');
  }

  const prefill = normalizePrefillFields(prefillFields);
  if (!prefill.ok) {
    return errorResult('BAD_REQUEST', prefill.message);
  }

  const config = await getInstallationConfig();

  const resolvedProject = chooseProject(config, permittedProjects, projectKey);
  if (!resolvedProject) {
    return errorResult('BAD_REQUEST', 'No project is available to create the canvas in.');
  }

  const resolvedIssueType = await resolveIssueType(requester, resolvedProject, config, issueTypeId);
  if (!resolvedIssueType) {
    return errorResult('BAD_REQUEST', 'No issue type is available for the project.');
  }

  const target = resolveCanvasTarget({ canvasName, targetUrl });
  if (!target.ok) {
    return errorResult('VALIDATION_ERROR', target.message);
  }
  const url = target.url;

  const fields = {
    summary: 'Canvas created',
    description: buildIssueDescription({
      bodyText: `JiraTack canvas created: ${canvasName.trim()}`,
    }),
    issuetype: { id: resolvedIssueType },
    project: { key: resolvedProject },
    labels: ['jiratack'],
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
    let detail = '';
    try {
      detail = await res.text();
    } catch (e) {
      detail = '';
    }
    if (res.status === 400 || res.status === 422) {
      return errorResult('VALIDATION_ERROR', 'Jira rejected the canvas seed ticket.', { raw: detail.slice(0, 800) });
    }
    return errorResult(
      'INTERNAL',
      `Jira canvas seed creation failed with HTTP ${res.status}.`,
      { raw: detail.slice(0, 800) },
    );
  }

  const created = await res.json();
  if (!created || !created.key) {
    return errorResult('INTERNAL', 'Canvas seed ticket creation returned no result.');
  }

  const metadataResult = await writeMetadata(created.key, {
    pin: {
      canvas: canvasName.trim(),
      url,
      position: '0,0',
      selector: null,
    },
    version: 1,
  });
  if (!metadataResult.ok) {
    return errorResult('INTERNAL', 'Canvas seed ticket was created but its metadata could not be stored.');
  }

  // The canvas key is the seed ticket's key (D42): stable, unique, and already
  // visible in Jira. The display name can then change without orphaning pins.
  const registry = await ensureCanvasRecord({
    name: canvasName.trim(),
    seedKey: created.key,
    createdBy: reporterAccountId || null,
  });
  const canvasKey = registry && registry.record ? registry.record.key : created.key;

  // Canvas field pre-fills (D41) live next to the ticket, not on it: the web
  // trigger reads them by canvas key for every pin it creates, and a Jira
  // search per pin would be wasteful. Always write (or clear) the config so a
  // recreated canvas never inherits a previous canvas's fields.
  try {
    if (prefill.fields.length > 0) {
      await kvsSet(prefillConfigKey(canvasKey), {
        version: 2,
        prefillFields: prefill.fields,
      });
    } else {
      await kvsDelete(prefillConfigKey(canvasKey));
    }
  } catch (e) {
    return errorResult('INTERNAL', 'Canvas was created but its field pre-fills could not be stored.');
  }

  return {
    ok: true,
    data: {
      canvasName: canvasName.trim(),
      canvasKey,
      targetUrl: url,
      key: created.key,
      id: created.id,
      projectKey: resolvedProject,
    },
  };
}
