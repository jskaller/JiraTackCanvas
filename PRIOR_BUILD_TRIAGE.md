# PRIOR_BUILD_TRIAGE.md

Reference document. Records what was reviewed from prior builds and what does not port. Does not override any spec, contract, or plan.

## Sources reviewed

- github.com/jskaller/jiratack3 (2026-10-23)
- github.com/jskaller/JiraTack2 (2026-10-23)
  
  ## 1. What prior builds contain
  
  | Module                                                                                                                                                                                                  | JiraTack3                             | JiraTack2                       |
  | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------- |
  | Forge app scaffold                                                                                                                                                                                      | Yes (UI Kit 2, connect + admin pages) | No                              |
  | Extension Phase 1 (background, services)                                                                                                                                                                | Yes                                   | Yes                             |
  | Extension Phase 2 (hooks)                                                                                                                                                                               | Yes                                   | Yes                             |
  | Extension Phase 3 (UI shell)                                                                                                                                                                            | Partial                               | Placeholder only                |
  | `content.js` (pin DOM)                                                                                                                                                                                  | No                                    | Thin stub only                  |
  | Screenshot capture                                                                                                                                                                                      | No                                    | Handler exists but does nothing |
  | Console proxy                                                                                                                                                                                           | No                                    | No                              |
  | ADF serializer                                                                                                                                                                                          | No                                    | No                              |
  | URL normalization                                                                                                                                                                                       | No                                    | No                              |
  | New-ticket form                                                                                                                                                                                         | No                                    | No                              |
  | Pin overlay container                                                                                                                                                                                   | No                                    | No                              |
  | Field-rendering logic                                                                                                                                                                                   | No                                    | No                              |
  | **Critical finding:** The hardest parts of Sprints 4 and 7 (form, screenshot, console proxy, ADF, URL normalization) were never built in either prior attempt. Everything in S4 and S7 is from scratch. |                                       |                                 |
  
  ## 2. Ports from JiraTack3
  
  All ports from JiraTack3 have already been applied to CONTRACTS.md and BUILD_PLAN.md. The following is a record of what was applied.
  
  ### 2.1 Manifest shape (applied to CONTRACTS §10.1)
- `render: native` is required for all UI Kit modules (admin, project-settings, epic, issue). Without it, Forge expects `index.html` and panels fail to render.
- Runtime is `nodejs24.x` — prior deploy succeeded on 24, and D12 resolved to 24.
  
  ### 2.2 UI Kit 2 packages (applied to CONTRACTS §10.2)
- Prior build uses `@forge/react` (UI Kit 2), not legacy `@forge/ui`.
- `@forge/bridge` required for Custom UI (`invoke`, `view.getContext`).
- `@forge/react` uses `ForgeReconciler.render()`.
  
  ### 2.3 KVS TTL call shape (applied to CONTRACTS §2.1)
  
  ```javascript
  await storage.set(`canvasTokens:${token}`, record, { ttl: 2592000 });
  // 2592000 seconds = 30 days
  ```

### 2.4 Jira REST request shapes (reference for Sprint 2)

- Create issue: `POST /rest/api/3/issue` with `{ fields: issueData }`

- Search: `GET /rest/api/3/search/jql?jql=...&maxResults=200&fields=...` — response includes `total`

- Transitions: `GET /rest/api/3/issue/{key}/transitions`

- Update: `PUT /rest/api/3/issue/{key}` with `{ fields: {...} }`

- Error extraction: `data.errorMessages?.join(', ') || data.message` — include as `details.errorMessages` in `VALIDATION_ERROR`

### 2.5 Config version hashing idiom (applied to CONTRACTS §4.2)

javascript

const configVersion = createHash('sha256')
  .update(JSON.stringify(adminConfig))
  .digest('hex');

Prior build truncated to 16 hex chars. CONTRACTS uses full SHA-256.

### 2.6 License fallback idiom (applied to BUILD_PLAN §5.3)

javascript

if (license !== undefined && !license.active) {
  return { ok: false, error: { code: 'LICENSE_INACTIVE' } };
}
// license === undefined: dev mode, treat as active

### 2.7 Error-copy map (reference for admin panel)

text

LICENSE_INACTIVE: 'Your JiraTack license is inactive. Please upgrade to continue.'
ADMIN_CONFIG_NOT_FOUND: 'JiraTack has not been configured for this Jira instance yet...'

### 2.8 Do not port from JiraTack3

- Extension services (`chrome.storage`, `chrome.runtime.sendMessage`, AES-GCM encryption)

