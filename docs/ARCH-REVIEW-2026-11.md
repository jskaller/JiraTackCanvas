# Architecture review — November 2026

**Scope:** one read-only pass over the current tree (5.81.0). Bug-squashing speed and
runtime efficiency weighted equally. Nothing was changed to produce this document.

**Verdict:** the complexity is concentrated, not diffuse. Five structures account for
almost every bug of the last two days. Three of them can be simplified without touching
behaviour, in days not weeks. The overlay's 2,071-line state object is the one item that
needs a real project, and it is not the most urgent.

**Top three recommendations**

1. Give the canvas id a single type and one resolver (§4, item 1).
2. Make the registry observable before deleting any more fallbacks (§3, item 3).
3. Cut the two O(all canvases) scans off the hot paths (§5, items 2 and 4).

---

## 1. Method

- File inventory and line counts from the source tree (tests counted separately).
- Import graph: 111 source files, entry points from `manifest.yml` and the Vite configs.
- KVS inventory: every `kvsGet/Set/Delete/QueryAll` call site and every key builder.
- Call budget: counted from the code paths, worst case at the documented caps
  (2,000 tickets, 50-row pages), not measured against a large install.
- Coverage map: each test file mapped to the layer it exercises.
- Docs cost: line counts and how many documents a behaviour change touches.

**Not examined:** UI Kit surface behaviour, extension permissions correctness, Jira payload
correctness, security posture (`docs/SECURITY-REVIEW.md` is separate), visual quality.

---

## 2. Surface map

19,247 lines of non-test source in 111 files.

| Tree | Files | Lines | Role | Tests |
|---|---:|---:|---|---|
| `src/bookmarklet` | 26 | 8,298 | overlay SDK: pins, sidebar, form, capture, text preview, drag | 166 harness assertions + 3 unit files |
| `src/lib` | 29 | 2,332 | registry, config, metadata, tokens, invites, kvS wrappers | 10 unit files |
| `src/webtrigger` | 19 | 2,490 | public API actions, installer page, SDK bundle trigger | 2 resolver-style files (new) |
| `src/resolvers` | 7 | 1,996 | dashboard/admin/issue resolvers | 2 files, 28 tests (new) |
| `src/custom-ui` | 13 | 1,870 | dashboard: cards, canvas page, drawers, modals | **none** |
| `src/ui-kit` | 4 | 780 | admin page, issue panel, epic panel, project settings | **none** |
| `src/extension` | 4 | 876 | background, bridge, offscreen, options | harness covers background/bridge only |
| `src/shared` | 9 | 605 | URL normalisation, ADF, pin move, safe URL, seed pin | 9 unit files |

Largest files (maintenance gravity wells):

| File | Lines | Note |
|---|---:|---|
| `bookmarklet/index.js` | 2,071 | one `current` object holds pins, composer, drag, status, hydration, nav |
| `bookmarklet/form.js` | 1,199 | ticket form, attachment upload, create call |
| `bookmarklet/sidebar.js` | 877 | launcher, cards, status panel, accordion |
| `resolvers/actions/admin.js` | 827 | 15 actions, three authorisation styles |
| `extension/background.js` | 516 | enrolment, carry-over, resize, API relay |
| `custom-ui/dashboard/App.jsx` | 490 | install cards, search, folders, cards/list routing |
| `bookmarklet/inlineEdit.js` | 466 | inline field editing |

---

## 3. KVS inventory (15 namespaces)

