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

export function createCanvas(canvasName, targetUrl) {
  return invoke('createCanvas', { canvasName, targetUrl });
}

export function deleteCanvas(canvasName) {
  return invoke('deleteCanvas', { canvasName });
}

export function archiveCanvas(canvasName) {
  return invoke('archiveCanvas', { canvasName });
}

export function recoverPins(dryRun) {
  return invoke('recoverPinsFromDescriptions', { dryRun });
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(typeof value === 'number' ? value : String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export function buildJqlUrl(jiraBaseUrl, canvasName) {
  if (!jiraBaseUrl) return null;
  const escapedCanvas = String(canvasName).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const jql = `labels = "jiratack" AND text ~ "${escapedCanvas}"`;
  return `${String(jiraBaseUrl).replace(/\/$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}
