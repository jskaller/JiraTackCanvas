import api, { route } from '@forge/api';
import { errorResult } from '../../lib/errors.js';
import { loadJiraTackIssue } from '../../lib/issueContext.js';
import { writeMetadata } from '../../lib/metadata.js';
import {
  buildPinMoveComment,
  movedBeyondThreshold,
  nextScreenshotVersion,
  screenshotFilename,
} from '../../shared/pinMove.js';
import { readScreenshotUpload, deleteScreenshotUpload } from './screenshotUpload.js';
import { attachScreenshot } from './attachments.js';

const POSITION_RE = /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/;
const MAX_SELECTOR = 2000;

/**
 * Moves a pin: patch metadata, supersede the screenshot, then comment (D33).
 *
 * There is no user identity in a web trigger, so `asUser()` is impossible: the
 * comment is authored by the app and names the mover in its text. Old
 * attachments are never deleted — the newest screenshot is chosen by filename
 * timestamp, so history stays auditable.
 */

async function fetchReviewerProfile(accountId) {
  if (typeof accountId !== 'string' || accountId.length === 0) return null;
  try {
    // `route` already URL-encodes query interpolations. Passing an
    // encodeURIComponent() value here double-encoded account ids containing
    // ":" (557058%3A…) and Jira answered 404, which is why the comment fell
    // back to "a reviewer".
    const res = await api.asApp().requestJira(
      route`/rest/api/3/user?accountId=${accountId}`,
    );
    if (!res.ok) {
      console.error('[JiraTack] reviewer profile lookup HTTP', res.status);
      return null;
    }
    const data = await res.json();
    return data && typeof data === 'object' ? data : null;
  } catch (e) {
    console.error('[JiraTack] reviewer profile lookup failed:', e && e.message ? e.message : e);
    return null;
  }
}

async function postMoveComment(issueKey, text) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text }] },
        ],
      },
    }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch (e) {
      detail = '';
    }
    throw new Error(`Comment failed with HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
}

export async function updatePinPosition(payload, claims) {
  const issueKey = payload && payload.issueKey;
  const pinPosition = payload && payload.pinPosition;
  const rawSelector = payload && payload.selector;
  const captureContext = payload && payload.captureContext;
  const movedPixels = payload && payload.movedPixels;
  const screenshotUploadId = payload && payload.screenshotUploadId;

  if (typeof issueKey !== 'string' || issueKey.length === 0) {
    return errorResult('BAD_REQUEST', 'issueKey is required.');
  }
  if (typeof pinPosition !== 'string' || !POSITION_RE.test(pinPosition) || pinPosition.length > 40) {
    return errorResult('VALIDATION_ERROR', 'pinPosition must be "relX,relY" or "absX,absY".');
  }
  if (rawSelector !== undefined && rawSelector !== null) {
    if (typeof rawSelector !== 'string' || rawSelector.length === 0 || rawSelector.length > MAX_SELECTOR) {
      return errorResult('BAD_REQUEST', 'selector must be a non-empty string or null.');
    }
  }
  if (captureContext !== undefined && captureContext !== null && typeof captureContext !== 'object') {
    return errorResult('BAD_REQUEST', 'captureContext must be an object or null.');
  }
  if (screenshotUploadId !== undefined && screenshotUploadId !== null && typeof screenshotUploadId !== 'string') {
    return errorResult('BAD_REQUEST', 'screenshotUploadId must be a string.');
  }

  const context = await loadJiraTackIssue(issueKey, claims || {});
  if (!context.ok) {
    console.error('[JiraTack] updatePinPosition rejected by context:', issueKey);
    return context.error;
  }

  const selector = typeof rawSelector === 'string' ? rawSelector : null;
  console.log('[JiraTack] updatePinPosition:', issueKey, pinPosition, selector ? 'selector' : 'pixels');

  // Attach before the metadata write so `screenshotVersion` counts only files
  // that actually reached Jira. A failed attachment must not fail the move.
  let screenshotAttached = false;
  if (typeof screenshotUploadId === 'string' && screenshotUploadId.length > 0) {
    const upload = await readScreenshotUpload(screenshotUploadId, claims);
    if (!upload.ok) {
      console.error(
        '[JiraTack] Move screenshot upload unusable:',
        upload.error && upload.error.error && upload.error.error.code,
      );
    } else {
      try {
        await attachScreenshot(issueKey, upload.dataUrl, screenshotFilename(issueKey, Date.now()));
        screenshotAttached = true;
      } catch (e) {
        console.error('[JiraTack] Move screenshot attachment failed:', e && e.message ? e.message : e);
      } finally {
        await deleteScreenshotUpload(screenshotUploadId, upload.chunkCount);
      }
    }
  }

  const metadataResult = await writeMetadata(issueKey, {
    ...context.metadata,
    pin: {
      ...context.metadata.pin,
      position: pinPosition,
      selector,
    },
    capture: captureContext || context.metadata.capture,
    screenshotVersion: screenshotAttached
      ? nextScreenshotVersion(context.metadata.screenshotVersion)
      : context.metadata.screenshotVersion,
  });
  if (!metadataResult.ok) {
    // The attachment (if any) stays: deleting superseded files is never allowed.
    return metadataResult;
  }

  const warnings = [];
  if (!screenshotAttached) warnings.push('screenshot-not-attached');

  let commented = false;
  if (screenshotAttached && movedBeyondThreshold(movedPixels)) {
    const isGuest = Boolean(claims && claims.scope === 'guest_create');
    // A guest session's `sub` is the sponsor, so their profile names the wrong
    // person and their zone is not the guest's. Guests get their invited name
    // and an explicit UTC timestamp instead.
    const profile = isGuest ? null : await fetchReviewerProfile(claims && claims.sub);
    const guestName = context.metadata.guest && context.metadata.guest.name;
    const displayName = (isGuest && guestName)
      || (profile && profile.displayName)
      || guestName
      || 'a reviewer';

    try {
      await postMoveComment(
        issueKey,
        buildPinMoveComment({
          displayName,
          at: new Date(),
          timeZone: isGuest ? null : (profile && profile.timeZone),
        }),
      );
      commented = true;
    } catch (e) {
      console.error('[JiraTack] Move comment failed:', e && e.message ? e.message : e);
      warnings.push('comment-failed');
    }
  }

  return {
    ok: true,
    data: {
      configVersion: context.config.configVersion || '',
      pin: { position: pinPosition, selector },
      screenshotVersion: metadataResult.data.screenshotVersion || 0,
      screenshotAttached,
      commented,
      warnings,
    },
  };
}
