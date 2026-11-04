# AI context brief — JiraTack

**Audience:** another AI context (or a new engineer) that needs an accurate picture of this product in ten minutes, without reading 5,000 lines of specification.
**Baseline:** tag `baseline/pre-pivot-2026-10-30`. If the working tree has moved, the tag is still the reference; check `git log --oneline baseline/pre-pivot-2026-10-30..HEAD` for what changed since.
**Rule:** this brief is a summary. Where it disagrees with the documents listed in §10, the documents win.

---

## 1. What it is

JiraTack is an Atlassian Forge app. It lets QA and product teams drop visual pins on arbitrary web pages and turn them into Jira tickets — page URL, position, CSS selector, optional screenshot and console output — without a browser extension and without adding Jira custom fields.

The on-page client is a `javascript:` bookmarklet, generated inside Jira and dragged to the bookmarks bar. Every pin is a Jira ticket. There is no separate pin store.

## 2. Three client channels

| Channel | Minted by | Lifetime | Reach |
| --- | --- | --- | --- |
| Canvas bookmarklet | `generateCanvasToken` | 30 days | One named canvas |
| Personal bookmarklet | `generateUserToken` | 90 days | Launcher: choose a canvas, optionally create one |
| Guest link | `generateGuestToken` | 72 hours (new); grandfathered invites keep 365 d | Selected canvases, public installer page |

All three run the same SDK. Guest tokens carry `scope: "guest_create"`, `permittedCanvases`, and `isAdmin: false`.

## 3. Data model

Machine data lives in the issue property `com.jiratack.metadata`:

```json
{ "guest": { "name": "...", "email": "..." },
  "pin": { "canvas": "Q3 Marketing", "url": "https://example.com/p?page=2",
           "position": "45.2,32.8", "selector": "#hero" },
  "version": 1 }
```

- Labels: `jiratack` on every ticket, plus `jiratack-guest` for guest tickets. These are the query index.
- Every read is `labels = "jiratack"` + `properties: ["com.jiratack.metadata"]`, then filtering in memory.
- The description is human-readable ADF only: bold header, user body, optional console block, page link. No JSON, no marker.
- No custom fields, no field provisioning, no recovery pass (D18). **Do not reintroduce them.**

## 4. Authorisation

Two enforcement contexts, because only one can know the user.

| Context | Mechanism |
| --- | --- |
| Resolver (`jira:*` surfaces, any logged-in user can open them) | `requireAdmin(context)` per operation |
| Web trigger (no user identity; `asUser()` impossible) | `requireAdminClaims(claims)` on the issuance-bound `isAdmin` claim |

- Admin-only: installation/project config, token list/revoke, canvas create/delete/archive.
- Seat-gated: canvas, personal and guest token minting; dashboard and panel reads are open to any Jira user, scoped by Jira's own permissions.
- Missing `isAdmin` claim = non-admin (fail closed). Tokens minted before D21 cannot perform admin actions until re-issued.
- Guest links carry the **issuer's** browse access for the chosen canvases — an accepted, recorded trade-off (D19).

## 5. Page identity (D23)

`normalizeUrl` canonicalises, then drops trackers, cache-busters, version stamps and random-looking values, while a keep-list (`id`, `page`, `q`, `sku`, `product`, …) protects names whose long values identify content. Pins store the **canonical** URL (query intact); identity is derived at read time.

The reviewer chooses the match mode in the sidebar: `Smart` (heuristic), `Exact` (same query), `Whole page` (path only), each labelled with a pin count. The row appears only when the counts differ.

Residual risk: an unnamed parameter with a short meaningful value can still merge pages; a random-looking value under a keep-listed name can still split. Both are correctable by the reviewer, which is the point.

## 6. Hard constraints — do not violate

