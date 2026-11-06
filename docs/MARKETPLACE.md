# JiraTack Marketplace Listing

Draft copy for the Atlassian Marketplace listing. Review and finalise before submission.

## App name

JiraTack

## Tagline

Drop pins on web pages. Turn them into Jira tickets.

## Short description

JiraTack lets QA and product teams pin issues directly on the pages they are reviewing. Click a spot on the page, describe the problem, and JiraTack creates a Jira ticket with the page URL, pin position, and optional screenshot and console output.

## Highlights

- Pin issues on any web page with a bookmarklet — no install step for reviewers.
- Three ways to share access: a per-canvas bookmarklet, a personal bookmarklet with a canvas launcher, and a guest link for external reviewers.
- Creates Jira tickets with page URL, position, CSS selector, optional screenshot, and captured console output.
- Canvas dashboard aggregates pins across projects, with per-canvas ticket and URL counts.
- Epic and issue panels show related pins without leaving Jira.
- Guest links are seat-gated, scoped to chosen canvases, and expire after 365 days.
- Revocable tokens: canvas (30 days), personal (90 days), guest (365 days).
- No custom fields and no schema changes. Pin data lives in a Jira issue property, so the app installs and works without touching your field configuration.

## Categories

- [TODO: select Marketplace categories, e.g. Testing, Developer Tools]

## Permissions justification

- `read:jira-work`, `write:jira-work` — read issue data and create/update JiraTack tickets.
- `read:jira-user` — resolve assignees and participants.
- `storage:app` — store installation configuration, token records, and short-lived screenshot chunks.

No `manage:jira-project` or `manage:jira-configuration` scope is requested: the app creates no custom fields and never touches screens or field configuration.

## What the app does not do

- No browser extension is installed or required.
- No page content is proxied or stored server-side.
- No data leaves Atlassian infrastructure. The app declares no external egress.

## Known limitation to disclose

The bookmarklet loads its client script from the app's own domain, which strict Content-Security-Policy sites can block (for example GitHub or Google account pages). On those sites the overlay will not open. Support documentation should name this explicitly rather than let reviewers discover it. A content-script extension is the planned fix (see `DECISIONS.md` D22).

## Support

- Support URL: [TODO]
- Documentation: [TODO]

## Privacy

See [PRIVACY.md](./PRIVACY.md).

## Screenshots

- [TODO: Canvas dashboard]
- [TODO: Pin mode on a web page]
- [TODO: Epic panel]
- [TODO: Issue panel]
- [TODO: Guest link flow]

## Pricing

Per Jira user, per month — not per app user, and guests are free.

| Jira users | Standard | With the QA edition |
|---|---|---|
| 1–10 | $6.00 / user | $8.00 / user |
| 11–50 | $5.00 / user | $6.50 / user |
| 51–250 | $4.00 / user | $5.20 / user |
| 250+ | $2.50–3.00 / user | $3.25–3.90 / user |

Annual billing is discounted. External reviewers — clients and guests — are unlimited and free on every tier.

The QA edition adds the QA toolset to every user on the site; a Jira admin decides nothing per person, and each person turns the tools on or off in their own browser.
