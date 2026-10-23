# BUILD_PLAN.md

**Audience:** OpenCode. Second document to read, after CONTRACTS.md.
**Precedence:** Where this document disagrees with CONTRACTS.md, CONTRACTS.md wins. Where it disagrees with DECISIONS.md, DECISIONS.md wins.

---

## 1. How to use this document

For each sprint:

1. Read this document's section for that sprint.
2. Read the CONTRACTS.md sections it references.
3. Read TEST_PLAN.md's section for that sprint.
4. Implement to CONTRACTS.md exactly.
5. Run TEST_PLAN.md commands. Report pass/fail per assertion.
6. If any assertion fails, do not proceed to the next sprint.
   **Do not add features, refactor, or improve beyond what's listed.**

---

## 2. Sprint sequence and dependencies

S1 (scaffolding + field provisioning + admin config)  
│  
├──→ S2 (token issuance + webtrigger API + pin marker)  
│ │  
│ ├──→ S3 (bookmarklet scaffold)  
│ │ │  
│ │ └──→ S4 (capture flow)  
│ │ │  
│ │ └──→ S7 (inline edit + Done + retirement + license)  
│ │  
│ └──→ S5 (canvas dashboard)  
│ │  
│ └──→ S6 (epic panel + issue panel + field audit + recovery)  
│ │  
│ └──→ S7  
│  
└──────────────────────────→ S7

text

**Critical path:** S1 → S2 → S3 → S4 → S7.
**Parallelizable:** S5 once S2 completes. S6 requires S5.
**Sprint 7 requires all prior sprints complete.**

---

## 3. Sprint 0 — Prerequisites

| Item                 | Check                                                                                |
| -------------------- | ------------------------------------------------------------------------------------ |
| Node.js 22.x         | `node --version` shows v22.x                                                         |
| Forge CLI            | `forge --version` works                                                              |
| Forge logged in      | `forge login` completed                                                              |
| Dev Jira site ready  | `https://<site>.atlassian.net` accessible, you are admin                             |
| Forge app registered | `forge register` completed, `app.id` known                                           |
| OpenCode conventions | `AGENTS.md` or `.opencode/` created, points at SPEC/ARCHITECTURE/CONTRACTS/DECISIONS |

---

## 4. Sprint 1 — Scaffolding, Field Provisioning, Admin Config

**One-shot viability:** No. Expect one round of Forge platform discovery.
**Goal:** Deployable Forge app. All six surfaces render. `provisionFields` creates four custom fields. `installationConfig` round-trips. Admin page exposes `viewPermissionMode` toggle.

### 4.1 Files to create

**Project root:** `manifest.yml`, `package.json`, `vite.dashboard.config.js`, `vite.bookmarklet.config.js`, `scripts/embed-sdk.js`
**Backend:** `src/resolvers/index.js`, `src/resolvers/actions/{admin,config,dashboard,epic,issue}.js`, `src/lib/{fields,kvs,config,errors}.js`, `src/webtrigger/{api,sdk}.js`
**UI Kit panels:** `src/ui-kit/admin/index.jsx`, `src/ui-kit/project-config/index.jsx`, `src/ui-kit/epic-panel/index.jsx`, `src/ui-kit/issue-panel/index.jsx`
**Custom UI dashboard:** `src/custom-ui/dashboard/{index.html,main.jsx,App.jsx,index.css}`
**Admin page additions (this sprint):**

- Field provisioning button + status
- Field ID mapping (auto-populated + manual override selects)
- `viewPermissionMode` toggle (radio: `per_user_projects` / `open`, default `per_user_projects`). Describes both modes in one sentence each (per DECISIONS.md D9).
- License status placeholder
  
  ### 4.2 `manifest.yml`
  
  Copy from CONTRACTS.md §10.1 **exactly**. Runtime `nodejs22.x` (D12 — Sprint 1 verifies deploy; switch to 24.x only if 22 fails).
  
  ### 4.3 `provisionFields` — behavior
  
  Per CONTRACTS §1.3. Implementation:
1. `asUser().requestJira('/rest/api/3/field')` → list existing fields.
2. For each of the four: reuse matching name+type, else create.
3. Best-effort: add to default screen's create+edit tabs.
4. Write `installationConfig.fieldRegistry`.
5. Return `{ ok: true, fieldIds, warnings }`.
   
   ### 4.4 `installationConfig` — schema including `viewPermissionMode`
   
   Per CONTRACTS §1.2. Admin page writes `viewPermissionMode` on toggle change; `configVersion` recomputed.
   
   ### 4.5 Acceptance criteria
