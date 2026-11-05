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

The extension is connected from the JiraTack dashboard (D46), not by pasting a
link:

1. The dashboard's **Connect this browser** button calls `createExtensionLogin`;
   the resolver mints a single-use 120-second code bound to the signed-in Jira
   user and returns it with `apiUrl`/`sdkUrl`.
2. The dashboard posts the code to its parent window. A content script declared
   for Jira origins relays it to the background worker, which is the only part
   allowed to make the network call and write storage.
3. The background exchanges the code with `exchangeLoginCode` and stores the
   resulting 90-day credential in `chrome.storage.local`.

The credential is still a personal token: it carries the installation, the user,
the permitted projects/canvases and the admin claim resolved at issuance. The
extension holds one connection at a time; connecting a different installation
replaces it, and a stale `apiUrl` is repaired by connecting again.

## Host permissions

`host_permissions: ["<all_urls>"]` is deliberate (D40): it lets the background
re-inject the overlay after a navigation, and keeps `captureVisibleTab` working
outside the initial `activeTab` grant. The trade-off is the broad install
prompt. If that proves unacceptable, dropping to `activeTab` only removes the
cross-navigation reopen and the rename/visibility guarantees that depend on it.

## Guests

A guest installs the extension, opens the invitation link and accepts the
pre-filled **short code** (`JT-4F9K-2XQ7`) — or types it. The page exchanges the
code once for the guest credential and publishes `__jiratackConfig`, which is the
extension's normal enrolment path. Only the SHA-256 of the code is stored
(`guestCodeHashes:<hash>`), and the invitation is re-read on every exchange, so
revoke and pause take effect immediately rather than when a session expires.
Guest links last 90 days and pair up to 10 devices; each new link reconnects in
one step.

## Zero-click enrollment

The Chrome manifest lists `externally_connectable` for the Forge and Jira
origins, and the background accepts a `jiratack-enroll` message. The installer
page sends it when `EXTENSION_ID` is filled in (after publication). Until then
the toolbar click is the enrollment step.
