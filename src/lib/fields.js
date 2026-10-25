import api, { route } from '@forge/api';
import { getInstallationConfig, setInstallationConfig } from './config.js';

const TEXTFIELD_TYPE = 'com.atlassian.jira.plugin.system.customfieldtypes:textfield';
const TEXT_SEARCHER = 'com.atlassian.jira.plugin.system.customfieldtypes:textsearcher';
const URL_TYPE = 'com.atlassian.jira.plugin.system.customfieldtypes:url';
const URL_SEARCHER = 'com.atlassian.jira.plugin.system.customfieldtypes:urlsearcher';

const FIELD_DEFS = [
  { key: 'canvasField', name: 'JiraTack Canvas', type: TEXTFIELD_TYPE, searcherKey: TEXT_SEARCHER },
  { key: 'urlField', name: 'Page URL', type: URL_TYPE, searcherKey: URL_SEARCHER },
  { key: 'pinField', name: 'Pin Position', type: TEXTFIELD_TYPE, searcherKey: TEXT_SEARCHER },
  { key: 'selectorField', name: 'Pinned Selector', type: TEXTFIELD_TYPE, searcherKey: TEXT_SEARCHER },
];

function toMessage(e) {
  if (e === null || e === undefined) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (e.message) return String(e.message);
  return String(e);
}

async function createField(name, type, searcherKey) {
  console.log('[JiraTack] Provisioning field:', name);
  const res = await api.asUser().requestJira(route`/rest/api/3/field`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description: 'JiraTack',
      type,
      searcherKey,
    }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const errJson = await res.json();
      detail = JSON.stringify(errJson).slice(0, 300);
    } catch (ignored) {
      detail = `HTTP ${res.status}`;
    }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return res.json();
}

async function addToDefaultScreen(fieldId, warnings) {
  try {
    const screensRes = await api.asUser().requestJira(route`/rest/api/3/screens?maxResults=100`);
    const screensJson = await screensRes.json();
    const screens = screensJson.values || screensJson || [];
    const screen = screens.find((s) => /default/i.test(s.name || '')) || screens[0];
    if (!screen) return;
    const tabsRes = await api.asUser().requestJira(route`/rest/api/3/screens/${screen.id}/tabs`);
    const tabsJson = await tabsRes.json();
    const tabs = Array.isArray(tabsJson) ? tabsJson : (tabsJson.values || []);
    const tab = tabs[0];
    if (!tab) return;
    await api.asUser().requestJira(route`/rest/api/3/screens/${screen.id}/tabs/${tab.id}/fields`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fieldId }),
    });
  } catch (e) {
    console.error('[JiraTack] Screen manipulation failed:', e);
    warnings.push(`Screen manipulation failed for ${fieldId}: ${toMessage(e)}. Fix: /secure/admin/ConfigureFieldScreen.jspa`);
  }
}

export async function provisionFields(context) {
  const warnings = [];
  const fieldIds = { canvasField: null, urlField: null, pinField: null, selectorField: null };

  let existing = [];
  try {
    console.log('[JiraTack] Listing existing fields');
    const listRes = await api.asUser().requestJira(route`/rest/api/3/field`);
    existing = (await listRes.json()) || [];
  } catch (e) {
    console.error('[JiraTack] Field listing failed:', e);
    warnings.push(`Failed to list fields: ${toMessage(e)}`);
  }

  for (const def of FIELD_DEFS) {
    const match = existing.find((f) => f.name === def.name);
    if (match) {
      fieldIds[def.key] = match.id;
    } else {
      try {
        const created = await createField(def.name, def.type, def.searcherKey);
        fieldIds[def.key] = created.id;
      } catch (e) {
        console.error('[JiraTack] Field creation failed:', e);
        if (def.key === 'urlField') {
          try {
            const created = await createField(def.name, TEXTFIELD_TYPE, TEXT_SEARCHER);
            fieldIds[def.key] = created.id;
            warnings.push(`URL field type unavailable; fell back to textfield for ${def.name}.`);
          } catch (fallbackErr) {
            console.error('[JiraTack] Field creation failed:', fallbackErr);
            warnings.push(`Failed to create field ${def.name}: ${toMessage(fallbackErr)}`);
          }
        } else {
          warnings.push(`Failed to create field ${def.name}: ${toMessage(e)}`);
        }
      }
    }
  }

  for (const def of FIELD_DEFS) {
    if (fieldIds[def.key]) {
      await addToDefaultScreen(fieldIds[def.key], warnings);
    }
  }

  try {
    const config = await getInstallationConfig();
    config.fieldRegistry = { ...fieldIds };
    await setInstallationConfig(config);
  } catch (e) {
    warnings.push(`Failed to persist fieldRegistry: ${toMessage(e)}`);
  }

  return { ok: true, fieldIds, warnings };
}
