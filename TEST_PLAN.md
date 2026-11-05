# TEST_PLAN.md

**Audience:** OpenCode, human tester. Per-sprint verification commands and assertions.
**Precedence:** If a test conflicts with CONTRACTS.md, CONTRACTS.md wins. This document tells you *how* to verify; CONTRACTS.md tells you *what* the correct behavior is.
**Rule:** A sprint is not complete until every assertion in its section passes. Do not proceed to the next sprint on partial passes.
**Verified against:** tag `baseline/pre-pivot-2026-10-30` (2026-10-30), app 5.0.0, SDK `b975e80725d7`. Parts 1 and 6 were pruned of the retired custom-field/provisioning/audit/recovery tests (D18); Parts 2, 3, 5, 7 and 8 carry the current assertions. §3.13 covers the D23 match modes; §3.14 covers the D33 pin move.

---

## Archived parts

Parts 1, 4 and 6 are archived at [docs/archive/TEST_PLAN-historical.md](docs/archive/TEST_PLAN-historical.md): they covered sprints whose code has been replaced.
The parts below are current.

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

## Part 2 — Sprint 2 tests: Token Issuance and Webtrigger API

**Prerequisite:** Sprint 1 complete, `$WT` exported, at least one test project with JiraTack enabled.

### 2.1 URL normalization test vectors

```bash
node --test src/shared/urlNormalize.test.js
```

Assert: every vector passes and the exit code is 0. The vectors cover structural normalisation, tracking/cache/version removal, random-value removal, the keep-list override (`sku`, `id`), deep-link stripping, canonical storage, path-only identity, and all three match modes (D23).

Also assert `normalizeUrl` is idempotent: feeding a stored `pin.url` back in must not change it.

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
# Assert: .value.pin.url keeps the page's query string (canonical storage, D23)
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

### 2.16b `updatePinPosition` (D33)

bash

curl ... updatePinPosition {"issueKey":"<KEY>","pinPosition":"61.0,42.0","selector":"#hero","movedPixels":120}

# Assert: .ok == true; .data.pin.selector == "#hero"; .data.screenshotAttached == false; .data.commented == false

# Assert: com.jiratack.metadata pin.position and pin.selector changed; bindingId, guest and version unchanged

# Assert: the property round-trips through readMetadataBySearch (screenshotVersion survives normalisation)

# With screenshotUploadId (upload first via beginScreenshotUpload/uploadScreenshotChunk):

# Assert: .data.screenshotVersion increments by 1; a new jiratack-<KEY>-<epoch-ms>.png exists

# Assert: the original jiratack-<KEY>.<ext> attachment is still present (nothing is deleted)

# Assert: a comment exists, text exactly "Pin moved and screenshot updated by <name> on <2 Nov 2026, 17:42 GMT>"

# Assert: the name and zone match GET /rest/api/3/user?accountId=<sub> for the JWT subject

# Assert: movedPixels <= 4 with a screenshot → pin moves, no comment

# Assert: profile with no timeZone (or an invalid one) → the comment says UTC

# Assert: guest JWT → the comment names the invited guest and says UTC

# Assert: malformed pinPosition → 422 VALIDATION_ERROR

# Assert: non-jiratack issueKey / project outside permittedProjects / canvas outside permittedCanvases → 403 INSUFFICIENT_SCOPE

# Assert: view JWT → 403 INSUFFICIENT_SCOPE

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

### 3.13 URL match modes (D23)

Requires a canvas with pins across query variants: e.g. `?page=1`, `?page=2`, and one pin on the bare path.

1. Open `?page=2`, activate, select **Current Page**.

2. Assert: the `Match` row is present and shows `Smart`, `Exact`, `Whole page` with counts.

3. Assert: `Smart` is selected by default and the list/pins agree with it.

4. Click `Whole page` → assert the sibling pins appear on both the list and the page, and the counts did not change when switching.

5. Click `Exact` → assert only pins captured on the current exact URL remain.

6. Open a page with **no** query string → assert the `Match` row is absent entirely.

7. Open `?page=2` on a canvas whose only pins are on `?page=1`, select `Exact` → assert the empty state offers "Show all N on this page", and clicking it switches to `Whole page` and reveals them.

8. Assert switching modes never triggers a network request (everything is client-side).

9. Assert the mode resets to `Smart` after closing and reopening the bookmarklet.

### 3.14 Pin move (D33)

1. Long-press a pin for ~400 ms → assert a yellow ghost appears and the pin dims.

2. Drag onto a different element and release → assert the pin renders at the drop point and a `Move <KEY> here?` bar appears beside it (above or below), with **Confirm** and **Cancel**. Assert no `beginScreenshotUpload` or `updatePinPosition` has been sent.

