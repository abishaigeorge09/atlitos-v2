-- 0142: delete_my_account() masks the caller's payout details, keeps the
-- rows the retained transfer history hangs off, deletes the caller's
-- venue_photos rows, and touches nobody else's.
-- Run against a FRESH rebuild + fixture (no prior deletion). Every check
-- prints PASS or FAIL, and the final block raises if any check failed.
\pset format aligned
\set coa '''22222222-2222-2222-2222-222222222222'''
\set par '''33333333-3333-3333-3333-333333333333'''
\set ctl '''66666666-6666-6666-6666-666666666666'''
\set par_venue '''b1000000-0000-0000-0000-000000000001'''
\set ctl_venue '''b1000000-0000-0000-0000-000000000002'''

create or replace function pg_temp.act(p_uid uuid, p_roles text[])
returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
      'app_metadata', json_build_object('roles', to_json(p_roles)))::text, false);
  select null::void;
$$;

create temp table checks (name text primary key, ok boolean not null);

-- ---------------------------------------------------------------------------
-- Setup, as the migration owner.
-- ---------------------------------------------------------------------------
-- The fixture gives the partner a FUTURE confirmed booking, which blocks
-- deletion (E3). Move it into the past so the partner can delete.
update public.court_bookings set date = current_date - 3
 where id = 'e1000000-0000-0000-0000-000000000002';

-- A second, unrelated court partner whose payout details must survive.
insert into auth.users (id, email, raw_user_meta_data)
values (:ctl, 'control@example.test', '{"name":"Control Partner"}');
insert into public.user_roles (user_id, role) values (:ctl, 'court_partner');
insert into public.venues (id, partner_user_id, name, address, city, pincode, status)
values (:ctl_venue, :ctl, 'Turf Two', '9 Lake Rd', 'Hyderabad', '500002', 'verified');

insert into public.venue_photos (venue_id, storage_path, position) values
  (:par_venue, 'b1000000-0000-0000-0000-000000000001/front.jpg', 0),
  (:par_venue, 'b1000000-0000-0000-0000-000000000001/court.jpg', 1),
  (:ctl_venue, 'b1000000-0000-0000-0000-000000000002/front.jpg', 0);

-- Coach: verified bank account with a PAN, and a paid manual transfer.
insert into public.payout_accounts (id, owner_type, owner_id, status)
values ('a7000000-0000-0000-0000-000000000001', 'coach', :coa, 'active');
insert into public.payout_methods (payout_account_id, method_type, account_holder_name,
                                   account_number, ifsc, pan, verification_status, verified_at)
values ('a7000000-0000-0000-0000-000000000001', 'bank_account', 'Vikram Rao',
        '123456789012', 'HDFC0001234', 'ABCDE1234F', 'verified', now());
insert into public.transfers (payout_account_id, amount, status, ledger_entry_group_id, method, external_reference)
values ('a7000000-0000-0000-0000-000000000001', 500, 'paid', gen_random_uuid(), 'manual', 'UTR0000001');

-- Partner: verified UPI on the venue's payout account.
insert into public.payout_accounts (id, owner_type, owner_id, status)
values ('a7000000-0000-0000-0000-000000000002', 'court_partner', :par_venue, 'active');
insert into public.payout_methods (payout_account_id, method_type, account_holder_name, vpa, verification_status)
values ('a7000000-0000-0000-0000-000000000002', 'upi', 'Anand Kumar', 'anand.k@okicici', 'verified');

-- Control partner: must be untouched.
insert into public.payout_accounts (id, owner_type, owner_id, status)
values ('a7000000-0000-0000-0000-000000000003', 'court_partner', :ctl_venue, 'active');
insert into public.payout_methods (payout_account_id, method_type, account_holder_name,
                                   account_number, ifsc, pan, verification_status)
values ('a7000000-0000-0000-0000-000000000003', 'bank_account', 'Control Partner',
        '998877665544', 'ICIC0005678', 'ZZZZZ9999Z', 'verified');

-- Isolation is only meaningful if the parties really differ (CLAUDE.md, AT-62).
insert into checks values ('isolation: control partner differs from coach and partner',
  (select :ctl::uuid <> :coa::uuid and :ctl::uuid <> :par::uuid
      and (select partner_user_id from public.venues where id = :ctl_venue) <> :par::uuid));

