import { invoke } from '@forge/bridge';
import { buildBookmarklet } from '../../shared/bookmarklet.js';

export { buildBookmarklet };

export function aggregate() {
  return invoke('dashboardAggregate');
}

export function generateToken(canvasName, scope) {
  return invoke('generateCanvasToken', { canvasName, scope });
}

export function generateUserToken() {
  return invoke('generateUserToken');
}

export function generateGuestToken(permittedCanvases) {
  return invoke('generateGuestToken', { permittedCanvases });
}

export function createCanvas(canvasName, targetUrl) {
  return invoke('createCanvas', { canvasName, targetUrl });
}

export function deleteCanvas(canvasName) {
  return invoke('deleteCanvas', { canvasName });
}

export function archiveCanvas(canvasName) {
  return invoke('archiveCanvas', { canvasName });
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(typeof value === 'number' ? value : String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export function buildJqlUrl(jiraBaseUrl, canvasName, projectKeys) {
  if (!jiraBaseUrl) return null;
  const keys = Array.isArray(projectKeys)
    ? projectKeys.filter((key) => typeof key === 'string' && key.length > 0)
    : [];
  let jql = 'labels = "jiratack"';
  if (keys.length > 0) {
    jql += ` AND project in (${keys.map((key) => `"${key.replace(/"/g, '\\"')}"`).join(', ')})`;
  }
  return `${String(jiraBaseUrl).replace(/\/$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}
