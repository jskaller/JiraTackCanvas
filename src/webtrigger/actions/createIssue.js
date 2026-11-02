import api, { route } from '@forge/api';
import { getInstallationConfig } from '../../lib/config.js';
import { errorResult } from '../../lib/errors.js';
import { canonicalUrl } from '../../shared/urlNormalize.js';
import { canAccessCanvas, canAccessProject } from '../middleware/scope.js';
import { isLicensedUser } from '../../lib/license.js';
import { buildIssueDescription } from '../../lib/issueDescription.js';
import { writeMetadata } from '../../lib/metadata.js';
import { recordPinForBinding } from '../../lib/bindings.js';
import { pairingService } from '../../lib/credentials.js';
import { kvsGet } from '../../lib/kvs.js';
import { readScreenshotUpload, deleteScreenshotUpload } from './screenshotUpload.js';

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

async function attachScreenshot(issueKey, screenshotDataUrl, filenameOverride) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(screenshotDataUrl);
  if (!match) {
    throw new Error('Unsupported screenshot data URL.');
  }

  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const ext = (mime.split('/')[1] || 'png').split('+')[0];
  const filename = filenameOverride || `jiratack-${issueKey}.${ext}`;
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

  console.log('[JiraTack] Screenshot attached to issue:', issueKey);
}

