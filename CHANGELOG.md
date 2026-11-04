# Changelog

All notable changes to JiraTack.

> **Historical note.** Entries below `[Unreleased]` record the sprint build and
> describe features that have since been removed (custom fields, provisioning,
> the description marker, recovery). They are kept for history and are **not**
> a description of current behaviour — see `SPEC.md` v3.0 for that. The
> `0.9.0`-style headings track `package.json`, not the Forge app version
> (currently 5.82.0 in development).

## [Unreleased]

### Canvas identity and dashboard

- **Stable canvas keys (D42).** A canvas is identified by its seed ticket key
  (`KAN-123`, or `c-xxxxxxxx` when there is no seed) instead of its display
  name, so canvases can be renamed and no longer collide. Tickets gain
  `pin.canvasId`; previous names stay indexed so older tickets still resolve.
  Rename lives on the canvas page and never changes the key.

- **Dashboard split into two jobs.** Anchors lead to **Install JiraTack**
  (bookmarklet, extension/guest) and **Canvases** (search, cards/list toggle,
  inline create panel). Creation is an inline panel with name, URL and the
  field↔value map — no modal, no project picker. Each canvas opens a dedicated
  page with **Pages / Fields / Access** tabs. The text-field catalogue moved to
  the admin page as an installation-level setting.

### Install, guests and organisation

- **One canvas identity resolver, and a registry health report.** Every surface now asks
  the same function which canvas an id refers to (key, name index, deterministic key, then
  an optional scan), so a missing index row no longer makes the admin page answer
  `NOT_FOUND` while the overlay works, and a key-shaped id can never create a phantom
  canvas. Tickets always record the label in `pin.canvas` and the key in `pin.canvasId`; the
  token response and `getPins` now return `canvasKey`. The admin page gains a read-only
  **Canvas registry** report: orphaned index rows, unindexed canvases, duplicate labels,
  previews, legacy preview keys, and tickets without a canvas — with samples.

- **Card previews have one storage generation.** Builds before 5.72 kept the
  preview in its own key as well as on the canvas record. Reading a canvas now
  adopts any image still held by the old key onto its record and deletes the
  old key, so there is one place to read, write and clear — and the previous
  generation stops being carried forward.

- **Card previews show the full page width.** The card was cropping the image
  with `object-fit: cover` inside a 16:10 box, so a viewport shot lost its left
  and right edges. The image now fills the card width and the card clips the
  bottom instead. The capture also always starts at the top-left and renders at
  the exact viewport width, so nothing is offset or off-screen.

- **One canvas is listed once.** A ticket written before `pin.canvasId` existed
  fell back to the `canvasName:` index; when that row was missing the launcher
  showed the canvas a second time with no key. Name resolution now falls back to
  the canvas records themselves, entries merge by label, and
  `ensureCanvasRecord` reuses a record already at the derived key instead of
  overwriting it (which used to discard the folder and the card preview).

- **Canvas previews can no longer be silently empty.** If the page capture
  returns nothing (a refused tab capture, a page the renderer cannot draw), the
  ticket's own screenshot is downscaled and stored instead. Encoding now steps
  down in size and quality until the image fits, so a valid preview can never be
  rejected by the storage cap, and a canvas id that is a record key resolves to
  its record rather than creating an orphan. When an attempt still produces no
  image, the reason is stored and shown on the canvas page under the preview
  state.

- **The extension's API calls no longer hit page CSP.** The SDK runs in the
  page's world, where a strict `connect-src` policy produced "Failed to fetch".
  Extension requests now go through the isolated-world bridge (immune to page
  CSP) and the background only relays to the configured `apiUrl`; the
  bookmarklet still posts directly and names the URL when the network refuses.

- **Canvas previews and URLs fixed.** The preview is stored on the canvas record
  (not a separate key), so **Clear preview** cannot miss it and the next ticket
  recaptures; a bare host typed as the canvas URL is honoured (https assumed)
  instead of being replaced with `https://example.com`, and non-http schemes are
  rejected; dashboard links open real new tabs via `router.open`, which works in
  the Custom UI iframe.

- **Build stamps.** The dashboard footer shows `SDK <hash> · UI <build time>` and
  the overlay header shows `SDK <hash> · <channel>`, so a stale build is visible
  rather than guessed. The harness now reproduces a stored text change on a page
  where the word appears several times.

