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
  raise notice 'Published clips: % (likes:3, comments:2), % (likes:7, comments:1)',
    clip_published_1, clip_published_2;
  raise notice 'Ready (moderation queue): %', clip_ready_1;
  raise notice 'Rejected: %', clip_rejected_1;
  raise notice 'Removed: %', clip_removed_1;
  raise notice 'Uploading: %', clip_uploading_1;
  raise notice 'Processing: %', clip_processing_1;
  raise notice 'Total likes across all clips: 10';
  raise notice 'Total comments across all clips: 3';
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
