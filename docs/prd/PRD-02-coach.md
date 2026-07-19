# PRD-02: Coach

Coach role inside the consumer Atlitos app (Expo). Covers onboarding, admin verification, session lifecycle, roster, earnings and payouts, chat, and analytics. Session booking on the player side is defined in PRD-03 (Coaching/Sessions); this PRD owns everything the coach sees and does with a session once it exists, plus the wizard that makes a user a coach.

## 1. Purpose and stakeholder definition

**Purpose.** Let a verified coach list session types and pricing, publish availability, receive and manage session requests through a booking lifecycle identical in shape to court bookings, get paid through a ledger backed earnings wallet and a real Razorpay Route payout account, and see how their coaching business is doing.

**Stakeholders.**
- **Coach** (primary actor). A user who completed the coach onboarding wizard and is verified. Runs their coaching practice inside the app.
- **Athlete** (secondary actor, consumer of this surface). Books sessions, appears in the coach roster, chats with the coach. Athlete-side booking flow is PRD-03; this PRD only covers the coach's view of the same session objects.
- **Admin** (gatekeeper). Reviews coach verification requests (certificates, profile) in the Refine back office and approves or rejects. Owns the `verification_requests` queue.
- **Platform** (system actor). Enforces the session state machine via Postgres RPCs, writes ledger entries via edge functions on session completion, and owns the fee configuration.

## 2. Jobs to be done

- JTBD-1: As a coach candidate, I want to describe my sport, credentials, session offerings, and availability once, so I can start receiving session requests without back and forth.
- JTBD-2: As a coach, I want to know clearly whether I am verified, pending, or rejected, so I know when I can start being found and booked.
- JTBD-3: As a coach, I want to see incoming session requests and accept or decline them fast, so my calendar stays accurate and athletes are not left waiting.
- JTBD-4: As a coach, I want a single roster of everyone I have trained or am training, so I can track relationships over time.
- JTBD-5: As a coach, I want to manage a session's lifecycle (complete, cancel, reschedule) the same way I would a court booking, so the mental model is consistent across the app.
- JTBD-6: As a coach, I want to see my balance, pending payouts, and transaction history, and move money to my bank account, so coaching income is trustworthy and controllable.
- JTBD-7: As a coach, I want to message an athlete directly around a session, so logistics do not require leaving the app.
- JTBD-8: As a coach, I want basic performance numbers (sessions, hours, ratings, earnings trend), so I can see if my practice is growing.

## 3. Surfaces and screens

All screens live under the Trainings tab, coach role, in `apps/mobile`. Every screen ships loading (skeleton), empty, populated, and error states unless noted.

### 3.1 Onboarding wizard
**Screen: Coach Setup Wizard** (`/(onboarding)/coach-setup/[step]`)
Multi-step, `ProfileWizard` organism, `Stepper` shows progress. Steps: sport (single select, immutable after submit), profile photo, experience, coaching style, certificates (upload, multiple), session types and pricing (name, duration, price per type), availability windows (weekly recurring, day + time range, multiple windows per day), state, city, bio. Final step submits the full payload and shows a **Submitted for review** state, not a success state. No empty/error states in the usual sense; each step has field level validation and a submission error state (retry).

### 3.2 Verification status
**Screen: Verification Status** (reachable from Trainings tab before verification completes, and from Account > Profile after)
States: `pending_review` (submitted, awaiting admin), `verified` (full coach Trainings unlocked), `rejected` (reason shown, edit and resubmit CTA). No loading/empty variants beyond the three states plus a fetch error state.

### 3.3 Coach Trainings home (Stats)
**Screen: Coach Stats Dashboard** (`/trainings`, coach role)
`StatTile` grid (Players Coached, Avg Rating, Sessions This Month, Earnings This Month), Upcoming sessions (`SessionCard` variant upcoming), Session Requests (`SessionCard` variant request, Accept/Decline pair), Milestones. States: loading skeleton, empty (zero sessions ever, first-run copy plus a "complete your availability" nudge), populated, error.

### 3.4 Session Requests
Inline on Stats dashboard plus a dedicated **Requests** list when more than the dashboard preview count. Each request: athlete name/avatar, session type, proposed date and slot, focus area if provided, Accept and Decline actions. States: loading, empty ("No pending requests"), populated, error (action failed, retry).

### 3.5 Trainees / Roster
**Screen: Trainees list** (`/trainings/trainees`)
List of every athlete with at least one session with this coach (any status). Row: avatar, name, session count, last session date, status chip (active relationship vs no upcoming). States: loading, empty (no trainees yet), populated, error.