- **Text-change previews render inline again.** The stored selection anchor is
  used (not just the text), JiraTack's own sidebar text can never be the match,
  and when the stored path spans nodes the preview re-resolves the phrase to a
  single text node so the replacement is shown inline instead of a box-only
  outline. A stale anchor no longer breaks the preview.
- **Issue type keeps its last-used default.** When Jira omits the previous type
  from the creatable list (or returns an empty list), the select keeps it
  visible and selected so the ticket stays saveable.
- **Text-change previews resolve after creation.** The stored suggestion now
  carries the precise node path of the original selection, so previewing it
  later no longer depends on the phrase being unique on the page.
- **Canvas previews, captured locally.** The first ticket on a canvas captures
  a viewport shot in the reviewer's browser and stores it once per canvas, so
  cards show a real preview with no external image service. Later tickets reuse
  the stored image; the client only captures when the canvas has none.
- **Pastel-style canvas cards.** The title links straight to the canvas's URL in
  a new tab, and the key, counts, date and actions live on a darkened hover
  overlay with **Open canvas** in the middle. No third-party screenshot service:
  a preview only appears if JiraTack captured one itself; otherwise the card
  shows the hostname. The capture-time thumbnail pipeline was removed.

- **Scale and polish (D43 follow-up).** The dashboard aggregate is cached per
  user for two minutes with server-side search and pagination; canvas cards show
  a capture-time thumbnail; an expired session says how to reconnect; a second
  installation asks for confirmation instead of being ignored; store URLs are
  admin settings; the guest invite page publishes its own config (no bookmarklet
  step) and supports zero-click enrollment once the extension ID is set; and the
  extension distribution policy is documented in
  `docs/EXTENSION-DISTRIBUTION.md`.

- **Install section split into four actions (D43).** The bookmarklet card now
  offers *Get bookmark* (scope drawer: selected canvases by default, or all
  canvases that stay current) and *Create a guest bookmark*. The extension card
  offers Chrome, Firefox (direct signed `.xpi`) and *Create a guest extension
  link*. Publication URLs are constants; until they exist the buttons say the
  extension is not published.
- **Guest extension continuity.** The invite page leads with the extension card
  when `mode=extension`: install → click the bookmarklet once → click the
  toolbar icon → the page turns 🟢 Connected. No paste, no reload, no
  `externally_connectable`. The bookmarklet remains the zero-install fallback.
- **Guest links now last 90 days** (was 72 hours); revocation and pause still
  apply immediately.
- **Folders.** The dashboard has a folder rail (All, Unfiled, each folder with
  counts); a canvas page moves the canvas into a folder.
- **Canvas discovery at scale.** The overlay launcher shows canvas name and key
  and adds a filter box when there are more than six canvases.

### Canvas configuration

- **The text-field catalogue is installation-only (D42 follow-up).** The
  per-project "Available text fields" control is gone; the catalogue lives on
  the Admin page, and a canvas pre-fill record no longer stores a project. The
  create-canvas field rows sit in a closed **Additional fields** accordion, and
  cards/list rows have a **Fields** action that opens the canvas editor
  directly.

- **Project field catalogue and canvas pre-fills (D41).** Admins now choose the
  text fields a project makes available (Project settings → **Available text
  fields**, text/URL fields only). Canvas creators pre-fill values for those
  fields from the create-canvas modal — inside a closed **Additional fields**
  accordion so the form stays compact — and can change them later from the
  dashboard row action **Fields**. A pre-filled value is written only when the
  field is on the Create screen for that ticket's project and issue type
  (checked per ticket); otherwise it is appended to the description, so nothing
  is dropped silently.

### Pins and dragging

- **Pin dragging is visible again (D33 amendments).** Three defects made every
  drag feel broken while the move itself still worked: a press that slid more
  than a few pixels while held was silently cancelled and could never arm
  (moving now arms the drag immediately); the drag marker was parented to
  `document.body`, so the push-mode fixed-shift pass treated it as a page
  element and shoved it 320 px away from the cursor (it now lives inside
  JiraTack's overlay, and no JiraTack element can be shifted by the
  fixed-shift pass); and the dragged pin faded to 35% opacity, which read as
  "the pin disappeared" (it now keeps full presence and changes colour).

