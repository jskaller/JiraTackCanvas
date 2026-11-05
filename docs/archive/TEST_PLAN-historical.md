# TEST_PLAN.md — archived parts

Parts 1, 4 and 6 covered sprints whose code has since been replaced (scaffolding,
initial capture flow, and the first Epic/issue panels). They are kept verbatim for
history; the commands in them no longer describe the shipped tree.

The current verification plan is `TEST_PLAN.md` (Parts 0, 2, 3, 5, 7, 8 and 9).

---

## Part 1 — Sprint 1 tests: Scaffolding, Metadata, Admin Config

### 1.1 Deploy and install

bash

forge deploy -e development

# Assert: exits 0

forge install -e development

# Assert: exits 0, or "already installed" if re-running

### 1.2 All five surfaces render

| Surface          | How to reach                                     | Assert                                            |
| ---------------- | ------------------------------------------------ | ------------------------------------------------- |
| Global page      | Jira → Apps → **JiraTack Canvases**              | Dashboard renders with the canvas table |
| Admin page       | Jira Settings → Apps → **JiraTack**              | Admin config renders with `viewPermissionMode` and token list |
| Project settings | Project Settings → Apps → **JiraTack**           | Project config form renders                       |
| Epic panel       | Open any epic → Panels → **JiraTack Canvases**   | Panel renders (empty state is correct)            |
| Issue panel      | Open any issue → Panels → **JiraTack**           | Panel renders ("Not a JiraTack ticket" for unindexed issues) |
| Webtrigger       | `curl -s $WT/api -X POST -d '{"action":"getPriorities"}' -H "Authorization: Bearer $JWT"` | Returns `{ ok: true, data: { priorities: [...] } }` |

Browser console for each surface: **no red errors**. Warnings are acceptable if from Jira itself.

After updating manifest scopes, run `forge install --upgrade -e development` to authorize them.

### 1.3 Metadata and labels (replaces field provisioning)

There is nothing to provision. Verify the storage model instead (D18):

1. Create a ticket from a write bookmarklet on a test page (Part 4 if not yet possible), or create one via `createIssue`.

2. Fetch the property:

```bash
curl -s -u "$EMAIL:$API_TOKEN" \
  "https://<site>.atlassian.net/rest/api/3/issue/<KEY>/properties/com.jiratack.metadata" | jq .
```

3. Assert the value is:

```json
{
  "pin": { "canvas": "<canvas>", "url": "<normalised url>", "position": "<relX,relY>", "selector": "#x" },
  "version": 1
}
```

4. Assert the issue labels include `jiratack`, and `jiratack-guest` for a guest-created ticket.

5. Assert **no** JiraTack custom fields exist: Jira admin → Settings → Issues → Custom Fields contains no `JiraTack Canvas`, `Page URL`, `Pin Position`, or `Pinned Selector` created by the app.

### 1.4 `installationConfig` in KVS

Open Developer Console → Storage → `installationConfig`, or read it via the admin resolver.

Assert shape:

```json
{
  "viewPermissionMode": "per_user_projects",
  "projects": {},
  "archivedCanvases": [],
  "deletedCanvases": [],
  "configVersion": "<64-hex>",
  "updatedAt": 1234567890,
  "schemaVersion": 1
}
```

Assert: **no `fieldRegistry` key.**

### 1.5 `viewPermissionMode` toggle

1. Admin page: change the toggle from `per_user_projects` to `open`.

2. Assert: success message, and `configVersion` in KVS changes.

3. Toggle back. Assert `configVersion` changes again.

### 1.6 No provisioning or audit surface (D18)

1. Open the admin page.

2. Assert: there is **no** "Provision fields" button, no field-ID selects, no field mapping audit panel, and no recovery action.

3. Assert: the page loads without errors and shows license status, `viewPermissionMode`, the token list, and the archived/deleted canvas lists.

### 1.7 Project config round-trip

