# JiraTack extension

A browser extension that runs the JiraTack overlay on any page, including sites
whose security policy blocks a bookmarklet. Same SDK, same overlay, same
tickets — the delivery channel differs (D32).

## Why this exists

A bookmarklet is inline script. Where a page sets `script-src` with a nonce or
hash and no effective `'unsafe-inline'`, the browser refuses the `javascript:`
URL before any JiraTack code exists. That is not a JiraTack limitation:

- Chromium *"CSP: Bookmarklets should bypass pages' policies"* — open 2013,
  closed **Won't Fix (Infeasible)**, May 2026.
- Firefox Bugzilla 866522 — open since 2013.
- WebKit enforces the same inline check.

Injected code runs in the **page's world** — the same sandbox the bookmarklet
uses. The page's CSP does not govern programmatic extension injection, so the
channel works where a bookmarklet cannot, while `consoleProxy`, the published
globals and the layout debug hook behave identically. An isolated world was
rejected: it is tidier, but it silently breaks console capture.

## What works where

| Channel | Pages with no CSP | CMS / `'unsafe-inline'` sites | Nonce/hash CSP sites |
| --- | --- | --- | --- |
| Bookmarklet | Yes | Yes | **No** |
| Extension | Yes | Yes | **Yes** |

The extension is the only channel with full coverage. The bookmarklet remains
for users who cannot install anything.

## Build

```text
npm run build            # bundles the SDK
npm run icons            # regenerates extension/icons (only if the art changes)
npm run build:extension  # assembles dist/extension-chrome and dist/extension-firefox
```

`npm run build:extension` copies the built SDK into the extension, injects the
SDK version, and writes a per-browser `manifest.json`. It does not bundle code
at runtime: MV3 forbids remotely hosted code, so the SDK ships inside the
package.

## Install (development)

**Chrome** — `chrome://extensions` → enable *Developer mode* → *Load unpacked* →
select `./dist/extension-chrome`.

**Edge** — identical package, no separate build: `edge://extensions` → enable
*Developer mode* → *Load unpacked* → select `./dist/extension-chrome`.

**Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on*
→ select `dist/extension-firefox/manifest.json`.

**Safari** — not supported. No Safari package is built. The installer page
detects Safari and recommends Chrome, Edge or Firefox, because some sites block
the bookmarklet and Safari has no extension here to fall back on.

## Configure

1. Open the JiraTack dashboard in Jira and click **Connect this browser** in the
   browser-extension card (D46). The dashboard mints a one-time code; the
   extension trades it for a 90-day credential and stores it.
2. Click the toolbar icon on any page: overlay opens. Click again: it closes.

The options page keeps a paste box as **Repair connection** — the parser is
`src/shared/extensionConfig.js`, which rejects anything that is not a JiraTack
link. If the extension is not configured, the icon opens the options page.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Holds the credential and endpoints. |
| `scripting` | Injects the SDK into the tab you clicked, and the connect relay into Jira tabs that were open before installation. |
| `activeTab` | Grants access to the clicked tab. |
| `<all_urls` | Deliberate (D40): re-injects the overlay after a navigation and keeps `captureVisibleTab` working outside the initial `activeTab` grant. This is the broad install prompt the Web Store listing must justify. |
| content script (Jira origins) | `connect.js` relays the dashboard's one-time sign-in code to the background. It runs on `*.atlassian.net` and `*.hello.atlassian-dev.net` only, and cannot touch other origins. |

The SDK is injected **on demand**, into the page's world, not declared as a
content script: the bundle is ~290 KB and every open tab would pay for it while
idle. The only declared content script is the small sign-in relay above.

## Verified

Chromium 156, extension loaded, real pages (2026-11-02):

| Site | Bookmarklet | Extension |
| --- | --- | --- |
| `instagram.com` | Refused by CSP | SDK injected, overlay + sidebar rendered |
| `github.com` | Refused by CSP | SDK injected, overlay + sidebar rendered |
| `linkedin.com` | Refused by CSP | SDK injected, overlay + sidebar rendered |

The run used a verification build with `<all_urls>` because a headless browser
cannot click a toolbar icon to earn `activeTab`. The shipped manifest also
declares `<all_urls>` (D40) for the reasons in **Permissions** above. Injection
and DOM rendering were checked; ticket creation was not, because it needs a live
token.

## Browser status

| Browser | Package | Verified |
| --- | --- | --- |
| Chrome 156 | `./extension` | Injected on Instagram, GitHub, LinkedIn; overlay rendered |
| Edge | `./extension` | Same Chromium package; not separately run |
| Firefox 159 | `dist/extension-firefox` | Installs as a temporary add-on (`jiratack@local`); click path not exercised |

The remote debugging protocols cannot click a toolbar icon, so Firefox and
Safari are install/build-verified rather than click-verified. A manual click is
the last step on both.
