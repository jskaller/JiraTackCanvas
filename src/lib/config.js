import crypto from 'crypto';
import { kvsGet, kvsSet } from './kvs.js';

const KEY = 'installationConfig';
const MUTATE_ATTEMPTS = 3;

const DEFAULT_CONFIG = {
  viewPermissionMode: 'per_user_projects',
  projects: {},
  archivedCanvases: [],
  deletedCanvases: [],
  // Extension publication URLs (D43). Empty until the listings exist.
  chromeStoreUrl: '',
  firefoxXpiUrl: '',
  configVersion: '',
  updatedAt: 0,
  schemaVersion: 1,
};

function computeConfigVersion(config) {
  const canonical = JSON.stringify({
    projects: config.projects || {},
    viewPermissionMode: config.viewPermissionMode,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * A KVS failure is deliberately distinguishable from "no config yet".
 * Returning defaults on a read error used to let the next write persist
 * defaults over the real configuration.
 */
export async function getInstallationConfig() {
  let existing;
  try {
    existing = await kvsGet(KEY);
  } catch (e) {    console.error('[JiraTack] Failed to read installation config:', e && e.message ? e.message : e);
    throw new Error('Installation config is unavailable.');
  }
  if (!existing) {
    return { ...DEFAULT_CONFIG, updatedAt: Date.now() };
  }
  return { ...DEFAULT_CONFIG, ...existing };
}

export async function setInstallationConfig(config) {
  const next = { ...DEFAULT_CONFIG, ...config };
  next.configVersion = computeConfigVersion(next);
  next.updatedAt = Date.now();
  if (!next.schemaVersion) next.schemaVersion = 1;
  await kvsSet(KEY, next);
  return next;
}

function cloneForMutation(config) {
  return {
    ...config,
    projects: { ...(config.projects || {}) },
    archivedCanvases: Array.isArray(config.archivedCanvases) ? [...config.archivedCanvases] : [],
    deletedCanvases: Array.isArray(config.deletedCanvases) ? [...config.deletedCanvases] : [],
  };
}

/**
 * Read the config and write the mutation back in one narrow window instead of
 * round-tripping a whole blob through the client. This shrinks the
 * read-modify-write race to milliseconds; true compare-and-set (KVS versions)
 * is tracked as follow-up work in the security review.
 */
export async function mutateInstallationConfig(mutator, attempts) {
  const max = typeof attempts === 'number' && attempts > 0 ? attempts : MUTATE_ATTEMPTS;
  let lastError = null;

  for (let attempt = 0; attempt < max; attempt += 1) {
    const current = await getInstallationConfig();
    const draft = cloneForMutation(current);
    const proposed = await mutator(draft);
    try {
      return await setInstallationConfig(proposed);
    } catch (e) {
      lastError = e;
      console.error('[JiraTack] Config write failed, retrying:', attempt + 1, e && e.message ? e.message : e);
    }
  }

  throw lastError || new Error('Failed to update installation config.');
}
