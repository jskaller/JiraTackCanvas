# SPEC.md — v3.1

**Status:** Current. Behaviour of shipped code only.
**Verified against:** tag `baseline/pre-pivot-2026-10-30` (2026-10-30), app 5.0.0, SDK `b975e80725d7`.
**Supersedes:** SPEC.md v2.3 in full; v3.1 adds D23 (page identity and match modes).

**Precedence.** `CONTRACTS.md` wins on wire-level details (shapes, signatures, error codes, manifest, `package.json`). `DECISIONS.md` wins on any question, open or closed. This document wins on product behaviour.

**Scope.** This document describes the Forge app, the bookmarklet SDK, and the browser extension as built. The extension (D22, D32, D39) is a CSP-resilient companion channel: the SDK runs in the page's MAIN world injected by the extension's background, with an isolated-world bridge for the extension APIs. Enrollment and update behaviour is described in §2.4 and D39.

**Version history.**

| Version | Date | Change |
| --- | --- | --- |
| v3.1 | 2026-10-30 | Page identity: three-step normaliser with a keep-list, canonical URL storage, reviewer-side Smart/Exact/Whole-page match modes (D23). |
| v3.0 | 2026-10-30 | Rewritten against shipped code. Issue-property metadata (D18), per-operation authorisation (D19), chunked screenshot upload and URL allowlist (D20), issuance-bound admin claim (D21), guest links, personal bookmarklet, dual layout modes (D17), real action and error inventories. Removed: custom fields, field provisioning, mapping audit, description marker, recovery, build order, phase test plans, open decisions. |
| v2.3 | 2026-10-23 | Two-scope token model (`create` / `view`), custom-field pin index. |
| v2.2, v1.1 | — | Superseded. |

---

## 1. Product overview

JiraTack is a single-part product: an Atlassian Forge app, Marketplace listed, installed once by a Jira admin. It has no external proxy and no public-facing infrastructure beyond its own web triggers.

**What it does:**

- Lets QA and content teams drop visual pins on a web page and turn them into Jira tickets in one action.

- Uses a `javascript:` bookmarklet as the on-page client. Bookmarklets are generated inside Jira and dragged to the bookmarks bar once.

- Stores every pin as a Jira ticket. Machine-readable pin data lives in the Jira issue property `com.jiratack.metadata`; the `jiratack` label is the query index. There is no separate pin store.

- Exposes five in-Jira surfaces — a **canvas dashboard**, an **epic panel**, an **issue panel**, an **admin page**, and a **project settings page** — so the whole team can browse reviews without installing anything.

- Offers three client channels from the same SDK:

  | Channel | Minted by | Bound to | Lifetime |
  | --- | --- | --- | --- |
  | Canvas bookmarklet | `generateCanvasToken` | One canvas | 30 days |
  | Personal bookmarklet | `generateUserToken` | The issuing user, launcher picks a canvas | 90 days |
  | Guest link | `generateGuestToken` | One named reviewer, delegated by the issuer | link 90 days; access until revoked |

**What it explicitly is not:**

- Not a proxy. It does not fetch, rewrite, or render arbitrary web pages server-side.

- Not a seat-sharing loophole. Every write carries a scope; guest tokens are confined to their permitted canvases and projects, and are always non-admin.

- Not dependent on any backend other than the Forge app.

---

## 2. Tech stack

**Forge app:**

- Atlassian Forge, `nodejs24.x` runtime (24 is active LTS; 22 is maintenance LTS).

- JavaScript only — no TypeScript, no Python.

- Forge UI Kit (JSX/React) for the admin page, project settings page, epic panel, and issue panel.

- Forge Custom UI (React + Vite) for the canvas dashboard only.

- Forge functions: one resolver function and three web trigger functions (`webtrigger-api`, `webtrigger-sdk`, `webtrigger-install`).

- `@forge/kvs` for all storage.

- `jsonwebtoken` for HS256 session signing.

- No scheduled trigger. Visibility is a status rule applied in `getPins`, not a job (D38).

**Bookmarklet SDK:**

- Vanilla JavaScript, no framework.

- Vite produces one minified `.js` bundle, embedded into `src/lib/sdk-bundle.js` at build time by `scripts/embed-sdk.js`.

- `html2canvas` bundled for screenshot capture.

- Inline CSS (no Tailwind in the bookmarklet).

- No persistent state except `sessionStorage` (session JWT, layout mode, navigation state).

**Not used:** Python, external CDN, a second deployable, Forge Containers, `external.fetch.backend` (removed — see D16).

---

## 3. Architecture

### 3.1 One deployable, four functions, three web triggers

```text
FORGE APP (single deployable, nodejs24.x)
  Surfaces
    jira:globalPage            → Canvas dashboard (Custom UI)
    jira:issuePanel (Epic)     → Epic panel (UI Kit)
    jira:issuePanel (any)      → Issue panel (UI Kit)
    jira:projectSettingsPage   → Project configuration (UI Kit)
    jira:adminPage             → Installation configuration (UI Kit)
  Modules
    jira:entityProperty        → indexes com.jiratack.metadata.pin.canvas as `jiratackCanvas`
  Functions
    resolver                   → all in-Jira resolvers
    webtrigger-api             → POST <wt>/api, all client actions
    webtrigger-sdk             → GET  <wt>/*, minified SDK bundle
    webtrigger-install         → GET  <wt>/*?token=…, public guest installer page (HTML)
  Storage (@forge/kvs)
    installationConfig
    canvasTokens:<token>       (canvas + guest records)
    userTokens:<token>
    jiratack_licensed_users:<accountId>
    sessionSigningSecret
    screenshot:<uploadId>[:NNN]
```

### 3.2 The single core principle

**Jira tickets are the pin store.** Every pin is a ticket. Creating a pin = create issue. Querying pins = search on `labels = "jiratack"` plus the issue property. Updating = update issue. Retiring = filtering. There is no parallel store to synchronise.

The property is the machine-readable truth; the description is for humans.

### 3.3 Channels, scopes, and where each is enforced

| Token | Scope value | Issued where | Gate at issuance | Enforced where |
| --- | --- | --- | --- | --- |
| Canvas token (`create`) | `create` | `generateCanvasToken` resolver | Seat (`userAccess.hasAccess !== false`) and browse access to the canvas | Token existence, then JWT `scope` |
| Canvas token (`view`) | `view` | `generateCanvasToken` resolver | Browse access to ≥1 canvas ticket (`NO_CANVAS_ACCESS` otherwise) | JWT `scope` |
| Personal token | `create` or `view` | `generateUserToken` resolver | Seat; `view` when the user has no seat | JWT `scope` |
| Guest token | `guest_create` | `generateGuestToken` resolver | Seat + 1–50 permitted canvases | JWT `scope`, `permittedCanvases`, `permittedProjects` |
| Session JWT | inherits | `exchangeToken` web trigger | Token record valid + installation licensed | Every API call |

Web triggers have no user identity and never call `userAccess` or `api.asUser()`. They enforce the JWT `scope`, the `permittedProjects`/`permittedCanvases` claims, and for admin-only actions the `isAdmin` claim.

**`universal` is vestigial.** `src/webtrigger/api.js` still lists `universal` in several action allowlists, and the SDK treats `scope === 'universal'` as write-capable, but no token generator ever mints it. The string `universal` also appears as `canvasId` to mark the personal launcher; that is a different thing. Cleanup is tracked in the security review ledger; this document does not describe `universal` as a scope.

### 3.4 Removed since v1.1

Extension-era client code, `jiratack://` protocol, pairing flow, config-bundle encryption (AES-GCM, PBKDF2), KVS pin records, KVS URL index, the retirement scheduler and `retirementDays` (replaced by the status rule, D38), `doneAt` timestamps, message-passing handler map. Also removed after v2.3: Jira custom fields, field provisioning, the field mapping audit, the description marker, and recovery from descriptions (D18).

### 3.5 What survives

Canvas-token model (extended), Jira API conventions, admin configuration, license gating, visual pin design, `jiratack` label on every created ticket.

---

## 4. Pin metadata and labels

### 4.1 Issue property

Machine data lives in the issue property `com.jiratack.metadata`:

```json
{
  "bindingId": "9f2c…64 hex…",
  "guest": { "name": "Ada Lovelace", "email": "ada@example.com" },
  "pin": {
    "canvas": "Q3 Marketing",
    "url": "https://example.com/pricing?variant=b",
    "position": "45.2,32.8",
    "selector": "#hero-image"
  },
  "version": 1
}
```

- `bindingId` is present on guest tickets once the reviewer binding exists (D27). It is the HMAC of the normalised email, so it can be recomputed; absence means a legacy ticket.

- `guest` is present only on guest-created tickets.

- `selector` is `null` when no stable selector was found.

- `version` is `1` in this release.

**Validation on write.** An object is treated as JiraTack metadata only if `pin.canvas`, `pin.url`, and `pin.position` are all non-empty strings. Anything else is ignored on read; writes are rejected with `VALIDATION_ERROR`.

### 4.2 Labels