- `forge deploy -e development` exits 0
- `forge install -e development` exits 0
- All six surfaces appear in Jira
- Admin page loads without console errors
- "Provision fields" creates four named fields with expected types
- `installationConfig` KVS shows `fieldRegistry` with all four field IDs
- Admin page has `viewPermissionMode` toggle; default `per_user_projects`
- Toggling `viewPermissionMode` persists to KVS; `configVersion` changes
- Manual override of field IDs works
- Project settings page saves/loads project config
- Dashboard stub renders
- Epic and issue panel stubs render
- No `[JiraTack]` errors in `forge logs`
  
  ### 4.6 Known tricky bits
1. **Screen manipulation.** Report failure as warning, don't fail provisioning. Include fix URL.
2. **Field type collisions.** Reuse text field if URL type unavailable. Note in warnings.
3. **`provisionFields` permissions.** Admin only via `asUser()`.
4. **KVS cold start.** `getInstallationConfig()` returns default `{ schemaVersion: 1, fieldRegistry: {}, projects: {}, viewPermissionMode: 'per_user_projects' }` on first read.
5. **Webtrigger URL discovery (D10).** Test `@forge/api` exposure. If not exposed, admin records `webtriggerUrls` in KVS during provisioning.
6. **Runtime version (D12).** If 22 fails, try 24. Record in DECISIONS.md.
   
   ### 4.7 What NOT to do in Sprint 1
- Do not implement `generateCanvasToken` (S2)
- Do not implement webtrigger actions (S2)
- Do not implement dashboard aggregation (S5)
- Do not implement epic/issue panel data (S6)
- Do not implement field audit or recovery (S6)
- Do not implement license gating (S7)
- Do not touch bookmarklet (S3)

---

## 5. Sprint 2 — Token Issuance and Webtrigger API

**One-shot viability:** Yes, largely. Testable via curl.
**Goal:** Every webtrigger action returns documented shape. Token issuance handles both scopes and computes `permittedProjects`. Pin marker appended on create. URL normalization and ADF serialization modules complete.

### 5.1 Files to create

**Backend:** `src/lib/{tokens,jql,adf}.js`, `src/webtrigger/actions/{exchangeToken,getPins,createIssue,transitions,updateIssue,searchUsers}.js`, `src/webtrigger/middleware/{auth,scope}.js`
**Shared:** `src/shared/{urlNormalize,adfSerializer}.js`, `src/shared/{urlNormalize,adfSerializer}.test.js`
**Modified:** `src/webtrigger/api.js` (stub → full dispatch), `src/resolvers/actions/admin.js` (`generateCanvasToken` stub → real, computing `permittedProjects`), `src/lib/config.js` (implement `computeConfigVersion` including `viewPermissionMode`)

### 5.2 `generateCanvasToken` — permission computation

Per CONTRACTS §4.1:

1. Scope check (create: `hasAccess`; view: none).
2. Compute `permittedProjects`:
   - `viewPermissionMode === "open"` → `"*"`
   - Else → `asUser().requestJira('/rest/api/3/project/search?action=browse&maxResults=100')`. If `values.length >= 100` → `"*"`. Else → `values.map(p => p.key)`.
3. View scope: query canvas's tickets' project keys, check intersection with `permittedProjects`. If canvas non-empty AND no intersection → `NO_CANVAS_ACCESS`.
4. Mint JWT with `permittedProjects`.
   
   ### 5.3 Test vectors required
- URL normalization: all 10 vectors in CONTRACTS §6.2 pass. `node src/shared/urlNormalize.test.js`.
- ADF serialization: all 8 node types pass. `node src/shared/adfSerializer.test.js`.
- JWT: sign/verify round-trip; tampered payload fails; expired `exp` fails; wrong `aud` fails; `permittedProjects` claim preserved.
- Pin marker: generated JSON parses; missing `selector` omits key; format matches CONTRACTS §8.4.
  
  ### 5.4 Acceptance criteria
- `exchangeToken` returns JWT with `scope` and `permittedProjects` claims
- `exchangeToken` returns `TOKEN_EXPIRED` for expired token; `TOKEN_INVALID` for revoked
- `getPinsForCanvasAndUrl` returns pins filtered by `permittedProjects`:
  - With token permitting only Project A: pins from A shown, pins from B hidden
  - With `permittedProjects: "*"`: all pins shown
