import crypto from 'crypto';
import api, { route, getAppContext } from '@forge/api';
import { WhereConditions } from '@forge/kvs';
import { getInstallationConfig, mutateInstallationConfig } from '../../lib/config.js';
import { kvs, kvsGet, kvsSet, kvsQueryAll, kvsDelete } from '../../lib/kvs.js';
import { trackLicensedUser } from '../../lib/license.js';
import { generateSessionJwt } from '../../lib/tokens.js';
import { errorResponse, errorResult } from '../../lib/errors.js';
import { resolveWebtriggerUrls } from '../../lib/webtriggerUrls.js';
import { createSeedTicket } from '../../lib/canvas.js';
import { invalidateCanvasSummary } from './dashboard.js';
import { prefillConfigKey, normalizePrefillFields, readCanvasPrefill } from '../../lib/fieldPrefill.js';
import {
  adoptLegacyThumbnail,
  canvasNameIndexKey,
  clearCanvasThumbnail,
  invalidateRegistrySnapshot,
  legacyCanvasNameIndexKey,
  deleteCanvasRecord,
  loadCanvasNameIndex,
  loadCanvasRecords,
  normaliseCanvasName,
  readCanvasRecord,
  renameCanvasRecord,
  setCanvasArchived,
  setCanvasFolder,
} from '../../lib/canvasRegistry.js';
import { createInvite } from '../../lib/invites.js';
import { tokenReference } from '../../lib/tokenRef.js';
import { isJiraAdmin, requireAdmin } from '../../lib/access.js';
import { METADATA_PROPERTY_KEY, metadataFromIssue } from '../../lib/metadata.js';
import { canvasIdsFromPayload, findCanvasKeyInMaps, resolveCanvas } from '../../lib/canvasIdentity.js';
import { SDK_VERSION } from '../../lib/version.js';

const CANVAS_TOKEN_TTL_SECONDS = 2592000;
const SESSION_TTL_SECONDS = 8 * 60 * 60;

// Flow 1 (D46): the one-time code a Jira tab mints for the extension. Short
// enough that a leaked code is useless, long enough to survive a slow tab.
const LOGIN_CODE_TTL_SECONDS = 120;

// Fields the app writes itself; mapping an auxiliary value onto them would
// clobber the ticket's own data (D41).
const MANAGED_FIELD_IDS = new Set([
  'summary', 'description', 'labels', 'issuetype', 'project', 'reporter',
  'assignee', 'priority', 'parent', 'status', 'attachment', 'comment',
  'created', 'updated', 'resolution', 'resolutiondate', 'timetracking',
  'worklog', 'workratio', 'environment', 'security', 'issuelinks',
]);

/**
 * Text-compatible Jira fields for the canvas mapping dropdown (D41).
 *
 * Only single-line/multi-line text and URL fields qualify (`schema.type` of
 * `string` with no `items`), so a pre-filled value can always be written as a
 * plain string. This is the catalogue an admin picks from when configuring a
 * project; canvases only ever use that project's chosen subset.
 */
