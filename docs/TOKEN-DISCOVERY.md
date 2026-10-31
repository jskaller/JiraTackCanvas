# Token lifecycle: current state and migration options

## 1. Current-state map

| | Canvas token (create / view) | User token (universal) | Guest token (guest_create) |
| --- | --- | --- | --- |
| Minted in | `generateCanvasToken` — admin.js:77 | `generateUserToken` — admin.js:327 | `generateGuestToken` — admin.js:170 |
| Construction | `crypto.randomBytes(32).toString('hex')` — admin.js:108 | same — admin.js:345 | same — admin.js:208 |
| KVS key | `canvasTokens:<token>` — admin.js:126 | `userTokens:<token>` — admin.js:367 | `canvasTokens:<token>` (same prefix as canvas) — admin.js:225 |
| Record | `{canvasName,userId,installationId,scope,isAdmin,issuedAt,expiresAt,revoked,permittedProjectsJson}` | `{userId,installationId,scope,isAdmin,…}` | `{scope:'guest_create',issuer,isAdmin:false,permittedCanvases,permittedProjectsJson,…}` |
| TTL | 30 d (admin.js:15,110,126) | 90 d (admin.js:325,347,367) | 365 d (admin.js:16,210,225) |
| Exchanged at | `exchangeToken` — exchangeToken.js:118 | exchangeToken.js:73 (checked first) | exchangeToken.js:118, guest branch :129 |
| Exchanged for | 8 h HS256 session JWT — exchangeToken.js:182 | 8 h session JWT — :93 | 8 h session JWT — :142 |
| Raw token in | bookmarklet config (shared/bookmarklet.js:9) | bookmarklet config | installer URL (install.js:64), installer href (:107), bookmarklet config |

Validation (middleware/auth.js): bearer only → `verifySessionJwt` with `algorithms:['HS256']` (auth.js:37, tokens.js:44) → `aud` (:46) → scope allowlist (:50). Token exchange is the only unauthenticated action (webtrigger/api.js:64). The raw token itself is validated only by KVS lookup + revoked/expiresAt checks (exchangeToken.js:75,78,122,125).

Surfaces where the raw token literally appears:

- Bookmarklet `javascript:` string: config token — shared/bookmarklet.js:9; the whole URL is a bookmark.
- Installer URL query: install.js:64 (query.token); rendered into the page at :107 via `escapeHtml`.
- Server-side KVS key names (the token is the key) — admin.js:126,225,367.
- Admin listing: hashed only (`tokenRef`) — admin.js:270 (D19).
- Logs: admin.js:125,361 log the record, not the token; no error message interpolates the token.
- Network: token in the `exchangeToken` POST body (TLS); subsequently only the session JWT in Authorization.
- Browser: installer URL in history; bookmarklet in bookmarks + browser sync; dashboard modal clipboard (GuestLinkModal copy).
- Referrer: installer page loads no external subresources, so no Referer leak from it; third-party link-preview fetchers still see the URL if forwarded.

## 2. Leakage inventory