- `createIssue` with `view` JWT → 403 `INSUFFICIENT_SCOPE`
- `createIssue` with `create` JWT and project NOT in `permittedProjects` → 403
- `createIssue` with valid token creates ticket with four custom fields, `[JiraTack]` prefix, `jiratack` label, correct reporter, AND pin marker paragraph in description
- Pin marker paragraph parses correctly (verify by round-tripping through `recoverPinsFromDescriptions` logic)
- `getTransitions`, `updateIssue`, `searchUsers` per CONTRACTS §3.4–3.6, scope-enforced
- URL normalization test vectors all pass
- ADF serialization test vectors all pass
- JWT tampering/expiry/aud tests all rejected
- `viewPermissionMode: "open"` produces `permittedProjects: "*"` for all users
- `generateCanvasToken` for a view-scope token on a canvas with no accessible projects returns `NO_CANVAS_ACCESS`
  
  ### 5.5 Known tricky bits
1. **`searchUsers` response shape.** Handle both array and `{ values: [] }`.
2. **`createmeta` response shape.** Defensive `?? []`.
3. **`statusCategoryChangedDate`.** Verify field name on dev site.
4. **JWT signing secret bootstrap.** In-memory promise cache.
5. **`asApp()` vs `asUser()`.** `asUser()` works in resolvers (project/search, JQL). Webtrigger actions use `asApp()` — but this means webtrigger cannot check permissions. That's why `permittedProjects` is in the JWT.
6. **`project/search?action=browse`** — verify this endpoint works as expected on dev site. It returns projects the calling user has BROWSE on. Alternative: `/rest/api/3/project` (all projects; filter by permissions separately, more complex). Stick with `project/search`.
7. **Screenshot MIME.** Parse `data:image/webp;base64,` or `data:image/png;base64,`.
8. **Pin marker ordering.** Append after console log, not before. Marker is last paragraph in description.
9. **`project` field on search query** — needed to filter by `permittedProjects`, but not returned to client. Ensure fields param includes `project` but PinRecord doesn't expose it.

---

## 6. Sprint 3 — Bookmarklet SDK Scaffold

**One-shot viability:** Partial. Auth, overlay, sidebar, close, SPA navigation are one-shot. Pin positioning is visual.
**Goal:** Bookmarklet loads, authenticates, fetches pins, renders overlay+sidebar, closes cleanly. No pin mode, no capture, no form.

### 6.1 Files to create

**SDK:** `src/bookmarklet/{index,auth,overlay,pins,selector,sidebar,scope,navigation,toast,api,urlNormalize}.js`, `src/bookmarklet/styles.css`
**Modified:** `vite.bookmarklet.config.js` (entry, single-file output), `scripts/embed-sdk.js` (read bundle, write `src/lib/sdk-bundle.js`), `src/webtrigger/sdk.js` (stub → real), `package.json` (build script)
**Pin colors (in styles.css):**

