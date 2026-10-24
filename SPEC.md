# SPEC.md — v2.3

**Status:** Complete rewrite, incorporating two-scope token model. Supersedes SPEC.md v1.1 and v2.2 in full. This is the source of truth. For any conflict between this document and `CONTRACTS.md`, `CONTRACTS.md` wins on wire-level details (shapes, signatures, error codes); this document wins on product behavior.

**Runtime:** Forge app on Node.js 24.x. All JavaScript. No TypeScript, no Python, no external services.

---

## 1. Product Overview

JiraTack is a single-part product: an Atlassian Forge app, Marketplace listed, installed once by a Jira admin. It has no Chrome extension, no external proxy, and no public-facing infrastructure beyond the Forge app itself.

**What it does:**

- Lets QA and content teams drop visual pins on any web page and turn them into Jira tickets in one action.

- Uses a bookmarklet as the on-page client. Bookmarklets are generated per **canvas** (a named review round) from inside Jira and dragged to the bookmark bar once.

- Stores every pin as a Jira ticket. Four custom fields — `JiraTack Canvas`, `Page URL`, `Pin Position`, `Pinned Selector` — **are** the pin index. No separate pin store exists.

- Supports two capability levels via two token scopes: **create** (drop pins, edit tickets) and **view** (read-only review). Write access is gated on Atlassian user-based billing (`userAccess.hasAccess`); view access is gated only on Jira project browse access. A licensed user can hand a view-scoped bookmarklet to any stakeholder with ticket permissions, and the stakeholder sees pins read-only without consuming a seat.

- Exposes three Jira-native surfaces: a **global canvas dashboard**, an **epic panel**, and an **issue panel** — so the whole team can browse reviews without any client installed.

**What it explicitly is not:**

- Not a proxy. It does not fetch, rewrite, or render arbitrary web pages server-side.

- Not a browser extension. No `chrome.storage`, no MV3, no `jiratack://`, no pairing flow.

- Not dependent on any backend other than the Forge app.

- Not a seat-sharing loophole: view tokens carry `scope: "view"` and are rejected by all write endpoints.

---

## 2. Tech Stack

**Forge App:**

- Atlassian Forge, Node.js 24.x runtime (24 is active LTS; 22 is maintenance LTS and EOL April 2027)

- All JavaScript (no TypeScript)

- Forge UI Kit (JSX/React) for admin config, epic panel, issue panel, project settings page

- Forge Custom UI (React + Vite) for the global canvas dashboard only

- Forge Functions for resolvers and webtrigger handlers

- Forge Webtriggers for the bookmarklet API and the SDK bundle

- `@forge/kvs` for the only storage (canvas tokens + installation config + JWT signing secret)

- `jsonwebtoken` for JWT signing/validation (HS256)

- Forge Scheduled Trigger: **not needed** (retirement is a JQL filter)

**Bookmarklet SDK:**

- Vanilla JavaScript, no framework

- Vite produces one minified `.js` bundle

- `html2canvas` bundled for screenshot capture

- Inline CSS (no Tailwind in bookmarklet)

- No persistent state: only `sessionStorage` for JWT, nothing else

**No Python, no external CDN, no second deployable, no Forge Containers.**

---

## 3. Architecture

### 3.1 Three layers, one deployable

text

┌──────────────────────────────────────────────────────────────┐
│  FORGE APP (single deployable, Node.js 24)                   │
│                                                              │
│  Surfaces:                                                   │
│   • jira:globalPage          → Canvas Dashboard (Custom UI)  │
│   • jira:issuePanel (epic)   → Epic panel (UI Kit)           │
│   • jira:issuePanel (any)    → Issue panel (UI Kit)          │
│   • jira:projectSettingsPage → Project config (UI Kit)       │
│   • jira:adminPage           → Installation config (UI Kit)  │
│                                                              │
│  Webtriggers (public, no Atlassian user context):            │
│   • GET  <wt>/bookmarklet.js → serves SDK bundle             │
│   • POST <wt>/api             → all API actions              │
│                                                              │
│  Resolvers (user context, userAccess available):             │
│   • generateCanvasToken, provisionFields                     │
│   • dashboardAggregate, epicPanelData, issuePanelData        │
│   • fieldMappingAudit                                        │
│                                                              │
│  Storage: @forge/kvs                                         │
│   • installationConfig                                       │
│   • canvasTokens:<opaque>                                    │
│   • sessionSigningSecret                                     │
└──────────────────────────────────────────────────────────────┘
                            ▲
                            │ HTTPS, Bearer <sessionJwt>
                            │
┌──────────────────────────────────────────────────────────────┐
│  BOOKMARKLET SDK (target page, vanilla JS)                   │
│   • Injected overlay, pins, sidebar                          │
│   • Auth exchange, pin capture, ticket form, inline edit     │
│   • Console wrapper, screenshot capture                      │
│   • Scope-aware UI (create vs view)                          │
└──────────────────────────────────────────────────────────────┘
                            ▲
                            │ user clicks bookmarklet
                            │
┌──────────────────────────────────────────────────────────────┐
│  TARGET WEB PAGE (any site)                                  │
└──────────────────────────────────────────────────────────────┘

### 3.2 The single core principle

**Jira tickets are the pin store.** Every pin is a ticket. Querying pins = JQL. Creating a pin = create issue. Updating = update issue. Retiring = filtering. No parallel store to sync.

