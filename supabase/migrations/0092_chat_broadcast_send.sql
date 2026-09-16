-- 0092_chat_broadcast_send: CT-4 broadcast chat via realtime.send to each member's private topic + realtime.messages own-topic receive policy.
create or replace function public.broadcast_chat_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_member uuid; v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'thread_id', new.thread_id::text, 'message_id', new.id::text,
    'sender_id', new.sender_id::text, 'body', new.text, 'created_at', new.created_at);
  for v_member in
    select t.participant_a from public.chat_threads t where t.id = new.thread_id and t.participant_a is not null
    union select t.participant_b from public.chat_threads t where t.id = new.thread_id and t.participant_b is not null
    union select m.user_id from public.chat_thread_members m where m.thread_id = new.thread_id
  loop
    perform realtime.send(v_payload, 'message_new', 'chat:user:' || v_member::text, true);
  end loop;
  return new;
end; $$;
revoke all on function public.broadcast_chat_message() from public;
revoke execute on function public.broadcast_chat_message() from anon, authenticated;
comment on function public.broadcast_chat_message() is 'CT-4: on a new chat_messages row, realtime.send a message_new event to each thread member''s private chat:user:{uid} topic. Members = participant_a/b (1:1) UNION chat_thread_members (group).';
drop trigger if exists chat_messages_broadcast on public.chat_messages;
create trigger chat_messages_broadcast after insert on public.chat_messages for each row execute function public.broadcast_chat_message();
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='realtime' and tablename='messages' and policyname='chat_broadcast_receive_own') then
    create policy chat_broadcast_receive_own on realtime.messages for select to authenticated
      using (realtime.messages.extension = 'broadcast' and realtime.topic() = 'chat:user:' || (select auth.uid())::text);
  end if;
end $$;
