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

A content script runs in an **isolated world**, which the page's CSP does not
govern. It shares the DOM, so the overlay, pins, screenshots and the ticket form
all behave exactly as in the bookmarklet.

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
npm run build:extension  # assembles ./extension and ./dist/extension-firefox
```

`npm run build:extension` copies the built SDK into the extension, injects the
SDK version, and writes a per-browser `manifest.json`. It does not bundle code
at runtime: MV3 forbids remotely hosted code, so the SDK ships inside the
package.

## Install (development)

**Chrome / Edge** — `chrome://extensions` → enable *Developer mode* → *Load
unpacked* → select `./extension`.

**Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on*
→ select `dist/extension-firefox/manifest.json`.

**Safari** — requires Xcode once:

```text
sudo xcodebuild -runFirstLaunch
xcrun safari-web-extension-converter extension --app-name JiraTack \
  --bundle-identifier com.jiratack.extension --no-open
```

Then run the generated project from Xcode, and enable the extension in Safari →
Settings → Extensions.

## Configure

1. In JiraTack, copy the bookmarklet link for the canvas (the same link you
   would otherwise drag to the bookmarks bar).
2. Open the extension's options page and paste it. It carries the token and
   endpoints; the parser is `src/shared/extensionConfig.js` and rejects anything
   that is not a JiraTack link.
3. Click the toolbar icon on any page: overlay opens. Click again: it closes.

If the extension is not configured, the icon opens the options page instead.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Holds the canvas token and endpoints. |
| `scripting` | Injects the SDK into the tab you clicked. |
| `activeTab` | Grants access to that tab only, on your click. No `<all_urls>`. |

The SDK is injected **on demand**, not declared as a content script: the bundle
is ~290 KB and every open tab would pay for it while idle.

## Verified

Chromium 156, extension loaded, real pages (2026-11-02):

| Site | Bookmarklet | Extension |
| --- | --- | --- |
| `instagram.com` | Refused by CSP | SDK injected, overlay + sidebar rendered |
| `github.com` | Refused by CSP | SDK injected, overlay + sidebar rendered |
| `linkedin.com` | Refused by CSP | SDK injected, overlay + sidebar rendered |

The run used a verification build with `<all_urls>` because a headless browser
cannot click a toolbar icon to earn `activeTab`; the shipped manifest uses
`activeTab` only. Injection and DOM rendering were checked; ticket creation was
not, because it needs a live token.

## Not yet verified

- **Firefox** — manifest written for MV3 (`background.scripts`), not exercised.
- **Safari** — conversion blocked here pending `xcodebuild -runFirstLaunch`.