### Filtering and navigation

- **Per-reviewer status filter (D38 amendment).** `Filter By Status ▾` opens an
  Excel-style checklist with `All` / `None` / `Reset` and one row per status on
  the canvas with its ticket count. Ticks mean "show", apply immediately to the
  pin layer and the list, and persist per canvas in `localStorage`. The project
  setting is now the default seed, renamed **Default filter setting**.

- **Selecting a ticket centres its pin.** Clicking a card (or using ↑/↓) scrolls
  the page so the pin sits in the middle of the viewport. Hovering only
  highlights; clicking a pin on the page never scrolls.

- **The overlay follows a cross-URL ticket click (extension, D40).** Clicking a
  card whose pin lives on another page now carries the overlay to that page
  automatically, landing on the ticket. Requires `host_permissions`
  (`<all_urls>`) because `activeTab` is revoked by navigation; the carry is
  one-shot, so ordinary browsing never drags the overlay along.

- **Viewport presets work on a maximised window.** The background normalises the
  window state before applying a width (Chrome ignores width on a maximised or
  full-screen window), **Fit** restores the previous width and state, the bar
  now lives inside the overlay so page layout cannot move or cover it, and a
  refused size reports a toast instead of failing silently.

### Delivery and platform

- **Extension self-enrollment (D39).** The extension no longer depends on
  pasting a bookmarklet link. While any JiraTack overlay is open, clicking the
  toolbar button reads the config that overlay is using, verifies it with a
  real token exchange, and stores it — connecting the extension, or repairing a
  stale copy, in one click. A different-origin candidate can never take over an
  existing installation, and the options page is demoted to a repair path.
  Failed exchanges now name the URL and content type they hit instead of a bare
  "invalid response".

- **Status rule replaces retirement (D38).** Marking a ticket done now takes
  it off the canvas by default — the project's rule is the single show/hide
  control. Project settings gets a **hidden statuses** rule: use the Done
  default or pick exact statuses (via the new `getProjectStatuses` resolver);
  `retirementDays` was removed entirely. The sidebar offers
  **View All** / **Filter By Status** with a hidden count; tickets a status
  literally named `Removed` are never returned at all.

- **Screenshot off the interaction path (D36).** The composer opens
  immediately and the capture happens on **Add to ticket**, after the composer
  is gone — the extension through the fast visible-tab capture, the bookmarklet
  through a single html2canvas run. Typing is no longer competing with a
  page-wide raster, and a slow capture surfaces a "Preparing screenshot…"
  toast instead of freezing the sidebar.

- **New Pin defers to the selection (D36).** With New Pin armed, a text
  drag-selection shows the **Suggest edit** pill instead of dropping a pin;
  arming New Pin no longer swallows the gesture. Pill selection is captured
  live during the drag (rAF) and read at capture-phase mouseup, so the pill
  survives the mouse release.

- **Immediate composer and grouped capture UI (D36).** The extension now captures the visible tab before the composer opens, so the
  browser never runs html2canvas while the reviewer types. The bookmarklet opens
  the composer immediately and runs html2canvas only when **Add to ticket** is
  pressed, after the composer is gone. The capture control is now
  **New Pin**, with the helper “Click an element to pin it, or select text to
  suggest an edit” and a filled, pressed state while armed. The form is split
  into **Assigned to**, **Ticket** and **Evidence** cards; Assignee is a
  tinted, accented first card with the reporter line inside. The selection pill now appears on mouse release and keeps its
  captured range even when the page collapses the native selection. The text
  change is its own card — `TEXT CHANGE`, a large centered **View on page** toggle,
  **Edit**, and a wrapping red/green pair — with no CONTENT wrapper.
  Attach/Record are stronger buttons with icons under **Evidence**. Summary
  drops the red “REQUIRED” word for a quiet asterisk, and the text-change
  summary now says `Text change: <original>`.

- **Current-tab recording without a picker (D37).** In the extension, Record
  screen captures the active tab through `chrome.tabCapture` and an offscreen
  recorder — no display picker, no window/screen choice. The button becomes
  **Stop recording** and the recorder caps at 60 seconds. The bookmarklet keeps
  `getDisplayMedia` with the current tab preselected. Chrome adds the
  `tabCapture` and `offscreen` manifest permissions.