export async function listTextFields(context) {
  const denied = await requireAdmin(context, 'Only Jira admins can configure canvases.');
  if (denied) return denied;

  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/field`);
    if (!res.ok) {
      return errorResult('INTERNAL', `Jira rejected the field list with HTTP ${res.status}.`);
    }
    const fields = await res.json();
    const list = (Array.isArray(fields) ? fields : [])
      .filter((field) => field && typeof field.id === 'string' && typeof field.name === 'string')
      .filter((field) => field.schema && field.schema.type === 'string' && !field.schema.items)
      .filter((field) => !MANAGED_FIELD_IDS.has(field.id))
      .map((field) => ({
        id: field.id,
        name: field.name,
        custom: Boolean(field.custom),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { ok: true, data: { fields: list } };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

/**
 * Resolve the canvas a dashboard action refers to. The payload carries a key,
 * a name, or both; `resolveCanvas` is the one place that knows the rules, so a
 * missing name-index row no longer makes an action fail while the overlay
 * happily resolves the same canvas.
 */
async function canvasFromPayload(payload) {
  return resolveCanvas(canvasIdsFromPayload(payload), { scan: true });
}

/**
 * The canvas's stored pre-fills, plus its label and whether it can be renamed.
 * Reads by key (D42); a pre-key canvas resolves through the name index.
 */
export async function getCanvasConfig(context, payload) {
  const denied = await requireAdmin(context, 'Only Jira admins can configure canvases.');
  if (denied) return denied;

  const resolved = await canvasFromPayload(payload);
  if (!resolved) return errorResult('NOT_FOUND', 'That canvas is not known yet.');
  const canvasKey = resolved.key;

  try {
    // Adopts a preview still held by a pre-5.72 key before reporting on it.
    const record = (await adoptLegacyThumbnail(canvasKey)) || resolved;
    const stored = await kvsGet(prefillConfigKey(canvasKey));
    return {
      ok: true,
      data: {
        canvasKey,
        canvasName: record ? record.name : (payload && payload.canvasName) || canvasKey,
        thumbnailCaptured: Boolean(record && record.thumbnailVersion === 2 && record.thumbnail),
        thumbnailNote: (record && record.thumbnailNote) || null,
        prefillFields: readCanvasPrefill(stored),
      },
    };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

/**
 * Replace a canvas's pre-fills (D41). Called from the canvas page, so a
 * creator can change the values without recreating the canvas.
 */
export async function setCanvasConfig(context, payload) {
  const denied = await requireAdmin(context, 'Only Jira admins can configure canvases.');
  if (denied) return denied;

  const resolved = await canvasFromPayload(payload);
  if (!resolved) return errorResult('NOT_FOUND', 'That canvas is not known yet.');
  const canvasKey = resolved.key;

  const normalised = normalizePrefillFields(payload && payload.prefillFields);
  if (!normalised.ok) {
    return errorResult('BAD_REQUEST', normalised.message);
  }

  try {
    await kvsSet(prefillConfigKey(canvasKey), {
      version: 2,
      prefillFields: normalised.fields,
    });
    return {
      ok: true,
      data: { canvasKey, prefillFields: normalised.fields },
    };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

/**
 * Rename a canvas label (D42). The key never changes, and every previous name
 * stays indexed, so tickets written before the rename still resolve.
 */
export async function renameCanvas(context, payload) {
  const denied = await requireAdmin(context, 'Only Jira admins can rename canvases.');
  if (denied) return denied;

  const canvasKey = payload && typeof payload.canvasKey === 'string' ? payload.canvasKey.trim() : '';
  const canvasName = payload && typeof payload.canvasName === 'string' ? payload.canvasName.trim() : '';
  if (!canvasKey) return errorResult('BAD_REQUEST', 'canvasKey is required.');
  if (!canvasName) return errorResult('BAD_REQUEST', 'canvasName is required.');

  try {
    const existing = await readCanvasRecord(canvasKey);
    if (!existing) return errorResult('NOT_FOUND', 'That canvas is not known.');

    const renamed = await renameCanvasRecord(canvasKey, canvasName);
    if (!renamed.ok) {
      if (renamed.reason === 'NAME_TAKEN') {
        return errorResult('VALIDATION_ERROR', 'Another canvas already uses that name.');
      }
      return errorResult('BAD_REQUEST', 'That name cannot be used.');
    }

    // Keep the name-based archive/delete lists pointing at the same canvas.
    await mutateInstallationConfig((draft) => {
      draft.archivedCanvases = draft.archivedCanvases.map((name) => (name === existing.name ? canvasName : name));
      draft.deletedCanvases = draft.deletedCanvases.map((name) => (name === existing.name ? canvasName : name));
      return draft;
    });

    await invalidateCanvasSummary(context && context.accountId);
    return { ok: true, data: { canvasKey, canvasName } };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

/** Move a canvas into a folder (D43). Folders are labels on the canvas record. */
export async function assignCanvasFolder(context, payload) {
  const denied = await requireAdmin(context, 'Only Jira admins can organise canvases.');
  if (denied) return denied;

  const canvasKey = payload && typeof payload.canvasKey === 'string' ? payload.canvasKey.trim() : '';
  if (!canvasKey) return errorResult('BAD_REQUEST', 'canvasKey is required.');

  const rawFolder = payload && typeof payload.folder === 'string' ? payload.folder.trim() : '';
  const folder = rawFolder ? rawFolder.slice(0, 60) : null;

  try {
    const updated = await setCanvasFolder(canvasKey, folder);
    if (!updated) return errorResult('NOT_FOUND', 'That canvas is not known.');
    await invalidateCanvasSummary(context && context.accountId);
    return { ok: true, data: { canvasKey, folder: updated.folder || null } };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

/** Drop a canvas's stored preview so the next ticket recaptures it (D43). */
export async function clearCanvasPreview(context, payload) {
  const denied = await requireAdmin(context, 'Only Jira admins can configure canvases.');
  if (denied) return denied;

  const resolved = await canvasFromPayload(payload);
  if (!resolved) return errorResult('NOT_FOUND', 'That canvas is not known yet.');
  const canvasKey = resolved.key;
  try {
    await clearCanvasThumbnail(canvasKey);
    // Older builds stored the preview under a separate key; clear it too.
    await kvsDelete(`canvasThumb:${canvasKey}`);
    await invalidateCanvasSummary(context && context.accountId);
    return { ok: true, data: { canvasKey } };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

/**
 * Registry health (D42). Legacy data is otherwise invisible: a missing
 * `canvasName:` row, a ticket with no `canvasId`, or a preview still in the
 * pre-5.72 key can only be guessed at. This reports what is actually there, so
 * the remaining fallbacks can be deleted on evidence instead of hope.
 */
export async function registryHealth(context) {
  const denied = await requireAdmin(context, 'Only Jira admins can inspect the canvas registry.');
  if (denied) return denied;

  try {
    const records = await loadCanvasRecords();
    const nameIndex = await loadCanvasNameIndex();

    const orphanIndexRows = [];
    for (const [name, key] of nameIndex) {
      if (!records.has(key)) orphanIndexRows.push({ name, canvasKey: key });
    }

    const unindexedCanvases = [];
    const duplicateLabels = [];
    const labelsSeen = new Map();
    let previewsCaptured = 0;
    let previewsMissing = 0;

    for (const record of records.values()) {
      const missing = (record.names || []).filter((name) => !nameIndex.has(normaliseCanvasName(name)));
      if (missing.length > 0) unindexedCanvases.push({ canvasKey: record.key, names: missing });

      const label = normaliseCanvasName(record.name);
      if (labelsSeen.has(label)) {
        const first = labelsSeen.get(label);
        const existing = duplicateLabels.find((entry) => entry.label === label);
        const recordEntry = { canvasKey: record.key, name: record.name, ticketCount: 0 };
        if (existing) existing.records.push(recordEntry);
        else {
          duplicateLabels.push({
            label,
            name: record.name,
            records: [{ canvasKey: first, name: record.name, ticketCount: 0 }, recordEntry],
          });
        }
      } else {
        labelsSeen.set(label, record.key);
      }

      if (record.thumbnailVersion === 2 && record.thumbnail) previewsCaptured += 1;
      else previewsMissing += 1;
    }

    let legacyPreviewKeys = 0;
    try {
      legacyPreviewKeys = (await kvsQueryAll('canvasThumb:', { max: 500, pageSize: 50 })).length;
    } catch (e) {
      legacyPreviewKeys = -1;
    }

    // Tickets: the ones the registry cannot place are the ones keeping the
    // name-based fallbacks alive.
    const tickets = { scanned: 0, withoutCanvasId: 0, unresolved: 0, withoutCanvasIdSamples: [], unresolvedSamples: [], counts: new Map() };
    const jql = 'labels = "jiratack" ORDER BY created DESC';
    const PAGE_SIZE = 100;
    const MAX_SCANNED = 2000;
    let nextPageToken = null;

    do {
      const body = {
        jql,
        fields: ['project'],
        properties: [METADATA_PROPERTY_KEY],
        maxResults: PAGE_SIZE,
      };
      if (nextPageToken) body.nextPageToken = nextPageToken;

      const res = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        return errorResult('INTERNAL', `Jira search failed with HTTP ${res.status}.`);
      }

      const data = await res.json();
      const issues = (data && data.issues) || [];
      for (const issue of issues) {
        const metadata = metadataFromIssue(issue);
        if (!metadata) continue;
        tickets.scanned += 1;

        const pin = metadata.pin || {};
        if (!pin.canvasId) {
          tickets.withoutCanvasId += 1;
          if (tickets.withoutCanvasIdSamples.length < 5) {
            tickets.withoutCanvasIdSamples.push({ key: issue.key, canvasName: pin.canvas || null });
          }
          continue;
        }

        const resolvedKey = findCanvasKeyInMaps(
          { canvasKey: pin.canvasId, canvasName: pin.canvas },
          records,
          nameIndex,
        );
        if (resolvedKey) {
          // Count by the resolved key, not by the label: a ticket can resolve
          // here through `pin.canvasId` while its `pin.canvas` is an older name.
          tickets.counts.set(resolvedKey, (tickets.counts.get(resolvedKey) || 0) + 1);
        }
        if (!resolvedKey) {
          tickets.unresolved += 1;
          if (tickets.unresolvedSamples.length < 5) {
            tickets.unresolvedSamples.push({
              key: issue.key,
              canvasName: pin.canvas || null,
              canvasId: pin.canvasId,
            });
          }
        }
      }

      nextPageToken = data && !data.isLast ? data.nextPageToken : null;
      if (!nextPageToken || issues.length === 0) break;
    } while (tickets.scanned < MAX_SCANNED);

    for (const entry of duplicateLabels) {
      for (const recordEntry of entry.records) {
        recordEntry.ticketCount = tickets.counts.get(recordEntry.canvasKey) || 0;
      }
    }

    return {
      ok: true,
      data: {
        canvases: records.size,
        nameIndexRows: nameIndex.size,
        orphanIndexRows: orphanIndexRows.length,
        unindexedCanvases: unindexedCanvases.length,
        duplicateLabels: duplicateLabels.length,
        legacyPreviewKeys,
        previews: { captured: previewsCaptured, missing: previewsMissing },
        tickets: {
          scanned: tickets.scanned,
          withoutCanvasId: tickets.withoutCanvasId,
          unresolved: tickets.unresolved,
        },
        samples: {
          orphanIndexRows: orphanIndexRows.slice(0, 5),
          unindexedCanvases: unindexedCanvases.slice(0, 5),
          duplicateLabels: duplicateLabels.slice(0, 5),
          withoutCanvasId: tickets.withoutCanvasIdSamples,
          unresolved: tickets.unresolvedSamples,
        },
      },
    };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

/**
 * Index every name a record has ever had. Only missing rows are written, and a
 * name already owned by a different existing record is left alone, so this is
 * safe to run repeatedly. It cannot repair a ticket that has no canvas key —
 * that needs the metadata pass, not the index.
 */
export async function repairCanvasIndex(context) {
  const denied = await requireAdmin(context, 'Only Jira admins can repair the canvas registry.');
  if (denied) return denied;

  try {
    const records = await loadCanvasRecords();
    const nameIndex = await loadCanvasNameIndex();
    let repaired = 0;
    let skipped = 0;

    for (const record of records.values()) {
      for (const name of record.names || []) {
        const lookup = normaliseCanvasName(name);
        if (nameIndex.get(lookup) === record.key) continue;
        const owner = nameIndex.get(lookup);
        if (owner && owner !== record.key && records.has(owner)) {
          // Another live record owns this name; do not steal it.
          skipped += 1;
          continue;
        }
        await kvsSet(canvasNameIndexKey(name), { name, canvasKey: record.key });
        nameIndex.set(lookup, record.key);
        repaired += 1;
      }
    }

    if (repaired > 0) await invalidateRegistrySnapshot();
    return { ok: true, data: { canvases: records.size, repaired, skipped } };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

/**
 * Remove a duplicate registry record that no ticket points at.
 *
 * Deleting by name is wrong here: `deleteCanvas` marks the *name* deleted, which
 * would hide the real canvas too. This deletes one record by key, and only when
 * it is a duplicate (another live record carries the same label) and nothing
 * resolves to it.
 */
export async function deleteStrayCanvasRecord(context, payload) {
  const denied = await requireAdmin(context, 'Only Jira admins can remove a stray canvas record.');
  if (denied) return denied;

  const canvasKey = payload && typeof payload.canvasKey === 'string' ? payload.canvasKey.trim() : '';
  if (!canvasKey) return errorResult('BAD_REQUEST', 'canvasKey is required.');

  try {
    const records = await loadCanvasRecords();
    const record = records.get(canvasKey);
    if (!record) return errorResult('NOT_FOUND', 'That canvas is not known.');

    const label = normaliseCanvasName(record.name);
    const siblings = [...records.values()].filter((other) => other.key !== canvasKey
      && normaliseCanvasName(other.name) === label);
    if (siblings.length === 0) {
      return errorResult('VALIDATION_ERROR', 'That record is not a duplicate; only a duplicate can be removed here.');
    }

    const nameIndex = await loadCanvasNameIndex();
    let ticketCount = 0;
    let scanned = 0;
    const jql = 'labels = "jiratack" ORDER BY created DESC';
    let nextPageToken = null;
    do {
      const body = { jql, fields: ['project'], properties: [METADATA_PROPERTY_KEY], maxResults: 100 };
      if (nextPageToken) body.nextPageToken = nextPageToken;
      const res = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return errorResult('INTERNAL', `Jira search failed with HTTP ${res.status}.`);
      const data = await res.json();
      const issues = (data && data.issues) || [];
      for (const issue of issues) {
        const metadata = metadataFromIssue(issue);
        if (!metadata) continue;
        const resolved = findCanvasKeyInMaps(
          { canvasKey: metadata.pin && metadata.pin.canvasId, canvasName: metadata.pin && metadata.pin.canvas },
          records,
          nameIndex,
        );
        if (resolved === canvasKey) ticketCount += 1;
      }
      scanned += issues.length;
      nextPageToken = data && !data.isLast ? data.nextPageToken : null;
      if (!nextPageToken || issues.length === 0) break;
    } while (ticketCount === 0 && scanned < 2000);

    if (ticketCount > 0) {
      return errorResult('CANVAS_NOT_EMPTY', 'Tickets still resolve to this record, so it is a canvas and cannot be removed here.', { ticketCount });
    }

    // Remove only the index rows this record owns; rows owned by the sibling stay.
    for (const name of record.names || []) {
      for (const key of [canvasNameIndexKey(name), legacyCanvasNameIndexKey(name)]) {
        try {
          const value = await kvsGet(key);
          const owner = typeof value === 'string' ? value : (value && value.canvasKey);
          if (owner === canvasKey) await kvsDelete(key);
        } catch (e) {
          // A leftover row is reported as orphaned, not fatal.
        }
      }
    }

    await kvsDelete(prefillConfigKey(canvasKey));
    await deleteCanvasRecord(canvasKey);
    await invalidateRegistrySnapshot();
    await invalidateCanvasSummary(context && context.accountId);
    return { ok: true, data: { canvasKey, canvasName: record.name } };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

/** The installation-level text-field catalogue a canvas can pre-fill (D41). */
export async function listAvailableTextFields(context) {
  const denied = await requireAdmin(context, 'Only Jira admins can configure canvases.');
  if (denied) return denied;

  try {
    const config = await getInstallationConfig();
    let fields = Array.isArray(config.textFields) ? config.textFields : [];

    // Migration: the first cut stored the catalogue per project. Use the union
    // until the admin saves the global list.
    if (fields.length === 0) {
      const seen = new Map();
      Object.values(config.projects || {}).forEach((project) => {
        if (!project || !Array.isArray(project.textFields)) return;
        project.textFields.forEach((field) => {
          if (field && field.id && field.name && !seen.has(field.id)) {
            seen.set(field.id, { id: field.id, name: field.name });
          }
        });
      });
      fields = Array.from(seen.values());
    }

    return { ok: true, data: { fields } };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
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

async function lookupUser(accountId) {
  if (!accountId) return { displayName: null, emailAddress: null };
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`);
    if (!res.ok) return { displayName: null, emailAddress: null };
    const data = await res.json();
    return {
      displayName: (data && data.displayName) || null,
      emailAddress: (data && data.emailAddress) || null,
    };
  } catch (e) {
    return { displayName: null, emailAddress: null };
  }
}