### 3.3 Two token classes, two enforcement points

| Class                | Issued where                   | Gate                                       | Enforced where                 |
| -------------------- | ------------------------------ | ------------------------------------------ | ------------------------------ |
| Canvas token — write | `generateCanvasToken` resolver | `userAccess.hasAccess === true`            | Token existence in KVS         |
| Canvas token — view  | `generateCanvasToken` resolver | User can browse ≥1 ticket in canvas        | Token existence in KVS         |
| Session JWT          | `exchangeToken` webtrigger     | Canvas token valid + installation licensed | `scope` claim on each API call |

Webtriggers never call `userAccess` (unavailable in that context). They enforce `scope` from the JWT and installation `license.active`.

### 3.4 What died from v1.1

Extension, sidepanel React tree, `content.js`, `background.js`, `storage.js`, `jira.js`, `pinLabel.js`, `jiratack://` protocol, pairing flow, config bundle encryption (AES-GCM, PBKDF2, `crypto_key_raw`), hook chain, KVS pin records, KVS URL index, retirement scheduler, `doneAt` timestamps, `pendingNewTicket` session storage, `modulePreload`/polyfill workarounds, message-passing handler map.

### 3.5 What survives

Token model (extended with scope), Jira API conventions, admin config structure (extended), license gating via Marketplace API, visual tokens, `jiratack` label on every created ticket.

---

## 4. Custom Fields

Four custom fields, provisioned by the app and mapped in admin config:

| Internal name     | Type                                          | Example value                 | Purpose                                    |
| ----------------- | --------------------------------------------- | ----------------------------- | ------------------------------------------ |
| `JiraTack Canvas` | single-line text                              | `Marketing Redesign Q3`       | Canvas tag — review round identity         |
| `Page URL`        | URL (or text if URL type unavailable in plan) | `https://example.com/pricing` | Normalized page URL                        |
| `Pin Position`    | single-line text                              | `45.2,32.8` or `840,620`      | Coordinates                                |
| `Pinned Selector` | single-line text                              | `#hero-image`                 | CSS selector if available; empty otherwise |

Constraints:

- `JiraTack Canvas` is single-value, free-form text with spaces allowed.

- Field values are preserved across project moves **only if fields are mapped on the target project's screens**. The admin panel exposes a field mapping audit (§11.3).

- Field IDs are stored in `installationConfig.fieldRegistry`.

---

## 5. Authentication

### 5.1 Two-token model

| Token        | Lifetime | Scope                      | Storage                            | Issued by                      |
| ------------ | -------- | -------------------------- | ---------------------------------- | ------------------------------ |
| Canvas token | 30 days  | `create` or `view`         | Embedded in bookmarklet URL        | `generateCanvasToken` resolver |
| Session JWT  | 8 hours  | Inherits from canvas token | `sessionStorage` keyed by canvasId | `exchangeToken` webtrigger     |

**Write-scoped issuance:**

- `generateCanvasToken(scope: "create")` requires `context.userAccess.hasAccess === true`.

- If false → returns `LICENSE_INACTIVE`, no token minted.

- The user has a paid seat.

**View-scoped issuance:**

- `generateCanvasToken(scope: "view")` requires only that the resolver can authenticate the user and can resolve ≥1 ticket in the canvas as that user (via `asUser().requestJira` JQL with `maxResults=1`).

- Does not check `hasAccess`. Any Jira user with access to any ticket in the canvas can generate a view token.

**Exchange flow:**

1. User clicks bookmarklet → SDK reads `canvasToken` from embedded config.

2. SDK checks `sessionStorage` for a valid JWT for this canvas. If present and not expired, uses it.

3. If absent/expired: `POST /api { action: 'exchangeToken', payload: { canvasToken } }`.

4. Forge validates: token exists in KVS, not revoked, not expired; installation `license.active === true`.

5. Mints HS256 JWT with `scope` from the canvas-token record.

6. SDK stores JWT in `sessionStorage`.

**Revocation:** admin dashboard shows every canvas token with columns `Scope`, `User`, `Canvas`, `Issued`, `Expires`, `Revoke`. Revoking deletes the KVS record. Live session JWTs remain valid until expiry (max 8h). Documented 8h maximum revocation lag.

### 5.2 Why canvas-token-in-bookmarklet

Eliminates per-session re-auth friction. Trade-off: token visible in bookmark properties. Mitigated by: 30-day expiry, canvas scoping, per-user binding, dashboard revocation, optional shorter TTL.

### 5.3 KVS record shape

text

canvasTokens:<opaqueToken> →
{
  canvasName: string,          // = canvasId in v1
  userId: string,              // Atlassian accountId of issuing user
  installationId: string,
  scope: "create" | "view",
  issuedAt: epoch_ms,
  expiresAt: epoch_ms,         // 30d from issuedAt
  revoked: boolean
}
sessionSigningSecret → string   // 256-bit hex, generated once on first bootstrap
installationConfig → { fieldRegistry, projects, configVersion, updatedAt, schemaVersion }

No other KVS keys. No pin storage. No URL index.

---

## 6. Bookmarklet SDK

### 6.1 Webtrigger surface for SDK

text

GET <wt>/bookmarklet.js?v=<buildHash>
  → 200 text/javascript
  → Cache-Control: public, max-age=86400, immutable
  → body: minified SDK (Vite build output)