| Namespace | Owner | Writers | Readers | Generation / notes |
|---|---|---|---|---|
| `canvas:<key>` | `canvasRegistry` | registry | aggregate, getPins, admin, createIssue | **Record** v1; carries `thumbnail` (v2), `thumbnailNote`, `folder`, `names` |
| `canvasName:<normalised>` | `canvasRegistry` | registry, ensure | registry, dashboard | Name index; rows can be missing (observed) |
| `canvasThumb:<key>` | — | *none* | adopt + clear only | **Dead generation**; migration adopts and deletes on read |
| `canvasAux:<sha1(key)>` | `fieldPrefill` | admin, canvas create | createIssue, admin | Pre-fills; key is a digest, so only reachable from a canvas key |
| `canvasSummary:<accountId>` | `dashboard` | aggregate | aggregate | Cache, 1 h TTL, invalidated on writes |
| `canvasTokens:<token>` | `invites` + `admin` | token mint, exchange | exchange, install, list | **Dual use**: guest invitations *and* canvas tokens, split by `scope` |
| `userTokens:<token>` | `admin` | personal bookmark mint | exchange | — |
| `bindings:<id>` | `bindings` | pin record | createIssue, admin | Guest pin ledger |
| `pairings:<id>`, `pairingIndex:<ref>:<id>` | `pairingService` | pairing create | exchange, webtrigger auth | Guest session binding |
| `jiratack_licensed_users:<accountId>` | `license` | every licensed resolver call | guest create check | Seat tracking |
| `installationConfig` | `config` | many | many | Single config document, mutation-retried |
| `screenshot:<id>` + `screenshot:<id>:<NNN>` | `screenshotUpload` | chunked upload | attach | 15 min TTL, up to 72 chunks |
| `sessionSigningSecret` (secret) | `tokens` | first use | every JWT verify | — |
| `bindingSecret` (secret) | `secrets` | setup | guest create | — |

Findings:

- **One dual-use prefix.** `canvasTokens:` holds both guest invitations and canvas access
  tokens. Every listing and cleanup has to filter by `scope`; today only the admin list
  does. A wrong filter is a security bug, not a cosmetic one.
- **Two unreachable-by-key namespaces.** `canvasAux:` is keyed by a digest of the canvas
  key, so a stored pre-fill cannot be found from a name at all. That is fine while keys are
  canonical, and dangerous while ids are sometimes names.
- **No single owner for TTLs.** 15 minutes, 30 days, 90 days, 1 hour are defined in four
  different modules.

---

## 4. Canvas identity — the codebase's main source of bugs

There are eight distinct paths that decide "which canvas is this", and the *same field name
means two different things* on two wires:

| # | Path | Where | Identity used |
|---|---|---|---|
| 1 | Request payload `canvasId` | `getPins`, `createIssue`, `listCanvasesForUser` filtering | **a name** |
| 2 | `metadata.pin.canvas` | every ticket | name at capture time |
| 3 | `metadata.pin.canvasId` | tickets written since D42 | **a key** |
| 4 | `canvasName:` index | registry | name → key |
| 5 | `canvas:<key>` record | registry | key → record (current name + aliases) |
| 6 | Generated key | registry | `sha1(name)[0:8]`, for canvases with no seed ticket |
| 7 | Seed ticket key | registry | `KAN-123` |
| 8 | `canvasKeyFromPayload` | five admin actions | key, else name **via index only** |

**The trap:** `payload.canvasId` is a *name* (the client sets `canvasId: current.canvasName`,
and that name is written to `pin.canvas`), while `pin.canvasId` is a *key*. One field name,
two types, four call sites. Every bug of the last two days is downstream of this:

- the launcher showing one canvas twice (a ticket without `pin.canvasId` fell into a
  keyless bucket);
- the preview written under a key the card never read;
- a key-shaped id creating an orphan record named after the key.

**Asymmetry worth fixing regardless:** path 8 (`canvasKeyFromPayload`) has no
record-name fallback, while `getPins` and the dashboard do. With a missing index row (the
canvas that consumed yesterday), `getCanvasConfig`/`setCanvasConfig`/`clearCanvasPreview`
by name answer `NOT_FOUND` while the overlay works fine. Delete and archive survive only
because they also accept a raw name. Same canvas, five actions, two different answers.

**Proposal (item 1):** `canvasId` means a registry key on every wire; the label travels as
`canvasName`. One server resolver, `resolveCanvas({ canvasKey, canvasName })` → record,
used by the five admin actions that take an id by name, `getPins` and `createIssue`, with
legacy tolerance inside it only. Delete `canvasKeyFromPayload`'s duplicate logic, the dashboard's `ensure` branch,
and the dead `resolveCanvasKey`.

---

