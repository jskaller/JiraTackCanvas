# CONTRACTS.md

**Audience:** OpenCode. Every function signature, every request/response shape, every JQL template, every error code, the URL normalization algorithm with test vectors, and the ADF node shapes. This document is normative. Where it disagrees with SPEC v2.2 or v2.3, **CONTRACTS.md wins**.

## Part 1 — Field contracts

### 1.1 Field definitions

| Internal name   | Provisioned field type                                        | Expected field ID shape | Constraints                                                             |
| --------------- | ------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `canvasField`   | `com.atlassian.jira.plugin.system.customfieldtypes:textfield` | `customfield_NNNNN`     | Single-value. Free-form text with spaces. Max 255 chars.                |
| `urlField`      | `com.atlassian.jira.plugin.system.customfieldtypes:url`       | `customfield_NNNNN`     | Fallback to `textfield` if URL type unavailable in plan. Max 255 chars. |
| `pinField`      | `com.atlassian.jira.plugin.system.customfieldtypes:textfield` | `customfield_NNNNN`     | `relX,relY` or `absX,absY`. Max 32 chars.                               |
| `selectorField` | `com.atlassian.jira.plugin.system.customfieldtypes:textfield` | `customfield_NNNNN`     | CSS selector or empty. Max 512 chars.                                   |

### 1.2 `installationConfig` shape (stored in KVS)

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

`configVersion` = SHA-256 hex of `JSON.stringify({ projects, fieldRegistry })` (stable key ordering — use a canonical JSON serializer). Recompute on every write.

### 1.3 `provisionFields` — resolver contract

text

provisionFields(context) → { ok, fieldIds: { canvasField, urlField, pinField, selectorField }, warnings: [string] }

Behavior:

1. Query `/rest/api/3/field` → list existing fields.

2. For each of the four fields, if a field with the exact name exists and type matches: reuse. Else create via `POST /rest/api/3/field`.

3. Best-effort: add each field to the default screen's create+edit tabs (`/rest/api/3/screens/{defaultScreenId}/tabs/{tabId}/fields`).

4. Write `fieldRegistry` to `installationConfig`.

5. Return.

Warnings if: (a) a field exists with incompatible type, (b) screen manipulation fails.

## Part 2 — Token contracts

### 2.1 Canvas token

- Generation: 32 random bytes from `crypto.randomBytes(32).toString('hex')` → 64-char hex string.

- Storage: KVS `canvasTokens:<token>`, TTL 30 days via Forge KVS native TTL.

- Record:

text

{
  canvasName: string,       // 1..255 chars
  userId: string,           // Atlassian accountId of issuing user
  installationId: string,
  scope: "create" | "view",
  issuedAt: epoch_ms,
  expiresAt: epoch_ms,
  revoked: boolean
}

### 2.2 Session JWT

- Algorithm: **HS256** (HMAC-SHA256). Symmetric because only this app validates it — no key distribution problem, and `jose` or `jsonwebtoken` handles it natively in Node.

- Secret: 256-bit hex from `sessionSigningSecret` KVS key. Generated once at first bootstrap via `crypto.randomBytes(32).toString('hex')`. Never rotated in v1 (rotation would invalidate up to 8h of sessions — defer to v3 if needed).

- Claims:

text

{
  iss: "jiratack",
  sub: "<accountId>",           // issuing user
  aud: "<installationId>",
  canvasId: "<canvasId>",       // this is the canvasName in v1 — see note below
  canvasName: "<name>",
  scope: "create" | "view",
  iat: <epoch_s>,
  exp: <epoch_s + 28800>        // 8h
}

**Note on `canvasId`:** v1 uses the canvas *name* as its identifier (per approved decision — canvas is a tag, not an entity). So `canvasId === canvasName`. The claim is named `canvasId` to leave room for a future canvas entity without a breaking change. `exchangeToken` returns both `canvasId` and `canvasName` with the same value in v1.

- Validation: on every webtrigger API call, parse `Authorization: Bearer <jwt>`. Verify signature against `sessionSigningSecret`. Verify `exp > now`. Verify `aud === <this installation's id>` (from `context.installationId` in the webtrigger). Extract `scope`, `sub`, `canvasId`. Reject on any failure with 401 `TOKEN_INVALID` or `TOKEN_EXPIRED`.

## Part 3 — Webtrigger API contracts

**Base path:** `<wt>/api` — `POST`, `Content-Type: application/json`, `Authorization: Bearer <sessionJwt>` for all except `exchangeToken`.