The `javascript:` bookmarklet body is a bootstrap:

1. Reads embedded config (`token`, `apiBase`, `canvasId`, `canvasName`, `sdkVersion`).

2. If `window.__jiratackActiveCanvas === canvasId`: calls `window.__jiratackClose()` and exits (toggle).

3. Else loads `<apiBase>/../bookmarklet.js?v=<sdkVersion>` via `<script>` tag (async).

4. On load: `window.__jiratackInit({ token, apiBase, canvasId, canvasName, sdkVersion })`.

SDK load failure → inline toast on the page with "JiraTack failed to load — retry in a moment." + retry button.

### 6.2 SDK responsibilities

1. Wrap `console.error` and `console.warn` **immediately** on init (before any await).

2. Exchange canvas token for session JWT if not cached in `sessionStorage`.

3. Call `getPinsForCanvasAndUrl` with normalized `window.location.href`.

4. Render fixed overlay with pins, sidebar, toast container.

5. **Scope-aware rendering:**
   
   - `create`: full overlay — pin mode toggle, inline-edit controls, new-ticket affordance.
   
   - `view`: read-only overlay — no pin mode, no inline edit, no new ticket; clicking a card opens the Jira issue in a new tab; sidebar header shows `View only` badge.

6. Handle new pin capture (capture flow).

7. Handle ticket creation.

8. Handle inline edits (create scope only).

9. Handle re-activation toggle (click bookmarklet again → close overlay).

10. Listen for `pushState`, `replaceState`, `popstate` — debounce 300ms, re-query pins for new URL.

11. On close: remove all `.jiratack-*` elements, restore console functions, remove listeners, clear module state.

**No persistent state.** Only `sessionStorage` for JWT. No `localStorage`.

### 6.3 Overlay structure

text

#jiratack-overlay            position:fixed; inset:0; pointer-events:none; z-index:2147483647
  #jiratack-pins             position:absolute; inset:0; pointer-events:none
    .jiratack-pin[data-key]  position:absolute; pointer-events:auto
  #jiratack-sidebar          position:fixed; right:0; top:0; width:360px; height:100vh; pointer-events:auto
    .jiratack-sidebar-header (canvas name, scope badge, pin-mode toggle, close)
    .jiratack-ticket-list
      .jiratack-ticket-card[data-key]
    .jiratack-new-ticket-form
  #jiratack-toast-container  position:fixed; bottom:16px; right:16px

Pins live in a `position: fixed` overlay so they are immune to CSS transforms on `body` or ancestors.

---

## 7. Forge Webtrigger API

**Base:** `POST <wt>/api`, JSON body `{ action, payload }`, `Authorization: Bearer <sessionJwt>` except `exchangeToken`.

Response envelope:

text

{ ok: true, data: <shape> }
{ ok: false, error: { code, message, details? } }

| Action                   | Required scope                 | Payload                 | Returns                                                                          |
| ------------------------ | ------------------------------ | ----------------------- | -------------------------------------------------------------------------------- |
| `exchangeToken`          | none (canvas token in payload) | `{ canvasToken }`       | `{ sessionJwt, expiresAt, canvasId, canvasName, scope, apiBase, configVersion }` |
| `getPinsForCanvasAndUrl` | `create` or `view`             | `{ canvasId, url }`     | `{ pins: [PinRecord], canvasName, configVersion }`                               |
| `createIssue`            | **`create` only**              | (see §7.3)              | `{ key, id, configVersion }`                                                     |
| `getTransitions`         | `create` or `view`             | `{ issueKey }`          | `{ transitions }`                                                                |
| `updateIssue`            | **`create` only**              | `{ issueKey, fields }`  | `{ configVersion }`                                                              |
| `searchUsers`            | **`create` only**              | `{ projectKey, query }` | `{ users }`                                                                      |

Server rejects out-of-scope calls with `INSUFFICIENT_SCOPE` (HTTP 403).

### 7.1 PinRecord shape

json

{
  "key": "MM-1234",
  "summary": "Hero image misaligned",
  "status": { "name": "In Progress", "category": "indeterminate", "colorName": "yellow" },
  "priority": { "id": "3", "name": "Medium" } | null,
  "assignee": { "accountId": "...", "displayName": "Sam", "avatarUrl": "..." } | null,
  "reporter": { "accountId": "...", "displayName": "Kim", "avatarUrl": "..." } | null,
  "pinPosition": "45.2,32.8",
  "selector": "#hero-image" | null,
  "issueType": { "name": "Bug" },
  "createdAt": "2026-01-15T10:30:00.000Z"
}

### 7.2 JQL for `getPinsForCanvasAndUrl`

text

"JiraTack Canvas" = "<canvasName>"
AND "Page URL" = "<normalizedUrl>"
AND statusCategory != Done
ORDER BY created ASC

Fields param includes the four custom field IDs plus `summary,status,priority,assignee,reporter,issuetype,created`.

### 7.3 `createIssue` — server-side assembly

Client payload:

text

{ canvasId, url, pinPosition, selector, summary, descriptionAdf, screenshotDataUrl,
  consoleLog, issueTypeId, projectKey, priorityId, assigneeAccountId, parentKey }

Server:

1. Validate JWT scope === `create` (else 403).

2. Fetch `installationConfig` → `fieldRegistry`, project config.

