import api, { route } from '@forge/api';
import { kvsGet, kvsSet } from './kvs.js';

const CACHE_PREFIX = 'canvasProjectCache:';
const CACHE_TTL_SECONDS = 300;

function escapeJql(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function getCanvasProjectKey(canvasName, canvasFieldId) {
  if (!canvasFieldId) return null;
  const cacheKey = `${CACHE_PREFIX}${canvasName}`;

  try {
    const cached = await kvsGet(cacheKey);
    if (cached && cached.projectKey && Date.now() - cached.cachedAt < CACHE_TTL_SECONDS * 1000) {
      return cached.projectKey;
    }
  } catch (e) {
    // ignore cache read errors
  }

  const jql = `"${canvasFieldId}" = "${escapeJql(canvasName)}" ORDER BY created ASC`;
  const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql, fields: ['project'], maxResults: 1 }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const issue = data && data.issues && data.issues[0];
  const projectKey = issue && issue.fields && issue.fields.project && issue.fields.project.key;
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
  const fieldRegistry = (config && config.fieldRegistry) || {};
  if (!fieldRegistry.canvasField) return 0;

  let projectKey = null;
  try {
    projectKey = await getCanvasProjectKey(canvasName, fieldRegistry.canvasField);
  } catch (e) {
    return 0;
  }
  if (!projectKey) return 0;

  const projectConfig = config.projects && config.projects[projectKey];
  const days = projectConfig && typeof projectConfig.retirementDays === 'number'
    ? projectConfig.retirementDays
    : 0;

  return days > 0 ? days : 0;
}

export function buildOverlayJql({ canvasFieldId, urlFieldId, canvasName, normalizedUrl, retirementDays }) {
  const base = `"${canvasFieldId}" = "${escapeJql(canvasName)}" AND "${urlFieldId}" = "${escapeJql(normalizedUrl)}"`;

  if (retirementDays > 0) {
    return `${base} AND (statusCategory != Done OR (statusCategory = Done AND statusCategoryChangedDate >= -${retirementDays}d)) ORDER BY created ASC`;
  }

  return `${base} AND statusCategory != Done ORDER BY created ASC`;
}