```css
:root {
  --jiratack-pin-default:  #FF6B6B;
  --jiratack-pin-selected: #E63946;
  --jiratack-pin-done:     #2ECC71;
  --jiratack-pin-move:     #F4C542;
}

### 6.2 Scope-aware UI

- `create`: pin-mode toggle visible; cards expand to inline-edit; new-ticket affordance.

- `view`: `View only` badge; no pin-mode toggle; card click opens Jira in new tab.

Client reads `scope` and `permittedProjects` from JWT response at exchange time. Displays a small `"Viewing N projects"` badge in the sidebar header if `permittedProjects` is an array (informational only — the server already filtered pins).

### 6.3 Acceptance criteria

- Bookmarklet loads on test page without console errors

- Overlay DOM matches CONTRACTS §5.2

- Pins render for seeded tickets at correct positions

- Selector miss → absolute fallback; both missing → "detached" cluster in top-right

- Sidebar lists tickets with status, priority, assignee, reporter

- Pin/card click selects both

- **View scope:** no pin-mode toggle, `View only` badge, card click opens Jira

- **Create scope:** pin-mode toggle visible, card expands to inline-edit stub

- Bookmarklet toggle closes overlay

- After close: all `.jiratack-*` elements gone, `__jiratackActiveCanvas === null`

- SPA navigation triggers re-query after 300ms debounce

### 6.4 Known tricky bits

1. **CSS isolation.** `jiratack-` prefix. High z-index. No global resets.

2. **Fixed overlay with absolute pins.** Compute page-relative coordinates.

3. **SPA detection.** Wrap `history.pushState`/`replaceState`, listen to `popstate`. Debounce 300ms.

4. **SDK bundle embedding.** `scripts/embed-sdk.js` generates `src/lib/sdk-bundle.js`. **Commit it** so `forge deploy` from fresh checkout works.

5. **`document.querySelector` failures.** Try/catch; malformed selector = not-found.

6. **No console proxy in S3.** That's S4.

---

## 7. Sprint 4 — Capture Flow

**One-shot viability:** Partial. Form, console wrapper, validation are one-shot. Screenshot has runtime variance.

**Goal:** Full pin capture → ticket creation working end-to-end.

### 7.1 Files to create

**SDK:** `src/bookmarklet/{pinMode,screenshot,consoleProxy,form,description,validate}.js`

**Modified:** `src/bookmarklet/index.js` (install console proxy before any await), `src/bookmarklet/sidebar.js` (show form during capture), `src/bookmarklet/overlay.js` (form container), `package.json` (add Tiptap), `vite.bookmarklet.config.js` (bundle Tiptap)

**Dependency pin:** Tiptap `^2.11.5`.

### 7.2 Acceptance criteria

- Pin mode toggle activates crosshair

- Hover element → `#1869DB` dashed outline + tooltip

- Click: pin renders, form opens

- Form fields per CONTRACTS §14.1

- Summary prefix non-editable, 215-char limit

- Description supports bold/italic/bullet/ordered/hard-break

- Console checkbox per project config

- Screenshot thumbnail with remove

- Cancel: return to ticket list, no server call

- Submit: `createIssue`; on success, pin renders optimistically

- Screenshot attached when `html2canvas` succeeds

- Console log appended when checkbox checked

- **Pin marker present in created ticket's description** (verify via Jira UI or API)

- Description ADF matches CONTRACTS §8.1

- Parent validation, required-field validation

### 7.3 Known tricky bits

1. **`html2canvas` CORS.** Silent fallback.

2. **`html2canvas` on transformed pages.** Hide overlay during capture.

3. **Tiptap bundling.** ~80KB. Single-file output.

4. **Console proxy before any await.** First line of `__jiratrackInit`.

5. **Screenshot size.** 400×400 webp @ 0.85 ≈ 20–60KB. Base64 inflates 33%.

6. **Pin marker location.** Verify it appears as the last paragraph, not disrupting user content or console block.

---

## 8. Sprint 5 — Canvas Dashboard

**One-shot viability:** Yes, largely.

**Goal:** Working dashboard with canvas list, search, both bookmarklet generators, token list, revoke.

### 8.1 Files to create

**Dashboard:** `src/custom-ui/dashboard/App.jsx` (replace stub), `src/custom-ui/dashboard/components/{CanvasTable,BookmarkletModal,ConfirmDialog,TokenList}.jsx`, `src/custom-ui/dashboard/{api,styles}.{js,css}`

**Modified:** `src/resolvers/actions/dashboard.js` (implement), `src/resolvers/actions/admin.js` (`listCanvasTokens`, `revokeCanvasToken` stubs → real)

### 8.2 Dashboard → resolver flow

- "Get write bookmarklet" → `invoke('generateCanvasToken', { canvasName, scope: 'create' })` → modal with `javascript:` link

- "Copy review bookmarklet" → `invoke('generateCanvasToken', { canvasName, scope: 'view' })` → confirmation dialog (explains `permittedProjects` filtering) → modal

- "Revoke access" → `invoke('revokeCanvasToken', { token })` → confirm → refetch

- "Open in Jira" → JQL URL

**Canvas row displays project span:**

- If `projectKeys.length === 1`: show project key

- If `projectKeys.length > 1`: show `"N projects"` badge with tooltip listing keys. In `per_user_projects` mode, tooltip additionally notes: *"Viewers only see pins from projects they can browse."*

### 8.3 Bookmarklet `javascript:` string

javascript

javascript:(function(){
  var c={token:"...",apiBase:"...",canvasId:"...",canvasName:"...",sdkVersion:"..."};
  if(window.__jiratackActiveCanvas===c.canvasId){window.__jiratackClose();return;}
  var s=document.createElement('script');
  s.src=c.apiBase.replace('/api','/bookmarklet.js')+'?v='+c.sdkVersion;
  s.onload=function(){window.__jiratackInit(c);};
  document.head.appendChild(s);
})();

