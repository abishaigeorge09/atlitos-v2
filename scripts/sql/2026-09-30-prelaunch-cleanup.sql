-- ATLITOS: pre launch production clean up (launch runbook 6.3).
--
-- NOT A MIGRATION. A one off data fix, written by DEV, READ by a founder,
-- then run by that founder in the Supabase SQL editor for project
-- syzzfgaudpifwvbpycyi. Agents never run this (CLAUDE.md, DEBT.md 2026-08-11).
--
-- What it does, in one transaction:
--   1. Delists the seed affiliate products (active = false). No row is
--      deleted, so affiliate_clicks that point at them keep their target.
--   2. Hides the chat threads whose training group no longer exists: removes
--      their chat_thread_members rows so they drop out of every thread list.
--      The chat_threads row and every chat_messages row are KEPT.
--   3. Removes fixture accounts and fixture venues, but ONLY those with no
--      money attached. Every foreign key into public.users and auth.users is
--      counted from the live catalog (pg_constraint), not from a list typed
--      here, so a table added later is not missed. The 2026-08-11 incident
--      (DEBT.md) orphaned 57 payment_intents by deleting the rows they
--      pointed at; this script refuses to touch any account or venue that a
--      payment_intents, ledger, refund, transfer or payout row references.
--      Those are listed in the output for a person to decide.
--
-- HOW TO RUN
--   a. Run PART 0 on its own first. It only reads. Check the numbers against
--      the runbook (38 orphaned group threads) and read the candidate lists.
--   b. If anything in the candidate lists is a real person or a real venue,
--      add its id to the KEEP lists at the top of PART 1 and rerun PART 0.
--   c. Run PART 1. It ends with ROLLBACK, so the first run is a dry run: read
--      the NOTICE output and the verification selects.
--   d. When the dry run is right, change the final ROLLBACK to COMMIT and run
--      PART 1 again.

-- ===========================================================================
-- PART 0. Preview (read only)
-- ===========================================================================

-- 0.1 Seed affiliate products still listed.
select id, title, active
  from public.affiliate_products
 where active
   and (id::text like 'a0000000-0000-0000-0000-%' or title ilike 'Seed Shop %')
 order by title;

-- 0.2 Group threads whose group is gone. Runbook expects 38.
select count(*) as orphaned_group_threads,
       (select count(*) from public.chat_thread_members m
         where m.thread_id in (
           select t.id from public.chat_threads t
            where t.context_type = 'group'
              and not exists (select 1 from public.training_groups g where g.id = t.context_id)
         )) as member_rows_to_remove
  from public.chat_threads t
 where t.context_type = 'group'
   and not exists (select 1 from public.training_groups g where g.id = t.context_id);

-- 0.3 Fixture account candidates. Seed and e2e addresses only.
select u.id, u.email, pu.name, u.created_at
  from auth.users u
  left join public.users pu on pu.id = u.id
 where u.email ilike '%@atlitos.dev'
    or u.email ilike 'e2e.%'
    or u.email ilike '%@example.com'
 order by u.created_at;

-- 0.4 Fixture venue candidates.
select v.id, v.name, v.city, v.status, v.partner_user_id
  from public.venues v
  left join auth.users u on u.id = v.partner_user_id
 where v.name = 'Onboarding Demo Turf'
    or u.email ilike '%@atlitos.dev'
    or u.email ilike 'e2e.%'
 order by v.name;

-- ===========================================================================
-- PART 1. The clean up (one transaction; dry run until ROLLBACK is changed)
-- ===========================================================================

begin;

-- Ids a person has decided to keep even though they match a fixture pattern.
create temp table keep_user_ids (id uuid primary key) on commit drop;
create temp table keep_venue_ids (id uuid primary key) on commit drop;
-- insert into keep_user_ids values ('00000000-0000-0000-0000-000000000000');
-- insert into keep_venue_ids values ('00000000-0000-0000-0000-000000000000');

