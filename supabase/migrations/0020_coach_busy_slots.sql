-- ATLITOS v2 — 0020_coach_busy_slots.sql
-- Domain: coaching. Epic AT-5, story AT-38.
-- Requirements: PRD-02 FR-22, FR-24; PRD-01 FR-21, FR-22.
--
-- The coaching slot engine is a read-time computation, not a materialized
-- slots table, exactly as courts does it: bookable slots for a coach are
-- coach_availability_windows (publicly readable for a verified coach per
-- 0019_coaching_rls.sql) minus the (date, slot_start) pairs this function
-- returns. PRD-02 FR-22 makes availability windows the only input to the
-- engine, so there is nothing else to subtract, no blackout table on the
-- coaching side.
--
-- Direct mirror of get_court_busy_slots (0009_courts.sql), including why it is
-- SECURITY DEFINER: sessions' own RLS scopes select to the two parties, so an
-- athlete browsing a coach's availability preview can see none of the sessions
-- that make a slot unavailable. This function runs as its owner and returns
-- ONLY the (date, slot_start) pair, never a session id, player id, price, or
-- status, so a browsing athlete learns that a slot is taken and nothing about
-- who took it or what they paid.
--
-- The exclusion list is 'declined' and 'cancelled', identical to the predicate
-- on sessions_coach_date_slot_unique (0018_coaching.sql). Those two are the
-- same fact stated twice, deliberately: whatever the index frees, this read
-- path must also show as free, or a slot would render bookable and then fail
-- with SLOT_TAKEN (or the reverse, a slot renders taken that the index would
-- happily accept). If a future migration changes one predicate, it changes
-- both.
--
-- Deliberately NOT shipped here: a get_coach_available_slots counterpart to
-- courts' one. AT-38's scope is the busy-pairs read path only. Coaching has no
-- per-slot pricing rules (price comes from the chosen session_type) and the
-- windows themselves are publicly readable, so the client composes the
-- bookable list from windows minus these pairs without needing a second RPC.
--
-- Grant shape matches get_court_busy_slots: anon and authenticated both, since
-- guest coach browsing is PRD-01 FR-2's read surface.

create or replace function public.get_coach_busy_slots(
  p_coach_id uuid,
  p_from date,
  p_to date
)
returns table (date date, slot_start time)
language sql
stable
security definer
set search_path = public
as $$
  select s.date, s.slot_start
  from public.sessions s
  where s.coach_id = p_coach_id
    and s.date between p_from and p_to
    and s.status not in ('declined', 'cancelled')
  order by s.date, s.slot_start;
$$;

grant execute on function public.get_coach_busy_slots(uuid, date, date) to anon, authenticated;
