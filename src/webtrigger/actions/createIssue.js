import api, { route } from '@forge/api';
import { getInstallationConfig } from '../../lib/config.js';
import { errorResult } from '../../lib/errors.js';
import { canonicalUrl } from '../../shared/urlNormalize.js';
import { canAccessCanvas, canAccessProject } from '../middleware/scope.js';
import { isLicensedUser } from '../../lib/license.js';
import { buildIssueDescription } from '../../lib/issueDescription.js';
import { writeMetadata } from '../../lib/metadata.js';
import { normaliseTextChange } from '../../lib/metadataModel.js';
import { recordPinForBinding } from '../../lib/bindings.js';
import { pairingService } from '../../lib/credentials.js';
import { kvsGet, kvsSet, kvsDelete } from '../../lib/kvs.js';
import { ensureCanvasRecord, setCanvasThumbnail, setCanvasThumbnailNote } from '../../lib/canvasRegistry.js';
import { isGeneratedCanvasKey, resolveCanvas } from '../../lib/canvasIdentity.js';
import {
  prefillConfigKey,
  prefillDescriptionEntries,
  readCanvasPrefill,
  splitPrefillForCreate,
} from '../../lib/fieldPrefill.js';
import { readScreenshotUpload, deleteScreenshotUpload } from './screenshotUpload.js';
import { attachScreenshot } from './attachments.js';

/**
 * Field IDs on the Create screen for this project + issue type, or null when
 * Jira will not say. D41 uses this to decide whether a mapped auxiliary value
 * can be written or must fall back to the description.
 */
