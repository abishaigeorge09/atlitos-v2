-- 0096_suspend_enforcement_and_kpis: admin suspend/reinstate + is_actor_active + platform-wide restrictive INSERT/UPDATE/DELETE-only suspension policies (self-check raises on any restrictive SELECT/ALL) + 4 admin KPI RPCs. Proven on prod rolled-back: active writes, suspended refused, reinstate restores, no restrictive read policy.
create function public.admin_suspend_user(p_user_id uuid, p_reason text) returns public.users language plpgsql security definer set search_path = public as $$
declare v_actor uuid := (select auth.uid()); v_user public.users; v_is_target_admin boolean;
begin
  if not public.has_role('admin') then raise exception 'FORBIDDEN: admin role required'; end if;
  if p_user_id is null then raise exception 'VALIDATION: user_id is required'; end if;
  if p_reason is null or btrim(p_reason)='' then raise exception 'VALIDATION: a reason is required to suspend a user'; end if;
  if p_user_id=v_actor then raise exception 'VALIDATION: an admin cannot suspend their own account'; end if;
  select exists(select 1 from public.user_roles where user_id=p_user_id and role='admin') into v_is_target_admin;
  if v_is_target_admin then raise exception 'VALIDATION: cannot suspend another admin account'; end if;
  select * into v_user from public.users where id=p_user_id for update;
  if v_user.id is null then raise exception 'NOT_FOUND: user % does not exist', p_user_id; end if;
  if v_user.status='suspended' then raise exception 'VALIDATION: user % is already suspended', p_user_id; end if;
  update public.users set status='suspended', suspended_reason=btrim(p_reason) where id=p_user_id returning * into v_user;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,before,after,note) values (v_actor,'user.suspend','user',p_user_id,jsonb_build_object('status','active'),jsonb_build_object('status','suspended','suspended_reason',v_user.suspended_reason),v_user.suspended_reason);
  return v_user; end; $$;
create function public.admin_reinstate_user(p_user_id uuid, p_reason text default null) returns public.users language plpgsql security definer set search_path = public as $$
declare v_actor uuid := (select auth.uid()); v_user public.users;
begin
  if not public.has_role('admin') then raise exception 'FORBIDDEN: admin role required'; end if;
  if p_user_id is null then raise exception 'VALIDATION: user_id is required'; end if;
  select * into v_user from public.users where id=p_user_id for update;
  if v_user.id is null then raise exception 'NOT_FOUND: user % does not exist', p_user_id; end if;
  if v_user.status<>'suspended' then raise exception 'VALIDATION: user % is not suspended', p_user_id; end if;
  update public.users set status='active', suspended_reason=null where id=p_user_id returning * into v_user;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,before,after,note) values (v_actor,'user.reinstate','user',p_user_id,jsonb_build_object('status','suspended'),jsonb_build_object('status','active'),p_reason);
  return v_user; end; $$;
revoke all on function public.admin_suspend_user(uuid,text) from public; revoke execute on function public.admin_suspend_user(uuid,text) from anon; grant execute on function public.admin_suspend_user(uuid,text) to authenticated, service_role;
revoke all on function public.admin_reinstate_user(uuid,text) from public; revoke execute on function public.admin_reinstate_user(uuid,text) from anon; grant execute on function public.admin_reinstate_user(uuid,text) to authenticated, service_role;

create function public.is_actor_active() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select status <> 'suspended'::public.user_status from public.users where id = (select auth.uid())), true); $$;
revoke all on function public.is_actor_active() from public; grant execute on function public.is_actor_active() to authenticated;

