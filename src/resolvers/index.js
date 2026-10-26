import Resolver from '@forge/resolver';
import { getInstallationConfig, setInstallationConfig } from '../lib/config.js';
import { runProvisionFields, generateCanvasToken, listCanvasTokens, revokeCanvasToken, autoUpdateFieldMappings } from './actions/admin.js';
import { getProjectConfig, setProjectConfig } from './actions/config.js';
import { dashboardAggregate } from './actions/dashboard.js';
import { epicPanelData } from './actions/epic.js';
import { issuePanelData } from './actions/issue.js';

const resolver = new Resolver();

resolver.define('provisionFields', async (req) => {
  try {
    return await runProvisionFields(req.context);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('generateCanvasToken', async (req) => {
  try {
    return await generateCanvasToken(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('getInstallationConfig', async () => {
  try {
    const config = await getInstallationConfig();
    return { ok: true, data: config };
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('setInstallationConfig', async (req) => {
  try {
    const current = await getInstallationConfig();
    const merged = { ...current, ...(req.payload || {}) };
    if (req.payload && req.payload.projects) {
      merged.projects = { ...(current.projects || {}), ...req.payload.projects };
    }
    const updated = await setInstallationConfig(merged);
    return { ok: true, data: updated };
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('getProjectConfig', async (req) => {
  try {
    return await getProjectConfig(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('setProjectConfig', async (req) => {
  try {
    return await setProjectConfig(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('dashboardAggregate', async (req) => {
  try {
    return await dashboardAggregate(req.context);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('listCanvasTokens', async () => {
  try {
    return await listCanvasTokens();
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('revokeCanvasToken', async (req) => {
  try {
    return await revokeCanvasToken(req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('autoUpdateFieldMappings', async (req) => {
  try {
    return await autoUpdateFieldMappings(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('epicPanelData', async (req) => {
  try {
    return await epicPanelData(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('issuePanelData', async (req) => {
  try {
    return await issuePanelData(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

export const handler = resolver.getDefinitions();
