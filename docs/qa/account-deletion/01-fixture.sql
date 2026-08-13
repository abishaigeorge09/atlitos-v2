-- Deterministic fixture: one deleting athlete (ATH) with money and social
-- history, one coach (COA) who must keep their session history, one court
-- partner (PAR) whose bookings must survive, and one admin (ADM).
set session role postgres;
set local search_path = public;

-- Fixed ids so every assertion can name them.
\set ath '''11111111-1111-1111-1111-111111111111'''
\set coa '''22222222-2222-2222-2222-222222222222'''
\set par '''33333333-3333-3333-3333-333333333333'''
\set adm '''44444444-4444-4444-4444-444444444444'''
\set adm2 '''45454545-4545-4545-4545-454545454545'''

insert into auth.users (id, email, raw_user_meta_data) values
  (:ath, 'athlete@example.test', '{"name":"Riya Sharma"}'),
  (:coa, 'coach@example.test',   '{"name":"Vikram Rao"}'),
  (:par, 'partner@example.test', '{"name":"Anand Kumar"}'),
  (:adm, 'admin@example.test',   '{"name":"Platform Admin"}'),
  (:adm2,'admin2@example.test',  '{"name":"Second Admin"}');

-- handle_new_user() already created public.users + a 'player' role for each.
update public.users set
  phone = '+91' || lpad(abs(hashtext(id::text))::text, 10, '0'),
  dob = date '1998-04-12',
  city = 'Hyderabad', state = 'Telangana',
  avatar_url = 'avatars/' || id || '.jpg',
  bio = 'Midfielder chasing a state cap.',
  handle = 'user' || substr(md5(id::text), 1, 8),
  sports = '{football}';

insert into public.user_roles (user_id, role) values
  (:coa, 'coach'), (:par, 'court_partner'), (:adm, 'admin'), (:adm2, 'admin');

insert into public.coach_profiles (user_id, sport, experience_years, city, state, status, bio)
values (:coa, 'football', 9, 'Hyderabad', 'Telangana', 'verified', 'Ex state league.');

insert into public.session_types (id, coach_id, name, duration_minutes, price)
values ('a1000000-0000-0000-0000-000000000001', :coa, 'One to one', 60, 800);

insert into public.venues (id, partner_user_id, name, address, city, pincode, status)
values ('b1000000-0000-0000-0000-000000000001', :par, 'Turf One', '12 Main Rd', 'Hyderabad', '500001', 'verified');