`apiBase` and `sdkVersion` injected server-side at token generation.

**D13 — sdkVersion:** build hash from `scripts/embed-sdk.js`, exported from `src/lib/version.js`.

### 8.4 Acceptance criteria

- Dashboard loads, shows all canvases

- Search filters by canvas name

- Ticket counts match JQL

- Open count excludes Done

- URL count = distinct normalized URLs

- Participants = distinct assignees+reporters (cap 5)

- Single-project canvas shows project key; multi-project shows `"N projects"` badge with tooltip

- "Get write bookmarklet" enabled for licensed user, disabled for unlicensed

- "Copy review bookmarklet" enabled regardless of `hasAccess` (requires ≥1 accessible ticket in canvas; `NO_CANVAS_ACCESS` error surfaced in UI)

- Confirmation dialog explains `permittedProjects` filtering before showing modal

- Both bookmarklets work end-to-end

- Revoke: token removed; existing bookmarklet fails at next `exchangeToken`

- Token list shows scope, user, canvas, issued, expires

- "Open in Jira" opens JQL search

### 8.5 Known tricky bits

1. **`@forge/bridge`** (`invoke`) for Custom UI; `@forge/react` for UI Kit.

2. **Avatar rendering.** `<img>` with initials fallback.

3. **Copy-to-clipboard.** `navigator.clipboard.writeText()` in onClick.

4. **Confirmation persistence.** KVS `reviewScopeConfirm:<userId>:<canvasName>` TTL 30d.

5. **`javascript:` drag-and-drop.** "Copy URL" primary; drag secondary.

6. **`NO_CANVAS_ACCESS` UX.** When the resolver returns this, show inline explanation: *"You don't have access to any project in this canvas. Ask the canvas owner to grant access, or ask a licensed team member with access to share their view bookmarklet."*

---

## 9. Sprint 6 — Epic Panel, Issue Panel, Field Mapping Audit, Recovery

**One-shot viability:** Partial. UI Kit panels and audit are straightforward. Recovery action is one-shot. Epic dual-query needs both project type verification.

**Goal:** Epic panel, issue panel, field audit, AND `recoverPinsFromDescriptions` action on admin page.

### 9.1 Files to create

**UI Kit:** `src/ui-kit/epic-panel/index.jsx` (replace stub), `src/ui-kit/issue-panel/index.jsx` (replace stub), `src/ui-kit/admin/FieldAudit.jsx`, `src/ui-kit/admin/RecoveryPanel.jsx`

**Resolvers:** `src/resolvers/actions/epic.js` (replace stub), `src/resolvers/actions/issue.js` (replace stub), `src/resolvers/actions/admin.js` (add `fieldMappingAudit`, `recoverPinsFromDescriptions` — stubs → real)

**Modified:** `manifest.yml` (epic panel `displayConditions`), `src/ui-kit/admin/index.jsx` (render `<FieldAudit />` and `<RecoveryPanel />`)

### 9.2 Epic panel — dual-query

Per CONTRACTS §4.3. Two queries, merge, dedupe.

### 9.3 Issue panel

Per CONTRACTS §4.4.

### 9.4 Epic panel condition

yaml

displayConditions:
  issueType: "Epic"

Verify both project types. Fallback: panel always shows, returns "not an epic" message.

### 9.5 Field mapping audit

Per CONTRACTS §4.5. Cap at 20 projects per run.

### 9.6 Recovery action

Per CONTRACTS §4.6. Admin page `RecoveryPanel.jsx`:

- Button: "Scan for lost pin fields"

- Opens dry-run first: shows count of tickets with empty canvas field + description marker

- Confirm → run actual recovery

- Display result: recovered, skipped, errors

### 9.7 Acceptance criteria

- Epic panel renders on company-managed epics

- Epic panel renders on team-managed epics

- Epic panel does not render on non-epics (or fallback)

- Canvas counts correct

- Issue panel renders on tickets with canvas, "Not a JiraTack ticket" otherwise

- "Copy link to this pin" copies deep-link URL

- "Copy review bookmarklet" works from issue panel

- Related tickets list correct (cap 20)

- Audit lists projects with missing fields, provides fix links

- Projects with all fields mapped show green checkmark

