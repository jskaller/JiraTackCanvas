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

A content-script browser extension is adopted as the CSP-resilient channel. Programmatic extension injection is not subject to the page's `script-src`; overlay DOM and `fetch` to the web trigger are governed by the extension's own policy and `host_permissions`. (Amended in D32: the injection targets the page's world, not an isolated one, because shipped behaviour depends on it.) The bookmarklet is retained for the licensed-user flow and for sites that permit it.

**Amended 2026-11-02 — the two CSP stages were conflated.** Re-measured in Chromium by navigating to a `javascript:` URL and by clicking such a link under a controlled policy. CSP decides **two** questions, and D22 recorded only the second:

1. **Can the bookmarklet run at all?** A `javascript:` URL is adjudicated as inline script. Where `script-src` carries a nonce or hash and no effective `'unsafe-inline'`, the browser refuses to run it, so none of our code exists on the page. Verified live: `github.com` and `developer.mozilla.org` log *"Running the JavaScript URL violates the following Content Security Policy directive 'script-src …'"* and nothing executes. The same shape appears on `mail.google.com`, `outlook.office.com`, `app.asana.com`, `linkedin.com`, `x.com`, `stripe.com`, `paypal.com`, `wellsfargo.com`, `discord.com`, `linear.app`, `linear`, `airbnb.com`. For these the extension remains the only channel; that part of D22 stands.
2. **Can the SDK be delivered?** Only asked where (1) passed. `montefioreeinstein.org` runs the bookmarklet but refuses the external `<script src>`; with no `default-src`/`connect-src`, the fallback fetches and inlines the real 290 KB bundle there (verified live 2026-11-02: `__jiratackInit` is a function). `en.wikipedia.org` also runs the bookmarklet, but its `default-src` allowlist governs `fetch` and excludes our origin, so the bundle cannot be obtained at all — inline, `eval` or otherwise.

The original matrix attributed group 2 to "external SDK blocked" without testing group 1, which made GitHub and Wikipedia look like one class. They are two, and only group 2 is fixable by the loader (D31). The sentence below that an injected inline `<script>` "was itself blocked on github.com and developer.mozilla.org" remains true and is the same fact as group 1: those sites block inline script, so neither the fallback nor the bookmarklet itself can run.

**Rejected alternatives:** Inlining the whole SDK in the bookmarklet (the bundle is 284 KB, far beyond practical `javascript:` URL length; and an injected inline `<script>` was itself blocked on github.com and developer.mozilla.org, so it would not fix the target sites); an iframe popover served from the web trigger (measured blocked twice — `X-Frame-Options: deny` on the web trigger, and `frame-src` on strict sites); a hybrid of the two (inherits both limitations, adds only sites that allow inline but not external scripts); asking customers to add the web trigger origin to `script-src` (requires per-site admin action, unusable for a demo). Note: the "hybrid" was dismissed on the assumption that it added few sites; measurement shows it covers Wikipedia, Montefiore and the enterprise-CMS class, which is why it is adopted in D31.

**Known limitations:** ~~The extension is not built~~ — superseded 2026-11-02: the extension shell now exists and is verified in Chrome (D32). The direction recorded here was correct; the earlier framing of the bookmarklet as the primary channel was not. MV3 forbids remotely hosted code, so the SDK is bundled into the extension rather than fetched. Enterprise extension allowlists can block installation. Firefox content scripts have different injection semantics. Strict-CSP sites are now covered by the extension (D32); the bookmarklet alone still cannot reach them, and its bootstrap explains the failure rather than leaving it silent.

**Amended 2026-10-31 — both channels persist.** The bookmarklet is not a migration bridge to be retired. Both channels ship and persist: the extension is preferred where it can be installed and covers multi-origin and strict-CSP sites; the bookmarklet is the channel for users who cannot install anything — non-Chromium browsers, IT-locked machines, reluctant users. Neither depends on the other for coverage.

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
2. **Pairing** — a distinct `(inviteToken, installId)` pair, recorded once per browser profile (`A-20`, `A-21`). Capped at **10 per invite token**, channel-agnostic, reset only when the delegator regenerates the link. Not the same counter as reviewer slots, and revoking a pairing does **not** restore pairing capacity.

**Pairing identity and lifecycle (2026-10-31).**

- `pairingId = SHA-256(inviteToken ‖ installId)`; record key `pairings:<pairingId>`.
- `installId` is **32 lowercase hex characters** (16 random bytes, hex-encoded), generated by the installer and cached at `localStorage['jiratack:installId:<appId>']`. It is not a UUID, and no second format is accepted anywhere.
- The bookmarklet carries `inviteToken.installId` in the existing `canvasToken` field. Empty installId emits the bare invite token — no trailing dot.
- **Legacy = empty string.** A bare invite token (old bookmark, no-JS fallback) uses `installId: ""`, so all legacy bookmarks on one invite share a single `(invite, "")` pairing and consume one cap slot. Phase 2 accepts a 32-hex installId or empty; any other value falls back to empty rather than to an error page.
- **Cap enforced from the index**, not a counter: `pairingIndex:<inviteTokenRef>:<pairingId>` rows are append-only, the count includes revoked rows (monotonic per `A-20`/`PR-11`), and the count is read at pairing time. The small race between count and insert is accepted and recorded: the cap may overrun by the number of concurrent pairings at the boundary. `pairingCount` on the invite record, if present, is advisory only.
- **TTL:** pairing and index rows carry `remaining(invite.expiresAt)` seconds, never shorter than the invite. This prevents indefinite accumulation and prevents the cap reopening if rows were cleaned while the invite still lives.
- `pairingId` is a **JWT claim** (the server's authorization for writing it) and is written into `com.jiratack.metadata` per ticket (the audit join for `A-22`). `bindingId` is per ticket and is **not** carried on the pairing or the JWT.

**Honest framing (also stated in the installer code).** The cap is farmable — clearing localStorage yields a new pairing. A shared bookmarklet is one pairing, so copying it gives unlimited people the same pairing. installId is fragile where reviewers actually work: Safari caps script-writable storage at ~7 days, incognito produces a new one per session, and IT-cleared storage a new one per visit; with a cap of 10 that is an exhaustion path. The no-JS fallback shares the null pairing. Pairing creation is unauthenticated and adds a write-amplification path (up to 10 transactions per invite) — `A-18` rate limiting is the mitigation, out of scope here and recorded as exposure.

**Rejected alternatives:** a client-held credential secret per pairing (superseded — it added rotation and storage cost without changing the trust boundary, since the invite itself is the bearer); deriving the cap from non-revoked rows so revocation frees a slot (contradicts `A-20`/`PR-11`); cookie-based device identity (rejected — cross-origin, and the extension provides real identity when it ships).

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
**Resolution:** Newly minted guest tokens live **72 hours** (`AD A-03` "24–72h"; `TD §8(a)`). This amends D19's recorded compensating control, which named "canvas scoping and a 365-day expiry". The decision is **absolute 72h from mint**; sliding expiry (extending on each successful exchange) was considered and rejected — it weakens the stated control and leaves an unused bookmark keeping the invite alive indefinitely. Revisit only on measured support burden.

New invite records carry `mintedAfterCutover: true`; grandfathered records carry `false` (or are absent). The installer renders the "(72h limit)" parenthetical only when the flag is true, so a legacy 365-day invite never shows a misleading expiry reason.

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

### D29 — Guest invitation lifecycle: named reviewers, sponsorship, reversible controls

**Status:** Resolved (2026-11-02).
**Resolution:** A guest invitation is a **named reviewer**, created by a licensed sponsor, not an anonymous bearer that collects identity later.

**Identity at issuance.** `guestName` and `guestEmail` are required when the sponsor issues the link. The binding (`bindings:<HMAC(email)>`) is created then, in state `issued`; the first successful pin flips it to `active` (the billable event). `createIssue` no longer accepts identity from the client — it resolves it from the signed `pairingId` claim → pairing → invitation, so a guest cannot file under another address.

**Sponsorship.** The invitation records `issuer` (accountId) and `issuedByName` (resolved once at issuance, so lists do not need N user lookups). Guest tickets keep `reporter = issuer` (`P-03`), so sponsor and reviewer are both visible: sponsor on the ticket's reporter, reviewer in the metadata and description header.

**Lifetime.** A pairing lives **until revoked** (`A-20` amended). The 72h `linkExpiresAt` gates only **new devices**; an existing pairing exchanges regardless of link expiry. So the invitation record and its pairings carry **no KVS TTL** — the old TTL deleted the parent at 72h and would have killed every pairing even if policy allowed them to live.

**Four controls, deliberately distinct:**

| Control | Effect | Reversible |
| --- | --- | --- |
| Deactivate | Blocks new exchanges **and guest writes** immediately; pairings and history kept | Yes |
| Activate | Restores both | — |
| New link (regenerate) | Same reviewer/binding, fresh 72h link, pairing cap reset; old invitation tombstoned | — |
| Revoke | Terminal; all pairings invalid; record kept as tombstone | No |

Deactivation is enforced in `createIssue`/`updateIssue` (a state read per guest write), not only at exchange — otherwise a paused reviewer could keep filing for up to the 8h session lifetime.

**Capacity unchanged by these controls.** A deactivated reviewer does not free a slot mid-month (`PR-11`); the list therefore reports `active` (current access) and `consumed` (billable this month) separately. Capacity enforcement itself remains the next decision (see D30 note below).

**Listing.** `listGuestInvites` returns invitations for admins (all) and seat-holding sponsors (their own), with guest, email, sponsor, canvases, status, pairings, pin count, and link expiry. The same union backs the admin page and (later) the delegator view.

**Sponsor contact and identity in the UI.** Jira privacy frequently hides `emailAddress` at issuance, so the sponsor's email and display name are retried on the first guest exchange and persisted to the invitation; the installer and sidebar show the bound guest address so a wrong address is visible before pinning. The invitation stores `issuerEmail` (resolved once at issuance; null when Jira privacy hides it). The installer shows "Invited by <name> (<email>)"; the guest form shows the invited name and email read-only, prefilled from the session; and guest tickets default the assignee to the sponsor. The success screen offers **Email link**, which opens the sponsor's mail client via `mailto:` — Forge has no outbound email surface, so server-side delivery would require an external email service (egress plus a dependency), which is not decided.

**Rejected alternatives:** guest-entered identity in the sidebar (client-supplied identity, spoofable, and it duplicated the sponsor's knowledge); revoke-only with no pause (loses history and re-issues links for temporary situations); pairing expiry tied to the link (makes `A-13`'s "install once" false after 72h); regenerating with a new binding (would double-charge a reviewer slot for the same person).

**Known limitations:** sponsor loss of Jira access does not yet invalidate their invitations (`A-12`, unimplemented); the delegator-facing list is admin-only in this slice; pairing revocation per device is still deferred; and capacity enforcement remains registered-not-enforced until D30.

**Applies to:** `src/lib/invites.js`, `inviteModel.js`, `bindings.js`, `credentialModel.js`/`pairingService.js`, `exchangeToken`, `createIssue`, installer, admin UI; `AD A-03`, `A-17`, `A-20`, `A-22`, `A-23`, `P-03`, `PR-09`, `PR-11`.

### D30 — Capacity enforcement (open)

**Status:** Open — the next decision, not implemented.
**Question:** where tier limits come from (app-level entitlement per `AD B-04`, not the Forge license payload), what counts (`active` vs `consumed` bindings), where it is enforced (pre-create in `createIssue`), and what happens at cap (`PR-08`: no hard wall). `CAPACITY_EXCEEDED` is registered in the error registry and nothing throws it.

### D31 — SDK delivery chain for pages the bookmarklet *can* run on

**Status:** Resolved (2026-11-02)
**Resolution:** Delivering the same result in two ways, chosen at runtime, with no popup, no iframe and no `eval`:

1. **External script** — `{sdkUrl}?v={version}`, revalidated by ETag (5.14). Fastest and cached.
2. **On error, fetch and inline** — `fetch(sdkUrl, { cache: 'no-store', credentials: 'omit' })`, then inject the text as an inline `<script>`. This needs `'unsafe-inline'`, which the bookmarklet **already** needed in order to run at all, and it does **not** need `'unsafe-eval'`. It therefore adds no new requirement and covers strictly more sites than `eval` would, while keeping `eval` out of the product.
3. **Failure names the step** — refused download, blocked inline script, or loaded-but-not-started. The bootstrap no longer infers "CSP" from `onerror`.

**Why this is sufficient for the class it targets.** Measured 2026-11-02 in Chromium against a controlled page shaped like `montefioreeinstein.org` (`script-src 'self' 'unsafe-inline'`, our origin absent): the external script is blocked and logged as a violation, the cross-origin `fetch` succeeds, the inline injection executes, and `__jiratackInit` runs. Executed end-to-end against the real bootstrap: `INIT:canvas-1`, no error card. The web trigger now returns `Access-Control-Allow-Origin: *` and `Access-Control-Expose-Headers: ETag`; without CORS the fallback fails on exactly the sites it exists for.

**Screenshots, in-page UI, and no popup.** The fallback runs in the page's own context, so html2canvas and the overlay are unaffected. Nothing moves to a second window, and no `window.open` is attempted.

**Rejected alternatives:**
- `fetch` + `eval` — needs `'unsafe-eval'`, which the inline path does not, and puts `eval` in the shipped product. Strictly worse for the same coverage.
- Inlining the whole bundle in the `javascript:` URL — the bundle is 290 KB. Firefox caps bookmark URLs at roughly 64 KB and Firefox blocks `javascript:` URLs under CSP outright (Bugzilla 866522, still open), so this is not portable and cannot be the primary path.
- Companion window on our origin — rejected by product: no screenshots, and a second window the reviewer cannot see in play. Popup blockers make it unreliable.
- iframe popover from the web trigger — `X-Frame-Options` on the trigger and `frame-src` on strict sites; also inherits the parent's CSP for `srcdoc`.
- Asking each customer to allowlist the web trigger origin — per-site admin work, impossible for a hospital or an enterprise demo.

**Known limitations:**
- **Nonce/hash `script-src` sites remain unreachable.** The bookmarklet is itself inline script; verified live that `github.com` and `developer.mozilla.org` refuse it with *"Running the JavaScript URL violates … script-src"* before any of our code exists. Only the extension (D22) covers them.
- **`connect-src` locked to third-party hosts** defeats the fetch while allowing inline: the code has nowhere to come from except the URL (e.g. `epic.com`).
- **Trusted Types** requiring `TrustedScript` defeats `script.textContent`; the bootstrap catches the throw and reports it.
- The bootstrap lives in the bookmark URL, so **this change requires one re-drag**. Once dragged, SDK changes continue to arrive by revalidation.
- Coverage numbers are a sample of 68 public sites, not a guarantee per customer.

**Applies to:** SPEC.md §6.1; CONTRACTS.md §5.1a, §5.1b; ARCHITECTURE.md §11; `src/shared/bookmarklet.js`, `src/webtrigger/sdk.js`.

### D32 — Browser extension as the coverage channel

**Status:** Resolved (2026-11-02). Chrome verified end-to-end; Firefox installs cleanly. Safari not built by decision.

**Decision:** Ship a browser extension that injects the existing SDK into the tab on a toolbar click. One shared codebase, two manifests: Chrome/Edge MV3 (`background.service_worker`) and Firefox MV3 (`background.scripts`). Safari is deliberately out of scope: no package is built, and the installer detects Safari and recommends Chrome, Edge or Firefox. It is not a second product; it is the same `__jiratackInit` config, the same overlay and the same web trigger.

**Why it is required.** A bookmarklet is inline script. Where `script-src` carries a nonce or hash and no effective `'unsafe-inline'`, the `javascript:` URL is refused before our code exists. Measured live on `github.com` and `developer.mozilla.org`; `instagram.com` sets `script-src … 'nonce-…'` with no `'unsafe-inline'` plus a closed `connect-src`, so it is unreachable by any bookmark, not just ours. Chromium closed *"CSP: Bookmarklets should bypass pages' policies"* as **Won't Fix (Infeasible)** in May 2026; Firefox Bugzilla 866522 has been open since 2013; WebKit applies the same inline check. The requirement "a bookmark that works on every site in Chrome, Firefox and Safari" therefore cannot be met by any bookmarklet implementation, and the extension is the only channel with full coverage.

**Injection model.** The SDK is injected on demand (`chrome.scripting.executeScript`) rather than declared as a content script: the bundle is ~290 KB and every open tab would otherwise pay for it while idle. The injected code runs in the **page's world** (`world: 'MAIN'`), not an isolated one, so the page's CSP does not apply while `consoleProxy`, `__jiratackInit`/`__jiratackClose` and the layout debug hook keep working exactly as in the bookmarklet. An isolated world would have looked safer and quietly broken console capture. `activeTab` is used rather than `<all_urls>`: access is granted by the click, per tab, so there is no "read all your data" install warning.

**Verification.** Chrome 156, 2026-11-02. Extension loaded from `dist/extension-chrome`, real pages: `instagram.com`, `github.com` and `linkedin.com` — all three refuse the bookmarklet — each injected the SDK (`typeof __jiratackInit === 'function'`) and rendered `#jiratack-overlay`, `#jiratack-sidebar` and the sidebar header in the page DOM. The run granted `<all_urls>` because a headless browser cannot click a toolbar icon to earn `activeTab`; the shipped manifest does not. Ticket creation was not exercised (needs a live token).

Firefox 159 accepts the package as a temporary add-on (`installTemporaryAddon` over the remote debugging protocol returns `{"addon":{"id":"jiratack@local"}}` and the add-on appears in `listAddons`), which proves the MV3 manifest, the `background.scripts` form and the icon set are valid; the click path is not exercised because the remote protocol cannot click a toolbar icon. Edge needs no separate build: it loads the Chrome package unchanged. Safari is out of scope (no package, no Xcode project); the installer detects it and recommends another browser.

**Rejected alternatives:** a declared content script on `<all_urls>` (290 KB parsed in every tab, and a broad install warning); the companion-window/popup design (no screenshots, second window, popup blockers); inlining the bundle in the bookmark URL (the URL is refused on exactly the sites it would help, Firefox caps bookmark URLs near 64 KB); userscript managers (third-party dependency, `GM_xmlhttpRequest` replaces `fetch`, unacceptable for enterprise).

**Known limitations:** Firefox is install-verified, not click-verified. Safari is unsupported. The extension still needs the canvas token, pasted from the bookmarklet link; tokens are stored in extension storage, protected by the browser profile, not by an OS keychain. Enterprise extension allowlists can block installation. MV3 forbids remotely hosted code, so SDK updates ship with the package — for a side-loaded build that means re-copying the folder, unlike the bookmarklet's ETag revalidation. Safari requires `xcodebuild -runFirstLaunch` and an Xcode run to install; store distribution needs an Apple developer account.

**Applies to:** `docs/EXTENSION.md`, `src/extension/`, `scripts/build-extension.js`, `src/shared/extensionConfig.js`; CONTRACTS §5.1 (config shape reused); D22.

### D33 — Moving a pin: supersede the screenshot, attribute the move

**Status:** Resolved (2026-11-02)

**Question:** a reviewer drags an existing pin. The ticket already has a screenshot and the web trigger has no user identity. What changes, what stays, and who does the comment say moved it?

**Resolution:**

1. **Capture is the same capture.** A long-press (~400 ms) arms the drag; a ghost follows the cursor; the drop resolves the element under it through `computePinPosition` in `pinMode.js`, so a moved pin obeys §12.2 exactly as a new one — never `body`/`html`, never a box over 80% of the viewport, never a `jiratack-*` class. Releasing over JiraTack's own UI abandons the move rather than anchoring to the overlay.

2. **One new action, not a field in `updateIssue`.** `updatePinPosition` patches `com.jiratack.metadata` in place: `pin.position`, `pin.selector`, the capture context, and `screenshotVersion`. `updateIssue` is about Jira fields and has no screenshot or comment semantics; folding the move in would make both harder to reason about. Authorisation reuses `loadJiraTackIssue`, so label, project and canvas checks are identical.

3. **Supersede, never replace.** The new screenshot is a new attachment named `jiratack-<key>-<epoch-ms>.png`, uploaded through the existing chunked pipeline. Old screenshots are not deleted: they are evidence, and Forge gives no reliable way to undo a deletion. `screenshotVersion` counts supersessions so the fact is machine-readable without parsing filenames; the issue panel nevertheless orders by filename timestamp because that survives attachment-list ordering changes.

4. **Comment attribution is textual.** A web trigger cannot call `asUser()`, so the comment is authored by the app and names the mover: `Pin moved and screenshot updated by <displayName> on <2 Nov 2026, 17:42 GMT>`. The name and zone come from `/rest/api/3/user?accountId=<sub>` for licensed reviewers. A missing or invalid zone formats as UTC and says so. Guest sessions use the invited guest's name and UTC, because `sub` is the sponsor there and the guest's zone is unknowable.

5. **Comment only on a real move.** Nothing is posted when the pointer travelled ≤4 px. The comment also requires the screenshot to have actually attached, because its text claims both. Metadata and screenshot failures are reported as warnings, not as a failed move; a metadata write failure is the one failure that makes the client revert the pin.

**Confirmation (amended 2026-11-02).** A drop is a proposal, not a write. The pin renders at the drop point, the screenshot is captured and held in memory, and a bar beside the pin asks `Move <KEY> here?` with Confirm and Cancel. Only Confirm uploads the screenshot and calls `updatePinPosition`. Cancel, `Esc`, closing the overlay, switching canvas, or starting a new ticket restores the previous selector and position, discards the image, and sends nothing. There is no timer and no auto-commit: a move that is ignored stays pending, and while it is pending no pin can be dragged. This is deliberately stricter than an undo-after-commit window — an app-authored comment cannot be unpublished, so the cheap moment to stop a mistake is before the first request.

**Arm amendment (2026-11-03).** The original arm rule cancelled the whole press when the pointer moved more than the slop (~6 px) before the 400 ms hold completed, reasoning that the gesture was "a click (or a scroll gesture), not a move". In practice that made virtually every real long-press dead: hands slide more than 6 px while pressing onto a 14 px target, the cancel was permanent for that press (even holding perfectly still afterwards never armed), and the reviewer got zero feedback — no ghost, no dimming, no color change — so dragging appeared broken on every page. The rule is now: **moving the pointer past the slop while the button is down arms the drag immediately**, with the ghost snapping to the cursor; a click remains the no-motion press and still selects the pin. Scroll gestures are unaffected (a wheel or trackpad scroll does not move the mouse pointer), and releasing with no significant movement is unchanged (own-pin release abandons, no write). A fast grab-and-release now proposes a move instead of doing nothing — still nothing written without Confirm.

**Visibility amendment (2026-11-03).** The drag feedback itself was broken in two ways, both reported as "dragging shows no pin, no location and no color change until the drop" while the move still landed correctly:

1. **The ghost was parented to `document.body`.** The push-mode fixed-shift pass moves *page* `position: fixed` elements that overlap the sidebar, and it identified page elements by "not inside `#jiratack-overlay`" — so JiraTack's own ghost was shifted by `translate: -320px` the moment it entered the right-hand 320 px, landing 320 px away from the cursor. The ghost is now created inside the overlay (fixed positioning still resolves against the viewport; `pointer-events: none` keeps hit-testing on the page), and the fixed-shift pass now skips anything carrying a `jiratack-` class, so no JiraTack element can be shifted by page-layout compensation again.

2. **The dragged pin faded to `opacity: 0.35`.** An 18 px dot at 35% opacity reads as "the pin disappeared" — the reviewer saw the pin vanish, with no location marker and no colour change to replace it. The dragged pin now keeps full presence and changes colour (the move yellow, with a ring and a slight scale): it is picked up, not erased.

**Rejected alternatives:** renaming or replacing the original attachment (destroys the before state, and Jira attachment names are not a version history); deleting superseded screenshots (irreversible, and a bad screenshot then cannot be compared); delete-and-recreate the ticket (loses the key, comments and status); storing the reviewer's name in metadata on every move (duplicates PII, goes stale, and does not help the comment that is already written); `asUser()` for the comment (impossible in a web trigger and forbidden by AGENTS.md); trusting a timezone from the client (the browser's zone is not the Jira profile's, and the profile is the reviewer's configured zone); reusing `updateIssue` (described above); commenting on every drop, including a jitter (noise on the ticket); an auto-committing undo window (a wrong drop the reviewer does not notice in time still writes a comment and an attachment); a modal dialog (same protection, more friction on every move).

**Known limitations:** A blocked screenshot means no comment even though the pin moved (`screenshot-not-attached` warns the client). Guest moves always print UTC. Comment authorship is the app, not the reviewer — the text is the only attribution. Tickets created before D33 have a single untimestamped screenshot, which still renders via the newest-image fallback. Touch drag is not implemented (mouse long-press only). A drop over the sidebar or viewport bar is discarded. A pending move blocks every drag until it is confirmed or cancelled, and the bar appears only once the capture finishes (about a second), so there is a short window where the pin has moved but cannot yet be confirmed. Jira privacy settings can hide `timeZone`, which degrades to UTC; if the profile cannot be read at all (or the issue was moved by a guest on a non-guest ticket), the name degrades to "a reviewer" — the move and screenshot still apply.

**Applies to:** SPEC §8.3, §10.3, §13.1, §14.3, §16.4; CONTRACTS §1.1, §3.5b, §4.4; `src/shared/pinMove.js`, `src/webtrigger/actions/updatePinPosition.js`, `src/bookmarklet/pinDrag.js`, `src/bookmarklet/moveConfirm.js`, `src/bookmarklet/confirmGeometry.js`, `src/resolvers/actions/issue.js`; TEST_PLAN §2.16b, §3.14.

### D34 — New-ticket form hierarchy and compose mode

**Status:** Resolved (2026-11-03)

**Question:** after a pin is dropped, the sidebar opens a form whose job is to write a Jira summary and description. What should the form make obvious first, and what should get out of the way?

**Resolution:**

1. **Metadata stays visible, compact, at the top.** Project and issue type share a row; assignee follows; the reporter becomes a muted "Reporting as …" line rather than a disabled input. Collapsing metadata behind a disclosure was rejected: those fields are required, and hiding required choices trades one confusion for another.

2. **Summary and description follow immediately and dominate.** Summary is full-width, larger type, required, with a `0/215` counter; description is full-width, five rows, optional. Neither is below the optional content.

3. **Autofocus Summary, with one guard.** The cursor lands in Summary when the form opens *and* a project is resolved. If no project is resolved, focus moves to the project control: otherwise the reviewer writes a summary and is then told the ticket cannot be created. Focus happens once, when the form is created; polling and re-renders never steal it.

4. **Optional content collapses.** The screenshot stays visible as a thumbnail with Remove. Additional fields (priority, parent, console) and `Add evidence` (text change, recording, attachments) are collapsed. The screenshot is evidence, but not the writing task.

5. **Actions stay reachable; validation is inline.** Create/Cancel are sticky; `Cmd/Ctrl+Enter` submits. A short summary shows an error under the field and returns focus; other errors sit above the actions and focus the offending control. The old single error box at the bottom of a long scroll was invisible at the point of failure.

6. **Compose mode lite.** While a form is open the sidebar hides the filter/match row, replaces the page URL with a compact line, collapses the ticket list to `N other tickets on this page`, removes Pin mode, disables pin dragging and blocks Switch Canvas / guest canvas switching. The draft cannot be replaced or lost by an adjacent control. The list remains one click away for duplicate checking — a full focus mode that hides it was rejected for that reason.

7. **The seed ticket is not a pin.** `[JiraTack] Canvas created` has position `0,0` and exists for canvas bookkeeping; it is hidden from the overlay list and pin layer, but still counted by the dashboard/epic panel.

**Rejected alternatives:** metadata collapsed below the writing fields (hides required decisions); always autofocusing Summary even without a project (guaranteed validation failure after typing); a multi-step wizard (more clicks, and the whole form fits one panel); a full-screen compose mode that hides the ticket list (loses at-a-glance duplicate checking); keeping the disabled reporter input (takes a row for immutable information); a sticky submit with no inline validation (the error stays off-screen); auto-submitting on `Enter` (breaks description line breaks).

**Amended 2026-11-03 — details-first order, content captured in a popover.** The sidebar now completes a draft rather than doing the writing. Order: Assignee → reporter line → Project / Issue type → carried Summary → conditional text-change pair → Description → Attach files / Record screen (captured evidence below them) → advanced → actions. Assignee is the first key field and receives focus; project receives focus only when unresolved. The popover at the capture point owns Summary/Description (or the suggested text); "Add to ticket" moves that content into the sidebar, and Create there is the only creation path. See D36 for the flow and D35 for the preview.

**Known limitations:** Compose mode is desktop-pointer shaped; it inherits the overlay's lack of touch support. The form still validates Summary at submit time rather than disabling Create. A draft is not persisted: closing the overlay discards it. The sidebar rebuild must preserve the live form DOM; a future re-render that clears `.jiratack-new-ticket-form` would destroy the draft. A text change exists only for the selection-pill flow; without a captured selection there is no way to add one from the sidebar.

**Applies to:** SPEC §10.2, §10.5; CONTRACTS §5.2; `src/bookmarklet/form.js`, `src/bookmarklet/sidebar.js`, `src/bookmarklet/index.js`, `src/shared/seedPin.js`; TEST_PLAN §3.14, §4.2b, §4.3; `scripts/extension-harness/run.mjs`.

### D35 — Text-change preview on the page

**Status:** Resolved (2026-11-03)

**Question:** when a pin is placed on a text selection, how should the suggested replacement be shown before the ticket is created, without pretending JiraTack can edit the page?

**Resolution:**

1. **A selection pill, not a mode.** Pin mode is the only capture control. A non-collapsed DOM selection outside JiraTack and form controls shows a small **Suggest edit** pill at the selection; clicking it opens the suggestion popover. The pill never auto-opens and never captures ambient selections on its own, so a stray selection cannot mark a pin as a text change and there is no second mode to explain.

2. **The pair is conditional and compact.** No text change → no text-change UI. A text change → the popover owns the suggested text, and the sidebar shows a standalone `TEXT CHANGE` card with a large **View on page** toggle, **Edit**, and a wrapping `Original → Suggested` pair between the Ticket card and Description. Edit reopens the composer with Save; the original is never editable, because editing it would break the range.

3. **Inline preview where it is provable.** If the range is inside a single text node, split it: original in red with `line-through`, suggested text in green, before/after text preserved. The original Text node is kept detached and re-inserted on hide, so the page is restored exactly. This is the common "highlight a phrase" case.

4. **Bubble fallback otherwise.** A range spanning elements, an input selection, or a page that re-rendered under us uses a non-destructive overlay: red rectangles over the range and a bubble with old → new in red/green. No DOM mutation.

5. **Preview only.** Nothing is persisted to the page. Hide, Cancel, Create, and overlay close all restore; the ticket description records `Text change / Original / Suggested` as before. Summary is prefilled with `Text change: <original>` so the reviewer sees what will be sent, and is editable.

6. **Red/green plus strikethrough**, not colour alone, so the meaning survives colour-blindness.

7. **Available after creation.** The pair is also stored in `com.jiratack.metadata.textChange`. A ticket created with a text change shows a switch on its card labelled with the actual `Original → Suggested`; toggling it re-previews the stored pair, including after the overlay is reopened. The post-creation anchor is search-only: scope to the pin's selector, fall back to the document only when the phrase is unique, and refuse rather than highlight the wrong occurrence. The issue panel shows the pair on one line. New tickets only; legacy tickets have the text in the description but no metadata, so no card switch.

**Rejected alternatives:** always showing two textareas (inert after the drop and the main source of clutter); editing the live page permanently (impossible generically, destructive, and not what a ticket does); highlight-only without the replacement (does not show the proposal); storing text only (cannot locate duplicates, so the preview would be a guess); auto-detecting "the text under the pin" as the original (usually a whole element, not the intended phrase); a modal preview (hides the page context that makes the preview useful).

**Amended 2026-11-03 — anchored re-resolution and a switch.** The preview control is a switch (`role="switch"`), not a button. Every show re-resolves a fresh Range from a serialized anchor (node path + offsets + the selected text, with a unique-text fallback scoped to the nearest id ancestor), because a framework can replace the text node between previews; a stored live Range alone made the second toggle fail. If the anchor no longer resolves, the switch turns off and a hint asks the reviewer to select the text again.

**Known limitations:** the anchor can fail if the page removes the phrase entirely (the switch then refuses rather than guess); inline is limited to single-text-node ranges, otherwise the marker bubble is used; selections inside `<input>`/`<textarea>` have no DOM Range and cannot be previewed; the inline preview temporarily mutates the host DOM (restored on hide); nothing is written back to the page; a text fallback only works when the phrase is unique in its scope, which is deliberate. Post-creation previews need the phrase to still exist on the page; legacy tickets have no `textChange` metadata.

**Applies to:** SPEC §10.2, §10.4, §10.5, §8.3; CONTRACTS §1.1, §3.3, §4.4, §5.2; `src/bookmarklet/pinMode.js`, `src/bookmarklet/textAnchor.js`, `src/bookmarklet/textPreview.js`, `src/bookmarklet/form.js`, `src/bookmarklet/sidebar.js`, `src/bookmarklet/index.js`, `src/lib/metadataModel.js`, `src/webtrigger/actions/createIssue.js`, `src/webtrigger/actions/getPins.js`, `src/resolvers/actions/issue.js`; TEST_PLAN §4.2b; harness `/form` and `/text` fixtures.

### D36 — Popover capture, selection pill, and a details-only sidebar

**Status:** Resolved (2026-11-03)

**Question:** the sidebar form was doing two jobs — writing the ticket and choosing its Jira fields. Where should capture happen, and where should the ticket be completed?

**Resolution:**

1. **The popover owns the new content.** Clicking an element in Pin mode opens an anchored composer with **Summary** and **Description**. It does not create a ticket and does not open the full form. The pending pin marks the location while the composer is open; Cancel removes it.

2. **Text changes start from a pill, not a mode.** A selection outside JiraTack and form controls shows a small **Suggest edit** pill. Clicking it opens a composer with the selected quote, the **Suggested text**, and **View on page**. There is no Text change mode and no ambient selection capture.

3. **"Add to ticket" hands the content to the sidebar.** The sidebar is the details step and the only creation path. Its Create button saves. Quick create from the popover was rejected: the Jira fields, attachments and validation live in one place, and a one-step create would either skip them or grow the popover into the form.

4. **The sidebar is details-first.** Order: **Assignee** (first key field, focused on open), reporter line, Project / Issue type, carried **Summary**, the conditional text-change pair, **Description**, Attach files / Record screen with evidence, advanced fields, actions. When no project resolves, focus moves to Project instead.

5. **Text changes stay compact.** The sidebar shows `Original → Suggested`, **View on page**, and **Edit** — not a second editor. Edit reopens the same composer with **Save**, so there is one suggested-text field in the product. View on page exists in both the composer and the sidebar.

6. **Defaults come from the previous ticket.** For each field, take the newest non-empty value across the canvas's non-seed pins: project, issue type, assignee, priority, parent. Assignee fallback: previous assignee → current licensed user → sponsor for a guest. Project fallback: the only permitted project. Issue type fallback: last used → Task → first non-Epic. Priority fallback: last used → Medium → first. Parent carries over and stays editable in advanced fields.

7. **Composer placement is bounded.** The popover flips above the anchor when it would overflow the viewport and clamps to an 8px edge margin; the same helper places the selection pill. This is pure geometry and unit-tested.

**Amended 2026-11-03 — perceived response and grouping.** The control is labelled **New Pin** with a prominent helper ("Click an element to pin it, or select text to suggest an edit") and a filled pressed state. The extension captures the visible tab before the composer opens, so typing never competes with html2canvas; the bookmarklet opens the composer immediately and captures with html2canvas when **Add to ticket** is pressed, after the composer is gone. The selection pill appears on mouse release, not during the drag, and keeps the cloned range if the page collapses the native selection. The sidebar groups fields into **Assigned to / Ticket / Evidence** cards (no CONTENT wrapper), with Assignee as a tinted, accented first card containing the reporter line. The text change is its own card: `TEXT CHANGE`, a large centered **View on page** toggle, **Edit**, and a wrapping red/green pair.

**Rejected alternatives:** quick create from the popover (no undo, skips Jira fields, or duplicates the form); keeping the Text change mode (a second mode to learn for an action the selection itself states); the full form inside the popover (too much for a 320px anchored surface); not carrying parent or assignee (repeats the most common edits on every ticket); a disabled Assignee field that only mirrors the previous value (the reviewer must be able to change it).

**Known limitations:** the pill needs a non-collapsed DOM Range and does not appear for selections inside `input`/`textarea`; popover placement can still land over page content; defaults can mis-file when the previous ticket was exceptional, so every default remains visible and editable; no touch capture. The sidebar's sticky action bar can cover the lower content on a very short viewport; the form scrolls.

**Applies to:** SPEC §10.1, §10.2, §10.4, §10.5; CONTRACTS §1.1, §3.1, §3.2, §5.2; `src/bookmarklet/capturePopover.js`, `src/bookmarklet/popoverGeometry.js`, `src/bookmarklet/textSuggest.js`, `src/bookmarklet/form.js`, `src/bookmarklet/index.js`, `src/webtrigger/actions/getPins.js`, `src/webtrigger/actions/exchangeToken.js`; TEST_PLAN §4.2b, §4.3; harness `/form` and `/text` fixtures.

### D37 — Current-tab recording without a display picker

**Status:** Resolved (2026-11-03)

**Question:** `Record screen` used `getDisplayMedia`, which always opens a picker and, in the reported case, did not list the current tab. How should the tool capture the page as evidence?

**Resolution:**

1. **The extension records the active tab directly.** The background calls `chrome.tabCapture.getMediaStreamId({ targetTabId })`; an offscreen document consumes that id with `getUserMedia` (`chromeMediaSource: 'tab'`), records WebM with `MediaRecorder`, and returns a data URL through the bridge. No picker is shown.

2. **Tab only.** The extension stream is the tab the reviewer invoked; there is no screen/window option and no way to record another tab. This matches the evidence the ticket is about.

3. **The bookmarklet keeps the display picker.** A page cannot suppress `getDisplayMedia` for security reasons. It requests `displaySurface: 'browser'`, `preferCurrentTab: true`, `selfBrowserSurface: 'include'` and `surfaceSwitching: 'include'` so the current tab is the offered source, but the picker remains.

4. **Fallback rather than failure.** If tab capture is unavailable (restricted page, older browser, Firefox), the form falls back to the display picker and says nothing extra. The recording is still capped at 60 seconds.

5. **One recording at a time.** The button becomes **Stop recording** while armed and the form owns the stop. The offscreen recorder auto-stops at 60 seconds; the result is a WebM data URL uploaded as `jiratack-recording-<epoch>.webm`.

**Rejected alternatives:** `getDisplayMedia` alone (picker, and the reported tab omission); `chrome.desktopCapture` (still a picker); screen/window capture (not scoped to the ticket page); `chrome.tabCapture.capture` in the MV3 worker (not available there); no fallback (recording would disappear on Firefox and restricted pages).

**Known limitations:** the recording includes the JiraTack overlay, exactly as the display-picker path did; the 60-second cap is unchanged; the data URL crosses an extension message boundary, so very long recordings are rejected by the size limit; tab capture needs the extension to have been invoked on that tab (`activeTab`) and was verified manually, not in the headless harness.

**Applies to:** SPEC §10.5; CONTRACTS §5.2; `src/extension/manifest.chrome.json`, `src/extension/background.js`, `src/extension/bridge.js`, `src/extension/offscreen.*`, `src/bookmarklet/recording.js`, `src/bookmarklet/form.js`; `scripts/build-extension.js`; TEST_PLAN §4.2b.

### D38 — Status filter as the single visibility rule

**Status:** Resolved (2026-11-03)

**Question:** Done tickets stayed on the canvas after being marked done (retirement never fired by default), and the reviewer had no control over visibility. What governs which tickets show on a canvas?

**Resolution:**

1. **The project's status rule is the only show/hide rule.** Project settings gain `filteredStatusIds`: an explicit array of Jira status IDs to hide. When it is not set (`null`), the default rule hides the **Done** status category. `[]` hides nothing.

2. **One overlay toggle.** The sidebar offers **View All** / **Filter By Status**. Filtering is on by default; **View All** reveals what the rule hides (they keep their muted Done styling), and **Filter By Status** re-applies it. The toggle is display-only; it never changes the rule. When the filtered-out tickets leave the list empty, the empty state offers "Show N filtered tickets".

3. **The server marks, the client hides.** `getPins` stamps each pin with `filtered: true/false` using that pin's own project's rule (canvases can span projects), so the toggle works without a refetch. The pin layer and the ticket list always agree.

4. **"Removed" is never returned.** A status literally named `Removed` (case-insensitive) is a permanent exclusion enforced server-side in `getPins`; no toggle reveals it.

5. **Retirement is removed entirely (supersedes D14).** Aging out no longer deletes or hides anything. `retirementDays` is gone from project settings, `getEffectiveRetirementDays` is deleted, and `getPins` no longer computes a retirement cutoff. A done/aged ticket is filtered by status exactly like any other; it is permanently removed only when its status is Moved/Removed/Deleted inside Jira.

**Rejected alternatives:** a separate "retired" concept (the status rule and only the status rule was requested); hiding Done client-side with no admin control (the rule must live with the product in Jira); per-user *server-side* filter memory (the choice is a convenience, not shared state — localStorage is enough and needs no migration); returning "Removed" tickets for future un-reveals (Removed means removed).

**Amendment (2026-11-03): the reviewer owns the filter.** The original resolution made the admin rule the only visibility control and reset the toggle on reload. That was wrong in use: "Done" means different things on different canvases, and re-hiding after every reload is friction. The rule is now the **default seed** only:

1. The client derives the default hidden set from the per-pin `filtered` flags (status **names** present on the canvas) and stores a per-canvas override in `localStorage['jiratack:statusFilter:<canvas name>']` — absent = default, `[]` = nothing hidden, list = exactly those hidden.
2. The row is `View All | Filter By Status ▾`. The caret opens an Excel-style checklist: `All` / `None` / `Reset` plus one row per status on the canvas with its ticket count (including currently hidden tickets, so a hidden status can be re-enabled). A tick means *show*; edits apply immediately and persist.
3. **View All** is a temporary peek that changes neither the rule nor storage. The filter button reads `(N hidden)` where N is what the rule holds back.
4. The project setting is renamed **Default filter setting** and its copy says it seeds the list rather than locking it.

**Known limitations (updating the above):** the override is keyed by canvas **name** and by status **name** (the pin record carries `status.name`, not an ID), so renaming either starts the canvas from the default; clearing site data clears the overrides; the rule still matches status IDs server-side, so recreating a status needs the admin setting re-saved.

**Applies to:** SPEC §7.2, §10.2; CONTRACTS §1.1 (PinRecord), §3.1 (project settings), §7.2 (getPins); `src/lib/statusFilter.js`, `src/webtrigger/actions/getPins.js`, `src/resolvers/actions/config.js` (`getProjectStatuses`), `src/ui-kit/project-config/index.jsx`, `src/bookmarklet/index.js`, `src/bookmarklet/sidebar.js`; TEST_PLAN §4.2b, harness `/plain` fixture.

### D39 — Extension self-enrollment without the bookmark

**Status:** Resolved (2026-11-03)

**Question:** the extension's config was created by pasting a bookmarklet `javascript:` link into its options page (CONTRACTS §5.1, "one config shape, one place it comes from"). That made the extension carry a frozen copy of `apiUrl`/`token` that went stale when the app moved — with a bare "Token exchange returned an invalid response" and no recovery cue. How should the extension get and keep its config?

**Resolution:**

1. **The bookmarklet exposes the config it already uses.** While the SDK runs, `window.__jiratackConfig` holds `{ token, apiUrl, sdkUrl, canvasId, canvasName, sdkVersion }`. This exposes nothing new: the same token crossed the page world inside the bootstrap, and page scripts could already observe every fetch the overlay makes.

2. **Toolbar click = enroll and repair.** Clicking the extension's toolbar button on a page with a live overlay reads that view. If it differs from what is stored (`apiUrl` or token), the background validates it with a real `exchangeToken` against the submitted `apiUrl` and, only on success, replaces the stored config and opens the overlay. If the stored config still differs but the page's copy fails validation, the stored config keeps running.

3. **Page-supplied configs cannot invent an installation.** An attacker page can spoof `__jiratackConfig`, but the stored config must be one the real JiraTack API accepted in an exchange, and when a config is already stored, a different-origin candidate cannot silently replace it. Residual risk (a malicious page enrolling its own canvas while nothing is stored, only after a user click) is documented in SECURITY-REVIEW.

4. **The options page demotes to repair path.** Paste remains for the case where nothing is stored and the page has no live overlay. Copy on the page now says "Canvas link (repair path)" and explains the toolbar-click flow.

5. **Errors name the cause.** A token exchange that receives non-JSON reports the reached URL and the answer's content type (D14-grade diagnosability), instead of "invalid response".

**Rejected alternatives:** piece-of-`postMessage` enrollment pushed from any overlay without a click (no user gesture, easier to spoof); `externally_connectable` web messaging (needs manifest host list per site — unknown at install time); asking the reviewer to re-paste after every app move (this is what failed); syncing config from Jira at runtime (no place to learn the webtrigger URLs without a working apiUrl — chicken-and-egg).

**Known limitations:** a bookmarklet-driven enrollment session must be opened at least once in the browser; extension-only users (never running the bookmarklet) still use the paste path once; the toolbar-click repair only heals configs whose difference is the apiUrl/token, not other fields.

**Applies to:** SPEC §6.4b, §1 (scope); CONTRACTS §5.1; `src/bookmarklet/index.js` (`window.__jiratackConfig`), `src/extension/background.js` (`pickEnrollConfig`, `validateEnrollConfig`, action click), `src/bookmarklet/auth.js` (exchange error), `src/extension/options.html`, `src/extension/options.js`; TEST_PLAN §4.2c; harness enrollment-exposure assertion.

### D40 — Keeping the overlay open across a URL change (extension)

**Status:** Resolved (2026-11-03)

**Question:** a reviewer clicks a ticket card whose pin lives on another URL. Today the tab navigates, the document is replaced, and the overlay disappears with it — the reviewer has to re-open the toolbar (or the bookmark) and find their canvas again. Can the overlay survive the navigation?

**Resolution:**

1. **The bookmarklet cannot, structurally.** The SDK is injected into the document; a document change destroys it. Bookmarklet users keep the existing notice and re-open the bookmark.

2. **The extension can, with `host_permissions: ["<all_urls>"]`.** `activeTab` is revoked by *any* navigation, so re-injection needs a host grant. The permission is scoped to injection only: the overlay still starts from an explicit toolbar click, and the automatic re-injection happens only for a navigation the reviewer initiated from the overlay.

3. **One-shot carry, not follow-me.** Before navigating, the SDK posts `carry-overlay` through the bridge. The background records it for that tab and re-injects bridge + SDK with the stored config when the tab finishes loading. The flag is cleared when used, when the toolbar closes the overlay, and when the tab closes — so ordinary browsing never carries the overlay along.

4. **The destination page keeps the context.** `navigateToPin` already appends `jiratack_ticket` and `jiratack_canvas`; the reopened overlay consumes them (§12.3), so it lands on the ticket that was clicked.

**Rejected alternatives:** reopening on every navigation in a tab that once had the overlay (surprising — the toolbar would follow the reviewer around the web); a permanent content script on every page (pays for the 290 KB bundle on every tab while idle); opening the target in a second tab (the current overlay survives, but the destination has no overlay and the reviewer ends up looking at a bare page); relying on `tabs.onUpdated` without a carry flag (indistinguishable from ordinary browsing).

**Known limitations:** requires the host-permission bump (users must approve it when re-loading the extension); restricted URLs (`chrome://`, the Web Store, PDF viewer) are skipped; an in-page router that keeps the overlay alive is detected with `isActive` and not re-injected twice; Firefox's behaviour is untested.

**Applies to:** SPEC §6.4b, §6.7; CONTRACTS §5.1b (bridge shapes, manifest); `src/extension/manifest.chrome.json`, `src/extension/manifest.firefox.json`, `src/extension/background.js` (`carryOverlay`, `tabs.onUpdated`), `src/extension/bridge.js`, `src/bookmarklet/index.js` (`handleBeforeNavigate`); TEST_PLAN §4.2d; harness "cross-URL" assertions.

### D41 — Canvas field pre-fills

**Status:** Resolved (2026-11-04)

**Question:** canvases need extra text on their tickets — a UAT URL, a Figma link every URL on the canvas references — and Jira sites differ in which fields exist and which are on a screen. How do admins make fields available, how do canvas creators set values, and what happens when a ticket type cannot hold the field?

**Resolution:**

1. **Admins curate the catalogue, per project.** Project settings gain **Available text fields** (`projects[key].textFields = [{ id, name }]`), chosen from `GET /rest/api/3/field` filtered to `schema.type === "string"` without `items` (single-line text, multi-line text, URL). Managed fields the app writes itself (`summary`, `description`, `labels`, `issuetype`, `project`, `reporter`, `assignee`, `priority`, `parent`, `status`, …) are never offered. This is the only place a field enters JiraTack.

2. **Canvas creators pick values from that catalogue.** The create-canvas modal has a **Project** selector and an **Additional fields (optional)** accordion: rows of `field` + `value`, limited to the selected project's catalogue. Rows live inside a closed `<details>` so the form stays compact and the modal does not scroll unless the creator opens it.

3. **Values are editable afterwards.** Each active canvas row has a **Fields** action that opens the same editor for the canvas's project; saving replaces the pre-fills. No "clear all" switch — removing a row is the way to stop a pre-fill.

4. **Storage is per canvas, hashed.** `canvasAux:<sha256(canvasName).slice(0,32)>` holds `{ version: 2, projectKey, prefillFields: [{ fieldId, fieldName, value }] }`. `createCanvas` always writes or clears it, `deleteCanvas` deletes it, `archiveCanvas` keeps it so unarchive restores the values. The web trigger reads it by canvas name, so no Jira search runs per pin.

5. **The screen check is per ticket.** Canvases can create any mix of issue types, so a canvas-wide verdict would be wrong. `createIssue` reads the canvas pre-fills and, immediately before creating, calls `GET /rest/api/3/issue/createmeta/{project}/issuetypes/{type}`. A field on that Create screen is written as `fields[fieldId] = value`; everything else is appended to the human-readable description as `Field: value` (bare URLs get a link mark). If the createmeta call fails, nothing is written and every value falls back to the description. Nothing is ever dropped silently and no ticket is blocked by a pre-fill.

6. **Legacy shape still reads.** Canvases created under the first D41 iteration stored `{ label, value, mode }` rows; a mapped row becomes a pre-fill for its target field, a description row becomes a label-only note that always lands in the description. The web trigger normalises both.

**Rejected alternatives:** a generic mapping table for every Jira field (user/option/cascade values are not strings and cannot be written blindly); letting creators type any field ID (the catalogue is the admin's control point); pre-validating screens per canvas at creation (a canvas spans issue types, so it would show the intersection or lie); a per-canvas "description vs field" mode toggle (the fallback already covers it and doubles the UI); storing config on the seed ticket's property (a Jira search per ticket); refusing to create the ticket when a field is unavailable (a UAT URL must never cost the ticket); a "None" row for clearing (removing the row is simpler).

**Known limitations:** a pre-filled value can be written but invisible on the issue view if the field is not also on the View screen — no REST API exposes view-screen fields, so the UI says so and the creator checks in Jira; the screen check costs one Jira API call per ticket when the canvas has pre-fills; config is keyed by canvas name, so renaming a canvas starts it without values; the overlay launcher can create a canvas but does not offer fields (dashboard only).

**Follow-up (2026-11-04):** the catalogue is edited **only** on the admin page — the per-project "Available text fields" control was removed from project settings, and the canvas pre-fill record dropped its vestigial `projectKey`. A canvas never shows a project picker; the seed ticket uses the installation's default project.

**Applies to:** SPEC §8.1, §14.1, §14.1b; CONTRACTS §3.3 (steps 6/6b), §3.9, §4.8, §4.8b, §4.8c, §4.9; `src/lib/fieldPrefill.js`, `src/lib/canvas.js`, `src/lib/issueDescription.js`, `src/webtrigger/actions/createIssue.js`, `src/resolvers/actions/config.js`, `src/resolvers/actions/admin.js`, `src/resolvers/index.js`, `src/ui-kit/project-config/index.jsx`, `src/custom-ui/dashboard/components/CreateCanvasModal.jsx`, `src/custom-ui/dashboard/components/EditCanvasFieldsModal.jsx`, `src/custom-ui/dashboard/components/FieldPrefillEditor.jsx`; TEST_PLAN §5.3b.

### D42 — Stable canvas keys and the dashboard information architecture

**Status:** Resolved (2026-11-04)

**Question:** canvases were identified by their display name. Renames were impossible, two teams could collide on a name, and the dashboard mixed "install" and "manage canvases" into one undifferentiated page that will not survive hundreds of canvases.

**Resolution:**

1. **The seed ticket's key is the canvas key.** `KAN-123` is stable, unique and already visible in Jira. A canvas created without a seed ticket (a pin with a new canvas name) gets a generated `c-xxxxxxxx` key. The name is a label.

2. **A registry, not a name.** KVS `canvas:<key>` holds `{ key, name, names, folder, createdAt, createdBy, archived }`; `canvasName:<normalised>` maps every name the canvas has ever had to its key. Rename updates the record and adds the new name to the index — old names keep resolving, so tickets written before a rename still belong to the canvas. `deleteCanvas` removes the record; archive/delete lists stay in `installationConfig` and are rewritten on rename.

3. **New tickets carry the key.** `createIssue` writes `pin.canvasId` alongside `pin.canvas`. Tickets without it resolve through the name index. Legacy tickets are not rewritten; the user explicitly does not care about them.

4. **Pre-fills and catalogue move to key/installation scope.** The installation-level **Available text fields** catalogue (admin page) replaces the per-project list; a canvas stores `{ prefillFields }` keyed by `canvasKey` (`canvasAux:<sha256(key)>`). Both are keyed by the stable key.

5. **Dashboard IA.** The page is split into **Install JiraTack** (`#install`: bookmarklet card + extension/guest card) and **Canvases** (`#canvases`: search, cards/list toggle, inline create panel). Canvas creation is an inline panel with name, URL and the field↔value map — no modal, no project picker (the seed ticket uses the default project). A dedicated canvas page (`#/canvas/<key>`) has tabs **Pages / Fields / Access**; rename lives in Fields, sharing lives in Access. Cards and list rows both show the name and the key. Destructive confirmations stay modal.

**Amended 2026-11-05 — one resolver.** Identity is resolved in exactly one place, `resolveCanvas`, used by the dashboard actions, `getPins`, the aggregate, the launcher and `createIssue`. Order: record key → `canvasName:` index → the deterministic key derived from the name → optionally a record scan. A request id may be a key or a label; a ticket always stores the **label** in `pin.canvas` and the **key** in `pin.canvasId`. A generated key that resolves to nothing answers `NOT_FOUND` rather than creating a record named after the key. `registryHealth` (admin-only, read-only) reports the legacy data that keeps the name-based fallbacks alive — orphaned index rows, unindexed records, tickets without a key — so they can be retired on evidence. A resolution that had to bypass the name index repairs that row, so a lost index costs one scan instead of one per call. Name-index keys are KVS-safe (`canvasName:<slug>-<sha1[0:8]>` holding `{ name, canvasKey }`), because canvas names are free text and characters such as `+` are rejected by the store — writing the raw name as a key failed silently and left canvases unindexed; legacy rows are still read. Card previews are cached separately from the dashboard summary under a stamp (`canvasPreviewCache`), because data URLs would exceed the KVS document limit; a write or clear bumps the stamp and the next read rebuilds once. The reason is the 3–4 November bug set: a duplicate launcher entry, a preview written where the card never read, and five admin actions failing on a deleted helper, all from identity being answered differently in different places.

**Rejected alternatives:** keeping the name as identity (renames and collisions stay broken); a random UUID (unreadable, and the seed key already exists); rewriting every ticket property on rename (an expensive background job for no user-visible gain, and legacy tickets are out of scope); a modal per action (the original clutter); a project selector in creation (the canvas is the product, the seed project is an implementation detail).

**Known limitations:** the dashboard still derives counts by scanning `labels = "jiratack"` (2,000-issue cap) rather than a maintained index; the bookmarklet scope picker (selected-canvases default, "All canvases" option, typeahead) and extension canvas discoverability are the next phase, so the install card still issues the universal launcher token; the guest picker remains a modal; folders exist in the record shape but have no UI yet; thumbnails are not implemented (they need a capture-time product, not a dashboard-time fetch).

**Applies to:** SPEC §8.1, §8.1b, §14.1b; CONTRACTS §1.1 (`pin.canvasId`), §3.3, §3.9, §4.2 (`dashboardAggregate`), §4.8/§4.8b/§4.8c (canvas resolvers), §4.9 (`textFields` at installation level); `src/lib/canvasRegistry.js`, `src/lib/canvas.js`, `src/lib/metadataModel.js`, `src/webtrigger/actions/createIssue.js`, `src/resolvers/actions/{admin,dashboard,config}.js`, `src/resolvers/index.js`, `src/ui-kit/admin/index.jsx`, `src/custom-ui/dashboard/**`; TEST_PLAN §5.3b, §5.5.

### D43 — Install paths, guest continuity, folders and bookmark scope

**Status:** Resolved (2026-11-04)

**Question:** the install section mixed the bookmarklet and extension into one action, guests could not use the extension at all, canvases had no grouping, a bookmarklet could only ever be "all canvases", and guest links expired after 72 hours. What is the install and organisation model?

**Resolution:**

1. **Two install paths, four actions.** The Bookmarklet card offers **Get bookmark** and **Create a guest bookmark**; the Browser extension card offers **Chrome extension**, **Firefox add-on** and **Create a guest extension link**. Chrome links to the Web Store; Firefox links to the signed `.xpi` (one click, no store page). Publication URLs are constants; until they exist the button says the extension is not published and points at the bookmarklet. The misplaced "Invite a guest reviewer" button is gone from the extension card.

2. **The guest invite page is the identity handoff.** The guest link (`?token=…`) stays the credential. The page shows the extension card first when `mode=extension`, with: install → click the bookmarklet once (starts JiraTack with the invite) → click the toolbar icon → the page turns **🟢 Connected** by observing `window.__jiratackActiveCanvas`. It never polls the extension, needs no `externally_connectable`, no reload and no paste. The bookmarklet card remains below as the zero-install fallback.

3. **Guest links last 90 days.** `LINK_TTL_MS` is 90 days (was 72 h); sessions still renew through `exchangeToken`, and revocation/pause/deactivation still take effect immediately. Copy in the invite email, the installer page and the guest drawer says 90 days. The longer bearer lifetime is recorded in SECURITY-REVIEW.

4. **Folders are a label on the canvas record.** The dashboard shows a folder rail (All, Unfiled, each folder with counts); the canvas page has a **Folder** field with suggestions from existing folders. No separate folder entity: a folder exists while a canvas carries its name.

5. **Bookmark scope is explicit.** **Get bookmark** opens a drawer: **Selected canvases** (the default) or **All canvases (always current)**. A selection is frozen — new canvases need a regenerated bookmark, and the drawer says so. The token record carries `permittedCanvasesJson` (an array or `"all"`); `exchangeToken` puts it in the session JWT and `listCanvasesForUser` filters by it.

6. **Canvas discovery at scale.** The overlay's launcher lists every accessible canvas with **name and key**, and shows a filter box once there are more than six.

7. **The card preview is captured locally and stored on the record (amended 2026-11-04).** The image is a screenshot of the **top of the page at the full viewport width**, taken by the reviewer's browser at the first ticket, excluding JiraTack's own pins and overlay; no external image service. The capture always scrolls to the top-left and renders at the exact viewport width so nothing is offset, and the card fills its width and clips the bottom of a tall shot rather than cropping the sides. It is stored on the canvas record (`thumbnail`, `thumbnailAt`, `thumbnailVersion: 2`) so **Clear preview** deletes exactly what the card displays. If the page capture yields nothing, the ticket's own screenshot is downscaled and used; encoding steps down in size and quality until the data URL fits the record, so a valid image is never silently dropped by the storage cap. A canvas id that already is a record key resolves to that record instead of creating a duplicate named after the key. When no image is produced, the client's reason is stored as `thumbnailNote` and shown on the canvas page, so "not captured" is diagnosable rather than a blind end state. Previews written by builds before 5.72 (under `canvasThumb:<key>`) are adopted onto the record on first read and the old key deleted, so only one generation is read, written or cleared. Previews written by builds before 5.72 (under `canvasThumb:<key>`) are adopted onto the record on first read and the old key deleted, so only one generation is read, written or cleared.

**Rejected alternatives:** a store link in the invite email (the store cannot carry a token, so the guest would dead-end); auto-detect-after-install (needs a reload, so an explicit instruction is more honest); a separate firefox/xpi installer build (the manifest already differs; only the link does); folders as KVS entities (a label is enough and cannot orphan); a global "all canvases" bookmark only (guests need a narrow link).

**Amendment (2026-11-05):** the launcher's registry comes from a stamped snapshot (`canvasRegistryCache`) rather than a rebuild on every open, which cost up to 140 KVS queries at the caps. Any record write bumps `canvasRegistryStamp`, so a new or renamed canvas appears on the next open; a snapshot too large to cache falls back to reading the records.

**Known limitations:** the extension cannot be installed from the page (store or Developer mode only); the guest must click the bookmarklet once on the invite page before the toolbar icon has something to enroll; zero-click enrollment waits for `externally_connectable`; a frozen selection does not pick up new canvases; folders have no nesting or rename; the fallback preview is the ticket's cropped screenshot, so it can show the pin's area rather than the top of the page when the primary capture fails.

**Applies to:** SPEC §6.5, §8.1, §8.6; CONTRACTS §4.7 (`generateUserToken`), §3.1 (`permittedCanvases` claims), §3.11 (`listCanvasesForUser`), §4.8d (`assignCanvasFolder`), §2.1 (link TTL); `src/lib/inviteModel.js`, `src/webtrigger/install.js`, `src/webtrigger/actions/{exchangeToken,listCanvasesForUser}.js`, `src/resolvers/actions/admin.js`, `src/resolvers/index.js`, `src/bookmarklet/sidebar.js`, `src/custom-ui/dashboard/**`; TEST_PLAN §5.3b, §5.6, §5.7.

### D13 — SDK version source

**Status:** Resolved (2026-10-23)
**Resolution:** Content hash. `scripts/embed-sdk.js` computes SHA-256 of the minified SDK bundle and truncates to 12 hex characters. Exported from `src/lib/version.js` as `SDK_VERSION`. Embedded in every bookmarklet URL as `?v=<SDK_VERSION>` for cache-busting.
**Implementation:** `npm run build` must regenerate `src/lib/version.js`. Verify in Sprint 1 whether Forge CLI supports pre-deploy build hooks; if not, commit `src/lib/version.js` and `src/lib/sdk-bundle.js`.
**Rejected alternatives:** Git commit hash (imprecise); manual version bumps (discipline-dependent); timestamp (non-deterministic).
**Applies to:** BUILD_PLAN §8.3, CONTRACTS §4.1 and §10.2.

### D14 — Retirement config source in multi-project canvases

**Status:** Resolved (2026-10-23); **superseded by D38** — retirement (`retirementDays`) was removed; the per-project status rule is the only visibility control. The canvas→project mapping note below is then moot.
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

### D44 — Optimistic save: close first, save behind a pending card

**Status:** Resolved (2026-11-05)

**Question:** saving a ticket disabled the form for the whole upload plus the Jira round trip. On a slow Jira or a large screenshot the reviewer waited with nothing to do, even though their part was finished.

**Resolution:**

1. **Create closes the form.** The payload is snapshotted, the form is dismissed, and the pin appears at once as a pending card labelled **Saving…**. Uploads and the create run in the background.
2. **Uploads are concurrent.** Screenshot, files and recording upload together; the save waits for the slowest, not the sum. Size validation still happens before anything is sent.
3. **The card preview is captured inside the background save**, in-page only (no tab capture, no scroll, nothing hidden), with the ticket screenshot as the bounded fallback. It no longer delays the reviewer or moves the page under the form.
4. **Failure never loses the draft.** Before reopening, the overlay looks for a ticket that actually landed (same summary, created within two minutes) so a lost reply cannot become a duplicate. Otherwise the form reopens with every value: summary, description, text change, screenshot, files, recording, assignee, parent.
5. **Canvas switching waits** while a save is in flight; closing the overlay is allowed, and the ticket appears when the page is opened again.

**Rejected alternatives:** a progress indicator on the disabled form (does not free the reviewer); an optimistic card without recovery (loses work on failure); splitting `createIssue` server-side so attachments attach after the response (a wire-contract change for marginal gain once the client stops waiting); cancelling the save on close (the reviewer loses a ticket they already wrote).

**Known limitations:** if the reply is lost and the summary check misses (a different ticket with the same summary, or a create older than the window), a retry can duplicate; pending cards are local to the browser that made them; closing the overlay mid-save gives no warning, though the save continues.

**Applies to:** SPEC §10.5, §8.1; `src/bookmarklet/{form,index,sidebar,screenshot}.js`; `scripts/extension-harness/run.mjs`, `server.mjs`.

### D45 — Sidebar order: newest ticket first

**Status:** Resolved (2026-11-05)

**Question:** the ticket scan is `ORDER BY created ASC`, so the sidebar listed the oldest ticket at the top and a ticket the reviewer had just created landed at the bottom — often out of sight.

**Resolution:** the sidebar sorts tickets by `createdAt` descending before rendering. The sort is client-side (`src/shared/pinOrder.js`), so it does not depend on the server's scan order; ties keep their incoming order, and a ticket with no usable date sorts last rather than jumping to the top. URL groups keep their existing order; cards within a group are newest-first like the flat list.

**Rejected alternatives:** flipping the JQL to `DESC` (only one consumer wants it, and it would also reorder pagination inputs); sorting in the sidebar component alone (the pin layer, counts and defaults share the list).

**Applies to:** SPEC §10.2; `src/shared/pinOrder.js`, `src/bookmarklet/index.js`; `scripts/extension-harness/run.mjs`.

### D46 — Login and install flows: four principals, two surfaces

**Status:** Resolved (2026-11-05)

**Question:** the extension connects by pasting a canvas link, and every credential is a long-lived bearer token carried in a URL. What do the four ways a person starts using JiraTack look like, and what identifies them?

**Resolution:** four flows, signed off as a set.

1. **User / extension — log in, do not paste.** `chrome.runtime.onInstalled` opens a first-run page (no `onInstalled` handler exists today). *Log in with Atlassian* opens the JiraTack dashboard in a Jira tab; the resolver runs with a real `context.accountId` and mints a single-use 120-second login code bound to that account. The extension reads the code from the tab with `chrome.scripting.executeScript` — the pattern already used for `__jiratackActiveCanvas` — and exchanges it for a 90-day user token plus `apiUrl`/`sdkUrl`. No password is ever collected, and no separate Atlassian OAuth app or external review is involved. The paste box survives only as *Repair connection*.
2. **Guest / extension — a short qualifying code.** The sponsor issues the invitation per named person, exactly as today (name and email captured at issue time). The guest receives a short code (`JT-4F9K-2XQ7`); only `sha256(code)` is stored. The invitation link carries the code (`?code=…`), the installer page exchanges it and publishes the config the extension already consumes. The click-the-bookmarklet-first step disappears.
3. **User / bookmarklet — the personal credential stays in the link.** `sessionStorage` and `localStorage` are per-origin, so a bookmark cannot carry a session between sites; a credential-free link would mean a login on every new site. The link keeps a 90-day per-user token, minted from the signed-in dashboard and dragged rather than pasted. The cached session key moves from per-canvas to per-account.
4. **Guest / bookmarklet — the code is exchanged, never embedded.** The guest opens the invitation link and enters the short code once; the page hands back a bookmarklet carrying a strong guest credential, not the eight-character code, because that code would be visible in a bookmarks bar. Same scoping, revocation and 10-device cap as today.

Guests never receive QA-pack entitlements. Because a guest session's `sub` is the sponsor, any entitlement check must exclude `scope === 'guest_create'` explicitly; otherwise every guest inherits the sponsor's seat.

**Rejected alternatives:** a credential-free bookmarklet (a login popup on every new origin, because browser storage is per-origin); embedding the short guest code in the bookmarklet (a guessable eight-character credential in a bookmarks-bar URL); a separate Atlassian OAuth app for the extension (registration and external review for a flow a Jira tab already satisfies); collecting Jira credentials inside the extension (a phishing surface and a Web Store rejection).

**Known limitations:** the extension needs a Jira tab for its first login; it cannot sign in while no Jira session exists. The login code is deleted before the token is minted, so two requests racing on one code can both succeed — both mint tokens for the same account, so the outcome is two valid tokens rather than a cross-account leak. The bookmarklet link remains a bearer credential for 90 days and must not be shared. Guest codes are only as strong as their length and the rate limit on exchange.

**Applies to:** SPEC §6.5, §6.6, §8.1, §8.6; CONTRACTS §3.1, §4.7, Part 12; `src/extension/background.js`, `src/extension/options.*`, `src/resolvers/actions/admin.js`, `src/webtrigger/actions/exchangeToken.js`, `src/webtrigger/api.js`, `docs/EXTENSION-DISTRIBUTION.md`.

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
