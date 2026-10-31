# ARCHITECTURE.md — v2.0

**Audience:** OpenCode, first read. Context document; precedes `CONTRACTS.md`.
**Status:** Current. Describes shipped code only.
**Verified against:** tag `baseline/pre-pivot-2026-10-30` (2026-10-30), app 5.0.0, SDK `d5d8edafeda5`.
**Supersedes:** ARCHITECTURE.md v1.x (four custom fields, description marker, two web triggers).

Decisions referenced here are authoritative in `DECISIONS.md`. Wire-level shapes are authoritative in `CONTRACTS.md`.

---

## 1. System overview

```text
┌────────────────────────────────────────────────────────────────────────┐
│  FORGE APP (single deployable, nodejs24.x)                             │
│                                                                        │
│  Surfaces                                                              │
│    jira:globalPage            → Canvas dashboard (Custom UI)           │
│    jira:issuePanel (Epic)     → Epic panel (UI Kit)                    │
│    jira:issuePanel (any)      → Issue panel (UI Kit)                   │
│    jira:projectSettingsPage   → Project configuration (UI Kit)         │
│    jira:adminPage             → Installation configuration (UI Kit)    │
│  Module                                                                │
│    jira:entityProperty        → pin.canvas indexed as `jiratackCanvas`  │
│                                                                        │
│  Functions                                                             │
│    resolver                   → 15 in-Jira resolvers                   │
│    webtrigger-api             → POST /api, 12 client actions           │
│    webtrigger-sdk             → GET  /, minified SDK bundle            │
│    webtrigger-install         → GET  /?token=…, guest installer (HTML)  │
│                                                                        │
│  Storage (@forge/kvs)                                                  │
│    installationConfig                                                  │
│    canvasTokens:<token>       canvas and guest records                 │
│    userTokens:<token>         personal-token records                   │
│    jiratack_licensed_users:<accountId>                                 │
│    sessionSigningSecret                                                │
│    screenshot:<uploadId>[:NNN]  15-minute TTL                          │
└────────────────────────────────────────────────────────────────────────┘
                    ▲                              ▲
                    │ HTTPS, Bearer <sessionJwt>   │ GET installer page
                    │                              │
┌───────────────────────────────┐      ┌───────────────────────────────┐
│  BOOKMARKLET SDK              │      │  GUEST (no Jira session)      │
│  runs in the target page      │      │  opens install URL, drags     │
│  • overlay, pins, sidebar     │      │  bookmarklet, then behaves    │
│  • auth, capture, form, edit  │      │  as the SDK in guest scope    │
│  • console + screenshot       │      └───────────────────────────────┘
└───────────────────────────────┘
                    ▲
                    │ user clicks bookmarklet
┌────────────────────────────────────────────────────────────────────────┐
│  TARGET WEB PAGE (any site; host CSP applies — §11)                    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. The single core principle

**Jira tickets are the pin store.** Every pin is a ticket: create a pin = create issue, query pins = search + property filter, update = update issue, retire = filter.

Two artefacts carry the data:

- **`com.jiratack.metadata`** (issue property) — canvas, URL, position, selector, and guest identity. Machine-readable truth (D18).

- **`jiratack` label** (plus `jiratack-guest`) — the query index. Every read is `labels = "jiratack"` followed by an in-memory property match.

The description is human-readable only: a bold header, the user body, an optional console block, and a page link. There is no marker and no second copy of the data.

There are no Jira custom fields. Nothing is provisioned at install time; the app writes one property and two labels per ticket.

---

## 3. Client channels

All three run the same SDK; only the embedded token and `canvasId` differ.

| Channel | Resolver | TTL | `canvasId` | Behaviour |
| --- | --- | --- | --- | --- |
| Canvas bookmarklet | `generateCanvasToken` | 30 d | canvas name | Bound to one canvas |
| Personal bookmarklet | `generateUserToken` | 90 d | `universal` | Launcher: pick a canvas, optionally create one |
| Guest link | `generateGuestToken` | 72 h (new); grandfathered 365 d | first permitted canvas | Dropdown limited to `permittedCanvases` |

The personal channel is not a scope. It mints `create` or `view` — whichever the user's seat allows — and the SDK branches on `canvasId === 'universal'`. The guest channel is a scope (`guest_create`) *and* a claim set (`issuer`, `permittedCanvases`, `isAdmin: false`).

`universal` also appears as a *scope* string in some web-trigger allowlists and SDK checks. No generator ever mints it; treat it as vestigial and remove it during the next cleanup pass.

---

## 4. Token classes and enforcement points

| Class | Issued where | Gate | Enforced where |
| --- | --- | --- | --- |
| Canvas token — create | `generateCanvasToken` | Seat + canvas browse access | KVS record, then JWT scope |
| Canvas token — view | `generateCanvasToken` | Canvas browse access | JWT scope |
| Personal token | `generateUserToken` | Seat (else downgraded to `view`) | JWT scope |
| Guest token | `generateGuestToken` | Seat + 1–50 canvases | JWT scope, `permittedCanvases`, `permittedProjects` |
| Session JWT | `exchangeToken` | Record valid + installation licensed | Every call (8 h) |

Web triggers never call `userAccess` and never call `api.asUser()` — they have no user identity. That single fact drives the whole token design: the authoritative permission check happens once, at issuance, in resolver context, and the result travels in the JWT.

---

## 5. Data flow — pin creation

```text
User clicks the bookmarklet on a target page
  → bootstrap injects <sdkUrl>?v=<sdkVersion>
  → __jiratackInit({ token, apiUrl, sdkUrl, canvasId, canvasName, sdkVersion })
  → no cached JWT? → exchangeToken
  → JWT carries scope, permittedProjects, isAdmin
  → getPinsForCanvasAndUrl({ canvasId, url, all: true })
      server: labels="jiratack", properties=[com.jiratack.metadata]
      filter: canvas, permittedProjects, retirement window
  → client filters by URL with the selected match mode (smart | exact | path)
  → render overlay
