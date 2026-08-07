-- ATLITOS v2 — 0097_report_block.sql
-- Domain: trust & safety (Phase 4 LAUNCH). Track C. CT-C.
-- Requirements: PRD-04 FR-31, FR-32, FR-33; App Store 1.2 / Play UGC policy
-- (a store approval requirement, not an optional nice to have).
--
-- Extends the existing 0041-0043 reports/moderation machinery (built for
-- clip/comment reports) to also cover chat messages and a direct report
-- against a user, and adds the own-row `blocked_users` table that backs the
-- client-side visibility filtering `packages/api` layers on top (Settled
-- decision 4 in PHASE-4-STATUS.md): permissive-OR RLS cannot subtract rows,
-- so a blocked user's chat/comments/clips disappear from the blocker's OWN
-- reads via an explicit filter, never a restrictive SELECT policy on chat
-- (that would sit on top of the fresh Phase 3 Broadcast delivery path,
-- Phase 3 P1-2, and the risk is out of proportion to what launch needs).
-- DB-enforced messaging block (a restrictive policy refusing the blocked
-- party's INSERT into a thread the blocker is in) is documented fast-follow
-- debt in DEBT.md, not built here. This is the BelieversDiary Guideline 1.2
-- precedent: report + block + blocked content disappears is store-sufficient.
--
-- ============================================================================
-- blocked_users. Own-row table: a blocker's own block list. `blocker_id <>
-- blocked_id` (AT-62 shape baked into the schema itself, not just tests) so a
-- self-block can never exist to test against vacuously. One-way: only the
-- blocker's own reads are ever filtered; the blocked party's view of the
-- blocker is unchanged (documented, not a bug).
-- ============================================================================

create table public.blocked_users (
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index idx_blocked_users_blocked_id on public.blocked_users (blocked_id);

comment on table public.blocked_users is
  'CT-C: a blocker''s own block list, own-row RLS. Client-layer filtering (packages/api) subtracts a blocked user''s clips/comments/chat threads from the BLOCKER''s reads; this table carries no server-side enforcement of message refusal (DEBT.md).';

alter table public.blocked_users enable row level security;

create policy blocked_users_select_own on public.blocked_users
  for select to authenticated
  using (blocker_id = (select auth.uid()));

create policy blocked_users_insert_own on public.blocked_users
  for insert to authenticated
  with check (blocker_id = (select auth.uid()) and not public.is_guest());

create policy blocked_users_delete_own on public.blocked_users
  for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- No UPDATE policy: a block is created or removed, never edited. Grants are
-- the second lock (0010/0032 house pattern): no anon surface at all, and
-- authenticated never gets UPDATE.
revoke all on public.blocked_users from anon;
revoke update on public.blocked_users from authenticated;

-- ============================================================================
-- reports.entity_type widens to cover a chat message report and a direct
-- report against a user (PRD-04 FR-31 "report objectionable content", read
-- broadly enough to include a user account itself, not only a clip/comment).
-- Dropping and re-adding the check constraint is safe: every existing row is
-- 'clip' or 'comment', both still allowed.
-- ============================================================================

alter table public.reports drop constraint reports_entity_type_check;
alter table public.reports add constraint reports_entity_type_check
  check (entity_type in ('clip', 'comment', 'chat_message', 'user'));

-- ============================================================================
-- chat_messages gains a soft-delete pair for the Reports Queue's takedown
-- action. Messages are otherwise immutable (0022: "no policy, and no grant"
-- on UPDATE/DELETE for any client role) so these columns stay unwritable by
-- any direct client PostgREST call after this migration exactly as before;
-- the ONLY write path is resolve_report's extended chat arm below (SECURITY
-- DEFINER, admin/moderator gated internally).
-- ============================================================================

alter table public.chat_messages
  add column if not exists removed_at timestamptz,
  add column if not exists removed_reason text;

comment on column public.chat_messages.removed_at is
  'CT-C: set only by resolve_report''s chat_message remove arm. NULL = visible. Clients render a removed placeholder instead of the text once set; the row is never deleted (thread integrity, audit trail).';

-- ============================================================================
-- resolve_report: create or replace to extend the existing clip/comment
-- machinery (0043) with chat_message and user arms, WITHOUT changing the
-- clip/comment behaviour at all (same branches, byte-for-byte, so the
-- existing Reports Queue takedown/dismiss flow is unaffected). Grants are
-- unchanged by create-or-replace (0043's authenticated + service_role EXECUTE
-- grant carries over).
--
--   * entity_type = 'chat_message', action = 'remove': soft-deletes the
--     message (removed_at/removed_reason), never a hard delete, so thread
--     history and Realtime delivery already sent are not retroactively
--     falsified; the client renders a placeholder for a removed row.
--   * entity_type = 'user', action = 'remove': the report resolves as
--     'actioned' with no further row mutation here. There is no "remove a
--     user" primitive at this layer; account-level enforcement (suspend/ban)
--     is Track B's admin_suspend_user, a SEPARATE admin action the moderator
--     takes from the User Detail screen after reviewing this report. Resolving
--     the report and suspending the account are two distinct, independently
--     audited actions on purpose, so "actioned" here means "reviewed and
--     handled", not "the account is now suspended" (that RPC writes its own
--     audit_log row when the admin actually does it).
-- ============================================================================

create or replace function public.resolve_report(
  p_report_id uuid,
  p_action text,
  p_reason text default null
)
returns public.reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.reports;
  v_new_status public.report_status;
  v_clip public.clips;
begin
  if not (public.has_role('admin') or public.has_role('moderator')) then
    raise exception 'FORBIDDEN: admin or moderator role required';
  end if;

  if p_action not in ('remove', 'dismiss') then
    raise exception 'VALIDATION: unknown report action %', p_action;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'VALIDATION: a reason is required to resolve a report';
  end if;

  select * into v_report from public.reports where id = p_report_id for update;
  if v_report.id is null then
    raise exception 'NOT_FOUND: report % does not exist', p_report_id;
  end if;

  if v_report.status <> 'pending' then
    raise exception 'ALREADY_RESOLVED: report % is already %', p_report_id, v_report.status;
  end if;

  if p_action = 'remove' then
    if v_report.entity_type = 'clip' then
      select * into v_clip from public.clips where id = v_report.entity_id;
      -- Only take down a clip that is still published; if a prior action already
      -- removed it, the report is still resolved as actioned without erroring.
      if v_clip.id is not null and v_clip.status = 'published' then
        perform public.moderate_clip(v_report.entity_id, 'remove', p_reason);
      end if;
    elsif v_report.entity_type = 'comment' then
      delete from public.clip_comments where id = v_report.entity_id;
    elsif v_report.entity_type = 'chat_message' then
      update public.chat_messages
      set removed_at = now(), removed_reason = p_reason
      where id = v_report.entity_id and removed_at is null;
    elsif v_report.entity_type = 'user' then
      -- No row mutation: account enforcement is Track B's separate,
      -- separately audited admin_suspend_user action. See header comment.
      null;
    end if;
    v_new_status := 'actioned';
  else
    v_new_status := 'dismissed';
  end if;

  update public.reports
  set status = v_new_status,
      resolved_by = auth.uid(),
      resolved_at = now()
  where id = p_report_id
  returning * into v_report;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, note)
  values (
    auth.uid(),
    'report.' || p_action,
    'report',
    p_report_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', v_new_status),
    btrim(p_reason)
  );

  return v_report;
end;
$$;

revoke all on function public.resolve_report(uuid, text, text) from public;
revoke execute on function public.resolve_report(uuid, text, text) from anon;
grant execute on function public.resolve_report(uuid, text, text) to authenticated, service_role;

-- ============================================================================
-- admin_get_reported_entity: the ONLY way an admin/moderator ever reads the
-- content of a chat message (Settled decision 6, PHASE-4-STATUS.md highest
-- risk item 4). There is deliberately NO blanket admin SELECT policy on
-- chat_messages: that would let an admin browse every private conversation on
-- the platform, a far wider privacy grant than moderation needs. This RPC
-- instead returns exactly ONE reported entity's snapshot for exactly ONE
-- EXISTING report row (the p_report_id the admin is already looking at in the
-- Reports Queue), admin-checked inside, so it cannot be used to fish for
-- arbitrary messages: there must be a report on file naming that exact
-- entity_id first.
--
-- Also serves 'clip'/'comment'/'user' report types with the same one-report-
-- one-entity shape, for a single, uniform admin read path across every
-- reportable entity type (the Reports Queue detail screen calls this ONE RPC
-- regardless of entity_type, rather than branching client side into direct
-- table reads that would need their own admin policy per table).
-- ============================================================================

create function public.admin_get_reported_entity(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.reports;
  v_result jsonb;
begin
  if not (public.has_role('admin') or public.has_role('moderator')) then
    raise exception 'FORBIDDEN: admin or moderator role required';
  end if;

  select * into v_report from public.reports where id = p_report_id;
  if v_report.id is null then
    raise exception 'NOT_FOUND: report % does not exist', p_report_id;
  end if;

  if v_report.entity_type = 'chat_message' then
    select jsonb_build_object(
      'entity_type', 'chat_message',
      'id', m.id,
      'thread_id', m.thread_id,
      'sender_id', m.sender_id,
      'text', m.text,
      'created_at', m.created_at,
      'removed_at', m.removed_at,
      'removed_reason', m.removed_reason
    )
    into v_result
    from public.chat_messages m
    where m.id = v_report.entity_id;
  elsif v_report.entity_type = 'comment' then
    select jsonb_build_object(
      'entity_type', 'comment',
      'id', c.id,
      'clip_id', c.clip_id,
      'user_id', c.user_id,
      'text', c.text,
      'created_at', c.created_at
    )
    into v_result
    from public.clip_comments c
    where c.id = v_report.entity_id;
  elsif v_report.entity_type = 'clip' then
    select jsonb_build_object(
      'entity_type', 'clip',
      'id', cl.id,
      'owner_id', cl.owner_id,
      'caption', cl.caption,
      'status', cl.status,
      'created_at', cl.created_at
    )
    into v_result
    from public.clips cl
    where cl.id = v_report.entity_id;
  elsif v_report.entity_type = 'user' then
    select jsonb_build_object(
      'entity_type', 'user',
      'id', u.id,
      'name', u.name
    )
    into v_result
    from public.users u
    where u.id = v_report.entity_id;
  end if;

  return v_result;
end;
$$;

comment on function public.admin_get_reported_entity(uuid) is
  'CT-C, Settled decision 6: admin/moderator-only, one report -> one entity snapshot. The sole read path onto a reported chat_message''s content; there is no blanket admin SELECT policy on chat_messages.';

revoke all on function public.admin_get_reported_entity(uuid) from public;
revoke execute on function public.admin_get_reported_entity(uuid) from anon;
grant execute on function public.admin_get_reported_entity(uuid) to authenticated;
