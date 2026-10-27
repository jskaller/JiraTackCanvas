import api, { route } from '@forge/api';
import { getInstallationConfig } from './config.js';
import { errorResult } from './errors.js';
import { parsePinMarker } from './pinMarker.js';
import { canAccessCanvas, canAccessProject } from '../webtrigger/middleware/scope.js';

/**
 * Loads an issue and verifies the caller may edit it as a JiraTack pin:
 * the issue must carry the jiratack label and live on a canvas and project
 * the caller can access.
 */
export async function loadJiraTackIssue(issueKey, claims) {
  if (typeof issueKey !== 'string' || issueKey.length === 0) {
    return { ok: false, error: errorResult('BAD_REQUEST', 'issueKey is required.') };
  }

  const config = await getInstallationConfig();
  const fieldRegistry = config.fieldRegistry || {};
  const fieldsParam = ['project', 'labels', 'description', fieldRegistry.canvasField]
    .filter(Boolean)
    .join(',');

  let res;
  try {
    res = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}?fields=${fieldsParam}`,
    );
  } catch (e) {
    return {
      ok: false,
      error: errorResult('INTERNAL', e && e.message ? e.message : String(e)),
    };
  }

  if (!res.ok) {
    if (res.status === 404) {
      return { ok: false, error: errorResult('NOT_FOUND', 'Issue not found.') };
    }
    return {
      ok: false,
      error: errorResult('INTERNAL', `Jira issue lookup failed with HTTP ${res.status}.`),
    };
  }

  const issue = await res.json();
  const fields = (issue && issue.fields) || {};
  const labels = Array.isArray(fields.labels) ? fields.labels : [];
  const projectKey = fields.project && fields.project.key ? fields.project.key : null;
  const marker = parsePinMarker(fields.description);
  const canvasName = (fieldRegistry.canvasField && fields[fieldRegistry.canvasField])
    || (marker && marker.canvas)
    || null;

  if (!labels.includes('jiratack')) {
    return {
      ok: false,
      error: errorResult('INSUFFICIENT_SCOPE', 'This issue is not managed by JiraTack.'),
    };
  }
  if (!canAccessProject(claims && claims.permittedProjects, projectKey)) {
    return {
      ok: false,
      error: errorResult('INSUFFICIENT_SCOPE', 'You cannot edit this issue.'),
    };
  }
  if (!canAccessCanvas(claims, canvasName)) {
    return {
      ok: false,
      error: errorResult('INSUFFICIENT_SCOPE', 'This canvas is not available to you.'),
    };
  }

  return {
    ok: true,
    config,
    fieldRegistry,
    issue,
    fields,
    projectKey,
    canvasName,
    marker,
  };
}
