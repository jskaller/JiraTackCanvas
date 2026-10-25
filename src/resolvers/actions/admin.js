import crypto from 'crypto';
import api, { route, getAppContext } from '@forge/api';
import { provisionFields } from '../../lib/fields.js';
import { getInstallationConfig } from '../../lib/config.js';
import { kvsSet } from '../../lib/kvs.js';
import { generateSessionJwt } from '../../lib/tokens.js';
import { errorResponse, errorResult } from '../../lib/errors.js';
import { resolveWebtriggerUrls } from '../../lib/webtriggerUrls.js';
import { SDK_VERSION } from '../../lib/version.js';

const CANVAS_TOKEN_TTL_SECONDS = 2592000;
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export async function runProvisionFields(context) {
  return provisionFields(context);
}

function resolveInstallationId(context) {
  try {
    const ari = getAppContext().installationAri;
    if (ari) return ari.toString();
  } catch (e) {
    // fall through
  }
  return (context && context.installationId) || (context && context.extension && context.extension.installation && context.extension.installation.id) || '';
}

async function computePermittedProjects(mode, canvasName, canvasFieldId) {
  if (mode === 'open') {
    return { ok: true, permittedProjects: '*' };
  }

  const raw = await api.asUser().requestJira(route`/rest/api/3/project/search?action=browse&maxResults=100`);
  const payload = await raw.json();
  const values = (payload && payload.values) || payload || [];
  const projects = Array.isArray(values) ? values : [];
  const permittedProjects = projects.length >= 100 ? '*' : projects.map((p) => p.key);

  if (permittedProjects === '*' || !canvasFieldId) {
    return { ok: true, permittedProjects };
  }

  const search = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql: `"${canvasFieldId}" = "${canvasName}"`,
      fields: ['project'],
      maxResults: 100,
    }),
  });
  const searchPayload = await search.json();
  const issues = (searchPayload && searchPayload.issues) || [];
  const pinProjectKeys = [...new Set(issues.map((i) => i.fields.project.key))];
  const intersection = pinProjectKeys.filter((k) => permittedProjects.includes(k));

  if (pinProjectKeys.length > 0 && intersection.length === 0) {
    return {
      ok: false,
      error: errorResponse('NO_CANVAS_ACCESS', 'You do not have access to any project in this canvas.'),
    };
  }

  return { ok: true, permittedProjects };
}

export async function generateCanvasToken(context, payload) {
  const canvasName = payload && payload.canvasName;
  const scope = payload && payload.scope;

  if (typeof canvasName !== 'string' || canvasName.length < 1 || canvasName.length > 255) {
    return errorResult('BAD_REQUEST', 'canvasName must be a string between 1 and 255 characters.');
  }
  if (scope !== 'create' && scope !== 'view') {
    return errorResult('BAD_REQUEST', 'scope must be "create" or "view".');
  }

  if (scope === 'create' && context && context.userAccess && context.userAccess.hasAccess === false) {
    return errorResult('LICENSE_INACTIVE', 'JiraTack license is not active.');
  }

  const config = await getInstallationConfig();
  const canvasFieldId = (config.fieldRegistry && config.fieldRegistry.canvasField) || null;

  let permitted;
  try {
    permitted = await computePermittedProjects(config.viewPermissionMode, canvasName, canvasFieldId);
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
  if (!permitted.ok) return permitted;

  const permittedProjects = permitted.permittedProjects;
  const userId = (context && (context.accountId || context.userId)) || '';
  const installationId = resolveInstallationId(context);

  const token = crypto.randomBytes(32).toString('hex');
  const issuedAt = Date.now();
  const expiresAt = issuedAt + CANVAS_TOKEN_TTL_SECONDS * 1000;

  const record = {
    canvasName: String(canvasName),
    userId: String(userId),
    installationId: String(installationId),
    scope: String(scope),
    issuedAt,
    expiresAt,
    revoked: false,
    permittedProjectsJson: JSON.stringify(permittedProjects),
  };

  try {
    console.log('[JiraTack] Saving token record:', record);
    await kvsSet(`canvasTokens:${token}`, record, { ttl: { value: 30, unit: 'DAYS' } });
  } catch (e) {
    return errorResult('INTERNAL', `Failed to persist canvas token: ${e && e.message ? e.message : e}`);
  }

  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: 'jiratack',
    sub: userId,
    aud: installationId,
    canvasId: canvasName,
    canvasName,
    scope,
    permittedProjects,
    iat,
    exp: iat + SESSION_TTL_SECONDS,
  };

  let sessionJwt = null;
  try {
    sessionJwt = await generateSessionJwt(claims);
  } catch (e) {
    return errorResult('INTERNAL', `Failed to sign session JWT: ${e && e.message ? e.message : e}`);
  }

  const { apiUrl, sdkUrl } = await resolveWebtriggerUrls(config);

  return {
    ok: true,
    data: {
      token,
      sessionJwt,
      apiUrl,
      sdkUrl,
      sdkVersion: SDK_VERSION,
      canvasId: canvasName,
      canvasName,
      scope,
      permittedProjects,
    },
  };
}
