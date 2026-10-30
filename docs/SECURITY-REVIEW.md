# JiraTack Security & Architecture Review

**Reviewed at:** commit `304459e` (app 4.87.0, SDK `971b6781d087`) · **Date:** 2026-10-28
**Addendum:** §9.6 added 2026-10-30 at commit `027d590` (app 4.92.0, SDK `731d221968a1`) — CSP delivery finding 13 and D22.
**Scope:** webtriggers, JWT/KVS, resolvers, Forge panels, Custom UI dashboard, bookmarklet SDK.
**Method:** read-through of every module cited; line numbers verified against the working tree.

> This document is the review of record. §8 tracks remediation as the refactor lands.
>
> **Repository copy.** Imported from the working review ledger on 2026-10-30 at
> tag `baseline/pre-pivot-2026-10-30`. The repo copy is canonical from here; the
> external scratch copy may diverge.

---

## 0. Executive summary (severity-ordered)

| # | Finding | Severity | Location |
|---|---|---|---|
| 1 | `get/setInstallationConfig`, `get/setProjectConfig`, `listCanvasTokens`, `revokeCanvasToken`, `generateGuestToken` had **no authorisation check** | **Critical** | `src/resolvers/index.js:69-128`, `resolvers/actions/config.js`, `resolvers/actions/admin.js` |
| 2 | `listCanvasTokens` returned **raw bearer token strings** → any user on the dashboard could enumerate and use/revoke every canvas & guest credential | **Critical** | `resolvers/actions/admin.js:272-280` |
| 3 | Revoked/deleted tokens cannot invalidate a live session JWT (up to 8 h) | High (was accepted as D11) | `webtrigger/actions/exchangeToken.js:116-125` |
| 4 | Signing secret: get-then-set with no compare-and-set → cold-start race can orphan already-issued JWTs | High | `lib/tokens.js:10-26` |
| 5 | `installationConfig` read-modify-write with no concurrency control → lost updates on simultaneous admin edits | High | `lib/config.js:17-45` |
| 6 | KVS **read failure** was indistinguishable from "no config yet": default config returned, then persisted by a later write → potential config wipe | High | `lib/config.js:17-26` |
| 7 | Screenshot bytes transit the web trigger as base64 in the request body, with no size ceiling | Medium | `bookmarklet/screenshot.js`, `webtrigger/actions/createIssue.js` |
| 8 | Up to 50 individual `kvs.get` calls per assignee search | Medium | `webtrigger/actions/searchUsers.js:36` |
| 9 | Canvas reads scan up to 2000 issues (≈20 sequential Jira searches) on four independent paths | Medium | `getPins.js`, `listCanvasesForUser.js`, `dashboard.js`, `jql.js` |
| 10 | No HTML-injection sink found, but stored page URLs reached `href`/`location.href`, permitting `javascript:` execution | Medium (closed in §9.1) | §1.5, §9.1 |
| 11 | Silent partial results: scan caps truncated output with no flag to the client | Medium | `getPins.js` |
| 12 | SDK orchestration is a 1120-line singleton module mixing transport, DOM, layout and lifecycle | Medium (pivot) | `bookmarklet/index.js` |
| 13 | External SDK `<script>` is blocked by host-page CSP on strict sites (GitHub, Google, MDN, Wikipedia); failure was silent, and neither inline-SDK nor iframe fallbacks work | **High** for coverage/demo, not confidentiality | `shared/bookmarklet.js`; §9.6, D22 |

---

## 1. Security & Auth Audit

### 1.1 Web trigger authentication — sound core
One chokepoint, `src/webtrigger/middleware/auth.js`, correctly implemented:
- Bearer-only; `verifySessionJwt` pins `algorithms: ['HS256']` (`lib/tokens.js:35`) → not vulnerable to `alg:none` or algorithm confusion.
- `aud` cross-checked against the installation ARI/context (`auth.js:17-26,45-48`).
- Every action carries an explicit scope allowlist (`webtrigger/api.js:60-104`); `exchangeToken` is the only unauthenticated path.
- `updateIssue`/`getTransitions` enforce per-issue canvas+project access (`lib/issueContext.js`), so a JWT is never the sole check for *which* issue.
- No `asUser()` in any web trigger handler — the AGENTS.md constraint holds.

**Remaining gaps:** no `jti`/nonce and no session allowlist, so a captured JWT is replayable for its whole lifetime. CORS is implicit (see 1.6).

