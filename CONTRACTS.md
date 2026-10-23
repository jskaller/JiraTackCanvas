# CONTRACTS.md

**Audience:** OpenCode. Every function signature, every request/response shape, every JQL template, every error code, the URL normalization algorithm, and the ADF node shapes.
**Precedence:** Where this document disagrees with SPEC.md or ARCHITECTURE.md on wire-level details, this document wins. Where it disagrees with DECISIONS.md on open questions, DECISIONS.md wins.

---

## Part 1 — Field contracts

### 1.1 Field definitions

| Internal name   | Provisioned field type                                        | Expected field ID shape | Constraints                                                             |
| --------------- | ------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `canvasField`   | `com.atlassian.jira.plugin.system.customfieldtypes:textfield` | `customfield_NNNNN`     | Single-value. Free-form text with spaces. Max 255 chars.                |
| `urlField`      | `com.atlassian.jira.plugin.system.customfieldtypes:url`       | `customfield_NNNNN`     | Fallback to `textfield` if URL type unavailable in plan. Max 255 chars. |
| `pinField`      | `com.atlassian.jira.plugin.system.customfieldtypes:textfield` | `customfield_NNNNN`     | `relX,relY` or `absX,absY`. Max 32 chars.                               |
| `selectorField` | `com.atlassian.jira.plugin.system.customfieldtypes:textfield` | `customfield_NNNNN`     | CSS selector or empty. Max 512 chars.                                   |

### 1.2 `installationConfig` shape (stored in KVS)

