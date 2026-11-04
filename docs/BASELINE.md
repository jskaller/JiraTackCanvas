# Baseline — pre-pivot state

**Tag:** `baseline/pre-pivot-2026-10-30`
**Captured:** 2026-10-30
**Purpose:** an immutable reference point for the build as it stands before the business plan changes the product. Every "what changed since?" question resolves to this tag.

---

## 1. Versions

**Updated after the baseline deploy on 2026-10-31.** The tag still points at the pre-deploy commit; this section tracks current reality.

| | Value | Source |
| --- | --- | --- |
| Tagged commit (pre-deploy snapshot) | `git rev-parse baseline/pre-pivot-2026-10-30` | git |
| App version (deployed) | **5.82.0** | `forge deploy` output, `forge install list` |
| Development last deployed | 2026-11-04T23:25Z (scopes unchanged unless stated) | `forge deploy list` |
| Installation | upgraded to major 5 | `forge install --upgrade` |
| SDK hash (deployed) | `86da66a835c1` | served `ETag`, `src/lib/version.js` |
| SDK hash (tree) | `86da66a835c1` | `src/lib/version.js` |
| Bookmarklet bundle (tree) | 362,911 bytes (`dist/bookmarklet/jiratack.js`) | `npm run build` (byte-identical across rebuilds; `SDK_VERSION` is its SHA-256 prefix) |
| Bookmarklet URL length | ~3,500 chars with a 64-char token | `buildBookmarklet()` |
| Runtime | `nodejs24.x`, JavaScript only | `manifest.yml` |
| Scopes (deployed) | `storage:app`, `read:jira-work`, `write:jira-work`, `read:jira-user` | `forge version details` |

**Staging and production environments** also exist and were last deployed on 2026-10-24T15:07Z — older than development and not part of the active loop. Decide whether they are kept, refreshed, or removed; they are not a valid demo target today.

## 2. Deployed vs tree

**Deployed 2026-11-04.** Development runs the current tree as app **5.82.0**, SDK `86da66a835c1`, four scopes. No `forge install --upgrade` was needed: scopes were unchanged since 5.0.0.