### 1.2 Guest token lifecycle (traced)
1. **Mint** — `generateGuestToken` (`admin.js:182-260`): 365-day TTL, `crypto.randomBytes(32)`, stored as `canvasTokens:<token>` with `permittedCanvases` and `permittedProjectsJson` computed from the **issuer's** browse access at issuance.
2. **Distribute** — token is embedded in the installer URL (`admin.js:246-253`) and the bookmarklet (`shared/bookmarklet.js:5-17`). The secret therefore persists in browser history, bookmarks and any chat/email the link is pasted into; `install.js:113` warns "Do not forward it", which tells you the design tolerates this.
3. **Exchange** — `exchangeToken` reads the record and checks `revoked` **and** `expiresAt` on every call (`exchangeToken.js:116-125`), so revocation blocks *new* sessions immediately.
4. **Use** — `canAccessCanvas` only constrains `guest_create` (`middleware/scope.js:7-11`); `permittedProjects` is frozen in the JWT.

**Answer to the audit question:** removing a guest from the allowlist stops new exchanges at once, but **an already-issued guest JWT stays valid for up to 8 hours** (finding 3). Also: `permittedCanvases` lives in the JWT, so editing a live guest record only affects future exchanges.

### 1.3 Admin context — the headline problem, and the fix's shape
`deleteCanvas` and `archiveCanvas` did call `isJiraAdmin`, but the resolver layer did not, for the most sensitive operations:
- `getInstallationConfig` returned the whole config (all project settings, archived/deleted lists, `viewPermissionMode`) to any invoker.
- `setInstallationConfig` blind-merged `req.payload` with no check — any user able to reach the global page could set `viewPermissionMode: "open"`, which per D9 exposes every pin to anyone holding any bookmarklet.
- `get/setProjectConfig`, `list/revokeCanvasToken`, `generateGuestToken` likewise unchecked.

**Why a blanket page-level `access` scope is the wrong tool here:** the dashboard is a *licensed-user* surface (browse your canvases, get your own bookmarklet, create a canvas), not an admin surface — `jira:globalPage` is legitimately open to all users, and the UI computes `isAdmin` only to hide controls. So enforcement has to be **per-operation, server-side**. That is what §8 item 1 implements. A page-level custom `access` scope remains an optional defence-in-depth hardening step, deliberately not taken.

### 1.4 Credential exposure via `listCanvasTokens`
`admin.js:272-280` reversed the KVS key into a plaintext token. With 1.3 that is full credential disclosure to any dashboard user. Note also: **no UI consumer exists** (verified by grep) — it was exposed but unused, so the safe resolution is to stop returning the token and to identify records by a non-reversible reference instead.

### 1.5 Input sanitisation / XSS — clean
- Server-side user text is emitted as **ADF text nodes**, never HTML (`lib/issueDescription.js:5-19`) — Jira owns rendering.
- Installer escapes every interpolation including the bookmarklet `href` (`webtrigger/install.js:8-15,107`).
- Bookmarklet renders via `textContent`/`createElement` and builds URLs with `encodeURIComponent`/the `URL` API (`bookmarklet/sidebar.js:13-37`, `form.js`, `inlineEdit.js`). No `innerHTML = userInput` path anywhere.
- Guest fields validated and bounded (`createIssue.js:138-145`); summary length-bounded and prefix-normalised (`updateIssue.js`).
- JQL injection surface collapsed by D18 (fixed `labels = "jiratack"` + in-memory property filtering; interpolated values escaped).

Residual: raw `projectKey` is interpolated into `route` in `searchUsers`/`getIssueTypes` (Forge encodes it, but format-validation is cheap insurance); the issue panel renders a `data:` image URL, which is a CSP/size concern rather than an XSS one.

### 1.6 CORS
No handler sets `Access-Control-Allow-Origin` (`api.js` sends `Content-Type` only; `sdk.js:6-9`; `install.js:6`). Cross-origin calls work because Forge serves web triggers from its own domain with permissive CORS. Not directly exploitable — auth is a bearer header, not a cookie, so CSRF has nothing to ride on — but the app depends on implicit platform behaviour, and the extension pivot should make the policy explicit rather than inherited.

---

## 2. Current Data Flow & Legacy Tech Debt

