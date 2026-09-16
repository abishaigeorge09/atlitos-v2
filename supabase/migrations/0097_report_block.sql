-- 0097_report_block: blocked_users (own-row RLS, blocker<>blocked baked in), reports.entity_type widened to clip/comment/chat_message/user, chat_messages soft-delete cols, resolve_report chat+user arms, admin_get_reported_entity (admin-only one-report-one-entity). Proven on prod rolled-back.
create table public.blocked_users (
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id));
create index idx_blocked_users_blocked_id on public.blocked_users (blocked_id);
comment on table public.blocked_users is 'CT-C: a blocker''s own block list, own-row RLS. Client-layer filtering subtracts a blocked user''s clips/comments/chat from the BLOCKER''s reads; no server-side message refusal (DEBT.md).';
alter table public.blocked_users enable row level security;
create policy blocked_users_select_own on public.blocked_users for select to authenticated using (blocker_id = (select auth.uid()));
create policy blocked_users_insert_own on public.blocked_users for insert to authenticated with check (blocker_id = (select auth.uid()) and not public.is_guest());
create policy blocked_users_delete_own on public.blocked_users for delete to authenticated using (blocker_id = (select auth.uid()));
revoke all on public.blocked_users from anon;
revoke update on public.blocked_users from authenticated;

alter table public.reports drop constraint if exists reports_entity_type_check;
alter table public.reports add constraint reports_entity_type_check check (entity_type in ('clip', 'comment', 'chat_message', 'user'));

alter table public.chat_messages add column if not exists removed_at timestamptz, add column if not exists removed_reason text;
comment on column public.chat_messages.removed_at is 'CT-C: set only by resolve_report''s chat_message remove arm. NULL = visible. Clients render a removed placeholder; row is never deleted.';

create or replace function public.resolve_report(p_report_id uuid, p_action text, p_reason text default null)
returns public.reports language plpgsql security definer set search_path = public as $$
declare v_report public.reports; v_new_status public.report_status; v_clip public.clips;
begin
  if not (public.has_role('admin') or public.has_role('moderator')) then raise exception 'FORBIDDEN: admin or moderator role required'; end if;
  if p_action not in ('remove','dismiss') then raise exception 'VALIDATION: unknown report action %', p_action; end if;
  if p_reason is null or btrim(p_reason)='' then raise exception 'VALIDATION: a reason is required to resolve a report'; end if;
  select * into v_report from public.reports where id = p_report_id for update;
  if v_report.id is null then raise exception 'NOT_FOUND: report % does not exist', p_report_id; end if;
  if v_report.status <> 'pending' then raise exception 'ALREADY_RESOLVED: report % is already %', p_report_id, v_report.status; end if;
  if p_action = 'remove' then
    if v_report.entity_type='clip' then
      select * into v_clip from public.clips where id=v_report.entity_id;
      if v_clip.id is not null and v_clip.status='published' then perform public.moderate_clip(v_report.entity_id,'remove',p_reason); end if;
    elsif v_report.entity_type='comment' then delete from public.clip_comments where id=v_report.entity_id;
    elsif v_report.entity_type='chat_message' then update public.chat_messages set removed_at=now(), removed_reason=p_reason where id=v_report.entity_id and removed_at is null;
    elsif v_report.entity_type='user' then null;
    end if;
    v_new_status := 'actioned';
  else v_new_status := 'dismissed'; end if;
  update public.reports set status=v_new_status, resolved_by=auth.uid(), resolved_at=now() where id=p_report_id returning * into v_report;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (auth.uid(), 'report.'||p_action, 'report', p_report_id, jsonb_build_object('status','pending'), jsonb_build_object('status',v_new_status), btrim(p_reason));
  return v_report;
end; $$;
revoke all on function public.resolve_report(uuid, text, text) from public;
revoke execute on function public.resolve_report(uuid, text, text) from anon;
grant execute on function public.resolve_report(uuid, text, text) to authenticated, service_role;

create function public.admin_get_reported_entity(p_report_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_report public.reports; v_result jsonb;
begin
  if not (public.has_role('admin') or public.has_role('moderator')) then raise exception 'FORBIDDEN: admin or moderator role required'; end if;
  select * into v_report from public.reports where id = p_report_id;
  if v_report.id is null then raise exception 'NOT_FOUND: report % does not exist', p_report_id; end if;
  if v_report.entity_type='chat_message' then
    select jsonb_build_object('entity_type','chat_message','id',m.id,'thread_id',m.thread_id,'sender_id',m.sender_id,'text',m.text,'created_at',m.created_at,'removed_at',m.removed_at,'removed_reason',m.removed_reason) into v_result from public.chat_messages m where m.id=v_report.entity_id;
  elsif v_report.entity_type='comment' then
    select jsonb_build_object('entity_type','comment','id',c.id,'clip_id',c.clip_id,'user_id',c.user_id,'text',c.text,'created_at',c.created_at) into v_result from public.clip_comments c where c.id=v_report.entity_id;
  elsif v_report.entity_type='clip' then
    select jsonb_build_object('entity_type','clip','id',cl.id,'owner_id',cl.owner_id,'caption',cl.caption,'status',cl.status,'created_at',cl.created_at) into v_result from public.clips cl where cl.id=v_report.entity_id;
  elsif v_report.entity_type='user' then
    select jsonb_build_object('entity_type','user','id',u.id,'name',u.name) into v_result from public.users u where u.id=v_report.entity_id;
  end if;
  return v_result;
end; $$;
comment on function public.admin_get_reported_entity(uuid) is 'CT-C: admin/moderator-only, one report -> one entity snapshot. Sole read path onto a reported chat_message; no blanket admin SELECT on chat_messages.';
revoke all on function public.admin_get_reported_entity(uuid) from public;
revoke execute on function public.admin_get_reported_entity(uuid) from anon;
grant execute on function public.admin_get_reported_entity(uuid) to authenticated;
