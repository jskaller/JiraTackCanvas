# JiraTack Privacy Policy

_Draft. Last updated: 2026-10-30. Must be reviewed before Marketplace submission._

JiraTack is a Jira Cloud app that lets QA teams drop pins on web pages and turn them into Jira tickets. This document describes what the app stores, where, and for how long.

## Data we store

**App configuration (Forge KVS, key `installationConfig`)**

- `viewPermissionMode`, per-project settings (enabled flag, default issue type / priority / assignee, filtered-status rule, console-capture settings), archived and deleted canvas names, and a configuration version hash.
- This intentionally contains no personally identifying information.

**Access tokens (Forge KVS)**

- `canvasTokens:<token>` — for canvas and guest tokens: canvas name or guest-canvas list, issuing or delegating Atlassian account ID, installation ID, scope, admin flag, permitted project keys, issue/expiry timestamps, revocation flag. Canvas tokens expire after 30 days; guest tokens after 365 days.
- `userTokens:<token>` — personal bookmarklet tokens: account ID, installation ID, scope, admin flag, permitted project keys, issue/expiry timestamps. Expire after 90 days.
- Tokens are random 64-character values. The admin UI shows only a 12-character SHA-256 reference, never the token itself.

**Licensed-user records (Forge KVS)**

- `jiratack_licensed_users:<accountId>` → `true`, written when a seat holder uses the app. Used to constrain guest assignees to licensed users.

**Session signing secret (Forge KVS)**

- A random 256-bit secret used to sign session JWTs (8-hour lifetime).

**Canvas→project cache (Forge KVS)**



**Temporary screenshot uploads (Forge KVS)**

- Base64 chunks of a screenshot, bound to the session subject, with a 15-minute TTL. They are deleted immediately after the image is attached to the Jira issue, or expire automatically if the upload is abandoned.

**On the Jira issues the app creates**

- The issue property `com.jiratack.metadata`: canvas name, the page URL as captured (query string preserved), pin position, CSS selector, and — for guest-created tickets — the guest's name and email address.
- Labels `jiratack`, and `jiratack-guest` for guest tickets.
- The issue description: a JiraTack header, the user's text, optional captured console output, and a link to the page.
- An optional screenshot attachment.

## Data we do not store

- The app keeps no copy of page content, screenshots, or console output outside the Jira issue itself.
- Console output is captured only after the user activates the bookmarklet; it is not recorded passively.
- No analytics, telemetry, or advertising identifiers.
- We do not sell or share data with third parties.

## Network activity

- All Jira traffic goes through Atlassian's `requestJira` API from the Forge app. The app makes no outbound HTTP requests to non-Atlassian services, and no egress permissions are declared.
- The browser client talks only to the app's own Forge web triggers. Screenshots are sent to those triggers in chunks over HTTPS.
- The guest installer page is served from a public web trigger and contains no Jira session or app credentials beyond the guest token in its URL.

## Guest links

A guest link is a bearer credential. Anyone holding it can create and edit tickets within the canvases the issuer selected, using the issuer's browse access to those canvases. Guest tickets record the guest's name and email so reviewers know who filed them. Guest links expire after 365 days and can be revoked by an admin.

## Data location and retention

- Data is stored in Atlassian Forge infrastructure for the lifetime of the installation. Uninstalling the app removes KVS data in accordance with Forge platform behaviour.
- Token records expire on their TTLs (30 / 90 / 365 days) and can be revoked earlier; revocation applies immediately to new session exchanges, while existing session JWTs remain valid for up to 8 hours.
- Screenshot uploads expire after 15 minutes at most.
- Jira issues, descriptions, and attachments follow the customer's own Jira retention settings.

## Contact

[TODO: support contact / privacy contact]
