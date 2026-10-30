# SPEC.md — v3.0

**Status:** Current. Behaviour of shipped code only.
**Verified against:** `src/` in the working tree, 2026-10-30, app 4.92.0, SDK `d5d8edafeda5`.
**Supersedes:** SPEC.md v2.3 in full; v3.1 adds D23 (page identity and match modes).

**Precedence.** `CONTRACTS.md` wins on wire-level details (shapes, signatures, error codes, manifest, `package.json`). `DECISIONS.md` wins on any question, open or closed. This document wins on product behaviour.

**Scope.** This document describes the Forge app and the bookmarklet SDK as built. A content-script browser extension is recorded as the chosen CSP-resilient channel in `DECISIONS.md` D22, but **no extension code ships in this release**; it is not described here. The extension plan belongs to the business alignment document.

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
  | Guest link | `generateGuestToken` | A set of canvases, delegated by the issuer | 365 days |

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

- No scheduled trigger. Retirement is a query filter, not a job.

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

Extension-era client code, `jiratack://` protocol, pairing flow, config-bundle encryption (AES-GCM, PBKDF2), KVS pin records, KVS URL index, retirement scheduler, `doneAt` timestamps, message-passing handler map. Also removed after v2.3: Jira custom fields, field provisioning, the field mapping audit, the description marker, and recovery from descriptions (D18).

### 3.5 What survives

Canvas-token model (extended), Jira API conventions, admin configuration, license gating, visual pin design, `jiratack` label on every created ticket.

---

## 4. Pin metadata and labels

### 4.1 Issue property

Machine data lives in the issue property `com.jiratack.metadata`:

```json
{
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
| Guest token | 365 days | `guest_create` | Embedded in the installer URL | `generateGuestToken` |
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

**`generateGuestToken(permittedCanvases)`**

1. Requires a seat (`hasAccess !== false`) → else `LICENSE_INACTIVE`. Guest links are seat-gated, **not** admin-gated (D19).

2. `permittedCanvases` must be 1–50 distinct names of 1–255 characters.

3. Record is `scope: 'guest_create'`, `issuer`, `isAdmin: false`, `permittedCanvases`, `permittedProjectsJson`, 365-day TTL.

4. Returns `{ token, installerUrl, scope, permittedCanvases, permittedProjects, expiresAt }`. `installerUrl` is the install web trigger with `?token=…`.

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
```

The signing secret is created with a `must_be_missing` compare-and-set so concurrent cold starts cannot orphan each other's JWTs. It is currently stored as a plain KVS value, not with `kvs.setSecret`; migration is tracked in the security review.

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

6. On failure — `onerror`, a synchronous throw on `s.src` (Trusted Types), a missing `__jiratackInit`, or a 15-second timeout — replaces the spinner with an in-page card: "JiraTack could not start on this page", a reason, and a Dismiss button. The reason distinguishes a CSP block from a Trusted Types block, a script that loaded but did not initialise, and a timeout. Every failure is also logged as `[JiraTack] …` for diagnosis.

Host-page CSP can block the external script entirely — measured on github.com, developer.mozilla.org, en.wikipedia.org, and accounts.google.com — and the user now sees an explanation instead of a disappearing spinner. Running the client on those sites still requires the extension channel (D22); the message is honesty, not a fix.

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

### 6.5 Personal (launcher) bookmarklet

When `canvasId` is `universal`, the SDK does not bind to a canvas. It calls `listCanvasesForUser`, shows a "JiraTack Launcher" sidebar, and:

- Auto-selects the single canvas that contains the current URL, if exactly one does.

- Otherwise lists canvases to choose from.

- Offers "Create canvas" when the session scope is not `view` (the server still enforces admin rights).

### 6.6 Guest bookmarklet

A guest session renders only its `permittedCanvases`, in a dropdown, and defaults to the first. If the list is empty the sidebar shows "No canvases are available for this link." The guest cannot switch canvases or create one.

### 6.7 Navigation, filters, deep links

- The filter toggle switches between all pins in the canvas and pins for the current page only.

- Selection and filter survive cross-page navigation in `sessionStorage` under `jiratack_nav_state`, and are cleared once consumed.

- Clicking a ticket on another page shows a 3-second notice and asks the user to re-open the bookmarklet.

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
fields: summary, status, priority, assignee, reporter, issuetype, created, project,
        statuscategorychangedate
```

Filtering happens in memory: canvas match, `permittedProjects`, and the retirement window. URL matching is applied by the client at render time; the server only matches URLs when `all` is false.

- Scans up to 2,000 issues across pages of 100.

- Returns `{ pins, canvasName, configVersion, truncated }`.

- `truncated` is `true` when the scan cap stopped before the result set ended — the list may be partial, and the client is expected to say so rather than imply completeness.

### 7.5 `createIssue`

Client payload:

```text
{ canvasId, url, pinPosition, selector, summary, descriptionAdf, screenshotUploadId,
  consoleLog, issueTypeId, projectKey, priorityId, assigneeAccountId, parentKey,
  guestName?, guestEmail? }
