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

## What this script did not test

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