1. Project Settings → JiraTack: set `enabled: true`, `defaultIssueTypeId: "10001"`, hidden statuses = custom (one explicit status picked instead of the Done default).

2. Save. Reload the page.

3. Assert: all values persist.

4. Assert: `installationConfig.projects["<KEY>"]` in KVS matches.

### 1.8 Webtrigger URL discovery (D10)

D10 is resolved: `webTrigger.getUrl('<triggerKey>')` works from resolver context, so no admin-side discovery or KVS caching is required.

1. In a resolver, resolve all three and log them:

```javascript
const { webTrigger } = require('@forge/api');
const api = await webTrigger.getUrl('jiratack-api');
const sdk = await webTrigger.getUrl('jiratack-sdk');
const install = await webTrigger.getUrl('jiratack-install');
console.log('[JiraTack] urls', { api, sdk, install });
```

2. Assert: all three return absolute HTTPS URLs.

3. Assert: `generateCanvasToken` returns both `apiUrl` and `sdkUrl`, and they are **different** URLs (the SDK is not derived from the API URL).

4. Assert: `generateGuestToken` returns an `installerUrl` of the form `<install>?token=<token>`.

`resolveWebtriggerUrls()` still honours a `webtriggerUrls` value in `installationConfig` if one is present, so an operator can pin URLs; nothing writes that key in normal operation.

### 1.9 Logs are clean

bash

forge logs -e development

# Assert: no lines starting with "[JiraTack] ERROR"

# Assert: no unhandled promise rejections

### Sprint 1 exit criteria

All of 1.1–1.10 pass. Commit: `feat(s1): scaffolding, metadata model, admin config`.

---

## Part 4 — Sprint 4 tests: Capture Flow

**Prerequisite:** Sprint 3 complete, a live page with console activity.

### 4.1 Pin mode activation

- Click "Pin mode" toggle.

- Assert: cursor becomes crosshair.

- Hover over an element: assert `#1869DB` dashed outline + tooltip (`DIV · click to pin`).

- Press `Esc`: assert pin mode exits without creating a pin.

### 4.2 Drop a pin

- Click "Pin mode" → click on element.

- Assert:
  
  - Pin renders at click point.
  
  - New-ticket form opens in sidebar.
  
  - Form fields: Project, Issue type, Summary (with `[JiraTack]:` prefix), Description, Priority, Assignee, Parent, Console checkbox, Screenshot thumbnail, Submit/Cancel.

### 4.2b Popover capture, sidebar defaults and compose mode (D34/D36)

1. Assert the header has one capture control, **New Pin**, with the helper **"Click an element to pin it, or select text to suggest an edit."**, and no **Text change** mode. Assert the button is outlined at rest.

2. Click **New Pin**: assert the button fills blue, `aria-pressed="true"`, the helper changes to the click/Esc instruction, and the page cursor is a crosshair. Click an element. Assert an anchored composer opens promptly with **Summary** and **Description**, and the sidebar form has *not* opened. In the extension, assert the composer uses the visible-tab capture path; in the bookmarklet, assert it opens immediately and does not run html2canvas until Add. The pending pin marks the element.

3. Fill Summary and Description and press **Add to ticket**. Assert the composer closes, the sidebar form opens, the content is carried into Summary and Description, and the screenshot thumbnail (or the no-screenshot warning) is already resolved. Assert focus lands in Assignee.

3b. Assert the form is grouped into **Assigned to**, **Ticket** and **Evidence** cards; there is no CONTENT wrapper. The Assignee card is tinted with a blue accent and contains the reporter line. Description is its own card.

4. Assert the order: **Assignee** (focused) → “Reporting as …” → Project / Issue type (same row) → Summary → conditional text-change pair → Description → Attach files / Record screen (two buttons) → captured evidence below them → Additional fields → sticky Create/Cancel.

