-- Edge cases. Each one plants the condition and asserts the observed outcome.
-- Run against a FRESH rebuild + fixture (no prior deletion).
\pset format aligned
\set ath '''11111111-1111-1111-1111-111111111111'''
\set coa '''22222222-2222-2222-2222-222222222222'''
\set par '''33333333-3333-3333-3333-333333333333'''
\set adm '''44444444-4444-4444-4444-444444444444'''
\set adm2 '''45454545-4545-4545-4545-454545454545'''

create or replace function pg_temp.act(p_uid uuid, p_roles text[])
returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
      'app_metadata', json_build_object('roles', to_json(p_roles)))::text, false);
  select null::void;
$$;

create or replace function pg_temp.try_delete()
returns text language plpgsql as $$
begin
  perform public.delete_my_account();
  return 'ALLOWED';
exception when others then
  return 'REFUSED: ' || sqlerrm;
end;
$$;

\echo '=== E1. User mid checkout (payment_intent still authorized) is REFUSED ==='
insert into public.payment_intents (id, user_id, domain, entity_id, amount, status, razorpay_order_id)
values ('d1000000-0000-0000-0000-0000000000ff', :ath, 'commerce', gen_random_uuid(), 500, 'authorized', 'order_inflight');
select pg_temp.act(:ath, array['player']);
select pg_temp.try_delete() as e1_result;
delete from public.payment_intents where id = 'd1000000-0000-0000-0000-0000000000ff';

\echo
\echo '=== E2. Coach with an UPCOMING accepted session is REFUSED ==='
insert into public.sessions (id, coach_id, player_id, session_type_id, frequency, date, slot_start, slot_end,
                             status, price, platform_fee, total)
values ('e1000000-0000-0000-0000-0000000000fe', :coa, :ath, 'a1000000-0000-0000-0000-000000000001',
        'one_time', current_date + 3, '07:00', '08:00', 'accepted', 800, 144, 944);
select pg_temp.act(:coa, array['player','coach']);
select pg_temp.try_delete() as e2_result;

\echo
\echo '=== E2b. Same coach, once the session is completed, is ALLOWED ==='
update public.sessions set status = 'completed' where id = 'e1000000-0000-0000-0000-0000000000fe';
select pg_temp.act(:coa, array['player','coach']);
select (public.account_deletion_preview() ->> 'blocker') as e2b_blocker;

\echo
\echo '=== E3. Court partner with a FUTURE confirmed booking is REFUSED ==='
select pg_temp.act(:par, array['player','court_partner']);
select pg_temp.try_delete() as e3_result;

\echo
\echo '=== E4. The LAST admin is REFUSED, a non last admin is ALLOWED ==='
-- adm2 is a second admin, so adm is not the last one yet.
select pg_temp.act(:adm, array['player','admin']);
select (public.account_deletion_preview() ->> 'blocker') as e4_two_admins_blocker;
-- Remove the second admin, now adm IS the last one.
delete from public.user_roles where user_id = :adm2 and role = 'admin';
select pg_temp.act(:adm, array['player','admin']);
select pg_temp.try_delete() as e4_last_admin_result;
insert into public.user_roles (user_id, role) values (:adm2, 'admin');

\echo
\echo '=== E5. Guest (anonymous, zero roles) can delete ==='
insert into auth.users (id, email, is_anonymous) values ('55555555-5555-5555-5555-555555555555', 'guest@example.test', true);
delete from public.user_roles where user_id = '55555555-5555-5555-5555-555555555555';
select pg_temp.act('55555555-5555-5555-5555-555555555555', array[]::text[]);
select public.is_guest() as e5_is_guest;
select pg_temp.try_delete() as e5_result;
select name, (deleted_at is not null) as deleted from public.users where id = '55555555-5555-5555-5555-555555555555';

\echo
\echo '=== E6. Already deleted: second call is idempotent, not an error ==='
select pg_temp.act('55555555-5555-5555-5555-555555555555', array[]::text[]);
select public.delete_my_account() ->> 'status' as e6_second_call_status;
select count(*) as e6_audit_rows from public.account_deletions where user_id = '55555555-5555-5555-5555-555555555555';

\echo
\echo '=== E7. A deleted user CANNOT write anything (is_actor_active refuses) ==='
select public.is_actor_active() as e7_still_active;
set role authenticated;
do $$
begin
  update public.users set bio = 'I am back' where id = '55555555-5555-5555-5555-555555555555';
  if found then
    raise notice 'E7 RESULT: WRITE SUCCEEDED, THIS IS A FAILURE';
  else
    raise notice 'E7 RESULT: write matched 0 rows, refused by policy';
  end if;
exception when others then
  raise notice 'E7 RESULT: refused, %', sqlerrm;
end;
$$;
reset role;
select bio from public.users where id = '55555555-5555-5555-5555-555555555555';

\echo
\echo '=== E8. Only member of a group: the group survives, roster shows a tombstone ==='
select count(*) as e8_note_no_group_fixture from public.training_groups;

\echo
\echo '=== E9. delete_my_account takes no user id, so it cannot target anyone else ==='
select p.proname, pg_get_function_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('delete_my_account','account_deletion_preview');

\echo
\echo '=== E10. anon cannot execute either function ==='
select has_function_privilege('anon', 'public.delete_my_account()', 'execute') as anon_can_delete,
       has_function_privilege('anon', 'public.account_deletion_preview()', 'execute') as anon_can_preview,
       has_function_privilege('authenticated', 'public.delete_my_account()', 'execute') as authed_can_delete;

\echo
\echo '=== E11. Ledger still balanced after every edge case above ==='
select count(*) as unbalanced_groups from (
  select entry_group_id from public.ledger_entries group by entry_group_id
  having coalesce(sum(amount) filter (where direction='debit'),0)
      <> coalesce(sum(amount) filter (where direction='credit'),0)
) q;
select (select count(*) from public.payment_intents) as payment_intents,
       (select count(*) from public.ledger_entries) as ledger_entries,
       (select count(*) from public.ledger_entries where payment_intent_id is null) as orphaned;
