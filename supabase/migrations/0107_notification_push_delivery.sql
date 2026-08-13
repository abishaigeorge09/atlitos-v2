-- ATLITOS v2 — 0107_notification_push_delivery.sql
-- Domain: notifications, push delivery. Closes SCALE-REALTIME R-7: no
-- session, membership or group notification has ever produced a device push.
--
-- NOT APPLIED. This file is written, not run. Production
-- (syzzfgaudpifwvbpycyi) is read only for this track.
--
-- ============================================================================
-- THE GAP, restated with the evidence.
-- ============================================================================
--
-- `grep -rn "notify-dispatch\|dispatchNotification" supabase packages` returns
-- exactly one caller outside the definition itself:
-- supabase/functions/_shared/finalize-court-booking-payment.ts:157. Every
-- other notification in the product is written by SQL straight into
-- public.notifications: moderate_clip (0043), record_donation_from_draft
-- (0054), the verification RPCs (0066), notify_session_parties (0103) and
-- sweep_group_memberships (0104). None of those reach _shared/notify.ts, so
-- none of them attempt the device leg.
--
-- 0103's own header records why it wrote the row in SQL, and the reasoning was
-- correct AT THE TIME: notify.ts's push leg was still the P9 stub, so routing
-- through it would have bought nothing and cost a service-role HTTP hop from
-- inside a session transaction. That premise expired. The Expo transport in
-- notify.ts is fully implemented. What is missing is only the relay.
--
-- ============================================================================
-- DECISION: a sweeper, not a database webhook. Chosen deliberately.
-- ============================================================================
--
-- Option A, database webhook. An `after insert for each row` trigger on
-- public.notifications calling the edge function over pg_net (which is what
-- Supabase's Database Webhooks feature is: supabase_functions.http_request is
-- a pg_net wrapper). Rejected on four counts:
--
--   1. PER ROW. A group session writes one row per roster member, so a group
--      of 50 fires 50 HTTP requests carrying one recipient each. That is
--      exactly the shape SCALE-REALTIME R-6 exists to remove, reintroduced one
--      layer up. There is no batch dimension available to a row trigger.
--   2. FIRE AND FORGET. pg_net is async and its response lands in
--      net._http_response. A 500 from the function, a timeout, or an Expo
--      outage leaves NO mark on the notification row. Nothing knows the push
--      was missed, so nothing can retry it. Delivery becomes at-most-once
--      with no evidence either way.
--   3. IT RIDES A MONEY PATH. notify_session_parties runs inside
--      session_transition_internal's transaction, which is the transaction
--      that moves a session's status. Adding a net.http_post there ties a
--      state transition on a money-bearing entity to an outbound queue.
--      CLAUDE.md's financial invariant is about who writes money rows, and
--      this is the same instinct: the transition must not acquire new failure
--      modes belonging to a push provider.
--   4. NO BACKFILL STORY. A webhook only ever sees rows inserted after it is
--      installed. Rows written during any window where the function is down
--      are lost silently.
--
-- Option B, a sweeper. A pg_cron job every 30 seconds claims rows where
-- `pushed_at is null` and hands them to notify-push-sweep, which groups them
-- by content and pushes. Chosen, because every one of the four objections
-- inverts:
--
--   1. BATCHING FOR FREE. Rows are claimed in bulk, and a group session's
--      roster shares one title, body and deep link, so the whole roster
--      collapses into ONE Expo request of up to 100 tokens. The batch
--      dimension is recipients, which is Expo's actual batch dimension.
--   2. IDEMPOTENT, AND RESUMABLE. `pushed_at` is a checkpoint written only
--      after the push leg is finished with a row. A row that failed keeps a
--      null `pushed_at` and comes back on a later run. A crashed invocation
--      loses nothing: its claim goes stale and the rows return. Delivery is
--      at-least-once with a bounded duplicate window, which is the correct
--      trade for a push (a duplicate notification is a nuisance, a missing one
--      is the feature not existing).
--   3. OFF THE TRANSACTION. Nothing about a session transition changes. 0103
--      and 0104 are not edited by this migration at all.
--   4. BACKFILLABLE. Anything with a null `pushed_at` is a candidate, whenever
--      it was written, so a gap is drained rather than lost. That is also why
--      this migration stamps every PRE-EXISTING row as already pushed: see the
--      backfill at the bottom, and note that skipping it would blast every
--      historical notification to every device on the first run.
--
-- The cost of B over A is up to 30 seconds of latency. For "your coach started
-- your session" and a 03:30 membership reminder that is not a product
-- difference. For a genuinely instant path, an edge function can still call
-- dispatchNotificationFanout inline; those rows insert with `push_claimed_at`
-- already set, so the sweeper does not touch them.
--
-- ============================================================================
-- 1. Delivery state on the notification row.
-- ============================================================================

alter table public.notifications
  add column if not exists pushed_at timestamptz,
  add column if not exists push_claimed_at timestamptz,
  add column if not exists push_attempts int not null default 0;

