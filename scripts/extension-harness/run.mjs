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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  // code nobody wrote. Refuse rather than measure the wrong build. `src/shared`
  // is bundled into the SDK too (urlNormalize, pinMove), so it is part of the
  // fingerprint.
  const sourceTime = Math.max(
    newestMtime('src/bookmarklet'),
    newestMtime('src/extension'),
    newestMtime('src/shared'),
  );
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
      // The harness cannot grant activeTab, so keep the extension on the
      // html2canvas path rather than waiting for a denied tab capture.
      tabScreenshot: false,
    };
    await ext.evaluate(`chrome.storage.local.set({ jiratackConfig: ${JSON.stringify(config)} })`);

    const stored = await ext.evaluate('chrome.storage.local.get(["jiratackConfig"]).then((r) => Boolean(r.jiratackConfig))');
    record('config persists', stored === true, String(stored));

    // 'universal' is launcher mode (lists canvases); a canvas id fetches pins.
    const fixtures = [
      { path: '/strict', canvasId: 'universal' },
      { path: '/plain', canvasId: 'fixture-canvas' },
      { path: '/form', canvasId: 'fixture-canvas' },
      { path: '/text', canvasId: 'fixture-canvas' },
      { path: '/repeat', canvasId: 'fixture-canvas' },
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
      servers.state.pins = fixture.path === '/repeat' ? [{
        key: 'TEST-N',
        summary: '[JiraTack] Text change: News',
        url: pageUrl,
        selector: '#news-heading',
        pinPosition: '40.0,50.0',
        status: { name: 'To Do', category: 'new' },
        projectKey: 'TEST',
        issueTypeId: '10001',
        // A stored anchor whose path lands on the heading element (not the text
        // node): before the fix this resolved to a box-only preview.
        textChange: {
          original: 'News',
          suggested: 'Snooze',
          anchor: {
            start: { path: [1, 1, 0], offset: 0 },
            end: { path: [1, 1, 0], offset: 1 },
            ancestorSelector: '#news-heading',
          },
        },
      }] : [{
        key: 'TEST-1',
        summary: 'Fixture pin',
        url: pageUrl,
        selector: '#target',
        pinPosition: '40.0,50.0',
        status: { name: 'To Do', category: 'new' },
        projectKey: 'TEST',
        issueTypeId: '10001',
        parentKey: 'TEST-100',
        assignee: { accountId: 'fixture-account-9', displayName: 'Previous Assignee' },
      }];

      // The real extension injects the isolated-world bridge before the SDK;
      // mirror that so the preset bar (and recording) exercise the real path.
      await ext.evaluate(`chrome.scripting.executeScript({
        target: { tabId: ${tabId} },
        files: ['bridge.js'],
      })`);

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
        // The toolbar button enrolls itself from this view (D39): it must carry
        // the real token and endpoints, and nothing more.
        const exposed = await page.evaluate(`JSON.stringify(window.__jiratackConfig || null)`);
        const parsed = JSON.parse(exposed || 'null');
        record(
          `${fixture.path}: config exposed for extension enrollment`,
          Boolean(parsed)
            && parsed.token === config.token
            && parsed.apiUrl === config.apiUrl
            && Object.keys(parsed).length === 6,
          `${exposed ? Object.keys(parsed).join(',') : 'missing'}`,
        );
      }

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

        // four presets + Go (custom width) + Fit
        record(`${fixture.path}: viewport presets render`, parsedBar.present && parsedBar.buttons === 6, JSON.stringify(parsedBar));

        // The presets are only useful if a click reaches the extension. Drive
        // the real chain: bar button → bridge (isolated) → background.
        if (fixture.path === '/plain') {
          const barHit = JSON.parse(await page.evaluate(`(() => {
            const button = Array.from(document.querySelectorAll('#jiratack-viewport-bar button'))
              .find((b) => b.textContent === '1024');
            if (!button) return JSON.stringify(null);
            const r = button.getBoundingClientRect();
            const x = Math.round(r.left + r.width / 2);
            const y = Math.round(r.top + r.height / 2);
            const hit = document.elementFromPoint(x, y);
            return JSON.stringify({ x, y, own: hit === button || button.contains(hit) });
          })()`));
          record('viewport presets: the buttons are hit-testable', Boolean(barHit) && barHit.own === true, JSON.stringify(barHit));

          const swTargets = await targets(chrome.port);
          const swTarget = (swTargets || []).find(
            (t) => t.type === 'service_worker' && String(t.url || '').indexOf('background.js') >= 0,
          );
          let sw = null;
          if (swTarget) {
            sw = await connect(swTarget.webSocketDebuggerUrl);
            await sw.evaluate(`(() => {
              self.__jtResizes = [];
              if (!self.__jtResizeSpy) {
                self.__jtResizeSpy = true;
                chrome.runtime.onMessage.addListener(function (message) {
                  if (message && message.type === 'jiratack-resize') {
                    self.__jtResizes.push(message);
                  }
                });
              }
            })()`);
          }
          if (barHit && sw) {
            await page.send('Input.dispatchMouseEvent', {
              type: 'mousePressed', x: barHit.x, y: barHit.y, button: 'left', clickCount: 1,
            });
            await page.send('Input.dispatchMouseEvent', {
              type: 'mouseReleased', x: barHit.x, y: barHit.y, button: 'left', clickCount: 1,
            });
            const seen = await waitFor(async () => {
              const raw = await sw.evaluate('JSON.stringify(self.__jtResizes || [])');
              const calls = JSON.parse(raw);
              return calls.length > 0 ? calls : null;
            }, { timeout: 5000, interval: 100 });
            record(
              'viewport presets: a click reaches the background with the page width',
              Array.isArray(seen) && seen[0].width === 1024 && seen[0].sidebarWidth === 320,
              JSON.stringify(seen),
            );
            sw.close();
          } else {
            record('viewport presets: a click reaches the background with the page width', false, 'no service worker target');
          }
        }
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

        // --- status filter (D38) ---------------------------------------------
        // A Done ticket follows the project rule: hidden everywhere by default,
        // revealed by View All, hidden again by Filter By Status.
        servers.state.pins = [
          ...servers.state.pins,
          {
            key: 'TEST-F',
            summary: 'Done fixture pin',
            url: pageUrl,
            selector: '#target',
            pinPosition: '5.0,5.0',
            status: { name: 'Done', category: 'done' },
            projectKey: 'TEST',
            issueTypeId: '10001',
            parentKey: 'TEST-100',
            filtered: true,
          },
        ];
        // The control exists as soon as the canvas has statuses, so it cannot
        // signal delivery. Wait for the poll that actually fetches TEST-F.
        const fetchesBeforeDone = servers.state.calls.filter((c) => c === 'getPinsForCanvasAndUrl').length;
        const doneDelivered = await waitFor(async () => {
          const calls = servers.state.calls.filter((c) => c === 'getPinsForCanvasAndUrl').length;
          return calls > fetchesBeforeDone ? calls : null;
        }, { timeout: 25000, interval: 500 });
        await sleep(400);
        const control = JSON.parse(await page.evaluate(`(() => {
          const el = document.querySelector('.jiratack-statusrow');
          return el ? JSON.stringify(Array.from(el.querySelectorAll('button')).map((b) => b.textContent)) : JSON.stringify(null);
        })()`));
        if (control === null) {
          const headerDump = await page.evaluate(`(() => {
            const header = document.querySelector('#jiratack-sidebar .jiratack-canvas-selector');
            return JSON.stringify((header && header.innerHTML) || 'no header container');
          })()`);
          console.log(`[debug] statusrow absent. header=${headerDump}`);
        }
        record(
          'status filter: the control shows View All and Filter By Status',
          Array.isArray(control) && doneDelivered !== null,
          JSON.stringify(control || 'no status row'),
        );

        const hiddenState = JSON.parse(await page.evaluate(`JSON.stringify({
          pin: !!document.querySelector('.jiratack-pin[data-key="TEST-F"]'),
          listed: ((document.getElementById('jiratack-sidebar') || {}).textContent || '').includes('Done fixture pin'),
        })`));
        record(
          'status filter: a Done ticket is hidden from the canvas and the list',
          hiddenState.pin === false && hiddenState.listed === false,
          hiddenState,
        );

        await page.evaluate(`(() => {
          const hit = Array.from(document.querySelectorAll('.jiratack-statusrow button'))
            .find((b) => b.textContent === 'View All');
          if (hit) hit.click();
        })()`);
        const revealed = await waitFor(() => page.evaluate(
          "(() => { const el = document.querySelector('.jiratack-pin[data-key=\"TEST-F\"]'); return el ? el.className : null; })()",
        ), { timeout: 5000, interval: 200 });
        record(
          'status filter: View All reveals the Done ticket with muted styling',
          typeof revealed === 'string' && revealed.includes('jiratack-pin-done'),
          String(revealed),
        );
        const listedAfterReveal = await page.evaluate(
          "((document.getElementById('jiratack-sidebar') || {}).textContent || '').includes('Done fixture pin')",
        );
        record('status filter: View All also lists the Done ticket', listedAfterReveal === true, String(listedAfterReveal));
        const countLabel = JSON.parse(await page.evaluate(`(() => {
          const buttons = Array.from(document.querySelectorAll('.jiratack-statusrow button'));
          return JSON.stringify(buttons.map((b) => b.textContent));
        })()`));
        record(
          'status filter: View All carries the hidden count for re-filtering',
          countLabel.some((t) => t.includes('Filter By Status') && t.includes('1')),
          countLabel,
        );

        await page.evaluate(`(() => {
          const hit = Array.from(document.querySelectorAll('.jiratack-statusrow button'))
            .find((b) => b.textContent.indexOf('Filter By Status') === 0);
          if (hit) hit.click();
        })()`);
        const hiddenAgain = await page.evaluate("!!document.querySelector('.jiratack-pin[data-key=\"TEST-F\"]')");
        record('status filter: Filter By Status hides it again', hiddenAgain === false, String(hiddenAgain));

        // --- the dropdown (D38 amendment) ------------------------------------
        await page.evaluate(`(() => {
          const caret = document.querySelector('.jiratack-statusrow .jiratack-statuscaret');
          if (caret) caret.click();
        })()`);
        const panel = await waitFor(async () => {
          const raw = await page.evaluate(`(() => {
            const el = document.querySelector('.jiratack-statuspanel');
            if (!el) return JSON.stringify(null);
            const actions = Array.from(el.querySelectorAll('.jiratack-statuspanel-action')).map((b) => b.textContent);
            const options = Array.from(el.querySelectorAll('.jiratack-statusoption')).map((label) => ({
              name: (label.querySelector('.jiratack-statusoption-name') || {}).textContent || '',
              count: (label.querySelector('.jiratack-statusoption-count') || {}).textContent || '',
              checked: !!(label.querySelector('input') || {}).checked,
            }));
            return JSON.stringify({ actions, options });
          })()`);
          return JSON.parse(raw);
        }, { timeout: 5000, interval: 100 });
        record(
          'status filter: the caret opens a panel with All/None/Reset',
          Boolean(panel)
            && panel.actions.join(',') === 'All,None,Reset'
            && panel.options.some((row) => row.name === 'Done' && row.count === '1' && row.checked === false),
          JSON.stringify(panel),
        );

        // Ticking Done shows the Done ticket at once and remembers the choice.
        await page.evaluate(`(() => {
          const label = Array.from(document.querySelectorAll('.jiratack-statusoption'))
            .find((el) => (el.querySelector('.jiratack-statusoption-name') || {}).textContent === 'Done');
          const box = label && label.querySelector('input');
          if (box) box.click();
        })()`);
        const shownByTick = await waitFor(
          () => page.evaluate("!!document.querySelector('.jiratack-pin[data-key=\"TEST-F\"]')"),
          { timeout: 5000, interval: 100 },
        );
        const storedRule = JSON.parse(await page.evaluate(`(() => {
          const key = Object.keys(localStorage).filter((k) => k.indexOf('jiratack:statusFilter:') === 0)[0];
          return JSON.stringify(key ? JSON.parse(localStorage.getItem(key)) : null);
        })()`));
        record(
          'status filter: ticking a status shows it and persists the choice',
          shownByTick === true && Array.isArray(storedRule) && storedRule.indexOf('Done') === -1,
          `shown=${shownByTick} stored=${JSON.stringify(storedRule)}`,
        );

        // Reset returns to the project default and forgets the override.
        await page.evaluate(`(() => {
          const caret = document.querySelector('.jiratack-statusrow .jiratack-statuscaret');
          if (caret && !document.querySelector('.jiratack-statuspanel')) caret.click();
          const reset = Array.from(document.querySelectorAll('.jiratack-statuspanel-action'))
            .find((b) => b.textContent === 'Reset');
          if (reset) reset.click();
        })()`);
        await sleep(300);
        const resetHidden = await page.evaluate("!!document.querySelector('.jiratack-pin[data-key=\"TEST-F\"]')");
        const storedAfterReset = await page.evaluate(`(() => {
          const key = Object.keys(localStorage).filter((k) => k.indexOf('jiratack:statusFilter:') === 0)[0];
          return key ? localStorage.getItem(key) : null;
        })()`);
        record(
          'status filter: Reset restores the default and drops the override',
          resetHidden === false && storedAfterReset === null,
          `hidden=${resetHidden} stored=${JSON.stringify(storedAfterReset)}`,
        );

        // --- pin move: long-press, ghost, confirm, supersede (D33) -----------
        const geom = JSON.parse(await page.evaluate(`(() => {
          const pin = document.querySelector('.jiratack-pin[data-key="TEST-1"]');
          const copy = document.getElementById('copy');
          if (!pin || !copy) return JSON.stringify({ ok: false });
          const p = pin.getBoundingClientRect();
          const t = copy.getBoundingClientRect();
          return JSON.stringify({
            ok: true,
            pinX: Math.round(p.left + p.width / 2),
            pinY: Math.round(p.top + p.height / 2),
            dropX: Math.round(t.left + t.width / 2),
            dropY: Math.round(t.top + t.height / 2),
          });
        })()`));
        record('move: draggable pin located', geom.ok === true, JSON.stringify(geom));

        const second = JSON.parse(await page.evaluate(`(() => {
          const pin = document.querySelector('.jiratack-pin[data-key="TEST-2"]');
          if (!pin) return JSON.stringify({ ok: false });
          const r = pin.getBoundingClientRect();
          return JSON.stringify({
            ok: true,
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
          });
        })()`));

        const actionPoint = JSON.parse(await page.evaluate(`(() => {
          const el = document.getElementById('action');
          if (!el) return JSON.stringify({ ok: false });
          const r = el.getBoundingClientRect();
          return JSON.stringify({
            ok: true,
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
          });
        })()`));

        if (second.ok) {
          // A short press must keep the old behaviour: select, never arm.
          await page.send('Input.dispatchMouseEvent', {
            type: 'mousePressed', x: second.x, y: second.y, button: 'left', clickCount: 1,
          });
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: second.x, y: second.y, button: 'left', clickCount: 1,
          });
          await sleep(150);
          const selected = await page.evaluate(
            "(() => { const el = document.querySelector('.jiratack-pin.jiratack-pin-selected'); return el ? el.dataset.key : null; })()",
          );
          record('move: a short click still selects the pin', selected === 'TEST-2', String(selected));

          // A press that moves during the arm window must arm immediately (D33
        // amendment): hands slide while pressing on a small target, and the old
        // cancel-on-slop made that a silent dead gesture.
        if (geom.ok) {
          await page.send('Input.dispatchMouseEvent', {
            type: 'mousePressed', x: geom.pinX, y: geom.pinY, button: 'left', clickCount: 1,
          });
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: geom.pinX + 14, y: geom.pinY + 10, button: 'left', buttons: 1,
          });
          await sleep(60);
          const fastArmed = await page.evaluate("!!document.querySelector('.jiratack-pin-ghost')");
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: geom.pinX + 14, y: geom.pinY + 10, button: 'left', clickCount: 1,
          });
          await sleep(200);
          const fastBar = await page.evaluate("!!document.querySelector('.jiratack-move-confirm')");
          record(
            'move: a fast grab arms without the hold and proposes at drop',
            fastArmed === true && fastBar === true,
            `armed=${fastArmed}, bar=${fastBar}`,
          );
          // clear the pending move so the following scripted drag starts clean
          await page.evaluate(`(() => {
            const button = Array.from(document.querySelectorAll('.jiratack-move-confirm button'))
              .find((b) => b.textContent.indexOf('Cancel') === 0);
            if (button) button.click();
          })()`);
          await sleep(300);
        }

        // Holding still is not a move: dropping on our own pin must abandon
          // the drag instead of re-anchoring the pin to the overlay or to pixels.
          const before = servers.state.calls.filter((c) => c === 'updatePinPosition').length;
          await page.send('Input.dispatchMouseEvent', {
            type: 'mousePressed', x: second.x, y: second.y, button: 'left', clickCount: 1,
          });
          await sleep(550);
          const armedAgain = await page.evaluate("!!document.querySelector('.jiratack-pin-ghost')");
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: second.x, y: second.y, button: 'left', clickCount: 1,
          });
          await sleep(600);
          const afterCount = servers.state.calls.filter((c) => c === 'updatePinPosition').length;
          record(
            'move: a long-press that does not move changes nothing',
            armedAgain === true && afterCount === before,
            `armed=${armedAgain}, calls ${before}->${afterCount}`,
          );
        }

        // The extension's resize bar is not part of the page. Watch its
        // visibility while the move captures, to prove it is excluded and then
        // restored rather than left hidden.
        await page.evaluate(`(() => {
          const bar = document.getElementById('jiratack-viewport-bar');
          window.__jtBarVisibility = bar ? { seen: [], current: bar.style.visibility || '' } : null;
          if (!bar) return;
          new MutationObserver(() => {
            window.__jtBarVisibility.current = bar.style.visibility || '';
            window.__jtBarVisibility.seen.push(window.__jtBarVisibility.current);
          }).observe(bar, { attributes: true, attributeFilter: ['style'] });
        })()`);

        const pinCentre = async (key) => JSON.parse(await page.evaluate(`(() => {
          const pin = document.querySelector('.jiratack-pin[data-key="${key}"]');
          if (!pin) return JSON.stringify(null);
          const r = pin.getBoundingClientRect();
          return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
        })()`));

        const dragTo = async (from, to) => {
          await page.send('Input.dispatchMouseEvent', {
            type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1,
          });
          await sleep(550);
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: to.x, y: to.y, button: 'left', buttons: 1,
          });
          await sleep(50);
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1,
          });
        };

        const waitForConfirmBar = () => waitFor(async () => {
          const raw = await page.evaluate(`(() => {
            const bar = document.querySelector('.jiratack-move-confirm');
            const pin = document.querySelector('.jiratack-pin[data-key="TEST-1"]');
            if (!bar || !pin) return JSON.stringify(null);
            const b = bar.getBoundingClientRect();
            const p = pin.getBoundingClientRect();
            return JSON.stringify({
              left: Math.round(b.left),
              top: Math.round(b.top),
              right: Math.round(b.right),
              bottom: Math.round(b.bottom),
              pinTop: Math.round(p.top),
              pinBottom: Math.round(p.bottom),
              pinX: Math.round(p.left + p.width / 2),
              viewportWidth: window.innerWidth,
            });
          })()`);
          return JSON.parse(raw);
        }, { timeout: 5000, interval: 100 });

        const clickBarButton = async (selector) => {
          const spot = JSON.parse(await page.evaluate(`(() => {
            const el = document.querySelector('${selector}');
            if (!el) return JSON.stringify({ ok: false });
            const r = el.getBoundingClientRect();
            return JSON.stringify({
              ok: true,
              x: Math.round(r.left + r.width / 2),
              y: Math.round(r.top + r.height / 2),
            });
          })()`));
          if (!spot.ok) return false;
          await page.send('Input.dispatchMouseEvent', {
            type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1,
          });
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1,
          });
          return true;
        };

        if (geom.ok && actionPoint.ok) {
          await page.send('Input.dispatchMouseEvent', {
            type: 'mousePressed', x: geom.pinX, y: geom.pinY, button: 'left', clickCount: 1,
          });
          await sleep(550);
          const armed = await page.evaluate("!!document.querySelector('.jiratack-pin-ghost')");
          record('move: long-press arms the drag', armed === true, String(armed));

          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: geom.dropX, y: geom.dropY, button: 'left', buttons: 1,
          });
          await sleep(50);
          const ghostAt = JSON.parse(await page.evaluate(`(() => {
            const ghost = document.querySelector('.jiratack-pin-ghost');
            if (!ghost) return JSON.stringify(null);
            const r = ghost.getBoundingClientRect();
            return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
          })()`));
          record(
            'move: ghost follows the cursor',
            Boolean(ghostAt) && Math.abs(ghostAt.x - geom.dropX) <= 2 && Math.abs(ghostAt.y - geom.dropY) <= 2,
            JSON.stringify(ghostAt),
          );

          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: geom.dropX, y: geom.dropY, button: 'left', clickCount: 1,
          });

          const confirmBar = await waitForConfirmBar();
          record('move: drop opens the confirmation bar', Boolean(confirmBar), JSON.stringify(confirmBar));
          const beside = confirmBar
            && ((Math.abs(confirmBar.top - confirmBar.pinBottom) <= 12)
              || (Math.abs(confirmBar.bottom - confirmBar.pinTop) <= 12))
            && confirmBar.left <= confirmBar.pinX
            && confirmBar.pinX <= confirmBar.right
            && confirmBar.right <= confirmBar.viewportWidth - 320;
          record('move: confirmation bar sits beside the pin', Boolean(beside), JSON.stringify(confirmBar));

          // Deferred writes: give the capture time to finish, then prove the
          // move is still only in memory.
          await sleep(1500);
          const deferred = servers.state.calls.filter(
            (c) => c === 'beginScreenshotUpload' || c === 'uploadScreenshotChunk' || c === 'updatePinPosition',
          );
          record('move: nothing is written before confirmation', deferred.length === 0, deferred.join(',') || 'none');

          if (second.ok) {
            // One move at a time: another pin must not arm while this is open.
            await page.send('Input.dispatchMouseEvent', {
              type: 'mousePressed', x: second.x, y: second.y, button: 'left', clickCount: 1,
            });
            await sleep(550);
            const secondArmed = await page.evaluate("!!document.querySelector('.jiratack-pin-ghost')");
            await page.send('Input.dispatchMouseEvent', {
              type: 'mouseReleased', x: second.x, y: second.y, button: 'left', clickCount: 1,
            });
            await sleep(200);
            const stillOpen = await page.evaluate("!!document.querySelector('.jiratack-move-confirm')");
            record(
              'move: a pending move blocks new drags',
              secondArmed === false && stillOpen === true,
              `armed=${secondArmed}, bar=${stillOpen}`,
            );
          }

          await clickBarButton('.jiratack-move-confirm-accept');
          const move = await waitFor(() => servers.state.lastPinMove, { timeout: 20000, interval: 250 });
          record(
            'move: Confirm calls updatePinPosition',
            Boolean(move) && move.issueKey === 'TEST-1',
            move ? `${move.issueKey} ${move.pinPosition}` : 'no call',
          );
          record(
            'move: Confirm uses the selector under the cursor',
            Boolean(move) && move.selector === '#copy',
            move ? String(move.selector) : 'no call',
          );
          record(
            'move: Confirm sends distance and capture context',
            Boolean(move)
              && Number.isFinite(move.movedPixels)
              && move.movedPixels > 4
              && Boolean(move.captureContext && move.captureContext.viewport),
            move ? `moved ${Math.round(move.movedPixels)}px, capture=${Boolean(move.captureContext)}` : 'no call',
          );
          record(
            'move: screenshot goes through the chunked pipeline',
            Boolean(move && move.screenshotUploadId) && servers.state.lastPinMoveUploadBytes > 0,
            move ? `id=${move.screenshotUploadId} bytes=${servers.state.lastPinMoveUploadBytes}` : 'no call',
          );

          const barGone = await waitFor(async () => {
            const present = await page.evaluate("!!document.querySelector('.jiratack-move-confirm')");
            return present ? null : true;
          }, { timeout: 5000, interval: 100 });
          record('move: Confirm removes the confirmation bar', barGone === true, String(barGone));

          const bar = JSON.parse(await page.evaluate('JSON.stringify(window.__jtBarVisibility)'));
          record(
            'move: viewport bar is hidden for the capture and restored',
            Boolean(bar) && bar.seen.includes('hidden') && bar.current === '',
            JSON.stringify(bar),
          );

          const after = await pinCentre('TEST-1');
          record(
            'move: pin renders at the drop point',
            Boolean(after)
              && Math.abs(after.x - geom.dropX) <= 4
              && Math.abs(after.y - geom.dropY) <= 4,
            JSON.stringify(after),
          );

          // --- Cancel restores the pin and writes nothing -------------------
          const moveCallsAfterConfirm = servers.state.calls.filter((c) => c === 'updatePinPosition').length;
          const currentPin = await pinCentre('TEST-1');
          await dragTo(currentPin, actionPoint);
          const cancelBar = await waitForConfirmBar();
          record('move: a second drop opens a bar again', Boolean(cancelBar), JSON.stringify(cancelBar));
          await clickBarButton('.jiratack-move-confirm-cancel');
          await sleep(400);
          const restored = await pinCentre('TEST-1');
          const cancelCalls = servers.state.calls.filter((c) => c === 'updatePinPosition').length;
          const cancelBarGone = await page.evaluate("!!document.querySelector('.jiratack-move-confirm')");
          record(
            'move: Cancel restores the pin and writes nothing',
            Boolean(restored)
              && Math.abs(restored.x - geom.dropX) <= 4
              && Math.abs(restored.y - geom.dropY) <= 4
              && cancelCalls === moveCallsAfterConfirm
              && cancelBarGone === false,
            `pin=${JSON.stringify(restored)} calls=${cancelCalls - moveCallsAfterConfirm}`,
          );

          // --- The drag must be visible -----------------------------------
          // The dragged pin keeps its presence and changes colour, and the
          // ghost stays exactly under the cursor — including in the sidebar
          // zone, where the push-mode fixed-shift pass used to shove it 320px
          // away because it was parented to document.body (D33 amendment).
          const visiblePin = await pinCentre('TEST-1');
          await page.send('Input.dispatchMouseEvent', {
            type: 'mousePressed', x: visiblePin.x, y: visiblePin.y, button: 'left', clickCount: 1,
          });
          await sleep(550);
          const dragLook = JSON.parse(await page.evaluate(`(() => {
            const el = document.querySelector('.jiratack-pin[data-key="TEST-1"]');
            const style = el ? getComputedStyle(el) : null;
            return JSON.stringify({
              dragging: !!el && el.classList.contains('jiratack-pin-dragging'),
              opacity: style ? style.opacity : null,
              background: style ? style.backgroundColor : null,
            });
          })()`));
          record(
            'move: the dragged pin stays visible and changes colour',
            dragLook.dragging === true
              && dragLook.opacity === '1'
              && dragLook.background === 'rgb(244, 197, 66)',
            JSON.stringify(dragLook),
          );

          const zone = JSON.parse(await page.evaluate(`JSON.stringify({
            width: window.innerWidth,
            zoneLeft: window.innerWidth - 320,
          })`));
          const zoneX = Math.round(zone.zoneLeft + 120);
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: zoneX, y: visiblePin.y, button: 'left', buttons: 1,
          });
          await sleep(700); // let the fixed-shift rescan run
          const zoneGhost = JSON.parse(await page.evaluate(`(() => {
            const ghost = document.querySelector('.jiratack-pin-ghost');
            if (!ghost) return JSON.stringify(null);
            const r = ghost.getBoundingClientRect();
            return JSON.stringify({
              x: Math.round(r.x + r.width / 2),
              y: Math.round(r.y + r.height / 2),
              translate: ghost.style.getPropertyValue('translate'),
              parent: ghost.parentElement ? ghost.parentElement.id || ghost.parentElement.className : null,
            });
          })()`));
          record(
            'move: the ghost follows the cursor into the sidebar zone',
            Boolean(zoneGhost)
              && Math.abs(zoneGhost.x - zoneX) <= 4
              && zoneGhost.translate === ''
              && zoneGhost.parent === 'jiratack-overlay',
            `cursor=${zoneX} ${JSON.stringify(zoneGhost)}`,
          );
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: zoneX, y: visiblePin.y, button: 'left', clickCount: 1,
          });
          await sleep(400);
          const zoneBar = await page.evaluate("!!document.querySelector('.jiratack-move-confirm')");
          record(
            'move: releasing over our own sidebar proposes nothing',
            zoneBar === false,
            `bar=${zoneBar}`,
          );

          // --- Sidebar centring: a card click brings the pin into the middle of
          // the page. The pin marker lives inside the fixed overlay, so
          // `scrollIntoView` on it is a no-op — the pin's anchor drives the
          // scroll, which is why this regressed to "nothing happens".
          await page.evaluate(`(() => {
            if (!document.getElementById('jiratack-centre-spacer')) {
              const spacer = document.createElement('div');
              spacer.id = 'jiratack-centre-spacer';
              spacer.style.height = '3000px';
              document.body.appendChild(spacer);
            }
            window.scrollTo(0, 1600);
          })()`);
          await sleep(250);
          const scrolledDown = await page.evaluate('window.scrollY');
          const cardActivated = await page.evaluate(`(() => {
            const card = document.querySelector('#jiratack-sidebar .jiratack-ticket-card[data-key="TEST-1"]');
            if (!card) return false;
            card.scrollIntoView({ block: 'nearest' });
            card.click();
            return true;
          })()`);
          const centred = await waitFor(async () => {
            const y = await page.evaluate('window.scrollY');
            return y < scrolledDown - 400 ? y : null;
          }, { timeout: 5000, interval: 100 });
          record(
            'sidebar: selecting a card scrolls the page to the pin',
            cardActivated === true && scrolledDown > 1000 && centred !== null,
            `from ${scrolledDown} to ${centred}`,
          );
          // leave the page where the next test expects it
          await page.evaluate(`(() => {
            window.scrollTo(0, 0);
            const spacer = document.getElementById('jiratack-centre-spacer');
            if (spacer) spacer.remove();
          })()`);
          await sleep(300);

          // --- Accordion: one open card at a time ---------------------------
          // Close whatever an earlier step left open, so this starts clean.
          await page.evaluate(`(() => {
            const open = document.querySelector('.jiratack-inline-edit');
            const card = open && open.closest('.jiratack-ticket-card');
            if (card) card.click();
          })()`);
          await sleep(300);

          const openedFirst = await page.evaluate(`(() => {
            const card = document.querySelector('.jiratack-ticket-card[data-key="TEST-1"]');
            if (!card) return false;
            card.click();
            return true;
          })()`);
          await sleep(400);
          const firstState = JSON.parse(await page.evaluate(`(() => JSON.stringify({
            editors: document.querySelectorAll('.jiratack-inline-edit').length,
            first: !!document.querySelector('.jiratack-ticket-card[data-key="TEST-1"] .jiratack-inline-edit'),
          }))()`));
          await page.evaluate(`(() => {
            const card = document.querySelector('.jiratack-ticket-card[data-key="TEST-2"]');
            if (card) card.click();
          })()`);
          await sleep(400);
          const secondState = JSON.parse(await page.evaluate(`(() => JSON.stringify({
            editors: document.querySelectorAll('.jiratack-inline-edit').length,
            first: !!document.querySelector('.jiratack-ticket-card[data-key="TEST-1"] .jiratack-inline-edit'),
            second: !!document.querySelector('.jiratack-ticket-card[data-key="TEST-2"] .jiratack-inline-edit'),
          }))()`));
          record(
            'sidebar: opening a card closes the previously open one',
            openedFirst === true
              && firstState.editors === 1 && firstState.first === true
              && secondState.editors === 1 && secondState.second === true && secondState.first === false,
            `${JSON.stringify(firstState)} -> ${JSON.stringify(secondState)}`,
          );

          // --- Closing the overlay discards a pending move ------------------
          const closeCallsBefore = servers.state.calls.filter((c) => c === 'updatePinPosition').length;
          const beforeClose = await pinCentre('TEST-1');
          await dragTo(beforeClose, actionPoint);
          const closeBar = await waitForConfirmBar();
          record('move: a third drop opens a bar again', Boolean(closeBar), JSON.stringify(closeBar));
          await page.evaluate('window.__jiratackClose()');
          await sleep(800);
          const closeCalls = servers.state.calls.filter((c) => c === 'updatePinPosition').length;
          const overlayGone = await page.evaluate("!document.getElementById('jiratack-overlay')");
          record(
            'move: closing the overlay discards the pending move',
            closeCalls === closeCallsBefore && overlayGone === true,
            `calls=${closeCalls - closeCallsBefore}, overlayGone=${overlayGone}`,
          );

          // --- Cross-URL card: the overlay follows exactly one navigation ---
          // Base tab has the isolated-world bridge injected, so the carry
          // message reaches the background like a real sidebar click. The
          // overlay must come back on the new URL without the toolbar (D40).
          await page.evaluate(`window.postMessage({
            source: 'jiratack',
            type: 'carry-overlay',
            url: '${servers.pagesUrl}/text',
          }, '*')`);
          await sleep(250);
          await page.send('Page.navigate', { url: `${servers.pagesUrl}/text` });
          const revived = await waitFor(async () => {
            const raw = await page.evaluate(`JSON.stringify({
              overlay: !!document.getElementById('jiratack-overlay'),
              sidebar: !!document.getElementById('jiratack-sidebar'),
              canvas: window.__jiratackActiveCanvas || null,
              path: location.pathname,
            })`);
            const parsed = JSON.parse(raw);
            return parsed.overlay && parsed.sidebar ? parsed : null;
          }, { timeout: 20000, interval: 300 });
          record(
            'cross-URL: the overlay reopens by itself on the next page',
            Boolean(revived) && revived.path === '/text',
            JSON.stringify(revived),
          );

          // A plain navigation (no carry flag) must not reopen it.
          await ext.evaluate(`chrome.scripting.executeScript({
            target: { tabId: ${tabId} },
            world: 'MAIN',
            func: function () { window.__jiratackClose(); },
          })`);
          await sleep(400);
          await page.send('Page.navigate', { url: `${servers.pagesUrl}/plain` });
          await sleep(2500);
          const stayedClosed = await page.evaluate("!document.getElementById('jiratack-overlay')");
          record(
            'cross-URL: a plain navigation does not reopen the overlay',
            stayedClosed === true,
            String(stayedClosed),
          );
        }
      }

      if (fixture.path === '/repeat') {
        // KAN-83 shape: a stored text change whose word appears several times.
        // The preview must resolve it without asking the reviewer to re-select.
        const switchReady = await waitFor(() => page.evaluate(`(() => {
          const el = document.querySelector('.jiratack-ticket-card[data-key="TEST-N"] .jiratack-textchange-switch');
          return el ? true : null;
        })()`), { timeout: 15000 });
        record('text change: a stored change shows its switch', switchReady === true, String(switchReady));

        await page.evaluate(`(() => {
          window.__repeatErrors = [];
          window.addEventListener('error', (event) => window.__repeatErrors.push(String(event.message || event.error)));
          const el = document.querySelector('.jiratack-ticket-card[data-key="TEST-N"] .jiratack-textchange-switch');
          if (el) el.click();
        })()`);
        await sleep(400);
        const diag = JSON.parse(await page.evaluate(`(() => {
          const sw = document.querySelector('.jiratack-ticket-card[data-key="TEST-N"] .jiratack-textchange-switch');
          return JSON.stringify({
            checked: sw ? sw.getAttribute('aria-checked') : 'no-switch',
            previews: document.querySelectorAll('[class*="jiratack-text-preview"]').length,
            inline: document.querySelectorAll('.jiratack-text-preview-replacement').length,
            boxes: document.querySelectorAll('.jiratack-text-preview-box').length,
            toasts: Array.from(document.querySelectorAll('.jiratack-toast')).map((t) => t.textContent),
            heading: (document.getElementById('news-heading') || {}).textContent,
            onPage: !!document.querySelector('.jiratack-ticket-card[data-key="TEST-N"]'),
            errors: window.__repeatErrors || [],
            debug: window.__jtDebugText || null,
            scope: (() => {
              const root = document.querySelector('#news-heading');
              if (!root) return 'no-root';
              return JSON.stringify({ text: root.textContent, html: root.innerHTML });
            })(),
            headingText: (document.getElementById('news-heading') || {}).textContent,
          });
        })()`));
        record(
          'text change: a repeated word resolves and previews',
          diag.checked === 'true' && (diag.inline > 0 || diag.boxes > 0),
          JSON.stringify(diag),
        );
        record(
          'text change: no "could not locate" toast for an existing word',
          !Array.isArray(diag.toasts) || diag.toasts.every((t) => String(t).indexOf('Could not locate') === -1),
          JSON.stringify(diag.toasts || []),
        );
      }

      if (fixture.path === '/form') {
        const clickAt = async (spot) => {
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: spot.x, y: spot.y, button: 'none', buttons: 0,
          });
          await page.send('Input.dispatchMouseEvent', {
            type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1,
          });
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1,
          });
        };
        const pointFor = async (selector) => JSON.parse(await page.evaluate(`(() => {
          const el = document.querySelector('${selector}');
          if (!el) return JSON.stringify({ ok: false });
          const r = el.getBoundingClientRect();
          return JSON.stringify({
            ok: true,
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
          });
        })()`));

        // --- pin capture: one mode, then an anchored composer ---------------
        const pinControl = JSON.parse(await page.evaluate(`(() => {
          const button = document.querySelector('.jiratack-pinmode-toggle');
          const hint = document.querySelector('.jiratack-pinmode-hint');
          return JSON.stringify({
            label: button ? button.textContent : null,
            hint: hint ? hint.textContent : null,
            hintSize: hint ? getComputedStyle(hint).fontSize : null,
            hintBackground: hint ? getComputedStyle(hint).backgroundColor : null,
            background: button ? getComputedStyle(button).backgroundColor : null,
            pressed: button ? button.getAttribute('aria-pressed') : null,
          });
        })()`));
        record(
          'form: the capture control is New Pin with directions',
          pinControl.label === 'New Pin'
            && /Click an element to pin it, or select text to suggest an edit/.test(pinControl.hint || '')
            && pinControl.pressed === 'false',
          JSON.stringify(pinControl),
        );
        record(
          'form: the New Pin directions are prominent',
          parseFloat(pinControl.hintSize || '0') >= 12
            && pinControl.hintBackground !== 'rgba(0, 0, 0, 0)',
          JSON.stringify({ size: pinControl.hintSize, background: pinControl.hintBackground }),
        );

        const pinMode = await pointFor('.jiratack-pinmode-toggle');
        record('form: New Pin is the only capture control', pinMode.ok === true, JSON.stringify(pinMode));
        if (pinMode.ok) await clickAt(pinMode);
        await sleep(150);
        const armed = JSON.parse(await page.evaluate(`(() => {
          const button = document.querySelector('.jiratack-pinmode-toggle');
          const hint = document.querySelector('.jiratack-pinmode-hint');
          return JSON.stringify({
            pressed: button ? button.getAttribute('aria-pressed') : null,
            background: button ? getComputedStyle(button).backgroundColor : null,
            hint: hint ? hint.textContent : null,
          });
        })()`));
        record(
          'form: New Pin shows an armed state and cancel hint',
          armed.pressed === 'true'
            && armed.background !== pinControl.background
            && /Esc cancels/.test(armed.hint || ''),
          JSON.stringify(armed),
        );

        const copyPoint = await pointFor('#copy');
        const composerStarted = Date.now();
        if (copyPoint.ok) await clickAt(copyPoint);

        const popoverAppeared = await waitFor(() => page.evaluate(`(() => {
          const card = document.querySelector('.jiratack-capture-popover[data-kind="pin"]');
          return card ? true : null;
        })()`), { timeout: 20000 });
        record('form: an element click opens the capture popover', popoverAppeared === true, String(popoverAppeared));
        record(
          'form: the composer opens without waiting for the screenshot',
          popoverAppeared === true && Date.now() - composerStarted < 1000,
          `${Date.now() - composerStarted}ms`,
        );

        const popoverShape = JSON.parse(await page.evaluate(`(() => {
          const card = document.querySelector('.jiratack-capture-popover[data-kind="pin"]');
          return JSON.stringify({
            title: card && card.querySelector('.jiratack-capture-title')
              ? card.querySelector('.jiratack-capture-title').textContent
              : null,
            summary: card && card.querySelector('input') ? card.querySelector('input').placeholder : null,
            description: card && card.querySelector('textarea')
              ? card.querySelector('textarea').placeholder
              : null,
            actions: card
              ? Array.from(card.querySelectorAll('.jiratack-capture-actions button')).map((b) => b.textContent)
              : [],
          });
        })()`));
        record(
          'form: the popover asks for Summary and Description',
          popoverShape.title === 'New ticket'
            && popoverShape.summary === 'Pin Summary'
            && popoverShape.description === 'Detailed Description',
          JSON.stringify(popoverShape),
        );
        record(
          'form: Add to ticket hands the content to the sidebar',
          popoverShape.actions[0] === 'Add to ticket',
          JSON.stringify(popoverShape.actions),
        );

        await page.evaluate(`(() => {
          const card = document.querySelector('.jiratack-capture-popover[data-kind="pin"]');
          if (!card) return;
          const summary = card.querySelector('input');
          const description = card.querySelector('textarea');
          summary.value = 'MVP bug';
          summary.dispatchEvent(new Event('input', { bubbles: true }));
          description.value = 'Captured from the popover.';
          description.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);

        const addPoint = await pointFor('.jiratack-capture-popover[data-kind="pin"] .jiratack-capture-actions .jiratack-button-primary');
        if (addPoint.ok) await clickAt(addPoint);

        const opened = await waitFor(
          () => page.evaluate("!!document.querySelector('.jiratack-new-ticket-form .jiratack-form')"),
          { timeout: 20000 },
        );
        record('form: Add to ticket opens the sidebar', opened === true, String(opened));

        const shotReady = await waitFor(
          () => page.evaluate("!!document.querySelector('.jiratack-screenshot-preview')"),
          { timeout: 15000 },
        );
        record('form: the screenshot is ready when the sidebar opens', shotReady === true, String(shotReady));

        const layout = JSON.parse(await page.evaluate(`(() => {
          const rect = (selector) => {
            const el = document.querySelector(selector);
            return el ? el.getBoundingClientRect() : null;
          };
          const assignee = rect('#jiratack-assignee');
          const project = rect('#jiratack-project');
          const summary = rect('#jiratack-summary');
          const description = rect('#jiratack-description');
          const attachRow = rect('.jiratack-attach-row');
          const evidenceList = rect('.jiratack-evidence-list');
          const sidebar = document.getElementById('jiratack-sidebar');
          const listToggle = document.querySelector('.jiratack-compose-list-toggle');
          const attachmentInput = document.querySelector('.jiratack-attachment-input');
          return JSON.stringify({
            activeId: document.activeElement ? document.activeElement.id || null : null,
            sections: Array.from(document.querySelectorAll('.jiratack-form-section .jiratack-section-title'))
              .map((el) => el.textContent),
            hasAssigneeCard: !!document.querySelector('.jiratack-assignee-card'),
            reporterInsideAssignee: !!document.querySelector('.jiratack-assignee-card .jiratack-form-meta'),
            hasEvidenceSection: !!document.querySelector('.jiratack-form-section .jiratack-attach-row'),
            recordButtonClass: document.querySelector('.jiratack-record-button')
              ? document.querySelector('.jiratack-record-button').className
              : null,
            assigneeTop: assignee ? Math.round(assignee.top) : null,
            projectTop: project ? Math.round(project.top) : null,
            summaryTop: summary ? Math.round(summary.top) : null,
            summaryBottom: summary ? Math.round(summary.bottom) : null,
            descriptionTop: description ? Math.round(description.top) : null,
            descriptionBottom: description ? Math.round(description.bottom) : null,
            attachTop: attachRow ? Math.round(attachRow.top) : null,
            attachBottom: attachRow ? Math.round(attachRow.bottom) : null,
            evidenceTop: evidenceList ? Math.round(evidenceList.top) : null,
            projectValue: document.getElementById('jiratack-project')
              ? document.getElementById('jiratack-project').value
              : null,
            assigneeValue: document.getElementById('jiratack-assignee')
              ? document.getElementById('jiratack-assignee').value
              : null,
            parentValue: document.getElementById('jiratack-parent')
              ? document.getElementById('jiratack-parent').value
              : null,
            summaryValue: document.getElementById('jiratack-summary')
              ? document.getElementById('jiratack-summary').value
              : null,
            descriptionValue: document.getElementById('jiratack-description')
              ? document.getElementById('jiratack-description').value
              : null,
            attachButtons: document.querySelectorAll('.jiratack-attach-row .jiratack-button').length,
            attachmentHidden: attachmentInput ? attachmentInput.offsetParent === null : false,
            hasTextChange: !!document.querySelector('.jiratack-textchange'),
            hasPopover: !!document.querySelector('.jiratack-capture-popover'),
            hasFilter: !!document.querySelector('.jiratack-filter-toggle'),
            hasContext: !!document.querySelector('.jiratack-compose-context'),
            composing: sidebar ? sidebar.classList.contains('jiratack-composing') : false,
            listToggle: listToggle ? listToggle.textContent.trim() : null,
            hasPinMode: !!document.querySelector('.jiratack-pinmode-toggle'),
            hasThumbnail: !!document.querySelector('.jiratack-screenshot-preview'),
            counter: document.querySelector('.jiratack-counter')
              ? document.querySelector('.jiratack-counter').textContent
              : null,
            summaryPlaceholder: document.getElementById('jiratack-summary')
              ? document.getElementById('jiratack-summary').placeholder
              : null,
            descriptionPlaceholder: document.getElementById('jiratack-description')
              ? document.getElementById('jiratack-description').placeholder
              : null,
          });
        })()`));

        record('form: Assignee is focused on open', layout.activeId === 'jiratack-assignee', String(layout.activeId));
        record(
          'form: grouped sections separate the form',
          JSON.stringify(layout.sections) === JSON.stringify(['Assigned to', 'Ticket', 'Evidence']),
          JSON.stringify(layout.sections),
        );
        record(
          'form: the tinted Assignee card contains the reporter line',
          layout.hasAssigneeCard === true && layout.reporterInsideAssignee === true,
          JSON.stringify({ card: layout.hasAssigneeCard, reporter: layout.reporterInsideAssignee }),
        );
        record(
          'form: Evidence groups the attach and record buttons',
          layout.hasEvidenceSection === true
            && /jiratack-record-button/.test(layout.recordButtonClass || ''),
          JSON.stringify({ evidence: layout.hasEvidenceSection, record: layout.recordButtonClass }),
        );
        record(
          'form: Assignee is the first key field',
          layout.assigneeTop !== null
            && layout.projectTop !== null
            && layout.summaryTop !== null
            && layout.assigneeTop < layout.projectTop
            && layout.assigneeTop < layout.summaryTop,
          `assignee=${layout.assigneeTop}, project=${layout.projectTop}, summary=${layout.summaryTop}`,
        );
        record(
          'form: the popover content is carried into the sidebar',
          layout.summaryValue === 'MVP bug' && layout.descriptionValue === 'Captured from the popover.',
          `${layout.summaryValue} / ${layout.descriptionValue}`,
        );
        record(
          'form: project and assignee default from the previous ticket',
          layout.projectValue === 'TEST' && layout.assigneeValue === 'Previous Assignee',
          `project=${layout.projectValue}, assignee=${layout.assigneeValue}`,
        );
        record(
          'form: parent defaults from the previous ticket',
          layout.parentValue === 'TEST-100',
          String(layout.parentValue),
        );
        record(
          'form: summary precedes description',
          layout.summaryBottom !== null
            && layout.descriptionTop !== null
            && layout.summaryBottom <= layout.descriptionTop,
          `summary.bottom=${layout.summaryBottom}, description.top=${layout.descriptionTop}`,
        );
        record(
          'form: description precedes the attach/record row',
          layout.descriptionBottom !== null
            && layout.attachTop !== null
            && layout.descriptionBottom <= layout.attachTop,
          `description.bottom=${layout.descriptionBottom}, attach.top=${layout.attachTop}`,
        );
        record(
          'form: captured evidence lists below the buttons',
          layout.attachBottom !== null
            && layout.evidenceTop !== null
            && layout.evidenceTop >= layout.attachBottom - 1,
          `attach.bottom=${layout.attachBottom}, evidence.top=${layout.evidenceTop}`,
        );
        record(
          'form: attach and record are two buttons',
          layout.attachButtons === 2,
          String(layout.attachButtons),
        );
        record(
          'form: the native file input is hidden behind the button',
          layout.attachmentHidden === true,
          String(layout.attachmentHidden),
        );
        record(
          'form: no text-change row for a normal pin',
          layout.hasTextChange === false,
          String(layout.hasTextChange),
        );
        record(
          'form: the composer is gone once the sidebar opens',
          layout.hasPopover === false,
          String(layout.hasPopover),
        );
        record(
          'form: compose mode hides filters and shows the page context',
          layout.composing && layout.hasFilter === false && layout.hasContext === true,
          JSON.stringify({ composing: layout.composing, filter: layout.hasFilter, context: layout.hasContext }),
        );
        record(
          'form: the ticket list collapses to one line',
          layout.listToggle !== null && /ticket/.test(layout.listToggle),
          String(layout.listToggle),
        );
        record(
          'form: capture controls are removed while composing',
          layout.hasPinMode === false,
          String(layout.hasPinMode),
        );
        record(
          'form: the screenshot is a visible thumbnail',
          layout.hasThumbnail === true,
          String(layout.hasThumbnail),
        );
        record(
          'form: the counter reflects the carried summary',
          layout.counter === '7/215',
          String(layout.counter),
        );
        record(
          'form: writing placeholders name the fields',
          layout.summaryPlaceholder === 'Pin Summary'
            && layout.descriptionPlaceholder === 'Detailed Description',
          `${layout.summaryPlaceholder} / ${layout.descriptionPlaceholder}`,
        );

        const typeReady = await waitFor(() => page.evaluate(`(() => {
          const select = document.getElementById('jiratack-issue-type');
          return select && !select.disabled && select.value ? true : null;
        })()`), { timeout: 8000 });
        record('form: issue types resolve', typeReady === true, String(typeReady));

        await page.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          modifiers: 4,
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13,
        });
        await page.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          modifiers: 4,
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13,
        });

        const created = await waitFor(() => servers.state.lastCreate, { timeout: 20000 });
        record(
          'form: create carries a canvas preview when the canvas has none',
          Boolean(created)
            && typeof created.canvasThumbnail === 'string'
            && created.canvasThumbnail.indexOf('data:image/jpeg') === 0,
          created && created.canvasThumbnail ? `${created.canvasThumbnail.length} chars` : 'no thumbnail',
        );
        record(
          'form: Cmd/Ctrl+Enter creates the ticket',
          Boolean(created) && created.summary === 'MVP bug',
          created ? String(created.summary) : 'no call',
        );
        record(
          'form: create carries project, type, assignee, parent and screenshot',
          Boolean(created)
            && created.projectKey === 'TEST'
            && Boolean(created.issueTypeId)
            && created.assigneeAccountId === 'fixture-account-9'
            && created.parentKey === 'TEST-100'
            && Boolean(created.screenshotUploadId),
          created
            ? `project=${created.projectKey} type=${created.issueTypeId} assignee=${created.assigneeAccountId} parent=${created.parentKey} shot=${Boolean(created.screenshotUploadId)}`
            : 'no call',
        );

        const restored = await waitFor(() => page.evaluate(`(() => {
          const form = document.querySelector('.jiratack-new-ticket-form .jiratack-form');
          const filter = document.querySelector('.jiratack-filter-toggle');
          return !form && filter ? true : null;
        })()`), { timeout: 15000 });
        record('form: creating returns the sidebar to browsing', restored === true, String(restored));
      }

      if (fixture.path === '/text') {
        const clickAt = async (spot) => {
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: spot.x, y: spot.y, button: 'none', buttons: 0,
          });
          await page.send('Input.dispatchMouseEvent', {
            type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1,
          });
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1,
          });
        };
        const pointFor = async (selector) => JSON.parse(await page.evaluate(`(() => {
          const el = document.querySelector('${selector}');
          if (!el) return JSON.stringify({ ok: false });
          const r = el.getBoundingClientRect();
          return JSON.stringify({
            ok: true,
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
          });
        })()`));

        const baseline = await page.evaluate("document.getElementById('copy').textContent");

        // No Text change mode: selecting text is the whole entry point.
        const hasTextMode = await page.evaluate(
          "!!document.querySelector('.jiratack-mode-btn[data-mode=\"text\"]')",
        );
        record('text: there is no Text change mode', hasTextMode === false, String(hasTextMode));

        // A real mouse drag, not a synthetic selection: the pill must survive
        // the native selectionchange that fires on mouse release.
        const selectionPoints = JSON.parse(await page.evaluate(`(() => {
          const copy = document.getElementById('copy');
          const node = copy && copy.firstChild;
          if (!node) return JSON.stringify({ ok: false });
          const range = document.createRange();
          range.setStart(node, 0);
          range.setEnd(node, 'Original'.length);
          const rects = Array.from(range.getClientRects())
            .filter((rect) => rect.width > 1 && rect.height > 1);
          if (rects.length === 0) return JSON.stringify({ ok: false });
          const first = rects[0];
          const last = rects[rects.length - 1];
          return JSON.stringify({
            ok: true,
            startX: Math.round(first.left + 1),
            startY: Math.round(first.top + first.height / 2),
            endX: Math.round(last.right - 1),
            endY: Math.round(last.top + last.height / 2),
          });
        })()`));

        if (selectionPoints.ok) {
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: selectionPoints.startX,
            y: selectionPoints.startY,
            button: 'none',
            buttons: 0,
          });
          await page.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: selectionPoints.startX,
            y: selectionPoints.startY,
            button: 'left',
            clickCount: 1,
          });
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: selectionPoints.startX + 3,
            y: selectionPoints.startY,
            button: 'left',
            buttons: 1,
          });
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: selectionPoints.endX,
            y: selectionPoints.endY,
            button: 'left',
            buttons: 1,
          });
        }

        const duringDrag = await page.evaluate(`(() => {
          const el = document.querySelector('.jiratack-suggest-pill');
          return el ? el.style.display !== 'none' : false;
        })()`);
        record('text: the pill waits for the mouse release', duringDrag === false, String(duringDrag));

        if (selectionPoints.ok) {
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: selectionPoints.endX,
            y: selectionPoints.endY,
            button: 'left',
            clickCount: 1,
          });
        }

        const pill = await waitFor(() => page.evaluate(`(() => {
          const el = document.querySelector('.jiratack-suggest-pill');
          return el && el.style.display !== 'none' ? true : null;
        })()`), { timeout: 6000 });
        record('text: a mouse selection shows the Suggest edit pill after release', pill === true, String(pill));

        const pillPoint = await pointFor('.jiratack-suggest-pill');
        if (pillPoint.ok) await clickAt(pillPoint);

        const popoverAppeared = await waitFor(() => page.evaluate(`(() => {
          const card = document.querySelector('.jiratack-capture-popover[data-kind="text"]');
          return card ? true : null;
        })()`), { timeout: 20000 });
        record('text: the pill opens the replacement popover', popoverAppeared === true, String(popoverAppeared));

        const shape = JSON.parse(await page.evaluate(`(() => {
          const card = document.querySelector('.jiratack-capture-popover[data-kind="text"]');
          return JSON.stringify({
            title: card && card.querySelector('.jiratack-capture-title')
              ? card.querySelector('.jiratack-capture-title').textContent
              : null,
            original: card && card.querySelector('.jiratack-capture-original')
              ? card.querySelector('.jiratack-capture-original').textContent
              : null,
            placeholder: card && card.querySelector('textarea')
              ? card.querySelector('textarea').placeholder
              : null,
            fieldLabel: card && card.querySelector('.jiratack-capture-field .jiratack-field-label')
              ? card.querySelector('.jiratack-capture-field .jiratack-field-label').textContent
              : null,
            switchLabel: card && card.querySelector('.jiratack-switch')
              ? card.querySelector('.jiratack-switch').textContent
              : null,
            actions: card
              ? Array.from(card.querySelectorAll('.jiratack-capture-actions button')).map((b) => b.textContent)
              : [],
          });
        })()`));
        record('text: the popover quotes the selection', shape.original === 'Original', String(shape.original));
        record(
          'text: the popover asks for suggested text',
          shape.placeholder === 'What should it say instead?' && shape.fieldLabel === 'Suggested text',
          JSON.stringify({ placeholder: shape.placeholder, field: shape.fieldLabel }),
        );
        record(
          'text: View on page lives in the popover',
          /View on page/.test(shape.switchLabel || ''),
          String(shape.switchLabel),
        );
        record(
          'text: Add to ticket is the popover action',
          shape.actions[0] === 'Add to ticket',
          JSON.stringify(shape.actions),
        );

        await page.evaluate(`(() => {
          const card = document.querySelector('.jiratack-capture-popover[data-kind="text"]');
          const input = card && card.querySelector('textarea');
          if (!input) return;
          input.value = 'Updated';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);

        const popoverSwitch = await pointFor('.jiratack-capture-popover[data-kind="text"] .jiratack-switch');
        const popoverSwitchInitial = await page.evaluate(
          "document.querySelector('.jiratack-capture-popover[data-kind=\"text\"] .jiratack-switch').getAttribute('aria-checked')",
        );
        record(
          'text: the popover preview switch is off by default',
          popoverSwitchInitial === 'false',
          String(popoverSwitchInitial),
        );

        if (popoverSwitch.ok) await clickAt(popoverSwitch);
        await sleep(200);
        const preview = JSON.parse(await page.evaluate(`(() => {
          const original = document.querySelector('.jiratack-text-preview-original');
          const replacement = document.querySelector('.jiratack-text-preview-replacement');
          const copy = document.getElementById('copy');
          return JSON.stringify({
            originalText: original ? original.textContent : null,
            replacementText: replacement ? replacement.textContent : null,
            originalDecoration: original ? getComputedStyle(original).textDecorationLine : null,
            originalColor: original ? getComputedStyle(original).color : null,
            replacementColor: replacement ? getComputedStyle(replacement).color : null,
            copyText: copy ? copy.textContent : null,
            bubble: !!document.querySelector('.jiratack-text-preview-bubble'),
            checked: document.querySelector('.jiratack-capture-popover[data-kind="text"] .jiratack-switch')
              ? document.querySelector('.jiratack-capture-popover[data-kind="text"] .jiratack-switch').getAttribute('aria-checked')
              : null,
          });
        })()`));
        record(
          'text: preview renders a red strikethrough inline',
          preview.originalText === 'Original'
            && String(preview.originalDecoration).includes('line-through')
            && preview.originalColor === 'rgb(191, 38, 0)'
            && preview.bubble === false,
          JSON.stringify(preview),
        );
        record(
          'text: preview inserts the green replacement',
          preview.replacementText === 'Updated'
            && preview.replacementColor === 'rgb(0, 102, 68)'
            && String(preview.copyText).startsWith('OriginalUpdated headline'),
          JSON.stringify(preview),
        );
        record(
          'text: the popover switch reflects the preview',
          preview.checked === 'true',
          String(preview.checked),
        );

        if (popoverSwitch.ok) await clickAt(popoverSwitch);
        await sleep(200);
        const hidden = JSON.parse(await page.evaluate(`(() => JSON.stringify({
          copyText: document.getElementById('copy').textContent,
          spans: document.querySelectorAll('.jiratack-text-preview').length,
          checked: document.querySelector('.jiratack-capture-popover[data-kind="text"] .jiratack-switch')
            ? document.querySelector('.jiratack-capture-popover[data-kind="text"] .jiratack-switch').getAttribute('aria-checked')
            : null,
        }))()`));
        record(
          'text: hiding the popover preview restores the page',
          hidden.copyText === baseline && hidden.spans === 0 && hidden.checked === 'false',
          JSON.stringify(hidden),
        );

        const addPoint = await pointFor('.jiratack-capture-popover[data-kind="text"] .jiratack-capture-actions .jiratack-button-primary');
        if (addPoint.ok) await clickAt(addPoint);

        const opened = await waitFor(
          () => page.evaluate("!!document.querySelector('.jiratack-new-ticket-form .jiratack-form')"),
          { timeout: 20000 },
        );
        record('text: Add to ticket opens the sidebar', opened === true, String(opened));

        const layout = JSON.parse(await page.evaluate(`(() => {
          const rect = (selector) => {
            const el = document.querySelector(selector);
            return el ? el.getBoundingClientRect() : null;
          };
          const pair = rect('.jiratack-textchange');
          const summary = rect('#jiratack-summary');
          const description = rect('#jiratack-description');
          const title = rect('.jiratack-textchange-title');
          const toggle = rect('.jiratack-textchange-toggle');
          const edit = rect('.jiratack-textchange-edit');
          const track = rect('.jiratack-textchange-toggle .jiratack-switch-track');
          const pairEl = document.querySelector('.jiratack-textchange-pair');
          const originalEl = document.querySelector('.jiratack-textchange-original');
          const pairStyle = pairEl ? getComputedStyle(pairEl) : null;
          const originalStyle = originalEl ? getComputedStyle(originalEl) : null;
          const sectionTitles = Array.from(document.querySelectorAll('.jiratack-form-section .jiratack-section-title'))
            .map((el) => el.textContent);
          return JSON.stringify({
            hasPair: !!pair,
            pairTop: pair ? Math.round(pair.top) : null,
            pairBottom: pair ? Math.round(pair.bottom) : null,
            summaryBottom: summary ? Math.round(summary.bottom) : null,
            descriptionTop: description ? Math.round(description.top) : null,
            original: document.querySelector('.jiratack-textchange-original')
              ? document.querySelector('.jiratack-textchange-original').textContent
              : null,
            suggested: document.querySelector('.jiratack-textchange-suggested')
              ? document.querySelector('.jiratack-textchange-suggested').textContent
              : null,
            edit: document.querySelector('.jiratack-textchange-edit')
              ? document.querySelector('.jiratack-textchange-edit').textContent
              : null,
            titleText: document.querySelector('.jiratack-textchange-title')
              ? document.querySelector('.jiratack-textchange-title').textContent
              : null,
            toggleText: document.querySelector('.jiratack-textchange-toggle')
              ? document.querySelector('.jiratack-textchange-toggle').textContent
              : null,
            hasContentTitle: sectionTitles.includes('Content'),
            titleLeft: title ? Math.round(title.left) : null,
            toggleLeft: toggle ? Math.round(toggle.left) : null,
            toggleRight: toggle ? Math.round(toggle.right) : null,
            editLeft: edit ? Math.round(edit.left) : null,
            cardLeft: pair ? Math.round(pair.left) : null,
            cardRight: pair ? Math.round(pair.right) : null,
            trackWidth: track ? Math.round(track.width) : null,
            pairWhiteSpace: pairStyle ? pairStyle.whiteSpace : null,
            pairTextOverflow: originalStyle ? originalStyle.textOverflow : null,
            switchExists: !!document.querySelector('.jiratack-textchange-toggle'),
            switchChecked: document.querySelector('.jiratack-textchange-toggle')
              ? document.querySelector('.jiratack-textchange-toggle').getAttribute('aria-checked')
              : null,
            summaryValue: document.getElementById('jiratack-summary')
              ? document.getElementById('jiratack-summary').value
              : null,
            counter: document.querySelector('.jiratack-counter')
              ? document.querySelector('.jiratack-counter').textContent
              : null,
            assigneeValue: document.getElementById('jiratack-assignee')
              ? document.getElementById('jiratack-assignee').value
              : null,
            activeId: document.activeElement ? document.activeElement.id || null : null,
            attachButtons: document.querySelectorAll('.jiratack-attach-row .jiratack-button').length,
            hasOldEditor: !!document.querySelector('.jiratack-textedit'),
            hasPopover: !!document.querySelector('.jiratack-capture-popover'),
          });
        })()`));

        record('text: the sidebar shows a compact text-change pair', layout.hasPair === true, String(layout.hasPair));
        record(
          'text: the pair shows Original → Suggested',
          layout.original === 'Original' && layout.suggested === 'Updated',
          `${layout.original} -> ${layout.suggested}`,
        );
        record(
          'text: the text-change card has no CONTENT wrapper',
          layout.hasContentTitle === false && layout.hasPair === true,
          JSON.stringify({ content: layout.hasContentTitle, pair: layout.hasPair }),
        );
        record(
          'text: the card top line is title, toggle, Edit',
          layout.titleText === 'Text change'
            && /View on page/.test(layout.toggleText || '')
            && layout.edit === 'Edit'
            && layout.titleLeft < layout.toggleLeft
            && layout.toggleRight < layout.editLeft,
          JSON.stringify(layout),
        );
        record(
          'text: the view toggle is larger and centered',
          layout.trackWidth >= 38
            && Math.abs(
              (layout.toggleLeft + layout.toggleRight) / 2
              - (layout.cardLeft + layout.cardRight) / 2,
            ) <= 20,
          JSON.stringify({
            track: layout.trackWidth,
            card: [layout.cardLeft, layout.cardRight],
            toggle: [layout.toggleLeft, layout.toggleRight],
          }),
        );
        record(
          'text: the pair wraps instead of truncating',
          layout.pairWhiteSpace === 'normal' && layout.pairTextOverflow !== 'ellipsis',
          JSON.stringify({ whiteSpace: layout.pairWhiteSpace, textOverflow: layout.pairTextOverflow }),
        );
        record('text: Edit is offered beside the pair', layout.edit === 'Edit', String(layout.edit));
        record(
          'text: View on page is offered in the form too',
          layout.switchExists === true && layout.switchChecked === 'false',
          JSON.stringify({ exists: layout.switchExists, checked: layout.switchChecked }),
        );
        record(
          'text: the pair sits between summary and description',
          layout.summaryBottom !== null
            && layout.pairTop !== null
            && layout.descriptionTop !== null
            && layout.pairTop >= layout.summaryBottom
            && layout.pairBottom <= layout.descriptionTop,
          JSON.stringify(layout),
        );
        record(
          'text: the summary is prefilled and visible',
          layout.summaryValue === 'Text change: Original' && layout.counter === '21/215',
          `${layout.summaryValue} ${layout.counter}`,
        );
        record(
          'text: Assignee leads and defaults from the previous ticket',
          layout.activeId === 'jiratack-assignee' && layout.assigneeValue === 'Previous Assignee',
          `active=${layout.activeId}, assignee=${layout.assigneeValue}`,
        );
        record('text: the old large editor is gone', layout.hasOldEditor === false, String(layout.hasOldEditor));
        record(
          'text: the composer is gone once the sidebar opens',
          layout.hasPopover === false,
          String(layout.hasPopover),
        );
        record('text: attach/record row is still present', layout.attachButtons === 2, String(layout.attachButtons));

        // The sidebar's sticky action bar can cover the lower content on a
        // short viewport; bring the pair into the open before clicking it.
        await page.evaluate(
          "document.querySelector('.jiratack-textchange').scrollIntoView({ block: 'center' })",
        );
        await sleep(150);

        const formSwitch = await pointFor('.jiratack-textchange-toggle');
        if (formSwitch.ok) await clickAt(formSwitch);
        await sleep(200);
        const formPreview = JSON.parse(await page.evaluate(`(() => JSON.stringify({
          original: document.querySelector('.jiratack-text-preview-original')
            ? document.querySelector('.jiratack-text-preview-original').textContent
            : null,
          replacement: document.querySelector('.jiratack-text-preview-replacement')
            ? document.querySelector('.jiratack-text-preview-replacement').textContent
            : null,
          checked: document.querySelector('.jiratack-textchange-toggle')
            ? document.querySelector('.jiratack-textchange-toggle').getAttribute('aria-checked')
            : null,
        }))()`));
        record(
          'text: the form switch previews the pair',
          formPreview.original === 'Original'
            && formPreview.replacement === 'Updated'
            && formPreview.checked === 'true',
          JSON.stringify(formPreview),
        );

        if (formSwitch.ok) await clickAt(formSwitch);
        await sleep(200);

        // Simulate a framework re-render: wrapping changes the text node path,
        // so the preview must fall back to locating the phrase again.
        await page.evaluate(`(() => {
          const copy = document.getElementById('copy');
          const text = copy.textContent;
          copy.innerHTML = '';
          const span = document.createElement('span');
          span.textContent = text;
          copy.appendChild(span);
        })()`);

        if (formSwitch.ok) await clickAt(formSwitch);
        await sleep(200);
        const afterRerender = JSON.parse(await page.evaluate(`(() => JSON.stringify({
          copyText: document.getElementById('copy').textContent,
          original: document.querySelector('.jiratack-text-preview-original')
            ? document.querySelector('.jiratack-text-preview-original').textContent
            : null,
          checked: document.querySelector('.jiratack-textchange-toggle')
            ? document.querySelector('.jiratack-textchange-toggle').getAttribute('aria-checked')
            : null,
          spans: document.querySelectorAll('.jiratack-text-preview').length,
        }))()`));
        record(
          'text: the form preview re-resolves after a page re-render',
          afterRerender.checked === 'true'
            && afterRerender.original === 'Original'
            && afterRerender.spans > 0
            && String(afterRerender.copyText).startsWith('OriginalUpdated headline'),
          JSON.stringify(afterRerender),
        );

        if (formSwitch.ok) await clickAt(formSwitch);
        await sleep(200);
        const hiddenAgain = JSON.parse(await page.evaluate(`(() => JSON.stringify({
          copyText: document.getElementById('copy').textContent,
          spans: document.querySelectorAll('.jiratack-text-preview').length,
        }))()`));
        record(
          'text: the form switch restores the page',
          hiddenAgain.copyText === baseline && hiddenAgain.spans === 0,
          JSON.stringify(hiddenAgain),
        );

        // Edit round-trip: the pair reopens the composer with Save.
        await page.evaluate(
          "document.querySelector('.jiratack-textchange').scrollIntoView({ block: 'center' })",
        );
        await sleep(150);
        const editPoint = await pointFor('.jiratack-textchange-edit');
        if (editPoint.ok) await clickAt(editPoint);
        const editOpened = await waitFor(() => page.evaluate(`(() => {
          const card = document.querySelector('.jiratack-capture-popover[data-kind="text"]');
          const save = card && card.querySelector('.jiratack-capture-actions .jiratack-button-primary');
          return card && save && save.textContent === 'Save' ? true : null;
        })()`), { timeout: 6000 });
        record('text: Edit reopens the composer with Save', editOpened === true, String(editOpened));

        await page.evaluate(`(() => {
          const card = document.querySelector('.jiratack-capture-popover[data-kind="text"]');
          const input = card && card.querySelector('textarea');
          if (!input) return;
          input.value = 'Updated again';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        const savePoint = await pointFor('.jiratack-capture-popover[data-kind="text"] .jiratack-capture-actions .jiratack-button-primary');
        if (savePoint.ok) await clickAt(savePoint);
        await sleep(300);
        const edited = JSON.parse(await page.evaluate(`(() => JSON.stringify({
          popoverGone: !document.querySelector('.jiratack-capture-popover[data-kind="text"]'),
          suggested: document.querySelector('.jiratack-textchange-suggested')
            ? document.querySelector('.jiratack-textchange-suggested').textContent
            : null,
        }))()`));
        record(
          'text: saving the edit updates the pair',
          edited.popoverGone === true && edited.suggested === 'Updated again',
          JSON.stringify(edited),
        );

        const typeReady = await waitFor(() => page.evaluate(`(() => {
          const select = document.getElementById('jiratack-issue-type');
          return select && !select.disabled && select.value ? true : null;
        })()`), { timeout: 8000 });
        record('text: issue types resolve for the create', typeReady === true, String(typeReady));

        servers.state.lastCreate = null;
        await page.evaluate("document.querySelector('.jiratack-form-actions .jiratack-button-primary').scrollIntoView({ block: 'nearest' })");
        const createPoint = await pointFor('.jiratack-form-actions .jiratack-button-primary');
        if (createPoint.ok) await clickAt(createPoint);
        const created = await waitFor(() => servers.state.lastCreate, { timeout: 20000 });

        record(
          'text: create stores the edited text change',
          Boolean(created)
            && created.textChange
            && created.textChange.original === 'Original'
            && created.textChange.suggested === 'Updated again',
          created ? JSON.stringify(created.textChange) : 'no call',
        );
        record(
          'text: create carries the assignee and parent defaults',
          Boolean(created)
            && created.assigneeAccountId === 'fixture-account-9'
            && created.parentKey === 'TEST-100',
          created ? `assignee=${created.assigneeAccountId} parent=${created.parentKey}` : 'no call',
        );

        const cardAppeared = await waitFor(() => page.evaluate(`(() => {
          const el = document.querySelector('.jiratack-ticket-card[data-key="TEST-9"] .jiratack-textchange-switch');
          return el ? true : null;
        })()`), { timeout: 15000 });
        record('text: the created ticket shows the text-change switch', cardAppeared === true, String(cardAppeared));

        const pair = await page.evaluate(`(() => {
          const el = document.querySelector('.jiratack-ticket-card[data-key="TEST-9"] .jiratack-ticket-textchange-pair');
          return el ? el.textContent : null;
        })()`);
        record(
          'text: the card shows Original → Suggested',
          Boolean(pair) && pair.includes('Original') && pair.includes('Updated again'),
          String(pair),
        );

        // JS click: the card may sit below the fold after the header version
        // stamp changed the layout; a synthesised mouse click can miss it.
        await page.evaluate("document.querySelector('.jiratack-ticket-card[data-key=\"TEST-9\"] .jiratack-textchange-switch').click()");
        await sleep(200);
        const cardPreview = JSON.parse(await page.evaluate(`(() => JSON.stringify({
          original: document.querySelector('.jiratack-text-preview-original')
            ? document.querySelector('.jiratack-text-preview-original').textContent
            : null,
          replacement: document.querySelector('.jiratack-text-preview-replacement')
            ? document.querySelector('.jiratack-text-preview-replacement').textContent
            : null,
          copyText: document.getElementById('copy').textContent,
          checked: document.querySelector('.jiratack-ticket-card[data-key="TEST-9"] .jiratack-textchange-switch')
            ? document.querySelector('.jiratack-ticket-card[data-key="TEST-9"] .jiratack-textchange-switch').getAttribute('aria-checked')
            : null,
        }))()`));
        record(
          'text: the card switch previews the stored change',
          cardPreview.original === 'Original'
            && cardPreview.replacement === 'Updated again'
            && cardPreview.checked === 'true'
            && String(cardPreview.copyText).startsWith('OriginalUpdated again headline'),
          JSON.stringify(cardPreview),
        );

        await page.evaluate("document.querySelector('.jiratack-ticket-card[data-key=\"TEST-9\"] .jiratack-textchange-switch').click()");
        await sleep(200);
        const cardHidden = JSON.parse(await page.evaluate(`(() => JSON.stringify({
          copyText: document.getElementById('copy').textContent,
          spans: document.querySelectorAll('.jiratack-text-preview').length,
          checked: document.querySelector('.jiratack-ticket-card[data-key="TEST-9"] .jiratack-textchange-switch')
            ? document.querySelector('.jiratack-ticket-card[data-key="TEST-9"] .jiratack-textchange-switch').getAttribute('aria-checked')
            : null,
        }))()`));
        record(
          'text: the card switch hides the preview',
          cardHidden.copyText === baseline && cardHidden.spans === 0 && cardHidden.checked === 'false',
          JSON.stringify(cardHidden),
        );

        // Re-open the overlay: the pair must come back from metadata.
        await page.evaluate('window.__jiratackClose()');
        await sleep(200);
        await page.evaluate(`window.__jiratackInit(${JSON.stringify(pageConfig)})`);
        const cardAfterReload = await waitFor(() => page.evaluate(`(() => {
          const el = document.querySelector('.jiratack-ticket-card[data-key="TEST-9"] .jiratack-textchange-switch');
          return el ? true : null;
        })()`), { timeout: 15000 });
        record('text: the switch survives a reopen from metadata', cardAfterReload === true, String(cardAfterReload));

        await page.evaluate("document.querySelector('.jiratack-ticket-card[data-key=\"TEST-9\"] .jiratack-textchange-switch').click()");
        await sleep(200);
        const reloadPreview = await page.evaluate(
          "!!document.querySelector('.jiratack-text-preview-replacement')",
        );
        record('text: the reopened switch still previews the change', reloadPreview === true, String(reloadPreview));

        // --- New Pin must not swallow a text selection (D36/D38) --------------
        const armed = await page.evaluate(`(() => {
          const btn = document.querySelector('.jiratack-pinmode-toggle');
          if (!btn) return null;
          btn.click();
          return btn.getAttribute('aria-pressed') === 'true';
        })()`);
        record('text: New Pin can be armed from the header', armed === true, String(armed));

        if (armed && selectionPoints.ok) {
          await page.send('Input.dispatchMouseEvent', {
            type: 'mousePressed', x: selectionPoints.startX, y: selectionPoints.startY, button: 'left', clickCount: 1,
          });
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: selectionPoints.startX + 3, y: selectionPoints.startY, button: 'left', buttons: 1,
          });
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: selectionPoints.endX, y: selectionPoints.endY, button: 'left', buttons: 1,
          });
          await page.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: selectionPoints.endX, y: selectionPoints.endY, button: 'left', clickCount: 1,
          });
          await sleep(500);
          const pillStill = await page.evaluate("!!document.querySelector('.jiratack-suggest-pill')");
          const pinComposer = await page.evaluate("(() => { return !!document.querySelector('.jiratack-capture-popover[data-kind=\"pin\"]'); })()");
          record(
            'text: arming New Pin does not swallow a text selection',
            pillStill === true && pinComposer === false,
            `pill=${pillStill}, pinComposer=${pinComposer}`,
          );
          // Disarm so the remaining assertions start from a clean state.
          await page.evaluate(`(() => {
            const btn = document.querySelector('.jiratack-pinmode-toggle');
            if (btn && btn.getAttribute('aria-pressed') === 'true') btn.click();
          })()`);
        } else if (armed === true) {
          record('text: arming New Pin does not swallow a text selection', false, 'selection points missing');
        }
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
