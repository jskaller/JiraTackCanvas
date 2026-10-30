# TEST_PLAN.md

**Audience:** OpenCode, human tester. Per-sprint verification commands and assertions.
**Precedence:** If a test conflicts with CONTRACTS.md, CONTRACTS.md wins. This document tells you *how* to verify; CONTRACTS.md tells you *what* the correct behavior is.
**Rule:** A sprint is not complete until every assertion in its section passes. Do not proceed to the next sprint on partial passes.
**Verified against:** `src/` at commit `acde065`, app 4.92.0, SDK `731d221968a1`, 2026-10-30. Parts 1 and 6 were pruned of the retired custom-field/provisioning/audit/recovery tests (D18); Parts 2, 3, 5, 7 and 8 carry the current assertions.

---

## Part 0 — Testing infrastructure

### 0.1 Tools you need

| Tool                       | Purpose                                       | Install                        |
| -------------------------- | --------------------------------------------- | ------------------------------ |
| `forge` CLI                | Deploy, tunnel, logs, webtrigger URL, install | `npm i -g @forge/cli`          |
| `curl`                     | Webtrigger API testing                        | Preinstalled on macOS/Linux    |
| `jq`                       | JSON parsing in curl tests                    | `brew install jq` (macOS)      |
| Browser with DevTools      | Bookmarklet SDK testing                       | Chrome / Firefox               |
| Jira dev site admin access | KVS inspection, property checks             | `https://<site>.atlassian.net` |

### 0.2 The three testing modes

**Tunnel mode** — for live code iteration.

```bash
forge tunnel

# Leave running in one terminal. console.log() appears in this terminal.

**Deployed mode** — for verifying what actually ships.

bash

forge deploy -e development
forge logs -e development

# Logs stream in this terminal. Ctrl-C to stop.

**Webtrigger mode** — for API testing via curl.

bash

# Get the webtrigger URL once per installation:

forge webtrigger create -e development

# Output: https://<uuid>.webtrigger.<region>.forge.atlassian.com

# Export it:

export WT="https://<uuid>.webtrigger.<region>.forge.atlassian.com"

### 0.3 KVS inspection

KVS data is visible in the **Atlassian Developer Console**:

1. Go to `https://developer.atlassian.com/console/myapps/`

2. Select the JiraTack app

3. Navigate to **Storage** in the left sidebar

4. Select the installation (your dev site)

5. Browse keys: `installationConfig`, `canvasTokens:*`, `sessionSigningSecret`, `canvasProjectCache:*`, `reviewScopeConfirm:*`, `webtriggerUrls`

Alternatively, add a temporary debug resolver action `debugKvs` that returns `kvs.query().getMany()` results. Remove before sprint completion.

### 0.4 Resolver testing

Resolvers cannot be curl'd directly — they are invoked from UI Kit / Custom UI via `@forge/bridge`. To test a resolver action outside the UI:

**Option A:** Open the Jira surface (admin page, dashboard) in the browser and use the UI control.

**Option B:** Add a temporary webtrigger action `debugInvoke` that dispatches to the resolver function with a hardcoded payload. Remove before sprint completion.

**Option C:** Use the Developer Console's function tester if available (not all regions expose it).

**Recommendation:** Use Option A for acceptance tests; use Option B for rapid iteration on resolver logic.

### 0.5 JWT inspection

Decode a JWT without verifying signature (browser console or `jq`):

bash

# Split on dots, base64-decode the middle part

echo "<jwt>" | cut -d. -f2 | base64 -d 2>/dev/null | jq .

Verify:

- `scope` is `"create"` or `"view"`

- `permittedProjects` is an array of strings or `"*"`

- `canvasId` matches the canvas name

- `exp` is ~8 hours from `iat`

- `aud` matches the installation ID

---

## Part 1 — Sprint 1 tests: Scaffolding, Metadata, Admin Config

### 1.1 Deploy and install

bash

forge deploy -e development

# Assert: exits 0

forge install -e development

# Assert: exits 0, or "already installed" if re-running

### 1.2 All five surfaces render

| Surface          | How to reach                                     | Assert                                            |
| ---------------- | ------------------------------------------------ | ------------------------------------------------- |
| Global page      | Jira → Apps → **JiraTack Canvases**              | Dashboard renders with the canvas table |
| Admin page       | Jira Settings → Apps → **JiraTack**              | Admin config renders with `viewPermissionMode` and token list |
| Project settings | Project Settings → Apps → **JiraTack**           | Project config form renders                       |
| Epic panel       | Open any epic → Panels → **JiraTack Canvases**   | Panel renders (empty state is correct)            |
| Issue panel      | Open any issue → Panels → **JiraTack**           | Panel renders ("Not a JiraTack ticket" for unindexed issues) |
| Webtrigger       | `curl -s $WT/api -X POST -d '{"action":"getPriorities"}' -H "Authorization: Bearer $JWT"` | Returns `{ ok: true, data: { priorities: [...] } }` |

Browser console for each surface: **no red errors**. Warnings are acceptable if from Jira itself.

After updating manifest scopes, run `forge install --upgrade -e development` to authorize them.

### 1.3 Metadata and labels (replaces field provisioning)

There is nothing to provision. Verify the storage model instead (D18):

1. Create a ticket from a write bookmarklet on a test page (Part 4 if not yet possible), or create one via `createIssue`.

2. Fetch the property:

```bash
curl -s -u "$EMAIL:$API_TOKEN" \
  "https://<site>.atlassian.net/rest/api/3/issue/<KEY>/properties/com.jiratack.metadata" | jq .
```

3. Assert the value is:

```json
{
  "pin": { "canvas": "<canvas>", "url": "<normalised url>", "position": "<relX,relY>", "selector": "#x" },
  "version": 1
}
```

4. Assert the issue labels include `jiratack`, and `jiratack-guest` for a guest-created ticket.

5. Assert **no** JiraTack custom fields exist: Jira admin → Settings → Issues → Custom Fields contains no `JiraTack Canvas`, `Page URL`, `Pin Position`, or `Pinned Selector` created by the app.

### 1.4 `installationConfig` in KVS