**Screen: Trainee detail** (`/trainings/trainee/[id]`)
Athlete summary, full session history with this coach (`SessionCard` variant history), quick actions: message, book follow up (deep links to PRD-03 booking flow pre-filled with this athlete... reversed: this is coach initiating is out of scope, see Section 8). States: loading, empty (no sessions somehow, edge case), populated, error.

### 3.6 Session detail (coach view)
**Screen: Session Detail** (`/trainings/session/[id]`, coach role)
Mirrors the Courts booking detail pattern exactly: session info, status pill, and status appropriate actions (Mark Complete once the session time has passed, Cancel, Reschedule). No Rate action for coach (only athlete rates). States: loading, the 4 lifecycle terminal displays (accepted, completed, cancelled, rescheduled), error.

### 3.7 Earnings
**Screen: Earnings** (`/trainings/earnings`)
`EarningsHeader` organism: balance, pending, this month, Send/Transfer action. Transaction list (`TransactionRow`) grouped by month, filterable by kind (session income, transfer out, adjustment). States: loading, empty (no earnings yet), populated, error.

**Screen: Payout Account Setup**
Razorpay Route linked account onboarding: bank details / KYC hand-off screen, status (`not_started`, `pending`, `active`, `needs_attention`). Transfer is disabled until `active`. States mirror the four Route account statuses plus a submission error state.

**Screen: Transfer / Payout**
Amount entry (up to available balance), `BillSummary` style confirmation (amount, any platform-side transfer fee, net), confirm, success, failure (with reason, e.g. Route account not active).

### 3.8 Chat
**Screen: Thread list** (`/trainings/chat`) and **Screen: Chat thread** (`/trainings/chat/[id]`)
Same components as athlete side (PRD-03 owns the chat organism); this PRD only asserts the coach entry points and that threads are scoped to athletes with a session relationship. States: loading, empty (no conversations), populated, error, plus a disconnected/reconnecting state for Realtime.

### 3.9 Analytics
**Screen: Coach Analytics** (`/trainings/analytics`, coach role)
v1 scope: token styled bar/line readouts (no chart library) of sessions per month, hours coached, earnings trend, rating trend. No AI narrative (that is `LLM_FUTURE`, see Section 8). States: loading, empty (insufficient data, minimum threshold copy), populated, error.

## 4. Functional requirements

Numbered for Jira story reference as `PRD-02 FR-n`.

**Onboarding**
- FR-1: A user with role `player` or no role can start the coach onboarding wizard from role select or from Account; a user who already has an active `verified` or `pending_review` coach profile cannot start a second one.
- FR-2: The wizard requires exactly one sport selection; sport is immutable once the verification request is submitted (matches v1 `422` on sport change rule).
- FR-3: The wizard requires at least one certificate upload before the session types step is reachable; certificate files are stored in Supabase Storage under a coach scoped path.
- FR-4: The wizard requires at least one session type with a name, duration in minutes, and a price greater than zero before submission is allowed.
- FR-5: The wizard requires at least one availability window (day of week plus start and end time) before submission is allowed; overlapping windows on the same day for the same coach are rejected client side with a specific error.
- FR-6: Submitting the final wizard step creates one row in `verification_requests` with status `pending_review` and writes the full coach profile payload (sport, photo, experience, style, certificates, session types, pricing, availability windows, state, city, bio) to the coach profile table in a single transaction; partial submissions are not possible.
- FR-7: While `pending_review`, the coach cannot receive session requests, does not appear in coach discovery/search, and sees the Verification Status screen instead of the Stats dashboard when opening Trainings.

**Verification lifecycle**
- FR-8: Admin approval in the Refine back office transitions the `verification_requests` row to `approved`, sets the coach profile to `verified`, and makes the coach immediately discoverable and bookable; no further coach action required.
- FR-9: Admin rejection transitions the row to `rejected` with a required reason string; the coach sees the reason and an edit and resubmit CTA that reopens the wizard prefilled with the previous payload.
- FR-10: Resubmission after rejection creates a new `verification_requests` row (history preserved, not overwritten) and returns the coach to `pending_review`.
- FR-11: Only an admin role, enforced by RLS, can transition a `verification_requests` row; no client path exists for a coach to self-approve.