5. Assert metadata defaults come from the newest non-empty values across the canvas's non-seed pins: project, issue type, assignee, priority and parent. With no previous assignee, assert the current user; for a guest, the sponsor. With one permitted project, assert it is selected. Parent is visible, prefilled and editable.

6. Assert compose mode: no filter/match row, a page-URL line is shown, and the ticket list is one line (`N other tickets on this page`). Expand it and assert the cards return without losing the draft.

7. Assert New Pin is absent and Switch Canvas / the guest canvas dropdown is disabled while composing. Assert the seed ticket (`[JiraTack] Canvas created`) is not listed and has no pin at the document origin.

7b. **Record screen (D37).** In the extension, click **Record screen** and assert no picker appears; the button becomes **Stop recording** and the status says the current tab is recording. Stop after a few seconds; assert the preview and size appear and the button returns. In the bookmarklet, assert the display picker opens with the current tab preselected.

8. Drag-select a phrase with the mouse. Assert the pill is hidden during the drag and appears on release. Assert it stays clickable even if the page collapses the native selection on mouseup, and that clicking elsewhere or pressing `Esc` dismisses it. No form opens from the selection alone. Click the pill: assert the composer opens with the quote, the **Suggested text**, and **View on page** — and that the sidebar form still has not opened.

9. With **New Pin armed**, drag-select a phrase: the selection owns the gesture — the pill shows and no pin composer opens (harness `text: arming New Pin does not swallow a text selection`).

9. Type the suggested text and turn on **View on page**: assert the original is red with `line-through`, the replacement is green, and the rest of the page is unchanged. Turn it off and assert the page text is byte-identical. Turn it on/off twice more; assert it remains repeatable.

10. Re-render the page (replace/re-wrap the paragraph), then preview again: assert the preview re-resolves and still works. If the phrase is no longer uniquely findable, assert the switch turns off with a hint instead of highlighting the wrong text.

11. Press **Add to ticket**. Assert the sidebar opens with a standalone **TEXT CHANGE** card between Ticket and Description: a large centered **View on page** toggle, **Edit**, and a wrapping `Original → Suggested` line. Assert Summary is prefilled `Text change: <original>`, and the old large editor/Content wrapper are gone.

12. Click **Edit**: assert the same composer reopens with **Save**, change the suggested text, and save. Assert the pair updates and no second suggested-text field remains in the sidebar.

13. Toggle the form's **View on page** switch: assert it previews the pair and restores the page on hide, including after a page re-render. Then Cancel the draft: assert the page is restored, no request was sent, and the filters/list return.

14. Type seven characters in Summary → counter reads `7/215` (or the carried count + 7 when a text change is present). Submit with a two-character summary → inline error under Summary and focus returns to it. Description empty still submits.

15. Press `Cmd/Ctrl+Enter` with a valid summary → the ticket is created and the sidebar returns to the filters/list. Cancel a draft → no request is sent and the filters/list return.

16. With no project resolved, reopen the form → Project is focused instead of Assignee.

17. **After creation (D35).** Create a ticket with a text change. Assert the created card shows the `Original → Suggested` pair and a switch; toggling it previews the stored pair on the page and toggling off restores. Reopen the overlay and assert the switch is still there from metadata. Open the issue panel and assert one line: `Text change: Original → Suggested`. Assert a ticket created before `textChange` metadata existed has no card switch.

### 4.2c Extension enrollment and stale-config repair (D39)

- Remove the extension and reload a page where the bookmarklet overlay is open. Click the JiraTack toolbar button once: the overlay opens (enrollment) without ever visiting the options page. Assert `chrome.storage.local.jiratackConfig` now matches the page's `window.__jiratackConfig`, including `apiUrl`.

- Simulate a stale config (edit `jiratackConfig.apiUrl` in `chrome.storage.local` to a wrong-but-same-origin URL) and click the toolbar button on a page with a working overlay: assert the stored config is repaired from the page automatically and the overlay opens and exchanges cleanly.

