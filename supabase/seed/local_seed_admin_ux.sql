-- ATLITOS v2 - local_seed_admin_ux.sql
--
-- LOCAL ONLY. Fills the admin resources that the other seed files leave empty so
-- every admin page renders rows rather than an empty state: coach profiles for
-- coach1 and coach2, verification requests in all three states, court bookings,
-- 1:1 sessions and orders with items. Added 2026-09-22 for the admin UX rebuild
-- (docs/PLAN-ADMIN-UX.md) because "seed enough data to see the bug" is a house
-- rule and the local stack had zero rows in five of the eleven admin lists.
--
-- Idempotent: every block is keyed on a fixed uuid or an existence check.
-- No payment_intents and no ledger rows are created, same as the other seeds.
-- Run after scripts/seed-demo-users.mjs (needs coach1, coach2, player, partner):
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed/local_seed_admin_ux.sql

do $$
declare
  v_coach1 uuid;
  v_coach2 uuid;
  v_player uuid;
  v_admin uuid;
  v_variant uuid;
begin
  select id into v_coach1 from auth.users where email = 'coach1@atlitos.dev';
  select id into v_coach2 from auth.users where email = 'coach2@atlitos.dev';
  select id into v_player from auth.users where email = 'player@atlitos.dev';
  select id into v_admin  from auth.users where email = 'admin@atlitos.dev';
  if v_coach1 is null or v_coach2 is null or v_player is null then
    raise exception 'run scripts/seed-demo-users.mjs first (coach1, coach2, player missing)';
  end if;

  -- Coach profiles: coach1 verified, coach2 pending.
  insert into public.user_roles (user_id, role)
  select v_coach1, 'coach'::public.app_role where not exists (select 1 from public.user_roles where user_id = v_coach1 and role = 'coach');
  insert into public.user_roles (user_id, role)
  select v_coach2, 'coach'::public.app_role where not exists (select 1 from public.user_roles where user_id = v_coach2 and role = 'coach');

  insert into public.coach_profiles (user_id, sport, experience_years, specialization, bio, city, state, status, rating, rating_count, players_coached_count)
  values (v_coach1, 'cricket', 8, array['batting','fielding'], 'Former Ranji trophy opener, coaching juniors since 2018.', 'Hyderabad', 'Telangana', 'verified', 4.6, 23, 41)
  on conflict (user_id) do nothing;
  insert into public.coach_profiles (user_id, sport, experience_years, specialization, bio, city, state, status)
  values (v_coach2, 'badminton', 3, array['footwork'], 'State level doubles player.', 'Bengaluru', 'Karnataka', 'pending_review')
  on conflict (user_id) do nothing;

  -- Verification requests: two pending (coach, venue), one approved, one rejected.
  insert into public.verification_requests (id, applicant_type, applicant_id, status, payload, created_at)
  values
    ('d0000000-0000-0000-0000-000000000001', 'coach', v_coach2, 'pending_review',
      jsonb_build_object('sport','badminton','experience_years',3,'certificate_url','https://example.invalid/cert-coach2.pdf','note','BWF level 1 certificate attached'),
      now() - interval '3 days'),
    ('d0000000-0000-0000-0000-000000000002', 'venue', 'a0000000-0000-0000-0000-000000000003', 'pending_review',
      jsonb_build_object('venue_name','Kondapur Sports Arena','gst','36AAAAA0000A1Z5','document_url','https://example.invalid/gst-kondapur.pdf'),
      now() - interval '1 day'),
    ('d0000000-0000-0000-0000-000000000003', 'coach', v_coach1, 'approved',
      jsonb_build_object('sport','cricket','experience_years',8,'certificate_url','https://example.invalid/cert-coach1.pdf'),
      now() - interval '20 days'),
    ('d0000000-0000-0000-0000-000000000004', 'upa', v_player, 'rejected',
      jsonb_build_object('school','Zilla Parishad High School','class',9,'id_url','https://example.invalid/id-player.jpg'),
      now() - interval '9 days')
  on conflict (id) do nothing;
  update public.verification_requests
    set reviewer_id = v_admin, reviewed_at = now() - interval '19 days'
    where id = 'd0000000-0000-0000-0000-000000000003' and reviewed_at is null;
  update public.verification_requests
    set reviewer_id = v_admin, reviewed_at = now() - interval '8 days', rejection_reason = 'The school ID photo is unreadable. Upload a clearer one.'
    where id = 'd0000000-0000-0000-0000-000000000004' and reviewed_at is null;

  -- Court bookings across the status vocabulary.
  insert into public.court_bookings (id, court_id, user_id, booking_source, date, slot_start, slot_end, subtotal, gst, platform_fee, total, status, created_at)
  values
    ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', v_player, 'self_service', current_date + 1, '18:00', '19:00', 800, 144, 40, 984, 'confirmed', now() - interval '2 hours'),
    ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', v_player, 'self_service', current_date - 3, '07:00', '08:00', 500, 90, 25, 615, 'completed', now() - interval '4 days'),
    ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', v_player, 'self_service', current_date - 1, '20:00', '21:00', 800, 144, 40, 984, 'cancelled', now() - interval '2 days'),
    ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002', null, 'walk_in', current_date, '16:00', '17:00', 500, 90, 0, 590, 'no_show', now() - interval '1 day')
  on conflict (id) do nothing;
  update public.court_bookings set walk_in_name = 'Ravi Teja', walk_in_phone = '9876543210', cancellation_reason = null
    where id = 'e0000000-0000-0000-0000-000000000004' and walk_in_name is null;
  update public.court_bookings set cancellation_reason = 'Rain'
    where id = 'e0000000-0000-0000-0000-000000000003' and cancellation_reason is null;

  -- 1:1 coaching sessions (dashboard KPIs). sessions_group_shape requires a
  -- session type on every 1:1 row.
  insert into public.session_types (id, coach_id, name, duration_minutes, price)
  values ('f1000000-0000-0000-0000-000000000001', v_coach1, 'Batting technique, 60 min', 60, 1200)
  on conflict (id) do nothing;
  insert into public.sessions (id, coach_id, player_id, session_type_id, frequency, date, slot_start, slot_end, focus_area, location, status, price, platform_fee, total, created_at)
  values
    ('f0000000-0000-0000-0000-000000000001', v_coach1, v_player, 'f1000000-0000-0000-0000-000000000001', 'one_time', current_date + 2, '17:00', '18:00', 'Front foot drives', 'Gachibowli nets', 'accepted', 1200, 120, 1320, now() - interval '1 day'),
    ('f0000000-0000-0000-0000-000000000002', v_coach1, v_player, 'f1000000-0000-0000-0000-000000000001', 'one_time', current_date - 7, '17:00', '18:00', 'Fielding drills', 'Gachibowli nets', 'completed', 1200, 120, 1320, now() - interval '8 days'),
    ('f0000000-0000-0000-0000-000000000003', v_coach1, v_player, 'f1000000-0000-0000-0000-000000000001', 'one_time', current_date + 5, '09:00', '10:00', null, null, 'requested', 1200, 120, 1320, now() - interval '3 hours')
  on conflict (id) do nothing;

  -- Orders with items, one per status the admin advances through.
  select id into v_variant from public.product_variants order by id limit 1;
  if v_variant is not null then
    insert into public.orders (id, user_id, subtotal, delivery_charges, gst_and_others, donation_roundup, total, status, ship_to_line1, ship_to_city, ship_to_state, ship_to_pincode, created_at)
    values
      ('a1b00000-0000-0000-0000-000000000001', v_player, 2499, 49, 449.82, 2.18, 3000, 'placed', '12 Jubilee Hills Road', 'Hyderabad', 'Telangana', '500033', now() - interval '3 hours'),
      ('a1b00000-0000-0000-0000-000000000002', v_player, 899, 49, 161.82, 0.18, 1110, 'shipped', '12 Jubilee Hills Road', 'Hyderabad', 'Telangana', '500033', now() - interval '2 days'),
      ('a1b00000-0000-0000-0000-000000000003', v_player, 1299, 0, 233.82, 0.18, 1533, 'delivered', '12 Jubilee Hills Road', 'Hyderabad', 'Telangana', '500033', now() - interval '12 days'),
      ('a1b00000-0000-0000-0000-000000000004', v_player, 599, 49, 107.82, 0.18, 756, 'cancelled', '12 Jubilee Hills Road', 'Hyderabad', 'Telangana', '500033', now() - interval '20 days')
    on conflict (id) do nothing;
    insert into public.order_items (order_id, product_variant_id, product_title_snapshot, variant_label_snapshot, qty, unit_price)
    select o.id, v_variant, 'SG Cricket Batting Gloves', 'Mens, Right hand', 1, o.subtotal
    from public.orders o
    where o.id in ('a1b00000-0000-0000-0000-000000000001','a1b00000-0000-0000-0000-000000000002','a1b00000-0000-0000-0000-000000000003','a1b00000-0000-0000-0000-000000000004')
      and not exists (select 1 from public.order_items oi where oi.order_id = o.id);
  end if;
end $$;
