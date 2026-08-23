\pset format aligned
\set ath '''11111111-1111-1111-1111-111111111111'''
\set coa '''22222222-2222-2222-2222-222222222222'''

create or replace function pg_temp.act(p_uid uuid, p_roles text[])
returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
      'app_metadata', json_build_object('roles', to_json(p_roles)))::text, false);
  select null::void;
$$;

-- A group the deleting athlete is the ONLY member of, paid for.
insert into public.training_groups (id, coach_id, name, sport, capacity, monthly_fee)
values ('cc000000-0000-0000-0000-000000000001', :coa, 'Sunrise Squad', 'football', 8, 2000);

insert into public.payment_intents (id, user_id, domain, entity_id, amount, status, razorpay_order_id)
values ('d1000000-0000-0000-0000-0000000000aa', :ath, 'membership', 'cc000000-0000-0000-0000-000000000001', 2360, 'captured', 'order_mem1');

insert into public.group_memberships (id, group_id, player_id, period_start, period_end, status, price, platform_fee, total, payment_intent_id)
values ('dd000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', :ath,
        current_date - 5, current_date + 25, 'active', 2000, 360, 2360, 'd1000000-0000-0000-0000-0000000000aa');

insert into public.ledger_entries (entry_group_id, payment_intent_id, account_type, account_ref, direction, amount, domain, entity_id, description) values
  ('99000000-0000-0000-0000-0000000000aa', 'd1000000-0000-0000-0000-0000000000aa', 'user',     :ath, 'debit',  2360.00, 'membership', 'cc000000-0000-0000-0000-000000000001', 'Membership'),
  ('99000000-0000-0000-0000-0000000000aa', 'd1000000-0000-0000-0000-0000000000aa', 'coach',    :coa, 'credit', 2000.00, 'membership', 'cc000000-0000-0000-0000-000000000001', 'Coach earning'),
  ('99000000-0000-0000-0000-0000000000aa', 'd1000000-0000-0000-0000-0000000000aa', 'platform', null, 'credit',  360.00, 'membership', 'cc000000-0000-0000-0000-000000000001', 'Platform fee');

\echo '=== E7-CONTROL. An ACTIVE user CAN update their own bio (so E7 is not vacuous) ==='
select pg_temp.act(:ath, array['player']);
set role authenticated;
update public.users set bio = 'control write' where id = '11111111-1111-1111-1111-111111111111';
reset role;
select bio as control_bio_should_be_set from public.users where id = :ath;

\echo
\echo '=== E8. Only member of a paid group deletes ==='
select (select count(*) from public.training_groups) as groups_before,
       (select count(*) from public.group_memberships) as memberships_before,
       (select count(*) from public.ledger_entries) as ledger_before;

select pg_temp.act(:ath, array['player']);
select public.delete_my_account() ->> 'status' as e8_status;

select (select count(*) from public.training_groups) as groups_after,
       (select count(*) from public.group_memberships) as memberships_after,
       (select count(*) from public.ledger_entries) as ledger_after,
       (select count(*) from public.ledger_entries where payment_intent_id is null) as orphaned_after;

\echo
\echo '=== E8b. The coach still sees the group and the roster, member is a tombstone ==='
select pg_temp.act(:coa, array['player','coach']);
set role authenticated;
select g.name, gm.status, gm.total, p.name as member
from public.training_groups g
join public.group_memberships gm on gm.group_id = g.id
join public.public_profiles p on p.id = gm.player_id
where g.coach_id = auth.uid();
reset role;

\echo
\echo '=== E8c. E7 re-checked: the now deleted user cannot write ==='
select pg_temp.act(:ath, array['player']);
select public.is_actor_active() as active_after_delete;
set role authenticated;
update public.users set bio = 'I am back' where id = '11111111-1111-1111-1111-111111111111';
reset role;
select bio as bio_should_still_be_null from public.users where id = :ath;

\echo
\echo '=== E12. A DELETED coach vanishes from coach_profiles_public ==='
select count(*) as coach_listed_before from public.coach_profiles_public where user_id = :coa;
update public.users set deleted_at = now() where id = :coa;
select count(*) as coach_listed_after_delete from public.coach_profiles_public where user_id = :coa;
update public.users set deleted_at = null where id = :coa;

\echo
\echo '=== E13. Re registration: the tombstone holds no email, phone or handle ==='
select (select phone from public.users where id = :ath) as phone_freed,
       (select handle from public.users where id = :ath) as handle_freed,
       (select count(*) from public.users where phone is not null and id = :ath) as phone_rows;

\echo
\echo '=== E14. FINAL ledger integrity across every edge case ==='
select entry_group_id,
       sum(amount) filter (where direction='debit') as debits,
       sum(amount) filter (where direction='credit') as credits,
       sum(amount) filter (where direction='debit') = sum(amount) filter (where direction='credit') as balanced
from public.ledger_entries group by entry_group_id order by 1;