async function computePermittedProjects(mode, canvasName) {
  if (mode === 'open') {
    return { ok: true, permittedProjects: '*' };
  }

  const raw = await api.asUser().requestJira(route`/rest/api/3/project/search?action=browse&maxResults=100`);
  const payload = await raw.json();
  const values = (payload && payload.values) || payload || [];
  const projects = Array.isArray(values) ? values : [];
  const permittedProjects = projects.length >= 100 ? '*' : projects.map((p) => p.key);

  if (permittedProjects === '*' || !canvasName) {
    return { ok: true, permittedProjects };
  }

  const search = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql: 'labels = "jiratack"',
      fields: ['project'],
      properties: [METADATA_PROPERTY_KEY],
      maxResults: 100,
    }),
  });
  const searchPayload = await search.json();
  const issues = (searchPayload && searchPayload.issues) || [];
  const pinProjectKeys = [...new Set(
    issues
      .filter((issue) => {
        const metadata = metadataFromIssue(issue);
        return metadata && metadata.pin.canvas === canvasName;
      })
      .map((issue) => issue.fields && issue.fields.project && issue.fields.project.key)
      .filter(Boolean),
  )];
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
  await trackLicensedUser(context);

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

  let permitted;
  try {
    permitted = await computePermittedProjects(config.viewPermissionMode, canvasName);
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
  if (!permitted.ok) return permitted;

  const permittedProjects = permitted.permittedProjects;

  // Scope the bookmarklet to a selection of canvases (D43). 'all' keeps the
  // link current as canvases are added; a list freezes it and must be
  // regenerated to include new canvases.
  let permittedCanvases = 'all';
  if (payload && Array.isArray(payload.permittedCanvases)) {
    const names = payload.permittedCanvases
      .map((name) => (typeof name === 'string' ? name.trim() : ''))
      .filter(Boolean)
      .slice(0, 200);
    if (names.length === 0) {
      return errorResult('VALIDATION_ERROR', 'Choose at least one canvas, or allow all canvases.');
    }
    permittedCanvases = Array.from(new Set(names));
  }

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
    isAdmin: await isJiraAdmin(context),
    issuedAt,
    expiresAt,
    revoked: false,
    permittedProjectsJson: JSON.stringify(permittedProjects),
    permittedCanvasesJson: JSON.stringify(permittedCanvases),
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
    isAdmin: record.isAdmin === true,
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

  // `canvasId` stays a name for older clients; `canvasKey` is the stable id a
  // client should use from now on (D42).
  const canvasRecord = await resolveCanvas({ canvasName });

  return {
    ok: true,
    data: {
      token,
      sessionJwt,
      apiUrl,
      sdkUrl,
      sdkVersion: SDK_VERSION,
      canvasId: canvasName,
      canvasKey: canvasRecord ? canvasRecord.key : null,
      canvasName,
      scope,
      permittedProjects,
    },
  };
}

