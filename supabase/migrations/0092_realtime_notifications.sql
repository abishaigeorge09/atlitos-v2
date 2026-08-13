-- ATLITOS v2 — 0092_realtime_notifications.sql
-- Domain: notifications, Realtime. The answer to B1's realtime question, and
-- it is not the table B1 asked about.
--
-- ============================================================================
-- THE QUESTION: is public.sessions realtime worth wiring?
-- ============================================================================
--
-- public.sessions has been in the supabase_realtime publication since 0029,
-- which added it opportunistically and said so in its own header: "No UI
-- claims realtime for it yet". Nothing subscribes to it to this day. The only
-- postgres_changes subscriptions in the product are the court partner Live
-- Today board (court_bookings), chat (chat_messages), and
-- useNotifications().subscribe.
--
-- DECISION: do NOT wire a sessions subscription. Reasons, in order of weight:
--
--   1. IT WOULD BE A SECOND EVENT BUS FOR THE SAME EVENT. After 0089 every
--      accept, decline, start and complete already writes a notifications row
--      in the same transaction as the status change. A sessions subscription
--      would deliver the identical four events on a different socket, so every
--      screen would need its own channel, its own filter and its own dedupe
--      against the notification that also arrived. One stream carrying every
--      domain beats one stream per table.
--   2. A SESSIONS FILTER CANNOT EXPRESS THE AUDIENCE. postgres_changes filters
--      are one column, one operator. An athlete's sessions are player_id = me,
--      a coach's are coach_id = me, and a GROUP session is neither (player_id
--      is null; membership is a session_participants row). A useful sessions
--      subscription is therefore two or three channels per user, and still
--      misses group sessions entirely.
--   3. PUSH PLUS REFRESH IS THE RIGHT FLOOR ANYWAY. The screens that show
--      session state already pull on focus and pull to refresh. Realtime on
--      top of that is a nicety; a notification the athlete never receives is a
--      product failure. B1 is the failure. Fix the failure first.
--
-- ============================================================================
-- WHAT IS ACTUALLY BROKEN: public.notifications is subscribed and unpublished.
-- ============================================================================
--
-- apps/mobile/src/app/notifications/index.tsx line 87 calls
-- useNotifications().subscribe, which opens a postgres_changes INSERT
-- subscription on public.notifications filtered by user_id
-- (packages/api/src/use-notifications.ts). public.notifications is NOT in the
-- supabase_realtime publication and never has been. Verified read only against
-- production (syzzfgaudpifwvbpycyi) on 2026-08-13:
--
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and schemaname = 'public';
--     -> chat_messages, court_bookings, sessions
--
-- This is exactly the bug 0029 found for court_bookings: the socket reaches
-- SUBSCRIBED, the code looks live, and no event is ever delivered because
-- there is no publish side. It is why the bell badge only ever updates on a
-- manual refresh, and it would have silently swallowed every notification
-- 0089 and 0090 now emit.
--
-- ============================================================================
-- RLS REVIEW BEFORE PUBLISHING. Realtime evaluates the table's SELECT policy
-- per subscriber before delivering a row (0029 proved this empirically against
-- a live socket), so publishing a leaky table broadcasts the leak.
--
-- public.notifications policies (0002_notifications.sql):
--   notifications_select_own  USING (user_id = auth.uid())
--   notifications_update_own  USING/WITH CHECK (user_id = auth.uid())
--
-- VERDICT: correctly scoped, no fix needed. There is one SELECT policy and its
-- single disjunct is an ownership comparison against the row's own user_id.
-- There is no public or discovery policy and no role gated widening, so this
-- is not the permissive OR shape CLAUDE.md warns about: the union across
-- policies is "my own notifications" and nothing else. The client's
-- user_id=eq. filter is about volume, not authorization, and the policy is
-- what actually scopes the stream.
--
-- Writes: no INSERT or DELETE policy and no INSERT/DELETE grant to
-- authenticated; rows are authored only by service role dispatch and by
-- SECURITY DEFINER RPCs, and the lock_notification_fields trigger limits an
-- owner UPDATE to read_at. A client cannot inject a forged row into anyone's
-- stream, including their own.
--
-- REPLICA IDENTITY: left at DEFAULT, deliberately. The subscription is INSERT
-- only, and DEFAULT already ships the complete new tuple on INSERT, so both
-- the filter and the policy evaluate against real values. FULL would only add
-- old row images for UPDATE and DELETE, which nothing reads, on a table whose
-- rows carry notification bodies. Cost with no benefit. If a client ever
-- subscribes to DELETE on this table, revisit here: DELETE events on a DEFAULT
-- identity table cannot be RLS checked and are dropped rather than delivered.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