- Assert a candidate whose `apiUrl` has a **different origin** than the stored config never replaces it, even when the candidate exchange succeeds (the cross-origin guard); the stored config keeps running.

- Assert a non-JSON token-exchange answer surfaces the reached URL and content type in the sidebar error card, with the reconnect instruction — not "invalid response".

- With nothing stored and no overlay on the page, the toolbar button opens the options page; pasting a canvas link there still enrols (repair path).

### 4.2d Overlay continuity across a URL change and viewport presets (D40)

- Open a canvas, click a ticket card whose pin is on another URL. Assert a short notice, the tab navigates, and the overlay reappears on the new page with that ticket selected — without touching the toolbar.

- Navigate somewhere else from the reopened page (a plain link). Assert the overlay does **not** follow.

- Close the overlay with the toolbar, then navigate: it stays closed.

- Open the overlay, close the tab, open a new tab on the canvas URL: no overlay until the toolbar is clicked.

- Viewport presets: with the window maximised, click 768 → the window leaves the maximised state and becomes 768 + chrome + 320 wide. Click **Fit** → the previous width **and** maximised state return.

- If Chrome refuses a size (e.g. a full-screen window that cannot be normalised on that platform), assert the sidebar shows a toast naming the reason instead of doing nothing.

- Assert the preset bar sits above page content and its buttons are hit-testable on a page with a high `z-index` overlay of its own.

### 4.3 Form validation

- Submit with an empty or short Summary → inline "Summary must be at least 3 characters." under the field; focus returns to Summary.

- Summary > 215 chars → input truncates at 215; counter shows `215/215`.

- Parent invalid (`not-a-key`) → Additional fields opens, error appears above the actions, focus moves to Parent.

- Missing project or issue type → error above the actions, focus moves to the missing control.

- Description empty → allowed (the field is present, not required).

### 4.4 Console checkbox visibility

- Project config `captureConsoleLogs: false` → checkbox hidden.

- `captureConsoleLogs: true` → checkbox visible.

- Buffer empty → checkbox disabled with tooltip "No console output captured."

- `consoleLogsDefaultChecked: true` → checkbox checked on open.

### 4.5 Console capture

1. Before activating bookmarklet: `console.error('pre-activation')`.

2. Activate bookmarklet. `console.error('post-activation-error')`, `console.warn('post-activation-warn')`.

3. Drop a pin. Open form.

4. Assert: checkbox enabled (buffer non-empty).

5. Check it. Submit.

6. Assert: description contains:
   
   text
   
   Console output:
   [error] post-activation-error (at <source>)
   [warn] post-activation-warn (at <source>)

7. Assert: `pre-activation` error is NOT captured (documented limitation).

### 4.6 Screenshot capture

- Drop a pin on a page with visible content.

- Assert: screenshot thumbnail appears in form (400×400 crop centered on pin).

- Click "✕ Remove" → thumbnail gone.

- Submit without screenshot → ticket created, no attachment.

- Submit with screenshot → ticket created, attachment visible in Jira.

### 4.7 Screenshot failure fallback

- Test on a page with cross-origin images that taint the canvas (e.g. external `<img>` without CORS).

- Drop a pin.

- Assert: no thumbnail shown (silent failure).

- Submit → ticket created without attachment. **No error toast.**

### 4.8 Submit success

- Fill form, submit.

- Assert:
  
  - Toast "Ticket created."
  
  - Pin renders optimistically.
  
  - Sidebar refreshes with new ticket.
  
  - Jira ticket exists with all fields populated.
  
  - Issue labels include `jiratack`, and `jiratack-guest` for guest tickets.
  
  - Issue property `com.jiratack.metadata` matches the capture values.
  
  - Description is ADF only: header, body, optional console block, `Page:` footer.

### 4.9 Cancel

- Drop pin → form opens → click Cancel.

