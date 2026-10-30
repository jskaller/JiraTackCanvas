import api, { route } from '@forge/api';
import { errorResult } from '../../lib/errors.js';
import { normalizeUrl } from '../../shared/urlNormalize.js';
import { METADATA_PROPERTY_KEY, metadataFromIssue, readMetadataBySearch } from '../../lib/metadata.js';

const MAX_RELATED = 20;
const MAX_SCANNED = 2000;

function appendTicketParam(url, issueKey) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('jiratack_ticket', issueKey);
    return parsed.toString();
  } catch (e) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}jiratack_ticket=${encodeURIComponent(issueKey)}`;
  }
}

async function fetchJiraBaseUrl() {
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/serverInfo`);
    if (res.ok) {
      const data = await res.json();
      return data && data.baseUrl ? data.baseUrl : null;
    }
  } catch (e) {
    return null;
  }
  return null;
}

async function loadScreenshot(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  const image = list.find((item) => item && typeof item.mimeType === 'string' && item.mimeType.startsWith('image/'));
  if (!image || !image.id) return null;

  try {
    const res = await api.asApp().requestJira(
      route`/rest/api/3/attachment/content/${image.id}`,
    );
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = image.mimeType || 'image/png';
    return {
      filename: image.filename || null,
      mimeType,
      dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    };
  } catch (e) {
    return null;
  }
}

async function loadRelatedTickets(issueKey, canvasName, url) {
  if (!url) return [];
  const results = [];
  let nextPageToken = null;
  let scanned = 0;

  try {
    do {
      const body = {
        jql: 'labels = "jiratack" ORDER BY created ASC',
        fields: ['summary', 'status', 'issuetype'],
        properties: [METADATA_PROPERTY_KEY],
        maxResults: 100,
      };
      if (nextPageToken) body.nextPageToken = nextPageToken;

      const res = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) break;

      const data = await res.json();
      const issues = (data && data.issues) || [];

      for (const issue of issues) {
        if (issue.key === issueKey) continue;
        const metadata = metadataFromIssue(issue);
        if (!metadata) continue;
        if (metadata.pin.canvas !== canvasName) continue;
        // Stored URLs keep their query now, so compare page identity rather than
        // raw strings — otherwise page 1 and page 2 of the same URL stop relating.
        if (!url || normalizeUrl(metadata.pin.url) !== normalizeUrl(url)) continue;
        const fields = issue.fields || {};
        results.push({
          key: issue.key,
          summary: fields.summary || '',
          status: { name: (fields.status && fields.status.name) || '' },
          issueType: { name: (fields.issuetype && fields.issuetype.name) || '' },
        });
        if (results.length >= MAX_RELATED) return results;
      }

      scanned += issues.length;
      nextPageToken = data && !data.isLast ? data.nextPageToken : null;
      if (!nextPageToken || issues.length === 0) break;
    } while (scanned < MAX_SCANNED);
  } catch (e) {
    return results;
  }

  return results;
}

export async function issuePanelData(context, payload) {
  const issueKey = payload && payload.issueKey;
  if (typeof issueKey !== 'string' || issueKey.length === 0) {
    return errorResult('BAD_REQUEST', 'issueKey is required.');
  }

  const metadataResult = await readMetadataBySearch(issueKey);
  if (metadataResult.lookupFailed) {
    return errorResult('INTERNAL', 'Could not load this ticket from Jira right now.');
  }
  const metadata = metadataResult.metadata;
  if (!metadata) {
    return { ok: true, data: { isJiraTack: false } };
  }

  let issue;
  try {
    const res = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}?fields=summary,status,issuetype,attachment,project`,
    );
    if (!res.ok) {
      if (res.status === 404) {
        return errorResult('NOT_FOUND', 'Issue not found.');
      }
      return errorResult('INTERNAL', `Failed to read issue with HTTP ${res.status}.`);
    }
    issue = await res.json();
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }

  const issueFields = (issue && issue.fields) || {};
  const canvasName = metadata.pin.canvas;
  const url = metadata.pin.url;

  return {
    ok: true,
    data: {
      isJiraTack: true,
      canvasName,
      url,
      guest: metadata.guest || null,
      pin: metadata.pin,
      screenshot: await loadScreenshot(issueFields.attachment),
      relatedTickets: await loadRelatedTickets(issueKey, canvasName, url),
      deepLink: appendTicketParam(url, issueKey),
      jiraBaseUrl: await fetchJiraBaseUrl(),
    },
  };
}
