import Resolver from '@forge/resolver';
import { getInstallationConfig, mutateInstallationConfig } from '../lib/config.js';
import { requireAdmin } from '../lib/access.js';
import { generateCanvasToken, generateGuestToken, generateUserToken, listCanvasTokens, revokeCanvasToken, createCanvas, deleteCanvas, archiveCanvas } from './actions/admin.js';
import { getProjectConfig, setProjectConfig } from './actions/config.js';
import { dashboardAggregate } from './actions/dashboard.js';
import { epicPanelData } from './actions/epic.js';
import { issuePanelData } from './actions/issue.js';

const resolver = new Resolver();

resolver.define('generateCanvasToken', async (req) => {
  try {
    return await generateCanvasToken(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('generateGuestToken', async (req) => {
  try {
    return await generateGuestToken(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('generateUserToken', async (req) => {
  try {
    return await generateUserToken(req.context);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('createCanvas', async (req) => {
  try {
    return await createCanvas(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('deleteCanvas', async (req) => {
  try {
    return await deleteCanvas(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('archiveCanvas', async (req) => {
  try {
    return await archiveCanvas(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('getInstallationConfig', async (req) => {
  try {
    const denied = await requireAdmin(req.context);
    if (denied) return denied;
    const config = await getInstallationConfig();
    return { ok: true, data: config };
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('setInstallationConfig', async (req) => {
  try {
    const denied = await requireAdmin(req.context);
    if (denied) return denied;
    const updated = await mutateInstallationConfig((draft) => {
      const payload = req.payload || {};
      Object.assign(draft, payload);
      if (payload.projects) {
        draft.projects = { ...(draft.projects || {}), ...payload.projects };
      }
      return draft;
    });
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

resolver.define('listCanvasTokens', async (req) => {
  try {
    return await listCanvasTokens(req.context);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('revokeCanvasToken', async (req) => {
  try {
    return await revokeCanvasToken(req.context, req.payload);
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
