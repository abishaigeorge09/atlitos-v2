\pset format aligned
\set ath '''11111111-1111-1111-1111-111111111111'''
\set coa '''22222222-2222-2222-2222-222222222222'''

set role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated',
                    'app_metadata', json_build_object('roles', json_build_array('player','coach')))::text,
  false);

\echo '=== R0. Acting as the coach, and the coach is NOT the deleted user ==='
select auth.uid() = :coa as is_coach, auth.uid() <> :ath as differs_from_deleted;

\echo
\echo '=== R1. Coach reads the whole thread, deleted author resolves to a tombstone ==='
select m.text, p.name as author, p.avatar_url
from public.chat_messages m
join public.public_profiles p on p.id = m.sender_id
join public.chat_threads t on t.id = m.thread_id
where auth.uid() in (t.participant_a, t.participant_b)
order by m.created_at;

\echo
\echo '=== R2. Coach still sees the completed session and who it was with ==='
select s.status, s.total, p.name as player
from public.sessions s
join public.public_profiles p on p.id = s.player_id
where s.coach_id = auth.uid();

\echo
\echo '=== R3. The deleted user comment on the coach clip still reads ==='
select c.text, p.name as author
from public.clip_comments c
join public.public_profiles p on p.id = c.user_id
where c.clip_id = 'bb000000-0000-0000-0000-000000000002';

\echo
\echo '=== R4. Coach earnings ledger untouched ==='
select account_type, direction, amount, description
from public.ledger_entries where account_ref = auth.uid();

\echo
\echo '=== R5. Deleted coach would not be discoverable (control: this coach IS listed) ==='
select count(*) as this_coach_listed from public.coach_profiles_public where user_id = auth.uid();

reset role;
select set_config('request.jwt.claims', null, false);

\echo
\echo '=== R6. Court partner reads the future booking with a tombstoned customer ==='
set role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated',
                    'app_metadata', json_build_object('roles', json_build_array('player','court_partner')))::text,
  false);
select auth.uid() <> :ath as partner_differs_from_deleted;
select cb.date, cb.status, cb.total, p.name as customer
from public.court_bookings cb
join public.courts c on c.id = cb.court_id
join public.venues v on v.id = c.venue_id
join public.public_profiles p on p.id = cb.user_id
where v.partner_user_id = auth.uid();
reset role;
select set_config('request.jwt.claims', null, false);

\echo
\echo '=== R7. clip_comments delta explained: only comments on the DELETED user own clip went ==='
select clip_id, count(*) from public.clip_comments group by clip_id;
select id, owner_id from public.clips;
