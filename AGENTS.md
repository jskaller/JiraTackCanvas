# AGENTS.md — JiraTack

Read this before any work in this repo.

## What this is

JiraTack is a Forge app that lets QA teams drop pins on web pages and turn them
into Jira tickets. It is built and deployed to the development environment
(app 4.92.0). Sprint plans in BUILD_PLAN.md are historical; current behaviour is
defined by SPEC.md v3.0 and ARCHITECTURE.md v2.0.

## Read order

1. `docs/BASELINE.md` — what is deployed versus the tree, and what is still open
2. DECISIONS.md — authoritative on every decision (through D23)
3. CONTRACTS.md — wire-level contracts (signatures, shapes, error codes, manifest)
4. SPEC.md — product behaviour of shipped code
5. ARCHITECTURE.md — system shape, channels, storage, authorisation
6. TEST_PLAN.md — verification commands (Parts 2, 3, 5, 7, 8 are current)
7. BUILD_PLAN.md — historical sprint plan; do not treat as current scope

`docs/AI-CONTEXT.md` is a ten-minute brief for another agent context; `docs/SECURITY-REVIEW.md` holds findings and remediation.

## Precedence

- CONTRACTS.md wins on wire-level details (shapes, signatures, error codes, manifest, package.json).
- SPEC.md wins on product behavior.
- DECISIONS.md wins on any open/closed question. If a decision ID is referenced elsewhere, DECISIONS.md is authoritative.
- If documents conflict on anything else, ask the human before coding.

## Runtime

- Atlassian Forge, Node.js 24.x
- JavaScript only — no TypeScript, no Python
- UI Kit: `@forge/react` (UI Kit 2). Custom UI: `@forge/bridge`.
- Never add a package without human approval.

## Change discipline

- BUILD_PLAN.md is historical. For new work, implement only what the human asks
  for, no adjacent refactors or renames.
- Before proposing a commit, run the shared-module tests and the relevant
  TEST_PLAN.md assertions, and report pass/fail for each.
- If an assertion fails, stop and report it rather than proceeding.
- Docs must not drift from code: when behaviour changes, update SPEC.md,
  CONTRACTS.md, and DECISIONS.md in the same body of work.
- **Instrument before fixing.** A reported regression gets a recorded reason
  (a field the UI shows, or an assertion the harness reports) before any logic
  changes. Plausible-patch chains cost a day on the card preview; the diagnostic
  that ended it took minutes. If a fix cannot be observed, add the observation
  first.
- **State exactly what was verified.** "Tests pass" means the tests that
  exercise the changed path. A green harness that never runs the failing layer
  is not verification, and saying so is worse than saying nothing.
- **Never verify a doc or ledger edit by eye.** Use `npm run baseline:check`
  (and `node scripts/baseline.mjs record …` after a deploy), which fails when a
  row is missing rather than silently writing nothing.

## Documentation ownership

Each document owns one question. Update the owner, not all of them.

| Document | Owns | Update when |
| --- | --- | --- |
| `SPEC.md` | product behaviour of shipped code | behaviour changes |
| `CONTRACTS.md` | wire shapes, signatures, error codes, manifest | a request, response or manifest changes |
| `DECISIONS.md` | open and closed questions | a decision is made, amended or reversed |
| `ARCHITECTURE.md` | channels, storage, authorisation | the system shape changes |
| `docs/BASELINE.md` | what is deployed | every deploy — with `npm run baseline:record`, never by hand |
| `CHANGELOG.md` | user-visible change | when cutting a release — draft with `npm run changelog:since -- --since <ref>` |
| `TEST_PLAN.md` | how to verify | verification steps change (Parts 1, 4 and 6 are archived) |
| `docs/ARCH-REVIEW-2026-11.md` | the complexity audit | an audit item closes |
| `docs/QA-PACK.md` | QA pack tool list, per-tool rules and build notes | a tool is scoped, built or dropped |

A wire-shape change must touch CONTRACTS in the same commit; a behaviour change must touch
SPEC. Do not restate the same rule in two documents — link instead.

## Build commands

- `npm run build` — bundle bookmarklet + dashboard
- `forge deploy -e development` — deploy
- `forge tunnel` — live reload during development
- `forge logs -e development` — view logs
- `forge register` — one-time, run before first deploy

## Key constraints (do not violate)

- Webtriggers are public and have no user identity. Do not call `asUser()` in webtrigger handlers.
- URL normalization must be byte-identical between client and server. One shared module (`src/shared/urlNormalize.js`).
- Pin metadata lives in the Jira issue property `com.jiratack.metadata` (source of truth). Descriptions are human-readable ADF (no JSON/marker). Labels: `jiratack` on every ticket, plus `jiratack-guest` for guest tickets. Custom fields, the description marker, and recovery logic were removed (D18).
- `permittedProjects` claim in JWT is set at issuance; webtrigger filters by it.
- Admin rights in webtriggers come from the `isAdmin` claim resolved at issuance (D21). Never trust `scope` as proof of admin. Missing claim means non-admin.
- Guest links are gated by the JiraTack seat, not by site admin (D19); guest sessions are confined to `permittedCanvases` and are always `isAdmin: false`.
- The bookmarklet loads the SDK from the `jiratack-sdk` webtrigger, which host-page CSP can block. Do not assume the overlay will appear on strict-CSP sites (D22).
- Never store `CryptoKey` objects — not relevant to v1 but noted for future crypto work.

## When in doubt

Ask. Read the referenced CONTRACTS section. Do not guess.
