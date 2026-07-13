# ATLITOS v2 — Repo Instructions

This file is read by every agent working in this repo. It is not optional context; it is the entry point.

## Read first, every time

Before touching anything, read in this order:

1. `docs/PLAN.md` — the approved build plan. This is the contract. Do not deviate from it without a founder decision recorded in a phase status doc.
2. The relevant PRD(s) in `docs/prd/` for whatever surface you are touching (PRD-01 athlete, PRD-02 coach, PRD-03 court partner, PRD-04 admin, PRD-05 UPA life, PRD-06 sponsor, PRD-07 shopper). The PRD is the ceiling on scope, not a suggestion. If a feature is not traceable to a `PRD-0X FR-y`, it does not belong in this phase.
3. The current `docs/phases/PHASE-N-STATUS.md` for whatever phase is active. It tells you what is already done, what is in flight, and what handoff notes the previous phase left.
4. `docs/design/TASTE.md` and `docs/design/DESIGN-LANGUAGE.md` for anything touching UI.
5. `docs/agents/workflows.md` if you are unsure what role you are playing in the current phase (planner, builder, integrator, biased approver, phase-close) or how to hand off to the next agent.

Agents are spun up fresh per phase and have no memory beyond what is written in this repo. If something is not written down here, it does not exist for the next agent. Write it down.

## House style (non-negotiable)

- **No emojis anywhere.** Not in UI copy, not in code comments, not in commit messages, not as icon substitutes. Use lucide icon names for iconography.
- **No em-dashes and no hyphens in user-visible copy strings.** Use commas and periods instead. Ordinary compound words in prose docs (this file, PRDs, architecture docs) are fine; the restriction is on copy strings that render in the product.
- **Concise, benefit-led microcopy.** Say what it does for the user, briefly. No filler.
- **lucide icon names only** wherever icons are referenced in code or docs. No other icon library, no custom glyphs standing in for a lucide equivalent.

## Tokens only

Every color, spacing, radius, typography, and motion value in every app resolves through `packages/theme` (mobile) or the portal's HSL CSS var token set (web, shadcn pattern). No hardcoded hex, no arbitrary Tailwind literals, no inline pixel values that bypass the spacing scale. If a value you need does not exist as a token, add it to `packages/theme` (or the portal's token file) first, then use it. Never hardcode around it.

Numeric readouts (prices, stats, timers, counts, percentages) render in JetBrains Mono with tabular figures, everywhere, no exceptions.

## Financial invariant

Clients never write money rows or state transitions directly. This means:

- No client-side `.insert()` or `.update()` against `payment_intents`, `ledger_entries`, `payout_accounts`, `transfers`, or any status/transition field on a money-bearing row (orders, sessions, bookings, donations).
- State machine transitions on money-bearing entities are enforced by Postgres RPCs (`INVALID_TRANSITION` on violation), never by client logic setting a status field.
- Ledger writes happen only in edge functions running under the service role.
- Price shown client side is always re-validated server side at the point of charge (`PRICE_MISMATCH` preserved from v1). Never trust a client-supplied amount as final.
- Every screen showing a money total uses the shared `BillSummary` component. No hand-rolled price breakdowns.

This is enforced by the biased approver at every phase gate. A violation is always a blocking finding, no exceptions, no "just this once."

## Docs update duty

If your work changes scope, schema, an API contract, a state machine, or a design decision, you update the relevant doc in the same change, not as a follow up:

- Schema changes: `docs/architecture/SCHEMA.md`
- API contract changes: `docs/architecture/API-MAPPING.md`
- RLS policy changes: `docs/architecture/RLS.md`
- Payments flow changes: `docs/architecture/PAYMENTS.md`
- Video pipeline changes: `docs/architecture/VIDEO.md`
- Design token or component changes: `docs/design/DESIGN-LANGUAGE.md`
- Anything affecting the current phase's deliverables or scope: `docs/phases/PHASE-N-STATUS.md`

Phase-close agents specifically: you do not close a phase without writing handoff notes in `docs/phases/PHASE-N-STATUS.md` for the next phase's planner. This is the only memory the next phase has.

## Jira ticket transition duty

This repo tracks work in Jira project `ATL` (Kanban, 12 epics) via the Atlassian MCP. If you are a builder agent:

- Transition your ticket to In Progress when you start.
- Build strictly to the ticket's cited `PRD-0X FR-y`. Do not add adjacent scope.
- Transition to In Review when done, with a one-line implementation note (what changed, which files).

Phase-close agents reconcile the board against `PHASE-N-STATUS.md` at the end of every phase: every ticket tied to the phase should be Done; anything left open gets moved to the right epic or flagged to the founder.

## Every phase gate

Every phase ends with: integrator runs `pnpm turbo typecheck build lint` green, deploys preview URLs, captures light and dark screenshots, then the biased approver (`docs/agents/biased-approver.md`) reviews and returns APPROVE or REJECT. Maximum 2 fix cycles before escalating to the founder. See `docs/agents/workflows.md` for the full choreography.