async function requestCreateIssue(fields) {
  const res = await api.asApp().requestJira(
    route`/rest/api/3/issue?overrideScreenSecurity=true&overrideEditableFlag=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    },
  );

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

  const isGuest = Boolean(claims && claims.scope === 'guest_create');
  let guest = null;
  let invite = null;
  let bindingId = null;
  const assigneeAccountId = (payload && payload.assigneeAccountId) || null;

  if (isGuest) {
    if (!canAccessCanvas(claims, canvasName)) {
      return errorResult('INSUFFICIENT_SCOPE', 'This canvas is not available to you.');
    }

    // Identity is fixed at issuance (D30), and the invitation state is checked
    // on every write so deactivation takes effect immediately rather than at
    // the next session renewal.
    const pairingId = claims && claims.pairingId;
    const pairing = pairingId ? await pairingService.getPairing(pairingId) : null;
    if (!pairing || pairing.state !== 'active') {
      return errorResult('INSUFFICIENT_SCOPE', 'This invitation is no longer active.');
    }

    invite = await kvsGet(`canvasTokens:${pairing.inviteToken}`);
    if (!invite || invite.scope !== 'guest_create' || invite.revoked || invite.state === 'inactive') {
      return errorResult('INSUFFICIENT_SCOPE', 'This invitation is paused or revoked.');
    }
    if (!invite.guestName || !invite.guestEmail) {
      return errorResult('VALIDATION_ERROR', 'This link predates named invitations. Ask for a new one.');
    }

    guest = { name: invite.guestName, email: invite.guestEmail };
    bindingId = invite.bindingId || null;

    if (typeof assigneeAccountId !== 'string' || assigneeAccountId.length === 0) {
      return errorResult('VALIDATION_ERROR', 'assigneeAccountId is required when creating guest tickets.');
    }
    if (!(await isLicensedUser(assigneeAccountId))) {
      return errorResult('VALIDATION_ERROR', 'Guest tickets must be assigned to a licensed JiraTack user.');
    }
  }

  if (!canAccessProject(claims.permittedProjects, projectKey)) {
    return errorResult('INSUFFICIENT_SCOPE', 'You cannot create pins in this project.');
  }

  const config = await getInstallationConfig();
  const projectConfig = (config.projects && config.projects[projectKey]) || null;
  if (projectConfig && projectConfig.enabled === false) {
    return errorResult('PROJECT_DISABLED', 'JiraTack is disabled for this project.');
  }

  const canonical = canonicalUrl(rawUrl);
  if (!/^https?:\/\//i.test(canonical)) {
    return errorResult('VALIDATION_ERROR', 'url must be an absolute http(s) URL.');
  }
  const summary = rawSummary.startsWith('[JiraTack]') ? rawSummary : `[JiraTack] ${rawSummary}`;
  const description = buildIssueDescription({
    guest,
    bodyAdf: payload.descriptionAdf,
    pageUrl: canonical,
    consoleLog: payload.consoleLog,
  });

  const labels = ['jiratack'];
  if (isGuest) labels.push('jiratack-guest');

  const fields = {
    summary,
    description,
    issuetype: { id: issueTypeId },
    project: { key: projectKey },
    labels,
  };
  if (!isGuest) {
    fields.reporter = { accountId: claims.sub };
  } else {
    // P-03: the delegator is credited as reporter. If Jira refuses (issuer
    // deactivated or not assignable), the create is retried without it below.
    fields.reporter = { accountId: claims.sub };
  }
  if (payload.priorityId) {
    fields.priority = { id: payload.priorityId };
  }
  if (assigneeAccountId) {
    fields.assignee = { accountId: assigneeAccountId };
  }
  if (payload.parentKey) {
    fields.parent = { key: payload.parentKey };
  }

  let attempt = await requestCreateIssue(fields);
  let reporterDropped = false;
  if (
    !attempt.ok
    && isGuest
    && fields.reporter
    && (attempt.status === 400 || attempt.status === 422)
  ) {
    // The issuer may be deactivated or unassignable. Attribution is desirable,
    // not essential: retry without reporter and report the degradation.
    const withoutReporter = { ...fields };
    delete withoutReporter.reporter;
    const retry = await requestCreateIssue(withoutReporter);
    if (retry.ok) {
      attempt = retry;
      reporterDropped = true;
    }
  }
  if (!attempt.ok) {
    console.error('[JiraTack] Jira createIssue rejected:', attempt.details);
    if (attempt.status === 400 || attempt.status === 422) {
      return errorResult('VALIDATION_ERROR', 'Jira rejected the issue payload.', attempt.details);
    }
    return errorResult('INTERNAL', `Jira issue creation failed with HTTP ${attempt.status}.`, attempt.details);
  }

  const created = attempt.created;
  if (!created || !created.key) {
    return errorResult('INTERNAL', 'Issue creation failed with an unknown response.');
  }

  // Record the reviewer binding only after Jira has accepted the ticket, so a
  // rejected create never consumes a slot or a pin count (D24). A binding
  // failure must not fail the ticket.
  if (isGuest && bindingId) {
    try {
      await recordPinForBinding(bindingId, { canvasName });
    } catch (e) {
      console.error('[JiraTack] Binding pin write failed:', e && e.message ? e.message : e);
    }
  }

  const metadataResult = await writeMetadata(created.key, {
    bindingId: bindingId || undefined,
    pairingId: isGuest && claims ? claims.pairingId : undefined,
    guest: guest || undefined,
    pin: {
      canvas: canvasName,
      url: canonical,
      position: pinPosition,
      selector,
    },
    version: 1,
  });
  if (!metadataResult.ok) {
    // The ticket exists but is invisible to JiraTack; surface it rather than
    // letting it become a silent orphan.
    console.error('[JiraTack] Created issue without metadata:', created.key);
  }

  let failedAttachments = 0;
  const screenshotUploadId = payload && payload.screenshotUploadId;
  if (typeof screenshotUploadId === 'string' && screenshotUploadId.length > 0) {
    const shot = await readScreenshotUpload(screenshotUploadId, claims);
    if (!shot.ok) {
      console.error(
        '[JiraTack] Screenshot upload unusable:',
        shot.error && shot.error.error && shot.error.error.code,
      );
    } else {
      try {
        await attachScreenshot(created.key, shot.dataUrl, shot.filename);
      } catch (e) {
        console.error('[JiraTack] Screenshot attachment failed:', e);
      } finally {
        await deleteScreenshotUpload(screenshotUploadId, shot.chunkCount);
      }
    }
  }

  // Attachments (any file type) reuse the chunked upload path. Each is attached
  // independently: one bad file must not cost the ticket or the other files.
  const attachmentUploadIds = Array.isArray(payload && payload.attachmentUploadIds)
    ? payload.attachmentUploadIds
    : [];
  for (const uploadId of attachmentUploadIds) {
    if (typeof uploadId !== 'string' || uploadId.length === 0) continue;
    const file = await readScreenshotUpload(uploadId, claims);
    if (!file.ok) {
      console.error('[JiraTack] Attachment upload unusable:', uploadId);
      continue;
    }
    try {
      await attachScreenshot(created.key, file.dataUrl, file.filename);
    } catch (e) {
      console.error('[JiraTack] Attachment failed:', e);
      failedAttachments += 1;
    } finally {
      await deleteScreenshotUpload(uploadId, file.chunkCount);
    }
  }

  const warnings = [];
  if (!metadataResult.ok) warnings.push('metadata-not-stored');
  if (failedAttachments > 0) warnings.push('attachment-failed');
  if (reporterDropped) warnings.push('reporter-not-set');

  return {
    ok: true,
    data: {
      key: created.key,
      id: created.id,
      configVersion: config.configVersion || '',
      warning: warnings[0],
      warnings,
    },
  };
}
