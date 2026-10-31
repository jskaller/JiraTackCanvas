# ALIGNMENT-DECISIONS.md — JiraTack business decision list

**Status:** Draft — reconstructed from the 2026-10-29/31 conversation between app owner and assistant.
**Verify before treating as authoritative.** Entries marked [L] need owner confirmation; entries marked [†] are superseded and kept for traceability.
**ID scheme:** P (product), M (market), B (platform/billing), PR (pricing), SU (support), A (access/credential), O (open question).

## Product & Positioning

| ID | Decision | Conf |
|---|---|---|
| P-01 | Jira-native visual feedback tool: reviewer drops pin on live page → Jira ticket. No external widget, no separate tool. | H |
| P-02 | Differentiator = native pin-to-ticket + piggybacked delegation + free external reviewers. **Hierarchy:** value = ease for non-technical users; mechanism = native pin-to-ticket; enabler = no-license delegation. | H |
| P-03 | Non-licensed reviewer piggybacks on a licensed delegator. Created tickets list the delegator as **reporter**. Reviewer identity is an attribution label, not an auth factor. | H |
| P-04 | Two credential forms: browser extension (primary, better UX) and bookmarklet (secondary, no install). | M |
| P-05 | Superseded by the ease-led positioning in P-02. Original competitive draft: "BugHerd/Pastel make you leave Jira; Snapshot/Ybug leave you managing guest access." | † |
| P-06 | Ease parity with standalone tools (BugHerd, Pastel, Marker.io) is a product requirement. Any feature adding reviewer steps must justify against time-to-first-pin and pairing success rate. | H |

## Target Market

| ID | Decision | Conf |
|---|---|---|
| M-01 | Beachhead: **100–500 Jira users**. | H |
| M-02 | Expansion: **500–1,000+ Jira users**. Enter after case studies + enterprise features. | H |
| M-03 | Opportunistic: **10–100 Jira users**. Low-cost tier for install volume and reviews; no bespoke features. | H |
| M-04 | Motion: **land with Team, expand into Business**. | H |
| M-05 | Planning envelope: **~25K–40K medium installs**, **~15K–25K large installs**. Derived from ~125K Jira customers × FY2020 server split (27% / 16%). Caveat: server-era split skews large vs. today's cloud mix. | H |
| M-06 | $1M ARR ≈ 3.8% of medium segment (pure Team) or 2.1% of large (pure Business). | H |
| M-07 | 50 Team ≈ $38.4K ARR; 10 Business ≈ $23.9K; blended 40 Team + 5 Business ≈ $42.7K at 45 logos = most capital-efficient at launch. | H |
| M-08 | Launch target: **Jira Software** (now "Jira"). Rationale: ~150K cloud Jira customers vs. ~65K JSM; 92.6% bug-tracking share; JSM has a customer portal that partially addresses unlicensed intake. | H |
| M-09 | **JSM is Phase 2.** Revised framing: the qualifying question is "do multi-disciplinary teams run design/product/website review through JSM?" — not "can non-licensed users submit tickets?" JSM portal answers the latter; it does not answer the former. | H |
| M-10 | Marketplace metadata targets **"Jira"** at launch. JSM compatibility listed only when Phase 2 ships. | H |
| M-11 | JSM Phase 2 targets the **cross-functional design/product review sub-segment** (product ops, design ops, marketing/brand review, non-IT service owners). | H |
| M-12 | JSM Phase 2 message: **"portal for structured requests, visual layer for design/product review."** Complementary to the portal, not a replacement. | H |
| M-13 | JSM Phase 2 buyer: **JSM admin**. Strongest pain signal from the **service project admin / queue owner**. Budget line: JSM/platform/IT tooling, not design-team tooling. | H |
| M-14 | Design/product teams are the **champion and adoption engine**, not the buyer. Message to them is **category-known, venue-new** ("the visual feedback tool you already know, now native in Jira"). | H |
| M-15 | **Admin-led purchase without design-led adoption is the primary churn risk** for Phase 2. Onboarding must target reviewers, not just the purchasing admin. | H |
| M-16 | **GTM is dual-track.** Admin track = purchase (Marketplace ASO, Atlassian Community, ACE/partners, admin-framed content, modest paid). Design-team track = demand and adoption (problem-intent SEO, competitor-alternative pages, design communities, newsletters, Product Hunt, LinkedIn, agency partnerships). | H |
| M-17 | Design-team marketing KPI is **champion activation / internal request**, not installs. CTA: "send this to your Jira admin." Supported by a **champion kit** (one-pager: capability, security, flat-fee pricing, install link). | H |
| M-18 | **The invite/setup page is a marketing surface** — seen by every reviewer at the moment of use. Carries one-line "what this is" plus a soft referral link. | H |