3. Verify `projects[projectKey].enabled === true` (else 422 `PROJECT_DISABLED`).

4. Assemble `fields`:
   
   - `summary` = `[JiraTack]` + client summary (idempotent prefix strip first).
   
   - `description` = client ADF, with `consoleLog` appended if present.
   
   - `<canvasFieldId>` = canvasName.
   
   - `<urlFieldId>` = normalized URL.
   
   - `<pinFieldId>` = pinPosition.
   
   - `<selectorFieldId>` = selector (omit if null).
   
   - `issuetype` = `{ id: issueTypeId }`.
   
   - `project` = `{ key: projectKey }`.
   
   - `priority` = `{ id: priorityId }` if non-null.
   
   - `assignee` = `{ accountId: assigneeAccountId }` if non-null.
   
   - `parent` = `{ key: parentKey }` if non-null.
   
   - `reporter` = `{ accountId: jwt.sub }` — **never from client**.
   
   - `labels` = `["jiratack"]`.

5. POST to `/rest/api/3/issue`.

6. If `screenshotDataUrl`: attach via `/rest/api/3/issue/{key}/attachments` with `X-Atlassian-Token: no-check`. On failure: log, proceed silently.

7. If `consoleLog` string non-empty: append to description ADF as per CONTRACTS §8.3.

8. Return `{ key, id, configVersion }`.

9. Retry-once policy on 400: drop the offending auto-created field and retry. Never drop user-input fields.

### 7.4 `updateIssue` — inline edit

- Status → `POST /rest/api/3/issue/{key}/transitions` with `{ transition: { id } }`.

- Priority → `PUT /rest/api/3/issue/{key}` with `{ fields: { priority: { id } } }`.

- Assignee → `PUT /rest/api/3/issue/{key}` with `{ fields: { assignee: { accountId } } }`.

Never free-form status names.

---

## 8. Forge UI Surfaces

### 8.1 Global page — Canvas Dashboard

**Surface:** `jira:globalPage`, Custom UI.

**Layout:**

- Header: "JiraTack Canvases", "How to use" link.

- Search field (filters canvas list client-side).

- Table, one row per canvas:
  
  - Canvas name (bold)
  
  - Open / total ticket count
  
  - URL count
  
  - Last updated
  
  - Participants (avatar stack, max 5)
  
  - Actions:
    
    - **Get write bookmarklet** — license-gated; disabled with tooltip "Your Jira admin has not granted you access to JiraTack" if `hasAccess === false`.
    
    - **Copy review bookmarklet** — not license-gated; requires ≥1 ticket browse access; shows confirmation dialog on first use.
    
    - **Open in Jira** — JQL search URL.
    
    - **Revoke access** — destructive; confirm dialog.

- Help: "Create a ticket with a new canvas name in the JiraTack Canvas field; the canvas appears here automatically."

**Bookmarklet generator modal:**

- Shows canvas name, explains what the bookmarklet does in 3 lines.

- Renders draggable `javascript:` link + "Copy URL" button.

- **For write scope:** "Anyone with this bookmarklet can add pins to this canvas. Keep it in your bookmark bar."

- **For view scope:** "Anyone with this bookmarklet can see all pins and summaries in this canvas. Continue?" (confirmation dialog on first use per user.)

### 8.2 Epic panel

**Surface:** `jira:issuePanel` with epic-type condition.

**Content:**

- "JiraTack Canvases referenced by this epic"

- Per canvas:
  
  - Canvas name
  
  - Ticket count in this epic / total in canvas
  
  - URL count in this epic
  
  - Buttons: **Get write bookmarklet**, **Copy review bookmarklet**, **Open canvas**

- Empty state: "No JiraTack tickets in this epic yet."

**Data:** dual-query merge (§16.3).

### 8.3 Issue panel

**Surface:** `jira:issuePanel` on all issue types.

**Content:**

- If no canvas tag: "Not a JiraTack ticket" (tiny, near-zero footprint).

- Else:
  
  - **Canvas**: name (click → dashboard filtered).
  
  - **Page URL**: clickable.
  
  - **Copy link to this pin** — copies `<pageUrl>?jiratack_ticket=<key>`.
  
  - **Copy review bookmarklet** — same as global page's view action, scoped to this canvas.
  
  - **Related tickets**: this canvas + this URL (compact list, cap 20).

### 8.4 Admin config panel

**Surfaces:** `jira:projectSettingsPage` + `jira:adminPage`.

**Project-level:**

- Enable JiraTack (checkbox).

- Default issue type, priority, assignee.

- Retirement window in days (default 0 = Done never shown).

- Console log capture enabled (default off).

- Console checkbox default state.

**Installation-level:**

- Field provisioning status + manual override.

- Field mapping audit (§11.3).

- Canvas token list (user, canvas, scope, issued, expires, Revoke).

- License status.

---

## 9. Admin Configuration — `installationConfig` shape

json

{
  "fieldRegistry": {
    "canvasField": "customfield_10240",
    "urlField": "customfield_10241",
    "pinField": "customfield_10242",
    "selectorField": "customfield_10243"
  },
  "projects": {
    "MM": {
      "enabled": true,
      "defaultIssueTypeId": "10001",
      "defaultPriorityId": "3",
      "defaultAssigneeAccountId": null,
      "retirementDays": 0,
      "captureConsoleLogs": false,
      "consoleLogsDefaultChecked": false
    }
  },
  "configVersion": "sha256hex",
  "updatedAt": 1234567890,
  "schemaVersion": 1
}