- **Recovery dry-run:** reports accurate count of tickets with recoverable markers

- **Recovery actual:** repopulates fields on tickets with valid markers; increments `recovered`

- **Recovery actual:** skips tickets with malformed or missing markers; increments `skipped`

- **Recovery actual:** tickets recovered are immediately queryable via `getPinsForCanvasAndUrl` (fields now populated)

### 9.8 Known tricky bits

1. **Team-managed epics.** Use `parent` linkage. Verify on dev site.

2. **`createmeta` performance.** Cap 20 projects.

3. **Fix URL requires admin.** Hide if not admin.

4. **Recovery marker parsing.** ADF tree walk: find `paragraph` → first text child → starts with `📌 JiraTack pin:`. Robust to node ordering.

5. **Recovery cap.** 500 per run. `truncated: true` if cap hit.

6. **Recovery idempotency.** Tickets already recovered (canvas field non-empty) are not re-processed.

7. **Recovery test.** Seed a ticket, manually clear its canvas field (via Jira UI or API), run recovery, verify field restored.

---

## 10. Sprint 7 — Inline Editing, Done Animation, Retirement, License, Marketplace

**One-shot viability:** Partial. Inline edit and retirement are one-shot. Done animation is polish. License needs Marketplace state.

**Goal:** Product complete.

### 10.1 Files to create

**SDK:** `src/bookmarklet/{inlineEdit,done}.js`, `src/bookmarklet/doneAnimation.css`

**Backend:** `src/lib/license.js`

**Docs:** `docs/PRIVACY.md`, `docs/MARKETPLACE.md`

**Modified:** `src/bookmarklet/sidebar.js`, `src/lib/jql.js` (retirement window template), `src/webtrigger/actions/getPins.js` (retirement window), `src/resolvers/actions/admin.js` (finalize `hasAccess`), `src/ui-kit/admin/index.jsx` (license status), `manifest.yml` (`access.userAccess: true`), `README.md`

### 10.2 Retirement

- Overlay query always excludes Done when effective `retirementDays === 0`.

- When `> 0`: include Done within window, rendered `#2ECC71` opacity 0.5, read-only.

- Effective source (D14): project of canvas's oldest ticket. Cache in KVS `canvasProjectCache:<canvasName>` → `{ projectKey, cachedAt }` TTL 300s.

- Implement in `src/lib/jql.js` as `getEffectiveRetirementDays(canvasName)`.

### 10.3 Done animation

- Pin: flash `#2ECC71` + checkmark, 400ms

- Card: flash green, 400ms

- 1.5s pause → pin fades 300ms → card greyed with Done badge

- Verify `transition.to.statusCategory.key === 'done'`

### 10.4 License

- Production: full enforcement

- Dev: `license === undefined` → treat as active

- Admin panel: license status, user access count

- Sidebar on `LICENSE_INACTIVE`: persistent red banner

### 10.5 Acceptance criteria

- Inline edit: only valid transitions in status picker

- Optimistic updates with rollback on failure

- Done animation: full sequence

- Retirement window: `0` → no Done pins in overlay

- Retirement window: `> 0` → Done within window visible (green, 0.5 opacity, read-only)

- View scope: no inline edit; card click opens Jira

- License inactive: `exchangeToken` → 403 `LICENSE_INACTIVE`; red banner

- License inactive: `generateCanvasToken(create)` → `LICENSE_INACTIVE`

- License inactive: `generateCanvasToken(view)` still works if browse access

- Marketplace materials complete

### 10.6 Known tricky bits

1. **Retirement multi-project canvases (D14).** First-ticket project. Document limitation.

2. **Done animation timing.** 400ms + 1.5s + 300ms = 2.2s total.

3. **`getTransitions` for view scope.** View users need it for status display.

4. **Marketplace submission.** Sprint 7 delivers materials.

5. **`hasAccess` timing.** Document revocation lag in admin UI.

---

## 11. Definition of Done per sprint

A sprint is done when:

1. All files listed in §X.1 exist with expected exports.

2. `forge deploy -e development` exits 0.

3. All acceptance criteria pass on dev site.

4. All TEST_PLAN.md assertions pass.

5. `forge logs -e development` shows no unexpected errors.

6. `git commit -m "feat(sN): <description>"` committed.

**Do not proceed until all six conditions are met.**

---

## 12. Open decisions

- D10, D12 — blocking Sprint 1

- All others resolved (see DECISIONS.md)
