import api, { route } from '@forge/api';
import { errorResult } from './errors.js';
import {
  METADATA_PROPERTY_KEY,
  METADATA_VERSION,
  normalizeMetadata,
  metadataFromIssue,
} from './metadataModel.js';

export { METADATA_PROPERTY_KEY, METADATA_VERSION, normalizeMetadata, metadataFromIssue };

/** Reads metadata through the same enhanced-search path used by getPins. */
export async function readMetadataBySearch(issueKey) {
  if (typeof issueKey !== 'string' || issueKey.length === 0) {
    return { metadata: null, lookupFailed: false };
  }
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
    if (!res.ok) {
      console.error('[JiraTack] metadata search HTTP', res.status, 'for', issueKey);
      return { metadata: null, lookupFailed: true };
    }
    const data = await res.json();
    const issue = data && data.issues && data.issues[0];
    return { metadata: metadataFromIssue(issue), lookupFailed: false };
  } catch (e) {
    console.error('[JiraTack] metadata search threw for', issueKey, e && e.message ? e.message : e);
    return { metadata: null, lookupFailed: true };
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