Open Developer Console → Storage → `installationConfig`, or read it via the admin resolver.

Assert shape:

```json
{
  "viewPermissionMode": "per_user_projects",
  "projects": {},
  "archivedCanvases": [],
  "deletedCanvases": [],
  "configVersion": "<64-hex>",
  "updatedAt": 1234567890,
  "schemaVersion": 1
}
```

Assert: **no `fieldRegistry` key.**

### 1.5 `viewPermissionMode` toggle

1. Admin page: change the toggle from `per_user_projects` to `open`.

2. Assert: success message, and `configVersion` in KVS changes.

3. Toggle back. Assert `configVersion` changes again.

### 1.6 No provisioning or audit surface (D18)

1. Open the admin page.

2. Assert: there is **no** "Provision fields" button, no field-ID selects, no field mapping audit panel, and no recovery action.

3. Assert: the page loads without errors and shows license status, `viewPermissionMode`, the token list, and the archived/deleted canvas lists.

### 1.7 Project config round-trip

1. Project Settings → JiraTack: set `enabled: true`, `defaultIssueTypeId: "10001"`, `retirementDays: 7`.

2. Save. Reload the page.

3. Assert: all values persist.

4. Assert: `installationConfig.projects["<KEY>"]` in KVS matches.

### 1.8 Webtrigger URL discovery (D10)

D10 is resolved: `webTrigger.getUrl('<triggerKey>')` works from resolver context, so no admin-side discovery or KVS caching is required.

1. In a resolver, resolve all three and log them:

```javascript
const { webTrigger } = require('@forge/api');
const api = await webTrigger.getUrl('jiratack-api');
const sdk = await webTrigger.getUrl('jiratack-sdk');
const install = await webTrigger.getUrl('jiratack-install');
console.log('[JiraTack] urls', { api, sdk, install });
```

2. Assert: all three return absolute HTTPS URLs.

3. Assert: `generateCanvasToken` returns both `apiUrl` and `sdkUrl`, and they are **different** URLs (the SDK is not derived from the API URL).

4. Assert: `generateGuestToken` returns an `installerUrl` of the form `<install>?token=<token>`.

`resolveWebtriggerUrls()` still honours a `webtriggerUrls` value in `installationConfig` if one is present, so an operator can pin URLs; nothing writes that key in normal operation.

### 1.9 Logs are clean

bash

forge logs -e development

# Assert: no lines starting with "[JiraTack] ERROR"

# Assert: no unhandled promise rejections

### Sprint 1 exit criteria

All of 1.1–1.10 pass. Commit: `feat(s1): scaffolding, metadata model, admin config`.

---

## Part 2 — Sprint 2 tests: Token Issuance and Webtrigger API

**Prerequisite:** Sprint 1 complete, `$WT` exported, at least one test project with JiraTack enabled.

### 2.1 URL normalization test vectors

bash

node src/shared/urlNormalize.test.js

# Assert: all 10 vectors print PASS, exit code 0

### 2.2 ADF serializer test vectors

bash

node src/shared/adfSerializer.test.js

# Assert: all 8 node types print PASS, exit code 0

### 2.3 JWT sign/verify/expiry/tamper

bash

node src/lib/tokens.test.js

# Assert:

# sign → verify round-trip succeeds

# tampered payload → verification fails

# expired exp → verification fails

# wrong aud → verification fails

# permittedProjects claim preserved

### 2.4 Generate a canvas token (via admin UI or debug webtrigger)

**Option A — Admin UI:** (not yet implemented in S2; use Option B)

**Option B — Debug webtrigger:**

bash

curl -s -X POST "$WT/api" \
  -H "Content-Type: application/json" \
  -d '{"action":"debugGenerateToken","payload":{"canvasName":"Q3 Marketing","scope":"create"}}' \
  | jq .

# Assert:

# .ok == true

# .data.token is 64-char hex

# .data.scope == "create"

# .data.apiBase starts with "https://"

# .data.sdkVersion is a 12-char hex string

Save the token:

bash

export CANVAS_TOKEN="<from .data.token>"

### 2.5 KVS canvas token record

Developer Console → Storage → `canvasTokens:<token>`.

Assert:

json

{
  "canvasName": "Q3 Marketing",
  "userId": "<your accountId>",
  "installationId": "<installation>",
  "scope": "create",
  "issuedAt": <epoch_ms>,
  "expiresAt": <issuedAt + 2592000000>,
  "revoked": false
}

Assert TTL: the storage entry should show an expiry ~30 days from now.

### 2.6 Exchange token → get session JWT

bash

curl -s -X POST "$WT/api" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"exchangeToken\",\"payload\":{\"canvasToken\":\"$CANVAS_TOKEN\"}}" \
  | jq .

# Assert:

# .ok == true

# .data.sessionJwt is a JWT (3 dot-separated parts)

# .data.scope == "create"

# .data.permittedProjects is an array OR "*"

# .data.canvasName == "Q3 Marketing"

Save the JWT:

bash

export JWT="<from .data.sessionJwt>"

Decode JWT:

bash

echo "$JWT" | cut -d. -f2 | base64 -d 2>/dev/null | jq .

# Assert claims: iss="jiratack", sub, aud, canvasId, canvasName, scope, permittedProjects, iat, exp

### 2.7 Exchange expired token

bash

# Manually edit KVS canvasTokens:<token> → set expiresAt to past

curl -s -X POST "$WT/api" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"exchangeToken\",\"payload\":{\"canvasToken\":\"$CANVAS_TOKEN\"}}" \
  | jq .

# Assert: .ok == false, .error.code == "TOKEN_EXPIRED"

### 2.8 Exchange revoked token

bash

# Set canvasTokens:<token>.revoked = true

curl ... # same as above

# Assert: .ok == false, .error.code == "TOKEN_INVALID"

### 2.9 `getPinsForCanvasAndUrl` — happy path

**Prerequisite:** At least one ticket exists whose `com.jiratack.metadata` has `pin.canvas = "Q3 Marketing"`, a `pin.url`, and a `pin.position`.

bash

