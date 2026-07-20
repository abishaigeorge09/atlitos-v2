# AT-59 evidence: Realtime instant push, proven with a script

Closes advisory AT-32 (Phase 2: "Realtime push at the moment of payment
capture is still unproven; the booking was demonstrated as rendered state a
day after capture.").

Script: `scripts/verify-realtime.mjs`. Run with:

```
SUPABASE_ANON_KEY=<NEXT_PUBLIC_SUPABASE_ANON_KEY from apps/portal-court/.env.local> node scripts/verify-realtime.mjs
```

No service role key used anywhere in the script: every sign-in, insert, and
subscription is a real authenticated session doing exactly what the product
does.

## What was subscribed to

The exact call in `packages/api/src/use-chat.ts`'s `subscribeToThread`:

```js
client
  .channel(`chat:${threadId}`)
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${threadId}` },
    onInsert,
  )
  .subscribe();
```

and the unfiltered `subscribeToInbox` shape (same table, no filter), used
here only as an RLS-scoping probe, not for the latency measurement.

## Fixture setup this run required

No session existed yet between `player@atlitos.dev` and `coach1@atlitos.dev`
in this project (`session_exists_between` returned `false`), and a chat
thread requires one (0022_chat.sql's `chat_threads_insert_participant`
policy). Rather than fabricate a session row, the script called the real
`book-session` edge function as `player@atlitos.dev` against coach1's real
`Batting Basics` session_type, which inserts the `sessions` row as
`requested` before any Razorpay payment happens (see
`supabase/functions/book-session/index.ts`, step 3 of its own header
comment). `session_links_pair`/`session_exists_between` both accept a
session in any status, so payment capture was never needed to satisfy the
chat thread's insert policy. Session id `ae9f0a03-3481-412d-9cd7-d72e6c5fb359`,
thread id `59ae2fd4-86ff-4e96-83ba-7718901c4ec9`. Both are real rows created
through the product's own RPCs/edge functions, left in place; the script is
idempotent and reuses them on every subsequent run.

## Result: chat_messages push, measured

Two independent trials, same thread, same channel:

```
--- Part 1: A subscribes to chat:<threadId>, B sends, measure latency ---
[verify-realtime] A subscribed (SUBSCRIBED), channel chat:59ae2fd4-86ff-4e96-83ba-7718901c4ec9
[verify-realtime] B inserted message 4a85a948-dda4-41f1-9623-56e0fbaf8246 at t=0
[verify-realtime] A received postgres_changes INSERT for message 4a85a948-dda4-41f1-9623-56e0fbaf8246 after 473.2 ms

--- Part 2: second trial for a corroborating latency sample ---
[verify-realtime] A received trial 2 message 4006dc4f-6002-432a-aaae-344579cc8d6a after 581.9 ms
```

**Verdict: Realtime instant push is PROVEN for chat.** User A's socket
observed the `postgres_changes` INSERT event within roughly half a second of
user B's insert, on the exact channel/filter shape the app uses, with no
poll and no page refresh in between. This is the first time in this
project's history that an instant push (not "rendered state observed
later") has actually been watched happen.

An early run of this script clocked trial 1 as a timeout while trial 2 (same
process, same channel, 30 seconds later) succeeded at 364ms; the cause was a
startup race, `SUBSCRIBED` fires once the client socket has joined the
channel but the walsender side can take slightly longer to start flowing
events on a brand new channel. The script now waits 2 seconds after
`SUBSCRIBED` before sending, which removed the flake (see the comment above
`await wait(2000)` in the script); a real Realtime outage still shows up as
both trials timing out at the 10 second deadline, so this settle time does
not mask a genuine failure, it only removes a startup artifact.

## Result: RLS scoping (the more important assertion)

User C (`coach2@atlitos.dev`), who is not a participant in A/B's thread,
subscribed two ways at the same time as A:

1. The same channel name, `chat:<A/B's threadId>`, guessed.
2. The unfiltered `chat:inbox` shape (every INSERT on `chat_messages`, no
   filter), which per 0022_chat.sql's own header comment is safe only
   because "RLS already scopes the stream to threads this user participates
   in."