- Assert: form closes, no ticket created, no server call (check Network tab).

### 4.10 Description round-trip (plain text)

The form uses a plain textarea, not a rich-text editor.

- Enter three lines with a blank line between the second and third.

- Submit.

- Assert the description ADF matches CONTRACTS §8.1: one paragraph per line, a contentless paragraph for the blank line, and no marks or list nodes.

### 4.11 Metadata integrity

- After submit, fetch `com.jiratack.metadata` via the properties API.

- Assert `pin.canvas`, `pin.url`, `pin.position`, `pin.selector` match the capture.

- Assert `pin.selector` is `null` when no selector was found (the key is present and null — there is no key-omission rule any more).

- Assert `version === 1`.

### Sprint 4 exit criteria

All of 4.1–4.11 pass. Commit: `feat(s4): capture flow`.

---

## Part 6 — Sprint 6 tests: Epic Panel and Issue Panel

**Prerequisite:** Sprint 5 complete, at least 1 company-managed epic + 1 team-managed epic with JiraTack tickets.

### 6.1 Epic panel — company-managed

- Open a company-managed epic with tickets in 2 canvases.

- Assert: panel shows "JiraTack Canvases referenced by this epic."

- Assert: each canvas row shows `epicTicketCount`, `totalTicketCount`, `urlCount`.

- Assert: counts correct (verify via JQL).

- Assert: `totalTicketCount` is the canvas-wide count and is **larger** than `epicTicketCount` when the canvas holds tickets outside this epic. (Before the fix both values were identical.)

### 6.2 Epic panel — team-managed

- Open a team-managed epic with child tickets in a canvas.

- Assert: same panel content as 6.1.

- Assert: `parent` query works for team-managed.

### 6.3 Epic panel — non-epic issue

- Open a Task/Bug issue.

- Assert: epic panel does NOT render (or shows "Not an epic" fallback if displayConditions fallback is used).

### 6.4 Epic panel buttons

- "Get write bookmarklet" → modal.

- "Copy review bookmarklet" → confirmation → modal.

- "Open canvas" → dashboard filtered by canvas.

### 6.5 Issue panel — JiraTack ticket

- Open a ticket whose `com.jiratack.metadata` is set.

- Assert panel shows:
  
  - Canvas name (clickable → dashboard).
  
  - Page URL (clickable).
  
  - "Copy link to this pin" button.
  
  - "Copy review bookmarklet" button.
  
  - Related tickets list (same canvas + URL, cap 20).

### 6.6 Issue panel — non-JiraTack ticket

- Open a ticket with no `com.jiratack.metadata`.

- Assert panel shows "Not a JiraTack ticket."

### 6.7 Deep link

- Click "Copy link to this pin" → paste URL.

- Assert URL format: `<pageUrl>?jiratack_ticket=<key>`.

- Paste in browser → bookmarklet activates → matching pin highlighted + scrolled into view.

### 6.8 Deep link — pin not found

- Copy deep link, then delete the ticket (or change canvas).

- Paste → bookmarklet activates → toast "Ticket <key> not found on this canvas/page."

### 6.9 Related tickets accuracy

- Assert related list includes tickets with same canvas + same URL, excluding current ticket.

- Assert cap at 20 (create 25 related → only 20 shown).

### 6.10 Field audit and recovery — retired (D18)

Sections 6.10–6.14 described the custom-field mapping audit, description-marker recovery, and the dry-run/actual/malformed/no-marker cases. All of it is gone: there are no custom fields to map and no marker to recover from.

Replace those tests with one assertion:

- Admin page has no field-audit section and no recovery action.
- A ticket created without `com.jiratack.metadata` does not appear in the dashboard, epic panel, issue panel, or overlay, and no error is raised. This is expected, not a defect.

### Sprint 6 exit criteria

All of 6.1–6.10 pass. Commit: `feat(s6): epic panel and issue panel`.

---
