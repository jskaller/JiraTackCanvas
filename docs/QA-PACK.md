# QA pack — tool list and build notes

Working reference for the QA pack while it is being built. The **decisions** live in
`DECISIONS.md` (D49 pack, D50 pricing) and `docs/ALIGNMENT-DECISIONS.md` (PR-21 edition).
This file owns the **tool list, the rules each tool applies, and the build notes**.

**Status:** design settled, nothing built. Extension-only feature set, gated by the QA
edition (PR-21).

---

## Scope and gating

- **Extension only.** Every tool needs the service worker, the offscreen document, or a
  content script. The bookmarklet cannot host them.
- **Edition-gated.** Availability comes from the installation's edition; the server puts
  `qaAvailable` in the session at exchange and re-checks it on every QA action, returning
  `UPGRADE_REQUIRED` rather than a silent failure.
- **Per-browser preference.** A toggle in options/first-run controls whether the flyout
  appears here. No per-user admin grant.
- **Guests never receive it.** A guest session's `sub` is the sponsor; the check must
  exclude `scope === 'guest_create'`.
- **Findings become pins.** Every tool's output is a list of findings with a *Raise as
  pin* action, reusing the existing ticket flow. No second data model.

---

## Architecture principles

**Share engines, never results.**

| Shared (built once) | Used by |
| --- | --- |
| Offscreen WASM host, lazily instantiated per engine | Harper, Squoosh codec, axe |
| SW fetch layer — HEAD, ranged GET, 5 s abort, concurrency, body cancel | Link checker, large assets |
| DOM extractors (text blocks, images, links, computed styles) | Every scan tool |
| Findings model `{ tool, rule, severity, target, message, fix, evidence }` | All tools |
| Per-canvas config and ignore lists | Spelling/grammar, thresholds, palette |

**Independent runs.** Results are keyed by `tool + canonical URL + run id`, never a shared
blob. Three states are always distinct in the UI:

| State | UI |
| --- | --- |
| Not run | "Not scanned yet" + Run |
| Running | progress, cancellable |
| Done | findings + timestamp + the URL they belong to |

**Never render "no issues" for a tool that has not run.** Empty and not-run are different
facts, and conflating them is how a QA team stops trusting the panel.