```
RLS isolation (same channel name, non-participant C): PASS, 0 events leaked
RLS isolation (unfiltered chat:inbox, non-participant C): PASS, 0 events leaked
```

**Verdict: RLS isolation holds.** C's sockets received zero events from
A/B's exchange on both probes, across both trials (two messages sent, zero
received by C). This is the assertion that mattered most for this story;
Realtime silently ignoring RLS would have been a live data leak across the
whole chat feature, not just a latency inconvenience. It did not happen.

## Result: is `court_bookings` in the Realtime publication?

Queried directly against the live project via the Supabase MCP
(`execute_sql`, project `syzzfgaudpifwvbpycyi`):

```sql
select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1,2;
```

```json
[{"schemaname":"public","tablename":"chat_messages"}]
```

**`court_bookings` is NOT in the `supabase_realtime` publication. Only
`chat_messages` is.** `supabase/migrations/0009_courts.sql` (the P2-era
migration that creates `court_bookings`) never adds it to the publication,
and no later migration does either; `0022_chat.sql` is the only migration in
this repo that touches `supabase_realtime` at all.

This is the real, mechanical explanation for AT-32: P2 never observed an
instant push on the partner Live Today board because **there was no publish
side to push from.** Nothing was ever subscribed to a socket that could
receive events for `court_bookings`, because Postgres was never told to
replicate that table's changes into the publication in the first place. It
was not a client bug, a timing flake, or a network issue; the wiring simply
does not exist yet. `docs/architecture/SCHEMA.md` line 732 correctly scopes
Realtime to `chat_messages` only and never claims it for `court_bookings`,
so this is not a documentation contradiction either, just a P2 claim ("we
have Realtime on the Live Today board") that was never true and was never
caught before now.

**What migration would fix it** (not written here, per this story's scope:
verification proves, it does not build): a new migration adding, guarded the
same way `0022_chat.sql` guards `chat_messages`:

```sql
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'court_bookings'
  ) then
    alter publication supabase_realtime add table public.court_bookings;
  end if;
end
$$;
```

plus an RLS review of `court_bookings_select` (0009_courts.sql) before
shipping a client subscription against it: today's policy scopes reads to
the booking's own athlete or the venue's partner/staff, which is probably
the right shape for who should receive the live stream too (the partner's
Live Today board, not a broadcast to every athlete), but that has not been
verified against Realtime's per-subscriber policy evaluation the way this
story just verified it for chat. Whoever picks up that migration should
re-run a version of `scripts/verify-realtime.mjs` against `court_bookings`
once it exists, the same way this script proved it for chat, rather than
assuming the RLS policy behaves the same way under Realtime's evaluation
that it does under PostgREST's.

---

# AT-62 update: the gap above is now fixed and proven

Everything above is AT-59's record and is left intact as the diagnosis. This
section is AT-62, which built the fix.

Migration: `supabase/migrations/0029_realtime_courts_sessions.sql` (0028 was
left free for a concurrent AT-43 agent). Applied to the remote project via the
Supabase MCP and committed as a file. It publishes `public.court_bookings` and
`public.sessions`, guarded per table with the same `pg_publication_tables`
existence check `0022_chat.sql` uses, so re-running is a no-op.

```sql
select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1,2;
```

```json
[{"schemaname":"public","tablename":"chat_messages"},
 {"schemaname":"public","tablename":"court_bookings"},
 {"schemaname":"public","tablename":"sessions"}]
```

## RLS review, done before publishing

Both tables' `SELECT` policies were reviewed first, on the principle that
publishing a leaky table converts a query bug into a live broadcast. **Both
passed and were left unchanged**; the full reasoning is in `0029`'s header and
in `docs/architecture/RLS.md`. In short: every non-admin disjunct in both
policies is anchored to the row's own owner (`v.partner_user_id = auth.uid()`,
an accepted `venue_staff` membership, `user_id`/`coach_id`/`player_id` =
`auth.uid()`), the admin disjuncts widen by role rather than by row, and
neither table carries a public discovery policy that could combine with the
owner policy the way the P2 venue-picker bug did.

