# CONTRACTS.md

**Audience:** OpenCode. Every function signature, request/response shape, JQL template, error code, URL normalisation rule, and ADF node shape.
**Precedence:** Where this document disagrees with SPEC.md or ARCHITECTURE.md on wire-level details, this document wins. Where it disagrees with DECISIONS.md, DECISIONS.md wins.
**Verified against:** `src/` at commit `acde065`, app 4.92.0, SDK `731d221968a1`, 2026-10-30.

---

## Part 1 — Data contracts

### 1.1 Pin metadata property

Machine-readable pin data lives in the Jira issue property `com.jiratack.metadata`. There are no custom fields, no description marker, and no recovery pass (D18).

```json
{
  "guest": { "name": "Ada Lovelace", "email": "ada@example.com" },
  "pin": {
    "canvas": "Q3 Marketing",
    "url": "https://example.com/pricing",
    "position": "45.2,32.8",
    "selector": "#hero-image"
  },
  "version": 1
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `pin.canvas` | string | Required, non-empty. 1–255 chars at issuance. |
| `pin.url` | string | Required, non-empty, normalised (§6.1) and absolute `http(s)`. |
| `pin.position` | string | Required, non-empty. `relX,relY` or `absX,absY` (SPEC §12.2). |
| `pin.selector` | string \| null | `null` when no stable selector was found. Empty strings normalise to `null`. |
| `guest.name`, `guest.email` | string | Optional; present only on guest tickets. |
| `version` | number | `1`. Defaults to `1` when absent. |

**Normalisation on write.** `normalizeMetadata()` returns `null` unless `pin.canvas`, `pin.url` and `pin.position` are all non-empty strings. `writeMetadata` rejects a `null` result with `VALIDATION_ERROR` and retries once on transport failure.

**Labels.**

- `jiratack` — every ticket the app creates. This is the query index.
- `jiratack-guest` — additionally on guest tickets. Additive, never exclusive.

**Search alias.** `manifest.yml` declares `jira:entityProperty` for entity `issue`, `propertyKey: com.jiratack.metadata`, path `pin.canvas`, `searchAlias: jiratackCanvas`. Indexing applies from deployment forward; older tickets may not be indexed, so in-memory filtering is the primary path.

### 1.2 `installationConfig` shape (stored in KVS)

```json
{
  "viewPermissionMode": "per_user_projects",
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
  "archivedCanvases": [],
  "deletedCanvases": [],
  "configVersion": "sha256hex",
  "updatedAt": 1234567890,
  "schemaVersion": 1
}
```

- `viewPermissionMode`: `"per_user_projects"` (default) | `"open"` (D9).

- `configVersion` = SHA-256 hex of canonical `JSON.stringify({ projects, viewPermissionMode })`. Recomputed on every write. **`fieldRegistry` is not part of it; the key no longer exists.**

- Project entries merge over defaults on read (`PROJECT_DEFAULTS` in `src/resolvers/actions/config.js`), so an absent project has `enabled: true` and `retirementDays: 0`.

- **Read semantics:** a KVS read error throws (`"Installation config is unavailable."`). It never returns defaults, because a transient failure once got persisted back over real configuration.

- **Write semantics:** writes go through `mutateInstallationConfig(mutator, attempts = 3)`, which reads and writes in one window. `setInstallationConfig` merges `payload.projects` shallowly. True compare-and-set is outstanding.

### 1.3 `provisionFields` — retired (D18)

Removed with custom fields. No resolver, no field registry, no screen manipulation. Do not reintroduce a provisioning path; the app writes one property and two labels per ticket.

---

## Part 2 — Token contracts

### 2.1 Canvas and guest tokens

- Generation: `crypto.randomBytes(32).toString('hex')` → 64-char hex.

- Storage: KVS `canvasTokens:<token>`, written with `{ ttl: { value: 30, unit: 'DAYS' } }` for canvas tokens and `{ ttl: { value: 365, unit: 'DAYS' } }` for guest tokens.

- **Canvas record:**

```json
{
  "canvasName": "string, 1..255 chars",
  "userId": "Atlassian accountId of issuing user",
  "installationId": "string",
  "scope": "create | view",
  "isAdmin": true,
  "permittedProjectsJson": "[\"MM\",\"QA\"] or \"*\"",
  "issuedAt": 1234567890000,
  "expiresAt": 1234567890000,
  "revoked": false
}
```

- **Guest record** (same key prefix):

```json
{
  "scope": "guest_create",
  "issuer": "accountId of the seat holder who minted it",
  "isAdmin": false,
  "permittedCanvases": ["Q3 Marketing"],
  "permittedProjectsJson": "[\"MM\"]",
  "installationId": "string",
  "issuedAt": 1234567890000,
  "expiresAt": 1234567890000,
  "revoked": false
}
```

Guest records have no `canvasName` and no `userId`. `listCanvasTokens` returns those fields as `undefined` for them.

`permittedProjects` is serialised as a JSON **string** in the record and parsed back at exchange time. Parsing failure yields `[]`, never `"*"`.

### 2.2 Session JWT

- Algorithm: **HS256**, `jsonwebtoken`.

- Secret: 256-bit hex under KVS key `sessionSigningSecret`, created on first use with `{ version: { type: 'must_be_missing' } }` so concurrent cold starts cannot orphan each other's tokens. Stored as a plain value, not `kvs.setSecret`; migration is tracked in the security review. Never rotated in v1.

- Claims:

```json
{
  "iss": "jiratack",
  "sub": "issuing accountId (for guests: the issuer's)",
  "aud": "installationId",
  "canvasId": "canvasName, when canvas-bound",
  "canvasName": "canvasName, when canvas-bound",
  "scope": "create | view | guest_create",
  "permittedProjects": ["MM", "QA"] | "*",
  "permittedCanvases": ["Q3 Marketing"],
  "issuer": "accountId",
  "isAdmin": true,
  "iat": 1234567890,
  "exp": 1234596690
}
```

`permittedCanvases` and `issuer` appear only on guest tokens. `canvasId`/`canvasName` are absent for personal and guest tokens.

**`isAdmin` (D21).** Resolved at issuance from resolver context (`userAccess.isAdmin`, falling back to `mypermissions?permissions=ADMINISTER`), persisted in the record and copied into every session JWT. Guests are always `false`. A missing claim is treated as `false`, so tokens minted before D21 cannot perform admin-only actions until re-issued.

**`universal` is not a scope.** It survives in some allowlists and SDK checks but no generator mints it. Treat it as vestigial.

**Validation.** Verify signature and `exp > now`, then compare `claims.aud` with the current installation ARI (falling back to `req.context.installContext`/`installationId`); a mismatch is `TOKEN_INVALID`. Reject missing/malformed headers, expired signatures (`TOKEN_EXPIRED`), and disallowed scopes (`INSUFFICIENT_SCOPE`).

**Expiry comparison.** Token records store `expiresAt` in epoch **milliseconds** and are compared with `Date.now()`. The JWT `exp` is epoch **seconds**.

### 2.3 Personal (user) token

```json
{
  "userId": "Atlassian accountId",
  "installationId": "string",
  "scope": "create | view",
  "isAdmin": true,
  "permittedProjectsJson": "[\"MM\",\"QA\"] or \"*\"",
  "issuedAt": 1234567890000,
  "expiresAt": 1234567890000,
  "revoked": false
}
```

- Stored under `userTokens:<token>`, TTL 90 days.

- Not bound to a canvas. The exchanged JWT has no `canvasId`; the bookmarklet uses `canvasId: "universal"` to trigger launcher mode.

- `scope` is `view` when `userAccess.hasAccess === false`, otherwise `create`. A user token is **not** refused for a missing seat.

---

## Part 3 — Web trigger API contracts

**Base:** `POST <apiUrl>`, `Content-Type: application/json`, `Authorization: Bearer <sessionJwt>` for everything except `exchangeToken`. Non-POST → `BAD_REQUEST`.

**Envelope:**

```json
{ "ok": true, "data": { } }
{ "ok": false, "error": { "code": "…", "message": "…", "details": null } }
```

Status codes: see Part 9.

### 3.1 `exchangeToken`

```text
Request:  { action: "exchangeToken", payload: { canvasToken: string } }
Auth:     none
Success:  { sessionJwt, expiresAt, canvasId, canvasName, scope, permittedProjects,
            isAdmin, displayName, apiUrl, sdkUrl, jiraBaseUrl, configVersion }
