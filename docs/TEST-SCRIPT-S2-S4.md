# Test script — S2 refactor + S4 + B1

**Status:** deployed to development as app 5.2.0 on 2026-11-02 (commit `5fbad06`). Case 6 is now runnable: the admin page has a token inventory with Revoke. Server-side and browser-harness checks pass (phase-1 redirect, installId persistence, not-found state, no CSP header). Cases 1–7 require a Jira session and remain to be run; case 9 partially covered.
**Environment:** development (`jiratack.atlassian.net`), app 5.x, SDK `d5d8edafeda5`.
**Prerequisites:** a guest-capable canvas; the dev site open in two browser profiles; DevTools available; `forge tunnel` or a deployed build.

---

## 0. Automated (run first, no deploy needed)

```bash
node --test src/shared/*.test.js src/lib/*.test.js
forge lint
npm run build
```

Expected: 9 suites pass (includes `tokenParser`, `pairingService` CAS, metadata round-trip for `bindingId` + `pairingId`); lint no issues; build clean; `SDK_VERSION` unchanged at `d5d8edafeda5`.

If `SDK_VERSION` changed, stop — the composite token was supposed to avoid an SDK change.

---

## 1. Fresh install → two permissive sites → one pairing

**Precondition:** clear `jiratack:installId:*` and `sessionStorage` in the profile.

1. Open the installer link. Expect phase 1 (`Loading…`), then a redirect to `?token=…&installId=<32 hex>`.
2. Assert the URL contains a 32-character lowercase hex `installId`.
3. Drag the bookmarklet to the bar.
4. Open `shopify.com`, click the bookmark, create a pin.
5. Open `example.com`, click the same bookmark, create a pin.

**Expected:** both pins created; the installer shows "9 of 10 devices remaining"; DevTools → Application → Local Storage shows one `jiratack:installId:<appId>`.

**Why:** one installId, not per-origin.

---

## 2. Reload installer → sticky installId, no second pairing

**Precondition:** continue from case 1, same tab, wait **more than 5 seconds**.

1. Reopen the original installer link.
2. Observe the redirect target.

**Expected:** same `installId` as case 1; capacity line still shows 9 remaining; no `(invite, "")` pairing created.

**Note:** reopening within 5 seconds intentionally takes the legacy path (loop guard). Wait past the window for this test.

---

## 3. Different browser profile → new pairing

1. Open the same installer link in a second profile (or incognito).
2. Drag and create one pin.

**Expected:** a different `installId` (32 hex) in the URL; capacity drops to 8 remaining.

---

## 4. Two emails on one bookmark → two bindings, one pairing

**Baseline check first:** confirm the current JWT has no `bindingId` claim (decode `sessionStorage['jiratack_jwt_*']` after exchange) and that guest tickets already derive `bindingId` per ticket from the email.

1. With one bookmark (one installId), create a ticket as `ada@example.com`.
2. On the same page, create a second ticket as `grace@example.com`.
3. Fetch both tickets' `com.jiratack.metadata`.

**Expected:**
- two distinct `bindingId` values,
- the **same** `pairingId` in both,
- the JWT carried `pairingId` and no `bindingId`,
- capacity consumed 2 reviewer slots (2 bindings), 1 pairing.

**Why:** this is the semantic test for the whole model.

---

## 5. Cap at 10, and the existing-install bypass

1. Generate 11 distinct installIds: clear `jiratack:installId:*` **and** `sessionStorage` between runs (or use 11 profiles), re-dragging each time.
2. On the 11th, attempt to open the installer and exchange.

**Expected:**
- installer renders the pairing-limit state: "This invite has been installed on 10 devices…";
- a direct exchange returns `PAIRING_LIMIT` (409).

3. Then reload the installer with **installId #1** (one of the ten already paired).

**Expected:** the page still renders the valid state (existing pairing bypasses the cap), and the bookmarklet still works.

---

## 6. Revoke invite → structural cascade

1. Revoke the invite from the admin token list.
2. Open the installer link in a fresh profile.

**Expected:** the installer renders "This invite is no longer active"; no bookmarklet is offered.

3. In a profile that already holds a live session, create a pin immediately.

**Expected:** succeeds while the session is valid (≤8 h). After the session expires, re-exchange fails with `TOKEN_INVALID`.

**Why:** structural cascade — no fan-out write, sessions run to expiry.

---

## 7. Invite expiry does not kill a live session

**Precondition:** a session established at hour 70 (invite minted 70 h earlier), same tab, `sessionStorage` intact, no forced 401.

1. At hour 75 (invite expired at 72 h), create a pin without reloading.

**Expected:** succeeds.

2. Clear `sessionStorage` and retry.

**Expected:** fails with `TOKEN_EXPIRED` — the invite is dead and cannot be re-exchanged.

If step 1 fails, the TTL is being enforced at the wrong layer (per-action rather than per-exchange).

---

## 8. CSP failure card (C1 + S4 interaction)

1. Open `github.com`, click the bookmarklet.

**Expected:** the in-page card reads "JiraTack could not start here" with a CSP reason and a Dismiss button; no overlay; a `[JiraTack]` console error.

**Expected side effect:** no pairing is consumed (the SDK never loads, so no exchange).

---

## 9. Browser harness (not `node --test`)

| Check | Expected |
| --- | --- |
| Phase 1 inline script executes | Redirect to `…&installId=<32 hex>` |
| `localStorage` blocked (simulate by throwing in console) | Redirect to `…&installId=`; page still usable |
| `<noscript>` fallback | A working bookmarklet with the bare invite token; exchange creates the `(invite, "")` pairing |
| Reopen within 5 s | Legacy path (expected, documented) |

---

## Results (dev, 2026-11-02, app 5.3.0)

| Case | Result | Evidence |
| --- | --- | --- |
| 1 — install, two sites | **PASS** | one pairing, both pins created |
| 3 — second profile | **PASS** | new installId, second pairing |
| 4 — two emails, one bookmark | **PASS** | distinct `bindingId` per ticket, identical `pairingId`, one pairing |
| 5 — cap and bypass | **PASS** | 10 pairings created, 11th `PAIRING_LIMIT`; already-paired id renders the valid page at 0 remaining; re-exchange is idempotent |
| 6 — revocation cascade | **PASS** | re-exchange `TOKEN_INVALID`; pre-revoke JWT still returns pins (exp +459 min); installer shows "no longer active" |
| 7 — invite expiry vs live session | **BLOCKED ON DECISION** | A (pairing lifetime independent) or B (72h hard wall) |

Bugs found by running the cases, both fixed and deployed:

- malformed `canvasToken` returned `INTERNAL` 500 instead of `TOKEN_INVALID` (commit `5fbad06`);
- the token list asked KVS for 1,000 rows and failed on load (commit `376935b`).

## Rollback notes

- Revert both commits; invites minted after cutover keep their 72 h TTL but remain readable by the old code path (bare token), because the composite is only produced by the installer.
- Pairing records (`pairings:`, `pairingIndex:`) become orphaned but expire with their invite. No cleanup required.
- No ticket data migration is involved.

---

## Deploy checklist (still held)

1. All local suites green, `forge lint` clean, `SDK_VERSION` unchanged.
2. This script reviewed and agreed.
3. Deploy to development, then run cases 1–9.
4. Only then consider production.
