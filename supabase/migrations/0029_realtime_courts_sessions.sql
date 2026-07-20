-- ============================================================================
-- 0029_realtime_courts_sessions.sql
--
-- Story AT-62 (Epic AT-12, PRD-03 FR-15, PRD-02 FR-12). Fixes the mechanical
-- root cause of advisory AT-32, which AT-59 found and proved.
--
-- THE BUG: public.court_bookings was never added to the supabase_realtime
-- publication. Not in 0009_courts.sql, which created the table, and not in
-- any migration since; 0022_chat.sql is the only migration in this repo that
-- has ever touched the publication, and it added chat_messages only. So the
-- partner Live Today board (apps/portal-court/src/app/dashboard/live-today)
-- has a correct postgres_changes subscription pointed at a table Postgres was
-- never told to replicate. There is no publish side. The board's socket
-- reaches SUBSCRIBED, sets its `realtimeConnected` indicator to true, and then
-- receives nothing, forever.
--
-- That made three shipped copy strings false, not merely optimistic:
--   - page.tsx           "Live today, updated in real time"
--   - page.tsx           "Check ins, walk ins and cancellations show up the
--                         moment they happen"
--   - live-today/page.tsx "will update here in real time"
-- This migration is what makes them true.
--
-- public.sessions has the same gap. No UI claims realtime for it yet, so that
-- half is a missing capability rather than a false claim, but PRD-02 FR-12's
-- coach accept/decline push needs it and it costs nothing to close both at
-- once, under the same RLS review.
--
-- Order of business below, and the order matters: RLS is reviewed and hardened
-- BEFORE either table is published. Realtime evaluates each table's SELECT
-- policy per subscriber before delivering a row (AT-59 proved this empirically
-- against a live socket for chat_messages, it is not an assumption here), so
-- publishing a table with a leaky SELECT policy does not merely expose a query
-- bug, it converts that bug into a live broadcast to every subscribed socket.
-- ============================================================================


-- ============================================================================
-- 1. RLS review, court_bookings (0009_courts.sql)
--
-- Policies as they stand:
--   court_bookings_select        USING (is_court_partner_or_staff(court_id)
--                                       OR user_id = auth.uid())
--   court_bookings_select_admin  USING (has_role('admin') OR has_role('moderator'))
--
-- VERDICT: correctly scoped, no fix needed. Reasoning, because this codebase
-- has been bitten by permissive-OR twice (0016's storage `name` capture and
-- the P2 venue-picker bug) and "it has an OR in it" is not by itself the
-- defect:
--
--   - is_court_partner_or_staff(court_id) joins courts -> venues and requires
--     `v.partner_user_id = auth.uid()` for the partner branch, or an
--     accepted (`accepted_at is not null`) venue_staff membership on that same
--     venue for the staff branch. Both branches are anchored to the row's own
--     venue. There is no unanchored branch, and no `using (true)`.
--   - The `OR user_id = auth.uid()` disjunct is the booking's own athlete,
--     which is intended (PRD-01: an athlete sees their own booking).
--   - Both disjuncts live inside ONE policy's USING clause, and neither is a
--     public/discovery policy. This is the chat_threads shape that RLS.md
--     calls out as the safe exception, not the venues shape. An unscoped
--     `select * from court_bookings` returns the caller's own bookings plus
--     their own venues' bookings, and nothing else.
--   - court_bookings_select_admin is a second permissive policy, but it is
--     role-gated rather than row-shaped, so it widens the result set only for
--     admins/moderators, which is the documented intent (RLS.md courts).
--
-- So the stream this migration opens goes to: the venue's partner, that
-- venue's accepted staff, the booking's own athlete, and admins/moderators.
-- That is the correct audience for a Live Today board.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1a. One real gap found and fixed: missing write revoke (defense in depth).
--
-- court_bookings has NO insert/update/delete policy for authenticated, so RLS
-- denies client writes today. But unlike public.sessions, which 0019 backed
-- with `revoke insert, update, delete ... from anon, authenticated` at the
-- grant level, 0009 never revoked those grants on court_bookings. The grants
-- are inert right now (a grant without a policy still yields zero rows), so
-- this is not a live hole. It is the missing second layer that RLS.md's
-- financial-write-prohibition section describes as belt-and-braces on exactly
-- this class of table, and its absence means one careless future policy is all
-- that stands between a client and a direct write to a money-bearing row.
--
-- Closing it here rather than in a follow-up specifically because we are about
-- to publish this table: a stray client-side UPDATE on a published table is no
-- longer a silent local corruption, it fans out to every subscribed partner
-- socket as an authoritative-looking event.
--
-- This also makes the replica identity decision in section 3 sound: with no
-- DELETE policy AND no DELETE grant, a client-originated DELETE is impossible.
-- ----------------------------------------------------------------------------
revoke insert, update, delete on public.court_bookings from anon, authenticated;


