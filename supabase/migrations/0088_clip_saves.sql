create table public.clip_saves (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (clip_id, user_id)
);

create index idx_clip_saves_user_created_at on public.clip_saves (user_id, created_at desc);

alter table public.clip_saves enable row level security;

create policy clip_saves_select_own on public.clip_saves
  for select to authenticated
  using (user_id = auth.uid());

create policy clip_saves_insert_own on public.clip_saves
  for insert to authenticated
  with check (user_id = auth.uid() and not public.is_guest());

create policy clip_saves_delete_own on public.clip_saves
  for delete to authenticated
  using (user_id = auth.uid());

revoke update on public.clip_saves from authenticated;
revoke all on public.clip_saves from anon;

comment on table public.clip_saves is
  'Private per-user saved (bookmarked) clips for the Clutch profile Saved grid (PRD-01 FR-45). Owner-only RLS: a caller sees and manages only their own saves. No public read, no count trigger, no RPC; owner-scoped direct DML is the write path.';