```

Server:

1. Validates required fields (`canvasId`, `url`, `pinPosition`, `summary`, `issueTypeId`, `projectKey`).

2. Guest branch: `guestName` required, `guestEmail` must be a valid address, `assigneeAccountId` required and must belong to a licensed JiraTack user (`jiratack_licensed_users:*`).

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

- Header, search, and a table with one row per canvas: name, open/total ticket counts, URL count, last updated, participants (avatar stack, max 5).

- Per-row actions: open the canvas, copy the write bookmarklet, copy the personal bookmarklet, create a guest link, archive, delete.

- Create-canvas modal (admin), guest-link modal (seat holder, 1–50 canvases).

- Admin-only elements are hidden for non-admins **and** every privileged resolver re-checks server-side; hiding is not authorisation (D19).

- Archived and deleted canvases are tracked in `installationConfig`. Deleted canvases are filtered out of the list; archived canvases are returned with `archived: true` so the UI can style them.

### 8.2 Epic panel (`jira:issuePanel`, Epic condition)

- Canvases referenced by the epic, with the epic ticket count, the canvas total ticket count, and the URL count per canvas.

  The total is counted in a separate `labels = "jiratack"` scan as the viewing user, so it reflects what that user can see. If that scan fails, the panel falls back to the epic count and reports a warning; if it hits the 2,000-issue cap, the panel reports that totals may be incomplete.

- Merges a company-managed query (`"Epic Link" = <key>`) and a team-managed query (`parent = <key>`), deduplicating by key.

- If one query fails the other still renders, with a warning; if both fail, `INTERNAL`.

### 8.3 Issue panel (`jira:issuePanel`, all types)

- Reads `com.jiratack.metadata` via a search on `key = "<key>"` with `properties`.

- Unindexed or non-JiraTack tickets show a minimal "Not a JiraTack ticket" state.

- Otherwise: canvas name, page URL, guest identity when present, pin position and selector, a screenshot rendered from a base64 `data:` URL (fetched with `asApp()` because UI Kit cannot authenticate a raw attachment URL), "copy link to this pin", "copy review bookmarklet", and related tickets (cap 20).

### 8.4 Admin page (`jira:adminPage`)

- License status, `viewPermissionMode` (`per_user_projects` | `open`), token inventory with `tokenRef`, revoke, archived/deleted canvas lists.

- Admin-only via `requireAdmin`.

### 8.5 Project settings (`jira:projectSettingsPage`)

- Enable JiraTack for the project, default issue type / priority / assignee, retirement window, console capture settings.

- Admin-only via `requireAdmin`. Per-project admin delegation is deferred; the page is site-admin-gated.

### 8.6 Guest installer page (`webtrigger-install`, public HTML)

- `GET <installUrl>?token=<guestToken>` renders a self-contained page with the draggable bookmarklet and instructions.

- The token is read from the query string; nothing about the issuer's identity is disclosed beyond the canvas names in the resulting link.

- This is the only public-facing HTML surface.

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
      "retirementDays": 0,
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

- Project entries are merged over `PROJECT_DEFAULTS` on read, so a missing project has `enabled: true` and `retirementDays: 0`.

### 9.2 Read and write semantics

- A KVS read error **throws**; it does not return defaults. Returning defaults once let a transient failure be persisted back over real configuration.

- Writes go through `mutateInstallationConfig`, which reads and writes in one narrow window with up to 3 attempts. This shrinks the read-modify-write race; true compare-and-set is follow-up work.

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

- Header: canvas name (or "JiraTack Launcher"), ticket count, scope badge (`View only`), pin-mode toggle for write scopes, layout switch, close.

- Guest sessions show a canvas dropdown instead of the title.

- Filter toggle: All / This page.

- **Match row** (only with `This page` selected, and only when the modes disagree): `Smart`, `Exact`, `Whole page`, each labelled with the number of pins it would show. The counts make the trade-off visible — "Smart 2 / Whole page 5" means four sibling URLs were merged. Default `Smart`; the choice resets on each activation and is never persisted.

- When the selected mode shows nothing but a wider one would show pins, the empty state offers a rescue button: "Show all N on this page".

- Ticket card collapsed: key, summary (truncated), status chip, priority, assignee, reporter.

- Clicking a card selects the pin/card pair and scrolls both into view. Exactly one pair is selected at a time.

- Empty state: "No pins for this canvas on this page." Write scopes add a hint about pin mode.

### 10.3 Pins

| State | Appearance |
| --- | --- |
| Default | `#FF6B6B` dot, key badge |
| Selected | white fill, `#E63946` ring, 1.3× |
| Hover | scale 1.3 with ring |
| Pending (pin mode) | dashed, pulsing |
| Done | `#2ECC71`, opacity 0.5; visible only within the retirement window |
| Detached | cluster top-right, tooltip "Pin location lost" |

Move mode (write scopes): hold ~500 ms, drag to reposition, release → `updateIssue`; failure reverts with a toast.

