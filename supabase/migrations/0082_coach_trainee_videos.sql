-- ATLITOS v2 — 0082_coach_trainee_videos.sql
-- Track F, PRD-02 Player Profile "Video Analytics" tab (design node
-- 1047:16588, docs/design/COACH-TRAININGS-GAP.md gap #8/#18). Per-trainee
-- video review: a coach uploads review clips of one of their trainees; the
-- trainee can see their own, read only.
--
-- NOT MONEY. No column here is a money row or a state-machine status field
-- (CLAUDE.md's financial invariant is about payment_intents/ledger_entries/
-- transfers/booking status, none of which this table touches), so a direct
-- owner-scoped RLS policy is the right shape, same as coach-certificates
-- (0006) and coach_trainee_notes-style small tables, not an RPC.
--
-- Storage: this table stores a PATH into the existing PRIVATE `clips` bucket
-- (0042), under a `coach-videos/{coach_id}/{player_id}/...` prefix, so it
-- rides the same "no storage.objects policy at all, signed URL only, minted
-- by an edge function under the service role" pattern documented at 0042's
-- "THE PRIVATE clips STORAGE BUCKET" comment. No new bucket, no new storage
-- policy: `clips` already has public = false and zero direct-access grants.
--
-- INTEGRATOR NOTE (per the Track F brief): this migration is WRITTEN but NOT
-- APPLIED here. Apply with apply_migration, then deploy the sibling edge
-- functions this migration's comment block references
-- (supabase/functions/coach-trainee-video-upload-url,
-- supabase/functions/get-coach-trainee-video-url), neither of which is
-- deployed yet either.

create table public.coach_trainee_videos (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coach_profiles (user_id) on delete cascade,
  player_id uuid not null references public.users (id) on delete cascade,
  -- Object KEY in the private `clips` bucket, `coach-videos/{coach_id}/{player_id}/{id}.mp4`.
  -- Never a resolved URL (same rule as clips.storage_path, 0041): playback is
  -- always a fresh signed mint against this live row, never a stored URL.
  -- Nullable until the upload-url edge function's PUT lands, mirroring
  -- clips.storage_path staying null through the `uploading` window.
  storage_path text,
  caption text,
  created_at timestamptz not null default now()
);

create index idx_coach_trainee_videos_coach_id on public.coach_trainee_videos (coach_id);
create index idx_coach_trainee_videos_player_id on public.coach_trainee_videos (player_id);
create index idx_coach_trainee_videos_coach_player on public.coach_trainee_videos (coach_id, player_id, created_at desc);

comment on table public.coach_trainee_videos is
  'Coach-uploaded review videos for one trainee. storage_path is a PATH into the private clips bucket under coach-videos/, never a resolved URL; every view mints a fresh short lived signed URL via get-coach-trainee-video-url (mirrors get-clip-playback-url). Not a money table: financial invariant does not apply.';
comment on column public.coach_trainee_videos.storage_path is
  'Object KEY in the private `clips` bucket under coach-videos/{coach_id}/{player_id}/. Set by coach-trainee-video-upload-url once the row exists; null through the brief upload window.';

alter table public.coach_trainee_videos enable row level security;

-- Coach: full read/write of their OWN uploaded videos. Row creation with a
-- storage_path actually goes through coach-trainee-video-upload-url (service
-- role, so it can mint the signed upload URL and persist the path in one
-- call, the same shape as stream-upload-url/clips), but the INSERT policy is
-- still granted here per the "RPC or direct owner-scoped policy" brief, so a
-- caption-only draft row (no storage_path yet) can also be created directly
-- if a future screen wants that.
create policy coach_trainee_videos_coach_select on public.coach_trainee_videos
  for select to authenticated
  using (coach_id = auth.uid());

create policy coach_trainee_videos_coach_insert on public.coach_trainee_videos
  for insert to authenticated
  with check (coach_id = auth.uid() and public.has_role('coach'));

create policy coach_trainee_videos_coach_delete on public.coach_trainee_videos
  for delete to authenticated
  using (coach_id = auth.uid());

-- Trainee: read only their own videos. No insert/update/delete grant at all
-- (RLS.md "RLS is not scoping" applies to reads only here; there is no
-- permissive-OR public policy on this table for a stray unscoped select to
-- fall through, but every client query still carries its own explicit
-- coach_id/player_id filter per that rule, never relying on RLS alone).
create policy coach_trainee_videos_player_select on public.coach_trainee_videos
  for select to authenticated
  using (player_id = auth.uid());

-- No client update at all: a video is immutable once posted (caption edits
-- and re-uploads are out of scope for this pass). No anon access whatsoever.
revoke all on public.coach_trainee_videos from anon;
revoke update on public.coach_trainee_videos from authenticated;