- `jiratack` — applied to every ticket JiraTack creates. It is the query index, not decoration.

- `jiratack-guest` — applied additionally to guest tickets. Additive; it never replaces `jiratack`.

Every read path searches `labels = "jiratack"` and filters on the property in memory.

### 4.3 Search alias

`manifest.yml` declares a `jira:entityProperty` module that indexes `pin.canvas` as the search alias `jiratackCanvas`. This is the only property indexed for JQL. Indexing is not retroactive: tickets created before the property existed, or before the module was deployed, may not be indexed.

### 4.4 No migration, no marker

There is no backfill and no description marker. Tickets without `com.jiratack.metadata` are simply not JiraTack tickets, and do not appear in the dashboard, panels, or overlay. Descriptions contain no machine-readable payload.

---

## 5. Authentication

### 5.1 Tokens and sessions

| Token | Lifetime | Scope(s) | Stored | Issued by |
| --- | --- | --- | --- | --- |
| Canvas token | 30 days | `create`, `view` | Embedded in the bookmarklet URL | `generateCanvasToken` |
| Personal token | 90 days | `create`, `view` | Embedded in the bookmarklet URL | `generateUserToken` |
| Guest token | Link 90 days; pairings until revoked | `guest_create` | A short typed code; the invite token stays server-side | `generateGuestToken` |
| Session JWT | 8 hours | Inherited | `sessionStorage` | `exchangeToken` web trigger |

### 5.2 Issuance rules

**`generateCanvasToken(canvasName, scope)`**

1. `canvasName` must be 1–255 characters; `scope` must be `create` or `view` (else `BAD_REQUEST`).

2. For `create`: `context.userAccess.hasAccess === false` → `LICENSE_INACTIVE`, no token.

3. `permittedProjects` is computed from the viewer's browse-accessible projects, intersected with the projects present in the canvas; empty intersection → `NO_CANVAS_ACCESS`.

4. The record stores `isAdmin` (D21), `permittedProjectsJson`, `scope`, `userId`, `installationId`, `issuedAt`, `expiresAt`.

5. Returns `{ token, sessionJwt, apiUrl, sdkUrl, sdkVersion, canvasId, canvasName, scope, permittedProjects }`.

**`generateUserToken()`**

1. Seat check is *not* a hard gate: `userAccess.hasAccess === false` mints a `view` token instead of `create`.

2. `permittedProjects` is computed across all canvases (no canvas intersection).

3. 90-day TTL. Returns `{ token, apiUrl, sdkUrl, sdkVersion }` with no canvas binding; the bookmarklet opens the launcher.

**`generateGuestToken(permittedCanvases, guestName, guestEmail)`**

1. Requires a seat (`hasAccess !== false`) → else `LICENSE_INACTIVE`. Guest links are seat-gated, **not** admin-gated (D19).

   `guestName` and `guestEmail` are required: the sponsor names the reviewer at issuance, and the binding is created then in state `issued` (D29). The guest never enters identity in the sidebar.

2. `permittedCanvases` must be 1–50 distinct names of 1–255 characters.

3. Record is `scope: 'guest_create'`, `issuer`, `isAdmin: false`, `permittedCanvases`, `permittedProjectsJson`, `mintedAfterCutover: true`, 90-day link expiry (D43).

4. Returns `{ token, code, installerUrl, scope, permittedCanvases, permittedProjects, expiresAt }`. `code` is a short typed credential (`JT-4F9K-2XQ7`) and only its SHA-256 is stored (D46); `installerUrl` is the install web trigger with `?code=…`. The full invite token is never shown to the guest.

### 5.3 Exchange flow

1. The bookmarklet carries `{ token, apiUrl, sdkUrl, canvasId, canvasName, sdkVersion }`.

2. The SDK checks `sessionStorage` for a JWT for this canvas; if valid, it is used.

3. Otherwise `POST /api { action: 'exchangeToken', payload: { canvasToken } }`.

4. The web trigger looks up `userTokens:<token>`, then `canvasTokens:<token>`; rejects missing (`TOKEN_INVALID`), revoked (`TOKEN_INVALID`), or expired (`TOKEN_EXPIRED`) records.

5. It mints an HS256 JWT and returns `{ sessionJwt, expiresAt, canvasId, canvasName, scope, permittedProjects, isAdmin, displayName, apiUrl, sdkUrl, jiraBaseUrl, configVersion }`, plus `issuer` and `permittedCanvases` for guest tokens.

6. The SDK stores the JWT in `sessionStorage` and retries once with a forced exchange on `TOKEN_EXPIRED`/`TOKEN_INVALID`.

### 5.4 Claims

| Claim | Meaning |
| --- | --- |
| `iss` | `jiratack` |
| `sub` | Issuing user's `accountId` (for guests, the issuer's) |
| `aud` | Installation id |
| `scope` | `create`, `view`, or `guest_create` |
| `canvasId`, `canvasName` | Canvas binding, when the token is canvas-bound |
| `permittedProjects` | Array of project keys, or `"*"` under `viewPermissionMode: "open"` |
| `permittedCanvases` | Guest tokens only |
| `issuer` | Guest tokens only |
| `isAdmin` | Resolved at issuance; **guests are always `false`** |
| `iat`, `exp` | 8-hour session |

**Fail closed.** A missing `isAdmin` claim is treated as `false`, so tokens issued before D21 cannot perform admin-only actions until re-issued.

### 5.5 Revocation and listing

- `listCanvasTokens` returns `{ tokenRef, canvasName, userId, scope, issuedAt, expiresAt, revoked }` for up to 1000 `canvasTokens:*` records.

- `tokenRef` is a SHA-256 prefix (12 hex characters). Raw bearer tokens are never returned by any resolver.

- `revokeCanvasToken` deletes the record, accepting `tokenRef` or a raw `token` for programmatic callers.

- Guest records have no `canvasName` or `userId`; they appear with those fields undefined and carry `scope: "guest_create"`.

- **Revocation lag:** a live session JWT stays valid until `exp` (≤8 h). This is accepted (D11) and mitigated by automatic re-exchange.

### 5.6 KVS record shapes

```text
canvasTokens:<token> → {
  canvasName?, userId? | issuer, installationId, scope: "create"|"view"|"guest_create",
  isAdmin, permittedProjectsJson, permittedCanvases?, issuedAt, expiresAt, revoked
}
userTokens:<token>  → { userId, installationId, scope, isAdmin, permittedProjectsJson,
                        issuedAt, expiresAt, revoked }
jiratack_licensed_users:<accountId> → true
sessionSigningSecret → string
canvas:<key> → { key, name, names, folder, archived, thumbnail?, thumbnailAt?, thumbnailVersion?, thumbnailNote? }
canvasName:<safe-suffix> → { name, canvasKey }  // every name the canvas has ever had
canvasName:<normalised> → <key>            // pre-5.87 shape, still read
canvasPreviewStamp → number                // changes whenever a preview is written or cleared
canvasPreviewCache → { stamp, previews: { <key>: dataUrl } }   // ≤ 120k chars, else absent
canvasRegistryStamp → number               // changes whenever a record is written or deleted
canvasRegistryCache → { stamp, records, index }  // launcher snapshot, no preview data
```