3. Click **Confirm** → assert the screenshot uploads, the pin stays put, the issue gains `jiratack-<KEY>-<epoch-ms>.png`, the original screenshot remains, a comment names the reviewer and time, and the bar disappears.

4. Drag again and click **Cancel** → assert the pin returns to its previous position, the bar disappears, and nothing is sent (no upload, no comment, no property change).

5. Repeat with `Esc` while the bar is open → same result as Cancel.

6. Repeat, then close the overlay (`__jiratackClose`) → reopen and assert the pin is at its old position and no new comment or attachment exists.

7. While the bar is open, long-press any pin → assert no ghost appears and no drag starts.

8. Move a pin less than 4 px and confirm → assert the pin moves but no new comment is posted.

9. Press and release without moving over the pin → assert nothing is sent and the pin is not detached.

10. Click without holding → assert the pin selects and no move is offered.

11. Stop a drag over the sidebar or the viewport bar → assert no bar appears.

12. Press a pin and move it more than ~6 px **without holding first** (a fast grab) → assert the drag arms immediately: ghost visible, pin dimmed; releasing opens the `Move <KEY> here?` bar (nothing sent until Confirm). This is the D33 amendment — a press that slides while grabbing is a drag, not a dead click.

13. While dragging, assert the dragged pin is still fully visible (`opacity: 1`) and has changed colour to the move yellow — it must not fade out (a faded 18px dot read as "the pin disappeared").

14. Drag into the right-hand 320 px (the sidebar zone) → assert the ghost stays exactly under the cursor and is parented to `#jiratack-overlay`, with no `translate` applied (the fixed-shift pass must never move a JiraTack element).

12. Drop near the bottom/right of the page → assert the bar flips above the pin or is clamped, and never sits under the sidebar.

13. Open the issue panel → assert the newest screenshot (highest filename timestamp) renders.

14. Switch canvas while a bar is open → assert the move is discarded and no request is sent.

### Sprint 3 exit criteria

All of 3.1–3.14 pass. Commit: `feat(s3): bookmarklet SDK scaffold`.

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

### 5.3b Project field catalogue and canvas pre-fills (D41)

**Admin page → Available text fields**

- Open the JiraTack admin page → assert **Available text fields** lists text/URL fields only (no Summary, Description, Labels, Assignee, Priority).
- Tick two fields → reload → assert the selection is restored ("Saved." appears after a change).
- Assert the **project settings** page no longer lists a field catalogue (it is installation-wide, D42).

**Create canvas**

- Open **Create New Canvas** → assert the **Project** selector shows configured projects and preselects the first.
- Assert **Additional fields (optional)** is an accordion and is **closed** by default, so the modal fits without scrolling.
- Open it → assert the field dropdown contains only the two configured fields, not every Jira field.
- Set `Figma Link = https://figma.com/file/x` → create the canvas → create a pin whose type has Figma Link on its Create screen → assert the ticket's Figma Link holds the URL and the description does **not** repeat it.
- Create a pin of an issue type where the field is **not** on the Create screen → assert the ticket is created, the field is empty, the description ends with `Figma Link: https://figma.com/file/x` (link mark), and the create response's `warnings` contains `prefill-field-fallback`.
- Create a canvas with the accordion untouched → assert pins create normally and descriptions have no extra lines.

**Edit existing canvas**

- On an active canvas row, click **Fields** → assert the modal loads the stored project and values.
- Change the value, save, create a new pin → assert the new value is applied and the old value is not.
- Remove the row, save, create a pin → assert no pre-fill is written and nothing appears in the description.
- Archive a canvas, unarchive it → assert its pre-fills still apply (archive keeps the record).
- Delete a canvas → recreate one with the same name and no fields → assert no stale value is written.

**Validation**

- Save a row with a field but no value, and a row with a value but no field → both are rejected with a named message in the modal.
- Call `setCanvasConfig` with `prefillFields: [{ fieldId: "summary", value: "x" }]` → `BAD_REQUEST` (managed field).

### 5.3c Canvas keys and the new dashboard (D42)

- Create a canvas → assert the row/card shows both the name and a key equal to the seed ticket key (`KAN-…`).
- Create a pin on that canvas → open the ticket → assert `com.jiratack.metadata.pin.canvasId` equals the canvas key.
- Rename the canvas from the canvas page → assert the key is unchanged, the new name shows in the dashboard, and the seed ticket is untouched.
- Pin a page whose canvas was never created explicitly (new name on a ticket) → assert a canvas appears with a generated `c-xxxxxxxx` key and can be renamed.
- Try renaming to a name already used by another canvas → `VALIDATION_ERROR` with a readable message.
- Assert the anchor nav jumps to `#install` and `#canvases`, and that **New canvas** is an inline panel (no modal) containing name, URL and the field rows.
- Assert the cards/list toggle persists across a reload.
- Assert an archived canvas is only listed under **View archived**, and delete is refused while a ticket is not Done.

