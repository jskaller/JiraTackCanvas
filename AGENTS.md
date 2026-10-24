# AGENTS.md — JiraTack

Read this before any work in this repo.

## What this is

JiraTack is a Forge app that lets QA teams drop pins on web pages and turn them
into Jira tickets. Pre-build — no source code exists yet. All work proceeds by
sprint per BUILD_PLAN.md.

## Read order

1. CONTRACTS.md — wire-level contracts (signatures, shapes, error codes)
2. BUILD_PLAN.md — sprint structure and acceptance criteria
3. TEST_PLAN.md — per-sprint verification commands
4. DECISIONS.md — resolved and open decisions
5. SPEC.md — product behavior
6. ARCHITECTURE.md — system architecture

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

## Sprint discipline

- Implement exactly what BUILD_PLAN §<sprint> lists. Nothing else.
- Do not refactor, rename, or improve adjacent code.
- Do not start a sprint's work before its prerequisites (BUILD_PLAN §2) are complete.
- Before proposing a commit, run the matching TEST_PLAN §<sprint> assertions and report pass/fail for each.
- If an assertion fails, do not proceed to the next sprint. Report the failure.

## Build commands

- `npm run build` — bundle bookmarklet + dashboard
- `forge deploy -e development` — deploy
- `forge tunnel` — live reload during development
- `forge logs -e development` — view logs
- `forge register` — one-time, run before first deploy

## Key constraints (do not violate)

- Webtriggers are public and have no user identity. Do not call `asUser()` in webtrigger handlers.
- URL normalization must be byte-identical between client and server. One shared module (`src/shared/urlNormalize.js`).
- Pin data lives in four Jira custom fields; the description marker is only a recovery backup.
- `permittedProjects` claim in JWT is set at issuance; webtrigger filters by it.
- Never store `CryptoKey` objects — not relevant to v1 but noted for future crypto work.

## When in doubt

Ask. Read the referenced CONTRACTS section. Do not guess.