`configVersion` = SHA-256 of canonical `JSON.stringify({ projects, fieldRegistry })`. Recomputed on every write. Included in `exchangeToken`, `createIssue`, `updateIssue`, `getPinsForCanvasAndUrl` responses.

---

## 10. Bookmarklet UI

### 10.1 Activation

text

Click bookmarklet →
  if window.__jiratackActiveCanvas === canvasId:
    SDK.close(); null out; exit
  else:
    ensureSessionJwt();
    fetchPins();
    render();
    window.__jiratackActiveCanvas = canvasId

### 10.2 Sidebar

- **Header**: `📌 <canvas name>` — ticket count `(N open)`; **scope badge** (`View only` for view tokens, absent for create); pin-mode toggle (create only); close `×`.

- **Ticket list**: one card per pin on this URL.
  
  - Collapsed: key (link), summary (truncated 80ch), status badge, priority dot, assignee avatar+name, reporter avatar+name.
  
  - Click → scroll page to pin, highlight both.

- **Card expansion (create scope)**: inline-editable rows.

- **Card expansion (view scope)**: no inline edit; clicking opens Jira issue in new tab.

- **Empty state**: "No pins for this canvas on this page." (create scope adds: "Click Pin mode and then click anywhere to add one.")

### 10.3 Pins

- Default: `#FF6B6B` thumbtack SVG, key badge below.

- Selected: `#E63946`, 1.15×.

- Move mode (create scope): hold ~500ms → `#F4C542`, drag to reposition, release → `updateIssue`; failure reverts + toast.

- Done: `#2ECC71`, opacity 0.5 (only visible when `retirementDays > 0` and within window).

- Hover: tooltip with summary + key.

- Click: selects pin/card pair; both scroll into view.

Only one pin/card pair selected at a time.

### 10.4 Pin mode (create scope only)

Toggle in sidebar header. When active:

- Cursor becomes crosshair.

- Hover element → 2px dashed `#1869DB` outline + tooltip.

- Click:
  
  1. Compute selector (§12.4), position (§12.2), element type.
  
  2. Snapshot console buffer.
  
  3. Capture screenshot (§13.1).
  
  4. Open New Ticket Form.

- `Esc` exits without creating.

---

## 11. Field Provisioning and Mapping

### 11.1 Provisioning flow

On first visit to global admin page after install:

1. `provisionFields` resolver runs as admin user.

2. Checks existing fields; reuses matching name+type, else creates via `POST /rest/api/3/field`.

3. Best-effort: adds all four to default screen's create+edit tabs.

4. Writes `fieldRegistry` to `installationConfig`.

5. Reports per-field success/failure.

Failure modes: insufficient permission (must be site admin with create-field permission); incompatible-type collision (report, ask admin to resolve manually).

### 11.2 Manual override

Four selects on the admin page to map existing fields. Filtered by expected type. Writes `fieldRegistry`.

### 11.3 Mapping audit

Admin page panel:

- Lists projects with ≥1 JiraTack ticket.

- For each, checks all four fields appear on Create and Edit screens (via `/rest/api/3/issue/createmeta/{projectKey}/issuetypes`).

- Missing fields → warning + "Fix" link to `/secure/admin/ConfigureFieldScreen.jspa?id=<screenId>`.

**Documented caveat** surfaced in UI: *"If a project does not have these fields on its screens, moving a ticket into that project will drop its canvas assignment."*

---

## 12. Pin Model

### 12.1 URL normalization (client and server must match)

text

normalize(url):
  parse with new URL()
  strip fragment
  delete tracking params: utm_source, utm_medium, utm_campaign, utm_term,
    utm_content, fbclid, gclid, mc_cid, mc_eid, _hsenc, _hsmi, ref
  lowercase hostname, lowercase protocol
  strip trailing slash from path unless path === "/"
  sort remaining query params alphabetically
  return string

- Protocol is **not** coerced: `http://` ≠ `https://`.

- All non-tracking query params preserved.

- Client and server MUST run identical logic. `urlNormalize.js` is a shared module bundled into both. If duplication is unavoidable, the test vectors in CONTRACTS §6.2 are the acceptance gate.

### 12.2 Pin position format

| Case              | Stored value                   | Semantics                            |
| ----------------- | ------------------------------ | ------------------------------------ |
| Selector resolved | `relX,relY` (e.g. `45.2,32.8`) | % offset within element bounding box |
| No selector       | `absX,absY` (e.g. `840,620`)   | Pixel offset from document origin    |

Mode inferred from `Pinned Selector`: non-empty → relative; empty → absolute.

**Restoration:**

1. If selector present: `document.querySelector(selector)`.
   
   - Found → position = rect + `(relX% × width, relY% × height)`.
   
   - Not found → fall through.

2. If absolute coords valid → place at `(absX, absY)` in page coords.

3. Neither → "detached" cluster in top-right corner with tooltip "Pin location lost." Never silently drop.

### 12.3 Deep-link handling

Bookmarklet reads `window.location.search` for `jiratack_ticket=<key>`:

- If present and matching pin is loaded → highlight + scroll.

- If present but no matching pin → toast "Ticket <key> not found on this canvas/page."