Guest:    … + { issuer, permittedCanvases }
```

`payload.canvasToken` may be a canvas token, a guest token, or a personal token (`payload.userToken` and `payload.token` are also accepted). Lookup order: `userTokens:<token>`, then `canvasTokens:<token>`.

- Personal token → `scope: "create" | "view"`, `canvasId: null`, `canvasName: null`.
- Guest token → `scope: "guest_create"`, `isAdmin: false`, plus `issuer` and `permittedCanvases`.
- Canvas token → its recorded `scope`, `canvasId`/`canvasName`.

`expiresAt` is returned in milliseconds. `displayName` is the issuing user's display name, resolved with `asApp()` and cached in-process.

Errors: `BAD_REQUEST` (no token), `TOKEN_INVALID`, `TOKEN_EXPIRED`.

`permittedProjects` is returned for display only. The client must not treat it as an access check; the server filters results before returning them.

### 3.2 `getPinsForCanvasAndUrl`

```text
Request:  { action: "getPinsForCanvasAndUrl", payload: { canvasId, url, all?: boolean } }
Auth:     Bearer, scope create | view | guest_create
Success:  { pins: [PinRecord], canvasName, configVersion, truncated }
```

Behaviour:

1. Normalise `url` per §6.1.

2. Search `labels = "jiratack"` with `properties: ["com.jiratack.metadata"]`, pages of 100, scanning up to 2,000 issues (§7.1).

3. Skip issues without metadata; skip canvas mismatch; unless `all` is true, skip URL mismatch after normalisation.

4. Apply retirement (§7.2).

5. Filter by `permittedProjects`; guests are additionally confined to `permittedCanvases` (`canAccessCanvas` returns `INSUFFICIENT_SCOPE` before the scan).

6. Return. `truncated: true` means the scan cap was reached and the list may be incomplete.

Hidden pins never reach the client. "No pins on this page" and "no pins you can see" are indistinguishable by design.

`PinRecord` — `url`, `pinPosition`, `selector`, `guest` come from the property; the rest from Jira fields:

```json
{
  "key": "MM-1234",
  "summary": "[JiraTack] Hero image misaligned",
  "projectKey": "MM",
  "status": { "name": "In Progress", "category": "indeterminate", "colorName": "yellow" },
  "priority": { "id": "3", "name": "Medium" },
  "priorityId": "3",
  "issueTypeId": "10037",
  "assignee": { "accountId": "…", "displayName": "…", "avatarUrl": "…" },
  "reporter": { "accountId": "…", "displayName": "…", "avatarUrl": "…" },
  "pinPosition": "45.2,32.8",
  "selector": "#hero-image",
  "issueType": { "name": "Bug" },
  "createdAt": "2026-01-15T10:30:00.000Z",
  "url": "https://example.com/page",
  "guest": { "name": "Ann", "email": "a@b.c" }
}
```

`priority`, `assignee`, `reporter`, `selector`, `guest` may be `null`. `status.category` is Jira's `statusCategory.key`.

### 3.3 `createIssue`

```text
Request: {
  action: "createIssue",
  payload: {
    canvasId, url, pinPosition, selector, summary, descriptionAdf,
    screenshotUploadId, consoleLog, issueTypeId, projectKey,
    priorityId, assigneeAccountId, parentKey,
    guestName?, guestEmail?
  }
}
Auth:     Bearer, scope create | guest_create
Success:  { key, id, configVersion, warning? }
```

Server behaviour:

1. Require non-empty `canvasId`, `url`, `pinPosition`, `summary`, `issueTypeId`, `projectKey` → else `BAD_REQUEST`.

2. **Guest branch** (`scope === "guest_create"`):
   - `canAccessCanvas(claims, canvasId)` → else `INSUFFICIENT_SCOPE`.
   - `guestName` non-empty and `guestEmail` a valid address → else `VALIDATION_ERROR`.
   - `assigneeAccountId` required, and must be a licensed JiraTack user (`jiratack_licensed_users:<accountId>`) → else `VALIDATION_ERROR`.

3. `canAccessProject(claims.permittedProjects, projectKey)` → else `INSUFFICIENT_SCOPE`.

4. Project config `enabled === false` → `PROJECT_DISABLED`.

5. Normalise the URL; reject anything not `http(s)` after normalisation → `VALIDATION_ERROR`.

6. Assemble `fields`:

   - `summary` = `[JiraTack]` + client summary, prefix enforced idempotently.
   - `description` = human-readable ADF built server-side (§8.4).
   - `issuetype` = `{ id: issueTypeId }`.
   - `project` = `{ key: projectKey }`.
   - `labels` = `["jiratack"]`, plus `"jiratack-guest"` for guests.
   - `reporter` = `{ accountId: claims.sub }` — **non-guests only**, never from client.
   - `priority`, `assignee`, `parent` when supplied.
   - **No custom-field entries.** Canvas, URL, position and selector go into the property, not into fields.

7. `POST /rest/api/3/issue?overrideScreenSecurity=true&overrideEditableFlag=true`.

8. Write the property: `PUT /rest/api/3/issue/{key}/properties/com.jiratack.metadata` with `{ guest?, pin, version: 1 }`, retry once. On persistent failure the call still succeeds with `warning: "metadata-not-stored"` — the ticket exists but is invisible to every JiraTack surface, so the SDK must say so.

9. If `screenshotUploadId`: assemble chunks via `readScreenshotUpload`, attach via `/rest/api/3/issue/{key}/attachments` with `X-Atlassian-Token: no-check`, then delete the upload. Missing/expired upload → log, proceed. Attachment failure → log, proceed. The ticket is never blocked on the image, and the metadata write is never rolled back.

10. Jira 400/422 → `VALIDATION_ERROR` with `details: { status, errorMessages, errors }`. Other non-2xx → `INTERNAL`. There is no field-dropping retry: no JiraTack-created field exists to drop.

### 3.3b `beginScreenshotUpload` / `uploadScreenshotChunk` (D20)

```text
beginScreenshotUpload  → { uploadId, chunkSize }
  payload: { mimeType: "image/*", size: number }      // size = total base64 length