- Hook chain (`useTabUrl`, `useActiveInstance`, `useConfig`, `useQuickConfig`, `useFieldRegistry`)

- Sidepanel React components

- Extension `vite.config.js` (the `modulePreload` workaround is MV3-only)

- `postbuild.js`, `manifest.json`, `.kilocode/` rules

- Tiptap version pin from JiraTack3 — use JiraTack2's pin instead (§3.2 below)

## 3. Ports from JiraTack2

### 3.1 Pin color constants (reference for Sprint 3)

javascript

const PIN_COLORS = {
  default:  '#FF6B6B',
  selected: '#E63946',
  done:     '#2ECC71',
  move:     '#F4C542'
};

Goes into `src/bookmarklet/styles.css` as CSS custom properties in Sprint 3. Do not port `pinLabel.js` — position encoding is rejected by SPEC §4.

### 3.2 Tiptap version pin (reference for Sprint 4)

json

"@tiptap/react": "^2.11.5",
"@tiptap/pm": "^2.11.5",
"@tiptap/starter-kit": "^2.11.5"

Use `^2.11.5`, not `^3.x`. Version 3 is a breaking change and unnecessary for the six node types in CONTRACTS §8.1.

### 3.3 Additional Jira endpoint shapes (optional fallbacks for Sprint 2/6)

JiraTack2 exercised three endpoints not in JiraTack3:

- `GET /rest/api/3/field/{fieldKey}/option?project={projectKey}` — option payload. Optional.

- `GET /rest/api/3/issue/createmeta?projectKeys={key}&expand=projects.issuetypes.fields` — legacy shape. S6 uses `/createmeta/{projectKey}/issuetypes` (v3) instead.

- `GET /rest/api/3/project` — plain array. Optional; `context.userAccess` covers most cases.

None require a CONTRACTS amendment.

### 3.4 Do not port from JiraTack2

- `src/content.js` — pins appended to `document.body`, no overlay container. SPEC §6.3 rejects this.

- `src/services/storage.js` — AES-GCM credential storage; dead in v2.3.

- `src/services/jira.js` — `chrome.runtime.sendMessage` wrappers; dead.

- `src/services/pinLabel.js` — position encoding; rejected by SPEC §4.

- `plans/dual-vite-build-plan.md` — MV3-specific; dead.

- `src/background.js` — handlers dead, but request shapes inform §2.4 above.

## 4. Anti-patterns confirmed by prior builds

1. **`status != Done` instead of `statusCategory != Done`** (JiraTack2). CONTRACTS §7.1 uses `statusCategory`.

2. **`nextPageToken` destructured but never used** (JiraTack2). CONTRACTS §3.2 requires handling.

3. **Pin data encoded in Jira labels** (JiraTack2). Rejected by SPEC §4.

4. **Pins appended to `document.body`** (JiraTack2). Rejected by SPEC §6.3.

5. **Screenshot handler named `handleCaptureScreenshot` that does nothing** (JiraTack2). Sprint 4 must actually integrate `html2canvas` and 400×400 crop.

## 5. Amendments applied

| Amendment                                        | Applied to                       |
| ------------------------------------------------ | -------------------------------- |
| `render: native` on UI Kit modules               | CONTRACTS §10.1, BUILD_PLAN §4.2 |
| `@forge/react` + `@forge/bridge` in package.json | CONTRACTS §10.2                  |
| KVS TTL call shape documented                    | CONTRACTS §2.1                   |
| Runtime resolved to 24.x                      | DECISIONS.md D12 (resolved), CONTRACTS §10.1, BUILD_PLAN §4.2 |
| Tiptap version pinned to `^2.11.5`               | BUILD_PLAN §7.1                  |
| Pin color constants noted                        | BUILD_PLAN §6.1                  |

No further amendments pending from this triage.

## 6. Net effect on sprint effort

| Sprint | Prior-build contribution                                                               |
| ------ | -------------------------------------------------------------------------------------- |
| S1     | Manifest shape, `render: native`, UI Kit 2 imports, error-copy map — ~2 hours saved    |
| S2     | Jira REST shapes, error extraction, KVS TTL pattern, license fallback — ~3 hours saved |
| S3     | Pin color constants — ~15 minutes saved                                                |
| S4     | Tiptap version pin only — no meaningful savings                                        |
| S5     | `invoke`/`view.getContext` pattern — <1 hour saved                                     |
| S6     | Legacy `createmeta` fallback reference — no meaningful savings                         |
| S7     | None — build from scratch                                                              |