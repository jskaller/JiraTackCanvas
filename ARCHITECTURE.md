# ARCHITECTURE.md

**Audience:** OpenCode, first read. This is the context document. Precedes CONTRACTS.md.

## 1. System overview

text

┌──────────────────────────────────────────────────────────────────┐
│  FORGE APP (single deployable, Node.js runtime)                  │
│                                                                  │
│  Surfaces:                                                       │
│    • jira:globalPage        → Canvas Dashboard (Custom UI)       │
│    • jira:issuePanel (epic) → Epic panel (UI Kit)                │
│    • jira:issuePanel (any)  → Issue panel (UI Kit)               │
│    • jira:projectSettingsPage → Project config (UI Kit)          │
│    • jira:adminPage         → Installation config (UI Kit)       │
│                                                                  │
│  Webtriggers (public, no Atlassian user context):                │
│    • GET  <wt>/bookmarklet.js → serves SDK bundle                │
│    • POST <wt>/api             → all API actions                 │
│                                                                  │
│  Resolvers (user context, hasAccess available):                  │
│    • generateCanvasToken                                         │
│    • provisionFields                                             │
│    • dashboardAggregate                                          │
│    • epicPanelData                                               │
│    • issuePanelData                                              │
│                                                                  │
│  Storage: @forge/kvs                                             │
│    • installationConfig     (field IDs, project config, version) │
│    • canvasTokens:<tok>     (scope, user, canvas, TTL)           │
│    • sessionSigningSecret   (HMAC key, generated once)           │
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTPS, Bearer <sessionJwt>
                              │
┌──────────────────────────────────────────────────────────────────┐
│  BOOKMARKLET SDK (runs in target page, vanilla JS)               │
│    • Injected overlay, pins, sidebar                             │
│    • Auth exchange, pin capture, ticket form, inline edit        │
│    • Console wrapper, screenshot capture                         │
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ user clicks bookmarklet
                              │
┌──────────────────────────────────────────────────────────────────┐
│  TARGET WEB PAGE (any site)                                      │
└──────────────────────────────────────────────────────────────────┘

## 2. The single core principle

**Jira tickets are the pin store.** Every pin is a ticket. Querying pins = JQL. Creating a pin = create issue. Updating = update issue. Retiring = filtering. There is no parallel store.

Four custom fields on every ticket:

- `JiraTack Canvas` (text) — review round tag

- `Page URL` (URL or text) — normalized

- `Pin Position` (text) — `relX,relY` or `absX,absY`

- `Pinned Selector` (text) — CSS selector or empty

## 3. Two token classes, one enforcement point each

| Class                | Issued where                   | Gate                                       | Enforced where               |
| -------------------- | ------------------------------ | ------------------------------------------ | ---------------------------- |
| Canvas token (write) | `generateCanvasToken` resolver | `userAccess.hasAccess`                     | Token existence              |
| Canvas token (view)  | `generateCanvasToken` resolver | User can browse ≥1 ticket in canvas        | Token existence              |
| Session JWT          | `exchangeToken` webtrigger     | Canvas token valid + installation licensed | Scope claim on each API call |

Webtriggers never check `userAccess`. They enforce `scope` from the JWT and installation `license.active`.

## 4. Data flow — pin creation

text

User clicks "Get write bookmarklet" on global page
  → resolver generateCanvasToken(scope=create)
  → if !userAccess.hasAccess: error LICENSE_INACTIVE, stop
  → mint opaque token, write KVS canvasTokens:<tok> { scope:create, ... }
  → return { token, apiBase, sdkVersion }
Global page renders javascript: bookmarklet embedding token + apiBase + sdkVersion
User drags to bookmark bar
User opens target page, clicks bookmarklet
  → SDK bootstrap loads <apiBase>/bookmarklet.js?v=<sdkVersion>
  → __jiratackInit({ token, apiBase, canvasId, canvasName })
  → sessionStorage has valid JWT? no → exchangeToken
  → webtrigger validates token, license.active, mints JWT with scope
  → SDK caches JWT, calls getPinsForCanvasAndUrl
  → webtrigger runs JQL, returns pins, configVersion
  → SDK renders overlay
User enters pin mode, clicks element
  → SDK computes selector, position, snapshot console, screenshot
  → SDK opens ticket form
User submits
  → SDK calls createIssue
  → webtrigger validates JWT scope=create, builds fields, calls Jira
  → sets reporter from JWT sub, labels=[jiratack], applies prefix
  → attaches screenshot (best-effort)
  → returns key
  → SDK optimistically renders pin, refreshes pins

## 5. Data flow — review (view scope)

text

Licensed user clicks "Copy review bookmarklet" on global page
  → resolver generateCanvasToken(scope=view)
  → if user has browse access to ≥1 ticket in canvas: proceed
  → else error NO_CANVAS_ACCESS, stop
  → mint opaque token, write KVS { scope:view, ... }
  → return bookmarklet
Stakeholder opens page, clicks bookmarklet
  → __jiratackInit
  → exchangeToken → JWT scope=view
  → getPinsForCanvasAndUrl → returns pins (metadata visible per Decision 9)
  → SDK renders overlay read-only: no pin mode, no inline edit, no new ticket
  → Clicking a ticket opens Jira in new tab (Jira enforces permissions)

## 6. Runtime environment

- **Node.js 24.x** (Forge-supported, active LTS). Not 18 (EOL). Not 22 (maintenance LTS, EOL April 2027). Not Python (unsupported).

- **JavaScript** (not TypeScript) throughout, per approved stack decision.

- Forge functions must use static `import` at file top. No dynamic `import()`.

- UI Kit for panels (admin, epic, issue, project settings). Custom UI (React + Vite) for global page only.

- Bookmarklet SDK built with Vite, output as single minified `.js` file.

## 7. What is not in scope

- No Chrome extension

- No proxy service

- No external CDN

- No Python

- No persistent client state (only `sessionStorage` for JWT)

- No webtrigger `asUser()` calls (documented as unsupported — use `asApp()` and set fields explicitly)

- No pin retirement scheduler (retirement is a JQL filter)

- No `doneAt` field (use Jira's `statusCategoryChangedDate`)

## 8. Known constraints

1. **Console capture begins at bookmarklet activation, not page load.** Documented in sidebar tooltip. Accept for v1.

2. **`html2canvas` will fail on some pages** (CORS, tainted canvas, huge pages). Silent fallback to no-screenshot. Accept.

3. **`asUser()` unavailable in webtriggers** → all webtrigger Jira calls run as app. Reporter set explicitly from JWT `sub`. This is the mechanism behind Decision 9.

4. **Custom field values drop on project move** if the target project's screens don't include the field. Mitigated by the field mapping audit.

5. **Webtrigger URLs must be embedded in the bookmarklet.** Mechanism for resolver discovery is **[OPEN] Decision 10** — resolve in Sprint 1.
