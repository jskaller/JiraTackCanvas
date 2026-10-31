# DECISIONS.md

Single decision log for JiraTack. Every open and resolved decision appears exactly once, with an ID, status, resolution, and where it applies.

**Precedence:** Where SPEC.md, CONTRACTS.md, or BUILD_PLAN.md mention a decision, this document is authoritative. Amend this file first when a decision changes, then update downstream references in a follow-up commit.

---

## Resolved

### D8 — Canvas-token-in-bookmarklet auth model

**Status:** Resolved (2026-10-22)
**Resolution:** Two-token model. Canvas token (30-day TTL, embedded in bookmarklet URL, carries scope). Session JWT (8-hour TTL, HS256, stored in `sessionStorage`). Two scopes: `create` and `view`.
**Rejected alternatives:** Popup-based re-auth every session; opaque session tokens requiring KVS lookup per call.
**Applies to:** SPEC §5, ARCHITECTURE §3–§4, CONTRACTS §2, CONTRACTS §3.

### D9 — Pin visibility and canvas permission model

**Status:** Resolved (2026-10-23)
**Superseded in part by D18:** the custom-field index and the description-marker recovery described below no longer exist. Pin data now lives in `com.jiratack.metadata` and the `jiratack` label, and there is no recovery path. The permission model in this decision — `permittedProjects` in the JWT and the `viewPermissionMode` setting — remains current.
**Resolution:** Three-part solution.

1. **Permission list embedded in JWT.** At token issuance, the resolver queries the viewer's browse-accessible projects via `asUser().requestJira('/rest/api/3/project/search?action=browse&maxResults=100')`. The list (or `"*"` if the viewer has 100+ projects) is embedded in the JWT as `permittedProjects`. At request time, `getPinsForCanvasAndUrl` filters pins by comparing each pin's project against `permittedProjects`. No permission check at webtrigger time — the check happened once at issuance.

2. **Global admin setting `viewPermissionMode`** controls behavior: `per_user_projects` (default) uses the permission-list mechanism above; `open` sets `permittedProjects: "*"` for all viewers, so anyone with a bookmarklet sees all pins in the canvas regardless of project access. `open` is for the rare case where a canvas must be reviewable by someone without Jira project access (external stakeholder, agency, etc.).

3. **Hybrid pin storage with recovery.** The four custom fields (`JiraTack Canvas`, `Page URL`, `Pin Position`, `Pinned Selector`) remain the primary query index — the overlay, dashboard, and all JQL queries read from them. Additionally, every ticket's description receives an ADF marker paragraph containing a JSON blob with the same four values. If a project move drops the custom fields (team-managed targets, or company-managed targets with unmapped screens), the description marker survives. The admin can run `recoverPinsFromDescriptions` on demand to repopulate the fields from the marker.

**Moved-ticket behavior (restricted mode, `per_user_projects`):** A ticket moved from Project A to Project B stays in the canvas. Viewers with BROWSE on B (regardless of A) continue to see the pin. Viewers without BROWSE on B stop seeing it. No phantom canvases, no re-pinning, no orphaned pins — unless the fields were dropped by Jira on move, in which case the description marker preserves the data until recovery runs.

**Documented limitations:**

- Issue-level security (specific issues hidden within an accessible project) is not filterable at webtrigger time. Pins for such issues are visible to viewers with project access. Rare; documented.
- If the viewer gains project access mid-session (JWT ≤ 8h), their `permittedProjects` claim is stale until JWT refresh.
- If a user edits or deletes the description marker, recovery cannot repopulate that ticket's fields.