-- ---------------------------------------------------------------------------
-- 1. Delist seed affiliate products
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  update public.affiliate_products
     set active = false, updated_at = now()
   where active
     and (id::text like 'a0000000-0000-0000-0000-%' or title ilike 'Seed Shop %');
  get diagnostics n = row_count;
  raise notice '1. seed affiliate products delisted: %', n;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Hide orphaned group threads (messages kept)
-- ---------------------------------------------------------------------------
do $$
declare
  n_threads int;
  n_members int;
begin
  select count(*) into n_threads
    from public.chat_threads t
   where t.context_type = 'group'
     and not exists (select 1 from public.training_groups g where g.id = t.context_id);

  -- The runbook counted 38 on 2026-09-29. A very different number means the
  -- data moved since the audit; stop and look rather than guess.
  if n_threads > 60 then
    raise exception 'expected about 38 orphaned group threads, found %. Stop and review.', n_threads;
  end if;

  delete from public.chat_thread_members m
   where m.thread_id in (
     select t.id from public.chat_threads t
      where t.context_type = 'group'
        and not exists (select 1 from public.training_groups g where g.id = t.context_id)
   );
  get diagnostics n_members = row_count;
  raise notice '2. orphaned group threads: %, member rows removed: % (threads and messages kept)', n_threads, n_members;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Fixture accounts and venues, money free only
-- ---------------------------------------------------------------------------
create temp table fixture_users on commit drop as
select u.id, u.email
  from auth.users u
 where (u.email ilike '%@atlitos.dev' or u.email ilike 'e2e.%' or u.email ilike '%@example.com')
   and u.id not in (select id from keep_user_ids)
   -- Never an admin, whatever the address says.
   and not exists (select 1 from public.user_roles r where r.user_id = u.id and r.role = 'admin');

create temp table fixture_venues on commit drop as
select v.id, v.name
  from public.venues v
 where (v.name = 'Onboarding Demo Turf' or v.partner_user_id in (select id from fixture_users))
   and v.id not in (select id from keep_venue_ids);

-- Every row referencing each candidate, counted per table from the catalog.
create temp table user_refs (user_id uuid, ref_table text, n bigint) on commit drop;
create temp table venue_refs (venue_id uuid, ref_table text, n bigint) on commit drop;

do $$
declare
  fk record;
begin
  -- Names are built schema qualified from pg_class and pg_namespace, never
  -- from regclass::text, which drops the schema for anything on the
  -- search_path and would make every money table comparison below miss.
  for fk in
    select format('%I.%I', sn.nspname, sc.relname) as tbl,
           a.attname as col,
           format('%I.%I', tn.nspname, tc.relname) as target
      from pg_constraint c
      join pg_class sc on sc.oid = c.conrelid
      join pg_namespace sn on sn.oid = sc.relnamespace
      join pg_class tc on tc.oid = c.confrelid
      join pg_namespace tn on tn.oid = tc.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and array_length(c.conkey, 1) = 1
       and c.confrelid in ('public.users'::regclass, 'auth.users'::regclass, 'public.venues'::regclass)
       and c.conrelid <> 'public.users'::regclass
  loop
    if fk.target = 'public.venues' then
      execute format(
        'insert into venue_refs select %1$I, %2$L, count(*) from %3$s where %1$I in (select id from fixture_venues) group by %1$I',
        fk.col, fk.tbl, fk.tbl);
    else
      execute format(
        'insert into user_refs select %1$I, %2$L, count(*) from %3$s where %1$I in (select id from fixture_users) group by %1$I',
        fk.col, fk.tbl, fk.tbl);
    end if;
  end loop;
end $$;

-- ledger_entries.account_ref is not a foreign key but it IS money.
insert into user_refs
select le.account_ref, 'public.ledger_entries(account_ref)', count(*)
  from public.ledger_entries le
 where le.account_ref in (select id from fixture_users)
 group by le.account_ref;