**Response envelope (all actions):**

text

{ ok: true, data: <shape> }
{ ok: false, error: { code: <string>, message: <string>, details?: <any> } }

**HTTP status codes:** 200 for `ok: true`; 400 `BAD_REQUEST`; 401 `TOKEN_INVALID`/`TOKEN_EXPIRED`; 403 `INSUFFICIENT_SCOPE`/`LICENSE_INACTIVE`; 404 `NOT_FOUND`; 422 `VALIDATION_ERROR`; 500 `INTERNAL`.

### 3.1 `exchangeToken`

text

Request:  { action: "exchangeToken", payload: { canvasToken: string } }
Auth:     none

text

Success data: {
  sessionJwt: string,
  expiresAt: epoch_s,
  canvasId: string,
  canvasName: string,
  scope: "create" | "view",
  apiBase: string,              // echo of <wt>/api for SDK
  configVersion: string
}

Errors: `TOKEN_INVALID` (no KVS record or `revoked === true`), `TOKEN_EXPIRED` (expiresAt < now), `LICENSE_INACTIVE` (installation license inactive).

### 3.2 `getPinsForCanvasAndUrl`

text

Request:  { action: "getPinsForCanvasAndUrl", payload: { canvasId: string, url: string } }
Auth:     Bearer, scope create or view

Server normalizes `url` (Part 6) — never trusts client normalization.

text

Success data: {
  pins: [PinRecord],
  canvasName: string,
  configVersion: string
}

`PinRecord` shape:

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

JQL: see Part 7.1.

### 3.3 `createIssue`

text

Request: {
  action: "createIssue",
  payload: {
    canvasId: string,
    url: string,
    pinPosition: string,          // "relX,relY" or "absX,absY"
    selector: string | null,
    summary: string,              // without [JiraTack] prefix
    descriptionAdf: object | null,
    screenshotDataUrl: string | null,   // "data:image/webp;base64,..." or webp/png
    consoleLog: string | null,          // preformatted multi-line text
    issueTypeId: string,
    projectKey: string,
    priorityId: string | null,
    assigneeAccountId: string | null,
    parentKey: string | null
  }
}
Auth:     Bearer, scope create only

text

Success data: { key: string, id: string, configVersion: string }

Server behavior:

1. Validate JWT scope === `create` (else 403 `INSUFFICIENT_SCOPE`).

2. Fetch `canvasTokens:<token>` — but token is not in JWT. Re-fetch by looking up `canvasTokens` where `canvasName === canvasId`. **Implementation note:** for v1, the JWT is sufficient proof; server does not re-fetch the canvas token on each create. If revocation must take effect immediately, add a `revoked` check — but that costs a KVS read per create. **Recommendation: accept 8h revocation lag; document it.**

3. Resolve `installationConfig` → `fieldRegistry`, project config.

4. Verify project enabled (`projects[projectKey].enabled === true`) else 422 `PROJECT_DISABLED`.

5. Assemble `fields`:
   
   - `summary` = `[JiraTack]` + payload.summary (prefix enforced server-side; strip any client-sent prefix first).
   
   - `description` = client ADF, with consoleLog appended if present (Part 8.3).
   
   - `<canvasFieldId>` = canvasName.
   
   - `<urlFieldId>` = normalized URL.
   
   - `<pinFieldId>` = pinPosition.
   
   - `<selectorFieldId>` = selector (omit if null).
   
   - `issuetype` = `{ id: issueTypeId }`.
   
   - `project` = `{ key: projectKey }`.
   
   - `priority` = `{ id: priorityId }` if non-null.
   
   - `assignee` = `{ accountId: assigneeAccountId }` if non-null.
   
   - `parent` = `{ key: parentKey }` if non-null.
   
   - `reporter` = `{ accountId: jwt.sub }` (never from client).
   
   - `labels` = `["jiratack"]`.

6. `POST /rest/api/3/issue`.

7. If `screenshotDataUrl`: `POST /rest/api/3/issue/{key}/attachments` with `X-Atlassian-Token: no-check`. On failure: log `[JiraTack] attachment failed <key>`, proceed.

8. Return.

Jira 400 with field errors → return 422 `VALIDATION_ERROR` with `details.fieldErrors`. Retry-once policy (drop offending field) applies only to auto-created custom fields (canvasField, urlField, pinField, selectorField) — never to user-input fields.

### 3.4 `getTransitions`

text