**Rejected alternatives:** Per-request KVS permission lookup (contradicts D11, adds latency); single-project canvas binding with moved pins leaving the canvas (breaks continuity); auto-creating canvases on move (produces phantom clutter, no clear audience for the new canvas's permissions).

**Applies to:** SPEC §5.2, §9, §11, §18, CONTRACTS §1.2, §2.2, §3.2, §3.3, §4.1, §4.6, §8.4, §10.1, BUILD_PLAN §4, §5, §6, §9.

### D11 — Revocation lag on `createIssue`

**Status:** Resolved (2026-10-23)
**Resolution:** Accept 8-hour lag. `createIssue` and other write actions validate the JWT scope and signature but do not re-check the canvas-token record. Revocation is effective within one JWT lifetime (≤8h). "Regenerate bookmarklet" revokes the old token for new exchanges but does not invalidate live JWTs.
**Mitigation:** Admin UI documents the lag. v1.1 can add per-call KVS check on write actions if customer demand requires.
**Rejected alternative:** Per-call KVS read. Requires KVS schema change to expose token ID in JWT, adds cost and latency.
**Correction (2026-10-31):** the `must_be_missing` compare-and-set named above was **not** in force. The current `@forge/kvs` API exposes `keyPolicy: 'FAIL_IF_EXISTS'`, not the older `{ version: { type: 'must_be_missing' } }` shape, so the call silently degraded to a plain overwrite. The signing secret now uses `keyPolicy` (`src/lib/kvs.js`), and the audit found no other call site relying on the wrong option.
**Applies to:** SPEC §5.5, §18, CONTRACTS §3.3.

### D15 — Inline editing scope and guest edit rights

**Status:** Resolved (2026-10-27)
**Amended by D18:** the description marker no longer exists; description edits preserve the `[JiraTack…]` header, the console block, and the page footer instead of a marker paragraph. Everything else below stands.
**Resolution:** Card inline editing covers status, priority, assignee, summary, and description. Summary edits keep the `[JiraTack]` prefix (idempotent re-add). Description edits replace only the user-authored body; the server preserves the `[JiraTack…]` header, console block, and page footer verbatim. Guest links (`guest_create`) may edit existing pins on their permitted canvases with the same field set; guest assignee targets must be licensed JiraTack users. All `updateIssue`/`getTransitions` calls first verify the issue carries the `jiratack` label and passes `canAccessProject` + `canAccessCanvas` for every scope. Post-create, the SDK silently refetches the canvas once (single retry) and merges the new key's full pin record in place, with no list rebuild; a pending hydration is cancelled if the user edits that card first.
**Rejected alternatives:** Full-ADF replacement from the client (a bug could wipe the pin marker); summary/description read-only with "Edit in Jira" (weaker loop); guests create-only (rejected per user request).
**Applies to:** SPEC §15, CONTRACTS §3.4, §3.5, §3.6.

### D16 — Runs on Atlassian eligibility

**Status:** Resolved (2026-10-27)
**Resolution:** The app is intentionally not Runs-on-Atlassian eligible. The unused `external.fetch.backend` egress declaration (`*.atlassian.net`) was removed from the manifest since the backend makes no external fetch calls. The three webtrigger modules stay `type: dynamic` because the product requires per-request dynamic responses (pin JSON, session JWTs, SDK bundle, installer page); static webtriggers only return manifest-declared fixed bodies and cannot serve these. No further action; the badge only matters for a future Marketplace listing.
**Rejected alternatives:** Migrating to static webtriggers (breaks the bookmarklet API/SDK/installer architecture and all existing bookmark URLs).
**Applies to:** CONTRACTS §10.1.

### D17 — Dual layout modes (push vs fit)

**Status:** Resolved (2026-10-27)
**Resolution:** The sidebar (320px) offers two layout modes with a switch in its own row (default Actual size, choice persisted in `sessionStorage`). Actual size (push) keeps 1:1 text via the `<html>` margin + fixed-element shifter, minus the `overflow-x` rule and with an incremental-only observer — used on pages that reflow cleanly. Fit page scales `<body>` with `transform: scale((viewport − 320) / viewport)` (origin top-left, floor 0.5, else falls back to push), mounts the overlay on `<html>` so the sidebar stays 1:1 and viewport-fixed, and applies a negative `margin-bottom` of `scrollHeight × (1 − scale)` so the document scroll area matches the visually scaled content (transform scales visuals but not layout, which otherwise leaves empty space at the bottom). The narrower sidebar (360→320) reduces how much Fit has to shrink text. `zoom` was rejected because it reflows but leaves viewport-anchored rigid headers under the sidebar.
**Rejected alternatives:** Single-mode push (leaves rigid pages like the Montefiore header covered); single-mode scale (forces small text on everyone); per-site CSS overrides (fragile, un-universal); `zoom` (moves nothing that is ICB-anchored); `overflow-x: clip` on the root (forces the other axis to `clip`, killing vertical scroll).
**Applies to:** SPEC §6.4, TEST_PLAN §7.17.

### D18 — Issue-property metadata, ADF descriptions, additive labels

**Status:** Resolved (2026-10-28)
**Amended by D27:** the property gained an optional `bindingId` field linking a guest ticket to its reviewer binding. D27 also authorises a one-off deterministic backfill, which is narrower than this decision's "no backfill" rule.
**Resolution:** Machine-readable pin data lives in the Jira issue property `com.jiratack.metadata` (`{ guest?, pin: { canvas, url, position, selector }, version: 1 }`). Descriptions are human-readable ADF only: a bold `[JiraTack Guest: Name]`/`[JiraTack]` header, the user body, an optional console-output code block, and a footer link to the page. Every ticket gets the `jiratack` label; guest tickets also get `jiratack-guest`, so all existing `labels = "jiratack"` queries keep working. Reads use the enhanced search `properties` request parameter and filter canvas/url in memory. Custom-field provisioning, the description marker, recovery, and all migration/regex logic are removed (dev-only; no backfill, so pre-existing dev tickets without the property no longer appear). The issue panel reads the property and renders guest identity, pin data, and the screenshot (resolver returns a base64 data URL).
**Rejected alternatives:** Keeping the marker as a recovery backup (unnecessary once the property is authoritative); custom fields for JQL (dropped in favour of in-memory filtering); lazy regex migration (removed per the dev-only decision); exclusive `jiratack-guest` label (would break every read query).
**Applies to:** SPEC §4, ARCHITECTURE §2, CONTRACTS §3.2, §3.3, §3.5, §4.6, §7.6, §8.4; AGENTS.md; TEST_PLAN §7.19. Canvas-exact JQL (dashboard "Review All Tickets") is enabled by a `jira:entityProperty` module indexing `com.jiratack.metadata.pin.canvas` as the `jiratackCanvas` search alias.

### D19 — Per-operation authorisation (security review remediation)

**Status:** Resolved (2026-10-28)
**Amended by D21:** `createCanvas` is **admin-only**, not seat-licensed. D21 closed the gap where it appeared in the seat-licensed list below; the resolver uses `requireAdmin` and the web trigger uses `requireAdminClaims`.
**Amended by D26:** newly minted guest tokens now live 72 hours, not 365 days. Existing records keep their original expiry; see D26 for the grandfathering rule.
**Resolution:** Because `jira:globalPage` and the project-settings page are open to every logged-in site user, hiding a control is not authorisation — every privileged resolver now enforces `requireAdmin(context)` server-side (`src/lib/access.js`, which prefers `context.userAccess.isAdmin` and falls back to an `ADMINISTER` permission lookup). Admin-only: `get/setInstallationConfig`, `get/setProjectConfig`, `list/revokeCanvasToken`, `delete/archiveCanvas`, `createCanvas`. **Seat-licensed** (any user holding a JiraTack seat): `generateCanvasToken`, `generateUserToken`, `generateGuestToken`, `dashboardAggregate`, panel reads. Guest-link minting is deliberately seat-gated, not admin-gated: it is the product's core sharing flow, and the seat is the authorisation boundary. Accepted trade-off: a guest link carries the **issuer's** browse access for the selected canvases, so a seat holder can hand an external reviewer visibility into projects that holder can see — mitigated by canvas scoping and a 365-day expiry, and recorded here rather than left implicit. Token listings return a non-reversible `tokenRef` (SHA-256 prefix) instead of the raw token. `installationConfig` reads now distinguish "not provisioned yet" (defaults) from "unreadable" (throws), so a KVS blip can no longer be persisted back as a default config; writes go through `mutateInstallationConfig` (read and write in one narrow window, with retries) rather than a client round-trip. The signing secret is created with a `must_be_missing` compare-and-set so concurrent cold starts cannot orphan each other's JWTs.
**Rejected alternatives:** Page-level Forge `access` scopes as the only control (the dashboard is legitimately a licensed-user surface, not an admin surface — scopes alone would break it); keeping canvas creation admin-only (it is additive and Jira already enforces project create permission); making guest-link minting admin-only (rejected by the app owner — it would block the everyday stakeholder-sharing flow); per-project admin checks for project settings (deferred: project settings stay site-admin-gated for now).
**Known limitation:** revocation is still eventual — a deleted token record blocks new exchanges but a live session JWT remains valid until `exp` (8 h). Mitigated by the SDK auto re-exchanging on `TOKEN_EXPIRED`/`TOKEN_INVALID`; true instant revocation needs a per-request session allowlist (KVS read per call), deferred with D11.
**Applies to:** SPEC §11, CONTRACTS §4.0, §4.5b, §4.5c, §3.2, §3.3; TEST_PLAN §2.20.

### D20 — Screenshot transport and URL-scheme allowlist

**Status:** Resolved (2026-10-29)
**Resolution:** Screenshots no longer transit the web trigger as one base64 field. The client keeps the existing 800px webp capture, then uploads base64 chunks (≤200 KiB each) via `beginScreenshotUpload` + `uploadScreenshotChunk`; the app stores them in KVS under a random `uploadId` bound to the JWT subject with a 15-minute TTL. `createIssue` receives only `screenshotUploadId`, assembles the chunks, attaches to Jira, and deletes them. Rationale: the web-trigger body ceiling is community-measured at ~5 MiB and undocumented, while a KVS value is capped at 240 KiB — a single payload is therefore both risky and unstoreable. Separately, every stored or user-supplied URL that reaches an `href` or `location.href` is validated to `http(s)` by `src/shared/safeUrl.js`, and `createIssue` rejects non-http(s) URLs; this closes a stored-XSS vector where a crafted pin URL could execute via a `javascript:` scheme in the Jira dashboard or the host page.
**Rejected alternatives:** Pre-signed upload URLs (Forge exposes none to third-party browser clients); writing directly to Forge Storage from the page (backend-only); client-side size capping alone (still one oversized request; no identifier seam for the extension).
**Known limitations:** bytes still transit Forge, in small pieces; chunk upload is sequential; the ~5 MiB ceiling is community-measured rather than documented; uploads abandoned by the client rely on TTL cleanup.
**Applies to:** SPEC §7.6, §12.1, CONTRACTS §3.3, §3.3b; TEST_PLAN §2.21.

### D21 — Admin enforcement in web triggers via an issuance-bound claim

**Status:** Resolved (2026-10-29)
**Resolution:** A web trigger has no user identity, so `api.asUser()` cannot be used there (an explicit AGENTS.md constraint) and a live `ADMINISTER` lookup is impossible. Admin-dependent web-trigger actions therefore enforce an `isAdmin` claim that is resolved at token issuance in resolver context (`userAccess.isAdmin`, falling back to `mypermissions?permissions=ADMINISTER`), persisted in the token record, and copied into every session JWT for canvas/user tokens; guest tokens are always `false`. `createCanvas` is admin-only in both the web trigger (`requireAdminClaims`, before business logic) and the dashboard resolver (`requireAdmin`), closing the gap where `create`/`universal` scope was mistaken for admin rights. Missing claim ⇒ treated as non-admin (fail closed).
**Rejected alternatives:** Calling `asUser()` from the web trigger (impossible — no user identity, and forbidden); a per-request KVS admin allowlist keyed by `sub` (still cannot distinguish a legitimate admin from a token holder, and adds a read per call); leaving the resolver path open (would make the web-trigger check bypassable).
**Known limitations:** Admin status is a point-in-time claim, so a demotion takes effect only on the next token issuance or session expiry (≤8 h, consistent with D9/D11). Tokens issued before this decision carry no claim and cannot create canvases until re-issued.
**Applies to:** SPEC §7.2, §11, CONTRACTS §2.2, §3.9, §4.0; TEST_PLAN §2.20.

### D22 — Delivery channel under host-page CSP

**Status:** Resolved (2026-10-30)
**Resolution:** Measured on 2026-10-29/30 in Chromium against live sites by injecting the real deployed SDK web trigger as a `<script src>`. The bookmarklet remains the shipped, no-install client. Strict-CSP sites block the external SDK: `github.com`, `developer.mozilla.org`, `en.wikipedia.org` and `accounts.google.com` (the last also blocks earlier, on Trusted Types, because its policy requires `TrustedScriptURL`). Permissive sites load normally: `example.com`, `www.shopify.com`, `login.salesforce.com`, `www.theguardian.com`, `www.w3.org`. At the time of measurement the failure was silent; the bootstrap now detects `onerror`, a synchronous Trusted Types throw, a loaded-but-uninitialised script, and a 15-second timeout, and shows the user a reason instead of a vanishing spinner.

A content-script browser extension is adopted as the CSP-resilient channel. Content scripts run in an isolated world and are not subject to the page's `script-src`; overlay DOM and `fetch` to the web trigger are governed by the extension's own policy and `host_permissions`. The bookmarklet is retained for the licensed-user flow and for sites that permit it.

**Rejected alternatives:** Inlining the whole SDK in the bookmarklet (the bundle is 284 KB, far beyond practical `javascript:` URL length; and an injected inline `<script>` was itself blocked on github.com and developer.mozilla.org, so it would not fix the target sites); an iframe popover served from the web trigger (measured blocked twice — `X-Frame-Options: deny` on the web trigger, and `frame-src` on strict sites); a hybrid of the two (inherits both limitations, adds only sites that allow inline but not external scripts); asking customers to add the web trigger origin to `script-src` (requires per-site admin action, unusable for a demo).

**Known limitations:** The extension is not built; this decision records the direction, not shipped code. MV3 forbids remotely hosted code, so the SDK must be bundled into the extension rather than fetched. Enterprise extension allowlists can block installation. Firefox content scripts have different injection semantics. Until the extension ships, strict-CSP sites remain unsupported; the bootstrap explains the failure rather than leaving it silent, but explanation is not coverage.

**Applies to:** ARCHITECTURE.md §11 (delivery constraints of the shipped client), §12 (known constraints); SPEC.md §6.1 (failure behaviour of the shipped bootstrap). SPEC.md and ARCHITECTURE.md otherwise describe shipped code only; the extension plan itself lives in the business alignment document.

### D23 — Page identity: URL normalisation and reviewer-side match modes

**Status:** Resolved (2026-10-30)
**Resolution:** Three parts, because page identity is inferred and inference is sometimes wrong.

1. **Normalisation is three steps, in order.** (a) Canonicalise: lowercase scheme and host, drop the fragment, drop `jiratack_ticket`/`jiratack_canvas`, strip a trailing slash on a non-root path, sort query parameters. (b) Drop noise: `utm_*` and named trackers (`fbclid`, `gclid`, `msclkid`, `ttclid`, `twclid`, `li_fat_id`, `igshid`, `mc_cid`, `mc_eid`, `_hsenc`, `_hsmi`, `ref`, …); cache-busters (`t`, `ts`, `timestamp`, `cb`, `cachebust`, `nocache`, `rnd`, `random`) when their value is numeric or random-looking; version stamps (`v`, `ver`, `version`) when the value is semver or hash-shaped; and any otherwise-unnamed parameter whose value is a UUID, a 32/40/64-char hex digest, a 10–13 digit epoch, or ≥16 chars of mixed alphanumerics. (c) A **keep-list** overrides (b) by name: `id`, `page`, `q`, `query`, `search`, `filter`, `sort`, `view`, `tab`, `lang`, `locale`, `sku`, `product`, `slug`, `path`, `file`, `doc`, `issue`, `key`, `project`. Without it, `?sku=ABC123456789012345` would be dropped and two products would merge.

   This replaces the previous behaviour of clearing the whole query string, which collapsed every query-addressed page onto one pin set.

2. **Pins store the canonical URL as captured**, query intact, not a lossy normalised form. Identity is derived at read time, so a wrong inference can be corrected without the information having been destroyed. Pins created before this decision lost their query and cannot be recovered; Smart and Whole page still work on them, Exact under-matches. Accepted: pre-launch, no backfill.

3. **The reviewer chooses the match mode; the filer is not asked.** The sidebar's Current Page filter gains `Smart` (heuristic), `Exact` (same query parameters), and `Whole page` (path only), each labelled with the number of pins it would show. The row appears only when the three counts differ — which is never on a URL without a query string — and a rescue button appears in the empty state when a wider mode would reveal pins.

**Rejected alternatives:** A page-match selector in the new-ticket form (puts a query-string decision on the person filing, who cannot know how reviewers will browse, and leaks an implementation concern into the capture flow); per-site or per-origin normalisation rules (invisible inherited state, and the rule belongs to the page, not the installation); a read-time toggle without storing the query (cannot fix a merge after capture, because both pins would share the same stripped URL); keeping the old path-only identity (silently merges every query-addressed page); storing both raw and normalised URLs (redundant once canonical storage is the source and identity is derived).

**Known limitations:** The heuristic can still merge an unnamed parameter with a short meaningful value, and can still split on a random-looking value under a keep-listed name. `Exact` cannot recover a query that was never stored (pre-D23 pins). Counts are computed from the fetched pin set, so a canvas past the 2,000-ticket scan cap may report low counts along with `truncated`.

**Applies to:** SPEC.md §12.1, §10.2, §19; CONTRACTS.md §1.1, §3.2, §6; TEST_PLAN §2.1, §3.13.

### D24 — External reviewer binding model

**Status:** Resolved (2026-10-31).
**Resolution:** An external reviewer is identified by email, claimed at the first pin and accepted **unverified** (`AD A-05`, `PR-03`). A binding is one record per unique reviewer per installation, keyed **globally**:

```text
bindings:<HMAC-SHA256(bindingSecret, normalise(email))>
```

`bindingSecret` is a dedicated, **non-rotating** secret (see D28/S9) — not `sessionSigningSecret`. KVS is already per-installation, so `installationId` is deliberately absent from the key. `normalise(email)` = trim + lowercase; `+tags` are **not** stripped, because two addresses that differ are two reviewers under `PR-03`.

Record: `bindingId` (the HMAC hex), `email` (plaintext, for the admin slot screen per `A-14`), `state` (`issued` | `active` | `revoked`, per `A-08`), `issuedBy` (delegator accountId), `canvasAccess[]`, `firstPinAt`, `lastPinAt`, `pinCount`, `monthKey`, `monthPinCount`, `createdAt`, `revokedAt`, `revokedBy`.

**Identity timing.** A binding is created **lazily at the first pin**, not at link open, because email does not exist before then (`PR-09`). The record is written as `issued` and flips to `active` when the ticket creation succeeds; a failed write leaves it `issued` for reconciliation. Capacity is enforced at first pin.

**Two independent meters, stated once so they cannot be conflated:**

1. **Reviewer slot** — a distinct binding that submitted ≥1 pin in the current billing month (`PR-03`). Governs how many external reviewers an installation may onboard. Consumed at first pin, stays consumed for the month even if the credential is revoked (`PR-11`); inactive bindings drop off at the month boundary (`PR-12`).
2. **Pairing** — a credential minted from an invite token (S2). Capped at **5 per invite token** (`A-20`), reset only when the delegator regenerates the link. Not the same counter as reviewer slots, and revoking a pairing does **not** restore pairing capacity.

**Conflict resolved:** the build prompt proposed deriving `pairingCount` from non-revoked children, decrementing on revocation. `AD A-20` is authoritative and says the cap resets only on regeneration, so pairing count is a **stored, monotonic counter per invite token**. This is recorded here rather than silently implemented either way.

**Rejected alternative (this pass):** a derived count — `count(non-revoked credentialsByParent)` — with revocation freeing a pairing slot. Rejected because it contradicts `A-20` and the "consumed stays consumed" spirit of `PR-11`. It is cheap to adopt later: S2 builds the reverse index anyway, so the derived count is one read away if usability feedback asks for it, and only the read path would change.

**Rejected alternatives:** magic-link or OTP verification before first pin (breaks `A-05` and the `A-13` one-sentence test); admin-promoted bindings (same break, plus manual load); per-canvas binding records (a reviewer across three canvases would fragment into three identities and three slots).

**Applies to:** S1, S2, S5, A (binding record), admin slot screen; `AD P-03`, `PR-03`, `PR-09`, `PR-11`, `PR-12`, `A-05`, `A-08`, `A-13`, `A-20`, `A-21`, `A-23`.

### D25 — Capacity and metering model

**Status:** Resolved (2026-10-31).
**Resolution:** Two meters, only one of which is new.

- **Forge seat** (existing, D19): gates who may mint a token. Unchanged.
- **Reviewer slot** (new, app-level): gates how many external reviewers an installation may onboard. Tier limits are locked (`AD PR-05`): Starter 5 reviewers / 50 pins per month; Team 25 / 500; Business 100 / 2,000.

**Metering scope is guest activity only.** Licensed users already consume a Forge seat and delegators are unlimited on all tiers (`PR-06`); counting their pins again would bill the same person twice. `pinCount` on a binding therefore counts that reviewer's tickets, and the tier's pin budget sums bindings, not all tickets.

**Billing month** is the UTC calendar month. `AD` does not define the boundary; this is an implementation choice, recorded so it is not rediscovered later.

Slot semantics: consumed at first pin (`PR-09`); stays consumed for the month even if revoked (`PR-11`); inactive reviewers drop off at the next boundary (`PR-12`); no hard wall — upgrade or top-up (`PR-08`); an active credential is never blocked mid-month (`PR-10`).

**This pass registers but does not enforce capacity.** `CAPACITY_EXCEEDED` (409) is added to the error registry and the binding carries `monthKey`/`monthPinCount`; the enforcement check itself lands with the capacity sprint. `PAIRING_LIMIT` (409) **is** enforced now.

**Rejected alternatives:** enforcing at invite redemption (`PR-09` corrects this — email does not exist yet); counting all pins rather than guest pins (double-billing); deriving slots from live credentials (would allow revoke-and-recycle, which `PR-11` exists to prevent).

**Applies to:** S1, S2, S5; admin slot screen; `CONTRACTS.md` §2; `AD PR-01`–`PR-12`.

### D26 — Guest invite TTL: 365 days → 72 hours

**Status:** Resolved (2026-10-31).
**Resolution:** Newly minted guest tokens live **72 hours** (`AD A-03` "24–72h"; `TD §8(a)`). This amends D19's recorded compensating control, which named "canvas scoping and a 365-day expiry".

**Existing tokens are not rewritten.** The old guest namespace is frozen read-only (S3): records already issued keep their original `expiresAt` and expire on their original schedule; nothing is silently shortened mid-review, and no new 365-day token is minted after cutover. The policy boundary is therefore visible: tokens minted before the cutover keep their TTL, tokens minted after get 72 h.

**Justification:** the token appears in the installer URL (browser history, platform access logs, link-preview fetchers) and in the bookmarklet; both are forwardable. 72 hours bounds the forwarding window without breaking the demo or a single review session.

**Cost:** a returning reviewer needs a re-issued link after 72 hours. The self-healing path is delegator regeneration (`A-17`); the installer must say so instead of producing a dead bookmarklet.

**Signing the bootstrap token: considered and rejected for the bookmarklet era.** `TD §5` is right that the token is already 256-bit random, so signing buys hygiene rather than security: malformed-token rejection is replaced by rate limiting (`A-18`), tamper detection is already provided by the KVS lookup, and the versioning benefit can be introduced when the credential format changes anyway. Against that it would add ~80 characters to a 3,500-character bookmarklet, an indefinite dual-read, and a third secret to manage. The end state is unchanged: the extension era introduces a signed, versioned credential format from the start, where no dual-read is needed.

**Rejected alternatives:** rewriting existing TTLs to `min(remaining, 72h)` (silently kills links already in circulation mid-review); preserving 365 days (defeats the control); shortening the session JWT instead (already 8 h; does not bound forwarding); signing the bootstrap now (see above).

**Applies to:** D19 (amended), `CONTRACTS.md`, installer copy, `TEST_PLAN`; `AD A-03`, `A-17`; `TD §4`, `§8(a)`.

### D27 — `bindingId` in `com.jiratack.metadata`

**Status:** Resolved (2026-10-31).
**Resolution:** Extend D18's property with one **additive, optional** string field:

```json
{ "bindingId": "<hex>", "guest": { "name": "...", "email": "..." }, "pin": { … }, "version": 1 }
```

`bindingId = HMAC-SHA256(bindingSecret, normalise(email))` hex — the same value used as the binding key (D24), so it is deterministic and backfill is exact rather than a fuzzy match on free text. `version` stays `1`: readers must treat `bindingId` as optional, and absence means "legacy ticket, pre-binding".

**`normalizeMetadata` applies on read and write.** `src/lib/metadata.js` reconstructs the object from known keys; an unknown key is dropped on write *and* invisible on read. `bindingId` must be added to that reconstruction, with an acceptance test that writes it and reads it back through `metadataFromIssue` — inspecting only the write payload would miss the read-side drop.

**Backfill is permitted and exact:** map every ticket with `guest.email` to its `bindingId`. This amends D18's "no backfill" — that decision concerned a removed feature with no source data; this is an added field with a deterministic derivation. Backfill runs with a dry-run mode and is idempotent.

**Rejected alternatives:** a Jira custom field (forbidden by D18); storing the email hash only in the binding and joining at read time (depends on a live binding, breaks for revoked/tombstoned reviewers and for the "pins this month" screen); deriving from `sessionSigningSecret` (that secret is rotatable — rotation would orphan every binding and every backfilled ticket).

**Applies to:** S5, A; `src/lib/metadata.js`, `src/webtrigger/actions/createIssue.js`; `AD A-23`, `PR-03`.

### D28 — `window.__jiratackInit` contract

**Status:** Resolved (2026-10-31).
**Resolution:** **Accepted risk, documented, with the extension as the target date.** `window.__jiratackInit` stays as the SDK entry point. The exposure is recorded in `TD §2 #3` and in the security review's finding list.

**Why not the alternatives now:**

- **Closure-scoped init** would require the SDK to delegate *all* HTTP through the bootstrap's closure — the host would own session exchange and request attachment, inverting `auth.js`/`api.js`. That is the S7 transport extraction plus an auth rewrite, and cannot land in a seam pass without displacing the blockers.
- **One-time init token** narrows the capture window rather than closing it: the page can still intercept the hook, and the bootstrap needs a pre-SDK exchange subject to the page's `connect-src`. It is the fallback if C2 slips past the current quarter, not the default.

The real boundary is the extension: a content script holds the credential outside the page's world, which is the same argument as D22. Accepted risk is therefore time-bounded to the extension, not indefinite.

**Attack, stated precisely:** the vector is `Object.defineProperty(window, '__jiratackInit', { writable: false, value: fn })`, not a plain pre-assignment — the SDK assigning over a writable property replaces any page hook. This distinction matters because it rules out "detect a pre-existing function" as a mitigation.

**Residual risk:** a hostile page on which a reviewer clicks the bookmarklet can read the long-lived token and outlive the 8-hour session. This is why `A-15`/`SU-02` push diagnostics and trust messaging, and why the extension is the fix rather than a nicer bookmarklet.

**Applies to:** S6, S7; `shared/bookmarklet.js`; `TD §2 #3`, `§6(b)`.

### D13 — SDK version source

**Status:** Resolved (2026-10-23)
**Resolution:** Content hash. `scripts/embed-sdk.js` computes SHA-256 of the minified SDK bundle and truncates to 12 hex characters. Exported from `src/lib/version.js` as `SDK_VERSION`. Embedded in every bookmarklet URL as `?v=<SDK_VERSION>` for cache-busting.
**Implementation:** `npm run build` must regenerate `src/lib/version.js`. Verify in Sprint 1 whether Forge CLI supports pre-deploy build hooks; if not, commit `src/lib/version.js` and `src/lib/sdk-bundle.js`.
**Rejected alternatives:** Git commit hash (imprecise); manual version bumps (discipline-dependent); timestamp (non-deterministic).
**Applies to:** BUILD_PLAN §8.3, CONTRACTS §4.1 and §10.2.

### D14 — Retirement config source in multi-project canvases

**Status:** Resolved (2026-10-23)
**Resolution:** Use the project of the canvas's **first (oldest) ticket** to determine `retirementDays`. Cache the canvas→project mapping in KVS (`canvasProjectCache:<canvasName>` → `{ projectKey, cachedAt }`) with TTL 300s. If the canvas has no tickets, treat as `retirementDays: 0` (default).
**Documented limitation:** If a canvas spans two projects and the oldest ticket is deleted, retirement behavior may change. Rare; acceptable for v1.
**Rejected alternatives:** Per-page first-ticket (inconsistent); max across projects (expensive); installation-level config (schema change; defer).
**Applies to:** CONTRACTS §7.2, BUILD_PLAN §10.2.

### D12 — Runtime version

**Status:** Resolved (2026-10-23)
**Resolution:** `nodejs24.x`. Node 24 is the active LTS (EOL October 2027), is the Forge-recommended runtime for new apps, and was proven working on the prior JiraTack3 build. Node 22 is maintenance LTS (EOL April 2027) — unsuitable for a greenfield product.
**Caveat:** Local Node 24.17.0 and Node 22.23.0 had a transient `forge build`/`lint` undici bug (ECO-1586). Pin local Node to a version before 24.17.0 if it appears; the Forge runtime itself is unaffected.
**Rejected alternative:** `nodejs22.x` — no compatibility advantage, six months shorter support.
**Applies to:** CONTRACTS §10.1, BUILD_PLAN §4.2.

### D10 — Webtrigger URL discovery

**Status:** Resolved (2026-10-25)
**Resolution:** `webTrigger.getUrl('moduleKey')` works from resolvers, so no admin-side discovery or KVS caching is needed. `generateCanvasToken` resolves and returns both `apiUrl` (`jiratack-api`) and `sdkUrl` (`jiratack-sdk`) explicitly; the bookmarklet must not derive one from the other.
**Rejected alternative:** Admin page performs one-time discovery and caches `webtriggerUrls` in KVS.
**Applies to:** CONTRACTS §3.1, §4.1, BUILD_PLAN §8.3.

---

## How to update this file

When a decision is resolved:

1. Move it under `## Resolved` (keep its ID).
2. Change `**Status:** Open` to `**Status:** Resolved (YYYY-MM-DD)`.
3. Add `**Resolution:**` stating the chosen option.
4. Add `**Rejected alternatives:**`.
5. Commit as: `docs: resolve decision D<N>`.
6. Update the downstream document(s) in a separate commit.

When a new decision is identified:

1. Add it under the appropriate `## Open — blocking Sprint N` section.
2. Assign the next unused ID.
3. Commit as: `docs: add decision D<N>`.
