import { kvsGet } from '../lib/kvs.js';
import { getInstallationConfig } from '../lib/config.js';
import { resolveWebtriggerUrls } from '../lib/webtriggerUrls.js';
import { SDK_VERSION } from '../lib/version.js';
import { buildBookmarklet } from '../shared/bookmarklet.js';
import { buildCompositeToken } from '../lib/tokenParser.js';
import { pairingService } from '../lib/credentials.js';
import { parentRefOf, pairingIdFor, MAX_PAIRINGS, remainingPairings, INSTALL_ID_RE } from '../lib/credentialsModel.js';
import { linkExpiresAt, invitationState } from '../lib/inviteModel.js';

/**
 * Guest installer.
 *
 * Two-phase GET, because installId lives in the visitor's localStorage and the
 * server cannot see it on the first request:
 *   phase 1 (no installId param)  → minimal shell that attaches installId
 *   phase 2 (installId present)   → resolve state, render the page
 *
 * LOAD-BEARING: phase 1 relies on an inline script. Do not add a
 * Content-Security-Policy that blocks inline script without moving the phase-1
 * redirect to a served resource.
 *
 * Honest framing (D24): the pairing cap is farmable (clear localStorage → new
 * pairing), a shared bookmarklet is one pairing, installId is fragile in
 * Safari/incognito/IT-managed browsers, and the no-JS fallback shares the null
 * pairing. Pairing creation is unauthenticated; A-18 rate limiting is the
 * mitigation and is out of scope for this slice.
 */