create temp table before_counts as
select (select count(*) from public.payout_methods) as methods,
       (select count(*) from public.payout_accounts) as accounts,
       (select count(*) from public.transfers) as transfers,
       (select string_agg(id || ':' || status, ',' order by id) from public.payout_accounts) as account_states;

-- ---------------------------------------------------------------------------
-- The deletions, each as its own caller.
-- ---------------------------------------------------------------------------
select pg_temp.act(:coa, array['player','coach']);
select public.delete_my_account() ->> 'status' as coach_delete_status;

select pg_temp.act(:par, array['player','court_partner']);
select public.delete_my_account() ->> 'status' as partner_delete_status;

reset request.jwt.claims;

\echo '=== Masked payout methods ==='
select pa.owner_type, pm.method_type, pm.account_holder_name, pm.account_number, pm.ifsc,
       pm.vpa, pm.pan, pm.verification_status, pm.verified_at
  from public.payout_methods pm join public.payout_accounts pa on pa.id = pm.payout_account_id
 order by pa.id;

insert into checks
select 'coach bank account masked to last four, IFSC kept, PAN and name gone',
       account_number = 'XXXXXXXX9012' and ifsc = 'HDFC0001234' and pan is null
       and account_holder_name = 'Deleted user' and verification_status = 'rejected'
       and verified_at is null and verified_by is null
  from public.payout_methods where payout_account_id = 'a7000000-0000-0000-0000-000000000001';

insert into checks
select 'partner UPI masked to XXXX@psp, name gone, not verified',
       vpa = 'XXXX@okicici' and account_number is null and account_holder_name = 'Deleted user'
       and verification_status = 'rejected'
  from public.payout_methods where payout_account_id = 'a7000000-0000-0000-0000-000000000002';

insert into checks
select 'control partner payout method untouched',
       account_number = '998877665544' and pan = 'ZZZZZ9999Z'
       and account_holder_name = 'Control Partner' and verification_status = 'verified'
  from public.payout_methods where payout_account_id = 'a7000000-0000-0000-0000-000000000003';

insert into checks
select 'payout_methods, payout_accounts and transfers rows retained, account status unchanged',
       b.methods = (select count(*) from public.payout_methods)
       and b.accounts = (select count(*) from public.payout_accounts)
       and b.transfers = (select count(*) from public.transfers)
       and b.account_states = (select string_agg(id || ':' || status, ',' order by id) from public.payout_accounts)
  from before_counts b;

insert into checks
select 'deleting partner venue_photos rows removed, control venue photo kept',
       (select count(*) from public.venue_photos where venue_id = :par_venue) = 0
       and (select count(*) from public.venue_photos where venue_id = :ctl_venue) = 1;

insert into checks
select 'account.deleted audit rows carry a masked COUNT, never the details',
       coalesce((select (after ->> 'payout_methods_masked')::int from public.audit_log
         where action = 'account.deleted' and entity_id = :coa) = 1
       and (select (after ->> 'payout_methods_masked')::int from public.audit_log
         where action = 'account.deleted' and entity_id = :par) = 1
       and not exists (
         select 1 from public.audit_log
          where coalesce(after::text, '') || coalesce(before::text, '') || coalesce(note, '')
                ~ '(123456789012|ABCDE1234F|anand\.k|Vikram Rao|Anand Kumar)'), false);

insert into checks
select 'a masked payout method cannot receive a manual payout',
       not exists (select 1 from public.payout_methods
                    where payout_account_id in ('a7000000-0000-0000-0000-000000000001',
                                                'a7000000-0000-0000-0000-000000000002')
                      and verification_status = 'verified');

-- Idempotent: a retry returns the receipt and changes nothing.
select pg_temp.act(:coa, array[]::text[]);
insert into checks
select 'retry returns already_deleted and leaves the mask as is',
       public.delete_my_account() ->> 'status' = 'already_deleted'
       and (select account_number from public.payout_methods
             where payout_account_id = 'a7000000-0000-0000-0000-000000000001') = 'XXXXXXXX9012';
reset request.jwt.claims;

\echo '=== Results ==='
select case when ok then 'PASS' else 'FAIL' end as result, name from checks order by name;

do $$
begin
  if exists (select 1 from checks where not ok) or (select count(*) from checks) <> 9 then
    raise exception '07-payout-method-scrub: % of 9 checks passed',
      (select count(*) from checks where ok);
  end if;
  raise notice '07-payout-method-scrub: all 9 checks passed';
end;
$$;
