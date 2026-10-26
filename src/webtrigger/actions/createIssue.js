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

function buildMultipartBody(fileBuffer, filename, mimeType) {
  const boundary = `----JiraTack${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const preamble = Buffer.from(
    `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`
      + `Content-Type: ${mimeType}\r\n\r\n`,
    'utf8',
  );
  const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    body: Buffer.concat([preamble, fileBuffer, epilogue]),
    boundary,
  };
}

async function attachScreenshot(issueKey, screenshotDataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(screenshotDataUrl);
  if (!match) {
    throw new Error('Unsupported screenshot data URL.');
  }

  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const ext = (mime.split('/')[1] || 'png').split('+')[0];
  const filename = `jiratack-${issueKey}.${ext}`;
  const { body, boundary } = buildMultipartBody(buffer, filename, mime);

  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/attachments`, {
    method: 'POST',
    headers: {
      'X-Atlassian-Token': 'no-check',
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch (e) {
      detail = '';
    }
    throw new Error(`Attachment upload failed with HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
}

async function requestCreateIssue(fields) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });

  if (res.ok) {
    return { ok: true, created: await res.json() };
  }

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

  return {
    ok: false,
    status: res.status,
    details: {
      status: res.status,
      errorMessages: (body && body.errorMessages) || [],
      errors: (body && body.errors) || {},
      raw: body ? undefined : String(raw).slice(0, 1000),
    },
  };
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
  console.log('[JiraTack] Sending ADF:', JSON.stringify(description));

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

  const customFieldIds = [
    fieldRegistry.canvasField,
    fieldRegistry.urlField,
    fieldRegistry.pinField,
    fieldRegistry.selectorField,
  ].filter(Boolean);

  let created = null;
  const firstAttempt = await requestCreateIssue(fields);

  if (firstAttempt.ok) {
    created = firstAttempt.created;
  } else if (firstAttempt.status === 400 || firstAttempt.status === 422) {
    const errorFields = Object.keys((firstAttempt.details && firstAttempt.details.errors) || {});
    const rejectedCustomFields = errorFields.filter((fieldId) => customFieldIds.includes(fieldId));

    if (rejectedCustomFields.length > 0) {
      console.log('[JiraTack] Jira rejected custom fields. Retrying without them:', rejectedCustomFields);

      const retryFields = { ...fields };
      rejectedCustomFields.forEach((fieldId) => {
        delete retryFields[fieldId];
      });

      const retryAttempt = await requestCreateIssue(retryFields);
      if (retryAttempt.ok) {
        created = retryAttempt.created;
      } else {
        console.error('[JiraTack] Jira createIssue retry rejected:', retryAttempt.details);
        if (retryAttempt.status === 400 || retryAttempt.status === 422) {
          return errorResult('VALIDATION_ERROR', 'Jira rejected the issue payload.', retryAttempt.details);
        }
        return errorResult('INTERNAL', `Jira issue creation failed with HTTP ${retryAttempt.status}.`, retryAttempt.details);
      }
    } else {
      console.error('[JiraTack] Jira createIssue rejected:', firstAttempt.details);
      return errorResult('VALIDATION_ERROR', 'Jira rejected the issue payload.', firstAttempt.details);
    }
  } else {
    console.error('[JiraTack] Jira createIssue rejected:', firstAttempt.details);
    return errorResult('INTERNAL', `Jira issue creation failed with HTTP ${firstAttempt.status}.`, firstAttempt.details);
  }

  if (!created) {
    return errorResult('INTERNAL', 'Issue creation failed with an unknown response.');
  }

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
