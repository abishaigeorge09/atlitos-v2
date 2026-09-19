-- ATLITOS v2 — 0096_suspend_enforcement_and_kpis.sql
-- Domain: identity/roles (suspension) + admin KPI dashboard.
-- LAUNCH Phase 4, Track B. Requirements: PRD-04 FR-4, FR-5, FR-34, FR-35,
-- FR-36, FR-37, FR-38, FR-53. Contract: docs/phases/PHASE-4-STATUS.md "CT-B"
-- and decision 3 (suspension is three legs) / decision 9 (KPI RPCs).
--
-- ============================================================================
-- PART 1 — suspension: the RPCs + the row-level enforcement leg
-- ============================================================================
--
-- Suspension is three legs total, only two of which are SQL (the third,
-- the GoTrue ban, lives in the new `admin-user-suspend` edge function
-- because SQL cannot reach the auth admin API):
--
--   (a) `admin_suspend_user` / `admin_reinstate_user` below: SECURITY
--       DEFINER, admin-gated, write `users.status` + `suspended_reason`
--       (already columns since 0001; already admin-locked by the 0065
--       trigger) and exactly one `audit_log` row (FR-36/FR-37/FR-53).
--   (b) `public.is_actor_active()`: a STABLE definer helper the restrictive
--       policies below call, so a suspended caller's own next mutating
--       request is refused by the database itself, independent of whether
--       the GoTrue ban or the edge function's suspension check has taken
--       effect yet for that particular request.
--
-- Self-suspension and suspending another admin are both refused
-- (VALIDATION): an admin locking themselves out has no recovery path short
-- of a second admin, and admin-on-admin suspension is a bigger blast radius
-- than this endpoint should carry without a second control.

create function public.admin_suspend_user(p_user_id uuid, p_reason text)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_user public.users;
  v_is_target_admin boolean;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  if p_user_id is null then
    raise exception 'VALIDATION: user_id is required';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'VALIDATION: a reason is required to suspend a user';
  end if;

  if p_user_id = v_actor then
    raise exception 'VALIDATION: an admin cannot suspend their own account';
  end if;

  select exists (
    select 1 from public.user_roles where user_id = p_user_id and role = 'admin'
  ) into v_is_target_admin;

  if v_is_target_admin then
    raise exception 'VALIDATION: cannot suspend another admin account';
  end if;

  select * into v_user from public.users where id = p_user_id for update;

  if v_user.id is null then
    raise exception 'NOT_FOUND: user % does not exist', p_user_id;
  end if;

  if v_user.status = 'suspended' then
    raise exception 'VALIDATION: user % is already suspended', p_user_id;
  end if;

  update public.users
  set status = 'suspended',
      suspended_reason = btrim(p_reason)
  where id = p_user_id
  returning * into v_user;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    v_actor,
    'user.suspend',
    'user',
    p_user_id,
    jsonb_build_object('status', 'active'),
    jsonb_build_object('status', 'suspended', 'suspended_reason', v_user.suspended_reason),
    v_user.suspended_reason
  );

  return v_user;
end;
$$;

create function public.admin_reinstate_user(p_user_id uuid, p_reason text default null)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_user public.users;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  if p_user_id is null then
    raise exception 'VALIDATION: user_id is required';
  end if;

  select * into v_user from public.users where id = p_user_id for update;

  if v_user.id is null then
    raise exception 'NOT_FOUND: user % does not exist', p_user_id;
  end if;

  if v_user.status <> 'suspended' then
    raise exception 'VALIDATION: user % is not suspended', p_user_id;
  end if;

  update public.users
  set status = 'active',
      suspended_reason = null
  where id = p_user_id
  returning * into v_user;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    v_actor,
    'user.reinstate',
    'user',
    p_user_id,
    jsonb_build_object('status', 'suspended'),
    jsonb_build_object('status', 'active'),
    p_reason
  );

  return v_user;
end;
$$;

revoke all on function public.admin_suspend_user(uuid, text) from public;
revoke execute on function public.admin_suspend_user(uuid, text) from anon;
grant execute on function public.admin_suspend_user(uuid, text) to authenticated, service_role;

