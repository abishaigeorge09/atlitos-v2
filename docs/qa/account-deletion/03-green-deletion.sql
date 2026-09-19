\pset format aligned
\set ath '''11111111-1111-1111-1111-111111111111'''
\set coa '''22222222-2222-2222-2222-222222222222'''

\echo
\echo '=== T0. Money and social state BEFORE ==='
select
  (select count(*) from public.payment_intents)                                as pi,
  (select count(*) from public.ledger_entries)                                 as le,
  (select count(*) from public.ledger_entries where payment_intent_id is null) as le_orphan,
  (select count(*) from public.donations)                                      as don,
  (select count(*) from public.sessions)                                       as sess,
  (select count(*) from public.court_bookings)                                 as bookings,
  (select count(*) from public.chat_messages)                                  as msgs,
  (select count(*) from public.clip_comments)                                  as comments,
  (select coalesce(sum(amount) filter (where direction='debit'),0)
        - coalesce(sum(amount) filter (where direction='credit'),0)
     from public.ledger_entries)                                               as imbalance,
  (select coalesce(sum(amount),0) from public.donations)                       as donation_total,
  (select coalesce(sum(amount),0) from public.payment_intents)                 as payments_total;

-- ---------------------------------------------------------------------------
-- Become the athlete, exactly as PostgREST would.
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated',
                    'app_metadata', json_build_object('roles', json_build_array('player')))::text,
  false);

\echo
\echo '=== T1. Caller identity is really the athlete, and is NOT the coach ==='
select auth.uid() as acting_as,
       auth.uid() = :ath  as is_athlete,
       auth.uid() <> :coa as differs_from_coach;

\echo
\echo '=== T2. Preview before deletion (honest copy source) ==='
select jsonb_pretty(public.account_deletion_preview());

\echo
\echo '=== T3. delete_my_account() ==='
select jsonb_pretty(public.delete_my_account());

reset role;
select set_config('request.jwt.claims', null, false);

\echo
\echo '=== T4. Money and social state AFTER (compare with T0) ==='
select
  (select count(*) from public.payment_intents)                                as pi,
  (select count(*) from public.ledger_entries)                                 as le,
  (select count(*) from public.ledger_entries where payment_intent_id is null) as le_orphan,
  (select count(*) from public.donations)                                      as don,
  (select count(*) from public.sessions)                                       as sess,
  (select count(*) from public.court_bookings)                                 as bookings,
  (select count(*) from public.chat_messages)                                  as msgs,
  (select count(*) from public.clip_comments)                                  as comments,
  (select coalesce(sum(amount) filter (where direction='debit'),0)
        - coalesce(sum(amount) filter (where direction='credit'),0)
     from public.ledger_entries)                                               as imbalance,
  (select coalesce(sum(amount),0) from public.donations)                       as donation_total,
  (select coalesce(sum(amount),0) from public.payment_intents)                 as payments_total;

\echo
\echo '=== T5. Every ledger entry group still balances, individually ==='
select entry_group_id,
       sum(amount) filter (where direction='debit')  as debits,
       sum(amount) filter (where direction='credit') as credits,
       (sum(amount) filter (where direction='debit') = sum(amount) filter (where direction='credit')) as balanced
from public.ledger_entries group by entry_group_id order by 1;

\echo
\echo '=== T6. PII is gone from the users row ==='
select name, phone, dob, avatar_url, handle, bio, city, sports,
       (deleted_at is not null) as is_deleted
from public.users where id = :ath;

\echo
\echo '=== T7. Personal data rows are gone ==='
select
  (select count(*) from public.addresses where user_id = :ath)     as addresses,
  (select count(*) from public.push_tokens where user_id = :ath)   as push_tokens,
  (select count(*) from public.clips where owner_id = :ath)        as clips,
  (select count(*) from public.follows where follower_id = :ath or followee_id = :ath) as follows,
  (select count(*) from public.athlete_sports where user_id = :ath) as athlete_sports,
  (select count(*) from public.notifications where user_id = :ath)  as notifications,
  (select count(*) from public.user_roles where user_id = :ath)     as roles;

\echo
\echo '=== T8. The COACH still reads the thread, attributed to a tombstone ==='
set role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated',
                    'app_metadata', json_build_object('roles', json_build_array('player','coach')))::text,
  false);
select auth.uid() = :coa as acting_as_coach, auth.uid() <> :ath as differs_from_deleted_user;
select m.text, u.name as author, (u.deleted_at is not null) as author_deleted
from public.chat_messages m
join public.users u on u.id = m.sender_id
join public.chat_thread_members tm on tm.thread_id = m.thread_id and tm.user_id = auth.uid()
order by m.created_at;

\echo
\echo '=== T9. The coach still sees their session and their earning ==='
select s.id, s.status, s.total, u.name as player
from public.sessions s join public.users u on u.id = s.player_id
where s.coach_id = auth.uid();
select account_type, amount, direction, description
from public.ledger_entries where account_type='coach' and account_ref = auth.uid();

\echo
\echo '=== T10. The comment the deleted user left on the coach clip still reads ==='
select c.text, u.name as author from public.clip_comments c
join public.users u on u.id = c.user_id
where c.clip_id = 'bb000000-0000-0000-0000-000000000002';

reset role;
select set_config('request.jwt.claims', null, false);

\echo
\echo '=== T11. The court partner still has the future booking ==='
select cb.id, cb.date, cb.status, cb.total, u.name as booked_by
from public.court_bookings cb join public.users u on u.id = cb.user_id;

\echo
\echo '=== T12. The deleted user is no longer discoverable as a coach or profile ==='
select count(*) as deleted_user_in_public_profiles
from public.public_profiles where id = :ath and name <> 'Deleted user';