## 5. Call budgets (worst case, at the documented caps)

Caps: ticket scan 2,000 × 100/page = 20 Jira requests; records 2,000 × 50/page = 40 KVS
queries; name index 5,000 × 50/page = 100 KVS queries. All sequential (`await` per page).

| Flow | KVS reads | Jira requests | Cache | Runs |
|---|---:|---:|---|---|
| Dashboard, cold | ~144 + 2 × canvases without preview | 22 | 1 h per account | page open |
| Dashboard, warm | **~42** | 0 | 1 h | page open |
| Launcher open | **~141** | 20 | **none** | every overlay open |
| `getPins`, index hit | ~3 | 20 | none | init + **every 15 s** |
| `getPins`, index miss | **~43** | 20 | none | init + **every 15 s** |
| `createIssue` | ~4 | 2–7 | — | per ticket |
| Issue panel | ~3 | 1–2 | — | per render |

Findings:

1. **The warm dashboard still scans every record.** `computeAggregate` is cached, but
   `dashboardAggregate` calls `loadCanvasRecords()` again on every request just to attach
   previews (line 291). ~42 queries per page view where 2 would do.
2. **The launcher has no cache at all.** ~141 queries + up to 20 searches on every overlay
   open. The record list and name index change rarely and both already have invalidation
   hooks for writes.
3. **The `getPins` fallback is O(all canvases) on a 15-second loop.** When the name index
   misses (exactly the case observed), every poll loads all records: ~43 queries, ~10,300
   an hour for one open tab. A single deterministic read
   (`generatedCanvasKey(name)` → `canvas:<key>`) replaces the scan; the client already
   knows the key and could simply send it.
4. **My own migration added cost.** The legacy-preview adoption reads the record *and* the
   old key for every canvas without a preview, on every cache fill. Bounded by the 1 h TTL
   and gone once canvases have previews, but it should be retired with the migration.

None of this matters on a 12-canvas install (one page, one query each); it matters at the
scale the 2,000-ticket cap exists for. Items 2 and 4 are cheap and measurable.

---

## 6. Test coverage map

| Layer | Coverage | Gaps |
|---|---|---|
| `src/shared` (9 files) | 9 unit files | — |
| `src/lib` (29 files) | 10 unit files + resolver tests | `invites`, `bindings`, `canvasRegistry` only indirectly |
| `src/bookmarklet` (26 files) | 166 CDP harness assertions + 3 unit files | rendering states, drag edge cases, text preview resolution |
| `src/resolvers` (7 files) | **28 tests (new)** | `issue.js`, `epic.js`, `config.js`, `invites.js` |
| `src/webtrigger` (19 files) | 2 files (new) | **`exchangeToken`** (sessions!), `updatePinPosition`, `screenshotUpload`, `attachments`, `listCanvasesForUser` |
| `src/custom-ui` (13 files) | **none** | every dashboard component |
| `src/ui-kit` (4 files) | **none** | admin, issue panel, epic panel, project settings |
| `src/extension` (4 files) | background/bridge via harness | options page, manifests |

Ranked by risk, not by size: `exchangeToken` (session minting/renewal, the one thing every
surface depends on), then the dashboard components (where two bugs landed yesterday),
then the upload path. The stub harness added tonight makes the server-side ones cheap — the
same shape as the existing `admin`/`getPins` tests.

---

## 7. Dead code and documentation drift

- **Dead export:** `resolveCanvasKey` (canvasRegistry) is defined and never imported.
  It is the second identity resolver that survived the consolidation — exactly the kind of
  thing that gets used again by mistake.
- **No dead modules.** The import graph shows every file reachable from an entry point.
  The wasted code is *inside* the large files (unused branches and legacy paths), not in
  orphaned files.
- **Docs: 7,285 lines across 11 documents**, and a behaviour change touches five of them
  (SPEC, CONTRACTS, DECISIONS, CHANGELOG, BASELINE). `TEST_PLAN.md` alone is 1,723 lines
  with four of its nine parts marked historical. This is real tax: yesterday's phantom
  BASELINE rows came from exactly this manual surface.

---

