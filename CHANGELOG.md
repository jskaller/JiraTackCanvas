# Changelog

All notable changes to JiraTack.

> **Historical note.** Entries below `[Unreleased]` record the sprint build and
> describe features that have since been removed (custom fields, provisioning,
> the description marker, recovery). They are kept for history and are **not**
> a description of current behaviour — see `SPEC.md` v3.0 for that. The
> `0.9.0`-style headings track `package.json`, not the Forge app version
> (currently 4.92.0 in development).

## [Unreleased]

### Delivery and platform

- Measured host-page CSP behaviour for the bookmarklet; recorded the delivery
  decision and adopted a content-script extension as the CSP-resilient channel
  (D22). Bookmarklet unchanged; strict-CSP sites still fail silently.

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

### Credentials (S2)

- Invite tokens can be paired up to 5 times; each pairing mints an independent
  credential token, stored only as its SHA-256 under `credentialTokens:`, with a
  `credentialsByParent:` reverse-index row written in the same `kvs.transact()`.
- `exchangeToken` resolves a credential through its parent invite, so revoking
  the invite invalidates every derived pairing without a fan-out write.
- Revocation now tombstones the record (revoked flag + 90-day TTL) instead of
  deleting it, so derived credentials and the admin list keep an audit trail.
- Fixed: `admin.js` used `kvs.query`/`kvs.delete` without importing `kvs`, so
  token listing and revocation threw at runtime.
- Added `PAIRING_LIMIT` (409, enforced) and `CAPACITY_EXCEEDED` (409,
  registered only).

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