- **Description construction:** `lib/issueDescription.js` (`buildIssueDescription`) → `webtrigger/actions/createIssue.js` and `lib/canvas.js`. Shape: bold `[JiraTack Guest: Name]`/`[JiraTack]` header → user body → optional console code block → `Page:` link footer.
- **Raw text vs ADF: full ADF.** Client builds paragraphs via `serializeToAdf` (`bookmarklet/form.js`); server composes and merges ADF (`lib/descriptionBlocks.js`). The "raw JSON in the description" problem is genuinely gone from the write path.
- **Machine data:** `com.jiratack.metadata` only (`lib/metadata.js`), written post-create, read via the enhanced-search `properties` parameter. The standalone `GET /issue/{key}/properties/{key}` path proved unreliable and its function is now dead code (removed in §8).
- **Screenshots:** client `html2canvas` → 800×800 canvas → `toDataURL('image/webp', 0.85)` → **base64 inside the web trigger POST body** → server decodes to `Buffer` and re-uploads as multipart to `/issue/{key}/attachments`. It works (attachments confirmed in logs) and community testing puts the web-trigger body ceiling near 5 MB (undocumented, non-negotiable) with base64 inflating ~33%. The risk is the absence of any ceiling in `screenshot.js`: a tall/complex page can fall through to a large PNG (`screenshot.js:85-87`). Recommended: Forge Storage or a Jira attachment upload session so bytes never transit the trigger.
- **Tech debt to schedule:** (a) D18's cutover is invisible to users — pre-refactor tickets carry no property and the marker fallback was deleted, so they are absent everywhere; (b) the new `jiratackCanvas` entity property is not indexed for those legacy tickets either, so "Review All Tickets" may look empty until they're rewritten; (c) the four orphaned custom fields still exist on sites where they were provisioned (`fields.js` is deleted, the fields are not).

---

## 3. Performance & Forge Limits

### 3.1 KVS
- **Looped reads:** `searchUsers.js:36` fans `isLicensedUser` over up to 50 candidates — one `kvs.get` each, on every debounced keystroke. Batchable.
- **Write amplification:** `setInstallationConfig` rewrites the whole blob and rehashes `configVersion`; the config is read on nearly every request.
- **Uncached platform calls:** `lib/webtriggerUrls.js:4` reads `config.webtriggerUrls`, which is **never written**, so every `exchangeToken`/`generateCanvasToken` performs up to three `webTrigger.getUrl()` calls.

### 3.2 Races
- **Config read-modify-write (real):** `setProjectConfig` and the `setInstallationConfig` resolver do get → mutate → set with no guard; two admins editing different projects lose one change. Same for `archivedCanvases`/`deletedCanvases`.
- **Signing secret (real, low frequency):** `loadOrCreateSecret` is get-then-set; concurrent cold starts can each mint a secret and the loser's JWTs stop verifying.
- **Metadata-after-create (real):** `createIssue.js` writes the property best-effort and only logs on failure → the ticket exists but is orphaned and invisible, discoverable only via logs.
- **Client-side is the strongest area:** generation-token cancellation in `runHydration`, `teardownLayout()` before every mode switch, and idempotency guards (`pushLayoutApplied`, `disposed`) mean no stacked mutations.

### 3.3 Limits
- **Timeouts:** `getPins`, `listCanvasesForUser`, `dashboardAggregate` each page up to 2000 issues at 100/page ≈ 20 sequential Jira searches per invocation, `dashboardAggregate` plus `serverInfo`/`mypermissions`. This is the most likely latency cliff at real scale.
- **Silent truncation:** those scan caps drop results without telling the client (finding 11).
- **Module caps:** entity-property values used = 1 of 100; `listCanvasTokens` queries `.limit(100)` with no pagination.
- **Logging:** `webtrigger/api.js` logs every action name, and `admin.js` logs token records — verified that the logged record does **not** contain the raw token.

---

## 4. Extensibility — Browser Extension Pivot

**Already clean and reusable:** `bookmarklet/api.js` (single `postAction` transport, no DOM), `bookmarklet/auth.js` (session cache behind three functions), all of `src/shared/` (environment-free, unit-tested), and the wire contract itself.

**The coupling:** `bookmarklet/index.js` (1120 lines) is a module-scoped mutable singleton (`let current`) owning transport orchestration, DOM mounting, deep-link parsing, layout mutation, hydration and lifecycle at once, with the global `window.__jiratackInit/__jiratackClose` handshake as its only entry point.

**Extraction plan:**
1. **Host/transport interface** — `{ storage, openLink, currentUrl, onVisibility }`; bookmarklet → `sessionStorage`/`location`, extension → `chrome.storage.session`/`tabs.create`. Highest leverage; today's hard couplings are `auth.js` (`sessionStorage`) and `sidebar.js:32` (`window.location.href`).
2. **Split `index.js` into controller vs mount** — controller = pure state machine; mount = `overlay/sidebar/pins/form/inlineEdit`.
3. **Layout behind a strategy** — `layoutStrategy: push | fit | none`; an extension with a real side panel selects `none`, retiring `fixedShift`/`fitScale`/margin code without deleting it (still needed while the bookmarklet ships).
4. **Provision config out-of-band** — stop baking bearer tokens into bookmarklet strings; onboards to `chrome.storage`. Also retires the §1.2 secret-in-history problem.
5. **Versioning** — `Cache-Control: immutable` + `?v=` cache-busting (`sdk.js:8`) is a bookmarklet artefact and the reason re-dragging is mandatory; a content script drops it.
6. **CSP** — restrictive host pages can block the injected `<script src>`/inline `<style>` outright. This is a correctness argument for the pivot, not merely tidiness; measured on live sites and written up in §9.6 (D22).
7. **Capture** — `chrome.tabs.captureVisibleTab` is cheaper and sidesteps html2canvas's CORS/CSP gaps.