## Platform & Billing

| ID | Decision | Conf |
|---|---|---|
| B-01 | **Build on Forge.** 0% rev share until $1M lifetime Forge revenue, vs. Connect rising to 25% July 2026. | H |
| B-02 | **Standard Billing is the only GA option** — charges the full Jira user tier, not actual app users. | H |
| B-03 | **User-Based Billing is not publishable** — EAP only; pricing setup and Marketplace publishing unreleased. | H |
| B-04 | Pricing decouples headline price from instance size; plan value gated at the application layer. | H |
| B-05 | Listing copy states: "Flat platform fee. Not charged per Jira user. External reviewers free up to monthly capacity." | H |

## Pricing

| ID | Decision | Conf |
|---|---|---|
| PR-01 | Hybrid: low baseline platform fee + reviewer-capacity meter. | H |
| PR-02 | Metered unit = **active external reviewers**, not delegator seats. | H |
| PR-03 | **Active reviewer = unique email per installation** submitting ≥1 pin in the billing month. | H |
| PR-04 | Pin volume = secondary pooled monthly meter. | H |
| PR-05 | **Tier structure (final).** Starter: $29–$35/mo, 5 reviewers, 50 pins. Team: $79–$99/mo, 25 reviewers, 500 pins. Business design-partner: $99–$149/mo, 100 reviewers, 2,000 pins, capped 5–10 accounts, 12-month agreement. Business full: $179–$249/mo, 100 reviewers, 2,000 pins. | H |
| PR-06 | Delegators unlimited on all tiers. | H |
| PR-07 | External reviewers free up to plan capacity. | H |
| PR-08 | No hard wall at capacity. Upgrade or top-up. | H |
| PR-09 | Cap enforced at **first pin**. Corrected from "invite redemption" — email does not exist before first pin. | H |
| PR-10 | Active credentials never blocked mid-month. | H |
| PR-11 | **Consumed slot stays consumed** for the billing month even if the credential is revoked. Kills revoke-and-recycle farming. | H |
| PR-12 | Inactive credentials drop off at month boundary. | H |
| PR-13 | Business gates SSO, advanced permissions, advanced audit trail, **named-reviewer enforcement**. | H |
| PR-14 | **Rejected:** per-delegator seats; pure per-creation pricing; hard fixed pool with lockout; per-binding grace budgets; 30-day re-grace lockout; lite delegation as core type. | H |
| PR-15 | Annual billing at ~20% effective discount. | H |
| PR-16 | Position on **total cost and workflow, not lowest headline price.** Cheap pricing reads as unproven in a trust-sensitive category. | H |
| PR-17 | **Team = volume engine; Business = ARR-efficiency engine.** Procurement approval thresholds are a first-class tier-design constraint. $150/mo is immaterial against Jira spend but crosses a department-head boundary — that friction is the constraint, not budget magnitude. | H |
| PR-18 | **Design-partner terms:** capped 5–10 accounts, 12-month agreement, contractual conversion date and price step, feedback cadence commitment, reference/logo consent. | H |

## Support

