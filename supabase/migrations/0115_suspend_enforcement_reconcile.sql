-- ATLITOS v2 - 0115_suspend_enforcement_reconcile.sql
-- Domain: security. Re-runs 0096's suspend enforcement generator.
--
-- ============================================================================
-- WHY THIS EXISTS: 0096 IS ORDER DEPENDENT AND NOTHING NOTICED FOR A WEEK.
-- ============================================================================
--
-- 0096 does not declare its restrictive policies. It GENERATES them, by
-- looping over `pg_policies` and adding an `<table>_active_insert` /
-- `_active_update` / `_active_delete` companion to every table that has a
-- permissive `authenticated` write policy AT THE MOMENT IT RUNS. That makes
-- the set of guards a function of migration ORDER, not of the schema, and a
-- table whose write policies land after 0096 silently gets no guard at all.
--
-- That is not hypothetical. Measured 2026-08-14, read only, both sides:
--
--   PRODUCTION syzzfgaudpifwvbpycyi   258 policies in public, 0 unguarded
--   FRESH DATABASE from these files   256 policies in public, 1 unguarded
--                                     -> blocked_users, INSERT and DELETE
--
-- Production is guarded and a clean checkout is NOT, which is the opposite of
-- the direction drift usually runs. The cause is that production's migration
-- history is timestamp versioned by application time, not by these file
-- numbers, and the two files were applied out of order:
--
--   20260807043523  0097_report_block                 <- creates blocked_users
--   20260807044458  0096_suspend_enforcement_and_kpis <- the generator
--
-- So production's generator saw `blocked_users` and covered it. In file order
-- 0096 runs first, sees nothing, and covers nothing. Every environment built
-- from this repo (disaster recovery, a preview branch, the CI database, and
-- any future project) therefore lets a SUSPENDED user block and unblock other
-- users, while production does not.
--
-- The blast radius today is one table and blocking is not a dangerous
-- capability, so this is not a production incident. The CLASS is the problem:
-- every table added after 0096 inherits the same silence, and the failure mode
-- is an absent policy, which passes every check that looks at what IS there.
--
-- ============================================================================
-- WHAT THIS DOES
-- ============================================================================
--
-- Re-runs the same generator, unchanged and idempotent. On production it is a
-- no-op (0 created, already verified above). On a fresh database it closes the
-- two missing `blocked_users` guards and any later ones. It is deliberately a
-- straight re-run rather than a hand written pair of `create policy` statements
-- for `blocked_users`: naming the one known instance would fix the instance and
-- leave the class, and the class is what bit here.
--
-- The permanent fix is not this migration, it is the `suspend-enforcement`
-- check added to scripts/security-invariants.sh in the same change, which
-- fails the build when any writable table lacks its guard. A migration can
-- only reconcile the past; the check is what stops the next one. Note that
-- check could never have run before this week, because it needs a database and
-- until Docker came back there was no database to point it at other than
-- production.

do $$
declare
  r record;
  v_policy_name text;
  v_table_count int := 0;
  v_policy_count int := 0;
begin
  for r in
    select tablename,
           bool_or(cmd in ('INSERT', 'ALL')) as has_insert,
           bool_or(cmd in ('UPDATE', 'ALL')) as has_update,
           bool_or(cmd in ('DELETE', 'ALL')) as has_delete
    from pg_policies
    where schemaname = 'public'
      and permissive = 'PERMISSIVE'
      and 'authenticated' = any (roles::text[])
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    group by tablename
  loop
    v_table_count := v_table_count + 1;

    if r.has_insert then
      v_policy_name := r.tablename || '_active_insert';
      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = r.tablename and policyname = v_policy_name
      ) then
        execute format(
          'create policy %I on public.%I as restrictive for insert to authenticated with check (public.is_actor_active())',
          v_policy_name, r.tablename
        );
        v_policy_count := v_policy_count + 1;
        raise notice '0115: restrictive INSERT policy % on %', v_policy_name, r.tablename;
      end if;
    end if;

    if r.has_update then
      v_policy_name := r.tablename || '_active_update';
      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = r.tablename and policyname = v_policy_name
      ) then
        execute format(
          'create policy %I on public.%I as restrictive for update to authenticated using (public.is_actor_active()) with check (public.is_actor_active())',
          v_policy_name, r.tablename
        );
        v_policy_count := v_policy_count + 1;
        raise notice '0115: restrictive UPDATE policy % on %', v_policy_name, r.tablename;
      end if;
    end if;

    if r.has_delete then
      v_policy_name := r.tablename || '_active_delete';
      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = r.tablename and policyname = v_policy_name
      ) then
        execute format(
          'create policy %I on public.%I as restrictive for delete to authenticated using (public.is_actor_active())',
          v_policy_name, r.tablename
        );
        v_policy_count := v_policy_count + 1;
        raise notice '0115: restrictive DELETE policy % on %', v_policy_name, r.tablename;
      end if;
    end if;
  end loop;

  raise notice '0115: % tables scanned, % missing suspension policies reconciled', v_table_count, v_policy_count;
end
$$;

-- Same hard stop 0096 carries. A restrictive SELECT or FOR ALL policy would
-- blank reads platform wide, so it fails the migration rather than warning.
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from pg_policies
  where schemaname = 'public'
    and permissive = 'RESTRICTIVE'
    and cmd not in ('INSERT', 'UPDATE', 'DELETE');

  if v_bad > 0 then
    raise exception
      'SAFETY: % restrictive policy(ies) in public target a command other than INSERT/UPDATE/DELETE',
      v_bad;
  end if;
end
$$;

-- And prove this file actually achieved its own purpose, in the same
-- transaction, rather than trusting the loop above. Zero unguarded writable
-- tables must remain. This is the assertion 0096 never made about itself.
do $$
declare
  v_unguarded text;
begin
  with writable as (
    select tablename,
           bool_or(cmd in ('INSERT', 'ALL')) as has_insert,
           bool_or(cmd in ('UPDATE', 'ALL')) as has_update,
           bool_or(cmd in ('DELETE', 'ALL')) as has_delete
    from pg_policies
    where schemaname = 'public'
      and permissive = 'PERMISSIVE'
      and 'authenticated' = any (roles::text[])
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    group by tablename
  )
  select string_agg(w.tablename, ', ' order by w.tablename) into v_unguarded
  from writable w
  where (w.has_insert and not exists (
          select 1 from pg_policies p where p.schemaname = 'public'
            and p.tablename = w.tablename and p.policyname = w.tablename || '_active_insert'))
     or (w.has_update and not exists (
          select 1 from pg_policies p where p.schemaname = 'public'
            and p.tablename = w.tablename and p.policyname = w.tablename || '_active_update'))
     or (w.has_delete and not exists (
          select 1 from pg_policies p where p.schemaname = 'public'
            and p.tablename = w.tablename and p.policyname = w.tablename || '_active_delete'));

  if v_unguarded is not null then
    raise exception
      'SUSPEND ENFORCEMENT: table(s) % still have a permissive authenticated write policy with no is_actor_active() companion',
      v_unguarded;
  end if;
end
$$;