User activates pin mode and clicks an element
  → compute selector + position
  → snapshot console buffer
  → html2canvas → 800 px webp crop (in memory)
User submits the form
  → beginScreenshotUpload → uploadScreenshotChunk × N
  → createIssue({ …, screenshotUploadId })
      validate scope/claims, canvas access, project access, project enabled, http(s) URL
      POST /rest/api/3/issue
      PUT  /rest/api/3/issue/{key}/properties/com.jiratack.metadata   (retry once)
      assemble chunks → POST attachments → delete upload
  → optimistic pin + single canvas re-fetch to hydrate the real record
```

Failure ordering is deliberate:

- A failed metadata write does **not** delete the ticket; it returns `warning: "metadata-not-stored"` and the UI says the pin could not be saved.

- A failed attachment or an expired upload does **not** fail creation.

- A failed screenshot capture does **not** block the form.

---

## 6. Data flow — guest review

```text
Seat holder, in the dashboard
  → generateGuestToken({ permittedCanvases })
  → server: seat check, 1–50 canvases, permittedProjects from the ISSUER's access
  → returns installerUrl = <install>?token=<guestToken>
Guest receives the link
  → install page renders a draggable bookmarklet (public HTML, no Jira session)
  → clicks it on the target page
  → exchangeToken → JWT scope=guest_create, issuer, permittedCanvases, isAdmin=false
  → SDK shows a canvas dropdown limited to permittedCanvases
  → getPinsForCanvasAndUrl → pins filtered by permittedProjects and canvas
Guest creates a ticket
  → form requires name + email + a licensed JiraTack assignee
  → labels: ["jiratack", "jiratack-guest"]
  → description header: [JiraTack Guest: <name>]
  → metadata.guest: { name, email }
  → server does NOT set reporter (there is no reporter identity)
