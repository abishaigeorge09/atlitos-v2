-- ATLITOS v2 — seed_p2.sql
-- Phase 2 demo fixture: 8 Hyderabad venues/courts (box cricket, badminton,
-- tennis), the v1 fixture flavor, for the courts vertical slice flagship
-- demo. Companion to scripts/seed-demo-users.mjs, whose demo court partner
-- (partner@atlitos.dev) these venues are attached to.
--
-- Run order: apply AFTER scripts/seed-demo-users.mjs. Unlike
-- supabase/seed/seed_identity.sql (safe in either order, since it only
-- grants roles/upserts a profile), venues.partner_user_id is NOT NULL, so
-- this file resolves partner@atlitos.dev's auth.users id by email and every
-- venue insert below is a no-op (0 rows selected, nothing inserted) until
-- that account exists. Safe to re-run any number of times either way: every
-- venue/court uses a fixed literal id with `on conflict (id) do nothing`,
-- and every dependent row (windows, pricing rules) is guarded the same way
-- or via `where not exists`.
--
-- This runs with elevated (migration/service-role) privileges, so it writes
-- venues/courts directly rather than through submit_venue_verification
-- (0009_courts.sql) — the RPC exists for the real onboarding wizard, not for
-- fixture loading, same relationship seed_identity.sql already has to
-- submit_coach_verification.

do $$
declare
  v_partner_id uuid;