Request:  { action: "getTransitions", payload: { issueKey: string } }
Auth:     Bearer, scope create or view
Success data: { transitions: [{ id, name, to: { id, name, statusCategory: { key } } }] }

Proxies to `GET /rest/api/3/issue/{issueKey}/transitions?expand=transitions.fields`. Returns transitions only.

### 3.5 `updateIssue`

text

Request: {
  action: "updateIssue",
  payload: {
    issueKey: string,
    fields: {
      statusId?: string,        // transition id, not status id
      priorityId?: string,
      assigneeAccountId?: string | null
    }
  }
}
Auth:     Bearer, scope create only
Success data: { configVersion: string }

Behavior:

- If `fields.statusId`: `POST /rest/api/3/issue/{issueKey}/transitions` with `{ transition: { id: statusId } }`.

- If `fields.priorityId` or `fields.assigneeAccountId`: `PUT /rest/api/3/issue/{issueKey}` with `{ fields: { priority: { id }, assignee: accountId ? { accountId } : null } }`. Only include keys present in the payload.

- Jira 400 → 422 `VALIDATION_ERROR`.

### 3.6 `searchUsers`

text

Request:  { action: "searchUsers", payload: { projectKey: string, query: string } }
Auth:     Bearer, scope create only
Success data: { users: [{ accountId, displayName, avatarUrl }] }

Proxies `GET /rest/api/3/user/assignable/search?project={projectKey}&query={query}&maxResults=10`. v3 returns a plain array (not `{values:[]}`) — verify in Sprint 1.

## Part 4 — Resolver contracts (user-context, `hasAccess` available)

### 4.1 `generateCanvasToken`

text

generateCanvasToken(context, payload) → { ok, data: { token, apiBase, sdkVersion, scope } } | { ok: false, error }
Payload: { canvasName: string, scope: "create" | "view" }

Behavior:

- If `scope === "create"`:
  
  - `if (!context.userAccess?.hasAccess) return LICENSE_INACTIVE`.

- If `scope === "view"`:
  
  - Verify user can browse ≥1 ticket in canvas: `asUser().requestJira('/rest/api/3/search/jql', { body: { jql: '<canvasField> = "<name>"', maxResults: 1 } })`. If empty, return `NO_CANVAS_ACCESS`.

- Mint opaque token (Part 2.1), write KVS, return with `apiBase` (the `/api` webtrigger URL) and `sdkVersion` (build hash injected at deploy time).

### 4.2 `dashboardAggregate`

text

dashboardAggregate(context) → { ok, data: { canvases: [CanvasSummary], configVersion } }
CanvasSummary: {
  canvasName, ticketCount, openCount, urlCount, lastUpdated, participants: [{ accountId, displayName, avatarUrl }]
}

JQL: `<canvasField> is not EMPTY ORDER BY created DESC`. Fetch fields `<canvasField>,status,updated,assignee,reporter`. Paginate up to 2000 tickets; aggregate client-side. Group by `canvasField` value.

### 4.3 `epicPanelData`

text

epicPanelData(context, payload) → { ok, data: { canvases: [EpicCanvasSummary] } }
Payload: { epicKey: string }
EpicCanvasSummary: { canvasName, epicTicketCount, totalTicketCount, urlCount }

Dual-query, merge results:

- Company-managed: `"Epic Link" = <epicKey> AND <canvasField> is not EMPTY`

- Team-managed: `parent = <epicKey> AND <canvasField> is not EMPTY`

Group by `canvasField`. For each canvas, run one additional count query (`<canvasField> = "<name>"`) to get `totalTicketCount`.

### 4.4 `issuePanelData`

text

issuePanelData(context, payload) → { ok, data: { canvasName, url, relatedTickets, deepLink } }
Payload: { issueKey: string }

Reads the current issue via `asApp().requestJira('/rest/api/3/issue/{key}?fields=<canvasField>,<urlField>')`. If canvas empty → return `{ ok: true, data: { isJiraTack: false } }`. Else run related query.

### 4.5 `fieldMappingAudit`

text

fieldMappingAudit(context) → { ok, data: { projects: [{ key, name, missingFields: [string], fixUrl: string }] } }

Behavior:

1. JQL `<canvasField> is not EMPTY`, aggregate distinct project keys.

2. For each project, call `/rest/api/3/issue/createmeta/{projectKey}/issuetypes/{issueTypeId}` for one enabled type; get field list.

3. Check each of the four field IDs present. Missing → add to `missingFields`.

4. `fixUrl` = `/secure/admin/ConfigureFieldScreen.jspa?id=<screenId>` — resolves the create screen for the project.