| Change | Commits | Status |
| --- | --- | --- |
| Dropped `manage:jira-project` + `manage:jira-configuration` | `cf685a7` | **Deployed** — scopes confirmed as four |
| CSP failure card in the bootstrap | `027d590` | **Deployed** |
| Epic panel canvas-wide totals | `2c960de` | **Deployed** |
| Page identity (D23): normaliser, canonical storage, match modes | `6b50692`, `4733b9f`, `76d3d90` | **Deployed** |
| Docs rewrite | `2c06aa9` … `201bc2f` | No runtime effect |
| Pairings (S2 refactor) and the two-phase installer with 72h invites (S4/B1) | `82c18e8`, `792f0db`, `62966f6` | **Deployed** 2026-11-02 — server-side harness checks pass; manual cases in `docs/TEST-SCRIPT-S2-S4.md` still pending |
| Admin token inventory + revoke; malformed-token hardening | `5fbad06` | **Deployed** 2026-11-02 — unblocks TEST_PLAN Case 6 |
| KVS query pagination (token list + pairing index) | `376935b` | **Deployed** 2026-11-02 — the token list previously failed at 1,000 rows |
| Guest invitations: named reviewers, sponsor, deactivate/regenerate/revoke, pairings until revoked | `993f478` | **Deployed** 2026-11-02 — SDK changed to `b975e80725d7`; guest bookmarks must be re-dragged |
| Guest identity prefill, sponsor default/contact, mailto link | `f4fd5e3` | **Deployed** 2026-11-02 — SDK `b975e80725d7`; re-drag guest bookmarks |
| Admin list payload fix, bound-email display, sponsor backfill | `3efc160` | **Deployed** 2026-11-02 — SDK `b975e80725d7` |
| Session schema version; pre-identity invitation warning | `3942417` | **Deployed** 2026-11-02 — SDK `b975e80725d7` |
| Session cache keyed by invitation token; auth tests | `401c2b1` | **Deployed** 2026-11-02 — SDK `b975e80725d7` |
| Out-of-date bookmarklet notice with refresh link | `18daf6d` | **Deployed** 2026-11-02 — SDK `b975e80725d7`; last manual re-drag |
| KVS paginated query uses WhereConditions | `a1735bd` | **Deployed** 2026-11-02 — fixes the admin invitations list |
| Popover capture, selection pill, carried defaults (D36) | working tree (uncommitted) | **Deployed** 2026-11-03 as 5.37.0 — SDK `ed48471c681f` |
| Immediate composer, grouped UI, New Pin, tab-only recording (D36/D37) | working tree (uncommitted) | **Deployed** 2026-11-03 as 5.38.0 — SDK `734f61050568` |
| Standalone text-change card, wrapping pair, larger centered toggle, wording (D35/D36) | working tree (uncommitted) | **Deployed** 2026-11-03 as 5.39.0 — SDK `b236dedb171c` |
| Pill waits for mouse release and survives native selection collapse (D36) | working tree (uncommitted) | **Deployed** 2026-11-03 as 5.41.0 — SDK `c3cd88869218` |
| Screenshot off the typing path; pill captures the selection during drag (D36) | working tree (uncommitted) | **Deployed** 2026-11-03 as 5.42.0 — SDK `36d292155846` |
| Status rule replaces retirement; View All / Filter By Status; New Pin defers to the selection; capture only on Add (D38) | working tree (uncommitted) | **Deployed** 2026-11-03 as 5.43.0 — SDK `157010554ac8`; harness 138/138 |
| Extension self-enrollment: toolbar click connects/repairs from a live overlay; options page demoted; sharper exchange errors (D39) | working tree (uncommitted) | **Deployed** 2026-11-03 as 5.44.0 — SDK `71a0f4a09673`; harness 141/141 |
| Pin drag feedback: fast grab arms, ghost stays under the cursor, dragged pin keeps its presence and changes colour (D33 amendments) | working tree (uncommitted) | **Deployed** 2026-11-03 as 5.45.0 — SDK `40406e3d5ede`; harness 145/145 |
| Per-reviewer status checklist; card selection centres the pin; cross-URL overlay carry (D40, host permissions); viewport presets on maximised windows | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.46.0 — SDK `a2f3d8630170`; harness 153/153 |
| Canvas auxiliary text fields: description or mapped Jira field with a per-ticket Create-screen check and fallback (D41) | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.47.0 — SDK `a2f3d8630170`; unit 26, harness 153/153 |
| Project text-field catalogue + per-canvas pre-fills (create modal accordion, editable via row action), per-ticket Create-screen check with description fallback (D41 revised) | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.48.0 — SDK `a2f3d8630170`; unit 26, harness 153/153 |
| Field catalogue picker switched to checkboxes (UI Kit multi-Select would not open); creatable projects included in the canvas project list; save feedback | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.49.0 — SDK `a2f3d8630170`; lint clean |
| Stable canvas keys + registry, rename, `pin.canvasId`; dashboard split into Install/Canvases, inline create, cards/list toggle, canvas page (Pages/Fields/Access); installation-level field catalogue (D42) | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.50.0 — SDK `a2f3d8630170`; unit 26, harness 153/153 |
| Pre-fill cleanup: catalogue only on the admin page, per-project picker removed, `projectKey` dropped from the canvas record, create-canvas accordion, Fields action on cards/list | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.52.0 — SDK `a2f3d8630170`; unit 26, harness 153/153 |
| Install cards (4 actions), guest extension page with connected dot, 90-day guest links, folders rail, bookmark scope drawer, launcher filter + name/key (D43) | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.53.0 — SDK `02f0865f9265`; unit 26, harness 153/153 |
| Scale + polish: per-user aggregate cache and server-side search/pagination, capture-time canvas thumbnails, friendly session-expiry message, replace-connection confirmation, configurable store URLs, invite page self-enrollment, zero-click enrollment hook, enterprise distribution doc, wording (D43 follow-up) | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.54.0 — SDK `4dbdd732c1c0`; unit 26, harness 153/153 |
| Local canvas previews (no third-party image service), launcher current names, Clear preview, inline text-preview preference, build stamps, issue-type default fallback, element-path inline preview, own-UI exclusion, pin hover label/title removed, card accordion (5.55–5.71) | working tree (uncommitted) | **Deployed** 2026-11-04 up to 5.71.0 |
| Canvas previews stored on the canvas record (Clear cannot miss); bare-host target URLs honoured and invalid schemes rejected (unit-tested); dashboard external links use `router.open` (5.72.0) | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.72.0 — SDK `58044686e6ab`; unit 27, harness 166/166 |
| Restored `canvasKeyFromPayload` (delete/archive/clear/folder/rename were throwing); URL-shaped canvas name supplies the target when the URL field is blank (5.73.0) | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.73.0 — SDK `58044686e6ab`; unit 27, harness 166/166 |
| Extension API transport through the isolated bridge so page `connect-src` CSP cannot block it; background relays only to the configured `apiUrl` (5.74.0) | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.74.0 — SDK `7a6698c53dfd`; unit 27, harness 166/166 |
| Preview pipeline hardening: aggregate groups by the record key that holds the preview; tab capture falls back to an in-page render; canvas page reports whether a preview is stored (5.75.0) | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.75.0 — SDK `864f8cb2f7db`; unit 27, harness 166/166 |
| Preview state shown under the canvas title and at the top of the Fields tab, with one-click Clear (5.76.0) | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.76.0 — SDK `864f8cb2f7db`; unit 27, harness 166/166 |
| Preview capture fallbacks: ticket screenshot used when the page capture yields nothing, encoding steps down until it fits, key-shaped canvas ids resolve to their record, failure reason stored as `thumbnailNote` (5.77.0) | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.77.0 — SDK `1deef13a76c3`; unit 27, harness 166/166 |
| Clear preview updates the status line immediately instead of waiting for a refresh (5.78.0) | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.78.0 — SDK `1deef13a76c3`; unit 27, harness 166/166 |
| Launcher lists each canvas once: tickets without `pin.canvasId` resolve by name against the records when the name index is missing (unit-tested), entries merge by label, `ensureCanvasRecord` reuses a record already at the derived key instead of overwriting it (5.79.0) | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.79.0 — SDK `1deef13a76c3`; unit 28, harness 166/166 |
| Card preview shows the full page width: the card clips the bottom of the image instead of `object-fit: cover` cropping the sides, and the capture always scrolls to the top-left and renders at the exact viewport width (no offset) (5.80.0) | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.80.0 — SDK `86da66a835c1`; unit 28, harness 166/166 |
| Card previews have one generation: a pre-5.72 `canvasThumb:` key is adopted onto the canvas record and deleted; resolver/webtrigger tests (28) with in-memory Forge stubs; the deployment ledger is written and checked by a script | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.81.0 |
| One canvas identity resolver used by every surface (key, name index, deterministic key, optional scan); labels and keys separated in metadata; read-only registry health report on the admin page — architecture-review items 1 and 3 | working tree (uncommitted) | **Deployed** 2026-11-04 as 5.82.0 |

