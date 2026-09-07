-- 0094_chat_preview_and_bounds.sql
--
-- SCALING. `useChat().threads()` built its per-thread message preview by
-- selecting EVERY message in EVERY thread the caller belongs to and then
-- keeping the first row per thread in JavaScript:
--
--   .from("chat_messages").select(...).in("thread_id", <all my threads>)
--   .order("created_at", { ascending: false })
--
-- The work is O(total messages), not O(threads), and it is paid on every open
-- of the chat list. Ten threads with a thousand messages each transfers ten
-- thousand rows to render ten preview lines, and it gets worse every day the
-- app is used. Nothing about the query says "slow" while the seed data is
-- small, which is why it survived review.
--
-- `distinct on (thread_id)` with the existing `idx_chat_messages_thread_id`
-- (thread_id, created_at) index reads one row per thread instead. The index
-- already exists and is already in the right order, so this needs no new index.
--
-- SECURITY INVOKER (the default) is deliberate: chat_messages RLS applies to
-- the caller exactly as it would through PostgREST, so a caller who passes a
-- thread id they do not belong to gets nothing back. The explicit membership
-- filter below is the CLAUDE.md "RLS is a floor, not scoping" layer on top.

create or replace function public.chat_thread_previews(p_thread_ids uuid[])
returns table (
  thread_id uuid,
  text text,
  created_at timestamptz,
  sender_name text
)
language sql
stable
set search_path = public
as $$
  select distinct on (m.thread_id)
    m.thread_id,
    m.text,
    m.created_at,
    u.name as sender_name
  from public.chat_messages m
  left join public.users u on u.id = m.sender_id
  where m.thread_id = any (p_thread_ids)
    -- Explicit scoping on top of RLS: the caller must actually be in the
    -- thread, whether as a 1:1 participant or a group chat member.
    and exists (
      select 1 from public.chat_threads t
      where t.id = m.thread_id
        and (t.participant_a = (select auth.uid()) or t.participant_b = (select auth.uid()))
      union all
      select 1 from public.chat_thread_members cm
      where cm.thread_id = m.thread_id and cm.user_id = (select auth.uid())
    )
  order by m.thread_id, m.created_at desc;
$$;

revoke all on function public.chat_thread_previews(uuid[]) from public, anon;
grant execute on function public.chat_thread_previews(uuid[]) to authenticated;

comment on function public.chat_thread_previews(uuid[]) is
  'One latest message per thread via distinct on, replacing a client-side fold over every message in every thread. Uses idx_chat_messages_thread_id. SECURITY INVOKER so chat RLS applies, plus an explicit membership filter.';