## Part 5 — Bookmarklet SDK contracts

### 5.1 Init contract

javascript

window.__jiratackInit(config)
// config: {
//   token: string,           // canvas token
//   apiBase: string,         // e.g. "https://<wt>/api"
//   canvasId: string,        // canvas name in v1
//   canvasName: string,
//   sdkVersion: string
// }

Called by the bookmarklet bootstrap after the SDK script loads. If `window.__jiratackActiveCanvas === config.canvasId`, calls `__jiratackClose()` and returns (toggle behavior).

### 5.2 Overlay DOM contract

text

#jiratack-overlay                 position:fixed; inset:0; pointer-events:none; z-index:2147483647
  #jiratack-pins                  position:absolute; inset:0; pointer-events:none
    .jiratack-pin[data-key]       position:absolute; pointer-events:auto
      .jiratack-pin-head
      .jiratack-pin-badge         (ticket key)
  #jiratack-sidebar               position:fixed; right:0; top:0; width:360px; height:100vh; pointer-events:auto
    .jiratack-sidebar-header      (canvas name, scope badge, pin-mode toggle, close)
    .jiratack-ticket-list
      .jiratack-ticket-card[data-key]
    .jiratack-new-ticket-form     (hidden unless in capture flow)
  #jiratack-toast-container       position:fixed; bottom:16px; right:16px; pointer-events:none
    .jiratack-toast               pointer-events:auto

All classes prefixed `jiratack-` to avoid collisions with page CSS. All overlay elements removed on `__jiratackClose()`.

### 5.3 Session storage keys

- `jiratack_jwt_<canvasId>` → `{ jwt: string, expiresAt: epoch_s, scope: string }`

- Nothing else. Never `localStorage`, never persistent on target page.

### 5.4 Close contract

`window.__jiratackClose()` must:

1. Remove all `.jiratack-*` elements from the page.

2. Restore original `console.error` / `console.warn` (if wrapped).

3. Remove all event listeners registered by the SDK.

4. Set `window.__jiratackActiveCanvas = null`.

5. Be idempotent (safe to call twice).

## Part 6 — URL normalization (shared client/server)

**This is the most bug-prone part of the system.** Client and server MUST use byte-identical logic. Recommendation: a single JS module (`urlNormalize.js`) bundled into both the SDK and the Forge functions. If duplication is unavoidable, use the test vectors below as the acceptance gate.

### 6.1 Algorithm

javascript

