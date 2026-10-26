import { invoke } from '@forge/bridge';

export function aggregate() {
  return invoke('dashboardAggregate');
}

export function listTokens() {
  return invoke('listCanvasTokens');
}

export function revokeToken(token) {
  return invoke('revokeCanvasToken', { token });
}

export function generateToken(canvasName, scope) {
  return invoke('generateCanvasToken', { canvasName, scope });
}

export function recoverPins(dryRun) {
  return invoke('recoverPinsFromDescriptions', { dryRun });
}

export function buildBookmarklet(data) {
  const canvasName = data.canvasName || data.canvasId || 'Canvas';
  const canvasId = data.canvasId || canvasName;
  const config = {
    token: data.token,
    apiUrl: data.apiUrl,
    sdkUrl: data.sdkUrl,
    canvasId,
    canvasName,
    sdkVersion: data.sdkVersion,
  };
  const code = `(function(){var c=${JSON.stringify(config)};if(window.__jiratackActiveCanvas===c.canvasId){window.__jiratackClose();return;}var s=document.createElement('script');s.src=c.sdkUrl+'?v='+c.sdkVersion;s.onload=function(){window.__jiratackInit(c);};document.head.appendChild(s);})();`;
  return `javascript:${code}`;
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(typeof value === 'number' ? value : String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export function buildJqlUrl(jiraBaseUrl, canvasFieldId, canvasName) {
  if (!jiraBaseUrl) return null;
  const jql = `"${canvasFieldId}" = "${canvasName}"`;
  return `${String(jiraBaseUrl).replace(/\/$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}
