-- ATLITOS v2 — 0022_chat.sql
-- Domain: chat (SCHEMA.md "Domain: chat"). Epic AT-12, story AT-39.
-- Requirements: PRD-02 FR-30, FR-31; PRD-01 FR-58.
--
-- chat_threads + chat_messages, their RLS, and the Realtime publication entry
-- that AT-55 (chat UI) and AT-59 (Realtime proof) build on.
--
-- ============================================================================
-- HOW A CLIENT SUBSCRIBES (AT-55, AT-59 read this)
--
-- chat_messages is added to the supabase_realtime publication at the bottom of
-- this file, and RLS is enabled on it. Supabase Realtime evaluates the table's
-- SELECT policy against each subscriber's JWT before delivering a row, so a
-- message never reaches a socket belonging to someone who is not one of the
-- thread's two participants. The policy is the authorization; the client-side
-- filter below is only about volume.
--
--   Open thread screen, one thread's messages:
--     supabase
--       .channel('chat:' + threadId)
--       .on('postgres_changes',
--           { event: 'INSERT', schema: 'public', table: 'chat_messages',
--             filter: 'thread_id=eq.' + threadId },
--           handleNewMessage)
--       .subscribe()
--
--   Thread list screen, every thread the user is in (PRD-02 FR-31 wants the
--   list to reflect new messages too): subscribe to the same table with NO
--   filter. RLS already scopes the stream to threads this user participates
--   in, so an unfiltered subscription is safe here and is the intended shape.
--   Use each event's thread_id to bump that row's preview and re-sort.
--
--     supabase
--       .channel('chat:inbox')
--       .on('postgres_changes',
--           { event: 'INSERT', schema: 'public', table: 'chat_messages' },
--           handleAnyNewMessage)
--       .subscribe()
--
-- chat_threads itself is deliberately NOT in the publication (SCHEMA.md puts
-- Realtime on chat_messages only). last_message_at is maintained by a trigger
-- for ordering the list on a cold read; live re-ordering comes from the
-- message stream above, not from a second subscription.
--
-- The client must be authenticated when it subscribes. An anonymous session
-- has an auth.uid() but will match no thread, so it receives nothing rather
-- than erroring.
-- ============================================================================
--
-- PRD-02 FR-30 / PRD-01 FR-58, enforced server side, not by hiding a button:
-- a coaching thread may be created only between two users who have at least
-- one session row between them, in any status, ever. That check lives in the
-- INSERT policy's WITH CHECK via session_links_pair below, so a hand-rolled
-- PostgREST insert from a modified client fails exactly the same way the UI
-- would have prevented. There is no cold-outreach chat in v1.
--
-- context_type 'clutch_creator' exists in the CHECK constraint because
-- SCHEMA.md defines it, but the INSERT policy accepts only 'coaching' today:
-- the creator relationship it would anchor on (clips, follows) does not exist
-- until the Clutch domain lands. Whoever builds Clutch adds the second branch
-- to chat_threads_insert_participant; until then, the constraint value is
-- reachable only by service_role, which is the correct failure mode (locked
-- shut) rather than the dangerous one (any authenticated user can open a
-- thread with any stranger by passing a different context_type).

-- ============================================================================
-- session_links_pair: is p_session_id a session between exactly these two
-- users? SECURITY DEFINER for the same reason session_exists_between
-- (0019_coaching_rls.sql) is: the answer must be a plain boolean, computed
-- without granting the chat layer any read of a session row, and it is
-- evaluated inside a WITH CHECK before the caller has been proven to be a
-- participant of anything.
--
-- Distinct from session_exists_between, and both are used: this one backs the
-- thread INSERT policy (the hard FR-30 gate, which also pins context_id to a
-- real session of theirs), while session_exists_between backs the UI's
-- decision about whether to show a Message action at all.
-- ============================================================================

create or replace function public.session_links_pair(
  p_session_id uuid,
  p_user_a uuid,
  p_user_b uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sessions s
    where s.id = p_session_id
      and (
        (s.coach_id = p_user_a and s.player_id = p_user_b)
        or (s.coach_id = p_user_b and s.player_id = p_user_a)
      )
  );
$$;

