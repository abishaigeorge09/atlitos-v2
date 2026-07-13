-- ATLITOS v2 — 0015_court_rating_summary.sql
-- Domain: courts (extends 0009_courts.sql). Epic AT-4. Consumed by the
-- mobile app's Courts vertical slice (PRD-01 3.5, SPEC.md 6.6 "Court
-- detail: ... Rating").
--
-- Why this migration exists: SCHEMA.md is explicit that a court booking's
-- rating lives only on `court_bookings.rating` ("Rating is embedded on the
-- booking row itself ... there is no separate court_ratings table"), and
-- RLS.md's `court_bookings` policy scopes select to the booking's own
-- athlete or the venue's partner/staff. That is correct for the booking
-- itself, but it means there is currently no way for a browsing
-- athlete/guest to see a court's *aggregate* rating (the courts list/detail
-- screens' star rating) without reading other athletes' individual booking
-- rows, which RLS rightly forbids. `coach_profiles` solved the equivalent
-- problem with its own `rating`/`rating_count` columns (maintained however
-- coaching's own domain migration updates them) plus the
-- `coach_profiles_public` security-definer view; courts has neither yet.
--
-- Fix, mirroring the pattern `get_court_busy_slots`/`get_court_available_slots`
-- (0009_courts.sql) already established for "expose an aggregate/shape that
-- hides the underlying booking rows themselves": one read-only,
-- `security definer` function that returns only the aggregate (avg rating,
-- count), never a booking id, athlete id, or remarks text. No new table,
-- per SCHEMA.md's "no separate ratings table" rule; this is an aggregate
-- read path, not a second place ratings are stored.
--
-- Grant shape matches its two siblings above: no explicit revoke, explicit
-- grant to both `anon` and `authenticated` (this backs guest court browsing
-- same as those two, PRD-01 FR-2), not the `revoke ... grant to
-- authenticated` shape 0009 uses for the mutating RPCs further down that
-- same file.

create or replace function public.get_court_rating_summary(p_court_id uuid)
returns table (rating numeric, rating_count int)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(avg(b.rating)::numeric(3, 2), 0) as rating,
    count(b.rating)::int as rating_count
  from public.court_bookings b
  where b.court_id = p_court_id
    and b.rating is not null;
$$;

grant execute on function public.get_court_rating_summary(uuid) to anon, authenticated;