begin
  select u.id into v_partner_id
  from auth.users au
  join public.users u on u.id = au.id
  where au.email = 'partner@atlitos.dev';

  if v_partner_id is null then
    raise notice 'seed_p2: partner@atlitos.dev does not exist yet, skipping venue/court seed. Re-run this file after scripts/seed-demo-users.mjs.';
    return;
  end if;

  -- ==========================================================================
  -- Venues (8), lat/lng near 17.38,78.48 (Hyderabad). Venue 8 is left
  -- 'pending' deliberately, for the admin verification-queue demo.
  -- ==========================================================================

  insert into public.venues (id, partner_user_id, name, address, city, pincode, lat, lng, description, status)
  values
    ('a0000000-0000-0000-0000-000000000001', v_partner_id, 'Gachibowli Box Cricket Turf', 'Survey No. 64, Financial District Road', 'Hyderabad', '500032', 17.4239, 78.3428, 'Two floodlit box cricket turfs, synthetic pitch, five minutes from Financial District.', 'verified'),
    ('a0000000-0000-0000-0000-000000000002', v_partner_id, 'Madhapur Badminton Court', 'Ayyappa Society Main Road', 'Hyderabad', '500081', 17.4483, 78.3915, 'Three wooden-floor badminton courts with AC, near Ayyappa Society.', 'verified'),
    ('a0000000-0000-0000-0000-000000000003', v_partner_id, 'Kondapur Sports Arena', 'Botanical Garden Road', 'Hyderabad', '500084', 17.4614, 78.3671, 'Mixed-use arena, one box cricket ground and one synthetic tennis court.', 'verified'),
    ('a0000000-0000-0000-0000-000000000004', v_partner_id, 'Banjara Hills Tennis Club', 'Road No. 12, Banjara Hills', 'Hyderabad', '500034', 17.4156, 78.4347, 'Two clay-style hard courts, coaching nets available on request.', 'verified'),
    ('a0000000-0000-0000-0000-000000000005', v_partner_id, 'Jubilee Hills Turf', 'Road No. 45, Jubilee Hills', 'Hyderabad', '500033', 17.4325, 78.4071, 'Single premium box cricket turf, floodlit, parking on site.', 'verified'),
    ('a0000000-0000-0000-0000-000000000006', v_partner_id, 'Kukatpally Badminton Academy', 'KPHB Phase 3', 'Hyderabad', '500072', 17.4849, 78.3915, 'Four-court badminton academy, coaching batches morning and evening.', 'verified'),
    ('a0000000-0000-0000-0000-000000000007', v_partner_id, 'Hitech City Sports Complex', 'Cyber Towers Road', 'Hyderabad', '500081', 17.4435, 78.3772, 'One cricket turf and two badminton courts, popular with the IT crowd after work.', 'verified'),
    ('a0000000-0000-0000-0000-000000000008', v_partner_id, 'Secunderabad Turf Grounds', 'Trimulgherry Main Road', 'Hyderabad', '500015', 17.4399, 78.5017, 'Two box cricket turfs, newly listed, awaiting verification.', 'pending')
  on conflict (id) do nothing;

  -- ==========================================================================
  -- Courts (19 across the 8 venues), base 400-800 rupees/hour.
  -- ==========================================================================

  insert into public.courts (id, venue_id, sport, name, capacity, base_price_per_hour, active)
  values
    ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'cricket', 'Turf A', 16, 600.00, true),
    ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'cricket', 'Turf B', 16, 600.00, true),
    ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'badminton', 'Court 1', 4, 500.00, true),
    ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'badminton', 'Court 2', 4, 500.00, true),
    ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002', 'badminton', 'Court 3', 4, 500.00, true),
    ('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000003', 'cricket', 'Main Ground', 16, 550.00, true),
    ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000003', 'tennis', 'Tennis Court 1', 4, 750.00, true),
    ('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000004', 'tennis', 'Court A', 4, 800.00, true),
    ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000004', 'tennis', 'Court B', 4, 800.00, true),
    ('b0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000005', 'cricket', 'Premium Turf', 16, 700.00, true),
    ('b0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000006', 'badminton', 'Court 1', 4, 400.00, true),
    ('b0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000006', 'badminton', 'Court 2', 4, 400.00, true),
    ('b0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000006', 'badminton', 'Court 3', 4, 400.00, true),
    ('b0000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000006', 'badminton', 'Court 4', 4, 400.00, true),
    ('b0000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000007', 'cricket', 'Turf', 16, 650.00, true),
    ('b0000000-0000-0000-0000-000000000016', 'a0000000-0000-0000-0000-000000000007', 'badminton', 'Court 1', 4, 450.00, true),
    ('b0000000-0000-0000-0000-000000000017', 'a0000000-0000-0000-0000-000000000007', 'badminton', 'Court 2', 4, 450.00, true),
    ('b0000000-0000-0000-0000-000000000018', 'a0000000-0000-0000-0000-000000000008', 'cricket', 'Turf A', 16, 650.00, true),
    ('b0000000-0000-0000-0000-000000000019', 'a0000000-0000-0000-0000-000000000008', 'cricket', 'Turf B', 16, 650.00, true)
  on conflict (id) do nothing;

  -- ==========================================================================
  -- Availability windows: every day of week, 06:00-23:00 for cricket/tennis
  -- (outdoor), 06:00-22:00 for badminton (indoor AC courts), 60 minute slots.
  -- ==========================================================================

  insert into public.court_availability_windows (court_id, day_of_week, open_time, close_time, slot_duration_minutes)
  select
    c.id,
    d.dow,
    time '06:00',
    case when c.sport = 'badminton' then time '22:00' else time '23:00' end,
    60
  from public.courts c
  cross join generate_series(0, 6) as d(dow)
  where c.venue_id in (
    'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000006',
    'a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000008'
  )
  and not exists (
    select 1 from public.court_availability_windows w
    where w.court_id = c.id and w.day_of_week = d.dow
  );

  -- ==========================================================================
  -- Pricing rules: two peak overrides (one multiplier, one fixed price).
  -- ==========================================================================

  insert into public.court_pricing_rules (id, court_id, day_of_week_start, day_of_week_end, time_start, time_end, multiplier, fixed_price, active)
  values
    -- Gachibowli Turf A: Friday-Saturday 18:00-22:00 at 1.5x base (900/hr).
    ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 5, 6, time '18:00', time '22:00', 1.5, null, true),
    -- Banjara Hills Court A: weekday evenings 17:00-21:00, fixed peak rate.
    ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000008', 1, 5, time '17:00', time '21:00', null, 950.00, true)
  on conflict (id) do nothing;
end $$;