- **New-ticket form hierarchy (D34, D36).** Details first: Assignee
  (autofocused; Project is focused instead only when unresolved), then Project /
  Issue type, the content carried from the popover (Summary, conditional
  text-change pair, Description), then Attach files / Record screen as peer
  buttons with the screenshot, chosen files and recording listed below them.
  Create/Cancel are sticky and `Cmd/Ctrl+Enter` submits. While composing, the
  sidebar hides filters, collapses the ticket list to one expandable line,
  removes Pin mode and disables pin dragging and canvas switching, so a draft
  cannot be replaced. The canvas seed ticket is hidden from the overlay list and
  pin layer. Toasts were moved off the sticky actions and no longer intercept
  clicks.

- **Popover capture and carried defaults (D36).** Pin mode opens an anchored
  composer with Summary and Description; **Add to ticket** hands that content to
  the sidebar, and the sidebar's Create is the only creation path. A text
  selection shows a **Suggest edit** pill that opens the replacement composer
  with **View on page**; there is no Text change mode. Every metadata field
  defaults from the newest non-empty value across the canvas's non-seed pins:
  project, issue type, assignee, priority and parent. Assignee falls back to the
  previous assignee → the current licensed user → the sponsor for guests. All
  defaults remain visible and editable. Composer placement flips and clamps to
  the viewport, and the geometry is unit-tested.

- **Text-change preview (D35).** A selection shows a **Suggest edit** pill
  (never an automatic capture). The composer owns the replacement and the
  preview: the sidebar shows a compact `Original → Suggested` pair with **Edit**
  and **View on page**, and Summary is prefilled `Text change: <original>`. The
  **View on page** switch previews the change: inline red strikethrough + green
  replacement for single-text-node selections, and a non-destructive marker
  bubble otherwise. Each show re-resolves the selection from its captured
  anchor, so repeated previews survive a page re-render; if it cannot resolve,
  the switch turns off with a hint. Hide, Cancel, Create and overlay close
  restore the page exactly.
  The pair is stored in `com.jiratack.metadata.textChange`; a ticket created
  with a text change shows an `Original → Suggested` switch on its card that
  re-previews it, including after the overlay is reopened, and the issue panel
  shows `Text change: Original → Suggested` on one line. New tickets only.

- **Pin move with screenshot supersede (D33).** Hold a pin ~400 ms, drag, release:
  selector, position and capture context are recomputed with the pin-mode rules,
  and a `Move <KEY> here?` bar appears beside the pin. Nothing is uploaded,
  written, or commented until **Confirm**; **Cancel**, `Esc`, closing the overlay,
  switching canvas, or starting a new ticket reverts locally and sends nothing.
  No timer or auto-commit, and no other pin can be dragged while the bar is open.
  On Confirm, a new `jiratack-<key>-<timestamp>.png` is attached through the
  chunked pipeline; old screenshots are kept and `screenshotVersion` increments.
  The issue panel renders the newest screenshot. The app posts
  `Pin moved and screenshot updated by <name> on <time>` when the pointer moved
  more than 4 px and the screenshot attached — name and time zone read from the
  reviewer's Jira profile (`UTC` when it cannot be resolved, and for guests).
  Screenshots exclude JiraTack's own chrome: the overlay and the extension's
  viewport bar are hidden for the capture and restored afterwards.

- **Extension capture features (D32).** Attachments capped by Jira's own
  `attachmentLimits`; on-screen text-edit suggestions (selection captured on
  `selectionchange`, because the pin click collapses it); WebM screen recording
  (60 s, VP8/Opus) through the attachment pipeline; viewport presets resizing the
  real window via an isolated-world bridge. Extension only: the bookmarklet has
  no extension APIs.

- **Browser extension (D32).** One codebase, three manifests. Injects the SDK
  into the tab on a toolbar click, from the isolated world, so the page's CSP
  does not apply. Verified in Chromium 156 on `instagram.com`, `github.com` and
  `linkedin.com` — all three refuse the bookmarklet — with the overlay and
  sidebar rendering in the page. `npm run build:extension`; see
  `docs/EXTENSION.md`.
