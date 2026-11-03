import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { connect, version, newTarget, targets, waitFor } from './cdp.mjs';
import { startServers } from './server.mjs';

/**
 * Extension harness (plan phase 0).
 *
 * Loads the real unpacked extension into a real Chrome, serves fixture pages
 * with hostile CSP, and asserts the SDK runs *in the page's world* — the
 * property the whole channel depends on. No packages, no token, no Jira.
 *
 * A headless browser cannot click a toolbar icon to earn `activeTab`, so the
 * harness builds a temp copy with `<all_urls>` and drives the same injection the
 * background worker performs. The click itself is a manual check.
 */

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = new Set(process.argv.slice(2));
const headed = args.has('--headed');
const keep = args.has('--keep');

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

function readSdkVersion() {
  const source = fs.readFileSync('src/lib/version.js', 'utf8');
  const match = source.match(/SDK_VERSION\s*=\s*'([^']+)'/);
  if (!match) throw new Error('cannot read SDK_VERSION from src/lib/version.js');
  return match[1];
}

function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const stat = entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs;
    if (stat > newest) newest = stat;
  }
  return newest;
}

function prepareBuild() {
  if (!fs.existsSync('dist/extension-chrome/sdk.js')) {
    throw new Error('dist/extension-chrome missing — run `npm run build:extension` first');
  }
  // A stale bundle makes the harness pass on code nobody changed, or fail on
  // code nobody wrote. Refuse rather than measure the wrong build.
  const sourceTime = Math.max(newestMtime('src/bookmarklet'), newestMtime('src/extension'));
  const bundleTime = fs.statSync('dist/extension-chrome/sdk.js').mtimeMs;
  if (sourceTime > bundleTime) {
    throw new Error('extension/sdk.js is older than src/bookmarklet — run `npm run build && npm run build:extension`');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jiratack-ext-'));
  fs.cpSync('dist/extension-chrome', dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

async function launchChrome(profileDir) {
  const child = spawn(CHROME, [
    headed ? '--window-position=-3000,-3000' : '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const portFile = path.join(profileDir, 'DevToolsActivePort');
  const ready = await waitFor(() => (fs.existsSync(portFile) ? fs.readFileSync(portFile, 'utf8').trim() : null), { timeout: 20000 });
  if (!ready) throw new Error(`Chrome did not expose a debugging port\n${stderr.slice(-500)}`);

  const [port, wsPath] = ready.split('\n');
  return { child, port: Number(port), wsPath };
}

async function main() {
  const sdkVersion = readSdkVersion();
  const buildDir = prepareBuild();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jiratack-profile-'));
  let chrome;

  const servers = await startServers({ sdkVersion });
  try {
    chrome = await launchChrome(profileDir);
    const info = await version(chrome.port);
    const browser = await connect(info.webSocketDebuggerUrl);

    const loaded = await browser.send('Extensions.loadUnpacked', { path: buildDir });
    record('extension loads as unpacked', Boolean(loaded && loaded.id), loaded && loaded.id);

    const optionsTarget = await newTarget(chrome.port, `chrome-extension://${loaded.id}/options.html`);
    const ext = await connect(optionsTarget.webSocketDebuggerUrl);
    await ext.evaluate('1');

    const manifest = JSON.parse(await ext.evaluate('JSON.stringify(chrome.runtime.getManifest())'));
    record('extension context responds', manifest.name === 'JiraTack', manifest.name);

    const config = {
      token: 'fixture-token',
      apiUrl: servers.apiUrl,
      sdkUrl: 'unused-in-extension',
      canvasId: 'universal',
      canvasName: 'Fixture canvas',
      sdkVersion,
      // background.js sets this; the harness calls init directly, so mirror it
      channel: 'extension',
    };
    await ext.evaluate(`chrome.storage.local.set({ jiratackConfig: ${JSON.stringify(config)} })`);

    const stored = await ext.evaluate('chrome.storage.local.get(["jiratackConfig"]).then((r) => Boolean(r.jiratackConfig))');
    record('config persists', stored === true, String(stored));

    // 'universal' is launcher mode (lists canvases); a canvas id fetches pins.
    const fixtures = [
      { path: '/strict', canvasId: 'universal' },
      { path: '/plain', canvasId: 'fixture-canvas' },
    ];

    for (const fixture of fixtures) {
      const pageUrl = `${servers.pagesUrl}${fixture.path}`;
      const pageConfig = { ...config, canvasId: fixture.canvasId };
      const pageTarget = await newTarget(chrome.port, pageUrl);
      const page = await connect(pageTarget.webSocketDebuggerUrl);
      await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });

      await waitFor(async () => (await page.evaluate('document.readyState')) === 'complete');

      const tabId = await ext.evaluate(`(async () => {
        const tabs = await chrome.tabs.query({});
        const hit = tabs.find((t) => (t.url || '').startsWith(${JSON.stringify(pageUrl)}));
        return hit ? hit.id : null;
      })()`);

      if (tabId === null) {
        record(`${fixture}: tab located`, false, 'chrome.tabs.query returned nothing');
        page.close();
        continue;
      }

      // one pin that belongs on this page, so rendering and filters have data
      servers.state.pins = [{
        key: 'TEST-1',
        summary: 'Fixture pin',
        url: pageUrl,
        selector: '#target',
        pinPosition: '40.0,50.0',
        status: { name: 'To Do', category: 'new' },
      }];

      await ext.evaluate(`chrome.scripting.executeScript({
        target: { tabId: ${tabId} },
        world: 'MAIN',
        files: ['sdk.js'],
      })`);

      await ext.evaluate(`chrome.scripting.executeScript({
        target: { tabId: ${tabId} },
        world: 'MAIN',
        func: function (cfg) {
          if (typeof window.__jiratackInit !== 'function') return 'no-sdk';
          window.__jiratackInit(cfg);
          return 'called';
        },
        args: [${JSON.stringify(pageConfig)}],
      })`);

      const visible = await waitFor(async () => {
        const state = await page.evaluate(`JSON.stringify({
          init: typeof window.__jiratackInit,
          overlay: !!document.getElementById('jiratack-overlay'),
          sidebar: !!document.getElementById('jiratack-sidebar'),
          canvas: window.__jiratackActiveCanvas || null
        })`);
        const parsed = JSON.parse(state);
        return parsed.overlay && parsed.sidebar ? parsed : null;
      });

      const state = visible || JSON.parse(await page.evaluate(`JSON.stringify({
        init: typeof window.__jiratackInit,
        overlay: !!document.getElementById('jiratack-overlay'),
        sidebar: !!document.getElementById('jiratack-sidebar'),
        canvas: window.__jiratackActiveCanvas || null
      })`));

      record(`${fixture.path}: SDK defined in page world`, state.init === 'function', state.init);
      record(`${fixture.path}: overlay rendered`, state.overlay === true, String(state.overlay));
      record(`${fixture.path}: sidebar rendered`, state.sidebar === true, String(state.sidebar));
      record(`${fixture.path}: init ran with canvas`, Boolean(state.canvas), String(state.canvas));

      if (fixture.canvasId !== 'universal') {
        const parsedBar = await waitFor(async () => {
          const raw = await page.evaluate(`JSON.stringify({
            present: !!document.getElementById('jiratack-viewport-bar'),
            buttons: document.querySelectorAll('#jiratack-viewport-bar button').length,
            filter: /All/.test(document.getElementById('jiratack-sidebar') ? document.getElementById('jiratack-sidebar').textContent : '')
          })`);
          const probe = JSON.parse(raw);
          return probe.present && probe.filter ? probe : null;
        }, { timeout: 8000, interval: 200 }) || { present: false, buttons: 0, filter: false };

        record(`${fixture.path}: viewport presets render`, parsedBar.present && parsedBar.buttons === 5, JSON.stringify(parsedBar));
        record(`${fixture.path}: sidebar filters render`, parsedBar.filter === true, String(parsedBar.filter));
      }

      if (fixture.canvasId !== 'universal') {
        const pins = await waitFor(async () => {
          const count = await page.evaluate("document.querySelectorAll('.jiratack-pin').length");
          return count > 0 ? count : null;
        });
        record(`${fixture.path}: pins render from API data`, pins === 1, String(pins));
      }

      if (fixture.path === '/plain') {
        // polling: a pin created elsewhere must appear without a reload
        servers.state.pins = [
          ...servers.state.pins,
          {
            key: 'TEST-2',
            summary: 'Added while open',
            url: pageUrl,
            selector: '#target',
            pinPosition: '70.0,60.0',
            status: { name: 'To Do', category: 'new' },
          },
        ];
        const refreshed = await waitFor(async () => {
          const count = await page.evaluate("document.querySelectorAll('.jiratack-pin').length");
          return count >= 2 ? count : null;
        }, { timeout: 25000, interval: 500 });
        const polls = servers.state.calls.filter((c) => c === 'getPinsForCanvasAndUrl').length;
        record('polling picks up a new pin within 15s', refreshed === 2 && polls >= 2, `${refreshed} pins, ${polls} pin fetches`);
      }

      page.close();
    }

    const calls = servers.state.calls.filter(Boolean);
    record('API received exchange', calls.includes('exchangeToken'), calls.join(',') || 'none');
    record('launcher mode lists canvases', calls.includes('listCanvasesForUser'), calls.join(',') || 'none');
    record('canvas mode fetches pins', calls.includes('getPinsForCanvasAndUrl'), calls.join(',') || 'none');

    const csp = await (await fetch(`${servers.pagesUrl}/strict`)).headers.get('content-security-policy');
    record('fixture really is CSP-hostile', Boolean(csp && csp.includes("'nonce-") && !csp.includes("'unsafe-inline'")), String(csp));

    ext.close();
    browser.close();
  } finally {
    servers.close();
    if (chrome) chrome.child.kill('SIGKILL');
    if (!keep) {
      // Chrome keeps writing to the profile for a moment after SIGKILL.
      for (const dir of [profileDir, buildDir]) {
        try {
          fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        } catch (e) {
          console.warn(`cleanup skipped for ${dir}: ${e.code || e.message}`);
        }
      }
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(`HARNESS ERROR: ${e.message}`);
  process.exit(1);
});
