# JiraTack

A Forge app for dropping visual pins on web pages and turning them into Jira tickets.

## Status

v0.9.0 — MVP Feature Complete, Internal Testing Phase

## Documentation — read in this order

| Document                                         | Purpose                                                                                     | Stability                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------- |
| [SPEC.md](./SPEC.md)                             | Product specification. Source of truth for behavior.                                        | Stable                                 |
| [ARCHITECTURE.md](./ARCHITECTURE.md)             | System architecture, data flow, token model, runtime constraints.                           | Stable                                 |
| [CONTRACTS.md](./CONTRACTS.md)                   | Wire-level contracts: function signatures, API shapes, error codes, manifest, package.json. | Updated per Forge platform corrections |
| [BUILD_PLAN.md](./BUILD_PLAN.md)                 | Seven sprints, file lists, acceptance criteria, sprint dependencies.                        | Updated per Forge platform corrections |
| [DECISIONS.md](./DECISIONS.md)                   | Consolidated decision log. Open and resolved, in one place.                                 | Single source of truth for decisions   |
| [PRIOR_BUILD_TRIAGE.md](./PRIOR_BUILD_TRIAGE.md) | What was reviewed from JiraTack2 and JiraTack3, what ports, what doesn't.                   | Reference only                         |

## Precedence rules

1. **CONTRACTS.md wins** on wire-level details (shapes, signatures, error codes, manifest, package.json).
2. **SPEC.md wins** on product behavior.
3. **DECISIONS.md wins** on open/closed questions — every decision has exactly one entry there, and any other document that mentions it defers to DECISIONS.md.
4. Where a document contradicts these rules, the rules win. Propose an amendment as a separate commit.

## Runtime

Atlassian Forge, Node.js 24.x. All JavaScript. No TypeScript. No Python.

## Repository layout