### 10.4 Pin mode (write scopes)

- Toggle in the sidebar header; `Esc` exits.

- Cursor becomes crosshair; hovering an element draws a 2 px dashed `#1869DB` outline with a tag/id/class tooltip.

- Click computes selector and position, snapshots the console buffer, captures a screenshot, opens the form.

### 10.5 New ticket form

Compact vertical layout with a sticky top bar carrying "New ticket" and **Cancel**.

| Field | Notes |
| --- | --- |
| Your name, Your email | Guest sessions only; both required |
| Project | Select from `permittedProjects`, or free text when the list is `"*"` |
| Issue type | Loaded per project; default = last-used → `Task` → first non-Epic type |
| Assignee | Typeahead; guest tickets must target a licensed user |
| Reporter | Read-only, shows the authenticated user; not rendered for guests |
| Summary | 215-character input limit; `[JiraTack]` prefix added by the server |
| Description | Plain textarea, converted to ADF — not a rich-text editor |
| Additional fields | Collapsible: priority, optional parent key (`MM-123`) |
| Console output | Checkbox, only when entries were captured |
| Screenshot | Preview with remove; a capture failure shows a warning above the form |

- `Esc` cancels from anywhere in the form; Cancel and Create sit at the bottom, with Cancel also in the sticky header.

- Parent key is validated against `^[A-Z][A-Z0-9_]+-\d+$`.

- On success the pin renders optimistically and the canvas is re-fetched once to hydrate the real record.

- If the ticket was created without metadata, the toast says the pin could not be saved.

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

- Guest links carry the **issuer's** browse access for the selected canvases. A seat holder can hand an external reviewer visibility into projects that holder can see. Mitigated by canvas scoping and a 365-day expiry; recorded in D19 rather than left implicit.

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

Restoration order: selector → absolute → detached cluster. A pin is never silently dropped.

### 12.3 Deep links

`<pageUrl>?jiratack_ticket=<key>` highlights and scrolls to a pin. `jiratack_canvas=<name>` opens the launcher directly on a canvas. Both are consumed and stripped before querying, and are hints only.

### 12.4 Selector generation

In order, each accepted only if unique: `#id`; `[data-testid="…"]`; `tag.class1.class2`; `tag[role="…"]`; a `tag:nth-of-type(n)` path from the nearest stable ancestor (≤5 levels); otherwise none.

---

## 13. Capture flows

### 13.1 Screenshot

1. Hide pins and sidebar.

2. `html2canvas` over the viewport at `devicePixelRatio`.

3. Crop an 800 px square centred on the pin, clipped to bounds.

4. Encode `image/webp` at quality 0.85, falling back to PNG.

5. Restore overlay visibility.

6. Keep the data URL in memory only.

On failure (CORS, tainted canvas, oversized page) the capture is skipped, the form shows "Screenshot could not be captured due to site security", and creation proceeds.

Upload happens at submit: chunked to the web trigger, then attached server-side (§7.6). The 800 px crop is deliberate — it keeps the upload inside the chunk budget.

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
Console output:                   (bold, when a log is included)
<codeBlock with the console text>
Page: <link to the canonical URL>
```

No JSON, no marker, no machine payload. The property holds all machine data (D18).

### 14.2 Validation

- Client: project, issue type, summary ≥3 characters after prefix handling, parent format, guest name/email/assignee when applicable.

- Server: required fields, canvas and project access, project enabled, URL scheme, guest rules, licensed guest assignee.

- Field-level errors name the offending fields; Jira's rejection details are passed through.

### 14.3 Attachment

Server-side, after creation: decode the assembled chunks, POST multipart to `/rest/api/3/issue/{key}/attachments` with `X-Atlassian-Token: no-check`. Filename `jiratack-<key>.<ext>`.

Attachment failure never fails ticket creation, and never rolls back the metadata write.

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

- Done animation: pin flashes green, card flashes, 1.5 s later the pin fades and the card greys with a Done badge.

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

Canvas and URL come from the property; related tickets are all `labels = "jiratack"` issues with the same canvas and URL (cap 20, this issue excluded), scanned up to 2,000.

### 16.5 Search alias

`jiratackCanvas` (the `jira:entityProperty` alias) permits canvas-exact JQL where Jira has indexed it. In-memory filtering remains the primary path because indexing is not guaranteed for older tickets.

---

## 17. Retirement

Retirement is a filter, never a deletion.

- `retirementDays === 0` (default): Done tickets are excluded from the overlay.

- `retirementDays > 0`: Done tickets are included while `statuscategorychangedate >= now − N days`; they render green at 0.5 opacity and are read-only.

- Un-done tickets reappear automatically.

- Dashboard and epic panel never apply retirement.

- `statusCategoryChangedDate` is authoritative; there is no `doneAt` field.

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
| SDK script blocked by host CSP | In-page card: "JiraTack could not start on this page" with the reason (CSP, Trusted Types, failed init, or timeout) and a Dismiss button |
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
