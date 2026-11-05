import { invoke } from '@forge/bridge';
import { buildBookmarklet } from '../../shared/bookmarklet.js';

export { buildBookmarklet };

export function aggregate() {
  return invoke('dashboardAggregate');
}

export function generateUserToken(permittedCanvases) {
  return invoke('generateUserToken', permittedCanvases ? { permittedCanvases } : {});
}

// Flow 1 (D46): mint the one-time code the extension trades for a credential.
export function createExtensionLogin() {
  return invoke('createExtensionLogin');
}

export function generateGuestToken({ permittedCanvases, guestName, guestEmail }) {
  return invoke('generateGuestToken', { permittedCanvases, guestName, guestEmail });
}

export function createCanvas(canvasName, targetUrl, prefillFields) {
  return invoke('createCanvas', {
    canvasName,
    targetUrl,
    prefillFields: prefillFields || [],
  });
}

export function deleteCanvas(canvas) {
  return invoke('deleteCanvas', {
    canvasKey: canvas && canvas.canvasKey,
    canvasName: canvas && canvas.canvasName,
  });
}

export function archiveCanvas(canvas) {
  return invoke('archiveCanvas', {
    canvasKey: canvas && canvas.canvasKey,
    canvasName: canvas && canvas.canvasName,
  });
}

export function renameCanvas(canvasKey, canvasName) {
  return invoke('renameCanvas', { canvasKey, canvasName });
}

export function getCanvasConfig(canvasKey) {
  return invoke('getCanvasConfig', { canvasKey });
}

export function setCanvasConfig(canvasKey, prefillFields) {
  return invoke('setCanvasConfig', { canvasKey, prefillFields: prefillFields || [] });
}

export function assignCanvasFolder(canvasKey, folder) {
  return invoke('assignCanvasFolder', { canvasKey, folder });
}

export function clearCanvasPreview(canvasKey) {
  return invoke('clearCanvasPreview', { canvasKey });
}

export function listAvailableTextFields() {
  return invoke('listAvailableTextFields');
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(typeof value === 'number' ? value : String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export function buildJqlUrl(jiraBaseUrl, canvasName) {
  if (!jiraBaseUrl || !canvasName) return null;
  const escaped = String(canvasName).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  // `jiratackCanvas` is the search alias for com.jiratack.metadata.pin.canvas,
  // registered via the jira:entityProperty module.
  const jql = `jiratackCanvas = "${escaped}"`;
  return `${String(jiraBaseUrl).replace(/\/$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}
