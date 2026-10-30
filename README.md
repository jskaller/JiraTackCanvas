# JiraTack

A Forge app for dropping visual pins on web pages and turning them into Jira tickets.

## Status

Development environment, app version **4.92.0** (SDK `d5d8edafeda5`). `package.json` version is `0.1.0`. Not yet submitted to the Marketplace.

## Documentation — read in this order

| Document | Purpose | Status |
| --- | --- | --- |
| [DECISIONS.md](./DECISIONS.md) | Decision log. Resolved and open, one entry per ID. | **Authoritative** on every decision (through D22) |
| [CONTRACTS.md](./CONTRACTS.md) | Wire-level contracts: action shapes, error codes, JQL, manifest, `package.json`. | **Current** — wins on wire details |
| [SPEC.md](./SPEC.md) | Product behaviour of shipped code (v3.0). | **Current** |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System shape, channels, storage, authorisation, delivery constraints (v2.0). | **Current** |
| [TEST_PLAN.md](./TEST_PLAN.md) | Per-sprint verification commands and assertions. | **Current** for Parts 2, 3, 5, 7, 8 |
| [AGENTS.md](./AGENTS.md) | Working rules and non-negotiables for agents. | **Current** |
| [docs/BASELINE.md](./docs/BASELINE.md) | Deployed vs tree state, versions, verification status, open items. | **Snapshot** at `baseline/pre-pivot-2026-10-30` |
| [docs/SECURITY-REVIEW.md](./docs/SECURITY-REVIEW.md) | Security findings, measurements and remediation ledger. | **Current** record of review |
| [docs/AI-CONTEXT.md](./docs/AI-CONTEXT.md) | Dense brief for another AI context or a new engineer. | **Current** summary |
| [BUILD_PLAN.md](./BUILD_PLAN.md) | The original seven-sprint build plan. | **Historical** — describes the pre-guest, pre-D18 build. Do not cite as current. |
| [PRIOR_BUILD_TRIAGE.md](./PRIOR_BUILD_TRIAGE.md) | What was reviewed from JiraTack2/3 and ported. | **Historical** reference only |
| [CHANGELOG.md](./CHANGELOG.md) | Release notes. | Historical, append per release |
| [docs/PRIVACY.md](./docs/PRIVACY.md) | Draft Marketplace privacy policy. | Draft — needs review before submission |
| [docs/MARKETPLACE.md](./docs/MARKETPLACE.md) | Draft Marketplace listing copy. | Draft — needs review before submission |

## Precedence rules

1. **CONTRACTS.md wins** on wire-level details (shapes, signatures, error codes, manifest, `package.json`).
2. **SPEC.md wins** on product behaviour.
3. **DECISIONS.md wins** on open/closed questions. Every decision has exactly one entry, and every other document defers to it.
4. Where a document contradicts these rules, the rules win. Propose an amendment as a separate commit.

## Runtime

Atlassian Forge, Node.js 24.x. All JavaScript. No TypeScript. No Python.

- Three web triggers: `jiratack-api` (client actions), `jiratack-sdk` (SDK bundle), `jiratack-install` (public guest installer page).
- Storage: `@forge/kvs` only.
- Pin metadata: the Jira issue property `com.jiratack.metadata`; labels `jiratack` (+ `jiratack-guest`). No custom fields (D18).

## Repository layout

```text
manifest.yml              Forge manifest (5 surfaces, entity property, 3 web triggers)
src/
  resolvers/              in-Jira resolvers (tokens, dashboard, panels, config, canvas lifecycle)
  webtrigger/             client API, SDK server, guest installer; actions/ + middleware/
  bookmarklet/            on-page SDK (overlay, pins, form, inline edit, capture, auth, api)
  custom-ui/dashboard/    React dashboard (Custom UI)
  ui-kit/                 admin, project settings, epic panel, issue panel (UI Kit)
  shared/                 urlNormalize, adfSerializer, adfText, safeUrl, bookmarklet bootstrap
  lib/                    config, kvs, tokens, metadata, access, license, canvas, jql, errors
dist/dashboard/           built Custom UI bundle
scripts/embed-sdk.js      inlines the bookmarklet bundle + derives SDK_VERSION
docs/                     draft Marketplace copy and privacy policy
```

## Build and deploy

```bash
npm run build                 # bookmarklet + dashboard + SDK embed/version
forge deploy -e development
forge tunnel                 # live reload during development
forge logs -e development    # logs
```

An SDK change requires re-dragging the bookmarklet: the version is a content hash baked into the bookmark at generation time (D13).

## Tests

```bash
node --test src/shared/urlNormalize.test.js src/shared/adfSerializer.test.js \
            src/shared/adfText.test.js src/shared/safeUrl.test.js
```

Manual and integration assertions live in [TEST_PLAN.md](./TEST_PLAN.md).