uploadScreenshotChunk  → { received: index }
  payload: { uploadId, index, data: string }          // data ≤ chunkSize base64 chars
```

- `CHUNK_SIZE` = 200 KiB of base64 characters (`200 * 1024`); `MAX_CHUNKS` = 20; so `size` must be an integer with `0 < size ≤ 4,096,000`.

- `uploadId` is 32 hex chars, bound to `claims.sub`.

- Manifest and chunks live at `screenshot:<uploadId>` and `screenshot:<uploadId>:NNN` with a 15-minute TTL, deleted after attachment.

- Another session's upload reports `NOT_FOUND`, not `FORBIDDEN`; existence is not disclosed.

- Errors: `BAD_REQUEST` (invalid id/index), `VALIDATION_ERROR` (chunk empty or oversized), `NOT_FOUND` (missing, expired, or wrong owner).

- No request carries the whole image, so the ~5 MiB web-trigger body limit is never approached; the KVS 240 KiB per-value limit is why chunks are capped as they are.

### 3.4 `getTransitions`

```text
Request:  { action: "getTransitions", payload: { issueKey } }
Auth:     Bearer, scope create | view | guest_create
Success:  { transitions: [{ id, name, to: { id, name, statusCategory: { key } } }],
            descriptionText: string | null }
```

- Loads the issue through `loadJiraTackIssue`, enforcing Part 3.5 rules 1–2. Non-JiraTack issues and out-of-scope canvases/projects return `INSUFFICIENT_SCOPE`.

- `descriptionText` is the user-authored body alone, with the header, console block, and page footer removed. It is `null` when the description does not begin with a `[JiraTack…]` header.

### 3.5 `updateIssue`

```text
Request: {
  action: "updateIssue",
  payload: {
    issueKey,
    fields: {
      statusId?, priorityId?, assigneeAccountId?, summary?, descriptionText?
    }
  }
}
Auth:     Bearer, scope create | guest_create
Success:  { configVersion }
```

Authorization, all scopes including guests:

1. The issue must carry the `jiratack` label → else `INSUFFICIENT_SCOPE`.
2. `permittedProjects` must include the issue's project, and `canAccessCanvas` must allow `com.jiratack.metadata.pin.canvas` → else `INSUFFICIENT_SCOPE`.
3. A guest `assigneeAccountId` must hold a JiraTack license → else `VALIDATION_ERROR`.
4. `descriptionText`, when present, must be a string → else `BAD_REQUEST`.

Behaviour:

- `statusId` → `POST /rest/api/3/issue/{key}/transitions` with `{ transition: { id } }`.
- `priorityId`, `assigneeAccountId`, `summary`, `descriptionText` → one `PUT /rest/api/3/issue/{key}`.
  - `priority: { id }` | `null`.
  - `assignee: { accountId }` | `null`.
  - `summary` re-adds `[JiraTack]`; empty or >215 chars → `VALIDATION_ERROR`.
  - `description` replaces **only the user body**. The server splits the existing ADF, keeps the header, console block, and page footer verbatim, and re-merges (`splitDescription` / `mergeDescription`). A description without the `[JiraTack…]` header → `VALIDATION_ERROR` ("This description is missing the JiraTack header. Edit it in Jira instead.").
- Transition applies before the field PUT. Jira 400 → `VALIDATION_ERROR`.

### 3.6 `searchUsers`

```text
Request:  { action: "searchUsers", payload: { projectKey, query } }
Auth:     Bearer, scope create | guest_create
Success:  { users: [{ accountId, displayName, avatarUrl }] }
```

Proxies `GET /rest/api/3/user/assignable/search?project={projectKey}&query={query}&maxResults=N`. Handles both a plain array and `{ values: [] }`.

- Non-guest `maxResults=10`.
- Guest `maxResults=50`, then filtered to `jiratack_licensed_users` via one batched read (`findLicensedUsers`), because guests may only assign to licensed users.
- Jira 404 → `NOT_FOUND`.

### 3.7 `getIssueTypes`

```text
Request:  { action: "getIssueTypes", payload: { projectKey } }
Auth:     Bearer, scope create | guest_create
Success:  { issueTypes: [{ id, name, subtask }] }
```

`projectKey` is uppercased and trimmed. Proxies `GET /rest/api/3/issue/createmeta/{projectKey}/issuetypes`; accepts `{ issueTypes: [] }` or `{ values: [] }`. `id` is returned as a string. Jira 404 → `NOT_FOUND`.

### 3.8 `listCanvasesForUser`

```text
Request:  { action: "listCanvasesForUser", payload: {} }
Auth:     Bearer, scope create | view          // guests are NOT allowed
Success:  { canvases: [{ canvasName, urlCount, urls: [string] }] }
```

Scans `labels = "jiratack"` with properties (pages of 100, up to 2,000), groups by `pin.canvas`, and returns canvases that:

- overlap `permittedProjects` (a canvas with no project keys is allowed through),
- and are neither archived nor deleted.

Used by the personal bookmarklet's launcher. Guests get their canvas list from the JWT instead.

### 3.9 `createCanvas` — admin only (D21)

```text
Request:  { action: "createCanvas", payload: { canvasName, targetUrl?, projectKey?, issueTypeId? } }
Auth:     Bearer, scope create, AND claims.isAdmin === true
Success:  { canvasName, key, id }              // seed ticket
```

- **Scope alone is insufficient.** `requireAdminClaims` runs before any business logic → 403 `INSUFFICIENT_SCOPE`.
- A guest token never reaches this action (its scope is not allowlisted), and guest claims are always `isAdmin: false`.
- The seed ticket is `summary: "Canvas created"`, description built with body text `JiraTack canvas created: <name>`, label `jiratack`, and metadata `{ pin: { canvas, url, position: "0,0", selector: null }, version: 1 }`.
- `url` = normalised `targetUrl` if it is `http(s)`, else `https://example.com`.
- Project is `payload.projectKey`, else the first enabled configured project the caller may use, else the first permitted project; none → `BAD_REQUEST`.
- Issue type is `payload.issueTypeId`, else the project config default, else the first non-subtask type; none → `BAD_REQUEST`.
- Seed ticket created but metadata write failed → `INTERNAL` (the canvas would be invisible, so it is reported as a failure).

