-- ATLITOS v2 - 0138_content_terms_and_chat_filter.sql
--
-- Apple Guideline 1.2 (user generated content): the app must make users agree
-- to terms that say there is no tolerance for objectionable content or abusive
-- users, and must have a way to filter objectionable material. Launch runbook
-- stage 3.3.
--
-- 1. users.content_terms_accepted_at, set through accept_content_terms().
-- 2. A BEFORE INSERT guard on clips, clip_comments and chat_messages that
--    refuses a row whose author has not accepted. It is a trigger, not an RLS
--    clause, because clips are inserted by the stream-upload-url edge function
--    under the service role, which bypasses RLS. The trigger keys off the
--    row's author column, so it holds on every write path.
-- 3. content_blocked_terms, an admin editable word list, and a filter on the
--    same trigger for comments and chat messages (and clip captions).
-- 4. Guests: clips_insert_own and support_tickets_insert_own now also require
--    not is_guest(), matching clip_comments_insert_own and the report policy.
--
-- Existing accounts are NOT backfilled. The zero tolerance terms are new, so
-- everyone agrees once before their next post. Test and seed scripts that
-- insert content for fixture users must call accept_content_terms() as that
-- user, or set the column with the service role, first.
--
-- Errors are raised with the ApiErrorCode prefix convention
-- (packages/api/src/errors.ts): CONTENT_TERMS_REQUIRED and CONTENT_BLOCKED.

-- ---------------------------------------------------------------------------
-- 1. The acceptance column and the only way to set it
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists content_terms_accepted_at timestamptz;

comment on column public.users.content_terms_accepted_at is
  'When the user agreed to the content rules (zero tolerance for objectionable content or abusive users). Null means they have not, and every clip, comment and chat message insert is refused. Set by accept_content_terms() (0138).';

create or replace function public.accept_content_terms()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: Sign in first.';
  end if;
  if public.is_guest() then
    raise exception 'GUEST_FORBIDDEN: Create an account to post.';
  end if;

  -- First acceptance wins: re-calling never moves the timestamp.
  update public.users
     set content_terms_accepted_at = coalesce(content_terms_accepted_at, now())
   where id = v_uid
  returning content_terms_accepted_at into v_at;

  if v_at is null then
    raise exception 'NOT_FOUND: Profile not found.';
  end if;
  return v_at;
end;
$$;

revoke all on function public.accept_content_terms() from public, anon;
grant execute on function public.accept_content_terms() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The word list (before the trigger that reads it)
-- ---------------------------------------------------------------------------
create table if not exists public.content_blocked_terms (
  term text primary key,
  note text,
  added_at timestamptz not null default now(),
  constraint content_blocked_terms_lowercase check (term = lower(term) and btrim(term) <> '')
);

comment on table public.content_blocked_terms is
  'Words and phrases refused in comments, chat messages and clip captions (0138). Matched case insensitively on word boundaries. Admins edit it; nobody else can read it, so the list cannot be probed.';

alter table public.content_blocked_terms enable row level security;
revoke all on public.content_blocked_terms from anon, authenticated;
grant select, insert, update, delete on public.content_blocked_terms to authenticated;
grant select, insert, update, delete on public.content_blocked_terms to service_role;

drop policy if exists content_blocked_terms_admin_all on public.content_blocked_terms;
create policy content_blocked_terms_admin_all on public.content_blocked_terms
  for all to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));

-- Suspension guard (0096/0115 pattern): a suspended admin cannot edit the
-- list. scripts/security-invariants.sh (suspend-enforcement) checks this.
drop policy if exists content_blocked_terms_active_insert on public.content_blocked_terms;
create policy content_blocked_terms_active_insert on public.content_blocked_terms
  as restrictive for insert to authenticated with check (public.is_actor_active());
drop policy if exists content_blocked_terms_active_update on public.content_blocked_terms;
create policy content_blocked_terms_active_update on public.content_blocked_terms
  as restrictive for update to authenticated using (public.is_actor_active()) with check (public.is_actor_active());
drop policy if exists content_blocked_terms_active_delete on public.content_blocked_terms;
create policy content_blocked_terms_active_delete on public.content_blocked_terms
  as restrictive for delete to authenticated using (public.is_actor_active());

-- A small starter list of unambiguous English abuse. The moderation owner
-- extends it (including Hindi, Telugu, Tamil and Kannada abuse) from the admin
-- app or the SQL editor. Kept short on purpose: an over broad list refuses
-- ordinary sport talk ("killer shot", "we got smashed").
insert into public.content_blocked_terms (term, note) values
  ('fuck', 'starter list 0138'),
  ('fucking', 'starter list 0138'),
  ('motherfucker', 'starter list 0138'),
  ('cunt', 'starter list 0138'),
  ('bitch', 'starter list 0138'),
  ('whore', 'starter list 0138'),
  ('slut', 'starter list 0138'),
  ('faggot', 'starter list 0138'),
  ('nigger', 'starter list 0138'),
  ('retard', 'starter list 0138'),
  ('kill yourself', 'starter list 0138'),
  ('kys', 'starter list 0138')
on conflict (term) do nothing;

create or replace function public.contains_blocked_term(p_text text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.content_blocked_terms t
    where lower(coalesce(p_text, '')) ~ (
      '\m' || regexp_replace(t.term, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\M'
    )
  );
$$;

revoke all on function public.contains_blocked_term(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2 and 3. The guard
-- ---------------------------------------------------------------------------
-- TG_ARGV[0] is the author column, TG_ARGV[1] the text column to filter.
create or replace function public.enforce_content_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
  v_text text := to_jsonb(new) ->> tg_argv[1];
  v_accepted timestamptz;
begin
  select u.content_terms_accepted_at into v_accepted
    from public.users u
   where u.id = v_author;

  if v_accepted is null then
    raise exception 'CONTENT_TERMS_REQUIRED: Agree to the content rules before posting.';
  end if;

  if public.contains_blocked_term(v_text) then
    raise exception 'CONTENT_BLOCKED: This breaks our content policy. Please change it and try again.';
  end if;

  return new;
end;
$$;

drop trigger if exists clip_comments_enforce_content_rules on public.clip_comments;
create trigger clip_comments_enforce_content_rules
  before insert on public.clip_comments
  for each row execute function public.enforce_content_rules('user_id', 'text');

drop trigger if exists chat_messages_enforce_content_rules on public.chat_messages;
create trigger chat_messages_enforce_content_rules
  before insert on public.chat_messages
  for each row execute function public.enforce_content_rules('sender_id', 'text');

drop trigger if exists clips_enforce_content_rules on public.clips;
create trigger clips_enforce_content_rules
  before insert on public.clips
  for each row execute function public.enforce_content_rules('owner_id', 'caption');

-- stream-upload-url lets a retry correct the caption, so an edited caption
-- goes through the same filter.
drop trigger if exists clips_enforce_content_rules_caption on public.clips;
create trigger clips_enforce_content_rules_caption
  before update of caption on public.clips
  for each row
  when (new.caption is distinct from old.caption)
  execute function public.enforce_content_rules('owner_id', 'caption');

-- ---------------------------------------------------------------------------
-- 4. Guests may not post a clip or open a support ticket
-- ---------------------------------------------------------------------------
alter policy "clips_insert_own" on public.clips
  with check ((owner_id = (select auth.uid())) and (status = 'uploading'::clip_status) and not (select public.is_guest()));

alter policy "support_tickets_insert_own" on public.support_tickets
  with check ((submitter_id = (select auth.uid())) and not (select public.is_guest()));