export async function generateGuestToken(context, payload) {
  await trackLicensedUser(context);

  // A guest link is mintable by any user holding a JiraTack seat, not just
  // site admins; the seat is the authorisation boundary.
  if (context && context.userAccess && context.userAccess.hasAccess === false) {
    return errorResult('LICENSE_INACTIVE', 'JiraTack license is not active.');
  }

  const rawCanvases = payload && payload.permittedCanvases;
  if (!Array.isArray(rawCanvases) || rawCanvases.length === 0) {
    return errorResult('VALIDATION_ERROR', 'permittedCanvases must be a non-empty array of canvas names.');
  }
  if (rawCanvases.length > 50) {
    return errorResult('VALIDATION_ERROR', 'permittedCanvases cannot contain more than 50 canvases.');
  }

  const permittedCanvases = [];
  for (const rawCanvas of rawCanvases) {
    const name = typeof rawCanvas === 'string' ? rawCanvas.trim() : '';
    if (name.length === 0 || name.length > 255) {
      return errorResult('VALIDATION_ERROR', 'Each permitted canvas must be a string between 1 and 255 characters.');
    }
    if (!permittedCanvases.includes(name)) permittedCanvases.push(name);
  }

  const config = await getInstallationConfig();

  let permitted;
  try {
    permitted = await computePermittedProjects(config.viewPermissionMode, null);
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
  if (!permitted.ok) return permitted;

  const guestName = typeof (payload && payload.guestName) === 'string' ? payload.guestName.trim() : '';
  const guestEmail = typeof (payload && payload.guestEmail) === 'string' ? payload.guestEmail.trim() : '';
  if (guestName.length === 0 || guestName.length > 200) {
    return errorResult('VALIDATION_ERROR', 'guestName is required (1-200 characters).');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail) || guestEmail.length > 320) {
    return errorResult('VALIDATION_ERROR', 'A valid guestEmail is required.');
  }

  const issuer = (context && (context.accountId || context.userId)) || '';
  const installationId = resolveInstallationId(context);
  const sponsor = await lookupUser(issuer);

  let created;
  try {
    created = await createInvite({
      issuer,
      issuedByName: sponsor.displayName,
      issuerEmail: sponsor.emailAddress,
      guestName,
      guestEmail,
      permittedCanvases,
      permittedProjects: permitted.permittedProjects,
      installationId,
    });
  } catch (e) {
    return errorResult('INTERNAL', `Failed to create the guest invitation: ${e && e.message ? e.message : e}`);
  }
  const token = created.token;

  let installUrl = null;
  try {
    ({ installUrl } = await resolveWebtriggerUrls(config));
  } catch (e) {
    installUrl = null;
  }
  const installerUrl = installUrl
    ? `${installUrl}${installUrl.includes('?') ? '&' : '?'}code=${encodeURIComponent(created.code)}`
    : null;

  return {
    ok: true,
    data: {
      token,
      code: created.code,
      installerUrl,
      scope: 'guest_create',
      permittedCanvases,
      permittedProjects: permitted.permittedProjects,
      expiresAt: created.record.linkExpiresAt,
      guestName: created.record.guestName,
      guestEmail: created.record.guestEmail,
    },
  };
}

