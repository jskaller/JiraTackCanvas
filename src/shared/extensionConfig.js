/**
 * Parses the configuration an extension needs out of a bookmarklet URL.
 *
 * The installer and the dashboard already produce a `javascript:` URL carrying
 * `{ token, apiUrl, sdkUrl, canvasId, canvasName, sdkVersion }`. Rather than
 * invent a second enrolment flow for the extension, the options page accepts
 * that URL and extracts the same object. One config shape, one place it comes
 * from (CONTRACTS §5.1).
 */
const ALLOWED = ['token', 'apiUrl', 'sdkUrl', 'canvasId', 'canvasName', 'sdkVersion'];

export function parseBookmarkletConfig(text) {
  const raw = String(text || '').trim().replace(/^javascript:/i, '');
  if (!raw) return null;

  let candidate = null;
  const embedded = raw.match(/var c=(\{[\s\S]*?\});if\(window\./);
  if (embedded) {
    try {
      candidate = JSON.parse(embedded[1]);
    } catch (e) {
      return null;
    }
  } else {
    try {
      candidate = JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  if (!candidate || typeof candidate !== 'object') return null;

  const config = {};
  for (const key of ALLOWED) {
    if (typeof candidate[key] === 'string') config[key] = candidate[key];
  }

  if (!config.token) return null;
  if (!config.apiUrl || !/^https:\/\//i.test(config.apiUrl)) return null;

  return {
    token: config.token,
    apiUrl: config.apiUrl,
    sdkUrl: config.sdkUrl || '',
    canvasId: config.canvasId || 'universal',
    canvasName: config.canvasName || 'Canvas',
    sdkVersion: config.sdkVersion || '',
  };
}

export function describeConfig(config) {
  if (!config || !config.token) return 'Not configured.';
  const token = String(config.token);
  const shown = token.length > 6 ? `${token.slice(0, 6)}\u2026` : token;
  return `Configured for ${config.canvasName || 'Canvas'} \u00b7 token ${shown} \u00b7 ${config.apiUrl}`;
}