revoke all on function public.admin_reinstate_user(uuid, text) from public;
revoke execute on function public.admin_reinstate_user(uuid, text) from anon;
grant execute on function public.admin_reinstate_user(uuid, text) to authenticated, service_role;

-- `is_actor_active()`: reads only the caller's own `users` row (already
-- readable under `users_select_own`), so `security definer` here is for
-- consistency with `has_role()` rather than to reach past RLS. Returns
-- TRUE (fail OPEN, never fail closed and brick guests) whenever there is no
-- row to check: a null `auth.uid()` (anon/service context; restrictive
-- policies below only ever target the `authenticated` role so this branch
-- is defensive, not load bearing) or, in principle, a missing `users` row.
create function public.is_actor_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select status <> 'suspended'::public.user_status from public.users where id = (select auth.uid())),
    true
  );
$$;

revoke all on function public.is_actor_active() from public;
grant execute on function public.is_actor_active() to authenticated;

-- ============================================================================
-- Restrictive suspension policies (highest-risk item in this migration,
-- PHASE-4-STATUS.md risk item 2). Derived from the LIVE `pg_policies` set
-- rather than a hand written table list, per decision 3, so the coverage is
-- FR-36's "any mutating action platform wide" and not just the tables this
-- comment happened to remember.
--
-- SAFETY INVARIANT, read this before touching the loop below: the two
-- literal strings this block is allowed to pass to `format()` for a
-- restrictive policy's command are `for insert` / `for update` / `for
-- delete`. There is no code path here that can emit `for select` or
-- `for all` as a RESTRICTIVE policy; a restrictive SELECT or a restrictive
-- FOR ALL policy would blank a suspended (or in a FOR ALL bug, an ACTIVE)
-- user's reads platform wide, which is exactly the incident this migration
-- must not cause (FR-36 blocks MUTATIONS; reads die from the GoTrue ban,
-- not from RLS). The self-check block immediately after the loop asserts
-- this mechanically, not just by comment.
--
-- A table with a `FOR ALL` permissive policy for `authenticated` (example:
-- `product_wishlist_items_write_own`) is treated as though it separately
-- granted INSERT, UPDATE and DELETE, since `pg_policies.cmd = 'ALL'` covers
-- all four commands and a restrictive policy binds to ONE specific command.
--
-- Tables with NO direct `authenticated` INSERT/UPDATE/DELETE policy at all
-- (`clip_likes`, `follows` — both write only through the `toggle_like` /
-- `toggle_follow` SECURITY DEFINER RPCs per 0044, decision 3's explicitly
-- rejected "per-RPC guard" alternative) get no restrictive companion here:
-- there is no permissive grant for one to restrict. Blocking those two RPCs
-- for a suspended user is intentionally out of scope (decision 3); the
-- GoTrue ban still cuts the caller's session eventually via edge fn / token
-- refresh refusal, recorded honestly, not silently patched around here.
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
        raise notice '0096: restrictive INSERT policy % on %', v_policy_name, r.tablename;
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
        raise notice '0096: restrictive UPDATE policy % on %', v_policy_name, r.tablename;
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
        raise notice '0096: restrictive DELETE policy % on %', v_policy_name, r.tablename;
      end if;
    end if;
  end loop;

  raise notice '0096: % tables scanned, % restrictive suspension policies created', v_table_count, v_policy_count;
end
$$;

-- Mechanical proof of the safety invariant above: fails the whole migration
-- (transactional DDL, Supabase migrations run each file in one transaction)
-- if ANY restrictive policy anywhere in `public`, from this block or any
-- earlier one, targets anything other than INSERT/UPDATE/DELETE. A
-- restrictive SELECT or FOR ALL policy is exactly the incident this
-- migration exists to prevent, so this is a hard stop, not a warning.
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
      'SAFETY: % restrictive policy(ies) in public target a command other than INSERT/UPDATE/DELETE; a restrictive SELECT or FOR ALL policy would blank reads platform wide and must never be created by this migration',
      v_bad;
  end if;
end
$$;

-- ============================================================================
-- PART 2 — KPI dashboard (FR-4, FR-5, decision 9)
-- ============================================================================
--
-- Four grouped, admin-guarded SECURITY DEFINER RPCs (not views: the P1
-- `security_definer_view` advisor finding forbids that shape) so FR-5's
-- "a failure to compute one tile does not block the others" holds by
-- construction: `apps/admin`'s dashboard fetches each of the four
-- independently and renders whichever ones succeed. Each returns `jsonb` so
-- new fields can be added later without a function signature migration.
--
-- Window definition: "this week" is read as a rolling 7 days
-- (`created_at >= now() - interval '7 days'`) rather than a calendar week,
-- because a calendar week reset at midnight Monday would make GMV visibly
-- drop to 0 every Monday morning with no incident behind it. Documented
-- here and in RLS.md so a future reader does not "fix" it into a calendar
-- boundary without noticing the tradeoff.
--
-- GMV is gross captured (`payment_intents.status = 'captured'`), refunds
-- NOT netted, per decision 9 — never invented or silently netted, the UI
-- tile is labeled "Gross captured".

create function public.admin_kpi_money()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gmv numeric;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  select coalesce(sum(amount), 0)
  into v_gmv
  from public.payment_intents
  where status = 'captured'
    and created_at >= now() - interval '7 days';

  return jsonb_build_object(
    'gmv_captured_7d', v_gmv,
    'window', '7d',
    'as_of', now()
  );
end;
$$;

create function public.admin_kpi_users()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_by_role jsonb;
  v_total bigint;
  v_signups_7d bigint;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  select coalesce(jsonb_object_agg(role, cnt), '{}'::jsonb)
  into v_by_role
  from (
    select role::text as role, count(*) as cnt
    from public.user_roles
    group by role
  ) t;

  select count(*) into v_total from public.users;

  select count(*) into v_signups_7d
  from public.users
  where created_at >= now() - interval '7 days';

  return jsonb_build_object(
    'total_users', v_total,
    'by_role', v_by_role,
    'signups_7d', v_signups_7d,
    'window', '7d',
    'as_of', now()
  );
end;
$$;

create function public.admin_kpi_queues()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pending_refunds bigint;
  v_pending_verifications bigint;
  v_pending_reports bigint;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  select count(*) into v_pending_refunds from public.refunds where status = 'pending';
  select count(*) into v_pending_verifications from public.verification_requests where status = 'pending_review';
  select count(*) into v_pending_reports from public.reports where status = 'pending';

  return jsonb_build_object(
    'pending_refunds', v_pending_refunds,
    'pending_verifications', v_pending_verifications,
    'pending_reports', v_pending_reports,
    'as_of', now()
  );
end;
$$;

create function public.admin_kpi_activity()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_court_bookings_7d bigint;
  v_sessions_7d bigint;
  v_orders_7d bigint;
  v_open_tickets bigint;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  select count(*) into v_court_bookings_7d
  from public.court_bookings
  where created_at >= now() - interval '7 days';

  select count(*) into v_sessions_7d
  from public.sessions
  where created_at >= now() - interval '7 days';

  select count(*) into v_orders_7d
  from public.orders
  where created_at >= now() - interval '7 days';

  select count(*) into v_open_tickets
  from public.support_tickets
  where status = 'open';

  return jsonb_build_object(
    'bookings_7d', v_court_bookings_7d + v_sessions_7d,
    'court_bookings_7d', v_court_bookings_7d,
    'sessions_7d', v_sessions_7d,
    'orders_7d', v_orders_7d,
    'open_support_tickets', v_open_tickets,
    'window', '7d',
    'as_of', now()
  );
end;
$$;

revoke all on function public.admin_kpi_money() from public;
revoke execute on function public.admin_kpi_money() from anon;
grant execute on function public.admin_kpi_money() to authenticated;

revoke all on function public.admin_kpi_users() from public;
revoke execute on function public.admin_kpi_users() from anon;
grant execute on function public.admin_kpi_users() to authenticated;

revoke all on function public.admin_kpi_queues() from public;
revoke execute on function public.admin_kpi_queues() from anon;
grant execute on function public.admin_kpi_queues() to authenticated;

revoke all on function public.admin_kpi_activity() from public;
revoke execute on function public.admin_kpi_activity() from anon;
grant execute on function public.admin_kpi_activity() to authenticated;