/**
 * Tokens are credentials. The admin surface never needs the raw value, so
 * records are identified by a short non-reversible reference instead.
 */
async function queryCanvasTokenEntries() {
  return kvsQueryAll('canvasTokens:');
}

export async function listCanvasTokens(context) {
  const denied = await requireAdmin(context, 'Only Jira admins can list tokens.');
  if (denied) return denied;

  try {
    const tokens = (await queryCanvasTokenEntries())
      .map(({ key, value }) => ({
        tokenRef: tokenReference(String(key).replace('canvasTokens:', '')),
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

export async function revokeCanvasToken(context, payload) {
  const denied = await requireAdmin(context, 'Only Jira admins can revoke tokens.');
  if (denied) return denied;

  const token = payload && payload.token;
  const ref = payload && payload.tokenRef;

  try {
    let key = null;
    if (typeof token === 'string' && token.length > 0) {
      key = `canvasTokens:${token}`;
    } else if (typeof ref === 'string' && ref.length > 0) {
      const entries = await queryCanvasTokenEntries();
      const match = entries.find(({ key: entryKey }) => (
        tokenReference(String(entryKey).replace('canvasTokens:', '')) === ref
      ));
      key = match ? match.key : null;
    } else {
      return errorResult('BAD_REQUEST', 'tokenRef is required.');
    }

    if (!key) {
      return errorResult('NOT_FOUND', 'Canvas token not found.');
    }

    const existing = await kvsGet(key);
    if (!existing) {
      return errorResult('NOT_FOUND', 'Canvas token not found.');
    }

    // Tombstone, never delete (D24/S2): credentials derived from this invite
    // must remain resolvable to a revoked parent, and the admin list needs the
    // audit trail. 90 days covers the invitation review window.
    await kvsSet(
      key,
      { ...existing, revoked: true, revokedAt: Date.now() },
      { ttl: { value: 90, unit: 'DAYS' } },
    );
    return { ok: true, data: { revoked: true } };
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

const USER_TOKEN_TTL_DAYS = 90;

export async function generateUserToken(context, payload) {
  await trackLicensedUser(context);

  const scope = (context && context.userAccess && context.userAccess.hasAccess === false) ? 'view' : 'create';

  const config = await getInstallationConfig();

  let permitted;
  try {
    permitted = await computePermittedProjects(config.viewPermissionMode, null);
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
  if (!permitted.ok) return permitted;

  const permittedProjects = permitted.permittedProjects;

  // Scope the bookmarklet to a selection of canvases (D43). 'all' keeps the
  // link current as canvases are added; a list freezes it and must be
  // regenerated to include new canvases.
  let permittedCanvases = 'all';
  if (payload && Array.isArray(payload.permittedCanvases)) {
    const names = payload.permittedCanvases
      .map((name) => (typeof name === 'string' ? name.trim() : ''))
      .filter(Boolean)
      .slice(0, 200);
    if (names.length === 0) {
      return errorResult('VALIDATION_ERROR', 'Choose at least one canvas, or allow all canvases.');
    }
    permittedCanvases = Array.from(new Set(names));
  }

  const userId = (context && (context.accountId || context.userId)) || '';
  const installationId = resolveInstallationId(context);
  const token = crypto.randomBytes(32).toString('hex');
  const issuedAt = Date.now();
  const expiresAt = issuedAt + USER_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

  const record = {
    userId: String(userId),
    installationId: String(installationId),
    scope,
    isAdmin: await isJiraAdmin(context),
    issuedAt,
    expiresAt,
    revoked: false,
    permittedProjectsJson: JSON.stringify(permittedProjects),
    permittedCanvasesJson: JSON.stringify(permittedCanvases),
  };

  try {
    console.log('[JiraTack] Saving user token record:', {
      userId: record.userId,
      scope,
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

/**
 * Flow 1 (D46): the extension has no link to paste, so a Jira tab mints a
 * one-time code that the extension trades for a user token. The resolver is the
 * only place that knows the real user, and the code carries nothing but the
 * identity resolved here — it is not a session and cannot read or write.
 */
export async function createExtensionLogin(context) {
  const accountId = (context && (context.accountId || context.userId)) || '';
  if (!accountId) {
    return errorResult('BAD_REQUEST', 'A signed-in Jira user is required to connect the extension.');
  }

  await trackLicensedUser(context);

  const config = await getInstallationConfig();

  let permitted;
  try {
    permitted = await computePermittedProjects(config.viewPermissionMode, null);
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
  if (!permitted.ok) return permitted;

  const code = crypto.randomBytes(32).toString('hex');
  const issuedAt = Date.now();
  const expiresAt = issuedAt + LOGIN_CODE_TTL_SECONDS * 1000;

  try {
    await kvsSet(`extensionLoginCodes:${code}`, {
      accountId: String(accountId),
      installationId: String(resolveInstallationId(context)),
      isAdmin: await isJiraAdmin(context),
      permittedProjectsJson: JSON.stringify(permitted.permittedProjects),
      issuedAt,
      expiresAt,
    }, { ttl: { value: 10, unit: 'MINUTES' } });
  } catch (e) {
    return errorResult('INTERNAL', `Failed to persist the login code: ${e && e.message ? e.message : e}`);
  }

  const { apiUrl, sdkUrl } = await resolveWebtriggerUrls(config);

  return {
    ok: true,
    data: {
      code,
      apiUrl,
      sdkUrl,
      sdkVersion: SDK_VERSION,
      expiresAt,
    },
  };
}

export async function createCanvas(context, payload) {
  const denied = await requireAdmin(context, 'Only Jira admins can create canvases.');
  if (denied) return denied;

  try {
    const result = await createSeedTicket({
      requester: api.asUser(),
      reporterAccountId: context && context.accountId,
      canvasName: payload && payload.canvasName,
      targetUrl: payload && payload.targetUrl,
      projectKey: payload && payload.projectKey,
      issueTypeId: payload && payload.issueTypeId,
      prefillFields: payload && payload.prefillFields,
    });
    await invalidateCanvasSummary(context && context.accountId);
    return result;
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }
}

export async function deleteCanvas(context, payload) {
  const isAdmin = await isJiraAdmin(context);
  if (!isAdmin) {
    return errorResult('INSUFFICIENT_SCOPE', 'Admin access is required.');
  }

  const resolved = await canvasFromPayload(payload);
  const canvasKey = resolved ? resolved.key : null;
  const requestedName = payload && typeof payload.canvasName === 'string' ? payload.canvasName.trim() : '';
  if (!canvasKey && !requestedName) {
    return errorResult('BAD_REQUEST', 'canvasKey or canvasName is required.');
  }

  const record = resolved;
  const names = Array.from(new Set([
    ...((record && record.names) || []),
    requestedName,
  ].filter(Boolean)));
  const displayName = (record && record.name) || requestedName || canvasKey;

  const jql = `labels = "jiratack" ORDER BY created ASC`;
  const issues = [];
  let nextPageToken = null;
  const MAX_SCANNED = 2000;

  try {
    while (issues.length < MAX_SCANNED) {
      const body = { jql, fields: ['status'], properties: [METADATA_PROPERTY_KEY], maxResults: 100 };
      if (nextPageToken) body.nextPageToken = nextPageToken;

      const res = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        return errorResult('INTERNAL', `Canvas query failed with HTTP ${res.status}.`);
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

  const canvasIssues = issues.filter((issue) => {
    const metadata = metadataFromIssue(issue);
    if (!metadata) return false;
    if (canvasKey && metadata.pin.canvasId === canvasKey) return true;
    return names.includes(metadata.pin.canvas);
  });

  const openIssues = canvasIssues.filter((issue) => {
    const category = issue.fields && issue.fields.status && issue.fields.status.statusCategory
      ? issue.fields.status.statusCategory.key
      : '';
    return category !== 'done';
  });

  if (openIssues.length > 0) {
    return errorResult(
      'CANVAS_NOT_EMPTY',
      'Cannot delete: This canvas still has open tickets.',
      { openCount: openIssues.length, total: canvasIssues.length },
    );
  }

  try {
    await mutateInstallationConfig((draft) => {
      draft.archivedCanvases = draft.archivedCanvases.filter((name) => !names.includes(name));
      names.forEach((name) => {
        if (!draft.deletedCanvases.includes(name)) draft.deletedCanvases.push(name);
      });
      return draft;
    });
    if (canvasKey) {
      await kvsDelete(prefillConfigKey(canvasKey));
      await deleteCanvasRecord(canvasKey);
    }
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }

  await invalidateCanvasSummary(context && context.accountId);
  return {
    ok: true,
    data: { canvasKey: canvasKey || null, canvasName: displayName, deleted: true, ticketCount: canvasIssues.length },
  };
}


export async function archiveCanvas(context, payload) {
  const isAdmin = await isJiraAdmin(context);
  if (!isAdmin) {
    return errorResult('INSUFFICIENT_SCOPE', 'Admin access is required.');
  }

  const resolved = await canvasFromPayload(payload);
  const canvasKey = resolved ? resolved.key : null;
  const requestedName = payload && typeof payload.canvasName === 'string' ? payload.canvasName.trim() : '';
  if (!canvasKey && !requestedName) {
    return errorResult('BAD_REQUEST', 'canvasKey or canvasName is required.');
  }

  const canvasName = (resolved && resolved.name) || requestedName || canvasKey;

  try {
    await mutateInstallationConfig((draft) => {
      if (!draft.archivedCanvases.includes(canvasName)) {
        draft.archivedCanvases.push(canvasName);
      }
      return draft;
    });
    if (canvasKey) await setCanvasArchived(canvasKey, true);
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }

  await invalidateCanvasSummary(context && context.accountId);
  return { ok: true, data: { canvasKey: canvasKey || null, canvasName, archived: true } };
}