**Piggybacking is an optimisation with provenance.** A tool may reuse another's data only
when it exists for this URL and run, and the UI says so ("sizes from the network capture
taken 2 min ago") with a re-run option. If the source never ran, the consumer falls back to
its own probing.

**One scheduler, per-tool quotas.** Link check and image audit share the SW fetch layer.
Without a shared budget, running both starves the UI and hammers the site.

**Failure isolation.** A codec OOM must not silently kill Harper for the session. If an
engine restarts, dependent tools report "engine restarted — re-run" rather than showing
stale findings.

---

## Approved dependencies

| Dependency | For | Status |
| --- | --- | --- |
| `harper.js` v3.0.0 (Apache-2.0) + `fflate` | Spelling and grammar | **approved** |
| Squoosh codec WASM (one codec: mozjpeg for JPEG, WebP for the rest) | Large-asset re-encode tier | **approved** |
| `wasm-unsafe-eval` in `content_security_policy.extension_pages` | Instantiating the WASM engines | **approved** |
| `axe-core` | Accessibility scan | **pending** |
| `mammoth` | DOCX import for copy-doc review | not needed for v1 |

No package is added without approval (AGENTS.md).

---

## The 15 tools

| # | Tool | Verdict | Runs in | Effort |
| --- | --- | --- | --- | --- |
| 1 | Spelling — selection + full page | Yes, via Harper | offscreen | shared with 2 |
| 2 | Grammar — selection + full page | Yes, via Harper | offscreen | 3–4 d combined |
| 3 | Readability — selection + full page | Yes | page | 0.5–1 d |
| 4 | Diff check — selection vs pasted text | Yes | page | 1–2 d |
| 5 | Copy doc review | Partial | page | 3–5 d |
| 6 | Active recursive link checker | Yes, depth-capped | SW + offscreen | 1.5–2 d |
| 7 | Missing assets | Yes | page (+SW) | 0.5–1 d |
| 8 | Accessibility (WCAG 2.2) | Yes, dependency | content script | 1–2 d |
| 9 | Screenshot/comment on status change | Partial | overlay only | 1.5–2 d |
| 10 | Status automation → subtask | Yes | server | 2–3 d |
| 11 | Capture context | **Already built** | page | — |
| 12 | Passive network capture | Yes | page | 0.5–1 d |
| 13 | Large asset identifier | Yes, tiered | page + SW + offscreen | 2–3 d (+2–3 for re-encode) |
| 14 | Colour checker | Yes (contrast) / partial (palette) | page | 0.5–1 d |
| 15 | Page syntax / hygiene linter | Partial | page | ~1 d |

---

## Tool details

### 1–2. Spelling and grammar

- **Engine:** `harper.js` v3.0.0 (Apache-2.0), local WASM. No network, no text leaves the browser.
- **Before committing:** measure the **shipped artifact** — the npm package unpacks to 94.8 MB
  but that includes node and web builds. The real WASM + glue should be single-digit MB.
  This measurement gates packaging and the store listing.
- **Runs in the offscreen document**, not the page world: the injected SDK lives under the
  host page's CSP, which blocks `wasm-eval`. The offscreen document is persistent for the
  session; instantiate lazily on the first scan (instantiation is noticeable).
- **Spelling and grammar are one engine** with two rule groups; there is no separate word list.
- **Text extraction** happens in the page world (visible text blocks, excluding editable
  fields, code blocks and the overlay); **offsets are mapped back to DOM ranges** using the
  same path+offset approach as `textChange.anchor`, so findings can be highlighted in place.
- **Selection mode** lints only the selected text and highlights inside that range.
- **English only.** Put it in the listing copy.
- **Ignore list per canvas** (brand names, product names), or the false-positive rate makes
  the tool untrustworthy.

### 3. Readability

- Pure math, no engine: Flesch reading ease, Flesch–Kincaid grade, Gunning fog.
- Per block and page average; selection mode for a single paragraph.
- Findings are advisory, not errors — severity is always "suggestion".
- Sentence splitting is the only fiddly part (abbreviations, decimals).

### 4. Diff check — selection vs pasted text

- Take the selected element's text as one side, a pasted string as the other.
- Normalise whitespace and line breaks before comparing, or every diff is noise.
- Word-level diff (a ~100-line Myers implementation, no dependency); character diff only
  inside changed words.
- Render both sides with insertions/deletions marked; offer "raise as pin" with the expected
  and actual text in the ticket.

### 5. Copy doc review

- Same diff engine, plus **block alignment**: deciding which paragraph corresponds to which
  before comparing. This is the hard part, not the diff.
- **v1 accepts paste, `.txt` and `.md`.** DOCX needs `mammoth`; PDFs are out of scope.
- Reordered or restructured copy produces false discrepancies. Label results as
  "possible mismatch" rather than "wrong" where alignment confidence is low.

### 6. Active recursive link checker

- **Extension only.** The service worker reads cross-origin responses without CORS; a
  page-world `no-cors` fetch returns an opaque response with no status.
- **Probe:** `HEAD` with a 5 s `AbortController` timeout, concurrency 5, total cap ~500 URLs.
  On 405/501 retry once with `GET`, read the status and **cancel the body**.
- **Recursion:** depth 1–2 (default to be set), page cap ~50, hard bail-out. Every link found
  is checked regardless of origin; only pages on the site under review are followed.
- **Dedupe** by normalised URL using `src/shared/urlNormalize.js`.
- **HTML parsing** happens in the offscreen document (`DOM_PARSER`) on Chrome and in the
  background page on Firefox.
- **Classification:**

  | Result | Shown as |
  | --- | --- |
  | 2xx | OK |
  | 3xx (followed) | OK, with redirect target |
  | 401 / 403 | **Unverified — needs sign-in**, surfaced, not counted broken |
  | 404 / 410 | Broken |
  | 5xx / 429 | Server error / rate-limited |
  | DNS or network failure | Unreachable |
  | Timeout | Timed out |

- Cancellable, with live progress. Results are findings, not a separate report.
- No cookies are required or sent; an authenticated link is reported as unverified and
  assessed manually.

### 7. Missing assets

- Iterate `img`, `source`, `video`, `audio`, `link[rel=stylesheet]`, `script`.
- Signals: `complete === true && naturalWidth === 0` (images), resource-timing
  `responseStatus` 404/410 where available, `src` empty or whitespace.
- Skip `loading="lazy"` images that have not loaded (`naturalWidth === 0 && complete === false`)
  — they are not missing, they are not fetched yet.
- **CSS background images behind a toggle.** `getComputedStyle` per element is O(n) and slow
  on large DOMs; the toggle makes the cost explicit. Probe with `new Image()` only for
  elements that report a `background-image`.

### 8. Accessibility (WCAG 2.2)

- **Blocked on `axe-core` approval.**
- axe-core is plain JS, not WASM, so the CSP entry is irrelevant to it; unlike Harper it
  needs a live DOM with computed styles, so it runs in the extension's content script
  (isolated world), not the offscreen document and not the page world.
- Configure for WCAG 2.2 A/AA; report rule id, selector, help text and "how to fix".
- Group by severity; do not dump raw axe JSON.

### 9. Additional screenshot/comment when status = additional rework

- On transition to a configured status: re-capture the page, attach the screenshot, add a
  comment naming the reviewer and the transition.
- **Capture timing is the constraint.** The transition can be observed by a Forge product
  event, but a screenshot can only be taken in a browser at the moment the reviewer is on the
  page. Therefore:
  - transition made **in the overlay** → capture is immediate and labelled "captured at the
    time of the change";
  - transition made **in Jira's UI** → comment and status automation can happen, but the
    screenshot is deferred until the reviewer next opens the page and is labelled "captured
    when the page was next opened".
- Configured per canvas (the status that means "additional rework").

### 10. Status automation — subtask with screenshot

- On the same trigger, create a sub-task in the project's sub-task issue type, with the
  screenshot and a link back to the parent.
- Requires the project to define a sub-task issue type; if it does not, degrade to a comment
  and say so.
- Configuration lives on the existing project settings page (Jira app settings).
- Same screenshot-timing constraint as #9.

### 11. Capture context — already built

- `src/bookmarklet/captureContext.js`, normalised in `src/lib/metadataModel.js`, stored in
  the issue property.
- Records element `tag`/`htmlSnippet`/`styles`, `viewport {width, height, devicePixelRatio}`
  and `environment {browser, os, userAgent}`, on create and on pin move.
- Nothing to build. Optional follow-up: surface it on the ticket card and the issue panel.

### 12. Passive network capture

- `PerformanceObserver` on `resource` entries with `buffered: true`, so entries recorded
  before the overlay opened are still visible.
- Status from `PerformanceResourceTiming.responseStatus` (Chrome/Edge 109+, Firefox 129+,
  Safari 16.4+). Cross-origin responses report `0` unless the server sends
  `Timing-Allow-Origin` — `0` renders as **unknown**, never "fine" and never "broken".
- No monkey-patching of `fetch`/`XMLHttpRequest`, so nothing on the host page can break.
- Also feeds the size tier of #13.

### 13. Large asset identifier

Tiered, cheapest first:

| Tier | Source | Cost |
| --- | --- | --- |
| 1 | `PerformanceResourceTiming` (`transferSize`, `decodedBodySize`) for the URL | none |
| 2 | `HEAD` → `Content-Length`, `Content-Type` | 1 request |
| 3 | Ranged `GET bytes=0-0` → `Content-Range: bytes 0-0/12345` | ~1 byte |
| 4 | Full fetch + trial re-encode | flagged candidates only |

- If a probe returns 200 despite `Range`, **cancel the body after headers**. "Size unknown"
  is a displayed state, not a zero.
- `fastimage` is not needed: dimensions come from `naturalWidth`/`naturalHeight`, which is
  the decoded size and more reliable than sniffing bytes.
- **Heuristics:**
  - *Oversized:* `naturalWidth > clientWidth × DPR × 2` (tunable). 1.25 flags every responsive
    image at its smallest breakpoint and produces noise.
  - *Suspiciously heavy:* bytes-per-pixel **format-aware** — JPEG photos run ~0.1–0.3 B/px;
    PNG graphics legitimately run much higher. A single 0.5 threshold flags every screenshot.
  - *Wrong format:* large photographic image served as PNG.
  - *Under-compressed:* trial re-encode at **quality 75**, report "~N% smaller at q75", never
    a bare percentage.
- **Skip:** `naturalWidth === 0` (not loaded), `clientWidth === 0` (hidden), SVG (B/px is
  meaningless), animated GIF (re-encode is misleading).
- **`srcset`/`<picture>`:** report the source the browser chose, and say so — the author may
  have supplied a smaller candidate the browser declined.
- **`object-fit: cover`:** deliberately cropped; note it rather than calling it oversized.
- **Re-encode guards:** cap ~25 MP and ~10 MB (decoding a huge image can OOM the offscreen
  document); one codec (mozjpeg for JPEG, WebP for the rest).
- **Every finding names the fix:** "serve WebP", "render at 640 px", "compress at q75".

### 14. Colour checker

Two different tools under one name — **which is intended is still open**:

- **Contrast** (default interpretation): compute the effective foreground/background pair by
  walking ancestors through alpha, then the WCAG ratio. Report AA/AAA pass/fail with the
  ratio. No dependency.
- **Palette compliance:** colours outside a configured brand set. Needs a palette configured
  per canvas or per installation, plus an exact-match/near-match policy.

If `axe-core` is approved, axe already covers contrast; a standalone checker is only worth
building if axe is rejected or if palette compliance is the real requirement.

### 15. Page syntax / hygiene linter

- The live DOM has already been repaired by the browser, so **true HTML validation is not
  possible** from it. What can be checked is hygiene:
  - duplicate `id`s;
  - invalid nesting (`div` inside `p`, block inside inline);
  - missing `lang` on `<html>`;
  - heading order (skipped levels);
  - deprecated tags/attributes (`<center>`, `<font>`, `<marquee>`, `align`, `bgcolor`);
  - inline event handlers (`onclick=`);
  - `javascript:` hrefs;
  - forms without labels;
  - broken in-page anchors (`href="#x"` with no matching id).
- Fetching the raw HTML through the service worker would allow real validation, but that is a
  **different document** (server HTML, not the live DOM) and should be labelled as such if
  added later.

---

## Shared components to build

| Component | Notes |
| --- | --- |
| Offscreen WASM host | Lazy instantiation per engine, memory budget, restart on crash, reports restarts to dependent tools |
| SW fetch layer | HEAD / ranged GET / body cancel / timeout / concurrency; one global queue with per-tool quotas |
| DOM extractors | Text blocks, images, links, computed styles; each run extracts its own, caches within the run |
| Findings store | Keyed by `tool + canonical URL + run id`; states not-run / running / done / error |
| Findings UI | Filters (broken / unverified / ok), "raise as pin", per-tool Run and Cancel |
| Config | Per-canvas ignore lists, thresholds, rework status, optional palette |

## Open decisions

1. **`axe-core`** — approve or park accessibility.
2. **Colour checker** — contrast, palette, or both.
3. **Default crawl depth** — 1 or 2.
4. **Harper artifact size** — measure before committing to packaging.
5. **Capture-context display** — surface viewport/environment on the card and issue panel.

## Explicitly not planned

- **Grammar/validation as a service** — text would leave the browser, against the no-egress rule.
- **Server-side link checking** — requests from Atlassian IPs read as an attack and break the
  no-third-party-service rule.
- **True HTML syntax validation** — the browser has already normalised the DOM.
