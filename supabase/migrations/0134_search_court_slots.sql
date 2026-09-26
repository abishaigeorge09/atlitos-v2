-- ATLITOS v2 — 0134_search_court_slots.sql
--
-- Court search answered from real availability.
-- docs/PLAN-PAYOUTS-CLICKS-SEARCH.md Track 3.
--
-- WHY. Court search matched TEXT. A court's text is its name, sport, venue and
-- address, so "is anything free tonight after 7 under 500" could not be
-- answered at all, and time words failed every court's text match (fixed in
-- ai-search/when.ts). This function returns, per court, the first free slot
-- inside a date and time window, priced with peak rules applied, from the
-- venues a shopper can actually book.
--
-- ONE SOURCE OF TRUTH FOR "FREE". It calls get_court_available_slots (0009),
-- the function the booking screen itself uses, for each candidate court and
-- day. Blackouts, booked slots and pricing rules are therefore decided in
-- exactly one place: search can never show a slot the booking screen refuses,
-- or a price the checkout re-prices differently. The cost is one call per
-- court per day, which is why candidate courts are capped (see LIMITS).
--
-- WHAT THIS ADDS ON TOP of get_court_available_slots:
--   - verified venues only (the booking RPC checks only court.active);
--   - slots already started today are excluded, in IST;
--   - the price ceiling is tested against the SLOT price after peak rules, not
--     the court's base price, so a court whose base is 400 but whose 7 PM is
--     600 is correctly absent from "under 500 at 7 PM".
--
-- LIMITS. At most 14 days per search and 60 candidate courts, nearest first
-- when the caller sent a location, otherwise by city. Performance is a
-- correctness property at the 10,000 user target (CLAUDE.md): an uncapped
-- version is courts times days function calls and grows with the catalogue.
-- The candidate set is filtered by sport, city and radius BEFORE any slot is
-- generated.

create or replace function public.search_court_slots(
  p_date_from date,
  p_date_to date,
  p_time_from time default '00:00',
  p_time_to time default null,
  p_sport public.sport default null,
  p_price_max numeric default null,
  p_city text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_km double precision default null,
  p_limit int default 20
)
returns table (
  court_id uuid,
  court_name text,
  sport public.sport,
  venue_id uuid,
  venue_name text,
  city text,
  address text,
  distance_km double precision,
  first_date date,
  first_start time,
  first_end time,
  first_price numeric,
  min_price numeric,
  matching_slots int
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_now time := (now() at time zone 'Asia/Kolkata')::time;
  v_from date := greatest(p_date_from, (now() at time zone 'Asia/Kolkata')::date);
  v_to date;
begin
  if p_date_from is null or p_date_to is null then
    raise exception 'VALIDATION: date_from and date_to are required';
  end if;
  v_to := least(p_date_to, v_from + 13);
  if v_to < v_from then
    return;
  end if;

  return query
  with candidates as (
    select c.id, c.name, c.sport, v.id as venue_id, v.name as venue_name, v.city, v.address,
           case
             when p_lat is null or p_lng is null or v.lat is null or v.lng is null then null
             else 6371 * 2 * asin(sqrt(
               power(sin(radians(v.lat - p_lat) / 2), 2)
               + cos(radians(p_lat)) * cos(radians(v.lat)) * power(sin(radians(v.lng - p_lng) / 2), 2)
             ))
           end as dist
    from public.courts c
    join public.venues v on v.id = c.venue_id
    where c.active
      and v.status = 'verified'
      and (p_sport is null or c.sport = p_sport)
      and (p_city is null or p_lat is not null or v.city ilike p_city)
  ),
  near as (
    select * from candidates
    where p_radius_km is null or dist is null or dist <= p_radius_km
    order by dist nulls last, name
    limit 60
  ),
  slots as (
    select n.*, d::date as slot_date, s.slot_start, s.slot_end, s.price
    from near n
    cross join generate_series(v_from, v_to, interval '1 day') as d
    cross join lateral public.get_court_available_slots(n.id, d::date) as s
    where s.slot_start >= coalesce(p_time_from, '00:00'::time)
      and (p_time_to is null or s.slot_start < p_time_to)
      and (p_price_max is null or s.price <= p_price_max)
      and (d::date > v_today or s.slot_start > v_now)
  ),
  ranked as (
    select sl.*,
           row_number() over (partition by sl.id order by sl.slot_date, sl.slot_start) as rn,
           count(*) over (partition by sl.id) as n_slots,
           min(sl.price) over (partition by sl.id) as cheapest
    from slots sl
  )
  select r.id, r.name, r.sport, r.venue_id, r.venue_name, r.city, r.address,
         round(r.dist::numeric, 1)::double precision,
         r.slot_date, r.slot_start, r.slot_end, r.price, r.cheapest, r.n_slots::int
  from ranked r
  where r.rn = 1
  order by r.slot_date, r.slot_start, r.dist nulls last
  limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

comment on function public.search_court_slots is
  'Court search from real availability: first free slot per court in a date and time window, verified venues only, slot price after peak rules, IST. Built on get_court_available_slots so search and booking agree.';

-- Same exposure as get_court_available_slots: free slot times at verified
-- venues are public, and guests browse courts before signing in.
revoke all on function public.search_court_slots(date, date, time, time, public.sport, numeric, text, double precision, double precision, double precision, int) from public;
grant execute on function public.search_court_slots(date, date, time, time, public.sport, numeric, text, double precision, double precision, double precision, int) to anon, authenticated;
