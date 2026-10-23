# DECISIONS.md

Single decision log for JiraTack. Every open and resolved decision appears exactly once, with an ID, status, resolution, and where it applies.

**Precedence:** Where SPEC.md, CONTRACTS.md, or BUILD_PLAN.md mention a decision, this document is authoritative. Amend this file first when a decision changes, then update downstream references in a follow-up commit.

---

## Resolved

### D8 — Canvas-token-in-bookmarklet auth model

**Status:** Resolved (2026-10-22)
**Resolution:** Two-token model. Canvas token (30-day TTL, embedded in bookmarklet URL, carries scope). Session JWT (8-hour TTL, HS256, stored in `sessionStorage`). Two scopes: `create` and `view`.
**Rejected alternatives:** Popup-based re-auth every session; opaque session tokens requiring KVS lookup per call.
**Applies to:** SPEC §5, ARCHITECTURE §3, CONTRACTS §2, CONTRACTS §3.

### D9 — Pin visibility and canvas permission model

**Status:** Resolved (2026-10-23)
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

**Applies to:** SPEC §18, CONTRACTS §1.2, §2.2, §3.2, §3.3, §4.1, §4.6, §8.4, §10.1, BUILD_PLAN §4, §5, §6, §9.

### D11 — Revocation lag on `createIssue`

**Status:** Resolved (2026-10-23)
**Resolution:** Accept 8-hour lag. `createIssue` and other write actions validate the JWT scope and signature but do not re-check the canvas-token record. Revocation is effective within one JWT lifetime (≤8h). "Regenerate bookmarklet" revokes the old token for new exchanges but does not invalidate live JWTs.
**Mitigation:** Admin UI documents the lag. v1.1 can add per-call KVS check on write actions if customer demand requires.
**Rejected alternative:** Per-call KVS read. Requires KVS schema change to expose token ID in JWT, adds cost and latency.
**Applies to:** SPEC §18, CONTRACTS §3.3.

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

---

## Open — blocking Sprint 1

### D10 — Webtrigger URL discovery

**Status:** Open — resolve during Sprint 1
**Question:** The bookmarklet must embed installation-specific webtrigger URLs (`<wt>/api` and `<wt>/bookmarklet.js`). Can a resolver discover these via `@forge/api`, or must the admin page perform one-time discovery and cache them?
**Resolution mechanism:** Sprint 1 build tests both paths. If `@forge/api` exposes webtrigger URLs to a resolver, use that. If not, admin page performs one-time discovery on first provisioning, writes to KVS `webtriggerUrls`.
**Decision needed from:** Sprint 1 build result.
**Applies to:** CONTRACTS §2.1, BUILD_PLAN §4.5.

### D12 — Runtime version

**Status:** Open — resolve during Sprint 1 deploy
**Question:** Forge runtime `nodejs22.x` (default in our docs) or `nodejs24.x` (proven working on prior build)?
**Recommendation:** `nodejs22.x` for v1.
**Alternative:** `nodejs24.x` if 22 fails to deploy.
**Decision needed from:** Sprint 1 deploy result.
**Applies to:** CONTRACTS §10.1, BUILD_PLAN §4.2.

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