The signing secret is created with `keyPolicy: 'FAIL_IF_EXISTS'` (the KVS API's actual compare-and-set; the older `must_be_missing` option is not supported and silently degraded to an overwrite until 2026-10-31). It is currently stored as a plain KVS value, not with `kvs.setSecret`; migration is tracked in the security review.

---

## 6. Bookmarklet SDK

### 6.1 Delivery and bootstrap

```text
GET <sdkUrl>?v=<sdkVersion>
  → 200 text/javascript
  → body: minified SDK bundle (284,164 bytes at this build)
```

`<sdkUrl>` and `<apiUrl>` are separate web triggers and are never derived from one another (D10).

The `javascript:` bookmarklet body is roughly 3,500 characters (3,495 measured with a 64-character token), most of it the bootstrap's failure card, and it is a bootstrap that:

1. Embeds `{ token, apiUrl, sdkUrl, canvasId, canvasName, sdkVersion }`.

2. If `window.__jiratackActiveCanvas === canvasId`, calls `window.__jiratackClose()` and exits (toggle).

3. Appends a centred "JiraTack is opening…" spinner.

4. Injects `<script src="{sdkUrl}?v={sdkVersion}">`.

5. On `load`, verifies `window.__jiratackInit` is a function, clears the bootstrap, and calls it.

6. If the external script fails, **falls back to fetching the bundle and injecting it as an inline `<script>`** (D31). This succeeds wherever the page allowed the bookmarklet itself to run — it needs `'unsafe-inline'`, which that already required — and needs no `'unsafe-eval'`. No popup, no iframe, no `eval`; screenshots and the overlay are unaffected because the code runs in the page's own context.

7. If both deliveries fail — a refused download, inline scripts refused by the page, a synchronous throw on `s.src` or `script.textContent` (Trusted Types), a bundle that loaded without `__jiratackInit`, or a 15-second timeout — replaces the spinner with an in-page card: "JiraTack could not start here", a reason, and a Dismiss button. The reason names the step that failed rather than assuming CSP. Every failure is also logged as `[JiraTack] …` for diagnosis.

The exchange response carries the live `currentSdkVersion` and the installer `installUrl`. When the bookmark's baked-in `sdkVersion` differs, the sidebar shows "This bookmarklet is out of date" plus a refresh link that rebuilds the installer URL from the composite token, preserving the invitation and pairing.

What each layer covers, measured 2026-11-02 (D22 amendment):

- **External script refused, fallback works** — `montefioreeinstein.org` and the enterprise-CMS class: the bookmarklet runs and the page sets no `default-src`/`connect-src`, so the bundle can be fetched and inlined (verified live, 290 KB bundle).
- **Bookmarklet itself refused** — `github.com`, `developer.mozilla.org`, `mail.google.com`, `outlook.office.com`, `app.asana.com`, `linkedin.com`, `x.com`, `stripe.com`, `paypal.com`, `wellsfargo.com`, `discord.com`, `linear.app`, `airbnb.com`. `script-src` with a nonce or hash makes the `javascript:` URL illegal, so none of our code exists. Only the extension channel (D22) covers these.
- **Fetch refused while inline is allowed** — a locked `default-src`/`connect-src` leaves no way to obtain the code, and `eval` would not help because there is nothing to evaluate. `en.wikipedia.org` (article pages) and `epic.com` are examples.

**Version coupling.** `sdkVersion` is a content hash (D13). Bookmarks embed the version at generation time, so an SDK change requires re-dragging the bookmarklet; an old bookmark keeps requesting the old hash.

### 6.2 SDK responsibilities

1. Wrap `console.error` and `console.warn` immediately on init, before any `await`.

2. Exchange the token for a session JWT if none is cached.

3. Load pins for the canvas (whole-canvas fetch), then match them to the current page client-side using the selected match mode, or list canvases in launcher mode.

4. Render the fixed overlay, pins, sidebar, and toast container.

5. Apply scope-aware rendering: `create` and `guest_create` get pin mode and inline edit; `view` is read-only.

6. Handle pin capture, ticket creation, and inline edits.

7. Toggle closed when the bookmarklet is clicked again.

8. Listen for `pushState`, `replaceState`, and `popstate`, debounced 300 ms, and re-query for the new URL.

9. On close, remove all `jiratack-*` elements, restore console functions, remove listeners, and clear module state.

No `localStorage`. Persisted values are `sessionStorage` only: the JWT, the layout mode, and the navigation state.

### 6.3 Overlay structure

```text
#jiratack-overlay              position:fixed; inset:0; pointer-events:none; z-index:2147483647
  #jiratack-pins               absolute inset:0
    .jiratack-pin[data-key]    absolute, pointer-events:auto
    .jiratack-detached-cluster pins whose position could not be restored
  #jiratack-sidebar            fixed right:0; width:320px; height:100vh
    .jiratack-sidebar-header   title, badges, layout switch, close
    .jiratack-filter-toggle    All / This page
    .jiratack-ticket-list
      .jiratack-ticket-card[data-key]
    .jiratack-new-ticket-form
  #jiratack-toast-container
```

The overlay is fixed so pins are immune to CSS transforms on `body` or ancestors.

### 6.4 Layout modes (D17)

- **Actual size (push, default):** sets `<html>` `margin-right: 320px`, shifts viewport-anchored `position: fixed` elements left by 320 px, and observes mutations to catch new ones.

- **Fit page:** scales `<body>` by `(viewport − 320) / viewport` with origin top-left, floor `0.5`; mounts the overlay on `<html>` so the sidebar stays 1:1; compensates with a negative `margin-bottom` of `scrollHeight × (1 − scale)`.

- Below the floor, Fit falls back to Actual size with a toast.

- The choice is persisted in `sessionStorage` under `jiratack_layout_mode`.

### 6.4b Extension enrollment and config currency (D39)

- While the SDK runs, it exposes a safe, token-bearing view of its config at `window.__jiratackConfig` (`token`, `apiUrl`, `sdkUrl`, `canvasId`, `canvasName`, `sdkVersion`). The same token already crossed the page via the bootstrap, so nothing new is exposed.

- **Enrolling is one click:** clicking the JiraTack toolbar button on a page where an overlay is live makes the background read that view, **verify it against the real API first** (a real `exchangeToken` call must return `ok: true`), store it, and open the overlay — no bookmarks bar, no paste.

- **Stale-config repair is the same click.** When the stored config's `apiUrl` or token differs from the page's, the page's config wins after verification; a config whose exchange fails keeps the stored one. Malicious or mistaken page configs are rejected by that verification, so the extension can only hold a config the real API accepted.

- Nothing stored and no live overlay → the options page opens: the paste path remains as the repair fallback, labelled "Canvas link (repair path)".

- A failed token exchange that receives non-JSON (typically a stale `apiUrl` answering HTML or JavaScript) reports the URL and the response type it reached, not a bare "invalid response".

- **Overlay continuity across one navigation (D40).** When the reviewer clicks a ticket that lives on another URL, the extension asks the background to carry the overlay to that page: after the navigation completes, the background re-injects the bridge and SDK and re-initialises with the stored config, so the overlay comes back on the new page with the ticket selected. This needs `host_permissions` (`<all_urls>`), because Chrome revokes `activeTab` on navigation. The carry flag is one-shot: it is cleared when used, when the toolbar closes the overlay, or when the tab closes, so ordinary browsing never carries the overlay along.

- **API transport through the bridge (extension, D43).** Page `connect-src` CSP applies to scripts in the page's world, so the SDK's own `fetch` could be blocked even while the overlay works ("Failed to fetch"). Extension API calls are relayed through the isolated-world bridge to the background, which fetches only the configured `apiUrl`. The bookmarklet posts directly and reports the URL when the network refuses.

- **Viewport presets (extension only).** The bar at the bottom-left sets a real window width (preset + browser chrome + 320 px sidebar) through the bridge; **Fit** restores the previous width *and* the previous window state. A maximised or full-screen window is normalised to `normal` before resizing, because Chrome ignores width changes otherwise. When Chrome still refuses the size, the change is reported back and the sidebar shows a toast rather than failing silently.

### 6.5 Personal (launcher) bookmarklet

When `canvasId` is `universal`, the SDK does not bind to a canvas. It calls `listCanvasesForUser`, shows a "JiraTack Launcher" sidebar, and:

- Auto-selects the single canvas that contains the current URL, if exactly one does.

- Otherwise lists canvases to choose from.

- Lists every accessible canvas with **name and key**, and shows a filter box once there are more than six (D43).

- Offers "Create canvas" when the session scope is not `view` (the server still enforces admin rights).

### 6.6 Guest bookmarklet

A guest session renders only its `permittedCanvases`, in a dropdown, and defaults to the first. If the list is empty the sidebar shows "No canvases are available for this link." The guest cannot switch canvases or create one.

### 6.7 Navigation, filters, deep links

- The filter toggle switches between all pins in the canvas and pins for the current page only.

- Selection and filter survive cross-page navigation in `sessionStorage` under `jiratack_nav_state`, and are cleared once consumed.

- **Selecting a ticket in the sidebar (click or ↑/↓) scrolls the page so the pin sits in the middle of the viewport**, and the card is scrolled into view in the list. Hovering a card only highlights the pin. Clicking a pin on the page never scrolls. The scroll is derived from the pin's anchor (selector + percentages, or stored pixels); a detached pin has no page position, so only the card moves.

- Clicking a ticket on another page:
  - **bookmarklet:** a 3-second notice, then the tab navigates and the user must re-open the bookmarklet;
  - **extension (D40):** a 400 ms notice, then the tab navigates and the background re-injects the overlay on the new page automatically — the carry applies to that one navigation only. Plain navigation in a tab that happens to have had the overlay does not reopen it.

- `jiratack_ticket` and `jiratack_canvas` URL parameters are consumed and stripped before querying (§12.3).

---

## 7. Web trigger API

**Base:** `POST <apiUrl>`, JSON body `{ action, payload }`. Non-POST → `BAD_REQUEST`.

### 7.1 Envelope and errors

```text
{ ok: true,  data: <shape> }
{ ok: false, error: { code, message, details? } }
```

| Code | HTTP | Meaning |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformed request |
| `TOKEN_INVALID` | 401 | Token missing, revoked, or unknown |
| `TOKEN_EXPIRED` | 401 | Token past `expiresAt` |
| `INSUFFICIENT_SCOPE` | 403 | Scope, canvas, project, or admin claim denies the call |
| `LICENSE_INACTIVE` | 403 | Installation or seat not licensed |
| `NO_CANVAS_ACCESS` | 403 | No browse access to any canvas ticket |
| `NOT_FOUND` | 404 | Record not found |
| `CANVAS_NOT_EMPTY` | 409 | Delete refused: open tickets remain |
| `PROJECT_DISABLED` | 422 | JiraTack disabled for the project |
| `VALIDATION_ERROR` | 422 | Invalid input or Jira rejected the payload |
| `INTERNAL` | 500 | Unhandled failure |

### 7.2 Actions

| Action | Allowed scopes | Extra gate |
| --- | --- | --- |
| `exchangeToken` | none (token in payload) | Token record valid |
| `getPinsForCanvasAndUrl` | `create`, `view`, `guest_create` | `canAccessCanvas` |
| `createIssue` | `create`, `guest_create` | `canAccessCanvas`, `canAccessProject` |
| `updateIssue` | `create`, `guest_create` | `canAccessCanvas`, `canAccessProject` |
| `updatePinPosition` | `create`, `universal`, `guest_create` | `canAccessCanvas`, `canAccessProject` |
| `getTransitions` | `create`, `view`, `guest_create` | `canAccessCanvas` |
| `searchUsers` | `create`, `guest_create` | — |
| `getPriorities` | `create`, `guest_create` | — |
| `getIssueTypes` | `create`, `guest_create` | — |
| `listCanvasesForUser` | `create`, `view` | — |
| `createCanvas` | `create` | **`isAdmin` claim** (D21) |
| `beginScreenshotUpload` | `create`, `guest_create` | — |
| `uploadScreenshotChunk` | `create`, `guest_create` | Upload owner must match `sub` |

Guests are excluded from `listCanvasesForUser`: their canvas list comes from the JWT. Guest writes are confined to `permittedCanvases`.

### 7.3 Pin record

```json
{
  "key": "MM-1234",
  "summary": "[JiraTack] Hero image misaligned",
  "projectKey": "MM",
  "status": { "name": "In Progress", "category": "indeterminate", "colorName": "yellow" },
  "priority": { "id": "3", "name": "Medium" },
  "priorityId": "3",
  "issueTypeId": "10001",
  "assignee": { "accountId": "...", "displayName": "Sam", "avatarUrl": "..." },
  "reporter": { "accountId": "...", "displayName": "Kim", "avatarUrl": "..." },
  "pinPosition": "45.2,32.8",
  "selector": "#hero-image",
  "issueType": { "name": "Bug" },
  "createdAt": "2026-01-15T10:30:00.000Z",
  "url": "https://example.com/pricing",
  "guest": null
}
```

`priority`, `assignee`, and `reporter` are `null` when unset. `guest` carries `{ name, email }` on guest tickets.

### 7.4 `getPinsForCanvasAndUrl`

```text
jql: labels = "jiratack"
     ORDER BY created ASC
properties: ["com.jiratack.metadata"]
fields: summary, status, priority, assignee, reporter, issuetype, created, project
```

Filtering happens in memory: canvas match, `permittedProjects`, and the status rule (§17). Issues whose status is literally named `Removed` are never returned. Remaining issues are returned with `filtered: true/false` computed from that issue's own project's rule. URL matching is applied by the client at render time; the server only matches URLs when `all` is false.

- Scans up to 2,000 issues across pages of 100.

- Returns `{ pins, canvasName, configVersion, truncated }`.

- `truncated` is `true` when the scan cap stopped before the result set ended — the list may be partial, and the client is expected to say so rather than imply completeness.

### 7.5 `createIssue`

Client payload:

```text
{ canvasId, url, pinPosition, selector, summary, descriptionAdf, screenshotUploadId,
  consoleLog, issueTypeId, projectKey, priorityId, assigneeAccountId, parentKey }
```

Server:

1. Validates required fields (`canvasId`, `url`, `pinPosition`, `summary`, `issueTypeId`, `projectKey`).

2. Guest branch: identity is resolved from the `pairingId` claim → invitation, never from the payload. The pairing and invitation must both be active. `assigneeAccountId` is required and must belong to a licensed JiraTack user (`jiratack_licensed_users:*`).

3. `canAccessProject(claims.permittedProjects, projectKey)` → `INSUFFICIENT_SCOPE`.

4. Project config `enabled === false` → `PROJECT_DISABLED`.

5. Normalises the URL and rejects anything not `http(s)` after normalisation.

6. Prefixes the summary with `[JiraTack]` (idempotent).

7. Builds the description.

8. Sets `labels: ["jiratack"]` plus `jiratack-guest` for guests; sets `reporter` from `claims.sub` for non-guests only; adds `priority`, `assignee`, `parent` when supplied.

9. Creates the issue with `overrideScreenSecurity=true&overrideEditableFlag=true`.

10. Writes `com.jiratack.metadata` with one retry. On persistent failure the ticket still exists and is returned with `warning: "metadata-not-stored"` — surfaced to the user, never silent.

11. Assembles and attaches the screenshot if `screenshotUploadId` is present; upload records are deleted either way.

12. Returns `{ key, id, configVersion, warning? }`.

Jira 400/422 is mapped to `VALIDATION_ERROR` with Jira's `errorMessages` and `errors` in `details`. There is no field-dropping retry: no JiraTack-created field exists to drop.

### 7.6 Screenshot upload (D20)

| Action | Payload | Result |
| --- | --- | --- |
| `beginScreenshotUpload` | `{ mimeType, size }` | `{ uploadId, chunkSize }` |
| `uploadScreenshotChunk` | `{ uploadId, index, data }` | `{ received }` |

- `chunkSize` is 200 KiB of base64 characters (~150 KiB raw); maximum 20 chunks.

- `uploadId` is 32 hex characters; the manifest and chunks are KVS values with a 15-minute TTL, bound to the JWT `sub`.

- `size` must be a positive integer no larger than 20 × chunk size.

- Sequential upload; the client sends chunks in order.

### 7.7 Other actions

- `updateIssue` — status via transitions, plus priority, assignee, summary, description. Guest assignees must be licensed users. Description edits replace only the user body (§15).

- `getTransitions` — allowed transitions for an issue.

- `searchUsers` — `{ projectKey, query }`; marks which results hold a seat.

- `getPriorities` — allowed priorities for the context.

- `getIssueTypes` — creatable, non-subtask types for a project.

- `listCanvasesForUser` — canvases with ticket and URL counts, excluding archived and deleted.

- `createCanvas` — creates a seed ticket ("Canvas created") that establishes the canvas; requires the `isAdmin` claim.

---

## 8. In-Jira surfaces

### 8.1 Canvas dashboard (`jira:globalPage`, Custom UI)

The page separates its two jobs with an anchor nav: **Install JiraTack** and **Canvases** (D42).

**Install JiraTack (`#install`)** — two cards, each with its own actions (D43):
- **Bookmarklet:** *Get bookmark* (a scope drawer: selected canvases — the default — or all canvases, always current) and *Create a guest bookmark*.
- **Browser extension:** *Chrome extension* (Web Store), *Firefox add-on* (direct signed `.xpi`), **Connect this browser** and *Create a guest extension link*. Publication URLs are constants; until a listing exists the card shows the unpacked Developer-mode instructions under a **Temporary** note that is removed when the listings go live.
- **Connecting the extension (D46).** *Connect this browser* calls the resolver, which mints a single-use 120-second code bound to the signed-in user and returns it with `apiUrl`/`sdkUrl`. The dashboard posts that to the parent window; a content script declared for Jira origins relays it to the extension's background, which exchanges it (§CONTRACTS 3.1b) and stores the credential. The card then reads **Connected as …**, or **extension not detected** when nothing answers within the timeout. Nothing is typed or pasted, and the toolbar is not involved.
Admin-only actions are hidden for non-admins **and** every privileged resolver re-checks server-side; hiding is not authorisation (D19).

**Usage meter (D47).** Admins see *“N people active in the last 20 minutes”* under the page title, counting **distinct identities** — Jira users by account, guests by reviewer binding (D48) — whose credential was exchanged inside the window. Measurement only: no limit is enforced, and a failed count renders as unavailable rather than as zero.

**Canvases (`#canvases`)**
- Search matches the canvas name **or key**. A **folder rail** (All, Unfiled, each folder with a count) filters the list; a canvas is moved into a folder from its page. A cards/list toggle (remembered in `localStorage`) switches between a card grid and a table; both show the name and the stable key, open/total counts, URL count, last updated and participants.
- **New canvas** opens an inline panel: name, target URL (optional) and the **Pre-filled fields** rows (field from the installation catalogue + value, add/remove). No project picker — the seed ticket uses the installation's default project. No modal.
- Each canvas opens a **dedicated page** (`#/canvas/<key>`) with tabs:
  - **Pages** — URLs with ticket counts;
  - **Fields** — rename the canvas (the key never changes), set its folder, and edit the per-canvas pre-fills;
  - **Access** — open the canvas in Jira, invite a guest.
- Archive and delete are confirmed in a modal; delete is refused while any ticket is not Done. Deleted and archived canvases are tracked in `installationConfig` and reflected on the registry record.

**Canvas keys (D42).** A canvas is identified by its seed ticket key (`KAN-123`, or `c-xxxxxxxx` when no seed exists); the name is an editable label. Every historical name stays indexed, so tickets written before a rename still resolve to the canvas. One resolver decides which canvas an id refers to, whether the id is a key or a label: record key, then the name index, then the deterministic key derived from the name, then (only if needed) a scan of the records. A resolution that had to bypass the name index repairs that row, so a lost index costs one scan rather than one per call. A ticket records the **label** in `pin.canvas` and the **key** in `pin.canvasId`; a generated key that resolves to nothing is refused rather than recreated. The launcher shows one entry per canvas label.

**Registry health (admin).** The admin page can report what is actually stored — canvases, name-index rows, orphaned rows, unindexed records, duplicate labels (with both keys and their ticket counts), previews, legacy preview keys, and tickets missing a canvas key or resolving to nothing — with samples. **Repair index** restores missing name-index rows without touching tickets, is safe to run repeatedly, and never takes a name another canvas owns. A duplicate label lists both records with their keys and ticket counts, and whichever record no ticket resolves to can be **removed by key** — never by name, which would hide the real canvas. The report exists so compatibility fallbacks are retired on evidence.

**Card preview (D43).** The card image is a screenshot of the **top of the page** at the full viewport width, captured locally by the reviewer's browser at the first ticket. The capture never hides the reviewer's UI: in-page rendering omits JiraTack's chrome from the raster, and a tab capture keeps the sidebar on screen and crops or masks it out of the result. A render that exceeds ~2.5 s is abandoned in favour of the ticket's screenshot so a save is never held for a preview; the card fills its width and clips the bottom of a tall shot rather than cropping the sides; no third-party image service is used and JiraTack's own pins and overlay are excluded. It is stored on the canvas record (`thumbnail`, `thumbnailVersion: 2`) so **Clear preview** removes exactly what the card reads. A preview captured by a build older than 5.72 (in its own key) is adopted onto the record on first read and the old key deleted, so there is one generation only. If the page capture yields nothing, the ticket's own screenshot is downscaled and used instead; encoding steps down in size and quality until the data URL fits the storage cap. The canvas page shows the preview state (stored / not captured) under the title and at the top of **Fields**, with the reason recorded when an attempt produced no image.

### 8.2 Epic panel (`jira:issuePanel`, Epic condition)

- Canvases referenced by the epic, with the epic ticket count, the canvas total ticket count, and the URL count per canvas.

  The total is counted in a separate `labels = "jiratack"` scan as the viewing user, so it reflects what that user can see. If that scan fails, the panel falls back to the epic count and reports a warning; if it hits the 2,000-issue cap, the panel reports that totals may be incomplete.

- Merges a company-managed query (`"Epic Link" = <key>`) and a team-managed query (`parent = <key>`), deduplicating by key.

- If one query fails the other still renders, with a warning; if both fail, `INTERNAL`.

### 8.3 Issue panel (`jira:issuePanel`, all types)

- Reads `com.jiratack.metadata` via a search on `key = "<key>"` with `properties`.

- Unindexed or non-JiraTack tickets show a minimal "Not a JiraTack ticket" state.

- Otherwise: canvas name, page URL, guest identity when present, pin position and selector, the suggested text change as `Text change: Original → Suggested` when present, the newest screenshot (highest filename timestamp, falling back to the newest image) rendered from a base64 `data:` URL (fetched with `asApp()` because UI Kit cannot authenticate a raw attachment URL), "copy link to this pin", "copy review bookmarklet", and related tickets (cap 20).

### 8.4 Admin page (`jira:adminPage`)

- License status, `viewPermissionMode` (`per_user_projects` | `open`), **guest invitations** (reviewer, email, sponsor, status, pairings, pin count, link expiry, with Deactivate/Activate, New link, Revoke, and **Revoke guest** — every invitation for the same reviewer binding, D48), archived/deleted canvas lists.
- **Canvas registry health** on demand: counts and samples for orphaned name-index rows, unindexed canvases, duplicate labels (both keys plus ticket counts), previews stored/missing, legacy preview keys, and tickets without a canvas key or without a canvas. **Repair index** restores missing index rows; it never edits tickets.

- Admin-only via `requireAdmin`.

### 8.5 Project settings (`jira:projectSettingsPage`)

- Enable JiraTack for the project, default issue type / priority / assignee, the hidden-status rule, console capture settings.

- Admin-only via `requireAdmin`. Per-project admin delegation is deferred; the page is site-admin-gated.

### 8.6 Guest installer page (`webtrigger-install`, public HTML)

- The guest link carries a **short code** (`?code=JT-4F9K-2XQ7`), not the invite token (D46). The page exchanges the code once and continues through the token flow, so no visible token is ever shared.
- Two cards: **Connect the extension** (install links, then *click the bookmarklet once → click the toolbar icon*; the page shows a 🟢 **Connected** dot when `window.__jiratackActiveCanvas` appears) and **Use the bookmarklet** (drag to the bookmarks bar).
- `?mode=extension` puts the extension card first. `mode=bookmark` (default) puts the bookmarklet first.
- The link is valid for **90 days**; pause, revoke and deactivation take effect immediately. Capacity is capped at 10 devices per invite.
- Safari is told the extension is unavailable and the bookmarklet may be blocked on strict sites.

---

## 9. Configuration

### 9.1 `installationConfig`

```json
{
  "viewPermissionMode": "per_user_projects",
  "projects": {
    "MM": {
      "enabled": true,
      "defaultIssueTypeId": null,
      "defaultPriorityId": null,
      "defaultAssigneeAccountId": null,
      "filteredStatusIds": null,
      "captureConsoleLogs": false,
      "consoleLogsDefaultChecked": false
    }
  },
  "archivedCanvases": [],
  "deletedCanvases": [],
  "configVersion": "sha256-hex",
  "updatedAt": 0,
  "schemaVersion": 1
}
```

- `configVersion` = SHA-256 of canonical `JSON.stringify({ projects, viewPermissionMode })`. There is no `fieldRegistry`.

- Project entries are merged over `PROJECT_DEFAULTS` on read, so a missing project has `enabled: true` and `filteredStatusIds: null` (the Done default, §17).

### 9.2 Read and write semantics

- A KVS read error **throws**; it does not return defaults. Returning defaults once let a transient failure be persisted back over real configuration.

- Writes go through `mutateInstallationConfig`, which reads and writes in one narrow window with up to 3 attempts. `kvs.transact()` exists and would give true compare-and-set; that remains follow-up work rather than a missing capability.

- `setInstallationConfig` merges `payload.projects` rather than replacing the map.

---

## 10. Bookmarklet UI

### 10.1 Activation

```text
click bookmarklet
  if window.__jiratackActiveCanvas === canvasId → close, exit
  else → ensure session, load pins or canvases, render
```

### 10.2 Sidebar

- Header: canvas name (or "JiraTack Launcher"), ticket count, scope badge (`View only`), **New Pin** control for write scopes, layout switch, close.

- Guest sessions show a canvas dropdown instead of the title; the form shows the invited name and email read-only, and defaults the assignee to the sponsor.

- Filter toggle: All / This page.

- **Status row (D38, amended):** below the filter toggle, `View All` and `Filter By Status ▾`. The caret opens the per-status checklist (see §17); the row stays visible whenever the canvas has tickets with statuses. In View All mode the filter button reads "(N hidden)", where N is what the stored rule holds back. See §17.

- **Compose mode** (a ticket form is open): the filter and match rows are replaced by a compact page-URL line, the ticket list collapses to one line (`N other tickets on this page`, expandable), Pin mode is removed, pin dragging is disabled, and Switch Canvas / the guest canvas dropdown are disabled until the draft is created or cancelled. The form owns the sidebar; cancelling restores the list and filters.

- The canvas seed ticket (`[JiraTack] Canvas created`) is hidden from the overlay: it is bookkeeping with position `0,0`, not a pin.

- **Match row** (only with `This page` selected, and only when the modes disagree): `Smart`, `Exact`, `Whole page`, each labelled with the number of pins it would show. The counts make the trade-off visible — "Smart 2 / Whole page 5" means four sibling URLs were merged. Default `Smart`; the choice resets on each activation and is never persisted.

- When the selected mode shows nothing but a wider one would show pins, the empty state offers a rescue button: "Show all N on this page".

- When the status rule leaves nothing on the page (§17), the empty state offers "Show N filtered tickets".

- Tickets are listed **newest first** (D45): the ticket just created is at the top of the sidebar, and within a URL group the same order holds.
- Ticket card collapsed: key, summary (truncated), status chip, priority, assignee, reporter. A ticket created with a text change also shows `Original → Suggested` with a preview switch (D35).

- Clicking a card selects the pin/card pair and scrolls both into view. Exactly one pair is selected at a time.

- Empty state: "No pins for this canvas on this page." Write scopes add a hint about pin mode.

### 10.3 Pins

| State | Appearance |
| --- | --- |
| Default | `#FF6B6B` dot, key badge |
| Selected | white fill, `#E63946` ring, 1.3× |
| Hover | scale 1.3 with ring |
| Pending (pin mode) | dashed, pulsing |
| Done (filtered) | `#2ECC71`, opacity 0.5; hidden unless **View All** is selected |
| Detached | cluster top-right, tooltip "Pin location lost" |

Move mode (write scopes): hold ~400 ms, **or move while held**, then drag to reposition, release → a confirmation bar beside the pin. Nothing is written until the reviewer confirms. Moving the pointer more than a few pixels while the button is down arms the drag immediately — a press that slides while grabbing a small target is a drag, not a dead click; a click remains the no-motion press (which keeps selecting the pin).

- The pin renders at the drop point immediately. The screenshot is captured at drop time and held in memory; no upload happens before confirmation.
- The bar reads `Move <KEY> here?` with **Confirm** and **Cancel**. It is anchored beside the pin (above or below, whichever fits), follows scrolling, and never slides under the sidebar. It appears once the capture finishes, so it is never invisible while clickable.
- **Confirm** uploads the screenshot, then calls `updatePinPosition`. Failure reverts the pin with a toast.
- **Cancel**, `Esc`, closing the overlay, switching canvas, or starting a new ticket discards the pending move: the previous selector and position are restored, the screenshot is dropped, and no request is sent. There is no timer and no auto-commit.
- While a move awaits confirmation, no pin can be dragged — one move at a time.
- The ghost is visual only. It lives **inside JiraTack's own overlay**, never in `document.body`: the push-mode fixed-shift pass moves *page* `position: fixed` elements that overlap the sidebar, and a body-parented ghost was treated as one and shoved 320 px away from the cursor. The drop resolves the element under the cursor using the same capture rules as pin mode (§10.4, §12.2) — a move can never anchor to `body`/`html`, an oversized box, or a JiraTack class.
- The dragged pin **keeps its presence and changes colour** (yellow, the move colour, with a ring): it is picked up, not faded out. Fading an 18 px dot to 35% opacity read as "the pin disappeared", so the reviewer lost the pin, its location and any colour change until the drop landed.
- Releasing over JiraTack's own UI (sidebar, viewport bar, a pin) abandons the move; it never reinterprets the overlay as the page.
- A confirmed move supersedes the screenshot: a new `jiratack-<key>-<timestamp>.png` is attached and the old files are kept. `com.jiratack.metadata.screenshotVersion` increments.
- When the pointer travelled more than 4 px and the screenshot attached, the app posts a comment naming the mover and time. No comment for an accidental nudge, and none when the screenshot could not be captured or attached.

### 10.4 Capture (write scopes)

**New Pin** is the only capture control. Its helper reads **"Click an element to pin it, or select text to suggest an edit."** Pressing it arms element capture; the button fills blue, the helper changes to "Click any element to place the pin. Esc cancels.", and `Esc` exits. There is no second mode.

- **Pin** — cursor becomes crosshair; hovering an element draws a 2 px dashed `#1869DB` outline with a tag/id/class tooltip. Click computes selector and position, snapshots the console buffer, captures a screenshot, and opens an anchored composer at the click point (D36). The composer asks for **Summary** and **Description**; **Add to ticket** hands them to the sidebar and **Cancel** removes the pending pin. Nothing is written from the composer.

- **Text suggestion** — a non-collapsed selection outside JiraTack and form controls shows a small **Suggest edit** pill at the selection once the mouse is released. The precise node path of the selection is stored with the suggestion, so the post-creation preview resolves it even when the same phrase appears more than once on the page. The preview never matches text inside JiraTack's own UI, and prefers an inline, single-text-node match so the replacement is shown in place rather than as a box-only outline. The pill keeps the cloned range even if the page collapses the native selection, so it stays interactive until the reviewer clicks away or presses `Esc`. Clicking it opens a composer with the selected quote, the **Suggested text**, and **View on page**. The composer never auto-opens and a selection alone never marks a pin as a text change. Selections over the overlay, a form control, an `input`/`textarea`, or beyond 2,000 characters are ignored.

- The composer is anchored to the click or selection, flips above the anchor when it would overflow the viewport, and clamps to an 8px edge margin. `Esc` cancels; `Cmd/Ctrl+Enter` adds to the ticket.

### 10.5 New ticket form

Compact vertical layout with a sticky top bar (`New ticket` / **Cancel**), a sticky footer (**Create ticket** / **Cancel**), and the Jira details first. The content was captured in the popover; the form carries it in and lets the reviewer complete the ticket.

**Saving (D44).** Creating closes the form immediately: the pin becomes a **pending card** labelled *Saving…*, and the screenshot, attachments and recording upload concurrently while the Jira create runs. On success the pending card is replaced by the real ticket (key, status, links) and the reviewer carries on. On failure the overlay first checks whether the ticket actually landed (a create whose reply was lost), and otherwise reopens the form with the draft intact — summary, description, text change, captured screenshot, attached files and recording. Switching canvases waits while a save is in flight; closing the overlay does not cancel it.

1. **Assignee** — typeahead, full width, first key field, focused when the form opens. Fallback: previous ticket's assignee → current licensed user → sponsor for guests. If no project is resolved, the project control is focused instead.

2. **Reporter line** — muted `Reporting as …`, not an input; not rendered for guests.

3. **Project / Issue type** — share a row. Both default from the previous ticket (D36).

4. **Summary** — carried from the composer, editable, full-width, required marker, `0/215` counter, `aria-required`. For a text change it starts as `Text change: <original>` and stays editable.

5. **Text change** — only when the composer captured a text change (D35, D36). Its own card between **Ticket** and **Description**, with a top line of `TEXT CHANGE`, a large centered **View on page** toggle, and **Edit**; the next line wraps the red strikethrough original into the green suggested text. Edit reopens the same composer with **Save**; the form never duplicates the suggested-text editor. The original is never editable.

6. **Description** — carried from the composer, editable, full-width textarea, five rows. Optional: always present, never blocks creation, no asterisk.

7. **Attach files / Record screen** — two side-by-side buttons under the **Evidence** heading. The native file picker is triggered by the button; the input itself is hidden. In the extension, Record screen captures the current tab directly through `chrome.tabCapture` and shows **no picker**; the bookmarklet uses the browser's display picker with the current tab preselected (D37). The button becomes **Stop recording** while armed, and the recording stops automatically at 60 seconds. Captured evidence lists below the buttons: the screenshot thumbnail with Remove, selected file names and sizes, and the recorded video.

8. **Advanced** — `Additional fields` (priority, parent `MM-123`, console output) collapsed. Priority and parent default from the previous ticket and stay editable.

9. **Actions** — sticky Create/Cancel; `Cmd/Ctrl+Enter` submits from anywhere in the form.

**Defaults (D36).** For each metadata field, the newest non-empty value across the canvas's non-seed pins wins: project, issue type, assignee, priority, parent. Project falls back to the only permitted project; issue type to the last used → `Task` → first non-Epic; priority to the last used → `Medium` → first. Every default remains visible and editable; there is no silent inheritance the reviewer cannot see.

**View on page (D35).** A switch in both the composer and the form, not a button. Preview only; the page is never permanently edited. Inline when the selection is inside one text node: the original is red with `line-through`, the suggested text green, and the page is restored exactly on hide. When the range spans elements or the page re-rendered, a non-destructive marker plus bubble shows old → new. Each show re-resolves the selection from its captured anchor (path + text), so repeated previews survive a page re-render; if the phrase can no longer be found uniquely, the switch turns off with a hint instead of highlighting the wrong text.

**After creation (D35).** Tickets created with a text change store `textChange { original, suggested }` in the property. Their sidebar card shows a switch labelled with the actual `Original → Suggested`; toggling it re-previews the stored pair (scoped to the pin's selector; document-wide only for a unique phrase) and never edits the page. The issue panel shows `Text change: Original → Suggested` on one line. Absent on tickets created before this field existed.

The **Description** field is its own card; there is no separate CONTENT wrapper.

**Screenshot timing (D36, D37).** The extension captures the visible tab before the composer opens: it hides JiraTack's chrome for two frames, uses `chrome.tabs.captureVisibleTab`, and crops around the click. This is fast and avoids html2canvas entirely. The bookmarklet opens the composer immediately and captures with html2canvas only when **Add to ticket** is pressed, after the composer is gone, so typing never competes with a document-wide raster. The sidebar opens with the screenshot already resolved, or the no-screenshot warning.

| Field | Notes |
| --- | --- |
| Project | Select from `permittedProjects`, or free text when the list is `"*"`; defaults from the previous ticket → the only permitted project |
| Issue type | Loaded per project; default = last-used → `Task` → first non-Epic type |
| Assignee | Typeahead; defaults to the previous ticket's assignee → the current licensed user → the sponsor for guests; guest tickets must target a licensed user |
| Reporter | Muted line, not an input; not rendered for guests |
| Summary | Carried from the composer; 215-character input limit with counter; `[JiraTack]` prefix added by the server |
| Description | Carried from the composer; plain textarea, converted to ADF — not a rich-text editor; optional |
| Text change | Conditional on the composer capturing one; standalone card with `TEXT CHANGE`, a large **View on page** toggle, **Edit**, and a wrapping `Original → Suggested` line; preview only; stored in metadata for the card switch |
| Additional fields | Collapsible: priority, optional parent key (`MM-123`), console output; priority and parent default from the previous ticket |
| Your Name, Your Email | Guest sessions only; **read-only**, prefilled from the invitation |
| Attachments | Screenshot thumbnail, selected files, recorded video below the two buttons |
| Screenshot | Visible thumbnail with remove (pre-existing control) |

- Validation is inline where it belongs: a short Summary shows an error under the field and returns focus; a missing project/issue type or a malformed parent shows the error above the actions and focuses the offending control. Description is never required.

- `Esc` cancels from anywhere in the form. Cancelling while a preview or composer is visible restores the page first.

- Parent key is validated against `^[A-Z][A-Z0-9_]+-\d+$`.

- On success the pin renders optimistically and the canvas is re-fetched once to hydrate the real record.

- If the ticket was created without metadata, the toast says the pin could not be saved.

- While the form is open the sidebar is in compose mode (§10.2): Pin mode, pin dragging, Switch Canvas and canvas switching are disabled, so a draft cannot be replaced without an explicit Cancel.

---

## 11. Authorization model

Per-operation, server-side. Hiding a control is never the control (D19, D21).

| Operation | Authority | Enforced by |
| --- | --- | --- |
| `get/setInstallationConfig` | Jira site admin | `requireAdmin(context)` |
| `get/setProjectConfig` | Jira site admin | `requireAdmin(context)` |
| `list/revokeCanvasToken` | Jira site admin | `requireAdmin(context)` |
| `deleteCanvas`, `archiveCanvas` | Jira site admin | `requireAdmin(context)` |
| `createCanvas` (resolver) | Jira site admin | `requireAdmin(context)` |
| `createCanvas` (web trigger) | Jira site admin | `requireAdminClaims(claims)` — `isAdmin` claim |
| `generateCanvasToken` | Seat holder | Seat check at issuance |
| `generateUserToken` | Licensed user, else `view` | Seat check at issuance |
| `generateGuestToken` | Seat holder | Seat check at issuance |
| Dashboard, epic panel, issue panel | Any Jira user with project access | Jira's own permissions via `asUser()` |

**Why the split.** The dashboard and panels are legitimately open to every logged-in user, so page-level `access` scopes cannot be the control. Web triggers have no user identity, so admin rights are resolved at issuance and carried as a claim.

**Accepted trade-offs and gaps:**

- Guest links carry the **issuer's** browse access for the selected canvases. A seat holder can hand an external reviewer visibility into projects that holder can see. Mitigated by canvas scoping and a short invite expiry (72 h for new invites, D26); recorded in D19 rather than left implicit.

- Revocation is eventual: a deleted token blocks new exchanges, but a live JWT remains valid up to 8 hours.

- Admin status is a point-in-time claim; demotion takes effect at the next issuance or session expiry.

- `isAdmin` is resolved with `userAccess.isAdmin` and falls back to `mypermissions?permissions=ADMINISTER`.

---

## 12. Pin model

### 12.1 URL normalisation

`src/shared/urlNormalize.js` is bundled into both the SDK and the server; there is one implementation, not two (D23).

```text
canonicalUrl(url):
  lowercase scheme and host
  drop the fragment
  drop jiratack_ticket / jiratack_canvas
  strip a trailing slash unless path === "/"
  sort query parameters

normalizeUrl(url):            # "Smart" identity
  start from canonicalUrl
  drop utm_* and named trackers (fbclid, gclid, msclkid, ttclid, li_fat_id, …)
  drop cache-busters (t, ts, timestamp, cb, cachebust, nocache, rnd, random)
            when the value is numeric or random-looking
  drop version stamps (v, ver, version) when semver or hash-shaped
  KEEP anything named in the keep-list, regardless of value shape:
       id, page, q, query, search, filter, sort, view, tab, lang, locale,
       sku, product, slug, path, file, doc, issue, key, project
  otherwise drop values shaped like a UUID, 32/40/64-char hex, a 10–13
       digit epoch, or >=16 chars of mixed alphanumerics
  sort the survivors

pathOnlyUrl(url):             # "Whole page" identity
  scheme + host + path, no query
```

- The keep-list exists because a hash-shaped value under `sku` or `product` identifies content, not a session. Dropping it would merge two real pages.

- Protocol is not coerced: `http://` and `https://` are different pages.

- **Pins store `canonicalUrl`**, not the normalised form — the query survives in the ticket, so identity can be re-derived later. Older tickets stored a stripped URL and cannot be recovered; Smart and Whole page still match them.

- All stored or user-supplied URLs that reach an `href` or `location.href` are validated to `http(s)` by `src/shared/safeUrl.js` (D20).

### 12.2 Position format

| Case | Stored value | Meaning |
| --- | --- | --- |
| Selector resolved | `relX,relY` (e.g. `45.2,32.8`) | Percentage offset inside the element's box |
| No selector | `absX,absY` (e.g. `840,620`) | Pixel offset from the document origin |

Restoration order: selector → detached cluster, with absolute used only when no selector was recorded. A pin is never silently dropped.

An unresolvable selector means the stored numbers are element percentages, so they must not be read as document pixels — doing so placed pins near the origin. Such pins appear in the detached cluster instead.

Capture never anchors to `body`/`html` or to a box covering more than 80% of the viewport, and never builds a selector from JiraTack's own `jiratack-*` classes (they exist only while pin mode is active): both degrade to document pixels at capture time.

### 12.3 Deep links

`<pageUrl>?jiratack_ticket=<key>` highlights and scrolls to a pin. `jiratack_canvas=<name>` opens the launcher directly on a canvas. Both are consumed and stripped before querying, and are hints only.

### 12.4 Selector generation

In order, each accepted only if unique: `#id`; `[data-testid="…"]`; `tag.class1.class2`; `tag[role="…"]`; a `tag:nth-of-type(n)` path from the nearest stable ancestor (≤5 levels); otherwise none.

---

## 13. Capture flows

### 13.1 Screenshot

1. Hide JiraTack's own chrome: the overlay (pins, sidebar, form) and the extension's viewport bar. The crop contains page content only — the resize bar is not part of the page and must never appear in evidence.

2. `html2canvas` over the viewport at `devicePixelRatio`.

3. Crop an 800 px square centred on the pin, clipped to bounds.

4. Encode `image/webp` at quality 0.85, falling back to PNG.

5. Restore the hidden chrome to its previous visibility.

6. Keep the data URL in memory only.

On failure (CORS, tainted canvas, oversized page) the capture is skipped, the form shows "Screenshot could not be captured due to site security", and creation proceeds.

Upload happens at submit: chunked to the web trigger, then attached server-side (§7.6). The 800 px crop is deliberate — it keeps the upload inside the chunk budget.

**Pin moves (D33)** reuse steps 1–6 from the drop point, but request PNG instead of WebP because the superseding file is named `jiratack-<key>-<timestamp>.png`. The image is held in memory while the reviewer confirms the move; only then does it travel through the same chunked pipeline and attach to the issue. The original screenshot is never deleted. Cancelling discards the image, and a failed capture still allows the move — with no comment.

### 13.2 Console capture

- `console.error` and `console.warn` are wrapped at init, before any `await`; the buffer holds the last 50 entries.

- Entry format: `[level] message (source)` when a source is known, `[level] message` otherwise.

- On close, the originals are restored and the buffer cleared.

- **Limitation:** capture starts at activation, not page load. Activating then reloading does not re-activate; the user must click again.

### 13.3 Close

Removes all `jiratack-*` elements and the injected style, restores console functions, removes listeners, clears `window.__jiratackActiveCanvas`, and is idempotent.

---

## 14. Ticket creation

### 14.1 Description (ADF, human-readable only)

```text
[ JiraTack ]                      (bold)
     or [ JiraTack Guest: <name> ]
<user body>
<auxiliary field>: <value>        (bold label; D41, one line per canvas field)
Console output:                   (bold, when a log is included)
<codeBlock with the console text>
Page: <link to the canonical URL>
```

No JSON, no marker, no machine payload. The property holds all machine data (D18).

### 14.1b Canvas field pre-fills (D41)

A canvas can pre-fill Jira text fields on every ticket it creates — the classic case is "every URL on this canvas references a Figma link".

- **Where fields come from:** the project settings' **Available text fields** (`projects[key].textFields`), chosen by an admin from text/URL fields. Canvas creators can only pick from that list; they cannot invent a field.
- **Where values are set:** the create-canvas modal (project + **Additional fields** accordion), and afterwards from the dashboard row action **Fields**, which opens the same editor. Rows are `field` + `value`; removing a row stops that pre-fill.
- **What happens on create:** for each pre-fill, the server checks the Create screen for that ticket's project + issue type (`GET /rest/api/3/issue/createmeta`). On-screen → `fields[fieldId] = value`. Anything else (off-screen, no screen information, a managed field) → `Field: value` in the description, with a bare URL rendered as a link. A pinned ticket is never blocked or failed by a pre-fill.

Known limitation: whether a field is on the project's **View** screen cannot be checked through the REST API. A pre-filled value can be written yet not visible on the issue view unless the field is also added to that screen; the creation UI says so.

### 14.2 Validation

- Client: project, issue type, summary ≥3 characters after prefix handling, parent format, guest name/email/assignee when applicable.

- Server: required fields, canvas and project access, project enabled, URL scheme, guest rules, licensed guest assignee.

- Field-level errors name the offending fields; Jira's rejection details are passed through.

### 14.3 Attachment

Server-side, after creation: decode the assembled chunks, POST multipart to `/rest/api/3/issue/{key}/attachments` with `X-Atlassian-Token: no-check`. Filename `jiratack-<key>.<ext>`; a superseding screenshot from a pin move is `jiratack-<key>-<epoch-ms>.png`. Any number of screenshots may accumulate (D33).

Attachment failure never fails ticket creation or a pin move, and never rolls back the metadata write.

### 14.4 Cancel

Discard the form, remove the pending pin, clear the screenshot, return to the list. No server call. Reachable via Cancel button or `Esc`.

---

## 15. Inline editing

| Field | Control | Backend |
| --- | --- | --- |
| Status | Select from allowed transitions | `updateIssue { statusId }` |
| Priority | Select from allowed priorities | `updateIssue { priorityId }` |
| Assignee | Typeahead | `updateIssue { assigneeAccountId }` |
| Summary | Text input; `[JiraTack]` prefix preserved | `updateIssue { summary }` |
| Description | Textarea; replaces the user body only | `updateIssue { description }` |

- Available to `create` and `guest_create`; `view` sessions get no controls and clicking a card opens Jira.

- Server-side description edits rebuild the ADF from the parts, preserving the guest header, console block, and page link. The client never submits whole-document ADF (D15).

- Optimistic: apply, render, revert with a toast on failure.

- Done animation: pin flashes green, card flashes, 1.5 s later the card greys with a Done badge and the pin drops under the status rule (§17).

- A changed `configVersion` in a response triggers a config refresh before the next render, never blocking the UI.

---

## 16. Queries

### 16.1 Overlay

§7.4. The client fetches the whole canvas (`all: true`) and filters by URL at render time using the selected match mode (§10.2). Server-side filtering remains for callers that do not pass `all`, and `truncated` still reports a capped scan.

### 16.2 Dashboard

`labels = "jiratack" ORDER BY created DESC`, pages of 100, cap 2,000, aggregated in `asUser()` context so Jira enforces project permissions. Per canvas: ticket count, open count (status category ≠ done), distinct URLs, last updated, project keys, participants (max 5).

### 16.3 Epic panel

Two searches merged by key: company-managed `"Epic Link" = <epic>`, team-managed `parent = <epic>`; the property is fetched and matched in memory.

### 16.4 Issue panel

Canvas and URL come from the property; related tickets are all `labels = "jiratack"` issues with the same canvas and URL (cap 20, this issue excluded), scanned up to 2,000. The screenshot shown is the newest superseding file by filename timestamp; older attachments stay on the issue.

### 16.5 Search alias

`jiratackCanvas` (the `jira:entityProperty` alias) permits canvas-exact JQL where Jira has indexed it. In-memory filtering remains the primary path because indexing is not guaranteed for older tickets.

---

## 17. Status rule (D38, amended)

The project's hidden-status list is the **default** show/hide rule; the reviewer owns a per-canvas override; retirement was removed with it.

- `filteredStatusIds` `null` (default): the **Done** status category is hidden by default.

- An explicit list: exactly those status IDs are hidden by default.

- `[]`: nothing is hidden by default.

- `getPins` never returns issues whose status is literally named `Removed`, whatever the rule says; deletion happens in Jira only.

- `filtered` is computed per issue from that issue's own project's rule, so canvases spanning projects stay correct. The client uses that flag only to seed the default set of hidden **status names**.

- **The reviewer's choice (D38 amendment).** The status row reads `View All | Filter By Status ▾`. The caret opens a checklist with `All` / `None` / `Reset` and one row per status present on the canvas, with the number of tickets it holds (`☐ Done 4`) and the count including currently hidden tickets. A tick means *show*. Edits apply immediately to the pin layer and the ticket list, and are stored per canvas in `localStorage` under `jiratack:statusFilter:<canvas name>` as the array of hidden status names:
  - key absent → the project default;
  - `[]` → nothing hidden;
  - a list → exactly those names hidden.

- **View All** is a temporary peek that changes nothing; **Filter By Status** returns to the stored/default rule. In View All mode the button reads `Filter By Status (N hidden)`, where N is what the rule is holding back. Statuses without a name are never listed and never hidden.

- Filtered tickets revealed by **View All** render green at 0.5 opacity and stay read-only; when the filtered tickets are the only ones missing, the empty state offers "Show N filtered tickets". The project setting is renamed **Default filter setting**: it seeds the checklist, it does not lock it.

- Dashboard and epic panel never apply the rule.

- The window is resolved from the oldest ticket's project (D14), cached per canvas for 300 s.

---

## 18. License gating

**Seat enforcement happens at issuance, not on every API call.**

| Path | Seat check |
| --- | --- |
| `generateCanvasToken(scope: "create")` | Required; otherwise `LICENSE_INACTIVE` |
| `generateCanvasToken(scope: "view")` | Not checked; browse access only |
| `generateUserToken` | Downgrades to `view` without a seat |
| `generateGuestToken` | Required; guest links are seat-gated |
| `exchangeToken` | Installation `license.active` only |
| Every API action | Scope only, no seat re-check |

**Guest links are the sharing flow.** Any seat holder can mint one; a site admin is not required. That is deliberate (D19): the seat is the authorisation boundary, and the alternative — admin-only minting — blocks the everyday stakeholder review.

**Revocation lifecycle.** Removing a user's seat does not retroactively invalidate their tokens. An admin revokes the relevant `tokenRef` records; live sessions expire within 8 hours.

**Development.** `license === undefined` is treated as active and `userAccess.hasAccess === undefined` is not treated as false, so local testing works unmocked.

---

## 19. Error states

| Condition | Behaviour |
| --- | --- |
| SDK script blocked by host CSP | Bootstrap retries by fetching the bundle and inlining it (D31). Only if that also fails: in-page card "JiraTack could not start here" naming the failed step (download refused, inline refused, failed init, or timeout), with a Dismiss button |
| Bookmarklet refused by host CSP | Nothing runs — `script-src` with a nonce or hash makes the `javascript:` URL illegal (D22). Requires the extension channel |
| Session JWT expired | Silent re-exchange; if that fails, "Bookmarklet expired. Generate a new one from Jira." with a dashboard link |
| Canvas/guest token revoked | Same as above |
| Installation license inactive | Persistent red banner in the sidebar |
| `getPinsForCanvasAndUrl` failure | Inline error with retry; already-rendered pins stay visible |
| Result set truncated at the scan cap | Client is told via `truncated`; partial lists must not be presented as complete |
| Guest link with no canvases | "No canvases are available for this link. Ask the person who sent it for a new one." |
| No pins match the selected mode, but a wider mode has pins | Empty list plus "Show all N on this page", which switches to Whole page |
| `createIssue` validation failure | Field errors plus Jira's messages |
| Metadata write failure | `warning: "metadata-not-stored"`; the toast says the pin could not be saved |
| Screenshot attach failure | Logged; ticket still created |
| Screenshot upload expired (15 min) | Logged; ticket created without the image |
| `updateIssue` failure | Revert plus toast |
| Selector miss, absolute mismatch | Detached cluster; never silently skipped |
| Console buffer empty | Console checkbox not rendered |
| View scope attempts a write | Controls absent; server returns `INSUFFICIENT_SCOPE` |
| Non-admin attempts an admin action | `INSUFFICIENT_SCOPE`, including when the UI hid the button |

---

## 20. Jira API reference

| Purpose | Endpoint |
| --- | --- |
| Search | `POST /rest/api/3/search/jql` — with `properties`, `nextPageToken` |
| Create issue | `POST /rest/api/3/issue?overrideScreenSecurity=true&overrideEditableFlag=true` |
| Issue property | `PUT /rest/api/3/issue/{key}/properties/com.jiratack.metadata` |
| Transitions | `GET`/`POST /rest/api/3/issue/{key}/transitions` |
| Update | `PUT /rest/api/3/issue/{key}` |
| Attachments | `POST /rest/api/3/issue/{key}/attachments` with `X-Atlassian-Token: no-check` |
| Attachment content | `GET /rest/api/3/attachment/content/{id}` (as app, base64 for UI Kit) |
| User search | `GET /rest/api/3/user/assignable/search?project=<key>&query=<q>` |
| Create meta | `GET /rest/api/3/issue/createmeta/{projectKey}/issuetypes` |
| Permissions | `GET /rest/api/3/mypermissions?permissions=ADMINISTER` |
| Server info | `GET /rest/api/3/serverInfo` (Jira base URL for panel links) |

Not used any more: `/rest/api/3/field`, `/rest/api/3/screens`, screen-tab field APIs. There are no custom fields to create or audit.

---

**End of SPEC.md v3.0.**
