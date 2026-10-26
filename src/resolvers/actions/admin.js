import crypto from 'crypto';
import api, { route, getAppContext } from '@forge/api';
import { WhereConditions } from '@forge/kvs';
import { provisionFields } from '../../lib/fields.js';
import { getInstallationConfig } from '../../lib/config.js';
import { kvsGet, kvsSet, kvs } from '../../lib/kvs.js';
import { generateSessionJwt } from '../../lib/tokens.js';
import { errorResponse, errorResult } from '../../lib/errors.js';
import { resolveWebtriggerUrls } from '../../lib/webtriggerUrls.js';
import { createSeedTicket } from '../../lib/canvas.js';
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

export async function listCanvasTokens() {
  try {
    const result = await kvs
      .query()
      .where('key', WhereConditions.beginsWith('canvasTokens:'))
      .limit(100)
      .getMany();

    const entries = (result && result.results) || [];
    const tokens = entries
      .map(({ key, value }) => ({
        token: String(key).replace('canvasTokens:', ''),
        canvasName: value.canvasName,
        userId: value.userId,
        scope: value.scope,
        issuedAt: value.issuedAt,
        expiresAt: value.expiresAt,
        revoked: Boolean(value.revoked),
      }))
      .sort((a, b) => (b.issuedAt || 0) - (a.issuedAt || 0));

    return { ok: true, data: { tokens } };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

export async function revokeCanvasToken(payload) {
  const token = payload && payload.token;
  if (typeof token !== 'string' || token.length === 0) {
    return errorResult('BAD_REQUEST', 'token is required.');
  }

  const key = `canvasTokens:${token}`;
  try {
    const existing = await kvsGet(key);
    if (!existing) {
      return errorResult('NOT_FOUND', 'Canvas token not found.');
    }
    await kvs.delete(key);
    return { ok: true, data: { token, revoked: true } };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

export async function autoUpdateFieldMappings(context, payload) {
  const config = await getInstallationConfig();
  const fieldRegistry = config.fieldRegistry || {};
  const fieldIds = [
    fieldRegistry.canvasField,
    fieldRegistry.urlField,
    fieldRegistry.pinField,
    fieldRegistry.selectorField,
  ].filter(Boolean);

  if (fieldIds.length === 0) {
    return errorResult('BAD_REQUEST', 'Provision fields before auto-updating field mappings.');
  }

  const warnings = [];
  const updatedScreens = [];

  try {
    const screensRes = await api.asUser().requestJira(route`/rest/api/3/screens?maxResults=100`);
    if (!screensRes.ok) {
      return errorResult('INTERNAL', `Failed to list screens with HTTP ${screensRes.status}.`);
    }
    const screensJson = await screensRes.json();
    const screens = (screensJson && screensJson.values) || [];

    const defaultScreens = screens.filter((screen) => /default/i.test(screen.name || ''));
    const targets = defaultScreens.length > 0 ? defaultScreens : screens;

    if (targets.length === 0) {
      return { ok: true, data: { updatedScreens: [], warnings: ['No screens found.'] } };
    }

    for (const screen of targets) {
      try {
        let tabsRes;
        try {
          tabsRes = await api.asUser().requestJira(route`/rest/api/3/screens/${screen.id}/tabs`);
        } catch (e) {
          console.error(`[JiraTack] Failed to read tabs for screen ${screen.name}:`, e);
          warnings.push(
            `Skipped screen ${screen.name} (Team-managed screens must be configured manually): ${e && e.message ? e.message : e}`,
          );
          continue;
        }

        if (!tabsRes.ok) {
          console.error(`[JiraTack] Tabs request for screen ${screen.name} returned HTTP ${tabsRes.status}.`);
          if (tabsRes.status === 400 || tabsRes.status === 403) {
            warnings.push(
              `Skipped screen ${screen.name} (Team-managed screens must be configured manually): HTTP ${tabsRes.status}.`,
            );
          } else {
            warnings.push(`Failed to list tabs for screen ${screen.name}: HTTP ${tabsRes.status}.`);
          }
          continue;
        }

        let tabs = [];
        try {
          tabs = (await tabsRes.json()) || [];
        } catch (e) {
          warnings.push(`Skipped screen ${screen.name}: could not parse tabs response.`);
          continue;
        }

        const added = [];

        for (const tab of tabs) {
          try {
            const fieldsRes = await api.asUser().requestJira(route`/rest/api/3/screens/${screen.id}/tabs/${tab.id}/fields`);
            let existingIds = [];
            if (fieldsRes.ok) {
              const existing = await fieldsRes.json();
              const list = Array.isArray(existing) ? existing : (existing && existing.values) || [];
              existingIds = list.map((field) => field.id);
            } else {
              warnings.push(`Failed to list fields for ${screen.name} / ${tab.name}: HTTP ${fieldsRes.status}.`);
            }

            for (const fieldId of fieldIds) {
              if (existingIds.includes(fieldId)) continue;

              const addRes = await api.asUser().requestJira(
                route`/rest/api/3/screens/${screen.id}/tabs/${tab.id}/fields`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ fieldId }),
                },
              );

              if (addRes.ok) {
                added.push(fieldId);
                existingIds.push(fieldId);
              } else {
                warnings.push(`Failed to add ${fieldId} to ${screen.name} / ${tab.name}: HTTP ${addRes.status}.`);
              }
            }
          } catch (e) {
            console.error(`[JiraTack] Failed to process tab on screen ${screen.name}:`, e);
            warnings.push(`Skipped tab on ${screen.name}: ${e && e.message ? e.message : e}`);
          }
        }

        if (added.length > 0) {
          updatedScreens.push({ id: screen.id, name: screen.name, added });
        }
      } catch (e) {
        console.error(`[JiraTack] Failed to process screen ${screen.name}:`, e);
        warnings.push(`Skipped screen ${screen.name}: ${e && e.message ? e.message : e}`);
      }
    }

    console.log('[JiraTack] Auto field mapping complete:', { updatedScreens, warnings });
    return { ok: true, data: { updatedScreens, warnings } };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

const PIN_MARKER_PREFIX = '📌 JiraTack pin:';

function findMarkerText(node) {
  if (!node || typeof node !== 'object') return null;

  if (node.type === 'paragraph' && Array.isArray(node.content)) {
    const firstText = node.content.find((child) => child && child.type === 'text');
    const text = firstText && typeof firstText.text === 'string' ? firstText.text : '';
    if (text.startsWith(PIN_MARKER_PREFIX)) {
      return text.slice(PIN_MARKER_PREFIX.length).trim();
    }
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const found = findMarkerText(child);
      if (found) return found;
    }
  }

  return null;
}

function parsePinMarker(descriptionAdf) {
  const raw = findMarkerText(descriptionAdf);
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed.canvas !== 'string' || !parsed.canvas) return null;
  if (typeof parsed.url !== 'string' || !parsed.url) return null;
  if (typeof parsed.position !== 'string' || !parsed.position) return null;
  return {
    canvas: parsed.canvas,
    url: parsed.url,
    position: parsed.position,
    selector: typeof parsed.selector === 'string' && parsed.selector ? parsed.selector : null,
  };
}

async function isJiraAdmin(context) {
  if (context && context.userAccess && context.userAccess.isAdmin === true) {
    return true;
  }
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
    if (res.ok) {
      const data = await res.json();
      const permission = data && data.permissions && data.permissions.ADMINISTER;
      return Boolean(permission && permission.havePermission);
    }
  } catch (e) {
    return false;
  }
  return false;
}