- `jiratack_ticket` stripped from URL used for querying. Purely a hint parameter.

### 12.4 Selector generation (best-effort, in order)

1. `#id` if unique

2. `[data-testid="<value>"]` if unique

3. `tag.class1.class2` if unique

4. `tag[role="<value>"]` if unique

5. `tag` + `:nth-of-type(n)` path from nearest stable ancestor (up to 5 levels)

6. Skip (rely on absolute)

"Unique" = `document.querySelectorAll(sel).length === 1`.

---

## 13. Capture Flows

### 13.1 Screenshot

On pin capture:

1. Hide pins/sidebar (`visibility: hidden`).

2. `html2canvas(document.documentElement, { scale: devicePixelRatio, useCORS: true, logging: false, width: innerWidth, height: innerHeight, x: scrollX, y: scrollY })`.

3. Crop 400×400 centered on pin, clipped to image bounds.

4. Encode `image/webp` @ quality 0.85 via `canvas.toDataURL`. Fall back to PNG.

5. Restore overlay visibility.

6. Store data URL in memory only.

Failure (CORS, tainted canvas, huge page): skip screenshot, proceed silently, log `[JiraTack] screenshot failed`.

### 13.2 Console capture

At SDK init (before any await):

text

const origError = console.error;
console.error = function(...args) {
  buffer.push({ level: 'error', message: stringify(args), source: extractSource(), timestamp: Date.now() });
  if (buffer.length > 50) buffer.shift();
  origError.apply(console, args);
};
// same for console.warn

- On overlay close: restore originals, clear buffer.

- On pin drop: `snapshot = [...buffer]`.

- On submit (if checkbox checked and project config `captureConsoleLogs`): serialize snapshot, pass as `consoleLog`.

**Documented limitation:** capture begins at activation, not page load. Errors before activation are not captured. Workaround: activate bookmarklet, then reload (bookmarklet is not auto-reactivated on reload — user must click again).

Format per entry: `[level] message (source)` when source non-null, `[level] message` otherwise. Level lowercase.

### 13.3 Overlay close

Restores: DOM (removes all `.jiratack-*`), console functions, event listeners, `window.__jiratackActiveCanvas = null`. Idempotent.

---

## 14. Ticket Creation

### 14.1 Form fields (in order)

1. **Project** — only shown if user is member of >1 JiraTack-enabled project. Default: canvas's dominant project or admin default.

2. **Issue type** — filtered to valid types for selected project.

3. **Summary** — locked `[JiraTack]:` prefix adornment; 215-char input limit (total ≤ 255). No line breaks, no control chars.

4. **Description** — Tiptap editor (bold/italic/bullet/ordered/hard-break only).

5. **Priority** — dropdown from allowed priorities.

6. **Assignee** — typeahead via `/rest/api/3/user/assignable/search`.

7. **Parent** — optional, `^[A-Z][A-Z0-9_]+-\d+$`, validated on blur.

8. **Console output** — checkbox. Shown only when project config `captureConsoleLogs: true`. Default from `consoleLogsDefaultChecked`. Disabled (tooltip "No console output captured") when buffer is empty.

9. **Screenshot** — thumbnail preview + "✕ Remove". No re-capture in v1.

10. **Submit / Cancel**.

**Reporter:** never shown. Server sets from JWT `sub`.  
**URL:** never shown. Auto-populated.

### 14.2 Description serialization

Client serializes Tiptap output to ADF via `adfSerializer.js`:

- `paragraph`, `text` (bold/italic marks), `bullet_list`, `ordered_list`, `list_item`, `hard_break`.

- Unsupported nodes: serialize as `paragraph` + `text` with `console.warn`. Never silently dropped.

Console log append (server-side, after ADF received):

text

[ ...clientAdf.content,
  { type: 'paragraph', content: [{ type: 'text', text: 'Console output:' }] },
  { type: 'codeBlock', attrs: {}, content: [{ type: 'text', text: consoleLog }] } ]

### 14.3 Screenshot attachment

Server, after ticket creation:

1. Decode base64 → Buffer.

2. `POST /rest/api/3/issue/{key}/attachments`, multipart, `X-Atlassian-Token: no-check`.

3. Filename: `jiratack-<key>.webp` (or `.png`).

4. On failure: log, proceed. **Never fail ticket creation because of attachment failure.**

### 14.4 Validation

Client-side pre-submit: summary non-empty (≥3 chars after prefix strip), project + issue type selected, description required if project requires it, parent format valid.

Server-side defensive: JWT valid, canvas token not revoked (accept 8h lag — Decision 11), project enabled, issue type valid, mandatory fields present.

On success: toast, sidebar refreshes, pin renders optimistically.

### 14.5 Cancel

Discard form, remove preview pin, clear screenshot memory, return sidebar to ticket list. No server call.

---

## 15. Inline Ticket Editing (create scope only)

| Field    | Control                                | Backend                                       |
| -------- | -------------------------------------- | --------------------------------------------- |
| Status   | select populated from `getTransitions` | `updateIssue { statusId }` → transitions POST |
| Priority | select from allowed                    | `updateIssue { priorityId }`                  |
| Assignee | typeahead via `searchUsers`            | `updateIssue { assigneeAccountId }`           |

**Optimistic:** apply change locally, render. Success: keep. Failure: revert + toast. Timeout: retry once, then fail.