```

**The delegation is real and recorded.** A guest link carries the issuer's browse access for the chosen canvases. A seat holder can expose projects they can see to someone with no Jira account. Canvas scoping plus a short invite expiry bound it; D19 records the trade-off rather than leaving it implicit, and D26 sets 72 h for new invites.

---

## 7. Data flow — personal launcher

```text
Licensed user clicks their personal bookmarklet
  → exchangeToken → scope create (or view)
  → canvasId === 'universal' → SDK enters launcher mode
  → listCanvasesForUser (excluded for guest scope)
  → auto-select if exactly one canvas contains the current URL
  → otherwise show the canvas list; "Create canvas" when scope is not view
```

`createCanvas` is admin-only on both paths (resolver `requireAdmin`, web trigger `requireAdminClaims`). The launcher showing a button is a convenience; the claim is the control (D21).

---

## 8. Runtime environment

- **Node.js 24.x** — Forge-supported active LTS. Not 18 (EOL), not 22 (maintenance LTS).

- **JavaScript only** — no TypeScript, no Python.

- Forge functions use static `import` at file top; no dynamic `import()`.

- UI Kit for the four panel/config surfaces; Custom UI (React + Vite) for the dashboard only.

- The SDK is a Vite build, embedded as a string in `src/lib/sdk-bundle.js` by `scripts/embed-sdk.js`, and served by the SDK web trigger.

- `npm run build` regenerates the bundle and `src/lib/version.js` (`SDK_VERSION` = first 12 hex of the bundle hash, D13). Bookmarks embed the version at generation time, so an SDK change means re-dragging the bookmarklet.

---

## 9. Authorization boundaries

Two enforcement mechanisms, because two execution contexts exist.

| Context | Can it know the user? | Mechanism |
| --- | --- | --- |
| Resolver (`jira:*` module) | Yes — `context.userAccess`, `asUser()` | `requireAdmin(context)` per operation |
| Web trigger | No | `requireAdminClaims(claims)` on the `isAdmin` claim |

Admin-only: installation and project configuration, token listing and revocation, canvas delete/archive, canvas create.

Seat-only (any user holding a JiraTack seat): canvas, personal, and guest token minting; dashboard aggregation; panel reads.

The dashboard and panels are open to every logged-in site user by design — they are read surfaces scoped by Jira's own permissions via `asUser()`. Page-level `access` scopes therefore cannot be the control, which is why every privileged resolver re-checks (D19).

Admin status is resolved at issuance and frozen in the token. A demotion takes effect at the next issuance or session expiry (≤8 h), the same window as token revocation (D11).

---

## 10. Storage inventory

| Key | Contents | TTL |
| --- | --- | --- |
| `installationConfig` | `viewPermissionMode`, `projects`, `archivedCanvases`, `deletedCanvases`, `configVersion`, `updatedAt`, `schemaVersion` | none |
| `canvasTokens:<token>` | Canvas records (`canvasName`, `userId`, `scope`, `isAdmin`, `permittedProjectsJson`, `expiresAt`) and guest invite records (`issuer`, `permittedCanvases`, `mintedAfterCutover`) | 30 d / 72 h (365 d grandfathered) |
| `userTokens:<token>` | `userId`, `scope`, `isAdmin`, `permittedProjectsJson`, `expiresAt` | 90 d |
| `jiratack_licensed_users:<accountId>` | `true` — written whenever a seat holder uses a resolver | none |
| `sessionSigningSecret` | 32-byte hex, HS256 key | none |
| `screenshot:<uploadId>` + `:NNN` | Upload manifest and base64 chunks | 15 min |

Notes:

- KVS values are capped at 240 KiB; a web-trigger body is community-measured at ~5 MiB and undocumented. That combination is why screenshots are chunked (D20).

- `sessionSigningSecret` is stored as a plain value, not with `kvs.setSecret`. Migration is tracked in the security review.

- `installationConfig` reads throw on failure rather than returning defaults; writes go through `mutateInstallationConfig` (read and write in one window, 3 attempts). `kvs.transact()` is available for true compare-and-set; adopting it is follow-up work.

- There is no pin storage, no URL index, and no per-canvas table. Everything derives from Jira search.

---

## 11. Delivery constraints of the shipped client

The bookmarklet loads the SDK as `<script src="{sdkUrl}?v=…">`. That request is governed by the **host page's** `script-src`, and the browser is the arbiter — nothing the app does can override it.

Measured on live sites (2026-10-29/30, real deployed web trigger, Chromium):

| Site | CSP shape | External SDK |
| --- | --- | --- |
| github.com | `script-src <assets> 'sha256-…'` | Blocked |
| developer.mozilla.org | `script-src 'self' …` | Blocked |
| en.wikipedia.org | `script-src … 'self' …` | Blocked |
| accounts.google.com | nonce + Trusted Types | Blocked (Trusted Types first, then `script-src`) |
| example.com, shopify.com, login.salesforce.com, theguardian.com, w3.org | none, or `https:`/`frame-ancestors` only | Loads |

Consequences for this architecture:

- The failure is now **explained in-page**: `src/shared/bookmarklet.js` catches `onerror`, a synchronous `s.src` throw (Trusted Types), a loaded script that never initialised, and a 15-second timeout, then replaces the spinner with a reason and a Dismiss button. The site still cannot run the client.

- Inlining the SDK does not help — the bundle is 284 KB at this build, far beyond practical `javascript:` URL length, and injected inline scripts are themselves blocked on the strict sites above.

- An iframe fallback does not help — the web trigger sends `X-Frame-Options: deny`, and strict sites block the frame with `frame-src`.

- The chosen direction is a content-script extension, whose isolated world is not subject to the page's `script-src`. That is recorded in D22 and owned by the alignment document; no extension code exists in this repository.

Any change to the delivery mechanism must preserve the property that the SDK talks to the web trigger with a JWT and never to Jira directly.

---

## 12. Known constraints

1. **Console capture begins at activation, not page load.** Documented in the sidebar. Accepted.

2. **`html2canvas` fails on some pages** (CORS, tainted canvas, very large documents). The form warns and proceeds without an image. Accepted.

3. **`asUser()` is unavailable in web triggers.** All web-trigger Jira calls run as the app; identity comes from JWT claims. This is why reporter, permissions, and admin rights are all resolved at issuance.

4. **Tickets without `com.jiratack.metadata` are invisible.** There is no backfill and no recovery path (D18). Pre-existing tickets created before the property existed simply do not appear.

5. **The `jiratackCanvas` alias is not retroactive.** Property indexing applies from deployment forward; the app therefore treats in-memory filtering as the primary path and the alias as an optimisation.

6. **Search is capped.** Overlay and panel queries scan up to 2,000 issues; `getPinsForCanvasAndUrl` reports `truncated` when the cap is hit. A canvas larger than the cap will render partially, and must say so rather than imply completeness.

7. **Revocation and admin status are eventual.** Both are bounded by the 8-hour session lifetime (D11, D21).

8. **Guest links delegate the issuer's access.** Bounded by canvas scope and a short invite expiry (72 h for new invites, D26); recorded in D19.

9. **Strict-CSP sites cannot run the bookmarklet at all.** §11. The bootstrap now states why instead of failing silently; running there requires the extension channel (D22).

10. **Page identity is inferred, so it can be wrong.** Pins store the URL as captured and identity is derived at read time; the reviewer can switch between Smart, Exact and Whole page when the inference misleads (D23). The heuristic still has edge cases in both directions.

---

## 13. What is not in scope

- No Java or Python.

- No external proxy or CDN.

- No second deployable, no Forge Containers.

- No `external.fetch.backend` egress (removed, D16).

- No persistent client state beyond `sessionStorage` (JWT, layout mode, navigation state).

- No `asUser()` in web triggers.

- No pin retirement scheduler (retirement is a filter).

- No `doneAt` field (`statusCategoryChangedDate` is authoritative).

- No Jira custom fields, provisioning, mapping audit, description marker, or recovery (D18).

- No extension code in this release; the channel decision is D22 and the implementation belongs to a separate body of work.

---

**End of ARCHITECTURE.md v2.0.**