```json
{
  "fieldRegistry": {
    "canvasField": "customfield_10240",
    "urlField": "customfield_10241",
    "pinField": "customfield_10242",
    "selectorField": "customfield_10243"
  },
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
  "configVersion": "sha256hex",
  "updatedAt": 1234567890,
  "schemaVersion": 1
}

`viewPermissionMode` is installation-level. Values: `"per_user_projects"` (default) | `"open"`. Per D9.

`configVersion` = SHA-256 hex of canonical `JSON.stringify({ projects, fieldRegistry, viewPermissionMode })`. Recomputed on every write.

### 1.3 `provisionFields` — resolver contract

text

provisionFields(context) → { ok, fieldIds: { canvasField, urlField, pinField, selectorField }, warnings: [string] }

Behavior:

1. Query `/rest/api/3/field` → list existing fields.

2. For each of the four fields: if exact name exists and type matches, reuse. Else create via `POST /rest/api/3/field`.

3. Best-effort: add each field to the default screen's create+edit tabs.

4. Write `fieldRegistry` to `installationConfig`.

5. Return.

Warnings if: (a) field exists with incompatible type, (b) screen manipulation fails.

---

## Part 2 — Token contracts

### 2.1 Canvas token

- Generation: `crypto.randomBytes(32).toString('hex')` → 64-char hex string.

- Storage: KVS `canvasTokens:<token>`, TTL 30 days.

- Write call:

javascript

await storage.set(`canvasTokens:${token}`, record, { ttl: 2592000 });
// 2592000 seconds = 30 days

- Record:

json

{
  "canvasName": "string, 1..255 chars",
  "userId": "string, Atlassian accountId of issuing user",
  "installationId": "string",
  "scope": "create | view",
  "issuedAt": 1234567890000,
  "expiresAt": 1234567890000,
  "revoked": false
}

### 2.2 Session JWT

- Algorithm: **HS256**.

- Secret: 256-bit hex from `sessionSigningSecret` KVS key. Generated once at first bootstrap via `crypto.randomBytes(32).toString('hex')`. Never rotated in v1.

- Claims:

json

{
  "iss": "jiratack",
  "sub": "accountId of issuing user",
  "aud": "installationId",
  "canvasId": "canvasName (v1 uses name as ID)",
  "canvasName": "canvasName",
  "scope": "create | view",
  "permittedProjects": ["MM", "QA", "DS"] | "*",
  "iat": 1234567890,
  "exp": 1234596690
}

**`permittedProjects` semantics (per D9):**

- Array of project keys: viewer sees only pins whose project key is in this array.

- `"*"`: viewer sees all pins in the canvas regardless of project (`viewPermissionMode: "open"`, OR viewer has ≥100 browse-accessible projects, treated as admin-level).

- Validation: verify signature, `exp > now`, `aud === installationId`. Extract `scope`, `sub`, `canvasId`, `permittedProjects`. Reject on any failure with 401 `TOKEN_INVALID` or `TOKEN_EXPIRED`.

---

## Part 3 — Webtrigger API contracts

**Base path:** `<wt>/api` — `POST`, `Content-Type: application/json`, `Authorization: Bearer <sessionJwt>` for all except `exchangeToken`.

**Response envelope:**

json

{ "ok": true, "data": { ... } }
{ "ok": false, "error": { "code": "...", "message": "...", "details": ... } }

**HTTP status codes:** 200 for `ok: true`; 400 `BAD_REQUEST`; 401 `TOKEN_INVALID` / `TOKEN_EXPIRED`; 403 `INSUFFICIENT_SCOPE` / `LICENSE_INACTIVE`; 404 `NOT_FOUND`; 422 `VALIDATION_ERROR`; 500 `INTERNAL`.

### 3.1 `exchangeToken`

text

Request:  { action: "exchangeToken", payload: { canvasToken: string } }
Auth:     none
Success:  { sessionJwt, expiresAt, canvasId, canvasName, scope, permittedProjects, apiBase, configVersion }

Errors: `TOKEN_INVALID`, `TOKEN_EXPIRED`, `LICENSE_INACTIVE`.

**`permittedProjects` is returned so the client can display it** (e.g. a small "Viewing N projects" badge in the sidebar). Client must not use it as an access check — the server filters pins before returning them.

### 3.2 `getPinsForCanvasAndUrl`

text

Request:  { action: "getPinsForCanvasAndUrl", payload: { canvasId, url } }
Auth:     Bearer, scope create or view
Success:  { pins: [PinRecord], canvasName, configVersion }

Server behavior:

1. Normalize `url` per Part 6.

2. Run JQL: Part 7.1 (canvas + normalized URL + statusCategory != Done).

3. **Filter results by `token.permittedProjects`** (per D9):
   
   - If `permittedProjects === "*"`: no filter.
   
   - Else: keep only pins whose project key is in `permittedProjects`.

4. Return filtered list.

Filtering happens server-side; hidden pins never reach the client. The client cannot distinguish between "no pins on this page" and "no pins you can see" — both return an empty list, which is the intended behavior.

`PinRecord` (same shape regardless of mode):

json

{
  "key": "MM-1234",
  "summary": "...",
  "status": { "name": "In Progress", "category": "indeterminate", "colorName": "yellow" },
  "priority": { "id": "3", "name": "Medium" },
  "assignee": { "accountId": "...", "displayName": "...", "avatarUrl": "..." },
  "reporter": { "accountId": "...", "displayName": "...", "avatarUrl": "..." },
  "pinPosition": "45.2,32.8",
  "selector": "#hero-image",
  "issueType": { "name": "Bug" },
  "createdAt": "2026-01-15T10:30:00.000Z"
}

`priority`, `assignee`, `reporter`, `selector` may be `null`. JQL: Part 7.1.

### 3.3 `createIssue`

text

Request: {
  action: "createIssue",
  payload: {
    canvasId: string,
    url: string,
    pinPosition: string,
    selector: string | null,
    summary: string,
    descriptionAdf: object | null,
    screenshotDataUrl: string | null,
    consoleLog: string | null,
    issueTypeId: string,
    projectKey: string,
    priorityId: string | null,
    assigneeAccountId: string | null,
    parentKey: string | null
  }
}
Auth:     Bearer, scope create only
Success:  { key, id, configVersion }

Server behavior:

1. Validate JWT scope === `create` (else 403).

2. Validate `projectKey` is in `token.permittedProjects` OR `permittedProjects === "*"` (else 403 `INSUFFICIENT_SCOPE` — user cannot create pins in projects they can't browse).

3. Fetch `installationConfig` → `fieldRegistry`, project config.

4. Verify project enabled → else 422 `PROJECT_DISABLED`.

5. Assemble `fields`:
   
   - `summary` = `[JiraTack]` + payload.summary (prefix enforced idempotently).
   
   - `description` = client ADF + console log append (Part 8.3) + pin marker append (Part 8.4). Order: client content, then console output block, then pin marker paragraph.
   
   - `<canvasFieldId>` = canvasName.
   
   - `<urlFieldId>` = normalized URL.
   
   - `<pinFieldId>` = pinPosition.
   
   - `<selectorFieldId>` = selector (omit if null).
   
   - `issuetype` = `{ id: issueTypeId }`.
   
   - `project` = `{ key: projectKey }`.
   
   - `priority` = `{ id: priorityId }` if non-null.
   
   - `assignee` = `{ accountId: assigneeAccountId }` if non-null.
   
   - `parent` = `{ key: parentKey }` if non-null.
   
   - `reporter` = `{ accountId: jwt.sub }` — never from client.
   
   - `labels` = `["jiratack"]`.

6. POST `/rest/api/3/issue`.

7. If `screenshotDataUrl`: attach via `/rest/api/3/issue/{key}/attachments` with `X-Atlassian-Token: no-check`. On failure: log, proceed.

8. Return.

9. Jira 400 → 422 `VALIDATION_ERROR` with `details.fieldErrors`. Retry-once applies only to auto-created custom fields.

### 3.4 `getTransitions`

text

Request:  { action: "getTransitions", payload: { issueKey } }
Auth:     Bearer, scope create or view
Success:  { transitions: [{ id, name, to: { id, name, statusCategory: { key } } }] }

### 3.5 `updateIssue`

text

Request: {
  action: "updateIssue",
  payload: {
    issueKey: string,
    fields: {
      statusId?: string,
      priorityId?: string,
      assigneeAccountId?: string | null
    }
  }
}
Auth:     Bearer, scope create only
Success:  { configVersion }

Behavior:

- `fields.statusId` → `POST /rest/api/3/issue/{key}/transitions` with `{ transition: { id } }`.

- `fields.priorityId` or `fields.assigneeAccountId` → `PUT /rest/api/3/issue/{key}` with `{ fields: { priority: { id }, assignee: accountId ? { accountId } : null } }`.

- Jira 400 → 422 `VALIDATION_ERROR`.

### 3.6 `searchUsers`

text

Request:  { action: "searchUsers", payload: { projectKey, query } }
Auth:     Bearer, scope create only
Success:  { users: [{ accountId, displayName, avatarUrl }] }

Proxies `GET /rest/api/3/user/assignable/search?project={projectKey}&query={query}&maxResults=10`. Handle both plain array and `{ values: [] }` response shapes.

---

## Part 4 — Resolver contracts

### 4.1 `generateCanvasToken`

text

generateCanvasToken(context, payload) → { ok, data: { token, apiBase, sdkVersion, scope, permittedProjects } } | { ok: false, error }
Payload: { canvasName: string, scope: "create" | "view" }

Behavior:

1. **Scope check:**
   
   - `scope === "create"`: `if (context.userAccess?.hasAccess === false) return LICENSE_INACTIVE`.
   
   - `scope === "view"`: no `hasAccess` check.

2. **Compute `permittedProjects`** (per D9):
   
   javascript
   
   const mode = installationConfig.viewPermissionMode; // "per_user_projects" | "open"
   let permittedProjects;
   if (mode === "open") {
    permittedProjects = "*";
   } else {
    const raw = await asUser().requestJira('/rest/api/3/project/search?action=browse&maxResults=100');
    const values = raw.values ?? raw;
    permittedProjects = values.length >= 100
      ? "*"                       // treat as admin-level
      : values.map(p => p.key);
   }

3. **View-scope access check:** If `scope === "view"` and `permittedProjects !== "*"`, verify at least one pin in the canvas is in a permitted project:
   
   javascript
   
   const pins = await asUser().requestJira('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({
      jql: `"${canvasFieldName}" = "${canvasName}"`,
      fields: ['project'],
      maxResults: 100
    })
   });
   const pinProjectKeys = [...new Set(pins.issues.map(i => i.fields.project.key))];
   const intersection = pinProjectKeys.filter(k => permittedProjects.includes(k));
   if (pinProjectKeys.length > 0 && intersection.length === 0) {
    return { ok: false, error: { code: 'NO_CANVAS_ACCESS', ... } };
   }
   
   If canvas has no tickets yet, issue token anyway (viewer will see empty overlay; correct behavior).

4. **Mint token:** Write KVS record (Part 2.1), sign JWT with `permittedProjects` (Part 2.2), return with `apiBase` and `sdkVersion` (D13).

### 4.2 `dashboardAggregate`

text

dashboardAggregate(context) → { ok, data: { canvases: [CanvasSummary], configVersion } }
CanvasSummary: { canvasName, ticketCount, openCount, urlCount, lastUpdated, projectKeys: [string], participants: [{ accountId, displayName, avatarUrl }] }

JQL: `<canvasField> is not EMPTY ORDER BY created DESC`. Fetch `<canvasField>,status,updated,assignee,reporter,project`. Paginate up to 2000 tickets. Group by `canvasField`. `projectKeys` = distinct project keys across the canvas's tickets (used by admin UI to show "this canvas spans N projects" warning in restricted mode).

Dashboard does **not** filter by `permittedProjects` — it shows all tickets the requesting user can browse via `asUser()` context. Since dashboard runs in resolver context (not webtrigger), Jira natively enforces project permissions on the query.

### 4.3 `epicPanelData`

text

epicPanelData(context, payload) → { ok, data: { canvases: [EpicCanvasSummary] } }
Payload: { epicKey: string }
EpicCanvasSummary: { canvasName, epicTicketCount, totalTicketCount, urlCount }

Dual-query, merge results:

- Company-managed: `"Epic Link" = <epicKey> AND <canvasField> is not EMPTY`

- Team-managed: `parent = <epicKey> AND <canvasField> is not EMPTY`

Group by `canvasField`. For each canvas, one additional count query. Runs in resolver context; Jira enforces project permissions natively.

### 4.4 `issuePanelData`

text

issuePanelData(context, payload) → { ok, data: { canvasName, url, relatedTickets, deepLink } }
Payload: { issueKey: string }

Reads current issue via `asApp().requestJira('/rest/api/3/issue/{key}?fields=<canvasField>,<urlField>')`. If canvas empty → `{ ok: true, data: { isJiraTack: false } }`. Else run related query via `asUser()` so project permissions apply.

### 4.5 `fieldMappingAudit`

text

fieldMappingAudit(context) → { ok, data: { projects: [{ key, name, missingFields: [string], fixUrl: string }] } }

Behavior:

1. JQL `<canvasField> is not EMPTY`, aggregate distinct project keys (cap 20).

2. For each project, call `/rest/api/3/issue/createmeta/{projectKey}/issuetypes/{issueTypeId}`; get field list.

3. Check each of the four field IDs present. Missing → `missingFields`.

4. `fixUrl` = `/secure/admin/ConfigureFieldScreen.jspa?id=<screenId>`.

### 4.6 `recoverPinsFromDescriptions`

text

recoverPinsFromDescriptions(context, payload) → { ok, data: { recovered: number, skipped: number, errors: [string] } }
Payload: { dryRun: boolean }
Auth:     Admin only (context.userAccess.isAdmin === true)

Behavior (per D9 part 3):

1. Query candidates via JQL: `<canvasField> is EMPTY AND text ~ "JiraTack pin:"` (cap 500 per run; if 500 hit, return `truncated: true` in `data`).

2. For each candidate, fetch full description via `asUser().requestJira('/rest/api/3/issue/{key}?fields=description')`.

3. Walk the ADF tree. Find any `paragraph` node whose first text child starts with `📌 JiraTack pin:`. Extract everything after the prefix, `JSON.parse()`. If parse fails, increment `skipped`, continue.

4. If parse succeeds and contains `canvas`, `url`, `position` (required keys): populate the four custom fields via `PUT /rest/api/3/issue/{key}`. Increment `recovered`.

5. If `dryRun === true`: no writes. Return `recovered` count as "would recover" count.

Called from admin page as an on-demand action. Not scheduled. Not automatic.

---

## Part 5 — Bookmarklet SDK contracts

### 5.1 Init contract

javascript

window.__jiratackInit(config)
// config: { token, apiBase, canvasId, canvasName, sdkVersion }

Called by bookmarklet bootstrap after SDK script loads. If `window.__jiratackActiveCanvas === config.canvasId`, calls `__jiratackClose()` and returns.

### 5.2 Overlay DOM contract

text

#jiratack-overlay            position: fixed; inset: 0; pointer-events: none; z-index: 2147483647
  #jiratack-pins             position: absolute; inset: 0; pointer-events: none
    .jiratack-pin[data-key]  position: absolute; pointer-events: auto
  #jiratack-sidebar          position: fixed; right: 0; top: 0; width: 360px; height: 100vh; pointer-events: auto
    .jiratack-sidebar-header
    .jiratack-ticket-list
    .jiratack-new-ticket-form
  #jiratack-toast-container  position: fixed; bottom: 16px; right: 16px

All classes prefixed `jiratack-`. All overlay elements removed on `__jiratackClose()`.

### 5.3 Session storage keys

- `jiratack_jwt_<canvasId>` → `{ jwt, expiresAt, scope, permittedProjects }`

- Nothing else. Never `localStorage`.

### 5.4 Close contract

`window.__jiratackClose()` must:

1. Remove all `.jiratack-*` elements.

2. Restore original `console.error` / `console.warn`.

3. Remove all SDK-registered event listeners.

4. Set `window.__jiratackActiveCanvas = null`.

5. Be idempotent.

---

## Part 6 — URL normalization (client and server must match)

Single module `src/shared/urlNormalize.js` bundled into both.

### 6.1 Algorithm

javascript

function normalizeUrl(input) {
  if (!input) return '';
  let u;
  try { u = new URL(input); } catch { return input.trim(); }
  u.hash = '';
  const trackingParams = [
    'utm_source','utm_medium','utm_campaign','utm_term','utm_content',
    'fbclid','gclid','mc_cid','mc_eid','_hsenc','_hsmi','ref'
  ];
  for (const p of trackingParams) u.searchParams.delete(p);
  u.hostname = u.hostname.toLowerCase();
  u.protocol = u.protocol.toLowerCase();
  if (u.pathname !== '/' && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  const sorted = [...u.searchParams.entries()].sort(([a],[b]) => a.localeCompare(b));
  u.search = sorted.length
    ? '?' + sorted.map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';
  return u.toString();
}

- Do not coerce http → https.

- Do not strip non-tracking query params.

- Path preserved exactly.

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

---

## Part 7 — JQL templates

### 7.1 Overlay query (`getPinsForCanvasAndUrl`)

text

"<canvasFieldName>" = "<canvasName>"
AND "<urlFieldName>" = "<normalizedUrl>"
AND statusCategory != Done
ORDER BY created ASC

Fields param: `summary,status,priority,assignee,reporter,issuetype,created,project,<canvasFieldId>,<urlFieldId>,<pinFieldId>,<selectorFieldId>`

Note: `project` is included in the fields param even though not returned to client — needed for `permittedProjects` filtering (Part 3.2).

### 7.2 Retirement window (if effective `retirementDays > 0`)

**Effective `retirementDays` source (per D14):** project of the canvas's oldest ticket.

1. Query: `<canvasField> = "<canvasName>" ORDER BY created ASC`, `maxResults=1`, `fields=project`.

2. If no ticket: `retirementDays = 0`.

3. Else: look up `projects[projectKey].retirementDays` from `installationConfig`.

4. Cache in KVS `canvasProjectCache:<canvasName>` → `{ projectKey, cachedAt }` with TTL 300s.

When `> 0`:

text

"<canvas>" = "<name>" AND "<url>" = "<url>"
AND (statusCategory != Done
     OR (statusCategory = Done AND statusCategoryChangedDate >= -<N>d))
ORDER BY created ASC

When `=== 0`: overlay query is §7.1.

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

### 7.6 Recovery candidates (`recoverPinsFromDescriptions`)

text

"<canvasFieldName>" is EMPTY AND text ~ "JiraTack pin:" ORDER BY created ASC

Cap at 500 results per run; if 500 hit, return `truncated: true`.

---

## Part 8 — Serialization contracts

### 8.1 ADF node shapes (client serializer)

| Tiptap node   | ADF output                                        |
| ------------- | ------------------------------------------------- |
| `paragraph`   | `{ type: "paragraph", content: [...] }`           |
| `text`        | `{ type: "text", text: "..." }`                   |
| `text` bold   | `{ ..., marks: [{ type: "strong" }] }`            |
| `text` italic | `{ ..., marks: [{ type: "em" }] }`                |
| `bulletList`  | `{ type: "bulletList", content: [listItem...] }`  |
| `orderedList` | `{ type: "orderedList", content: [listItem...] }` |
| `listItem`    | `{ type: "listItem", content: [paragraph...] }`   |
| `hardBreak`   | `{ type: "hardBreak" }`                           |

Unsupported nodes: serialize as paragraph + text node with `console.warn`.

Root: `{ type: "doc", version: 1, content: [top-level nodes] }`.

### 8.2 Empty description

If empty: `descriptionAdf = null`. Server omits client description but still appends pin marker (Part 8.4).

### 8.3 Console log append (server-side)

If `consoleLog` non-null and non-empty:

json

[
  { "type": "paragraph", "content": [{ "type": "text", "text": "Console output:" }] },
  { "type": "codeBlock", "attrs": {}, "content": [{ "type": "text", "text": consoleLog }] }
]

Client formats `consoleLog` as:

text

[error] TypeError: Cannot read property 'x' of undefined (at main.js:142)
[warn] Deprecated API usage: getElementByClass (at app.js:89)

Per entry: `[level] message (source)` when source non-null, `[level] message` when null. Level lowercase.

### 8.4 Pin marker append (server-side, per D9)

Every created ticket receives a pin marker paragraph appended at the very end of the description ADF (after client content and after console log block). This is the recovery backup for the custom fields.

json

{
  "type": "paragraph",
  "content": [
    {
      "type": "text",
      "text": "📌 JiraTack pin: {\"canvas\":\"Q3 Marketing\",\"url\":\"https://example.com/page\",\"position\":\"45.2,32.8\",\"selector\":\"#hero\"}"
    }
  ]
}

Rules:

- JSON string is single-line, keys in order: `canvas`, `url`, `position`, `selector`.

- If `selector` is null or empty: omit the `selector` key from the JSON (not `"selector":null`).

- Prefix `📌 JiraTack pin:` is exact and required. Recovery parses by finding a paragraph whose first text node starts with this prefix.

- Users may edit or delete this paragraph; if they do, that ticket is not recoverable via `recoverPinsFromDescriptions`.

Recovery parse (Part 4.6): find paragraph, strip prefix `📌 JiraTack pin:`, `JSON.parse()` the remainder. If parse fails, skip ticket.

---

## Part 9 — Error code registry

| Code                 | HTTP | Meaning                                                                   | User-facing behavior                                                                                |
| -------------------- | ---- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `BAD_REQUEST`        | 400  | Malformed payload                                                         | Toast "Something went wrong — check the form and try again."                                        |
| `TOKEN_INVALID`      | 401  | JWT signature invalid / canvas token not found                            | "Session expired. Reopen the bookmarklet."                                                          |
| `TOKEN_EXPIRED`      | 401  | Canvas token or JWT expired                                               | Same; suggest regenerating bookmarklet from Jira                                                    |
| `INSUFFICIENT_SCOPE` | 403  | JWT scope doesn't allow this action (or project not in permittedProjects) | Hidden in client (UI-gated); if reached: "View-only or no access to this project."                  |
| `LICENSE_INACTIVE`   | 403  | Installation license inactive                                             | Persistent red banner in sidebar                                                                    |
| `NO_CANVAS_ACCESS`   | 403  | User has no browse permission for any project in the canvas               | Admin UI error on "Copy review bookmarklet": "You don't have access to any project in this canvas." |
| `NOT_FOUND`          | 404  | Ticket / project / canvas not found                                       | Toast "Not found."                                                                                  |
| `PROJECT_DISABLED`   | 422  | Target project has JiraTack disabled                                      | Inline error on project selector                                                                    |
| `VALIDATION_ERROR`   | 422  | Jira rejected the field payload                                           | Inline field errors + toast "Fix highlighted fields."                                               |
| `INTERNAL`           | 500  | Unexpected server error                                                   | Toast "Something went wrong — try again." + `[JiraTack]` log                                        |

---

## Part 10 — Package and manifest

### 10.1 `manifest.yml`

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
  jira:issuePanel:
    - key: jiratack-epic-panel
      resource: epic-panel-ui
      resolver:
        function: resolver
      render: native
      title: JiraTack Canvases
    - key: jiratack-issue-panel
      resource: issue-panel-ui
      resolver:
        function: resolver
      render: native
      title: JiraTack
  function:
    - key: resolver
      handler: src/resolvers/index.handler
    - key: webtrigger-api
      handler: src/webtrigger/api.handler
    - key: webtrigger-sdk
      handler: src/webtrigger/sdk.handler
  webtrigger:
    - key: jiratack-api
      function: webtrigger-api
    - key: jiratack-sdk
      function: webtrigger-sdk
resources:

- key: dashboard-ui
  path: dist/dashboard
- key: epic-panel-ui
  path: src/ui-kit/epic-panel
- key: issue-panel-ui
  path: src/ui-kit/issue-panel
- key: project-config-ui
  path: src/ui-kit/project-config
- key: admin-ui
  path: src/ui-kit/admin

Key points:

- `render: native` on UI Kit modules (admin, project-settings, epic, issue).

- No `render: native` on `jira:globalPage` (dashboard is Custom UI).

- Runtime `nodejs22.x` (D12).

- UI Kit panels use `@forge/react`.

### 10.2 `package.json`

json

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

Sprint 4 adds `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit` at `^2.11.5`.

---

## Part 11 — Open decisions

All open decisions tracked in `DECISIONS.md`. Remaining open at contract level:

- D10 (webtrigger URL discovery) — affects §2.1 and §4.1

- D12 (runtime version) — affects §10.1
