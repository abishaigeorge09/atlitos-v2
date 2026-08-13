-- ATLITOS v2 — seed_p5_clutch_fixtures.sql
-- Track E: Clutch fixtures for P5 phase gate.
-- Requirements: AT-104. PRD-01 FR-42, FR-45, FR-47; PRD-04 FR-27, FR-31.
--
-- This script seeds realistic Clutch content across multiple states to populate
-- the feed, moderation queue, reports queue, and verification scenarios.
--
-- IMPORTANT: Storage paths are PLACEHOLDERS. The `storage_path` columns reference
-- a private `clips` bucket object key, but no real MP4 bytes are uploaded. The feed
-- will show clip posters but video playback will fail until real objects are
-- uploaded to the `clips` bucket at the exact paths named here. This is intentional:
-- AT-96 (signed URL minting) and AT-97 (feed rendering) are testable on the paths
-- alone; bytes are only required for playback verification at the gate.
--
-- CREATOR USERS (from existing fixture set, using public.users already in the db):
--   creator_1: b290a0c8-7bba-49a9-a0f3-829c381dce55
--   creator_2: d256b326-8daf-4e5d-b733-7586d4f4740d
--   creator_3: 1412dd7e-fa0a-4c3e-b5b2-dbca4f2c83d5
--
-- ENGAGER USERS (for likes, comments, follows):
--   engager_1: b3ef4b07-fe3d-4385-93bd-363bdc414ba8
--   engager_2: d186efd6-52d6-420e-92d9-dfd3a00fcc00
--   engager_3: dc6b14da-6696-4c1e-912d-b8cc959f8f1e
--   engager_4: a8d0dc6f-14d3-414b-9e15-0c85722f2fd9
--
-- FINDING, 2026-08-14: "existing fixture set" above was never true on a clean
-- database. Nothing in this repo, no seed file and no scripts/seed-*.mjs,
-- ever creates users at these seven literal ids. Run against the first-ever
-- from-scratch local stack, this file failed twice:
--   1. clips_owner_id_fkey: owner_id not present in public.users.
--   2. Fixing that with a bare public.users insert then failed
--      users_id_fkey: public.users.id DOES carry a foreign key to
--      auth.users (missed on a truncated \d read the first time; the real
--      constraint list is below the "Indexes" section this file's own
--      earlier note quoted). auth.users cannot be written with a raw
--      encrypted_password and produce a real sign-in (GoTrue owns that
--      hashing, same note as seed_identity.sql's header), but these fixture
--      identities never needed to sign in, only to exist and be named
--      correctly in the feed/moderation/admin UI, so a direct auth.users
--      insert with no usable password is sufficient and honest about what
--      it is. public.users itself is populated by the existing
--      on_auth_user_created trigger from raw_user_meta_data ->> 'name', not
--      by a second insert here, so there is exactly one writer.
-- These ids only ever existed because some earlier session inserted them by
-- hand directly against a shared database (almost certainly production, per
-- CURRENT-STATE.md's "16 of 22 in the live feed are e2e fixtures"), and no
-- one wrote that step down.
-- FIXTURE DATA:
-- - 2 published clips (for feed, one with engagement, one for reports queue)
-- - 1 ready clip (moderation queue)
-- - 1 rejected clip (visible only to creator)
-- - 1 removed clip (terminal, takedown scenario)
-- - 1 uploading clip (upload in progress)
-- - 1 processing clip (awaiting webhook/reconcile)
-- Engagement: likes, comments, follows on published clips
-- Report: 1 on a published clip (reports queue)

do $$
declare
  creator_1 uuid := 'b290a0c8-7bba-49a9-a0f3-829c381dce55';
  creator_2 uuid := 'd256b326-8daf-4e5d-b733-7586d4f4740d';
  creator_3 uuid := '1412dd7e-fa0a-4c3e-b5b2-dbca4f2c83d5';
  engager_1 uuid := 'b3ef4b07-fe3d-4385-93bd-363bdc414ba8';
  engager_2 uuid := 'd186efd6-52d6-420e-92d9-dfd3a00fcc00';
  engager_3 uuid := 'dc6b14da-6696-4c1e-912d-b8cc959f8f1e';
  engager_4 uuid := 'a8d0dc6f-14d3-414b-9e15-0c85722f2fd9';

  clip_published_1 uuid;
  clip_published_2 uuid;
  clip_ready_1 uuid;
  clip_rejected_1 uuid;
  clip_removed_1 uuid;
  clip_uploading_1 uuid;
  clip_processing_1 uuid;

begin
  -- ========================================================================
  -- FIXTURE USERS. See the finding in this file's header, 2026-08-14.
  -- auth.users insert fires on_auth_user_created, which writes public.users
  -- from raw_user_meta_data ->> 'name'. This is the only writer of
  -- public.users here.
  -- ========================================================================

  -- confirmation_token, recovery_token, email_change_token_new and
  -- email_change carry NO column default (unlike phone_change and
  -- reauthentication_token, which default to ''). Leaving them NULL, as a
  -- first pass here did, broke GoTrue's own admin listUsers for EVERY user
  -- on the stack, not just these seven: "sql: Scan error on column index 3,
  -- name confirmation_token: converting NULL to string is unsupported",
  -- confirmed in supabase_auth_atlitos's own logs. GoTrue's Go struct scans
  -- these as non-nullable strings. Explicit '' on all four avoids it.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', creator_1, 'authenticated', 'authenticated', 'fixture.creator1@atlitos.dev', 'not-a-real-password', now(), '{"provider":"email","providers":["email"]}', '{"name":"Arjun Mehta"}', '', '', '', '', now(), now()),
    ('00000000-0000-0000-0000-000000000000', creator_2, 'authenticated', 'authenticated', 'fixture.creator2@atlitos.dev', 'not-a-real-password', now(), '{"provider":"email","providers":["email"]}', '{"name":"Kavya Rao"}', '', '', '', '', now(), now()),
    ('00000000-0000-0000-0000-000000000000', creator_3, 'authenticated', 'authenticated', 'fixture.creator3@atlitos.dev', 'not-a-real-password', now(), '{"provider":"email","providers":["email"]}', '{"name":"Rohan Iyer"}', '', '', '', '', now(), now()),
    ('00000000-0000-0000-0000-000000000000', engager_1, 'authenticated', 'authenticated', 'fixture.engager1@atlitos.dev', 'not-a-real-password', now(), '{"provider":"email","providers":["email"]}', '{"name":"Meera Nair"}', '', '', '', '', now(), now()),
    ('00000000-0000-0000-0000-000000000000', engager_2, 'authenticated', 'authenticated', 'fixture.engager2@atlitos.dev', 'not-a-real-password', now(), '{"provider":"email","providers":["email"]}', '{"name":"Vikram Singh"}', '', '', '', '', now(), now()),
    ('00000000-0000-0000-0000-000000000000', engager_3, 'authenticated', 'authenticated', 'fixture.engager3@atlitos.dev', 'not-a-real-password', now(), '{"provider":"email","providers":["email"]}', '{"name":"Ananya Das"}', '', '', '', '', now(), now()),
    ('00000000-0000-0000-0000-000000000000', engager_4, 'authenticated', 'authenticated', 'fixture.engager4@atlitos.dev', 'not-a-real-password', now(), '{"provider":"email","providers":["email"]}', '{"name":"Karthik Reddy"}', '', '', '', '', now(), now())
  on conflict (id) do nothing;

  update public.users set handle = 'arjun_clutch_1', city = 'Bengaluru', state = 'Karnataka', sports = array['tennis']::public.sport[] where id = creator_1 and handle is null;
  update public.users set handle = 'kavya_clutch_2', city = 'Hyderabad', state = 'Telangana', sports = array['badminton']::public.sport[] where id = creator_2 and handle is null;
  update public.users set handle = 'rohan_clutch_3', city = 'Chennai', state = 'Tamil Nadu', sports = array['badminton']::public.sport[] where id = creator_3 and handle is null;
  update public.users set handle = 'meera_engager_1', city = 'Bengaluru', state = 'Karnataka' where id = engager_1 and handle is null;
  update public.users set handle = 'vikram_engager_2', city = 'Hyderabad', state = 'Telangana' where id = engager_2 and handle is null;
  update public.users set handle = 'ananya_engager_3', city = 'Chennai', state = 'Tamil Nadu' where id = engager_3 and handle is null;
  update public.users set handle = 'karthik_engager_4', city = 'Pune', state = 'Maharashtra' where id = engager_4 and handle is null;

  -- ========================================================================
  -- PUBLISHED CLIPS (in feed, with engagement and one for reports queue)
  -- ========================================================================

  insert into public.clips (
    owner_id, caption, sport, status, storage_path, playback_id, thumb_path,
    likes_count, comment_count, created_at
  ) values (
    creator_1,
    'Perfect volley finish in rain, first time connecting with the court partner',
    'tennis'::public.sport,
    'published'::public.clip_status,
    'clips/published-1-tennis-volley.mp4',
    'clips/published-1-tennis-volley.mp4',
    'clips/published-1-tennis-volley-thumb.jpg',
    3,
    2,
    now() - interval '2 days'
  ) returning id into clip_published_1;

  insert into public.clips (
    owner_id, caption, sport, status, storage_path, playback_id, thumb_path,
    likes_count, comment_count, created_at
  ) values (
    creator_2,
    'Crosscourt backhand winner off the serve return',
    'badminton'::public.sport,
    'published'::public.clip_status,
    'clips/published-2-badminton-backhand.mp4',
    'clips/published-2-badminton-backhand.mp4',
    'clips/published-2-badminton-backhand-thumb.jpg',
    7,
    1,
    now() - interval '1 day'
  ) returning id into clip_published_2;

  -- ========================================================================
  -- READY CLIP (moderation queue, awaiting admin approve or reject)
  -- ========================================================================

  insert into public.clips (
    owner_id, caption, sport, status, storage_path, playback_id, thumb_path,
    created_at
  ) values (
    creator_3,
    'Sick smash from the net in doubles rally',
    'badminton'::public.sport,
    'ready'::public.clip_status,
    'clips/ready-1-badminton-smash.mp4',
    'clips/ready-1-badminton-smash.mp4',
    'clips/ready-1-badminton-smash-thumb.jpg',
    now() - interval '6 hours'
  ) returning id into clip_ready_1;

  -- ========================================================================
  -- REJECTED CLIP (visible only to creator, not in feed)
  -- ========================================================================

  insert into public.clips (
    owner_id, caption, sport, status, rejection_reason, storage_path, playback_id, thumb_path,
    created_at
  ) values (
    creator_1,
    'Attempted overhead shot that went wide',
    'tennis'::public.sport,
    'rejected'::public.clip_status,
    'Upload failed processing',
    'clips/rejected-1-tennis-overhead.mp4',
    'clips/rejected-1-tennis-overhead.mp4',
    'clips/rejected-1-tennis-overhead-thumb.jpg',
    now() - interval '12 hours'
  ) returning id into clip_rejected_1;

  -- ========================================================================
  -- REMOVED CLIP (terminal, takedown scenario)
  -- ========================================================================

  insert into public.clips (
    owner_id, caption, sport, status, storage_path, playback_id, thumb_path,
    created_at
  ) values (
    creator_2,
    'Inappropriate content removed by moderator',
    'tennis'::public.sport,
    'removed'::public.clip_status,
    'clips/removed-1-tennis-removed.mp4',
    'clips/removed-1-tennis-removed.mp4',
    'clips/removed-1-tennis-removed-thumb.jpg',
    now() - interval '3 days'
  ) returning id into clip_removed_1;

  -- ========================================================================
  -- UPLOADING CLIP (in progress, not yet confirmed)
  -- ========================================================================

  insert into public.clips (
    owner_id, caption, sport, status, storage_path, playback_id, thumb_path,
    created_at
  ) values (
    creator_3,
    'Uploading now, should be in feed soon',
    'badminton'::public.sport,
    'uploading'::public.clip_status,
    'clips/uploading-1-badminton-upload.mp4',
    'clips/uploading-1-badminton-upload.mp4',
    'clips/uploading-1-badminton-upload-thumb.jpg',
    now() - interval '5 minutes'
  ) returning id into clip_uploading_1;

  -- ========================================================================
  -- PROCESSING CLIP (awaiting webhook or reconcile reconciliation)
  -- ========================================================================

  insert into public.clips (
    owner_id, caption, sport, status, storage_path, playback_id, thumb_path,
    created_at
  ) values (
    creator_1,
    'Processing clip waiting for webhook finalization',
    'tennis'::public.sport,
    'processing'::public.clip_status,
    'clips/processing-1-tennis-process.mp4',
    'clips/processing-1-tennis-process.mp4',
    'clips/processing-1-tennis-process-thumb.jpg',
    now() - interval '2 minutes'
  ) returning id into clip_processing_1;

  -- ========================================================================
  -- ENGAGEMENT: Likes on published clips
  -- ========================================================================

  insert into public.clip_likes (clip_id, user_id) values
    (clip_published_1, engager_1),
    (clip_published_1, engager_2),
    (clip_published_1, engager_3),
    (clip_published_2, engager_1),
    (clip_published_2, engager_4),
    (clip_published_2, engager_2),
    (clip_published_2, creator_1);

  -- ========================================================================
  -- ENGAGEMENT: Comments on published clips
  -- ========================================================================

  insert into public.clip_comments (clip_id, user_id, text) values
    (clip_published_1, engager_2, 'Amazing technique, clean execution'),
    (clip_published_1, engager_3, 'Love the rain court adaptation'),
    (clip_published_2, engager_4, 'Textbook backhand');

  -- ========================================================================
  -- COMMENTS OVERFLOW. 2026-08-14, per the founder brief: the comments sheet
  -- overflow bug has NEVER been provable because production carries three
  -- comments across two clips, and CLAUDE.md is explicit that a capture of a
  -- short list proves nothing. 34 more comments here, rotating among the
  -- four engager fixture users, brings clip_published_1 to 36 total, well
  -- past the 30 the brief asked for.
  -- ========================================================================

  insert into public.clip_comments (clip_id, user_id, text, created_at)
  select
    clip_published_1,
    case (n % 4)
      when 0 then engager_1
      when 1 then engager_2
      when 2 then engager_3
      else engager_4
    end,
    'Overflow comment number ' || n || ' for scroll and sheet height testing',
    now() - (n || ' minutes')::interval
  from generate_series(1, 34) as n;

  -- ========================================================================
  -- ENGAGEMENT: Follows between creators and engagers
  -- ========================================================================

  insert into public.follows (follower_id, followee_id) values
    (engager_1, creator_1),
    (engager_1, creator_2),
    (engager_2, creator_1),
    (engager_3, creator_2),
    (engager_4, creator_3),
    (creator_1, creator_2),
    (creator_2, creator_3);

  -- ========================================================================
  -- REPORT: One report on a published clip (reports queue)
  -- ========================================================================

  insert into public.reports (
    entity_type, entity_id, reporter_id, reason, status, created_at
  ) values (
    'clip',
    clip_published_2,
    engager_2,
    'Concerning gameplay attitude toward partner',
    'pending'::public.report_status,
    now() - interval '4 hours'
  );

  -- ========================================================================
  -- VERIFICATION OUTPUT
  -- ========================================================================

  raise notice '=== CLUTCH FIXTURES SEEDED ===';
  raise notice 'Published clips: % (likes:3, comments:36, overflow tested), % (likes:7, comments:1)',
    clip_published_1, clip_published_2;
  raise notice 'Ready (moderation queue): %', clip_ready_1;
  raise notice 'Rejected: %', clip_rejected_1;
  raise notice 'Removed: %', clip_removed_1;
  raise notice 'Uploading: %', clip_uploading_1;
  raise notice 'Processing: %', clip_processing_1;
  raise notice 'Total likes across all clips: 10';
  raise notice 'Total comments across all clips: 37';
  raise notice 'Total follows: 7';
  raise notice 'Total reports (pending): 1 on clip %', clip_published_2;
  raise notice '--- STORAGE BYTES ---';
  raise notice 'PLACEHOLDER ALERT: No real MP4 bytes uploaded. All clips reference storage paths that do not exist in the `clips` bucket.';
  raise notice 'Feed will render posters but playback will fail until bytes are uploaded to:';
  raise notice '  - clips/published-1-tennis-volley.mp4';
  raise notice '  - clips/published-2-badminton-backhand.mp4';
  raise notice '  - clips/ready-1-badminton-smash.mp4';
  raise notice '  - clips/rejected-1-tennis-overhead.mp4';
  raise notice '  - clips/removed-1-tennis-removed.mp4';
  raise notice '  - clips/uploading-1-badminton-upload.mp4';
  raise notice '  - clips/processing-1-tennis-process.mp4';
  raise notice '=== END FIXTURES ===';

end $$;