**Done animation:** status → Done → pin flashes `#2ECC71` + checkmark (400ms) → card flashes green → 1.5s → pin fades (300ms), card greyed with "Done" badge, count decrements.

**View scope:** inline-edit controls absent. Card click opens Jira issue in new tab.

**Config refresh:** if `updateIssue` response carries a changed `configVersion`, client fetches fresh config before next render. Never blocks UI.

---

## 16. Queries

### 16.1 Overlay

Per CONTRACTS §7.1.

### 16.2 Dashboard

text

"JiraTack Canvas" is not EMPTY ORDER BY created DESC

Fields: `summary, created, updated, status, assignee, reporter, project, issuetype, <canvasField>`. Aggregate client-side (paginate up to 2000 tickets).

### 16.3 Epic panel

Dual query, merge, dedupe by key:

- Company-managed: `"Epic Link" = <epicKey> AND "<canvasField>" is not EMPTY`

- Team-managed: `parent = <epicKey> AND "<canvasField>" is not EMPTY`

### 16.4 Issue panel

- Canvas name + Page URL: from current issue fields.

- Related: `"<canvasField>" = "<canvas>" AND "<urlField>" = "<url>" AND key != <thisKey> ORDER BY created ASC` (cap 20).

### 16.5 Deep-link

`<pageUrl>?jiratack_ticket=<key>` — resolved by bookmarklet at activation.

---

## 17. Retirement

Retirement is a **query filter**, not deletion.

- **Overlay query** always excludes Done when `retirementDays === 0`.

- **When `retirementDays > 0`:** overlay query includes Done tickets within window:
  
  text
  
  "<canvas>" = "<name>" AND "<url>" = "<url>"
  AND (statusCategory != Done
  
       OR (statusCategory = Done AND statusCategoryChangedDate >= -<N>d))
  
  ORDER BY created ASC
  
  Done pins render `#2ECC71` at opacity 0.5, read-only (no inline edit).

- **Dashboard / epic panel:** never apply retirement (show all tickets, including Done).

- **`doneAt` field:** gone. `statusCategoryChangedDate` is authoritative.

- **Un-done tickets:** automatically reappear because `statusCategory != Done` matches.

---

## 18. License Gating

**Seat enforcement is at write-token issuance, not at every API call.**

- `generateCanvasToken(scope: "create")`: checks `context.userAccess.hasAccess`. If false → returns `LICENSE_INACTIVE`, no token minted. **Only place seat status is checked.**

- `generateCanvasToken(scope: "view")`: does not check `hasAccess`. Checks user can browse ≥1 ticket in canvas. If none → `NO_CANVAS_ACCESS`.

- `exchangeToken`: validates installation `license.active` (application-level). If inactive → 403 `LICENSE_INACTIVE`. Does **not** re-check `hasAccess`.

- `createIssue`, `updateIssue`, `searchUsers`: enforce scope only (`create`). No license check.

- `getPinsForCanvasAndUrl`, `getTransitions`: enforce scope (`create` or `view`). No license check.

**Revocation lifecycle:** when an admin removes a user from `users-with-access`, they also revoke that user's `create`-scoped tokens from the dashboard. Revoking a `view`-scoped token is separate and optional — the admin might keep review access open after a user stops being a licensed seat-holder.

**Development:** `license === undefined` → `license.active` treated as true, `userAccess.hasAccess` treated as true.

---

## 19. Error States

| Condition                               | Behavior                                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| SDK load failure                        | Inline toast "JiraTack failed to load — retry." + retry button                                                             |
| Session JWT expired                     | Silent exchange; if exchange also fails → sidebar "Bookmarklet expired. Generate a new one from Jira." + link to dashboard |
| Canvas token revoked                    | Same as above                                                                                                              |
| License inactive (installation)         | Persistent red banner in sidebar                                                                                           |
| `getPinsForCanvasAndUrl` failure        | Toast "Couldn't load pins. Retry?" + retry button. Cached pins remain visible if already rendered                          |
| `createIssue` field validation failure  | Inline field errors + toast "Fix highlighted fields."                                                                      |
| `createIssue` screenshot attach failure | Silent (logged). Ticket still created                                                                                      |
| `updateIssue` failure                   | Revert optimistic change + toast                                                                                           |
| Pin placement: selector miss            | Fall back to absolute. Both fail → "detached" cluster. Never silent skip                                                   |
| `html2canvas` failure                   | Silent                                                                                                                     |
| Empty console buffer + checkbox checked | Checkbox disabled with tooltip "No console output captured"                                                                |
| View scope attempted write              | UI prevents (controls absent); server rejects with `INSUFFICIENT_SCOPE` if reached                                         |

---

## 20. Jira API Reference

- Search: `GET /rest/api/3/search/jql` — **not** `/search` (deprecated, 410)

- Fields param: `fields=summary,status,priority,assignee,reporter,issuetype,created,updated,project,parent,<canvasFieldId>,<urlFieldId>,<pinFieldId>,<selectorFieldId>`

- Pagination: `nextPageToken`

- Transitions: `GET/POST /rest/api/3/issue/{key}/transitions`

- Update: `PUT /rest/api/3/issue/{key}`

- Attachments: `POST /rest/api/3/issue/{key}/attachments` with `X-Atlassian-Token: no-check`

- User search: `GET /rest/api/3/user/assignable/search?project=<key>&query=<q>` — plain array

