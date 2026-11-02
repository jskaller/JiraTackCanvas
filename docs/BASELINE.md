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
| App version (deployed) | **5.12.0** (major 5) | `forge install list`, `forge version details` |
| Development last deployed | 2026-11-02 (5.12.0, no upgrade required) | `forge deploy` output |
| Installation | upgraded to major 5 | `forge install --upgrade` |
| SDK hash (deployed) | `223c52912f96` | `src/lib/version.js` |
| SDK hash (tree) | `223c52912f96` | `src/lib/version.js` |
| Bookmarklet bundle (tree) | 288,235 bytes (`dist/bookmarklet/jiratack.js`) | `npm run build` (byte-identical across rebuilds; `SDK_VERSION` is its SHA-256 prefix) |
| Bookmarklet URL length | ~3,500 chars with a 64-char token | `buildBookmarklet()` |
| Runtime | `nodejs24.x`, JavaScript only | `manifest.yml` |
| Scopes (deployed) | `storage:app`, `read:jira-work`, `write:jira-work`, `read:jira-user` | `forge version details` |

**Staging and production environments** also exist and were last deployed on 2026-10-24T15:07Z — older than development and not part of the active loop. Decide whether they are kept, refreshed, or removed; they are not a valid demo target today.

## 2. Deployed vs tree

**Deployed 2026-11-02.** Development runs `f4fd5e3` as app **5.6.0**, SDK `223c52912f96`, four scopes. No `forge install --upgrade` was needed: scopes were unchanged since 5.0.0.

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
| Guest invitations: named reviewers, sponsor, deactivate/regenerate/revoke, pairings until revoked | `993f478` | **Deployed** 2026-11-02 — SDK changed to `223c52912f96`; guest bookmarks must be re-dragged |
| Guest identity prefill, sponsor default/contact, mailto link | `f4fd5e3` | **Deployed** 2026-11-02 — SDK `223c52912f96`; re-drag guest bookmarks |
| Admin list payload fix, bound-email display, sponsor backfill | `3efc160` | **Deployed** 2026-11-02 — SDK `223c52912f96` |
| Session schema version; pre-identity invitation warning | `3942417` | **Deployed** 2026-11-02 — SDK `223c52912f96` |
| Session cache keyed by invitation token; auth tests | `401c2b1` | **Deployed** 2026-11-02 — SDK `223c52912f96` |
| Out-of-date bookmarklet notice with refresh link | `18daf6d` | **Deployed** 2026-11-02 — SDK `223c52912f96`; last manual re-drag |

**Deployed scopes are still the old six.** Confirmed with `forge version details -e development --non-interactive --json`: `manage:jira-configuration` and `manage:jira-project` are present in the live app, absent from `manifest.yml`.

**Consequence for bookmarks:** the deployed SDK serves `731d221968a1`. Any bookmark created before the next deploy requests that hash and will not get the CSP card or the match modes. After deploying, every bookmark must be re-dragged.

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
| `forge lint` | 0 errors, 1 approval notice (`MAJOR_VERSION_RULE` for the scope change) |
| Unit suites (`node --test src/shared/*.test.js`) | 4 suites pass; 55 URL vectors, plus ADF/text/safeUrl |
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
- **The deployed bundle bytes.** Recorded only as a hash (`731d221968a1`), which is sufficient to detect drift.

## 8. How to re-verify this baseline

```bash
git rev-parse baseline/pre-pivot-2026-10-30
git status --porcelain                  # expect empty
npm run build                           # expect SDK_VERSION 223c52912f96
node --test src/shared/*.test.js        # expect 4 suites pass
forge lint                              # expect 0 errors
forge environments list --json          # expect development deployed on 2026-10-31
forge install list -s jiratack.atlassian.net -p Jira -e development --json   # expect majorVersion 5
forge version details -e development --non-interactive --json   # expect appVersion 5 and exactly four scopes
```

If any of those disagree, this document is stale and should be updated rather than trusted.

---

**Related:** `SPEC.md` (behaviour), `ARCHITECTURE.md` (shape), `CONTRACTS.md` (wire), `DECISIONS.md` (why), `TEST_PLAN.md` (verification), `docs/SECURITY-REVIEW.md` (findings and remediation), `docs/AI-CONTEXT.md` (brief for other agent contexts).