- **CSP fallback loader (D22 amendment, D31).** When the host page refuses the
  external SDK script, the bootstrap fetches the bundle and injects it as an
  inline `<script>` — no `eval`, no popup, no iframe, screenshots and the
  overlay unchanged. The SDK web trigger now sends CORS headers for that fetch.
  Verified live on `montefioreeinstein.org`: the real 290 KB bundle loads and
  `__jiratackInit` becomes a function. Failures now name the step (download,
  inline script, or init) instead of assuming CSP.
- Measured that CSP blocks the bookmarklet in **two** stages: a `javascript:`
  URL is refused outright where `script-src` uses a nonce or hash (GitHub, MDN,
  LinkedIn, X, Stripe, PayPal, Outlook and others), and separately the external
  script can be refused where the bookmarklet does run. Only the second stage is
  fixable without the extension.

### Storage

- Pin metadata moved to the Jira issue property `com.jiratack.metadata`;
  descriptions are human-readable ADF only; labels `jiratack` /
  `jiratack-guest`; custom fields, provisioning, mapping audit, description
  marker, and recovery removed (D18).

### Security

- Per-operation server-side authorisation: `requireAdmin` on config, tokens,
  delete/archive, canvas creation; seat-licensed guest-link minting (D19).
- Token listings return `tokenRef` instead of raw credentials.
- Screenshots uploaded in ≤200 KiB base64 chunks; `createIssue` takes
  `screenshotUploadId`; all rendered URLs validated to `http(s)` (D20).
- Admin-only web-trigger actions enforce an issuance-bound `isAdmin` claim,
  failing closed when absent (D21).
- Session auto re-exchange on `TOKEN_EXPIRED` / `TOKEN_INVALID`.

### Client

- Guest links with a public installer page, canvas dropdown, guest identity
  capture, and licensed-assignee rule.
- Personal bookmarklet with a canvas launcher and inline canvas creation.
- Dual layout modes, push vs fit (D17).
- Form: Esc cancels, sticky Cancel, compact layout, issue-type default rules.
- Bootstrap reports SDK load failures in-page (CSP, Trusted Types, failed
  init, timeout) instead of removing the spinner silently (D22).

### Guest invitations (D29, 2026-11-02)

- Guest form shows the invited name/email read-only; guest tickets default the
  assignee to the sponsor; the installer names the sponsor and their email.
- Admin "Open link" now uses the Forge bridge (`router.open`); `window.open` is
  blocked inside the UI Kit iframe.
- The out-of-date banner now compares the **running** bundle version against the
  server (injected at build time), so revalidated bookmarks no longer show a
  false warning. SDK responses serve `no-cache` with an ETag and answer 304.
- Admin invitations render as a DynamicTable (aligned columns, one row per
  invitation) instead of stretched inline rows.
- Admin invitations resolve sponsor names for legacy rows, separate
  pre-identity links behind a warning, and the guest modal gains "All canvases".
- SDK responses revalidate with an ETag instead of `immutable`, so an existing
  bookmark picks up SDK fixes without a re-drag.
- Guest session cache also requires issuer/identity; otherwise it re-exchanges.
- Admin page rebuilt with a readable layout; legacy pre-identity links labelled
  and limited to Revoke.
- Fixed the admin invitations list (and token list) failing with "Provided
  request body is invalid": the paginated KVS helper passed a plain object to
  `where()` instead of `WhereConditions.beginsWith`.
- Assign To defaults to the sponsor for a guest's first ticket, then to the last
  assignee used.
- An out-of-date bookmarklet now says so in the sidebar, with a one-click link to
  the current installer URL for that invitation. The bundle is cached per
  version, so without this an old bookmark runs old code indefinitely.
- Guest sessions are cached per invitation token, not just per canvas. A new
  link no longer reuses a previous invitation's session (which showed empty
  name/email/assignee with a fresh bookmark).
- Cached guest sessions now carry a schema version, so a stale session can no
  longer hide the guest identity; invitations that predate named issuance show a
  warning instead of empty fields.