curl -s -X POST "$WT/api" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{"action":"getPinsForCanvasAndUrl","payload":{"canvasId":"Q3 Marketing","url":"https://example.com/page"}}' \
  | jq .

# Assert:

# .ok == true

# .data.pins is an array with ≥1 PinRecord

# .data.pins[0] has: key, summary, status.name, pinPosition, selector, createdAt

# .data.canvasName == "Q3 Marketing"

### 2.10 `permittedProjects` filtering (D9)

**Setup:**

1. Create two projects: Project A (you have access), Project B (create a second user with access only to B; or use a project you don't have access to).

2. Create one ticket in each with the same canvas name + same URL.

3. Generate a `view` token as a user with access only to Project A.

**Test:**

bash

curl -s -X POST "$WT/api" \
  -H "Authorization: Bearer $VIEW_JWT" \
  -d '{"action":"getPinsForCanvasAndUrl","payload":{"canvasId":"Q3 Marketing","url":"https://example.com/page"}}' \
  | jq .

# Assert:

# .data.pins contains ONLY Project A ticket

# Project B ticket is absent

**Test with `viewPermissionMode: "open"`:**

1. Admin page: set `viewPermissionMode` to `open`.

2. Re-generate view token.

3. Query same canvas + URL.

4. Assert: both Project A and B tickets returned.

### 2.11 `createIssue` — happy path

bash

curl -s -X POST "$WT/api" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{
    "action": "createIssue",
    "payload": {
      "canvasId": "Q3 Marketing",
      "url": "https://example.com/test-page",
      "pinPosition": "45.2,32.8",
      "selector": "#hero",
      "summary": "Test ticket from curl",
      "descriptionAdf": {"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"Test description"}]}]},
      "issueTypeId": "<valid-issue-type-id>",
      "projectKey": "<your-project>",
      "priorityId": null,
      "assigneeAccountId": null,
      "parentKey": null
    }
  }' | jq .

# Assert:

# .ok == true

# .data.key matches /^[A-Z]+-\d+$/

**Verify in Jira UI:**

- Summary starts with `[JiraTack] Test ticket from curl`

- Labels include `jiratack`

- Reporter = the user who owns the JWT

- Labels include `jiratack`

- Issue property `com.jiratack.metadata`:

  ```json
  { "pin": { "canvas": "Q3 Marketing", "url": "https://example.com/test-page",
             "position": "45.2,32.8", "selector": "#hero" }, "version": 1 }
  ```

- Description is human-readable ADF only: bold `[JiraTack]` header, the body, and a `Page: <link>` footer. No JSON, no marker.

### 2.12 `createIssue` — property round-trip

```bash
curl -s -u "$EMAIL:$API_TOKEN" \
  "https://<site>.atlassian.net/rest/api/3/issue/<KEY>/properties/com.jiratack.metadata" | jq .

# Assert: .value.pin.canvas / .url / .position / .selector match the form values
# Assert: .value.version == 1
# Assert: description contains no "JiraTack pin:" text
```

### 2.13 `createIssue` — scope enforcement

bash

# Get a view-scoped JWT

curl ... exchangeToken with a view canvas token ...
export VIEW_JWT="..."
curl -s -X POST "$WT/api" \
  -H "Authorization: Bearer $VIEW_JWT" \
  -d '{"action":"createIssue","payload":{...}}' | jq .

# Assert: .ok == false, .error.code == "INSUFFICIENT_SCOPE"

### 2.14 `createIssue` — project not in `permittedProjects`

1. Get a create-scoped JWT for a user with access only to Project A.

2. Attempt `createIssue` with `projectKey: "B"`.

3. Assert: `INSUFFICIENT_SCOPE`.

### 2.15 `getTransitions`

bash

curl -s -X POST "$WT/api" \
  -H "Authorization: Bearer $JWT" \
  -d '{"action":"getTransitions","payload":{"issueKey":"<KEY>"}}' | jq .

# Assert:

# .data.transitions is an array

# each has: id, name, to.id, to.name, to.statusCategory.key

### 2.16 `updateIssue` — status, priority, assignee, summary, description

bash

# Status change (view JWT → 403, create JWT → succeeds)

curl ... updateIssue {"issueKey":"<KEY>","fields":{"statusId":"<transition-id>"}}

# Assert: .ok == true

# Priority

curl ... updateIssue {"issueKey":"<KEY>","fields":{"priorityId":"3"}}

# Assert: .ok == true

# Assignee

curl ... updateIssue {"issueKey":"<KEY>","fields":{"assigneeAccountId":"<accountId>"}}

# Assert: .ok == true

# Summary (prefix re-added idempotently; empty → VALIDATION_ERROR; >215 chars → VALIDATION_ERROR)

curl ... updateIssue {"issueKey":"<KEY>","fields":{"summary":"New title"}}

# Assert: .ok == true; Jira summary == "[JiraTack] New title"

# Description (only the user body is replaced; guest header, console block and page footer preserved)

curl ... updateIssue {"issueKey":"<KEY>","fields":{"descriptionText":"line one\n\nline two"}}

# Assert: .ok == true
# Assert: description still starts with the [JiraTack…] header and ends with the Page: link
# Assert: console block (if present) still sits immediately before the footer
# Assert: a ticket whose description lacks the [JiraTack…] header → 422 VALIDATION_ERROR

# Authorization (all scopes, including create/universal):

# - non-jiratack issueKey → 403 INSUFFICIENT_SCOPE
# - issue in a project outside permittedProjects → 403 INSUFFICIENT_SCOPE
# - issue on a canvas outside permittedCanvases (guest) → 403 INSUFFICIENT_SCOPE
# - guest JWT + unlicensed assigneeAccountId → 422 VALIDATION_ERROR
# - view JWT → 403 INSUFFICIENT_SCOPE

### 2.17 `searchUsers`

bash

curl -s -X POST "$WT/api" \
  -H "Authorization: Bearer $JWT" \
  -d '{"action":"searchUsers","payload":{"projectKey":"<your-project>","query":"sam"}}' | jq .

# Assert: .data.users is an array; each has accountId, displayName, avatarUrl

# View JWT → 403 INSUFFICIENT_SCOPE

### 2.18 `viewPermissionMode: "open"` — `permittedProjects: "*"`

1. Admin page: set mode to `open`.

2. Generate view token → exchange.

3. Decode JWT: assert `permittedProjects === "*"`.

4. `getPinsForCanvasAndUrl`: assert all pins returned regardless of project.

### 2.19 `NO_CANVAS_ACCESS`

1. Create a canvas with tickets only in Project B.

2. As a user with access only to Project A, try to generate a view token for that canvas.

3. Assert: `NO_CANVAS_ACCESS`.

### 2.20 Resolver authorisation (D19)

Run each as a **non-admin** Jira user from the dashboard/project-settings page, then repeat as admin.

1. `setInstallationConfig { viewPermissionMode: "open" }` → non-admin: `INSUFFICIENT_SCOPE`, and the mode on disk is unchanged; admin: succeeds.
2. `getInstallationConfig` → non-admin: `INSUFFICIENT_SCOPE` (config contents must not be readable).
3. `getProjectConfig` / `setProjectConfig` → non-admin: `INSUFFICIENT_SCOPE`, project settings page shows the permission message rather than silently rendering defaults.
4. `generateGuestToken` → **licensed non-admin: succeeds** (seat is the boundary, not admin); **unlicensed user: `LICENSE_INACTIVE`**, and the dashboard hides the button when `hasAccess === false`.
5. `listCanvasTokens` → admin only; assert the payload contains **`tokenRef`** and contains **no `token` field** anywhere in the response.
6. `revokeCanvasToken { tokenRef }` → admin only; after revoking, `exchangeToken` with that token returns `TOKEN_INVALID`, but a session JWT issued **before** revocation still works until `exp` (known D19 limitation).
7. `createCanvas` as a non-admin licensed user → still succeeds (intentional: additive, Jira enforces project create permission).
8. KVS failure handling: with a stale/absent config, assert `getInstallationConfig` returns defaults, but a read error surfaces as `INTERNAL` and does **not** write defaults over an existing config.
9. SDK auto-reauth: let a session JWT expire, trigger any authenticated action, and assert it self-heals (one re-exchange + retry) instead of surfacing `TOKEN_EXPIRED`.

10. **Guest JWT → `createCanvas`:** returns **403 `INSUFFICIENT_SCOPE`**. Assert the response is the 403 envelope (not 200, not a validation error) and that **no seed ticket is created**. Also decode the guest JWT and assert `isAdmin === false`.
11. **Licensed non-admin JWT (`create` or `universal`) → `createCanvas`:** returns **403 `INSUFFICIENT_SCOPE`**; no seed ticket. The dashboard `createCanvas` resolver returns the same for the same user (the check is not bypassable by switching surfaces).
12. **Admin JWT → `createCanvas`:** succeeds (200, seed ticket created). Decode the JWT first and assert `isAdmin === true`. Re-issue a bookmarklet before this test, because tokens minted before D21 carry no claim and fail closed.
13. **Claim staleness:** demote a user (or use a token issued while they were admin) and confirm `createCanvas` still succeeds until the JWT expires — the documented D21 limitation, not a regression.

### 2.21 Screenshot chunk upload and URL safety (D20)

1. Create a ticket with a screenshot → assert the attachment exists on the issue, is an image, and the same bytes render in the issue panel.
2. Assert no single request body exceeds ~250 KB: capture the network tab while creating; every request is `beginScreenshotUpload`, `uploadScreenshotChunk`, then `createIssue` with **`screenshotUploadId`** and **no `screenshotDataUrl`**.
3. After creation, assert the `screenshot:<id>` and `screenshot:<id>:*` KVS keys are gone (deleted on attach; otherwise TTL 15 min).
4. Guest session: chunk upload and attach succeed; a chunk sent with another session's `uploadId` returns `NOT_FOUND`.
5. `beginScreenshotUpload` with a size above the cap → `VALIDATION_ERROR`; a chunk over 200 KiB → `VALIDATION_ERROR`.
6. `createIssue` with `url: "javascript:alert(1)"` → `VALIDATION_ERROR` (no ticket created).
7. In the dashboard, a canvas/pin whose URL is `javascript:...` renders as inert text, not a link; in the bookmarklet, clicking such a pin does not navigate.
8. `node src/shared/safeUrl.test.js` → all vectors pass.

### Sprint 2 exit criteria

All of 2.1–2.20 pass. Commit: `feat(s2): token issuance, webtrigger API, authorisation`.

---

## Part 3 — Sprint 3 tests: Bookmarklet SDK Scaffold

**Prerequisite:** Sprint 2 complete, at least 3 pins seeded in a canvas, `$WT` exported.

### 3.1 Build the SDK

bash

npm run build

# Assert: exits 0

# Assert: dist/bookmarklet/jiratack.js exists and is minified

# Assert: src/lib/sdk-bundle.js exists and exports sdkSource

# Assert: src/lib/version.js exports SDK_VERSION (12 hex chars)

### 3.2 SDK served by webtrigger

bash

curl -s -i "$WT/../bookmarklet.js" 2>/dev/null || \
curl -s -i "$(echo $WT | sed 's|/api$||')/bookmarklet.js"

# Adjust URL based on actual webtrigger paths from manifest.

# Assert:

# HTTP 200

# Content-Type: text/javascript

# Cache-Control: public, max-age=86400

# Body starts with "(function" or "(()=>"

### 3.3 Generate bookmarklet

Use the dashboard's bookmarklet modal ("Copy") or `buildBookmarklet()` from `src/shared/bookmarklet.js`. Do not hand-build the bootstrap: it must carry the failure detection described in §3.12.

Assert the generated URL:

- starts with `javascript:` and stays under ~4,000 characters;
- embeds `token`, `apiUrl`, `sdkUrl`, `canvasId`, `canvasName`, `sdkVersion`;
- carries `sdkUrl` as a distinct URL — it must not be derived from `apiUrl` (D10);
- ends with `?v=<SDK_VERSION>` appended to `sdkUrl` at load time, not baked into the stored URL.

### 3.4 Load on a test page

1. Open `https://example.com/page` in Chrome.

2. Open DevTools console.

3. Paste the bookmarklet (as a script, not a URL — or save as a bookmark and click it).

4. Assert:
   
   - No red console errors.
   
   - Overlay appears with `#jiratack-overlay` in DOM.
   
   - Pins render at seeded positions.
   
   - Sidebar lists tickets with status, priority, assignee, reporter.
   
   - Sidebar header shows the canvas name.
   
   - Scope badge shows nothing (create scope).

### 3.5 Pin positioning

- **Relative pin (`selector` non-empty):** assert pin aligns with the element described by the selector (within 2px).

- **Absolute pin (`selector` empty):** assert pin is at `(absX, absY)` in page coordinates.

- **Selector miss:** rename the element's ID in DevTools to break the selector. Reload + re-activate. Assert pin falls back to absolute position (or "detached" cluster if no absolute coords).

### 3.6 Pin/card interaction

- Click a pin → corresponding card highlights + scrolls into view.

- Click a card → corresponding pin highlights + scrolls into view.

- Click another pin → previous selection clears; new pair selected.

- Assert only one pair selected at a time.

### 3.7 View scope

1. Generate a `view` token (same canvas).

2. Build and paste view bookmarklet.

3. Assert:
   
   - Sidebar header shows `View only` badge.
   
   - No pin-mode toggle.
   
   - Cards do not expand to inline-edit.
   
   - Clicking a card opens the Jira issue in a new tab.

### 3.8 Close and re-open

- Click bookmarklet again → overlay closes.

- Assert:
  
  - `#jiratack-overlay` removed from DOM.
  
  - `window.__jiratackActiveCanvas === null`.
  
  - No `jiratack-*` elements remain in DOM.
  
  - Original `console.error` restored (check `console.error.toString()`).

- Click bookmarklet again → overlay reopens with same pins.

### 3.9 SPA navigation

1. On a SPA test page (or `example.com` with manual `history.pushState`):

2. In console: `history.pushState({}, '', '/different-url')`.

3. Wait 500ms.

4. Assert: pins re-query for new URL (may show empty if no pins on new URL).

5. `history.back()`. Assert: pins re-query for original URL.

### 3.10 `permittedProjects` indicator

- Decode JWT from `sessionStorage` key `jiratack_jwt_Q3 Marketing`.

- Assert: `permittedProjects` is present (array or `"*"`).

- Sidebar header may show a "Viewing N projects" badge (optional but specified).

### 3.11 No console proxy yet

- `console.error('test')` before activation.

- Activate bookmarklet.

- Assert: no console buffer captured (console proxy is S4, not S3).

### 3.12 CSP failure message (D22)

- Open a strict-CSP site (github.com is reliable) with the browser console visible.

- Click the bookmarklet.

- Assert: the spinner is replaced by a card reading "JiraTack could not start on this page" with a CSP reason and a Dismiss button.

- Assert: Dismiss removes the card and the injected style; the page is otherwise untouched.

- Assert: the console contains a `[JiraTack]` error line naming the reason.

- Repeat on a site that allows the script (example.com) and assert the overlay opens normally with no error card.

- Optional Trusted Types check: on accounts.google.com, assert the reason names Trusted Types rather than a generic CSP block.

### Sprint 3 exit criteria

All of 3.1–3.12 pass. Commit: `feat(s3): bookmarklet SDK scaffold`.

---

## Part 4 — Sprint 4 tests: Capture Flow

**Prerequisite:** Sprint 3 complete, a live page with console activity.

### 4.1 Pin mode activation

- Click "Pin mode" toggle.

- Assert: cursor becomes crosshair.

- Hover over an element: assert `#1869DB` dashed outline + tooltip (`DIV · click to pin`).

- Press `Esc`: assert pin mode exits without creating a pin.

### 4.2 Drop a pin

- Click "Pin mode" → click on element.

- Assert:
  
  - Pin renders at click point.
  
  - New-ticket form opens in sidebar.
  
  - Form fields: Project, Issue type, Summary (with `[JiraTack]:` prefix), Description, Priority, Assignee, Parent, Console checkbox, Screenshot thumbnail, Submit/Cancel.

### 4.3 Form validation

- Summary empty → Submit disabled, inline "Summary required" error.

- Summary > 215 chars → input truncates at 215.

- Summary with line break → blocked (no line breaks allowed).

- Parent invalid format (`not-a-key`) → inline error on blur.

- Required fields not satisfied → toast "[N] required fields still outstanding."

### 4.4 Console checkbox visibility

- Project config `captureConsoleLogs: false` → checkbox hidden.

- `captureConsoleLogs: true` → checkbox visible.

- Buffer empty → checkbox disabled with tooltip "No console output captured."

- `consoleLogsDefaultChecked: true` → checkbox checked on open.

### 4.5 Console capture

1. Before activating bookmarklet: `console.error('pre-activation')`.

2. Activate bookmarklet. `console.error('post-activation-error')`, `console.warn('post-activation-warn')`.

3. Drop a pin. Open form.

4. Assert: checkbox enabled (buffer non-empty).

5. Check it. Submit.

6. Assert: description contains:
   
   text
   
   Console output:
   [error] post-activation-error (at <source>)
   [warn] post-activation-warn (at <source>)

7. Assert: `pre-activation` error is NOT captured (documented limitation).

### 4.6 Screenshot capture

- Drop a pin on a page with visible content.

- Assert: screenshot thumbnail appears in form (400×400 crop centered on pin).

- Click "✕ Remove" → thumbnail gone.

- Submit without screenshot → ticket created, no attachment.

- Submit with screenshot → ticket created, attachment visible in Jira.

### 4.7 Screenshot failure fallback

- Test on a page with cross-origin images that taint the canvas (e.g. external `<img>` without CORS).

- Drop a pin.

- Assert: no thumbnail shown (silent failure).

- Submit → ticket created without attachment. **No error toast.**

### 4.8 Submit success

- Fill form, submit.

- Assert:
  
  - Toast "Ticket created."
  
  - Pin renders optimistically.
  
  - Sidebar refreshes with new ticket.
  
  - Jira ticket exists with all fields populated.
  
  - Issue labels include `jiratack`, and `jiratack-guest` for guest tickets.
  
  - Issue property `com.jiratack.metadata` matches the capture values.
  
  - Description is ADF only: header, body, optional console block, `Page:` footer.

### 4.9 Cancel

- Drop pin → form opens → click Cancel.

- Assert: form closes, no ticket created, no server call (check Network tab).

### 4.10 Description round-trip (plain text)

The form uses a plain textarea, not a rich-text editor.

- Enter three lines with a blank line between the second and third.

- Submit.

- Assert the description ADF matches CONTRACTS §8.1: one paragraph per line, a contentless paragraph for the blank line, and no marks or list nodes.

### 4.11 Metadata integrity

- After submit, fetch `com.jiratack.metadata` via the properties API.

- Assert `pin.canvas`, `pin.url`, `pin.position`, `pin.selector` match the capture.

- Assert `pin.selector` is `null` when no selector was found (the key is present and null — there is no key-omission rule any more).

- Assert `version === 1`.

### Sprint 4 exit criteria

All of 4.1–4.11 pass. Commit: `feat(s4): capture flow`.

---

## Part 5 — Sprint 5 tests: Canvas Dashboard

**Prerequisite:** Sprint 4 complete, at least 2 canvases with pins.

### 5.1 Dashboard loads

- Open Jira → Apps → JiraTack Canvases.

- Assert: table loads with all canvases.

- Assert: no console errors.

### 5.2 Canvas list accuracy

- Assert each canvas row shows:
  
  - Canvas name (bold).
  
  - Open count / total count (matches JQL).
  
  - URL count (distinct normalized URLs).
  
  - Last updated (max `updated` across tickets).
  
  - Participants (avatar stack, max 5).

- Create a new ticket → reload → assert counts update.

### 5.3 Search filter

- Type "Marketing" in search → assert only canvases with "Marketing" in name shown.

- Clear search → all canvases shown.

- Search case-insensitive.

### 5.4 Multi-project canvas badge

- Canvas spanning Project A + B → assert row shows `"2 projects"` badge.

- Hover badge → tooltip lists `MM, DS`.

- In `per_user_projects` mode → tooltip also notes "Viewers only see pins from projects they can browse."

- Single-project canvas → shows project key (e.g. `MM`).

### 5.5 Write bookmarklet generation

- Click "Get write bookmarklet" for a canvas.

- Assert: modal opens with `javascript:` link + "Copy URL" button.

- Assert: modal shows explanation.

- Copy URL → paste in browser address bar → overlay opens in create mode.

### 5.6 Review bookmarklet generation

- Click "Copy review bookmarklet" for a canvas.

- Assert: confirmation dialog on first use: *"Anyone with this bookmarklet can see pins from projects they have access to. Continue?"*

- After confirming → modal opens with `javascript:` link.

- Assert: generated bookmarklet produces view-scoped overlay.

### 5.7 `NO_CANVAS_ACCESS` UX

- As a user with access only to Project A, try "Copy review bookmarklet" for a canvas with tickets only in Project B.

- Assert: inline error: *"You don't have access to any project in this canvas. Ask the canvas owner to grant access, or ask a licensed team member with access to share their view bookmarklet."*

### 5.8 Write bookmarklet disabled for unlicensed

- In a dev context where `userAccess.hasAccess === false`, assert "Get write bookmarklet" is disabled with tooltip: *"Your Jira admin has not granted you access to JiraTack."*

- In dev (`hasAccess === undefined`), button is enabled.

### 5.9 Revoke token

- Note an existing canvas token from KVS.

- Click "Revoke access" for that token.

- Assert: KVS record `revoked: true`.

- Reopen the bookmarklet → assert "Bookmarklet expired. Generate a new one from Jira." message.

### 5.10 Token list

- Assert: token list shows columns: Scope, User, Canvas, Issued, Expires, Revoke.

- Assert: revoked tokens are removed from the list (or shown with "Revoked" badge).

### 5.11 Open in Jira

- Click "Open in Jira" for a canvas.

- Assert: new tab opens with JQL `jiratackCanvas = "Q3 Marketing"` (the entity-property search alias). If the canvas does not appear, the index has not caught up — verify the alias is declared in `manifest.yml` before treating it as a bug.

- Assert: results match canvas tickets.

### Sprint 5 exit criteria

All of 5.1–5.11 pass. Commit: `feat(s5): canvas dashboard`.

---

## Part 6 — Sprint 6 tests: Epic Panel and Issue Panel

**Prerequisite:** Sprint 5 complete, at least 1 company-managed epic + 1 team-managed epic with JiraTack tickets.

### 6.1 Epic panel — company-managed

- Open a company-managed epic with tickets in 2 canvases.

- Assert: panel shows "JiraTack Canvases referenced by this epic."

- Assert: each canvas row shows `epicTicketCount`, `totalTicketCount`, `urlCount`.

- Assert: counts correct (verify via JQL).

- Assert: `totalTicketCount` is the canvas-wide count and is **larger** than `epicTicketCount` when the canvas holds tickets outside this epic. (Before the fix both values were identical.)

### 6.2 Epic panel — team-managed

- Open a team-managed epic with child tickets in a canvas.

- Assert: same panel content as 6.1.

- Assert: `parent` query works for team-managed.

### 6.3 Epic panel — non-epic issue

- Open a Task/Bug issue.

- Assert: epic panel does NOT render (or shows "Not an epic" fallback if displayConditions fallback is used).

### 6.4 Epic panel buttons

- "Get write bookmarklet" → modal.

- "Copy review bookmarklet" → confirmation → modal.

- "Open canvas" → dashboard filtered by canvas.

### 6.5 Issue panel — JiraTack ticket

- Open a ticket whose `com.jiratack.metadata` is set.

- Assert panel shows:
  
  - Canvas name (clickable → dashboard).
  
  - Page URL (clickable).
  
  - "Copy link to this pin" button.
  
  - "Copy review bookmarklet" button.
  
  - Related tickets list (same canvas + URL, cap 20).

### 6.6 Issue panel — non-JiraTack ticket

- Open a ticket with no `com.jiratack.metadata`.

- Assert panel shows "Not a JiraTack ticket."

### 6.7 Deep link

- Click "Copy link to this pin" → paste URL.

- Assert URL format: `<pageUrl>?jiratack_ticket=<key>`.

- Paste in browser → bookmarklet activates → matching pin highlighted + scrolled into view.

### 6.8 Deep link — pin not found

- Copy deep link, then delete the ticket (or change canvas).

- Paste → bookmarklet activates → toast "Ticket <key> not found on this canvas/page."

### 6.9 Related tickets accuracy

- Assert related list includes tickets with same canvas + same URL, excluding current ticket.

- Assert cap at 20 (create 25 related → only 20 shown).

### 6.10 Field audit and recovery — retired (D18)

Sections 6.10–6.14 described the custom-field mapping audit, description-marker recovery, and the dry-run/actual/malformed/no-marker cases. All of it is gone: there are no custom fields to map and no marker to recover from.

Replace those tests with one assertion:

- Admin page has no field-audit section and no recovery action.
- A ticket created without `com.jiratack.metadata` does not appear in the dashboard, epic panel, issue panel, or overlay, and no error is raised. This is expected, not a defect.

### Sprint 6 exit criteria

All of 6.1–6.10 pass. Commit: `feat(s6): epic panel and issue panel`.

---

## Part 7 — Sprint 7 tests: Inline Edit, Done, Retirement, License

**Prerequisite:** Sprint 6 complete.

### 7.1 Inline edit — status

- Expand a ticket card in the sidebar.

- Assert: status picker shows only valid transitions (from `getTransitions`).

- Select a new status.

- Assert: card updates optimistically.

- Assert: Jira ticket reflects the change.

- Force failure (disconnect network mid-request) → assert card reverts + error toast.

### 7.2 Inline edit — priority

- Expand card → change priority → assert optimistic update + server confirmation.

- Assert: the priority dropdown is enabled after options load (regression: it must not stay disabled).

### 7.3 Inline edit — assignee

- Expand card → focus assignee field → assert typeahead results appear without typing.

- Type to filter → assert results narrow; pick a user → assert card updates + ticket assignee changes.

- With an assignee set, reopen → assert an "Unassign" item is present; select it → assert assignee clears.

- Force search failure (disconnect network) while typing → assert inline error note, not a silent empty list.

### 7.4 Done animation

- Transition a ticket to Done.

- Assert sequence:
  
  1. Pin flashes `#2ECC71` + checkmark, ~400ms.
  
  2. Card flashes green, ~400ms.
  
  3. ~1.5s pause.
  
  4. Pin fades (300ms).
  
  5. Card greyed with "Done" badge.
  
  6. Pin removed from DOM.
  
  7. Sidebar count decrements.

### 7.5 View scope — no inline edit

- Open view-scoped bookmarklet.

- Assert: cards do not expand to inline-edit.

- Assert: clicking card opens Jira issue in new tab.

### 7.6 Retirement — `retirementDays: 0`

- Set project config `retirementDays: 0`.

- Create a Done ticket with a pin.

- Reload bookmarklet.

- Assert: Done pin NOT shown in overlay.

### 7.7 Retirement — `retirementDays: 7`

- Set `retirementDays: 7`.

- Create a Done ticket (`statusCategoryChangedDate` = now).

- Reload.

- Assert: Done pin shown at `#2ECC71` opacity 0.5, read-only (no inline edit on Done pins).

- Manually set the ticket's `statusCategoryChangedDate` to 10 days ago (via Jira API if possible, or wait — not feasible in test; use a unit test on the JQL builder instead).

- Assert JQL builder produces `>= -7d` clause.

### 7.8 Retirement — multi-project canvas (D14)

- Canvas spans Project A + B. Oldest ticket in A has `retirementDays: 7`; Project B has `retirementDays: 30`.

- Assert: effective config = 7 (from oldest ticket's project A).

- Change oldest ticket's project to B (via Jira move) → wait for cache expiry (300s) or clear `canvasProjectCache:<canvas>`.

- Reload → assert effective config = 30.

### 7.9 License — active (dev)

- In dev, `license === undefined`.

- Assert: `generateCanvasToken(create)` succeeds.

- Assert: `exchangeToken` succeeds.

- Assert: no license banner in sidebar.

### 7.10 License — inactive

- Simulate inactive license (set `license.active = false` in test harness or via Marketplace test license).

- Assert: `generateCanvasToken(create)` returns `LICENSE_INACTIVE`.

- Assert: `exchangeToken` returns 403 `LICENSE_INACTIVE`.

- Assert: sidebar shows persistent red banner: "JiraTack license expired. Contact your Jira admin."

- Assert: `generateCanvasToken(view)` still works if user has browse access (per D9 / SPEC §18).

### 7.11 Revocation lag documentation

- Admin page: verify text explains "Revoking a token prevents new sessions from being created, but existing sessions remain valid for up to 8 hours."

- Verify this text is visible without scrolling.

### 7.12 Marketplace materials

- `docs/PRIVACY.md` exists, covers data collected, retention, delegation model.

- `docs/MARKETPLACE.md` exists, covers listing copy, screenshots list, support URLs.

- Assert privacy policy mentions: canvas tokens, session JWTs, `permittedProjects`, the `com.jiratack.metadata` issue property, guest name/email capture, and that screenshots transit the Forge app.

### 7.13 Full flow

- Install fresh → connect → drop pin → create ticket → see in list → inline edit → move to Done → see animation → reload → pin hidden (Done) or shown (retirement window).

- Assert: no console errors at any step.

- Assert: `forge logs -e development` shows no `[JiraTack] ERROR`.

### 7.14 Inline edit — summary and description (D15)

- Expand card → edit summary → blur/Enter → assert card + Jira summary update with the `[JiraTack]` prefix intact.

- Summary shorter than 3 chars → assert inline error and revert.

- Edit description → Save enables only when text differs → Save → assert Jira description keeps the `[JiraTack…]` header, console block, and `Page:` footer; only the body changed.

- Missing `[JiraTack…]` header → assert the description field shows "Edit it in Jira instead." and Save stays disabled.

### 7.15 Silent post-create hydration (D15)

- Create a ticket → assert the new card appears immediately with an empty status chip and no skeleton/loading flash or scroll jump.

- Within ~2s → assert status/priority/assignee/reporter/type fill in on the same card (merged by key).

- Switch canvas within 1s of creation → assert no late merge touches the new canvas.

- Edit the new card before hydration lands → assert the edit is not overwritten by the hydration response.

### 7.16 Guest inline editing (D15)

- Open a guest link → expand a card on a permitted canvas → assert status, priority, assignee, summary, description all editable.

- Guest assignee search → assert only licensed users appear.

- Guest on a canvas outside the grant (crafted request) → assert `INSUFFICIENT_SCOPE`; guest assigning an unlicensed user → assert `VALIDATION_ERROR`.

### 7.17 Layout toggle — Actual size vs Fit page (D17)

- Default mode is Actual size; the "Fit to sidebar" switch in its own row above the ticket filter switches to Fit page and persists across reopen.
- Fit on a rigid-header page (Montefiore): assert the "Call us today" button is visible beside the sidebar; assert page scrolls normally; assert no horizontal scrollbar.
- Pin in Fit mode (selector + absolute), toggle to Actual size: assert pins stay on their targets; screenshot crop stays centered on the pin.
- Narrow the window until zoom would drop below 0.5: assert automatic fallback to Actual size with a toast.
- Close in each mode: assert exact original layout (no residual margin, zoom, translate, or style tag; `__jiratackLayoutDebug()` confirms).

### 7.18 Cross-page card navigation (reopen loop)

- Canvas has tickets on page A and page B. On page A, click a card whose URL is page B.
- Assert: clicking shows a toast explaining the page will open and the sidebar must be reopened, the navigation is held ~1.2s so the toast is readable, then the browser navigates to page B in the same tab; the card also carries the inline "reopen JiraTack there" hint while on page A.
- Click the bookmark on page B → assert the same canvas loads, the ticket is selected and scrolled into view, and the ticket-list filter matches what was active on page A (no re-auth prompt).
- Assert no stale `jiratack_nav_state` remains after the restore (subsequent manual reload keeps the default 'All Tickets' filter).

### 7.19 Issue-property metadata (D18)

- Create a licensed ticket → assert the issue description has the bold `[JiraTack]` header, user body, and a `Page:` link, with **no JSON**; assert label `jiratack`; assert `com.jiratack.metadata` exists with `{ pin: { canvas, url, position, selector }, version: 1 }`.
- Create a guest ticket → assert `[JiraTack Guest: Name]` header and both `jiratack` + `jiratack-guest` labels; metadata contains `guest`.
- Assert `getPins`, `listCanvasesForUser`, dashboard, and the issue panel all read from the property; old dev tickets without it are absent (expected).
- Issue panel → assert guest identity, pin position/selector, and the screenshot render inline.
- Confirm no custom fields, provisioning button, field audit, or recovery UI remain.

- Confirm the dashboard shows a guest-link action for a seat holder and that it is absent for a user without a seat.

### Sprint 7 exit criteria

All of 7.1–7.13 pass. Commit: `feat(s7): inline edit, done animation, retirement, license, marketplace`.

---

## Part 8 — Final integration tests

Run after all sprints complete.

### 8.1 Multi-instance

- Connect two Jira instances.

- Dashboard shows canvases from both (separated by instance).

- Bookmarklets from each instance work independently.

### 8.2 Performance

- Canvas with 50+ tickets: overlay loads in < 2s.

- Canvas with 10+ pins on one page: all pins render correctly.

### 8.3 Browser compatibility

- Chrome (primary): full functionality.

- Firefox: full functionality (bookmarklet is vanilla JS).

- Edge: full functionality.

### 8.4 Metadata under load

- Seed 100 tickets in one canvas, each with `com.jiratack.metadata`.

- Open the overlay and the dashboard.

- Assert: the overlay returns within a few seconds, the dashboard aggregates correctly, and `truncated` is `false` (well under the 2,000 scan cap).

- Seed past the cap and assert `truncated` is `true` and the UI says the list may be partial rather than implying completeness.

### 8.5 No `[JiraTack]` errors

bash

forge logs -e development | grep "\[JiraTack\] ERROR"

# Assert: empty output

### Final exit criteria

All sprint tests + 8.1–8.5 pass. Product is feature-complete for v1. Commit: `chore: v1 feature-complete`.

---

## Part 9 — Test command reference

### Useful one-liners

bash

# Get webtrigger URL

forge webtrigger create -e development

# Tail logs

forge logs -e development

# Rebuild + deploy

npm run build && forge deploy -e development

# Decode JWT

echo "$JWT" | cut -d. -f2 | base64 -d 2>/dev/null | jq .

# Test webtrigger action

curl -s -X POST "$WT/api" -H "Authorization: Bearer $JWT" -d '{"action":"getPriorities"}' | jq .

# Run shared module tests

node --test src/shared/urlNormalize.test.js src/shared/adfSerializer.test.js src/shared/adfText.test.js src/shared/safeUrl.test.js

# Check for window polyfill in Forge bundle (should be empty)

grep -rn "window\." src/webtrigger/ src/resolvers/ || echo "clean"

### Debug resolver action template

Add temporarily to `src/resolvers/index.js` for testing, remove before sprint exit:

javascript

if (payload.action === 'debugInvoke') {
  const { fn, args } = payload.payload;
  const fns = {
    generateCanvasToken, generateUserToken, generateGuestToken,
    dashboardAggregate, epicPanelData, issuePanelData,
    createCanvas, deleteCanvas, archiveCanvas,
    listCanvasTokens, revokeCanvasToken
  };
  return fns[fn](context, args);
}

Invoke via:

bash

curl -s -X POST "$WT/api" -H "Authorization: Bearer $JWT" \
  -d '{"action":"debugInvoke","payload":{"fn":"dashboardAggregate","args":{}}}' | jq .
