import crypto from 'crypto';
import { kvsGet, kvsSet } from './kvs.js';

const KEY = 'installationConfig';

const DEFAULT_CONFIG = {
  fieldRegistry: {},
  viewPermissionMode: 'per_user_projects',
  projects: {},
  configVersion: '',
  updatedAt: 0,
  schemaVersion: 1,
};

export async function getInstallationConfig() {
  try {
    const existing = await kvsGet(KEY);
    if (!existing) {
      return { ...DEFAULT_CONFIG, updatedAt: Date.now() };
    }
    return { ...DEFAULT_CONFIG, ...existing };
  } catch (e) {
    return { ...DEFAULT_CONFIG, updatedAt: Date.now() };
  }
}

function computeConfigVersion(config) {
  const canonical = JSON.stringify({
    projects: config.projects || {},
    fieldRegistry: config.fieldRegistry || {},
    viewPermissionMode: config.viewPermissionMode,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export async function setInstallationConfig(config) {
  const next = { ...DEFAULT_CONFIG, ...config };
  next.configVersion = computeConfigVersion(next);
  next.updatedAt = Date.now();
  if (!next.schemaVersion) next.schemaVersion = 1;
  await kvsSet(KEY, next);
  return next;
}