**One real gap was found and fixed in the same migration**, though not in a
`SELECT` policy: `court_bookings` never had the grant-level
`revoke insert, update, delete ... from anon, authenticated` that `0019` gives
`sessions`. It was inert (no write policy exists, so RLS denied writes anyway)
but it is the missing second layer on a money-bearing table, and it matters
more once the table is published, because a stray client write on a published
table fans out to every subscribed partner socket. `0029` adds it.

## REPLICA IDENTITY decision: DEFAULT, deliberately

Both tables are left at `REPLICA IDENTITY DEFAULT`. The reasoning turns on the
fact that the Live Today board's two headline behaviours, check ins and
cancellations, are **UPDATEs, not INSERTs and not DELETEs**
(`court_booking_check_in` sets `checked_in_at`; `court_booking_transition` sets
`status = 'cancelled'`). Under DEFAULT, an UPDATE still ships the complete new
tuple, so both the client's `court_id=in.(...)` filter and the policy's
`is_court_partner_or_staff(court_id)` check evaluate against real values.

`FULL` was considered and rejected: it buys a populated `old_record` (the board
refetches through `venue_bookings_today` and never reads `payload.old`) and
RLS-checkable DELETE events (there is no hard-delete path, and after 0029 not
even a DELETE grant), while writing every column of every old row into the WAL,
including `subtotal`/`gst`/`platform_fee`/`total` and walk-in PII. Cost with no
benefit. If a hard delete is ever introduced, revisit this: DELETE events on a
DEFAULT-identity table carry only the primary key, cannot be RLS-checked, and
are silently dropped, which is the safe direction to fail but easy to
misdiagnose as another dead publication.

This decision is verified rather than argued: the UPDATE half of Part 3 exists
to prove it.

## Results, measured against the live project

`scripts/verify-realtime.mjs` was **extended**, not replaced or duplicated.
Parts 3 and 4 are new. Every write goes through a real product path
(`book-court` walk-in variant, `court_booking_check_in`, `session_transition`)
under a real user's JWT. There are no raw inserts and no service-role writes
anywhere in the file, so nothing needed to be rolled back.

```
--- Part 3 (AT-62): court_bookings INSERT + UPDATE push, and cross partner isolation ---
partner A = partner@atlitos.dev, venue "Onboarding Demo Turf" (579899a2-...), 1 active court
partner B = p2-verify-partner@atlitos.dev, venue "Gachibowli Box Cricket Turf" (a0000000-...)
A subscribed to live-today-579899a2-... (event "*", filter court_id=in.(...))
A received postgres_changes INSERT for booking 1bef55c0-... after 1688.3 ms
A checked in booking 1bef55c0-... via court_booking_check_in (an UPDATE, not an INSERT)
A received postgres_changes UPDATE after 527.8 ms; payload.new.checked_in_at = 2026-07-20T06:04:09Z

cross partner isolation, targeted probe (B on A's exact channel+filter): 0 events (expected 0)
cross partner isolation, unfiltered probe (B, project wide):             0 events (expected 0)

--- Part 4 (AT-62): sessions UPDATE push (coach), and non party isolation ---
session ae9f0a03-... is 'requested', driving session_transition action 'accept'
coach1 received postgres_changes UPDATE after 737.5 ms
non party isolation (sessions, unfiltered): 0 events (expected 0)
```

A second run reported INSERT 1567.9 ms, UPDATE 421.3 ms, all isolation probes
0, and exit code 0.