- Atlassian Forge, `nodejs24.x`. **JavaScript only** — no TypeScript, no Python.
- No new package without human approval.
- One shared URL module (`src/shared/urlNormalize.js`) bundled into client and server; normalisation must not diverge.
- Never call `api.asUser()` in a web trigger — there is no user identity there.
- Never trust `scope` as proof of admin; the claim is the control.
- All rendered URLs pass `src/shared/safeUrl.js` (http/https only). No `innerHTML` sinks.
- Tokens are credentials: resolvers return `tokenRef`, never raw tokens.
- KVS values are capped at 240 KiB; web-trigger bodies are community-measured at ~5 MiB. This is why screenshots are chunked.
- The bookmarklet loads its script from the app's own web trigger, so host-page CSP applies. Strict sites (GitHub, Google, MDN, Wikipedia) cannot run it; that failure is now explained in-page but not fixed (D22).

## 7. What is deliberately not built

- Browser extension (decided as the CSP fix, D22; no code).
- Data migration or backfill of pre-property tickets (D18).
- Custom fields, field provisioning, mapping audit, description marker, recovery (removed).
- Runs-on-Atlassian eligibility — permanently ineligible because all three web triggers are dynamic (D16).
- Pin retirement scheduler — replaced by the per-project status rule in `getPins` (D38).

## 8. Known limitations

- Revocation takes effect for new exchanges immediately, but a live JWT survives up to 8 hours (D11).
- Admin status is a point-in-time claim; demotion applies at next issuance or session expiry (D21).
- Canvas reads cap at 2,000 tickets; the overlay reports `truncated`, the dashboard and panels do not.
- Epic panel epic queries do not paginate (`maxResults: 100`), so an epic with more than 100 children is silently truncated.
- `universal` is a vestigial scope: accepted in allowlists and SDK checks, never minted.
- `sessionSigningSecret` is a plain KVS value, not `kvs.setSecret`.
- Property indexing (`jiratackCanvas`) is not retroactive.

## 9. Deployment reality

The tree is ahead of development. At baseline: development was last deployed 2026-10-29, major app version 4, SDK `731d221968a1`. The tree carries SDK `d5d8edafeda5` plus an undeployed manifest change (scope removal) that will force major version 5 via `forge install --upgrade`.

Consequences: deployed scopes still include two unused `manage:jira-*` permissions; deployed bookmarks lack the CSP card and match modes; **any SDK change requires re-dragging bookmarks**.

## 10. Where the truth lives

| Question | Document |
| --- | --- |
| Why was this decided? | `DECISIONS.md` (D8–D23) — authoritative, no exceptions |
| What does the product do? | `SPEC.md` v3.1 |
| How is it built? | `ARCHITECTURE.md` v2.0 |
| What exactly is on the wire? | `CONTRACTS.md` |
| How is it verified? | `TEST_PLAN.md` (Parts 2, 3, 5, 7, 8 are current) |
| What is the state right now? | `docs/BASELINE.md` |
| What was found and fixed? | `docs/SECURITY-REVIEW.md` |
| How should an agent work here? | `AGENTS.md` |

Precedence: `DECISIONS.md` > `CONTRACTS.md` (wire) > `SPEC.md` (behaviour) > `ARCHITECTURE.md`. If two documents disagree on anything else, ask before coding.

## 11. Historical documents — do not cite

- `BUILD_PLAN.md` — the original seven sprints, pre-guest, pre-D18.
- `CHANGELOG.md` — entries below `[Unreleased]` describe removed features.
- `PRIOR_BUILD_TRIAGE.md` — review of prior builds, 2026-10-23.

All three carry banners. Citing them as current will produce a wrong picture (usually: four custom fields that no longer exist).

## 12. If you are proposing a product change

1. Read `DECISIONS.md` first. The pivot directions already taken are D19 (seat-gated guest links), D22 (extension for CSP), D23 (page identity).
2. A new direction needs a decision entry before code; every downstream document defers to it.
3. Anything touching page identity, authorisation, or the storage model must update `SPEC.md`, `CONTRACTS.md` and `DECISIONS.md` in the same body of work.
4. Run `node --test src/shared/*.test.js` and `forge lint` before proposing a commit; report pass/fail per assertion.