**Session requests and lifecycle**
- FR-12: A verified coach sees all sessions in status `requested` addressed to them, ordered soonest first, via a query scoped by RLS to `coach_id = auth.uid()`.
- FR-13: Accepting a request calls the sessions state machine RPC transitioning `requested` to `accepted`; the RPC rejects the call with `INVALID_TRANSITION` if the session is not currently `requested` or the caller is not the assigned coach.
- FR-14: Declining a request calls the RPC transitioning `requested` to `declined`, with an optional reason field, freeing the slot for other athletes.
- FR-15: A coach can mark an `accepted` session `completed` only after the session's scheduled end time has passed (server enforced, not just client hidden); marking complete triggers the earnings ledger write (see Section 6).
- FR-16: A coach can cancel an `accepted` session before it starts; cancellation follows the same terminal state and copy pattern as court booking cancellation.
- FR-17: A coach can propose a reschedule (new date and slot) on an `accepted` session; the RPC re-checks slot availability and returns `SLOT_TAKEN` if conflicted, otherwise transitions to `rescheduled` and updates date/slot atomically.
- FR-18: Only the athlete can rate a `completed` session; the coach view never exposes a rate action (asymmetry from courts, which are self-rated by the booker only, is intentional and consistent).
- FR-19: The full session state machine is: `requested` to (`accepted` or `declined` or `cancelled`); `accepted` to (`completed` or `cancelled` or `rescheduled`); `completed` to `rated`. Any other transition attempt returns `INVALID_TRANSITION` from the RPC, never a client-only guard.

  **Amended 2026-07-19 (founder decision).** The original machine had no `requested` to `cancelled` edge, which stranded an athlete who booked and changed their mind: payment is captured at booking, so they were locked in until the coach happened to respond, with no self-serve exit. That is the first-experience failure most likely to cost trust, so the edge is now in scope. See FR-34 and FR-35 for who may take it and what happens to the money.

**Roster**
- FR-20: The Trainees list includes every athlete with at least one session row against this coach, regardless of session status, deduplicated by athlete.
- FR-21: Trainee detail shows full session history with that athlete, newest first, with status pills matching the session state machine.

**Availability and the slot engine**
- FR-22: Availability windows (day of week, start time, end time, effective from a given date) are the only input the custom slot engine uses to generate bookable slots for that coach; there is no separate "block a date" UI in v1 beyond declining or cancelling individual requests.
- FR-23: A coach can edit availability windows after verification; changes take effect for future slot generation only and never retroactively invalidate an already `accepted` session.
- FR-24: The slot engine enforces one booking per exact (coach_id, date, slot_start) via a database unique constraint; a race between two athletes booking the same slot is resolved by the constraint, not application logic, and the losing request receives `SLOT_TAKEN`.

**Earnings and payouts**
- FR-25: Every `completed` session writes a ledger entry crediting the coach's earnings balance for the session price minus the platform fee, computed server side by an edge function using the same fee config table as courts; the client never computes or writes the ledger amount.
- FR-26: The Earnings screen balance, pending, and this month figures are always derived by summing `ledger_entries`, never stored as a denormalized mutable balance the client can drift from.
- FR-27: A coach must have a Razorpay Route linked account in status `active` before the Transfer action is enabled; if not active, the Transfer button is disabled with an inline explanation and a link to Payout Account Setup.
- FR-28: Initiating a transfer calls an edge function that creates a Razorpay Route transfer, writes a `transfers` row and a corresponding debit `ledger_entries` row atomically, and never allows a transfer amount exceeding the current derived balance (server re-checks, not just client-side max).
- FR-29: Transfer failures (Route API error, account not active, insufficient balance at the moment of server check) surface a specific reason string on the Transfer screen and do not write any ledger row.

**Chat**
- FR-30: A chat thread between a coach and an athlete exists only if at least one session (any status) has ever existed between them; there is no cold-outreach chat in v1.
- FR-31: Messages are delivered via Supabase Realtime; the thread list and open thread both reflect new messages without a manual refresh.

**Analytics**
- FR-32: Coach Analytics computes sessions per month, hours coached, earnings trend, and average rating trend entirely from existing session, ledger, and rating rows; no new tracked metric is introduced.
- FR-33: If a coach has fewer than 3 completed sessions total, Analytics shows the empty/insufficient-data state instead of a populated chart with one or two data points.

