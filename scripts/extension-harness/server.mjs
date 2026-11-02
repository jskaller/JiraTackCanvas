import http from 'node:http';

/**
 * Fixture pages and a stub API for the extension harness.
 *
 * The pages exist because the interesting failures are CSP-shaped: a page with
 * a nonce and no 'unsafe-inline' is exactly where a bookmarklet dies and the
 * extension must still work. The stub answers the SDK's web-trigger calls so a
 * test needs no real token and no Jira.
 */

const PAGE = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body>
  <h1>${title}</h1>
  <div id="target" class="card" style="padding:24px;border:1px solid #ccc">
    <p id="copy">Original headline text for the text-edit fixture.</p>
  </div>
  <button id="action">Do the thing</button>
  <script nonce="abc" src="/page.js"></script>
</body></html>`;

const PAGE_JS = `
document.getElementById('action').addEventListener('click', function () {
  console.log('fixture-action-clicked');
});
console.log('fixture-page-loaded');
`;

function pageServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/page.js') {
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Content-Security-Policy': "script-src 'self' 'nonce-abc'",
      });
      res.end(PAGE_JS);
      return;
    }

    if (url.pathname === '/strict') {
      // nonce, no 'unsafe-inline', no 'unsafe-eval' — the bookmarklet-dead shape
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "script-src 'self' 'nonce-abc'; object-src 'none'",
      });
      res.end(PAGE('Strict CSP fixture', ''));
      return;
    }

    if (url.pathname === '/inline') {
      // montefiore shape: inline allowed, no nonce, no default-src
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "script-src 'self' 'nonce-abc' 'unsafe-inline'",
      });
      res.end(PAGE('Inline-allowed fixture', ''));
      return;
    }

    if (url.pathname === '/plain') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAGE('Plain fixture', ''));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
}

function apiServer(state) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  return http.createServer((req, res) => {
    // The SDK fetches from a page origin, so Content-Type: application/json
    // triggers a preflight. Answer it or the exchange never leaves the browser.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch (e) {
        res.writeHead(400, cors).end('{}');
        return;
      }
      const action = body.action;
      state.calls.push(action);

      const send = (payload) => {
        res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
        res.end(JSON.stringify(payload));
      };

      if (action === 'exchangeToken') {
        send({
          ok: true,
          data: {
            sessionJwt: 'fixture.jwt',
            expiresAt: Date.now() + 3600000,
            canvasId: 'universal',
            canvasName: 'Fixture canvas',
            scope: 'create',
            permittedProjects: [],
            isAdmin: true,
            displayName: 'Fixture user',
            apiUrl: state.apiUrl,
            sdkUrl: state.sdkUrl,
            installUrl: null,
            currentSdkVersion: state.sdkVersion,
            jiraBaseUrl: 'https://example.atlassian.net',
            configVersion: 1,
          },
        });
        return;
      }

      if (action === 'getPinsForCanvasAndUrl') {
        send({
          ok: true,
          data: {
            pins: state.pins,
            canvasName: 'Fixture canvas',
            configVersion: 1,
            truncated: false,
          },
        });
        return;
      }

      if (action === 'getIssueTypes') {
        send({ ok: true, data: { issueTypes: [{ id: '10001', name: 'Task' }], projects: [{ key: 'TEST', name: 'Test' }] } });
        return;
      }

      if (action === 'createIssue') {
        send({ ok: true, data: { key: 'TEST-1', url: 'https://example.atlassian.net/browse/TEST-1' } });
        return;
      }

      send({ ok: true, data: {} });
    });
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

export async function startServers({ sdkVersion, sdkUrl }) {
  const state = { calls: [], pins: [], sdkVersion, sdkUrl: sdkUrl || null, apiUrl: null };

  const api = apiServer(state);
  state.apiUrl = await listen(api);

  const pages = pageServer();
  const pagesUrl = await listen(pages);

  return {
    pagesUrl,
    apiUrl: state.apiUrl,
    state,
    close: () => {
      api.close();
      pages.close();
    },
  };
}
