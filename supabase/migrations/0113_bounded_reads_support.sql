-- ATLITOS v2 — 0113_bounded_reads_support.sql
-- Domain: scale. The server side half of bounding the unbounded reads in
-- packages/api, per docs/qa/verify/SCALE-CLIENT.md and
-- docs/qa/verify/SCALE-DATABASE.md.
--
-- NOT APPLIED. Written against the read only production gate, so every plan
-- claim below is derived from catalog facts that WERE queried, and none of
-- these objects has been created or EXPLAINed on a live database. Plant each
-- one on a preview branch and re-run the plans before merging.
--
-- Numbering. The applied ceiling on syzzfgaudpifwvbpycyi is 0097, verified in
-- supabase_migrations.schema_migrations, while the repo carries files up to
-- 0106. 0113 is above every number this integration branch assigned, so it cannot collide with an already-taken number
-- and silently never run, which is the failure CURRENT-STATE.md records
-- against the 0088 family.
--
-- Every client that calls into this file degrades when the function is
-- absent, on purpose, because "absent" is the state of production today.
-- packages/api/src/use-chat.ts and use-empower.ts both check for PGRST202 and
-- fall back to a bounded PostgREST read. So applying this migration is an
-- improvement, not a prerequisite, and the app is never broken by the gap
-- between merge and apply.
--
-- ============================================================================
-- 1. chat_thread_previews: one row per thread, instead of every message in
--    every thread.
-- ============================================================================
--
-- listThreads rendered a one line preview per thread by fetching EVERY message
-- in EVERY thread the caller belongs to and keeping the newest per thread_id
-- in JavaScript. Measured at 262.3 bytes per row, a coach with 55 threads at
-- 300 messages each downloaded 16,500 rows and 4.33 MB to render 55 lines, a
-- 300x waste factor (SCALE-CLIENT.md P0-1).
--
-- distinct on (thread_id) ... order by thread_id, created_at desc is the exact
-- shape idx_chat_messages_thread_id (thread_id, created_at) was built for, and
-- that index is confirmed present in pg_indexes on the live project. The
-- result set is one row per requested thread, so the payload stops being a
-- function of message volume entirely.
--
-- SECURITY INVOKER, deliberately. This is a read of other people's messages if
-- it is got wrong, so it must NOT be security definer: as an invoker function
-- the chat_messages RLS policies (chat_messages_select_merged) are evaluated
-- for the caller exactly as they are on the direct PostgREST read this
-- replaces. A caller passing a thread id they are not a member of gets no
-- rows, which is the same answer the current code gets. The `set search_path`
-- is the house convention and costs inlining, which does not matter here: this
-- is one call per inbox open, not one per row.
--
-- The returned columns match the projection use-chat.ts already parses,
-- including the sender's display name from public_profiles rather than the
-- users base table (BUG-016: users is own-row-or-admin, so joining it would
-- name only the caller).

create or replace function public.chat_thread_previews(p_thread_ids uuid[])
returns table (
  thread_id uuid,
  sender_id uuid,
  text text,
  created_at timestamptz,
  removed_at timestamptz,
  sender_name text
)
language sql
stable
set search_path to 'public'
as $$
  select distinct on (m.thread_id)
    m.thread_id,
    m.sender_id,
    m.text,
    m.created_at,
    m.removed_at,
    p.name
  from public.chat_messages m
  left join public.public_profiles p on p.id = m.sender_id
  where m.thread_id = any(p_thread_ids)
  order by m.thread_id, m.created_at desc;
$$;

comment on function public.chat_thread_previews(uuid[]) is
  'Newest message per thread for the chat inbox preview line. Replaces the '
  'unbounded chat_messages read in use-chat.ts listThreads (SCALE-CLIENT.md '
  'P0-1). SECURITY INVOKER so chat_messages RLS still applies per caller.';

revoke all on function public.chat_thread_previews(uuid[]) from public;
revoke all on function public.chat_thread_previews(uuid[]) from anon;
grant execute on function public.chat_thread_previews(uuid[]) to authenticated;