### 3.10 `getPriorities`

```text
Request:  { action: "getPriorities", payload: {} }
Auth:     Bearer, scope create | guest_create
Success:  { priorities: [{ id, name }] }
```

Proxies `GET /rest/api/3/priority` as the app. Accepts a plain array or `{ values: [] }`.

---

## Part 4 — Resolver contracts

### 4.0 Access model (D19, D21)

Resolvers are invoked from app UI that **any logged-in site user can open**, so hiding a control is not authorisation. Enforcement is per-operation and server-side.

| Resolver | Authority | Mechanism |
| --- | --- | --- |
| `getInstallationConfig`, `setInstallationConfig` | Jira site admin | `requireAdmin(context)` |
| `getProjectConfig`, `setProjectConfig` | Jira site admin | `requireAdmin(context)` |
| `listCanvasTokens`, `revokeCanvasToken` | Jira site admin | `requireAdmin(context)` |
| `createCanvas`, `deleteCanvas`, `archiveCanvas` | Jira site admin | `requireAdmin(context)` |
| `generateCanvasToken`, `generateUserToken`, `generateGuestToken` | JiraTack seat | Seat check at issuance |
| `dashboardAggregate` | Any Jira user | Jira permissions via `asUser()` |
| `epicPanelData`, `issuePanelData` | Any Jira user | Jira permissions via `asUser()` |

Canvas creation is **admin-only on both paths** (D21); the earlier "creation is open" rule was superseded. Panels are read surfaces scoped by Jira's own permissions, which is why page-level `access` scopes cannot be the control.

### 4.1 `generateCanvasToken`

```text
generateCanvasToken(context, payload)
  → { ok, data: { token, sessionJwt, apiUrl, sdkUrl, sdkVersion,
                  canvasId, canvasName, scope, permittedProjects } }
Payload: { canvasName: string, scope: "create" | "view" }
```

1. **Validation:** `canvasName` 1–255 chars; `scope` must be `create` or `view` → else `BAD_REQUEST`.

2. **Seat check:** `scope === "create"` and `userAccess.hasAccess === false` → `LICENSE_INACTIVE`. `view` is not seat-checked.

3. **`computePermittedProjects(mode, canvasName)`:**
   - `mode === "open"` → `"*"`.
   - Else `GET /rest/api/3/project/search?action=browse&maxResults=100` as the user; `projects.length >= 100` → `"*"`, else the key array.
   - With a canvas name and a non-`*` list: search `labels = "jiratack"` (100 max), collect the project keys of that canvas's tickets, intersect. Non-empty canvas and empty intersection → `NO_CANVAS_ACCESS`. An empty canvas issues the token; the viewer sees an empty overlay.
   - With no canvas name (personal and guest tokens) the intersection step is skipped.

4. **Mint:** 64-hex token, record per §2.1 including `isAdmin`, TTL 30 days, plus a signed JWT so the caller can skip an exchange round-trip. Returns `apiUrl` and `sdkUrl` resolved independently (D10) and `sdkVersion` (D13).

