import { getInstallationConfig } from '../lib/config.js';
import { resolveWebtriggerUrls } from '../lib/webtriggerUrls.js';
import { SDK_VERSION } from '../lib/version.js';
import { buildBookmarklet } from '../shared/bookmarklet.js';

const HTML_HEADERS = { 'Content-Type': ['text/html; charset=utf-8'], 'Cache-Control': ['no-store'] };

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f4f5f7; color: #172b4d; }
  main { width: min(560px, 90vw); background: #fff; border-radius: 12px; padding: 32px;
    box-shadow: 0 8px 28px rgba(9, 30, 66, .18); }
  h1 { margin: 0 0 8px; font-size: 22px; }
  p { line-height: 1.5; margin: 0 0 16px; }
  .muted { color: #5e6c84; font-size: 14px; }
  .bookmarklet { display: inline-block; margin: 8px 0 20px; padding: 12px 20px; border-radius: 6px;
    background: #0052cc; color: #fff; font-weight: 700; text-decoration: none; cursor: grab; }
  .bookmarklet:active { cursor: grabbing; }
  ol { margin: 0 0 16px; padding-left: 20px; line-height: 1.6; }
  .error { color: #bf2600; font-weight: 600; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

function errorPage(title, message) {
  return page(title, `<h1>${escapeHtml(title)}</h1>
<p class="error">${escapeHtml(message)}</p>`);
}

export const handler = async (req) => {
  if (req && req.method && req.method.toUpperCase() !== 'GET') {
    return {
      statusCode: 405,
      headers: { ...HTML_HEADERS, Allow: ['GET'] },
      body: errorPage('Method not allowed', 'This installer link only supports GET requests.'),
    };
  }

  const query = (req && req.queryParameters) || {};
  const rawToken = query.token;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  if (typeof token !== 'string' || token.length === 0) {
    return {
      statusCode: 400,
      headers: HTML_HEADERS,
      body: errorPage('Missing token', 'This installer link is incomplete. Ask the person who sent it for a new link.'),
    };
  }

  let config;
  let apiUrl;
  let sdkUrl;
  try {
    config = await getInstallationConfig();
    ({ apiUrl, sdkUrl } = await resolveWebtriggerUrls(config));
  } catch (e) {
    apiUrl = null;
    sdkUrl = null;
  }

  if (!apiUrl || !sdkUrl) {
    return {
      statusCode: 500,
      headers: HTML_HEADERS,
      body: errorPage('JiraTack is not ready', 'The app has not finished deploying. Try again shortly.'),
    };
  }

  const bookmarklet = buildBookmarklet({
    token,
    apiUrl,
    sdkUrl,
    sdkVersion: SDK_VERSION,
    canvasId: 'guest',
    canvasName: 'Guest canvases',
  });

  return {
    statusCode: 200,
    headers: HTML_HEADERS,
    body: page('Install JiraTack', `<h1>JiraTack guest review</h1>
<p>Install this bookmark to review approved canvases and create tickets for the JiraTack team.</p>
<a class="bookmarklet" href="${escapeHtml(bookmarklet)}" draggable="true" title="Drag to your bookmarks bar">📌 JiraTack</a>
<ol>
  <li>Drag the button above to your bookmarks bar.</li>
  <li>Open the page you want to review.</li>
  <li>Click the JiraTack bookmark on that page.</li>
</ol>
<p class="muted">This link is personal and long-lived. Do not forward it. If it stops working, ask the person who sent it for a new one.</p>`),
  };
};