do $$ declare r record; v_policy_name text; v_table_count int := 0; v_policy_count int := 0; begin
  for r in select tablename, bool_or(cmd in ('INSERT','ALL')) has_insert, bool_or(cmd in ('UPDATE','ALL')) has_update, bool_or(cmd in ('DELETE','ALL')) has_delete
    from pg_policies where schemaname='public' and permissive='PERMISSIVE' and 'authenticated'=any(roles::text[]) and cmd in ('INSERT','UPDATE','DELETE','ALL') group by tablename loop
    v_table_count := v_table_count + 1;
    if r.has_insert then v_policy_name:=r.tablename||'_active_insert'; if not exists(select 1 from pg_policies where schemaname='public' and tablename=r.tablename and policyname=v_policy_name) then execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (public.is_actor_active())', v_policy_name, r.tablename); v_policy_count:=v_policy_count+1; end if; end if;
    if r.has_update then v_policy_name:=r.tablename||'_active_update'; if not exists(select 1 from pg_policies where schemaname='public' and tablename=r.tablename and policyname=v_policy_name) then execute format('create policy %I on public.%I as restrictive for update to authenticated using (public.is_actor_active()) with check (public.is_actor_active())', v_policy_name, r.tablename); v_policy_count:=v_policy_count+1; end if; end if;
    if r.has_delete then v_policy_name:=r.tablename||'_active_delete'; if not exists(select 1 from pg_policies where schemaname='public' and tablename=r.tablename and policyname=v_policy_name) then execute format('create policy %I on public.%I as restrictive for delete to authenticated using (public.is_actor_active())', v_policy_name, r.tablename); v_policy_count:=v_policy_count+1; end if; end if;
  end loop;
  raise notice '0096: % tables scanned, % restrictive suspension policies created', v_table_count, v_policy_count;
end $$;
do $$ declare v_bad int; begin
  select count(*) into v_bad from pg_policies where schemaname='public' and permissive='RESTRICTIVE' and cmd not in ('INSERT','UPDATE','DELETE');
  if v_bad > 0 then raise exception 'SAFETY: % restrictive policy(ies) target a command other than INSERT/UPDATE/DELETE', v_bad; end if;
end $$;

create function public.admin_kpi_money() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_gmv numeric; begin
  if not public.has_role('admin') then raise exception 'FORBIDDEN: admin role required'; end if;
  select coalesce(sum(amount),0) into v_gmv from public.payment_intents where status='captured' and created_at >= now()-interval '7 days';
  return jsonb_build_object('gmv_captured_7d',v_gmv,'window','7d','as_of',now()); end; $$;
create function public.admin_kpi_users() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_by_role jsonb; v_total bigint; v_signups_7d bigint; begin
  if not public.has_role('admin') then raise exception 'FORBIDDEN: admin role required'; end if;
  select coalesce(jsonb_object_agg(role,cnt),'{}'::jsonb) into v_by_role from (select role::text role, count(*) cnt from public.user_roles group by role) t;
  select count(*) into v_total from public.users;
  select count(*) into v_signups_7d from public.users where created_at >= now()-interval '7 days';
  return jsonb_build_object('total_users',v_total,'by_role',v_by_role,'signups_7d',v_signups_7d,'window','7d','as_of',now()); end; $$;
create function public.admin_kpi_queues() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_r bigint; v_v bigint; v_rep bigint; begin
  if not public.has_role('admin') then raise exception 'FORBIDDEN: admin role required'; end if;
  select count(*) into v_r from public.refunds where status='pending';
  select count(*) into v_v from public.verification_requests where status='pending_review';
  select count(*) into v_rep from public.reports where status='pending';
  return jsonb_build_object('pending_refunds',v_r,'pending_verifications',v_v,'pending_reports',v_rep,'as_of',now()); end; $$;
create function public.admin_kpi_activity() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cb bigint; v_s bigint; v_o bigint; v_t bigint; begin
  if not public.has_role('admin') then raise exception 'FORBIDDEN: admin role required'; end if;
  select count(*) into v_cb from public.court_bookings where created_at >= now()-interval '7 days';
  select count(*) into v_s from public.sessions where created_at >= now()-interval '7 days';
  select count(*) into v_o from public.orders where created_at >= now()-interval '7 days';
  select count(*) into v_t from public.support_tickets where status='open';
  return jsonb_build_object('bookings_7d',v_cb+v_s,'court_bookings_7d',v_cb,'sessions_7d',v_s,'orders_7d',v_o,'open_support_tickets',v_t,'window','7d','as_of',now()); end; $$;
revoke all on function public.admin_kpi_money() from public; revoke execute on function public.admin_kpi_money() from anon; grant execute on function public.admin_kpi_money() to authenticated;
revoke all on function public.admin_kpi_users() from public; revoke execute on function public.admin_kpi_users() from anon; grant execute on function public.admin_kpi_users() to authenticated;
revoke all on function public.admin_kpi_queues() from public; revoke execute on function public.admin_kpi_queues() from anon; grant execute on function public.admin_kpi_queues() to authenticated;
revoke all on function public.admin_kpi_activity() from public; revoke execute on function public.admin_kpi_activity() from anon; grant execute on function public.admin_kpi_activity() to authenticated;