| ID | Decision | Conf |
|---|---|---|
| SU-01 | **Async-only support across all tiers.** Email + KB + recorded walkthroughs. No live calls, no named contact, no contractual SLA. Published targets explicitly non-contractual. Starter = KB + community only. Team = email, best-effort, aim 2 business days (P1). Business = email priority-flagged, best-effort, aim 1 business day (P1). | H |
| SU-02 | **Support-load reduction is launch-blocking.** Specific items: self-diagnosing bookmarklet (CSP failure detection + copy-diagnostics + support route); graceful token-expiry / already-used path; capacity-limit message that names the admin and upgrade path; admin health-check panel. | H |
| SU-03 | **Expansion trigger:** MRR ≥ **$8–10K** *or* support inbox > **~15 tickets/week sustained for a month** → convert design partners to full Business pricing, bring on fractional async support **before** promising faster response. Live calls come last. | H |

## Access & Credential

| ID | Decision | Conf |
|---|---|---|
| A-01 | Delegator generates invite link from inside Jira, scoped to a project (optionally delegator identity for attribution). | H |
| A-02 | **Superseded:** setup page is a **public webtrigger-rendered HTML page**, not a Forge Custom UI page. Custom UI full-page requires auth context; unauthenticated guests do not have it. | † |
| A-03 | Invite URL carries a **signed, short-lived token (24–72h)** — not a raw email. **Current implementation is opaque unsigned bearer with 30/90/365d TTLs; remediation via TD §8(a).** | H |
| A-04 | Forge page validates signature and resolves email server-side. Email never in address bar. **Deferred: current implementation carries token in installer URL and history.** | H |
| A-05 | **Email is an attribution label, not an authentication factor.** No magic-link gate before first pin. Unverified emails still count as slots. | H |
| A-06 | Bookmarklet generated on the fly with token embedded, drag-to-bar. **CSP handling:** failure card (commit 027d590), detect onerror / Trusted Types / init-timeout; show reason + Dismiss. | H |
| A-07 | **Extension pairing:** `externally_connectable` primary (scoped to `https://*.atlassian.net/*`), paste-key fallback (universal). Not `postMessage` (no iframe boundary). Not custom protocol (Forge blocks). Optional tabs listener as opt-in only. | H |
| A-08 | Credential lifecycle: **Issued → Active → Revoked.** No other states. | H |
| A-09 | **Revocation is a security action only.** No grace, no continuity window. | H |
| A-10 | Each bookmark carries a unique, revocable, scoped token (submit pin for this delegation only). | H |
| A-11 | Token storage: Forge `kvs.setSecret` (preferred) or `webtrigger` + signed JWT. Forge provides no platform auth for webtriggers — roll own validation. | H |
| A-12 | If delegator loses Jira access or relevant permissions, all their reviewer tokens are invalidated. | H |
| A-13 | **One-sentence test.** Reviewer: "Your delegator sends you a link, you enter your email, you start pinning." Admin: "You have 25 reviewer slots; here's who's using them; upgrade if you need more." If it can't be said in one sentence, too complex. | H |
| A-14 | Admin screen: **"18 of 25 reviewer slots used this month"** + bound emails, pin counts, revoke buttons. | H |
| A-15 | Every failure mode has a defined state with plain-language message, named fixer, and one-click action. **No bare error pages.** | H |
| A-16 | **Withdrawn.** Depends on the A-03 fix; currently impossible with opaque unsigned tokens. | † |
| A-17 | **Delegator-side one-click regeneration** via in-app notification. notify → regenerate → redeem loop is the primary self-healing path. | H |
| A-18 | **Token resolution rate-limited** (enumeration + notify-spam protection). Submitted tokens never echoed back or in diagnostics. | H |
| A-19 | **Every dead end emits a reason code.** "Dead ends converting to redemption within 24h" is a tracked product metric. | H |
| A-20 | **Invite token is multi-use within expiry, capped at 10 pairings per token.** Pairing = (inviteToken, installId). The cap is a blast-radius control, not enforcement: installId is client-chosen, so anyone holding the link can pair up to 10 times by clearing storage. Bounded, auditable, revocable via invite regeneration. Cap resets only on delegator regeneration. | H |
| A-21 | **Pairing count, not device identity.** UI says "devices"; implementation counts pairings. *Footnote 2026-10-31: a pairing is keyed by a browser-profile-scoped installId (32 lowercase hex), not a hardware device. Two browser profiles are two installIds; clearing storage produces a new one.* | H |
| A-22 | **Pairing rows carry:** installId, userAgent (captured server-side at first exchange — audit label only, spoofable, not a fingerprint), firstSeenAt, lastSeenAt. pinCount is **computed on demand** by joining tickets whose metadata `pairingId` matches the row; it is not stored (the join scan is capped at 2,000 tickets because `pairingId` is not an indexed entity property). Individual pairing revocation is deferred; `state: "revoked"` exists on the schema but this slice has no setter. | H |
| A-23 | **Guest email is a bound record**, not per-ticket free text. Prerequisite for PR-03. | H |
| A-24 | Per-pairing credential tokens referencing the binding. | H |