### 4.2 `dashboardAggregate`

```text
dashboardAggregate(context) → { ok, data: {
  canvases: [CanvasSummary], configVersion, hasAccess, isAdmin, jiraBaseUrl
} }
CanvasSummary: { canvasName, ticketCount, openCount, urlCount,
                 urls: [{ url, ticketCount }], lastUpdated,
                 projectKeys: [string],
                 participants: [{ accountId, displayName, avatarUrl }],
                 archived: boolean }
```

- Query: `labels = "jiratack"` with properties, `ORDER BY created DESC`, pages of 100, cap 2,000.
- Group by `metadata.pin.canvas`; `openCount` counts status category ≠ `done`; `urls` counts per normalised URL, sorted by count then URL; `participants` is capped at 5 (assignee and reporter).
- `deletedCanvases` are filtered out entirely; `archivedCanvases` are returned with `archived: true`.
- Sorted by `lastUpdated` descending, then canvas name.
- Runs `asUser()`, so Jira enforces project permissions natively. No `permittedProjects` filtering here.
- `hasAccess` reflects `context.userAccess.hasAccess !== false`; `isAdmin` is resolved per §4.0. Both drive UI affordances only.

### 4.3 `epicPanelData`

```text
epicPanelData(context, payload) → { ok, data: { canvases: [EpicCanvasSummary], warnings, jiraBaseUrl } }
Payload: { epicKey: string }
EpicCanvasSummary: { canvasName, epicTicketCount, totalTicketCount, urlCount }
```

- Two queries merged by issue key: company-managed `"Epic Link" = <epicKey>`, team-managed `parent = <epicKey>`.
- Group by `metadata.pin.canvas`; `urlCount` is the distinct normalised URL count.
- One failing query produces a warning; both failing → `INTERNAL`.
- **Known defect:** `totalTicketCount` is currently assigned `epicTicketCount`, not the canvas total. Treat it as unreliable until wired to a full canvas scan.

### 4.4 `issuePanelData`

```text
issuePanelData(context, payload) → { ok, data: {
  isJiraTack, canvasName, url, guest, pin, screenshot, relatedTickets, deepLink, jiraBaseUrl
} }
Payload: { issueKey: string }
```

- Reads the property via `readMetadataBySearch` (`key = "<key>"` with `properties`). Absent → `{ ok: true, data: { isJiraTack: false } }`.
- A failed lookup returns `INTERNAL`, never `isJiraTack: false`, so "could not verify" is not reported as "not JiraTack".
- `pin` is the full `{ canvas, url, position, selector }`; `guest` is `{ name, email }` or `null`.
- `screenshot` is `{ filename, mimeType, dataUrl }` or `null`. It is fetched with `asApp()` from `/rest/api/3/attachment/content/{id}` and returned as a base64 `data:` URL, because UI Kit cannot authenticate a raw Jira attachment URL.
- `relatedTickets` scans `labels = "jiratack"` (cap 2,000, result cap 20) matching `pin.canvas` and `pin.url` exactly, excluding self, via `asUser()`.
- `deepLink` is the page URL with `jiratack_ticket=<key>` appended.
- Jira 404 on the issue → `NOT_FOUND`.

### 4.5 `fieldMappingAudit` — retired (D18)

Removed with custom fields. There is nothing to audit.

### 4.5b Token management

```text
listCanvasTokens(context) → { ok, data: { tokens: [{ tokenRef, canvasName, userId, scope,
                                                      issuedAt, expiresAt, revoked }] } }
revokeCanvasToken(context, payload) → { ok, data: { revoked: true } }
Payload: { tokenRef?: string, token?: string }
```

- Both require Jira admin (§4.0).
- `tokenRef` is a non-reversible SHA-256 prefix (12 hex chars). Raw bearer tokens are never returned by any resolver.
- Scans `canvasTokens:*` (cap 1,000), sorted by `issuedAt` descending.
- Guest records appear with `canvasName` and `userId` undefined and `scope: "guest_create"`.
- `revokeCanvasToken` resolves `tokenRef` back to the KVS key; a raw `token` is still accepted for programmatic callers. Revoking deletes the record, so new exchanges fail immediately; live JWTs survive until `exp` (≤8 h). The SDK re-exchanges on `TOKEN_EXPIRED`/`TOKEN_INVALID`, which bounds the practical window.

### 4.5c `generateGuestToken` — seat-licensed (D19)

```text
generateGuestToken(context, payload)
  → { ok, data: { token, installerUrl, scope: "guest_create",
                  permittedCanvases, permittedProjects, expiresAt } }
Payload: { permittedCanvases: string[] }   // 1–50 distinct entries, each 1–255 chars
```

- Requires a **seat** (`hasAccess !== false`), not site-admin rights → else `LICENSE_INACTIVE`.
- `permittedProjects` is frozen at issuance via `computePermittedProjects(mode, null)`.
- Record per §2.1 with 365-day TTL and `isAdmin: false`.
- `installerUrl` = install web trigger with `?token=<guestToken>`; `null` if URL resolution fails.
- **Accepted trade-off (D19):** the guest session inherits the **issuer's** browse access for the selected canvases. Seat gating, canvas scoping, and the 365-day expiry are the compensating controls.

### 4.6 `recoverPinsFromDescriptions` — retired (D18)

Removed with the description marker. The issue property is the source of truth, and there is no description-based recovery path.

### 4.7 `generateUserToken`

```text
generateUserToken(context) → { ok, data: { token, apiUrl, sdkUrl, sdkVersion } }
```

1. `trackLicensedUser(context)` records the seat when present (best-effort, never throws).
2. `scope` = `view` when `userAccess.hasAccess === false`, else `create`. **A missing seat does not error.**
3. `permittedProjects` via `computePermittedProjects(mode, null)`.
4. Mint 64-hex token, record per §2.3, TTL 90 days.
5. Return token plus `apiUrl`, `sdkUrl`, `sdkVersion`.

