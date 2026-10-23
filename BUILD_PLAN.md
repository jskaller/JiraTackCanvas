# BUILD_PLAN.md

**Audience:** OpenCode. Second document to read, after CONTRACTS.md.
**Precedence:** Where this document disagrees with CONTRACTS.md, CONTRACTS.md wins. Where it disagrees with DECISIONS.md, DECISIONS.md wins. This document adds sprint structure and acceptance criteria only.

---

## 1. How to use this document

For each sprint:

1. Read this document's section for that sprint.
2. Read the CONTRACTS.md sections it references.
3. Read TEST_PLAN.md's section for that sprint.
4. Implement to CONTRACTS.md exactly.
5. Run TEST_PLAN.md commands. Report pass/fail per assertion.
6. If any assertion fails, do not proceed to the next sprint until fixed.
   **Do not add features, refactor, or improve beyond what's listed.** Each sprint has a bounded scope; drift is the enemy of a one-shot build.

---

## 2. Sprint sequence and dependencies

S1 (scaffolding + field provisioning + admin config)  
│  
├──→ S2 (token issuance + webtrigger API)  
│ │  
│ ├──→ S3 (bookmarklet scaffold)  
│ │ │  
│ │ └──→ S4 (capture flow)  
│ │ │  
│ │ └──→ S7 (inline edit + Done + retirement + license)  
│ │  
│ └──→ S5 (canvas dashboard)  
│ │  
│ └──→ S6 (epic panel + issue panel + field audit)  
│ │  
│ └──→ S7  
│  
└──────────────────────────→ S7

text

**Critical path:** S1 → S2 → S3 → S4 → S7.
**Parallelizable:** S5 once S2 completes. S6 requires S5.
**Sprint 7 requires all prior sprints complete.**

---

## 3. Sprint 0 — Prerequisites (not a build sprint)

| Item                         | Check                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| Node.js 22.x installed       | `node --version` shows v22.x                                                         |
| Forge CLI installed          | `forge --version` works                                                              |
| Forge logged in              | `forge login` completed                                                              |
| Dev Jira site ready          | `https://<site>.atlassian.net` accessible, you are admin                             |
| Forge app registered         | `forge register` completed, `app.id` known                                           |
| OpenCode project conventions | `AGENTS.md` or `.opencode/` created, points at SPEC/ARCHITECTURE/CONTRACTS/DECISIONS |

---

## 4. Sprint 1 — Scaffolding, Field Provisioning, Admin Config

**One-shot viability:** No. Expect one round of Forge platform discovery.
**Goal:** Deployable Forge app. All six surfaces render. `provisionFields` creates four custom fields. `installationConfig` round-trips.

### 4.1 Files to create

**Project root:** `manifest.yml`, `package.json`, `vite.dashboard.config.js`, `vite.bookmarklet.config.js`, `scripts/embed-sdk.js`
**Backend:** `src/resolvers/index.js`, `src/resolvers/actions/{admin,config,dashboard,epic,issue}.js`, `src/lib/{fields,kvs,config,errors}.js`, `src/webtrigger/{api,sdk}.js`
**UI Kit panels:** `src/ui-kit/admin/index.jsx`, `src/ui-kit/project-config/index.jsx`, `src/ui-kit/epic-panel/index.jsx`, `src/ui-kit/issue-panel/index.jsx`
**Custom UI dashboard:** `src/custom-ui/dashboard/{index.html,main.jsx,App.jsx,index.css}`

### 4.2 `manifest.yml` — full corrected shape

Copy from CONTRACTS.md §10.1 **exactly**. The critical points:

- `render: native` on admin, project-settings, epic, issue panel modules
- No `render: native` on `jira:globalPage` (dashboard)
- Runtime: `nodejs22.x` (D12 — Sprint 1 verifies deploy; switch to 24.x only if 22 fails)
- `app.id` filled with the UUID from `forge register`
  
  ### 4.3 `provisionFields` — behavior
  
  Per CONTRACTS §1.3. Implementation:
1. `asUser().requestJira('/rest/api/3/field')` → list existing fields.
2. For each of the four: if matching name+type exists, reuse. Else create via `POST /rest/api/3/field`.
3. Best-effort: add each to default screen's create+edit tabs.
4. Write `installationConfig.fieldRegistry`.
5. Return `{ ok: true, fieldIds, warnings }`.
   
   ### 4.4 Acceptance criteria