const APP_ID = '47873476-1bf1-4291-9178-a65ef01abd46';
const INSTALL_ID_KEY = `jiratack:installId:${APP_ID}`;
const PHASE_FLAG = 'jiratack:phase1At';

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
  .card { border: 1px solid #dfe1e6; border-radius: 10px; padding: 16px; margin-bottom: 14px; }
  .card h2 { margin: 0 0 6px; font-size: 15px; }
  .card p { margin: 0 0 10px; font-size: 13px; color: #42526e; }
  .card.disabled { background: #f4f5f7; color: #6b778c; }
  .card.disabled h2 { color: #6b778c; }
  .bookmarklet { display: inline-block; margin: 4px 0 8px; padding: 12px 20px; border-radius: 6px;
    background: #0052cc; color: #fff; font-weight: 700; text-decoration: none; cursor: grab; }
  .bookmarklet:active { cursor: grabbing; }
  .capacity { font-size: 12px; color: #5e6c84; border-top: 1px solid #dfe1e6; padding-top: 14px; }
  .error { color: #bf2600; font-weight: 600; }
  ol { margin: 0 0 8px; padding-left: 20px; line-height: 1.6; font-size: 13px; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

function statePage(title, heading, message) {
  return page(title, `<h1>${escapeHtml(heading)}</h1>
<p class="muted">${escapeHtml(message)}</p>`);
}

function notFound() {
  return {
    statusCode: 404,
    headers: HTML_HEADERS,
    body: statePage(
      'Link not valid',
      "This link isn't valid",
      'Ask the person who sent you this link for a new one.',
    ),
  };
}

function unavailable() {
  return {
    statusCode: 500,
    headers: HTML_HEADERS,
    body: statePage('JiraTack is not ready', 'JiraTack is not ready', 'The app has not finished deploying. Try again shortly.'),
  };
}

function bookmarkletFor(token, urls) {
  return buildBookmarklet({
    token,
    apiUrl: urls.apiUrl,
    sdkUrl: urls.sdkUrl,
    sdkVersion: SDK_VERSION,
    canvasId: 'guest',
    canvasName: 'Guest canvases',
  });
}

function phaseOne(token, urls) {
  const legacyHref = bookmarkletFor(buildCompositeToken(token, ''), urls);

  const body = `<h1>Get JiraTack</h1>
<p class="muted">Loading…</p>
<noscript>
  <p>JavaScript is disabled, so this page cannot register this browser. You can still install the bookmarklet:</p>
  <p><a class="bookmarklet" href="${escapeHtml(legacyHref)}" draggable="true">📌 Drop JiraTack here</a></p>
  <p class="muted"><a href="?token=${encodeURIComponent(token)}&installId=">Continue without JavaScript</a></p>
</noscript>
<script>
(function () {
  var token = ${JSON.stringify(token)};
  try {
    var last = Number(sessionStorage['${PHASE_FLAG}'] || 0);
    var recent = Date.now() - last < 5000;
    sessionStorage['${PHASE_FLAG}'] = String(Date.now());

    var id = '';
    try {
      id = localStorage['${INSTALL_ID_KEY}'] || '';
      if (!/${INSTALL_ID_RE.source}/.test(id)) {
        var bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        id = Array.from(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
        localStorage['${INSTALL_ID_KEY}'] = id;
      }
    } catch (e) {
      id = '';
    }

    location.replace('?token=' + encodeURIComponent(token) + '&installId=' + encodeURIComponent(recent ? '' : id));
  } catch (e) {
    location.replace('?token=' + encodeURIComponent(token) + '&installId=');
  }
})();
</script>`;

  return { statusCode: 200, headers: HTML_HEADERS, body: page('Get JiraTack', body) };
}

function validPage(token, installId, remaining, urls, invite) {
  const href = bookmarkletFor(buildCompositeToken(token, installId), urls);

  const guestName = invite && invite.guestName;
  const sponsor = invite && (invite.issuedByName || invite.issuer);
  const sponsorContact = invite && invite.issuerEmail ? ` (${escapeHtml(invite.issuerEmail)})` : '';
  const invitedParts = [];
  if (guestName) {
    const address = invite && invite.guestEmail ? ` (${escapeHtml(invite.guestEmail)})` : '';
    invitedParts.push(`You are invited as <strong>${escapeHtml(guestName)}</strong>${address}.`);
  } else if (invite && invite.guestEmail) {
    invitedParts.push(`You are invited as <strong>${escapeHtml(invite.guestEmail)}</strong>.`);
  }
  if (sponsor) invitedParts.push(`Invited by ${escapeHtml(sponsor)}${sponsorContact}.`);
  const invited = invitedParts.length > 0 ? `<p class="muted">${invitedParts.join(' ')}</p>` : '';
  const body = `<h1>Get JiraTack</h1>${invited}
<div class="card disabled">
  <h2>🔌 Install the extension <span class="muted">(recommended)</span></h2>
  <p>Works on Chrome and Edge today; other browsers to follow.</p>
  <p><strong>Coming soon — use the bookmarklet for now.</strong></p>
</div>
<div class="card">
  <h2>🔖 Use the bookmarklet <span class="muted">(works on any browser)</span></h2>
  <p>Nothing to install. Drag this to your bookmarks bar:</p>
  <p><a class="bookmarklet" href="${escapeHtml(href)}" draggable="true" title="Drag to your bookmarks bar">📌 JiraTack</a></p>
  <ol>
    <li>Drag the button above to your bookmarks bar.</li>
    <li>Open the page you want to review.</li>
    <li>Click the JiraTack bookmark on that page.</li>
  </ol>
</div>
<p class="capacity">Reviewer capacity for this invite: ${remaining} of ${MAX_PAIRINGS} devices remaining.</p>`;

  return { statusCode: 200, headers: HTML_HEADERS, body: page('Get JiraTack', body) };
}

export const handler = async (req) => {
  const query = (req && req.queryParameters) || {};
  const rawToken = query.token;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  if (typeof token !== 'string' || token.length === 0) return notFound();

  let urls;
  try {
    const config = await getInstallationConfig();
    urls = await resolveWebtriggerUrls(config);
  } catch (e) {
    return unavailable();
  }
  if (!urls.apiUrl || !urls.sdkUrl) return unavailable();

  const hasInstallId = Object.prototype.hasOwnProperty.call(query, 'installId');
  if (!hasInstallId) return phaseOne(token, urls);

  const rawInstall = query.installId;
  const supplied = Array.isArray(rawInstall) ? rawInstall[0] : rawInstall;
  // Malformed installId falls back to the legacy pairing, never to an error page.
  const installId = typeof supplied === 'string' && INSTALL_ID_RE.test(supplied) ? supplied : '';

  const invite = await kvsGet(`canvasTokens:${token}`);
  if (!invite) return notFound();

  if (invite.revoked) {
    return {
      statusCode: 200,
      headers: HTML_HEADERS,
      body: statePage(
        'Invite inactive',
        'This invite is no longer active',
        'Ask the person who sent you this link for a new one.',
      ),
    };
  }

  const now = Date.now();
  if (invitationState(invite) === 'inactive') {
    return {
      statusCode: 200,
      headers: HTML_HEADERS,
      body: statePage(
        'Invite paused',
        'This invitation is paused',
        'Ask the person who sent you this link to reactivate it.',
      ),
    };
  }

  const expiry = linkExpiresAt(invite);
  if (expiry && expiry < now) {
    const window = invite.mintedAfterCutover ? ' after 72 hours' : '';
    return {
      statusCode: 200,
      headers: HTML_HEADERS,
      body: statePage(
        'Invite expired',
        'This invite has expired',
        `Invites expire${window}. Ask the person who sent you this link for a new one.`,
      ),
    };
  }

  const ref = parentRefOf(token);
  const used = await pairingService.countPairingsForInvite(ref);
  const existing = await pairingService.getPairing(pairingIdFor(token, installId));

  if (used >= MAX_PAIRINGS && !existing) {
    return {
      statusCode: 200,
      headers: HTML_HEADERS,
      body: statePage(
        'Invite at capacity',
        `This invite has been installed on ${MAX_PAIRINGS} devices`,
        'Ask the person who sent you this link for a new one.',
      ),
    };
  }

  return validPage(token, installId, remainingPairings(used), urls, invite);
};