insert into public.courts (id, venue_id, sport, name, base_price_per_hour)
values ('c1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'football', 'Court A', 600);

-- ---------------------------------------------------------------------------
-- Money: three captured payment intents for the deleting athlete.
-- ---------------------------------------------------------------------------
insert into public.payment_intents (id, user_id, domain, entity_id, amount, status, razorpay_order_id, razorpay_payment_id) values
  ('d1000000-0000-0000-0000-000000000001', :ath, 'session',  'e1000000-0000-0000-0000-000000000001',  944.00, 'captured', 'order_sess1', 'pay_sess1'),
  ('d1000000-0000-0000-0000-000000000002', :ath, 'court',    'e1000000-0000-0000-0000-000000000002',  708.00, 'captured', 'order_court1', 'pay_court1'),
  ('d1000000-0000-0000-0000-000000000003', :ath, 'donation', 'e1000000-0000-0000-0000-000000000003', 1000.00, 'captured', 'order_don1', 'pay_don1');

insert into public.sessions (id, coach_id, player_id, session_type_id, frequency, date, slot_start, slot_end,
                             status, price, platform_fee, total, payment_intent_id)
values ('e1000000-0000-0000-0000-000000000001', :coa, :ath, 'a1000000-0000-0000-0000-000000000001',
        'one_time', current_date - 20, '07:00', '08:00', 'completed', 800, 144, 944,
        'd1000000-0000-0000-0000-000000000001');

insert into public.court_bookings (id, court_id, user_id, date, slot_start, slot_end,
                                   subtotal, gst, platform_fee, total, status, payment_intent_id)
values ('e1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', :ath,
        current_date + 9, '18:00', '19:00', 600, 108, 0, 708, 'confirmed',
        'd1000000-0000-0000-0000-000000000002');

insert into public.upa_applications (id, applicant_user_id, story_headline, story_body, sport, region, state, status)
values ('f1000000-0000-0000-0000-000000000001', :coa, 'Needs boots', 'Long story.', 'football', 'South', 'Telangana', 'verified');

insert into public.donations (id, donor_id, upa_id, amount, method, payment_intent_id, donor_display_name)
values ('e1000000-0000-0000-0000-000000000003', :ath, 'f1000000-0000-0000-0000-000000000001',
        1000.00, 'standalone', 'd1000000-0000-0000-0000-000000000003', 'Riya Sharma');

-- Balanced ledger groups, one per intent.
insert into public.ledger_entries (entry_group_id, payment_intent_id, account_type, account_ref, direction, amount, domain, entity_id, description) values
  ('99000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'user',     :ath, 'debit',  944.00, 'session', 'e1000000-0000-0000-0000-000000000001', 'Session charge'),
  ('99000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'coach',    :coa, 'credit', 800.00, 'session', 'e1000000-0000-0000-0000-000000000001', 'Coach earning'),
  ('99000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'platform', null, 'credit', 144.00, 'session', 'e1000000-0000-0000-0000-000000000001', 'Platform fee'),

  ('99000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002', 'user',          :ath, 'debit',  708.00, 'court', 'e1000000-0000-0000-0000-000000000002', 'Court charge'),
  ('99000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002', 'court_partner', 'b1000000-0000-0000-0000-000000000001', 'credit', 600.00, 'court', 'e1000000-0000-0000-0000-000000000002', 'Partner earning'),
  ('99000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002', 'platform',      null, 'credit', 108.00, 'court', 'e1000000-0000-0000-0000-000000000002', 'GST and fee'),

  ('99000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000003', 'user',     :ath, 'debit',  1000.00, 'donation', 'e1000000-0000-0000-0000-000000000003', 'Donation'),
  ('99000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000003', 'upa_fund', null, 'credit', 1000.00, 'donation', 'e1000000-0000-0000-0000-000000000003', 'UPA fund');

-- ---------------------------------------------------------------------------
-- Social: a chat the coach still needs, a clip, a comment the athlete left on
-- the coach's clip, follows, and purely personal rows.
-- ---------------------------------------------------------------------------
insert into public.chat_threads (id, participant_a, participant_b, context_type, context_id)
values ('aa000000-0000-0000-0000-000000000001', :ath, :coa, 'coaching', 'e1000000-0000-0000-0000-000000000001');

insert into public.chat_messages (thread_id, sender_id, text) values
  ('aa000000-0000-0000-0000-000000000001', :ath, 'See you at seven.'),
  ('aa000000-0000-0000-0000-000000000001', :coa, 'Bring the resistance band.');

insert into public.clips (id, owner_id, caption, sport, status) values
  ('bb000000-0000-0000-0000-000000000001', :ath, 'Free kick rep', 'football', 'ready'),
  ('bb000000-0000-0000-0000-000000000002', :coa, 'Drill of the week', 'football', 'ready');

insert into public.clip_comments (clip_id, user_id, text) values
  ('bb000000-0000-0000-0000-000000000002', :ath, 'Trying this tomorrow.'),
  ('bb000000-0000-0000-0000-000000000001', :coa, 'Good contact.');

insert into public.clip_likes (clip_id, user_id) values ('bb000000-0000-0000-0000-000000000002', :ath);
insert into public.follows (follower_id, followee_id) values (:ath, :coa), (:coa, :ath);
insert into public.addresses (user_id, line1, city, state, pincode) values (:ath, '4 Park Lane', 'Hyderabad', 'Telangana', '500001');
insert into public.push_tokens (user_id, token, platform) values (:ath, 'ExponentPushToken[abc]', 'ios');
insert into public.athlete_sports (user_id, sport, is_primary) values (:ath, 'football', true);
insert into public.notifications (user_id, type, title, body, deep_link) values (:ath, 'booking', 'Session accepted', 'Vikram accepted.', 'atlitos://sessions');

\echo FIXTURE LOADED