### 4.8 `deleteCanvas` / `archiveCanvas`

```text
deleteCanvas(context, payload)  → { ok, data: { canvasName, deleted: true, ticketCount } }
archiveCanvas(context, payload) → { ok, data: { canvasName, archived: true } }
Payload: { canvasName: string }
```

- Admin only. Scans `labels = "jiratack"` (cap 2,000) filtered to the canvas.
- Delete is refused while any ticket is not in status category `done` → `CANVAS_NOT_EMPTY` (409) with `{ openCount, total }`.
- Delete appends the name to `deletedCanvases` and removes it from `archivedCanvases`.
- Archive appends to `archivedCanvases`. Neither touches Jira issues.

### 4.9 Configuration resolvers

```text
getInstallationConfig(context) → { ok, data: installationConfig }
setInstallationConfig(context, payload) → { ok, data: installationConfig }
getProjectConfig(context, payload) → { ok, data: ProjectConfig }
setProjectConfig(context, payload) → { ok, data: ProjectConfig }
Payload (project): { projectKey, settings? }
```

- All four require Jira admin.
- `setInstallationConfig` merges `payload.projects` shallowly; the rest of the payload is assigned onto a draft, then `configVersion` and `updatedAt` are recomputed inside `mutateInstallationConfig`.
- `getProjectConfig` returns `PROJECT_DEFAULTS` merged with the stored entry, so an unknown project reads as `{ enabled: true, retirementDays: 0, … }`.

---

## Part 5 — Bookmarklet SDK contracts

### 5.1 Init contract

```javascript
window.__jiratackInit(config)
// config: { token, apiUrl, sdkUrl, canvasId, canvasName, sdkVersion }
```

Called by the bootstrap after the SDK script loads. If `window.__jiratackActiveCanvas === config.canvasId`, it calls `__jiratackClose()` and returns.

`canvasId === "universal"` selects launcher mode and must not be treated as a canvas name.

### 5.2 Overlay DOM contract

```text
#jiratack-overlay            position: fixed; inset: 0; pointer-events: none; z-index: 2147483647
  #jiratack-pins             position: absolute; inset: 0; pointer-events: none
    .jiratack-pin[data-key]  position: absolute; pointer-events: auto
    .jiratack-detached-cluster
  #jiratack-sidebar          position: fixed; right: 0; top: 0; width: 320px; height: 100vh
    .jiratack-sidebar-header
    .jiratack-filter-toggle
    .jiratack-ticket-list
      .jiratack-ticket-card[data-key]
    .jiratack-new-ticket-form
  #jiratack-toast-container  position: fixed; bottom: 16px; right: 16px
```

All classes are prefixed `jiratack-`. All overlay elements are removed on `__jiratackClose()`.

### 5.3 `sessionStorage` keys

| Key | Value |
| --- | --- |
| `jiratack_jwt_<canvasId>` | `{ jwt, expiresAt, scope, permittedProjects, … }` |
| `jiratack_layout_mode` | `"push"` \| `"fit"` |
| `jiratack_nav_state` | `{ canvasName, filter, selectedKey }` |

Nothing else. Never `localStorage`. `createSessionManager(storage)` accepts an injected storage adapter with `getItem`/`setItem`/`removeItem`/`keys` so a content-script extension can supply its own.

### 5.4 Close contract

`window.__jiratackClose()` must:

1. Remove all `.jiratack-*` elements and the injected style.
2. Restore the original `console.error` / `console.warn`.
3. Remove all SDK-registered listeners and destroy layout controllers (fixed-shift, fit-scale).
4. Set `window.__jiratackActiveCanvas = null`.
5. Be idempotent.

---

## Part 6 — URL normalisation (client and server must match)

Single module `src/shared/urlNormalize.js`, bundled into both.

### 6.1 Algorithm

```javascript
export function normalizeUrl(input) {
  if (!input) return '';
  let u;
  try { u = new URL(input); } catch { return input.trim(); }
  u.hash = '';
  u.search = '';                 // the ENTIRE query string is dropped
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  if (u.pathname !== '/' && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.toString();
}
```

- Do not coerce `http` → `https`.
- **All query parameters are removed**, not only tracking parameters. Page identity is path-based.
- Path case, port and non-root trailing-slash semantics are preserved exactly.

**Consequence to keep in mind:** `?page=2`, `?filter=x`, `?variant=b` and `?utm_source=…` all collapse to the same page. Two URLs differing only by query string share one pin set. This is shipped behaviour and a product decision to confirm; do not "fix" it without a decision entry.

### 6.2 Test vectors (acceptance gate — `src/shared/urlNormalize.test.js`)

| Input | Output |
| --- | --- |
| `https://example.com/page` | `https://example.com/page` |
| `https://example.com/page/` | `https://example.com/page` |
| `https://example.com/page#section` | `https://example.com/page` |
| `https://Example.COM/Page` | `https://example.com/Page` |
| `https://example.com/page?cat=x` | `https://example.com/page` |
| `https://example.com/page?id=42` | `https://example.com/page` |
| `https://example.com/page?utm_source=x&id=42#section` | `https://example.com/page` |
| `https://example.com/page/?cat=x` | `https://example.com/page` |
| `https://example.com/A` | `https://example.com/A` |
| `https://example.com/a/` | `https://example.com/a` |
| `http://example.com/page` | `http://example.com/page` |
| `https://example.com/` | `https://example.com/` |
| `https://example.com/?cat=x` | `https://example.com/` |
| `https://example.com:8443/a?x=1` | `https://example.com:8443/a` |
| `https://example.com/page?jiratack_ticket=KAN-15` | `https://example.com/page` |

### 6.3 `stripDeepLinkParams`

Separate helper, used for display paths that must keep other query parameters (dashboard URL breakdown, seed-ticket target):