### 5.4 Multi-project canvas badge

- Canvas spanning Project A + B → assert row shows `"2 projects"` badge.

- Hover badge → tooltip lists `MM, DS`.

- In `per_user_projects` mode → tooltip also notes "Viewers only see pins from projects they can browse."

- Single-project canvas → shows project key (e.g. `MM`).

### 5.4b Install cards, guest extension and folders (D43)

- Assert the Bookmarklet card has **Get bookmark** and **Create a guest bookmark**; the extension card has Chrome, Firefox and **Create a guest extension link**, and no "Invite a guest reviewer" button.
- With no publication URL configured, the Chrome/Firefox buttons say the extension is not published and point at the bookmarklet (no dead link).
- **Get bookmark** opens the scope drawer with **Selected canvases** default; generate with 2 canvases → open the bookmarklet → the launcher lists only those 2, each with name and key.
- Generate with **All canvases** → create a new canvas → reopen the bookmarklet → the new canvas appears without regenerating.
- A frozen selection does **not** show a canvas created later (regenerate to include it).
- Create 7+ canvases → the launcher shows a filter box; typing a key or name filters the list.
- Guest invite in **extension** mode → the installer page puts the extension card first, links only the configured stores, and shows 🟢 Connected once the bookmarklet starts JiraTack on that page.
- Guest link expiry copy says 90 days; an invite older than 90 days is refused.
- Create a folder by moving a canvas from its page → the rail shows it with a count; filter by it; move it back to Unfiled.
- Rename a canvas → the folder rail and counts follow (key unchanged).

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

### 7.6 Status rule — default (D38, amended)

- Project config untouched (`filteredStatusIds` unset).

- Create a Done ticket with a pin.

- Reload bookmarklet.

- Assert: the sidebar shows **View All** / **Filter By Status ▾** with Filter By Status active, and the Done pin is absent from the pin layer and the list.

- Click **View All** → assert the Done pin appears at `#2ECC71` opacity 0.5 with "Filter By Status (1 hidden)" in the row, and lists in the sidebar.

- Click **Filter By Status** → assert it is hidden again.

- Click the **▾** caret → assert a panel opens with **All** / **None** / **Reset** and a row per status on the canvas with counts (`Done 1`, `To Do 2`), Done unticked because it is hidden.

- Tick **Done** → assert the Done pin appears immediately in both the pin layer and the list, and `localStorage['jiratack:statusFilter:<canvas name>']` now holds an array without `Done`.

- Reload the bookmarklet → assert the tick survived (the Done pin is still shown) and the panel still reflects it.

- Open the panel and click **Reset** → assert the key is removed and the Done pin is hidden again (back to the project default).

- Click **None** → assert every statused pin is hidden and the panel's checkboxes are all empty; click **All** → assert everything is shown.

- Switch to another canvas and back → assert each canvas keeps its own choice.

- In Jira, mark the ticket with a status literally named **Removed** → after a poll/reload the pin never appears, even under **View All**.

### 7.6b Sidebar selection centres the pin (D38 follow-up)

- With a tall page, scroll so a pinned element is far off-screen (or far above/below the middle).

- Click its ticket card in the sidebar → assert the page scrolls smoothly so the pin sits near the vertical middle of the viewport, and the card is scrolled into view in the list.

- Press ↑/↓ in the sidebar → assert the page follows the selection the same way.

- Hover a card without clicking → assert the page does **not** scroll (only the pin highlights).

- Click a pin on the page itself → assert the page does not scroll.

- Repeat for a detached pin (lost selector) → assert only the card scrolls and no page movement is attempted.

### 7.7 Status rule — default project list (admin "Default filter setting")

- Project settings → disable "Use default (hide Done statuses)", pick an explicit set of statuses → Save.

- Assert: pins whose status matches the picked list are filtered by **default** (a canvas with no stored override); Done-category pins whose ID is not in the list are shown.

- Assert: the canvas checklist starts with exactly those statuses unticked, the panel hint reads "Using the project default", and **Reset** returns to that state after any override.

- Set the list to empty (`[]`) → assert nothing is filtered by default.

- Reload the settings page → assert the saved selection is redisplayed (defaults merge, D38).

### 7.8 Status rule — multi-project canvas (supersedes D14 mechanism)

- Canvas spans Project A + B with different rules.

- Assert: each pin is filtered by its own project's rule (pin A with A's rule, pin B with B's rule) — `filtered` is stamped per issue, not per canvas.

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

- Install fresh → connect → drop pin → create ticket → see in list → inline edit → move to Done → see animation → reload → pin hidden by the status rule (§7.6).

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

All of 7.1–7.13 pass. Commit: `feat(s7): inline edit, done animation, status rule, license`.

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