export async function recoverPinsFromDescriptions(context, payload) {
  const isAdmin = await isJiraAdmin(context);
  if (!isAdmin) {
    return errorResult('INSUFFICIENT_SCOPE', 'Admin access is required.');
  }

  const dryRun = Boolean(payload && payload.dryRun);
  const config = await getInstallationConfig();
  const fieldRegistry = config.fieldRegistry || {};
  if (!fieldRegistry.canvasField || !fieldRegistry.urlField || !fieldRegistry.pinField) {
    return errorResult('BAD_REQUEST', 'Provision fields before running recovery.');
  }

  const jql = `labels = "jiratack" ORDER BY created ASC`;
  const issues = [];
  let nextPageToken = null;
  const MAX_SCANNED = 2000;

  try {
    while (issues.length < MAX_SCANNED) {
      const body = { jql, fields: ['description', fieldRegistry.canvasField], maxResults: 100 };
      if (nextPageToken) body.nextPageToken = nextPageToken;

      const res = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        return errorResult('INTERNAL', `Recovery query failed with HTTP ${res.status}.`);
      }

      const data = await res.json();
      const batch = (data && data.issues) || [];
      issues.push(...batch);

      if (batch.length === 0) break;
      if (data && (data.isLast || !data.nextPageToken)) break;
      nextPageToken = data && data.nextPageToken;
      if (!nextPageToken) break;
    }
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }

  const alreadyPopulated = issues.filter(
    (issue) => issue.fields && issue.fields[fieldRegistry.canvasField],
  ).length;
  const candidates = issues
    .filter((issue) => !(issue.fields && issue.fields[fieldRegistry.canvasField]))
    .slice(0, 500);
  const truncated = candidates.length >= 500;
  console.log(
    '[JiraTack] Recovery scan:',
    { scanned: issues.length, alreadyPopulated, candidates: candidates.length, jql },
  );

  let recovered = 0;
  let skipped = 0;
  const errors = [];

  for (const issue of candidates) {
    const marker = parsePinMarker(issue.fields && issue.fields.description);
    if (!marker) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      recovered += 1;
      continue;
    }

    const fields = {
      [fieldRegistry.canvasField]: marker.canvas,
      [fieldRegistry.urlField]: marker.url,
      [fieldRegistry.pinField]: marker.position,
    };
    if (fieldRegistry.selectorField && marker.selector) {
      fields[fieldRegistry.selectorField] = marker.selector;
    }

    try {
      const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issue.key}?overrideScreenSecurity=true&overrideEditableFlag=true`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      if (res.ok) {
        recovered += 1;
      } else {
        let errorText = '';
        try {
          const raw = await res.text();
          errorText = raw ? raw.slice(0, 800) : '';
        } catch (readError) {
          errorText = '';
        }
        console.error('[JiraTack] Recovery PUT failed:', issue.key, res.status, fields, errorText);
        skipped += 1;
        errors.push(`${issue.key}: HTTP ${res.status}${errorText ? ` - ${errorText}` : ''}`);
      }
    } catch (e) {
      skipped += 1;
      errors.push(`${issue.key}: ${e && e.message ? e.message : e}`);
    }
  }

  return {
    ok: true,
    data: {
      recovered,
      skipped,
      errors,
      truncated,
      dryRun,
      candidates: candidates.length,
      scanned: issues.length,
      alreadyPopulated,
    },
  };
}

const USER_TOKEN_TTL_DAYS = 90;

export async function generateUserToken(context) {
  if (context && context.userAccess && context.userAccess.hasAccess === false) {
    return errorResult('LICENSE_INACTIVE', 'JiraTack license is not active.');
  }

  const config = await getInstallationConfig();

  let permitted;
  try {
    permitted = await computePermittedProjects(config.viewPermissionMode, null, null);
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
  if (!permitted.ok) return permitted;

  const permittedProjects = permitted.permittedProjects;
  const userId = (context && (context.accountId || context.userId)) || '';
  const installationId = resolveInstallationId(context);
  const token = crypto.randomBytes(32).toString('hex');
  const issuedAt = Date.now();
  const expiresAt = issuedAt + USER_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

  const record = {
    userId: String(userId),
    installationId: String(installationId),
    issuedAt,
    expiresAt,
    revoked: false,
    permittedProjectsJson: JSON.stringify(permittedProjects),
  };

  try {
    console.log('[JiraTack] Saving user token record:', {
      userId: record.userId,
      permittedProjects,
      expiresAt,
    });
    await kvsSet(`userTokens:${token}`, record, { ttl: { value: USER_TOKEN_TTL_DAYS, unit: 'DAYS' } });
  } catch (e) {
    return errorResult('INTERNAL', `Failed to persist user token: ${e && e.message ? e.message : e}`);
  }

  const { apiUrl, sdkUrl } = await resolveWebtriggerUrls(config);

  return {
    ok: true,
    data: {
      token,
      apiUrl,
      sdkUrl,
      sdkVersion: SDK_VERSION,
    },
  };
}

export async function createCanvas(context, payload) {
  try {
    return await createSeedTicket({
      requester: api.asUser(),
      reporterAccountId: context && context.accountId,
      canvasName: payload && payload.canvasName,
      targetUrl: payload && payload.targetUrl,
      projectKey: payload && payload.projectKey,
      issueTypeId: payload && payload.issueTypeId,
    });
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}