**Cancelling an unanswered request (added 2026-07-19, see the FR-19 amendment)**
- FR-34: The athlete who booked a session may cancel it while it is still `requested`, before the coach has accepted or declined, without a reason and without coach involvement. The coach's request list simply stops showing it. A coach may not take this edge; a coach rejecting an unanswered request is `declined` (FR-14), which is a different thing and stays distinct in reporting.
- FR-35: Cancelling a `requested` session whose payment was captured refunds the athlete in full, automatically, with no admin step. The refund is issued server side by an edge function, writes a reversing `ledger_entries` group that returns the platform to a net zero position for that session, and is idempotent: a repeated cancel or a duplicate refund webhook never refunds twice. Full refund with no fee retained is deliberate, because the coach never accepted and no service was rendered, so there is nothing to split. If the refund call to the payment provider fails, the session still cancels and the refund is retried; the athlete is never left holding a `requested` session they have already cancelled, and the outstanding refund is visible to admin.

## 5. Data touched

Table names per PLAN.md schema domains (identity/roles, coaching, payments, moderation/audit, chat). Exact column names are defined at migration time; this section fixes read/write intent per domain.

| Domain | Table(s) | Coach app reads | Coach app writes |
|---|---|---|---|
| identity/roles | `user_roles` | own roles, role check for coach gating | role addition on wizard submit (via RPC, not direct write) |
| coaching | `coach_profiles` (sport, experience, style, bio, state, city) | own profile; public read of verified profiles for discovery (PRD-03) | own profile fields via wizard/edit, blocked once `pending_review` except through resubmission flow |
| coaching | `coach_certificates` | own certificates | insert on wizard, no client delete after submission |
| coaching | `session_types` (name, duration, price) | own types | create/update own types (price changes do not retroactively affect existing session price locks) |
| coaching | `coach_availability_windows` | own windows | create/update/delete own windows |
| coaching | `sessions` | sessions where `coach_id = auth.uid()` | status transitions only via RPC, never direct UPDATE |
| moderation/audit | `verification_requests` | own requests, own status | insert on wizard submit; no client update (admin/RPC only) |
| moderation/audit | `audit_log` | none (admin only) | none (system-written) |
| payments | `ledger_entries` | rows where `coach_id = auth.uid()`, read only, sum for balance | never written directly by client; edge function (service role) only |
| payments | `payout_accounts` | own Route account status | created/updated only via edge function (`razorpay-route-onboard`) |
| payments | `transfers` | own transfer history | created only via edge function (`razorpay-route-transfer`) |
| payments | `fee_config` | read only, to display fee transparency where relevant | none |
| chat | chat threads/messages (Realtime) | threads scoped to own sessions | send message (own thread only) |
| notifications | notifications | own notifications (session request, verification result, transfer status) | mark read |

## 6. Payment touchpoints

All money movement in this PRD goes through edge functions with server-side re-pricing/re-checking; no client ever writes a ledger row or a payout row directly. Money surfaces and their `BillSummary` usage:

- **Session completion payout accrual**: not a user-facing payment screen, but the edge function triggered by FR-15 (mark complete) is the money event; it is idempotent per session id.
- **Earnings screen**: shows balance/pending/this month, all derived from `ledger_entries`. Not a `BillSummary` itself (no transaction in progress) but every number is mono, tabular, ledger-sourced.
- **Transfer / Payout screen**: uses the `BillSummary` pattern (amount requested, platform transfer fee if any, net to bank), confirm, then calls `razorpay-route-transfer` edge function. This is the one screen in this PRD where `BillSummary` is mandatory per house rule.
- **Payout Account Setup**: no money moves here, only Route account onboarding (KYC hand-off); founder drives Razorpay credential steps in browser per PLAN.md P0/P3 hand-off note.

Coach earnings originate from athlete session payments (PRD-03 owns the athlete-side checkout and `BillSummary` at booking time); this PRD only owns the payout side.

## 7. Acceptance criteria per journey

**Journey A: Coach onboarding and verification**
1. A player-role user opens Coach Setup, completes all steps including at least one certificate, one session type with a price, and one availability window, and submits.
2. On submit, the app shows Verification Status in `pending_review`; the coach does not appear in coach search results (verified via a search query as a second account).
3. Admin approves in the back office; within one poll/Realtime update the coach's Verification Status becomes `verified` and Trainings shows the Stats dashboard.
4. Admin rejects with a reason on a second test coach; that coach sees the reason text and successfully resubmits, producing a second `verification_requests` row.