async function readCreateScreenFields(projectKey, issueTypeId) {
  const ids = new Set();
  let startAt = 0;

  try {
    for (let page = 0; page < 5; page += 1) {
      const res = await api.asApp().requestJira(
        route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes/${issueTypeId}?startAt=${startAt}`,
      );
      if (!res.ok) return null;
      const data = await res.json();

      // The endpoint answers `fields: [{ fieldId, … }]`; older shapes answer a
      // `fields` object keyed by field id. Accept both rather than guessing.
      if (Array.isArray(data && data.fields)) {
        data.fields.forEach((field) => {
          if (field && field.fieldId) ids.add(String(field.fieldId));
        });
      } else if (data && data.fields && typeof data.fields === 'object') {
        Object.keys(data.fields).forEach((id) => ids.add(id));
      }

      const isLast = data && data.isLast !== undefined
        ? data.isLast
        : !data || !data.total || (startAt + (data.maxResults || 0)) >= data.total;
      if (isLast || !Array.isArray(data && data.fields)) break;
      startAt += data.maxResults || data.fields.length;
      if (!data.maxResults && !data.fields.length) break;
    }
  } catch (e) {
    return null;
  }

  return ids.size > 0 ? ids : null;
}

async function readPrefillConfig(canvasKey) {
  if (!canvasKey) return [];
  try {
    const raw = await kvsGet(prefillConfigKey(canvasKey));
    return readCanvasPrefill(raw);
  } catch (e) {
    return [];
  }
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
  const rawTextChange = payload && payload.textChange;

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

  // The suggestion is stored for the post-creation preview (D35) as well as in
  // the human-readable description. Reject a malformed pair rather than
  // storing half of it.
  let textChange = null;
  if (rawTextChange !== undefined && rawTextChange !== null) {
    const original = rawTextChange && rawTextChange.original;
    const suggested = rawTextChange && rawTextChange.suggested;
    if (
      typeof original !== 'string'
      || typeof suggested !== 'string'
      || original.trim().length === 0
      || suggested.trim().length === 0
      || original.length > 2000
      || suggested.length > 2000
    ) {
      return errorResult(
        'VALIDATION_ERROR',
        'textChange requires original and suggested strings up to 2000 characters.',
      );
    }
    textChange = normaliseTextChange(rawTextChange);
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

  // Canvas identity (D42): the key is stable across renames; the name is the
  // label at capture time. The request id may be either, so one resolver
  // decides. A canvas can exist before its seed ticket (manual ticket
  // creation), so the record is ensured lazily for a name that is new.
  const resolvedCanvas = await resolveCanvas({ canvasName });
  if (!resolvedCanvas && isGeneratedCanvasKey(canvasName)) {
    // A generated key that resolves to nothing means the canvas was deleted.
    // Creating a record named after the key would resurrect a phantom canvas.
    return errorResult('NOT_FOUND', 'That canvas is no longer available.');
  }
  const canvasRecord = resolvedCanvas
    ? { record: resolvedCanvas, created: false }
    : await ensureCanvasRecord({ name: canvasName });
  const canvasKey = canvasRecord && canvasRecord.record ? canvasRecord.record.key : null;
  // `pin.canvas` is a label, `pin.canvasId` is the key: never write an id into
  // the name field, which is what made grouping ambiguous.
  const canvasLabel = (canvasRecord && canvasRecord.record && canvasRecord.record.name) || canvasName;

  // Canvas card preview (D43): captured locally by the reviewer's browser and
  // stored on the canvas record, so it can never drift from the canvas key.
  const thumbnail = payload && payload.canvasThumbnail;
  const thumbnailNote = payload && typeof payload.canvasThumbnailNote === 'string'
    ? payload.canvasThumbnailNote.slice(0, 200)
    : '';
  const alreadyCaptured = Boolean(canvasRecord.record
    && canvasRecord.record.thumbnailVersion === 2
    && canvasRecord.record.thumbnail);
  const usableThumbnail = typeof thumbnail === 'string'
    && thumbnail.indexOf('data:image/') === 0
    && thumbnail.length <= 150000;
  if (canvasKey && canvasRecord.record && !alreadyCaptured) {
    try {
      if (usableThumbnail) {
        await setCanvasThumbnail(canvasKey, thumbnail);
      } else {
        // Record the reason, so "not captured" is diagnosable instead of a
        // blind end state (D43).
        await setCanvasThumbnailNote(
          canvasKey,
          thumbnailNote || (thumbnail ? 'The captured image was too large to store.' : 'The browser sent no image.'),
        );
      }
    } catch (e) {
      console.error('[JiraTack] Canvas preview write failed:', e && e.message ? e.message : e);
    }
  }

  // Canvas field pre-fills (D41): a value is written only when the target field
  // is on this ticket's Create screen; everything else lands in the
  // description, so a canvas note is never silently dropped.
  const prefill = await readPrefillConfig(canvasKey);
  let prefillValues = {};
  let prefillFallback = [];
  let prefillVerified = true;
  if (prefill.length > 0) {
    const needsScreen = prefill.some((field) => field.fieldId);
    const available = needsScreen ? await readCreateScreenFields(projectKey, issueTypeId) : null;
    if (needsScreen && available === null) prefillVerified = false;
    const split = splitPrefillForCreate(prefill, available);
    prefillValues = split.writable;
    prefillFallback = split.fallback;
  }

  const description = buildIssueDescription({
    guest,
    bodyAdf: payload.descriptionAdf,
    pageUrl: canonical,
    consoleLog: payload.consoleLog,
    extras: prefillDescriptionEntries(prefillFallback),
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
  Object.keys(prefillValues).forEach((fieldId) => {
    fields[fieldId] = prefillValues[fieldId];
  });
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
      await recordPinForBinding(bindingId, { canvasName: canvasLabel });
    } catch (e) {
      console.error('[JiraTack] Binding pin write failed:', e && e.message ? e.message : e);
    }
  }

  const metadataResult = await writeMetadata(created.key, {
    bindingId: bindingId || undefined,
    pairingId: isGuest && claims ? claims.pairingId : undefined,
    guest: guest || undefined,
    pin: {
      canvas: canvasLabel,
      canvasId: canvasKey || undefined,
      url: canonical,
      position: pinPosition,
      selector,
    },
    capture: payload && payload.captureContext ? payload.captureContext : undefined,
    textChange: textChange || undefined,
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

  // A new pin changes counts and may create a canvas; drop the creator's cached
  // dashboard summary so it refreshes on their next visit (D43).
  if (claims && claims.sub) {
    try {
      await kvsDelete(`canvasSummary:${claims.sub}`);
    } catch (e) {
      // TTL still bounds staleness.
    }
  }

  const warnings = [];
  if (!metadataResult.ok) warnings.push('metadata-not-stored');
  if (failedAttachments > 0) warnings.push('attachment-failed');
  if (reporterDropped) warnings.push('reporter-not-set');
  if (!prefillVerified) warnings.push('prefill-unverified');
  if (prefillFallback.some((field) => field.fieldId)) warnings.push('prefill-field-fallback');

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