| Input | Output |
| --- | --- |
| `https://example.com/page?jiratack_ticket=KAN-15&foo=bar` | `https://example.com/page?foo=bar` |
| `https://example.com/page?jiratack_canvas=Q3&foo=bar` | `https://example.com/page?foo=bar` |
| `https://example.com/page?foo=bar` | `https://example.com/page?foo=bar` |

Run the vector file with `node --test src/shared/urlNormalize.test.js` before touching either function.

---

## Part 7 — JQL templates

All pin queries are label-plus-property. **No JQL references a custom field**; `jiratackCanvas` (the entity-property alias) may be used for canvas-exact filtering where indexed.

### 7.1 Overlay query (`getPinsForCanvasAndUrl`)

```text
jql:        labels = "jiratack" ORDER BY created ASC
properties: ["com.jiratack.metadata"]
fields:     summary, status, priority, assignee, reporter, issuetype, created,
            project, statuscategorychangedate
maxResults: 100 (paginated, cap 2,000)
```

Canvas and URL matching happen in memory against the property (`metadata.pin.canvas`, `metadata.pin.url`). `project` is fetched so `permittedProjects` filtering is possible before anything reaches the client.

### 7.2 Retirement window

**Effective `retirementDays` source (D14):** the project of the canvas's oldest ticket.

1. Query `labels = "jiratack"` with properties, ordered by created ascending, and take the first issue whose `pin.canvas` matches.
2. No ticket → `retirementDays = 0`.
3. Else `projects[projectKey].retirementDays` from `installationConfig`.
4. Cache at `canvasProjectCache:<canvasName>` → `{ projectKey, cachedAt }`, TTL 300 s.

When `> 0`, a Done ticket is included only if `statuscategorychangedate >= now − N days`. When `=== 0`, Done tickets are excluded entirely. There is no separate JQL variant; the filter is applied in memory during the overlay scan, so §7.1 is the only query.

### 7.3 Dashboard / canvas list

```text
jql:        labels = "jiratack" ORDER BY created DESC
properties: ["com.jiratack.metadata"]
fields:     status, updated, assignee, reporter, project
maxResults: 100 (paginated, cap 2,000)
```

### 7.4 Epic panel (merge two queries)

```text
Company-managed: "Epic Link" = "<epicKey>"
Team-managed:    parent = "<epicKey>"
properties:      ["com.jiratack.metadata"]
fields:          project
maxResults:      100 each
```

Both queries are issue-only; canvas membership is decided from the property after the merge.

### 7.5 Issue panel related

```text
jql:        labels = "jiratack" ORDER BY created ASC
properties: ["com.jiratack.metadata"]
fields:     summary, status, issuetype
maxResults: 100 (paginated, cap 2,000; result cap 20)
```

Matching on `pin.canvas` + `pin.url` happens in memory, excluding the current issue.

### 7.6 Recovery candidates — retired (D18)

Removed with the description marker. No recovery pass exists.

---

## Part 8 — ADF contracts

### 8.1 Serializer output

The ticket form uses a **plain textarea**, not a rich-text editor. `descriptionToAdf(text)` splits on newlines and runs each line through `serializeToAdf`:

| Input | ADF output |
| --- | --- |
| empty or whitespace-only text | `null` (no description) |
| blank line | `{ type: "paragraph" }` |
| line of text | `{ type: "paragraph", content: [{ type: "text", text: "…" }] }` |

Root: `{ type: "doc", version: 1, content: [nodes] }`.

`serializeToAdf` accepts an ADF-shaped document and maps `paragraph`, `text`, `bulletList`, `orderedList`, `listItem`, and `hardBreak`; unsupported node types degrade to a paragraph with a `console.warn`. The client never constructs lists or marks, because the textarea cannot express them.

`textToAdf()` is the server-side plain-text equivalent, used for seed tickets and for `descriptionText` merges. `adfToText()` is its inverse, used to extract the editable body.

### 8.2 Empty description

Empty or whitespace-only input yields no body paragraphs. The server still emits the header and, when present, the console block and page footer.

### 8.3 Console log append (server-side)

If `consoleLog` is a non-empty string, insert before the footer:

```json
[
  { "type": "paragraph", "content": [{ "type": "text", "text": "Console output:", "marks": [{ "type": "strong" }] }] },
  { "type": "codeBlock", "attrs": {}, "content": [{ "type": "text", "text": "<consoleLog>" }] }
]
```

Client formatting, one line per entry:

```text
[error] TypeError: Cannot read property 'x' of undefined (at main.js:142)
[warn] Deprecated API usage: getElementByClass (at app.js:89)
```

`[level] message (source)` when a source is known, `[level] message` otherwise. Level lowercase. Buffer holds the last 50 entries.

### 8.4 Description structure and metadata storage

The description is human-readable ADF only. Machine data lives in the property (§1.1); nothing is appended to or parsed out of the description.

```text
[ JiraTack ]                                   bold paragraph
    or [ JiraTack Guest: <name> ]
<user body paragraphs>
Console output:                                bold, only when a log is included
<codeBlock>
Page: <link to normalised URL>                 footer paragraph
```

Rules:

- The header is always the **first** node and must start with `[JiraTack`.
- The footer is the **last** node and must start with `Page:`.
- The console block, when present, sits immediately before the footer.
- `splitDescription()` identifies these three blocks by those markers; `mergeDescription()` re-emits them in the same order around a new body.
- Editing a description with no recognisable header fails closed (`VALIDATION_ERROR`) rather than rebuilding the document, so a malformed ticket cannot lose its guest identity.
- The property is written immediately after issue creation and is the source of truth. There is no JSON in the description and no marker to recover from.

---

## Part 9 — Error code registry

