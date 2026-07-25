-- ATLITOS v2 — 0078_group_chat_and_notes.sql
-- Domain: chat + coaching notes. Design authority:
-- docs/design/COACH-TRAININGS-GAP.md items 4 (#17 group chat) and the
-- "Needs new schema, no group dependency" coach notes item (#6, #7).
--
-- Extends 0022_chat.sql's strictly-two-party chat to group threads, and adds
-- coach_trainee_notes.
--
-- Shape of the chat change (0022 inspected first, its invariants preserved):
--
--   1. chat_threads gains context_type 'group'. The pair columns become
--      nullable, with a CHECK that ONLY group rows may null them and that
--      every non-group row keeps the exact old shape (both participants
--      present, canonically ordered). The old 4-column UNIQUE ignores rows
--      with null participants, so group rows get their own partial unique
--      index: one thread per training group, ever.
--
--   2. chat_thread_members (thread_id, user_id) is the group row's
--      participant set, synced by triggers, never written by a client:
--        - creating a training_group creates its thread and seats the coach;
--        - a membership turning 'active' (finalize path, 0079) seats the
--          player; turning 'lapsed' removes them (manual renewal model:
--          lapsed members lose the room until they renew, and the partial
--          unique index in 0076 guarantees at most one live membership per
--          player per group, so the removal cannot strip a still-valid seat).
--
--   3. Membership checks in policies go through is_chat_thread_member, a
--      SECURITY DEFINER boolean helper, for the same reason 0022 used
--      session_links_pair: a policy on chat_thread_members that subqueried
--      chat_thread_members itself would recurse, and the answer must be
--      computable before the caller is proven to be a participant of
--      anything.
--
--   4. Realtime: chat_messages is ALREADY in supabase_realtime (0022), and
--      Realtime authorizes each subscriber against the table's SELECT
--      policies, so extending those policies below is the entire Realtime
--      change. The per-subscriber SELECT stays tight: group messages reach
--      exactly the seated members of that thread, nobody else. chat_threads
--      and chat_thread_members stay out of the publication (0022's decision:
--      live reordering comes from the message stream).
--
-- coach_trainee_notes: coach-private observations about a trainee. Coach-only
-- select/insert/delete of own rows; the player has NO access in v1 (product
-- decision recorded in COACH-TRAININGS-GAP.md, "athlete never reads unless
-- product says so"). Insert additionally requires a real coaching
-- relationship (a session ever, or a live group membership in one of the
-- coach's groups), so the table cannot be used to attach notes to strangers.

-- ============================================================================
-- chat_threads: relax the pair shape for group rows. Constraint names
-- verified against the live catalog before writing.
-- ============================================================================

alter table public.chat_threads alter column participant_a drop not null;
alter table public.chat_threads alter column participant_b drop not null;

alter table public.chat_threads drop constraint chat_threads_check;
alter table public.chat_threads drop constraint chat_threads_context_type_check;

alter table public.chat_threads
  add constraint chat_threads_context_type_check
  check (context_type in ('coaching', 'clutch_creator', 'group'));

-- Non-group rows keep the old two-party canonical shape verbatim; group rows
-- have no pair at all (their participant set is chat_thread_members).
alter table public.chat_threads
  add constraint chat_threads_shape check (
    (
      context_type = 'group'
      and participant_a is null
      and participant_b is null
    )
    or (
      context_type <> 'group'
      and participant_a is not null
      and participant_b is not null
      and participant_a < participant_b
    )
  );

-- One thread per training group. The pre-existing 4-column UNIQUE cannot see
-- group rows (null participants), so this is the group rows' uniqueness.
create unique index chat_threads_one_per_group
  on public.chat_threads (context_id)
  where (context_type = 'group');

-- ============================================================================
-- chat_thread_members
-- ============================================================================

create table public.chat_thread_members (
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index idx_chat_thread_members_user_id on public.chat_thread_members (user_id);

-- ============================================================================
-- is_chat_thread_member. See header note 3.
-- ============================================================================

create or replace function public.is_chat_thread_member(
  p_thread_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_thread_members m
    where m.thread_id = p_thread_id
      and m.user_id = p_user_id
  );
$$;

revoke all on function public.is_chat_thread_member(uuid, uuid) from public;
revoke execute on function public.is_chat_thread_member(uuid, uuid) from anon;
grant execute on function public.is_chat_thread_member(uuid, uuid) to authenticated;

-- ============================================================================
-- Sync triggers. SECURITY DEFINER: the row writers (0079 RPCs run as owner,
-- finalize edge functions run as service_role) may not themselves hold chat
-- table privileges, and clients certainly do not.
-- ============================================================================

-- A group's thread exists from the moment the group does, coach seated.
create or replace function public.create_group_chat_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id uuid;
begin
  insert into public.chat_threads (participant_a, participant_b, context_type, context_id)
  values (null, null, 'group', new.id)
  on conflict do nothing
  returning id into v_thread_id;

  if v_thread_id is null then
    select id into v_thread_id from public.chat_threads
    where context_type = 'group' and context_id = new.id;
  end if;

  insert into public.chat_thread_members (thread_id, user_id)
  values (v_thread_id, new.coach_id)
  on conflict do nothing;

  return new;
end;
$$;

create trigger training_groups_create_chat_thread
  after insert on public.training_groups
  for each row execute function public.create_group_chat_thread();

-- Membership lifecycle -> seat sync. Fires on INSERT too, so a membership
-- created directly as 'active' (seed/service paths) is seated correctly.
create or replace function public.sync_group_chat_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id uuid;
begin
  select id into v_thread_id from public.chat_threads
  where context_type = 'group' and context_id = new.group_id;

  if v_thread_id is null then
    -- Group predates its thread (should not happen; the group trigger makes
    -- one) — create it rather than desync.
    insert into public.chat_threads (participant_a, participant_b, context_type, context_id)
    values (null, null, 'group', new.group_id)
    returning id into v_thread_id;
  end if;

  if new.status = 'active' then
    insert into public.chat_thread_members (thread_id, user_id)
    values (v_thread_id, new.player_id)
    on conflict do nothing;
  elsif new.status = 'lapsed' then
    delete from public.chat_thread_members
    where thread_id = v_thread_id and user_id = new.player_id;
  end if;

  return new;
end;
$$;

create trigger group_memberships_sync_chat
  after insert or update of status on public.group_memberships
  for each row execute function public.sync_group_chat_membership();

-- ============================================================================
-- RLS: chat_thread_members + the group extensions to 0022's policies.
-- ============================================================================

alter table public.chat_thread_members enable row level security;

-- A seated member sees the whole member list of their thread (the roster in
-- the group chat header); nobody else sees anything. No client writes ever:
-- the triggers above are the only writers.
create policy chat_thread_members_select_member on public.chat_thread_members
  for select to authenticated
  using (public.is_chat_thread_member(thread_id, auth.uid()));

revoke insert, update, delete on public.chat_thread_members from anon, authenticated;

-- Group members read their group thread row.
create policy chat_threads_select_group_member on public.chat_threads
  for select to authenticated
  using (
    context_type = 'group'
    and public.is_chat_thread_member(id, auth.uid())
  );

-- Group members read their group's messages. This is also the policy
-- Supabase Realtime evaluates per subscriber before delivering a row
-- (header note 4), so a lapsed member's socket goes silent the moment the
-- trigger unseats them.
create policy chat_messages_select_group_member on public.chat_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.chat_threads t
      where t.id = chat_messages.thread_id
        and t.context_type = 'group'
        and public.is_chat_thread_member(t.id, auth.uid())
    )
  );

-- Group members write to their group thread, only as themselves.
create policy chat_messages_insert_group_member on public.chat_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.chat_threads t
      where t.id = chat_messages.thread_id
        and t.context_type = 'group'
        and public.is_chat_thread_member(t.id, auth.uid())
    )
  );

-- NOTE: 0022's chat_threads_insert_participant is untouched and still
-- requires context_type = 'coaching', so no client can INSERT a group thread
-- directly; group threads exist only via the training_groups trigger.

-- ============================================================================
-- coach_trainee_notes
-- ============================================================================

-- Does this coach actually coach this player? Session history (either
-- direction of the 1:1 rails) or a live membership in one of the coach's
-- groups. SECURITY DEFINER for the same WITH CHECK reason as
-- session_links_pair (0022).
create or replace function public.coach_has_trainee(
  p_coach_id uuid,
  p_player_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sessions s
    where s.coach_id = p_coach_id and s.player_id = p_player_id
  )
  or exists (
    select 1
    from public.group_memberships m
    join public.training_groups g on g.id = m.group_id
    where g.coach_id = p_coach_id
      and m.player_id = p_player_id
      and m.status <> 'lapsed'
  );
$$;

revoke all on function public.coach_has_trainee(uuid, uuid) from public;
revoke execute on function public.coach_has_trainee(uuid, uuid) from anon;
grant execute on function public.coach_has_trainee(uuid, uuid) to authenticated;

create table public.coach_trainee_notes (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coach_profiles (user_id) on delete cascade,
  player_id uuid not null references public.users (id) on delete cascade,
  body text not null check (btrim(body) <> ''),
  created_at timestamptz not null default now()
);

create index idx_coach_trainee_notes_coach_player
  on public.coach_trainee_notes (coach_id, player_id, created_at desc);

alter table public.coach_trainee_notes enable row level security;

-- Coach-only, own rows, and only about actual trainees. The player has NO
-- policy at all in v1: zero rows, not an error.
create policy coach_trainee_notes_select_own on public.coach_trainee_notes
  for select to authenticated
  using (coach_id = auth.uid());

create policy coach_trainee_notes_insert_own on public.coach_trainee_notes
  for insert to authenticated
  with check (
    coach_id = auth.uid()
    and public.has_role('coach')
    and public.coach_has_trainee(coach_id, player_id)
  );

create policy coach_trainee_notes_delete_own on public.coach_trainee_notes
  for delete to authenticated
  using (coach_id = auth.uid());

-- Notes are never edited, only deleted and rewritten. No UPDATE policy, and
-- the verb is gone at the grant level too.
revoke update on public.coach_trainee_notes from anon, authenticated;
revoke insert, delete on public.coach_trainee_notes from anon;