- `forge deploy -e development` exits 0
- `forge install -e development` exits 0
- All six surfaces appear in Jira
- Admin page loads without console errors
- "Provision fields" creates four named fields with expected types
- `installationConfig` KVS shows `fieldRegistry` with all four field IDs
- Manual override: selecting a different field ID from dropdown updates `fieldRegistry`
- Project settings page saves/loads project config
- Dashboard stub renders "coming in Sprint 5"
- Epic and issue panel stubs render "coming in Sprint 6"
- No `[JiraTack]` errors in `forge logs`
  
  ### 4.5 Known tricky bits
1. **Screen manipulation.** `/rest/api/3/screens` may require pagination. If screen manipulation fails, report as warning (don't fail provisioning) — admin adds fields to screens manually. Include fix URL in warning.
2. **Field type collisions.** If `Page URL` exists as text (not URL), reuse text and record type mismatch in `warnings`.
3. **`provisionFields` permissions.** Must run as admin via `asUser()`. Non-admins see "Only Jira admins can provision fields."
4. **KVS cold start.** First read of `installationConfig` returns `undefined`. `getInstallationConfig()` must return default `{ schemaVersion: 1, fieldRegistry: {}, projects: {} }`.
5. **Webtrigger URL discovery (D10).** Determine in Sprint 1 whether `@forge/api` exposes webtrigger URLs to a resolver. If yes, note the API. If no, admin page's "Provision fields" action also records `webtriggerUrls` in KVS.
6. **Runtime version (D12).** If `forge deploy` fails on `nodejs22.x` due to any dependency, change `runtime.name` to `nodejs24.x` in manifest and re-deploy. Record the outcome in DECISIONS.md.
   
   ### 4.6 What NOT to do in Sprint 1
- Do not implement `generateCanvasToken` (S2)
- Do not implement webtrigger actions (S2)
- Do not implement dashboard aggregation (S5)
- Do not implement epic/issue panel data (S6)
- Do not implement field audit (S6)
- Do not implement license gating (S7)
- Do not touch bookmarklet (S3)

---

## 5. Sprint 2 — Token Issuance and Webtrigger API

**One-shot viability:** Yes, largely. Testable via curl.
**Goal:** Every webtrigger action returns documented shape. Token issuance handles both scopes. URL normalization and ADF serialization modules complete with passing test vectors.

### 5.1 Files to create

**Backend:** `src/lib/{tokens,jql,adf}.js`, `src/webtrigger/actions/{exchangeToken,getPins,createIssue,transitions,updateIssue,searchUsers}.js`, `src/webtrigger/middleware/{auth,scope}.js`
**Shared:** `src/shared/{urlNormalize,adfSerializer}.js`, `src/shared/{urlNormalize,adfSerializer}.test.js`
**Modified:** `src/webtrigger/api.js` (replace stub), `src/resolvers/actions/admin.js` (`generateCanvasToken` stub → real), `src/lib/config.js` (implement `computeConfigVersion`)

### 5.2 Test vectors required

- URL normalization: all 10 vectors in CONTRACTS §6.2 pass byte-identical on client and server. `node src/shared/urlNormalize.test.js` prints pass/fail.
- ADF serialization: all 8 node types pass. `node src/shared/adfSerializer.test.js`.
- JWT: sign/verify round-trip; tampered payload fails; expired `exp` fails; wrong `aud` fails.
  
  ### 5.3 Scope enforcement — dev mode fallback
  
  `generateCanvasToken(scope: "create")`:
  
  ```javascript
  const hasAccess = context.userAccess?.hasAccess;
  if (hasAccess === false) {
  return { ok: false, error: { code: 'LICENSE_INACTIVE', ... } };
  }
  ```

Dev (no Marketplace license): `userAccess === undefined` → treated as `true`. Production: `false` blocks.

### 5.4 Acceptance criteria

- `exchangeToken` returns JWT with scope for valid canvas token

- `exchangeToken` returns `TOKEN_EXPIRED` for expired token

- `exchangeToken` returns `TOKEN_INVALID` for revoked token

- `getPinsForCanvasAndUrl` returns pins for seeded canvas

- `getPinsForCanvasAndUrl` with `view` JWT succeeds

- `createIssue` with `view` JWT returns 403 `INSUFFICIENT_SCOPE`

- `createIssue` with `create` JWT creates ticket with four custom fields, `[JiraTack]` prefix, `jiratack` label, correct reporter

- `getTransitions` returns transitions

- `updateIssue` with `view` JWT returns 403

- `updateIssue` with `create` JWT succeeds (status/priority/assignee)

- `searchUsers` with `view` JWT returns 403

- `searchUsers` with `create` JWT returns array

- URL normalization: all test vectors pass

- ADF serialization: all test vectors pass

- JWT tampering, expiry, wrong aud: all rejected

### 5.5 Known tricky bits

1. **`searchUsers` response shape.** v3 returns plain array on some plans, `{ values: [] }` on others. Defensive `?? []`.

2. **`createmeta` response shape.** Same defensive pattern.

3. **`statusCategoryChangedDate`.** Verify field name on dev site by querying one Done ticket. Adjust JQL template if named differently.

4. **JWT signing secret bootstrap.** Use in-memory promise cache to avoid race condition on first generation.

5. **`asApp()` only in webtrigger.** `asUser()` unavailable. Reporter set explicitly from JWT `sub`.

6. **Screenshot MIME.** Parse `data:image/webp;base64,` or `data:image/png;base64,` prefix; do not assume webp.

---

## 6. Sprint 3 — Bookmarklet SDK Scaffold

**One-shot viability:** Partial. Auth, overlay, sidebar, close, SPA navigation are one-shot. Pin positioning on real pages is visual and will need iteration.

**Goal:** Bookmarklet loads, authenticates, fetches pins, renders overlay+sidebar, closes cleanly. No pin mode, no capture, no form — those are S4.

### 6.1 Files to create

**SDK:** `src/bookmarklet/{index,auth,overlay,pins,selector,sidebar,scope,navigation,toast,api,urlNormalize}.js`, `src/bookmarklet/styles.css`

**Modified:** `vite.bookmarklet.config.js` (entry, single-file output), `scripts/embed-sdk.js` (read bundle, write `src/lib/sdk-bundle.js`), `src/webtrigger/sdk.js` (replace stub), `package.json` (build script)

**Reference:** `src/bookmarklet/styles.css` — pin color CSS custom properties:

css

:root {
  --jiratack-pin-default:  #FF6B6B;
  --jiratack-pin-selected: #E63946;
  --jiratack-pin-done:     #2ECC71;
  --jiratack-pin-move:     #F4C542;
}

### 6.2 Scope-aware UI

- `create`: pin-mode toggle visible; ticket cards expand to inline-edit; new-ticket affordance visible.

- `view`: `View only` badge; no pin-mode toggle; card click opens Jira in new tab.

### 6.3 Acceptance criteria

- Bookmarklet loads on a test page without console errors

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

1. **CSS isolation.** All classes prefixed `jiratack-`. High z-index. No global resets.

2. **Fixed overlay with absolute pins.** Pin coordinates are page-relative; compute as `viewport coord + scroll offset`.

3. **SPA detection.** Wrap `history.pushState`/`replaceState`, listen to `popstate`. Debounce 300ms.

4. **SDK bundle embedding.** `?raw` import may not work in Forge bundler. Use `scripts/embed-sdk.js` to generate `src/lib/sdk-bundle.js` as string export. **Commit `src/lib/sdk-bundle.js`** so `forge deploy` from a fresh checkout works without running `npm run build`.

5. **`document.querySelector` failures.** Wrap in try/catch; treat malformed selectors as not-found.

6. **No console proxy in S3.** That's S4.

---

## 7. Sprint 4 — Capture Flow

**One-shot viability:** Partial. Form, console wrapper, validation are one-shot. Screenshot has runtime variance.

**Goal:** Full pin capture → ticket creation working end-to-end.

### 7.1 Files to create

**SDK:** `src/bookmarklet/{pinMode,screenshot,consoleProxy,form,description,validate}.js`

**Modified:** `src/bookmarklet/index.js` (call `consoleProxy.install()` at top of init, before any await), `src/bookmarklet/sidebar.js` (show form during capture), `src/bookmarklet/overlay.js` (form container), `package.json` (add Tiptap deps), `vite.bookmarklet.config.js` (bundle Tiptap)

**Dependency version pin:** Tiptap `^2.11.5`, not `^3.x` (verified on prior build — see PRIOR_BUILD_TRIAGE.md §3.2).

### 7.2 Acceptance criteria

- Pin mode toggle activates crosshair

- Hover element → `#1869DB` dashed outline + tooltip

- Click: pin renders, form opens

- Form fields per CONTRACTS §14.1

- Summary prefix non-editable, 215-char limit

- Description supports bold/italic/bullet/ordered/hard-break

- Console checkbox: hidden when `captureConsoleLogs === false`; disabled when buffer empty; default from `consoleLogsDefaultChecked`

- Screenshot thumbnail with remove button

- Cancel: return to ticket list, no server call

- Submit: `createIssue` called; on success, pin renders optimistically

- Screenshot attached when `html2canvas` succeeds; ticket still created when it fails

- Console log appended when checkbox checked

- Description ADF matches CONTRACTS §8.1 for all node types

- Parent format validation

- Required-field validation blocks submit

### 7.3 Known tricky bits

1. **`html2canvas` CORS.** Cross-origin images without CORS headers → tainted canvas. Silent fallback: no screenshot, ticket still created.

2. **`html2canvas` on transformed pages.** Hide overlay during capture (CONTRACTS §13.1). Test on pages with fixed positioning.

3. **Tiptap bundling.** ~80KB to bundle. Ensure `vite.bookmarklet.config.js` bundles into single file.

4. **Console proxy installed before any await.** Critical — first line of `__jiratrackInit`, before auth exchange, so errors during exchange are captured.

5. **Screenshot data URL size.** 400×400 webp @ 0.85 ≈ 20–60KB. Base64 inflates 33%. Handle `createIssue` payload limit gracefully.

---

## 8. Sprint 5 — Canvas Dashboard

**One-shot viability:** Yes, largely.

**Goal:** Working dashboard with canvas list, search, both bookmarklet generators, token list, revoke.

### 8.1 Files to create

**Dashboard:** `src/custom-ui/dashboard/App.jsx` (replace stub), `src/custom-ui/dashboard/components/{CanvasTable,BookmarkletModal,ConfirmDialog,TokenList}.jsx`, `src/custom-ui/dashboard/{api,styles}.{js,css}`

**Modified:** `src/resolvers/actions/dashboard.js` (implement), `src/resolvers/actions/admin.js` (`listCanvasTokens`, `revokeCanvasToken` stubs → real)

### 8.2 Dashboard → resolver flow

- "Get write bookmarklet" → `invoke('generateCanvasToken', { canvasName, scope: 'create' })` → modal with `javascript:` link

- "Copy review bookmarklet" → `invoke('generateCanvasToken', { canvasName, scope: 'view' })` → confirmation dialog → modal

- "Revoke access" → `invoke('revokeCanvasToken', { token })` → confirm → refetch

- "Open in Jira" → construct JQL URL client-side

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

**D13 — sdkVersion source:** Recommendation is build hash from `scripts/embed-sdk.js`, exported from `src/lib/version.js`. Confirm before Sprint 5 starts.

### 8.4 Acceptance criteria

- Dashboard loads, shows all canvases

- Search filters by canvas name

- Ticket counts match JQL

- Open count excludes Done

- URL count = distinct normalized URLs

- Participants = distinct assignees+reporters (cap 5)

- "Get write bookmarklet" enabled for licensed user, disabled with tooltip for unlicensed

- "Copy review bookmarklet" enabled regardless of `hasAccess` (needs ≥1 ticket browse)

- Confirmation on first use per user (persist `confirmed_review_scope_<canvasId>`)

- Both bookmarklets work end-to-end

- Revoke: token removed, existing bookmarklet fails at next `exchangeToken`

- Token list shows scope, user, canvas, issued, expires

- "Open in Jira" opens JQL search

### 8.5 Known tricky bits

1. **`@forge/bridge` vs `@forge/react`.** Custom UI uses `@forge/bridge` (`invoke()`). UI Kit uses `@forge/react`. Dashboard is Custom UI.

2. **Avatar rendering.** `<img>` with `alt` fallback to initials.

3. **Copy-to-clipboard.** `navigator.clipboard.writeText()` in onClick works.

4. **Confirmation persistence.** KVS `reviewScopeConfirm:<userId>:<canvasName>` with TTL 30d.

5. **`javascript:` drag-and-drop.** Provide "Copy URL" button as primary path; drag is secondary.

---

## 9. Sprint 6 — Epic Panel, Issue Panel, Field Mapping Audit

**One-shot viability:** Partial. UI Kit panels are straightforward. Epic dual-query needs verification against both project types.

**Goal:** Epic panel shows canvases referenced by tickets in the epic. Issue panel shows canvas, URL, deep-link, related. Audit lists missing field mappings.

### 9.1 Files to create

**UI Kit:** `src/ui-kit/epic-panel/index.jsx` (replace stub), `src/ui-kit/issue-panel/index.jsx` (replace stub), `src/ui-kit/admin/FieldAudit.jsx`

**Resolvers:** `src/resolvers/actions/epic.js` (replace stub), `src/resolvers/actions/issue.js` (replace stub), `src/resolvers/actions/admin.js` (`fieldMappingAudit` stub → real)

**Modified:** `manifest.yml` (epic panel `displayConditions`), `src/ui-kit/admin/index.jsx` (render `<FieldAudit />`)

### 9.2 Epic panel — dual-query

javascript

async function epicPanelData(context, payload) {
  const epicKey = payload.epicKey;
  const [companyManaged, teamManaged] = await Promise.all([
    runJql(`"Epic Link" = ${epicKey} AND "JiraTack Canvas" is not EMPTY`),
    runJql(`parent = ${epicKey} AND "JiraTack Canvas" is not EMPTY`),
  ]);
  // merge, dedupe by key, group by canvas, count totals
  return { canvases: [...] };
}

### 9.3 Issue panel

Per CONTRACTS §4.4. Fetch issue via `asApp().requestJira`. If canvas empty → `{ isJiraTack: false }`. Else related query.

### 9.4 Epic panel condition

yaml

jira:issuePanel:

- key: jiratack-epic-panel
  resource: epic-panel-ui
  resolver:
    function: resolver
  render: native
  title: JiraTack Canvases
  displayConditions:
    issueType: "Epic"

Verify works on both company-managed and team-managed projects. If not, fallback: panel always shows, returns "This is not an epic" message for non-epics.

### 9.5 Field mapping audit

Per CONTRACTS §4.5. Cap at 20 projects per run.

### 9.6 Acceptance criteria

- Epic panel renders on epics in company-managed projects

- Epic panel renders on epics in team-managed projects

- Epic panel does not render on non-epics (or fallback message)

- Canvas counts correct (in-epic + total)

- Panel buttons work

- Issue panel renders on tickets with canvas, shows "Not a JiraTack ticket" otherwise

- "Copy link to this pin" copies `?jiratack_ticket=<key>` URL

- "Copy review bookmarklet" works from issue panel

- Related tickets list correct (cap 20)

- Audit lists projects with missing fields, provides fix links

- Projects with all fields mapped show green checkmark

### 9.7 Known tricky bits

1. **Team-managed epics.** Use `parent` linkage. Verify with a team-managed project on dev site.

2. **`createmeta` performance.** Cap at 20 projects per run, paginate if more.

3. **Fix URL requires admin.** Hide or show tooltip if not admin.

4. **Related dedupe.** Query filters by canvas + URL already.

5. **Deep-link construction.** Just string concat.

---

## 10. Sprint 7 — Inline Editing, Done Animation, Retirement, License, Marketplace

**One-shot viability:** Partial. Inline-edit controls and retirement are one-shot. Done animation is polish and will need iteration. License gating needs real Marketplace state.

**Goal:** Product complete. Inline edit, Done animation, retirement window, license gating, Marketplace materials.

### 10.1 Files to create

**SDK:** `src/bookmarklet/{inlineEdit,done}.js`, `src/bookmarklet/doneAnimation.css`

**Backend:** `src/lib/license.js`

**Docs:** `docs/PRIVACY.md`, `docs/MARKETPLACE.md`

**Modified:** `src/bookmarklet/sidebar.js` (wire inline edit + Done), `src/lib/jql.js` (retirement window template), `src/webtrigger/actions/getPins.js` (use retirement window), `src/resolvers/actions/admin.js` (finalize `hasAccess`), `src/ui-kit/admin/index.jsx` (license status), `manifest.yml` (`access.userAccess: true`), `README.md`

### 10.2 Retirement

- Overlay query always excludes Done when `retirementDays === 0`.

- When `retirementDays > 0`: include Done within window, rendered at `#2ECC71` opacity 0.5, read-only.

- **Multi-project canvases (D14):** Use first-ticket's project config as source. Document limitation.

### 10.3 Done animation

- On `updateIssue` success where transition target is Done:
  
  - Pin: flash `#2ECC71` + checkmark, 400ms
  
  - Card: flash green, 400ms
  
  - After 1.5s: pin fades out (300ms opacity → 0), card greyed with Done badge
  
  - After fade: remove pin, decrement count

- Verify with `transition.to.statusCategory.key === 'done'`.

### 10.4 License

- Production: full enforcement per CONTRACTS

- Dev: `license === undefined` → treat as active

- Admin panel: license status, user access count

- Sidebar on `LICENSE_INACTIVE`: persistent red banner

### 10.5 Acceptance criteria

- Inline edit: status picker shows only valid transitions

- Status change optimistic; on failure revert + toast

- Priority change works; assignee typeahead works

- Done animation: flash → 1.5s pause → fade → greyed card

- Retirement window: `retirementDays === 0` → no Done pins in overlay

- Retirement window: `> 0` → Done pins within window visible (green, 0.5 opacity, read-only)

- View scope: all inline-edit controls absent; card click opens Jira

- License inactive: `exchangeToken` returns 403 `LICENSE_INACTIVE`; sidebar red banner

- License inactive: `generateCanvasToken(create)` returns `LICENSE_INACTIVE`

- License inactive: `generateCanvasToken(view)` still works if browse access

- Marketplace materials complete

### 10.6 Known tricky bits

1. **Retirement config source (D14).** Multi-project canvases. Document v1 limitation.

2. **Done animation timing.** 400ms flash + 1.5s pause + 300ms fade = 2.2s total. Do not shorten or lengthen.

3. **`getTransitions` for view scope.** View users need it for state display (already view-allowed).

4. **Marketplace submission.** Sprint 7 delivers materials, not the submission.

5. **`hasAccess` timing.** Revoking a user after token issuance leaves the token valid until expiry or explicit revocation. Document in admin UI.

---

## 11. File tree evolution

**After S1:** manifest.yml, package.json, vite configs, scripts/, src/resolvers/, src/lib/, src/webtrigger/ (stubs), src/ui-kit/{admin,project-config,epic-panel,issue-panel}/, src/custom-ui/dashboard/

**After S2:** + src/lib/{tokens,jql,adf}.js, src/shared/{urlNormalize,adfSerializer}.js + tests, src/webtrigger/actions/, src/webtrigger/middleware/

**After S3:** + src/bookmarklet/, src/lib/sdk-bundle.js (generated, committed), dist/bookmarklet/ (gitignored build output)

**After S4:** + src/bookmarklet/{pinMode,screenshot,consoleProxy,form,description,validate}.js

**After S5:** + src/custom-ui/dashboard/components/, src/custom-ui/dashboard/{api,styles}

**After S6:** + src/ui-kit/admin/FieldAudit.jsx

**After S7:** + src/bookmarklet/{inlineEdit,done}.js, src/bookmarklet/doneAnimation.css, src/lib/license.js, docs/

---

## 12. Definition of Done per sprint

A sprint is done when:

1. All files listed in §X.1 exist with expected exports.

2. `forge deploy -e development` exits 0.

3. All acceptance criteria pass on the dev site.

4. All TEST_PLAN.md assertions for the sprint pass.

5. `forge logs -e development` shows no unexpected errors during acceptance test.

6. `git commit -m "feat(sN): <brief description>"` committed.

**Do not proceed to the next sprint until all six conditions are met.**

---

## 13. Open decisions

All open decisions are tracked in `DECISIONS.md`. Do not duplicate decision content here.

**Decisions currently blocking specific sprints:**

- D10, D12 — blocking Sprint 1

- D9, D11 — blocking Sprint 2

- D13 — blocking Sprint 5

- D14 — blocking Sprint 7