revoke all on function public.session_links_pair(uuid, uuid, uuid) from public;
revoke execute on function public.session_links_pair(uuid, uuid, uuid) from anon;
grant execute on function public.session_links_pair(uuid, uuid, uuid) to authenticated;

-- ============================================================================
-- Tables
-- ============================================================================

create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  participant_a uuid not null references public.users (id) on delete cascade,
  participant_b uuid not null references public.users (id) on delete cascade,
  context_type text not null check (context_type in ('coaching', 'clutch_creator')),
  context_id uuid not null,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  -- Canonical pair ordering, so one conversation cannot exist twice with the
  -- participants swapped. Client code sorts the two ids before inserting.
  check (participant_a < participant_b),
  unique (participant_a, participant_b, context_type, context_id)
);

create index idx_chat_threads_participant_a on public.chat_threads (participant_a);
create index idx_chat_threads_participant_b on public.chat_threads (participant_b);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  sender_id uuid not null references public.users (id) on delete cascade,
  text text not null check (btrim(text) <> ''),
  created_at timestamptz not null default now()
);

create index idx_chat_messages_thread_id on public.chat_messages (thread_id, created_at);

-- ============================================================================
-- last_message_at, maintained by trigger so it is not a client-writable field
-- (RLS.md chat: "no UPDATE/DELETE from clients, last_message_at maintained by
-- trigger"). SECURITY DEFINER because the sender has no UPDATE policy on
-- chat_threads at all.
-- ============================================================================

create or replace function public.touch_chat_thread_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_threads
  set last_message_at = new.created_at
  where id = new.thread_id;
  return new;
end;
$$;

create trigger chat_messages_touch_thread
  after insert on public.chat_messages
  for each row execute function public.touch_chat_thread_last_message();

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

-- Read: participants only. Written as ONE policy with an internal OR rather
-- than two permissive policies, so the leaky shape RLS.md and
-- 0019_coaching_rls.sql warn about does not apply here: there is no "public"
-- policy on either table for an owner-scoped policy to be OR'd against. An
-- unscoped `select * from chat_threads` returns exactly the caller's own
-- threads and nothing else, which is what the thread list wants.
create policy chat_threads_select_participant on public.chat_threads
  for select to authenticated
  using (participant_a = auth.uid() or participant_b = auth.uid());

-- Create: the caller must be one of the two participants, the pair must be in
-- canonical order, and FR-30's session must exist and be the thread's context.
create policy chat_threads_insert_participant on public.chat_threads
  for insert to authenticated
  with check (
    (participant_a = auth.uid() or participant_b = auth.uid())
    and participant_a < participant_b
    and context_type = 'coaching'
    and public.session_links_pair(context_id, participant_a, participant_b)
  );

-- No UPDATE or DELETE policy on chat_threads for any client role, and the
-- verbs are revoked at the grant level too: last_message_at is the trigger's
-- to write, and a conversation is never edited or destroyed from a client.
revoke update, delete on public.chat_threads from anon, authenticated;

-- Messages: visible through the parent thread's participant check, which is
-- also the policy Realtime evaluates per subscriber (see the header).
create policy chat_messages_select_participant on public.chat_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.chat_threads t
      where t.id = chat_messages.thread_id
        and (t.participant_a = auth.uid() or t.participant_b = auth.uid())
    )
  );

-- Send: only as yourself, only into a thread you are in. sender_id is checked
-- against auth.uid() so a participant cannot forge a message from the other
-- party.
create policy chat_messages_insert_participant on public.chat_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.chat_threads t
      where t.id = chat_messages.thread_id
        and (t.participant_a = auth.uid() or t.participant_b = auth.uid())
    )
  );

-- Messages are immutable once posted (RLS.md chat). No policy, and no grant.
revoke update, delete on public.chat_messages from anon, authenticated;

-- ============================================================================
-- Realtime (PRD-02 FR-31, PRD-01 FR-58). SCHEMA.md: "Realtime is enabled on
-- this table via supabase_realtime publication."
--
-- Guarded with a catalog check so re-running against a project where the
-- table is already published (for example, if it were ever added through the
-- dashboard toggle) is a no-op rather than a duplicate_object error.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end
$$;
