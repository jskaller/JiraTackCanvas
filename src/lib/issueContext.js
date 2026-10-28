import api, { route } from '@forge/api';
import { getInstallationConfig } from './config.js';
import { errorResult } from './errors.js';
import { canAccessCanvas, canAccessProject } from '../webtrigger/middleware/scope.js';
import { readMetadataBySearch } from './metadata.js';

/**
 * Loads an issue and verifies the caller may edit it as a JiraTack pin.
 */
export async function loadJiraTackIssue(issueKey, claims) {
  if (typeof issueKey !== 'string' || issueKey.length === 0) {
    return { ok: false, error: errorResult('BAD_REQUEST', 'issueKey is required.') };
  }

  const config = await getInstallationConfig();

  let res;
  try {
    res = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}?fields=project,labels,description,summary`,
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

  if (!labels.includes('jiratack')) {
    return {
      ok: false,
      error: errorResult('INSUFFICIENT_SCOPE', 'This issue is not managed by JiraTack.'),
    };
  }

  const metadata = await readMetadataBySearch(issueKey);
  if (!metadata) {
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
  if (!canAccessCanvas(claims, metadata.pin.canvas)) {
    return {
      ok: false,
      error: errorResult('INSUFFICIENT_SCOPE', 'This canvas is not available to you.'),
    };
  }

  return {
    ok: true,
    config,
    issue,
    fields,
    projectKey,
    canvasName: metadata.pin.canvas,
    metadata,
  };
}