## Open questions

| ID | Question | Conf |
|---|---|---|
| O-01 | Extension pairing mechanism. | † resolved A-07 |
| O-02 | Token dead-end path. | † resolved A-15 / A-17; remaining states per S4 |
| O-03 | Jira Software vs. JSM first. | † resolved M-08 / M-09 |
| O-04 | Exact price points within ranges. | Open — recommendation: mid-point of each band |
| O-05 | Pursue User-Based Billing EAP? | Open — not a launch dependency |
| O-06 | Trial length and trial-to-paid optimization. | Open — recommendation: 30 days, optimize to first pin |
| O-07 | Support model per tier. | † resolved SU-01 |
| O-08 | GTM/messaging plan. | Open — partially resolved M-16 / M-17 |
| O-09 | "Lite delegation" as a Business-tier feature. | Open |
| O-10 | Primary in-app upgrade trigger: pin volume or reviewer count. | Open |
| O-11 | Annual discount magnitude (~15/20/25%) and Business annual-only question. | Open |
| O-12 | Price-signaling story in listing copy. | Open |
| O-13 | Which 5–10 design partners. | Open — recommendation: agencies with design-review workflows, plus 2–3 mid-market Jira Software installations |
| O-14 | Self-diagnostic tooling scope. | † resolved SU-02 specifics |
| O-15 | Pairing success rate threshold for promoting tabs listener to default. | Open |
| O-16 | Invite token single-use vs. multi-use. | † resolved A-20 (multi-use, capped at 10) |
| O-17 | Does delegator see pairing rows, admin, or both? | Open — recommendation: both, delegator sees own |
| O-18 | JSM Phase 2 buyer. | † resolved M-13 |
| O-19 | JSM Phase 2 portal integration surface. | Open |
| O-20 | First 3–5 agency/design partner targets. | Open |
| O-21 | Paid-search test scope. | Open |
| O-22 | Positioning statement. | † resolved P-02 / P-05 |
| O-23 | Message hierarchy per audience. | † resolved by P-02 reframe and M-14 |
| O-24 | Launch-readiness sequence. | Open |
| O-25 | Time-to-first-pin target. | Open — recommendation: under 2 minutes from opening invite link to first pin submitted |
| O-26 | Guest token bootstrap vs. sign-in-place. | † resolved TD §8(a): sign + 72h |

## How to use this document

1. **Verify [L] entries** (none currently flagged — all entries were stated explicitly or consistently across the thread). If any entry's wording does not match your intent, edit it before commit.
2. **Do not re-open [†] entries** — they are superseded by later decisions and kept for traceability only.
3. **When the build prompt cites an ID** (e.g. PR-05, A-13, SU-02), the authoritative text is the row above, not a paraphrase.
4. **Tier numbers, reviewer caps, pin caps, and price points are locked** as of 2026-10-31. Changing any of them requires a new entry, not an edit.