---

## 5. Architecture & Code Quality

- **Complexity:** `index.js` as above; `applyLayoutMode` nests teardown → install → fallback → render and recurses via `onBelowFloor`. `runHydration` (budgeted, token-checked) and the `select`/`setHover`/`flash` triad are the good models to copy.
- **Duplication:** `fetchJiraBaseUrl()` three times (`dashboard.js`, `issue.js`, `epic.js`); `mapUser()` twice; `escapeJql()` twice; `getSession()` reimplemented in `epic.js`.
- **Dead code:** `readMetadata` (superseded by `readMetadataBySearch`), `successResponse` (`errors.js:37`), `config.webtriggerUrls` read of a never-written key.
- **Error handling — mostly good:** typed `{ok,error}` envelope with correct HTTP mapping (`api.js:16-38`), fail-closed authorisation, optimistic-update-with-revert in `inlineEdit.js`. Two systemic flaws: **silent defaulting** (§3.2/finding 6 — a KVS blip becomes a config wipe, and `getEffectiveRetirementDays` returning `0` on error silently disables retirement) and **cause conflation** (`readMetadataBySearch` maps "lookup failed" and "no property" to the same `null`, surfacing as `INSUFFICIENT_SCOPE: "This issue is not managed by JiraTack"` — the misleading message that cost a debug cycle).
- **Privacy-by-design:** `consoleProxy.js` buffers arbitrary third-party page console output into a Jira ticket (see §6).

---

## 6. Marketplace Readiness Flag — Privacy & Data Handling

Not a code defect, but the item a manual security reviewer and the Marketplace privacy review will both open on. The app's data paths must be stated in the privacy policy and listing, accurately:

