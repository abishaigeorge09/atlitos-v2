-- ATLITOS v2 — 0114_notifications_covering_index.sql
-- Domain: scale. Split out of 0113_bounded_reads_support.sql, 2026-08-14.
--
-- notifications: an index that covers the sort.
--
-- use-notifications.ts list() reads `user_id = me order by created_at desc`.
-- pg_indexes shows exactly two indexes on the table, notifications_pkey and
-- idx_notifications_user_id_read_at (user_id, read_at). The second serves the
-- filter and the unread badge correctly, but it does not cover created_at, so
-- the ordering is always a separate Sort node over the whole of that user's
-- history. Proven rather than assumed: with enable_seqscan = off the plan is
-- Index Scan using idx_notifications_user_id_read_at, and the Sort node is
-- still above it (SCALE-DATABASE.md P1-5).
--
-- With the .limit(50) that now exists client side, this turns the read into a
-- bounded index walk with no sort at all. Without the limit the index alone
-- buys little, which is why the two halves shipped together.
--
-- CONCURRENTLY, so it cannot take a write lock on a table that takes an insert
-- on every notification-producing event. That means this statement cannot run
-- inside a transaction block, and it must be the ONLY statement in its file:
-- 0113 originally carried this alongside two `create or replace function`
-- statements, and `supabase start`'s first real run on this repo failed with
-- "ERROR: CREATE INDEX CONCURRENTLY cannot be executed within a pipeline
-- (SQLSTATE 25001)" because supabase's migration runner batches every
-- statement in one file through a single pipeline regardless of an explicit
-- transaction block. This file exists to be that one statement, alone.
--
-- Keep idx_notifications_user_id_read_at. It is the covering index for the
-- unread badge count (user_id + read_at is null) and that half is already
-- correct.

create index concurrently if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);

comment on index public.idx_notifications_user_created is
  'Serves use-notifications.ts list(): user_id = me order by created_at desc. '
  'Removes the Sort node the (user_id, read_at) index leaves behind.';