**Deployed scopes are the four in `manifest.yml`.** Confirmed with `forge version details -e development --non-interactive --json`: `storage:app`, `read:jira-work`, `write:jira-work`, `read:jira-user`. The two `manage:jira-*` scopes were dropped before 5.0.0.

**Consequence for bookmarks:** the SDK trigger serves the current bundle with `Cache-Control: no-cache` and `ETag: "<SDK_VERSION>"`, verified after the 5.79.0 deploy (`ETag: "1deef13a76c3"`). An existing bookmark revalidates and picks up SDK changes without a re-drag; the `?v=` in the URL is cache-busting, not a pinned version. A re-drag is only needed when the bootstrap in the bookmark URL itself changes (D31).

## 3. Development environment URLs

| Trigger | Key | URL |
| --- | --- | --- |
| API | `jiratack-api` | `https://47873476-1bf1-4291-9178-a65ef01abd46.hello.atlassian-dev.net/x1/Us8pTLsbDXsqHqcobrf71rFWy3E` |
| SDK | `jiratack-sdk` | `https://47873476-1bf1-4291-9178-a65ef01abd46.hello.atlassian-dev.net/x1/wyoCUU1yS9-KMKRe01iPdMH03CY` |
| Installer | `jiratack-install` | `https://47873476-1bf1-4291-9178-a65ef01abd46.hello.atlassian-dev.net/x1/pqfyQ4olXCvYoIGgU63lDe_9DdY` |

Regenerate with `forge webtrigger list -f <key> -s jiratack.atlassian.net -p Jira -e development --json`. URIs change if a trigger is deleted and recreated; they do not change on deploy.

## 4. Verification status

| Check | Result |
| --- | --- |
| `npm run build` | Clean; idempotent (`SDK_VERSION` stable across rebuilds) |
| `forge lint` | 0 issues |
| Unit suites (`node --test src/shared/*.test.js src/lib/*.test.js src/bookmarklet/*.test.js`) | 24 tests pass; 55 URL vectors, plus ADF/text/safeUrl and popover geometry |
| Extension harness (`npm run test:extension`) | 131/131 pass (immediate composer, defaults, grouped sections, New Pin state, standalone text-change card, preview, card switch) |
| Manual: current-tab recording without a picker (D37) | **Not run in the headless harness** — requires a real Chrome tab with an audible page and the extension invoked |
| Manual: status rule in project settings (D38) | **Not run against a live project** — settings UI, explicit status list, Removed status, and View All on a real canvas |
| Manual: pin drop on a heavy page (mlb.com) at 5.43.0 | **Awaiting verification** — capture now happens on Add, after the composer is dismissed |
| Manual: TEST_PLAN §2.20 resolver authorisation | **Not run** |
| Manual: TEST_PLAN §2.21 screenshot upload and URL safety | **Not run** |
| Manual: TEST_PLAN §3.12 CSP failure card | **Not run on a live strict-CSP site** (verified against a synthetic CSP page) |
| Manual: TEST_PLAN §3.13 match modes | **Not run against a real canvas** (verified in a stubbed harness) |

