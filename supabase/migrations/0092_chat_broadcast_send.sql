-- ATLITOS v2 — 0092_chat_broadcast_send.sql
-- Domain: chat realtime (LAUNCH Phase 3). Item P1-2; contract CT-4.
-- Track A (Database). MONEY-GRADE REVIEW SCOPE: a wrong topic predicate
-- broadcasts private chat to the wrong user.
--
-- WHY (Settled decision 2): the old chat realtime used postgres_changes on
-- chat_messages, so the server evaluated the SELECT policy per subscriber per
-- inserted row. At 1000 concurrent clients that is the meltdown class itself.
-- This moves delivery to Broadcast FROM THE DATABASE: an AFTER INSERT trigger
-- calls realtime.send() once per thread member onto that member's PRIVATE
-- per-user topic. Delivery authorization is an RLS policy on realtime.messages,
-- so a socket can subscribe ONLY to its own topic.
--
-- CT-4 contract:
--   * topic  'chat:user:{member_user_id}'
--   * event  'message_new'
--   * payload { thread_id, message_id, sender_id, body, created_at } as text/ISO
--   * every member of the thread (sender included) gets one send.
--
-- MEMBERSHIP, stated precisely (this is where a naive reading goes wrong):
-- 1:1 coaching threads carry their two members in chat_threads.participant_a /
-- participant_b (0022); only GROUP threads populate chat_thread_members (0078).
-- Iterating chat_thread_members alone would deliver ZERO events for every 1:1
-- coaching thread, the primary chat surface. So the recipient set is the UNION
-- of the pair columns (when present) and chat_thread_members. This preserves the
-- CT-4 topic/event/payload contract exactly; it only fixes which members are
-- enumerated.

-- ============================================================================
-- broadcast_chat_message: AFTER INSERT trigger on chat_messages.
--
-- SECURITY DEFINER (owned by the migration role) so realtime.send can insert
-- into realtime.messages regardless of the sending client's privileges. The
-- payload keys are the column values as text/ISO: created_at is emitted by
-- jsonb_build_object as ISO 8601 with timezone.
-- ============================================================================

create or replace function public.broadcast_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member uuid;
  v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'thread_id', new.thread_id::text,
    'message_id', new.id::text,
    'sender_id', new.sender_id::text,
    'body', new.text,
    'created_at', new.created_at
  );

  for v_member in
    select t.participant_a
      from public.chat_threads t
      where t.id = new.thread_id and t.participant_a is not null
    union
    select t.participant_b
      from public.chat_threads t
      where t.id = new.thread_id and t.participant_b is not null
    union
    select m.user_id
      from public.chat_thread_members m
      where m.thread_id = new.thread_id
  loop
    perform realtime.send(
      v_payload,
      'message_new',
      'chat:user:' || v_member::text,
      true
    );
  end loop;

  return new;
end;
$$;

-- A trigger function fires as the table owner regardless, so its EXECUTE is
-- revoked from every client role (the 0047 advisor pattern): nothing calls it
-- directly over /rest/v1/rpc.
revoke all on function public.broadcast_chat_message() from public;
revoke execute on function public.broadcast_chat_message() from anon, authenticated;

comment on function public.broadcast_chat_message() is
  'CT-4: on a new chat_messages row, realtime.send a message_new event to each thread member''s private chat:user:{uid} topic. Members = participant_a/b (1:1) UNION chat_thread_members (group).';

drop trigger if exists chat_messages_broadcast on public.chat_messages;
create trigger chat_messages_broadcast
  after insert on public.chat_messages
  for each row execute function public.broadcast_chat_message();

-- ============================================================================
-- realtime.messages RLS: a subscriber may receive ONLY its own chat topic.
--
-- Broadcast authorization in Supabase Realtime is a SELECT policy on
-- realtime.messages evaluated in the subscriber's context; realtime.topic()
-- returns the topic the socket is accessing. This policy allows an authenticated
-- socket to receive a broadcast message ONLY on topic 'chat:user:' || its own
-- uid. auth.uid() is wrapped in a scalar subselect (initplan form) per the P1-4
-- convention.
--
-- There is deliberately NO insert/send policy for clients: these topics are fed
-- only by broadcast_chat_message() above (definer, bypasses RLS). A client can
-- subscribe (receive) its own topic and cannot send to any, so it cannot inject
-- a forged message_new event.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'chat_broadcast_receive_own'
  ) then
    create policy chat_broadcast_receive_own on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and realtime.topic() = 'chat:user:' || (select auth.uid())::text
      );
  end if;
end
$$;
