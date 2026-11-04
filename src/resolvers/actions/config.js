import api, { route } from '@forge/api';
import { getInstallationConfig, mutateInstallationConfig } from '../../lib/config.js';
import { requireAdmin } from '../../lib/access.js';

const PROJECT_DEFAULTS = {
  enabled: true,
  defaultIssueTypeId: null,
  defaultPriorityId: null,
  defaultAssigneeAccountId: null,
  // null = the default rule (hide the Done status category). An array of
  // status IDs hides exactly those. [] hides nothing. D38.
  filteredStatusIds: null,
  captureConsoleLogs: false,
  consoleLogsDefaultChecked: false,
};

const ALLOWED_SETTINGS = new Set(Object.keys(PROJECT_DEFAULTS));

export async function getProjectConfig(context, payload) {
  const denied = await requireAdmin(context, 'Only Jira admins can view project settings.');
  if (denied) return denied;

  const config = await getInstallationConfig();
  const projectKey = payload && payload.projectKey;
  const existing = (config.projects && config.projects[projectKey]) || {};
  return { ok: true, data: { ...PROJECT_DEFAULTS, ...existing } };
}

export async function setProjectConfig(context, payload) {
  const denied = await requireAdmin(context, 'Only Jira admins can change project settings.');
  if (denied) return denied;

  const projectKey = payload && payload.projectKey;
  if (typeof projectKey !== 'string' || projectKey.length === 0) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: 'projectKey is required.' } };
  }

  const settings = (payload && payload.settings) || {};
  const clean = {};
  for (const key of Object.keys(settings)) {
    if (!ALLOWED_SETTINGS.has(key)) continue;
    let value = settings[key];
    if (key === 'filteredStatusIds') {
      if (value === null || value === undefined) {
        value = null;
      } else if (Array.isArray(value)) {
        value = value.map((id) => String(id)).filter(Boolean);
      } else {
        return {
          ok: false,
          error: { code: 'BAD_REQUEST', message: 'filteredStatusIds must be an array of status IDs or null.' },
        };
      }
    }
    clean[key] = value;
  }

  const updated = await mutateInstallationConfig((draft) => {
    draft.projects[projectKey] = {
      ...PROJECT_DEFAULTS,
      ...(draft.projects[projectKey] || {}),
      ...clean,
    };
    return draft;
  });

  return { ok: true, data: updated.projects[projectKey] };
}

/**
 * The project's statuses, flattened and de-duplicated, so the settings UI can
 * offer the exact filter rule (D38). Admin-only, same as the settings page.
 */
export async function getProjectStatuses(context, payload) {
  const denied = await requireAdmin(context, 'Only Jira admins can view project settings.');
  if (denied) return denied;

  const projectKey = payload && payload.projectKey;
  if (typeof projectKey !== 'string' || projectKey.length === 0) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: 'projectKey is required.' } };
  }

  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/project/${projectKey}/statuses`);
    if (!res.ok) {
      return { ok: false, error: { code: 'UPSTREAM', message: `Jira returned ${res.status}.` } };
    }
    const byType = await res.json();
    const seen = new Map();
    for (const type of Array.isArray(byType) ? byType : []) {
      for (const status of Array.isArray(type.statuses) ? type.statuses : []) {
        if (!status || status.id == null) continue;
        if (!seen.has(status.id)) {
          seen.set(status.id, {
            id: String(status.id),
            name: status.name || String(status.id),
            statusCategory: status.statusCategory ? { key: status.statusCategory.key || '', name: status.statusCategory.name || '' } : null,
          });
        }
      }
    }
    return {
      ok: true,
      data: {
        statuses: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)),
      },
    };
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
}