## 8. Punch list

| # | Problem | Proposed change | Risk | Effort | Payoff |
|---|---|---|---|---|---|
| **1** | `canvasId` is a name on the wire and a key in metadata; 8 resolution paths | Key-typed ids, one `resolveCanvas`, legacy tolerance in one place | Medium (touches every surface) | M | Kills the top bug class; deletes 3 paths |
| **2** | `getPins` loads all records every 15 s when the index misses | Client sends `canvasKey` (the launcher list already carries it); server falls back to one deterministic read | Low | S | Removes an O(all canvases) loop |
| **3** | Legacy data is invisible, fallbacks are guesses | Registry health report: index orphans, tickets without `canvasId`, legacy thumb keys, duplicate labels | Low | S/M | Makes legacy observable; unblocks deleting fallbacks |
| **4** | Warm dashboard scans all records per view | Attach previews from the cached snapshot (already invalidated on write) or only for the visible page | Low | S | ~42 → ~2 KVS reads per view |
| **5** | Name-based joins persist only for legacy tickets | One idempotent admin pass stamping `pin.canvasId` — **optional**: D42 records that legacy tickets are explicitly out of scope | Medium (writes to tickets) | M | Lets the name fallbacks die |
| **6** | Launcher rebuilds the registry on every open | Cache `{records, index}` with write invalidation | Low | S/M | ~141 → a handful per open |
| **7** | Five documents per behaviour change | Archive historical TEST_PLAN parts, generate CHANGELOG from commits, keep SPEC/CONTRACTS/DECISIONS | Low | S/M | Faster, less drift |
| **8** | `exchangeToken` and upload paths untested | Add resolver-style tests with the new stubs | Low | S/M | Session/upload regressions caught |
| **9** | `index.js` state object (2,071 lines) | Extract composer, pins/status, navigation into modules with own state | High | L | Fewer subtle overlay bugs — **defer** |
| 10 | One dead identity resolver | Delete `resolveCanvasKey` after item 1 | Low | S | Stops reuse by mistake |

**Status (5.83.0):** items **1**, **2**, **3** and **4** are done. `resolveCanvas` is the
only identity resolver and repairs a lost name-index row on use; the registry report ships
on the admin page; previews are cached under a stamp so a warm dashboard read no longer
scans the records. Items 5, 6, 7, 8 and 10 remain open.

**Sequence:** 1 → 3 → 2 → 4 → 6, then reassess 5, 7, 8. Item 1 removes the bug class;
item 3 makes the data visible before any more fallbacks are deleted; 2/4/6 are cheap and
pay back the cost of this review.

---

## 9. Considered and rejected

- **Rewrite the overlay in React.** Shadow-DOM and CSP constraints, contract churn across
  four surfaces, no user-visible gain.
- **TypeScript.** Repo rule is JavaScript only; the win is smaller than the migration.
- **One shared client for bookmarklet and extension.** They genuinely differ in world and
  capture capability; `transport.js` already shares what can be shared.
- **Server-side previews / external screenshot service.** Forbidden by the no-third-party
  rule and no browser exists in the function.
- **Merge SPEC/CONTRACTS/DECISIONS into one document.** The precedence rules are what stop
  contradictions; trim and automate the mechanical parts instead.
- **Full domain-model rewrite of the registry.** The record shape is fine; the *identity
  convention* around it is not.

---

## 10. How accurate this review was

Predictions made before the pass, scored honestly:

| Prediction | Result |
|---|---|
| ≥ 8 KVS prefixes | **13 prefixes + 2 secrets** — undercounted |
| ≥ 4 identity paths | **8 paths**, plus the field-name/type trap — undercounted |
| ≥ 3 dead modules | **0 dead modules, 1 dead export** — **wrong**; waste is inside files |
| `loadCanvasRecords` in ≥ 4 hot paths | **4 call sites** (two in one request) |
| ≥ 2 surfaces with no tests | **3** (dashboard UI, UI Kit, extension options) |

The two misses are informative: the file layout is sound, so the cost is in *semantics*
(identity, generations) and in *large functions*, not in sprawl.
