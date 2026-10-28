import api, { route } from '@forge/api';
import { errorResult } from './errors.js';

export const METADATA_PROPERTY_KEY = 'com.jiratack.metadata';
export const METADATA_VERSION = 1;

/**
 * JiraTackMetadata:
 * {
 *   guest?: { name: string, email: string },
 *   pin: { canvas: string, url: string, position: string, selector: string | null },
 *   version: number
 * }
 */
export function normalizeMetadata(input) {
  if (!input || typeof input !== 'object') return null;
  const pin = input.pin;
  if (!pin || typeof pin !== 'object') return null;
  if (typeof pin.canvas !== 'string' || pin.canvas.length === 0) return null;
  if (typeof pin.url !== 'string' || pin.url.length === 0) return null;
  if (typeof pin.position !== 'string' || pin.position.length === 0) return null;

  const metadata = {
    pin: {
      canvas: pin.canvas,
      url: pin.url,
      position: pin.position,
      selector: typeof pin.selector === 'string' && pin.selector.length > 0 ? pin.selector : null,
    },
    version: typeof input.version === 'number' ? input.version : METADATA_VERSION,
  };

  if (
    input.guest
    && typeof input.guest === 'object'
    && typeof input.guest.name === 'string'
    && input.guest.name.length > 0
    && typeof input.guest.email === 'string'
  ) {
    metadata.guest = { name: input.guest.name, email: input.guest.email };
  }

  return metadata;
}

/** Reads metadata from a search/issue payload that already requested the property. */
export function metadataFromIssue(issue, key = METADATA_PROPERTY_KEY) {
  if (!issue) return null;
  const fromIssue = issue.properties && issue.properties[key];
  if (fromIssue) return normalizeMetadata(fromIssue);
  const fromFields = issue.fields && issue.fields.properties && issue.fields.properties[key];
  if (fromFields) return normalizeMetadata(fromFields);
  return null;
}

export async function readMetadata(issueKey) {
  if (typeof issueKey !== 'string' || issueKey.length === 0) return null;
  try {
    const res = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/properties/${METADATA_PROPERTY_KEY}`,
    );
    if (!res.ok) return null;
    return normalizeMetadata(await res.json());
  } catch (e) {
    return null;
  }
}

/**
 * Reads metadata through the same enhanced-search path used by getPins.
 * This is the reliable route: the standalone issue-property endpoint can
 * reject property keys that contain dots.
 */
export async function readMetadataBySearch(issueKey) {
  if (typeof issueKey !== 'string' || issueKey.length === 0) return null;
  const escaped = issueKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jql: `key = "${escaped}"`,
        fields: ['key'],
        properties: [METADATA_PROPERTY_KEY],
        maxResults: 1,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const issue = data && data.issues && data.issues[0];
    return metadataFromIssue(issue);
  } catch (e) {
    return null;
  }
}

export async function writeMetadata(issueKey, metadata) {
  const normalized = normalizeMetadata(metadata);
  if (!normalized) {
    return errorResult('VALIDATION_ERROR', 'Invalid JiraTack metadata.');
  }
  if (typeof issueKey !== 'string' || issueKey.length === 0) {
    return errorResult('BAD_REQUEST', 'issueKey is required.');
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await api.asApp().requestJira(
        route`/rest/api/3/issue/${issueKey}/properties/${METADATA_PROPERTY_KEY}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(normalized),
        },
      );
      if (res.ok) {
        return { ok: true, data: normalized };
      }
      console.error('[JiraTack] writeMetadata HTTP', res.status, 'for', issueKey);
    } catch (e) {
      console.error('[JiraTack] writeMetadata failed:', e && e.message ? e.message : e);
    }
  }

  return errorResult('INTERNAL', 'Failed to store JiraTack metadata on the issue.');
}
