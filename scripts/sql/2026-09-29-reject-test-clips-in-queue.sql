-- ATLITOS: clear the e2e test clips out of the Clutch moderation queue.
--
-- NOT A MIGRATION. A one off data fix, written by DEV, READ by a founder,
-- then run by that founder in the Supabase SQL editor for project
-- syzzfgaudpifwvbpycyi. Agents never run this (CLAUDE.md, DEBT.md 2026-08-11).
-- Found by the 2026-09-29 device pass (BUG-055, docs/qa/DEVICE-TEST-2026-09-29.md).
--
-- The Clutch feed shows only `published` clips, and there are none, so the
-- feed is empty. The moderation queue (`ready`) holds 11 clips. None of them
-- is launch content and NONE should be approved:
--   * 9 are the e2e suite's CL-10 fixtures (caption "e2e CL-10 <hex>"). They
--     are rejected below.
--   * 2 are left for a founder to decide, because a person may own them:
--       dbc6f83f-d205-4f19-b8d9-5026c7e2e175  2026-07-21  "Sick smash from the net in doubles rally"
--       e7d4a1e6-0aa5-45d3-9c9e-078afa0558b2  2026-09-10  "hi"
--     Reject either in the admin moderation page if it is test data.
-- None of the 11 has a cf_stream_uid, so none has a playable stream.
--
-- `ready -> rejected` is an allowed transition (0094). Written directly, the
-- same way 2026-09-23-remove-test-pattern-clips.sql wrote its takedowns, so
-- the e2e accounts get no "Your clip was not approved" notification.
--
-- After this the feed is STILL empty. Post real clips (founders or partner
-- athletes) and approve them in admin before screenshots or submission.
--
-- HOW TO RUN: run the whole file. It ends with ROLLBACK, so the first run is
-- a dry run; read the preview and the changed count. Then change the single
-- `rollback;` line at the end to `commit;` and run it again.

begin;

-- 1. Preview. Expect exactly these 9 rows, all status = ready.
select id, status, caption, created_at
  from public.clips
 where id in (
   'bb0bdc4e-7a78-4aa1-8fba-164833224967', -- e2e CL-10 1fe8ed33
   '36989088-a5b5-4345-98f5-21acc0c04f47', -- e2e CL-10 a38b045e
   '207dfe54-82f0-4e30-ad3a-ff9477a7f087', -- e2e CL-10 e31843fc
   'bf0e21c3-5b27-4451-b4b5-24a07241179d', -- e2e CL-10 8c5f673c
   '80671b8e-2166-4966-a98c-527c5aa46789', -- e2e CL-10 87b018d9
   '280b97a9-70dd-44d3-b399-d4d0dc843ac2', -- e2e CL-10 73566e39
   'e46e4682-1edc-4eca-8033-d341091d062d', -- e2e CL-10 e79e5b9e
   '9d60fc99-89e8-4989-8136-7443c7aa7774', -- e2e CL-10 8133808a
   '40f31b9b-9ec1-41f2-92dc-473081cd43d5'  -- e2e CL-10 3bc900e5
 )
 order by created_at;

-- 2. Reject them. Aborts the whole transaction unless exactly 9 change, and
--    touches only rows that are still `ready` with an e2e caption.
do $$
declare n int;
begin
  update public.clips
     set status = 'rejected',
         rejection_reason = 'Automated test clip, not launch content.'
   where status = 'ready'
     and caption like 'e2e CL-10 %'
     and id in (
       'bb0bdc4e-7a78-4aa1-8fba-164833224967', '36989088-a5b5-4345-98f5-21acc0c04f47',
       '207dfe54-82f0-4e30-ad3a-ff9477a7f087', 'bf0e21c3-5b27-4451-b4b5-24a07241179d',
       '80671b8e-2166-4966-a98c-527c5aa46789', '280b97a9-70dd-44d3-b399-d4d0dc843ac2',
       'e46e4682-1edc-4eca-8033-d341091d062d', '9d60fc99-89e8-4989-8136-7443c7aa7774',
       '40f31b9b-9ec1-41f2-92dc-473081cd43d5'
     );
  get diagnostics n = row_count;
  if n <> 9 then
    raise exception 'expected 9 clips rejected, got %', n;
  end if;
end $$;

-- 3. What the queue holds now: expect the 2 founder decides clips only.
select id, status, caption from public.clips where status = 'ready' order by created_at;

rollback;