insert into venue_refs
select le.account_ref, 'public.ledger_entries(account_ref)', count(*)
  from public.ledger_entries le
 where le.account_ref in (select id from fixture_venues)
 group by le.account_ref;

-- Money tables. Any reference from one of these keeps the row.
create temp table money_tables (name text primary key) on commit drop;
insert into money_tables values
  ('public.payment_intents'), ('public.ledger_entries(account_ref)'), ('public.refunds'),
  ('public.transfers'), ('public.payout_accounts'), ('public.payout_methods'),
  ('public.orders'), ('public.donations'), ('public.court_bookings'), ('public.sessions'),
  ('public.group_memberships');

-- Self check: every money table name above must be a real table, or the
-- comparison silently matches nothing (the bug the first dry run caught).
do $$
declare missing text;
begin
  select string_agg(name, ', ') into missing
    from money_tables
   where name not like '%(%'
     and to_regclass(name) is null;
  if missing is not null then
    raise exception 'money table names do not resolve: %', missing;
  end if;
end $$;

-- A court_booking or session can reach money through its own intent, so a
-- venue with any booking is treated as money attached.
create temp table blocked_users on commit drop as
select distinct user_id as id from user_refs where ref_table in (select name from money_tables);
create temp table blocked_venues on commit drop as
select distinct venue_id as id from venue_refs where ref_table in (select name from money_tables)
union
select v.id from fixture_venues v
 where exists (select 1 from public.courts c join public.court_bookings b on b.court_id = c.id where c.venue_id = v.id);

do $$
declare r record;
begin
  for r in
    select f.email, string_agg(ur.ref_table || '=' || ur.n, ', ') as refs
      from fixture_users f
      join user_refs ur on ur.user_id = f.id and ur.ref_table in (select name from money_tables)
     group by f.email
  loop
    raise notice '3. KEPT (money attached, decide by hand): % [%]', r.email, r.refs;
  end loop;
  for r in select v.name, v.id from fixture_venues v where v.id in (select id from blocked_venues) loop
    raise notice '3. KEPT venue (bookings or money attached): % %', r.name, r.id;
  end loop;
end $$;

-- Venues first (their partner may be a fixture user). A kept venue with
-- bookings is hidden from browse instead: status rejected is excluded from
-- every public read (courts browse filters venues.status = verified).
do $$
declare n_del int; n_hidden int;
begin
  update public.venues set status = 'rejected'
   where id in (select id from fixture_venues)
     and id in (select id from blocked_venues)
     and status <> 'rejected';
  get diagnostics n_hidden = row_count;

  delete from public.venues
   where id in (select id from fixture_venues)
     and id not in (select id from blocked_venues);
  get diagnostics n_del = row_count;
  raise notice '3. fixture venues deleted: %, hidden (status rejected): %', n_del, n_hidden;
end $$;

-- Accounts: through auth.users, which cascades to public.users. Never a raw
-- delete on public.users.
do $$
declare n int;
begin
  delete from auth.users
   where id in (select id from fixture_users)
     and id not in (select id from blocked_users)
     -- A partner whose venue was kept must stay, or the venue loses its owner.
     and id not in (select v.partner_user_id from public.venues v);
  get diagnostics n = row_count;
  raise notice '3. fixture accounts deleted: %', n;
end $$;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- Ledger still balances (the same check the 2026-08-11 incident used).
select sum(case when direction = 'debit' then amount else 0 end) as debits,
       sum(case when direction = 'credit' then amount else 0 end) as credits
  from public.ledger_entries;

-- No payment intent lost its user.
select count(*) as intents_without_user
  from public.payment_intents pi
 where pi.user_id is not null
   and not exists (select 1 from public.users u where u.id = pi.user_id);

-- Nothing seed shaped is still listed.
select count(*) as seed_products_still_active
  from public.affiliate_products
 where active and (id::text like 'a0000000-0000-0000-0000-%' or title ilike 'Seed Shop %');

-- Dry run by default. Change to COMMIT only after reading the output above.
rollback;