1. **Console capture (`consoleProxy.js`).** Page console output from an arbitrary third-party site can be written into a Jira ticket description. Console logs are a known carrier of tokens, PII and stack details. Today it is opt-in per ticket (checkbox) and the buffer is capped (50 entries), but this is the single most likely thing to be flagged. Options: keep with explicit disclosure + a site-wide admin kill-switch (a `captureConsoleLogs` default exists), or default-off plus a visible content preview before submit.
2. **Issue properties (`com.jiratack.metadata`).** Stores guest **name and email** plus page URL/selector on the Jira issue — durable, invisible in the Jira UI, and retained as long as the issue exists. Must be named in the privacy policy alongside a retention/deletion statement (deleting the ticket deletes the property).
3. **Guest identity as a credential-shaped thing.** A 365-day guest token embedded in a URL and bookmark, whose JWT impersonates the **issuer's** browse access — the "who can see what" claim in the policy needs to reflect that a forwarded guest link carries the issuer's project access, not the guest's own.
4. **Long-lived client-held JWTs.** Session JWTs live in `sessionStorage` on arbitrary third-party origins, so any script on the host page can read them; the 8 h validity window is therefore a real exposure, not a theoretical one.
5. **Screenshots.** Full visual captures of the host page (which may show other users' data) are attached to Jira issues.
6. **No egress.** After removing the unused `external.fetch` declaration (D16), all data stays between Forge, Jira and the user's browser — a genuinely strong talking point; say it explicitly.

---

## 7. Marketplace Readiness Flag — Runs on Atlassian

The app is **permanently ineligible** for the Runs on Atlassian badge, and the reviewer will ask why (observed on every deploy: app 4.82.0 → 4.87.0, and `forge eligibility` reports "App is using a webtrigger module that can egress data").

- **Mechanism:** eligibility requires static web triggers. A `response.type: static` trigger may only return manifest-declared fixed outputs; the function selects an `outputKey`, it cannot compose a body at runtime.
- **Why JiraTack cannot comply:** every one of its three triggers returns per-request dynamic content — `jiratack-api` returns JWT-conditional JSON whose shape varies per action, `jiratack-sdk` serves a build-hashed bundle, `jiratack-install` renders a page containing the caller's token. None can be a pre-declared constant.
- **What was already done:** the only *unnecessary* egress declaration (an unused `external.fetch.backend: "*.atlassian.net"`, dead since Sprint 1) was removed, clearing the "App is egressing data" flag. The webtrigger flag remains, by design (D16).
- **Position to take in the listing:** the dynamic trigger exists to serve a **user-installed bookmarklet**, not to talk to a third-party service; it is an inbound endpoint with no outbound egress, authenticated by app-issued JWT with per-issue canvas/project checks. If badge eligibility ever becomes commercially necessary, the path is the browser-extension pivot (§4) with the API moved behind an app-internal transport — which is a larger change than re-typing a manifest field.

---

## 8. Remediation Log

Execution order agreed with the app owner: P0 authorisation → P1 integrity/revocation → P2 performance → P3 hygiene/extensibility. §4's structural split is deliberately sequenced **after** the security work, as the pre-extension milestone.

### Stage 1 — P0 authorisation + P1 integrity (landed `2e88ec9`, app 4.88.0, SDK `1e8a800b2f06`)

**Findings 1 & 2 — closed.**
- New `src/lib/access.js`: `isJiraAdmin` (prefers `context.userAccess.isAdmin`, falls back to an `ADMINISTER` lookup) and `requireAdmin`.
- Admin enforced server-side on `get/setInstallationConfig`, `get/setProjectConfig`, `listCanvasTokens`, `revokeCanvasToken` (joining the existing checks on `delete/archiveCanvas`).
- **`generateGuestToken` is seat-gated, not admin-gated** (owner decision, recorded in D19): the seat is the authorisation boundary because guest links are the core stakeholder-sharing flow. Final behaviour: a seat holder mints a guest link; an unlicensed user gets `LICENSE_INACTIVE` and no button. Accepted trade-off: the guest session carries the issuer's browse access for the selected canvases.
- `listCanvasTokens` no longer returns bearer tokens — a non-reversible `tokenRef` (SHA-256 prefix) instead; `revokeCanvasToken` resolves it server-side. Query cap raised 100 → 1000.
- UI aligned with the guard so failures aren't silent: "Generate Guest Link" hidden for non-admins; the project-settings page now renders the permission error instead of showing defaults with a dead Save button.
- `createCanvas` deliberately remains open to any licensed user (additive; Jira enforces create permission) — recorded in D19 rather than left as unexplained inconsistency.

**Findings 4, 5, 6, 12 — closed or materially reduced.**
- `getInstallationConfig` now distinguishes *absent* (defaults) from *unreadable* (throws), so a KVS blip can no longer be persisted back over a real config.
- `mutateInstallationConfig` narrows read-modify-write to a single in-invocation window with retries; used by `setProjectConfig`, archive/delete and `setInstallationConfig`. **Honest caveat:** this *reduces* the lost-update window, it does not eliminate it — true CAS via KVS record versions is still open (finding 5 downgraded, not closed).
- Signing secret created with a `must_be_missing` compare-and-set (finding 4 closed).
- `readMetadataBySearch` now returns `{ metadata, lookupFailed }`, so a Jira lookup failure no longer masquerades as `INSUFFICIENT_SCOPE: "This issue is not managed by JiraTack"`.
- Orphan prevention: `createIssue` returns `warning: "metadata-not-stored"` when the property write fails, and the SDK shows a distinct message rather than silently producing an invisible ticket.

**Findings 8 & 11 — closed.** `searchUsers` batches licensed-user lookups into one KVS read (N→1, with a per-key fallback); `getPins` returns `truncated` when the 2,000-issue scan cap is hit; the canvas→project lookup failure is logged instead of silently disabling retirement.

**Hygiene:** dead code removed (`readMetadata`, `successResponse`); api.js now re-exchanges the session once on `TOKEN_EXPIRED`/`TOKEN_INVALID`, which bounds the *practical* revocation window (finding 3 mitigated, not solved — see below).

### Still open (explicitly not done in this stage)

| Finding | Status | Why deferred |
|---|---|---|
| 3 — 8 h revocation lag | **Mitigated** | SDK self-heals on expiry, but a JWT is still valid until `exp`. Instant revocation needs a per-request KVS session read; it is a deliberate cost/latency decision, recorded in D19 |
| 5 — true CAS | Reduced | Needs KVS record-version writes; the narrowed window is the interim |
| 7 — screenshots through the trigger body | **Closed (§9.2)** | Chunked upload + `screenshotUploadId`; see D20 |
| 9 — 2000-issue scans | **Open** | The fix is canvas-scoped queries via the new `jiratackCanvas` alias plus caching; needs care because entity-property indexing lags and legacy tickets were never indexed |
| 12 — SDK/controller split | **Partially closed (§9.3)** | API + auth are now DOM-free and injectable (`createApiClient`, `createSessionManager`). The `index.js` orchestrator/DOM host extraction remains the pre-extension milestone |
| — duplication | **Open** | `fetchJiraBaseUrl`, `mapUser`, `escapeJql` still copy-pasted across `dashboard.js`/`issue.js`/`epic.js`; low risk, worth folding into a `lib/jira.js` during the §4 refactor |
| — CORS explicitness | **Open** | Still relies on the platform's implicit permissive CORS; decide the policy as part of the extension pivot |
| — marketplace privacy wording | **Open** | §6 items need to land in `docs/PRIVACY.md`/listing copy before submission |

### Verification so far

`forge lint`: no issues. Unit suites: 14/14 ADF+blocks, 23/23 URL, 8/8 serializer. `npm run build` clean. Deployed to **development** only (staging/production untouched).

**Manual checks required (cannot be exercised from here) — TEST_PLAN §2.20:**
1. As a non-admin: each privileged resolver returns `INSUFFICIENT_SCOPE`; config on disk unchanged; guest button absent; project-settings page shows the permission message.
2. `listCanvasTokens` response contains `tokenRef` and **no** `token`.
3. Revoke a guest token → new exchange fails, pre-existing JWT still works until `exp` (expected, D19).
4. Re-drag the bookmark (SDK `1e3a800b2f06`), let a session expire, and confirm an action self-heals instead of erroring.
5. Confirm admin flows still work end-to-end: view-permission toggle, project settings save, canvas create/delete/archive, guest link generation.


---

## 9. Stage 2 — Presentational sweep, screenshot transport, SDK split

Landed after the review: `fix(security): xss sweep + chunked screenshot upload + sdk split`. Deployed to development.

### 9.1 Presentational XSS sweep

**Method:** searched the whole tree for unsafe sinks (`dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `outerHTML`, `document.write`, `.html(`), then read every presentational component and panel.

**Result: no HTML-injection sink exists.** Every dashboard component and Forge panel renders through React text nodes (`{value}`), and the bookmarklet renders via `textContent`/`createElement`. `innerHTML` is used only for `= ''` clears. So the classic injection class is absent.

**A real vector was found elsewhere: URL schemes.** Stored page URLs were used directly in `<a href>` and assigned to `window.location.href`:
- `CanvasTable.jsx` — canvas name link and the expanded page list.
- `bookmarklet/sidebar.js` `navigateToPin` — `window.location.href = target`.
- `ui-kit/issue-panel` — `<Link href={data.url}>` and `router.open(data.url)`.
- `ui-kit/epic-panel` — `router.open(buildJqlUrl(...))`.

Because URLs originate from pin metadata written by any seat holder, a `javascript:` (or `data:`) value could execute in the Jira dashboard origin or the host page — stored XSS, even though no `innerHTML` is involved.

**Fix:**
- New `src/shared/safeUrl.js` — `toSafeHttpUrl()` accepts only absolute `http:`/`https:` (optionally resolved against a base) and returns `null` otherwise. Unit-tested (`src/shared/safeUrl.test.js`, 17 vectors incl. `javascript:`, `data:`, `vbscript:`, `file:`, `ftp:`, relative, non-string).
- Applied at every sink: a `SafeLink` wrapper in `CanvasTable`, a guard in `navigateToPin`, `safePageUrl` in the issue panel (link + `router.open`), and a guard in the epic panel.
- Server-side defence in depth: `createIssue` now rejects a non-http(s) `url` with `VALIDATION_ERROR`; the canvas seed ticket falls back to `https://example.com` for a non-http(s) target. So a bad scheme cannot enter metadata going forward.
- Incidental fix: the epic panel was still building a dead custom-field JQL (removed in D18); it now uses the `jiratackCanvas` alias like the dashboard.

**Deliberately unchanged:** the "Get Bookmarklet" link is a `javascript:` href by design. It is generated by the app (`buildBookmarklet` uses `JSON.stringify` for the config), rendered as an attribute by React (HTML-escaped), and is the product's delivery mechanism — not user-controlled markup.

### 9.2 Screenshot transport (finding 7) — was the most likely production failure

**Problem:** the full base64 screenshot travelled in the `createIssue` request body. The web-trigger body ceiling is ~5 MiB (community-measured, undocumented) and **KVS values are capped at 240 KiB** (documented), so the old design was both fragile and unstoreable in one piece.

**Implementation (D20):**
- `beginScreenshotUpload { mimeType, size }` → `{ uploadId, chunkSize }`. Random 32-hex id, manifest in KVS with a 15-minute TTL, bound to the JWT subject. Size capped at 20 × 200 KiB ≈ 4 MiB base64.
- `uploadScreenshotChunk { uploadId, index, data }` → stores one ≤200 KiB base64 chunk. Wrong owner → `NOT_FOUND` (existence not disclosed); out-of-range index or oversized chunk → rejected.
- `createIssue` accepts **`screenshotUploadId`** (no binary); it assembles chunks, attaches to Jira, and deletes manifest + chunks. Missing/expired/incomplete upload or attachment failure is logged and the ticket is still created — the image never blocks the ticket.
- Client: `api.js uploadScreenshot()` chunks at the server-provided size; `form.js` uploads before creating and passes only the id; `console.error` on upload failure (screenshot is optional).
- Old `screenshotDataUrl` path removed. **Bookmarks must be re-dragged**; an old SDK would simply create tickets without screenshots.

**Honest limitation:** Forge offers no S3-style pre-signed upload URL to a third-party browser client, and Forge Storage is backend-only — so "identifier instead of payload" is achieved by chunked ingestion, not by eliminating Forge as the transit. The bytes still cross Forge, just never in one oversized request.

### 9.3 SDK/controller split (finding 12) — API layer done, DOM host remains

**Before:** `api.js` imported `exchangeSession` directly, and `auth.js` hard-coded `sessionStorage`. Reusing them in a content script meant inheriting both assumptions.

**After:**
- `auth.js` now exports `createSessionManager(storage)` (sync `getItem/setItem/removeItem/keys` adapter) plus `createBrowserSessionStorage()`. The browser exports (`exchangeSession`, `clearSession`) are thin bindings, so no call site changed.
- `api.js` now exports `createApiClient({ exchangeSession })` returning the full surface (`getPins`, `createIssue`, `updateIssue`, `getTransitions`, `getPriorities`, `getIssueTypes`, `listCanvasesForUser`, `createCanvas`, `searchUsers`, `uploadScreenshot`, `postAction`). Existing named exports remain bound to the browser default.
- Net effect: an extension can do `createApiClient({ exchangeSession: createSessionManager(chromeStorage).exchange })` and get auth + create + view flows with **zero DOM dependencies**.

**Still coupled (and deliberately deferred):** `index.js` remains the bookmarklet *host* — it owns `window.__jiratackInit`, deep-link parsing, overlay mounting, layout mutation (push/fit), and teardown. Extracting that into a host-agnostic controller plus a DOM mount is the next step for the pivot; the API seam above is what makes it safe to do incrementally.

### 9.4 Verification for this stage

- `npm run build` clean, `forge lint` clean.
- Unit suites: `adfText` 14/14, `urlNormalize` 23/23, `adfSerializer` 8/8, **`safeUrl` 17/17**.
- Manual cases to run: TEST_PLAN §2.21 (chunk upload, size/owner rejection, `javascript:` URL rejection) in addition to the outstanding §2.20 authorisation suite.

### 9.5 Reviewer escalation — `createCanvas` authorisation (D21)

The manual review flagged `createCanvas` as reachable with only a scope check, and recommended a live `ADMINISTER` lookup via `api.asUser()`. Two corrections and one real finding:

1. **Guest cannot reach it.** `createCanvas` is allowlisted to `['create', 'universal']`; guest tokens carry `guest_create`, so `authenticate` rejects them at the scope gate (verified in `middleware/auth.js`). The "guest token with `create` scope" premise is not how issuance works — `generateGuestToken` always stamps `guest_create`.
2. **The proposed check is not implementable.** A web trigger has no user identity; `api.asUser()` cannot act as an arbitrary account from one, and AGENTS.md forbids it outright. A live per-request admin lookup is therefore impossible on this surface.
3. **The real gap is exactly as suspected in substance:** `create`/`universal` scope only proves a licensed user, not an admin, and `createCanvas` had no admin check — neither in the web trigger nor in the dashboard resolver.

**Fix (D21):** resolve admin at **issuance** (resolver context, `userAccess.isAdmin` with an `ADMINISTER` fallback), persist `isAdmin` on the canvas/user token record, and copy it into every session JWT. Guest records are `isAdmin: false`; a missing claim is treated as false (fail closed). The web trigger then enforces `requireAdminClaims(claims)` **before** business logic, and the dashboard resolver uses `requireAdmin(context)`, so the check cannot be bypassed by switching surfaces. `CONTRACTS §2.2/§3.9/§4.0` and `TEST_PLAN §2.20` (cases 10–13) were updated.

**Operational consequence:** admin status is a point-in-time claim. Tokens minted before D21 carry no claim, so an admin must re-issue their bookmarklet once (dashboard → "Get JiraTack Bookmarklet") before canvas creation works; a demotion takes effect at next issuance or session expiry (≤8 h). This is the same staleness trade-off as D9/D11 and is recorded in D21 rather than left implicit.

**Scope note:** `createCanvas` is the only config-mutating action exposed through the web trigger. Token listing/revocation and installation/project config are resolver-only and were already gated in Stage 1 (§8).

### 9.6 Delivery under host-page CSP — finding 13 (D22)

**Why it is a security-review item.** The bookmarklet's client code arrives as `<script src="{sdkUrl}?v=…">` injected into a third-party page, so the load is adjudicated by that page's `script-src`, not by anything the app controls. Two consequences: a supported workflow silently fails on a class of sites, and the failure was invisible to the user, which makes it indistinguishable from "JiraTack is broken".

**Method and its limitation.** Measured on 2026-10-29/30 in Chromium against live sites by injecting the real deployed SDK web trigger URL as a `<script src>` and reading `onload`/`onerror` plus the console CSP violation. A real bookmarklet *click* cannot be automated; the harness runs the bootstrap body in the page, which exercises the CSP-sensitive step faithfully. No test showed the bootstrap itself being blocked, so every observed failure was downstream of the click.

**Matrix.**

| Site | CSP shape | External SDK | Console violation |
| --- | --- | --- | --- |
| github.com | `script-src <assets> 'sha256-…'`, `default-src 'none'` | **Blocked** | `violates … "script-src github.githubassets.com 'sha256-…'"` |
| accounts.google.com | `script-src 'nonce-…' 'unsafe-inline'` + Trusted Types | **Blocked twice** | `Failed to set the 'src' property … requires 'TrustedScriptURL'`; then a nonce-policy violation |
| developer.mozilla.org | `script-src 'self' …` | **Blocked** | `violates … "script-src-elem 'report-sample' 'self' …"` |
| en.wikipedia.org | `script-src … 'self' …` | **Blocked** | `violates … "script-src '"` |
| www.reddit.com | no CSP header on the document (curl showed one) | Loaded | none — recorded as **inconclusive**, not a nonce pass |
| login.salesforce.com | `frame-ancestors` only | Loaded | none |
| www.shopify.com, example.com | none | Loaded | none |
| www.theguardian.com | `script-src https: 'unsafe-inline'` | Loaded | none |
| www.w3.org | `frame-ancestors` only | Loaded | none |

Gymshark and Webflow could not be reached from the test network (`ERR_TUNNEL_CONNECTION_FAILED`); theguardian.com and shopify.com served as substitutes.

**Fallback probes (decisive, and the reason there is no cheap workaround).**

| Probe | github.com | developer.mozilla.org | example.com |
| --- | --- | --- | --- |
| Injected **inline** `<script>` (the "inline the SDK" route) | Blocked | Blocked | Runs |
| **Iframe** to the web trigger origin | Blocked by `frame-src` **and** `X-Frame-Options: deny` | Blocked by `frame-src` | `Refused to display … 'X-Frame-Options' to 'deny'` |

**Taxonomy.**

- (c) external script blocked by `script-src` — the dominant case; detectable via `onerror` in every measurement.
- (e) Trusted Types — `s.src` throws synchronously *before* CSP applies; detectable with `try/catch`.
- (b) inline script blocked — confirmed on GitHub/MDN; relevant only to the rejected inline fallback.
- (e) framing — the web trigger forbids framing, so the iframe fallback fails even without CSP.
- (a) `javascript:` URL blocked — not observed and not faithfully testable here.
- (d) mixed content — not observed; all endpoints are HTTPS.

**Remediation.** Two parts, one shipped and one decided.

1. **Shipped (commit `027d590`).** The bootstrap now detects `onerror`, a synchronous Trusted Types throw, a loaded-but-uninitialised script, and a 15-second timeout; it replaces the spinner with a dismissable card naming the reason and logs a `[JiraTack] …` line. Bookmarklet length grew from ~1,850 to ~3,500 characters.

   Verified against a page served with `script-src 'unsafe-inline' https://blocked.invalid`: the card appeared with the CSP reason, Dismiss removed both the card and the injected style, and no overlay was created. On a CSP-free page the SDK loaded and `__jiratackInit` ran. Live-site automation cannot click a bookmarklet, which is why the synthetic CSP page is the verification vehicle.

2. **Decided (D22).** The content-script extension is the only channel that covers the strict sites: an isolated world is not subject to the page's `script-src`, and MV3 permits bundling the SDK (remote code is forbidden). Inline-SDK, iframe, and hybrid approaches are rejected on the measurements above, not on preference.

**Residual risk while the extension is unbuilt.**

- GitHub-class sites remain unsupported. The message explains the failure; it does not provide coverage.
- A demo on such a site still fails, now loudly. Pick a permissive staging page or a customer site without `script-src`, or have the site's owner allowlist the web trigger origin.
- Enterprise extension allowlists and Firefox's different content-script semantics are unresolved until there is an extension to test.
- Tokens are still embedded in bookmark URLs, so the §1.2 secret-in-history exposure is unchanged by this work.

**Reproduction.** Point a tab at a page whose CSP allows inline but not the SDK origin, run the bootstrap body from `buildBookmarklet()`, and assert `#jiratack-bootstrap-loading` contains "JiraTack could not start here". On a live strict site, the same assertion holds after clicking a real bookmarklet. `TEST_PLAN §3.12` carries the manual cases.