function normalizeUrl(input) {
  if (!input) return '';
  let u;
  try { u = new URL(input); } catch { return input.trim(); }
  u.hash = '';                                    // strip fragment
  const trackingParams = [
    'utm_source','utm_medium','utm_campaign','utm_term','utm_content',
    'fbclid','gclid','mc_cid','mc_eid','_hsenc','_hsmi','ref'
  ];
  for (const p of trackingParams) u.searchParams.delete(p);
  u.hostname = u.hostname.toLowerCase();
  u.protocol = u.protocol.toLowerCase();
  // strip trailing slash from path unless root
  if (u.pathname !== '/' && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  // sort remaining params for determinism
  const sorted = [...u.searchParams.entries()].sort(([a],[b]) => a.localeCompare(b));
  u.search = sorted.length ? '?' + sorted.map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
  return u.toString();
}

Notes:

- Do **not** coerce http → https. Distinct URLs, distinct pins.

- Do **not** strip non-tracking query params (they're page identity).

- Path is preserved exactly (case, encoding).

### 6.2 Test vectors (acceptance gate)

| Input                                         | Output                                 |
| --------------------------------------------- | -------------------------------------- |
| `https://example.com/page`                    | `https://example.com/page`             |
| `https://example.com/page/`                   | `https://example.com/page`             |
| `https://example.com/page#section`            | `https://example.com/page`             |
| `https://Example.COM/Page`                    | `https://example.com/Page`             |
| `https://example.com/page?utm_source=x&id=42` | `https://example.com/page?id=42`       |
| `https://example.com/page?id=42&ref=twitter`  | `https://example.com/page?id=42`       |
| `https://example.com/page?id=42&a=1`          | `https://example.com/page?a=1&id=42`   |
| `http://example.com/page`                     | `http://example.com/page`              |
| `https://example.com/`                        | `https://example.com/`                 |
| `https://example.com/page?b=2&a=1&c=3`        | `https://example.com/page?a=1&b=2&c=3` |

## Part 7 — JQL templates

### 7.1 Overlay query (`getPinsForCanvasAndUrl`)

text

"<canvasFieldName>" = "<canvasName>"
AND "<urlFieldName>" = "<normalizedUrl>"
AND statusCategory != Done
ORDER BY created ASC

Fields param: `summary,status,priority,assignee,reporter,issuetype,created,<canvasFieldId>,<urlFieldId>,<pinFieldId>,<selectorFieldId>`

`<canvasFieldName>` and `<urlFieldName>` are the **display names** (`JiraTack Canvas`, `Page URL`) — JQL uses names, not IDs.

### 7.2 Retirement window (if `projects[projectKey].retirementDays > 0`)

text

"<canvas>" = "<name>" AND "<url>" = "<url>"
AND (
  statusCategory != Done
  OR (statusCategory = Done AND statusCategoryChangedDate >= -<N>d)
)
ORDER BY created ASC

If `retirementDays === 0` (default): overlay query is §7.1 (Done always hidden).

### 7.3 Dashboard

text

"<canvasFieldName>" is not EMPTY ORDER BY created DESC

### 7.4 Epic panel (merge two queries)

text

Company-managed: "Epic Link" = <epicKey> AND "<canvasFieldName>" is not EMPTY
Team-managed:    parent = <epicKey> AND "<canvasFieldName>" is not EMPTY

### 7.5 Issue panel related

text

"<canvasFieldName>" = "<canvas>" AND "<urlFieldName>" = "<url>" AND key != <thisKey>
ORDER BY created ASC

## Part 8 — Serialization contracts

### 8.1 ADF node shapes (client serializer output)

Tiptap node → ADF:

| Tiptap node        | ADF output                                                   |
| ------------------ | ------------------------------------------------------------ |
| `paragraph`        | `{ type: "paragraph", content: [...] }`                      |
| `text` (plain)     | `{ type: "text", text: "..." }`                              |
| `text` with bold   | `{ type: "text", text: "...", marks: [{ type: "strong" }] }` |
| `text` with italic | `{ type: "text", text: "...", marks: [{ type: "em" }] }`     |
| `bulletList`       | `{ type: "bulletList", content: [listItem...] }`             |
| `orderedList`      | `{ type: "orderedList", content: [listItem...] }`            |
| `listItem`         | `{ type: "listItem", content: [paragraph...] }`              |
| `hardBreak`        | `{ type: "hardBreak" }`                                      |

Unsupported nodes: serialize as `{ type: "paragraph", content: [{ type: "text", text: <node.textContent> }] }` + `console.warn('[JiraTack] Unsupported node:', node.type)`.

Root document: `{ type: "doc", version: 1, content: [top-level nodes] }`.

### 8.2 Empty description

If the user leaves description empty: send `descriptionAdf = null`. Server omits the `description` field entirely (never sends an empty doc — Jira rejects `{ type: "doc", content: [] }` in some configurations).

### 8.3 Console log append (server-side)

If `consoleLog` is non-null and non-empty, wrap:

text

[ ...clientAdf.content,
  { type: "paragraph", content: [{ type: "text", text: "Console output:" }] },
  { type: "codeBlock", attrs: {}, content: [{ type: "text", text: consoleLog }] } ]

Client formats `consoleLog` as:

text

[error] TypeError: Cannot read property 'x' of undefined (at main.js:142)
[warn] Deprecated API usage: getElementByClass (at app.js:89)

Per entry: `[level] message (source)` when source non-null, `[level] message` when null. Level lowercase.

## Part 9 — Error code registry

| Code                 | HTTP | Meaning                                                           | User-facing behavior                                                            |
| -------------------- | ---- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `BAD_REQUEST`        | 400  | Malformed payload                                                 | Toast "Something went wrong — check the form and try again."                    |
| `TOKEN_INVALID`      | 401  | JWT signature invalid / canvas token not found                    | Sidebar shows "Session expired. Reopen the bookmarklet."                        |
| `TOKEN_EXPIRED`      | 401  | Canvas token or JWT expired                                       | Same as above; suggests regenerating bookmarklet from Jira                      |
| `INSUFFICIENT_SCOPE` | 403  | JWT scope doesn't allow this action                               | Hidden in client (UI-gated); if somehow reached, toast "View-only bookmarklet." |
| `LICENSE_INACTIVE`   | 403  | Installation license inactive                                     | Persistent red banner in sidebar                                                |
| `NO_CANVAS_ACCESS`   | 403  | User can't browse any ticket in canvas (view-token issuance only) | Admin UI error on "Copy review bookmarklet"                                     |
| `NOT_FOUND`          | 404  | Ticket / project / canvas not found                               | Toast "Not found."                                                              |
| `PROJECT_DISABLED`   | 422  | Target project has JiraTack disabled                              | Inline error on project selector                                                |
| `VALIDATION_ERROR`   | 422  | Jira rejected the field payload                                   | Inline field errors + toast "Fix highlighted fields."                           |
| `INTERNAL`           | 500  | Unexpected server error                                           | Toast "Something went wrong — try again." + `[JiraTack]` log                    |

## Part 10 — Package and manifest shapes

### 10.1 `manifest.yml` (skeleton)

yaml

app:
  id: ari:cloud:ecosystem::app/<uuid>
  runtime:
    name: nodejs22.x
  licensing:
    enabled: true
  permissions:
    scopes:
      - read:jira-work
      - write:jira-work
      - read:jira-user
      - manage:jira-project
    external:
      fetch:
        backend:
          - "*.atlassian.net"
modules:
  jira:globalPage:
    - key: jiratack-dashboard
      resource: dashboard-ui
      resolver:
        function: dashboard-resolver
      title: JiraTack Canvases
  jira:issuePanel:
    - key: jiratack-epic-panel
      resource: epic-panel-ui
      resolver:
        function: epic-resolver
      title: JiraTack Canvases
      # Epic-type condition set at deployment — see BUILD_PLAN Sprint 6
    - key: jiratack-issue-panel
      resource: issue-panel-ui
      resolver:
        function: issue-resolver
      title: JiraTack
  jira:projectSettingsPage:
    - key: jiratack-project-config
      resource: project-config-ui
      resolver:
        function: config-resolver
      title: JiraTack
  jira:adminPage:
    - key: jiratack-admin
      resource: admin-ui
      resolver:
        function: admin-resolver
      title: JiraTack
  function:
    - key: dashboard-resolver
      handler: resolvers/dashboard.handler
    - key: epic-resolver
      handler: resolvers/epic.handler
    - key: issue-resolver
      handler: resolvers/issue.handler
    - key: config-resolver
      handler: resolvers/config.handler
    - key: admin-resolver
      handler: resolvers/admin.handler
    - key: webtrigger-api
      handler: webtrigger/api.handler
    - key: webtrigger-sdk
      handler: webtrigger/sdk.handler
  webtrigger:
    - key: jiratack-api
      function: webtrigger-api
    - key: jiratack-sdk
      function: webtrigger-sdk
resources:

- key: dashboard-ui
  path: src/custom-ui/dashboard/dist
- key: epic-panel-ui
  path: src/ui-kit/epic-panel
- key: issue-panel-ui
  path: src/ui-kit/issue-panel
- key: project-config-ui
  path: src/ui-kit/project-config
- key: admin-ui
  path: src/ui-kit/admin

### 10.2 `package.json` (root, Forge app)

json

{
  "name": "jiratack",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build:bookmarklet": "vite build --config vite.bookmarklet.config.js",
    "build:dashboard": "vite build --config vite.dashboard.config.js",
    "build": "npm run build:bookmarklet && npm run build:dashboard",
    "deploy": "forge deploy -e development",
    "tunnel": "forge tunnel"
  },
  "dependencies": {
    "@forge/api": "^4",
    "@forge/kvs": "^1",
    "@forge/resolver": "^1",
    "@forge/ui": "^1",
    "@forge/ui-jira": "^1",
    "html2canvas": "^1.4",
    "jsonwebtoken": "^9"
  },
  "devDependencies": {
    "forge-cli": "latest",
    "vite": "^5",
    "@vitejs/plugin-react": "^4",
    "react": "^18",
    "react-dom": "^18"
  }
}

## Part 11 — [OPEN] decisions

**Decision 9 (from SPEC v2.3):** view-token access delegation model — pins/summaries visible to any view-token holder regardless of Jira project permissions. Approve or reject before Sprint 2.

**Decision 10 (from SPEC v2.3):** webtrigger URL discovery mechanism from a resolver. Sprint 1 verifies via `@forge/api`; if unavailable, use admin bootstrap action + KVS cache. Sprint 1 deliverable includes a working test.

**Decision 11 (new, from CONTRACTS §3.3):** revocation lag on `createIssue` — server accepts JWT as proof without re-checking canvas token record (8h max lag). Approve or add per-call KVS check (small latency/cost cost). **Recommendation: accept the lag.**
