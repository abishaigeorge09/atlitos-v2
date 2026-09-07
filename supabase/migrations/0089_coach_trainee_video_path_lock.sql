-- ATLITOS v2 — 0089_coach_trainee_video_path_lock.sql
-- SEC-F3 (P1, security audit 2026-09-04): coach_trainee_videos rows can inject
-- arbitrary storage paths and trainee relationships.
--
-- THE BUG. 0082 granted `authenticated` a direct INSERT on this table with
--
--   with check (coach_id = auth.uid() and public.has_role('coach'))
--
-- and left `storage_path` and `player_id` entirely to the caller. The header
-- comment says row creation "actually goes through
-- coach-trainee-video-upload-url", and that function does the right things: it
-- verifies the target athlete is genuinely one of this coach's trainees (a
-- `sessions` row linking them) and DERIVES the object key as
-- `coach-videos/{coach_id}/{player_id}/{id}.mp4`. But the policy is a second
-- door around it, and nothing behind that door checks either value.
--
-- The exploit is the SEC-F1 shape through a different table. A coach inserts a
-- row naming themselves as coach_id (so the ownership check in
-- get-coach-trainee-video-url passes), any athlete as player_id, and any object
-- key in the private `clips` bucket as storage_path -- another member's Clutch
-- upload, a rejected clip, a removed one. That function then hands the stored
-- path straight to a service-role signed-URL mint. Same bucket, same bypass of
-- clip status and takedown, reached without touching stream-webhook at all.
-- The same insert also fabricates a coach/trainee relationship, attaching video
-- to an athlete who was never this coach's student.
--
-- THE FIX, both halves, because either alone is insufficient:
--
--   * This migration closes the write. `storage_path` must be null on a client
--     insert (only the service-role function may set it, and it does so via an
--     UPDATE that `authenticated` has no grant for), and `player_id` must name
--     a real trainee, re-deriving in SQL the same `sessions` link the edge
--     function checks. The caption-only draft row 0082's comment wanted still
--     works; what no longer works is choosing the path.
--
--   * get-coach-trainee-video-url pins the mint to
--     `coach-videos/{coach_id}/{player_id}/` (shipped alongside this). That
--     half matters because rows written BEFORE this migration are already in
--     the table with whatever path their author chose, and a policy change does
--     not retract them.

drop policy if exists coach_trainee_videos_coach_insert on public.coach_trainee_videos;

create policy coach_trainee_videos_coach_insert on public.coach_trainee_videos
  for insert to authenticated
  with check (
    coach_id = (select auth.uid())
    and public.has_role('coach')
    -- The object key is derived server side by
    -- coach-trainee-video-upload-url, never chosen by the caller. A client
    -- insert may only create the caption-only draft row 0082 describes.
    and storage_path is null
    -- The athlete must actually be one of this coach's trainees. `sessions` is
    -- the only coach/player link in the schema, which is exactly what the edge
    -- function checks before it creates a row; without it here, the direct
    -- policy let a coach attach video to any athlete in the system.
    and exists (
      select 1
      from public.sessions s
      where s.coach_id = (select auth.uid())
        and s.player_id = coach_trainee_videos.player_id
    )
  );

comment on policy coach_trainee_videos_coach_insert on public.coach_trainee_videos is
  'SEC-F3. A coach may create a caption-only draft row for a real trainee. storage_path stays null on every client insert: it is derived and written by coach-trainee-video-upload-url under the service role, because a client-chosen path is later handed to a signed-URL mint against the private clips bucket.';
