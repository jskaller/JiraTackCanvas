import api, { route } from '@forge/api';
import { kvsGet, kvsSet } from './kvs.js';
import { METADATA_PROPERTY_KEY, metadataFromIssue } from './metadata.js';

const CACHE_PREFIX = 'canvasProjectCache:';
const CACHE_TTL_SECONDS = 300;
const PAGE_SIZE = 100;
const MAX_SCANNED = 2000;

export async function getCanvasProjectKey(canvasName) {
  if (typeof canvasName !== 'string' || canvasName.length === 0) return null;
  const cacheKey = `${CACHE_PREFIX}${canvasName}`;

  try {
    const cached = await kvsGet(cacheKey);
    if (cached && cached.projectKey && Date.now() - cached.cachedAt < CACHE_TTL_SECONDS * 1000) {
      return cached.projectKey;
    }
  } catch (e) {
    // ignore cache read errors
  }

  let projectKey = null;
  let nextPageToken = null;
  let scanned = 0;

  try {
    do {
      const body = {
        jql: 'labels = "jiratack" ORDER BY created ASC',
        fields: ['project'],
        properties: [METADATA_PROPERTY_KEY],
        maxResults: PAGE_SIZE,
      };
      if (nextPageToken) body.nextPageToken = nextPageToken;

      const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;

      const data = await res.json();
      const issues = (data && data.issues) || [];

      for (const issue of issues) {
        const metadata = metadataFromIssue(issue);
        if (!metadata || metadata.pin.canvas !== canvasName) continue;
        const fields = issue.fields || {};
        if (fields.project && fields.project.key) {
          projectKey = fields.project.key;
          break;
        }
      }

      if (projectKey) break;

      scanned += issues.length;
      nextPageToken = data && !data.isLast ? data.nextPageToken : null;
      if (!nextPageToken || issues.length === 0) break;
    } while (scanned < MAX_SCANNED);
  } catch (e) {
    return null;
  }

  if (!projectKey) return null;

  try {
    await kvsSet(
      cacheKey,
      { projectKey, cachedAt: Date.now() },
      { ttl: { value: CACHE_TTL_SECONDS, unit: 'SECONDS' } },
    );
  } catch (e) {
    // ignore cache write errors
  }

  return projectKey;
}

export async function getEffectiveRetirementDays(canvasName, config) {
  let projectKey = null;
  try {
    projectKey = await getCanvasProjectKey(canvasName);
  } catch (e) {
    return 0;
  }
  if (!projectKey) return 0;

  const projectConfig = config && config.projects && config.projects[projectKey];
  const days = projectConfig && typeof projectConfig.retirementDays === 'number'
    ? projectConfig.retirementDays
    : 0;

  return days > 0 ? days : 0;
}