| Code | HTTP | Meaning | Client behaviour |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformed payload | Toast: check the form and retry |
| `TOKEN_INVALID` | 401 | Token missing, revoked, unknown, or signature invalid | Re-exchange once; then "Session expired. Reopen the bookmarklet." |
| `TOKEN_EXPIRED` | 401 | Token or JWT past expiry | Same, with a hint to regenerate from Jira |
| `INSUFFICIENT_SCOPE` | 403 | Scope, canvas, project, or admin claim denies the action | UI is gated; if reached, "View-only or no access to this project." |
| `LICENSE_INACTIVE` | 403 | Installation or seat not licensed | Persistent red banner in the sidebar |
| `NO_CANVAS_ACCESS` | 403 | No browse access to any project in the canvas | Shown when minting a token or guest link |
| `CANVAS_NOT_EMPTY` | 409 | Delete refused; open tickets remain | Inline admin error with the open count |
| `NOT_FOUND` | 404 | Ticket, project, canvas, or upload not found | Toast "Not found." |
| `PROJECT_DISABLED` | 422 | JiraTack disabled for the target project | Inline error on the project selector |
| `VALIDATION_ERROR` | 422 | Invalid input, expired upload, or Jira rejected the payload | Inline field errors plus Jira's messages |
| `INTERNAL` | 500 | Unexpected server failure | Toast "Something went wrong — try again." plus a `[JiraTack]` log line |

---

## Part 10 — Package and manifest

### 10.1 `manifest.yml`

```yaml
app:
  id: ari:cloud:ecosystem::app/47873476-1bf1-4291-9178-a65ef01abd46
  runtime:
    name: nodejs24.x
  licensing:
    enabled: true
permissions:
  scopes:
    - storage:app
    - read:jira-work
    - write:jira-work
    - read:jira-user
    - manage:jira-project
    - manage:jira-configuration
modules:
  jira:globalPage:
    - key: jiratack-dashboard
      resource: dashboard-ui
      resolver:
        function: resolver
      title: JiraTack Canvases
  jira:adminPage:
    - key: jiratack-admin
      resource: admin-ui
      resolver:
        function: resolver
      render: native
      title: JiraTack
  jira:projectSettingsPage:
    - key: jiratack-project-config
      resource: project-config-ui
      resolver:
        function: resolver
      render: native
      title: JiraTack
  jira:entityProperty:
    - key: jiratack-metadata
      entityType: issue
      propertyKey: com.jiratack.metadata
      values:
        - path: pin.canvas
          type: string
          searchAlias: jiratackCanvas
  jira:issuePanel:
    - key: jiratack-epic-panel
      resource: epic-panel-ui
      resolver:
        function: resolver
      render: native
      title: JiraTack Canvases
      icon: https://developer.atlassian.com/platform/forge/images/icons/issue-panel-icon.svg
      displayConditions:
        issueType: Epic
    - key: jiratack-issue-panel
      resource: issue-panel-ui
      resolver:
        function: resolver
      render: native
      title: JiraTack
      icon: https://developer.atlassian.com/platform/forge/images/icons/issue-panel-icon.svg
  function:
    - key: resolver
      handler: resolvers/index.handler
    - key: webtrigger-api
      handler: webtrigger/api.handler
    - key: webtrigger-sdk
      handler: webtrigger/sdk.handler
    - key: webtrigger-install
      handler: webtrigger/install.handler
  webtrigger:
    - key: jiratack-api
      function: webtrigger-api
    - key: jiratack-sdk
      function: webtrigger-sdk
    - key: jiratack-install
      function: webtrigger-install
resources:
  - key: dashboard-ui
    path: dist/dashboard
  - key: epic-panel-ui
    path: src/ui-kit/epic-panel/index.jsx
  - key: issue-panel-ui
    path: src/ui-kit/issue-panel/index.jsx
  - key: project-config-ui
    path: src/ui-kit/project-config/index.jsx
  - key: admin-ui
    path: src/ui-kit/admin/index.jsx
```

Key points:

- `render: native` on the four UI Kit surfaces; **not** on `jira:globalPage` (Custom UI).
- `jira:entityProperty` is required for the `jiratackCanvas` alias. Indexing is not retroactive.
- Three web triggers: API, SDK bundle, guest installer page. The installer is public HTML and must stay dependency-free.
- No `external.fetch.backend` egress (removed 2026-10-27, D16). The app makes no outbound HTTP outside `requestJira`. Dynamic web triggers mean the app is not Runs-on-Atlassian eligible.
- `permissions` is top-level, not nested under `app`.
- `function.handler` paths are relative to `src/` (no `src/` prefix).
- UI Kit `resources.path` includes the entry filename; the dashboard resource stays a directory.
- `jira:issuePanel` entries require an `icon`.

### 10.2 `package.json`

```json
{
  "name": "jiratack",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build:bookmarklet": "vite build --config vite.bookmarklet.config.js",
    "build:dashboard": "vite build --config vite.dashboard.config.js",
    "build": "npm run build:bookmarklet && npm run build:dashboard && node scripts/embed-sdk.js",
    "deploy": "forge deploy -e development",
    "tunnel": "forge tunnel"
  },
  "dependencies": {
    "@forge/api": "^4",
    "@forge/bridge": "^5",
    "@forge/kvs": "^1",
    "@forge/react": "^11",
    "@forge/resolver": "^1",
    "html2canvas": "^1.4",
    "jsonwebtoken": "^9"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4",
    "forge-cli": "latest",
    "react": "^18",
    "react-dom": "^18",
    "vite": "^5"
  }
}
```

No Tiptap dependency: the form uses a textarea and `serializeToAdf`. `npm run build` regenerates `dist/bookmarklet/jiratack.js`, `src/lib/sdk-bundle.js`, and `src/lib/version.js` (`SDK_VERSION` = first 12 hex of the bundle hash, D13).

---

## Part 11 — Decisions

All decisions live in `DECISIONS.md`, which is authoritative. There are no open decisions at contract level: D10 (web trigger URL discovery) and D13–D17 are resolved, and D18–D22 cover storage, authorisation, uploads, the admin claim, and the delivery channel.

If a contract here contradicts a decision, the decision wins — and this file is the thing to fix.
