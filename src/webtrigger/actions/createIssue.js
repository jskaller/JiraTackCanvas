import api, { route } from '@forge/api';
import { getInstallationConfig } from '../../lib/config.js';
import { errorResult } from '../../lib/errors.js';
import { normalizeUrl } from '../../shared/urlNormalize.js';
import { canAccessProject } from '../middleware/scope.js';

function buildDescription(descriptionAdf, consoleLog, marker) {
  const content = descriptionAdf && Array.isArray(descriptionAdf.content)
    ? [...descriptionAdf.content]
    : [];

  if (typeof consoleLog === 'string' && consoleLog.length > 0) {
    content.push(
      { type: 'paragraph', content: [{ type: 'text', text: 'Console output:' }] },
      { type: 'codeBlock', attrs: {}, content: [{ type: 'text', text: consoleLog }] },
    );
  }

  content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: `📌 JiraTack pin: ${JSON.stringify(marker)}` }],
  });

  return { type: 'doc', version: 1, content };
}

function buildPinMarker(canvasName, normalizedUrl, pinPosition, selector) {
  const marker = {
    canvas: canvasName,
    url: normalizedUrl,
    position: pinPosition,
  };
  if (typeof selector === 'string' && selector.length > 0) {
    marker.selector = selector;
  }
  return marker;
}

async function attachScreenshot(issueKey, screenshotDataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(screenshotDataUrl);
  if (!match) {
    throw new Error('Unsupported screenshot data URL.');
  }
  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const ext = (mime.split('/')[1] || 'png').split('+')[0];
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), `screenshot.${ext}`);

  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/attachments`, {
    method: 'POST',
    headers: { 'X-Atlassian-Token': 'no-check' },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Attachment upload failed with HTTP ${res.status}.`);
  }
}

export async function createIssue(payload, claims) {
  const canvasName = payload && payload.canvasId;
  const rawUrl = payload && payload.url;
  const pinPosition = payload && payload.pinPosition;
  const selector = (payload && payload.selector) || null;
  const rawSummary = payload && payload.summary;
  const issueTypeId = payload && payload.issueTypeId;
  const projectKey = payload && payload.projectKey;

  if (typeof canvasName !== 'string' || canvasName.length === 0) {
    return errorResult('BAD_REQUEST', 'canvasId is required.');
  }
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    return errorResult('BAD_REQUEST', 'url is required.');
  }
  if (typeof pinPosition !== 'string' || pinPosition.length === 0) {
    return errorResult('BAD_REQUEST', 'pinPosition is required.');
  }
  if (typeof rawSummary !== 'string' || rawSummary.length === 0) {
    return errorResult('BAD_REQUEST', 'summary is required.');
  }
  if (typeof issueTypeId !== 'string' || issueTypeId.length === 0) {
    return errorResult('BAD_REQUEST', 'issueTypeId is required.');
  }
  if (typeof projectKey !== 'string' || projectKey.length === 0) {
    return errorResult('BAD_REQUEST', 'projectKey is required.');
  }

  if (!canAccessProject(claims.permittedProjects, projectKey)) {
    return errorResult('INSUFFICIENT_SCOPE', 'You cannot create pins in this project.');
  }

  const config = await getInstallationConfig();
  const fieldRegistry = config.fieldRegistry || {};
  if (!fieldRegistry.canvasField || !fieldRegistry.urlField || !fieldRegistry.pinField) {
    return errorResult('INTERNAL', 'Custom fields are not provisioned.');
  }

  const projectConfig = (config.projects && config.projects[projectKey]) || null;
  if (projectConfig && projectConfig.enabled === false) {
    return errorResult('PROJECT_DISABLED', 'JiraTack is disabled for this project.');
  }

  const normalizedUrl = normalizeUrl(rawUrl);
  const summary = rawSummary.startsWith('[JiraTack]') ? rawSummary : `[JiraTack] ${rawSummary}`;
  const marker = buildPinMarker(canvasName, normalizedUrl, pinPosition, selector);
  const description = buildDescription(payload.descriptionAdf, payload.consoleLog, marker);

  const fields = {
    summary,
    description,
    issuetype: { id: issueTypeId },
    project: { key: projectKey },
    reporter: { accountId: claims.sub },
    labels: ['jiratack'],
    [fieldRegistry.canvasField]: canvasName,
    [fieldRegistry.urlField]: normalizedUrl,
    [fieldRegistry.pinField]: pinPosition,
  };

  if (fieldRegistry.selectorField && typeof selector === 'string' && selector.length > 0) {
    fields[fieldRegistry.selectorField] = selector;
  }
  if (payload.priorityId) {
    fields.priority = { id: payload.priorityId };
  }
  if (payload.assigneeAccountId) {
    fields.assignee = { accountId: payload.assigneeAccountId };
  }
  if (payload.parentKey) {
    fields.parent = { key: payload.parentKey };
  }

  const res = await api.asApp().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      body = null;
    }
    if (res.status === 400) {
      return errorResult(
        'VALIDATION_ERROR',
        'Jira rejected the issue payload.',
        { fieldErrors: (body && body.errors) || {} },
      );
    }
    return errorResult('INTERNAL', `Jira issue creation failed with HTTP ${res.status}.`, body);
  }

  const created = await res.json();

  if (typeof payload.screenshotDataUrl === 'string' && payload.screenshotDataUrl.length > 0) {
    try {
      await attachScreenshot(created.key, payload.screenshotDataUrl);
    } catch (e) {
      console.error('[JiraTack] Screenshot attachment failed:', e);
    }
  }

  return {
    ok: true,
    data: {
      key: created.key,
      id: created.id,
      configVersion: config.configVersion || '',
    },
  };
}
