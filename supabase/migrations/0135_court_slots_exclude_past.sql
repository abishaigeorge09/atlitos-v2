-- ATLITOS v2 — 0135_court_slots_exclude_past.sql
--
-- get_court_available_slots offered slots that had already happened: every
-- slot earlier today, and every slot on any past date. Found 2026-09-26 while
-- verifying court search: at 12:56 IST the booking screen offered 06:00 to
-- 07:00 as bookable, and 16 slots for yesterday.
--
-- It mattered for money, not just display. book-court accepts a slot only if
-- this function lists it, so a stale or hand crafted request could book and
-- pay for time that was already gone. Excluding the past HERE closes both the
-- picker and the server check in one place, since both read this function.
--
-- A slot in progress is still offered: venue staff record walk ins for the
-- slot being played right now. A slot is only gone once it has ENDED.
-- search_court_slots (0134) is stricter, offering only slots not yet started,
-- because a shopper searching for a court wants one they can still arrive for.
--
-- Everything else about the function is unchanged from 0009 (blackouts,
-- bookings, peak pricing), copied verbatim.

create or replace function public.get_court_available_slots(p_court_id uuid, p_date date)
returns table (slot_start time, slot_end time, price numeric(12, 2))
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dow smallint := extract(dow from p_date)::smallint;
  v_court public.courts%rowtype;
begin
  select * into v_court from public.courts where id = p_court_id;

  if v_court.id is null or not v_court.active then
    return;
  end if;

  -- 0135: nothing on a day that has already gone (IST).
  if p_date < (now() at time zone 'Asia/Kolkata')::date then
    return;
  end if;

  if exists (
    select 1 from public.court_blackouts cb
    where cb.court_id = p_court_id
      and p_date between cb.start_date and cb.end_date
  ) then
    return;
  end if;

  return query
  with windows as (
    select w.open_time, w.close_time, w.slot_duration_minutes
    from public.court_availability_windows w
    where w.court_id = p_court_id and w.day_of_week = v_dow
  ),
  generated as (
    select
      (w.open_time + (n * (w.slot_duration_minutes || ' minutes')::interval))::time as gen_start,
      (w.open_time + (n * (w.slot_duration_minutes || ' minutes')::interval)
        + (w.slot_duration_minutes || ' minutes')::interval)::time as gen_end
    from windows w
    cross join lateral generate_series(
      0,
      floor(extract(epoch from (w.close_time - w.open_time)) / (w.slot_duration_minutes * 60))::int - 1
    ) as n
  )
  select
    g.gen_start,
    g.gen_end,
    coalesce(
      (
        select case when r.fixed_price is not null then r.fixed_price
                    else v_court.base_price_per_hour * r.multiplier
               end
        from public.court_pricing_rules r
        where r.court_id = p_court_id
          and r.active
          and v_dow between r.day_of_week_start and r.day_of_week_end
          and g.gen_start >= r.time_start
          and g.gen_start < r.time_end
        order by r.created_at desc
        limit 1
      ),
      v_court.base_price_per_hour
    ) as price
  from generated g
  where not exists (
    select 1 from public.court_bookings b
    where b.court_id = p_court_id
      and b.date = p_date
      and b.slot_start = g.gen_start
      and b.status <> 'cancelled'
  )
    -- 0135: today, only slots that have not ENDED. A slot in progress stays
    -- offered, because venue staff record walk ins for the slot being played.
    and (p_date > (now() at time zone 'Asia/Kolkata')::date
         or g.gen_end > (now() at time zone 'Asia/Kolkata')::time)
  order by g.gen_start;
end;
$$;