## 5. What is built

- Forge app, five surfaces: dashboard (Custom UI), admin page, project settings, epic panel, issue panel.
- Three web triggers: client API (12 actions), SDK bundle, public guest installer page.
- Three client channels: canvas bookmarklet (30 d), personal launcher bookmarklet (90 d), guest link (365 d).
- Pin data in `com.jiratack.metadata`; labels `jiratack` / `jiratack-guest`; `jiratackCanvas` search alias.
- Per-operation authorisation: resolver `requireAdmin`, web-trigger `isAdmin` claim, seat-gated guest minting.
- Chunked screenshot upload (≤200 KiB base64 chunks, 15-min TTL), http(s) URL allowlist.
- Inline editing incl. summary and description, dual layout modes, launcher and guest canvases.

Deliberately **not** built: browser extension (D22), data migration/backfill (D18), custom fields (removed), Run-on-Atlassian eligibility (D16).

## 6. Open items

Ordered by what would embarrass a demo or a review, not by effort.

1. **Deploy is outstanding and bumps the major version.** Run `forge install --upgrade -e development`, then `forge deploy`. Update the version line in this file and the doc headers afterwards.
2. **Strict-CSP sites cannot run the bookmarklet** (github.com, accounts.google.com, developer.mozilla.org, en.wikipedia.org). The failure is now explained, not fixed. Real coverage needs the extension (D22).
3. **Guest links delegate the issuer's browse access** for the selected canvases (D19). Accepted and recorded; needs to appear in Marketplace/privacy copy before review.
4. **Revocation lag ≤8 h** (D11) and **admin-claim staleness** at demotion (D21). Both are inherent to the token design; document, don't debug.
5. **`universal` is a vestigial scope.** Accepted in web-trigger allowlists and SDK scope checks, never minted by any generator. Dead capability; remove in a cleanup pass.
6. **`sessionSigningSecret` is stored as a plain KVS value**, not via `kvs.setSecret`. Migration documented in the security review, not applied.
7. **Epic panel queries do not paginate.** `searchIssues` in `epic.js` requests `maxResults: 100` with no page loop, so an epic with more than 100 children is silently truncated. The canvas-total scan does paginate; the epic queries do not.
8. **Scan caps.** Canvas reads stop at 2,000 tickets. `getPinsForCanvasAndUrl` reports `truncated`; dashboard and panels do not surface a partial-result signal.
9. **Duplicate helpers and dead code** (security review §5): `fetchJiraBaseUrl` ×3, `mapUser` ×2, `escapeJql` ×2; `readMetadata`, `successResponse`, and the never-written `config.webtriggerUrls` read.
10. **Marketplace materials are drafts.** `docs/PRIVACY.md` and `docs/MARKETPLACE.md` reflect current behaviour but need a final review pass, screenshots, support URLs, categories and pricing.
11. **No visual assets.** Every diagram in the docs is ASCII; there are no screenshots of the overlay, dashboard or guest flow.
12. **Property alias is not retroactive.** `jiratackCanvas` indexes from deployment forward; in-memory filtering remains the primary path for older tickets.
13. **The pivot itself is undecided.** D22 records the extension as the chosen CSP-resilient channel, but there is no scope, effort estimate or sequencing for it.

## 7. What this baseline does not capture

- **Dev KVS contents and test tickets.** Transient; D18 already chose no backfill.
- **`dist/` output.** Reproducible with `npm run build`; committing it would create a second source of truth.
- **Screenshots.** None exist.
- **The deployed bundle bytes.** Recorded only as a hash (`a2f3d8630170`), which is sufficient to detect drift.

## 8. How to re-verify this baseline

```bash
git rev-parse baseline/pre-pivot-2026-10-30
git status --porcelain                  # expect empty
npm run build                           # expect SDK_VERSION 276425585326
node --test src/shared/*.test.js src/lib/*.test.js src/bookmarklet/*.test.js   # expect all suites pass
forge lint                              # expect 0 errors
forge environments list --json          # expect development deployed
forge install list -s jiratack.atlassian.net -p Jira -e development --json   # expect majorVersion 5
forge version details -e development --non-interactive --json   # expect appVersion 5 and exactly four scopes
```

If any of those disagree, this document is stale and should be updated rather than trusted.

---

**Related:** `SPEC.md` (behaviour), `ARCHITECTURE.md` (shape), `CONTRACTS.md` (wire), `DECISIONS.md` (why), `TEST_PLAN.md` (verification), `docs/SECURITY-REVIEW.md` (findings and remediation), `docs/AI-CONTEXT.md` (brief for other agent contexts).