comment on column public.notifications.pushed_at is
  'R-7 checkpoint. Non null once the device-push leg is finished with this row (delivered, opted out, no live device, or too old to be worth sending). Null means the sweeper still owes this row an attempt. Never set by a client: notifications grants no authenticated INSERT and the UPDATE policy is column locked below.';

comment on column public.notifications.push_claimed_at is
  'When the current push attempt took this row. Guards against two overlapping sweeps sending the same push twice; a claim older than the stale window is reclaimable, which is what makes a crashed invocation recover.';

comment on column public.notifications.push_attempts is
  'How many times the push leg has taken this row. Caps a permanently failing row so it cannot be retried forever.';

-- The sweeper's working set is "unpushed, oldest first". A partial index means
-- the index holds only the backlog (normally a handful of rows) rather than
-- every notification ever written, so it stays tiny as the table grows to the
-- 2.45M rows a year SCALE-REALTIME derives.
create index if not exists idx_notifications_push_pending
  on public.notifications (created_at)
  where pushed_at is null;

-- ============================================================================
-- 2. Claim: the whole idempotency story, in one statement.
-- ============================================================================
--
-- FOR UPDATE SKIP LOCKED is what lets two invocations run at once without ever
-- claiming the same row: the second skips what the first has locked instead of
-- blocking on it. Combined with the `push_claimed_at` window it gives:
--
--   * no double send while an attempt is in flight (claim is set before the
--     HTTP call and respected by every other claimer);
--   * no lost tail if an attempt dies (the claim ages out and the row
--     returns);
--   * no infinite retry of a poisoned row (push_attempts cap).
--
-- Returned as a set so the edge function can group by content before sending.

create or replace function public.claim_notification_push_batch(
  p_limit int default 500,
  p_max_attempts int default 5,
  p_stale_claim interval default interval '5 minutes'
)
returns table (
  id uuid,
  user_id uuid,
  type public.notification_type,
  title text,
  body text,
  deep_link text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.notifications n
     set push_claimed_at = now(),
         push_attempts = n.push_attempts + 1
   where n.id in (
     select c.id
       from public.notifications c
      where c.pushed_at is null
        and c.push_attempts < p_max_attempts
        and (c.push_claimed_at is null or c.push_claimed_at < now() - p_stale_claim)
      order by c.created_at
      for update skip locked
      limit greatest(p_limit, 1)
   )
  returning n.id, n.user_id, n.type, n.title, n.body, n.deep_link, n.created_at;
end;
$$;

revoke all on function public.claim_notification_push_batch(int, int, interval) from public;
revoke execute on function public.claim_notification_push_batch(int, int, interval)
  from anon, authenticated;
grant execute on function public.claim_notification_push_batch(int, int, interval) to service_role;

comment on function public.claim_notification_push_batch(int, int, interval) is
  'R-7. Claims a batch of notifications owed a device push, skipping rows another sweep already holds. Service role only: it returns other users notification bodies.';

-- ============================================================================
-- 3. A client must not be able to forge delivery state.
-- ============================================================================
--
-- 0002 gives the owner an UPDATE policy so the bell can mark a notification
-- read. That policy is row scoped, not column scoped, so without this trigger
-- an authenticated user could PATCH their own row's `pushed_at` and silently
-- cancel their own pushes, or reset it and make the sweeper resend. Neither is
-- a security hole with teeth, but "the client cannot write delivery state" is
-- the same rule as "the client cannot write money state" and costs one
-- trigger.

create or replace function public.notifications_lock_push_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('role', true) = 'service_role' or session_user = 'postgres' then
    return new;
  end if;
  new.pushed_at := old.pushed_at;
  new.push_claimed_at := old.push_claimed_at;
  new.push_attempts := old.push_attempts;
  return new;
end;
$$;

drop trigger if exists notifications_lock_push_state on public.notifications;
create trigger notifications_lock_push_state
  before update on public.notifications
  for each row
  execute function public.notifications_lock_push_state();

comment on function public.notifications_lock_push_state() is
  'Keeps push delivery state (pushed_at, push_claimed_at, push_attempts) writable only by the service role, the way 0065 locks users.status. An owner UPDATE from the bell screen carries the old values through untouched.';

-- ============================================================================
-- 4. Backfill. Read this before running the migration anywhere.
-- ============================================================================
--
-- Every notification that already exists predates the push relay and must
-- NEVER be pushed. Production holds 63 rows today; on a tree where 0102 to
-- 0106 have been applied for a while it could be thousands. Without this
-- statement the first sweep would deliver all of them at once, which is both
-- a support incident and, at 10,000 users, an Expo rate-limit event.
--
-- This is deliberately the LAST statement in the file: if anything above
-- fails, the migration aborts before the backlog is defined.

update public.notifications
   set pushed_at = now()
 where pushed_at is null;
