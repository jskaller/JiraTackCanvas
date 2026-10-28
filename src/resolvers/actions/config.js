import { getInstallationConfig, mutateInstallationConfig } from '../../lib/config.js';
import { requireAdmin } from '../../lib/access.js';

const PROJECT_DEFAULTS = {
  enabled: true,
  defaultIssueTypeId: null,
  defaultPriorityId: null,
  defaultAssigneeAccountId: null,
  retirementDays: 0,
  captureConsoleLogs: false,
  consoleLogsDefaultChecked: false,
};

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
  const updated = await mutateInstallationConfig((draft) => {
    draft.projects[projectKey] = {
      ...PROJECT_DEFAULTS,
      ...(draft.projects[projectKey] || {}),
      ...settings,
    };
    return draft;
  });

  return { ok: true, data: updated.projects[projectKey] };
}