- Create meta: `GET /rest/api/3/issue/createmeta/{projectKey}/issuetypes` — `{ values: [] }` in v3

- Fields: `POST /rest/api/3/field`, `GET /rest/api/3/field`

- Screens: `GET /rest/api/3/screens`, `POST /rest/api/3/screens/{id}/tabs/{tabId}/fields`

- Done-status age: `statusCategoryChangedDate` (verify in Sprint 1)

---

## 21. Build Order — Seven Sprints

| Sprint | Scope                                                                                                                  | One-shot viable?                                |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **S1** | Forge scaffolding, manifest, surfaces stubbed, field provisioning, `installationConfig` KVS, admin config UI           | No — Forge behavior discovery                   |
| **S2** | Token issuance (create + view), all webtrigger actions, JQL queries, ADF serializer, URL normalization (shared module) | **Yes, largely** — testable via curl            |
| **S3** | Bookmarklet SDK scaffold: auth, overlay, pins, sidebar render, close, SPA navigation, scope-aware UI                   | Partial — overlay positioning is visual         |
| **S4** | Bookmarklet capture flow: pin mode, screenshot, ticket form, console wrappers, submission                              | Partial — screenshot has runtime variance       |
| **S5** | Canvas dashboard: list, aggregation, bookmarklet generator (both scopes), revoke                                       | **Yes, largely**                                |
| **S6** | Epic panel, issue panel, field mapping audit                                                                           | Partial — dual-query needs both project types   |
| **S7** | Inline editing, Done animation, retirement window, license gating, marketplace prep                                    | Partial — animation and license need real state |

---

## 22. Phase Test Plans (headlines)

Detailed per-phase test plans in TEST_PLAN.md. Acceptance headlines:

- **S1:** Six surfaces render in Jira; webtrigger endpoints respond; field provisioning creates four fields; `installationConfig` round-trips; audit reports clean on fresh install.

- **S2:** Every webtrigger action returns documented shape; scope enforcement works (view token rejected by `createIssue`); URL normalization passes all test vectors; JWT validation rejects tampered tokens.

- **S3:** Bookmarklet loads on any page; overlay renders; pins visible for seeded tickets; view scope hides create controls; close restores page exactly.

- **S4:** Pin drop → ticket appears in Jira → pin restored on re-activation; screenshot attaches when possible; console log appends when enabled.

- **S5:** Dashboard aggregates ≥2 canvases correctly; both bookmarklet types generate; view bookmarklet is not license-gated; revoke works.

- **S6:** Epic panel shows canvases from both project types; issue panel deep-link copies and resolves; audit detects and links to fixes.

- **S7:** Full status lifecycle in sidebar (create scope); Done animation; retirement window respected; view scope read-only; license-inactive blocks `exchangeToken`; marketplace listing passes review.

---

## 23. Open Decisions

**Decision 9 — View-token access delegation.** Because webtriggers cannot act as a user, `getPinsForCanvasAndUrl` under a view token returns pin metadata for all tickets in the canvas regardless of the viewer's Jira project permissions. Access is delegated: the licensed user who generated the view token vouches that tickets are safe to expose. **Recommendation: accept, document in marketplace listing, show confirmation on "Copy review bookmarklet".** Alternative: ship create-scoped only in v1, defer view tokens to v2. **Must be confirmed before Sprint 2.**

**Decision 10 — Webtrigger URL discovery.** Bookmarklet must embed installation-specific webtrigger URLs. Sprint 1 verifies whether `@forge/api` exposes these to a resolver. If not: admin page performs one-time discovery, caches in KVS. **Resolve in Sprint 1.**

**Decision 11 — Revocation lag on `createIssue`.** Server treats JWT as proof without re-checking canvas-token record (max 8h lag). Accept vs. add per-call KVS read. **Recommendation: accept the lag.** Confirm in CONTRACTS review.

---

## 24. Summary of Changes from v1.1

**Removed:** Chrome extension, sidepanel, content script, background service worker, manifest, MV3, `jiratack://`, pairing flow, config bundle, AES-GCM encryption, PBKDF2, `crypto_key_raw`, hook chain, KVS pin store, KVS URL index, `doneAt`, retirement scheduler, `pendingNewTicket`, `modulePreload`/static-import/polyfill workarounds, message-passing handler map, all v1.1 extension test plans.

**Added (v2.2 baseline):** Bookmarklet SDK, Forge webtrigger API, canvas token model, four Jira custom fields, field provisioning, field mapping audit, global dashboard (Custom UI), epic panel, issue panel, JQL-as-pin-index, `statusCategoryChangedDate`-based retirement, `jiratack_ticket` deep-link, `[JiraTack]` server-side prefix enforcement, screenshot via `html2canvas`.

**Added (v2.3 delta):** Two-scope token model (`create` / `view`), license-gated write issuance, view-token access delegation, `INSUFFICIENT_SCOPE` error code, `View only` sidebar badge, scope column on dashboard token list, `Copy review bookmarklet` action on global page / epic panel / issue panel.

**Net effect:** ~40–50% reduction in total build surface vs. v1.1. Zero external infrastructure. Zero extension store friction. Two acknowledged limitations: console capture begins at activation (not page load); view-token access delegation is a design choice requiring explicit consent.

---

**End of SPEC.md v2.3.**