-- ============================================================================
-- 2. upa_fund_balances: one call instead of one HTTP request per verified UPA.
-- ============================================================================
--
-- listUpas fired upa_fund_balance once per row through a bare Promise.all, so
-- N verified UPAs meant N simultaneous requests from a single phone against an
-- instance with max_connections = 60 (verified in pg_settings).
-- pg_stat_statements had that RPC at 975 calls, the most called on the
-- project, against 2 verified rows (SCALE-DATABASE.md P1-6).
--
-- The body is the singular function's body with the scalar predicate widened
-- to = any($1) and a group by. Read back from pg_get_functiondef on the live
-- project rather than retyped from memory, so the arithmetic is identical:
-- credits minus debits over ledger_entries, never a sum of funded_amount.
-- idx_ledger_entries_account (account_type, account_ref) is confirmed present,
-- so this is an index scan.
--
-- SECURITY DEFINER matches the singular function exactly. That is not a
-- widening: ledger_entries is admin-only to a normal caller, and the whole
-- point of both functions is to expose the aggregate without exposing the
-- rows, the same shape get_court_rating_summary uses for court_bookings. The
-- filter is pinned to account_type = 'upa_fund', so no other ledger account
-- type is reachable through it whatever refs are passed, and a UPA fund
-- balance is public information on the Empower hub by design (PRD-06 FR-1).

create or replace function public.upa_fund_balances(p_account_refs uuid[])
returns table (account_ref uuid, balance numeric)
language sql
stable security definer
set search_path to 'public'
as $$
  select l.account_ref,
         coalesce(sum(l.amount) filter (where l.direction = 'credit'), 0)
       - coalesce(sum(l.amount) filter (where l.direction = 'debit'), 0)
  from public.ledger_entries l
  where l.account_type = 'upa_fund'
    and l.account_ref = any(p_account_refs)
  group by l.account_ref;
$$;

comment on function public.upa_fund_balances(uuid[]) is
  'Batched form of upa_fund_balance. Replaces the per row RPC fan out in '
  'use-empower.ts listUpas (SCALE-DATABASE.md P1-6). Returns no row for a ref '
  'with no ledger activity; the caller defaults those to 0.';

revoke all on function public.upa_fund_balances(uuid[]) from public;
grant execute on function public.upa_fund_balances(uuid[]) to anon;
grant execute on function public.upa_fund_balances(uuid[]) to authenticated;

-- ============================================================================
-- 3. notifications: an index that covers the sort.
-- ============================================================================
--
-- Moved to 0114_notifications_covering_index.sql, 2026-08-14. This section's
-- own comment predicted the exact failure: "if the migration runner wraps
-- statements, split this into its own file before applying." Confirmed on
-- the first real `supabase start` this repo has ever run:
--   ERROR: CREATE INDEX CONCURRENTLY cannot be executed within a pipeline
--   (SQLSTATE 25001)
-- supabase's migration runner sends every statement in a file through one
-- pipelined batch, which CONCURRENTLY refuses regardless of an explicit
-- transaction block. See 0114 for the index itself and the same reasoning,
-- carried over unchanged.

-- ============================================================================
-- DELIBERATELY NOT IN THIS FILE
-- ============================================================================
--
-- A retention job for notifications. SCALE-DATABASE.md P1-5 correctly points
-- out the table has no retention and reaches 1,560,000 rows in year one, and
-- suggests a pg_cron job deleting read notifications older than 90 days next
-- to the existing expire-stale-holds. That is a product decision about user
-- visible data loss, not a scale fix, and it deletes production rows. It needs
-- a founder decision recorded in a phase status doc before anyone writes it.
-- The client side .limit() removes the query cost; it does not remove the
-- storage growth, and this file does not pretend otherwise.
--
-- The RLS policy reorderings (court_bookings_select_merged and
-- sessions_select_merged, both written expensive-first so a non-inlinable
-- function runs before the cheap owner test). Those are a security surface,
-- they need their own plant-and-EXPLAIN pass with the RLS matrix re-verified
-- afterwards, and rewriting a policy in the same migration as three unrelated
-- objects is how a policy change ships unreviewed. The owner filter added to
-- listMyBookings in this same change already converts that read from a Seq
-- Scan to an Index Scan, which is the part that changes the scaling.