-- ============================================================================
-- 2. RLS review, sessions (0019_coaching_rls.sql)
--
-- Policies as they stand:
--   sessions_select_coach   USING (has_role('coach') AND coach_id = auth.uid())
--   sessions_select_player  USING (player_id = auth.uid())
--   sessions_select_admin   USING (has_role('admin') OR has_role('moderator'))
--
-- VERDICT: correctly scoped, no fix needed. Every non-admin disjunct is an
-- ownership comparison against auth.uid() on the row's own column, so the
-- union across policies is "my sessions as coach" plus "my sessions as
-- player" and nothing wider. RLS.md's 0019 permissive-OR warning applies to
-- this table, but re-reading it precisely: that warning is that a user who is
-- BOTH a coach and a player sees both sets from one unscoped query, so UI
-- queries must carry their own owner filter. That is a scoping caveat for
-- query authors, not a cross-user leak, and it does not widen the Realtime
-- audience beyond the two parties to the session. Publishing is safe.
--
-- (The genuinely leaky members of that 0019 warning are session_types and
-- coach_availability_windows, which do carry public discovery policies.
-- Neither is being published here.)
-- ============================================================================

-- No policy changes required on either table. Recording the review as a
-- comment rather than as churn: re-creating a correct policy to "prove" it was
-- reviewed adds risk and hides intent.

-- Belt-and-braces revoke on sessions already shipped in 0019 (line 130), so
-- there is deliberately no matching revoke statement here.


-- ============================================================================
-- 3. REPLICA IDENTITY decision: leave both at DEFAULT. Deliberate, not skipped.
--
-- Both tables are currently relreplident = 'd' (DEFAULT: the WAL carries the
-- full NEW tuple on INSERT and UPDATE, but only the primary key for the OLD
-- tuple).
--
-- What the Live Today board actually needs is the crux. Its subscription is
-- `event: "*"` filtered by `court_id=in.(...)`, and its two headline
-- behaviours, check ins and cancellations, are both UPDATEs, not INSERTs and
-- not DELETEs:
--   - check in     -> court_booking_check_in() sets checked_in_at
--   - cancellation -> court_booking_transition() sets status = 'cancelled'
-- Neither row ever leaves the table; there is no hard-delete path in the
-- product at all, and after section 1a there is not even a DELETE grant.
--
-- Under DEFAULT replica identity, an UPDATE still ships the complete new row,
-- so both the client's `court_id` filter and the SELECT policy's
-- is_court_partner_or_staff(court_id) check evaluate against real values and
-- the event is delivered normally. DEFAULT is therefore sufficient for
-- everything this board does. This is verified, not reasoned: the UPDATE half
-- of scripts/verify-realtime.mjs exists precisely to prove a check-in UPDATE
-- reaches the partner's socket under DEFAULT.
--
-- REPLICA IDENTITY FULL was considered and rejected. It buys exactly two
-- things, neither of which is wanted here:
--   - a populated `old_record` on UPDATE. The board refetches through the
--     venue_bookings_today view on any change and never reads payload.old, so
--     this is dead weight.
--   - RLS-checkable DELETE events. There are no DELETEs.
-- Against that it writes every column of every old row into the WAL on each
-- UPDATE (these rows carry subtotal/gst/platform_fee/total and walk-in PII),
-- inflating replication volume and widening what a subscriber's payload
-- exposes, on a table on the money path. Cost with no benefit.
--
-- If a hard-delete path for either table is ever introduced, or a client
-- starts reading payload.old, this decision must be revisited in that same
-- change: DELETE events on a DEFAULT-identity table cannot be RLS-checked
-- (only the PK is present, so the policy evaluates against nulls) and are
-- therefore silently dropped rather than delivered. Silently dropped is the
-- safe direction to fail, but it is still a behaviour change that would be
-- easy to misdiagnose as another dead publication.
-- ============================================================================


-- ============================================================================
-- 4. Publish. Guarded with a catalog existence check per table, exactly the
-- way 0022_chat.sql guards chat_messages, so re-running this migration (or
-- running it against a project where someone already flipped the dashboard
-- toggle) is a no-op instead of a duplicate_object error.
-- ============================================================================

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

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sessions'
  ) then
    alter publication supabase_realtime add table public.sessions;
  end if;
end
$$;