- Fixed the admin invitations list failing with "Provided request body is invalid"
  (Forge's bridge needs a payload object).
- Installer and guest sidebar show the address the invitation is bound to.
- Sponsor name/email are retried and persisted on first guest exchange, since
  Jira privacy often hides `emailAddress` at issuance.
- Dashboard success screen adds **Email link** (a `mailto:` with the guest
  address and installer URL). Forge has no outbound email, so this opens the
  sponsor's mail client rather than sending server-side.

- Guest links are now **named invitations**: the sponsor supplies the reviewer's
  name and email; the binding is created at issuance and the guest no longer
  enters identity in the sidebar.
- Pairings live until the invitation is deactivated or revoked; the 72h link
  gates only new devices. Invitation and pairing records no longer carry a KVS
  TTL, which had been deleting them at 72h regardless of policy.
- Admin page lists invitations with guest, email, sponsor, canvases, status,
  pairings and pin count, and offers Deactivate/Activate, New link and Revoke.
- Deactivation blocks guest writes immediately, not just new exchanges.
- Supersedes the "two emails on one bookmark" behaviour (Case 4): one invitation
  = one reviewer.

### Admin and hardening (2026-11-02)

- Fixed the token list failing on load: KVS rejects list queries at or above
  100 rows, and the query asked for 1,000. Both the token inventory and the
  pairing index now page with the cursor (50 per page).

- Admin page gains a canvas/guest token inventory with a Revoke action, wired to
  the existing admin-only resolvers. Revocation tombstones the record, so the
  list keeps an audit trail and the installer can render a revoked state.
- `exchangeToken` now rejects a malformed token before it reaches KVS: a stray
  character used to throw and surface as `INTERNAL` 500 instead of
  `TOKEN_INVALID` 401.

### Pairings (S2, 2026-10-31)

- Replaced the client-held credential model with pairings: `pairingId = SHA-256(inviteToken ‖ installId)`, 32-hex installId generated by the installer and cached per browser profile. The bookmarklet carries `inviteToken.installId` in the existing `canvasToken` field, so **no SDK change** and no re-drag.
- Pairings are recorded with a CAS insert (`keyPolicy: 'FAIL_IF_EXISTS'`), so concurrent exchanges for the same install cannot double-create. The cap (10) is counted from the append-only `pairingIndex:` rows, including revoked ones; pairing and index rows expire with the invite.
- `pairingId` is a JWT claim; `bindingId` is no longer a claim and is derived per ticket from the guest email. Guest tickets also carry `pairingId` in metadata for the A-22 audit join.
- Installer rewritten as a two-phase GET (shell attaches installId, then state renders), with expired/revoked/pairing-limit/not-found states, a two-option layout with the extension disabled, and the composite href built for the current installId. Legacy bare invites and the no-JS fallback share the `(invite, "")` pairing.
- Guest invite TTL is 72 hours for new invites (`mintedAfterCutover: true`); existing invites keep their original expiry and the installer does not claim a 72h limit for them.

### Bindings and identity (D24–D27)

- Guest pins now create or update a reviewer binding keyed by `HMAC(bindingSecret,
  normalised email)`, with lifetime and monthly pin counters and per-canvas
  access. Created at first pin; `issued → active` on success.
- `bindingId` is written into `com.jiratack.metadata`; `normalizeMetadata` was
  split into a pure model so the read-side drop is covered by tests.
- Guest tickets now attempt `reporter = issuer` and degrade gracefully
  (`reporter-not-set` warning) when Jira refuses the reporter.
- KVS compare-and-set corrected: `{ version: { type: 'must_be_missing' } }` was
  never a supported option, so secret creation was a plain overwrite. Now uses
  `keyPolicy: 'FAIL_IF_EXISTS'`.

### Page identity (D23)

- Normaliser rebuilt: tracking, cache-buster, version and random-value removal
  with a keep-list, replacing the blanket query-string drop.
- Pins store the canonical URL as captured, query intact, so identity can be
  re-derived; matching moved to render time.
- Sidebar gains Smart / Exact / Whole page match modes with per-mode pin counts,
  shown only when the counts differ, plus an empty-state rescue.

### Fixes

- Epic panel `totalTicketCount` is the canvas-wide count rather than a copy of
  `epicTicketCount`.

### Manifest

- Dropped `manage:jira-project` and `manage:jira-configuration`, unused since
  custom-field provisioning was removed (D18).

### Documentation

- `SPEC.md` v3.0, `ARCHITECTURE.md` v2.0, and `CONTRACTS.md` rewritten against
  shipped code; `DECISIONS.md` extended through D22; `TEST_PLAN.md` pruned of
  retired feature tests.

## [0.9.0] — 2026-10-26

MVP feature complete. Internal testing phase. **Superseded — see the note above.**

### Sprint 1 — Scaffolding, field provisioning, admin config

- Deployable Forge app with all six surfaces: global page, admin page, project
  settings page, epic panel, issue panel, and webtriggers.
- `provisionFields` resolver creates/reuses the four Jira custom fields.
- `installationConfig` KVS schema with `fieldRegistry`, `projects`,
  `viewPermissionMode`, `configVersion`, and defaults on cold start.
- Admin page with provisioning, field registry, and view-permission toggles.
- Added `manifest.yml`, `package.json`, Vite configs, and build pipeline.

### Sprint 2 — Token issuance and webtrigger API

- Shared `urlNormalize` and `adfSerializer` modules with acceptance-vector tests.
- HS256 session JWTs with a cached KVS signing secret.
- `generateCanvasToken` resolver with scope checks and `permittedProjects`
  computation.
- Six webtrigger actions: `exchangeToken`, `getPinsForCanvasAndUrl`,
  `createIssue`, `getTransitions`, `updateIssue`, `searchUsers`.
- Auth/scope middleware, `permittedProjects` pin filtering, error envelope, and
  pin-marker append on ticket creation.
- Resolved D10: `webTrigger.getUrl()` works; expose `apiUrl`/`sdkUrl` explicitly.

### Sprint 3 — Bookmarklet SDK

- Single-file IIFE bookmarklet bundle with inlined CSS.
- Content-hash `SDK_VERSION` generated by `scripts/embed-sdk.js`.
- Auth session cache in `sessionStorage`, overlay/sidebar/pins DOM per contract,
  and idempotent `__jiratackClose`.
- SDK served from the `jiratack-sdk` webtrigger.

### Sprint 4 — Capture flow

- Pin mode with `#1869DB` hover outline, tooltip, selector generation, and
  relative/absolute pin positions.
- Screenshot capture (400×400 webp@0.85) with graceful failure.
- Console proxy with a 50-entry circular buffer.
- New-ticket form, ADF description serialization, `createIssue` submission, and
  optimistic pin rendering.
- Retry-once when Jira rejects auto-created custom fields (pin marker remains
  as the recovery backup).

### Sprint 5 — Canvas dashboard

- `dashboardAggregate` with paginated JQL aggregation (counts, URL count,
  last-updated, project span, participants).
- Custom UI dashboard with search, canvas table, token table, write/review
  bookmarklet modals, and token revocation.
- Relative asset paths for Forge Custom UI hosting.

### Sprint 6 — Epic/issue panels and field mapping

- `epicPanelData` dual-query (company-managed + team-managed) with canvas counts.
- `issuePanelData` with canvas, page URL, deep link, and related tickets.
- `autoUpdateFieldMappings` adds the four fields to default screens, skipping
  unsupported Team-managed screens with warnings.
- Epic panel manifest `displayConditions: issueType: Epic`.

### Sprint 7 — Inline editing and lifecycle

- Inline editing of status (valid transitions), priority, and assignee with
  optimistic updates and rollback.
- Done animation: green flash → 1.5s hold → fade, card greyed with Done badge.
- Retirement window (D14): oldest-ticket project lookup, 300s KVS cache, Done
  tickets included within `retirementDays`.
- Marketplace prep: `docs/PRIVACY.md`, `docs/MARKETPLACE.md`.

### Sprint 8 — MVP UX polish

- Pin hover tooltips (key + summary).
- Project dropdown populated from `permittedProjects`.
- "Additional Fields" accordion for priority, assignee, parent, console output.
- Assignee typeahead via `searchUsers` (300ms debounce).
- Smart defaults: prefill project/assignee from an existing pin.
- Dynamic issue types per project via `getIssueTypes`; uppercase project keys.

## Known issues

- Screenshot attachment upload currently returns HTTP 415; ticket creation
  proceeds without the attachment.
- View-scope bookmarklet confirmation is not yet persisted per user
  (`reviewScopeConfirm:<userId>:<canvasName>`).
- `autoUpdateFieldMappings` targets default-named screens; projects using custom
  screen schemes may require manual field placement.