**On the INSERT number:** 1688 ms is measured from before the `book-court`
invocation, so it includes the entire edge function round trip (re-pricing, the
booking insert, the synthetic payment intent, and the three-leg ledger write),
not just Realtime propagation. It is the honest end-to-end number a partner
experiences after confirming a walk in. The UPDATE figure, 421 to 528 ms
through a single fast RPC, is the cleaner measure of Realtime propagation
itself, and it lines up with chat's 500 to 620 ms.

**Verdict: PRD-03 FR-15 is now true.** The Live Today board's
`realtimeConnected` indicator no longer reports a connection to a stream that
cannot deliver, and the three copy strings claiming real time updates
(`page.tsx` twice, `live-today/page.tsx` once) are now accurate rather than
false.

**Verdict: cross-partner isolation holds.** This was the security-critical
assertion. Partner B actively targeted partner A's exact channel name and
`court_id` filter, and separately subscribed to every `court_bookings` change
project-wide, and received nothing from either. `court_bookings` carries money
columns and walk-in PII, so a scoping defect here would have been a live
cross-tenant broadcast rather than a query bug.

This was worth proving for courts rather than generalising from AT-59's chat
result: `chat_messages`' policies use only `auth.uid()`, whereas
`court_bookings_select` depends on `has_role('court_partner')`, which reads
`app_metadata.roles` out of the JWT. Realtime evaluates policies in its own
connection context, and a `has_role()` that returned false there would have
failed closed, delivering nothing to the legitimate partner and looking exactly
like another dead publication. Part 3 rules that out in both directions: the
owning partner does receive, and the other partner does not.

## A harness bug worth recording

The first run of Part 3 failed, and the cause is the P2 venue-picker defect
reproduced exactly. `findPartnerVenue` initially read
`from("venues").eq("status","verified")` without an owner filter, and handed
partner A a venue owned by partner B, because `venues` carries a public
"verified venues are readable by anyone" `SELECT` policy alongside the owner
policy and policies combine with OR. That made the cross-partner assertion
vacuous (both partners pointed at one venue) and made `book-court` fail its own
ownership check, which is the only reason it was caught.

RLS.md's durable lesson restated, and it caught out this script the same way it
caught out the P2 UI: **RLS on `venues` is an authorization ceiling, not
scoping.** Every query carries its own owner filter. The fix is
`.eq("partner_user_id", partnerUserId)`, and the script now also asserts
outright that A's and B's venue ids differ, so this failure mode can never
again degrade silently into a passing but meaningless isolation result.

## What AT-62 still did not test

- Payment capture's own Realtime push (AT-32's literal wording) still is not
  directly exercised: `payment_intents` remains unpublished, and deliberately
  so, nothing subscribes to it. What P2 actually wanted from that phrase, the
  partner board reacting the instant a booking appears, is now proven above.
- The `court_bookings` DELETE path is untested because there is none, by
  design. See the replica identity section for what to re-verify if that
  changes.
- No mobile client subscribes to `sessions` yet; Part 4 proves the publish side
  and RLS scoping are ready for PRD-02 FR-12, not that any shipped UI consumes
  it.

---

## What this script did not test (AT-59's original list)

- Session status transitions (`sessions.status` changing on completion,
  cancellation, etc.) are not on any Realtime publication either (same
  publication query above; only `chat_messages` is listed), so an instant
  push for session lifecycle events was not testable and was not claimed.
  AT-59's brief mentions "chat messages and session transitions"; the
  session-transitions half is a second, separate gap from the
  court_bookings one above, not yet closed.
- Payment capture's own Realtime push (the literal AT-32 wording, "at the
  moment of payment capture") was not re-tested here for the same reason:
  `payment_intents` and `court_bookings` are both outside the publication,
  so there is nothing to subscribe to yet. The chat proof above is the one
  domain in this codebase where an instant-push claim could actually be
  exercised end to end today.