| # | Surface | (a) Reviewer history | (b) Third-party page | (c) Server/proxy logs | (d) Forwarded links | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Guest installer URL `?token=` | Yes | Link-preview bots | Likely (webtrigger request line; undocumented) | Yes — full credential | High |
| 2 | Bookmarklet in bookmarks/sync | Bookmarks + Chrome sync | Indirect (see #3) | No | Yes, via bookmark export | High — user token 90 d, canvas 30 d |
| 3 | `window.__jiratackInit(c)` on host page | No | Yes — a page can predefine a non-configurable/overriding `__jiratackInit` and capture `c.token` from shared/bookmarklet.js:16 | No | No | Medium-High |
| 4 | Installer URL shown/copied in dashboard | Yes | No | No | Yes | Medium |
| 5 | Platform access logs for `jiratack-install` | — | — | Yes (query string) | — | Medium |
| 6 | KVS key names | No | No | No (app logs don't print keys) | No | Low (dev-console access only) |
| 7 | Exchange POST body | No | No | Unlikely (body not logged) | No | Low (TLS) |
| 8 | Error messages | No | No | No | No | None (verified) |

Note on #3: `__jiratackInit` is assigned by the SDK (index.js end) and invoked by the bootstrap; a hostile page can interpose and read the long-lived token, which is worse than the session JWT because it outlives the 8 h window.

## 3. Exchange-path analysis

Yes — the endpoint can accept a signed token with no client change. `tokenFromPayload` (exchangeToken.js:43-46) treats the credential as an opaque string; nothing assumes a 64-hex shape. Only the KVS lookup cares about the value.

Smallest diff (server-only):

- `tokens.js`: `signBootstrap(raw)` → `${raw}.${hmac}`; `verifyBootstrap(signed)` → raw | null, with its **own** secret (not `sessionSigningSecret`, so rotation is independent).
- Minting (admin.js:108/208/345): keep storing under `canvasTokens:<raw>` / `userTokens:<raw>`, but return the signed string to the caller/bookmarklet.
- `exchangeToken`: if the token contains `.`, verify; on success look up using the raw part; on failure return `TOKEN_INVALID` without a KVS read; if it has no `.`, use the legacy path.
- No bookmarklet/SDK change; existing bookmarks (raw) keep working through dual-read.
- If instead signing were mandatory for all tokens, every existing bookmarklet would break — incompatible with the demo constraint.

## 4. TTL impact: guest 365 d → 72 h

What breaks

- Returning reviewers. A saved guest bookmarklet older than 72 h can no longer exchange: the canvas-token record is gone/expired (exchangeToken.js:118-125). They must request a new installer link. That is the intended trade-off, not a bug.
- The installer page does not validate the token on GET. install.js:64-113 renders a bookmarklet for any token string, so an expired forwarded link still "works" visually and then fails at first use — a UX trap to fix as part of the change.
- Existing records keep their 365 d TTL unless rewritten; only newly minted guest tokens get 72 h.

What does not break

- Session auto re-exchange already exists: bookmarklet/api.js:34-36 retries once on `TOKEN_EXPIRED`/`TOKEN_INVALID` via `exchangeSession(force)`, plus index.js:722,1034,1098 for the init/canvas paths. This covers the 8 h session, not an expired bootstrap token — if the guest token itself is dead, the refresh fails and the error surfaces.
- The demo (drag → pin → ticket within hours) is unaffected.

Code that assumes a long guest TTL: `GUEST_TOKEN_TTL_DAYS` (admin.js:16), expiry math admin.js:210, KVS TTL admin.js:225, installer copy "long-lived" (install.js:113), and the D19/CONTRACTS text that names 365 days as a compensating control (DECISIONS.md:80, CONTRACTS.md:544). No logic depends on 365 beyond those.

## 5. Signing-in-place option

Format: `v1.<base64url({k:raw,e:expMs,t:type})>.<base64url(hmac)>`, or the minimal `raw.hmac`. Verify signature before KVS; reject malformed/expired without a lookup.

Fixes: cheap rejection of arbitrary/oversized tokens (KVS-churn / DoS mitigation), tamper detection, optional stateless expiry/type, and a detectable format for future migration.

Does **not** fix: TTL length, bookmarklet/installer exposure, replay of a captured token, revocation lag, or per-device/pairing records.

Honest caveat: the token is already 256-bit random, so forgery is not the threat. Signing buys operational hygiene, not a material reduction in the exposure described in §2. Its main value is as the seam for the end state.

## 6. Interim vs end state

(a) **Sign + 72 h guest TTL.** Server-only; dual-read keeps old bookmarks alive; exchange accepts any string, so no client change (§3). 72 h comfortably covers the demo, and session auto-refresh already handles the 8 h window (§4). Residual risk: a forwarded link is still a live bearer credential for 72 h, and the bookmarklet still carries the token.

(b) **Separate short-lived bootstrap exchanged for the existing long-lived token.** As literally specified, the exchange would hand the long-lived token back to the client — no reduction in §2 exposure, just an extra hop. To actually improve things the bootstrap must exchange for a session JWT only, with the long-lived credential never leaving the server; that requires a per-use bootstrap (re-open the installer each session) and a client-flow change, which conflicts with a saved bookmarklet.

**Recommendation: (a) as the interim.** Reasoning tied to your items: §3 shows the exchange endpoint needs no client change, so signing + TTL is a two-deploy, demo-safe change; §4 shows 72 h does not break the in-window flow because only bootstrap expiry is fatal, and the 8 h session refresh already works. (b) is the right end state, but it is a UX + client change and should ride with the extension (no page CSP, no bookmark-held secret).

## 7. Secret migration: kvsSet → kvs.setSecret

`@forge/kvs` exposes `getSecret`/`setSecret` (node_modules/@forge/kvs/out/kvs.d.ts:20-24).

- Add `kvsGetSecret`/`kvsSetSecret` wrappers in `src/lib/kvs.js`.
- `loadOrCreateSecret` (tokens.js:10-22): try `getSecret('sessionSigningSecret')`; if absent, read the plain key; if a plain value exists, copy it via `setSecret` with the same value and continue; if neither exists, generate and `setSecret` with `must_be_missing`.
- No rotation needed at migration. The value is unchanged, so every live JWT still verifies. The module-scope `secretPromise` cache (tokens.js:8) stays valid.
- After ≥ 8 h (max session TTL), delete the plain key — and only once dual-read is removed in a later deploy.
- Rotation can follow: add `kid` to the JWT header, keep the previous secret for verification for ≥ 8 h, then retire it; clear `secretPromise` (or rely on cold start). Do not rotate during the migration deploy.
- Cautions: keep secrets out of `kvs.query` (they live under their own key), and confirm `getSecret` behaves under `forge tunnel` before relying on it in dev. `storage:app` is already granted.

## 8. Interim recommendation

Ship (a) in two small, independently reversible commits, leaving the licensed path untouched:

1. **Guest TTL 365 d → 72 h** (admin.js:16), update the installer copy (install.js:113) and the D19/CONTRACTS text, and validate the token on installer GET so an expired link fails immediately instead of producing a dead bookmarklet.
2. **Sign the bootstrap token server-side with dual-read** (`raw.hmac`, raw used as the KVS key, verify before lookup), and move `sessionSigningSecret` to `kvs.setSecret` per §7.

Do **not** attempt (b) now. Its only real benefit requires the long-lived credential to stay server-side, which breaks the saved-bookmarklet flow and needs the extension-era client. Keep it as the documented end state, alongside the `__jiratackInit` hook exposure (§2 #3) — that one is arguably a stronger reason to move to the extension than TTL is.