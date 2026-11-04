# Extension distribution and installation

JiraTack ships three delivery channels: the bookmarklet, the bookmarklet SDK
loaded by the browser extension, and the guest installer page. This note records
how the extension reaches a browser and what that means for admins and guests
(D22, D39, D40, D43).

## Can it be installed from the JiraTack dashboard?

**No.** Chrome blocks installing an extension from a web page outside the Chrome
Web Store; self-hosted `.crx` files are refused for normal users. Firefox
requires Mozilla-signed `.xpi` files. The dashboard therefore *links* to the
listings; it cannot install.

- **Chrome / Edge:** Chrome Web Store listing. Until it exists, the dashboard
  says the extension is not published and points at the bookmarklet.
- **Firefox:** a signed `.xpi` from addons.mozilla.org (an unlisted listing is
  enough). A direct link installs with one click — no store page.
- **Safari:** not supported in this release.

The URLs live in installation config (`chromeStoreUrl`, `firefoxXpiUrl`), edited
on the JiraTack admin page, so they can be filled in without a code change.

## Managed fleets

Chrome enterprises can push the extension with the `ExtensionSettings` policy
(`force_installed` / `normal_installed`) pointed at an update URL or the Web
Store listing. That is the only true zero-touch path and is the recommended
route for organisations that manage browsers. Firefox has an equivalent
`ExtensionSettings` policy.

## How the extension binds to an installation

There is no login inside the extension. On first use it copies a token from a
JiraTack page:

1. The page exposes `window.__jiratackConfig` (`token`, `apiUrl`, `sdkUrl`,
   `canvasId`, `canvasName`, `sdkVersion`).
2. The reviewer clicks the toolbar icon.
3. The background validates the token with a real `exchangeToken` against that
   `apiUrl`, then stores it in `chrome.storage.local`.

The token is the identity: it carries the installation, the user or guest, the
permitted projects/canvases and (for guests) the bound name and email. The
extension holds one connection at a time; a different installation triggers a
confirmation on the options page rather than a silent replacement.

## Host permissions

`host_permissions: ["<all_urls>"]` is deliberate (D40): it lets the background
re-inject the overlay after a navigation, and keeps `captureVisibleTab` working
outside the initial `activeTab` grant. The trade-off is the broad install
prompt. If that proves unacceptable, dropping to `activeTab` only removes the
cross-navigation reopen and the rename/visibility guarantees that depend on it.

## Guests

A guest installs the extension, opens the invitation link (which carries the
guest token) and clicks the toolbar icon on that page. The installer page
publishes `__jiratackConfig` itself, so no bookmarklet step is needed, and it
shows a green dot once the overlay starts. Guest links last 90 days and can be
revoked or paused at any time; each new link reconnects in one click.

## Zero-click enrollment

The Chrome manifest lists `externally_connectable` for the Forge and Jira
origins, and the background accepts a `jiratack-enroll` message. The installer
page sends it when `EXTENSION_ID` is filled in (after publication). Until then
the toolbar click is the enrollment step.
