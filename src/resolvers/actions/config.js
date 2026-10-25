import { getInstallationConfig, setInstallationConfig } from '../../lib/config.js';

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
  const config = await getInstallationConfig();
  const projectKey = payload && payload.projectKey;
  const existing = (config.projects && config.projects[projectKey]) || {};
  return { ok: true, data: { ...PROJECT_DEFAULTS, ...existing } };
}

export async function setProjectConfig(context, payload) {
  const config = await getInstallationConfig();
  const projectKey = payload && payload.projectKey;
  const settings = (payload && payload.settings) || {};
  if (!config.projects) config.projects = {};
  config.projects[projectKey] = { ...PROJECT_DEFAULTS, ...(config.projects[projectKey] || {}), ...settings };
  const updated = await setInstallationConfig(config);
  return { ok: true, data: updated.projects[projectKey] };
}