**Journey B: Session request lifecycle mirrors courts**
1. An athlete books a session with a verified coach (PRD-03 flow); the coach sees it under Session Requests in status `requested`.
2. Coach accepts; session moves to `accepted` and appears in Upcoming.
3. After the scheduled end time, coach marks it `completed`; a ledger entry appears on Earnings within the same session.
4. A second session is declined instead; it does not appear in Upcoming and the slot becomes bookable again by another athlete.
5. A third session is cancelled by the coach after acceptance; terminal state and copy match the Courts cancellation screen pattern exactly (verified by a side-by-side screenshot in the design review).
6. A fourth session is rescheduled; attempting to book the old slot fails, the new slot is reflected on both coach and athlete session detail.

**Journey C: Earnings and payout**
1. Coach with at least one completed session and zero prior transfers opens Earnings, sees a nonzero balance matching the sum of ledger credits minus any prior debits.
2. Coach without an active Route account sees Transfer disabled with a link to setup; completes Payout Account Setup test flow; status becomes `active`.
3. Coach initiates a transfer for an amount less than or equal to balance; sees `BillSummary` confirmation, confirms, sees success, and the transaction appears in the transaction list with balance reduced accordingly.
4. Coach attempts a transfer greater than balance; server rejects, no ledger row is written, balance is unchanged after refresh.

**Journey D: Roster and chat**
1. Coach with 3 sessions across 2 athletes opens Trainees; sees exactly 2 rows, correct session counts.
2. Coach opens a trainee detail; sees all sessions with that athlete regardless of status, newest first.
3. Coach opens chat with that athlete, sends a message; athlete's app (PRD-03 side) receives it without refresh.
4. Coach attempts to find a chat entry point for an athlete with zero shared sessions; no such entry point exists anywhere in the coach UI.

**Journey E: Analytics**
1. Coach with fewer than 3 completed sessions opens Analytics; sees the insufficient-data empty state, not a broken or misleading partial chart.
2. Coach with 5+ completed sessions across 3 months opens Analytics; sessions-per-month, hours, earnings trend, and rating trend all render and each number matches a manual sum from the underlying session and ledger rows.

## 8. Explicitly out of scope

- Coach-initiated session creation (coach proposing a slot directly to a specific athlete without an athlete-originated request) is not built; all sessions originate from athlete booking (PRD-03).
- Multiple sports per coach profile; v1 is single sport, matching v1 spec and PLAN.md wizard scope.
- Group or team sessions; every session is one coach, one athlete.
- Coach subscription tiers, paid promotion, or boosted search placement.
- AI generated coach insights, churn risk prediction, or schedule optimization narratives (flagged `LLM_FUTURE`, not built).
- Coach-side session type editing that retroactively changes the price of an already accepted or completed session; price is locked at booking time.
- In-app dispute or refund flows for coaching sessions, with ONE carve-out added 2026-07-19: the automatic full refund on cancelling an unanswered `requested` session (FR-35). That case is unambiguous, since the coach never accepted and no service was rendered, so it needs no judgement and therefore no dispute process. Every other refund situation (a cancelled `accepted` session, a no-show, a quality complaint) still has no in-app flow and is handled by admin out of app in v1, because those DO require judgement about who is owed what.
- Video call or in-app session delivery; sessions are logistics and payment coordination only, not a video conferencing surface.
- Coach identity/KYC verification beyond certificate upload and admin review; formal government ID KYC is a Razorpay Route onboarding concern (P3/P8 in PLAN.md), not a coach app screen this PRD builds beyond the hand-off point.
- Blocking specific calendar dates independent of declining/cancelling individual sessions (no standalone "day off" toggle in v1).
- Push notification content/delivery mechanics (owned by the notifications domain generally, referenced here only as a data touchpoint).

## 9. Open questions for the founder

1. Platform fee on coach sessions: same flat/percentage structure as courts, or a distinct `fee_config` row for coaching? PLAN.md implies a shared `fee_config` table but the rate itself is undecided.
2. Should a rejected coach's certificates and prior wizard answers be visible to the athlete-facing app at any point, or fully hidden until re-approval (current assumption: fully hidden)?
3. Minimum notice window for reschedule/cancel by the coach (v1 spec has no explicit cutoff); do we need a "cannot cancel within N hours of session start" rule for v1 or defer to P8 hardening?
4. Is a coach allowed to hold both a coach profile and remain bookable as a court partner, or are these mutually exclusive roles in v1 (affects `user_roles` design and this PRD's discoverability assumptions)?
5. Route transfer minimums/maximums and any transfer fee value: confirm before FR-28's `BillSummary` fee row is either shown or omitted at zero.
6. Analytics "insufficient data" threshold is assumed at 3 completed sessions; confirm or adjust.
