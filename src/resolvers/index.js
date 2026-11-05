import Resolver from '@forge/resolver';
import { getInstallationConfig, mutateInstallationConfig } from '../lib/config.js';
import { requireAdmin } from '../lib/access.js';
import { generateCanvasToken, generateGuestToken, generateUserToken, createExtensionLogin, listCanvasTokens, revokeCanvasToken, createCanvas, deleteCanvas, archiveCanvas, listTextFields, getCanvasConfig, setCanvasConfig, renameCanvas, listAvailableTextFields, assignCanvasFolder, clearCanvasPreview, registryHealth, repairCanvasIndex, deleteStrayCanvasRecord } from './actions/admin.js';
import { getProjectConfig, setProjectConfig, getProjectStatuses } from './actions/config.js';
import { listGuestInvites, setGuestInviteActive, revokeGuestInvite, revokeGuestInvites, regenerateGuestInvite } from './actions/invites.js';
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

// Flow 1 (D46): mint the one-time code the extension trades for a credential.
resolver.define('createExtensionLogin', async (req) => {
  try {
    return await createExtensionLogin(req.context);
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
      if (payload.chromeStoreUrl !== undefined || payload.firefoxXpiUrl !== undefined) {
        const cleanUrl = (value) => {
          if (typeof value !== 'string') return '';
          const trimmed = value.trim();
          return /^https:\/\/[^\s]+$/i.test(trimmed) ? trimmed.slice(0, 500) : '';
        };
        if (payload.chromeStoreUrl !== undefined) draft.chromeStoreUrl = cleanUrl(payload.chromeStoreUrl);
        if (payload.firefoxXpiUrl !== undefined) draft.firefoxXpiUrl = cleanUrl(payload.firefoxXpiUrl);
      }
      if (payload.textFields !== undefined) {
        // The installation-level catalogue a canvas may pre-fill (D41/D42).
        const seen = new Set();
        draft.textFields = (Array.isArray(payload.textFields) ? payload.textFields : [])
          .map((field) => ({
            id: field && typeof field.id === 'string' ? field.id.trim() : '',
            name: field && typeof field.name === 'string' ? field.name.trim().slice(0, 120) : '',
          }))
          .filter((field) => field.id && field.name && !seen.has(field.id) && seen.add(field.id));
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

resolver.define('getProjectStatuses', async (req) => {
  try {
    return await getProjectStatuses(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('listTextFields', async (req) => {
  try {
    return await listTextFields(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('getCanvasConfig', async (req) => {
  try {
    return await getCanvasConfig(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('setCanvasConfig', async (req) => {
  try {
    return await setCanvasConfig(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('renameCanvas', async (req) => {
  try {
    return await renameCanvas(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('listAvailableTextFields', async (req) => {
  try {
    return await listAvailableTextFields(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('clearCanvasPreview', async (req) => {
  try {
    return await clearCanvasPreview(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('assignCanvasFolder', async (req) => {
  try {
    return await assignCanvasFolder(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('dashboardAggregate', async (req) => {
  try {
    return await dashboardAggregate(req.context, req.payload);
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


resolver.define('listGuestInvites', async (req) => {
  try {
    return await listGuestInvites(req.context);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('setGuestInviteActive', async (req) => {
  try {
    return await setGuestInviteActive(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('revokeGuestInvite', async (req) => {
  try {
    return await revokeGuestInvite(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

// Person-level revoke (D47): every invitation for this reviewer's binding.
resolver.define('revokeGuestInvites', async (req) => {
  try {
    return await revokeGuestInvites(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('regenerateGuestInvite', async (req) => {
  try {
    return await regenerateGuestInvite(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('registryHealth', async (req) => {
  try {
    return await registryHealth(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('repairCanvasIndex', async (req) => {
  try {
    return await repairCanvasIndex(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

resolver.define('deleteStrayCanvasRecord', async (req) => {
  try {
    return await deleteStrayCanvasRecord(req.context, req.payload);
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: e && e.message ? e.message : String(e) } };
  }
});

export const handler = resolver.getDefinitions();
