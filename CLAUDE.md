# ATLITOS v2 — Repo Instructions

This file is read by every agent working in this repo. It is not optional context; it is the entry point.

## Read first, every time

Before touching anything, read in this order:

1. `docs/qa/CURRENT-STATE.md` — what is already proven, what has been DISPROVEN, and what is open. Read this first and read it fully. It exists because five separate agents independently investigated the same bug and four reached wrong conclusions, each starting cold. Its DISPROVEN section is the most valuable part: it is the list of dead ends that have already been walked, so you do not walk them again. It also carries the environment traps that have each cost hours here, and the rule that has been earned eight times over: an environmental failure looks exactly like a product bug, so open the screenshot before you file anything.
2. `docs/PLAN.md` — the approved build plan. This is the contract. Do not deviate from it without a founder decision recorded in a phase status doc.
2. The relevant PRD(s) in `docs/prd/` for whatever surface you are touching (PRD-01 athlete, PRD-02 coach, PRD-03 court partner, PRD-04 admin, PRD-05 UPA life, PRD-06 sponsor, PRD-07 shopper). The PRD is the ceiling on scope, not a suggestion. If a feature is not traceable to a `PRD-0X FR-y`, it does not belong in this phase.
3. The current `docs/phases/PHASE-N-STATUS.md` for whatever phase is active. It tells you what is already done, what is in flight, and what handoff notes the previous phase left.
4. `docs/design/TASTE.md` and `docs/design/DESIGN-LANGUAGE.md` for anything touching UI.
5. `docs/BRANCHING.md` before you create a branch or merge one. Six rules. `main` is canonical, everyone branches from it, migrations take their number at merge time. Two histories that never met cost a day on 2026-09-14.
6. `docs/agents/workflows.md` if you are unsure what role you are playing in the current phase (planner, builder, integrator, biased approver, phase-close) or how to hand off to the next agent.

Agents are spun up fresh per phase and have no memory beyond what is written in this repo. If something is not written down here, it does not exist for the next agent. Write it down.

## House style (non-negotiable)

- **No emojis anywhere.** Not in UI copy, not in code comments, not in commit messages, not as icon substitutes. Use lucide icon names for iconography.
- **No em-dashes and no hyphens in user-visible copy strings.** Use commas and periods instead. Ordinary compound words in prose docs (this file, PRDs, architecture docs) are fine; the restriction is on copy strings that render in the product.
- **Concise, benefit-led microcopy.** Say what it does for the user, briefly. No filler.
- **lucide icon names only** wherever icons are referenced in code or docs. No other icon library, no custom glyphs standing in for a lucide equivalent.

## Scope every query by owner. RLS is not scoping.

This codebase has been bitten three separate times by the same shape, so it is a rule now, not advice: **Postgres RLS policies are permissive-OR.** A table with both an owner policy and a public policy (`venues`, and any table that gains a public browse policy later) returns OTHER PEOPLE'S ROWS to an unscoped `select`. RLS is a security floor, not a scoping mechanism.

Every read of such a table must carry its own explicit filter, typically `.eq("partner_user_id", user.id)` or the equivalent ownership join. That applies to app code, to seed scripts, and to test harnesses. The three incidents:

1. `0014` venue-media storage policies: an unqualified `name` inside a join bound to `venues.name`, denying every partner upload. Fixed in `0016`.
2. The portal-court venue picker, the FR-7 dashboard gate, and four onboarding queries: all showed or counted other partners' venues. Fixed across `55523e4` and `bb1b329`.
3. `scripts/verify-realtime.mjs`'s own isolation test: picked a venue owned by someone else, which would have made the cross-partner assertion pass vacuously. Fixed in AT-62.

Note the third one especially: a test written against an unscoped query does not fail, it passes for the wrong reason. When you write an isolation assertion, assert that the two parties' ids actually differ before trusting the result.

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

## No UI ships unproven. Screenshot plus Maestro, every time.

A UI change is NOT done when it typechecks, and NOT done when the diff looks right. It is done
when it has been SEEN on a real device and the flows still pass. Founder rule, 2026-08-14, and
it is not negotiable per task.

Every change touching a screen, a component, copy, a token or a layout requires BOTH:

1. **A screenshot from a Release build on a real device.** iPhone 16 Pro Max
   (`8AF6A5E2-F889-4477-8634-97B4AB5D5453`) and, for anything platform sensitive, Pixel_7_API_35.
   A Release build specifically: prove the bundle is embedded by checking `main.jsbundle` exists
   inside the `.app`. "No Metro running" is NOT proof, because `expo run:ios` starts its own.
2. **A Maestro run.** Per flow, pinned with `--udid`. NEVER `maestro test .maestro/` in directory
   form: it runs flows concurrently and will grab whichever device it likes, including a live
   Android emulator, which has already produced 15 of 15 false failures here.

Rules the pass itself must follow, each learned the hard way:

- **Screenshot the INTEGRATED tree, not a branch.** Three branches photographed separately prove
  three things that never ship together and miss every interaction between them.
- **Refuse to run above load 25.** This Mac reached 780 and produced a full sheet of fabricated
  failures that read exactly like product bugs. A delay is cheaper than a false finding.
- **Seed enough data to see the bug.** The comments sheet overflow was invisible because
  production has three comments across two clips. A capture of a short list proves nothing.
- **Before believing any failure, open the screenshot** and rule out a stale build, a wrong
  device, a redbox, and a system dialog holding accessibility focus. That has been the wrong
  answer nine times on this project.
- **Revert any debug shim and then CHECK `git diff` is empty.** A temporary shim that silently
  fails to revert is how a planted change ships.

If the device is held by another session, WAIT. Do not contend, and do not report a green you
could not take.

## Ten thousand users, not one thousand

The scale target is **10,000 users**, raised from 1,000 by the founder on 2026-08-14. Phase 3
hardened for 1,000 and its assumptions do not automatically survive a 10x. Anything that was
"fine at 1,000" needs re-deriving, not re-assuring: connection limits, the anon sign-in rate
limit, realtime fan-out, signed URL minting, unbounded queries, RLS hot paths, and per-request
work that is linear in users.

Performance is a correctness property here. A query that is fast on 200 rows and quadratic in
users is a bug, and it is one that only appears when it is too late.

## Every phase gate

Every phase ends with: integrator runs `pnpm turbo typecheck build lint` green, deploys preview URLs, captures light and dark screenshots, then the biased approver (`docs/agents/biased-approver.md`) reviews and returns APPROVE or REJECT. Maximum 2 fix cycles before escalating to the founder. See `docs/agents/workflows.md` for the full choreography.
